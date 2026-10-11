import type { EngineInterface, Register, SessionMessage } from 'claude-code'
import {
  aliasesById,
  callFacts,
  EMPTY_ALIASES,
  markAlias,
  parseAliases,
  refResolver,
  wantsMark,
  withContext,
  type AliasIO,
  type AliasRegistry,
} from './aliases'
import { compactionFailure, compactionRoute, failureRecord, handleCompaction, observedBoundary } from './compaction'
import {
  afterPrepare,
  collectMedia,
  HOST_ID_WAIT_MS,
  fullRow,
  listMode,
  listRows,
  totalChars,
  LIST_COUNT,
  MAX_QUEUE_EDITS,
  MAX_TEXT,
  newHostIdMemo,
  newHostToken,
  NO_PINS,
  NO_REFS,
  OWN_TOOLS,
  parseHostId,
  peekHostId,
  readView,
  recordBoundary,
  startHostId,
  type Boundary,
  type BoundaryMemory,
  type RefResolver,
} from './edits'
import { enteredOrThrow, flushAfterTurn, newFlushState, type FlushIO } from './flush'
import { bounded, callLines, HINT_WAIT_MS, newHintMemo, softHint, turnSuggestion, type HintIO } from './hints'
import {
  contextHandoff,
  handleSeed,
  handoffAfterTurn,
  handoffCommand,
  newHandoffMemory,
  type HandoffArgs,
  type HandoffIO,
  type SeedIO,
} from './handoff'
import {
  contextEdit,
  hasMediaFrom,
  needsApi,
  DEFAULT_RESUME,
  deliverReport,
  EMPTY_QUEUE,
  MAX_DOCUMENT,
  MAX_QUEUE_BYTES,
  parseQueue,
  settledQueue,
  withoutReport,
  type Queue,
  type QueueIO,
} from './queue'
import {
  adviceFor,
  blockReport,
  detectOptimize,
  introFor,
  markLabels,
  MAX_STAGE_NAME,
  SKILL,
  telemetry,
  telemetryText,
  headerSize,
  withIntroduced,
  type BlockIO,
  type DetectIO,
  type UsageInfo,
} from './stages'
import { contextNote, MAX_NOTE, MAX_NOTES, MAX_REMIND, noteLabels, noteLines, noteReminders, remindable, afterReminders, remindsAfter, rowNotes, withReminderLines, type NoteArgs } from './notes'
import { newTurns, turnCompleted, turnStarted } from './turns'
import {
  carry,
  changeOf,
  dirOf,
  ensureStorage as ensureIn,
  jsonFile,
  newStorageMemory,
  prepareStorage as prepareFor,
  publishedDir,
  serialChains,
  storageRefusal,
  updateOf,
  type ChainKey,
  type FileIO,
  type Held,
  type Lock,
  type PrepareIO,
  type Read,
  type SessionStorage,
  type StorageState,
  type Store,
} from './store'
import {
  newAnchorMemory,
  observeAppend,
  parseDeliveries,
  pruneDeliveries,
  recordDelivery,
  type Deliveries,
  type QueuedDelivery,
} from './deliveries'
import { EMPTY_JOURNAL, journalApply, journalChanged, journalReread, journalSummary, parseJournal, type Journal, type JournalIO, type JournalSummary } from './journal'
import {
  appendFacts,
  autoTag,
  contextTag,
  countTurn,
  dropLastApply,
  EMPTY_REGISTRY,
  MAX_TAGS,
  parseRegistry,
  pinnedTargets,
  queueTagReplacements,
  callFollowUp,
  isCompactionCopy,
  resultIds,
  staleReads,
  tagLabels,
  type TagArgs,
  type TagIO,
  type TagRegistry,
} from './tags'

const PLUGIN = 'context-editor'
const LIST = 'context_list'
const EDIT = 'context_edit'
const TAG = 'context_tag'
const HANDOFF = 'context_handoff'
const NOTE = 'context_note'

// [SP_CTX_02_01] At most MAX_DESCRIPTION chars (the host cuts the rest).
export const LIST_DESCRIPTION = `List this conversation's rows OLDEST FIRST, a page at a time: indexes, sizes, tool_use ids (with their call alias, e.g. (c3)), media, flags (* already edited, ! large, @ has media; ~ after tool_use/tool_result: a reproducible Read, Grep or Glob pair), stage marks ([stage ▶ name] the first row of the open stage; [block ▶ name] .. [block end] the last closed block), tags ([pin], [state], [disposable: note], [disposable #a..#b: note] on a range's first row, [review: reason]; a bare [review] is from an older version) and your notes ([n3]; a range [n3 #a..#b]), whose full text comes in a "Notes:" block below the page ("Notes elsewhere" names those on other rows). Indexes are positions in this listing: call it right before ${EDIT}, ${TAG} or ${NOTE} by index.

The header gives one size, the conversation in tokens from the telemetry (else a calibrated estimate), then context telemetry: the size without the fixed part (system prompt, tools, skills, memory), the window, the open stage and the last closed block ("Last block #a..#b") with their sizes, the cleanup candidates by reason with their rows, and, when there is something to show, the effect of applications and your state slot. Row sizes stay in chars. "count":0 gives that header alone, without rows; it does not renew the indexes. {"index":12,"full":true} shows row #12 whole (e.g. to check a summary before reading the archive). Only the latest 4096 rows are visible.`

// [SP_CTX_02_02] At most MAX_DESCRIPTION chars, by the priorities of the spec.
export const EDIT_DESCRIPTION = `Edit your own earlier context to free space: replace tool outputs you have processed (screenshots and documents too), dead-end steps and wrong conclusions with summaries.

Edits apply when your turn ends: after this call, end your turn with a one-line status. The session then resumes by itself with "resume_prompt" (default: "${DEFAULT_RESUME}") unless "resume" is false; in an optimization turn only on "resume": true or "resume_prompt".

Ops (items of "edits"; every field shown is required):
- {"op":"summarize","tool_use_id" or "ref","summary"}: replace one tool result, with any image or document in it, by your summary of what mattered (describe the media too). Parallel calls sharing a result row: summarize those with media in one batch.
- {"op":"drop","tool_use_id" or "ref"}: remove a useless tool call and its result.
- {"op":"collapse","from_index","to_index","summary"}: replace rows from_index..to_index (from ${LIST}) with one summary; the range must hold every tool call together with its result.
- {"op":"rewrite","index","text"}: replace the text of one of your assistant text rows (no tool calls in it).
- {"op":"describe","index","description"}: replace the image or document in a prompt row of the person (@ in ${LIST}) by your description; its text stays.

Calls worth editing carry a line "[context-editor] id cN" after their result: "ref":"cN" targets that call and "ref":"last" your latest call, without ${LIST}. A [pin] target cannot be edited; remove the pin with ${TAG} first. A row tagged [state] changes only by a rewrite of that row.

Originals are archived (original: <path> in the replacement); Read it to get one back. Summaries keep every fact, number, URL and source you still need.

Compress a finished stage's block into a stage record; usually keep verbatim the person's messages (AskUserQuestion answers too), rules and skills in force. Batch edits in one call (see "keep_cache"). Record template and guide: skill ${PLUGIN}:${SKILL}.`

// [SP_CTX_01_02] [SP_CTX_02_17] A call alias; exactly one of it and tool_use_id.
const REF = { type: 'string', description: 'Instead of tool_use_id: a call alias "cN" from a "[context-editor] id cN" line, or "last" for your latest call (context_* calls do not count).' }

const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_QUEUE_EDITS,
      items: {
        oneOf: [
          { type: 'object', properties: { op: { const: 'summarize' }, tool_use_id: { type: 'string' }, summary: { type: 'string' } }, required: ['op', 'tool_use_id', 'summary'] },
          { type: 'object', properties: { op: { const: 'summarize' }, ref: REF, summary: { type: 'string' } }, required: ['op', 'ref', 'summary'] },
          { type: 'object', properties: { op: { const: 'drop' }, tool_use_id: { type: 'string' } }, required: ['op', 'tool_use_id'] },
          { type: 'object', properties: { op: { const: 'drop' }, ref: REF }, required: ['op', 'ref'] },
          { type: 'object', properties: { op: { const: 'collapse' }, from_index: { type: 'integer' }, to_index: { type: 'integer' }, summary: { type: 'string' } }, required: ['op', 'from_index', 'to_index', 'summary'] },
          { type: 'object', properties: { op: { const: 'rewrite' }, index: { type: 'integer' }, text: { type: 'string' } }, required: ['op', 'index', 'text'] },
          { type: 'object', properties: { op: { const: 'describe' }, index: { type: 'integer' }, description: { type: 'string' } }, required: ['op', 'index', 'description'] },
        ],
      },
    },
    resume: { type: 'boolean', description: 'Resume the session after this batch applies (default true).' },
    resume_prompt: { type: 'string', description: 'What the resumed turn is told.' },
    keep_cache: {
      type: 'boolean',
      description:
        'Keep the prompt cache up to the first edit (default false): cheaper when the earliest edit is within your last few calls and you end the turn soon; but if this session is later resumed (--resume, reopening it), earlier answers may show twice.',
    },
  },
  required: ['edits'],
}

// [SP_CTX_02_11] At most MAX_DESCRIPTION chars, by the priorities of the spec.
export const TAG_DESCRIPTION = `Tag rows and tool calls of this conversation and mark the stages of your work, at no token cost: tags and stages live outside the conversation and show in ${LIST}. Call it with {"tags":[...]}; the requests apply in order.

Targets of add and remove: exactly one of "tool_use_id" (a tool call with its result), "ref" (a call alias "cN" or "last") or "index" (a row in ${LIST}); a disposable range: "index" and "to", its last row.

Stages: {"op":"open","stage":"<name>"} at the start of a logical stage; its block starts with the response that opens it, or at "index" if given. {"op":"close"} when the stage is done: the result names the block's rows #a..#b, its size, cleanup candidates, context telemetry and advice; then compress what is processed there with ONE ${EDIT}. Opening a stage closes the open one first. To close a block you did not open, give open with the "index" of its first row and close in one call.

Kinds (op "add"):
- "pin": nothing may edit the target, neither you nor the replacements of disposable tags. The person's first prompt is pinned for you.
- "disposable" + "note": once you close a stage or end a turn with the optimization mark, the target is replaced by your note (a tool result summarized, your text row rewritten, a range collapsed); the original is archived. Write in the note every fact you still need. By index alone only your own assistant text rows.
- "review" (optional "ttl_turns"): a marker for yourself, shown once ttl_turns completed turns have passed. Automatic ones carry a reason: big, search, stale (the file changed since), duplicate.
- "state": your one state slot (task state, plan), an assistant text row by "index"; change it only by a rewrite of that row, never append a new one. A new state tag moves the slot.

A new tag on a target replaces the old one; "remove" drops it. Guide: skill ${PLUGIN}:${SKILL}.`

const TAG_TARGET = {
  tool_use_id: { type: 'string', description: 'Target: a tool call and its result.' },
  ref: { type: 'string', description: 'Target: a tool call by its alias "cN" (from a "[context-editor] id cN" line) or "last", your latest call (context_* calls do not count).' },
  index: { type: 'integer', description: `Target: a row index from ${LIST}.` },
}

// [SP_CTX_02_32] At most MAX_DESCRIPTION chars.
export const NOTE_DESCRIPTION = `Add and remove your own service notes on rows, row ranges and tool calls of this conversation, at no token cost: notes live outside the conversation and change or protect nothing; a target may have several. Call it with {"notes":[...]}; the requests apply in order.

Add: {"op":"add","text":"..."} with a target as in ${TAG} (exactly one of "tool_use_id", "ref" or "index"; a range: "index" and "to"), and optionally "remind_in_turns": N for one reminder after N completed turns, delivered with the result of your next tool call (any tool but context_edit and context_handoff). Remove: {"op":"remove","id":"n3"}.

Notes show in ${LIST} ([n3] on their rows, the full text below the page) and in the result of a stage close. A note moves to the row that replaced its row and goes with a removed row. Use them to mark what to drop or compress later and how, to remind yourself to come back to an output, or to link rows.`

const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_NOTES,
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              op: { const: 'add' },
              text: { type: 'string', maxLength: MAX_NOTE, description: 'The note.' },
              ...TAG_TARGET,
              to: { type: 'integer', description: 'With "index": the last row of a range, included.' },
              remind_in_turns: { type: 'integer', minimum: 1, maximum: MAX_REMIND, description: 'One reminder after this many completed turns.' },
            },
            required: ['op', 'text'],
          },
          { type: 'object', properties: { op: { const: 'remove' }, id: { type: 'string', description: 'The id of the note, e.g. "n3".' } }, required: ['op', 'id'] },
        ],
      },
    },
  },
  required: ['notes'],
}

// [SP_CTX_02_19]
export const HANDOFF_DESCRIPTION = `Move this conversation into a new session and continue there, so a cleaned context survives --resume.

mode "transcript" (default): this session is cleared and the new one is seeded with the conversation as you see it now, with the edits you queued with ${EDIT} applied, tool calls and results kept; images and documents come along as files named in their results (open them with Read). On any failure the "document" way is used.
mode "document": the new session starts from "document", your handoff text (the person's task and constraints verbatim, decisions in force, facts, numbers, paths, open questions, the next step), sent as its first prompt; without it the mod asks the model for one. Give "document" with "transcript" too, as the fallback.

It runs when your turn ends: after this call, end your turn at once with a one-line status. Unless "resume" is false, the new session goes on with "resume_prompt" (default: "${DEFAULT_RESUME}").`

const HANDOFF_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['transcript', 'document'], description: 'How to build the new session (default "transcript").' },
    document: { type: 'string', maxLength: MAX_DOCUMENT, description: 'Your handoff document: the start of a "document" session, the fallback of a "transcript" one.' },
    resume: { type: 'boolean', description: 'Continue in the new session at once (default true).' },
    resume_prompt: { type: 'string', maxLength: MAX_TEXT, description: 'What the new session is told to continue with.' },
  },
}

const TAG_SCHEMA = {
  type: 'object',
  properties: {
    tags: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TAGS,
      items: {
        oneOf: [
          { type: 'object', properties: { op: { const: 'add' }, kind: { const: 'pin' }, ...TAG_TARGET }, required: ['op', 'kind'] },
          {
            type: 'object',
            properties: {
              op: { const: 'add' },
              kind: { const: 'disposable' },
              ...TAG_TARGET,
              to: { type: 'integer', description: 'With "index": the last row of a range, included; the range holds every tool call with its result.' },
              note: { type: 'string', maxLength: MAX_TEXT },
            },
            required: ['op', 'kind', 'note'],
          },
          { type: 'object', properties: { op: { const: 'add' }, kind: { const: 'review' }, ...TAG_TARGET, ttl_turns: { type: 'integer', minimum: 1 } }, required: ['op', 'kind'] },
          {
            type: 'object',
            properties: { op: { const: 'add' }, kind: { const: 'state' }, index: { type: 'integer', description: `Your assistant text row from ${LIST} that holds the state.` } },
            required: ['op', 'kind', 'index'],
          },
          { type: 'object', properties: { op: { const: 'remove' }, ...TAG_TARGET }, required: ['op'] },
          {
            type: 'object',
            properties: {
              op: { const: 'open' },
              stage: { type: 'string', maxLength: MAX_STAGE_NAME, description: 'The name of the stage.' },
              index: { type: 'integer', description: `The first row of its block, from ${LIST}; default: the response that opens it.` },
            },
            required: ['op', 'stage'],
          },
          { type: 'object', properties: { op: { const: 'close' } }, required: ['op'] },
        ],
      },
    },
  },
  required: ['tags'],
}

// [SP_CTX_01_07] [SP_CTX_02_15] The storage of the session: published once
// its preparation ends, one preparation per session id at a time. Every
// operation takes the folder EnsureStorage gives it once and keeps it.
const storage = newStorageMemory()
// [SP_CTX_02_07] The id of the last report an apply of this instance wrote
// and answered without an abandon, and the folder of the apply running now
// (the failure branch writes there).
const applies: { reported?: number; dir?: string } = {}
// [SP_CTX_01_14] The identity of the host process, read once per module
// instance. [SP_CTX_02_18] [SP_CTX_DEC_10] A boundary counts when this host
// process wrote it, or this instance in this session (ownBoundary): one left
// by another process (a resumed session) may name rows the host restored.
const hostId = newHostIdMemo()
const ownBoundary: BoundaryMemory = {}
// [SP_CTX_02_18] What the conversation's start was when the agent last listed it.
const listed: { key?: string } = {}
// [SP_CTX_02] The turn counter of the main conversation.
const turns = newTurns()
// [SP_CTX_02_06] Flush planned, and the last report whose resume was sent.
const flushState = newFlushState()
// [SP_CTX_01_15] The handoff of this module instance; `instance` marks its claims.
const handoff = newHandoffMemory(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
// [SP_CTX_02_12] The result ids of the rows the last compaction returned: in
// stream-json each one passes session.append again, with its tool's origin;
// AutoTag skips them. A turn start ends the copies (they come between turns).
const copied = new Set<string>()
// [SP_CTX_02_35] The result ids of the last tool-result row of the main
// conversation: the anchor of a delivery that follows it.
const anchorMem = newAnchorMemory()
// [SP_CTX_02_37] The request size of the last size check without a hint.
const hintMemo = newHintMemo()

function noteCopies(rows: readonly SessionMessage[] | undefined): void {
  copied.clear()
  for (const id of resultIds(rows ?? [])) copied.add(id)
}

// [SP_CTX_02] [PL_AUD_CTX_P7] One serial chain per kind of storage file, in
// the lock order of CHAIN_RANK: no two read-modify-writes of a file overlap.
const serial = serialChains()

// [PL_AUD_CTX_P7] The host's file system, bound once: every storage file and
// the boundary are read and written through it.
function files($: EngineInterface): FileIO {
  return {
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    move: async (from, to) => (await $.process.run(['mv', from, to]).catch(() => ({ exitCode: -1 }))).exitCode === 0,
    now: () => Date.now(),
  }
}

// [SP_CTX_02] The chain `key`; a chain entered out of the lock order goes to
// the debug log only, and the work still runs.
function chainOf($: EngineInterface, key: ChainKey): Lock {
  return (work, within) => serial(key, work, { ...(within ? { within } : {}), report: text => $.ui.log(text, { to: 'debug' }) })
}

type Stores = { queue: Store<Queue>; tags: Store<TagRegistry>; aliases: Store<AliasRegistry>; deliveries: Store<Deliveries>; journal: Store<Journal> }

// [SP_CTX_01_07] The storage files of the session whose storage is `dir`,
// each on its chain. The status line follows the current session's queue only.
function stores($: EngineInterface, dir: string): Stores {
  const fs = files($)
  return {
    queue: jsonFile(fs, `${dir}/pending.json`, () => ({ ...EMPTY_QUEUE }), parseQueue, {
      lock: chainOf($, 'queue'),
      written: q => {
        if (dir === publishedDir(storage)) $.ui.status(q.edits.length ? `${q.edits.length} context edit(s) queued` : undefined)
      },
    }),
    tags: jsonFile(fs, `${dir}/tags.json`, () => ({ ...EMPTY_REGISTRY }), parseRegistry, { lock: chainOf($, 'tags') }),
    aliases: jsonFile(fs, `${dir}/aliases.json`, () => ({ ...EMPTY_ALIASES, map: {} }), parseAliases, { lock: chainOf($, 'aliases') }),
    deliveries: jsonFile(fs, `${dir}/deliveries.json`, (): Deliveries => ({ items: [] }), parseDeliveries, { lock: chainOf($, 'deliveries') }),
    journal: jsonFile(fs, `${dir}/journal.json`, () => ({ ...EMPTY_JOURNAL, entries: [] }), parseJournal, { lock: chainOf($, 'journal') }),
  }
}

// [SP_CTX_01_14] HOST_ENV: the token of the host process, set once when the
// process has none (the validator takes the name only as a literal), and the
// pid of `claude` as the parent of the command's shell.
async function readHostIdOnce($: EngineInterface): Promise<string | undefined> {
  let token = await $.env.get('CONTEXT_EDITOR_HOST')
  if (!token) {
    token = newHostToken()
    await $.env.set('CONTEXT_EDITOR_HOST', token)
  }
  const ran = await $.process.run(['sh', '-c', 'echo $PPID'])
  return ran.exitCode === 0 ? parseHostId(token, ran.stdout) : undefined
}

// [SP_CTX_01_14] Readers await the identity, so its read is bounded: after
// HOST_ID_WAIT_MS it counts as not read (absent) and no path waits longer.
async function readHostId($: EngineInterface): Promise<string | undefined> {
  return Promise.race([readHostIdOnce($), $.clock.sleep(HOST_ID_WAIT_MS).then(() => undefined)])
}

// [SP_CTX_02_07] The request size before an apply: the plain usage, bounded
// like the identity's read, since a compaction handler never waits long.
const USAGE_WAIT_MS = 500

async function requestTokens($: EngineInterface): Promise<number | undefined> {
  return Promise.race([$.session.usage().then(u => u.context.tokens), $.clock.sleep(USAGE_WAIT_MS).then(() => undefined)])
}

// [SP_CTX_01_14] The one read of this module instance, started on first use.
function hostIdOf($: EngineInterface): Promise<string | undefined> {
  return startHostId(hostId, () => readHostId($))
}

async function readBoundaryText($: EngineInterface, dir: string): Promise<string | undefined> {
  const fs = files($)
  if (!(await fs.exists(`${dir}/boundary.json`))) return undefined
  return fs.read(`${dir}/boundary.json`).catch(() => undefined)
}

// [SP_CTX_02_18] The rows of the current conversation, the transcript from
// the last compaction's head on, and a key that changes with that start.
function view($: EngineInterface): Promise<{ transcript: readonly SessionMessage[]; rows: readonly SessionMessage[]; key: string }> {
  return readView({
    hostId: () => hostIdOf($),
    messages: () => $.session.messages(),
    storage: async () => {
      const st = await ensureStorage($)
      return { sessionId: st.sessionId, dir: dirOf(st) }
    },
    readBoundary: dir => readBoundaryText($, dir),
    own: () => ownBoundary.own,
  })
}

async function conversation($: EngineInterface): Promise<readonly SessionMessage[]> {
  return (await view($)).rows
}

// [SP_CTX_02_18] Indexes from a listing taken before the start moved name other rows.
async function staleIndexes($: EngineInterface): Promise<boolean> {
  return listed.key !== (await view($)).key
}

// [SP_CTX_02_18] RecordBoundary's write into the storage `dir`; once written
// it is the own boundary, when `dir` is the current session's.
async function writeBoundaryAt($: EngineInterface, dir: string, b: Boundary): Promise<void> {
  const write = (text: string) => files($).write(`${dir}/boundary.json`, text)
  if (dir === publishedDir(storage)) await recordBoundary(ownBoundary, write, b)
  else await write(JSON.stringify(b))
}

// [SP_CTX_02_17] Resolves refs for the context_* call `callId`: aliases
// against the registry as it is now (none without storage or from an
// unreadable registry), "last" on the rows the caller reads.
async function resolver($: EngineInterface, dir: string | undefined, callId: unknown): Promise<RefResolver> {
  const id = typeof callId === 'string' && callId ? callId : undefined
  return refResolver(dir ? await stores($, dir).aliases.read() : { state: 'missing', value: { ...EMPTY_ALIASES, map: {} } }, id)
}

// [SP_CTX_02_31] Each change on the journal's own chain, in the background,
// in the storage `at`: the folder of the session the event came in, taken
// when it came, not when the chain's turn comes.
function onJournal($: EngineInterface, work: (io: JournalIO, dir: string) => Promise<void>, at: string | Promise<string | undefined>): void {
  void chainOf($, 'journal')(async () => {
    const dir = await at
    if (dir) await work(stores($, dir).journal, dir)
  }).catch(() => undefined)
}

// [SP_CTX_01_07] The folder of the current session, asked for now; a failure gives none.
function storageNow($: EngineInterface): Promise<string | undefined> {
  return storageDir($).catch(() => undefined)
}

// [SP_CTX_02_35] RecordDelivery's step in event order; a failure records nothing.
function observeOrNone(e: Parameters<typeof observeAppend>[1]): QueuedDelivery | undefined {
  try {
    return observeAppend(anchorMem, e, Date.now())
  } catch {
    return undefined
  }
}

// [SP_CTX_02_02] [SP_CTX_02_11] The deliveries not yet rows, for the person
// warnings only: none when the file is missing or unreadable. `within`: the
// chains the caller holds.
async function deliveredNow($: EngineInterface, dir: string, within?: Held): Promise<readonly QueuedDelivery[]> {
  const d = stores($, dir).deliveries
  const read = await d.onChain(() => d.read(), within).catch((): Read<Deliveries> => ({ state: 'unreadable', reason: 'read failed' }))
  return read.state === 'ok' ? read.value.items : []
}

// [SP_CTX_02_28] The journal's part of the telemetry; a failed read says why.
async function journalNow($: EngineInterface, dir: string | undefined): Promise<JournalSummary | undefined> {
  if (!dir) return undefined
  return journalSummary(await stores($, dir).journal.read().catch((err): Read<Journal> => ({ state: 'unreadable', reason: String(err) })))
}

// [SP_CTX_02_15] PrepareStorage bound to the host. No ready file: the module
// that runs the compaction command also handles it ([C_CTX_DEC_09]).
// `inCompaction`: called from a compaction handler, which never waits for hostId.
function prepareIO($: EngineInterface, inCompaction: boolean): PrepareIO {
  return {
    urgent: inCompaction,
    sessionId: () => $.session.id(),
    home: () => {
      // [SP_CTX_01_14] started here or in session.start, whichever comes first; not awaited
      void hostIdOf($)
      return $.env.get('HOME')
    },
    mkdir: (dir, base) => $.process.run(['sh', '-c', 'umask 077 && mkdir -p "$1" && chmod 700 "$2" "$1"', 'sh', dir, base]),
    // [SP_CTX_02_18] a switch in this process (/clear, /resume): the new
    // session's boundary this process wrote no longer names the rows read here
    after: (prev, now, dir, hurried) =>
      afterPrepare({
        prev,
        now,
        inCompaction,
        hurried,
        wait: () => hostIdOf($),
        peek: () => peekHostId(hostId),
        read: () => readBoundaryText($, dir),
        write: text => files($).write(`${dir}/boundary.json`, text),
        remove: () => removeFile($, `${dir}/boundary.json`),
        toast: text => $.ui.toast(text),
      }),
    published: () => {
      ownBoundary.own = undefined
      listed.key = undefined
    },
    status: text => $.ui.status(text),
  }
}

// [SP_CTX_02_15] A preparation for the session current now, even when it has
// its storage already (the session start).
async function prepareStorage($: EngineInterface): Promise<SessionStorage> {
  return prepareFor(storage, prepareIO($, false), await $.session.id())
}

async function removeFile($: EngineInterface, path: string): Promise<void> {
  const ran = await $.process.run(['rm', '-f', '--', path])
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `rm: exit ${ran.exitCode}`)
}

// [SP_CTX_01_07] /clear or /resume in the same process change the session
// without a session start: the storage follows the current session. The
// folder or why there is none, and the session they belong to.
function ensureStorage($: EngineInterface, inCompaction = false): Promise<SessionStorage> {
  return ensureIn(storage, prepareIO($, inCompaction))
}

// The folder of the current session's storage, or undefined.
async function storageDir($: EngineInterface, inCompaction = false): Promise<string | undefined> {
  return dirOf(await ensureStorage($, inCompaction))
}

// Writes an owner-only text file through the host shell, its folder made: no
// size limit of $.fs.write.
async function writeText($: EngineInterface, path: string, text: string): Promise<boolean> {
  const ran = await $.process
    .run(['sh', '-c', 'umask 077 && mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path], { stdin: text })
    .catch(() => ({ exitCode: -1 }))
  return ran.exitCode === 0
}

// Writes one media file from base64, inside the owner-only storage.
async function writeMedia($: EngineInterface, path: string, data: string): Promise<boolean> {
  const ran = await $.process
    .run(['sh', '-c', 'umask 077 && mkdir -p "$(dirname "$1")" && base64 -d > "$1"', 'sh', path], { stdin: data })
    .catch(() => ({ exitCode: -1 }))
  return ran.exitCode === 0
}

async function apiMessages($: EngineInterface): Promise<readonly unknown[]> {
  return (await $.session.messages({ as: 'api' })) as unknown as readonly unknown[]
}

// The folder a port without storage never reaches: its caller refuses first.
function need(dir: string | undefined): string {
  if (!dir) throw new Error(storageRefusal('no folder for this step'))
  return dir
}

// The read state of a port whose storage is unavailable.
function unavailable<T>(st: StorageState): Read<T> {
  return { state: 'unreadable', reason: storageRefusal('reason' in st ? st.reason : 'no folder') }
}

function queueIO($: EngineInterface, dir: string): QueueIO {
  const q = stores($, dir).queue
  return { readQueue: q.read, writeQueue: q.write, quarantine: q.quarantine, queuePath: q.path }
}

// [SP_CTX_02_16] `dir` undefined: no storage, MarkAlias marks nothing.
function aliasIO($: EngineInterface, dir: string | undefined): AliasIO {
  return {
    ready: async () => dir !== undefined,
    readAliases: () => stores($, need(dir)).aliases.read(),
    writeAliases: reg => stores($, need(dir)).aliases.write(reg),
  }
}

// [SP_CTX_02_06] Flush bound to the host. Its timer comes from the
// turn.complete hook that calls `flushAfterTurn`. Each step takes the storage
// of the session current when it runs.
function flushIO($: EngineInterface): FlushIO {
  return {
    readQueue: async () => {
      const st = await ensureStorage($)
      return 'dir' in st ? stores($, st.dir).queue.read() : unavailable(st)
    },
    updateQueue: async change => {
      const dir = await storageDir($)
      return dir ? updateOf(stores($, dir).queue)(change) : false
    },
    readTags: async () => {
      const st = await ensureStorage($)
      return 'dir' in st ? stores($, st.dir).tags.read() : unavailable(st)
    },
    // one attempt; a refusal rejects with the host's text
    compact: async args => {
      await $.command.run({ command: 'compact', args })
    },
    after: (ms, fn) => void $.clock.after(ms, fn),
    // A refused prompt resolves with `drop`; Flush treats it as a failure.
    submit: text => enteredOrThrow($.prompt.submit({ text })),
    removeDelivered: delivered => removeDelivered($, delivered),
    status: text => $.ui.status(text),
    turns,
  }
}

// [SP_CTX_02_08] RemoveDelivered: the delivered text leaves the current
// session's queue, on its serial chain; Flush's after its own prompt.
async function removeDelivered($: EngineInterface, delivered: string): Promise<void> {
  const dir = await storageDir($)
  if (dir) await updateOf(stores($, dir).queue)(q => withoutReport(q, delivered))
}

// [SP_CTX_02_28] The usage with the breakdown the telemetry reads (no API request).
function usageInfo($: EngineInterface): Promise<UsageInfo> {
  return $.session.usage({ breakdown: 'summary' })
}

// [SP_CTX_02_33] The due reminders after one of the mod's own tools, on the
// registry's chain, called once the tool's own work left every chain; none
// for a subagent or a refused call, nor after context_edit and
// context_handoff (remindsAfter).
async function dueLines($: EngineInterface): Promise<string[]> {
  const dir = await storageDir($).catch(() => undefined)
  if (!dir) return []
  return stores($, dir)
    .tags.onChain(() => noteReminders(tagIO($, dir)))
    .catch((): string[] => [])
}

async function remindAfter<T extends object>($: EngineInterface, tool: string, agentId: unknown, out: T): Promise<T> {
  if (agentId || 'deny' in out || !remindsAfter(tool)) return out
  return withReminderLines(out, await dueLines($))
}

// [SP_CTX_02_37] SoftHint bound to the host in the storage `dir`: the plain
// usage first, the breakdown only for the size trigger, the calibration in
// the background (SoftHint does not wait for it), the hint state on the
// registry's chain (true when written).
function hintIO($: EngineInterface, dir: string): HintIO {
  const s = stores($, dir)
  return {
    readTags: s.tags.read,
    readAliases: () => s.aliases.onChain(() => s.aliases.read()),
    readQueue: s.queue.read,
    rows: () => conversation($),
    request: async () => {
      const u = await $.session.usage()
      return { tokens: u.context.tokens, window: u.context.window }
    },
    usage: () => usageInfo($),
    // [SP_CTX_02_38] the responses of the rows and the model's cost ratios
    api: () => apiMessages($),
    model: () => $.session.model(),
    updateTags: updateOf(s.tags),
    changeTags: changeOf(s.tags),
  }
}

// [SP_CTX_02_37] The size channel's suggestion after a marked output. Never
// longer than HINT_WAIT_MS.
async function hintFor($: EngineInterface): Promise<string | undefined> {
  const dir = await storageDir($).catch(() => undefined)
  if (!dir) return undefined
  return bounded(
    d => softHint(hintIO($, dir), hintMemo, d).then(o => o.line),
    () => $.clock.sleep(HINT_WAIT_MS),
  )
}

// [SP_CTX_02_37] The turn channel's suggestion for the person's prompt
// between turns. Never longer than HINT_WAIT_MS.
function suggestionFor($: EngineInterface, dir: string): Promise<string | undefined> {
  return bounded(
    d => turnSuggestion(hintIO($, dir), hintMemo, d).then(o => o.line),
    () => $.clock.sleep(HINT_WAIT_MS),
  )
}

// [SP_CTX_02_29] BlockReport bound to the host. [SP_CTX_02_34]
// [SP_CTX_02_28] A change of the telemetry (a new calibration, the measured
// apply consumed) goes into the registry in `dir`, on its chain.
function blockIO($: EngineInterface, dir: string): BlockIO {
  const s = stores($, dir)
  return {
    key: async () => (await view($)).key,
    rows: () => conversation($),
    readTags: s.tags.read,
    updateTags: updateOf(s.tags),
    media: async () => collectMedia(await apiMessages($), await conversation($)).found,
    usage: () => usageInfo($),
    journal: async () => (await journalNow($, dir)) ?? { applications: 0, rereads: 0, archiveRereads: 0 },
    setListed: key => {
      listed.key = key
    },
  }
}

// [SP_CTX_02_30] DetectOptimize bound to the host in the storage `dir`
// (undefined: none, the mark is ignored): each queue change on the queue's
// chain, each registry change on the registry's, never one inside the other.
function detectIO($: EngineInterface, dir: string | undefined): DetectIO {
  const s = () => stores($, need(dir))
  return {
    ready: async () => dir !== undefined,
    readQueue: async () => s().queue.read(),
    changeQueue: async change => changeOf(s().queue)(change),
    changeTags: async change => changeOf(s().tags)(change),
    rows: () => conversation($),
    replace: async () => s().queue.onChain(() => queueTagReplacements(tagIO($, dir))),
    status: text => $.ui.status(text),
  }
}

// [SP_CTX_02_21] The handoff bound to the host. Its timers come from the
// turn.complete hook or the /handoff command that calls in.
function handoffIO($: EngineInterface): HandoffIO {
  return {
    now: () => Date.now(),
    turns,
    after: (ms, fn) => void $.clock.after(ms, fn),
    sleep: ms => $.clock.sleep(ms),
    sessionId: () => $.session.id(),
    storage: async () => {
      const st = await ensureStorage($)
      return 'dir' in st ? { dir: st.dir } : { reason: st.reason }
    },
    readQueue: dir => stores($, dir).queue.read(),
    changeQueue: (dir, change) => changeOf(stores($, dir).queue)(change),
    view: () => view($),
    readApi: () => apiMessages($),
    readTags: dir => stores($, dir).tags.read(),
    // [SP_CTX_02_22] the deliveries go into the seed as rows
    readDeliveries: dir => {
      const d = stores($, dir).deliveries
      return d.onChain(() => d.read())
    },
    changeTags: (dir, change) => changeOf(stores($, dir).tags)(change),
    listSeeds: async dir => {
      const ran = await $.process.run(['sh', '-c', 'for f in "$1"/*/seed.json; do [ -f "$f" ] && basename "$(dirname "$f")"; done; true', 'sh', dir])
      return ran.stdout
        .split('\n')
        .map(s => s.trim())
        .filter(s => /^\d+$/.test(s))
        .map(Number)
    },
    writeMedia: (path, data) => writeMedia($, path, data),
    writeText: (path, text) => writeText($, path, text),
    remove: async path => {
      await $.process.run(['rm', '-rf', '--', path])
    },
    // [SP_CTX_02_21] the storage folders are owner-only (700)
    carryTags: (from, to, change) => carry(stores($, from).tags, stores($, to).tags, change, 'the tag registry'),
    carryAliases: (from, to, change) => carry(stores($, from).aliases, stores($, to).aliases, change, 'the alias registry'),
    // [C_CTX_DEC_13] one attempt; the host's refusal is never swallowed: it rejects with its text
    runCommand: async (command, args) => {
      await $.command.run({ command, args: args ?? '' })
    },
    fork: async prompt => {
      const r = await $.model.fork({ prompt })
      if (!r.isAnswered) throw new Error(`no reply: ${r.reason}`)
      return r.text
    },
    // A refused prompt resolves with `drop`; the handoff treats it as a failure.
    submit: text => enteredOrThrow($.prompt.submit({ text })),
    toast: text => $.ui.toast(text),
    status: text => $.ui.status(text),
  }
}

// [SP_CTX_02_26] HandleSeed bound to the host: the boundary goes to the
// storage of the session the compaction runs in, the new one.
function seedIO($: EngineInterface): SeedIO {
  return {
    sessionId: () => $.session.id(),
    recordBoundary: async b => {
      const dir = await storageDir($, true)
      if (dir) await writeBoundaryAt($, dir, b)
    },
    hostId: () => peekHostId(hostId),
  }
}

// [SP_CTX_02_11] The registry's port in the storage `dir`; undefined: none,
// and the caller refuses before it reads.
function tagIO($: EngineInterface, dir: string | undefined): TagIO {
  const s = () => stores($, need(dir))
  return {
    rows: () => conversation($),
    readTags: () => s().tags.read(),
    writeTags: reg => s().tags.write(reg),
    readQueue: () => s().queue.read(),
    writeQueue: q => s().queue.write(q),
  }
}

// [SP_CTX_02_03] The pinned targets on `rows`; none while the registry is
// unreadable, which HandleCompaction then reports for every edit.
async function pins($: EngineInterface, dir: string, rows: readonly SessionMessage[]) {
  const read = await stores($, dir).tags.read()
  return read.state === 'unreadable' ? NO_PINS : pinnedTargets(rows, read.value)
}

// [SP_CTX_02_01] Stage marks, then tag labels, for the listing, if the
// storage and registry allow; the registry read for the telemetry.
async function labels($: EngineInterface, dir: string | undefined, rows: readonly SessionMessage[]) {
  const none = new Map<number, string[]>()
  if (!dir) return { labels: none, note: '', reg: undefined, notes: [] }
  const read = await stores($, dir).tags.read()
  if (read.state === 'unreadable') return { labels: none, note: `\n(tags, stages and notes not shown: the tag registry cannot be read: ${read.reason})`, reg: undefined, notes: [] }
  const merged = markLabels(rows, read.value)
  for (const [i, list] of tagLabels(rows, read.value)) merged.set(i, [...(merged.get(i) ?? []), ...list])
  // [SP_CTX_02_01] the notes after the tags; their full text under the page
  for (const [i, list] of noteLabels(rows, read.value)) merged.set(i, [...(merged.get(i) ?? []), ...list])
  return { labels: merged, note: '', reg: read.value, notes: noteLines(rows, read.value) }
}

// [SP_CTX_02_01] Aliases for the listing, if the storage and registry allow.
async function aliasNames($: EngineInterface, dir: string | undefined) {
  if (!dir) return { aliases: new Map<string, string>(), note: '' }
  const read = await stores($, dir).aliases.read()
  if (read.state === 'unreadable') return { aliases: new Map<string, string>(), note: `\n(aliases not shown: the alias registry cannot be read: ${read.reason})` }
  return { aliases: aliasesById(read.value), note: '' }
}

// [SP_CTX_02_16] [SP_CTX_02_31] After a call without error: a write tool
// marks the earlier reads of its path stale (R4) and journals the change of a
// compressed path; a Read journals a reread of compressed content or of an
// archive. Each on its own chain, in the background.
function afterCall($: EngineInterface, tool: string, input: Record<string, unknown>, id: string, isError: boolean): void {
  const next = callFollowUp(tool, input, isError)
  if (!next) return
  // the folder of the session the call ran in, taken now
  const at = storageNow($)
  if ('write' in next) {
    void chainOf($, 'tags')(async () => {
      const dir = await at
      if (dir) await staleReads(tagIO($, dir), next.write, id)
    }).catch(() => undefined)
    onJournal($, io => journalChanged(io, next.write, Date.now()), at)
  } else onJournal($, (io, dir) => journalReread(io, next.read, id, dir, Date.now()), at)
}

function deny(reason: string) {
  return { deny: `${PLUGIN}: ${reason}` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // [SP_CTX_01_14] the identity's one read starts here or in the first PrepareStorage
    void hostIdOf($)
    await $.tool.register({
      name: LIST,
      description: LIST_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'integer', description: 'Index of the first row to list (default 0, the oldest).' },
          count: { type: 'integer', description: `How many rows to list (default ${LIST_COUNT}, at most 200); 0 gives the header with the context telemetry alone.` },
          index: { type: 'integer', description: 'With "full": true, the row to show whole.' },
          full: { type: 'boolean', description: 'Show the row "index" whole (up to 20000 chars), e.g. to check a summary before reading an archive; from and count are ignored.' },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({ name: EDIT, description: EDIT_DESCRIPTION, inputSchema: EDIT_SCHEMA, isDeferred: false })
    await $.tool.register({ name: TAG, description: TAG_DESCRIPTION, inputSchema: TAG_SCHEMA, isDeferred: false })
    await $.tool.register({ name: HANDOFF, description: HANDOFF_DESCRIPTION, inputSchema: HANDOFF_SCHEMA, isDeferred: false })
    await $.tool.register({ name: NOTE, description: NOTE_DESCRIPTION, inputSchema: NOTE_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'handoff', description: 'Move this conversation into a new session: cleaned transcript, or a handoff document', argumentHint: '[document|cancel]' })
    await prepareStorage($)
    return next(e)
  })

  // [SP_CTX_02_01]
  on('tool.call', { tool: 'mcp__context-editor__context_list' }, async ($, e) => {
    if (e.agentId) return deny('only the main conversation can be listed and edited.')
    const args = e as unknown as { from?: unknown; count?: unknown; index?: unknown; full?: unknown }
    const { rows, key } = await view($)
    const mode = listMode(args, rows.length)
    if ('bad' in mode) return deny(mode.bad)
    const { found } = collectMedia(await apiMessages($), rows)
    const dir = await storageDir($)
    const tagged = await labels($, dir, rows)
    // [SP_CTX_02_01] one row whole: no telemetry, no new listedKey
    if ('full' in mode) {
      const own = tagged.reg ? rowNotes(rows, tagged.reg, mode.full) : []
      const result = fullRow(rows, mode.full, found, tagged.labels.get(mode.full) ?? [], own) + tagged.note
      return withReminderLines({ result }, await dueLines($))
    }
    const named = await aliasNames($, dir)
    const { from, count } = mode.page
    // [SP_CTX_02_28] a failed telemetry never fails the listing; [SP_CTX_02_34] it calibrates the estimates
    let tele: string
    let size: string | undefined
    try {
      // [SP_CTX_02_33] counted as if this call's due reminders were delivered;
      // they are delivered only once the listing is built (a failure keeps them)
      const update = dir ? updateOf(stores($, dir).tags) : undefined
      const t = await telemetry(rows, tagged.reg && afterReminders(tagged.reg), () => usageInfo($), update, await journalNow($, dir))
      tele = telemetryText(t)
      size = headerSize(t, totalChars(rows))
    } catch (err) {
      tele = `Context: size unavailable (${err instanceof Error ? err.message : String(err)})`
    }
    const text = listRows(rows, from, count, found, tagged.labels, named.aliases, tele, tagged.notes, size)
    // [SP_CTX_02_18] only a listing with rows the agent receives renews its indexes
    if (count >= 1) listed.key = key
    return withReminderLines({ result: text + tagged.note + named.note }, await dueLines($))
  }).catch(($, e, next) => (next.called ? next(e) : deny(`listing failed: ${next.error.kind}`)))

  // [SP_CTX_02_02]
  on('tool.call', { tool: 'mcp__context-editor__context_edit' }, async ($, e) => {
    if (e.agentId) return deny("a subagent's context cannot be edited; only the main conversation's.")
    const st = await ensureStorage($)
    if ('reason' in st) return deny(storageRefusal(st.reason))
    const { dir } = st
    const args = e as unknown as { edits?: unknown; resume?: unknown; resume_prompt?: unknown; keep_cache?: unknown }
    const out = await stores($, dir).queue.onChain(async held => {
      const { rows, key } = await view($)
      // [SP_CTX_02_10] the API form is read only for a describe
      const found = needsApi(args) ? collectMedia(await apiMessages($), rows).found : undefined
      return contextEdit(queueIO($, dir), rows, args, await pins($, dir, rows), await resolver($, dir, e.tool_use_id), listed.key !== key, hasMediaFrom(found), await deliveredNow($, dir, held))
    })
    // [SP_CTX_02_33] no reminder: this call goes with the apply it triggers (DropOwnCalls)
    return 'deny' in out ? deny(out.deny) : out
  }).catch(($, e, next) => (next.called ? next(e) : deny(`queueing failed: ${next.error.kind}`)))

  // [SP_CTX_02_11]
  on('tool.call', { tool: 'mcp__context-editor__context_tag' }, async ($, e) => {
    const args = e as unknown as TagArgs
    const st = e.agentId ? undefined : await ensureStorage($)
    const dir = st && dirOf(st)
    // the registry's read-modify-write on its chain; the replacements on the
    // queue's afterwards, never one chain inside the other; the deliveries
    // read inside the registry's chain (tags → deliveries)
    let held: Held | undefined
    const io: TagIO = {
      ...tagIO($, dir),
      onRegistry: work =>
        chainOf($, 'tags')(h => {
          held = h
          return work().finally(() => (held = undefined))
        }),
      replace: () => chainOf($, 'queue')(() => queueTagReplacements(tagIO($, dir))),
      report: (block, replaced) => blockReport(blockIO($, need(dir)), block, replaced),
      deliveries: () => deliveredNow($, need(dir), held),
    }
    const out = await contextTag(
      io,
      { agentId: e.agentId, tags: args.tags },
      st && 'reason' in st ? st.reason : undefined,
      e.agentId ? NO_REFS : await resolver($, dir, e.tool_use_id),
      !!dir && (await staleIndexes($)),
      typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined,
    )
    return 'deny' in out ? deny(out.deny) : remindAfter($, TAG, e.agentId, { result: out.result })
  }).catch(($, e, next) => (next.called ? next(e) : deny(`tagging failed: ${next.error.kind}`)))

  // [SP_CTX_02_32] The registry's read-modify-write on its chain. A regex, as
  // for context_handoff: the host's generated types list a new tool only once
  // a session has loaded it.
  on('tool.call', { tool: /^mcp__context-editor__context_note$/ }, async ($, e) => {
    const args = e as unknown as NoteArgs
    const st = e.agentId ? undefined : await ensureStorage($)
    const dir = st && dirOf(st)
    const out = await contextNote(
      { ...tagIO($, dir), onRegistry: work => chainOf($, 'tags')(work) },
      { agentId: e.agentId, notes: args.notes },
      st && 'reason' in st ? st.reason : undefined,
      e.agentId ? NO_REFS : await resolver($, dir, e.tool_use_id),
      !!dir && (await staleIndexes($)),
    )
    return 'deny' in out ? deny(out.deny) : remindAfter($, NOTE, e.agentId, { result: out.result })
  }).catch(($, e, next) => (next.called ? next(e) : deny(`noting failed: ${next.error.kind}`)))

  // [SP_CTX_02] The turn counter: every turn of the main conversation counts;
  // the mod's own commands raise no turn events.
  on('turn.start', async ($, e, next) => {
    turnStarted(turns)
    // [SP_CTX_02_12] the copies of the last compaction came before this turn
    copied.clear()
    return next(e)
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_19] It only queues the request: the end of the turn runs it. A
  // regex: the host's generated types do not list this tool until a session
  // has loaded it; a string literal is the goal once they do.
  on('tool.call', { tool: /^mcp__context-editor__context_handoff$/ }, async ($, e) => {
    const out = await contextHandoff(handoffIO($), handoff, { ...(e as unknown as HandoffArgs), agentId: e.agentId })
    // [SP_CTX_02_33] no reminder: the seed drops this call (DropOwnCalls)
    return 'deny' in out ? deny(out.deny) : out
  }).catch(($, e, next) => (next.called ? next(e) : deny(`handoff failed: ${next.error.kind}`)))

  // [SP_CTX_02_20] A handler no turn waits on: its deferred action may run commands.
  on('command.run', { command: 'handoff' }, async ($, e) => ({ text: await handoffCommand(handoffIO($), handoff, e.args) })).catch(($, e, next) =>
    // [SP_CTX_02_20] no mod prefix: the host shows the reply under the plugin's name
    next.called ? next(e) : { text: `handoff failed: ${next.error.kind}` },
  )

  // [SP_CTX_02_12] The row is stored first and returned unchanged; the rules
  // run after it, on the registry's chain, and never hold the row back. A row
  // of plugin origin (a compaction's copy, a plugin's note) is no new row, nor
  // a result row the last compaction returned (it comes with its tool's origin).
  on('session.append', async ($, e, next) => {
    // [SP_CTX_02_35] The anchor moves in event order, before `next` awaits:
    // two appends in flight cannot swap it. observeAppend is sync and reads
    // pinned fields only; a refused row (only a plugin's `note` can be) records nothing.
    const item = observeOrNone(e)
    const rules = !e.agentId && (e.door === 'prompt' || e.door === 'tool-result')
    // [SP_CTX_01_07] the folder of the session the row comes in, asked for at the event
    const at = item || rules ? storageNow($) : undefined
    const stored = await next(e)
    try {
      // [SP_CTX_02_35] RecordDelivery in the background
      if (stored.deny === undefined) {
        if (item)
          void chainOf($, 'deliveries')(async () => {
            const dir = await at
            if (dir) await recordDelivery(stores($, dir).deliveries, item, MAX_QUEUE_BYTES)
          }).catch(() => undefined)
      }
      if (rules && stored.deny === undefined) {
        const facts = appendFacts(e)
        // decided now: the next compaction or turn start changes the set
        const copy = isCompactionCopy(facts, copied)
        void chainOf($, 'tags')(async () => {
          const dir = await at
          if (dir) await autoTag(tagIO($, dir), facts, copy)
        }).catch(() => undefined)
      }
    } catch {
      // the stored row stands whatever the rules did
    }
    return stored
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02] [SP_CTX_02_30] [SP_CTX_02_12] [SP_CTX_02_06] [SP_CTX_02_21]
  // The end of a turn of the main conversation: the counter first; then, in
  // the background and in this order, DetectOptimize, the registry's turn
  // count (the mark compares with the count not yet raised) and Flush (once
  // the mark's replacements and request are queued); the handoff besides. The
  // deferred actions planned here have an origin the host queues commands from.
  on('turn.complete', async ($, e, next) => {
    // nothing starts while the turn ends: the counter moves whatever `next` does
    if (!e.agentId) turnCompleted(turns, e.isAborted)
    const done = await next(e)
    if (e.agentId) return done
    const answer = typeof e.answer === 'string' ? e.answer : ''
    void (async () => {
      // [SP_CTX_02_30] the storage of the session whose turn ended, for the mark and the count
      const dir = await storageDir($).catch(() => undefined)
      await detectOptimize(detectIO($, dir), { aborted: e.isAborted, answer }).catch(() => undefined)
      if (!e.isAborted && dir)
        await stores($, dir)
          .tags.onChain(() => countTurn(tagIO($, dir)))
          .catch(() => undefined)
      await flushAfterTurn(flushIO($), flushState, e.isAborted).catch(() => undefined)
    })()
    void handoffAfterTurn(handoffIO($), handoff, e.isAborted).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_07] [SP_CTX_02_26] The mod's own compactions, by `instructions`,
  // under any trigger but precompute. [SP_CTX_02_18] Any other compaction of
  // the main conversation that stands moves its start too; a precomputed one
  // stands only when it is used. (One hook: the host takes one unmatched
  // `session.compact` hook per module.)
  on('session.compact', async ($, e, next) => {
    const route = compactionRoute(e)
    if (route === 'pass') {
      const done = await next(e)
      // [SP_CTX_02_12] its returned result rows may pass session.append again
      if (!e.agentId && done.skip === undefined) noteCopies(done.messages)
      try {
        // [SP_CTX_01_14] a compaction handler never waits for hostId
        const b = observedBoundary(e, done, peekHostId(hostId))
        const dir = b && (await storageDir($, true))
        if (b && dir) {
          await writeBoundaryAt($, dir, b)
          // [SP_CTX_01_10] another compaction is no apply of the mod: nothing of it to measure
          void updateOf(stores($, dir).tags)(reg => (reg.lastApply ? dropLastApply(reg) : undefined)).catch(() => undefined)
        }
      } catch {
        // a failed write leaves the previous boundary; the compaction stands
      }
      return done
    }
    if (route === 'seed') {
      const seeded = await handleSeed(seedIO($), handoff, e.messages)
      if ('messages' in seeded) noteCopies(seeded.messages)
      return seeded
    }
    applies.dir = undefined
    const dir = await storageDir($, true)
    if (!dir) return { skip: `${PLUGIN}: storage unavailable` }
    applies.dir = dir
    // [SP_CTX_02_07] the report counts as the apply's only once the handler
    // returned without an abandon; set on the queue's chain, before the
    // failure branch's write queued behind it reads it
    let wrote: number | undefined
    const s = stores($, dir)
    const outcome = await s.queue.onChain(async q => {
      const done = await handleCompaction(
        {
          dir,
          now: () => Date.now(),
          readQueue: s.queue.read,
          writeQueue: s.queue.write,
          readApi: () => apiMessages($),
          writeMedia: (path, data) => writeMedia($, path, data),
          writeArchive: (path, text) => writeText($, path, text),
          isAborted: () => next.signal.aborted,
          toast: text => $.ui.toast(text),
          readTags: s.tags.read,
          writeTags: s.tags.write,
          readAliases: s.aliases.read,
          writeAliases: s.aliases.write,
          // [SP_CTX_02_07] the commit holds the registry's chain, then the
          // alias registry's, inside the queue's: the order queue → tags → aliases
          onRegistries: work => s.tags.onChain(t => s.aliases.onChain(() => work(), t), q),
          reported: id => void (wrote = id),
          writeBoundary: b => writeBoundaryAt($, dir, b),
          hostId: () => peekHostId(hostId),
          // [SP_CTX_02_07] the plain usage: no breakdown, no API request
          requestTokens: () => requestTokens($),
          // [SP_CTX_02_31] on the journal's chain, never awaited here
          journal: entry => onJournal($, io => journalApply(io, entry), dir),
          // [SP_CTX_02_07] [SP_CTX_02_36] on the deliveries' chain
          readDeliveries: () => s.deliveries.onChain(() => s.deliveries.read(), q),
          pruneDeliveries: done => void s.deliveries.onChain(() => pruneDeliveries(s.deliveries, done), q).catch(() => undefined),
        },
        e.messages,
      )
      if (wrote !== undefined && !next.signal.aborted) applies.reported = wrote
      return done
    })
    if ('messages' in outcome) noteCopies(outcome.messages)
    return outcome
  }).catch(($, e, next) => {
    // Never let a failure fall through to a real, summarizing compaction:
    // answer at once, and record a failed batch in the background.
    const out = compactionFailure(e)
    if ('pass' in out) return next(e)
    // [SP_CTX_02_07] in the apply's folder; nothing when the apply reached its
    // commit point first and was not abandoned
    const dir = applies.dir ?? publishedDir(storage)
    if (out.recordFailure && dir) void changeOf(stores($, dir).queue)(read => failureRecord(read, applies.reported, next.error.kind, Date.now())).catch(() => undefined)
    return { skip: out.skip }
  })

  // [SP_CTX_02_16] After any other tool call of the main loop: the alias line
  // of a call worth editing, then on a marked output the suggestion of the
  // size channel, a line of its own ([SP_CTX_02_37]; it only informs), then
  // the due reminders of the agent's own notes ([SP_CTX_02_33]). It never
  // changes the result itself; a failure only drops its line. The alias
  // chain, then the registry's chain, one after the other.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || done.deny !== undefined || String(e.tool).startsWith(OWN_TOOLS)) return done
    const facts = callFacts(e, done)
    if (!remindable(facts)) return done
    const lines: string[] = []
    const marked = wantsMark(facts)
    // [SP_CTX_01_07] the folder of the session the call ran in, taken now
    const alias = marked
      ? await storageNow($)
          .then(dir => chainOf($, 'aliases')(() => markAlias(aliasIO($, dir), facts)))
          .catch(() => undefined)
      : undefined
    const hint = marked ? await hintFor($).catch(() => undefined) : undefined
    lines.push(...callLines(marked, alias, hint))
    lines.push(...(await dueLines($)))
    // [SP_CTX_02_16] R4 and the journal in the background, queued only once the
    // lines are built: the result waits for neither (the reminders above share
    // the registry's chain with R4)
    afterCall($, String(e.tool), e as unknown as Record<string, unknown>, facts.tool_use_id!, done.isError === true)
    return withContext(done, lines)
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_08] [SP_CTX_02_27] The next prompt of the person (or another
  // plugin) carries the session intro once, the report and the advice of an
  // unserved optimization request; each leaves only once that prompt has
  // entered. The host skips this hook for prompts the mod submits itself.
  on('prompt.submit', async ($, e, next) => {
    const dir = await storageDir($)
    if (!dir) return next(e)
    const s = stores($, dir)
    return deliverReport({
      readQueue: s.queue.read,
      intro: async () => introFor(await s.tags.read()),
      advice: async () => adviceFor(await s.tags.read()),
      inTurn: () => turns.inTurn,
      enter: context => (context.length ? next({ ...e, context: [...(e.context ?? []), ...context] }) : next(e)),
      markIntroduced: async () => void (await changeOf(s.tags)(withIntroduced)),
      // [SP_CTX_02_08] DeliverReport's write once the prompt entered: the
      // report, the optimization request and the loop guard, on the queue's
      // chain, in the storage the prompt's delivery read
      settle: async done => void (await updateOf(s.queue)(q => settledQueue(q, done))),
      // [SP_CTX_02_37] the turn channel, between turns only
      suggestion: () => suggestionFor($, dir),
    })
  }).catch(($, e, next) => next(e))
}
