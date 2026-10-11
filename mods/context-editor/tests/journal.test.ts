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
import { MAX_QUEUE_EDITS } from '../hooks/edits'
import { MAX_QUEUE_BYTES } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { prompt, result, use, missingRead, okRead } from './row-fixtures'

const DIR = '/home/u/.claude/context-editor/s1'

function rows(): SessionMessage[] {
  return [
    prompt('task'),
    use('r', 'Read', undefined, { file_path: '/p/f' }),
    result('r', 'x'.repeat(5000)),
    use('g', 'Grep', undefined, { pattern: 'KEY', path: '/p' }),
    result('g', 'matches'),
    use('r2', 'Read', undefined, { file_path: '/p/g' }),
    result('r2', 'g text'),
  ]
}

const apply = (at: number, compressed: string[], archive = `${DIR}/${at}.json`): JournalEntry => ({ kind: 'apply', at, edits: 1, archive, compressed })

function harness(start: Read<Journal>) {
  const log: { writes: Journal[] } = { writes: [] }
  const io: JournalIO = {
    read: async () => (log.writes.length ? okRead(log.writes.at(-1)!) : start),
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
  const { io, log } = harness(missingRead({ entries: [] }))
  await journalApply(io, entry!)
  expect(log.writes[0]).toEqual({ entries: [entry!] })
})

test('Journal — межа: MAX_JOURNAL entries and one more: the oldest goes', async () => {
  const full: Journal = { entries: Array.from({ length: MAX_JOURNAL }, (_, i) => apply(i, [])) }
  const { io, log } = harness(okRead(full))
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
  expect(bad).toMatchObject({ state: 'unreadable' })
  expect(bad.state === 'unreadable' && bad.reason).toContain('not JSON')
  expect(parseJournal(JSON.stringify({ entries: [{ kind: 'apply', at: 1, edits: 0, archive: '', compressed: [] }] }))).toEqual({ state: 'unreadable', reason: 'bad entry 1' })
  expect(parseJournal(JSON.stringify({ entries: [apply(1, ['/p/f']), { kind: 'changed', at: 2, path: '/p/f' }] })).state).toBe('ok')
  const { io, log } = harness(bad)
  await journalApply(io, apply(1, []))
  await journalReread(io, '/p/f', 't', DIR, 5)
  await journalChanged(io, '/p/f', 5)
  expect(log.writes.length).toBe(0)
  const sum = journalSummary(bad)
  expect('unreadable' in sum && sum.unreadable).toContain('not JSON')
})

test('Journal — нечитабельний: every bad shape names its field or entry; one bad entry makes the whole file unreadable', () => {
  const file = (entries: unknown) => parseJournal(JSON.stringify({ entries }))
  const unreadable = (reason: string) => ({ state: 'unreadable', reason })
  expect(parseJournal('[]')).toEqual(unreadable('not an object'))
  expect(parseJournal('null')).toEqual(unreadable('not an object'))
  expect(parseJournal('{}')).toEqual(unreadable('bad field(s): entries'))
  expect(file({})).toEqual(unreadable('bad field(s): entries'))
  // more than MAX_JOURNAL entries, even good ones
  expect(file(Array.from({ length: MAX_JOURNAL + 1 }, (_, i) => apply(i, [])))).toEqual(unreadable('bad field(s): entries'))
  expect(file(Array.from({ length: MAX_JOURNAL }, (_, i) => apply(i, []))).state).toBe('ok')
  // an unknown kind, or no kind
  expect(file([apply(1, []), { kind: 'freed', at: 2 }])).toEqual(unreadable('bad entry 2'))
  expect(file([{ at: 2, path: '/p/f' }])).toEqual(unreadable('bad entry 1'))
  // a reread entry with a bad archive, path or tool_use_id
  const reread = { kind: 'reread', at: 3, path: '/p/f', tool_use_id: 't', archive: false }
  expect(file([reread]).state).toBe('ok')
  expect(file([{ ...reread, archive: 'no' }])).toEqual(unreadable('bad entry 1'))
  expect(file([{ ...reread, path: 7 }])).toEqual(unreadable('bad entry 1'))
  expect(file([{ ...reread, tool_use_id: undefined }])).toEqual(unreadable('bad entry 1'))
  // a changed entry without its path
  expect(file([{ kind: 'changed', at: 2 }])).toEqual(unreadable('bad entry 1'))
  // a bad `at`: negative or not an integer
  expect(file([{ kind: 'changed', at: -1, path: '/p/f' }])).toEqual(unreadable('bad entry 1'))
  expect(file([{ kind: 'changed', at: 1.5, path: '/p/f' }])).toEqual(unreadable('bad entry 1'))
  // an apply entry with more than MAX_QUEUE_EDITS compressed paths, or a non-string one
  const many = Array.from({ length: MAX_QUEUE_EDITS }, (_, i) => `/p/${i}`)
  expect(file([apply(1, many)]).state).toBe('ok')
  expect(file([apply(1, [...many, '/p/x'])])).toEqual(unreadable('bad entry 1'))
  expect(file([{ ...apply(1, []), compressed: [1] }])).toEqual(unreadable('bad entry 1'))
  expect(file([{ ...apply(1, []), archive: null }])).toEqual(unreadable('bad entry 1'))
})

test('Journal — запис не вдався: a rejected write loses the entry only, the change never throws', async () => {
  const writes: Journal[] = []
  const stored: Journal = { entries: [apply(1, ['/p/f'])] }
  const io: JournalIO = {
    read: async () => okRead(stored),
    write: async j => {
      writes.push(j)
      throw new Error('disk full')
    },
  }
  await journalApply(io, apply(2, []))
  await journalReread(io, '/p/f', 't', DIR, 3)
  await journalChanged(io, '/p/f', 4)
  expect(writes.length).toBe(3)
  // each attempt is the stored journal plus its own entry; a lost entry is not carried into the next write
  expect(writes.map(j => j.entries.map(e => e.kind))).toEqual([['apply', 'apply'], ['apply', 'reread'], ['apply', 'changed']])
  expect(writes[0]!.entries[1]).toEqual(apply(2, []))
  expect(writes.every(j => j.entries[0] === stored.entries[0])).toBe(true)
  // the stored journal is left as it was
  expect(stored).toEqual({ entries: [apply(1, ['/p/f'])] })
})

test('Journal — межа: one entry larger than MAX_QUEUE_BYTES alone: the trimmed journal is empty', () => {
  const huge = apply(1, ['p'.repeat(MAX_QUEUE_BYTES)])
  expect(trimJournal({ entries: [huge] })).toEqual({ entries: [] })
  // a journal within both limits comes back as the same object
  const small: Journal = { entries: [apply(1, ['/p/f'])] }
  expect(trimJournal(small)).toBe(small)
})

// [SP_CTX_02_16] MarkCall's journal steps

test('MarkCall — повторне читання: apply with compressed [/p/f], then Read /p/f: reread { archive: false }; another path, or no journal: nothing', async () => {
  const j: Journal = { entries: [apply(1000, ['/p/f'])] }
  expect(withReread(j, '/p/f', 't9', DIR, 2000)!.entries.at(-1)).toEqual({ kind: 'reread', at: 2000, path: '/p/f', tool_use_id: 't9', archive: false })
  expect(withReread(j, '/p/other', 't9', DIR, 2000)).toBeUndefined()
  const { io, log } = harness(missingRead({ entries: [] }))
  await journalReread(io, '/p/f', 't9', DIR, 2000)
  expect(log.writes.length).toBe(0)
})

test('MarkCall — читання після власної зміни: apply [/p/f], Edit /p/f, Read /p/f: changed, no reread', async () => {
  const { io, log } = harness(okRead({ entries: [apply(1000, ['/p/f'])] }))
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
  expect(journalSummary(okRead(j))).toEqual({ applications: 2, rereads: 3, archiveRereads: 1 })
  expect(journalSummary(missingRead({ entries: [] }))).toEqual({ applications: 0, rereads: 0, archiveRereads: 0 })
})
