// [SP_HELP_02_08] WakeCheck and the recheck of a background question with
// `wake` (PL_HELP phase 8): the conditions, the one wake per idle, the
// prompt's text, the refused prompt, the recheck timer.
import { expect, test } from 'claude-code/testing'
import {
  armRecheck,
  claimBlock,
  MAX_DELIVERY,
  ownCompaction,
  errandAdd,
  restoreBlock,
  STALE_RUNNING_MS,
  STALE_TEXT,
  WAKE_RECHECK_MS,
  WAKE_SET,
  wakeWithRecheck,
  wakeCheck,
  newWakeMemory,
  type Errand,
  type ErrandIO,
  type WakeIO,
  type WakeMemory,
} from '../hooks/errands'
import { emptyFolds } from '../hooks/folds'
import { COMMAND_NOTE, EMPTY_QUEUE, type Queue } from '../hooks/queue'
import type { ClosedBlock } from '../hooks/stages'
import { WAKE_TEXT } from '../hooks/rows'
import type { Read } from '../hooks/store'
import type { TagRegistry } from '../hooks/tags'
import { newTurns, turnCompleted, turnStarted } from '../hooks/turns'
import { okRead, reg } from './row-fixtures'

function errand(n: number, extra: Partial<Errand> = {}): Errand {
  return { id: `e${n}`, when: { kind: 'turns', n: 1 }, action: { kind: 'remind', text: `text ${n}` }, wake: false, createdTurn: 0, state: 'open', ...extra }
}
const firedWake = (n = 1, at = 1) => errand(n, { wake: true, state: 'fired', firedAt: at, result: `R${n}` })
const runningWake = (n = 1, at = 1) =>
  errand(n, { wake: true, state: 'running', firedAt: at, action: { kind: 'ask', folds: ['f1'], question: 'what?' } })

type Timer = { ms: number; fn: () => void; cancelled: boolean }

function fake(r0: TagRegistry, opts: { queue?: Queue; last?: number | null; now?: number } = {}) {
  const state = {
    reg: r0,
    queue: opts.queue ?? { ...EMPTY_QUEUE },
    last: opts.last === undefined ? 500 : opts.last,
    now: opts.now ?? 1000,
    flush: false,
    compacting: false,
    drop: false,
    known: true,
    session: 's1',
  }
  const log = {
    submits: [] as string[],
    status: [] as string[],
    debug: [] as string[],
    timers: [] as Timer[],
    reads: 0,
    removed: [] as string[],
    advised: 0,
  }
  const turns = newTurns()
  turnStarted(turns)
  turnCompleted(turns, false)
  const mem: WakeMemory = newWakeMemory()
  const io: WakeIO = {
    turns,
    sessionId: async () => state.session,
    flushPlanned: () => state.flush,
    compacting: () => state.compacting,
    lastRequestAt: () => state.last,
    peek: () => (state.known ? okRead(state.reg) : undefined),
    storage: async () => '/s',
    readQueue: async () => (log.reads++, okRead(state.queue)),
    readTags: async () => (log.reads++, okRead(state.reg)),
    block: () => ({
      claim: async (wakeFirst?: boolean) => {
        const out = claimBlock(state.reg, state.now, wakeFirst)
        if (!out) return undefined
        state.reg = out.registry
        return out.lines.length ? { lines: out.lines, claimed: out.claimed } : undefined
      },
      restore: async c => void (state.reg = restoreBlock(state.reg, c) ?? state.reg),
    }),
    submit: async text => {
      if (state.drop) throw new Error('the prompt was dropped')
      log.submits.push(text)
    },
    removeDelivered: async (_dir, report) => void log.removed.push(report),
    advised: async () => void (log.advised += 1),
    status: text => void log.status.push(text),
    after: (ms, fn) => {
      const t: Timer = { ms, fn, cancelled: false }
      log.timers.push(t)
      return { cancel: () => void (t.cancelled = true) }
    },
    now: () => state.now,
    debug: text => void log.debug.push(text),
  }
  return { io, mem, state, log, turns }
}

const ticks = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// [SP_HELP_05_01] WakeCheck — умови; [SP_HELP_05_02] I5
test('WakeCheck — умови: an errand with wake fired in an idle sends one wake prompt with the block; a second check in the same idle sends none; a request since opens the next idle', async () => {
  const { io, mem, state, log, turns } = fake(reg({ turn: 2, errands: [firedWake(1)], nextErrand: 2 }))
  expect(await wakeCheck(io, mem, turns.turns)).toBe('woke')
  expect(log.submits).toEqual([`${WAKE_TEXT}\n\nR1`])
  expect(state.reg.errands).toEqual([])
  expect(log.debug).toContain('wake check: woke')
  // a second errand fires in the same idle: no second wake
  state.reg = { ...state.reg, errands: [firedWake(2, 2)], nextErrand: 3 }
  expect(await wakeCheck(io, mem, turns.turns)).toBe('woken')
  expect(log.submits).toHaveLength(1)
  expect(state.reg.errands!.map(e => e.state)).toEqual(['fired'])
  // the wake prompt's turn made a request: the next idle may wake
  state.last = state.now + 10
  state.now += 20
  expect(await wakeCheck(io, mem, turns.turns)).toBe('woke')
  expect(log.submits[1]).toBe(`${WAKE_TEXT}\n\nR2`)
})

test('WakeCheck — умови: a turn runs or began since, Flush planned, the mod\'s own compaction runs, a handoff request: no prompt, the block stays', async () => {
  const start = () => reg({ turn: 2, errands: [firedWake(1)], nextErrand: 2 })
  const moved = fake(start())
  const t0 = moved.turns.turns
  turnStarted(moved.turns)
  expect(await wakeCheck(moved.io, moved.mem, t0)).toBe('moved')
  turnCompleted(moved.turns, false)
  expect(await wakeCheck(moved.io, moved.mem, t0)).toBe('moved')
  const flush = fake(start())
  flush.state.flush = true
  expect(await wakeCheck(flush.io, flush.mem, flush.turns.turns)).toBe('flush-planned')
  const own = fake(start())
  own.state.compacting = true
  expect(await wakeCheck(own.io, own.mem, own.turns.turns)).toBe('compacting')
  const handed = fake(start(), { queue: { ...EMPTY_QUEUE, handoff: { mode: 'transcript', resume: true, resumePrompt: '', by: 'agent', state: 'queued', at: 1 } } })
  expect(await wakeCheck(handed.io, handed.mem, handed.turns.turns)).toBe('handoff')
  for (const h of [moved, flush, own, handed]) {
    expect(h.log.submits).toEqual([])
    expect(h.state.reg.errands!.map(e => e.state)).toEqual(['fired'])
    expect(h.mem.wokeAt).toBeUndefined()
  }
})

test('WakeCheck — ворота: a known registry with no errand with wake due reads nothing and sends nothing; an errand without wake waits for a safe moment', async () => {
  const plain = fake(reg({ errands: [errand(1, { state: 'fired', firedAt: 1, result: 'R1' })], nextErrand: 2 }))
  expect(await wakeCheck(plain.io, plain.mem, plain.turns.turns)).toBe('none')
  expect(plain.log.reads).toBe(0)
  expect(plain.log.submits).toEqual([])
  expect(plain.log.debug).toEqual([])
  // an open errand with wake has not fired: nothing to wake for
  const open = fake(reg({ errands: [errand(1, { wake: true })], nextErrand: 2 }))
  expect(await wakeCheck(open.io, open.mem, open.turns.turns)).toBe('none')
  expect(open.log.reads).toBe(0)
})

test('WakeCheck — текст: the waiting report (NoteOnce), WAKE_TEXT, WaitingAdvice, then the block with the due reminders; the report removed, the advice marked', async () => {
  const report = `context-editor: applied 1 edit(s). ${COMMAND_NOTE}`
  const block: ClosedBlock = { name: 'stage a', after: null, end: { anchor: 'user|r:a|', hint: 4 }, turn: 2 }
  const r0 = reg({
    turn: 5,
    errands: [firedWake(1)],
    nextErrand: 2,
    notes: [{ id: 'n1', target: { tool_use_id: 'c1' }, text: 'look at c1', createdTurn: 3, remindAt: 5 }],
    nextNote: 2,
    lastClosed: block,
    waiting: 'marked',
  })
  const h = fake(r0, { queue: { ...EMPTY_QUEUE, report, reportId: 4, reportResume: false } })
  expect(await wakeCheck(h.io, h.mem, h.turns.turns)).toBe('woke')
  const sent = h.log.submits[0]!
  expect(sent.startsWith(`${report}\n\n${WAKE_TEXT}\n\n`)).toBe(true)
  expect(sent).toContain('stage a')
  expect(sent.endsWith('\n\n[context-editor] reminder from your note n1 (set 2 turn(s) ago): look at c1\nR1')).toBe(true)
  expect(h.log.removed).toEqual([report])
  expect(h.log.advised).toBe(1)
})

// [SP_HELP_05_04] Хост відхилив промпт пробудження
test('WakeCheck — відхилений промпт: the errands fired again, the note keeps remindAt, a status line names the errands; the idle keeps its one try', async () => {
  const r0 = reg({
    turn: 5,
    errands: [firedWake(1), firedWake(2, 2)],
    nextErrand: 3,
    notes: [{ id: 'n1', target: { tool_use_id: 'c1' }, text: 'look', createdTurn: 3, remindAt: 5 }],
    nextNote: 2,
  })
  const h = fake(r0, { queue: { ...EMPTY_QUEUE, report: 'R', reportId: 1 } })
  h.state.drop = true
  expect(await wakeCheck(h.io, h.mem, h.turns.turns)).toBe('refused')
  expect(h.state.reg.errands!.map(e => `${e.id} ${e.state}`)).toEqual(['e1 fired', 'e2 fired'])
  expect(h.state.reg.notes[0]!.remindAt).toBe(5)
  expect(h.log.status).toEqual(['context-editor: could not wake the agent for errand(s) e1, e2: the prompt was dropped'])
  expect(h.log.removed).toEqual([])
  h.state.drop = false
  expect(await wakeCheck(h.io, h.mem, h.turns.turns)).toBe('woken')
})

test('WakeCheck — взяття блоку: another moment took the errand, or a turn began during the claim: the block goes back, no prompt, the idle keeps its wake', async () => {
  const h = fake(reg({ errands: [firedWake(1)], nextErrand: 2 }))
  // the registry the claim sees has no errand with wake any more
  const claim = h.io.block('/s').claim
  h.io.block = () => ({
    claim: async () => ((h.state.reg = { ...h.state.reg, errands: [errand(2, { state: 'fired', firedAt: 1, result: 'R2' })] }), claim()),
    restore: async c => void (h.state.reg = restoreBlock(h.state.reg, c) ?? h.state.reg),
  })
  expect(await wakeCheck(h.io, h.mem, h.turns.turns)).toBe('nothing')
  expect(h.log.submits).toEqual([])
  expect(h.state.reg.errands!.map(e => e.id)).toEqual(['e2'])
  expect(h.mem.wokeAt).toBeUndefined()
  const t = fake(reg({ errands: [firedWake(1)], nextErrand: 2 }))
  const claim2 = t.io.block('/s').claim
  const block = t.io.block('/s')
  t.io.block = () => ({ claim: async () => (turnStarted(t.turns), claim2()), restore: block.restore })
  expect(await wakeCheck(t.io, t.mem, 1)).toBe('moved')
  expect(t.log.submits).toEqual([])
  expect(t.state.reg.errands!.map(e => e.state)).toEqual(['fired'])
  expect(t.mem.wokeAt).toBeUndefined()
})

test('WakeCheck — нечитні: an unreadable registry or queue: no prompt, a debug line', async () => {
  const h = fake(reg({ errands: [firedWake(1)], nextErrand: 2 }))
  h.state.known = false
  h.io.readTags = async (): Promise<Read<TagRegistry>> => ({ state: 'unreadable', reason: 'bad json' })
  expect(await wakeCheck(h.io, h.mem, h.turns.turns)).toBe('nothing')
  expect(h.log.debug).toContain('wake check: the tag registry cannot be read (bad json)')
  const q = fake(reg({ errands: [firedWake(1)], nextErrand: 2 }))
  q.io.readQueue = async (): Promise<Read<Queue>> => ({ state: 'unreadable', reason: 'bad queue' })
  expect(await wakeCheck(q.io, q.mem, q.turns.turns)).toBe('nothing')
  expect(q.log.debug).toContain('wake check: the queue cannot be read (bad queue)')
  expect([...h.log.submits, ...q.log.submits]).toEqual([])
})

// [SP_HELP_05_01] WakeCheck — фонове питання
test('WakeCheck — повторна перевірка: a running ask errand with wake arms WAKE_RECHECK_MS from the turn end; its end in the idle wakes from the recheck; a turn that began ends it', async () => {
  const h = fake(reg({ errands: [runningWake(1)], nextErrand: 2 }))
  expect(await wakeWithRecheck(h.io, h.mem, h.turns.turns)).toBe('none')
  expect(h.log.timers.map(t => t.ms)).toEqual([WAKE_RECHECK_MS])
  // still running at the first recheck: WakeCheck finds nothing and arms the next one
  h.log.timers[0]!.fn()
  await ticks()
  expect(h.log.submits).toEqual([])
  expect(h.log.timers).toHaveLength(2)
  // the question ended meanwhile (FinishAsk): the next recheck wakes
  h.state.reg = { ...h.state.reg, errands: [{ ...h.state.reg.errands![0]!, state: 'fired', result: 'A1' }] }
  h.log.timers[1]!.fn()
  await ticks()
  expect(h.log.submits).toEqual([`${WAKE_TEXT}\n\nA1`])
  expect(h.log.timers).toHaveLength(2)
  // a turn that began ends the recheck: its callback does nothing
  const t = fake(reg({ errands: [runningWake(1)], nextErrand: 2 }))
  await wakeWithRecheck(t.io, t.mem, t.turns.turns)
  turnStarted(t.turns)
  t.state.reg = { ...t.state.reg, errands: [{ ...t.state.reg.errands![0]!, state: 'fired', result: 'A1' }] }
  t.log.timers[0]!.fn()
  await ticks()
  expect(t.log.submits).toEqual([])
  expect(t.log.timers).toHaveLength(1)
})

test('WakeCheck — повторна перевірка: no running errand with wake arms none; a new turn end replaces the timer; a stale call wakes with STALE_TEXT and stops', async () => {
  const none = fake(reg({ errands: [errand(1, { state: 'running', firedAt: 1, action: { kind: 'ask', folds: ['f1'], question: 'q' } })], nextErrand: 2 }))
  expect(armRecheck(none.io, none.mem, none.turns.turns, 's1')).toBe(false)
  expect(none.log.timers).toEqual([])
  const h = fake(reg({ errands: [runningWake(1, 1000)], nextErrand: 2 }))
  expect(armRecheck(h.io, h.mem, h.turns.turns, 's1')).toBe(true)
  expect(armRecheck(h.io, h.mem, h.turns.turns, 's1')).toBe(true)
  expect(h.log.timers.map(t => t.cancelled)).toEqual([true, false])
  // the replaced timer fires anyway: nothing
  h.log.timers[0]!.fn()
  await ticks()
  expect(h.log.timers).toHaveLength(2)
  // past STALE_RUNNING_MS: the errand is delivered as fired with STALE_TEXT, no next timer
  h.state.now = 1000 + STALE_RUNNING_MS + 1
  h.log.timers[1]!.fn()
  await ticks()
  expect(h.log.submits).toHaveLength(1)
  expect(h.log.submits[0]).toContain(STALE_TEXT)
  expect(h.log.timers).toHaveLength(2)
  // the host refuses the timer: a debug line, nothing armed
  const refused = fake(reg({ errands: [runningWake(1)], nextErrand: 2 }))
  refused.io.after = () => {
    throw new Error('no timer here')
  }
  expect(armRecheck(refused.io, refused.mem, refused.turns.turns, 's1')).toBe(false)
  expect(refused.log.debug).toContain('wake recheck refused: no timer here')
})

// [SP_HELP_02_06] errand_add with wake
test('errand_add — wake: true sets it and the result says what a wake costs; not a boolean: ERRAND_WAKE; absent: false', async () => {
  let r = reg({ turn: 4 })
  const io: ErrandIO = {
    passedOver: () => false,
    storageDown: async () => undefined,
    storageRefusal: why => why,
    readLedger: async () => okRead(emptyFolds()),
    size: async () => undefined,
    readTags: async () => okRead(r),
    writeTags: async x => void (r = x),
    onRegistry: work => work(),
  }
  const out = await errandAdd(io, { op: 'errand_add', when: 'cold', action: 'remind', text: 'look', wake: true })
  expect(out).toEqual({ result: `Errand e1 set: when the prompt cache turns cold after an idle of over 60 min → remind: "look". ${WAKE_SET}` })
  expect(r.errands![0]!.wake).toBe(true)
  expect(await errandAdd(io, { op: 'errand_add', when: 'cold', action: 'remind', text: 'look', wake: 'yes' })).toEqual({
    code: 'ERRAND_WAKE',
    deny: '"wake" is true or false (ERRAND_WAKE)',
  })
  await errandAdd(io, { op: 'errand_add', when: 'turns', n: 2, action: 'apply' })
  expect(r.errands!.map(e => e.wake)).toEqual([true, false])
})

test('WakeCheck — повторна перевірка: another session (/clear, /resume, a handoff) ends it; a refused re-arm leaves a debug line', async () => {
  const h = fake(reg({ errands: [runningWake(1)], nextErrand: 2 }))
  await wakeWithRecheck(h.io, h.mem, h.turns.turns)
  h.state.session = 's2'
  h.state.reg = { ...h.state.reg, errands: [{ ...h.state.reg.errands![0]!, state: 'fired', result: 'A1' }] }
  h.log.timers[0]!.fn()
  await ticks()
  expect(h.log.submits).toEqual([])
  expect(h.log.timers).toHaveLength(1)
  // still running at the recheck, and the host refuses the next timer
  const r = fake(reg({ errands: [runningWake(1)], nextErrand: 2 }))
  await wakeWithRecheck(r.io, r.mem, r.turns.turns)
  const after = r.io.after
  r.io.after = () => {
    throw new Error('no timer now')
  }
  r.log.timers[0]!.fn()
  await ticks()
  r.io.after = after
  expect(r.log.debug).toContain('wake recheck refused: no timer now')
})

test('WakeCheck — повний блок: the errands with wake go first, so two big results fired earlier do not push the wake errand out', async () => {
  const big = (n: number) => errand(n, { state: 'fired', firedAt: n, result: 'x'.repeat(16_000) })
  const h = fake(reg({ errands: [big(1), big(2), firedWake(3, 3)], nextErrand: 4 }))
  expect(await wakeCheck(h.io, h.mem, h.turns.turns)).toBe('woke')
  expect(h.log.submits[0]!.endsWith('\nR3') || h.log.submits[0]!.includes('\n\nR3\n')).toBe(true)
  expect(h.log.submits[0]!.length).toBeLessThan(WAKE_TEXT.length + MAX_DELIVERY + 4)
  expect(h.state.reg.errands!.map(e => e.id)).toEqual(['e2'])
})

test('OwnCompaction: IdleRun\'s or StartRun\'s command, a running repair (a planned one does not count), a planned or running handoff', () => {
  const idle = { applying: false, starting: false }
  const off = { inFlight: false, scheduled: false }
  expect(ownCompaction(idle, 'none', off)).toBe(false)
  expect(ownCompaction(idle, 'done', off)).toBe(false)
  expect(ownCompaction({ ...idle, applying: true }, 'none', off)).toBe(true)
  expect(ownCompaction({ ...idle, starting: true }, 'none', off)).toBe(true)
  expect(ownCompaction(idle, 'planned', off)).toBe(false)
  expect(ownCompaction(idle, 'running', off)).toBe(true)
  expect(ownCompaction(idle, 'none', { ...off, scheduled: true })).toBe(true)
  expect(ownCompaction(idle, 'none', { ...off, inFlight: true })).toBe(true)
})

test('WakeCheck — cold-доручення з питанням у простої: IdleRun\'s WakeCheck finds the question running and arms the recheck; its end wakes from there', async () => {
  const h = fake(reg({ errands: [runningWake(1)], nextErrand: 2 }))
  expect(await wakeWithRecheck(h.io, h.mem, h.turns.turns)).toBe('none')
  expect(h.log.timers.map(t => t.ms)).toEqual([WAKE_RECHECK_MS])
  h.state.reg = { ...h.state.reg, errands: [{ ...h.state.reg.errands![0]!, state: 'fired', result: 'A1' }] }
  h.log.timers[0]!.fn()
  await ticks()
  expect(h.log.submits).toEqual([`${WAKE_TEXT}\n\nA1`])
})
