import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applyEdits, collectMedia, dropOwnCalls, fingerprint, formatReport, freshId, listRows, MARK, mergeCallRows, ownerKey, prepare, producedRows, replacedOwners, ROW_WINDOW } from '../hooks/edits'

const BIG = 'x'.repeat(5000)

function use(id: string, tool: string, h: string): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: { q: id }, text: 'ORIGINAL' }], handle: h }
}
function result(id: string, text: string, h: string): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }], handle: h }
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
  expect(out[3]!.toolResults![0]!.text).toContain('4 rows collapsed')
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
  expect(out[0]!.text).toContain('2 rows collapsed')
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
  expect(overlap.report.applied.length).toBe(1)
  expect(overlap.report.failed[0]).toContain('overlaps')
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
  ])
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
  const of = (n: number) => collectMedia(Array.from({ length: n }, () => ({ role: 'user', content: 'x' }))).apiTruncated
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
  const empty = { applied: [], failed: [], charsBefore: 100, charsAfter: 100, originals: [], produced: [], notesDropped: [], mediaFiles: [] }
  const none = formatReport({ ...empty, failed: ['x'] }, '/a.json', 'compaction')
  expect(none).toBe('context-editor: no edit was applied; the conversation was not changed. Not applied: x.')
  expect(none).not.toContain('Conversation ~')
  expect(none).not.toContain('tokens freed')
  expect(formatReport(empty, '/a.json', 'seed')).toBe('')
  expect(formatReport({ ...empty, failed: ['x'] }, '/a.json', 'seed')).toBe('context-editor: no queued edit was applied. Not applied: x.')
  const done = formatReport({ ...empty, applied: ['y'], charsAfter: 60 }, '/a.json', 'seed')
  expect(done).toBe('context-editor: applied 1 edit(s): y. Conversation ~100 -> ~60 chars (~10 tokens freed).')
  expect(formatReport({ ...empty, applied: ['y'], charsAfter: 60 }, '/a.json', 'compaction')).toContain('Conversation ~100 -> ~60 chars (~10 tokens freed).')
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
  expect(out.rows[1]!.text).toBe('[context-editor] rewritten (original: /s/1.json, open with Read): right')
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
