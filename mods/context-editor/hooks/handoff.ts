import type { SessionMessage } from 'claude-code'
import { pruneAliases, type AliasRegistry } from './aliases'
import { archiveText, HANDOFF_MARKER, mediaExt, screenPinned, type CompactionOutcome } from './compaction'
import {
  applyEdits,
  boundaryAt,
  boundaryOf,
  collectMedia,
  describeEdit,
  dropOwnCalls,
  fingerprint,
  formatReport,
  HEAD_ROWS,
  MARK,
  mergeCallRows,
  MAX_TEXT,
  ownerKey,
  producedRows,
  rebuild,
  replacedOwners,
  ROW_WINDOW,
  totalChars,
  touchedBy,
  type ApplyReport,
  type Boundary,
  type MediaRef,
  type QueuedEdit,
} from './edits'
import { DEFAULT_RESUME, MAX_DOCUMENT, SUMMARY_OPENER, type HandoffRequest, type Queue, type Read } from './queue'
import { rebindNotes } from './notes'
import { relocateStageMarks } from './stages'
import { dropLastApply, EMPTY_REGISTRY, MAX_TAGS, rebindTags, type Tag, type TagRegistry } from './tags'
import { movedSince, type Turns } from './turns'

export { ROW_WINDOW }

// [SP_CTX_01_12]
export const HANDOFF_DELAY_MS = 1_000
export const HANDOFF_STALE_MS = 120_000
export const HANDOFF_PROMPT =
  "Write a handoff document for a fresh session that continues this work: the person's task and constraints verbatim, decisions in force, facts, numbers, paths and sources still needed, open questions and the next step. Do not call any tools: answer with the document text only. Plain text, no preamble."
export const SEED_ROOM = 16
export const SEED_PROBE = 80
export const SEED_WAIT_MS = 2_000
export const SEED_POLL_MS = 100
export { SUMMARY_OPENER }
export const TRANSCRIPT_LINE = 'read the full transcript at:'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function withReport(q: Queue, text: string, now: number): Queue {
  return { ...q, report: q.report ? `${q.report}\n${text}` : text, reportId: now, reportResume: false }
}

// ---- [SP_CTX_01_15] the request and the module's memory of it

// [SP_CTX_01_17] The seed of a new session, held in module memory from
// BuildSeed to the end of RunHandoff; one at a time.
export type HandoffSeed = {
  old: string
  id: number
  rows: SessionMessage[]
  file: string
  archive: string
  report: ApplyReport
  // the rows BuildSeed applied the edits to (with the old session's handles;
  // memory only): "before" for RebindTags in the registry step
  visible: readonly SessionMessage[]
  // the batch BuildSeed took, before the pin check: "the batch" for
  // RebindTags; the applied ones are those whose label is in report.applied
  edits: readonly QueuedEdit[]
  fromSummary: boolean
  unmatchedPromptMedia: number
  // [SP_CTX_01_17] the results whose text CarryNote extended: their rows are
  // "changed by the seed" although their fingerprint stays ([SP_CTX_02_14])
  carried: string[]
  // [SP_CTX_02_34] TagRegistry.charsPerToken of the old session, for the report's estimate
  ratio?: number
  new?: string
  taken: boolean
}

// [SP_CTX_01_15] Module memory; a reload starts it over (`requestTurn` lost).
export type HandoffMemory = {
  // RunHandoff of this instance runs, from its first step to its return or throw
  inFlight: boolean
  // a RunHandoff is planned after HANDOFF_DELAY and has not begun
  scheduled: boolean
  // `turns` when context_handoff queued the request
  requestTurn?: number
  // this instance's mark for `owner`
  instance: string
  // the seed HandleSeed hands out
  pending?: HandoffSeed
}

export function newHandoffMemory(instance: string): HandoffMemory {
  return { inFlight: false, scheduled: false, instance }
}

export function isStale(h: HandoffRequest, now: number): boolean {
  return h.state === 'running' && now - h.at > HANDOFF_STALE_MS
}

function dueIgnoringFlight(q: Queue | undefined, now: number): boolean {
  return !!q?.handoff && (q.handoff.state === 'queued' || isStale(q.handoff, now))
}

// [SP_CTX_01_15] Due(q): the request should run. Never while this instance
// runs it, however old it is; `owner` is not read.
export function handoffDue(q: Queue | undefined, mem: Pick<HandoffMemory, 'inFlight'>, now: number): boolean {
  return !mem.inFlight && dueIgnoringFlight(q, now)
}

export type HandoffArgs = { agentId?: string; mode?: unknown; document?: unknown; resume?: unknown; resume_prompt?: unknown }

// [SP_CTX_02_19] Errors.
export type HandoffDeny = 'DENIED_SUBAGENT' | 'DENIED_STORAGE' | 'DENIED_BAD_MODE' | 'DENIED_TOO_LONG' | 'DENIED_RUNNING' | 'DENIED_QUEUE'

// [SP_CTX_02_19] The queue with a new request, or why it is refused. A queued
// request is replaced; a running one is not while it is in flight here or not
// yet stale. Pure.
export function queueHandoff(
  q: Queue,
  args: HandoffArgs,
  by: HandoffRequest['by'],
  now: number,
  inFlight = false,
): { queue: Queue; mode: HandoffRequest['mode'] } | { deny: string; code: HandoffDeny } {
  if (args.agentId) return { code: 'DENIED_SUBAGENT', deny: 'only the main conversation can be handed off.' }
  const mode = args.mode === undefined ? 'transcript' : args.mode
  if (mode !== 'transcript' && mode !== 'document') return { code: 'DENIED_BAD_MODE', deny: 'mode must be "transcript" or "document".' }
  if (args.document !== undefined && (typeof args.document !== 'string' || args.document.length > MAX_DOCUMENT))
    return { code: 'DENIED_TOO_LONG', deny: `document must be a string of at most ${MAX_DOCUMENT} chars.` }
  if (args.resume_prompt !== undefined && (typeof args.resume_prompt !== 'string' || args.resume_prompt.length > MAX_TEXT))
    return { code: 'DENIED_TOO_LONG', deny: `resume_prompt must be a string of at most ${MAX_TEXT} chars.` }
  if (inFlight || (q.handoff?.state === 'running' && !isStale(q.handoff, now)))
    return { code: 'DENIED_RUNNING', deny: 'a handoff is already running; wait for it to end.' }
  const document = typeof args.document === 'string' && args.document.trim() ? args.document : undefined
  const prompt = typeof args.resume_prompt === 'string' && args.resume_prompt.trim() ? args.resume_prompt : DEFAULT_RESUME
  const handoff: HandoffRequest = { mode, ...(document ? { document } : {}), resume: args.resume !== false, resumePrompt: prompt, by, state: 'queued', at: now }
  return { queue: { ...q, handoff }, mode }
}

// [SP_CTX_04_04] The queue once the request was cancelled (the person) or the
// turn the agent asked in was interrupted: a queued request goes, so does a
// running one this instance does not run; one in flight here stays.
export function cancelHandoff(q: Queue, why: string, now: number, inFlight = false): Queue {
  if (!q.handoff || (q.handoff.state === 'running' && inFlight)) return q
  return { ...withReport(q, `context-editor: handoff cancelled (${why}).`, now), handoff: undefined }
}

// ---- [SP_CTX_02_22] BuildSeed

export type SeedRefusal = 'WINDOW_FULL' | 'NO_SUMMARY' | 'SUMMARY_NOT_FOUND' | 'HIDDEN_AFTER_SUMMARY' | 'MEDIA_NOT_ARCHIVED' | 'EMPTY' | 'SEED_TOO_LONG'

export type BuiltSeed = {
  rows: SessionMessage[]
  report: ApplyReport
  // the rows passed to ApplyEdits
  visible: readonly SessionMessage[]
  fromSummary: boolean
  unmatchedPromptMedia: number
  // archived paths by owner key, for the archive's JSON ([SP_CTX_01_06])
  media: Map<string, string[]>
  // the results that got CarryNote
  carried: string[]
}

export type SeedInput = {
  transcript: readonly SessionMessage[]
  // CurrentRows: a suffix of `transcript`
  rows: readonly SessionMessage[]
  api: readonly unknown[]
  edits: readonly QueuedEdit[]
  tags: Read<TagRegistry>
  folder: string
  archive: string
  writeMedia: (path: string, base64: string) => Promise<boolean>
}

const REMINDER = '<system-reminder>'
const WINDOW_FULL = `the conversation fills the host's ${ROW_WINDOW}-row window; its start may be cut`

function stripped(s: string): string {
  return s.replace(/\s+/g, '')
}

function results(r: SessionMessage) {
  return r.toolResults ?? []
}

// [SP_CTX_02_22] The first message of the API form: its role, whether it holds
// a tool_result, and its text blocks other than reminders, joined. Content
// given as a string is one text block.
function firstApiMessage(msg: unknown): { role: unknown; hasResult: boolean; text: string } {
  const m = (msg ?? {}) as { role?: unknown; content?: unknown }
  const blocks = (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : []) as { type?: unknown; text?: unknown }[]
  const texts = blocks.flatMap(b => (b.type === 'text' && typeof b.text === 'string' && !b.text.trim().startsWith(REMINDER) ? [b.text] : []))
  return { role: m.role, hasResult: blocks.some(b => b.type === 'tool_result'), text: texts.join('\n\n') }
}

// [SP_CTX_02_22] CarryNote: the media of an untouched pair, as files.
export function carryNote(refs: readonly MediaRef[], paths: readonly (string | undefined)[]): string {
  const items = refs.map((ref, k) => (paths[k] ? `${ref.mediaType} ${paths[k]}` : `${ref.mediaType} (not carried: no inline data)`))
  return `${MARK} media carried as files (open them with Read): ${items.join(', ')}`
}

function isBlank(r: SessionMessage): boolean {
  return !r.text.trim() && r.toolUses.length === 0 && results(r).length === 0
}

// [SP_CTX_02_22] Until nothing changes: no leading assistant rows, no result
// without an earlier call, no call without a later result, no empty row.
function normalize(seed: SessionMessage[]): SessionMessage[] {
  let rows = seed
  for (let changed = true; changed; ) {
    changed = false
    while (rows[0]?.role === 'assistant') {
      rows = rows.slice(1)
      changed = true
    }
    const calls = new Set<string>()
    rows = rows.map(r => {
      const kept = results(r).filter(t => calls.has(t.tool_use_id))
      for (const u of r.toolUses) calls.add(u.tool_use_id)
      if (kept.length === results(r).length) return r
      changed = true
      return { ...r, toolResults: kept }
    })
    const answered = new Set<string>()
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!
      const kept = r.toolUses.filter(u => answered.has(u.tool_use_id))
      for (const t of results(r)) answered.add(t.tool_use_id)
      if (kept.length !== r.toolUses.length) {
        rows[i] = { ...r, toolUses: kept }
        changed = true
      }
    }
    const before = rows.length
    rows = rows.filter(r => !isBlank(r))
    if (rows.length !== before) changed = true
  }
  return rows
}

// [SP_CTX_02_22] The rows of the new session from what the model sees and
// the queued edits. Pure but for writing media files through `writeMedia`.
export async function buildSeed(input: SeedInput): Promise<BuiltSeed | { refuse: SeedRefusal; reason: string }> {
  const { transcript, rows, api } = input
  const { found, knownResults, unmatchedPromptMedia, apiTruncated } = collectMedia(api)
  const hidden =
    rows.some(r => results(r).some(t => !knownResults.has(t.tool_use_id))) ||
    rows.some((r, i) => i > 0 && r.role === 'user' && r.text.trim().startsWith(SUMMARY_OPENER))
  const early: string[] = []
  let edits = [...input.edits]
  let head: SessionMessage | undefined
  let visible: readonly SessionMessage[]
  if (!hidden) {
    // the model sees every row; a full window without a boundary may be cut
    if (rows.length === transcript.length && transcript.length >= ROW_WINDOW) return { refuse: 'WINDOW_FULL', reason: WINDOW_FULL }
    visible = rows
  } else {
    // after a built-in compaction whose boundary this process did not record;
    // a result may have left a read window, not the model's view
    if (apiTruncated || transcript.length >= ROW_WINDOW) return { refuse: 'WINDOW_FULL', reason: WINDOW_FULL }
    const first = firstApiMessage(api[0])
    if (first.role !== 'user' || first.hasResult || !first.text.trim().startsWith(SUMMARY_OPENER))
      return { refuse: 'NO_SUMMARY', reason: 'the model does not see every row, and what it sees does not start with a compaction summary' }
    // [SP_CTX_DEC_08] the last prompt row whose text, whitespace aside, starts as the summary does
    const want = stripped(first.text).slice(0, 160)
    let s = -1
    for (let i = rows.length - 1; i >= 0 && s < 0; i--) {
      const r = rows[i]!
      if (r.role === 'user' && !results(r).length && stripped(r.text).startsWith(want)) s = i
    }
    if (s < 0) return { refuse: 'SUMMARY_NOT_FOUND', reason: 'the summary the model sees was not found among the rows' }
    visible = rows.slice(s + 1)
    if (visible.some(r => results(r).some(t => !knownResults.has(t.tool_use_id))))
      return { refuse: 'HIDDEN_AFTER_SUMMARY', reason: 'rows the model does not see follow the summary' }
    head = { role: 'user', text: first.text, toolUses: [] }
    edits = edits.filter(e => {
      if (!touchedBy(rows, e) || touchedBy(visible, e)) return true
      early.push(`${describeEdit(e)}: the model no longer sees this row`)
      return false
    })
  }
  const screened = screenPinned(visible, edits, input.tags)

  // every medium on its own: a medium without inline data is named, not carried
  let n = 0
  const items = new Map<string, (string | undefined)[]>()
  for (const [key, refs] of found) {
    const paths: (string | undefined)[] = []
    items.set(key, paths)
    for (const ref of refs) {
      if (!ref.data) {
        paths.push(undefined)
        continue
      }
      n += 1
      const path = `${input.folder}/${n}.${mediaExt(ref.mediaType)}`
      if (!(await input.writeMedia(path, ref.data))) return { refuse: 'MEDIA_NOT_ARCHIVED', reason: `media of ${key.slice(2)} could not be archived` }
      paths.push(path)
    }
  }
  const media = new Map<string, string[]>()
  for (const [key, paths] of items) {
    const present = paths.filter((p): p is string => p !== undefined)
    if (present.length) media.set(key, present)
  }

  // every medium already lies in a file and no seeded row keeps a handle,
  // so ApplyEdits needs no media owners
  const applied = applyEdits(visible, screened.edits, input.archive, media, new Set(), { knownResults, unmatchedPromptMedia, apiTruncated })
  const report = applied.report
  report.failed = [...early, ...screened.refused, ...report.failed]
  const names = new Set(report.applied)
  const replaced = replacedOwners(visible, screened.edits.filter(e => names.has(describeEdit(e))))
  const kept = dropOwnCalls(applied.rows, new Set(), knownResults)
  // [SP_CTX_01_05] "freed" counts the edits only: before CarryNote and the head
  report.charsAfter = totalChars(kept)
  const carried: string[] = []
  let seed = kept.map(r => {
    const carries = results(r).some(t => found.has(ownerKey({ tool_use_id: t.tool_use_id })) && !replaced.has(ownerKey({ tool_use_id: t.tool_use_id })))
    if (!carries) return rebuild(r)
    return {
      ...rebuild(r),
      toolResults: results(r).map(t => {
        const key = ownerKey({ tool_use_id: t.tool_use_id })
        const refs = found.get(key)
        if (!refs || replaced.has(key)) return { tool_use_id: t.tool_use_id, text: t.text, isError: t.isError }
        carried.push(t.tool_use_id)
        return { tool_use_id: t.tool_use_id, isError: t.isError, text: `${t.text}${t.text.trim() ? '\n\n' : ''}${carryNote(refs, items.get(key) ?? [])}` }
      }),
    }
  })
  if (head) seed = [head, ...seed]
  const top = seed[0]
  if (top?.role === 'user' && top.text.split('\n').some(l => l.includes(TRANSCRIPT_LINE)))
    seed[0] = { ...top, text: top.text.split('\n').filter(l => !l.includes(TRANSCRIPT_LINE)).join('\n').trim() }
  // [SP_CTX_02_04] every seeded row is without handle: parallel calls of one
  // response, written as separate rows, become one row with their calls
  seed = mergeCallRows(normalize(seed))
  if (!seed.length) return { refuse: 'EMPTY', reason: 'no rows to carry over' }
  // [SP_CTX_01_05] the made rows in the seeded list: after the head and normalizing
  report.produced = producedRows(seed, applied.made)
  if (seed.length > ROW_WINDOW - SEED_ROOM)
    return { refuse: 'SEED_TOO_LONG', reason: `the seed has ${seed.length} rows; at most ${ROW_WINDOW - SEED_ROOM} fit the new session's read window` }
  report.mediaFiles = [...items.values()].flatMap(paths => paths.filter((p): p is string => p !== undefined))
  // [SP_CTX_01_17] a summary head from the API form, or CurrentRows that already
  // start with the summary row (a resumed session after /compact)
  const fromSummary = head !== undefined || seed[0]!.text.trim().startsWith(SUMMARY_OPENER)
  const seededIds = new Set(seed.flatMap(r => results(r).map(t => t.tool_use_id)))
  return { rows: seed, report, visible, fromSummary, unmatchedPromptMedia, media, carried: carried.filter(id => seededIds.has(id)) }
}

// ---- [SP_CTX_02_23] CheckSeed

// [SP_CTX_02_23] The first broken rule as the reason, or undefined. Rows of
// one role in a row are fine: the seed keeps the shape the host hands out. Pure.
export function checkSeed(rows: readonly SessionMessage[]): string | undefined {
  if (!rows.length) return 'no rows to carry over'
  if (rows[0]!.role !== 'user') return "the first row is not the person's"
  const calls = new Set<string>()
  const answers = new Set<string>()
  for (const [i, r] of rows.entries()) {
    if (r.handle !== undefined) return `row ${i}: holds a handle`
    if (isBlank(r)) return `row ${i}: empty`
    if (r.role === 'user' && r.toolUses.length) return `row ${i}: tool_use in a user row`
    if (r.role === 'assistant' && results(r).length) return `row ${i}: tool_result in an assistant row`
    for (const u of r.toolUses) {
      if (calls.has(u.tool_use_id)) return `row ${i}: repeated call id ${u.tool_use_id}`
      calls.add(u.tool_use_id)
    }
    for (const t of results(r)) {
      if (answers.has(t.tool_use_id)) return `row ${i}: repeated result id ${t.tool_use_id}`
      answers.add(t.tool_use_id)
    }
    // its result, in a later row, before any prompt row (a user row without results)
    for (const u of r.toolUses) {
      let ok = false
      for (const later of rows.slice(i + 1)) {
        if (results(later).some(t => t.tool_use_id === u.tool_use_id)) {
          ok = true
          break
        }
        if (later.role === 'user' && !results(later).length) break
      }
      if (!ok) return `row ${i}: call ${u.tool_use_id} has no result before the next prompt`
    }
    for (const t of results(r)) {
      if (!rows.slice(0, i).some(e => e.toolUses.some(u => u.tool_use_id === t.tool_use_id))) return `row ${i}: result ${t.tool_use_id} answers no call`
    }
  }
  return undefined
}

// ---- [SP_CTX_02_24] CheckSeeded

// [SP_CTX_02_24] Whether the host holds the seeded conversation: the reason
// it does not, or undefined. `read` is the whole transcript read after the
// seed compaction. Pure.
export function checkSeeded(seed: readonly SessionMessage[], read: readonly SessionMessage[], old: string, now: string): string | undefined {
  if (now === old) return 'the session id did not change'
  const p = boundaryAt(read, seed.slice(0, HEAD_ROWS).map(fingerprint), seed.length)
  if (p === undefined) return 'the seeded rows were not found'
  const probe = seed[0]?.text.slice(0, SEED_PROBE) ?? ''
  if (probe && !read[p]!.text.includes(probe)) return 'the first row after the boundary is not the seeded one'
  const calls = new Set(read.slice(p).flatMap(r => r.toolUses.map(u => u.tool_use_id)))
  for (const r of seed) for (const u of r.toolUses) if (!calls.has(u.tool_use_id)) return `seeded call ${u.tool_use_id} is missing`
  return undefined
}

// [SP_CTX_02_24] AwaitSeeded: in stream-json the seed compaction's command
// returns before its rows are readable (~50 ms), so CheckSeeded is polled
// until it passes or SEED_WAIT runs out; the last reason stands.
export async function awaitSeeded(
  io: { now: () => number; sleep: (ms: number) => Promise<void>; view: () => Promise<{ transcript: readonly SessionMessage[] }> },
  seed: readonly SessionMessage[],
  old: string,
  now: string,
): Promise<string | undefined> {
  const deadline = io.now() + SEED_WAIT_MS
  for (;;) {
    const why = checkSeeded(seed, (await io.view()).transcript, old, now)
    if (!why || io.now() >= deadline) return why
    await io.sleep(SEED_POLL_MS)
  }
}

// ---- [SP_CTX_02_26] HandleSeed

export type SeedIO = {
  sessionId: () => Promise<string>
  // [SP_CTX_02_18] RecordBoundary in the storage of the current session, which
  // then is this instance's own boundary; best effort
  recordBoundary: (b: Boundary) => Promise<void>
  // [SP_CTX_01_14] hostId if its read has ended, else absent; never waits
  hostId: () => string | undefined
}

// [SP_CTX_02_26] The seed branch of the compaction handler: the seeded rows
// in place of the cleared session's. Reads and writes no queue.
export async function handleSeed(io: SeedIO, mem: HandoffMemory, messages: readonly SessionMessage[]): Promise<CompactionOutcome> {
  const s = mem.pending
  if (!s) return { skip: 'context-editor: no handoff seed waiting' }
  // the mod writes into no session it did not create, the old one included
  if ((await io.sessionId()) !== s.new) return { skip: 'context-editor: this is not the session the handoff created' }
  if (messages.some(r => r.role === 'assistant')) return { skip: 'context-editor: the new session already has a turn' }
  s.taken = true
  // the seed runs in this process: the boundary carries its host when known
  const b = boundaryOf(s.rows, io.hostId())
  if (b) await io.recordBoundary(b).catch(() => undefined)
  return { messages: s.rows.map(r => ({ ...r })) }
}

// ---- [SP_CTX_02_21] PinSummary

// [SP_CTX_02_21] The new session's registry with a pin on the summary row,
// or the note why there is none. Pure.
export function pinSummary(read: Read<TagRegistry>, row: SessionMessage): { registry: TagRegistry } | { note: string } {
  if (read.state === 'unreadable') return { note: ' The summary row was not pinned: the tag registry is unreadable.' }
  const reg = read.state === 'missing' ? { ...EMPTY_REGISTRY, tags: [] } : read.value
  const anchor = fingerprint(row)
  const at = reg.tags.findIndex(t => 'anchor' in t.target && t.target.anchor === anchor)
  if (at < 0 && reg.tags.length >= MAX_TAGS) return { note: ' The summary row was not pinned: the tag registry is full.' }
  const tag: Tag = { kind: 'pin', target: { anchor, hint: 0 }, created_turn: reg.turn }
  const tags = at >= 0 ? reg.tags.map((t, i) => (i === at ? tag : t)) : [...reg.tags, tag]
  return { registry: { ...reg, tags, firstPromptPinned: true } }
}

// ---- [SP_CTX_02_21] RunHandoff

// What the handoff needs from the host; register.ts binds it to `$`. Queue
// and registry changes run on their serial chains; none is held across a
// host command or a prompt ([SP_CTX_DEC_04]).
export type HandoffIO = {
  now: () => number
  turns: Readonly<Turns>
  // a deferred action, from the hook that called (turn.complete, /handoff)
  after: (ms: number, fn: () => void) => void
  // a wait inside a run (AwaitSeeded's polls)
  sleep: (ms: number) => Promise<void>
  sessionId: () => Promise<string>
  // [SP_CTX_02_15] the storage of the current session, prepared for it
  storage: () => Promise<{ dir: string } | { reason: string }>
  readQueue: (dir: string) => Promise<Read<Queue>>
  // a read-modify-write of the queue in `dir`: `change` gets the queue as it
  // is then; undefined writes nothing; a failed write rejects
  updateQueue: (dir: string, change: (read: Read<Queue>) => Queue | undefined | Promise<Queue | undefined>) => Promise<void>
  // [SP_CTX_02_18] the whole transcript and CurrentRows, a suffix of it
  view: () => Promise<{ transcript: readonly SessionMessage[]; rows: readonly SessionMessage[] }>
  readApi: () => Promise<readonly unknown[]>
  readTags: () => Promise<Read<TagRegistry>>
  // the same for the tag registry in `dir`
  updateTagsAt: (dir: string, change: (read: Read<TagRegistry>) => TagRegistry | undefined) => Promise<void>
  // ids of the folders `<dir>/<id>` that hold a seed.json
  listSeeds: (dir: string) => Promise<number[]>
  writeMedia: (path: string, base64: string) => Promise<boolean>
  // owner-only, through a host command (no 4 MiB limit), parents made
  writeText: (path: string, text: string) => Promise<boolean>
  remove: (path: string) => Promise<void>
  // [SP_CTX_02_21] one registry into the new session, on its serial chain:
  // read in `fromDir`, changed, written into `toDir` (owner-only). 'missing'
  // when `fromDir` has none (nothing written); an unreadable registry, a
  // throw of `change` or a failed write rejects, and nothing is written.
  carryTags: (fromDir: string, toDir: string, change: (reg: TagRegistry) => TagRegistry) => Promise<'missing' | 'carried'>
  carryAliases: (fromDir: string, toDir: string, change: (reg: AliasRegistry) => AliasRegistry) => Promise<'missing' | 'carried'>
  // a built-in command, one attempt; a refusal rejects with the host's text
  runCommand: (command: 'clear' | 'compact', args?: string) => Promise<void>
  // a model request over the session without tools; undefined when unanswered
  fork: (prompt: string) => Promise<string | undefined>
  // a refused prompt (an exception or a result with `drop`) rejects
  submit: (text: string) => Promise<void>
  toast: (text: string) => void
  status: (text?: string) => void
}

export type HandoffOutcome = 'deferred' | 'nothing' | 'failed' | 'transcript' | 'document'

type Run = {
  io: HandoffIO
  mem: HandoffMemory
  turns0: number
  old: string
  oldDir: string
  q: Queue
  h: HandoffRequest
  // /clear has made a new session
  cleared: boolean
  turnsClear: number
  afterClearEntered: boolean
  // SESSION_CHANGED: after the seed compaction the session is not the one /clear made
  sessionChanged: boolean
  // a write of HandedOff, Fail or FailAfterClear succeeded
  terminal: boolean
  seed?: HandoffSeed
  reasons: string[]
  // HandedOff, Fail and FailAfterClear: at most one attempt each per run
  writes: Map<string, { error?: unknown }>
}

function moved(run: Run): boolean {
  return movedSince(run.io.turns, run.turns0)
}

function dropped(run: Run): string {
  return run.q.edits.length ? ` The ${run.q.edits.length} queued edit(s) were not carried over.` : ''
}

async function updateOld(run: Run, change: (q: Queue) => Queue): Promise<void> {
  await run.io.updateQueue(run.oldDir, read => {
    if (read.state === 'unreadable') throw new Error(`the queue of ${run.old} cannot be read (${read.reason})`)
    return change(read.value)
  })
}

// One attempt per run: a second call repeats the first one's failure
// without writing again.
async function once(run: Run, name: string, write: () => Promise<void>): Promise<void> {
  const prior = run.writes.get(name)
  if (prior) {
    if ('error' in prior) throw prior.error
    return
  }
  try {
    await write()
  } catch (err) {
    run.writes.set(name, { error: err })
    throw err
  }
  run.writes.set(name, {})
  run.terminal = true
}

// [SP_CTX_02_21] HandedOff: the old queue no longer holds the request.
function handedOff(run: Run, to: string, mode: HandoffRequest['mode']): Promise<void> {
  return once(run, 'HandedOff', () =>
    updateOld(run, q => ({ ...withReport(q, `context-editor: this session was handed off to ${to} (${mode}).`, run.io.now()), edits: [], handoff: undefined })),
  )
}

// [SP_CTX_02_21] Fail: before /clear; the old session as it was, its edits kept.
async function fail(run: Run, reasons: string[]): Promise<void> {
  const text = `context-editor: handoff failed: ${reasons.join('; ')}; the session was not changed.`
  await once(run, 'Fail', () => updateOld(run, q => ({ ...withReport(q, text, run.io.now()), handoff: undefined })))
  run.io.toast(text.slice(0, 200))
}

// [SP_CTX_02_21] FailAfterClear: after /clear; the old session unchanged.
async function failAfterClear(run: Run, s: HandoffSeed | undefined, reasons: string[]): Promise<void> {
  const text = `context-editor: handoff failed after the session was cleared: ${reasons.join('; ')}; this session was not changed${s ? `; the assembled conversation is in ${s.file}` : ''}.`
  await once(run, 'FailAfterClear', () => updateOld(run, q => ({ ...withReport(q, text, run.io.now()), handoff: undefined })))
  run.io.toast(text.slice(0, 200))
}

// [SP_CTX_02_21] Defer: queued again, for the next end of a turn.
function defer(run: Run): Promise<void> {
  return updateOld(run, q => {
    if (!q.handoff) return q
    const { owner: _owner, ...h } = q.handoff
    return { ...q, handoff: { ...h, state: 'queued' } }
  })
}

function notice(run: Run, s: HandoffSeed | undefined, reasons: string[]): string {
  return `context-editor: the handoff from ${run.old} failed after the session was cleared (${reasons.join('; ')}). The previous session ${run.old} is unchanged.${s ? ` The assembled conversation is in ${s.file}.` : ''}`
}

// [SP_CTX_02_21] Deliver: every text after /clear. When the resume is off or
// the person has begun a turn, the text waits in the current session's queue
// for DeliverReport; otherwise it goes as a prompt. A refused prompt is a toast.
async function deliver(run: Run, text: string, resumePrompt: string | undefined, turnsClear: number, queueOnly: boolean): Promise<void> {
  const { io } = run
  if (queueOnly || movedSince(io.turns, turnsClear)) {
    const st = await io.storage()
    if ('reason' in st) throw new Error(`the storage of this session is unavailable: ${st.reason}`)
    await io.updateQueue(st.dir, read => {
      if (read.state === 'unreadable') throw new Error(`the queue of this session cannot be read (${read.reason})`)
      return withReport(read.value, text, io.now())
    })
    return
  }
  try {
    await io.submit(resumePrompt ? `${text}\n\n${resumePrompt}` : text)
  } catch (err) {
    io.toast(`context-editor: the handoff prompt was refused: ${errorText(err)}`)
  }
}

async function removeSeedFiles(run: Run, s: HandoffSeed): Promise<void> {
  await run.io.remove(`${run.oldDir}/${s.id}`).catch(() => undefined)
  if (s.archive) await run.io.remove(s.archive).catch(() => undefined)
}

// [SP_CTX_02_21] PrepareSeed: the seed and its files, in the old session's
// storage, before any host command; or why there is none (the files removed).
async function prepareSeed(run: Run): Promise<{ seed: HandoffSeed } | { reason: string }> {
  const { io } = run
  const id = io.now()
  const folder = `${run.oldDir}/${id}`
  const archive = `${run.oldDir}/${id}.json`
  const clean = async (withArchive: boolean) => {
    await io.remove(folder).catch(() => undefined)
    if (withArchive) await io.remove(archive).catch(() => undefined)
  }
  try {
    const { transcript, rows } = await io.view()
    const api = await io.readApi()
    const tags = await io.readTags()
    const built = await buildSeed({ transcript, rows, api, edits: run.q.edits, tags, folder, archive, writeMedia: io.writeMedia })
    if ('refuse' in built) {
      await clean(false)
      return { reason: built.reason }
    }
    const bad = checkSeed(built.rows)
    if (bad) {
      await clean(false)
      return { reason: bad }
    }
    let archived = ''
    if (built.report.originals.length) {
      if (!(await io.writeText(archive, archiveText(built.report.originals, built.media)))) {
        await clean(false)
        return { reason: 'the originals could not be archived' }
      }
      archived = archive
    }
    const file = `${folder}/seed.json`
    if (!(await io.writeText(file, JSON.stringify(built.rows)))) {
      await clean(true)
      return { reason: 'the seed could not be written' }
    }
    return {
      seed: {
        old: run.old,
        id,
        rows: built.rows,
        file,
        archive: archived,
        report: built.report,
        visible: built.visible,
        // the batch as claimed: HandedOff empties the old queue later
        edits: run.q.edits,
        fromSummary: built.fromSummary,
        unmatchedPromptMedia: built.unmatchedPromptMedia,
        carried: built.carried,
        // [SP_CTX_02_34] the old session's calibration, for the seed's report
        ratio: tags.state === 'unreadable' ? undefined : tags.value.charsPerToken,
        taken: false,
      },
    }
  } catch (err) {
    await clean(true)
    return { reason: `failed: ${errorText(err)}` }
  }
}

export const REGISTRIES_NOT_CARRIED = ' Tags and aliases were not carried over.'

// [SP_CTX_02_21] step registries: each registry of the old session read,
// brought in line with the seeded rows as after a compaction in the same
// session ([SP_CTX_02_14]: before = s.visible, after = s.rows, the batch
// s.edits, the applied ones by their label in s.report.applied) and written
// into the new session, each on its own. Tags and aliases of edited pairs
// (FreshId) and of pairs the seed does not hold go. The stage marks move by
// RelocateMark (s.report.produced; the rows CarryNote changed, s.carried),
// and `introduced` is false: the new session's first prompt gets the intro.
// A registry the old session lacks is not written and is no failure; any
// other failure writes nothing for that registry and gives the sentence once.
export async function carryRegistries(
  io: Pick<HandoffIO, 'carryTags' | 'carryAliases'>,
  s: Pick<HandoffSeed, 'visible' | 'rows' | 'edits' | 'report' | 'carried'>,
  oldDir: string,
  newDir: string,
): Promise<{ note: string; error?: Error }> {
  const labels = new Set(s.report.applied)
  const done = s.edits.filter(e => labels.has(describeEdit(e)))
  let error: Error | undefined
  const carries = [
    async () => {
      // [SP_CTX_02_21] the notes move like at an application; the seed's report names the dropped ones
      let dropped: string[] = []
      const carried = await io.carryTags(oldDir, newDir, reg => {
        const marks = relocateStageMarks(rebindTags(reg, s.visible, s.rows, done, s.edits), s.visible, s.rows, done, s.report.produced, s.carried)
        const out = rebindNotes(marks, s.visible, s.rows, done, s.report.produced)
        dropped = out.dropped
        // [SP_CTX_01_10] the old session's apply is nothing to measure in the new one
        return { ...dropLastApply(out.registry), introduced: false }
      })
      if (carried === 'carried') s.report.notesDropped = dropped
      return carried
    },
    () => io.carryAliases(oldDir, newDir, reg => pruneAliases(reg, s.visible, s.rows, done)),
  ]
  for (const carry of carries) {
    try {
      await carry()
    } catch (err) {
      error ??= err instanceof Error ? err : new Error(String(err))
    }
  }
  return error ? { note: REGISTRIES_NOT_CARRIED, error } : { note: '' }
}

// [SP_CTX_01_05] [SP_CTX_02_21] The seed's FormatReport after the first line
// of the new session's report: on a line of its own, nothing when it is empty.
export function seedReportTail(s: Pick<HandoffSeed, 'report' | 'archive' | 'ratio'>): string {
  const text = formatReport(s.report, s.archive, 'seed', s.ratio)
  return text ? `\n${text}` : ''
}

// [SP_CTX_02_21] Seed: /clear, then the seed compaction in the new session,
// checked. Once seeded, nothing falls back: every later step is caught here.
async function seedWay(run: Run, s: HandoffSeed): Promise<HandoffOutcome> {
  const { io, mem, h } = run
  try {
    await io.runCommand('clear')
  } catch (err) {
    await removeSeedFiles(run, s)
    await fail(run, [`transcript: /clear was refused: ${errorText(err)}`])
    return 'failed'
  }
  const created = await io.sessionId()
  if (created === run.old) {
    await removeSeedFiles(run, s)
    await fail(run, ['transcript: /clear did not start a new session'])
    return 'failed'
  }
  // the process is in the cleared session now; there is no way back
  run.cleared = true
  s.new = created
  // turns from here on run in the new session
  run.turnsClear = io.turns.turns
  const turnsClear = run.turnsClear
  // TURN_IN_NEW
  if (io.turns.inTurn) return afterClear(run, s, 'a turn began in the new session', turnsClear)
  // TURN_BEFORE_CLEAR: /clear waited for a turn the seed does not hold
  if (io.turns.turns !== run.turns0) return afterClear(run, s, 'a turn ran before /clear; the seed would miss it', turnsClear)
  const st = await io.storage()
  if ('reason' in st) return afterClear(run, s, `the storage of the new session cannot be made: ${st.reason}`, turnsClear)
  const newDir = st.dir
  mem.pending = s
  // the check right before the command ([SP_CTX_05_02])
  if (movedSince(io.turns, turnsClear)) return afterClear(run, s, 'a turn began in the new session', turnsClear)
  try {
    await io.runCommand('compact', HANDOFF_MARKER)
  } catch (err) {
    return afterClear(run, s, `the seed compaction was refused: ${errorText(err)}`, turnsClear)
  }
  if ((await io.sessionId()) !== created) {
    // SESSION_CHANGED: the person may have opened another session; no second
    // /clear, no prompt, nothing written into it. A throw here reaches only
    // the handler's FailAfterClear, never AfterClear.
    run.sessionChanged = true
    mem.pending = undefined
    await failAfterClear(run, s, ['transcript: the session changed during seeding'])
    return 'failed'
  }
  if (!s.taken) return afterClear(run, s, 'the seed compaction did not take the seed', turnsClear)
  const why = await awaitSeeded(io, s.rows, run.old, await io.sessionId())
  if (why) return afterClear(run, s, `the host did not keep the seeded conversation: ${why}`, turnsClear)
  mem.pending = undefined

  // Seeded: from here on no other way, whatever fails; each step is caught
  // here and named in a toast, and the rest still run.
  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work()
    } catch (err) {
      io.toast(
        `context-editor: seeded the new session, but step ${name} failed: ${errorText(err)}.` +
          (name === 'HandedOff' ? ` The old session ${run.old} still holds a running handoff request; run /handoff cancel there.` : ''),
      )
    }
  }
  let notes = ''
  // first: the old queue no longer holds the request running
  await step('HandedOff', () => handedOff(run, created, 'transcript'))
  await step('registries', async () => {
    const out = await carryRegistries(io, s, run.oldDir, newDir)
    notes += out.note
    if (out.error) throw out.error
  })
  const first = s.rows[0]!
  if (s.fromSummary)
    await step('pin', async () => {
      let note = ''
      try {
        await io.updateTagsAt(newDir, read => {
          const out = pinSummary(read, first)
          if ('registry' in out) return out.registry
          note = out.note
          return undefined
        })
      } catch {
        note = ' The summary row was not pinned: the tag registry could not be written.'
      }
      notes += note
    })
  const report =
    `context-editor: this session continues ${run.old} (transcript).` +
    (s.fromSummary ? ` It starts from the summary of an earlier compaction; the rows before it stay in ${run.old}.` : '') +
    (s.unmatchedPromptMedia > 0 ? ` Media in ${s.unmatchedPromptMedia} of the person's prompt(s) was not carried over.` : '') +
    notes +
    seedReportTail(s)
  // without the resume the report waits for the next prompt (DeliverReport)
  await step('deliver', () => deliver(run, report, h.resumePrompt, turnsClear, !h.resume))
  return 'transcript'
}

// [SP_CTX_02_21] AfterClear: the process is in a cleared session, the old one
// on disk unchanged. Never throws: each step is caught here, its failure
// named in a toast, and the rest still run.
async function afterClear(run: Run, s: HandoffSeed, reason: string, turnsClear: number): Promise<HandoffOutcome> {
  const { io, mem, h } = run
  run.afterClearEntered = true
  mem.pending = undefined
  const reasons = [`transcript: ${reason}`]
  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work()
    } catch (err) {
      io.toast(`context-editor: handoff after /clear: step ${name} failed: ${errorText(err)}`)
    }
  }
  try {
    // the person already works in the new session: leave it as it is
    if (movedSince(io.turns, turnsClear)) {
      await step('fail', () => failAfterClear(run, s, reasons))
      await step('deliver', () => deliver(run, notice(run, s, reasons), undefined, turnsClear, true))
      return 'failed'
    }
    // clear the seeded session; without a taken seed it is empty anyway
    await step('clear', async () => {
      if (!s.taken) return
      try {
        await io.runCommand('clear')
      } catch (err) {
        reasons.push(`/clear: ${errorText(err)}`)
      }
    })
    let now = s.new ?? run.old
    await step('session', async () => {
      now = await io.sessionId()
    })
    if (h.document) {
      const doc = h.document
      await step('handed', () => handedOff(run, now, 'document'))
      await step('deliver', () =>
        deliver(
          run,
          `${doc}\n\ncontext-editor: this session continues ${run.old} (document). The transcript way failed (${reasons.join('; ')}).${dropped(run)}`,
          h.resumePrompt,
          turnsClear,
          !h.resume,
        ),
      )
      return 'document'
    }
    await step('fail', () => failAfterClear(run, s, reasons))
    await step('deliver', () => deliver(run, notice(run, s, reasons), h.resumePrompt, turnsClear, !h.resume))
    return 'failed'
  } catch (err) {
    io.toast(`context-editor: handoff after /clear failed: ${errorText(err)}`)
    return 'failed'
  }
}

// [SP_CTX_02_21] DocumentWay: the document as the first prompt of a cleared session.
async function documentWay(run: Run): Promise<HandoffOutcome> {
  const { io, h } = run
  let doc = h.document
  if (!doc) {
    try {
      doc = await io.fork(HANDOFF_PROMPT)
    } catch (err) {
      run.reasons.push(`document: model fork failed: ${errorText(err)}`)
    }
  }
  if (!doc?.trim()) {
    await fail(run, [...run.reasons, 'document: no handoff document'])
    return 'failed'
  }
  if (moved(run)) {
    await defer(run)
    return 'deferred'
  }
  try {
    await io.runCommand('clear')
  } catch (err) {
    await fail(run, [...run.reasons, `document: /clear was refused: ${errorText(err)}`])
    return 'failed'
  }
  const created = await io.sessionId()
  if (created === run.old) {
    await fail(run, [...run.reasons, 'document: /clear did not start a new session'])
    return 'failed'
  }
  run.cleared = true
  run.turnsClear = io.turns.turns
  let why = run.reasons.length ? ` The transcript way failed (${run.reasons.join('; ')}).` : ''
  // /clear waited for the end of a turn: that turn stays in the old session
  if (io.turns.turns !== run.turns0) why += ` A turn ran before /clear; it stays in ${run.old} and is not in this document.`
  // the old queue first, then the prompt
  await handedOff(run, created, 'document')
  await deliver(run, `${doc}\n\ncontext-editor: this session continues ${run.old} (document).${why}${dropped(run)}`, h.resumePrompt, run.turnsClear, !h.resume)
  return 'document'
}

// [SP_CTX_02_21] Any exception after the claim: the request never stays
// running, and no write is repeated.
async function onException(run: Run, err: unknown): Promise<HandoffOutcome> {
  const { io } = run
  run.mem.pending = undefined
  const why = `failed: ${errorText(err)}`
  if (!run.cleared) {
    if (run.seed) await removeSeedFiles(run, run.seed)
    if (!run.terminal)
      try {
        await fail(run, [...run.reasons, why])
      } catch {
        io.toast(`context-editor: handoff failed: ${errorText(err)}; the old queue could not be written`)
      }
    return 'failed'
  }
  if (run.seed && !run.afterClearEntered && !run.sessionChanged) return afterClear(run, run.seed, why, run.turnsClear)
  if (!run.terminal)
    try {
      await failAfterClear(run, run.seed, [...run.reasons, why])
    } catch {
      io.toast(`context-editor: handoff failed after /clear: ${errorText(err)}; the old queue could not be written`)
    }
  return 'failed'
}

// [SP_CTX_02_21] Runs the request when it is due: the transcript way when
// asked for, the document way when chosen or when the seed was refused
// before /clear. `turns0` is the turn count when it was scheduled.
export async function runHandoff(io: HandoffIO, mem: HandoffMemory, turns0: number): Promise<HandoffOutcome> {
  mem.inFlight = true
  let run: Run | undefined
  try {
    // the request stays queued
    if (movedSince(io.turns, turns0)) return 'deferred'
    const old = await io.sessionId()
    const st = await io.storage()
    if ('reason' in st) return 'nothing'
    const oldDir = st.dir
    const got: { claim?: { q: Queue; h: HandoffRequest } } = {}
    await io.updateQueue(oldDir, async read => {
      if (read.state === 'unreadable' || !dueIgnoringFlight(read.value, io.now())) return undefined
      const q = read.value
      const h = q.handoff!
      if (h.state === 'running') {
        // an abandoned run that got as far as its seed may have got to /clear: never run twice
        const built = (await io.listSeeds(oldDir)).filter(id => id >= h.at).sort((a, b) => a - b)
        if (built.length)
          return {
            ...withReport(
              q,
              `context-editor: a previous handoff stopped after building ${oldDir}/${built[0]}/seed.json; it is not re-run; ask again with /handoff or context_handoff.`,
              io.now(),
            ),
            handoff: undefined,
          }
      }
      const claimed: HandoffRequest = { ...h, state: 'running', at: io.now(), owner: mem.instance }
      got.claim = { q, h: claimed }
      return { ...q, handoff: claimed }
    })
    if (!got.claim) return 'nothing'
    run = {
      io,
      mem,
      turns0,
      old,
      oldDir,
      q: got.claim.q,
      h: got.claim.h,
      cleared: false,
      // set by /clear, read only once `cleared`
      turnsClear: 0,
      afterClearEntered: false,
      sessionChanged: false,
      terminal: false,
      reasons: [],
      writes: new Map(),
    }
    const r = run
    try {
      if (r.h.mode === 'transcript') {
        const prepared = await prepareSeed(r)
        if ('reason' in prepared) r.reasons.push(`transcript: ${prepared.reason}`)
        else {
          r.seed = prepared.seed
          if (moved(r)) {
            await removeSeedFiles(r, prepared.seed)
            await defer(r)
            return 'deferred'
          }
          return await seedWay(r, prepared.seed)
        }
      }
      return await documentWay(r)
    } catch (err) {
      return await onException(r, err)
    }
  } finally {
    mem.inFlight = false
    // the old session's status line does not stay in the new one
    if (run?.cleared) await refreshStatus(io)
  }
}

// [SP_CTX_02_21] The status line from the current session's queue: its
// edit count, or none.
async function refreshStatus(io: HandoffIO): Promise<void> {
  try {
    const st = await io.storage()
    const read = 'reason' in st ? undefined : await io.readQueue(st.dir)
    const n = read && read.state !== 'unreadable' ? read.value.edits.length : 0
    io.status(n ? `${n} context edit(s) queued` : undefined)
  } catch {
    io.status(undefined)
  }
}

// [SP_CTX_02_21] Schedule: RunHandoff after HANDOFF_DELAY, from a deferred
// action of turn.complete or of the /handoff command, never from a hook the
// turn waits on. No second run while one is planned or in flight.
export function scheduleHandoff(io: HandoffIO, mem: HandoffMemory): boolean {
  if (mem.inFlight || mem.scheduled) return false
  mem.scheduled = true
  const turns0 = io.turns.turns
  io.after(HANDOFF_DELAY_MS, () => void startHandoff(io, mem, turns0))
  return true
}

// [SP_CTX_02_21] The planned run: `scheduled` down before it begins; a
// deferral by a turn that has already ended plans the next run itself.
export async function startHandoff(io: HandoffIO, mem: HandoffMemory, turns0: number): Promise<HandoffOutcome> {
  mem.scheduled = false
  let outcome: HandoffOutcome
  try {
    outcome = await runHandoff(io, mem, turns0)
  } catch (err) {
    io.toast(`context-editor: handoff failed: ${errorText(err)}`)
    outcome = 'failed'
  }
  if (outcome === 'deferred' && !io.turns.inTurn) scheduleHandoff(io, mem)
  return outcome
}

// [SP_CTX_04_04] Drops the request of the current session when it may go;
// `onlyBy` limits it to one requester. True when one was dropped.
export async function dropRequest(io: HandoffIO, mem: HandoffMemory, why: string, onlyBy?: HandoffRequest['by']): Promise<boolean> {
  const st = await io.storage()
  if ('reason' in st) return false
  let done = false
  await io.updateQueue(st.dir, read => {
    if (read.state === 'unreadable' || !read.value.handoff || (onlyBy && read.value.handoff.by !== onlyBy)) return undefined
    const next = cancelHandoff(read.value, why, io.now(), mem.inFlight)
    if (next === read.value) return undefined
    done = true
    return next
  })
  return done
}

// [SP_CTX_02_21] ON turn complete (main loop), after the turn counter: the
// agent's request dies with an interrupted turn it was made in; otherwise a
// due request is scheduled, after an interrupted turn too.
export async function handoffAfterTurn(io: HandoffIO, mem: HandoffMemory, aborted: boolean): Promise<'dropped' | 'scheduled' | 'none'> {
  const st = await io.storage()
  if ('reason' in st) return 'none'
  const read = await io.readQueue(st.dir)
  if (read.state === 'unreadable') return 'none'
  if (aborted && read.value.handoff?.by === 'agent' && mem.requestTurn !== undefined && mem.requestTurn === io.turns.turns)
    return (await dropRequest(io, mem, 'the turn was interrupted', 'agent')) ? 'dropped' : 'none'
  if (handoffDue(read.value, mem, io.now())) return scheduleHandoff(io, mem) ? 'scheduled' : 'none'
  return 'none'
}

// [SP_CTX_02_19] [SP_CTX_02_20] Writes the request of the agent or the person.
export async function requestHandoff(
  io: HandoffIO,
  mem: HandoffMemory,
  args: HandoffArgs,
  by: HandoffRequest['by'],
): Promise<{ mode: HandoffRequest['mode'] } | { deny: string; code: HandoffDeny }> {
  if (args.agentId) return { code: 'DENIED_SUBAGENT', deny: 'only the main conversation can be handed off.' }
  const st = await io.storage()
  if ('reason' in st) return { code: 'DENIED_STORAGE', deny: `storage unavailable: ${st.reason}` }
  let out: { mode: HandoffRequest['mode'] } | { deny: string; code: HandoffDeny } = { code: 'DENIED_QUEUE', deny: 'the queue was not written.' }
  try {
    await io.updateQueue(st.dir, read => {
      if (read.state === 'unreadable') {
        out = { code: 'DENIED_QUEUE', deny: `the queue cannot be read (${read.reason}).` }
        return undefined
      }
      const next = queueHandoff(read.value, args, by, io.now(), mem.inFlight)
      if ('deny' in next) {
        out = next
        return undefined
      }
      out = { mode: next.mode }
      return next.queue
    })
  } catch (err) {
    return { code: 'DENIED_QUEUE', deny: `could not save the queue: ${errorText(err)}` }
  }
  return out
}

// [SP_CTX_02_19] context_handoff: queues the request; the end of the turn runs it.
export async function contextHandoff(io: HandoffIO, mem: HandoffMemory, args: HandoffArgs): Promise<{ result: string } | { deny: string; code: HandoffDeny }> {
  const out = await requestHandoff(io, mem, args, 'agent')
  if ('deny' in out) return out
  mem.requestTurn = io.turns.turns
  return { result: `Handoff queued (${out.mode}): it runs when this turn ends. End your turn now with a one-line status.` }
}

// [SP_CTX_04_04] The current session's request is running in this instance:
// it is in flight here and cannot be cancelled.
async function runningHere(io: HandoffIO, mem: HandoffMemory): Promise<boolean> {
  if (!mem.inFlight) return false
  const st = await io.storage()
  if ('reason' in st) return false
  const read = await io.readQueue(st.dir)
  return read.state !== 'unreadable' && read.value.handoff?.state === 'running'
}

// [SP_CTX_02_20] `/handoff [document|cancel]`: the tool's request without a
// turn of the agent, scheduled at once.
export async function handoffCommand(io: HandoffIO, mem: HandoffMemory, rawArgs: string): Promise<string> {
  const arg = rawArgs.trim()
  if (arg === 'cancel') {
    if (await runningHere(io, mem)) return 'a handoff is running; it cannot be cancelled'
    return (await dropRequest(io, mem, 'cancelled by the person')) ? 'handoff cancelled' : 'no handoff waiting'
  }
  const out = await requestHandoff(io, mem, { mode: arg === 'document' ? 'document' : 'transcript' }, 'person')
  // [SP_CTX_02_20] no mod prefix: the host shows the reply under the plugin's name
  if ('deny' in out) return out.deny
  scheduleHandoff(io, mem)
  return `handoff (${out.mode}) starts`
}
