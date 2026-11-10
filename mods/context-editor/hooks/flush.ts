// [SP_CTX_02_06] Flush: after a turn of the main conversation, apply the queue
// through the built-in /compact with MARKER and resume the session. The same
// module asks for the compaction and handles it ([C_CTX_DEC_02], C): a plugin's
// `$.command.run('compact')` reaches its own handlers. Free of the host:
// register.ts binds FlushIO to `$`.
import { MARKER } from './compaction'
import { DEFAULT_RESUME, hasBatchChoices, keepOtherSteps, noteOnce, resumeText, type Queue } from './queue'
import { errorText, modText } from './rows'
import type { Read, Update } from './store'
import { adviceFor, compactTurnText } from './stages'
import type { TagRegistry } from './tags'
import type { Renamed } from './title'
import { movedSince, type Turns } from './turns'

// [SP_CTX_01_12] The pause between the end of a turn and the command.
export const FLUSH_DELAY_MS = 300
// [SP_CTX_01_12] A planned Flush whose timer has not fired this long after
// planning counts as lost (the host may refuse a timer silently): the next
// planning goes ahead instead of waiting on it forever.
export const FLUSH_STALE_MS = 10_000
// [SP_CTX_01_12] [SP_CTX_02_34] The longest Flush waits for
// CalibrateBeforeApply before the command; later, the apply takes the ratio
// stored already (phase 29).
export const CALIB_WAIT_MS = 1000

export type FlushIO = {
  // the queue of the current session; `unreadable` too when there is no storage
  readQueue: () => Promise<Read<Queue>>
  // [SP_CTX_02_06] on the queue's serial chain, the Update contract
  // ([SP_CTX_01_07]): `change` sees the queue as it is then; undefined writes
  // nothing. True once written; false for an unreadable queue, no storage or
  // no change. A failed write rejects.
  updateQueue: Update<Queue>
  // the tag registry: the compression turn reads the number of notes, the
  // resume prompt the waiting block ([SP_CTX_DEC_37])
  readTags: () => Promise<Read<TagRegistry>>
  // [SP_CTX_DEC_37] on the registry chain: waiting marked → advised
  // (AdviseWaiting); absent: none
  advised?: () => Promise<unknown>
  // runs the built-in /compact with `args`, once; rejects with the host's text
  compact: (args: string) => Promise<void>
  // [SP_CTX_02_34] CalibrateBeforeApply in the current session's storage,
  // before the command of a batch with edits (phase 29); absent: none
  calibrate?: () => Promise<unknown>
  // a pause of `ms`: the bound of `calibrate` (CALIB_WAIT_MS); absent: no bound
  sleep?: (ms: number) => Promise<unknown>
  // a deferred action; register.ts creates it from the hook that called, never
  // from a tool.call or prompt.submit hook (the host refuses commands there).
  // A throw (the host refused the timer at once) reaches the planner.
  after: (ms: number, fn: () => void) => void
  // a refused prompt (an exception or a result with `drop`) rejects. The
  // host skips the mod's own prompt.submit hooks for it (DeliverReport too).
  submit: (text: string) => Promise<void>
  // [SP_CTX_02_08] RemoveDelivered on the queue's serial chain
  removeDelivered: (delivered: string) => Promise<void>
  status: (text?: string) => void
  // [SP_CTX_02_42] what the person must see in every host (the status line
  // may be invisible in VS Code / stream-json)
  toast: (text: string) => void
  // [SP_CTX_02_43] the person's line in the chat, never sent to the model
  // ($.ui.log); absent: no line
  log?: (text: string) => void
  // [SP_CTX_02_43] the line the apply with this report id left (ApplyLine),
  // if this module instance's handler wrote that report; absent: none
  appliedLine?: (reportId: number) => string | undefined
  now: () => number
  // [SP_CTX_02_42] the current session id
  sessionId: () => Promise<string>
  turns: Readonly<Turns>
  // [SP_CTX_02_54] the host passes over the mod's compaction hook; `wait`:
  // while unknown, wait for a probe running in this process ([SP_CTX_02_56]);
  // absent: never passed
  compactPassed?: (wait: boolean) => Promise<boolean>
  // [SP_CTX_02_72] the session title: `due` — TitleDue on a readable
  // registry; `rename` — RunRename (never throws); absent: none
  title?: { due: () => Promise<boolean>; rename: () => Promise<Renamed | undefined> }
}

// [SP_CTX_02_06] Module memory; a reload starts it over. `plannedAt`: when
// the planned timer was made, until it fires; `compactSession`: the session
// whose /compact planned this Flush ([SP_CTX_02_42]).
export type FlushState = { scheduled: boolean; lastSubmittedReportId: number; plannedAt?: number; compactSession?: string }

export function newFlushState(): FlushState {
  return { scheduled: false, lastSubmittedReportId: 0 }
}

// [SP_CTX_02_06] A Flush is planned or running, unless its timer is lost
// (not fired FLUSH_STALE_MS after planning).
export function isPlanned(state: FlushState, now: number): boolean {
  return state.scheduled && !(state.plannedAt !== undefined && now - state.plannedAt > FLUSH_STALE_MS)
}

// [SP_CTX_02_06] Errors: QUEUE_UNREADABLE, PERSON_MOVED, HOST_REFUSED; the
// rest are outcomes of the command. `no-command`: only the request of the
// person's /compact, nothing to apply.
export type FlushOutcome =
  | 'nothing-queued'
  | 'handoff-pending'
  | 'queue-unreadable'
  | 'person-moved'
  | 'host-refused'
  | 'compacted'
  | 'no-command'
  | 'session-changed'
  | 'passed-over'
// [SP_CTX_02_06] Errors: PERSON_ACTIVE, RESUME_FAILED.
export type ResumeOutcome = 'none' | 'submitted' | 'person-active' | 'resume-failed'
// [SP_CTX_02_06] Errors: OPTIMIZE_PERSON, OPTIMIZE_BUILD_FAILED,
// OPTIMIZE_FAILED; `submitted`: the compression turn's prompt entered.
export type OptimizeOutcome = 'person' | 'build-failed' | 'submitted' | 'failed'

// `renamed`: the rename at the end of the turn ([SP_CTX_02_72]), when one ran
export type FlushResult = { outcome: FlushOutcome; resume: ResumeOutcome; optimize?: OptimizeOutcome; renamed?: Renamed }

// [SP_CTX_02_06] A refused prompt resolves with `drop` and does not throw;
// the `submit` ports (Flush, the handoff) take it as a rejection.
export async function enteredOrThrow(entered: Promise<{ drop?: unknown }>): Promise<void> {
  const out = await entered
  if (out.drop !== undefined) throw new Error(String(out.drop))
}

// [SP_CTX_02_06] Edits, or the request of the person's /compact; a legacy
// mark's request (`optimize` without `compact`) is no work (OPTIMIZE_LEGACY).
function hasWork(read: Read<Queue>): boolean {
  return read.state !== 'unreadable' && (read.value.edits.length > 0 || compactAsked(read.value)) && !read.value.handoff
}

function compactAsked(q: Queue): boolean {
  return q.optimize && q.compact
}

// [SP_CTX_02_06] OPTIMIZE_LEGACY: a mark's request from a version before
// 2026-10-14 ends without a turn or an advice ([SP_CTX_DEC_37]).
export function dropLegacy(q: Queue): Queue | undefined {
  return q.optimize && !q.compact ? { ...q, optimize: false } : undefined
}

// [SP_CTX_04_06] requested → prompted: one compare-and-set write, only while
// `optimize` is still true. The other way when the prompt was refused.
// [SP_CTX_DEC_16] A batch still queued (its compaction was abandoned) loses
// its continuation: the agent's choice in the compression turn decides it.
export function swapOptimize(q: Queue): Queue | undefined {
  if (!q.optimize) return undefined
  const carried = q.edits.length > 0 ? { resume: false, resumeSet: false } : {}
  return { ...q, ...carried, optimize: false, optimizePrompted: true }
}

export function unswapOptimize(q: Queue): Queue | undefined {
  return q.optimizePrompted || !q.optimize ? { ...q, optimize: true, optimizePrompted: false } : undefined
}

export function dropOptimize(q: Queue): Queue | undefined {
  return q.optimize ? { ...q, optimize: false, compact: false } : undefined
}

// [SP_CTX_02] The steps of the end of a main-conversation turn after `next`;
// register.ts binds each to `$`. A failed step, rejected or thrown at once,
// never stops the next one.
export type TurnEndIO = {
  // [SP_CTX_02_53] NoteTurn of Capabilities, Merge and the person's line,
  // before anything else; absent: none
  capabilities?: (aborted: boolean, storage: Promise<string | undefined>) => Promise<unknown>
  // [SP_CTX_02_30] the storage of the session whose turn ended; undefined: none
  storage: () => Promise<string | undefined>
  // [SP_CTX_02_30] DetectOptimize in `dir` (undefined: the mark is ignored)
  detect: (dir: string | undefined, e: { aborted: boolean; answer: string }) => Promise<unknown>
  // [SP_CTX_02_12] TagRegistry.turn += 1 on the registry's chain in `dir`
  countTurn: (dir: string) => Promise<unknown>
  // [SP_CTX_02_46] the repair after a switch in the process (/resume): its
  // timer, from the turn end; absent: none
  repair?: () => Promise<unknown>
  // [SP_CTX_02_06] FlushAfterTurn
  flush: (aborted: boolean) => Promise<unknown>
  // [SP_CTX_02_21] the handoff's step of the end of the turn
  handoff: (aborted: boolean) => Promise<unknown>
}

// [SP_CTX_02] AfterTurn: in this order, one after the other, DetectOptimize,
// the registry's turn count (the mark compares with the count not yet
// raised; an aborted turn does not count), the repair's timer after a
// switch in the process ([SP_CTX_02_46]) and Flush (once the mark's block
// waits, so its resume prompt carries WaitingAdvice); the handoff besides. The deferred
// actions these plan come from the turn.complete hook, an origin the host
// queues commands from.
export async function afterTurn(io: TurnEndIO, e: { aborted: boolean; answer?: unknown }): Promise<void> {
  const answer = typeof e.answer === 'string' ? e.answer : ''
  // [SP_CTX_01_07] CONC-01: the folder is asked for at once, before any await
  const at = step(() => io.storage())
  const steps = (async () => {
    if (io.capabilities) await step(() => io.capabilities!(e.aborted, at))
    const dir = await at
    await step(() => io.detect(dir, { aborted: e.aborted, answer }))
    if (!e.aborted && dir) await step(() => io.countTurn(dir))
    if (io.repair) await step(io.repair)
    await step(() => io.flush(e.aborted))
  })()
  const handoff = step(() => io.handoff(e.aborted))
  await Promise.all([steps, handoff])
}

// One step of AfterTurn, started at once: a rejection or a synchronous throw
// gives undefined.
async function step<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch {
    return undefined
  }
}

// [SP_CTX_02_72] TitleDue through the port; a failure: not due.
async function titleDue(io: FlushIO): Promise<boolean> {
  try {
    return (await io.title?.due()) ?? false
  } catch {
    return false
  }
}

// [SP_CTX_02_06] ON turn completed (main loop, not aborted), after
// DetectOptimize: plan one Flush when the queue holds edits, the
// request of the person's /compact or a title due ([SP_CTX_02_72]), and no
// handoff. True when a Flush was planned.
export async function flushAfterTurn(io: FlushIO, state: FlushState, aborted: boolean): Promise<boolean> {
  if (aborted || isPlanned(state, io.now())) return false
  // [SP_CTX_02_54] passed over: no Flush for the queue; it stays for the brief of /compact
  const passed = await io.compactPassed?.(false).catch(() => false)
  const read = await io.readQueue()
  // [SP_CTX_01_04] [SP_CTX_DEC_16] the turn ended with no edits queued: the
  // choices its calls made (all their edits refused) end with it, so a later
  // batch does not take an old resume_prompt or stop by an old resume false
  if (read.state === 'ok' && !read.value.edits.length && !read.value.handoff && hasBatchChoices(read.value))
    await io.updateQueue(clearChoices).catch(() => undefined)
  const work = !passed && hasWork(read)
  // [SP_CTX_02_72] a title due plans a Flush too, passed over or not (no
  // handoff: it carries the title)
  const due = !work && read.state !== 'unreadable' && !read.value.handoff && (await titleDue(io))
  if ((!work && !due) || isPlanned(state, io.now())) return false
  try {
    schedule(io, state)
  } catch {
    // the host refused the timer: nothing planned; the next turn end tries again
    return false
  }
  return true
}

// The batch's choices back to their defaults while it has no edits (a
// handoff's edits are its own); else no change.
function clearChoices(q: Queue): Queue | undefined {
  return !q.edits.length && !q.handoff && hasBatchChoices(q) ? keepOtherSteps(q) : undefined
}

// [SP_CTX_02_42] Flush for the person's /compact, from the command.run hook
// (an origin no turn waits on, as /handoff's). True: planned now or already
// planned; a refused timer throws, with nothing left planned.
export function requestFlush(io: FlushIO, state: FlushState, session: string): boolean {
  if (isPlanned(state, io.now())) {
    // only a timer not fired yet reads it: a running Flush consumed its own
    if (state.plannedAt !== undefined) state.compactSession = session
    return true
  }
  state.compactSession = session
  try {
    schedule(io, state)
  } catch (err) {
    state.compactSession = undefined
    throw err
  }
  return true
}

// A deferred action from the end of the turn (or the person's /compact): the
// origin the host queues. A timer refused at once leaves nothing planned.
function schedule(io: FlushIO, state: FlushState): void {
  state.scheduled = true
  state.plannedAt = io.now()
  const turns0 = io.turns.turns
  try {
    io.after(FLUSH_DELAY_MS, () => void flush(io, state, turns0).catch(() => undefined))
  } catch (err) {
    state.scheduled = false
    state.plannedAt = undefined
    throw err
  }
}

// [SP_CTX_02_06] One Flush, planned when the turn count was `turns0`. One
// attempt at the command: a refusal is final and waits for the next
// completed turn. With the request of the person's /compact, the
// compression turn's prompt takes the place of the resume prompt. `scheduled` is down on every
// way out.
export async function flush(io: FlushIO, state: FlushState, turns0: number): Promise<FlushResult> {
  let again = false
  // the timer fired: no longer a planned-but-lost one
  state.plannedAt = undefined
  const session = state.compactSession
  state.compactSession = undefined
  try {
    io.status(undefined)
    // [SP_CTX_02_42] COMPACT_SESSION_CHANGED: /clear or /resume switched the
    // session after the person's /compact; its request stays in the old
    // session's queue (DeliverReport serves it with a prompt there)
    if (session !== undefined && (await io.sessionId().catch(() => session)) !== session) {
      io.toast(modText('/compact skipped: the session changed before the compression turn; run /compact again'))
      return { outcome: 'session-changed', resume: 'none' }
    }
    const read = await io.readQueue()
    // [SP_CTX_02_42] the Flush of an ended compression turn runs: no longer busy
    if (read.state !== 'unreadable' && read.value.compactEndedAt !== undefined)
      await io.updateQueue(({ compactEndedAt, ...q }) => (compactEndedAt !== undefined ? q : undefined)).catch(() => undefined)
    // the edits of a waiting handoff belong to it (RunHandoff applies them)
    if (read.state === 'unreadable') return { outcome: 'queue-unreadable', resume: 'none' }
    // OPTIMIZE_LEGACY: then as without a request
    if (dropLegacy(read.value)) {
      await io.updateQueue(dropLegacy).catch(() => undefined)
      read.value = { ...read.value, optimize: false }
    }
    const work = read.value.edits.length > 0 || read.value.optimize
    // [SP_CTX_02_72] a handoff carries the title: no rename beside it
    const due = !read.value.handoff && (await titleDue(io))
    if (!work && !due) return { outcome: 'nothing-queued', resume: 'none' }
    if (read.value.handoff) return { outcome: 'handoff-pending', resume: 'none' }
    // [SP_CTX_02_54] FLUSH_PASSED_OVER: no command, the edits stay (the brief
    // of the person's /compact takes them); a compression turn's request
    // made before the verdict goes, its turn would only meet refusals.
    // It gates the compaction only, not the rename ([SP_CTX_02_72]).
    const passed = work && (await io.compactPassed?.(true).catch(() => false))
    if (passed && read.value.optimize) await io.updateQueue(dropOptimize).catch(() => undefined)
    // [SP_CTX_02_34] the report and the person's line take this
    // conversation's ratio; before the turn check, so this pause never puts
    // the command behind a new turn
    if (!passed && read.value.edits.length) await calibrateWithin(io)
    // PERSON_MOVED: a turn started since planning; no command queued behind it.
    // A turn that runs plans Flush when it ends; one that already ended
    // normally gives no new planning, so plan again now; after an interrupted
    // one the queue waits for the next completed turn (a /compact
    // request stays for DeliverReport).
    if (movedSince(io.turns, turns0)) {
      again = !io.turns.inTurn && !io.turns.lastTurnAborted
      return { outcome: 'person-moved', resume: 'none' }
    }
    // [SP_CTX_02_72] RenameAtTurnEnd: before the apply, so the apply drops its rows
    const renamed = due ? await io.title!.rename().catch(() => undefined) : undefined
    const named = renamed ? { renamed } : {}
    if (passed) return { outcome: 'passed-over', resume: 'none', ...named }
    // a rename alone: no compaction, no resume prompt
    if (!work) return { outcome: 'no-command', resume: 'none', ...named }
    // the rename waited for idle: a turn started meanwhile gets no command behind it
    if (renamed && movedSince(io.turns, turns0)) {
      again = !io.turns.inTurn && !io.turns.lastTurnAborted
      return { outcome: 'person-moved', resume: 'none', ...named }
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
        // the /compact request stays: its advice goes with the person's prompt
        const refused = modText(`compaction refused: ${errorText(err)}; queued edits wait for the next turn`)
        io.status(refused)
        if (read.value.compact) io.toast(refused)
        return { outcome: 'host-refused', resume: 'none', ...named }
      }
      outcome = 'compacted'
      const after = await io.readQueue()
      q = after.state === 'unreadable' ? undefined : after.value
      // the handler wrote the report of this application; a skip without one is no compaction
      compacted = q?.reportId !== undefined && q.reportId !== id0
      // [SP_CTX_02_43] one line for the person per apply that changed something
      if (compacted) logApplied(io, q!.reportId!)
    }
    if (!q) return { outcome, resume: 'none', ...named }
    if (compactAsked(q)) {
      const opt = await optimize(io, state, q, turns0, compacted)
      return { outcome, resume: opt.resume, optimize: opt.optimize, ...named }
    }
    return { outcome, resume: await resume(io, state, q, turns0), ...named }
  } finally {
    state.scheduled = false
    // [SP_CTX_02_42] no session check outlives this Flush
    state.compactSession = undefined
    if (again) {
      try {
        schedule(io, state)
      } catch {
        // a refused timer: nothing planned; the next turn end plans again
      }
    }
  }
}

// [SP_CTX_02_34] CalibrateBeforeApply, at most CALIB_WAIT_MS: a failure or a
// timeout only leaves the ratio stored already.
async function calibrateWithin(io: Pick<FlushIO, 'calibrate' | 'sleep'>): Promise<void> {
  if (!io.calibrate) return
  let work: Promise<unknown>
  try {
    work = io.calibrate().catch(() => undefined)
  } catch {
    return
  }
  let bound: Promise<unknown> | undefined
  try {
    bound = io.sleep?.(CALIB_WAIT_MS).catch(() => undefined)
  } catch {
    // a pause refused at once: no wait at all, the command never hangs on it
    return
  }
  await (bound ? Promise.race([work, bound]) : work)
}

// [SP_CTX_02_43] LogApply: the person's line of the apply that wrote report
// `id`, once the command returned; nothing without a line (no edit applied,
// or another instance's handler). A failure only loses the line.
export function logApplied(io: Pick<FlushIO, 'log' | 'appliedLine'>, id: number): void {
  try {
    const line = io.appliedLine?.(id)
    if (line) io.log?.(line)
  } catch {
    // the line is for the person only; nothing depends on it
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
  // [SP_CTX_DEC_37] the prompt passes no hook of the mod: WaitingAdvice rides in it; a failed build goes without
  let wait: string | undefined
  try {
    wait = adviceFor(await io.readTags())
  } catch {
    wait = undefined
  }
  try {
    // [SP_CTX_01_05] CommandNote once per delivered message
    await io.submit(`${noteOnce(text)}\n\n${resumeText(q.reportPrompt || DEFAULT_RESUME)}${wait ? `\n\n${wait}` : ''}`)
  } catch {
    // RESUME_FAILED: the report stays queued for the person's next prompt
    io.status(modText('could not resume the session; send any prompt to continue'))
    return 'resume-failed'
  }
  state.lastSubmittedReportId = q.reportId
  // WAIT_ADVICE_LOST: the advice goes again with the next prompt; set before
  // the report's removal, so a prompt meanwhile does not repeat it
  if (wait) await io.advised?.().catch(() => undefined)
  // DELIVERY_FAILED: the report stays and goes with the next prompt
  await io.removeDelivered(text).catch(() => undefined)
  return 'submitted'
}

// PersonFirst: the report and the advice go with the person's prompt
// (DeliverReport); no prompt here.
function personFirst(state: FlushState, q: Queue): void {
  if (q.report && q.reportId !== undefined) state.lastSubmittedReportId = q.reportId
}

// [SP_CTX_02_06] Optimize: one prompt of the compression turn of the
// person's /compact in place of the resume prompt of this end of turn. It
// reads only the number of notes from the registry, no rows of the
// conversation ([SP_CTX_DEC_15]); what the person must see goes as a toast.
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
  let report: string | undefined
  let advice: string
  try {
    report = q.report && q.reportId !== state.lastSubmittedReportId ? q.report : undefined
    // the compression turn covers the whole conversation: no WaitingAdvice
    advice = compactTurnText(reg.state === 'unreadable' ? 0 : reg.value.notes.length)
  } catch (err) {
    // OPTIMIZE_BUILD_FAILED
    if (compacted && q.reportResume) {
      await io.updateQueue(dropOptimize).catch(() => undefined)
      io.toast(modText(`compression turn not started: ${errorText(err)}`))
      return { optimize: 'build-failed', resume: await resume(io, state, q, turns0) }
    }
    io.toast(modText(`compression turn not started: ${errorText(err)}; the advice goes with your next prompt`))
    return { optimize: 'build-failed', resume: 'none' }
  }
  // the check again right before the swap: the person may have begun a turn during the command
  if (movedSince(io.turns, turns0)) return personFirst(state, q), { optimize: 'person', resume: 'none' }
  // compare-and-set: DeliverReport may have served the request with the person's prompt
  const swapped = await io.updateQueue(swapOptimize).catch(() => false)
  if (!swapped) return personFirst(state, q), { optimize: 'person', resume: 'none' }
  try {
    // the queue's own resume text is not sent: the compression turn decides with its own context_edit
    await io.submit(report ? `${noteOnce(report)}\n\n${advice}` : advice)
  } catch {
    // OPTIMIZE_FAILED: the swap undone in one write; the report stays
    await io.updateQueue(unswapOptimize).catch(() => undefined)
    io.toast(modText('could not start the compression turn; the advice goes with your next prompt'))
    return { optimize: 'failed', resume: 'none' }
  }
  if (report && q.reportId !== undefined) {
    state.lastSubmittedReportId = q.reportId
    await io.removeDelivered(report).catch(() => undefined)
  }
  return { optimize: 'submitted', resume: 'none' }
}
