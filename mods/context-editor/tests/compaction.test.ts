import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { archiveText, failedQueue, handleCompaction, MEDIA_DATA, observedBoundary, type CompactionIO } from '../hooks/compaction'
import { boundaryOf, fingerprint, prepare, type Boundary } from '../hooks/edits'
import { EMPTY_QUEUE, type Queue, type Read } from '../hooks/queue'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'

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

function harness(queue: Read<Queue>, over: Partial<CompactionIO> = {}, tags: Read<TagRegistry> = { state: 'missing', value: { ...EMPTY_REGISTRY } }) {
  const written: { queue?: Queue; media: string[]; archive?: string; archiveText?: string; toasts: string[]; tags?: TagRegistry; boundary?: Boundary } = { media: [], toasts: [] }
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
    writeArchive: async (path, text) => {
      written.archive = path
      written.archiveText = text
      return true
    },
    isAborted: () => false,
    toast: t => void written.toasts.push(t),
    readTags: async () => tags,
    updateTags: async change => {
      if (tags.state !== 'unreadable') written.tags = change(tags.value)
    },
    updateAliases: async () => undefined,
    writeBoundary: async b => {
      written.boundary = b
    },
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
  expect(written.boundary).toEqual(boundaryOf(out.messages))
})

test('a batch that changes nothing leaves the boundary as it was', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), { writeArchive: async () => false })
  await handleCompaction(io, conversation())
  expect(written.boundary).toBeUndefined()
})

test('the archive keeps the paths of archived media in place of its data', async () => {
  const data = 'A'.repeat(300)
  const file = { type: 'image', file: { base64: data, type: 'image/png' } }
  const use = { tool_use_id: 'a', tool: 'Read', input: {}, result: file }
  const rows: SessionMessage[] = [
    { role: 'assistant', text: '', toolUses: [use, { tool_use_id: 'b', tool: 'Read', input: {}, result: file }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: '', isError: false, result: file }, { tool_use_id: 'b', text: '', isError: false, result: file }] },
  ]
  const text = archiveText([{ edit: 'summarize a', rows }], new Map([['u:a', ['/s/1/1.png']]]))
  const back = JSON.parse(text) as { rows: SessionMessage[] }[]
  const note = '[media archived: /s/1/1.png]'
  expect(back[0]!.rows[0]!.toolUses[0]!.result).toEqual({ type: 'image', file: { base64: note, type: 'image/png' } })
  expect(back[0]!.rows[1]!.toolResults![0]!.result).toEqual({ type: 'image', file: { base64: note, type: 'image/png' } })
  // a pair whose media was not archived keeps its data
  expect(back[0]!.rows[0]!.toolUses[1]!.result).toEqual(file)
  expect(text.split(data).length - 1).toBe(2)
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

test('a pin set after the edit was queued fails that edit at application; the rest applies', async () => {
  const conv = conversation()
  const pinned: TagRegistry = { ...EMPTY_REGISTRY, tags: [{ kind: 'pin', target: { anchor: fingerprint(conv[0]!), hint: 0 }, created_turn: 0 }] }
  const batch = queued([
    { op: 'collapse', from_index: 0, to_index: 2, summary: 'start' },
    { op: 'drop', tool_use_id: 'a' },
  ])
  const { io, written } = harness(batch, {}, { state: 'ok', value: pinned })
  const out = await handleCompaction(io, conv)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('collapse #0..#2: target is pinned; remove the pin with context_tag first')
  expect(written.queue!.report).toContain('applied 1 edit(s): drop a')
  expect(out.messages[0]!.text).toBe('task')
})

test('an unreadable tag registry fails every edit and changes nothing', async () => {
  const { io, written } = harness(queued([{ op: 'drop', tool_use_id: 'a' }]), {}, { state: 'unreadable', reason: 'bad tag 1' })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('no edit could be applied')
  expect(written.queue!.report).toContain('drop a: tag registry unreadable')
  expect(written.tags).toBeUndefined()
})

test('after an apply the tags of edited targets go and the others stay', async () => {
  const conv = conversation()
  const reg: TagRegistry = {
    ...EMPTY_REGISTRY,
    tags: [
      { kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 },
      { kind: 'pin', target: { anchor: fingerprint(conv[0]!), hint: 0 }, created_turn: 0 },
    ],
  }
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), {}, { state: 'ok', value: reg })
  const out = await handleCompaction(io, conv)
  expect('messages' in out).toBe(true)
  expect(written.tags!.tags.length).toBe(1)
  expect(written.tags!.tags[0]!.kind).toBe('pin')
})

test('archiveText keeps long data that is not base64, even beside archived media', async () => {
  const prose = 'word '.repeat(MEDIA_DATA)
  const rows: SessionMessage[] = [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'X', input: {}, result: { data: prose, image: { base64: 'B'.repeat(MEDIA_DATA) } } }] },
  ]
  const back = JSON.parse(archiveText([{ edit: 'summarize a', rows }], new Map([['u:a', ['/s/1/1.png']]]))) as { rows: SessionMessage[] }[]
  expect(back[0]!.rows[0]!.toolUses[0]!.result).toEqual({ data: prose, image: { base64: '[media archived: /s/1/1.png]' } })
})

test('observedBoundary: a standing compaction of the main conversation sets the boundary; the rest do not', async () => {
  const rows = conversation()
  const done = { messages: rows }
  expect(observedBoundary({ trigger: 'manual' }, done, 'M')).toEqual(boundaryOf(rows))
  expect(observedBoundary({ trigger: 'auto' }, done, 'M')).toEqual(boundaryOf(rows))
  expect(observedBoundary({ trigger: 'plugin', instructions: 'other' }, done, 'M')).toEqual(boundaryOf(rows))
  expect(observedBoundary({ trigger: 'plugin', instructions: 'M' }, done, 'M')).toBeUndefined()
  expect(observedBoundary({ trigger: 'precompute' }, done, 'M')).toBeUndefined()
  expect(observedBoundary({ trigger: 'auto', agentId: 'sub' }, done, 'M')).toBeUndefined()
  expect(observedBoundary({ trigger: 'manual' }, { skip: 'off' }, 'M')).toBeUndefined()
  expect(observedBoundary({ trigger: 'manual' }, { messages: [] }, 'M')).toBeUndefined()
})
