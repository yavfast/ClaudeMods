import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { boundaryOf, currentRows, fingerprint, HEAD_ROWS, MAX_DESCRIPTION, parseBoundary, prepare, STALE_INDEXES } from '../hooks/edits'
import { applyTagRequests, EMPTY_REGISTRY } from '../hooks/tags'
import { EDIT_DESCRIPTION, HANDOFF_DESCRIPTION, LIST_DESCRIPTION, TAG_DESCRIPTION } from '../hooks/register'

function row(role: 'user' | 'assistant', text: string): SessionMessage {
  return { role, text, toolUses: [] }
}

// A segment as a compaction leaves it: the prompt, then turns.
function segment(tag: string, n: number): SessionMessage[] {
  return [row('user', 'task'), ...Array.from({ length: n - 1 }, (_, i) => row(i % 2 ? 'user' : 'assistant', `${tag} ${i}`))]
}

test('without a boundary the whole transcript is current', async () => {
  const t = segment('a', 9)
  expect(currentRows(t, undefined)).toEqual(t)
})

test('after a compaction the rows before its head are cut', async () => {
  const old = segment('old', 9)
  const returned = segment('kept', 7)
  const later = [row('user', 'next'), row('assistant', 'answer'), row('assistant', 'more')]
  const cur = currentRows([...old, ...returned, ...later], boundaryOf(returned))
  expect(cur.length).toBe(10)
  expect(cur[0]).toBe(returned[0])
})

test('two compactions with the same head: the last occurrence wins', async () => {
  const first = segment('s', 9)
  const second = segment('s', 7)
  const third = segment('s', 5)
  const t = [...first, ...second, ...third, row('user', 'new')]
  const cur = currentRows(t, boundaryOf(third))
  expect(cur.length).toBe(6)
  expect(cur[0]).toBe(third[0])
})

test('a head that is not in the transcript keeps the whole transcript', async () => {
  const t = segment('a', 9)
  expect(currentRows(t, boundaryOf([row('user', 'elsewhere')]))).toEqual(t)
})

test('a match with fewer rows after it than the compaction returned does not count', async () => {
  const returned = segment('k', 6)
  const old = segment('k', 3)
  // the head matches at 0 (six rows on) but also at 9, where only three rows follow
  const t = [...returned, row('user', 'x'), row('assistant', 'y'), row('user', 'z'), ...old]
  const cur = currentRows(t, boundaryOf(returned))
  expect(cur.length).toBe(t.length)
})

test('boundaryOf keeps the first HEAD_ROWS fingerprints and the count; none for no rows', async () => {
  const rows = segment('b', 12)
  expect(boundaryOf(rows)).toEqual({ head: rows.slice(0, HEAD_ROWS).map(fingerprint), count: 12 })
  expect(boundaryOf([])).toBe(undefined)
})

test('parseBoundary takes only a well-formed boundary', async () => {
  expect(parseBoundary(JSON.stringify({ head: ['a', 'b'], count: 5 }))).toEqual({ head: ['a', 'b'], count: 5 })
  expect(parseBoundary('{')).toBe(undefined)
  expect(parseBoundary('null')).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: [], count: 1 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: ['a', 'b'], count: 1 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: Array(HEAD_ROWS + 1).fill('a'), count: 20 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: [1], count: 1 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: ['a'], count: 1.5 }))).toBe(undefined)
})

test('every tool description reaches the model whole', async () => {
  for (const d of [LIST_DESCRIPTION, EDIT_DESCRIPTION, TAG_DESCRIPTION, HANDOFF_DESCRIPTION]) expect(d.length <= MAX_DESCRIPTION).toBe(true)
})

test('stale indexes: collapse and rewrite are refused, edits by id still queue', async () => {
  const rows: SessionMessage[] = [
    row('user', 'task'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false }] },
    row('assistant', 'done'),
  ]
  const edits = [
    { op: 'collapse', from_index: 1, to_index: 2, summary: 's' },
    { op: 'rewrite', index: 3, text: 't' },
    { op: 'summarize', tool_use_id: 'a', summary: 's' },
  ]
  const stale = prepare(rows, edits, undefined, undefined, true)
  expect(stale.queued.map(e => e.op)).toEqual(['summarize'])
  expect(stale.errors.length).toBe(2)
  expect(stale.errors.every(e => e.includes(STALE_INDEXES))).toBe(true)
  expect(prepare(rows, edits).queued.length).toBe(3)
})

test('stale indexes: a tag by index is refused, a tag by id is added', async () => {
  const rows: SessionMessage[] = [
    row('user', 'task'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false }] },
    row('assistant', 'done'),
  ]
  const out = applyTagRequests({ ...EMPTY_REGISTRY }, rows, [{ op: 'add', kind: 'pin', index: 3 }, { op: 'add', kind: 'pin', tool_use_id: 'a' }], undefined, true)
  expect(out.added).toBe(1)
  expect(out.rejected.map(r => r.code)).toEqual(['INDEXES_STALE'])
})
