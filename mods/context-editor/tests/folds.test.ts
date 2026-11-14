import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { handleCompaction } from '../hooks/compaction'
import { prepare, type QueuedEdit } from '../hooks/edits'
import { assignFoldIds, BAD_FOLDS, emptyFolds, foldFloor, foldPort, FOLDS_UNSAVED, foldsList, MAX_FOLDS, parseFolds, recordFolds, type FoldEntry, type FoldLedger, type FoldPort } from '../hooks/folds'
import { EMPTY_QUEUE, parseQueue, queueEdits, type Queue } from '../hooks/queue'
import { foldNote, foldNumbers, foldOfRecord, REWRITTEN, SUMMARIZED_OF } from '../hooks/rows'
import { closedSpan, contextList, markBefore, type ListIO } from '../hooks/stages'
import type { Read } from '../hooks/store'
import { harness } from './compaction-fixtures'
import { apiOf, memStore, okRead, prompt, reg, reply, result, unreadableRead, use } from './row-fixtures'

const BIG = 'x'.repeat(5000)

function conversation(): SessionMessage[] {
  return [
    prompt('task', 'h0'),
    use('a', 'Read', 'h1', { file_path: '/p/a.md' }),
    result('a', BIG, 'h2'),
    reply('thinking about it', 'h3'),
    use('b', 'Bash', 'h4', { command: 'ls' }),
    result('b', BIG, 'h5'),
    reply('more thinking', 'h6'),
    use('c', 'Bash', 'h7', { command: 'pwd' }),
    result('c', BIG, 'h8'),
    reply('done', 'h9'),
  ]
}

function batch(rows: readonly SessionMessage[], edits: readonly unknown[]): Read<Queue> {
  return okRead({ ...EMPTY_QUEUE, edits: prepare(rows, edits).queued })
}

function ledgerStore(start: Read<FoldLedger> = { state: 'missing', value: emptyFolds() }) {
  return memStore(start, emptyFolds, parseFolds)
}

async function apply(rows: readonly SessionMessage[], queue: Read<Queue>, folds: FoldPort, over: Parameters<typeof harness>[1] = {}) {
  const { io, written } = harness(queue, { readApi: async () => apiOf(rows), folds, ...over }, okRead(reg({ turn: 5 })))
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  return { rows: out.messages, written }
}

function texts(rows: readonly SessionMessage[]): string[] {
  return rows.flatMap(r => [r.text, ...(r.toolResults ?? []).map(t => t.text)]).filter(Boolean)
}

function entry(id: string, extra: Partial<FoldEntry> = {}): FoldEntry {
  return { id, archive: '/s/1.json', entry: 0, kind: 'output', call: 'context_edit summarize call', what: 'Read a.md', rows: 2, chars: 10, turn: 1, ...extra }
}

// [SP_FOLD_05_01] RecordFolds: a batch with two folds, and edits without a record
test('RecordFolds — пакет із двома згортками: each record carries FOLD_NOTE with its id; the entries name the archive and the place in originals, which counts the drop too', async () => {
  const rows = conversation()
  const { store, log } = ledgerStore()
  const out = await apply(rows, batch(rows, [{ op: 'summarize', tool_use_id: 'a', summary: 'S' }, { op: 'collapse', from_index: 3, to_index: 6, summary: 'C' }, { op: 'drop', tool_use_id: 'c' }]), foldPort(store))
  const all = texts(out.rows)
  expect(all.some(t => t.startsWith(`${SUMMARIZED_OF}Read /p/a.md you had read here with your own summary${foldNote('f1', '/s/1000.json')}: S`))).toBe(true)
  expect(all.some(t => t.includes(`${foldNote('f2', '/s/1000.json')}: C`))).toBe(true)
  expect(all.some(t => t.includes('open with Read'))).toBe(false)
  if (log.file.state !== 'ok') throw new Error('no ledger written')
  const ledger = log.file.value
  expect(ledger.nextFold).toBe(3)
  expect(ledger.recalls).toEqual([])
  const archive = JSON.parse(out.written.archiveText!) as { edit: string; rows: SessionMessage[] }[]
  expect(archive.length).toBe(3)
  expect(ledger.folds.map(f => f.id)).toEqual(['f1', 'f2'])
  const [f1, f2] = ledger.folds as [FoldEntry, FoldEntry]
  expect(f1).toEqual({ id: 'f1', archive: '/s/1000.json', entry: f1.entry, kind: 'output', call: 'context_edit summarize call', what: 'Read /p/a.md', rows: 2, chars: f1.chars, turn: 5 })
  expect(archive[f1.entry]!.rows.map(r => r.handle)).toEqual(['h1', 'h2'])
  expect(f1.chars).toBeGreaterThan(4999)
  expect(f2.kind).toBe('range')
  expect(f2.call).toBe('context_edit collapse call')
  expect(f2.rows).toBe(4)
  expect(archive[f2.entry]!.rows.map(r => r.handle)).toEqual(['h3', 'h4', 'h5', 'h6'])
  expect(f2.region).toBeUndefined()
  expect(f2.what.length).toBeGreaterThan(0)
})

// [SP_FOLD_05_01] RecordFolds: a fold over folds
test('RecordFolds — згортка поверх згортки: the folds whose records a later collapse replaced get it as parent, once', async () => {
  const rows = conversation()
  const { store, log } = ledgerStore()
  const first = await apply(rows, batch(rows, [{ op: 'summarize', tool_use_id: 'a', summary: 'S' }, { op: 'collapse', from_index: 3, to_index: 6, summary: 'C' }]), foldPort(store))
  const last = first.rows.findIndex(r => (r.toolResults ?? []).some(t => t.text.includes('(fold f2;')))
  const second = await apply(first.rows, batch(first.rows, [{ op: 'collapse', from_index: 1, to_index: last, summary: 'both' }]), foldPort(store))
  if (log.file.state !== 'ok') throw new Error('no ledger written')
  expect(log.file.value.folds.map(f => [f.id, f.parent])).toEqual([['f1', 'f3'], ['f2', 'f3'], ['f3', undefined]])
  // a later fold over f3 leaves the parents of f1 and f2 as they are
  const at = second.rows.findIndex(r => (r.toolResults ?? []).some(t => t.text.includes('(fold f3;')) || r.text.includes('(fold f3;'))
  const from = second.rows[at]!.role === 'user' && (second.rows[at]!.toolResults ?? []).length ? at - 1 : at
  await apply(second.rows, batch(second.rows, [{ op: 'collapse', from_index: from, to_index: at, summary: 'again' }]), foldPort(store))
  expect(log.file.value.folds.map(f => [f.id, f.parent])).toEqual([['f1', 'f3'], ['f2', 'f3'], ['f3', 'f4'], ['f4', undefined]])
})

// [SP_FOLD_05_01] [SP_FOLD_05_02] [SP_FOLD_05_04] the lower bound of a number
test('RecordFolds — нижня межа номера: a number never repeats one a record in the conversation carries, with the ledger empty, behind, or unreadable and moved aside', async () => {
  const rows = [...conversation(), reply(`${SUMMARIZED_OF}Read x you had read here with your own summary${foldNote('f7', '/old/1.json')}: kept`)]
  expect(foldFloor(rows)).toBe(8)
  expect(foldNumbers(`a (fold f3; original: /x; b) (fold f12; original: /y; c) (fold f03; original: /z`)).toEqual([3, 12])
  expect(foldOfRecord(`I quote (fold f9; original: /x; …`)).toBeUndefined()
  // a look-alike with a number no fold can have is no number: two edits of a batch never share an id
  const huge = [...rows, reply('grep found (fold f9007199254740993; original: /x; …')]
  expect(foldFloor(huge)).toBe(8)
  const two = prepare(huge, [{ op: 'summarize', tool_use_id: 'a', summary: 'S' }, { op: 'summarize', tool_use_id: 'b', summary: 'T' }]).queued
  expect([...assignFoldIds(two, huge, undefined).ids.values()]).toEqual(['f8', 'f9'])
  // the record's own note counts, not one quoted in its source, in the agent's words or in a row without a note
  expect(foldOfRecord(`${SUMMARIZED_OF}Bash "grep ' (fold f3; original: ' x" you had read here with your own summary${foldNote('f5', '/s/1.json')}: about (fold f4; original: /y; …`)).toBe(5)
  expect(foldOfRecord(`${SUMMARIZED_OF}Bash "grep ' (fold f3; original: ' x" you had read here with your own summary (original: /s/1.json, open with Read): S`)).toBeUndefined()
  expect(foldOfRecord(`${REWRITTEN} (original: /s/1.json, open with Read): I quote with your own summary (fold f2; original: /x; …`)).toBeUndefined()
  const edits = prepare(rows, [{ op: 'summarize', tool_use_id: 'a', summary: 'S' }]).queued
  expect([...assignFoldIds(edits, rows, undefined).ids.values()]).toEqual(['f8'])
  expect([...assignFoldIds(edits, rows, emptyFolds()).ids.values()]).toEqual(['f8'])
  expect([...assignFoldIds(edits, rows, { ...emptyFolds(), nextFold: 4 }).ids.values()]).toEqual(['f8'])
  expect([...assignFoldIds(edits, rows, { ...emptyFolds(), nextFold: 20 }).ids.values()]).toEqual(['f20'])
  const { store, log } = ledgerStore(unreadableRead())
  const out = await apply(rows, okRead({ ...EMPTY_QUEUE, edits }), foldPort(store))
  expect(texts(out.rows).some(t => t.includes('(fold f8; original: /s/1000.json;'))).toBe(true)
  expect(log.quarantined).toBe(1)
  if (log.file.state !== 'ok') throw new Error('no ledger written')
  expect(log.file.value.folds.map(f => f.id)).toEqual(['f8'])
  expect(log.file.value.nextFold).toBe(9)
})

// [SP_FOLD_05_01] RecordFolds: an edit that fails keeps its number
test('RecordFolds — невдала правка: the number of a fold edit that did not apply is skipped, the next one has its own', async () => {
  const rows = conversation()
  const edits: QueuedEdit[] = [{ op: 'summarize', tool_use_id: 'a', summary: 'S' }, { op: 'summarize', tool_use_id: 'gone', summary: 'G' }, { op: 'summarize', tool_use_id: 'c', summary: 'T' }]
  const { store, log } = ledgerStore()
  const out = await apply(rows, okRead({ ...EMPTY_QUEUE, edits }), foldPort(store))
  expect(out.written.queue!.report).toContain('call or result not found')
  if (log.file.state !== 'ok') throw new Error('no ledger written')
  expect(log.file.value.folds.map(f => f.id)).toEqual(['f1', 'f3'])
  expect(log.file.value.nextFold).toBe(4)
  expect(texts(out.rows).some(t => t.includes('(fold f2;'))).toBe(false)
})

// [SP_FOLD_02_01] FOLDS_UNSAVED and the put back (CONC-02)
test('RecordFolds — облік не записався або застосування перервано: the apply stands with FOLD_NOTE and the report says so; an abandon after the write puts the ledger back as read', async () => {
  const rows = conversation()
  const queue = batch(rows, [{ op: 'summarize', tool_use_id: 'a', summary: 'S' }])
  const debug: string[] = []
  const failing: FoldPort = { read: async () => ({ state: 'missing', value: emptyFolds() }), record: async () => Promise.reject(new Error('disk full')), putBack: async () => undefined }
  const out = await apply(rows, queue, failing, { debug: t => void debug.push(t) })
  expect(texts(out.rows).some(t => t.includes('(fold f1;'))).toBe(true)
  expect(out.written.queue!.report).toContain(FOLDS_UNSAVED)
  expect(debug).toEqual(['context-editor: RecordFolds failed: disk full'])

  // the ids were assigned without the ledger (its first read failed), and the ledger read at the commit already gave them out
  const taken: FoldLedger = { folds: [entry('f1'), entry('f2')], nextFold: 3, recalls: [] }
  const held = ledgerStore(okRead(taken))
  const port = foldPort(held.store)
  const clash = await apply(rows, queue, { ...port, read: async () => unreadableRead('EIO') })
  expect(texts(clash.rows).some(t => t.includes('(fold f1;'))).toBe(true)
  expect(clash.written.queue!.report).toContain(FOLDS_UNSAVED)
  expect(held.log.file).toEqual(okRead(taken))
  expect(held.log.writes).toBe(0)

  // abandoned once the ledger is written: nothing stays
  const before: FoldLedger = { folds: [entry('f1')], nextFold: 2, recalls: [] }
  const { store, log } = ledgerStore(okRead(before))
  let aborted = false
  const writing = foldPort(store)
  const { io, written } = harness(queue, {
    readApi: async () => apiOf(rows),
    isAborted: () => aborted,
    folds: {
      ...writing,
      record: async (change, held) => {
        const was = await writing.record(change, held)
        aborted = true
        return was
      },
    },
  })
  expect(await handleCompaction(io, rows)).toEqual({ skip: 'context-editor: compaction abandoned; the batch stays queued' })
  expect(written.queue).toBeUndefined()
  expect(log.writes).toBe(2)
  expect(log.file).toEqual(okRead(before))
})

// [SP_FOLD_01_01] region
test('region — згортка всього закритого блоку з назвою: the queued collapse carries the stage, its entry names it; another span or a block without a name gives none', () => {
  const rows = conversation()
  const closed = { name: 'reading', after: markBefore(rows, 3), end: markBefore(rows, 7), turn: 1 }
  const span = closedSpan(rows, okRead({ lastClosed: closed }))
  expect(span).toEqual({ name: 'reading', from: 3, to: 6 })
  expect(closedSpan(rows, okRead({ lastClosed: { ...closed, name: undefined } }))).toBeUndefined()
  expect(closedSpan(rows, okRead({}))).toBeUndefined()
  expect(closedSpan(rows, unreadableRead())).toBeUndefined()
  const queue = (edit: unknown) => {
    const out = queueEdits({ ...EMPTY_QUEUE }, rows, { edits: [edit] }, undefined, undefined, false, undefined, [], [], span)
    if ('deny' in out) throw new Error(out.deny)
    return out.queue.edits[0]!
  }
  const whole = queue({ op: 'collapse', from_index: 3, to_index: 6, summary: 'C' })
  expect(whole.region).toEqual({ name: 'reading', kind: 'stage' })
  expect(queue({ op: 'collapse', from_index: 4, to_index: 6, summary: 'C' }).region).toBeUndefined()
  expect(queue({ op: 'summarize', tool_use_id: 'a', summary: 'S' }).region).toBeUndefined()
  // the queue file keeps it; on another op it makes the file unreadable
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [whole] })).state).toBe('ok')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'S', region: { name: 'x', kind: 'stage' } }] })).state).toBe('unreadable')
  const ledger = recordFolds(emptyFolds(), [{ id: 'f1', entry: 0, edit: whole, what: 'a list' }], [{ edit: 'collapse', rows: rows.slice(3, 7) }], 2, '/s/1.json', 3, 1e6)
  expect(ledger.folds[0]).toEqual(expect.objectContaining({ what: 'stage "reading"', region: { name: 'reading', kind: 'stage' }, kind: 'range', rows: 4, turn: 3 }))
})

// [SP_FOLD_01_02] [SP_FOLD_05_02] the ledger file
test('FoldLedger — розбір і межа: a broken invariant makes the file unreadable; above MAX_FOLDS the oldest entry goes with its recalls', () => {
  const ok: FoldLedger = { folds: [entry('f1', { parent: 'f2' }), entry('f2')], nextFold: 3, recalls: [] }
  expect(parseFolds(JSON.stringify(ok))).toEqual(okRead(ok))
  for (const bad of [
    { ...ok, nextFold: 2 },
    { ...ok, folds: [entry('f1'), entry('f1')] },
    { ...ok, folds: [entry('f01')] },
    { ...ok, folds: [entry('f1'), entry('f2', { parent: 'f5' })] },
    { ...ok, folds: [entry('f1', { parent: 'f1' })] },
    { ...ok, folds: [entry('f1234567890')], nextFold: 1234567891 },
    { ...ok, folds: [entry('f1', { region: { name: 'x', kind: 'stage' } })] },
    { ...ok, recalls: [{ fold: 'f9', from: 0, count: 1, tool_use_id: 't', depth: 0, scope: '', turn: 1, due: false }] },
    { folds: [], nextFold: 1 },
  ])
    expect(parseFolds(JSON.stringify(bad)).state).toBe('unreadable')
  const full: FoldLedger = {
    folds: Array.from({ length: MAX_FOLDS }, (_, i) => entry(`f${i + 1}`)),
    nextFold: MAX_FOLDS + 1,
    recalls: [{ fold: 'f1', from: 0, count: 1, tool_use_id: 't', depth: 0, scope: '', turn: 1, due: false }],
  }
  const edit: QueuedEdit = { op: 'summarize', tool_use_id: 'a', summary: 'S' }
  const next = recordFolds(full, [{ id: `f${MAX_FOLDS + 1}`, entry: 0, edit, what: 'Read a.md' }], [{ edit: 'summarize a', rows: conversation().slice(1, 3) }], MAX_FOLDS + 2, '/s/2.json', 9, 1e9)
  expect(next.folds.length).toBe(MAX_FOLDS)
  expect(next.folds[0]!.id).toBe('f2')
  expect(next.folds.at(-1)!.id).toBe(`f${MAX_FOLDS + 1}`)
  expect(next.recalls).toEqual([])
  expect(next.nextFold).toBe(MAX_FOLDS + 2)
})

// [SP_FOLD_02_07] the list of folds
test('Перелік — folds: newest first with the parent and the card mark; from and count page it; any other parameter is BAD_FOLDS', async () => {
  const ledger: FoldLedger = {
    folds: [entry('f1', { parent: 'f3' }), entry('f2', { kind: 'media', what: 'media of a user row', rows: 1 }), entry('f3', { kind: 'range', what: 'task "T"', region: { name: 'T', kind: 'task' }, rows: 12, chars: 23_400, turn: 4 })],
    nextFold: 4,
    recalls: [],
  }
  expect(foldsList(okRead(ledger), undefined, undefined).split('\n')).toEqual([
    'Folds: 3, newest first; showing 1..3. Each line: id, kind, what was folded, the turn it was applied after, its level\'s rows and chars.',
    'f3 range: task "T" · after turn 4 · 12 row(s), 23k chars · card',
    'f2 media: media of a user row · after turn 1 · 1 row(s), 10 chars',
    'f1 output: Read a.md · after turn 1 · 2 row(s), 10 chars · inside f3',
  ])
  expect(foldsList(okRead(ledger), 1, 1).split('\n').slice(1)).toEqual(['f2 media: media of a user row · after turn 1 · 1 row(s), 10 chars'])
  expect(foldsList(okRead(emptyFolds()), undefined, undefined)).toBe('Folds: none recorded in this session.')
  expect(foldsList(unreadableRead('bad fold 1'), undefined, undefined)).toContain('cannot be read (bad fold 1)')
  const io = { storage: async () => '/s', folds: async () => okRead(ledger) } as unknown as ListIO
  const listed = await contextList(io, { folds: true, from: 2 })
  expect('result' in listed && listed.result.split('\n').length).toBe(2)
  for (const args of [{ folds: true, index: 1 }, { folds: true, full: true }, { folds: true, rules: true }, { folds: 'yes' }]) expect(await contextList(io, args)).toEqual({ deny: BAD_FOLDS })
})

// [SP_FOLD_01_01] `call` and `what` by the kind of the edit
test('FoldEntry — заміна з тегу і опис медіа: a tag\'s replacement is a fold named by its call; a describe names what it replaced on the row', async () => {
  const rows = conversation()
  const { store, log } = ledgerStore()
  const tagged: QueuedEdit = { op: 'summarize', tool_use_id: 'a', summary: 'S', via: 'tag' }
  const out = await apply(rows, okRead({ ...EMPTY_QUEUE, edits: [tagged] }), foldPort(store))
  expect(texts(out.rows).some(t => t.includes(` with your own note${foldNote('f1', '/s/1000.json')}: S`))).toBe(true)
  if (log.file.state !== 'ok') throw new Error('no ledger written')
  expect(log.file.value.folds[0]).toEqual(expect.objectContaining({ id: 'f1', kind: 'output', call: 'context_tag disposable tag' }))
  const describe: QueuedEdit = { op: 'describe', index: 0, description: 'D', anchors: ['x'] }
  const made = recordFolds(emptyFolds(), [{ id: 'f1', entry: 0, edit: describe, what: 'pasted text' }], [{ edit: 'describe #0', rows: rows.slice(0, 1) }], 2, '/s/1.json', 1, 1e6)
  expect(made.folds[0]).toEqual(expect.objectContaining({ kind: 'media', call: 'context_edit describe call', what: 'pasted text of a user row', rows: 1 }))
})
