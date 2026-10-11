import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  archiveText,
  compactionFailure,
  compactionRoute,
  failedQueue,
  handleCompaction,
  HANDOFF_MARKER,
  MARKER,
  MEDIA_DATA,
  observedBoundary,
  screenPinned,
  type CompactionIO,
} from '../hooks/compaction'
import {
  boundaryOf,
  fingerprint,
  newHostIdMemo,
  peekHostId,
  prepare,
  recordBoundary,
  startHostId,
  totalChars,
  type Boundary,
  type BoundaryMemory,
  type QueuedEdit,
} from '../hooks/edits'
import { EMPTY_QUEUE, type Queue, type Read } from '../hooks/queue'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'
import type { Deliveries, QueuedDelivery } from '../hooks/deliveries'

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
    hostId: () => undefined,
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
  expect(out.messages.at(-1)!.toolResults![0]!.text).toContain('(original: /s/1000.json, open with Read)')
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
  expect(written.queue!.report!.startsWith('context-editor: no edit was applied; the conversation was not changed.')).toBe(true)
  expect(written.queue!.report).not.toContain('freed')
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

test('RecordBoundary — спостерігач: manual, auto, plugin with other instructions set the boundary; the mod\'s own, precompute, a subagent, a skip, no rows do not', async () => {
  const rows = conversation()
  const done = { messages: rows }
  expect(observedBoundary({ trigger: 'manual' }, done)).toEqual(boundaryOf(rows))
  expect(observedBoundary({ trigger: 'manual', instructions: 'keep the API notes' }, done)).toEqual(boundaryOf(rows))
  expect(observedBoundary({ trigger: 'auto' }, done)).toEqual(boundaryOf(rows))
  expect(observedBoundary({ trigger: 'plugin', instructions: 'other' }, done)).toEqual(boundaryOf(rows))
  for (const trigger of ['manual', 'plugin', 'auto'])
    for (const instructions of [MARKER, HANDOFF_MARKER]) expect(observedBoundary({ trigger, instructions }, done)).toBeUndefined()
  expect(observedBoundary({ trigger: 'precompute' }, done)).toBeUndefined()
  expect(observedBoundary({ trigger: 'auto', agentId: 'sub' }, done)).toBeUndefined()
  expect(observedBoundary({ trigger: 'manual' }, { skip: 'off' })).toBeUndefined()
  expect(observedBoundary({ trigger: 'manual' }, { messages: [] })).toBeUndefined()
})

test('HandleCompaction — збіг за інструкцією: MARKER under manual or plugin applies; with agentId or other instructions it passes', async () => {
  expect(compactionRoute({ trigger: 'manual', instructions: MARKER })).toBe('apply')
  expect(compactionRoute({ trigger: 'plugin', instructions: MARKER })).toBe('apply')
  expect(compactionRoute({ trigger: 'auto', instructions: MARKER })).toBe('apply')
  expect(compactionRoute({ trigger: 'manual', instructions: MARKER, agentId: 'sub' })).toBe('pass')
  expect(compactionRoute({ trigger: 'manual', instructions: 'keep the API notes' })).toBe('pass')
  expect(compactionRoute({ trigger: 'manual' })).toBe('pass')
  expect(compactionRoute({ trigger: 'manual', instructions: HANDOFF_MARKER })).toBe('seed')
})

test('HandleCompaction — попереднє обчислення: precompute with MARKER or HANDOFF_MARKER passes on unchanged, even on failure', async () => {
  expect(compactionRoute({ trigger: 'precompute', instructions: MARKER })).toBe('pass')
  expect(compactionRoute({ trigger: 'precompute', instructions: HANDOFF_MARKER })).toBe('pass')
  expect(compactionFailure({ trigger: 'precompute', instructions: MARKER })).toEqual({ pass: true })
  expect(compactionFailure({ trigger: 'precompute', instructions: HANDOFF_MARKER })).toEqual({ pass: true })
})

test('HandleCompaction — збій гілки засіву: skip "seeding failed" at once, the queue untouched; a failed apply skips and records the failure', async () => {
  expect(compactionFailure({ trigger: 'manual', instructions: HANDOFF_MARKER })).toEqual({ skip: 'context-editor: seeding failed', recordFailure: false })
  expect(compactionFailure({ trigger: 'manual', instructions: MARKER })).toEqual({ skip: 'context-editor: applying the edits failed', recordFailure: true })
  expect(compactionFailure({ trigger: 'manual', instructions: 'other' })).toEqual({ pass: true })
  expect(compactionFailure({ trigger: 'manual', instructions: MARKER, agentId: 'sub' })).toEqual({ pass: true })
})

test('the markers explain themselves to the model', async () => {
  expect(MARKER).toBe('context-editor: apply queued edits')
  expect(HANDOFF_MARKER).toBe('context-editor: seed the handed-off conversation')
})

// ---- [SP_CTX_01_05] the honest report, [SP_CTX_01_14] hostId in the handler

test('HandleCompaction — жодної правки: every edit of the batch failed (its target is gone): skip, a "not changed" report without the size line, no boundary', async () => {
  const gone: QueuedEdit = { op: 'drop', tool_use_id: 'gone' }
  const { io, written } = harness({ state: 'ok', value: { ...EMPTY_QUEUE, edits: [gone] } })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toBe('context-editor: no edit could be applied')
  expect(written.queue!.report).toBe('context-editor: no edit was applied; the conversation was not changed. Not applied: drop gone: call or result not found.')
  expect(written.queue!.report).not.toContain('freed')
  expect(written.queue!.report).not.toContain('Conversation ~')
  expect(written.boundary).toBeUndefined()
})

test('HandleCompaction — правки застосовано: the report carries the size line', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 'a screenshot of X' }]))
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  const before = totalChars(conversation())
  const after = totalChars(out.messages)
  expect(written.queue!.report).toContain(`Conversation ~${before} -> ~${after} chars (estimate: ~${Math.round((before - after) / 4)} tokens (approx.) freed; context_list telemetry shows the measured change after the next response).`)
})

test('RecordBoundary — host (HandleCompaction): with hostId read the boundary carries it; without it, none', async () => {
  for (const host of ['tok:7', undefined]) {
    const { io, written } = harness(queued([{ op: 'drop', tool_use_id: 'a' }]), { hostId: () => host })
    const out = await handleCompaction(io, conversation())
    if (!('messages' in out)) throw new Error(out.skip)
    expect(written.boundary).toEqual(boundaryOf(out.messages, host))
    expect(written.boundary!.host).toBe(host)
  }
})

test('hostId — ще не прочитано: a compaction handler writes the boundary while the hostId promise runs: no wait, no new read, no host; the written text is the own boundary', async () => {
  const memo = newHostIdMemo()
  let reads = 0
  void startHostId(memo, () => {
    reads++
    return new Promise<string | undefined>(() => undefined)
  })
  const mem: BoundaryMemory = {}
  const files: string[] = []
  const { io, written } = harness(queued([{ op: 'drop', tool_use_id: 'a' }]), {
    hostId: () => peekHostId(memo),
    writeBoundary: async b => {
      written.boundary = b
      await recordBoundary(mem, async t => void files.push(t), b)
    },
  })
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.boundary!.host).toBeUndefined()
  expect(reads).toBe(1)
  expect(mem.own).toBe(files[0])
  // the observer of another compaction: the same, without host
  expect(observedBoundary({ trigger: 'manual' }, { messages: out.messages }, peekHostId(memo))).toEqual(boundaryOf(out.messages))
  // a peek starts nothing on a memo never started
  const fresh = newHostIdMemo()
  expect(peekHostId(fresh)).toBeUndefined()
  expect(fresh.promise).toBeUndefined()
})

// ---- [SP_CTX_01_04] [SP_CTX_02_07] the optimization request survives every write of the handler

test('HandleCompaction — зберігає optimize: the apply, a failed archive and the failure branch keep optimize and optimizePrompted as read', async () => {
  const flags = { optimize: true, optimizePrompted: false }
  const applied = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }], flags))
  expect('messages' in (await handleCompaction(applied.io, conversation()))).toBe(true)
  expect(applied.written.queue!.optimize).toBe(true)
  expect(applied.written.queue!.optimizePrompted).toBe(false)
  const unarchived = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }], flags), { writeArchive: async () => false })
  await handleCompaction(unarchived.io, conversation())
  expect(unarchived.written.queue!.optimize).toBe(true)
  const prompted = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }], { optimizePrompted: true }))
  await handleCompaction(prompted.io, conversation())
  expect(prompted.written.queue!.optimizePrompted).toBe(true)
  const failed = failedQueue({ ...EMPTY_QUEUE, optimize: true, optimizePrompted: false }, 'boom', 5)
  expect(failed.optimize).toBe(true)
  expect(failedQueue({ ...EMPTY_QUEUE, optimizePrompted: true }, 'boom', 5).optimizePrompted).toBe(true)
  expect(failedQueue(undefined, 'boom', 5).optimize).toBe(false)
})

test('HandleCompaction — produced and the stage marks: the made row in the returned list; a mark on a dropped service row moves back, one on a replaced row to the made row', async () => {
  const rows = conversation()
  const at = (i: number) => ({ anchor: fingerprint(rows[i]!), hint: i })
  const tags: Read<TagRegistry> = {
    state: 'ok',
    value: { ...EMPTY_REGISTRY, tags: [], stage: { name: 'B', after: at(2), openedTurn: 0 }, lastClosed: { name: 'A', after: null, end: at(4), turn: 0 } },
  }
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 'a screenshot of X' }]), {}, tags)
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  // the context_list pair is gone: the made result row stands at #2 of the returned list
  expect(out.messages.length).toBe(3)
  expect(written.tags!.lastClosed!.end).toEqual({ anchor: fingerprint(out.messages[2]!), hint: 2 })
  expect(written.tags!.stage!.after).toEqual({ anchor: fingerprint(rows[0]!), hint: 0 })
})

// [SP_CTX_01_05] phase 18: NowIndex after DropOwnCalls
test('HandleCompaction — NowIndex після DropOwnCalls: the report names the rewritten row by its index in the returned list; applied matches the batch', async () => {
  const rows: SessionMessage[] = [
    ...conversation(),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'y', tool: 'mcp__context-editor__context_note', input: {} }], handle: 'h5' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'y', text: 'noted', isError: false }], handle: 'h6' },
    { role: 'assistant', text: 'a long conclusion', toolUses: [], handle: 'h7' },
  ]
  const edits = prepare(rows, [{ op: 'rewrite', index: 7, text: 'short' }, { op: 'summarize', tool_use_id: 'a', summary: 's' }]).queued
  const { io, written } = harness({ state: 'ok', value: { ...EMPTY_QUEUE, edits } })
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  // two own pairs went: the rewritten row is #3, the summarized result #2
  expect(out.messages[3]!.text).toContain('[context-editor] you rewrote this row')
  expect(out.messages[2]!.toolResults![0]!.text).toContain('[context-editor] you read the full output here, then replaced it with your summary')
  expect(written.queue!.report).toContain('applied 2 edit(s): rewrite #7 (now #3); summarize a (now #2).')
  // the stage marks still follow the edits matched by their plain descriptions
  expect(written.tags).toBeDefined()
})

// [SP_CTX_02_14] [SP_CTX_01_05] notesDropped
test('HandleCompaction — notes: a note on a summarized pair moves; the report names the notes whose rows went; nothing named when the registry write fails', async () => {
  const tags: Read<TagRegistry> = {
    state: 'ok',
    value: { ...EMPTY_REGISTRY, tags: [], notes: [{ id: 'n1', target: { tool_use_id: 'a' }, text: 'shot', createdTurn: 0 }, { id: 'n2', target: { tool_use_id: 'z' }, text: 'listing', createdTurn: 0 }], nextNote: 3 },
  }
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 'a screenshot of X' }]), {}, tags)
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.tags!.notes.map(n => n.id)).toEqual(['n1'])
  expect(written.tags!.notes[0]!.target).toEqual({ anchor: fingerprint(out.messages[2]!), hint: 2 })
  expect(written.queue!.report).toContain('Notes dropped (their rows were removed): n2.')
  const failing = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), {
    updateTags: async () => {
      throw new Error('disk full')
    },
  }, tags)
  await handleCompaction(failing.io, conversation())
  expect(failing.written.queue!.report).not.toContain('Notes dropped')
})

// [SP_CTX_01_05] [SP_CTX_02_34] phase 17
test('HandleCompaction — правки застосовано з відношенням: charsPerToken 2.0 / absent; the handler asks for no telemetry', async () => {
  const run = async (charsPerToken?: number) => {
    const tags: Read<TagRegistry> = { state: 'ok', value: { ...EMPTY_REGISTRY, tags: [], ...(charsPerToken ? { charsPerToken } : {}) } }
    const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 'a screenshot of X' }]), {}, tags)
    const out = await handleCompaction(io, conversation())
    if (!('messages' in out)) throw new Error(out.skip)
    return { report: written.queue!.report!, freed: totalChars(conversation()) - totalChars(out.messages) }
  }
  const calibrated = await run(2)
  expect(calibrated.report).toContain(`(estimate: ~${Math.round(calibrated.freed / 2)} tokens freed;`)
  const plain = await run()
  expect(plain.report).toContain(`(estimate: ~${Math.round(plain.freed / 4)} tokens (approx.) freed;`)
})

// [SP_CTX_02_07] review round 39
test('HandleCompaction — розмір перед застосуванням: the request size before the apply goes into lastApply; unknown, nothing', async () => {
  const known = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), { requestTokens: async () => 574_000 })
  await handleCompaction(known.io, conversation())
  expect(known.written.tags!.lastApply).toEqual({ at: 1000, tokensBefore: 574_000 })
  const unknown = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), { requestTokens: async () => undefined })
  await handleCompaction(unknown.io, conversation())
  expect(unknown.written.tags!.lastApply).toBeUndefined()
})

// ---- phase 15

test('ScreenPinned — `pin` і `state`: a summarize of a pinned pair and a collapse over the state row are refused, the rewrite of the state row stays; an unreadable registry refuses all', async () => {
  const rows: SessionMessage[] = [
    { role: 'user', text: 'task', toolUses: [] },
    { role: 'assistant', text: 'state: step 1', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'A', isError: false }] },
  ]
  const edits = prepare(rows, [
    { op: 'summarize', tool_use_id: 'a', summary: 's' },
    { op: 'collapse', from_index: 0, to_index: 1, summary: 's' },
    { op: 'rewrite', index: 1, text: 'state: step 2' },
  ]).queued
  const reg: TagRegistry = {
    ...EMPTY_REGISTRY,
    tags: [
      { kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 },
      { kind: 'state', target: { anchor: fingerprint(rows[1]!), hint: 1 }, created_turn: 0 },
    ],
  }
  const out = screenPinned(rows, edits, { state: 'ok', value: reg })
  expect(out.edits.map(e => e.op)).toEqual(['rewrite'])
  expect(out.refused[0]).toContain('target is pinned')
  expect(out.refused[1]).toContain('target holds the state slot')
  const none = screenPinned(rows, edits, { state: 'unreadable', reason: 'x' })
  expect(none.edits).toEqual([])
  expect(none.refused.every(r => r.endsWith('tag registry unreadable'))).toBe(true)
})

test('HandleCompaction — P13 and the journal: the own call removed is counted in the report; the journal gets one apply entry with the Read paths', async () => {
  const entries: unknown[] = []
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 'a screenshot of X' }]), { journal: e => void entries.push(e) })
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('Your own context-editor calls (1) were removed; tags and notes stay — see context_list.')
  expect(entries).toEqual([{ kind: 'apply', at: 1000, edits: 1, archive: '/s/1000.json', compressed: [] }])
  // a batch whose edits all fail: no journal entry, no sentence
  const failed: unknown[] = []
  const none = harness({ state: 'ok', value: { ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'gone' }] } }, { journal: e => void failed.push(e) })
  await handleCompaction(none.io, conversation())
  expect(failed).toEqual([])
  expect(none.written.queue!.report).not.toContain('Your own')
})

// ---- [SP_CTX_02_07] [SP_CTX_02_36] the host's deliveries (phase 20)

const DELIVERED = '<system-reminder>\nThe user sent a new message while you were working:\nRemember PELICAN\n</system-reminder>'
const REPORTED = '<system-reminder id="r1">\nAnother Claude session sent a message while you were working:\nTEAL\n</system-reminder>'

function delivery(uuid: string, anchor: string, text = DELIVERED): QueuedDelivery {
  return { uuid, anchor: [anchor], kind: 'person', origin: 'unclassified', text, cut: 0, media: 0, at: 1 }
}

function withPairs(...ids: string[]): SessionMessage[] {
  const rows = conversation()
  ids.forEach((id, k) => {
    rows.push({ role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool: 'Bash', input: {} }], handle: `p${k}a` })
    rows.push({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text: `out ${id}`, isError: false }], handle: `p${k}b` })
  })
  return rows
}

// the API form: every result known; `media` ids hold an image
function api(ids: string[], media: string[] = []) {
  return ids.map(id => ({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: media.includes(id) ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] : 'x' }],
  }))
}

function deliveryHarness(rows: SessionMessage[], edits: unknown[], items: QueuedDelivery[] | Read<Deliveries>, media: string[] = []) {
  const pruned: string[][] = []
  const read: Read<Deliveries> = Array.isArray(items) ? { state: 'ok', value: { items } } : items
  const h = harness(
    { state: 'ok', value: { ...EMPTY_QUEUE, edits: prepare(rows, edits).queued } },
    {
      readApi: async () => api(['z', 'a', 'b', 'c'], media),
      readDeliveries: async () => read,
      pruneDeliveries: done => void pruned.push([...done].sort()),
    },
  )
  return { ...h, pruned }
}

test('HandleCompaction — доставка за службовим викликом: DropOwnCalls takes the context_list pair, the delivery stays in place', async () => {
  const rows = withPairs('b')
  const { io } = deliveryHarness(rows, [{ op: 'summarize', tool_use_id: 'b', summary: 's' }], [delivery('d1', 'z')])
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  const at = out.messages.findIndex(r => r.text === DELIVERED)
  expect(at).toBe(1)
  expect(out.messages[0]!.text).toBe('task')
  expect(out.messages.some(r => r.toolUses.some(u => u.tool.startsWith('mcp__context-editor__')))).toBe(false)
  // every call has its result in the next row
  out.messages.forEach((r, i) => {
    for (const u of r.toolUses) expect((out.messages[i + 1]!.toolResults ?? []).some(t => t.tool_use_id === u.tool_use_id)).toBe(true)
  })
})

test('HandleCompaction — звіт і розмір з доставками: one inserted, one gone with its anchor; charsAfter without it; NowIndex counts it', async () => {
  const rows = withPairs('b', 'c')
  const { io, written, pruned } = deliveryHarness(
    rows,
    [
      { op: 'summarize', tool_use_id: 'b', summary: 's' },
      { op: 'drop', tool_use_id: 'c' },
    ],
    [delivery('d1', 'a', REPORTED), delivery('d2', 'c')],
  )
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  const at = out.messages.findIndex(r => r.text === REPORTED)
  expect(out.messages[at - 1]!.toolResults![0]!.tool_use_id).toBe('a')
  expect(out.messages.some(r => r.text === DELIVERED)).toBe(false)
  expect(written.queue!.report).toContain('Messages delivered during your tool calls: 1 now stand as rows, 1 went with the rows your edits replaced.')
  const b = out.messages.findIndex(r => (r.toolResults ?? []).some(t => t.tool_use_id.startsWith('b_ce')))
  expect(b > at).toBe(true)
  expect(written.queue!.report).toContain(`summarize b (now #${b})`)
  const freed = /~(\d+) -> ~(\d+) chars/.exec(written.queue!.report!)!
  expect(Number(freed[2])).toBe(totalChars(out.messages) - REPORTED.length)
  expect(pruned).toEqual([['d1', 'd2']])
})

test('HandleCompaction — файл доставок після застосування: a delivery behind a row kept with its handle stays in the file', async () => {
  const rows = withPairs('b')
  const { io, pruned } = deliveryHarness(rows, [{ op: 'summarize', tool_use_id: 'b', summary: 's' }], [delivery('d1', 'a'), delivery('d2', 'b', REPORTED)], ['a'])
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  // the media row keeps its handle: the host carries its attachment
  expect(out.messages.find(r => (r.toolResults ?? []).some(t => t.tool_use_id === 'a'))!.handle).toBe('h4')
  expect(out.messages.some(r => r.text === DELIVERED)).toBe(false)
  expect(out.messages.some(r => r.text === REPORTED)).toBe(true)
  expect(pruned).toEqual([['d2']])
})

test('HandleCompaction — доставка за службовим викликом поза вікном API: the own row kept by its handle goes with DropOwnCalls; the delivery stays', async () => {
  const rows = withPairs('b')
  const { io } = deliveryHarness(rows, [{ op: 'summarize', tool_use_id: 'b', summary: 's' }], [delivery('d1', 'z')])
  io.readApi = async () => api(['a', 'b'])
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(out.messages.some(r => r.toolUses.some(u => u.tool_use_id === 'z'))).toBe(false)
  expect(out.messages.findIndex(r => r.text === DELIVERED)).toBe(1)
})

test('HandleCompaction — нечитабельний файл доставок: the edits apply without inserts; the report says why', async () => {
  const rows = withPairs('b')
  const { io, written, pruned } = deliveryHarness(rows, [{ op: 'summarize', tool_use_id: 'b', summary: 's' }], { state: 'unreadable', reason: 'not JSON' })
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('Messages delivered during your tool calls could not be restored (not JSON).')
  expect(pruned).toEqual([])
})
