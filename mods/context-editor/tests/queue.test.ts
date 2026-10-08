import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { MAX_QUEUE_EDITS } from '../hooks/edits'
import { contextEdit, DEFAULT_RESUME, deliverReport, EMPTY_QUEUE, MAX_QUEUE_BYTES, parseQueue, queueEdits, withoutReport, type Queue, type QueueIO, type Read } from '../hooks/queue'

const rows: SessionMessage[] = [
  { role: 'user', text: 'task', toolUses: [], handle: 'h0' },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'h1' },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x'.repeat(5000), isError: false }], handle: 'h2' },
]

test('parseQueue reads a good file and refuses bad JSON or a field of the wrong type', async () => {
  expect(parseQueue(JSON.stringify(EMPTY_QUEUE)).state).toBe('ok')
  expect(parseQueue('{').state).toBe('unreadable')
  const bad = parseQueue(JSON.stringify({ ...EMPTY_QUEUE, resume: 'no' }))
  expect(bad.state).toBe('unreadable')
  expect(bad.state === 'unreadable' && bad.reason).toContain('resume')
  expect(parseQueue('[]').state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [42] })).state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'a', anchors: [1] }] })).state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'a' }] })).state).toBe('ok')
})

test('queueEdits refuses empty lists, long resume prompts, a full queue and an oversized file', async () => {
  expect('deny' in queueEdits(EMPTY_QUEUE, rows, { edits: [] })).toBe(true)
  expect('deny' in queueEdits(EMPTY_QUEUE, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }], resume_prompt: 'x'.repeat(9000) })).toBe(true)
  const full = { ...EMPTY_QUEUE, edits: Array.from({ length: MAX_QUEUE_EDITS }, () => ({ op: 'drop' as const, tool_use_id: 'a' })) }
  const over = queueEdits(full, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in over && over.deny).toContain('exceed')
  const huge = { ...EMPTY_QUEUE, report: 'x'.repeat(MAX_QUEUE_BYTES) }
  const big = queueEdits(huge, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in big && big.deny).toContain('bytes')
})

test('queueEdits sets the batch fields and keeps rejections beside accepted edits', async () => {
  const out = queueEdits({ ...EMPTY_QUEUE, tagsOnly: true }, rows, {
    edits: [{ op: 'drop', tool_use_id: 'a' }, { op: 'drop', tool_use_id: 'zz' }],
    resume: false,
    resume_prompt: 'go on',
  })
  if ('deny' in out) throw new Error(out.deny)
  expect(out.queued).toBe(1)
  expect(out.errors.length).toBe(1)
  expect(out.queue.tagsOnly).toBe(false)
  expect(out.queue.resume).toBe(false)
  expect(out.queue.resumePrompt).toBe('go on')
})

test('withoutReport removes only the delivered text', async () => {
  const q = { ...EMPTY_QUEUE, report: 'r', reportId: 7, reportResume: true, reportPrompt: 'p' }
  const cleared = withoutReport(q, 'r')
  expect(cleared.report).toBeUndefined()
  expect(cleared.reportResume).toBe(false)
  expect(cleared.reportPrompt).toBe(DEFAULT_RESUME)
  const merged = withoutReport({ ...q, report: 'r\nnewer', reportId: 8 }, 'r')
  expect(merged.report).toBe('newer')
  expect(merged.reportId).toBe(8)
  expect(withoutReport(q, 'other')).toBe(q)
})

function io(read: Read<Queue>, over: Partial<QueueIO> = {}) {
  const log: { written?: Queue; quarantined: number } = { quarantined: 0 }
  const port: QueueIO = {
    readQueue: async () => read,
    writeQueue: async q => {
      log.written = q
    },
    quarantine: async () => {
      log.quarantined++
      return '/s/pending.json.bad-1'
    },
    queuePath: '/s/pending.json',
    ...over,
  }
  return { port, log }
}

test('contextEdit quarantines an unreadable queue and continues with an empty one', async () => {
  const { port, log } = io({ state: 'unreadable', reason: 'bad field(s): resume' })
  const out = await contextEdit(port, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('result' in out && out.result).toContain('moved to /s/pending.json.bad-1')
  expect(log.quarantined).toBe(1)
  expect(log.written!.edits.length).toBe(1)
})

test('contextEdit refuses when the queue can neither be read nor moved, or cannot be written', async () => {
  const stuck = io({ state: 'unreadable', reason: 'x' }, { quarantine: async () => undefined })
  const a = await contextEdit(stuck.port, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in a && a.deny).toContain('/s/pending.json')
  const failing = io({ state: 'missing', value: { ...EMPTY_QUEUE } }, { writeQueue: async () => { throw new Error('disk full') } })
  const b = await contextEdit(failing.port, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in b && b.deny).toContain('disk full')
})

test('deliverReport removes the report only once the prompt entered', async () => {
  const read = async (): Promise<Read<Queue>> => ({ state: 'ok', value: { ...EMPTY_QUEUE, report: 'R', reportId: 3 } })
  const settled: string[] = []
  const seen: (string | undefined)[] = []
  await deliverReport(read, async r => (seen.push(r), {}), async d => void settled.push(d))
  expect(seen).toEqual(['R'])
  expect(settled).toEqual(['R'])
  const dropped: string[] = []
  const out = await deliverReport(read, async () => ({ drop: 'refused' }), async d => void dropped.push(d))
  expect(out.drop).toBe('refused')
  expect(dropped).toEqual([])
  const none: (string | undefined)[] = []
  await deliverReport(async () => ({ state: 'missing', value: { ...EMPTY_QUEUE } }), async r => (none.push(r), {}), async () => undefined)
  expect(none).toEqual([undefined])
})
