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
  LAST_NONE,
  lastLine,
  lastOrphan,
  lastPending,
  pruneAliases,
  refResolver,
  resolveLast,
  withContext,
  type AliasIO,
  type AliasRegistry,
  type CallFacts,
} from '../hooks/aliases'
import { handleCompaction } from '../hooks/compaction'
import { boundaryOf, callLabel, listRows, prepare } from '../hooks/edits'
import { harness } from './compaction-fixtures'
import { EMPTY_QUEUE, queueEdits, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import { contextTag, EMPTY_REGISTRY, type TagIO, type TagRegistry } from '../hooks/tags'
import { missingRead, okRead, unreadableRead } from './row-fixtures'

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

const empty = (): Read<AliasRegistry> => missingRead({ ...EMPTY_ALIASES, map: {} })

function facts(over: Partial<CallFacts> = {}): CallFacts {
  return { denied: false, tool: 'Read', tool_use_id: 'a', size: 5000, ...over }
}

function aliasHarness(read: Read<AliasRegistry>, over: Partial<AliasIO> = {}) {
  const log: { written?: AliasRegistry; writes: number } = { writes: 0 }
  const io: AliasIO = {
    ready: async () => true,
    readAliases: async () => (log.written ? okRead(log.written) : read),
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
  const good = parseAliases(JSON.stringify(aliases({ c1: 'a', c2: 'b' })))
  expect(good.state).toBe('ok')
  expect(good.state === 'ok' && good.value.map.c2).toBe('b')
  // [SP_CTX_01_13] a file from before phase 21 with `last` (even a stale one) reads; the field goes
  for (const last of ['c2', 'c9', 'constructor', 7]) {
    const old = parseAliases(JSON.stringify({ next: 3, map: { c1: 'a', c2: 'b' }, last }))
    expect(old.state === 'ok' && old.value).toEqual({ next: 3, map: { c1: 'a', c2: 'b' } })
  }
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
    { next: MAX_ALIASES + 2, map: Object.fromEntries(Array.from({ length: MAX_ALIASES + 1 }, (_, i) => [`c${i + 1}`, `t${i}`])) },
  ]
  for (const raw of bad) expect(parseAliases(typeof raw === 'string' ? raw : JSON.stringify(raw)).state).toBe('unreadable')
})

// ---- [SP_CTX_02_16] MarkCall

test('MarkCall gives a big output the first alias; the registry has no last', async () => {
  const { io, log } = aliasHarness(empty())
  const line = await markCall(io, facts({ tool: 'Read', tool_use_id: 'a', size: 5000 }))
  expect(line).toBe(aliasLine('c1'))
  expect(line).toContain('[context-editor] id c1')
  expect(log.written).toEqual({ next: 2, map: { c1: 'a' } })
  const second = await markCall(io, facts({ tool: 'Grep', tool_use_id: 'b', size: 10 }))
  expect(second).toContain('id c2')
  expect(log.written).toEqual({ next: 3, map: { c1: 'a', c2: 'b' } })
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
  const unread = aliasHarness(unreadableRead('bad alias "x1"'))
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
  expect(reg.next).toBe(MAX_ALIASES + 2)
  expect(parseAliases(JSON.stringify(reg)).state).toBe('ok')
})

// ---- [SP_CTX_02_17] ResolveRef

test('ResolveRef: last by the rows, an alias, an unknown alias, an unreadable registry', async () => {
  const resolve = refResolver(okRead(aliases({ c1: 'a', c2: 'b' })))
  const conv = rows()
  expect(resolve('last', conv)).toEqual({ id: 'b', line: lastLine('Grep id=b (c2) input="{}"') })
  expect(resolve('c1', conv)).toEqual({ id: 'a' })
  for (const ref of ['c99', 'constructor', 'a']) expect(resolve(ref, conv)).toEqual({ error: `unknown ref ${ref} (marked calls carry a "[context-editor] id cN" line after their result)` })
  // [SP_CTX_01_13] an unreadable registry resolves no alias, but "last" still resolves on the rows
  const unread = refResolver(unreadableRead('x'))
  expect('error' in unread('c1', conv)).toBe(true)
  expect(unread('last', conv)).toEqual({ id: 'b', line: lastLine('Grep id=b input="{}"') })
  expect(refResolver(empty())('last', [])).toEqual({ error: LAST_NONE })
})

// ---- [SP_CTX_02_17] ResolveLast

function call(id: string, tool: string, input: Record<string, unknown> = {}): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input }], handle: `u-${id}` }
}
const prompt = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [], handle: `p-${text}` })
const own = (name: string) => `mcp__context-editor__${name}`

test('ResolveLast — малий виклик після позначеного (s5 фази 20): summarize ref last goes to cat c.log, and the result names it', async () => {
  const conv = [
    prompt('read big.log'),
    call('big', 'Bash', { command: 'sleep 14; cat big.log' }),
    result('big', 'x'.repeat(16000)),
    prompt('now c.log'),
    call('small', 'Bash', { command: 'cat c.log' }),
    result('small', 'c'.repeat(2500)),
    call('ce', own('context_edit')),
  ]
  const out = queueEdits(EMPTY_QUEUE, conv, { edits: [{ op: 'summarize', ref: 'last', summary: 'c.log: 60 ok lines' }] }, undefined, refResolver(okRead(aliases({ c1: 'big' })), 'ce'))
  if ('deny' in out) throw new Error(out.deny)
  expect(out.queue.edits).toEqual([{ op: 'summarize', tool_use_id: 'small', summary: 'c.log: 60 ok lines' }])
  expect(out.refLines).toEqual([lastLine('Bash id=small input="{"command":"cat c.log"}"')])
  expect(JSON.stringify(out.queue)).not.toContain('big')
})

test('ResolveLast — власні виклики не рахуються: a note by last, then an edit by last, both on Read a', async () => {
  const conv = [prompt('go'), call('a', 'Read', { file_path: '/p/a' }), result('a', 'A'), call('n1', own('context_note')), result('n1', 'Added n1'), call('ce', own('context_edit'))]
  expect(resolveLast(conv.slice(0, 4), 'n1')).toMatchObject({ id: 'a' })
  expect(resolveLast(conv, 'ce')).toMatchObject({ id: 'a' })
})

test('ResolveLast — паралельні виклики: the one written last, not the one that finished last', async () => {
  const conv = [prompt('go'), call('a', 'Read'), call('b', 'Read'), result('b', 'B'), result('a', 'A'), call('t', own('context_tag'))]
  expect(resolveLast(conv, 't')).toMatchObject({ id: 'b' })
  // the interleaved form of one response, "call a, result a, call b, result b": b as well
  expect(resolveLast([prompt('go'), call('a', 'Read'), result('a', 'A'), call('b', 'Read'), result('b', 'B'), call('t', own('context_tag'))], 't')).toMatchObject({ id: 'b' })
})

test('ResolveLast — виклик тієї самої відповіді без результату: LAST_PENDING, never the older call; the other edits of the call still go', async () => {
  const conv = [prompt('go'), call('a', 'Read'), result('a', 'A'), call('x', 'Bash', { command: 'make' }), call('ce', own('context_edit'))]
  const pending = { error: lastPending('Bash id=x input="{"command":"make"}"') }
  expect(resolveLast(conv, 'ce')).toEqual(pending)
  const out = queueEdits(EMPTY_QUEUE, conv, { edits: [{ op: 'drop', ref: 'last' }, { op: 'summarize', tool_use_id: 'a', summary: 's' }] }, undefined, refResolver(empty(), 'ce'))
  if ('deny' in out) throw new Error(out.deny)
  expect(out.queue.edits).toEqual([{ op: 'summarize', tool_use_id: 'a', summary: 's' }])
  expect(out.errors).toEqual([`edit 1: ${pending.error}`])
  expect(out.refLines).toEqual([])
})

test('ResolveLast — осиротілий виклик: a call of an earlier turn without a result (killed mid-tool, then --resume) is refused by its own text, not LAST_PENDING', async () => {
  const conv = [prompt('go'), call('a', 'Read'), result('a', 'A'), call('x', 'Bash', { command: 'sleep 99' }), prompt('continue'), call('ce', own('context_edit'))]
  expect(resolveLast(conv, 'ce')).toEqual({ error: lastOrphan('Bash id=x input="{"command":"sleep 99"}"') })
  // the same without the carrier row
  expect(resolveLast(conv.slice(0, 5), undefined)).toEqual({ error: lastOrphan('Bash id=x input="{"command":"sleep 99"}"') })
  expect(lastOrphan('L')).not.toContain('once its result is in')
})

test('ResolveLast — виклик тієї самої відповіді з результатом: Bash x already answered before this call is the target', async () => {
  const conv = [prompt('go'), call('a', 'Read'), result('a', 'A'), call('x', 'Bash'), result('x', 'X'), call('n', own('context_note'))]
  expect(resolveLast(conv, 'n')).toMatchObject({ id: 'x' })
})

test('ResolveLast — виклики після свого: calls written after this one are not considered', async () => {
  const conv = [prompt('go'), call('a', 'Read'), result('a', 'A'), call('t', own('context_tag')), call('z', 'Read'), result('z', 'Z')]
  expect(resolveLast(conv, 't')).toMatchObject({ id: 'a' })
  // one row holding several calls: only those before this one count
  const row: SessionMessage = { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x', tool: 'Bash', input: {} }, { tool_use_id: 't', tool: own('context_tag'), input: {} }, { tool_use_id: 'z', tool: 'Read', input: {} }] }
  expect(resolveLast([prompt('go'), row, result('x', 'X'), result('z', 'Z')], 't')).toMatchObject({ id: 'x' })
})

test('ResolveLast — немає виклику: only a prompt and the mod\'s own calls give LAST_NONE', async () => {
  expect(resolveLast([prompt('go'), call('l', own('context_list')), result('l', 'rows'), call('ce', own('context_edit'))], 'ce')).toEqual({ error: LAST_NONE })
  expect(resolveLast([], undefined)).toEqual({ error: LAST_NONE })
})

test('ResolveLast — без callId чи рядка-носія: the latest call of the conversation; without a result, LAST_PENDING', async () => {
  const done = [prompt('go'), call('y', 'Grep'), result('y', 'm')]
  expect(resolveLast(done)).toMatchObject({ id: 'y' })
  expect(resolveLast(done, 'not-written-yet')).toMatchObject({ id: 'y' })
  expect('error' in resolveLast([prompt('go'), call('y', 'Grep')], 'gone')).toBe(true)
})

test('CallLabel: the call as the listing shows it, with the alias and the input cut to 70 chars', async () => {
  expect(callLabel({ tool: 'Read', tool_use_id: 't0', input: {} }, 'c2', '~')).toBe('Read~ id=t0 (c2) input="{}"')
  expect(callLabel({ tool: 'Bash', tool_use_id: 't1', input: { command: 'ls' } }, 'c4')).toBe('Bash id=t1 (c4) input="{"command":"ls"}"')
  const long = callLabel({ tool: 'Read', tool_use_id: 't2', input: { file_path: '/p/'.padEnd(200, 'x') } })
  expect(long.endsWith('…"')).toBe(true)
  expect(long.length).toBe('Read id=t2 input=""'.length + 71)
})

test('context_edit resolves ref before queueing; unknown and doubled refs are rejected', async () => {
  const resolve = refResolver(okRead(aliases({ c1: 'a', c2: 'b' })))
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
  expect(out.refLines).toEqual([lastLine('Grep id=b (c2) input="{}"')])
  // an unreadable registry resolves no alias: the ref is unknown, never a guess
  const unread = queueEdits(EMPTY_QUEUE, rows(), { edits: [{ op: 'drop', ref: 'c1' }] }, undefined, refResolver(unreadableRead('x')))
  if ('deny' in unread) throw new Error(unread.deny)
  expect(unread.queued).toBe(0)
  expect(unread.errors[0]).toContain('unknown ref c1')
})

// ---- [SP_CTX_02_11] context_tag with ref

function tagHarness(start: TagRegistry = { ...EMPTY_REGISTRY }) {
  const log: { tags?: TagRegistry } = {}
  const io: TagIO = {
    rows: async () => rows(),
    readTags: async () => okRead(log.tags ?? start),
    writeTags: async r => {
      log.tags = r
    },
    readQueue: async () => missingRead({ ...EMPTY_QUEUE }),
    writeQueue: async () => undefined,
  }
  return { io, log }
}

test('context_tag with ref "last" tags the pair of the latest call, marked or not, and names it', async () => {
  const { io, log } = tagHarness()
  // only a is marked: "last" is still b, the latest call
  const resolve = refResolver(okRead(aliases({ c1: 'a' })))
  const out = await contextTag(io, { tags: [{ op: 'add', kind: 'disposable', ref: 'last', note: 'matches: 3' }] }, undefined, resolve)
  if ('deny' in out) throw new Error(out.deny)
  expect(out.result).toContain('Tagged 1')
  expect(out.result).toContain(lastLine('Grep id=b input="{}"'))
  expect(log.tags!.tags).toEqual([{ kind: 'disposable', target: { tool_use_id: 'b' }, note: 'matches: 3', created_turn: 0 }])
  const removed = await contextTag(io, { tags: [{ op: 'remove', ref: 'last' }] }, undefined, resolve)
  expect('result' in removed && removed.result).toContain('removed 1')
  // by its alias the marked pair a is named, not the latest call
  const byAlias = await contextTag(io, { tags: [{ op: 'add', kind: 'pin', ref: 'c1' }] }, undefined, resolve)
  expect('result' in byAlias && byAlias.result).not.toContain('"last" =')
  expect(log.tags!.tags).toEqual([{ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 }])
})

test('context_tag rejects an unknown ref and a ref beside another target', async () => {
  const resolve = refResolver(okRead(aliases({ c1: 'a', c2: 'gone' })))
  const cases: [unknown, string][] = [
    [{ op: 'add', kind: 'pin', ref: 'c99' }, 'UNKNOWN_REF'],
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

test('pruneAliases drops aliases of edited and vanished pairs, keeps the rest', async () => {
  const before = rows()
  const reg = aliases({ c1: 'a', c2: 'b', c3: 'old' })
  const done = prepare(before, [{ op: 'drop', tool_use_id: 'a' }]).queued
  const after = before.filter((_, i) => i !== 1 && i !== 2)
  const out = pruneAliases(reg, before, after, done)
  expect(out.map).toEqual({ c2: 'b' })
  expect(out.next).toBe(4)
  // a summarize keeps the pair in the rows under a fresh id: its alias goes too
  const summarized = pruneAliases(reg, before, before, prepare(before, [{ op: 'summarize', tool_use_id: 'b', summary: 's' }]).queued)
  expect(summarized.map).toEqual({ c1: 'a' })
  const kept = aliases({ c1: 'a', c2: 'b' })
  expect(pruneAliases(kept, before, before, [])).toBe(kept)
})

// [SP_CTX_02_07] The API form of rows(): no media.
const API = [
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: BIG }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'match list' }] },
]

function queuedOn(conv: SessionMessage[], edits: unknown[]): Read<Queue> {
  return okRead({ ...EMPTY_QUEUE, edits: prepare(conv, edits).queued })
}

test('after an apply the tag and alias of the changed pair go; those of the untouched pair stay', async () => {
  const conv = rows()
  const tags: TagRegistry = {
    ...EMPTY_REGISTRY,
    tags: [
      { kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 },
      { kind: 'review', target: { tool_use_id: 'b' }, created_turn: 0 },
    ],
  }
  const { io, written } = harness(
    queuedOn(conv, [{ op: 'summarize', tool_use_id: 'a', summary: 'file A' }]),
    { readApi: async () => API },
    okRead(tags),
    okRead(aliases({ c1: 'a', c2: 'b' })),
  )
  const out = await handleCompaction(io, conv)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.tags!.tags.map(t => ('tool_use_id' in t.target ? t.target.tool_use_id : '?'))).toEqual(['b'])
  expect(written.aliases!.map).toEqual({ c2: 'b' })
})

// [SP_CTX_02_07] [SP_CTX_02_14] TST-9
test('a failed alias update does not undo the apply: the batch is cleared, its report written, the boundary recorded', async () => {
  const conv = rows()
  const { io, written } = harness(
    queuedOn(conv, [{ op: 'drop', tool_use_id: 'b' }]),
    {
      readApi: async () => API,
      writeAliases: async () => {
        throw new Error('disk full')
      },
    },
    undefined,
    okRead(aliases({ c1: 'a', c2: 'b' })),
  )
  const out = await handleCompaction(io, conv)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.edits).toEqual([])
  expect(written.queue!.reportId).toBe(1000)
  expect(written.queue!.report).toContain('applied 1 edit(s): drop b')
  expect(written.reported).toBe(1000)
  expect(written.boundary).toEqual(boundaryOf(out.messages))
  expect(written.aliases).toBeUndefined()
})
