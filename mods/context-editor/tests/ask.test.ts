import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { askedLine, askText, contextAsk, fragmentsOf, HELP_PART_CHARS, MAX_ASK_RESULT, splitLevel, verifyQuotes, type AskEntry, type AskIO, type Part, type PartAnswer } from '../hooks/ask'
import { sourceOf } from '../hooks/edits'
import { emptyFolds, MAX_QUESTIONS, type FoldEntry, type FoldLedger, type Question } from '../hooks/folds'
import { MAX_QUOTE, type CompleteResult, type HelperResult } from '../hooks/helper'
import { PEER_FRAME, RECALL_TOOL } from '../hooks/rows'
import { prompt, reply, result, use } from './row-fixtures'

function entry(id: string, extra: Partial<FoldEntry> = {}): FoldEntry {
  return { id, archive: '/a/1.json', entry: 0, kind: 'range', call: 'context_edit collapse call', what: 'stage "reading"', rows: 6, chars: 500, turn: 2, ...extra }
}

// The level of f1: the person's constraint, a Read and its result, an
// answer to AskUserQuestion, a subagent's report, a line of the mod.
function level(): SessionMessage[] {
  return [
    prompt('Keep the budget under 40k, please.'),
    { role: 'assistant', text: 'I will check the budget file.', toolUses: [{ tool_use_id: 'r', tool: 'Read', input: { file_path: '/p/b.md' } }] },
    result('r', 'budget: 38k total\nowner: Ann'),
    use('q', 'AskUserQuestion', undefined, { question: 'Which option?' }),
    result('q', 'Use option B'),
    prompt(`${PEER_FRAME} from="x">The subagent found three files.</agent-message>`),
    reply('context-editor: applied 1 edit(s).'),
  ]
}

function archive(rows: SessionMessage[] = level()): string {
  return JSON.stringify([{ edit: 'collapse #2..#8', rows }])
}

const json = (o: unknown): CompleteResult => ({ text: JSON.stringify(o), in: 1000, out: 50 })

function harness(o: { ledger?: FoldLedger; archives?: Record<string, string>; reply?: (prompt: readonly string[]) => CompleteResult; passed?: boolean; down?: string; rows?: SessionMessage[]; aborted?: boolean } = {}) {
  let ledger: FoldLedger = o.ledger ?? { ...emptyFolds(), folds: [entry('f1')], nextFold: 2 }
  const journal: AskEntry[] = []
  const live = new Set<string>()
  const prompts: (readonly string[])[] = []
  const debug: string[] = []
  const io: AskIO = {
    passedOver: () => !!o.passed,
    storageDown: async () => o.down,
    storageRefusal: r => `no storage: ${r}`,
    rows: async () => o.rows ?? [],
    region: async () => ({ depth: 1, scope: 'reading', turn: 3 }),
    readArchive: async p => (o.archives ?? { '/a/1.json': archive() })[p],
    onLedger: async work => work(ledger, async next => void (ledger = next)),
    live: () => live,
    note: id => void live.add(id),
    readLedger: async () => ({ state: 'ok', value: ledger }),
    helper: {
      complete: async r => {
        prompts.push(r.prompt)
        return o.reply ? o.reply(r.prompt) : json({ status: 'not_found' })
      },
    },
    journal: e => void journal.push(e),
    now: () => 1000,
    aborted: () => !!o.aborted,
    debug: t => void debug.push(t),
  }
  return { io, journal, live, prompts, debug, ledger: () => ledger }
}

// [SP_HELP_05_01] Split: the bound of a part
test('Split — межа частини: rows of 25k, 25k and 25k chars give two parts, of 2 rows and 1', () => {
  const texts = ['a', 'b', 'c'].map(c => c.repeat(25_000))
  const parts = splitLevel('f1', texts)
  expect(parts.map(p => [p.index, p.parts, p.from, p.to])).toEqual([
    [1, 2, 0, 1],
    [2, 2, 2, 2],
  ])
  expect(parts[0]!.text.startsWith('Material: fold f1, part 1 of 2, rows #0–#1\n\n')).toBe(true)
  for (const p of parts) expect(p.text.length <= HELP_PART_CHARS).toBe(true)
})

// [SP_HELP_05_01] VerifyQuotes: whitespace and the helper's wrong row
test('VerifyQuotes — пробіли й рядок: a quote with other whitespace and a wrong row is found in the row next to it, with the real row', () => {
  const rows = level()
  const fragments = rows.flatMap((r, n) => fragmentsOf(r, n, rows))
  const out = verifyQuotes([{ text: 'budget:   38k total', row: 1 }], { fold: 'f1', from: 0, to: 6 }, fragments)
  expect(out.rejected).toBe(0)
  expect(out.verified).toEqual([{ fold: 'f1', row: 2, text: 'budget:   38k total', origin: 'external', source: sourceOf('Read', { file_path: '/p/b.md' }) }])
})

// [SP_HELP_05_01] VerifyQuotes: the bounds
test('VerifyQuotes — межі: a quote across fragments, one longer than MAX_QUOTE and the two past MAX_QUOTES are rejected; a repeat counts nowhere', () => {
  const rows = level()
  const fragments = rows.flatMap((r, n) => fragmentsOf(r, n, rows))
  const quotes = [
    { text: '38k total owner: Ann Use option B', row: 2 },
    { text: 'x'.repeat(MAX_QUOTE + 1), row: 0 },
    { text: 'option B', row: 4 },
    { text: 'option B', row: 4 },
    ...Array.from({ length: 10 }, () => ({ text: 'Ann', row: 2 })),
  ]
  expect(quotes.length).toBe(14)
  const out = verifyQuotes(quotes, { fold: 'f1', from: 0, to: 6 }, fragments)
  expect(out.verified.map(q => q.text)).toEqual(['option B', 'Ann'])
  // across fragments, too long, and the two past the limit
  expect(out.rejected).toBe(4)
})

// [SP_HELP_05_01] VerifyQuotes: the origin
test('VerifyQuotes — походження: the agent\'s text, the person\'s prompt and answer, a Read result, a subagent\'s report, the mod\'s text', () => {
  const rows = level()
  const fragments = rows.flatMap((r, n) => fragmentsOf(r, n, rows))
  const quotes = ['check the budget file', 'under 40k', 'option B', 'owner: Ann', 'found three files', 'applied 1 edit'].map(text => ({ text, row: 0 }))
  const out = verifyQuotes(quotes, { fold: 'f1', from: 0, to: 6 }, fragments)
  expect(out.verified.map(q => [q.origin, q.source])).toEqual([
    ['own', ''],
    ['person', ''],
    ['person', ''],
    ['external', sourceOf('Read', { file_path: '/p/b.md' })],
    ['external', 'subagent report'],
    ['service', ''],
  ])
})

function part(fold: string, index: number, parts: number): Part {
  return { fold, index, parts, from: 0, to: 0, text: '' }
}
function answered(answer: string): HelperResult {
  return { status: 'answered', reply: { status: 'answered', answer, quotes: [], reason: '' }, reason: '', calls: 1, in: 1, out: 1 }
}
const NOT_FOUND: HelperResult = { status: 'not_found', reply: { status: 'not_found', answer: '', quotes: [], reason: '' }, reason: '', calls: 1, in: 1, out: 1 }

// [SP_HELP_05_01] Ask: AskText
test('Ask — AskText: two parts, one answered with two verified quotes, one not found, one quote rejected: lines 1–5 with the marks', () => {
  const answers: PartAnswer[] = [
    {
      part: part('f1', 1, 2),
      result: answered('Under 40k; 38k now.'),
      verified: [
        { fold: 'f1', row: 0, text: 'under 40k', origin: 'person', source: '' },
        { fold: 'f1', row: 2, text: 'budget: 38k', origin: 'external', source: 'Read /p/b.md' },
      ],
      rejected: 1,
    },
    { part: part('f1', 2, 2), result: NOT_FOUND, verified: [], rejected: 0 },
  ]
  expect(askText(['f1'], answers).split('\n')).toEqual([
    askedLine(['f1']),
    'Reading (f1, part 1 of 2): Under 40k; 38k now.',
    'Not found in f1 part 2 of 2.',
    'Verified quotes:',
    'f1 #0 [the person\'s]: "under 40k"',
    'f1 #2 [external: Read /p/b.md]: "budget: 38k"',
    'Rejected: 1 quote(s) not found verbatim in the archive.',
  ])
})

// [SP_HELP_05_01] [SP_HELP_05_02] I2: not confirmed
test('Ask — не підтверджено: an answer without a verified quote says so; no line 6 while a part answered', () => {
  const text = askText(['f1'], [{ part: part('f1', 1, 1), result: answered('It is 40k.'), verified: [], rejected: 2 }])
  expect(text.split('\n')).toEqual([askedLine(['f1']), 'Reading (not confirmed by the archive): It is 40k.', 'Rejected: 2 quote(s) not found verbatim in the archive.'])
  expect(text).not.toContain(`${RECALL_TOOL} shows the whole level.`)
  // nothing answered: line 6
  expect(askText(['f1'], [{ part: part('f1', 1, 1), result: NOT_FOUND, verified: [], rejected: 0 }])).toContain(`${RECALL_TOOL} shows the whole level.`)
})

// [SP_HELP_05_01] Ask: one part not confirmed
test('Ask — не підтверджено частину: of two answered parts the second has no verified quote; the first has no mark', () => {
  const lines = askText(
    ['f1'],
    [
      { part: part('f1', 1, 2), result: answered('A'), verified: [{ fold: 'f1', row: 0, text: 'x', origin: 'own', source: '' }], rejected: 0 },
      { part: part('f1', 2, 2), result: answered('B'), verified: [], rejected: 0 },
    ],
  ).split('\n')
  expect(lines[1]).toBe('Reading (f1, part 1 of 2): A')
  expect(lines[2]).toBe('Reading (f1, part 2 of 2, not confirmed by the archive): B')
})

// [SP_HELP_05_01] [SP_HELP_05_02] I3: the refusals in the order of the spec, no record before the helper
test('Ask — відмови: subagent, passed over, empty question, 5 folds, unknown, media, 50 records, no archive, 5 parts', async () => {
  const ask = async (h: ReturnType<typeof harness>, args: Record<string, unknown>) => {
    const out = await contextAsk(h.io, { op: 'ask', folds: ['f1'], question: 'What budget?', ...args }, 'c1')
    return 'code' in out ? out.code : 'ok'
  }
  expect(await ask(harness(), { agentId: 'sub' })).toBe('DENIED_SUBAGENT')
  expect(await ask(harness(), { op: 'errand_add' })).toBe('BAD_OP')
  expect(await ask(harness(), { when: 'turns' })).toBe('BAD_OP')
  expect(await ask(harness({ passed: true }), {})).toBe('HELPER_PASSED_OVER')
  expect(await ask(harness(), { question: '   ' })).toBe('ASK_QUESTION')
  expect(await ask(harness(), { folds: ['f1', 'f2', 'f3', 'f4', 'f5'] })).toBe('ASK_FOLDS')
  expect(await ask(harness(), { folds: ['f1', 'f1'] })).toBe('ASK_FOLDS')
  expect(await ask(harness({ down: 'no session' }), {})).toBe('DENIED_STORAGE')
  expect(await ask(harness(), { folds: ['f9'] })).toBe('FOLD_UNKNOWN')
  expect(await ask(harness({ ledger: { ...emptyFolds(), folds: [entry('f1', { kind: 'media' })], nextFold: 2 } }), {})).toBe('ASK_MEDIA')
  const q: Question = { tool_use_id: 'x', folds: ['f1'], question: 'q', verified: 0, rejected: 0, depth: 1, scope: '', turn: 1, due: false }
  const full = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ ...q, tool_use_id: `x${i}` }))
  const rows = full.flatMap(x => [use(x.tool_use_id, 'mcp__context-editor__context_helper'), result(x.tool_use_id, 'Asked: …')])
  expect(await ask(harness({ ledger: { ...emptyFolds(), folds: [entry('f1')], nextFold: 2, questions: full }, rows }), {})).toBe('QUESTIONS_FULL')
  // [SP_HELP_05_04] the archive no longer has the element
  expect(await ask(harness({ archives: { '/a/1.json': '[]' } }), {})).toBe('ARCHIVE_UNREADABLE')
  // five parts: nine rows cut at MAX_RECALL_ROW, two to a part
  const big = Array.from({ length: 9 }, () => reply('y'.repeat(50_000)))
  const h = harness({ archives: { '/a/1.json': archive(big) } })
  expect(await ask(h, {})).toBe('ASK_TOO_BIG')
  // [SP_HELP_05_02] I3: a refusal before the helper's call writes no record and asks nothing
  expect(h.ledger().questions).toEqual([])
  expect(h.prompts).toEqual([])
})

// [SP_HELP_05_01] [SP_HELP_05_02] I1, I3: an answered question
test('Ask — питання: the helper reads the level, a verified quote reaches the agent, the record and the journal are written', async () => {
  const h = harness({
    reply: () =>
      json({
        status: 'answered',
        answer: 'The person asked to keep the budget under 40k.',
        quotes: [
          { text: 'Keep the budget under 40k', row: 0 },
          { text: 'under 50k', row: 0 },
        ],
      }),
  })
  const out = await contextAsk(h.io, { op: 'ask', folds: ['f1'], question: '  What did the person say about the budget?  ' }, 'c1')
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result.split('\n')).toEqual([
    askedLine(['f1']),
    'Reading: The person asked to keep the budget under 40k.',
    'Verified quotes:',
    'f1 #0 [the person\'s]: "Keep the budget under 40k"',
    'Rejected: 1 quote(s) not found verbatim in the archive.',
  ])
  // the helper saw the question and the part, with the rows as a recall shows them
  expect(h.prompts[0]![0]).toBe('Question: What did the person say about the budget?')
  expect(h.prompts[0]![1]).toContain('Material: fold f1, part 1 of 1, rows #0–#6')
  expect(h.prompts[0]![1]).toContain('#0 user:\nKeep the budget under 40k, please.')
  expect(h.ledger().questions).toEqual([
    { tool_use_id: 'c1', folds: ['f1'], question: 'What did the person say about the budget?', verified: 1, rejected: 1, depth: 1, scope: 'reading', turn: 3, due: false },
  ])
  expect([...h.live]).toEqual(['c1'])
  expect(h.journal).toEqual([{ kind: 'ask', at: 1000, folds: ['f1'], parts: 1, calls: 1, in: 1000, out: 50, verified: 1, rejected: 1, status: 'answered' }])
})

// [SP_HELP_05_04] a fold a handoff carried: its archive is read at the path of its entry
test('Ask — згортку повернув архів іншої сесії: the archive is read at the path in the fold\'s entry; a failed helper is said, and line 6 follows', async () => {
  const other = '/old-session/7.json'
  const h = harness({ ledger: { ...emptyFolds(), folds: [entry('f4', { archive: other })], nextFold: 5 }, archives: { [other]: archive() }, reply: () => ({ failed: 'api-error 529', in: 0, out: 0 }) })
  const out = await contextAsk(h.io, { op: 'ask', folds: ['f4'], question: 'q?' }, 'c2')
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result.split('\n').slice(1)).toEqual(['The helper did not answer for f4: api-error 529.', `${RECALL_TOOL} shows the whole level.`])
  expect(h.journal[0]!.status).toBe('failed')
  // the pair still starts with ASKED_HEAD: it has its record
  expect(h.ledger().questions.map(q => q.tool_use_id)).toEqual(['c2'])
})

// [SP_HELP_02_03] QUESTIONS_FULL on the chain: the answer stays, the record does not
test('Ask — межа на ланцюжку: a ledger full by the time of the write gives the answer with the sentence and no record', async () => {
  const h = harness({ reply: () => json({ status: 'not_found' }) })
  const q: Question = { tool_use_id: 'x', folds: ['f1'], question: 'q', verified: 0, rejected: 0, depth: 1, scope: '', turn: 1, due: false }
  const full = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ ...q, tool_use_id: `x${i}` }))
  h.io.onLedger = async work => work({ ...emptyFolds(), folds: [entry('f1')], nextFold: 2, questions: full }, async () => undefined)
  for (const x of full) h.live.add(x.tool_use_id)
  const out = await contextAsk(h.io, { op: 'ask', folds: ['f1'], question: 'q?' }, 'c3')
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result.endsWith(' The question was not recorded: its pair goes with your next apply.')).toBe(true)
  expect(h.live.has('c3')).toBe(false)
})

// [SP_HELP_02_03] a cut call (Esc, an `interrupt`): the host shows the agent
// its refusal, not the answer; no record, no live pair, the journal counts
test('Ask — переривання: a call cut while the helper answered writes no record and keeps no pair; the journal has its entry', async () => {
  const h = harness({ aborted: true, reply: () => json({ status: 'answered', answer: 'Under 40k.', quotes: [{ text: 'under 40k', row: 0 }] }) })
  const out = await contextAsk(h.io, { op: 'ask', folds: ['f1'], question: 'budget?' }, 'c9')
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result.includes('The question was not recorded')).toBe(false)
  expect(h.ledger().questions).toEqual([])
  expect(h.live.size).toBe(0)
  expect(h.journal.map(e => [e.calls, e.status])).toEqual([[1, 'answered']])
})

// [SP_HELP_02_03] the record's write failed: the sentence, and a debug line
test('Ask — запис не вдався: a failed write of the ledger gives the sentence and one debug line; no live pair', async () => {
  const h = harness()
  h.io.onLedger = async () => {
    throw new Error('disk full')
  }
  const out = await contextAsk(h.io, { op: 'ask', folds: ['f1'], question: 'q?' }, 'c8')
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result.endsWith(' The question was not recorded: its pair goes with your next apply.')).toBe(true)
  expect(h.debug).toEqual(['context-editor: ask record not written: disk full'])
  expect(h.live.size).toBe(0)
})

// [SP_HELP_02_04] live L1: a quote that opens with a label of the material
test('VerifyQuotes — мітки матеріалу: a quote opening with "#n role:", "call:" or "result:" is checked and shown without the label', () => {
  const rows = level()
  const fragments = rows.flatMap((r, n) => fragmentsOf(r, n, rows))
  const source = sourceOf('Read', { file_path: '/p/b.md' })
  const quotes = [
    { text: `call: ${source}`, row: 1 },
    { text: 'result: budget: 38k total', row: 2 },
    { text: '#0 user:\nKeep the budget under 40k', row: 0 },
    { text: 'result (error): owner: Ann', row: 2 },
  ]
  const { verified, rejected } = verifyQuotes(quotes, { fold: 'f1', from: 0, to: 6 }, fragments)
  expect(verified.map(q => [q.row, q.text, q.origin])).toEqual([
    [1, source, 'own'],
    [2, 'budget: 38k total', 'external'],
    [0, 'Keep the budget under 40k', 'person'],
    [2, 'owner: Ann', 'external'],
  ])
  expect(rejected).toBe(0)
})

// [SP_HELP_02_03] two folds over three parts: the rows are numbered within
// each level, every part is asked once, the lines follow the parts' order
test('Ask — дві згортки, три частини: f1 of three 25k rows in two parts and f2 in one; quotes keep their level\'s row numbers', async () => {
  const big = [
    reply(`alpha ${'a'.repeat(25_000)}`),
    reply(`beta ${'b'.repeat(25_000)}`),
    reply(`gamma: the key is K-77 ${'c'.repeat(25_000)}`),
  ]
  const ledger = { ...emptyFolds(), folds: [entry('f1'), entry('f2', { archive: '/a/2.json' })], nextFold: 3 }
  const h = harness({
    ledger,
    archives: { '/a/1.json': archive(big), '/a/2.json': archive() },
    reply: ([, material]) =>
      material!.includes('K-77')
        ? json({ status: 'answered', answer: 'The key is K-77.', quotes: [{ text: 'the key is K-77', row: 2 }] })
        : material!.includes('budget: 38k')
          ? json({ status: 'answered', answer: '38k.', quotes: [{ text: 'budget: 38k total', row: 2 }] })
          : json({ status: 'not_found' }),
  })
  const out = await contextAsk(h.io, { op: 'ask', folds: ['f1', 'f2'], question: 'key and budget?' }, 'c7')
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result.split('\n')).toEqual([
    askedLine(['f1', 'f2']),
    'Not found in f1 part 1 of 2.',
    'Reading (f1, part 2 of 2): The key is K-77.',
    'Reading (f2, part 1 of 1): 38k.',
    'Verified quotes:',
    'f1 #2 [your own]: "the key is K-77"',
    `f2 #2 [external: ${sourceOf('Read', { file_path: '/p/b.md' })}]: "budget: 38k total"`,
  ])
  expect(h.prompts.map(p => p[1]!.split('\n')[0])).toEqual([
    'Material: fold f1, part 1 of 2, rows #0–#1',
    'Material: fold f1, part 2 of 2, rows #2–#2',
    'Material: fold f2, part 1 of 1, rows #0–#6',
  ])
  expect(h.journal.map(e => [e.parts, e.calls, e.verified, e.status])).toEqual([[3, 3, 2, 'answered']])
})

// [SP_HELP_02_03] over MAX_ASK_RESULT the quote lines go from the end
test('Ask — AskText понад межу: 40 quotes of 480 chars are cut from the end with one line of how many went; lines 1–2 stay', () => {
  const verified = Array.from({ length: 40 }, (_, i) => ({ fold: 'f1', row: i, text: `${String(i).padStart(2, '0')}${'q'.repeat(478)}`, origin: 'own' as const, source: '' }))
  const text = askText(['f1'], [{ part: part('f1', 1, 1), result: answered('Many.'), verified, rejected: 0 }])
  const lines = text.split('\n')
  expect(text.length <= MAX_ASK_RESULT).toBe(true)
  expect(lines.slice(0, 3)).toEqual([askedLine(['f1']), 'Reading: Many.', 'Verified quotes:'])
  const shown = lines.filter(l => l.startsWith('f1 #'))
  expect(shown).toEqual(verified.slice(0, shown.length).map(q => `f1 #${q.row} [your own]: "${q.text}"`))
  expect(lines.at(-1)).toBe(`… ${40 - shown.length} more verified quote(s) not shown.`)
  // one quote more would not fit
  expect(shown.length < 40).toBe(true)
})
