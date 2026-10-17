// Host rows ([SP_CTX_01_31], [C_CTX_06_11], [SP_CTX_DEC_42] B″): the rows
// the host writes with `isMeta` in a frame of its own (an expanded skill, a
// subagent's report between turns). Neither `$.session.messages()` nor the
// compaction's `e.messages` has them; after a handler returned its rows, the
// host puts each right after the visible row that stood before it, when that
// row came back with its handle (spike context_editor_hostrows, Q4, Q6). So
// the mod records each at `session.append` with the handle of the row before
// it (RecordHostRows, [SP_CTX_02_60]), shows them in context_list as a list
// of their own with ids, and a `drop` by id brings the row before back
// without its handle (HostList, [SP_CTX_02_61]). Pure logic behind a Store;
// register.ts binds it to `$` on the `hostrows` chain.
import type { SessionMessage } from 'claude-code'
import { hostKind, markerKind, REPAIR_MARKER, type HostKind } from './rows'
import { isCount, jsonObject, trimOldest, type Read, type Renew } from './store'

// [SP_CTX_01_32]
export const MAX_HOST_ROWS = 200
export const MAX_HOST_TEXT = 100_000
export const MAX_HEAD = 80
export const MAX_HOST_LIST = 20

export { hostKind, type HostKind }
export type AfterKind = 'prompt' | 'response' | 'result'

// [SP_CTX_01_31]
export type HostRowRecord = {
  id: string
  kind: HostKind
  after: string
  afterKind: AfterKind
  afterHead: string
  text: string
  chars: number
}

export type HostRows = { rows: HostRowRecord[]; next: number }

export const emptyHostRows = (): HostRows => ({ rows: [], next: 1 })

// [SP_CTX_01_31] `h` and a number
export const HOST_ID = /^h[1-9]\d*$/

function isRecord(v: unknown): v is HostRowRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    HOST_ID.test(r.id) &&
    (r.kind === 'skill' || r.kind === 'peer') &&
    typeof r.after === 'string' &&
    r.after !== '' &&
    (r.afterKind === 'prompt' || r.afterKind === 'response' || r.afterKind === 'result') &&
    typeof r.afterHead === 'string' &&
    r.afterHead.length <= MAX_HEAD &&
    typeof r.text === 'string' &&
    r.text.length <= MAX_HOST_TEXT &&
    isCount(r.chars) &&
    r.chars >= r.text.length
  )
}

// [SP_CTX_01_31] Read states as the other storage files: a bad record or a
// broken invariant makes the file unreadable, never silently empty.
export function parseHostRows(text: string): Read<HostRows> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  const { rows, next } = raw.value
  if (!Array.isArray(rows) || rows.length > MAX_HOST_ROWS) return { state: 'unreadable', reason: 'bad field(s): rows' }
  if (!isCount(next, 1)) return { state: 'unreadable', reason: 'bad field(s): next' }
  const bad = rows.findIndex(r => !isRecord(r))
  if (bad >= 0) return { state: 'unreadable', reason: `bad record ${bad + 1}` }
  const ids = (rows as HostRowRecord[]).map(r => Number(r.id.slice(1)))
  if (new Set(ids).size !== ids.length || ids.some(n => n >= next)) return { state: 'unreadable', reason: 'bad field(s): id' }
  return { state: 'ok', value: { rows: rows as HostRowRecord[], next } }
}

// ---- [SP_CTX_02_60] RecordHostRows

// The module's memory: the last visible row of the main conversation, and
// the copy window ([SP_CTX_02_60]): from the start of a compaction branch to
// the next turn or the person's prompt, no row becomes the one before.
export type HostMemory = { last?: { handle: string; kind: AfterKind; head: string }; window: boolean }

export function newHostMemory(): HostMemory {
  return { window: false }
}

// [SP_CTX_02_60] At the start of every compaction branch, synchronously.
export function openWindow(mem: HostMemory): void {
  mem.window = true
  mem.last = undefined
}

// [SP_CTX_02_60] turn.start.
export function closeWindow(mem: HostMemory): void {
  mem.window = false
}

// What RecordHostRows reads of a `session.append` event.
export type HostEvent = {
  door: string
  uuid: string
  agentId?: string
  origin: { kind: string }
  message: { type?: string; isMeta?: true; content?: readonly { type: string; [field: string]: unknown }[] }
}

// [SP_CTX_02_12] The origins of the person's prompt (stream-json: unclassified).
const PERSON_ORIGINS = ['composer', 'bridge', 'sdk', 'unclassified']

const textOf = (blocks: readonly { type: string; [field: string]: unknown }[]) =>
  blocks.flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n')

const MEDIA = new Set(['image', 'document'])

// One line cut to `max` chars, never splitting a surrogate pair.
function line(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut) + '…'
}

// [SP_CTX_02_60] PersonPrompt: a prompt or command row the person sent, not
// the mod's own compaction command (the terminal passes it by the prompt door).
function personPrompt(e: HostEvent, text: string): boolean {
  if (e.door !== 'prompt' && e.door !== 'command') return false
  if (!PERSON_ORIGINS.includes(e.origin?.kind)) return false
  // the output and caveat rows of a local command (the mod's /compact in the terminal) are no prompt
  if (/^\s*<local-command-(stdout|caveat)>/.test(text)) return false
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
  return markerKind(args ?? text.trim()) === undefined && !text.includes(REPAIR_MARKER)
}

// [SP_CTX_02_60] Head(m): what the list names the row before by.
export function headOf(kind: AfterKind, text: string, tools: readonly string[]): string {
  if (kind === 'result') return 'the result of a tool call'
  if (kind === 'response') return text.trim() ? quoted('your text', text) : line(`your call ${tools[0] ?? '?'}`, MAX_HEAD - 1)
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim()
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
    return quoted('the command', `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`)
  }
  return quoted('the prompt', text)
}

// `<head> "<value>"` in at most MAX_HEAD chars; a cut value ends in "…".
function quoted(head: string, value: string): string {
  return `${head} "${line(value, MAX_HEAD - head.length - 4)}"`
}

// [SP_CTX_02_60] The record a host row gives, without its id, or undefined.
// A visible row (a user or assistant row without `isMeta`) becomes the row
// before, unless the copy window is open and it is no prompt of the person;
// the person's prompt closes the window. Pure but for `mem`.
export type HostDraft = Omit<HostRowRecord, 'id'>

export function observeHostRow(mem: HostMemory, e: HostEvent): HostDraft | undefined {
  if (e.agentId) return undefined
  const m = e.message
  const blocks = m.content ?? []
  const text = textOf(blocks)
  if ((m.type === 'user' || m.type === 'assistant') && !m.isMeta) {
    if (mem.window && !personPrompt(e, text)) return undefined
    mem.window = false
    const kind: AfterKind = m.type === 'assistant' ? 'response' : blocks.some(b => b.type === 'tool_result') ? 'result' : 'prompt'
    const tools = blocks.flatMap(b => (b.type === 'tool_use' && typeof b.name === 'string' ? [b.name] : []))
    mem.last = { handle: e.uuid, kind, head: headOf(kind, text, tools) }
    return undefined
  }
  if (m.type !== 'user' || !m.isMeta || mem.window || !mem.last) return undefined
  if (blocks.some(b => b.type === 'tool_result' || MEDIA.has(b.type))) return undefined
  const kind = hostKind(text)
  if (!kind) return undefined
  return {
    kind,
    after: mem.last.handle,
    afterKind: mem.last.kind,
    afterHead: mem.last.head,
    text: text.length > MAX_HOST_TEXT ? text.slice(0, MAX_HOST_TEXT) : text,
    chars: text.length,
  }
}

// [SP_CTX_02_60] The file with one record more, ids from `next`; the oldest
// go while there are more than MAX_HOST_ROWS or the file exceeds `maxBytes`.
export function withHostRow(h: HostRows, draft: HostDraft, maxBytes: number): HostRows {
  const rows = trimOldest([...h.rows, { id: `h${h.next}`, ...draft }], MAX_HOST_ROWS, maxBytes, r => ({ rows: r, next: h.next + 1 }))
  return { rows, next: h.next + 1 }
}


// [SP_CTX_02_60] Writes one record through the Renew port of the host rows'
// Store ([SP_CTX_01_07]): an unreadable file is moved aside and a new one
// starts; one that cannot be moved aside is never overwritten. register.ts
// enters the `hostrows` chain synchronously at the event (CONC-01) and passes
// its token, so the port runs on that turn. A failure loses this record only.
export async function recordHostRow(renew: Renew<HostRows>, draft: HostDraft, maxBytes: number): Promise<void> {
  await renew(h => withHostRow(h, draft, maxBytes))
}

// [SP_CTX_01_31] After an apply the host writes the rows a handler returned
// with their handle as copies with new uuids (live run of phase 45: the
// command row 30e8cce4 came back as 68e09e30, its skill after the copy), so
// the handle of the row before changes with each apply. The commit keeps a
// record by the position of that row among the returned rows, `#<k>`; the
// next compaction's input starts with those rows, so its row k carries the
// new handle (RebaseHostRows).
const AT = /^#(\d+)$/

// What kind of row a view row is (KindOf of [SP_CTX_02_60]).
function kindOf(row: SessionMessage): AfterKind {
  return row.role === 'assistant' ? 'response' : (row.toolResults?.length ?? 0) > 0 ? 'result' : 'prompt'
}

// [SP_CTX_01_31] The records with every `#<k>` replaced by the handle of row
// k of `rows` (a compaction's input) when that row has one, is of the
// record's `afterKind` and has its `afterHead`; otherwise the position stays
// and names no row (stale positions, a shifted loaded chain: never another row).
export function rebaseHostRows(records: readonly HostRowRecord[], rows: readonly SessionMessage[]): HostRowRecord[] {
  return records.map(r => {
    const k = AT.exec(r.after)
    const row = k ? rows[Number(k[1])] : undefined
    if (row?.handle === undefined || kindOf(row) !== r.afterKind) return r
    const head = headOf(r.afterKind, row.text, row.toolUses.map(u => u.tool))
    return head === r.afterHead ? { ...r, after: row.handle } : r
  })
}

// [SP_CTX_02_60] [SP_CTX_02_61] After the commit point of an apply or a
// repair: a record stays only while the row before it came back with its
// handle, and then names it by its position among the returned rows.
// `input`: the compaction's input rows (a position of an earlier apply is
// rebased on them; none: such a record goes); `out`: the handles of the rows
// it returned, in order (undefined: none).
export function keepHostRows(h: HostRows, input: readonly SessionMessage[], out: readonly (string | undefined)[]): HostRows | undefined {
  const at = new Map<string, number>()
  out.forEach((handle, k) => {
    if (handle !== undefined && !at.has(handle)) at.set(handle, k)
  })
  const rows = rebaseHostRows(h.rows, input).flatMap(r => {
    const k = at.get(r.after)
    return k === undefined ? [] : [{ ...r, after: `#${k}` }]
  })
  return rows.length === h.rows.length && rows.every((r, k) => r.after === h.rows[k]!.after) ? undefined : { ...h, rows }
}

// [SP_CTX_02_61] The handles the returned rows carry.
export function handlesOf(rows: readonly SessionMessage[]): Set<string> {
  return new Set(rows.flatMap(r => (r.handle !== undefined ? [r.handle] : [])))
}

// ---- [SP_CTX_02_61] HostList

// [SP_CTX_02_61] The header line of context_list, also with "count":0; "" without records.
export function hostHeader(h: HostRows): string {
  if (!h.rows.length) return ''
  const chars = h.rows.reduce((n, r) => n + r.chars, 0)
  const names = h.rows.map(r => `${r.id} ${r.kind}`).join(', ')
  return `Host rows: ${h.rows.length} (~${chars} chars), not in the indexes; drop one with {"op":"drop","host":"<id>"}: ${names}`
}

// [SP_CTX_02_61] The section after the rows of a page that holds the newest
// row: the newest MAX_HOST_LIST records, newest last; "" without records.
export function hostSection(h: HostRows): string {
  if (!h.rows.length) return ''
  const lines = h.rows.slice(-MAX_HOST_LIST).map(r => `${r.id} ${r.kind}, ${r.chars} chars, after ${r.afterHead}: "${line(r.text, MAX_HEAD)}"`)
  return ['Host rows (added by the host, not the person\'s words):', ...lines].join('\n')
}

// [SP_CTX_02_61] The record a `drop` names; ids are unique in the file (`next`).
export function hostRecord(rows: readonly HostRowRecord[], id: string): HostRowRecord | undefined {
  for (let k = rows.length - 1; k >= 0; k--) if (rows[k]!.id === id) return rows[k]
  return undefined
}

// [SP_CTX_02_61] DetachNote: what the row before loses; "" for a result row
// (an apply rebuilds result rows anyway, [SP_CTX_DEC_02]).
export function detachNote(rec: Pick<HostRowRecord, 'afterKind'>): string {
  if (rec.afterKind === 'prompt') return "the prompt before it comes back without its handle: the host's attachments of that prompt (reminders, files, editor context) go; its text stays"
  if (rec.afterKind === 'response') return 'your response before it comes back without its handle: its thinking blocks go, and host rows after its other rows go with it'
  return ''
}

// [SP_CTX_02_61] The errors of a host drop.
export const HOST_UNKNOWN = (id: string) => `no host row ${id}; context_list names them`
export const HOST_MEDIA = (id: string) => `the row before ${id} holds media that would be lost; describe or summarize it first`
export const HOST_EXCLUSIVE = 'host excludes tool_use_id and ref'
export const HOST_TWICE = (id: string) => `host row ${id} is already in this batch`

// [SP_CTX_02_61] The report's line on records not named by a drop whose row
// before came back without its handle or not at all; "" for none.
export function goneText(gone: readonly HostRowRecord[]): string {
  return gone.length ? `Host rows that went with rebuilt rows: ${gone.map(r => `${r.id} (${r.kind})`).join(', ')}.` : ''
}
