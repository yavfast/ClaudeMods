import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  APPLY_MARGIN,
  breakEven,
  CACHE_LOOKBACK,
  cacheCost,
  costRatios,
  DEFAULT_RATIOS,
  lookbackStart,
  requestsSoFar,
  responseStartRows,
  suffixPositions,
  summaryTokens,
  verdictOf,
} from '../hooks/cache'
import { MESSAGES_ROW, telemetry, telemetryText, type UsageInfo } from '../hooks/stages'
import { EMPTY_REGISTRY } from '../hooks/tags'

const prompt = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [], handle: `p-${text}` })
const think = (k: string): SessionMessage => ({ role: 'assistant', text: '', toolUses: [], handle: `t-${k}` })
const say = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [], handle: `s-${text}` })
const use = (...ids: string[]): SessionMessage => ({ role: 'assistant', text: '', toolUses: ids.map(id => ({ tool_use_id: id, tool: 'Bash', input: {} })), handle: `u-${ids.join()}` })
const result = (id: string, text = 'out'): SessionMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }], handle: `r-${id}` })

// a prompt, then `n` sequential calls c1..cn (one position each for the call and the result), then a final text
function sequential(n: number, size = 3): SessionMessage[] {
  const rows: SessionMessage[] = [prompt('task')]
  for (let k = 1; k <= n; k++) rows.push(use(`c${k}`), result(`c${k}`, 'x'.repeat(size)))
  rows.push(say('done'))
  return rows
}

// ---- [SP_CTX_02_38] Positions

test('Positions — серії: adjacent tool_use blocks are one position, adjacent tool_result blocks too, across rows; thinking, text and a prompt one each', async () => {
  // prompt | thinking | text | use a | result a | use b, use c (two rows) | result b, result c | text
  const rows = [prompt('task'), think('1'), say('look'), use('a'), result('a'), use('b'), use('c'), result('b'), result('c'), say('done')]
  const pos = suffixPositions(rows)
  expect(pos[rows.length]).toBe(0)
  expect(pos[9]).toBe(1)
  // every row of a response counts from its start: the run of calls b, c is one position, so is the run of their results
  expect(pos[5]).toBe(3)
  expect(pos[6]).toBe(3)
  expect(pos[7]).toBe(3)
  expect(pos[8]).toBe(3)
  expect(pos[0]).toBe(8)
  // one row with two calls is one position
  expect(suffixPositions([use('x', 'y'), result('x'), result('y')])[0]).toBe(2)
})

test('ResponseStartRows — відповідь: a result row belongs to its call; consecutive assistant rows are one response; a prompt row is its own', async () => {
  const rows = [prompt('task'), think('1'), say('look'), use('a'), result('a'), say('done')]
  expect(responseStartRows(rows, 3)).toBe(1)
  expect(responseStartRows(rows, 4)).toBe(1)
  expect(responseStartRows(rows, 5)).toBe(5)
  expect(responseStartRows(rows, 0)).toBe(0)
})

test('LookbackStart — межа: the earliest row whose response starts within CACHE_LOOKBACK positions of the end', async () => {
  // from call k: 2·(15 − k + 1) + 1 positions; within 20 from k = 7 (index 13)
  const rows = sequential(15)
  expect(lookbackStart(rows)).toBe(13)
  expect(suffixPositions(rows)[13]).toBe(19)
  expect(suffixPositions(rows)[11]).toBe(21)
  // a short conversation lies within as a whole
  expect(lookbackStart(sequential(3))).toBe(0)
  expect(lookbackStart([])).toBe(0)
})

// ---- [SP_CTX_02_38] CacheCost

test('CacheCost — вікно: an edit within the lookback rewrites the rows from its response on; a deeper one the whole conversation; both less the freed', async () => {
  const rows = sequential(15, 4000)
  // call 14 (index 27): 5 positions; the rows from it: 2 results of 4000 chars, 2 calls with input "{}" and the final text
  const near = cacheCost(rows, 27, 500, 100_000, 4)
  expect(near.within).toBe(true)
  expect(near.positions).toBe(5)
  expect(near.start).toBe(27)
  expect(near.rewrite).toBe(Math.round(8008 / 4) - 500)
  // call 2 (index 3): far beyond the lookback
  const deep = cacheCost(rows, 3, 500, 100_000, 4)
  expect(deep.within).toBe(false)
  expect(deep.positions).toBe(2 * 14 + 1)
  expect(deep.rewrite).toBe(100_000 - 500)
  // the result row of a call counts from the call
  expect(cacheCost(rows, 28, 0, 100_000, 4).start).toBe(27)
  expect(CACHE_LOOKBACK).toBe(20)
})

test('Requests — відповіді: runs of assistant rows count as one request each; at least 1', async () => {
  expect(requestsSoFar(sequential(3))).toBe(4)
  expect(requestsSoFar([prompt('task'), think('1'), say('a'), use('x'), result('x'), say('b')])).toBe(2)
  expect(requestsSoFar([prompt('task')])).toBe(1)
})

// ---- [SP_CTX_02_38] BreakEven, Verdict, the summary

test('BreakEven — формула: R* = (write − 1)·rewrite/freed + out·summary/freed + request/freed (P22 on Opus 5.5 ratios: c11–c13 ~12k at 84k, ~44k rewritten → ~150)', async () => {
  const opus = costRatios('claude-opus-5-5')
  expect(breakEven({ rewrite: 44_000, freed: 12_000, summary: 0, request: 84_000 }, opus)).toBe(150)
  expect(breakEven({ rewrite: 0, freed: 10_000, summary: 1000, request: 50_000 }, opus)).toBe(15)
  // Sonnet 5.5: half the write ratio
  expect(breakEven({ rewrite: 44_000, freed: 12_000, summary: 0, request: 84_000 }, costRatios('sonnet'))).toBe((19 * 44_000 + 84_000) / 12_000)
  expect(breakEven({ rewrite: 1, freed: 0, summary: 0, request: 1 })).toBe(Infinity)
})

test('Verdict — межі: worth when R* ≤ R̂, not yet when R* > 3·R̂, else borderline', async () => {
  expect(verdictOf(10, 10)).toBe('worth')
  expect(verdictOf(30, 10)).toBe('borderline')
  expect(verdictOf(31, 10)).toBe('not-yet')
})

test('Summary — розмір: a pointer for a reproducible output (5 %, at least 40), a careful summary for another (25 %, at least 150), never above the original', async () => {
  expect(summaryTokens(1000, true)).toBe(50)
  expect(summaryTokens(100, true)).toBe(40)
  expect(summaryTokens(30, true)).toBe(30)
  expect(summaryTokens(1000, false)).toBe(250)
  expect(summaryTokens(100, false)).toBe(100)
})

// ---- [SP_CTX_02_28] the Cache line of the telemetry

const USAGE: UsageInfo = {
  context: { tokens: 50_000, window: 1_000_000, breakdown: { categories: [{ name: MESSAGES_ROW, tokens: 20_000, kind: 'used' }], totalTokens: 60_000, rawMaxTokens: 1_000_000, apiUsage: {} } },
}

test('Telemetry — рядок Cache: the first row within the lookback and what an edit from there rewrites; the whole conversation and a too long last response have their own words', async () => {
  const rows = sequential(15, 4000)
  const text = telemetryText(await telemetry(rows, { ...EMPTY_REGISTRY }, async () => USAGE))
  // by default an apply rewrites the whole conversation; keep_cache keeps the cache before an edit from #13 on
  expect(text).toContain('Cache: an apply rewrites the whole conversation once; with "keep_cache": true, an earliest edit from #13 on (within the API\'s ~20-position cache lookback) rewrites only the rows from it (at most ~')
  expect(text).toContain('if your turn ends soon: edits apply at its end, and each call until then pushes them deeper')
  // the line follows the size line
  expect(text.split('\n')[1]!.startsWith('Cache: ')).toBe(true)
  const short = telemetryText(await telemetry(sequential(3), { ...EMPTY_REGISTRY }, async () => USAGE))
  expect(short).toContain('Cache: an apply rewrites the whole conversation once; with "keep_cache": true only the rows from its earliest edit (the whole conversation is within the API\'s ~20-position cache lookback)')
  // eleven parallel calls in one row and their eleven result rows: three positions in all
  const calls = Array.from({ length: 11 }, (_, k) => `p${k}`)
  const parallel = [prompt('task'), use(...calls), ...calls.map(id => result(id))]
  expect(telemetryText(await telemetry(parallel, undefined, async () => USAGE))).toContain('(the whole conversation is within')
  const thinkingOnly: SessionMessage[] = [prompt('task'), ...Array.from({ length: 21 }, (_, k) => (k % 2 ? say(`t${k}`) : think(`${k}`)))]
  expect(telemetryText(await telemetry(thinkingOnly, undefined, async () => USAGE))).toContain('Cache: an apply rewrites the whole conversation once; even the last response is beyond the API\'s ~20-position cache lookback, so "keep_cache" would not help')
  expect(telemetryText(await telemetry([], undefined, async () => USAGE))).not.toContain('Cache:')
})

// ---- review 54: the model's prices, the margin of the end of the turn, parallel calls by the API

test('CostRatios — ціни: by the model family from the published prices; an unknown model gets the highest ratios', async () => {
  expect(costRatios('claude-opus-5-5')).toEqual({ write: 40, out: 100 })
  expect(costRatios('opus[1m]')).toEqual({ write: 40, out: 100 })
  expect(costRatios('claude-sonnet-5-5')).toEqual({ write: 20, out: 50 })
  expect(costRatios('claude-haiku-5-5')).toEqual({ write: 20, out: 50 })
  expect(costRatios('claude-fable-5-1')).toEqual({ write: 80, out: 200 })
  expect(costRatios('claude-mythos-5')).toEqual({ write: 20, out: 50 })
  expect(costRatios(undefined)).toEqual(DEFAULT_RATIOS)
  expect(costRatios('new-model')).toEqual({ write: 80, out: 200 })
})

test('CacheCost — запас кінця ходу: positions now plus the margin decide; Infinity is deep in any case', async () => {
  const rows = sequential(15, 4000)
  // call 11 (index 21): 11 positions now; with APPLY_MARGIN 21 > 20
  expect(cacheCost(rows, 21, 0, 100_000, 4).within).toBe(true)
  expect(cacheCost(rows, 21, 0, 100_000, 4, APPLY_MARGIN).within).toBe(false)
  expect(cacheCost(rows, 31, 0, 100_000, 4, Infinity).within).toBe(false)
  expect(cacheCost(rows, 31, 0, 100_000, 4, Infinity).rewrite).toBe(100_000)
})

test('Responses — паралельні виклики «виклик, результат, виклик»: with the API message both calls are one response: its start, two positions, one request', async () => {
  const rows = [prompt('task'), think('1'), use('a'), result('a'), use('b'), result('b'), say('done')]
  const api = [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'a', name: 'Bash', input: {} }, { type: 'tool_use', id: 'b', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'out' }, { type: 'tool_result', tool_use_id: 'b', content: 'out' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
  ]
  // by the rows alone: two responses, the second starting at call b
  expect(responseStartRows(rows, 4)).toBe(4)
  expect(requestsSoFar(rows)).toBe(3)
  expect(suffixPositions(rows)[1]).toBe(6)
  // by the API form: one response from the thinking row; thinking, the calls, the results: 3 positions, then the text
  expect(responseStartRows(rows, 4, api)).toBe(1)
  expect(responseStartRows(rows, 5, api)).toBe(1)
  expect(requestsSoFar(rows, api)).toBe(2)
  expect(suffixPositions(rows, api)[1]).toBe(4)
  expect(suffixPositions(rows, api)[4]).toBe(4)
  // a prompt between: never one response
  const two = [prompt('task'), use('a'), result('a'), prompt('next'), use('b'), result('b')]
  expect(responseStartRows(two, 4, [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a' }, { type: 'tool_use', id: 'b' }] }])).toBe(4)
})
