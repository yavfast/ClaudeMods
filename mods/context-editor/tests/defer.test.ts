// [SP_HELP_05_01] [SP_HELP_05_02] PL_HELP phase 4: the `defer` field of
// context_edit, the visible deferred batches (status line, telemetry), the
// brief of a passed-over /compact.
import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applicable, deferredRewrite, deferredView, firstRowOf, queueStatus, withoutDeferred } from '../hooks/batches'
import { cacheShape } from '../hooks/cache'
import { briefedQueue, compactBrief } from '../hooks/capabilities'
import { MAX_QUEUE_EDITS, RECALL_CALL, type QueuedEdit } from '../hooks/edits'
import { contextEdit, DEFER_IGNORES, DEFER_RETURN, DEFER_STATE, deferredText, EMPTY_QUEUE, keepOtherSteps, queueEdits, type Queue, type QueueIO } from '../hooks/queue'
import { deferredLine, telemetryText, type Telemetry } from '../hooks/stages'
import type { Read } from '../hooks/store'
import { EMPTY_REGISTRY, queueTagReplacements, type Tag, type TagIO } from '../hooks/tags'
import { apiOf, missingRead, okRead, prompt, reply, result, use } from './row-fixtures'

// A prompt, three Read pairs c1..c3 and a recall pair r1 (rows 7, 8).
function conversation(): SessionMessage[] {
  return [
    prompt('task', 'h0'),
    use('c1', 'Read', 'h1'),
    result('c1', `out 1 ${'x'.repeat(4000)}`, 'h2'),
    use('c2', 'Read', 'h3'),
    result('c2', `out 2 ${'y'.repeat(4000)}`, 'h4'),
    use('c3', 'Read', 'h5'),
    result('c3', `out 3 ${'z'.repeat(4000)}`, 'h6'),
    use('r1', RECALL_CALL, 'h7', { fold: 'f1' }),
    result('r1', 'the recalled level', 'h8'),
    reply('used it', 'h9'),
  ]
}

const sum = (id: string, deferred?: string): QueuedEdit => ({ op: 'summarize', tool_use_id: id, summary: `s ${id}`, ...(deferred ? { deferred } : {}) })
const DUE = [{ tool_use_id: 'r1', due: true }]

function port(read: Read<Queue>, over: Partial<QueueIO> = {}) {
  const log: { written?: Queue; calls: string[] } = { calls: [] }
  const io: QueueIO = {
    readQueue: async () => read,
    writeQueue: async q => void (log.written = q),
    quarantine: async () => undefined,
    queuePath: '/s/pending.json',
    endWaiting: async () => (log.calls.push('end'), 'stage "A"'),
    replace: async () => (log.calls.push('replace'), { queued: 1, freed: '~40 tokens' }),
    recalls: async () => DUE,
    turn: 7,
    ...over,
  }
  return { io, log }
}

// [SP_HELP_05_01] Постановка — `defer`
test('Постановка — defer: the batch b1 with deferredSince; the batch choices of the queue unchanged; no return beside it; the sentence instead of the promise; no Flush', async () => {
  const rows = conversation()
  const start: Queue = { ...EMPTY_QUEUE, resume: false, resumeSet: true, tagsOnly: true }
  const { io, log } = port(okRead(start))
  const out = await contextEdit(io, rows, { edits: [{ op: 'summarize', tool_use_id: 'c1', summary: 'S1' }], defer: true, resume_prompt: 'go on', keep_cache: true })
  const text = 'result' in out ? out.result : ''
  const q = log.written!
  expect(q.edits).toEqual([{ op: 'summarize', tool_use_id: 'c1', summary: 'S1', deferred: 'b1' }])
  expect([q.nextBatch, q.deferredSince]).toEqual([2, { b1: 7 }])
  // the choices belong to the batch that applies next
  expect([q.resume, q.resumeSet, q.resumePrompt, q.keepCache, q.tagsOnly]).toEqual([false, true, EMPTY_QUEUE.resumePrompt, false, true])
  expect(text).toContain('Queued 1 edit(s); 1 pending in total.')
  expect(text).toContain(deferredText('b1'))
  expect(text).toContain(DEFER_IGNORES)
  expect(text).not.toContain('They apply when this turn ends')
  expect(text).not.toContain('return with this batch')
  // no Flush: nothing applicable at the end of the turn
  expect(applicable(q, null)).toEqual([])
  // the same call without defer adds the due recall's return
  const plain = port(okRead({ ...EMPTY_QUEUE }))
  await contextEdit(plain.io, rows, { edits: [{ op: 'summarize', tool_use_id: 'c1', summary: 'S1' }] })
  expect(plain.log.written!.edits.some(e => e.via === 'return')).toBe(true)
})

// [SP_HELP_05_01] Постановка — `defer` і очікування; [SP_HELP_05_02] I10
test('Постановка — defer і очікування (I10): the waiting block keeps waiting, no tag replacement is queued; the next call without defer ends the wait', async () => {
  const rows = conversation()
  const { io, log } = port(missingRead({ ...EMPTY_QUEUE }))
  const deferred = await contextEdit(io, rows, { edits: [{ op: 'drop', tool_use_id: 'c2' }], defer: true })
  expect('result' in deferred && deferred.result).not.toContain('no longer waits')
  expect(log.calls).toEqual([])
  expect('result' in deferred && deferred.result).not.toContain(DEFER_IGNORES)
  const after = port(okRead(log.written!))
  const own = await contextEdit(after.io, rows, { edits: [{ op: 'drop', tool_use_id: 'c3' }] })
  expect('result' in own && own.result).toContain('stage "A" no longer waits for compression.')
  expect(after.log.calls).toEqual(['end', 'replace'])
  // the own call promises its apply; the deferred edit stays apart
  expect('result' in own && own.result).toContain('They apply when this turn ends.')
  // the deferred edit first, the own one, then the due recall's return
  expect(after.log.written!.edits.map(e => [e.deferred, e.via])).toEqual([['b1', undefined], [undefined, undefined], [undefined, 'return']])
})

// [SP_HELP_05_01] KeepOtherSteps — поля іншого кроку: the next defer is b2
test('KeepOtherSteps — наступний defer: after a batch end the batch numbers go on (b2), b1 and its deferredSince stay', () => {
  const rows = conversation()
  const q: Queue = { ...EMPTY_QUEUE, edits: [sum('c1', 'b1')], nextBatch: 2, deferredSince: { b1: 3 }, keepCache: true, resume: false }
  const kept = keepOtherSteps(q)
  expect([kept.keepCache, kept.resume]).toEqual([false, true])
  const out = queueEdits(kept, rows, { edits: [{ op: 'drop', tool_use_id: 'c2' }], defer: true }, undefined, undefined, false, undefined, [], [], undefined, [], 5)
  if ('deny' in out) throw new Error(out.deny)
  expect(out.deferred).toBe('b2')
  expect(out.queue.edits.map(e => e.deferred)).toEqual(['b1', 'b2'])
  expect([out.queue.nextBatch, out.queue.deferredSince]).toEqual([3, { b1: 3, b2: 5 }])
})

// [SP_HELP_02_10] a summarize of a recall pair is a return: refused in a deferred call; nothing accepted takes no batch number
test('Постановка — defer над парою розгортання: an edit over a recall pair not yet returned is rejected; with nothing accepted no batch number is spent and the queue is as it was', () => {
  const rows = conversation()
  const out = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [{ op: 'summarize', tool_use_id: 'r1', summary: 'R' }], defer: true }, undefined, undefined, false, undefined, [], [], undefined, DUE, 2)
  if ('deny' in out) throw new Error(out.deny)
  expect(out.errors).toEqual([`summarize r1: ${DEFER_RETURN}`])
  expect([out.queued, out.deferred, out.queue]).toEqual([0, undefined, { ...EMPTY_QUEUE }])
  // a drop of the pair and a range over it meet the same rule; an edit beside it is queued
  const over = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [{ op: 'drop', tool_use_id: 'r1' }, { op: 'collapse', from_index: 7, to_index: 9, summary: 'C' }, { op: 'drop', tool_use_id: 'c1' }], defer: true }, undefined, undefined, false, undefined, [], [], undefined, DUE, 2)
  if ('deny' in over) throw new Error(over.deny)
  expect(over.errors.length).toBe(2)
  expect(over.errors.every(e => e.endsWith(DEFER_RETURN))).toBe(true)
  expect(over.queue.edits).toEqual([{ op: 'drop', tool_use_id: 'c1', deferred: 'b1' }])
  // the field is a boolean
  const bad = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [{ op: 'drop', tool_use_id: 'c1' }], defer: 'yes' })
  expect(bad).toEqual({ deny: '"defer" must be true or false.' })
  // false is an ordinary call
  const off = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [{ op: 'drop', tool_use_id: 'c1' }], defer: false })
  expect('queue' in off && off.queue.edits).toEqual([{ op: 'drop', tool_use_id: 'c1' }])
})

// [SP_CTX_02_02] [SP_HELP_02_10] the status line: the deferred edits apart
test('Рядок стану: the edits of the next apply, the deferred ones apart; none: no line', () => {
  expect(queueStatus([])).toBeUndefined()
  expect(queueStatus([sum('a')])).toBe('1 context edit(s) queued')
  expect(queueStatus([sum('a'), sum('b', 'b1'), sum('c', 'b2')])).toBe('1 context edit(s) queued, 2 deferred')
  expect(queueStatus([sum('b', 'b1')])).toBe('1 deferred context edit(s)')
})

// [SP_HELP_05_01] Телеметрія — пакети
test('Телеметрія — пакети: DeferredView, the rewrite of the deferred edits alone, the warm line and its place after the clock', () => {
  const rows = conversation()
  const q: Queue = { ...EMPTY_QUEUE, edits: [sum('c3'), sum('c1', 'b1'), sum('c2', 'b2'), sum('c3', 'b2')], deferredSince: { b1: 4, b2: 6 } }
  expect(deferredView(q)).toEqual({ batches: 2, edits: 3, oldest: 4 })
  expect(deferredView({ edits: [sum('c1')] })).toBeUndefined()
  expect(deferredView({ edits: [sum('c1', 'b1')] })).toEqual({ batches: 1, edits: 1 })
  const shape = cacheShape(rows, apiOf(rows))
  // from c1's response on: within the lookback, so less than the whole
  const x = deferredRewrite(q.edits, shape, firstRowOf(rows), 9000, 3)!
  expect(x).toBeGreaterThan(0)
  expect(x).toBeLessThanOrEqual(9000)
  expect(deferredRewrite([sum('gone', 'b1')], shape, firstRowOf(rows), 9000, 3)).toBeUndefined()
  expect(deferredLine({ batches: 2, edits: 3, oldest: 4, tokens: 12_000 })).toBe(
    'Deferred: 2 batch(es), 3 edit(s), the oldest from turn 4; applying them now would rewrite ~12k tokens of cache; they wait for an apply that starts no later, or a handoff.',
  )
  expect(deferredLine({ batches: 1, edits: 1 })).toBe('Deferred: 1 batch(es), 1 edit(s); they wait for an apply that starts no later, or a handoff.')
  const t: Telemetry = { measure: 'unknown', autoCompactOff: false, registry: false, regions: [], reviews: new Map(), disposable: 0, state: 'none', notes: { count: 0, reminders: 0 } }
  const journal = { applications: 0, rereads: 0, archiveRereads: 0, helper: { questions: 1, calls: 1, in: 400, out: 90, verified: 1, rejected: 0 } }
  const lines = telemetryText({ ...t, journal, clock: { last: 0, now: 60_000 }, deferred: { batches: 1, edits: 1 } }).split('\n')
  const at = (head: string) => lines.findIndex(l => l.startsWith(head))
  expect(at('Deferred:')).toBe(at('Cache clock:') + 1)
  expect(at('Helper:')).toBe(at('Deferred:') + 1)
  expect(telemetryText(t)).not.toContain('Deferred:')
})

// [SP_CTX_02_55] [SP_HELP_01_06] ObservePassedCompact and CompactBrief
test('Обхід — бриф: CompactBrief names the deferred edits with the rest; QUEUE_BRIEFED clears them with deferredSince, applyDeferred and coldSince; nextBatch stays', () => {
  const rows = conversation()
  const q: Queue = { ...EMPTY_QUEUE, edits: [sum('c1'), { op: 'summarize', tool_use_id: 'c2', summary: 'DEFERRED_S2', deferred: 'b1' }], nextBatch: 2, deferredSince: { b1: 1 }, applyDeferred: true, coldSince: 9 }
  expect(compactBrief(rows, undefined, q)).toContain('DEFERRED_S2')
  const cleared = briefedQueue(q, EMPTY_QUEUE)!
  expect(cleared.edits).toEqual([])
  expect([cleared.nextBatch, cleared.deferredSince, cleared.applyDeferred, cleared.coldSince]).toEqual([2, undefined, undefined, undefined])
  // a queue with the batch's fields alone is cleared too; an empty one is left
  expect(briefedQueue({ ...EMPTY_QUEUE, applyDeferred: true }, EMPTY_QUEUE)).toEqual({ ...EMPTY_QUEUE })
  expect(briefedQueue({ ...EMPTY_QUEUE, nextBatch: 3 }, EMPTY_QUEUE)).toBeUndefined()
  // WithoutDeferred keeps the edits without `deferred`
  expect(withoutDeferred(q).edits).toEqual([sum('c1')])
})

// [SP_HELP_02_10] the state slot changes only in the batch that applies next (review of phase 4, S1)
test('Постановка — defer над слотом стану: a state op and a rewrite of the slot row are rejected with DEFER_STATE; an edit beside them is queued', () => {
  const rows = conversation()
  const pinned = { ids: new Set<string>(), rows: new Set<number>(), state: 9, items: [] }
  const state = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [{ op: 'state', changes: [{ do: 'add', kind: 'plan', text: 'next' }] }, { op: 'drop', tool_use_id: 'c1' }], defer: true }, pinned)
  if ('deny' in state) throw new Error(state.deny)
  expect(state.errors).toEqual([expect.stringContaining(DEFER_STATE)])
  expect(state.queue.edits).toEqual([{ op: 'drop', tool_use_id: 'c1', deferred: 'b1' }])
  const rewrite = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [{ op: 'rewrite', index: 9, text: 'new state' }], defer: true }, pinned)
  if ('deny' in rewrite) throw new Error(rewrite.deny)
  expect(rewrite.errors).toEqual([expect.stringContaining(DEFER_STATE)])
  // the same edits without defer are queued
  const plain = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [{ op: 'state', changes: [{ do: 'add', kind: 'plan', text: 'next' }] }] }, pinned)
  expect('queue' in plain && plain.queue.edits.length).toBe(1)
})

// [SP_CTX_02_02] DENIED_QUEUE_FULL when every queued edit is deferred (review of phase 4, P2)
test('Черга повна — лише відкладені: the refusal says ending the turn applies none of them; with an own edit queued, the usual advice', () => {
  const rows = conversation()
  const full = Array.from({ length: MAX_QUEUE_EDITS }, (_, i): QueuedEdit => ({ op: 'drop', tool_use_id: `x${i}`, deferred: 'b1' }))
  const out = queueEdits({ ...EMPTY_QUEUE, edits: full }, rows, { edits: [{ op: 'drop', tool_use_id: 'c1' }] })
  expect(out).toEqual({ deny: `the queue would exceed ${MAX_QUEUE_EDITS} edits, all of its edits deferred: ending the turn applies none of them; the person's /compact or a handoff does.` })
  const mixed = queueEdits({ ...EMPTY_QUEUE, edits: [...full.slice(1), { op: 'drop', tool_use_id: 'y' }] }, rows, { edits: [{ op: 'drop', tool_use_id: 'c1' }], defer: true })
  expect(mixed).toEqual({ deny: `the queue would exceed ${MAX_QUEUE_EDITS} edits; end the turn so the current batch applies.` })
})

// [SP_HELP_05_02] I10 against the real QueueTagReplacements (review of phase 4, P3)
test('I10 — заміни тегів поверх відкладеного пакета: the replacement has no `deferred`; b1, deferredSince and nextBatch stay; tagsOnly by NonDeferred', async () => {
  const rows = conversation()
  const tag: Tag = { kind: 'disposable', target: { tool_use_id: 'c2' }, note: 'what c2 said', created_turn: 0 }
  const log: { queue: Queue } = { queue: { ...EMPTY_QUEUE, edits: [sum('c1', 'b1')], nextBatch: 2, deferredSince: { b1: 1 } } }
  const io: TagIO = {
    rows: async () => rows,
    readTags: async () => okRead({ ...EMPTY_REGISTRY, tags: [tag] }),
    writeTags: async () => undefined,
    readQueue: async () => okRead(log.queue),
    writeQueue: async q => void (log.queue = q),
    recalls: async () => [],
  }
  const { queued } = await queueTagReplacements(io)
  expect(queued).toBe(1)
  expect(log.queue.edits.map(e => [e.op, 'tool_use_id' in e ? e.tool_use_id : '', e.deferred, e.via])).toEqual([
    ['summarize', 'c1', 'b1', undefined],
    ['summarize', 'c2', undefined, 'tag'],
  ])
  expect([log.queue.nextBatch, log.queue.deferredSince, log.queue.tagsOnly]).toEqual([2, { b1: 1 }, true])
})
