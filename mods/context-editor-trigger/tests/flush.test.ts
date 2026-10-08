import { expect, test } from 'claude-code/testing'
import { flush, isFresh, READY_FRESH_MS, RETRIES, type TriggerIO, type TriggerQueue } from '../hooks/flush'

function harness(queue: TriggerQueue | undefined, over: Partial<TriggerIO> = {}) {
  const log = { compacts: 0, submits: [] as string[], statuses: [] as (string | undefined)[], sleeps: 0 }
  const io: TriggerIO = {
    readQueue: async () => queue,
    editorReady: async () => true,
    compact: async () => {
      log.compacts++
    },
    sleep: async () => {
      log.sleeps++
    },
    submit: async text => void log.submits.push(text),
    status: text => void log.statuses.push(text),
    ...over,
  }
  return { io, log }
}

test('without a ready editor nothing is compacted and a warning shows', async () => {
  const { io, log } = harness({ edits: [1] }, { editorReady: async () => false })
  const out = await flush(io, { lastSubmittedReportId: 0 })
  expect(out.outcome).toBe('editor-not-ready')
  expect(log.compacts).toBe(0)
  expect(log.statuses[0]).toContain('not running')
})

test('a ready editor clears the warning and gets one compaction', async () => {
  const { io, log } = harness({ edits: [1] })
  const out = await flush(io, { lastSubmittedReportId: 0 })
  expect(out.outcome).toBe('compacted')
  expect(log.compacts).toBe(1)
  expect(log.statuses[0]).toBeUndefined()
})

test('a host that keeps refusing is retried RETRIES times', async () => {
  const { io, log } = harness({ edits: [1] }, { compact: async () => { throw new Error('turn running') } })
  const out = await flush(io, { lastSubmittedReportId: 0 })
  expect(out.outcome).toBe('host-refused')
  expect(log.sleeps).toBe(RETRIES)
})

test('the resume prompt goes once per report, and only after it was sent', async () => {
  const q = { edits: [], report: 'r', reportId: 7, reportResume: true, reportPrompt: 'go' }
  const state = { lastSubmittedReportId: 0 }
  const first = harness(q)
  await flush(first.io, state)
  await flush(first.io, state)
  expect(first.log.submits).toEqual(['go'])
  const failing = harness(q, { submit: async () => { throw new Error('refused') } })
  const fresh = { lastSubmittedReportId: 0 }
  await flush(failing.io, fresh)
  expect(fresh.lastSubmittedReportId).toBe(0)
  expect(failing.log.statuses.at(-1)).toContain('could not resume')
})

test('no resume prompt when the report does not ask for one', async () => {
  const { io, log } = harness({ edits: [], report: 'r', reportId: 7, reportResume: false })
  await flush(io, { lastSubmittedReportId: 0 })
  expect(log.submits).toEqual([])
})

test('the ready file is fresh within READY_FRESH_MS', async () => {
  expect(isFresh(1000, 1000 + READY_FRESH_MS)).toBe(true)
  expect(isFresh(1000, 1001 + READY_FRESH_MS)).toBe(false)
})
