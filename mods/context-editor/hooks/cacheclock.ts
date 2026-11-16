// The cache clock of the main conversation ([SP_HELP_01_07], [SP_HELP_02_09],
// [SP_HELP_04_04]): when the last request on the conversation's prefix was
// made, whether the prompt cache is warm or cold by now, the cold verdict
// taken once per idle, and its check against the first request after it.
// Pure: register.ts keeps the module's memory and binds the registry writes
// to `$` on the registry's chain.
import { isCount } from './store'

// [SP_HELP_01_09] the main conversation's cache lifetime (calibration of the
// efficiency spike, Entry 2) and the share of the conversation's rows read
// from the cache above which a cold verdict was wrong
export const CACHE_TTL_MS = 3_600_000
export const COLD_MISMATCH = 0.5

// [SP_HELP_01_07] TagRegistry.cache
export type CacheClock = { lastRequestAt: number | null; coldAt: number | null; check: boolean }

export const EMPTY_CLOCK: CacheClock = { lastRequestAt: null, coldAt: null, check: false }

export function isCacheClock(v: unknown): v is CacheClock {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const c = v as Record<string, unknown>
  return (c.lastRequestAt === null || isCount(c.lastRequestAt, 0)) && (c.coldAt === null || isCount(c.coldAt, 0)) && typeof c.check === 'boolean'
}

// [SP_HELP_01_08] the journal's record of a check
export type CacheEntry = { kind: 'cache'; at: number; idle: number; read: number; written: number; input: number; messages: number | null; mismatch: boolean | null }

export function isCacheEntry(e: Record<string, unknown>): boolean {
  return (
    e.kind === 'cache' &&
    isCount(e.idle, 0) &&
    isCount(e.read, 0) &&
    isCount(e.written, 0) &&
    isCount(e.input, 0) &&
    (e.messages === null || isCount(e.messages, 0)) &&
    (e.mismatch === null || typeof e.mismatch === 'boolean')
  )
}

// [SP_HELP_02_09] The module's memory: the last step of the main conversation
// (or the mod's fork of it) in this process, by session. The registry gets it
// at the end of each turn; readers take the later of the two.
// `checking`: a step's check of a cold verdict runs (ConfirmCheck's claim).
export type ClockMemory = { session?: string; at?: number; checking?: boolean }

export function newClockMemory(): ClockMemory {
  return {}
}

// A request of `session` ended at `at`.
export function tick(mem: ClockMemory, session: string, at: number): void {
  if (mem.session === session && mem.at !== undefined && mem.at >= at) return
  mem.session = session
  mem.at = at
}

// The memory's time for `session`, if any.
export function memoryAt(mem: ClockMemory, session: string | undefined): number | undefined {
  return session !== undefined && mem.session === session ? mem.at : undefined
}

// [SP_HELP_02_09] The later of the registry's and the memory's time; null: none seen.
export function lastRequest(clock: CacheClock | undefined, memory: number | undefined): number | null {
  const stored = clock?.lastRequestAt ?? null
  if (memory === undefined) return stored
  return stored === null ? memory : Math.max(stored, memory)
}

// [SP_HELP_01_07] Temperature
export type Temperature = 'cold' | 'warm' | 'unknown'

export function temperature(last: number | null, now: number): Temperature {
  if (last === null) return 'unknown'
  return now - last > CACHE_TTL_MS ? 'cold' : 'warm'
}

// [SP_HELP_02_09] The registry's clock after a turn (or a fork) with the
// memory's time; undefined: nothing new to write.
export function clockAfter(clock: CacheClock | undefined, memory: number | undefined): CacheClock | undefined {
  if (memory === undefined) return undefined
  const c = clock ?? EMPTY_CLOCK
  if (c.lastRequestAt !== null && c.lastRequestAt >= memory) return undefined
  return { ...c, lastRequestAt: memory }
}

// [SP_HELP_02_09] ColdVerdict: the clock with the verdict taken (coldAt, check)
// when the cache is cold by `now` and no verdict was taken for this idle
// ([SP_HELP_01_07]: coldAt null or older than the last request); undefined
// otherwise. `memory`: the module's time for this session. The idle timer
// (phase 5) and the first prompt of the main conversation take it.
export function coldVerdict(clock: CacheClock | undefined, memory: number | undefined, now: number): CacheClock | undefined {
  const last = lastRequest(clock, memory)
  if (temperature(last, now) !== 'cold') return undefined
  const c = clock ?? EMPTY_CLOCK
  if (c.coldAt !== null && c.coldAt >= last!) return undefined
  return { lastRequestAt: last, coldAt: now, check: true }
}

// What a step's usage says, as the host reports it (ModelUsage).
export type StepUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// [SP_HELP_02_09] The check of a cold verdict by the first step after it:
// `prev` — the last request before the step, `started` — when the step began,
// `messages` — the conversation's rows without the fixed part (the breakdown's
// Messages row), null without a breakdown. Mismatch: the cache served more
// than the fixed part and half the conversation's rows; null when the step
// came within CACHE_TTL_MS of the last request (a step without usage came
// between the verdict and this one: nothing left to check) or none is known.
export function checkEntry(prev: number | null, started: number, usage: StepUsage, messages: number | null, at: number): CacheEntry {
  const read = usage.cache_read_input_tokens
  const written = usage.cache_creation_input_tokens
  const input = usage.input_tokens + written + read
  const idle = prev === null ? 0 : Math.max(0, started - prev)
  const mismatch = messages === null || prev === null || idle <= CACHE_TTL_MS ? null : read - (input - messages) > COLD_MISMATCH * messages
  return { kind: 'cache', at, idle, read, written, input, messages, mismatch }
}

// [SP_HELP_02_09] Confirm: the clock after the first step with `check`: the
// step's end as the last request, the check done. Undefined: no check waits.
export function confirmed(clock: CacheClock | undefined, at: number): CacheClock | undefined {
  if (!clock?.check) return undefined
  return { ...clock, lastRequestAt: Math.max(clock.lastRequestAt ?? 0, at), check: false }
}

// [SP_HELP_02_09] One step of the main conversation, as Confirm takes it:
// `prev` — the last request before the step, read at its start (the memory and
// the registry's view); undefined when the registry's view was not at hand.
export type Step = { prev: number | null | undefined; started: number; ended: number; usage: StepUsage }

// What ConfirmCheck needs from the host; register.ts binds it to `$`.
export type ConfirmIO = {
  // [SP_CTX_02_57] ProbeMode: no clock
  probe: () => Promise<boolean>
  // [SP_CTX_01_07] CONC-01: the folder once
  storage: () => Promise<string | undefined>
  // the registry's clock in `dir`; undefined: none, or the registry unreadable
  read: (dir: string) => Promise<CacheClock | undefined>
  // the breakdown's Messages row; null without one (a failed read too)
  messages: () => Promise<number | null>
  // the registry's Update on its chain, by the clock; true once written
  update: (dir: string, change: (clock: CacheClock | undefined) => CacheClock | undefined) => Promise<boolean>
  // the journal's entry, in the background on its chain
  journal: (dir: string, entry: CacheEntry) => void
}

// [SP_HELP_02_09] Confirm: with a cold verdict waiting, the step's entry and
// the clock with `check` off; the entry only once the registry took it. The
// entry, or undefined: nothing checked.
export async function confirmCheck(io: ConfirmIO, step: Step): Promise<CacheEntry | undefined> {
  if (await io.probe()) return undefined
  const dir = await io.storage()
  if (!dir) return undefined
  const clock = await io.read(dir)
  if (!clock?.check) return undefined
  // a registry time from this step on is the turn end's write of this very step
  const stored = clock.lastRequestAt !== null && clock.lastRequestAt < step.started ? clock.lastRequestAt : null
  const prev = step.prev !== undefined ? step.prev : stored
  const entry = checkEntry(prev, step.started, step.usage, await io.messages(), step.ended)
  if (!(await io.update(dir, c => confirmed(c, step.ended)))) return undefined
  io.journal(dir, entry)
  return entry
}

// [SP_HELP_02_09] The claim: the first step with usage that ends while no
// check runs takes it, synchronously, so a later step of the turn never
// checks with its own numbers. The running check, or undefined: claimed already.
export function startCheck(mem: ClockMemory, io: ConfirmIO, step: Step): Promise<CacheEntry | undefined> | undefined {
  if (mem.checking) return undefined
  mem.checking = true
  return confirmCheck(io, step).finally(() => {
    mem.checking = false
  })
}

// [SP_HELP_02_13] The Cache clock line of the telemetry.
export function clockLine(last: number | null, now: number): string {
  if (last === null) return 'Cache clock: unknown — no request seen in this session yet.'
  const idle = Math.max(0, now - last)
  if (idle > CACHE_TTL_MS) {
    const h = Math.floor(idle / 3_600_000)
    const m = Math.floor((idle % 3_600_000) / 60_000)
    return `Cache clock: cold — idle for ${h} h ${m} min; an apply now rewrites nothing still cached.`
  }
  const m = Math.floor(idle / 60_000)
  const r = Math.max(1, Math.ceil((CACHE_TTL_MS - idle) / 60_000))
  return `Cache clock: warm — the last request was ${m} min ago; cold in ~${r} min.`
}

// [SP_HELP_02_13] The journal's checks of the clock.
export type ClockChecks = { count: number; mismatched: number }

export function checksLine(c: ClockChecks): string {
  return `Cache clock checks: ${c.count}, mismatched ${c.mismatched}.`
}
