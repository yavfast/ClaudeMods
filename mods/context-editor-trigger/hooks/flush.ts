// [SP_CTX_02_06] The trigger's decision logic, free of the host: register.ts
// binds the ports to `$`.

export const MARKER = 'context-editor: apply queued edits'
export const DEFAULT_RESUME = 'Continue the task from where you stopped.'
export const READY_FRESH_MS = 15_000
export const RETRIES = 20
export const RETRY_MS = 500

export type TriggerQueue = { edits?: unknown[]; report?: string; reportId?: number; reportResume?: boolean; reportPrompt?: string }

export type TriggerIO = {
  readQueue: () => Promise<TriggerQueue | undefined>
  // the editor's tools are registered in this process and its ready file is fresh
  editorReady: () => Promise<boolean>
  compact: () => Promise<void>
  sleep: (ms: number) => Promise<void>
  submit: (text: string) => Promise<void>
  status: (text?: string) => void
}

export type TriggerState = { lastSubmittedReportId: number }

export type FlushOutcome = 'editor-not-ready' | 'compacted' | 'host-refused' | 'nothing-queued'

// [SP_CTX_02_06] One flush after a completed turn.
export async function flush(io: TriggerIO, state: TriggerState): Promise<{ outcome: FlushOutcome; submitted: boolean }> {
  if (!(await io.editorReady())) {
    io.status('context-editor is not running; queued edits wait')
    return { outcome: 'editor-not-ready', submitted: false }
  }
  io.status(undefined)
  let outcome: FlushOutcome = 'nothing-queued'
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (!(await io.readQueue())?.edits?.length) break
    try {
      await io.compact()
      outcome = 'compacted'
      break
    } catch {
      outcome = 'host-refused'
      await io.sleep(RETRY_MS)
    }
  }
  // The editor adds the report to whatever prompt comes next; this sends
  // only the resume text, once per report, and remembers it once sent.
  const q = await io.readQueue()
  let submitted = false
  if (q?.report && q.reportResume && q.reportId && q.reportId !== state.lastSubmittedReportId) {
    try {
      await io.submit(q.reportPrompt || DEFAULT_RESUME)
      state.lastSubmittedReportId = q.reportId
      submitted = true
    } catch {
      io.status('context-editor: could not resume the session; send any prompt to continue')
    }
  }
  return { outcome, submitted }
}

// Whether a ready file written at `mtimeMs` is fresh at `now`.
export function isFresh(mtimeMs: number, now: number): boolean {
  return now - mtimeMs <= READY_FRESH_MS
}
