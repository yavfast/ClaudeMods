import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { prepare } from '../hooks/edits'
import {
  applyEntry,
  journalApply,
  journalChanged,
  journalReread,
  journalSummary,
  MAX_JOURNAL,
  parseJournal,
  trimJournal,
  withChanged,
  withReread,
  type Journal,
  type JournalEntry,
  type JournalIO,
} from '../hooks/journal'
import type { Read } from '../hooks/queue'

const DIR = '/home/u/.claude/context-editor/s1'

function use(id: string, tool: string, input: Record<string, unknown>): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input }] }
}
function result(id: string, text: string): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }] }
}

function rows(): SessionMessage[] {
  return [
    { role: 'user', text: 'task', toolUses: [] },
    use('r', 'Read', { file_path: '/p/f' }),
    result('r', 'x'.repeat(5000)),
    use('g', 'Grep', { pattern: 'KEY', path: '/p' }),
    result('g', 'matches'),
    use('r2', 'Read', { file_path: '/p/g' }),
    result('r2', 'g text'),
  ]
}

const apply = (at: number, compressed: string[], archive = `${DIR}/${at}.json`): JournalEntry => ({ kind: 'apply', at, edits: 1, archive, compressed })

function harness(start: Read<Journal>) {
  const log: { writes: Journal[] } = { writes: [] }
  const io: JournalIO = {
    read: async () => (log.writes.length ? { state: 'ok', value: log.writes.at(-1)! } : start),
    write: async j => void log.writes.push(j),
  }
  return { io, log }
}

// [SP_CTX_02_31] JournalApply

test('Journal — застосування: summarize of a Read pair and drop of a Grep pair: one apply entry, edits 2, compressed [/p/f], no estimate of what was freed', async () => {
  const r = rows()
  const edits = prepare(r, [
    { op: 'summarize', tool_use_id: 'r', summary: 'f: KEY = 1' },
    { op: 'drop', tool_use_id: 'g' },
  ]).queued
  const entry = applyEntry(1000, { applied: ['summarize r', 'drop g'] }, `${DIR}/1000.json`, r, edits)
  expect(entry).toEqual({ kind: 'apply', at: 1000, edits: 2, archive: `${DIR}/1000.json`, compressed: ['/p/f'] })
  expect(Object.keys(entry!)).not.toContain('freedChars')
  // a collapse names every Read in its span; a failed edit counts nothing
  const collapse = prepare(r, [{ op: 'collapse', from_index: 1, to_index: 6, summary: 's' }]).queued
  expect((applyEntry(2, { applied: ['collapse #1..#6'] }, '', r, collapse) as { compressed: string[] }).compressed).toEqual(['/p/f', '/p/g'])
  expect(applyEntry(3, { applied: [] }, '', r, edits)).toBeUndefined()
  const { io, log } = harness({ state: 'missing', value: { entries: [] } })
  await journalApply(io, entry!)
  expect(log.writes[0]).toEqual({ entries: [entry!] })
})

test('Journal — межа: MAX_JOURNAL entries and one more: the oldest goes', async () => {
  const full: Journal = { entries: Array.from({ length: MAX_JOURNAL }, (_, i) => apply(i, [])) }
  const { io, log } = harness({ state: 'ok', value: full })
  await journalApply(io, apply(MAX_JOURNAL, ['/p/f']))
  const out = log.writes[0]!.entries
  expect(out.length).toBe(MAX_JOURNAL)
  expect(out[0]!.at).toBe(1)
  expect(out.at(-1)!.at).toBe(MAX_JOURNAL)
  // the byte limit trims too
  const huge: Journal = { entries: Array.from({ length: 3 }, (_, i) => apply(i, ['p'.repeat(1_200_000)])) }
  expect(trimJournal(huge).entries.length).toBe(2)
})

test('Journal — нечитабельний: a file that is no JSON is never overwritten; the telemetry names it', async () => {
  const bad = parseJournal('{')
  expect(bad.state).toBe('unreadable')
  expect(parseJournal(JSON.stringify({ entries: [{ kind: 'apply', at: 1, edits: 0, archive: '', compressed: [] }] })).state).toBe('unreadable')
  expect(parseJournal(JSON.stringify({ entries: [apply(1, ['/p/f']), { kind: 'changed', at: 2, path: '/p/f' }] })).state).toBe('ok')
  const { io, log } = harness(bad)
  await journalApply(io, apply(1, []))
  await journalReread(io, '/p/f', 't', DIR, 5)
  await journalChanged(io, '/p/f', 5)
  expect(log.writes.length).toBe(0)
  const sum = journalSummary(bad)
  expect('unreadable' in sum && sum.unreadable).toContain('not JSON')
})

// [SP_CTX_02_16] MarkCall's journal steps

test('MarkCall — повторне читання: apply with compressed [/p/f], then Read /p/f: reread { archive: false }; another path, or no journal: nothing', async () => {
  const j: Journal = { entries: [apply(1000, ['/p/f'])] }
  expect(withReread(j, '/p/f', 't9', DIR, 2000)!.entries.at(-1)).toEqual({ kind: 'reread', at: 2000, path: '/p/f', tool_use_id: 't9', archive: false })
  expect(withReread(j, '/p/other', 't9', DIR, 2000)).toBeUndefined()
  const { io, log } = harness({ state: 'missing', value: { entries: [] } })
  await journalReread(io, '/p/f', 't9', DIR, 2000)
  expect(log.writes.length).toBe(0)
})

test('MarkCall — читання після власної зміни: apply [/p/f], Edit /p/f, Read /p/f: changed, no reread', async () => {
  const { io, log } = harness({ state: 'ok', value: { entries: [apply(1000, ['/p/f'])] } })
  await journalChanged(io, '/p/f', 1500)
  expect(log.writes[0]!.entries.at(-1)).toEqual({ kind: 'changed', at: 1500, path: '/p/f' })
  await journalReread(io, '/p/f', 't', DIR, 2000)
  expect(log.writes.length).toBe(1)
  // a change of a path no application compressed is not journaled
  expect(withChanged({ entries: [apply(1, ['/p/f'])] }, '/p/g', 3)).toBeUndefined()
  // a later application of the changed path counts again
  const again: Journal = { entries: [apply(1, ['/p/f']), { kind: 'changed', at: 2, path: '/p/f' }, apply(3, ['/p/f'])] }
  expect(withReread(again, '/p/f', 't', DIR, 4)).toBeDefined()
})

test('MarkCall — читання архіву: Read of <storage>/<at>.json or <storage>/<at>/1.png of an apply entry: reread { archive: true }', async () => {
  const j: Journal = { entries: [apply(1000, [])] }
  expect(withReread(j, `${DIR}/1000.json`, 'a', DIR, 5)!.entries.at(-1)).toEqual({ kind: 'reread', at: 5, path: `${DIR}/1000.json`, tool_use_id: 'a', archive: true })
  expect(withReread(j, `${DIR}/1000/1.png`, 'b', DIR, 5)!.entries.at(-1)).toMatchObject({ archive: true })
  expect(withReread(j, `${DIR}/999.json`, 'c', DIR, 5)).toBeUndefined()
  // no archive was written: only the media folder could match, and nothing does
  expect(withReread({ entries: [apply(7, [], '')] }, `${DIR}/7.json`, 'd', DIR, 5)).toBeUndefined()
})

test('journalSummary: applications, rereads and archive rereads; a missing journal is all zeros', async () => {
  const j: Journal = {
    entries: [apply(1, ['/p/f']), apply(2, []), { kind: 'reread', at: 3, path: '/p/f', tool_use_id: 'a', archive: false }, { kind: 'reread', at: 4, path: `${DIR}/2.json`, tool_use_id: 'b', archive: true }, { kind: 'reread', at: 5, path: '/p/f', tool_use_id: 'c', archive: false }],
  }
  expect(journalSummary({ state: 'ok', value: j })).toEqual({ applications: 2, rereads: 3, archiveRereads: 1 })
  expect(journalSummary({ state: 'missing', value: { entries: [] } })).toEqual({ applications: 0, rereads: 0, archiveRereads: 0 })
})
