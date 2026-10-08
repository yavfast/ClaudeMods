import type { EngineInterface, Register } from 'claude-code'
import { flush, isFresh, MARKER, type TriggerQueue, type TriggerState } from './flush'

// [SP_CTX_02_06] Storage layout and the editor's tool name must match
// context-editor ([SP_CTX_01_07]); scripts/check-shared.sh compares them.
// This plugin never writes the editor's files.
const EDITOR_TOOL = 'mcp__context-editor__context_edit'
const TRIGGER_DELAY_MS = 300

const state: TriggerState & { isScheduled: boolean } = { isScheduled: false, lastSubmittedReportId: 0 }

async function storageDir($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  return home ? `${home}/.claude/context-editor/${await $.session.id()}` : undefined
}

// Undefined when the file is missing or unreadable: the trigger then waits.
async function readQueue($: EngineInterface): Promise<TriggerQueue | undefined> {
  const dir = await storageDir($)
  if (!dir) return undefined
  try {
    const q = JSON.parse(await $.fs.read(`${dir}/pending.json`)) as TriggerQueue
    return Array.isArray(q.edits) ? q : undefined
  } catch {
    return undefined
  }
}

// The editor runs in this process: its tool is registered here, and its ready
// file is fresh.
async function editorReady($: EngineInterface): Promise<boolean> {
  const dir = await storageDir($)
  if (!dir) return false
  try {
    const tools = await $.tool.list()
    if (!tools.some(t => t.name === EDITOR_TOOL)) return false
    const stat = await $.fs.stat(`${dir}/editor-ready`)
    return isFresh(stat.mtimeMs, Date.now())
  } catch {
    return false
  }
}

async function runFlush($: EngineInterface): Promise<void> {
  try {
    await flush(
      {
        readQueue: () => readQueue($),
        editorReady: () => editorReady($),
        compact: async () => {
          await $.session.compact({ instructions: MARKER })
        },
        sleep: ms => $.clock.sleep(ms),
        // A refused prompt resolves with `drop`; flush treats it as a failure.
        submit: async text => {
          const entered = await $.prompt.submit({ text })
          if (entered.drop !== undefined) throw new Error(entered.drop)
        },
        status: text => $.ui.status(text),
      },
      state,
    )
  } finally {
    state.isScheduled = false
  }
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && !e.isAborted && !state.isScheduled && (await readQueue($))?.edits?.length) {
      state.isScheduled = true
      $.clock.after(TRIGGER_DELAY_MS, () => void runFlush($))
    }
    return done
  }).catch(($, e, next) => next(e))
}
