import type { SessionMessage } from 'claude-code'
import { checkShape, dependencyHits, dependencyNote, DESCRIBE_DROPS, describeEdit, indexRows, isHostDrop, isPairEdit, type RowIndex, ownerKey, type MediaRef, MAX_QUEUE_EDITS, MAX_TEXT, NO_PINS, NO_REFS, prepare, resolveEditRefs, touchedBy, type MediaOwner, type Pinned, type QueuedEdit, type RefResolver } from './edits'
import { personDelivered, personText, type QueuedDelivery } from './deliveries'
import { isDescribedText, isPlainUserRow, modText, PREFIX, resultsOf } from './rows'
import { bytes, jsonObject, type Read } from './store'
import type { Replaced } from './stages'
import { detachNote, hostRecord, type HostRowRecord } from './hostrows'

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

// [SP_CTX_01_04] The queue once its batch is gone (applied, failed, handed
// off): the edits and the batch's choices (`resume`, `resumePrompt`,
// `resumeSet`, `tagsOnly`, `keepCache`) back to their defaults; the fields of
// other steps (the optimization request, a handoff) and a report not yet
// delivered stay as read. Every write that ends a batch goes through here, so
// a new field of Queue is sorted into "batch" or "other step" once.
export function keepOtherSteps(q: Queue | undefined): Queue {
  if (!q) return { ...EMPTY_QUEUE }
  return {
    ...EMPTY_QUEUE,
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
  ].filter(Boolean)
  if (bad.length) return { state: 'unreadable', reason: `bad field(s): ${bad.join(', ')}` }
  const badEdit = q.edits.findIndex(e => !isQueuedEdit(e))
  return badEdit >= 0 ? { state: 'unreadable', reason: `bad edit ${badEdit + 1}` } : { state: 'ok', value: q }
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
  if (typeof checkShape(raw) === 'string') return false
  const { op, index, anchors, via, quoted } = raw as { op?: unknown; index?: unknown; anchors?: unknown; via?: unknown; quoted?: unknown }
  // [SP_CTX_01_03] `via` names who asked for the replacement: only 'tag' is written
  // [SP_CTX_01_30] `quoted`: only true is written; a queue before phase 42 has none
  // [SP_CTX_02_67] a state edit's stamped slot index, when it has one
  return (
    (op !== 'state' || index === undefined || (typeof index === 'number' && Number.isInteger(index))) &&
    (anchors === undefined || (Array.isArray(anchors) && anchors.every(a => typeof a === 'string'))) &&
    (via === undefined || via === 'tag') &&
    (quoted === undefined || quoted === true)
  )
}

export type EditArgs = { edits?: unknown; resume?: unknown; resume_prompt?: unknown; keep_cache?: unknown }

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
// [SP_CTX_02_02] [SP_CTX_02_58] PersonRow: a user row without results whose
// PersonText is not empty, or a prompt after a describe (DescribedText: the
// person's words follow the description).
export function personRow(rows: readonly SessionMessage[], i: number): boolean {
  return personRowKind(rows[i]) !== undefined
}
function personRowKind(r: SessionMessage | undefined): 'prompt' | 'described prompt' | undefined {
  if (!r || !isPlainUserRow(r)) return undefined
  if (isDescribedText(r.text.trim())) return 'described prompt'
  return personText(r.text) !== '' ? 'prompt' : undefined
}

// [SP_CTX_02_02] PersonPair: the call with this id is a tool in PERSON_TOOLS.
export function personPair(rows: readonly SessionMessage[], id: string): boolean {
  return rows.some(r => r.toolUses.some(u => u.tool_use_id === id && PERSON_TOOLS.includes(u.tool)))
}

// [SP_CTX_02_02] The rows of the person's messages an edit covers: prompt
// rows and AskUserQuestion answers in a collapse's span, the answer row of a
// summarize or drop of an AskUserQuestion pair.
// [SP_CTX_02_02] PersonDelivered: a person's message the host delivered
// behind a result, not yet a row, goes with a collapse or a drop of that
// result ([SP_CTX_02_36]); a summarize keeps it.
const DELIVERED = 'message sent during this tool call'

function personHits(rows: readonly SessionMessage[], e: QueuedEdit, delivered: readonly QueuedDelivery[] = []): string[] {
  const hits: string[] = []
  if (e.op === 'collapse') {
    for (const i of touchedBy(rows, e)?.rows ?? []) {
      const kind = personRowKind(rows[i])
      if (kind) hits.push(`#${i} (${kind})`)
      for (const t of resultsOf(rows[i]!)) if (personPair(rows, t.tool_use_id)) hits.push(`#${i} (AskUserQuestion answer)`)
      if (personDelivered(rows, i, delivered)) hits.push(`#${i} (${DELIVERED})`)
    }
  } else if (isPairEdit(e)) {
    const res = touchedBy(rows, e)?.rows[1]
    if (res !== undefined && personPair(rows, e.tool_use_id)) hits.push(`#${res} (AskUserQuestion answer)`)
    // a drop of one of parallel results leaves the row, and the delivery, to the others
    if (res !== undefined && e.op === 'drop' && personDelivered(rows, res, delivered, new Set([e.tool_use_id]))) hits.push(`#${res} (${DELIVERED})`)
  }
  return hits
}

function named(hits: readonly string[]): string {
  return hits.slice(0, MAX_WARNED_ROWS).join(', ') + (hits.length > MAX_WARNED_ROWS ? `, +${hits.length - MAX_WARNED_ROWS} more` : '')
}

// [SP_CTX_02_58] PersonWords: why an edit that covers the person's words is
// refused, or undefined; `label` names the edit or the tag. Pure.
export function personRefusal(rows: readonly SessionMessage[], e: QueuedEdit, delivered: readonly QueuedDelivery[] = [], label = describeEdit(e)): string | undefined {
  const hits = personHits(rows, e, delivered)
  if (!hits.length) return undefined
  if (isPairEdit(e))
    return personPair(rows, e.tool_use_id)
      ? `${label}: the AskUserQuestion answer is the person's words; it stays verbatim`
      : `${label}: the person's message sent during this tool call goes with it; summarize the call instead: the message stays after it`
  return `${label}: covers the person's words: ${named(hits)}; they stay verbatim in this session: narrow the range or split it around them`
}

// [SP_CTX_02_58] PERSON_TAG: a disposable tag over the person's words, a
// range `from..to` or a pair, is refused with the same text. Pure.
export function personTagRefusal(
  rows: readonly SessionMessage[],
  target: { from: number; to: number } | { tool_use_id: string },
  delivered: readonly QueuedDelivery[] = [],
): string | undefined {
  const e: QueuedEdit =
    'tool_use_id' in target ? { op: 'summarize', tool_use_id: target.tool_use_id, summary: '-' } : { op: 'collapse', from_index: target.from, to_index: target.to, summary: '-' }
  return personRefusal(rows, e, delivered, 'tool_use_id' in target ? `disposable ${target.tool_use_id}` : `disposable #${target.from}..#${target.to}`)
}

// [SP_CTX_02_58] [SP_CTX_02_07] ScreenPerson at apply, beside ScreenPinned:
// hits on the rows of the event and the deliveries file only, never on the
// mod's state (the queue may have been changed outside the tools). Pure.
export function screenPerson(
  rows: readonly SessionMessage[],
  queued: readonly QueuedEdit[],
  delivered: readonly QueuedDelivery[] = [],
): { edits: QueuedEdit[]; refused: string[] } {
  const edits: QueuedEdit[] = []
  const refused: string[] = []
  for (const e of queued) {
    if (personHits(rows, e, delivered).length) refused.push(`${describeEdit(e)}: covers the person's words now; they stay verbatim`)
    else edits.push(e)
  }
  return { edits, refused }
}

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
): { queue: Queue; queued: number; errors: string[]; warnings: string[]; refLines: string[] } | { deny: string } {
  if (!Array.isArray(args.edits) || args.edits.length === 0 || args.edits.length > MAX_QUEUE_EDITS)
    return { deny: `"edits" must be a list of 1..${MAX_QUEUE_EDITS} edits.` }
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
  for (const e of prepared.queued) {
    // [SP_CTX_02_61] DetachNote: what the row before the host row loses
    if (isHostDrop(e)) {
      const rec = hostRecord(hostRows, e.host)
      const detach = rec ? detachNote(rec) : ''
      if (detach) notes.push(`${describeEdit(e)}: ${detach}.`)
      queued.push(e)
      continue
    }
    const no = personRefusal(rows, e, delivered)
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
  if (q.edits.length + queued.length > MAX_QUEUE_EDITS)
    return { deny: `the queue would exceed ${MAX_QUEUE_EDITS} edits; end the turn so the current batch applies.` }
  const next: Queue = { ...q, edits: [...q.edits, ...queued] }
  if (queued.length) next.tagsOnly = false
  const prompt = typeof args.resume_prompt === 'string' && args.resume_prompt.trim() !== ''
  // [SP_CTX_02_02] [SP_CTX_DEC_16] the compression turn of the person's /compact
  // follows an answer
  // the agent already finished for the person: its batch resumes only when
  // asked to, by "resume" or by a resume_prompt of its own. A choice made
  // once in the batch (even by a call that queued nothing) stays.
  if (typeof args.resume === 'boolean') next.resume = args.resume
  else if (q.optimizePrompted && !q.resumeSet) next.resume = prompt
  if (typeof args.resume === 'boolean' || prompt) next.resumeSet = true
  if (prompt) next.resumePrompt = args.resume_prompt as string
  // [SP_CTX_02_02] [SP_CTX_DEC_22] the last explicit "keep_cache" of the batch
  // wins; a call without it leaves the batch's choice (default false)
  if (typeof args.keep_cache === 'boolean') next.keepCache = args.keep_cache
  if (bytes(next) > MAX_QUEUE_BYTES)
    return { deny: `the queue would exceed ${MAX_QUEUE_BYTES} bytes; end the turn so the current batch applies.` }
  const warnings = [...notes, ...(queued.some(e => e.op === 'describe') ? [DESCRIBE_DROPS] : [])]
  return { queue: next, queued: queued.length, errors, warnings, refLines: refs.lines }
}

// [SP_CTX_02_02] `refLines`: the line naming the call "last" resolved to.
export function queuedText(q: Queue, queued: number, errors: readonly string[], warnings: readonly string[] = [], refLines: readonly string[] = []): string {
  return [
    `Queued ${queued} edit(s); ${q.edits.length} pending in total.`,
    ...refLines,
    errors.length ? `Rejected: ${errors.join('; ')}.` : '',
    ...warnings,
    q.edits.length
      ? `They apply when this turn ends. End your turn now with a one-line status.${
          q.resume
            ? ` The session then resumes by itself with: "${q.resumePrompt}"`
            : // [SP_CTX_DEC_16] the /compact compression turn's batch stops the session
              q.optimizePrompted
              ? ' The session then stops; pass "resume": true to go on.'
              : ''
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
  const out = queueEdits(read.value, rows, args, pinned, resolve, staleIndexes, hasMedia, delivered, hostRows)
  if ('deny' in out) return out
  try {
    await io.writeQueue(out.queue)
  } catch (err) {
    return { deny: `could not save the queue: ${String(err)}` }
  }
  let result = notice + queuedText(out.queue, out.queued, out.errors, out.warnings, out.refLines)
  // [SP_CTX_DEC_37] an accepted edit is the agent's move: the waiting block
  // ends, and its disposable replacements join this batch
  if (out.queued > 0 && io.endWaiting) {
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
  "the person ran /compact before this prompt, and the compression turn did not run. When it suits the person's request, compress the conversation: close finished stages, collapse finished blocks into stage records, summarize big outputs you have used; keep the person's messages, rules and skills in force verbatim. Edits apply when your turn ends.",
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
  const entered = await io.enter(context)
  if (entered.drop !== undefined) return entered
  // INTRO_NOT_RECORDED: the intro comes again with the next prompt
  if (intro) await io.markIntroduced().catch(() => undefined)
  if (q && (q.report || q.optimize || tookOver))
    // DELIVERY_FAILED: the report goes again with the next prompt
    await io.settle({ delivered: q.report || undefined, optimizeDone: q.optimize, tookOver }).catch(() => undefined)
  // WAIT_ADVICE_LOST: the advice goes again with the next prompt
  if (waitAdded) await io.advised?.().catch(() => undefined)
  return entered
}
