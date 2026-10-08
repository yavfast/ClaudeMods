import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { failedQueue, handleCompaction, type CompactionIO } from '../hooks/compaction'
import { prepare } from '../hooks/edits'
import { EMPTY_QUEUE, type Queue, type Read } from '../hooks/queue'

const BIG = 'x'.repeat(5000)
const PNG = 'iVBORw0KGgo='

function conversation(): SessionMessage[] {
  return [
    { role: 'user', text: 'task', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'z', tool: 'mcp__context-editor__context_list', input: {} }], handle: 'h1' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'z', text: 'listing', isError: false }], handle: 'h2' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'h3' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: BIG, isError: false }], handle: 'h4' },
  ]
}

function harness(queue: Read<Queue>, over: Partial<CompactionIO> = {}) {
  const written: { queue?: Queue; media: string[]; archive?: string; toasts: string[] } = { media: [], toasts: [] }
  const io: CompactionIO = {
    dir: '/s',
    now: () => 1000,
    readQueue: async () => queue,
    writeQueue: async q => {
      written.queue = q
    },
    readApi: async () => [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'z', content: 'listing' }] },
    ],
    writeMedia: async path => {
      written.media.push(path)
      return true
    },
    writeArchive: async path => {
      written.archive = path
      return true
    },
    isAborted: () => false,
    toast: t => void written.toasts.push(t),
    ...over,
  }
  return { io, written }
}

function queued(edits: unknown[], extra: Partial<Queue> = {}): Read<Queue> {
  return { state: 'ok', value: { ...EMPTY_QUEUE, ...extra, edits: prepare(conversation(), edits).queued } }
}

test('applies the batch: media archived, own calls dropped, charsAfter after the drop, report queued', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 'a screenshot of X' }], { resume: false, resumePrompt: 'p' }))
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.media).toEqual(['/s/1000/1.png'])
  expect(out.messages.some(r => r.toolUses.some(u => u.tool.startsWith('mcp__context-editor__')))).toBe(false)
  expect(out.messages.at(-1)!.toolResults![0]!.text).toContain('(media: /s/1000/1.png)')
  expect(out.messages.at(-1)!.toolResults![0]!.text).toContain('(original: /s/1000.json)')
  const q = written.queue!
  expect(q.edits).toEqual([])
  expect(q.reportId).toBe(1000)
  expect(q.reportResume).toBe(false)
  expect(q.resume).toBe(true)
  expect(q.report).toContain('Media archived: /s/1000/1.png')
  expect(q.report).toContain('-> ~')
})

test('a failed archive write refuses the whole batch and changes nothing', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), { writeArchive: async () => false })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('originals could not be archived')
  expect(written.queue!.edits).toEqual([])
  expect(written.queue!.report).toContain('summarize a: originals could not be archived')
  expect(written.queue!.report).toContain('applied 0 edit(s)')
})

test('media that cannot be written blocks the edit and keeps the media row', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), { writeMedia: async () => false })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out).toBe(true)
  expect(written.queue!.report).toContain('media could not be archived')
})

test('an abandoned dispatch keeps the batch queued and writes nothing to the queue', async () => {
  const { io, written } = harness(queued([{ op: 'drop', tool_use_id: 'a' }]), { isAborted: () => true })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('abandoned')
  expect(written.queue).toBeUndefined()
})

test('an unreadable or empty queue is skipped untouched', async () => {
  const a = harness({ state: 'unreadable', reason: 'x' })
  expect('skip' in (await handleCompaction(a.io, conversation()))).toBe(true)
  expect(a.written.queue).toBeUndefined()
  const b = harness({ state: 'missing', value: { ...EMPTY_QUEUE } })
  expect('skip' in (await handleCompaction(b.io, conversation()))).toBe(true)
})

test('an undelivered report is kept beside the new one', async () => {
  const { io, written } = harness(queued([{ op: 'drop', tool_use_id: 'a' }], { report: 'older', reportId: 5 }))
  await handleCompaction(io, conversation())
  expect(written.queue!.report!.startsWith('older\n')).toBe(true)
})

test('failedQueue drops the batch and keeps a failure report that does not resume', async () => {
  const q = failedQueue({ ...EMPTY_QUEUE, report: 'older' }, 'thrown', 9)
  expect(q.edits).toEqual([])
  expect(q.report).toContain('older')
  expect(q.report).toContain('applying the edits failed (thrown)')
  expect(q.report).toContain('conversation was not changed')
  expect(q.reportResume).toBe(false)
})
