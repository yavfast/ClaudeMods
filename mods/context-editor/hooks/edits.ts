import type { SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'
import { personText } from './deliveries'
import { isMediaBlock, matchPrompts } from './media'
import { applyChanges, checkChanges, draftChanges, MAX_STATE_ITEMS, NO_ITEM_NOW, TOO_MANY_ITEMS, NO_STATE_SLOT, SLOT_TOO_LONG, STATE_CONFLICT, STATE_GONE, STATE_ITEMS, stateText, type DraftItem, type StateChange, type StateItem } from './state'
import { detachNote, HOST_EXCLUSIVE, HOST_ID, HOST_MEDIA, HOST_TWICE, HOST_UNKNOWN, hostRecord, type HostRowRecord } from './hostrows'
import { apiBlocks, BIG_ROW, collapsedWords, describedWords, errorText, findToolResult, findToolUse, isBig, isBlankRow, isCollapseText, isDescribedText, isEmptyRow, isPlainUserRow, isPromptRow, isReplacementText, MARK, modText, pasteBlocks, PLAIN_RATIO, pulledWords, resultsOf, rewrittenWords, rowChars, squash, summarizedWords, toolRefWords, totalChars, TRACE_OPENER, withPasteMarks, type Via } from './rows'

// [SP_CTX_01_02] One edit as the model asks for it through context_edit.
export type Edit =
  | { op: 'summarize'; tool_use_id: string; summary: string }
  | { op: 'drop'; tool_use_id: string }
  // [SP_CTX_01_30] [SP_CTX_02_61] a host row by the id of its record
  | { op: 'drop'; host: string }
  | { op: 'collapse'; from_index: number; to_index: number; summary: string }
  | { op: 'rewrite'; index: number; text: string }
  | { op: 'describe'; index: number; description: string }
  // [SP_CTX_01_30] [SP_CTX_02_67] the slot is the row with the state tag;
  // PrepareEdits and ScreenPinned stamp its anchor and index (never the agent)
  | { op: 'state'; changes: StateChange[]; index?: number }

// [SP_CTX_01_03] Index-based edits carry fingerprints of the rows they named.
// [SP_CTX_01_03] `via: 'tag'`: the replacement of a disposable tag the mod
// queued (QueueTagReplacements); its text names context_tag, not context_edit.
// [SP_CTX_01_30] `quoted`: DependencyCheck found the original's facts quoted
// in later texts of the agent (summarize, drop, collapse; the mod writes it).
export type QueuedEdit = Edit & { anchors?: string[]; via?: 'tag'; quoted?: true }

// [SP_CTX_02_61] A summarize or drop of a tool call, and a drop of a host row.
export function isPairEdit<E extends Edit>(e: E): e is Extract<E, { tool_use_id: string }> {
  return (e.op === 'summarize' || e.op === 'drop') && 'tool_use_id' in e
}
export function isHostDrop<E extends Edit>(e: E): e is Extract<E, { host: string }> {
  return e.op === 'drop' && 'host' in e
}

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
  // [SP_CTX_01_05] [SP_CTX_02_45] the originals a resume had loaded beside
  // their copies, which DropPulled removed before the edits (phase 32); 0 or
  // absent in the process that applied
  pulledDropped?: number
  // [SP_CTX_02_61] the lines on host rows: dropped ones, those that went
  // with them, DetachNote, and those that went with rebuilt rows
  hostLines?: string[]
}

// [SP_CTX_01_05] One entry of ApplyReport.produced.
export type Produced = { edit: string; index: number; fingerprint: string }

// [SP_CTX_02_04] What an applied replacing step made, as found again in a
// later list: the result row of its new pair id (summarize, collapse with a
// carrier), or its row by its exact text (collapse without one, rewrite,
// describe). Rebuilding keeps both.
export type Made = { edit: string; resultId?: string; text?: string }

// [SP_CTX_02_04] [SP_CTX_DEC_17] (A″) The replacement texts and their
// predicates live in rows.ts (STRUCT-01); re-exported for the modules and
// tests that import them from here.
export { COLLAPSED_OPENER, collapsedWords, DESCRIBED, REWRITTEN, SUMMARIZED, SUMMARIZED_OF, TAG_COLLAPSED_OPENER, TAG_REWRITTEN, TAG_SUMMARIZED, TAG_SUMMARIZED_OF, TRACE_OPENER } from './rows'
// [SP_CTX_01_12] The carrier call's one input field (phase 27), and the
// bounds of CollapsedList and of one key argument in it.
export const COLLAPSED_KEY = 'collapsed'
export const MAX_COLLAPSED_LIST = 200
export const MAX_COLLAPSED_ARG = 40
// [SP_CTX_01_32] The longest Source of a summarize opener, chars.
export const MAX_SOURCE = 120
// [SP_CTX_01_32] DependencyCheck: fragments of the original it looks for,
// their length bounds and how many the note names; the longest trace row.
export const MAX_DEP_FRAGMENTS = 100
export const DEP_MIN = 6
export const DEP_MAX = 120
export const DEP_EXAMPLES = 3
export const MAX_TRACE = 400
export const OWN_TOOLS = 'mcp__context-editor__'
export const LIST_COUNT = 60
export const MAX_LIST_COUNT = 200
export const MAX_TEXT = 8000
export const MAX_QUEUE_EDITS = 200
export const HEAD_ROWS = 8
// The most rows a read of the conversation gives, and the most messages of its API form.
export const ROW_WINDOW = 4096

// [SP_CTX_02_10] [SP_CTX_02_34] ApiCut(api): the API form may have lost its
// oldest messages: it reached its window, which the host trims to open on a
// user message, so a cut form holds ROW_WINDOW − 1 messages or more
// (plugin-hooks 49). One predicate for CollectMedia and the calibration.
export function apiCut(api: readonly unknown[]): boolean {
  return api.length >= ROW_WINDOW - 1
}
// [SP_CTX_01_14] How long after a read of the identity starts its readers
// wait for it; after that a reader takes it as absent (the read goes on).
export const HOST_ID_WAIT_MS = 2000
// The longest tool description the host passes to the model; it cuts the rest.
export const MAX_DESCRIPTION = 2048
// [SP_CTX_02_04] [SP_CTX_02_59] A describe whose row has neither media found
// and archived nor pasted text at apply time.
export const NO_MEDIA_NOW = 'no media or pasted text found in that row now'
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
  ix: RowIndex = indexRows(rows),
): { from: number; to: number } | undefined {
  const y = locate(rows, to.anchor, to.hint, ix)
  if (y < 0) return undefined
  const x = distinctiveAnchor(from.anchor) ? locate(rows, from.anchor, from.hint, ix) : y - (to.hint - from.hint)
  if (x < 0 || x > y || ix.print(x) !== from.anchor) return undefined
  return { from: x, to: y }
}

// [SP_CTX_02_04] [PL_AUD_CTX_P11] The index of one row list, each part built
// on first use: the fingerprint of each row and the rows of each fingerprint
// (Locate), the first row holding each call and each result (the pair lookup
// of findToolUse / findToolResult). Lookups on it give what the scans of the
// rows give; a pass over many targets (tags, notes, candidates) builds it once
// instead of scanning the rows for each target (CF-23). The rows must not
// change while it is used.
export type RowIndex = {
  readonly rows: readonly SessionMessage[]
  // the fingerprint of row i (an existing row)
  print: (i: number) => string
  // every row whose fingerprint is `print`, in row order
  at: (print: string) => readonly number[]
  // the row holding the call `id` / its result; -1 when none
  useAt: (id: string) => number
  resultAt: (id: string) => number
}

export function indexRows(rows: readonly SessionMessage[]): RowIndex {
  let prints: string[] | undefined
  let byPrint: Map<string, number[]> | undefined
  let uses: Map<string, number> | undefined
  let results: Map<string, number> | undefined
  const firstOf = (ids: (row: SessionMessage) => readonly string[]): Map<string, number> => {
    const m = new Map<string, number>()
    rows.forEach((r, i) => {
      for (const id of ids(r)) if (!m.has(id)) m.set(id, i)
    })
    return m
  }
  return {
    rows,
    print: i => (prints ? prints[i]! : fingerprint(rows[i]!)),
    at: print => {
      if (!byPrint) {
        prints ??= rows.map(fingerprint)
        byPrint = new Map()
        for (const [i, f] of prints.entries()) {
          const list = byPrint.get(f)
          if (list) list.push(i)
          else byPrint.set(f, [i])
        }
      }
      return byPrint.get(print) ?? []
    },
    useAt: id => (uses ??= firstOf(r => r.toolUses.map(u => u.tool_use_id))).get(id) ?? -1,
    resultAt: id => (results ??= firstOf(r => resultsOf(r).map(t => t.tool_use_id))).get(id) ?? -1,
  }
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

// [SP_CTX_01_14] The identity of the host process: one read at a time per
// module instance, started by session.start or the first PrepareStorage,
// whichever comes first. Readers outside a compaction await it, each at most
// until HOST_ID_WAIT_MS after the read started; compaction handlers only peek.
// A timeout is not memoized: the read goes on, and once it ends with the
// identity every later reader and peek gets it. A read that ends without one
// (failed, or no number printed) is dropped, so the next reader starts
// another, up to HOST_ID_READS reads per instance; a read that never ends
// keeps its slot, so there is no retry then ([SP_CTX_DEC_24]).
export type HostIdMemo = {
  // reads started so far
  reads: number
  // the read in flight or last ended, and the end of its readers' wait
  current?: { read: Promise<string | undefined>; expired: Promise<undefined> }
  // the identity once a read ended with it
  value?: string
}

// [SP_CTX_01_14] How many reads of the identity one module instance starts at
// most; a read that ended without the identity lets the next reader retry.
export const HOST_ID_READS = 3

export function newHostIdMemo(): HostIdMemo {
  return { reads: 0 }
}

// [SP_CTX_01_14] The identity for a reader that may wait: starts a read when
// none is in flight (and the instance has reads left), then waits for it until
// `expire()` of that read settles, which is absent. A failed read (the env
// call or the command) is no identity. `expire` defaults to never.
export function startHostId(
  memo: HostIdMemo,
  read: () => Promise<string | undefined>,
  expire: () => Promise<unknown> = () => new Promise(() => undefined),
): Promise<string | undefined> {
  if (memo.value !== undefined) return Promise.resolve(memo.value)
  if (!memo.current && memo.reads < HOST_ID_READS) {
    memo.reads++
    const attempt: NonNullable<HostIdMemo['current']> = {
      read: new Promise<string | undefined>(resolve => resolve(read())).then(
        value => value,
        () => undefined,
      ).then(value => {
        if (value !== undefined) memo.value = value
        else if (memo.current === attempt) memo.current = undefined
        return value
      }),
      // a timer that throws at once ends the wait at once, never the caller
      expired: new Promise<unknown>(resolve => resolve(expire())).then(
        () => undefined,
        () => undefined,
      ),
    }
    memo.current = attempt
  }
  const now = memo.current
  // the read first: when both have ended, the identity wins
  return now ? Promise.race([now.read, now.expired]) : Promise.resolve(undefined)
}

// [SP_CTX_01_14] For a compaction handler's PrepareStorage: starts the
// instance's first read if none was ever started, never a retry, and never
// waits for it.
export function kickHostId(memo: HostIdMemo, read: () => Promise<string | undefined>, expire?: () => Promise<unknown>): void {
  if (memo.reads === 0) void startHostId(memo, read, expire)
}

// [SP_CTX_01_14] For compaction handlers: the identity once a read has ended
// with it, else absent. Never waits and never starts a read.
export function peekHostId(memo: HostIdMemo): string | undefined {
  return memo.value
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
export async function readView(io: ViewIO): Promise<View> {
  const hostId = await io.hostId()
  const transcript = await io.messages()
  const st = await io.storage()
  if (!st.dir) return { transcript, rows: transcript, key: `${st.sessionId}|` }
  const raw = await io.readBoundary(st.dir)
  const { rows, mark } = boundaryView(transcript, raw, hostId, io.own())
  return { transcript, rows, key: `${st.sessionId}|${mark}` }
}

// [SP_CTX_02_18] One read of CurrentRows: the transcript, the current rows and Key().
export type View = { transcript: readonly SessionMessage[]; rows: readonly SessionMessage[]; key: string }

// [SP_CTX_02_18] [PL_AUD_CTX_P11] What one event or tool call reads of the
// conversation: CurrentRows with Key(), and the API form, each at most once
// (CF-21); every step of the event works on the same rows. A failed read is
// not kept: the next step that asks reads again. Only a step that polls the
// conversation (AwaitSeeded, [SP_CTX_02_24]) reads it past a snapshot.
export type Snapshot = {
  view: () => Promise<View>
  rows: () => Promise<readonly SessionMessage[]>
  key: () => Promise<string>
  api: () => Promise<readonly unknown[]>
}

function once<T>(read: () => Promise<T>): () => Promise<T> {
  let got: Promise<T> | undefined
  return () =>
    (got ??= read().catch((err: unknown) => {
      got = undefined
      throw err
    }))
}

export function snapshotOf(read: { view: () => Promise<View>; api: () => Promise<readonly unknown[]> }): Snapshot {
  const view = once(read.view)
  return { view, rows: async () => (await view()).rows, key: async () => (await view()).key, api: once(read.api) }
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

// The cut never splits a surrogate pair: a lone surrogate in a persisted text
// (a replacement, a carrier's input) makes the API refuse every request.
export function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut) + '…'
}

// [SP_CTX_02_04] How the agent asked for this replacement (its text names it).
function viaOf(edit: QueuedEdit): Via {
  return edit.via === 'tag' ? 'tag' : 'edit'
}

function isEdited(row: SessionMessage): boolean {
  return [row.text, ...resultsOf(row).map(r => r.text)].some(isReplacementText)
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
  `Tags: [pin] no edit may touch it, [state] your state slot (rewrite, or the state op once it has items), [disposable: note] (a range: [disposable #a..#b: note]) replaced by its note when you close a stage or move on from a block you marked, [review: reason] worth a look (superseded: a later read of the file showed changed content). ` +
  `[nN] your note (full text under the page).`

// [SP_CTX_02_01] One note for the listing: the row it shows on (undefined:
// its target is not found) and its line for the `Notes:` block.
export type PageNote = { id: string; row?: number; line: string }

// [SP_CTX_01_12] How many indexes one line names before "+<n> more": the
// candidates of one reason in a stage close report ([SP_CTX_02_29]) and the
// notes off the page in the listing's header ([SP_CTX_02_01]).
export const MAX_BLOCK_INDEXES = 20
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
  // [SP_CTX_02_01] REPRO_FLAG: the tool of a result is the one of its call; a
  // collapse carrier is a note, not a reproducible call
  const carriers = carrierIds(rows)
  const toolOf = new Map<string, string>()
  for (const r of rows) for (const u of r.toolUses) if (!carriers.has(u.tool_use_id)) toolOf.set(u.tool_use_id, u.tool)
  const repro = (tool: string | undefined) => (tool !== undefined && REPRODUCIBLE_TOOLS.includes(tool) ? REPRO_FLAG : '')
  for (let i = start; i < stop; i++) {
    const row = rows[i]!
    const parts: string[] = []
    if (row.text) parts.push(`text "${oneLine(row.text, 90)}"`)
    for (const u of row.toolUses)
      parts.push(`tool_use ${callLabel(u, aliases.get(u.tool_use_id), repro(toolOf.get(u.tool_use_id)))}`)
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
  const named = off.slice(0, MAX_BLOCK_INDEXES).map(n => (n.row === undefined ? `${n.id} (row not found)` : `${n.id} #${n.row}`))
  return `Notes elsewhere: ${named.join(', ')}${off.length > MAX_BLOCK_INDEXES ? `, +${off.length - MAX_BLOCK_INDEXES} more` : ''}`
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
  // [SP_CTX_02_64] TraceOwnCalls: one trace row per stretch from a prompt to
  // the next with a removed own pair, right before the row of its first
  // removed call (never between a call and its result); an emptied call row
  // goes below, so the trace takes its place
  const traced: SessionMessage[] = []
  let stretch: ToolUseSummary[] = []
  let at = -1
  const flush = () => {
    if (stretch.length) traced.splice(at, 0, { role: 'assistant', text: traceText(stretch), toolUses: [] })
    stretch = []
  }
  input.forEach((r, i) => {
    if (isPromptRow(r)) flush()
    const calls = r.toolUses.filter(u => ids.has(u.tool_use_id))
    if (calls.length && !stretch.length) at = traced.length
    stretch.push(...calls)
    traced.push(dropped[i]!)
  })
  flush()
  // [SP_CTX_02_04] a rebuilt assistant row splits its response (pitfall 30)
  const kept2 = rebuildSplitResponses(traced, frozen).filter(r => frozen.has(r) || r.handle !== undefined || !isEmptyRow(r))
  return { rows: mergeCallRows(kept2, frozen), removed: ids.size }
}

// [SP_CTX_02_63] Fragments: verbatim pieces of a text worth finding again
// (quoted spans, identifiers, tokens of letters and digits such as hashes and
// values, paths and URLs, long or decimal numbers), distinct, in text order,
// DEP_MIN..DEP_MAX chars, at most MAX_DEP_FRAGMENTS.
export function fragments(text: string): string[] {
  const found: { at: number; f: string }[] = []
  const take = (re: RegExp, pick: (m: RegExpMatchArray) => string | undefined) => {
    for (const m of text.matchAll(re)) {
      const f = pick(m)
      if (f) found.push({ at: m.index!, f })
    }
  }
  take(/"([^"\n]+)"|“([^”\n]+)”|«([^»\n]+)»|`([^`\n]+)`/g, m => m[1] ?? m[2] ?? m[3] ?? m[4])
  // the lookaheads are bounded by DEP_MAX: unbounded, a long hyphenated run is quadratic
  take(/\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b(?=[\w-]{0,119}\d)(?=[\w-]{0,119}[A-Za-z])[A-Za-z0-9][\w-]{0,118}[A-Za-z0-9]\b/g, m => m[0])
  take(/[^\s"'`()<>\[\]{},;«»“”]+/g, m => (/^(?:\/|\.\/|~\/|https?:\/\/)/.test(m[0]) || (m[0].includes('/') && m[0].includes('.')) ? m[0] : undefined))
  take(/\d[\d,]*(?:\.\d+)?%?/g, m => (/%|\.\d/.test(m[0]) || (m[0].match(/\d/g) ?? []).length >= 4 ? m[0] : undefined))
  const out: string[] = []
  for (const { f: raw } of found.sort((a, b) => a.at - b.at)) {
    // prose and markdown around a quote: a trailing stop or comma, emphasis marks
    const f = raw.trim().replace(/[.,:;!?]+$/, '').replace(/^[*_]+|[*_]+$/g, '')
    if (f.length < DEP_MIN || f.length > DEP_MAX || out.includes(f)) continue
    out.push(f)
    if (out.length >= MAX_DEP_FRAGMENTS) break
  }
  return out
}

// [SP_CTX_02_63] DependencyHits: the fragments of the agent's later texts
// that the edit's original holds while no other row does, so after the edit
// only the replacement would be their source. The fragments come from the
// later texts (short, and where the quotes are), not from the original (its
// first MAX_DEP_FRAGMENTS may all be filler). A heuristic: it warns and never
// refuses. Summarize: the result (the call's input stays); drop: the
// call's input and its result; collapse: texts, inputs and results of the span.
// The values of a call's input as the agent reads and quotes them: its
// strings and numbers, not the JSON text (which escapes quotes, backslashes
// and line breaks).
function inputText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(inputText).join('\n')
  if (typeof v === 'object' && v !== null) return Object.values(v).map(inputText).join('\n')
  return ''
}

export function dependencyHits(rows: readonly SessionMessage[], edit: QueuedEdit, ix?: RowIndex): { rows: number[]; examples: string[] } {
  const none = { rows: [], examples: [] }
  const target: string[] = []
  const inTarget = new Set<string>()
  let end: number
  const useKey = (i: number, k: number) => `u${i}:${k}`
  const resKey = (i: number, k: number) => `r${i}:${k}`
  // [SP_CTX_02_61] a host row is no row of the view: nothing quoted from it is checked
  if (isHostDrop(edit)) return none
  if (isPairEdit(edit)) {
    const useAt = ix ? ix.useAt(edit.tool_use_id) : findToolUse(rows, edit.tool_use_id)
    const resAt = ix ? ix.resultAt(edit.tool_use_id) : findToolResult(rows, edit.tool_use_id)
    if (useAt < 0 || resAt < 0) return none
    if (edit.op === 'drop') {
      const u = rows[useAt]!.toolUses.findIndex(x => x.tool_use_id === edit.tool_use_id)
      target.push(inputText(rows[useAt]!.toolUses[u]!.input))
      inTarget.add(useKey(useAt, u))
    }
    const k = resultsOf(rows[resAt]!).findIndex(r => r.tool_use_id === edit.tool_use_id)
    target.push(resultsOf(rows[resAt]!)[k]!.text)
    inTarget.add(resKey(resAt, k))
    end = resAt
  } else if (edit.op === 'collapse') {
    const { from, to } = spanOf(rows, edit, ix)
    if (from < 0 || to < from || to >= rows.length) return none
    for (let i = from; i <= to; i++) {
      const r = rows[i]!
      if (r.text) target.push(r.text)
      r.toolUses.forEach((u, k) => (target.push(inputText(u.input)), inTarget.add(useKey(i, k))))
      resultsOf(r).forEach((t, k) => (target.push(t.text), inTarget.add(resKey(i, k))))
      inTarget.add(`t${i}`)
    }
    end = to
  } else return none
  const later = new Map<number, string>()
  for (let i = end + 1; i < rows.length; i++) {
    const r = rows[i]!
    if (r.role === 'assistant' && r.text.trim() && !isReplacementText(r.text) && !inTarget.has(`t${i}`)) later.set(i, r.text)
  }
  // row by row in row order, at most MAX_DEP_FRAGMENTS in all (no match crosses rows)
  const frags: string[] = []
  for (const t of later.values()) {
    for (const f of fragments(t)) if (!frags.includes(f)) frags.push(f)
    if (frags.length >= MAX_DEP_FRAGMENTS) break
  }
  const original = target.join('\n')
  const quoted = frags.slice(0, MAX_DEP_FRAGMENTS).filter(f => original.includes(f))
  if (!quoted.length) return none
  // every other text, input and result: one more source of the fragment
  const others: string[] = []
  rows.forEach((r, i) => {
    if (r.text && !inTarget.has(`t${i}`) && !later.has(i)) others.push(r.text)
    r.toolUses.forEach((u, k) => inTarget.has(useKey(i, k)) || others.push(inputText(u.input)))
    resultsOf(r).forEach((t, k) => inTarget.has(resKey(i, k)) || others.push(t.text))
  })
  const hits = quoted.filter(f => !others.some(t => t.includes(f)))
  if (!hits.length) return none
  const at = [...later].filter(([, t]) => hits.some(f => t.includes(f))).map(([i]) => i)
  return { rows: at.slice(0, MAX_BLOCK_INDEXES), examples: hits.slice(0, DEP_EXAMPLES) }
}

// [SP_CTX_02_63] The note of an accepted edit whose original is quoted later.
export function dependencyNote(label: string, op: Edit['op'], hits: { rows: readonly number[]; examples: readonly string[] }): string {
  const where = hits.rows.map(i => `#${i}`).join(', ')
  const eg = hits.examples.map(f => JSON.stringify(f)).join(', ')
  const keep = op === 'drop' ? 'after the edit no row holds their source: summarize it instead to keep them' : 'after the edit only your replacement holds their source: keep them in it'
  return `Note: ${label} — facts from it are quoted in your later text ${where} (e.g. ${eg}); ${keep}.`
}

// [SP_CTX_02_64] TraceText: what the agent did with the removed own calls,
// from their inputs (a refused call is named too: "called", not "queued"),
// one item per tool in order of its first call; at most MAX_TRACE chars.
export function traceText(calls: readonly ToolUseSummary[]): string {
  const items = new Map<string, { n: number; edits: number; tag: Map<string, number>; added: number; removed: number }>()
  for (const u of calls) {
    const tool = u.tool.startsWith(OWN_TOOLS) ? u.tool.slice(OWN_TOOLS.length) : u.tool
    const item = items.get(tool) ?? { n: 0, edits: 0, tag: new Map(), added: 0, removed: 0 }
    items.set(tool, item)
    item.n++
    const input = (u.input ?? {}) as Record<string, unknown>
    const list = (key: string) => (Array.isArray(input[key]) ? (input[key] as unknown[]) : []).map(x => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {}))
    if (tool === 'context_edit') item.edits += list('edits').length
    for (const t of tool === 'context_tag' ? list('tags') : []) {
      const part =
        t.op === 'open' ? (typeof t.stage === 'string' ? `open stage ${JSON.stringify(oneLine(t.stage, MAX_TRACE))}` : 'open a stage')
        : t.op === 'close' ? 'close the stage'
        : t.op === 'add' ? `add:${typeof t.kind === 'string' ? oneLine(t.kind, MAX_TRACE) : '?'}`
        : t.op === 'remove' ? 'remove'
        : undefined
      if (part) item.tag.set(part, (item.tag.get(part) ?? 0) + 1)
    }
    for (const n of tool === 'context_note' ? list('notes') : []) {
      if (n.op === 'add') item.added++
      else if (n.op === 'remove') item.removed++
    }
  }
  const words = [...items].map(([tool, item]) => {
    switch (tool) {
      case 'context_list':
        return item.n > 1 ? `${tool} ${item.n} times` : tool
      case 'context_edit':
        return `${tool} with ${item.edits} edit(s)`
      case 'context_tag': {
        const parts = [...item.tag].map(([part, m]) =>
          part.startsWith('add:') ? `add ${m} ${part.slice(4)} tag(s)` : part === 'remove' ? `remove ${m} tag(s)` : part,
        )
        return parts.length ? `${tool} to ${parts.join(', ')}` : tool
      }
      case 'context_note':
        return `${tool} (${item.added} added, ${item.removed} removed)`
      default:
        return tool
    }
  })
  return oneLine(`${TRACE_OPENER}; you had called ${words.join(', ')}.`, MAX_TRACE - 1)
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

// [SP_CTX_02_23] [SP_CTX_02_47] CheckPairs: the first broken rule of the
// rows' pairs and ids as the reason, or undefined. Each row: no handle
// (`handles` false: CheckSeed; true: a repair, whose prompts keep theirs),
// not blank (a row with a handle may be: the host builds it from its
// original), calls only in assistant rows and results only in user rows, no
// call or result id twice, each call answered in a later row before the next
// prompt row, each result after its call. Pure.
export function checkPairs(rows: readonly SessionMessage[], handles: boolean): string | undefined {
  const calls = new Set<string>()
  const answers = new Set<string>()
  // [PL_AUD_CTX_P11] index maps, built once (CF-23): the first row of each
  // call and of each result, and for each row the next prompt row after it
  const ix = indexRows(rows)
  const nextPrompt: number[] = new Array(rows.length)
  for (let i = rows.length - 1, p = rows.length; i >= 0; i--) {
    nextPrompt[i] = p
    if (isPlainUserRow(rows[i]!)) p = i
  }
  for (const [i, r] of rows.entries()) {
    if (!handles && r.handle !== undefined) return `row ${i}: holds a handle`
    if (r.handle === undefined && isBlankRow(r)) return `row ${i}: empty`
    if (r.role === 'user' && r.toolUses.length) return `row ${i}: tool_use in a user row`
    if (r.role === 'assistant' && resultsOf(r).length) return `row ${i}: tool_result in an assistant row`
    for (const u of r.toolUses) {
      if (calls.has(u.tool_use_id)) return `row ${i}: repeated call id ${u.tool_use_id}`
      calls.add(u.tool_use_id)
    }
    for (const t of resultsOf(r)) {
      if (answers.has(t.tool_use_id)) return `row ${i}: repeated result id ${t.tool_use_id}`
      answers.add(t.tool_use_id)
    }
    // its result, in a later row, before any prompt row (a user row without
    // results); no result of it stands before row i, or that row failed first
    for (const u of r.toolUses) {
      const res = ix.resultAt(u.tool_use_id)
      if (res <= i || res >= nextPrompt[i]!) return `row ${i}: call ${u.tool_use_id} has no result before the next prompt`
    }
    for (const t of resultsOf(r)) {
      const call = ix.useAt(t.tool_use_id)
      if (call < 0 || call >= i) return `row ${i}: result ${t.tool_use_id} answers no call`
    }
  }
  return undefined
}

export function describeEdit(edit: Edit): string {
  switch (edit.op) {
    case 'summarize':
    case 'drop':
      return `${edit.op} ${'host' in edit ? edit.host : edit.tool_use_id}`
    case 'collapse':
      return `collapse #${edit.from_index}..#${edit.to_index}`
    case 'rewrite':
    case 'describe':
      return `${edit.op} #${edit.index}`
    case 'state':
      return `state (${edit.changes.map(c => (c.do === 'add' ? `add ${c.kind}` : `${c.do} ${c.id}`)).join(', ')})`
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
    // [SP_CTX_02_61] a ref beside host stays for checkShape (HOST_EXCLUSIVE)
    if ((rest.op !== 'summarize' && rest.op !== 'drop') || typeof ref !== 'string' || rest.tool_use_id !== undefined || rest.host !== undefined) return raw
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
  // [SP_CTX_02_61] a host row by the id of its record
  if (e.op === 'drop' && e.host !== undefined) {
    if (e.tool_use_id !== undefined || e.ref !== undefined) return HOST_EXCLUSIVE
    if (typeof e.host !== 'string' || !HOST_ID.test(e.host)) return 'host is the id of a host row from context_list (h1, h2, …)'
    return { op: 'drop', host: e.host }
  }
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
    case 'state': {
      // [SP_CTX_02_67] BAD_CHANGE
      const changes = checkChanges(e.changes)
      return typeof changes === 'string' ? changes : { op: 'state', changes }
    }
    default:
      return `unknown op ${JSON.stringify(e.op)}`
  }
}

// [SP_CTX_02_03] Targets carrying a `pin` tag, resolved on one row list:
// pairs by tool_use_id and rows by index; `state`: the row of the state slot,
// if it is found. Data, so prepare stays pure.
// [SP_CTX_02_67] `items`: the slot's items the registry holds (phase 44).
export type Pinned = { ids: ReadonlySet<string>; rows: ReadonlySet<number>; state?: number; items?: readonly StateItem[] }
export const NO_PINS: Pinned = { ids: new Set(), rows: new Set() }

// The rows and pairs an edit changes, resolved on `rows` (anchors through
// Locate); undefined when its target is not there.
export function touchedBy(rows: readonly SessionMessage[], edit: QueuedEdit, ix?: RowIndex): { rows: number[]; ids: string[] } | undefined {
  switch (edit.op) {
    case 'summarize':
    case 'drop': {
      // [SP_CTX_02_61] a host row is no row of the view
      if ('host' in edit) return undefined
      const useAt = ix ? ix.useAt(edit.tool_use_id) : findToolUse(rows, edit.tool_use_id)
      const resAt = ix ? ix.resultAt(edit.tool_use_id) : findToolResult(rows, edit.tool_use_id)
      return useAt < 0 || resAt < 0 ? undefined : { rows: [useAt, resAt], ids: [edit.tool_use_id] }
    }
    case 'collapse': {
      const { from, to } = spanOf(rows, edit, ix)
      if (from < 0 || to < from || to >= rows.length) return undefined
      const span = Array.from({ length: to - from + 1 }, (_, k) => from + k)
      const ids = span.flatMap(i => [...rows[i]!.toolUses.map(u => u.tool_use_id), ...resultsOf(rows[i]!).map(r => r.tool_use_id)])
      return { rows: span, ids: [...new Set(ids)] }
    }
    case 'rewrite':
    case 'describe': {
      const at = edit.anchors?.[0] ? locate(rows, edit.anchors[0], edit.index, ix) : edit.index
      return at < 0 || !rows[at] ? undefined : { rows: [at], ids: [] }
    }
    // [SP_CTX_02_67] the slot row it was stamped with; none: not stamped
    case 'state': {
      if (edit.index === undefined || !edit.anchors?.[0]) return undefined
      const at = locate(rows, edit.anchors[0], edit.index, ix)
      return at < 0 ? undefined : { rows: [at], ids: [] }
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
// state slot: only a rewrite of that very row or a state edit may.
export function touchesState(rows: readonly SessionMessage[], edit: QueuedEdit, pinned: Pinned): boolean {
  if (pinned.state === undefined) return false
  const t = touchedBy(rows, edit)
  if (!t || !t.rows.includes(pinned.state)) return false
  return !((edit.op === 'rewrite' || edit.op === 'state') && t.rows[0] === pinned.state)
}

export const STATE_SLOT = 'target holds the state slot; change it by rewrite of that row, or by the state op once it has items, or remove its state tag first'

// [SP_CTX_01_32] [SP_CTX_02_67] SLOT_TOO_LONG at queue time leaves this room
// for the archive line the apply writes (its path is not known yet: about the
// project root's length + 110) and for the ids the batch's new items get (counted as
// `p?` here, up to ~4 chars each once numbered).
export const ARCHIVE_ROOM = 600

// [SP_CTX_02_67] A state edit stamped with the slot row (anchor, index) or,
// without a slot, without them: the apply then fails it STATE_GONE.
export function stampState(rows: readonly SessionMessage[], edit: Extract<QueuedEdit, { op: 'state' }>, slot: number | undefined): QueuedEdit {
  const { anchors: _a, index: _i, ...rest } = edit
  return slot === undefined || slot < 0 || !rows[slot] ? rest : { ...rest, index: slot, anchors: [fingerprint(rows[slot]!)] }
}

// [SP_CTX_02_67] PrepareEdits of a state edit: the slot, no rewrite of it in
// the batch (`batch`: the queued edits, then the earlier ones of this call),
// the changes against the items with the batch's state edits applied, and
// the room of the assembled slot.
function prepareState(rows: readonly SessionMessage[], edit: Extract<Edit, { op: 'state' }>, pinned: Pinned, batch: readonly QueuedEdit[]): QueuedEdit | string {
  const slot = pinned.state
  if (slot === undefined || !rows[slot]) return NO_STATE_SLOT
  if (batch.some(e => e.op === 'rewrite' && touchedBy(rows, e)?.rows[0] === slot)) return STATE_CONFLICT('rewrite')
  let drafts: DraftItem[] = [...(pinned.items ?? [])]
  for (const e of batch) {
    if (e.op !== 'state') continue
    const d = draftChanges(drafts, e.changes, true)
    if ('items' in d) drafts = d.items
  }
  const d = draftChanges(drafts, edit.changes)
  if ('error' in d) return d.error
  if (stateText(' '.repeat(ARCHIVE_ROOM), d.items).length > MAX_TEXT) return SLOT_TOO_LONG(MAX_TEXT - ARCHIVE_ROOM - STATE_HEAD)
  return stampState(rows, edit, slot)
}

// The length of STATE_REBUILT and the ":\n" after the archive line.
const STATE_HEAD = stateText('', []).length - '(no items)'.length

// [SP_CTX_02_67] A rewrite of the slot row: refused while the slot has items
// (STATE_ITEMS) or beside a state edit in the batch (STATE_CONFLICT).
function slotRewriteError(rows: readonly SessionMessage[], edit: QueuedEdit, pinned: Pinned, batch: readonly QueuedEdit[]): string | undefined {
  if (edit.op !== 'rewrite' || pinned.state === undefined || touchedBy(rows, edit)?.rows[0] !== pinned.state) return undefined
  if (pinned.items?.length) return STATE_ITEMS
  return batch.some(e => e.op === 'state') ? STATE_CONFLICT('state') : undefined
}

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
  // [SP_CTX_02_67] the edits already in pending.json (STATE_CONFLICT, the
  // items a state edit sees)
  pending: readonly QueuedEdit[] = [],
  // [SP_CTX_02_61] the host rows' records (HOST_UNKNOWN)
  hostRows: readonly HostRowRecord[] = [],
): { queued: QueuedEdit[]; errors: string[] } {
  const queued: QueuedEdit[] = []
  const errors: string[] = []
  raws.forEach((raw, n) => {
    const edit = checkShape(raw)
    if (typeof edit === 'string') {
      errors.push(`edit ${n + 1}: ${edit}`)
      return
    }
    // [SP_CTX_02_61] HOST_UNKNOWN, HOST_TWICE; a host row is no row of the
    // view: pins, the state slot and the indexes do not apply
    if (isHostDrop(edit)) {
      if (!hostRecord(hostRows, edit.host)) return void errors.push(`${describeEdit(edit)}: ${HOST_UNKNOWN(edit.host)}`)
      if ([...pending, ...queued].some(q => isHostDrop(q) && q.host === edit.host)) return void errors.push(`edit ${n + 1}: ${HOST_TWICE(edit.host)}`)
      return void queued.push(edit)
    }
    const name = describeEdit(edit)
    if (staleIndexes && (edit.op === 'collapse' || edit.op === 'rewrite' || edit.op === 'describe')) return void errors.push(`${name}: ${STALE_INDEXES}`)
    const checked = edit.op === 'state' ? prepareState(rows, edit, pinned, [...pending, ...queued]) : checkTarget(rows, edit, hasMedia)
    if (typeof checked === 'string') return void errors.push(`${name}: ${checked}`)
    if (touchesPin(rows, checked, pinned)) return void errors.push(`${name}: ${PINNED}`)
    if (touchesState(rows, checked, pinned)) return void errors.push(`${name}: ${STATE_SLOT}`)
    const slotError = slotRewriteError(rows, checked, pinned, [...pending, ...queued])
    if (slotError) return void errors.push(`${name}: ${slotError}`)
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
      // [SP_CTX_02_61] a host drop is checked against the records by prepare
      if ('host' in edit) return edit
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
      // [SP_CTX_02_59] media of the row or the host's paste blocks in its text
      if (!hasMedia({ row: edit.index }) && !pasteBlocks(row.text).length) return 'no media or pasted text found in that row'
      return { ...edit, anchors: [fingerprint(row)] }
    }
    case 'state':
      return 'state edits are prepared by prepareState'
  }
}

// [SP_CTX_02_04] The rows a collapse names now: by its anchors (LocateSpan),
// or by its indexes when it has none; -1 for an end not found.
function spanOf(rows: readonly SessionMessage[], edit: Extract<Edit, { op: 'collapse' }> & { anchors?: string[] }, ix?: RowIndex): { from: number; to: number } {
  const [a, b] = edit.anchors ?? []
  if (a === undefined || b === undefined) return { from: edit.from_index, to: edit.to_index }
  return locateSpan(rows, { anchor: a, hint: edit.from_index }, { anchor: b, hint: edit.to_index }, ix) ?? { from: -1, to: -1 }
}

// [SP_CTX_02_04] Locate: the row an anchor names, at its old index if it is
// still there, else the one row anywhere that matches; -1 when none or many.
// `ix`: the index of `rows`, when the caller locates many anchors on them.
export function locate(rows: readonly SessionMessage[], anchor: string, hint: number, ix: RowIndex = indexRows(rows)): number {
  if (rows[hint] && ix.print(hint) === anchor) return hint
  const hits = ix.at(anchor)
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

// [SP_CTX_02_04] The calls of `rows` that carry a collapse: their result opens
// with the collapse words, and their input is the one COLLAPSED_KEY string
// (phase 27) or, from an older apply, empty. Pure.
export function carrierIds(rows: readonly SessionMessage[]): Set<string> {
  const notes = new Set<string>()
  for (const r of rows) for (const t of resultsOf(r)) if (isCollapseText(t.text)) notes.add(t.tool_use_id)
  const out = new Set<string>()
  for (const r of rows)
    for (const u of r.toolUses) {
      const input = u.input
      if (typeof input !== 'object' || input === null || Array.isArray(input)) continue
      const keys = Object.keys(input)
      const own = keys.length === 0 || (keys.length === 1 && typeof (input as Record<string, unknown>)[COLLAPSED_KEY] === 'string')
      if (own && notes.has(u.tool_use_id)) out.add(u.tool_use_id)
    }
  return out
}

// [SP_CTX_02_04] [SP_CTX_DEC_29] CollapsedList(span): what a collapse span
// held, at most MAX_COLLAPSED_LIST chars. Its calls grouped by tool in the
// order of first use, `Tool arg` for one call and `Tool ×n: arg, arg` for
// more, with the distinct key arguments (KeyArg); then the counts of the
// person's messages (PersonText not empty, a described prompt, a prompt of
// media alone), the agent's texts and its earlier collapse notes. Other user
// rows (host frames, the mod's texts) are not counted. The mod's own calls are
// not named: DropOwnCalls removes them. Pure.
export function collapsedList(span: readonly SessionMessage[]): string {
  const carriers = carrierIds(span)
  const groups = new Map<string, { n: number; args: string[] }>()
  let person = 0
  let texts = 0
  let notes = 0
  for (const row of span) {
    for (const u of row.toolUses) {
      if (u.tool.startsWith(OWN_TOOLS)) continue
      if (carriers.has(u.tool_use_id)) {
        notes++
        continue
      }
      let g = groups.get(u.tool)
      if (!g) groups.set(u.tool, (g = { n: 0, args: [] }))
      g.n++
      const arg = keyArg(u.input)
      if (arg && !g.args.includes(arg)) g.args.push(arg)
    }
    if (resultsOf(row).length) continue
    const text = row.text.trim()
    if (text && isCollapseText(text)) notes++
    else if (row.role === 'assistant') texts += text ? 1 : 0
    // a person's prompt keeps its words after a describe; a prompt of media
    // alone has no text but is the person's
    else if (text ? isDescribedText(text) || personText(text) !== '' : isPromptRow(row)) person++
  }
  const counts = [
    person ? `${person} of the person's messages` : '',
    texts ? `${texts} of your texts` : '',
    notes ? `${notes} of your earlier notes` : '',
  ].filter(Boolean)
  const tail = counts.join('; ')
  return [capCalls([...groups], MAX_COLLAPSED_LIST - (tail ? tail.length + 2 : 0)), tail].filter(Boolean).join('; ')
}

// The groups of CollapsedList in at most `max` chars: whole groups while they
// fit, then the arguments of the next one while they fit (`, …`), then
// `…, +n more` for the calls of the groups left out.
function capCalls(groups: readonly [string, { n: number; args: string[] }][], max: number): string {
  const render = (tool: string, n: number, args: readonly string[], cut: boolean) => {
    const head = n > 1 ? `${tool} ×${n}` : tool
    return args.length ? `${head}${n > 1 ? ': ' : ' '}${args.join(', ')}${cut ? ', …' : ''}` : head
  }
  const more = (n: number) => `…, +${n} more`
  const calls = (from: number) => groups.slice(from).reduce((n, [, g]) => n + g.n, 0)
  const parts: string[] = []
  let used = 0
  const fits = (part: string, reserve: number) => used + (parts.length ? 2 : 0) + part.length + reserve <= max
  const push = (part: string) => {
    used += (parts.length ? 2 : 0) + part.length
    parts.push(part)
  }
  for (let k = 0; k < groups.length; k++) {
    const [tool, g] = groups[k]!
    const later = calls(k + 1)
    const reserve = later ? 2 + more(later).length : 0
    const full = render(tool, g.n, g.args, false)
    if (fits(full, reserve)) {
      push(full)
      continue
    }
    // this group does not fit whole: its arguments while they fit, then stop
    let args: string[] = []
    for (const a of g.args) {
      if (!fits(render(tool, g.n, [...args, a], true), reserve)) break
      args = [...args, a]
    }
    if (args.length) {
      push(render(tool, g.n, args, true))
      if (later) push(more(later))
    } else {
      // degenerate: not even this group's first argument (or, without
      // arguments, its name) fits beside the tail; it and every later group
      // are counted. The room before always kept space for this tail.
      push(more(calls(k)))
    }
    break
  }
  return parts.join('; ')
}

// [SP_CTX_02_04] KeyArg(input): the argument that names a call, at most
// MAX_COLLAPSED_ARG chars: the base name of `file_path` or `notebook_path`,
// a quoted `pattern`, the first word of `command` (after `cd <dir> &&` and
// variable assignments), the host of `url`, a quoted `description` or
// `query`, the base name of `path`; none otherwise.
export function keyArg(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const o = input as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : undefined)
  const clip = (v: string) => oneLine(v, MAX_COLLAPSED_ARG - 1)
  const quote = (v: string) => `"${oneLine(v, MAX_COLLAPSED_ARG - 3)}"`
  const base = (v: string) => v.replace(/\/+$/, '').split('/').pop() || v
  const file = s('file_path') ?? s('notebook_path')
  if (file) return clip(base(file))
  const pattern = s('pattern')
  if (pattern) return quote(pattern)
  const command = s('command')
  if (command) {
    const words = command.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, '').split(/\s+/).filter(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))
    return words[0] ? clip(base(words[0])) : ''
  }
  const url = s('url')
  // the host without userinfo: a password in a URL never goes into the text
  if (url) return clip((/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).replace(/^.*@/, ''))
  const named = s('description') ?? s('query')
  if (named) return quote(named)
  const path = s('path')
  return path ? clip(base(path)) : ''
}

// [SP_CTX_01_28] SourceOf(call): where the replaced content came from, from
// the call's input only (never its result), at most MAX_SOURCE chars (OneLine
// cuts a quoted value, so its closing quote stays). A file path is relative to
// `cwd`, the session's project root, when inside it; a URL loses userinfo,
// query and fragment (a query may carry a token).
export function sourceOf(tool: string, input: unknown, cwd?: string): string {
  const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const s = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : undefined)
  // a cwd of "/" names no project: every path stays absolute
  const root = cwd?.replace(/\/+$/, '')
  const path = (v: string) => {
    const p = v.replace(/\/+$/, '') || v
    return !root ? v : p === root ? '.' : p.startsWith(`${root}/`) ? p.slice(root.length + 1) : v
  }
  const plain = (head: string, v: string) => oneLine(`${head} ${v}`, MAX_SOURCE - 1)
  const quoted = (head: string, v: string) => `${head} "${oneLine(v, MAX_SOURCE - head.length - 4)}"`
  // [SP_CTX_02_04] a collapse carrier names the rows it stands for, not its tool
  const collapsed = s(COLLAPSED_KEY)
  if (collapsed) return plain('collapsed rows', `(${collapsed})`)
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const file = s(tool === 'NotebookEdit' ? 'notebook_path' : 'file_path')
      return file ? plain(tool, path(file)) : tool
    }
    case 'Bash': {
      const command = s('command')
      return command ? quoted(tool, command) : tool
    }
    case 'Grep':
    case 'Glob': {
      const pattern = s('pattern')
      if (!pattern) return tool
      const where = tool === 'Grep' ? s('path') : undefined
      if (!where) return quoted(tool, pattern)
      // the pattern takes at most half; the path gets the room it leaves
      const head = `${tool} "${oneLine(pattern, MAX_SOURCE / 2 - tool.length - 4)}"`
      return `${head} ${oneLine(`in ${path(where)}`, MAX_SOURCE - head.length - 2)}`
    }
    case 'WebFetch': {
      const url = s('url')
      const m = url ? /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(url) : null
      return m ? plain(tool, `${m[1]!.replace(/^.*@/, '')}${m[2]}`) : tool
    }
    case 'WebSearch': {
      const query = s('query')
      return query ? quoted(tool, query) : tool
    }
    case 'Agent':
    case 'Task': {
      const description = s('description')
      return description ? quoted('subagent', description) : 'subagent'
    }
    default: {
      const arg = keyArg(input)
      return oneLine(arg ? `${tool} ${arg}` : tool, MAX_SOURCE - 1)
    }
  }
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
      return 'host' in edit ? [] : [ownerKey({ tool_use_id: edit.tool_use_id })]
    case 'collapse':
      return touched.flatMap(i => [
        ...resultsOf(rows[i]!).map(r => ownerKey({ tool_use_id: r.tool_use_id })),
        ownerKey({ row: i }),
      ])
    case 'describe':
      return [ownerKey({ row: touched[0]! })]
    case 'rewrite':
    case 'state':
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

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

// [SP_CTX_01_06] The file extension of a media file by its media type.
export function mediaExt(mediaType: string): string {
  return EXT[mediaType] ?? 'bin'
}

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
  toolRefs: Map<string, string[]>
} {
  const found = new Map<string, MediaRef[]>()
  const knownResults = new Set<string>()
  // [SP_CTX_02_48] the tools a ToolSearch result loaded, by its call id
  const toolRefs = new Map<string, string[]>()
  let unmatchedPromptMedia = 0
  const add = (key: string, block: Record<string, unknown>) => found.set(key, [...(found.get(key) ?? []), mediaRef(block)])
  const owners = matchPrompts(api, rows)
  // [SP_CTX_02_47] a loaded chain shows a result twice (original and copy):
  // its media and tool references count once, from the first
  const seen = new Set<string>()
  api.forEach((msg, at) => {
    const blocks = apiBlocks(msg)
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const id = String(block.tool_use_id)
      knownResults.add(id)
      if (seen.has(id)) continue
      seen.add(id)
      if (!Array.isArray(block.content)) continue
      for (const inner of block.content as Record<string, unknown>[]) {
        if (isMediaBlock(inner)) add(ownerKey({ tool_use_id: id }), inner)
        else if (inner?.type === 'tool_reference' && typeof inner.tool_name === 'string') toolRefs.set(id, [...(toolRefs.get(id) ?? []), inner.tool_name])
      }
    }
    if ((msg as { role?: unknown } | null)?.role !== 'user' || !blocks.some(isMediaBlock)) return
    const row = owners.get(at)
    if (row === undefined) unmatchedPromptMedia += 1
    else for (const block of blocks) if (isMediaBlock(block)) add(ownerKey({ row }), block)
  })
  return { found, knownResults, unmatchedPromptMedia, apiTruncated: apiCut(api), toolRefs }
}

// [SP_CTX_02_48] ToolRefText: the text of a result row the mod returns
// without its handle and leaves unchanged. A ToolSearch result is empty as a
// row (its tool_reference blocks are no text), so it names the tools it
// loaded (TOOLREF_TEXT); any other result, or one the API form does not show,
// keeps its text. Pure.
export function toolRefText(t: ToolResultSummary, toolRefs: ReadonlyMap<string, readonly string[]> | undefined): string {
  const names = toolRefs?.get(t.tool_use_id)
  return t.text.trim() !== '' || !names?.length ? t.text : toolRefWords(names)
}

// [SP_CTX_02_22] [SP_CTX_02_47] CarryNote: the media of an untouched pair, as
// files (a seed and a repair rebuild every result row without its handle).
export function carryNote(refs: readonly MediaRef[], paths: readonly (string | undefined)[]): string {
  const items = refs.map((ref, k) => (paths[k] ? `${ref.mediaType} ${paths[k]}` : `${ref.mediaType} (not carried: no inline data)`))
  return `${MARK} media carried as files (open them with Read): ${items.join(', ')}`
}

// [SP_CTX_02_22] A result's text with its CarryNote after it.
export function withCarryNote(text: string, refs: readonly MediaRef[], paths: readonly (string | undefined)[]): string {
  return `${text}${text.trim() ? '\n\n' : ''}${carryNote(refs, paths)}`
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
  // [SP_CTX_01_28] the session's project root: SourceOf names a file
  // inside it by its relative path
  cwd?: string
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
  // [SP_CTX_02_48] CollectMedia's toolRefs: a ToolSearch result rebuilt
  // without its handle names the tools it loaded (ToolRefText)
  toolRefs?: ReadonlyMap<string, readonly string[]>
  // [SP_CTX_02_67] run state: the items, the next number and the turn of the
  // registry read for this apply; absent: none, the next is 1, turn 0
  state?: StateInput
  // [SP_CTX_02_61] the host rows' records read for this apply; absent: none
  hostRows?: readonly HostRowRecord[]
}

// [SP_CTX_02_67] What run state starts from, and (ApplyEdits' `state`) what
// the commit writes.
export type StateInput = { items: readonly StateItem[]; nextItem: number; turn: number }
export type StateOutput = { items: StateItem[]; nextItem: number }

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
): { rows: SessionMessage[]; report: ApplyReport; made: Made[]; renamed: Map<string, string>; prefix: number; hostNamed: Set<string>; state?: StateOutput } {
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
    edits.flatMap(e => (isPairEdit(e) ? [ownerKey({ tool_use_id: e.tool_use_id })] : [])),
  )

  // A pair edit conflicts only on its own pair and on rows a row edit takes;
  // a row edit (collapse, rewrite, describe) takes its rows exclusively.
  // `names`: the edits one step applies (every state edit of the batch)
  type Step = { edit: QueuedEdit; names?: string[]; touched: number[]; pair?: string; hi: number; owners: string[]; run: () => void }
  const plan: Step[] = []
  // [SP_CTX_02_04] the first row each applied step touches
  const firsts: number[] = []
  // [SP_CTX_02_67] the state edits of the batch: one rebuild of the slot
  const stateEdits: Extract<QueuedEdit, { op: 'state' }>[] = []
  // [SP_CTX_02_61] the host drops of the batch, run after every other step
  const hostDrops: Extract<QueuedEdit, { host: string }>[] = []
  let stateOut: StateOutput | undefined

  for (const edit of edits) {
    const name = describeEdit(edit)
    let touched: number[]
    let pair: string | undefined
    let run: () => void
    switch (edit.op) {
      case 'state':
        stateEdits.push(edit)
        continue
      case 'summarize':
      case 'drop': {
        // [SP_CTX_02_61] host drops run after every other step
        if ('host' in edit) {
          hostDrops.push(edit)
          continue
        }
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
                const call = use.toolUses.find(u => u.tool_use_id === edit.tool_use_id)!
                const source = sourceOf(call.tool, call.input, options.cwd)
                report.originals.push({ edit: name, rows: [use, res] })
                rows[useAt] = plain(use, {
                  toolUses: use.toolUses.map(u => (u.tool_use_id === edit.tool_use_id ? editedUse(u, id) : stripUse(u))),
                })
                rows[resAt] = plain(res, {
                  toolResults: resultsOf(res).map(r =>
                    r.tool_use_id === edit.tool_use_id
                      ? { tool_use_id: id, isError: r.isError, text: `${summarizedWords(source, viaOf(edit), edit.quoted === true)}${note}${mediaNote([pair!])}: ${edit.summary}` }
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
          const list = collapsedList(span)
          const text = `${collapsedWords(span.length, list, viaOf(edit), edit.quoted === true)}${note}${mediaNote(keys)}: ${edit.summary}`
          // The carrier keeps roles and pairing valid around the span; it is
          // never one of this plugin's own calls, which are dropped later. Its
          // name is a tool the session has; its input names what the span
          // held, never the first call's arguments ([SP_CTX_DEC_29]).
          const carrier = span.flatMap(r => r.toolUses).find(u => !u.tool.startsWith(OWN_TOOLS))
          const id = carrier && newId(carrier.tool_use_id)
          const replacement: SessionMessage[] =
            carrier && id
              ? [
                  { role: 'assistant', text: '', toolUses: [{ ...editedUse(carrier, id), input: { [COLLAPSED_KEY]: list } }] },
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
        // and archived the row's media (PromptMatch here, not at queue time);
        // [SP_CTX_02_59] pasted text it replaces from the row's text
        const withMedia = edit.op === 'describe' && archived(ownerKey({ row: at }))
        const pastes = edit.op === 'describe' ? pasteBlocks(rows[at]!.text) : []
        if (edit.op === 'describe' && !withMedia && !pastes.length) {
          const key = ownerKey({ row: at })
          const seen = mediaOwners.has(key) || media.has(key)
          report.failed.push(`${name}: ${seen ? 'media could not be archived' : NO_MEDIA_NOW}`)
          continue
        }
        // [SP_CTX_02_59] a describe of pasted text alone rebuilds the row: media
        // the apply could not see (unmatched, or outside a cut API form) would go unarchived
        if (edit.op === 'describe' && !withMedia) {
          // media this apply found but could not archive stays: never rebuilt away
          if (mediaOwners.has(ownerKey({ row: at }))) {
            report.failed.push(`${name}: media could not be archived`)
            continue
          }
          const known = options.knownResults
          const firstKnown = known ? rows.findIndex(r => resultsOf(r).some(t => known.has(t.tool_use_id))) : -1
          if (!!options.apiTruncated && (firstKnown < 0 || at < firstKnown)) {
            report.failed.push(`${name}: outside the API window; media unknown`)
            continue
          }
          if ((options.unmatchedPromptMedia ?? 0) > 0) {
            report.failed.push(`${name}: the prompt may hold media that cannot be archived`)
            continue
          }
        }
        run = () => {
          const row = rows[at]!
          report.originals.push({ edit: name, rows: [row] })
          const text =
            edit.op === 'rewrite'
              ? `${rewrittenWords(viaOf(edit))}${note}: ${edit.text}`
              : `${describedWords(withMedia, pastes.length > 0)}${note}${withMedia ? mediaNote([ownerKey({ row: at })]) : ''}: ${edit.description}\n\n${withPasteMarks(row.text, pastes)}`
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
  const stateStep = stateEdits.length ? runState(rows, stateEdits, note, options.state, report, made, out => (stateOut = out)) : undefined
  if (stateStep) plan.push(stateStep)

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
      for (const name of step.names ?? [describeEdit(step.edit)]) report.failed.push(`${name}: overlaps another edit`)
      continue
    }
    step.run()
    report.applied.push(...(step.names ?? [describeEdit(step.edit)]))
    for (const i of step.touched) {
      anyRow.add(i)
      if (!step.pair) exclusiveRow.add(i)
    }
    if (step.pair) pairs.add(step.pair)
    for (const k of step.owners) report.mediaFiles.push(...(media.get(k) ?? []))
    firsts.push(Math.min(...step.touched))
  }

  // [SP_CTX_02_61] Detach, after every other step: the row before a dropped
  // host row comes back without its handle, so the host leaves out every host
  // row after it; a row an earlier step rebuilt or removed took them already.
  const hostLines: string[] = []
  const hostNamed = new Set<string>()
  const detached = new Set<string>()
  const records = options.hostRows ?? []
  for (const edit of hostDrops) {
    const name = describeEdit(edit)
    const rec = hostRecord(records, edit.host)
    if (!rec) {
      report.failed.push(`${name}: no such host row now`)
      continue
    }
    const inAt = input.findIndex(r => r.handle === rec.after)
    if (inAt < 0) {
      report.failed.push(`${name}: no such row now`)
      // named here: the line on rows that went with rebuilt rows leaves it out
      hostNamed.add(rec.id)
      continue
    }
    if (detached.has(rec.after)) {
      report.applied.push(name)
      continue
    }
    const at = rows.findIndex(r => r.handle === rec.after)
    if (at < 0) {
      report.applied.push(name)
      hostNamed.add(rec.id)
      hostLines.push(`${rec.id} went with the rows your edits replaced.`)
      continue
    }
    const before = input[inAt]!
    const results = resultsOf(before)
    const known = options.knownResults
    const prompt = isPlainUserRow(before)
    // the checks of a collapse: without its handle the row's media would be lost
    if (
      results.some(t => mediaOwners.has(ownerKey({ tool_use_id: t.tool_use_id }))) ||
      mediaOwners.has(ownerKey({ row: inAt })) ||
      (prompt && (options.unmatchedPromptMedia ?? 0) > 0)
    ) {
      report.failed.push(`${name}: ${HOST_MEDIA(rec.id)}`)
      continue
    }
    const firstKnown = known ? rows.findIndex(r => resultsOf(r).some(t => known.has(t.tool_use_id))) : -1
    if ((known && results.some(t => !known.has(t.tool_use_id))) || (prompt && !!options.apiTruncated && (firstKnown < 0 || at < firstKnown))) {
      report.failed.push(`${name}: outside the API window; media unknown`)
      continue
    }
    const row = rows[at]!
    rows[at] = results.length ? plain(row, { toolResults: results.map(t => ({ ...stripResult(t), text: toolRefText(t, options.toolRefs) })) }) : plain(row, {})
    detached.add(rec.after)
    const after = records.filter(r => r.after === rec.after)
    report.originals.push({ edit: name, rows: after.map(r => ({ role: 'user' as const, text: r.text, toolUses: [] })) })
    report.applied.push(name)
    hostLines.push(`dropped host row ${rec.id} (${rec.kind}, ${rec.chars} chars)`)
    for (const r of after) {
      hostNamed.add(r.id)
      if (r !== rec) hostLines.push(`${r.id} (${r.kind}) went with it: the host keeps them after the same row`)
    }
    const detach = detachNote(rec)
    if (detach) hostLines.push(`${rec.id}: ${detach}`)
    firsts.push(inAt)
  }
  if (hostLines.length) report.hostLines = hostLines

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
    return plain(r, { toolResults: results.map(t => ({ ...stripResult(t), text: toolRefText(t, options.toolRefs) })) })
  })
  const out = mergeCallRows(
    rebuildSplitResponses(relinked, frozen).filter(r => frozen.has(r) || r.handle !== undefined || !isEmptyRow(r)),
    frozen,
  )
  report.charsAfter = totalChars(out)
  report.produced = producedRows(out, made)
  return { rows: out, report, made, renamed, prefix, hostNamed, ...(stateOut ? { state: stateOut } : {}) }
}

// [SP_CTX_02_67] run state: every state edit of the batch together, one
// rebuild of the slot row (stamped by ScreenPinned) from the items with all
// their changes; a slot not found (STATE_GONE) or a change naming an id that
// is not there (NO_ITEM_NOW) fails every state edit, items unchanged. The
// step, or undefined when they failed; `done` receives the items once it runs.
function runState(
  rows: SessionMessage[],
  edits: readonly Extract<QueuedEdit, { op: 'state' }>[],
  note: string,
  input: StateInput | undefined,
  report: ApplyReport,
  made: Made[],
  done: (out: StateOutput) => void,
): { edit: QueuedEdit; names: string[]; touched: number[]; hi: number; owners: string[]; run: () => void } | undefined {
  const names = edits.map(describeEdit)
  const fail = (why: string) => void report.failed.push(...names.map(n => `${n}: ${why}`))
  const first = edits[0]!
  const at = first.index !== undefined && first.anchors?.[0] ? locate(rows, first.anchors[0], first.index) : -1
  if (at < 0 || !rows[at]) return fail(STATE_GONE)
  const base = input ?? { items: [], nextItem: 1, turn: 0 }
  const out = applyChanges(base.items, base.nextItem, base.turn, edits.flatMap(e => e.changes))
  if ('missing' in out) return fail(NO_ITEM_NOW(out.missing))
  // a queue changed outside the tools: more items would make the registry unreadable
  if (out.items.length > MAX_STATE_ITEMS) return fail(TOO_MANY_ITEMS)
  const text = stateText(note, out.items)
  if (text.length > MAX_TEXT) return fail(SLOT_TOO_LONG(MAX_TEXT - ARCHIVE_ROOM - STATE_HEAD))
  return {
    edit: first,
    names,
    touched: [at],
    hi: at,
    owners: [],
    run: () => {
      const row = rows[at]!
      report.originals.push({ edit: names[0]!, rows: [row] })
      rows[at] = plain(row, { text })
      made.push({ edit: names[0]!, text })
      done(out)
    },
  }
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
// `message[i]`: the index in `api` of the assistant message that holds the
// assistant row rows[i] (by a call id, else by its text), undefined for
// another row or none; CacheShape reads the API form's tail from it
// ([SP_CTX_02_38]).
export type Responses = { start: readonly number[]; known: readonly boolean[]; floor: readonly number[]; message: readonly (number | undefined)[] }

export function responses(rows: readonly SessionMessage[], api: readonly unknown[] = []): Responses {
  // by the message's index in `api`: only its identity groups rows, and
  // CacheShape reads the form's tail from it
  const byId = new Map<string, number>()
  const byText = new Map<string, number>()
  api.forEach((msg, n) => {
    if ((msg as { role?: unknown } | null)?.role !== 'assistant') return
    for (const b of apiBlocks(msg)) {
      if (b.type === 'tool_use' && typeof b.id === 'string') byId.set(b.id, n)
      if (b.type === 'text' && typeof b.text === 'string') {
        const t = squash(b.text)
        if (t) byText.set(t, n)
      }
    }
  })
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
  return { start, known, floor, message }
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
  // [SP_CTX_01_05] a describe drops the prompt's host attachments
  if (r.applied.some(a => a.startsWith('describe '))) parts.push(DESCRIBE_DROPS)
  // [SP_CTX_01_05] P13: the agent's own context_* calls left the conversation
  // when the returned list replaces it (a compaction with an applied edit; a seed always)
  if ((r.ownCallsRemoved ?? 0) > 0 && (kind === 'seed' || r.applied.length)) parts.push(ownCallsText(r.ownCallsRemoved, r.applied.length > 0))
  // [SP_CTX_01_05] [SP_CTX_02_36] the host's deliveries, when the list replaces the conversation
  if (r.deliveries && (kind === 'seed' || r.applied.length)) parts.push(deliveriesText(r.deliveries))
  // [SP_CTX_02_61] the host rows, when the list replaces the conversation
  if (r.hostLines?.length && (kind === 'seed' || r.applied.length)) parts.push(r.hostLines.map(l => (/[.:]$/.test(l) ? l : `${l}.`)).join(' '))
  // [SP_CTX_01_05] [SP_CTX_02_45] last: the originals a resume loaded twice, when the list replaces the conversation
  if ((r.pulledDropped ?? 0) > 0 && r.applied.length) parts.push(pulledWords(r.pulledDropped!))
  const text = parts.filter(Boolean).join(' ')
  return !text || parts[0] ? text : modText(text)
}

// [SP_CTX_01_05] [SP_CTX_DEC_17] (A″) The report's sentence on the agent's
// own context_* calls DropOwnCalls removed. It counts every own pair
// (context_list, context_note, context_tag, context_edit); when an edit
// applied, the calls that queued the replacements are among them (a
// context_edit, or the context_tag of a disposable tag).
export function ownCallsText(n: number, replaced: boolean): string {
  return replaced
    ? `Your context_* calls (${n}), including the ones that queued these replacements, were removed from the conversation; tags and notes stay — see context_list.`
    : `Your context_* calls (${n}) were removed from the conversation; tags and notes stay — see context_list.`
}

// [SP_CTX_02_43] ApplyLine: the person's line after an apply ($.ui.log; the
// model never sees it): the conversation's size before and after, then what
// was freed. The report's estimate: Estimate's rounding (chars / ratio) by the
// registry's calibrated ratio, PLAIN_RATIO and "approx." without one.
// `apiChars` (phase 29): the chars of the API form the handler read, the
// host's attachments included as in the calibration's numerator; the size
// before is then those, the size after them less the chars freed; absent:
// by the rows, as before phase 29. "" without an applied edit.
export function applyLine(r: Pick<ApplyReport, 'applied' | 'failed' | 'charsBefore' | 'charsAfter'>, ratio?: number, apiChars?: number): string {
  if (!r.applied.length) return ''
  const per = ratio || PLAIN_RATIO
  const tokens = (chars: number) => Math.max(0, Math.round(chars / per))
  const freed = tokens(r.charsBefore - r.charsAfter)
  const before = apiChars ?? r.charsBefore
  const after = before - (r.charsBefore - r.charsAfter)
  const approx = ratio ? '' : 'approx.'
  const head = `applied ${r.applied.length} edit(s)${r.failed.length ? `, ${r.failed.length} not applied` : ''}`
  const notes = [approx, freed > 0 ? `freed ~${kilo(freed)}` : ''].filter(Boolean).join('; ')
  return `${head}: conversation ~${kilo(tokens(before))} → ~${kilo(tokens(after))} tokens${notes ? ` (${notes})` : ''}`
}

// A token count for the person's line: 950, 4.2k, 41k.
export function kilo(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(n / 1000)}k`
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
