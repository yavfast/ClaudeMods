import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { AliasRegistry } from '../hooks/aliases'
import { EMPTY_ALIASES } from '../hooks/aliases'
import type { Deliveries } from '../hooks/deliveries'
import type { Journal } from '../hooks/journal'
import {
  cleanLedger,
  dropPulled,
  emptyLedger,
  handleRepair,
  inputHandles,
  MAX_LEDGER_HANDLES,
  needsRepair,
  newRepairMemory,
  parseLedger,
  pulledOf,
  recordInputs,
  REPAIR_DELAY_MS,
  REPAIR_REFUSED,
  REPAIR_SKIP,
  repairAtTurnEnd,
  repairLine,
  repairSwitched,
  repeatsIn,
  runRepair,
  scheduleRepair,
  withLedgerEntry,
  type ApplyLedger,
  type NeedsIO,
  type RepairHandlerIO,
  type RepairIO,
  type RepairMemory,
} from '../hooks/repair'
import { MARK, SUMMARIZED } from '../hooks/rows'
import { collectMedia } from '../hooks/edits'
import type { Read } from '../hooks/store'
import type { TagRegistry } from '../hooks/tags'
import { PERSON_TEXT } from './delivery-fixtures'
import { missingRead, okRead, prompt, reg, reply, result, unreadableRead, use } from './row-fixtures'

const ledger = (...handles: string[][]): ApplyLedger => ({ entries: handles.map((h, k) => ({ at: k + 1, handles: h })) })
const thinking = (handle?: string): SessionMessage => reply('', handle)
const NO_JOURNAL: Read<Journal> = missingRead({ entries: [] })
const APPLIED: Read<Journal> = okRead({ entries: [{ kind: 'apply', at: 1, edits: 1, archive: '/a.json', compressed: [] }] })

// The loaded chain of a resumed process (live check of phase 32, session
// 26ed3e59): the apply returned T1 and T3 with their handles, so the loader
// put their originals (handles = the apply's input handles) beside the copies.
const K1_LEDGER = ledger(['t1-think', 't1-call', 't1-res', 't1-text', 't2-think', 't2-call', 't2-res', 't2-text', 't3-call', 't3-res', 't3-text', 't4-call'])
function k1(): SessionMessage[] {
  return [
    prompt('T1: remember HARBOR-12', 'p1'),
    thinking('c-t1-think'),
    thinking('t1-think'),
    use('9y', 'Bash', 't1-call'),
    result('9y', 'alpha-one', 't1-res'),
    use('9y', 'Bash', 'c-t1-call'),
    result('9y', 'alpha-one', 'c-t1-res'),
    reply('alpha-one', 'c-t1-text'),
    reply('alpha-one', 't1-text'),
    prompt('T2: seq', 'p2'),
    use('g6', 'Bash', 'c-t2-call'),
    result('g6', `${SUMMARIZED}: numbers 1..300`, 'c-t2-res'),
    reply('seen', 'c-t2-text'),
    prompt('T3: echo', 'p3'),
    use('9K', 'Bash', 'c-t3-call'),
    use('9K', 'Bash', 't3-call'),
    result('9K', 'gamma-three', 't3-res'),
    result('9K', 'gamma-three', 'c-t3-res'),
    reply('gamma-three', 'c-t3-text'),
    reply('gamma-three', 't3-text'),
    prompt('T5: ok5', 'p5'),
    thinking('c-t5-think'),
    reply('ok5', 'c-t5-text'),
  ]
}

// ---- ApplyLedger, RecordInputs

test('ApplyLedger — розбір: ok, unreadable on a bad entry, a repeated handle, too many handles', () => {
  expect(parseLedger(JSON.stringify(ledger(['a', 'b'])))).toEqual(okRead(ledger(['a', 'b'])))
  expect(parseLedger('{"entries":[{"at":1,"handles":[]}]}').state).toBe('unreadable')
  expect(parseLedger('{"entries":[{"at":1,"handles":["a","a"]}]}').state).toBe('unreadable')
  expect(parseLedger('{"entries":{}}').state).toBe('unreadable')
  expect(parseLedger('[').state).toBe('unreadable')
})

test('RecordInputs — запис входу: assistant rows and rows with results that carry a handle; prompts and other user rows never', () => {
  const rows = [prompt('task', 'h1'), use('a', 'Bash', 'h2'), result('a', 'out', 'h3'), prompt('<command-name>/x</command-name>', 'h4'), reply('rebuilt')]
  expect(inputHandles(rows)).toEqual(['h2', 'h3'])
  expect(recordInputs(emptyLedger(), rows, 77)).toEqual({ entries: [{ at: 77, handles: ['h2', 'h3'] }] })
  // nothing to record: no write
  expect(recordInputs(emptyLedger(), [prompt('task', 'h1'), reply('x')], 77)).toBeUndefined()
})

test('RecordInputs — обрізання: the oldest entries go while the handles exceed MAX_LEDGER_HANDLES', () => {
  const big = { at: 1, handles: Array.from({ length: MAX_LEDGER_HANDLES - 10 }, (_, i) => `o${i}`) }
  const next = withLedgerEntry({ entries: [big] }, { at: 2, handles: Array.from({ length: 20 }, (_, i) => `n${i}`) })
  expect(next.entries.map(e => e.at)).toEqual([2])
  const small = withLedgerEntry(ledger(['a']), { at: 9, handles: ['b'] })
  expect(small.entries.map(e => e.at)).toEqual([1, 9])
})

test('PulledOf — застосування в сесії: an entry of the ledger or an apply of the journal; an unreadable ledger reads as empty', () => {
  expect(pulledOf(okRead(ledger(['a'])), NO_JOURNAL)).toEqual({ ledger: ledger(['a']), applied: true, unreadable: false, clean: false })
  expect(pulledOf(missingRead(emptyLedger()), APPLIED).applied).toBe(true)
  expect(pulledOf(missingRead(emptyLedger()), NO_JOURNAL).applied).toBe(false)
  expect(pulledOf(unreadableRead(), APPLIED)).toEqual({ ledger: emptyLedger(), applied: true, unreadable: true, clean: false })
})

// ---- DropPulled

test('DropPulled — двійник за ідентифікаторами: both originals go, the copy changed by summarize stays', () => {
  const rows = [prompt('go', 'p'), use('a', 'Read', 'h1'), result('a', 'x'.repeat(5000), 'h2'), use('a', 'Read', 'h5'), result('a', `${SUMMARIZED}: short`, 'h6')]
  const out = dropPulled(rows, ledger(['h1', 'h2']), true)
  expect(out.dropped).toEqual([1, 2])
  expect(out.kept.map(r => r.handle)).toEqual(['p', 'h5', 'h6'])
  expect(out.residual).toBe(0)
})

test('DropPulled — текстова відповідь і thinking: a twin in the same stretch / in another stretch / thinking alone', () => {
  const same = [prompt('T1', 'p'), reply('alpha-one', 'c'), reply('alpha-one', 'o')]
  expect(dropPulled(same, ledger(['o']), true).dropped).toEqual([2])
  const other = [prompt('T1', 'p'), reply('alpha-one', 'o'), prompt('T2', 'q'), reply('alpha-one', 'c')]
  expect(dropPulled(other, ledger(['o']), true).dropped).toEqual([])
  expect(dropPulled([prompt('T1', 'p'), thinking('o'), reply('hi', 'c')], ledger(['o']), true).dropped).toEqual([1])
})

test('DropPulled — без двійника: originals the host loaded alone (the walk crossed the boundary, session b) stay; a prompt never goes', () => {
  const rows = [prompt('T1', 'p1'), use('a', 'Bash', 'h1'), result('a', 'alpha', 'h2'), reply('alpha', 'h3'), prompt('T2', 'p2')]
  const out = dropPulled(rows, ledger(['p1', 'h1', 'h2', 'h3']), true)
  expect(out.dropped).toEqual([])
  expect(out.kept).toEqual(rows)
})

test('DropPulled — паралельні виклики: an original with calls a and b goes when MergeCallRows wrote the copies as one row or two', () => {
  const orig: SessionMessage = { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Bash', input: {} }, { tool_use_id: 'b', tool: 'Bash', input: {} }], handle: 'o' }
  const rows = [prompt('go', 'p'), orig, use('a', 'Bash', 'ca'), use('b', 'Bash', 'cb'), result('a', 'x', 'ra'), result('b', 'y', 'rb')]
  expect(dropPulled(rows, ledger(['o']), true).dropped).toEqual([1])
})

test('DropPulled — залишкове правило: without the ledger in a session the mod applied in; the last of identical rows, the replacement, nothing when ambiguous; nothing without an apply', () => {
  const twice = [prompt('go'), use('a', 'Bash'), result('a', 'out'), use('a', 'Bash'), result('a', 'out')]
  const out = dropPulled(twice, emptyLedger(), true)
  expect(out.dropped).toEqual([1, 2])
  expect(out.residual).toBe(2)
  const replaced = [prompt('go'), use('a', 'Bash'), result('a', 'full output'), result('a', `${SUMMARIZED}: short`)]
  expect(dropPulled(replaced, emptyLedger(), true).dropped).toEqual([2])
  const differ = [prompt('go'), use('a', 'Bash'), result('a', 'one'), result('a', 'two')]
  expect(dropPulled(differ, emptyLedger(), true).dropped).toEqual([])
  expect(dropPulled(twice, emptyLedger(), false)).toEqual({ kept: twice, dropped: [], residual: 0 })
})

test('DropPulled — завантажений ланцюжок (жива перевірка фази 32): the 7 originals of T1 and T3 go, every copy and the summarize stay', () => {
  const rows = k1()
  const out = dropPulled(rows, K1_LEDGER, true)
  expect(out.dropped).toEqual([2, 3, 4, 8, 15, 16, 19])
  expect(out.kept.some(r => r.toolResults?.some(t => t.text.startsWith(SUMMARIZED)))).toBe(true)
  expect(out.residual).toBe(0)
})

test('RepeatsIn — без handle: a call id twice, an answer twice in one stretch; none when every row is once', () => {
  const plain = (rows: SessionMessage[]) => rows.map(r => ({ ...r, handle: undefined }))
  expect(repeatsIn(plain(k1()))).toBe(true)
  expect(repeatsIn([prompt('T1'), reply('alpha'), reply('alpha')])).toBe(true)
  expect(repeatsIn([prompt('T1'), reply('ok'), prompt('T2'), reply('ok')])).toBe(false)
  expect(repeatsIn([prompt('go'), use('a'), result('a'), reply('done')])).toBe(false)
})

// ---- NeedsRepair

function needsIO(over: Partial<NeedsIO> = {}): NeedsIO {
  return {
    sessionId: async () => 's1',
    storage: async () => '/s',
    pulled: async () => pulledOf(okRead(K1_LEDGER), NO_JOURNAL),
    trusted: async () => false,
    rows: async () => k1().map(r => ({ ...r, handle: undefined })),
    ...over,
  }
}

test('NeedsRepair — новий процес: an untrusted boundary, a ledger entry, rows with repeats', async () => {
  expect(await needsRepair(needsIO(), {})).toBe(true)
})

test('NeedsRepair — той самий процес чи нічого лагодити: a trusted boundary / compacted here / no apply / no repeats / no storage / an unreadable ledger', async () => {
  expect(await needsRepair(needsIO({ trusted: async () => true }), {})).toBe(false)
  expect(await needsRepair(needsIO(), { compactedHere: 's1' })).toBe(false)
  expect(await needsRepair(needsIO({ pulled: async () => pulledOf(missingRead(emptyLedger()), NO_JOURNAL) }), {})).toBe(false)
  expect(await needsRepair(needsIO({ rows: async () => [prompt('go'), reply('done')] }), {})).toBe(false)
  expect(await needsRepair(needsIO({ storage: async () => undefined }), {})).toBe(false)
  expect(await needsRepair(needsIO({ pulled: async () => pulledOf(unreadableRead(), APPLIED) }), {})).toBe(false)
})

// ---- ScheduleRepair, RunRepair

function repairHost(over: Partial<RepairIO> = {}, mem: RepairMemory = newRepairMemory()) {
  const log = { timers: [] as { ms: number; fn: () => void }[], commands: 0, statuses: [] as string[], lines: [] as string[], session: 's1' }
  const io: RepairIO = {
    sessionId: async () => log.session,
    after: (ms, fn) => void log.timers.push({ ms, fn }),
    needs: async () => true,
    command: async () => {
      log.commands++
      mem.last = { session: log.session, dropped: 7, rows: 20, media: 0 }
    },
    status: t => void log.statuses.push(t),
    log: t => void log.lines.push(t),
    ...over,
  }
  return { io, log, mem }
}

test('ScheduleRepair — одна спроба: session.start twice for one session plans one timer of REPAIR_DELAY_MS; none after a refusal', async () => {
  const { io, log, mem } = repairHost()
  expect(await scheduleRepair(io, mem)).toBe(true)
  expect(await scheduleRepair(io, mem)).toBe(false)
  expect(log.timers.map(t => t.ms)).toEqual([REPAIR_DELAY_MS])
  const refused = repairHost({ after: () => { throw new Error('no timers') } })
  expect(await scheduleRepair(refused.io, refused.mem)).toBe(false)
  expect(refused.mem.state).toBe('failed')
  expect(await scheduleRepair(refused.io, refused.mem)).toBe(false)
})

test('ScheduleRepair — перемикання в процесі: the switch waits for the turn end, which plans the timer once', async () => {
  const { io, log, mem } = repairHost()
  await scheduleRepair(io, mem)
  log.session = 's2'
  repairSwitched(mem, 's2')
  expect(mem).toEqual({ session: 's2', state: 'none', atTurnEnd: true, compactedHere: undefined, last: undefined })
  expect(await repairAtTurnEnd(io, mem)).toBe(true)
  expect(await repairAtTurnEnd(io, mem)).toBe(false)
  expect(log.timers.length).toBe(2)
})

test('RunRepair — ремонт: the command once, then the person\'s line of the handler\'s summary; state done', async () => {
  const { io, log, mem } = repairHost()
  await scheduleRepair(io, mem)
  expect(await runRepair(io, mem)).toBe('repaired')
  expect(log.commands).toBe(1)
  expect(log.lines).toEqual(['repaired the resumed conversation: dropped 7 row(s) loaded twice'])
  expect(mem.state).toBe('done')
})

test('RunRepair — відмова і перемикання: refused / switched before the timer / the handler skipped / nothing to repair', async () => {
  const refused = repairHost({ command: async () => { throw new Error('no session is bound in this process') } })
  await scheduleRepair(refused.io, refused.mem)
  expect(await runRepair(refused.io, refused.mem)).toBe('refused')
  expect(refused.log.statuses).toEqual([`${REPAIR_REFUSED}no session is bound in this process`])
  expect(refused.mem.state).toBe('failed')
  expect(await scheduleRepair(refused.io, refused.mem)).toBe(false)

  const moved = repairHost()
  await scheduleRepair(moved.io, moved.mem)
  moved.log.session = 's2'
  expect(await runRepair(moved.io, moved.mem)).toBe('switched')
  expect(moved.log.commands).toBe(0)

  const skipped = repairHost({ command: async () => undefined })
  await scheduleRepair(skipped.io, skipped.mem)
  expect(await runRepair(skipped.io, skipped.mem)).toBe('skipped')
  expect(skipped.mem.state).toBe('failed')
  expect(skipped.log.lines).toEqual([])

  const clean = repairHost({ needs: async () => false })
  await scheduleRepair(clean.io, clean.mem)
  expect(await runRepair(clean.io, clean.mem)).toBe('clean')
  expect(clean.log.commands).toBe(0)
  expect(clean.mem.state).toBe('done')
})

test('RepairLine — медіа: the count of results carried as files', () => {
  expect(repairLine({ dropped: 3, media: 1 })).toBe('repaired the resumed conversation: dropped 3 row(s) loaded twice; media of 1 result(s) carried as files')
})

// ---- HandleRepair

const PNG = 'iVBORw0KGgo='

function handler(over: Partial<RepairHandlerIO> = {}, ledgerRead: Read<ApplyLedger> = okRead(K1_LEDGER)) {
  const written = { media: [] as string[], tags: undefined as TagRegistry | undefined, aliases: undefined as AliasRegistry | undefined, boundary: false, ledgerCleared: false, pruned: undefined as ReadonlySet<string> | undefined, toasts: [] as string[] }
  const io: RepairHandlerIO = {
    dir: '/s',
    now: () => 42,
    handoffRunning: () => false,
    readLedger: async () => ledgerRead,
    readJournal: async () => NO_JOURNAL,
    readApi: async () => [],
    writeMedia: async path => {
      written.media.push(path)
      return true
    },
    isAborted: () => false,
    toast: t => void written.toasts.push(t),
    readTags: async () => missingRead(reg()),
    writeTags: async r => void (written.tags = r),
    readAliases: async () => missingRead({ ...EMPTY_ALIASES, map: {} }),
    writeAliases: async r => void (written.aliases = r),
    hostId: () => 'host:1',
    writeBoundary: async () => void (written.boundary = true),
    clearLedger: () => void (written.ledgerCleared = true),
    ...over,
  }
  return { io, written }
}

test('HandleRepair — ремонт: the originals go, so do rows of thinking alone; no assistant or result row keeps a handle, prompts do; pairs whole; boundary, ledger cleared, summary', async () => {
  const { io, written } = handler()
  const done = await handleRepair(io, k1())
  if (!('messages' in done.outcome)) throw new Error(JSON.stringify(done.outcome))
  const rows = done.outcome.messages
  expect(rows.filter(r => r.role === 'assistant' || r.toolResults?.length).every(r => r.handle === undefined)).toBe(true)
  expect(rows.filter(r => r.role === 'user' && !r.toolResults?.length).map(r => r.handle)).toEqual(['p1', 'p2', 'p3', 'p5'])
  expect(rows.map(r => r.text || r.toolUses[0]?.tool_use_id || r.toolResults?.[0]?.tool_use_id)).toEqual([
    'T1: remember HARBOR-12', '9y', '9y', 'alpha-one', 'T2: seq', 'g6', 'g6', 'seen', 'T3: echo', '9K', '9K', 'gamma-three', 'T5: ok5', 'ok5',
  ])
  expect(done.summary).toEqual({ dropped: 7, rows: 14, media: 0 })
  expect(written.boundary).toBe(true)
  expect(written.ledgerCleared).toBe(true)
  expect(written.toasts).toEqual(['context-editor: repaired the resumed conversation (7 rows loaded twice)'])
})

test('HandleRepair — медіа і доставки: a PNG result goes to a file named by CarryNote; a failed write skips; a delivery behind a rebuilt result goes back as a row', async () => {
  const rows = [prompt('go', 'p'), use('a', 'Read', 'o1'), result('a', '', 'o2'), use('a', 'Read', 'c1'), result('a', '', 'c2'), reply('seen', 'c3')]
  const api = [{ role: 'user', content: 'go' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] }]
  const delivery: Deliveries = { items: [{ uuid: 'u1', anchor: ['a'], kind: 'person', origin: 'queued_command', text: PERSON_TEXT, cut: 0, media: 0, at: 1 }] }
  const { io, written } = handler({ readApi: async () => api, readDeliveries: async () => okRead(delivery), pruneDeliveries: d => void (written.pruned = d) }, okRead(ledger(['o1', 'o2'])))
  const done = await handleRepair(io, rows)
  if (!('messages' in done.outcome)) throw new Error(JSON.stringify(done.outcome))
  expect(written.media).toEqual(['/s/42/1.png'])
  const res = done.outcome.messages.find(r => r.toolResults?.length)!
  expect(res.toolResults![0]!.text).toBe(`${MARK} media carried as files (open them with Read): image/png /s/42/1.png`)
  const at = done.outcome.messages.indexOf(res)
  expect(done.outcome.messages[at + 1]).toEqual({ role: 'user', text: PERSON_TEXT, toolUses: [] })
  expect([...written.pruned!]).toEqual(['u1'])
  expect(done.summary!.media).toBe(1)

  const failing = handler({ readApi: async () => api, writeMedia: async () => false }, okRead(ledger(['o1', 'o2'])))
  expect((await handleRepair(failing.io, rows)).outcome).toEqual({ skip: REPAIR_SKIP.media })
  expect(failing.written.tags).toBeUndefined()
})

test('HandleRepair — нічого не робить: nothing to drop / unreadable ledger / handoff running / abandoned before the commit / a call left without its result', async () => {
  const quiet = [prompt('go', 'p'), use('a', 'Bash', 'x1'), result('a', 'out', 'x2')]
  expect((await handleRepair(handler().io, quiet)).outcome).toEqual({ skip: REPAIR_SKIP.nothing })
  expect((await handleRepair(handler({}, unreadableRead()).io, k1())).outcome).toEqual({ skip: REPAIR_SKIP.ledger })
  expect((await handleRepair(handler({ handoffRunning: () => true }).io, k1())).outcome).toEqual({ skip: REPAIR_SKIP.handoff })
  const aborted = handler({ isAborted: () => true })
  expect((await handleRepair(aborted.io, k1())).outcome).toEqual({ skip: REPAIR_SKIP.abandoned })
  expect(aborted.written.tags).toBeUndefined()
  expect(aborted.written.ledgerCleared).toBe(false)
  // a call the loaded chain left without its result: the rebuilt list would break the pairs
  const broken = [prompt('go', 'p'), use('x', 'Bash', 'u1'), prompt('next', 'q'), reply('hi', 'o1'), reply('hi', 'c1')]
  const out = (await handleRepair(handler({}, okRead(ledger(['o1']))).io, broken)).outcome
  expect(out).toEqual({ skip: REPAIR_SKIP.pairs('row 1: call x has no result before the next prompt') })
})

test('HandleRepair — покинуто під час фіксації: registries already written go back as read', async () => {
  let aborted = false
  const writes: string[] = []
  const before = reg({ turn: 3 })
  const { io } = handler({
    readTags: async () => okRead(before),
    writeTags: async r => {
      writes.push(r === before ? 'tags back' : 'tags')
      aborted = true
    },
    isAborted: () => aborted,
  })
  expect((await handleRepair(io, k1())).outcome).toEqual({ skip: REPAIR_SKIP.abandoned })
  expect(writes).toEqual(['tags', 'tags back'])
})

// ---- review of phase 32

test('DropPulled — залишкове правило, частковий двійник: a row goes only when the replacement holds all its ids (original [a,b], copy a summarized, copy b)', () => {
  const both: SessionMessage = { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'full a', isError: false }, { tool_use_id: 'b', text: 'full b', isError: false }] }
  const calls: SessionMessage = { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Bash', input: {} }, { tool_use_id: 'b', tool: 'Bash', input: {} }] }
  const rows = [prompt('go'), calls, both, result('a', `${SUMMARIZED}: short`), result('b', 'full b')]
  const out = dropPulled(rows, emptyLedger(), true)
  expect(out.dropped).toEqual([])
  expect(out.kept.some(r => r.toolResults?.some(t => t.tool_use_id === 'b'))).toBe(true)
})

test('DropPulled — пари цілі: a drop that would leave a call without a later result is undone', () => {
  // the copy of the call has no copy of its result: dropping the original call leaves the result before any call
  const rows = [prompt('go', 'p'), use('a', 'Bash', 'o1'), result('a', 'out', 'o2'), use('a', 'Bash', 'c1')]
  const out = dropPulled(rows, ledger(['o1', 'o2']), true)
  expect(out.dropped).toEqual([])
  expect(out.kept).toEqual(rows)
})

test('DropPulled — правило (3) за кількістю: one copy is the twin of one original only', () => {
  const rows = [prompt('T1', 'p'), reply('Done.', 'o1'), reply('Done.', 'c'), reply('Done.', 'o2')]
  expect(dropPulled(rows, ledger(['o1', 'o2']), true).dropped).toEqual([1])
})

test('NeedsRepair — вердикт «нічого лагодити»: a clean ledger keeps the next process quiet; the next apply\'s record drops the verdict', async () => {
  const clean = cleanLedger(K1_LEDGER)!
  expect(parseLedger(JSON.stringify(clean))).toEqual(okRead(clean))
  expect(parseLedger('{"entries":[],"clean":1}').state).toBe('unreadable')
  expect(cleanLedger(clean)).toBeUndefined()
  expect(await needsRepair(needsIO({ pulled: async () => pulledOf(okRead(clean), NO_JOURNAL) }), {})).toBe(false)
  expect(recordInputs(clean, [use('a', 'Bash', 'h')], 5)!.clean).toBeUndefined()
})

test('HandleRepair — нічого лагодити: the verdict is recorded once the handler skips; not after an abandon', async () => {
  let marks = 0
  const quiet = [prompt('T1', 'p'), reply('Done.', 'x1'), use('a', 'Bash', 'x2'), result('a', 'out', 'x3'), reply('Done.', 'x4')]
  expect((await handleRepair(handler({ markClean: () => void marks++ }).io, quiet)).outcome).toEqual({ skip: REPAIR_SKIP.nothing })
  expect(marks).toBe(1)
  await handleRepair(handler({ markClean: () => void marks++, isAborted: () => true }).io, quiet)
  expect(marks).toBe(1)
})

test('HandleRepair — покинуто після фіксації (CONC-02): no boundary, ledger or deliveries write once the host gave up', async () => {
  let aborted = false
  const { io, written } = handler({ toast: () => void (aborted = true), isAborted: () => aborted, pruneDeliveries: d => void (written.pruned = d) })
  const done = await handleRepair(io, k1())
  expect('messages' in done.outcome).toBe(true)
  expect(written.boundary).toBe(false)
  expect(written.ledgerCleared).toBe(false)
  expect(written.pruned).toBeUndefined()
})

test('CollectMedia — результат двічі в завантаженому ланцюжку: its media counts once (one file, one CarryNote item)', async () => {
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }
  const api = [
    { role: 'user', content: 'go' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [img] }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [img] }] },
  ]
  expect(collectMedia(api, []).found.get('u:a')!.length).toBe(1)
  const rows = [prompt('go', 'p'), use('a', 'Read', 'o1'), result('a', '', 'o2'), use('a', 'Read', 'c1'), result('a', '', 'c2')]
  const { io, written } = handler({ readApi: async () => api }, okRead(ledger(['o1', 'o2'])))
  const done = await handleRepair(io, rows)
  if (!('messages' in done.outcome)) throw new Error(JSON.stringify(done.outcome))
  expect(written.media).toEqual(['/s/42/1.png'])
})
