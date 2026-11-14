import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { handleCompaction, screenPinned } from '../hooks/compaction'
import { dropOwnCalls, editLabel, fingerprint, RECALL_CALL, type QueuedEdit } from '../hooks/edits'
import { addReturns, contextRecall, emptyFolds, foldPort, ledgerWork, levelOf, markDue, parseFolds, pruneRecalls, returnEdit, type FoldEntry, type FoldLedger, type Recall, type RecallIO } from '../hooks/folds'
import { EMPTY_QUEUE, queuedText, queueEdits, type Queue } from '../hooks/queue'
import { foldNote, recalledText, returnedText, SUMMARIZED_OF, TRACE_OPENER } from '../hooks/rows'
import type { Read } from '../hooks/store'
import { contextTag, EMPTY_REGISTRY, queueTagReplacements, type Tag, type TagIO, type TagRegistry } from '../hooks/tags'
import { harness } from './compaction-fixtures'
import { apiOf, memStore, missingRead, okRead, prompt, reg, reply, result, use } from './row-fixtures'

const BIG = 'x'.repeat(5000)
const NO_PINS = { ids: new Set<string>(), rows: new Set<number>() }

function entry(id: string, extra: Partial<FoldEntry> = {}): FoldEntry {
  return { id, archive: '/s/1.json', entry: 0, kind: 'output', call: 'context_edit summarize call', what: 'Read /p/a.md', rows: 2, chars: 5000, turn: 1, ...extra }
}

function recall(id: string, extra: Partial<Recall> = {}): Recall {
  return { fold: 'f1', from: 0, count: 2, tool_use_id: id, depth: 1, scope: 'reading', turn: 2, due: false, ...extra }
}

const RECALLED = `${recalledText('f1', 'Read /p/a.md', 'context_edit summarize call', 1, 'reading')}\n\n#0 assistant:\ncall: Read /p/a.md\n\n#1 user:\nresult: the level`

// A conversation with the record of fold f1 (#2) and a recall of it (#4, #5).
function conversation(): SessionMessage[] {
  return [
    prompt('task', 'h0'),
    use('a', 'Read', 'h1', { file_path: '/p/a.md' }),
    result('a', `${SUMMARIZED_OF}Read /p/a.md you had read here with your own summary${foldNote('f1', '/s/1.json')}: S`, 'h2'),
    reply('I need the level again', 'h3'),
    use('r1', RECALL_CALL, 'h4', { fold: 'f1' }),
    result('r1', RECALLED, 'h5'),
    reply('used it', 'h6'),
    use('b', 'Bash', 'h7', { command: 'ls' }),
    result('b', BIG, 'h8'),
    reply('done', 'h9'),
  ]
}

function ledgerStore(start: FoldLedger) {
  return memStore(okRead(start), emptyFolds, parseFolds)
}

async function apply(rows: readonly SessionMessage[], edits: readonly QueuedEdit[], start: FoldLedger) {
  const { store, log } = ledgerStore(start)
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits: [...edits] }), { readApi: async () => apiOf(rows), folds: foldPort(store) }, okRead(reg({ turn: 5 })))
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  if (log.file.state !== 'ok') throw new Error('no ledger written')
  return { rows: out.messages, written, ledger: log.file.value }
}

function recallResult(rows: readonly SessionMessage[]): string | undefined {
  const id = rows.flatMap(r => r.toolUses).find(u => u.tool === RECALL_CALL)?.tool_use_id
  return rows.flatMap(r => r.toolResults ?? []).find(t => t.tool_use_id === id)?.text
}

function queue(q: Queue, rows: readonly SessionMessage[], edits: unknown[], recalls: readonly Recall[]): Queue {
  const out = queueEdits(q, rows, { edits }, undefined, undefined, false, undefined, [], [], undefined, recalls)
  if ('deny' in out) throw new Error(out.deny)
  if (out.errors.length) throw new Error(out.errors.join('; '))
  return out.queue
}

// [SP_FOLD_05_01] Recall: the parts of one level
test('Recall — перетин частин: a part that overlaps one not yet returned is refused; a part beside it gets its own record', async () => {
  const level = [reply('row 0'), reply('row 1'), reply('row 2'), reply('row 3')]
  const archive = JSON.stringify([{ edit: 'collapse #3..#6', rows: level }])
  let ledger: FoldLedger = { folds: [entry('f1', { kind: 'range', rows: 4 })], nextFold: 2, recalls: [] }
  const live = new Set<string>()
  const io: RecallIO = {
    passedOver: () => false,
    storageDown: async () => undefined,
    storageRefusal: r => r,
    rows: async () => [],
    region: async () => ({ depth: 1, scope: 'reading', turn: 3 }),
    readArchive: async () => archive,
    onLedger: work =>
      work(ledger, async next => {
        ledger = next
      }),
    live: () => live,
    note: id => void live.add(id),
  }
  const first = await contextRecall(io, { fold: 'f1', from: 0, count: 2 }, 'r1')
  expect('result' in first && first.result.includes('#0 assistant:\nrow 0') && first.result.includes('#1 assistant:\nrow 1') && !first.result.includes('row 2')).toBe(true)
  const over = await contextRecall(io, { fold: 'f1', from: 1, count: 2 }, 'r2')
  expect('code' in over && over.code).toBe('ALREADY_RECALLED')
  // the whole level overlaps the part too
  const whole = await contextRecall(io, { fold: 'f1' }, 'r3')
  expect('code' in whole && whole.code).toBe('ALREADY_RECALLED')
  const beside = await contextRecall(io, { fold: 'f1', from: 2, count: 2 }, 'r4')
  expect('result' in beside && beside.result.includes('#3 assistant:\nrow 3')).toBe(true)
  expect(ledger.recalls.map(r => [r.tool_use_id, r.from, r.count, r.depth, r.scope, r.due])).toEqual([['r1', 0, 2, 1, 'reading', false], ['r4', 2, 2, 1, 'reading', false]])
  // the next turn: the pairs never became rows (an interrupted turn, another
  // compaction), so their records go first and the part can be recalled again
  live.clear()
  const again = await contextRecall(io, { fold: 'f1', from: 0, count: 2 }, 'r5')
  expect('result' in again).toBe(true)
  expect(ledger.recalls.map(r => r.tool_use_id)).toEqual(['r5'])
})

// [SP_FOLD_05_01] MarkDue: the depth of the region a recall was made in
test('MarkDue — глибина: a recall made at depth 2 is due once the region of depth 2 closed; one made at depth 1 only after that region closed too', () => {
  const ledger: FoldLedger = { folds: [entry('f1')], nextFold: 2, recalls: [recall('deep', { depth: 2 }), recall('outer', { depth: 1 })] }
  const inner = markDue(ledger, 1)
  expect(inner.recalls.map(r => r.due)).toEqual([true, false])
  const outer = markDue(inner, 0)
  expect(outer.recalls.map(r => r.due)).toEqual([true, true])
  // nothing new to mark: the same ledger, so nothing is written
  expect(markDue(outer, 0)).toBe(outer)
})

// [SP_FOLD_05_01] AddReturns: an accepted edit of the agent after the close
test('AddReturns — агент згортає: after the close an accepted edit brings the return edit with it; the applied pair holds RETURNED, its recall record is gone and the archive got no element for it', async () => {
  const rows = conversation()
  const recalls = [recall('r1', { due: true })]
  const q = queue({ ...EMPTY_QUEUE }, rows, [{ op: 'summarize', tool_use_id: 'b', summary: 'listing' }], recalls)
  expect(q.edits).toEqual([expect.objectContaining({ op: 'summarize', tool_use_id: 'b' }), returnEdit('r1')])
  const text = queuedText(q, 1, [])
  expect(text).toContain('Queued 1 edit(s); 1 pending in total.')
  expect(text).toContain('1 recalled level(s) of closed stages return with this batch')
  const out = await apply(rows, q.edits, { folds: [entry('f1')], nextFold: 2, recalls })
  expect(recallResult(out.rows)).toBe(returnedText('f1', { scope: 'reading' }))
  // the call stays, under a new id
  expect(out.rows.flatMap(r => r.toolUses).some(u => u.tool === RECALL_CALL && u.tool_use_id !== 'r1')).toBe(true)
  expect(out.ledger.recalls).toEqual([])
  expect(out.ledger.folds.map(f => f.id)).toEqual(['f1', 'f2'])
  // the return took no fold number
  expect(out.ledger.nextFold).toBe(3)
  const archive = JSON.parse(out.written.archiveText!) as { edit: string }[]
  expect(archive.map(e => e.edit)).toEqual(['summarize b'])
  // the level of the new fold is its pair alone, found by the archive element's label
  const level = levelOf(out.written.archiveText!, out.ledger.folds[1]!)!
  expect(level.flatMap(r => [...r.toolUses.map(u => u.tool_use_id), ...(r.toolResults ?? []).map(t => t.tool_use_id)])).toEqual(['b', 'b'])
})

// [SP_FOLD_05_01] [SP_FOLD_05_02] AddReturns: a close without an edit or a tag
test('AddReturns — пакета немає / правка повернення не стає в чергу сама: a close without edits or tags marks the recall due and queues nothing', async () => {
  const rows = conversation()
  let ledger: FoldLedger = { folds: [entry('f1')], nextFold: 2, recalls: [recall('r1')] }
  const log: { tags?: TagRegistry; queue?: Queue } = {}
  const io: TagIO = {
    rows: async () => rows,
    readTags: async () => (log.tags ? okRead(log.tags) : missingRead({ ...EMPTY_REGISTRY })),
    writeTags: async r => {
      log.tags = r
    },
    readQueue: async () => (log.queue ? okRead(log.queue) : missingRead({ ...EMPTY_QUEUE })),
    writeQueue: async q => {
      log.queue = q
    },
    markDue: async () => {
      ledger = markDue(ledger, 0)
    },
    recalls: async () => ledger.recalls,
  }
  expect(await contextTag(io, { tags: [{ op: 'open', stage: 'reading', index: 3 }] })).not.toHaveProperty('deny')
  expect(ledger.recalls[0]!.due).toBe(false)
  expect(await contextTag(io, { tags: [{ op: 'close' }] })).not.toHaveProperty('deny')
  expect(ledger.recalls[0]!.due).toBe(true)
  expect(log.queue?.edits ?? []).toEqual([])
  // the pure step: no edit of the agent, no return edit
  expect(addReturns([], rows, ledger.recalls, NO_PINS)).toEqual([])
  expect(addReturns([returnEdit('r1')], rows, ledger.recalls, NO_PINS)).toEqual([])
})

// [SP_FOLD_05_01] AddReturns: the agent's own edit covers the recall pair
test('AddReturns — правка агента охопила пару: a collapse over the pair, in the same call or a later one, leaves no return edit; the archive element holds RETURNED in the place of the level', async () => {
  const rows = conversation()
  const recalls = [recall('r1', { due: true })]
  const collapse = { op: 'collapse', from_index: 3, to_index: 6, summary: 'C' }
  // the same call
  expect(queue({ ...EMPTY_QUEUE }, rows, [collapse], recalls).edits.map(e => e.op)).toEqual(['collapse'])
  // a later call: the return edit queued with the first one leaves
  const first = queue({ ...EMPTY_QUEUE }, rows, [{ op: 'summarize', tool_use_id: 'b', summary: 'listing' }], recalls)
  expect(first.edits.some(e => e.via === 'return')).toBe(true)
  const second = queue(first, rows, [collapse], recalls)
  expect(second.edits.map(e => [e.op, e.via])).toEqual([['summarize', undefined], ['collapse', undefined]])
  const out = await apply(rows, second.edits, { folds: [entry('f1')], nextFold: 2, recalls })
  const archive = JSON.parse(out.written.archiveText!) as { edit: string; rows: SessionMessage[] }[]
  const span = archive.find(e => e.edit.startsWith('collapse'))!
  expect(recallResult(span.rows)).toBe(returnedText('f1', 'edit'))
  expect(JSON.stringify(span.rows).includes('result: the level')).toBe(false)
  expect(out.ledger.recalls).toEqual([])
  expect(out.rows.flatMap(r => r.toolUses).some(u => u.tool === RECALL_CALL)).toBe(false)
})

// [SP_FOLD_05_01] Return: a disposable range tag over the recall pair
test('Повернення — заміна з тегу охопила пару: a disposable tag on the range with the pair gives one collapse at the close, and no return edit beside it', async () => {
  const rows = conversation()
  const range: Tag = { kind: 'disposable', target: { anchor: fingerprint(rows[3]!), hint: 3, toAnchor: fingerprint(rows[6]!), toHint: 6 }, note: 'what the level said', created_turn: 0 }
  const log: { queue?: Queue } = {}
  const tags: Read<TagRegistry> = okRead({ ...EMPTY_REGISTRY, tags: [range] })
  const io: TagIO = {
    rows: async () => rows,
    readTags: async () => tags,
    writeTags: async () => undefined,
    readQueue: async () => (log.queue ? okRead(log.queue) : missingRead({ ...EMPTY_QUEUE })),
    writeQueue: async q => {
      log.queue = q
    },
    recalls: async () => [recall('r1', { due: true })],
  }
  const { queued } = await queueTagReplacements(io)
  expect(queued).toBe(1)
  expect(log.queue!.edits.map(e => [e.op, e.via])).toEqual([['collapse', 'tag']])
  // a tag on the pair itself is its return, with the note
  const pair: Tag = { kind: 'disposable', target: { tool_use_id: 'r1' }, note: 'took KEY from it', created_turn: 0 }
  const own: { queue?: Queue } = {}
  await queueTagReplacements({ ...io, readTags: async () => okRead({ ...EMPTY_REGISTRY, tags: [pair] }), readQueue: async () => missingRead({ ...EMPTY_QUEUE }), writeQueue: async q => void (own.queue = q) })
  expect(own.queue!.edits).toEqual([expect.objectContaining({ op: 'summarize', tool_use_id: 'r1', summary: 'took KEY from it', via: 'return' })])
})

// [SP_FOLD_05_01] DropOwnCalls: which recall pairs stay
test('DropOwnCalls — пари розгортання: a recall pair with a record and one with a RETURNED result stay; a refused recall goes like any own call, and the trace names it', () => {
  const rows = [
    prompt('task'),
    use('r1', RECALL_CALL, undefined, { fold: 'f1' }),
    result('r1', RECALLED),
    use('r2', RECALL_CALL, undefined, { fold: 'f1' }),
    result('r2', returnedText('f1', { scope: 'reading' })),
    use('r3', RECALL_CALL, undefined, { fold: 'f9' }),
    result('r3', 'no fold f9 in the fold ledger (FOLD_UNKNOWN)', undefined, true),
    reply('done'),
  ]
  const kept = dropOwnCalls(rows, new Set(), undefined, undefined, new Set(['r1']))
  expect(kept.flatMap(r => r.toolUses.map(u => u.tool_use_id))).toEqual(['r1', 'r2'])
  const trace = kept.find(r => r.text.startsWith(TRACE_OPENER))
  expect(trace?.text).toBe(`${TRACE_OPENER}; you had called context_recall.`)
  // without the records (a seed) every recall pair goes
  expect(dropOwnCalls(rows).flatMap(r => r.toolUses)).toEqual([])
})

// [SP_FOLD_02_02] [STRUCT-02] the ledger's read-modify-write of a recall
test('Recall — облік не читається: an unreadable ledger is moved aside and the work starts from an empty one; one that cannot be moved fails the call', async () => {
  const bad = memStore<FoldLedger>({ state: 'unreadable', reason: 'bad json' }, emptyFolds, parseFolds)
  const seen = await ledgerWork(bad.store)(async (ledger, write) => {
    await write({ ...ledger, nextFold: 5 })
    return ledger
  })
  expect(seen).toEqual(emptyFolds())
  expect(bad.log.quarantined).toBe(1)
  expect(bad.log.file).toEqual(okRead({ ...emptyFolds(), nextFold: 5 }))
  const stuck = memStore<FoldLedger>({ state: 'unreadable', reason: 'bad json' }, emptyFolds, parseFolds)
  stuck.log.stuck = true
  let failed = ''
  await ledgerWork(stuck.store)(async () => undefined).catch(err => void (failed = String(err)))
  expect(failed).toContain('nor moved aside')
  // PruneRecalls: a record stays while its pair is a row or its call is live
  const l: FoldLedger = { folds: [entry('f1')], nextFold: 2, recalls: [recall('r1'), recall('gone'), recall('now')] }
  expect(pruneRecalls(l, conversation(), new Set(['now'])).recalls.map(r => r.tool_use_id)).toEqual(['r1', 'now'])
  expect(pruneRecalls({ ...l, recalls: [recall('r1')] }, conversation())).toEqual({ ...l, recalls: [recall('r1')] })
})

// [SP_FOLD_02_03] the label of a return edit, and a pin on the recall pair
test('Повернення — мітка й пін: a failed return edit is named "return of fold <id>"; the mod\'s own return of a pinned pair is skipped without a failure, the agent\'s is refused', () => {
  const rows = conversation()
  expect(editLabel(rows, returnEdit('r1'))).toBe('return of fold f1')
  expect(editLabel(rows, { op: 'summarize', tool_use_id: 'b', summary: 'S' })).toBe('summarize b')
  // a pair that holds no recall keeps the plain name
  expect(editLabel(rows, returnEdit('b'))).toBe('summarize b')
  const pin: Tag = { kind: 'pin', target: { tool_use_id: 'r1' }, created_turn: 0 }
  const tags = okRead({ ...EMPTY_REGISTRY, tags: [pin] })
  const drop: QueuedEdit = { op: 'drop', tool_use_id: 'b' }
  expect(screenPinned(rows, [drop, returnEdit('r1')], tags)).toEqual({ edits: [drop], refused: [] })
  const mine: QueuedEdit = { op: 'summarize', tool_use_id: 'r1', summary: 'took KEY', via: 'return' }
  const out = screenPinned(rows, [mine], tags)
  expect(out.edits).toEqual([])
  expect(out.refused.length).toBe(1)
  expect(out.refused[0]!.startsWith('return of fold f1: ')).toBe(true)
  // the queue's bound counts the agent's edits only: own returns give way
  const full: Queue = { ...EMPTY_QUEUE, edits: [...Array.from({ length: 199 }, (): QueuedEdit => ({ op: 'drop', tool_use_id: 'a' })), returnEdit('r1')] }
  const more = queueEdits(full, rows, { edits: [{ op: 'drop', tool_use_id: 'b' }] }, undefined, undefined, false, undefined, [], [], undefined, [recall('r1', { due: true })])
  expect('queue' in more && more.queue.edits.length).toBe(200)
  expect('queue' in more && more.queue.edits.some(e => e.via === 'return')).toBe(false)
})
