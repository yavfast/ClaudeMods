// [SP_CTX_02_37] [C_CTX_DEC_15] [SP_CTX_DEC_23] SoftHint: a proposal line of
// its own, `[context-editor: suggestion]`, in two moments: (1) after a big or
// search output once the conversation is large and has grown by a step since
// the last one; (2) with the person's next prompt after a run of such outputs
// (the end of a turn is the natural batch). Only when the batch of outputs
// not compressed yet is worth naming; it names the action (which cN, or
// closing the open stage), what it frees, what it costs the prompt cache and
// the verdict of the break-even ([SP_CTX_02_38]). It never queues, closes or
// optimizes anything: the decision stays the agent's. Pure logic behind a
// small port; register.ts binds it to `$` and puts the line after the alias
// line ([SP_CTX_02_16]) or into the prompt's hidden context ([SP_CTX_02_08]).
import type { SessionMessage } from 'claude-code'
import { aliasesById, aliasLine, type AliasRegistry } from './aliases'
import { APPLY_MARGIN, breakEven, CACHE_LOOKBACK, cacheCost, cacheShape, costRatios, requestsSoFar, summaryTokens, verdictOf, type CacheCost, type CostRatios, type Verdict } from './cache'
import { REPRODUCIBLE_TOOLS, touchedBy, type QueuedEdit } from './edits'
import { MARK, PLAIN_RATIO, resultsOf, rowChars, totalChars } from './rows'
import type { Queue } from './queue'
import type { Change, Read } from './store'
import { telemetry, tokensText, type RegistryUpdate, type UsageInfo } from './stages'
import { dropLastApply, isActive, resolveTarget, type HintState, type TagRegistry } from './tags'

// ---- [SP_CTX_01_12] constants

// the prefix of the line: not the alias line's, so it reads as a proposal (P22)
export const SUGGESTION = '[context-editor: suggestion]'
// tokens of the conversation (the breakdown's Messages row) the size channel
// needs, at most HINT_WINDOW_SHARE of the window
export const HINT_CONVERSATION = 150_000
export const HINT_WINDOW_SHARE = 0.35
// growth of the request, in tokens, since the last suggestion before the next
// size one, at most HINT_STEP_SHARE of the window
export const HINT_STEP = 75_000
export const HINT_STEP_SHARE = 0.1
// the least the batch frees: a share of the conversation, and tokens
export const HINT_BATCH = 0.1
export const HINT_CANDIDATES = 15_000
// marked outputs (aliases given) since the last suggestion before a turn's start counts
export const HINT_RUN = 5
// candidates the line names, largest first
export const HINT_NAMES = 6
// growth, in tokens, before a size check that found no batch runs again
export const HINT_RECHECK = 5_000
// how long a tool result or a prompt waits for the line
export const HINT_WAIT_MS = 500

// [SP_CTX_02_37] The size channel's thresholds for a window (absent: the constants).
export function sizeThreshold(window?: number): number {
  return window ? Math.min(HINT_CONVERSATION, Math.round(HINT_WINDOW_SHARE * window)) : HINT_CONVERSATION
}

export function stepThreshold(window?: number): number {
  return window ? Math.min(HINT_STEP, Math.round(HINT_STEP_SHARE * window)) : HINT_STEP
}

// [SP_CTX_02_37] Module memory: the request size of the last size check that
// read the rows and found no suggestion; `busy`: a check runs now (one at a
// time, both channels).
export type HintMemo = { checked?: number; busy?: boolean }

export function newHintMemo(): HintMemo {
  return {}
}

// The deadline of one check: once `expired`, no claim writes; once `claimed`,
// the caller waits for the line.
export type Deadline = { expired: boolean; claimed: boolean }

export type HintIO = {
  readTags: () => Promise<Read<TagRegistry>>
  readAliases: () => Promise<Read<AliasRegistry>>
  readQueue: () => Promise<Read<Queue>>
  // CurrentRows ([SP_CTX_02_18])
  rows: () => Promise<readonly SessionMessage[]>
  // the plain usage (1–3 ms): the last request with the fixed part, and the window
  request: () => Promise<{ tokens?: number; window?: number }>
  // the usage with the breakdown (23–87 ms)
  usage: () => Promise<UsageInfo>
  // [SP_CTX_02_38] the Messages API form (the responses of the rows), read
  // only after the cheap gates; absent or failed: the rows alone
  api?: () => Promise<readonly unknown[]>
  // [SP_CTX_02_38] the main loop's model, for CostRatios; absent: the default
  model?: () => Promise<string | undefined>
  // on the registry chain, an Update port ([SP_CTX_01_07]): a new
  // calibration ([SP_CTX_02_34]); the hint never waits for it
  updateTags?: RegistryUpdate
  // on the registry chain, the Change contract ([SP_CTX_01_07]): `change`
  // sees the registry as read then; undefined writes nothing; resolves true
  // when written
  changeTags: Change<TagRegistry>
}

// One candidate: an active review tag whose target is in the conversation and
// no queued edit touches; `row`: its first row; `chars`: the result's text
// (a pair) or the row's size; `reproducible`: the call's tool is in
// REPRODUCIBLE_TOOLS (its summary is a pointer).
export type Candidate = { alias?: string; row: number; chars: number; reproducible: boolean }

// [SP_CTX_02_37] Candidates(rows, reg, queued, aliases): largest first. Pure.
export function candidates(rows: readonly SessionMessage[], reg: TagRegistry, queued: readonly QueuedEdit[], aliases: ReadonlyMap<string, string>): Candidate[] {
  const busyIds = new Set<string>()
  const busyRows = new Set<number>()
  for (const edit of queued) {
    const t = touchedBy(rows, edit)
    for (const id of t?.ids ?? []) busyIds.add(id)
    for (const i of t?.rows ?? []) busyRows.add(i)
  }
  const out: Candidate[] = []
  for (const tag of reg.tags) {
    if (tag.kind !== 'review' || !isActive(tag, reg.turn)) continue
    const at = resolveTarget(rows, tag.target)
    if (!at || at.some(i => busyRows.has(i))) continue
    if ('tool_use_id' in tag.target) {
      const id = tag.target.tool_use_id
      if (busyIds.has(id)) continue
      const text = rows.flatMap(resultsOf).find(t => t.tool_use_id === id)?.text ?? ''
      // a result already replaced by the mod is no candidate
      if (text.startsWith(MARK)) continue
      const alias = aliases.get(id)
      const tool = rows.flatMap(r => r.toolUses).find(u => u.tool_use_id === id)?.tool
      out.push({ ...(alias ? { alias } : {}), row: Math.min(...at), chars: text.length, reproducible: tool !== undefined && REPRODUCIBLE_TOOLS.includes(tool) })
    } else out.push({ row: Math.min(...at), chars: at.reduce((n, i) => n + rowChars(rows[i]!), 0), reproducible: false })
  }
  return out.sort((a, b) => b.chars - a.chars || a.row - b.row)
}

// [SP_CTX_02_37] Proposal: the batch of all candidates as one apply.
export type Proposal = {
  channel: 'size' | 'turn'
  // the open stage, which the turn channel proposes to close
  stage?: string
  named: string[]
  more: number
  freed: number
  conversation: number
  // [SP_CTX_02_38] by default (no "keep_cache") an apply rewrites the whole
  // conversation: `cost` is that; `positions` still says how deep the earliest is
  cost: CacheCost
  rStar: number
  rHat: number
  verdict: Verdict
  // [SP_CTX_DEC_22] the same batch with "keep_cache": true, when the earliest
  // would be within the lookback at the end of the turn and that makes the
  // verdict better; the size channel only
  keep?: { cost: CacheCost; rStar: number; verdict: Verdict }
}

const RANK: Record<Verdict, number> = { 'not-yet': 0, borderline: 1, worth: 2 }

// [SP_CTX_02_37] What Propose reads besides the rows and the candidates.
export type ProposeContext = {
  ratio: number
  conversation: number
  // the last request's tokens; absent: the conversation
  request?: number
  channel: Proposal['channel']
  stage?: string
  ratios?: CostRatios
  api?: readonly unknown[]
}

// [SP_CTX_02_37] Propose(rows, cands, ctx): what the batch frees (each
// candidate less its summary), the cache it costs ([SP_CTX_02_38]) and the
// break-even against the requests so far. By default an apply rebuilds the
// stretch and drops every own call, so it rewrites the whole conversation;
// only "keep_cache" ([SP_CTX_DEC_22]) keeps the cache up to the earliest
// candidate's response, and only when that is within the lookback at the end
// of the turn: the size channel adds APPLY_MARGIN positions for the calls
// still to come, the turn channel proposes at the start of a turn, so it
// never counts on it. Pure.
export function propose(rows: readonly SessionMessage[], found: readonly Candidate[], ctx: ProposeContext): Proposal {
  let freed = 0
  let summary = 0
  for (const c of found) {
    const t = c.chars / ctx.ratio
    const s = summaryTokens(t, c.reproducible)
    freed += t - s
    summary += s
  }
  const first = found.length ? Math.min(...found.map(c => c.row)) : rows.length
  const ratios = ctx.ratios ?? costRatios(undefined)
  const request = ctx.request ?? ctx.conversation
  // the responses and positions of the rows, once for every estimate below
  const shape = cacheShape(rows, ctx.api)
  const rHat = requestsSoFar(shape)
  const cost = cacheCost(shape, first, freed, ctx.conversation, ctx.ratio, Infinity)
  const rStar = breakEven({ rewrite: cost.rewrite, freed, summary, request }, ratios)
  const verdict = verdictOf(rStar, rHat)
  let keep: Proposal['keep']
  if (ctx.channel === 'size') {
    const k = cacheCost(shape, first, freed, ctx.conversation, ctx.ratio, APPLY_MARGIN)
    const kStar = breakEven({ rewrite: k.rewrite, freed, summary, request }, ratios)
    const kVerdict = verdictOf(kStar, rHat)
    if (k.within && RANK[kVerdict] > RANK[verdict]) keep = { cost: k, rStar: kStar, verdict: kVerdict }
  }
  const named = found.flatMap(c => (c.alias ? [c.alias] : [])).slice(0, HINT_NAMES)
  return {
    channel: ctx.channel,
    ...(ctx.stage !== undefined ? { stage: ctx.stage } : {}),
    named,
    more: found.length - named.length,
    freed: Math.round(freed),
    conversation: ctx.conversation,
    cost,
    rStar,
    rHat,
    verdict,
    ...(keep ? { keep } : {}),
  }
}

function requestsText(n: number): string {
  return n >= 100_000 ? '100000+' : `${Math.round(n)}`
}

// [SP_CTX_02_37] SuggestionText: one line; the numbers in thousands as TelemetryText.
export function suggestionText(p: Proposal): string {
  const names = p.named.length ? `${p.named.join(', ')}${p.more ? ` +${p.more} more (see context_list)` : ''}` : `${p.more} candidates (see context_list)`
  const what = p.named.length ? `summarize ${names} by ref` : `compress ${names}`
  const pays = (rStar: number) => `pays back after ~${requestsText(rStar)} requests, this conversation has made ~${p.rHat}`
  const said = (v: Verdict) => (v === 'worth' ? 'worth it now' : 'borderline: worth it only if the work goes on that long')
  const gain = `~${tokensText(p.freed)} of the ~${tokensText(p.conversation)} conversation`
  if (p.keep) {
    const k = p.keep
    const without = `Without keep_cache: the whole conversation (~${tokensText(p.cost.rewrite)}), pays back after ~${requestsText(p.rStar)} → ${p.verdict === 'not-yet' ? 'not worth it yet' : said(p.verdict)}; with it, a later --resume may show earlier answers twice.`
    return `${SUGGESTION} ${what} in one context_edit with "keep_cache": true: frees ${gain}; that keeps the prompt cache up to the earliest and rewrites only the rows from it (~${tokensText(k.cost.rewrite)}) if you end the turn within a few calls (edits apply when it ends; the earliest is ~${k.cost.positions} positions back now, and past ~${CACHE_LOOKBACK} the API finds no cache); ${pays(k.rStar)} → ${said(k.verdict)}. ${without}`
  }
  const verb = p.verdict === 'not-yet' ? 'would rewrite' : 'rewrites'
  const whole = `${verb} the prompt cache of the whole conversation once (~${tokensText(p.cost.rewrite)})`
  const cache =
    p.channel === 'turn'
      ? `${whole}: edits queued now apply when this turn ends, beyond the ~${CACHE_LOOKBACK} positions the API looks back`
      : p.cost.positions + APPLY_MARGIN > CACHE_LOOKBACK
        ? `${whole}: its earliest row is ~${p.cost.positions} positions back, beyond the ~${CACHE_LOOKBACK} the API looks back`
        : whole
  if (p.verdict === 'not-yet')
    return `${SUGGESTION} not worth it yet: to ${what} would free ${gain} but ${cache}; ${pays(p.rStar)}. Batch more, or compress at the end of a stage.`
  const body = `frees ${gain}; ${cache}; ${pays(p.rStar)} → ${said(p.verdict)}`
  if (p.channel === 'size') return `${SUGGESTION} ${what} in one context_edit: ${body}.`
  const close = p.stage !== undefined ? `close stage "${p.stage}" with context_tag and ` : ''
  return `${SUGGESTION} before you go on: ${close}${what} in one context_edit? It ${body}. Your call: nothing runs unless you do it.`
}

// [SP_CTX_02_16] [SP_CTX_02_37] CallLines: the lines a finished call gets
// before the note reminders: the alias line, then the size channel's
// suggestion, a line of its own; a call without a mark gets neither. Pure.
export function callLines(marked: boolean, alias: string | undefined, hint: string | undefined): string[] {
  if (!marked) return []
  return [...(alias ? [aliasLine(alias)] : []), ...(hint ? [hint] : [])]
}

function sameState(a: HintState | undefined, b: HintState | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// The registry with `next` as its hint state, if its state is still `seen`.
export function withHint(read: Read<TagRegistry>, seen: HintState | undefined, next: HintState): TagRegistry | undefined {
  if (read.state !== 'ok' || !sameState(read.value.hint, seen)) return undefined
  return { ...read.value, hint: next }
}

export type HintOutcome =
  | 'none'
  | 'no-registry'
  | 'short-run'
  | 'no-size'
  | 'shrunk'
  | 'small'
  | 'throttled'
  | 'few-candidates'
  | 'small-conversation'
  | 'small-batch'
  | 'not-worth'
  | 'repeated'
  | 'expired'
  | 'busy'
  | 'not-claimed'
  | 'hint'

type Outcome = { outcome: HintOutcome; line?: string }

async function once(memo: HintMemo, work: () => Promise<Outcome>): Promise<Outcome> {
  if (memo.busy) return { outcome: 'busy' }
  memo.busy = true
  try {
    return await work()
  } finally {
    memo.busy = false
  }
}

// [SP_CTX_02_37] SoftHint, the size channel, after a marked output. The cheap
// gates first (registry, plain usage), the rows and the queue next, the
// breakdown last. `d`: the deadline of this call (Bounded). One check at a
// time: a call that comes while one runs gets no line.
export function softHint(io: HintIO, memo: HintMemo, d: Deadline = { expired: false, claimed: false }): Promise<Outcome> {
  return once(memo, () => sizeCheck(io, memo, d))
}

// [SP_CTX_02_37] TurnSuggestion, the turn channel, on the person's prompt
// between turns: after a run of HINT_RUN marked outputs since the last
// suggestion, without a size threshold; silent when the batch is not worth it
// yet and the conversation is under the size threshold.
export function turnSuggestion(io: HintIO, memo: HintMemo, d: Deadline = { expired: false, claimed: false }): Promise<Outcome> {
  return once(memo, () => turnCheck(io, memo, d))
}

// The registries and the run, or why there is no check.
async function registries(io: HintIO): Promise<{ reg: TagRegistry; aliases: AliasRegistry } | Outcome> {
  const tags = await io.readTags()
  const aliases = await io.readAliases()
  if (tags.state !== 'ok' || aliases.state === 'unreadable') return { outcome: 'no-registry' }
  if (!tags.value.tags.some(t => t.kind === 'review')) return { outcome: 'none' }
  return { reg: tags.value, aliases: aliases.value }
}

// The candidates, the rows they were found on.
async function batch(io: HintIO, reg: TagRegistry, aliases: AliasRegistry): Promise<{ rows: readonly SessionMessage[]; found: Candidate[] }> {
  const rows = await io.rows()
  const q = await io.readQueue()
  const queued = q.state === 'unreadable' ? [] : q.value.edits
  return { rows, found: candidates(rows, reg, queued, aliasesById(aliases)) }
}

// [SP_CTX_02_38] The API form and the cost ratios of the model, once the
// batch is worth a look; a failed read leaves the rows alone, the default ratios.
async function costContext(io: HintIO): Promise<{ api: readonly unknown[]; ratios: CostRatios }> {
  const api = io.api ? await io.api().catch((): readonly unknown[] => []) : []
  const model = io.model ? await io.model().catch(() => undefined) : undefined
  return { api, ratios: costRatios(model) }
}

// The conversation by the breakdown (the Messages row), else by the rows; the ratio.
async function measure(io: HintIO, rows: readonly SessionMessage[], reg: TagRegistry): Promise<{ conversation: number; ratio: number }> {
  // [SP_CTX_02_28] the Messages row; lastApply stays for the agent's own telemetry
  const t = await telemetry(rows, dropLastApply(reg), io.usage, inBackground(io.updateTags))
  const ratio = t.ratio ?? reg.charsPerToken ?? PLAIN_RATIO
  return { conversation: t.measure === 'messages' ? t.conversation! : Math.round(totalChars(rows) / ratio), ratio }
}

// [SP_CTX_02_34] A calibration the hint does not wait for: queued on the
// registry chain, its failure dropped.
function inBackground(update: RegistryUpdate | undefined): RegistryUpdate | undefined {
  if (!update) return undefined
  return change => {
    void update(change).catch(() => undefined)
    return Promise.resolve()
  }
}

// A rough sum of what the candidates free, before the breakdown is read.
function roughFreed(found: readonly Candidate[], ratio: number): number {
  return found.reduce((n, c) => n + c.chars / ratio - summaryTokens(c.chars / ratio, c.reproducible), 0)
}

// The claim of a line on the registry chain, compare-and-set; none once the deadline expired.
async function claim(io: HintIO, seen: HintState | undefined, next: HintState, d: Deadline): Promise<'claimed' | 'late' | 'taken'> {
  let late = false
  const written = await io
    .changeTags(read => {
      if (d.expired) {
        late = true
        return undefined
      }
      const out = withHint(read, seen, next)
      if (out) d.claimed = true
      return out
    })
    .catch(() => false)
  return late ? 'late' : written ? 'claimed' : 'taken'
}

async function sizeCheck(io: HintIO, memo: HintMemo, d: Deadline): Promise<Outcome> {
  const got = await registries(io)
  if ('outcome' in got) return got
  const { reg, aliases } = got
  const state = reg.hint
  const next = aliases.next
  const req = await io.request()
  const tokens = req.tokens
  // a context smaller than at the last suggestion: an apply, a compaction or
  // a handoff came between; counting starts again from here
  if (state?.tokens !== undefined && tokens !== undefined && tokens < state.tokens) {
    memo.checked = undefined
    void io.changeTags(read => withHint(read, state, { tokens, marks: next })).catch(() => undefined)
    return { outcome: 'shrunk' }
  }
  if (tokens === undefined) return { outcome: 'no-size' }
  const threshold = sizeThreshold(req.window)
  // the request holds the fixed part: a request below the threshold means a smaller conversation
  if (tokens < threshold || tokens - (state?.tokens ?? 0) < stepThreshold(req.window)) return { outcome: 'small' }
  if (memo.checked !== undefined && tokens >= memo.checked && tokens - memo.checked < HINT_RECHECK) return { outcome: 'throttled' }
  // a check that found nothing, or came too late, waits HINT_RECHECK of growth
  const settle = (outcome: HintOutcome): Outcome => {
    memo.checked = tokens
    return { outcome }
  }
  const { rows, found } = await batch(io, reg, aliases)
  if (roughFreed(found, reg.charsPerToken ?? PLAIN_RATIO) < HINT_CANDIDATES) return settle('few-candidates')
  const { conversation, ratio } = await measure(io, rows, reg)
  if (conversation < threshold) return settle('small-conversation')
  const p = propose(rows, found, { ratio, conversation, request: tokens, channel: 'size', ...(await costContext(io)) })
  if (p.freed < Math.max(HINT_CANDIDATES, HINT_BATCH * conversation)) return settle('small-batch')
  const line = suggestionText(p)
  if (d.expired) return settle('expired')
  const got2 = await claim(io, state, { tokens, marks: next, proposed: p.freed }, d)
  if (got2 === 'late') return settle('expired')
  if (got2 === 'taken') return { outcome: 'not-claimed' }
  memo.checked = undefined
  return { outcome: 'hint', line }
}

async function turnCheck(io: HintIO, memo: HintMemo, d: Deadline): Promise<Outcome> {
  const got = await registries(io)
  if ('outcome' in got) return got
  const { reg, aliases } = got
  const state = reg.hint
  const next = aliases.next
  if (next - (state?.marks ?? 1) < HINT_RUN) return { outcome: 'short-run' }
  // a check that proposes nothing consumes the run: the next turn needs a new one
  const settle = (outcome: HintOutcome): Outcome => {
    const keep = { ...(state?.tokens !== undefined ? { tokens: state.tokens } : {}), ...(state?.proposed !== undefined ? { proposed: state.proposed } : {}) }
    void io.changeTags(read => withHint(read, state, { ...keep, marks: next })).catch(() => undefined)
    return { outcome }
  }
  const { rows, found } = await batch(io, reg, aliases)
  if (roughFreed(found, reg.charsPerToken ?? PLAIN_RATIO) < HINT_CANDIDATES) return settle('few-candidates')
  const { conversation, ratio } = await measure(io, rows, reg)
  const req = await io.request()
  const ctx = { ratio, conversation, ...(req.tokens !== undefined ? { request: req.tokens } : {}), channel: 'turn' as const, ...(reg.stage ? { stage: reg.stage.name } : {}) }
  const p = propose(rows, found, { ...ctx, ...(await costContext(io)) })
  if (p.freed < Math.max(HINT_CANDIDATES, HINT_BATCH * conversation)) return settle('small-batch')
  // the batch the agent was offered and left: again only once it grew by a
  // batch of its own; a smaller context (an apply between) starts over
  const shrunk = state?.tokens !== undefined && req.tokens !== undefined && req.tokens < state.tokens
  if (!shrunk && state?.proposed !== undefined && p.freed - state.proposed < Math.max(HINT_CANDIDATES, HINT_BATCH * conversation)) return settle('repeated')
  // not worth it in a conversation under the size threshold: nothing worth saying
  if (p.verdict === 'not-yet' && conversation < sizeThreshold(req.window)) return settle('not-worth')
  const line = suggestionText(p)
  if (d.expired) return settle('expired')
  const got2 = await claim(io, state, { ...(req.tokens !== undefined ? { tokens: req.tokens } : {}), marks: next, proposed: p.freed }, d)
  if (got2 === 'late') return settle('expired')
  if (got2 === 'taken') return { outcome: 'not-claimed' }
  memo.checked = undefined
  return { outcome: 'hint', line }
}

// [SP_CTX_02_37] Bounded: the line, or nothing once `sleep` ends first; a
// claim already made is waited for, so a written state always has its line.
export function bounded(work: (d: Deadline) => Promise<string | undefined>, sleep: () => Promise<unknown>): Promise<string | undefined> {
  const d: Deadline = { expired: false, claimed: false }
  const main = work(d).catch(() => undefined)
  const late = sleep().then(() => {
    if (d.claimed) return main
    d.expired = true
    return undefined
  })
  return Promise.race([main, late])
}
