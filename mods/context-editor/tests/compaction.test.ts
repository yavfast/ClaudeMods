import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  archiveText,
  compactionFailed,
  compactionFailure,
  compactionRoute,
  failedQueue,
  failureRecord,
  handleCompaction,
  HANDOFF_MARKER,
  MARKER,
  MEDIA_DATA,
  observeCompaction,
  observedBoundary,
  screenPinned,
  type CompactionIO,
  type FailureIO,
  type ObserveIO,
} from '../hooks/compaction'
import {
  boundaryOf,
  fingerprint,
  kilo,
  newHostIdMemo,
  peekHostId,
  prepare,
  recordBoundary,
  ROW_WINDOW,
  startHostId,
  type Boundary,
  type BoundaryMemory,
  type QueuedEdit,
} from '../hooks/edits'
import { isReplacementText, markerKind, pulledWords, REPAIR_MARKER, REWRITTEN, SUMMARIZED, totalChars } from '../hooks/rows'
import type { Pulled } from '../hooks/repair'
import { COMMAND_NOTE, EMPTY_QUEUE, LEGACY_HANDOFF_MARKER, LEGACY_MARKER, withCommandNote, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'
import { harness } from './compaction-fixtures'
import type { AliasRegistry } from '../hooks/aliases'
import type { Deliveries, QueuedDelivery } from '../hooks/deliveries'
import { missingRead, okRead, unreadableRead } from './row-fixtures'

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

function queued(edits: unknown[], extra: Partial<Queue> = {}): Read<Queue> {
  return okRead({ ...EMPTY_QUEUE, ...extra, edits: prepare(conversation(), edits).queued })
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
  expect('skip' in out && out.skip).toBe('context-editor: no edit could be applied')
  expect(written.queue!.report).toContain('summarize a: media could not be archived')
  expect(written.boundary).toBeUndefined()
  // [PL_AUD_CTX_P6] TST-18: beside an edit that applies, the media row stays as it came and only that edit applies
  const rows: SessionMessage[] = [...conversation(), { role: 'assistant', text: 'a long conclusion', toolUses: [], handle: 'h5' }]
  const edits = prepare(rows, [{ op: 'summarize', tool_use_id: 'a', summary: 's' }, { op: 'rewrite', index: 5, text: 'short' }]).queued
  const mixed = harness(okRead({ ...EMPTY_QUEUE, edits }), { writeMedia: async () => false })
  const kept = await handleCompaction(mixed.io, rows)
  if (!('messages' in kept)) throw new Error(kept.skip)
  const media = kept.messages.find(r => (r.toolResults ?? []).some(t => t.tool_use_id === 'a'))!
  expect(media).toBe(rows[4])
  expect(kept.messages.filter(r => isReplacementText(r.text) || (r.toolResults ?? []).some(t => isReplacementText(t.text))).map(r => r.text)).toEqual([
    'Later, your context_edit rewrite call replaced the text of this row with your own rewrite (original: /s/1000.json, open with Read): short',
  ])
  expect(mixed.written.queue!.report).toContain('applied 1 edit(s): rewrite #5')
  expect(mixed.written.queue!.report).toContain('summarize a: media could not be archived')
})

// ---- [SP_CTX_02_07] the commit: nothing written after an abandon, the queue last

function taggedRegistry(): Read<TagRegistry> {
  return okRead({ ...EMPTY_REGISTRY, tags: [{ kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 }] })
}

const ALIASES: Read<AliasRegistry> = okRead({ next: 3, map: { c1: 'a', c2: 'z' } })

const DELIVERY: QueuedDelivery = { uuid: 'd1', anchor: ['a'], kind: 'person', origin: 'unclassified', text: 'mid-turn', cut: 0, media: 0, at: 1 }

test('HandleCompaction — commit: the registries, the queue, then the boundary, the deliveries and the journal', async () => {
  const { io, written } = harness(
    queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]),
    { readDeliveries: async () => okRead({ items: [DELIVERY] }) },
    taggedRegistry(),
    ALIASES,
  )
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.order).toEqual(['tags', 'aliases', 'queue', 'boundary', 'deliveries', 'journal'])
  expect(written.reported).toBe(1000)
})

test('HandleCompaction — покинуто під час очікування реєстру: registry, aliases, boundary, deliveries and journal unchanged; the batch stays queued', async () => {
  let aborted = false
  const { io, written } = harness(
    queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]),
    {
      isAborted: () => aborted,
      // the host abandons the dispatch while the handler waits for the registries' chains
      onRegistries: async work => {
        aborted = true
        return work()
      },
      readDeliveries: async () => okRead({ items: [DELIVERY] }),
    },
    taggedRegistry(),
    ALIASES,
  )
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('abandoned')
  expect(written.order).toEqual([])
  expect(written.queue).toBeUndefined()
  expect(written.reported).toBeUndefined()
  // the failure branch that follows drops the batch with one report of the failure
  const failed = failureRecord(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), written.reported, 'timeout', 5)!
  expect(failed.edits).toEqual([])
  expect(failed.report).toContain('applying the edits failed (timeout)')
})

test('HandleCompaction — покинуто між записами: the registries already written are put back as read; the queue is not written', async () => {
  let aborted = false
  const tags = taggedRegistry()
  const { io, written } = harness(
    queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]),
    {
      isAborted: () => aborted,
      writeTags: async reg => {
        written.tags = reg
        written.order.push('tags')
        aborted = true
      },
    },
    tags,
    ALIASES,
  )
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('abandoned')
  expect(written.order).toEqual(['tags', 'tags'])
  expect(written.tags).toEqual(tags.state === 'ok' ? tags.value : undefined)
  expect(written.queue).toBeUndefined()
})

test('HandleCompaction — запис черги кидає: the registries are put back, nothing after the queue runs, the failure reaches the failure branch', async () => {
  const tags = taggedRegistry()
  const { io, written } = harness(
    queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]),
    {
      writeQueue: async () => {
        throw new Error('disk full')
      },
    },
    tags,
    ALIASES,
  )
  let error = ''
  await handleCompaction(io, conversation()).catch(err => void (error = String(err)))
  expect(error).toContain('disk full')
  // rebound, then put back: the registry is as it was read
  expect(written.tags).toEqual(tags.state === 'ok' ? tags.value : undefined)
  expect(written.aliases).toEqual(ALIASES.state === 'ok' ? ALIASES.value : undefined)
  expect(written.order).toEqual(['tags', 'aliases', 'tags', 'aliases'])
  expect(written.boundary).toBeUndefined()
  expect(written.journal).toEqual([])
  expect(written.reported).toBeUndefined()
})

test('failureRecord — без пари «applied» + «failed»: once the apply wrote its report, the failure branch writes nothing; an earlier report keeps the failure recorded', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]))
  await handleCompaction(io, conversation())
  const after: Read<Queue> = okRead(written.queue!)
  expect(written.queue!.report).toContain('applied')
  expect(failureRecord(after, written.reported, 'throw', 5)).toBeUndefined()
  // an apply that failed before its commit: the batch is still there beside an older report
  const batch = queued([{ op: 'drop', tool_use_id: 'a' }])
  const older: Read<Queue> = okRead({ ...written.queue!, edits: batch.state === 'ok' ? batch.value.edits : [] })
  const failed = failureRecord(older, written.reported, 'throw', 5)!
  expect(failed.edits).toEqual([])
  expect(failed.report!.split('\n').length).toBe(2)
  expect(failed.report).toContain('applying the edits failed (throw)')
  // nothing applied by this instance yet, or an unreadable queue: the failure is recorded
  expect(failureRecord(after, undefined, 'throw', 5)).toBeDefined()
  expect(failureRecord(unreadableRead('x'), 1000, 'throw', 5)!.report).toContain('applying the edits failed')
})

test('HandleCompaction — покинуто під час запису черги: the batch goes back as read, the registries are put back; no boundary, deliveries or journal; the report does not count', async () => {
  let aborted = false
  const tags = taggedRegistry()
  const batch = queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }])
  const queues: Queue[] = []
  const { io, written } = harness(
    batch,
    {
      isAborted: () => aborted,
      writeQueue: async q => {
        queues.push(q)
        written.order.push('queue')
        aborted = true
      },
      readDeliveries: async () => okRead({ items: [DELIVERY] }),
    },
    tags,
    ALIASES,
  )
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('abandoned')
  expect(queues.length).toBe(2)
  expect(queues[0]!.report).toContain('applied')
  expect(queues[1]).toEqual(batch.state === 'ok' ? batch.value : undefined)
  expect(written.order).toEqual(['tags', 'aliases', 'queue', 'queue', 'tags', 'aliases'])
  expect(written.tags).toEqual(tags.state === 'ok' ? tags.value : undefined)
  expect(written.boundary).toBeUndefined()
  expect(written.pruned).toBeUndefined()
  expect(written.journal).toEqual([])
  expect(written.reported).toBeUndefined()
  expect(written.toasts).toEqual([])
})

// [SP_CTX_02_07] TST-21 (b)
test('HandleCompaction — архів не записано і диспетчеризацію покинуто: the first abort check skips before any write', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), { writeArchive: async () => false, isAborted: () => true })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('abandoned')
  expect(written.queue).toBeUndefined()
  expect(written.order).toEqual([])
  expect(written.toasts).toEqual([])
})

test('an abandoned dispatch keeps the batch queued and writes nothing to the queue', async () => {
  const { io, written } = harness(queued([{ op: 'drop', tool_use_id: 'a' }]), { isAborted: () => true })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('abandoned')
  expect(written.queue).toBeUndefined()
})

test('an unreadable or empty queue is skipped untouched', async () => {
  const a = harness(unreadableRead('x'))
  expect(await handleCompaction(a.io, conversation())).toEqual({ skip: 'context-editor: queue unreadable' })
  expect(a.written.queue).toBeUndefined()
  expect(a.written.order).toEqual([])
  const b = harness(missingRead({ ...EMPTY_QUEUE }))
  expect(await handleCompaction(b.io, conversation())).toEqual({ skip: 'context-editor: no queued edits' })
  expect(b.written.queue).toBeUndefined()
  expect(b.written.order).toEqual([])
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
  const { io, written } = harness(batch, {}, okRead(pinned))
  const out = await handleCompaction(io, conv)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('collapse #0..#2: target is pinned; remove the pin with context_tag first')
  expect(written.queue!.report).toContain('applied 1 edit(s): drop a')
  expect(out.messages[0]!.text).toBe('task')
})

test('an unreadable tag registry fails every edit and changes nothing', async () => {
  const { io, written } = harness(queued([{ op: 'drop', tool_use_id: 'a' }]), {}, unreadableRead('bad tag 1'))
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
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), {}, okRead(reg))
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
  // [SP_CTX_DEC_26] each says who ran the command
  expect(MARKER).toBe('context-editor: apply queued edits (run automatically by the mod for context edits the agent queued, not by the person)')
  // no quote a host might escape
  expect(/['"`]/.test(MARKER) || /['"`]/.test(HANDOFF_MARKER)).toBe(false)
  expect(HANDOFF_MARKER).toBe('context-editor: seed the handed-off conversation (run automatically by the mod, not by the person)')
})

test('HandleCompaction — мітки до фази 25: the old MARKER applies and the old HANDOFF_MARKER seeds; their failure is a skip; the observer leaves them alone', async () => {
  expect(LEGACY_MARKER).toBe('context-editor: apply queued edits')
  expect(LEGACY_HANDOFF_MARKER).toBe('context-editor: seed the handed-off conversation')
  expect(compactionRoute({ trigger: 'manual', instructions: LEGACY_MARKER })).toBe('apply')
  expect(compactionRoute({ trigger: 'manual', instructions: LEGACY_HANDOFF_MARKER })).toBe('seed')
  expect(compactionRoute({ trigger: 'manual', instructions: `${LEGACY_MARKER} ` })).toBe('pass')
  expect(compactionFailure({ trigger: 'manual', instructions: LEGACY_MARKER })).toEqual({ skip: 'context-editor: applying the edits failed', recordFailure: true })
  const done = { messages: conversation() }
  expect(observedBoundary({ trigger: 'manual', instructions: 'other' }, done)).toBeDefined()
  for (const instructions of [LEGACY_MARKER, LEGACY_HANDOFF_MARKER]) expect(observedBoundary({ trigger: 'manual', instructions }, done)).toBeUndefined()
})

test('CommandNote — звіт у черзі: the apply report and the failure report end with it; the toast goes without it', async () => {
  expect(COMMAND_NOTE).toBe('A /compact command row whose args start with "context-editor:" is a service command the mod ran (here: to apply your queued edits); the person did not run it.')
  expect(failedQueue(undefined, 'boom', 1).report!.endsWith(` ${COMMAND_NOTE}`)).toBe(true)
  const gone: QueuedEdit = { op: 'drop', tool_use_id: 'gone' }
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits: [gone] }))
  await handleCompaction(io, conversation())
  expect(written.queue!.report!.endsWith(` ${COMMAND_NOTE}`)).toBe(true)
  expect(written.toasts.length).toBe(1)
  expect(written.toasts.join('\n')).not.toContain('service command')
})

// ---- [SP_CTX_01_05] the honest report, [SP_CTX_01_14] hostId in the handler

test('HandleCompaction — жодної правки: every edit of the batch failed (its target is gone): skip, a "not changed" report without the size line, no boundary', async () => {
  const gone: QueuedEdit = { op: 'drop', tool_use_id: 'gone' }
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits: [gone] }))
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toBe('context-editor: no edit could be applied')
  expect(written.queue!.report).toBe(withCommandNote('context-editor: no edit was applied; the conversation was not changed. Not applied: drop gone: call or result not found.'))
  expect(written.queue!.report).not.toContain('freed')
  expect(written.queue!.report).not.toContain('Conversation ~')
  expect(written.boundary).toBeUndefined()
})

// [SP_CTX_02_43] The handler leaves the person's line with its report id;
// Flush logs it once the command returned. None without an applied edit.
test('ApplyLine — з обробника: an apply passes its report id and the line; an apply without an edit passes the id alone', async () => {
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]))
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.reported).toBe(1000)
  expect(/^applied 1 edit\(s\): conversation ~\S+ → ~\S+ tokens \((approx\.; )?freed ~\S+\)$/.test(written.line ?? '')).toBe(true)
  // the line is for the person: neither the report nor the rows carry it
  expect(written.queue!.report).not.toContain(written.line!)
  const gone = harness(okRead({ ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'gone' }] }))
  await handleCompaction(gone.io, conversation())
  expect(gone.written.reported).toBe(1000)
  expect(gone.written.line).toBeUndefined()
})

// [SP_CTX_02_43] phase 29: the handler's API form sizes the person's line;
// one at its window does not (ApiCut), the rows do
test('ApplyLine — API-подання з обробника: API chars above the rows\' size the line; a form at its window leaves the rows', async () => {
  const edits = [{ op: 'summarize' as const, tool_use_id: 'a', summary: 's' }]
  const tags = okRead({ ...EMPTY_REGISTRY, charsPerToken: 2 })
  const rowsBefore = totalChars(conversation())
  const base = harness(queued(edits), {}, tags).io.readApi
  const big = harness(queued(edits), { readApi: async () => [{ role: 'user', content: 'x'.repeat(rowsBefore + 10_000) }, ...(await base())] }, tags)
  const out = await handleCompaction(big.io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(big.written.line!.startsWith(`applied 1 edit(s): conversation ~${kilo(Math.round((rowsBefore + 10_000 + 'listing'.length) / 2))} → `)).toBe(true)
  const cut = harness(queued(edits), { readApi: async () => [...Array.from({ length: ROW_WINDOW - 2 }, () => ({ role: 'user', content: 'x' })), ...(await base())] }, tags)
  const kept = await handleCompaction(cut.io, conversation())
  if (!('messages' in kept)) throw new Error(kept.skip)
  expect(cut.written.line!.startsWith(`applied 1 edit(s): conversation ~${kilo(Math.round(rowsBefore / 2))} → `)).toBe(true)
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
  expect(fresh.current).toBeUndefined()
  expect(fresh.reads).toBe(0)
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
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits }))
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  // two own pairs went: the rewritten row is #3, the summarized result #2
  expect(out.messages[3]!.text).toContain(REWRITTEN)
  expect(out.messages[2]!.toolResults![0]!.text).toContain(SUMMARIZED)
  expect(written.queue!.report).toContain('applied 2 edit(s): rewrite #7 (now #3); summarize a (now #2).')
  // the stage marks still follow the edits matched by their plain descriptions
  expect(written.tags).toBeDefined()
  // [PL_AUD_CTX_P6] TST-18: marks on the two replaced rows go to their made rows
  const at = (i: number) => ({ anchor: fingerprint(rows[i]!), hint: i })
  const tags: Read<TagRegistry> = {
    state: 'ok',
    value: { ...EMPTY_REGISTRY, tags: [], stage: { name: 'B', after: at(4), openedTurn: 0 }, lastClosed: { name: 'A', after: null, end: at(7), turn: 0 } },
  }
  const marked = harness(okRead({ ...EMPTY_QUEUE, edits }), {}, tags)
  const again = await handleCompaction(marked.io, rows)
  if (!('messages' in again)) throw new Error(again.skip)
  expect(marked.written.tags!.stage!.after).toEqual({ anchor: fingerprint(again.messages[2]!), hint: 2 })
  expect(marked.written.tags!.lastClosed!.end).toEqual({ anchor: fingerprint(again.messages[3]!), hint: 3 })
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
    writeTags: async () => {
      throw new Error('disk full')
    },
  }, tags)
  await handleCompaction(failing.io, conversation())
  expect(failing.written.queue!.report).not.toContain('Notes dropped')
})

// [SP_CTX_01_05] [SP_CTX_02_34] phase 17
test('HandleCompaction — правки застосовано з відношенням: charsPerToken 2.0 / absent; the handler asks for no telemetry', async () => {
  const run = async (charsPerToken?: number) => {
    const tags: Read<TagRegistry> = okRead({ ...EMPTY_REGISTRY, tags: [], ...(charsPerToken ? { charsPerToken } : {}) })
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
  const out = screenPinned(rows, edits, okRead(reg))
  expect(out.edits.map(e => e.op)).toEqual(['rewrite'])
  expect(out.refused[0]).toContain('target is pinned')
  expect(out.refused[1]).toContain('target holds the state slot')
  const none = screenPinned(rows, edits, unreadableRead('x'))
  expect(none.edits).toEqual([])
  expect(none.refused.every(r => r.endsWith('tag registry unreadable'))).toBe(true)
})

test('HandleCompaction — P13 and the journal: the own call removed is counted in the report; the journal gets one apply entry with the Read paths', async () => {
  const entries: unknown[] = []
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 'a screenshot of X' }]), { journal: e => void entries.push(e) })
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('Your context_* calls (1), including the ones that queued these replacements, were removed from the conversation; tags and notes stay — see context_list.')
  expect(entries).toEqual([{ kind: 'apply', at: 1000, edits: 1, archive: '/s/1000.json', compressed: [] }])
  // a batch whose edits all fail: no journal entry, no sentence
  const failed: unknown[] = []
  const none = harness(okRead({ ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'gone' }] }), { journal: e => void failed.push(e) })
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
  const read: Read<Deliveries> = Array.isArray(items) ? okRead({ items }) : items
  const h = harness(
    okRead({ ...EMPTY_QUEUE, edits: prepare(rows, edits).queued }),
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
  const { io, written, pruned } = deliveryHarness(rows, [{ op: 'summarize', tool_use_id: 'b', summary: 's' }], unreadableRead('not JSON'))
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('Messages delivered during your tool calls could not be restored (not JSON).')
  expect(pruned).toEqual([])
})

// ---- [SP_CTX_02_04] [SP_CTX_DEC_22] the frozen prefix (phase 23)

// a turn: thinking and an own context_list, thinking and Bash a, thinking and Bash b, the final text
function turnRows(): SessionMessage[] {
  const think = (h: string): SessionMessage => ({ role: 'assistant', text: '', toolUses: [], handle: h })
  const call = (id: string, tool: string): SessionMessage => ({ role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: {} }], handle: `u${id}` })
  const res = (id: string, text: string): SessionMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }], handle: `r${id}` })
  return [
    { role: 'user', text: 'task', toolUses: [], handle: 'p' },
    think('t1'),
    call('z', 'mcp__context-editor__context_list'),
    res('z', 'listing'),
    think('t2'),
    call('a', 'Bash'),
    res('a', 'out a'),
    think('t3'),
    call('b', 'Bash'),
    res('b', BIG),
    { role: 'assistant', text: 'done', toolUses: [], handle: 'f' },
  ]
}

// the API form of turnRows: one assistant message per response
function turnApi(withResponses = true): unknown[] {
  const reply = (id: string) => ({ role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id, name: 'x', input: {} }] })
  const res = (id: string) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] })
  const all = [{ role: 'user', content: 'task' }, reply('z'), res('z'), reply('a'), res('a'), reply('b'), res('b'), { role: 'assistant', content: [{ type: 'text', text: 'done' }] }]
  return withResponses ? all : all.filter(m => m.role === 'user')
}

// `keepCache`: the batch asked for the frozen prefix ("keep_cache": true)
function frozenHarness(withResponses: boolean, keepCache = true) {
  const rows = turnRows()
  const pruned: string[][] = []
  const h = harness(
    okRead({ ...EMPTY_QUEUE, keepCache, edits: prepare(rows, [{ op: 'summarize', tool_use_id: 'b', summary: 'b is fine' }]).queued }),
    {
      readApi: async () => turnApi(withResponses),
      readDeliveries: async () => okRead({ items: [delivery('d1', 'a', REPORTED), delivery('d2', 'b')] }),
      pruneDeliveries: done => void pruned.push([...done].sort()),
    },
  )
  return { rows, ...h, pruned }
}

test('HandleCompaction — заморожений префікс (keep_cache): the rows before the response of the edit come back as they came: thinking, the own call, result rows and the delivery behind one', async () => {
  const { rows, io, written, pruned } = frozenHarness(true)
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  // rows #0..#6 are the same objects, handle and all; the delivery behind result a rides on its handle
  for (let i = 0; i < 7; i++) expect(out.messages[i]).toBe(rows[i]!)
  expect(out.messages.some(r => r.text === REPORTED)).toBe(false)
  // from the response of b on: its thinking went, the pair rebuilt, the delivery behind b inserted, the final text rebuilt
  expect(out.messages[7]!.toolUses[0]!.tool_use_id.startsWith('b_ce')).toBe(true)
  expect(out.messages[8]!.toolResults![0]!.text.startsWith(SUMMARIZED)).toBe(true)
  expect(out.messages[9]!.text).toBe(DELIVERED)
  expect(out.messages[10]!.text).toBe('done')
  expect(out.messages[10]!.handle).toBeUndefined()
  expect(out.messages.length).toBe(11)
  // the own call before the first change stays: nothing is said about removed calls
  expect(written.queue!.report).not.toContain('Your context_* calls')
  expect(written.queue!.report).toContain('Messages delivered during your tool calls: 1 now stand as rows.')
  expect(pruned).toEqual([['d2']])
})

test('HandleCompaction — префікс без API-повідомлень: without the response in the API form the stretch is rebuilt from the prompt as before', async () => {
  const { rows, io, written } = frozenHarness(false)
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(out.messages[0]).toBe(rows[0]!)
  // the thinking rows went, the own pair too; the delivery behind a is a row now
  expect(out.messages.some(r => r.handle === 't1' || r.handle === 't2')).toBe(false)
  expect(out.messages.some(r => r.toolUses.some(u => u.tool.startsWith('mcp__context-editor__')))).toBe(false)
  expect(out.messages.some(r => r.text === REPORTED)).toBe(true)
  expect(written.queue!.report).toContain('Your context_* calls (1), including the ones that queued these replacements, were removed')
})

test('HandleCompaction — без keep_cache (типово): the API form at hand, yet the stretch is rebuilt as before phase 23: thinking gone, own pair removed, result rows rebuilt (DEC_02), the delivery behind a a row', async () => {
  const { rows, io, written } = frozenHarness(true, false)
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(out.messages[0]).toBe(rows[0]!)
  // every assistant row of the stretch rebuilt: the thinking rows went
  expect(out.messages.filter(r => r.role === 'assistant').every(r => r.handle === undefined)).toBe(true)
  expect(out.messages.some(r => r.handle === 't1' || r.handle === 't2' || r.handle === 't3')).toBe(false)
  // the result row of a, untouched by the edit, rebuilt without its handle (SP_CTX_DEC_02); the delivery behind it inserted
  const ra = out.messages.findIndex(r => (r.toolResults ?? []).some(x => x.tool_use_id === 'a'))
  expect(out.messages[ra]!.handle).toBeUndefined()
  expect(out.messages[ra + 1]!.text).toBe(REPORTED)
  expect(out.messages.some(r => r.toolUses.some(u => u.tool.startsWith('mcp__context-editor__')))).toBe(false)
  expect(written.queue!.report).toContain('Your context_* calls (1), including the ones that queued these replacements, were removed')
  // the queue after the batch: keepCache back to false
  expect(written.queue!.keepCache).toBe(false)
})

// ---- [SP_CTX_02_18] ObserveCompaction: the `pass` branch ([PL_AUD_CTX_P10], CF-19)

function observer(start: TagRegistry, over: Partial<ObserveIO> = {}) {
  const log = { copies: [] as (readonly SessionMessage[] | undefined)[], boundaries: [] as { dir: string; b: Boundary }[], tags: start, updates: 0 }
  const io: ObserveIO = {
    copies: rows => void log.copies.push(rows),
    hostId: () => 'H',
    storage: async () => '/s',
    writeBoundary: async (dir, b) => void log.boundaries.push({ dir, b }),
    updateTags: () => async change => {
      log.updates++
      const next = change(log.tags)
      if (!next) return false
      log.tags = next
      return true
    },
    ...over,
  }
  return { io, log }
}

const MEASURED: TagRegistry = { ...EMPTY_REGISTRY, lastApply: { at: 1, tokensBefore: 90_000 } }

test('ObserveCompaction — чужа компактизація: its rows are Copied, it records the boundary with hostId and drops lastApply', async () => {
  const rows = conversation()
  const { io, log } = observer(MEASURED)
  await observeCompaction(io, { trigger: 'auto' }, { messages: rows })
  expect(log.copies).toEqual([rows])
  expect(log.boundaries).toEqual([{ dir: '/s', b: boundaryOf(rows, 'H') }])
  expect(log.tags.lastApply).toBeUndefined()
  // without lastApply nothing is written
  const plain = observer(EMPTY_REGISTRY)
  await observeCompaction(plain.io, { trigger: 'manual' }, { messages: rows })
  expect(plain.log.tags).toBe(EMPTY_REGISTRY)
})

test('ObserveCompaction — фаза 33: a compaction that stands after the intro sets reintroduce; before it, none', async () => {
  const rows = conversation()
  const after = observer({ ...EMPTY_REGISTRY, introduced: true })
  await observeCompaction(after.io, { trigger: 'auto' }, { messages: rows })
  expect(after.log.tags.reintroduce).toBe(true)
  const before = observer(EMPTY_REGISTRY)
  await observeCompaction(before.io, { trigger: 'auto' }, { messages: rows })
  expect(before.log.tags).toBe(EMPTY_REGISTRY)
  // the mod's own marker leaves it alone
  const own = observer({ ...EMPTY_REGISTRY, introduced: true })
  await observeCompaction(own.io, { trigger: 'manual', instructions: MARKER }, { messages: rows })
  expect(own.log.tags.reintroduce).toBeUndefined()
})

test('ObserveCompaction — no boundary, lastApply kept: a subagent, precompute, the mod\'s own markers, a skip, no storage, a failed write', async () => {
  const rows = conversation()
  const sub = observer(MEASURED)
  await observeCompaction(sub.io, { trigger: 'auto', agentId: 'x' }, { messages: rows })
  expect(sub.log.copies).toEqual([])
  for (const e of [{ trigger: 'precompute' }, { trigger: 'manual', instructions: MARKER }, { trigger: 'manual', instructions: HANDOFF_MARKER }]) {
    const h = observer(MEASURED)
    await observeCompaction(h.io, e, { messages: rows })
    // the copies are noted whatever the trigger, once nothing skipped it
    expect(h.log.copies).toEqual([rows])
    expect(h.log.boundaries).toEqual([])
    expect(h.log.tags.lastApply).toBeDefined()
  }
  const skipped = observer(MEASURED)
  await observeCompaction(skipped.io, { trigger: 'manual' }, { skip: 'no' })
  expect(skipped.log.copies).toEqual([])
  expect(skipped.log.boundaries).toEqual([])
  const none = observer(MEASURED, { storage: async () => undefined })
  await observeCompaction(none.io, { trigger: 'auto' }, { messages: rows })
  expect(none.log.updates).toBe(0)
  const failed = observer(MEASURED, { writeBoundary: async () => Promise.reject(new Error('disk')) })
  await observeCompaction(failed.io, { trigger: 'auto' }, { messages: rows })
  expect(failed.log.tags.lastApply).toBeDefined()
})

// [SP_CTX_02_18] [SP_CTX_DEC_31] B (phase 30, CF-34)
test('PruneDeadTags — чужа компактизація: the tags of pairs and rows the compaction left out go with lastApply in one change; review search on a kept pair, the state slot and a range that stays remain', async () => {
  const all = conversation()
  // the host's summary kept the task and the Read pair a, not the context_list pair z
  const kept = [all[0]!, all[3]!, all[4]!]
  const range = { anchor: fingerprint(all[3]!), hint: 3, toAnchor: fingerprint(all[4]!), toHint: 4 }
  const start: TagRegistry = {
    ...MEASURED,
    tags: [
      { kind: 'pin', target: { anchor: fingerprint(all[1]!), hint: 1 }, created_turn: 0 },
      { kind: 'review', reason: 'big', target: { tool_use_id: 'z' }, created_turn: 0 },
      { kind: 'review', reason: 'search', target: { tool_use_id: 'a' }, created_turn: 0 },
      { kind: 'state', target: { anchor: fingerprint(all[2]!), hint: 2 }, created_turn: 0 },
      { kind: 'disposable', target: range, note: 'n', created_turn: 0 },
    ],
  }
  const { io, log } = observer(start)
  await observeCompaction(io, { trigger: 'manual', messages: all }, { messages: kept })
  expect(log.updates).toBe(1)
  expect(log.tags.tags.map(t => `${t.kind}${t.reason ? ` ${t.reason}` : ''}`)).toEqual(['review search', 'state', 'disposable'])
  expect(log.tags.lastApply).toBeUndefined()
})

test('PruneDeadTags — нічого прибирати: every target kept and no lastApply: no write; a skip, a subagent, the mod\'s markers and precompute leave the registry alone', async () => {
  const rows = conversation()
  const live: TagRegistry = { ...EMPTY_REGISTRY, tags: [{ kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 }] }
  const same = observer(live)
  await observeCompaction(same.io, { trigger: 'auto', messages: rows }, { messages: rows })
  expect(same.log.tags).toBe(live)
  // review fix: a pair appended after the compaction took its input (mid-turn)
  // is not among its rows, yet its tag lives on
  const late: TagRegistry = { ...EMPTY_REGISTRY, tags: [{ kind: 'review', reason: 'big', target: { tool_use_id: 'late' }, created_turn: 0 }] }
  const midTurn = observer(late)
  await observeCompaction(midTurn.io, { trigger: 'auto', messages: rows }, { messages: rows.slice(0, 1) })
  expect(midTurn.log.tags).toBe(late)
  for (const [e, done] of [
    [{ trigger: 'manual' }, { skip: 'no' }],
    [{ trigger: 'auto', agentId: 'x' }, { messages: [] }],
    [{ trigger: 'manual', instructions: MARKER }, { messages: [] }],
    [{ trigger: 'precompute' }, { messages: [] }],
  ] as const) {
    const h = observer(live)
    await observeCompaction(h.io, e, done)
    expect(h.log.updates).toBe(0)
  }
})

// ---- [SP_CTX_02_07] CompactionFailed: the handler's `.catch`

function failing(dir: string | undefined, queue: Read<Queue>, reported?: number) {
  const log = { queue, changes: [] as string[] }
  const io: FailureIO = {
    dir,
    reported,
    now: () => 9,
    changeQueue: async (d, change) => {
      log.changes.push(d)
      const next = await change(log.queue)
      if (next) log.queue = okRead(next)
      return !!next
    },
  }
  return { io, log }
}

test('CompactionFailed — a compaction not the mod\'s passes; the seed skips without a record; the apply skips and records the failure in its folder', async () => {
  const batch = okRead<Queue>({ ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'a' }] })
  const pass = failing('/s', batch)
  expect(compactionFailed(pass.io, { trigger: 'manual' }, 'throw')).toEqual({ pass: true })
  const seed = failing('/s', batch)
  expect(compactionFailed(seed.io, { trigger: 'manual', instructions: HANDOFF_MARKER }, 'throw')).toEqual({ skip: 'context-editor: seeding failed' })
  expect(seed.log.changes).toEqual([])
  const apply = failing('/s', batch)
  expect(compactionFailed(apply.io, { trigger: 'manual', instructions: MARKER }, 'timeout')).toEqual({ skip: 'context-editor: applying the edits failed' })
  await Promise.resolve()
  expect(apply.log.changes).toEqual(['/s'])
  const q = apply.log.queue.state === 'ok' ? apply.log.queue.value : undefined
  expect(q!.edits).toEqual([])
  expect(q!.report).toContain('applying the edits failed (timeout)')
  const nowhere = failing(undefined, batch)
  expect('skip' in compactionFailed(nowhere.io, { trigger: 'manual', instructions: MARKER }, 'x')).toBe(true)
  expect(nowhere.log.changes).toEqual([])
})

// ---- [SP_CTX_02_45] [SP_CTX_02_44] [SP_CTX_02_47] phase 32: the repair after a resume

test('MarkerKind — ремонт: REPAIR_MARKER repairs, MARKER applies, HANDOFF_MARKER seeds, other text none; a repair failure writes nothing', async () => {
  expect(markerKind(REPAIR_MARKER)).toBe('repair')
  expect(markerKind(MARKER)).toBe('apply')
  expect(markerKind(HANDOFF_MARKER)).toBe('seed')
  expect(markerKind('context-editor: repair')).toBeUndefined()
  expect(compactionRoute({ trigger: 'manual', instructions: REPAIR_MARKER })).toBe('repair')
  expect(compactionRoute({ trigger: 'precompute', instructions: REPAIR_MARKER })).toBe('pass')
  expect(compactionRoute({ trigger: 'manual', instructions: REPAIR_MARKER, agentId: 'sub' })).toBe('pass')
  expect(compactionFailure({ trigger: 'manual', instructions: REPAIR_MARKER })).toEqual({ skip: 'context-editor: repair failed', recordFailure: false })
  // it says who ran it, with no quote a host might escape
  expect(REPAIR_MARKER).toBe('context-editor: repair the resumed conversation (run automatically by the mod: resuming loaded some answers twice; not by the person)')
  expect(/['"`]/.test(REPAIR_MARKER)).toBe(false)
  // the observer of other compactions leaves the mod's repair alone
  expect(observedBoundary({ trigger: 'manual', instructions: REPAIR_MARKER }, { messages: conversation() })).toBeUndefined()
})

const pulledLedger = (handles: string[]): Pulled => ({ ledger: { entries: [{ at: 1, handles }] }, applied: true, unreadable: false, clean: false })

function loaded(): SessionMessage[] {
  const [head, ...rest] = conversation()
  return [
    head!,
    // the original of pair q (the ledger names it) beside its copy
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'q', tool: 'Bash', input: {} }], handle: 'o1' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'q', text: 'out q', isError: false }], handle: 'o2' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'q', tool: 'Bash', input: {} }], handle: 'c1' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'q', text: 'out q', isError: false }], handle: 'c2' },
    ...rest,
  ]
}

test('HandleCompaction — завантажений ланцюжок: the originals go before the edits; pulledDropped and PULLED_TEXT; the inputs recorded after the commit', async () => {
  const recorded: { handles: (string | undefined)[]; id: number }[] = []
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), {
    readPulled: async () => pulledLedger(['o1', 'o2']),
    recordInputs: (messages, id) => {
      recorded.push({ handles: messages.map(r => r.handle), id })
      written.order.push('ledger')
    },
  })
  const out = await handleCompaction(io, loaded())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(out.messages.filter(r => r.toolUses.some(u => u.tool_use_id === 'q')).length).toBe(1)
  expect(out.messages.filter(r => r.toolResults?.some(t => t.tool_use_id === 'q')).length).toBe(1)
  expect(written.queue!.report).toContain(pulledWords(2))
  expect(written.order.at(-1)).toBe('ledger')
  expect(written.order.indexOf('queue')).toBeLessThan(written.order.indexOf('ledger'))
  expect(recorded).toEqual([{ handles: ['h0', 'c1', 'c2', 'h1', 'h2', 'h3', 'h4'], id: 1000 }])
})

test('HandleCompaction — той самий процес: no ledger handle in the input, nothing dropped, no sentence; no record on a skip', async () => {
  const recorded: number[] = []
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), {
    readPulled: async () => pulledLedger(['o1', 'o2']),
    recordInputs: (_, id) => void recorded.push(id),
  })
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).not.toContain('resuming the session')
  expect(recorded).toEqual([1000])
  const skipped = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), {
    writeArchive: async () => false,
    recordInputs: (_, id) => void recorded.push(id),
  })
  await handleCompaction(skipped.io, conversation())
  expect(recorded).toEqual([1000])
})

test('HandleCompaction — уже компактизовано тут: the ledger is not read and nothing is dropped, even with ledger handles in the input', async () => {
  let reads = 0
  const { io, written } = harness(queued([{ op: 'summarize', tool_use_id: 'a', summary: 's' }]), {
    readPulled: async () => (reads++, pulledLedger(['o1', 'o2'])),
    compactedHere: () => true,
  })
  const out = await handleCompaction(io, loaded())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(reads).toBe(0)
  expect(written.queue!.report).not.toContain('resuming the session')
  expect(out.messages.filter(r => r.toolUses.some(u => u.tool_use_id === 'q')).length).toBe(2)
})
