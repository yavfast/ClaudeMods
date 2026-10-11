// Service notes of the agent ([C_CTX_03_07], [C_CTX_DEC_20]): free text on a
// row, a range of rows or a tool call pair, with an optional one-time
// reminder after some completed turns. They live in the tag registry, outside
// the messages, and change or protect nothing. Pure logic behind the TagIO
// port; register.ts binds it to `$` and runs every registry change on the
// registry's serial chain.
//
// Like stages.ts, this module and tags.ts import functions of each other; no
// top-level value of one reads the other's.
import type { SessionMessage } from 'claude-code'
import {
  describeEdit,
  fingerprint,
  locate,
  NO_REFS,
  OWN_TOOLS,
  STALE_INDEXES,
  mergedCallRow,
  touchedBy,
  type PageNote,
  type Produced,
  type QueuedEdit,
  type RefResolver,
} from './edits'
import { MARK } from './rows'
import { distinctive, survivors } from './stages'
import { MAX_REGISTRY_BYTES, type TagDeny, type TagIO, type TagRegistry } from './tags'
import { bytes, isCount, storageRefusal } from './store'

// ---- [SP_CTX_01_12] constants

export const MAX_NOTES = 200
export const MAX_NOTE = 1000
export const NOTE_PREFIX = 'n'
export const MAX_REMIND = 1000

// ---- [SP_CTX_01_21] Note

export type NoteTarget = { tool_use_id: string } | { anchor: string; hint: number } | { anchor: string; hint: number; toAnchor: string; toHint: number }

export type Note = { id: string; target: NoteTarget; text: string; createdTurn: number; remindAt?: number }

// The number of a note id (`n3` → 3), or undefined for anything else.
export function noteNumber(id: unknown): number | undefined {
  if (typeof id !== 'string' || !id.startsWith(NOTE_PREFIX)) return undefined
  const digits = id.slice(NOTE_PREFIX.length)
  return /^[1-9][0-9]*$/.test(digits) ? Number(digits) : undefined
}

function isTarget(v: unknown): v is NoteTarget {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const t = v as Record<string, unknown>
  if (typeof t.tool_use_id === 'string') return t.tool_use_id !== '' && t.anchor === undefined && t.toAnchor === undefined
  if (typeof t.anchor !== 'string' || !isCount(t.hint, 0) || t.tool_use_id !== undefined) return false
  if (t.toAnchor === undefined && t.toHint === undefined) return true
  return typeof t.toAnchor === 'string' && isCount(t.toHint, 0) && t.hint < t.toHint
}

// [SP_CTX_01_21] Every field of one stored note, by type and constraint.
export function isNote(raw: unknown): raw is Note {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const n = raw as Record<string, unknown>
  if (noteNumber(n.id) === undefined || !isTarget(n.target)) return false
  if (typeof n.text !== 'string' || !n.text.trim() || n.text.length > MAX_NOTE) return false
  if (!isCount(n.createdTurn, 0)) return false
  return n.remindAt === undefined || (isCount(n.remindAt, 0) && n.remindAt > n.createdTurn)
}

// [SP_CTX_01_10] The note fields of a registry: at most MAX_NOTES valid notes
// with unique ids, each below `nextNote`. The name of the bad field, if any.
export function badNoteFields(notes: unknown, nextNote: unknown): string | undefined {
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) return 'notes'
  if (!isCount(nextNote, 1)) return 'nextNote'
  const seen = new Set<number>()
  for (const n of notes) {
    if (!isNote(n)) return 'notes'
    const k = noteNumber(n.id)!
    if (seen.has(k)) return 'notes'
    seen.add(k)
    if (k >= nextNote) return 'nextNote'
  }
  return undefined
}

// The rows a note's target is on now: both rows of a pair, the located row,
// or the rows of a located range; undefined when it is not there.
export function noteRows(rows: readonly SessionMessage[], target: NoteTarget): number[] | undefined {
  if ('tool_use_id' in target) return touchedBy(rows, { op: 'drop', tool_use_id: target.tool_use_id })?.rows
  const at = locate(rows, target.anchor, target.hint)
  if (at < 0) return undefined
  if (!('toAnchor' in target)) return [at]
  const to = locate(rows, target.toAnchor, target.toHint)
  if (to < at) return undefined
  return Array.from({ length: to - at + 1 }, (_, k) => at + k)
}

// The row a note shows on (the first row of its target) and, for a range, its last.
function placeOf(rows: readonly SessionMessage[], n: Note): { first: number; last?: number } | undefined {
  const at = noteRows(rows, n.target)
  if (!at) return undefined
  if ('toAnchor' in n.target) return { first: at[0]!, last: at.at(-1)! }
  return { first: Math.min(...at) }
}

// ---- [SP_CTX_02_01] the listing

// `[<id>]` of each note on the rows of its target (a pair on both rows), a
// range `[<id> #a..#b]` on its first row; a note whose target is not found
// shows nowhere.
export function noteLabels(rows: readonly SessionMessage[], reg: Pick<TagRegistry, 'notes'>): Map<number, string[]> {
  const labels = new Map<number, string[]>()
  const put = (i: number, label: string) => labels.set(i, [...(labels.get(i) ?? []), label])
  for (const n of reg.notes) {
    const at = noteRows(rows, n.target)
    if (!at) continue
    if ('toAnchor' in n.target) put(at[0]!, `[${n.id} #${at[0]}..#${at.at(-1)}]`)
    else for (const i of at) put(i, `[${n.id}]`)
  }
  return labels
}

// One line of the `Notes:` block under a page, with the row it belongs to.
export type NoteLine = PageNote

// [SP_CTX_02_01] `<id> #<i>: <text>` + the turns left to a pending reminder;
// listRows keeps the lines whose row is on its page and names the others in
// `Notes elsewhere` (a note whose target is not found: no row).
export function noteLines(rows: readonly SessionMessage[], reg: Pick<TagRegistry, 'notes' | 'turn'>): NoteLine[] {
  const out: NoteLine[] = []
  for (const n of reg.notes) {
    const at = placeOf(rows, n)
    const remind = n.remindAt !== undefined ? ` (reminder in ${Math.max(0, n.remindAt - reg.turn)} turn(s))` : ''
    out.push(at ? { id: n.id, row: at.first, line: `${n.id} #${at.first}: ${n.text}${remind}` } : { id: n.id, line: `${n.id}: ${n.text}${remind}` })
  }
  return out
}

// [SP_CTX_02_01] The notes on one row, in full, for the whole-row view.
export function rowNotes(rows: readonly SessionMessage[], reg: Pick<TagRegistry, 'notes'>, index: number): string[] {
  return reg.notes.filter(n => (noteRows(rows, n.target) ?? []).includes(index)).map(n => `${n.id}: ${n.text}`)
}

// ---- [SP_CTX_02_29] notes in the close report

// The notes whose target (the first row of a range) lies in a..e, as
// `<id> #<i>: <text>`, at most `limit` of them, then "+<n> more"; "" for none.
export function blockNotes(rows: readonly SessionMessage[], reg: Pick<TagRegistry, 'notes'>, a: number, e: number, limit: number): string {
  const inBlock = reg.notes.flatMap(n => {
    const at = placeOf(rows, n)
    return at && at.first >= a && at.first <= e ? [{ at: at.first, text: `${n.id} #${at.first}: ${n.text}` }] : []
  })
  if (!inBlock.length) return ''
  inBlock.sort((x, y) => x.at - y.at)
  const shown = inBlock.slice(0, limit).map(x => x.text)
  return shown.join('; ') + (inBlock.length > limit ? `; +${inBlock.length - limit} more` : '')
}

// [SP_CTX_02_29] NotesHint: the count of notes only; no rows are read.
export function notesHint(notes: number): string {
  return notes > 0 ? ` You have ${notes} note(s); context_list shows them next to their rows and in full below each page.` : ''
}

// ---- [SP_CTX_02_32] context_note

export type NoteError =
  | 'BAD_OP'
  | 'NOTE_TEXT_REQUIRED'
  | 'TARGET_REQUIRED'
  | 'UNKNOWN_REF'
  | 'TARGET_NOT_FOUND'
  | 'INDEXES_STALE'
  | 'BAD_RANGE'
  | 'BAD_REMIND'
  | 'NOTES_FULL'
  | 'NO_NOTE'

const UNTRACKABLE = (i: number) => `row #${i} cannot be tracked (no text, no tool call); note a neighbouring row`

// `lines`: the line naming the call "last" resolved to ([SP_CTX_02_17]).
export type NoteOutcome = { registry: TagRegistry; added: string[]; removed: string[]; rejected: { code: NoteError; reason: string }[]; lines: string[] }

// [SP_CTX_02_32] Applies the requests in order to the registry on the rows as
// they are now; a rejected request leaves the rest of the batch going. Targets
// as context_tag builds them ([SP_CTX_02_11]) plus a range `index`..`to`;
// no pair rule: a note changes nothing. Pure.
export function applyNoteRequests(
  reg: TagRegistry,
  rows: readonly SessionMessage[],
  raws: readonly unknown[],
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
): NoteOutcome {
  let notes = [...reg.notes]
  let nextNote = reg.nextNote
  const out: NoteOutcome = { registry: reg, added: [], removed: [], rejected: [], lines: [] }
  raws.forEach((raw, k) => {
    const reject = (code: NoteError, why: string) => void out.rejected.push({ code, reason: `note ${k + 1}: ${why} (${code})` })
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    if (r.op !== 'add' && r.op !== 'remove') return reject('BAD_OP', 'op must be "add" or "remove"')
    if (r.op === 'remove') {
      if (r.to !== undefined) return reject('BAD_RANGE', '"to" belongs to op "add"')
      if (r.remind_in_turns !== undefined) return reject('BAD_REMIND', '"remind_in_turns" belongs to op "add"')
      const at = notes.findIndex(n => n.id === r.id)
      if (at < 0) return reject('NO_NOTE', `no note ${typeof r.id === 'string' ? r.id : JSON.stringify(r.id ?? null)}; give the "id" of a note`)
      out.removed.push(notes[at]!.id)
      notes = notes.filter((_, i) => i !== at)
      return
    }
    if (typeof r.text !== 'string' || !r.text.trim() || r.text.length > MAX_NOTE) return reject('NOTE_TEXT_REQUIRED', `a note needs "text" of 1..${MAX_NOTE} chars`)
    if (r.remind_in_turns !== undefined && (!isCount(r.remind_in_turns, 1) || r.remind_in_turns > MAX_REMIND))
      return reject('BAD_REMIND', `remind_in_turns is an integer in 1..${MAX_REMIND}`)
    const hasId = r.tool_use_id !== undefined
    const hasIndex = r.index !== undefined
    const hasRef = r.ref !== undefined
    if (
      [hasId, hasIndex, hasRef].filter(Boolean).length !== 1 ||
      (hasId && (typeof r.tool_use_id !== 'string' || !r.tool_use_id)) ||
      (hasIndex && !Number.isInteger(r.index)) ||
      (hasRef && (typeof r.ref !== 'string' || !r.ref))
    )
      return reject('TARGET_REQUIRED', 'give exactly one of tool_use_id (a string), index (an integer) or ref (an alias or "last")')
    if (r.to !== undefined && !hasIndex) return reject('BAD_RANGE', '"to" needs "index", the first row of the range')
    let target: NoteTarget
    if (hasId || hasRef) {
      let id = r.tool_use_id as string
      if (hasRef) {
        // [SP_CTX_02_17] "last" resolves on these rows and names its call
        const got = resolve(r.ref as string, rows)
        if ('error' in got) return reject('UNKNOWN_REF', got.error)
        if (got.line && !out.lines.includes(got.line)) out.lines.push(got.line)
        id = got.id
      }
      target = { tool_use_id: id }
      if (!noteRows(rows, target)) return reject('TARGET_NOT_FOUND', `no completed tool call with id ${id}; refresh context_list`)
    } else {
      if (staleIndexes) return reject('INDEXES_STALE', STALE_INDEXES)
      const index = r.index as number
      if (!rows[index]) return reject('TARGET_NOT_FOUND', `index out of range (0..${rows.length - 1}); refresh context_list`)
      // a row with no text and no tool ids (thinking only) has a fingerprint
      // Locate cannot tell apart: the first application would drop the note
      if (!distinctive(rows[index]!)) return reject('TARGET_NOT_FOUND', UNTRACKABLE(index))
      target = { anchor: fingerprint(rows[index]!), hint: index }
      if (r.to !== undefined) {
        const to = r.to
        if (!Number.isInteger(to) || (to as number) <= index || (to as number) > rows.length - 1)
          return reject('BAD_RANGE', `"to" is the last row of the range: an integer in ${index + 1}..${rows.length - 1}`)
        if (!distinctive(rows[to as number]!)) return reject('TARGET_NOT_FOUND', UNTRACKABLE(to as number))
        target = { ...target, toAnchor: fingerprint(rows[to as number]!), toHint: to as number }
      }
    }
    const note: Note = { id: `${NOTE_PREFIX}${nextNote}`, target, text: r.text.trim(), createdTurn: reg.turn }
    if (r.remind_in_turns !== undefined) note.remindAt = reg.turn + (r.remind_in_turns as number)
    // tags and notes share the size limit of the registry file
    if (notes.length >= MAX_NOTES || bytes({ ...reg, notes: [...notes, note], nextNote: nextNote + 1 }) > MAX_REGISTRY_BYTES)
      return reject('NOTES_FULL', `the registry is full (${MAX_NOTES} notes or ${MAX_REGISTRY_BYTES} bytes with the tags); remove notes you no longer need`)
    notes = [...notes, note]
    nextNote += 1
    out.added.push(note.id)
  })
  out.registry = { ...reg, notes, nextNote }
  return out
}

export type NoteArgs = { agentId?: unknown; notes?: unknown }

// [SP_CTX_02_32] The registry is read, changed and written on the registry's
// chain (io.onRegistry). `storageDown` is why the storage is unavailable.
export async function contextNote(
  io: TagIO,
  args: NoteArgs,
  storageDown?: string,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
): Promise<{ result: string } | { deny: string; code: TagDeny }> {
  if (args.agentId) return { code: 'DENIED_SUBAGENT', deny: "a subagent's context cannot be noted; only the main conversation's." }
  if (!Array.isArray(args.notes) || args.notes.length === 0 || args.notes.length > MAX_NOTES)
    return { code: 'DENIED_EMPTY', deny: `"notes" must be a list of 1..${MAX_NOTES} requests.` }
  if (storageDown !== undefined) return { code: 'DENIED_STORAGE', deny: storageRefusal(storageDown) }
  const raws = args.notes
  const onRegistry = io.onRegistry ?? (<T>(work: () => Promise<T>) => work())
  return onRegistry(async () => {
    const read = await io.readTags()
    if (read.state === 'unreadable')
      return { code: 'DENIED_REGISTRY_READ' as const, deny: `the tag registry cannot be read (${read.reason}); it is left as it is.` }
    const out = applyNoteRequests(read.value, await io.rows(), raws, resolve, staleIndexes)
    if (out.added.length || out.removed.length) {
      try {
        await io.writeTags(out.registry)
      } catch (err) {
        // no note of this call added or removed
        return { code: 'DENIED_REGISTRY_WRITE' as const, deny: `could not save the tag registry: ${String(err)}` }
      }
    }
    const list = (ids: string[]) => (ids.length ? ids.join(', ') : 'none')
    return {
      result: [
        `Added ${list(out.added)}; removed ${list(out.removed)}; ${out.registry.notes.length} note(s) in the registry.`,
        ...out.lines,
        out.rejected.length ? `Rejected: ${out.rejected.map(x => x.reason).join('; ')}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  })
}

// ---- [SP_CTX_02_14] RelocateNote

// RelocateNote for every note of the registry after an apply or a seed: a
// note on a row an applied edit replaced moves to the last row that edit
// made; one on a row removed without a replacement (or not found) is dropped
// and named; an untouched pair keeps its target; a range keeps the rows that
// stayed, a removed end moving inward. `remindAt` stays. The seed's CarryNote
// does not move a note: its row keeps its fingerprint. Pure.
export function rebindNotes(
  reg: TagRegistry,
  before: readonly SessionMessage[],
  after: readonly SessionMessage[],
  applied: readonly QueuedEdit[],
  produced: readonly Produced[],
): { registry: TagRegistry; dropped: string[] } {
  if (!reg.notes.length) return { registry: reg, dropped: [] }
  const changed = new Set<number>()
  const replacedIds = new Set<string>()
  const removedIds = new Set<string>()
  for (const e of applied) {
    const t = touchedBy(before, e)
    for (const i of t?.rows ?? []) changed.add(i)
    for (const id of t?.ids ?? []) (e.op === 'drop' ? removedIds : replacedIds).add(id)
  }
  const map = survivors(before, after, changed)
  // Spot(x): the row of `after` that row x of `before` became, or undefined (removed)
  const spot = (x: number): number | undefined => {
    const labels = new Set(applied.filter(e => e.op !== 'drop' && (touchedBy(before, e)?.rows ?? []).includes(x)).map(describeEdit))
    const made = produced.filter(p => labels.has(p.edit))
    if (made.length) return made.reduce((a, b) => (b.index > a.index ? b : a)).index
    if (labels.size) return undefined
    const k = map.get(x)
    if (k !== undefined || changed.has(x)) return k
    // an untouched call row MergeCallRows joined with the other call rows of its response
    const at = mergedCallRow(before[x]!, after)
    return at < 0 ? undefined : at
  }
  const rowTarget = (k: number): NoteTarget => ({ anchor: fingerprint(after[k]!), hint: k })
  const notes: Note[] = []
  const dropped: string[] = []
  for (const n of reg.notes) {
    const moved = relocateNote(n.target)
    if (moved) notes.push({ ...n, target: moved })
    else dropped.push(n.id)
  }
  return { registry: { ...reg, notes }, dropped }

  function relocateNote(target: NoteTarget): NoteTarget | undefined {
    if ('tool_use_id' in target) {
      const pair = touchedBy(before, { op: 'drop', tool_use_id: target.tool_use_id })
      if (!pair) return undefined
      if (removedIds.has(target.tool_use_id)) return undefined
      if (replacedIds.has(target.tool_use_id)) {
        const k = spot(pair.rows[1]!)
        return k === undefined ? undefined : rowTarget(k)
      }
      return touchedBy(after, { op: 'drop', tool_use_id: target.tool_use_id }) ? target : undefined
    }
    const x = locate(before, target.anchor, target.hint)
    if (x < 0) return undefined
    if (!('toAnchor' in target)) {
      const k = spot(x)
      return k === undefined ? undefined : rowTarget(k)
    }
    const y = locate(before, target.toAnchor, target.toHint)
    if (y < x) return undefined
    let s: number | undefined
    let e: number | undefined
    for (let i = x; i <= y && s === undefined; i++) s = spot(i)
    for (let i = y; i >= x && e === undefined; i--) e = spot(i)
    if (s === undefined || e === undefined || e < s) return undefined
    if (s === e) return rowTarget(s)
    return { anchor: fingerprint(after[s]!), hint: s, toAnchor: fingerprint(after[e]!), toHint: e }
  }
}

// ---- [SP_CTX_02_33] NoteReminders

// The due reminders of the registry, oldest first, and the registry with
// their `remindAt` removed; undefined when none is due. Pure.
export function dueReminders(reg: TagRegistry): { registry: TagRegistry; lines: string[] } | undefined {
  const due = reg.notes.filter(n => n.remindAt !== undefined && n.remindAt <= reg.turn)
  if (!due.length) return undefined
  const ids = new Set(due.map(n => n.id))
  const notes = reg.notes.map(n => {
    if (!ids.has(n.id)) return n
    const { remindAt: _r, ...rest } = n
    return rest
  })
  // [SP_CTX_DEC_17] the line names the note's author: the agent itself
  const lines = due.map(n => `${MARK} reminder from your note ${n.id} (set ${reg.turn - n.createdTurn} turn(s) ago): ${n.text}`)
  return { registry: { ...reg, notes }, lines }
}

// [SP_CTX_02_33] Which of the mod's own tools carry reminders: not
// context_edit and context_handoff, whose calls DropOwnCalls removes at the
// very apply or seed they trigger (review round 39); `remindAt` stays.
export function remindsAfter(tool: string): boolean {
  const name = tool.startsWith(OWN_TOOLS) ? tool.slice(OWN_TOOLS.length) : tool
  return name !== 'context_edit' && name !== 'context_handoff'
}

// [SP_CTX_02_33] After one of the mod's own tools, the reminders go at the
// end of its own result; a refused call gets none.
export function withReminderLines<T extends object>(out: T, lines: readonly string[]): T {
  if (!lines.length || !('result' in out) || typeof (out as { result?: unknown }).result !== 'string') return out
  return { ...out, result: `${(out as { result: string }).result}\n${lines.join('\n')}` }
}

// [SP_CTX_02_16] [SP_CTX_02_33] Reminders come only with a finished call of
// the main loop, not denied, not of the mod's own tools, with a tool_use_id.
export function remindable(f: { agentId?: unknown; denied: boolean; tool: string; tool_use_id?: string }): boolean {
  return !f.agentId && !f.denied && !f.tool.startsWith(OWN_TOOLS) && !!f.tool_use_id
}

// [SP_CTX_02_33] The registry as it is once this call's due reminders are
// delivered: what context_list counts before it delivers them.
export function afterReminders(reg: TagRegistry): TagRegistry {
  return dueReminders(reg)?.registry ?? reg
}

// [SP_CTX_02_33] The caller runs it on the registry's chain, after the alias
// line. A missing or unreadable registry gives nothing; a failed write gives
// nothing and leaves `remindAt`, so the next call tries again.
export async function noteReminders(io: Pick<TagIO, 'readTags' | 'writeTags'>): Promise<string[]> {
  const read = await io.readTags()
  if (read.state !== 'ok') return []
  const due = dueReminders(read.value)
  if (!due) return []
  try {
    await io.writeTags(due.registry)
  } catch {
    return []
  }
  return due.lines
}

