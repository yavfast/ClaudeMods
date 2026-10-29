import type { SessionMessage } from 'claude-code'
import {
  describeEdit,
  fingerprint,
  indexRows,
  locate,
  locateSpan,
  MAX_QUEUE_EDITS,
  MAX_TEXT,
  mergedCallRow,
  NO_PINS,
  NO_REFS,
  oneLine,
  OWN_TOOLS,
  prepare,
  STALE_INDEXES,
  touchedBy,
  thinkingOnly,
  touchesPin,
  UNTRACKED_ROW,
  type Edit,
  type Pinned,
  type Produced,
  type QueuedEdit,
  type RefResolver,
  type RowIndex,
  type StateInput,
} from './edits'
import { MAX_QUEUE_BYTES, personRefusal, personTagRefusal, type Queue } from './queue'
import type { QueuedDelivery } from './deliveries'
import { badItemFields, type StateItem } from './state'
import { isTitleState, titleOp, type TitleError, type TitleState } from './title'
import {
  blockName,
  carrierRow,
  closeStage,
  endWaiting,
  markBefore,
  CALIB_MAX,
  CALIB_MIN,
  estimate,
  MAX_STAGE_NAME,
  normalizeLost,
  reportFailed,
  startOf,
  survivors,
  type ClosedBlock,
  type Replaced,
  type RowMark,
  type Stage,
  type Waiting,
} from './stages'
import { badNoteFields, type Note } from './notes'
import { bytes, isCount, jsonObject, storageRefusal, type Read } from './store'
import { documentRow, errorText, findToolResult, findToolUse, isBig, isReplacementText, isSearchTool, resultsOf, rowChars } from './rows'

// [SP_CTX_01_12]
export const MAX_TAGS = 1000
export const SEARCH_TTL = 3
// [SP_CTX_01_12] [SP_CTX_DEC_13] Rule R4: a change of a file makes the earlier reads of it stale.
export const WRITE_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit']
// [SP_CTX_01_10] The registry file stays readable by the host (4 MiB limit).
export const MAX_REGISTRY_BYTES = MAX_QUEUE_BYTES

// [SP_CTX_01_09] A range ({ anchor .. toAnchor }) only for `disposable`;
// `reason` only for `review`: absent on a tag written before phase 15.
export type TagKind = 'pin' | 'disposable' | 'review' | 'state'
// [SP_CTX_01_30] `superseded`: R6 (phase 43)
export type ReviewReason = 'big' | 'search' | 'stale' | 'superseded' | 'duplicate' | 'agent'
export const REVIEW_REASONS: readonly ReviewReason[] = ['big', 'search', 'stale', 'superseded', 'duplicate', 'agent']
export type RangeTarget = { anchor: string; hint: number; toAnchor: string; toHint: number }
export type TagTarget = { tool_use_id: string } | { anchor: string; hint: number } | RangeTarget
export type Tag = { kind: TagKind; target: TagTarget; note?: string; reason?: ReviewReason; ttl_turns?: number; created_turn: number }

export function isRange(target: TagTarget): target is RangeTarget {
  return 'toAnchor' in target
}

// [SP_CTX_01_10] [SP_CTX_01_18] `stage`: the open stage, one at most;
// `lastClosed`: the last closed block; `introduced`: the session intro was
// delivered in this session ([SP_CTX_02_27]); `reintroduce`: another
// compaction that stands took the guide, the next prompt carries INTRO_TEXT
// (phase 33, [SP_CTX_DEC_36]).
export type TagRegistry = {
  tags: Tag[]
  turn: number
  firstPromptPinned: boolean
  stage?: Stage
  lastClosed?: ClosedBlock
  // [SP_CTX_01_10] [SP_CTX_DEC_37] `lastClosed` waits for compression; only with `lastClosed`
  waiting?: Waiting
  introduced: boolean
  reintroduce?: boolean
  // [SP_CTX_02_68] PinDocument looked at row 0 of this session
  docChecked?: boolean
  // [SP_CTX_01_29] the items of the state slot and the number of the next
  // one (phase 44); absent: none yet, the next is 1
  items?: StateItem[]
  nextItem?: number
  // [SP_CTX_01_21] the agent's service notes, and the number of the next one
  notes: Note[]
  nextNote: number
  // [SP_CTX_02_34] the last calibration: chars of the conversation per token
  charsPerToken?: number
  // [SP_CTX_01_10] the last application with edits and the request size
  // before it; the telemetry measures the change once ([SP_CTX_02_28])
  lastApply?: { at: number; tokensBefore: number }
  // [SP_CTX_01_10] [SP_CTX_02_37] the soft hint's state
  hint?: HintState
  // [SP_CTX_01_33] the session title (phase 48)
  title?: TitleState
}

// [SP_CTX_01_10] TagRegistry.hint: `marks` — AliasRegistry.next at the last
// suggestion (or at the last turn check, which consumes the run); `tokens` —
// the request size at the last suggestion, absent before the first one;
// `proposed` — the tokens the last suggestion's batch would free (phase 23).
export type HintState = { tokens?: number; marks: number; proposed?: number }

export function isHintState(v: unknown): v is HintState {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const h = v as Record<string, unknown>
  return isCount(h.marks, 1) && (h.tokens === undefined || isCount(h.tokens, 0)) && (h.proposed === undefined || isCount(h.proposed, 0))
}

// [SP_CTX_01_33] The registry with `title` set, or without the field when
// undefined; the same object when nothing changes.
export function withTitle(reg: TagRegistry, title: TitleState | undefined): TagRegistry {
  if (title === reg.title) return reg
  const { title: _, ...rest } = reg
  return title ? { ...rest, title } : rest
}

export const EMPTY_REGISTRY: TagRegistry = { tags: [], turn: 0, firstPromptPinned: false, introduced: false, notes: [], nextNote: 1 }

const KINDS: readonly string[] = ['pin', 'disposable', 'review', 'state']

// [SP_CTX_01_09] Every field of one stored tag, by type and constraint.
function isTag(raw: unknown): raw is Tag {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const t = raw as Record<string, unknown>
  if (typeof t.kind !== 'string' || !KINDS.includes(t.kind)) return false
  const target = t.target as Record<string, unknown> | null | undefined
  if (typeof target !== 'object' || target === null) return false
  const byId = typeof target.tool_use_id === 'string' && target.tool_use_id !== '' && target.anchor === undefined && target.toAnchor === undefined
  const byRow = typeof target.anchor === 'string' && isCount(target.hint, 0) && target.tool_use_id === undefined
  const range = target.toAnchor !== undefined || target.toHint !== undefined
  if (!byId && !byRow) return false
  if (range && !(byRow && typeof target.toAnchor === 'string' && isCount(target.toHint, 0) && (target.hint as number) < target.toHint && t.kind === 'disposable')) return false
  // [SP_CTX_01_09] the state slot: one row of the agent's text, by anchor
  if (t.kind === 'state' && (!byRow || range)) return false
  if (t.note !== undefined && typeof t.note !== 'string') return false
  if (t.kind === 'disposable' && (typeof t.note !== 'string' || !t.note.trim() || t.note.length > MAX_TEXT)) return false
  if (t.ttl_turns !== undefined && (t.kind !== 'review' || !isCount(t.ttl_turns, 1))) return false
  if (t.reason !== undefined && (t.kind !== 'review' || !REVIEW_REASONS.includes(t.reason as ReviewReason))) return false
  return isCount(t.created_turn, 0)
}

// [SP_CTX_01_18] A RowMark or null: a fingerprint that holds an id or text.
function isMark(v: unknown): v is RowMark | null {
  if (v === null) return true
  if (typeof v !== 'object' || Array.isArray(v)) return false
  const m = v as Record<string, unknown>
  return typeof m.anchor === 'string' && !/^[a-z]+\|\|$/.test(m.anchor) && isCount(m.hint, 0)
}

function isStageName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= MAX_STAGE_NAME
}

function isStage(v: unknown): v is Stage {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const s = v as Record<string, unknown>
  return isStageName(s.name) && 'after' in s && isMark(s.after) && isCount(s.openedTurn, 0)
}

function isClosed(v: unknown): v is ClosedBlock {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const b = v as Record<string, unknown>
  return (b.name === undefined || isStageName(b.name)) && 'after' in b && isMark(b.after) && 'end' in b && isMark(b.end) && isCount(b.turn, 0)
}

// [SP_CTX_01_10] The registry without lastApply: a handoff or a compaction
// that is not the mod's apply leaves nothing to measure.
export function dropLastApply(reg: TagRegistry): TagRegistry {
  if (!reg.lastApply) return reg
  const { lastApply: _l, ...rest } = reg
  return rest as TagRegistry
}

function isLastApply(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const a = v as Record<string, unknown>
  return isCount(a.at, 0) && isCount(a.tokensBefore, 0)
}

// [SP_CTX_01_10] Read states as the queue's: a wrong field, tag, stage,
// closed block or note makes the whole file unreadable, never silently an empty registry.
export function parseRegistry(text: string): Read<TagRegistry> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  const reg = { ...EMPTY_REGISTRY, ...(raw.value as Partial<TagRegistry>) }
  const bad = [
    !Array.isArray(reg.tags) && 'tags',
    !isCount(reg.turn, 0) && 'turn',
    typeof reg.firstPromptPinned !== 'boolean' && 'firstPromptPinned',
    reg.stage !== undefined && !isStage(reg.stage) && 'stage',
    reg.lastClosed !== undefined && !isClosed(reg.lastClosed) && 'lastClosed',
    reg.waiting !== undefined && ((reg.waiting !== 'marked' && reg.waiting !== 'advised') || reg.lastClosed === undefined) && 'waiting',
    typeof reg.introduced !== 'boolean' && 'introduced',
    reg.reintroduce !== undefined && typeof reg.reintroduce !== 'boolean' && 'reintroduce',
    reg.docChecked !== undefined && typeof reg.docChecked !== 'boolean' && 'docChecked',
    badItemFields(reg.items, reg.nextItem),
    badNoteFields(reg.notes, reg.nextNote),
    reg.lastApply !== undefined && !isLastApply(reg.lastApply) && 'lastApply',
    reg.hint !== undefined && !isHintState(reg.hint) && 'hint',
    reg.title !== undefined && !isTitleState(reg.title) && 'title',
    reg.charsPerToken !== undefined && !(typeof reg.charsPerToken === 'number' && reg.charsPerToken >= CALIB_MIN && reg.charsPerToken <= CALIB_MAX) && 'charsPerToken',
  ].filter(Boolean)
  if (bad.length) return { state: 'unreadable', reason: `bad field(s): ${bad.join(', ')}` }
  const badTag = reg.tags.findIndex(t => !isTag(t))
  return badTag >= 0 ? { state: 'unreadable', reason: `bad tag ${badTag + 1}` } : { state: 'ok', value: reg }
}

// [SP_CTX_01_09] A row target and a range target are one target by the
// anchor of their first row.
function sameTarget(a: TagTarget, b: TagTarget): boolean {
  return 'tool_use_id' in a ? 'tool_use_id' in b && a.tool_use_id === b.tool_use_id : 'anchor' in b && a.anchor === b.anchor
}

// [SP_CTX_01_09] A review is active once its ttl has passed; other kinds always.
export function isActive(tag: Tag, turn: number): boolean {
  return tag.kind !== 'review' || tag.ttl_turns === undefined || turn - tag.created_turn >= tag.ttl_turns
}

// The rows a tag's target is on now: both rows of a pair, the located row,
// or every row of a range whose ends are both found. `ix`: the index of
// `rows`, built once by a caller that resolves many targets on them.
export function resolveTarget(rows: readonly SessionMessage[], target: TagTarget, ix: RowIndex = indexRows(rows)): number[] | undefined {
  if ('tool_use_id' in target) return touchedBy(rows, { op: 'drop', tool_use_id: target.tool_use_id }, ix)?.rows
  if (!isRange(target)) {
    const at = locate(rows, target.anchor, target.hint, ix)
    return at < 0 ? undefined : [at]
  }
  // [SP_CTX_02_04] LocateSpan: a thinking-only first row is found from the last
  const span = locateSpan(rows, target, { anchor: target.toAnchor, hint: target.toHint }, ix)
  return !span || span.to <= span.from ? undefined : Array.from({ length: span.to - span.from + 1 }, (_, k) => span.from + k)
}

// [SP_CTX_01_09] The row of the state slot on `rows`: undefined without a
// state tag, -1 when its row is not found.
export function stateRow(rows: readonly SessionMessage[], reg: TagRegistry, ix?: RowIndex): number | undefined {
  const tag = reg.tags.find(t => t.kind === 'state')
  if (!tag || !('anchor' in tag.target)) return undefined
  return locate(rows, tag.target.anchor, tag.target.hint, ix)
}

// [SP_CTX_02_03] The pinned targets on `rows`, as prepare takes them, and the
// row of the state slot: ScreenPinned and PrepareEdits read both.
export function pinnedTargets(rows: readonly SessionMessage[], reg: TagRegistry, ix: RowIndex = indexRows(rows)): Pinned {
  const ids = new Set<string>()
  const at = new Set<number>()
  for (const tag of reg.tags) {
    if (tag.kind !== 'pin') continue
    if ('tool_use_id' in tag.target) ids.add(tag.target.tool_use_id)
    else for (const i of resolveTarget(rows, tag.target, ix) ?? []) at.add(i)
  }
  const state = stateRow(rows, reg, ix)
  // [SP_CTX_02_67] the slot's items: what a state edit's changes name
  const items = reg.items?.length ? { items: reg.items } : {}
  return state !== undefined && state >= 0 ? { ids, rows: at, state, ...items } : { ids, rows: at, ...items }
}

// [SP_CTX_02_67] What run state starts from: the registry's items, the next
// number and the turn.
export function stateInput(reg: TagRegistry): StateInput {
  return { items: reg.items ?? [], nextItem: reg.nextItem ?? 1, turn: reg.turn }
}

// [SP_CTX_02_03] The pinned targets on `rows` as the registry read gives
// them; none while it is unreadable, which HandleCompaction then reports
// for every edit.
export function pinsFrom(read: Read<TagRegistry>, rows: readonly SessionMessage[]): Pinned {
  return read.state === 'unreadable' ? NO_PINS : pinnedTargets(rows, read.value)
}

// [SP_CTX_02_01] One tag's label: `[pin]`, `[state]`, `[disposable: "<40>"]`,
// `[disposable #a..#b: "<40>"]` for a range, `[review: <reason>]`, or
// `[review]` for one written before phase 15.
function tagLabel(tag: Tag, at: readonly number[]): string {
  if (tag.kind === 'disposable') {
    const note = oneLine(tag.note ?? '', 40)
    return isRange(tag.target) ? `[disposable #${at[0]}..#${at.at(-1)}: "${note}"]` : `[disposable: "${note}"]`
  }
  if (tag.kind === 'review') return tag.reason ? `[review: ${tag.reason}]` : '[review]'
  return `[${tag.kind}]`
}

// [SP_CTX_02_01] Tag labels by row index, a review only while active. A
// pair's tag shows on both of its rows, a range's on its first row.
export function tagLabels(rows: readonly SessionMessage[], reg: TagRegistry): Map<number, string[]> {
  const labels = new Map<number, string[]>()
  const ix = indexRows(rows)
  for (const tag of reg.tags) {
    if (!isActive(tag, reg.turn)) continue
    const at = resolveTarget(rows, tag.target, ix)
    if (!at) continue
    const label = tagLabel(tag, at)
    for (const i of isRange(tag.target) ? [at[0]!] : at) labels.set(i, [...(labels.get(i) ?? []), label])
  }
  return labels
}

// [SP_CTX_01_20] The group of a review tag: its reason, or `none` for one
// written before phase 15.
export type ReviewGroup = ReviewReason | 'none'
export const REVIEW_GROUPS: readonly ReviewGroup[] = [...REVIEW_REASONS, 'none']

export function reviewGroup(tag: Tag): ReviewGroup {
  return tag.reason ?? 'none'
}

// [SP_CTX_02_28] Active review tags whose targets are still there, by group,
// with the first row of each target, in row order.
export function activeReviews(rows: readonly SessionMessage[], reg: TagRegistry, ix: RowIndex = indexRows(rows)): Map<ReviewGroup, number[]> {
  const out = new Map<ReviewGroup, number[]>()
  for (const t of reg.tags) {
    if (t.kind !== 'review' || !isActive(t, reg.turn)) continue
    const at = resolveTarget(rows, t.target, ix)
    if (!at) continue
    const g = reviewGroup(t)
    out.set(g, [...(out.get(g) ?? []), Math.min(...at)])
  }
  for (const list of out.values()) list.sort((x, y) => x - y)
  return out
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
  // context_tag: runs its read-modify-write of the registry on the
  // registry's serial chain (default: as it is)
  onRegistry?: <T>(work: () => Promise<T>) => Promise<T>
  // context_tag: QueueTagReplacements on the queue's serial chain, after the
  // registry is written (default: queueTagReplacements on this io)
  replace?: () => Promise<Replaced>
  // context_tag: BlockReport of one close, or of the block that waited
  // (`waiting`, [SP_CTX_DEC_37]) ([SP_CTX_02_29]); a throw is REPORT_FAILED
  report?: (block: ClosedBlock, replaced?: Replaced, waiting?: boolean) => Promise<string>
  // context_tag: the host's deliveries not yet rows, for the PERSON_TAG refusal
  // ([SP_CTX_01_22]); none when absent or unreadable
  deliveries?: () => Promise<readonly QueuedDelivery[]>
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
  | 'BAD_RANGE'
  | 'BAD_TTL'
  | 'TAGS_FULL'
  | 'NO_TAG'
  | 'STAGE_NAME_REQUIRED'
  | 'STAGE_FIELDS'
  | 'NO_STAGE'
  | 'PERSON_TAG'
  | TitleError

// [SP_CTX_02_11] A stage event of the batch, in request order: an open with
// its text, or a close with its block.
export type StageEvent = { open: string } | { close: ClosedBlock }

export type TagOutcome = {
  registry: TagRegistry
  added: number
  removed: number
  rejected: { code: TagError; reason: string }[]
  events: StageEvent[]
  // [SP_CTX_02_11] lines of the result besides: the state slot moved,
  // the PERSON_TAG refusals of the disposable tags requested
  lines: string[]
  // the registry differs from the one read (tags, stages, a lost mark nulled)
  changed: boolean
  // [SP_CTX_DEC_37] the block that waited for compression until the first
  // accepted open or close of this call
  waited?: ClosedBlock
}

const OPEN_FIELDS = ['op', 'stage', 'index']

// [SP_CTX_02_11] Applies the requests in order to the registry on the rows as
// they are now; a rejected request leaves the rest of the batch going. A `ref`
// is resolved to its tool_use_id here ([SP_CTX_02_17]). `carrier`: the row
// that holds this call (len(rows) while it is not written). Pure.
export function applyTagRequests(
  reg: TagRegistry,
  rows: readonly SessionMessage[],
  raws: readonly unknown[],
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
  carrier = rows.length,
  delivered: readonly QueuedDelivery[] = [],
): TagOutcome {
  const tags = [...reg.tags]
  let size = bytes({ ...reg, tags })
  const ix = indexRows(rows)
  // [SP_CTX_01_18] a lost start of the stage or of the last block becomes null
  let stages: TagRegistry = normalizeLost(reg, rows)
  const out: TagOutcome = { registry: reg, added: 0, removed: 0, rejected: [], events: [], lines: [], changed: stages !== reg }
  // [SP_CTX_DEC_37] the agent moves on: the waiting block ends before CloseStage replaces lastClosed
  const moveOn = () => {
    const ended = endWaiting(stages)
    if (!ended) return
    stages = ended.registry
    out.waited = ended.block
    out.changed = true
  }
  raws.forEach((raw, n) => {
    const reject = (code: TagError, why: string) => void out.rejected.push({ code, reason: `tag ${n + 1}: ${why} (${code})` })
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    if (r.op !== 'add' && r.op !== 'remove' && r.op !== 'open' && r.op !== 'close' && r.op !== 'title')
      return reject('BAD_OP', `op must be "add", "remove", "open", "close" or "title"`)
    // [SP_CTX_02_70] TitleOp: the title the mod gives the session when this turn ends
    if (r.op === 'title') {
      const t = titleOp(stages.title, r)
      if (t.changed) {
        stages = withTitle(stages, t.title)
        out.changed = true
      }
      out.lines.push(...t.lines)
      if (t.error) reject(t.error.code, t.error.why)
      return
    }
    if (r.op === 'close') {
      if (Object.keys(r).some(k => k !== 'op')) return reject('STAGE_FIELDS', 'close takes no field but "op"')
      if (!stages.stage)
        return reject('NO_STAGE', 'no stage is open; to close a block you did not open, give {"op":"open","stage":"<name>","index":<its first row>} and {"op":"close"} in one call')
      moveOn()
      const closed = closeStage(stages, rows, carrier)!
      stages = closed.registry
      out.events.push({ close: closed.block })
      out.changed = true
      return
    }
    if (r.op === 'open') {
      if (Object.keys(r).some(k => !OPEN_FIELDS.includes(k))) return reject('STAGE_FIELDS', 'open takes only "stage" and "index"')
      if (!isStageName(r.stage)) return reject('STAGE_NAME_REQUIRED', `open needs "stage", a name of 1..${MAX_STAGE_NAME} chars`)
      let after: RowMark | null
      if (r.index !== undefined) {
        if (staleIndexes) return reject('INDEXES_STALE', STALE_INDEXES)
        if (!Number.isInteger(r.index) || !rows[r.index as number]) return reject('TARGET_NOT_FOUND', `index out of range (0..${rows.length - 1}); refresh context_list`)
        after = markBefore(rows, r.index as number)
      } else after = markBefore(rows, carrier)
      moveOn()
      // an open stage closes first: its block ends before the row of this call
      const closed = closeStage(stages, rows, carrier)
      if (closed) {
        stages = closed.registry
        out.events.push({ close: closed.block })
      }
      const name = (r.stage as string).trim()
      stages = { ...stages, stage: { name, after, openedTurn: reg.turn } }
      out.events.push({ open: `Stage "${name}" opened; its block starts at #${startOf(rows, after)}.` })
      out.changed = true
      return
    }
    if (r.op === 'add' && (typeof r.kind !== 'string' || !KINDS.includes(r.kind)))
      return reject('KIND_REQUIRED', 'kind must be "pin", "disposable", "review" or "state"')
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
    // [SP_CTX_02_11] a range: only an added disposable tag by index
    if (r.to !== undefined && (r.op !== 'add' || r.kind !== 'disposable' || !hasIndex))
      return reject('BAD_RANGE', '"to" goes only with {"op":"add","kind":"disposable","index":<first row>}')
    let target: TagTarget
    let row: SessionMessage | undefined
    if (hasId || hasRef) {
      let id = r.tool_use_id as string
      if (hasRef) {
        // [SP_CTX_02_17] "last" resolves on these rows and names its call
        const got = resolve(r.ref as string, rows)
        if ('error' in got) return reject('UNKNOWN_REF', got.error)
        if (got.line && !out.lines.includes(got.line)) out.lines.push(got.line)
        id = got.id
      }
      target = { tool_use_id: id }
      if (!resolveTarget(rows, target, ix)) return reject('TARGET_NOT_FOUND', `no completed tool call with id ${id}; refresh context_list`)
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
    if (r.to !== undefined) {
      const from = r.index as number
      const to = r.to
      if (!Number.isInteger(to) || (to as number) <= from || (to as number) > rows.length - 1)
        return reject('BAD_RANGE', `"to" is the last row of the range: an integer in ${from + 1}..${rows.length - 1}`)
      const span = { op: 'collapse' as const, from_index: from, to_index: to as number, summary: '-' }
      const split = prepare(rows, [span]).errors[0]
      if (split) return reject('BAD_RANGE', split.replace(/^collapse #\d+\.\.#\d+: /, ''))
      const guarded = pinnedTargets(rows, { ...reg, tags }, ix)
      if (touchesPin(rows, span, guarded) || (guarded.state !== undefined && guarded.state >= from && guarded.state <= (to as number)))
        return reject('BAD_RANGE', 'the range holds a row or a call tagged pin or state')
      target = { ...(target as { anchor: string; hint: number }), toAnchor: fingerprint(rows[to as number]!), toHint: to as number }
    } else if (kind === 'disposable' && row && (row.role !== 'assistant' || row.toolUses.length > 0))
      return reject('BAD_TARGET', 'by index without "to" only an assistant text row can be disposable; tag a tool result by its tool_use_id, a span by "index" and "to"')
    // [SP_CTX_01_09] the state slot changes only by a rewrite of its row or the state op: no disposable replaces it
    else if (kind === 'disposable' && row && pinnedTargets(rows, { ...reg, tags }, ix).state === r.index)
      return reject('BAD_TARGET', 'that row holds the state slot; change it by a rewrite of that row, or by the state op once it has items, or remove its state tag first')
    if (kind === 'state' && (!row || row.role !== 'assistant' || row.toolUses.length > 0 || !row.text.trim()))
      return reject('BAD_TARGET', 'the state slot is one of your own assistant text rows, by "index"')
    if (r.ttl_turns !== undefined && (kind !== 'review' || !isCount(r.ttl_turns, 1)))
      return reject('BAD_TTL', 'ttl_turns is an integer >= 1 and only for kind "review"')
    // [SP_CTX_02_11] a thinking-only row has an anchor Locate cannot tell
    // apart: no tag on it alone (a range may start there, LocateSpan)
    if (row && r.to === undefined && thinkingOnly(row)) return reject('TARGET_NOT_FOUND', UNTRACKED_ROW(r.index as number))
    // [SP_CTX_02_58] PERSON_TAG: no disposable tag over the person's words
    if (kind === 'disposable') {
      const no = isRange(target)
        ? personTagRefusal(rows, { from: target.hint, to: target.toHint }, delivered)
        : 'tool_use_id' in target
          ? personTagRefusal(rows, { tool_use_id: target.tool_use_id }, delivered)
          : undefined
      if (no) return reject('PERSON_TAG', no)
    }
    const tag: Tag = { kind, target, created_turn: reg.turn }
    if (kind === 'disposable') tag.note = r.note as string
    if (kind === 'review') tag.reason = 'agent'
    if (kind === 'review' && r.ttl_turns !== undefined) tag.ttl_turns = r.ttl_turns as number
    // [SP_CTX_01_09] one state slot: a new one replaces the old wherever it stands
    const old = kind === 'state' ? tags.findIndex((t, k) => t.kind === 'state' && k !== at) : -1
    const freed = old >= 0 ? bytes(tags[old]) + 1 : 0
    const delta = bytes(tag) + 1 - (at >= 0 ? bytes(tags[at]) + 1 : 0) - freed
    if ((at < 0 && old < 0 && tags.length >= MAX_TAGS) || size + delta > MAX_REGISTRY_BYTES)
      return reject('TAGS_FULL', `the registry is full (${MAX_TAGS} tags or ${MAX_REGISTRY_BYTES} bytes); remove tags you no longer need`)
    const oldTag = old >= 0 ? tags[old]! : undefined
    if (oldTag) {
      const was = 'anchor' in oldTag.target ? locate(rows, oldTag.target.anchor, oldTag.target.hint, ix) : -1
      out.lines.push(was >= 0 ? `The state slot moved from #${was} to #${r.index}.` : `The state slot moved to #${r.index}.`)
    }
    if (at >= 0) tags[at] = tag
    else tags.push(tag)
    if (oldTag) tags.splice(tags.indexOf(oldTag), 1)
    size += delta
    out.added++
  })
  if (out.added || out.removed) out.changed = true
  out.registry = { ...stages, tags }
  return out
}

export type TagArgs = { agentId?: unknown; tags?: unknown }

// [SP_CTX_02_11] `storageDown` is why the storage is unavailable, if it is;
// `resolve` turns a ref into its tool_use_id ([SP_CTX_02_17]); `callId` is
// this call's own tool_use_id, which finds the row that carries it. The
// registry is read, changed and written on the registry's chain; only once it
// is written, the replacements of the disposable tags are queued (once, after
// any number of closes) and each close gets its report.
export async function contextTag(
  io: TagIO,
  args: TagArgs,
  storageDown?: string,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
  callId?: string,
): Promise<{ result: string } | { deny: string; code: TagDeny }> {
  if (args.agentId) return { code: 'DENIED_SUBAGENT', deny: "a subagent's context cannot be tagged; only the main conversation's." }
  if (!Array.isArray(args.tags) || args.tags.length === 0 || args.tags.length > MAX_TAGS)
    return { code: 'DENIED_EMPTY', deny: `"tags" must be a list of 1..${MAX_TAGS} requests.` }
  if (storageDown !== undefined) return { code: 'DENIED_STORAGE', deny: storageRefusal(storageDown) }
  const raws = args.tags
  const onRegistry = io.onRegistry ?? (<T>(work: () => Promise<T>) => work())
  const step = await onRegistry(async (): Promise<TagOutcome | { deny: string; code: TagDeny }> => {
    const read = await io.readTags()
    if (read.state === 'unreadable')
      return { code: 'DENIED_REGISTRY_READ', deny: `the tag registry cannot be read (${read.reason}); it is left as it is.` }
    const rows = await io.rows()
    const delivered = (await io.deliveries?.().catch(() => undefined)) ?? []
    const out = applyTagRequests(read.value, rows, raws, resolve, staleIndexes, carrierRow(rows, callId), delivered)
    if (out.changed) {
      try {
        await io.writeTags(out.registry)
      } catch (err) {
        // no stage opened or closed, no replacement queued
        return { code: 'DENIED_REGISTRY_WRITE', deny: `could not save the tag registry: ${String(err)}` }
      }
    }
    return out
  })
  if ('deny' in step) return step
  const closes = step.events.flatMap(e => ('close' in e ? [e.close] : []))
  let replaced: Replaced | undefined
  // [SP_CTX_02_13] a close by the tool, or the end of the waiting block
  if (closes.length || step.waited) replaced = await (io.replace ?? (() => queueTagReplacements(io)))().catch(() => undefined)
  const texts: string[] = []
  // [SP_CTX_DEC_37] the block that waited comes first, with indexes; the replacements go with it when no close takes them
  if (step.waited) {
    const waited = step.waited
    if (!io.report) texts.push(`${blockName(waited)} no longer waits for compression.`)
    else
      try {
        texts.push(await io.report(waited, closes.length ? undefined : replaced, true))
      } catch (err) {
        texts.push(`${blockName(waited)} no longer waits for compression; its report failed: ${errorText(err)}; call context_list`)
      }
  }
  let n = 0
  for (const e of step.events) {
    if ('open' in e) {
      texts.push(e.open)
      continue
    }
    n++
    const last = n === closes.length
    if (!io.report) {
      texts.push(`${e.close.name !== undefined ? `Stage "${e.close.name}"` : 'The block'} closed.`)
      continue
    }
    try {
      texts.push(await io.report(e.close, last ? replaced : undefined))
    } catch (err) {
      // REPORT_FAILED: the stage is closed and the registry written
      texts.push(reportFailed(e.close, err))
    }
  }
  return {
    result: [
      `Tagged ${step.added}, removed ${step.removed}; ${step.registry.tags.length} tag(s) in the registry.`,
      step.rejected.length ? `Rejected: ${step.rejected.map(x => x.reason).join('; ')}.` : '',
      ...step.lines,
      ...texts,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

// [SP_CTX_02_12] What AutoTag reads from one appended row; `results`: the
// text of each tool result in it, for R5, and whether the block is an error
// (`is_error: true`; R3 skips it, phase 31, CF-52).
export type AppendFacts = { door: string; origin: string; tool?: string; ids: string[]; size: number; text: string; results: { id: string; text: string; isError?: boolean }[] }

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
  const results = blocks.filter(b => b.type === 'tool_result').map(b => ({ id: String(b.tool_use_id), text: blockText(b.content), ...(b.is_error === true ? { isError: true } : {}) }))
  return {
    door: e.door,
    origin: e.origin.kind,
    tool: e.origin.kind === 'tool' && typeof e.origin.tool === 'string' ? e.origin.tool : undefined,
    ids: results.map(r => r.id),
    size: text.length + results.reduce((n, r) => n + r.text.length, 0),
    text,
    results,
  }
}

// Adds tags to a registry within the TAGS_FULL limits ([SP_CTX_02_11]);
// `replace` says which tag already on the target the new one may replace.
function tagAdder(reg: TagRegistry) {
  const tags = [...reg.tags]
  let size: number | undefined
  let changed = false
  return {
    tags,
    changed: () => changed,
    put(tag: Tag, replace: (old: Tag) => boolean = () => false): void {
      const at = tags.findIndex(t => sameTarget(t.target, tag.target))
      if (at >= 0 && !replace(tags[at]!)) return
      size ??= bytes(reg)
      const delta = bytes(tag) + 1 - (at >= 0 ? bytes(tags[at]) + 1 : 0)
      if ((at < 0 && tags.length >= MAX_TAGS) || size + delta > MAX_REGISTRY_BYTES) return
      if (at >= 0) tags[at] = tag
      else tags.push(tag)
      size += delta
      changed = true
    },
  }
}

// [SP_CTX_01_11] R2, R3 for one appended row; a rule never replaces a tag a
// target already has. The same registry when nothing changed. [SP_CTX_02_68]
// R1 is gone: no rule pins the person's first prompt (C_CTX_DEC_38).
export function applyRules(reg: TagRegistry, f: AppendFacts): TagRegistry {
  const add = tagAdder(reg)
  if (f.door === 'tool-result' && f.tool !== undefined && !f.tool.startsWith(OWN_TOOLS)) {
    // [SP_CTX_01_11] R3 only for a result that is no error (phase 31, CF-52); R2 by the row's size
    const failed = new Set(f.results.filter(r => r.isError).map(r => r.id))
    for (const id of f.ids) {
      if (isBig(f.size)) add.put({ kind: 'review', reason: 'big', target: { tool_use_id: id }, created_turn: reg.turn })
      if (isSearchTool(f.tool) && !failed.has(id)) add.put({ kind: 'review', reason: 'search', target: { tool_use_id: id }, ttl_turns: SEARCH_TTL, created_turn: reg.turn })
    }
  }
  if (!add.changed()) return reg
  return { ...reg, tags: add.tags }
}

// A review tag a rule may turn into another reason.
function reviewOf(...reasons: (ReviewReason | undefined)[]) {
  return (old: Tag) => old.kind === 'review' && reasons.includes(old.reason)
}

type Call = { tool: string; input: Record<string, unknown> }

// Every call of `rows` by its tool_use_id, read once.
function callsOf(rows: readonly SessionMessage[]): Map<string, Call> {
  const calls = new Map<string, Call>()
  for (const r of rows)
    for (const u of r.toolUses) calls.set(u.tool_use_id, { tool: u.tool, input: (typeof u.input === 'object' && u.input !== null ? u.input : {}) as Record<string, unknown> })
  return calls
}

const READ_FIELDS = ['file_path', 'offset', 'limit', 'pages']

// [SP_CTX_01_11] R5 (a) for the results of one appended row: each result of
// BIG_ROW chars or more marks the earlier pairs of the current conversation
// with the same text, or (a Read) with the same file_path, offset, limit and
// pages, `review` `duplicate`; it replaces a review `big` or `search` only.
// An earlier result already compressed (isReplacementText) is no
// duplicate. The tool is the one of each result's own call. Pure.
export function markDuplicates(reg: TagRegistry, rows: readonly SessionMessage[], results: readonly { id: string; text: string }[]): TagRegistry {
  const big = results.filter(r => isBig(r.text.length))
  if (!big.length) return reg
  const add = tagAdder(reg)
  const calls = callsOf(rows)
  const ix = indexRows(rows)
  for (const r of big) {
    const call = calls.get(r.id)
    if (!call || call.tool.startsWith(OWN_TOOLS)) continue
    const at = ix.resultAt(r.id)
    const stop = at < 0 ? rows.length : at
    const sameRead = (id: string) => {
      const earlier = calls.get(id)
      return call.tool === 'Read' && earlier?.tool === 'Read' && READ_FIELDS.every(k => JSON.stringify(earlier.input[k]) === JSON.stringify(call.input[k]))
    }
    for (let i = 0; i < stop; i++)
      for (const t of resultsOf(rows[i]!)) {
        if (t.tool_use_id === r.id || isReplacementText(t.text)) continue
        if (t.text !== r.text && !sameRead(t.tool_use_id)) continue
        if (!calls.has(t.tool_use_id)) continue
        add.put({ kind: 'review', reason: 'duplicate', target: { tool_use_id: t.tool_use_id }, created_turn: reg.turn }, reviewOf('big', 'search'))
      }
  }
  return add.changed() ? { ...reg, tags: add.tags } : reg
}

// [SP_CTX_01_11] R4: each Read pair of `path` whose call row stands before the
// row of the write call `writeId` (none yet: every pair) becomes `review`
// `stale`, without a term, replacing a review of any reason; other tags stay. Pure.
export function markStale(reg: TagRegistry, rows: readonly SessionMessage[], path: string, writeId: string): TagRegistry {
  const add = tagAdder(reg)
  const ix = indexRows(rows)
  const w = ix.useAt(writeId)
  const stop = w < 0 ? rows.length : w
  for (let i = 0; i < stop; i++)
    for (const u of rows[i]!.toolUses) {
      if (u.tool !== 'Read' || (u.input as { file_path?: unknown } | undefined)?.file_path !== path) continue
      if (!resolveTarget(rows, { tool_use_id: u.tool_use_id }, ix)) continue
      // a stale review stays as it is: a repeated write rewrites nothing
      add.put({ kind: 'review', reason: 'stale', target: { tool_use_id: u.tool_use_id }, created_turn: reg.turn }, old => old.kind === 'review' && old.reason !== 'stale')
    }
  return add.changed() ? { ...reg, tags: add.tags } : reg
}

// [SP_CTX_02_65] The lines of a Read output (cat -n form) by number.
export function numberedLines(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\t(.*)$/.exec(line)
    if (m) out.set(Number(m[1]), m[2]!)
  }
  return out
}

// [SP_CTX_02_65] Changed, over the numbered lines only: the same range with
// other lines (another number set or text), or a line number both outputs hold
// with different text. An output without numbered lines (the host's "File
// unchanged since last read" stub, an error) says nothing, nor do ranges with
// no common line, nor text around the lines (a reminder the host adds). Pure.
export function changedRead(a: string, b: string, same: boolean): boolean {
  const first = numberedLines(a)
  const second = numberedLines(b)
  if (!first.size || !second.size) return false
  if (same && first.size !== second.size) return true
  for (const [n, text] of second) {
    const old = first.get(n)
    if (old === undefined ? same : old !== text) return true
  }
  return false
}

const RANGE_FIELDS = ['offset', 'limit', 'pages']

// [SP_CTX_02_65] R6: each earlier Read pair of `path` (its call row before the
// row of `readId`; that row not found: none) whose output `changedRead` says differs
// from `text`, the output of `readId` read with `input`, becomes `review`
// `superseded`. It replaces a review `big`, `search` or `duplicate` only, so
// `stale`, `agent`, `pin`, `disposable` and `state` stay. A compressed or
// failed earlier result is skipped. Pure.
export function markSuperseded(reg: TagRegistry, rows: readonly SessionMessage[], path: string, readId: string, input: Record<string, unknown>, text: string): TagRegistry {
  const add = tagAdder(reg)
  const ix = indexRows(rows)
  // the call row of `readId` not found: no earlier pair is known
  const stop = ix.useAt(readId)
  const replaceable = reviewOf('big', 'search', 'duplicate')
  for (let i = 0; i < stop; i++)
    for (const u of rows[i]!.toolUses) {
      const earlier = (u.input ?? {}) as Record<string, unknown>
      if (u.tool !== 'Read' || u.tool_use_id === readId || earlier.file_path !== path) continue
      const at = ix.resultAt(u.tool_use_id)
      const res = at < 0 ? undefined : resultsOf(rows[at]!).find(t => t.tool_use_id === u.tool_use_id)
      if (!res || res.isError || isReplacementText(res.text)) continue
      const tag = reg.tags.find(t => sameTarget(t.target, { tool_use_id: u.tool_use_id }))
      if (tag && !replaceable(tag)) continue
      const same = RANGE_FIELDS.every(k => JSON.stringify(earlier[k]) === JSON.stringify(input[k]))
      if (!changedRead(res.text, text, same)) continue
      add.put({ kind: 'review', reason: 'superseded', target: { tool_use_id: u.tool_use_id }, created_turn: reg.turn }, replaceable)
    }
  return add.changed() ? { ...reg, tags: add.tags } : reg
}

// [SP_CTX_02_65] ReadPaths: whether `path` was read before by this module
// instance; the first read only records it.
export function seenRead(paths: Set<string>, path: string): boolean {
  if (paths.has(path)) return true
  paths.add(path)
  return false
}

// [SP_CTX_02_65] R6 after a Read that succeeded; the caller runs it on the
// registry's chain, in the background.
export async function supersededReads(io: Pick<TagIO, 'rows' | 'readTags' | 'writeTags'>, path: string, readId: string, input: Record<string, unknown>, text: string): Promise<void> {
  const read = await io.readTags()
  if (read.state === 'unreadable') return
  const next = markSuperseded(read.value, await io.rows(), path, readId, input, text)
  if (next !== read.value) await io.writeTags(next)
}

// [SP_CTX_02_16] What follows a finished call of the main loop, not denied,
// in the background: a write tool without error (R4 and JournalChanged on its
// path: `file_path`, or `notebook_path` for NotebookEdit), a Read without
// error (JournalReread), or nothing. Pure.
export function callFollowUp(tool: string, input: Record<string, unknown>, isError: boolean): { write: string } | { read: string } | undefined {
  if (isError) return undefined
  const path = tool === 'NotebookEdit' ? input.notebook_path : input.file_path
  if (typeof path !== 'string' || !path) return undefined
  if (WRITE_TOOLS.includes(tool)) return { write: path }
  return tool === 'Read' ? { read: path } : undefined
}

// [SP_CTX_02_16] R4 after a write call that succeeded; the caller runs it on
// the registry's chain, in the background.
export async function staleReads(io: Pick<TagIO, 'rows' | 'readTags' | 'writeTags'>, path: string, writeId: string): Promise<void> {
  const read = await io.readTags()
  if (read.state === 'unreadable') return
  const next = markStale(read.value, await io.rows(), path, writeId)
  if (next !== read.value) await io.writeTags(next)
}

// [SP_CTX_02_12] A row of plugin origin is no new row: a copy a plugin's
// compaction returned or a plugin's note. No rule sees it.
export function isPluginRow(f: AppendFacts): boolean {
  return f.origin === 'plugin'
}

// [SP_CTX_02_12] A tool result row a compaction just returned: in stream-json
// each returned row passes the append event again, and a result row comes
// with the origin of its tool, not the plugin's (probe of phase 15). `copied`:
// the result ids of the rows the last compaction returned, until a turn starts.
export function isCompactionCopy(f: AppendFacts, copied: ReadonlySet<string>): boolean {
  return f.door === 'tool-result' && f.ids.length > 0 && f.ids.every(id => copied.has(id))
}

// [SP_CTX_02_12] The result ids of the rows a compaction returned.
export function resultIds(rows: readonly SessionMessage[]): string[] {
  return rows.flatMap(r => resultsOf(r).map(t => t.tool_use_id))
}

// [SP_CTX_02_12] [PL_AUD_CTX_P11] Whether a rule may change the registry for
// this row, from the row alone (CF-22): a result of another tool that is big or of a search tool
// (R2, R3), or a big result text (R5 (a)). Not for a plugin's row or a
// compaction's copy. Without it AutoTag neither waits for the registry's chain
// nor reads the registry. Pure.
export function autoTagNeeded(f: AppendFacts, copy = false): boolean {
  if (isPluginRow(f) || copy) return false
  if (f.door !== 'tool-result') return false
  // [SP_CTX_02_12] phase 31 (CF-52): a search tool's error is no search output
  if (f.tool !== undefined && !f.tool.startsWith(OWN_TOOLS) && f.ids.length && (isBig(f.size) || (isSearchTool(f.tool) && f.results.some(r => !r.isError)))) return true
  return f.results.some(r => isBig(r.text.length))
}

// [SP_CTX_02_12] [SP_CTX_02_35] What a row's append needs from the host;
// register.ts binds it to `$`.
export type AppendIO = {
  // [SP_CTX_02_35] RecordDelivery's step in event order (ObserveAppend): sync,
  // before the row is stored
  observe: () => QueuedDelivery | undefined
  // [SP_CTX_01_07] the folder of the session the row comes in, asked for at the event
  storage: () => Promise<string | undefined>
  // [SP_CTX_02_35] RecordDelivery in the background, on the deliveries' chain
  record: (at: Promise<string | undefined>, item: QueuedDelivery) => void
  // [SP_CTX_02_12] AutoTag in the background, on the registry's chain
  autoTag: (at: Promise<string | undefined>, facts: AppendFacts, copy: boolean) => void
  // [SP_CTX_02_12] Copied: the result ids of the rows the last compaction returned
  copied: ReadonlySet<string>
}

// [SP_CTX_02_12] [SP_CTX_02_35] ON row appended: the anchor moves in event
// order, before `store` awaits, so two appends in flight cannot swap it (a
// failure of that step records nothing); the folder is asked for at the
// event. The row is stored first and returned unchanged; RecordDelivery and
// the rules run after it, in the background, and never hold it back. A
// refused row (only a plugin's `note` can be) records nothing. The rules see
// the doors `prompt` and `tool-result` of the main conversation only; whether
// the row is a compaction's copy is decided now, since the next compaction
// or turn start changes Copied.
export async function appendRow<S extends { deny?: unknown }>(io: AppendIO, e: AppendEvent & { agentId?: unknown }, store: () => Promise<S>): Promise<S> {
  let item: QueuedDelivery | undefined
  try {
    item = io.observe()
  } catch {
    item = undefined
  }
  // [PL_AUD_CTX_P11] the rules only for a row they may tag; read from the
  // event now, a row they cannot read is no row for them
  let facts: AppendFacts | undefined
  if (!e.agentId && (e.door === 'prompt' || e.door === 'tool-result'))
    try {
      facts = appendFacts(e)
    } catch {
      facts = undefined
    }
  const rules = facts !== undefined && autoTagNeeded(facts)
  const at = item || rules ? io.storage() : undefined
  const stored = await store()
  try {
    if (at && stored.deny === undefined) {
      if (item) io.record(at, item)
      if (rules) io.autoTag(at, facts!, isCompactionCopy(facts!, io.copied))
    }
  } catch {
    // the stored row stands whatever the rules did
  }
  return stored
}

// [SP_CTX_02_12] After the row is stored; the caller runs it on the
// registry's serial chain. `copy`: isCompactionCopy, decided by the caller
// when the row was appended.
export async function autoTag(io: TagIO, f: AppendFacts, copy = false): Promise<void> {
  if (!autoTagNeeded(f, copy)) return
  const read = await io.readTags()
  if (read.state === 'unreadable') return
  let next = applyRules(read.value, f)
  // [SP_CTX_01_11] R5 (a): the conversation is read only for a large result
  if (f.door === 'tool-result' && f.results.some(r => isBig(r.text.length))) next = markDuplicates(next, await io.rows(), f.results)
  if (next !== read.value) await io.writeTags(next)
}

// [SP_CTX_02_12] One more completed turn of the main conversation, and
// [SP_CTX_02_68] PinDocument in the same change: the first turn end of a
// session reads the view once.
export async function countTurn(io: TagIO): Promise<void> {
  const read = await io.readTags()
  if (read.state === 'unreadable') return
  let next: TagRegistry = { ...read.value, turn: read.value.turn + 1 }
  if (!next.docChecked) {
    const rows = await io.rows().catch(() => undefined)
    if (rows?.length) next = pinDocument(next, rows)
  }
  await io.writeTags(next)
}

// [SP_CTX_02_68] PinDocument: the handoff document among the user rows that
// open a new session (before its first response: the host may put the rows of
// the mod's /clear first) gets a pin, unless it has a tag or the registry is
// full; the check is done once (`docChecked`). The agent may remove the pin. Pure.
export function pinDocument(reg: TagRegistry, rows: readonly SessionMessage[]): TagRegistry {
  if (!rows.length) return reg
  const end = rows.findIndex(r => r.role === 'assistant')
  const at = rows.slice(0, end < 0 ? rows.length : end).findIndex(documentRow)
  const add = tagAdder(reg)
  if (at >= 0) add.put({ kind: 'pin', target: { anchor: fingerprint(rows[at]!), hint: at }, created_turn: reg.turn })
  return { ...reg, tags: add.tags, docChecked: true }
}

// [SP_CTX_02_13] The edits the disposable tags stand for, on `rows`: a pair
// summarized, a row rewritten, a range collapsed.
export function tagEdits(rows: readonly SessionMessage[], reg: TagRegistry, ix: RowIndex = indexRows(rows)): Edit[] {
  const edits: Edit[] = []
  for (const tag of reg.tags) {
    if (tag.kind !== 'disposable' || tag.note === undefined) continue
    if ('tool_use_id' in tag.target) {
      if (resolveTarget(rows, tag.target, ix)) edits.push({ op: 'summarize', tool_use_id: tag.target.tool_use_id, summary: tag.note })
    } else if (isRange(tag.target)) {
      const at = resolveTarget(rows, tag.target, ix)
      if (at) edits.push({ op: 'collapse', from_index: at[0]!, to_index: at.at(-1)!, summary: tag.note })
    } else {
      const at = locate(rows, tag.target.anchor, tag.target.hint, ix)
      if (at >= 0) edits.push({ op: 'rewrite', index: at, text: tag.note })
    }
  }
  return edits
}

// The text a queued tag edit replaces, in chars: a collapse the size of its rows.
function replacedSize(rows: readonly SessionMessage[], edit: QueuedEdit): number {
  const t = touchedBy(rows, edit)
  if (!t) return 0
  if (edit.op === 'summarize') {
    const res = rows[t.rows[1]!]!
    return resultsOf(res).find(r => r.tool_use_id === edit.tool_use_id)?.text.length ?? 0
  }
  if (edit.op === 'collapse') return t.rows.reduce((n, i) => n + rowChars(rows[i]!), 0)
  return rows[t.rows[0]!]!.text.length
}

function noteSize(edit: QueuedEdit): number {
  return edit.op === 'summarize' || edit.op === 'collapse' ? edit.summary.length : edit.op === 'rewrite' ? edit.text.length : 0
}

const NOTHING: Replaced = { queued: 0, freed: '' }

// [SP_CTX_02_13] Queues the replacements of the disposable tags whose
// replacement is not in the queue yet, and returns how many it queued and the
// estimated tokens they free; nothing when none was queued. Only a close of a
// stage by the tool and the end of a waiting block ([SP_CTX_DEC_37]) run it;
// the indexes come from Locate on the rows now, so there is no listedKey
// check. PrepareEdits checks pins, the state slot and the pairs of a range as
// for the agent's edits. The caller runs it on the queue's serial chain.
export async function queueTagReplacements(io: TagIO): Promise<Replaced> {
  const tags = await io.readTags()
  const read = await io.readQueue()
  if (tags.state === 'unreadable' || read.state === 'unreadable') return NOTHING
  const q = read.value
  const inQueue = new Set(q.edits.map(tagEditKey).filter(k => k !== undefined))
  const fresh = { ...tags.value, tags: tags.value.tags.filter(t => !inQueue.has(tagKey(t) ?? '')) }
  const rows = await io.rows()
  const ix = indexRows(rows)
  const prepared = prepare(rows, tagEdits(rows, fresh, ix), undefined, pinnedTargets(rows, tags.value, ix)).queued
  // [SP_CTX_02_58] a tag whose target covers the person's words now is not
  // queued but removed; the call's result names it
  const delivered = (await io.deliveries?.().catch(() => undefined)) ?? []
  const over = prepared.filter(e => personRefusal(rows, e, delivered) !== undefined)
  const dropped = over.length ? await dropTagsOf(io, over) : []
  // [SP_CTX_02_13] the replacement's text names the agent's tag, not a context_edit call
  const queued: QueuedEdit[] = prepared.filter(e => !over.includes(e)).map(e => ({ ...e, via: 'tag' as const }))
  const none: Replaced = dropped.length ? { ...NOTHING, dropped } : NOTHING
  if (!queued.length || q.edits.length + queued.length > MAX_QUEUE_EDITS) return none
  const next: Queue = { ...q, edits: [...q.edits, ...queued], tagsOnly: q.edits.length === 0 ? true : q.tagsOnly }
  if (bytes(next) > MAX_QUEUE_BYTES) return none
  try {
    await io.writeQueue(next)
  } catch {
    return none
  }
  let chars = 0
  for (const edit of queued) chars += replacedSize(rows, edit) - noteSize(edit)
  // [SP_CTX_02_34] by the registry's calibrated ratio
  return { queued: queued.length, freed: estimate(Math.max(0, chars), tags.value.charsPerToken), ...(dropped.length ? { dropped } : {}) }
}

// [SP_CTX_02_58] Removes the disposable tags of these replacements from the
// registry (on its chain when the io has one) and returns their lines; none
// when the registry cannot be read or written.
async function dropTagsOf(io: TagIO, edits: readonly QueuedEdit[]): Promise<string[]> {
  const keys = new Set(edits.map(tagEditKey).filter(k => k !== undefined))
  const onRegistry = io.onRegistry ?? (<T>(work: () => Promise<T>) => work())
  const done = await onRegistry(async () => {
    const now = await io.readTags()
    if (now.state === 'unreadable') return false
    await io.writeTags({ ...now.value, tags: now.value.tags.filter(t => !keys.has(tagKey(t) ?? '')) })
    return true
  }).catch(() => false)
  if (!done) return []
  return edits.map(e => `disposable ${e.op === 'collapse' ? `#${e.from_index}..#${e.to_index}` : 'tool_use_id' in e ? e.tool_use_id : e.op === 'rewrite' || e.op === 'describe' ? `#${e.index}` : '?'} dropped: it covers the person's words`)
}

// [SP_CTX_02_13] Whether a batch edit is the replacement a disposable tag
// stands for: the pair's id, the row's anchor or the range's two anchors, and the note.
function tagEditKey(edit: QueuedEdit): string | undefined {
  if (edit.op === 'summarize') return `u:${edit.tool_use_id}\n${edit.summary}`
  if (edit.op === 'rewrite' && edit.anchors?.[0]) return `a:${edit.anchors[0]}\n${edit.text}`
  if (edit.op === 'collapse' && edit.anchors?.length === 2) return `r:${edit.anchors[0]}\n${edit.anchors[1]}\n${edit.summary}`
  return undefined
}

function tagKey(tag: Tag): string | undefined {
  if (tag.kind !== 'disposable') return undefined
  const t = tag.target
  if ('tool_use_id' in t) return `u:${t.tool_use_id}\n${tag.note}`
  return isRange(t) ? `r:${t.anchor}\n${t.toAnchor}\n${tag.note}` : `a:${t.anchor}\n${tag.note}`
}

// [SP_CTX_02_14] Where an untouched range (rows `was` of `before`) stands in
// `after`. Each end by identity first: a row kept with its handle is the same
// object, wherever a delivery row was inserted or a row removed
// ([SP_CTX_02_36]). Else the end by Locate and the first row by LocateSpan,
// whose count from the end assumes the range kept its row count; so a
// thinking-only first row goes by LocateSpan only when the end, too, was not
// kept by identity (every row rebuilt, as in a seed): with the end kept, a
// thinking-only first row missing by identity was removed with its rebuilt
// stretch. A first row gone or not found gives way to the first row of the
// range that survived (Survivors), as a stage mark does. Undefined when the
// last row is gone or no row of the range before it survived.
function rangeAfter(
  before: readonly SessionMessage[],
  after: readonly SessionMessage[],
  was: readonly number[],
  t: RangeTarget,
  survived: () => Map<number, number>,
  ix: RowIndex = indexRows(after),
): number[] | undefined {
  const same = (i: number) => after.indexOf(before[i]!)
  const last = was.at(-1)!
  const kept = same(last)
  const y = kept >= 0 ? kept : locate(after, t.toAnchor, t.toHint, ix)
  if (y < 0) return undefined
  let x = same(was[0]!)
  if (x < 0 && (kept < 0 || !thinkingOnly(before[was[0]!]!))) {
    const span = locateSpan(after, t, { anchor: t.toAnchor, hint: t.toHint }, ix)
    if (span && span.to === y) x = span.from
  }
  if (x < 0) {
    const map = survived()
    const k = was.map(i => map.get(i)).find(k => k !== undefined)
    if (k !== undefined) x = k
  }
  return x < 0 || x >= y ? undefined : Array.from({ length: y - x + 1 }, (_, k) => x + k)
}

// [SP_CTX_02_14] [SP_CTX_04_03] The registry after a batch: tags of targets
// an applied edit changed go (a range: any row of it), so do tags whose target
// is not in the new rows and disposable tags whose replacement was in the
// batch, applied or failed. Surviving row and range tags get their new
// indexes as hints. The state slot survives an applied rewrite of its own row:
// it moves to the row that rewrite made (`produced`, [SP_CTX_01_05]). Pure.
export function rebindTags(
  reg: TagRegistry,
  before: readonly SessionMessage[],
  after: readonly SessionMessage[],
  applied: readonly QueuedEdit[],
  batch: readonly QueuedEdit[],
  produced: readonly Produced[] = [],
): TagRegistry {
  const editedRows = new Set<number>()
  const editedIds = new Set<string>()
  const was0 = indexRows(before)
  const now0 = indexRows(after)
  for (const edit of applied) {
    const t = touchedBy(before, edit, was0)
    for (const i of t?.rows ?? []) editedRows.add(i)
    for (const id of t?.ids ?? []) editedIds.add(id)
  }
  const tried = new Set(batch.map(tagEditKey).filter(k => k !== undefined))
  let survived: Map<number, number> | undefined
  const tags: Tag[] = []
  for (const tag of reg.tags) {
    const key = tagKey(tag)
    if (key !== undefined && tried.has(key)) continue
    const t = tag.target
    if ('tool_use_id' in t) {
      if (editedIds.has(t.tool_use_id) || !resolveTarget(after, t, now0)) continue
      tags.push(tag)
      continue
    }
    if (isRange(t)) {
      const was = resolveTarget(before, t, was0)
      if (was && was.some(i => editedRows.has(i))) continue
      const now = was ? rangeAfter(before, after, was, t, () => (survived ??= survivors(before, after, editedRows)), now0) : resolveTarget(after, t, now0)
      if (!now) continue
      const [x, y] = [now[0]!, now.at(-1)!]
      tags.push({ ...tag, target: { anchor: fingerprint(after[x]!), hint: x, toAnchor: fingerprint(after[y]!), toHint: y } })
      continue
    }
    const was = locate(before, t.anchor, t.hint, was0)
    if (was >= 0 && editedRows.has(was)) {
      // [SP_CTX_02_14] [SP_CTX_02_67] the state slot follows the rewrite of
      // its own row, or the rebuild of a state edit
      const rewrite = tag.kind === 'state' ? applied.find(e => (e.op === 'rewrite' || e.op === 'state') && touchedBy(before, e, was0)?.rows[0] === was) : undefined
      const made = rewrite ? produced.find(p => p.edit === describeEdit(rewrite)) : undefined
      if (made) tags.push({ ...tag, target: { anchor: made.fingerprint, hint: made.index } })
      continue
    }
    const now = locate(after, t.anchor, t.hint, now0)
    if (now >= 0) {
      tags.push({ ...tag, target: { anchor: t.anchor, hint: now } })
      continue
    }
    // [SP_CTX_02_14] an untouched call row MergeCallRows joined with the other
    // call rows of its response: the tag moves to the merged row, as a note
    // does; one tag per row, and a pin wins
    const merged = was >= 0 ? mergedCallRow(before[was]!, after) : -1
    if (merged < 0) continue
    const moved: Tag = { ...tag, target: { anchor: fingerprint(after[merged]!), hint: merged } }
    const k = tags.findIndex(x => sameTarget(x.target, moved.target))
    if (k < 0) tags.push(moved)
    else if (tag.kind === 'pin') tags[k] = moved
  }
  return { ...reg, tags }
}

// [SP_CTX_02_18] [SP_CTX_DEC_31] B (phase 30, CF-34): PruneDeadTags after a
// compaction that is not the mod's apply: a tag goes only when its target
// was in the rows the compaction took (`before`, e.messages) and is not in
// the rows it returned (`after`); a tag on a row appended since (a mid-turn
// compaction) or outside its input stays, so does the state slot (the
// telemetry says its row is gone until the next apply). Stage marks, notes
// and the other fields stay as they are; the same registry when nothing
// goes. Pure.
export function pruneDeadTags(reg: TagRegistry, before: readonly SessionMessage[], after: readonly SessionMessage[]): TagRegistry {
  if (!reg.tags.length || !before.length) return reg
  const was = indexRows(before)
  const now = indexRows(after)
  const tags = reg.tags.filter(tag => tag.kind === 'state' || resolveTarget(before, tag.target, was) === undefined || resolveTarget(after, tag.target, now) !== undefined)
  return tags.length === reg.tags.length ? reg : { ...reg, tags }
}

// [SP_CTX_01_12] RegistryFull leaves this room below MAX_REGISTRY_BYTES: an
// automatic tag (at most ~200 bytes) would no longer fit (phase 30).
export const TAG_ROOM = 512

// [SP_CTX_02_28] [SP_CTX_01_11] RegistryFull: the automatic rules add no tag
// to it; the tag count and the file's size in KB, or undefined (phase 30).
export function registryFull(reg: TagRegistry): { tags: number; kb: number } | undefined {
  const size = bytes(reg)
  if (reg.tags.length < MAX_TAGS && size <= MAX_REGISTRY_BYTES - TAG_ROOM) return undefined
  return { tags: reg.tags.length, kb: Math.ceil(size / 1024) }
}

// [SP_CTX_01_12] TAGS_FULL_LINE: the telemetry's line for a full registry.
export function tagsFullLine(full: { tags: number; kb: number }): string {
  return `Tags: the registry is full (${full.tags} tags, ${full.kb} KB): automatic review tags have stopped; remove tags you no longer need with context_tag "remove"`
}
