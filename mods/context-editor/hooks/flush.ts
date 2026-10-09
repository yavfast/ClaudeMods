// [SP_CTX_02_06] Flush: after a turn of the main conversation, apply the queue
// through the built-in /compact with MARKER and resume the session. The same
// module asks for the compaction and handles it ([C_CTX_DEC_02], C): a plugin's
// `$.command.run('compact')` reaches its own handlers. Free of the host:
// register.ts binds FlushIO to `$`.
import { MARKER } from './compaction'
import { DEFAULT_RESUME, type Queue, type Read } from './queue'
import { movedSince, type Turns } from './turns'

// [SP_CTX_01_12] The pause between the end of a turn and the command.
export const FLUSH_DELAY_MS = 300

export type FlushIO = {
  // the queue of the current session; `unreadable` too when there is no storage
  readQueue: () => Promise<Read<Queue>>
  // runs the built-in /compact with `args`, once; rejects with the host's text
  compact: (args: string) => Promise<void>
  // a deferred action; register.ts creates it from the hook that called, never
  // from a tool.call or prompt.submit hook (the host refuses commands there)
  after: (ms: number, fn: () => void) => void
  // a refused prompt (an exception or a result with `drop`) rejects. The
  // host skips the mod's own prompt.submit hooks for it (DeliverReport too).
  submit: (text: string) => Promise<void>
  // [SP_CTX_02_08] RemoveDelivered on the queue's serial chain
  removeDelivered: (delivered: string) => Promise<void>
  status: (text?: string) => void
  turns: Readonly<Turns>
}

// [SP_CTX_02_06] Module memory; a reload starts it over.
export type FlushState = { scheduled: boolean; lastSubmittedReportId: number }

export function newFlushState(): FlushState {
  return { scheduled: false, lastSubmittedReportId: 0 }
}

// [SP_CTX_02_06] Errors: QUEUE_UNREADABLE, PERSON_MOVED, HOST_REFUSED; the
// rest are outcomes of the command.
export type FlushOutcome = 'nothing-queued' | 'handoff-pending' | 'queue-unreadable' | 'person-moved' | 'host-refused' | 'compacted'
// [SP_CTX_02_06] Errors: PERSON_ACTIVE, RESUME_FAILED.
export type ResumeOutcome = 'none' | 'submitted' | 'person-active' | 'resume-failed'

// [SP_CTX_02_06] A refused prompt resolves with `drop` and does not throw;
// the `submit` ports (Flush, the handoff) take it as a rejection.
export async function enteredOrThrow(entered: Promise<{ drop?: unknown }>): Promise<void> {
  const out = await entered
  if (out.drop !== undefined) throw new Error(String(out.drop))
}

function hasWork(read: Read<Queue>): boolean {
  return read.state !== 'unreadable' && read.value.edits.length > 0 && !read.value.handoff
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// [SP_CTX_02_06] ON turn completed (main loop, not aborted), after the turn
// counter: plan one Flush when the queue holds edits and no handoff. True when
// a Flush was planned.
export async function flushAfterTurn(io: FlushIO, state: FlushState, aborted: boolean): Promise<boolean> {
  if (aborted || state.scheduled) return false
  const read = await io.readQueue()
  if (!hasWork(read) || state.scheduled) return false
  schedule(io, state)
  return true
}

// A deferred action from the end of the turn: the origin the host queues.
function schedule(io: FlushIO, state: FlushState): void {
  state.scheduled = true
  const turns0 = io.turns.turns
  io.after(FLUSH_DELAY_MS, () => void flush(io, state, turns0).catch(() => undefined))
}

// [SP_CTX_02_06] One Flush, planned when the turn count was `turns0`. One
// attempt at the command: a refusal is final and waits for the next
// completed turn. `scheduled` is down on every way out.
export async function flush(io: FlushIO, state: FlushState, turns0: number): Promise<{ outcome: FlushOutcome; resume: ResumeOutcome }> {
  let again = false
  try {
    io.status(undefined)
    const read = await io.readQueue()
    // the edits of a waiting handoff belong to it (RunHandoff applies them)
    if (read.state === 'unreadable') return { outcome: 'queue-unreadable', resume: 'none' }
    if (!read.value.edits.length) return { outcome: 'nothing-queued', resume: 'none' }
    if (read.value.handoff) return { outcome: 'handoff-pending', resume: 'none' }
    // PERSON_MOVED: a turn started since planning; no command queued behind it.
    // A turn that runs plans Flush when it ends; one that already ended
    // normally gives no new planning, so plan again now; after an interrupted
    // one the queue waits for the next completed turn.
    if (movedSince(io.turns, turns0)) {
      again = !io.turns.inTurn && !io.turns.lastTurnAborted
      return { outcome: 'person-moved', resume: 'none' }
    }
    try {
      // the host queues it until the session is idle; it returns once the handler answered
      await io.compact(MARKER)
    } catch (err) {
      io.status(`context-editor: compaction refused: ${errorText(err)}; queued edits wait for the next turn`)
      return { outcome: 'host-refused', resume: 'none' }
    }
    const after = await io.readQueue()
    const q = after.state === 'unreadable' ? undefined : after.value
    if (!q?.report || !q.reportResume || q.reportId === undefined || q.reportId === state.lastSubmittedReportId) return { outcome: 'compacted', resume: 'none' }
    // PERSON_ACTIVE: a turn started between the check and the command; the
    // report stays queued for the person's next prompt (DeliverReport)
    if (movedSince(io.turns, turns0)) {
      state.lastSubmittedReportId = q.reportId
      return { outcome: 'compacted', resume: 'person-active' }
    }
    // [SP_CTX_DEC_04] D: the report rides in the prompt's own text, since the
    // host skips the mod's prompt.submit hooks for a prompt the mod submits
    const text = q.report
    try {
      await io.submit(`${text}\n\n${q.reportPrompt || DEFAULT_RESUME}`)
    } catch {
      // RESUME_FAILED: the report stays queued for the person's next prompt
      io.status('context-editor: could not resume the session; send any prompt to continue')
      return { outcome: 'compacted', resume: 'resume-failed' }
    }
    state.lastSubmittedReportId = q.reportId
    // DELIVERY_FAILED: the report stays and goes with the next prompt
    await io.removeDelivered(text).catch(() => undefined)
    return { outcome: 'compacted', resume: 'submitted' }
  } finally {
    state.scheduled = false
    if (again) schedule(io, state)
  }
}
