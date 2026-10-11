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
import { rowChars } from './edits'
import { apiBlocks } from './media'

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
// 0.1× elsewhere). An unknown model gets the highest known ratios: the
// verdict then says "worth it" less often, never more.
export type CostRatios = { write: number; out: number }
export const COST_RATIOS: readonly { match: RegExp; ratios: CostRatios }[] = [
  { match: /(fable|mythos)[^0-9]*5[.-]1/i, ratios: { write: 80, out: 200 } },
  { match: /fable|mythos/i, ratios: { write: 20, out: 50 } },
  { match: /opus/i, ratios: { write: 40, out: 100 } },
  { match: /sonnet|haiku/i, ratios: { write: 20, out: 50 } },
]
export const DEFAULT_RATIOS: CostRatios = { write: 80, out: 200 }

export function costRatios(model: string | undefined): CostRatios {
  return (model && COST_RATIOS.find(r => r.match.test(model))?.ratios) || DEFAULT_RATIOS
}

type Kind = 'thinking' | 'text' | 'use' | 'result'

// The kinds of a row's blocks in the API form, in order. A thinking block
// shows only as an assistant row without text and calls (plugin-hooks 36).
function kinds(row: SessionMessage): Kind[] {
  if (row.role === 'assistant') {
    const k: Kind[] = row.text ? ['text'] : []
    for (let n = 0; n < row.toolUses.length; n++) k.push('use')
    return k.length ? k : ['thinking']
  }
  const k: Kind[] = (row.toolResults ?? []).map((): Kind => 'result')
  if (row.text || !k.length) k.push('text')
  return k
}

const runs = (k: Kind | undefined): boolean => k === 'use' || k === 'result'
const squash = (s: string): string => s.replace(/\s+/g, '')
const isPrompt = (r: SessionMessage): boolean => r.role === 'user' && !(r.toolResults ?? []).length

// [SP_CTX_02_38] Responses(rows, api): the first row of the response each row
// belongs to. Consecutive assistant rows are one response; a result row
// belongs to the response of its calls; with the API form, assistant rows the
// host merged into one message (parallel calls written "call, result, call")
// are one response too, never across a prompt row; a prompt row is its own.
export function responses(rows: readonly SessionMessage[], api: readonly unknown[] = []): number[] {
  const byId = new Map<string, number>()
  const byText = new Map<string, number>()
  let n = 0
  for (const msg of api) {
    if ((msg as { role?: unknown } | null)?.role !== 'assistant') continue
    for (const b of apiBlocks(msg)) {
      if (b.type === 'tool_use' && typeof b.id === 'string') byId.set(b.id, n)
      if (b.type === 'text' && typeof b.text === 'string' && squash(b.text)) byText.set(squash(b.text), n)
    }
    n++
  }
  const start = new Array<number>(rows.length)
  const callAt = new Map<string, number>()
  const firstOf = new Map<number, number>()
  let prompt = -1
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (r.role === 'assistant') {
      let g = i > 0 && rows[i - 1]!.role === 'assistant' ? start[i - 1]! : i
      const m = r.toolUses.map(u => byId.get(u.tool_use_id)).find(x => x !== undefined) ?? (squash(r.text) ? byText.get(squash(r.text)) : undefined)
      if (m !== undefined) {
        const first = firstOf.get(m)
        if (first !== undefined && first > prompt) g = Math.min(g, first)
        else firstOf.set(m, g)
      }
      start[i] = g
      for (const u of r.toolUses) callAt.set(u.tool_use_id, g)
    } else if (!isPrompt(r)) {
      const g = (r.toolResults ?? []).map(t => callAt.get(t.tool_use_id)).find(x => x !== undefined)
      start[i] = g !== undefined && g > prompt ? g : i
    } else {
      start[i] = i
      prompt = i
    }
  }
  // a response that took a later row in pulls the rows between into it
  for (let i = rows.length - 1; i > 0; i--) if (start[i]! < i && start[i - 1]! > start[i]!) start[i - 1] = start[i]!
  return start
}

// [SP_CTX_02_38] Positions(rows, api): `pos[i]` is the number of API positions
// from the start of rows[i]'s response to the end (pos[rows.length] = 0). In a
// response the host sends the calls of its assistant rows as one message and
// their results after it, so each response counts its kinds in that order;
// adjacent tool_use blocks are one position, so are adjacent tool_result blocks.
export function suffixPositions(rows: readonly SessionMessage[], api: readonly unknown[] = []): number[] {
  const start = responses(rows, api)
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
    first = ks[0]
    end = i
  }
  return pos
}

// [SP_CTX_02_38] The first row of the response that holds rows[at] (Responses).
export function responseStartRows(rows: readonly SessionMessage[], at: number, api: readonly unknown[] = []): number {
  if (!rows.length) return 0
  return responses(rows, api)[Math.max(0, Math.min(at, rows.length - 1))]!
}

// [SP_CTX_02_38] LookbackStart(rows, api): the first row an edit may start at
// with the cache kept up to it, were the apply now: the earliest response
// start within CACHE_LOOKBACK positions of the end; rows.length when not even
// the last response is.
export function lookbackStart(rows: readonly SessionMessage[], api: readonly unknown[] = []): number {
  const pos = suffixPositions(rows, api)
  let k = rows.length
  for (let i = rows.length - 1; i >= 0; i--) {
    if (pos[i]! > CACHE_LOOKBACK) break
    k = i
  }
  return k
}

// [SP_CTX_02_38] What an apply whose earliest edit is rows[first] costs the
// cache: `positions` from the start of its response to the end, now;
// `within` the lookback once `margin` more positions come before the apply
// (Infinity: deep in any case); `rewrite`, the tokens the next request after
// the apply writes: the rows from that start (within) or the whole
// conversation (deeper), less what the edits free.
export type CacheCost = { start: number; positions: number; within: boolean; rewrite: number }

export function cacheCost(
  rows: readonly SessionMessage[],
  first: number,
  freed: number,
  conversation: number,
  ratio: number,
  margin = 0,
  api: readonly unknown[] = [],
): CacheCost {
  const start = responseStartRows(rows, first, api)
  const positions = suffixPositions(rows, api)[start] ?? 0
  const within = positions + margin <= CACHE_LOOKBACK
  let chars = 0
  for (let i = start; i < rows.length; i++) chars += rowChars(rows[i]!)
  const tail = Math.min(Math.round(chars / ratio), conversation)
  return { start, positions, within, rewrite: Math.max(0, (within ? tail : conversation) - freed) }
}

// [SP_CTX_02_38] Requests(rows, api): the model requests of this conversation
// so far, as its responses; at least 1.
export function requestsSoFar(rows: readonly SessionMessage[], api: readonly unknown[] = []): number {
  const start = responses(rows, api)
  return Math.max(1, rows.filter((r, i) => r.role === 'assistant' && start[i] === i).length)
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
