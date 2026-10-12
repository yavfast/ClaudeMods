// The prompt cache an apply costs ([SP_CTX_02_38] CacheCost; spikes
// context_editor_cache and context_editor_efficiency). The host marks the
// cache on the system prompt and on the last two messages of each request,
// and a mark finds an earlier cache entry only within CACHE_LOOKBACK
// positions back (a run of adjacent tool_use blocks is one position, so is a
// run of adjacent tool_result blocks; plugin-hooks 53-55). So the request
// after an apply reads the cache up to its first change only when that change
// lies within the lookback from the end; deeper, it reads the fixed part
// alone and rewrites the whole conversation. The apply runs at the end of the
// turn, so the depth an estimate sees now grows with every call until then.
// The break-even of an edit weighs that rewrite against the reads it saves. Pure.
import type { SessionMessage } from 'claude-code'
import { responses, responseStart, type Responses } from './edits'
import { apiMessageChars, charsOf, isPlainUserRow, isPromptRow, resultsOf, totalChars } from './rows'

// ---- [SP_CTX_01_12] constants

// positions a cache mark of the API looks back for an earlier entry
export const CACHE_LOOKBACK = 20
// positions the size channel adds to a depth measured now: the calls of the
// turn still to come before the apply at its end
export const APPLY_MARGIN = 10
// the verdict's margin around the estimate of the requests to come
export const VERDICT_MARGIN = 3
// the size of a summary against its original, in tokens: a reproducible
// output (a pointer) and any other (a careful summary)
export const SUMMARY_REPRO = { share: 0.05, min: 40 } as const
export const SUMMARY_OTHER = { share: 0.25, min: 150 } as const

// [SP_CTX_01_12] CostRatios: the price of a 1h cache write and of an output
// token over a cache read, by the model's family, from the published list
// prices (claude-api skill, shared/models.md and prompt-caching.md: a 1h
// write is 2× input; reads 0.05× on Opus 5.5, 0.025× on Fable / Mythos 5.1,
// 0.1× elsewhere). Opus counts only as Opus 5.5 (`opus` then 5.5 in the id,
// e.g. claude-opus-5-5, claude-opus-5-5[1m]), the only Opus the table lists,
// and the bare alias `opus` / `opus[1m]`, which points to Opus 5.5 today
// (revisit when the alias moves); another Opus is an unknown model. An
// unknown model gets the highest known ratios: the verdict then says
// "worth it" less often, never more.
export type CostRatios = { write: number; out: number }
export const COST_RATIOS: readonly { match: RegExp; ratios: CostRatios }[] = [
  { match: /(fable|mythos)[^0-9]*5[.-]1/i, ratios: { write: 80, out: 200 } },
  { match: /fable|mythos/i, ratios: { write: 20, out: 50 } },
  { match: /opus[^0-9]*5[.-]5(?![0-9])/i, ratios: { write: 40, out: 100 } },
  { match: /^opus(\[1m\])?$/i, ratios: { write: 40, out: 100 } },
  { match: /sonnet|haiku/i, ratios: { write: 20, out: 50 } },
]
export const DEFAULT_RATIOS: CostRatios = { write: 80, out: 200 }

export function costRatios(model: string | undefined): CostRatios {
  return (model && COST_RATIOS.find(r => r.match.test(model))?.ratios) || DEFAULT_RATIOS
}

type Kind = 'thinking' | 'text' | 'use' | 'result'

// The kinds of a row's blocks in the API form, in order. A thinking block
// shows only as an assistant row without text and calls (plugin-hooks 36). An
// empty user row that is no prompt (a result row a drop left empty) adds
// nothing: inside a response it would split the run of its results.
function kinds(row: SessionMessage): Kind[] {
  if (isPlainUserRow(row) && !isPromptRow(row)) return []
  if (row.role === 'assistant') {
    const k: Kind[] = row.text ? ['text'] : []
    for (let n = 0; n < row.toolUses.length; n++) k.push('use')
    return k.length ? k : ['thinking']
  }
  const k: Kind[] = resultsOf(row).map((): Kind => 'result')
  if (row.text || !k.length) k.push('text')
  return k
}

const runs = (k: Kind | undefined): boolean => k === 'use' || k === 'result'

// [SP_CTX_02_38] CacheShape(rows, api): the responses of the rows by
// Responses of [SP_CTX_02_04] (the one prompt predicate and grouping that
// FrozenPrefix uses) and their positions, computed once for every estimate
// over the same rows and API form. Without the API form, parallel calls
// written "call, result, call" are separate responses.
// `tail[m]`: the chars of api[m..] (ApiMessageChars); the API message of
// each assistant row comes from Responses (`responses.message`).
export type CacheShape = {
  rows: readonly SessionMessage[]
  api: readonly unknown[]
  responses: Responses
  pos: readonly number[]
  tail: readonly number[]
}

export function cacheShape(rows: readonly SessionMessage[], api: readonly unknown[] = []): CacheShape {
  const shape = responses(rows, api)
  const tail = new Array<number>(api.length + 1).fill(0)
  for (let m = api.length - 1; m >= 0; m--) tail[m] = tail[m + 1]! + apiMessageChars(api[m])
  return { rows, api, responses: shape, pos: positions(rows, shape.start), tail }
}

// [SP_CTX_02_38] ApiTailChars(shape, start): the chars of the API form from
// the message of rows[start] on, the host's attachments in it included: the
// first assistant row from `start` on that an API message holds gives that
// message; a user row at `start` (a prompt) is the user message right before
// it, where the host puts the prompt with its attachments. Undefined when no
// assistant row from `start` on is in the API form (no form, a tail of user
// rows alone).
export function apiTailChars(shape: CacheShape, start: number): number | undefined {
  const { rows, api, tail } = shape
  const { message } = shape.responses
  for (let k = Math.max(0, start); k < rows.length; k++) {
    const m = message[k]
    if (m === undefined) continue
    const user = rows[start]!.role !== 'assistant' && m > 0 && (api[m - 1] as { role?: unknown } | null)?.role === 'user'
    return tail[user ? m - 1 : m]!
  }
  return undefined
}

// [SP_CTX_02_38] TailTokens(shape, start, ratio, whole): the tokens of the
// request from rows[start] on, what an apply that keeps the cache up to
// there rewrites. The API form's chars from there by the ratio, as the
// calibration counts ([SP_CTX_02_34]); without them, the rows' chars from
// there at the tokens per row char of the whole (`whole` over the rows'
// chars: the attachments the rows lack, on average), or by the ratio when
// `whole` is unknown. At most `whole`.
export function tailTokens(shape: CacheShape, start: number, ratio: number, whole?: number): number {
  const { rows } = shape
  const fromApi = apiTailChars(shape, start)
  const all = totalChars(rows)
  const chars = charsOf(rows, start, rows.length - 1)
  const t = fromApi !== undefined ? fromApi / ratio : whole !== undefined && all > 0 ? (chars * whole) / all : chars / ratio
  return Math.round(whole !== undefined ? Math.min(t, whole) : t)
}

// [SP_CTX_02_38] Positions(rows, start): `pos[i]` is the number of API positions
// from the start of rows[i]'s response (`start`, the Responses grouping) to
// the end (pos[rows.length] = 0). In a
// response the host sends the calls of its assistant rows as one message and
// their results after it, so each response counts its kinds in that order;
// adjacent tool_use blocks are one position, so are adjacent tool_result blocks.
function positions(rows: readonly SessionMessage[], start: readonly number[]): number[] {
  const pos = new Array<number>(rows.length + 1).fill(0)
  let first: Kind | undefined
  let end = rows.length
  for (let i = rows.length - 1; i >= 0; i--) {
    if (start[i] !== i) continue
    const group = rows.slice(i, end)
    const ks = [...group.filter(r => r.role === 'assistant').flatMap(kinds), ...group.filter(r => r.role !== 'assistant').flatMap(kinds)]
    let n = 0
    let prev: Kind | undefined
    for (const k of ks) {
      if (!(k === prev && runs(k))) n++
      prev = k
    }
    if (prev === first && runs(first)) n--
    for (let k = i; k < end; k++) pos[k] = pos[end]! + n
    if (ks.length) first = ks[0]
    end = i
  }
  return pos
}

// [SP_CTX_02_38] LookbackStart(rows, api): the first row an edit may start at
// with the cache kept up to it, were the apply now: the least k such that the
// ResponseStart of every row from k on (the start FrozenPrefix would keep the
// cache up to, [SP_CTX_02_04]) lies within CACHE_LOOKBACK positions of the
// end; such a k is a response start itself; rows.length when not even the
// last row passes. Without the API form only stretch starts qualify.
export function lookbackStart(shape: CacheShape): number {
  const { rows, pos } = shape
  let k = rows.length
  let least = rows.length
  for (let i = rows.length - 1; i >= 0; i--) {
    least = Math.min(least, responseStart(rows, i, shape.api, shape.responses))
    if (pos[least]! > CACHE_LOOKBACK) break
    k = i
  }
  return k
}

// [SP_CTX_02_38] What an apply whose earliest edit is rows[first] costs the
// cache: `start`, the first row of its response by ResponseStart of
// [SP_CTX_02_04], the row FrozenPrefix keeps the cache up to; `positions`
// from that start to the end, now; `within` the lookback once `margin` more
// positions come before the apply (Infinity: deep in any case); `rewrite`,
// the tokens the next request after the apply writes: the request from that
// start (within, TailTokens) or all its messages (deeper: `whole`, the
// Messages row with the fixed part's rows that lie in the messages,
// [SP_CTX_02_28]), less what the edits free.
export type CacheCost = { start: number; positions: number; within: boolean; rewrite: number }

export function cacheCost(shape: CacheShape, first: number, freed: number, whole: number, ratio: number, margin = 0): CacheCost {
  const { rows } = shape
  const start = responseStart(rows, first, shape.api, shape.responses)
  const positions = shape.pos[start] ?? 0
  const within = positions + margin <= CACHE_LOOKBACK
  const tail = within ? tailTokens(shape, start, ratio, whole) : whole
  return { start, positions, within, rewrite: Math.max(0, tail - freed) }
}

// [SP_CTX_02_38] Requests(rows, api): the model requests of this conversation
// so far, as its responses; at least 1.
export function requestsSoFar(shape: CacheShape): number {
  const { start } = shape.responses
  return Math.max(1, shape.rows.filter((r, i) => r.role === 'assistant' && start[i] === i).length)
}

// [SP_CTX_02_38] The tokens a summary of an output of `tokens` takes.
export function summaryTokens(tokens: number, reproducible: boolean): number {
  const s = reproducible ? SUMMARY_REPRO : SUMMARY_OTHER
  return Math.min(tokens, Math.max(s.min, s.share * tokens))
}

// [SP_CTX_02_38] BreakEven: after how many requests the reads an edit saves
// pay for its cache rewrite, the summaries' output and the request that
// queues it: R* = (write − 1)·rewrite/freed + out·summary/freed + request/freed.
export function breakEven(f: { rewrite: number; freed: number; summary: number; request: number }, r: CostRatios = DEFAULT_RATIOS): number {
  if (f.freed <= 0) return Infinity
  return ((r.write - 1) * f.rewrite + r.out * f.summary + f.request) / f.freed
}

// [SP_CTX_02_38] Verdict: with R̂ the requests so far (as many may follow),
// worth it when R* ≤ R̂, not yet when R* > VERDICT_MARGIN·R̂, else borderline.
export type Verdict = 'worth' | 'borderline' | 'not-yet'

export function verdictOf(rStar: number, rHat: number): Verdict {
  if (rStar <= rHat) return 'worth'
  return rStar > VERDICT_MARGIN * rHat ? 'not-yet' : 'borderline'
}
