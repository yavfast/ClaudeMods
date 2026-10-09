import type { SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'

// [SP_CTX_01_02] One edit as the model asks for it through context_edit.
export type Edit =
  | { op: 'summarize'; tool_use_id: string; summary: string }
  | { op: 'drop'; tool_use_id: string }
  | { op: 'collapse'; from_index: number; to_index: number; summary: string }
  | { op: 'rewrite'; index: number; text: string }
  | { op: 'describe'; index: number; description: string }

// [SP_CTX_01_03] Index-based edits carry fingerprints of the rows they named.
export type QueuedEdit = Edit & { anchors?: string[] }

// [SP_CTX_01_08] Whose media it is: a tool result or a person's prompt row.
export type MediaOwner = { tool_use_id: string } | { row: number }

// [SP_CTX_01_05]
export type ApplyReport = {
  applied: string[]
  failed: string[]
  charsBefore: number
  charsAfter: number
  originals: { edit: string; rows: SessionMessage[] }[]
  mediaFiles: string[]
}

// [SP_CTX_01_12]
export const MARK = '[context-editor]'
export const OWN_TOOLS = 'mcp__context-editor__'
export const BIG_ROW = 4000
export const LIST_COUNT = 60
export const MAX_LIST_COUNT = 200
export const MAX_TEXT = 8000
export const MAX_QUEUE_EDITS = 200
export const HEAD_ROWS = 8
// The most rows a read of the conversation gives, and the most messages of its API form.
export const ROW_WINDOW = 4096
// [SP_CTX_01_14] The longest the identity's read may take before it counts as
// not read (absent); bounds every reader that awaits it.
export const HOST_ID_WAIT_MS = 2000
// The longest tool description the host passes to the model; it cuts the rest.
export const MAX_DESCRIPTION = 2048

export function ownerKey(owner: MediaOwner): string {
  return 'tool_use_id' in owner ? `u:${owner.tool_use_id}` : `r:${owner.row}`
}

export function rowChars(row: SessionMessage): number {
  let n = row.text.length
  for (const u of row.toolUses) n += JSON.stringify(u.input ?? {}).length
  for (const r of row.toolResults ?? []) n += r.text.length
  return n
}

export function totalChars(rows: readonly SessionMessage[]): number {
  return rows.reduce((n, r) => n + rowChars(r), 0)
}

export function fingerprint(row: SessionMessage): string {
  const ids = [
    ...row.toolUses.map(u => 'u:' + u.tool_use_id),
    ...(row.toolResults ?? []).map(r => 'r:' + r.tool_use_id),
  ].join(',')
  return `${row.role}|${ids}|${row.text.slice(0, 160)}`
}

// [SP_CTX_01_14] Where the current conversation starts: the head of the rows
// the last compaction returned, and the host process that wrote it.
export type Boundary = { head: string[]; count: number; host?: string }

// [SP_CTX_02_18] The boundary a compaction's returned rows set; none for no
// rows. `host` is hostId when it is known; a compaction handler passes it
// only once the identity has been read, never waiting for it.
export function boundaryOf(rows: readonly SessionMessage[], host?: string): Boundary | undefined {
  if (!rows.length) return undefined
  const b: Boundary = { head: rows.slice(0, HEAD_ROWS).map(fingerprint), count: rows.length }
  return host === undefined ? b : { ...b, host }
}

// [SP_CTX_01_14] Undefined for anything but a well-formed Boundary. A `host`
// that is not a string is ignored: the boundary reads as written without one.
export function parseBoundary(text: string): Boundary | undefined {
  try {
    const b = JSON.parse(text) as Partial<Boundary> | null
    const head = b?.head
    if (!Array.isArray(head) || head.length < 1 || head.length > HEAD_ROWS || !head.every(h => typeof h === 'string')) return undefined
    if (typeof b!.count !== 'number' || !Number.isInteger(b!.count) || b!.count < head.length) return undefined
    return typeof b!.host === 'string' ? { head, count: b!.count, host: b!.host } : { head, count: b!.count }
  } catch {
    return undefined
  }
}

// [SP_CTX_01_14] ParseHostId: "<token>:<ppid>" when the command printed only
// decimal digits (whitespace aside) and the token is not empty. Pure.
export function parseHostId(token: string | undefined, stdout: string): string | undefined {
  const pid = stdout.trim()
  return token && /^[0-9]+$/.test(pid) ? `${token}:${pid}` : undefined
}

// [SP_CTX_01_14] The value of HOST_ENV a module sets when the host process has
// none: at least 16 characters of [0-9a-z].
export function newHostToken(): string {
  let token = ''
  while (token.length < 20) token += Math.floor(Math.random() * 36).toString(36)
  return token
}

// [SP_CTX_01_14] The identity of the host process: one read per module
// instance, started by session.start or the first PrepareStorage, whichever
// comes first. Readers outside a compaction await it; compaction handlers
// only peek.
export type HostIdMemo = { promise?: Promise<string | undefined>; settled: boolean; value?: string }

export function newHostIdMemo(): HostIdMemo {
  return { settled: false }
}

// [SP_CTX_01_14] Starts the read once and returns its one promise; a failed
// read (the env call or the command) is no identity.
export function startHostId(memo: HostIdMemo, read: () => Promise<string | undefined>): Promise<string | undefined> {
  if (!memo.promise) {
    memo.promise = read().then(
      value => {
        memo.settled = true
        memo.value = value
        return value
      },
      () => {
        memo.settled = true
        return undefined
      },
    )
  }
  return memo.promise
}

// [SP_CTX_01_14] For compaction handlers: the identity once its read has
// ended, else absent. Never waits and never starts a read.
export function peekHostId(memo: HostIdMemo): string | undefined {
  return memo.settled ? memo.value : undefined
}

// [SP_CTX_02_18] ownBoundary: the text of the boundary this module instance
// wrote in the current session; reset on load and when storage is prepared.
export type BoundaryMemory = { own?: string }

// [SP_CTX_02_18] RecordBoundary's write: once written, the text is this
// instance's own boundary. A failed write rejects and leaves `own` as it was.
export async function recordBoundary(mem: BoundaryMemory, write: (text: string) => Promise<void>, b: Boundary): Promise<string> {
  const text = JSON.stringify(b)
  await write(text)
  mem.own = text
  return text
}

// [SP_CTX_02_18] [SP_CTX_DEC_10] Trusted(b): written by this host process, or
// by this module instance in this session (the way left when hostId is absent).
export function isTrustedBoundary(b: Boundary, raw: string, hostId: string | undefined, own: string | undefined): boolean {
  return (b.host !== undefined && hostId !== undefined && b.host === hostId) || raw === own
}

// [SP_CTX_02_18] CurrentRows and the boundary part of Key() from one read of
// the boundary file: the whole transcript and "" without a trusted boundary.
export function boundaryView(
  transcript: readonly SessionMessage[],
  raw: string | undefined,
  hostId: string | undefined,
  own: string | undefined,
): { rows: readonly SessionMessage[]; mark: string } {
  const b = raw === undefined ? undefined : parseBoundary(raw)
  if (!b || !isTrustedBoundary(b, raw!, hostId, own)) return { rows: transcript, mark: '' }
  return { rows: currentRows(transcript, b), mark: raw! }
}

// What CurrentRows needs from the host; register.ts binds it to `$`.
export type ViewIO = {
  // awaits the one hostId promise, starting it if it is not started
  hostId: () => Promise<string | undefined>
  messages: () => Promise<readonly SessionMessage[]>
  // [SP_CTX_02_15] the storage of the current session, prepared for it
  storage: () => Promise<{ sessionId?: string; dir?: string }>
  readBoundary: (dir: string) => Promise<string | undefined>
  // ownBoundary, read once the storage is prepared
  own: () => string | undefined
}

// [SP_CTX_02_18] CurrentRows and Key(): the identity awaited first (a tool or
// prompt path, without the ~1 s budget), then the transcript and one read of
// the boundary for both.
export async function readView(io: ViewIO): Promise<{ transcript: readonly SessionMessage[]; rows: readonly SessionMessage[]; key: string }> {
  const hostId = await io.hostId()
  const transcript = await io.messages()
  const st = await io.storage()
  if (!st.dir) return { transcript, rows: transcript, key: `${st.sessionId}|` }
  const raw = await io.readBoundary(st.dir)
  const { rows, mark } = boundaryView(transcript, raw, hostId, io.own())
  return { transcript, rows, key: `${st.sessionId}|${mark}` }
}

// [SP_CTX_02_15] A switch of session in this process (/clear, /resume), not
// the first prepare after the module loaded.
export function sessionSwitched(prev: string | undefined, now: string | undefined): boolean {
  return prev !== undefined && prev !== now
}

// [SP_CTX_02_18] The boundary text without `host` when this process wrote it;
// undefined when there is nothing to rewrite.
export function withoutHost(raw: string | undefined, hostId: string | undefined): string | undefined {
  const b = raw === undefined ? undefined : parseBoundary(raw)
  if (!b || b.host === undefined || hostId === undefined || b.host !== hostId) return undefined
  return JSON.stringify({ head: b.head, count: b.count })
}

// What the boundary step of PrepareStorage needs; register.ts binds it to `$`.
export type AfterPrepareIO = {
  // the session id this instance had before this prepare (none after load) and now
  prev?: string
  now?: string
  // called from a compaction handler: never wait for hostId
  inCompaction: boolean
  // awaits the one hostId promise
  wait: () => Promise<string | undefined>
  // hostId if its read has ended, else absent
  peek: () => string | undefined
  // the new session's boundary file; undefined when there is none
  read: () => Promise<string | undefined>
  write: (text: string) => Promise<void>
  remove: () => Promise<void>
  toast: (text: string) => void
}

// [SP_CTX_02_15] [SP_CTX_02_18] The boundary step of PrepareStorage. After a
// session switch in this process (not the first prepare after load) the read
// is the loaded chain (/resume), so the new session's boundary that this
// process wrote loses its `host`. Outside a compaction hostId is awaited;
// inside one it is the value if read, else absent. A failed rewrite removes
// the file (without a boundary the whole transcript, which after /resume is
// right); if that fails too, a toast. Never throws; true when untrusted.
export async function afterPrepare(io: AfterPrepareIO): Promise<boolean> {
  if (!sessionSwitched(io.prev, io.now)) return false
  try {
    const id = io.inCompaction ? io.peek() : await io.wait()
    const next = withoutHost(await io.read(), id)
    if (next === undefined) return false
    try {
      await io.write(next)
    } catch {
      await io.remove()
    }
    return true
  } catch (err) {
    io.toast(`context-editor: the boundary of the resumed session could not be untrusted: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

// [SP_CTX_02_18] The transcript from the last place the boundary's head
// starts with at least `count` rows from there; the whole transcript when the
// head is not found (no boundary, out of the window, fingerprints differ).
export function currentRows(transcript: readonly SessionMessage[], b: Boundary | undefined): readonly SessionMessage[] {
  if (!b) return transcript
  const p = boundaryAt(transcript, b.head, b.count)
  return p === undefined ? transcript : transcript.slice(p)
}

// [SP_CTX_02_18] BoundaryAt: the largest p where `head` starts with at least
// `count` rows from p on; shared by CurrentRows and CheckSeeded ([SP_CTX_02_24]).
export function boundaryAt(transcript: readonly SessionMessage[], head: readonly string[], count: number): number | undefined {
  const prints = transcript.map(fingerprint)
  for (let p = transcript.length - count; p >= 0; p--) {
    if (head.every((h, k) => prints[p + k] === h)) return p
  }
  return undefined
}

export function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

function isEdited(row: SessionMessage): boolean {
  return [row.text, ...(row.toolResults ?? []).map(r => r.text)].some(t => t.startsWith(MARK))
}

// Media sizes per owner key, for the listing.
export type MediaSizes = ReadonlyMap<string, readonly { mediaType: string; bytes: number }[]>

function rowMedia(row: SessionMessage, index: number, media: MediaSizes) {
  return [
    ...(row.toolResults ?? []).flatMap(r => media.get(ownerKey({ tool_use_id: r.tool_use_id })) ?? []),
    ...(media.get(ownerKey({ row: index })) ?? []),
  ]
}

// [SP_CTX_02_01] One line per row, oldest first, a page of `count` rows.
// `tags`: the tag labels of each row index ([SP_CTX_01_09]); `aliases`: the
// alias of each tool_use_id ([SP_CTX_01_13]).
export function listRows(
  rows: readonly SessionMessage[],
  from: number,
  count: number,
  media: MediaSizes = new Map(),
  tags: ReadonlyMap<number, readonly string[]> = new Map(),
  aliases: ReadonlyMap<string, string> = new Map(),
): string {
  if (rows.length === 0) return '0 rows.'
  const start = Math.min(Math.max(0, Math.trunc(from)), rows.length - 1)
  const size = Math.min(Math.max(1, Math.trunc(count)), MAX_LIST_COUNT)
  const stop = Math.min(rows.length, start + size)
  let before = 0
  for (let i = 0; i < start; i++) before += rowChars(rows[i]!)
  let mediaCount = 0
  let mediaBytes = 0
  for (const list of media.values())
    for (const m of list) {
      mediaCount++
      mediaBytes += m.bytes
    }
  const lines: string[] = []
  for (let i = start; i < stop; i++) {
    const row = rows[i]!
    const parts: string[] = []
    if (row.text) parts.push(`text "${oneLine(row.text, 90)}"`)
    for (const u of row.toolUses)
      parts.push(`tool_use ${u.tool} id=${u.tool_use_id}${aliases.has(u.tool_use_id) ? ` (${aliases.get(u.tool_use_id)})` : ''} input="${oneLine(JSON.stringify(u.input ?? {}), 70)}"`)
    for (const r of row.toolResults ?? [])
      parts.push(`tool_result id=${r.tool_use_id}${r.isError ? ' ERROR' : ''} "${oneLine(r.text, 70)}"`)
    const own = rowMedia(row, i, media)
    for (const m of own) parts.push(`media ${m.mediaType} ~${Math.ceil(m.bytes / 1024)}KB`)
    const chars = rowChars(row)
    const flags = (isEdited(row) ? '*' : '') + (chars >= BIG_ROW ? '!' : '') + (own.length ? '@' : '')
    const labels = tags.get(i) ?? []
    lines.push(`#${i}${flags} ${row.role} ${chars}c: ${parts.join(' | ') || '(empty)'}${labels.length ? ' ' + labels.join(' ') : ''}`)
  }
  const total = totalChars(rows)
  const shown = rows.slice(start, stop).reduce((n, r) => n + rowChars(r), 0)
  return [
    `${rows.length} rows, ~${total} chars (~${Math.round(total / 4)} tokens), ${mediaCount} media (~${Math.ceil(mediaBytes / 1024)}KB). Showing #${start}..#${stop - 1} (oldest first), ~${shown} chars; ~${before} chars come before it.`,
    `Flags: * already edited, ! large (>= ${BIG_ROW} chars), @ has media. Tags: [pin] no edit may touch it, [disposable: note] replaced by its note at the next reminder threshold, [review] worth a look.${stop < rows.length ? ` Next page: from=${stop}.` : ''}`,
    ...lines,
  ].join('\n')
}

// [SP_CTX_02_05] Removes this plugin's own calls and their results. An own
// pair whose result row also holds media of another pair, or a result outside
// the API window, stays: rebuilding that row would drop media nobody archived.
export function dropOwnCalls(
  input: readonly SessionMessage[],
  mediaOwners: ReadonlySet<string> = new Set(),
  knownResults?: ReadonlySet<string>,
): SessionMessage[] {
  const own = new Set(input.flatMap(r => r.toolUses.filter(u => u.tool.startsWith(OWN_TOOLS)).map(u => u.tool_use_id)))
  const kept = new Set<string>()
  for (const r of input) {
    const results = r.toolResults ?? []
    if (!results.some(t => own.has(t.tool_use_id))) continue
    const risky = results.some(
      t => !own.has(t.tool_use_id) && (mediaOwners.has(ownerKey({ tool_use_id: t.tool_use_id })) || (knownResults !== undefined && !knownResults.has(t.tool_use_id))),
    )
    if (risky) for (const t of results) if (own.has(t.tool_use_id)) kept.add(t.tool_use_id)
  }
  const ids = new Set([...own].filter(id => !kept.has(id)))
  if (ids.size === 0) return [...input]
  const dropped = input.map(r => {
    const hasUse = r.toolUses.some(u => ids.has(u.tool_use_id))
    const hasResult = (r.toolResults ?? []).some(t => ids.has(t.tool_use_id))
    if (!hasUse && !hasResult) return r
    return plain(r, {
      toolUses: r.toolUses.filter(u => !ids.has(u.tool_use_id)).map(stripUse),
      toolResults: r.toolResults?.filter(t => !ids.has(t.tool_use_id)).map(stripResult),
    })
  })
  // [SP_CTX_02_04] a rebuilt assistant row splits its response (pitfall 30)
  return rebuildSplitResponses(dropped).filter(r => r.handle !== undefined || !isEmpty(r))
}

function findToolUse(rows: readonly SessionMessage[], id: string): number {
  return rows.findIndex(r => r.toolUses.some(u => u.tool_use_id === id))
}

function findToolResult(rows: readonly SessionMessage[], id: string): number {
  return rows.findIndex(r => (r.toolResults ?? []).some(t => t.tool_use_id === id))
}

// Every tool_use in rows[from..to] must have its result there too, and back.
function pairingError(rows: readonly SessionMessage[], from: number, to: number): string | undefined {
  const uses = new Set<string>()
  const results = new Set<string>()
  for (let i = from; i <= to; i++) {
    for (const u of rows[i]!.toolUses) uses.add(u.tool_use_id)
    for (const r of rows[i]!.toolResults ?? []) results.add(r.tool_use_id)
  }
  const orphans = [...[...uses].filter(id => !results.has(id)), ...[...results].filter(id => !uses.has(id))]
  return orphans.length
    ? `range #${from}..#${to} splits a tool call from its result (${orphans.join(', ')}); widen or narrow it`
    : undefined
}

export function describeEdit(edit: Edit): string {
  switch (edit.op) {
    case 'summarize':
    case 'drop':
      return `${edit.op} ${edit.tool_use_id}`
    case 'collapse':
      return `collapse #${edit.from_index}..#${edit.to_index}`
    case 'rewrite':
    case 'describe':
      return `${edit.op} #${edit.index}`
  }
}

function textError(value: unknown, field: string): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return `${field} is required`
  if (value.length > MAX_TEXT) return `${field} is too long (max ${MAX_TEXT} chars)`
  return undefined
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

// [SP_CTX_02_17] Resolves a call alias (or "last") to its tool_use_id.
export type RefResolver = (ref: string) => string | undefined
export const NO_REFS: RefResolver = () => undefined

// [SP_CTX_02_18] Why an index from an earlier listing is refused.
export const STALE_INDEXES = 'the conversation was compacted since your last context_list; call context_list again for current indexes'

export const REF_HINT = 'marked calls carry a "[context-editor] id cN" line after their result'

// [SP_CTX_02_03] A `ref` left on a summarize/drop edit: either beside a
// tool_use_id, or one that did not resolve ([SP_CTX_02_17]).
function refError(e: Record<string, unknown>): string | undefined {
  if (e.ref === undefined) return undefined
  if (e.tool_use_id !== undefined) return 'ref and tool_use_id are exclusive'
  return `unknown ref ${typeof e.ref === 'string' ? e.ref : JSON.stringify(e.ref)} (${REF_HINT})`
}

// [SP_CTX_01_02] [SP_CTX_02_17] Raw edits with each resolvable `ref` of a
// summarize/drop replaced by its tool_use_id, so the queue keeps ids only;
// any other `ref` stays for checkShape to reject. Pure.
export function resolveEditRefs(raws: readonly unknown[], resolve: RefResolver): unknown[] {
  return raws.map(raw => {
    if (typeof raw !== 'object' || raw === null) return raw
    const { ref, ...rest } = raw as Record<string, unknown>
    if ((rest.op !== 'summarize' && rest.op !== 'drop') || typeof ref !== 'string' || rest.tool_use_id !== undefined) return raw
    const id = resolve(ref)
    return id === undefined ? raw : { ...rest, tool_use_id: id }
  })
}

// [SP_CTX_02_03] Shape check of one raw edit; returns the edit or the reason.
export function checkShape(raw: unknown): Edit | string {
  if (typeof raw !== 'object' || raw === null) return 'edit must be an object'
  const e = raw as Record<string, unknown>
  const badRef = e.op === 'summarize' || e.op === 'drop' ? refError(e) : undefined
  if (badRef) return badRef
  switch (e.op) {
    case 'summarize':
      if (typeof e.tool_use_id !== 'string' || !e.tool_use_id) return 'tool_use_id is required'
      return textError(e.summary, 'summary') ?? { op: 'summarize', tool_use_id: e.tool_use_id, summary: e.summary as string }
    case 'drop':
      if (typeof e.tool_use_id !== 'string' || !e.tool_use_id) return 'tool_use_id is required'
      return { op: 'drop', tool_use_id: e.tool_use_id }
    case 'collapse':
      if (!isIndex(e.from_index)) return 'from_index is required'
      if (!isIndex(e.to_index)) return 'to_index is required'
      return textError(e.summary, 'summary') ?? { op: 'collapse', from_index: e.from_index, to_index: e.to_index, summary: e.summary as string }
    case 'rewrite':
      if (!isIndex(e.index)) return 'index is required'
      return textError(e.text, 'text') ?? { op: 'rewrite', index: e.index, text: e.text as string }
    case 'describe':
      if (!isIndex(e.index)) return 'index is required'
      return textError(e.description, 'description') ?? { op: 'describe', index: e.index, description: e.description as string }
    default:
      return `unknown op ${JSON.stringify(e.op)}`
  }
}

// [SP_CTX_02_03] Targets carrying a `pin` tag, resolved on one row list:
// pairs by tool_use_id and rows by index. Data, so prepare stays pure.
export type Pinned = { ids: ReadonlySet<string>; rows: ReadonlySet<number> }
export const NO_PINS: Pinned = { ids: new Set(), rows: new Set() }

// The rows and pairs an edit changes, resolved on `rows` (anchors through
// Locate); undefined when its target is not there.
export function touchedBy(rows: readonly SessionMessage[], edit: QueuedEdit): { rows: number[]; ids: string[] } | undefined {
  switch (edit.op) {
    case 'summarize':
    case 'drop': {
      const useAt = findToolUse(rows, edit.tool_use_id)
      const resAt = findToolResult(rows, edit.tool_use_id)
      return useAt < 0 || resAt < 0 ? undefined : { rows: [useAt, resAt], ids: [edit.tool_use_id] }
    }
    case 'collapse': {
      const [a, b] = edit.anchors ?? []
      const from = a ? locate(rows, a, edit.from_index) : edit.from_index
      const to = b ? locate(rows, b, edit.to_index) : edit.to_index
      if (from < 0 || to < from || to >= rows.length) return undefined
      const span = Array.from({ length: to - from + 1 }, (_, k) => from + k)
      const ids = span.flatMap(i => [...rows[i]!.toolUses.map(u => u.tool_use_id), ...(rows[i]!.toolResults ?? []).map(r => r.tool_use_id)])
      return { rows: span, ids: [...new Set(ids)] }
    }
    case 'rewrite':
    case 'describe': {
      const at = edit.anchors?.[0] ? locate(rows, edit.anchors[0], edit.index) : edit.index
      return at < 0 || !rows[at] ? undefined : { rows: [at], ids: [] }
    }
  }
}

// [SP_CTX_02_03] Whether an edit would change a pinned pair or row: a pair
// edit also changes both rows of its pair, a collapse every row and pair of
// its span.
export function touchesPin(rows: readonly SessionMessage[], edit: QueuedEdit, pinned: Pinned): boolean {
  const t = touchedBy(rows, edit)
  return !!t && (t.rows.some(i => pinned.rows.has(i)) || t.ids.some(id => pinned.ids.has(id)))
}

export const PINNED = 'target is pinned; remove the pin with context_tag first'

// [SP_CTX_02_03] Checks raw edits against the conversation as it is now and
// stamps the index-based ones with anchors. `hasMedia` answers whether a
// person's prompt row has media ([SP_CTX_02_10]); `pinned` names the targets
// no edit may touch.
export function prepare(
  rows: readonly SessionMessage[],
  raws: readonly unknown[],
  hasMedia: (owner: MediaOwner) => boolean = () => false,
  pinned: Pinned = NO_PINS,
  // [SP_CTX_02_18] the indexes the agent holds may name other rows now
  staleIndexes = false,
): { queued: QueuedEdit[]; errors: string[] } {
  const queued: QueuedEdit[] = []
  const errors: string[] = []
  raws.forEach((raw, n) => {
    const edit = checkShape(raw)
    if (typeof edit === 'string') {
      errors.push(`edit ${n + 1}: ${edit}`)
      return
    }
    const name = describeEdit(edit)
    if (staleIndexes && (edit.op === 'collapse' || edit.op === 'rewrite' || edit.op === 'describe')) return void errors.push(`${name}: ${STALE_INDEXES}`)
    const checked = checkTarget(rows, edit, hasMedia)
    if (typeof checked === 'string') return void errors.push(`${name}: ${checked}`)
    if (touchesPin(rows, checked, pinned)) return void errors.push(`${name}: ${PINNED}`)
    queued.push(checked)
  })
  return { queued, errors }
}

// [SP_CTX_02_03] The target rules of one well-formed edit; the queued edit or
// the reason.
function checkTarget(rows: readonly SessionMessage[], edit: Edit, hasMedia: (owner: MediaOwner) => boolean): QueuedEdit | string {
  switch (edit.op) {
    case 'summarize':
    case 'drop':
      if (findToolUse(rows, edit.tool_use_id) < 0 || findToolResult(rows, edit.tool_use_id) < 0)
        return 'no completed tool call with that id'
      return edit
    case 'collapse': {
      const { from_index: from, to_index: to } = edit
      if (!(from >= 0 && to >= from && to < rows.length)) return `indexes out of range (0..${rows.length - 1})`
      return pairingError(rows, from, to) ?? { ...edit, anchors: [fingerprint(rows[from]!), fingerprint(rows[to]!)] }
    }
    case 'rewrite': {
      const row = rows[edit.index]
      if (!row) return 'index out of range'
      if (row.role !== 'assistant' || row.toolUses.length > 0) return 'only an assistant text row can be rewritten; use collapse'
      return { ...edit, anchors: [fingerprint(row)] }
    }
    case 'describe': {
      const row = rows[edit.index]
      if (!row) return 'index out of range'
      if (row.role !== 'user' || (row.toolResults ?? []).length > 0)
        return 'describe applies to a user prompt row; use summarize for tool results'
      if (!hasMedia({ row: edit.index })) return 'no media found in that row'
      return { ...edit, anchors: [fingerprint(row)] }
    }
  }
}

// [SP_CTX_02_04] Locate: the row an anchor names, at its old index if it is
// still there, else the one row anywhere that matches; -1 when none or many.
export function locate(rows: readonly SessionMessage[], anchor: string, hint: number): number {
  if (rows[hint] && fingerprint(rows[hint]!) === anchor) return hint
  const hits = rows.flatMap((r, i) => (fingerprint(r) === anchor ? [i] : []))
  return hits.length === 1 ? hits[0]! : -1
}

// [SP_CTX_02_04] "Rebuild a row": the same fields, without `handle`.
export function rebuild(row: SessionMessage): SessionMessage {
  return plain(row, {})
}

// A row without `handle` is rebuilt by the host from these fields alone.
function plain(row: SessionMessage, patch: Partial<SessionMessage>): SessionMessage {
  return {
    role: row.role,
    text: row.text,
    toolUses: row.toolUses.map(stripUse),
    toolResults: row.toolResults?.map(stripResult),
    ...patch,
  }
}

function stripUse(u: ToolUseSummary): ToolUseSummary {
  return { tool_use_id: u.tool_use_id, tool: u.tool, input: u.input, text: u.text }
}

// An edited call: new id, and no copy of the result it no longer has.
function editedUse(u: ToolUseSummary, id: string): ToolUseSummary {
  return { tool_use_id: id, tool: u.tool, input: u.input }
}

function stripResult(r: ToolResultSummary): ToolResultSummary {
  return { tool_use_id: r.tool_use_id, text: r.text, isError: r.isError }
}

// [SP_CTX_02_04] An edited call gets a new id. The suffix of an earlier edit
// is replaced, never stacked.
export function freshId(id: string): string {
  const base = id.replace(/_ce[0-9a-z]+$/, '')
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')
  return `${base}_ce${Date.now().toString(36)}${rand}`.replace(/[^A-Za-z0-9_-]/g, '')
}

function isEmpty(row: SessionMessage): boolean {
  return !row.text && row.toolUses.length === 0 && !(row.toolResults ?? []).length
}

// The media owners an edit replaces, by key: the pair for summarize/drop,
// every pair and row of a collapse span, the row for describe.
function ownersOf(rows: readonly SessionMessage[], edit: QueuedEdit, touched: readonly number[]): string[] {
  switch (edit.op) {
    case 'summarize':
    case 'drop':
      return [ownerKey({ tool_use_id: edit.tool_use_id })]
    case 'collapse':
      return touched.flatMap(i => [
        ...(rows[i]!.toolResults ?? []).map(r => ownerKey({ tool_use_id: r.tool_use_id })),
        ownerKey({ row: i }),
      ])
    case 'describe':
      return [ownerKey({ row: touched[0]! })]
    case 'rewrite':
      return []
  }
}

// Keys of the media owners the queued edits would replace, resolved on
// `rows`; the handler archives only their media ([SP_CTX_02_07]).
export function replacedOwners(rows: readonly SessionMessage[], edits: readonly QueuedEdit[]): Set<string> {
  const keys = new Set<string>()
  for (const edit of edits) {
    const touched = touchedBy(rows, edit)
    if (touched) for (const key of ownersOf(rows, edit, touched.rows)) keys.add(key)
  }
  return keys
}

// [SP_CTX_01_08]
export type MediaRef = { mediaType: string; bytes: number; data?: string }

// [SP_CTX_02_10] What the Messages API form of the conversation holds beyond
// the rows: media by owner key, the tool_use ids it shows (its window), and
// how many prompt messages carry media that cannot be matched to a row while
// [SP_CTX_DEC_06] is open, and whether the read gave as many messages as it
// can (`apiTruncated`: older ones may lie outside it; minus one since the form
// starts with a user message and the host may drop a leading assistant one;
// plugin-hooks pitfall 10). Pure.
export function collectMedia(api: readonly unknown[]): {
  found: Map<string, MediaRef[]>
  knownResults: Set<string>
  unmatchedPromptMedia: number
  apiTruncated: boolean
} {
  const found = new Map<string, MediaRef[]>()
  const knownResults = new Set<string>()
  let unmatchedPromptMedia = 0
  const isMedia = (b: Record<string, unknown>) => b.type === 'image' || b.type === 'document'
  for (const msg of api) {
    const m = msg as { role?: unknown; content?: unknown }
    if (!Array.isArray(m.content)) continue
    const blocks = m.content as Record<string, unknown>[]
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const id = String(block.tool_use_id)
      knownResults.add(id)
      if (!Array.isArray(block.content)) continue
      for (const inner of block.content as Record<string, unknown>[]) {
        if (!isMedia(inner)) continue
        const key = ownerKey({ tool_use_id: id })
        found.set(key, [...(found.get(key) ?? []), mediaRef(inner)])
      }
    }
    if (m.role === 'user' && blocks.some(isMedia)) unmatchedPromptMedia += 1
  }
  return { found, knownResults, unmatchedPromptMedia, apiTruncated: api.length >= ROW_WINDOW - 1 }
}

function mediaRef(block: Record<string, unknown>): MediaRef {
  const source = (block.source ?? {}) as Record<string, unknown>
  const data = source.type === 'base64' && typeof source.data === 'string' ? source.data : undefined
  const pad = data ? (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) : 0
  return {
    mediaType: typeof source.media_type === 'string' ? source.media_type : String(block.type),
    bytes: data ? Math.floor((data.length * 3) / 4) - pad : 0,
    data,
  }
}

export type ApplyOptions = {
  // tool_use ids the API form shows; rows outside it keep their handle
  knownResults?: ReadonlySet<string>
  // prompt messages with media that no row could be matched to
  unmatchedPromptMedia?: number
  // [SP_CTX_02_10] the API form is cut by the read window: rows before the
  // first known result may lie outside it
  apiTruncated?: boolean
}

// [SP_CTX_02_04] Builds the new row list from the compaction's rows. Pure.
// `media`: archived file paths by owner key; `mediaOwners`: keys of every
// owner with media in the conversation.
export function applyEdits(
  input: readonly SessionMessage[],
  edits: readonly QueuedEdit[],
  archive: string,
  media: ReadonlyMap<string, readonly string[]> = new Map(),
  mediaOwners: ReadonlySet<string> = new Set(),
  options: ApplyOptions = {},
): { rows: SessionMessage[]; report: ApplyReport } {
  const rows = [...input]
  const report: ApplyReport = {
    applied: [],
    failed: [],
    charsBefore: totalChars(input),
    charsAfter: 0,
    originals: [],
    mediaFiles: [],
  }
  const note = archive ? ` (original: ${archive})` : ''
  const mediaNote = (keys: readonly string[]) => {
    const paths = keys.flatMap(k => media.get(k) ?? [])
    return paths.length ? ` (media: ${paths.join(', ')})` : ''
  }
  const archived = (key: string) => (media.get(key) ?? []).length > 0
  // Pairs this batch replaces with their media archived: a shared row may lose
  // their media when it is rebuilt.
  const batchPairs = new Set(
    edits.flatMap(e => (e.op === 'summarize' || e.op === 'drop' ? [ownerKey({ tool_use_id: e.tool_use_id })] : [])),
  )

  // A pair edit conflicts only on its own pair and on rows a row edit takes;
  // a row edit (collapse, rewrite, describe) takes its rows exclusively.
  type Step = { edit: QueuedEdit; touched: number[]; pair?: string; hi: number; owners: string[]; run: () => void }
  const plan: Step[] = []

  for (const edit of edits) {
    const name = describeEdit(edit)
    let touched: number[]
    let pair: string | undefined
    let run: () => void
    switch (edit.op) {
      case 'summarize':
      case 'drop': {
        const useAt = findToolUse(rows, edit.tool_use_id)
        const resAt = findToolResult(rows, edit.tool_use_id)
        if (useAt < 0 || resAt < 0) {
          report.failed.push(`${name}: call or result not found`)
          continue
        }
        touched = [useAt, resAt]
        pair = ownerKey({ tool_use_id: edit.tool_use_id })
        // [SP_CTX_02_04] Outside the API window the media of a row is unknown.
        const known = options.knownResults
        if (known && (rows[resAt]!.toolResults ?? []).some(r => !known.has(r.tool_use_id))) {
          report.failed.push(`${name}: outside the API window; media unknown`)
          continue
        }
        // [SP_CTX_02_04] Rebuilding the result row drops every medium in it.
        const others = (rows[resAt]!.toolResults ?? [])
          .map(r => ownerKey({ tool_use_id: r.tool_use_id }))
          .filter(k => k !== pair && mediaOwners.has(k) && !(batchPairs.has(k) && archived(k)))
        if (others.length) {
          report.failed.push(`${name}: row also holds media of ${others.map(k => k.slice(2)).join(', ')}; summarize it in the same batch`)
          continue
        }
        run =
          edit.op === 'summarize'
            ? () => {
                const id = freshId(edit.tool_use_id)
                const use = rows[useAt]!
                const res = rows[resAt]!
                report.originals.push({ edit: name, rows: [use, res] })
                rows[useAt] = plain(use, {
                  toolUses: use.toolUses.map(u => (u.tool_use_id === edit.tool_use_id ? editedUse(u, id) : stripUse(u))),
                })
                rows[resAt] = plain(res, {
                  toolResults: (res.toolResults ?? []).map(r =>
                    r.tool_use_id === edit.tool_use_id
                      ? { tool_use_id: id, isError: r.isError, text: `${MARK} summarized${note}${mediaNote([pair!])}: ${edit.summary}` }
                      : stripResult(r),
                  ),
                })
              }
            : () => {
                report.originals.push({ edit: name, rows: [rows[useAt]!, rows[resAt]!] })
                const res = rows[resAt]!
                rows[resAt] = plain(res, { toolResults: (res.toolResults ?? []).filter(r => r.tool_use_id !== edit.tool_use_id).map(stripResult) })
                const use = rows[useAt]!
                rows[useAt] = plain(use, { toolUses: use.toolUses.filter(u => u.tool_use_id !== edit.tool_use_id).map(stripUse) })
              }
        break
      }
      case 'collapse': {
        const [a, b] = edit.anchors ?? []
        const from = a ? locate(rows, a, edit.from_index) : edit.from_index
        const to = b ? locate(rows, b, edit.to_index) : edit.to_index
        if (from < 0 || to < from || to >= rows.length) {
          report.failed.push(`${name}: the rows it named are no longer there`)
          continue
        }
        const bad = pairingError(rows, from, to)
        if (bad) {
          report.failed.push(`${name}: ${bad}`)
          continue
        }
        touched = Array.from({ length: to - from + 1 }, (_, k) => from + k)
        const known = options.knownResults
        if (known) {
          const firstKnown = rows.findIndex(r => (r.toolResults ?? []).some(t => known.has(t.tool_use_id)))
          const unknownResult = touched.some(i => (rows[i]!.toolResults ?? []).some(t => !known.has(t.tool_use_id)))
          // [SP_CTX_02_04] a prompt before the first known result may lie
          // outside the API form only when that form is cut by its window
          const earlyPrompt =
            !!options.apiTruncated &&
            touched.some(i => (firstKnown < 0 || i < firstKnown) && rows[i]!.role === 'user' && !(rows[i]!.toolResults ?? []).length)
          if (unknownResult || earlyPrompt) {
            report.failed.push(`${name}: outside the API window; media unknown`)
            continue
          }
        }
        // [SP_CTX_DEC_06] Prompt media cannot be matched to rows yet, so a
        // span with a person's prompt row may hold media that cannot be archived.
        if ((options.unmatchedPromptMedia ?? 0) > 0 && touched.some(i => rows[i]!.role === 'user' && !(rows[i]!.toolResults ?? []).length)) {
          report.failed.push(`${name}: span may hold prompt media that cannot be archived; collapse a span without prompt rows`)
          continue
        }
        const keys = ownersOf(rows, edit, touched)
        run = () => {
          const span = rows.slice(from, to + 1)
          report.originals.push({ edit: name, rows: span })
          const text = `${MARK} ${span.length} rows collapsed${note}${mediaNote(keys)}: ${edit.summary}`
          // The carrier keeps roles and pairing valid around the span; it is
          // never one of this plugin's own calls, which are dropped later.
          const carrier = span.flatMap(r => r.toolUses).find(u => !u.tool.startsWith(OWN_TOOLS))
          const id = carrier && freshId(carrier.tool_use_id)
          const replacement: SessionMessage[] =
            carrier && id
              ? [
                  { role: 'assistant', text: '', toolUses: [{ ...editedUse(carrier, id), input: {} }] },
                  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, isError: false, text }] },
                ]
              : [{ role: span[0]!.role, text, toolUses: [] }]
          rows.splice(from, span.length, ...replacement)
        }
        break
      }
      case 'rewrite':
      case 'describe': {
        const at = edit.anchors?.[0] ? locate(rows, edit.anchors[0], edit.index) : edit.index
        if (at < 0 || !rows[at]) {
          report.failed.push(`${name}: the row it named is no longer there`)
          continue
        }
        touched = [at]
        run = () => {
          const row = rows[at]!
          report.originals.push({ edit: name, rows: [row] })
          const text =
            edit.op === 'rewrite'
              ? `${MARK} rewritten${note}: ${edit.text}`
              : `${MARK} media replaced${note}${mediaNote([ownerKey({ row: at })])}: ${edit.description}\n\n${row.text}`
          rows[at] = plain(row, { text })
        }
        break
      }
    }
    const owners = ownersOf(input, edit, touched)
    if (owners.some(k => mediaOwners.has(k) && !archived(k))) {
      report.failed.push(`${name}: media could not be archived`)
      continue
    }
    plan.push({ edit, touched, pair, hi: Math.max(...touched), owners, run })
  }

  // Positions were resolved on the untouched list; applying from the end keeps
  // every earlier position valid (pair edits never splice).
  plan.sort((x, y) => y.hi - x.hi)
  const anyRow = new Set<number>()
  const exclusiveRow = new Set<number>()
  const pairs = new Set<string>()
  for (const step of plan) {
    const conflict = step.pair
      ? pairs.has(step.pair) || step.touched.some(i => exclusiveRow.has(i))
      : step.touched.some(i => anyRow.has(i))
    if (conflict) {
      report.failed.push(`${describeEdit(step.edit)}: overlaps another edit`)
      continue
    }
    step.run()
    report.applied.push(describeEdit(step.edit))
    for (const i of step.touched) {
      anyRow.add(i)
      if (!step.pair) exclusiveRow.add(i)
    }
    if (step.pair) pairs.add(step.pair)
    for (const k of step.owners) report.mediaFiles.push(...(media.get(k) ?? []))
  }

  // [SP_CTX_DEC_02] A kept tool_result row is stored after the boundary still
  // parented on the pre-compaction row, so it is rebuilt — unless it has media
  // ([C_CTX_DEC_06]) or lies outside the API window, where its media is unknown.
  const known = options.knownResults
  const relinked = rows.map(r => {
    const results = r.toolResults ?? []
    if (r.handle === undefined || results.length === 0) return r
    if (results.some(t => mediaOwners.has(ownerKey({ tool_use_id: t.tool_use_id })))) return r
    if (known && !results.every(t => known.has(t.tool_use_id))) return r
    return plain(r, {})
  })
  const out = rebuildSplitResponses(relinked).filter(r => r.handle !== undefined || !isEmpty(r))
  report.charsAfter = totalChars(out)
  return { rows: out, report }
}

// [SP_CTX_02_04] The host merges assistant rows of one model response (one
// `message.id`) when it builds a request, even across other rows; a rebuilt
// row gets a synthetic id and splits the response. A later row of it kept with
// its handle is pulled back to the earlier message, leaving its tool_use
// without the adjacent result ("Tool result missing"; plugin-hooks pitfall
// 30); an earlier one (a thinking-only row of a thinking model) pulls the
// original tool_use and its result back on --resume (pitfalls 7b, 36). The
// mod cannot see `message.id`, and a response never crosses a prompt row, so
// in each stretch between prompt rows (a user row without results that is not
// a result row a drop left empty) that holds a rebuilt or inserted assistant
// row, every assistant row kept with a handle is rebuilt too: its thinking
// blocks go, as in any rebuilt row, and the caller drops it when that leaves
// it empty. Result rows keep their own rule (media keeps the handle).
export function rebuildSplitResponses(rows: readonly SessionMessage[]): SessionMessage[] {
  const out = [...rows]
  let start = 0
  const close = (end: number) => {
    const stretch = out.slice(start, end)
    if (stretch.some(r => r.role === 'assistant' && r.handle === undefined)) {
      for (let i = start; i < end; i++) {
        const r = out[i]!
        if (r.role === 'assistant' && r.handle !== undefined) out[i] = plain(r, {})
      }
    }
  }
  out.forEach((r, i) => {
    // a prompt row ends the stretch; a result row a drop emptied is none
    // (it goes later, with the other rebuilt rows left empty)
    if (r.role === 'user' && !(r.toolResults ?? []).length && (r.handle !== undefined || !isEmpty(r))) {
      close(i)
      start = i
    }
  })
  close(out.length)
  return out
}

// [SP_CTX_01_05] FormatReport: the report as the model reads it. The size
// line is there if and only if an edit applied; without one a compaction
// changed nothing (its handler answers skip) and a seed differs from the
// visible rows only by normalizing, so "freed" would be untrue. A seed with
// neither applied nor failed edits has no report at all ("").
export type ReportKind = 'compaction' | 'seed'

export function formatReport(r: ApplyReport, archive: string, kind: ReportKind): string {
  const notApplied = r.failed.length ? `Not applied: ${r.failed.join('; ')}.` : ''
  if (!r.applied.length) {
    if (kind === 'compaction') return ['context-editor: no edit was applied; the conversation was not changed.', notApplied].filter(Boolean).join(' ')
    return notApplied ? `context-editor: no queued edit was applied. ${notApplied}` : ''
  }
  const saved = r.charsBefore - r.charsAfter
  return [
    `context-editor: applied ${r.applied.length} edit(s): ${r.applied.join('; ')}.`,
    notApplied,
    `Conversation ~${r.charsBefore} -> ~${r.charsAfter} chars (~${Math.round(saved / 4)} tokens freed).`,
    archive && r.originals.length ? `Originals archived at ${archive}.` : '',
    r.mediaFiles.length ? `Media archived: ${r.mediaFiles.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
