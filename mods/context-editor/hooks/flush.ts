// [SP_CTX_02_06] Flush: after a turn of the main conversation, apply the queue
// through the built-in /compact with MARKER and resume the session. The same
// module asks for the compaction and handles it ([C_CTX_DEC_02], C): a plugin's
// `$.command.run('compact')` reaches its own handlers. Free of the host:
// register.ts binds FlushIO to `$`.
import { MARKER } from './compaction'
import { DEFAULT_RESUME, resumeText, type Queue } from './queue'
import type { Read, Update } from './store'
import { optimizeText } from './stages'
import type { TagRegistry } from './tags'
import { movedSince, type Turns } from './turns'

// [SP_CTX_01_12] The pause between the end of a turn and the command.
export const FLUSH_DELAY_MS = 300

export type FlushIO = {
  // the queue of the current session; `unreadable` too when there is no storage
  readQueue: () => Promise<Read<Queue>>
  // [SP_CTX_02_06] on the queue's serial chain, the Update contract
  // ([SP_CTX_01_07]): `change` sees the queue as it is then; undefined writes
  // nothing. True once written; false for an unreadable queue, no storage or
  // no change. A failed write rejects.
  updateQueue: Update<Queue>
  // the tag registry: Optimize reads only the block's name from it
  readTags: () => Promise<Read<TagRegistry>>
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
// rest are outcomes of the command. `no-command`: only the optimization
// request, nothing to apply.
export type FlushOutcome = 'nothing-queued' | 'handoff-pending' | 'queue-unreadable' | 'person-moved' | 'host-refused' | 'compacted' | 'no-command'
// [SP_CTX_02_06] Errors: PERSON_ACTIVE, RESUME_FAILED.
export type ResumeOutcome = 'none' | 'submitted' | 'person-active' | 'resume-failed'
// [SP_CTX_02_06] Errors: OPTIMIZE_PERSON, OPTIMIZE_NO_BLOCK,
// OPTIMIZE_BUILD_FAILED, OPTIMIZE_FAILED; `submitted`: the optimization turn's prompt entered.
export type OptimizeOutcome = 'person' | 'no-block' | 'build-failed' | 'submitted' | 'failed'

export type FlushResult = { outcome: FlushOutcome; resume: ResumeOutcome; optimize?: OptimizeOutcome }

// [SP_CTX_02_06] A refused prompt resolves with `drop` and does not throw;
// the `submit` ports (Flush, the handoff) take it as a rejection.
export async function enteredOrThrow(entered: Promise<{ drop?: unknown }>): Promise<void> {
  const out = await entered
  if (out.drop !== undefined) throw new Error(String(out.drop))
}

function hasWork(read: Read<Queue>): boolean {
  return read.state !== 'unreadable' && (read.value.edits.length > 0 || read.value.optimize) && !read.value.handoff
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// [SP_CTX_04_06] requested → prompted: one compare-and-set write, only while
// `optimize` is still true. The other way when the prompt was refused.
// [SP_CTX_DEC_16] A batch still queued (its compaction was abandoned) loses
// its continuation: the agent's choice in the optimization turn decides it.
export function swapOptimize(q: Queue): Queue | undefined {
  if (!q.optimize) return undefined
  const carried = q.edits.length > 0 ? { resume: false, resumeSet: false } : {}
  return { ...q, ...carried, optimize: false, optimizePrompted: true }
}

export function unswapOptimize(q: Queue): Queue | undefined {
  return q.optimizePrompted || !q.optimize ? { ...q, optimize: true, optimizePrompted: false } : undefined
}

export function dropOptimize(q: Queue): Queue | undefined {
  return q.optimize ? { ...q, optimize: false } : undefined
}

// [SP_CTX_02_06] ON turn completed (main loop, not aborted), after
// DetectOptimize: plan one Flush when the queue holds edits or an
// optimization request, and no handoff. True when a Flush was planned.
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
// completed turn. With an optimization request, the optimization turn's
// prompt takes the place of the resume prompt. `scheduled` is down on every
// way out.
export async function flush(io: FlushIO, state: FlushState, turns0: number): Promise<FlushResult> {
  let again = false
  try {
    io.status(undefined)
    const read = await io.readQueue()
    // the edits of a waiting handoff belong to it (RunHandoff applies them)
    if (read.state === 'unreadable') return { outcome: 'queue-unreadable', resume: 'none' }
    if (!read.value.edits.length && !read.value.optimize) return { outcome: 'nothing-queued', resume: 'none' }
    if (read.value.handoff) return { outcome: 'handoff-pending', resume: 'none' }
    // PERSON_MOVED: a turn started since planning; no command queued behind it.
    // A turn that runs plans Flush when it ends; one that already ended
    // normally gives no new planning, so plan again now; after an interrupted
    // one the queue waits for the next completed turn (an optimization
    // request stays for DeliverReport).
    if (movedSince(io.turns, turns0)) {
      again = !io.turns.inTurn && !io.turns.lastTurnAborted
      return { outcome: 'person-moved', resume: 'none' }
    }
    let q: Queue | undefined = read.value
    let outcome: FlushOutcome = 'no-command'
    let compacted = false
    if (read.value.edits.length) {
      const id0 = read.value.reportId
      try {
        // the host queues it until the session is idle; it returns once the handler answered
        await io.compact(MARKER)
      } catch (err) {
        // the optimization request stays: its advice goes with the person's prompt
        io.status(`context-editor: compaction refused: ${errorText(err)}; queued edits wait for the next turn`)
        return { outcome: 'host-refused', resume: 'none' }
      }
      outcome = 'compacted'
      const after = await io.readQueue()
      q = after.state === 'unreadable' ? undefined : after.value
      // the handler wrote the report of this application; a skip without one is no compaction
      compacted = q?.reportId !== undefined && q.reportId !== id0
    }
    if (!q) return { outcome, resume: 'none' }
    if (q.optimize) {
      const opt = await optimize(io, state, q, turns0, compacted)
      return { outcome, resume: opt.resume, optimize: opt.optimize }
    }
    return { outcome, resume: await resume(io, state, q, turns0) }
  } finally {
    state.scheduled = false
    if (again) schedule(io, state)
  }
}

// [SP_CTX_02_06] Resume: the ordinary resume after an application.
async function resume(io: FlushIO, state: FlushState, q: Queue, turns0: number): Promise<ResumeOutcome> {
  if (!q.report || !q.reportResume || q.reportId === undefined || q.reportId === state.lastSubmittedReportId) return 'none'
  // PERSON_ACTIVE: a turn started between the check and the command; the
  // report stays queued for the person's next prompt (DeliverReport)
  if (movedSince(io.turns, turns0)) {
    state.lastSubmittedReportId = q.reportId
    return 'person-active'
  }
  // [SP_CTX_DEC_04] D: the report rides in the prompt's own text, since the
  // host skips the mod's prompt.submit hooks for a prompt the mod submits;
  // [SP_CTX_DEC_17] the agent's resume prompt goes under its author's frame
  const text = q.report
  try {
    await io.submit(`${text}\n\n${resumeText(q.reportPrompt || DEFAULT_RESUME)}`)
  } catch {
    // RESUME_FAILED: the report stays queued for the person's next prompt
    io.status('context-editor: could not resume the session; send any prompt to continue')
    return 'resume-failed'
  }
  state.lastSubmittedReportId = q.reportId
  // DELIVERY_FAILED: the report stays and goes with the next prompt
  await io.removeDelivered(text).catch(() => undefined)
  return 'submitted'
}

// PersonFirst: the report and the advice go with the person's prompt
// (DeliverReport); no prompt here.
function personFirst(state: FlushState, q: Queue): void {
  if (q.report && q.reportId !== undefined) state.lastSubmittedReportId = q.reportId
}

// [SP_CTX_02_06] Optimize: one prompt of the optimization turn in place of
// the resume prompt of this end of turn. It reads only the block's name from
// the registry, no rows of the conversation ([SP_CTX_DEC_15]).
async function optimize(
  io: FlushIO,
  state: FlushState,
  q: Queue,
  turns0: number,
  compacted: boolean,
): Promise<{ optimize: OptimizeOutcome; resume: ResumeOutcome }> {
  // OPTIMIZE_PERSON: the person's turn began before the prompt
  if (movedSince(io.turns, turns0)) return personFirst(state, q), { optimize: 'person', resume: 'none' }
  const reg = await io.readTags().catch((err): Read<TagRegistry> => ({ state: 'unreadable', reason: errorText(err) }))
  if (reg.state === 'unreadable' || !reg.value.lastClosed) {
    // OPTIMIZE_NO_BLOCK: the request ends; the batch resumes as without the mark
    await io.updateQueue(dropOptimize).catch(() => undefined)
    io.status(`context-editor: optimization turn skipped: ${reg.state === 'unreadable' ? 'the tag registry is unreadable' : 'no closed block'}`)
    return { optimize: 'no-block', resume: await resume(io, state, q, turns0) }
  }
  let report: string | undefined
  let advice: string
  try {
    report = q.report && q.reportId !== state.lastSubmittedReportId ? q.report : undefined
    advice = optimizeText(reg.value.lastClosed, compacted, reg.value.notes.length)
  } catch (err) {
    // OPTIMIZE_BUILD_FAILED
    if (compacted && q.reportResume) {
      await io.updateQueue(dropOptimize).catch(() => undefined)
      io.status(`context-editor: optimization turn not started: ${errorText(err)}`)
      return { optimize: 'build-failed', resume: await resume(io, state, q, turns0) }
    }
    io.status(`context-editor: optimization turn not started: ${errorText(err)}; the advice goes with your next prompt`)
    return { optimize: 'build-failed', resume: 'none' }
  }
  // the check again right before the swap: the person may have begun a turn during the command
  if (movedSince(io.turns, turns0)) return personFirst(state, q), { optimize: 'person', resume: 'none' }
  // compare-and-set: DeliverReport may have served the request with the person's prompt
  const swapped = await io.updateQueue(swapOptimize).catch(() => false)
  if (!swapped) return personFirst(state, q), { optimize: 'person', resume: 'none' }
  try {
    // the queue's own resume text is not sent: the optimization turn decides with its own context_edit
    await io.submit(report ? `${report}\n\n${advice}` : advice)
  } catch {
    // OPTIMIZE_FAILED: the swap undone in one write; the report stays
    await io.updateQueue(unswapOptimize).catch(() => undefined)
    io.status('context-editor: could not start the optimization turn; the advice goes with your next prompt')
    return { optimize: 'failed', resume: 'none' }
  }
  if (report && q.reportId !== undefined) {
    state.lastSubmittedReportId = q.reportId
    await io.removeDelivered(report).catch(() => undefined)
  }
  return { optimize: 'submitted', resume: 'none' }
}
