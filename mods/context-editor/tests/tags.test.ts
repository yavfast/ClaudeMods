import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { fingerprint, listRows, MAX_QUEUE_EDITS, prepare, type QueuedEdit } from '../hooks/edits'
import { EMPTY_QUEUE, MAX_QUEUE_BYTES, queueEdits, type Queue, type Read } from '../hooks/queue'
import {
  activeReviews,
  appendFacts,
  applyRules,
  autoTag,
  contextTag,
  countTurn,
  EMPTY_REGISTRY,
  isPluginRow,
  MAX_TAGS,
  parseRegistry,
  pinnedTargets,
  queueTagReplacements,
  rebindTags,
  SEARCH_TTL,
  tagLabels,
  type AppendFacts,
  type Tag,
  type TagIO,
  type TagRegistry,
} from '../hooks/tags'

const BIG = 'x'.repeat(5000)

function use(id: string, tool: string): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: {} }] }
}
function result(id: string, text: string): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }] }
}

function rows(): SessionMessage[] {
  return [
    { role: 'user', text: 'the task: find KEY_0042', toolUses: [] },
    use('a', 'Read'),
    result('a', BIG),
    { role: 'assistant', text: 'A long dead-end reasoning that turned out wrong.', toolUses: [] },
    use('b', 'Grep'),
    result('b', 'match list'),
    { role: 'assistant', text: 'Next step.', toolUses: [] },
  ]
}

function reg(tags: Tag[], extra: Partial<TagRegistry> = {}): TagRegistry {
  return { ...EMPTY_REGISTRY, ...extra, tags }
}

const anchorOf = (i: number) => ({ anchor: fingerprint(rows()[i]!), hint: i })

function harness(tags: Read<TagRegistry>, queue: Read<Queue> = { state: 'missing', value: { ...EMPTY_QUEUE } }, over: Partial<TagIO> = {}) {
  const log: { tags?: TagRegistry; queue?: Queue; tagWrites: number } = { tagWrites: 0 }
  const io: TagIO = {
    rows: async () => rows(),
    readTags: async () => (log.tags ? { state: 'ok', value: log.tags } : tags),
    writeTags: async r => {
      log.tags = r
      log.tagWrites++
    },
    readQueue: async () => (log.queue ? { state: 'ok', value: log.queue } : queue),
    writeQueue: async q => {
      log.queue = q
    },
    ...over,
  }
  return { io, log }
}

const empty = (): Read<TagRegistry> => ({ state: 'missing', value: { ...EMPTY_REGISTRY } })

// ---- [SP_CTX_01_10] registry read states

test('parseRegistry reads a good file and makes any bad field or tag unreadable', async () => {
  const good = reg([
    { kind: 'pin', target: { anchor: 'user||x', hint: 0 }, created_turn: 0 },
    { kind: 'disposable', target: { tool_use_id: 'a' }, note: 'n', created_turn: 2 },
    { kind: 'review', target: { tool_use_id: 'b' }, ttl_turns: 3, created_turn: 1 },
  ])
  expect(parseRegistry(JSON.stringify(good)).state).toBe('ok')
  expect(parseRegistry('{}').state).toBe('ok')
  for (const bad of [
    '{',
    '[]',
    JSON.stringify({ tags: {}, turn: 0 }),
    JSON.stringify({ tags: [], turn: -1 }),
    JSON.stringify({ tags: [], turn: 0, firstPromptPinned: 'yes' }),
    JSON.stringify(reg([{ kind: 'nope', target: { tool_use_id: 'a' }, created_turn: 0 } as unknown as Tag])),
    JSON.stringify(reg([{ kind: 'disposable', target: { tool_use_id: 'a' }, created_turn: 0 }])),
    JSON.stringify(reg([{ kind: 'pin', target: { tool_use_id: 'a' }, ttl_turns: 2, created_turn: 0 }])),
    JSON.stringify(reg([{ kind: 'pin', target: { tool_use_id: 'a', anchor: 'x', hint: 0 } as never, created_turn: 0 }])),
    JSON.stringify(reg([{ kind: 'pin', target: { anchor: 'x', hint: 1.5 }, created_turn: 0 }])),
    JSON.stringify(reg([{ kind: 'pin', target: { tool_use_id: 'a' } } as unknown as Tag])),
  ]) {
    expect(parseRegistry(bad).state).toBe('unreadable')
  }
  const why = parseRegistry(JSON.stringify(reg([{ kind: 'pin' } as unknown as Tag])))
  expect(why.state === 'unreadable' && why.reason).toContain('bad tag 1')
})

// ---- [SP_CTX_02_11] context_tag

test('context_tag adds, replaces and removes tags, stamped with the current turn', async () => {
  const { io, log } = harness({ state: 'ok', value: reg([], { turn: 4 }) })
  const out = await contextTag(io, {
    tags: [
      { op: 'add', kind: 'review', tool_use_id: 'a' },
      { op: 'add', kind: 'disposable', tool_use_id: 'a', note: 'file A: KEY_0042 = ff' },
      { op: 'add', kind: 'pin', index: 0 },
      { op: 'add', kind: 'disposable', index: 3, note: 'dead end: X' },
      { op: 'add', kind: 'review', tool_use_id: 'b', ttl_turns: 2 },
      { op: 'remove', tool_use_id: 'b' },
    ],
  })
  expect('result' in out && out.result).toContain('Tagged 5, removed 1; 3 tag(s)')
  const tags = log.tags!.tags
  expect(tags.length).toBe(3)
  expect(tags[0]!.kind).toBe('disposable')
  expect(tags[0]!.note).toBe('file A: KEY_0042 = ff')
  expect(tags[0]!.created_turn).toBe(4)
  expect(tags[1]!.target).toEqual(anchorOf(0))
  expect(tags[2]!.target).toEqual(anchorOf(3))
})

test('context_tag rejects each bad request with its code and keeps the rest of the batch', async () => {
  const full = reg(Array.from({ length: MAX_TAGS }, (_, i) => ({ kind: 'review' as const, target: { tool_use_id: i ? `t${i}` : 'a' }, created_turn: 0 })))
  const cases: [unknown, string, Read<TagRegistry>?][] = [
    [{ op: 'set', kind: 'pin', index: 0 }, 'BAD_OP'],
    ['pin', 'BAD_OP'],
    [{ op: 'add', index: 0 }, 'KIND_REQUIRED'],
    [{ op: 'add', kind: 'keep', index: 0 }, 'KIND_REQUIRED'],
    [{ op: 'add', kind: 'pin', index: 0, tool_use_id: 'a' }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin' }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin', index: 1.5 }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin', index: 0, ref: 'last' }, 'TARGET_REQUIRED'],
    [{ op: 'add', kind: 'pin', ref: 'c9' }, 'UNKNOWN_REF'],
    [{ op: 'add', kind: 'pin', tool_use_id: 'zz' }, 'TARGET_NOT_FOUND'],
    [{ op: 'add', kind: 'pin', index: 99 }, 'TARGET_NOT_FOUND'],
    [{ op: 'add', kind: 'disposable', tool_use_id: 'a' }, 'NOTE_REQUIRED'],
    [{ op: 'add', kind: 'disposable', tool_use_id: 'a', note: '   ' }, 'NOTE_REQUIRED'],
    [{ op: 'add', kind: 'disposable', tool_use_id: 'a', note: 'x'.repeat(8001) }, 'NOTE_REQUIRED'],
    [{ op: 'add', kind: 'disposable', index: 2, note: 'n' }, 'BAD_TARGET'],
    [{ op: 'add', kind: 'disposable', index: 0, note: 'n' }, 'BAD_TARGET'],
    [{ op: 'add', kind: 'review', tool_use_id: 'a', ttl_turns: 0 }, 'BAD_TTL'],
    [{ op: 'add', kind: 'pin', tool_use_id: 'a', ttl_turns: 2 }, 'BAD_TTL'],
    [{ op: 'add', kind: 'pin', index: 0 }, 'TAGS_FULL', { state: 'ok', value: full }],
    [{ op: 'remove', tool_use_id: 'a' }, 'NO_TAG'],
  ]
  for (const [request, code, start] of cases) {
    const { io, log } = harness(start ?? empty())
    const out = await contextTag(io, { tags: [request, { op: 'add', kind: 'pin', tool_use_id: 'b' }] })
    if ('deny' in out) throw new Error(out.deny)
    expect(out.result).toContain(`tag 1:`)
    expect(out.result).toContain(`(${code})`)
    // the second request of the batch still applies (except into a full registry)
    expect(log.tags?.tags.some(t => 'tool_use_id' in t.target && t.target.tool_use_id === 'b') ?? false).toBe(code !== 'TAGS_FULL')
  }
  // a full registry still takes a tag that replaces one on the same target
  const { io } = harness({ state: 'ok', value: full })
  const replaced = await contextTag(io, { tags: [{ op: 'add', kind: 'pin', tool_use_id: 'a' }] })
  expect('result' in replaced && replaced.result).toContain('Tagged 1')
})

test('context_tag refuses the whole call for a subagent, no list, no storage, an unreadable or unwritable registry', async () => {
  const ok = harness(empty())
  const sub = await contextTag(ok.io, { agentId: 'ag1', tags: [{ op: 'add', kind: 'pin', index: 0 }] })
  expect('code' in sub && sub.code).toBe('DENIED_SUBAGENT')
  for (const tags of [undefined, [], 'pin', Array.from({ length: MAX_TAGS + 1 }, () => ({}))]) {
    const out = await contextTag(ok.io, { tags })
    expect('code' in out && out.code).toBe('DENIED_EMPTY')
  }
  const down = await contextTag(ok.io, { tags: [{ op: 'add', kind: 'pin', index: 0 }] }, 'HOME is not set')
  expect('code' in down && down.code).toBe('DENIED_STORAGE')
  expect('deny' in down && down.deny).toContain('HOME is not set')
  const broken = harness({ state: 'unreadable', reason: 'bad tag 2' })
  const unread = await contextTag(broken.io, { tags: [{ op: 'add', kind: 'pin', index: 0 }] })
  expect('code' in unread && unread.code).toBe('DENIED_REGISTRY_READ')
  expect(broken.log.tagWrites).toBe(0)
  const failing = harness(empty(), undefined, {
    writeTags: async () => {
      throw new Error('disk full')
    },
  })
  const unwritten = await contextTag(failing.io, { tags: [{ op: 'add', kind: 'pin', index: 0 }] })
  expect('code' in unwritten && unwritten.code).toBe('DENIED_REGISTRY_WRITE')
  expect('deny' in unwritten && unwritten.deny).toContain('disk full')
})

// ---- [SP_CTX_02_01] the listing

test('the listing shows pin, a short disposable note and only active reviews', async () => {
  const r = reg(
    [
      { kind: 'pin', target: anchorOf(0), created_turn: 0 },
      { kind: 'disposable', target: { tool_use_id: 'a' }, note: 'N'.repeat(60), created_turn: 0 },
      { kind: 'review', target: { tool_use_id: 'b' }, ttl_turns: 3, created_turn: 1 },
      { kind: 'review', target: anchorOf(6), created_turn: 1 },
    ],
    { turn: 3 },
  )
  const text = listRows(rows(), 0, 10, new Map(), tagLabels(rows(), r))
  expect(text).toContain('#0 user 23c: text "the task: find KEY_0042" [pin]')
  expect(text).toContain(`[disposable: "${'N'.repeat(40)}…"]`)
  expect(text.split('\n').filter(l => l.startsWith('#') && l.includes('[disposable')).length).toBe(2)
  expect(text).toContain('#6 assistant')
  expect(text.split('\n').find(l => l.startsWith('#6'))).toContain('[review]')
  // the ttl of the Grep review has not passed at turn 3 (created at 1, ttl 3)
  expect(text.split('\n').find(l => l.startsWith('#5'))!.includes('[review]')).toBe(false)
  expect(activeReviews(rows(), r)).toBe(1)
  // ...and has at turn 4
  const later = { ...r, turn: 4 }
  expect(listRows(rows(), 5, 1, new Map(), tagLabels(rows(), later))).toContain('[review]')
  expect(activeReviews(rows(), later)).toBe(2)
})

// ---- [SP_CTX_02_03] pin

test('prepare refuses every edit that touches a pinned pair or row', async () => {
  const input = rows()
  const pinned = pinnedTargets(input, reg([
    { kind: 'pin', target: anchorOf(0), created_turn: 0 },
    { kind: 'pin', target: { tool_use_id: 'b' }, created_turn: 0 },
    { kind: 'pin', target: anchorOf(3), created_turn: 0 },
  ]))
  const { queued, errors } = prepare(
    input,
    [
      { op: 'collapse', from_index: 0, to_index: 2, summary: 'start' },
      { op: 'summarize', tool_use_id: 'b', summary: 's' },
      { op: 'collapse', from_index: 4, to_index: 6, summary: 'b' },
      { op: 'rewrite', index: 3, text: 't' },
      { op: 'summarize', tool_use_id: 'a', summary: 'ok' },
    ],
    undefined,
    pinned,
  )
  expect(errors.length).toBe(4)
  for (const e of errors) expect(e).toContain('target is pinned; remove the pin with context_tag first')
  expect(queued.length).toBe(1)
  const q = queueEdits(EMPTY_QUEUE, input, { edits: [{ op: 'collapse', from_index: 0, to_index: 1 + 1, summary: 's' }] }, pinned)
  expect('queue' in q && q.errors[0]).toContain('target is pinned')
})

// ---- [SP_CTX_02_12] AutoTag

function fact(over: Partial<AppendFacts>): AppendFacts {
  return { door: 'prompt', origin: 'composer', ids: [], size: 0, text: '', ...over }
}

test('appendFacts reads door, origin, tool, ids and size from an appended row', async () => {
  const f = appendFacts({
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Read' },
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'text', text: 'abc' }, { type: 'image', source: {} }] },
        { type: 'tool_result', tool_use_id: 'r2', content: 'de' },
      ],
    },
  })
  expect(f).toEqual({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['r1', 'r2'], size: 5, text: '' })
  const p = appendFacts({ door: 'prompt', origin: { kind: 'composer' }, message: { content: [{ type: 'text', text: 'hi' }] } })
  expect(p.text).toBe('hi')
  expect(p.tool).toBeUndefined()
})

test('R1 pins the first prompt of the person only; the second prompt gets no tag', async () => {
  const { io, log } = harness(empty())
  await autoTag(io, fact({ text: 'the task:\nfind KEY_0042' }))
  expect(log.tags!.firstPromptPinned).toBe(true)
  expect(log.tags!.tags).toEqual([{ kind: 'pin', target: anchorOf(0), created_turn: 0 }])
  await autoTag(io, fact({ text: 'Next step.' }))
  expect(log.tags!.tags.length).toBe(1)
  expect(log.tagWrites).toBe(1)
})

test('R1 waits for the person: a plugin prompt first gets no pin', async () => {
  const { io, log } = harness(empty())
  await autoTag(io, fact({ origin: 'plugin', text: 'the task: find KEY_0042' }))
  expect(log.tags).toBeUndefined()
  await autoTag(io, fact({ origin: 'bridge', text: 'the task: find KEY_0042' }))
  expect(log.tags!.tags[0]!.kind).toBe('pin')
})

test('AutoTag — R1 у stream-json: the person\'s first prompt arrives with origin unclassified and is pinned; a plugin-origin row is not', async () => {
  const { io, log } = harness(empty())
  await autoTag(io, appendFacts({ door: 'prompt', origin: { kind: 'plugin' }, message: { content: [{ type: 'text', text: 'the task: find KEY_0042' }] } }))
  expect(log.tagWrites).toBe(0)
  await autoTag(io, appendFacts({ door: 'prompt', origin: { kind: 'unclassified' }, message: { content: [{ type: 'text', text: 'the task: find KEY_0042' }] } }))
  expect(log.tags!.firstPromptPinned).toBe(true)
  expect(log.tags!.tags).toEqual([{ kind: 'pin', target: anchorOf(0), created_turn: 0 }])
})

test('AutoTag — копія промпту: a prompt row a compaction returned, appended again with plugin origin, gets no pin', async () => {
  // stream-json: door prompt, origin { kind: plugin, name: context-editor }, firstPromptPinned false
  const copy = appendFacts({ door: 'prompt', origin: { kind: 'plugin' }, message: { content: [{ type: 'text', text: 'the task: find KEY_0042' }] } })
  expect(isPluginRow(copy)).toBe(true)
  const { io, log } = harness(empty())
  await autoTag(io, copy)
  expect(log.tagWrites).toBe(0)
  expect(applyRules(EMPTY_REGISTRY, copy, anchorOf(0))).toBe(EMPTY_REGISTRY)
})

test('AutoTag — копія великого результату: a 5000-char Read result copy with plugin origin gets neither R2 nor R3', async () => {
  const copy = appendFacts({
    door: 'tool-result',
    origin: { kind: 'plugin' },
    message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: BIG }] }] },
  })
  const tagged = reg([{ kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 }])
  const { io, log } = harness({ state: 'ok', value: tagged })
  await autoTag(io, copy)
  expect(log.tagWrites).toBe(0)
  // even a copy that named its tool is skipped
  const fresh = harness(empty())
  await autoTag(fresh.io, { ...copy, tool: 'Grep' })
  expect(fresh.log.tagWrites).toBe(0)
})

test('R2 marks a big output, R3 a search output with a ttl; own tools and small outputs get nothing', async () => {
  const r2 = applyRules(EMPTY_REGISTRY, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['a'], size: 5000 }))
  expect(r2.tags).toEqual([{ kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 }])
  const r3 = applyRules({ ...EMPTY_REGISTRY, turn: 2 }, fact({ door: 'tool-result', origin: 'tool', tool: 'Grep', ids: ['b'], size: 10 }))
  expect(r3.tags).toEqual([{ kind: 'review', target: { tool_use_id: 'b' }, ttl_turns: SEARCH_TTL, created_turn: 2 }])
  const small = applyRules(EMPTY_REGISTRY, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['c'], size: 10 }))
  expect(small).toBe(EMPTY_REGISTRY)
  const own = applyRules(EMPTY_REGISTRY, fact({ door: 'tool-result', origin: 'tool', tool: 'mcp__context-editor__context_list', ids: ['d'], size: 9000 }))
  expect(own).toBe(EMPTY_REGISTRY)
  const otherDoor = applyRules(EMPTY_REGISTRY, fact({ door: 'tool-message', origin: 'tool', tool: 'Grep', ids: ['e'], size: 9000 }))
  expect(otherDoor).toBe(EMPTY_REGISTRY)
})

test('rules never overwrite a tag the agent set, and stop at MAX_TAGS', async () => {
  const mine = reg([{ kind: 'disposable', target: { tool_use_id: 'b' }, note: 'n', created_turn: 0 }])
  const out = applyRules(mine, fact({ door: 'tool-result', origin: 'tool', tool: 'Grep', ids: ['b'], size: 9000 }))
  expect(out).toBe(mine)
  const full = reg(Array.from({ length: MAX_TAGS }, (_, i) => ({ kind: 'review' as const, target: { tool_use_id: `t${i}` }, created_turn: 0 })))
  expect(applyRules(full, fact({ door: 'tool-result', origin: 'tool', tool: 'Grep', ids: ['b'], size: 1 })).tags.length).toBe(MAX_TAGS)
})

test('AutoTag leaves an unreadable registry alone; the turn counter counts completed turns', async () => {
  const broken = harness({ state: 'unreadable', reason: 'x' })
  await autoTag(broken.io, fact({ text: 'the task: find KEY_0042' }))
  await countTurn(broken.io)
  expect(broken.log.tagWrites).toBe(0)
  const { io, log } = harness(empty())
  await countTurn(io)
  await countTurn(io)
  expect(log.tags!.turn).toBe(2)
})

// ---- [SP_CTX_02_13] QueueTagReplacements

const disposables = reg([
  { kind: 'disposable', target: { tool_use_id: 'a' }, note: 'file A: KEY_0042 = ff', created_turn: 0 },
  { kind: 'disposable', target: anchorOf(3), note: 'dead end', created_turn: 0 },
  { kind: 'disposable', target: { tool_use_id: 'gone' }, note: 'x', created_turn: 0 },
])

test('two disposable tags on an empty queue become two edits of a tags-only batch; context_edit clears tagsOnly', async () => {
  const { io, log } = harness({ state: 'ok', value: disposables })
  const { queued, freed } = await queueTagReplacements(io)
  expect(queued).toBe(2)
  const q = log.queue!
  expect(q.edits.map(e => e.op)).toEqual(['summarize', 'rewrite'])
  expect(q.tagsOnly).toBe(true)
  const replaced = BIG.length + 'A long dead-end reasoning that turned out wrong.'.length
  expect(freed).toBe(`~${Math.round((replaced - 'file A: KEY_0042 = ff'.length - 'dead end'.length) / 4)} tokens (approx.)`)
  const after = queueEdits(q, rows(), { edits: [{ op: 'drop', tool_use_id: 'b' }] })
  expect('queue' in after && after.queue.tagsOnly).toBe(false)
})

test('replacements join a non-empty queue without making it tags-only', async () => {
  const pending: Queue = { ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'b' }] }
  const { io, log } = harness({ state: 'ok', value: disposables }, { state: 'ok', value: pending })
  expect((await queueTagReplacements(io)).queued > 0).toBe(true)
  expect(log.queue!.edits.length).toBe(3)
  expect(log.queue!.tagsOnly).toBe(false)
})

test('replacements are not queued past MAX_QUEUE_EDITS or MAX_QUEUE_BYTES, nor from an unreadable file', async () => {
  const many: Queue = { ...EMPTY_QUEUE, edits: Array.from({ length: MAX_QUEUE_EDITS - 1 }, (): QueuedEdit => ({ op: 'drop', tool_use_id: 'b' })) }
  const a = harness({ state: 'ok', value: disposables }, { state: 'ok', value: many })
  expect((await queueTagReplacements(a.io)).queued).toBe(0)
  expect(a.log.queue).toBeUndefined()
  const huge: Queue = { ...EMPTY_QUEUE, report: 'r'.repeat(MAX_QUEUE_BYTES) }
  const b = harness({ state: 'ok', value: disposables }, { state: 'ok', value: huge })
  expect((await queueTagReplacements(b.io)).queued).toBe(0)
  expect(b.log.queue).toBeUndefined()
  const c = harness({ state: 'unreadable', reason: 'x' })
  expect((await queueTagReplacements(c.io)).queued).toBe(0)
  const d = harness({ state: 'ok', value: disposables }, { state: 'unreadable', reason: 'x' })
  expect((await queueTagReplacements(d.io)).queued).toBe(0)
  const none = harness(empty())
  expect((await queueTagReplacements(none.io)).queued).toBe(0)
  expect(none.log.queue).toBeUndefined()
})

// ---- [SP_CTX_02_14] RebindTags

test('after an apply the tag of the edited pair goes, the tag of the untouched pair stays', async () => {
  const before = rows()
  const r = reg([
    { kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', target: { tool_use_id: 'b' }, created_turn: 0 },
  ])
  const edits = prepare(before, [{ op: 'drop', tool_use_id: 'a' }]).queued
  const after = before.filter((_, i) => i !== 1 && i !== 2)
  const out = rebindTags(r, before, after, edits, edits)
  expect(out.tags.map(t => ('tool_use_id' in t.target ? t.target.tool_use_id : ''))).toEqual(['b'])
})

test('rebind moves the hint of a row tag that shifted and drops tags whose target is gone', async () => {
  const before = rows()
  const r = reg([
    { kind: 'pin', target: anchorOf(6), created_turn: 0 },
    { kind: 'review', target: anchorOf(3), created_turn: 0 },
  ])
  const edits = prepare(before, [{ op: 'collapse', from_index: 1, to_index: 3, summary: 's' }]).queued
  const after = [before[0]!, { role: 'assistant' as const, text: '[context-editor] 3 rows collapsed: s', toolUses: [] }, ...before.slice(4)]
  const out = rebindTags(r, before, after, edits, edits)
  expect(out.tags.length).toBe(1)
  expect(out.tags[0]!.target).toEqual({ anchor: fingerprint(before[6]!), hint: 4 })
})

test('a disposable tag whose replacement failed at application is gone too', async () => {
  const before = rows()
  const r = reg([{ kind: 'disposable', target: { tool_use_id: 'a' }, note: 'n', created_turn: 0 }])
  const batch = prepare(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'n' }]).queued
  expect(rebindTags(r, before, before, [], batch).tags).toEqual([])
  // an unrelated failed edit leaves it alone
  const other = prepare(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'agent text' }]).queued
  expect(rebindTags(r, before, before, [], other).tags.length).toBe(1)
})

test('a tag on a pair the agent changed is removed and no replacement is queued for it', async () => {
  const before = rows()
  const r = reg([{ kind: 'disposable', target: { tool_use_id: 'a' }, note: 'n', created_turn: 0 }])
  const edits = prepare(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'by the agent' }]).queued
  const after = before.map((row, i) =>
    i === 1 ? use('a_ce1', 'Read') : i === 2 ? result('a_ce1', '[context-editor] summarized: by the agent') : row,
  )
  const out = rebindTags(r, before, after, edits, edits)
  expect(out.tags).toEqual([])
  const { io, log } = harness({ state: 'ok', value: r }, undefined, { rows: async () => after })
  expect((await queueTagReplacements(io)).queued).toBe(0)
  expect(log.queue).toBeUndefined()
})

// [SP_CTX_02_13]
test('QueueTagReplacements — без повтору: a replacement already queued (a close by the tool, then the mark in the same turn) is not queued again', async () => {
  const one = reg([{ kind: 'disposable', target: { tool_use_id: 'a' }, note: 'file A: KEY_0042 = ff', created_turn: 0 }])
  const { io, log } = harness({ state: 'ok', value: one })
  expect((await queueTagReplacements(io)).queued).toBe(1)
  expect(log.queue!.edits.length).toBe(1)
  expect(await queueTagReplacements(io)).toEqual({ queued: 0, freed: '' })
  expect(log.queue!.edits.length).toBe(1)
})

test('QueueTagReplacements keeps the optimization request of the queue it writes (05_02)', async () => {
  const { io, log } = harness({ state: 'ok', value: disposables }, { state: 'ok', value: { ...EMPTY_QUEUE, optimize: true } })
  await queueTagReplacements(io)
  expect(log.queue!.optimize).toBe(true)
})
