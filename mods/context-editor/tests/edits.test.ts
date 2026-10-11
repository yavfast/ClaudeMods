import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  applyEdits,
  collectMedia,
  dropOwnCalls,
  dropOwnCallsCounted,
  fingerprint,
  formatReport,
  freshId,
  fullRow,
  LIST_COUNT,
  listMode,
  listRows,
  MARK,
  MAX_FULL_ROW,
  MAX_LIST_COUNT,
  MAX_TEXT,
  mergeCallRows,
  NO_REFS,
  ownerKey,
  prepare,
  producedRows,
  replacedOwners,
  resolveEditRefs,
  responses,
  responseStart,
  ROW_WINDOW,
  SUMMARIZED,
} from '../hooks/edits'
import { emptyRowBetweenCalls, result } from './row-fixtures'

const BIG = 'x'.repeat(5000)

// A call with an input and a copy of its result (`text`), which the edited
// call must not keep; the shared `use` of row-fixtures has neither.
function use(id: string, tool: string, h: string): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: { q: id }, text: 'ORIGINAL' }], handle: h }
}

function rows(): SessionMessage[] {
  return [
    { role: 'user', text: 'research task', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: 'I will search.', toolUses: [], handle: 'h1' },
    use('a', 'WebSearch', 'h2'),
    result('a', BIG, 'h3'),
    use('b', 'WebFetch', 'h4'),
    result('b', BIG, 'h5'),
    { role: 'assistant', text: 'Conclusion: X is true.', toolUses: [], handle: 'h6' },
    use('c', 'Read', 'h7'),
    result('c', 'small', 'h8'),
  ]
}

function run(edits: unknown[], archive = '/archive.json', media = new Map<string, string[]>(), owners = new Set<string>()) {
  const input = rows()
  const { queued, errors } = prepare(input, edits)
  return { errors, queued, ...applyEdits(input, queued, archive, media, owners) }
}

test('summarize rebuilds the pair under one fresh id and drops the copied result from the call', async () => {
  const { rows: out, report, errors } = run([{ op: 'summarize', tool_use_id: 'a', summary: 'found A' }])
  expect(errors).toEqual([])
  expect(out.length).toBe(9)
  const id = out[2]!.toolUses[0]!.tool_use_id
  expect(id.startsWith('a_ce')).toBe(true)
  expect(out[2]!.toolUses[0]!.text).toBeUndefined()
  expect(out[3]!.toolResults![0]!.tool_use_id).toBe(id)
  expect(out[3]!.toolResults![0]!.text.startsWith(MARK)).toBe(true)
  expect(out[3]!.toolResults![0]!.text).toContain('found A')
  expect(out[0]!.handle).toBe('h0')
  // the text row before the rebuilt call, in the same stretch, is rebuilt too
  expect(out[1]!.handle).toBeUndefined()
  expect(out[1]!.text).toBe('I will search.')
  // untouched tool_result rows without media are rebuilt, never kept by handle
  expect(out[5]!.handle).toBeUndefined()
  expect(report.charsAfter < report.charsBefore - 4000).toBe(true)
})

test('collapse keeps one tool pair as the carrier of the summary', async () => {
  const { rows: out, report } = run([{ op: 'collapse', from_index: 2, to_index: 5, summary: 'A and B say Y' }])
  expect(report.applied).toEqual(['collapse #2..#5'])
  expect(out.length).toBe(7)
  expect(out[2]!.toolUses[0]!.tool_use_id.startsWith('a_ce')).toBe(true)
  expect(out[3]!.toolResults![0]!.text).toContain('you read these 4 rows, then collapsed them into your note')
  // the next row keeps its content; after the inserted carrier in the same
  // stretch it is rebuilt without its handle ([SP_CTX_02_04], pitfall 30)
  expect(out[4]!.text).toBe('Conclusion: X is true.')
  expect(out[4]!.handle).toBeUndefined()
})

// ---- [SP_CTX_02_04] one model response split by a rebuilt row (pitfall 30)

// a prompt, then one response: a text row and two Reads, then their results;
// b's result holds an image; after the next prompt, another response
function response(): SessionMessage[] {
  return [
    { role: 'user', text: 'read both', toolUses: [], handle: 'p0' },
    { role: 'assistant', text: 'Reading both files.', toolUses: [], handle: 't1' },
    use('a', 'Read', 'u2'),
    use('b', 'Read', 'u3'),
    result('a', BIG, 'r4'),
    result('b', '', 'r5'),
    { role: 'assistant', text: '', toolUses: [], handle: 'thinking6' },
    { role: 'user', text: 'next prompt', toolUses: [], handle: 'p7' },
    { role: 'assistant', text: 'Later answer.', toolUses: [], handle: 't8' },
    use('c', 'Read', 'u9'),
    result('c', 'small', 'r10'),
  ]
}

test('a split response: summarize the first Read; the second Read\'s row is rebuilt, its media result kept with handle', async () => {
  const input = response()
  const { queued } = prepare(input, [{ op: 'summarize', tool_use_id: 'a', summary: 'A says X' }])
  const out = applyEdits(input, queued, '/arch.json', new Map(), new Set(['u:b']))
  expect(out.report.applied).toEqual(['summarize a'])
  const byId = (id: string) => out.rows.find(r => r.toolUses.some(u => u.tool_use_id === id))!
  // the text row before it, of the same response, is rebuilt too (content kept)
  expect(out.rows[1]!.handle).toBeUndefined()
  expect(out.rows[1]!.text).toBe('Reading both files.')
  expect(byId('b').handle).toBeUndefined()
  // [SP_CTX_02_04] MergeCallRows: both rebuilt call rows of the response are one row, calls in order
  expect(byId('b').toolUses.map(u => u.tool)).toEqual(['Read', 'Read'])
  expect(byId('b').toolUses[0]!.tool_use_id.startsWith('a_ce')).toBe(true)
  expect(byId('b').toolUses[1]!.input).toEqual({ q: 'b' })
  expect(out.rows.find(r => (r.toolResults ?? []).some(t => t.tool_use_id === 'b'))!.handle).toBe('r5')
  // a thinking-only row after it, rebuilt, is left empty and goes
  expect(out.rows.some(r => r.handle === 'thinking6')).toBe(false)
  expect(out.rows.length).toBe(input.length - 2)
})

test('an interleaved response: summarize a and drop b; the emptied result row of b does not end the stretch', async () => {
  // host 2.1.295 writes one response interleaved: use, result, use, result
  const input: SessionMessage[] = [
    { role: 'user', text: 'read three', toolUses: [], handle: 'p0' },
    { role: 'assistant', text: 'Reading.', toolUses: [], handle: 't1' },
    use('a', 'Read', 'ua'),
    result('a', BIG, 'ra'),
    use('b', 'Read', 'ub'),
    result('b', BIG, 'rb'),
    use('c', 'Read', 'uc'),
    result('c', '', 'rc'),
  ]
  const { queued } = prepare(input, [
    { op: 'summarize', tool_use_id: 'a', summary: 'A says X' },
    { op: 'drop', tool_use_id: 'b' },
  ])
  const out = applyEdits(input, queued, '/arch.json', new Map(), new Set(['u:c']))
  const useOf = (id: string) => out.rows.find(r => r.toolUses.some(u => u.tool_use_id === id))!
  expect(out.rows.some(r => r.toolUses.some(u => u.tool_use_id === 'b'))).toBe(false)
  // c's tool_use row follows the rebuilt a in the same response: rebuilt too
  expect(useOf('c').handle).toBeUndefined()
  // c's result holds media: kept with its handle
  expect(out.rows.find(r => (r.toolResults ?? []).some(t => t.tool_use_id === 'c'))!.handle).toBe('rc')
  expect(out.rows[1]!.handle).toBeUndefined()
})

test('thinking before an edited call: the thinking-only row of the same response is rebuilt and goes', async () => {
  // a thinking model writes one response as a thinking-only row, then the
  // tool_use row; kept with its handle, the thinking row would pull the
  // original call back on --resume (plugin-hooks pitfall 36)
  const input: SessionMessage[] = [
    { role: 'user', text: 'read it', toolUses: [], handle: 'p0' },
    { role: 'assistant', text: '', toolUses: [], handle: 'th1' },
    use('a', 'Read', 'u2'),
    result('a', BIG, 'r3'),
  ]
  const { queued } = prepare(input, [{ op: 'summarize', tool_use_id: 'a', summary: 'A says X' }])
  const out = applyEdits(input, queued, '/arch.json')
  expect(out.report.applied).toEqual(['summarize a'])
  expect(out.rows.some(r => r.handle === 'th1')).toBe(false)
  expect(out.rows.filter(r => r.role === 'assistant').every(r => r.handle === undefined)).toBe(true)
  expect(out.rows.length).toBe(3)
})

test('a stretch without a rebuilt assistant row rebuilds nothing more', async () => {
  const input = response()
  // the edit lies in the second stretch: the first keeps every assistant handle
  const { queued } = prepare(input, [{ op: 'summarize', tool_use_id: 'c', summary: 'C is small' }])
  const out = applyEdits(input, queued, '/arch.json', new Map(), new Set(['u:b']))
  expect(out.rows.slice(0, 4).map(r => r.handle)).toEqual(['p0', 't1', 'u2', 'u3'])
  expect(out.rows.some(r => r.handle === 'thinking6')).toBe(true)
  // the second stretch holds the rebuilt pair of c: its text row is rebuilt too
  expect(out.rows.find(r => r.handle === 't8')).toBeUndefined()
  expect(out.rows.some(r => r.text === 'Later answer.')).toBe(true)
  // no edit at all: every assistant row keeps its handle
  const none = applyEdits(input, [], '', new Map(), new Set(['u:b']))
  expect(none.rows.filter(r => r.role === 'assistant').every(r => r.handle !== undefined)).toBe(true)
})

test('DropOwnCalls: an own call rebuilt out of a response rebuilds every assistant row of that stretch', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [], handle: 'p0' },
    { role: 'assistant', text: 'Listing first.', toolUses: [], handle: 't1' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'z', tool: 'mcp__context-editor__context_list', input: {} }, { tool_use_id: 'd', tool: 'Read', input: {} }], handle: 'u2' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'z', text: 'listing', isError: false }, { tool_use_id: 'd', text: 'd', isError: false }], handle: 'r3' },
    { role: 'assistant', text: 'Done.', toolUses: [], handle: 't4' },
  ]
  const out = dropOwnCalls(input)
  expect(out.map(r => r.handle)).toEqual(['p0', undefined, undefined, undefined, undefined])
  expect(out[1]!.text).toBe('Listing first.')
  expect(out[4]!.text).toBe('Done.')
})

test('DropOwnCalls: the result row emptied by dropping an own call does not end the stretch', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [], handle: 'p0' },
    { role: 'assistant', text: 'Listing.', toolUses: [{ tool_use_id: 'z', tool: 'mcp__context-editor__context_list', input: {} }], handle: 'u1' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'z', text: 'listing', isError: false }], handle: 'r2' },
    use('d', 'Read', 'u3'),
    result('d', '', 'r4'),
  ]
  const out = dropOwnCalls(input, new Set(['u:d']))
  // u1 is rebuilt without z; r2 is left empty and goes; d's use row follows the
  // rebuilt row in the same response, so it is rebuilt too
  expect(out.map(r => r.handle ?? '-')).toEqual(['p0', '-', '-', 'r4'])
})

test('a collapse starting with an own call keeps its summary after the own calls are dropped', async () => {
  const input = [
    { role: 'user', text: 'task', toolUses: [], handle: 'h0' } as SessionMessage,
    use('z', 'mcp__context-editor__context_list', 'h1'),
    result('z', 'listing', 'h2'),
    use('r', 'Read', 'h3'),
    result('r', BIG, 'h4'),
  ]
  const { queued } = prepare(input, [{ op: 'collapse', from_index: 1, to_index: 4, summary: 'KEEP_ME' }])
  const out = dropOwnCalls(applyEdits(input, queued, '').rows)
  expect(out.some(r => (r.toolResults ?? []).some(t => t.text.includes('KEEP_ME')))).toBe(true)
  expect(out.some(r => r.toolUses.some(u => u.tool.startsWith('mcp__context-editor__')))).toBe(false)
})

test('a collapse of text rows only becomes one text row', async () => {
  const { rows: out } = run([{ op: 'collapse', from_index: 0, to_index: 1, summary: 'intro' }])
  expect(out[0]!.text).toContain('you read these 2 rows, then collapsed them into your note')
  expect(out[0]!.toolUses.length).toBe(0)
  expect(out.length).toBe(8)
})

test('missing or empty required fields are refused', async () => {
  const { errors, queued } = run([
    { op: 'summarize', tool_use_id: 'a' },
    { op: 'rewrite', index: 6, text: '  ' },
    { op: 'collapse', from_index: 2, summary: 's' },
    { op: 'nope' },
  ])
  expect(queued.length).toBe(0)
  expect(errors.length).toBe(4)
  expect(errors[0]).toContain('summary is required')
  expect(errors[1]).toContain('text is required')
  expect(errors[2]).toContain('to_index is required')
  expect(errors[3]).toContain('unknown op')
})

test('prepare reports unknown ids, bad indexes, split ranges and wrong targets', async () => {
  const { errors } = run([
    { op: 'drop', tool_use_id: 'nope' },
    { op: 'collapse', from_index: 5, to_index: 99, summary: 's' },
    { op: 'collapse', from_index: 2, to_index: 4, summary: 's' },
    { op: 'rewrite', index: 2, text: 't' },
    { op: 'describe', index: 0, description: 'd' },
  ])
  expect(errors.length).toBe(5)
  expect(errors[0]).toContain('no completed tool call')
  expect(errors[1]).toContain('out of range')
  expect(errors[2]).toContain('splits a tool call')
  expect(errors[3]).toContain('only an assistant text row')
  expect(errors[4]).toContain('no media found')
})

test('rewrite replaces an assistant text row and marks it', async () => {
  const { rows: out } = run([{ op: 'rewrite', index: 6, text: 'X turned out false.' }])
  expect(out[6]!.text.startsWith(MARK)).toBe(true)
  expect(out[6]!.text).toContain('X turned out false.')
})

test('drop removes the call and its result rows', async () => {
  const { rows: out } = run([{ op: 'drop', tool_use_id: 'c' }])
  expect(out.length).toBe(7)
  expect(out.some(r => r.toolUses.some(u => u.tool_use_id === 'c'))).toBe(false)
})

const parallel = (): SessionMessage[] => [
  { role: 'assistant', text: '', handle: 'p0', toolUses: [
    { tool_use_id: 'p', tool: 'Read', input: {} },
    { tool_use_id: 'q', tool: 'Read', input: {} },
  ] },
  { role: 'user', text: '', toolUses: [], handle: 'p1', toolResults: [
    { tool_use_id: 'p', text: BIG, isError: false },
    { tool_use_id: 'q', text: BIG, isError: false },
  ] },
]

test('a row edit overlapping a pair edit is refused; two pair edits on shared rows both apply', async () => {
  const overlap = run([
    { op: 'summarize', tool_use_id: 'b', summary: 'b' },
    { op: 'collapse', from_index: 2, to_index: 5, summary: 'all' },
  ])
  // both end at #5; the plan keeps batch order for equal ends, so the pair edit runs first
  expect(overlap.report.applied).toEqual(['summarize b'])
  expect(overlap.report.failed).toEqual(['collapse #2..#5: overlaps another edit'])
  const input = parallel()
  const { queued } = prepare(input, [
    { op: 'summarize', tool_use_id: 'p', summary: 'P' },
    { op: 'summarize', tool_use_id: 'q', summary: 'Q' },
  ])
  const res = applyEdits(input, queued, '')
  expect(res.report.applied.length).toBe(2)
  const texts = res.rows[1]!.toolResults!.map(r => r.text)
  expect(texts[0]).toContain('P')
  expect(texts[1]).toContain('Q')
  expect(res.rows[0]!.toolUses.map(u => u.tool_use_id)).toEqual(res.rows[1]!.toolResults!.map(r => r.tool_use_id))
})

test('a pair edit is refused when its shared row holds media of another pair not replaced in the batch', async () => {
  const input = parallel()
  const owners = new Set([ownerKey({ tool_use_id: 'q' })])
  const alone = applyEdits(input, prepare(input, [{ op: 'summarize', tool_use_id: 'p', summary: 'P' }]).queued, '', new Map(), owners)
  expect(alone.report.failed[0]).toContain('row also holds media of q')
  expect(alone.rows[1]!.handle).toBe('p1')
  const both = applyEdits(
    input,
    prepare(input, [
      { op: 'summarize', tool_use_id: 'p', summary: 'P' },
      { op: 'summarize', tool_use_id: 'q', summary: 'Q' },
    ]).queued,
    '',
    new Map([[ownerKey({ tool_use_id: 'q' }), ['/m/q.png']]]),
    owners,
  )
  expect(both.report.applied.length).toBe(2)
})

test('a collapse over a prompt row is refused while prompt media cannot be matched', async () => {
  const input = rows()
  const { queued } = prepare(input, [{ op: 'collapse', from_index: 0, to_index: 1, summary: 's' }])
  const res = applyEdits(input, queued, '', new Map(), new Set(), { unmatchedPromptMedia: 1 })
  expect(res.report.failed[0]).toContain('prompt media')
  expect(res.rows[0]!.handle).toBe('h0')
})

test('tool_result rows outside the API window keep their handle', async () => {
  const input = rows()
  const { queued } = prepare(input, [{ op: 'drop', tool_use_id: 'c' }])
  const res = applyEdits(input, queued, '', new Map(), new Set(), { knownResults: new Set(['b']) })
  expect(res.rows[3]!.handle).toBe('h3')
  expect(res.rows[5]!.handle).toBeUndefined()
})

test('collectMedia finds tool-result media, the API window and unmatched prompt media', async () => {
  const png = 'iVBORw0KGgo='
  const { found, knownResults, unmatchedPromptMedia } = collectMedia([
    { role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a' }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] },
      { type: 'tool_result', tool_use_id: 'b', content: [{ type: 'document', source: { type: 'url', url: 'https://x/y.pdf' } }] },
      { type: 'tool_result', tool_use_id: 'c', content: 'plain text' },
    ] },
  ], [])
  expect(unmatchedPromptMedia).toBe(1)
  expect([...knownResults].sort()).toEqual(['a', 'b', 'c'])
  expect(found.get(ownerKey({ tool_use_id: 'a' }))![0]!.bytes).toBe(8)
  expect(found.get(ownerKey({ tool_use_id: 'a' }))![0]!.data).toBe(png)
  expect(found.get(ownerKey({ tool_use_id: 'b' }))![0]!.data).toBeUndefined()
  expect(found.has(ownerKey({ tool_use_id: 'c' }))).toBe(false)
})

test('index edits find their rows after the list shifted, or fail when the row is gone', async () => {
  const input = rows()
  const { queued } = prepare(input, [{ op: 'rewrite', index: 6, text: 'moved' }])
  const shifted = [{ role: 'user', text: 'earlier', toolUses: [], handle: 'hx' } as SessionMessage, ...input]
  const moved = applyEdits(shifted, queued, '')
  expect(moved.report.applied).toEqual(['rewrite #6'])
  expect(moved.rows[7]!.text).toContain('moved')
  const changed = input.map((r, i) => (i === 6 ? { ...r, text: 'something else' } : r))
  const gone = applyEdits(changed, queued, '')
  expect(gone.report.failed[0]).toContain('no longer there')
})

test('no archive path is written when the archive could not be saved', async () => {
  const { rows: out } = run([{ op: 'summarize', tool_use_id: 'a', summary: 's' }], '')
  expect(out[3]!.toolResults![0]!.text).not.toContain('original:')
})

test('rows with media keep their handle; media that was not archived blocks the edit', async () => {
  const owners = new Set([ownerKey({ tool_use_id: 'b' }), ownerKey({ tool_use_id: 'c' })])
  const media = new Map([[ownerKey({ tool_use_id: 'c' }), ['/m/1.png']]])
  const { rows: out, report } = run(
    [
      { op: 'summarize', tool_use_id: 'a', summary: 'A' },
      { op: 'summarize', tool_use_id: 'b', summary: 'B' },
      { op: 'summarize', tool_use_id: 'c', summary: 'C' },
    ],
    '',
    media,
    owners,
  )
  expect(report.failed).toEqual(['summarize b: media could not be archived'])
  expect(out[5]!.handle).toBe('h5')
  expect(out[8]!.toolResults![0]!.text).toContain('(media: /m/1.png)')
  expect(report.mediaFiles).toEqual(['/m/1.png'])
})

test('replacedOwners names the media owners a batch replaces', async () => {
  const input = rows()
  const { queued } = prepare(input, [
    { op: 'drop', tool_use_id: 'c' },
    { op: 'collapse', from_index: 2, to_index: 3, summary: 's' },
  ])
  const keys = replacedOwners(input, queued)
  expect(keys.has(ownerKey({ tool_use_id: 'c' }))).toBe(true)
  expect(keys.has(ownerKey({ tool_use_id: 'a' }))).toBe(true)
  expect(keys.has(ownerKey({ tool_use_id: 'b' }))).toBe(false)
})

test('freshId replaces its own suffix instead of stacking it', async () => {
  const once = freshId('toolu_01')
  const twice = freshId(once)
  expect(once.startsWith('toolu_01_ce')).toBe(true)
  expect(twice.split('_ce').length).toBe(2)
})

test('the listing pages from the oldest row and flags big, edited and media rows', async () => {
  const text = listRows(rows(), 0, 4)
  expect(text).toContain('#0 user')
  expect(text).toContain('#3! user')
  expect(text).toContain('Next page: from=4')
  const edited = run([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]).rows
  expect(listRows(edited, 3, 1)).toContain('#3* user')
  const withMedia = listRows(rows(), 7, 2, new Map([[ownerKey({ tool_use_id: 'c' }), [{ mediaType: 'image/png', bytes: 2048 }]]]))
  expect(withMedia).toContain('#8@ user')
  expect(withMedia).toContain('media image/png ~2KB')
  expect(listRows([], 0, 10)).toBe('0 rows.')
  const named = listRows(rows(), 0, 4, new Map(), new Map(), new Map([['a', 'c4']]))
  expect(named).toContain('id=a (c4) input=')
})

test('own calls whose result row shares media or unknown results with another pair stay', async () => {
  const input: SessionMessage[] = [
    { role: 'assistant', text: '', handle: 'h1', toolUses: [
      { tool_use_id: 'z', tool: 'mcp__context-editor__context_list', input: {} },
      { tool_use_id: 'shot', tool: 'Read', input: {} },
    ] },
    { role: 'user', text: '', toolUses: [], handle: 'h2', toolResults: [
      { tool_use_id: 'z', text: 'listing', isError: false },
      { tool_use_id: 'shot', text: '', isError: false },
    ] },
  ]
  const withMedia = dropOwnCalls(input, new Set([ownerKey({ tool_use_id: 'shot' })]))
  expect(withMedia[1]!.handle).toBe('h2')
  expect(withMedia[1]!.toolResults!.length).toBe(2)
  const outside = dropOwnCalls(input, new Set(), new Set(['z']))
  expect(outside[1]!.handle).toBe('h2')
  const plainRow = dropOwnCalls(input, new Set(), new Set(['z', 'shot']))
  expect(plainRow[1]!.toolResults!.map(r => r.tool_use_id)).toEqual(['shot'])
})

const OUTSIDE = 'outside the API window; media unknown'

test('ApplyEdits — правка поза вікном: a summarize whose result row has an id outside knownResults; a collapse with such a row; a collapse with a prompt before the first known result when apiTruncated', async () => {
  const input = rows()
  const apply = (edit: unknown, options: Parameters<typeof applyEdits>[5]) => applyEdits(input, prepare(input, [edit]).queued, '', new Map(), new Set(), options)
  const pair = apply({ op: 'summarize', tool_use_id: 'a', summary: 's' }, { knownResults: new Set(['b', 'c']) })
  expect(pair.report.failed).toEqual([`summarize a: ${OUTSIDE}`])
  const unknownRow = apply({ op: 'collapse', from_index: 2, to_index: 5, summary: 's' }, { knownResults: new Set(['b', 'c']) })
  expect(unknownRow.report.failed).toEqual([`collapse #2..#5: ${OUTSIDE}`])
  const early = apply({ op: 'collapse', from_index: 0, to_index: 1, summary: 's' }, { knownResults: new Set(['b', 'c']), apiTruncated: true })
  expect(early.report.failed).toEqual([`collapse #0..#1: ${OUTSIDE}`])
  const inside = apply({ op: 'collapse', from_index: 6, to_index: 8, summary: 's' }, { knownResults: new Set(['a', 'b', 'c']), apiTruncated: true })
  expect(inside.report.applied.length).toBe(1)
})

test('ApplyEdits — промпт перед першою парою, повне подання: the person\'s prompt and the first pair collapse when the API form is whole', async () => {
  const input = rows()
  const res = applyEdits(input, prepare(input, [{ op: 'collapse', from_index: 0, to_index: 3, summary: 's' }]).queued, '', new Map(), new Set(), {
    knownResults: new Set(['a', 'b', 'c']),
    apiTruncated: false,
  })
  expect(res.report.applied).toEqual(['collapse #0..#3'])
  expect(res.report.failed).toEqual([])
})

test('ApplyEdits — промпт перед першою парою, обрізане подання: the same collapse when the API form fills its window is refused', async () => {
  const input = rows()
  const res = applyEdits(input, prepare(input, [{ op: 'collapse', from_index: 0, to_index: 3, summary: 's' }]).queued, '', new Map(), new Set(), {
    knownResults: new Set(['a', 'b', 'c']),
    apiTruncated: true,
  })
  expect(res.report.failed).toEqual([`collapse #0..#3: ${OUTSIDE}`])
  expect(res.report.applied).toEqual([])
})

test('CollectMedia — apiTruncated: 4096 / 4095 / 4094 messages of the API form give true / true / false (ROW_WINDOW − 1)', async () => {
  const of = (n: number) => collectMedia(Array.from({ length: n }, () => ({ role: 'user', content: 'x' })), []).apiTruncated
  expect(ROW_WINDOW).toBe(4096)
  expect(of(4096)).toBe(true)
  expect(of(4095)).toBe(true)
  expect(of(4094)).toBe(false)
})

test('a collapse carrier keeps no copy of the first call input', async () => {
  const { rows: out } = run([{ op: 'collapse', from_index: 2, to_index: 5, summary: 's' }])
  expect(out[2]!.toolUses[0]!.input).toEqual({})
})

test('the plugin own calls are dropped with their results', async () => {
  const input = [...rows(), use('z', 'mcp__context-editor__context_list', 'h9'), result('z', 'listing', 'h10')]
  const out = dropOwnCalls(input)
  expect(out.length).toBe(9)
  expect(out.some(r => r.toolUses.some(u => u.tool_use_id === 'z'))).toBe(false)
})

test('the report names what applied, what failed and where the originals are', async () => {
  const { report } = run([
    { op: 'drop', tool_use_id: 'c' },
    { op: 'drop', tool_use_id: 'nope' },
  ])
  const text = formatReport(report, '/archive.json', 'compaction')
  expect(text).toContain('applied 1 edit(s): drop c')
  expect(text).toContain('Originals archived at /archive.json')
  expect(formatReport(report, '', 'compaction')).not.toContain('Originals archived')
})

// [SP_CTX_01_05]
test('FormatReport — форми: compaction without an applied edit / seed with nothing / an applied edit', async () => {
  const empty = { applied: [], failed: [], charsBefore: 100, charsAfter: 100, originals: [], produced: [], notesDropped: [], ownCallsRemoved: 0, mediaFiles: [] }
  const none = formatReport({ ...empty, failed: ['x'] }, '/a.json', 'compaction')
  expect(none).toBe('context-editor: no edit was applied; the conversation was not changed. Not applied: x.')
  expect(none).not.toContain('Conversation ~')
  expect(none).not.toContain('freed')
  expect(formatReport(empty, '/a.json', 'seed')).toBe('')
  expect(formatReport({ ...empty, failed: ['x'] }, '/a.json', 'seed')).toBe('context-editor: no queued edit was applied. Not applied: x.')
  const done = formatReport({ ...empty, applied: ['y'], charsAfter: 60 }, '/a.json', 'seed')
  expect(done).toBe('context-editor: applied 1 edit(s): y. Conversation ~100 -> ~60 chars (estimate: ~10 tokens (approx.) freed; context_list telemetry shows the measured change after the next response).')
  expect(formatReport({ ...empty, applied: ['y'], charsAfter: 60 }, '/a.json', 'compaction')).toContain('Conversation ~100 -> ~60 chars (estimate: ~10 tokens (approx.) freed;')
  // [SP_CTX_02_34] with the registry's calibration
  expect(formatReport({ ...empty, applied: ['y'], charsAfter: 60 }, '/a.json', 'compaction', 2)).toContain('Conversation ~100 -> ~60 chars (estimate: ~20 tokens freed;')
})

// [SP_CTX_01_05] [SP_CTX_02_04]
test('ApplyEdits — produced після DropOwnCalls: a summarize whose result row shares a context_list result: index and fingerprint of the row after the service result went', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'a', tool: 'Read', input: {} },
        { tool_use_id: 'l', tool: 'mcp__context-editor__context_list', input: {} },
      ],
    },
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [
        { tool_use_id: 'a', text: 'x'.repeat(300), isError: false },
        { tool_use_id: 'l', text: 'listing', isError: false },
      ],
    },
  ]
  const applied = applyEdits(input, prepare(input, [{ op: 'summarize', tool_use_id: 'a', summary: 's' }]).queued, '/s/1.json')
  const final = dropOwnCalls(applied.rows)
  const produced = producedRows(final, applied.made)
  expect(produced.length).toBe(1)
  expect(produced[0]!.edit).toBe('summarize a')
  expect(produced[0]!.index).toBe(2)
  expect(produced[0]!.fingerprint).toBe(fingerprint(final[2]!))
  expect(produced[0]!.fingerprint).not.toContain('r:l')
  // a made row no longer in the final list has no entry
  expect(producedRows(final.slice(0, 2), applied.made)).toEqual([])
})

test('ApplyEdits — примітка оригіналу: the replacement says where the original is and how to open it', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [] },
    { role: 'assistant', text: 'wrong', toolUses: [] },
  ]
  const out = applyEdits(input, prepare(input, [{ op: 'rewrite', index: 1, text: 'right' }]).queued, '/s/1.json')
  expect(out.rows[1]!.text).toBe('[context-editor] you rewrote this row (original: /s/1.json, open with Read): right')
  expect(out.report.produced).toEqual([{ edit: 'rewrite #1', index: 1, fingerprint: fingerprint(out.rows[1]!) }])
})

// [SP_CTX_02_04] MergeCallRows (live verify of phase 14, D1)
test('ApplyEdits — паралельні виклики в окремих рядках: summarize both: one assistant row with both tool_uses, the results row right after it', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'read X and Y', toolUses: [], handle: 'p0' },
    use('x', 'Read', 'ux'),
    use('y', 'Read', 'uy'),
    { role: 'user', text: '', toolUses: [], toolResults: [
      { tool_use_id: 'x', text: BIG, isError: false },
      { tool_use_id: 'y', text: BIG, isError: false },
    ], handle: 'rxy' },
    { role: 'assistant', text: 'Both read.', toolUses: [], handle: 'a4' },
  ]
  const edits = prepare(input, [
    { op: 'summarize', tool_use_id: 'x', summary: 'X' },
    { op: 'summarize', tool_use_id: 'y', summary: 'Y' },
  ]).queued
  const out = applyEdits(input, edits, '/s/1.json')
  expect(out.report.applied.length).toBe(2)
  expect(out.rows.length).toBe(4)
  const calls = out.rows[1]!
  expect(calls.role).toBe('assistant')
  expect(calls.handle).toBeUndefined()
  expect(calls.toolUses.map(u => u.tool_use_id.replace(/_ce.*/, ''))).toEqual(['x', 'y'])
  // every call row is followed at once by the row of its results
  expect(out.rows[2]!.toolResults!.map(t => t.tool_use_id)).toEqual(calls.toolUses.map(u => u.tool_use_id))
  // produced: both edits made the one results row
  expect(out.report.produced.map(p => p.index)).toEqual([2, 2])
})

test('MergeCallRows — змішані рядки: a text row before the calls stays apart; rows with a handle, results and prompts end a run; a text row after the calls joins them', async () => {
  const text = (role: 'user' | 'assistant', t: string, handle?: string): SessionMessage => ({ role, text: t, toolUses: [], ...(handle ? { handle } : {}) })
  const plainUse = (id: string): SessionMessage => ({ role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool: 'Read', input: {} }] })
  const rows: SessionMessage[] = [
    text('user', 'p'),
    text('assistant', 'first I read'),
    plainUse('a'),
    plainUse('b'),
    text('assistant', 'and note'),
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'A', isError: false }, { tool_use_id: 'b', text: 'B', isError: false }] },
    plainUse('c'),
    { ...plainUse('d'), handle: 'hd' },
  ]
  const out = mergeCallRows(rows)
  expect(out.map(r => r.toolUses.map(u => u.tool_use_id).join(',') || r.text)).toEqual(['p', 'first I read', 'a,b', 'A', 'c', 'd'].map((x, i) => (i === 3 ? '' : x)))
  expect(out[2]!.text).toBe('and note')
  expect(out[5]!.handle).toBe('hd')
  // nothing to merge: the same rows
  expect(mergeCallRows(rows.slice(0, 3))).toEqual(rows.slice(0, 3))
})

test('DropOwnCalls — a parallel own call between two calls of one response: the rebuilt call rows become one', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'p', toolUses: [], handle: 'p0' },
    use('a', 'Read', 'ua'),
    use('l', 'mcp__context-editor__context_list', 'ul'),
    use('b', 'Read', 'ub'),
    { role: 'user', text: '', toolUses: [], toolResults: [
      { tool_use_id: 'a', text: 'A', isError: false },
      { tool_use_id: 'l', text: 'listing', isError: false },
      { tool_use_id: 'b', text: 'B', isError: false },
    ], handle: 'r' },
  ]
  const out = dropOwnCalls(input)
  expect(out.length).toBe(3)
  expect(out[1]!.toolUses.map(u => u.tool_use_id)).toEqual(['a', 'b'])
  expect(out[2]!.toolResults!.map(t => t.tool_use_id)).toEqual(['a', 'b'])
})

// [SP_CTX_02_01] phase 17: one row whole
test('context_list — повний рядок: index 12 with full shows the row whole up to MAX_FULL_ROW with the tail; BAD_FULL otherwise', async () => {
  const input: SessionMessage[] = Array.from({ length: 13 }, (_, i) => ({ role: 'assistant' as const, text: i === 12 ? 'y'.repeat(30_000) : `r${i}`, toolUses: [] }))
  const text = fullRow(input, 12, new Map(), ['[pin]'], ['n1: check it'])
  expect(text.startsWith('Row #12 assistant 30000c')).toBe(true)
  expect(text.length < MAX_FULL_ROW + 200).toBe(true)
  expect(/… \(\+1\d{4} chars; the original, if this row was edited, is in the archive named in its text\)$/.test(text)).toBe(true)
  const small = fullRow([{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: { file_path: '/x' } }] }, { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'the whole result', isError: false }] }], 1, new Map(), [], ['n2: a note'])
  expect(small).toContain('tool_result id=a:\nthe whole result')
  expect(small).toContain('note n2: a note')
  expect(listMode({ index: 12, full: true }, 13)).toEqual({ full: 12 })
  expect(listMode({ full: true }, 13)).toEqual({ bad: '"full": true needs "index", a row of the listing (0..12) (BAD_FULL)' })
  expect(JSON.stringify(listMode({ full: true, index: 13 }, 13))).toContain('BAD_FULL')
  expect(JSON.stringify(listMode({ index: 3 }, 13))).toContain('BAD_FULL')
  expect(listMode({ from: 5, count: 0 }, 13)).toEqual({ page: { from: 5, count: 0 } })
})

// ---- phase 15

test('context_list — `~` у змішаному рядку: parallel Read and WebFetch: only the Read parts carry ~', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'r', tool: 'Read', input: {} }, { tool_use_id: 'w', tool: 'WebFetch', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'r', text: 'file', isError: false }, { tool_use_id: 'w', text: 'page', isError: false }] },
  ]
  const text = listRows(input, 0, 10)
  expect(text).toContain('tool_use Read~ id=r')
  expect(text).toContain('tool_use WebFetch id=w')
  expect(text).toContain('tool_result~ id=r "file"')
  expect(text).toContain('tool_result id=w "page"')
})

test('DropOwnCalls — лічильник: the context_note and context_list pairs are removed (2); the context_tag pair next to media stays and does not count', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [], handle: 'h0' },
    use('n', 'mcp__context-editor__context_note', 'h1'),
    result('n', 'noted', 'h2'),
    use('l', 'mcp__context-editor__context_list', 'h3'),
    result('l', 'listing', 'h4'),
    {
      role: 'assistant',
      text: '',
      handle: 'h5',
      toolUses: [
        { tool_use_id: 't', tool: 'mcp__context-editor__context_tag', input: {} },
        { tool_use_id: 'shot', tool: 'Read', input: {} },
      ],
    },
    {
      role: 'user',
      text: '',
      handle: 'h6',
      toolResults: [
        { tool_use_id: 't', text: 'tagged', isError: false },
        { tool_use_id: 'shot', text: '', isError: false },
      ],
      toolUses: [],
    },
  ]
  const out = dropOwnCallsCounted(input, new Set([ownerKey({ tool_use_id: 'shot' })]))
  expect(out.removed).toBe(2)
  expect(out.rows.some(r => r.toolUses.some(u => u.tool_use_id === 't'))).toBe(true)
  expect(dropOwnCallsCounted(rows()).removed).toBe(0)
})

// [SP_CTX_01_05] phase 18
test('FormatReport — NowIndex: applied edits with a produced entry name their row in the final list; applied stays unchanged', async () => {
  const report = {
    applied: ['rewrite #23', 'summarize a', 'drop b', 'collapse #3..#6'],
    failed: ['rewrite #40: the row it named is no longer there'],
    charsBefore: 100,
    charsAfter: 60,
    originals: [],
    produced: [
      { edit: 'rewrite #23', index: 18, fingerprint: 'f1' },
      { edit: 'summarize a', index: 9, fingerprint: 'f2' },
      { edit: 'collapse #3..#6', index: 4, fingerprint: 'f3' },
    ],
    notesDropped: [],
    ownCallsRemoved: 0,
    mediaFiles: [],
  }
  const text = formatReport(report, '', 'compaction')
  expect(text).toContain('applied 4 edit(s): rewrite #23 (now #18); summarize a (now #9); drop b; collapse #3..#6 (now #4).')
  // a failed edit made nothing: no suffix
  expect(text).toContain('Not applied: rewrite #40: the row it named is no longer there.')
  expect(report.applied).toEqual(['rewrite #23', 'summarize a', 'drop b', 'collapse #3..#6'])
  expect(formatReport(report, '', 'seed')).toContain('rewrite #23 (now #18)')
})

test('FormatReport — NowIndex без запису: no produced entry leaves the edit as it is; an unchanged index still shows', async () => {
  const base = { failed: [], charsBefore: 100, charsAfter: 60, originals: [], notesDropped: [], ownCallsRemoved: 0, mediaFiles: [] }
  expect(formatReport({ ...base, applied: ['rewrite #5'], produced: [] }, '', 'compaction')).toContain('applied 1 edit(s): rewrite #5. ')
  expect(formatReport({ ...base, applied: ['describe #0'], produced: [{ edit: 'describe #0', index: 0, fingerprint: 'f' }] }, '', 'compaction')).toContain(
    'applied 1 edit(s): describe #0 (now #0).',
  )
})

test('FormatReport — власні виклики (P13): applied with 2 removed / 0 removed / no edit applied / a seed without edits with 1 removed', async () => {
  const base = { applied: ['drop c'], failed: [], charsBefore: 100, charsAfter: 60, originals: [], produced: [], notesDropped: [], ownCallsRemoved: 2, mediaFiles: [] }
  const sentence = 'Your own context-editor calls (2) were removed; tags and notes stay — see context_list.'
  expect(formatReport(base, '', 'compaction').endsWith(` ${sentence}`)).toBe(true)
  expect(formatReport({ ...base, ownCallsRemoved: 0 }, '', 'compaction')).not.toContain('Your own')
  expect(formatReport({ ...base, applied: [], failed: ['x'] }, '', 'compaction')).not.toContain('Your own')
  expect(formatReport({ ...base, applied: [], ownCallsRemoved: 1 }, '', 'seed')).toBe(
    'context-editor: Your own context-editor calls (1) were removed; tags and notes stay — see context_list.',
  )
  // after the notes dropped
  expect(formatReport({ ...base, notesDropped: ['n2'] }, '', 'compaction')).toContain(`Notes dropped (their rows were removed): n2. ${sentence}`)
})

// ---- [SP_CTX_02_04] [SP_CTX_DEC_17] (A') who wrote a replacement, and when (phase 19)

test('ApplyEdits — хто написав заміну: each replacement says the agent read the original here and replaced it itself; MARK still marks it', async () => {
  const input: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: 'wrong', toolUses: [], handle: 'h1' },
    use('a', 'Read', 'h2'),
    result('a', 'aaa', 'h3'),
    use('b', 'Read', 'h4'),
    result('b', 'bbb', 'h5'),
    use('c', 'Read', 'h6'),
    result('c', 'ccc', 'h7'),
  ]
  const { queued } = prepare(input, [
    { op: 'rewrite', index: 1, text: 'right' },
    { op: 'summarize', tool_use_id: 'a', summary: 'A holds K' },
    { op: 'collapse', from_index: 4, to_index: 7, summary: 'B and C' },
  ])
  const out = applyEdits(input, queued, '/s/1.json')
  expect(out.report.applied.length).toBe(3)
  const note = ' (original: /s/1.json, open with Read): '
  expect(out.rows[1]!.text).toBe(`${MARK} you rewrote this row${note}right`)
  expect(out.rows[3]!.toolResults![0]!.text).toBe(`${MARK} ${SUMMARIZED}${note}A holds K`)
  expect(SUMMARIZED).toBe('you read the full output here, then replaced it with your summary')
  expect(out.rows[5]!.toolResults![0]!.text).toBe(`${MARK} you read these 4 rows, then collapsed them into your note${note}B and C`)
  // the listing still flags every replaced row by the MARK prefix
  const page = listRows(out.rows, 0, 20)
  for (const i of [1, 3, 5]) expect(page).toContain(`#${i}*`)
})

// ---- [SP_CTX_02_04] [SP_CTX_DEC_22] FrozenPrefix and ResponseStart (phase 23)

const think = (h: string): SessionMessage => ({ role: 'assistant', text: '', toolUses: [], handle: h })
const say = (text: string, h: string): SessionMessage => ({ role: 'assistant', text, toolUses: [], handle: h })
const own = (id: string, h: string): SessionMessage => use(id, 'mcp__context-editor__context_list', h)
// one assistant message of the API form per response: its call ids and texts
const reply = (ids: string[], texts: string[] = []) => ({
  role: 'assistant',
  content: [{ type: 'thinking', thinking: '', signature: 's' }, ...texts.map(text => ({ type: 'text', text })), ...ids.map(id => ({ type: 'tool_use', id, name: 'Bash', input: {} }))],
})

// a turn of four responses: R1 (thinking, Read a), R2 (thinking, own context_list l),
// R3 (thinking, Bash b), R4 (thinking, Bash c), then the final text
function turn(): { rows: SessionMessage[]; api: unknown[] } {
  const rows = [
    { role: 'user' as const, text: 'task', toolUses: [], handle: 'p' },
    think('t1'),
    use('a', 'Read', 'ua'),
    result('a', BIG, 'ra'),
    think('t2'),
    own('l', 'ul'),
    result('l', 'listing', 'rl'),
    think('t3'),
    use('b', 'Bash', 'ub'),
    result('b', BIG, 'rb'),
    think('t4'),
    use('c', 'Bash', 'uc'),
    result('c', BIG, 'rc'),
    say('done', 'f'),
  ]
  return { rows, api: [{ role: 'user', content: 'task' }, reply(['a']), reply(['l']), reply(['b']), reply(['c']), reply([], ['done'])] }
}

test('ResponseStart — відповідь: the first row of the response that holds a row; a result row counts from its call; a prompt row is its own', async () => {
  const { rows, api } = turn()
  expect(responseStart(rows, 11, api)).toBe(10)
  expect(responseStart(rows, 12, api)).toBe(10)
  expect(responseStart(rows, 13, api)).toBe(13)
  expect(responseStart(rows, 0, api)).toBe(0)
  expect(responseStart(rows, rows.length, api)).toBe(rows.length)
})

test('ResponseStart — паралельні виклики «виклик, результат, виклик»: the API message joins the calls, so the start is the first call\'s response', async () => {
  const rows: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [], handle: 'p' },
    say('earlier', 'e'),
    think('t'),
    use('a', 'Read', 'ua'),
    result('a', 'A', 'ra'),
    use('b', 'Read', 'ub'),
    result('b', 'B', 'rb'),
  ]
  const api = [{ role: 'user', content: 'task' }, reply([], ['earlier']), reply(['a', 'b'])]
  // "earlier" is a response of its own only by the API: by the rows it runs into the thinking row
  expect(responseStart(rows, 5, [{ role: 'user', content: 'task' }, reply(['a', 'b'])])).toBe(1)
  expect(responseStart(rows, 5, api)).toBe(1)
  // without a matching API message: the start of the stretch, after the prompt
  expect(responseStart(rows, 5, [])).toBe(1)
  // a text row that the API shows in an earlier response's message
  const late: SessionMessage[] = [{ role: 'user', text: 'task', toolUses: [], handle: 'p' }, use('a', 'Read', 'ua'), result('a', 'A', 'ra'), say('and so', 's')]
  expect(responseStart(late, 3, [reply(['a'], ['and so'])])).toBe(1)
  expect(responseStart(late, 3, [reply(['a']), reply([], ['and so'])])).toBe(3)
})

test('ResponseStart — текст після викликів (PL_AUD_CTX_P8): a text the API shows in the message of earlier calls joins their response, also when the next response follows it directly', async () => {
  // call a, its result, the text of the same response, then the next response (thinking, text) with no row between
  const rows: SessionMessage[] = [{ role: 'user', text: 'task', toolUses: [], handle: 'p' }, use('a', 'Read', 'ua'), result('a', 'A', 'ra'), say('and so', 's'), think('t'), say('next', 'n')]
  const api = [{ role: 'user', content: 'task' }, reply(['a'], ['and so']), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'A' }] }, reply([], ['next'])]
  // the latest message of the run alone ("next") would start at "and so" and split the response of call a
  expect(responseStart(rows, 5, api)).toBe(1)
  expect(responseStart(rows, 3, api)).toBe(1)
  expect(responses(rows, api)).toEqual({ start: [0, 1, 1, 1, 1, 1], known: [true, true, true, true, true, true], floor: [0, 1, 1, 1, 1, 1] })
})

test('ResponseStart — порожній рядок без handle (PL_AUD_CTX_P8): no prompt, so the API message joins the calls on both sides of it; the stretch goes on', async () => {
  const { rows, api, callA, callB } = emptyRowBetweenCalls()
  expect(responseStart(rows, callB, api)).toBe(callA)
  expect(responseStart(rows, 3, api)).toBe(callA)
  // without the API form: the start of the stretch, after the prompt
  expect(responseStart(rows, callB, [])).toBe(1)
  expect(responses(rows).known.slice(callB, callB + 2)).toEqual([false, false])
  // the empty row no response pulled in is not known: the stretch, so FrozenPrefix never splits the calls' response at it
  expect(responses(rows).known[3]).toBe(false)
  expect(responseStart(rows, 3, [])).toBe(1)
  // the API form cut so that the calls' message is missing: the same
  const cut = api.slice(2)
  expect(responseStart(rows, 3, cut)).toBe(1)
  expect(responseStart(rows, callB, cut)).toBe(1)
  // pulled in by the calls' response, it is known as that response is
  expect(responses(rows, api).known[3]).toBe(true)
})

test('FrozenPrefix — неглибока правка: rows before the response of the first change come back as they came, thinking, own calls and result rows with their handle', async () => {
  const { rows, api } = turn()
  const queued = prepare(rows, [{ op: 'summarize', tool_use_id: 'c', summary: 'c ok' }]).queued
  const out = applyEdits(rows, queued, '/s/1.json', new Map(), new Set(), { freeze: { api } })
  expect(out.prefix).toBe(10)
  // the same objects, handle and all: the bytes of the prompt cache
  for (let i = 0; i < 10; i++) expect(out.rows[i]).toBe(rows[i]!)
  // the response of the edit is rebuilt: its thinking row went, the pair has the fresh id
  expect(out.rows[10]!.handle).toBeUndefined()
  expect(out.rows[10]!.toolUses[0]!.tool_use_id.startsWith('c_ce')).toBe(true)
  expect(out.rows[11]!.toolResults![0]!.text.startsWith(MARK)).toBe(true)
  expect(out.rows[12]!.handle).toBeUndefined()
  expect(out.rows.length).toBe(13)
  // DropOwnCalls keeps the own pair of the frozen prefix
  const frozen = new Set(rows.slice(0, out.prefix))
  const dropped = dropOwnCallsCounted(out.rows, new Set(), undefined, frozen)
  expect(dropped.removed).toBe(0)
  expect(dropped.rows.slice(0, 10)).toEqual(rows.slice(0, 10))
  expect(dropped.rows[5]).toBe(rows[5]!)
})

test('FrozenPrefix — без заморожування: without freeze (a seed, the callers outside a compaction) the stretch is rebuilt as before', async () => {
  const { rows } = turn()
  const queued = prepare(rows, [{ op: 'summarize', tool_use_id: 'c', summary: 'c ok' }]).queued
  const out = applyEdits(rows, queued, '/s/1.json')
  expect(out.prefix).toBe(0)
  // the thinking rows of the turn went, every assistant row of the stretch is rebuilt
  expect(out.rows.filter(r => r.role === 'assistant').every(r => r.handle === undefined)).toBe(true)
  expect(out.rows.length).toBe(10)
  expect(dropOwnCallsCounted(out.rows).removed).toBe(1)
})

test('FrozenPrefix — глибока правка і кілька правок: the earliest applied edit sets the prefix; a failed one does not', async () => {
  const { rows, api } = turn()
  const queued = prepare(rows, [
    { op: 'summarize', tool_use_id: 'c', summary: 'c' },
    { op: 'summarize', tool_use_id: 'a', summary: 'a' },
  ]).queued
  const both = applyEdits(rows, queued, '', new Map(), new Set(), { freeze: { api } })
  expect(both.prefix).toBe(1)
  expect(both.rows[0]).toBe(rows[0]!)
  // the summarize of a fails (its media is not archived): only c counts
  const failedA = applyEdits(rows, queued, '', new Map(), new Set([ownerKey({ tool_use_id: 'a' })]), { freeze: { api } })
  expect(failedA.report.failed.length).toBe(1)
  expect(failedA.prefix).toBe(10)
  // nothing applied: every row stays
  const none = applyEdits(rows, [], '', new Map(), new Set(), { freeze: { api } })
  expect(none.prefix).toBe(rows.length)
  expect(none.rows).toEqual(rows)
})

test('FrozenPrefix — collapse і rewrite: the first row of a collapse span, the row of a rewrite set the first change', async () => {
  const { rows, api } = turn()
  const collapse = prepare(rows, [{ op: 'collapse', from_index: 7, to_index: 9, summary: 'b done' }]).queued
  const c = applyEdits(rows, collapse, '', new Map(), new Set(), { freeze: { api } })
  expect(c.prefix).toBe(7)
  for (let i = 0; i < 7; i++) expect(c.rows[i]).toBe(rows[i]!)
  const rewrite = prepare(rows, [{ op: 'rewrite', index: 13, text: 'finished' }]).queued
  const r = applyEdits(rows, rewrite, '', new Map(), new Set(), { freeze: { api } })
  expect(r.prefix).toBe(13)
  for (let i = 0; i < 13; i++) expect(r.rows[i]).toBe(rows[i]!)
})

// ---- [SP_CTX_02_03] [SP_CTX_02_04] thinking-only rows as anchors (audit PL_AUD_CTX_P3, CF-3)

const bare = (text: string, role: 'user' | 'assistant' = 'assistant'): SessionMessage => ({ role, text, toolUses: [] })

test('PrepareEdits — рядок лише з thinking: a rewrite of it and a collapse that ends on it are refused; a collapse that starts on it is queued', async () => {
  const list = [bare('task', 'user'), bare(''), use('a', 'Read', 'h2'), result('a', 'x', 'h3'), bare('done'), bare('')]
  const { queued, errors } = prepare(list, [
    { op: 'rewrite', index: 1, text: 't' },
    { op: 'collapse', from_index: 4, to_index: 5, summary: 's' },
    { op: 'collapse', from_index: 1, to_index: 4, summary: 's' },
  ])
  expect(errors).toEqual([
    'rewrite #1: row #1 cannot be tracked (no text, no tool call); use a neighbouring row',
    'collapse #4..#5: row #5 holds only thinking and cannot end a range; end it at a row with text or a tool call',
  ])
  expect(queued.map(e => e.op)).toEqual(['collapse'])
})

test('LocateSpan — згортання з thinking-початком на зсунутих рядках: the span is found from its last row; Locate alone would take the other thinking row at the old index', async () => {
  const list = [bare('task', 'user'), bare(''), use('a', 'Read', 'h2'), result('a', 'x', 'h3'), bare('done'), bare('next', 'user')]
  const edit = prepare(list, [{ op: 'collapse', from_index: 1, to_index: 4, summary: 'S' }]).queued
  // the view the seed applies to after a summary: three rows before, one a thinking row at #1
  const shifted = [bare('summary', 'user'), bare(''), bare('copy'), ...list].map((r, i) => ({ ...r, handle: `s${i}` }))
  const out = applyEdits(shifted, edit, '/archive.json')
  expect(out.report.applied).toEqual(['collapse #1..#4'])
  // four rows become a carrier pair
  expect(out.rows.length).toBe(shifted.length - 2)
  expect(out.rows.slice(0, 4)).toEqual(shifted.slice(0, 4))
  expect(out.report.originals[0]!.rows).toEqual(shifted.slice(4, 8))
})

// ---- [PL_AUD_CTX_P6] safety tests before the refactoring (CF-10, CF-14)

const hasMark = (list: readonly SessionMessage[]) => list.some(r => r.text.startsWith(MARK) || (r.toolResults ?? []).some(t => t.text.startsWith(MARK)))

// TST-14
test('ApplyEdits — collapse, якорі зникли: a queued collapse whose first row changed since it was queued fails "the rows it named are no longer there"; nothing is spliced', async () => {
  const input = rows()
  const { queued } = prepare(input, [{ op: 'collapse', from_index: 6, to_index: 8, summary: 'S' }])
  const changed = input.map((r, i) => (i === 6 ? { ...r, text: 'Another conclusion.' } : r))
  const out = applyEdits(changed, queued, '/archive.json')
  expect(out.report.applied).toEqual([])
  expect(out.report.failed).toEqual(['collapse #6..#8: the rows it named are no longer there'])
  expect(out.rows.length).toBe(9)
  expect(hasMark(out.rows)).toBe(false)
  expect(out.made).toEqual([])
})

// TST-14
test('ApplyEdits — collapse, зсунутий проміжок розриває пару: a call without its result came inside the span since it was queued; the collapse fails with the pairing error at the new indexes', async () => {
  const input = rows()
  const { queued } = prepare(input, [{ op: 'collapse', from_index: 6, to_index: 8, summary: 'S' }])
  // a parallel call d whose result stands after the span's last row
  const shifted = [...input.slice(0, 8), use('d', 'Bash', 'hd'), input[8]!, result('d', 'out', 'hr')]
  const out = applyEdits(shifted, queued, '/archive.json')
  expect(out.report.applied).toEqual([])
  expect(out.report.failed).toEqual(['collapse #6..#8: range #6..#9 splits a tool call from its result (d); widen or narrow it'])
  expect(out.rows.flatMap(r => r.toolUses.map(u => u.tool_use_id))).toEqual(['a', 'b', 'c', 'd'])
  expect(out.rows.flatMap(r => (r.toolResults ?? []).map(t => t.tool_use_id))).toEqual(['a', 'b', 'c', 'd'])
  expect(hasMark(out.rows)).toBe(false)
})

// TST-14
test('ApplyEdits — collapse, медіа не заархівовано: a span holding a media owner (a pair or a prompt row) without an archived file fails "media could not be archived"; with the file it applies', async () => {
  const input = rows()
  const { queued } = prepare(input, [{ op: 'collapse', from_index: 6, to_index: 8, summary: 'S' }])
  const pair = applyEdits(input, queued, '/archive.json', new Map(), new Set([ownerKey({ tool_use_id: 'c' })]))
  expect(pair.report.applied).toEqual([])
  expect(pair.report.failed).toEqual(['collapse #6..#8: media could not be archived'])
  expect(pair.rows[8]!.handle).toBe('h8')
  expect(pair.report.mediaFiles).toEqual([])
  const head = prepare(input, [{ op: 'collapse', from_index: 0, to_index: 1, summary: 'S' }]).queued
  const prompt = applyEdits(input, head, '/archive.json', new Map(), new Set([ownerKey({ row: 0 })]))
  expect(prompt.report.failed).toEqual(['collapse #0..#1: media could not be archived'])
  expect(prompt.rows[0]!.handle).toBe('h0')
  const archived = applyEdits(input, queued, '/archive.json', new Map([[ownerKey({ tool_use_id: 'c' }), ['/m/c.png']]]), new Set([ownerKey({ tool_use_id: 'c' })]))
  expect(archived.report.applied).toEqual(['collapse #6..#8'])
  expect(archived.report.mediaFiles).toEqual(['/m/c.png'])
})

// TST-15
test('PrepareEdits — форма правки: a non-object, a missing tool_use_id, from_index or index, an empty description and a text over MAX_TEXT are refused; a summary of exactly MAX_TEXT chars is queued', async () => {
  const { queued, errors } = prepare(rows(), [
    null,
    7,
    { op: 'summarize', summary: 's' },
    { op: 'drop' },
    { op: 'collapse', to_index: 3, summary: 's' },
    { op: 'collapse', from_index: 1.5, to_index: 3, summary: 's' },
    { op: 'rewrite', text: 't' },
    { op: 'describe', description: 'd' },
    { op: 'summarize', tool_use_id: 'a', summary: 'x'.repeat(MAX_TEXT + 1) },
    { op: 'describe', index: 0, description: '' },
    { op: 'rewrite', index: 6, text: 'y'.repeat(MAX_TEXT + 1) },
    { op: 'collapse', from_index: 6, to_index: 8, summary: 'z'.repeat(MAX_TEXT + 1) },
    { op: 'summarize', tool_use_id: 'a', summary: 'z'.repeat(MAX_TEXT) },
  ])
  expect(MAX_TEXT).toBe(8000)
  expect(errors).toEqual([
    'edit 1: edit must be an object',
    'edit 2: edit must be an object',
    'edit 3: tool_use_id is required',
    'edit 4: tool_use_id is required',
    'edit 5: from_index is required',
    'edit 6: from_index is required',
    'edit 7: index is required',
    'edit 8: index is required',
    'edit 9: summary is too long (max 8000 chars)',
    'edit 10: description is required',
    'edit 11: text is too long (max 8000 chars)',
    'edit 12: summary is too long (max 8000 chars)',
  ])
  expect(queued.map(e => e.op)).toEqual(['summarize'])
})

// TST-16
test('PrepareEdits — ціль правки: an index out of range for rewrite and describe, describe of a result or an assistant row, and a ref that is not a string are refused', async () => {
  const raws = [
    { op: 'rewrite', index: 99, text: 't' },
    { op: 'rewrite', index: -1, text: 't' },
    { op: 'describe', index: 99, description: 'd' },
    { op: 'describe', index: 3, description: 'd' },
    { op: 'describe', index: 1, description: 'd' },
    { op: 'summarize', ref: 5, summary: 's' },
    { op: 'drop', ref: { id: 'a' } },
    { op: 'drop', ref: 'c9' },
    { op: 'drop', ref: 'c1', tool_use_id: 'a' },
  ]
  // the way context_edit takes: refs resolved first, then PrepareEdits
  const { edits } = resolveEditRefs(raws, NO_REFS, rows())
  const { queued, errors } = prepare(rows(), edits)
  const hint = '(marked calls carry a "[context-editor] id cN" line after their result)'
  expect(errors).toEqual([
    'rewrite #99: index out of range',
    'rewrite #-1: index out of range',
    'describe #99: index out of range',
    'describe #3: describe applies to a user prompt row; use summarize for tool results',
    'describe #1: describe applies to a user prompt row; use summarize for tool results',
    `edit 6: unknown ref 5 ${hint}`,
    `edit 7: unknown ref {"id":"a"} ${hint}`,
    `edit 8: unknown ref c9 ${hint}`,
    'edit 9: ref and tool_use_id are exclusive',
  ])
  expect(queued).toEqual([])
})

// TST-8
test('context_list — межі сторінки: a negative from starts at #0, a from past the end shows the last row, a count over MAX_LIST_COUNT is cut to it, a count that is not finite gives LIST_COUNT', async () => {
  const many: SessionMessage[] = Array.from({ length: 250 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `r${i}`, toolUses: [] }))
  const shown = (text: string) => text.split('\n').filter(l => /^#\d+/.test(l)).map(l => l.split(' ')[0])
  const neg = listRows(rows(), -5, 2)
  expect(neg).toContain('Showing #0..#1 (oldest first)')
  expect(shown(neg)).toEqual(['#0', '#1'])
  const past = listRows(rows(), 99, 5)
  expect(past).toContain('Showing #8..#8 (oldest first)')
  expect(past).not.toContain('Next page')
  expect(shown(listRows(rows(), 2.7, 1.9))).toEqual(['#2'])
  expect(MAX_LIST_COUNT).toBe(200)
  const cut = listRows(many, 0, 1000)
  expect(cut).toContain('Showing #0..#199 (oldest first)')
  expect(cut).toContain('Next page: from=200.')
  expect(shown(cut).length).toBe(MAX_LIST_COUNT)
  const nan = listRows(many, 0, Number.NaN)
  expect(shown(nan).length).toBe(LIST_COUNT)
  expect(nan).toContain(`Next page: from=${LIST_COUNT}.`)
  expect(listRows([], 0, 5)).toBe('0 rows.')
})

// TST-12, ARCH-20: the id factory of ApplyOptions
test('ApplyEdits — newId: a factory in the options names every edited call (summarize and the collapse carrier); made, renamed and the rows carry those ids', async () => {
  const input = rows()
  const { queued } = prepare(input, [
    { op: 'summarize', tool_use_id: 'a', summary: 'A' },
    { op: 'collapse', from_index: 6, to_index: 8, summary: 'C' },
  ])
  let n = 0
  const out = applyEdits(input, queued, '', new Map(), new Set(), { newId: id => `${id}_n${++n}` })
  expect(out.report.applied).toEqual(['collapse #6..#8', 'summarize a'])
  // the plan runs from the end: the collapse takes the first id
  expect(out.made.map(m => m.resultId)).toEqual(['c_n1', 'a_n2'])
  expect([...out.renamed]).toEqual([['a', 'a_n2']])
  const ids = out.rows.flatMap(r => r.toolUses.map(u => u.tool_use_id))
  expect(ids).toEqual(['a_n2', 'b', 'c_n1'])
  expect(out.rows.flatMap(r => (r.toolResults ?? []).map(t => t.tool_use_id))).toEqual(ids)
})

// TST-12: uniqueness without the factory
test('FreshId — унікальність: two ids made for the same base differ; every edited call of one batch gets its own id, paired with its result', async () => {
  const one = freshId('toolu_01')
  const two = freshId('toolu_01')
  expect(one === two).toBe(false)
  expect(/^toolu_01_ce[0-9a-z]+$/.test(one)).toBe(true)
  const input = [...rows(), ...parallel()]
  const { queued } = prepare(input, [
    { op: 'summarize', tool_use_id: 'a', summary: 'A' },
    { op: 'summarize', tool_use_id: 'b', summary: 'B' },
    { op: 'summarize', tool_use_id: 'p', summary: 'P' },
    { op: 'summarize', tool_use_id: 'q', summary: 'Q' },
    { op: 'collapse', from_index: 6, to_index: 8, summary: 'C' },
  ])
  const out = applyEdits(input, queued, '')
  expect(out.report.applied.length).toBe(5)
  const fresh = out.made.map(m => m.resultId!)
  expect(new Set(fresh).size).toBe(5)
  const uses = out.rows.flatMap(r => r.toolUses.map(u => u.tool_use_id))
  expect(new Set(uses).size).toBe(uses.length)
  expect([...uses].sort()).toEqual([...out.rows.flatMap(r => (r.toolResults ?? []).map(t => t.tool_use_id))].sort())
})
