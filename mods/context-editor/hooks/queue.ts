import type { SessionMessage } from 'claude-code'
import { checkShape, dependencyHits, dependencyNote, DESCRIBE_DROPS, describeEdit, indexRows, isFoldRegion, isHostDrop, isPairEdit, regionOf, foldSpanOf, personRowKind, type ClosedSpan, type RowIndex, ownerKey, type MediaRef, MAX_QUEUE_EDITS, MAX_TEXT, NO_PINS, NO_REFS, prepare, resolveEditRefs, touchedBy, type MediaOwner, type Pinned, type QueuedEdit, type RefResolver } from './edits'
import { personDelivered, personText, type QueuedDelivery } from './deliveries'
import { modText, PREFIX } from './rows'
import { bytes, jsonObject, type Read } from './store'
import type { Replaced } from './stages'
import { detachNote, hostRecord, type HostRowRecord } from './hostrows'
import { addReturns, isOwnReturn, type Returnable } from './folds'
import { BATCH_PREFIX, isBatchId, nonDeferred } from './batches'
import type { BlockPort } from './errands'

// [SP_CTX_01_12]
export const DEFAULT_RESUME = 'Continue the task from where you stopped.'
// [SP_CTX_01_12] [SP_CTX_DEC_17] The author of a resume prompt the agent set
// (resume_prompt of context_edit / context_handoff): the mod submits it as a
// `user` prompt, and the call that set it leaves with DropOwnCalls, so without
// the frame it would read as the person's words (audit PL_AUD_CTX, CF-8).
export const RESUME_FRAME = modText('the resume prompt you set before your edits applied: ')
export const HANDOFF_RESUME_FRAME = modText('the resume prompt you set before the handoff: ')
export const MAX_QUEUE_BYTES = 3 * 1024 * 1024
export const MAX_DOCUMENT = 60_000
// [SP_CTX_01_12] tools whose result is the person's message (an answer to the agent's question)
export const PERSON_TOOLS: readonly string[] = ['AskUserQuestion']
// [SP_CTX_02_58] how many rows a refusal names per edit; as MAX_BLOCK_INDEXES
const MAX_WARNED_ROWS = 20

// [SP_CTX_01_15] A request to move the conversation into a new session.
export type HandoffRequest = {
  mode: 'transcript' | 'document'
  document?: string
  resume: boolean
  resumePrompt: string
  by: 'agent' | 'person'
  state: 'queued' | 'running'
  at: number
  // [SP_CTX_01_15] the module instance that claimed it; diagnostics only, no decision reads it
  owner?: string
}

// [SP_CTX_01_04]
export type Queue = {
  edits: QueuedEdit[]
  resume: boolean
  resumePrompt: string
  // [SP_CTX_01_04] [SP_CTX_DEC_16] the agent chose the continuation of this
  // batch ("resume" given, or a non-empty resume_prompt); reset with the batch
  resumeSet: boolean
  tagsOnly: boolean
  // [SP_CTX_01_04] [SP_CTX_DEC_22] the agent asked this batch to keep the
  // prompt cache up to its first edit ("keep_cache"); reset with the batch
  keepCache: boolean
  report?: string
  reportId?: number
  reportResume: boolean
  reportPrompt: string
  handoff?: HandoffRequest
  // [SP_CTX_02_42] the person's /compact asked for a compression turn
  // ([SP_CTX_02_06]) or, if none runs, its advice with the next prompt
  // ([SP_CTX_02_08]); only with `compact`. Without it, a mark's request of a
  // version before 2026-10-14, dropped (OPTIMIZE_LEGACY, [SP_CTX_DEC_37])
  optimize: boolean
  // [SP_CTX_02_06] the optimization prompt entered: the mark in the next
  // answer is ignored (the loop guard). Never true together with `optimize`.
  // Only DetectOptimize, Flush and DeliverReport change these two; every other
  // write of the queue carries them over as read ([SP_CTX_01_04]).
  optimizePrompted: boolean
  // [SP_CTX_02_42] the request (`optimize`) or the turn (`optimizePrompted`)
  // is the person's /compact: the whole conversation, CompactTurnText, no
  // closed block needed. Never true without one of the two; it leaves with them.
  compact: boolean
  // [SP_CTX_02_42] when the compression turn ended (ms); its Flush has not
  // run yet. A /compact the host held until that end is busy while a Flush is
  // planned or for FLUSH_STALE_MS after the end (the end plans its Flush a
  // moment later; live scenario 8). Flush clears it when it runs, a new
  // request clears it; past that window without a Flush it decides nothing.
  compactEndedAt?: number
  // [SP_HELP_01_06] the deferred batches. Fields of other steps: the number
  // of the next batch (absent: 1) and the turn each queued batch was set in
  // (absent: none). Fields of the batch: `applyDeferred`, the next apply takes
  // every deferred batch (absent: false), and `coldSince`, the lastRequestAt
  // it was set on by the idle timer or StartRun; while that is no longer the
  // last request's time, `applyDeferred` does not hold ([SP_HELP_02_10]).
  nextBatch?: number
  deferredSince?: Record<string, number>
  applyDeferred?: boolean
  coldSince?: number
}

export const EMPTY_QUEUE: Queue = {
  edits: [],
  resume: true,
  resumePrompt: DEFAULT_RESUME,
  resumeSet: false,
  tagsOnly: false,
  keepCache: false,
  reportResume: false,
  reportPrompt: DEFAULT_RESUME,
  optimize: false,
  optimizePrompted: false,
  compact: false,
}

// [SP_CTX_02_02] [SP_CTX_DEC_16] ResumesAfter: whether the batch resumes the
// session once it applies. A batch of tag replacements alone does not, unless
// the agent chose to go on in it; the apply's report and the context_edit
// result read this one rule.
export function resumesAfter(q: Pick<Queue, 'resume' | 'resumeSet' | 'tagsOnly'>): boolean {
  return q.resume && (q.resumeSet || !q.tagsOnly)
}

// [SP_CTX_01_04] [SP_CTX_DEC_16] The batch's choices differ from their
// defaults: a turn that ended with no edits queued leaves them (a call whose
// edits were all refused), and Flush clears them (KeepOtherSteps) so none
// rides on a later batch.
export function hasBatchChoices(q: Queue): boolean {
  return (
    q.resume !== EMPTY_QUEUE.resume ||
    q.resumePrompt !== EMPTY_QUEUE.resumePrompt ||
    q.resumeSet ||
    q.tagsOnly ||
    q.keepCache ||
    // [SP_HELP_01_06] the fields of the batch that takes the deferred ones
    q.applyDeferred === true ||
    q.coldSince !== undefined
  )
}

// [SP_CTX_01_04] The queue once its batch is gone (applied, failed, handed
// off): the edits and the batch's choices (`resume`, `resumePrompt`,
// `resumeSet`, `tagsOnly`, `keepCache`, `applyDeferred`, `coldSince`) back to
// their defaults; the fields of other steps (the optimization request, a
// handoff, the deferred edits with `deferredSince` and `nextBatch`) and a
// report not yet delivered stay as read. Every write that ends a batch goes
// through here, so a new field of Queue is sorted into "batch" or "other
// step" once. [SP_HELP_01_06] Only the apply that selected a deferred edit,
// the transcript seed, the document handoff's reset and ObservePassedCompact
// take one out: they replace `edits` after this.
export function keepOtherSteps(q: Queue | undefined): Queue {
  if (!q) return { ...EMPTY_QUEUE }
  const waiting = q.edits.filter(e => e.deferred !== undefined)
  return {
    ...EMPTY_QUEUE,
    ...(waiting.length ? { edits: waiting } : {}),
    ...(q.nextBatch !== undefined ? { nextBatch: q.nextBatch } : {}),
    ...(q.deferredSince !== undefined ? { deferredSince: q.deferredSince } : {}),
    ...(q.report !== undefined ? { report: q.report, reportId: q.reportId } : {}),
    reportResume: q.reportResume,
    reportPrompt: q.reportPrompt,
    optimize: q.optimize,
    optimizePrompted: q.optimizePrompted,
    compact: q.compact,
    ...(q.compactEndedAt !== undefined ? { compactEndedAt: q.compactEndedAt } : {}),
    ...(q.handoff ? { handoff: q.handoff } : {}),
  }
}

// [SP_CTX_02_06] [SP_CTX_02_21] [SP_CTX_DEC_17] The continuation as the mod
// submits it: the agent's own text under `frame`, which names its author; the
// default is the mod's own text and says so with the mod's prefix.
export function resumeText(prompt: string, frame: string = RESUME_FRAME): string {
  return prompt === DEFAULT_RESUME ? modText(DEFAULT_RESUME) : `${frame}${prompt}`
}

// [SP_CTX_01_04] A report added after any report not yet delivered; `id`
// names the reports together, and the continuation is the new report's.
export function appendReport(q: Queue, text: string, id: number, resume = false, prompt = DEFAULT_RESUME): Queue {
  return { ...q, report: q.report ? `${q.report}\n${text}` : text, reportId: id, reportResume: resume, reportPrompt: prompt }
}

// [SP_CTX_01_04] Every field of the file is checked by type and by its
// constraints (the prompt texts go to the model as a prompt); a wrong one
// makes the whole file unreadable, never silently a default.
export function parseQueue(text: string): Read<Queue> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  const q = { ...EMPTY_QUEUE, ...(raw.value as Partial<Queue>) }
  const bad = [
    (!Array.isArray(q.edits) || q.edits.length > MAX_QUEUE_EDITS) && 'edits',
    typeof q.resume !== 'boolean' && 'resume',
    !isPrompt(q.resumePrompt) && 'resumePrompt',
    typeof q.resumeSet !== 'boolean' && 'resumeSet',
    typeof q.tagsOnly !== 'boolean' && 'tagsOnly',
    typeof q.keepCache !== 'boolean' && 'keepCache',
    q.report !== undefined && typeof q.report !== 'string' && 'report',
    // reportId names the report: one comes only with the other
    (q.reportId !== undefined ? typeof q.reportId !== 'number' || q.report === undefined : q.report !== undefined) && 'reportId',
    typeof q.reportResume !== 'boolean' && 'reportResume',
    (typeof q.reportPrompt !== 'string' || q.reportPrompt.length > MAX_TEXT) && 'reportPrompt',
    q.handoff !== undefined && !isHandoff(q.handoff) && 'handoff',
    typeof q.optimize !== 'boolean' && 'optimize',
    typeof q.optimizePrompted !== 'boolean' && 'optimizePrompted',
    // a file written before phase 25 has no `compact`: the default false
    (typeof q.compact !== 'boolean' || (q.compact && !q.optimize && !q.optimizePrompted)) && 'compact',
    q.compactEndedAt !== undefined && typeof q.compactEndedAt !== 'number' && 'compactEndedAt',
    // [SP_HELP_01_06]
    q.nextBatch !== undefined && !(Number.isInteger(q.nextBatch) && q.nextBatch >= 1) && 'nextBatch',
    q.deferredSince !== undefined && !isSince(q.deferredSince) && 'deferredSince',
    q.applyDeferred !== undefined && typeof q.applyDeferred !== 'boolean' && 'applyDeferred',
    q.coldSince !== undefined && typeof q.coldSince !== 'number' && 'coldSince',
  ].filter(Boolean)
  if (bad.length) return { state: 'unreadable', reason: `bad field(s): ${bad.join(', ')}` }
  const badEdit = q.edits.findIndex(e => !isQueuedEdit(e))
  return badEdit >= 0 ? { state: 'unreadable', reason: `bad edit ${badEdit + 1}` } : { state: 'ok', value: q }
}

// [SP_HELP_01_06] deferredSince: a turn per batch id
function isSince(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.entries(v).every(([b, t]) => isBatchId(b) && typeof t === 'number' && Number.isInteger(t) && t >= 0)
}

// A continuation text: it goes to the model as a prompt.
function isPrompt(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT
}

function isHandoff(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const h = raw as Partial<HandoffRequest>
  return (
    (h.mode === 'transcript' || h.mode === 'document') &&
    (h.document === undefined || (typeof h.document === 'string' && h.document.length > 0 && h.document.length <= MAX_DOCUMENT)) &&
    typeof h.resume === 'boolean' &&
    isPrompt(h.resumePrompt) &&
    (h.by === 'agent' || h.by === 'person') &&
    (h.state === 'queued' || h.state === 'running') &&
    typeof h.at === 'number' &&
    (h.owner === undefined || (typeof h.owner === 'string' && h.owner.length > 0))
  )
}

function isQueuedEdit(raw: unknown): boolean {
  // [SP_FOLD_02_03] a return edit: a summarize of a recall pair; its summary
  // may be empty only with `via: 'return'` (the mod's own return)
  const back = typeof raw === 'object' && raw !== null && (raw as { via?: unknown }).via === 'return'
  if (back) {
    const r = raw as { op?: unknown; summary?: unknown }
    if (r.op !== 'summarize' || typeof r.summary !== 'string') return false
    if (typeof checkShape(r.summary.trim() === '' ? { ...r, summary: '-' } : r) === 'string') return false
  } else if (typeof checkShape(raw) === 'string') return false
  const { op, index, anchors, via, quoted, region, deferred } = raw as { op?: unknown; index?: unknown; anchors?: unknown; via?: unknown; quoted?: unknown; region?: unknown; deferred?: unknown }
  // [SP_CTX_01_03] `via` names who asked for the replacement: only 'tag' is written
  // [SP_CTX_01_30] `quoted`: only true is written; a queue before phase 42 has none
  // [SP_CTX_02_67] a state edit's stamped slot index, when it has one
  return (
    (op !== 'state' || index === undefined || (typeof index === 'number' && Number.isInteger(index))) &&
    (anchors === undefined || (Array.isArray(anchors) && anchors.every(a => typeof a === 'string'))) &&
    (via === undefined || via === 'tag' || via === 'return') &&
    (quoted === undefined || quoted === true) &&
    // [SP_FOLD_01_01] `region`: only on a collapse, a name and its kind
    (region === undefined || (op === 'collapse' && isFoldRegion(region))) &&
    // [SP_HELP_01_06] a batch id; never on a return or a tag replacement
    (deferred === undefined || (isBatchId(deferred) && via === undefined))
  )
}

export type EditArgs = { edits?: unknown; resume?: unknown; resume_prompt?: unknown; keep_cache?: unknown; defer?: unknown }

// [SP_HELP_02_10] the sentence a call with `defer: true` adds about its batch
export function deferredText(batch: string): string {
  return `Deferred as ${batch}: it applies with your next apply that rewrites the cache from no later a point, when the cache turns cold in idle, or in a handoff.`
}
// [SP_HELP_02_10] a deferred call names its batch's choices it ignores
export const DEFER_IGNORES = 'resume and keep_cache do not apply to a deferred batch.'
// [SP_HELP_02_10] a summarize of a recall or question pair is a return: it applies with an apply that is not deferred
export const DEFER_RETURN = 'a recalled level or a question pair not yet returned returns with an apply that is not deferred; leave it out of a deferred batch'
// [SP_HELP_02_10] the state slot changes only in the batch that applies next:
// a deferred state op or rewrite of the slot could land after a newer one
export const DEFER_STATE = 'the state slot changes only with an apply that is not deferred; leave it out of a deferred batch'

// [SP_CTX_02_02] [SP_HELP_02_10] DENIED_QUEUE_FULL: when every queued edit is
// deferred, ending the turn applies none of them
function queueFull(limit: string, q: Queue): string {
  const deferred = q.edits.length - nonDeferred(q.edits).length
  return deferred > 0 && deferred === q.edits.length
    ? `the queue would exceed ${limit}, all of its edits deferred: ending the turn applies none of them; the person's /compact or a handoff does.`
    : `the queue would exceed ${limit}; end the turn so the current batch applies.`
}

// [SP_CTX_01_12] [SP_CTX_DEC_26] The mod's compaction marks live in rows.ts
// and PersonText in deliveries.ts (phase 27: edits.ts reads PersonText too,
// STRUCT-01); re-exported here for the modules that import them from queue.ts.
export { HANDOFF_MARKER, LEGACY_HANDOFF_MARKER, LEGACY_MARKER, MARKER, markerKind } from './rows'
export { personText, SUMMARY_OPENER } from './deliveries'

// [SP_CTX_01_05] [SP_CTX_DEC_26] CommandNote: the sentence every apply report
// ends with when it enters the queue; the host frames the command's rows as
// the person's, and the model took them for the person's command. A message
// that delivers several reports carries it once (NoteOnce).
export const COMMAND_NOTE = `A /compact command row whose args start with "${PREFIX}" is a service command the mod ran (here: to apply your queued edits); the person did not run it.`

// [SP_CTX_01_05] An apply report with CommandNote.
export function withCommandNote(report: string): string {
  return `${report} ${COMMAND_NOTE}`
}

// [SP_CTX_01_05] NoteOnce: the reports as one message delivers them, with
// CommandNote only after the last report that has it. Only the delivered
// text changes: RemoveDelivered matches the queue's own text.
export function noteOnce(reports: string): string {
  const note = ` ${COMMAND_NOTE}`
  const last = reports.lastIndexOf(note)
  if (last < 0) return reports
  return reports.slice(0, last).split(note).join('') + reports.slice(last)
}
// [SP_CTX_02_02] [SP_CTX_02_58] PersonRow (the predicate lives in edits.ts,
// where FoldSpan reads it too).
export function personRow(rows: readonly SessionMessage[], i: number): boolean {
  return personRowKind(rows[i]) !== undefined
}

// [SP_CTX_02_02] PersonPair: the call with this id is a tool in PERSON_TOOLS.
export function personPair(rows: readonly SessionMessage[], id: string): boolean {
  return rows.some(r => r.toolUses.some(u => u.tool_use_id === id && PERSON_TOOLS.includes(u.tool)))
}

// [SP_FOLD_02_04] The person's words an edit would lose. A collapse takes
// the person's rows of its span into its archive, and a summarize of an
// AskUserQuestion pair carries the answer in the agent's summary: neither is
// refused. What stays refused:
// - PersonDelivered: a person's message the host delivered behind a result,
//   not yet a row ([SP_CTX_02_36]), goes with a collapse or a drop of that
//   result; it has no row to keep or to archive (a summarize keeps it);
// - a drop of an AskUserQuestion pair: the answer would leave no trace.
// `pinned`: a collapse loses nothing behind the rows it goes around.
const DELIVERED = 'message sent during this tool call'

function personHits(rows: readonly SessionMessage[], e: QueuedEdit, delivered: readonly QueuedDelivery[] = [], pinned: Pinned = NO_PINS): string[] {
  const hits: string[] = []
  if (e.op === 'collapse') {
    const fold = foldSpanOf(rows, e, pinned)
    for (const i of typeof fold === 'object' ? fold.folded : (touchedBy(rows, e)?.rows ?? [])) if (personDelivered(rows, i, delivered)) hits.push(`#${i} (${DELIVERED})`)
  } else if (isPairEdit(e) && e.op === 'drop') {
    const res = touchedBy(rows, e)?.rows[1]
    if (res !== undefined && personPair(rows, e.tool_use_id)) hits.push(`#${res} (AskUserQuestion answer)`)
    // a drop of one of parallel results leaves the row, and the delivery, to the others
    if (res !== undefined && personDelivered(rows, res, delivered, new Set([e.tool_use_id]))) hits.push(`#${res} (${DELIVERED})`)
  }
  return hits
}

function named(hits: readonly string[]): string {
  return hits.slice(0, MAX_WARNED_ROWS).join(', ') + (hits.length > MAX_WARNED_ROWS ? `, +${hits.length - MAX_WARNED_ROWS} more` : '')
}

// [SP_CTX_02_58] [SP_FOLD_02_04] PersonWords: why an edit that would lose
// the person's words is refused, or undefined; `label` names the edit or the
// tag. Pure.
export function personRefusal(
  rows: readonly SessionMessage[],
  e: QueuedEdit,
  delivered: readonly QueuedDelivery[] = [],
  label = describeEdit(e),
  pinned: Pinned = NO_PINS,
): string | undefined {
  const hits = personHits(rows, e, delivered, pinned)
  if (!hits.length) return undefined
  if (isPairEdit(e))
    return personPair(rows, e.tool_use_id)
      ? `${label}: the AskUserQuestion answer is the person's words and a drop leaves no trace of it; summarize the call instead: your summary carries the answer`
      : `${label}: the person's message sent during this tool call goes with it; summarize the call instead: the message stays after it`
  return `${label}: covers the person's ${named(hits)}; such a message has no row of its own, so it can be neither kept nor archived: narrow the range or split it around that result`
}

// [SP_CTX_02_58] [SP_FOLD_02_04] PERSON_TAG: a disposable tag whose
// replacement would lose the person's words (a range with a message sent
// during a tool call) is refused with the same text. Pure.
export function personTagRefusal(
  rows: readonly SessionMessage[],
  target: { from: number; to: number } | { tool_use_id: string },
  delivered: readonly QueuedDelivery[] = [],
  pinned: Pinned = NO_PINS,
): string | undefined {
  const e: QueuedEdit =
    'tool_use_id' in target ? { op: 'summarize', tool_use_id: target.tool_use_id, summary: '-' } : { op: 'collapse', from_index: target.from, to_index: target.to, summary: '-' }
  return personRefusal(rows, e, delivered, 'tool_use_id' in target ? `disposable ${target.tool_use_id}` : `disposable #${target.from}..#${target.to}`, pinned)
}

// [SP_CTX_02_58] [SP_CTX_02_07] ScreenPerson at apply, beside ScreenPinned:
// hits on the rows of the event and the deliveries file only, never on the
// mod's state (the queue may have been changed outside the tools). Pure.
export function screenPerson(
  rows: readonly SessionMessage[],
  queued: readonly QueuedEdit[],
  delivered: readonly QueuedDelivery[] = [],
  pinned: Pinned = NO_PINS,
): { edits: QueuedEdit[]; refused: string[] } {
  const edits: QueuedEdit[] = []
  const refused: string[] = []
  for (const e of queued) {
    if (personHits(rows, e, delivered, pinned).length) refused.push(`${describeEdit(e)}: ${PERSON_WORDS_NOW}`)
    else edits.push(e)
  }
  return { edits, refused }
}
export const PERSON_WORDS_NOW = "would lose the person's words now (a message sent during a tool call, or an answer a drop removes)"

// [SP_CTX_02_02] Whether a context_edit call needs the API form: only a
// describe asks whether a prompt row has media ([SP_CTX_02_10]).
export function needsApi(args: EditArgs): boolean {
  return Array.isArray(args.edits) && args.edits.some(x => (x as { op?: unknown } | null)?.op === 'describe')
}

// [SP_CTX_02_10] hasMedia for PrepareEdits from CollectMedia's owners; none
// read, no row has media.
export function hasMediaFrom(found?: ReadonlyMap<string, readonly MediaRef[]>): (owner: MediaOwner) => boolean {
  return owner => !!found?.has(ownerKey(owner))
}

// [SP_CTX_02_02] The queue after a context_edit call, or why it is refused.
// Pure: the caller reads the queue, the rows, the pinned targets and the
// aliases, and writes the result. A `ref` is resolved here, before
// PrepareEdits, so the queue keeps tool_use ids only ([SP_CTX_02_17]).
export function queueEdits(
  q: Queue,
  rows: readonly SessionMessage[],
  args: EditArgs,
  pinned: Pinned = NO_PINS,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
  // [SP_CTX_02_10] whether a person's prompt row has media (PromptMatch)
  hasMedia: (owner: MediaOwner) => boolean = () => false,
  // [SP_CTX_01_22] the host's deliveries not yet rows, for PersonWords only
  delivered: readonly QueuedDelivery[] = [],
  // [SP_CTX_02_61] the host rows' records: HOST_UNKNOWN and DetachNote
  hostRows: readonly HostRowRecord[] = [],
  // [SP_FOLD_01_01] the block of the last closed region with a name: a
  // collapse of exactly its rows carries `region`
  closed?: ClosedSpan,
  // [SP_FOLD_02_03] the recalls not yet returned: a summarize of a recall
  // pair returns it with the agent's words, and the due ones join the batch
  recalls: readonly Returnable[] = [],
  // [SP_HELP_01_06] TagRegistry.turn now: deferredSince of a new batch
  turn = 0,
): { queue: Queue; queued: number; errors: string[]; warnings: string[]; refLines: string[]; deferred?: string } | { deny: string } {
  if (!Array.isArray(args.edits) || args.edits.length === 0 || args.edits.length > MAX_QUEUE_EDITS)
    return { deny: `"edits" must be a list of 1..${MAX_QUEUE_EDITS} edits.` }
  // [SP_HELP_02_10] the mod's side of the schema's boolean
  if (args.defer !== undefined && typeof args.defer !== 'boolean') return { deny: '"defer" must be true or false.' }
  const defer = args.defer === true
  if (typeof args.resume_prompt === 'string' && args.resume_prompt.length > MAX_TEXT)
    return { deny: `resume_prompt is too long (max ${MAX_TEXT} chars).` }
  // [SP_CTX_02_17] refs resolve on these rows; "last" names its call
  const refs = resolveEditRefs(args.edits, resolve, rows)
  // [SP_CTX_02_67] the queued batch: STATE_CONFLICT and the items a state edit sees
  const prepared = prepare(rows, refs.edits, hasMedia, pinned, staleIndexes, q.edits, hostRows)
  const errors = prepared.errors
  // [SP_CTX_02_58] PERSON_WORDS: no edit over the person's words is queued
  const queued: QueuedEdit[] = []
  const notes: string[] = []
  let ix: RowIndex | undefined
  for (const edit of prepared.queued) {
    const region = regionOf(edit, closed)
    // [SP_FOLD_02_03] the agent's summarize of a recall pair is a return edit
    const back = edit.op === 'summarize' && recalls.some(r => r.tool_use_id === edit.tool_use_id)
    // [SP_HELP_02_10] a deferred call adds no return (I10): an edit over a
    // pair not yet returned (its summarize is the return; a drop or a range
    // over it would meet the return the next ordinary batch queues) waits for none
    if (defer && (back || touchesPair(rows, edit, recalls, (ix ??= indexRows(rows))))) {
      errors.push(`${describeEdit(edit)}: ${DEFER_RETURN}`)
      continue
    }
    // [SP_HELP_02_10] the state slot: a state op, or a rewrite of its row
    if (defer && (edit.op === 'state' || (edit.op === 'rewrite' && pinned.state !== undefined && touchedBy(rows, edit, (ix ??= indexRows(rows)))?.rows[0] === pinned.state))) {
      errors.push(`${describeEdit(edit)}: ${DEFER_STATE}`)
      continue
    }
    const e: QueuedEdit = region ? { ...edit, region } : back ? { ...edit, via: 'return' } : edit
    // [SP_CTX_02_61] DetachNote: what the row before the host row loses
    if (isHostDrop(e)) {
      const rec = hostRecord(hostRows, e.host)
      const detach = rec ? detachNote(rec) : ''
      if (detach) notes.push(`${describeEdit(e)}: ${detach}.`)
      queued.push(e)
      continue
    }
    const no = personRefusal(rows, e, delivered, undefined, pinned)
    if (no) {
      errors.push(no)
      continue
    }
    // [SP_CTX_02_63] DependencyCheck: warn, mark the edit, never refuse
    const hits = dependencyHits(rows, e, (ix ??= indexRows(rows)))
    if (hits.examples.length) {
      notes.push(dependencyNote(describeEdit(e), e.op, hits))
      queued.push({ ...e, quoted: true })
    } else queued.push(e)
  }
  // [SP_FOLD_02_03] the mod's own return edits give way: AddReturns re-adds what fits
  if (q.edits.filter(e => !isOwnReturn(e)).length + queued.length > MAX_QUEUE_EDITS) return { deny: queueFull(`${MAX_QUEUE_EDITS} edits`, q) }
  // [SP_HELP_02_10] a deferred call: every accepted edit joins the batch
  // b<nextBatch>; the batch's choices (resume, resume_prompt, keep_cache,
  // tagsOnly) and the returns belong to the batch that applies next, which
  // this one is not
  if (defer) {
    if (!queued.length) return { queue: q, queued: 0, errors, warnings: notes, refLines: refs.lines }
    const n = q.nextBatch ?? 1
    const batch = `${BATCH_PREFIX}${n}`
    const next: Queue = { ...q, edits: [...q.edits, ...queued.map(e => ({ ...e, deferred: batch }))], nextBatch: n + 1, deferredSince: { ...q.deferredSince, [batch]: turn } }
    if (bytes(next) > MAX_QUEUE_BYTES) return { deny: queueFull(`${MAX_QUEUE_BYTES} bytes`, q) }
    const warnings = [...notes, ...(queued.some(e => e.op === 'describe') ? [DESCRIBE_DROPS] : [])]
    return { queue: next, queued: queued.length, errors, warnings, refLines: refs.lines, deferred: batch }
  }
  // [SP_FOLD_02_03] AddReturns, only beside an accepted edit of this call
  const next: Queue = { ...q, edits: queued.length ? addReturns([...q.edits, ...queued], rows, recalls, pinned) : q.edits }
  if (queued.length) next.tagsOnly = false
  const prompt = typeof args.resume_prompt === 'string' && args.resume_prompt.trim() !== ''
  // [SP_CTX_02_02] [SP_CTX_DEC_16] the last explicit choice of the batch wins:
  // "resume" when the call gives it, else a resume_prompt of its own means to
  // go on. A call with neither keeps the batch's choice (even one made by a
  // call that queued nothing); without one, the compression turn of the
  // person's /compact, which follows an answer the agent already finished for
  // the person, stops.
  if (typeof args.resume === 'boolean') next.resume = args.resume
  else if (prompt) next.resume = true
  else if (q.optimizePrompted && !q.resumeSet) next.resume = false
  if (typeof args.resume === 'boolean' || prompt) next.resumeSet = true
  if (prompt) next.resumePrompt = args.resume_prompt as string
  // [SP_CTX_02_02] [SP_CTX_DEC_22] the last explicit "keep_cache" of the batch
  // wins; a call without it leaves the batch's choice (default false)
  if (typeof args.keep_cache === 'boolean') next.keepCache = args.keep_cache
  if (bytes(next) > MAX_QUEUE_BYTES) return { deny: queueFull(`${MAX_QUEUE_BYTES} bytes`, q) }
  const warnings = [...notes, ...(queued.some(e => e.op === 'describe') ? [DESCRIBE_DROPS] : [])]
  return { queue: next, queued: queued.length, errors, warnings, refLines: refs.lines }
}

// [SP_HELP_02_10] Whether `edit` changes a row of a recall or question pair
// not yet returned (its call row or its result row).
function touchesPair(rows: readonly SessionMessage[], edit: QueuedEdit, recalls: readonly Returnable[], ix: RowIndex): boolean {
  if (!recalls.length) return false
  const hit = touchedBy(rows, edit, ix)
  if (!hit) return false
  const pair = new Set(recalls.flatMap(r => [ix.useAt(r.tool_use_id), ix.resultAt(r.tool_use_id)]).filter(i => i >= 0))
  return hit.rows.some(i => pair.has(i)) || hit.ids.some(id => recalls.some(r => r.tool_use_id === id))
}

// [SP_CTX_02_02] `refLines`: the line naming the call "last" resolved to.
// [SP_HELP_02_10] `deferred`: the call had `defer: true` (`batch`: the batch
// its accepted edits joined; `ignores`: it gave resume, resume_prompt or
// keep_cache): no promise of an apply when this turn ends.
export function queuedText(
  q: Queue,
  queued: number,
  errors: readonly string[],
  warnings: readonly string[] = [],
  refLines: readonly string[] = [],
  deferred?: { batch?: string; ignores: boolean },
): string {
  // [SP_FOLD_02_03] the mod's return edits are no edits of the agent's count
  const returns = q.edits.filter(isOwnReturn).length
  // [SP_HELP_02_10] the edits the apply at the end of this turn takes
  const own = nonDeferred(q.edits).length
  return [
    `Queued ${queued} edit(s); ${q.edits.length - returns} pending in total.`,
    // [SP_HELP_02_05] the question pairs return the same way
    returns && !deferred ? `${returns} recalled level(s) or question pair(s) of closed stages return with this batch: each becomes a one-line trace, and the fold records stay.` : '',
    ...refLines,
    errors.length ? `Rejected: ${errors.join('; ')}.` : '',
    ...warnings,
    deferred?.batch ? deferredText(deferred.batch) : '',
    deferred?.ignores ? DEFER_IGNORES : '',
    own && !deferred
      ? `They apply when this turn ends. End your turn now with a one-line status.${
          // [SP_CTX_DEC_16] the result names what the apply will do, in every turn
          resumesAfter(q) ? ` The session then resumes by itself with: "${q.resumePrompt}"` : ' The session then stops; pass "resume": true to go on.'
        }`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// [SP_CTX_02_08] The queue once `delivered` has reached a prompt. A report
// merged in meanwhile stays: only the delivered text leaves.
export function withoutReport(q: Queue, delivered: string): Queue {
  if (q.report === undefined) return q
  if (q.report === delivered) {
    const { report: _r, reportId: _i, ...rest } = q
    return { ...rest, reportResume: false, reportPrompt: DEFAULT_RESUME }
  }
  if (q.report.startsWith(delivered + '\n')) return { ...q, report: q.report.slice(delivered.length + 1) }
  return q
}

// What context_edit and DeliverReport need from the host; register.ts binds
// them to `$` and runs them on the queue's serial chain.
export type QueueIO = {
  readQueue: () => Promise<Read<Queue>>
  writeQueue: (q: Queue) => Promise<void>
  // moves an unreadable queue file aside; the new path, or undefined
  quarantine: () => Promise<string | undefined>
  queuePath: string
  // [SP_CTX_DEC_37] on the registry chain: the waiting block ends; its
  // BlockName, or undefined when none waits; a failed write rejects (the block
  // keeps waiting). Absent: never
  endWaiting?: () => Promise<string | undefined>
  // [SP_CTX_02_13] QueueTagReplacements, on the queue's chain this call holds
  replace?: () => Promise<Replaced>
  // [SP_CTX_02_61] the host rows' records, read only for a call with a host
  // drop; an unreadable or missing file gives none
  hostRows?: () => Promise<readonly HostRowRecord[]>
  // [SP_FOLD_02_03] the recalls not yet returned, of the fold ledger as it is
  // now; an unreadable or missing ledger gives none
  recalls?: () => Promise<readonly Returnable[]>
  // [SP_HELP_01_06] TagRegistry.turn as read for this call; absent: 0
  turn?: number
}

// [SP_CTX_02_02]
export async function contextEdit(
  io: QueueIO,
  rows: readonly SessionMessage[],
  args: EditArgs,
  pinned: Pinned = NO_PINS,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
  hasMedia: (owner: MediaOwner) => boolean = () => false,
  delivered: readonly QueuedDelivery[] = [],
  closed?: ClosedSpan,
): Promise<{ result: string } | { deny: string }> {
  let read = await io.readQueue()
  let notice = ''
  if (read.state === 'unreadable') {
    const moved = await io.quarantine()
    if (!moved) return { deny: `the queue file ${io.queuePath} cannot be read (${read.reason}) nor moved aside; fix or delete it.` }
    notice = `The unreadable queue (${read.reason}) was moved to ${moved}; its edits are not applied.\n`
    read = { state: 'missing', value: { ...EMPTY_QUEUE } }
  }
  const wantsHost = Array.isArray(args.edits) && args.edits.some(x => (x as { host?: unknown } | null)?.host !== undefined)
  const hostRows = wantsHost && io.hostRows ? await io.hostRows().catch(() => []) : []
  const recalls = io.recalls ? await io.recalls().catch(() => []) : []
  const defer = args.defer === true
  // [SP_HELP_02_10] a deferred call adds no return: the recalls are read only to refuse a summarize of one
  const out = queueEdits(read.value, rows, args, pinned, resolve, staleIndexes, hasMedia, delivered, hostRows, closed, recalls, io.turn ?? 0)
  if ('deny' in out) return out
  try {
    await io.writeQueue(out.queue)
  } catch (err) {
    return { deny: `could not save the queue: ${String(err)}` }
  }
  // [SP_HELP_02_10] the batch's choices this deferred call ignored
  const ignores = defer && (typeof args.resume === 'boolean' || (typeof args.resume_prompt === 'string' && args.resume_prompt.trim() !== '') || typeof args.keep_cache === 'boolean')
  let result = notice + queuedText(out.queue, out.queued, out.errors, out.warnings, out.refLines, defer ? { ...(out.deferred ? { batch: out.deferred } : {}), ignores } : undefined)
  // [SP_CTX_DEC_37] an accepted edit is the agent's move: the waiting block
  // ends, and its disposable replacements join this batch. [SP_HELP_02_10]
  // A deferred call is none: the replacements would plan the apply it avoids (I10)
  if (out.queued > 0 && !defer && io.endWaiting) {
    const waited = await io.endWaiting().catch(() => undefined)
    if (waited) {
      const replaced = await io.replace?.().catch(() => undefined)
      result += `\n${waited} no longer waits for compression.`
      if (replaced && replaced.queued > 0) result += ` Replacements from your disposable tags queued: ${replaced.queued} (${replaced.freed} freed when this turn ends).`
      for (const line of replaced?.dropped ?? []) result += `\n${line}.`
    }
  }
  return { result }
}

// [SP_CTX_02_08] What changes in the queue once a person's prompt entered:
// the delivered report leaves (RemoveDelivered), the request of the person's
// /compact whose advice went is done (a legacy mark's request too), and the
// loop guard is down when the person took over between turns.
export type Settle = { delivered?: string; optimizeDone: boolean; tookOver: boolean }

// [SP_CTX_02_08] The queue after Settle; the same queue when nothing changes.
export function settledQueue(q: Queue, s: Settle): Queue {
  let next = s.delivered !== undefined ? withoutReport(q, s.delivered) : q
  // [SP_CTX_02_42] `compact` leaves with the request or the turn it marks
  if (s.optimizeDone && next.optimize) next = { ...next, optimize: false, compact: false }
  if (s.tookOver && next.optimizePrompted) next = { ...next, optimizePrompted: false, compact: false }
  return next
}

// [SP_CTX_02_42] The advice with the person's prompt when the compression
// turn of their /compact did not run (the prompt came first).
export const COMPACT_ADVICE = modText(
  "the person ran /compact before this prompt, and the compression turn did not run. When it suits the person's request, compress the conversation: close finished stages, collapse finished blocks into stage records, summarize big outputs you have used; quote in your records the person's words still in force, and keep the rules and skills in force verbatim. Edits apply when your turn ends.",
)

// What DeliverReport needs from the host; register.ts binds it to `$`.
export type DeliverIO<R> = {
  readQueue: () => Promise<Read<Queue>>
  // [SP_CTX_02_27] INTRO_TEXT while the registry (ok or missing) has not
  // recorded it in this session; undefined otherwise
  intro: () => Promise<string | undefined>
  // [SP_CTX_02_29] WaitingAdvice of TagRegistry.lastClosed as it is now,
  // while `waiting = marked`; undefined otherwise (WAIT_NO_BLOCK); a throw is
  // ADVICE_FAILED
  advice: () => Promise<string | undefined>
  // [SP_CTX_DEC_37] on the registry chain: waiting marked → advised (AdviseWaiting)
  advised?: () => Promise<void>
  // [SP_CTX_02] a turn runs now
  inTurn: () => boolean
  // passes the prompt on with the hidden context; resolves with the host's verdict
  enter: (context: readonly string[]) => Promise<R>
  // on the registry chain: introduced = true
  markIntroduced: () => Promise<void>
  // on the queue chain, the queue as it is then
  settle: (s: Settle) => Promise<void>
  // [SP_CTX_02_37] TurnSuggestion, bounded by HINT_WAIT: its line or none;
  // asked only between turns and without an optimization request
  suggestion?: () => Promise<string | undefined>
  // [SP_HELP_02_09] ColdVerdict of the cache clock on the registry's chain;
  // asked only between turns; absent: none
  cold?: () => Promise<unknown>
  // [SP_HELP_02_08] DeliveryBlock: claimed before the prompt enters, put back
  // when it is dropped or its entry throws; absent: none
  block?: BlockPort
}

// [SP_CTX_02_08] [SP_CTX_02_27] The person's prompt (or another plugin's)
// carries the session intro once, the pending report, the advice of the
// person's /compact that no compression turn served, and WaitingAdvice of a
// block the mark left waiting ([SP_CTX_DEC_37]); each leaves only once that
// prompt entered. Between turns, without any advice, the suggestion of the
// turn channel ([SP_CTX_02_37]) comes last: its state is claimed before the
// prompt enters, so a dropped prompt loses it. A failed step never holds the
// prompt back.
export async function deliverReport<R extends { drop?: unknown }>(io: DeliverIO<R>): Promise<R> {
  // [SP_HELP_02_09] the first prompt after an idle takes the cold verdict, once
  if (io.cold && !io.inTurn()) await io.cold().catch(() => undefined)
  const context: string[] = []
  const intro = await io.intro().catch(() => undefined)
  if (intro) context.push(intro)
  const read = await io.readQueue().catch((): Read<Queue> => ({ state: 'unreadable', reason: 'read failed' }))
  const q = read.state === 'ok' ? read.value : undefined
  if (q?.report) context.push(noteOnce(q.report))
  // [SP_CTX_02_42] the person's /compact needs no block: its own advice. An
  // `optimize` without `compact` is a legacy mark's request: no advice, cleared once the prompt entered
  const compactAdvice = !!q?.optimize && q.compact
  if (compactAdvice) context.push(COMPACT_ADVICE)
  let waitAdded = false
  if (!compactAdvice) {
    // ADVICE_FAILED: the prompt goes without it; the block stays marked
    const advice = await io.advice().catch(() => undefined)
    if (advice) {
      context.push(advice)
      waitAdded = true
    }
  }
  // [SP_CTX_02_37] an advice already says what to compress
  if (io.suggestion && !io.inTurn() && !q?.optimize && !waitAdded) {
    const line = await io.suggestion().catch(() => undefined)
    if (line) context.push(line)
  }
  // the person took the turn between turns: the loop guard is no longer needed
  const tookOver = !!q?.optimizePrompted && !io.inTurn()
  // [SP_HELP_02_08] the block goes last; a failed claim delivers nothing
  const block = io.block ? await io.block.claim().catch(() => undefined) : undefined
  if (block) context.push(...block.lines)
  const putBack = () => (block ? io.block!.restore(block.claimed).catch(() => undefined) : undefined)
  let entered: R
  try {
    entered = await io.enter(context)
  } catch (err) {
    await putBack()
    throw err
  }
  if (entered.drop !== undefined) return await putBack(), entered
  // INTRO_NOT_RECORDED: the intro comes again with the next prompt
  if (intro) await io.markIntroduced().catch(() => undefined)
  if (q && (q.report || q.optimize || tookOver))
    // DELIVERY_FAILED: the report goes again with the next prompt
    await io.settle({ delivered: q.report || undefined, optimizeDone: q.optimize, tookOver }).catch(() => undefined)
  // WAIT_ADVICE_LOST: the advice goes again with the next prompt
  if (waitAdded) await io.advised?.().catch(() => undefined)
  return entered
}
