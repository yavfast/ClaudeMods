// [SP_HELP_01_05] [SP_HELP_02_06] [SP_HELP_02_07] [SP_HELP_02_08] The
// agent's conditional errands (PL_HELP phase 7): the record in the tag
// registry, the operations of `context_helper`, CheckErrands and Fire on the
// mod's events, and DeliveryBlock, the one block of due note reminders and
// fired errands that reaches the agent only at a safe moment: with a tool's
// result, in the hidden context of a prompt that passes the mod's hooks, or
// in the text of the mod's own prompt. Pure, behind ports; register.ts binds
// them. The top level uses no import, so the module may sit in an import
// cycle (tags.ts parses the registry with it).

import { MAX_STAGE_NAME } from './stages'
import { MAX_NOTE, MAX_REMIND, dueReminders } from './notes'
import { CACHE_TTL_MS } from './cacheclock'
import { oneLine } from './edits'
import { askFields, foldsOf } from './ask'
import { MARK, PLAIN_RATIO, errorText } from './rows'
import { isCount, type Read } from './store'
import type { TagRegistry } from './tags'
import type { FoldLedger } from './folds'
import type { Queue } from './queue'
import { errandMarked } from './batches'

// [SP_HELP_01_09] The constants of the errands.
export const ERRAND_PREFIX = 'e'
export const MAX_ERRANDS = 20
export const MAX_ERRAND_RESULT = 16_000
export const MAX_SIZE_TOKENS = 10_000_000
export const STALE_RUNNING_MS = 240_000
export const MAX_DELIVERY = 32_000
// the head of the condition and action texts the operations echo
const ECHO = 80

// [SP_HELP_01_05] Condition, Action and Errand.
export type Condition = { kind: 'turns'; n: number } | { kind: 'size'; n: number } | { kind: 'cold' } | { kind: 'closed'; name?: string }
export type Action = { kind: 'remind'; text: string } | { kind: 'ask'; folds: string[]; question: string } | { kind: 'apply' }
export type ErrandState = 'open' | 'running' | 'fired'
export type Errand = {
  id: string
  when: Condition
  action: Action
  wake: boolean
  createdTurn: number
  state: ErrandState
  result?: string
  firedAt?: number
}

const ERRAND_ID = new RegExp(`^${ERRAND_PREFIX}[1-9]\\d*$`)

function isCondition(c: unknown): c is Condition {
  if (!c || typeof c !== 'object') return false
  const x = c as Record<string, unknown>
  const keys = Object.keys(x)
  if (x.kind === 'turns') return keys.length === 2 && isCount(x.n, 1) && (x.n as number) <= MAX_REMIND
  if (x.kind === 'size') return keys.length === 2 && isCount(x.n, 1) && (x.n as number) <= MAX_SIZE_TOKENS
  if (x.kind === 'cold') return keys.length === 1
  if (x.kind === 'closed') return x.name === undefined ? keys.length === 1 : keys.length === 2 && isRegionName(x.name)
  return false
}

function isAction(a: unknown): a is Action {
  if (!a || typeof a !== 'object') return false
  const x = a as Record<string, unknown>
  const keys = Object.keys(x)
  if (x.kind === 'remind') return keys.length === 2 && typeof x.text === 'string' && !!x.text && x.text.length <= MAX_NOTE
  if (x.kind === 'ask')
    return keys.length === 3 && Array.isArray(x.folds) && x.folds.length > 0 && x.folds.every(f => typeof f === 'string') && typeof x.question === 'string' && !!x.question
  if (x.kind === 'apply') return keys.length === 1
  return false
}

function isRegionName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= MAX_STAGE_NAME
}

// [SP_HELP_01_05] One errand as the registry keeps it: `result` with
// `fired`, `firedAt` with `running` and `fired`.
export function isErrand(e: unknown): e is Errand {
  if (!e || typeof e !== 'object') return false
  const x = e as Partial<Errand>
  if (typeof x.id !== 'string' || !ERRAND_ID.test(x.id) || !isCondition(x.when) || !isAction(x.action)) return false
  if (typeof x.wake !== 'boolean' || !isCount(x.createdTurn, 0)) return false
  if (x.state !== 'open' && x.state !== 'running' && x.state !== 'fired') return false
  if (x.state === 'fired' ? typeof x.result !== 'string' || x.result.length > MAX_ERRAND_RESULT : x.result !== undefined) return false
  return x.state === 'open' ? x.firedAt === undefined : typeof x.firedAt === 'number' && Number.isFinite(x.firedAt)
}

// [SP_CTX_01_10] The registry's `errands` and `nextErrand`: the name of the
// bad field, or false. Ids are unique and below `nextErrand`.
export function badErrandFields(errands: unknown, nextErrand: unknown): string | false {
  if (nextErrand !== undefined && !isCount(nextErrand, 1)) return 'nextErrand'
  if (errands === undefined) return false
  if (!Array.isArray(errands) || !errands.every(isErrand)) return 'errands'
  const next = (nextErrand as number | undefined) ?? 1
  const ids = new Set(errands.map(e => e.id))
  return ids.size !== errands.length || errands.some(e => Number(e.id.slice(ERRAND_PREFIX.length)) >= next) ? 'errands' : false
}

// ---- texts

// [SP_HELP_02_06] The condition as errand_add echoes it; `cur` — Size now.
export function conditionText(c: Condition, createdTurn: number, cur?: number): string {
  switch (c.kind) {
    case 'turns':
      return `${c.n} turn(s) from now (turn ${createdTurn + c.n})`
    case 'size':
      return `the request reaches ~${c.n} tokens, the fixed part included${cur === undefined ? '' : ` (now ~${cur})`}`
    case 'cold':
      return `the prompt cache turns cold after an idle of over ${Math.round(CACHE_TTL_MS / 60_000)} min`
    case 'closed':
      return c.name === undefined ? 'a region closes' : `region "${c.name}" closes`
  }
}

// [SP_HELP_02_06] The condition as errand_list shows it: no "from now".
function listedCondition(c: Condition, createdTurn: number): string {
  return c.kind === 'turns' ? `turn ${createdTurn + c.n} (set at turn ${createdTurn})` : conditionText(c, createdTurn)
}

// [SP_HELP_02_07] The condition in the errand's line, short.
function shortCondition(c: Condition): string {
  switch (c.kind) {
    case 'turns':
      return `${c.n} turn(s)`
    case 'size':
      return `~${c.n} tokens`
    case 'cold':
      return 'cold cache'
    case 'closed':
      return c.name === undefined ? 'a region closed' : `region "${c.name}" closed`
  }
}

// [SP_HELP_02_06] The action as the operations echo it.
export function actionText(a: Action): string {
  switch (a.kind) {
    case 'remind':
      return `remind: "${oneLine(a.text, ECHO)}"`
    case 'ask':
      return `ask the helper about ${a.folds.join(', ')}: "${oneLine(a.question, ECHO)}"`
    case 'apply':
      return 'apply your deferred edits'
  }
}

// [SP_HELP_02_07] The errand's line: "your" names who set it, since the line
// also goes in the text of a prompt the host frames as the person's
// ([SP_CTX_DEC_17]).
export function errandLine(e: Pick<Errand, 'id' | 'when' | 'createdTurn'>, turn: number): string {
  return `${MARK} your errand ${e.id} fired (${shortCondition(e.when)}, set ${Math.max(0, turn - e.createdTurn)} turn(s) ago): `
}

// [SP_HELP_02_07] The texts of Fire and of a lost helper call.
export const APPLY_NOTHING = 'nothing deferred was queued'
export const APPLY_AFTER_TURN = 'your deferred edits apply after this turn'
export const APPLY_IN_IDLE = 'your deferred edits apply now, in this idle'
export const STALE_TEXT = 'the helper call did not finish: the host process ended or was reloaded'
export const HANDED_OFF_TEXT = 'the helper call did not finish: the session was handed off'

// The errand's result: its line and the text, cut to MAX_ERRAND_RESULT.
export function errandResult(e: Pick<Errand, 'id' | 'when' | 'createdTurn'>, turn: number, text: string): string {
  return (errandLine(e, turn) + text).slice(0, MAX_ERRAND_RESULT)
}

// ---- [SP_HELP_02_06] the operations

export type ErrandDeny =
  | 'HELPER_PASSED_OVER'
  | 'ERRAND_WHEN'
  | 'ERRAND_N'
  | 'ERRAND_ACTION'
  | 'ERRAND_TEXT'
  | 'ASK_QUESTION'
  | 'ASK_FOLDS'
  | 'FOLD_UNKNOWN'
  | 'ASK_MEDIA'
  | 'DENIED_STORAGE'
  | 'DENIED_REGISTRY_READ'
  | 'DENIED_REGISTRY_WRITE'
  | 'ERRANDS_FULL'
  | 'NO_ERRAND'

export type ErrandOut = { result: string } | { deny: string; code: ErrandDeny }

// [SP_HELP_02_06] What the operations need from the host; register.ts binds it.
export type ErrandIO = {
  passedOver: () => boolean
  storageDown: () => Promise<string | undefined>
  storageRefusal: (why: string) => string
  // the fold ledger as it is now, outside every chain (FOLD_UNKNOWN, ASK_MEDIA)
  readLedger: () => Promise<Read<FoldLedger>>
  // Size: context.tokens of the plain usage; undefined without a measure
  size: () => Promise<number | undefined>
  readTags: () => Promise<Read<TagRegistry>>
  writeTags: (reg: TagRegistry) => Promise<void>
  // the registry's read-modify-write on its serial chain
  onRegistry: <T>(work: () => Promise<T>) => Promise<T>
}

// [SP_HELP_02_02] [SP_HELP_02_06] HELPER_PASSED_OVER of an errand that asks
// the helper or applies edits.
export const ERRAND_PASSED_OVER =
  "this host passes over the mod's compaction hook: an errand that asks the helper or applies deferred edits cannot work here; an errand that reminds does."

export type ErrandArgs = Record<string, unknown>

const no = (code: ErrandDeny, deny: string): ErrandOut => ({ code, deny: `${deny} (${code})` })

// [SP_HELP_02_02] The fields each errand operation takes besides "op".
const ERRAND_FIELDS: Record<string, readonly string[]> = {
  errand_add: ['when', 'n', 'name', 'action', 'text', 'folds', 'question'],
  errand_list: [],
  errand_remove: ['id'],
}
const HELPER_FIELDS = ['folds', 'question', 'when', 'n', 'name', 'action', 'text', 'wake', 'id'] as const

// [SP_HELP_02_02] BAD_OP of an errand operation: an unknown op, or a field
// of another operation; undefined when the call may go on.
export function badHelperOp(args: ErrandArgs): string | undefined {
  const allowed = typeof args.op === 'string' ? ERRAND_FIELDS[args.op] : undefined
  if (!allowed) return '"op" is "ask", "errand_add", "errand_list" or "errand_remove" (BAD_OP)'
  const other = HELPER_FIELDS.filter(f => args[f] !== undefined && !allowed.includes(f))
  if (!other.length) return undefined
  const takes = allowed.length ? `it takes ${allowed.map(f => `"${f}"`).join(', ')}` : 'it takes no other field'
  return `"${args.op}" takes no ${other.map(f => `"${f}"`).join(', ')}; ${takes} (BAD_OP)`
}

// [SP_HELP_02_06] errand_add: the refusals in the order of the spec, with
// the storage before the fold ledger it reads (as Ask, §02_03); the
// registry's change on its chain with ERRANDS_FULL there.
export async function errandAdd(io: ErrandIO, args: ErrandArgs): Promise<ErrandOut> {
  const action = args.action
  if ((action === 'ask' || action === 'apply') && io.passedOver()) return { code: 'HELPER_PASSED_OVER', deny: ERRAND_PASSED_OVER }
  const when = args.when
  if (when !== 'turns' && when !== 'size' && when !== 'cold' && when !== 'closed')
    return no('ERRAND_WHEN', '"when" is "turns" (with "n"), "size" (with "n"), "cold" or "closed" (with an optional "name")')
  if ((when === 'cold' || when === 'closed') && args.n !== undefined) return no('ERRAND_WHEN', `"${when}" takes no "n"`)
  if (when !== 'closed' && args.name !== undefined) return no('ERRAND_WHEN', '"name" goes only with "when": "closed"')
  if (when === 'closed' && args.name !== undefined && !isRegionName(args.name)) return no('ERRAND_WHEN', `"name" is a region's name of 1..${MAX_STAGE_NAME} chars`)
  let cur: number | undefined
  if (when === 'turns' && (!isCount(args.n, 1) || (args.n as number) > MAX_REMIND)) return no('ERRAND_N', `"n" is a number of turns in 1..${MAX_REMIND}`)
  if (when === 'size') {
    if (!isCount(args.n, 1) || (args.n as number) > MAX_SIZE_TOKENS) return no('ERRAND_N', `"n" is a number of tokens up to ${MAX_SIZE_TOKENS}`)
    cur = await io.size().catch(() => undefined)
    if (cur !== undefined && (args.n as number) <= cur) return no('ERRAND_N', `the request is already ~${cur} tokens, the fixed part included`)
  }
  if (action !== 'remind' && action !== 'ask' && action !== 'apply') return no('ERRAND_ACTION', '"action" is "remind" (with "text"), "ask" (with "folds" and "question") or "apply"')
  if (action !== 'remind' && args.text !== undefined) return no('ERRAND_ACTION', '"text" goes only with "action": "remind"')
  if (action !== 'ask' && (args.folds !== undefined || args.question !== undefined)) return no('ERRAND_ACTION', '"folds" and "question" go only with "action": "ask"')
  if (action === 'remind' && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > MAX_NOTE)) return no('ERRAND_TEXT', `"remind" needs "text" of 1..${MAX_NOTE} chars`)
  let act: Action
  if (action === 'ask') {
    const checked = askFields(args)
    if ('deny' in checked) return checked
    act = { kind: 'ask', folds: checked.folds, question: checked.question }
  } else act = action === 'remind' ? { kind: 'remind', text: (args.text as string).trim() } : { kind: 'apply' }
  const down = await io.storageDown()
  if (down !== undefined) return { code: 'DENIED_STORAGE', deny: io.storageRefusal(down) }
  if (act.kind === 'ask') {
    const missing = await foldCheck(io, act.folds)
    if (missing) return missing
  }
  const cond: Condition =
    when === 'turns' || when === 'size' ? { kind: when, n: args.n as number } : when === 'closed' && args.name !== undefined ? { kind: 'closed', name: (args.name as string).trim() } : { kind: when }
  return io.onRegistry(async (): Promise<ErrandOut> => {
    const read = await io.readTags()
    if (read.state === 'unreadable') return { code: 'DENIED_REGISTRY_READ', deny: `the tag registry cannot be read (${read.reason}); it is left as it is.` }
    const reg = read.value
    const errands = reg.errands ?? []
    if (errands.length >= MAX_ERRANDS) return no('ERRANDS_FULL', `${errands.length} errands are set; remove one with errand_remove first.`)
    const next = reg.nextErrand ?? 1
    const errand: Errand = { id: `${ERRAND_PREFIX}${next}`, when: cond, action: act, wake: false, createdTurn: reg.turn, state: 'open' }
    try {
      await io.writeTags({ ...reg, errands: [...errands, errand], nextErrand: next + 1 })
    } catch (err) {
      return { code: 'DENIED_REGISTRY_WRITE', deny: `could not save the tag registry: ${errorText(err)}` }
    }
    return { result: `Errand ${errand.id} set: when ${conditionText(cond, reg.turn, cur)} → ${actionText(act)}.` }
  })
}

// [SP_HELP_02_03] FOLD_UNKNOWN and ASK_MEDIA of the named folds, as Ask
// checks them; their size and archives are checked when the errand fires.
async function foldCheck(io: Pick<ErrandIO, 'readLedger'>, ids: readonly string[]): Promise<ErrandOut | undefined> {
  const read = await io.readLedger().catch((err): Read<FoldLedger> => ({ state: 'unreadable', reason: errorText(err) }))
  const entries = foldsOf(read, ids)
  return 'deny' in entries ? entries : undefined
}

// [SP_HELP_02_06] errand_list: a read, no change.
export async function errandList(io: Pick<ErrandIO, 'readTags' | 'storageDown' | 'storageRefusal'>): Promise<ErrandOut> {
  const down = await io.storageDown()
  if (down !== undefined) return { code: 'DENIED_STORAGE', deny: io.storageRefusal(down) }
  const read = await io.readTags()
  if (read.state === 'unreadable') return { code: 'DENIED_REGISTRY_READ', deny: `the tag registry cannot be read (${read.reason}); it is left as it is.` }
  const errands = read.value.errands ?? []
  if (!errands.length) return { result: 'No errands.' }
  return {
    result: [
      `Errands: ${errands.length} of ${MAX_ERRANDS}.`,
      ...errands.map(e => `${e.id} [${e.state}]: when ${listedCondition(e.when, e.createdTurn)} → ${actionText(e.action)}${e.wake ? ' (wake)' : ''}`),
    ].join('\n'),
  }
}

// [SP_HELP_02_06] errand_remove: a running errand goes too; its helper call's
// late result finds no errand and is dropped (FinishAsk).
export async function errandRemove(io: Pick<ErrandIO, 'readTags' | 'writeTags' | 'onRegistry' | 'storageDown' | 'storageRefusal'>, id: unknown): Promise<ErrandOut> {
  const down = await io.storageDown()
  if (down !== undefined) return { code: 'DENIED_STORAGE', deny: io.storageRefusal(down) }
  return io.onRegistry(async (): Promise<ErrandOut> => {
    const read = await io.readTags()
    if (read.state === 'unreadable') return { code: 'DENIED_REGISTRY_READ', deny: `the tag registry cannot be read (${read.reason}); it is left as it is.` }
    const errands = read.value.errands ?? []
    if (typeof id !== 'string' || !id) return no('NO_ERRAND', '"id" is an errand id, e.g. "e1"; errand_list lists them')
    const gone = errands.find(e => e.id === id)
    if (!gone) return no('NO_ERRAND', `no errand ${oneLine(id, 40)}; errand_list lists them`)
    try {
      await io.writeTags({ ...read.value, errands: errands.filter(e => e !== gone) })
    } catch (err) {
      return { code: 'DENIED_REGISTRY_WRITE', deny: `could not save the tag registry: ${errorText(err)}` }
    }
    return { result: `Errand ${gone.id} removed.` }
  })
}

// ---- [SP_HELP_02_07] CheckErrands and Fire

// The events CheckErrands runs on: the end of a completed main turn (Size
// when measured), a marked output (Size with the output's estimate), a close
// (the names of the regions it closed; none: a block with no region), and a
// cold verdict (`idle`: the idle timer's, else the prompt's).
export type ErrandEvent = { kind: 'turn'; size?: number } | { kind: 'output'; size: number } | { kind: 'closed'; names: readonly string[] } | { kind: 'cold'; idle: boolean }

// Whether an open errand's condition holds on the event, at the registry's turn.
export function holds(e: Errand, ev: ErrandEvent, turn: number): boolean {
  if (e.state !== 'open') return false
  const c = e.when
  switch (c.kind) {
    case 'turns':
      return ev.kind === 'turn' && turn - e.createdTurn >= c.n
    case 'size':
      return (ev.kind === 'turn' || ev.kind === 'output') && ev.size !== undefined && ev.size >= c.n
    case 'cold':
      return ev.kind === 'cold'
    case 'closed':
      return ev.kind === 'closed' && (c.name === undefined || ev.names.includes(c.name))
  }
}

// Whether any errand of the registry may fire on the event.
export function anyHolds(reg: Pick<TagRegistry, 'errands' | 'turn'>, ev: ErrandEvent): boolean {
  return (reg.errands ?? []).some(e => holds(e, ev, reg.turn))
}

// [SP_HELP_02_07] Fire on the registry: `remind` and `apply` become `fired`
// with their result, `ask` becomes `running` (its question runs outside the
// chain). `deferred`: whether the queue held deferred edits when the apply
// was marked (undefined: no apply errand was expected). Pure.
export function fire(reg: TagRegistry, ev: ErrandEvent, now: number, deferred: boolean | undefined): { registry: TagRegistry; fired: Errand[] } | undefined {
  const errands = reg.errands ?? []
  // an `apply` errand the queue's step did not see waits for the next event
  const firing = (e: Errand) => holds(e, ev, reg.turn) && !(e.action.kind === 'apply' && deferred === undefined)
  if (!errands.some(firing)) return undefined
  const fired: Errand[] = []
  const next = errands.map((e): Errand => {
    if (!firing(e)) return e
    let f: Errand
    if (e.action.kind === 'ask') f = { ...e, state: 'running', firedAt: now }
    else {
      const text =
        e.action.kind === 'remind' ? e.action.text : !deferred ? APPLY_NOTHING : ev.kind === 'cold' && ev.idle ? APPLY_IN_IDLE : APPLY_AFTER_TURN
      f = { ...e, state: 'fired', firedAt: now, result: errandResult(e, reg.turn, text) }
    }
    fired.push(f)
    return f
  })
  return { registry: { ...reg, errands: next }, fired }
}

// [SP_HELP_02_07] The queue an `apply` errand marks: with deferred edits,
// `applyDeferred: true` without `coldSince` (it holds for any last request,
// DeferredHolds); undefined when there is none or the mark is there. Pure.
export function applyMarked(q: Queue): Queue | undefined {
  if (!q.edits.some(e => e.deferred) || errandMarked(q)) return undefined
  const { coldSince: _c, ...rest } = q
  return { ...rest, applyDeferred: true }
}

// [SP_HELP_02_07] Whether Size is worth a read: an open `size` errand, or a
// registry not known yet. Pure.
export function wantsSize(view: Read<TagRegistry> | undefined): boolean {
  return !view || view.state === 'unreadable' || (view.value.errands ?? []).some(e => e.state === 'open' && e.when.kind === 'size')
}

// [SP_HELP_02_07] Size on BigOutput: the request's size and the marked
// output's estimate, its chars ÷ the registry's chars per token
// (PLAIN_RATIO without one). Pure.
export function outputSize(size: number, chars: number, ratio?: number): number {
  return size + Math.round(chars / (ratio ?? PLAIN_RATIO))
}

// [SP_HELP_02_07] The `apply` errand's mark on the queue's chain (Update):
// whether deferred edits were queued then.
export async function markApply(update: (change: (q: Queue) => Queue | undefined) => Promise<unknown>): Promise<boolean> {
  let any = false
  await update(q => {
    any = q.edits.some(e => e.deferred)
    return applyMarked(q)
  })
  return any
}

// [SP_HELP_02_07] The room an errand's AskText has within MAX_ERRAND_RESULT
// after the errand's line (its turn count taken wide). Pure.
export function errandRoom(e: Pick<Errand, 'id' | 'when' | 'createdTurn'>): number {
  return MAX_ERRAND_RESULT - errandLine(e, e.createdTurn + 1_000_000).length
}

// [SP_HELP_02_07] What CheckErrands needs from the host; register.ts binds it.
export type CheckIO = {
  // the registry as this module instance last read or wrote it (a gate)
  peek: () => Read<TagRegistry> | undefined
  readTags: () => Promise<Read<TagRegistry>>
  // on the queue's chain: with deferred edits queued, `applyDeferred: true`
  // (no `coldSince`); whether there were any
  markApply: () => Promise<boolean>
  // the registry's change on its chain (Update): undefined writes nothing
  updateTags: (change: (reg: TagRegistry) => TagRegistry | undefined) => Promise<void>
  // the background question of a running `ask` errand
  ask: (errand: Errand) => void
  now: () => number
  debug: (text: string) => void
}

// [SP_HELP_02_07] CheckErrands: a known registry where nothing holds takes no
// chain; an `apply` errand marks the queue first, then the registry fires
// what holds, one chain after the other (CHAIN_RANK); the running `ask`
// errands start their questions. A failure leaves the errands open. The ids
// that fired.
export async function checkErrands(io: CheckIO, ev: ErrandEvent): Promise<string[]> {
  const view = io.peek()
  if (view && view.state !== 'unreadable' && !anyHolds(view.value, ev)) return []
  try {
    const read = view && view.state !== 'unreadable' ? view : await io.readTags()
    if (read.state === 'unreadable' || !anyHolds(read.value, ev)) return []
    const applies = (read.value.errands ?? []).some(e => holds(e, ev, read.value.turn) && e.action.kind === 'apply')
    const deferred = applies ? await io.markApply() : undefined
    let fired: Errand[] = []
    await io.updateTags(reg => {
      const out = fire(reg, ev, io.now(), deferred)
      fired = out?.fired ?? []
      return out?.registry
    })
    for (const e of fired) if (e.state === 'running') io.ask(e)
    return fired.map(e => e.id)
  } catch (err) {
    io.debug(`errands not checked: ${errorText(err)}`)
    return []
  }
}

// [SP_HELP_02_07] The end of an errand's question: on the registry's chain,
// an errand still there and still running becomes `fired` with the result;
// one removed meanwhile (errand_remove) or stale already drops it. Pure.
export function finishAsk(reg: TagRegistry, id: string, text: string): TagRegistry | undefined {
  const errands = reg.errands ?? []
  const e = errands.find(x => x.id === id)
  if (!e || e.state !== 'running') return undefined
  return { ...reg, errands: errands.map(x => (x === e ? { ...e, state: 'fired' as const, result: errandResult(e, reg.turn, text) } : x)) }
}

// [SP_HELP_02_07] A running errand older than STALE_RUNNING_MS lost its call.
function stale(e: Errand, now: number): boolean {
  return e.state === 'running' && e.firedAt !== undefined && now - e.firedAt > STALE_RUNNING_MS
}

// ---- [SP_HELP_02_08] DeliveryBlock

// What a delivery took off the registry, to put back when its prompt is dropped.
export type Claimed = { errands: Errand[]; notes: { id: string; remindAt: number }[] }

// Whether a delivery may find something: a note with a pending `remindAt`,
// an errand that fired or runs, or a registry not known yet. Pure.
export function deliveryPending(peek: Read<TagRegistry> | undefined): boolean {
  return !peek || peek.state === 'unreadable' || peek.value.notes.some(n => n.remindAt !== undefined) || (peek.value.errands ?? []).some(e => e.state !== 'open')
}

// [SP_HELP_02_08] DeliveryBlock: the due note reminders, then the fired
// errands by `firedAt`, together within MAX_DELIVERY; an errand that does not
// fit stays fired for the next moment. A stale running errand becomes fired
// with STALE_TEXT first. Undefined when nothing changes. Pure.
export function claimBlock(reg: TagRegistry, now: number): { registry: TagRegistry; lines: string[]; claimed: Claimed } | undefined {
  const due = dueReminders(reg)
  const base = due?.registry ?? reg
  const notes = due ? reg.notes.flatMap(n => (n.remindAt !== undefined && n.remindAt <= reg.turn ? [{ id: n.id, remindAt: n.remindAt }] : [])) : []
  const lines = [...(due?.lines ?? [])]
  let changed = !!due
  const errands = (base.errands ?? []).map((e): Errand => {
    if (!stale(e, now)) return e
    changed = true
    return { ...e, state: 'fired', result: errandResult(e, base.turn, STALE_TEXT) }
  })
  let size = lines.join('\n').length
  const taken = new Set<string>()
  for (const e of [...errands].filter(x => x.state === 'fired').sort((a, b) => a.firedAt! - b.firedAt!)) {
    const add = e.result!.length + (lines.length ? 1 : 0)
    if (size + add > MAX_DELIVERY) break
    lines.push(e.result!)
    size += add
    taken.add(e.id)
  }
  if (!changed && !taken.size) return undefined
  const registry = { ...base, errands: errands.filter(e => !taken.has(e.id)) }
  return { registry, lines, claimed: { errands: errands.filter(e => taken.has(e.id)), notes } }
}

// [SP_HELP_02_08] A dropped prompt puts the block back: the errands as
// fired (unless an errand with the same id is there), the notes' `remindAt`
// on notes still there without one. Undefined when nothing changes. Pure.
export function restoreBlock(reg: TagRegistry, claimed: Claimed): TagRegistry | undefined {
  const have = new Set((reg.errands ?? []).map(e => e.id))
  const back = claimed.errands.filter(e => !have.has(e.id))
  let notesChanged = false
  const notes = reg.notes.map(n => {
    const c = claimed.notes.find(x => x.id === n.id)
    if (!c || n.remindAt !== undefined) return n
    notesChanged = true
    return { ...n, remindAt: c.remindAt }
  })
  if (!back.length && !notesChanged) return undefined
  return { ...reg, notes, errands: [...(reg.errands ?? []), ...back] }
}

// [SP_HELP_02_13] The registry as it is once a delivery took its fired
// errands and due reminders: what context_list counts before it delivers
// them (a running errand is not taken as stale here). Pure.
export function afterDelivery(reg: TagRegistry): TagRegistry {
  return claimBlock(reg, Number.NEGATIVE_INFINITY)?.registry ?? reg
}

// [SP_HELP_02_08] The block of one delivery, claimed on the registry's chain;
// a failed write delivers nothing and the next moment tries again.
export type DeliveryIO = {
  readTags: () => Promise<Read<TagRegistry>>
  writeTags: (reg: TagRegistry) => Promise<void>
  now: () => number
  // [ERR-01] the reason nothing was claimed: an unreadable registry, a failed write
  debug?: (text: string) => void
}

export async function claimDelivery(io: DeliveryIO): Promise<{ lines: string[]; claimed: Claimed } | undefined> {
  const read = await io.readTags()
  if (read.state !== 'ok') {
    if (read.state === 'unreadable') io.debug?.(`delivery not claimed: the tag registry cannot be read (${read.reason})`)
    return undefined
  }
  const out = claimBlock(read.value, io.now())
  if (!out) return undefined
  try {
    await io.writeTags(out.registry)
  } catch (err) {
    io.debug?.(`delivery not claimed: ${errorText(err)}`)
    return undefined
  }
  return out.lines.length ? { lines: out.lines, claimed: out.claimed } : undefined
}

// [SP_HELP_02_08] The mod's own prompt with the block at the end of its text.
export function withBlock(text: string, lines: readonly string[]): string {
  return lines.length ? `${text}\n\n${lines.join('\n')}` : text
}

// [SP_HELP_02_08] The block of one moment: claimed on the registry's chain,
// put back there by one write when its prompt is dropped.
export type BlockPort = {
  claim: () => Promise<{ lines: string[]; claimed: Claimed } | undefined>
  restore: (claimed: Claimed) => Promise<void>
}

// [SP_HELP_02_08] The mod's own prompt (Flush's resume or optimization
// prompt, the compression turn's): the block at the end of its text; a
// refused prompt (`drop` or a throw: `submit` rejects) puts it back and
// rejects as before.
export async function submitWithBlock(port: BlockPort, submit: (text: string) => Promise<void>, text: string): Promise<void> {
  const block = await port.claim().catch(() => undefined)
  try {
    await submit(block ? withBlock(text, block.lines) : text)
  } catch (err) {
    if (block) await port.restore(block.claimed).catch(() => undefined)
    throw err
  }
}

// ---- [SP_HELP_02_13] [SP_HELP_02_14] telemetry and handoff

// [SP_HELP_02_13] The line of context_list; undefined without errands.
export function errandsLine(reg: Pick<TagRegistry, 'errands'>): string | undefined {
  const errands = reg.errands ?? []
  if (!errands.length) return undefined
  const open = errands.filter(e => e.state === 'open').length
  const waiting = errands.filter(e => e.state === 'fired').length
  return `Errands: ${errands.length} (${open} open, ${waiting} waiting for delivery); context_helper errand_list lists them.`
}

// [SP_HELP_02_14] The errands a handoff carries: a running one becomes fired
// with HANDED_OFF_TEXT (its call's result could reach no errand). Pure.
export function carriedErrands(errands: readonly Errand[] | undefined, turn: number): Errand[] | undefined {
  if (!errands) return undefined
  return errands.map(e => (e.state === 'running' ? { ...e, state: 'fired' as const, result: errandResult(e, turn, HANDED_OFF_TEXT) } : e))
}
