import type { EngineInterface, Register } from 'claude-code'
import { failedQueue, handleCompaction } from './compaction'
import { collectMedia, listRows, LIST_COUNT, MAX_QUEUE_EDITS, OWN_TOOLS } from './edits'
import { contextEdit, DEFAULT_RESUME, deliverReport, EMPTY_QUEUE, parseQueue, withoutReport, type Queue, type QueueIO, type Read } from './queue'

const PLUGIN = 'context-editor'
const LIST = 'context_list'
const EDIT = 'context_edit'
// [SP_CTX_01_12]
export const MARKER = `${PLUGIN}: apply queued edits`
const HEARTBEAT_MS = 5_000
const NUDGE_FIRST_TOKENS = 80_000
const NUDGE_STEP_TOKENS = 40_000

const LIST_DESCRIPTION = `List this conversation's rows OLDEST FIRST, a page at a time, with indexes, sizes, tool_use ids, media and flags (* already edited, ! large, @ has media), so you can choose what to compact with ${EDIT}. Call it right before ${EDIT}: indexes are positions in this listing. Only the latest 4096 rows are visible.`

const EDIT_DESCRIPTION = `Edit your own earlier context to free space: replace tool outputs you have already processed (text, screenshots, images, documents), or dead-end steps and wrong conclusions, with compact summaries.

Ops (each item of "edits"; every field shown is required):
- {"op":"summarize","tool_use_id","summary"}: replace one tool result, including any image or document in it, with your summary of what mattered (describe the media too). Parallel calls whose results share a row: summarize the ones with media together in one batch.
- {"op":"drop","tool_use_id"}: remove a tool call and its result entirely (it was useless).
- {"op":"collapse","from_index","to_index","summary"}: replace rows from_index..to_index (from ${LIST}) with one summary; the range must hold every tool call together with its result.
- {"op":"rewrite","index","text"}: replace the text of one of your assistant text rows (no tool calls in it), e.g. a conclusion that turned out wrong.

Clean from the start of the conversation: the oldest processed spans go first, since attention degrades with length; prefer one large collapse of an early span over many small edits.

Rules: summaries must keep every fact, number, URL and source you may still need, since the originals leave your context (they are archived to files named in the summary, which you can Read later). Batch several edits in one call; edit only when it frees a lot, because each edit invalidates the prompt cache from the edited row on.

The edits are applied when your current turn ends, not immediately. After calling this tool, end your turn at once with a one-line status. Unless "resume" is false, the session then resumes by itself with the "resume_prompt" text (default: "${DEFAULT_RESUME}").`

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
          { type: 'object', properties: { op: { const: 'drop' }, tool_use_id: { type: 'string' } }, required: ['op', 'tool_use_id'] },
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

// [SP_CTX_01_07] The session's storage, set up at session start.
const storage: { dir?: string; sessionId?: string; reason: string } = { reason: 'not prepared yet' }
// The threshold the model was last reminded at ([SP_CTX_02_09]).
const nudged = { level: -1 }
// [SP_CTX_02] One serial chain per file: no two read-modify-writes overlap.
const chains = new Map<string, Promise<unknown>>()

function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).then(work, work)
  chains.set(key, next.catch(() => undefined))
  return next
}

function queuePath(): string {
  return `${storage.dir}/pending.json`
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

function nudgeText(tokens: number): string {
  return `${PLUGIN}: the context is ~${Math.round(tokens / 1000)}k tokens. Attention degrades as context grows, so clean it from the START of the conversation: call ${LIST} (it lists the oldest rows first), then make ONE ${EDIT} call that collapses or summarizes the earliest spans you have already processed (old tool outputs, screenshots and documents you have already looked at, finished sub-tasks, dead ends). Keep verbatim the user's original task and constraints, open questions and the decisions still in force. Then continue the task.`
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
    await prepareStorage($)
    $.clock.every(HEARTBEAT_MS, () => void ensureStorage($).then(() => writeReady($)))
    return next(e)
  })

  // [SP_CTX_02_01]
  on('tool.call', { tool: 'mcp__context-editor__context_list' }, async ($, e) => {
    if (e.agentId) return deny('only the main conversation can be listed and edited.')
    const args = e as unknown as { from?: number; count?: number }
    const rows = await $.session.messages()
    const { found } = collectMedia(await apiMessages($))
    return {
      result: listRows(rows, typeof args.from === 'number' ? args.from : 0, typeof args.count === 'number' ? args.count : LIST_COUNT, found),
    }
  }).catch(($, e, next) => (next.called ? next(e) : deny(`listing failed: ${next.error.kind}`)))

  // [SP_CTX_02_02]
  on('tool.call', { tool: 'mcp__context-editor__context_edit' }, async ($, e) => {
    if (e.agentId) return deny("a subagent's context cannot be edited; only the main conversation's.")
    if (!(await ensureStorage($))) return deny(`storage unavailable: ${storage.reason}`)
    const args = e as unknown as { edits?: unknown; resume?: unknown; resume_prompt?: unknown }
    const out = await serial('queue', async () => contextEdit(queueIO($), await $.session.messages(), args))
    return 'deny' in out ? deny(out.deny) : out
  }).catch(($, e, next) => (next.called ? next(e) : deny(`queueing failed: ${next.error.kind}`)))

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

  // [SP_CTX_02_09] After any other tool call of the main loop.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || done.deny !== undefined || String(e.tool).startsWith(OWN_TOOLS)) return done
    const tokens = (await $.session.usage()).context.tokens ?? 0
    const level = tokens < NUDGE_FIRST_TOKENS ? -1 : Math.floor((tokens - NUDGE_FIRST_TOKENS) / NUDGE_STEP_TOKENS)
    if (level <= nudged.level) {
      nudged.level = Math.min(nudged.level, level)
      return done
    }
    if (!(await ensureStorage($))) return done
    const read = await readQueue($)
    if (read.state === 'unreadable' || read.value.edits.length) return done
    nudged.level = level
    return { ...done, context: [...(done.context ?? []), nudgeText(tokens)] }
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
