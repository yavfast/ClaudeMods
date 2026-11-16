import { expect, test } from 'claude-code/testing'
import {
  CACHE_TTL_MS,
  checkEntry,
  checksLine,
  clockAfter,
  clockLine,
  coldVerdict,
  confirmCheck,
  confirmed,
  EMPTY_CLOCK,
  isCacheClock,
  lastRequest,
  memoryAt,
  newClockMemory,
  temperature,
  startCheck,
  tick,
  type CacheClock,
  type ConfirmIO,
} from '../hooks/cacheclock'
import { journalSummary, parseJournal } from '../hooks/journal'
import { parseRegistry } from '../hooks/tags'
import { telemetryText, type Telemetry } from '../hooks/stages'

const MIN = 60_000
const T0 = 1_000_000_000

// [SP_HELP_01_07] Temperature
test('Temperature — unknown without a request; warm up to CACHE_TTL_MS; cold past it', () => {
  expect(temperature(null, T0)).toBe('unknown')
  expect(temperature(T0, T0 + CACHE_TTL_MS)).toBe('warm')
  expect(temperature(T0, T0 + CACHE_TTL_MS + 1)).toBe('cold')
})

// [SP_HELP_02_09] The memory by session; the later of the memory and the registry
test('ClockMemory — per session; a later step only raises it; LastRequest takes the later of memory and registry', () => {
  const mem = newClockMemory()
  expect(memoryAt(mem, 's1')).toBeUndefined()
  tick(mem, 's1', T0 + 5)
  tick(mem, 's1', T0 + 3)
  expect(memoryAt(mem, 's1')).toBe(T0 + 5)
  expect(memoryAt(mem, 's2')).toBeUndefined()
  tick(mem, 's2', T0 + 1)
  expect(memoryAt(mem, 's1')).toBeUndefined()
  expect(memoryAt(mem, 's2')).toBe(T0 + 1)
  expect(lastRequest(undefined, undefined)).toBeNull()
  expect(lastRequest({ ...EMPTY_CLOCK, lastRequestAt: T0 + 9 }, T0 + 1)).toBe(T0 + 9)
  expect(lastRequest({ ...EMPTY_CLOCK, lastRequestAt: T0 }, T0 + 1)).toBe(T0 + 1)
  expect(lastRequest(undefined, T0 + 2)).toBe(T0 + 2)
})

// [SP_HELP_05_01] CacheClock: the turn's step and the registry at the turn's end
test('CacheClock — крок ходу: an interrupted step after an idle updates the memory; the telemetry mid-turn is warm; the registry gets it at the turn end', () => {
  const mem = newClockMemory()
  const reg: CacheClock = { lastRequestAt: T0, coldAt: null, check: false }
  // the step of an interrupted turn, 70 min later
  tick(mem, 's', T0 + 70 * MIN)
  expect(clockLine(lastRequest(reg, memoryAt(mem, 's')), T0 + 70 * MIN + 30_000)).toBe('Cache clock: warm — the last request was 0 min ago; cold in ~60 min.')
  // the registry still holds the old time until the turn ends
  expect(clockLine(reg.lastRequestAt, T0 + 70 * MIN)).toBe('Cache clock: cold — idle for 1 h 10 min; an apply now rewrites nothing still cached.')
  expect(clockAfter(reg, memoryAt(mem, 's'))).toEqual({ lastRequestAt: T0 + 70 * MIN, coldAt: null, check: false })
  // nothing newer in memory: nothing to write
  expect(clockAfter({ ...reg, lastRequestAt: T0 + 70 * MIN }, memoryAt(mem, 's'))).toBeUndefined()
  expect(clockAfter(reg, undefined)).toBeUndefined()
  // a registry that never had a clock
  expect(clockAfter(undefined, T0)).toEqual({ lastRequestAt: T0, coldAt: null, check: false })
})

// [SP_HELP_05_01] CacheClock: the verdict once per idle (I9)
test('CacheClock — вердикт один раз: idle 70 min, the idle verdict first, then the prompt takes none; a new idle takes one again', () => {
  const reg: CacheClock = { lastRequestAt: T0, coldAt: null, check: false }
  // warm: no verdict
  expect(coldVerdict(reg, undefined, T0 + 59 * MIN)).toBeUndefined()
  // unknown: no verdict
  expect(coldVerdict(undefined, undefined, T0)).toBeUndefined()
  // the idle timer (phase 5) at 61 min
  const v = coldVerdict(reg, undefined, T0 + 61 * MIN)
  expect(v).toEqual({ lastRequestAt: T0, coldAt: T0 + 61 * MIN, check: true })
  // the prompt at 70 min: the verdict of this idle is taken
  expect(coldVerdict(v, undefined, T0 + 70 * MIN)).toBeUndefined()
  // a newer request in the memory, then another idle: a new verdict
  const after = confirmed(v, T0 + 70 * MIN)!
  expect(after).toEqual({ lastRequestAt: T0 + 70 * MIN, coldAt: T0 + 61 * MIN, check: false })
  expect(coldVerdict(after, undefined, T0 + 140 * MIN)).toEqual({ lastRequestAt: T0 + 70 * MIN, coldAt: T0 + 140 * MIN, check: true })
  // the memory's later step makes the cache warm again
  expect(coldVerdict(reg, T0 + 30 * MIN, T0 + 61 * MIN)).toBeUndefined()
})

// [SP_HELP_05_01] CacheClock: the check by the first step
test('CacheClock — підтвердження: read beyond the fixed part covers 80 % of the rows → mismatch; no breakdown → null', () => {
  // input 100k: fixed 20k, messages 80k; read 20k + 64k = 84k
  const warm = checkEntry(T0, T0 + 70 * MIN, { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 84_000, cache_creation_input_tokens: 15_000 }, 80_000, T0 + 71 * MIN)
  expect(warm).toEqual({ kind: 'cache', at: T0 + 71 * MIN, idle: 70 * MIN, read: 84_000, written: 15_000, input: 100_000, messages: 80_000, mismatch: true })
  // a cold cache: only the fixed part read from a shared cache
  const cold = checkEntry(T0, T0 + 70 * MIN, { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 79_000 }, 80_000, T0 + 71 * MIN)
  expect(cold.mismatch).toBe(false)
  const none = checkEntry(T0, T0 + 70 * MIN, { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 84_000, cache_creation_input_tokens: 15_000 }, null, T0 + 71 * MIN)
  expect(none.messages).toBeNull()
  expect(none.mismatch).toBeNull()
  // no verdict waits: nothing to confirm
  expect(confirmed({ lastRequestAt: T0, coldAt: null, check: false }, T0 + 1)).toBeUndefined()
  expect(confirmed(undefined, T0)).toBeUndefined()
})

// [SP_HELP_02_13] The lines
test('Телеметрія — годинник: warm, cold, unknown; the checks line', () => {
  expect(clockLine(null, T0)).toBe('Cache clock: unknown — no request seen in this session yet.')
  expect(clockLine(T0, T0 + 12 * MIN + 5000)).toBe('Cache clock: warm — the last request was 12 min ago; cold in ~48 min.')
  expect(clockLine(T0, T0 + 3 * 60 * MIN + 7 * MIN)).toBe('Cache clock: cold — idle for 3 h 7 min; an apply now rewrites nothing still cached.')
  expect(checksLine({ count: 2, mismatched: 1 })).toBe('Cache clock checks: 2, mismatched 1.')
})

// [SP_HELP_01_07] [SP_HELP_01_08] The stored forms
test('CacheClock — сховище: the registry field and the journal entry are checked; a bad one makes the file unreadable', () => {
  expect(isCacheClock(EMPTY_CLOCK)).toBe(true)
  expect(isCacheClock({ lastRequestAt: 1.5, coldAt: null, check: false })).toBe(false)
  const ok = parseRegistry(JSON.stringify({ tags: [], turn: 0, firstPromptPinned: false, introduced: false, notes: [], nextNote: 1, cache: { lastRequestAt: T0, coldAt: null, check: true } }))
  expect(ok.state === 'ok' && ok.value.cache).toEqual({ lastRequestAt: T0, coldAt: null, check: true })
  const bad = parseRegistry(JSON.stringify({ tags: [], turn: 0, firstPromptPinned: false, introduced: false, notes: [], nextNote: 1, cache: { lastRequestAt: T0 } }))
  expect(bad).toEqual({ state: 'unreadable', reason: 'bad field(s): cache' })
  const entry = checkEntry(T0, T0 + 70 * MIN, { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 }, 5, T0 + 71 * MIN)
  const j = parseJournal(JSON.stringify({ entries: [entry, { ...entry, mismatch: true }] }))
  expect(j.state).toBe('ok')
  expect(journalSummary(j)).toEqual({ applications: 0, rereads: 0, archiveRereads: 0, checks: { count: 2, mismatched: 1 } })
  expect(parseJournal(JSON.stringify({ entries: [{ ...entry, idle: -1 }] })).state).toBe('unreadable')
})

// [SP_HELP_02_13] The order of the lines after the Cache line: the clock, the helper, the checks
test('Телеметрія — порядок: Cache clock, then Helper, then Cache clock checks; no clock line without a clock', () => {
  const t: Telemetry = { measure: 'unknown', autoCompactOff: false, registry: false, regions: [], reviews: new Map(), disposable: 0, state: 'none', notes: { count: 0, reminders: 0 } }
  const journal = { applications: 0, rereads: 0, archiveRereads: 0, helper: { questions: 1, calls: 1, in: 400, out: 90, verified: 1, rejected: 0 }, checks: { count: 1, mismatched: 0 } }
  const lines = telemetryText({ ...t, journal, clock: { last: T0, now: T0 + 5 * MIN } }).split('\n')
  const at = (head: string) => lines.findIndex(l => l.startsWith(head))
  expect(at('Cache clock: warm')).toBeGreaterThan(0)
  expect(at('Helper:')).toBe(at('Cache clock: warm') + 1)
  expect(lines[at('Helper:') + 1]).toBe('Cache clock checks: 1, mismatched 0.')
  expect(telemetryText(t)).not.toContain('Cache clock')
})

// [SP_HELP_02_09] ConfirmCheck over fake ports
function confirmHarness(clock: CacheClock | undefined, over: Partial<ConfirmIO> = {}) {
  const log = { clock, entries: [] as unknown[], updates: 0 }
  const io: ConfirmIO = {
    probe: async () => false,
    storage: async () => '/s',
    read: async () => log.clock,
    messages: async () => 80_000,
    update: async (_dir, change) => {
      const next = change(log.clock)
      if (!next) return false
      log.updates++
      log.clock = next
      return true
    },
    journal: (_dir, entry) => void log.entries.push(entry),
    ...over,
  }
  return { io, log }
}
const USAGE = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 79_000 }
const step = (prev: number | null | undefined) => ({ prev, started: T0 + 70 * MIN, ended: T0 + 71 * MIN, usage: USAGE })

test('ConfirmCheck — гілки: no verdict waits → nothing; a verdict → one entry, check off; no breakdown → messages null; ProbeMode → nothing', async () => {
  const off = confirmHarness({ lastRequestAt: T0, coldAt: null, check: false })
  expect(await confirmCheck(off.io, step(T0))).toBeUndefined()
  expect(off.log.updates).toBe(0)
  expect(off.log.entries).toEqual([])
  const on = confirmHarness({ lastRequestAt: T0, coldAt: T0 + 61 * MIN, check: true })
  const e = await confirmCheck(on.io, step(T0))
  expect(e).toEqual({ kind: 'cache', at: T0 + 71 * MIN, idle: 70 * MIN, read: 20_000, written: 79_000, input: 100_000, messages: 80_000, mismatch: false })
  expect(on.log.entries).toEqual([e])
  expect(on.log.clock).toEqual({ lastRequestAt: T0 + 71 * MIN, coldAt: T0 + 61 * MIN, check: false })
  const bare = confirmHarness({ lastRequestAt: T0, coldAt: T0 + 61 * MIN, check: true }, { messages: async () => null })
  expect((await confirmCheck(bare.io, step(T0)))!.mismatch).toBeNull()
  const probe = confirmHarness({ lastRequestAt: T0, coldAt: T0 + 61 * MIN, check: true }, { probe: async () => true })
  expect(await confirmCheck(probe.io, step(T0))).toBeUndefined()
  expect(probe.log.updates).toBe(0)
})

test('ConfirmCheck — запис не змінив нічого: another check took the verdict on the chain first; no journal entry', async () => {
  const h = confirmHarness({ lastRequestAt: T0, coldAt: T0 + 61 * MIN, check: true })
  // the registry read saw `check`, but by the Update another writer cleared it
  h.io.update = async (_dir, change) => change({ lastRequestAt: T0 + 71 * MIN, coldAt: T0 + 61 * MIN, check: false }) !== undefined
  expect(await confirmCheck(h.io, step(T0))).toBeUndefined()
  expect(h.log.entries).toEqual([])
})

test('ConfirmCheck — останній запит до кроку: the step\'s own prev wins; without it a registry time from the step on is ignored; a step within the TTL of the last request has no mismatch', async () => {
  // the turn end already wrote this step's end: its time is no request before the step
  const late = confirmHarness({ lastRequestAt: T0 + 71 * MIN, coldAt: T0 + 61 * MIN, check: true })
  expect((await confirmCheck(late.io, step(undefined)))!.idle).toBe(0)
  const known = confirmHarness({ lastRequestAt: T0 + 71 * MIN, coldAt: T0 + 61 * MIN, check: true })
  expect((await confirmCheck(known.io, step(T0)))!.idle).toBe(70 * MIN)
  // an aborted step without usage came after the verdict: 1 min before this step
  const after = confirmHarness({ lastRequestAt: T0 + 69 * MIN, coldAt: T0 + 61 * MIN, check: true })
  const e = (await confirmCheck(after.io, step(T0 + 69 * MIN)))!
  expect(e.idle).toBe(MIN)
  expect(e.mismatch).toBeNull()
})

test('StartCheck — захоплення: a second step while the first one\'s check runs takes none; once it ended, the next can', async () => {
  const mem = newClockMemory()
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const h = confirmHarness({ lastRequestAt: T0, coldAt: T0 + 61 * MIN, check: true }, { storage: async () => (await gate, '/s') })
  const first = startCheck(mem, h.io, step(T0))
  expect(first).toBeDefined()
  expect(startCheck(mem, h.io, { ...step(T0 + 71 * MIN), started: T0 + 72 * MIN })).toBeUndefined()
  release()
  expect((await first)!.idle).toBe(70 * MIN)
  expect(h.log.entries.length).toBe(1)
  expect(mem.checking).toBe(false)
  expect(startCheck(mem, h.io, step(T0))).toBeDefined()
})
