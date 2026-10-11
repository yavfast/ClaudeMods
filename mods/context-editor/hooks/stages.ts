// Stages, the optimization mark and the telemetry on request ([C_CTX_DEC_15]
// to [C_CTX_DEC_17]): the agent marks the logical blocks of its work and
// decides itself when a block is compressed. Pure logic behind small ports;
// register.ts binds them to `$`.
//
// tags.ts imports the mark functions from here and this module imports the
// tag functions from tags.ts: the cycle holds functions only, no top-level
// value of one module reads the other's.
import type { SessionMessage } from 'claude-code'
import { describeEdit, estimate, fingerprint, locate, ownerKey, REPRO_FLAG, REPRODUCIBLE_TOOLS, rowChars, touchedBy, type MediaSizes, type Produced, type QueuedEdit } from './edits'
import type { JournalSummary } from './journal'
import type { Queue, Read } from './queue'
import { activeReviews, dropLastApply, EMPTY_REGISTRY, isActive, resolveTarget, REVIEW_GROUPS, reviewGroup, stateRow, type ReviewGroup, type Tag, type TagRegistry } from './tags'
import { blockNotes, notesHint } from './notes'

// ---- [SP_CTX_01_12] constants

export const OPTIMIZE_MARK = '[context-editor: optimize]'
// the breakdown row with the conversation's rows without the fixed part
// (plugin-hooks pitfall 37); found by name, as it has no `kind` of its own
export const MESSAGES_ROW = 'Messages'
export const MAX_STAGE_NAME = 80
export const MAX_BLOCK_INDEXES = 20
export const SKILL = 'context-stages'
// [SP_CTX_02_34] the bounds of chars per token, and the least conversation
// size in tokens a calibration is trusted at
export const CALIB_MIN = 1.0
export const CALIB_MAX = 8.0
export const CALIB_TOKENS = 20_000

// [SP_CTX_02_27] [SP_CTX_DEC_11] The intro in the hidden context of the first prompt of a session.
export const INTRO_TEXT =
  'context-editor: you can manage your own context. At the start of a logical stage of the task call context_tag with {"tags":[{"op":"open","stage":"<name>"}]}; when the stage is done, {"tags":[{"op":"close"}]} returns its rows, size, cleanup candidates and advice, and you compress what is processed there with ONE context_edit (originals stay readable with Read; the person\'s messages, rules and skills in use usually stay verbatim). If you end your turn and want the block optimized, make [context-editor: optimize] the last line of your final answer: an optimization turn follows. context_list with "count":0 shows context telemetry. A [context-editor] line may name earlier outputs not compressed yet as the context grows; it only informs: decide by the logical state of the work. When edits apply, your own context_* calls are removed from the conversation; tags and notes stay (see context_list). Guide: skill context-editor:context-stages.'

// [SP_CTX_02_29] [C_CTX_DEC_04] D: the advice of a closed stage and of the
// optimization turn; it names the reproducible pairs by the listing's `~`
// flag (REPRO_FLAG, [SP_CTX_01_12]).
export const STAGE_ADVICE =
  "Review the block as a whole and compress, in ONE context_edit, what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media already seen (by a description if the task allows). Write a stage record: goal; decisions with the reason, the person's verbatim words behind them and why other options were rejected; verified facts with sources (paths, lines, versions); changed artifacts; open questions. The person's messages, including answers to your questions (AskUserQuestion), are not reproducible: keep them verbatim unless you drop them deliberately. Reproducible pairs (~: Read, Grep, Glob) can shrink to a pointer (what, where, what was found; re-read if needed); others need a careful summary. Usually keep verbatim the person's messages, rules and skills still in force, and conclusions you need next. Originals stay readable with Read. If nothing needs compressing, queue nothing."

export { estimate }

// ---- [SP_CTX_01_18] Stage, ClosedBlock and RowMark

// "The block starts after this row" or "the block ends with this row"; null
// in a RowMark's place is the head of the conversation (before row 0).
export type RowMark = { anchor: string; hint: number }
export type Stage = { name: string; after: RowMark | null; openedTurn: number }
// `name` absent: a block without a stage, closed by the mark ([SP_CTX_DEC_14])
export type ClosedBlock = { name?: string; after: RowMark | null; end: RowMark | null; turn: number }

// The registry fields stages live in ([SP_CTX_01_10]).
export type StageFields = { stage?: Stage; lastClosed?: ClosedBlock; turn: number }

// A thinking-only row has the fingerprint "assistant||", which tells no rows apart.
export function distinctive(row: SessionMessage): boolean {
  return row.toolUses.length > 0 || (row.toolResults ?? []).length > 0 || row.text.length > 0
}

// MarkBefore(rows, i): the last distinctive row before `i`, or null.
export function markBefore(rows: readonly SessionMessage[], i: number): RowMark | null {
  for (let k = Math.min(i, rows.length) - 1; k >= 0; k--) if (distinctive(rows[k]!)) return { anchor: fingerprint(rows[k]!), hint: k }
  return null
}

// MarkIndex(rows, m): -1 for null (the head), the row Locate finds, or 'lost'.
export function markIndex(rows: readonly SessionMessage[], m: RowMark | null): number | 'lost' {
  if (m === null) return -1
  const at = locate(rows, m.anchor, m.hint)
  return at < 0 ? 'lost' : at
}

// StartOf(rows, after): the first row of a block; a lost start counts as the head.
export function startOf(rows: readonly SessionMessage[], after: RowMark | null): number {
  const at = markIndex(rows, after)
  return at === 'lost' ? 0 : at + 1
}

// [SP_CTX_02_29] CloseStage: the open stage becomes the last closed block,
// ending with the last row before the carrier row of the call. Undefined
// without an open stage (NO_STAGE). The caller writes the registry. Pure.
export function closeStage<R extends StageFields>(reg: R, rows: readonly SessionMessage[], carrier: number): { registry: R; block: ClosedBlock } | undefined {
  if (!reg.stage) return undefined
  const block: ClosedBlock = { name: reg.stage.name, after: reg.stage.after, end: markBefore(rows, carrier), turn: reg.turn }
  const { stage: _s, ...rest } = reg
  return { registry: { ...rest, lastClosed: block } as R, block }
}

// [SP_CTX_01_18] context_tag and DetectOptimize write null in the place of a
// lost `stage.after` and `lastClosed.after` (both mean the head); a lost
// `lastClosed.end` stays, so it never becomes an empty block. The same
// registry when nothing is lost.
export function normalizeLost<R extends StageFields>(reg: R, rows: readonly SessionMessage[]): R {
  let next = reg
  if (reg.stage && markIndex(rows, reg.stage.after) === 'lost') next = { ...next, stage: { ...reg.stage, after: null } }
  if (reg.lastClosed && markIndex(rows, reg.lastClosed.after) === 'lost') next = { ...next, lastClosed: { ...reg.lastClosed, after: null } }
  return next
}

// ---- [SP_CTX_02_14] RelocateMark

// Survivors(before, after, changed): each distinctive row of `before` that
// stayed the same, to its index in `after`; fingerprints are matched forward
// from the previous match.
export function survivors(before: readonly SessionMessage[], after: readonly SessionMessage[], changed: ReadonlySet<number>): Map<number, number> {
  const prints = after.map(fingerprint)
  const map = new Map<number, number>()
  let j = 0
  for (let i = 0; i < before.length; i++) {
    if (changed.has(i) || !distinctive(before[i]!)) continue
    const want = fingerprint(before[i]!)
    let k = j
    while (k < prints.length && prints[k] !== want) k++
    if (k >= prints.length) continue
    map.set(i, k)
    j = k + 1
  }
  return map
}

// RelocateMark: a mark whose row an applied edit replaced moves to the last
// row that edit made (the latest of several); one whose row went without a
// replacement, or that the seed changed, moves to the nearest earlier row that
// stayed the same; none left, or the row was not in `before` at all: null.
export function relocateMark(
  m: RowMark | null,
  before: readonly SessionMessage[],
  after: readonly SessionMessage[],
  applied: readonly QueuedEdit[],
  produced: readonly Produced[],
  changed: ReadonlySet<number>,
): RowMark | null {
  if (m === null) return null
  const x = markIndex(before, m)
  if (x === 'lost' || x < 0) return null
  const labels = new Set(applied.filter(e => e.op !== 'drop' && (touchedBy(before, e)?.rows ?? []).includes(x)).map(describeEdit))
  const made = produced.filter(p => labels.has(p.edit))
  if (made.length) {
    const p = made.reduce((a, b) => (b.index > a.index ? b : a))
    return { anchor: p.fingerprint, hint: p.index }
  }
  const map = survivors(before, after, changed)
  for (let p = x; p >= 0; p--) {
    const k = map.get(p)
    if (k !== undefined) return { anchor: fingerprint(after[k]!), hint: k }
  }
  return null
}

// [SP_CTX_02_14] The stage marks after an apply or a seed: `stage.after`,
// `lastClosed.after` and `lastClosed.end` are moved, never dropped. `carried`:
// the results a seed's CarryNote changed ([SP_CTX_01_17]). Pure.
export function relocateStageMarks<R extends StageFields>(
  reg: R,
  before: readonly SessionMessage[],
  after: readonly SessionMessage[],
  applied: readonly QueuedEdit[],
  produced: readonly Produced[],
  carried: readonly string[] = [],
): R {
  if (!reg.stage && !reg.lastClosed) return reg
  const changed = new Set<number>()
  for (const e of applied) for (const i of touchedBy(before, e)?.rows ?? []) changed.add(i)
  const ids = new Set(carried)
  before.forEach((r, i) => {
    if ((r.toolResults ?? []).some(t => ids.has(t.tool_use_id))) changed.add(i)
  })
  const move = (m: RowMark | null) => relocateMark(m, before, after, applied, produced, changed)
  let next = reg
  if (reg.stage) next = { ...next, stage: { ...reg.stage, after: move(reg.stage.after) } }
  if (reg.lastClosed) next = { ...next, lastClosed: { ...reg.lastClosed, after: move(reg.lastClosed.after), end: move(reg.lastClosed.end) } }
  return next
}

// ---- [SP_CTX_02_01] marks in the listing

// The stage marks by row index: `[stage ▶ <name>]` on the first row of the
// open stage, `[block ▶ <name>]` (`[block ▶]` without a name) on the first
// row of the last closed block and `[block end]` on its last. A lost start
// counts as the head; a lost end gives no `[block end]`; an empty block no marks.
export function markLabels(rows: readonly SessionMessage[], reg: StageFields): Map<number, string[]> {
  const labels = new Map<number, string[]>()
  const put = (i: number, label: string) => {
    if (i >= 0 && i < rows.length) labels.set(i, [...(labels.get(i) ?? []), label])
  }
  if (reg.stage) put(startOf(rows, reg.stage.after), `[stage ▶ ${reg.stage.name}]`)
  const b = reg.lastClosed
  if (b) {
    const s0 = startOf(rows, b.after)
    const e = markIndex(rows, b.end)
    const start = b.name !== undefined ? `[block ▶ ${b.name}]` : '[block ▶]'
    if (e === 'lost') put(s0, start)
    else if (b.end !== null && s0 <= e) {
      put(s0, start)
      put(e, '[block end]')
    }
  }
  return labels
}

// ---- [SP_CTX_01_20] [SP_CTX_02_28] Telemetry

// What the telemetry reads of `$.session.usage({ breakdown: 'summary' })`.
export type UsageInfo = {
  context: {
    tokens?: number
    window: number
    breakdown?: {
      categories: readonly { name: string; tokens: number; kind: string }[]
      totalTokens: number
      rawMaxTokens: number
      autoCompactThreshold?: number
      // the live window's last API response, null before one came back;
      // the Messages row is reconciled to it
      apiUsage?: object | null
    }
  }
}

export type Telemetry = {
  measure: 'messages' | 'request' | 'unknown' | 'unavailable'
  conversation?: number
  fixed?: number
  request?: number
  window?: number
  autoCompactLeft?: number
  autoCompactOff: boolean
  error?: string
  // without a readable registry the stage, block and candidate parts are absent
  registry: boolean
  stage?: { name: string; first: number; chars: number; turnsAgo: number; lost: boolean }
  lastClosed?: { name?: string; start: number; end?: number; chars?: number; lost: boolean; startLost: boolean }
  // [SP_CTX_01_20] active reviews whose target is in the conversation, by
  // reason (`none`: a tag written before phase 15), with the first row of
  // each target; and disposables
  reviews: Map<ReviewGroup, number[]>
  disposable: number
  // [SP_CTX_01_20] the journal of effect; absent: not read (no line)
  journal?: JournalSummary
  // [SP_CTX_01_20] the state slot: its row, no tag, or its row is gone
  state: { row: number } | 'none' | 'lost'
  // [SP_CTX_02_34] the chars per token the estimates of this telemetry use; absent: approx.
  ratio?: number
  // [SP_CTX_01_21] the notes of the registry and how many wait for a reminder
  notes: { count: number; reminders: number }
  // [SP_CTX_02_28] the measured change of the request since the last apply,
  // shown once after the first model response after it
  measuredFreed?: number
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function charsOf(rows: readonly SessionMessage[], from: number, to: number): number {
  let n = 0
  for (let i = Math.max(0, from); i <= to && i < rows.length; i++) n += rowChars(rows[i]!)
  return n
}

// [SP_CTX_02_34] Calibrate: chars of the current conversation per token of
// its rows from the telemetry, when the conversation is large enough to
// trust; the stored ratio otherwise. `save` is asked only when the ratio moved
// by more than 5 %. Pure but for `save`.
export async function calibrate(
  rows: readonly SessionMessage[],
  t: Pick<Telemetry, 'measure' | 'conversation'>,
  reg: Pick<TagRegistry, 'charsPerToken'>,
  save?: (ratio: number) => Promise<void>,
): Promise<number | undefined> {
  const c = rows.reduce((n, r) => n + rowChars(r), 0)
  if (t.measure !== 'messages' || (t.conversation ?? 0) < CALIB_TOKENS || c <= 0) return reg.charsPerToken
  const r = Math.min(CALIB_MAX, Math.max(CALIB_MIN, c / t.conversation!))
  const old = reg.charsPerToken
  // a failed write: this call uses the new ratio, the next ones the old
  if (save && (old === undefined || Math.abs(r - old) > 0.05 * old)) await save(r).catch(() => undefined)
  return r
}

// [SP_CTX_02_01] The one size of the listing's header: the conversation's
// tokens from the telemetry, else an Estimate of its chars.
export function headerSize(t: Pick<Telemetry, 'measure' | 'conversation' | 'ratio'>, chars: number): string {
  if (t.measure === 'messages' && t.conversation !== undefined) return `~${tokensText(t.conversation)} tokens`
  return t.ratio ? `${estimate(chars, t.ratio)} (calibrated estimate)` : estimate(chars)
}

// [SP_CTX_02_28] Telemetry(rows, reg): the size from the MESSAGES_ROW of the
// breakdown, else the whole request; a failed usage read leaves the rest.
// `update` changes the registry on its chain: a new calibration
// ([SP_CTX_02_34]), the measured apply consumed ([SP_CTX_02_28]).
export type RegistryUpdate = (change: (reg: TagRegistry) => TagRegistry) => Promise<void>

export async function telemetry(
  rows: readonly SessionMessage[],
  reg: TagRegistry | undefined,
  usage: () => Promise<UsageInfo>,
  update?: RegistryUpdate,
  // [SP_CTX_02_31] the journal's summary, read by the caller
  journal?: JournalSummary,
): Promise<Telemetry> {
  let tokensNow: number | undefined
  const t: Telemetry = {
    measure: 'unavailable',
    autoCompactOff: false,
    registry: reg !== undefined,
    reviews: new Map(),
    disposable: 0,
    state: 'none',
    notes: { count: 0, reminders: 0 },
    ...(journal ? { journal } : {}),
  }
  try {
    const u = await usage()
    tokensNow = u.context.tokens
    const b = u.context.breakdown
    const row = b?.categories.find(c => c.kind === 'used' && c.name === MESSAGES_ROW)
    // no response yet in the live window (a fresh session, just after a
    // compaction): `tokens` is absent, or it is still the last request before
    // the compaction while the breakdown has no API usage and its Messages row
    // is a bare estimate (live verify of phase 14, D2)
    if (u.context.tokens === undefined || b?.apiUsage === null) t.measure = 'unknown'
    // just after the host's own compaction the breakdown overestimates the
    // fixed part beyond the whole request and clamps the Messages row to a few
    // tokens (live re-verify of phase 14, D2): the request is the honest
    // figure then. A total above the request alone is normal (rows estimated
    // after the last response), so only an impossible fixed part counts.
    else if (b && row && b.totalTokens - row.tokens <= u.context.tokens) {
      t.measure = 'messages'
      t.conversation = row.tokens
      t.fixed = Math.max(0, b.totalTokens - row.tokens)
    } else {
      t.measure = 'request'
      t.request = u.context.tokens
    }
    t.window = b ? b.rawMaxTokens : u.context.window
    if (b) {
      if (b.autoCompactThreshold !== undefined) t.autoCompactLeft = b.autoCompactThreshold - b.totalTokens
      else t.autoCompactOff = true
    }
  } catch (err) {
    t.measure = 'unavailable'
    t.error = errorText(err)
  }
  if (!reg) return t
  const save = update ? (ratio: number) => update(r => ({ ...r, charsPerToken: ratio })) : undefined
  t.ratio = await calibrate(rows, t, reg, save)
  // the first model response after an apply: the request now against the one before it
  const last = reg.lastApply
  if (last && (t.measure === 'messages' || t.measure === 'request') && tokensNow !== undefined && tokensNow !== last.tokensBefore) {
    // a negative change (more rows added than freed) is no freeing: not shown
    if (last.tokensBefore > tokensNow) t.measuredFreed = last.tokensBefore - tokensNow
    if (update) await update(r => (r.lastApply?.at === last.at ? dropLastApply(r) : r)).catch(() => undefined)
  }
  if (reg.stage) {
    const first = startOf(rows, reg.stage.after)
    t.stage = {
      name: reg.stage.name,
      first,
      chars: charsOf(rows, first, rows.length - 1),
      turnsAgo: Math.max(0, reg.turn - reg.stage.openedTurn),
      lost: markIndex(rows, reg.stage.after) === 'lost',
    }
  }
  if (reg.lastClosed) {
    const b = reg.lastClosed
    const s0 = startOf(rows, b.after)
    const e = markIndex(rows, b.end)
    const end = typeof e === 'number' && e >= 0 ? e : undefined
    t.lastClosed = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      start: s0,
      ...(end !== undefined ? { end } : {}),
      ...(end !== undefined && s0 <= end ? { chars: charsOf(rows, s0, end) } : {}),
      lost: e === 'lost',
      startLost: markIndex(rows, b.after) === 'lost',
    }
  }
  t.reviews = activeReviews(rows, reg)
  const slot = stateRow(rows, reg)
  t.state = slot === undefined ? 'none' : slot < 0 ? 'lost' : { row: slot }
  t.disposable = reg.tags.filter(tag => tag.kind === 'disposable' && resolveTarget(rows, tag.target)).length
  t.notes = { count: reg.notes.length, reminders: reg.notes.filter(n => n.remindAt !== undefined).length }
  return t
}

// Tokens in thousands rounded to an integer ("12k"); under 1000 as they are.
export function tokensText(n: number): string {
  const v = Math.round(n)
  return Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
}

// [SP_CTX_01_20] The name of a review group in a text: `no reason` for `none`.
function groupName(g: ReviewGroup): string {
  return g === 'none' ? 'no reason' : g
}

// Row indexes, at most MAX_BLOCK_INDEXES, then "+<n> more".
function shortList(at: readonly number[]): string {
  const shown = at.slice(0, MAX_BLOCK_INDEXES).map(i => `#${i}`).join(', ')
  return at.length > MAX_BLOCK_INDEXES ? `${shown}, +${at.length - MAX_BLOCK_INDEXES} more` : shown
}

function blockLabel(name: string | undefined): string {
  return name !== undefined ? `Last block "${name}"` : 'Last block (no stage)'
}

// [SP_CTX_02_28] TelemetryText(t): one line per part.
export function telemetryText(t: Telemetry): string {
  const lines: string[] = []
  const auto = t.autoCompactLeft !== undefined ? `; auto-compaction in ~${tokensText(Math.max(0, t.autoCompactLeft))}` : t.autoCompactOff ? '; auto-compaction off' : ''
  const window = t.window !== undefined ? tokensText(t.window) : '?'
  switch (t.measure) {
    case 'messages':
      lines.push(`Context: conversation ~${tokensText(t.conversation ?? 0)} tokens; fixed part (system prompt, tools, skills, memory) ~${tokensText(t.fixed ?? 0)}; window ${window}${auto}`)
      break
    case 'request':
      lines.push(`Context: last request ~${tokensText(t.request ?? 0)} tokens, the fixed part (system prompt, tools, skills, memory) included; window ${window}${auto}`)
      break
    case 'unknown':
      lines.push(`Context: size unknown yet (no model response since the session start or the last compaction); window ${window}`)
      break
    case 'unavailable':
      lines.push(`Context: size unavailable (${t.error ?? 'unknown error'})`)
      break
  }
  if (!t.registry) return lines.join('\n')
  const startGone = '; its start row is gone, so it runs from #0'
  lines.push(
    t.stage
      ? `Stage "${t.stage.name}" open from #${t.stage.first} (opened ${t.stage.turnsAgo} turn(s) ago), ${estimate(t.stage.chars, t.ratio)}${t.stage.lost ? startGone : ''}`
      : 'No open stage',
  )
  const b = t.lastClosed
  if (b) {
    const head = blockLabel(b.name)
    const body = b.lost
      ? `${head} from #${b.start}: its end row is gone`
      : b.end === undefined || b.start > b.end
        ? `${head}: it is empty`
        : `${head} #${b.start}..#${b.end} (${estimate(b.chars ?? 0, t.ratio)})`
    lines.push(body + (b.startLost ? startGone : ''))
  }
  // [SP_CTX_02_28] by reason, with their rows; reasons with none omitted
  let total = 0
  const groups: string[] = []
  for (const g of REVIEW_GROUPS) {
    const at = t.reviews.get(g) ?? []
    if (!at.length) continue
    total += at.length
    groups.push(`${groupName(g)} ${at.length}: ${shortList(at)}`)
  }
  lines.push(`Candidates: review ${total}${groups.length ? ` (${groups.join('; ')})` : ''}; disposable ${t.disposable}`)
  // [SP_CTX_02_28] the journal and the state slot only when there is something to show
  const j = t.journal
  if (j && 'unreadable' in j) lines.push(`Effect: journal unreadable (${j.unreadable})`)
  else if (j && j.applications + j.rereads > 0)
    lines.push(`Effect: ${j.applications} application(s); ${j.rereads} reread(s) of compressed content (${j.archiveRereads} of archives)`)
  if (t.state === 'lost') lines.push('State slot: its row is no longer in the conversation')
  else if (t.state !== 'none') lines.push(`State slot: #${t.state.row}`)
  if (t.notes.count) lines.push(`Notes: ${t.notes.count} (${t.notes.reminders} with a reminder pending)`)
  if (t.measuredFreed !== undefined)
    lines.push(`Last apply: ~${tokensText(t.measuredFreed)} tokens freed (measured: request before it − request now; net of the rows added since)`)
  return lines.join('\n')
}

// ---- [SP_CTX_02_29] StageBlock

// What the close report reads; register.ts binds it to `$`.
export type BlockIO = {
  // [SP_CTX_02_18] Key(), read before the rows
  key: () => Promise<string>
  rows: () => Promise<readonly SessionMessage[]>
  readTags: () => Promise<Read<TagRegistry>>
  // media sizes by owner key, from CollectMedia over the API form
  media: () => Promise<MediaSizes>
  usage: () => Promise<UsageInfo>
  // [SP_CTX_02_34] stores a new calibration in the registry, on its chain
  updateRegistry?: RegistryUpdate
  // [SP_CTX_02_31] the journal's summary for the telemetry; absent: no line
  journal?: () => Promise<JournalSummary>
  // [SP_CTX_02_18] listedKey = key: the report lists the block's row indexes
  setListed: (key: string) => void
}

// [SP_CTX_02_13] What QueueTagReplacements queued.
// `freed`: Estimate of the replaced text less the notes ([SP_CTX_02_34])
export type Replaced = { queued: number; freed: string }

// The rows of a tag's target that lie in a..e, the first of them, or -1.
function firstIn(rows: readonly SessionMessage[], tag: Tag, a: number, e: number): number {
  const at = (resolveTarget(rows, tag.target) ?? []).filter(i => i >= a && i <= e)
  return at.length ? Math.min(...at) : -1
}

function indexList(name: string, at: number[]): string {
  if (!at.length) return ''
  const sorted = [...new Set(at)].sort((x, y) => x - y)
  const shown = sorted.slice(0, MAX_BLOCK_INDEXES).map(i => `#${i}`)
  const more = sorted.length > MAX_BLOCK_INDEXES ? `, +${sorted.length - MAX_BLOCK_INDEXES} more` : ''
  return `${name} ${shown.join(', ')}${more}`
}

// [SP_CTX_02_29] The pairs of REPRODUCIBLE_TOOLS whose call and result rows lie in a..e.
function reproduciblePairs(rows: readonly SessionMessage[], a: number, e: number): number {
  let n = 0
  for (let i = a; i <= e; i++)
    for (const u of rows[i]!.toolUses) {
      if (!REPRODUCIBLE_TOOLS.includes(u.tool)) continue
      const res = rows.findIndex(r => (r.toolResults ?? []).some(t => t.tool_use_id === u.tool_use_id))
      if (res >= a && res <= e) n++
    }
  return n
}

// [SP_CTX_02_29] BlockReport: only for a close by the tool, where no
// compaction comes between the close and the report, so its indexes hold; a
// report with the block's rows renews listedKey as a listing does.
export async function blockReport(io: BlockIO, block: ClosedBlock, replaced?: Replaced): Promise<string> {
  const key = await io.key()
  const rows = await io.rows()
  const read = await io.readTags()
  const reg = read.state === 'unreadable' ? undefined : read.value
  // first: the calibration gives the ratio, so the block's size and the
  // telemetry below use one ratio (review round 39)
  const journal = io.journal ? await io.journal().catch((err): JournalSummary => ({ unreadable: errorText(err) })) : undefined
  const t = await telemetry(rows, reg, io.usage, io.updateRegistry, journal)
  const a = startOf(rows, block.after)
  const e = markIndex(rows, block.end)
  const hasRows = e !== 'lost' && block.end !== null && a <= e
  let head = block.name !== undefined ? `Stage "${block.name}" closed: ` : 'Block (no stage): '
  if (e === 'lost') head += 'its end row is gone; call context_list.'
  else if (!hasRows) head += 'no rows in it.'
  else {
    const media = await io.media()
    let count = 0
    let bytes = 0
    for (let i = a; i <= e; i++) {
      const keys = [...(rows[i]!.toolResults ?? []).map(r => ownerKey({ tool_use_id: r.tool_use_id })), ownerKey({ row: i })]
      for (const k of keys)
        for (const m of media.get(k) ?? []) {
          count++
          bytes += m.bytes
        }
    }
    head += `rows #${a}..#${e}, ${estimate(charsOf(rows, a, e), t.ratio)}, ${count} media (~${Math.ceil(bytes / 1024)}KB).`
  }
  let text = head
  if (hasRows) {
    // [SP_CTX_02_29] the reviews by reason (`no reason`: written before
    // phase 15), the disposables, and the reproducible pairs of the block
    const reviews = new Map<ReviewGroup, number[]>()
    const disposables: number[] = []
    for (const tag of reg?.tags ?? []) {
      if (tag.kind === 'review' && isActive(tag, reg!.turn)) {
        const at = firstIn(rows, tag, a, e as number)
        if (at >= 0) reviews.set(reviewGroup(tag), [...(reviews.get(reviewGroup(tag)) ?? []), at])
      }
      if (tag.kind === 'disposable') {
        const at = firstIn(rows, tag, a, e as number)
        if (at >= 0) disposables.push(at)
      }
    }
    const repro = reproduciblePairs(rows, a, e as number)
    const cand = [
      ...REVIEW_GROUPS.map(g => indexList(groupName(g), reviews.get(g) ?? [])),
      indexList('disposable', disposables),
      repro ? `reproducible pairs (${REPRO_FLAG}) ${repro}` : '',
    ]
      .filter(Boolean)
      .join('; ')
    text += `\nCandidates in the block: ${cand || 'none'}.`
    // [SP_CTX_02_32] the agent's notes on rows of the block
    const notes = reg ? blockNotes(rows, reg, a, e as number, MAX_BLOCK_INDEXES) : ''
    if (notes) text += `\nYour notes in the block: ${notes}`
  }
  if (replaced && replaced.queued > 0)
    text += `\nReplacements from your disposable tags queued: ${replaced.queued} (${replaced.freed} freed when this turn ends).`
  text += '\n' + telemetryText(t)
  if (hasRows) {
    text += '\n' + STAGE_ADVICE
    io.setListed(key)
  }
  return text
}

// [SP_CTX_02_29] REPORT_FAILED: the stage is closed and written already.
export function reportFailed(block: ClosedBlock, err: unknown): string {
  const what = block.name !== undefined ? `Stage "${block.name}"` : 'The block'
  return `${what} closed; its report failed: ${errorText(err)}; call context_list`
}

export function blockName(block: ClosedBlock): string {
  return block.name !== undefined ? `stage "${block.name}"` : 'the last block (no stage)'
}

export const LIST_HINT =
  " Call context_list: its header names the block's range (Last block #<a>..#<b>, or Last block from #<a> when its end row is gone); list from its first row (from=<a>) to see those rows ([block ▶ …] .. [block end]) before you edit by index."

// [SP_CTX_02_29] [SP_CTX_DEC_15] The optimization turn's prompt: no indexes,
// sizes or candidates; the listing shows the block's bounds.
export function optimizeText(block: ClosedBlock, compacted: boolean, notes = 0): string {
  return (
    `context-editor: optimization turn for ${blockName(block)} (you ended your last answer with ${OPTIMIZE_MARK}).` +
    (compacted
      ? ' The batch queued in that turn, with the replacements from your disposable tags, was processed (see the report above); if it changed the conversation, indexes from earlier listings no longer hold.'
      : '') +
    LIST_HINT +
    notesHint(notes) +
    '\n' +
    STAGE_ADVICE +
    // [SP_CTX_DEC_16] the batch of this turn does not resume unless asked to (queueEdits)
    '\nYou asked for this while finishing your turn for the person, so the session stops after this batch: pass "resume": true (or a resume_prompt) in context_edit only if the task should go on, then end your turn. The mark has no effect in this turn.'
  )
}

// [SP_CTX_02_29] The advice with the person's prompt when no optimization turn ran.
export function personAdvice(block: ClosedBlock, notes = 0): string {
  return (
    `context-editor: you asked to optimize ${blockName(block)} after your previous answer; the optimization turn did not run, so the advice comes with this prompt.` +
    LIST_HINT +
    notesHint(notes) +
    '\n' +
    STAGE_ADVICE +
    "\nCompress the block when it suits the person's request; edits apply when your turn ends."
  )
}

// ---- [SP_CTX_02_27] SessionIntro

// INTRO_TEXT while the registry (ok or missing) has not recorded it; none
// from an unreadable one: there is nowhere to record the delivery.
export function introFor(read: Read<TagRegistry>): string | undefined {
  return read.state !== 'unreadable' && !read.value.introduced ? INTRO_TEXT : undefined
}

// The registry once the intro entered: a missing one is made with defaults;
// an unreadable one is left alone (undefined).
export function withIntroduced(read: Read<TagRegistry>): TagRegistry | undefined {
  if (read.state === 'unreadable') return undefined
  const reg = read.state === 'missing' ? { ...EMPTY_REGISTRY, tags: [] } : read.value
  return reg.introduced ? undefined : { ...reg, introduced: true }
}

// [SP_CTX_02_29] The advice for the person's prompt, from the registry as it
// is now; none without a readable registry or a block (ADVICE_NO_BLOCK).
export function adviceFor(read: Read<TagRegistry>): string | undefined {
  return read.state !== 'unreadable' && read.value.lastClosed ? personAdvice(read.value.lastClosed, read.value.notes.length) : undefined
}

// ---- [SP_CTX_02_30] DetectOptimize

// LastLine(answer) = OPTIMIZE_MARK: the last line that is not empty once
// trimmed, compared verbatim, case included.
export function hasOptimizeMark(answer: string | undefined): boolean {
  const lines = (answer ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  return lines.at(-1) === OPTIMIZE_MARK
}

// [SP_CTX_02_30] [SP_CTX_DEC_14] The block of the mark: a stage closed by the
// tool in this turn stays the block (its stage opened after it stays open);
// else the open stage closes at the end of the turn; without one, a block
// without a stage from the previous block's end (or the head) to the end of
// the turn. Lost starts become null. Pure.
export function markClose(reg: TagRegistry, rows: readonly SessionMessage[]): TagRegistry {
  const r = normalizeLost(reg, rows)
  if (r.lastClosed && r.lastClosed.turn === r.turn) return r
  const end = markBefore(rows, rows.length)
  if (r.stage) {
    const { stage, ...rest } = r
    return { ...rest, lastClosed: { name: stage.name, after: stage.after, end, turn: r.turn } }
  }
  return { ...r, lastClosed: { after: r.lastClosed ? r.lastClosed.end : null, end, turn: r.turn } }
}

// What DetectOptimize needs from the host; register.ts binds it to `$`.
export type DetectIO = {
  ready: () => Promise<boolean>
  readQueue: () => Promise<Read<Queue>>
  // on the queue chain: `change` sees the queue as read then; undefined
  // writes nothing; a failed write rejects
  updateQueue: (change: (read: Read<Queue>) => Queue | undefined) => Promise<void>
  // on the registry chain, the same way
  updateTags: (change: (read: Read<TagRegistry>) => TagRegistry | undefined) => Promise<void>
  // CurrentRows ([SP_CTX_02_18])
  rows: () => Promise<readonly SessionMessage[]>
  // QueueTagReplacements on the queue chain ([SP_CTX_02_13])
  replace: () => Promise<unknown>
  status: (text: string) => void
}

export type DetectOutcome =
  | 'none'
  | 'in-optimization'
  | 'no-storage'
  | 'queue-unreadable'
  | 'handoff'
  | 'registry-unreadable'
  | 'not-queued'
  | 'requested'

// [SP_CTX_02_30] At the end of a turn of the main conversation (completed or
// aborted), before TagRegistry.turn += 1 and before Flush is planned. The
// end of the turn after an optimization prompt takes the loop guard down and
// ignores the mark in it. None of its failures reaches the agent.
export async function detectOptimize(io: DetectIO, e: { aborted: boolean; answer?: string }): Promise<DetectOutcome> {
  const ready = await io.ready()
  let prompted = false
  if (ready)
    await io
      .updateQueue(read => {
        if (read.state !== 'ok' || !read.value.optimizePrompted) return undefined
        prompted = true
        return { ...read.value, optimizePrompted: false }
      })
      .catch(() => undefined)
  if (e.aborted || !hasOptimizeMark(e.answer)) return 'none'
  // MARK_IN_OPTIMIZATION: silently ignored; the mod never loops
  if (prompted) return 'in-optimization'
  const ignored = (why: string) => io.status(`context-editor: optimization mark ignored: ${why}`)
  if (!ready) return ignored('storage unavailable'), 'no-storage'
  const q = await io.readQueue()
  if (q.state === 'unreadable') return ignored('the queue is unreadable'), 'queue-unreadable'
  if (q.value.handoff) return ignored('a handoff is pending'), 'handoff'
  const rows = await io.rows()
  let regWhy: string | undefined
  try {
    await io.updateTags(read => {
      if (read.state === 'unreadable') {
        regWhy = 'the tag registry is unreadable'
        return undefined
      }
      return markClose(read.value, rows)
    })
  } catch (err) {
    regWhy = errorText(err)
  }
  if (regWhy) return ignored(regWhy), 'registry-unreadable'
  // MARK_NO_REPLACEMENTS: the mark goes on without them
  await io.replace().catch(() => undefined)
  let why: string | undefined
  try {
    await io.updateQueue(read => {
      if (read.state === 'unreadable') why = 'the queue is unreadable'
      else if (read.value.handoff) why = 'a handoff is pending'
      else return { ...read.value, optimize: true }
      return undefined
    })
  } catch (err) {
    why = errorText(err)
  }
  // MARK_NOT_QUEUED: the block stays closed
  if (why) return io.status(`context-editor: optimization mark: the block is closed, but no optimization turn: ${why}`), 'not-queued'
  return 'requested'
}

// ---- [SP_CTX_02_11] context_tag: the carrier row of the call

// The row of `rows` whose calls hold `callId`; len(rows) when it is not
// written yet (the boundary then is the last row, the same one).
export function carrierRow(rows: readonly SessionMessage[], callId: string | undefined): number {
  if (!callId) return rows.length
  const at = rows.findIndex(r => r.toolUses.some(u => u.tool_use_id === callId))
  return at < 0 ? rows.length : at
}
