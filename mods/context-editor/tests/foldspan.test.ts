import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { handleCompaction } from '../hooks/compaction'
import { applyEdits, BAD_KEEP, fingerprint, HEAD_ROW, KEEP_SPLITS_PAIR, KEPT_GONE, NO_PINS, NOTHING_TO_FOLD, prepare, REWRITTEN, type Pinned } from '../hooks/edits'
import { buildSeed, carryRegistries } from '../hooks/handoff'
import { EMPTY_QUEUE } from '../hooks/queue'
import { pinnedTargets, type TagRegistry } from '../hooks/tags'
import { harness } from './compaction-fixtures'
import { apiOf, okRead, prompt, reg, reply, result, use } from './row-fixtures'

// [SP_FOLD_02_04] [SP_FOLD_05_01] FoldSpan: a collapse over the person's
// words, around pins, the state slot and `keep`.

function conversation(): SessionMessage[] {
  return [
    prompt('task', 'h0'),
    reply('plan', 'h1'),
    prompt('use tabs, never spaces', 'h2'),
    use('a', 'Read', 'h3', { file_path: '/p/a.md' }),
    result('a', 'out a', 'h4'),
    reply('note to keep', 'h5'),
    prompt('and keep the old API', 'h6'),
    reply('done', 'h7'),
  ]
}

function pins(extra: Partial<Pinned> = {}): Pinned {
  return { ...NO_PINS, ...extra }
}

function run(rows: readonly SessionMessage[], edit: unknown, pinned: Pinned = NO_PINS) {
  const prepared = prepare(rows, [edit], undefined, pinned)
  const applied = applyEdits(rows, prepared.queued, '/s/1.json', new Map(), new Set(), { pinned, newId: id => `${id}_n` })
  return { errors: prepared.errors, ...applied }
}

// What a row that stays keeps: its role, text, calls and results (its handle
// may go, as for any row of a rebuilt stretch, [SP_CTX_02_04]).
const shape = (r: SessionMessage) => ({ role: r.role, text: r.text, calls: r.toolUses.map(u => [u.tool_use_id, u.tool, u.input]), results: (r.toolResults ?? []).map(t => [t.tool_use_id, t.text, t.isError]) })
const shapes = (rows: readonly SessionMessage[]) => rows.map(shape)

const isRecord = (r: SessionMessage) => r.text.startsWith('Later, your context_edit collapse call') || (r.toolResults ?? []).some(t => t.text.startsWith('Later, your context_edit collapse call'))

test("FoldSpan — слова людини: a collapse over the person's row without keep is accepted; the record is the assistant's; its list names one message of the person", () => {
  const rows = conversation()
  const out = run(rows, { op: 'collapse', from_index: 1, to_index: 2, summary: 'plan; the person wants tabs' })
  expect(out.errors).toEqual([])
  expect(out.report.applied).toEqual(['collapse #1..#2'])
  expect(out.rows[1]!.role).toBe('assistant')
  expect(out.rows[1]!.text).toContain("1 of the person's messages")
  expect(out.rows.some(r => r.text === 'use tabs, never spaces')).toBe(false)
  // the person's row lies in the archive
  expect(out.report.originals[0]!.rows.map(r => r.text)).toEqual(['plan', 'use tabs, never spaces'])
})

test("FoldSpan — проміжок із промпту / запис згортки діапазону не є рядком людини: a span that starts with the person's row or with the assistant's gives one assistant text row", () => {
  const rows = conversation()
  for (const [from, to] of [[6, 7], [5, 6]] as const) {
    const out = run(rows, { op: 'collapse', from_index: from, to_index: to, summary: 's' })
    expect(out.errors).toEqual([])
    const records = out.rows.filter(isRecord)
    expect(records.length).toBe(1)
    expect(records[0]!.role).toBe('assistant')
    expect(records[0]!.toolUses).toEqual([])
    expect(out.rows.length).toBe(rows.length - 1)
  }
  // with a foreign call among the folded rows the record is a carrier pair: its text is a tool result, never a prompt
  const pair = run(rows, { op: 'collapse', from_index: 2, to_index: 4, summary: 's' })
  expect(pair.rows[2]!.role).toBe('assistant')
  expect(pair.rows[2]!.toolUses.length).toBe(1)
  expect(pair.rows[3]!.text).toBe('')
  expect(pair.rows[3]!.toolResults![0]!.text).toContain("1 of the person's messages")
})

test('FoldSpan — `keep`: the kept row of the person stands right after the record, verbatim', () => {
  const rows = conversation()
  const out = run(rows, { op: 'collapse', from_index: 1, to_index: 5, summary: 's', keep: [2] })
  expect(out.errors).toEqual([])
  expect(out.rows.map(isRecord)).toEqual([false, false, true, false, false, false])
  expect(shapes(out.rows.slice(3))).toEqual(shapes([rows[2]!, rows[6]!, rows[7]!]))
  expect(out.report.originals[0]!.rows.map(r => r.handle)).toEqual(['h1', 'h3', 'h4', 'h5'])
  expect([...out.kept.values()]).toEqual([[2]])
})

test('FoldSpan — пін і слот стану / обійдені рядки зберігають текст, виклики й результати: both stay after the record in their order; no refusal', () => {
  const rows = conversation()
  // the pair `a` is pinned, row 5 holds the state slot
  const pinned = pins({ ids: new Set(['a']), state: 5 })
  const out = run(rows, { op: 'collapse', from_index: 1, to_index: 6, summary: 's' }, pinned)
  expect(out.errors).toEqual([])
  expect(out.report.failed).toEqual([])
  expect(out.rows.length).toBe(6)
  expect(isRecord(out.rows[1]!)).toBe(true)
  expect(out.rows[1]!.role).toBe('assistant')
  expect(shapes([out.rows[0]!, ...out.rows.slice(2)])).toEqual(shapes([rows[0]!, rows[3]!, rows[4]!, rows[5]!, rows[7]!]))
  expect(out.report.originals[0]!.rows.map(r => r.handle)).toEqual(['h1', 'h2', 'h6'])
})

test('FoldSpan — пін на рядку: a pinned text row before the folded rows stays before the record, one after them stays after it', () => {
  const rows = conversation()
  const out = run(rows, { op: 'collapse', from_index: 1, to_index: 5, summary: 's' }, pins({ rows: new Set([1, 5]) }))
  expect(out.errors).toEqual([])
  expect(out.rows.map(isRecord)).toEqual([false, false, false, true, false, false, false])
  expect(out.rows[2]!.toolUses.length).toBe(1)
  expect(shapes([out.rows[1]!, ...out.rows.slice(4)])).toEqual(shapes([rows[1]!, rows[5]!, rows[6]!, rows[7]!]))
})

test('FoldSpan — початок розмови: a span from row 0 without keep is HEAD_ROW; with keep on row 0 it is accepted', () => {
  const rows = conversation()
  expect(prepare(rows, [{ op: 'collapse', from_index: 0, to_index: 1, summary: 's' }]).errors).toEqual([`collapse #0..#1: ${HEAD_ROW}`])
  const out = run(rows, { op: 'collapse', from_index: 0, to_index: 2, summary: 's', keep: [0] })
  expect(out.errors).toEqual([])
  expect(shape(out.rows[0]!)).toEqual(shape(rows[0]!))
  expect(out.rows[1]!.role).toBe('assistant')
  expect(out.rows.length).toBe(rows.length - 1)
})

test('FoldSpan — закріплена пара в спільному рядку: a row with two calls, one of them pinned, stays whole with its result row', () => {
  const calls: SessionMessage = { role: 'assistant', text: '', toolUses: [...use('a').toolUses, ...use('b', 'Bash').toolUses], handle: 'c' }
  const results: SessionMessage = { role: 'user', text: '', toolUses: [], toolResults: [...result('a').toolResults!, ...result('b').toolResults!], handle: 'r' }
  const rows = [prompt('task', 'h0'), reply('one', 'h1'), calls, results, reply('two', 'h4')]
  const out = run(rows, { op: 'collapse', from_index: 1, to_index: 4, summary: 's' }, pins({ ids: new Set(['a']) }))
  expect(out.errors).toEqual([])
  expect(out.rows.length).toBe(4)
  expect(isRecord(out.rows[1]!)).toBe(true)
  expect(shapes(out.rows.slice(2))).toEqual(shapes([calls, results]))
  // the shape MergeCallRows leaves: one call row, a result row per call
  const apart = [prompt('task', 'h0'), reply('one', 'h1'), calls, result('a', 'out a', 'ra'), result('b', 'out b', 'rb'), reply('two', 'h5')]
  const wide = run(apart, { op: 'collapse', from_index: 1, to_index: 5, summary: 's' }, pins({ ids: new Set(['a']) }))
  expect(wide.errors).toEqual([])
  expect(wide.rows.map(isRecord)).toEqual([false, true, false, false, false])
  expect(shapes(wide.rows.slice(2))).toEqual(shapes([calls, apart[3]!, apart[4]!]))
})

test('FoldSpan — відмови: keep on a row that is not the person\'s is BAD_KEEP; a bypass that parts a pair is KEEP_SPLITS_PAIR; nothing left to fold is NOTHING_TO_FOLD', () => {
  const rows = conversation()
  const refusal = (edit: unknown, pinned: Pinned = NO_PINS) => prepare(rows, [edit], undefined, pinned).errors
  expect(refusal({ op: 'collapse', from_index: 1, to_index: 5, summary: 's', keep: [1] })).toEqual([`collapse #1..#5: ${BAD_KEEP}`])
  expect(refusal({ op: 'collapse', from_index: 1, to_index: 5, summary: 's', keep: [6] })).toEqual([`collapse #1..#5: ${BAD_KEEP}`])
  expect(refusal({ op: 'collapse', from_index: 1, to_index: 5, summary: 's', keep: 'all' })).toEqual([`edit 1: ${BAD_KEEP}`])
  // the call row is pinned by index, its result row is not: the pair would part
  expect(refusal({ op: 'collapse', from_index: 1, to_index: 5, summary: 's' }, pins({ rows: new Set([3]) }))).toEqual([`collapse #1..#5: ${KEEP_SPLITS_PAIR}`])
  expect(refusal({ op: 'collapse', from_index: 5, to_index: 6, summary: 's', keep: [6] }, pins({ state: 5 }))).toEqual([`collapse #5..#6: ${NOTHING_TO_FOLD}`])
  // the record would stand between a kept call and its kept result
  const split = [prompt('task'), use('a'), use('b', 'Bash'), result('a'), result('b'), reply('end')]
  expect(prepare(split, [{ op: 'collapse', from_index: 1, to_index: 5, summary: 's' }], undefined, pins({ ids: new Set(['a']) })).errors).toEqual([`collapse #1..#5: ${KEEP_SPLITS_PAIR}`])
})

// [SP_FOLD_02_04] a step on a row the collapse goes around runs before it
test('FoldSpan — правка обійденого рядка в тому самому пакеті: a rewrite of the state slot inside the span applies with the collapse around it; two collapses over one span still overlap', () => {
  const rows = conversation()
  const pinned = pins({ state: 5 })
  const prepared = prepare(
    rows,
    [
      { op: 'collapse', from_index: 1, to_index: 6, summary: 's' },
      { op: 'rewrite', index: 5, text: 'state: step 2' },
    ],
    undefined,
    pinned,
  )
  expect(prepared.errors).toEqual([])
  const out = applyEdits(rows, prepared.queued, '/s/1.json', new Map(), new Set(), { pinned, newId: id => `${id}_n` })
  expect(out.report.failed).toEqual([])
  expect([...out.report.applied].sort()).toEqual(['collapse #1..#6', 'rewrite #5'])
  // the record (a carrier pair), then the slot's row as the rewrite left it
  expect(out.rows.map(isRecord)).toEqual([false, false, true, false, false])
  expect(out.rows[3]!.text.startsWith(REWRITTEN)).toBe(true)
  expect(out.rows[3]!.text.endsWith('state: step 2')).toBe(true)
  expect(out.rows[4]!.text).toBe('done')
  const twice = prepare(rows, [{ op: 'collapse', from_index: 1, to_index: 6, summary: 's', keep: [2] }, { op: 'collapse', from_index: 2, to_index: 2, summary: 't' }])
  const both = applyEdits(rows, twice.queued, '/s/1.json', new Map(), new Set(), { newId: id => `${id}_n` })
  expect(both.report.applied.length).toBe(1)
  expect(both.report.failed.length).toBe(1)
  expect(both.report.failed[0]).toContain('overlaps another edit')
})

test('FoldSpan — `keep` зник: a kept row that changed before the apply fails the collapse, nothing is replaced', () => {
  const rows = conversation()
  const queued = prepare(rows, [{ op: 'collapse', from_index: 1, to_index: 5, summary: 's', keep: [2] }]).queued
  const now = rows.map((r, i) => (i === 2 ? reply('not the person any more', 'h2') : r))
  const out = applyEdits(now, queued, '/s/1.json', new Map(), new Set(), { newId: id => `${id}_n` })
  expect(out.report.applied).toEqual([])
  expect(out.report.failed).toEqual([`collapse #1..#5: ${KEPT_GONE}`])
  expect(out.report.originals).toEqual([])
})

// [SP_FOLD_02_04] [SP_CTX_02_14] the rows a collapse leaves are untouched for RebindTags
test('FoldSpan — пін після застосування: HandleCompaction goes around a pinned row and its pin still names that row', async () => {
  const rows = conversation()
  const tags = reg({ tags: [{ kind: 'pin', target: { anchor: fingerprint(rows[5]!), hint: 5 }, created_turn: 0 }] })
  const pinned = pinnedTargets(rows, tags)
  const edits = prepare(rows, [{ op: 'collapse', from_index: 1, to_index: 6, summary: 'the middle' }], undefined, pinned).queued
  expect(edits.length).toBe(1)
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits }), {}, okRead(tags))
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('applied 1 edit(s): collapse #1..#6')
  const at = out.messages.findIndex(r => r.text === 'note to keep')
  expect(at).toBe(3)
  expect(out.messages.map(r => r.text)).not.toContain('use tabs, never spaces')
  const after = written.tags ?? tags
  expect(after.tags.filter(t => t.kind === 'pin').length).toBe(1)
  expect([...pinnedTargets(out.messages, after).rows]).toEqual([3])
})

// [SP_FOLD_02_04] [SP_CTX_02_21] the seed path hands the applied collapse on with `kept` too
test('FoldSpan — пін і слот після передачі: BuildSeed goes around a pinned row and the state slot, and CarryRegistries carries both tags onto those rows', async () => {
  const rows = conversation()
  const tags: TagRegistry = reg({
    tags: [
      { kind: 'pin', target: { anchor: fingerprint(rows[5]!), hint: 5 }, created_turn: 0 },
      { kind: 'state', target: { anchor: fingerprint(rows[1]!), hint: 1 }, created_turn: 0 },
    ],
  })
  const edits = prepare(rows, [{ op: 'collapse', from_index: 1, to_index: 6, summary: 'the middle' }], undefined, pinnedTargets(rows, tags)).queued
  expect(edits.length).toBe(1)
  const out = await buildSeed({ transcript: rows, rows, api: apiOf(rows), edits, tags: okRead(tags), folder: '/f', archive: '/s/old/1.json', writeMedia: async () => true })
  if ('refuse' in out) throw new Error(out.reason)
  expect(out.report.applied).toEqual(['collapse #1..#6'])
  let carried: TagRegistry | undefined
  const io = {
    carryTags: async (_f: string, _t: string, change: (r: TagRegistry) => TagRegistry) => ((carried = change(tags)), 'carried' as const),
    carryAliases: async () => 'missing' as const,
  }
  await carryRegistries(io, { ...out, edits: out.batch }, '/old', '/new')
  const pinned = pinnedTargets(out.rows, carried!)
  expect([...pinned.rows].map(i => out.rows[i]!.text)).toEqual(['note to keep'])
  expect(out.rows[pinned.state!]!.text).toBe('plan')
})
