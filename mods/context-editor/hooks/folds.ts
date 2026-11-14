// Folds ([C_FOLD_02], [SP_FOLD_01_01], [SP_FOLD_01_02], [SP_FOLD_02_01]): every
// applied edit that leaves a fold record (summarize, collapse, describe, a
// disposable tag's replacement too) gets an id, written into the record's
// text (FOLD_NOTE of rows.ts), and an entry in the fold ledger `folds.json`
// of the session's storage: where its level lies in the archive, what it
// folded and which later fold holds its record. Pure logic behind a Store;
// register.ts binds it to `$` on the `folds` chain.
import type { SessionMessage } from 'claude-code'
import {
  isFoldRegion,
  isReturnEdit,
  kilo,
  LIST_COUNT,
  MAX_FULL_ROW,
  MAX_LIST_COUNT,
  MAX_QUEUE_EDITS,
  MAX_SOURCE,
  oneLine,
  sourceOf,
  touchedBy,
  type ApplyReport,
  type Folded,
  type FoldRegion,
  type Pinned,
  type QueuedEdit,
} from './edits'
import { errorText, findToolUse, FOLD_NUMBER, FOLD_PREFIX, foldNumbers, foldOfRecord, RECALL_TOOL, recalledText, resultsOf, totalChars } from './rows'
import { isCount, jsonObject, renewOf, trimOldest, type Held, type Read, type Store } from './store'

// [SP_FOLD_01_06]
export const MAX_FOLDS = 2000
export const MAX_RECALLS = 50
export const MAX_RECALL_CHARS = 40_000
export const MAX_RECALL_ROW = MAX_FULL_ROW
// [SP_FOLD_02_02] how much of a row the contents of a level show
const CONTENTS_HEAD = 80
// [SP_FOLD_03_01] FOLD_PREFIX and a decimal number without leading zeros
export const FOLD_ID = new RegExp(`^${FOLD_PREFIX}${FOLD_NUMBER}$`)

// [SP_FOLD_02_01] FOLDS_UNSAVED: the sentence of the apply report.
export const FOLDS_UNSAVED = 'The fold ledger could not be saved: context_recall will not know these folds; their originals are at the paths in the records.'

// [SP_FOLD_01_01]
export type FoldKind = 'output' | 'range' | 'media'
export const FOLD_CALLS = ['context_edit summarize call', 'context_edit collapse call', 'context_edit describe call', 'context_tag disposable tag'] as const
export type FoldCall = (typeof FOLD_CALLS)[number]
export type FoldEntry = {
  id: string
  archive: string
  entry: number
  kind: FoldKind
  call: FoldCall
  what: string
  region?: FoldRegion
  rows: number
  chars: number
  turn: number
  parent?: string
}

// [SP_FOLD_01_03] A recall not yet returned.
export type Recall = { fold: string; from: number; count: number; tool_use_id: string; depth: number; scope: string; turn: number; due: boolean }

// [SP_FOLD_01_02]
export type FoldLedger = { folds: FoldEntry[]; nextFold: number; recalls: Recall[] }

export function emptyFolds(): FoldLedger {
  return { folds: [], nextFold: 1, recalls: [] }
}

function foldNumber(id: string): number {
  return Number(id.slice(FOLD_PREFIX.length))
}

function isEntry(v: unknown): v is FoldEntry {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return (
    typeof f.id === 'string' &&
    FOLD_ID.test(f.id) &&
    typeof f.archive === 'string' &&
    f.archive !== '' &&
    isCount(f.entry) &&
    (f.kind === 'output' || f.kind === 'range' || f.kind === 'media') &&
    (FOLD_CALLS as readonly unknown[]).includes(f.call) &&
    typeof f.what === 'string' &&
    f.what.length <= MAX_SOURCE &&
    (f.region === undefined || (f.kind === 'range' && isFoldRegion(f.region))) &&
    isCount(f.rows, 1) &&
    isCount(f.chars) &&
    isCount(f.turn) &&
    (f.parent === undefined || (typeof f.parent === 'string' && FOLD_ID.test(f.parent)))
  )
}

function isRecall(v: unknown): v is Recall {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.fold === 'string' &&
    FOLD_ID.test(r.fold) &&
    isCount(r.from) &&
    isCount(r.count, 1) &&
    typeof r.tool_use_id === 'string' &&
    r.tool_use_id !== '' &&
    isCount(r.depth) &&
    typeof r.scope === 'string' &&
    isCount(r.turn) &&
    typeof r.due === 'boolean'
  )
}

// [SP_FOLD_01_02] Read states as the other storage files: a bad record or a
// broken invariant makes the file unreadable, never silently empty.
export function parseFolds(text: string): Read<FoldLedger> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  const { folds, nextFold, recalls } = raw.value
  if (!Array.isArray(folds) || folds.length > MAX_FOLDS) return { state: 'unreadable', reason: 'bad field(s): folds' }
  if (!isCount(nextFold, 1)) return { state: 'unreadable', reason: 'bad field(s): nextFold' }
  if (!Array.isArray(recalls) || recalls.length > MAX_RECALLS) return { state: 'unreadable', reason: 'bad field(s): recalls' }
  const bad = folds.findIndex(f => !isEntry(f))
  if (bad >= 0) return { state: 'unreadable', reason: `bad fold ${bad + 1}` }
  const ids = new Set((folds as FoldEntry[]).map(f => f.id))
  if (ids.size !== folds.length || (folds as FoldEntry[]).some(f => foldNumber(f.id) >= nextFold)) return { state: 'unreadable', reason: 'bad field(s): id' }
  // [SP_FOLD_01_01] `parent` is a fold of a later apply: a greater number the ledger gave out
  if ((folds as FoldEntry[]).some(f => f.parent !== undefined && (foldNumber(f.parent) <= foldNumber(f.id) || foldNumber(f.parent) >= nextFold)))
    return { state: 'unreadable', reason: 'bad field(s): parent' }
  // [SP_FOLD_03_02] every recall names a fold of the ledger
  const badRecall = recalls.findIndex(r => !isRecall(r) || !ids.has(r.fold))
  if (badRecall >= 0) return { state: 'unreadable', reason: `bad recall ${badRecall + 1}` }
  return { state: 'ok', value: { folds: folds as FoldEntry[], nextFold, recalls: recalls as Recall[] } }
}

// ---- [SP_FOLD_02_01] RecordFolds

// An edit that leaves a fold record: not drop, rewrite or state, and not the
// return of a recalled level ([SP_FOLD_02_03]: it makes no FoldEntry and
// takes no number).
export function isFoldEdit(e: QueuedEdit): boolean {
  return (e.op === 'summarize' || e.op === 'collapse' || e.op === 'describe') && !isReturnEdit(e)
}

// [SP_FOLD_01_02] The lower bound of a new fold's number: above every number
// a FOLD_NOTE in the conversation names, whatever the ledger holds (empty,
// moved aside, not carried by a handoff, deleted).
export function foldFloor(rows: readonly SessionMessage[]): number {
  let top = 0
  for (const r of rows) {
    for (const n of foldNumbers(r.text)) if (n > top) top = n
    for (const t of resultsOf(r)) for (const n of foldNumbers(t.text)) if (n > top) top = n
  }
  return top + 1
}

// [SP_FOLD_02_01] AssignFoldIds, before the replacement rows are built: the
// id of each fold edit of the batch, in queue order, by the edit object. An
// edit that later fails keeps its number: the numbers may have gaps.
export function assignFoldIds(batch: readonly QueuedEdit[], rows: readonly SessionMessage[], ledger: FoldLedger | undefined): { ids: Map<QueuedEdit, string>; next: number } {
  let next = Math.max(ledger?.nextFold ?? 1, foldFloor(rows))
  const ids = new Map<QueuedEdit, string>()
  for (const e of batch) if (isFoldEdit(e)) ids.set(e, `${FOLD_PREFIX}${next++}`)
  return { ids, next }
}

const KIND: Record<'summarize' | 'collapse' | 'describe', FoldKind> = { summarize: 'output', collapse: 'range', describe: 'media' }
const CALL: Record<'summarize' | 'collapse' | 'describe', FoldCall> = {
  summarize: 'context_edit summarize call',
  collapse: 'context_edit collapse call',
  describe: 'context_edit describe call',
}

// [SP_FOLD_02_01] The folds whose records lie in the level `rows` of an
// applied fold edit: for a pair edit only the pair's own result counts (its
// rows may hold other pairs).
function innerFolds(edit: QueuedEdit, rows: readonly SessionMessage[]): Set<string> {
  const inner = new Set<string>()
  const put = (text: string) => {
    const n = foldOfRecord(text)
    if (n !== undefined) inner.add(`${FOLD_PREFIX}${n}`)
  }
  const pair = edit.op === 'summarize' ? edit.tool_use_id : undefined
  for (const r of rows) {
    if (pair === undefined) put(r.text)
    for (const t of resultsOf(r)) if (pair === undefined || t.tool_use_id === pair) put(t.text)
  }
  return inner
}

// [SP_FOLD_01_01] The entry of one applied fold edit.
function entryOf(f: Folded, rows: readonly SessionMessage[], archive: string, turn: number): FoldEntry | undefined {
  const { edit } = f
  if (edit.op !== 'summarize' && edit.op !== 'collapse' && edit.op !== 'describe') return undefined
  const kind = KIND[edit.op]
  const region = edit.op === 'collapse' ? edit.region : undefined
  const what =
    kind === 'media' ? `${f.what || 'media'} of a ${rows[0]?.role ?? 'user'} row` : region ? `${region.kind} "${region.name}"` : f.what || `${rows.length} row(s)`
  return {
    id: f.id,
    archive,
    entry: f.entry,
    kind,
    call: edit.via === 'tag' ? 'context_tag disposable tag' : CALL[edit.op],
    what: oneLine(what, MAX_SOURCE - 1),
    ...(region ? { region } : {}),
    rows: Math.max(1, rows.length),
    chars: totalChars(rows),
    turn,
  }
}

// [SP_FOLD_02_01] RecordFolds, after the apply ran: the ledger with an entry
// for each applied fold edit (in the order of their numbers), `parent` set on
// the folds whose records those edits replaced, `nextFold` moved on, the
// oldest entries gone above MAX_FOLDS or `maxBytes`, and no recall of a fold
// that went. `folded` and `originals` are ApplyEdits' (the archive's array).
// Throws when a new number is one the ledger already gave out (the ids were
// assigned without the ledger, which could not be read then): the ledger
// stays as it is and the apply reports FOLDS_UNSAVED.
export function recordFolds(
  ledger: FoldLedger,
  folded: readonly Folded[],
  originals: ApplyReport['originals'],
  next: number,
  archive: string,
  turn: number,
  maxBytes: number,
): FoldLedger {
  if (folded.some(f => foldNumber(f.id) < ledger.nextFold)) throw new Error(`fold numbers below nextFold ${ledger.nextFold}`)
  const folds = [...ledger.folds]
  for (const f of [...folded].sort((a, b) => foldNumber(a.id) - foldNumber(b.id))) {
    const rows = originals[f.entry]?.rows ?? []
    const made = entryOf(f, rows, archive, turn)
    if (!made) continue
    const inner = innerFolds(f.edit, rows)
    for (let i = 0; i < folds.length; i++) {
      const old = folds[i]!
      if (inner.has(old.id) && old.parent === undefined) folds[i] = { ...old, parent: f.id }
    }
    folds.push(made)
  }
  const nextFold = Math.max(ledger.nextFold, next)
  const kept = trimOldest(folds, MAX_FOLDS, maxBytes, list => ({ folds: list, nextFold, recalls: ledger.recalls }))
  const ids = kept.length === folds.length ? undefined : new Set(kept.map(f => f.id))
  return { folds: kept, nextFold, recalls: ids ? ledger.recalls.filter(r => ids.has(r.fold)) : ledger.recalls }
}

// [SP_FOLD_02_01] The ledger's port of an apply; register.ts binds it to the
// session's Store.
export type FoldPort = {
  // the ledger as it is before the apply; a failed read counts as unreadable
  read: () => Promise<Read<FoldLedger>>
  // at the commit point, on the ledger's chain inside the chains `held`
  // holds: Renew (an unreadable file goes aside and the ledger starts empty).
  // Resolves with the ledger as it was before the write, or undefined when
  // nothing was written; a failed write rejects
  record: (change: (ledger: FoldLedger) => FoldLedger, held?: Held) => Promise<FoldLedger | undefined>
  // the ledger as it was read, after an abandon or a failed queue write
  putBack: (before: FoldLedger, held?: Held) => Promise<void>
}

// `within`: the chains the apply holds when it reads the ledger first.
export function foldPort(store: Store<FoldLedger>, within?: Held): FoldPort {
  return {
    read: () => store.onChain(() => store.read(), within).catch((err): Read<FoldLedger> => ({ state: 'unreadable', reason: String(err) })),
    record: async (change, held) => {
      let before: FoldLedger | undefined
      const written = await renewOf(store, held)(ledger => {
        before = ledger
        return change(ledger)
      })
      return written ? before : undefined
    },
    putBack: (before, held) => store.onChain(() => store.write(before), held),
  }
}

// ---- [SP_FOLD_02_02] Recall

// [SP_FOLD_01_06] FOLD_PASSED_OVER: on a host that passes over the mod's
// compaction hook a recalled level could never be returned.
export const FOLD_PASSED_OVER =
  "this host passes over the mod's compaction hook: a recalled level could never be returned; open the original with Read at the path in the fold record."

// [SP_FOLD_02_02] PruneRecalls: the records whose pair is no longer in the
// conversation go (another compaction, a handoff, a resumed session). A
// record of a call in `live` stays: the recalls of the running turn, whose
// rows may not be written yet.
export function pruneRecalls(ledger: FoldLedger, rows: readonly SessionMessage[], live?: ReadonlySet<string>): FoldLedger {
  const recalls = ledger.recalls.filter(r => live?.has(r.tool_use_id) || findToolUse(rows, r.tool_use_id) >= 0)
  return recalls.length === ledger.recalls.length ? ledger : { ...ledger, recalls }
}

// One row of a level as the archive holds it: a SessionMessage of the apply.
type LevelRow = SessionMessage

function isLevelRow(v: unknown): v is LevelRow {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.role === 'string' &&
    typeof r.text === 'string' &&
    Array.isArray(r.toolUses) &&
    r.toolUses.every(u => typeof u === 'object' && u !== null && typeof (u as { tool?: unknown }).tool === 'string' && typeof (u as { tool_use_id?: unknown }).tool_use_id === 'string') &&
    (r.toolResults === undefined ||
      (Array.isArray(r.toolResults) &&
        r.toolResults.every(t => typeof t === 'object' && t !== null && typeof (t as { text?: unknown }).text === 'string' && typeof (t as { tool_use_id?: unknown }).tool_use_id === 'string')))
  )
}

// [SP_FOLD_02_02] The level of a fold in the text of its archive: the rows
// of the element `entry`; for a fold of an output, the pair alone (its rows
// may hold other pairs, which stayed in the conversation). Undefined: the
// archive does not parse or has no such element (ARCHIVE_UNREADABLE).
export function levelOf(text: string, f: Pick<FoldEntry, 'entry' | 'kind'>): LevelRow[] | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const el = Array.isArray(raw) ? (raw[f.entry] as { edit?: unknown; rows?: unknown } | undefined) : undefined
  if (!el || !Array.isArray(el.rows) || !el.rows.length || !el.rows.every(isLevelRow)) return undefined
  const rows = el.rows as LevelRow[]
  if (f.kind !== 'output') return rows
  const pair = typeof el.edit === 'string' && el.edit.startsWith('summarize ') ? el.edit.slice('summarize '.length) : undefined
  if (!pair) return rows
  return rows.map(r => ({ role: r.role, text: '', toolUses: r.toolUses.filter(u => u.tool_use_id === pair), toolResults: resultsOf(r).filter(t => t.tool_use_id === pair) }))
}

const MEDIA_NOTE = /\[media archived: [^\]]*\]/g

// The `[media archived: <paths>]` marks the archive left in a raw result.
function mediaMarks(raw: unknown): string[] {
  if (raw === undefined) return []
  let text: string
  try {
    text = JSON.stringify(raw) ?? ''
  } catch {
    return []
  }
  return [...new Set(text.match(MEDIA_NOTE) ?? [])]
}

// [SP_FOLD_02_02] One row of a level as a recall shows it: `#<n> <role>:`,
// its text, each call by its tool and source, each result by its text; an
// inner fold's record and the marks of archived media as the archive holds
// them. A row longer than MAX_RECALL_ROW is cut, and says so.
export function levelRowText(r: LevelRow, n: number, cwd?: string): string {
  const parts: string[] = []
  if (r.text) parts.push(r.text)
  for (const u of r.toolUses) parts.push(`call: ${sourceOf(u.tool, u.input, cwd)}`)
  for (const t of resultsOf(r)) {
    const marks = mediaMarks((t as { result?: unknown }).result)
    parts.push(`result${t.isError ? ' (error)' : ''}: ${t.text}${marks.length ? `\n${marks.join('\n')}` : ''}`)
  }
  const body = parts.join('\n')
  const cut = body.length > MAX_RECALL_ROW ? `${body.slice(0, MAX_RECALL_ROW)}\n[row cut at ${MAX_RECALL_ROW} chars; the whole row is in the archive]` : body
  return `#${n} ${r.role}:\n${cut}`
}

// [SP_FOLD_02_02] RECALL_CONTENTS and the table of contents of a level.
function contentsText(f: FoldEntry, level: readonly LevelRow[], texts: readonly string[]): string {
  const chars = texts.reduce((n, t) => n + t.length, 0)
  const head = `Fold ${f.id} is too large to recall whole (${level.length} rows, ${chars} chars). Its rows are listed below; call ${RECALL_TOOL} again with "from" and "count".`
  const lines = level.map((r, i) => {
    const body = texts[i]!.slice(texts[i]!.indexOf('\n') + 1)
    return `#${i} ${r.role}, ${body.length} chars: ${oneLine(body, CONTENTS_HEAD)}`
  })
  return [head, ...lines].join('\n')
}

export type RecallArgs = { agentId?: unknown; fold?: unknown; from?: unknown; count?: unknown }
export type RecallDeny =
  | 'DENIED_SUBAGENT'
  | 'FOLD_PASSED_OVER'
  | 'FOLD_REQUIRED'
  | 'BAD_PART'
  | 'DENIED_STORAGE'
  | 'FOLD_UNKNOWN'
  | 'ALREADY_RECALLED'
  | 'RECALLS_FULL'
  | 'ARCHIVE_UNREADABLE'
  | 'PART_TOO_BIG'

// [SP_FOLD_02_02] What Recall needs from the host; register.ts binds it.
export type RecallIO = {
  // the host passes over the mod's compaction hook
  passedOver: () => boolean
  // why the session's storage is not ready, or undefined
  storageDown: () => Promise<string | undefined>
  // the refusal text of an unavailable storage
  storageRefusal: (reason: string) => string
  // CurrentRows
  rows: () => Promise<readonly SessionMessage[]>
  // the open region and the turn counter of the tag registry as it is now;
  // an unreadable registry: no region, turn 0
  region: () => Promise<{ depth: number; scope: string; turn: number }>
  // the text of an archive file, read through a process (no size bound of
  // the storage's read); undefined when it cannot be read
  readArchive: (path: string) => Promise<string | undefined>
  // on the ledger's chain: the ledger as it is now (an unreadable file moved
  // aside, then empty) and its write
  onLedger: <T>(work: (ledger: FoldLedger, write: (next: FoldLedger) => Promise<void>) => Promise<T>) => Promise<T>
  // the recall calls of the running turn that got a level: their rows may
  // not be in `rows` yet; `note` adds this call once its record is written
  live: () => ReadonlySet<string>
  note: (callId: string) => void
  // the session's project root, for SourceOf
  cwd?: string
}

// [SP_FOLD_02_02] RecallIO.onLedger over the Store: the read-modify-write on
// the ledger's chain; an unreadable ledger is moved aside and starts empty
// (Renew), and one that cannot be moved fails the call.
export function ledgerWork(store: Store<FoldLedger>): RecallIO['onLedger'] {
  return work =>
    store.onChain(async () => {
      let read = await store.read()
      if (read.state === 'unreadable') {
        if ((await store.quarantine()) === undefined) throw new Error(`the fold ledger cannot be read (${read.reason}) nor moved aside`)
        read = { state: 'missing', value: emptyFolds() }
      }
      return work(read.value, next => store.write(next))
    })
}

function isPartNumber(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min
}

// [SP_FOLD_02_02] Recall: one level of a fold as the result of the tool. The
// refusals in the order of the spec; a level too large to recall whole gives
// its contents and writes no record. Nothing is queued and no apply runs.
export async function contextRecall(io: RecallIO, args: RecallArgs, callId: string | undefined): Promise<{ result: string } | { deny: string; code: RecallDeny }> {
  const no = (code: RecallDeny, deny: string) => ({ code, deny: `${deny} (${code})` })
  if (args.agentId) return { code: 'DENIED_SUBAGENT', deny: "a subagent's context holds no folds; only the main conversation's can be recalled." }
  if (io.passedOver()) return { code: 'FOLD_PASSED_OVER', deny: FOLD_PASSED_OVER }
  if (typeof args.fold !== 'string' || !args.fold) return no('FOLD_REQUIRED', `"fold" is the id from a fold record: "(fold ${FOLD_PREFIX}<N>; original: …)"`)
  if (!FOLD_ID.test(args.fold)) return no('FOLD_UNKNOWN', `"${oneLine(args.fold, 40)}" is no fold id; take it from a fold record: "(fold ${FOLD_PREFIX}<N>; original: …)"`)
  if ((args.from !== undefined && !isPartNumber(args.from, 0)) || (args.count !== undefined && !isPartNumber(args.count, 1)))
    return no('BAD_PART', '"from" is a row number of the level (0 or more) and "count" a number of rows (1 or more)')
  const down = await io.storageDown()
  if (down !== undefined) return { code: 'DENIED_STORAGE', deny: io.storageRefusal(down) }
  if (!callId) return no('ARCHIVE_UNREADABLE', 'this call has no id, so its result could not be returned later')
  const id = args.fold
  const from = args.from ?? 0
  const count = args.count
  const given = args.from !== undefined || count !== undefined
  // before the ledger's chain: its rank is the lowest
  const rows = await io.rows()
  const region = await io.region()
  return io.onLedger(async (read, write) => {
    const ledger = pruneRecalls(read, rows, io.live())
    const f = ledger.folds.find(x => x.id === id)
    if (!f) return no('FOLD_UNKNOWN', `no fold ${id} in the fold ledger; its original is at the path in the fold record: open it with Read`)
    const end = count === undefined ? Infinity : from + count
    const same = ledger.recalls.find(r => r.fold === id && r.from < end && from < r.from + r.count)
    if (same) return no('ALREADY_RECALLED', `rows #${same.from}..#${same.from + same.count - 1} of fold ${id} are recalled already and still in the conversation; nothing was added`)
    if (ledger.recalls.length >= MAX_RECALLS) return no('RECALLS_FULL', `${MAX_RECALLS} recalls are not returned yet; close the stage they were recalled in and compress its block, or summarize a recalled level`)
    const text = await io.readArchive(f.archive).catch(() => undefined)
    const level = text === undefined ? undefined : levelOf(text, f)
    if (!level) return no('ARCHIVE_UNREADABLE', `the archive of fold ${id} cannot be read (${f.archive}, element ${f.entry}); the fold record stays the description of what it held`)
    if (from >= level.length) return no('BAD_PART', `fold ${id} has ${level.length} row(s), #0..#${level.length - 1}; take the numbers from the contents of the level`)
    const part = level.slice(from, count === undefined ? undefined : from + count)
    const texts = part.map((r, i) => levelRowText(r, from + i, io.cwd))
    const chars = texts.reduce((n, t) => n + t.length, 0)
    if (chars > MAX_RECALL_CHARS) {
      if (given) return no('PART_TOO_BIG', `rows #${from}..#${from + part.length - 1} of fold ${id} hold ${chars} chars, more than ${MAX_RECALL_CHARS}; narrow "count"`)
      // not a recall: no record is written (a pruned ledger is, when it
      // changed; a failed write only leaves the stale records to the next prune)
      if (ledger !== read) await write(ledger).catch(() => undefined)
      return { result: contentsText(f, level, texts) }
    }
    const recall: Recall = { fold: id, from, count: part.length, tool_use_id: callId, depth: region.depth, scope: region.scope, turn: region.turn, due: false }
    try {
      await write({ ...ledger, recalls: [...ledger.recalls, recall] })
    } catch (err) {
      // without its record the pair would be removed as any own call: nothing is shown
      return no('DENIED_STORAGE', `the fold ledger could not be written (${errorText(err)}); nothing was recalled`)
    }
    io.note(callId)
    return { result: [recalledText(id, f.what, f.call, f.turn, region.scope), ...texts].join('\n\n') }
  })
}

// ---- [SP_FOLD_02_03] ReturnRecalled

// [SP_FOLD_02_03] MarkDue: `after`, the length of the chain of open regions
// once one closed. A recall made deeper than that is due; one made outside
// any region is due at every close (and when the optimization mark closes a
// block without a region).
export function markDue(ledger: FoldLedger, after: number): FoldLedger {
  if (!ledger.recalls.some(r => !r.due && (r.depth === 0 || r.depth > after))) return ledger
  return { ...ledger, recalls: ledger.recalls.map(r => (!r.due && (r.depth === 0 || r.depth > after) ? { ...r, due: true } : r)) }
}

// [SP_FOLD_02_03] The mod's own return edit of a recall pair.
export function returnEdit(id: string): QueuedEdit {
  return { op: 'summarize', tool_use_id: id, summary: '', via: 'return' }
}
export function isOwnReturn(e: QueuedEdit): boolean {
  return isReturnEdit(e) && e.summary === ''
}

// [SP_FOLD_02_03] AddReturns: the batch with the mod's return edits as they
// stand now, after an accepted edit of the agent or the replacements of its
// disposable tags joined it. Each due recall, oldest first, gets one unless
// its pair is gone, is pinned, or is the target of an edit of the batch or
// lies in the span of one (so a return edit queued earlier leaves when such
// an edit comes); the batch never grows over MAX_QUEUE_EDITS. A batch
// without an edit of the agent gets none.
export function addReturns(edits: readonly QueuedEdit[], rows: readonly SessionMessage[], recalls: readonly Recall[], pinned: Pick<Pinned, 'ids'>): QueuedEdit[] {
  const mine = edits.filter(e => !isOwnReturn(e))
  if (!mine.length) return mine
  const taken = new Set<string>()
  for (const e of mine) for (const id of touchedBy(rows, e)?.ids ?? []) taken.add(id)
  const out = [...mine]
  for (const r of recalls) {
    if (!r.due || taken.has(r.tool_use_id) || pinned.ids.has(r.tool_use_id) || findToolUse(rows, r.tool_use_id) < 0) continue
    if (out.length >= MAX_QUEUE_EDITS) break
    out.push(returnEdit(r.tool_use_id))
    taken.add(r.tool_use_id)
  }
  return out
}

// ---- [SP_FOLD_02_07] the list of folds

// [SP_FOLD_02_07] The header line of the listing: the recalls not yet
// returned, by their folds; '' when there is none or the ledger is not read.
// With `rows`, only the records whose pair is in the conversation count (a
// record of a pair another compaction took goes with the next prune).
export function recallsHeader(read: Read<FoldLedger> | undefined, rows?: readonly SessionMessage[]): string {
  if (!read || read.state === 'unreadable') return ''
  const recalls = rows ? pruneRecalls(read.value, rows).recalls : read.value.recalls
  if (!recalls.length) return ''
  const due = recalls.filter(r => r.due).length
  return `Recalled levels in the conversation: ${recalls.length} (${[...new Set(recalls.map(r => r.fold))].join(', ')})${due ? `; ${due} return with your next batch of edits` : ''}`
}

// [SP_FOLD_02_07] BAD_FOLDS
export const BAD_FOLDS = '"folds": true takes only "from" and "count"; call it separately (BAD_FOLDS)'

// [SP_FOLD_02_07] The fold ledger for the agent, newest first: id, kind,
// what, the turn, the rows and the size of the level, the parent, `card` on
// a task's fold and `recalled` on one with a recall not yet returned; `from`
// and `count` page it, with the listing's defaults and bounds.
export function foldsList(read: Read<FoldLedger> | undefined, from: unknown, count: unknown): string {
  if (!read) return 'Folds: none (no storage for this session).'
  if (read.state === 'unreadable') return `Folds: the fold ledger cannot be read (${read.reason}); the fold records in the conversation still name their originals.`
  const all = [...read.value.folds].reverse()
  if (!all.length) return 'Folds: none recorded in this session.'
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.min(Math.max(0, Math.trunc(count)), MAX_LIST_COUNT) : LIST_COUNT
  const start = typeof from === 'number' && Number.isFinite(from) ? Math.min(Math.max(0, Math.trunc(from)), all.length) : 0
  const page = all.slice(start, start + n)
  const head = `Folds: ${all.length}, newest first${page.length ? `; showing ${start + 1}..${start + page.length}` : ''}. Each line: id, kind, what was folded, the turn it was applied after, its level's rows and chars.`
  const recalled = new Set(read.value.recalls.map(r => r.fold))
  const lines = page.map(f =>
    [
      `${f.id} ${f.kind}: ${f.what}`,
      `after turn ${f.turn}`,
      `${f.rows} row(s), ${kilo(f.chars)} chars`,
      ...(f.parent ? [`inside ${f.parent}`] : []),
      ...(f.region?.kind === 'task' ? ['card'] : []),
      ...(recalled.has(f.id) ? ['recalled'] : []),
    ].join(' · '),
  )
  return [head, ...lines].join('\n')
}
