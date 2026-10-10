import type { SessionMessage } from 'claude-code'
import { checkShape, MAX_QUEUE_EDITS, MAX_TEXT, NO_PINS, NO_REFS, prepare, resolveEditRefs, type Pinned, type QueuedEdit, type RefResolver } from './edits'

// [SP_CTX_01_12]
export const DEFAULT_RESUME = 'Continue the task from where you stopped.'
export const MAX_QUEUE_BYTES = 3 * 1024 * 1024
export const MAX_DOCUMENT = 60_000

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
  tagsOnly: boolean
  report?: string
  reportId?: number
  reportResume: boolean
  reportPrompt: string
  handoff?: HandoffRequest
  // [SP_CTX_02_30] the optimization mark was seen: the request waits for the
  // optimization turn ([SP_CTX_02_06]) or a person's prompt ([SP_CTX_02_08]);
  // its block is TagRegistry.lastClosed
  optimize: boolean
  // [SP_CTX_02_06] the optimization prompt entered: the mark in the next
  // answer is ignored (the loop guard). Never true together with `optimize`.
  // Only DetectOptimize, Flush and DeliverReport change these two; every other
  // write of the queue carries them over as read ([SP_CTX_01_04]).
  optimizePrompted: boolean
}

export type Read<T> = { state: 'missing' | 'ok'; value: T } | { state: 'unreadable'; reason: string }

export const EMPTY_QUEUE: Queue = {
  edits: [],
  resume: true,
  resumePrompt: DEFAULT_RESUME,
  tagsOnly: false,
  reportResume: false,
  reportPrompt: DEFAULT_RESUME,
  optimize: false,
  optimizePrompted: false,
}

// [SP_CTX_01_04] Every field of the file is checked by type; a wrong one
// makes the whole file unreadable, never silently a default.
export function parseQueue(text: string): Read<Queue> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { state: 'unreadable', reason: `not JSON: ${String(err)}` }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unreadable', reason: 'not an object' }
  const q = { ...EMPTY_QUEUE, ...(raw as Partial<Queue>) }
  const bad = [
    !Array.isArray(q.edits) && 'edits',
    typeof q.resume !== 'boolean' && 'resume',
    typeof q.resumePrompt !== 'string' && 'resumePrompt',
    typeof q.tagsOnly !== 'boolean' && 'tagsOnly',
    q.report !== undefined && typeof q.report !== 'string' && 'report',
    q.reportId !== undefined && typeof q.reportId !== 'number' && 'reportId',
    typeof q.reportResume !== 'boolean' && 'reportResume',
    typeof q.reportPrompt !== 'string' && 'reportPrompt',
    q.handoff !== undefined && !isHandoff(q.handoff) && 'handoff',
    typeof q.optimize !== 'boolean' && 'optimize',
    typeof q.optimizePrompted !== 'boolean' && 'optimizePrompted',
  ].filter(Boolean)
  if (bad.length) return { state: 'unreadable', reason: `bad field(s): ${bad.join(', ')}` }
  const badEdit = q.edits.findIndex(e => !isQueuedEdit(e))
  return badEdit >= 0 ? { state: 'unreadable', reason: `bad edit ${badEdit + 1}` } : { state: 'ok', value: q }
}

function isHandoff(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const h = raw as Partial<HandoffRequest>
  return (
    (h.mode === 'transcript' || h.mode === 'document') &&
    (h.document === undefined || (typeof h.document === 'string' && h.document.length > 0 && h.document.length <= MAX_DOCUMENT)) &&
    typeof h.resume === 'boolean' &&
    typeof h.resumePrompt === 'string' &&
    h.resumePrompt.length > 0 &&
    (h.by === 'agent' || h.by === 'person') &&
    (h.state === 'queued' || h.state === 'running') &&
    typeof h.at === 'number' &&
    (h.owner === undefined || (typeof h.owner === 'string' && h.owner.length > 0))
  )
}

function isQueuedEdit(raw: unknown): boolean {
  if (typeof checkShape(raw) === 'string') return false
  const anchors = (raw as { anchors?: unknown }).anchors
  return anchors === undefined || (Array.isArray(anchors) && anchors.every(a => typeof a === 'string'))
}

export function queueBytes(q: Queue): number {
  return new TextEncoder().encode(JSON.stringify(q)).length
}

export type EditArgs = { edits?: unknown; resume?: unknown; resume_prompt?: unknown }

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
): { queue: Queue; queued: number; errors: string[] } | { deny: string } {
  if (!Array.isArray(args.edits) || args.edits.length === 0 || args.edits.length > MAX_QUEUE_EDITS)
    return { deny: `"edits" must be a list of 1..${MAX_QUEUE_EDITS} edits.` }
  if (typeof args.resume_prompt === 'string' && args.resume_prompt.length > MAX_TEXT)
    return { deny: `resume_prompt is too long (max ${MAX_TEXT} chars).` }
  const { queued, errors } = prepare(rows, resolveEditRefs(args.edits, resolve), undefined, pinned, staleIndexes)
  if (q.edits.length + queued.length > MAX_QUEUE_EDITS)
    return { deny: `the queue would exceed ${MAX_QUEUE_EDITS} edits; end the turn so the current batch applies.` }
  const next: Queue = { ...q, edits: [...q.edits, ...queued] }
  if (queued.length) next.tagsOnly = false
  if (typeof args.resume === 'boolean') next.resume = args.resume
  if (typeof args.resume_prompt === 'string' && args.resume_prompt.trim()) next.resumePrompt = args.resume_prompt
  if (queueBytes(next) > MAX_QUEUE_BYTES)
    return { deny: `the queue would exceed ${MAX_QUEUE_BYTES} bytes; end the turn so the current batch applies.` }
  return { queue: next, queued: queued.length, errors }
}

export function queuedText(q: Queue, queued: number, errors: readonly string[]): string {
  return [
    `Queued ${queued} edit(s); ${q.edits.length} pending in total.`,
    errors.length ? `Rejected: ${errors.join('; ')}.` : '',
    q.edits.length
      ? `They apply when this turn ends. End your turn now with a one-line status.${q.resume ? ` The session then resumes by itself with: "${q.resumePrompt}"` : ''}`
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
}

// [SP_CTX_02_02]
export async function contextEdit(
  io: QueueIO,
  rows: readonly SessionMessage[],
  args: EditArgs,
  pinned: Pinned = NO_PINS,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
): Promise<{ result: string } | { deny: string }> {
  let read = await io.readQueue()
  let notice = ''
  if (read.state === 'unreadable') {
    const moved = await io.quarantine()
    if (!moved) return { deny: `the queue file ${io.queuePath} cannot be read (${read.reason}) nor moved aside; fix or delete it.` }
    notice = `The unreadable queue (${read.reason}) was moved to ${moved}; its edits are not applied.\n`
    read = { state: 'missing', value: { ...EMPTY_QUEUE } }
  }
  const out = queueEdits(read.value, rows, args, pinned, resolve, staleIndexes)
  if ('deny' in out) return out
  try {
    await io.writeQueue(out.queue)
  } catch (err) {
    return { deny: `could not save the queue: ${String(err)}` }
  }
  return { result: notice + queuedText(out.queue, out.queued, out.errors) }
}

// [SP_CTX_02_08] What changes in the queue once a person's prompt entered:
// the delivered report leaves (RemoveDelivered), an optimization request
// whose advice went (or could not be built) is done, and the loop guard is
// down when the person took over between turns.
export type Settle = { delivered?: string; optimizeDone: boolean; tookOver: boolean }

// [SP_CTX_02_08] The queue after Settle; the same queue when nothing changes.
export function settledQueue(q: Queue, s: Settle): Queue {
  let next = s.delivered !== undefined ? withoutReport(q, s.delivered) : q
  if (s.optimizeDone && next.optimize) next = { ...next, optimize: false }
  if (s.tookOver && next.optimizePrompted) next = { ...next, optimizePrompted: false }
  return next
}

// What DeliverReport needs from the host; register.ts binds it to `$`.
export type DeliverIO<R> = {
  readQueue: () => Promise<Read<Queue>>
  // [SP_CTX_02_27] INTRO_TEXT while the registry (ok or missing) has not
  // recorded it in this session; undefined otherwise
  intro: () => Promise<string | undefined>
  // [SP_CTX_02_29] PersonAdvice of TagRegistry.lastClosed as it is now;
  // undefined without a readable registry or a block (ADVICE_NO_BLOCK); a
  // throw is ADVICE_FAILED
  advice: () => Promise<string | undefined>
  // [SP_CTX_02] a turn runs now
  inTurn: () => boolean
  // passes the prompt on with the hidden context; resolves with the host's verdict
  enter: (context: readonly string[]) => Promise<R>
  // on the registry chain: introduced = true
  markIntroduced: () => Promise<void>
  // on the queue chain, the queue as it is then
  settle: (s: Settle) => Promise<void>
}

// [SP_CTX_02_08] [SP_CTX_02_27] The person's prompt (or another plugin's)
// carries the session intro once, the pending report, and the advice of an
// optimization request that no optimization turn served; each leaves only
// once that prompt entered. A failed step never holds the prompt back.
export async function deliverReport<R extends { drop?: unknown }>(io: DeliverIO<R>): Promise<R> {
  const context: string[] = []
  const intro = await io.intro().catch(() => undefined)
  if (intro) context.push(intro)
  const read = await io.readQueue().catch((): Read<Queue> => ({ state: 'unreadable', reason: 'read failed' }))
  const q = read.state === 'ok' ? read.value : undefined
  if (q?.report) context.push(q.report)
  if (q?.optimize) {
    // ADVICE_FAILED / ADVICE_NO_BLOCK: the prompt goes without it, once
    const advice = await io.advice().catch(() => undefined)
    if (advice) context.push(advice)
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
  return entered
}
