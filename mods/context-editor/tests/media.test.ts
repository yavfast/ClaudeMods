import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { handleCompaction, type CompactionIO } from '../hooks/compaction'
import { applyEdits, collectMedia, DESCRIBE_DROPS, formatReport, listRows, NO_MEDIA_NOW, ownerKey, prepare, replacedOwners } from '../hooks/edits'
import { matchPrompts } from '../hooks/media'
import { EMPTY_ALIASES } from '../hooks/aliases'
import { buildSeed, SUMMARY_OPENER } from '../hooks/handoff'
import { EMPTY_QUEUE, hasMediaFrom, needsApi, personRefusal, personRow, queueEdits, type Queue } from '../hooks/queue'
import { EMPTY_REGISTRY } from '../hooks/tags'
import { isDescribedText } from '../hooks/rows'
import { DUMPS } from './media-fixtures'
import { prompt, reply, missingRead, okRead } from './row-fixtures'

// [SP_CTX_02_10] PromptMatch and the describe it unblocks ([SP_CTX_DEC_06]).

const img = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })
const text = (t: string) => ({ type: 'text', text: t })
const SR = (t: string) => text(`<system-reminder>\n${t}\n</system-reminder>`)
const asst = (t: string) => ({ role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, text(t)] })
const matched = (api: unknown[], rows: SessionMessage[]) => Object.fromEntries([...matchPrompts(api, rows)].map(([a, r]) => [String(a), r]))

test('PromptMatch — живі дампи: every prompt media message of the probe dumps goes to its row (both hosts, before and after compactions, e.messages, tool.call time)', async () => {
  for (const [name, d] of Object.entries(DUMPS)) {
    expect([name, matched(d.api, d.rows)]).toEqual([name, d.expected])
  }
})

test('PromptMatch — лише зображення: a prompt of one image (Row.text "") is tied by its position; its text is no key', async () => {
  const rows = [prompt('first'), reply('A'), prompt(''), reply('Blue')]
  const api = [{ role: 'user', content: [text('first')] }, asst('A'), { role: 'user', content: [SR('tokens'), img('Ymx1ZQ=='), text('[Image: source: /tmp/x/images/2.png]')] }, asst('Blue')]
  expect(matched(api, rows)).toEqual({ '2': 2 })
})

test('PromptMatch — однаковий текст: two prompts with the same words and different images each get their own row (the answers tell them apart)', async () => {
  const same = 'Same words: name the color, one word.'
  const rows = [prompt(same), reply('Magenta'), prompt(same), reply('Cyan')]
  const api = [{ role: 'user', content: [text(same), img('bWFnZW50YQ==')] }, asst('Magenta'), { role: 'user', content: [text(same), img('Y3lhbg==')] }, asst('Cyan')]
  expect(matched(api, rows)).toEqual({ '0': 0, '2': 2 })
  const { found } = collectMedia(api, rows)
  expect(found.get(ownerKey({ row: 0 }))![0]!.data).toBe('bWFnZW50YQ==')
  expect(found.get(ownerKey({ row: 2 }))![0]!.data).toBe('Y3lhbg==')
})

test('PromptMatch — прикраси: reminders before the prompt, the [Image: source:] note after it and a "\\n" added at a seam do not break the pair; blocks join without a separator', async () => {
  const rows = [prompt('P3 part A.P3 part B: what color?'), reply('Green')]
  const api = [{ role: 'user', content: [SR('env'), SR('skills'), text('P3 part A.'), img('Z3JlZW4='), text('P3 part B: what color?\n'), text('[Image: source: /tmp/x/images/1.png]')] }, asst('Green')]
  expect(matched(api, rows)).toEqual({ '0': 0 })
})

test('PromptMatch — рядки команди: /compact and its output merged with the next prompt into one message; the prompt row owns the media, never a command row', async () => {
  const rows = [
    prompt('task'),
    reply('ok'),
    prompt('<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args>x</command-args>'),
    prompt('<local-command-stdout>Compacted </local-command-stdout>'),
    prompt('P10: color?'),
    reply('Blue'),
  ]
  const api = [
    { role: 'user', content: [text('task')] },
    asst('ok'),
    {
      role: 'user',
      content: [
        SR('tokens'),
        text('<local-command-caveat>The command below was run directly in Claude Code…</local-command-caveat>\n'),
        text('<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args>x</command-args>\n'),
        text('<local-command-stdout>Compacted </local-command-stdout>'),
        img('Ymx1ZQ=='),
        text('P10: color?\n'),
      ],
    },
    asst('Blue'),
  ]
  expect(matched(api, rows)).toEqual({ '2': 4 })
})

test('PromptMatch — @файл у терміналі: an API message of reminders alone (no row) between the answer and the prompt is skipped', async () => {
  const rows = [prompt('[Image #1] T6'), reply('cyan'), prompt('T7: what is in @notes.txt ?[Image #2]'), reply('DELTA, red')]
  const api = [
    { role: 'user', content: [text('[Image #1] T6'), img('Y3lhbg==')] },
    asst('cyan'),
    { role: 'user', content: [SR('Called the Read tool with the following input: {"file_path":"/tmp/notes.txt"}')] },
    { role: 'user', content: [SR('Result of calling the Read tool: DELTA'), text('T7: what is in @notes.txt ?[Image #2]'), img('cmVk')] },
    asst('DELTA, red'),
  ]
  expect(matched(api, rows)).toEqual({ '0': 0, '3': 2 })
})

test('PromptMatch — зсув: a row missing from one form stops the pairing there; older media is "none", never another row', async () => {
  const same = 'Same words: name the color, one word.'
  const rows = [prompt(same), reply('Magenta'), prompt(same), reply('Cyan'), prompt('last'), reply('done')]
  const api = [{ role: 'user', content: [text(same), img('bWFnZW50YQ==')] }, asst('Magenta'), { role: 'user', content: [text(same), img('Y3lhbg==')] }, asst('Cyan'), { role: 'user', content: [text('last')] }, asst('done')]
  expect(matched(api, rows)).toEqual({ '0': 0, '2': 2 })
  // the Cyan turn is gone from the rows: its message would pair with the Magenta turn, whose answer differs
  const shifted = [rows[0]!, rows[1]!, rows[4]!, rows[5]!]
  expect(matched(api, shifted)).toEqual({})
  // the image-only turn is gone: its "" text would pass, the next older pair does not, so it is not trusted
  const lone = [prompt('a'), reply('A'), prompt(''), reply('Yellow'), prompt('b'), reply('B')]
  const loneApi = [{ role: 'user', content: [text('a')] }, asst('A'), { role: 'user', content: [img('eWVsbG93')] }, asst('Yellow'), { role: 'user', content: [text('b'), img('Yg==')] }, asst('B')]
  expect(matched(loneApi, lone)).toEqual({ '2': 2, '4': 4 })
  expect(matched(loneApi, [lone[0]!, lone[1]!, lone[4]!, lone[5]!])).toEqual({})
  expect(collectMedia(loneApi, [lone[0]!, lone[1]!, lone[4]!, lone[5]!]).unmatchedPromptMedia).toBe(2)
})

test('PromptMatch — tool_result у повідомленні: top-level media in a message that carries a tool result (a delivery mid-turn) is "none"', async () => {
  const rows: SessionMessage[] = [
    prompt('go'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b1', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b1', text: 'hi', isError: false }] },
    reply('done'),
  ]
  const api = [
    { role: 'user', content: [text('go')] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'hi' }, SR('The user sent a new message while you were working'), img('cmVk')] },
    asst('done'),
  ]
  expect(matched(api, rows)).toEqual({})
  expect(collectMedia(api, rows).unmatchedPromptMedia).toBe(1)
})

test('PromptMatch — /compact у хвості (термінал): the off-chain "/compact <args>" message the compaction rows lack is left out', async () => {
  const rows = [prompt('look'), reply('red')]
  const api = [{ role: 'user', content: [text('look'), img('cmVk')] }, asst('red'), { role: 'user', content: [text('/compact context-editor: apply queued edits')] }]
  expect(matched(api, rows)).toEqual({ '0': 0 })
})

test('PromptMatch — паралельні виклики: rows written call, result, call, result pair with one merged call message and one result message', async () => {
  const rows: SessionMessage[] = [
    prompt('run both'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'a', isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b', text: 'b', isError: false }] },
    reply('DONE'),
  ]
  const api = [
    { role: 'user', content: [text('run both'), img('cmVk')] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a' }, { type: 'tool_use', id: 'b' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'a' }, { type: 'tool_result', tool_use_id: 'b', content: 'b' }] },
    asst('DONE'),
  ]
  expect(matched(api, rows)).toEqual({ '0': 0 })
})

test('PromptMatch — після вбудованої /compact: the pair at the API form\'s first message (the summary) fails, the newer pairs stay trusted', async () => {
  const summary = 'This session is being continued from a previous conversation that ran out of context.'
  const rows = [prompt('old prompt'), prompt(summary), reply('old answer'), prompt('new'), reply('Magenta')]
  const api = [{ role: 'user', content: [text(summary)] }, asst('old answer'), { role: 'user', content: [SR('tokens'), img('bWFnZW50YQ=='), text('new\n')] }, asst('Magenta')]
  expect(matched(api, rows)).toEqual({ '2': 3 })
})

test('collectMedia — промпт: a tied prompt row owns its media by row index, the listing flags it, and a describe of it is accepted', async () => {
  const rows = [prompt('see this', 'h0'), reply('red', 'h1')]
  const api = [{ role: 'user', content: [SR('env'), text('see this'), img('iVBORw0KGgo=')] }, asst('red')]
  const { found, unmatchedPromptMedia } = collectMedia(api, rows)
  expect(unmatchedPromptMedia).toBe(0)
  expect(found.get(ownerKey({ row: 0 }))![0]!.bytes).toBe(8)
  expect(listRows(rows, 0, 2, found)).toContain('@')
  const has = (o: Parameters<typeof ownerKey>[0]) => found.has(ownerKey(o))
  const ok = prepare(rows, [{ op: 'describe', index: 0, description: 'a red square' }], has)
  expect(ok.errors).toEqual([])
  expect(ok.queued[0]!.anchors!.length).toBe(1)
  const none = prepare(rows, [{ op: 'describe', index: 0, description: 'a red square' }])
  expect(none.errors[0]).toContain('no media or pasted text found in that row')
})

test('context_edit — describe: queueEdits checks the row\'s media through hasMedia', async () => {
  const rows = [prompt('see this'), reply('red')]
  const q: Queue = { ...EMPTY_QUEUE }
  const args = { edits: [{ op: 'describe', index: 0, description: 'a red square' }] }
  const out = queueEdits(q, rows, args, undefined, undefined, false, o => 'row' in o && o.row === 0)
  expect('queue' in out && out.queue.edits.length).toBe(1)
  expect('warnings' in out && out.warnings).toEqual([DESCRIBE_DROPS])
  const no = queueEdits(q, rows, args)
  expect('errors' in no && no.errors[0]).toContain('no media or pasted text found')
})

test('ApplyEdits — describe: the row is rebuilt without handle, its text kept after the description and the media path', async () => {
  const rows = [prompt('see this', 'h0'), reply('red', 'h1')]
  const { queued } = prepare(rows, [{ op: 'describe', index: 0, description: 'a red square' }], () => true)
  expect([...replacedOwners(rows, queued)]).toEqual([ownerKey({ row: 0 })])
  const key = ownerKey({ row: 0 })
  const res = applyEdits(rows, queued, '/a.json', new Map([[key, ['/m/1.png']]]), new Set([key]))
  expect(res.report.applied).toEqual(['describe #0'])
  expect(res.rows[0]!.handle).toBeUndefined()
  expect(res.rows[0]!.text.startsWith(`Later, your context_edit describe call replaced the media you had seen here with your own description (original: /a.json, open with Read) (media: /m/1.png): a red square`)).toBe(true)
  expect(res.rows[0]!.text.endsWith('\n\nsee this')).toBe(true)
  // the media was found but not archived: the reason names the archive, not a missing match
  const unarchived = applyEdits(rows, queued, '/a.json', new Map(), new Set([key]))
  expect(unarchived.report.failed[0]).toBe('describe #0: media could not be archived')
  expect(unarchived.rows[0]!.handle).toBe('h0')
  // [SP_CTX_02_04] the owner not found at apply time: the same refusal, never a describe without its media
  const unmatched = applyEdits(rows, queued, '/a.json', new Map(), new Set())
  expect(unmatched.report.applied).toEqual([])
  expect(unmatched.report.failed[0]).toBe(`describe #0: ${NO_MEDIA_NOW}`)
  expect(formatReport(res.report, '/a.json', 'compaction')).toContain(DESCRIBE_DROPS)
})

// [SP_CTX_02_59] DescribePasted
const PASTED = 'Лог: <pasted_content id="a1b2">line 1\nline 2</pasted_content id="a1b2"> що не так?'

test('DescribePasted — лише вставка: the paste block becomes a mark after the description; the typed text stays; the original goes to the archive', async () => {
  const rows = [prompt(PASTED, 'h0'), reply('ok', 'h1')]
  const { queued, errors } = prepare(rows, [{ op: 'describe', index: 0, description: 'a log of two lines' }])
  expect(errors).toEqual([])
  const res = applyEdits(rows, queued, '/a.json', new Map(), new Set())
  expect(res.report.applied).toEqual(['describe #0'])
  expect(res.rows[0]!.text).toBe(
    'Later, your context_edit describe call replaced the pasted text you had seen here with your own description (original: /a.json, open with Read): a log of two lines\n\nЛог: [pasted text 1, 13 chars: see your description above] що не так?',
  )
  expect(res.report.originals[0]!.rows[0]!.text).toBe(PASTED)
  // the described prompt is still the person's words
  expect(isDescribedText(res.rows[0]!.text)).toBe(true)
})

test('DescribePasted — медіа і вставка, нічого замінювати: both kinds name both; a prompt with neither is refused', async () => {
  const rows = [prompt(`${PASTED} <pasted_content>more</pasted_content>`, 'h0'), reply('ok', 'h1')]
  const key = ownerKey({ row: 0 })
  const { queued } = prepare(rows, [{ op: 'describe', index: 0, description: 'd' }], () => true)
  const res = applyEdits(rows, queued, '/a.json', new Map([[key, ['/m/1.png']]]), new Set([key]))
  expect(res.rows[0]!.text.startsWith('Later, your context_edit describe call replaced the media and the pasted text you had seen here with your own description')).toBe(true)
  expect(res.rows[0]!.text.endsWith('[pasted text 1, 13 chars: see your description above] що не так? [pasted text 2, 4 chars: see your description above]')).toBe(true)
  const plain = [prompt('just typed', 'h0'), reply('ok', 'h1')]
  expect(prepare(plain, [{ op: 'describe', index: 0, description: 'd' }]).errors[0]).toContain('no media or pasted text found in that row')
  // a paste beside media the apply could not match is not described: that media would go unarchived
  const unseen = applyEdits(rows, prepare(rows, [{ op: 'describe', index: 0, description: 'd' }]).queued, '/a.json', new Map(), new Set(), { unmatchedPromptMedia: 1 })
  expect(unseen.report.failed[0]).toBe('describe #0: the prompt may hold media that cannot be archived')
})

test('HandleCompaction — describe: the prompt media is archived from the API form and the row described; an untouched prompt with media keeps its handle', async () => {
  const messages = [prompt('see this', 'h0'), reply('red', 'h1'), prompt('and this', 'h2'), reply('blue', 'h3')]
  const api = [{ role: 'user', content: [text('see this'), img('cmVk')] }, asst('red'), { role: 'user', content: [text('and this'), img('Ymx1ZQ==')] }, asst('blue')]
  const q: Queue = { ...EMPTY_QUEUE, edits: prepare(messages, [{ op: 'describe', index: 0, description: 'a red square' }], () => true).queued }
  const media: string[] = []
  const io: CompactionIO = {
    dir: '/s',
    archives: '/s',
    now: () => 7,
    readQueue: async () => okRead(q),
    writeQueue: async () => undefined,
    readApi: async () => api,
    writeMedia: async path => {
      media.push(path)
      return true
    },
    writeArchive: async () => true,
    isAborted: () => false,
    toast: () => undefined,
    readTags: async () => missingRead({ ...EMPTY_REGISTRY }),
    writeTags: async () => undefined,
    readAliases: async () => missingRead({ ...EMPTY_ALIASES, map: {} }),
    writeAliases: async () => undefined,
    writeBoundary: async () => undefined,
    hostId: () => undefined,
  }
  const out = await handleCompaction(io, messages)
  expect('messages' in out).toBe(true)
  if (!('messages' in out)) return
  expect(media.length).toBe(1)
  expect(out.messages[0]!.text).toContain('a red square')
  expect(out.messages[0]!.handle).toBeUndefined()
  expect(out.messages[2]!.handle).toBe('h2')
})

test('BuildSeed — медіа в промптах: a described prompt\'s media goes to a file named in its row; an untouched one is counted as not carried', async () => {
  const rows = [prompt('see this', 'h0'), reply('red', 'h1'), prompt('and this', 'h2'), reply('blue', 'h3')]
  const api = [{ role: 'user', content: [text('see this'), img('cmVk')] }, asst('red'), { role: 'user', content: [text('and this'), img('Ymx1ZQ==')] }, asst('blue')]
  const written: string[] = []
  const out = await buildSeed({
    transcript: rows,
    rows,
    api,
    edits: prepare(rows, [{ op: 'describe', index: 0, description: 'a red square' }], () => true).queued,
    tags: missingRead({ ...EMPTY_REGISTRY }),
    folder: '/s/old/1',
    archive: '/s/old/1.json',
    writeMedia: async path => (written.push(path), true),
  })
  if ('refuse' in out) throw new Error(out.reason)
  expect(written).toEqual(['/s/old/1/1.png'])
  expect(out.report.applied).toEqual(['describe #0'])
  expect(out.rows[0]!.text).toContain('(media: /s/old/1/1.png): a red square')
  expect(out.unmatchedPromptMedia).toBe(1)
})

test('context_edit — needsApi і hasMediaFrom: the API form is read only for a describe; hasMedia answers from CollectMedia\'s owners', async () => {
  expect(needsApi({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 's' }, { op: 'describe', index: 0, description: 'd' }] })).toBe(true)
  expect(needsApi({ edits: [{ op: 'rewrite', index: 1, text: 't' }, null, 'x'] })).toBe(false)
  expect(needsApi({ edits: 'describe' })).toBe(false)
  const { found } = collectMedia([{ role: 'user', content: [text('see'), img('cmVk')] }, asst('red')], [prompt('see'), reply('red')])
  const has = hasMediaFrom(found)
  expect(has({ row: 0 })).toBe(true)
  expect(has({ row: 1 })).toBe(false)
  expect(hasMediaFrom()({ row: 0 })).toBe(false)
})

function compactionIO(api: unknown[], q: Queue, media: string[], saved: Queue[] = []): CompactionIO {
  return {
    dir: '/s',
    archives: '/s',
    now: () => 7,
    readQueue: async () => okRead(q),
    writeQueue: async next => void saved.push(next),
    readApi: async () => api,
    writeMedia: async path => {
      media.push(path)
      return true
    },
    writeArchive: async () => true,
    isAborted: () => false,
    toast: () => undefined,
    readTags: async () => missingRead({ ...EMPTY_REGISTRY }),
    writeTags: async () => undefined,
    readAliases: async () => missingRead({ ...EMPTY_ALIASES, map: {} }),
    writeAliases: async () => undefined,
    writeBoundary: async () => undefined,
    hostId: () => undefined,
  }
}

// queue time: matched; apply time: the tail pair disagrees (a trailing user row the API form lacks)
const drifted = () => ({
  rows: [prompt('see this', 'h0'), reply('red', 'h1'), prompt('next', 'h2'), reply('ok', 'h3'), prompt('<command-name>/x</command-name>', 'h4')],
  api: [{ role: 'user', content: [text('see this'), img('cmVk')] }, asst('red'), { role: 'user', content: [text('next')] }, asst('ok')],
})

test('HandleCompaction — describe без зіставлення при застосуванні: no media archived, the edit fails "no media or pasted text found in that row now", the row keeps its handle', async () => {
  const { rows, api } = drifted()
  const q: Queue = { ...EMPTY_QUEUE, edits: prepare(rows, [{ op: 'describe', index: 0, description: 'a red square' }], () => true).queued }
  const media: string[] = []
  const saved: Queue[] = []
  const out = await handleCompaction(compactionIO(api, q, media, saved), rows)
  expect(media.length).toBe(0)
  // nothing applied: the compaction is skipped and the rows stay as they were
  expect('skip' in out).toBe(true)
  expect(saved.at(-1)!.report).toContain(`describe #0: ${NO_MEDIA_NOW}`)
})

test('BuildSeed — describe без зіставлення: the edit fails "no media or pasted text found in that row now", the prompt text stays as it was', async () => {
  const { rows, api } = drifted()
  const written: string[] = []
  const out = await buildSeed({
    transcript: rows,
    rows,
    api,
    edits: prepare(rows, [{ op: 'describe', index: 0, description: 'a red square' }], () => true).queued,
    tags: missingRead({ ...EMPTY_REGISTRY }),
    folder: '/s/old/1',
    archive: '/s/old/1.json',
    writeMedia: async path => (written.push(path), true),
  })
  if ('refuse' in out) throw new Error(out.reason)
  expect(written).toEqual([])
  expect(out.report.applied).toEqual([])
  expect(out.report.failed).toEqual([`describe #0: ${NO_MEDIA_NOW}`])
  expect(out.rows[0]!.text).toBe('see this')
})

test('HandleCompaction — describe, медіа знайдено, але не заархівовано: the edit fails "media could not be archived", not "no media found"', async () => {
  const rows = [prompt('see this', 'h0'), reply('red', 'h1')]
  const api = [{ role: 'user', content: [text('see this'), img('cmVk')] }, asst('red')]
  const q: Queue = { ...EMPTY_QUEUE, edits: prepare(rows, [{ op: 'describe', index: 0, description: 'a red square' }], () => true).queued }
  const saved: Queue[] = []
  const io = { ...compactionIO(api, q, [], saved), writeMedia: async () => false }
  const out = await handleCompaction(io, rows)
  expect('skip' in out).toBe(true)
  expect(saved.at(-1)!.report).toContain('describe #0: media could not be archived')
  expect(saved.at(-1)!.report).not.toContain(NO_MEDIA_NOW)
})

test('BuildSeed — після підсумку: prompt media in the rows after a built-in compaction summary is matched on the visible rows and described', async () => {
  const summary = `${SUMMARY_OPENER} that ran out of context. The summary below covers it.`
  const rows: SessionMessage[] = [
    prompt('old task', 'h0'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'h1' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'old', isError: false }], handle: 'h2' },
    prompt(summary, 'h3'),
    reply('Blue', 'h4'),
    prompt('look', 'h5'),
    reply('Red', 'h6'),
  ]
  const api = [{ role: 'user', content: [text(summary)] }, asst('Blue'), { role: 'user', content: [SR('tokens'), text('look'), img('cmVk')] }, asst('Red')]
  const written: string[] = []
  const out = await buildSeed({
    transcript: rows,
    rows,
    api,
    edits: prepare(rows, [{ op: 'describe', index: 5, description: 'a red square' }], () => true).queued,
    tags: missingRead({ ...EMPTY_REGISTRY }),
    folder: '/s/old/1',
    archive: '/s/old/1.json',
    writeMedia: async path => (written.push(path), true),
  })
  if ('refuse' in out) throw new Error(out.reason)
  expect(out.fromSummary).toBe(true)
  expect(written).toEqual(['/s/old/1/1.png'])
  expect(out.report.applied).toEqual(['describe #5'])
  const described = out.rows.find(r => r.text.includes('a red square'))!
  expect(described.text).toContain('(media: /s/old/1/1.png)')
  expect(described.text.endsWith('\n\nlook')).toBe(true)
  expect(out.unmatchedPromptMedia).toBe(0)
})

// [SP_CTX_02_10] [SP_CTX_02_36] phase 20: an inserted delivery row is a decoration, as its text block is in the API form
test('PromptMatch — вставлена доставка: a subagent report row (<system-reminder id=…>) after a result does not shift the pairs', async () => {
  const report = '<system-reminder id="r1">\nAnother Claude session sent a message while you were working:\nTEAL\n</system-reminder>'
  const rows: SessionMessage[] = [
    prompt('see this'),
    reply('ok'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'r', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'r', text: 'x', isError: false }] },
    prompt(report),
    reply('TEAL'),
  ]
  const api = [
    { role: 'user', content: [text('see this'), img('cmVk')] },
    { role: 'assistant', content: [text('ok'), { type: 'tool_use', id: 'r', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r', content: 'x' }, text(report)] },
    asst('TEAL'),
  ]
  expect(matched(api, rows)).toEqual({ '0': 0 })
})

// [PL_AUD_CTX_P6] TST-17
test('PromptMatch — два промпти в одній одиниці: two person rows before one answer (one API message) leave the media unmatched, never tied to either row', async () => {
  const rows = [prompt('task'), reply('ok'), prompt('part one'), prompt('part two'), reply('Blue')]
  const api = [{ role: 'user', content: [text('task')] }, asst('ok'), { role: 'user', content: [text('part one'), text('part two'), img('Ymx1ZQ==')] }, asst('Blue')]
  expect(matched(api, rows)).toEqual({})
  const { found, unmatchedPromptMedia } = collectMedia(api, rows)
  expect(unmatchedPromptMedia).toBe(1)
  expect(found.has(ownerKey({ row: 2 }))).toBe(false)
  expect(found.has(ownerKey({ row: 3 }))).toBe(false)
  // the same unit with one person row ties the media to it
  const one = [prompt('task'), reply('ok'), prompt('part onepart two'), reply('Blue')]
  expect(matched(api, one)).toEqual({ '2': 2 })
})

// [SP_CTX_02_59] media found but not archived beside a paste: never rebuilt away
test('DescribePasted — медіа не заархівовано: a prompt with media and a paste whose media failed to archive is refused; its text stays', async () => {
  const rows = [prompt(PASTED, 'h0'), reply('ok', 'h1')]
  const key = ownerKey({ row: 0 })
  const { queued } = prepare(rows, [{ op: 'describe', index: 0, description: 'd' }], () => true)
  const res = applyEdits(rows, queued, '/a.json', new Map(), new Set([key]))
  expect(res.report.failed).toEqual(['describe #0: media could not be archived'])
  expect(res.rows[0]!.text).toBe(PASTED)
  expect(res.rows[0]!.handle).toBe('h0')
})

test('DescribePasted — поза вікном API: a paste-only describe of a prompt before the first known result is refused while the API form is cut', async () => {
  const rows = [prompt(PASTED, 'h0'), { role: 'assistant' as const, text: '', toolUses: [{ tool_use_id: 'r', tool: 'Bash', input: {} }], handle: 'h1' }, { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 'r', text: 'x', isError: false }], handle: 'h2' }]
  const { queued } = prepare(rows, [{ op: 'describe', index: 0, description: 'd' }])
  const res = applyEdits(rows, queued, '/a.json', new Map(), new Set(), { apiTruncated: true, knownResults: new Set(['r']) })
  expect(res.report.failed).toEqual(['describe #0: outside the API window; media unknown'])
  expect(res.rows[0]!.text).toBe(PASTED)
})

// [SP_CTX_02_58] [SP_CTX_05_08] a described prompt stays the person's words
test('PersonWords — описаний промпт: a collapse over it names "(described prompt)"; a paste-only prompt keeps only the mark and stays protected', async () => {
  const only = '<pasted_content id="f1">a log</pasted_content id="f1">'
  const rows = [prompt(only, 'h0'), reply('ok', 'h1')]
  const done = applyEdits(rows, prepare(rows, [{ op: 'describe', index: 0, description: 'a log line' }]).queued, '/a.json', new Map(), new Set())
  expect(done.rows[0]!.text.endsWith('\n\n[pasted text 1, 5 chars: see your description above]')).toBe(true)
  const after = done.rows
  expect(personRow(after, 0)).toBe(true)
  const [collapse] = prepare(after, [{ op: 'collapse', from_index: 0, to_index: 1, summary: 's' }]).queued
  expect(personRefusal(after, collapse!)).toContain('#0 (described prompt)')
})

test('PersonWords — промпт лише з медіа і описаний промпт плагіна: no person\'s words before a describe, the person\'s words after it', async () => {
  const media = [prompt('', 'h0'), reply('ok', 'h1')]
  expect(personRow(media, 0)).toBe(false)
  const key = ownerKey({ row: 0 })
  const described = applyEdits(media, prepare(media, [{ op: 'describe', index: 0, description: 'a red square' }], () => true).queued, '/a.json', new Map([[key, ['/m/1.png']]]), new Set([key]))
  expect(personRow(described.rows, 0)).toBe(true)
  const plugin = [prompt(`The other plugin sent a message:\n${PASTED}`, 'h0'), reply('ok', 'h1')]
  expect(personRow(plugin, 0)).toBe(false)
  const framed = applyEdits(plugin, prepare(plugin, [{ op: 'describe', index: 0, description: 'd' }]).queued, '/a.json', new Map(), new Set())
  expect(personRow(framed.rows, 0)).toBe(true)
})
