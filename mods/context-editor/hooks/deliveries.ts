// Deliveries of the host in the middle of a turn ([SP_CTX_01_22]): a message
// the person typed while the agent worked, a subagent's report, a background
// task's notification. The host files each as a `queued_command` attachment
// hanging behind a tool_result row and shows it to the model as a system
// turn; it is no conversation row. A row the compaction handler returns with
// its handle brings its attachments along; a rebuilt one does not (spike
// context_editor_attachments; plugin-hooks 43-44). So the mod records the
// rendered text when it passes `session.append` (RecordDelivery,
// [SP_CTX_02_35]) and inserts it as a row right after its rebuilt anchor
// (InsertDeliveries, [SP_CTX_02_36]). Pure logic behind a small port;
// register.ts binds it to `$` on the deliveries' own serial chain.
import type { SessionMessage } from 'claude-code'
import { rowChars } from './edits'
import type { Read } from './queue'

// [SP_CTX_01_12]
export const MAX_DELIVERIES = 200
export const MAX_DELIVERY_TEXT = 40_000

// [SP_CTX_01_12] The first non-empty line after the opening
// `<system-reminder…>` tag of a rendered delivery, by class (host texts of
// 2.1.295-2.1.296, transcript decd4bc6).
export const DELIVERY_FRAMES = {
  person: 'The user sent a new message while you were working:',
  agent: 'Another Claude session sent a message while you were working:',
  task: '[SYSTEM NOTIFICATION - NOT USER INPUT]',
} as const

// The paragraph the host puts after the person's words in a delivery.
const PERSON_TAIL = 'This is how Claude Code surfaces'
const OPENING = /^<system-reminder(?:\s[^>]*)?>[^\S\n]*\n/

export type DeliveryKind = 'person' | 'agent' | 'task' | 'other'

// [SP_CTX_01_22]
export type QueuedDelivery = {
  uuid: string
  anchor: string[]
  kind: DeliveryKind
  origin: string
  text: string
  cut: number
  media: number
  at: number
}

export type Deliveries = { items: QueuedDelivery[] }

export const EMPTY_DELIVERIES: Deliveries = { items: [] }

// [SP_CTX_01_22] DeliveryKind: by the frame of the text, not by the origin,
// which differs between hosts (`unclassified` in stream-json, `composer` in
// the terminal, `peer` for subagents in VS Code).
export function deliveryKind(text: string): DeliveryKind {
  const t = text.trimStart()
  const open = OPENING.exec(t)
  if (!open) return 'other'
  const first = t
    .slice(open[0].length)
    .split('\n')
    .find(l => l.trim() !== '')
    ?.trim()
  if (first === DELIVERY_FRAMES.person) return 'person'
  if (first === DELIVERY_FRAMES.agent) return 'agent'
  if (first === DELIVERY_FRAMES.task) return 'task'
  return 'other'
}

// [SP_CTX_02_02] PersonText of an inserted delivery: the person's words of a
// person delivery, "" for a subagent's report or a task's notification,
// undefined for a text that is no delivery of those classes.
export function deliveryWords(text: string): string | undefined {
  const kind = deliveryKind(text)
  if (kind === 'agent' || kind === 'task') return ''
  if (kind !== 'person') return undefined
  const t = text.trimStart()
  const body = t.slice(t.indexOf(DELIVERY_FRAMES.person) + DELIVERY_FRAMES.person.length)
  const ends = [body.indexOf(`\n${PERSON_TAIL}`), body.indexOf('</system-reminder>')].filter(k => k >= 0)
  return (ends.length ? body.slice(0, Math.min(...ends)) : body).trim()
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

const KINDS: readonly string[] = ['person', 'agent', 'task', 'other']

function isItem(raw: unknown): raw is QueuedDelivery {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const e = raw as Record<string, unknown>
  return (
    typeof e.uuid === 'string' &&
    Array.isArray(e.anchor) &&
    e.anchor.length > 0 &&
    e.anchor.every(a => typeof a === 'string') &&
    typeof e.kind === 'string' &&
    KINDS.includes(e.kind) &&
    typeof e.origin === 'string' &&
    typeof e.text === 'string' &&
    e.text.trim() !== '' &&
    e.text.length <= MAX_DELIVERY_TEXT + 100 &&
    isCount(e.cut) &&
    isCount(e.media) &&
    isCount(e.at)
  )
}

// [SP_CTX_01_22] Read states as the queue's: a bad item makes the file
// unreadable, never silently an empty list.
export function parseDeliveries(text: string): Read<Deliveries> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { state: 'unreadable', reason: `not JSON: ${String(err)}` }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unreadable', reason: 'not an object' }
  const items = (raw as { items?: unknown }).items
  if (!Array.isArray(items) || items.length > MAX_DELIVERIES) return { state: 'unreadable', reason: 'bad field(s): items' }
  const bad = items.findIndex(e => !isItem(e))
  return bad >= 0 ? { state: 'unreadable', reason: `bad item ${bad + 1}` } : { state: 'ok', value: { items } }
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

// [SP_CTX_01_22] The oldest items go while there are more than
// MAX_DELIVERIES or the file would exceed `maxBytes` (MAX_QUEUE_BYTES).
export function trimDeliveries(d: Deliveries, maxBytes: number): Deliveries {
  let items = d.items
  if (items.length > MAX_DELIVERIES) items = items.slice(items.length - MAX_DELIVERIES)
  while (items.length && bytes({ items }) > maxBytes) items = items.slice(1)
  return items === d.items ? d : { items }
}

// ---- [SP_CTX_02_35] RecordDelivery

// The module's memory: the result ids of the last tool-result row of the main
// conversation that passed `session.append`.
export type AnchorMemory = { ids: string[] }

export function newAnchorMemory(): AnchorMemory {
  return { ids: [] }
}

// What RecordDelivery reads of a `session.append` event.
export type DeliveryEvent = {
  door: string
  uuid: string
  agentId?: string
  origin: { kind: string }
  message: { type?: string; name?: string; content?: readonly { type: string; [field: string]: unknown }[] }
}

// [SP_CTX_02_35] One event of the main conversation: a tool-result row sets
// the anchor, a prompt or a response row clears it, a `queued_command`
// delivery behind an anchor gives the item to record. Other doors leave the
// anchor: a chain of deliveries after one result shares it. A subagent's
// event changes nothing. Pure but for `mem`.
export function observeAppend(mem: AnchorMemory, e: DeliveryEvent, now: number): QueuedDelivery | undefined {
  if (e.agentId) return undefined
  const blocks = e.message.content ?? []
  if (e.door === 'tool-result') {
    mem.ids = blocks.filter(b => b.type === 'tool_result').map(b => String(b.tool_use_id))
    return undefined
  }
  if (e.door === 'prompt' || e.door === 'response') {
    mem.ids = []
    return undefined
  }
  if (e.door !== 'delivery' || e.message.type !== 'attachment' || e.message.name !== 'queued_command') return undefined
  const full = blocks.flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n')
  // not observed (35 of 35 behind a tool_result row): not recorded
  if (!mem.ids.length || !full.trim()) return undefined
  const cut = Math.max(0, full.length - MAX_DELIVERY_TEXT)
  const text = cut ? `${full.slice(0, MAX_DELIVERY_TEXT)}… [context-editor: ${cut} chars cut]` : full
  return {
    uuid: e.uuid,
    anchor: [...mem.ids],
    kind: deliveryKind(full),
    origin: typeof e.origin?.kind === 'string' ? e.origin.kind : '?',
    text,
    cut,
    media: blocks.filter(b => b.type !== 'text').length,
    at: now,
  }
}

// [SP_CTX_01_22] The list with `item`, or undefined: a copy the stream-json
// host passes again after a compaction (same text, an anchor id in common).
export function withDelivery(d: Deliveries, item: QueuedDelivery, maxBytes: number): Deliveries | undefined {
  if (d.items.some(x => x.text === item.text && x.anchor.some(id => item.anchor.includes(id)))) return undefined
  return trimDeliveries({ items: [...d.items, item] }, maxBytes)
}

// What RecordDelivery and the apply need from the host; register.ts binds it
// to `$` and runs each change on the deliveries' serial chain.
export type DeliveryIO = {
  read: () => Promise<Read<Deliveries>>
  write: (d: Deliveries) => Promise<void>
  // moves an unreadable file aside
  quarantine: () => Promise<void>
}

// [SP_CTX_02_35] Writes one item; an unreadable file is moved aside and the
// list starts anew. A failure loses this item only.
export async function recordDelivery(io: DeliveryIO, item: QueuedDelivery, maxBytes: number): Promise<void> {
  let read = await io.read()
  if (read.state === 'unreadable') {
    await io.quarantine()
    read = { state: 'missing', value: { items: [] } }
  }
  const next = withDelivery(read.value, item, maxBytes)
  if (next) await io.write(next)
}

// [SP_CTX_02_07] The items an apply no longer needs go; items recorded
// meanwhile stay. An unreadable file is left alone.
export async function pruneDeliveries(io: DeliveryIO, done: ReadonlySet<string>): Promise<void> {
  if (!done.size) return
  const read = await io.read()
  if (read.state !== 'ok') return
  const items = read.value.items.filter(x => !done.has(x.uuid))
  if (items.length !== read.value.items.length) await io.write({ items })
}

// ---- [SP_CTX_02_36] InsertDeliveries

export type Inserted = {
  rows: SessionMessage[]
  counts: { inserted: number; removed: number }
  // uuids of the items no longer needed
  done: Set<string>
  // the size of the inserted rows: no space freed or taken by the edits
  added: number
}

const holds = (row: SessionMessage, ids: ReadonlySet<string>) => (row.toolResults ?? []).some(t => ids.has(t.tool_use_id))

// [SP_CTX_02_36] "Already a row": a user row with the delivery's text stands
// right after the row that holds one of its anchor ids, past other result-less
// user rows only. The same text elsewhere (the person typed "ok" twice, or
// under another anchor) is another delivery.
function alreadyRow(before: readonly SessionMessage[], anchor: ReadonlySet<string>, text: string): boolean {
  return before.some((r, i) => {
    if (!holds(r, anchor)) return false
    for (let j = i + 1; j < before.length; j++) {
      const n = before[j]!
      if (n.role !== 'user' || (n.toolResults ?? []).length) return false
      if (n.text === text) return true
    }
    return false
  })
}

// [SP_CTX_02_36] Each delivery goes back as a user row right after its anchor
// row when that row goes without a handle (the host does not carry its
// attachments then): the host merges both into one user message, tool_result
// first, with no pairing repair. An anchor kept with its handle carries the
// attachment itself, unless `goes` says the row leaves later (DropOwnCalls
// removes a row of own results kept by its handle outside the API window); an
// anchor a drop or a collapse took takes the delivery along; a summarize keeps
// it, after the result row under its fresh id. `before`: the rows the edits
// applied to; `rows`: ApplyEdits' output; `renamed`: an applied summarize's
// tool_use_id → FreshId; `allRebuilt`: a seed, where no row keeps a handle. Pure.
export function insertDeliveries(
  before: readonly SessionMessage[],
  rows: readonly SessionMessage[],
  items: readonly QueuedDelivery[],
  renamed: ReadonlyMap<string, string>,
  allRebuilt: boolean,
  goes: (row: SessionMessage) => boolean = () => false,
): Inserted {
  const after = new Map<number, SessionMessage[]>()
  const out: Inserted = { rows: [], counts: { inserted: 0, removed: 0 }, done: new Set(), added: 0 }
  for (const item of items) {
    const anchor = new Set(item.anchor)
    if (!before.some(r => holds(r, anchor)) || alreadyRow(before, anchor, item.text)) {
      out.done.add(item.uuid)
      continue
    }
    const ids = new Set([...item.anchor, ...item.anchor.flatMap(id => (renamed.has(id) ? [renamed.get(id)!] : []))])
    const k = rows.findIndex(r => holds(r, ids))
    if (k < 0) {
      out.counts.removed += 1
      out.done.add(item.uuid)
      continue
    }
    if (rows[k]!.handle !== undefined && !allRebuilt && !goes(rows[k]!)) continue
    const row: SessionMessage = { role: 'user', text: item.text, toolUses: [] }
    after.set(k, [...(after.get(k) ?? []), row])
    out.counts.inserted += 1
    out.added += rowChars(row)
    out.done.add(item.uuid)
  }
  rows.forEach((r, i) => out.rows.push(r, ...(after.get(i) ?? [])))
  return out
}

// [SP_CTX_02_02] PersonDelivered: a person's delivery, not yet a row, hangs
// behind a result of rows[i].
// `gone`: the ids an edit removes from that row (a drop: its pair); a
// delivery whose anchor keeps another result in the row stays. Absent: the
// whole row goes (a collapse).
export function personDelivered(rows: readonly SessionMessage[], i: number, items: readonly QueuedDelivery[], gone?: ReadonlySet<string>): boolean {
  const r = rows[i]
  if (!r || !(r.toolResults ?? []).length) return false
  const ids = new Set((r.toolResults ?? []).map(t => t.tool_use_id))
  return items.some(x => x.kind === 'person' && x.anchor.some(id => ids.has(id)) && (!gone || x.anchor.every(id => gone.has(id))))
}
