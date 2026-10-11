import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applyEdits, describeEdit, dropOwnCalls, fingerprint, listRows, prepare, producedRows, readView, snapshotOf, type QueuedEdit, type ViewIO } from '../hooks/edits'
import { EMPTY_QUEUE, type HandoffRequest, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import type { AliasRegistry } from '../hooks/aliases'
import {
  blockReport,
  calibrate,
  CALIB_MAX,
  CALIB_MIN,
  CALIB_TOKENS,
  estimate,
  headerSize,
  carrierRow,
  detectOptimize,
  distinctive,
  hasOptimizeMark,
  INTRO_TEXT,
  LIST_HINT,
  markBefore,
  markClose,
  markIndex,
  markLabels,
  MAX_BLOCK_INDEXES,
  MESSAGES_ROW,
  OPTIMIZE_MARK,
  optimizeText,
  personAdvice,
  relocateMark,
  relocateStageMarks,
  SKILL,
  STAGE_ADVICE,
  startOf,
  tagCallIO,
  telemetry,
  telemetryText,
  contextList,
  listAliases,
  listLabels,
  type BlockIO,
  type ClosedBlock,
  type ListIO,
  type DetectIO,
  type RowMark,
  type UsageInfo,
} from '../hooks/stages'
import { contextTag, parseRegistry, rebindTags, tagLabels, type Tag, type TagIO, type TagRegistry } from '../hooks/tags'
import { prompt, reg, reply, result, use as callRow, missingRead, okRead, unreadableRead } from './row-fixtures'

const think = (): SessionMessage => ({ role: 'assistant', text: '', toolUses: [] })
// every call here reads its own file: the block reports count reproducible pairs by path
const use = (id: string, tool = 'Read'): SessionMessage => callRow(id, tool, undefined, { file_path: `/f/${id}` })
const TAG_TOOL = 'mcp__context-editor__context_tag'

// #0..#12: a prompt, four pairs with text between, the call of context_tag at #12 (callId "tc")
function rows(): SessionMessage[] {
  return [
    prompt('task'),
    use('a'),
    result('a', 'x'.repeat(5000)),
    reply('plan'),
    use('b', 'Grep'),
    result('b'),
    reply('step'),
    use('c'),
    result('c'),
    reply('found'),
    use('d'),
    result('d'),
    use('tc', TAG_TOOL),
  ]
}

const mark = (r: readonly SessionMessage[], i: number): RowMark => ({ anchor: fingerprint(r[i]!), hint: i })

const USAGE: UsageInfo = {
  context: {
    tokens: 90_000,
    window: 200_000,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 20_000, kind: 'used' },
        { name: MESSAGES_ROW, tokens: 12_000, kind: 'used' },
        { name: 'Free space', tokens: 100_000, kind: 'free' },
      ],
      totalTokens: 82_000,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 160_000,
    },
  },
}

// A host for context_tag with its close reports: the registry and queue in
// memory, BlockReport over the same rows.
function harness(start: TagRegistry, list: SessionMessage[] = rows(), over: Partial<TagIO> = {}) {
  const log = { tags: start, queue: { ...EMPTY_QUEUE } as Queue, replaces: 0, listed: undefined as string | undefined, writes: 0 }
  const block: BlockIO = {
    key: async () => 'K',
    rows: async () => list,
    readTags: async () => okRead(log.tags),
    media: async () => new Map(),
    usage: async () => USAGE,
    setListed: key => void (log.listed = key),
  }
  const io: TagIO = {
    rows: async () => list,
    readTags: async () => okRead(log.tags),
    writeTags: async r => {
      log.tags = r
      log.writes++
    },
    readQueue: async () => okRead(log.queue),
    writeQueue: async q => void (log.queue = q),
    replace: async () => (log.replaces++, { queued: 0, freed: '' }),
    report: (b, replaced) => blockReport(block, b, replaced),
    ...over,
  }
  return { io, log, block }
}


async function tagCall(io: TagIO, tags: unknown[], stale = false, callId = 'tc') {
  const out = await contextTag(io, { tags }, undefined, undefined, stale, callId)
  if ('deny' in out) throw new Error(out.deny)
  return out.result
}

// ---- [SP_CTX_01_18] RowMark functions

test('MarkBefore skips thinking-only rows; MarkIndex and StartOf treat null as the head and a lost mark as the head', async () => {
  const r = [prompt('p'), use('a'), result('a'), think(), use('b')]
  expect(distinctive(think())).toBe(false)
  expect(markBefore(r, 4)).toEqual(mark(r, 2))
  expect(markBefore(r, 0)).toBe(null)
  expect(markIndex(r, null)).toBe(-1)
  expect(startOf(r, null)).toBe(0)
  expect(markIndex(r, { anchor: 'user||gone', hint: 1 })).toBe('lost')
  expect(startOf(r, { anchor: 'user||gone', hint: 1 })).toBe(0)
  expect(startOf(r, mark(r, 2))).toBe(3)
  expect(carrierRow(r, 'b')).toBe(4)
  expect(carrierRow(r, 'zz')).toBe(5)
})

test('parseRegistry reads stage, lastClosed and introduced and refuses a bad one', async () => {
  const good = reg({ stage: { name: 'A', after: null, openedTurn: 1 }, lastClosed: { after: { anchor: 'user||t', hint: 0 }, end: null, turn: 1 }, introduced: true })
  expect(parseRegistry(JSON.stringify(good)).state).toBe('ok')
  for (const bad of [
    { stage: { name: '', after: null, openedTurn: 0 } },
    { stage: { name: 'x'.repeat(81), after: null, openedTurn: 0 } },
    { stage: { name: 'A', openedTurn: 0 } },
    { stage: { name: 'A', after: { anchor: 'assistant||', hint: 0 }, openedTurn: 0 } },
    { lastClosed: { after: null, end: { anchor: 'user||t', hint: -1 }, turn: 0 } },
    { lastClosed: { after: null, turn: 0 } },
    { introduced: 'yes' },
  ]) {
    const out = parseRegistry(JSON.stringify({ ...reg(), ...bad }))
    expect(out.state).toBe('unreadable')
  }
})

// ---- [SP_CTX_02_11] context_tag open / close

test('context_tag — відкриття без index: the call at #8, a result at #7: stage.after = #7; "its block starts at #8"', async () => {
  const list = [prompt('p'), use('a'), result('a'), reply('s'), use('b'), result('b'), use('c'), result('c'), use('op', TAG_TOOL), reply('x')]
  const { io, log } = harness(reg({ turn: 3 }), list)
  const text = await tagCall(io, [{ op: 'open', stage: 'A' }], false, 'op')
  expect(log.tags.stage).toEqual({ name: 'A', after: mark(list, 7), openedTurn: 3 })
  expect(text).toContain('Stage "A" opened; its block starts at #8.')
})

test('context_tag — рядок виклику ще не записано / межа не на thinking', async () => {
  const list = [prompt('p'), use('a'), result('a'), reply('s'), use('b'), result('b'), result('b2'), think(), use('c'), reply('end')]
  const missing = harness(reg(), list)
  await tagCall(missing.io, [{ op: 'open', stage: 'A' }], false, 'not-yet')
  expect(missing.log.tags.stage!.after).toEqual(mark(list, 9))
  const thinking = harness(reg(), list)
  await tagCall(thinking.io, [{ op: 'open', stage: 'A' }], false, 'c')
  expect(thinking.log.tags.stage!.after).toEqual(mark(list, 6))
})

test('context_tag — відкриття з index: index 4 gives after #3, index 0 the head', async () => {
  const four = harness(reg())
  await tagCall(four.io, [{ op: 'open', stage: 'A', index: 4 }])
  expect(four.log.tags.stage!.after).toEqual(mark(rows(), 3))
  const zero = harness(reg())
  await tagCall(zero.io, [{ op: 'open', stage: 'A', index: 0 }])
  expect(zero.log.tags.stage!.after).toBe(null)
})

test('context_tag — закриття: a stage after #3, the close call at #12: block #4..#11 with telemetry and STAGE_ADVICE; replacements once', async () => {
  const r = rows()
  const { io, log } = harness(reg({ turn: 5, stage: { name: 'A', after: mark(r, 3), openedTurn: 2 } }))
  const text = await tagCall(io, [{ op: 'close' }])
  expect(log.tags.stage).toBeUndefined()
  expect(log.tags.lastClosed).toEqual({ name: 'A', after: mark(r, 3), end: mark(r, 11), turn: 5 })
  expect(log.replaces).toBe(1)
  expect(text).toContain('Stage "A" closed: rows #4..#11, ~')
  // [SP_CTX_02_29] no review or disposable in the block; its Read/Grep/Glob pairs are counted
  expect(text).toContain('Candidates in the block: reproducible pairs (~) 3.')
  expect(text).toContain('Context: conversation ~12k tokens; fixed part (system prompt, tools, skills, memory) ~70k; window 200k; auto-compaction in ~78k')
  expect(text).toContain('Last block "A" #4..#11')
  expect(text).toContain(STAGE_ADVICE)
  // the report lists the block's indexes: listedKey renewed
  expect(log.listed).toBe('K')
})

test('context_tag — закриття читає розмову один раз (CF-21): the stale check, the requests, the replacements and the report share one snapshot; the API form is read once', async () => {
  const r = rows()
  const reads = { messages: 0, boundary: 0, api: 0 }
  const view: ViewIO = {
    hostId: async () => 'h:1',
    messages: async () => (reads.messages++, r),
    storage: async () => ({ sessionId: 's', dir: '/s' }),
    readBoundary: async () => (reads.boundary++, undefined),
    own: () => undefined,
  }
  // the ports register.ts binds for a context_tag call: one snapshot (tagCallIO)
  const snap = snapshotOf({ view: () => readView(view), api: async () => (reads.api++, []) })
  const log = { tags: reg({ turn: 5, stage: { name: 'A', after: mark(r, 3), openedTurn: 2 } }), queue: { ...EMPTY_QUEUE } as Queue, listed: undefined as string | undefined, queued: 0 }
  const io = tagCallIO(
    snap,
    {
      readTags: async () => okRead(log.tags),
      writeTags: async t => void (log.tags = t),
      readQueue: async () => okRead(log.queue),
      writeQueue: async q => void (log.queue = q),
    },
    work => (log.queued++, work()),
    () => ({ readTags: async () => okRead(log.tags), usage: async () => USAGE, setListed: key => void (log.listed = key) }),
  )
  const stale = 's|' !== (await snap.key())
  const text = await tagCall(io, [{ op: 'close' }], stale)
  expect(log.queued).toBe(1)
  expect(text).toContain('Stage "A" closed: rows #4..#11')
  expect(log.listed).toBe('s|')
  expect(reads).toEqual({ messages: 1, boundary: 1, api: 1 })
})

test('context_tag — open при відкритому етапі: A closes with its report, B opens at the same mark as the end of A', async () => {
  const r = rows()
  const { io, log } = harness(reg({ stage: { name: 'A', after: mark(r, 3), openedTurn: 0 } }))
  const text = await tagCall(io, [{ op: 'open', stage: 'B' }])
  expect(log.tags.lastClosed!.name).toBe('A')
  expect(log.tags.stage!.name).toBe('B')
  expect(log.tags.stage!.after).toEqual(log.tags.lastClosed!.end)
  expect(text).toContain('Stage "A" closed: rows #4..#11')
  expect(text).toContain('Stage "B" opened; its block starts at #12.')
  expect(log.replaces).toBe(1)
})

test('context_tag — закриття без етапу: NO_STAGE; open with index + close in one call closes the block from index', async () => {
  const none = harness(reg())
  const refused = await tagCall(none.io, [{ op: 'close' }])
  expect(refused).toContain('(NO_STAGE)')
  expect(none.log.writes).toBe(0)
  expect(none.log.replaces).toBe(0)
  const both = harness(reg())
  const text = await tagCall(both.io, [{ op: 'open', stage: 'late', index: 4 }, { op: 'close' }])
  expect(both.log.tags.lastClosed).toEqual({ name: 'late', after: mark(rows(), 3), end: mark(rows(), 11), turn: 0 })
  expect(both.log.tags.stage).toBeUndefined()
  expect(text).toContain('Stage "late" closed: rows #4..#11')
})

test('context_tag — порожній блок: close right after open gives "no rows in it." without STAGE_ADVICE; BlockReport does not renew listedKey', async () => {
  const { io, log } = harness(reg())
  const text = await tagCall(io, [{ op: 'open', stage: 'A' }, { op: 'close' }])
  expect(text).toContain('Stage "A" closed: no rows in it.')
  expect(text).not.toContain(STAGE_ADVICE)
  expect(log.listed).toBeUndefined()
})

test('context_tag — REPORT_FAILED: the stage is closed and written; the result says the report failed', async () => {
  const r = rows()
  const { io, log } = harness(reg({ stage: { name: 'A', after: mark(r, 3), openedTurn: 0 } }), r, {
    report: async () => {
      throw new Error('api down')
    },
  })
  const text = await tagCall(io, [{ op: 'close' }])
  expect(log.tags.lastClosed!.name).toBe('A')
  expect(text).toContain('Stage "A" closed; its report failed: api down; call context_list')
})

test('context_tag — закриття без звіту: io.report absent: the stage closes and the result says only "Stage \"A\" closed."', async () => {
  const r = rows()
  const { io, log } = harness(reg({ stage: { name: 'A', after: mark(r, 3), openedTurn: 0 } }), r, { report: undefined })
  const text = await tagCall(io, [{ op: 'close' }])
  expect(log.tags.lastClosed!.name).toBe('A')
  expect(log.replaces).toBe(1)
  expect(text.split('\n')).toEqual(['Tagged 0, removed 0; 0 tag(s) in the registry.', 'Stage "A" closed.'])
})

test('context_tag — заміни не поставлено: io.replace rejects: the stage closes, the report comes without replacements', async () => {
  const r = rows()
  const got: unknown[] = []
  const { io, log } = harness(reg({ stage: { name: 'A', after: mark(r, 3), openedTurn: 0 } }), r, {
    replace: async () => {
      throw new Error('queue unreadable')
    },
    report: async (b, replaced) => (got.push(replaced), `Stage "${b.name}" closed: report`),
  })
  const text = await tagCall(io, [{ op: 'close' }])
  expect(log.tags.lastClosed!.name).toBe('A')
  expect(got).toEqual([undefined])
  expect(text).toContain('Stage "A" closed: report')
  // two closes in one call: only the last report gets the replacements
  const two = harness(reg({ stage: { name: 'A', after: mark(r, 3), openedTurn: 0 } }), r, {
    report: async (_b, replaced) => (got.push(replaced), 'r'),
  })
  got.length = 0
  await tagCall(two.io, [{ op: 'open', stage: 'B' }, { op: 'close' }])
  expect(two.log.replaces).toBe(1)
  expect(got).toEqual([undefined, { queued: 0, freed: '' }])
})

test('context_tag — stage errors: STAGE_FIELDS, STAGE_NAME_REQUIRED, TARGET_NOT_FOUND, INDEXES_STALE, BAD_OP', async () => {
  const cases: [unknown, string, boolean?][] = [
    [{ op: 'open', stage: 'A', kind: 'pin' }, 'STAGE_FIELDS'],
    [{ op: 'close', stage: 'A' }, 'STAGE_FIELDS'],
    [{ op: 'open' }, 'STAGE_NAME_REQUIRED'],
    [{ op: 'open', stage: '   ' }, 'STAGE_NAME_REQUIRED'],
    [{ op: 'open', stage: 'x'.repeat(81) }, 'STAGE_NAME_REQUIRED'],
    [{ op: 'open', stage: 'A', index: 99 }, 'TARGET_NOT_FOUND'],
    [{ op: 'open', stage: 'A', index: 4 }, 'INDEXES_STALE', true],
    [{ op: 'start', stage: 'A' }, 'BAD_OP'],
  ]
  for (const [request, code, stale] of cases) {
    const { io, log } = harness(reg())
    const text = await tagCall(io, [request], stale)
    expect(text).toContain(`(${code})`)
    expect(log.tags.stage).toBeUndefined()
  }
})

test('context_tag — DENIED_REGISTRY_WRITE: no stage opened or closed, no replacement queued', async () => {
  const r = rows()
  const { io, log } = harness(reg({ stage: { name: 'A', after: mark(r, 3), openedTurn: 0 } }), r, {
    writeTags: async () => {
      throw new Error('disk full')
    },
  })
  const out = await contextTag(io, { tags: [{ op: 'close' }] }, undefined, undefined, false, 'tc')
  expect('code' in out && out.code).toBe('DENIED_REGISTRY_WRITE')
  expect(log.replaces).toBe(0)
})

test('context_tag — загублена межа: stage.after becomes null; a lost lastClosed.end stays as it was', async () => {
  const gone: RowMark = { anchor: 'user||gone', hint: 3 }
  const { io, log } = harness(reg({ stage: { name: 'A', after: gone, openedTurn: 0 }, lastClosed: { name: 'Z', after: gone, end: gone, turn: 0 } }))
  await tagCall(io, [{ op: 'add', kind: 'pin', tool_use_id: 'a' }])
  expect(log.tags.stage!.after).toBe(null)
  expect(log.tags.lastClosed!.after).toBe(null)
  expect(log.tags.lastClosed!.end).toEqual(gone)
})

test('no more than one open stage after any request (05_02)', async () => {
  const { io, log } = harness(reg())
  await tagCall(io, [{ op: 'open', stage: 'A' }, { op: 'open', stage: 'B' }, { op: 'open', stage: 'C', index: 2 }])
  expect(log.tags.stage!.name).toBe('C')
  expect(log.tags.lastClosed!.name).toBe('B')
})

// ---- [SP_CTX_02_29] BlockReport

function blockIO(list: SessionMessage[], tags: TagRegistry, listed: { key?: string } = {}): BlockIO {
  return {
    key: async () => 'K',
    rows: async () => list,
    readTags: async () => okRead(tags),
    media: async () => new Map([['u:c', [{ mediaType: 'image/png', bytes: 2048 }]]]),
    usage: async () => USAGE,
    setListed: key => void (listed.key = key),
  }
}

test('BlockReport — межа індексів: 25 active reviews with reason big in the block name 20 indexes, then "+5 more"; media of the block counted', async () => {
  const list = [prompt('p'), ...Array.from({ length: 25 }, (_, i) => [use(`r${i}`), result(`r${i}`)]).flat(), use('c'), result('c')]
  const reviews: Tag[] = Array.from({ length: 25 }, (_, i) => ({ kind: 'review', reason: 'big', target: { tool_use_id: `r${i}` }, created_turn: 0 }))
  const tags = reg({ tags: [...reviews, { kind: 'disposable', target: { tool_use_id: 'c' }, note: 'n', created_turn: 0 }] })
  const block: ClosedBlock = { name: 'A', after: mark(list, 0), end: mark(list, list.length - 1), turn: 0 }
  const text = await blockReport(blockIO(list, tags), block, { queued: 1, freed: '~3 tokens' })
  const line = text.split('\n').find(l => l.startsWith('Candidates in the block'))!
  expect(line.match(/#\d+/g)!.length).toBe(MAX_BLOCK_INDEXES + 1)
  expect(line).toContain('Candidates in the block: big #1, #3, ')
  expect(line).toContain('+5 more')
  expect(line).toContain('disposable #51')
  expect(text).toContain('1 media (~2KB)')
  expect(text).toContain('Replacements from your disposable tags queued: 1 (~3 tokens freed when this turn ends).')
})

test('BlockReport — без рядків: a lost end says its end row is gone, not "no rows in it."; listedKey stays', async () => {
  const listed: { key?: string } = {}
  const text = await blockReport(blockIO(rows(), reg(), listed), { name: 'A', after: mark(rows(), 3), end: { anchor: 'user||gone', hint: 9 }, turn: 0 })
  expect(text).toContain('Stage "A" closed: its end row is gone; call context_list.')
  expect(text).not.toContain('no rows in it')
  expect(text).not.toContain(STAGE_ADVICE)
  expect(listed.key).toBeUndefined()
})

// ---- [SP_CTX_02_28] Telemetry

test('Telemetry — рядок Messages / без рядка Messages / ще невідомо / збій / автокомпактизація вимкнена', async () => {
  const r = rows()
  const text = async (u: () => Promise<UsageInfo>) => telemetryText(await telemetry(r, reg(), u))
  expect(await text(async () => USAGE)).toContain('Context: conversation ~12k tokens; fixed part (system prompt, tools, skills, memory) ~70k; window 200k; auto-compaction in ~78k')
  const noRow: UsageInfo = { context: { ...USAGE.context, breakdown: { ...USAGE.context.breakdown!, categories: [{ name: 'Other', tokens: 5, kind: 'used' }] } } }
  expect(await text(async () => noRow)).toContain('Context: last request ~90k tokens, the fixed part (system prompt, tools, skills, memory) included; window 200k; auto-compaction in ~78k')
  expect(await text(async () => ({ context: { tokens: 900, window: 200_000 } }))).toContain('Context: last request ~900 tokens, the fixed part (system prompt, tools, skills, memory) included; window 200k')
  expect(await text(async () => ({ context: { window: 200_000 } }))).toContain('Context: size unknown yet (no model response since the session start or the last compaction); window 200k')
  const failed = await text(async () => {
    throw new Error('no usage')
  })
  expect(failed).toContain('Context: size unavailable (no usage)')
  expect(failed).toContain('No open stage')
  const off: UsageInfo = { context: { ...USAGE.context, breakdown: { ...USAGE.context.breakdown!, autoCompactThreshold: undefined } } }
  expect(await text(async () => off)).toContain('; auto-compaction off')
})

test('Telemetry — stage, blocks and candidates', async () => {
  const r = rows()
  const gone: RowMark = { anchor: 'user||gone', hint: 3 }
  const stage = { name: 'S', after: mark(r, 9), openedTurn: 1 }
  const tags: Tag[] = [
    { kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', target: { tool_use_id: 'b' }, ttl_turns: 9, created_turn: 0 },
    { kind: 'review', target: { tool_use_id: 'c' }, created_turn: 0 },
    { kind: 'disposable', target: { tool_use_id: 'gone' }, note: 'n', created_turn: 0 },
  ]
  const t = async (extra: Partial<TagRegistry>) => telemetryText(await telemetry(r, reg({ turn: 4, tags, ...extra }), async () => USAGE))
  const open = await t({ stage })
  expect(open).toContain('Stage "S" open from #10 (opened 3 turn(s) ago), ~')
  // tags without a reason were written before phase 15: the group "no reason"
  expect(open).toContain('Candidates: review 2 (no reason 2: #1, #7); disposable 0')
  expect(await t({ stage: { ...stage, after: gone } })).toContain('Stage "S" open from #0 (opened 3 turn(s) ago), ~')
  expect(await t({ stage: { ...stage, after: gone } })).toContain('; its start row is gone, so it runs from #0')
  expect(await t({ lastClosed: { name: 'A', after: mark(r, 3), end: mark(r, 9), turn: 0 } })).toContain('Last block "A" #4..#9 (~')
  expect(await t({ lastClosed: { after: mark(r, 3), end: null, turn: 0 } })).toContain('Last block (no stage): it is empty')
  expect(await t({ lastClosed: { name: 'A', after: mark(r, 9), end: mark(r, 3), turn: 0 } })).toContain('Last block "A": it is empty')
  const lostEnd = await t({ lastClosed: { name: 'A', after: mark(r, 3), end: gone, turn: 0 } })
  expect(lostEnd).toContain('Last block "A" from #4: its end row is gone')
  expect(lostEnd).not.toContain('it is empty')
  expect(await t({ lastClosed: { name: 'A', after: gone, end: mark(r, 9), turn: 0 } })).toContain('Last block "A" #0..#9 (~1272 tokens (approx.)); its start row is gone, so it runs from #0')
})

// ---- [SP_CTX_02_01] the listing's marks

test('context_list — останній закритий блок, позначки етапу: [stage ▶], [block ▶ A] .. [block end]; unnamed; lost end; lost start', async () => {
  const r = rows()
  const list = (extra: Partial<TagRegistry>) => listRows(r, 0, 20, new Map(), markLabels(r, reg(extra)))
  const line = (text: string, i: number) => text.split('\n').find(l => l.startsWith(`#${i} `) || l.startsWith(`#${i}!`))!
  const named = list({ lastClosed: { name: 'A', after: mark(r, 3), end: mark(r, 9), turn: 0 }, stage: { name: 'S', after: mark(r, 9), openedTurn: 0 } })
  expect(line(named, 4)).toContain('[block ▶ A]')
  expect(line(named, 9)).toContain('[block end]')
  expect(line(named, 10)).toContain('[stage ▶ S]')
  const unnamed = list({ lastClosed: { after: mark(r, 3), end: mark(r, 9), turn: 0 } })
  expect(line(unnamed, 4)).toContain('[block ▶]')
  const gone: RowMark = { anchor: 'user||gone', hint: 9 }
  const lostEnd = list({ lastClosed: { name: 'A', after: mark(r, 3), end: gone, turn: 0 } })
  expect(line(lostEnd, 4)).toContain('[block ▶ A]')
  const rowLines = (text: string) => text.split('\n').filter(l => l.startsWith('#')).join('\n')
  expect(rowLines(lostEnd)).not.toContain('[block end]')
  const lostStart = list({ lastClosed: { name: 'A', after: gone, end: mark(r, 9), turn: 0 }, stage: { name: 'S', after: gone, openedTurn: 0 } })
  expect(line(lostStart, 0)).toContain('[stage ▶ S]')
  expect(line(lostStart, 0)).toContain('[block ▶ A]')
  expect(line(lostStart, 9)).toContain('[block end]')
  const empty = list({ lastClosed: { name: 'A', after: mark(r, 3), end: null, turn: 0 } })
  expect(rowLines(empty)).not.toContain('[block')
  // marks come before the tags of the row
  const both = markLabels(r, reg({ stage: { name: 'S', after: mark(r, 0), openedTurn: 0 } }))
  for (const [i, l] of tagLabels(r, reg({ tags: [{ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 }] }))) both.set(i, [...(both.get(i) ?? []), ...l])
  expect(line(listRows(r, 0, 5, new Map(), both), 1)).toContain('[stage ▶ S] [pin]')
})

test('context_list — лише телеметрія / порожня розмова: count 0 gives the header and the telemetry, no rows, no next page', async () => {
  const r = rows()
  const text = listRows(r, 0, 0, new Map(), new Map(), new Map(), 'Context: X')
  expect(text.split('\n')).toEqual([expect.stringContaining('13 rows'), 'Context: X'])
  expect(text).not.toContain('Next page')
  expect(listRows([], 0, 5, new Map(), new Map(), new Map(), 'Context: X')).toBe('0 rows.\nContext: X')
  expect(listRows(r, 0, 4, new Map(), new Map(), new Map(), 'Context: X').split('\n')[1]).toBe('Context: X')
})

// ---- [SP_CTX_02_29] OptimizeText and PersonAdvice

test('OptimizeText — без індексів: the block name, ListHint, STAGE_ADVICE, the advice to stop; the batch sentence only when compacted', async () => {
  const a: ClosedBlock = { name: 'A', after: null, end: { anchor: 'user|r:a|', hint: 7 }, turn: 2 }
  const plain = optimizeText(a, false)
  expect(plain).toContain('optimization turn for stage "A"')
  expect(plain).toContain(LIST_HINT)
  expect(plain).toContain('Last block #<a>..#<b>')
  expect(plain).toContain('from=<a>')
  expect(plain).toContain(STAGE_ADVICE)
  // [SP_CTX_DEC_16] phase 18: the session stops unless the agent asks to go on
  expect(plain).toContain('the session stops after this batch: pass "resume": true (or a resume_prompt) in context_edit only if the task should go on')
  expect(plain).not.toContain('"resume": false')
  expect(plain).not.toContain('The batch queued in that turn')
  expect(/#\d/.test(plain)).toBe(false)
  const done = optimizeText({ ...a, name: undefined }, true)
  expect(done).toContain('optimization turn for the last block (no stage)')
  expect(done).toContain('The batch queued in that turn, with the replacements from your disposable tags, was processed (see the report above)')
  expect(done).not.toContain('applied')
  expect(personAdvice(a)).toContain('you asked to optimize stage "A" after your previous answer')
  expect(personAdvice(a)).toContain(LIST_HINT)
})

// ---- [SP_CTX_02_27] SessionIntro

test('SessionIntro — INTRO_TEXT: at most 1000 chars; holds the mark, open, close, count 0 and the skill', async () => {
  expect(INTRO_TEXT.length <= 1000).toBe(true)
  expect(INTRO_TEXT.length).toBe(968)
  // [SP_CTX_02_37] the suggestion line in a few words: it only informs (phase 23)
  expect(INTRO_TEXT).toContain('A [context-editor: suggestion] line may propose compressing earlier outputs, with gain, cache cost and a verdict; it only informs: decide by the logical state of the work.')
  expect(INTRO_TEXT.includes('Nothing reminds you by size')).toBe(false)
  // [SP_CTX_01_12] P13: the sentence about the agent's own calls (keep_cache, which keeps some, is told by its field)
  expect(INTRO_TEXT).toContain('When edits apply, your own context_* calls are removed from the conversation; tags and notes stay (see context_list).')
  expect(INTRO_TEXT).toContain(OPTIMIZE_MARK)
  expect(INTRO_TEXT).toContain('"op":"open"')
  expect(INTRO_TEXT).toContain('"op":"close"')
  expect(INTRO_TEXT).toContain('"count":0')
  expect(INTRO_TEXT).toContain(`context-editor:${SKILL}`)
})

// ---- [SP_CTX_02_30] DetectOptimize

const HANDOFF: HandoffRequest = { mode: 'transcript', resume: true, resumePrompt: 'go', by: 'agent', state: 'queued', at: 0 }

function longRows(): SessionMessage[] {
  return [prompt('p'), ...Array.from({ length: 10 }, (_, i) => [use(`p${i}`), result(`p${i}`)]).flat()]
}

function detectHarness(tags: Read<TagRegistry>, queue: Read<Queue> = okRead({ ...EMPTY_QUEUE }), over: Partial<DetectIO> = {}) {
  const log = { tags, queue, statuses: [] as string[], replaces: 0, order: [] as string[] }
  const list = longRows()
  const io: DetectIO = {
    ready: async () => true,
    readQueue: async () => log.queue,
    changeQueue: async change => {
      const next = await change(log.queue)
      if (!next) return false
      log.queue = okRead(next)
      log.order.push(next.optimize ? 'optimize' : 'queue')
      return true
    },
    changeTags: async change => {
      const next = await change(log.tags)
      if (!next) return false
      log.tags = okRead(next)
      log.order.push('tags')
      return true
    },
    rows: async () => list,
    replace: async () => {
      log.replaces++
      log.order.push('replace')
    },
    status: text => void log.statuses.push(text),
    ...over,
  }
  return { io, log, list }
}

const answer = `Done.\n\n${OPTIMIZE_MARK}`
const regOf = (h: { log: { tags: Read<TagRegistry> } }) => (h.log.tags.state === 'unreadable' ? undefined : h.log.tags.value)
const queueOf = (h: { log: { queue: Read<Queue> } }) => (h.log.queue.state === 'unreadable' ? undefined : h.log.queue.value)

test('DetectOptimize — мітка з відкритим етапом: the stage closes at the end of the turn (#20); optimize written; replacements queued before it', async () => {
  const h = detectHarness(okRead(reg({ turn: 6, stage: { name: 'S', after: null, openedTurn: 2 } })))
  expect(await detectOptimize(h.io, { aborted: false, answer })).toBe('requested')
  expect(regOf(h)!.lastClosed).toEqual({ name: 'S', after: null, end: mark(h.list, 20), turn: 6 })
  expect(regOf(h)!.stage).toBeUndefined()
  expect(queueOf(h)!.optimize).toBe(true)
  expect(h.log.order).toEqual(['tags', 'replace', 'optimize'])
})

test('DetectOptimize — без етапу / перший блок: an unnamed block from the previous end (#8) or from the head', async () => {
  const list = longRows()
  const after8 = detectHarness(okRead(reg({ turn: 3, lastClosed: { name: 'A', after: null, end: mark(list, 8), turn: 1 } })))
  await detectOptimize(after8.io, { aborted: false, answer })
  expect(regOf(after8)!.lastClosed).toEqual({ after: mark(list, 8), end: mark(list, 20), turn: 3 })
  const first = detectHarness(missingRead(reg()))
  await detectOptimize(first.io, { aborted: false, answer })
  expect(regOf(first)!.lastClosed).toEqual({ after: null, end: mark(list, 20), turn: 0 })
})

test('DetectOptimize — закрито інструментом у цьому ході: lastClosed and the new stage stay; optimize written', async () => {
  const list = longRows()
  const start = reg({ turn: 4, lastClosed: { name: 'A', after: null, end: mark(list, 8), turn: 4 }, stage: { name: 'B', after: mark(list, 8), openedTurn: 4 } })
  const h = detectHarness(okRead(start))
  await detectOptimize(h.io, { aborted: false, answer })
  expect(regOf(h)!.lastClosed).toEqual(start.lastClosed)
  expect(regOf(h)!.stage).toEqual(start.stage)
  expect(queueOf(h)!.optimize).toBe(true)
})

test('DetectOptimize — the mark only as the last line, verbatim', async () => {
  expect(hasOptimizeMark('text\n\n  [context-editor: optimize]  \n\n')).toBe(true)
  for (const no of [
    'x\n[context-editor:optimize]',
    'x\n[Context-Editor: optimize]',
    'put [context-editor: optimize] on the last line\nmore',
    'x\nsee [context-editor: optimize]',
    '',
  ])
    expect(hasOptimizeMark(no)).toBe(false)
  const h = detectHarness(okRead(reg()))
  expect(await detectOptimize(h.io, { aborted: false, answer: 'put [context-editor: optimize] on the last line\nok' })).toBe('none')
  expect(h.log.order).toEqual([])
})

test('DetectOptimize — ігнорується: handoff / unreadable queue / aborted / no storage; status lines', async () => {
  const handoff = detectHarness(okRead(reg()), okRead({ ...EMPTY_QUEUE, handoff: HANDOFF }))
  expect(await detectOptimize(handoff.io, { aborted: false, answer })).toBe('handoff')
  expect(handoff.log.statuses).toEqual(['context-editor: optimization mark ignored: a handoff is pending'])
  expect(handoff.log.order).toEqual([])
  const unread = detectHarness(okRead(reg()), unreadableRead('x'))
  expect(await detectOptimize(unread.io, { aborted: false, answer })).toBe('queue-unreadable')
  expect(unread.log.statuses).toEqual(['context-editor: optimization mark ignored: the queue is unreadable'])
  const aborted = detectHarness(okRead(reg()))
  expect(await detectOptimize(aborted.io, { aborted: true, answer })).toBe('none')
  expect(aborted.log.order).toEqual([])
  const down = detectHarness(okRead(reg()), undefined, { ready: async () => false })
  expect(await detectOptimize(down.io, { aborted: false, answer })).toBe('no-storage')
  expect(down.log.statuses).toEqual(['context-editor: optimization mark ignored: storage unavailable'])
})

test('DetectOptimize — MARK_REGISTRY_UNREADABLE: unreadable or unwritable registry: no block, no optimize', async () => {
  const unread = detectHarness(unreadableRead('x'))
  expect(await detectOptimize(unread.io, { aborted: false, answer })).toBe('registry-unreadable')
  expect(queueOf(unread)!.optimize).toBe(false)
  expect(unread.log.statuses[0]).toContain('the tag registry is unreadable')
  const unwritten = detectHarness(okRead(reg()), undefined, {
    changeTags: async () => {
      throw new Error('disk full')
    },
  })
  expect(await detectOptimize(unwritten.io, { aborted: false, answer })).toBe('registry-unreadable')
  expect(unwritten.log.statuses).toEqual(['context-editor: optimization mark ignored: disk full'])
  expect(unwritten.log.replaces).toBe(0)
})

test('DetectOptimize — MARK_NOT_QUEUED / MARK_NO_REPLACEMENTS', async () => {
  const failing = detectHarness(okRead(reg({ stage: { name: 'S', after: null, openedTurn: 0 } })))
  failing.io.changeQueue = async change => {
    if ((await change(failing.log.queue))?.optimize) throw new Error('disk full')
    return false
  }
  expect(await detectOptimize(failing.io, { aborted: false, answer })).toBe('not-queued')
  expect(regOf(failing)!.lastClosed!.name).toBe('S')
  expect(queueOf(failing)!.optimize).toBe(false)
  expect(failing.log.statuses).toEqual(['context-editor: optimization mark: the block is closed, but no optimization turn: disk full'])
  // a handoff found on the re-read
  const late = detectHarness(okRead(reg()))
  late.io.replace = async () => void (late.log.queue = okRead({ ...EMPTY_QUEUE, handoff: HANDOFF }))
  expect(await detectOptimize(late.io, { aborted: false, answer })).toBe('not-queued')
  expect(late.log.statuses[0]).toContain('a handoff is pending')
  const throwing = detectHarness(okRead(reg()), undefined, {
    replace: async () => {
      throw new Error('boom')
    },
  })
  expect(await detectOptimize(throwing.io, { aborted: false, answer })).toBe('requested')
  expect(queueOf(throwing)!.optimize).toBe(true)
  expect(regOf(throwing)!.lastClosed).toBeDefined()
})

test('DetectOptimize — запобіжник петлі: after the optimization prompt the mark is ignored; the flag goes down in all three cases', async () => {
  // the mark itself: in-optimization; no mark, or an aborted turn: none
  for (const [ans, aborted, expected] of [
    [answer, false, 'in-optimization'],
    ['no mark', false, 'none'],
    [answer, true, 'none'],
  ] as [string, boolean, string][]) {
    const h = detectHarness(okRead(reg({ stage: { name: 'S', after: null, openedTurn: 0 } })), okRead({ ...EMPTY_QUEUE, optimizePrompted: true }))
    const out = await detectOptimize(h.io, { aborted, answer: ans })
    expect(out).toBe(expected)
    expect(h.log.statuses).toEqual([])
    expect(queueOf(h)!.optimizePrompted).toBe(false)
    expect(queueOf(h)!.optimize).toBe(false)
    expect(regOf(h)!.stage!.name).toBe('S')
    expect(regOf(h)!.lastClosed).toBeUndefined()
  }
})

test('markClose: a lost stage start becomes null; a lost lastClosed.end stays as the next block start', async () => {
  const list = longRows()
  const gone: RowMark = { anchor: 'user||gone', hint: 2 }
  const out = markClose(reg({ turn: 1, lastClosed: { after: gone, end: gone, turn: 0 } }), list)
  expect(out.lastClosed).toEqual({ after: gone, end: mark(list, 20), turn: 1 })
  const staged = markClose(reg({ turn: 1, stage: { name: 'S', after: gone, openedTurn: 0 } }), list)
  expect(staged.lastClosed).toEqual({ name: 'S', after: null, end: mark(list, 20), turn: 1 })
})

// ---- [SP_CTX_02_14] RelocateMark (RebindTags of the stage marks)

// An apply as HandleCompaction runs it: ApplyEdits, DropOwnCalls, Produced.
function apply(before: SessionMessage[], raw: unknown[]) {
  const edits = prepare(before, raw).queued
  const applied = applyEdits(before, edits, '/s/1.json')
  const after = dropOwnCalls(applied.rows)
  const produced = producedRows(after, applied.made)
  const names = new Set(applied.report.applied)
  const done = edits.filter(e => names.has(describeEdit(e)))
  return { after, produced, done, edits }
}
const relocate = (before: SessionMessage[], r: TagRegistry, x: ReturnType<typeof apply>, carried: string[] = []) =>
  relocateStageMarks(rebindTags(r, before, x.after, x.done, x.edits), before, x.after, x.done, x.produced, carried)

test('RelocateMark — межу вже загублено: a mark not found in the rows before the apply, or the head (null), stays null after it', async () => {
  const before = [prompt('p'), use('a'), result('a', 'x'.repeat(100)), reply('s'), reply('t')]
  const x = apply(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }])
  expect(relocateMark({ anchor: 'assistant||gone', hint: 3 }, before, x.after, x.done, x.produced, new Set([1, 2]))).toBe(null)
  expect(relocateMark(null, before, x.after, x.done, x.produced, new Set([1, 2]))).toBe(null)
  // the same lost mark through relocateStageMarks: stage.after becomes the head
  const out = relocate(before, reg({ stage: { name: 'S', after: { anchor: 'assistant||gone', hint: 3 }, openedTurn: 0 } }), x)
  expect(out.stage!.after).toBe(null)
})

test('RebindTags — межа після перегляду: after the context_list result (#7); DropOwnCalls drops #6, #7: the mark goes to #5 with its new index', async () => {
  const before = [prompt('p'), use('a'), result('a', 'x'.repeat(100)), reply('s'), reply('t'), reply('text'), use('l', 'mcp__context-editor__context_list'), result('l'), reply('next')]
  const x = apply(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }])
  const out = relocate(before, reg({ stage: { name: 'S', after: mark(before, 7), openedTurn: 0 } }), x)
  expect(out.stage!.after).toEqual({ anchor: fingerprint(before[5]!), hint: 5 })
  expect(out.stage!.after).toEqual(mark(x.after, 5))
})

test('RebindTags — межа на переписаному рядку / на згорнутому діапазоні: the mark goes to the made row (report.produced)', async () => {
  const before = rows()
  const rw = apply(before, [{ op: 'rewrite', index: 9, text: 'found it' }])
  const out = relocate(before, reg({ lastClosed: { name: 'A', after: mark(before, 3), end: mark(before, 9), turn: 0 } }), rw)
  expect(out.lastClosed!.end).toEqual(mark(rw.after, 9))
  expect(rw.after[9]!.text).toContain('you rewrote this row')
  const co = apply(before, [{ op: 'collapse', from_index: 4, to_index: 7 + 1, summary: 'S' }])
  const moved = relocate(before, reg({ stage: { name: 'S', after: mark(before, 6), openedTurn: 0 } }), co)
  // the carrier's result row
  expect(moved.stage!.after).toEqual(mark(co.after, 5))
  expect(co.after[5]!.toolResults![0]!.text).toContain('rows, then collapsed them into your note')
})

test('RebindTags — закриття, стискання і новий етап: the result row of the last pair of A (#11), summarized: both marks on the FreshId result row', async () => {
  const before = rows()
  const x = apply(before, [{ op: 'summarize', tool_use_id: 'd', summary: 'D' }])
  const out = relocate(before, reg({ lastClosed: { name: 'A', after: mark(before, 3), end: mark(before, 11), turn: 0 }, stage: { name: 'B', after: mark(before, 11), openedTurn: 0 } }), x)
  expect(out.lastClosed!.end).toEqual(mark(x.after, 11))
  expect(out.stage!.after).toEqual(mark(x.after, 11))
  expect(x.after[11]!.toolResults![0]!.tool_use_id).toContain('d_ce')
})

test('RebindTags — найпізніший створений рядок / спільний рядок результатів: the mark on the made row with the largest index', async () => {
  const par: SessionMessage = { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }, { tool_use_id: 'b', tool: 'Read', input: {} }] }
  const before = [prompt('p'), par, result('a'), reply('mid'), result('b'), reply('end')]
  const x = apply(before, [
    { op: 'summarize', tool_use_id: 'a', summary: 'A' },
    { op: 'summarize', tool_use_id: 'b', summary: 'B' },
  ])
  expect(x.produced.map(p => p.index).sort()).toEqual([2, 4])
  const out = relocate(before, reg({ lastClosed: { after: null, end: mark(before, 1), turn: 0 } }), x)
  expect(out.lastClosed!.end).toEqual(mark(x.after, 4))
  const shared: SessionMessage = { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'A0', isError: false }, { tool_use_id: 'b', text: 'B0', isError: false }] }
  const before2 = [prompt('p'), par, shared, reply('end')]
  const y = apply(before2, [
    { op: 'summarize', tool_use_id: 'a', summary: 'A' },
    { op: 'summarize', tool_use_id: 'b', summary: 'B' },
  ])
  expect(y.produced.length).toBe(2)
  const out2 = relocate(before2, reg({ lastClosed: { after: null, end: mark(before2, 2), turn: 0 } }), y)
  expect(out2.lastClosed!.end).toEqual(mark(y.after, 2))
})

test('RebindTags — межа на прибраній парі / без попередників / на перезібраному рядку', async () => {
  const before = rows()
  const x = apply(before, [{ op: 'drop', tool_use_id: 'c' }])
  const out = relocate(before, reg({ stage: { name: 'S', after: mark(before, 8), openedTurn: 0 } }), x)
  expect(out.stage!.after).toEqual(mark(x.after, 6))
  const first = [use('x'), result('x'), reply('a'), reply('b')]
  const y = apply(first, [{ op: 'drop', tool_use_id: 'x' }])
  expect(relocate(first, reg({ stage: { name: 'S', after: mark(first, 1), openedTurn: 0 } }), y).stage!.after).toBe(null)
  // a row rebuilt with the same content keeps the mark, with its new index
  const withHandle = [prompt('p'), { ...reply('kept'), handle: 'h' }, use('a'), result('a', 'x'.repeat(100))]
  const z = apply(withHandle, [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }])
  expect(z.after[1]!.handle).toBeUndefined()
  expect(relocate(withHandle, reg({ stage: { name: 'S', after: mark(withHandle, 1), openedTurn: 0 } }), z).stage!.after).toEqual(mark(z.after, 1))
})

test('RebindTags — засів з CarryNote: a mark on a result row the seed extended moves to the nearest earlier unchanged row', async () => {
  const before = rows()
  const seeded = before.map(r => (r.toolResults?.[0]?.tool_use_id === 'c' ? { ...r, toolResults: [{ tool_use_id: 'c', text: 'out c\n\n[context-editor] media carried as files', isError: false }] } : r))
  const x = { after: seeded, produced: [], done: [] as QueuedEdit[], edits: [] as QueuedEdit[] }
  const out = relocate(before, reg({ stage: { name: 'S', after: mark(before, 8), openedTurn: 0 } }), x, ['c'])
  expect(out.stage!.after).toEqual(mark(seeded, 7))
})

test('Межі етапів — розрізняльні рядки (05_02): every mark after an apply is null or names a distinctive row', async () => {
  const before = [prompt('p'), use('a'), result('a'), think(), use('b'), result('b'), reply('x')]
  const x = apply(before, [{ op: 'summarize', tool_use_id: 'b', summary: 'B' }])
  const out = relocate(before, reg({ stage: { name: 'S', after: mark(before, 5), openedTurn: 0 }, lastClosed: { after: mark(before, 2), end: mark(before, 5), turn: 0 } }), x)
  for (const m of [out.stage!.after, out.lastClosed!.after, out.lastClosed!.end]) {
    expect(m === null || !/^[a-z]+\|\|$/.test(m.anchor)).toBe(true)
  }
})

// [SP_CTX_02_28] live verify of phase 14, D2
test('Telemetry — щойно після компактизації: tokens still the request before it, but no API usage in the live window: size unknown yet, not a stale Messages row', async () => {
  const stale: UsageInfo = { context: { ...USAGE.context, breakdown: { ...USAGE.context.breakdown!, apiUsage: null, categories: [{ name: MESSAGES_ROW, tokens: 15, kind: 'used' }] } } }
  const text = telemetryText(await telemetry(rows(), reg(), async () => stale))
  expect(text).toContain('Context: size unknown yet (no model response since the session start or the last compaction); window 200k')
  expect(text).not.toContain('~15')
  const live: UsageInfo = { context: { ...USAGE.context, breakdown: { ...USAGE.context.breakdown!, apiUsage: { input_tokens: 1 } } } }
  expect(telemetryText(await telemetry(rows(), reg(), async () => live))).toContain('Context: conversation ~12k tokens')
})

// [SP_CTX_02_28] live re-verify of phase 14, D2: after the host's /compact the
// breakdown overestimates the fixed part and clamps the Messages row
test('Telemetry — розбивка більша за запит: the whole request, not a clamped Messages row', async () => {
  const clamped: UsageInfo = { context: { ...USAGE.context, tokens: 36_979, breakdown: { ...USAGE.context.breakdown!, totalTokens: 43_062, categories: [{ name: MESSAGES_ROW, tokens: 15, kind: 'used' }] } } }
  const text = telemetryText(await telemetry(rows(), reg(), async () => clamped))
  expect(text).toContain('Context: last request ~37k tokens, the fixed part (system prompt, tools, skills, memory) included')
  expect(text).not.toContain('conversation ~')
})

// [SP_CTX_02_28] review round 36, W2: rows estimated after the last response
// push the total above the request; the fixed part still fits, so it stays
test('Telemetry — сума трохи більша за запит: the Messages row stays the measure while the fixed part fits in the request', async () => {
  const ahead: UsageInfo = { context: { ...USAGE.context, tokens: 57_471, breakdown: { ...USAGE.context.breakdown!, totalTokens: 60_000, categories: [{ name: MESSAGES_ROW, tokens: 17_000, kind: 'used' }] } } }
  expect(telemetryText(await telemetry(rows(), reg(), async () => ahead))).toContain('Context: conversation ~17k tokens')
})

// [SP_CTX_01_12] phase 15: the listing flags reproducible pairs with `~`, and the advice names it
test('STAGE_ADVICE names the reproducible pairs by the `~` flag', async () => {
  expect(STAGE_ADVICE).toContain('Reproducible pairs (~: Read, Grep, Glob) can shrink to a pointer')
})

// ---- [SP_CTX_02_34] Calibrate and Estimate (phase 17)

const big = (chars: number): SessionMessage[] => [prompt('p'), reply('x'.repeat(chars - 1))]
const messagesUsage = (conversation: number): UsageInfo => ({
  context: { tokens: conversation + 40_000, window: 1_000_000, breakdown: { categories: [{ name: MESSAGES_ROW, tokens: conversation, kind: 'used' }], totalTokens: conversation + 40_000, rawMaxTokens: 1_000_000, autoCompactThreshold: 900_000 } },
})

test('Calibrate — калібрування: messages 268 000, 482 400 chars: ratio 1.8, written', async () => {
  const saved: number[] = []
  const r = await calibrate(big(482_400), { measure: 'messages', conversation: 268_000 }, {}, async v => void saved.push(v))
  expect(r).toBe(1.8)
  expect(saved).toEqual([1.8])
  // through the telemetry
  const t = await telemetry(big(482_400), reg(), async () => messagesUsage(268_000), async change => void saved.push(change(reg()).charsPerToken!))
  expect(t.ratio).toBe(1.8)
  expect(saved.length).toBe(2)
})

test('Calibrate — без калібрування: request / too small / within 5 % of the stored one: the stored ratio; nothing written', async () => {
  const saved: number[] = []
  const save = async (v: number) => void saved.push(v)
  expect(await calibrate(big(482_400), { measure: 'request' }, { charsPerToken: 2.5 }, save)).toBe(2.5)
  expect(await calibrate(big(3000), { measure: 'messages', conversation: CALIB_TOKENS - 1 }, { charsPerToken: 2.5 }, save)).toBe(2.5)
  expect(await calibrate(big(482_400), { measure: 'messages', conversation: 268_000 }, { charsPerToken: 1.75 }, save)).toBe(1.8)
  expect(saved).toEqual([])
  expect(await calibrate(big(100), { measure: 'unknown' }, {}, save)).toBeUndefined()
})

test('Calibrate — межі: 0.5 and 12 chars per token are held to 1.0 and 8.0', async () => {
  expect(await calibrate(big(20_000), { measure: 'messages', conversation: 40_000 }, {})).toBe(CALIB_MIN)
  expect(await calibrate(big(480_000), { measure: 'messages', conversation: 40_000 }, {})).toBe(CALIB_MAX)
})

test('Estimate — форми: 9000 chars, ratio 1.8 / none', async () => {
  expect(estimate(9000, 1.8)).toBe('~5000 tokens')
  expect(estimate(9000)).toBe('~2250 tokens (approx.)')
})

test('context_list — один розмір: the header names the telemetry\'s tokens only; without telemetry an Estimate', async () => {
  const r = big(482_400)
  const t = await telemetry(r, reg(), async () => messagesUsage(268_000))
  const head = listRows(r, 0, 5, new Map(), new Map(), new Map(), telemetryText(t), [], headerSize(t, 482_400)).split('\n')[0]!
  expect(head).toContain('2 rows, ~268k tokens, 0 media')
  expect(head).not.toContain('chars (~')
  expect(headerSize({ measure: 'unknown' }, 9000)).toBe('~2250 tokens (approx.)')
  expect(headerSize({ measure: 'unknown', ratio: 1.8 }, 9000)).toBe('~5000 tokens (calibrated estimate)')
})

test('Telemetry — кандидати з рядками: active reviews by reason, each with the first row of its target', async () => {
  const r = rows()
  const tags: Tag[] = [
    { kind: 'review', reason: 'big', target: { tool_use_id: 'c' }, created_turn: 0 },
    { kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', reason: 'big', target: mark(r, 9), created_turn: 0 },
  ]
  expect(telemetryText(await telemetry(r, reg({ tags }), async () => USAGE))).toContain('Candidates: review 3 (big 2: #7, #9; stale 1: #1); disposable 0')
})

test('Калібрування без телеметрії (05_04): estimates chars/4 marked approx.; a stored ratio stays in use', async () => {
  const r = rows()
  const plain = await telemetry(r, reg({ stage: { name: 'S', after: null, openedTurn: 0 } }), async () => ({ context: { window: 1000 } }))
  expect(telemetryText(plain)).toContain('tokens (approx.)')
  const stored = await telemetry(r, reg({ charsPerToken: 2, stage: { name: 'S', after: null, openedTurn: 0 } }), async () => ({ context: { window: 1000 } }))
  expect(stored.ratio).toBe(2)
  expect(telemetryText(stored)).not.toContain('approx.')
  const parsed = parseRegistry(JSON.stringify(reg({ charsPerToken: 1.8 })))
  expect(parsed.state === 'ok' && parsed.value.charsPerToken).toBe(1.8)
  expect(parseRegistry(JSON.stringify(reg({ charsPerToken: 9 }))).state).toBe('unreadable')
})

// ---- [SP_CTX_02_28] review round 39: the measured change of the last apply

test('Telemetry — виміряне звільнення: after the first response the line shows request before − now once and lastApply goes; before it, nothing', async () => {
  const r = rows()
  let state = reg({ lastApply: { at: 5, tokensBefore: 574_000 } })
  const update = async (change: (g: TagRegistry) => TagRegistry) => void (state = change(state))
  const after: UsageInfo = { context: { tokens: 261_000, window: 1_000_000 } }
  const text = telemetryText(await telemetry(r, state, async () => after, update))
  expect(text).toContain('Last apply: ~313k tokens freed (measured: request before it − request now; net of the rows added since)')
  expect(state.lastApply).toBeUndefined()
  expect(telemetryText(await telemetry(r, state, async () => after, update))).not.toContain('Last apply')
  // no response since the apply yet: unknown, the field stays
  let waiting = reg({ lastApply: { at: 5, tokensBefore: 574_000 } })
  const t = await telemetry(r, waiting, async () => ({ context: { window: 1000 } }), async change => void (waiting = change(waiting)))
  expect(telemetryText(t)).not.toContain('Last apply')
  expect(waiting.lastApply).toEqual({ at: 5, tokensBefore: 574_000 })
  expect(parseRegistry(JSON.stringify(reg({ lastApply: { at: 1, tokensBefore: 2 } }))).state).toBe('ok')
  expect(parseRegistry(JSON.stringify({ ...reg(), lastApply: { at: 1 } })).state).toBe('unreadable')
})

test('BlockReport — one ratio: the block size uses the calibration the same report\'s telemetry made', async () => {
  const list = [prompt('p'), reply('x'.repeat(90_000)), use('a'), result('a'), use('tc', TAG_TOOL)]
  const io: BlockIO = {
    key: async () => 'K',
    rows: async () => list,
    readTags: async () => okRead(reg()),
    media: async () => new Map(),
    usage: async () => messagesUsage(30_000),
    setListed: () => undefined,
  }
  const text = await blockReport(io, { name: 'A', after: mark(list, 0), end: mark(list, 3), turn: 0 })
  expect(text).toContain('rows #1..#3, ~')
  expect(text.split('\n')[0]).not.toContain('approx.')
})

test('context_list — a thinking-only row shows as (thinking)', async () => {
  expect(listRows([prompt('p'), think(), reply('x')], 0, 5)).toContain('#1 assistant 0c: (thinking)')
})

// [SP_CTX_02_28] review round 40
test('Telemetry — a negative measured change (more rows added than freed) is not shown; lastApply goes anyway', async () => {
  let state = reg({ lastApply: { at: 5, tokensBefore: 200_000 } })
  const t = await telemetry(rows(), state, async () => ({ context: { tokens: 210_000, window: 1_000_000 } }), async change => void (state = change(state)))
  expect(t.measuredFreed).toBeUndefined()
  expect(telemetryText(t)).not.toContain('Last apply')
  expect(state.lastApply).toBeUndefined()
})

test('Telemetry — гонка з новим застосуванням: a newer apply set another lastApply before the update: it stays; the same request size as before: no change measured, lastApply stays', async () => {
  // the update sees a registry where a newer apply already set lastApply
  let state = reg({ lastApply: { at: 9, tokensBefore: 300_000 } })
  const seen = reg({ lastApply: { at: 5, tokensBefore: 200_000 } })
  const t = await telemetry(rows(), seen, async () => ({ context: { tokens: 150_000, window: 1_000_000 } }), async change => void (state = change(state)))
  expect(t.measuredFreed).toBe(50_000)
  expect(state.lastApply).toEqual({ at: 9, tokensBefore: 300_000 })
  // the same apply: it goes
  state = reg({ lastApply: { at: 5, tokensBefore: 200_000 } })
  await telemetry(rows(), seen, async () => ({ context: { tokens: 150_000, window: 1_000_000 } }), async change => void (state = change(state)))
  expect(state.lastApply).toBeUndefined()
  // tokensNow === tokensBefore: no response since the apply; no update at all
  let updates = 0
  const same = await telemetry(rows(), seen, async () => ({ context: { tokens: 200_000, window: 1_000_000 } }), async change => void (updates++, (state = change(state))))
  expect(same.measuredFreed).toBeUndefined()
  expect(telemetryText(same)).not.toContain('Last apply')
  expect(updates).toBe(0)
  // a failing update never fails the telemetry
  const failing = await telemetry(rows(), seen, async () => ({ context: { tokens: 150_000, window: 1_000_000 } }), async () => {
    throw new Error('disk full')
  })
  expect(failing.measuredFreed).toBe(50_000)
})

// ---- phase 15: telemetry and the close report by reason, journal, state slot

test('Telemetry — кандидати: big #12, stale #5, a tag without reason #7, an agent review whose ttl has not passed, a disposable whose target is gone', async () => {
  const r = [prompt('p'), ...Array.from({ length: 7 }, (_, i) => [use(`r${i}`), result(`r${i}`)]).flat()]
  const tags: Tag[] = [
    { kind: 'review', reason: 'big', target: { tool_use_id: 'r5' }, created_turn: 0 },
    { kind: 'review', reason: 'stale', target: { tool_use_id: 'r2' }, created_turn: 0 },
    { kind: 'review', target: mark(r, 7), created_turn: 0 },
    { kind: 'review', reason: 'agent', target: { tool_use_id: 'r6' }, ttl_turns: 5, created_turn: 0 },
    { kind: 'disposable', target: { tool_use_id: 'gone' }, note: 'n', created_turn: 0 },
  ]
  const text = telemetryText(await telemetry(r, reg({ tags, turn: 1 }), async () => USAGE))
  expect(text).toContain('Candidates: review 3 (big 1: #11; stale 1: #5; no reason 1: #7); disposable 0')
})

test('Telemetry — журнал: none or zero entries give no Effect line; 2 applications, 3 rereads (1 of archives); an unreadable journal says why', async () => {
  const r = rows()
  const none = telemetryText(await telemetry(r, reg(), async () => USAGE))
  expect(none).not.toContain('Effect')
  expect(telemetryText(await telemetry(r, reg(), async () => USAGE, undefined, { applications: 0, rereads: 0, archiveRereads: 0 }))).not.toContain('Effect')
  const some = telemetryText(await telemetry(r, reg(), async () => USAGE, undefined, { applications: 2, rereads: 3, archiveRereads: 1 }))
  expect(some).toContain('Effect: 2 application(s); 3 reread(s) of compressed content (1 of archives)')
  expect(some).not.toContain('freed')
  expect(telemetryText(await telemetry(r, reg(), async () => USAGE, undefined, { unreadable: 'not JSON' }))).toContain('Effect: journal unreadable (not JSON)')
})

test('Telemetry — слот стану: the state tag found / not found / absent', async () => {
  const r = rows()
  const at = (target: RowMark) => reg({ tags: [{ kind: 'state', target, created_turn: 0 }] })
  expect(telemetryText(await telemetry(r, at(mark(r, 3)), async () => USAGE))).toContain('State slot: #3')
  expect(telemetryText(await telemetry(r, at({ anchor: 'assistant||gone', hint: 3 }), async () => USAGE))).toContain('State slot: its row is no longer in the conversation')
  expect(telemetryText(await telemetry(r, reg(), async () => USAGE))).not.toContain('State slot')
})

test('BlockReport — кандидати блоку за причинами: reasons in order, "no reason" for an old tag, disposables, the reproducible pairs of the block', async () => {
  const r = rows()
  const tags: Tag[] = [
    { kind: 'review', reason: 'search', target: { tool_use_id: 'b' }, created_turn: 0 },
    { kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', target: { tool_use_id: 'c' }, created_turn: 0 },
    { kind: 'disposable', target: mark(r, 6), note: 'n', created_turn: 0 },
  ]
  const text = await blockReport(blockIO(r, reg({ tags })), { name: 'A', after: null, end: mark(r, 11), turn: 0 })
  // pairs a, c, d (Read) and b (Grep) lie in #0..#11
  expect(text).toContain('Candidates in the block: big #1; search #4; no reason #7; disposable #6; reproducible pairs (~) 4.')
  // the telemetry of the report carries the journal when the port gives one
  const withJournal = await blockReport({ ...blockIO(r, reg({ tags })), journal: async () => ({ applications: 1, rereads: 0, archiveRereads: 0 }) }, { name: 'A', after: null, end: mark(r, 11), turn: 0 })
  expect(withJournal).toContain('Effect: 1 application(s); 0 reread(s) of compressed content (0 of archives)')
})

// ---- [SP_CTX_02_01] contextList ([PL_AUD_CTX_P10], CF-19)

// A host for context_list: the registry and the alias registry as read, the
// listed key and the IO calls in order.
function listHarness(over: Partial<ListIO> = {}, list: SessionMessage[] = rows(), tags: Read<TagRegistry> = okRead(reg()), aliases: Read<AliasRegistry> = okRead({ next: 2, map: { c1: 'a' } })) {
  const log = { listed: undefined as string | undefined, calls: [] as string[], updates: 0 }
  const io: ListIO = {
    view: async () => (log.calls.push('view'), { rows: list, key: 'K1' }),
    api: async () => (log.calls.push('api'), []),
    storage: async () => (log.calls.push('storage'), '/s'),
    readTags: async dir => (log.calls.push(`tags ${dir}`), tags),
    readAliases: async dir => (log.calls.push(`aliases ${dir}`), aliases),
    usage: async () => USAGE,
    updateTags: () => async () => void log.updates++,
    journal: async dir => (log.calls.push(`journal ${dir}`), undefined),
    dueLines: async () => (log.calls.push('due'), ['DUE']),
    setListed: key => void (log.listed = key),
    ...over,
  }
  return { io, log }
}

test('contextList — a page with rows renews listedKey; its aliases, labels and the due reminders go with it', async () => {
  const { io, log } = listHarness({}, rows(), okRead(reg({ tags: [{ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 }] })))
  const out = await contextList(io, { count: 20 })
  if (!('result' in out)) throw new Error(out.deny)
  expect(log.listed).toBe('K1')
  expect(out.result).toContain('id=a (c1)')
  expect(out.result).toContain('[pin]')
  expect(out.result.endsWith('\nDUE')).toBe(true)
  // the telemetry reads the API form again for its Cache line ([SP_CTX_02_38])
  expect(log.calls).toEqual(['view', 'api', 'storage', 'tags /s', 'aliases /s', 'journal /s', 'api', 'due'])
})

test('contextList — "count": 0 gives the header alone and does not renew listedKey', async () => {
  const { io, log } = listHarness()
  const out = await contextList(io, { count: 0 })
  if (!('result' in out)) throw new Error(out.deny)
  expect(log.listed).toBe(undefined)
  expect(out.result).not.toContain('#0 ')
  expect(out.result).toContain('Context')
})

test('contextList — "full" shows one row whole: no telemetry, no new listedKey, the reminders still go', async () => {
  const { io, log } = listHarness()
  const out = await contextList(io, { full: true, index: 3 })
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result.startsWith('Row #3 assistant')).toBe(true)
  expect(log.listed).toBe(undefined)
  expect(log.calls).toEqual(['view', 'api', 'storage', 'tags /s', 'due'])
  expect(out.result.endsWith('\nDUE')).toBe(true)
})

test('contextList — a subagent and a bad "full" are refused before any read of the storage', async () => {
  const sub = listHarness()
  expect(await contextList(sub.io, { agentId: 'x', count: 5 })).toEqual({ deny: 'only the main conversation can be listed and edited.' })
  expect(sub.log.calls).toEqual([])
  const bad = listHarness()
  const out = await contextList(bad.io, { full: true })
  expect('deny' in out && out.deny.includes('BAD_FULL')).toBe(true)
  expect(bad.log.calls).toEqual(['view'])
  expect(bad.log.listed).toBe(undefined)
})

test('contextList — no storage: no labels, aliases or journal, and the page still renews listedKey', async () => {
  const { io, log } = listHarness({ storage: async () => undefined })
  const out = await contextList(io, { count: 5 })
  if (!('result' in out)) throw new Error(out.deny)
  expect(log.calls.some(c => c.startsWith('tags') || c.startsWith('aliases') || c.startsWith('journal'))).toBe(false)
  expect(log.updates).toBe(0)
  expect(log.listed).toBe('K1')
})

test('contextList — a failed telemetry never fails the listing', async () => {
  const { io, log } = listHarness({
    usage: async () => {
      throw new Error('no usage')
    },
    journal: async () => {
      throw new Error('journal down')
    },
  })
  const out = await contextList(io, { count: 5 })
  if (!('result' in out)) throw new Error(out.deny)
  expect(out.result).toContain('Context: size unavailable (journal down)')
  expect(log.listed).toBe('K1')
})

test('listLabels / listAliases — none without storage; an unreadable registry says why', async () => {
  const list = rows()
  expect(listLabels(list, undefined)).toEqual({ labels: new Map(), note: '', reg: undefined, notes: [] })
  const bad = listLabels(list, unreadableRead('bad json'))
  expect(bad.note).toBe('\n(tags, stages and notes not shown: the tag registry cannot be read: bad json)')
  expect(bad.reg).toBe(undefined)
  // stage marks first, then tags, then notes on the same row
  const r = reg({
    stage: { name: 'S', after: null, openedTurn: 0 },
    tags: [{ kind: 'pin', target: { anchor: fingerprint(list[0]!), hint: 0 }, created_turn: 0 }],
    notes: [{ id: 'n1', target: { anchor: fingerprint(list[0]!), hint: 0 }, text: 'remember', createdTurn: 0 }],
  })
  const ok = listLabels(list, okRead(r))
  expect(ok.labels.get(0)).toEqual([...markLabels(list, r).get(0)!, ...tagLabels(list, r).get(0)!, '[n1]'])
  expect(ok.notes.length).toBe(1)
  expect(listAliases(undefined)).toEqual({ aliases: new Map(), note: '' })
  expect(listAliases(unreadableRead('gone')).note).toBe('\n(aliases not shown: the alias registry cannot be read: gone)')
  expect([...listAliases(okRead({ next: 3, map: { c1: 'a', c2: 'b' } })).aliases]).toEqual([
    ['a', 'c1'],
    ['b', 'c2'],
  ])
})
