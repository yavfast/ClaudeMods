import type { SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'
import { isMediaBlock, matchPrompts } from './media'
import { apiBlocks, BIG_ROW, errorText, findToolResult, findToolUse, isBig, isEmptyRow, isPlainUserRow, isPromptRow, MARK, modText, PLAIN_RATIO, resultsOf, rowChars, squash, totalChars } from './rows'

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
  // for each applied edit that replaces rows: the last row it made, by its
  // index and fingerprint in the FINAL list (after DropOwnCalls in a
  // compaction, after normalizing in a seed); a row gone from it has none
  produced: Produced[]
  // [SP_CTX_02_14] the notes whose rows this application removed without a
  // replacement; filled once RebindTags has written the registry
  notesDropped: string[]
  // [SP_CTX_01_05] [SP_CTX_02_05] how many of the mod's own call pairs
  // DropOwnCalls removed from the list that replaces the conversation
  ownCallsRemoved: number
  mediaFiles: string[]
  // [SP_CTX_01_05] [SP_CTX_02_36] the host's deliveries InsertDeliveries put
  // back as rows, and those that went with a replaced anchor; `unreadable`:
  // the deliveries file could not be read, so none was inserted
  deliveries?: { inserted: number; removed: number; unreadable?: string }
}

// [SP_CTX_01_05] One entry of ApplyReport.produced.
export type Produced = { edit: string; index: number; fingerprint: string }

// [SP_CTX_02_04] What an applied replacing step made, as found again in a
// later list: the result row of its new pair id (summarize, collapse with a
// carrier), or its row by its exact text (collapse without one, rewrite,
// describe). Rebuilding keeps both.
export type Made = { edit: string; resultId?: string; text?: string }

// [SP_CTX_02_04] [SP_CTX_DEC_17] (A') The words after MARK (rows.ts) in a replacement:
// the agent read the original in this place and replaced it itself. A
// replacement stands where the result was, right after the call, and the
// agent's own context_edit call is gone, so without them it took its summary
// for what the tool returned (live run of phase 18, F1). Changed rows are
// still told apart by the MARK prefix alone.
export const SUMMARIZED = 'you read the full output here, then replaced it with your summary'
export const REWRITTEN = 'you rewrote this row'
export const DESCRIBED = 'you saw the media here, then replaced it with your description'
export function collapsedWords(n: number): string {
  return `you read these ${n} rows, then collapsed them into your note`
}
export const OWN_TOOLS = 'mcp__context-editor__'
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
// [SP_CTX_02_04] A describe whose row has no media found and archived at apply time.
export const NO_MEDIA_NOW = 'no media found in that row now'
// [SP_CTX_02_02] [SP_CTX_02_04] What a describe takes along with the prompt's
// media: the host's attachments carried by the row's handle (plugin-hooks 44).
export const DESCRIBE_DROPS = "describe: attachments the host added to that prompt (file contents from @path, reminders) are dropped; re-read files if needed."
// [SP_CTX_01_12] Tools whose output is reproducible from disk, and the flag
// of their pairs in the listing ([C_CTX_03_04], reproducibility).
export const REPRODUCIBLE_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob']
export const REPRO_FLAG = '~'

export function ownerKey(owner: MediaOwner): string {
  return 'tool_use_id' in owner ? `u:${owner.tool_use_id}` : `r:${owner.row}`
}

export function fingerprint(row: SessionMessage): string {
  const ids = [
    ...row.toolUses.map(u => 'u:' + u.tool_use_id),
    ...resultsOf(row).map(r => 'r:' + r.tool_use_id),
  ].join(',')
  return `${row.role}|${ids}|${row.text.slice(0, 160)}`
}

// [SP_CTX_02_01] A row with no text, no calls and no results (thinking only,
// or a prompt of media alone) has the fingerprint "<role>||", which tells no
// rows apart: Locate finds it only at its old index.
export function distinctive(row: SessionMessage): boolean {
  return !isEmptyRow(row)
}

// [SP_CTX_02_03] [SP_CTX_02_11] An assistant row with no text and no calls: a
// model's thinking. No target of a tag by index or of a rewrite, and no last
// row of a range. (A person's prompt of media alone is not distinctive either,
// but it keeps the old rules: no neighbouring row could stand in for it.)
export function thinkingOnly(row: SessionMessage): boolean {
  return row.role === 'assistant' && !distinctive(row)
}

// Whether an anchor is the fingerprint of a distinctive row.
function distinctiveAnchor(anchor: string): boolean {
  return anchor.slice(anchor.indexOf('|')) !== '||'
}

// [SP_CTX_02_04] LocateSpan: the first and last row of a range (a collapse, a
// disposable range tag). Its last row is distinctive (PrepareEdits,
// context_tag); a first row that is not (a response starts with a
// thinking-only row) is found from the last row by the range's length, never
// by a search that could pick another such row. Undefined when either end is
// not found or the ends cross.
export function locateSpan(
  rows: readonly SessionMessage[],
  from: { anchor: string; hint: number },
  to: { anchor: string; hint: number },
): { from: number; to: number } | undefined {
  const y = locate(rows, to.anchor, to.hint)
  if (y < 0) return undefined
  const x = distinctiveAnchor(from.anchor) ? locate(rows, from.anchor, from.hint) : y - (to.hint - from.hint)
  if (x < 0 || x > y || fingerprint(rows[x]!) !== from.anchor) return undefined
  return { from: x, to: y }
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
  // [SP_CTX_01_14] settles once a compaction handler joined this preparation:
  // the wait ends there with hostId if already read
  hurried?: Promise<void>
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
// inside one, or once a compaction handler joined the preparation
// (`hurried`), it is the value if read, else absent. A failed rewrite removes
// the file (without a boundary the whole transcript, which after /resume is
// right); if that fails too, a toast. Never throws; true when untrusted.
export async function afterPrepare(io: AfterPrepareIO): Promise<boolean> {
  if (!sessionSwitched(io.prev, io.now)) return false
  try {
    const id = io.inCompaction ? io.peek() : await (io.hurried ? Promise.race([io.wait(), io.hurried.then(() => io.peek())]) : io.wait())
    const next = withoutHost(await io.read(), id)
    if (next === undefined) return false
    try {
      await io.write(next)
    } catch {
      await io.remove()
    }
    return true
  } catch (err) {
    io.toast(modText(`the boundary of the resumed session could not be untrusted: ${errorText(err)}`))
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

// [SP_CTX_01_12] CallLabel: a call as the listing shows it ([SP_CTX_02_01])
// and as the "last" line names it ([SP_CTX_02_17]); `mark` is the listing's
// REPRO_FLAG.
export function callLabel(use: { tool: string; tool_use_id: string; input?: unknown }, alias?: string, mark = ''): string {
  return `${use.tool}${mark} id=${use.tool_use_id}${alias ? ` (${alias})` : ''} input="${oneLine(JSON.stringify(use.input ?? {}), 70)}"`
}

export function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

function isEdited(row: SessionMessage): boolean {
  return [row.text, ...resultsOf(row).map(r => r.text)].some(t => t.startsWith(MARK))
}

// Media sizes per owner key, for the listing.
export type MediaSizes = ReadonlyMap<string, readonly { mediaType: string; bytes: number }[]>

function rowMedia(row: SessionMessage, index: number, media: MediaSizes) {
  return [
    ...resultsOf(row).flatMap(r => media.get(ownerKey({ tool_use_id: r.tool_use_id })) ?? []),
    ...(media.get(ownerKey({ row: index })) ?? []),
  ]
}

// [SP_CTX_02_01] The legend of the listing's header.
export const LIST_LEGEND =
  `Flags: * already edited, ! large (>= ${BIG_ROW} chars), @ has media; ${REPRO_FLAG} after tool_use/tool_result: reproducible (Read, Grep, Glob). Marks: [stage ▶ name] the first row of the open stage; [block ▶ name] .. [block end] the last closed block. ` +
  `Tags: [pin] no edit may touch it, [state] your state slot (rewrite only), [disposable: note] (a range: [disposable #a..#b: note]) replaced by its note when you close a stage or end a turn with the optimization mark, [review: reason] worth a look. ` +
  `[nN] your note (full text under the page).`

// [SP_CTX_02_01] One note for the listing: the row it shows on (undefined:
// its target is not found) and its line for the `Notes:` block.
export type PageNote = { id: string; row?: number; line: string }

// [SP_CTX_02_01] How many notes off the page the header names; as MAX_BLOCK_INDEXES.
const NOTES_ELSEWHERE = 20
// [SP_CTX_01_12]
export const MAX_FULL_ROW = 20_000

// [SP_CTX_02_34] Estimate(chars, ratio): tokens by the calibrated chars per
// token, else chars/4 marked approx.
export function estimate(chars: number, ratio?: number): string {
  return ratio ? `~${Math.round(chars / ratio)} tokens` : `~${Math.round(chars / PLAIN_RATIO)} tokens (approx.)`
}

// [SP_CTX_02_01] One line per row, oldest first, a page of `count` rows;
// `count` 0 gives the header alone (its telemetry, no rows). `tags`: the
// labels of each row index, the stage marks first, then the tags
// ([SP_CTX_01_09]); `aliases`: the alias of each tool_use_id
// ([SP_CTX_01_13]); `telemetry`: TelemetryText ([SP_CTX_02_28]).
export function listRows(
  rows: readonly SessionMessage[],
  from: number,
  count: number,
  media: MediaSizes = new Map(),
  tags: ReadonlyMap<number, readonly string[]> = new Map(),
  aliases: ReadonlyMap<string, string> = new Map(),
  telemetry = '',
  // [SP_CTX_02_01] the full text of the notes; those whose row is on the page show under it
  notes: readonly PageNote[] = [],
  // [SP_CTX_02_01] the one size of the header: the telemetry's, else an Estimate
  sizeText?: string,
): string {
  if (rows.length === 0) return ['0 rows.', telemetry].filter(Boolean).join('\n')
  const start = Math.min(Math.max(0, Math.trunc(from)), rows.length - 1)
  const size = Math.min(Math.max(0, Math.trunc(Number.isFinite(count) ? count : LIST_COUNT)), MAX_LIST_COUNT)
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
  // [SP_CTX_02_01] REPRO_FLAG: the tool of a result is the one of its call
  const toolOf = new Map<string, string>()
  for (const r of rows) for (const u of r.toolUses) toolOf.set(u.tool_use_id, u.tool)
  const repro = (tool: string | undefined) => (tool !== undefined && REPRODUCIBLE_TOOLS.includes(tool) ? REPRO_FLAG : '')
  for (let i = start; i < stop; i++) {
    const row = rows[i]!
    const parts: string[] = []
    if (row.text) parts.push(`text "${oneLine(row.text, 90)}"`)
    for (const u of row.toolUses)
      parts.push(`tool_use ${callLabel(u, aliases.get(u.tool_use_id), repro(u.tool))}`)
    for (const r of resultsOf(row))
      parts.push(`tool_result${repro(toolOf.get(r.tool_use_id))} id=${r.tool_use_id}${r.isError ? ' ERROR' : ''} "${oneLine(r.text, 70)}"`)
    const own = rowMedia(row, i, media)
    for (const m of own) parts.push(`media ${m.mediaType} ~${Math.ceil(m.bytes / 1024)}KB`)
    const chars = rowChars(row)
    const flags = (isEdited(row) ? '*' : '') + (isBig(chars) ? '!' : '') + (own.length ? '@' : '')
    const labels = tags.get(i) ?? []
    // [SP_CTX_02_01] a thinking-only row: no target for a note or a tag by index
    const body = parts.join(' | ') || (row.role === 'assistant' ? '(thinking)' : '(empty)')
    lines.push(`#${i}${flags} ${row.role} ${chars}c: ${body}${labels.length ? ' ' + labels.join(' ') : ''}`)
  }
  const total = totalChars(rows)
  const shown = rows.slice(start, stop).reduce((n, r) => n + rowChars(r), 0)
  const sizes = `${rows.length} rows, ${sizeText ?? estimate(total)}, ${mediaCount} media (~${Math.ceil(mediaBytes / 1024)}KB).`
  // [SP_CTX_02_01] without a page every note is elsewhere
  if (size === 0) return [sizes, telemetry, notesElsewhere(notes, 0, 0)].filter(Boolean).join('\n')
  return [
    `${sizes} Showing #${start}..#${stop - 1} (oldest first), ~${shown} chars; ~${before} chars come before it.`,
    telemetry,
    `${LIST_LEGEND}${stop < rows.length ? ` Next page: from=${stop}.` : ''}`,
    notesElsewhere(notes, start, stop),
    ...lines,
    ...pageNotes(notes, start, stop),
  ]
    .filter(Boolean)
    .join('\n')
}

function onPage(n: PageNote, start: number, stop: number): boolean {
  return n.row !== undefined && n.row >= start && n.row < stop
}

function pageNotes(notes: readonly PageNote[], start: number, stop: number): string[] {
  const on = notes.filter(n => onPage(n, start, stop))
  return on.length ? ['Notes:', ...on.map(n => n.line)] : []
}

// [SP_CTX_02_01] The notes off this page, so the agent does not take them for
// lost: by row, those whose target is not found last.
function notesElsewhere(notes: readonly PageNote[], start: number, stop: number): string {
  const off = notes.filter(n => !onPage(n, start, stop))
  if (!off.length) return ''
  off.sort((x, y) => (x.row ?? Infinity) - (y.row ?? Infinity))
  const named = off.slice(0, NOTES_ELSEWHERE).map(n => (n.row === undefined ? `${n.id} (row not found)` : `${n.id} #${n.row}`))
  return `Notes elsewhere: ${named.join(', ')}${off.length > NOTES_ELSEWHERE ? `, +${off.length - NOTES_ELSEWHERE} more` : ''}`
}

// [SP_CTX_02_01] context_list with `index` and `full`: one row whole, cut to
// MAX_FULL_ROW chars. `labels`: its marks and tags; `notes`: the full text of
// its notes.
export function fullRow(
  rows: readonly SessionMessage[],
  index: number,
  media: MediaSizes = new Map(),
  labels: readonly string[] = [],
  notes: readonly string[] = [],
): string {
  const row = rows[index]!
  const parts: string[] = [`Row #${index} ${row.role} ${rowChars(row)}c`]
  if (row.text) parts.push(`text:\n${row.text}`)
  for (const u of row.toolUses) parts.push(`tool_use ${u.tool} id=${u.tool_use_id} input:\n${JSON.stringify(u.input ?? {})}`)
  for (const r of resultsOf(row)) parts.push(`tool_result id=${r.tool_use_id}${r.isError ? ' ERROR' : ''}:\n${r.text}`)
  const own = rowMedia(row, index, media)
  if (own.length) parts.push(`media: ${own.map(m => `${m.mediaType} ~${Math.ceil(m.bytes / 1024)}KB`).join(', ')}`)
  if (labels.length) parts.push(`tags: ${labels.join(' ')}`)
  for (const n of notes) parts.push(`note ${n}`)
  const text = parts.join('\n')
  if (text.length <= MAX_FULL_ROW) return text
  return `${text.slice(0, MAX_FULL_ROW)}… (+${text.length - MAX_FULL_ROW} chars; the original, if this row was edited, is in the archive named in its text)`
}

// [SP_CTX_02_01] The arguments of context_list: a page, one row whole, or
// BAD_FULL (full without a valid index, an index without full).
export function listMode(args: { from?: unknown; count?: unknown; index?: unknown; full?: unknown }, len: number): { page: { from: number; count: number } } | { full: number } | { bad: string } {
  if (args.full === true) {
    if (typeof args.index !== 'number' || !Number.isInteger(args.index) || args.index < 0 || args.index >= len)
      return { bad: `"full": true needs "index", a row of the listing (0..${len - 1}) (BAD_FULL)` }
    return { full: args.index }
  }
  if (args.index !== undefined) return { bad: '"index" goes with "full": true, to show that row whole (BAD_FULL)' }
  const count = typeof args.count === 'number' && Number.isFinite(args.count) ? Math.trunc(args.count) : LIST_COUNT
  return { page: { from: typeof args.from === 'number' ? args.from : 0, count } }
}

// [SP_CTX_02_05] Removes this plugin's own calls and their results. An own
// pair whose result row also holds media of another pair, or a result outside
// the API window, stays: rebuilding that row would drop media nobody archived.
// So does a pair in the frozen prefix ([SP_CTX_02_04], FrozenPrefix).
export function dropOwnCalls(
  input: readonly SessionMessage[],
  mediaOwners: ReadonlySet<string> = new Set(),
  knownResults?: ReadonlySet<string>,
  frozen: ReadonlySet<SessionMessage> = NONE_FROZEN,
): SessionMessage[] {
  return dropOwnCallsCounted(input, mediaOwners, knownResults, frozen).rows
}

// No row is frozen: the seed and the callers outside a compaction.
export const NONE_FROZEN: ReadonlySet<SessionMessage> = new Set()

// [SP_CTX_02_05] DropOwnCalls with `removed`: the own pairs it removed (a call
// with its result counts once; the pairs kept by media or outside the API
// window do not count). HandleCompaction and BuildSeed write it into
// `report.ownCallsRemoved` ([SP_CTX_01_05]).
export function dropOwnCallsCounted(
  input: readonly SessionMessage[],
  mediaOwners: ReadonlySet<string> = new Set(),
  knownResults?: ReadonlySet<string>,
  // [SP_CTX_02_04] the rows before the first change, returned as they came
  frozen: ReadonlySet<SessionMessage> = NONE_FROZEN,
): { rows: SessionMessage[]; removed: number } {
  const own = new Set(input.flatMap(r => r.toolUses.filter(u => u.tool.startsWith(OWN_TOOLS)).map(u => u.tool_use_id)))
  const kept = new Set<string>()
  // [SP_CTX_02_05] an own pair in the frozen prefix stays: its bytes keep the prompt cache
  for (const r of input) {
    if (!frozen.has(r)) continue
    for (const u of r.toolUses) if (own.has(u.tool_use_id)) kept.add(u.tool_use_id)
    for (const t of resultsOf(r)) if (own.has(t.tool_use_id)) kept.add(t.tool_use_id)
  }
  for (const r of input) {
    const results = resultsOf(r)
    if (!results.some(t => own.has(t.tool_use_id))) continue
    const risky = results.some(
      t => !own.has(t.tool_use_id) && (mediaOwners.has(ownerKey({ tool_use_id: t.tool_use_id })) || (knownResults !== undefined && !knownResults.has(t.tool_use_id))),
    )
    if (risky) for (const t of results) if (own.has(t.tool_use_id)) kept.add(t.tool_use_id)
  }
  const ids = new Set([...own].filter(id => !kept.has(id)))
  if (ids.size === 0) return { rows: [...input], removed: 0 }
  const dropped = input.map(r => {
    const hasUse = r.toolUses.some(u => ids.has(u.tool_use_id))
    const hasResult = resultsOf(r).some(t => ids.has(t.tool_use_id))
    if (!hasUse && !hasResult) return r
    return plain(r, {
      toolUses: r.toolUses.filter(u => !ids.has(u.tool_use_id)).map(stripUse),
      toolResults: r.toolResults?.filter(t => !ids.has(t.tool_use_id)).map(stripResult),
    })
  })
  // [SP_CTX_02_04] a rebuilt assistant row splits its response (pitfall 30)
  const kept2 = rebuildSplitResponses(dropped, frozen).filter(r => frozen.has(r) || r.handle !== undefined || !isEmptyRow(r))
  return { rows: mergeCallRows(kept2, frozen), removed: ids.size }
}

// Every tool_use in rows[from..to] must have its result there too, and back.
function pairingError(rows: readonly SessionMessage[], from: number, to: number): string | undefined {
  const uses = new Set<string>()
  const results = new Set<string>()
  for (let i = from; i <= to; i++) {
    for (const u of rows[i]!.toolUses) uses.add(u.tool_use_id)
    for (const r of resultsOf(rows[i]!)) results.add(r.tool_use_id)
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

// [SP_CTX_02_17] What a ref resolves to: the tool_use_id, with the line that
// names the call for "last" (LAST_TEXTS), or why it does not resolve.
export type Resolved = { id: string; line?: string } | { error: string }

// [SP_CTX_02_17] Resolves a call alias (or "last") on the rows as they are now.
export type RefResolver = (ref: string, rows: readonly SessionMessage[]) => Resolved
export const NO_REFS: RefResolver = ref => ({ error: unknownRef(ref) })

// [SP_CTX_02_18] [SP_CTX_02_03] Why an index from an earlier listing is
// refused; a listing with count 0 or one row in full renews nothing, so the
// text says so.
export const STALE_INDEXES =
  'the conversation was compacted since your last context_list; call context_list with a page of rows (count > 0) for current indexes — count 0 and "full" do not renew them'

export const REF_HINT = `marked calls carry a "${MARK} id cN" line after their result`

export function unknownRef(ref: string): string {
  return `unknown ref ${ref} (${REF_HINT})`
}

// [SP_CTX_02_17] Why the `ref` of a raw edit did not resolve, kept on the raw
// edit for checkShape (a symbol: never a field the agent can send).
const REF_FAILURE = Symbol('refFailure')

// [SP_CTX_02_03] A `ref` left on a summarize/drop edit: either beside a
// tool_use_id, or one that did not resolve ([SP_CTX_02_17]).
function refError(e: Record<string, unknown>): string | undefined {
  if (e.ref === undefined) return undefined
  if (e.tool_use_id !== undefined) return 'ref and tool_use_id are exclusive'
  const failure = (e as { [REF_FAILURE]?: unknown })[REF_FAILURE]
  if (typeof failure === 'string') return failure
  return unknownRef(typeof e.ref === 'string' ? e.ref : JSON.stringify(e.ref))
}

// [SP_CTX_01_02] [SP_CTX_02_17] Raw edits with each resolvable `ref` of a
// summarize/drop replaced by its tool_use_id, so the queue keeps ids only;
// any other `ref` stays for checkShape to reject, with the resolver's reason.
// `lines`: the line naming the call "last" resolved to, once. Pure.
export function resolveEditRefs(raws: readonly unknown[], resolve: RefResolver, rows: readonly SessionMessage[] = []): { edits: unknown[]; lines: string[] } {
  const lines = new Set<string>()
  const edits = raws.map(raw => {
    if (typeof raw !== 'object' || raw === null) return raw
    const { ref, ...rest } = raw as Record<string, unknown>
    if ((rest.op !== 'summarize' && rest.op !== 'drop') || typeof ref !== 'string' || rest.tool_use_id !== undefined) return raw
    const got = resolve(ref, rows)
    if ('error' in got) return { ...(raw as Record<string, unknown>), [REF_FAILURE]: got.error }
    if (got.line) lines.add(got.line)
    return { ...rest, tool_use_id: got.id }
  })
  return { edits, lines: [...lines] }
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
// pairs by tool_use_id and rows by index; `state`: the row of the state slot,
// if it is found. Data, so prepare stays pure.
export type Pinned = { ids: ReadonlySet<string>; rows: ReadonlySet<number>; state?: number }
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
      const { from, to } = spanOf(rows, edit)
      if (from < 0 || to < from || to >= rows.length) return undefined
      const span = Array.from({ length: to - from + 1 }, (_, k) => from + k)
      const ids = span.flatMap(i => [...rows[i]!.toolUses.map(u => u.tool_use_id), ...resultsOf(rows[i]!).map(r => r.tool_use_id)])
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

// [SP_CTX_02_03] [C_CTX_DEC_19] Whether an edit would change the row of the
// state slot: only a rewrite of that very row may.
export function touchesState(rows: readonly SessionMessage[], edit: QueuedEdit, pinned: Pinned): boolean {
  if (pinned.state === undefined) return false
  const t = touchedBy(rows, edit)
  if (!t || !t.rows.includes(pinned.state)) return false
  return !(edit.op === 'rewrite' && t.rows[0] === pinned.state)
}

export const STATE_SLOT = 'target holds the state slot; change it only by rewrite of that row, or remove its state tag first'

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
    if (touchesState(rows, checked, pinned)) return void errors.push(`${name}: ${STATE_SLOT}`)
    queued.push(checked)
  })
  return { queued, errors }
}

// [SP_CTX_02_03] [SP_CTX_02_11] A thinking-only row cannot be told apart by its
// anchor: no target of a rewrite or a tag by index, and no last row of a range.
export const UNTRACKED_ROW = (i: number) => `row #${i} cannot be tracked (no text, no tool call); use a neighbouring row`
export const UNTRACKED_END = (i: number) => `row #${i} holds only thinking and cannot end a range; end it at a row with text or a tool call`

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
      // [SP_CTX_02_03] the last row anchors the range (LocateSpan)
      if (thinkingOnly(rows[to]!)) return UNTRACKED_END(to)
      return pairingError(rows, from, to) ?? { ...edit, anchors: [fingerprint(rows[from]!), fingerprint(rows[to]!)] }
    }
    case 'rewrite': {
      const row = rows[edit.index]
      if (!row) return 'index out of range'
      if (row.role !== 'assistant' || row.toolUses.length > 0) return 'only an assistant text row can be rewritten; use collapse'
      // [SP_CTX_02_03] a thinking-only row cannot be found again by its anchor
      if (thinkingOnly(row)) return UNTRACKED_ROW(edit.index)
      return { ...edit, anchors: [fingerprint(row)] }
    }
    case 'describe': {
      const row = rows[edit.index]
      if (!row) return 'index out of range'
      if (!isPlainUserRow(row))
        return 'describe applies to a user prompt row; use summarize for tool results'
      if (!hasMedia({ row: edit.index })) return 'no media found in that row'
      return { ...edit, anchors: [fingerprint(row)] }
    }
  }
}

// [SP_CTX_02_04] The rows a collapse names now: by its anchors (LocateSpan),
// or by its indexes when it has none; -1 for an end not found.
function spanOf(rows: readonly SessionMessage[], edit: Extract<Edit, { op: 'collapse' }> & { anchors?: string[] }): { from: number; to: number } {
  const [a, b] = edit.anchors ?? []
  if (a === undefined || b === undefined) return { from: edit.from_index, to: edit.to_index }
  return locateSpan(rows, { anchor: a, hint: edit.from_index }, { anchor: b, hint: edit.to_index }) ?? { from: -1, to: -1 }
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

// The media owners an edit replaces, by key: the pair for summarize/drop,
// every pair and row of a collapse span, the row for describe.
function ownersOf(rows: readonly SessionMessage[], edit: QueuedEdit, touched: readonly number[]): string[] {
  switch (edit.op) {
    case 'summarize':
    case 'drop':
      return [ownerKey({ tool_use_id: edit.tool_use_id })]
    case 'collapse':
      return touched.flatMap(i => [
        ...resultsOf(rows[i]!).map(r => ownerKey({ tool_use_id: r.tool_use_id })),
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
// the rows: media by owner key (tool results by id; a person's prompt row by
// its index in `rows` once PromptMatch ties it, [SP_CTX_DEC_06]), the
// tool_use ids it shows (its window), how many prompt messages carry media
// no row could be tied to, and whether the read gave as many messages as it
// can (`apiTruncated`: older ones may lie outside it; minus one since the form
// starts with a user message and the host may drop a leading assistant one;
// plugin-hooks pitfall 10). `rows`: CurrentRows, or the compaction's
// `e.messages`. Pure.
export function collectMedia(
  api: readonly unknown[],
  rows: readonly SessionMessage[],
): {
  found: Map<string, MediaRef[]>
  knownResults: Set<string>
  unmatchedPromptMedia: number
  apiTruncated: boolean
} {
  const found = new Map<string, MediaRef[]>()
  const knownResults = new Set<string>()
  let unmatchedPromptMedia = 0
  const add = (key: string, block: Record<string, unknown>) => found.set(key, [...(found.get(key) ?? []), mediaRef(block)])
  const owners = matchPrompts(api, rows)
  api.forEach((msg, at) => {
    const blocks = apiBlocks(msg)
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const id = String(block.tool_use_id)
      knownResults.add(id)
      if (!Array.isArray(block.content)) continue
      for (const inner of block.content as Record<string, unknown>[]) if (isMediaBlock(inner)) add(ownerKey({ tool_use_id: id }), inner)
    }
    if ((msg as { role?: unknown } | null)?.role !== 'user' || !blocks.some(isMediaBlock)) return
    const row = owners.get(at)
    if (row === undefined) unmatchedPromptMedia += 1
    else for (const block of blocks) if (isMediaBlock(block)) add(ownerKey({ row }), block)
  })
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
  // [SP_CTX_02_04] [SP_CTX_DEC_22] FrozenPrefix (a compaction, never a seed):
  // the rows before the response that holds the first change are returned as
  // they came, with their handle; `api` is the Messages API form, which tells
  // the rows of one response apart (ResponseStart)
  freeze?: { api: readonly unknown[] }
  // [SP_CTX_02_04] FreshId of an edited call; tests pass a deterministic one
  newId?: (id: string) => string
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
): { rows: SessionMessage[]; report: ApplyReport; made: Made[]; renamed: Map<string, string>; prefix: number } {
  const rows = [...input]
  const report: ApplyReport = {
    applied: [],
    failed: [],
    charsBefore: totalChars(input),
    charsAfter: 0,
    originals: [],
    produced: [],
    notesDropped: [],
    ownCallsRemoved: 0,
    mediaFiles: [],
  }
  const made: Made[] = []
  const newId = options.newId ?? freshId
  // [SP_CTX_02_04] an applied summarize's tool_use_id → its FreshId, for InsertDeliveries ([SP_CTX_02_36])
  const renamed = new Map<string, string>()
  // [C_CTX_DEC_18] the replacement itself says how to get the original back
  const note = archive ? ` (original: ${archive}, open with Read)` : ''
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
  // [SP_CTX_02_04] the first row each applied step touches
  const firsts: number[] = []

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
        if (known && resultsOf(rows[resAt]!).some(r => !known.has(r.tool_use_id))) {
          report.failed.push(`${name}: outside the API window; media unknown`)
          continue
        }
        // [SP_CTX_02_04] Rebuilding the result row drops every medium in it.
        const others = resultsOf(rows[resAt]!)
          .map(r => ownerKey({ tool_use_id: r.tool_use_id }))
          .filter(k => k !== pair && mediaOwners.has(k) && !(batchPairs.has(k) && archived(k)))
        if (others.length) {
          report.failed.push(`${name}: row also holds media of ${others.map(k => k.slice(2)).join(', ')}; summarize it in the same batch`)
          continue
        }
        run =
          edit.op === 'summarize'
            ? () => {
                const id = newId(edit.tool_use_id)
                const use = rows[useAt]!
                const res = rows[resAt]!
                report.originals.push({ edit: name, rows: [use, res] })
                rows[useAt] = plain(use, {
                  toolUses: use.toolUses.map(u => (u.tool_use_id === edit.tool_use_id ? editedUse(u, id) : stripUse(u))),
                })
                rows[resAt] = plain(res, {
                  toolResults: resultsOf(res).map(r =>
                    r.tool_use_id === edit.tool_use_id
                      ? { tool_use_id: id, isError: r.isError, text: `${MARK} ${SUMMARIZED}${note}${mediaNote([pair!])}: ${edit.summary}` }
                      : stripResult(r),
                  ),
                })
                made.push({ edit: name, resultId: id })
                renamed.set(edit.tool_use_id, id)
              }
            : () => {
                report.originals.push({ edit: name, rows: [rows[useAt]!, rows[resAt]!] })
                const res = rows[resAt]!
                rows[resAt] = plain(res, { toolResults: resultsOf(res).filter(r => r.tool_use_id !== edit.tool_use_id).map(stripResult) })
                const use = rows[useAt]!
                rows[useAt] = plain(use, { toolUses: use.toolUses.filter(u => u.tool_use_id !== edit.tool_use_id).map(stripUse) })
              }
        break
      }
      case 'collapse': {
        const { from, to } = spanOf(rows, edit)
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
          const firstKnown = rows.findIndex(r => resultsOf(r).some(t => known.has(t.tool_use_id)))
          const unknownResult = touched.some(i => resultsOf(rows[i]!).some(t => !known.has(t.tool_use_id)))
          // [SP_CTX_02_04] a prompt before the first known result may lie
          // outside the API form only when that form is cut by its window
          const earlyPrompt =
            !!options.apiTruncated &&
            touched.some(i => (firstKnown < 0 || i < firstKnown) && isPlainUserRow(rows[i]!))
          if (unknownResult || earlyPrompt) {
            report.failed.push(`${name}: outside the API window; media unknown`)
            continue
          }
        }
        // [SP_CTX_DEC_06] Prompt media cannot be matched to rows yet, so a
        // span with a person's prompt row may hold media that cannot be archived.
        if ((options.unmatchedPromptMedia ?? 0) > 0 && touched.some(i => isPlainUserRow(rows[i]!))) {
          report.failed.push(`${name}: span may hold prompt media that cannot be archived; collapse a span without prompt rows`)
          continue
        }
        const keys = ownersOf(rows, edit, touched)
        run = () => {
          const span = rows.slice(from, to + 1)
          report.originals.push({ edit: name, rows: span })
          const text = `${MARK} ${collapsedWords(span.length)}${note}${mediaNote(keys)}: ${edit.summary}`
          // The carrier keeps roles and pairing valid around the span; it is
          // never one of this plugin's own calls, which are dropped later.
          const carrier = span.flatMap(r => r.toolUses).find(u => !u.tool.startsWith(OWN_TOOLS))
          const id = carrier && newId(carrier.tool_use_id)
          const replacement: SessionMessage[] =
            carrier && id
              ? [
                  { role: 'assistant', text: '', toolUses: [{ ...editedUse(carrier, id), input: {} }] },
                  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, isError: false, text }] },
                ]
              : [{ role: span[0]!.role, text, toolUses: [] }]
          rows.splice(from, span.length, ...replacement)
          made.push(id ? { edit: name, resultId: id } : { edit: name, text })
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
        // [SP_CTX_02_04] describe replaces media only when this apply found
        // and archived the row's media (PromptMatch here, not at queue time)
        if (edit.op === 'describe' && !archived(ownerKey({ row: at }))) {
          const key = ownerKey({ row: at })
          const seen = mediaOwners.has(key) || media.has(key)
          report.failed.push(`${name}: ${seen ? 'media could not be archived' : NO_MEDIA_NOW}`)
          continue
        }
        run = () => {
          const row = rows[at]!
          report.originals.push({ edit: name, rows: [row] })
          const text =
            edit.op === 'rewrite'
              ? `${MARK} ${REWRITTEN}${note}: ${edit.text}`
              : `${MARK} ${DESCRIBED}${note}${mediaNote([ownerKey({ row: at })])}: ${edit.description}\n\n${row.text}`
          rows[at] = plain(row, { text })
          made.push({ edit: name, text })
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
    firsts.push(Math.min(...step.touched))
  }

  // [SP_CTX_02_04] [SP_CTX_DEC_22] FrozenPrefix: every applied step touches
  // rows from the earliest of `firsts` on and splices only there, so the rows
  // before it stand at their input indexes, the same objects. Those before
  // the response that holds that row are returned as they came.
  const prefix = !options.freeze ? 0 : firsts.length ? responseStart(input, Math.min(...firsts), options.freeze.api) : input.length
  const frozen: ReadonlySet<SessionMessage> = prefix ? new Set(input.slice(0, prefix)) : NONE_FROZEN

  // [SP_CTX_DEC_02] A kept tool_result row is stored after the boundary still
  // parented on the pre-compaction row, so it is rebuilt — unless it has media
  // ([C_CTX_DEC_06]), lies outside the API window, where its media is unknown,
  // or stands in the frozen prefix ([SP_CTX_DEC_22]).
  const known = options.knownResults
  const relinked = rows.map(r => {
    const results = resultsOf(r)
    if (frozen.has(r) || r.handle === undefined || results.length === 0) return r
    if (results.some(t => mediaOwners.has(ownerKey({ tool_use_id: t.tool_use_id })))) return r
    if (known && !results.every(t => known.has(t.tool_use_id))) return r
    return plain(r, {})
  })
  const out = mergeCallRows(
    rebuildSplitResponses(relinked, frozen).filter(r => frozen.has(r) || r.handle !== undefined || !isEmptyRow(r)),
    frozen,
  )
  report.charsAfter = totalChars(out)
  report.produced = producedRows(out, made)
  return { rows: out, report, made, renamed, prefix }
}

// [SP_CTX_02_04] Responses(rows, api): the model responses of the rows, in
// one pass. `start[i]` is the first row of the response that holds rows[i]:
// consecutive assistant rows are one response; the host merges the rows of
// one response (one `message.id`, which the mod cannot see) into one
// assistant message of the API form, also across result rows of its own
// parallel calls (plugin-hooks 30, 40), so an assistant row whose call id or
// text (whitespace removed) an API message holds joins the response of that
// message's earliest row, never across a prompt row, and the rows between
// join too; a result row belongs to the response of its earliest call after
// the last prompt; a prompt or delivery row is one of its own, so is a result
// row without its call or an empty user row unless a response around it pulls
// it in. `known[i]`: the API form confirms that response (the run of
// assistant rows around rows[i], or around the call of its results, has a
// matching API message; a prompt row is always known; a result row without
// its call never; an empty user row only once a response pulled it in, as
// that response is). `floor[i]`: the start of the stretch, the row after the
// last prompt row before rows[i] (rows[i] itself excluded for a prompt). Pure.
export type Responses = { start: readonly number[]; known: readonly boolean[]; floor: readonly number[] }

export function responses(rows: readonly SessionMessage[], api: readonly unknown[] = []): Responses {
  const byId = new Map<string, number>()
  const byText = new Map<string, number>()
  let n = 0
  for (const msg of api) {
    if ((msg as { role?: unknown } | null)?.role !== 'assistant') continue
    for (const b of apiBlocks(msg)) {
      if (b.type === 'tool_use' && typeof b.id === 'string') byId.set(b.id, n)
      if (b.type === 'text' && typeof b.text === 'string') {
        const t = squash(b.text)
        if (t) byText.set(t, n)
      }
    }
    n++
  }
  // the API message of each assistant row, and whether its run has one
  const message = rows.map(r => {
    if (r.role !== 'assistant') return undefined
    const m = r.toolUses.map(u => byId.get(u.tool_use_id)).find(x => x !== undefined)
    if (m !== undefined) return m
    const t = squash(r.text)
    return t ? byText.get(t) : undefined
  })
  const runKnown = new Array<boolean>(rows.length).fill(false)
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.role !== 'assistant' || (i > 0 && rows[i - 1]!.role === 'assistant')) continue
    let end = i
    while (end < rows.length && rows[end]!.role === 'assistant') end++
    const found = message.slice(i, end).some(m => m !== undefined)
    for (let k = i; k < end; k++) runKnown[k] = found
  }
  const start = new Array<number>(rows.length)
  const known = new Array<boolean>(rows.length)
  const floor = new Array<number>(rows.length)
  const callAt = new Map<string, number>()
  const firstOf = new Map<number, number>()
  // empty user rows (no prompt, no results): known only by a response that pulls them in
  const loose: number[] = []
  let prompt = -1
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    floor[i] = prompt + 1
    if (r.role === 'assistant') {
      let g = i > 0 && rows[i - 1]!.role === 'assistant' ? start[i - 1]! : i
      const m = message[i]
      if (m !== undefined) {
        const first = firstOf.get(m)
        if (first !== undefined && first > prompt) g = Math.min(g, first)
        else firstOf.set(m, g)
      }
      start[i] = g
      known[i] = runKnown[i]!
      for (const u of r.toolUses) callAt.set(u.tool_use_id, i)
    } else if (isPromptRow(r)) {
      start[i] = i
      known[i] = true
      prompt = i
    } else {
      const calls = resultsOf(r).map(t => callAt.get(t.tool_use_id)).filter((k): k is number => k !== undefined && k > prompt)
      const k = calls.length ? Math.min(...calls) : undefined
      start[i] = k !== undefined ? start[k]! : i
      known[i] = k !== undefined ? known[k]! : false
      if (!resultsOf(r).length) loose.push(i)
    }
  }
  // a response that took a later row in pulls the rows between into it
  for (let i = rows.length - 1; i > 0; i--) if (start[i]! < i && start[i - 1]! > start[i]!) start[i - 1] = start[i]!
  for (let i = 0; i < rows.length; i++) start[i] = start[start[i]!]!
  for (const i of loose) if (start[i]! < i) known[i] = known[start[i]!]!
  return { start, known, floor }
}

// [SP_CTX_02_04] ResponseStart(rows, at, api): the first row of the model
// response that holds rows[at], by Responses; a response the API form does
// not confirm (outside the window, a run with neither calls nor text, a
// result row without its call) gives the start of the stretch, as
// KeepResponsesWhole has it. FrozenPrefix and CacheCost ([SP_CTX_02_38]) both
// take the start from here. `shape`: Responses of the same rows and API form,
// when the caller has them already. Pure.
export function responseStart(rows: readonly SessionMessage[], at: number, api: readonly unknown[], shape: Responses = responses(rows, api)): number {
  if (at <= 0) return 0
  if (at >= rows.length) return rows.length
  return shape.known[at] ? shape.start[at]! : shape.floor[at]!
}

// [SP_CTX_02_04] Produced(final, steps): where the rows the applied replacing
// steps made stand in `final`, the list the caller returns (after
// DropOwnCalls, KeepResponsesWhole, a seed's normalizing). A step whose row
// is gone has no entry. A text is matched to one row only. Pure.
export function producedRows(final: readonly SessionMessage[], made: readonly Made[]): Produced[] {
  const taken = new Set<number>()
  const out: Produced[] = []
  for (const m of made) {
    // a made text row may have joined a rebuilt row with calls (MergeCallRows)
    const k =
      m.resultId !== undefined
        ? findToolResult(final, m.resultId)
        : final.findIndex((r, i) => !taken.has(i) && (r.text === m.text || r.text.split(JOIN).includes(m.text!)))
    if (k < 0) continue
    if (m.resultId === undefined) taken.add(k)
    out.push({ edit: m.edit, index: k, fingerprint: fingerprint(final[k]!) })
  }
  return out
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
// `frozen`: the rows of the frozen prefix ([SP_CTX_DEC_22]) stay as they came;
// ResponseStart put the first change at the start of a response, so none of
// them shares a response with a rebuilt row.
export function rebuildSplitResponses(rows: readonly SessionMessage[], frozen: ReadonlySet<SessionMessage> = NONE_FROZEN): SessionMessage[] {
  const out = [...rows]
  let start = 0
  const close = (end: number) => {
    const stretch = out.slice(start, end)
    if (stretch.some(r => r.role === 'assistant' && r.handle === undefined)) {
      for (let i = start; i < end; i++) {
        const r = out[i]!
        if (r.role === 'assistant' && r.handle !== undefined && !frozen.has(r)) out[i] = plain(r, {})
      }
    }
  }
  out.forEach((r, i) => {
    // a prompt row ends the stretch; a result row a drop emptied is none
    // (it goes later, with the other rebuilt rows left empty)
    if (isPromptRow(r)) {
      close(i)
      start = i
    }
  })
  close(out.length)
  return out
}

// How MergeCallRows joins the texts of the rows it merges.
const JOIN = '\n\n'

// [SP_CTX_02_04] MergeCallRows: rows without `handle` are sent as messages of
// their own, each with a synthetic id, and the host merges only rows of one
// `message.id`. A rebuilt assistant row with calls followed by another rebuilt
// assistant row (parallel calls of one response written as separate rows)
// would leave its tool_uses without the results right after them: the host
// repairs that with "Tool result missing due to internal error"
// (ensureToolResultPairing; live verify of phase 14, D1). So each such row
// takes in the rebuilt assistant rows after it, up to the next row of another
// role or with a handle: texts joined in order, calls in order. Consecutive
// assistant rows are one response (a response never crosses a result or
// prompt row); a text row before the calls stays a row of its own, as the
// host takes it (spike context_editor_handoff_long, Entry 5). Pure.
export function mergeCallRows(rows: readonly SessionMessage[], frozen: ReadonlySet<SessionMessage> = NONE_FROZEN): SessionMessage[] {
  const out: SessionMessage[] = []
  for (const r of rows) {
    const prev = out.at(-1)
    if (
      prev &&
      prev.role === 'assistant' &&
      r.role === 'assistant' &&
      prev.handle === undefined &&
      r.handle === undefined &&
      prev.toolUses.length > 0 &&
      !frozen.has(prev) &&
      !frozen.has(r)
    ) {
      out[out.length - 1] = {
        role: 'assistant',
        text: [prev.text, r.text].filter(Boolean).join(JOIN),
        toolUses: [...prev.toolUses, ...r.toolUses.map(stripUse)],
      }
      continue
    }
    out.push(r)
  }
  return out
}

// [SP_CTX_02_14] The row of `after` that holds an untouched call row MergeCallRows
// joined with the other call rows of its response: the merged row holds its
// first call (review round 37, W1). -1 for a row without calls or not found.
export function mergedCallRow(row: SessionMessage, after: readonly SessionMessage[]): number {
  const first = row.toolUses[0]?.tool_use_id
  if (first === undefined) return -1
  return after.findIndex(r => r.role === 'assistant' && r.toolUses.some(u => u.tool_use_id === first))
}

// [SP_CTX_01_05] FormatReport: the report as the model reads it. The size
// line is there if and only if an edit applied; without one a compaction
// changed nothing (its handler answers skip) and a seed differs from the
// visible rows only by normalizing, so "freed" would be untrue. A seed with
// neither applied nor failed edits has no report at all ("").
export type ReportKind = 'compaction' | 'seed'

export function formatReport(r: ApplyReport, archive: string, kind: ReportKind, ratio?: number): string {
  const parts = [baseReport(r, archive, kind, ratio)]
  // [SP_CTX_01_05] after any form: the notes whose rows went
  if (r.notesDropped.length) parts.push(`Notes dropped (their rows were removed): ${r.notesDropped.join(', ')}.`)
  // [SP_CTX_01_05] P13: the agent's own context_* calls left the conversation
  // when the returned list replaces it (a compaction with an applied edit; a seed always)
  if (r.applied.some(a => a.startsWith('describe '))) parts.push(DESCRIBE_DROPS)
  if ((r.ownCallsRemoved ?? 0) > 0 && (kind === 'seed' || r.applied.length))
    parts.push(`Your own context-editor calls (${r.ownCallsRemoved}) were removed; tags and notes stay — see context_list.`)
  // [SP_CTX_01_05] [SP_CTX_02_36] the host's deliveries, when the list replaces the conversation
  if (r.deliveries && (kind === 'seed' || r.applied.length)) parts.push(deliveriesText(r.deliveries))
  const text = parts.filter(Boolean).join(' ')
  return !text || parts[0] ? text : modText(text)
}

// [SP_CTX_01_05] The report's sentence on the host's deliveries; "" when
// there is nothing to say.
export function deliveriesText(d: NonNullable<ApplyReport['deliveries']>): string {
  if (d.unreadable !== undefined) return `Messages delivered during your tool calls could not be restored (${d.unreadable}).`
  const parts = [d.inserted ? `${d.inserted} now stand as rows` : '', d.removed ? `${d.removed} went with the rows your edits replaced` : ''].filter(Boolean)
  return parts.length ? `Messages delivered during your tool calls: ${parts.join(', ')}.` : ''
}

// [SP_CTX_01_05] NowIndex: each applied edit with a `produced` entry names
// where its replacement row stands in the final list, the one the next
// context_list shows (`rewrite #23 (now #18)`); the others stay as they are.
// Only the text changes: `applied` is how callers match the batch.
export function nowIndexes(r: Pick<ApplyReport, 'applied' | 'produced'>): string[] {
  const at = new Map<string, number>()
  for (const p of r.produced ?? []) if (!at.has(p.edit)) at.set(p.edit, p.index)
  return r.applied.map(a => (at.has(a) ? `${a} (now #${at.get(a)})` : a))
}

function baseReport(r: ApplyReport, archive: string, kind: ReportKind, ratio?: number): string {
  const notApplied = r.failed.length ? `Not applied: ${r.failed.join('; ')}.` : ''
  if (!r.applied.length) {
    if (kind === 'compaction') return [modText('no edit was applied; the conversation was not changed.'), notApplied].filter(Boolean).join(' ')
    return notApplied ? modText(`no queued edit was applied. ${notApplied}`) : ''
  }
  const saved = r.charsBefore - r.charsAfter
  return [
    modText(`applied ${r.applied.length} edit(s): ${nowIndexes(r).join('; ')}.`),
    notApplied,
    // [SP_CTX_02_34] "freed" by the registry's calibrated ratio; no telemetry here
    // the measured change comes with the telemetry after the next response ([SP_CTX_02_28])
    `Conversation ~${r.charsBefore} -> ~${r.charsAfter} chars (estimate: ${estimate(saved, ratio)} freed; context_list telemetry shows the measured change after the next response).`,
    archive && r.originals.length ? `Originals archived at ${archive}.` : '',
    r.mediaFiles.length ? `Media archived: ${r.mediaFiles.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
