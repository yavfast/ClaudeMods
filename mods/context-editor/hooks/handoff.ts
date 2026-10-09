import type { SessionMessage } from 'claude-code'
import { archiveMedia, archiveText, screenPinned } from './compaction'
import {
  applyEdits,
  collectMedia,
  describeEdit,
  dropOwnCalls,
  formatReport,
  MAX_TEXT,
  ownerKey,
  replacedOwners,
  type ApplyReport,
  type MediaRef,
  type QueuedEdit,
} from './edits'
import { DEFAULT_RESUME, MAX_DOCUMENT, type HandoffRequest, type Queue, type Read } from './queue'
import type { TagRegistry } from './tags'

// [SP_CTX_01_12]
export const HANDOFF_DELAY_MS = 1_000
export const HANDOFF_STALE_MS = 120_000
export const HANDOFF_PROMPT =
  "Write a handoff document for a fresh session that continues this work: the person's task and constraints verbatim, decisions in force, facts, numbers, paths and sources still needed, open questions and the next step. Plain text, no preamble."

// [SP_CTX_01_16] One line of a session transcript file, as `--resume` reads it.
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: Block[]; is_error?: true }
  | { type: 'image' | 'document'; source: { type: 'base64'; media_type: string; data: string } }
export type TranscriptRecord = {
  type: 'user' | 'assistant'
  uuid: string
  parentUuid: string | null
  timestamp: string
  sessionId: string
  cwd: string
  message: { role: 'user' | 'assistant'; content: Block[] }
}

export type HandoffArgs = { agentId?: string; mode?: unknown; document?: unknown; resume?: unknown; resume_prompt?: unknown }

// [SP_CTX_02_19] The queue with a new handoff request, or why it is refused. Pure.
export function queueHandoff(q: Queue, args: HandoffArgs, by: HandoffRequest['by'], now: number): { queue: Queue; mode: string } | { deny: string } {
  if (args.agentId) return { deny: 'only the main conversation can be handed off.' }
  const mode = args.mode === undefined ? 'transcript' : args.mode
  if (mode !== 'transcript' && mode !== 'document') return { deny: 'mode must be "transcript" or "document".' }
  if (args.document !== undefined && (typeof args.document !== 'string' || args.document.length > MAX_DOCUMENT))
    return { deny: `document must be a string of at most ${MAX_DOCUMENT} chars.` }
  if (args.resume_prompt !== undefined && (typeof args.resume_prompt !== 'string' || args.resume_prompt.length > MAX_TEXT))
    return { deny: `resume_prompt must be a string of at most ${MAX_TEXT} chars.` }
  if (q.handoff?.state === 'running' && !isStale(q.handoff, now)) return { deny: 'a handoff is already running; wait for the switch.' }
  const document = typeof args.document === 'string' && args.document.trim() ? args.document : undefined
  const prompt = typeof args.resume_prompt === 'string' && args.resume_prompt.trim() ? args.resume_prompt : DEFAULT_RESUME
  const handoff: HandoffRequest = { mode, ...(document ? { document } : {}), resume: args.resume !== false, resumePrompt: prompt, by, state: 'queued', at: now }
  return { queue: { ...q, handoff }, mode }
}

export function isStale(h: HandoffRequest, now: number): boolean {
  return h.state === 'running' && now - h.at > HANDOFF_STALE_MS
}

// Whether a turn's end (or the person's command) should start RunHandoff.
export function handoffDue(q: Queue | undefined, now: number): boolean {
  return !!q?.handoff && (q.handoff.state === 'queued' || isStale(q.handoff, now))
}

// [SP_CTX_02_22] The records of the new session: the rows with the queued
// edits applied as a compaction applies them, own calls dropped, rows of
// one role merged, media of the pairs no edit replaced kept. Pure.
export function buildTranscript(input: {
  rows: readonly SessionMessage[]
  edits: readonly QueuedEdit[]
  found: ReadonlyMap<string, readonly MediaRef[]>
  knownResults: ReadonlySet<string>
  unmatchedPromptMedia: number
  archive: string
  media: ReadonlyMap<string, readonly string[]>
  sessionId: string
  cwd: string
  now: number
  newId: () => string
}): { records: TranscriptRecord[]; report: ApplyReport } {
  const owners = new Set(input.found.keys())
  const options = { knownResults: input.knownResults, unmatchedPromptMedia: input.unmatchedPromptMedia }
  const applied = applyEdits(input.rows, input.edits, input.archive, input.media, owners, options)
  const rows = dropOwnCalls(applied.rows, owners, input.knownResults)
  const names = new Set(applied.report.applied)
  const replaced = replacedOwners(input.rows, input.edits.filter(e => names.has(describeEdit(e))))

  const merged: { role: 'user' | 'assistant'; content: Block[] }[] = []
  for (const r of rows) {
    const content = blocksOf(r, input.found, replaced)
    if (!content.length) continue
    const last = merged.at(-1)
    if (last?.role === r.role) last.content = r.role === 'user' ? orderUser([...last.content, ...content]) : [...last.content, ...content]
    else merged.push({ role: r.role, content })
  }
  normalize(merged)

  const records: TranscriptRecord[] = []
  merged.forEach((m, i) => {
    records.push({
      type: m.role,
      uuid: input.newId(),
      parentUuid: records[i - 1]?.uuid ?? null,
      timestamp: new Date(input.now - (merged.length - i)).toISOString(),
      sessionId: input.sessionId,
      cwd: input.cwd,
      message: { role: m.role, content: m.content },
    })
  })
  return { records, report: applied.report }
}

// Until nothing changes: the first message is the person's; a result whose
// call did not come along (the window began mid-pair) is dropped, as the
// host drops it; empty messages go; neighbours of one role merge.
function normalize(merged: { role: 'user' | 'assistant'; content: Block[] }[]): void {
  for (let changed = true; changed; ) {
    changed = false
    while (merged[0]?.role === 'assistant') {
      merged.shift()
      changed = true
    }
    merged.forEach((m, i) => {
      if (m.role !== 'user') return
      const calls = new Set(merged[i - 1]?.content.flatMap(b => (b.type === 'tool_use' ? [b.id] : [])) ?? [])
      const kept = m.content.filter(b => b.type !== 'tool_result' || calls.has(b.tool_use_id))
      if (kept.length !== m.content.length) changed = true
      m.content = kept
    })
    for (let i = merged.length - 1; i >= 0; i--) {
      if (!merged[i]!.content.length) {
        merged.splice(i, 1)
        changed = true
      } else if (i > 0 && merged[i - 1]!.role === merged[i]!.role) {
        const [m] = merged.splice(i, 1)
        merged[i - 1]!.content = m!.role === 'user' ? orderUser([...merged[i - 1]!.content, ...m!.content]) : [...merged[i - 1]!.content, ...m!.content]
        changed = true
      }
    }
  }
}

function blocksOf(r: SessionMessage, found: ReadonlyMap<string, readonly MediaRef[]>, replaced: ReadonlySet<string>): Block[] {
  const text: Block[] = r.text.trim() ? [{ type: 'text', text: r.text }] : []
  if (r.role === 'assistant') return [...text, ...r.toolUses.map(u => ({ type: 'tool_use' as const, id: u.tool_use_id, name: u.tool, input: u.input }))]
  const results: Block[] = (r.toolResults ?? []).map(t => {
    const key = ownerKey({ tool_use_id: t.tool_use_id })
    const media = replaced.has(key) ? [] : (found.get(key) ?? []).flatMap(mediaBlock)
    const content: Block[] = [...(t.text.trim() ? [{ type: 'text' as const, text: t.text }] : []), ...media]
    return { type: 'tool_result' as const, tool_use_id: t.tool_use_id, ...(content.length ? { content } : {}), ...(t.isError ? { is_error: true as const } : {}) }
  })
  return [...results, ...text]
}

// A user message carries its tool results first.
function orderUser(blocks: Block[]): Block[] {
  return [...blocks.filter(b => b.type === 'tool_result'), ...blocks.filter(b => b.type !== 'tool_result')]
}

function mediaBlock(ref: MediaRef): Block[] {
  if (!ref.data) return []
  return [{ type: ref.mediaType.startsWith('image/') ? 'image' : 'document', source: { type: 'base64', media_type: ref.mediaType, data: ref.data } }]
}

// [SP_CTX_02_23] Why the host would show the model something else, or
// undefined when the records are sound. Pure.
export function checkTranscript(records: readonly TranscriptRecord[]): string | undefined {
  if (!records.length) return 'no rows to carry over'
  const seen = new Set<string>()
  for (const [i, r] of records.entries()) {
    const prev = records[i - 1]
    if (r.type !== (i % 2 === 0 ? 'user' : 'assistant') || r.message.role !== r.type) return `row ${i}: roles do not alternate from user`
    if (r.parentUuid !== (prev?.uuid ?? null)) return `row ${i}: broken parentUuid chain`
    if (!r.uuid || seen.has(r.uuid)) return `row ${i}: missing or repeated uuid`
    seen.add(r.uuid)
    if (Number.isNaN(Date.parse(r.timestamp)) || (prev && r.timestamp < prev.timestamp)) return `row ${i}: bad timestamp`
    if (!r.message.content.length) return `row ${i}: empty message`
    if (!r.message.content.every(allowedBlock)) return `row ${i}: a block of a type the transcript does not take`
    const uses = r.message.content.flatMap(b => (b.type === 'tool_use' ? [b.id] : []))
    const results = r.message.content.flatMap(b => (b.type === 'tool_result' ? [b.tool_use_id] : []))
    if (r.type === 'assistant' && results.length) return `row ${i}: tool_result in an assistant row`
    if (r.type === 'user' && uses.length) return `row ${i}: tool_use in a user row`
    const calls = r.type === 'user' ? (prev?.message.content.flatMap(b => (b.type === 'tool_use' ? [b.id] : [])) ?? []) : []
    if (r.type === 'user' && (results.length !== calls.length || results.some(id => !calls.includes(id))))
      return `row ${i}: tool results do not answer the calls of the row before`
    if (uses.length && i === records.length - 1) return `row ${i}: calls without results`
  }
  return undefined
}

function allowedBlock(b: Block): boolean {
  if (b.type === 'text' || b.type === 'tool_use') return true
  if (b.type === 'tool_result') return (b.content ?? []).every(c => c.type === 'text' || c.type === 'image' || c.type === 'document')
  return false
}

// [SP_CTX_02_24] Whether the host opened the records whole: the first row's
// text and every call are in what it reads back. Pure.
export function checkSwitched(records: readonly TranscriptRecord[], read: readonly SessionMessage[]): boolean {
  if (!read.length || !records.length) return false
  const first = records[0]!.message.content.flatMap(b => (b.type === 'text' ? [b.text] : []))[0]
  if (first && !read[0]!.text.includes(first.slice(0, 80))) return false
  const calls = new Set(read.flatMap(r => r.toolUses.map(u => u.tool_use_id)))
  return records.every(r => r.message.content.every(b => b.type !== 'tool_use' || calls.has(b.id)))
}

// What RunHandoff needs from the host; register.ts binds it to `$`. Queue
// changes run on the queue's chain; nothing here holds it across a host
// command or a prompt ([SP_CTX_DEC_04]).
export type HandoffIO = {
  now: () => number
  newId: () => string
  sessionId: () => Promise<string>
  // the storage of the current session, prepared for it
  storageDir: () => Promise<string | undefined>
  // main-loop turns started in this process so far, and whether one runs now
  turnsStarted: () => number
  inTurn: () => boolean
  readQueue: () => Promise<Read<Queue>>
  // runs `change` on the queue of the session whose storage is `dir`
  updateQueue: (dir: string, change: (q: Queue) => Queue) => Promise<void>
  rows: () => Promise<readonly SessionMessage[]>
  readApi: () => Promise<readonly unknown[]>
  readTags: () => Promise<Read<TagRegistry>>
  cwd: () => Promise<string>
  // the directory that holds `<id>.jsonl`, if any
  findTranscript: (id: string) => Promise<string | undefined>
  // the owner-only storage of session `id`
  prepareStorage: (id: string) => Promise<string | undefined>
  writeMedia: (path: string, base64: string) => Promise<boolean>
  writeText: (path: string, text: string) => Promise<boolean>
  rename: (from: string, to: string) => Promise<boolean>
  remove: (path: string) => Promise<void>
  copyRegistries: (fromDir: string, toDir: string) => Promise<void>
  runCommand: (command: string, args: string) => Promise<void>
  fork: (prompt: string) => Promise<string | undefined>
  submit: (text: string) => Promise<void>
  toast: (text: string) => void
}

export type HandoffOutcome =
  | { outcome: 'transcript' | 'document'; newId: string }
  | { outcome: 'failed'; reasons: string[] }
  | { outcome: 'deferred' | 'nothing' }

type Ctx = { io: HandoffIO; q: Queue; h: HandoffRequest; old: string; oldDir: string; turns: number }

// A turn ran or runs since `turns` was taken: the switch would leave it out.
function turnMoved(io: HandoffIO, turns: number): boolean {
  return io.inTurn() || io.turnsStarted() !== turns
}

// [SP_CTX_02_21] Runs the queued handoff: the transcript way first when asked
// for, the document way when it was chosen or the transcript way failed
// before the switch. `turns` is the turn count when it was scheduled.
export async function runHandoff(io: HandoffIO, turns: number = io.turnsStarted()): Promise<HandoffOutcome> {
  if (turnMoved(io, turns)) return { outcome: 'deferred' }
  const old = await io.sessionId()
  const oldDir = await io.storageDir()
  const read = await io.readQueue()
  if (!oldDir || read.state === 'unreadable' || !handoffDue(read.value, io.now())) return { outcome: 'nothing' }
  let claimed = false
  await io.updateQueue(oldDir, q => {
    if (!handoffDue(q, io.now())) return q
    claimed = true
    return { ...q, handoff: { ...q.handoff!, state: 'running', at: io.now() } }
  })
  if (!claimed) return { outcome: 'nothing' }
  const ctx: Ctx = { io, q: read.value, h: read.value.handoff!, old, oldDir, turns }
  const reasons: string[] = []

  if (ctx.h.mode === 'transcript') {
    const done = await handoffTranscript(ctx).catch((err: unknown): Step => ({ reason: `failed: ${String(err)}` }))
    if ('newId' in done) return { outcome: 'transcript', newId: done.newId }
    if ('deferred' in done) return defer(ctx)
    if ('stuck' in done) return fail(ctx, [`transcript: ${done.stuck}`])
    reasons.push(`transcript: ${done.reason}`)
  }

  const doc = ctx.h.document ?? (await io.fork(HANDOFF_PROMPT).catch(() => undefined))
  if (!doc?.trim()) return fail(ctx, [...reasons, 'document: no handoff document'])
  if (turnMoved(io, ctx.turns)) return defer(ctx)
  await io.runCommand('clear', '').catch(() => undefined)
  const now = await io.sessionId()
  if (now === old) return fail(ctx, [...reasons, 'document: /clear did not start a new session'])
  const dropped = ctx.q.edits.length ? ` The ${ctx.q.edits.length} queued edit(s) were not carried over.` : ''
  const why = reasons.length ? ` The transcript way failed (${reasons.join('; ')}).` : ''
  await handedOff(ctx, now, 'document')
  const text = `${doc}\n\ncontext-editor: this session continues ${old} (document).${why}${dropped}${ctx.h.resume ? `\n\n${ctx.h.resumePrompt}` : ''}`
  await io.submit(text).catch(() => io.toast('context-editor: the handoff document could not be sent'))
  return { outcome: 'document', newId: now }
}

// `reason`: failed before the switch, the session is as it was; `stuck`: the
// switch went wrong and the way back did not lead home; `deferred`: a turn
// started meanwhile.
type Step = { newId: string } | { reason: string } | { stuck: string } | { deferred: true }

async function handoffTranscript(ctx: Ctx): Promise<Step> {
  const { io, q, old } = ctx
  const rows = await io.rows()
  const { found, knownResults, unmatchedPromptMedia } = collectMedia(await io.readApi())
  // Rows whose results the model no longer sees (a resume after a compaction,
  // or past the API window) would come back in the new session.
  if (rows.some(r => (r.toolResults ?? []).some(t => !knownResults.has(t.tool_use_id))))
    return { reason: 'the conversation holds rows the model no longer sees' }
  const dir = await io.findTranscript(old)
  if (!dir) return { reason: 'the transcript of this session was not found' }
  const newId = io.newId()
  const store = await io.prepareStorage(newId)
  if (!store) return { reason: 'the storage of the new session cannot be made' }
  const undo = async (reason: string, file?: string): Promise<Step> => {
    if (file) await io.remove(file).catch(() => undefined)
    await io.remove(store).catch(() => undefined)
    return { reason }
  }
  const id = io.now()
  const archive = `${store}/${id}.json`
  const file = `${dir}/${newId}.jsonl`
  let built: ReturnType<typeof buildTranscript>
  try {
    const { edits, refused } = screenPinned(rows, q.edits, await io.readTags())
    const media = await archiveMedia(found, replacedOwners(rows, edits), `${store}/${id}`, io.writeMedia)
    built = buildTranscript({ rows, edits, found, knownResults, unmatchedPromptMedia, archive, media, sessionId: newId, cwd: await io.cwd(), now: io.now(), newId: io.newId })
    built.report.failed.unshift(...refused)
    const bad = checkTranscript(built.records)
    if (bad) return undo(bad)
    if (built.report.originals.length && !(await io.writeText(archive, archiveText(built.report.originals, media)))) return undo('the originals could not be archived')
    const text = built.records.map(r => JSON.stringify(r)).join('\n') + '\n'
    if (!(await io.writeText(`${file}.tmp`, text)) || !(await io.rename(`${file}.tmp`, file))) return undo('the new transcript could not be written', `${file}.tmp`)
    await io.copyRegistries(ctx.oldDir, store).catch(() => undefined)
  } catch (err) {
    return undo(`failed: ${String(err)}`, `${file}.tmp`)
  }

  // A turn that started since the claim would be left out of the new session.
  if (turnMoved(io, ctx.turns)) {
    await undo('', file)
    return { deferred: true }
  }
  await io.runCommand('resume', newId).catch(() => undefined)
  const now = await io.sessionId()
  if (now !== newId || !checkSwitched(built.records, await io.rows())) {
    if (now !== old) await io.runCommand('resume', old).catch(() => undefined)
    if ((await io.sessionId()) !== old) return { stuck: `the host did not open the assembled transcript, and the way back to ${old} failed` }
    return undo('the host did not open the assembled transcript', file)
  }

  // Switched: from here on nothing falls back, whatever fails.
  try {
    await handedOff(ctx, newId, 'transcript')
    const prompts = unmatchedPromptMedia ? ` Media in ${unmatchedPromptMedia} of the person's prompt(s) was not carried over.` : ''
    const report = `context-editor: this session continues ${old} (transcript).${prompts}\n${formatReport(built.report, archive)}`
    if (ctx.h.resume) await io.submit(`${report}\n\n${ctx.h.resumePrompt}`)
    else await io.updateQueue(store, q2 => ({ ...q2, report: q2.report ? `${q2.report}\n${report}` : report, reportId: id, reportResume: false }))
  } catch {
    io.toast('context-editor: switched to the new session, but its report could not be delivered')
  }
  return { newId }
}

// The old session's queue once it was handed off: batch gone, a note kept.
async function handedOff(ctx: Ctx, to: string, mode: string): Promise<void> {
  const note = `context-editor: this session was handed off to ${to} (${mode}).`
  await ctx.io.updateQueue(ctx.oldDir, q => ({ ...q, edits: [], handoff: undefined, report: q.report ? `${q.report}\n${note}` : note, reportId: ctx.io.now(), reportResume: false }))
}

// A turn started while the handoff waited: it runs again after that turn.
async function defer(ctx: Ctx): Promise<HandoffOutcome> {
  await ctx.io.updateQueue(ctx.oldDir, q => (q.handoff ? { ...q, handoff: { ...q.handoff, state: 'queued' } } : q))
  return { outcome: 'deferred' }
}

async function fail(ctx: Ctx, reasons: string[]): Promise<HandoffOutcome> {
  const text = `context-editor: handoff failed: ${reasons.join('; ')}; the session was not changed.`
  await ctx.io.updateQueue(ctx.oldDir, q => ({ ...q, handoff: undefined, report: q.report ? `${q.report}\n${text}` : text, reportId: ctx.io.now(), reportResume: false }))
  ctx.io.toast(text.slice(0, 200))
  return { outcome: 'failed', reasons }
}

// [SP_CTX_04_04] The queue once the turn that asked for a handoff was
// interrupted, or the person cancelled it: the request is gone.
export function cancelHandoff(q: Queue, why: string, now: number): Queue {
  if (!q.handoff || q.handoff.state === 'running') return q
  const text = `context-editor: handoff cancelled (${why}).`
  return { ...q, handoff: undefined, report: q.report ? `${q.report}\n${text}` : text, reportId: now, reportResume: false }
}
