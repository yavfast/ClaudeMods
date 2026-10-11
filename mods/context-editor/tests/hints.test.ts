import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { aliasLine, markAlias, type AliasIO, type AliasRegistry } from '../hooks/aliases'
import { totalChars } from '../hooks/edits'
import {
  bounded,
  callLines,
  candidates,
  HINT_CONVERSATION,
  HINT_NAMES,
  HINT_RECHECK,
  HINT_RUN,
  HINT_STEP,
  newHintMemo,
  propose,
  sizeThreshold,
  softHint,
  stepThreshold,
  SUGGESTION,
  suggestionText,
  turnSuggestion,
  type HintIO,
  type HintMemo,
  type Proposal,
} from '../hooks/hints'
import { costRatios } from '../hooks/cache'
import { EMPTY_QUEUE, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { MESSAGES_ROW, type UsageInfo } from '../hooks/stages'
import { EMPTY_REGISTRY, parseRegistry, type HintState, type Tag, type TagRegistry } from '../hooks/tags'
import { missingRead, okRead, unreadableRead } from './row-fixtures'

const OUT = 40_000 // chars of one big output: 10k tokens at 4 chars per token

function use(id: string, tool = 'WebFetch'): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: {} }], handle: `u-${id}` }
}
function result(id: string, text: string): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }], handle: `r-${id}` }
}
function say(text: string, h = `s-${text.length}`): SessionMessage {
  return { role: 'assistant', text, toolUses: [], handle: h }
}
function ask(text: string): SessionMessage {
  return { role: 'user', text, toolUses: [], handle: `q-${text}` }
}

const big = (id: string): Tag => ({ kind: 'review', reason: 'big', target: { tool_use_id: id }, created_turn: 0 })

type Shape = {
  // big outputs a1..an (aliases c1..cn), `size` chars each unless `sizes`
  n: number
  size?: number
  sizes?: number[]
  tool?: string
  // exchanges (a prompt, an answer) before the outputs: requests so far
  chatter?: number
  // chars of a prompt row before the outputs (pasted text): no candidate
  before?: number
  // exchanges after the outputs: the outputs lie deeper
  after?: number
}

// The task, `chatter` exchanges, a filler text row, the outputs, `after` exchanges.
function world(s: Shape): { rows: SessionMessage[]; tags: Tag[]; map: Record<string, string> } {
  const rows: SessionMessage[] = [ask('task')]
  for (let k = 0; k < (s.chatter ?? 0); k++) rows.push(ask(`q${k}`), say(`ok${k}`, `o${k}`))
  if (s.before) rows.push(ask('y'.repeat(s.before)))
  const tags: Tag[] = []
  const map: Record<string, string> = {}
  for (let i = 1; i <= s.n; i++) {
    rows.push(use(`a${i}`, s.tool), result(`a${i}`, 'x'.repeat(s.sizes?.[i - 1] ?? s.size ?? OUT)))
    tags.push(big(`a${i}`))
    map[`c${i}`] = `a${i}`
  }
  for (let k = 0; k < (s.after ?? 0); k++) rows.push(ask(`later${k}`), say(`fine${k}`, `f${k}`))
  return { rows, tags, map }
}

// the outputs read late in a long session: worth it (R* ~53 against ~155 requests)
const WORTH: Shape = { n: 5, chatter: 150, before: 599_000 }

type Setup = {
  rows: SessionMessage[]
  reg: TagRegistry
  aliases: Read<AliasRegistry>
  queue?: Read<Queue>
  // the request with the fixed part (absent: no model response yet)
  tokens?: number
  // the Messages row; default: the conversation's chars / 4
  conversation?: number
  window?: number
  tagsRead?: Read<TagRegistry>
}

// A host for SoftHint and TurnSuggestion: the registry in memory, every port counted.
function harness(s: Setup, over: Partial<HintIO> = {}) {
  const log = { reg: s.reg, rows: 0, request: 0, usage: 0, writes: 0, calibrations: 0 }
  const conv = s.conversation ?? Math.round(totalChars(s.rows) / 4)
  const window = s.window ?? 1_000_000
  const io: HintIO = {
    readTags: async () => s.tagsRead ?? okRead(log.reg),
    readAliases: async () => s.aliases,
    readQueue: async () => s.queue ?? missingRead({ ...EMPTY_QUEUE }),
    rows: async () => {
      log.rows++
      return s.rows
    },
    request: async () => {
      log.request++
      return { tokens: s.tokens, window }
    },
    model: async () => 'claude-opus-5-5',
    usage: async (): Promise<UsageInfo> => {
      log.usage++
      return {
        context: {
          tokens: s.tokens,
          window,
          breakdown: { categories: [{ name: MESSAGES_ROW, tokens: conv, kind: 'used' }], totalTokens: conv + 40_000, rawMaxTokens: window, autoCompactThreshold: window - 100_000, apiUsage: {} },
        },
      }
    },
    updateTags: async change => {
      log.calibrations++
      log.reg = change(log.reg)
    },
    changeTags: async change => {
      const next = await change(okRead(log.reg))
      if (!next) return false
      log.writes++
      log.reg = next
      return true
    },
    ...over,
  }
  return { io, log }
}

function registry(tags: Tag[], extra: Partial<TagRegistry> = {}): TagRegistry {
  return { ...EMPTY_REGISTRY, tags, notes: [], ...extra }
}

function aliasRead(map: Record<string, string>, next: number): Read<AliasRegistry> {
  return okRead({ next, map })
}

function setup(shape: Shape, extra: Partial<Setup> = {}, reg: Partial<TagRegistry> = {}): Setup {
  const w = world(shape)
  return { rows: w.rows, reg: registry(w.tags, reg), aliases: aliasRead(w.map, shape.n + 1), tokens: 240_000, ...extra }
}

// a moment for the background writes (a shrink, a consumed run)
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// ---- [SP_CTX_02_37] SoftHint: the size channel

test('SoftHint — розмір, вигідно: a line of its own names the action, what it frees, the cache it rewrites from the earliest output and the verdict', async () => {
  const { io, log } = harness(setup(WORTH))
  const out = await softHint(io, newHintMemo())
  expect(out.outcome).toBe('hint')
  // the default apply rewrites the whole conversation (borderline); with keep_cache the tail alone (worth it): the line names the option
  expect(out.line).toBe(
    `${SUGGESTION} summarize c1, c2, c3, c4, c5 by ref in one context_edit with "keep_cache": true: frees ~38k of the ~200k conversation; that keeps the prompt cache up to the earliest and rewrites only the rows from it (~13k) if you end the turn within a few calls (edits apply when it ends; the earliest is ~10 positions back now, and past ~20 the API finds no cache); pays back after ~53 requests, this conversation has made ~155 → worth it now. Without keep_cache: the whole conversation (~163k), pays back after ~209 → borderline: worth it only if the work goes on that long; with it, a later --resume may show earlier answers twice.`,
  )
  // the state of this suggestion: the request now and the alias count
  expect(log.reg.hint).toEqual({ tokens: 240_000, marks: 6, proposed: 37_500 })
  expect(log.usage).toBe(1)
})

test('SoftHint — калібрування у фоні: a new calibration is queued on the registry chain, and the hint never waits for it ([PL_AUD_CTX_P7])', async () => {
  let asked = 0
  const { io } = harness(setup(WORTH), {
    updateTags: () => {
      asked++
      return new Promise<never>(() => undefined)
    },
  })
  expect((await softHint(io, newHintMemo())).outcome).toBe('hint')
  expect(asked).toBe(1)
})

test('SoftHint — глибоко: an earliest output beyond the lookback rewrites the whole conversation; the verdict weighs that', async () => {
  const { io } = harness(setup({ ...WORTH, after: 15 }))
  const out = await softHint(io, newHintMemo())
  expect(out.line).toContain('rewrites the prompt cache of the whole conversation once (~163k): its earliest row is ~40 positions back, beyond the ~20 the API looks back;')
  expect(out.line!.endsWith('→ borderline: worth it only if the work goes on that long.')).toBe(true)
})

test('SoftHint — невигідно: early in the session the line says so briefly and how to batch', async () => {
  const { io } = harness(setup({ ...WORTH, chatter: 0 }))
  const out = await softHint(io, newHintMemo())
  // keep_cache would not make it worth it either: the default line
  expect(out.line).toBe(
    `${SUGGESTION} not worth it yet: to summarize c1, c2, c3, c4, c5 by ref would free ~38k of the ~200k conversation but would rewrite the prompt cache of the whole conversation once (~162k); pays back after ~208 requests, this conversation has made ~5. Batch more, or compress at the end of a stage.`,
  )
})

test('SoftHint — малий запит: under the size threshold the request alone decides: no rows, no breakdown, no line', async () => {
  const { io, log } = harness(setup(WORTH, { tokens: HINT_CONVERSATION - 1 }))
  expect((await softHint(io, newHintMemo())).outcome).toBe('small')
  expect([log.rows, log.usage, log.writes]).toEqual([0, 0, 0])
})

test('SoftHint — вікно: the thresholds are at most HINT_WINDOW_SHARE / HINT_STEP_SHARE of the window: a 200k window hints from 70k', async () => {
  expect(sizeThreshold(1_000_000)).toBe(HINT_CONVERSATION)
  expect(sizeThreshold(200_000)).toBe(70_000)
  expect(stepThreshold(1_000_000)).toBe(HINT_STEP)
  expect(stepThreshold(200_000)).toBe(20_000)
  expect(sizeThreshold()).toBe(HINT_CONVERSATION)
  const narrow = harness(setup({ ...WORTH, before: 100_000 }, { tokens: 100_000, window: 200_000 }))
  expect((await softHint(narrow.io, newHintMemo())).outcome).toBe('hint')
  const wide = harness(setup({ ...WORTH, before: 100_000 }, { tokens: 100_000 }))
  expect((await softHint(wide.io, newHintMemo())).outcome).toBe('small')
})

test('SoftHint — крок: the next size suggestion only after the step of growth since the last one', async () => {
  const state: HintState = { tokens: 240_000, marks: 6 }
  const near = harness(setup(WORTH, { tokens: 240_000 + HINT_STEP - 1 }, { hint: state }))
  expect((await softHint(near.io, newHintMemo())).outcome).toBe('small')
  expect(near.log.rows).toBe(0)
  const far = harness(setup(WORTH, { tokens: 240_000 + HINT_STEP }, { hint: state }))
  expect((await softHint(far.io, newHintMemo())).outcome).toBe('hint')
  expect(far.log.reg.hint).toEqual({ tokens: 240_000 + HINT_STEP, marks: 6, proposed: 37_500 })
})

test('SoftHint — мало кандидатів: under HINT_CANDIDATES freed no line; the next size check waits HINT_RECHECK of growth', async () => {
  // one big output: ~7.5k tokens freed
  const memo: HintMemo = newHintMemo()
  const at = (tokens: number) => harness(setup({ ...WORTH, n: 1 }, { tokens }))
  const first = at(240_000)
  expect((await softHint(first.io, memo)).outcome).toBe('few-candidates')
  expect([first.log.rows, first.log.usage, first.log.writes]).toEqual([1, 0, 0])
  expect(memo.checked).toBe(240_000)
  const soon = at(240_000 + HINT_RECHECK - 1)
  expect((await softHint(soon.io, memo)).outcome).toBe('throttled')
  expect(soon.log.rows).toBe(0)
  const later = at(240_000 + HINT_RECHECK)
  expect((await softHint(later.io, memo)).outcome).toBe('few-candidates')
  expect(later.log.rows).toBe(1)
})

test('SoftHint — мала розмова: a large request with a small Messages row (VS Code fixed part) gives no line', async () => {
  const memo = newHintMemo()
  const { io, log } = harness(setup(WORTH, { conversation: 100_000 }))
  expect((await softHint(io, memo)).outcome).toBe('small-conversation')
  expect(log.usage).toBe(1)
  expect(log.reg.hint).toBeUndefined()
  expect(memo.checked).toBe(240_000)
})

test('SoftHint — малий пакет: a batch under HINT_BATCH of the conversation gives no line', async () => {
  // ~450k conversation, ~38k freed
  const memo = newHintMemo()
  const { io, log } = harness(setup({ ...WORTH, before: 1_600_000 }, { tokens: 500_000 }))
  expect((await softHint(io, memo)).outcome).toBe('small-batch')
  expect(log.reg.hint).toBeUndefined()
  expect(memo.checked).toBe(500_000)
})

test('SoftHint — lastApply лишається: the suggestion\'s telemetry neither consumes the measured apply nor needs it', async () => {
  const { io, log } = harness(setup(WORTH, {}, { lastApply: { at: 1, tokensBefore: 500_000 } }))
  expect((await softHint(io, newHintMemo())).outcome).toBe('hint')
  expect(log.reg.lastApply).toEqual({ at: 1, tokensBefore: 500_000 })
})

test('SoftHint — назви: at most HINT_NAMES aliases, largest first; the rest and those without an alias as "+n more (see context_list)"', async () => {
  const shape: Shape = { n: 8, chatter: 150, before: 300_000, sizes: [41_000, 42_000, 43_000, 44_000, 45_000, 46_000, 47_000, 48_000] }
  const s = setup(shape)
  const map = { ...(s.aliases as { value: AliasRegistry }).value.map }
  delete map.c8
  const { io } = harness({ ...s, aliases: aliasRead(map, 9) })
  const out = await softHint(io, newHintMemo())
  const named = /summarize (.*?) by ref/.exec(out.line!)![1]!
  expect(named).toBe('c7, c6, c5, c4, c3, c2 +2 more (see context_list)')
  expect(named.split(', ').length).toBe(HINT_NAMES)
})

// ---- [SP_CTX_02_37] Candidates and Propose

test('Candidates — черга, стиснуті, неактивні: queued, replaced and not yet active reviews are no candidates; a Read is reproducible', async () => {
  const w = world({ n: 3 })
  w.rows[6] = result('a3', '[context-editor] you read the full output here, then replaced it with your summary: s')
  w.rows.push(use('g', 'Grep'), result('g', 'z'.repeat(OUT)))
  const tags: Tag[] = [...w.tags, { kind: 'review', reason: 'search', target: { tool_use_id: 'g' }, ttl_turns: 3, created_turn: 0 }, { kind: 'pin', target: { anchor: 'x', hint: 0 }, created_turn: 0 }]
  const queued = [{ op: 'summarize' as const, tool_use_id: 'a1', summary: 'done' }]
  const found = candidates(w.rows, registry(tags, { turn: 1 }), queued, new Map(Object.entries(w.map).map(([a, id]) => [id, a])))
  expect(found.map(c => c.alias)).toEqual(['c2'])
  // three turns later the search review counts, without an alias; Grep is reproducible, WebFetch is not
  const later = candidates(w.rows, registry(tags, { turn: 3 }), queued, new Map([['a2', 'c2']]))
  expect(later.map(c => [c.alias, c.row, c.reproducible])).toEqual([
    ['c2', 3, false],
    [undefined, 7, true],
  ])
})

test('Propose — пакет: each candidate frees its size less its summary (a pointer for a reproducible one); the cost counts from the earliest; R̂ the responses so far', async () => {
  const rows = [ask('task'), use('r', 'Read'), result('r', 'x'.repeat(40_000)), use('w'), result('w', 'x'.repeat(40_000)), say('done')]
  const p = propose(rows, [{ alias: 'c1', row: 1, chars: 40_000, reproducible: true }, { alias: 'c2', row: 3, chars: 40_000, reproducible: false }], { ratio: 4, conversation: 21_000, request: 30_000, channel: 'size', ratios: { write: 40, out: 100 } })
  // 10k − 500 + 10k − 2500
  expect(p.freed).toBe(17_000)
  expect(p.cost.start).toBe(1)
  expect(p.rHat).toBe(3)
  // by default the whole conversation: (39·(21 000 − 17 000) + 100·3000 + 30 000) / 17 000
  expect(p.cost.rewrite).toBe(4_000)
  expect(Math.round(p.rStar)).toBe(Math.round((39 * 4_000 + 300_000 + 30_000) / 17_000))
  // with keep_cache the tail from the Read (5 positions + APPLY_MARGIN ≤ 20) is nearly all of it: no better verdict, so no option
  expect(p.verdict).toBe('not-yet')
  expect(p.keep).toBeUndefined()
  // the turn channel never counts on keep_cache
  expect(propose(rows, [{ alias: 'c1', row: 1, chars: 40_000, reproducible: true }], { ratio: 4, conversation: 21_000, channel: 'turn' }).keep).toBeUndefined()
  expect(p.named).toEqual(['c1', 'c2'])
})

// ---- [SP_CTX_02_37] SuggestionText

const proposal = (over: Partial<Proposal>): Proposal => ({
  channel: 'size',
  named: ['c3', 'c9'],
  more: 1,
  freed: 24_000,
  conversation: 180_000,
  cost: { start: 40, positions: 5, within: false, rewrite: 156_000 },
  rStar: 31.4,
  rHat: 210,
  verdict: 'worth',
  ...over,
})

const KEEP = { cost: { start: 40, positions: 5, within: true, rewrite: 9_000 }, rStar: 12.2, verdict: 'worth' as const }

test('SuggestionText — рядок: the default (whole conversation), the keep_cache form when it makes the verdict better, the turn form, not yet, no names', async () => {
  expect(suggestionText(proposal({}))).toBe(
    '[context-editor: suggestion] summarize c3, c9 +1 more (see context_list) by ref in one context_edit: frees ~24k of the ~180k conversation; rewrites the prompt cache of the whole conversation once (~156k); pays back after ~31 requests, this conversation has made ~210 → worth it now.',
  )
  expect(suggestionText(proposal({ rStar: 400, verdict: 'borderline', keep: KEEP }))).toBe(
    '[context-editor: suggestion] summarize c3, c9 +1 more (see context_list) by ref in one context_edit with "keep_cache": true: frees ~24k of the ~180k conversation; that keeps the prompt cache up to the earliest and rewrites only the rows from it (~9k) if you end the turn within a few calls (edits apply when it ends; the earliest is ~5 positions back now, and past ~20 the API finds no cache); pays back after ~12 requests, this conversation has made ~210 → worth it now. Without keep_cache: the whole conversation (~156k), pays back after ~400 → borderline: worth it only if the work goes on that long; with it, a later --resume may show earlier answers twice.',
  )
  expect(suggestionText(proposal({ rStar: 900, verdict: 'not-yet', keep: KEEP }))).toContain('pays back after ~900 → not worth it yet; with it,')
  expect(suggestionText(proposal({ channel: 'turn', stage: 'research', rStar: 300, verdict: 'borderline' }))).toBe(
    '[context-editor: suggestion] before you go on: close stage "research" with context_tag and summarize c3, c9 +1 more (see context_list) by ref in one context_edit? It frees ~24k of the ~180k conversation; rewrites the prompt cache of the whole conversation once (~156k): edits queued now apply when this turn ends, beyond the ~20 positions the API looks back; pays back after ~300 requests, this conversation has made ~210 → borderline: worth it only if the work goes on that long. Your call: nothing runs unless you do it.',
  )
  expect(suggestionText(proposal({ cost: { start: 3, positions: 64, within: false, rewrite: 156_000 } }))).toContain('rewrites the prompt cache of the whole conversation once (~156k): its earliest row is ~64 positions back, beyond the ~20 the API looks back;')
  expect(suggestionText(proposal({ channel: 'turn', verdict: 'worth' }))).toContain('before you go on: summarize c3, c9 +1 more (see context_list) by ref in one context_edit? It frees')
  expect(suggestionText(proposal({ named: [], more: 3, verdict: 'not-yet', rStar: 250_000, rHat: 40 }))).toBe(
    '[context-editor: suggestion] not worth it yet: to compress 3 candidates (see context_list) would free ~24k of the ~180k conversation but would rewrite the prompt cache of the whole conversation once (~156k); pays back after ~100000+ requests, this conversation has made ~40. Batch more, or compress at the end of a stage.',
  )
})

// ---- [SP_CTX_02_37] TurnSuggestion: the turn channel

test('TurnSuggestion — межа ходу: after a run of HINT_RUN outputs the proposal closes the open stage and compresses; the run is consumed', async () => {
  // the edits apply at the end of the turn to come: deep, the whole conversation rewritten
  const s = setup({ ...WORTH, chatter: 250 }, {}, { stage: { name: 'read', after: null, openedTurn: 0 } })
  const { io, log } = harness(s)
  const out = await turnSuggestion(io, newHintMemo())
  expect(out.outcome).toBe('hint')
  expect(out.line!.startsWith(`${SUGGESTION} before you go on: close stage "read" with context_tag and summarize c1, c2, c3, c4, c5 by ref in one context_edit? It frees ~38k`)).toBe(true)
  expect(out.line).toContain('rewrites the prompt cache of the whole conversation once (~163k): edits queued now apply when this turn ends')
  expect(out.line!.endsWith('→ worth it now. Your call: nothing runs unless you do it.')).toBe(true)
  expect(log.reg.hint).toEqual({ tokens: 240_000, marks: 6, proposed: 37_500 })
  expect((await turnSuggestion(io, newHintMemo())).outcome).toBe('short-run')
})

test('TurnSuggestion — коротка серія: fewer than HINT_RUN marked outputs since the last suggestion: nothing is read', async () => {
  const s = setup(WORTH)
  const { io, log } = harness({ ...s, aliases: aliasRead({}, HINT_RUN) })
  expect((await turnSuggestion(io, newHintMemo())).outcome).toBe('short-run')
  expect([log.request, log.rows, log.usage]).toEqual([0, 0, 0])
})

test('TurnSuggestion — невигідно в малій розмові: silent, and the run is consumed; in a large one the line says it briefly', async () => {
  // the outputs alone: ~50k conversation, 5 requests so far
  const small = harness(setup({ n: 5 }, { tokens: 60_000 }))
  expect((await turnSuggestion(small.io, newHintMemo())).outcome).toBe('not-worth')
  await settle()
  expect(small.log.reg.hint).toEqual({ marks: 6 })
  const large = harness(setup({ ...WORTH, chatter: 0 }))
  const out = await turnSuggestion(large.io, newHintMemo())
  expect(out.line!.startsWith(`${SUGGESTION} not worth it yet:`)).toBe(true)
})

test('TurnSuggestion — без кандидатів: too little to free consumes the run; the size base stays', async () => {
  const { io, log } = harness(setup({ ...WORTH, n: 1 }, {}, { hint: { tokens: 100_000, marks: 1 } }))
  const s = { ...io, readAliases: async () => aliasRead({ c1: 'a1' }, 7) }
  expect((await turnSuggestion(s, newHintMemo())).outcome).toBe('few-candidates')
  await settle()
  expect(log.reg.hint).toEqual({ tokens: 100_000, marks: 7 })
})

// ---- [SP_CTX_02_37] shrink, registries, claim

test('SoftHint — зменшення: a context smaller than at the last suggestion (an apply) restarts the counting from here', async () => {
  const memo: HintMemo = { checked: 190_000 }
  const { io, log } = harness(setup(WORTH, { tokens: 90_000 }, { hint: { tokens: 200_000, marks: 3 } }))
  expect((await softHint(io, memo)).outcome).toBe('shrunk')
  await settle()
  expect(log.reg.hint).toEqual({ tokens: 90_000, marks: 6 })
  expect(memo.checked).toBeUndefined()
  expect(log.rows).toBe(0)
})

test('SoftHint — реєстри: a missing or unreadable tag registry, an unreadable alias registry, no review tag: no line, no read of the request', async () => {
  const base = setup(WORTH)
  for (const s of [
    { ...base, tagsRead: unreadableRead('bad') as Read<TagRegistry> },
    { ...base, tagsRead: missingRead(registry([])) as Read<TagRegistry> },
    { ...base, aliases: unreadableRead('bad') as Read<AliasRegistry> },
    { ...base, reg: registry([]) },
  ]) {
    const { io, log } = harness(s)
    expect((await softHint(io, newHintMemo())).line).toBeUndefined()
    expect((await turnSuggestion(io, newHintMemo())).line).toBeUndefined()
    expect(log.request).toBe(0)
  }
})

test('SoftHint — без відповіді моделі: no request size, no size suggestion', async () => {
  const { io } = harness(setup(WORTH, { tokens: undefined }))
  expect((await softHint(io, newHintMemo())).outcome).toBe('no-size')
})

test('SoftHint — паралельний виклик: a state changed since the read (another call suggested) gives no second line', async () => {
  const { io, log } = harness(setup(WORTH))
  const taken: HintIO = {
    ...io,
    changeTags: async change => (await change(okRead({ ...log.reg, hint: { tokens: 240_000, marks: 6 } }))) !== undefined,
  }
  expect((await softHint(taken, newHintMemo())).outcome).toBe('not-claimed')
})

// ---- [SP_CTX_02_37] Bounded

test('Bounded — строк: a suggestion later than its deadline is dropped and writes no state; a claim made in time is waited for', async () => {
  const slow = harness(setup(WORTH))
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const late: HintIO = { ...slow.io, rows: async () => (await gate, setup(WORTH).rows) }
  const line = await bounded(d => softHint(late, newHintMemo(), d).then(o => o.line), async () => undefined)
  expect(line).toBeUndefined()
  release()
  await settle()
  await settle()
  expect(slow.log.reg.hint).toBeUndefined()
  const fast = harness(setup(WORTH))
  let endSleep!: () => void
  const sleeping = new Promise<void>(r => (endSleep = r))
  const claimed: HintIO = {
    ...fast.io,
    changeTags: async change => {
      const ok = await fast.io.changeTags(change)
      endSleep()
      await settle()
      return ok
    },
  }
  const got = await bounded(d => softHint(claimed, newHintMemo(), d).then(o => o.line), () => sleeping)
  expect(got!.startsWith(`${SUGGESTION} summarize`)).toBe(true)
  expect(fast.log.reg.hint).toEqual({ tokens: 240_000, marks: 6, proposed: 37_500 })
})

test('Bounded — збій роботи: a work that rejects gives no line, before or after its claim, and never rejects itself', async () => {
  const never = () => new Promise<void>(() => undefined)
  expect(await bounded(async () => Promise.reject(new Error('boom')), never)).toBeUndefined()
  // claimed, then failed: the deadline waits for the work and still gets nothing
  expect(
    await bounded(async d => {
      d.claimed = true
      throw new Error('boom')
    }, async () => undefined),
  ).toBeUndefined()
})

test('SoftHint — строк минув під час claim: the deadline expires while the claim waits on the registry chain: no state, outcome expired; a turn check consumes its run', async () => {
  const size = harness(setup(WORTH))
  const d = { expired: false, claimed: false }
  const memo = newHintMemo()
  const late: HintIO = {
    ...size.io,
    changeTags: async change => {
      d.expired = true
      return size.io.changeTags(change)
    },
  }
  expect((await softHint(late, memo, d)).outcome).toBe('expired')
  expect(d.claimed).toBe(false)
  expect(size.log.reg.hint).toBeUndefined()
  expect(memo.checked).toBe(240_000)
  const turn = harness(setup(WORTH))
  const t = { expired: false, claimed: false }
  let calls = 0
  const lateTurn: HintIO = {
    ...turn.io,
    changeTags: async change => {
      // the claim sees the deadline gone; the settle after it writes the consumed run
      if (calls++ === 0) t.expired = true
      return turn.io.changeTags(change)
    },
  }
  expect((await turnSuggestion(lateTurn, newHintMemo(), t)).outcome).toBe('expired')
  await settle()
  expect(t.claimed).toBe(false)
  expect(turn.log.reg.hint).toEqual({ marks: 6 })
})

test('SoftHint — claim не записано: changeTags rejects: no line, outcome not-claimed on either channel; the size check is not throttled for it', async () => {
  for (const check of [softHint, turnSuggestion]) {
    const { io, log } = harness(setup(WORTH))
    const failing: HintIO = { ...io, changeTags: async () => Promise.reject(new Error('disk full')) }
    const memo = newHintMemo()
    const d = { expired: false, claimed: false }
    const out = await check(failing, memo, d)
    expect(out).toEqual({ outcome: 'not-claimed' })
    expect(d.claimed).toBe(false)
    expect(memo.checked).toBeUndefined()
    expect(log.reg.hint).toBeUndefined()
  }
})

test('SoftHint — запізнення: an output whose check outlived HINT_WAIT sets checked; a turn check consumes its run; no state for the line', async () => {
  const memo = newHintMemo()
  const out = harness(setup(WORTH))
  expect((await softHint(out.io, memo, { expired: true, claimed: false })).outcome).toBe('expired')
  expect(memo.checked).toBe(240_000)
  expect(out.log.reg.hint).toBeUndefined()
  expect((await softHint(out.io, memo)).outcome).toBe('throttled')
  const turn = harness(setup(WORTH))
  expect((await turnSuggestion(turn.io, newHintMemo(), { expired: true, claimed: false })).outcome).toBe('expired')
  await settle()
  expect(turn.log.reg.hint).toEqual({ marks: 6 })
})

test('SoftHint — одна перевірка за раз: a call while a check runs (either channel) gets no line and reads nothing', async () => {
  const { io, log } = harness(setup(WORTH))
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const rows = setup(WORTH).rows
  const slow: HintIO = { ...io, rows: async () => (await gate, rows) }
  const memo = newHintMemo()
  const first = softHint(slow, memo)
  await settle()
  expect((await softHint(io, memo)).outcome).toBe('busy')
  expect((await turnSuggestion(io, memo)).outcome).toBe('busy')
  release()
  expect((await first).outcome).toBe('hint')
  expect(memo.busy).toBe(false)
  expect(log.rows).toBe(0)
})

// ---- the state in the registry, the alias line

test('TagRegistry.hint — розбір: a good state reads; a bad one makes the registry unreadable', async () => {
  const good = { ...EMPTY_REGISTRY, hint: { tokens: 120_000, marks: 7 } }
  expect(parseRegistry(JSON.stringify(good)).state).toBe('ok')
  expect(parseRegistry(JSON.stringify({ ...EMPTY_REGISTRY, hint: { marks: 1 } })).state).toBe('ok')
  expect(parseRegistry(JSON.stringify({ ...EMPTY_REGISTRY, hint: { marks: 3, proposed: 0 } })).state).toBe('ok')
  for (const hint of [{ tokens: 5 }, { marks: 0 }, { marks: 2, tokens: -1 }, { marks: 1.5 }, 'x', { marks: 2, proposed: -1 }, { marks: 2, proposed: 1.5 }, { marks: 2, proposed: '5' }, [{ marks: 2 }], [], null])
    expect(parseRegistry(JSON.stringify({ ...EMPTY_REGISTRY, hint }))).toEqual({ state: 'unreadable', reason: 'bad field(s): hint' })
})

test('MarkCall — окремий рядок (фаза 23): the alias line stays as it was; the suggestion has its own prefix and no alias id', async () => {
  let reg: AliasRegistry = { next: 4, map: {} }
  const io: AliasIO = {
    ready: async () => true,
    readAliases: async () => okRead(reg),
    writeAliases: async r => void (reg = r),
  }
  const alias = await markAlias(io, { denied: false, tool: 'WebFetch', tool_use_id: 'w', size: 9000 })
  expect(alias).toBe('c4')
  expect(aliasLine(alias!)).toBe('[context-editor] id c4: use it as "ref" in context_tag / context_edit')
  const line = suggestionText(proposal({}))
  expect(line.startsWith(`${SUGGESTION} `)).toBe(true)
  expect(line.includes(' id c')).toBe(false)
})

// ---- review 54: the batch left once, the lines of a call, the model's prices

test('TurnSuggestion — повтор: the batch the agent left is not offered again until it grows by a batch of its own; an apply between starts over', async () => {
  const left = { tokens: 240_000, marks: 1, proposed: 37_500 }
  const same = harness(setup({ ...WORTH, chatter: 250 }, {}, { hint: left }))
  expect((await turnSuggestion(same.io, newHintMemo())).outcome).toBe('repeated')
  await settle()
  expect(same.log.reg.hint).toEqual({ tokens: 240_000, marks: 6, proposed: 37_500 })
  // ten outputs, ~75k freed: grown by ~38k, more than HINT_BATCH of the ~300k conversation
  const grown = harness(setup({ ...WORTH, chatter: 250, n: 10 }, {}, { hint: left }))
  expect((await turnSuggestion(grown.io, newHintMemo())).outcome).toBe('hint')
  // a smaller request than at the last suggestion: an apply came between
  const applied = harness(setup({ ...WORTH, chatter: 250 }, {}, { hint: { ...left, tokens: 400_000 } }))
  expect((await turnSuggestion(applied.io, newHintMemo())).outcome).toBe('hint')
})

test('CallLines — рядки виклику: the alias line, then the suggestion; a call without a mark gets neither', async () => {
  expect(callLines(true, 'c4', 'S')).toEqual([aliasLine('c4'), 'S'])
  expect(callLines(true, 'c4', undefined)).toEqual([aliasLine('c4')])
  expect(callLines(true, undefined, 'S')).toEqual(['S'])
  // MarkCall без пропозицій: an unmarked call (a write included) gets no line even with a suggestion at hand
  expect(callLines(false, undefined, 'S')).toEqual([])
})

test('Propose — ціни моделі: the break-even follows the cost ratios of the model family; an unknown model gets the highest', async () => {
  const s = setup(WORTH)
  const rows = s.rows
  const found = candidates(rows, s.reg, [], new Map(Object.entries({ a1: 'c1', a2: 'c2', a3: 'c3', a4: 'c4', a5: 'c5' })))
  const at = (model: string | undefined) => propose(rows, found, { ratio: 4, conversation: 200_000, request: 240_000, channel: 'size', ratios: costRatios(model) }).rStar
  expect(at('claude-sonnet-5-5') < at('claude-opus-5-5') && at('claude-opus-5-5') < at('claude-fable-5-1')).toBe(true)
  expect(at('some-new-model')).toBe(at('claude-fable-5-1'))
  // the binding: softHint asks the model; on Sonnet the default apply is worth it already, so the line does not name keep_cache
  const sonnet = harness(s, { model: async () => 'claude-sonnet-5-5' })
  const line = (await softHint(sonnet.io, newHintMemo())).line!
  expect(line).toContain('rewrites the prompt cache of the whole conversation once (~163k); pays back after ~105 requests, this conversation has made ~155 → worth it now.')
  expect(line).not.toContain('keep_cache')
})
