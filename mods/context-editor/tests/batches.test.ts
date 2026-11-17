import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applicable, bindUnselected, deferredHolds, firstRowOf, nonDeferred, rewriteStart, selectEdits, type FirstRow } from '../hooks/batches'
import { cacheShape } from '../hooks/cache'
import { failedQueue, failureRecord, handleCompaction } from '../hooks/compaction'
import { describeEdit, fingerprint, prepare, type QueuedEdit } from '../hooks/edits'
import { flushAfterTurn, newFlushState, type FlushIO } from '../hooks/flush'
import { applyEntry, parseJournal } from '../hooks/journal'
import { EMPTY_QUEUE, keepOtherSteps, parseQueue, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'
import { newTurns, turnCompleted, turnStarted } from '../hooks/turns'
import { harness } from './compaction-fixtures'
import { apiOf, okRead, prompt, result, use } from './row-fixtures'

// A prompt, then `pairs` Read calls c1… with their results (row 2k-1 the
// call ck, row 2k its result), each row with a handle.
function chain(pairs: number): SessionMessage[] {
  const rows: SessionMessage[] = [prompt('task', 'h0')]
  for (let k = 1; k <= pairs; k++) rows.push(use(`c${k}`, 'Read', `u${k}`), result(`c${k}`, `out ${k} ${'y'.repeat(200)}`, `r${k}`))
  return rows
}

const sum = (id: string, deferred?: string): QueuedEdit => ({ op: 'summarize', tool_use_id: id, summary: `s ${id}`, ...(deferred ? { deferred } : {}) })

// a FirstRow by a table of tool_use_ids → first row
const firstAt = (rows: Record<string, number>): FirstRow => e => ('tool_use_id' in e ? rows[e.tool_use_id] : undefined)

const q0 = (edits: QueuedEdit[], extra: Partial<Queue> = {}): Queue => ({ ...EMPTY_QUEUE, ...extra, edits })

// [SP_HELP_05_01] SelectEdits, all five rows; [SP_HELP_05_02] I6
test('SelectEdits — вибір (I6): a batch rides along only when its RewriteStart is not earlier than the batch’s own', () => {
  const rows = chain(30)
  const shape = () => cacheShape(rows, apiOf(rows))
  // O starts at row 50, b1 at 55 (within the lookback), b2 at 20 (deeper: 0)
  const at = firstAt({ o: 50, p: 55, d: 20 })
  const edits = [sum('o'), sum('p', 'b1'), sum('d', 'b2')]
  const s1 = selectEdits(q0(edits, { keepCache: true }), null, shape, at)
  expect(s1.batches).toEqual(['b1'])
  expect(s1.edits.map(e => e.op === 'summarize' && e.tool_use_id)).toEqual(['o', 'p'])
  // a deep O rewrites the whole conversation: every batch
  const deep = selectEdits(q0([sum('d'), sum('p', 'b1'), sum('o', 'b2')], { keepCache: true }), null, shape, firstAt({ d: 20, p: 55, o: 50 }))
  expect(deep.batches).toEqual(['b1', 'b2'])
  // without keep_cache the apply rewrites everything: every batch
  expect(selectEdits(q0(edits), null, shape, at).batches).toEqual(['b1', 'b2'])
  // only deferred edits: an empty selection
  expect(selectEdits(q0([sum('p', 'b1')], { keepCache: true }), null, shape, at)).toEqual({ edits: [], batches: [] })
  // applyDeferred holds while coldSince is the last request's time; stale: as without it
  const lone = q0([sum('p', 'b1'), sum('d', 'b2')], { applyDeferred: true, coldSince: 5 })
  expect(selectEdits(lone, 5, shape, at).batches).toEqual(['b1', 'b2'])
  expect(selectEdits(lone, 9, shape, at)).toEqual({ edits: [], batches: [] })
  // the shape is built only when a batch is weighed
  let built = 0
  selectEdits(q0([sum('o')], { keepCache: true }), null, () => (built++, shape()), at)
  expect(built).toBe(0)
})

test('RewriteStart: an empty set rewrites nothing, no keep_cache rewrites all, a deep start is 0, a shallow one its response start', () => {
  const rows = chain(30)
  const shape = cacheShape(rows, apiOf(rows))
  const at = firstRowOf(rows)
  expect(rewriteStart([], true, shape, at)).toBe(Infinity)
  expect(rewriteStart([sum('c28')], false, shape, at)).toBe(0)
  // the result row of c28 (row 56) belongs to the response that starts at its call (55)
  expect(rewriteStart([sum('c28')], true, shape, at)).toBe(55)
  expect(rewriteStart([sum('c3')], true, shape, at)).toBe(0)
  // nothing found: no rewrite
  expect(rewriteStart([sum('gone')], true, shape, at)).toBe(Infinity)
})

test('NonDeferred, Applicable, deferredHolds: deferred edits count only while applyDeferred holds', () => {
  const q = q0([sum('a'), sum('b', 'b1')])
  expect(nonDeferred(q.edits).length).toBe(1)
  expect(applicable(q, 1).length).toBe(1)
  expect(applicable({ ...q, applyDeferred: true }, null).length).toBe(2)
  expect(deferredHolds({ applyDeferred: true, coldSince: 4 }, 4)).toBe(true)
  expect(deferredHolds({ applyDeferred: true, coldSince: 4 }, 7)).toBe(false)
  expect(deferredHolds({ applyDeferred: true, coldSince: 4 }, null)).toBe(false)
})

// [SP_HELP_05_01] KeepOtherSteps; [SP_HELP_05_02] I12
test('KeepOtherSteps — поля іншого кроку (I12): the choices reset, the deferred edits, deferredSince and nextBatch stay, applyDeferred and coldSince go', () => {
  const q = q0([sum('a'), sum('b', 'b1')], { resume: false, resumeSet: true, keepCache: true, nextBatch: 2, deferredSince: { b1: 3 }, applyDeferred: true, coldSince: 9 })
  const kept = keepOtherSteps(q)
  expect(kept).toEqual({ ...EMPTY_QUEUE, edits: [sum('b', 'b1')], nextBatch: 2, deferredSince: { b1: 3 } })
  // a queue without deferred edits keeps its old shape
  expect(keepOtherSteps(q0([sum('a')], { resume: false }))).toEqual({ ...EMPTY_QUEUE })
})

test('ParseQueue — поля пакета: the batch fields are checked; a deferred return or tag replacement is refused', () => {
  const good = { ...EMPTY_QUEUE, edits: [sum('a', 'b2')], nextBatch: 3, deferredSince: { b2: 1 }, applyDeferred: false, coldSince: 5 }
  expect(parseQueue(JSON.stringify(good)).state).toBe('ok')
  for (const bad of [{ nextBatch: 0 }, { deferredSince: { x1: 1 } }, { applyDeferred: 'yes' }, { coldSince: '5' }, { edits: [{ ...sum('a'), deferred: 'c1' }] }, { edits: [{ ...sum('a'), deferred: 'b1', via: 'tag' }] }])
    expect(parseQueue(JSON.stringify({ ...good, ...bad })).state).toBe('unreadable')
})

// The rows of the apply tests: an own context_list pair near the top
// (DropOwnCalls removes it, so every row after it moves up two), then pairs.
function rowsWithOwn(): SessionMessage[] {
  const rows = chain(30)
  rows.splice(1, 0, use('own', 'mcp__context-editor__context_list', 'ho1'), result('own', 'listing', 'ho2'))
  return rows
}

function apply(rows: SessionMessage[], q: Queue, tags: TagRegistry = { ...EMPTY_REGISTRY }) {
  const h = harness(okRead(q), { readApi: async () => apiOf(rows) }, okRead(tags))
  return { ...h, run: () => handleCompaction(h.io, rows) }
}

// [SP_HELP_05_01] Фіксація — черга; [SP_HELP_01_08] the apply record's `deferred`
test('Фіксація — черга: of two batches the one that starts no earlier applies; the other stays in order with its deferredSince; applyDeferred false', async () => {
  const rows = rowsWithOwn()
  // O: the pair before the last (shallow); b1: the last pair; b2: deep pairs
  const edits = [sum('c29'), sum('c30', 'b1'), sum('c2', 'b2'), sum('c3', 'b2')]
  const { run, written } = apply(rows, q0(edits, { keepCache: true, nextBatch: 3, deferredSince: { b1: 1, b2: 2 } }))
  const out = await run()
  if (!('messages' in out)) throw new Error(out.skip)
  const q = written.queue!
  expect(q.edits).toEqual([sum('c2', 'b2'), sum('c3', 'b2')])
  expect(q.deferredSince).toEqual({ b2: 2 })
  expect(q.nextBatch).toBe(3)
  expect(q.applyDeferred).toBeUndefined()
  expect(q.report).toContain('Deferred: 1 edit(s) of 1 batch(es) applied; 2 still wait.')
  expect(written.journal).toEqual([expect.objectContaining({ kind: 'apply', edits: 2, deferred: 1 })])
})

// [SP_HELP_05_01] Фіксація — прив'язка (both cases); [SP_HELP_05_04] «Ціль відкладеної правки зникла»
test('Фіксація — прив’язка: an unselected collapse after rows the apply folded above gets new indexes; in the frozen prefix it stays and a later apply takes the right rows; one whose rows changed leaves the queue', () => {
  // the applied collapse folds rows 1..4 into one row above the deferred one
  const before = chain(6)
  const [fold] = prepare(before, [{ op: 'collapse', from_index: 1, to_index: 4, summary: 'c1 and c2' }]).queued
  const [later] = prepare(before, [{ op: 'collapse', from_index: 7, to_index: 10, summary: 'c4 and c5' }]).queued
  const after = [before[0]!, { role: 'assistant' as const, text: 'record', toolUses: [] }, ...before.slice(5).map(r => ({ ...r, handle: undefined }))]
  const bound = bindUnselected([{ ...later!, deferred: 'b1' }], before, after, [fold!])
  expect(bound.edits).toEqual([{ ...later!, deferred: 'b1', from_index: 4, to_index: 7 }])
  // a deferred collapse over rows the applied fold took leaves
  const [over] = prepare(before, [{ op: 'collapse', from_index: 3, to_index: 8, summary: 'x' }]).queued
  expect(bindUnselected([{ ...over!, deferred: 'b1' }], before, after, [fold!]).dropped.length).toBe(1)
})

test('Фіксація — прив’язка в обробнику: an unselected collapse in the frozen prefix keeps its rows and the next apply folds exactly them; one over rows O changed leaves; a gone target is "Not applied"', async () => {
  const rows = rowsWithOwn()
  // b1: a collapse of the pairs c2..c3 (rows 5..8), deep; O: the last pair
  const [collapse] = prepare(rows, [{ op: 'collapse', from_index: 5, to_index: 8, summary: 'c2 and c3' }]).queued
  const first = apply(rows, q0([sum('c30'), { ...collapse!, deferred: 'b1' }], { keepCache: true }))
  const out = await first.run()
  if (!('messages' in out)) throw new Error(out.skip)
  const waiting = first.written.queue!.edits
  expect(waiting).toEqual([{ ...collapse!, deferred: 'b1' }])
  expect(out.messages[5]!.toolUses[0]!.tool_use_id).toBe('c2')
  // the next apply, with applyDeferred, folds exactly c2..c3
  const second = apply(out.messages, q0(waiting, { applyDeferred: true }))
  const out2 = await second.run()
  if (!('messages' in out2)) throw new Error(out2.skip)
  const ids = out2.messages.flatMap(r => r.toolUses.map(u => u.tool_use_id))
  expect(ids.includes('c2') || ids.includes('c3')).toBe(false)
  expect(ids).toContain('c1')
  expect(ids).toContain('c4')
  // an unselected collapse over rows the applied O changed leaves with its line
  const [wide] = prepare(rows, [{ op: 'collapse', from_index: 5, to_index: 62, summary: 'most' }]).queued
  const third = apply(rows, q0([sum('c30'), { ...wide!, deferred: 'b1' }], { keepCache: true }))
  const out3 = await third.run()
  if (!('messages' in out3)) throw new Error(out3.skip)
  expect(third.written.queue!.edits).toEqual([])
  expect(third.written.queue!.report).toContain('its rows changed in this apply')
  // a deferred edit whose target is gone, taken by applyDeferred: "Not applied"
  const gone = apply(rows, q0([sum('nothere', 'b1'), sum('c30', 'b1')], { applyDeferred: true }))
  const out4 = await gone.run()
  if (!('messages' in out4)) throw new Error(out4.skip)
  expect(gone.written.queue!.report).toContain('Not applied:')
})

test('BindUnselected — за тотожністю: a row that came back as the same object keeps its edit at the new index without a search', () => {
  const before = chain(4)
  const after = [before[0]!, ...before.slice(3)]
  const rewrite: QueuedEdit = { op: 'rewrite', index: 5, text: 't', anchors: [fingerprint(before[5]!)], deferred: 'b1' }
  expect(bindUnselected([rewrite], before, after, []).edits).toEqual([{ ...rewrite, index: 3 }])
  // the applied edits changed its row: it leaves
  expect(bindUnselected([rewrite], before, after, [{ op: 'rewrite', index: 5, text: 'x', anchors: [fingerprint(before[5]!)] }]).dropped).toEqual([rewrite])
})

// [SP_HELP_05_01] Фіксація — продовження; [SP_HELP_05_02] I7 (selection of deferred edits alone)
test('Фіксація — продовження (I7): a selection of deferred edits alone resumes nothing; with one ordinary edit it resumes as before', async () => {
  const rows = rowsWithOwn()
  const lone = apply(rows, q0([sum('c30', 'b1')], { applyDeferred: true }))
  if (!('messages' in (await lone.run()))) throw new Error('not applied')
  expect(lone.written.queue!.reportResume).toBe(false)
  const mixed = apply(rows, q0([sum('c29'), sum('c30', 'b1')], { applyDeferred: true }))
  if (!('messages' in (await mixed.run()))) throw new Error('not applied')
  expect(mixed.written.queue!.reportResume).toBe(true)
})

// [SP_HELP_05_01] SelectEdits — лише відкладені, застарілий простій (in the handler)
test('HandleCompaction — порожній вибір: deferred edits alone skip before any rebuild; a stale applyDeferred goes with coldSince', async () => {
  const rows = rowsWithOwn()
  const alone = apply(rows, q0([sum('c30', 'b1')], { keepCache: true }))
  expect(await alone.run()).toEqual({ skip: 'context-editor: no applicable edits' })
  expect(alone.written.queue).toBeUndefined()
  expect(alone.written.archive).toBeUndefined()
  const stale = apply(rows, q0([sum('c30', 'b1')], { applyDeferred: true, coldSince: 5 }), { ...EMPTY_REGISTRY, cache: { lastRequestAt: 9, coldAt: null, check: false } })
  expect(await stale.run()).toEqual({ skip: 'context-editor: no applicable edits' })
  expect(stale.written.queue).toEqual({ ...EMPTY_QUEUE, edits: [sum('c30', 'b1')] })
  // the module memory: SelectEdits names what it selected
  let selected: string[] | undefined
  const h = harness(okRead(q0([sum('c29'), sum('c30', 'b1')], { keepCache: true })), { readApi: async () => apiOf(rows), selected: b => void (selected = b) })
  await handleCompaction(h.io, rows)
  expect(selected).toEqual(['b1'])
})

// [SP_HELP_05_01] Гілка збою, all three rows; [SP_HELP_05_02] I12
test('Гілка збою — відкладені (I12): the failed apply’s batches go, the others stay; before a selection none goes; after the commit nothing is written', () => {
  const q = q0([sum('a'), sum('b', 'b1'), sum('c', 'b2')], { applyDeferred: true, coldSince: 3, deferredSince: { b1: 1, b2: 2 } })
  const failed = failedQueue(q, 'boom', 50, ['b1'])
  expect(failed.edits).toEqual([sum('c', 'b2')])
  expect(failed.deferredSince).toEqual({ b2: 2 })
  expect(failed.applyDeferred).toBeUndefined()
  expect(failed.report).toContain('Deferred batches b1 went with it; 1 deferred edit(s) still wait.')
  const early = failedQueue(q, 'boom', 50, undefined)
  expect(early.edits).toEqual([sum('b', 'b1'), sum('c', 'b2')])
  expect(early.report).not.toContain('Deferred batches')
  // only deferred, an old report (resume false): the apply selected b1 and failed before its commit
  const old: Read<Queue> = okRead(q0([sum('b', 'b1')], { applyDeferred: true, report: 'r', reportId: 7, reportResume: false }))
  const wrote = failureRecord(old, 7, 'boom', 50, ['b1'])!
  expect(wrote.edits).toEqual([])
  expect(wrote.applyDeferred).toBeUndefined()
  expect(wrote.report).toContain('applying the edits failed (boom)')
  // after a commit that left b2 unselected: nothing to write
  const committed: Read<Queue> = okRead(q0([sum('c', 'b2')], { report: 'r', reportId: 7 }))
  expect(failureRecord(committed, 7, 'boom', 50, ['b1'])).toBeUndefined()
  // a queue with no deferred edit: as before, whatever the selection
  expect(failureRecord(okRead(q0([], { report: 'r', reportId: 7 })), 7, 'boom', 50)).toBeUndefined()
})

// [SP_HELP_05_01] Flush — лише відкладені
test('Flush — лише відкладені: two deferred edits and none ordinary plan no Flush and run no command; the choices clear by Applicable', async () => {
  let queue: Read<Queue> = okRead(q0([sum('a', 'b1'), sum('b', 'b1')], { resume: false, resumeSet: true }))
  const timers: number[] = []
  const turns = newTurns()
  const io = {
    readQueue: async () => queue,
    updateQueue: async (change: (q: Queue) => Queue | undefined) => {
      if (queue.state === 'unreadable') return false
      const next = change(queue.value)
      if (!next) return false
      queue = okRead(next)
      return true
    },
    readTags: async () => okRead({ ...EMPTY_REGISTRY }),
    compact: async () => undefined,
    after: (ms: number) => void timers.push(ms),
    submit: async () => undefined,
    removeDelivered: async () => undefined,
    status: () => undefined,
    toast: () => undefined,
    now: () => 1000,
    sessionId: async () => 's1',
    turns,
    lastRequestAt: () => 9,
  } as unknown as FlushIO
  turnStarted(turns)
  turnCompleted(turns, false)
  expect(await flushAfterTurn(io, newFlushState(), false)).toBe(false)
  expect(timers).toEqual([])
  expect(queue.state === 'ok' && queue.value).toEqual({ ...EMPTY_QUEUE, edits: [sum('a', 'b1'), sum('b', 'b1')] })
  // an applyDeferred that holds plans the apply
  queue = okRead(q0([sum('a', 'b1')], { applyDeferred: true, coldSince: 9 }))
  expect(await flushAfterTurn(io, newFlushState(), false)).toBe(true)
})

test('JournalApply — поле deferred: only an apply that took deferred edits has it', () => {
  const rows = chain(2)
  const edit = sum('c1')
  const report = { applied: [describeEdit(edit)] }
  const plain = applyEntry(1, report, '/a.json', rows, [edit], 0)
  expect(plain).toBeDefined()
  expect(plain && 'deferred' in plain).toBe(false)
  expect(applyEntry(1, report, '/a.json', rows, [edit], 1)).toMatchObject({ kind: 'apply', edits: 1, deferred: 1 })
  // [SP_HELP_01_08] `idle`: only IdleRun's apply; a stored `idle` other than true is no entry
  const idle = applyEntry(1, report, '/a.json', rows, [edit], 1, true)
  expect(idle).toMatchObject({ kind: 'apply', deferred: 1, idle: true })
  expect(plain && 'idle' in plain).toBe(false)
  expect(parseJournal(JSON.stringify({ entries: [idle] })).state).toBe('ok')
  expect(parseJournal(JSON.stringify({ entries: [{ ...idle, idle: false }] })).state).toBe('unreadable')
})

// [SP_HELP_01_08] [SP_HELP_02_11] the apply record's `idle` in the handler
test('Запис apply — idle: IdleRun’s command with its mark on the last request gives idle: true; overtaken by a turn it skips and the mark goes; a command not IdleRun’s gives none', async () => {
  const rows = rowsWithOwn()
  const tags: TagRegistry = { ...EMPTY_REGISTRY, cache: { lastRequestAt: 500, coldAt: 900, check: true } }
  const idleOf = (j: unknown[]) => (j[0] as { idle?: unknown } | undefined)?.idle
  const held = apply(rows, q0([sum('c30', 'b1')], { applyDeferred: true, coldSince: 500, deferredSince: { b1: 1 } }), tags)
  held.io.idle = () => true
  await held.run()
  expect(held.written.journal).toEqual([expect.objectContaining({ kind: 'apply', deferred: 1, idle: true })])
  // [SP_HELP_02_11] a turn ran before the command: the last request moved past
  // the mark; the turn's own Flush serves the queue, the mark goes
  const moved = apply(rows, q0([sum('c29'), sum('c30', 'b1')], { applyDeferred: true, coldSince: 400, deferredSince: { b1: 1 } }), tags)
  moved.io.idle = () => true
  const skipped = await moved.run()
  expect(skipped).toEqual({ skip: 'context-editor: idle apply overtaken by a turn' })
  expect(moved.written.journal).toEqual([])
  expect(moved.written.queue?.applyDeferred).toBeUndefined()
  expect(moved.written.queue?.edits).toEqual([sum('c29'), sum('c30', 'b1')])
  // a command that is no IdleRun's
  const other = apply(rows, q0([sum('c30', 'b1')], { applyDeferred: true, coldSince: 500, deferredSince: { b1: 1 } }), tags)
  await other.run()
  expect(other.written.journal).toHaveLength(1)
  expect(idleOf(other.written.journal)).toBeUndefined()
})

// [SP_HELP_05_01] Фіксація — прив'язка in the handler, the shifted case: a
// multi-edit batch starts deep (unselected), one of its edits lies after sO,
// and an own pair between sO and it goes (DropOwnCalls after the prefix)
test('Фіксація — прив’язка після префікса: a deferred collapse after sO moves up when the own pair above it goes, and the next apply folds exactly its rows', async () => {
  const rows = chain(30)
  // the own pair between c27 and c28: rows 55..56; c28 at 57..58, c29 at 59..60
  rows.splice(55, 0, use('own', 'mcp__context-editor__context_list', 'ho1'), result('own', 'listing', 'ho2'))
  const [collapse] = prepare(rows, [{ op: 'collapse', from_index: 57, to_index: 60, summary: 'c28 and c29' }]).queued
  const batch: QueuedEdit[] = [sum('c5', 'b1'), { ...collapse!, deferred: 'b1' }]
  const first = apply(rows, q0([sum('c27'), ...batch], { keepCache: true }))
  const out = await first.run()
  if (!('messages' in out)) throw new Error(out.skip)
  // the rows c28's call and c29's result stand at now, whatever the drop of the own pair left
  const from = out.messages.findIndex(r => r.toolUses.some(u => u.tool_use_id === 'c28'))
  const to = out.messages.findIndex(r => r.toolResults?.some(t => t.tool_use_id === 'c29'))
  expect(from).toBeLessThan(57)
  expect(first.written.queue!.edits).toEqual([sum('c5', 'b1'), { ...collapse!, deferred: 'b1', from_index: from, to_index: to }])
  const second = apply(out.messages, q0(first.written.queue!.edits, { applyDeferred: true }))
  const out2 = await second.run()
  if (!('messages' in out2)) throw new Error(out2.skip)
  const ids = out2.messages.flatMap(r => r.toolUses.map(u => u.tool_use_id))
  // c28..c29 folded (the record's carrier pair takes an id after the first), c27 summarized, c30 untouched
  expect(ids.includes('c28') || ids.some(i => i.startsWith('c29'))).toBe(false)
  expect(ids.some(i => i.startsWith('c27'))).toBe(true)
  expect(ids).toContain('c30')
})

// [SP_HELP_02_10] a batch never applies alone: the screens refuse every O edit
test('SelectEdits після екранів: when the screens refuse every edit without `deferred`, no batch rides along and it stays queued', async () => {
  const rows = rowsWithOwn()
  const pinned: TagRegistry = { ...EMPTY_REGISTRY, tags: [{ kind: 'pin', target: { tool_use_id: 'c29' }, created_turn: 0 }] }
  let selected: string[] | undefined
  const h = harness(okRead(q0([sum('c29'), sum('c30', 'b1')], { keepCache: true })), { readApi: async () => apiOf(rows), selected: b => void (selected = b) }, okRead(pinned))
  await handleCompaction(h.io, rows)
  expect(selected).toEqual([])
  expect(h.written.queue!.edits).toEqual([sum('c30', 'b1')])
  expect(h.written.queue!.report).toContain('no edit was applied')
  expect(h.written.queue!.report).toContain('Deferred: 0 edit(s) of 0 batch(es) applied; 1 still wait.')
})

test('HandleCompaction — застарілий простій, збій запису: the skip stays a skip and the failure is traced', async () => {
  const rows = rowsWithOwn()
  const debug: string[] = []
  const h = harness(okRead(q0([sum('c30', 'b1')], { applyDeferred: true, coldSince: 5 })), {
    readApi: async () => apiOf(rows),
    writeQueue: async () => {
      throw new Error('disk full')
    },
    debug: t => void debug.push(t),
  })
  expect(await handleCompaction(h.io, rows)).toEqual({ skip: 'context-editor: no applicable edits' })
  expect(debug).toEqual(['context-editor: stale applyDeferred not cleared: disk full'])
})
