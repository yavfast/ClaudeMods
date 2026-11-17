// [SP_HELP_05_01] [SP_HELP_05_02] PL_HELP phase 7: the conditional errands —
// the operations, CheckErrands and Fire, DeliveryBlock at a safe moment, the
// mod's own prompts, the handoff, the telemetry line.
import { expect, test } from 'claude-code/testing'
import { ERRAND_ASK_PASSED_OVER, errandAsk, errandAskedLine } from '../hooks/ask'
import { dropOwnCalls, ownPairs } from '../hooks/edits'
import {
  afterDelivery,
  APPLY_AFTER_TURN,
  APPLY_IN_IDLE,
  APPLY_NOTHING,
  applyMarked,
  badErrandFields,
  badHelperOp,
  carriedErrands,
  checkErrands,
  errandRoom,
  markApply,
  MAX_ERRAND_RESULT,
  outputSize,
  claimBlock,
  claimDelivery,
  deliveryPending,
  errandAdd,
  errandLine,
  errandList,
  errandRemove,
  errandsLine,
  finishAsk,
  fire,
  HANDED_OFF_TEXT,
  MAX_DELIVERY,
  MAX_ERRANDS,
  restoreBlock,
  STALE_RUNNING_MS,
  STALE_TEXT,
  submitWithBlock,
  wantsSize,
  type CheckIO,
  type Errand,
  type ErrandIO,
} from '../hooks/errands'
import { afterTurn, type TurnEndIO } from '../hooks/flush'
import { emptyFolds, type FoldEntry, type FoldLedger } from '../hooks/folds'
import { deliverReport, EMPTY_QUEUE, type DeliverIO, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { parseRegistry, type TagRegistry } from '../hooks/tags'
import { missingRead, okRead, reg, reply, unreadableRead } from './row-fixtures'

function errand(n: number, extra: Partial<Errand> = {}): Errand {
  return { id: `e${n}`, when: { kind: 'turns', n: 1 }, action: { kind: 'remind', text: `text ${n}` }, wake: false, createdTurn: 0, state: 'open', ...extra }
}

function fold(id: string, kind: FoldEntry['kind'] = 'range'): FoldEntry {
  return { id, archive: '/a/1.json', entry: 0, kind, call: 'context_edit collapse call', what: 'stage "reading"', rows: 1, chars: 30, turn: 2 }
}

// An ErrandIO over one registry in memory.
function errandHarness(start: TagRegistry, extra: Partial<ErrandIO> = {}) {
  const log: { reg: TagRegistry; writes: number } = { reg: start, writes: 0 }
  const io: ErrandIO = {
    passedOver: () => false,
    storageDown: async () => undefined,
    storageRefusal: why => `storage: ${why}`,
    readLedger: async () => okRead<FoldLedger>({ ...emptyFolds(), folds: [fold('f1'), fold('f2', 'media')], nextFold: 3 }),
    size: async () => 50_000,
    readTags: async () => okRead(log.reg),
    writeTags: async r => {
      log.reg = r
      log.writes++
    },
    onRegistry: work => work(),
    ...extra,
  }
  return { io, log }
}

// ---- [SP_HELP_02_06] the operations

test('errand_add — відмови: size not above the request now; cold with n; remind without text; the 21st errand; apply or ask on a host that passes over the compaction', async () => {
  const { io } = errandHarness(reg())
  const code = async (args: Record<string, unknown>, h = io) => {
    const out = await errandAdd(h, args)
    return 'code' in out ? out.code : 'ok'
  }
  expect(await code({ when: 'size', n: 40_000, action: 'remind', text: 'x' })).toBe('ERRAND_N')
  const sized = await errandAdd(io, { when: 'size', n: 50_000, action: 'remind', text: 'x' })
  expect('deny' in sized && sized.deny).toContain('the request is already ~50000 tokens, the fixed part included')
  expect(await code({ when: 'cold', n: 2, action: 'remind', text: 'x' })).toBe('ERRAND_WHEN')
  expect(await code({ when: 'turns', n: 2, name: 'A', action: 'remind', text: 'x' })).toBe('ERRAND_WHEN')
  expect(await code({ when: 'turns', n: 0, action: 'remind', text: 'x' })).toBe('ERRAND_N')
  expect(await code({ when: 'turns', n: 2, action: 'remind' })).toBe('ERRAND_TEXT')
  expect(await code({ when: 'turns', n: 2, action: 'apply', text: 'x' })).toBe('ERRAND_ACTION')
  expect(await code({ when: 'turns', n: 2, action: 'ask', folds: ['f9'], question: 'q' })).toBe('FOLD_UNKNOWN')
  expect(await code({ when: 'turns', n: 2, action: 'ask', folds: ['f2'], question: 'q' })).toBe('ASK_MEDIA')
  expect(await code({ when: 'turns', n: 2, action: 'ask', folds: ['f1'] })).toBe('ASK_QUESTION')
  const full = errandHarness(reg({ errands: Array.from({ length: MAX_ERRANDS }, (_, i) => errand(i + 1)), nextErrand: MAX_ERRANDS + 1 }))
  expect(await code({ when: 'turns', n: 2, action: 'remind', text: 'x' }, full.io)).toBe('ERRANDS_FULL')
  const passed = errandHarness(reg(), { passedOver: () => true })
  expect(await code({ when: 'turns', n: 2, action: 'apply' }, passed.io)).toBe('HELPER_PASSED_OVER')
  expect(await code({ when: 'turns', n: 2, action: 'ask', folds: ['f1'], question: 'q' }, passed.io)).toBe('HELPER_PASSED_OVER')
  // a reminder works on such a host
  expect(await code({ when: 'turns', n: 2, action: 'remind', text: 'x' }, passed.io)).toBe('ok')
})

test('errand_add — постановка: the id from nextErrand, createdTurn the turn now, the result names the condition and the action; the registry reads back', async () => {
  const { io, log } = errandHarness(reg({ turn: 4 }))
  const out = await errandAdd(io, { when: 'turns', n: 2, action: 'remind', text: '  check the build  ' })
  expect(out).toEqual({ result: 'Errand e1 set: when 2 turn(s) from now (turn 6) → remind: "check the build".' })
  expect(log.reg.errands).toEqual([{ id: 'e1', when: { kind: 'turns', n: 2 }, action: { kind: 'remind', text: 'check the build' }, wake: false, createdTurn: 4, state: 'open' }])
  expect(log.reg.nextErrand).toBe(2)
  const sized = await errandAdd(io, { when: 'size', n: 90_000, action: 'apply' })
  expect(sized).toEqual({ result: 'Errand e2 set: when the request reaches ~90000 tokens, the fixed part included (now ~50000) → apply your deferred edits.' })
  const named = await errandAdd(io, { when: 'closed', name: 'review', action: 'ask', folds: ['f1'], question: 'what failed?' })
  expect(named).toEqual({ result: 'Errand e3 set: when region "review" closes → ask the helper about f1: "what failed?".' })
  expect(parseRegistry(JSON.stringify(log.reg)).state).toBe('ok')
})

test('errand_list і errand_remove: the lines with state; a running errand goes too; an unknown id NO_ERRAND', async () => {
  const { io, log } = errandHarness(reg({ errands: [errand(1), errand(2, { state: 'running', firedAt: 5, action: { kind: 'ask', folds: ['f1'], question: 'q' } })], nextErrand: 3 }))
  expect(await errandList(io)).toEqual({
    result: ['Errands: 2 of 20.', 'e1 [open]: when turn 1 (set at turn 0) → remind: "text 1"', 'e2 [running]: when turn 1 (set at turn 0) → ask the helper about f1: "q"'].join('\n'),
  })
  expect(await errandRemove(io, 'e2')).toEqual({ result: 'Errand e2 removed.' })
  expect(log.reg.errands!.map(e => e.id)).toEqual(['e1'])
  const none = await errandRemove(io, 'e9')
  expect('code' in none && none.code).toBe('NO_ERRAND')
  expect(await errandList(errandHarness(reg()).io)).toEqual({ result: 'No errands.' })
})

test('BAD_OP: an unknown op; a field of another operation; wake goes only with errand_add', () => {
  expect(badHelperOp({ op: 'errand_drop' })).toContain('(BAD_OP)')
  expect(badHelperOp({ op: 'errand_list', id: 'e1' })).toBe('"errand_list" takes no "id"; it takes no other field (BAD_OP)')
  expect(badHelperOp({ op: 'errand_remove', text: 'x', id: 'e1' })).toBe('"errand_remove" takes no "text"; it takes "id" (BAD_OP)')
  expect(badHelperOp({ op: 'errand_add', wake: true, when: 'cold', action: 'apply' })).toBeUndefined()
  expect(badHelperOp({ op: 'errand_remove', wake: true, id: 'e1' })).toBe('"errand_remove" takes no "wake"; it takes "id" (BAD_OP)')
  expect(badHelperOp({ op: 'errand_add', when: 'cold', action: 'apply' })).toBeUndefined()
})

test('Реєстр — доручення: a bad errand, a repeated id or one not below nextErrand make it unreadable', () => {
  expect(badErrandFields(undefined, undefined)).toBe(false)
  expect(badErrandFields([errand(1)], 2)).toBe(false)
  expect(badErrandFields([errand(1), errand(1)], 2)).toBe('errands')
  expect(badErrandFields([errand(2)], 2)).toBe('errands')
  expect(badErrandFields([errand(1, { state: 'fired' })], 2)).toBe('errands')
  expect(badErrandFields([errand(1, { when: { kind: 'cold', n: 1 } as never })], 2)).toBe('errands')
  expect(parseRegistry(JSON.stringify({ ...reg(), errands: [errand(1, { state: 'running' })], nextErrand: 2 })).state).toBe('unreadable')
})

// ---- [SP_HELP_02_07] CheckErrands and Fire

function checkHarness(start: TagRegistry, queue: Queue = { ...EMPTY_QUEUE }) {
  const log = { reg: start, queue, asked: [] as string[], debug: [] as string[], reads: 0 }
  const io: CheckIO = {
    peek: () => okRead(log.reg),
    readTags: async () => (log.reads++, okRead(log.reg)),
    markApply: () =>
      markApply(async change => {
        const next = change(log.queue)
        if (next) log.queue = next
      }),
    updateTags: async change => {
      const next = change(log.reg)
      if (next) log.reg = next
    },
    ask: e => void log.asked.push(e.id),
    now: () => 1000,
    debug: t => void log.debug.push(t),
  }
  return { io, log }
}

test('CheckErrands — події: each errand fires on its own event and only there', async () => {
  const errands = [
    errand(1, { when: { kind: 'turns', n: 2 } }),
    errand(2, { when: { kind: 'size', n: 100_000 } }),
    errand(3, { when: { kind: 'closed', name: 'B' } }),
    errand(4, { when: { kind: 'closed' } }),
    errand(5, { when: { kind: 'cold' } }),
  ]
  const { io, log } = checkHarness(reg({ turn: 1, errands, nextErrand: 6 }))
  // one turn: turns 2 holds not yet; size without a measure checks nothing
  expect(await checkErrands(io, { kind: 'turn' })).toEqual([])
  log.reg = { ...log.reg, turn: 2 }
  expect(await checkErrands(io, { kind: 'turn', size: 90_000 })).toEqual(['e1'])
  expect(await checkErrands(io, { kind: 'output', size: 100_500 })).toEqual(['e2'])
  expect(await checkErrands(io, { kind: 'closed', names: ['A'] })).toEqual(['e4'])
  expect(await checkErrands(io, { kind: 'closed', names: ['T', 'B'] })).toEqual(['e3'])
  expect(await checkErrands(io, { kind: 'cold', idle: false })).toEqual(['e5'])
  // fired once: the same events fire nothing again (I4)
  for (const ev of [{ kind: 'turn', size: 200_000 }, { kind: 'closed', names: ['B'] }, { kind: 'cold', idle: true }] as const) expect(await checkErrands(io, ev)).toEqual([])
  expect(log.reg.errands!.every(e => e.state === 'fired')).toBe(true)
  expect(log.reg.errands![0]!.result).toBe(`${errandLine(errands[0]!, 2)}text 1`)
  expect(errandLine(errands[0]!, 2)).toBe('[context-editor] your errand e1 fired (2 turn(s), set 2 turn(s) ago): ')
})

test('CheckErrands — воріт немає: a known registry where nothing holds takes no read; size is read only for an open size errand', async () => {
  const { io, log } = checkHarness(reg({ errands: [errand(1, { when: { kind: 'cold' } })], nextErrand: 2 }))
  expect(await checkErrands(io, { kind: 'turn', size: 10 })).toEqual([])
  expect(log.reads).toBe(0)
  expect(wantsSize(okRead(reg({ errands: [errand(1, { when: { kind: 'cold' } })], nextErrand: 2 })))).toBe(false)
  expect(wantsSize(okRead(reg({ errands: [errand(1, { when: { kind: 'size', n: 5 } })], nextErrand: 2 })))).toBe(true)
  expect(wantsSize(undefined)).toBe(true)
  // the size channel's gates do not matter: the output event alone fires it ([SP_HELP_05_01] size до порогів)
  const s = checkHarness(reg({ errands: [errand(1, { when: { kind: 'size', n: 1000 } })], nextErrand: 2 }))
  expect(await checkErrands(s.io, { kind: 'output', size: 1200 })).toEqual(['e1'])
})

test('CheckErrands — перерваний хід: AfterTurn runs no errand step for an aborted turn; the next completed turn does', async () => {
  const steps: string[] = []
  const io: TurnEndIO = {
    storage: async () => '/s',
    detect: async () => undefined,
    countTurn: async () => void steps.push('count'),
    errands: async () => void steps.push('errands'),
    flush: async () => void steps.push('flush'),
    handoff: async () => undefined,
  }
  await afterTurn(io, { aborted: true })
  expect(steps).toEqual(['flush'])
  steps.length = 0
  await afterTurn(io, { aborted: false })
  expect(steps).toEqual(['count', 'errands', 'flush'])
})

test('Fire — apply: deferred edits queued: applyDeferred without coldSince and the text for the turn or the idle; none: nothing deferred', async () => {
  const deferred = { op: 'drop', tool_use_id: 'c1', deferred: 'b1' } as Queue['edits'][number]
  const q: Queue = { ...EMPTY_QUEUE, edits: [deferred], coldSince: 5 } as Queue
  const { io, log } = checkHarness(reg({ turn: 3, errands: [errand(1, { action: { kind: 'apply' }, when: { kind: 'closed' } })], nextErrand: 2 }), q)
  expect(await checkErrands(io, { kind: 'closed', names: [] })).toEqual(['e1'])
  expect(log.queue.applyDeferred).toBe(true)
  expect(log.queue.coldSince).toBeUndefined()
  expect(log.reg.errands![0]!.result!.endsWith(APPLY_AFTER_TURN)).toBe(true)
  const idle = fire(reg({ errands: [errand(1, { action: { kind: 'apply' }, when: { kind: 'cold' } })], nextErrand: 2 }), { kind: 'cold', idle: true }, 1, true)!
  expect(idle.fired[0]!.result!.endsWith(APPLY_IN_IDLE)).toBe(true)
  const none = checkHarness(reg({ errands: [errand(1, { action: { kind: 'apply' }, when: { kind: 'closed' } })], nextErrand: 2 }))
  await checkErrands(none.io, { kind: 'closed', names: [] })
  expect(none.log.queue).toEqual({ ...EMPTY_QUEUE })
  expect(none.log.reg.errands![0]!.result!.endsWith(APPLY_NOTHING)).toBe(true)
})

test('Fire — ask у фоні: running with firedAt, the question starts; its end makes it fired with the errand\'s AskText; removed meanwhile: the late result goes', async () => {
  const ask: Errand = errand(1, { action: { kind: 'ask', folds: ['f1'], question: 'what failed?' }, when: { kind: 'closed' } })
  const { io, log } = checkHarness(reg({ turn: 2, errands: [ask], nextErrand: 2 }))
  expect(await checkErrands(io, { kind: 'closed', names: [] })).toEqual(['e1'])
  expect(log.reg.errands![0]).toMatchObject({ state: 'running', firedAt: 1000 })
  expect(log.asked).toEqual(['e1'])
  const done = finishAsk(log.reg, 'e1', 'the reading')!
  expect(done.errands![0]).toMatchObject({ state: 'fired', result: `${errandLine(ask, 2)}the reading` })
  expect(finishAsk(done, 'e1', 'again')).toBeUndefined()
  expect(finishAsk(reg({ errands: [], nextErrand: 2 }), 'e1', 'late')).toBeUndefined()
})

test('ErrandAsk: the steps of Ask with the errand\'s first line; the journal entry names the errand; a missing fold gives its refusal', async () => {
  const entries: unknown[] = []
  const io = {
    passedOver: () => false,
    readLedger: async () => okRead<FoldLedger>({ ...emptyFolds(), folds: [fold('f1')], nextFold: 2 }),
    readArchive: async () => JSON.stringify([{ edit: 'collapse #2..#3', rows: [reply('the build failed on step 3')] }]),
    helper: { complete: async () => ({ text: JSON.stringify({ status: 'answered', answer: 'step 3', quotes: [{ text: 'the build failed on step 3', row: 0 }] }), in: 10, out: 5 }) },
    journal: (e: unknown) => void entries.push(e),
    now: () => 7,
  }
  const text = await errandAsk(io, { id: 'e4', folds: ['f1'], question: 'what failed?' }, 15_000)
  expect(text.startsWith(errandAskedLine('e4', ['f1']))).toBe(true)
  expect(errandAskedLine('e4', ['f1']).startsWith('Errand e4 asked fold(s) f1 — ')).toBe(true)
  expect(entries).toEqual([expect.objectContaining({ kind: 'ask', errand: 'e4', folds: ['f1'] })])
  const missing = await errandAsk(io, { id: 'e5', folds: ['f9'], question: 'q' }, 15_000)
  expect(missing).toContain('(FOLD_UNKNOWN)')
})

// ---- [SP_HELP_02_08] DeliveryBlock

const noteDue = { id: 'n1', target: { tool_use_id: 'c1' }, text: 'look at c1', createdTurn: 1, remindAt: 3 }

test('Доставка — один раз: a due reminder and two fired errands go in one block, oldest first; the registry keeps neither; a second call delivers nothing', async () => {
  const fired = (n: number, at: number) => errand(n, { state: 'fired', firedAt: at, result: `R${n}` })
  let r = reg({ turn: 3, notes: [noteDue], nextNote: 2, errands: [fired(2, 20), fired(1, 10), errand(3)], nextErrand: 4 })
  const io = {
    readTags: async () => okRead(r),
    writeTags: async (next: TagRegistry) => void (r = next),
    now: () => 100,
  }
  const got = await claimDelivery(io)
  expect(got!.lines).toEqual(['[context-editor] reminder from your note n1 (set 2 turn(s) ago): look at c1', 'R1', 'R2'])
  expect(r.notes[0]!.remindAt).toBeUndefined()
  expect(r.errands!.map(e => e.id)).toEqual(['e3'])
  expect(deliveryPending(okRead(r))).toBe(false)
  expect(await claimDelivery(io)).toBeUndefined()
  // a failed write delivers nothing (I4)
  let kept = reg({ errands: [fired(1, 1)], nextErrand: 2 })
  expect(await claimDelivery({ readTags: async () => okRead(kept), writeTags: async () => Promise.reject(new Error('disk')), now: () => 1 })).toBeUndefined()
  expect(kept.errands![0]!.state).toBe('fired')
  kept = { ...kept }
})

test('Доставка — межа блоку: of three results of 15 000 chars two go; the third stays fired', () => {
  const big = (n: number) => errand(n, { state: 'fired', firedAt: n, result: 'x'.repeat(15_000) })
  const out = claimBlock(reg({ errands: [big(1), big(2), big(3)], nextErrand: 4 }), 10)!
  expect(out.lines.length).toBe(2)
  expect(out.lines.join('\n').length <= MAX_DELIVERY).toBe(true)
  expect(out.registry.errands!.map(e => e.id)).toEqual(['e3'])
})

test('Доставка — загублений виклик: a running errand older than STALE_RUNNING_MS is delivered as fired with STALE_TEXT', () => {
  const running = errand(1, { state: 'running', firedAt: 0, action: { kind: 'ask', folds: ['f1'], question: 'q' } })
  expect(claimBlock(reg({ errands: [running], nextErrand: 2 }), STALE_RUNNING_MS)).toBeUndefined()
  const out = claimBlock(reg({ turn: 2, errands: [running], nextErrand: 2 }), STALE_RUNNING_MS + 1)!
  expect(out.lines).toEqual([`${errandLine(running, 2)}${STALE_TEXT}`])
})

// DeliverReport with a block port over one registry
function deliverHarness(r0: TagRegistry, enter: (ctx: readonly string[]) => Promise<{ drop?: unknown }>) {
  const log = { reg: r0, entered: [] as string[][] }
  const io: DeliverIO<{ drop?: unknown }> = {
    readQueue: async () => okRead({ ...EMPTY_QUEUE }),
    intro: async () => undefined,
    advice: async () => undefined,
    inTurn: () => false,
    enter: async ctx => (log.entered.push([...ctx]), enter(ctx)),
    markIntroduced: async () => undefined,
    settle: async () => undefined,
    block: {
      claim: async () => {
        const out = claimBlock(log.reg, 0)
        if (!out) return undefined
        log.reg = out.registry
        return { lines: out.lines, claimed: out.claimed }
      },
      restore: async c => void (log.reg = restoreBlock(log.reg, c) ?? log.reg),
    },
  }
  return { io, log }
}

test('Доставка — промпт: an errand that fired between turns goes in the hidden context of the person\'s prompt', async () => {
  const fired = errand(1, { state: 'fired', firedAt: 1, result: 'R1' })
  const h = deliverHarness(reg({ errands: [fired], nextErrand: 2 }), async () => ({}))
  await deliverReport(h.io)
  expect(h.log.entered).toEqual([['R1']])
  expect(h.log.reg.errands).toEqual([])
})

test('Доставка — відкинутий промпт: a lower handler drops it, or the hook throws: the errand is fired again and the note keeps remindAt', async () => {
  const start = reg({ turn: 3, notes: [noteDue], nextNote: 2, errands: [errand(1, { state: 'fired', firedAt: 1, result: 'R1' })], nextErrand: 2 })
  const dropped = deliverHarness(start, async () => ({ drop: true }))
  await deliverReport(dropped.io)
  expect(dropped.log.reg.errands!.map(e => e.state)).toEqual(['fired'])
  expect(dropped.log.reg.notes[0]!.remindAt).toBe(3)
  const thrown = deliverHarness(start, async () => Promise.reject(new Error('hook')))
  await expect(deliverReport(thrown.io)).rejects.toThrow('hook')
  expect(thrown.log.reg.errands!.map(e => e.state)).toEqual(['fired'])
  expect(thrown.log.reg.notes[0]!.remindAt).toBe(3)
})

test('Доставка — власний промпт мода: the block at the end of the text; the host refuses: the errand is fired again and the note keeps remindAt (I11)', async () => {
  let r = reg({ turn: 3, notes: [noteDue], nextNote: 2, errands: [errand(1, { state: 'fired', firedAt: 1, result: 'R1' })], nextErrand: 2 })
  const port = {
    claim: async () => {
      const out = claimBlock(r, 0)!
      r = out.registry
      return { lines: out.lines, claimed: out.claimed }
    },
    restore: async (c: Parameters<typeof restoreBlock>[1]) => void (r = restoreBlock(r, c) ?? r),
  }
  const sent: string[] = []
  await submitWithBlock(port, async t => void sent.push(t), 'Continue.')
  expect(sent[0]).toBe('Continue.\n\n[context-editor] reminder from your note n1 (set 2 turn(s) ago): look at c1\nR1')
  expect(r.errands).toEqual([])
  r = reg({ turn: 3, notes: [noteDue], nextNote: 2, errands: [errand(1, { state: 'fired', firedAt: 1, result: 'R1' })], nextErrand: 2 })
  await expect(submitWithBlock(port, async () => Promise.reject(new Error('drop')), 'Continue.')).rejects.toThrow('drop')
  expect(r.errands!.map(e => e.state)).toEqual(['fired'])
  expect(r.notes[0]!.remindAt).toBe(3)
  // nothing to deliver: the text as it is
  sent.length = 0
  await submitWithBlock({ claim: async () => undefined, restore: async () => undefined }, async t => void sent.push(t), 'Continue.')
  expect(sent).toEqual(['Continue.'])
})

// ---- [SP_HELP_02_13] [SP_HELP_02_14]

test('Телеметрія — доручення: the counts of open and waiting; none: no line', () => {
  expect(errandsLine(reg())).toBeUndefined()
  expect(errandsLine(reg({ errands: [errand(1), errand(2, { state: 'fired', firedAt: 1, result: 'x' }), errand(3, { state: 'running', firedAt: 1 })], nextErrand: 4 }))).toBe(
    'Errands: 3 (1 open, 1 waiting for delivery); context_helper errand_list lists them.',
  )
})

test('Передача — перенесення: a running errand becomes fired with HANDED_OFF_TEXT; the others stay', () => {
  const running = errand(1, { state: 'running', firedAt: 1, action: { kind: 'ask', folds: ['f1'], question: 'q' } })
  const out = carriedErrands([running, errand(2)], 5)!
  expect(out[0]).toMatchObject({ state: 'fired', result: `${errandLine(running, 5)}${HANDED_OFF_TEXT}` })
  expect(out[1]).toEqual(errand(2))
  expect(carriedErrands(undefined, 5)).toBeUndefined()
})

test('ApplyMarked: no deferred edit, or the mark already without coldSince: no change', () => {
  expect(applyMarked({ ...EMPTY_QUEUE })).toBeUndefined()
  const q = { ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'c1', deferred: 'b1' }] } as Queue
  expect(applyMarked({ ...q, applyDeferred: true } as Queue)).toBeUndefined()
  expect(applyMarked(q)).toMatchObject({ applyDeferred: true })
})

test('deliveryPending: an unknown or unreadable registry, a pending reminder, a non-open errand', () => {
  expect(deliveryPending(undefined)).toBe(true)
  expect(deliveryPending(unreadableRead<TagRegistry>())).toBe(true)
  expect(deliveryPending(okRead(reg({ errands: [errand(1)], nextErrand: 2 })))).toBe(false)
  expect(deliveryPending(okRead(reg({ errands: [errand(1, { state: 'running', firedAt: 1 })], nextErrand: 2 })))).toBe(true)
  const r: Read<TagRegistry> = okRead(reg({ notes: [noteDue], nextNote: 2 }))
  expect(deliveryPending(r)).toBe(true)
})

// [SP_HELP_05_01] Власні виклики — errand_list
test('Власні виклики — errand_list: an apply removes the pair of an errand operation; a question pair with its record stays', () => {
  const rows = [
    { role: 'user' as const, text: 'task', toolUses: [], handle: 'p0' },
    {
      role: 'assistant' as const,
      text: '',
      toolUses: [
        { tool_use_id: 'l', tool: 'mcp__context-editor__context_helper', input: { op: 'errand_list' } },
        { tool_use_id: 'q', tool: 'mcp__context-editor__context_helper', input: { op: 'ask', folds: ['f1'], question: 'q' } },
      ],
      handle: 'u1',
    },
    { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 'l', text: 'No errands.', isError: false }, { tool_use_id: 'q', text: 'Asked: …', isError: false }], handle: 'r2' },
    { role: 'assistant' as const, text: 'Done.', toolUses: [], handle: 't3' },
  ]
  const own = ownPairs(rows, new Set(['q']))
  expect([...own]).toEqual(['l'])
  const out = dropOwnCalls(rows, new Set(), undefined, undefined, new Set(['q']))
  expect(out.some(r => r.toolUses.some(u => u.tool_use_id === 'l'))).toBe(false)
  expect(out.some(r => r.toolUses.some(u => u.tool_use_id === 'q'))).toBe(true)
})

// [SP_HELP_02_13] context_list counts what it is about to deliver as delivered, as the Notes line does
test('AfterDelivery: the fired errands and due reminders are gone; open and running ones stay', () => {
  const r = reg({ turn: 3, notes: [noteDue], nextNote: 2, errands: [errand(1, { state: 'fired', firedAt: 1, result: 'R1' }), errand(2), errand(3, { state: 'running', firedAt: 0 })], nextErrand: 4 })
  const after = afterDelivery(r)
  expect(after.errands!.map(e => e.id)).toEqual(['e2', 'e3'])
  expect(after.notes[0]!.remindAt).toBeUndefined()
  expect(errandsLine(after)).toBe('Errands: 2 (1 open, 0 waiting for delivery); context_helper errand_list lists them.')
})

test('ErrandAsk — обхід: the errand gets a text of its own, not the pair\'s refusal', async () => {
  const io = {
    passedOver: () => true,
    readLedger: async () => okRead<FoldLedger>({ ...emptyFolds() }),
    readArchive: async () => undefined,
    helper: { complete: async () => ({ failed: 'never', in: 0, out: 0 }) },
    journal: () => undefined,
    now: () => 1,
  }
  expect(await errandAsk(io, { id: 'e1', folds: ['f1'], question: 'q' }, 1000)).toBe(ERRAND_ASK_PASSED_OVER)
})

// [SP_HELP_02_07] review round 1: the pure parts of the bindings, the apply errand without a queue verdict, the gates
test('Прив\'язки — чисті частини: outputSize by the ratio (PLAIN_RATIO without one); errandRoom leaves the line its room; markApply says whether deferred edits were queued', async () => {
  expect(outputSize(1000, 400)).toBe(1100)
  expect(outputSize(1000, 400, 2)).toBe(1200)
  const e = errand(7)
  expect(errandRoom(e) + errandLine(e, e.createdTurn + 1_000_000).length).toBe(MAX_ERRAND_RESULT)
  let q: Queue = { ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'c1', deferred: 'b1' } as Queue['edits'][number]] }
  expect(await markApply(async change => void (q = change(q) ?? q))).toBe(true)
  expect(q.applyDeferred).toBe(true)
  // already marked: still deferred edits, no new write
  expect(await markApply(async change => void expect(change(q)).toBeUndefined())).toBe(true)
  expect(await markApply(async change => void change({ ...EMPTY_QUEUE }))).toBe(false)
})

test('Fire — apply без вердикту черги: an apply errand the queue step did not see stays open for the next event', () => {
  const r = reg({ errands: [errand(1, { action: { kind: 'apply' }, when: { kind: 'closed' } }), errand(2, { when: { kind: 'closed' } })], nextErrand: 3 })
  const out = fire(r, { kind: 'closed', names: [] }, 1, undefined)!
  expect(out.fired.map(e => e.id)).toEqual(['e2'])
  expect(out.registry.errands![0]!.state).toBe('open')
  expect(fire(reg({ errands: [errand(1, { action: { kind: 'apply' }, when: { kind: 'closed' } })], nextErrand: 2 }), { kind: 'closed', names: [] }, 1, undefined)).toBeUndefined()
})

test('Ворота й тексти: a missing registry reads no usage; errand_remove without an id names the field; a failed claim leaves a debug line', async () => {
  expect(wantsSize(missingRead(reg()))).toBe(false)
  const { io } = errandHarness(reg())
  const none = await errandRemove(io, undefined)
  expect('deny' in none && none.deny).toBe('"id" is an errand id, e.g. "e1"; errand_list lists them (NO_ERRAND)')
  const debug: string[] = []
  const fired = reg({ errands: [errand(1, { state: 'fired', firedAt: 1, result: 'R1' })], nextErrand: 2 })
  expect(await claimDelivery({ readTags: async () => okRead(fired), writeTags: async () => Promise.reject(new Error('disk')), now: () => 1, debug: t => void debug.push(t) })).toBeUndefined()
  expect(await claimDelivery({ readTags: async () => unreadableRead('bad json'), writeTags: async () => undefined, now: () => 1, debug: t => void debug.push(t) })).toBeUndefined()
  expect(debug).toEqual(['delivery not claimed: disk', 'delivery not claimed: the tag registry cannot be read (bad json)'])
})
