import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { aliasLine, markAlias, type AliasIO, type AliasRegistry } from '../hooks/aliases'
import { MARK, totalChars } from '../hooks/edits'
import {
  bounded,
  candidates,
  HINT_CANDIDATES,
  HINT_CONVERSATION,
  HINT_NAMES,
  HINT_RECHECK,
  HINT_RUN,
  HINT_STEP,
  hintCall,
  hintText,
  newHintMemo,
  pickLine,
  softHint,
  type HintCall,
  type HintIO,
  type HintMemo,
} from '../hooks/hints'
import { EMPTY_QUEUE, type Queue, type Read } from '../hooks/queue'
import { MESSAGES_ROW, type UsageInfo } from '../hooks/stages'
import { EMPTY_REGISTRY, parseRegistry, type HintState, type Tag, type TagRegistry } from '../hooks/tags'

const WINDOW = 1_000_000
const OUT = 40_000 // chars of one big output: 10k tokens at 4 chars per token

function use(id: string, tool = 'Read'): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: {} }], handle: `u-${id}` }
}
function result(id: string, text: string): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }], handle: `r-${id}` }
}
function say(text: string): SessionMessage {
  return { role: 'assistant', text, toolUses: [], handle: `s-${text.length}` }
}

const big = (id: string): Tag => ({ kind: 'review', reason: 'big', target: { tool_use_id: id }, created_turn: 0 })

// A conversation: the task, `n` big outputs a1..an (aliases c1..cn) and a
// filler text row of `filler` chars that is no candidate.
function world(n: number, filler: number, sizes: number[] = []): { rows: SessionMessage[]; tags: Tag[]; map: Record<string, string> } {
  const rows: SessionMessage[] = [{ role: 'user', text: 'task', toolUses: [], handle: 'h0' }]
  const tags: Tag[] = []
  const map: Record<string, string> = {}
  for (let i = 1; i <= n; i++) {
    rows.push(use(`a${i}`), result(`a${i}`, 'x'.repeat(sizes[i - 1] ?? OUT)))
    tags.push(big(`a${i}`))
    map[`c${i}`] = `a${i}`
  }
  rows.push(say('y'.repeat(filler)))
  return { rows, tags, map }
}

type Setup = {
  rows: SessionMessage[]
  reg: TagRegistry
  aliases: Read<AliasRegistry>
  queue?: Read<Queue>
  // the request with the fixed part (absent: no model response yet)
  tokens?: number
  // the Messages row; default: the conversation's chars / 4
  conversation?: number
  tagsRead?: Read<TagRegistry>
}

// A host for SoftHint: the registry in memory, every port counted.
function harness(s: Setup, over: Partial<HintIO> = {}) {
  const log = { reg: s.reg, rows: 0, request: 0, usage: 0, writes: 0, calibrations: 0 }
  const conv = s.conversation ?? Math.round(totalChars(s.rows) / 4)
  const io: HintIO = {
    readTags: async () => s.tagsRead ?? { state: 'ok', value: log.reg },
    readAliases: async () => s.aliases,
    readQueue: async () => s.queue ?? { state: 'missing', value: { ...EMPTY_QUEUE } },
    rows: async () => {
      log.rows++
      return s.rows
    },
    request: async () => {
      log.request++
      return { tokens: s.tokens, window: WINDOW }
    },
    usage: async (): Promise<UsageInfo> => {
      log.usage++
      return {
        context: {
          tokens: s.tokens,
          window: WINDOW,
          breakdown: { categories: [{ name: MESSAGES_ROW, tokens: conv, kind: 'used' }], totalTokens: conv + 40_000, rawMaxTokens: WINDOW, autoCompactThreshold: 900_000, apiUsage: {} },
        },
      }
    },
    updateRegistry: async change => {
      log.calibrations++
      log.reg = change(log.reg)
    },
    updateTags: async change => {
      const next = change({ state: 'ok', value: log.reg })
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
  return { state: 'ok', value: { next, map } }
}

const output = (alias?: string): HintCall => ({ kind: 'output', ...(alias ? { alias } : {}) })
const write: HintCall = { kind: 'write' }

// a moment for the background writes (a shrink, a consumed run)
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// ---- [SP_CTX_02_37] SoftHint: the size trigger

test('SoftHint — розмір: the first hint names the big outputs by alias, largest first, with the context, its share and the conversation', async () => {
  const w = world(5, 80_000)
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead({ ...w.map, c6: 'a6' }, 7), tokens: 110_000 })
  const out = await softHint(io, newHintMemo(), output('c6'))
  expect(out.outcome).toBe('hint')
  expect(out.line!.startsWith(`${MARK} id c6 · context ~110k tokens, 11% of the 1000k window (conversation ~70k) · earlier outputs not compressed yet: c1 ~10k, c2 ~10k, c3 ~10k, c4 ~10k, c5 ~10k (~50k in all; an edit rebuilds the prompt cache from the earliest: up to ~70k)`)).toBe(true)
  expect(out.line!.endsWith('if you have used them, summarize them by ref with context_edit, or close the stage with context_tag')).toBe(true)
  // the state of this hint: the request now and the alias count after this call
  expect(log.reg.hint).toEqual({ tokens: 110_000, marks: 7 })
  expect(log.usage).toBe(1)
})

test('SoftHint — малий запит: under HINT_CONVERSATION the request alone decides: no rows, no breakdown, no line', async () => {
  const w = world(5, 0)
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: HINT_CONVERSATION - 1 })
  const out = await softHint(io, newHintMemo(), output('c5'))
  expect(out.outcome).toBe('small')
  expect(out.line).toBeUndefined()
  expect([log.rows, log.usage, log.writes]).toEqual([0, 0, 0])
})

test('SoftHint — крок: the next size hint only after HINT_STEP of growth since the last one', async () => {
  const w = world(5, 80_000)
  const state: HintState = { tokens: 110_000, marks: 7 }
  const near = harness({ rows: w.rows, reg: registry(w.tags, { hint: state }), aliases: aliasRead(w.map, 8), tokens: 110_000 + HINT_STEP - 1 })
  expect((await softHint(near.io, newHintMemo(), output('c7'))).outcome).toBe('small')
  expect(near.log.rows).toBe(0)
  const far = harness({ rows: w.rows, reg: registry(w.tags, { hint: state }), aliases: aliasRead(w.map, 8), tokens: 110_000 + HINT_STEP })
  const out = await softHint(far.io, newHintMemo(), output('c7'))
  expect(out.outcome).toBe('hint')
  expect(far.log.reg.hint).toEqual({ tokens: 110_000 + HINT_STEP, marks: 8 })
})

test('SoftHint — мало кандидатів: under HINT_CANDIDATES no line; the next size check waits HINT_RECHECK of growth', async () => {
  // one big output: 10k tokens < 15k
  const w = world(1, 200_000)
  const memo: HintMemo = newHintMemo()
  const setup = (tokens: number): Setup => ({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 3), tokens })
  const first = harness(setup(100_000))
  expect((await softHint(first.io, memo, output('c2'))).outcome).toBe('few-candidates')
  expect(first.log.rows).toBe(1)
  expect(first.log.usage).toBe(0)
  expect(first.log.writes).toBe(0)
  expect(memo.checked).toBe(100_000)
  const soon = harness(setup(100_000 + HINT_RECHECK - 1))
  expect((await softHint(soon.io, memo, output('c2'))).outcome).toBe('throttled')
  expect(soon.log.rows).toBe(0)
  const later = harness(setup(100_000 + HINT_RECHECK))
  expect((await softHint(later.io, memo, output('c2'))).outcome).toBe('few-candidates')
  expect(later.log.rows).toBe(1)
})

test('SoftHint — мала розмова: a large request with a small Messages row (VS Code fixed part) gives no line', async () => {
  const w = world(5, 0)
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: 120_000, conversation: 30_000 })
  const memo = newHintMemo()
  const out = await softHint(io, memo, output('c5'))
  expect(out.outcome).toBe('small-conversation')
  expect(log.usage).toBe(1)
  expect(log.reg.hint).toBeUndefined()
  expect(memo.checked).toBe(120_000)
})

test('SoftHint — lastApply лишається: the hint\'s telemetry neither consumes the measured apply nor needs it', async () => {
  const w = world(5, 80_000)
  const reg = registry(w.tags, { lastApply: { at: 1, tokensBefore: 200_000 } })
  const { io, log } = harness({ rows: w.rows, reg, aliases: aliasRead(w.map, 6), tokens: 110_000 })
  expect((await softHint(io, newHintMemo(), output('c5'))).outcome).toBe('hint')
  expect(log.reg.lastApply).toEqual({ at: 1, tokensBefore: 200_000 })
})

test('SoftHint — без псевдонімів: an output whose alias was not written still gets the line, without an id', async () => {
  const w = world(5, 80_000)
  const { io } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: 110_000 })
  const out = await softHint(io, newHintMemo(), output())
  expect(out.line!.startsWith(`${MARK} · context ~110k tokens`)).toBe(true)
})

// ---- [SP_CTX_02_37] Candidates

test('Candidates — черга, стиснуті, неактивні: queued, replaced and not yet active reviews are no candidates', async () => {
  const w = world(3, 0)
  // a3 replaced by the mod; a search review within its term; a pin
  w.rows[6] = result('a3', `${MARK} you read the full output here, then replaced it with your summary: s`)
  w.rows.push(use('g', 'Grep'), result('g', 'z'.repeat(OUT)))
  const tags: Tag[] = [...w.tags, { kind: 'review', reason: 'search', target: { tool_use_id: 'g' }, ttl_turns: 3, created_turn: 0 }, { kind: 'pin', target: { anchor: 'x', hint: 0 }, created_turn: 0 }]
  const queued = [{ op: 'summarize' as const, tool_use_id: 'a1', summary: 'done' }]
  const found = candidates(w.rows, registry(tags, { turn: 1 }), queued, new Map(Object.entries(w.map).map(([a, id]) => [id, a])))
  expect(found.map(c => c.alias)).toEqual(['c2'])
  // three turns later the search review counts, without an alias
  const later = candidates(w.rows, registry(tags, { turn: 3 }), queued, new Map([['a2', 'c2']]))
  expect(later.map(c => [c.alias, c.row])).toEqual([['c2', 3], [undefined, 8]])
})

test('SoftHint — назви: at most HINT_NAMES aliases, largest first; the rest and those without an alias as "+n more in context_list"', async () => {
  const sizes = [41_000, 42_000, 43_000, 44_000, 45_000, 46_000, 47_000, 48_000]
  const w = world(8, 0, sizes)
  const map = { ...w.map }
  delete map.c8
  const { io } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(map, 9), tokens: 200_000, conversation: 90_000 })
  const out = await softHint(io, newHintMemo(), output())
  const named = /not compressed yet: (.*?) \(~/.exec(out.line!)![1]!
  expect(named.split(', ').length).toBe(HINT_NAMES + 1)
  expect(named.startsWith('c7 ~')).toBe(true)
  expect(named.endsWith('+2 more (see context_list)')).toBe(true)
})

// ---- [SP_CTX_02_37] SoftHint: the stage-boundary trigger

test('SoftHint — межа етапу: the first write after HINT_RUN marked outputs gets the line without the breakdown; the next write none', async () => {
  const w = world(6, 0)
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 7), tokens: 80_000 })
  const out = await softHint(io, newHintMemo(), write)
  expect(out.outcome).toBe('hint')
  expect(out.line!.startsWith(`${MARK} · first write after 6 big or search outputs · context ~80k tokens, 8% of the 1000k window · earlier outputs not compressed yet: c1 ~10k`)).toBe(true)
  expect(log.usage).toBe(0)
  expect(log.reg.hint).toEqual({ tokens: 80_000, marks: 7 })
  const again = await softHint(io, newHintMemo(), write)
  expect(again.outcome).toBe('short-run')
  expect(log.request).toBe(1)
})

test('SoftHint — межа етапу без розміру: no conversation threshold; a run shorter than HINT_RUN gives nothing and reads nothing', async () => {
  const w = world(HINT_RUN - 1, 0)
  const short = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, HINT_RUN), tokens: 30_000 })
  expect((await softHint(short.io, newHintMemo(), write)).outcome).toBe('short-run')
  expect([short.log.request, short.log.rows]).toEqual([0, 0])
  const full = world(HINT_RUN, 0)
  const ok = harness({ rows: full.rows, reg: registry(full.tags), aliases: aliasRead(full.map, HINT_RUN + 1), tokens: 30_000 })
  expect((await softHint(ok.io, newHintMemo(), write)).outcome).toBe('hint')
})

test('SoftHint — межа етапу без кандидатів: the check consumes the run; the size base stays', async () => {
  const w = world(6, 0)
  // five of the six outputs are compressed already: 10k tokens left
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags.slice(0, 1), { hint: { tokens: 60_000, marks: 1 } }), aliases: aliasRead(w.map, 7), tokens: 80_000 })
  expect((await softHint(io, newHintMemo(), write)).outcome).toBe('few-candidates')
  await settle()
  expect(log.reg.hint).toEqual({ tokens: 60_000, marks: 7 })
  expect((await softHint(io, newHintMemo(), write)).outcome).toBe('short-run')
})

// ---- [SP_CTX_02_37] SoftHint: shrink, registries, claim

test('SoftHint — зменшення: a context smaller than at the last hint (an apply) restarts the counting from here', async () => {
  const w = world(6, 80_000)
  const memo: HintMemo = { checked: 190_000 }
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags, { hint: { tokens: 200_000, marks: 3 } }), aliases: aliasRead(w.map, 7), tokens: 90_000 })
  expect((await softHint(io, memo, output('c6'))).outcome).toBe('shrunk')
  await settle()
  expect(log.reg.hint).toEqual({ tokens: 90_000, marks: 7 })
  expect(memo.checked).toBeUndefined()
  expect(log.rows).toBe(0)
})

test('SoftHint — реєстри: a missing or unreadable tag registry, an unreadable alias registry, no review tag: no line', async () => {
  const w = world(5, 80_000)
  const base: Setup = { rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: 110_000 }
  for (const s of [
    { ...base, tagsRead: { state: 'unreadable', reason: 'bad' } as Read<TagRegistry> },
    { ...base, tagsRead: { state: 'missing', value: registry([]) } as Read<TagRegistry> },
    { ...base, aliases: { state: 'unreadable', reason: 'bad' } as Read<AliasRegistry> },
    { ...base, reg: registry([]) },
  ]) {
    const { io, log } = harness(s)
    expect((await softHint(io, newHintMemo(), output('c5'))).line).toBeUndefined()
    expect(log.request).toBe(0)
  }
})

test('SoftHint — без відповіді моделі: no request size, no size hint', async () => {
  const w = world(5, 80_000)
  const { io } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6) })
  expect((await softHint(io, newHintMemo(), output('c5'))).outcome).toBe('no-size')
})

test('SoftHint — паралельний виклик: a state changed since the read (another call hinted) gives no second line', async () => {
  const w = world(5, 80_000)
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: 110_000 })
  const taken: HintIO = {
    ...io,
    updateTags: async change => {
      const next = change({ state: 'ok', value: { ...log.reg, hint: { tokens: 110_000, marks: 6 } } })
      return next !== undefined
    },
  }
  expect((await softHint(taken, newHintMemo(), output('c5'))).outcome).toBe('not-claimed')
})

// ---- [SP_CTX_02_37] Bounded

test('Bounded — строк: a hint later than its deadline is dropped and writes no state; a claim made in time is waited for', async () => {
  const w = world(5, 80_000)
  const slow = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: 110_000 })
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const late: HintIO = { ...slow.io, rows: async () => (await gate, w.rows) }
  const line = await bounded(d => softHint(late, newHintMemo(), output('c5'), d).then(o => o.line), async () => undefined)
  expect(line).toBeUndefined()
  release()
  await settle()
  await settle()
  expect(slow.log.reg.hint).toBeUndefined()
  // the claim is made before the deadline ends: the line comes
  const fast = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: 110_000 })
  let endSleep!: () => void
  const sleeping = new Promise<void>(r => (endSleep = r))
  const claimed: HintIO = {
    ...fast.io,
    updateTags: async change => {
      const ok = await fast.io.updateTags(change)
      endSleep()
      await settle()
      return ok
    },
  }
  const got = await bounded(d => softHint(claimed, newHintMemo(), output('c5'), d).then(o => o.line), () => sleeping)
  expect(got!.startsWith(`${MARK} id c5 ·`)).toBe(true)
  expect(fast.log.reg.hint).toEqual({ tokens: 110_000, marks: 6 })
})

// ---- [SP_CTX_02_37] HintText, the state in the registry, the alias

test('HintText — рядок: the parts in order, the share under 1 % as <1, without names only the count', async () => {
  expect(
    hintText({ call: { kind: 'output', alias: 'c12' }, tokens: 108_000, window: 1_000_000, conversation: 68_000, named: [{ alias: 'c3', tokens: 9_000 }, { alias: 'c9', tokens: 7_400 }], more: 1, total: 24_000, recache: 60_000 }),
  ).toBe(
    '[context-editor] id c12 · context ~108k tokens, 11% of the 1000k window (conversation ~68k) · earlier outputs not compressed yet: c3 ~9k, c9 ~7k, +1 more (see context_list) (~24k in all; an edit rebuilds the prompt cache from the earliest: up to ~60k) · if you have used them, summarize them by ref with context_edit, or close the stage with context_tag',
  )
  const plain = hintText({ call: { kind: 'write' }, run: 7, tokens: 4_000, window: 1_000_000, named: [], more: 3, total: 20_000, recache: 30_000 })
  expect(plain.startsWith('[context-editor] · first write after 7 big or search outputs · context ~4k tokens, <1% of the 1000k window · earlier outputs not compressed yet: 3 (see context_list) (~20k in all; an edit rebuilds the prompt cache from the earliest: up to ~30k)')).toBe(true)
})

test('TagRegistry.hint — розбір: a good state reads; a bad one makes the registry unreadable', async () => {
  const good = { ...EMPTY_REGISTRY, hint: { tokens: 120_000, marks: 7 } }
  expect(parseRegistry(JSON.stringify(good)).state).toBe('ok')
  expect(parseRegistry(JSON.stringify({ ...EMPTY_REGISTRY, hint: { marks: 1 } })).state).toBe('ok')
  for (const hint of [{ tokens: 5 }, { marks: 0 }, { marks: 2, tokens: -1 }, { marks: 1.5 }, 'x'])
    expect(parseRegistry(JSON.stringify({ ...EMPTY_REGISTRY, hint })).state).toBe('unreadable')
})

test('MarkCall — злитий рядок: markAlias gives the id the hint line starts with; without a hint the bare alias line stays', async () => {
  let reg: AliasRegistry = { next: 4, map: {} }
  const io: AliasIO = {
    ready: async () => true,
    readAliases: async () => ({ state: 'ok', value: reg }),
    writeAliases: async r => void (reg = r),
  }
  const alias = await markAlias(io, { denied: false, tool: 'WebFetch', tool_use_id: 'w', size: 9000 })
  expect(alias).toBe('c4')
  expect(aliasLine(alias!)).toBe('[context-editor] id c4: use it as "ref" in context_tag / context_edit')
  expect(hintText({ call: { kind: 'output', alias: alias! }, named: [], more: 1, total: HINT_CANDIDATES, recache: 1 }).startsWith('[context-editor] id c4 · ')).toBe(true)
})

// ---- review 52: a late check throttles; one check at a time; a write after a shrink; the pure binding

test('SoftHint — запізнення: an output whose check outlived HINT_WAIT sets checked; a write consumes its run; no state for the hint', async () => {
  const w = world(6, 80_000)
  const expired = { expired: true, claimed: false }
  const memo = newHintMemo()
  const out = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 7), tokens: 110_000 })
  expect((await softHint(out.io, memo, output('c6'), expired)).outcome).toBe('expired')
  expect(memo.checked).toBe(110_000)
  expect(out.log.reg.hint).toBeUndefined()
  // the next output soon after: no rows read
  expect((await softHint(out.io, memo, output('c6'))).outcome).toBe('throttled')
  const wr = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 7), tokens: 80_000 })
  expect((await softHint(wr.io, newHintMemo(), write, { expired: true, claimed: false })).outcome).toBe('expired')
  await settle()
  expect(wr.log.reg.hint).toEqual({ marks: 7 })
  expect((await softHint(wr.io, newHintMemo(), write)).outcome).toBe('short-run')
})

test('SoftHint — одна перевірка за раз: a call while a check runs gets no line and reads nothing', async () => {
  const w = world(5, 80_000)
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags), aliases: aliasRead(w.map, 6), tokens: 110_000 })
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const slow: HintIO = { ...io, rows: async () => (await gate, w.rows) }
  const memo = newHintMemo()
  const first = softHint(slow, memo, output('c5'))
  await settle()
  expect((await softHint(io, memo, output('c5'))).outcome).toBe('busy')
  release()
  expect((await first).outcome).toBe('hint')
  expect(memo.busy).toBe(false)
  expect(log.rows).toBe(0)
})

test('SoftHint — запис після зменшення: the base moves to the new size, the run stays, the candidates still decide', async () => {
  // c11..c15 read after the last hint; an apply of other rows at the end of the turn; the first Edit of the next turn
  const w = world(5, 0)
  const { io, log } = harness({ rows: w.rows, reg: registry(w.tags, { hint: { tokens: 200_000, marks: 1 } }), aliases: aliasRead(w.map, 6), tokens: 90_000 })
  const out = await softHint(io, newHintMemo(), write)
  expect(out.outcome).toBe('hint')
  expect(out.line!.startsWith(`${MARK} · first write after 5 big or search outputs · context ~90k tokens`)).toBe(true)
  expect(log.reg.hint).toEqual({ tokens: 90_000, marks: 6 })
  expect(log.writes).toBe(2)
})

test('HintCall і PickLine — зв\'язування: a write wins over a mark, a failed write with a big output is an output; the hint replaces the alias line', async () => {
  expect(hintCall(true, true, 'c3')).toEqual({ kind: 'write', alias: 'c3' })
  expect(hintCall(false, true)).toEqual({ kind: 'write' })
  expect(hintCall(true, false, 'c4')).toEqual({ kind: 'output', alias: 'c4' })
  expect(hintCall(true, false)).toEqual({ kind: 'output' })
  expect(hintCall(false, false, 'c5')).toBeUndefined()
  expect(pickLine('[context-editor] id c4 · x', 'c4')).toBe('[context-editor] id c4 · x')
  expect(pickLine(undefined, 'c4')).toBe(aliasLine('c4'))
  expect(pickLine(undefined, undefined)).toBeUndefined()
})
