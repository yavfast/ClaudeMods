// [SP_CTX_02_44] [SP_CTX_02_45] [SP_CTX_02_46] [SP_CTX_02_47] The repair after
// a resume (phase 32; spike context_editor_resume). Any assistant row an
// apply returned with its handle is the original message under the same
// `message.id`, so after `claude --resume` or `/resume` the host's loader
// inserts the original rows of the whole file beside the copies, with their
// results (plugin-hooks 63, 64). The mod records which input rows of each
// apply may come back (ApplyLedger), recognizes them by their handle in a
// compaction's rows (DropPulled), and in a new host process rebuilds the
// loaded conversation once with its own compaction (REPAIR_MARKER): the
// originals that have a twin go, assistant and result rows come back without
// a handle, so the next resume loads nothing twice. Pure logic behind small
// ports; register.ts binds them to `$`.
import type { SessionMessage } from 'claude-code'
import type { AliasRegistry } from './aliases'
import { pruneAliases } from './aliases'
import type { CompactionOutcome } from './compaction'
import { insertDeliveries, type Deliveries } from './deliveries'
import { boundaryOf, checkPairs, collectMedia, mediaExt, mergeCallRows, ownerKey, rebuild, toolRefText, withCarryNote, type Boundary } from './edits'
import type { Journal } from './journal'
import { rebindAfter } from './notes'
import { MAX_QUEUE_BYTES } from './queue'
import { errorText, isBlankRow, isPromptRow, isReplacementText, modText, resultsOf, squash } from './rows'
import { bytes, isCount, jsonObject, type Held, type Read } from './store'
import type { TagRegistry } from './tags'

// ---- [SP_CTX_01_12] constants

// The delay from session.start (or the turn end after a switch) to RunRepair;
// the spike's value (cr2: the command ran before the first prompt).
export const REPAIR_DELAY_MS = 1500
// [SP_CTX_01_24] The most handles ApplyLedger holds in all.
export const MAX_LEDGER_HANDLES = 50_000
// [SP_CTX_02_46] The status line when the host refused the repair's command.
export const REPAIR_REFUSED = modText('could not repair the resumed conversation: ')

// ---- [SP_CTX_01_24] ApplyLedger

export type LedgerEntry = { at: number; handles: string[] }
// `clean`: a repair of this session answered "nothing to repair"; NeedsRepair
// keeps quiet until the next apply records its inputs (the entry drops it)
export type ApplyLedger = { entries: LedgerEntry[]; clean?: boolean }

export const EMPTY_LEDGER: ApplyLedger = { entries: [] }

export function emptyLedger(): ApplyLedger {
  return { entries: [] }
}

function isLedgerEntry(raw: unknown): raw is LedgerEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const e = raw as Record<string, unknown>
  if (!isCount(e.at, 0) || !Array.isArray(e.handles)) return false
  const h = e.handles
  return h.length >= 1 && h.length <= MAX_LEDGER_HANDLES && h.every(x => typeof x === 'string' && x !== '') && new Set(h).size === h.length
}

// [SP_CTX_01_24] Read states as the queue's: a bad entry makes the file
// unreadable, never silently an empty ledger.
export function parseLedger(text: string): Read<ApplyLedger> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  const entries = raw.value.entries
  if (!Array.isArray(entries)) return { state: 'unreadable', reason: 'bad field(s): entries' }
  const bad = entries.findIndex(e => !isLedgerEntry(e))
  if (bad >= 0) return { state: 'unreadable', reason: `bad entry ${bad + 1}` }
  if (entries.reduce((n: number, e: LedgerEntry) => n + e.handles.length, 0) > MAX_LEDGER_HANDLES) return { state: 'unreadable', reason: 'too many handles' }
  const clean = raw.value.clean
  if (clean !== undefined && typeof clean !== 'boolean') return { state: 'unreadable', reason: 'bad field(s): clean' }
  return { state: 'ok', value: clean ? { entries, clean } : { entries } }
}

// [SP_CTX_02_44] The ledger with one more entry: the oldest entries go while
// the handles number more than MAX_LEDGER_HANDLES or the file would exceed
// MAX_QUEUE_BYTES.
export function withLedgerEntry(l: ApplyLedger, e: LedgerEntry): ApplyLedger {
  let entries = [...l.entries, e]
  let n = entries.reduce((k, x) => k + x.handles.length, 0)
  while (entries.length > 1 && n > MAX_LEDGER_HANDLES) {
    n -= entries[0]!.handles.length
    entries = entries.slice(1)
  }
  while (entries.length > 1 && bytes({ entries }) > MAX_QUEUE_BYTES) entries = entries.slice(1)
  return { entries }
}

// [SP_CTX_02_44] RecordInputs' handles: the assistant rows and the rows with
// results of an apply's input. A prompt or another user row without results
// pulls nothing (spike, Q2). At most MAX_LEDGER_HANDLES, the newest kept.
export function inputHandles(messages: readonly SessionMessage[]): string[] {
  const out = new Set<string>()
  for (const r of messages) if (r.handle !== undefined && r.handle !== '' && (r.role === 'assistant' || resultsOf(r).length > 0)) out.add(r.handle)
  const all = [...out]
  return all.length > MAX_LEDGER_HANDLES ? all.slice(all.length - MAX_LEDGER_HANDLES) : all
}

// [SP_CTX_02_44] RecordInputs' change of the ledger as read (missing, ok, or
// a fresh one after the unreadable file went aside): undefined, nothing to write.
export function recordInputs(ledger: ApplyLedger, messages: readonly SessionMessage[], id: number): ApplyLedger | undefined {
  const handles = inputHandles(messages)
  return handles.length ? withLedgerEntry(ledger, { at: id, handles }) : undefined
}

// [SP_CTX_02_45] What DropPulled takes from the storage: the ledger (empty
// when missing or unreadable), whether the session had an apply of the mod
// (an entry in the ledger, or an `apply` of the journal of effect), and
// whether the ledger could not be read, and whether a repair found nothing
// to repair since the last apply (ApplyLedger.clean).
export type Pulled = { ledger: ApplyLedger; applied: boolean; unreadable: boolean; clean: boolean }

export function pulledOf(ledger: Read<ApplyLedger>, journal: Read<Journal> | undefined): Pulled {
  const l = ledger.state === 'unreadable' ? emptyLedger() : ledger.value
  const journaled = journal?.state === 'ok' && journal.value.entries.some(e => e.kind === 'apply')
  return { ledger: l, applied: l.entries.length > 0 || journaled, unreadable: ledger.state === 'unreadable', clean: l.clean === true }
}

// [SP_CTX_02_46] The ledger with the verdict "nothing to repair".
export function cleanLedger(l: ApplyLedger): ApplyLedger | undefined {
  return l.clean ? undefined : { ...l, clean: true }
}

// ---- [SP_CTX_02_45] DropPulled

function idsOf(r: SessionMessage): string[] {
  return [...r.toolUses.map(u => u.tool_use_id), ...resultsOf(r).map(t => t.tool_use_id)]
}

// A row's text or one of its results' texts is a replacement of the mod's.
function holdsReplacement(r: SessionMessage): boolean {
  return isReplacementText(r.text) || resultsOf(r).some(t => isReplacementText(t.text))
}

// A row's content as the residual rule compares it: role, text, ids, results' texts.
function contentKey(r: SessionMessage): string {
  return JSON.stringify([r.role, r.text, idsOf(r), resultsOf(r).map(t => t.text)])
}

// [SP_CTX_02_45] DropPulled: the rows a resume loaded a second time, and
// which of them go. Own: a row whose handle the ledger names, an original the
// host put back (pitfall 63) or a row before the walk crossed the boundary
// (pitfall 64); only an own assistant row or row with results that has a
// twin goes: (1) every call or result id it holds is in a row of the same
// role that is not own (that copy, changed by an edit or not, wins); (2) it
// holds only thinking; (3) a text answer whose same text a row of the same
// role that is not own has in the same stretch between prompt rows. (4) The
// residual rule, in a session the mod applied in only: rows of one role that
// share an id (the ledger was cut, lost, or older than phase 32): the one with
// a replacement text stays when it is the only one, else identical rows keep
// the last; anything else stays. A row without a twin always stays (the
// first prompt after the walk crossed the boundary, session b). Pure.
export function dropPulled(rows: readonly SessionMessage[], ledger: ApplyLedger, applied: boolean): { kept: SessionMessage[]; dropped: number[]; residual: number } {
  const H = new Set(ledger.entries.flatMap(e => e.handles))
  const own = rows.map(r => r.handle !== undefined && H.has(r.handle))
  const seg: number[] = []
  let at = 0
  rows.forEach((r, i) => {
    if (isPromptRow(r)) at = i
    seg.push(at)
  })
  // ids of the rows that are not own, by role; their texts by stretch, each
  // a twin of one own row only (rule 3 matches by count)
  const carried = new Set<string>()
  const texts = new Map<string, number>()
  rows.forEach((r, i) => {
    if (own[i]) return
    for (const id of idsOf(r)) carried.add(`${r.role}:${id}`)
    if (r.text.trim()) {
      const key = JSON.stringify([r.role, seg[i], r.text])
      texts.set(key, (texts.get(key) ?? 0) + 1)
    }
  })
  const drop = new Set<number>()
  rows.forEach((r, i) => {
    if (!own[i] || !(r.role === 'assistant' || resultsOf(r).length > 0)) return
    const ids = idsOf(r)
    if (ids.length) {
      if (ids.every(id => carried.has(`${r.role}:${id}`))) drop.add(i)
    } else if (r.text.trim() === '') drop.add(i)
    else {
      const key = JSON.stringify([r.role, seg[i], r.text])
      const n = texts.get(key) ?? 0
      if (n > 0) {
        drop.add(i)
        texts.set(key, n - 1)
      }
    }
  })
  const byResidual = new Set<number>()
  if (applied) {
    // groups: rows of one role joined by a shared id (union-find)
    const parent = rows.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
    const first = new Map<string, number>()
    rows.forEach((r, i) => {
      if (drop.has(i)) return
      for (const id of idsOf(r)) {
        const key = `${r.role}:${id}`
        const j = first.get(key)
        if (j === undefined) first.set(key, i)
        else parent[find(i)] = find(j)
      }
    })
    const groups = new Map<number, number[]>()
    rows.forEach((r, i) => {
      if (drop.has(i) || !idsOf(r).length) return
      const g = find(i)
      groups.set(g, [...(groups.get(g) ?? []), i])
    })
    for (const g of groups.values()) {
      if (g.length < 2) continue
      const marked = g.filter(i => holdsReplacement(rows[i]!))
      let goes: number[] = []
      // the one replacement stays; a row goes only when the replacement holds all its ids
      if (marked.length === 1) {
        const held = new Set(idsOf(rows[marked[0]!]!))
        goes = g.filter(i => i !== marked[0] && idsOf(rows[i]!).every(id => held.has(id)))
      } else if (g.every(i => contentKey(rows[i]!) === contentKey(rows[g[0]!]!))) goes = g.slice(0, -1)
      for (const i of goes) {
        drop.add(i)
        byResidual.add(i)
      }
    }
  }
  keepPairs(rows, drop)
  const residual = [...byResidual].filter(i => drop.has(i)).length
  return { kept: rows.filter((_, i) => !drop.has(i)), dropped: [...drop].sort((a, b) => a - b), residual }
}

// The call ids answered among `rows` but `skip`: a call row before a result row of the id.
function pairedIds(rows: readonly SessionMessage[], skip: ReadonlySet<number>): Set<string> {
  const firstCall = new Map<string, number>()
  const lastResult = new Map<string, number>()
  rows.forEach((r, i) => {
    if (skip.has(i)) return
    for (const u of r.toolUses) if (!firstCall.has(u.tool_use_id)) firstCall.set(u.tool_use_id, i)
    for (const t of resultsOf(r)) lastResult.set(t.tool_use_id, i)
  })
  return new Set([...firstCall].filter(([id, i]) => (lastResult.get(id) ?? -1) > i).map(([id]) => id))
}

// [SP_CTX_02_45] PairsWhole: a drop never leaves a call without a later
// result, or a result without an earlier call, when the rows had that pair:
// the dropped rows that hold such an id stay, until nothing changes.
function keepPairs(rows: readonly SessionMessage[], drop: Set<number>): void {
  const before = pairedIds(rows, new Set())
  for (let changed = drop.size > 0; changed; ) {
    changed = false
    const now = pairedIds(rows, drop)
    const lost = new Set([...before].filter(id => !now.has(id)))
    if (!lost.size) return
    for (const i of [...drop])
      if (idsOf(rows[i]!).some(id => lost.has(id))) {
        drop.delete(i)
        changed = true
      }
  }
}

// [SP_CTX_02_46] Repeats: whether rows without handles (`$.session.messages()`
// carries none) show what a resume loads twice: a call or result id in two
// rows of one role, or one assistant text twice in the same stretch between
// prompt rows. NeedsRepair's test; the handler then decides by the handles. Pure.
export function repeatsIn(rows: readonly SessionMessage[]): boolean {
  const ids = new Set<string>()
  const texts = new Set<string>()
  let at = 0
  for (const [i, r] of rows.entries()) {
    if (isPromptRow(r)) at = i
    for (const id of idsOf(r)) {
      const key = `${r.role}:${id}`
      if (ids.has(key)) return true
      ids.add(key)
    }
    if (r.role === 'assistant' && r.text.trim()) {
      const key = `${at}:${squash(r.text)}`
      if (texts.has(key)) return true
      texts.add(key)
    }
  }
  return false
}

// ---- [SP_CTX_02_46] ScheduleRepair and RunRepair

export type RepairState = 'none' | 'planned' | 'running' | 'done' | 'failed'

// [SP_CTX_02_47] What the handler leaves for the person's line.
export type RepairSummary = { session: string; dropped: number; rows: number; media: number }

// The module instance's memory of the repair (gone with a reload): the
// session of the one attempt and its state; a switch in the process waits
// for the turn end; the session this instance already compacted itself
// (apply, seed or repair) since its storage was published; the last repair.
export type RepairMemory = {
  session?: string
  state: RepairState
  atTurnEnd: boolean
  compactedHere?: string
  last?: RepairSummary
}

export function newRepairMemory(): RepairMemory {
  return { state: 'none', atTurnEnd: false }
}

// [SP_CTX_02_46] PrepareStorage published another session in this process
// (/resume, /clear): no timer from here (tool.call and prompt.submit see the
// switch, and the host takes no command from their timers); the turn end plans it.
export function repairSwitched(mem: RepairMemory, session: string): void {
  mem.session = session
  mem.state = 'none'
  mem.compactedHere = undefined
  mem.atTurnEnd = true
}

// [SP_CTX_02_46] What NeedsRepair needs; register.ts binds it.
export type NeedsIO = {
  sessionId: () => Promise<string>
  // EnsureStorage's folder; undefined: none
  storage: () => Promise<string | undefined>
  // the ledger and the journal of effect in `dir`
  pulled: (dir: string) => Promise<Pulled>
  // [SP_CTX_02_18] the boundary in `dir` is Trusted (awaits hostId ≤ HOST_ID_WAIT_MS)
  trusted: (dir: string) => Promise<boolean>
  // the main conversation's rows as read now (no handles)
  rows: () => Promise<readonly SessionMessage[]>
}

// [SP_CTX_02_46] NeedsRepair: the session had an apply of the mod, this
// process did not compact it (an untrusted boundary: the read is the loaded
// chain, not originals + copies), and the rows show repeats.
export async function needsRepair(io: NeedsIO, mem: Pick<RepairMemory, 'compactedHere'>): Promise<boolean> {
  const id = await io.sessionId()
  if (mem.compactedHere === id) return false
  const dir = await io.storage()
  if (!dir) return false
  const p = await io.pulled(dir)
  // a repair already found nothing in what these repeats are (the same answer twice in a turn)
  if (p.unreadable || !p.applied || p.clean) return false
  if (await io.trusted(dir)) return false
  return repeatsIn(await io.rows())
}

// [SP_CTX_02_46] What ScheduleRepair and RunRepair need; register.ts binds it.
export type RepairIO = {
  sessionId: () => Promise<string>
  // a deferred action from session.start or turn.complete; a refused timer throws
  after: (ms: number, fn: () => void) => void
  needs: () => Promise<boolean>
  // the compaction command with REPAIR_MARKER; one attempt, a refusal rejects
  command: () => Promise<void>
  status: (text: string) => void
  // [SP_CTX_02_43] the person's line ($.ui.log), never seen by the model
  log: (text: string) => void
  debug?: (text: string) => void
}

// [SP_CTX_02_46] ScheduleRepair: one attempt per session in this instance.
// True when a timer was planned.
export async function scheduleRepair(io: RepairIO, mem: RepairMemory): Promise<boolean> {
  const id = await io.sessionId()
  if (mem.session === id && mem.state !== 'none') return false
  mem.session = id
  mem.state = 'planned'
  try {
    io.after(REPAIR_DELAY_MS, () => void runRepair(io, mem).catch(() => undefined))
  } catch (err) {
    mem.state = 'failed'
    io.debug?.(modText(`repair not planned: ${errorText(err)}`))
    return false
  }
  return true
}

// [SP_CTX_02_46] AfterTurn's step: the turn end after a switch in the process plans it.
export async function repairAtTurnEnd(io: RepairIO, mem: RepairMemory): Promise<boolean> {
  if (!mem.atTurnEnd) return false
  mem.atTurnEnd = false
  return scheduleRepair(io, mem)
}

export type RepairOutcome = 'switched' | 'clean' | 'refused' | 'repaired' | 'skipped'

// [SP_CTX_02_46] RunRepair: the command once; mid-turn it waits for the turn's end.
export async function runRepair(io: RepairIO, mem: RepairMemory): Promise<RepairOutcome> {
  const id = await io.sessionId()
  if (id !== mem.session) return 'switched'
  if (!(await io.needs().catch(() => false))) {
    mem.state = 'done'
    return 'clean'
  }
  mem.state = 'running'
  mem.last = undefined
  try {
    await io.command()
  } catch (err) {
    mem.state = 'failed'
    io.status(REPAIR_REFUSED + errorText(err))
    io.debug?.(REPAIR_REFUSED + errorText(err))
    return 'refused'
  }
  const last = mem.last as RepairSummary | undefined
  if (last?.session === id) {
    mem.state = 'done'
    io.log(repairLine(last))
    return 'repaired'
  }
  // the handler answered skip: its reason is in the debug log and its toast
  mem.state = 'failed'
  return 'skipped'
}

// [SP_CTX_01_12] REPAIR_LINE: the person's line after a repair.
export function repairLine(r: Pick<RepairSummary, 'dropped' | 'media'>): string {
  return `repaired the resumed conversation: dropped ${r.dropped} row(s) loaded twice${r.media ? `; media of ${r.media} result(s) carried as files` : ''}`
}

// ---- [SP_CTX_02_47] HandleRepair

// [SP_CTX_01_12] REPAIR_SKIPS
export const REPAIR_SKIP = {
  storage: modText('storage unavailable'),
  handoff: modText('handoff running'),
  ledger: modText('ledger unreadable'),
  nothing: modText('nothing to repair'),
  media: modText('media could not be written'),
  pairs: (reason: string) => modText(`repair would break pairs: ${reason}`),
  abandoned: modText('compaction abandoned'),
  failed: modText('repair failed'),
} as const

// What HandleRepair needs; register.ts binds it to `$`.
export type RepairHandlerIO = {
  dir: string
  // [SP_CTX_01_07] ArchiveRoot: where the media go (`dir` when the project has no archive folder)
  archives: string
  now: () => number
  // a handoff of this instance runs: it seeds a new session itself (BuildSeed takes DropPulled)
  handoffRunning: () => boolean
  readLedger: () => Promise<Read<ApplyLedger>>
  readJournal: () => Promise<Read<Journal>>
  readApi: () => Promise<readonly unknown[]>
  writeMedia: (path: string, base64: string) => Promise<boolean>
  // [SP_CTX_01_22] the host's deliveries recorded in this session; absent: none
  readDeliveries?: () => Promise<Read<Deliveries>>
  isAborted: () => boolean
  toast: (text: string) => void
  readTags: () => Promise<Read<TagRegistry>>
  writeTags: (reg: TagRegistry) => Promise<void>
  readAliases: () => Promise<Read<AliasRegistry>>
  writeAliases: (reg: AliasRegistry) => Promise<void>
  // the commit holding the registry's chain, then the aliases' ([SP_CTX_02_07])
  onRegistries?: <T>(work: (held?: Held) => Promise<T>) => Promise<T>
  // [SP_CTX_01_14] hostId if its read has ended, else absent
  hostId: () => string | undefined
  // the steps after the answer, in the background, never awaited
  writeBoundary: (b: Boundary) => Promise<void>
  clearLedger: () => void
  pruneDeliveries?: (done: ReadonlySet<string>) => void
  // [SP_CTX_02_46] in the background: the verdict "nothing to repair" (cleanLedger)
  markClean?: () => void
}

export type RepairResult = { outcome: CompactionOutcome; summary?: Omit<RepairSummary, 'session'> }

const skip = (text: string): RepairResult => ({ outcome: { skip: text } })

// [SP_CTX_02_47] HandleRepair: the loaded conversation without the originals
// that have a twin; prompts and other user rows without results keep their
// handle (their copies pull nothing, and the host carries their attachments
// and media); assistant rows and result rows go without it (thinking goes;
// the media of a result goes to a file, named by CarryNote; a ToolSearch
// result names its tools, ToolRefText). The caller runs it on the queue's chain.
export async function handleRepair(io: RepairHandlerIO, messages: readonly SessionMessage[]): Promise<RepairResult> {
  if (io.handoffRunning()) return skip(REPAIR_SKIP.handoff)
  const ledgerRead = await io.readLedger().catch((err): Read<ApplyLedger> => ({ state: 'unreadable', reason: String(err) }))
  if (ledgerRead.state === 'unreadable') return skip(REPAIR_SKIP.ledger)
  const journal = await io.readJournal().catch((err): Read<Journal> => ({ state: 'unreadable', reason: String(err) }))
  const pulled = pulledOf(ledgerRead, journal)
  const { kept, dropped } = dropPulled(messages, pulled.ledger, pulled.applied)
  if (!dropped.length) {
    // the repeats NeedsRepair saw are no pulled originals: the next process keeps quiet
    if (!io.isAborted())
      try {
        io.markClean?.()
      } catch {
        // the next process asks again
      }
    return skip(REPAIR_SKIP.nothing)
  }
  const api = await io.readApi()
  const { found, toolRefs } = collectMedia(api, kept)
  // the media of every result row, to files: without them it would vanish
  const id = io.now()
  let n = 0
  const paths = new Map<string, (string | undefined)[]>()
  for (const r of kept)
    for (const t of resultsOf(r)) {
      const key = ownerKey({ tool_use_id: t.tool_use_id })
      const refs = found.get(key)
      if (!refs || paths.has(key)) continue
      const list: (string | undefined)[] = []
      for (const ref of refs) {
        if (!ref.data) {
          list.push(undefined)
          continue
        }
        n += 1
        const path = `${io.archives}/${id}/${n}.${mediaExt(ref.mediaType)}`
        if (!(await io.writeMedia(path, ref.data))) return skip(REPAIR_SKIP.media)
        list.push(path)
      }
      paths.set(key, list)
    }
  let media = 0
  const rebuilt: SessionMessage[] = kept.map(r => {
    if (r.role === 'user' && !resultsOf(r).length) return r
    const plain = rebuild(r)
    if (r.role === 'assistant') return { role: 'assistant', text: plain.text, toolUses: plain.toolUses }
    let carries = false
    const toolResults = resultsOf(plain).map(t => {
      const key = ownerKey({ tool_use_id: t.tool_use_id })
      const text = toolRefText(t, toolRefs)
      const refs = found.get(key)
      if (!refs) return { ...t, text }
      carries = true
      return { ...t, text: withCarryNote(text, refs, paths.get(key) ?? []) }
    })
    if (carries) media += 1
    return { ...plain, toolResults }
  })
  // rows left with nothing (thinking only) go; MergeCallRows joins the
  // rebuilt call rows of one response ([SP_CTX_02_04])
  const rows0 = mergeCallRows(rebuilt.filter(r => r.handle !== undefined || !isBlankRow(r)))
  // [SP_CTX_02_36] a delivery behind a result rebuilt without its handle goes back as a row
  const deliveries = io.readDeliveries ? await io.readDeliveries().catch((): Read<Deliveries> => ({ state: 'unreadable', reason: 'read failed' })) : undefined
  const put = insertDeliveries(kept, rows0, deliveries?.state === 'ok' ? deliveries.value.items : [], new Map(), true)
  const rows = put.rows
  const problem = checkPairs(rows, true)
  if (problem) return skip(REPAIR_SKIP.pairs(problem))
  if (io.isAborted()) return skip(REPAIR_SKIP.abandoned)
  const boundary = boundaryOf(rows, io.hostId())
  // [SP_CTX_02_07] the commit: the registries as they are now, nothing written
  // once the host abandoned the dispatch; a write that follows an abandon is
  // put back (CONC-02)
  const onRegistries = io.onRegistries ?? (<T>(work: (held?: Held) => Promise<T>) => work())
  const committed = await onRegistries(async () => {
    const tagsNow = await io.readTags().catch((err): Read<TagRegistry> => ({ state: 'unreadable', reason: String(err) }))
    const aliasesNow = await io.readAliases().catch((err): Read<AliasRegistry> => ({ state: 'unreadable', reason: String(err) }))
    const tags = tagsNow.state === 'unreadable' ? undefined : { before: tagsNow.value, next: rebindAfter(tagsNow.value, messages, rows, [], [], []).registry }
    const pruned = aliasesNow.state === 'unreadable' ? undefined : pruneAliases(aliasesNow.value, messages, rows, [])
    const aliases = aliasesNow.state !== 'unreadable' && pruned !== undefined && pruned !== aliasesNow.value ? { before: aliasesNow.value, next: pruned } : undefined
    if (io.isAborted()) return false
    const tagsWritten = tags ? await io.writeTags(tags.next).then(() => true, () => false) : false
    const aliasesWritten = aliases && !io.isAborted() ? await io.writeAliases(aliases.next).then(() => true, () => false) : false
    if (io.isAborted()) {
      if (tags && tagsWritten) await io.writeTags(tags.before).catch(() => undefined)
      if (aliases && aliasesWritten) await io.writeAliases(aliases.before).catch(() => undefined)
      return false
    }
    return true
  })
  if (!committed) return skip(REPAIR_SKIP.abandoned)
  // nothing awaited from here on: the handler answers at once
  io.toast(modText(`repaired the resumed conversation (${dropped.length} rows loaded twice)`))
  // CONC-02: each write after the commit only while the host still waits
  if (boundary && !io.isAborted())
    try {
      void io.writeBoundary(boundary).catch(() => undefined)
    } catch {
      // the previous boundary stays
    }
  if (!io.isAborted())
    try {
      // no returned assistant or result row has a handle: old originals no longer come back
      io.clearLedger()
    } catch {
      // the next repair finds nothing to drop
    }
  if (put.done.size && io.pruneDeliveries && !io.isAborted())
    try {
      io.pruneDeliveries(put.done)
    } catch {
      // a later apply skips a delivery that is already a row
    }
  return { outcome: { messages: rows }, summary: { dropped: dropped.length, rows: rows.length, media } }
}
