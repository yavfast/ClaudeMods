// The journal of effect ([SP_CTX_01_19], [SP_CTX_02_31]): what each
// application compressed and which compressed reproducible outputs or archives
// the agent read again. No estimate of what an application freed: the
// telemetry measures that (`Last apply`, [SP_CTX_02_28]). Pure logic behind
// a small port; register.ts binds it to `$` on the journal's own chain.
import type { SessionMessage } from 'claude-code'
import { describeEdit, MAX_QUEUE_EDITS, touchedBy, type ApplyReport, type QueuedEdit } from './edits'
import { MAX_QUEUE_BYTES } from './queue'
import { isCount, jsonObject, trimOldest, type Read } from './store'

// [SP_CTX_01_12]
export const MAX_JOURNAL = 1000

// [SP_CTX_01_19]
export type JournalEntry =
  | { kind: 'apply'; at: number; edits: number; archive: string; compressed: string[] }
  | { kind: 'changed'; at: number; path: string }
  | { kind: 'reread'; at: number; path: string; tool_use_id: string; archive: boolean }

export type Journal = { entries: JournalEntry[] }

export const EMPTY_JOURNAL: Journal = { entries: [] }

function isEntry(raw: unknown): raw is JournalEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const e = raw as Record<string, unknown>
  if (!isCount(e.at, 0)) return false
  switch (e.kind) {
    case 'apply':
      return (
        isCount(e.edits, 1) &&
        typeof e.archive === 'string' &&
        Array.isArray(e.compressed) &&
        e.compressed.length <= MAX_QUEUE_EDITS &&
        e.compressed.every(p => typeof p === 'string')
      )
    case 'changed':
      return typeof e.path === 'string'
    case 'reread':
      return typeof e.path === 'string' && typeof e.tool_use_id === 'string' && typeof e.archive === 'boolean'
    default:
      return false
  }
}

// [SP_CTX_01_19] Read states as the queue's: a bad entry makes the file
// unreadable, never silently an empty journal.
export function parseJournal(text: string): Read<Journal> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  const entries = raw.value.entries
  if (!Array.isArray(entries) || entries.length > MAX_JOURNAL) return { state: 'unreadable', reason: 'bad field(s): entries' }
  const bad = entries.findIndex(e => !isEntry(e))
  return bad >= 0 ? { state: 'unreadable', reason: `bad entry ${bad + 1}` } : { state: 'ok', value: { entries } }
}

// [SP_CTX_02_31] Trim: the oldest entries go while there are more than
// MAX_JOURNAL or the file would exceed MAX_QUEUE_BYTES.
export function trimJournal(j: Journal): Journal {
  const entries = trimOldest(j.entries, MAX_JOURNAL, MAX_QUEUE_BYTES, e => ({ entries: e }))
  return entries === j.entries ? j : { entries }
}

function withEntry(j: Journal, e: JournalEntry): Journal {
  return trimJournal({ entries: [...j.entries, e] })
}

// The file_path of each Read call among the pairs `ids` name, in row order.
function readPaths(rows: readonly SessionMessage[], ids: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const r of rows)
    for (const u of r.toolUses) {
      if (u.tool !== 'Read' || !ids.has(u.tool_use_id)) continue
      const path = (u.input as { file_path?: unknown } | undefined)?.file_path
      if (typeof path === 'string') out.push(path)
    }
  return out
}

// [SP_CTX_02_31] JournalApply's entry: `compressed` holds the distinct
// file_path of every Read call in the pairs the applied summarize and drop
// edits name or the applied collapse spans hold (the first MAX_QUEUE_EDITS).
// None when nothing applied. Pure.
export function applyEntry(at: number, report: Pick<ApplyReport, 'applied'>, archive: string, before: readonly SessionMessage[], edits: readonly QueuedEdit[]): JournalEntry | undefined {
  const labels = new Set(report.applied)
  const applied = edits.filter(e => labels.has(describeEdit(e)))
  if (!applied.length) return undefined
  const ids = new Set<string>()
  for (const e of applied) if (e.op === 'summarize' || e.op === 'drop' || e.op === 'collapse') for (const id of touchedBy(before, e)?.ids ?? []) ids.add(id)
  const compressed = [...new Set(readPaths(before, ids))].slice(0, MAX_QUEUE_EDITS)
  return { kind: 'apply', at, edits: applied.length, archive, compressed }
}

// [SP_CTX_02_31] JournalReread: a Read of a path some application compressed
// (and no own write of it since), or of an archive or media file of an
// application (`<archives>/<id>.json`, `<archives>/<id>/…`: the media sit
// beside the archive, in either folder, phase 35). The journal with the
// entry, or undefined: nothing to record. Pure.
export function withReread(j: Journal, path: string, toolUseId: string, now: number): Journal | undefined {
  const applies = j.entries.flatMap((e, k) => (e.kind === 'apply' ? [{ e, k }] : []))
  const archive = applies.some(({ e }) => e.archive !== '' && (path === e.archive || path.startsWith(`${e.archive.replace(/\.json$/, '')}/`)))
  const compressed = applies.some(({ e, k }) => e.compressed.includes(path) && !j.entries.slice(k + 1).some(x => x.kind === 'changed' && x.path === path))
  if (!archive && !compressed) return undefined
  return withEntry(j, { kind: 'reread', at: now, path, tool_use_id: toolUseId, archive })
}

// [SP_CTX_02_31] JournalChanged: a write tool changed a path some application
// compressed; a later read of it reads new content. Pure.
export function withChanged(j: Journal, path: string, now: number): Journal | undefined {
  if (!j.entries.some(e => e.kind === 'apply' && e.compressed.includes(path))) return undefined
  return withEntry(j, { kind: 'changed', at: now, path })
}

// [SP_CTX_01_20] The journal's part of the telemetry.
export type JournalSummary = { applications: number; rereads: number; archiveRereads: number } | { unreadable: string }

export function journalSummary(read: Read<Journal>): JournalSummary {
  if (read.state === 'unreadable') return { unreadable: read.reason }
  const rereads = read.value.entries.filter(e => e.kind === 'reread')
  return {
    applications: read.value.entries.filter(e => e.kind === 'apply').length,
    rereads: rereads.length,
    archiveRereads: rereads.filter(e => e.kind === 'reread' && e.archive).length,
  }
}

// What the journal needs from the host: a part of the journal's Store
// ([SP_CTX_01_07]); register.ts runs each change on the journal's serial chain.
export type JournalIO = {
  read: () => Promise<Read<Journal>>
  write: (j: Journal) => Promise<void>
}

// [SP_CTX_02_31] One change of the journal: an unreadable journal is never
// overwritten; `change` sees the journal (empty when missing, if `missingOk`)
// and returns the new one or undefined. A failed write loses the entry only.
async function change(io: JournalIO, missingOk: boolean, step: (j: Journal) => Journal | undefined): Promise<void> {
  const read = await io.read()
  if (read.state === 'unreadable' || (read.state === 'missing' && !missingOk)) return
  const next = step(read.value)
  if (next) await io.write(next).catch(() => undefined)
}

// [SP_CTX_02_31] JournalApply, in the background of HandleCompaction.
export function journalApply(io: JournalIO, entry: JournalEntry): Promise<void> {
  return change(io, true, j => withEntry(j, entry))
}

// [SP_CTX_02_31] JournalReread, in the background of the call hook after a Read without error.
export function journalReread(io: JournalIO, path: string, toolUseId: string, now: number): Promise<void> {
  return change(io, false, j => withReread(j, path, toolUseId, now))
}

// [SP_CTX_02_31] JournalChanged, in the background of the call hook after a write tool without error.
export function journalChanged(io: JournalIO, path: string, now: number): Promise<void> {
  return change(io, false, j => withChanged(j, path, now))
}
