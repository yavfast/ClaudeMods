import type { SessionMessage } from 'claude-code'
import { checkShape, DESCRIBE_DROPS, describeEdit, MARK, ownerKey, type MediaRef, MAX_QUEUE_EDITS, MAX_TEXT, NO_PINS, NO_REFS, prepare, resolveEditRefs, touchedBy, type MediaOwner, type Pinned, type QueuedEdit, type RefResolver } from './edits'
import { deliveryWords, personDelivered, type QueuedDelivery } from './deliveries'

// [SP_CTX_01_12]
export const DEFAULT_RESUME = 'Continue the task from where you stopped.'
export const MAX_QUEUE_BYTES = 3 * 1024 * 1024
export const MAX_DOCUMENT = 60_000
// [SP_CTX_01_12] tools whose result is the person's message (an answer to the agent's question)
export const PERSON_TOOLS: readonly string[] = ['AskUserQuestion']
// [SP_CTX_02_02] how many rows a warning names per edit; as MAX_BLOCK_INDEXES
const MAX_WARNED_ROWS = 20

// [SP_CTX_01_15] A request to move the conversation into a new session.
export type HandoffRequest = {
  mode: 'transcript' | 'document'
  document?: string
  resume: boolean
  resumePrompt: string
  by: 'agent' | 'person'
  state: 'queued' | 'running'
  at: number
  // [SP_CTX_01_15] the module instance that claimed it; diagnostics only, no decision reads it
  owner?: string
}

// [SP_CTX_01_04]
export type Queue = {
  edits: QueuedEdit[]
  resume: boolean
  resumePrompt: string
  // [SP_CTX_01_04] [SP_CTX_DEC_16] the agent chose the continuation of this
  // batch ("resume" given, or a non-empty resume_prompt); reset with the batch
  resumeSet: boolean
  tagsOnly: boolean
  // [SP_CTX_01_04] [SP_CTX_DEC_22] the agent asked this batch to keep the
  // prompt cache up to its first edit ("keep_cache"); reset with the batch
  keepCache: boolean
  report?: string
  reportId?: number
  reportResume: boolean
  reportPrompt: string
  handoff?: HandoffRequest
  // [SP_CTX_02_30] the optimization mark was seen: the request waits for the
  // optimization turn ([SP_CTX_02_06]) or a person's prompt ([SP_CTX_02_08]);
  // its block is TagRegistry.lastClosed
  optimize: boolean
  // [SP_CTX_02_06] the optimization prompt entered: the mark in the next
  // answer is ignored (the loop guard). Never true together with `optimize`.
  // Only DetectOptimize, Flush and DeliverReport change these two; every other
  // write of the queue carries them over as read ([SP_CTX_01_04]).
  optimizePrompted: boolean
}

export type Read<T> = { state: 'missing' | 'ok'; value: T } | { state: 'unreadable'; reason: string }

export const EMPTY_QUEUE: Queue = {
  edits: [],
  resume: true,
  resumePrompt: DEFAULT_RESUME,
  resumeSet: false,
  tagsOnly: false,
  keepCache: false,
  reportResume: false,
  reportPrompt: DEFAULT_RESUME,
  optimize: false,
  optimizePrompted: false,
}

// [SP_CTX_01_04] Every field of the file is checked by type; a wrong one
// makes the whole file unreadable, never silently a default.
export function parseQueue(text: string): Read<Queue> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { state: 'unreadable', reason: `not JSON: ${String(err)}` }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unreadable', reason: 'not an object' }
  const q = { ...EMPTY_QUEUE, ...(raw as Partial<Queue>) }
  const bad = [
    !Array.isArray(q.edits) && 'edits',
    typeof q.resume !== 'boolean' && 'resume',
    typeof q.resumePrompt !== 'string' && 'resumePrompt',
    typeof q.resumeSet !== 'boolean' && 'resumeSet',
    typeof q.tagsOnly !== 'boolean' && 'tagsOnly',
    typeof q.keepCache !== 'boolean' && 'keepCache',
    q.report !== undefined && typeof q.report !== 'string' && 'report',
    q.reportId !== undefined && typeof q.reportId !== 'number' && 'reportId',
    typeof q.reportResume !== 'boolean' && 'reportResume',
    typeof q.reportPrompt !== 'string' && 'reportPrompt',
    q.handoff !== undefined && !isHandoff(q.handoff) && 'handoff',
    typeof q.optimize !== 'boolean' && 'optimize',
    typeof q.optimizePrompted !== 'boolean' && 'optimizePrompted',
  ].filter(Boolean)
  if (bad.length) return { state: 'unreadable', reason: `bad field(s): ${bad.join(', ')}` }
  const badEdit = q.edits.findIndex(e => !isQueuedEdit(e))
  return badEdit >= 0 ? { state: 'unreadable', reason: `bad edit ${badEdit + 1}` } : { state: 'ok', value: q }
}

function isHandoff(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const h = raw as Partial<HandoffRequest>
  return (
    (h.mode === 'transcript' || h.mode === 'document') &&
    (h.document === undefined || (typeof h.document === 'string' && h.document.length > 0 && h.document.length <= MAX_DOCUMENT)) &&
    typeof h.resume === 'boolean' &&
    typeof h.resumePrompt === 'string' &&
    h.resumePrompt.length > 0 &&
    (h.by === 'agent' || h.by === 'person') &&
    (h.state === 'queued' || h.state === 'running') &&
    typeof h.at === 'number' &&
    (h.owner === undefined || (typeof h.owner === 'string' && h.owner.length > 0))
  )
}

function isQueuedEdit(raw: unknown): boolean {
  if (typeof checkShape(raw) === 'string') return false
  const anchors = (raw as { anchors?: unknown }).anchors
  return anchors === undefined || (Array.isArray(anchors) && anchors.every(a => typeof a === 'string'))
}

export function queueBytes(q: Queue): number {
  return new TextEncoder().encode(JSON.stringify(q)).length
}

export type EditArgs = { edits?: unknown; resume?: unknown; resume_prompt?: unknown; keep_cache?: unknown }

// [SP_CTX_02_02] Rows the host writes as user rows that are no message of
// the person: a plugin's prompt in its frame, and rows of host tags.
const PLUGIN_FRAME = /^The .+ plugin sent a message:/
// (`<command-message>` alone, without `<command-name>`, is the host's notice of a running command)
const HOST_ROWS = ['<local-command-stdout>', '<local-command-caveat>', '<task-notification>', '<command-message>']
// leading closed spans the host puts before the person's words (VS Code: the open file)
// (`<system-reminder id="…">`: a subagent's report, [SP_CTX_02_02], phase 20)
const LEADING_SPAN = /^\s*<(ide_opened_file|system-reminder)(?:\s[^>]*)?>[\s\S]*?<\/\1>/
// [SP_CTX_01_12] The mod's compaction marks (compaction.ts re-exports them):
// queue.ts must not import compaction.ts, which imports it.
export const MARKER = 'context-editor: apply queued edits'
export const HANDOFF_MARKER = 'context-editor: seed the handed-off conversation'
// [SP_CTX_01_12] The start of a built-in compaction's summary (spike
// context_editor_handoff_long, Entry 2).
export const SUMMARY_OPENER = 'This session is being continued from a previous conversation'

// [SP_CTX_02_02] PersonText: what the person wrote in a user row; "" for a
// row that is no message of the person. Leading `<ide_opened_file>` and
// `<system-reminder>` spans are taken off; a slash command's arguments are
// the person's words, except the mod's own /compact (review round 40).
export function personText(raw: string): string {
  // [SP_CTX_01_22] an inserted delivery: the person's words, or none of a subagent's or a task's
  const delivered = deliveryWords(raw)
  if (delivered !== undefined) return delivered
  let t = raw.trim()
  for (let m = LEADING_SPAN.exec(t); m; m = LEADING_SPAN.exec(t)) t = t.slice(m[0].length).trim()
  if (t.includes('<command-name>')) {
    const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(t)?.[1]?.trim()
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim() ?? ''
    // only the mod's own /compact with its exact marker (review round 41)
    if (name === '/compact' && (args === MARKER || args === HANDOFF_MARKER)) return ''
    return args
  }
  if (t.startsWith(MARK) || t.startsWith('context-editor:') || t.startsWith(SUMMARY_OPENER)) return ''
  if (PLUGIN_FRAME.test(t) || HOST_ROWS.some(tag => t.startsWith(tag))) return ''
  return t
}

// [SP_CTX_02_02] PersonRow: a user row without results whose PersonText is not empty.
export function personRow(rows: readonly SessionMessage[], i: number): boolean {
  const r = rows[i]
  return !!r && r.role === 'user' && !(r.toolResults ?? []).length && personText(r.text) !== ''
}

// [SP_CTX_02_02] PersonPair: the call with this id is a tool in PERSON_TOOLS.
export function personPair(rows: readonly SessionMessage[], id: string): boolean {
  return rows.some(r => r.toolUses.some(u => u.tool_use_id === id && PERSON_TOOLS.includes(u.tool)))
}

// [SP_CTX_02_02] The rows of the person's messages an edit covers: prompt
// rows and AskUserQuestion answers in a collapse's span, the answer row of a
// summarize or drop of an AskUserQuestion pair.
// [SP_CTX_02_02] PersonDelivered: a person's message the host delivered
// behind a result, not yet a row, goes with a collapse or a drop of that
// result ([SP_CTX_02_36]); a summarize keeps it.
const DELIVERED = 'message sent during this tool call'

function personHits(rows: readonly SessionMessage[], e: QueuedEdit, delivered: readonly QueuedDelivery[] = []): string[] {
  const hits: string[] = []
  if (e.op === 'collapse') {
    for (const i of touchedBy(rows, e)?.rows ?? []) {
      if (personRow(rows, i)) hits.push(`#${i} (prompt)`)
      for (const t of rows[i]!.toolResults ?? []) if (personPair(rows, t.tool_use_id)) hits.push(`#${i} (AskUserQuestion answer)`)
      if (personDelivered(rows, i, delivered)) hits.push(`#${i} (${DELIVERED})`)
    }
  } else if (e.op === 'summarize' || e.op === 'drop') {
    const res = touchedBy(rows, e)?.rows[1]
    if (res !== undefined && personPair(rows, e.tool_use_id)) hits.push(`#${res} (AskUserQuestion answer)`)
    // a drop of one of parallel results leaves the row, and the delivery, to the others
    if (res !== undefined && e.op === 'drop' && personDelivered(rows, res, delivered, new Set([e.tool_use_id]))) hits.push(`#${res} (${DELIVERED})`)
  }
  return hits
}

function personWarning(label: string, hits: readonly string[]): string {
  const named = hits.slice(0, MAX_WARNED_ROWS).join(', ') + (hits.length > MAX_WARNED_ROWS ? `, +${hits.length - MAX_WARNED_ROWS} more` : '')
  return `Warning: ${label} covers the person's messages: ${named}. Keep them verbatim unless you drop them deliberately.`
}

// [SP_CTX_02_02] [C_CTX_DEC_21] PersonWarnings: a queued edit that covers
// the person's messages is not refused, but the result names those rows; what
// to compress stays the agent's call. Pure.
export function personWarnings(rows: readonly SessionMessage[], queued: readonly QueuedEdit[], delivered: readonly QueuedDelivery[] = []): string[] {
  const out: string[] = []
  for (const e of queued) {
    const hits = personHits(rows, e, delivered)
    if (hits.length) out.push(personWarning(describeEdit(e), hits))
  }
  return out
}

// [SP_CTX_02_02] [SP_CTX_02_11] PersonTagWarnings: the same for a disposable
// tag just added, a range `from..to` or a pair; its replacement is queued
// later without a warning. Pure.
export function personTagWarning(
  rows: readonly SessionMessage[],
  target: { from: number; to: number } | { tool_use_id: string },
  delivered: readonly QueuedDelivery[] = [],
): string | undefined {
  const e: QueuedEdit =
    'tool_use_id' in target ? { op: 'summarize', tool_use_id: target.tool_use_id, summary: '-' } : { op: 'collapse', from_index: target.from, to_index: target.to, summary: '-' }
  const hits = personHits(rows, e, delivered)
  if (!hits.length) return undefined
  return personWarning('tool_use_id' in target ? `disposable ${target.tool_use_id}` : `disposable #${target.from}..#${target.to}`, hits)
}

// [SP_CTX_02_02] Whether a context_edit call needs the API form: only a
// describe asks whether a prompt row has media ([SP_CTX_02_10]).
export function needsApi(args: EditArgs): boolean {
  return Array.isArray(args.edits) && args.edits.some(x => (x as { op?: unknown } | null)?.op === 'describe')
}

// [SP_CTX_02_10] hasMedia for PrepareEdits from CollectMedia's owners; none
// read, no row has media.
export function hasMediaFrom(found?: ReadonlyMap<string, readonly MediaRef[]>): (owner: MediaOwner) => boolean {
  return owner => !!found?.has(ownerKey(owner))
}

// [SP_CTX_02_02] The queue after a context_edit call, or why it is refused.
// Pure: the caller reads the queue, the rows, the pinned targets and the
// aliases, and writes the result. A `ref` is resolved here, before
// PrepareEdits, so the queue keeps tool_use ids only ([SP_CTX_02_17]).
export function queueEdits(
  q: Queue,
  rows: readonly SessionMessage[],
  args: EditArgs,
  pinned: Pinned = NO_PINS,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
  // [SP_CTX_02_10] whether a person's prompt row has media (PromptMatch)
  hasMedia: (owner: MediaOwner) => boolean = () => false,
  // [SP_CTX_01_22] the host's deliveries not yet rows, for PersonWarnings only
  delivered: readonly QueuedDelivery[] = [],
): { queue: Queue; queued: number; errors: string[]; warnings: string[]; refLines: string[] } | { deny: string } {
  if (!Array.isArray(args.edits) || args.edits.length === 0 || args.edits.length > MAX_QUEUE_EDITS)
    return { deny: `"edits" must be a list of 1..${MAX_QUEUE_EDITS} edits.` }
  if (typeof args.resume_prompt === 'string' && args.resume_prompt.length > MAX_TEXT)
    return { deny: `resume_prompt is too long (max ${MAX_TEXT} chars).` }
  // [SP_CTX_02_17] refs resolve on these rows; "last" names its call
  const refs = resolveEditRefs(args.edits, resolve, rows)
  const { queued, errors } = prepare(rows, refs.edits, hasMedia, pinned, staleIndexes)
  if (q.edits.length + queued.length > MAX_QUEUE_EDITS)
    return { deny: `the queue would exceed ${MAX_QUEUE_EDITS} edits; end the turn so the current batch applies.` }
  const next: Queue = { ...q, edits: [...q.edits, ...queued] }
  if (queued.length) next.tagsOnly = false
  const prompt = typeof args.resume_prompt === 'string' && args.resume_prompt.trim() !== ''
  // [SP_CTX_02_02] [SP_CTX_DEC_16] the optimization turn follows an answer
  // the agent already finished for the person: its batch resumes only when
  // asked to, by "resume" or by a resume_prompt of its own. A choice made
  // once in the batch (even by a call that queued nothing) stays.
  if (typeof args.resume === 'boolean') next.resume = args.resume
  else if (q.optimizePrompted && !q.resumeSet) next.resume = prompt
  if (typeof args.resume === 'boolean' || prompt) next.resumeSet = true
  if (prompt) next.resumePrompt = args.resume_prompt as string
  // [SP_CTX_02_02] [SP_CTX_DEC_22] the last explicit "keep_cache" of the batch
  // wins; a call without it leaves the batch's choice (default false)
  if (typeof args.keep_cache === 'boolean') next.keepCache = args.keep_cache
  if (queueBytes(next) > MAX_QUEUE_BYTES)
    return { deny: `the queue would exceed ${MAX_QUEUE_BYTES} bytes; end the turn so the current batch applies.` }
  const warnings = personWarnings(rows, queued, delivered)
  if (queued.some(e => e.op === 'describe')) warnings.push(DESCRIBE_DROPS)
  return { queue: next, queued: queued.length, errors, warnings, refLines: refs.lines }
}

// [SP_CTX_02_02] `refLines`: the line naming the call "last" resolved to.
export function queuedText(q: Queue, queued: number, errors: readonly string[], warnings: readonly string[] = [], refLines: readonly string[] = []): string {
  return [
    `Queued ${queued} edit(s); ${q.edits.length} pending in total.`,
    ...refLines,
    errors.length ? `Rejected: ${errors.join('; ')}.` : '',
    ...warnings,
    q.edits.length
      ? `They apply when this turn ends. End your turn now with a one-line status.${
          q.resume
            ? ` The session then resumes by itself with: "${q.resumePrompt}"`
            : // [SP_CTX_DEC_16] the optimization turn's batch stops the session
              q.optimizePrompted
              ? ' The session then stops; pass "resume": true to go on.'
              : ''
        }`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// [SP_CTX_02_08] The queue once `delivered` has reached a prompt. A report
// merged in meanwhile stays: only the delivered text leaves.
export function withoutReport(q: Queue, delivered: string): Queue {
  if (q.report === undefined) return q
  if (q.report === delivered) {
    const { report: _r, reportId: _i, ...rest } = q
    return { ...rest, reportResume: false, reportPrompt: DEFAULT_RESUME }
  }
  if (q.report.startsWith(delivered + '\n')) return { ...q, report: q.report.slice(delivered.length + 1) }
  return q
}

// What context_edit and DeliverReport need from the host; register.ts binds
// them to `$` and runs them on the queue's serial chain.
export type QueueIO = {
  readQueue: () => Promise<Read<Queue>>
  writeQueue: (q: Queue) => Promise<void>
  // moves an unreadable queue file aside; the new path, or undefined
  quarantine: () => Promise<string | undefined>
  queuePath: string
}

// [SP_CTX_02_02]
export async function contextEdit(
  io: QueueIO,
  rows: readonly SessionMessage[],
  args: EditArgs,
  pinned: Pinned = NO_PINS,
  resolve: RefResolver = NO_REFS,
  staleIndexes = false,
  hasMedia: (owner: MediaOwner) => boolean = () => false,
  delivered: readonly QueuedDelivery[] = [],
): Promise<{ result: string } | { deny: string }> {
  let read = await io.readQueue()
  let notice = ''
  if (read.state === 'unreadable') {
    const moved = await io.quarantine()
    if (!moved) return { deny: `the queue file ${io.queuePath} cannot be read (${read.reason}) nor moved aside; fix or delete it.` }
    notice = `The unreadable queue (${read.reason}) was moved to ${moved}; its edits are not applied.\n`
    read = { state: 'missing', value: { ...EMPTY_QUEUE } }
  }
  const out = queueEdits(read.value, rows, args, pinned, resolve, staleIndexes, hasMedia, delivered)
  if ('deny' in out) return out
  try {
    await io.writeQueue(out.queue)
  } catch (err) {
    return { deny: `could not save the queue: ${String(err)}` }
  }
  return { result: notice + queuedText(out.queue, out.queued, out.errors, out.warnings, out.refLines) }
}

// [SP_CTX_02_08] What changes in the queue once a person's prompt entered:
// the delivered report leaves (RemoveDelivered), an optimization request
// whose advice went (or could not be built) is done, and the loop guard is
// down when the person took over between turns.
export type Settle = { delivered?: string; optimizeDone: boolean; tookOver: boolean }

// [SP_CTX_02_08] The queue after Settle; the same queue when nothing changes.
export function settledQueue(q: Queue, s: Settle): Queue {
  let next = s.delivered !== undefined ? withoutReport(q, s.delivered) : q
  if (s.optimizeDone && next.optimize) next = { ...next, optimize: false }
  if (s.tookOver && next.optimizePrompted) next = { ...next, optimizePrompted: false }
  return next
}

// What DeliverReport needs from the host; register.ts binds it to `$`.
export type DeliverIO<R> = {
  readQueue: () => Promise<Read<Queue>>
  // [SP_CTX_02_27] INTRO_TEXT while the registry (ok or missing) has not
  // recorded it in this session; undefined otherwise
  intro: () => Promise<string | undefined>
  // [SP_CTX_02_29] PersonAdvice of TagRegistry.lastClosed as it is now;
  // undefined without a readable registry or a block (ADVICE_NO_BLOCK); a
  // throw is ADVICE_FAILED
  advice: () => Promise<string | undefined>
  // [SP_CTX_02] a turn runs now
  inTurn: () => boolean
  // passes the prompt on with the hidden context; resolves with the host's verdict
  enter: (context: readonly string[]) => Promise<R>
  // on the registry chain: introduced = true
  markIntroduced: () => Promise<void>
  // on the queue chain, the queue as it is then
  settle: (s: Settle) => Promise<void>
  // [SP_CTX_02_37] TurnSuggestion, bounded by HINT_WAIT: its line or none;
  // asked only between turns and without an optimization request
  suggestion?: () => Promise<string | undefined>
}

// [SP_CTX_02_08] [SP_CTX_02_27] The person's prompt (or another plugin's)
// carries the session intro once, the pending report, and the advice of an
// optimization request that no optimization turn served; each leaves only
// once that prompt entered. Between turns, the suggestion of the turn
// channel ([SP_CTX_02_37]) comes last: its state is claimed before the prompt
// enters, so a dropped prompt loses it. A failed step never holds the prompt back.
export async function deliverReport<R extends { drop?: unknown }>(io: DeliverIO<R>): Promise<R> {
  const context: string[] = []
  const intro = await io.intro().catch(() => undefined)
  if (intro) context.push(intro)
  const read = await io.readQueue().catch((): Read<Queue> => ({ state: 'unreadable', reason: 'read failed' }))
  const q = read.state === 'ok' ? read.value : undefined
  if (q?.report) context.push(q.report)
  if (q?.optimize) {
    // ADVICE_FAILED / ADVICE_NO_BLOCK: the prompt goes without it, once
    const advice = await io.advice().catch(() => undefined)
    if (advice) context.push(advice)
  }
  // [SP_CTX_02_37] the advice of an optimization request already says what to compress
  if (io.suggestion && !io.inTurn() && !q?.optimize) {
    const line = await io.suggestion().catch(() => undefined)
    if (line) context.push(line)
  }
  // the person took the turn between turns: the loop guard is no longer needed
  const tookOver = !!q?.optimizePrompted && !io.inTurn()
  const entered = await io.enter(context)
  if (entered.drop !== undefined) return entered
  // INTRO_NOT_RECORDED: the intro comes again with the next prompt
  if (intro) await io.markIntroduced().catch(() => undefined)
  if (q && (q.report || q.optimize || tookOver))
    // DELIVERY_FAILED: the report goes again with the next prompt
    await io.settle({ delivered: q.report || undefined, optimizeDone: q.optimize, tookOver }).catch(() => undefined)
  return entered
}
