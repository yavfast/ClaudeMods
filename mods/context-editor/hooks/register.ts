import type { EngineInterface, Register, SessionMessage } from 'claude-code'
import {
  aliasesById,
  callFacts,
  EMPTY_ALIASES,
  markCall,
  parseAliases,
  refResolver,
  wantsMark,
  withContext,
  type AliasIO,
  type AliasRegistry,
} from './aliases'
import { failedQueue, handleCompaction, observedBoundary } from './compaction'
import {
  collectMedia,
  currentRows,
  listRows,
  LIST_COUNT,
  MAX_QUEUE_EDITS,
  MAX_TEXT,
  NO_PINS,
  NO_REFS,
  OWN_TOOLS,
  parseBoundary,
  type Boundary,
  type RefResolver,
} from './edits'
import { cancelHandoff, HANDOFF_DELAY_MS, handoffDue, queueHandoff, runHandoff, type HandoffArgs, type HandoffIO } from './handoff'
import { contextEdit, DEFAULT_RESUME, deliverReport, EMPTY_QUEUE, MAX_DOCUMENT, parseQueue, withoutReport, type Queue, type QueueIO, type Read } from './queue'
import {
  activeReviews,
  appendFacts,
  autoTag,
  contextTag,
  countTurn,
  EMPTY_REGISTRY,
  MAX_TAGS,
  nudge,
  parseRegistry,
  pinnedTargets,
  queueTagReplacements,
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
// [SP_CTX_01_12]
export const MARKER = `${PLUGIN}: apply queued edits`
const HEARTBEAT_MS = 5_000

export const LIST_DESCRIPTION = `List this conversation's rows OLDEST FIRST, a page at a time, with indexes, sizes, tool_use ids (with their call alias, e.g. (c3), when they have one), media, flags (* already edited, ! large, @ has media) and tags ([pin], [disposable: note], [review]), so you can choose what to compact with ${EDIT}. Call it right before ${EDIT}: indexes are positions in this listing. Only the latest 4096 rows are visible.`

export const EDIT_DESCRIPTION = `Edit your own earlier context to free space: replace tool outputs you have already processed (text, screenshots, images, documents), dead-end steps and wrong conclusions with compact summaries.

Edits apply when your current turn ends, not at once: after this call, end your turn with a one-line status. Unless "resume" is false, the session then resumes by itself with "resume_prompt" (default: "${DEFAULT_RESUME}").

Ops (items of "edits"; every field shown is required):
- {"op":"summarize","tool_use_id" or "ref","summary"}: replace one tool result, with any image or document in it, by your summary of what mattered (describe the media too). Parallel calls whose results share a row: summarize the ones with media in one batch.
- {"op":"drop","tool_use_id" or "ref"}: remove a useless tool call and its result.
- {"op":"collapse","from_index","to_index","summary"}: replace rows from_index..to_index (from ${LIST}) with one summary; the range must hold every tool call together with its result.
- {"op":"rewrite","index","text"}: replace the text of one of your assistant text rows (no tool calls in it), e.g. a conclusion that turned out wrong.

Calls worth editing carry a line "[context-editor] id cN" after their result: "ref":"cN" targets that call and "ref":"last" the latest marked one, with no ${LIST} call. A target tagged [pin] cannot be edited; remove the pin with ${TAG} first.

Clean from the start of the conversation: the oldest processed spans go first, since attention degrades with length; prefer one large collapse of an early span over many small edits.

Summaries must keep every fact, number, URL and source you may still need: the originals leave your context (they are archived to files named in the summary, which you can Read). Batch edits in one call; edit only when it frees a lot, since each edit invalidates the prompt cache from the edited row on.`

// [SP_CTX_01_02] [SP_CTX_02_17] A call alias; exactly one of it and tool_use_id.
const REF = { type: 'string', description: 'Instead of tool_use_id: a call alias "cN" from a "[context-editor] id cN" line, or "last" for the most recently marked call.' }

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
        ],
      },
    },
    resume: { type: 'boolean', description: 'Resume the session after this batch applies (default true).' },
    resume_prompt: { type: 'string', description: 'What the resumed turn is told.' },
  },
  required: ['edits'],
}

export const TAG_DESCRIPTION = `Tag rows and tool calls of this conversation ahead of time, at no token cost (tags live outside the conversation and show in ${LIST}). Each item of "tags" names its target by exactly one of "tool_use_id" (a tool call with its result), "ref" (a call alias) or "index" (a row in ${LIST}). Calls worth tagging (large outputs, search results) carry a line "[context-editor] id cN" right after their result: "ref":"cN" targets that call and "ref":"last" the most recently marked one, so you can tag right after reading, with no ${LIST} call.

Kinds:
- "pin": nothing may edit the target, neither you nor the automatic replacements. The person's first prompt is pinned for you.
- "disposable" + "note": once the context passes the next reminder threshold, the target is replaced by your note by itself (a tool result is summarized, an assistant text row rewritten); the original is archived. Write in the note every fact you still need. By index only your own assistant text rows can be disposable.
- "review" (optional "ttl_turns"): a marker for yourself; it shows in ${LIST} once ttl_turns completed turns have passed. Large tool outputs and search results are marked for you.

{"op":"remove"} with the same target removes its tag. A new tag on a target replaces the old one.`

const TAG_TARGET = {
  tool_use_id: { type: 'string', description: 'Target: a tool call and its result.' },
  ref: { type: 'string', description: 'Target: a tool call by its alias "cN" (from a "[context-editor] id cN" line) or "last", the most recently marked call.' },
  index: { type: 'integer', description: `Target: a row index from ${LIST}.` },
}

// [SP_CTX_02_19]
export const HANDOFF_DESCRIPTION = `Move this conversation into a new session and continue there, so a cleaned context survives --resume.

mode "transcript" (default): the conversation as you see it now, with the edits you queued with ${EDIT} applied, becomes a new session the host opens; on any failure the "document" way is used.
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
          { type: 'object', properties: { op: { const: 'add' }, kind: { const: 'disposable' }, ...TAG_TARGET, note: { type: 'string', maxLength: MAX_TEXT } }, required: ['op', 'kind', 'note'] },
          { type: 'object', properties: { op: { const: 'add' }, kind: { const: 'review' }, ...TAG_TARGET, ttl_turns: { type: 'integer', minimum: 1 } }, required: ['op', 'kind'] },
          { type: 'object', properties: { op: { const: 'remove' }, ...TAG_TARGET }, required: ['op'] },
        ],
      },
    },
  },
  required: ['tags'],
}

// [SP_CTX_01_07] The session's storage, set up at session start.
const storage: { dir?: string; sessionId?: string; reason: string } = { reason: 'not prepared yet' }
// The threshold the model was last reminded at ([SP_CTX_02_09]).
const nudged = { level: -1 }
// [SP_CTX_02_18] The boundary file counts once this process wrote it: one
// left by another process (a resumed session) may name rows the host restored.
const boundary = { trusted: false }
// [SP_CTX_02_18] What the conversation's start was when the agent last listed it.
const listed: { key?: string } = {}
// [SP_CTX_02_21] One RunHandoff scheduled or running in this process at a time.
const handoff = { scheduled: false, turnsStarted: 0, inTurn: false, requestTurn: -1 }
// [SP_CTX_02] One serial chain per file: no two read-modify-writes overlap.
const chains = new Map<string, Promise<unknown>>()

function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).then(work, work)
  chains.set(key, next.catch(() => undefined))
  return next
}

// [SP_CTX_02_18] The rows of the current conversation, the transcript from
// the last compaction's head on, and a key that changes with that start.
async function view($: EngineInterface): Promise<{ rows: readonly SessionMessage[]; key: string }> {
  const transcript = await $.session.messages()
  const dir = await ensureStorage($)
  if (!dir || !boundary.trusted) return { rows: transcript, key: `${storage.sessionId}|` }
  const text = await $.fs.read(`${dir}/boundary.json`).catch(() => undefined)
  return { rows: currentRows(transcript, text === undefined ? undefined : parseBoundary(text)), key: `${storage.sessionId}|${text ?? ''}` }
}

async function conversation($: EngineInterface): Promise<readonly SessionMessage[]> {
  return (await view($)).rows
}

// [SP_CTX_02_18] Indexes from a listing taken before the start moved name other rows.
async function staleIndexes($: EngineInterface): Promise<boolean> {
  return listed.key !== (await view($)).key
}

async function writeBoundary($: EngineInterface, b: Boundary): Promise<void> {
  if (!storage.dir) return
  await $.fs.write(`${storage.dir}/boundary.json`, JSON.stringify(b))
  boundary.trusted = true
}

function queuePath(): string {
  return `${storage.dir}/pending.json`
}

function tagsPath(): string {
  return `${storage.dir}/tags.json`
}

function aliasesPath(): string {
  return `${storage.dir}/aliases.json`
}

// [SP_CTX_01_13]
async function readAliases($: EngineInterface): Promise<Read<AliasRegistry>> {
  if (!(await $.fs.exists(aliasesPath()))) return { state: 'missing', value: { ...EMPTY_ALIASES, map: {} } }
  try {
    return parseAliases(await $.fs.read(aliasesPath()))
  } catch (err) {
    return { state: 'unreadable', reason: String(err) }
  }
}

async function writeAliases($: EngineInterface, reg: AliasRegistry): Promise<void> {
  await $.fs.write(aliasesPath(), JSON.stringify(reg))
}

// [SP_CTX_02_14] A read-modify-write of the alias registry on its own chain;
// nothing is written when the change keeps it as it is.
function updateAliases($: EngineInterface, change: (reg: AliasRegistry) => AliasRegistry): Promise<void> {
  return serial('aliases', async () => {
    const read = await readAliases($)
    if (read.state === 'unreadable') return
    const next = change(read.value)
    if (next !== read.value) await writeAliases($, next)
  })
}

// [SP_CTX_02_17] Resolves refs against the alias registry as it is now;
// nothing resolves without storage or from an unreadable registry.
async function resolver($: EngineInterface): Promise<RefResolver> {
  if (!storage.dir) return NO_REFS
  return refResolver(await readAliases($))
}

// [SP_CTX_01_10]
async function readTags($: EngineInterface): Promise<Read<TagRegistry>> {
  if (!(await $.fs.exists(tagsPath()))) return { state: 'missing', value: { ...EMPTY_REGISTRY } }
  try {
    return parseRegistry(await $.fs.read(tagsPath()))
  } catch (err) {
    return { state: 'unreadable', reason: String(err) }
  }
}

async function writeTags($: EngineInterface, reg: TagRegistry): Promise<void> {
  await $.fs.write(tagsPath(), JSON.stringify(reg))
}

// [SP_CTX_02_14] A read-modify-write of the registry on its serial chain.
function updateTags($: EngineInterface, change: (reg: TagRegistry) => TagRegistry): Promise<void> {
  return serial('tags', async () => {
    const read = await readTags($)
    if (read.state !== 'unreadable') await writeTags($, change(read.value))
  })
}

async function readQueue($: EngineInterface): Promise<Read<Queue>> {
  if (!(await $.fs.exists(queuePath()))) return { state: 'missing', value: { ...EMPTY_QUEUE } }
  try {
    return parseQueue(await $.fs.read(queuePath()))
  } catch (err) {
    return { state: 'unreadable', reason: String(err) }
  }
}

async function writeQueue($: EngineInterface, q: Queue): Promise<void> {
  await $.fs.write(queuePath(), JSON.stringify(q))
  $.ui.status(q.edits.length ? `${q.edits.length} context edit(s) queued` : undefined)
}

// [SP_CTX_02_02] An unreadable queue is moved aside so the session can go on.
async function quarantineQueue($: EngineInterface): Promise<string | undefined> {
  const moved = `${queuePath()}.bad-${Date.now()}`
  const ran = await $.process.run(['mv', queuePath(), moved]).catch(() => ({ exitCode: -1 }))
  return ran.exitCode === 0 ? moved : undefined
}

// [SP_CTX_02_15] Owner-only storage, then a heartbeat the trigger reads.
async function prepareStorage($: EngineInterface): Promise<void> {
  storage.dir = undefined
  storage.sessionId = await $.session.id()
  nudged.level = -1
  boundary.trusted = false
  listed.key = undefined
  const home = await $.env.get('HOME')
  if (!home) {
    storage.reason = 'HOME is not set'
    return
  }
  const base = `${home}/.claude/${PLUGIN}`
  const dir = `${base}/${storage.sessionId}`
  const ran = await $.process
    .run(['sh', '-c', 'umask 077 && mkdir -p "$1" && chmod 700 "$2" "$1"', 'sh', dir, base])
    .catch((err: unknown) => ({ exitCode: -1, stderr: String(err) }))
  if (ran.exitCode !== 0) {
    storage.reason = `cannot make ${base} owner-only: ${ran.stderr.trim() || `exit ${ran.exitCode}`}`
    $.ui.status(`${PLUGIN}: storage unavailable`)
    return
  }
  storage.dir = dir
  await writeReady($)
}

// [SP_CTX_01_07] /clear or /resume in the same process change the session
// without a session start: the storage follows the current session.
async function ensureStorage($: EngineInterface): Promise<string | undefined> {
  if (storage.sessionId !== (await $.session.id())) await prepareStorage($)
  return storage.dir
}

async function writeReady($: EngineInterface): Promise<void> {
  if (storage.dir) await $.fs.write(`${storage.dir}/editor-ready`, String(Date.now())).catch(() => undefined)
}

// Writes a text file through the host shell: no size limit of $.fs.write.
async function writeText($: EngineInterface, path: string, text: string): Promise<boolean> {
  const ran = await $.process
    .run(['sh', '-c', 'umask 077 && cat > "$1"', 'sh', path], { stdin: text })
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

function queueIO($: EngineInterface): QueueIO {
  return {
    readQueue: () => readQueue($),
    writeQueue: q => writeQueue($, q),
    quarantine: () => quarantineQueue($),
    queuePath: queuePath(),
  }
}

function aliasIO($: EngineInterface): AliasIO {
  return {
    ready: async () => !!(await ensureStorage($)),
    readAliases: () => readAliases($),
    writeAliases: reg => writeAliases($, reg),
  }
}

async function readQueueAt($: EngineInterface, dir: string): Promise<Read<Queue>> {
  const path = `${dir}/pending.json`
  if (!(await $.fs.exists(path))) return { state: 'missing', value: { ...EMPTY_QUEUE } }
  try {
    return parseQueue(await $.fs.read(path))
  } catch (err) {
    return { state: 'unreadable', reason: String(err) }
  }
}

// [SP_CTX_02_21] The transcript directory holding `<id>.jsonl`, under the
// host's configuration directory.
async function findTranscript($: EngineInterface, id: string): Promise<string | undefined> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
  const ran = await $.process
    .run(['sh', '-c', 'for f in "$1"/projects/*/"$2".jsonl; do [ -f "$f" ] && dirname "$f" && exit 0; done; exit 1', 'sh', config, id])
    .catch(() => ({ exitCode: -1, stdout: '' }))
  return ran.exitCode === 0 && ran.stdout.trim() ? ran.stdout.trim() : undefined
}

// [SP_CTX_02_15] The owner-only storage of another session, for the handoff.
async function storageFor($: EngineInterface, id: string): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  if (!home) return undefined
  const dir = `${home}/.claude/${PLUGIN}/${id}`
  const ran = await $.process.run(['sh', '-c', 'umask 077 && mkdir -p "$1" && chmod 700 "$1"', 'sh', dir]).catch(() => ({ exitCode: -1 }))
  return ran.exitCode === 0 ? dir : undefined
}

function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function handoffIO($: EngineInterface): HandoffIO {
  return {
    now: () => Date.now(),
    newId: newUuid,
    sessionId: () => $.session.id(),
    storageDir: () => ensureStorage($),
    turnsStarted: () => handoff.turnsStarted,
    inTurn: () => handoff.inTurn,
    readQueue: () => readQueue($),
    updateQueue: (dir, change) =>
      serial('queue', async () => {
        const read = await readQueueAt($, dir)
        if (read.state !== 'unreadable') await $.fs.write(`${dir}/pending.json`, JSON.stringify(change(read.value)))
      }),
    rows: () => conversation($),
    readApi: () => apiMessages($),
    readTags: () => readTags($),
    cwd: () => $.session.cwd(),
    findTranscript: id => findTranscript($, id),
    prepareStorage: id => storageFor($, id),
    writeMedia: (path, data) => writeMedia($, path, data),
    writeText: (path, text) => writeText($, path, text),
    rename: async (from, to) => ((await $.process.run(['mv', from, to]).catch(() => ({ exitCode: -1 }))).exitCode === 0),
    remove: async path => {
      await $.process.run(['rm', '-rf', '--', path])
    },
    copyRegistries: async (from, to) => {
      await $.process.run(['sh', '-c', 'umask 077; for f in tags.json aliases.json; do [ -f "$1/$f" ] && cp "$1/$f" "$2/$f"; done; true', 'sh', from, to])
    },
    runCommand: async (command, args) => {
      await $.command.run({ command, args })
    },
    fork: async prompt => {
      const r = await $.model.fork({ prompt })
      return r.isAnswered ? r.text : undefined
    },
    // A refused prompt resolves with `drop`; the handoff treats it as a failure.
    submit: async text => {
      const entered = await $.prompt.submit({ text })
      if (entered.drop !== undefined) throw new Error(String(entered.drop))
    },
    toast: text => $.ui.toast(text),
  }
}

// [SP_CTX_02_21] Starts RunHandoff after HANDOFF_DELAY, from no hook the turn
// waits on: the host refuses its commands there.
function scheduleHandoff($: EngineInterface): void {
  if (handoff.scheduled) return
  handoff.scheduled = true
  // Turns that start from here on put the handoff off ([SP_CTX_04_04]).
  const turns = handoff.turnsStarted
  $.clock.after(HANDOFF_DELAY_MS, () => {
    let again = false
    void runHandoff(handoffIO($), turns)
      .then(out => {
        // the old session's queue was cleared behind writeQueue: clear its status line too
        if (out.outcome === 'transcript' || out.outcome === 'document') $.ui.status(undefined)
        // put off by a turn that has already ended: no later turn end would start it
        again = out.outcome === 'deferred' && !handoff.inTurn
      })
      .catch(() => undefined)
      .finally(() => {
        handoff.scheduled = false
        if (again) scheduleHandoff($)
      })
  })
}

// [SP_CTX_02_19] [SP_CTX_02_20] Queues a handoff for the agent or the person.
// [SP_CTX_04_04] Drops a request that has not started; `onlyBy` limits it to one requester.
async function dropHandoff($: EngineInterface, why: string, onlyBy?: 'agent' | 'person'): Promise<boolean> {
  if (!(await ensureStorage($))) return false
  return serial('queue', async () => {
    const read = await readQueue($)
    if (read.state === 'unreadable' || !read.value.handoff || (onlyBy && read.value.handoff.by !== onlyBy)) return false
    const next = cancelHandoff(read.value, why, Date.now())
    if (next === read.value) return false
    await writeQueue($, next)
    return true
  })
}

async function requestHandoff($: EngineInterface, args: HandoffArgs, by: 'agent' | 'person') {
  if (!(await ensureStorage($))) return { deny: `storage unavailable: ${storage.reason}` }
  return serial('queue', async () => {
    const read = await readQueue($)
    if (read.state === 'unreadable') return { deny: `the queue cannot be read (${read.reason}).` }
    const out = queueHandoff(read.value, args, by, Date.now())
    if ('deny' in out) return out
    await writeQueue($, out.queue)
    return { mode: out.mode }
  })
}

function tagIO($: EngineInterface): TagIO {
  return {
    rows: () => conversation($),
    readTags: () => readTags($),
    writeTags: reg => writeTags($, reg),
    readQueue: () => readQueue($),
    writeQueue: q => writeQueue($, q),
  }
}

// [SP_CTX_02_03] The pinned targets on `rows`; none while the registry is
// unreadable, which HandleCompaction then reports for every edit.
async function pins($: EngineInterface, rows: readonly SessionMessage[]) {
  const read = await readTags($)
  return read.state === 'unreadable' ? NO_PINS : pinnedTargets(rows, read.value)
}

// [SP_CTX_02_01] Tag labels for the listing, if the storage and registry allow.
async function labels($: EngineInterface, rows: readonly SessionMessage[]) {
  if (!(await ensureStorage($))) return { labels: new Map<number, string[]>(), note: '' }
  const read = await readTags($)
  if (read.state === 'unreadable') return { labels: new Map<number, string[]>(), note: `\n(tags not shown: the tag registry cannot be read: ${read.reason})` }
  return { labels: tagLabels(rows, read.value), note: '' }
}

// [SP_CTX_02_01] Aliases for the listing, if the storage and registry allow.
async function aliasNames($: EngineInterface) {
  if (!storage.dir) return { aliases: new Map<string, string>(), note: '' }
  const read = await readAliases($)
  if (read.state === 'unreadable') return { aliases: new Map<string, string>(), note: `\n(aliases not shown: the alias registry cannot be read: ${read.reason})` }
  return { aliases: aliasesById(read.value), note: '' }
}

// [SP_CTX_02_09]
async function reviewCount($: EngineInterface): Promise<number> {
  const read = await readTags($)
  return read.state === 'unreadable' ? 0 : activeReviews(await conversation($), read.value)
}

// [SP_CTX_02_09] The reminder after a tool call, if one is due.
async function nudgeLine($: EngineInterface): Promise<string | undefined> {
  const tokens = (await $.session.usage()).context.tokens ?? 0
  return nudge(
    {
      ready: async () => !!(await ensureStorage($)),
      readQueue: () => readQueue($),
      replace: () => serial('queue', () => queueTagReplacements(tagIO($))),
      reviews: () => reviewCount($),
    },
    tokens,
    nudged,
  )
}

function deny(reason: string) {
  return { deny: `${PLUGIN}: ${reason}` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: LIST,
      description: LIST_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'integer', description: 'Index of the first row to list (default 0, the oldest).' },
          count: { type: 'integer', description: `How many rows to list (default ${LIST_COUNT}, at most 200).` },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({ name: EDIT, description: EDIT_DESCRIPTION, inputSchema: EDIT_SCHEMA, isDeferred: false })
    await $.tool.register({ name: TAG, description: TAG_DESCRIPTION, inputSchema: TAG_SCHEMA, isDeferred: false })
    await $.tool.register({ name: HANDOFF, description: HANDOFF_DESCRIPTION, inputSchema: HANDOFF_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'handoff', description: 'Move this conversation into a new session: cleaned transcript, or a handoff document', argumentHint: '[document|cancel]' })
    await prepareStorage($)
    $.clock.every(HEARTBEAT_MS, () => void ensureStorage($).then(() => writeReady($)))
    return next(e)
  })

  // [SP_CTX_02_01]
  on('tool.call', { tool: 'mcp__context-editor__context_list' }, async ($, e) => {
    if (e.agentId) return deny('only the main conversation can be listed and edited.')
    const args = e as unknown as { from?: number; count?: number }
    const { rows, key } = await view($)
    const { found } = collectMedia(await apiMessages($))
    const tagged = await labels($, rows)
    const named = await aliasNames($)
    const text = listRows(
      rows,
      typeof args.from === 'number' ? args.from : 0,
      typeof args.count === 'number' ? args.count : LIST_COUNT,
      found,
      tagged.labels,
      named.aliases,
    )
    // [SP_CTX_02_18] only a listing the agent receives renews its indexes
    listed.key = key
    return { result: text + tagged.note + named.note }
  }).catch(($, e, next) => (next.called ? next(e) : deny(`listing failed: ${next.error.kind}`)))

  // [SP_CTX_02_02]
  on('tool.call', { tool: 'mcp__context-editor__context_edit' }, async ($, e) => {
    if (e.agentId) return deny("a subagent's context cannot be edited; only the main conversation's.")
    if (!(await ensureStorage($))) return deny(`storage unavailable: ${storage.reason}`)
    const args = e as unknown as { edits?: unknown; resume?: unknown; resume_prompt?: unknown }
    const out = await serial('queue', async () => {
      const { rows, key } = await view($)
      return contextEdit(queueIO($), rows, args, await pins($, rows), await resolver($), listed.key !== key)
    })
    return 'deny' in out ? deny(out.deny) : out
  }).catch(($, e, next) => (next.called ? next(e) : deny(`queueing failed: ${next.error.kind}`)))

  // [SP_CTX_02_11]
  on('tool.call', { tool: 'mcp__context-editor__context_tag' }, async ($, e) => {
    const args = e as unknown as TagArgs
    const ready = e.agentId ? true : !!(await ensureStorage($))
    const out = await serial('tags', async () =>
      contextTag(
        tagIO($),
        { agentId: e.agentId, tags: args.tags },
        ready ? undefined : storage.reason,
        e.agentId ? NO_REFS : await resolver($),
        !e.agentId && ready && (await staleIndexes($)),
      ),
    )
    return 'deny' in out ? deny(out.deny) : { result: out.result }
  }).catch(($, e, next) => (next.called ? next(e) : deny(`tagging failed: ${next.error.kind}`)))

  // [SP_CTX_02_21] Turns that start while a handoff waits put it off.
  on('turn.start', async ($, e, next) => {
    handoff.turnsStarted += 1
    handoff.inTurn = true
    return next(e)
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_19] A regex: the host's generated types do not list this tool
  // until a session has loaded it; a string literal is the goal once they do.
  on('tool.call', { tool: /^mcp__context-editor__context_handoff$/ }, async ($, e) => {
    const out = await requestHandoff($, { ...(e as unknown as HandoffArgs), agentId: e.agentId }, 'agent')
    if ('deny' in out) return deny(out.deny)
    handoff.requestTurn = handoff.turnsStarted
    return { result: `Handoff queued (${out.mode}): it runs when this turn ends. End your turn now with a one-line status.` }
  }).catch(($, e, next) => (next.called ? next(e) : deny(`handoff failed: ${next.error.kind}`)))

  // [SP_CTX_02_20]
  on('command.run', { command: 'handoff' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'cancel') return { text: `${PLUGIN}: ${(await dropHandoff($, 'cancelled by the person')) ? 'handoff cancelled' : 'no handoff waiting'}` }
    const out = await requestHandoff($, { mode: arg === 'document' ? 'document' : 'transcript' }, 'person')
    if ('deny' in out) return { text: `${PLUGIN}: ${out.deny}` }
    scheduleHandoff($)
    return { text: `${PLUGIN}: handoff (${out.mode}) starts` }
  }).catch(($, e, next) => (next.called ? next(e) : { text: `${PLUGIN}: handoff failed: ${next.error.kind}` }))

  // [SP_CTX_02_12] The row is stored first and returned unchanged; the rules
  // run after it, on the registry's chain, and never hold the row back.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    try {
      if (!e.agentId && stored.deny === undefined && (e.door === 'prompt' || e.door === 'tool-result')) {
        const facts = appendFacts(e)
        void serial('tags', async () => {
          if (await ensureStorage($)) await autoTag(tagIO($), facts)
        }).catch(() => undefined)
      }
    } catch {
      // the stored row stands whatever the rules did
    }
    return stored
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_12] The turn counter that review ttls are measured in.
  on('turn.complete', async ($, e, next) => {
    // nothing starts while the turn ends: the flag is down whatever `next` does
    if (!e.agentId) handoff.inTurn = false
    const done = await next(e)
    if (!e.agentId && !e.isAborted)
      void serial('tags', async () => {
        if (await ensureStorage($)) await countTurn(tagIO($))
      }).catch(() => undefined)
    if (!e.agentId && e.isAborted && handoff.requestTurn === handoff.turnsStarted)
      // [SP_CTX_04_04] The agent's request dies with the turn it was made in, when the person interrupts it.
      void dropHandoff($, 'the turn was interrupted', 'agent').catch(() => undefined)
    else if (!e.agentId)
      // [SP_CTX_02_21] After any other turn, interrupted or not, a waiting handoff goes on.
      void (async () => {
        if (!(await ensureStorage($))) return
        const read = await readQueue($)
        if (read.state !== 'unreadable' && handoffDue(read.value, Date.now())) scheduleHandoff($)
      })().catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_07]
  on('session.compact', { trigger: 'plugin' }, async ($, e, next) => {
    if (e.instructions !== MARKER || e.agentId) return next(e)
    const dir = await ensureStorage($)
    if (!dir) return { skip: `${PLUGIN}: storage unavailable` }
    return serial('queue', () =>
      handleCompaction(
        {
          dir,
          now: () => Date.now(),
          readQueue: () => readQueue($),
          writeQueue: q => writeQueue($, q),
          readApi: () => apiMessages($),
          writeMedia: (path, data) => writeMedia($, path, data),
          writeArchive: (path, text) => writeText($, path, text),
          isAborted: () => next.signal.aborted,
          toast: text => $.ui.toast(text),
          readTags: () => readTags($),
          updateTags: change => updateTags($, change),
          updateAliases: change => updateAliases($, change),
          writeBoundary: b => writeBoundary($, b),
        },
        e.messages,
      ),
    )
  }).catch(($, e, next) => {
    // Never let a failed edit fall through to a real, summarizing compaction:
    // answer at once, and record the failure in the background.
    if (e.instructions !== MARKER) return next(e)
    if (storage.dir)
      void serial('queue', async () => {
        const read = await readQueue($)
        await writeQueue($, failedQueue(read.state === 'unreadable' ? undefined : read.value, next.error.kind, Date.now()))
      }).catch(() => undefined)
    return { skip: `${PLUGIN}: applying the edits failed` }
  })

  // [SP_CTX_02_18] Any other compaction of the main conversation that stands
  // moves its start too; a precomputed one stands only when it is used.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    const b = observedBoundary(e, done, MARKER)
    if (b && (await ensureStorage($))) await writeBoundary($, b).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_16] [SP_CTX_02_09] After any other tool call of the main loop:
  // the alias line of a call worth editing first, then the reminder. Neither
  // ever changes the result itself; a failure of either only drops its line.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || done.deny !== undefined || String(e.tool).startsWith(OWN_TOOLS)) return done
    const lines: string[] = []
    const facts = callFacts(e, done)
    if (wantsMark(facts)) {
      const alias = await serial('aliases', () => markCall(aliasIO($), facts)).catch(() => undefined)
      if (alias) lines.push(alias)
    }
    const text = await nudgeLine($).catch(() => undefined)
    if (text) lines.push(text)
    return withContext(done, lines)
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_08] The next prompt carries the report; it leaves the queue
  // only once that prompt has entered.
  on('prompt.submit', async ($, e, next) => {
    if (!(await ensureStorage($))) return next(e)
    return deliverReport(
      () => readQueue($),
      report => (report ? next({ ...e, context: [...(e.context ?? []), report] }) : next(e)),
      delivered =>
        serial('queue', async () => {
          const now = await readQueue($)
          if (now.state === 'ok') await writeQueue($, withoutReport(now.value, delivered))
        }),
    )
  }).catch(($, e, next) => next(e))
}
