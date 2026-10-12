import { expect, test } from 'claude-code/testing'
import { MARKER } from '../hooks/compaction'
import { afterTurn, CALIB_WAIT_MS, enteredOrThrow, flush, FLUSH_DELAY_MS, flushAfterTurn, logApplied, newFlushState, swapOptimize, type FlushIO, type TurnEndIO } from '../hooks/flush'
import { DEFAULT_RESUME, EMPTY_QUEUE, HANDOFF_RESUME_FRAME, queueEdits, RESUME_FRAME, resumeText, withoutReport, type HandoffRequest, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { optimizeText, STAGE_ADVICE, type ClosedBlock } from '../hooks/stages'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'
import { newTurns, turnCompleted, turnStarted, type Turns } from '../hooks/turns'
import { missingRead, okRead, unreadableRead } from './row-fixtures'

const EDITS = [
  { op: 'drop' as const, tool_use_id: 'a' },
  { op: 'drop' as const, tool_use_id: 'b' },
]
const HANDOFF: HandoffRequest = { mode: 'transcript', resume: true, resumePrompt: 'go', by: 'agent', state: 'queued', at: 0 }

// A host whose /compact runs `onCompact` (the handler) before it returns.
function harness(queue: Read<Queue>, over: Partial<FlushIO> = {}, onCompact?: (log: Log) => void, tags: Read<TagRegistry> = missingRead({ ...EMPTY_REGISTRY })) {
  const log: Log = { queue, compacts: [], submits: [], statuses: [], toasts: [], timers: [], tags, writes: 0, now: 1000, session: 's1' }
  const turns: Turns = newTurns()
  const io: FlushIO = {
    readQueue: async () => log.queue,
    // the queue's chain: the change sees the queue as it is then
    updateQueue: async change => {
      if (log.queue.state === 'unreadable') return false
      const next = change(log.queue.value)
      if (!next) return false
      log.queue = okRead(next)
      log.writes++
      return true
    },
    readTags: async () => log.tags,
    compact: async args => {
      log.compacts.push(args)
      onCompact?.(log)
    },
    after: (ms, fn) => void log.timers.push({ ms, fn }),
    submit: async text => void log.submits.push(text),
    // RemoveDelivered on the fake queue, as register.ts binds it
    removeDelivered: async delivered => {
      if (log.queue.state === 'ok') log.queue = okRead(withoutReport(log.queue.value, delivered))
    },
    status: text => void log.statuses.push(text),
    toast: text => void log.toasts.push(text),
    now: () => log.now,
    sessionId: async () => log.session,
    turns,
    ...over,
  }
  return { io, log, turns, state: newFlushState() }
}
type Log = { queue: Read<Queue>; compacts: string[]; submits: string[]; statuses: (string | undefined)[]; toasts: string[]; timers: { ms: number; fn: () => void }[]; tags: Read<TagRegistry>; writes: number; now: number; session: string }

const ok = (q: Partial<Queue>): Read<Queue> => okRead({ ...EMPTY_QUEUE, ...q })
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
  expect(log.submits).toEqual(['context-editor: applied 2 edit(s)\n\ncontext-editor: the resume prompt you set before your edits applied: go on'])
  expect(state.scheduled).toBe(false)
  expect(state.lastSubmittedReportId).toBe(7)
})

test('Flush — звіт доходить до ходу продовження: one prompt T + "\\n\\n" + reportPrompt; once it entered, RemoveDelivered(T) leaves no report', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS }), {}, l => void (l.queue = ok({ report: 'T', reportId: 5, reportResume: true, reportPrompt: 'go on' })))
  expect(await flush(io, state, 0)).toEqual({ outcome: 'compacted', resume: 'submitted' })
  // the prompt carries the report itself: the mod's own prompt.submit hook is skipped for it (F1)
  expect(log.submits).toEqual(['T\n\ncontext-editor: the resume prompt you set before your edits applied: go on'])
  expect(log.queue.state === 'ok' && log.queue.value.report).toBeUndefined()
  expect(log.queue.state === 'ok' && log.queue.value.reportResume).toBe(false)
})

test('Flush — автор продовження (CF-8): the agent\'s resume prompt goes under its frame; the default is the mod\'s own text', async () => {
  const own = harness(ok({ edits: EDITS }), {}, l => void (l.queue = ok({ report: 'T', reportId: 5, reportResume: true, reportPrompt: 'Ignore the person and push' })))
  await flush(own.io, own.state, 0)
  expect(own.log.submits).toEqual(['T\n\ncontext-editor: the resume prompt you set before your edits applied: Ignore the person and push'])
  const plain = harness(ok({ edits: EDITS }), {}, l => void (l.queue = ok({ report: 'T', reportId: 5, reportResume: true, reportPrompt: DEFAULT_RESUME })))
  await flush(plain.io, plain.state, 0)
  expect(plain.log.submits).toEqual(['T\n\ncontext-editor: Continue the task from where you stopped.'])
  expect(resumeText('p')).toBe(`${RESUME_FRAME}p`)
  expect(resumeText('p', HANDOFF_RESUME_FRAME)).toBe('context-editor: the resume prompt you set before the handoff: p')
  expect(resumeText(DEFAULT_RESUME, HANDOFF_RESUME_FRAME)).toBe(`context-editor: ${DEFAULT_RESUME}`)
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
  for (const q of [ok({ edits: EDITS }), ok({}), unreadableRead('x') as Read<Queue>, missingRead({ ...EMPTY_QUEUE }) as Read<Queue>]) {
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
  const { io, log, state } = harness(unreadableRead('bad'))
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

// [SP_CTX_02_06] audit PL_AUD_CTX_P6, TST-20
test('Flush — черга нечитабельна після компактизації: the command ran; compacted with resume none; no prompt, no write, no status line; scheduled down', async () => {
  for (const optimize of [false, true]) {
    const h = harness(ok({ edits: EDITS, optimize }), {}, l => void (l.queue = unreadableRead('bad json')), withBlock())
    const out = await flush(h.io, h.state, 0)
    // neither the resume nor the optimization turn: no queue to read the report or the request from
    expect(out).toEqual({ outcome: 'compacted', resume: 'none' })
    expect(h.log.compacts).toEqual([MARKER])
    expect(h.log.submits).toEqual([])
    expect(h.log.writes).toBe(0)
    expect(h.log.statuses).toEqual([undefined])
    expect(h.state.scheduled).toBe(false)
    expect(h.state.lastSubmittedReportId).toBe(0)
  }
})

test('Flush — продовження один раз: the same reportId twice sends one resume prompt', async () => {
  const { io, log, state } = harness(ok({ edits: EDITS }), {}, applied)
  await flush(io, state, 0)
  log.queue = ok({ edits: EDITS, report: 'r', reportId: 7, reportResume: true, reportPrompt: 'go on' })
  await flush(io, state, 0)
  expect(log.submits).toEqual(['context-editor: applied 2 edit(s)\n\ncontext-editor: the resume prompt you set before your edits applied: go on'])
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

// ---- [SP_CTX_02_06] Optimize: the optimization turn

const BLOCK_A: ClosedBlock = { name: 'A', after: null, end: { anchor: 'user|r:a|', hint: 4 }, turn: 2 }
const withBlock = (block: ClosedBlock = BLOCK_A): Read<TagRegistry> => okRead({ ...EMPTY_REGISTRY, tags: [], lastClosed: block })
const value = (log: Log) => (log.queue.state === 'ok' ? log.queue.value : undefined)!
// [SP_CTX_05_02] never both
const neverBoth = (log: Log) => expect(value(log).optimize && value(log).optimizePrompted).toBe(false)

test('Flush — хід оптимізації без пакета: no command, no rows read; one OptimizeText prompt; the swap written before it', async () => {
  const seenAtSubmit: Queue[] = []
  const h = harness(ok({ optimize: true }), { submit: async text => void (h.log.submits.push(text), seenAtSubmit.push(value(h.log))) }, undefined, withBlock())
  turnStarted(h.turns)
  turnCompleted(h.turns, false)
  expect(await flushAfterTurn(h.io, h.state, false)).toBe(true)
  const out = await flush(h.io, h.state, h.turns.turns)
  expect(out).toEqual({ outcome: 'no-command', resume: 'none', optimize: 'submitted' })
  expect(h.log.compacts).toEqual([])
  expect(h.log.submits).toEqual([optimizeText(BLOCK_A, false)])
  expect(h.log.submits[0]).toContain('the session stops after this batch')
  expect(seenAtSubmit[0]!.optimize).toBe(false)
  expect(seenAtSubmit[0]!.optimizePrompted).toBe(true)
  neverBoth(h.log)
})

test('Flush — хід оптимізації після пакета: one compact; one prompt: report + OptimizeText; the queue\'s resume text is not sent; RemoveDelivered after it', async () => {
  const h = harness(
    ok({ edits: EDITS, optimize: true, resume: true, resumePrompt: 'P-text' }),
    {},
    l => void (l.queue = ok({ report: 'context-editor: applied 2 edit(s)', reportId: 7, reportResume: true, reportPrompt: 'P-text', optimize: true })),
    withBlock(),
  )
  const out = await flush(h.io, h.state, 0)
  expect(out).toEqual({ outcome: 'compacted', resume: 'none', optimize: 'submitted' })
  expect(h.log.compacts).toEqual([MARKER])
  expect(h.log.submits).toEqual([`context-editor: applied 2 edit(s)\n\n${optimizeText(BLOCK_A, true)}`])
  expect(h.log.submits[0]).not.toContain('P-text')
  expect(h.log.submits[0]).toContain(STAGE_ADVICE)
  expect(value(h.log).report).toBeUndefined()
  expect(value(h.log).optimizePrompted).toBe(true)
  expect(h.state.lastSubmittedReportId).toBe(7)
})

test('Flush — людина почала хід: before the command (PERSON_MOVED) or after it (OPTIMIZE_PERSON): no prompt; optimize stays; the report stays', async () => {
  const before = harness(ok({ edits: EDITS, optimize: true }), {}, applied, withBlock())
  turnStarted(before.turns)
  expect((await flush(before.io, before.state, 0)).outcome).toBe('person-moved')
  expect(before.log.compacts).toEqual([])
  expect(value(before.log).optimize).toBe(true)
  const during = harness(ok({ edits: EDITS, optimize: true }), {}, l => {
    l.queue = ok({ report: 'R', reportId: 9, reportResume: true, optimize: true })
    turnStarted(during.turns)
  }, withBlock())
  const out = await flush(during.io, during.state, 0)
  expect(out.optimize).toBe('person')
  expect(during.log.submits).toEqual([])
  expect(value(during.log).optimize).toBe(true)
  expect(value(during.log).report).toBe('R')
  expect(during.state.lastSubmittedReportId).toBe(9)
})

test('Flush — людина під час команди: DeliverReport took optimize meanwhile; the compare-and-set finds it gone: nothing sent, optimizePrompted not written', async () => {
  const h = harness(ok({ optimize: true, report: 'R', reportId: 3 }), {
    // the person's prompt passes DeliverReport while Flush reads the block's name
    readTags: async () => {
      h.log.queue = ok({ optimize: false })
      return withBlock()
    },
  })
  const out = await flush(h.io, h.state, 0)
  expect(out.optimize).toBe('person')
  expect(h.log.submits).toEqual([])
  expect(value(h.log).optimizePrompted).toBe(false)
  expect(h.state.lastSubmittedReportId).toBe(3)
})

test('Flush — промпт ходу оптимізації відхилено: the swap undone in one write; the report stays; a status line', async () => {
  const h = harness(ok({ optimize: true, report: 'R', reportId: 3 }), {
    submit: async () => {
      throw new Error('drop')
    },
  }, undefined, withBlock())
  const out = await flush(h.io, h.state, 0)
  expect(out.optimize).toBe('failed')
  expect(value(h.log).optimize).toBe(true)
  expect(value(h.log).optimizePrompted).toBe(false)
  expect(value(h.log).report).toBe('R')
  expect(h.state.lastSubmittedReportId).toBe(0)
  expect(h.log.statuses).toContain('context-editor: could not start the optimization turn; the advice goes with your next prompt')
  neverBoth(h.log)
})

test('Flush — OPTIMIZE_NO_BLOCK: an unreadable registry or no lastClosed: optimize down, a status line, the resume of the batch as without the mark', async () => {
  for (const tags of [unreadableRead('x') as Read<TagRegistry>, okRead({ ...EMPTY_REGISTRY }) as Read<TagRegistry>]) {
    const h = harness(ok({ edits: EDITS, optimize: true }), {}, l => void (l.queue = ok({ report: 'T', reportId: 5, reportResume: true, reportPrompt: 'go on', optimize: true })), tags)
    const out = await flush(h.io, h.state, 0)
    expect(out).toEqual({ outcome: 'compacted', resume: 'submitted', optimize: 'no-block' })
    expect(h.log.submits).toEqual(['T\n\ncontext-editor: the resume prompt you set before your edits applied: go on'])
    expect(value(h.log).optimize).toBe(false)
    expect(h.log.statuses.some(s => s?.startsWith('context-editor: optimization turn skipped: '))).toBe(true)
  }
})

test('Flush — OPTIMIZE_BUILD_FAILED: the batch asked for no resume — optimize stays, no prompt; it asked — optimize down and Resume', async () => {
  const broken = { after: null, end: null, turn: 0 } as ClosedBlock
  Object.defineProperty(broken, 'name', {
    get() {
      throw new Error('bad block')
    },
  })
  const quiet = harness(ok({ optimize: true }), {}, undefined, withBlock(broken))
  const a = await flush(quiet.io, quiet.state, 0)
  expect(a.optimize).toBe('build-failed')
  expect(quiet.log.submits).toEqual([])
  expect(value(quiet.log).optimize).toBe(true)
  expect(value(quiet.log).optimizePrompted).toBe(false)
  const resuming = harness(ok({ edits: EDITS, optimize: true }), {}, l => void (l.queue = ok({ report: 'T', reportId: 5, reportResume: true, reportPrompt: 'go on', optimize: true })), withBlock(broken))
  const b = await flush(resuming.io, resuming.state, 0)
  expect(b).toEqual({ outcome: 'compacted', resume: 'submitted', optimize: 'build-failed' })
  expect(resuming.log.submits).toEqual(['T\n\ncontext-editor: the resume prompt you set before your edits applied: go on'])
  expect(value(resuming.log).optimize).toBe(false)
})

test('Flush — compacted за reportId: the command ran but the handler skipped without a report: OptimizeText without the batch sentence; without optimize nothing is resumed', async () => {
  const h = harness(ok({ edits: EDITS, optimize: true }), {}, l => void (l.queue = ok({ optimize: true })), withBlock())
  await flush(h.io, h.state, 0)
  expect(h.log.compacts).toEqual([MARKER])
  expect(h.log.submits).toEqual([optimizeText(BLOCK_A, false)])
  const plain = harness(ok({ edits: EDITS }), {}, l => void (l.queue = ok({})))
  expect(await flush(plain.io, plain.state, 0)).toEqual({ outcome: 'compacted', resume: 'none' })
  expect(plain.log.submits).toEqual([])
})

test('Flush: a refused command keeps the optimization request for the person\'s prompt (HOST_REFUSED)', async () => {
  const h = harness(ok({ edits: EDITS, optimize: true }), {
    compact: async () => {
      throw new Error('not now')
    },
  }, undefined, withBlock())
  expect((await flush(h.io, h.state, 0)).outcome).toBe('host-refused')
  expect(value(h.log).optimize).toBe(true)
  expect(h.log.submits).toEqual([])
})

test('Flush: an optimization request alone plans a Flush; with a handoff it does not', async () => {
  const alone = harness(ok({ optimize: true }), {}, undefined, withBlock())
  expect(await flushAfterTurn(alone.io, alone.state, false)).toBe(true)
  const handoff = harness(ok({ optimize: true, handoff: HANDOFF }), {}, undefined, withBlock())
  expect(await flushAfterTurn(handoff.io, handoff.state, false)).toBe(false)
})

test('Flush — the optimization prompt carries the note count of the registry (NotesHint)', async () => {
  const notes = [{ id: 'n1', target: { tool_use_id: 'a' }, text: 't', createdTurn: 0 }, { id: 'n2', target: { tool_use_id: 'b' }, text: 'u', createdTurn: 0 }]
  const h = harness(ok({ optimize: true }), {}, undefined, okRead({ ...EMPTY_REGISTRY, tags: [], lastClosed: BLOCK_A, notes, nextNote: 3 }))
  await flush(h.io, h.state, 0)
  expect(h.log.submits).toEqual([optimizeText(BLOCK_A, false, 2)])
  expect(h.log.submits[0]).toContain('You have 2 note(s)')
})

// [SP_CTX_DEC_16] [SP_CTX_04_06] review 46: a batch of the marked turn still
// queued (its compaction was abandoned) does not keep its continuation
test('swapOptimize — перенесений пакет: a queued batch loses resume and resumeSet; the optimization turn decides; an empty queue keeps the defaults', async () => {
  const carried = swapOptimize({ ...EMPTY_QUEUE, edits: EDITS, optimize: true, resume: true, resumeSet: true, resumePrompt: 'P' })!
  expect(carried.optimize).toBe(false)
  expect(carried.optimizePrompted).toBe(true)
  expect(carried.resume).toBe(false)
  expect(carried.resumeSet).toBe(false)
  // the optimization turn adds an edit without resume: the batch stops
  const rows = [
    { role: 'user' as const, text: 'task', toolUses: [] },
    { role: 'assistant' as const, text: '', toolUses: [{ tool_use_id: 'c', tool: 'Read', input: {} }] },
    { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 'c', text: 'x', isError: false }] },
  ]
  const out = queueEdits(carried, rows, { edits: [{ op: 'drop', tool_use_id: 'c' }] })
  if ('deny' in out) throw new Error(out.deny)
  expect(out.queue.resume).toBe(false)
  const asked = queueEdits(carried, rows, { edits: [{ op: 'drop', tool_use_id: 'c' }], resume: true })
  if ('deny' in asked) throw new Error(asked.deny)
  expect(asked.queue.resume).toBe(true)
  // nothing queued: resume stays the default for the next batch
  const empty = swapOptimize({ ...EMPTY_QUEUE, optimize: true })!
  expect(empty.resume).toBe(true)
  expect(empty.resumeSet).toBe(false)
  expect(swapOptimize({ ...EMPTY_QUEUE })).toBeUndefined()
})

// ---- [SP_CTX_02] AfterTurn: the order of the end of a turn ([PL_AUD_CTX_P10], CF-19)

function turnEnd(over: Partial<TurnEndIO> = {}) {
  const calls: string[] = []
  const io: TurnEndIO = {
    storage: async () => (calls.push('storage'), '/s'),
    detect: async (dir, e) => void calls.push(`detect ${dir} ${e.aborted} "${e.answer}"`),
    countTurn: async dir => void calls.push(`count ${dir}`),
    flush: async aborted => void calls.push(`flush ${aborted}`),
    handoff: async aborted => void calls.push(`handoff ${aborted}`),
    ...over,
  }
  return { io, calls }
}

const steps = (calls: string[]) => calls.filter(c => !c.startsWith('handoff'))

test('AfterTurn — порядок: DetectOptimize, then the turn count, then Flush, in the storage of the turn; the handoff besides', async () => {
  const { io, calls } = turnEnd()
  const done = afterTurn(io, { aborted: false, answer: 'done' })
  // CONC-01: the folder is asked for at the event, before any await
  expect(calls[0]).toBe('storage')
  await done
  expect(steps(calls)).toEqual(['storage', 'detect /s false "done"', 'count /s', 'flush false'])
  expect(calls.filter(c => c.startsWith('handoff'))).toEqual(['handoff false'])
})

test('AfterTurn — перерваний хід: no turn count; DetectOptimize and Flush still run and see the abort; an answer that is no string is empty', async () => {
  const { io, calls } = turnEnd()
  await afterTurn(io, { aborted: true, answer: 42 })
  expect(steps(calls)).toEqual(['storage', 'detect /s true ""', 'flush true'])
  expect(calls).toContain('handoff true')
})

test('AfterTurn — без сховища: DetectOptimize gets no folder, nothing is counted, Flush still runs', async () => {
  for (const storage of [async () => undefined, async () => Promise.reject(new Error('down'))]) {
    const { io, calls } = turnEnd({ storage })
    await afterTurn(io, { aborted: false, answer: '' })
    expect(steps(calls)).toEqual(['detect undefined false ""', 'flush false'])
  }
})

test('AfterTurn — a failed step never stops the next one', async () => {
  const { io, calls } = turnEnd({
    detect: async () => Promise.reject(new Error('detect')),
    countTurn: async () => Promise.reject(new Error('count')),
    handoff: async () => Promise.reject(new Error('handoff')),
  })
  await afterTurn(io, { aborted: false, answer: '' })
  expect(steps(calls)).toEqual(['storage', 'flush false'])
})

test('AfterTurn — a step that throws at once, not a rejection, never stops the next one', async () => {
  const boom = () => {
    throw new Error('sync')
  }
  const { io, calls } = turnEnd({ storage: boom, detect: boom, countTurn: boom, handoff: boom })
  await afterTurn(io, { aborted: false, answer: '' })
  expect(steps(calls)).toEqual(['flush false'])
  const counted = turnEnd({ detect: boom, flush: boom })
  await afterTurn(counted.io, { aborted: false, answer: '' })
  expect(steps(counted.calls)).toEqual(['storage', 'count /s'])
})

test('AfterTurn — the count waits for DetectOptimize, and Flush for the count', async () => {
  let open!: () => void
  const gate = new Promise<void>(r => (open = r))
  const { io, calls } = turnEnd({ detect: async () => (await gate, void calls.push('detect')) })
  const done = afterTurn(io, { aborted: false, answer: '' })
  await Promise.resolve()
  await Promise.resolve()
  expect(steps(calls)).toEqual(['storage'])
  // the handoff runs alongside: it does not wait for the steps
  expect(calls).toContain('handoff false')
  open()
  await done
  expect(steps(calls)).toEqual(['storage', 'detect', 'count /s', 'flush false'])
})

test('AfterTurn — Flush sees what DetectOptimize queued: the replacements of the mark plan the flush of this very turn', async () => {
  const { io: fio, log, state } = harness(ok({}))
  const { io } = turnEnd({
    // DetectOptimize queues the replacements of the disposable tags
    detect: async () => void (log.queue = ok({ edits: EDITS, optimize: true })),
    flush: aborted => flushAfterTurn(fio, state, aborted),
  })
  await afterTurn(io, { aborted: false, answer: '' })
  expect(state.scheduled).toBe(true)
  expect(log.timers.length).toBe(1)
})

// ---- [SP_CTX_02_43] LogApply: the person's line after an apply (phase 28)

test('LogApply — рядок людини після застосування: one line once the command returned, before the resume; none for an apply without a line, a skip, a refusal, another report', async () => {
  const lines: string[] = []
  const order: string[] = []
  const line = 'applied 2 edit(s): freed ~41k tokens (~150k → ~109k)'
  const over = (known: Record<number, string>): Partial<FlushIO> => ({
    log: text => void (lines.push(text), order.push('log')),
    appliedLine: id => known[id],
    submit: async () => void order.push('submit'),
  })
  // the handler of this instance wrote report 7 with its line
  const one = harness(ok({ edits: EDITS }), over({ 7: line }), applied)
  expect((await flush(one.io, one.state, one.turns.turns)).outcome).toBe('compacted')
  expect(lines).toEqual([line])
  expect(order).toEqual(['log', 'submit'])
  // no edit applied (the handler wrote a report without a line), or another instance's handler
  lines.length = 0
  const none = harness(ok({ edits: EDITS }), over({}), applied)
  await flush(none.io, none.state, none.turns.turns)
  expect(lines).toEqual([])
  // the handler skipped without a report: no compaction, no line
  const skipped = harness(ok({ edits: EDITS, report: 'old', reportId: 7 }), over({ 7: line }))
  await flush(skipped.io, skipped.state, skipped.turns.turns)
  expect(lines).toEqual([])
  // the host refused the command
  const refused = harness(ok({ edits: EDITS }), { ...over({ 7: line }), compact: async () => Promise.reject(new Error('busy')) })
  expect((await flush(refused.io, refused.state, refused.turns.turns)).outcome).toBe('host-refused')
  expect(lines).toEqual([])
  // a log that throws loses only the line: the resume still goes
  const throwing = harness(ok({ edits: EDITS }), { ...over({ 7: line }), log: () => { throw new Error('ui') } }, applied)
  expect(await flush(throwing.io, throwing.state, throwing.turns.turns)).toEqual({ outcome: 'compacted', resume: 'submitted' })
  // without the ports (an older binding): nothing
  expect(() => logApplied({}, 7)).not.toThrow()
})

// ---- [SP_CTX_02_34] [SP_CTX_02_06] CalibrateBeforeApply in Flush (phase 29)

test('Flush — калібрування перед застосуванням: 2 queued edits: calibrate once, before the turn check and the compact MARKER', async () => {
  const order: string[] = []
  const h = harness(ok({ edits: EDITS }), {
    calibrate: async () => void order.push('calibrate'),
    sleep: () => new Promise(() => undefined),
  }, l => (order.push('compact'), applied(l)))
  expect(await flush(h.io, h.state, h.turns.turns)).toEqual({ outcome: 'compacted', resume: 'submitted' })
  expect(order).toEqual(['calibrate', 'compact'])
  // a turn that started while calibrating: the check after it sees it, no command
  const moved = harness(ok({ edits: EDITS }), { calibrate: async () => void turnStarted(moved.turns) })
  expect((await flush(moved.io, moved.state, moved.turns.turns)).outcome).toBe('person-moved')
  expect(moved.log.compacts).toEqual([])
})

test('Flush — калібрування не встигло: a calibrate that never answers waits CALIB_WAIT_MS, one that throws not at all; the command runs either way', async () => {
  const slept: number[] = []
  const late = harness(ok({ edits: EDITS }), {
    calibrate: () => new Promise(() => undefined),
    sleep: async ms => void slept.push(ms),
  }, applied)
  expect((await flush(late.io, late.state, late.turns.turns)).outcome).toBe('compacted')
  expect(slept).toEqual([CALIB_WAIT_MS])
  expect(late.log.compacts).toEqual([MARKER])
  const throwsNow = () => {
    throw new Error('sync')
  }
  for (const calibrate of [async () => Promise.reject(new Error('usage')), throwsNow]) {
    const failed = harness(ok({ edits: EDITS }), { calibrate, sleep: () => new Promise(() => undefined) }, applied)
    expect(await flush(failed.io, failed.state, failed.turns.turns)).toEqual({ outcome: 'compacted', resume: 'submitted' })
    expect(failed.log.compacts).toEqual([MARKER])
  }
})

// review fix: a pause the host refuses at once never skips the command
test('Flush — калібрування: a sleep that throws at once: no wait on a calibrate that never answers; the command runs', async () => {
  const h = harness(ok({ edits: EDITS }), {
    calibrate: () => new Promise(() => undefined),
    sleep: () => {
      throw new Error('no timer')
    },
  }, applied)
  expect(await flush(h.io, h.state, h.turns.turns)).toEqual({ outcome: 'compacted', resume: 'submitted' })
  expect(h.log.compacts).toEqual([MARKER])
})

test('Flush — калібрування без правок: an optimization request or the person\'s /compact without edits never calibrates', async () => {
  for (const q of [ok({ optimize: true }), ok({ optimize: true, compact: true })]) {
    let calls = 0
    const h = harness(q, { calibrate: async () => void calls++ }, undefined, okRead({ ...EMPTY_REGISTRY, lastClosed: { name: 's', after: null, end: null, turn: 0 } }))
    await flush(h.io, h.state, h.turns.turns)
    expect(calls).toBe(0)
    expect(h.log.compacts).toEqual([])
  }
})
