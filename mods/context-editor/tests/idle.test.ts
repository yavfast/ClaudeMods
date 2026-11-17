import { expect, test } from 'claude-code/testing'
import { CACHE_TTL_MS } from '../hooks/cacheclock'
import { MARKER } from '../hooks/compaction'
import type { QueuedEdit } from '../hooks/edits'
import { afterTurn, type TurnEndIO } from '../hooks/flush'
import { armAtTurnEnd, armIdle, IDLE_SLACK_MS, idleDelay, idleRun, newIdleMemory, type IdleIO, type IdleMemory } from '../hooks/idle'
import { EMPTY_QUEUE, type Queue } from '../hooks/queue'
import { newTurns, turnCompleted, turnStarted } from '../hooks/turns'

const WHOLE = CACHE_TTL_MS + IDLE_SLACK_MS
const sum = (id: string, deferred?: string): QueuedEdit => ({ op: 'summarize', tool_use_id: id, summary: `s ${id}`, ...(deferred ? { deferred } : {}) })
const q0 = (edits: QueuedEdit[], extra: Partial<Queue> = {}): Queue => ({ ...EMPTY_QUEUE, ...extra, edits })

type Timer = { ms: number; fn: () => void; cancelled: boolean }

// A fake host: the queue in memory, the handler applying every queued edit
// when the idle mark holds, timers kept for the test to fire.
function fake(opts: { queue?: Queue; last?: number | null; now?: number } = {}) {
  const now = opts.now ?? 100 * WHOLE
  const state = {
    queue: opts.queue ?? q0([sum('c1', 'b1')], { deferredSince: { b1: 1 }, nextBatch: 2 }),
    last: opts.last === undefined ? now - WHOLE : opts.last,
    session: 's1',
    now,
  }
  const log = {
    status: [] as (string | undefined)[],
    debug: [] as string[],
    compact: [] as { args: string; queue: Queue; applying: boolean }[],
    timers: [] as Timer[],
    verdicts: 0,
    lines: [] as string[],
    submits: 0,
    dirs: [] as string[],
  }
  const turns = newTurns()
  const mem: IdleMemory = newIdleMemory()
  const io: IdleIO & { submit: (text: string) => Promise<void> } = {
    storage: async () => `/s/${state.session}`,
    readQueue: async dir => (log.dirs.push(dir), { state: 'ok', value: state.queue }),
    updateQueue: async (dir, change) => {
      log.dirs.push(dir)
      const next = change(state.queue)
      if (!next) return false
      state.queue = next
      return true
    },
    compact: async args => {
      log.compact.push({ args, queue: state.queue, applying: mem.applying })
      // the handler: the mark holds, every edit applies; a report is written
      const { applyDeferred: _a, coldSince: _c, deferredSince: _d, ...rest } = state.queue
      state.queue = { ...rest, edits: [], report: 'report', reportResume: false, reportId: (state.queue.reportId ?? 0) + 1 }
    },
    status: text => log.status.push(text),
    log: text => log.lines.push(text),
    appliedLine: id => `applied ${id}`,
    sessionId: async () => state.session,
    turns,
    now: () => state.now,
    lastRequestAt: () => state.last,
    coldVerdict: async dir => void (log.dirs.push(dir), (log.verdicts += 1)),
    after: (ms, fn) => {
      const t: Timer = { ms, fn, cancelled: false }
      log.timers.push(t)
      return { cancel: () => void (t.cancelled = true) }
    },
    debug: text => log.debug.push(text),
    // I7: IdleRun never sends a prompt; the port is here only to count
    submit: async () => void (log.submits += 1),
  }
  return { io, mem, state, log, turns }
}

const ticks = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// [SP_HELP_05_01] IdleRun — взведення; [SP_HELP_02_11]
test('IdleRun — взведення: a completed turn arms one timer of CACHE_TTL_MS + IDLE_SLACK_MS with the session and turn count; an interrupted turn arms none; a new timer replaces the one before', async () => {
  const { io, mem, log, turns } = fake()
  turnStarted(turns)
  turnCompleted(turns, false)
  expect(await armAtTurnEnd(io, mem, false)).toBe(true)
  expect(log.timers.map(t => t.ms)).toEqual([WHOLE])
  expect(mem).toMatchObject({ session: 's1', armedTurns: 1, armedBy: 'turn' })
  expect(log.debug.at(-1)).toContain('idle timer armed for 3660000 ms (turn, turn 1)')
  expect(await armAtTurnEnd(io, mem, true)).toBe(false)
  expect(log.timers).toHaveLength(1)
  turnStarted(turns)
  turnCompleted(turns, false)
  await armAtTurnEnd(io, mem, false)
  expect(log.timers).toHaveLength(2)
  expect(log.timers[0]!.cancelled).toBe(true)
  expect(mem.armedTurns).toBe(2)
  // a replaced timer that fires anyway does nothing
  log.timers[0]!.fn()
  await ticks()
  expect(log.debug.some(d => d.includes('idle timer fired'))).toBe(false)
  // the armed one runs IdleRun
  log.timers[1]!.fn()
  await ticks()
  expect(log.debug.at(-1)).toContain('idle timer fired: applied')
})

test('IdleRun — відмова таймера: a timer the host refuses arms nothing and leaves a debug line', () => {
  const { io, mem, log } = fake()
  io.after = () => {
    throw new Error('no timers here')
  }
  expect(armIdle(io, mem, 's1', 'turn', 5)).toBe(false)
  expect(mem.timer).toBeUndefined()
  expect(log.debug.at(-1)).toContain('idle timer refused: no timers here')
})

// [SP_HELP_05_01] IdleRun — гілки; [SP_HELP_05_02] I7
test('IdleRun — гілки: a turn since arming or another session does nothing; a warm cache re-arms for the rest; an unknown clock does nothing', async () => {
  // a turn started since the timer was armed
  const moved = fake()
  armIdle(moved.io, moved.mem, 's1', 'turn', WHOLE)
  turnStarted(moved.turns)
  expect(await idleRun(moved.io, moved.mem)).toBe('moved')
  turnCompleted(moved.turns, true)
  expect(await idleRun(moved.io, moved.mem)).toBe('moved')
  expect(moved.log.compact).toEqual([])
  // /clear or /resume switched the session
  const other = fake()
  armIdle(other.io, other.mem, 's1', 'turn', WHOLE)
  other.state.session = 's2'
  expect(await idleRun(other.io, other.mem)).toBe('moved')
  // warm: a request 30 min ago (a fork); the rest of its wait, same turn count and origin
  const warm = fake()
  warm.state.last = warm.state.now - 30 * 60_000
  armIdle(warm.io, warm.mem, 's1', 'start', WHOLE)
  expect(await idleRun(warm.io, warm.mem)).toBe('rearmed')
  expect(warm.log.timers.at(-1)!.ms).toBe(30 * 60_000 + IDLE_SLACK_MS)
  expect(warm.mem.armedBy).toBe('start')
  expect(warm.log.verdicts).toBe(0)
  expect(warm.log.compact).toEqual([])
  // unknown: no request seen, or the clock not at hand
  for (const last of [null, undefined]) {
    const u = fake()
    u.state.last = last as null
    armIdle(u.io, u.mem, 's1', 'turn', WHOLE)
    expect(await idleRun(u.io, u.mem)).toBe('unknown')
    expect(u.log.timers).toHaveLength(1)
    expect(u.log.verdicts).toBe(0)
  }
})

test('IdleRun — гілки: cold with a deferred batch takes the verdict, marks the queue with the last request and applies without any prompt (I7); the person gets the apply line', async () => {
  const { io, mem, log, state } = fake()
  armIdle(io, mem, 's1', 'turn', WHOLE)
  const last = state.last
  expect(await idleRun(io, mem)).toBe('applied')
  expect(log.verdicts).toBe(1)
  expect(log.compact).toHaveLength(1)
  expect(log.compact[0]!.args).toBe(MARKER)
  expect(log.compact[0]!.queue).toMatchObject({ applyDeferred: true, coldSince: last })
  // the handler sees the command as IdleRun's
  expect(log.compact[0]!.applying).toBe(true)
  expect(mem.applying).toBe(false)
  expect(log.lines).toEqual(['applied 1'])
  // I7: no resume prompt, no optimization prompt; the report waits in the queue
  expect(log.submits).toBe(0)
  expect(state.queue.report).toBe('report')
  // CONC-01: every step in the folder the run took once
  expect([...new Set(log.dirs)]).toEqual(['/s/s1'])
  // a mark on a queue with an edit applies too
  const marked = fake({ queue: q0([sum('c1')], { applyDeferred: true }) })
  armIdle(marked.io, marked.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(marked.io, marked.mem)).toBe('applied')
  // a mark left on an empty queue goes, and no command runs (plugin-hooks 89)
  const empty = fake({ queue: q0([], { applyDeferred: true, coldSince: 5 }) })
  armIdle(empty.io, empty.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(empty.io, empty.mem)).toBe('nothing')
  expect(empty.state.queue.applyDeferred).toBeUndefined()
  expect(empty.state.queue.coldSince).toBeUndefined()
  expect(empty.log.compact).toEqual([])
})

test('IdleRun — гілки: cold without deferred edits or with a handoff waiting only takes the verdict; passed over: the status line, no mark, no command', async () => {
  for (const queue of [q0([sum('c1')]), q0([sum('c1', 'b1')], { handoff: { mode: 'transcript', at: 1 } as unknown as Queue['handoff'] })]) {
    const f = fake({ queue })
    armIdle(f.io, f.mem, 's1', 'turn', WHOLE)
    expect(await idleRun(f.io, f.mem)).toBe('nothing')
    expect(f.log.verdicts).toBe(1)
    expect(f.log.compact).toEqual([])
  }
  const passed = fake()
  passed.io.compactPassed = async () => true
  armIdle(passed.io, passed.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(passed.io, passed.mem)).toBe('passed-over')
  expect(passed.log.status).toEqual(["context-editor: deferred edits wait: this host passes over the mod's compaction"])
  expect(passed.state.queue.applyDeferred).toBeUndefined()
  expect(passed.log.compact).toEqual([])
})

// [SP_HELP_05_04] «Переривання, потім простій»
test('IdleRun — відмова команди: after an interrupt the host refuses the command; the mark goes, the status line names the refusal, the batches wait', async () => {
  const { io, mem, log, state } = fake()
  io.compact = async () => {
    throw new Error('the session was stopped and nobody has sent input since')
  }
  armIdle(io, mem, 's1', 'turn', WHOLE)
  expect(await idleRun(io, mem)).toBe('refused')
  expect(log.status).toEqual(['context-editor: idle apply refused: the session was stopped and nobody has sent input since; deferred edits wait'])
  expect(state.queue.applyDeferred).toBeUndefined()
  expect(state.queue.coldSince).toBeUndefined()
  expect(state.queue.edits).toEqual([sum('c1', 'b1')])
  expect(mem.applying).toBe(false)
})

test('IdleRun — хід під час калібрування: a turn, another session or a planned Flush before the command clears the mark and runs no command; a mark not written runs none either', async () => {
  const f = fake()
  f.io.calibrate = async () => void turnStarted(f.turns)
  armIdle(f.io, f.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(f.io, f.mem)).toBe('moved')
  expect(f.state.queue.applyDeferred).toBeUndefined()
  expect(f.log.compact).toEqual([])
  // /clear during the calibration: no turn event, the session check catches it
  const cleared = fake()
  cleared.io.calibrate = async () => void (cleared.state.session = 's2')
  armIdle(cleared.io, cleared.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(cleared.io, cleared.mem)).toBe('moved')
  expect(cleared.log.compact).toEqual([])
  expect([...new Set(cleared.log.dirs)]).toEqual(['/s/s1'])
  // the person's /compact planned a Flush: its command serves the queue
  let planned = false
  const p = fake()
  p.io.flushPlanned = () => planned
  p.io.calibrate = async () => void (planned = true)
  armIdle(p.io, p.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(p.io, p.mem)).toBe('moved')
  expect(p.state.queue.applyDeferred).toBeUndefined()
  const before = fake()
  before.io.flushPlanned = () => true
  armIdle(before.io, before.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(before.io, before.mem)).toBe('flush-planned')
  expect(before.state.queue.applyDeferred).toBeUndefined()
  expect(before.log.compact).toEqual([])
  const g = fake()
  g.io.updateQueue = async () => Promise.reject(new Error('disk full'))
  armIdle(g.io, g.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(g.io, g.mem)).toBe('not-marked')
  expect(g.log.compact).toEqual([])
  expect(g.log.debug.some(d => d.includes('idle apply not marked: disk full'))).toBe(true)
})

test('IdleRun — пропуск обробника: a command that wrote no report is no apply: no person’s line', async () => {
  const f = fake()
  f.io.compact = async () => undefined
  armIdle(f.io, f.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(f.io, f.mem)).toBe('skipped')
  expect(f.log.lines).toEqual([])
})

test('IdleRun — збої портів: an unreadable queue or no storage does nothing; a failed verdict goes on with a debug line; a failed session read is another session; a refused re-arm is unknown; a failed run and a failed ClearMark leave debug lines', async () => {
  const unreadable = fake()
  unreadable.io.readQueue = async () => ({ state: 'unreadable', reason: 'bad json' })
  armIdle(unreadable.io, unreadable.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(unreadable.io, unreadable.mem)).toBe('nothing')
  const none = fake()
  none.io.storage = async () => undefined
  armIdle(none.io, none.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(none.io, none.mem)).toBe('nothing')
  expect(none.log.verdicts).toBe(0)
  const verdict = fake()
  verdict.io.coldVerdict = async () => Promise.reject(new Error('chain down'))
  armIdle(verdict.io, verdict.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(verdict.io, verdict.mem)).toBe('applied')
  expect(verdict.log.debug.some(d => d.includes('idle cold verdict not written: chain down'))).toBe(true)
  const sid = fake()
  armIdle(sid.io, sid.mem, 's1', 'turn', WHOLE)
  sid.io.sessionId = async () => Promise.reject(new Error('no session'))
  expect(await idleRun(sid.io, sid.mem)).toBe('moved')
  expect(sid.log.debug.some(d => d.includes('idle: the session id was not read: no session'))).toBe(true)
  // warm: the re-arm cancels the timer it replaces; refused, nothing is armed
  const warm = fake()
  warm.state.last = warm.state.now - 60_000
  armIdle(warm.io, warm.mem, 's1', 'turn', WHOLE)
  const first = warm.log.timers[0]!
  expect(await idleRun(warm.io, warm.mem)).toBe('rearmed')
  expect(first.cancelled).toBe(true)
  warm.io.after = () => {
    throw new Error('no timers')
  }
  expect(await idleRun(warm.io, warm.mem)).toBe('unknown')
  // a run that throws: the timer's wrapper logs it
  const thrown = fake()
  thrown.io.readQueue = async () => Promise.reject(new Error('io error'))
  armIdle(thrown.io, thrown.mem, 's1', 'turn', WHOLE)
  thrown.log.timers[0]!.fn()
  await ticks()
  expect(thrown.log.debug.some(d => d.includes('idle run failed: io error'))).toBe(true)
  // a refused command whose ClearMark fails too
  const both = fake()
  both.io.compact = async () => Promise.reject(new Error('stopped'))
  const update = both.io.updateQueue
  let calls = 0
  both.io.updateQueue = async (dir, change) => (calls++ === 0 ? update(dir, change) : Promise.reject(new Error('disk full')))
  armIdle(both.io, both.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(both.io, both.mem)).toBe('refused')
  expect(both.log.debug.some(d => d.includes('idle mark not cleared: disk full'))).toBe(true)
})

test('IdleRun — взведення під час нового ходу: a turn that started before the arming arms nothing (it arms its own at its end)', async () => {
  const { io, mem, log, turns } = fake()
  turnStarted(turns)
  expect(await armAtTurnEnd(io, mem, false)).toBe(false)
  expect(log.timers).toEqual([])
})

test('IdleDelay: the rest of CACHE_TTL_MS + IDLE_SLACK_MS after the last request, never below 0; unknown: the whole', () => {
  expect(idleDelay(null, 5)).toBe(WHOLE)
  expect(idleDelay(undefined, 5)).toBe(WHOLE)
  expect(idleDelay(1000, 1000 + 60_000)).toBe(WHOLE - 60_000)
  expect(idleDelay(0, 2 * WHOLE)).toBe(0)
})

// [SP_HELP_02_11] AfterTurn: the idle timer after Flush, with the abort
test('AfterTurn — таймер простою: armed after Flush was planned, with the turn’s abort', async () => {
  for (const aborted of [false, true]) {
    const calls: string[] = []
    const io: TurnEndIO = {
      storage: async () => '/s',
      detect: async () => undefined,
      countTurn: async () => void calls.push('count'),
      flush: async a => void calls.push(`flush ${a}`),
      idle: async a => void calls.push(`idle ${a}`),
      handoff: async () => undefined,
    }
    await afterTurn(io, { aborted, answer: '' })
    expect(calls).toEqual(aborted ? ['flush true', 'idle true'] : ['count', 'flush false', 'idle false'])
  }
})
