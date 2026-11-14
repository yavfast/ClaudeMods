// Folds ([C_FOLD_02], [SP_FOLD_01_01], [SP_FOLD_01_02], [SP_FOLD_02_01]): every
// applied edit that leaves a fold record (summarize, collapse, describe, a
// disposable tag's replacement too) gets an id, written into the record's
// text (FOLD_NOTE of rows.ts), and an entry in the fold ledger `folds.json`
// of the session's storage: where its level lies in the archive, what it
// folded and which later fold holds its record. Pure logic behind a Store;
// register.ts binds it to `$` on the `folds` chain.
import type { SessionMessage } from 'claude-code'
import { isFoldRegion, kilo, LIST_COUNT, MAX_LIST_COUNT, MAX_SOURCE, oneLine, type ApplyReport, type Folded, type FoldRegion, type QueuedEdit } from './edits'
import { FOLD_NUMBER, FOLD_PREFIX, foldNumbers, foldOfRecord, resultsOf, totalChars } from './rows'
import { isCount, jsonObject, renewOf, trimOldest, type Held, type Read, type Store } from './store'

// [SP_FOLD_01_06]
export const MAX_FOLDS = 2000
export const MAX_RECALLS = 50
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

// [SP_FOLD_01_03] A recall not yet returned (written from phase 2 on).
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

// An edit that leaves a fold record: not drop, rewrite or state.
export function isFoldEdit(e: QueuedEdit): boolean {
  return e.op === 'summarize' || e.op === 'collapse' || e.op === 'describe'
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

// ---- [SP_FOLD_02_07] the list of folds

// [SP_FOLD_02_07] BAD_FOLDS
export const BAD_FOLDS = '"folds": true takes only "from" and "count"; call it separately (BAD_FOLDS)'

// [SP_FOLD_02_07] The fold ledger for the agent, newest first: id, kind,
// what, the turn, the rows and the size of the level, the parent, and `card`
// on a task's fold; `from` and `count` page it, with the listing's defaults
// and bounds.
export function foldsList(read: Read<FoldLedger> | undefined, from: unknown, count: unknown): string {
  if (!read) return 'Folds: none (no storage for this session).'
  if (read.state === 'unreadable') return `Folds: the fold ledger cannot be read (${read.reason}); the fold records in the conversation still name their originals.`
  const all = [...read.value.folds].reverse()
  if (!all.length) return 'Folds: none recorded in this session.'
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.min(Math.max(0, Math.trunc(count)), MAX_LIST_COUNT) : LIST_COUNT
  const start = typeof from === 'number' && Number.isFinite(from) ? Math.min(Math.max(0, Math.trunc(from)), all.length) : 0
  const page = all.slice(start, start + n)
  const head = `Folds: ${all.length}, newest first${page.length ? `; showing ${start + 1}..${start + page.length}` : ''}. Each line: id, kind, what was folded, the turn it was applied after, its level's rows and chars.`
  const lines = page.map(f =>
    [`${f.id} ${f.kind}: ${f.what}`, `after turn ${f.turn}`, `${f.rows} row(s), ${kilo(f.chars)} chars`, ...(f.parent ? [`inside ${f.parent}`] : []), ...(f.region?.kind === 'task' ? ['card'] : [])].join(
      ' · ',
    ),
  )
  return [head, ...lines].join('\n')
}
