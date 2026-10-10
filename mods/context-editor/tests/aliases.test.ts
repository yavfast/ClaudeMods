import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  addAlias,
  aliasesById,
  aliasLine,
  callFacts,
  EMPTY_ALIASES,
  markCall,
  MAX_ALIASES,
  parseAliases,
  pruneAliases,
  refResolver,
  resolveRef,
  withContext,
  type AliasIO,
  type AliasRegistry,
  type CallFacts,
} from '../hooks/aliases'
import { handleCompaction, type CompactionIO } from '../hooks/compaction'
import { listRows, prepare } from '../hooks/edits'
import { EMPTY_QUEUE, queueEdits, type Queue, type Read } from '../hooks/queue'
import { contextTag, EMPTY_REGISTRY, type TagIO, type TagRegistry } from '../hooks/tags'

const BIG = 'x'.repeat(5000)

function use(id: string, tool: string): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: {} }], handle: `u-${id}` }
}
function result(id: string, text: string): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }], handle: `r-${id}` }
}

function rows(): SessionMessage[] {
  return [{ role: 'user', text: 'the task', toolUses: [], handle: 'h0' }, use('a', 'Read'), result('a', BIG), use('b', 'Grep'), result('b', 'match list')]
}

function aliases(map: Record<string, string>, extra: Partial<AliasRegistry> = {}): AliasRegistry {
  const next = Math.max(0, ...Object.keys(map).map(k => Number(k.slice(1)))) + 1
  return { next, map, ...extra }
}

const ok = (reg: AliasRegistry): Read<AliasRegistry> => ({ state: 'ok', value: reg })
const empty = (): Read<AliasRegistry> => ({ state: 'missing', value: { ...EMPTY_ALIASES, map: {} } })

function facts(over: Partial<CallFacts> = {}): CallFacts {
  return { denied: false, tool: 'Read', tool_use_id: 'a', size: 5000, ...over }
}

function aliasHarness(read: Read<AliasRegistry>, over: Partial<AliasIO> = {}) {
  const log: { written?: AliasRegistry; writes: number } = { writes: 0 }
  const io: AliasIO = {
    ready: async () => true,
    readAliases: async () => (log.written ? { state: 'ok', value: log.written } : read),
    writeAliases: async reg => {
      log.written = reg
      log.writes++
    },
    ...over,
  }
  return { io, log }
}

// ---- [SP_CTX_01_13] registry read states

test('parseAliases reads a good file and makes any bad field or entry unreadable', async () => {
  const good = parseAliases(JSON.stringify(aliases({ c1: 'a', c2: 'b' }, { last: 'c2' })))
  expect(good.state).toBe('ok')
  expect(good.state === 'ok' && good.value.map.c2).toBe('b')
  expect(parseAliases(JSON.stringify({ next: 1, map: {} })).state).toBe('ok')
  const bad: unknown[] = [
    '{',
    [],
    { next: 0, map: {} },
    { next: 1.5, map: {} },
    { next: 3, map: [] },
    { next: 3, map: { x1: 'a' } },
    { next: 3, map: { c0: 'a' } },
    { next: 2, map: { c5: 'a' } },
    { next: 3, map: { c1: '' } },
    { next: 3, map: { c1: 7 } },
    { next: 3, map: { c1: 'a' }, last: 'c2' },
    { next: 3, map: { c1: 'a' }, last: 'constructor' },
    { next: MAX_ALIASES + 2, map: Object.fromEntries(Array.from({ length: MAX_ALIASES + 1 }, (_, i) => [`c${i + 1}`, `t${i}`])) },
  ]
  for (const raw of bad) expect(parseAliases(typeof raw === 'string' ? raw : JSON.stringify(raw)).state).toBe('unreadable')
})

// ---- [SP_CTX_02_16] MarkCall

test('MarkCall gives a big output the first alias and makes it last', async () => {
  const { io, log } = aliasHarness(empty())
  const line = await markCall(io, facts({ tool: 'Read', tool_use_id: 'a', size: 5000 }))
  expect(line).toBe(aliasLine('c1'))
  expect(line).toContain('[context-editor] id c1')
  expect(log.written).toEqual({ next: 2, last: 'c1', map: { c1: 'a' } })
  const second = await markCall(io, facts({ tool: 'Grep', tool_use_id: 'b', size: 10 }))
  expect(second).toContain('id c2')
  expect(log.written!.last).toBe('c2')
})

test('MarkCall leaves small outputs, own tools, subagents, denied calls and calls without id unmarked', async () => {
  const cases: Partial<CallFacts>[] = [
    { tool: 'Read', size: 100 },
    { tool: 'mcp__context-editor__context_list', size: 9000 },
    { agentId: 'ag1' },
    { denied: true },
    { tool_use_id: undefined },
  ]
  for (const over of cases) {
    const { io, log } = aliasHarness(empty())
    expect(await markCall(io, facts(over))).toBeUndefined()
    expect(log.writes).toBe(0)
  }
  // a search tool is marked whatever its size
  const { io } = aliasHarness(empty())
  expect(await markCall(io, facts({ tool: 'Glob', size: 3 }))).toContain('id c1')
})

test('MarkCall from an unreadable registry, without storage or with a failed write adds nothing and keeps the result', async () => {
  const done = { result: { content: BIG }, text: BIG }
  const unread = aliasHarness({ state: 'unreadable', reason: 'bad alias "x1"' })
  const none = await markCall(unread.io, facts())
  expect(none).toBeUndefined()
  expect(unread.log.writes).toBe(0)
  expect(withContext(done, none ? [none] : [])).toBe(done)
  const down = aliasHarness(empty(), { ready: async () => false })
  expect(await markCall(down.io, facts())).toBeUndefined()
  const failing = aliasHarness(empty(), {
    writeAliases: async () => {
      throw new Error('disk full')
    },
  })
  expect(await markCall(failing.io, facts())).toBeUndefined()
})

test('the alias line comes before the reminder in what the model reads after the result', async () => {
  const done = { result: 'r', text: 'r', context: ['core'] as readonly string[] }
  const out = withContext(done, [aliasLine('c3'), 'reminder'])
  expect(out.context).toEqual(['core', aliasLine('c3'), 'reminder'])
  expect(out.result).toBe('r')
})

test('callFacts measures core text, or the serialized result of a hook answer', async () => {
  const e = { tool: 'Read', tool_use_id: 'a' }
  expect(callFacts(e, { result: { file: 1 }, text: BIG }).size).toBe(5000)
  expect(callFacts(e, { result: { content: 'abc' } }).size).toBe(JSON.stringify({ content: 'abc' }).length)
  expect(callFacts(e, {}).size).toBe(0)
  expect(callFacts(e, { deny: 'no' }).denied).toBe(true)
  expect(callFacts({ tool: 'Read', tool_use_id: '' }, { text: 'x' }).tool_use_id).toBeUndefined()
})

// ---- [SP_CTX_01_13] the limit

test('past MAX_ALIASES marks the oldest alias goes', async () => {
  let reg: AliasRegistry = { ...EMPTY_ALIASES, map: {} }
  for (let i = 0; i <= MAX_ALIASES; i++) reg = addAlias(reg, `t${i}`).registry
  expect(Object.keys(reg.map).length).toBe(MAX_ALIASES)
  expect(reg.map.c1).toBeUndefined()
  expect(reg.map.c2).toBe('t1')
  expect(reg.last).toBe(`c${MAX_ALIASES + 1}`)
  expect(reg.next).toBe(MAX_ALIASES + 2)
  expect(parseAliases(JSON.stringify(reg)).state).toBe('ok')
})

// ---- [SP_CTX_02_17] ResolveRef

test('ResolveRef: last, an alias, an unknown alias, an unreadable registry', async () => {
  const read = ok(aliases({ c1: 'a', c2: 'b' }, { last: 'c2' }))
  expect(resolveRef(read, 'last')).toBe('b')
  expect(resolveRef(read, 'c1')).toBe('a')
  expect(resolveRef(read, 'c99')).toBeUndefined()
  expect(resolveRef(read, 'constructor')).toBeUndefined()
  expect(resolveRef(read, 'a')).toBeUndefined()
  expect(resolveRef(empty(), 'last')).toBeUndefined()
  expect(resolveRef({ state: 'unreadable', reason: 'x' }, 'c1')).toBeUndefined()
})

test('context_edit resolves ref before queueing; unknown and doubled refs are rejected', async () => {
  const resolve = refResolver(ok(aliases({ c1: 'a', c2: 'b' }, { last: 'c2' })))
  const out = queueEdits(
    EMPTY_QUEUE,
    rows(),
    {
      edits: [
        { op: 'summarize', ref: 'c1', summary: 'file A' },
        { op: 'drop', ref: 'last' },
        { op: 'drop', ref: 'c99' },
        { op: 'drop', ref: 'c1', tool_use_id: 'a' },
      ],
    },
    undefined,
    resolve,
  )
  if ('deny' in out) throw new Error(out.deny)
  expect(out.queue.edits).toEqual([
    { op: 'summarize', tool_use_id: 'a', summary: 'file A' },
    { op: 'drop', tool_use_id: 'b' },
  ])
  expect(out.errors.length).toBe(2)
  expect(out.errors[0]).toContain('unknown ref c99')
  expect(out.errors[1]).toContain('ref and tool_use_id are exclusive')
  // an unreadable registry resolves nothing: the ref is unknown, never a guess
  const unread = queueEdits(EMPTY_QUEUE, rows(), { edits: [{ op: 'drop', ref: 'last' }] }, undefined, refResolver({ state: 'unreadable', reason: 'x' }))
  if ('deny' in unread) throw new Error(unread.deny)
  expect(unread.queued).toBe(0)
  expect(unread.errors[0]).toContain('unknown ref last')
})

// ---- [SP_CTX_02_11] context_tag with ref

function tagHarness(start: TagRegistry = { ...EMPTY_REGISTRY }) {
  const log: { tags?: TagRegistry } = {}
  const io: TagIO = {
    rows: async () => rows(),
    readTags: async () => ({ state: 'ok', value: log.tags ?? start }),
    writeTags: async r => {
      log.tags = r
    },
    readQueue: async () => ({ state: 'missing', value: { ...EMPTY_QUEUE } }),
    writeQueue: async () => undefined,
  }
  return { io, log }
}

test('context_tag with ref "last" tags the pair of the call marked last', async () => {
  const { io, log } = tagHarness()
  const resolve = refResolver(ok(aliases({ c1: 'a', c2: 'b' }, { last: 'c1' })))
  const out = await contextTag(io, { tags: [{ op: 'add', kind: 'disposable', ref: 'last', note: 'file A: KEY = 1' }] }, undefined, resolve)
  if ('deny' in out) throw new Error(out.deny)
  expect(out.result).toContain('Tagged 1')
  expect(log.tags!.tags).toEqual([{ kind: 'disposable', target: { tool_use_id: 'a' }, note: 'file A: KEY = 1', created_turn: 0 }])
  const removed = await contextTag(io, { tags: [{ op: 'remove', ref: 'c1' }] }, undefined, resolve)
  expect('result' in removed && removed.result).toContain('removed 1')
})

test('context_tag rejects an unknown ref and a ref beside another target', async () => {
  const resolve = refResolver(ok(aliases({ c1: 'a', c2: 'gone' })))
  const cases: [unknown, string][] = [
    [{ op: 'add', kind: 'pin', ref: 'c99' }, 'UNKNOWN_REF'],
    [{ op: 'add', kind: 'pin', ref: 'last' }, 'UNKNOWN_REF'],
    [{ op: 'add', kind: 'pin', ref: 'c1', tool_use_id: 'a' }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin', ref: 'c1', index: 0 }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin', ref: '' }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin', ref: 3 }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin', ref: 'c2' }, 'TARGET_NOT_FOUND'],
  ]
  for (const [request, code] of cases) {
    const { io } = tagHarness()
    const out = await contextTag(io, { tags: [request] }, undefined, resolve)
    if ('deny' in out) throw new Error(out.deny)
    expect(out.result).toContain(`(${code})`)
  }
})

// ---- [SP_CTX_02_01] aliases in the listing

test('the listing shows the alias after the tool_use id', async () => {
  const text = listRows(rows(), 0, 10, new Map(), new Map(), aliasesById(aliases({ c7: 'a' })))
  expect(text).toContain('tool_use Read~ id=a (c7) input=')
  expect(text).toContain('tool_use Grep~ id=b input=')
})

// ---- [SP_CTX_02_14] aliases after an apply

test('pruneAliases drops aliases of edited and vanished pairs, clears a gone last, keeps the rest', async () => {
  const before = rows()
  const reg = aliases({ c1: 'a', c2: 'b', c3: 'old' }, { last: 'c1' })
  const done = prepare(before, [{ op: 'drop', tool_use_id: 'a' }]).queued
  const after = before.filter((_, i) => i !== 1 && i !== 2)
  const out = pruneAliases(reg, before, after, done)
  expect(out.map).toEqual({ c2: 'b' })
  expect(out.last).toBeUndefined()
  expect(out.next).toBe(4)
  // a summarize keeps the pair in the rows under a fresh id: its alias goes too
  const summarized = pruneAliases(reg, before, before, prepare(before, [{ op: 'summarize', tool_use_id: 'b', summary: 's' }]).queued)
  expect(summarized.map).toEqual({ c1: 'a' })
  expect(summarized.last).toBe('c1')
  const kept = aliases({ c1: 'a', c2: 'b' })
  expect(pruneAliases(kept, before, before, [])).toBe(kept)
})

test('after an apply the tag and alias of the changed pair go; those of the untouched pair stay', async () => {
  const conv = rows()
  const tags: TagRegistry = {
    ...EMPTY_REGISTRY,
    tags: [
      { kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 },
      { kind: 'review', target: { tool_use_id: 'b' }, created_turn: 0 },
    ],
  }
  const written: { tags?: TagRegistry; aliases?: AliasRegistry; queue?: Queue } = {}
  const start = aliases({ c1: 'a', c2: 'b' }, { last: 'c2' })
  const io: CompactionIO = {
    dir: '/s',
    now: () => 1000,
    readQueue: async () => ({ state: 'ok', value: { ...EMPTY_QUEUE, edits: prepare(conv, [{ op: 'summarize', tool_use_id: 'a', summary: 'file A' }]).queued } }),
    writeQueue: async q => {
      written.queue = q
    },
    readApi: async () => [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: BIG }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'match list' }] },
    ],
    writeMedia: async () => true,
    writeArchive: async () => true,
    isAborted: () => false,
    toast: () => undefined,
    readTags: async () => ({ state: 'ok', value: tags }),
    updateTags: async change => {
      written.tags = change(tags)
    },
    updateAliases: async change => {
      written.aliases = change(start)
    },
    writeBoundary: async () => undefined,
    hostId: () => undefined,
  }
  const out = await handleCompaction(io, conv)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.tags!.tags.map(t => ('tool_use_id' in t.target ? t.target.tool_use_id : '?'))).toEqual(['b'])
  expect(written.aliases!.map).toEqual({ c2: 'b' })
  expect(written.aliases!.last).toBe('c2')
})

test('a failed alias update does not undo the apply', async () => {
  const conv = rows()
  const io: CompactionIO = {
    dir: '/s',
    now: () => 1000,
    readQueue: async () => ({ state: 'ok', value: { ...EMPTY_QUEUE, edits: prepare(conv, [{ op: 'drop', tool_use_id: 'b' }]).queued } }),
    writeQueue: async () => undefined,
    readApi: async () => [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: BIG }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'match list' }] },
    ],
    writeMedia: async () => true,
    writeArchive: async () => true,
    isAborted: () => false,
    toast: () => undefined,
    readTags: async () => ({ state: 'missing', value: { ...EMPTY_REGISTRY } }),
    updateTags: async () => undefined,
    updateAliases: async () => {
      throw new Error('disk full')
    },
    writeBoundary: async () => undefined,
    hostId: () => undefined,
  }
  const out = await handleCompaction(io, conv)
  expect('messages' in out).toBe(true)
})
