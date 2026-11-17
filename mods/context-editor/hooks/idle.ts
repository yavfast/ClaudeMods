// [SP_HELP_02_11] IdleRun: the idle timer of the main conversation. At the
// end of each completed turn the mod arms one timer of CACHE_TTL_MS +
// IDLE_SLACK_MS; when it fires in an idle the prompt cache outlived, the
// deferred batches apply through the mod's own compaction, with no turn and
// no prompt. Pure: register.ts binds IdleIO to `$`.
import { withApplyDeferred, withoutApplyDeferred } from './batches'
import { CACHE_TTL_MS, temperature } from './cacheclock'
import { MARKER } from './compaction'
import { appliedSince, calibrateWithin, type FlushIO } from './flush'
import type { Queue } from './queue'
import { errorText, modText } from './rows'
import type { Read } from './store'
import { movedSince, type Turns } from './turns'

// [SP_HELP_01_09] The slack of the idle timer beyond CACHE_TTL_MS.
export const IDLE_SLACK_MS = 60_000

// [SP_HELP_02_11] What armed the timer: the end of a turn, or StartRun
// ([SP_HELP_02_12]); only a turn's timer may wake the agent (I5, phase 8).
export type ArmedBy = 'turn' | 'start'

// [SP_HELP_02_11] Module memory; a reload or the end of the process drops
// the timer with it. `seq` names the timer armed last: a replaced one that
// still fires does nothing. `applying`: the idle apply's command runs, so
// the handler marks its journal entry `idle` ([SP_HELP_01_08]); `starting`:
// StartRun's command runs ([SP_HELP_02_12]). With either, the handler skips
// a command a turn overtook ([SP_CTX_02_07]).
export type IdleMemory = {
  session?: string
  armedTurns?: number
  armedBy?: ArmedBy
  timer?: { cancel: () => void }
  seq: number
  applying: boolean
  starting: boolean
}

export function newIdleMemory(): IdleMemory {
  return { seq: 0, applying: false, starting: false }
}

// [SP_HELP_02_11] What IdleRun reads and runs; register.ts binds it to `$`.
// The command, the calibration and the person's line are Flush's; the
// queue and the clock's verdict work in the folder the run took once.
export type IdleIO = Pick<FlushIO, 'compact' | 'calibrate' | 'sleep' | 'status' | 'log' | 'appliedLine' | 'compactPassed'> & {
  // the current session id
  sessionId: () => Promise<string>
  // [SP_CTX_01_07] the current session's storage folder, asked once per run
  // (CONC-01); undefined: none
  storage: () => Promise<string | undefined>
  // the queue in `dir`, read; and changed on its serial chain (Update contract)
  readQueue: (dir: string) => Promise<Read<Queue>>
  updateQueue: (dir: string, change: (q: Queue) => Queue | undefined) => Promise<boolean>
  // [SP_CTX_02_06] Flush is planned or runs (the person's /compact, a turn's
  // end): its own command serves the queue; absent: never
  flushPlanned?: () => boolean
  turns: Readonly<Turns>
  now: () => number
  // [SP_HELP_02_09] the cache clock's last request of the current session
  // (registry and memory); null: none seen; undefined: not at hand
  lastRequestAt: () => number | null | undefined
  // [SP_HELP_02_09] ColdVerdict(now, 'idle') on the registry's chain in `dir`
  coldVerdict: (dir: string) => Promise<unknown>
  // a deferred action; register.ts creates it from the turn.complete chain
  after: (ms: number, fn: () => void) => { cancel: () => void }
  // [ERR-01] a line of the debug log; absent: none
  debug?: (text: string) => void
}

// [SP_HELP_02_11] The wait of a timer whose last request was `last`: until
// CACHE_TTL_MS + IDLE_SLACK_MS after it; unknown: the whole of it.
export function idleDelay(last: number | null | undefined, now: number): number {
  const whole = CACHE_TTL_MS + IDLE_SLACK_MS
  return last === null || last === undefined ? whole : Math.max(0, last + whole - now)
}

// [SP_HELP_02_11] ArmIdle: a new timer replaces the one before; the session,
// the turn count and the origin are remembered with it. False when the host
// refused the timer (nothing armed then).
export function armIdle(io: IdleIO, mem: IdleMemory, session: string, by: ArmedBy, ms: number): boolean {
  disarmIdle(mem)
  const seq = ++mem.seq
  mem.session = session
  mem.armedTurns = io.turns.turns
  mem.armedBy = by
  try {
    mem.timer = io.after(ms, () => {
      if (mem.seq !== seq) return
      mem.timer = undefined
      void idleRun(io, mem).catch(err => io.debug?.(modText(`idle run failed: ${errorText(err)}`)))
    })
  } catch (err) {
    io.debug?.(modText(`idle timer refused: ${errorText(err)}`))
    return false
  }
  io.debug?.(modText(`idle timer armed for ${ms} ms (${by}, turn ${mem.armedTurns})`))
  return true
}

// The armed timer stops; a timer that fires anyway finds `seq` moved on.
export function disarmIdle(mem: IdleMemory): void {
  const t = mem.timer
  mem.timer = undefined
  mem.seq += 1
  try {
    t?.cancel()
  } catch {
    // a timer the host already dropped
  }
}

// [SP_HELP_02_11] The end of a completed, not interrupted turn of the main
// conversation, after Flush was planned: the timer of a whole TTL and slack.
// An interrupted turn arms none; the timer of the turn before leaves by
// MovedSince when it fires.
export async function armAtTurnEnd(io: IdleIO, mem: IdleMemory, aborted: boolean): Promise<boolean> {
  // a turn that started meanwhile arms its own at its end (the count read
  // now would be that turn's, and an interrupt of it would not move it)
  if (aborted || io.turns.inTurn) return false
  const session = await io.sessionId()
  return armIdle(io, mem, session, 'turn', CACHE_TTL_MS + IDLE_SLACK_MS)
}

// What IdleRun did; the tests read it, the debug log names it.
export type IdleOutcome =
  | 'moved'
  | 'unknown'
  | 'rearmed'
  | 'nothing'
  | 'flush-planned'
  | 'passed-over'
  | 'not-marked'
  | 'applied'
  | 'skipped'
  | 'refused'

// [SP_HELP_02_11] ON idle timer. No resume prompt and no optimization prompt
// follow the apply: the report waits in the queue for the next prompt that
// passes the mod's hooks (DeliverReport, [SP_CTX_02_08]). WakeCheck after it
// comes with phase 8.
export async function idleRun(io: IdleIO, mem: IdleMemory): Promise<IdleOutcome> {
  const out = await idleSteps(io, mem)
  io.debug?.(modText(`idle timer fired: ${out}`))
  return out
}

async function idleSteps(io: IdleIO, mem: IdleMemory): Promise<IdleOutcome> {
  const armedTurns = mem.armedTurns ?? Number.NaN
  const session = mem.session
  // a turn runs or started since the timer was armed, or /clear and /resume switched the session
  if (!(await sameSession(io, session)) || movedSince(io.turns, armedTurns)) return 'moved'
  const now = io.now()
  const last = io.lastRequestAt()
  const temp = last === undefined ? 'unknown' : temperature(last, now)
  if (temp === 'unknown') return 'unknown'
  // a request since the timer was armed (a fork): the rest of its wait
  if (temp === 'warm') return armIdle(io, mem, session!, mem.armedBy ?? 'turn', idleDelay(last, now)) ? 'rearmed' : 'unknown'
  // [SP_CTX_01_07] CONC-01: the folder once, for every step of this run
  const dir = await io.storage().catch(err => void io.debug?.(modText(`idle storage not taken: ${errorText(err)}`)))
  if (!dir) return 'nothing'
  // [SP_HELP_02_09] ColdVerdict(now, 'idle'); a failure only loses the verdict
  await io.coldVerdict(dir).catch(err => io.debug?.(modText(`idle cold verdict not written: ${errorText(err)}`)))
  const read = await io.readQueue(dir)
  if (read.state === 'unreadable') return 'nothing'
  const q = read.value
  // nothing to apply: a mark left on an empty queue goes, no command runs
  // (plugin-hooks 89); the edits of a waiting handoff belong to it
  if (!q.edits.length) {
    if (q.applyDeferred || q.coldSince !== undefined) await clearMark(io, dir)
    return 'nothing'
  }
  if (q.handoff || !(q.applyDeferred || q.edits.some(e => e.deferred !== undefined))) return 'nothing'
  // a planned Flush (the person's /compact) runs its own command on this queue
  if (io.flushPlanned?.()) return 'flush-planned'
  const passed = await io.compactPassed?.(true).catch(err => {
    io.debug?.(modText(`idle: the compaction verdict failed: ${errorText(err)}`))
    return false
  })
  if (passed) {
    io.status(modText("deferred edits wait: this host passes over the mod's compaction"))
    return 'passed-over'
  }
  // the mark ties the apply to this idle: a request before the command moves
  // the last request on, and the handler skips the command (the turn's own
  // Flush serves the queue)
  const marked = await io.updateQueue(dir, x => (x.edits.length ? withApplyDeferred(x, last!) : undefined)).catch(err => {
    io.debug?.(modText(`idle apply not marked: ${errorText(err)}`))
    return false
  })
  if (!marked) return 'not-marked'
  // [SP_CTX_02_34] as Flush: the report takes this conversation's ratio
  await calibrateWithin(io)
  if (movedSince(io.turns, armedTurns) || !(await sameSession(io, session)) || io.flushPlanned?.()) {
    await clearMark(io, dir)
    return 'moved'
  }
  const id0 = q.reportId
  mem.applying = true
  try {
    // one attempt; the host queues it behind a turn that started meanwhile
    await io.compact(MARKER)
  } catch (err) {
    // after an interrupt the host refuses every command until the person types
    await clearMark(io, dir)
    io.status(modText(`idle apply refused: ${errorText(err)}; deferred edits wait`))
    return 'refused'
  } finally {
    mem.applying = false
  }
  const { compacted } = await appliedSince({ ...io, readQueue: () => io.readQueue(dir) }, id0)
  return compacted ? 'applied' : 'skipped'
}

// The session the timer was armed in is still the current one; a failed
// read counts as another session ([ERR-01]: a debug line).
async function sameSession(io: IdleIO, session: string | undefined): Promise<boolean> {
  const current = await io.sessionId().catch(err => void io.debug?.(modText(`idle: the session id was not read: ${errorText(err)}`)))
  return current !== undefined && current === session
}

// The idle mark gone on the queue's chain; a failure leaves a mark the
// handler drops as stale once the last request moves ([SP_HELP_02_10]).
async function clearMark(io: IdleIO, dir: string): Promise<void> {
  await io.updateQueue(dir, withoutApplyDeferred).catch(err => io.debug?.(modText(`idle mark not cleared: ${errorText(err)}`)))
}

// [SP_HELP_01_09] The longest wait of the session.start hook for StartRun's
// callback to start the command: the session.start chain holds the
// person's first prompt.
export const START_WAIT_MS = 1000

// [SP_HELP_02_12] What StartRun reads besides IdleRun's ports.
export type StartIO = IdleIO & {
  // [SP_CTX_02_53] Verdict(compact) as a session start knows it: the cache
  // of this host version (no probe wait, SP_HELP_DEC_09)
  compactVerdict: () => 'reached' | 'passed' | 'unknown'
  // [SP_HELP_01_07] the last request of the session whose storage is `dir`:
  // the registry and the module memory (null: none seen); or why the
  // registry is unreadable
  clockAt: (dir: string) => Promise<{ last: number | null } | { reason: string }>
  // the bounded wait of the hook
  sleep: (ms: number) => Promise<unknown>
}

// What StartRun did; the tests read it, the debug log names it.
export type StartOutcome = 'not-reached' | 'nothing' | 'unknown' | 'armed' | 'not-armed' | 'not-marked' | 'started' | 'timeout'

// [SP_HELP_02_12] StartRun: a session start in a new host process, after
// PrepareStorage. Cold: the batches that outlived the process apply before
// its first request, through a command planned with `after(0)`; the hook
// waits until the callback has called the command, at most START_WAIT_MS,
// never for the command itself. Warm: the idle timer for the rest of the
// cache's life (armedBy 'start'). No prompt follows in any branch (I7).
export async function startRun(io: StartIO, mem: IdleMemory): Promise<StartOutcome> {
  const [out, why] = await startSteps(io, mem)
  // [ERR-01] `nothing` names its cause
  io.debug?.(modText(`start run: ${out}${why ? ` (${why})` : ''}`))
  return out
}

async function startSteps(io: StartIO, mem: IdleMemory): Promise<[StartOutcome, string?]> {
  const out = await startBranch(io, mem)
  return typeof out === 'string' ? [out] : ['nothing', out.why]
}

async function startBranch(io: StartIO, mem: IdleMemory): Promise<StartOutcome | { why: string }> {
  // unknown is not enough: the first session on a new host version probes, the batches wait
  if (io.compactVerdict() !== 'reached') return 'not-reached'
  // [SP_CTX_01_07] CONC-01: the folder once, for every step of this run
  const dir = await io.storage()
  if (!dir) return { why: 'no storage' }
  const read = await io.readQueue(dir)
  if (read.state === 'unreadable') return { why: `queue unreadable: ${read.reason}` }
  const q = read.value
  if (q.handoff) return { why: 'a handoff waits' }
  if (!q.edits.some(e => e.deferred !== undefined)) return { why: 'no deferred edit' }
  const clock = await io.clockAt(dir)
  if ('reason' in clock) return { why: `registry unreadable: ${clock.reason}` }
  const last = clock.last
  const now = io.now()
  const temp = temperature(last, now)
  if (temp === 'unknown') return 'unknown'
  if (temp === 'warm') return armIdle(io, mem, await io.sessionId(), 'start', idleDelay(last, now)) ? 'armed' : 'not-armed'
  // the mark ties the apply to this cold cache; the reads and the write come
  // before the timer, so the command queues before the session.start chain ends
  const marked = await io.updateQueue(dir, x => (x.edits.some(e => e.deferred !== undefined) ? withApplyDeferred(x, last!) : undefined)).catch(err => {
    io.debug?.(modText(`start apply not marked: ${errorText(err)}`))
    return false
  })
  if (!marked) return 'not-marked'
  const id0 = q.reportId
  type Wait = 'waiting' | 'started' | 'ended'
  let state: Wait = 'waiting'
  // the callback moves it: read it through this, past the compiler's narrowing
  const stateNow = (): Wait => state
  let begun!: () => void
  const started = new Promise<void>(resolve => (begun = resolve))
  const run = () => {
    // the wait already ended: the person's first prompt goes first
    if (state !== 'waiting') return
    // the command first, before any read or write; one attempt, no calibration;
    // `starting` lets the handler skip it when the first turn overtook it
    mem.starting = true
    let ran: Promise<void>
    try {
      ran = io.compact(MARKER)
    } catch (err) {
      mem.starting = false
      throw err
    }
    state = 'started'
    begun()
    void ran.finally(() => void (mem.starting = false)).then(
      () => appliedSince({ ...io, readQueue: () => io.readQueue(dir) }, id0),
      async err => {
        await clearMark(io, dir)
        io.status(modText(`start apply refused: ${errorText(err)}; deferred edits wait`))
      },
    ).catch(err => io.debug?.(modText(`start run failed: ${errorText(err)}`)))
  }
  let why = `no callback within ${START_WAIT_MS} ms`
  try {
    io.after(0, () => {
      try {
        run()
      } catch (err) {
        // a callback failing before the command: the wait ends at once
        if (state === 'waiting') state = 'ended'
        why = `the callback failed: ${errorText(err)}`
        begun()
      }
    })
  } catch (err) {
    state = 'ended'
    why = `the timer was refused: ${errorText(err)}`
  }
  if (stateNow() === 'waiting') {
    await Promise.race([started, io.sleep(START_WAIT_MS).catch(() => undefined)])
    // the bound reached first: the callback that comes later does nothing
    if (stateNow() === 'waiting') state = 'ended'
  }
  if (stateNow() === 'started') return 'started'
  await clearMark(io, dir)
  io.debug?.(modText(`start apply not started (${why}); deferred edits wait`))
  return 'timeout'
}
