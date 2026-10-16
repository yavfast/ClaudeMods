import type { SessionMessage } from 'claude-code'
import { HANDOFF_COMMAND_PASSED_OVER, HANDOFF_PASSED_OVER } from '../hooks/capabilities'
import { expect, test } from 'claude-code/testing'
import { handleCompaction, HANDOFF_MARKER, type CompactionIO } from '../hooks/compaction'
import { parseAliases, refResolver, type AliasRegistry } from '../hooks/aliases'
import {
  boundaryOf,
  boundaryView,
  currentRows,
  fingerprint,
  formatReport,
  prepare,
  recordBoundary,
  resolveEditRefs,
  type Boundary,
  type BoundaryMemory,
} from '../hooks/edits'
import { MARK, toolRefWords, totalChars } from '../hooks/rows'
import {
  awaitSeeded,
  buildSeed,
  cancelHandoff,
  carryNote,
  checkSeed,
  checkSeeded,
  contextHandoff,
  DOCUMENT_FRAME,
  documentText,
  dropRequest,
  handleSeed,
  HANDOFF_DELAY_MS,
  HANDOFF_PROMPT,
  HANDOFF_STALE_MS,
  handoffAfterTurn,
  handoffCommand,
  handoffDue,
  newHandoffMemory,
  pinSummary,
  queueHandoff,
  ROW_WINDOW,
  runHandoff,
  SEED_POLL_MS,
  SEED_ROOM,
  SEED_WAIT_MS,
  logSeeded,
  seedReportTail,
  startHandoff,
  SUMMARY_OPENER,
  TRANSCRIPT_LINE,
  type HandoffIO,
  type HandoffSeed,
  type SeedInput,
  parseSeedNames,
  type SeedIO,
} from '../hooks/handoff'
import { DEFAULT_RESUME, EMPTY_QUEUE, MAX_DOCUMENT, parseQueue, type HandoffRequest, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { EMPTY_REGISTRY, MAX_TAGS, type TagRegistry } from '../hooks/tags'
import { newTurns, turnCompleted, turnStarted } from '../hooks/turns'
import type { QueuedDelivery } from '../hooks/deliveries'
import { result, use, missingRead, okRead, unreadableRead } from './row-fixtures'

const BIG = 'KEY_0042 = 2c5f\n' + 'x'.repeat(5000)
const PNG = 'iVBORw0KGgo='
const NOW = 1_000_000
const FOLDER = '/s/old/1'

function conversation(): SessionMessage[] {
  return [
    { role: 'user', text: 'task: find KEY_0042', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: 'reading', toolUses: [], handle: 'h1' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: { file_path: 'big.txt' } }], handle: 'h2' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: BIG, isError: false }], handle: 'h3' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b', tool: 'Read', input: { file_path: 'shot.png' } }], handle: 'h4' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b', text: '', isError: false }], handle: 'h5' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'c', tool: 'Grep', input: { pattern: 'KEY' } }], handle: 'h6' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'c', text: 'matches', isError: false }], handle: 'h7' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'h', tool: 'mcp__context-editor__context_handoff', input: {} }], handle: 'h8' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'h', text: 'Handoff queued', isError: false }], handle: 'h9' },
    { role: 'assistant', text: 'handing off', toolUses: [], handle: 'h10' },
  ]
}

const image = (data = PNG) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })
// the API gives a URL source no media_type: the CarryNote names the block type
const pdfByUrl = { type: 'document', source: { type: 'url', url: 'https://x/doc.pdf' } }

function api(bContent: unknown[] = [image()]): unknown[] {
  return [
    { role: 'user', content: 'task: find KEY_0042' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: BIG }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: bContent }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: 'matches' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h', content: 'Handoff queued' }] },
  ]
}

const text = (role: 'user' | 'assistant', t: string): SessionMessage => ({ role, text: t, toolUses: [] })
const alternating = (n: number): SessionMessage[] => Array.from({ length: n }, (_, i) => text(i % 2 ? 'assistant' : 'user', `row ${i}`))

async function seedOf(over: Partial<SeedInput> = {}, edits: unknown[] = []) {
  const rows = over.rows ?? conversation()
  const written: string[] = []
  const out = await buildSeed({
    transcript: rows,
    rows,
    api: api(),
    edits: prepare(rows, edits).queued,
    tags: missingRead({ ...EMPTY_REGISTRY }),
    folder: FOLDER,
    archive: '/s/old/1.json',
    writeMedia: async path => (written.push(path), true),
    ...over,
  })
  return { out, written }
}

function built(out: Awaited<ReturnType<typeof buildSeed>>) {
  if ('refuse' in out) throw new Error(`refused ${out.refuse}: ${out.reason}`)
  return out
}

// ---- [SP_CTX_02_22] BuildSeed

// [SP_CTX_01_28] phase 41: the seed's summarize names the source relative to the cwd it was given
test('BuildSeed — джерело заміни: with cwd the summarize names Read and the relative path; without it the path as the call gave it', async () => {
  const rows = conversation().map(r => ({ ...r, toolUses: r.toolUses.map(u => (u.tool_use_id === 'a' ? { ...u, input: { file_path: '/p/docs/big.txt' } } : u)) }))
  const textOf = (seed: ReturnType<typeof built>) => seed.rows.flatMap(r => r.toolResults ?? []).find(t => t.text.includes('KEY_0042 = 2c5f'))!.text
  const edits = [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }]
  expect(textOf(built((await seedOf({ rows, cwd: '/p' }, edits)).out))).toContain('the full output of Read docs/big.txt you had read here')
  expect(textOf(built((await seedOf({ rows }, edits)).out))).toContain('the full output of Read /p/docs/big.txt you had read here')
})

test('BuildSeed — правки й медіа: summarize and drop applied, the PNG of the untouched pair carried as a file, no context_handoff, no handle', async () => {
  const { out, written } = await seedOf({}, [
    { op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' },
    { op: 'drop', tool_use_id: 'c' },
  ])
  const seed = built(out)
  expect(seed.report.applied.sort()).toEqual(['drop c', 'summarize a'])
  expect(written).toEqual([`${FOLDER}/1.png`])
  const shot = seed.rows.flatMap(r => r.toolResults ?? []).find(t => t.tool_use_id === 'b')!
  expect(shot.text).toBe(`${MARK} media carried as files (open them with Read): image/png ${FOLDER}/1.png`)
  expect(shot.text.endsWith(carryNote([{ mediaType: 'image/png', bytes: 8, data: PNG }], [`${FOLDER}/1.png`]))).toBe(true)
  expect(JSON.stringify(seed.rows)).not.toContain('context_handoff')
  expect(JSON.stringify(seed.rows)).not.toContain('Grep')
  expect(JSON.stringify(seed.rows)).not.toContain('x'.repeat(100))
  expect(seed.rows.every(r => r.handle === undefined)).toBe(true)
  expect(seed.report.mediaFiles).toEqual([`${FOLDER}/1.png`])
  expect(checkSeed(seed.rows)).toBeUndefined()
})

// [SP_CTX_02_22] [SP_CTX_02_36] phase 20
test('BuildSeed — доставки в засіві: behind an untouched pair and behind a summarized one, each right after its result row', async () => {
  const d = (uuid: string, anchor: string, t: string): QueuedDelivery => ({ uuid, anchor: [anchor], kind: 'person', origin: 'composer', text: t, cut: 0, media: 0, at: 1 })
  const one = '<system-reminder>\nThe user sent a new message while you were working:\nPELICAN\n</system-reminder>'
  const two = '<system-reminder>\nThe user sent a new message while you were working:\nHERON\n</system-reminder>'
  const seed = built(
    (await seedOf({ deliveries: okRead({ items: [d('d1', 'c', one), d('d2', 'a', two)] }) }, [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }])).out,
  )
  const at1 = seed.rows.findIndex(r => r.text === one)
  const at2 = seed.rows.findIndex(r => r.text === two)
  expect(seed.rows[at1 - 1]!.toolResults![0]!.tool_use_id).toBe('c')
  expect(seed.rows[at2 - 1]!.toolResults![0]!.tool_use_id.startsWith('a_ce')).toBe(true)
  expect(checkSeed(seed.rows)).toBeUndefined()
  expect(seed.report.deliveries).toEqual({ inserted: 2, removed: 0 })
  expect(formatReport(seed.report, '/s/old/1.json', 'seed')).toContain('Messages delivered during your tool calls: 2 now stand as rows.')
})

// [SP_CTX_01_05] phase 18
test('BuildSeed — NowIndex у засіві: the report names the summarized pair by its result row in the seeded list', async () => {
  const seed = built((await seedOf({}, [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }])).out)
  const k = seed.rows.findIndex(r => (r.toolResults ?? []).some(t => t.text.includes('summarize call replaced the full output')))
  expect(k).toBeGreaterThan(0)
  expect(seed.report.produced.map(p => p.index)).toEqual([k])
  expect(seedReportTail({ report: seed.report, archive: '/s/old/1.json' })).toContain(`applied 1 edit(s): summarize a (now #${k}).`)
  expect(seed.report.applied).toEqual(['summarize a'])
})

test('BuildSeed — однакові ролі поспіль: two assistant rows in a row stay apart and CheckSeed takes them', async () => {
  const seed = built((await seedOf()).out)
  expect(seed.rows[1]!.text).toBe('reading')
  expect(seed.rows[2]!.toolUses[0]!.tool_use_id).toBe('a')
  expect(seed.rows[1]!.role).toBe('assistant')
  expect(seed.rows[2]!.role).toBe('assistant')
  expect(checkSeed(seed.rows)).toBeUndefined()
})

test('BuildSeed — модель бачить усе: no head, fromSummary false, the seed is CurrentRows with the edits', async () => {
  const seed = built((await seedOf()).out)
  expect(seed.fromSummary).toBe(false)
  expect(seed.rows[0]!.text).toBe('task: find KEY_0042')
  // the context_handoff pair is the only one gone
  expect(seed.rows.length).toBe(conversation().length - 2)
})

const SUMMARY = `${SUMMARY_OPENER} that ran out of context. The conversation is summarized below:\nKEY_0042 = 2c5f\nIf you need specific details from before compaction, read the full transcript at: /home/u/.claude/projects/p/old.jsonl`
const REMINDER = '<system-reminder>\nCalled the Read tool with big.txt\n</system-reminder>'

// six old rows (result a outside the API form), the summary, the copy of the
// last assistant text, the pair b
function compacted(): SessionMessage[] {
  return [
    text('user', 'task: find KEY_0042'),
    text('assistant', 'reading'),
    use('a'),
    result('a', BIG),
    text('assistant', 'thinking about it'),
    text('user', 'go on'),
    text('user', SUMMARY),
    text('assistant', 'handing off soon'),
    use('b'),
    result('b', 'KEY_0099 = 77'),
  ]
}

function compactedApi(first: unknown = { role: 'user', content: [{ type: 'text', text: SUMMARY }] }): unknown[] {
  return [
    first,
    { role: 'assistant', content: [{ type: 'text', text: 'handing off soon' }] },
    { role: 'user', content: [{ type: 'text', text: REMINDER }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'KEY_0099 = 77' }] },
  ]
}

test('BuildSeed — після вбудованої компактизації: the summary without the path line first, then the copy and pair b; summarize a fails', async () => {
  const rows = compacted()
  const seed = built((await seedOf({ rows, transcript: rows, api: compactedApi() }, [{ op: 'summarize', tool_use_id: 'a', summary: 's' }])).out)
  expect(seed.fromSummary).toBe(true)
  expect(seed.rows.map(r => r.text)).toEqual([
    `${SUMMARY_OPENER} that ran out of context. The conversation is summarized below:\nKEY_0042 = 2c5f`,
    'handing off soon',
    '',
    '',
  ])
  expect(seed.rows[2]!.toolUses[0]!.tool_use_id).toBe('b')
  expect(seed.rows[3]!.toolResults![0]!.text).toBe('KEY_0099 = 77')
  expect(JSON.stringify(seed.rows)).not.toContain('system-reminder')
  expect(JSON.stringify(seed.rows)).not.toContain(TRANSCRIPT_LINE)
  expect(seed.report.failed).toEqual(['summarize a: the model no longer sees this row'])
  expect(checkSeed(seed.rows)).toBeUndefined()
})

// [SP_CTX_02_22] audit PL_AUD_CTX_P3, CF-5: a reminder with attributes (a subagent's report, phase 20)
test('BuildSeed — нагадування з атрибутами: a `<system-reminder id="…">` block before the summary in the first API message is left out, as a bare one is', async () => {
  const rows = compacted()
  const first = { role: 'user', content: [{ type: 'text', text: '<system-reminder id="r1">\nA subagent reported.\n</system-reminder>' }, { type: 'text', text: SUMMARY }] }
  const seed = built((await seedOf({ rows, transcript: rows, api: compactedApi(first) })).out)
  expect(seed.fromSummary).toBe(true)
  expect(seed.rows[0]!.text.startsWith(SUMMARY_OPENER)).toBe(true)
  expect(JSON.stringify(seed.rows)).not.toContain('system-reminder')
})

test('BuildSeed — підсумку немає (NO_SUMMARY): the first API message is the assistant\'s, holds a tool_result, or is a prompt without SUMMARY_OPENER', async () => {
  const rows = compacted()
  for (const first of [
    { role: 'assistant', content: [{ type: 'text', text: SUMMARY }] },
    { role: 'user', content: [{ type: 'text', text: SUMMARY }, { type: 'tool_result', tool_use_id: 'b', content: 'x' }] },
    { role: 'user', content: 'a prompt of the person' },
  ]) {
    const { out } = await seedOf({ rows, transcript: rows, api: compactedApi(first) })
    expect('refuse' in out && out.refuse).toBe('NO_SUMMARY')
  }
})

test('BuildSeed — заповнене вікно при прихованих рядках (WINDOW_FULL): an API form of 4096 messages, or a read of 4096 rows; the summary is not looked for', async () => {
  const rows = compacted()
  const fullApi = Array.from({ length: ROW_WINDOW }, (_, i) => (i === 0 ? { role: 'user', content: SUMMARY } : { role: 'user', content: 'x' }))
  const a = await seedOf({ rows, transcript: rows, api: fullApi })
  expect('refuse' in a.out && a.out.refuse).toBe('WINDOW_FULL')
  const transcript = [...alternating(ROW_WINDOW - rows.length), ...rows]
  const b = await seedOf({ rows, transcript, api: compactedApi({ role: 'user', content: 'not a summary' }) })
  expect('refuse' in b.out && b.out.refuse).toBe('WINDOW_FULL')
})

test('BuildSeed — збіг підсумку: whitespace and line breaks aside; a summary shorter than 160 chars', async () => {
  const short = `${SUMMARY_OPENER}. KEY 1`
  const rows = [text('user', 'old'), use('a'), result('a'), text('user', `${SUMMARY_OPENER}.\n\n   KEY\t1`), text('assistant', 'next')]
  const seed = built((await seedOf({ rows, transcript: rows, api: [{ role: 'user', content: [{ type: 'text', text: short }] }, { role: 'assistant', content: 'next' }] })).out)
  expect(seed.rows.map(r => r.text)).toEqual([short, 'next'])
})

test('BuildSeed — нагадування в підсумку: the head is the summary text alone', async () => {
  const short = `${SUMMARY_OPENER}. KEY 1`
  const rows = [text('user', 'old'), use('a'), result('a'), text('user', short), text('assistant', 'next')]
  const first = { role: 'user', content: [{ type: 'text', text: short }, { type: 'text', text: `  ${REMINDER}` }] }
  const seed = built((await seedOf({ rows, transcript: rows, api: [first, { role: 'assistant', content: 'next' }] })).out)
  expect(seed.rows[0]!.text).toBe(short)
})

test('BuildSeed — підсумок не знайдено (SUMMARY_NOT_FOUND): the first API text is in no prompt row', async () => {
  const rows = compacted()
  const { out } = await seedOf({ rows, transcript: rows, api: compactedApi({ role: 'user', content: `${SUMMARY_OPENER}: something else entirely` }) })
  expect('refuse' in out && out.refuse).toBe('SUMMARY_NOT_FOUND')
})

test('BuildSeed — HIDDEN_AFTER_SUMMARY: a result the API form lacks follows the summary', async () => {
  const rows = [...compacted(), use('z'), result('z')]
  const { out } = await seedOf({ rows, transcript: rows, api: compactedApi() })
  expect('refuse' in out && out.refuse).toBe('HIDDEN_AFTER_SUMMARY')
})

test('BuildSeed — заповнене вікно (WINDOW_FULL): 4096 rows, no boundary, every result seen', async () => {
  const rows = alternating(ROW_WINDOW)
  const { out } = await seedOf({ rows, transcript: rows, api: [] })
  expect('refuse' in out && out.refuse).toBe('WINDOW_FULL')
})

test('BuildSeed — заповнене вікно з межею: 4096 rows read, CurrentRows found a boundary: the seed is built', async () => {
  const transcript = alternating(ROW_WINDOW)
  const seed = built((await seedOf({ rows: transcript.slice(-10), transcript, api: [] })).out)
  expect(seed.rows.length).toBe(10)
})

test('BuildSeed — завеликий засів (SEED_TOO_LONG): longer than ROW_WINDOW − SEED_ROOM after normalizing', async () => {
  const rows = alternating(ROW_WINDOW - 1)
  const { out } = await seedOf({ rows, transcript: rows, api: [] })
  expect('refuse' in out && out.refuse).toBe('SEED_TOO_LONG')
  expect('refuse' in out && out.reason).toContain(`at most ${ROW_WINDOW - SEED_ROOM}`)
  const fits = alternating(ROW_WINDOW - SEED_ROOM)
  expect('rows' in (await seedOf({ rows: fits, transcript: fits, api: [] })).out).toBe(true)
})

test('BuildSeed — підсумок посеред рядків: every result seen, but a later prompt row starts with SUMMARY_OPENER: the seed starts from that summary', async () => {
  const short = `${SUMMARY_OPENER}. KEY 2`
  const rows = [text('user', 'task'), text('assistant', 'a1'), text('user', short), text('assistant', 'after')]
  const seed = built((await seedOf({ rows, transcript: rows, api: [{ role: 'user', content: short }, { role: 'assistant', content: 'after' }] })).out)
  expect(seed.fromSummary).toBe(true)
  expect(seed.rows.map(r => r.text)).toEqual([short, 'after'])
})

test('BuildSeed — вміст рядком: content given as a string is one text block; the summary is found', async () => {
  const rows = compacted()
  const seed = built((await seedOf({ rows, transcript: rows, api: compactedApi({ role: 'user', content: SUMMARY }) })).out)
  expect(seed.fromSummary).toBe(true)
  expect(seed.rows[0]!.text.startsWith(SUMMARY_OPENER)).toBe(true)
})

test('BuildSeed — медіа не записалось (MEDIA_NOT_ARCHIVED)', async () => {
  const { out } = await seedOf({ writeMedia: async () => false })
  expect('refuse' in out && out.refuse).toBe('MEDIA_NOT_ARCHIVED')
  expect('refuse' in out && out.reason).toBe('media of b could not be archived')
})

test('BuildSeed — медіа без даних: a document by URL in an untouched pair is named as not carried; the seed is built', async () => {
  const seed = built((await seedOf({ api: api([pdfByUrl]) })).out)
  const shot = seed.rows.flatMap(r => r.toolResults ?? []).find(t => t.tool_use_id === 'b')!
  expect(shot.text).toBe(`${MARK} media carried as files (open them with Read): document (not carried: no inline data)`)
  expect(seed.report.mediaFiles).toEqual([])
})

test('BuildSeed — змішане медіа одного власника: the image written, the document without data named', async () => {
  const { out, written } = await seedOf({ api: api([image(), pdfByUrl]) })
  const seed = built(out)
  expect(written).toEqual([`${FOLDER}/1.png`])
  const shot = seed.rows.flatMap(r => r.toolResults ?? []).find(t => t.tool_use_id === 'b')!
  expect(shot.text).toBe(`${MARK} media carried as files (open them with Read): image/png ${FOLDER}/1.png, document (not carried: no inline data)`)
})

test('BuildSeed: the media of a summarized pair goes into its summary, not into a CarryNote', async () => {
  const seed = built((await seedOf({}, [{ op: 'summarize', tool_use_id: 'b', summary: 'a screenshot of X' }])).out)
  const res = seed.rows.flatMap(r => r.toolResults ?? []).find(t => t.text.includes('a screenshot of X'))!
  expect(res.text).toContain(`(media: ${FOLDER}/1.png)`)
  expect(res.text).not.toContain('carried as files')
})

test('BuildSeed — рядок зі шляхом у повній розмові: CurrentRows start with a summary holding TRANSCRIPT_LINE; the seed\'s first row has no such line', async () => {
  const rows = [text('user', SUMMARY), text('assistant', 'handing off soon'), use('d'), result('d', 'KEY_0099')]
  const seed = built((await seedOf({ rows, transcript: [...alternating(4), ...rows], api: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'd', content: 'KEY_0099' }] }] })).out)
  // the first row is the summary row: fromSummary (F5)
  expect(seed.fromSummary).toBe(true)
  expect(seed.rows[0]!.text).not.toContain(TRANSCRIPT_LINE)
  expect(seed.rows[0]!.text.endsWith('KEY_0042 = 2c5f')).toBe(true)
})

test('BuildSeed — відновлена сесія після /compact: CurrentRows start with the summary row, every result seen; no head, but fromSummary; the report says so and PinSummary pins the first row', async () => {
  const rows = [text('user', `  ${SUMMARY_OPENER}. KEY 3`), text('assistant', 'copy'), use('d'), result('d', 'KEY_0099')]
  const api = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'd', content: 'KEY_0099' }] }]
  const seed = built((await seedOf({ rows, transcript: rows, api })).out)
  expect(seed.fromSummary).toBe(true)
  expect(seed.rows.length).toBe(4)
  const { io, s } = host({ rows, api })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted[0]).toContain('It starts from the summary of an earlier compaction; the rows before it stay in old.')
  const first = s.sessions.get('new')![1]!
  expect(s.tags.get('/s/new')!.tags).toEqual([{ kind: 'pin', target: { anchor: fingerprint(first), hint: 0 }, created_turn: 0 }])
  // a seed whose first row is no summary pins nothing
  const plain = host()
  expect(await runHandoff(plain.io, plain.s.mem, 0)).toBe('transcript')
  expect(plain.s.tags.get('/s/new')).toBeUndefined()
})

test('BuildSeed — вікно посеред пари: orphan results go, the first row is the person\'s; without a prompt row — EMPTY', async () => {
  const tail = [text('user', 'next question'), text('assistant', 'answer')]
  const rows = [...conversation().slice(3), ...tail]
  const seed = built((await seedOf({ rows, transcript: rows })).out)
  expect(seed.rows.map(r => r.text)).toEqual(['next question', 'answer'])
  const bare = conversation().slice(3)
  const { out } = await seedOf({ rows: bare, transcript: bare })
  expect('refuse' in out && out.refuse).toBe('EMPTY')
})

// a context_list pair among the rows: DropOwnCalls changes the size without any edit
function withListing(): SessionMessage[] {
  const rows = conversation()
  return [
    ...rows.slice(0, 2),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'l', tool: 'mcp__context-editor__context_list', input: {} }], handle: 'hl' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'l', text: 'x'.repeat(3000), isError: false }], handle: 'hr' },
    ...rows.slice(2),
  ]
}

const listingApi = () => [...api(), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'l', content: 'listing' }] }]

test('BuildSeed — засів без правок: an empty queue, or every edit failed, with a context_list call among the rows; the new session\'s report has no size line; without failed edits no sentence about edits at all', async () => {
  const rows = withListing()
  const empty = host({ rows, api: listingApi() })
  expect(await runHandoff(empty.io, empty.s.mem, 0)).toBe('transcript')
  // [SP_CTX_01_05] P13: a seed always replaces the conversation, so the removed own calls are named
  expect(empty.s.submitted[0]).toBe(
    'context-editor: this session continues old (transcript).\ncontext-editor: Your context_* calls (2) were removed from the conversation; tags and notes stay — see context_list.\n\ncontext-editor: the resume prompt you set before the handoff: go on',
  )
  const failing = host({ rows, api: listingApi() })
  failing.s.queues.set('/s/old', { ...failing.oldQueue(), edits: [{ op: 'drop', tool_use_id: 'gone' }] })
  expect(await runHandoff(failing.io, failing.s.mem, 0)).toBe('transcript')
  expect(failing.s.submitted[0]).toBe(
    'context-editor: this session continues old (transcript).\ncontext-editor: no queued edit was applied. Not applied: drop gone: call or result not found. Your context_* calls (2) were removed from the conversation; tags and notes stay — see context_list.\n\ncontext-editor: the resume prompt you set before the handoff: go on',
  )
  for (const text of [empty.s.submitted[0]!, failing.s.submitted[0]!]) {
    expect(text).not.toContain('Conversation ~')
    expect(text).not.toContain('freed')
  }
})

test('BuildSeed — засів з правками: charsBefore is the visible rows, charsAfter is after ApplyEdits and DropOwnCalls, before the CarryNote of the untouched media pair and the head', async () => {
  const rows = withListing()
  const seed = built((await seedOf({ rows, transcript: rows, api: listingApi() }, [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }])).out)
  expect(seed.visible).toEqual(rows)
  expect(seed.report.charsBefore).toBe(totalChars(rows))
  const note = carryNote([{ mediaType: 'image/png', bytes: 8, data: PNG }], [`${FOLDER}/1.png`])
  expect(seed.report.charsAfter).toBe(totalChars(seed.rows) - note.length)
  const text = seedReportTail({ report: seed.report, archive: '/s/old/1.json' })
  // [SP_CTX_01_05] NowIndex: the result row in the seeded list
  expect(text.startsWith(`\ncontext-editor: applied 1 edit(s): summarize a (now #${seed.report.produced[0]!.index}).`)).toBe(true)
  expect(text).toContain(`Conversation ~${totalChars(rows)} -> ~${seed.report.charsAfter} chars`)
})

test('BuildSeed — ScreenPinned: the state slot inside a collapse is refused as at an application; the rewrite of its row passes', async () => {
  const rows = conversation()
  const state: TagRegistry = { ...EMPTY_REGISTRY, tags: [{ kind: 'state', target: { anchor: fingerprint(rows[1]!), hint: 1 }, created_turn: 0 }] }
  const out = built(
    (
      await seedOf({ tags: okRead(state) }, [
        { op: 'collapse', from_index: 1, to_index: 3, summary: 's' },
        { op: 'rewrite', index: 1, text: 'state: handed off' },
      ])
    ).out,
  )
  expect(out.report.failed.join()).toContain('collapse #1..#3: target holds the state slot')
  expect(out.report.applied).toEqual(['rewrite #1'])
  // [SP_CTX_02_05] the context_handoff pair went with DropOwnCalls
  expect(out.report.ownCallsRemoved).toBe(1)
})

test('BuildSeed: an unreadable tag registry fails every edit; a pinned target is refused', async () => {
  const unreadable = built((await seedOf({ tags: unreadableRead('x') }, [{ op: 'drop', tool_use_id: 'c' }])).out)
  expect(unreadable.report.failed).toEqual(['drop c: tag registry unreadable'])
  const pinned: TagRegistry = { ...EMPTY_REGISTRY, tags: [{ kind: 'pin', target: { tool_use_id: 'c' }, created_turn: 0 }] }
  const out = built((await seedOf({ tags: okRead(pinned) }, [{ op: 'drop', tool_use_id: 'c' }])).out)
  expect(out.report.failed.join()).toContain('target is pinned')
})

// ---- [SP_CTX_02_23] CheckSeed

test('CheckSeed — порушення: each broken rule has its own reason', async () => {
  const good = [text('user', 'task'), use('x'), result('x'), text('assistant', 'done')]
  expect(checkSeed(good)).toBeUndefined()
  expect(checkSeed([])).toBe('no rows to carry over')
  expect(checkSeed([text('assistant', 'hi'), ...good])).toBe("the first row is not the person's")
  expect(checkSeed([{ ...good[0]!, handle: 'h' }, ...good.slice(1)])).toBe('row 0: holds a handle')
  expect(checkSeed([good[0]!, text('assistant', ''), ...good.slice(1)])).toBe('row 1: empty')
  expect(checkSeed([good[0]!, result('zz'), ...good.slice(1)])).toBe('row 1: result zz answers no call')
  expect(checkSeed([...good, use('y')])).toBe('row 4: call y has no result before the next prompt')
  expect(checkSeed([good[0]!, use('x'), text('user', 'new prompt'), result('x')])).toBe('row 1: call x has no result before the next prompt')
  // a result written before its call answers no call; a call answered only after a prompt has no result
  expect(checkSeed([good[0]!, result('x'), use('x'), result('x')])).toBe('row 1: result x answers no call')
  expect(checkSeed([good[0]!, use('x'), text('user', 'p2'), use('y'), result('y'), result('x')])).toBe('row 1: call x has no result before the next prompt')
  expect(checkSeed([...good, use('x'), result('x')])).toBe('row 4: repeated call id x')
  expect(checkSeed([good[0]!, { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x', tool: 'R', input: {} }, { tool_use_id: 'y', tool: 'R', input: {} }] }, result('x'), result('x'), result('y')])).toBe(
    'row 3: repeated result id x',
  )
  expect(checkSeed([good[0]!, { role: 'user', text: '', toolUses: [{ tool_use_id: 'q', tool: 'R', input: {} }] }])).toBe('row 1: tool_use in a user row')
  expect(checkSeed([good[0]!, { role: 'assistant', text: '', toolUses: [], toolResults: [{ tool_use_id: 'q', text: '', isError: false }] }])).toBe('row 1: tool_result in an assistant row')
})

// ---- [SP_CTX_02_24] CheckSeeded

const CLEAR_ROW = text('user', '<command-name>/clear</command-name>')
const commandRows = (args: string) => [text('user', `<command-name>/compact</command-name><command-args>${args}</command-args>`), text('user', 'Compacted')]

test('CheckSeeded — засів на місці / засів не взято / сесія та сама', async () => {
  const seed = [text('user', 'task'), use('x'), result('x'), text('assistant', 'done')]
  expect(checkSeeded(seed, [CLEAR_ROW, ...seed, ...commandRows(HANDOFF_MARKER)], 'old', 'new')).toBeUndefined()
  expect(checkSeeded(seed, [CLEAR_ROW, ...commandRows(HANDOFF_MARKER)], 'old', 'new')).toBe('the seeded rows were not found')
  expect(checkSeeded(seed, [CLEAR_ROW, ...seed], 'old', 'old')).toBe('the session id did not change')
})

test('CheckSeeded — бракує виклику: the seeded rows are there, one call is missing', async () => {
  const head = alternating(8)
  const seed = [...head, use('z'), result('z')]
  const read = [CLEAR_ROW, ...head, text('assistant', ''), result('z'), ...commandRows(HANDOFF_MARKER)]
  expect(checkSeeded(seed, read, 'old', 'new')).toBe('seeded call z is missing')
})

// ---- [SP_CTX_02_26] HandleSeed and the seeded session's boundary

function pendingSeed(over: Partial<HandoffSeed> = {}): HandoffSeed {
  return {
    old: 'old',
    id: 1,
    rows: [text('user', 'task'), use('x'), result('x'), text('assistant', 'done')],
    file: '/s/old/1/seed.json',
    archive: '',
    report: { applied: [], failed: [], charsBefore: 0, charsAfter: 0, originals: [], produced: [], notesDropped: [], ownCallsRemoved: 0, mediaFiles: [] },
    visible: [],
    edits: [],
    fromSummary: false,
    unmatchedPromptMedia: 0,
    carried: [],
    new: 'new',
    taken: false,
    ...over,
  }
}

// RecordBoundary as register.ts binds it: the written text is the own boundary
function seedHarness(session: string, host?: string) {
  const recorded: Boundary[] = []
  const mem: BoundaryMemory = {}
  const files = new Map<string, string>()
  const io: SeedIO = {
    sessionId: async () => session,
    recordBoundary: async b => {
      recorded.push(b)
      await recordBoundary(mem, async t => void files.set(session, t), b)
    },
    hostId: () => host,
  }
  return { io, recorded, mem, files }
}

test('HandleSeed — засів: the seeded rows in place of the /clear row; taken; the boundary recorded in the new session with host = hostId and as the own boundary', async () => {
  for (const host of ['tok:42', undefined]) {
    const mem = newHandoffMemory('i')
    mem.pending = pendingSeed()
    const { io, recorded, mem: bm, files } = seedHarness('new', host)
    const out = await handleSeed(io, mem, [CLEAR_ROW])
    expect('messages' in out && out.messages).toEqual(mem.pending.rows)
    expect(mem.pending.taken).toBe(true)
    expect(recorded).toEqual([boundaryOf(mem.pending.rows, host)!])
    expect(recorded[0]!.host).toBe(host)
    expect(bm.own).toBe(files.get('new'))
    // trusted in this instance either way: by host, or as its own boundary
    const transcript = [CLEAR_ROW, ...mem.pending.rows, ...commandRows(HANDOFF_MARKER)]
    expect(boundaryView(transcript, files.get('new'), host, bm.own).rows[0]).toBe(transcript[1])
  }
})

test('HandleSeed — відмови: no seed / not the new session / the new session already has a turn; taken stays false', async () => {
  const none = newHandoffMemory('i')
  expect(await handleSeed(seedHarness('new').io, none, [CLEAR_ROW])).toEqual({ skip: 'context-editor: no handoff seed waiting' })
  const mem = newHandoffMemory('i')
  mem.pending = pendingSeed()
  const old = seedHarness('old')
  expect(await handleSeed(old.io, mem, [CLEAR_ROW])).toEqual({ skip: 'context-editor: this is not the session the handoff created' })
  const turned = seedHarness('new')
  expect(await handleSeed(turned.io, mem, [CLEAR_ROW, text('user', 'hi'), text('assistant', 'hello')])).toEqual({ skip: 'context-editor: the new session already has a turn' })
  expect(mem.pending.taken).toBe(false)
  expect(old.recorded).toEqual([])
  expect(turned.recorded).toEqual([])
})

test('HandleSeed — інша сесія: a session the person opened is SKIP_NOT_CLEARED and nothing is written', async () => {
  const mem = newHandoffMemory('i')
  mem.pending = pendingSeed()
  const other = seedHarness('other')
  expect(await handleSeed(other.io, mem, [CLEAR_ROW])).toEqual({ skip: 'context-editor: this is not the session the handoff created' })
  expect(other.recorded).toEqual([])
  expect(mem.pending.taken).toBe(false)
})

test('CurrentRows — межа засіяної сесії: /clear rows, the seeded rows, the command rows; the boundary from HandleSeed starts at the first seeded row', async () => {
  const mem = newHandoffMemory('i')
  mem.pending = pendingSeed()
  const { io, recorded, mem: bm, files } = seedHarness('new', 'tok:42')
  await handleSeed(io, mem, [CLEAR_ROW])
  const transcript = [CLEAR_ROW, ...mem.pending.rows, ...commandRows(HANDOFF_MARKER)]
  const cur = currentRows(transcript, recorded[0])
  expect(cur.length).toBe(mem.pending.rows.length + 2)
  expect(cur[0]).toBe(transcript[1])
  // the same through CurrentRows' trust: by host, and by the own boundary
  expect(boundaryView(transcript, files.get('new'), 'tok:42', undefined).rows).toEqual(cur)
  expect(boundaryView(transcript, files.get('new'), undefined, bm.own).rows).toEqual(cur)
})

// ---- [SP_CTX_02_21] PinSummary

test('PinSummary — реєстр нової сесії: none — made with one pin; full — no pin, a note; unreadable — the same', async () => {
  const row = text('user', SUMMARY)
  const made = pinSummary(missingRead({ ...EMPTY_REGISTRY }), row)
  expect('registry' in made && made.registry).toEqual({ tags: [{ kind: 'pin', target: { anchor: fingerprint(row), hint: 0 }, created_turn: 0 }], turn: 0, firstPromptPinned: true, introduced: false, notes: [], nextNote: 1 })
  const full: TagRegistry = { ...EMPTY_REGISTRY, tags: Array.from({ length: MAX_TAGS }, (_, i) => ({ kind: 'review' as const, target: { tool_use_id: `t${i}` }, created_turn: 0 })) }
  expect(pinSummary(okRead(full), row)).toEqual({ note: ' The summary row was not pinned: the tag registry is full.' })
  expect(pinSummary(unreadableRead('x'), row)).toEqual({ note: ' The summary row was not pinned: the tag registry is unreadable.' })
  // a tag already on that row is replaced, even in a full registry
  const taken: TagRegistry = { ...full, tags: [...full.tags.slice(1), { kind: 'review', target: { anchor: fingerprint(row), hint: 3 }, created_turn: 0 }] }
  const replaced = pinSummary(okRead(taken), row)
  expect('registry' in replaced && replaced.registry.tags.at(-1)!.kind).toBe('pin')
})

// ---- [SP_CTX_01_15] [SP_CTX_02_19] [SP_CTX_02_20] [SP_CTX_04_04] the request

const handoff = (over: Partial<HandoffRequest> = {}): HandoffRequest => ({ mode: 'transcript', resume: true, resumePrompt: 'go on', by: 'agent', state: 'queued', at: 0, ...over })

test('context_handoff — постановка: transcript by default / document / a long document DENIED_TOO_LONG / a running request DENIED_RUNNING', async () => {
  const q = queueHandoff(EMPTY_QUEUE, {}, 'agent', 5)
  expect('queue' in q && q.queue.handoff).toEqual({ mode: 'transcript', resume: true, resumePrompt: 'Continue the task from where you stopped.', by: 'agent', state: 'queued', at: 5 })
  const d = queueHandoff(EMPTY_QUEUE, { mode: 'document', document: 'doc', resume: false, resume_prompt: 'p' }, 'person', 5)
  expect('queue' in d && d.queue.handoff).toEqual({ mode: 'document', document: 'doc', resume: false, resumePrompt: 'p', by: 'person', state: 'queued', at: 5 })
  const long = queueHandoff(EMPTY_QUEUE, { document: 'd'.repeat(MAX_DOCUMENT + 1) }, 'agent', 5)
  expect('code' in long && long.code).toBe('DENIED_TOO_LONG')
  const prompt = queueHandoff(EMPTY_QUEUE, { resume_prompt: 'p'.repeat(9000) }, 'agent', 5)
  expect('code' in prompt && prompt.code).toBe('DENIED_TOO_LONG')
  const bad = queueHandoff(EMPTY_QUEUE, { mode: 'x' }, 'agent', 5)
  expect('code' in bad && bad.code).toBe('DENIED_BAD_MODE')
  const sub = queueHandoff(EMPTY_QUEUE, { agentId: 'sub' }, 'agent', 5)
  expect('code' in sub && sub.code).toBe('DENIED_SUBAGENT')
  const running = { ...EMPTY_QUEUE, handoff: handoff({ state: 'running', at: 0 }) }
  const r = queueHandoff(running, {}, 'agent', 10)
  expect('code' in r && r.code).toBe('DENIED_RUNNING')
  // stale and not in flight: replaceable; in flight: never
  expect('queue' in queueHandoff(running, {}, 'agent', HANDOFF_STALE_MS + 1)).toBe(true)
  const inFlight = queueHandoff(running, {}, 'agent', HANDOFF_STALE_MS + 1, true)
  expect('code' in inFlight && inFlight.code).toBe('DENIED_RUNNING')
  // a queued request is replaced
  const replaced = queueHandoff({ ...EMPTY_QUEUE, handoff: handoff() }, { mode: 'document' }, 'agent', 7)
  expect('queue' in replaced && replaced.queue.handoff!.mode).toBe('document')
})

test('Due — running без handoffInFlight: older than HANDOFF_STALE is due, younger is not; owner is not read', async () => {
  const idle = { inFlight: false }
  const running = (owner?: string) => ({ ...EMPTY_QUEUE, handoff: handoff({ state: 'running', at: 0, ...(owner ? { owner } : {}) }) })
  expect(handoffDue(running(), idle, HANDOFF_STALE_MS + 1)).toBe(true)
  expect(handoffDue(running('someone-else'), idle, HANDOFF_STALE_MS + 1)).toBe(true)
  expect(handoffDue(running(), idle, HANDOFF_STALE_MS)).toBe(false)
  expect(handoffDue(running(), { inFlight: true }, HANDOFF_STALE_MS * 10)).toBe(false)
  expect(handoffDue({ ...EMPTY_QUEUE, handoff: handoff() }, idle, 0)).toBe(true)
  expect(handoffDue({ ...EMPTY_QUEUE, handoff: handoff() }, { inFlight: true }, 0)).toBe(false)
  expect(handoffDue(EMPTY_QUEUE, idle, 0)).toBe(false)
})

test('cancelHandoff — скасування: queued / running without handoffInFlight / running in flight', async () => {
  const q = cancelHandoff({ ...EMPTY_QUEUE, handoff: handoff() }, 'cancelled by the person', 7)
  expect(q.handoff).toBeUndefined()
  expect(q.report).toBe('context-editor: handoff cancelled (cancelled by the person).')
  expect(q.reportResume).toBe(false)
  const running = { ...EMPTY_QUEUE, handoff: handoff({ state: 'running', owner: 'gone' }) }
  expect(cancelHandoff(running, 'x', 7, false).handoff).toBeUndefined()
  expect(cancelHandoff(running, 'x', 7, true)).toBe(running)
})

test('parseQueue keeps a well-formed handoff with or without owner, and refuses a broken one', async () => {
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, handoff: handoff() })).state).toBe('ok')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, handoff: handoff({ state: 'running', owner: 'i1' }) })).state).toBe('ok')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, handoff: { ...handoff(), owner: '' } })).state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, handoff: { ...handoff(), mode: 'x' } })).state).toBe('unreadable')
})

test('a compaction waits while a handoff is queued (HandleCompaction — передача в черзі): skip "handoff pending", the queue as it was', async () => {
  const rows = conversation()
  let written: Queue | undefined
  const io = {
    dir: '/s',
    now: () => 1,
    readQueue: async () => ({ state: 'ok' as const, value: { ...EMPTY_QUEUE, edits: prepare(rows, [{ op: 'drop', tool_use_id: 'a' }]).queued, handoff: handoff() } }),
    writeQueue: async (q: Queue) => void (written = q),
  } as unknown as CompactionIO
  const out = await handleCompaction(io, rows)
  expect('skip' in out && out.skip).toBe('context-editor: handoff pending')
  expect(written).toBeUndefined()
})

// ---- a host for RunHandoff: the old session `old`; /clear makes `new`, then
// `new2`; /compact HANDOFF_MARKER runs HandleSeed as the host's handler would

type HostOpts = { h?: Partial<HandoffRequest>; edits?: unknown[]; rows?: SessionMessage[]; api?: unknown[] }

function host(o: HostOpts = {}) {
  const rows = o.rows ?? conversation()
  const s = {
    session: 'old',
    made: 0,
    now: NOW,
    sessions: new Map<string, SessionMessage[]>([['old', rows]]),
    boundaries: new Map<string, Boundary>(),
    queues: new Map<string, Queue>([['/s/old', { ...EMPTY_QUEUE, edits: prepare(rows, o.edits ?? []).queued, handoff: handoff(o.h) }]]),
    tags: new Map<string, TagRegistry>(),
    aliases: new Map<string, AliasRegistry>(),
    files: new Map<string, string>(),
    removed: [] as string[],
    log: [] as string[],
    commands: [] as string[],
    submitted: [] as string[],
    toasts: [] as string[],
    // [SP_CTX_02_43] the person's lines ($.ui.log)
    logs: [] as string[],
    timers: [] as { ms: number; fn: () => void }[],
    sleeps: [] as number[],
    statuses: [] as (string | undefined)[],
    onSleep: undefined as undefined | (() => void | Promise<void>),
    turns: newTurns(),
    mem: newHandoffMemory('inst-1'),
  }
  let chain: Promise<unknown> = Promise.resolve()
  const dir = (id = s.session) => `/s/${id}`
  const read =<T>(v: T | undefined, empty: T): Read<T> => (v === undefined ? missingRead(empty) : okRead(v))
  const seedIO: SeedIO = { sessionId: async () => s.session, recordBoundary: async b => void s.boundaries.set(s.session, b), hostId: () => undefined }
  // the host's /compact HANDOFF_MARKER: the handler's rows replace the session's, the command rows follow
  const handler = async () => {
    const before = s.sessions.get(s.session) ?? []
    const out = await handleSeed(seedIO, s.mem, before)
    s.sessions.set(s.session, [...before, ...('messages' in out ? out.messages : []), ...commandRows(HANDOFF_MARKER)])
  }
  const io: HandoffIO = {
    now: () => s.now,
    turns: s.turns,
    after: (ms, fn) => void s.timers.push({ ms, fn }),
    sleep: async ms => {
      s.sleeps.push(ms)
      s.now += ms
      await s.onSleep?.()
    },
    sessionId: async () => s.session,
    storage: async () => {
      s.log.push(`storage ${s.session}`)
      return { dir: dir() }
    },
    readQueue: async d => read(s.queues.get(d), { ...EMPTY_QUEUE }),
    // one serial chain, as register.ts binds it
    changeQueue: (d, change) => {
      const next = chain.then(async () => {
        const q = await change(read(s.queues.get(d), { ...EMPTY_QUEUE }))
        if (!q) return false
        s.log.push(`queue ${d}`)
        s.queues.set(d, q)
        return true
      })
      chain = next.catch(() => undefined)
      return next
    },
    view: async () => {
      s.log.push(`view ${s.session}`)
      const t = s.sessions.get(s.session) ?? []
      return { transcript: t, rows: currentRows(t, s.boundaries.get(s.session)) }
    },
    readApi: async () => (s.session === 'old' ? (o.api ?? api()) : []),
    readTags: async () => read(s.tags.get(dir()), { ...EMPTY_REGISTRY }),
    changeTags: async (d, change) => {
      const next = await change(read(s.tags.get(d), { ...EMPTY_REGISTRY, tags: [] }))
      if (!next) return false
      s.log.push(`tags ${d}`)
      s.tags.set(d, next)
      return true
    },
    listSeeds: async d =>
      [...s.files.keys()].flatMap(p => {
        const m = /^(.*)\/(\d+)\/seed\.json$/.exec(p)
        return m && m[1] === d ? [Number(m[2])] : []
      }),
    archives: async d => d,
    writeMedia: async path => {
      s.files.set(path, 'media')
      return true
    },
    writeText: async (path, body) => {
      s.files.set(path, body)
      s.log.push(path.endsWith('/seed.json') ? 'seed.json' : 'archive')
      return true
    },
    remove: async path => {
      s.removed.push(path)
      for (const k of [...s.files.keys()]) if (k === path || k.startsWith(`${path}/`)) s.files.delete(k)
    },
    // read in the old storage, changed, written into the new one
    carryTags: async (from, to, change) => {
      s.log.push('copy')
      const t = s.tags.get(from)
      if (!t) return 'missing'
      s.tags.set(to, change(t))
      return 'carried'
    },
    carryAliases: async (from, to, change) => {
      const a = s.aliases.get(from)
      if (!a) return 'missing'
      s.aliases.set(to, change(a))
      return 'carried'
    },
    runCommand: async (command, args) => {
      s.commands.push(args ? `${command} ${args}` : command)
      s.log.push(command)
      if (command === 'clear') {
        s.session = ['new', 'new2', 'new3'][s.made++]!
        s.sessions.set(s.session, [CLEAR_ROW])
        return
      }
      await handler()
    },
    fork: async () => 'forked document',
    submit: async body => {
      s.log.push('submit')
      s.submitted.push(body)
    },
    toast: body => void s.toasts.push(body),
    log: line => void s.logs.push(line),
    status: text => void s.statuses.push(text),
  }
  return { io, s, handler, oldQueue: () => s.queues.get('/s/old')!, queueOf: (id: string) => s.queues.get(`/s/${id}`) }
}

const ORDER = new Set(['archive', 'seed.json', 'clear', 'storage new', 'compact', 'view new', 'queue /s/old', 'copy', 'tags /s/new', 'submit'])

test('RunHandoff — засів: the order is build, files in the old storage, clear, new storage, compact HANDOFF_MARKER, CheckSeeded, HandedOff, registries, PinSummary, the prompt', async () => {
  // CurrentRows that already start with a summary: PinSummary runs too
  const rows = [text('user', SUMMARY), ...conversation().slice(1)]
  const { io, s, oldQueue } = host({ rows, edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [{ kind: 'review', target: { tool_use_id: 'b' }, created_turn: 0 }] })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  // the claim, then the rest
  expect(s.log.filter(e => ORDER.has(e))).toEqual(['queue /s/old', 'archive', 'seed.json', 'clear', 'storage new', 'compact', 'view new', 'queue /s/old', 'copy', 'tags /s/new', 'submit', 'storage new'])
  // the last read: FINALLY sets the status line from the new session's queue
  expect(s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
  expect(s.files.has(`/s/old/${NOW}/seed.json`)).toBe(true)
  expect(s.files.has(`/s/old/${NOW}.json`)).toBe(true)
  expect(s.files.has(`/s/old/${NOW}/1.png`)).toBe(true)
  // the seeded rows in the new session, pairs whole
  const seeded = s.sessions.get('new')!
  expect(seeded[0]).toBe(CLEAR_ROW)
  expect(seeded.some(r => r.toolUses.some(u => u.tool_use_id === 'b'))).toBe(true)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('context-editor: this session continues old (transcript).')
  expect(s.submitted[0]).toContain('applied 1 edit(s)')
  expect(s.submitted[0]!.endsWith(`\n\ncontext-editor: the resume prompt you set before the handoff: go on`)).toBe(true)
  // [SP_CTX_02_43] the person's line: the seed applied an edit; the prompt does not carry it
  expect(s.logs.length).toBe(1)
  expect(/^handoff: applied 1 edit\(s\): conversation ~\S+ → ~\S+ tokens( \((approx\.; )?freed ~\S+\)| \(approx\.\))?$/.test(s.logs[0]!)).toBe(true)
  expect(s.submitted[0]).not.toContain(s.logs[0]!)
  expect(oldQueue().edits).toEqual([])
  expect(oldQueue().handoff).toBeUndefined()
  expect(oldQueue().report).toContain('this session was handed off to new (transcript)')
  expect(oldQueue().reportResume).toBe(false)
  // the tags came along and the summary row is pinned
  expect(s.tags.get('/s/new')!.tags.map(t => t.kind)).toEqual(['review', 'pin'])
  expect(s.mem.pending).toBeUndefined()
  expect(s.mem.inFlight).toBe(false)
})

// [SP_CTX_02_21] [SP_CTX_01_04] audit PL_AUD_CTX_P4, CF-6
test('RunHandoff — HandedOff скидає вибори пакета: keepCache, resume, resumePrompt, resumeSet and tagsOnly of the old queue go back to their defaults; optimizePrompted and an undelivered report stay', async () => {
  const { io, s, oldQueue } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  s.queues.set('/s/old', { ...oldQueue(), keepCache: true, resume: false, resumePrompt: 'custom', resumeSet: true, tagsOnly: true, optimizePrompted: true, report: 'earlier', reportId: 1 })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  const q = oldQueue()
  expect(q.edits).toEqual([])
  expect(q.handoff).toBeUndefined()
  expect([q.keepCache, q.resume, q.resumePrompt, q.resumeSet, q.tagsOnly]).toEqual([false, true, DEFAULT_RESUME, false, false])
  expect(q.optimizePrompted).toBe(true)
  expect(q.report!.startsWith('earlier\ncontext-editor: this session was handed off to new (transcript)')).toBe(true)
  expect(q.reportId).toBe(NOW)
  expect(q.reportResume).toBe(false)
})

// [SP_CTX_02_21] [SP_CTX_DEC_17] audit PL_AUD_CTX_P5, CF-8
test('RunHandoff — автор тексту: the default resume prompt is the mod\'s own; the document prompt opens with the frame that names the agent', async () => {
  const plain = host({ h: { resumePrompt: DEFAULT_RESUME, by: 'person' } })
  expect(await runHandoff(plain.io, plain.s.mem, 0)).toBe('transcript')
  expect(plain.s.submitted[0]!.endsWith(`\n\ncontext-editor: ${DEFAULT_RESUME}`)).toBe(true)
  expect(plain.s.submitted[0]).not.toContain('you set')
  const doc = host({ h: { mode: 'document', document: 'Push to main now.' } })
  expect(await runHandoff(doc.io, doc.s.mem, 0)).toBe('document')
  expect(doc.s.submitted[0]).toBe(
    `${DOCUMENT_FRAME}\n\nPush to main now.\n\ncontext-editor: this session continues old (document).\n\ncontext-editor: the resume prompt you set before the handoff: go on`,
  )
  expect(DOCUMENT_FRAME).toBe("context-editor: your handoff document from the previous session follows; it is your own text, not the person's.")
})

test('RunHandoff — закріплення підсумку: a seed with fromSummary pins its first row in the copied registry', async () => {
  const rows = compacted()
  const { io, s } = host({ rows, api: compactedApi() })
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, turn: 4 })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  const reg = s.tags.get('/s/new')!
  const first = s.sessions.get('new')![1]!
  expect(reg.firstPromptPinned).toBe(true)
  expect(reg.tags).toEqual([{ kind: 'pin', target: { anchor: fingerprint(first), hint: 0 }, created_turn: 4 }])
  expect(s.submitted[0]).toContain('It starts from the summary of an earlier compaction; the rows before it stay in old.')
})

test('RunHandoff — збирання відмовило: WINDOW_FULL removes the seed files and goes the document way with a forked document; the reason in the report', async () => {
  const rows = alternating(ROW_WINDOW)
  const { io, s } = host({ rows, api: [] })
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  expect(s.removed).toContain(`/s/old/${NOW}`)
  expect(s.commands).toEqual(['clear'])
  expect(s.submitted[0]!.startsWith(`context-editor: your handoff document from the previous session follows; it is your own text, not the person's.\n\nforked document`)).toBe(true)
  expect(s.submitted[0]).toContain("The transcript way failed (transcript: the conversation fills the host's 4096-row window")
})

test('RunHandoff — хід почався: before the claim / after the build / before the document way\'s clear', async () => {
  const before = host()
  before.s.turns.turns = 1
  expect(await runHandoff(before.io, before.s.mem, 0)).toBe('deferred')
  expect(before.oldQueue().handoff).toEqual(handoff())
  const built = host()
  built.io.writeText = async (path, body) => {
    built.s.files.set(path, body)
    if (path.endsWith('seed.json')) turnStarted(built.s.turns)
    return true
  }
  expect(await runHandoff(built.io, built.s.mem, 0)).toBe('deferred')
  expect(built.s.removed).toContain(`/s/old/${NOW}`)
  expect(built.s.files.size).toBe(0)
  expect(built.oldQueue().handoff!.state).toBe('queued')
  expect(built.oldQueue().handoff!.owner).toBeUndefined()
  expect(built.s.commands).toEqual([])
  const doc = host({ h: { mode: 'document' } })
  doc.io.fork = async () => (turnStarted(doc.s.turns), 'forked document')
  expect(await runHandoff(doc.io, doc.s.mem, 0)).toBe('deferred')
  expect(doc.s.commands).toEqual([])
  expect(doc.oldQueue().handoff!.state).toBe('queued')
})

test('RunHandoff — хід перед /clear: /clear waited for a turn; AfterClear without a second clear (seed not taken); the document, or the notice', async () => {
  const withDoc = host({ h: { document: 'my handoff' }, edits: [{ op: 'drop', tool_use_id: 'c' }] })
  const clear = withDoc.io.runCommand
  withDoc.io.runCommand = async (c, a) => {
    if (c === 'clear') {
      turnStarted(withDoc.s.turns)
      turnCompleted(withDoc.s.turns, false)
    }
    await clear(c, a)
  }
  expect(await runHandoff(withDoc.io, withDoc.s.mem, 0)).toBe('document')
  expect(withDoc.s.commands).toEqual(['clear'])
  expect(withDoc.s.submitted[0]!.startsWith(`context-editor: your handoff document from the previous session follows; it is your own text, not the person's.\n\nmy handoff`)).toBe(true)
  expect(withDoc.s.submitted[0]).toContain('a turn ran before /clear; the seed would miss it')
  expect(withDoc.s.submitted[0]).toContain('The 1 queued edit(s) were not carried over.')
  expect(withDoc.oldQueue().report).toContain('handed off to new (document)')
  const bare = host()
  const clear2 = bare.io.runCommand
  bare.io.runCommand = async (c, a) => {
    if (c === 'clear') {
      turnStarted(bare.s.turns)
      turnCompleted(bare.s.turns, false)
    }
    await clear2(c, a)
  }
  expect(await runHandoff(bare.io, bare.s.mem, 0)).toBe('failed')
  expect(bare.s.commands).toEqual(['clear'])
  expect(bare.s.submitted[0]).toContain('the handoff from old failed after the session was cleared')
  expect(bare.s.submitted[0]).toContain(`/s/old/${NOW}/seed.json`)
  expect(bare.oldQueue().report).toContain('handoff failed after the session was cleared')
  expect(bare.oldQueue().handoff).toBeUndefined()
})

test('RunHandoff — хід перед /clear у способі document: the document goes; the prompt names the turn left in old', async () => {
  const { io, s } = host({ h: { mode: 'document', document: 'doc' } })
  const clear = io.runCommand
  io.runCommand = async (c, a) => {
    turnStarted(s.turns)
    turnCompleted(s.turns, false)
    await clear(c, a)
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  expect(s.submitted[0]).toContain('A turn ran before /clear; it stays in old and is not in this document.')
})

test('RunHandoff — /clear відхилено: Fail with the host text T; the edits stay; the seed files removed', async () => {
  const { io, s, oldQueue } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 's' }] })
  io.runCommand = async () => {
    throw new Error('T: no command named /clear in this session')
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(oldQueue().report).toBe('context-editor: handoff failed: transcript: /clear was refused: T: no command named /clear in this session; the session was not changed.')
  expect(oldQueue().edits.length).toBe(1)
  expect(oldQueue().handoff).toBeUndefined()
  expect(s.removed).toEqual([`/s/old/${NOW}`, `/s/old/${NOW}.json`])
  expect(s.toasts.length).toBe(1)
})

test('RunHandoff — /clear відхилено, каталог архівів: RemoveSeedFiles removes the seed folder, the media folder and the archive', async () => {
  const { io, s } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 's' }] })
  io.archives = async () => '/p/a'
  io.runCommand = async () => {
    throw new Error('T: busy')
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.removed).toEqual([`/s/old/${NOW}`, `/p/a/${NOW}`, `/p/a/${NOW}.json`])
  expect(s.files.size).toBe(0)
})

test('RunHandoff — компактизацію засіву відхилено: AfterClear without a second clear; with the agent\'s document HandedOff document and T in the prompt; without it FailAfterClear and the notice', async () => {
  const refuse = (h: ReturnType<typeof host>) => {
    const run = h.io.runCommand
    h.io.runCommand = async (c, a) => {
      if (c === 'compact') {
        h.s.commands.push(`compact ${a}`)
        throw new Error('T: compaction refused')
      }
      await run(c, a)
    }
  }
  const withDoc = host({ h: { document: 'my handoff' } })
  refuse(withDoc)
  expect(await runHandoff(withDoc.io, withDoc.s.mem, 0)).toBe('document')
  expect(withDoc.s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
  expect(withDoc.s.submitted[0]).toContain('the seed compaction was refused: T: compaction refused')
  expect(withDoc.oldQueue().report).toContain('handed off to new (document)')
  const bare = host()
  refuse(bare)
  expect(await runHandoff(bare.io, bare.s.mem, 0)).toBe('failed')
  expect(bare.s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
  expect(bare.s.submitted[0]).toContain('from old failed after the session was cleared (transcript: the seed compaction was refused: T: compaction refused)')
  expect(bare.s.submitted[0]).toContain(`The assembled conversation is in /s/old/${NOW}/seed.json.`)
  expect(bare.oldQueue().report).toContain(`the assembled conversation is in /s/old/${NOW}/seed.json`)
  expect(bare.s.mem.pending).toBeUndefined()
})

test('RunHandoff — засів не взято: another handler answered; AfterClear "did not take the seed", no second clear', async () => {
  const { io, s } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    if (c === 'compact') {
      s.commands.push(`compact ${a}`)
      s.sessions.set(s.session, [CLEAR_ROW, ...commandRows(a ?? '')])
      return
    }
    await run(c, a)
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
  expect(s.submitted[0]).toContain('the seed compaction did not take the seed')
})

test('RunHandoff — розбіжність: CheckSeeded finds no seeded rows; AfterClear with that reason; the taken seed is cleared away', async () => {
  const { io, s, handler } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    if (c === 'compact') {
      s.commands.push(`compact ${a}`)
      await handler()
      // the host kept something else
      s.sessions.set(s.session, [CLEAR_ROW, text('user', 'other'), ...commandRows(a ?? '')])
      return
    }
    await run(c, a)
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`, 'clear'])
  expect(s.submitted[0]).toContain('the host did not keep the seeded conversation: the seeded rows were not found')
  expect(s.session).toBe('new2')
})

test('RunHandoff — хід у новій сесії: a turn began after clear and HandleSeed answered SKIP_TURN_STARTED; FailAfterClear, no second clear, no prompt', async () => {
  const { io, s, oldQueue } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    if (c === 'compact') {
      s.commands.push(`compact ${a}`)
      turnStarted(s.turns)
      const out = await handleSeed({ sessionId: async () => s.session, recordBoundary: async () => undefined, hostId: () => undefined }, s.mem, [CLEAR_ROW, text('user', 'hi'), text('assistant', 'hello')])
      expect('skip' in out && out.skip).toBe('context-editor: the new session already has a turn')
      return
    }
    await run(c, a)
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
  expect(s.submitted).toEqual([])
  expect(oldQueue().report).toContain('handoff failed after the session was cleared')
  expect(s.queues.get('/s/new')!.report).toContain('the handoff from old failed after the session was cleared')
  expect(s.queues.get('/s/new')!.reportResume).toBe(false)
})

test('RunHandoff — хід перед компактизацією засіву: MovedSince(turnsClear) right before compact; no command; FailAfterClear without a second clear', async () => {
  const { io, s } = host()
  const storage = io.storage
  io.storage = async () => {
    const out = await storage()
    if (s.session === 'new') {
      turnStarted(s.turns)
      turnCompleted(s.turns, false)
    }
    return out
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear'])
  expect(s.submitted).toEqual([])
  expect(s.queues.get('/s/new')!.report).toContain('a turn began in the new session')
})

test('RunHandoff — хід одразу після /clear: inTurn after clear; FailAfterClear without a second clear; the notice waits in the new queue', async () => {
  const { io, s, oldQueue } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    await run(c, a)
    if (c === 'clear') turnStarted(s.turns)
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear'])
  expect(s.submitted).toEqual([])
  expect(oldQueue().report).toContain('transcript: a turn began in the new session')
  expect(s.queues.get('/s/new')!.reportResume).toBe(false)
  expect(s.queues.get('/s/new')!.report).toContain('The previous session old is unchanged.')
})

test('RunHandoff — людина активна перед відправкою: seeded, but a turn began before the report went; it waits in the new queue', async () => {
  const { io, s } = host()
  io.carryTags = async () => (turnStarted(s.turns), 'missing')
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted).toEqual([])
  expect(s.queues.get('/s/new')!.report).toContain('this session continues old (transcript)')
  expect(s.queues.get('/s/new')!.reportResume).toBe(false)
})

test('RunHandoff — сесія змінилась під час засіву: FailAfterClear only; no second clear, no prompt, nothing written into the current session', async () => {
  const { io, s, handler, oldQueue } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    if (c === 'compact') {
      s.commands.push(`compact ${a}`)
      await handler()
      s.session = 'elsewhere'
      return
    }
    await run(c, a)
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
  expect(s.submitted).toEqual([])
  expect(s.queues.has('/s/elsewhere')).toBe(false)
  expect(oldQueue().report).toContain('transcript: the session changed during seeding')
  expect(s.mem.pending).toBeUndefined()
})

test('RunHandoff — сесія змінилась, і FailAfterClear падає: the handler does not enter AfterClear; no second /clear, no prompt; one write attempt and a toast', async () => {
  const { io, s, handler } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    if (c === 'compact') {
      s.commands.push(`compact ${a}`)
      await handler()
      s.session = 'elsewhere'
      return
    }
    await run(c, a)
  }
  let failWrites = 0
  const update = io.changeQueue
  io.changeQueue = async (d, change) =>
    update(d, async r => {
      const next = await change(r)
      if (d === '/s/old' && next?.report?.includes('after the session was cleared')) {
        failWrites++
        throw new Error('disk full')
      }
      return next
    })
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
  expect(s.submitted).toEqual([])
  expect(failWrites).toBe(1)
  expect(s.queues.has('/s/elsewhere')).toBe(false)
  expect(s.toasts).toEqual(['context-editor: handoff failed after /clear: disk full; the old queue could not be written'])
  expect(s.mem.inFlight).toBe(false)
})

test('RunHandoff — NEW_STORAGE: the new session\'s storage cannot be made; AfterClear, no compact, no second /clear', async () => {
  const { io, s, oldQueue } = host()
  const storage = io.storage
  io.storage = async () => (s.session === 'new' ? { reason: 'mkdir: denied' } : storage())
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear'])
  expect(oldQueue().report).toContain('the storage of the new session cannot be made: mkdir: denied')
  expect(oldQueue().handoff).toBeUndefined()
  expect(s.mem.pending).toBeUndefined()
})

test('RunHandoff — CLEAR_REFUSED, the session did not change: Fail in both modes, no compact, the edits kept', async () => {
  const transcript = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 's' }] })
  transcript.io.runCommand = async (c, a) => void transcript.s.commands.push(a ? `${c} ${a}` : c)
  expect(await runHandoff(transcript.io, transcript.s.mem, 0)).toBe('failed')
  expect(transcript.s.commands).toEqual(['clear'])
  expect(transcript.oldQueue().edits.length).toBe(1)
  expect(transcript.oldQueue().handoff).toBeUndefined()
  expect(transcript.oldQueue().report).toContain('transcript: /clear did not start a new session')
  expect(transcript.s.removed).toContain(`/s/old/${NOW}`)
  const document = host({ h: { mode: 'document', document: 'doc' }, edits: [{ op: 'drop', tool_use_id: 'c' }] })
  document.io.runCommand = async (c, a) => void document.s.commands.push(a ? `${c} ${a}` : c)
  expect(await runHandoff(document.io, document.s.mem, 0)).toBe('failed')
  expect(document.s.commands).toEqual(['clear'])
  expect(document.oldQueue().edits.length).toBe(1)
  expect(document.oldQueue().report).toContain('document: /clear did not start a new session')
  expect(document.s.submitted).toEqual([])
})

test('RunHandoff — REPORT_LOST: seeded, the report prompt is refused; a toast with the host text, the outcome stays transcript', async () => {
  const { io, s, oldQueue } = host()
  io.submit = async () => {
    throw new Error('T')
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.toasts).toContain('context-editor: the handoff prompt was refused: T')
  expect(oldQueue().report).toContain('handed off to new (transcript)')
})

test('AwaitSeeded — рядки з запізненням: the seeded rows show up a poll after compact returns; the first read fails, then all is well and the handoff succeeds', async () => {
  const { io, s, handler } = host()
  const run = io.runCommand
  const reads: (string | undefined)[] = []
  io.runCommand = async (c, a) => {
    if (c === 'compact') {
      s.commands.push(`compact ${a}`)
      await handler()
      // stream-json: compact returns before the rows are readable
      const seeded = s.sessions.get(s.session)!
      s.sessions.set(s.session, [CLEAR_ROW, ...commandRows(a ?? '')])
      s.onSleep = () => void s.sessions.set(s.session, seeded)
      return
    }
    await run(c, a)
  }
  const view = io.view
  io.view = async () => {
    const v = await view()
    if (s.session === 'new') reads.push(checkSeeded(s.mem.pending?.rows ?? [], v.transcript, 'old', 'new'))
    return v
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(reads[0]).toBe('the seeded rows were not found')
  expect(reads.at(-1)).toBeUndefined()
  expect(s.sleeps).toEqual([SEED_POLL_MS])
  expect(s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`])
})

test('AwaitSeeded — рядків немає: after SEED_WAIT the last reason stands; AfterClear with SEED_NOT_KEPT', async () => {
  const transcript = [CLEAR_ROW, ...commandRows(HANDOFF_MARKER)]
  let polls = 0
  const io = {
    now: () => NOW + polls * SEED_POLL_MS,
    sleep: async () => void polls++,
    view: async () => ({ transcript }),
  }
  const seed = [text('user', 'task'), text('assistant', 'done')]
  expect(await awaitSeeded(io, seed, 'old', 'new')).toBe('the seeded rows were not found')
  expect(polls).toBe(SEED_WAIT_MS / SEED_POLL_MS)
  // a match on the first read waits for nothing
  polls = 0
  expect(await awaitSeeded({ ...io, view: async () => ({ transcript: [CLEAR_ROW, ...seed] }) }, seed, 'old', 'new')).toBeUndefined()
  expect(polls).toBe(0)
  // in RunHandoff: the seed taken but never readable — AfterClear, the seeded session cleared away
  const h = host()
  const run = h.io.runCommand
  h.io.runCommand = async (c, a) => {
    if (c === 'compact') {
      h.s.commands.push(`compact ${a}`)
      await h.handler()
      h.s.sessions.set(h.s.session, [CLEAR_ROW, ...commandRows(a ?? '')])
      return
    }
    await run(c, a)
  }
  expect(await runHandoff(h.io, h.s.mem, 0)).toBe('failed')
  expect(h.s.sleeps.length).toBe(SEED_WAIT_MS / SEED_POLL_MS)
  expect(h.s.commands).toEqual(['clear', `compact ${HANDOFF_MARKER}`, 'clear'])
  expect(h.s.submitted[0]).toContain('the host did not keep the seeded conversation: the seeded rows were not found')
})

test('RunHandoff: after /clear the status line follows the current session\'s queue; without /clear it is left alone', async () => {
  const done = host({ edits: [{ op: 'drop', tool_use_id: 'c' }] })
  expect(await runHandoff(done.io, done.s.mem, 0)).toBe('transcript')
  expect(done.s.statuses).toEqual([undefined])
  const waiting = host({ h: { resume: false } })
  const carry = waiting.io.carryTags
  waiting.io.carryTags = async (from, to, change) => {
    const out = await carry(from, to, change)
    waiting.s.queues.set('/s/new', { ...EMPTY_QUEUE, edits: prepare(conversation(), [{ op: 'drop', tool_use_id: 'c' }]).queued })
    return out
  }
  expect(await runHandoff(waiting.io, waiting.s.mem, 0)).toBe('transcript')
  expect(waiting.s.statuses).toEqual(['1 context edit(s) queued'])
  const refused = host()
  refused.io.runCommand = async () => {
    throw new Error('T')
  }
  await runHandoff(refused.io, refused.s.mem, 0)
  expect(refused.s.statuses).toEqual([])
})

test('RunHandoff — resume false (transcript): no prompt; the report in the new queue; the old one keeps a note without resume', async () => {
  const { io, s, oldQueue } = host({ h: { resume: false } })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted).toEqual([])
  expect(s.queues.get('/s/new')!.report).toContain('continues old (transcript)')
  expect(s.queues.get('/s/new')!.reportResume).toBe(false)
  expect(oldQueue().report).toContain('handed off to new')
  expect(oldQueue().reportResume).toBe(false)
})

test('RunHandoff — resume false, запасні тексти: the document after a failed seed, the AfterClear notice, the document way: no prompt, each in the new queue', async () => {
  const refuse = (h: ReturnType<typeof host>) => {
    const run = h.io.runCommand
    h.io.runCommand = async (c, a) => {
      if (c === 'compact') throw new Error('T')
      await run(c, a)
    }
  }
  const doc = host({ h: { resume: false, document: 'my handoff' } })
  refuse(doc)
  expect(await runHandoff(doc.io, doc.s.mem, 0)).toBe('document')
  const notice = host({ h: { resume: false } })
  refuse(notice)
  expect(await runHandoff(notice.io, notice.s.mem, 0)).toBe('failed')
  const way = host({ h: { resume: false, mode: 'document', document: 'doc' } })
  expect(await runHandoff(way.io, way.s.mem, 0)).toBe('document')
  for (const [h, start] of [
    [doc, `context-editor: your handoff document from the previous session follows; it is your own text, not the person's.\n\nmy handoff`],
    [notice, 'context-editor: the handoff from old failed'],
    [way, `context-editor: your handoff document from the previous session follows; it is your own text, not the person's.\n\ndoc`],
  ] as const) {
    expect(h.s.submitted).toEqual([])
    expect(h.s.queues.get('/s/new')!.report!.startsWith(start)).toBe(true)
    expect(h.s.queues.get('/s/new')!.reportResume).toBe(false)
  }
})

const aliasesOf = (map: Record<string, string>): AliasRegistry => ({ next: 10, map })

test('RunHandoff — теги й псевдоніми: carried into the new storage before the prompt and brought in line by RebindTags; a failed write is a sentence in the report, the seed stays', async () => {
  const { io, s } = host()
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [{ kind: 'review', target: { tool_use_id: 'b' }, created_turn: 0 }] })
  s.aliases.set('/s/old', aliasesOf({ c4: 'b' }))
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.tags.get('/s/new')!.tags.map(t => t.kind)).toEqual(['review'])
  expect(s.aliases.get('/s/new')!.map).toEqual({ c4: 'b' })
  expect(s.submitted[0]).not.toContain('Tags and aliases were not carried over.')
  // a write that fails
  const failing = host()
  failing.s.tags.set('/s/old', { ...EMPTY_REGISTRY })
  failing.io.carryTags = async () => {
    throw new Error('no space')
  }
  expect(await runHandoff(failing.io, failing.s.mem, 0)).toBe('transcript')
  expect(failing.s.submitted[0]).toContain('Tags and aliases were not carried over.')
  expect(failing.s.toasts.join()).toContain('step registries failed: no space')
  // registries the old session lacks: nothing written, no sentence
  const bare = host()
  expect(await runHandoff(bare.io, bare.s.mem, 0)).toBe('transcript')
  expect(bare.s.tags.has('/s/new')).toBe(false)
  expect(bare.s.aliases.has('/s/new')).toBe(false)
  expect(bare.s.submitted[0]).not.toContain('Tags and aliases')
})

test('RunHandoff — псевдонім зміненої пари: c3 → a, summarize a applied in the seed; in the new session ref c3 is UNKNOWN_REF (ALIAS_GONE), not TARGET_NOT_FOUND', async () => {
  const { io, s } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  s.aliases.set('/s/old', aliasesOf({ c3: 'a', c4: 'b' }))
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  const reg = s.aliases.get('/s/new')!
  expect(reg.map).toEqual({ c4: 'b' })
  const read = parseAliases(JSON.stringify(reg))
  const seeded = s.sessions.get('new')!
  const out = prepare(seeded, resolveEditRefs([{ op: 'summarize', ref: 'c3', summary: 'x' }], refResolver(read), seeded).edits)
  expect(out.queued).toEqual([])
  // phase 31 (CF-53): UNKNOWN_REF with the reason ALIAS_GONE: the registry gave c3 out before
  expect(out.errors[0]).toContain('alias c3 is gone')
})

test('RunHandoff — тег на зміненій парі: review on pair a, summarize a applied in the seed; no tag in the new registry, as after a compaction', async () => {
  const { io, s } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [{ kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 }] })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.tags.get('/s/new')!.tags).toEqual([])
})

test('RunHandoff — disposable з заміною в пакеті засіву: disposable on b with note N and summarize b with summary N — applied, or refused by a pin; no tag in the new registry', async () => {
  const N = 'a screenshot of X'
  const disposable = { kind: 'disposable' as const, target: { tool_use_id: 'b' }, note: N, created_turn: 0 }
  const applied = host({ edits: [{ op: 'summarize', tool_use_id: 'b', summary: N }] })
  applied.s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [disposable] })
  expect(await runHandoff(applied.io, applied.s.mem, 0)).toBe('transcript')
  expect(applied.s.submitted[0]).toContain(`summarize b`)
  expect(applied.s.tags.get('/s/new')!.tags).toEqual([])
  // refused: a pin on the result row of b (the batch s.edits is taken before the pin check)
  const rows = conversation()
  const pinned = host({ rows, edits: [{ op: 'summarize', tool_use_id: 'b', summary: N }] })
  const pin = { kind: 'pin' as const, target: { anchor: fingerprint(rows[5]!), hint: 5 }, created_turn: 0 }
  pinned.s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [disposable, pin] })
  expect(await runHandoff(pinned.io, pinned.s.mem, 0)).toBe('transcript')
  expect(pinned.s.submitted[0]).toContain('summarize b: target is pinned')
  expect(pinned.s.tags.get('/s/new')!.tags.map(t => t.kind)).toEqual(['pin'])
})

test('RunHandoff — збій узгодження реєстру: RebindTags throws; the tag registry is not written into the new session; the aliases still are; the sentence once', async () => {
  const { io, s } = host()
  // a tag RebindTags cannot walk (the pin check before it skips a review)
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [{ kind: 'review', target: null as unknown as TagRegistry['tags'][number]['target'], created_turn: 0 }] })
  s.aliases.set('/s/old', aliasesOf({ c4: 'b' }))
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.tags.has('/s/new')).toBe(false)
  expect(s.aliases.get('/s/new')!.map).toEqual({ c4: 'b' })
  expect(s.submitted[0]!.split('Tags and aliases were not carried over.').length).toBe(2)
})

test('RunHandoff — незмінена пара: c4 and a pin on pair b, no edit of b; in the new session ref c4 resolves to b and the pin stays', async () => {
  const { io, s } = host({ edits: [{ op: 'drop', tool_use_id: 'c' }] })
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [{ kind: 'pin', target: { tool_use_id: 'b' }, created_turn: 0 }] })
  s.aliases.set('/s/old', aliasesOf({ c4: 'b' }))
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(refResolver(parseAliases(JSON.stringify(s.aliases.get('/s/new')!)))('c4', s.sessions.get('new')!)).toEqual({ id: 'b' })
  expect(s.tags.get('/s/new')!.tags).toEqual([{ kind: 'pin', target: { tool_use_id: 'b' }, created_turn: 0 }])
})

test('RunHandoff — пара поза засівом: a tag and an alias on a pair whose rows stayed before the summary (fromSummary); both go', async () => {
  const { io, s } = host({ rows: compacted(), api: compactedApi() })
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [{ kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 }, { kind: 'review', target: { tool_use_id: 'b' }, created_turn: 0 }] })
  s.aliases.set('/s/old', aliasesOf({ c1: 'a', c2: 'b' }))
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.aliases.get('/s/new')!.map).toEqual({ c2: 'b' })
  // the review on b stays; PinSummary adds the pin of the summary row
  expect(s.tags.get('/s/new')!.tags.map(t => ('tool_use_id' in t.target ? `${t.kind} ${t.target.tool_use_id}` : t.kind))).toEqual(['review b', 'pin'])
})

test('RunHandoff — покинутий запуск із засівом: running, stale, a seed.json with id ≥ at: dropped with "not re-run"; nothing', async () => {
  const { io, s, oldQueue } = host({ h: { state: 'running', at: 500 } })
  s.files.set('/s/old/600/seed.json', '[]')
  expect(await runHandoff(io, s.mem, 0)).toBe('nothing')
  expect(oldQueue().handoff).toBeUndefined()
  expect(oldQueue().report).toBe('context-editor: a previous handoff stopped after building /s/old/600/seed.json; it is not re-run; ask again with /handoff or context_handoff.')
  expect(s.commands).toEqual([])
  // an older seed.json does not count: the stale request runs again
  const again = host({ h: { state: 'running', at: 500 } })
  again.s.files.set('/s/old/400/seed.json', '[]')
  expect(await runHandoff(again.io, again.s.mem, 0)).toBe('transcript')
})

test('RunHandoff claims once: of two runs at the same time one finds nothing; the claim stamps owner', async () => {
  const { io, s } = host()
  let owner: string | undefined
  const update = io.changeQueue
  io.changeQueue = async (d, change) => {
    const wrote = await update(d, change)
    owner ??= s.queues.get('/s/old')!.handoff?.owner
    return wrote
  }
  const [a, b] = await Promise.all([runHandoff(io, s.mem, 0), runHandoff(io, s.mem, 0)])
  expect([a, b].filter(o => o === 'nothing').length).toBe(1)
  expect(owner).toBe('inst-1')
})

test('RunHandoff — відкладено, хід уже скінчився: scheduled is down before the run; a second run is planned after HANDOFF_DELAY with no new turn', async () => {
  const { io, s } = host()
  turnStarted(s.turns)
  turnCompleted(s.turns, false)
  // planned when the run starts: only a flag reset before it lets the run plan the next one
  s.mem.scheduled = true
  expect(await startHandoff(io, s.mem, 0)).toBe('deferred')
  expect(s.timers.map(t => t.ms)).toEqual([HANDOFF_DELAY_MS])
  expect(s.mem.scheduled).toBe(true)
  // a run deferred while a turn goes plans nothing: that turn's end will
  const busy = host()
  turnStarted(busy.s.turns)
  expect(await startHandoff(busy.io, busy.s.mem, 0)).toBe('deferred')
  expect(busy.s.timers).toEqual([])
  expect(busy.s.mem.scheduled).toBe(false)
})

test('RunHandoff — виняток до /clear: one Fail with "failed: <error>", the seed files removed, never left running, not in flight', async () => {
  const { io, s, oldQueue } = host()
  let reads = 0
  const turns = s.turns
  Object.defineProperty(io, 'turns', {
    get: () => {
      // the run reads the counter before the claim and after the build
      if (++reads === 2) throw new Error('boom')
      return turns
    },
  })
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(oldQueue().report).toBe('context-editor: handoff failed: failed: boom; the session was not changed.')
  expect(oldQueue().handoff).toBeUndefined()
  expect(s.removed).toContain(`/s/old/${NOW}`)
  expect(s.commands).toEqual([])
  expect(s.mem.inFlight).toBe(false)
})

test('RunHandoff — Fail кидає до /clear: one attempt, no retry; a toast; not in flight', async () => {
  const { io, s } = host()
  io.runCommand = async () => {
    throw new Error('refused')
  }
  let failWrites = 0
  const update = io.changeQueue
  io.changeQueue = async (d, change) =>
    update(d, async r => {
      const next = await change(r)
      if (next?.report?.includes('handoff failed')) {
        failWrites++
        throw new Error('disk full')
      }
      return next
    })
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(failWrites).toBe(1)
  expect(s.toasts).toEqual(['context-editor: handoff failed: disk full; the old queue could not be written'])
  expect(s.mem.inFlight).toBe(false)
})

test('RunHandoff — виняток після /clear, transcript: one AfterClear; with the document HandedOff document; without it FailAfterClear and the notice with seed.json', async () => {
  const breakNewStorage = (h: ReturnType<typeof host>) => {
    const storage = h.io.storage
    h.io.storage = async () => {
      if (h.s.session === 'new' && !h.s.log.includes('broke')) {
        h.s.log.push('broke')
        throw new Error('mkdir failed')
      }
      return storage()
    }
  }
  const withDoc = host({ h: { document: 'my handoff' } })
  breakNewStorage(withDoc)
  expect(await runHandoff(withDoc.io, withDoc.s.mem, 0)).toBe('document')
  expect(withDoc.s.submitted.length).toBe(1)
  expect(withDoc.s.submitted[0]).toContain('The transcript way failed (transcript: failed: mkdir failed)')
  expect(withDoc.oldQueue().report).toContain('handed off to new (document)')
  const bare = host()
  breakNewStorage(bare)
  expect(await runHandoff(bare.io, bare.s.mem, 0)).toBe('failed')
  expect(bare.s.commands).toEqual(['clear'])
  expect(bare.s.submitted.length).toBe(1)
  expect(bare.s.submitted[0]).toContain(`/s/old/${NOW}/seed.json`)
  expect(bare.oldQueue().report).toContain('handoff failed after the session was cleared: transcript: failed: mkdir failed')
})

test('RunHandoff — виняток усередині AfterClear: caught there; no further clear, one FailAfterClear, no second delivery; the toast names the step', async () => {
  const { io, s } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    if (c === 'compact') throw new Error('T')
    await run(c, a)
  }
  let failWrites = 0
  const update = io.changeQueue
  io.changeQueue = async (d, change) =>
    update(d, async r => {
      const next = await change(r)
      if (d === '/s/old' && next?.report?.includes('after the session was cleared')) {
        failWrites++
        throw new Error('disk full')
      }
      return next
    })
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear'])
  expect(failWrites).toBe(1)
  expect(s.submitted.length).toBe(1)
  expect(s.toasts).toContain('context-editor: handoff after /clear: step fail failed: disk full')
})

test('RunHandoff — HandedOff падає після /clear, document: the document is still delivered; the toast names HandedOff and the running request; outcome document', async () => {
  const { io, s, oldQueue } = host({ h: { mode: 'document', document: 'doc' } })
  const update = io.changeQueue
  io.changeQueue = async (d, change) =>
    update(d, async r => {
      const next = await change(r)
      if (next?.report?.includes('handed off to')) throw new Error('disk full')
      return next
    })
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('\n\ndoc\n\ncontext-editor: this session continues old (document).')
  expect(s.toasts).toEqual([
    'context-editor: handoff after /clear: step HandedOff failed: disk full. The old session old still holds a running handoff request; run /handoff cancel there.',
  ])
  // the old queue as the claim left it: no FailAfterClear, no copy of the delivered document
  expect(oldQueue().handoff?.state).toBe('running')
  expect(oldQueue().report).toBeUndefined()
  expect(s.files.has(DOC_COPY)).toBe(false)
})

test('RunHandoff — запис старої черги після засіву не вдався: seeded, the report and resume delivered; the toast names HandedOff and the running request', async () => {
  const { io, s } = host()
  const update = io.changeQueue
  io.changeQueue = async (d, change) =>
    update(d, async r => {
      const next = await change(r)
      if (d === '/s/old' && next?.report?.includes('handed off to')) throw new Error('disk full')
      return next
    })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted.length).toBe(1)
  expect(s.toasts).toContain(
    'context-editor: seeded the new session, but step HandedOff failed: disk full. The old session old still holds a running handoff request; run /handoff cancel there.',
  )
  // the old session resumed later, past HANDOFF_STALE: its claim sees this run's seed.json and drops the request, no second handoff
  io.changeQueue = update
  s.session = 'old'
  s.now += HANDOFF_STALE_MS + 1
  const commands = s.commands.length
  expect(await runHandoff(io, s.mem, s.turns.turns)).toBe('nothing')
  expect(s.queues.get('/s/old')!.handoff).toBeUndefined()
  expect(s.queues.get('/s/old')!.report).toContain(`a previous handoff stopped after building /s/old/${NOW}/seed.json; it is not re-run`)
  expect(s.commands.length).toBe(commands)
})

test('RunHandoff — document: the agent\'s document starts the cleared session; queued edits are reported as not carried', async () => {
  const { io, s, oldQueue } = host({ h: { mode: 'document', document: 'my handoff' }, edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  expect(s.commands).toEqual(['clear'])
  expect(s.submitted[0]!.startsWith(`context-editor: your handoff document from the previous session follows; it is your own text, not the person's.\n\nmy handoff\n\ncontext-editor: this session continues old (document).`)).toBe(true)
  expect(s.submitted[0]).toContain('The 1 queued edit(s) were not carried over.')
  expect(oldQueue().edits).toEqual([])
})

// [SP_CTX_02_21] [SP_CTX_DEC_17] phase 31 (CF-43): the fork reads its request as a prompt
test('DocumentWay — рамка запиту форку: a handoff without a document forks with HANDOFF_PROMPT, the mod\'s framed request that keeps itself out of the document', async () => {
  const { io, s } = host({ h: { mode: 'document' } })
  const asked: string[] = []
  io.fork = async prompt => (asked.push(prompt), 'forked document')
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  expect(asked).toEqual([HANDOFF_PROMPT])
  expect(HANDOFF_PROMPT.startsWith("context-editor: this request is the mod's, not the person's")).toBe(true)
  expect(HANDOFF_PROMPT.endsWith('leave them out of the document.')).toBe(true)
  // the ban on tools stays: the fork sees the session's tools (Verify of phase 10, F4)
  expect(HANDOFF_PROMPT).toContain('Do not call any tools')
})

test('RunHandoff: a refused fork and no document fail before /clear; the fork error is a reason', async () => {
  const { io, s, oldQueue } = host({ h: { mode: 'document' } })
  io.fork = async () => {
    throw new Error('no reply: aborted')
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual([])
  expect(oldQueue().report).toBe('context-editor: handoff failed: document: model fork failed: no reply: aborted; document: no handoff document; the session was not changed.')
})

test('RunHandoff — довгий хід під час /clear: past HANDOFF_STALE the end of that turn starts no second run; context_handoff and /handoff are DENIED_RUNNING', async () => {
  const { io, s, oldQueue } = host()
  const run = io.runCommand
  const seen: unknown[] = []
  io.runCommand = async (c, a) => {
    if (c === 'clear') {
      turnStarted(s.turns)
      s.now += HANDOFF_STALE_MS * 2
      turnCompleted(s.turns, false)
      seen.push(await handoffAfterTurn(io, s.mem, false))
      seen.push(await contextHandoff(io, s.mem, { mode: 'document', document: 'x' }))
      seen.push(await handoffCommand(io, s.mem, 'document'))
      seen.push(oldQueue().handoff!.mode)
    }
    await run(c, a)
  }
  await runHandoff(io, s.mem, 0)
  expect(seen[0]).toBe('none')
  expect(s.timers).toEqual([])
  expect((seen[1] as { code: string }).code).toBe('DENIED_RUNNING')
  expect(seen[2]).toBe('a handoff is already running; wait for it to end.')
  expect(seen[3]).toBe('transcript')
})

// ---- [SP_CTX_02_21] PrepareSeed, Deliver and DocumentWay when a step fails (audit PL_AUD_CTX_P6, TST-19)

test('PrepareSeed — архів не записано: "the originals could not be archived"; only the seed folder is removed (the archive was never written); the document way names the reason', async () => {
  const { io, s, oldQueue } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  const writes: string[] = []
  io.writeText = async path => (writes.push(path), false)
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  // the seed.json is never tried once the archive failed
  expect(writes).toEqual([`/s/old/${NOW}.json`])
  expect(s.removed).toEqual([`/s/old/${NOW}`])
  // the media file of the seed went with its folder
  expect(s.files.size).toBe(0)
  expect(s.commands).toEqual(['clear'])
  expect(s.submitted[0]).toContain('The transcript way failed (transcript: the originals could not be archived). The 1 queued edit(s) were not carried over.')
  expect(oldQueue().report).toContain('handed off to new (document)')
})

test('PrepareSeed — seed.json не записано: "the seed could not be written"; the folder and the archive written before it are removed (clean(true)); the document way names the reason', async () => {
  const { io, s, oldQueue } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  const writes: string[] = []
  io.writeText = async (path, body) => {
    writes.push(path)
    if (path.endsWith('/seed.json')) return false
    s.files.set(path, body)
    return true
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  expect(writes).toEqual([`/s/old/${NOW}.json`, `/s/old/${NOW}/seed.json`])
  expect(s.removed).toEqual([`/s/old/${NOW}`, `/s/old/${NOW}.json`])
  expect(s.files.size).toBe(0)
  expect(s.commands).toEqual(['clear'])
  expect(s.submitted[0]).toContain('The transcript way failed (transcript: the seed could not be written).')
  expect(oldQueue().report).toContain('handed off to new (document)')
})

test('PrepareSeed — файли засіву: seed.json stays in the old storage, the archive and media go to the archive folder; a failed seed.json removes all three', async () => {
  const { io, s } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  io.archives = async d => `/p/.claude/context-editor/${d.slice(d.lastIndexOf('/') + 1)}`
  const writes: string[] = []
  const media: string[] = []
  io.writeMedia = async path => (media.push(path), s.files.set(path, 'media'), true)
  io.writeText = async (path, body) => {
    writes.push(path)
    if (path.endsWith('/seed.json')) return false
    s.files.set(path, body)
    return true
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('document')
  expect(writes).toEqual([`/p/.claude/context-editor/old/${NOW}.json`, `/s/old/${NOW}/seed.json`])
  expect(media.every(p => p.startsWith(`/p/.claude/context-editor/old/${NOW}/`))).toBe(true)
  expect(media.length).toBeGreaterThan(0)
  expect(s.removed).toEqual([`/s/old/${NOW}`, `/p/.claude/context-editor/old/${NOW}`, `/p/.claude/context-editor/old/${NOW}.json`])
  expect(s.files.size).toBe(0)
})

test('PrepareSeed — доставки старої сесії: readDeliveries reads the old storage; the delivery stands right after its anchor in the seeded rows and the report counts it; a read that throws or an unreadable file: "could not be restored"', async () => {
  const one = '<system-reminder>\nThe user sent a new message while you were working:\nPELICAN\n</system-reminder>'
  const d: QueuedDelivery = { uuid: 'd1', anchor: ['c'], kind: 'person', origin: 'composer', text: one, cut: 0, media: 0, at: 1 }
  const { io, s } = host()
  const dirs: string[] = []
  io.readDeliveries = async dir => (dirs.push(dir), okRead({ items: [d] }))
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(dirs).toEqual(['/s/old'])
  const seeded = s.sessions.get('new')!
  const at = seeded.findIndex(r => r.text === one)
  expect(at).toBeGreaterThan(0)
  expect(seeded[at - 1]!.toolResults![0]!.tool_use_id).toBe('c')
  expect(s.submitted[0]).toContain('Messages delivered during your tool calls: 1 now stand as rows.')
  // a read that rejects: its error text is the reason; the seed goes without the deliveries
  const thrown = host()
  thrown.io.readDeliveries = async () => {
    throw new Error('EACCES')
  }
  expect(await runHandoff(thrown.io, thrown.s.mem, 0)).toBe('transcript')
  expect(thrown.s.submitted[0]).toContain('Messages delivered during your tool calls could not be restored (Error: EACCES).')
  expect(thrown.s.sessions.get('new')!.some(r => r.text === one)).toBe(false)
  const unreadable = host()
  unreadable.io.readDeliveries = async () => unreadableRead('bad item 2')
  expect(await runHandoff(unreadable.io, unreadable.s.mem, 0)).toBe('transcript')
  expect(unreadable.s.submitted[0]).toContain('Messages delivered during your tool calls could not be restored (bad item 2).')
})

test('RunHandoff — медіа промпту не перенесено: an image in the person\'s prompt that no edit replaces; the report says "Media in 1 of the person\'s prompt(s) was not carried over."', async () => {
  const withImage = [{ role: 'user', content: [{ type: 'text', text: 'task: find KEY_0042' }, image('cHJvbXB0')] }, ...api().slice(1)]
  const { io, s } = host({ api: withImage })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted[0]).toContain("context-editor: this session continues old (transcript). Media in 1 of the person's prompt(s) was not carried over.")
  // only the tool result's image went to a file
  expect([...s.files.keys()].filter(k => k.endsWith('.png'))).toEqual([`/s/old/${NOW}/1.png`])
})

test('Deliver — лише в черзі, сховище недоступне: seeded with resume false; the new storage is gone by the report; the report is lost, a toast names the step', async () => {
  const { io, s, oldQueue } = host({ h: { resume: false } })
  const storage = io.storage
  // the new session's storage works until the seed compaction is done and is gone after it (for Deliver)
  const run = io.runCommand
  let seeded = false
  io.runCommand = async (c, a) => {
    await run(c, a)
    if (c === 'compact') seeded = true
  }
  io.storage = async () => (s.session === 'new' && seeded ? { reason: 'HOME is not set' } : storage())
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted).toEqual([])
  expect(s.queues.has('/s/new')).toBe(false)
  expect(s.toasts).toEqual(['context-editor: seeded the new session, but step deliver failed: the storage of this session is unavailable: HOME is not set.'])
  expect(oldQueue().report).toContain('handed off to new (transcript)')
  expect(oldQueue().handoff).toBeUndefined()
})

test('Deliver — лише в черзі, нова черга нечитабельна: seeded with resume false; the report is lost, a toast names the step; nothing written into the new queue', async () => {
  const { io, s } = host({ h: { resume: false } })
  const update = io.changeQueue
  io.changeQueue = async (d, change) => {
    if (d !== '/s/new') return update(d, change)
    await change(unreadableRead('bad json'))
    return false
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted).toEqual([])
  expect(s.queues.has('/s/new')).toBe(false)
  expect(s.toasts).toEqual(['context-editor: seeded the new session, but step deliver failed: the queue of this session cannot be read (bad json).'])
})

test('Deliver — AfterClear, сховище недоступне: a turn began right after /clear; the notice cannot wait in the new queue; FailAfterClear in the old one and a toast naming the step', async () => {
  const { io, s, oldQueue } = host()
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    await run(c, a)
    if (c === 'clear') turnStarted(s.turns)
  }
  const storage = io.storage
  io.storage = async () => (s.session === 'new' ? { reason: 'mkdir: denied' } : storage())
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.submitted).toEqual([])
  expect(s.queues.has('/s/new')).toBe(false)
  expect(oldQueue().report).toContain('handoff failed after the session was cleared: transcript: a turn began in the new session')
  expect(s.toasts).toContain('context-editor: handoff after /clear: step deliver failed: the storage of this session is unavailable: mkdir: denied')
})

// [SP_CTX_02_21] HandDocument: after /clear, HandedOff and Deliver are steps (CF-41)
const breakNewStorage = (h: ReturnType<typeof host>) => {
  const storage = h.io.storage
  h.io.storage = async () => (h.s.session === 'new' ? { reason: 'HOME is not set' } : storage())
}
const breakNewQueue = (h: ReturnType<typeof host>) => {
  const update = h.io.changeQueue
  h.io.changeQueue = async (d, change) => {
    if (d !== '/s/new') return update(d, change)
    await change(unreadableRead('bad json'))
    return false
  }
}
const DOC_COPY = `/s/old/${NOW}/document.txt`

test('DocumentWay — Deliver лише в черзі падає: resume false, the new storage or queue unusable; outcome document, a toast names the step and the copy of the document in the old storage', async () => {
  for (const [breakNew, error] of [
    [breakNewStorage, 'the storage of this session is unavailable: HOME is not set'],
    [breakNewQueue, 'the queue of this session cannot be read (bad json)'],
  ] as const) {
    const h = host({ h: { mode: 'document', document: 'my handoff', resume: false } })
    breakNew(h)
    expect(await runHandoff(h.io, h.s.mem, 0)).toBe('document')
    expect(h.s.commands).toEqual(['clear'])
    expect(h.s.submitted).toEqual([])
    expect(h.s.queues.has('/s/new')).toBe(false)
    expect(h.s.toasts).toEqual([`context-editor: handoff after /clear: step deliver failed: ${error}. The document is in ${DOC_COPY}.`])
    // the copy is the text Deliver would have given, frame and tail included
    expect(h.s.files.get(DOC_COPY)).toBe(documentText('my handoff', 'context-editor: this session continues old (document).'))
    expect(h.oldQueue().report).toBe('context-editor: this session was handed off to new (document).')
    expect(h.oldQueue().handoff).toBeUndefined()
  }
  // the copy cannot be written either: the toast says the document is lost
  const lost = host({ h: { mode: 'document', document: 'my handoff', resume: false } })
  breakNewStorage(lost)
  lost.io.writeText = async () => false
  expect(await runHandoff(lost.io, lost.s.mem, 0)).toBe('document')
  expect(lost.s.toasts).toEqual([
    `context-editor: handoff after /clear: step deliver failed: the storage of this session is unavailable: HOME is not set. The document is lost: ${DOC_COPY} could not be written.`,
  ])
})

test('DocumentWay — хід між /clear і Deliver, шлях черги падає: resume true; the text goes the queue way and fails; outcome document, the toast names the copy; no prompt', async () => {
  const h = host({ h: { mode: 'document', document: 'my handoff' } })
  breakNewStorage(h)
  // a turn starts in the new session right after HandedOff
  const update = h.io.changeQueue
  h.io.changeQueue = async (d, change) => {
    const wrote = await update(d, change)
    if (d === '/s/old' && h.oldQueue().report?.includes('handed off to') && !h.s.turns.inTurn) turnStarted(h.s.turns)
    return wrote
  }
  expect(await runHandoff(h.io, h.s.mem, 0)).toBe('document')
  expect(h.s.submitted).toEqual([])
  expect(h.s.toasts).toEqual([`context-editor: handoff after /clear: step deliver failed: the storage of this session is unavailable: HOME is not set. The document is in ${DOC_COPY}.`])
  expect(h.s.files.get(DOC_COPY)).toContain('my handoff')
})

test('AfterClear з документом — Deliver падає: the copy lies beside the seed files (<old storage>/<seed id>/document.txt), not under the time of the failure; outcome document', async () => {
  const h = host({ h: { document: 'my handoff', resume: false } })
  const run = h.io.runCommand
  h.io.runCommand = async (c, a) => {
    // the clock moves on after the seed was built at NOW
    h.s.now += 5000
    if (c === 'compact') throw new Error('T')
    await run(c, a)
  }
  breakNewQueue(h)
  expect(await runHandoff(h.io, h.s.mem, 0)).toBe('document')
  expect(h.s.toasts).toEqual([`context-editor: handoff after /clear: step deliver failed: the queue of this session cannot be read (bad json). The document is in ${DOC_COPY}.`])
  expect(h.s.files.get(DOC_COPY)).toContain('The transcript way failed (transcript: the seed compaction was refused: T)')
  expect(h.s.files.has(`/s/old/${NOW}/seed.json`)).toBe(true)
  expect([...h.s.files.keys()].filter(f => f.endsWith('/document.txt'))).toEqual([DOC_COPY])
})

test('HandDocument — промпт відхилено: DocumentWay and AfterClear with the document; the host refuses the prompt; the toast with the host text names the copy; outcome document', async () => {
  const doc = host({ h: { mode: 'document', document: 'my handoff' } })
  doc.io.submit = async () => {
    throw new Error('T: dropped')
  }
  expect(await runHandoff(doc.io, doc.s.mem, 0)).toBe('document')
  expect(doc.s.toasts).toEqual([`context-editor: the handoff prompt was refused: T: dropped. The document is in ${DOC_COPY}.`])
  // the copy is the text without the resume prompt
  expect(doc.s.files.get(DOC_COPY)).toBe(documentText('my handoff', 'context-editor: this session continues old (document).'))
  expect(doc.oldQueue().report).toBe('context-editor: this session was handed off to new (document).')
  const after = host({ h: { document: 'my handoff' } })
  const run = after.io.runCommand
  after.io.runCommand = async (c, a) => {
    if (c === 'compact') throw new Error('T')
    await run(c, a)
  }
  after.io.submit = async () => {
    throw new Error('T: dropped')
  }
  expect(await runHandoff(after.io, after.s.mem, 0)).toBe('document')
  expect(after.s.toasts).toEqual([`context-editor: the handoff prompt was refused: T: dropped. The document is in ${DOC_COPY}.`])
  expect(after.s.files.get(DOC_COPY)).toContain('my handoff')
})

test('AfterClear — хід одразу після /clear з документом агента: the document is not delivered; its copy is written and the notice names it; FailAfterClear in the old queue', async () => {
  const { io, s, oldQueue } = host({ h: { document: 'my handoff' } })
  const run = io.runCommand
  io.runCommand = async (c, a) => {
    await run(c, a)
    if (c === 'clear') turnStarted(s.turns)
  }
  expect(await runHandoff(io, s.mem, 0)).toBe('failed')
  expect(s.commands).toEqual(['clear'])
  expect(s.submitted).toEqual([])
  expect(oldQueue().report).toContain('transcript: a turn began in the new session')
  expect(s.files.get(DOC_COPY)).toBe(
    documentText('my handoff', 'context-editor: this session continues old (document). The transcript way failed (transcript: a turn began in the new session).'),
  )
  expect(s.queues.get('/s/new')!.report).toContain(`The assembled conversation is in /s/old/${NOW}/seed.json. The document is in ${DOC_COPY}.`)
  // without the agent's document: no copy
  const bare = host()
  const bareRun = bare.io.runCommand
  bare.io.runCommand = async (c, a) => {
    await bareRun(c, a)
    if (c === 'clear') turnStarted(bare.s.turns)
  }
  expect(await runHandoff(bare.io, bare.s.mem, 0)).toBe('failed')
  expect(bare.s.files.has(DOC_COPY)).toBe(false)
})

test('DocumentWay — /clear відхилено: Fail with "document: /clear was refused: <host text>"; after a refused seed both reasons; the edits stay, no prompt', async () => {
  const refuse = async () => {
    throw new Error('T: busy')
  }
  const doc = host({ h: { mode: 'document', document: 'doc' }, edits: [{ op: 'drop', tool_use_id: 'c' }] })
  doc.io.runCommand = refuse
  expect(await runHandoff(doc.io, doc.s.mem, 0)).toBe('failed')
  const text = 'context-editor: handoff failed: document: /clear was refused: T: busy; the session was not changed.'
  expect(doc.oldQueue().report).toBe(text)
  expect(doc.oldQueue().edits.length).toBe(1)
  expect(doc.oldQueue().handoff).toBeUndefined()
  expect(doc.s.submitted).toEqual([])
  expect(doc.s.toasts).toEqual([text])
  // the transcript way refused its seed first (WINDOW_FULL): both reasons, in order
  const full = host({ rows: alternating(ROW_WINDOW), api: [] })
  full.io.runCommand = refuse
  expect(await runHandoff(full.io, full.s.mem, 0)).toBe('failed')
  expect(full.oldQueue().report).toBe(
    `context-editor: handoff failed: transcript: the conversation fills the host's ${ROW_WINDOW}-row window; its start may be cut; document: /clear was refused: T: busy; the session was not changed.`,
  )
  expect(full.s.submitted).toEqual([])
})

// ---- [SP_CTX_02_19] [SP_CTX_02_20] the tool, the command, the end of a turn

test('context_handoff — перерваний хід запиту: the agent\'s request of an interrupted turn goes; after a reload (no requestTurn) it stays and runs after the next turn end', async () => {
  const a = host()
  a.s.queues.set('/s/old', { ...EMPTY_QUEUE })
  turnStarted(a.s.turns)
  expect(await contextHandoff(a.io, a.s.mem, {})).toEqual({ result: 'Handoff queued (transcript): it runs when this turn ends. End your turn now with a one-line status.' })
  expect(a.s.mem.requestTurn).toBe(1)
  turnCompleted(a.s.turns, true)
  expect(await handoffAfterTurn(a.io, a.s.mem, true)).toBe('dropped')
  expect(a.oldQueue().handoff).toBeUndefined()
  expect(a.oldQueue().report).toContain('handoff cancelled (the turn was interrupted)')
  const reloaded = host()
  turnStarted(reloaded.s.turns)
  turnCompleted(reloaded.s.turns, true)
  expect(await handoffAfterTurn(reloaded.io, reloaded.s.mem, true)).toBe('scheduled')
  expect(reloaded.oldQueue().handoff).toEqual(handoff())
  expect(reloaded.s.timers.map(t => t.ms)).toEqual([HANDOFF_DELAY_MS])
})

// [SP_CTX_02_21] [SP_CTX_04_04] audit PL_AUD_CTX_P6, TST-21
test('handoffAfterTurn — перерваний хід, запит людини: a person\'s request survives an interrupted turn, even one the agent also asked in; dropRequest limited to the agent leaves it', async () => {
  const { io, s, oldQueue } = host({ h: { by: 'person' } })
  turnStarted(s.turns)
  // the agent asked in this turn, then the person's /handoff replaced the request
  s.mem.requestTurn = s.turns.turns
  turnCompleted(s.turns, true)
  expect(await dropRequest(io, s.mem, 'the turn was interrupted', 'agent')).toBe(false)
  expect(oldQueue().handoff).toEqual(handoff({ by: 'person' }))
  expect(await handoffAfterTurn(io, s.mem, true)).toBe('scheduled')
  expect(oldQueue().handoff).toEqual(handoff({ by: 'person' }))
  expect(oldQueue().report).toBeUndefined()
  expect(s.timers.map(t => t.ms)).toEqual([HANDOFF_DELAY_MS])
})

test('handoffAfterTurn — перерваний хід, запит агента з іншого ходу: the agent asked in turn 1, the run was deferred by turn 2, turn 2 is interrupted; the request stays and is scheduled again', async () => {
  const { io, s, oldQueue } = host()
  s.queues.set('/s/old', { ...EMPTY_QUEUE })
  turnStarted(s.turns)
  expect('result' in (await contextHandoff(io, s.mem, {}))).toBe(true)
  expect(s.mem.requestTurn).toBe(1)
  turnCompleted(s.turns, false)
  expect(await handoffAfterTurn(io, s.mem, false)).toBe('scheduled')
  // the person begins turn 2 before the planned run: it defers and plans nothing while the turn goes
  turnStarted(s.turns)
  expect(await startHandoff(io, s.mem, 1)).toBe('deferred')
  expect(s.mem.scheduled).toBe(false)
  turnCompleted(s.turns, true)
  expect(await handoffAfterTurn(io, s.mem, true)).toBe('scheduled')
  expect(oldQueue().handoff!.by).toBe('agent')
  expect(oldQueue().handoff!.state).toBe('queued')
  expect(oldQueue().report).toBeUndefined()
  expect(s.timers.length).toBe(2)
})

test('context_handoff: a subagent, no storage, an unreadable or unwritable queue are refused with their codes', async () => {
  const h = host()
  expect(await contextHandoff(h.io, h.s.mem, { agentId: 'sub' })).toEqual({ code: 'DENIED_SUBAGENT', deny: 'only the main conversation can be handed off.' })
  h.io.storage = async () => ({ reason: 'HOME is not set' })
  expect(await contextHandoff(h.io, h.s.mem, {})).toEqual({ code: 'DENIED_STORAGE', deny: 'storage unavailable: HOME is not set' })
  const u = host()
  u.io.readQueue = async () => unreadableRead('bad')
  u.io.changeQueue = async (_d, change) => {
    await change(unreadableRead('bad'))
    return false
  }
  expect(await contextHandoff(u.io, u.s.mem, {})).toEqual({ code: 'DENIED_QUEUE', deny: 'the queue cannot be read (bad).' })
  const w = host()
  w.s.queues.set('/s/old', { ...EMPTY_QUEUE })
  w.io.changeQueue = async () => {
    throw new Error('disk full')
  }
  const out = await contextHandoff(w.io, w.s.mem, {})
  expect('code' in out && out.code).toBe('DENIED_QUEUE')
  expect(w.s.mem.requestTurn).toBeUndefined()
})

test('HandoffCommand — планування: /handoff between turns queues the person\'s request and plans RunHandoff after HANDOFF_DELAY with turns0; in flight it is DENIED_RUNNING', async () => {
  const { io, s, oldQueue } = host()
  s.queues.set('/s/old', { ...EMPTY_QUEUE })
  turnStarted(s.turns)
  turnCompleted(s.turns, false)
  expect(await handoffCommand(io, s.mem, ' document ')).toBe('handoff (document) starts')
  expect(oldQueue().handoff).toEqual({ mode: 'document', resume: true, resumePrompt: 'Continue the task from where you stopped.', by: 'person', state: 'queued', at: NOW })
  expect(s.mem.scheduled).toBe(true)
  expect(s.timers.map(t => t.ms)).toEqual([HANDOFF_DELAY_MS])
  // a second command while planned plans nothing more
  await handoffCommand(io, s.mem, '')
  expect(s.timers.length).toBe(1)
  const busy = host()
  busy.s.mem.inFlight = true
  expect(await handoffCommand(busy.io, busy.s.mem, '')).toBe('a handoff is already running; wait for it to end.')
  expect(busy.s.timers).toEqual([])
})

test('HandoffCommand: /handoff cancel drops a queued request, or a running one not in flight; in flight it stays', async () => {
  const q = host()
  expect(await handoffCommand(q.io, q.s.mem, 'cancel')).toBe('handoff cancelled')
  expect(q.oldQueue().handoff).toBeUndefined()
  expect(await handoffCommand(q.io, q.s.mem, 'cancel')).toBe('no handoff waiting')
  const left = host({ h: { state: 'running', owner: 'gone' } })
  expect(await handoffCommand(left.io, left.s.mem, 'cancel')).toBe('handoff cancelled')
  const flying = host({ h: { state: 'running', owner: 'inst-1' } })
  flying.s.mem.inFlight = true
  expect(await handoffCommand(flying.io, flying.s.mem, 'cancel')).toBe('a handoff is running; it cannot be cancelled')
  expect(flying.oldQueue().handoff!.state).toBe('running')
})

test('the end of a turn schedules a due request once, after an interrupted turn too; nothing while one is in flight', async () => {
  const { io, s } = host()
  turnStarted(s.turns)
  turnCompleted(s.turns, true)
  expect(await handoffAfterTurn(io, s.mem, true)).toBe('scheduled')
  expect(await handoffAfterTurn(io, s.mem, false)).toBe('none')
  expect(s.timers.length).toBe(1)
  const flying = host()
  flying.s.mem.inFlight = true
  expect(await handoffAfterTurn(flying.io, flying.s.mem, false)).toBe('none')
})

// [SP_CTX_02_21] [SP_CTX_02_14] [SP_CTX_02_27]
test('RunHandoff — етапи в новій сесії: marks moved by RelocateMark from s.visible to s.rows; introduced = false', async () => {
  const old = conversation()
  const at = (i: number) => ({ anchor: fingerprint(old[i]!), hint: i })
  const { io, s } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  s.tags.set('/s/old', {
    ...EMPTY_REGISTRY,
    tags: [],
    introduced: true,
    reintroduce: true,
    // the end of A on the result row of a (summarized in the seed); B after the result of b (CarryNote)
    lastClosed: { name: 'A', after: at(1), end: at(3), turn: 0 },
    stage: { name: 'B', after: at(5), openedTurn: 0 },
  })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  const reg = s.tags.get('/s/new')!
  // the new session's read: the /clear row first, then the seeded rows (s.rows)
  const read = s.sessions.get('new')!
  const seeded = read.slice(read.findIndex(r => r.text === 'task: find KEY_0042'))
  expect(reg.introduced).toBe(false)
  // [SP_CTX_DEC_36] the new session's first prompt carries the guide, not INTRO_TEXT
  expect(reg.reintroduce).toBeUndefined()
  const madeAt = seeded.findIndex(r => (r.toolResults ?? []).some(t => t.tool_use_id.startsWith('a_ce')))
  expect(reg.lastClosed!.end).toEqual({ anchor: fingerprint(seeded[madeAt]!), hint: madeAt })
  expect(reg.lastClosed!.after).toEqual({ anchor: fingerprint(seeded[1]!), hint: 1 })
  // the result of b got CarryNote: the mark goes to the call row of b before it
  const callB = seeded.findIndex(r => r.toolUses.some(u => u.tool_use_id === 'b'))
  expect(reg.stage!.after).toEqual({ anchor: fingerprint(seeded[callB]!), hint: callB })
})

test('BuildSeed — carried names the results CarryNote extended; produced the made rows in the seeded list', async () => {
  const seed = built((await seedOf({}, [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }])).out)
  expect(seed.carried).toEqual(['b'])
  expect(seed.report.produced.length).toBe(1)
  const p = seed.report.produced[0]!
  expect(p.edit).toBe('summarize a')
  expect(p.fingerprint).toBe(fingerprint(seed.rows[p.index]!))
})

// [SP_CTX_02_22] [SP_CTX_02_04] MergeCallRows in the seed (live verify of phase 14, D1)
test('BuildSeed — паралельні виклики в окремих рядках: the untouched calls of one response are one seeded row, its results right after it', async () => {
  const rows: SessionMessage[] = [
    { role: 'user', text: 'task: read both', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'h1' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'c', tool: 'Read', input: {} }], handle: 'h2' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'A', isError: false }, { tool_use_id: 'c', text: 'C', isError: false }], handle: 'h3' },
    { role: 'assistant', text: 'done', toolUses: [], handle: 'h4' },
  ]
  const seed = built((await seedOf({ rows, transcript: rows })).out)
  expect(seed.rows.length).toBe(4)
  expect(seed.rows[1]!.toolUses.map(u => u.tool_use_id)).toEqual(['a', 'c'])
  expect(seed.rows[2]!.toolResults!.map(t => t.tool_use_id)).toEqual(['a', 'c'])
  expect(checkSeed(seed.rows)).toBeUndefined()
})

// [SP_CTX_02_21] [SP_CTX_02_14] notes in the handoff
test('RunHandoff — нотатки в новій сесії: a note on an untouched pair stays; one on the summarized pair moves to its result row; one on the dropped pair goes and the new session\'s report names it', async () => {
  const { io, s } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }, { op: 'drop', tool_use_id: 'c' }] })
  s.tags.set('/s/old', {
    ...EMPTY_REGISTRY,
    tags: [],
    notes: [
      { id: 'n1', target: { tool_use_id: 'b' }, text: 'the screenshot', createdTurn: 0, remindAt: 3 },
      { id: 'n2', target: { tool_use_id: 'a' }, text: 'big file', createdTurn: 0 },
      { id: 'n3', target: { tool_use_id: 'c' }, text: 'grep output', createdTurn: 0 },
    ],
    nextNote: 4,
  })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  const reg = s.tags.get('/s/new')!
  const read = s.sessions.get('new')!
  const seeded = read.slice(read.findIndex(r => r.text === 'task: find KEY_0042'))
  expect(reg.notes.map(n => n.id)).toEqual(['n1', 'n2'])
  expect(reg.notes[0]!.target).toEqual({ tool_use_id: 'b' })
  expect(reg.notes[0]!.remindAt).toBe(3)
  const k = seeded.findIndex(r => (r.toolResults ?? []).some(t => t.tool_use_id.startsWith('a_ce')))
  expect(reg.notes[1]!.target).toEqual({ anchor: fingerprint(seeded[k]!), hint: k })
  expect(reg.nextNote).toBe(4)
  expect(s.submitted[0]).toContain('Notes dropped (their rows were removed): n3.')
})

// [SP_CTX_02_34] phase 17: the seed's report estimates with the old session's calibration
test('BuildSeed / RunHandoff — the seed report\'s "freed" uses TagRegistry.charsPerToken of the old session', async () => {
  const report = { applied: ['summarize a'], failed: [], charsBefore: 1000, charsAfter: 200, originals: [], produced: [], notesDropped: [], ownCallsRemoved: 0, mediaFiles: [] }
  expect(seedReportTail({ report, archive: '', ratio: 2 })).toContain('(estimate: ~400 tokens freed;')
  expect(seedReportTail({ report, archive: '' })).toContain('(estimate: ~200 tokens (approx.) freed;')
  const { io, s } = host({ edits: [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }] })
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [], charsPerToken: 2 })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.submitted[0]).toMatch(/\(estimate: ~\d+ tokens freed;/)
})

// [SP_CTX_01_10] review round 40
test('RunHandoff — lastApply of the old session does not reach the new one', async () => {
  const { io, s } = host()
  s.tags.set('/s/old', { ...EMPTY_REGISTRY, tags: [], lastApply: { at: 3, tokensBefore: 500_000 } })
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.tags.get('/s/new')!.lastApply).toBeUndefined()
})

// [SP_CTX_02_21] ParseSeedNames: the listing of seed folders ([PL_AUD_CTX_P10], CF-19)
test('ParseSeedNames — only all-digit folder names count, spaces trimmed, in listing order', async () => {
  expect(parseSeedNames('3\n 12 \n\nabc\n4x\n-1\n7\n')).toEqual([3, 12, 7])
  expect(parseSeedNames('')).toEqual([])
})

// [SP_CTX_02_43] LogApply of a handoff: a line only when the seed applied an edit
test('LogApply — передача: "handoff: " and ApplyLine when the seed applied edits; nothing without one; a failing log loses only the line', async () => {
  const logs: string[] = []
  const report = { applied: ['summarize a'], failed: [], charsBefore: 8000, charsAfter: 2000, originals: [], produced: [], notesDropped: [], ownCallsRemoved: 0, mediaFiles: [] }
  logSeeded({ log: l => void logs.push(l) }, { report, ratio: 2 })
  expect(logs).toEqual(['handoff: applied 1 edit(s): conversation ~4k → ~1k tokens (freed ~3k)'])
  logSeeded({ log: l => void logs.push(l) }, { report: { ...report, applied: [] } })
  expect(logs.length).toBe(1)
  expect(() => logSeeded({ log: () => { throw new Error('ui') } }, { report })).not.toThrow()
  expect(() => logSeeded({}, { report })).not.toThrow()
  // a handoff without edits: no line
  const { io, s } = host()
  expect(await runHandoff(io, s.mem, 0)).toBe('transcript')
  expect(s.logs).toEqual([])
})

// ---- [SP_CTX_02_22] [SP_CTX_02_45] [SP_CTX_02_48] phase 32: BuildSeed after a resume

// conversation() as the read of a resumed process gives it: no handles, and
// the original of pair c the loader put back beside its copy
function resumed(): SessionMessage[] {
  const rows = conversation().map(({ handle: _, ...r }) => r)
  const orig: SessionMessage[] = [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'c', tool: 'Grep', input: { pattern: 'KEY' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'c', text: 'matches', isError: false }] },
  ]
  return [...rows.slice(0, 6), ...orig, ...rows.slice(6)]
}

test('BuildSeed — після відновлення: its rows have no handle (the read of the conversation), so the residual rule drops the repeat and CheckSeed accepts; without an apply in the session it refuses', async () => {
  const plain = resumed()
  const residual = built((await seedOf({ rows: plain, transcript: plain, pulled: { ledger: { entries: [] }, applied: true, unreadable: false, clean: false } })).out)
  expect(residual.rows.filter(r => r.toolUses.some(u => u.tool_use_id === 'c')).length).toBe(1)
  expect(checkSeed(residual.rows)).toBeUndefined()
  const none = built((await seedOf({ rows: plain, transcript: plain, pulled: { ledger: { entries: [] }, applied: false, unreadable: false, clean: false } })).out)
  expect(checkSeed(none.rows)).toBe('row 8: repeated call id c')
})

test('BuildSeed — результат ToolSearch: the seed names the tools it loaded (TOOLREF_TEXT)', async () => {
  const rows: SessionMessage[] = [
    { role: 'user', text: 'go', toolUses: [], handle: 'p' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'ts', tool: 'ToolSearch', input: { query: 'select:WebFetch' } }], handle: 'h1' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'ts', text: '', isError: false }], handle: 'h2' },
    { role: 'assistant', text: 'loaded', toolUses: [], handle: 'h3' },
  ]
  const seedApi = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'ts', name: 'ToolSearch', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ts', content: [{ type: 'tool_reference', tool_name: 'WebFetch' }] }] },
    { role: 'assistant', content: [{ type: 'text', text: 'loaded' }] },
  ]
  const seed = built((await seedOf({ rows, transcript: rows, api: seedApi })).out)
  expect(seed.rows.find(r => r.toolResults?.length)!.toolResults![0]!.text).toBe(toolRefWords(['WebFetch']))
})

// ---- [SP_CTX_02_54] the handoff when the host passes over the mod's compaction hook

test('Передача — обхід: context_handoff and /handoff refuse and write nothing; /handoff cancel as always; a queued request ends with HANDOFF_PASSED_OVER, no command', async () => {
  const { io, s } = host()
  const passed: HandoffIO = { ...io, compactPassed: async () => true }
  const denied = await contextHandoff(passed, s.mem, {})
  expect('deny' in denied && denied.code).toBe('DENIED_PASSED_OVER')
  expect(await handoffCommand(passed, s.mem, '')).toBe(HANDOFF_COMMAND_PASSED_OVER)
  expect(s.timers.length).toBe(0)
  expect(await handoffCommand(passed, s.mem, 'cancel')).toBe('handoff cancelled')
  const queued = host()
  const run: HandoffIO = { ...queued.io, compactPassed: async () => true }
  expect(await runHandoff(run, queued.s.mem, 0)).toBe('nothing')
  expect(queued.s.commands).toEqual([])
  const q = queued.s.queues.get('/s/old')!
  expect(q.handoff).toBeUndefined()
  expect(q.report).toContain(HANDOFF_PASSED_OVER)
})

// [SP_CTX_02_58] ScreenPerson in BuildSeed, as at an application
test('BuildSeed — ScreenPerson: a collapse over the person\'s prompt is refused; the prompt goes into the seed verbatim; the rest applies', async () => {
  const rows = conversation()
  const seed = built((await seedOf({}, [{ op: 'collapse', from_index: 0, to_index: 1, summary: 's' }, { op: 'drop', tool_use_id: 'c' }])).out)
  expect(seed.report.failed).toEqual(["collapse #0..#1: covers the person's words now; they stay verbatim"])
  expect(seed.report.applied).toEqual(['drop c'])
  expect(seed.rows[0]!.text).toBe(rows[0]!.text)
})
