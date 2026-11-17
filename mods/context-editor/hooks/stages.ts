// Stages, the optimization mark and the telemetry on request ([C_CTX_DEC_15]
// to [C_CTX_DEC_17]): the agent marks the logical blocks of its work and
// decides itself when a block is compressed. Pure logic behind small ports;
// register.ts binds them to `$`.
//
// tags.ts imports the mark functions from here and this module imports the
// tag functions from tags.ts: the cycle holds functions only, no top-level
// value of one module reads the other's.
import type { SessionMessage } from 'claude-code'
import { aliasesById, type AliasRegistry } from './aliases'
import { personText } from './deliveries'
import { PASSED_ADVICE } from './capabilities'
import {
  apiCut,
  carrierIds,
  collectMedia,
  describeEdit,
  distinctive,
  estimate,
  fingerprint,
  fullRow,
  indexRows,
  listMode,
  listRows,
  oneLine,
  locate,
  MAX_BLOCK_INDEXES,
  MAX_LIST_COUNT,
  OWN_TOOLS,
  ownerKey,
  REPRO_FLAG,
  REPRODUCIBLE_TOOLS,
  sourceOf,
  touchedBy,
  type MediaSizes,
  type Produced,
  type QueuedEdit,
  type RowIndex,
  type ClosedSpan,
  type Snapshot,
} from './edits'
import { CACHE_LOOKBACK, cacheShape, lookbackStart, tailTokens } from './cache'
import { BAD_FOLDS, foldsList, recallsHeader, type FoldLedger } from './folds'
import { hostHeader, hostSection, type HostRowRecord, type HostRows } from './hostrows'
import { apiChars, charsOf, errorText, findToolUse, isPromptRow, isReplacementText, modText, PLAIN_RATIO, resultsOf, totalChars } from './rows'
import type { HelperSummary, JournalSummary } from './journal'
import { helperCost } from './helper'
import { checksLine, clockLine, lastRequest } from './cacheclock'
import type { Queue } from './queue'
import { deferredRewrite, deferredView, firstRowOf, nonDeferred, type DeferredView } from './batches'
import type { Change, Read } from './store'
import { activeReviews, dropLastApply, EMPTY_REGISTRY, isActive, queueTagReplacements, registryFull, resolveTarget, REVIEW_GROUPS, reviewGroup, stateRow, tagLabels, tagsFullLine, type ReviewGroup, type Tag, type TagIO, type TagRegistry } from './tags'
import { afterReminders, applyNoteRequests, blockNotes, noteLabels, noteLines, notesHint, rowNotes, withReminderLines, type NoteLine } from './notes'
import { answerRow, OPTIMIZE_MARK, parseTrailers } from './trailers'

// ---- [SP_CTX_01_12] constants

// [SP_FOLD_01_06] the trailer `optimize` (trailers.ts)
export { OPTIMIZE_MARK }
// the breakdown row with the conversation's rows without the fixed part
// (plugin-hooks pitfall 37); found by name, as it has no `kind` of its own
export const MESSAGES_ROW = 'Messages'
// [SP_CTX_02_28] [SP_CTX_02_34] the breakdown rows of the fixed part whose
// text lies in the messages (the first user message's attachments), found by
// name like MESSAGES_ROW: the request's messages hold their tokens beside the
// Messages row's (probe on 2.1.296, 2026-10-12)
export const FIXED_IN_MESSAGES: readonly string[] = ['Memory files', 'Skills', 'MCP server instructions', 'Custom agents']
export const MAX_STAGE_NAME = 80
// [SP_FOLD_01_06] [SP_FOLD_DEC_05] the longest chain of open regions (a task and seven stages)
export const MAX_DEPTH = 8
export const SKILL = 'context-stages'
// [SP_CTX_02_34] the bounds of chars per token, and the least conversation
// size in tokens a calibration is trusted at ([SP_CTX_DEC_30] A after the
// live check of phase 29: the host's breakdown overcounts system and tools by
// 13-25k tokens, so the Messages row of a small conversation is far too small)
export const CALIB_MIN = 1.0
export const CALIB_MAX = 8.0
export const CALIB_TOKENS = 20_000

// [SP_CTX_02_27] [SP_CTX_DEC_11] The intro in the hidden context of the first prompt of a session.
export const INTRO_TEXT = modText(
  'you can manage your own context. At the start of a logical stage call context_tag with {"tags":[{"op":"open","stage":"<name>"}]}; when done, {"tags":[{"op":"close"}]} returns its rows, size, candidates and advice; compress what is processed there with ONE context_edit (context_recall unfolds a fold record; quote the person\'s words still in force; keep rules and skills in use). Trailers end an answer, each on its own line: [context-editor: optimize] (block done: it waits; compress it at the next stage), [context-editor: close] (no wait), [context-editor: note <text>]. context_list with "count":0 shows telemetry. A [context-editor: suggestion] line may propose compressing earlier outputs, with gain, cache cost and a verdict; it only informs: decide by the logical state of the work. When edits apply, your own context_* calls are removed from the conversation; tags and notes stay. Guide: skill context-editor:context-stages; curation rules: context_list with "rules":true.',
)

// [SP_CTX_02_27] [SP_CTX_DEC_36] The opener of the skill's guide in the
// hidden context of the first prompt (phase 33).
export const GUIDE_FRAME = modText(
  `the guide of skill context-editor:${SKILL}, loaded into your context at the start of the session; you need not open the skill.\n\n`,
)

// [SP_CTX_02_29] [C_CTX_DEC_04] D: the advice of a closed stage, of a block
// waiting for compression and of the /compact turn; it names the reproducible pairs by the listing's `~`
// flag (REPRO_FLAG, [SP_CTX_01_12]).
export const STAGE_ADVICE =
  "Review the block as a whole and compress, in ONE context_edit, what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media already seen (by a description if the task allows). Write a stage record: goal; decisions with the reason, the person's verbatim words behind them and why other options were rejected; verified facts with sources (paths, lines, versions); changed artifacts; open questions. A collapse may cover the person's messages and answers (AskUserQuestion): they go into the archive, so the record quotes what is still in force; list in \"keep\" the rows that must stay verbatim. Reproducible pairs (~: Read, Grep, Glob) can shrink to a pointer (what, where, what was found; re-read if needed); others need a careful summary. Compress failed attempts into a lesson: tried X ×N → failed because Y → do Z. Usually keep verbatim the rules and skills still in force, and the conclusions you need next. Originals stay in the archive: context_recall unfolds a record. If nothing needs compressing, queue nothing."

// [SP_FOLD_02_05] [C_FOLD_DEC_14] The advice a task's close adds: its record
// is a task card. A fact others may change is a snapshot with its source, as
// the comparative run showed (Entry 15: one stale answer came from a card).
export const TASK_CARD =
  'This closes a task: make its record a task card in one collapse of the whole block: goal; what was done (commits, changed files); facts and know-how for later tasks, each with its source, and a value others may change (a setting, a version, a figure in a file) as a snapshot: "as read in <file> at turn N; check before use"; instructions: standing ones, and the ones for this task only, marked so; open questions.'

export { distinctive, estimate }

// ---- [SP_CTX_01_18] Stage, ClosedBlock and RowMark

// "The block starts after this row" or "the block ends with this row"; null
// in a RowMark's place is the head of the conversation (before row 0).
export type RowMark = { anchor: string; hint: number }
// [SP_FOLD_01_04] OpenRegion: `kind` absent is a stage; the mod writes it only for a task
export type RegionKind = 'task' | 'stage'
export type Stage = { name: string; after: RowMark | null; openedTurn: number; kind?: RegionKind }
// `name` absent: a block without a stage, closed by the mark ([SP_CTX_DEC_14])
// or two blocks merged by a second mark ([SP_CTX_DEC_37]); `kind` as the region's
export type ClosedBlock = { name?: string; after: RowMark | null; end: RowMark | null; turn: number; kind?: RegionKind }
// [SP_CTX_01_10] [SP_CTX_DEC_37] TagRegistry.waiting: the mark closed
// `lastClosed` and it waits for compression; `advised` once its advice went
// with the first prompt of the next turn
export type Waiting = 'marked' | 'advised'

// The registry fields stages live in ([SP_CTX_01_10]). [SP_FOLD_01_04]
// `stage` is the deepest open region, `outer` the regions around it, outer
// to inner; `outer` is absent when empty and never stands without `stage`.
export type StageFields = { stage?: Stage; outer?: Stage[]; lastClosed?: ClosedBlock; turn: number }

// [SP_FOLD_01_04] The chain of open regions, outer to inner.
export function chainOf(reg: Pick<StageFields, 'stage' | 'outer'>): Stage[] {
  return reg.stage ? [...(reg.outer ?? []), reg.stage] : []
}

// [SP_FOLD_01_04] The registry with this chain: its last region in `stage`,
// the rest in `outer`; an empty chain leaves neither field. Pure.
export function withChain<R extends StageFields>(reg: R, chain: readonly Stage[]): R {
  const { stage: _s, outer: _o, ...rest } = reg
  if (!chain.length) return rest as R
  return { ...rest, ...(chain.length > 1 ? { outer: chain.slice(0, -1) } : {}), stage: chain.at(-1)! } as R
}

export function isTask(s: { kind?: RegionKind } | undefined): boolean {
  return s?.kind === 'task'
}

// [SP_FOLD_02_05] "Stage" or "Task" with the region's name, capitalized or not.
export function regionWord(s: { kind?: RegionKind }, capital = false): string {
  const w = isTask(s) ? 'task' : 'stage'
  return capital ? w[0]!.toUpperCase() + w.slice(1) : w
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

// [SP_FOLD_01_04] The first row of each open region, outer to inner. A lost
// start counts as the start of the region around it (the head for the
// outermost), so an inner region never starts before the one that holds it.
export function chainStarts(rows: readonly SessionMessage[], chain: readonly Stage[]): { first: number; lost: boolean }[] {
  const out: { first: number; lost: boolean }[] = []
  for (const s of chain) {
    const lost = markIndex(rows, s.after) === 'lost'
    out.push({ first: lost ? (out.at(-1)?.first ?? 0) : startOf(rows, s.after), lost })
  }
  return out
}

// [SP_FOLD_02_05] TurnPrompt: the person's request of a call at `carrier`,
// the last PromptRow before it with the person's words (PersonText) or with
// no text (media alone); the mod's resume prompts, its /compact rows and the
// host's notifications are no request. -1 when none.
export function turnPrompt(rows: readonly SessionMessage[], carrier: number): number {
  for (let k = Math.min(carrier, rows.length) - 1; k >= 0; k--) {
    const row = rows[k]!
    if (isPromptRow(row) && (row.text.trim() === '' || personText(row.text) !== '')) return k
  }
  return -1
}

// [SP_FOLD_02_05] TurnWorked: a row after the request `p` and before the
// carrier holds a call other than the mod's own.
export function turnWorked(rows: readonly SessionMessage[], p: number, carrier: number): boolean {
  for (let k = p + 1; k < Math.min(carrier, rows.length); k++) if (rows[k]!.toolUses.some(u => !u.tool.startsWith(OWN_TOOLS))) return true
  return false
}

// [SP_CTX_02_29] [SP_FOLD_02_05] CloseRegions: the regions of the chain from
// `keep` on close; the outermost of them becomes the last closed block, with
// its name and kind, ending with the last row before `carrier`: the carrier
// row of the call, or the prompt of its turn for a task that ends before the
// turn's request (context_tag). `keep` defaults to the deepest region alone.
// Undefined when nothing closes (NO_STAGE). `depth`: the length of the chain
// left. The caller writes the registry. Pure.
export function closeStage<R extends StageFields>(
  reg: R,
  rows: readonly SessionMessage[],
  carrier: number,
  keep = chainOf(reg).length - 1,
): { registry: R; block: ClosedBlock; depth: number } | undefined {
  const chain = chainOf(reg)
  const at = Math.max(0, keep)
  const outermost = chain[at]
  if (!outermost) return undefined
  const block: ClosedBlock = { name: outermost.name, after: outermost.after, end: markBefore(rows, carrier), turn: reg.turn, ...(isTask(outermost) ? { kind: 'task' as const } : {}) }
  return { registry: { ...withChain(reg, chain.slice(0, at)), lastClosed: block }, block, depth: at }
}

// [SP_CTX_01_18] context_tag and DetectOptimize write null in the place of a
// lost start of the outermost open region and of `lastClosed.after` (both
// mean the head), and the start of the region around it in the place of a
// lost start of an inner region ([SP_FOLD_01_04]: bounds nest); a lost
// `lastClosed.end` stays, so it never becomes an empty block. The same
// registry when nothing is lost.
export function normalizeLost<R extends StageFields>(reg: R, rows: readonly SessionMessage[]): R {
  let next = reg
  const chain = chainOf(reg)
  if (chain.some(s => markIndex(rows, s.after) === 'lost')) {
    const fixed: Stage[] = []
    for (const s of chain) fixed.push(markIndex(rows, s.after) === 'lost' ? { ...s, after: fixed.at(-1)?.after ?? null } : s)
    next = withChain(next, fixed)
  }
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

// [SP_CTX_02_14] The stage marks after an apply or a seed: the start of every
// open region of the chain ([SP_FOLD_01_04]), `lastClosed.after` and
// `lastClosed.end` are moved, never dropped. `carried`:
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
    if (resultsOf(r).some(t => ids.has(t.tool_use_id))) changed.add(i)
  })
  const move = (m: RowMark | null) => relocateMark(m, before, after, applied, produced, changed)
  let next = reg
  const chain = chainOf(reg)
  if (chain.length) next = withChain(next, chain.map(s => ({ ...s, after: move(s.after) })))
  if (reg.lastClosed) next = { ...next, lastClosed: { ...reg.lastClosed, after: move(reg.lastClosed.after), end: move(reg.lastClosed.end) } }
  return next
}

// ---- [SP_CTX_02_01] marks in the listing

// [SP_FOLD_01_01] The rows of the last closed block when it has a name and
// both its ends are found, for the `region` of a queued collapse; undefined
// otherwise (a block closed by the mark has no name; an unreadable registry).
export function closedSpan(rows: readonly SessionMessage[], read: Read<Pick<StageFields, 'lastClosed'>>): ClosedSpan | undefined {
  const b = read.state === 'unreadable' ? undefined : read.value.lastClosed
  if (!b || b.name === undefined || b.end === null) return undefined
  if (markIndex(rows, b.after) === 'lost') return undefined
  const to = markIndex(rows, b.end)
  const from = startOf(rows, b.after)
  return to === 'lost' || to < from ? undefined : { name: b.name, from, to, kind: isTask(b) ? 'task' : 'stage' }
}

// [SP_FOLD_01_03] Where a recall is made: the length of the chain of open
// regions and the name of the deepest (none: 0 and ''), with the registry's
// turn counter. An unreadable registry gives no region and turn 0.
export function recallScope(read: Read<Pick<StageFields, 'stage' | 'outer'> & { turn: number }>): { depth: number; scope: string; turn: number } {
  if (read.state === 'unreadable') return { depth: 0, scope: '', turn: 0 }
  const chain = chainOf(read.value)
  return { depth: chain.length, scope: chain.at(-1)?.name ?? '', turn: read.value.turn }
}

// The stage marks by row index: `[task ▶ <name>]` or `[stage ▶ <name>]` on
// the first row of each open region, outer to inner ([SP_FOLD_02_07]),
// `[block ▶ <name>]` (`[block ▶]` without a name) on the first row of the
// last closed block and `[block end]` on its last. A lost start counts as the
// head; a lost end gives no `[block end]`; an empty block no marks.
export function markLabels(rows: readonly SessionMessage[], reg: StageFields): Map<number, string[]> {
  const labels = new Map<number, string[]>()
  const put = (i: number, label: string) => {
    if (i >= 0 && i < rows.length) labels.set(i, [...(labels.get(i) ?? []), label])
  }
  const chain = chainOf(reg)
  chainStarts(rows, chain).forEach(({ first }, i) => put(first, `[${regionWord(chain[i]!)} ▶ ${chain[i]!.name}]`))
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
  // [SP_CTX_02_28] with `messages`: the tokens of the FIXED_IN_MESSAGES rows,
  // part of `fixed` though their text lies in the messages
  attached?: number
  fixed?: number
  request?: number
  window?: number
  autoCompactLeft?: number
  autoCompactOff: boolean
  error?: string
  // without a readable registry the stage, block and candidate parts are absent
  registry: boolean
  // [SP_FOLD_02_07] the chain of open regions, outer to inner; empty: none open
  regions: { name: string; kind: RegionKind; first: number; chars: number; turnsAgo: number; lost: boolean }[]
  lastClosed?: { name?: string; kind?: RegionKind; start: number; end?: number; chars?: number; lost: boolean; startLost: boolean }
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
  // [SP_CTX_02_34] the chars of the API form (ApiChars), the text the
  // request's messages hold; absent without the form or when it may be cut
  // at its window
  chars?: number
  // [SP_CTX_01_21] the notes of the registry and how many wait for a reminder
  notes: { count: number; reminders: number }
  // [SP_CTX_02_28] the measured change of the request since the last apply,
  // shown once after the first model response after it
  measuredFreed?: number
  // [SP_CTX_01_20] [SP_CTX_02_38] LookbackStart of the rows and the tokens of
  // the request from it on (TailTokens; `approx`: by PLAIN_RATIO, no ratio):
  // an apply whose earliest edit is from there keeps the prompt cache up to
  // it; absent without rows
  cache?: { start: number; tokens: number; approx: boolean; rows: number }
  // [SP_CTX_01_20] [SP_CTX_02_40] the host's attachments the answers in force
  // leave out of each request (HostAttachState.left); absent: none or not read
  hostAttach?: { copies: number; chars: number }
  // [SP_CTX_01_20] RegistryFull of the tag registry: its tags and KB (phase 30)
  tagsFull?: { tags: number; kb: number }
  // [SP_HELP_02_13] the cache clock: the last request (null: none seen) and
  // the time of the listing; absent: not read (no line)
  clock?: { last: number | null; now: number }
  // [SP_HELP_02_13] the deferred batches of the queue and the cache they alone
  // would rewrite now (absent: none of their rows found); absent: none wait
  deferred?: DeferredView & { tokens?: number }
}

// [SP_CTX_02_28] Whole(t): the tokens the request's messages hold, the
// Messages row with the fixed part's rows that lie in the messages; absent
// without the Messages row.
export function wholeOf(t: Pick<Telemetry, 'measure' | 'conversation' | 'attached'>): number | undefined {
  return t.measure === 'messages' && t.conversation !== undefined ? t.conversation + (t.attached ?? 0) : undefined
}

// [SP_CTX_02_28] [SP_CTX_02_34] Measure(u): what one usage read with the
// breakdown says of the size, shared by Telemetry and CalibrateBeforeApply.
// Pure.
export type Measured = Pick<Telemetry, 'measure' | 'conversation' | 'attached' | 'fixed' | 'request' | 'window' | 'autoCompactLeft' | 'autoCompactOff'>

export function measure(u: UsageInfo): Measured {
  const t: Measured = { measure: 'unknown', autoCompactOff: false }
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
    const attached = b.categories.filter(c => c.kind === 'used' && FIXED_IN_MESSAGES.includes(c.name)).reduce((n, c) => n + c.tokens, 0)
    if (attached > 0) t.attached = attached
  } else {
    t.measure = 'request'
    t.request = u.context.tokens
  }
  t.window = b ? b.rawMaxTokens : u.context.window
  if (b) {
    if (b.autoCompactThreshold !== undefined) t.autoCompactLeft = b.autoCompactThreshold - b.totalTokens
    else t.autoCompactOff = true
  }
  return t
}

// [SP_CTX_02_34] What CalibrateBeforeApply reads; register.ts binds it to `$`
// in the storage Flush took. `readTags`: the registry's view (the cache);
// `updateTags`: the Update contract on the registry's chain.
export type CalibrateIO = {
  usage: () => Promise<UsageInfo>
  api: () => Promise<readonly unknown[]>
  readTags: () => Promise<Read<TagRegistry>>
  updateTags: RegistryUpdate
}

// [SP_CTX_02_34] CalibrateBeforeApply (phase 29): Flush calibrates before
// the compaction command, so the apply's report and the person's line take
// this conversation's ratio. Reads no rows of the conversation. Any failure:
// nothing, the apply takes the ratio stored already. The ratio, if any.
export async function calibrateBeforeApply(io: CalibrateIO): Promise<number | undefined> {
  try {
    const t = measure(await io.usage())
    const form = await io.api().catch((): readonly unknown[] => [])
    const chars = form.length > 0 && !apiCut(form) ? apiChars(form) : undefined
    const reg = await io.readTags()
    if (reg.state !== 'ok') return undefined
    return await calibrate(chars, t, reg.value, async ratio => void (await io.updateTags(r => ({ ...r, charsPerToken: ratio }))))
  } catch {
    return undefined
  }
}

// [SP_CTX_02_34] Calibrate: the chars of the request's messages (`chars`, the
// API form with the host's attachments, which the rows lack) per token they
// hold (Whole: the Messages row with the fixed part's rows that lie in the
// messages), when the conversation is large enough to trust; the stored
// ratio otherwise, also without the API form (rows alone would put the
// attachments' tokens on the rows' chars). `save` is asked only when the
// ratio moved by more than 5 %. Pure but for `save`.
export async function calibrate(
  chars: number | undefined,
  t: Pick<Telemetry, 'measure' | 'conversation' | 'attached'>,
  reg: Pick<TagRegistry, 'charsPerToken'>,
  save?: (ratio: number) => Promise<void>,
): Promise<number | undefined> {
  const whole = wholeOf(t)
  if (whole === undefined || t.conversation! < CALIB_TOKENS || !chars || chars <= 0) return reg.charsPerToken
  const r = Math.min(CALIB_MAX, Math.max(CALIB_MIN, chars / whole))
  const old = reg.charsPerToken
  // a failed write: this call uses the new ratio, the next ones the old
  if (save && (old === undefined || Math.abs(r - old) > 0.05 * old)) await save(r).catch(() => undefined)
  return r
}

// [SP_CTX_02_01] The one size of the listing's header: the conversation's
// tokens from the telemetry, else an Estimate of its chars (the API form's,
// `t.chars`, when the caller has them: the rows lack the attachments).
export function headerSize(t: Pick<Telemetry, 'measure' | 'conversation' | 'ratio'>, chars: number): string {
  if (t.measure === 'messages' && t.conversation !== undefined) return `~${tokensText(t.conversation)} tokens`
  return t.ratio ? `${estimate(chars, t.ratio)} (calibrated estimate)` : estimate(chars)
}

// [SP_CTX_02_28] Telemetry(rows, reg): the size from the MESSAGES_ROW of the
// breakdown, else the whole request; a failed usage read leaves the rest.
// `update` changes the registry on its chain: a new calibration
// ([SP_CTX_02_34]), the measured apply consumed ([SP_CTX_02_28]). The part of
// an Update port ([SP_CTX_01_07]) the telemetry uses: its change always
// returns a registry, and its result is not read.
export type RegistryUpdate = (change: (reg: TagRegistry) => TagRegistry) => Promise<unknown>

export async function telemetry(
  rows: readonly SessionMessage[],
  reg: TagRegistry | undefined,
  usage: () => Promise<UsageInfo>,
  update?: RegistryUpdate,
  // [SP_CTX_02_31] the journal's summary, read by the caller
  journal?: JournalSummary,
  // [SP_CTX_02_38] the API form for the Cache line (ResponseStart) and
  // [SP_CTX_02_34] the calibration's chars; absent or failed: without it,
  // only stretch starts count and the stored ratio stays
  api?: () => Promise<readonly unknown[]>,
  // [SP_CTX_02_37] `cache: false`: no Cache line (SoftHint needs none)
  opts: { cache?: boolean } = {},
): Promise<Telemetry> {
  let tokensNow: number | undefined
  const t: Telemetry = {
    measure: 'unavailable',
    autoCompactOff: false,
    registry: reg !== undefined,
    regions: [],
    reviews: new Map(),
    disposable: 0,
    state: 'none',
    notes: { count: 0, reminders: 0 },
    ...(journal ? { journal } : {}),
  }
  try {
    const u = await usage()
    tokensNow = u.context.tokens
    Object.assign(t, measure(u))
  } catch (err) {
    t.measure = 'unavailable'
    t.error = errorText(err)
  }
  const form = api ? await api().catch((): readonly unknown[] => []) : []
  // a form at its window may have lost its oldest messages: no chars then
  if (form.length > 0 && !apiCut(form)) t.chars = apiChars(form)
  if (reg) {
    const save = update ? async (ratio: number) => void (await update(r => ({ ...r, charsPerToken: ratio }))) : undefined
    t.ratio = await calibrate(t.chars, t, reg, save)
  }
  if (rows.length && opts.cache !== false) {
    const shape = cacheShape(rows, form)
    const start = lookbackStart(shape)
    t.cache = { start, tokens: tailTokens(shape, start, t.ratio ?? PLAIN_RATIO, wholeOf(t)), approx: t.ratio === undefined, rows: rows.length }
  }
  if (!reg) return t
  // the first model response after an apply: the request now against the one before it
  const last = reg.lastApply
  if (last && (t.measure === 'messages' || t.measure === 'request') && tokensNow !== undefined && tokensNow !== last.tokensBefore) {
    // a negative change (more rows added than freed) is no freeing: not shown
    if (last.tokensBefore > tokensNow) t.measuredFreed = last.tokensBefore - tokensNow
    if (update) await update(r => (r.lastApply?.at === last.at ? dropLastApply(r) : r)).catch(() => undefined)
  }
  const chain = chainOf(reg)
  t.regions = chainStarts(rows, chain).map(({ first, lost }, i) => {
    const s = chain[i]!
    return {
      name: s.name,
      kind: (isTask(s) ? 'task' : 'stage') as RegionKind,
      first,
      chars: charsOf(rows, first, rows.length - 1),
      turnsAgo: Math.max(0, reg.turn - s.openedTurn),
      lost,
    }
  })
  if (reg.lastClosed) {
    const b = reg.lastClosed
    const s0 = startOf(rows, b.after)
    const e = markIndex(rows, b.end)
    const end = typeof e === 'number' && e >= 0 ? e : undefined
    t.lastClosed = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(isTask(b) ? { kind: 'task' as const } : {}),
      start: s0,
      ...(end !== undefined ? { end } : {}),
      ...(end !== undefined && s0 <= end ? { chars: charsOf(rows, s0, end) } : {}),
      lost: e === 'lost',
      startLost: markIndex(rows, b.after) === 'lost',
    }
  }
  const ix = indexRows(rows)
  t.reviews = activeReviews(rows, reg, ix)
  const slot = stateRow(rows, reg, ix)
  t.state = slot === undefined ? 'none' : slot < 0 ? 'lost' : { row: slot }
  t.disposable = reg.tags.filter(tag => tag.kind === 'disposable' && resolveTarget(rows, tag.target, ix)).length
  t.notes = { count: reg.notes.length, reminders: reg.notes.filter(n => n.remindAt !== undefined).length }
  // [SP_CTX_02_28] phase 30 (CF-34): the automatic rules add nothing to a full registry
  const full = registryFull(reg)
  if (full) t.tagsFull = full
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

function blockLabel(name: string | undefined, kind?: RegionKind): string {
  return name !== undefined ? `Last block "${name}"${kind === 'task' ? ' (task)' : ''}` : 'Last block (no stage)'
}

// [SP_CTX_02_28] [SP_CTX_02_38] The cache line: by default an apply rewrites
// the whole conversation; with "keep_cache" ([SP_CTX_DEC_22]) an edit from
// LookbackStart on keeps the prompt cache up to it.
function cacheLine(t: Telemetry): string {
  const c = t.cache
  if (!c) return ''
  const head = 'Cache: an apply rewrites the whole conversation once'
  const lookback = `the API's ~${CACHE_LOOKBACK}-position cache lookback`
  if (c.start >= c.rows) return `${head}; even the last response is beyond ${lookback}, so "keep_cache" would not help`
  if (c.start === 0) return `${head}; with "keep_cache": true only the rows from its earliest edit (the whole conversation is within ${lookback})`
  return `${head}; with "keep_cache": true, an earliest edit from #${c.start} on (within ${lookback}) rewrites only the rows from it (at most ~${tokensText(c.tokens)} tokens${c.approx ? ' (approx.)' : ''}) if your turn ends soon: edits apply at its end, and each call until then pushes them deeper`
}

// [SP_CTX_02_28] TelemetryText(t): one line per part.
export function telemetryText(t: Telemetry): string {
  const lines: string[] = []
  const auto = t.autoCompactLeft !== undefined ? `; auto-compaction in ~${tokensText(Math.max(0, t.autoCompactLeft))}` : t.autoCompactOff ? '; auto-compaction off' : ''
  const window = t.window !== undefined ? tokensText(t.window) : '?'
  switch (t.measure) {
    case 'messages':
      // [SP_CTX_02_28] the FIXED_IN_MESSAGES rows lie in the first message: named apart from the fixed part
      if (t.attached)
        lines.push(
          `Context: conversation ~${tokensText(t.conversation ?? 0)} tokens; fixed part (system prompt, tools) ~${tokensText(Math.max(0, (t.fixed ?? 0) - t.attached))}; attached in the first message (memory, skills, MCP instructions, agents) ~${tokensText(t.attached)}; window ${window}${auto}`,
        )
      else lines.push(`Context: conversation ~${tokensText(t.conversation ?? 0)} tokens; fixed part (system prompt, tools, skills, memory) ~${tokensText(t.fixed ?? 0)}; window ${window}${auto}`)
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
  const cache = cacheLine(t)
  if (cache) lines.push(cache)
  // [SP_HELP_02_13] after the Cache line: the clock, the helper, the clock's checks
  if (t.clock) lines.push(clockLine(t.clock.last, t.clock.now))
  if (t.deferred) lines.push(deferredLine(t.deferred))
  const summary = t.journal && !('unreadable' in t.journal) ? t.journal : undefined
  if (summary?.helper) lines.push(helperLine(summary.helper))
  if (summary?.checks) lines.push(checksLine(summary.checks))
  // [SP_CTX_02_28] only when something is left out
  if (t.hostAttach?.copies)
    lines.push(`Host attachments: ${t.hostAttach.copies} stale cop${t.hostAttach.copies === 1 ? 'y' : 'ies'} of instruction files and skill listings left out of each request (${estimate(t.hostAttach.chars, t.ratio)})`)
  if (!t.registry) return lines.join('\n')
  const startGone = '; its start row is gone, so it runs from #0'
  // [SP_FOLD_02_07] one region: its line as before; a chain: outer to inner
  const region = (s: Telemetry['regions'][number], capital: boolean) =>
    `${regionWord(s, capital)} "${s.name}" open from #${s.first} (opened ${s.turnsAgo} turn(s) ago), ${estimate(s.chars, t.ratio)}${s.lost ? `; its start row is gone, so it runs from #${s.first}` : ''}`
  lines.push(
    t.regions.length === 0
      ? 'No open stage'
      : t.regions.length === 1
        ? region(t.regions[0]!, true)
        : `Open regions, outer to inner: ${t.regions.map(s => region(s, false)).join(' ▸ ')}`,
  )
  const b = t.lastClosed
  if (b) {
    const head = blockLabel(b.name, b.kind)
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
  if (t.tagsFull) lines.push(tagsFullLine(t.tagsFull))
  if (t.measuredFreed !== undefined)
    lines.push(`Last apply: ~${tokensText(t.measuredFreed)} tokens freed (measured: request before it − request now; net of the rows added since)`)
  return lines.join('\n')
}

// [SP_HELP_02_13] Deferred: the batches waiting in the queue, the turn of
// the oldest, and the cache they alone would rewrite were they applied now;
// the warm variant (the cold one and the idle part come with phase 5).
export function deferredLine(d: DeferredView & { tokens?: number }): string {
  const oldest = d.oldest !== undefined ? `, the oldest from turn ${d.oldest}` : ''
  const cost = d.tokens !== undefined ? `applying them now would rewrite ~${tokensText(d.tokens)} tokens of cache; ` : ''
  return `Deferred: ${d.batches} batch(es), ${d.edits} edit(s)${oldest}; ${cost}they wait for an apply that starts no later, or a handoff.`
}

// [SP_HELP_02_13] Helper: the sums of the journal's `ask` entries and their
// cost at the helper's list prices (an upper estimate).
export function helperLine(h: HelperSummary): string {
  const k = (n: number) => `~${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  const cost = helperCost(h.in, h.out).toFixed(2)
  return `Helper: ${h.questions} question(s), ${h.calls} call(s), ${k(h.in)} in / ${k(h.out)} out tokens (~$${cost}); quotes verified ${h.verified}, rejected ${h.rejected}.`
}

// ---- [SP_CTX_02_01] context_list

// What context_list reads; register.ts binds it to `$`. Each port that takes
// `dir` works in the storage the listing took once ([SP_CTX_01_07]).
export type ListIO = {
  // [SP_CTX_02_18] CurrentRows and the key of their start
  view: () => Promise<{ rows: readonly SessionMessage[]; key: string }>
  // the API form: media sizes ([SP_CTX_02_10]) and the Cache line ([SP_CTX_02_38])
  api: () => Promise<readonly unknown[]>
  // the folder of the current session's storage; undefined: none
  storage: () => Promise<string | undefined>
  readTags: (dir: string) => Promise<Read<TagRegistry>>
  readAliases: (dir: string) => Promise<Read<AliasRegistry>>
  usage: () => Promise<UsageInfo>
  // [SP_CTX_02_34] [SP_CTX_02_28] the registry's Update port in `dir`
  updateTags: (dir: string) => RegistryUpdate
  // [SP_CTX_02_31] the journal's summary in `dir`
  journal: (dir: string) => Promise<JournalSummary | undefined>
  // [SP_CTX_02_33] the due reminders, delivered with the listing
  dueLines: () => Promise<string[]>
  // [SP_CTX_02_18] listedKey = key
  setListed: (key: string) => void
  // [SP_CTX_02_28] [SP_CTX_02_40] what the host attachments' answers in `dir`
  // leave out; absent or undefined: no line
  hostAttach?: (dir: string) => Promise<{ copies: number; chars: number } | undefined>
  // [SP_CTX_02_61] the host rows' records in `dir`; absent or none: no list
  hostRows?: (dir: string) => Promise<readonly HostRowRecord[]>
  // [SP_CTX_02_69] the text of RULES_FILE from the plugin's root; throws when unreadable
  rules?: () => Promise<string>
  // [SP_FOLD_02_07] the fold ledger in `dir`, a view; absent: none
  folds?: (dir: string) => Promise<Read<FoldLedger>>
  // [SP_HELP_02_13] the cache clock's memory time of this session and the
  // time now; absent: no Cache clock line
  clock?: () => Promise<{ memory?: number; now: number }>
  // [SP_HELP_02_13] the queue in `dir`, a view: the Deferred line; absent: none
  queue?: (dir: string) => Promise<Read<Queue>>
}

export type ListArgs = { agentId?: unknown; from?: unknown; count?: unknown; index?: unknown; full?: unknown; rules?: unknown; folds?: unknown }

// [SP_CTX_02_69] The curation rules: the skill's second file, which
// context_list with "rules": true returns ([SP_CTX_DEC_43]).
export const RULES_FILE = 'curation.md'

// [SP_CTX_02_01] The listing's labels: stage marks, then tag labels, then
// note marks; the note lines under the page. None without storage; an
// unreadable registry says why. `reg`: the registry read, for the telemetry.
export type ListLabels = { labels: Map<number, string[]>; note: string; reg?: TagRegistry; notes: NoteLine[] }

export function listLabels(rows: readonly SessionMessage[], read: Read<TagRegistry> | undefined): ListLabels {
  const none = new Map<number, string[]>()
  if (!read) return { labels: none, note: '', reg: undefined, notes: [] }
  if (read.state === 'unreadable') return { labels: none, note: `\n(tags, stages and notes not shown: the tag registry cannot be read: ${read.reason})`, reg: undefined, notes: [] }
  const merged = markLabels(rows, read.value)
  for (const [i, list] of tagLabels(rows, read.value)) merged.set(i, [...(merged.get(i) ?? []), ...list])
  // [SP_CTX_02_01] the notes after the tags; their full text under the page
  for (const [i, list] of noteLabels(rows, read.value)) merged.set(i, [...(merged.get(i) ?? []), ...list])
  return { labels: merged, note: '', reg: read.value, notes: noteLines(rows, read.value) }
}

// [SP_CTX_02_01] The call aliases by tool_use_id for the listing; none
// without storage; an unreadable alias registry says why.
export function listAliases(read: Read<AliasRegistry> | undefined): { aliases: Map<string, string>; note: string } {
  if (!read) return { aliases: new Map<string, string>(), note: '' }
  if (read.state === 'unreadable') return { aliases: new Map<string, string>(), note: `\n(aliases not shown: the alias registry cannot be read: ${read.reason})` }
  return { aliases: aliasesById(read.value), note: '' }
}

// [SP_CTX_02_01] context_list: a page of rows with the header and the
// telemetry, or one row whole. [SP_CTX_02_18] Only a page with rows renews
// listedKey: `count: 0` and `full` do not. The due reminders go with the
// result once it is built ([SP_CTX_02_33]).
// [SP_CTX_02_69] [SP_CTX_03_03] "rules": true returns the curation rules in
// place of the listing and takes no other parameter (BAD_RULES); an unreadable
// file is the mod's line, not a refusal.
async function curationRules(io: ListIO, args: ListArgs): Promise<{ result: string } | { deny: string }> {
  if (args.rules !== true) return { deny: '"rules" takes only true: it returns the curation rules (BAD_RULES)' }
  const other = (['from', 'count', 'index', 'full'] as const).filter(k => args[k] !== undefined)
  if (other.length) return { deny: `"rules": true takes no other parameter (${other.join(', ')}) (BAD_RULES)` }
  try {
    if (!io.rules) throw new Error('no rules port')
    return { result: await io.rules() }
  } catch (err) {
    return { result: modText(`the curation rules could not be read: ${errorText(err)}`) }
  }
}

// [SP_FOLD_02_07] "folds": true returns the fold ledger in place of the rows
// and takes only "from" and "count", which page it (BAD_FOLDS); it renews no
// listedKey. An unreadable ledger is a line of the result, not a refusal.
async function foldLedger(io: ListIO, args: ListArgs): Promise<{ result: string } | { deny: string }> {
  if (args.folds !== true || (['index', 'full', 'rules'] as const).some(k => args[k] !== undefined)) return { deny: BAD_FOLDS }
  const dir = await io.storage()
  const read = dir && io.folds ? await io.folds(dir).catch((err): Read<FoldLedger> => ({ state: 'unreadable', reason: errorText(err) })) : undefined
  return { result: foldsList(read, args.from, args.count) }
}

export async function contextList(io: ListIO, args: ListArgs): Promise<{ result: string } | { deny: string }> {
  if (args.agentId) return { deny: 'only the main conversation can be listed and edited.' }
  // [SP_FOLD_02_07] "folds": false is the listing as without it
  const folds = args.folds !== undefined && args.folds !== false
  if (args.rules !== undefined && !folds) return curationRules(io, args)
  if (folds) return foldLedger(io, args)
  const { rows, key } = await io.view()
  const mode = listMode(args, rows.length)
  if ('bad' in mode) return { deny: mode.bad }
  const form = await io.api()
  const { found } = collectMedia(form, rows)
  const dir = await io.storage()
  const tagged = listLabels(rows, dir ? await io.readTags(dir) : undefined)
  // [SP_CTX_02_01] one row whole: no telemetry, no new listedKey
  if ('full' in mode) {
    const own = tagged.reg ? rowNotes(rows, tagged.reg, mode.full) : []
    const result = fullRow(rows, mode.full, found, tagged.labels.get(mode.full) ?? [], own) + tagged.note
    return withReminderLines({ result }, await io.dueLines())
  }
  const named = listAliases(dir ? await io.readAliases(dir) : undefined)
  const { from, count } = mode.page
  // [SP_CTX_02_28] a failed telemetry never fails the listing; [SP_CTX_02_34] it calibrates the estimates
  let tele: string
  let size: string | undefined
  try {
    // [SP_CTX_02_33] counted as if this call's due reminders were delivered;
    // they are delivered only once the listing is built (a failure keeps them)
    const update = dir ? io.updateTags(dir) : undefined
    const t = await telemetry(rows, tagged.reg && afterReminders(tagged.reg), io.usage, update, dir ? await io.journal(dir) : undefined, io.api)
    const left = dir && io.hostAttach ? await io.hostAttach(dir).catch(() => undefined) : undefined
    if (left) t.hostAttach = left
    // [SP_HELP_02_09] the later of the registry's time and the memory's
    const clock = io.clock ? await io.clock().catch(() => undefined) : undefined
    if (clock) t.clock = { last: lastRequest(tagged.reg?.cache, clock.memory), now: clock.now }
    // [SP_HELP_02_13] the deferred batches and what they alone would rewrite now
    const q = dir && io.queue ? await io.queue(dir).catch(() => undefined) : undefined
    const view = q && q.state !== 'unreadable' ? deferredView(q.value) : undefined
    if (view && q && q.state !== 'unreadable') {
      const ratio = t.ratio ?? PLAIN_RATIO
      const whole = wholeOf(t) ?? t.request ?? Math.round((t.chars ?? totalChars(rows)) / ratio)
      const tokens = deferredRewrite(q.value.edits, cacheShape(rows, form), firstRowOf(rows), whole, ratio)
      t.deferred = { ...view, ...(tokens !== undefined ? { tokens } : {}) }
    }
    tele = telemetryText(t)
    size = headerSize(t, t.chars ?? totalChars(rows))
  } catch (err) {
    tele = `Context: size unavailable (${errorText(err)})`
  }
  // [SP_CTX_02_61] the host rows: a header line (count 0 too), and their list
  // after a page that holds the newest row; the indexes stay as they are
  const host: HostRows = { rows: dir && io.hostRows ? [...(await io.hostRows(dir).catch(() => []))] : [], next: 1 }
  const header = hostHeader(host)
  if (header) tele = `${tele}\n${header}`
  // [SP_FOLD_02_07] the recalls not yet returned, when there are any
  const recalled = recallsHeader(dir && io.folds ? await io.folds(dir).catch(() => undefined) : undefined, rows)
  if (recalled) tele = `${tele}\n${recalled}`
  const newest = count >= 1 && Math.min(Math.max(0, Math.trunc(from)), Math.max(0, rows.length - 1)) + Math.min(count, MAX_LIST_COUNT) >= rows.length
  const section = newest ? hostSection(host) : ''
  const text = listRows(rows, from, count, found, tagged.labels, named.aliases, tele, tagged.notes, size) + (section ? `\n${section}` : '')
  // [SP_CTX_02_18] only a listing with rows the agent receives renews its indexes
  if (count >= 1) io.setListed(key)
  return withReminderLines({ result: text + tagged.note + named.note }, await io.dueLines())
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
  // [SP_CTX_02_34] stores a new calibration in the registry, on its chain (Update)
  updateTags?: RegistryUpdate
  // [SP_CTX_02_31] the journal's summary for the telemetry; absent: no line
  journal?: () => Promise<JournalSummary>
  // [SP_CTX_02_38] the API form for the Cache line of the telemetry
  api?: () => Promise<readonly unknown[]>
  // [SP_CTX_02_18] listedKey = key: the report lists the block's row indexes
  setListed: (key: string) => void
  // [SP_CTX_02_54] the host passes over the mod's compaction hook: PASSED_ADVICE
  // ends the report; absent: never
  passed?: () => boolean
  // [SP_CTX_02_66] the call aliases and the project root (`cwd`) of the ready replacements; absent: ids, absolute paths
  readAliases?: () => Promise<Read<AliasRegistry>>
  cwd?: () => Promise<string | undefined>
}

// [SP_CTX_02_29] What BlockReport takes from the host besides the conversation.
export type BlockHost = Omit<BlockIO, 'key' | 'rows' | 'media' | 'api'>

// [SP_CTX_02_18] [PL_AUD_CTX_P11] BlockReport on the snapshot of its call:
// Key(), the rows, the media sizes and the Cache line from one read each.
export function snapshotBlockIO(snap: Snapshot, host: BlockHost): BlockIO {
  return { ...host, key: snap.key, rows: snap.rows, media: async () => collectMedia(await snap.api(), await snap.rows()).found, api: snap.api }
}

// [SP_CTX_02_11] [PL_AUD_CTX_P11] The ports of one context_tag call over one
// snapshot (CF-21): the requests, QueueTagReplacements (on the queue's chain,
// through `onQueue`) and each close report read the same rows. `block` gives
// the report's host once a close needs it. register.ts binds the rest.
export function tagCallIO(snap: Snapshot, registry: Omit<TagIO, 'rows' | 'replace' | 'report'>, onQueue: <T>(work: () => Promise<T>) => Promise<T>, block: () => BlockHost): TagIO {
  const base: TagIO = { ...registry, rows: snap.rows }
  return {
    ...base,
    replace: () => onQueue(() => queueTagReplacements(base)),
    report: (b, replaced, waiting) => blockReport(snapshotBlockIO(snap, block()), b, replaced, waiting),
  }
}

// [SP_CTX_02_13] What QueueTagReplacements queued.
// `freed`: Estimate of the replaced text less the notes ([SP_CTX_02_34])
// `dropped`: the lines of disposable tags removed because they cover the person's words ([SP_CTX_02_58])
// `resumes`: ResumesAfter of the batch once they were queued ([SP_CTX_02_02])
export type Replaced = { queued: number; freed: string; resumes?: boolean; dropped?: string[] }

// [SP_CTX_02_13] [SP_CTX_DEC_16] A batch of tag replacements alone does not
// resume the session (ResumesAfter): the close report says so, so an agent
// moving on to its next stage does not end its turn and stop.
export const TAGS_STOP = 'On their own they do not resume the session: keep working in this turn, or pass a "resume_prompt" to context_edit before you end it.'

// The rows of a tag's target that lie in a..e, the first of them, or -1.
function firstIn(rows: readonly SessionMessage[], tag: Tag, a: number, e: number, ix: RowIndex): number {
  const at = (resolveTarget(rows, tag.target, ix) ?? []).filter(i => i >= a && i <= e)
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
// A collapse carrier is a note, not a reproducible pair.
function reproduciblePairs(rows: readonly SessionMessage[], a: number, e: number, ix: RowIndex): number {
  let n = 0
  const carriers = carrierIds(rows.slice(a, e + 1))
  for (let i = a; i <= e; i++)
    for (const u of rows[i]!.toolUses) {
      if (!REPRODUCIBLE_TOOLS.includes(u.tool) || carriers.has(u.tool_use_id)) continue
      const res = ix.resultAt(u.tool_use_id)
      if (res >= a && res <= e) n++
    }
  return n
}

// [SP_CTX_02_66] The ready text of a review reason, or undefined: none.
function readyText(reason: Tag['reason'], path: string): string | undefined {
  if (reason === 'superseded') return `Outdated: ${path} was read again later and its content had changed.`
  if (reason === 'stale') return `Outdated: you changed ${path} later.`
  if (reason === 'duplicate') return `Duplicate: a later read repeated this read of ${path}.`
  return undefined
}

export const READY_HEAD = 'Ready replacements (summarize each with its text and what you still need from it): '

// [SP_CTX_02_66] ReadyReplacements: the Read pairs with call and result in
// a..e under an active review `superseded`, `stale` or `duplicate`, not
// compressed yet, each with the text of its summarize, in row order (at most
// MAX_BLOCK_INDEXES, then "+<n> more"); "" when none. The texts hold no index:
// it shifts after an apply. Pure.
export function readyReplacements(rows: readonly SessionMessage[], reg: TagRegistry, a: number, e: number, ix: RowIndex, aliases: ReadonlyMap<string, string>, cwd?: string): string {
  const ready: { at: number; line: string }[] = []
  for (const tag of reg.tags) {
    if (tag.kind !== 'review' || !isActive(tag, reg.turn) || !('tool_use_id' in tag.target)) continue
    const id = tag.target.tool_use_id
    const at = ix.useAt(id)
    const res = ix.resultAt(id)
    if (at < a || at > e || res < a || res > e) continue
    const use = rows[at]!.toolUses.find(u => u.tool_use_id === id)
    const result = resultsOf(rows[res]!).find(t => t.tool_use_id === id)
    if (use?.tool !== 'Read' || !result || isReplacementText(result.text)) continue
    const path = sourceOf('Read', use.input, cwd).slice('Read '.length)
    const text = path ? readyText(tag.reason, path) : undefined
    if (text) ready.push({ at, line: `#${at} ${aliases.get(id) ?? id} "${text}"` })
  }
  if (!ready.length) return ''
  ready.sort((x, y) => x.at - y.at)
  const shown = ready.slice(0, MAX_BLOCK_INDEXES).map(r => r.line)
  if (ready.length > MAX_BLOCK_INDEXES) shown.push(`+${ready.length - MAX_BLOCK_INDEXES} more`)
  return READY_HEAD + shown.join('; ') + '.'
}

// [SP_CTX_02_29] BlockReport: only for a close by the tool, where no
// compaction comes between the close and the report, so its indexes hold; a
// report with the block's rows renews listedKey as a listing does.
export async function blockReport(io: BlockIO, block: ClosedBlock, replaced?: Replaced, waiting = false): Promise<string> {
  const key = await io.key()
  const rows = await io.rows()
  const read = await io.readTags()
  const reg = read.state === 'unreadable' ? undefined : read.value
  // first: the calibration gives the ratio, so the block's size and the
  // telemetry below use one ratio (review round 39)
  const journal = io.journal ? await io.journal().catch((err): JournalSummary => ({ unreadable: errorText(err) })) : undefined
  const t = await telemetry(rows, reg, io.usage, io.updateTags, journal, io.api)
  const a = startOf(rows, block.after)
  const e = markIndex(rows, block.end)
  const hasRows = e !== 'lost' && block.end !== null && a <= e
  // [SP_CTX_DEC_37] the block the mark left waiting, reported once the agent moves on
  let head = waiting
    ? `You marked ${blockName(block)} with ${OPTIMIZE_MARK}; it waited for compression until this call: `
    : block.name !== undefined
      ? `${regionWord(block, true)} "${block.name}" closed: `
      : 'Block (no stage): '
  if (e === 'lost') head += 'its end row is gone; call context_list.'
  else if (!hasRows) head += 'no rows in it.'
  else {
    const media = await io.media()
    let count = 0
    let bytes = 0
    for (let i = a; i <= e; i++) {
      const keys = [...resultsOf(rows[i]!).map(r => ownerKey({ tool_use_id: r.tool_use_id })), ownerKey({ row: i })]
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
    const ix = indexRows(rows)
    for (const tag of reg?.tags ?? []) {
      if (tag.kind === 'review' && isActive(tag, reg!.turn)) {
        const at = firstIn(rows, tag, a, e as number, ix)
        if (at >= 0) reviews.set(reviewGroup(tag), [...(reviews.get(reviewGroup(tag)) ?? []), at])
      }
      if (tag.kind === 'disposable') {
        const at = firstIn(rows, tag, a, e as number, ix)
        if (at >= 0) disposables.push(at)
      }
    }
    const repro = reproduciblePairs(rows, a, e as number, ix)
    const cand = [
      ...REVIEW_GROUPS.map(g => indexList(groupName(g), reviews.get(g) ?? [])),
      indexList('disposable', disposables),
      repro ? `reproducible pairs (${REPRO_FLAG}) ${repro}` : '',
    ]
      .filter(Boolean)
      .join('; ')
    text += `\nCandidates in the block: ${cand || 'none'}.`
    // [SP_CTX_02_66] the ready replacements of the block's outdated and duplicate reads
    if (reg) {
      const aliasRead = await io.readAliases?.().catch(() => undefined)
      const aliases = aliasRead && aliasRead.state !== 'unreadable' ? aliasesById(aliasRead.value) : new Map<string, string>()
      const ready = readyReplacements(rows, reg, a, e as number, ix, aliases, await io.cwd?.().catch(() => undefined))
      if (ready) text += '\n' + ready
    }
    // [SP_CTX_02_32] the agent's notes on rows of the block
    const notes = reg ? blockNotes(rows, reg, a, e as number, MAX_BLOCK_INDEXES) : ''
    if (notes) text += `\nYour notes in the block: ${notes}`
  }
  if (replaced && replaced.queued > 0)
    text += io.passed?.()
      ? `\nReplacements from your disposable tags queued: ${replaced.queued} (not applied on this host; the brief of the person's /compact carries them).`
      : `\nReplacements from your disposable tags queued: ${replaced.queued} (${replaced.freed} freed when this turn ends).${replaced.resumes === false ? ` ${TAGS_STOP}` : ''}`
  // [SP_CTX_02_58] tags over the person's words, removed instead of queued
  for (const line of replaced?.dropped ?? []) text += `\n${line}.`
  text += '\n' + telemetryText(t)
  if (hasRows) {
    text += '\n' + (io.passed?.() ? PASSED_ADVICE : (waiting ? WAIT_MOVED + ' ' : '') + STAGE_ADVICE + (isTask(block) ? ' ' + TASK_CARD : ''))
    io.setListed(key)
  }
  return text
}

// [SP_CTX_02_29] REPORT_FAILED: the stage is closed and written already.
export function reportFailed(block: ClosedBlock, err: unknown): string {
  const what = block.name !== undefined ? `${regionWord(block, true)} "${block.name}"` : 'The block'
  return `${what} closed; its report failed: ${errorText(err)}; call context_list`
}

// [SP_CTX_02_29] [SP_CTX_DEC_37] The advice of the waiting block's report.
export const WAIT_MOVED = 'You are moving on from it: compress it now unless the next stage still needs its details; it no longer waits.'

export function blockName(block: ClosedBlock): string {
  return block.name !== undefined ? `${regionWord(block)} "${block.name}"` : 'the last block (no stage)'
}

export const LIST_HINT =
  " Call context_list: its header names the block's range (Last block #<a>..#<b>, or Last block from #<a> when its end row is gone); list from its first row (from=<a>) to see those rows ([block ▶ …] .. [block end]) before you edit by index."

// [SP_CTX_02_29] [SP_CTX_DEC_15] [SP_CTX_DEC_37] WaitingAdvice: the first
// prompt after the mark names the waiting block; no indexes, sizes or
// candidates: the listing shows the block's bounds. A waiting task block
// gets TASK_CARD, as its close report does ([SP_FOLD_02_05]).
export function waitingAdvice(block: ClosedBlock, notes = 0): string {
  return (
    modText(`you ended your previous answer with ${OPTIMIZE_MARK}; ${blockName(block)} waits for compression.`) +
    ' If this prompt moves on to the next stage, compress the block in this turn: edits apply when it ends. If it continues that stage, leave the block as it is; opening the next stage with context_tag reports it again.' +
    LIST_HINT +
    notesHint(notes) +
    '\n' +
    STAGE_ADVICE +
    (isTask(block) ? ' ' + TASK_CARD : '')
  )
}

// [SP_CTX_02_42] [C_CTX_DEC_23] The prompt of the compression turn the
// person's plain /compact starts: the whole conversation is the block, the
// advice is STAGE_ADVICE, and the batch stops the session as a compression
// turn's does ([SP_CTX_DEC_16]). The mod's own text: the host's frame of a
// plugin's prompt says it starts the turn "in the user's place".
export function compactTurnText(notes = 0): string {
  return (
    modText(
      "the person ran /compact. With this mod on, the host's summary does not run: you compress the conversation yourself in this turn, and the mod applies your batch when the turn ends.",
    ) +
    ' Call context_list ("count":0 gives the telemetry and the candidates by reason; then list the rows from the start). Close an open stage whose work is done with context_tag {"tags":[{"op":"close"}]}; then treat the conversation up to the current work as the block: collapse finished stages into stage records and summarize big outputs you have used.' +
    notesHint(notes) +
    '\n' +
    STAGE_ADVICE +
    '\nThe session stops after this batch: pass "resume": true (or a resume_prompt) in context_edit only if a task was running and should go on. End your turn with a one-line status. Trailer lines have no effect in this turn.'
  )
}

// [SP_CTX_01_12] [SP_CTX_02_42] The toast when the compression turn of the
// person's /compact ended (not interrupted) with nothing queued.
export const COMPACT_NOTHING = modText("/compact: the agent compressed nothing; /compact host runs the host's summary.")

// ---- [SP_CTX_02_27] SessionIntro

// [SP_CTX_DEC_36] The skill's guide for the first prompt: GUIDE_FRAME and
// SKILL.md after its frontmatter; none for an empty body or a frontmatter
// left open (GUIDE_UNREAD).
export function guideText(file: string): string | undefined {
  const m = /^---\r?\n[\s\S]*?\r?\n---[^\n]*(?:\n|$)/.exec(file)
  if (!m && /^---\r?\n/.test(file)) return undefined
  const body = (m ? file.slice(m[0].length) : file).trim()
  return body ? GUIDE_FRAME + body : undefined
}

// The guide (or INTRO_TEXT without one) while the registry (ok or missing)
// has not recorded the intro; INTRO_TEXT once another compaction took it
// (`reintroduce`); none from an unreadable registry: there is nowhere to
// record the delivery.
export function introFor(read: Read<TagRegistry>, guide?: string): string | undefined {
  if (read.state === 'unreadable') return undefined
  if (!read.value.introduced) return guide ?? INTRO_TEXT
  return read.value.reintroduce ? INTRO_TEXT : undefined
}

// The registry once the intro entered: a missing one is made with defaults;
// an unreadable one is left alone (undefined).
export function withIntroduced(read: Read<TagRegistry>): TagRegistry | undefined {
  if (read.state === 'unreadable') return undefined
  const reg = read.state === 'missing' ? { ...EMPTY_REGISTRY, tags: [] } : read.value
  if (reg.introduced && !reg.reintroduce) return undefined
  const { reintroduce: _, ...rest } = reg
  return { ...rest, introduced: true }
}

// [SP_CTX_02_29] WaitingAdvice for the first prompt after the mark, from the
// registry as it is now; none unless a block waits and its advice has not
// gone yet (WAIT_NO_BLOCK).
export function adviceFor(read: Read<TagRegistry>): string | undefined {
  return read.state !== 'unreadable' && read.value.waiting === 'marked' && read.value.lastClosed
    ? waitingAdvice(read.value.lastClosed, read.value.notes.length)
    : undefined
}

// [SP_CTX_02_08] [SP_CTX_02_06] AdviseWaiting: marked → advised once the
// advice entered, compare-and-set; undefined writes nothing.
export function adviseWaiting(read: Read<TagRegistry>): TagRegistry | undefined {
  return read.state !== 'unreadable' && read.value.waiting === 'marked' ? { ...read.value, waiting: 'advised' } : undefined
}

// [SP_CTX_02_02] [SP_CTX_02_11] The waiting block ends: the registry without
// `waiting` and the block that waited; undefined when none waits. Pure.
export function endWaiting<R extends TagRegistry>(reg: R): { registry: R; block: ClosedBlock } | undefined {
  if (!reg.waiting || !reg.lastClosed) return undefined
  const { waiting: _w, ...rest } = reg
  return { registry: rest as R, block: reg.lastClosed }
}

// ---- [SP_CTX_02_30] DetectOptimize

// [SP_CTX_02_30] [SP_CTX_DEC_14] The block of the mark: a region closed by
// the tool in this turn stays the block (a region opened after it stays
// open); else the deepest open region closes at the end of the turn
// ([SP_FOLD_01_05]: the regions around it stay open); without one, a block
// without a stage from the previous block's end (or the head) to the end of
// the turn. [SP_CTX_DEC_37] A block still waiting merges with the new one:
// its start, the new end, its name and kind unless a region closed now. The
// block then waits (`marked`). Lost starts become null. Pure.
export function markClose(reg: TagRegistry, rows: readonly SessionMessage[]): TagRegistry {
  const r = normalizeLost(reg, rows)
  if (r.lastClosed && r.lastClosed.turn === r.turn) return { ...r, waiting: 'marked' }
  const end = markBefore(rows, rows.length)
  const waited = r.waiting && r.lastClosed ? r.lastClosed : undefined
  const chain = chainOf(r)
  // [SP_FOLD_02_05] a region that starts no later than the waiting block
  // holds it (the task or stage around the stage the last mark closed): the
  // second mark extends the waiting block and leaves that region open
  const holds = (s: Stage) => !!waited && startOf(rows, s.after) <= startOf(rows, waited.after)
  const deepest = chain.at(-1)
  const closes = deepest && !holds(deepest) ? deepest : undefined
  const rest = closes ? withChain(r, chain.slice(0, -1)) : r
  let block: ClosedBlock
  if (closes)
    block = waited
      ? { after: waited.after, end, turn: r.turn }
      : { name: closes.name, after: closes.after, end, turn: r.turn, ...(isTask(closes) ? { kind: 'task' as const } : {}) }
  else if (waited) block = { ...(waited.name !== undefined ? { name: waited.name } : {}), ...(isTask(waited) ? { kind: 'task' as const } : {}), after: waited.after, end, turn: r.turn }
  else block = { after: r.lastClosed ? r.lastClosed.end : null, end, turn: r.turn }
  return { ...rest, lastClosed: block, waiting: 'marked' }
}

// [SP_FOLD_02_06] The trailer `close`, `count` times at the end of the turn:
// each closes the deepest open region without waiting; the block, the
// outermost region closed, ends at the end of the turn. A block still
// waiting ends first, as when the tool closes a region ([SP_CTX_DEC_37]);
// nothing is queued. `depth`: the length of the chain left. Undefined when no
// region is open. Lost starts become null. Pure.
export function closeAtTurnEnd<R extends TagRegistry>(reg: R, rows: readonly SessionMessage[], count: number): { registry: R; depth: number } | undefined {
  const r = normalizeLost(reg, rows)
  const chain = chainOf(r)
  if (!chain.length || count < 1) return undefined
  const closed = closeStage(endWaiting(r)?.registry ?? r, rows, rows.length, Math.max(0, chain.length - count))!
  return { registry: closed.registry, depth: closed.depth }
}

// What DetectOptimize needs from the host; register.ts binds it to `$`.
export type DetectIO = {
  ready: () => Promise<boolean>
  readQueue: () => Promise<Read<Queue>>
  // on the queue chain, the Change contract ([SP_CTX_01_07]): `change` sees
  // the queue as read then, unreadable too; undefined writes nothing; a
  // failed write rejects
  changeQueue: Change<Queue>
  // on the registry chain, the same way
  changeTags: Change<TagRegistry>
  // CurrentRows ([SP_CTX_02_18])
  rows: () => Promise<readonly SessionMessage[]>
  status: (text: string) => void
  // [SP_CTX_02_42] what the person must see in every host
  toast: (text: string) => void
  now: () => number
  // [SP_FOLD_02_03] MarkDue once the mark closed the block: on the fold
  // ledger's chain; its failure only leaves the recalls not due
  markDue?: (after: number) => Promise<void>
}

// [SP_FOLD_02_06] how much of an unknown trailer line the person's status line repeats
export const TRAILER_ECHO = 80

export type DetectOutcome =
  | 'none'
  | 'in-optimization'
  | 'no-storage'
  | 'queue-unreadable'
  | 'handoff'
  | 'registry-unreadable'
  | 'waiting'
  // [SP_FOLD_02_06] `close` or `note` ran, without `optimize`
  | 'trailers'

// [SP_CTX_02_30] [SP_FOLD_02_06] At the end of a turn of the main
// conversation (completed or aborted), before TagRegistry.turn += 1 and
// before Flush is planned, the trailers of the answer run in the order of
// their lines. The mark (`optimize`) closes the block and leaves it waiting:
// no optimization turn, nothing queued ([SP_CTX_DEC_37]); with it the
// answer's `close` lines do not run. `close` closes the deepest open region
// without waiting; `note` puts a note on the row of the answer. An unknown
// trailer and a note not saved give the person a status line; no signal
// queues an edit or starts an apply. The end of the turn after the compression prompt
// of the person's /compact takes the loop guard down and ignores the mark in
// it. None of its failures reaches the agent.
export async function detectOptimize(io: DetectIO, e: { aborted: boolean; answer?: string }): Promise<DetectOutcome> {
  const ready = await io.ready()
  let prompted = false
  // [SP_CTX_02_42] the end of the compression turn of the person's /compact,
  // whether it queued anything, and [SP_HELP_02_10] whether deferred edits wait
  let compacted: { empty: boolean; deferred: boolean } | undefined
  if (ready)
    await io
      .changeQueue(read => {
        if (read.state !== 'ok' || !read.value.optimizePrompted) return undefined
        prompted = true
        // [SP_HELP_02_10] an empty compression turn: no edit without `deferred`
        if (read.value.compact) compacted = { empty: nonDeferred(read.value.edits).length === 0, deferred: nonDeferred(read.value.edits).length < read.value.edits.length }
        // [SP_HELP_02_10] the deferred batches apply after an empty one: applyDeferred without coldSince; Flush counts them by Applicable
        const deferredNow = !!compacted?.empty && compacted.deferred && !e.aborted
        // [SP_CTX_02_42] the batch of an ended compression turn waits for its Flush: compactEndedAt
        const { compactEndedAt: _ended, ...rest } = read.value
        const base: Queue = { ...rest, optimizePrompted: false, compact: false, ...(read.value.compact && !e.aborted ? { compactEndedAt: io.now() } : {}) }
        if (!deferredNow) return base
        const { coldSince: _cold, ...warm } = base
        return { ...warm, applyDeferred: true }
      })
      .catch(() => undefined)
  // COMPACT_NOTHING: the host's summary is never run in its place;
  // [SP_HELP_02_10] not when the deferred batches apply instead (the person sees the apply's line)
  if (compacted?.empty && !compacted.deferred && !e.aborted) io.toast(COMPACT_NOTHING)
  const t = parseTrailers(e.answer)
  if (e.aborted || !t.lines.length) return 'none'
  // MARK_IN_OPTIMIZATION: silently ignored; the mod never loops
  if (prompted) return 'in-optimization'
  // [SP_FOLD_02_06] the person's status lines of this turn end, as one line
  const said: string[] = t.unknown.map(line => `trailer ignored: ${oneLine(line, TRAILER_ECHO)}`)
  const say = () => void (said.length && io.status(modText(said.join('; '))))
  const optimize = t.signals.some(s => s.kind === 'optimize')
  // with `optimize`, the closes of the same answer do not run
  const closes = optimize ? 0 : t.signals.filter(s => s.kind === 'close').length
  const notes = t.signals.flatMap(s => (s.kind === 'note' ? [s.text] : []))
  if (!optimize && !closes && !notes.length) return say(), 'none'
  // a failure common to every signal that is left
  const failAll = (why: string, mark = optimize) => {
    if (mark) said.push(`optimization mark ignored: ${why}`)
    if (closes) said.push(`trailer close ignored: ${why}`)
    if (notes.length) said.push(`trailer note not saved: ${why}`)
  }
  if (!ready) return failAll('storage unavailable'), say(), 'no-storage'
  // the mark's own conditions; the notes run without them
  let markOut: DetectOutcome | undefined
  if (optimize) {
    const q = await io.readQueue()
    const why = q.state === 'unreadable' ? 'the queue is unreadable' : q.value.handoff ? 'a handoff is pending' : undefined
    if (why) {
      said.push(`optimization mark ignored: ${why}`)
      markOut = q.state === 'unreadable' ? 'queue-unreadable' : 'handoff'
    }
  }
  const marks = optimize && !markOut
  // only the mark was left, and it is ignored
  if (!marks && !closes && !notes.length) return say(), markOut!
  let regWhy: string | undefined
  // [SP_FOLD_02_03] the length of the chain the mark or the closes left; undefined: nothing closed
  let depth: number | undefined
  const notSaved: string[] = []
  try {
    const rows = await io.rows()
    await io.changeTags(read => {
      depth = undefined
      notSaved.length = 0
      if (read.state === 'unreadable') {
        regWhy = 'the tag registry is unreadable'
        return undefined
      }
      let next = read.value
      if (marks) {
        next = markClose(next, rows)
        depth = chainOf(next).length
      } else if (closes) {
        const closed = closeAtTurnEnd(next, rows, closes)
        if (closed) {
          next = closed.registry
          depth = closed.depth
        }
      }
      // [SP_CTX_02_32] the notes go on the row of the final answer
      if (notes.length) {
        const at = answerRow(rows, t.lines.at(-1)!)
        if (at === undefined) notSaved.push(...notes.map(() => 'the row of the answer was not found'))
        else {
          const out = applyNoteRequests(next, rows, notes.map(text => ({ op: 'add', index: at, text })))
          if (out.added.length) next = out.registry
          notSaved.push(...out.rejected.map(r => r.reason.replace(/^note \d+: /, '').replace(/; remove notes you no longer need/, '')))
        }
      }
      return next === read.value ? undefined : next
    })
  } catch (err) {
    regWhy = errorText(err)
  }
  if (regWhy) return failAll(regWhy, marks), say(), 'registry-unreadable'
  said.push(...notSaved.map(why => `trailer note not saved: ${why}`))
  say()
  // [SP_FOLD_02_03] the recalls of the closed block are due (the port logs its own failure)
  if (depth !== undefined) await io.markDue?.(depth).catch(() => undefined)
  // [SP_CTX_DEC_37] nothing queued: the mark's block waits for the agent's move to the next stage
  return marks ? 'waiting' : (markOut ?? 'trailers')
}

// ---- [SP_CTX_02_11] context_tag: the carrier row of the call

// The row of `rows` whose calls hold `callId`; len(rows) when it is not
// written yet (the boundary then is the last row, the same one).
export function carrierRow(rows: readonly SessionMessage[], callId: string | undefined): number {
  if (!callId) return rows.length
  const at = findToolUse(rows, callId)
  return at < 0 ? rows.length : at
}
