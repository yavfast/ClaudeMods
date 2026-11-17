import { expect, test } from 'claude-code/testing'
import { CACHE_TTL_MS } from '../hooks/cacheclock'
import { MARKER } from '../hooks/compaction'
import type { QueuedEdit } from '../hooks/edits'
import { afterTurn, type TurnEndIO } from '../hooks/flush'
import { armAtTurnEnd, armIdle, IDLE_SLACK_MS, idleDelay, idleRun, newIdleMemory, START_WAIT_MS, startRun, type IdleIO, type IdleMemory, type StartIO } from '../hooks/idle'
import { applicable } from '../hooks/batches'
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

// A fake session start: IdleRun's fake host, the cached verdict, the
// registry's clock, and a bounded wait the test settles. StartIO has no
// prompt port, so I7 holds by its shape; `submits` stays 0 as a guard only.
function startFake(opts: { queue?: Queue; last?: number | null; now?: number; verdict?: 'reached' | 'passed' | 'unknown'; clock?: 'unreadable' } = {}) {
  const f = fake(opts)
  const waits: { ms: number; done: () => void }[] = []
  const calls = { calibrate: 0 }
  const io: StartIO & { submit: (text: string) => Promise<void> } = {
    ...f.io,
    calibrate: async () => void (calls.calibrate += 1),
    compactVerdict: () => opts.verdict ?? 'reached',
    clockAt: async () => (opts.clock === 'unreadable' ? { reason: 'bad json' } : { last: f.state.last }),
    sleep: ms => new Promise<void>(done => waits.push({ ms, done })),
  }
  return { ...f, io, waits, calls }
}

// [SP_HELP_05_01] StartRun — гілки; [SP_HELP_05_04] «Перша сесія на новій версії хоста»; [SP_HELP_02_12]
test('StartRun — гілки: unknown or passed verdict, no deferred edit, a handoff waiting, an unreadable registry or an unknown clock do nothing; warm arms the idle timer for the rest (armedBy start)', async () => {
  for (const verdict of ['unknown', 'passed'] as const) {
    const { io, mem, log, state } = startFake({ verdict })
    const q = state.queue
    expect(await startRun(io, mem)).toBe('not-reached')
    expect(state.queue).toBe(q)
    expect(log.timers).toHaveLength(0)
    expect(log.compact).toHaveLength(0)
  }
  // [ERR-01] `nothing` names its cause in the debug line
  const nothing = async (f: ReturnType<typeof startFake>, why: string) => {
    expect(await startRun(f.io, f.mem)).toBe('nothing')
    expect(f.log.timers).toHaveLength(0)
    expect(f.log.debug.at(-1)).toBe(`context-editor: start run: nothing (${why})`)
  }
  await nothing(startFake({ queue: q0([sum('c1')]) }), 'no deferred edit')
  await nothing(startFake({ queue: q0([sum('c1', 'b1')], { handoff: { mode: 'transcript' } } as Partial<Queue>) }), 'a handoff waits')
  await nothing(startFake({ clock: 'unreadable' }), 'registry unreadable: bad json')
  {
    const f = startFake()
    f.io.readQueue = async () => ({ state: 'unreadable', reason: 'truncated' })
    await nothing(f, 'queue unreadable: truncated')
  }
  {
    const f = startFake()
    f.io.storage = async () => undefined
    await nothing(f, 'no storage')
  }
  {
    const { io, mem, log } = startFake({ last: null })
    expect(await startRun(io, mem)).toBe('unknown')
    expect(log.timers).toHaveLength(0)
    expect(log.debug.at(-1)).toContain('start run: unknown')
  }
  {
    const now = 100 * WHOLE
    const { io, mem, log, state } = startFake({ now, last: now - 30 * 60_000 })
    const q = state.queue
    expect(await startRun(io, mem)).toBe('armed')
    expect(log.timers.map(t => t.ms)).toEqual([WHOLE - 30 * 60_000])
    expect(mem).toMatchObject({ session: 's1', armedTurns: 0, armedBy: 'start' })
    expect(state.queue).toBe(q)
    expect(log.compact).toHaveLength(0)
  }
  {
    // a timer the host refuses on a warm cache arms nothing
    const now = 100 * WHOLE
    const { io, mem, log } = startFake({ now, last: now - 30 * 60_000 })
    io.after = () => {
      throw new Error('refused')
    }
    expect(await startRun(io, mem)).toBe('not-armed')
    expect(log.debug.some(d => d.includes('idle timer refused: refused'))).toBe(true)
  }
})

test('StartRun — гілки: a mark not written plans no timer and runs no command (a write that throws: a debug line; a queue that lost its deferred edits meanwhile: no write); a host that runs the callback at once starts the command with no wait', async () => {
  {
    const { io, mem, log } = startFake()
    io.updateQueue = async () => {
      throw new Error('disk full')
    }
    expect(await startRun(io, mem)).toBe('not-marked')
    expect(log.debug.some(d => d.includes('start apply not marked: disk full'))).toBe(true)
    expect(log.timers).toHaveLength(0)
  }
  {
    const { io, mem, log, state } = startFake()
    const update = io.updateQueue
    io.updateQueue = (dir, change) => ((state.queue = q0([sum('c1')])), update(dir, change))
    expect(await startRun(io, mem)).toBe('not-marked')
    expect(state.queue.applyDeferred).toBeUndefined()
    expect(log.timers).toHaveLength(0)
  }
  {
    const { io, mem, log, waits } = startFake()
    const after = io.after
    io.after = (ms, fn) => {
      const t = after(ms, fn)
      fn()
      return t
    }
    expect(await startRun(io, mem)).toBe('started')
    expect(waits).toHaveLength(0)
    expect(log.compact.map(c => c.args)).toEqual([MARKER])
  }
})

test('StartRun — гілки: cold marks the queue with the last request before the timer, runs the command from after(0) without calibration and returns once the command was called, not when it ends; the person gets the line; no prompt (I7, I13)', async () => {
  const { io, mem, log, state, calls, waits } = startFake()
  const last = state.last as number
  let finish!: () => void
  const compact = io.compact
  io.compact = args => {
    // the mark is on the queue when the command starts
    expect(state.queue).toMatchObject({ applyDeferred: true, coldSince: last })
    return new Promise<void>(done => (finish = done)).then(() => compact(args))
  }
  const run = startRun(io, mem)
  await ticks()
  expect(log.timers.map(t => t.ms)).toEqual([0])
  expect(waits.map(w => w.ms)).toEqual([START_WAIT_MS])
  log.timers[0]!.fn()
  expect(await run).toBe('started')
  expect(log.lines).toEqual([])
  // the handler can tell StartRun's command while it runs
  expect(mem.starting).toBe(true)
  finish()
  await ticks()
  expect(mem.starting).toBe(false)
  expect(log.compact.map(c => c.args)).toEqual([MARKER])
  expect(log.compact[0]!.applying).toBe(false)
  expect(calls.calibrate).toBe(0)
  expect(log.lines).toEqual(['applied 1'])
  expect(log.submits).toBe(0)
  // the report waits for the first prompt (DeliverReport)
  expect(state.queue.report).toBe('report')
  expect(log.debug).toContain('context-editor: start run: started')
})

test('StartRun — гілки: a refused command clears the mark; the status line names the refusal; the batches wait', async () => {
  const { io, mem, log, state } = startFake()
  io.compact = async () => {
    throw new Error('Not available while interrupted')
  }
  const run = startRun(io, mem)
  await ticks()
  log.timers[0]!.fn()
  expect(await run).toBe('started')
  await ticks()
  expect(state.queue.applyDeferred).toBeUndefined()
  expect(state.queue.coldSince).toBeUndefined()
  expect(state.queue.edits).toHaveLength(1)
  expect(log.status.at(-1)).toBe('context-editor: start apply refused: Not available while interrupted; deferred edits wait')
  expect(mem.starting).toBe(false)
})

// [SP_HELP_05_01] StartRun — без продовження
test('StartRun — без продовження: cold with a deferred batch, an edit without deferred and an optimize request: the mark makes every edit applicable; no resume or optimization prompt; the report stays for the first prompt', async () => {
  const queue = q0([sum('c1', 'b1'), sum('c2')], { deferredSince: { b1: 1 }, nextBatch: 2, optimize: true, compact: true })
  const { io, mem, log, state } = startFake({ queue })
  let marked: Queue | undefined
  const compact = io.compact
  io.compact = args => ((marked = state.queue), compact(args))
  const run = startRun(io, mem)
  await ticks()
  log.timers[0]!.fn()
  expect(await run).toBe('started')
  await ticks()
  expect(applicable(marked!, state.last).map(e => (e as { tool_use_id: string }).tool_use_id)).toEqual(['c1', 'c2'])
  expect(log.submits).toBe(0)
  expect(state.queue.report).toBe('report')
  // [SP_HELP_05_04] «Промпт випередив команду»: a newer last request than the mark's leaves only the edits without deferred
  expect(applicable(marked!, (state.last as number) + 1).map(e => (e as { tool_use_id: string }).tool_use_id)).toEqual(['c2'])
})

// [SP_HELP_05_01] StartRun — межа очікування
test('StartRun — межа очікування: no callback within START_WAIT_MS ends the wait, clears the mark and leaves a debug line; the callback that comes later runs no command; a callback failing before the command or a refused timer ends it at once', async () => {
  {
    const { io, mem, log, state, waits } = startFake()
    const run = startRun(io, mem)
    await ticks()
    waits[0]!.done()
    expect(await run).toBe('timeout')
    expect(state.queue.applyDeferred).toBeUndefined()
    expect(state.queue.coldSince).toBeUndefined()
    expect(log.debug.some(d => d.includes(`start apply not started (no callback within ${START_WAIT_MS} ms); deferred edits wait`))).toBe(true)
    log.timers[0]!.fn()
    await ticks()
    expect(log.compact).toHaveLength(0)
  }
  {
    const { io, mem, log, state, waits } = startFake()
    io.compact = () => {
      throw new Error('boom')
    }
    const run = startRun(io, mem)
    await ticks()
    log.timers[0]!.fn()
    expect(await run).toBe('timeout')
    expect(waits).toHaveLength(1)
    expect(state.queue.applyDeferred).toBeUndefined()
    expect(log.debug.some(d => d.includes('start apply not started (the callback failed: boom)'))).toBe(true)
  }
  {
    const { io, mem, log, state, waits } = startFake()
    io.after = () => {
      throw new Error('refused')
    }
    expect(await startRun(io, mem)).toBe('timeout')
    expect(waits).toHaveLength(0)
    expect(state.queue.applyDeferred).toBeUndefined()
    expect(log.debug.some(d => d.includes('start apply not started (the timer was refused: refused)'))).toBe(true)
  }
})

// [SP_HELP_05_01] IdleRun — таймер StartRun (WakeCheck — phase 8)
test('IdleRun — таймер StartRun: armed warm at the start, it fires on a cold cache with no turn since and applies the batch', async () => {
  const now = 100 * WHOLE
  const { io, mem, log, state } = startFake({ now, last: now - 30 * 60_000 })
  expect(await startRun(io, mem)).toBe('armed')
  state.now = now + 31 * 60_000 + IDLE_SLACK_MS
  log.timers[0]!.fn()
  await ticks()
  expect(log.compact.map(c => c.args)).toEqual([MARKER])
  expect(log.compact[0]!.applying).toBe(true)
  expect(log.lines).toEqual(['applied 1'])
  expect(log.submits).toBe(0)
})

// [SP_HELP_02_07] [SP_HELP_02_11] An `apply` errand's mark (applyDeferred, no coldSince) outlives IdleRun's own
test('IdleRun — позначка доручення: kept as it is (no coldSince added); refused or moved, it stays for the next apply', async () => {
  const marked = () => q0([sum('c1', 'b1')], { deferredSince: { b1: 1 }, nextBatch: 2, applyDeferred: true })
  const ok = fake({ queue: marked() })
  armIdle(ok.io, ok.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(ok.io, ok.mem)).toBe('applied')
  expect(ok.log.compact[0]!.queue.applyDeferred).toBe(true)
  expect(ok.log.compact[0]!.queue.coldSince).toBeUndefined()
  const refused = fake({ queue: marked() })
  refused.io.compact = async () => {
    throw new Error('interrupted')
  }
  armIdle(refused.io, refused.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(refused.io, refused.mem)).toBe('refused')
  expect([refused.state.queue.applyDeferred, refused.state.queue.coldSince]).toEqual([true, undefined])
  const moved = fake({ queue: marked() })
  armIdle(moved.io, moved.mem, 's1', 'turn', WHOLE)
  moved.io.calibrate = async () => void turnStarted(moved.turns)
  expect(await idleRun(moved.io, moved.mem)).toBe('moved')
  expect([moved.state.queue.applyDeferred, moved.state.queue.coldSince]).toEqual([true, undefined])
  // IdleRun's own mark still goes when refused
  const own = fake()
  own.io.compact = async () => {
    throw new Error('interrupted')
  }
  armIdle(own.io, own.mem, 's1', 'turn', WHOLE)
  await idleRun(own.io, own.mem)
  expect(own.state.queue.applyDeferred).toBeUndefined()
})

// [SP_HELP_02_08] I5: WakeCheck ends a run whose timer a turn armed; a StartRun timer's run calls none
test('IdleRun — пробудження: a turn\'s timer ends its run with WakeCheck at the armed count, after the apply; a StartRun timer\'s run calls none', async () => {
  const turnTimer = fake()
  const order: string[] = []
  const compact = turnTimer.io.compact
  turnTimer.io.compact = async args => (order.push('compact'), compact(args))
  turnTimer.io.wake = async t => void order.push(`wake ${t}`)
  turnStarted(turnTimer.turns)
  turnCompleted(turnTimer.turns, false)
  armIdle(turnTimer.io, turnTimer.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(turnTimer.io, turnTimer.mem)).toBe('applied')
  expect(order).toEqual(['compact', 'wake 1'])
  // nothing to apply: WakeCheck still runs (a cold errand with wake may have fired)
  const empty = fake({ queue: q0([]) })
  const woke: number[] = []
  empty.io.wake = async t => void woke.push(t)
  armIdle(empty.io, empty.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(empty.io, empty.mem)).toBe('nothing')
  expect(woke).toEqual([0])
  const now = 100 * WHOLE
  const start = startFake({ now, last: now - 30 * 60_000 })
  const calls: number[] = []
  start.io.wake = async t => void calls.push(t)
  expect(await startRun(start.io, start.mem)).toBe('armed')
  start.state.now = now + 31 * 60_000 + IDLE_SLACK_MS
  start.log.timers[0]!.fn()
  await ticks()
  expect(start.log.compact.map(c => c.args)).toEqual([MARKER])
  expect(calls).toEqual([])
})

test('IdleRun — пробудження: a run that left (a turn since, another session), found no clock or re-armed on a warm cache calls no WakeCheck', async () => {
  const calls: string[] = []
  const moved = fake()
  moved.io.wake = async () => void calls.push('moved')
  armIdle(moved.io, moved.mem, 's1', 'turn', WHOLE)
  moved.state.session = 's2'
  expect(await idleRun(moved.io, moved.mem)).toBe('moved')
  const unknown = fake({ last: null })
  unknown.io.lastRequestAt = () => undefined
  unknown.io.wake = async () => void calls.push('unknown')
  armIdle(unknown.io, unknown.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(unknown.io, unknown.mem)).toBe('unknown')
  const warm = fake()
  warm.state.last = warm.state.now - 1000
  warm.io.wake = async () => void calls.push('warm')
  armIdle(warm.io, warm.mem, 's1', 'turn', WHOLE)
  expect(await idleRun(warm.io, warm.mem)).toBe('rearmed')
  expect(calls).toEqual([])
})
