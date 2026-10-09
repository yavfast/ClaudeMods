import type { SessionMessage } from 'claude-code'
import {
  BIG_ROW,
  fingerprint,
  locate,
  MAX_QUEUE_EDITS,
  MAX_TEXT,
  NO_REFS,
  oneLine,
  OWN_TOOLS,
  prepare,
  REF_HINT,
  STALE_INDEXES,
  touchedBy,
  type Edit,
  type Pinned,
  type QueuedEdit,
  type RefResolver,
} from './edits'
import { MAX_QUEUE_BYTES, queueBytes, type Queue, type Read } from './queue'

// [SP_CTX_01_12]
export const MAX_TAGS = 1000
export const SEARCH_TOOLS: readonly string[] = ['Glob', 'Grep', 'WebSearch', 'ToolSearch']
export const SEARCH_TTL = 3
export const NUDGE_FIRST = 80_000
export const NUDGE_STEP = 40_000
// [SP_CTX_01_10] The registry file stays readable by the host (4 MiB limit).
export const MAX_REGISTRY_BYTES = MAX_QUEUE_BYTES

// [SP_CTX_01_09]
export type TagKind = 'pin' | 'disposable' | 'review'
export type TagTarget = { tool_use_id: string } | { anchor: string; hint: number }
export type Tag = { kind: TagKind; target: TagTarget; note?: string; ttl_turns?: number; created_turn: number }

// [SP_CTX_01_10]
export type TagRegistry = { tags: Tag[]; turn: number; firstPromptPinned: boolean }

export const EMPTY_REGISTRY: TagRegistry = { tags: [], turn: 0, firstPromptPinned: false }

const KINDS: readonly string[] = ['pin', 'disposable', 'review']
// [SP_CTX_01_11] Who counts as the person for rule R1.
// stream-json files the person's prompt rows as `unclassified`, not `sdk`
const HUMAN: readonly string[] = ['composer', 'bridge', 'sdk', 'unclassified']

function isCount(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min
}

// [SP_CTX_01_09] Every field of one stored tag, by type and constraint.
function isTag(raw: unknown): raw is Tag {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const t = raw as Record<string, unknown>
  if (typeof t.kind !== 'string' || !KINDS.includes(t.kind)) return false
  const target = t.target as Record<string, unknown> | null | undefined
  if (typeof target !== 'object' || target === null) return false
  const byId = typeof target.tool_use_id === 'string' && target.tool_use_id !== '' && target.anchor === undefined
  const byRow = typeof target.anchor === 'string' && isCount(target.hint, 0) && target.tool_use_id === undefined
  if (!byId && !byRow) return false
  if (t.note !== undefined && typeof t.note !== 'string') return false
  if (t.kind === 'disposable' && (typeof t.note !== 'string' || !t.note.trim() || t.note.length > MAX_TEXT)) return false
  if (t.ttl_turns !== undefined && (t.kind !== 'review' || !isCount(t.ttl_turns, 1))) return false
  return isCount(t.created_turn, 0)
}

// [SP_CTX_01_10] Read states as the queue's: a wrong field or tag makes the
// whole file unreadable, never silently an empty registry.
export function parseRegistry(text: string): Read<TagRegistry> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { state: 'unreadable', reason: `not JSON: ${String(err)}` }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unreadable', reason: 'not an object' }
  const reg = { ...EMPTY_REGISTRY, ...(raw as Partial<TagRegistry>) }
  const bad = [
    !Array.isArray(reg.tags) && 'tags',
    !isCount(reg.turn, 0) && 'turn',
    typeof reg.firstPromptPinned !== 'boolean' && 'firstPromptPinned',
  ].filter(Boolean)
  if (bad.length) return { state: 'unreadable', reason: `bad field(s): ${bad.join(', ')}` }
  const badTag = reg.tags.findIndex(t => !isTag(t))
  return badTag >= 0 ? { state: 'unreadable', reason: `bad tag ${badTag + 1}` } : { state: 'ok', value: reg }
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function sameTarget(a: TagTarget, b: TagTarget): boolean {
  return 'tool_use_id' in a ? 'tool_use_id' in b && a.tool_use_id === b.tool_use_id : 'anchor' in b && a.anchor === b.anchor
}

// [SP_CTX_01_09] A review is active once its ttl has passed; other kinds always.
export function isActive(tag: Tag, turn: number): boolean {
  return tag.kind !== 'review' || tag.ttl_turns === undefined || turn - tag.created_turn >= tag.ttl_turns
}

// The rows a tag's target is on now: both rows of a pair, or the located row.
export function resolveTarget(rows: readonly SessionMessage[], target: TagTarget): number[] | undefined {
  if ('tool_use_id' in target) return touchedBy(rows, { op: 'drop', tool_use_id: target.tool_use_id })?.rows
  const at = locate(rows, target.anchor, target.hint)
  return at < 0 ? undefined : [at]
}

// [SP_CTX_02_03] The pinned targets on `rows`, as prepare takes them.
export function pinnedTargets(rows: readonly SessionMessage[], reg: TagRegistry): Pinned {
  const ids = new Set<string>()
  const at = new Set<number>()
  for (const tag of reg.tags) {
    if (tag.kind !== 'pin') continue
    if ('tool_use_id' in tag.target) ids.add(tag.target.tool_use_id)
    else for (const i of resolveTarget(rows, tag.target) ?? []) at.add(i)
  }
  return { ids, rows: at }
}

// [SP_CTX_02_01] Tag labels by row index: `[pin]`, `[disposable: "<40>"]`,
// `[review]` while active. A pair's tag shows on both of its rows.
export function tagLabels(rows: readonly SessionMessage[], reg: TagRegistry): Map<number, string[]> {
  const labels = new Map<number, string[]>()
  for (const tag of reg.tags) {
    if (!isActive(tag, reg.turn)) continue
    const label = tag.kind === 'disposable' ? `[disposable: "${oneLine(tag.note ?? '', 40)}"]` : `[${tag.kind}]`
    for (const i of resolveTarget(rows, tag.target) ?? []) labels.set(i, [...(labels.get(i) ?? []), label])
  }
  return labels
}

// [SP_CTX_02_09] Active review tags whose targets are still there.
export function activeReviews(rows: readonly SessionMessage[], reg: TagRegistry): number {
  return reg.tags.filter(t => t.kind === 'review' && isActive(t, reg.turn) && resolveTarget(rows, t.target)).length
}

// What the tag contracts need from the host; register.ts binds them to `$`
// and runs registry changes on the registry's serial chain, queue changes on
// the queue's.
export type TagIO = {
  rows: () => Promise<readonly SessionMessage[]>
  readTags: () => Promise<Read<TagRegistry>>
  writeTags: (reg: TagRegistry) => Promise<void>
  readQueue: () => Promise<Read<Queue>>
  writeQueue: (q: Queue) => Promise<void>
}

// [SP_CTX_02_11]
export type TagDeny = 'DENIED_SUBAGENT' | 'DENIED_EMPTY' | 'DENIED_STORAGE' | 'DENIED_REGISTRY_READ' | 'DENIED_REGISTRY_WRITE'
export type TagError =
  | 'BAD_OP'
  | 'KIND_REQUIRED'
  | 'TARGET_REQUIRED'
  | 'UNKNOWN_REF'
  | 'TARGET_NOT_FOUND'
  | 'INDEXES_STALE'
  | 'NOTE_REQUIRED'
  | 'BAD_TARGET'
  | 'BAD_TTL'
  | 'TAGS_FULL'
  | 'NO_TAG'

export type TagOutcome = { registry: TagRegistry; added: number; removed: number; rejected: { code: TagError; reason: string }[] }

// [SP_CTX_02_11] Applies the requests in order to the registry on the rows as
// they are now; a rejected request leaves the rest of the batch going. A `ref`
// is resolved to its tool_use_id here ([SP_CTX_02_17]). Pure.
export function applyTagRequests(
  reg: TagRegistry,
  rows: readonly SessionMessage[],
  raws: readonly unknown[],
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
): TagOutcome {
  const tags = [...reg.tags]
  let size = bytes({ ...reg, tags })
  const out: TagOutcome = { registry: reg, added: 0, removed: 0, rejected: [] }
  raws.forEach((raw, n) => {
    const reject = (code: TagError, why: string) => void out.rejected.push({ code, reason: `tag ${n + 1}: ${why} (${code})` })
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    if (r.op !== 'add' && r.op !== 'remove') return reject('BAD_OP', `op must be "add" or "remove"`)
    if (r.op === 'add' && (typeof r.kind !== 'string' || !KINDS.includes(r.kind)))
      return reject('KIND_REQUIRED', 'kind must be "pin", "disposable" or "review"')
    const hasId = r.tool_use_id !== undefined
    const hasIndex = r.index !== undefined
    const hasRef = r.ref !== undefined
    if (
      [hasId, hasIndex, hasRef].filter(Boolean).length !== 1 ||
      (hasId && (typeof r.tool_use_id !== 'string' || !r.tool_use_id)) ||
      (hasIndex && !Number.isInteger(r.index)) ||
      (hasRef && (typeof r.ref !== 'string' || !r.ref))
    )
      return reject('TARGET_REQUIRED', 'give exactly one of tool_use_id (a string), index (an integer) or ref (an alias or "last")')
    let target: TagTarget
    let row: SessionMessage | undefined
    if (hasId || hasRef) {
      const id = hasRef ? resolve(r.ref as string) : (r.tool_use_id as string)
      if (id === undefined) return reject('UNKNOWN_REF', `unknown ref ${r.ref} (${REF_HINT})`)
      target = { tool_use_id: id }
      if (!resolveTarget(rows, target)) return reject('TARGET_NOT_FOUND', `no completed tool call with id ${id}; refresh context_list`)
    } else {
      if (staleIndexes) return reject('INDEXES_STALE', STALE_INDEXES)
      const index = r.index as number
      row = rows[index]
      if (!row) return reject('TARGET_NOT_FOUND', `index out of range (0..${rows.length - 1}); refresh context_list`)
      target = { anchor: fingerprint(row), hint: index }
    }
    const at = tags.findIndex(t => sameTarget(t.target, target))
    if (r.op === 'remove') {
      if (at < 0) return reject('NO_TAG', 'that target has no tag')
      size -= bytes(tags[at]) + 1
      tags.splice(at, 1)
      out.removed++
      return
    }
    const kind = r.kind as TagKind
    if (kind === 'disposable' && (typeof r.note !== 'string' || !r.note.trim() || r.note.length > MAX_TEXT))
      return reject('NOTE_REQUIRED', `a disposable tag needs a note (1..${MAX_TEXT} chars) that replaces the target`)
    if (kind === 'disposable' && row && (row.role !== 'assistant' || row.toolUses.length > 0))
      return reject('BAD_TARGET', 'by index only an assistant text row can be disposable; tag a tool result by its tool_use_id')
    if (r.ttl_turns !== undefined && (kind !== 'review' || !isCount(r.ttl_turns, 1)))
      return reject('BAD_TTL', 'ttl_turns is an integer >= 1 and only for kind "review"')
    const tag: Tag = { kind, target, created_turn: reg.turn }
    if (kind === 'disposable') tag.note = r.note as string
    if (kind === 'review' && r.ttl_turns !== undefined) tag.ttl_turns = r.ttl_turns as number
    const delta = bytes(tag) + 1 - (at >= 0 ? bytes(tags[at]) + 1 : 0)
    if ((at < 0 && tags.length >= MAX_TAGS) || size + delta > MAX_REGISTRY_BYTES)
      return reject('TAGS_FULL', `the registry is full (${MAX_TAGS} tags or ${MAX_REGISTRY_BYTES} bytes); remove tags you no longer need`)
    if (at >= 0) tags[at] = tag
    else tags.push(tag)
    size += delta
    out.added++
  })
  out.registry = { ...reg, tags }
  return out
}

export type TagArgs = { agentId?: unknown; tags?: unknown }

// [SP_CTX_02_11] The caller runs it on the registry's serial chain.
// `storageDown` is why the storage is unavailable, if it is; `resolve` turns
// a ref into its tool_use_id ([SP_CTX_02_17]).
export async function contextTag(
  io: TagIO,
  args: TagArgs,
  storageDown?: string,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
): Promise<{ result: string } | { deny: string; code: TagDeny }> {
  if (args.agentId) return { code: 'DENIED_SUBAGENT', deny: "a subagent's context cannot be tagged; only the main conversation's." }
  if (!Array.isArray(args.tags) || args.tags.length === 0 || args.tags.length > MAX_TAGS)
    return { code: 'DENIED_EMPTY', deny: `"tags" must be a list of 1..${MAX_TAGS} requests.` }
  if (storageDown !== undefined) return { code: 'DENIED_STORAGE', deny: `storage unavailable: ${storageDown}` }
  const read = await io.readTags()
  if (read.state === 'unreadable')
    return { code: 'DENIED_REGISTRY_READ', deny: `the tag registry cannot be read (${read.reason}); it is left as it is.` }
  const out = applyTagRequests(read.value, await io.rows(), args.tags, resolve, staleIndexes)
  if (out.added || out.removed) {
    try {
      await io.writeTags(out.registry)
    } catch (err) {
      return { code: 'DENIED_REGISTRY_WRITE', deny: `could not save the tag registry: ${String(err)}` }
    }
  }
  return {
    result: [
      `Tagged ${out.added}, removed ${out.removed}; ${out.registry.tags.length} tag(s) in the registry.`,
      out.rejected.length ? `Rejected: ${out.rejected.map(x => x.reason).join('; ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

// [SP_CTX_02_12] What AutoTag reads from one appended row.
export type AppendFacts = { door: string; origin: string; tool?: string; ids: string[]; size: number; text: string }

type AppendEvent = {
  door: string
  origin: { kind: string; tool?: unknown }
  message: { content: readonly { type: string; [field: string]: unknown }[] }
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as { type?: unknown; text?: unknown }[]).map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
}

export function appendFacts(e: AppendEvent): AppendFacts {
  const blocks = e.message.content ?? []
  const text = blocks.flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n')
  const results = blocks.filter(b => b.type === 'tool_result')
  return {
    door: e.door,
    origin: e.origin.kind,
    tool: e.origin.kind === 'tool' && typeof e.origin.tool === 'string' ? e.origin.tool : undefined,
    ids: results.map(b => String(b.tool_use_id)),
    size: text.length + results.reduce((n, b) => n + blockText(b.content).length, 0),
    text,
  }
}

// [SP_CTX_02_12] Whether R1 asks for the stored row of this prompt.
export function wantsPromptRow(reg: TagRegistry, f: AppendFacts): boolean {
  return f.door === 'prompt' && HUMAN.includes(f.origin) && !reg.firstPromptPinned
}

// The row of a prompt just stored: the latest prompt row whose text matches,
// whitespace aside (the host joins text blocks its own way). -1 when none.
export function promptRow(rows: readonly SessionMessage[], text: string): number {
  const norm = (s: string) => s.replace(/\s+/g, '')
  const want = norm(text)
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!
    if (r.role !== 'user' || (r.toolResults ?? []).length) continue
    const have = norm(r.text)
    if (have === want || (want && have.includes(want))) return i
  }
  return -1
}

// [SP_CTX_01_11] R1..R3 for one appended row; a rule never replaces a tag a
// target already has. `prompt` is the stored row R1 pins. The same registry
// when nothing changed.
export function applyRules(reg: TagRegistry, f: AppendFacts, prompt?: { anchor: string; hint: number }): TagRegistry {
  const tags = [...reg.tags]
  let firstPromptPinned = reg.firstPromptPinned
  let size: number | undefined
  const add = (tag: Tag) => {
    if (tags.some(t => sameTarget(t.target, tag.target))) return
    const delta = bytes(tag) + 1
    size ??= bytes(reg)
    if (tags.length >= MAX_TAGS || size + delta > MAX_REGISTRY_BYTES) return
    tags.push(tag)
    size += delta
  }
  if (wantsPromptRow(reg, f) && prompt) {
    add({ kind: 'pin', target: { anchor: prompt.anchor, hint: prompt.hint }, created_turn: reg.turn })
    firstPromptPinned = true
  }
  if (f.door === 'tool-result' && f.tool !== undefined && !f.tool.startsWith(OWN_TOOLS)) {
    for (const id of f.ids) {
      if (f.size >= BIG_ROW) add({ kind: 'review', target: { tool_use_id: id }, created_turn: reg.turn })
      if (SEARCH_TOOLS.includes(f.tool)) add({ kind: 'review', target: { tool_use_id: id }, ttl_turns: SEARCH_TTL, created_turn: reg.turn })
    }
  }
  if (tags.length === reg.tags.length && firstPromptPinned === reg.firstPromptPinned) return reg
  return { ...reg, tags, firstPromptPinned }
}

// [SP_CTX_02_12] A row of plugin origin is no new row: a copy a plugin's
// compaction returned (stream-json passes each one through again) or a
// plugin's note. No rule sees it.
export function isPluginRow(f: AppendFacts): boolean {
  return f.origin === 'plugin'
}

// [SP_CTX_02_12] After the row is stored; the caller runs it on the
// registry's serial chain.
export async function autoTag(io: TagIO, f: AppendFacts): Promise<void> {
  if (isPluginRow(f)) return
  const read = await io.readTags()
  if (read.state === 'unreadable') return
  let prompt: { anchor: string; hint: number } | undefined
  if (wantsPromptRow(read.value, f)) {
    const rows = await io.rows()
    const at = promptRow(rows, f.text)
    if (at >= 0) prompt = { anchor: fingerprint(rows[at]!), hint: at }
  }
  const next = applyRules(read.value, f, prompt)
  if (next !== read.value) await io.writeTags(next)
}

// [SP_CTX_02_12] One more completed turn of the main conversation.
export async function countTurn(io: TagIO): Promise<void> {
  const read = await io.readTags()
  if (read.state !== 'unreadable') await io.writeTags({ ...read.value, turn: read.value.turn + 1 })
}

// [SP_CTX_02_13] The edits the disposable tags stand for, on `rows`.
export function tagEdits(rows: readonly SessionMessage[], reg: TagRegistry): Edit[] {
  const edits: Edit[] = []
  for (const tag of reg.tags) {
    if (tag.kind !== 'disposable' || tag.note === undefined) continue
    if ('tool_use_id' in tag.target) {
      if (resolveTarget(rows, tag.target)) edits.push({ op: 'summarize', tool_use_id: tag.target.tool_use_id, summary: tag.note })
    } else {
      const at = locate(rows, tag.target.anchor, tag.target.hint)
      if (at >= 0) edits.push({ op: 'rewrite', index: at, text: tag.note })
    }
  }
  return edits
}

// The text a queued tag edit replaces, in chars.
function replacedSize(rows: readonly SessionMessage[], edit: QueuedEdit): number {
  const t = touchedBy(rows, edit)
  if (!t) return 0
  if (edit.op === 'summarize') {
    const res = rows[t.rows[1]!]!
    return (res.toolResults ?? []).find(r => r.tool_use_id === edit.tool_use_id)?.text.length ?? 0
  }
  return rows[t.rows[0]!]!.text.length
}

// [SP_CTX_02_13] Queues the replacements of the disposable tags and returns
// the estimated tokens they free; 0 when nothing was queued. The caller runs
// it on the queue's serial chain.
export async function queueTagReplacements(io: TagIO): Promise<number> {
  const tags = await io.readTags()
  const read = await io.readQueue()
  if (tags.state === 'unreadable' || read.state === 'unreadable') return 0
  const rows = await io.rows()
  const { queued } = prepare(rows, tagEdits(rows, tags.value), undefined, pinnedTargets(rows, tags.value))
  const q = read.value
  if (!queued.length || q.edits.length + queued.length > MAX_QUEUE_EDITS) return 0
  const next: Queue = { ...q, edits: [...q.edits, ...queued], tagsOnly: q.edits.length === 0 ? true : q.tagsOnly }
  if (queueBytes(next) > MAX_QUEUE_BYTES) return 0
  try {
    await io.writeQueue(next)
  } catch {
    return 0
  }
  let chars = 0
  for (const edit of queued) chars += replacedSize(rows, edit) - (edit.op === 'summarize' ? edit.summary.length : edit.op === 'rewrite' ? edit.text.length : 0)
  return Math.max(0, Math.round(chars / 4))
}

// Whether a batch edit is the replacement a disposable tag stands for.
function tagEditKey(edit: QueuedEdit): string | undefined {
  if (edit.op === 'summarize') return `u:${edit.tool_use_id}\n${edit.summary}`
  if (edit.op === 'rewrite' && edit.anchors?.[0]) return `a:${edit.anchors[0]}\n${edit.text}`
  return undefined
}

function tagKey(tag: Tag): string | undefined {
  if (tag.kind !== 'disposable') return undefined
  return 'tool_use_id' in tag.target ? `u:${tag.target.tool_use_id}\n${tag.note}` : `a:${tag.target.anchor}\n${tag.note}`
}

// [SP_CTX_02_14] [SP_CTX_04_03] The registry after a batch: tags of targets
// an applied edit changed go, so do tags whose target is not in the new rows
// and disposable tags whose replacement was in the batch, applied or failed.
// Surviving row tags get their new index as hint. Pure.
export function rebindTags(
  reg: TagRegistry,
  before: readonly SessionMessage[],
  after: readonly SessionMessage[],
  applied: readonly QueuedEdit[],
  batch: readonly QueuedEdit[],
): TagRegistry {
  const editedRows = new Set<number>()
  const editedIds = new Set<string>()
  for (const edit of applied) {
    const t = touchedBy(before, edit)
    for (const i of t?.rows ?? []) editedRows.add(i)
    for (const id of t?.ids ?? []) editedIds.add(id)
  }
  const tried = new Set(batch.map(tagEditKey).filter(k => k !== undefined))
  const tags: Tag[] = []
  for (const tag of reg.tags) {
    const key = tagKey(tag)
    if (key !== undefined && tried.has(key)) continue
    if ('tool_use_id' in tag.target) {
      if (editedIds.has(tag.target.tool_use_id) || !resolveTarget(after, tag.target)) continue
      tags.push(tag)
      continue
    }
    const was = locate(before, tag.target.anchor, tag.target.hint)
    if (was >= 0 && editedRows.has(was)) continue
    const now = locate(after, tag.target.anchor, tag.target.hint)
    if (now < 0) continue
    tags.push({ ...tag, target: { anchor: tag.target.anchor, hint: now } })
  }
  return { ...reg, tags }
}

// What Nudge needs from the host; register.ts binds it to `$`.
export type NudgeIO = {
  ready: () => Promise<boolean>
  readQueue: () => Promise<Read<Queue>>
  // QueueTagReplacements on the queue's serial chain
  replace: () => Promise<number>
  reviews: () => Promise<number>
}

// [SP_CTX_02_09] [C_CTX_DEC_04] D: the next portion, chosen by the agent.
export function nudgeText(tokens: number, freed: number, reviews: number): string {
  return [
    `context-editor: the context is ~${Math.round(tokens / 1000)}k tokens.`,
    freed > 0 ? `Replacements from your disposable tags are queued (~${Math.round(freed / 1000)}k tokens freed when this turn ends), but that is not enough.` : '',
    reviews > 0 ? `${reviews} row(s) are tagged [review].` : '',
    `Attention degrades as context grows, so free the next portion, starting from the START of the conversation: call context_list (it lists the oldest rows first), then make ONE context_edit call that compresses what in the earliest spans is already processed or excess (tool outputs you have used, repeated reads, finished sub-tasks, dead ends; screenshots and documents you have looked at, by a description if the task allows), not the whole conversation. Usually leave unchanged the person's messages, loaded rules and skills that apply to the task, open questions, the decisions in force and the recent work; what to compress is your call. Then continue the task.`,
  ]
    .filter(Boolean)
    .join(' ')
}

// [SP_CTX_02_09] The reminder to add after a tool call, if any. `nudged` is
// the threshold level the model was last reminded at.
export async function nudge(io: NudgeIO, tokens: number, nudged: { level: number }): Promise<string | undefined> {
  const level = tokens < NUDGE_FIRST ? -1 : Math.floor((tokens - NUDGE_FIRST) / NUDGE_STEP)
  if (level <= nudged.level) {
    nudged.level = Math.min(nudged.level, level)
    return undefined
  }
  if (!(await io.ready())) return undefined
  const read = await io.readQueue()
  if (read.state === 'unreadable' || read.value.edits.length) return undefined
  nudged.level = level
  const freed = await io.replace().catch(() => 0)
  if (tokens - freed < NUDGE_FIRST + level * NUDGE_STEP) return undefined
  return nudgeText(tokens, freed, await io.reviews().catch(() => 0))
}
