import type { SessionMessage } from 'claude-code'
import { applyEdits, collectMedia, describeEdit, dropOwnCalls, formatReport, replacedOwners, totalChars } from './edits'
import { DEFAULT_RESUME, EMPTY_QUEUE, type Queue, type Read } from './queue'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

// What HandleCompaction needs from the host; register.ts binds it to `$`.
export type CompactionIO = {
  dir: string
  now: () => number
  readQueue: () => Promise<Read<Queue>>
  writeQueue: (q: Queue) => Promise<void>
  readApi: () => Promise<readonly unknown[]>
  writeMedia: (path: string, base64: string) => Promise<boolean>
  writeArchive: (path: string, text: string) => Promise<boolean>
  // true once the host abandoned the dispatch (interrupt, budget)
  isAborted: () => boolean
  toast: (text: string) => void
}

export type CompactionOutcome = { skip: string } | { messages: SessionMessage[] }

// [SP_CTX_02_07] Applies the queued batch to the compaction's rows. The
// caller runs it on the queue's serial chain.
export async function handleCompaction(io: CompactionIO, messages: readonly SessionMessage[]): Promise<CompactionOutcome> {
  const read = await io.readQueue()
  if (read.state === 'unreadable') return { skip: 'context-editor: queue unreadable' }
  const q = read.value
  if (!q.edits.length) return { skip: 'context-editor: no queued edits' }

  const { found, knownResults, unmatchedPromptMedia } = collectMedia(await io.readApi())
  const mediaOwners = new Set(found.keys())
  const id = io.now()
  const replaced = replacedOwners(messages, q.edits)
  const media = new Map<string, string[]>()
  let n = 0
  // An owner whose media cannot all be written keeps none: applyEdits then
  // refuses every edit that would replace it.
  for (const [key, refs] of found) {
    if (!replaced.has(key)) continue
    const paths: string[] = []
    for (const ref of refs) {
      n += 1
      const path = `${io.dir}/${id}/${n}.${EXT[ref.mediaType] ?? 'bin'}`
      if (!ref.data || !(await io.writeMedia(path, ref.data))) {
        paths.length = 0
        break
      }
      paths.push(path)
    }
    if (paths.length) media.set(key, paths)
  }

  const options = { knownResults, unmatchedPromptMedia }
  const archive = `${io.dir}/${id}.json`
  const applied = applyEdits(messages, q.edits, archive, media, mediaOwners, options)
  // [C_CTX_01_01] Originals never vanish: without their archive nothing applies.
  if (applied.report.originals.length && !(await io.writeArchive(archive, JSON.stringify(applied.report.originals)))) {
    if (io.isAborted()) return { skip: 'context-editor: compaction abandoned; the batch stays queued' }
    const text = formatReport(
      {
        ...applied.report,
        applied: [],
        failed: q.edits.map(e => `${describeEdit(e)}: originals could not be archived`),
        charsAfter: applied.report.charsBefore,
        mediaFiles: [],
      },
      '',
    )
    await io.writeQueue(reported(q, text, id))
    io.toast(text.slice(0, 200))
    return { skip: 'context-editor: originals could not be archived' }
  }
  const archived = archive
  const rows = dropOwnCalls(applied.rows, mediaOwners, knownResults)
  applied.report.charsAfter = totalChars(rows)

  // An abandoned dispatch changes nothing: the batch stays queued for the
  // next turn, and the files written so far are only orphans in the archive.
  if (io.isAborted()) return { skip: 'context-editor: compaction abandoned; the batch stays queued' }

  const text = formatReport(applied.report, archived)
  await io.writeQueue(reported(q, text, id))
  io.toast(text.slice(0, 200))
  if (applied.report.applied.length === 0) return { skip: 'context-editor: no edit could be applied' }
  return { messages: rows }
}

// The queue once a batch was handled: the batch cleared, its report added
// after any report not yet delivered.
function reported(q: Queue, text: string, id: number): Queue {
  return {
    ...EMPTY_QUEUE,
    report: q.report ? `${q.report}\n${text}` : text,
    reportId: id,
    reportResume: q.resume && !q.tagsOnly,
    reportPrompt: q.resumePrompt,
  }
}

// [SP_CTX_02_07] The queue after the handler failed: batch dropped, a report
// of the failure waits for the next prompt.
export function failedQueue(q: Queue | undefined, reason: string, now: number): Queue {
  return {
    ...EMPTY_QUEUE,
    report: `${q?.report ? q.report + '\n' : ''}context-editor: applying the edits failed (${reason}); the conversation was not changed and the batch was dropped.`,
    reportId: now,
    reportResume: false,
    reportPrompt: DEFAULT_RESUME,
  }
}
