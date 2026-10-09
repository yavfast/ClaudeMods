import { expect, test } from 'claude-code/testing'
import { MARKER } from '../hooks/compaction'
import { enteredOrThrow, flush, FLUSH_DELAY_MS, flushAfterTurn, newFlushState, type FlushIO } from '../hooks/flush'
import { EMPTY_QUEUE, withoutReport, type HandoffRequest, type Queue, type Read } from '../hooks/queue'
import { newTurns, turnCompleted, turnStarted, type Turns } from '../hooks/turns'

const EDITS = [
  { op: 'drop' as const, tool_use_id: 'a' },
  { op: 'drop' as const, tool_use_id: 'b' },
]
const HANDOFF: HandoffRequest = { mode: 'transcript', resume: true, resumePrompt: 'go', by: 'agent', state: 'queued', at: 0 }

// A host whose /compact runs `onCompact` (the handler) before it returns.
function harness(queue: Read<Queue>, over: Partial<FlushIO> = {}, onCompact?: (log: Log) => void) {
  const log: Log = { queue, compacts: [], submits: [], statuses: [], timers: [] }
  const turns: Turns = newTurns()
  const io: FlushIO = {
    readQueue: async () => log.queue,
    compact: async args => {
      log.compacts.push(args)
      onCompact?.(log)
    },
    after: (ms, fn) => void log.timers.push({ ms, fn }),
    submit: async text => void log.submits.push(text),
    // RemoveDelivered on the fake queue, as register.ts binds it
    removeDelivered: async delivered => {
      if (log.queue.state === 'ok') log.queue = { state: 'ok', value: withoutReport(log.queue.value, delivered) }
    },
    status: text => void log.statuses.push(text),
    turns,
    ...over,
  }
  return { io, log, turns, state: newFlushState() }
}
type Log = { queue: Read<Queue>; compacts: string[]; submits: string[]; statuses: (string | undefined)[]; timers: { ms: number; fn: () => void }[] }

const ok = (q: Partial<Queue>): Read<Queue> => ({ state: 'ok', value: { ...EMPTY_QUEUE, ...q } })
// what the handler leaves: the batch gone, a report that asks for the resume
const applied = (log: Log, reportId = 7) => void (log.queue = ok({ report: 'context-editor: applied 2 edit(s)', reportId, reportResume: true, reportPrompt: 'go on' }))

test('Flush — запуск: a completed turn with 2 queued edits plans one compact with MARKER after FLUSH_DELAY', async () => {
  const { io, log, turns, state } = harness(ok({ edits: EDITS }), {}, applied)
  turnStarted(turns)
  turnCompleted(turns, false)
  expect(await flushAfterTurn(io, state, false)).toBe(true)
  expect(state.scheduled).toBe(true)
  expect(log.timers.map(t => t.ms)).toEqual([FLUSH_DELAY_MS])
  // a second turn end while planned plans nothing more
  expect(await flushAfterTurn(io, state, false)).toBe(false)
  const out = await flush(io, state, turns.turns)
  expect(out).toEqual({ outcome: 'compacted', resume: 'submitted' })
  expect(log.compacts).toEqual([MARKER])
  expect(log.submits).toEqual(['context-editor: applied 2 edit(s)\n\ngo on'])
  expect(state.scheduled).toBe(false)
  expect(state.lastSubmittedReportId).toBe(7)
})

test('Flush — звіт доходить до ходу продовження: one prompt T + "\\n\\n" + reportPrompt; once it entered, RemoveDelivered(T) leaves no report', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS }), {}, l => void (l.queue = ok({ report: 'T', reportId: 5, reportResume: true, reportPrompt: 'go on' })))
  expect(await flush(io, state, 0)).toEqual({ outcome: 'compacted', resume: 'submitted' })
  // the prompt carries the report itself: the mod's own prompt.submit hook is skipped for it (F1)
  expect(log.submits).toEqual(['T\n\ngo on'])
  expect(log.queue.state === 'ok' && log.queue.value.report).toBeUndefined()
  expect(log.queue.state === 'ok' && log.queue.value.reportResume).toBe(false)
})

test('Flush: a report appended while the prompt went in stays; only the delivered text leaves', async () => {
  const h = harness(ok({ edits: EDITS }), {
    submit: async text => {
      h.log.submits.push(text)
      if (h.log.queue.state === 'ok') h.log.queue = ok({ ...h.log.queue.value, report: `${h.log.queue.value.report}\nnewer`, reportId: 6 })
    },
  }, l => void (l.queue = ok({ report: 'T', reportId: 5, reportResume: true, reportPrompt: 'go on' })))
  await flush(h.io, h.state, 0)
  expect(h.log.queue.state === 'ok' && h.log.queue.value.report).toBe('newer')
})

test('Flush: an interrupted turn, an empty, unreadable or missing queue plan nothing', async () => {
  for (const q of [ok({ edits: EDITS }), ok({}), { state: 'unreadable', reason: 'x' } as Read<Queue>, { state: 'missing', value: { ...EMPTY_QUEUE } } as Read<Queue>]) {
    const { io, log, state } = harness(q)
    expect(await flushAfterTurn(io, state, q.state === 'ok' && q.value.edits.length > 0)).toBe(false)
    expect(log.timers).toEqual([])
  }
})

test('Flush — передача в черзі: edits with a handoff request run no command', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS, handoff: HANDOFF }))
  expect(await flushAfterTurn(io, state, false)).toBe(false)
  expect((await flush(io, state, 0)).outcome).toBe('handoff-pending')
  expect(log.compacts).toEqual([])
})

test('Flush — QUEUE_UNREADABLE: no command, nothing written', async () => {
  const { io, log, state } = harness({ state: 'unreadable', reason: 'bad' })
  expect((await flush(io, state, 0)).outcome).toBe('queue-unreadable')
  expect(log.compacts).toEqual([])
  expect(state.scheduled).toBe(false)
})

test('Flush — хост відмовляє: one attempt, no waits; the queue stays; the status line holds the host text', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS }), {
    compact: async args => {
      log.compacts.push(args)
      throw new Error('command.run: called from a tool.call hook, it would wait on the turn this hook is holding')
    },
  })
  const out = await flush(io, state, 0)
  expect(out.outcome).toBe('host-refused')
  expect(log.compacts.length).toBe(1)
  expect(log.timers).toEqual([])
  expect(log.statuses.at(-1)).toBe(
    'context-editor: compaction refused: command.run: called from a tool.call hook, it would wait on the turn this hook is holding; queued edits wait for the next turn',
  )
  expect(log.queue.state === 'ok' && log.queue.value.edits.length).toBe(2)
  expect(state.scheduled).toBe(false)
})

test('Flush — хід від планування, хід іде: no command, scheduled down; the end of that turn plans Flush', async () => {
  const { io, log, turns, state } = harness(ok({ edits: EDITS }))
  state.scheduled = true
  turnStarted(turns)
  expect((await flush(io, state, 0)).outcome).toBe('person-moved')
  expect(log.compacts).toEqual([])
  expect(state.scheduled).toBe(false)
  expect(log.timers).toEqual([])
  turnCompleted(turns, false)
  expect(await flushAfterTurn(io, state, false)).toBe(true)
})

test('Flush — хід від планування, скінчився звичайно: no command; Flush planned again after FLUSH_DELAY', async () => {
  const { io, log, turns, state } = harness(ok({ edits: EDITS }))
  turnStarted(turns)
  turnCompleted(turns, false)
  expect((await flush(io, state, 0)).outcome).toBe('person-moved')
  expect(log.compacts).toEqual([])
  expect(state.scheduled).toBe(true)
  expect(log.timers.map(t => t.ms)).toEqual([FLUSH_DELAY_MS])
})

test('Flush — хід від планування, перерваний: no command, no new planning; the queue waits for the next completed turn', async () => {
  const { io, log, turns, state } = harness(ok({ edits: EDITS }))
  turnStarted(turns)
  turnCompleted(turns, true)
  expect((await flush(io, state, 0)).outcome).toBe('person-moved')
  expect(log.compacts).toEqual([])
  expect(state.scheduled).toBe(false)
  expect(log.timers).toEqual([])
})

test('Flush — людина почала хід (PERSON_ACTIVE): turns moved while the command waited; no resume prompt, the report stays for DeliverReport', async () => {
  const h = harness(ok({ edits: EDITS }), {}, log => {
    applied(log, 9)
    turnStarted(h.turns)
  })
  const out = await flush(h.io, h.state, 0)
  expect(out).toEqual({ outcome: 'compacted', resume: 'person-active' })
  expect(h.log.submits).toEqual([])
  expect(h.state.lastSubmittedReportId).toBe(9)
  expect(h.log.queue.state === 'ok' && h.log.queue.value.report).toContain('applied 2 edit(s)')
})

test('Flush — продовження один раз: the same reportId twice sends one resume prompt', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS }), {}, applied)
  await flush(io, state, 0)
  log.queue = ok({ edits: EDITS, report: 'r', reportId: 7, reportResume: true, reportPrompt: 'go on' })
  await flush(io, state, 0)
  expect(log.submits).toEqual(['context-editor: applied 2 edit(s)\n\ngo on'])
})

test('Flush — відправка відхилена (RESUME_FAILED): a submit that throws leaves lastSubmittedReportId and warns', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS }), {
    submit: async () => {
      throw new Error('prompt.submit failed')
    },
  }, applied)
  const out = await flush(io, state, 0)
  expect(out.resume).toBe('resume-failed')
  expect(state.lastSubmittedReportId).toBe(0)
  expect(log.statuses.at(-1)).toContain('could not resume the session')
  // the report stays queued for DeliverReport with the person's next prompt
  expect(log.queue.state === 'ok' && log.queue.value.report).toBe('context-editor: applied 2 edit(s)')
})

test('Flush — відправка відхилена (RESUME_FAILED): a prompt the host drops (`{ drop }`, no throw) rejects through the binding, the same way', async () => {
  let prompts = 0
  const { io, log, state } = harness(ok({ edits: EDITS }), {
    // the register.ts binding: enteredOrThrow($.prompt.submit({ text }))
    submit: () => {
      prompts++
      return enteredOrThrow(Promise.resolve({ drop: 'refused by a hook' }))
    },
  }, applied)
  const out = await flush(io, state, 0)
  expect(prompts).toBe(1)
  expect(out.resume).toBe('resume-failed')
  expect(state.lastSubmittedReportId).toBe(0)
  expect(log.statuses.at(-1)).toBe('context-editor: could not resume the session; send any prompt to continue')
  expect(log.queue.state === 'ok' && log.queue.value.report).toBe('context-editor: applied 2 edit(s)')
  let thrown: unknown
  await enteredOrThrow(Promise.resolve({ drop: 'x' })).catch(err => (thrown = err))
  expect(String(thrown)).toContain('x')
  await enteredOrThrow(Promise.resolve({}))
})

test('Flush: no resume prompt when the report does not ask for one; the status line is cleared first', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS }), {}, l => void (l.queue = ok({ report: 'r', reportId: 3, reportResume: false })))
  expect(await flush(io, state, 0)).toEqual({ outcome: 'compacted', resume: 'none' })
  expect(log.submits).toEqual([])
  expect(log.statuses[0]).toBeUndefined()
})

test('Flush: scheduled is down after a throw too', async () => {
  const { io, state } = harness(ok({ edits: EDITS }), {
    readQueue: async () => {
      throw new Error('disk')
    },
  })
  state.scheduled = true
  let thrown = false
  await flush(io, state, 0).catch(() => (thrown = true))
  expect(thrown).toBe(true)
  expect(state.scheduled).toBe(false)
})
