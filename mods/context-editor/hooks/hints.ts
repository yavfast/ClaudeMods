// [SP_CTX_02_37] [C_CTX_DEC_15] SoftHint: one factual line after a big or
// search output once the context has grown, or after the first write that
// follows a run of such outputs. It names the earlier outputs not compressed
// yet, with their sizes, and never queues, closes or optimizes anything: the
// decision stays the agent's. Pure logic behind a small port; register.ts
// binds it to `$` and merges the line into the alias line ([SP_CTX_02_16]).
import type { SessionMessage } from 'claude-code'
import { aliasesById, aliasLine, type AliasRegistry } from './aliases'
import { MARK, rowChars, totalChars, touchedBy, type QueuedEdit } from './edits'
import type { Queue, Read } from './queue'
import { telemetry, tokensText, type RegistryUpdate, type UsageInfo } from './stages'
import { dropLastApply, isActive, resolveTarget, type HintState, type TagRegistry } from './tags'

// ---- [SP_CTX_01_12] constants

// tokens of the conversation (the breakdown's Messages row) the size trigger needs
export const HINT_CONVERSATION = 50_000
// tokens of the candidates not compressed yet that either trigger needs
export const HINT_CANDIDATES = 15_000
// growth of the context, in tokens, since the last hint before the next size hint
export const HINT_STEP = 50_000
// marked outputs (aliases given) since the last hint before a write counts as a stage boundary
export const HINT_RUN = 5
// candidates the line names, largest first
export const HINT_NAMES = 6
// growth, in tokens, before a size check that found too few candidates runs again
export const HINT_RECHECK = 5_000
// how long the result waits for the hint
export const HINT_WAIT_MS = 500
// chars per token without a calibration ([SP_CTX_02_34])
const PLAIN_RATIO = 4

// What triggered the check: a marked output (big or search) or a write
// without error (WRITE_TOOLS, [SP_CTX_02_16]); `alias` of this call, if it got one.
export type HintCall = { kind: 'output' | 'write'; alias?: string }

// [SP_CTX_02_37] Module memory: the request size of the last size check that
// read the rows and found no hint; a reload only costs one more check.
// `busy`: a check runs now ([SP_CTX_02_37]: one at a time).
export type HintMemo = { checked?: number; busy?: boolean }

export function newHintMemo(): HintMemo {
  return {}
}

// The deadline of one hint: once `expired`, no claim writes; once `claimed`,
// the result waits for the line.
export type Deadline = { expired: boolean; claimed: boolean }

export type HintIO = {
  readTags: () => Promise<Read<TagRegistry>>
  readAliases: () => Promise<Read<AliasRegistry>>
  readQueue: () => Promise<Read<Queue>>
  // CurrentRows ([SP_CTX_02_18])
  rows: () => Promise<readonly SessionMessage[]>
  // the plain usage (1–3 ms): the last request with the fixed part, and the window
  request: () => Promise<{ tokens?: number; window?: number }>
  // the usage with the breakdown (23–87 ms), only for the size trigger
  usage: () => Promise<UsageInfo>
  // a new calibration, in the background ([SP_CTX_02_34])
  updateRegistry?: RegistryUpdate
  // on the registry chain: `change` sees the registry as read then; undefined
  // writes nothing; resolves true when written
  updateTags: (change: (read: Read<TagRegistry>) => TagRegistry | undefined) => Promise<boolean>
}

// One candidate: an active review tag whose target is in the conversation and
// no queued edit touches; `row`: its first row; `chars`: the result's text
// (a pair) or the row's size.
export type Candidate = { alias?: string; row: number; chars: number }

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
      const text = rows.flatMap(r => r.toolResults ?? []).find(t => t.tool_use_id === id)?.text ?? ''
      // a result already replaced by the mod is no candidate
      if (text.startsWith(MARK)) continue
      const alias = aliases.get(id)
      out.push({ ...(alias ? { alias } : {}), row: Math.min(...at), chars: text.length })
    } else out.push({ row: Math.min(...at), chars: at.reduce((n, i) => n + rowChars(rows[i]!), 0) })
  }
  return out.sort((a, b) => b.chars - a.chars || a.row - b.row)
}

function tokensOf(chars: number, ratio: number): number {
  return Math.round(chars / ratio)
}

// [SP_CTX_02_37] HintText: one line, parts joined by " · ".
export type HintFacts = {
  call: HintCall
  run?: number
  tokens?: number
  window?: number
  conversation?: number
  named: { alias: string; tokens: number }[]
  more: number
  total: number
  recache: number
}

export function hintText(f: HintFacts): string {
  const parts: string[] = []
  if (f.call.kind === 'write') parts.push(`first write after ${f.run} big or search outputs`)
  if (f.tokens !== undefined) {
    const share = f.window ? Math.round((f.tokens / f.window) * 100) : undefined
    const window = f.window ? `, ${share! < 1 ? '<1' : share}% of the ${tokensText(f.window)} window` : ''
    const conv = f.conversation !== undefined ? ` (conversation ~${tokensText(f.conversation)})` : ''
    parts.push(`context ~${tokensText(f.tokens)} tokens${window}${conv}`)
  }
  const names = f.named.map(n => `${n.alias} ~${tokensText(n.tokens)}`)
  if (f.more) names.push(names.length ? `+${f.more} more (see context_list)` : `${f.more} (see context_list)`)
  parts.push(`earlier outputs not compressed yet: ${names.join(', ')} (~${tokensText(f.total)} in all; an edit rebuilds the prompt cache from the earliest: up to ~${tokensText(f.recache)})`)
  parts.push('if you have used them, summarize them by ref with context_edit, or close the stage with context_tag')
  return `${MARK}${f.call.alias ? ` id ${f.call.alias}` : ''} · ${parts.join(' · ')}`
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
  | 'expired'
  | 'busy'
  | 'not-claimed'
  | 'hint'

// [SP_CTX_02_37] HintCall: a write without error (WRITE_TOOLS with a path,
// [SP_CTX_02_16]) is the boundary trigger, with its alias if it got one; else
// a marked output (big or search: a failed write with a big output too); else none. Pure.
export function hintCall(marked: boolean, write: boolean, alias?: string): HintCall | undefined {
  const id = alias ? { alias } : {}
  if (write) return { kind: 'write', ...id }
  return marked ? { kind: 'output', ...id } : undefined
}

// [SP_CTX_02_16] [SP_CTX_02_37] The one line of the call: the hint, which
// starts with the alias, else the bare alias line, else none. Pure.
export function pickLine(hint: string | undefined, alias: string | undefined): string | undefined {
  return hint ?? (alias ? aliasLine(alias) : undefined)
}

// [SP_CTX_02_37] SoftHint. The cheap gates first (registry, alias count,
// plain usage), the rows and the queue next, the breakdown last and only for
// the size trigger. `d`: the deadline of this call ([SP_CTX_02_37], Bounded).
// One check at a time: a call that comes while one runs gets no line.
export async function softHint(io: HintIO, memo: HintMemo, call: HintCall, d: Deadline = { expired: false, claimed: false }): Promise<{ outcome: HintOutcome; line?: string }> {
  if (memo.busy) return { outcome: 'busy' }
  memo.busy = true
  try {
    return await check(io, memo, call, d)
  } finally {
    memo.busy = false
  }
}

async function check(io: HintIO, memo: HintMemo, call: HintCall, d: Deadline): Promise<{ outcome: HintOutcome; line?: string }> {
  const tags = await io.readTags()
  const aliases = await io.readAliases()
  if (tags.state !== 'ok' || aliases.state === 'unreadable') return { outcome: 'no-registry' }
  const reg = tags.value
  let state = reg.hint
  const next = aliases.value.next
  const run = next - (state?.marks ?? 1)
  if (!reg.tags.some(t => t.kind === 'review')) return { outcome: 'none' }
  if (call.kind === 'write' && run < HINT_RUN) return { outcome: 'short-run' }
  const req = await io.request()
  const tokens = req.tokens
  // a context smaller than at the last hint: an apply, a compaction or a
  // handoff came between; counting starts again from here. A write keeps its
  // run (the outputs before the apply) and goes on from the new size.
  if (state?.tokens !== undefined && tokens !== undefined && tokens < state.tokens) {
    memo.checked = undefined
    if (call.kind === 'output') {
      void io.updateTags(read => withHint(read, state, { tokens, marks: next })).catch(() => undefined)
      return { outcome: 'shrunk' }
    }
    const reset: HintState = { tokens, marks: state.marks }
    const seen = state
    if (!(await io.updateTags(read => withHint(read, seen, reset)).catch(() => false))) return { outcome: 'not-claimed' }
    state = reset
  }
  if (call.kind === 'output') {
    if (tokens === undefined) return { outcome: 'no-size' }
    // the request holds the fixed part: a request below the threshold means a smaller conversation
    if (tokens < HINT_CONVERSATION || tokens - (state?.tokens ?? 0) < HINT_STEP) return { outcome: 'small' }
    if (memo.checked !== undefined && tokens >= memo.checked && tokens - memo.checked < HINT_RECHECK) return { outcome: 'throttled' }
  }
  const seen = state
  // a check that found nothing, or came too late: an output waits HINT_RECHECK
  // of growth; a write consumes the run (only the first write after it counts)
  const settle = (outcome: HintOutcome): { outcome: HintOutcome } => {
    if (call.kind === 'output') memo.checked = tokens
    else void io.updateTags(read => withHint(read, seen, { ...(seen?.tokens !== undefined ? { tokens: seen.tokens } : {}), marks: next })).catch(() => undefined)
    return { outcome }
  }
  const rows = await io.rows()
  const q = await io.readQueue()
  const queued = q.state === 'unreadable' ? [] : q.value.edits
  const found = candidates(rows, reg, queued, aliasesById(aliases.value))
  const chars = found.reduce((n, c) => n + c.chars, 0)
  let ratio = reg.charsPerToken ?? PLAIN_RATIO
  const few = () => tokensOf(chars, ratio) < HINT_CANDIDATES
  if (few()) return settle('few-candidates')
  let conversation: number | undefined
  if (call.kind === 'output') {
    // [SP_CTX_02_28] the Messages row; lastApply stays for the agent's own telemetry
    const t = await telemetry(rows, dropLastApply(reg), io.usage, io.updateRegistry)
    ratio = t.ratio ?? ratio
    conversation = t.measure === 'messages' ? t.conversation : tokensOf(totalChars(rows), ratio)
    if ((conversation ?? 0) < HINT_CONVERSATION) return settle('small-conversation')
    if (few()) return settle('few-candidates')
  }
  const named = found.filter(c => c.alias).slice(0, HINT_NAMES)
  const first = Math.min(...found.map(c => c.row))
  const line = hintText({
    call,
    run,
    ...(tokens !== undefined ? { tokens } : {}),
    ...(req.window ? { window: req.window } : {}),
    ...(conversation !== undefined ? { conversation } : {}),
    named: named.map(c => ({ alias: c.alias!, tokens: tokensOf(c.chars, ratio) })),
    more: found.length - named.length,
    total: tokensOf(chars, ratio),
    recache: tokensOf(rows.slice(first).reduce((n, r) => n + rowChars(r), 0), ratio),
  })
  if (d.expired) return settle('expired')
  let late = false
  const written = await io
    .updateTags(read => {
      if (d.expired) {
        late = true
        return undefined
      }
      const out = withHint(read, seen, { ...(tokens !== undefined ? { tokens } : {}), marks: next })
      if (out) d.claimed = true
      return out
    })
    .catch(() => false)
  if (late) return settle('expired')
  if (!written) return { outcome: 'not-claimed' }
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
