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
}

export type Read<T> = { state: 'missing' | 'ok'; value: T } | { state: 'unreadable'; reason: string }

export const EMPTY_QUEUE: Queue = {
  edits: [],
  resume: true,
  resumePrompt: DEFAULT_RESUME,
  tagsOnly: false,
  reportResume: false,
  reportPrompt: DEFAULT_RESUME,
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

// [SP_CTX_02_08] Hands the pending report to the prompt about to enter, and
// removes it once that prompt entered. `enter` passes the prompt on with the
// given context and resolves with the host's verdict.
export async function deliverReport<R extends { drop?: unknown }>(
  read: () => Promise<Read<Queue>>,
  enter: (report?: string) => Promise<R>,
  settle: (delivered: string) => Promise<void>,
): Promise<R> {
  const q = await read()
  const report = q.state === 'ok' ? q.value.report : undefined
  if (!report) return enter()
  const entered = await enter(report)
  if (entered.drop === undefined) await settle(report)
  return entered
}
