import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applyEdits, collectMedia, dropOwnCalls, formatReport, freshId, listRows, MARK, ownerKey, prepare, replacedOwners } from '../hooks/edits'

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
  expect(out[4]!.handle).toBe('h6')
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

test('pair edits and collapses outside the API window are refused', async () => {
  const input = rows()
  const pairs = applyEdits(input, prepare(input, [{ op: 'summarize', tool_use_id: 'a', summary: 's' }]).queued, '', new Map(), new Set(), {
    knownResults: new Set(['b', 'c']),
  })
  expect(pairs.report.failed[0]).toContain('outside the API window')
  const span = applyEdits(input, prepare(input, [{ op: 'collapse', from_index: 0, to_index: 1, summary: 's' }]).queued, '', new Map(), new Set(), {
    knownResults: new Set(['b', 'c']),
  })
  expect(span.report.failed[0]).toContain('outside the API window')
  const inside = applyEdits(input, prepare(input, [{ op: 'collapse', from_index: 6, to_index: 8, summary: 's' }]).queued, '', new Map(), new Set(), {
    knownResults: new Set(['a', 'b', 'c']),
  })
  expect(inside.report.applied.length).toBe(1)
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
  const text = formatReport(report, '/archive.json')
  expect(text).toContain('applied 1 edit(s): drop c')
  expect(text).toContain('Originals archived at /archive.json')
  expect(formatReport(report, '')).not.toContain('Originals archived')
})
