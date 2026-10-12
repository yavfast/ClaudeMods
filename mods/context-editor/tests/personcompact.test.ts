import { expect, test } from 'claude-code/testing'
import { flush, FLUSH_DELAY_MS, FLUSH_STALE_MS, flushAfterTurn, isPlanned, newFlushState, requestFlush, type FlushIO, type FlushState } from '../hooks/flush'
import { COMPACT_BUSY, COMPACT_HANDOFF, COMPACT_REFUSED, COMPACT_REPLY, compactFailure, compactRoute, personCompact, requestCompact, type PersonCompactIO } from '../hooks/personcompact'
import { COMMAND_NOTE, COMPACT_ADVICE, deliverReport, EMPTY_QUEUE, MARKER, noteOnce, parseQueue, settledQueue, withCommandNote, withoutReport, type HandoffRequest, type Queue } from '../hooks/queue'
import { modText, PREFIX } from '../hooks/rows'
import { COMPACT_NOTHING, compactTurnText, detectOptimize, OPTIMIZE_MARK, STAGE_ADVICE, type DetectIO } from '../hooks/stages'
import type { Read } from '../hooks/store'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'
import { newTurns, turnCompleted, turnStarted } from '../hooks/turns'
import { missingRead, okRead, unreadableRead } from './row-fixtures'

const HANDOFF: HandoffRequest = { mode: 'transcript', resume: true, resumePrompt: 'go', by: 'agent', state: 'queued', at: 0 }
const EDITS = [{ op: 'drop' as const, tool_use_id: 'a' }]
const ok = (q: Partial<Queue>): Read<Queue> => okRead({ ...EMPTY_QUEUE, ...q })
const person = (args: string, kind = 'composer') => ({ args, origin: { kind } })

type Log = {
  queue: Read<Queue>
  tags: Read<TagRegistry>
  compacts: string[]
  submits: string[]
  removed: string[]
  statuses: (string | undefined)[]
  toasts: string[]
  timers: { ms: number; fn: () => void }[]
  now: number
  session: string
}

// One fake host for the hook, Flush and DetectOptimize: one queue, timers held until run.
function harness(queue: Read<Queue>, onCompact?: (log: Log) => void, tags: Read<TagRegistry> = missingRead({ ...EMPTY_REGISTRY })) {
  const log: Log = { queue, tags, compacts: [], submits: [], removed: [], statuses: [], toasts: [], timers: [], now: 1000, session: 's1' }
  const turns = newTurns()
  const state: FlushState = newFlushState()
  const update = async (change: (q: Queue) => Queue | undefined) => {
    if (log.queue.state === 'unreadable') return false
    const next = change(log.queue.value)
    if (!next) return false
    log.queue = okRead(next)
    return true
  }
  const fio: FlushIO = {
    readQueue: async () => log.queue,
    updateQueue: update,
    readTags: async () => log.tags,
    compact: async args => {
      log.compacts.push(args)
      onCompact?.(log)
    },
    after: (ms, fn) => void log.timers.push({ ms, fn }),
    submit: async text => void log.submits.push(text),
    removeDelivered: async delivered => {
      log.removed.push(delivered)
      if (log.queue.state === 'ok') log.queue = okRead(withoutReport(log.queue.value, delivered))
    },
    status: text => void log.statuses.push(text),
    toast: text => void log.toasts.push(text),
    now: () => log.now,
    sessionId: async () => log.session,
    turns,
  }
  let aborted = false
  const pio: PersonCompactIO = {
    storage: async () => (log.queue.state === 'unreadable' && log.queue.reason === 'no storage' ? undefined : { dir: '/s', session: log.session }),
    updateQueueAt: () => update,
    aborted: () => aborted,
    planFlush: session => void requestFlush(fio, state, session),
    toast: text => void log.toasts.push(text),
    now: () => log.now,
  }
  const run = (e = person('')) => personCompact(pio, e, () => isPlanned(state, log.now))
  const abort = (v: boolean) => void (aborted = v)
  return { fio, pio, log, turns, state, run, abort }
}

const queued = (log: Log): Queue => {
  if (log.queue.state === 'unreadable') throw new Error('unreadable')
  return log.queue.value
}

// Runs the held timers (Flush) and lets them finish.
async function fire(log: Log) {
  const timers = log.timers.splice(0)
  for (const t of timers) t.fn()
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function detectIO(log: Log): DetectIO {
  return {
    ready: async () => true,
    readQueue: async () => log.queue,
    changeQueue: async change => {
      const next = await change(log.queue)
      if (!next) return false
      log.queue = okRead(next)
      return true
    },
    changeTags: async () => false,
    rows: async () => [],
    replace: async () => undefined,
    status: text => void log.statuses.push(text),
    toast: text => void log.toasts.push(text),
    now: () => log.now,
  }
}

// ---- [SP_CTX_02_42] the route and the hook's failure

test('PersonCompact — маршрут: a plugin passes; the person with empty args goes to the agent; "host" any case to the host; other args pass', () => {
  for (const args of ['', '  ', 'host', 'keep notes']) expect(compactRoute({ args, origin: { kind: 'plugin' } })).toBe('pass')
  for (const kind of ['composer', 'sdk', 'unclassified', 'bridge', 'scheduled-trigger']) {
    expect(compactRoute(person('', kind))).toBe('agent')
    expect(compactRoute(person(' \n ', kind))).toBe('agent')
  }
  expect(compactRoute(person('host'))).toBe('host')
  expect(compactRoute(person('  HoSt '))).toBe('host')
  expect(compactRoute(person('hosts'))).toBe('pass')
  expect(compactRoute(person('host keep notes'))).toBe('pass')
  expect(compactRoute(person('keep the API notes'))).toBe('pass')
})

test('CompactFailure — збій хука: after next, on re-entry or for a plugin the command goes on; else the person gets the reason, no host summary', () => {
  for (const kind of ['throw', 'timeout', 're-entry'])
    for (const origin of ['composer', 'sdk', 'unclassified', 'plugin']) {
      expect(compactFailure({ origin: { kind: origin } }, { called: true, kind })).toEqual({ next: true })
      const out = compactFailure({ origin: { kind: origin } }, { called: false, kind })
      if (kind === 're-entry' || origin === 'plugin') expect(out).toEqual({ next: true })
      else expect(out).toEqual({ text: `compact failed: ${kind}; /compact host runs the host's summary` })
    }
})

test('PersonCompact — передача хосту: a plugin run and own instructions pass unchanged with no read; /compact host passes with empty args', async () => {
  const h = harness(ok({}))
  h.pio.storage = async () => {
    throw new Error('read')
  }
  expect(await h.run({ args: MARKER, origin: { kind: 'plugin' } })).toEqual({ next: MARKER })
  expect(await h.run(person('keep the API notes'))).toEqual({ next: 'keep the API notes' })
  expect(await h.run(person(' Host '))).toEqual({ next: '' })
  expect(h.log.timers).toEqual([])
})

// ---- [SP_CTX_02_42] the request

test('PersonCompact — запит: optimize with compact in the queue (a mark request becomes it), one Flush planned for the session, the reply', async () => {
  const h = harness(ok({ optimize: true }))
  expect(await h.run()).toEqual({ text: COMPACT_REPLY })
  expect([queued(h.log).optimize, queued(h.log).compact, queued(h.log).optimizePrompted]).toEqual([true, true, false])
  expect(h.log.timers.map(t => t.ms)).toEqual([FLUSH_DELAY_MS])
  expect(h.state.compactSession).toBe('s1')
  expect(h.log.submits).toEqual([])
  expect(COMPACT_REPLY.startsWith(PREFIX)).toBe(false)
  expect(COMPACT_REPLY).toContain('/compact host')
})

test('PersonCompact — зайнято: a compression turn running, or requested with Flush planned: BUSY; a request whose Flush was lost is planned anew', async () => {
  const running = harness(ok({ optimizePrompted: true, compact: true }))
  expect(await running.run()).toEqual({ text: COMPACT_BUSY })
  expect(running.log.timers).toEqual([])
  const planned = harness(ok({}))
  await planned.run()
  expect(await planned.run()).toEqual({ text: COMPACT_BUSY })
  expect(planned.log.timers.length).toBe(1)
  // the timer never fired: past FLUSH_STALE_MS the request is planned again
  planned.log.now += FLUSH_STALE_MS + 1
  expect(await planned.run()).toEqual({ text: COMPACT_REPLY })
  expect(planned.log.timers.length).toBe(2)
  expect(requestCompact({ ...EMPTY_QUEUE, optimize: true, compact: true }, false, 0).verdict).toBe('written')
})

test('PersonCompact — без сховища: no storage, a storage read that throws, an unreadable queue: the host runs its /compact; nothing planned', async () => {
  const none = harness(unreadableRead<Queue>('no storage'))
  expect(await none.run()).toEqual({ next: '' })
  const bad = harness(unreadableRead<Queue>('bad json'))
  expect(await bad.run()).toEqual({ next: '' })
  const thrown = harness(ok({}))
  thrown.pio.storage = async () => {
    throw new Error('x')
  }
  expect(await thrown.run()).toEqual({ next: '' })
  for (const h of [none, bad, thrown]) {
    expect(h.log.timers).toEqual([])
    expect(h.state.scheduled).toBe(false)
  }
})

test('PersonCompact — передача чекає: a pending handoff answers COMPACT_HANDOFF; nothing written, nothing planned', async () => {
  const h = harness(ok({ handoff: HANDOFF }))
  expect(await h.run()).toEqual({ text: COMPACT_HANDOFF })
  expect(queued(h.log).compact).toBe(false)
  expect(h.log.timers).toEqual([])
})

test('PersonCompact — таймер відхилено: the host refuses the timer: the request undone, a toast, COMPACT_REFUSED; nothing sticks, the next /compact plans', async () => {
  const h = harness(ok({}))
  h.fio.after = () => {
    throw new Error('refused')
  }
  expect(await h.run()).toEqual({ text: COMPACT_REFUSED })
  expect([queued(h.log).optimize, queued(h.log).compact]).toEqual([false, false])
  expect(h.state.scheduled).toBe(false)
  expect(h.state.compactSession).toBeUndefined()
  expect(h.log.toasts).toEqual([modText('/compact: refused')])
  h.fio.after = (ms, fn) => void h.log.timers.push({ ms, fn })
  expect(await h.run()).toEqual({ text: COMPACT_REPLY })
  expect(h.log.timers.length).toBe(1)
})

test('PersonCompact — покинуто: an abandoned hook writes nothing; abandoned after the write, the request is undone and nothing planned', async () => {
  const before = harness(ok({}))
  before.abort(true)
  expect(await before.run()).toEqual({ text: COMPACT_REFUSED })
  expect(queued(before.log)).toEqual({ ...EMPTY_QUEUE })
  const after = harness(ok({ optimize: true }))
  const update = after.pio.updateQueueAt('/s')
  let writes = 0
  after.pio.updateQueueAt = () => async change => {
    const out = await update(change)
    if (++writes === 1) after.abort(true)
    return out
  }
  expect(await after.run()).toEqual({ text: COMPACT_REFUSED })
  expect([queued(after.log).optimize, queued(after.log).compact]).toEqual([true, false])
  expect(after.log.timers).toEqual([])
})

// ---- [SP_CTX_02_42] the compression turn through Flush

test('Flush — /compact без блоку: no closed block, nothing queued: the one prompt is CompactTurnText with the notes; the loop guard up', async () => {
  const notes = [{ id: 'n1', text: 'x', createdTurn: 1, target: { tool_use_id: 'a' } }] as unknown as TagRegistry['notes']
  const h = harness(ok({}), undefined, okRead({ ...EMPTY_REGISTRY, notes }))
  await h.run()
  await fire(h.log)
  expect(h.log.compacts).toEqual([])
  expect(h.log.submits).toEqual([compactTurnText(1)])
  expect([queued(h.log).optimize, queued(h.log).optimizePrompted, queued(h.log).compact]).toEqual([false, true, true])
})

test('PersonCompact — Flush уже заплановано: /compact after a turn that queued edits: one timer, the batch applies first, then exactly one prompt (report + CompactTurnText), no resume prompt', async () => {
  const applied = (log: Log) =>
    void (log.queue = ok({ ...queued(log), edits: [], report: withCommandNote('context-editor: applied 1 edit(s)'), reportId: 7, reportResume: true, reportPrompt: 'go on' }))
  const h = harness(ok({ edits: EDITS, resume: true }), applied)
  // the turn ended: Flush planned from turn.complete
  expect(await flushAfterTurn(h.fio, h.state, false)).toBe(true)
  expect(await h.run()).toEqual({ text: COMPACT_REPLY })
  expect(h.log.timers.length).toBe(1)
  await fire(h.log)
  expect(h.log.compacts).toEqual([MARKER])
  expect(h.log.submits).toEqual([`context-editor: applied 1 edit(s) ${COMMAND_NOTE}\n\n${compactTurnText(0)}`])
  expect(queued(h.log).report).toBeUndefined()
  expect(h.state.scheduled).toBe(false)
})

test('PersonCompact — друга /compact під час ходу стискання: BUSY; the turn ends with nothing queued: one toast, compact cleared; busy just after the end, a new request later', async () => {
  const h = harness(ok({}))
  await h.run()
  await fire(h.log)
  turnStarted(h.turns)
  expect(await h.run()).toEqual({ text: COMPACT_BUSY })
  expect(h.log.timers).toEqual([])
  turnCompleted(h.turns, false)
  expect(await detectOptimize(detectIO(h.log), { aborted: false, answer: `done\n${OPTIMIZE_MARK}` })).toBe('in-optimization')
  expect(h.log.toasts).toEqual([COMPACT_NOTHING])
  expect([queued(h.log).optimizePrompted, queued(h.log).compact]).toEqual([false, false])
  // a /compact held until that end is still busy; later, a new request
  expect(await h.run()).toEqual({ text: COMPACT_BUSY })
  h.log.now += FLUSH_STALE_MS + 1
  expect(await h.run()).toEqual({ text: COMPACT_REPLY })
})

test('PersonCompact — /compact після кінця ходу стискання: the host held it until the turn ended; the Flush of that end is pending: BUSY; the Flush applies, clears compactEndedAt and sends no second compression prompt', async () => {
  const applied = (log: Log) => void (log.queue = ok({ ...queued(log), edits: [], report: withCommandNote('context-editor: applied 1 edit(s)'), reportId: 8, reportResume: false }))
  const h = harness(ok({}), applied)
  await h.run()
  await fire(h.log)
  expect(h.log.submits.length).toBe(1)
  // the compression turn queues an edit and ends: DetectOptimize, then Flush planned from turn.complete
  turnStarted(h.turns)
  h.log.queue = ok({ ...queued(h.log), edits: EDITS })
  turnCompleted(h.turns, false)
  await detectOptimize(detectIO(h.log), { aborted: false, answer: 'done' })
  expect([queued(h.log).compact, queued(h.log).compactEndedAt]).toEqual([false, h.log.now])
  // the /compact typed during the turn may run before the end plans its Flush (scenario 8: 63 ms after turn.complete)
  expect(await h.run()).toEqual({ text: COMPACT_BUSY })
  expect(await flushAfterTurn(h.fio, h.state, false)).toBe(true)
  // or after it
  h.log.now += FLUSH_STALE_MS
  expect(await h.run()).toEqual({ text: COMPACT_BUSY })
  await fire(h.log)
  expect(h.log.compacts).toEqual([MARKER])
  expect(h.log.submits.length).toBe(1)
  expect(queued(h.log).compactEndedAt).toBeUndefined()
  // no Flush planned any more: the next /compact is a new request
  expect(await h.run()).toEqual({ text: COMPACT_REPLY })
})

test('PersonCompact — кінець ходу стискання без Flush: the turn queued nothing, no Flush: BUSY within FLUSH_STALE_MS of its end, then a new request that clears the mark', async () => {
  const h = harness(ok({ optimizePrompted: true, compact: true }))
  await detectOptimize(detectIO(h.log), { aborted: false, answer: 'done' })
  expect(queued(h.log).compactEndedAt).toBe(h.log.now)
  expect(await h.run()).toEqual({ text: COMPACT_BUSY })
  h.log.now += FLUSH_STALE_MS + 1
  expect(await h.run()).toEqual({ text: COMPACT_REPLY })
  expect(queued(h.log).compactEndedAt).toBeUndefined()
  // an aborted compression turn leaves no mark
  const aborted = harness(ok({ optimizePrompted: true, compact: true }))
  await detectOptimize(detectIO(aborted.log), { aborted: true, answer: '' })
  expect(queued(aborted.log).compactEndedAt).toBeUndefined()
})

test('requestFlush — Flush уже йде: compactSession is set only for a timer not fired yet, and cleared when Flush ends; a later Flush in another session is not skipped', async () => {
  const h = harness(ok({ edits: EDITS }), log => void (log.queue = ok({ report: 'context-editor: applied', reportId: 4, reportResume: false })))
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const compact = h.fio.compact
  h.fio.compact = async args => (await gate, compact(args))
  expect(await flushAfterTurn(h.fio, h.state, false)).toBe(true)
  h.log.timers.splice(0)[0]!.fn()
  await Promise.resolve()
  // Flush runs (its timer fired): a /compact now leaves no session check behind
  expect(requestFlush(h.fio, h.state, 's1')).toBe(true)
  expect(h.state.compactSession).toBeUndefined()
  release()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(h.state.scheduled).toBe(false)
  expect(h.state.compactSession).toBeUndefined()
  // /clear: a new session's Flush goes on
  h.log.session = 's2'
  h.log.queue = ok({ edits: EDITS })
  const out = await flush(h.fio, h.state, h.turns.turns)
  expect(out.outcome).not.toBe('session-changed')
  // a timer not fired yet takes the session
  h.log.queue = ok({ edits: EDITS })
  expect(await flushAfterTurn(h.fio, h.state, false)).toBe(true)
  requestFlush(h.fio, h.state, 's2')
  expect(h.state.compactSession).toBe('s2')
})

test('DetectOptimize — кінець ходу стискання: edits queued / an aborted turn: no toast; compact leaves with the loop guard', async () => {
  const edited = harness(ok({ optimizePrompted: true, compact: true, edits: EDITS }))
  await detectOptimize(detectIO(edited.log), { aborted: false, answer: 'done' })
  const aborted = harness(ok({ optimizePrompted: true, compact: true }))
  await detectOptimize(detectIO(aborted.log), { aborted: true, answer: '' })
  for (const h of [edited, aborted]) {
    expect(h.log.toasts).toEqual([])
    expect(queued(h.log).compact).toBe(false)
  }
})

test('Flush — сесія змінилась: /clear between /compact and the timer: a toast, nothing read or sent', async () => {
  const h = harness(ok({}))
  await h.run()
  h.log.session = 's2'
  const out = await flush(h.fio, h.state, 0)
  expect(out.outcome).toBe('session-changed')
  expect(h.log.toasts).toEqual([modText('/compact skipped: the session changed before the compression turn; run /compact again')])
  expect(h.log.submits).toEqual([])
  expect(h.state.compactSession).toBeUndefined()
})

test('Flush — /compact, людина почала хід: no prompt; the request stays for DeliverReport, which gives COMPACT_ADVICE and clears it', async () => {
  const h = harness(ok({}))
  await h.run()
  turnStarted(h.turns)
  await fire(h.log)
  expect(h.log.submits).toEqual([])
  expect(queued(h.log).compact).toBe(true)
  const seen: (readonly string[])[] = []
  let advised = 0
  await deliverReport({
    readQueue: async () => h.log.queue,
    intro: async () => undefined,
    advice: async () => (advised++, 'block advice'),
    inTurn: () => false,
    enter: async context => (seen.push(context), {}),
    markIntroduced: async () => undefined,
    settle: async s => void (h.log.queue = okRead(settledQueue(queued(h.log), s))),
  })
  expect(seen).toEqual([[COMPACT_ADVICE]])
  expect(advised).toBe(0)
  expect([queued(h.log).optimize, queued(h.log).compact]).toEqual([false, false])
})

test('Flush — /compact, промпт відхилено: the request goes back (compact kept), a toast instead of the status line', async () => {
  const h = harness(ok({}))
  h.fio.submit = async () => Promise.reject(new Error('drop'))
  await h.run()
  await fire(h.log)
  expect([queued(h.log).optimize, queued(h.log).optimizePrompted, queued(h.log).compact]).toEqual([true, false, true])
  expect(h.log.toasts).toEqual([modText('could not start the compression turn; the advice goes with your next prompt')])
})

// ---- [SP_CTX_01_05] CommandNote once per message; [SP_CTX_01_04] the field

test('NoteOnce — кілька звітів: CommandNote only after the last report; the queue keeps its own text for RemoveDelivered', async () => {
  const two = `${withCommandNote('context-editor: applied 1 edit(s)')}\n${withCommandNote('context-editor: applied 2 edit(s)')}`
  expect(noteOnce(two)).toBe(`context-editor: applied 1 edit(s)\ncontext-editor: applied 2 edit(s) ${COMMAND_NOTE}`)
  expect(noteOnce('context-editor: handoff cancelled')).toBe('context-editor: handoff cancelled')
  const h = harness(ok({ report: two, reportId: 3, reportResume: true }))
  await flush(h.fio, h.state, 0)
  expect(h.log.submits).toEqual([])
  const q = { ...EMPTY_QUEUE, edits: EDITS }
  const r = harness(okRead(q), log => void (log.queue = ok({ report: two, reportId: 9, reportResume: true })))
  await flush(r.fio, r.state, 0)
  expect(r.log.submits[0]!.split(COMMAND_NOTE).length).toBe(2)
  expect(r.log.removed).toEqual([two])
})

test('parseQueue — compact: a file without it reads as false; compact without a request or a turn is unreadable', () => {
  const { compact: _c, ...old } = EMPTY_QUEUE
  const read = parseQueue(JSON.stringify(old))
  expect(read.state === 'ok' && read.value.compact).toBe(false)
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, compact: true })).state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, optimize: true, compact: true })).state).toBe('ok')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, compactEndedAt: 5 })).state).toBe('ok')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, compactEndedAt: 'x' })).state).toBe('unreadable')
})

test('isPlanned — загублений таймер: planned until it fires; a timer not fired FLUSH_STALE_MS after planning no longer counts', async () => {
  const h = harness(ok({ edits: EDITS }))
  expect(await flushAfterTurn(h.fio, h.state, false)).toBe(true)
  expect(isPlanned(h.state, h.log.now + FLUSH_STALE_MS)).toBe(true)
  expect(isPlanned(h.state, h.log.now + FLUSH_STALE_MS + 1)).toBe(false)
  h.log.now += FLUSH_STALE_MS + 1
  expect(await flushAfterTurn(h.fio, h.state, false)).toBe(true)
  expect(h.log.timers.length).toBe(2)
  // a refused timer leaves nothing planned
  h.fio.after = () => {
    throw new Error('refused')
  }
  h.state.scheduled = false
  expect(await flushAfterTurn(h.fio, h.state, false)).toBe(false)
  expect(h.state.scheduled).toBe(false)
})

test('CompactTurnText — текст: the mod\'s own text; the whole conversation as the block, STAGE_ADVICE, the stop rule; the notes hint only with notes', () => {
  const text = compactTurnText(0)
  expect(text.startsWith(modText('the person ran /compact.'))).toBe(true)
  expect(text).toContain(STAGE_ADVICE)
  expect(text).toContain('"resume": true')
  expect(text).toContain('context_list')
  expect(text).not.toContain('note(s)')
  expect(compactTurnText(3)).toContain('You have 3 note(s)')
})
