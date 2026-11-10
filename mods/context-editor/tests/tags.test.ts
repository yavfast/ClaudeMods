import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applyEdits, describeEdit, dropOwnCallsCounted, fingerprint, listRows, MAX_QUEUE_EDITS, prepare, REWRITTEN, STATE_SLOT, SUMMARIZED, SUMMARIZED_OF, TAG_REWRITTEN, TAG_SUMMARIZED_OF, touchedBy, type QueuedEdit } from '../hooks/edits'
import { BIG_ROW, DOCUMENT_FRAME, isReplacementText } from '../hooks/rows'
import { insertDeliveries } from '../hooks/deliveries'
import { EMPTY_QUEUE, MAX_QUEUE_BYTES, queueEdits, type Queue } from '../hooks/queue'
import type { Read } from '../hooks/store'
import {
  activeReviews,
  appendFacts,
  applyRules,
  applyTagRequests,
  autoTag,
  autoTagNeeded,
  contextTag,
  countTurn,
  EMPTY_REGISTRY,
  isPluginRow,
  MAX_REGISTRY_BYTES,
  MAX_TAGS,
  parseRegistry,
  pinDocument,
  pruneDeadTags,
  registryFull,
  TAG_ROOM,
  tagsFullLine,
  pinnedTargets,
  queueTagReplacements,
  callFollowUp,
  isCompactionCopy,
  markDuplicates,
  markStale,
  markSuperseded,
  changedRead,
  numberedLines,
  seenRead,
  supersededReads,
  rebindTags,
  resolveTarget,
  resultIds,
  SEARCH_TTL,
  staleReads,
  stateRow,
  tagLabels,
  appendRow,
  pinsFrom,
  type AppendFacts,
  type AppendIO,
  type Tag,
  type TagIO,
  type TagRegistry,
} from '../hooks/tags'
import type { QueuedDelivery } from '../hooks/deliveries'
import { NO_PINS } from '../hooks/edits'
import { prompt, reply, result, use, missingRead, okRead, unreadableRead } from './row-fixtures'

const BIG = 'x'.repeat(5000)

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

function harness(tags: Read<TagRegistry>, queue: Read<Queue> = missingRead({ ...EMPTY_QUEUE }), over: Partial<TagIO> = {}) {
  const log: { tags?: TagRegistry; queue?: Queue; tagWrites: number } = { tagWrites: 0 }
  const io: TagIO = {
    rows: async () => rows(),
    readTags: async () => (log.tags ? okRead(log.tags) : tags),
    writeTags: async r => {
      log.tags = r
      log.tagWrites++
    },
    readQueue: async () => (log.queue ? okRead(log.queue) : queue),
    writeQueue: async q => {
      log.queue = q
    },
    ...over,
  }
  return { io, log }
}

const empty = (): Read<TagRegistry> => missingRead({ ...EMPTY_REGISTRY })

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
  // [SP_CTX_01_10] reintroduce (phase 33): optional bool
  const re = parseRegistry(JSON.stringify({ ...good, reintroduce: true }))
  expect(re.state === 'ok' && re.value.reintroduce).toBe(true)
  expect(parseRegistry(JSON.stringify(good)).state === 'ok' && (parseRegistry(JSON.stringify(good)) as { value: TagRegistry }).value.reintroduce).toBeUndefined()
  const badRe = parseRegistry(JSON.stringify({ ...good, reintroduce: 'yes' }))
  expect(badRe.state === 'unreadable' && badRe.reason).toContain('reintroduce')
})

// ---- [SP_CTX_02_11] context_tag

test('context_tag adds, replaces and removes tags, stamped with the current turn', async () => {
  const { io, log } = harness(okRead(reg([], { turn: 4 })))
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
    [{ op: 'add', kind: 'pin', index: 0 }, 'TAGS_FULL', okRead(full)],
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
  const { io } = harness(okRead(full))
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
  const broken = harness(unreadableRead('bad tag 2'))
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
  expect(activeReviews(rows(), r)).toEqual(new Map([['none', [6]]]))
  // ...and has at turn 4
  const later = { ...r, turn: 4 }
  expect(listRows(rows(), 5, 1, new Map(), tagLabels(rows(), later))).toContain('[review]')
  expect(activeReviews(rows(), later)).toEqual(new Map([['none', [4, 6]]]))
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
  return { door: 'prompt', origin: 'composer', ids: [], size: 0, text: '', results: [], ...over }
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
  expect(f).toEqual({
    door: 'tool-result',
    origin: 'tool',
    tool: 'Read',
    ids: ['r1', 'r2'],
    size: 5,
    text: '',
    results: [
      { id: 'r1', text: 'abc' },
      { id: 'r2', text: 'de' },
    ],
  })
  const p = appendFacts({ door: 'prompt', origin: { kind: 'composer' }, message: { content: [{ type: 'text', text: 'hi' }] } })
  expect(p.text).toBe('hi')
  expect(p.tool).toBeUndefined()
})

// [SP_CTX_02_68] R1 is gone (C_CTX_DEC_38): no origin gets its first prompt pinned
test('Pins — перший промпт: no rule pins the person\'s first prompt, from any origin', async () => {
  const { io, log } = harness(empty())
  for (const origin of ['composer', 'bridge', 'sdk', 'unclassified', 'plugin'])
    await autoTag(io, fact({ origin, text: 'the task: find KEY_0042' }))
  await autoTag(io, appendFacts({ door: 'prompt', origin: { kind: 'unclassified' }, message: { content: [{ type: 'text', text: 'the task' }] } }))
  expect(log.tagWrites).toBe(0)
  expect(autoTagNeeded(fact({ origin: 'composer', text: 'the task' }))).toBe(false)
})

const DOC_ROW = (frame = true): SessionMessage => ({
  role: 'user',
  text: `${frame ? 'The context-editor plugin sent a message:\n' : ''}${DOCUMENT_FRAME}\n\nmy notes\n\ncontext-editor: this session continues s1 (document).`,
  toolUses: [],
})

test('Pins — передача «документом»: the first turn end pins row 0 of a document session once; docChecked stays', async () => {
  let reads = 0
  const r = [DOC_ROW(), { role: 'assistant' as const, text: 'ok', toolUses: [] }]
  const { io, log } = harness(empty(), undefined, { rows: async () => (reads++, r) })
  await countTurn(io)
  expect(log.tags!.tags).toEqual([{ kind: 'pin', target: { anchor: fingerprint(r[0]!), hint: 0 }, created_turn: 1 }])
  expect(log.tags!.docChecked).toBe(true)
  expect(log.tags!.turn).toBe(1)
  await countTurn(io)
  expect(reads).toBe(1)
  expect(log.tags!.tags.length).toBe(1)
  // the agent removes the pin like any other
  const removed = await contextTag(io, { tags: [{ op: 'remove', index: 0 }] })
  expect('result' in removed).toBe(true)
  expect(log.tags!.tags).toEqual([])
})

test('Pins — no document: row 0 of an ordinary session gets no pin; a document without the host frame is still one', async () => {
  const { io, log } = harness(empty())
  await countTurn(io)
  expect(log.tags!.tags).toEqual([])
  expect(log.tags!.docChecked).toBe(true)
  expect(pinDocument(EMPTY_REGISTRY, [DOC_ROW(false)]).tags.length).toBe(1)
  // a tag already on row 0 stays as it is
  const mine = reg([{ kind: 'review', reason: 'agent', target: { anchor: fingerprint(DOC_ROW()), hint: 0 }, created_turn: 0 }])
  expect(pinDocument(mine, [DOC_ROW()]).tags).toEqual(mine.tags)
  expect(parseRegistry(JSON.stringify({ ...EMPTY_REGISTRY, docChecked: 'yes' })).state).toBe('unreadable')
})

// [SP_CTX_02_68] stream-json: the host writes the rows of the mod's /clear before the document (live run of phase 40)
test('Pins — рядки /clear перед документом: the document after the command rows is pinned at its own index; a document after the first response is not', async () => {
  const clear = [prompt('<local-command-caveat>Caveat: …</local-command-caveat>'), prompt('<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>')]
  const out = pinDocument(EMPTY_REGISTRY, [...clear, DOC_ROW(), reply('PELICAN')])
  expect(out.tags).toEqual([{ kind: 'pin', target: { anchor: fingerprint(DOC_ROW()), hint: 2 }, created_turn: 0 }])
  expect(out.docChecked).toBe(true)
  const late = pinDocument(EMPTY_REGISTRY, [prompt('task'), reply('ok'), DOC_ROW()])
  expect(late.tags).toEqual([])
})

test('AutoTag — копія промпту: a prompt row a compaction returned, appended again with plugin origin, gets no pin', async () => {
  // stream-json: door prompt, origin { kind: plugin, name: context-editor }, firstPromptPinned false
  const copy = appendFacts({ door: 'prompt', origin: { kind: 'plugin' }, message: { content: [{ type: 'text', text: 'the task: find KEY_0042' }] } })
  expect(isPluginRow(copy)).toBe(true)
  const { io, log } = harness(empty())
  await autoTag(io, copy)
  expect(log.tagWrites).toBe(0)
  expect(applyRules(EMPTY_REGISTRY, copy)).toBe(EMPTY_REGISTRY)
})

test('AutoTag — копія великого результату (plugin origin): a 5000-char Read result copy with plugin origin gets neither R2 nor R3', async () => {
  const copy = appendFacts({
    door: 'tool-result',
    origin: { kind: 'plugin' },
    message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: BIG }] }] },
  })
  const tagged = reg([{ kind: 'review', target: { tool_use_id: 'a' }, created_turn: 0 }])
  const { io, log } = harness(okRead(tagged))
  await autoTag(io, copy)
  expect(log.tagWrites).toBe(0)
  // even a copy that named its tool is skipped
  const fresh = harness(empty())
  await autoTag(fresh.io, { ...copy, tool: 'Grep' })
  expect(fresh.log.tagWrites).toBe(0)
})

test('R2 marks a big output, R3 a search output with a ttl; own tools and small outputs get nothing', async () => {
  const r2 = applyRules(EMPTY_REGISTRY, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['a'], size: 5000 }))
  expect(r2.tags).toEqual([{ kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 }])
  const r3 = applyRules({ ...EMPTY_REGISTRY, turn: 2 }, fact({ door: 'tool-result', origin: 'tool', tool: 'Grep', ids: ['b'], size: 10 }))
  expect(r3.tags).toEqual([{ kind: 'review', reason: 'search', target: { tool_use_id: 'b' }, ttl_turns: SEARCH_TTL, created_turn: 2 }])
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
  const broken = harness(unreadableRead('x'))
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

// [SP_CTX_01_30] [SP_CTX_02_62] [SP_CTX_DEC_44] phase 41: a `status` key of a tag is ignored like any extra key
test('ReplacementOpeners — зайве поле status тегу: a disposable with "status" is taken without it; its replacement names the source and no status word', async () => {
  const { io, log } = harness(empty())
  const out = await contextTag(io, { tags: [{ op: 'add', kind: 'disposable', tool_use_id: 'a', note: 'file A: KEY_0042 = ff', status: 'assumed' }] })
  expect(out).not.toHaveProperty('deny')
  expect(log.tags!.tags.length).toBe(1)
  expect('status' in log.tags!.tags[0]!).toBe(false)
  expect(parseRegistry(JSON.stringify(log.tags)).state).toBe('ok')
  await queueTagReplacements(io)
  const text = applyEdits(rows(), log.queue!.edits, '/s/1.json').rows[2]!.toolResults![0]!.text
  expect(text).toBe(`${TAG_SUMMARIZED_OF}Read you had read here with your own note (original: /s/1.json, open with Read): file A: KEY_0042 = ff`)
  expect(/assumed|inferred|verified/.test(text)).toBe(false)
})

test('two disposable tags on an empty queue become two edits of a tags-only batch; context_edit clears tagsOnly', async () => {
  const { io, log } = harness(okRead(disposables))
  const { queued, freed, resumes } = await queueTagReplacements(io)
  expect(queued).toBe(2)
  // [SP_CTX_DEC_16] a tags-only batch does not resume
  expect(resumes).toBe(false)
  const q = log.queue!
  expect(q.edits.map(e => e.op)).toEqual(['summarize', 'rewrite'])
  expect(q.tagsOnly).toBe(true)
  const replaced = BIG.length + 'A long dead-end reasoning that turned out wrong.'.length
  expect(freed).toBe(`~${Math.round((replaced - 'file A: KEY_0042 = ff'.length - 'dead end'.length) / 4)} tokens (approx.)`)
  const after = queueEdits(q, rows(), { edits: [{ op: 'drop', tool_use_id: 'b' }] })
  expect('queue' in after && after.queue.tagsOnly).toBe(false)
})

test('QueueTagReplacements — заміна з тегу називає автора: an applied disposable note reads as the agent\'s own replacement made by its context_tag tag (phase 19; phase 28: via tag)', async () => {
  const { io, log } = harness(okRead(disposables))
  await queueTagReplacements(io)
  expect(log.queue!.edits.every(e => e.via === 'tag')).toBe(true)
  const out = applyEdits(rows(), log.queue!.edits, '/s/1.json')
  expect(out.report.applied.length).toBe(2)
  expect(out.rows[2]!.toolResults![0]!.text).toBe(`${TAG_SUMMARIZED_OF}Read you had read here with your own note (original: /s/1.json, open with Read): file A: KEY_0042 = ff`)
  expect(TAG_SUMMARIZED_OF).toBe('Later, your context_tag disposable tag replaced the full output of ')
  expect(out.rows[3]!.text).toBe(`${TAG_REWRITTEN} (original: /s/1.json, open with Read): dead end`)
  expect(TAG_REWRITTEN).toBe('Later, your context_tag disposable tag replaced the text of this row with your own note')
  // the same edits from context_edit name the call
  const own = applyEdits(rows(), log.queue!.edits.map(({ via: _v, ...e }) => e), '/s/1.json')
  expect(own.rows[2]!.toolResults![0]!.text.startsWith(SUMMARIZED_OF)).toBe(true)
  expect(own.rows[3]!.text.startsWith(REWRITTEN)).toBe(true)
  for (const t of [out.rows[2]!.toolResults![0]!.text, out.rows[3]!.text]) expect(isReplacementText(t)).toBe(true)
})

test('replacements join a non-empty queue without making it tags-only', async () => {
  const pending: Queue = { ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'b' }] }
  const { io, log } = harness(okRead(disposables), okRead(pending))
  const out = await queueTagReplacements(io)
  expect(out.queued > 0).toBe(true)
  expect(out.resumes).toBe(true)
  expect(log.queue!.edits.length).toBe(3)
  expect(log.queue!.tagsOnly).toBe(false)
  // the agent's resume_prompt on a call whose edits were all refused resumes a tags-only batch
  const chose = harness(okRead(disposables), okRead({ ...EMPTY_QUEUE, resumeSet: true, resumePrompt: 'P' }))
  expect((await queueTagReplacements(chose.io)).resumes).toBe(true)
  expect(chose.log.queue!.tagsOnly).toBe(true)
})

test('replacements are not queued past MAX_QUEUE_EDITS or MAX_QUEUE_BYTES, nor from an unreadable file', async () => {
  const many: Queue = { ...EMPTY_QUEUE, edits: Array.from({ length: MAX_QUEUE_EDITS - 1 }, (): QueuedEdit => ({ op: 'drop', tool_use_id: 'b' })) }
  const a = harness(okRead(disposables), okRead(many))
  expect((await queueTagReplacements(a.io)).queued).toBe(0)
  expect(a.log.queue).toBeUndefined()
  const huge: Queue = { ...EMPTY_QUEUE, report: 'r'.repeat(MAX_QUEUE_BYTES) }
  const b = harness(okRead(disposables), okRead(huge))
  expect((await queueTagReplacements(b.io)).queued).toBe(0)
  expect(b.log.queue).toBeUndefined()
  const c = harness(unreadableRead('x'))
  expect((await queueTagReplacements(c.io)).queued).toBe(0)
  const d = harness(okRead(disposables), unreadableRead('x'))
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
  const after = [before[0]!, { role: 'assistant' as const, text: '[context-editor] you read these 3 rows, then collapsed them into your note: s', toolUses: [] }, ...before.slice(4)]
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
    i === 1 ? use('a_ce1', 'Read') : i === 2 ? result('a_ce1', '[context-editor] you read the full output here, then replaced it with your summary: by the agent') : row,
  )
  const out = rebindTags(r, before, after, edits, edits)
  expect(out.tags).toEqual([])
  const { io, log } = harness(okRead(r), undefined, { rows: async () => after })
  expect((await queueTagReplacements(io)).queued).toBe(0)
  expect(log.queue).toBeUndefined()
})

// [SP_CTX_02_13]
test('QueueTagReplacements — без повтору: a replacement already queued (a close by the tool, then the mark in the same turn) is not queued again', async () => {
  const one = reg([{ kind: 'disposable', target: { tool_use_id: 'a' }, note: 'file A: KEY_0042 = ff', created_turn: 0 }])
  const { io, log } = harness(okRead(one))
  expect((await queueTagReplacements(io)).queued).toBe(1)
  expect(log.queue!.edits.length).toBe(1)
  expect(await queueTagReplacements(io)).toEqual({ queued: 0, freed: '' })
  expect(log.queue!.edits.length).toBe(1)
})

test('QueueTagReplacements keeps the optimization request of the queue it writes (05_02)', async () => {
  const { io, log } = harness(okRead(disposables), okRead({ ...EMPTY_QUEUE, optimize: true }))
  await queueTagReplacements(io)
  expect(log.queue!.optimize).toBe(true)
})

// ---- phase 15: state slot, ranges, reasons, R4, R5, copies

const ASK = 'AskUserQuestion'

function rows15(): SessionMessage[] {
  return [
    { role: 'user', text: 'the task', toolUses: [] },
    { role: 'assistant', text: 'plan: step 1', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: { file_path: '/p/f' } }] },
    result('a', BIG),
    { role: 'assistant', text: 'a dead end', toolUses: [] },
    use('q', ASK),
    result('q', 'answer: yes'),
    { role: 'user', text: 'the person adds a constraint', toolUses: [] },
    use('b', 'Grep'),
    result('b', 'match'),
    { role: 'assistant', text: 'conclusion', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [] },
  ]
}

const at15 = (i: number) => ({ anchor: fingerprint(rows15()[i]!), hint: i })

function harness15(start: TagRegistry = reg([])) {
  return harness(okRead(start), undefined, { rows: async () => rows15() })
}

async function tag15(start: TagRegistry, tags: unknown[]) {
  const h = harness15(start)
  const out = await contextTag(h.io, { tags })
  return { text: 'result' in out ? out.result : out.deny, tags: h.log.tags?.tags ?? start.tags }
}

test('context_tag — слот стану: add state on #1, then on #10: one state tag on #10; the result names the move', async () => {
  const first = await tag15(reg([]), [{ op: 'add', kind: 'state', index: 1 }])
  expect(first.tags).toEqual([{ kind: 'state', target: at15(1), created_turn: 0 }])
  const second = await tag15(reg(first.tags), [{ op: 'add', kind: 'state', index: 10 }])
  expect(second.tags).toEqual([{ kind: 'state', target: at15(10), created_turn: 0 }])
  expect(second.text).toContain('The state slot moved from #1 to #10.')
})

test('context_tag — слот стану з загубленого рядка: the old state row is no longer in the conversation: one state tag on #10; the result names only the new row', async () => {
  const lost = reg([{ kind: 'state', target: { anchor: 'assistant||gone', hint: 1 }, created_turn: 0 }])
  const out = await tag15(lost, [{ op: 'add', kind: 'state', index: 10 }])
  expect(out.tags).toEqual([{ kind: 'state', target: at15(10), created_turn: 0 }])
  expect(out.text).toContain('The state slot moved to #10.')
  expect(out.text).not.toContain('moved from')
})

test('context_tag — слот стану не там: a row with a call, a pair by tool_use_id, a thinking-only row, a person\'s row: BAD_TARGET', async () => {
  for (const req of [
    { op: 'add', kind: 'state', index: 2 },
    { op: 'add', kind: 'state', tool_use_id: 'a' },
    { op: 'add', kind: 'state', index: 11 },
    { op: 'add', kind: 'state', index: 0 },
  ]) {
    const out = await tag15(reg([]), [req])
    expect(out.text).toContain('(BAD_TARGET)')
    expect(out.tags).toEqual([])
  }
})

test('context_tag — діапазон: index 2 to 3 is a range; a split pair, a pin inside, the state slot inside, "to" without disposable or index: BAD_RANGE', async () => {
  const ok = await tag15(reg([]), [{ op: 'add', kind: 'disposable', index: 2, to: 4, note: 'dead end: f has no key' }])
  expect(ok.tags).toEqual([{ kind: 'disposable', target: { ...at15(2), toAnchor: fingerprint(rows15()[4]!), toHint: 4 }, note: 'dead end: f has no key', created_turn: 0 }])
  const pinned = reg([{ kind: 'pin', target: at15(4), created_turn: 0 }])
  const pinnedPair = reg([{ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 }])
  const state = reg([{ kind: 'state', target: at15(4), created_turn: 0 }])
  // TSTX-12: six reasons share the code; each row names its own
  const ONLY = '"to" goes only with {"op":"add","kind":"disposable","index":<first row>}'
  const LAST = '"to" is the last row of the range: an integer in 3..11'
  const GUARDED = 'the range holds a row or a call tagged pin or state'
  const cases: [TagRegistry, unknown, string][] = [
    [reg([]), { op: 'add', kind: 'disposable', index: 1, to: 2, note: 'n' }, 'range #1..#2 splits a tool call from its result (a); widen or narrow it'],
    [reg([]), { op: 'add', kind: 'disposable', index: 2, to: 2, note: 'n' }, LAST],
    [reg([]), { op: 'add', kind: 'disposable', index: 2, to: 99, note: 'n' }, LAST],
    [reg([]), { op: 'add', kind: 'disposable', index: 2, to: 3.5, note: 'n' }, LAST],
    [pinned, { op: 'add', kind: 'disposable', index: 1, to: 4, note: 'n' }, GUARDED],
    [pinnedPair, { op: 'add', kind: 'disposable', index: 1, to: 4, note: 'n' }, GUARDED],
    [state, { op: 'add', kind: 'disposable', index: 1, to: 4, note: 'n' }, GUARDED],
    [reg([]), { op: 'add', kind: 'pin', index: 1, to: 4 }, ONLY],
    [reg([]), { op: 'add', kind: 'disposable', tool_use_id: 'a', to: 4, note: 'n' }, ONLY],
    [reg([]), { op: 'remove', index: 1, to: 4 }, ONLY],
  ]
  for (const [start, req, why] of cases) {
    const out = await tag15(start, [req])
    expect(out.text).toContain(`Rejected: tag 1: ${why} (BAD_RANGE).`)
    expect(out.tags).toEqual(start.tags)
  }
})

test('context_tag — зняття діапазону: remove with index 2 drops the range that starts on #2', async () => {
  const range: Tag = { kind: 'disposable', target: { ...at15(2), toAnchor: fingerprint(rows15()[4]!), toHint: 4 }, note: 'n', created_turn: 0 }
  const out = await tag15(reg([range]), [{ op: 'remove', index: 2 }])
  expect(out.text).toContain('removed 1')
  expect(out.tags).toEqual([])
})

test('context_tag — агентський review: the agent\'s review gets reason agent', async () => {
  const out = await tag15(reg([]), [{ op: 'add', kind: 'review', tool_use_id: 'b', ttl_turns: 2 }])
  expect(out.tags).toEqual([{ kind: 'review', reason: 'agent', target: { tool_use_id: 'b' }, ttl_turns: 2, created_turn: 0 }])
})

// [SP_CTX_02_58] PERSON_TAG
test('PersonWords — тег над промптом: a range over a prompt and an AskUserQuestion answer and a disposable on the AskUserQuestion pair are refused; a range without them stands', async () => {
  const range = await tag15(reg([]), [{ op: 'add', kind: 'disposable', index: 4, to: 9, note: 'n' }])
  expect(range.tags.length).toBe(0)
  expect(range.text).toContain(
    "Rejected: tag 1: disposable #4..#9: covers the person's words: #6 (AskUserQuestion answer), #7 (prompt); they stay verbatim in this session: narrow the range or split it around them (PERSON_TAG).",
  )
  const pair = await tag15(reg([]), [{ op: 'add', kind: 'disposable', tool_use_id: 'q', note: 'n' }])
  expect(pair.tags.length).toBe(0)
  expect(pair.text).toContain("disposable q: the AskUserQuestion answer is the person's words; it stays verbatim (PERSON_TAG)")
  const plain = await tag15(reg([]), [{ op: 'add', kind: 'disposable', index: 2, to: 4, note: 'n' }])
  expect(plain.tags.length).toBe(1)
  expect(plain.text).not.toContain('Rejected')
})

// [SP_CTX_02_58] a tag queued before this version whose target covers the person's words now
test('PersonWords — тег у QueueTagReplacements: the tag over a prompt is removed, not queued; its line names it; the other tag is queued', async () => {
  const over = { kind: 'disposable' as const, target: { ...at15(4), toAnchor: fingerprint(rows15()[9]!), toHint: 9 }, note: 'n', created_turn: 0 }
  const fine = { kind: 'disposable' as const, target: { tool_use_id: 'a' }, note: 'file a', created_turn: 0 }
  const h = harness(okRead(reg([over, fine])), undefined, { rows: async () => rows15() })
  const out = await queueTagReplacements(h.io)
  expect(out.queued).toBe(1)
  expect(out.dropped).toEqual(["disposable #4..#9 dropped: it covers the person's words"])
  expect(h.log.tags!.tags).toEqual([fine])
  expect(h.log.queue!.edits.map(describeEdit)).toEqual(['summarize a'])
})

test('context_tag — доставки не прочитано: io.deliveries rejects: the refusal still comes from the rows', async () => {
  const h = harness(okRead(reg([])), undefined, {
    rows: async () => rows15(),
    deliveries: async () => {
      throw new Error('unreadable')
    },
  })
  const out = await contextTag(h.io, { tags: [{ op: 'add', kind: 'disposable', index: 4, to: 9, note: 'n' }] })
  expect('result' in out && out.result).toContain("disposable #4..#9: covers the person's words: #6 (AskUserQuestion answer), #7 (prompt);")
  expect(h.log.tags).toBeUndefined()
})

test('context_list — позначки: [state], [review: stale] on both rows of a pair, a range on its first row only; `review` без причини — [review], an agent\'s — [review: agent]', async () => {
  const r = reg([
    { kind: 'state', target: at15(1), created_turn: 0 },
    { kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'disposable', target: { ...at15(8), toAnchor: fingerprint(rows15()[10]!), toHint: 10 }, note: 'grep found nothing new', created_turn: 0 },
    { kind: 'review', target: at15(4), created_turn: 0 },
    { kind: 'review', reason: 'agent', target: { tool_use_id: 'q' }, created_turn: 0 },
  ])
  const labels = tagLabels(rows15(), r)
  expect(labels.get(1)).toEqual(['[state]'])
  expect(labels.get(2)).toEqual(['[review: stale]'])
  expect(labels.get(3)).toEqual(['[review: stale]'])
  expect(labels.get(8)).toEqual(['[disposable #8..#10: "grep found nothing new"]'])
  expect(labels.get(9)).toBeUndefined()
  expect(labels.get(4)).toEqual(['[review]'])
  expect(labels.get(5)).toEqual(['[review: agent]'])
})

test('parseRegistry — phase 15 fields: state by anchor, a disposable range, review reasons; a range or a reason on the wrong kind is unreadable', async () => {
  const good = reg([
    { kind: 'state', target: { anchor: 'assistant||x', hint: 1 }, created_turn: 0 },
    { kind: 'disposable', target: { anchor: 'a', hint: 2, toAnchor: 'b', toHint: 4 }, note: 'n', created_turn: 0 },
    { kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 0 },
  ])
  expect(parseRegistry(JSON.stringify(good)).state).toBe('ok')
  for (const bad of [
    { kind: 'state', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'pin', target: { anchor: 'a', hint: 2, toAnchor: 'b', toHint: 4 }, created_turn: 0 },
    { kind: 'disposable', target: { anchor: 'a', hint: 4, toAnchor: 'b', toHint: 4 }, note: 'n', created_turn: 0 },
    { kind: 'pin', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', reason: 'other', target: { tool_use_id: 'a' }, created_turn: 0 },
  ])
    expect(parseRegistry(JSON.stringify(reg([bad as Tag]))).state).toBe('unreadable')
})

test('PrepareEdits — слот стану: rewrite of the state row passes; a collapse over it is refused; after the tag is removed it passes', async () => {
  const r = rows15()
  const withState = pinnedTargets(r, reg([{ kind: 'state', target: at15(4), created_turn: 0 }]))
  expect(withState.state).toBe(4)
  const out = prepare(
    r,
    [
      { op: 'rewrite', index: 4, text: 'state: done' },
      { op: 'collapse', from_index: 2, to_index: 6, summary: 's' },
    ],
    undefined,
    withState,
  )
  expect(out.queued.map(describeEdit)).toEqual(['rewrite #4'])
  expect(out.errors).toEqual([`collapse #2..#6: ${STATE_SLOT}`])
  expect(prepare(r, [{ op: 'collapse', from_index: 2, to_index: 6, summary: 's' }], undefined, pinnedTargets(r, reg([]))).queued.length).toBe(1)
  expect(stateRow(r, reg([]))).toBeUndefined()
  expect(stateRow(r.slice(0, 3), reg([{ kind: 'state', target: at15(4), created_turn: 0 }]))).toBe(-1)
})

test('AutoTag — R2, R3: R2 gives reason big, R3 reason search with SEARCH_TTL', async () => {
  const { io, log } = harness(empty())
  await autoTag(io, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['a'], size: 5000, results: [{ id: 'a', text: BIG }] }))
  await autoTag(io, fact({ door: 'tool-result', origin: 'tool', tool: 'Grep', ids: ['b'], size: 10, results: [{ id: 'b', text: 'match list' }] }))
  expect(log.tags!.tags).toEqual([
    { kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', reason: 'search', target: { tool_use_id: 'b' }, ttl_turns: SEARCH_TTL, created_turn: 0 },
  ])
})

// [SP_CTX_02_12] phase 15 diagnosis: in stream-json a compaction's result row
// passes session.append again with its tool's origin (probe: door tool-result,
// origin { kind: tool, tool: Read }), so the plugin-origin filter missed it
test('AutoTag — копія великого результату: a result row the last compaction returned comes with its tool\'s origin and gets no tag; a fresh result does', async () => {
  const copy = appendFacts({
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Read' },
    message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: BIG }] }] },
  })
  const copied = new Set(resultIds(rows()))
  expect(isCompactionCopy(copy, copied)).toBe(true)
  const { io, log } = harness(empty())
  await autoTag(io, copy, isCompactionCopy(copy, copied))
  expect(log.tagWrites).toBe(0)
  // after the next turn starts the set is empty: the same shape is a new row
  await autoTag(io, copy, isCompactionCopy(copy, new Set()))
  expect(log.tags!.tags).toEqual([{ kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 }])
  // a row with a fresh result beside a copied one is no copy
  expect(isCompactionCopy({ ...copy, ids: ['a', 'new'] }, copied)).toBe(false)
  expect(isCompactionCopy({ ...copy, door: 'prompt' }, copied)).toBe(false)
})

// ---- [SP_CTX_01_11] R5 (a)

const readUse = (id: string, input: Record<string, unknown>): SessionMessage => use(id, 'Read', undefined, input)

test('AutoTag — R5 однаковий результат: two Reads with the same 5000-char text: duplicate on the first pair; the second gets R2 big', async () => {
  const r: SessionMessage[] = [{ role: 'user', text: 'task', toolUses: [] }, readUse('a', { file_path: '/x' }), result('a', BIG), readUse('b', { file_path: '/y' }), result('b', BIG)]
  const { io, log } = harness(empty(), undefined, { rows: async () => r })
  await autoTag(io, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['b'], size: 5000, results: [{ id: 'b', text: BIG }] }))
  expect(log.tags!.tags).toEqual([
    { kind: 'review', reason: 'big', target: { tool_use_id: 'b' }, created_turn: 0 },
    { kind: 'review', reason: 'duplicate', target: { tool_use_id: 'a' }, created_turn: 0 },
  ])
})

test('AutoTag — R5 той самий діапазон: the same Read range with another text marks the earlier pair; another offset or a small text does not', async () => {
  const other = 'y'.repeat(5000)
  const same: SessionMessage[] = [readUse('a', { file_path: '/f', offset: 10, limit: 50 }), result('a', BIG), readUse('b', { file_path: '/f', offset: 10, limit: 50 }), result('b', other)]
  expect(markDuplicates(reg([]), same, [{ id: 'b', text: other }]).tags).toEqual([{ kind: 'review', reason: 'duplicate', target: { tool_use_id: 'a' }, created_turn: 0 }])
  const moved: SessionMessage[] = [readUse('a', { file_path: '/f', offset: 10 }), result('a', BIG), readUse('b', { file_path: '/f', offset: 60 }), result('b', other)]
  expect(markDuplicates(reg([]), moved, [{ id: 'b', text: other }]).tags).toEqual([])
  const small: SessionMessage[] = [readUse('a', { file_path: '/f', offset: 10, limit: 50 }), result('a', 's'.repeat(300)), readUse('b', { file_path: '/f', offset: 10, limit: 50 }), result('b', 't'.repeat(300))]
  const r = reg([])
  expect(markDuplicates(r, small, [{ id: 'b', text: 't'.repeat(300) }])).toBe(r)
})

test('AutoTag — R5 паралельні виклики: one row with parallel Read and Grep results, both repeating earlier ones: duplicate on both earlier pairs', async () => {
  const g = 'g'.repeat(5000)
  const r: SessionMessage[] = [
    readUse('a', { file_path: '/f' }),
    result('a', BIG),
    use('b', 'Grep'),
    result('b', g),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'c', tool: 'Read', input: { file_path: '/other' } }, { tool_use_id: 'd', tool: 'Grep', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'c', text: BIG, isError: false }, { tool_use_id: 'd', text: g, isError: false }] },
  ]
  const out = markDuplicates(reg([]), r, [{ id: 'c', text: BIG }, { id: 'd', text: g }])
  expect(out.tags.map(t => ('tool_use_id' in t.target ? `${t.target.tool_use_id}:${t.reason}` : ''))).toEqual(['a:duplicate', 'b:duplicate'])
})

test('AutoTag — R5 перезапис: an earlier review big becomes duplicate; stale and pin stay; an own tool\'s result is no duplicate', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/x' }), result('a', BIG), readUse('b', { file_path: '/y' }), result('b', BIG)]
  const res = [{ id: 'b', text: BIG }]
  const tagOf = (start: Tag) => markDuplicates(reg([start]), r, res).tags[0]
  expect(tagOf({ kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 })!.reason).toBe('duplicate')
  expect(tagOf({ kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 0 })!.reason).toBe('stale')
  expect(tagOf({ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 })!.kind).toBe('pin')
  const own: SessionMessage[] = [use('a', 'mcp__context-editor__context_list'), result('a', BIG), use('b', 'mcp__context-editor__context_list'), result('b', BIG)]
  expect(markDuplicates(reg([]), own, res).tags).toEqual([])
})

test('AutoTag — R5 рядок без результатів: R5 (b) is not built (the probe: a skill insertion is no conversation row); a large user row of another door changes nothing', async () => {
  const text = 'z'.repeat(6000)
  const r: SessionMessage[] = [{ role: 'user', text, toolUses: [] }, { role: 'assistant', text: 'ok', toolUses: [] }, { role: 'user', text, toolUses: [] }]
  const { io, log } = harness(okRead(reg([], { firstPromptPinned: true })), undefined, { rows: async () => r })
  await autoTag(io, fact({ door: 'attachment', origin: 'engine', size: 6000, text }))
  expect(log.tagWrites).toBe(0)
})

// ---- [SP_CTX_01_11] R4

test('MarkCall — R4 застаріле читання: Read f (review big), Read g, Edit f: the Read f pair becomes stale, g stays', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', BIG), readUse('b', { file_path: '/g' }), result('b', 'g'), { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'w', tool: 'Edit', input: { file_path: '/f' } }] }]
  const out = markStale(reg([{ kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 }], { turn: 3 }), r, '/f', 'w')
  expect(out.tags).toEqual([{ kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 3 }])
})

test('MarkCall — R4 не чіпає інших тегів: a pin or a disposable on the Read stays', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', BIG)]
  for (const t of [{ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 }, { kind: 'disposable', target: { tool_use_id: 'a' }, note: 'n', created_turn: 0 }] as Tag[]) {
    const start = reg([t])
    expect(markStale(start, r, '/f', 'w')).toBe(start)
  }
})

test('MarkCall — R4 відмова чи помилка, NotebookEdit: an Edit with an error follows up with nothing; NotebookEdit uses notebook_path; Read is a reread check', async () => {
  expect(callFollowUp('Edit', { file_path: '/f' }, true)).toBeUndefined()
  expect(callFollowUp('Edit', { file_path: '/f' }, false)).toEqual({ write: '/f' })
  expect(callFollowUp('Write', { file_path: '/f' }, false)).toEqual({ write: '/f' })
  expect(callFollowUp('NotebookEdit', { notebook_path: '/n.ipynb' }, false)).toEqual({ write: '/n.ipynb' })
  expect(callFollowUp('Read', { file_path: '/f' }, false)).toEqual({ read: '/f' })
  expect(callFollowUp('Read', { file_path: '/f' }, true)).toBeUndefined()
  expect(callFollowUp('Grep', { pattern: 'x' }, false)).toBeUndefined()
  const r: SessionMessage[] = [readUse('a', { file_path: '/n.ipynb' }), result('a', 'cells')]
  expect(markStale(reg([]), r, '/n.ipynb', 'w').tags[0]!.reason).toBe('stale')
})

test('MarkCall — R4 лише раніші читання: one response with Edit f then a parallel Read f: only the earlier Read of f is stale', async () => {
  const r: SessionMessage[] = [
    readUse('old', { file_path: '/f' }),
    result('old', 'v1'),
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'w', tool: 'Edit', input: { file_path: '/f' } },
        { tool_use_id: 'new', tool: 'Read', input: { file_path: '/f' } },
      ],
    },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'w', text: 'ok', isError: false }, { tool_use_id: 'new', text: 'v2', isError: false }] },
  ]
  expect(markStale(reg([]), r, '/f', 'w').tags.map(t => ('tool_use_id' in t.target ? t.target.tool_use_id : ''))).toEqual(['old'])
  // the write's row not written yet: every read counts as earlier
  expect(markStale(reg([]), r.slice(0, 2), '/f', 'w').tags.length).toBe(1)
})

// ---- [SP_CTX_02_14] RebindTags, phase 15

test('RebindTags — слот стану переписано: the state tag moves to the rewritten row (report.produced)', async () => {
  const before = rows15()
  const edits = prepare(before, [{ op: 'rewrite', index: 1, text: 'plan: step 2' }]).queued
  const made = { role: 'assistant' as const, text: '[context-editor] you rewrote this row (original: /s/1.json, open with Read): plan: step 2', toolUses: [] }
  const after = [before[0]!, made, ...before.slice(2)]
  const produced = [{ edit: 'rewrite #1', index: 1, fingerprint: fingerprint(made) }]
  const out = rebindTags(reg([{ kind: 'state', target: at15(1), created_turn: 0 }]), before, after, edits, edits, produced)
  expect(out.tags).toEqual([{ kind: 'state', target: { anchor: fingerprint(made), hint: 1 }, created_turn: 0 }])
  // without the produced entry the row is gone: the tag goes
  expect(rebindTags(reg([{ kind: 'state', target: at15(1), created_turn: 0 }]), before, after, edits, edits).tags).toEqual([])
})

test('RebindTags — діапазон: a summarize inside drops the range tag; a shift of 2 rows without edits inside moves both hints', async () => {
  const before = rows15()
  const range: Tag = { kind: 'disposable', target: { ...at15(8), toAnchor: fingerprint(before[10]!), toHint: 10 }, note: 'n', created_turn: 0 }
  const inside = prepare(before, [{ op: 'drop', tool_use_id: 'b' }]).queued
  expect(rebindTags(reg([range]), before, before.filter((_, i) => i !== 8 && i !== 9), inside, inside).tags).toEqual([])
  const outside = prepare(before, [{ op: 'drop', tool_use_id: 'a' }]).queued
  const after = before.filter((_, i) => i !== 2 && i !== 3)
  expect(rebindTags(reg([range]), before, after, outside, outside).tags[0]!.target).toEqual({ ...at15(8), hint: 6, toAnchor: fingerprint(before[10]!), toHint: 8 })
})

test('RebindTags — заміна діапазону в пакеті: the collapse of the range with its note in the batch drops the tag, applied or not', async () => {
  const before = rows15()
  const range: Tag = { kind: 'disposable', target: { ...at15(8), toAnchor: fingerprint(before[10]!), toHint: 10 }, note: 'N', created_turn: 0 }
  const batch = prepare(before, [{ op: 'collapse', from_index: 8, to_index: 10, summary: 'N' }]).queued
  expect(rebindTags(reg([range]), before, before, [], batch).tags).toEqual([])
})

// ---- [SP_CTX_02_13] QueueTagReplacements, phase 15

test('QueueTagReplacements — діапазон: a disposable range #8..#10 becomes collapse 8..10 with the note and anchors of both ends; freed counts the rows', async () => {
  const r = rows15()
  const range: Tag = { kind: 'disposable', target: { ...at15(8), toAnchor: fingerprint(r[10]!), toHint: 10 }, note: 'N', created_turn: 0 }
  const { io, log } = harness(okRead(reg([range])), undefined, { rows: async () => r })
  const out = await queueTagReplacements(io)
  expect(out.queued).toBe(1)
  expect(log.queue!.edits).toEqual([{ op: 'collapse', from_index: 8, to_index: 10, summary: 'N', anchors: [fingerprint(r[8]!), fingerprint(r[10]!)], via: 'tag' }])
  // 2 + 5 + 10 chars of the three rows less the note's one
  expect(out.freed).toBe('~4 tokens (approx.)')
  // the replacement is keyed: queued once
  expect((await queueTagReplacements(io)).queued).toBe(0)
})

test('QueueTagReplacements — слот стану в діапазоні: a state row inside the range refuses the collapse; the queue stays, the tag stays', async () => {
  const r = rows15()
  const range: Tag = { kind: 'disposable', target: { ...at15(8), toAnchor: fingerprint(r[10]!), toHint: 10 }, note: 'N', created_turn: 0 }
  const { io, log } = harness(okRead(reg([range, { kind: 'state', target: at15(10), created_turn: 0 }])), undefined, { rows: async () => r })
  expect((await queueTagReplacements(io)).queued).toBe(0)
  expect(log.queue).toBeUndefined()
})

test('AutoTag — R5 стиснута раніша пара: an earlier Read of the same range already summarized (isReplacementText: the text of phase 28 or one marked with MARK) is no duplicate', async () => {
  const other = 'y'.repeat(5000)
  const r: SessionMessage[] = [
    readUse('a_ce1x', { file_path: '/f', offset: 10, limit: 50 }),
    result('a_ce1x', '[context-editor] you read the full output here, then replaced it with your summary (original: /s/1.json, open with Read): f lines 10..60 hold KEY'),
    readUse('c_ce1x', { file_path: '/f', offset: 10, limit: 50 }),
    result('c_ce1x', `${SUMMARIZED} (original: /s/2.json, open with Read): f lines 10..60 hold KEY`),
    readUse('b', { file_path: '/f', offset: 10, limit: 50 }),
    result('b', other),
  ]
  const start = reg([])
  expect(markDuplicates(start, r, [{ id: 'b', text: other }])).toBe(start)
})

test('context_tag — disposable на слоті стану: a single disposable by index on the state row is BAD_TARGET; the state tag stays', async () => {
  const start = reg([{ kind: 'state', target: at15(1), created_turn: 0 }])
  const out = await tag15(start, [{ op: 'add', kind: 'disposable', index: 1, note: 'n' }])
  expect(out.text).toContain('(BAD_TARGET)')
  expect(out.tags).toEqual(start.tags)
  // another text row of the agent stays allowed
  expect((await tag15(start, [{ op: 'add', kind: 'disposable', index: 4, note: 'n' }])).tags.length).toBe(2)
})

test('MarkCall — R4 повторний запис: a pair already stale stays as it is; the registry is not rewritten', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', BIG)]
  const start = reg([{ kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 1 }], { turn: 5 })
  expect(markStale(start, r, '/f', 'w2')).toBe(start)
})

test('staleReads — запис реєстру: an unreadable registry is skipped; the same registry is not written; a changed one is written once', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', BIG)]
  const run = async (tags: Read<TagRegistry>, path: string) => {
    const h = harness(tags, undefined, { rows: async () => r })
    await staleReads(h.io, path, 'w')
    return h.log
  }
  // unreadable: neither the rows nor a write
  let rowsRead = 0
  const bad = harness(unreadableRead('bad json'), undefined, { rows: async () => (rowsRead++, r) })
  await staleReads(bad.io, '/f', 'w')
  expect(bad.log.tagWrites).toBe(0)
  expect(rowsRead).toBe(0)
  // markStale returns the same registry: no write
  expect((await run(okRead(reg([])), '/other')).tagWrites).toBe(0)
  expect((await run(okRead(reg([{ kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 0 }])), '/f')).tagWrites).toBe(0)
  // changed: one write with the stale review; a missing registry counts as empty
  for (const start of [okRead(reg([], { turn: 2 })), missingRead(reg([], { turn: 2 }))] as Read<TagRegistry>[]) {
    const log = await run(start, '/f')
    expect(log.tagWrites).toBe(1)
    expect(log.tags!.tags).toEqual([{ kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 2 }])
  }
})

// ---- [SP_CTX_02_11] [SP_CTX_02_04] thinking-only rows (audit PL_AUD_CTX_P3, CF-3, CF-4)

const think = (): SessionMessage => ({ role: 'assistant', text: '', toolUses: [] })

function thinkingRows(): SessionMessage[] {
  return [prompt('go'), think(), use('a', 'Read'), result('a', 'x'), reply('done'), think(), use('b', 'Grep'), result('b', 'y'), reply('end')]
}

test('context_tag — рядок лише з thinking: a pin, a disposable or a review on it alone is TARGET_NOT_FOUND; a remove finds no tag; a range may start there but not end there (BAD_RANGE)', async () => {
  const list = thinkingRows()
  for (const raw of [
    { op: 'add', kind: 'pin', index: 1 },
    { op: 'add', kind: 'disposable', index: 1, note: 'n' },
    { op: 'add', kind: 'review', index: 5 },
  ]) {
    const out = applyTagRequests(reg([]), list, [raw])
    expect(out.added).toBe(0)
    expect(out.rejected[0]!.code).toBe('TARGET_NOT_FOUND')
    expect(out.rejected[0]!.reason).toContain('cannot be tracked')
  }
  expect(applyTagRequests(reg([]), list, [{ op: 'remove', index: 1 }]).rejected[0]!.code).toBe('NO_TAG')
  expect(applyTagRequests(reg([]), list, [{ op: 'add', kind: 'disposable', index: 1, to: 4, note: 'n' }]).added).toBe(1)
  // TSTX-6: the last row of a range holds only thinking
  const end = applyTagRequests(reg([]), list, [{ op: 'add', kind: 'disposable', index: 4, to: 5, note: 'n' }])
  expect(end.rejected[0]!.code).toBe('BAD_RANGE')
  expect(end.rejected[0]!.reason).toContain('holds only thinking')
})

test('LocateSpan — діапазон з thinking-початком: rows shifted by 3 with another thinking row at the old index: the range is found from its last row, not at the old index', async () => {
  const list = thinkingRows()
  const tag = applyTagRequests(reg([]), list, [{ op: 'add', kind: 'disposable', index: 1, to: 4, note: 'n' }]).registry.tags[0]!
  const shifted = [prompt('earlier'), think(), reply('before'), ...list]
  // Locate alone would take #1 of `shifted`, another thinking row
  expect(resolveTarget(shifted, tag.target)).toEqual([4, 5, 6, 7])
  expect(rebindTags(reg([tag]), list, shifted, [], []).tags[0]!.target).toEqual({ anchor: fingerprint(think()), hint: 4, toAnchor: fingerprint(list[4]!), toHint: 7 })
  // the row the length points at is no thinking row: the range is not found
  expect(resolveTarget([prompt('earlier'), ...list.slice(2)], tag.target)).toBeUndefined()
})

// [SP_CTX_02_14] review round 37, W1, for tags (CF-4)
test('RebindTags — pin на паралельному виклику: a pin by index on the call row of b survives the summarize of a, whose response MergeCallRows joins into one row', async () => {
  const before = [prompt('p'), reply('reading'), use('a', 'Read'), use('b', 'Read'), result('a', 'x'), result('b', 'y'), reply('done')].map((r, i) => ({ ...r, handle: `h${i}` }))
  const pinned = applyTagRequests(reg([]), before, [{ op: 'add', kind: 'pin', index: 3 }, { op: 'add', kind: 'review', index: 6 }]).registry
  const edits = prepare(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }], undefined, pinnedTargets(before, pinned)).queued
  expect(edits.length).toBe(1)
  const out = applyEdits(before, edits, '/s/1.json')
  expect(out.report.applied).toEqual(['summarize a'])
  const k = out.rows.findIndex(r => r.toolUses.some(u => u.tool_use_id === 'b'))
  expect(out.rows[k]!.toolUses.length).toBe(2)
  const next = rebindTags(pinned, before, out.rows, edits, edits)
  expect(next.tags.map(t => t.kind)).toEqual(['pin', 'review'])
  expect(next.tags[0]!.target).toEqual({ anchor: fingerprint(out.rows[k]!), hint: k })
  expect(pinnedTargets(out.rows, next).rows.has(k)).toBe(true)
})

// ---- [SP_CTX_02_14] RebindTags of a range with a thinking-only first row (review of phase 3)

const hThink = (h: string): SessionMessage => ({ role: 'assistant', text: '', toolUses: [], handle: h })
const hSay = (t: string, h: string): SessionMessage => ({ role: 'assistant', text: t, toolUses: [], handle: h })
const hAsk = (t: string, h: string): SessionMessage => ({ role: 'user', text: t, toolUses: [], handle: h })
const hUse = (id: string, h: string): SessionMessage => ({ role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool: 'Read', input: {} }], handle: h })
const hRes = (id: string, h: string): SessionMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text: 'out ' + id, isError: false }], handle: h })

function spanRows(): SessionMessage[] {
  return [hAsk('go', 'h0'), hThink('h1'), hUse('x', 'h2'), hRes('x', 'h3'), hThink('h4'), hUse('y', 'h5'), hRes('y', 'h6'), hSay('end', 'h7'), hAsk('next', 'h8'), hThink('h9'), hUse('c', 'h10'), hRes('c', 'h11'), hSay('fin', 'h12')]
}

test('RebindTags — доставка всередині діапазону: a delivery row inserted inside an untouched range that starts on a thinking-only row; the range keeps its first row by identity and takes the delivery in', async () => {
  const before = spanRows()
  const added = applyTagRequests(reg([]), before, [{ op: 'add', kind: 'disposable', index: 1, to: 7, note: 'block' }])
  expect(added.added).toBe(1)
  const edits = prepare(before, [{ op: 'summarize', tool_use_id: 'c', summary: 'S' }]).queued
  const applied = applyEdits(before, edits, '/a.json')
  const item = { uuid: 'd1', anchor: ['x'], kind: 'person' as const, origin: 'composer', text: '<system-reminder>\nThe user sent a new message while you were working:\nhi\n</system-reminder>', cut: 0, media: 0, at: 1 }
  const after = dropOwnCallsCounted(insertDeliveries(before, applied.rows, [item], applied.renamed, false).rows).rows
  const delivery = after.findIndex(r => r.text.includes('hi'))
  const end = after.findIndex(r => r.text === 'end')
  // the delivery row stands inside the range, and the range's row count changed
  expect(delivery > 1 && delivery < end).toBe(true)
  expect(end).not.toBe(7)
  expect(after[1]).toBe(before[1])
  const rebound = rebindTags(added.registry, before, after, edits, edits).tags
  expect(rebound.length).toBe(1)
  expect(rebound[0]!.target).toEqual({ anchor: fingerprint(before[1]!), hint: 1, toAnchor: fingerprint(before[7]!), toHint: end })
})

test('RebindTags — перший рядок діапазону зник: the thinking-only first row is gone from the new rows; the range moves to its first row that survived, as a stage mark does', async () => {
  const before = spanRows()
  const tag = applyTagRequests(reg([]), before, [{ op: 'add', kind: 'disposable', index: 1, to: 7, note: 'block' }]).registry.tags[0]!
  const after = before.filter((_, i) => i !== 1).map(r => ({ ...r }))
  const rebound = rebindTags(reg([tag]), before, after, [], []).tags
  expect(rebound.length).toBe(1)
  expect(rebound[0]!.target).toEqual({ anchor: fingerprint(before[2]!), hint: 1, toAnchor: fingerprint(before[7]!), toHint: 6 })
  // nothing of the range before its last row survived: the tag goes
  const short = applyTagRequests(reg([]), before, [{ op: 'add', kind: 'disposable', index: 4, to: 7, note: 'n' }]).registry.tags[0]!
  expect(rebindTags(reg([short]), before, before.filter((_, i) => i < 4 || i > 6), [], []).tags).toEqual([])
})

// [SP_CTX_02_14] (review of phase 3, item 4)
test('RebindTags — два теги на одному злитому рядку: a review on call row b and a pin on call row c merge into one row: one tag stays, the pin; it guards the whole merged row, so b cannot be summarized now', async () => {
  const before = [hAsk('p', 'h0'), hSay('reading', 'h1'), hUse('a', 'h2'), hUse('b', 'h3'), hUse('c', 'h4'), hRes('a', 'h5'), hRes('b', 'h6'), hRes('c', 'h7'), hSay('done', 'h8')]
  const tagged = applyTagRequests(reg([]), before, [{ op: 'add', kind: 'review', index: 3 }, { op: 'add', kind: 'pin', index: 4 }]).registry
  const edits = prepare(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }], undefined, pinnedTargets(before, tagged)).queued
  const out = applyEdits(before, edits, '/s/1.json')
  const k = out.rows.findIndex(r => r.toolUses.some(u => u.tool_use_id === 'b'))
  expect(out.rows[k]!.toolUses.map(u => u.tool_use_id).slice(1)).toEqual(['b', 'c'])
  const next = rebindTags(tagged, before, out.rows, edits, edits)
  expect(next.tags.map(t => t.kind)).toEqual(['pin'])
  expect(next.tags[0]!.target).toEqual({ anchor: fingerprint(out.rows[k]!), hint: k })
  expect(prepare(out.rows, [{ op: 'summarize', tool_use_id: 'b', summary: 'B' }], undefined, pinnedTargets(out.rows, next)).errors[0]).toContain('target is pinned')
})

// [SP_CTX_02_04] (review of phase 3, item 5)
test('touchedBy і RebindTags — згортання з thinking-початком на зсунутих рядках: the collapse touches the shifted span only; a tag on the row before it stays, the tag of a pair inside goes', async () => {
  const list = thinkingRows()
  const edit = prepare(list, [{ op: 'collapse', from_index: 1, to_index: 4, summary: 'S' }]).queued
  const shifted = [prompt('earlier'), think(), reply('before'), ...list].map((r, i) => ({ ...r, handle: `s${i}` }))
  expect(touchedBy(shifted, edit[0]!)?.rows).toEqual([4, 5, 6, 7])
  const tagged = applyTagRequests(reg([]), shifted, [{ op: 'add', kind: 'review', index: 2 }, { op: 'add', kind: 'review', tool_use_id: 'a' }]).registry
  const out = applyEdits(shifted, edit, '/s/1.json')
  expect(out.report.applied).toEqual(['collapse #1..#4'])
  const next = rebindTags(tagged, shifted, out.rows, edit, edit)
  expect(next.tags.map(t => t.target)).toEqual([{ anchor: fingerprint(shifted[2]!), hint: 2 }])
})

// [SP_CTX_02_11] (review of phase 3, item 2)
test('context_tag — промпт людини з самих медіа: a pin by index on it and a range that ends on it are taken as before; only an assistant thinking-only row is refused', async () => {
  const media: SessionMessage = { role: 'user', text: '', toolUses: [] }
  const list = [reply('hi'), media, reply('seen')]
  expect(applyTagRequests(reg([]), list, [{ op: 'add', kind: 'pin', index: 1 }]).added).toBe(1)
  expect(applyTagRequests(reg([]), list, [{ op: 'add', kind: 'disposable', index: 0, to: 1, note: 'n' }]).added).toBe(1)
  expect(prepare(list, [{ op: 'collapse', from_index: 0, to_index: 1, summary: 's' }]).errors).toEqual([])
})

// ---- [SP_CTX_02_12] [SP_CTX_02_35] AppendRow: the session.append hook's body ([PL_AUD_CTX_P10], CF-19)

const ITEM: QueuedDelivery = { uuid: 'u1', anchor: ['a'], kind: 'person', origin: 'human', text: 'hi', cut: 0, media: 0, at: 1 }

function appender(over: Partial<AppendIO> = {}, item?: QueuedDelivery) {
  const calls: string[] = []
  const tagged: { facts: AppendFacts; copy: boolean }[] = []
  const io: AppendIO = {
    observe: () => (calls.push('observe'), item),
    storage: async () => (calls.push('storage'), '/s'),
    record: (at, i) => void calls.push(`record ${i.uuid}`),
    autoTag: (at, facts, copy) => void (calls.push('autoTag'), tagged.push({ facts, copy })),
    copied: new Set(),
    ...over,
  }
  const store = async () => (calls.push('store'), {})
  return { io, calls, tagged, store }
}

// a result the rules see: big (R2); `text` a small one
const resultRow = (ids: string[], text = 'x'.repeat(BIG_ROW), tool = 'Read') => ({
  door: 'tool-result',
  origin: { kind: 'tool', tool },
  message: { content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: text })) },
})

test('AppendRow — порядок: the anchor step and the folder come at the event, before the row is stored; the rules and the record after it', async () => {
  const h = appender({}, ITEM)
  const stored = await appendRow(h.io, resultRow(['a']), h.store)
  expect(stored).toEqual({})
  expect(h.calls).toEqual(['observe', 'storage', 'store', 'record u1', 'autoTag'])
  expect(h.tagged[0]!.copy).toBe(false)
  expect(h.tagged[0]!.facts.ids).toEqual(['a'])
})

test('AppendRow — a refused row records nothing and runs no rules', async () => {
  const h = appender({}, ITEM)
  const out = await appendRow(h.io, resultRow(['a']), async () => (h.calls.push('store'), { deny: 'no' }))
  expect(out).toEqual({ deny: 'no' })
  expect(h.calls).toEqual(['observe', 'storage', 'store'])
})

test('AppendRow — the rules see the doors prompt and tool-result of the main conversation only; nothing to do asks for no folder', async () => {
  const sub = appender()
  await appendRow(sub.io, { ...resultRow(['a']), agentId: 'x' }, sub.store)
  expect(sub.calls).toEqual(['observe', 'store'])
  const other = appender()
  await appendRow(other.io, { door: 'response', origin: { kind: 'model' }, message: { content: [] } }, other.store)
  expect(other.calls).toEqual(['observe', 'store'])
  // a delivery behind an anchor is recorded though no rule runs
  const delivery = appender({}, ITEM)
  await appendRow(delivery.io, { door: 'delivery', origin: { kind: 'host' }, message: { content: [] } }, delivery.store)
  expect(delivery.calls).toEqual(['observe', 'storage', 'store', 'record u1'])
})

test('AppendRow — a compaction copy: every result id in Copied; a failed anchor step records nothing and the row still stands', async () => {
  const copy = appender({ copied: new Set(['a', 'b']) })
  await appendRow(copy.io, resultRow(['a', 'b']), copy.store)
  expect(copy.tagged[0]!.copy).toBe(true)
  const fresh = appender({ copied: new Set(['a']) })
  await appendRow(fresh.io, resultRow(['a', 'c']), fresh.store)
  expect(fresh.tagged[0]!.copy).toBe(false)
  const broken = appender({
    observe: () => {
      throw new Error('bad event')
    },
  })
  expect(await appendRow(broken.io, resultRow(['a']), broken.store)).toEqual({})
  expect(broken.calls).toEqual(['storage', 'store', 'autoTag'])
})

test('AutoTagNeeded — без читання реєстру: a small result of a tool that is no search tool, a plugin row, a copy and a person\'s prompt (R1 is gone) need no rule; a big or search result and a big result text do', async () => {
  const small = fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['a'], size: 10, results: [{ id: 'a', text: '0123456789' }] })
  expect(autoTagNeeded(small)).toBe(false)
  expect(autoTagNeeded({ ...small, tool: 'Grep' })).toBe(true)
  expect(autoTagNeeded({ ...small, size: BIG_ROW })).toBe(true)
  expect(autoTagNeeded({ ...small, tool: 'mcp__context-editor__context_list', size: BIG_ROW })).toBe(false)
  expect(autoTagNeeded({ ...small, tool: undefined, results: [{ id: 'a', text: 'x'.repeat(BIG_ROW) }] })).toBe(true)
  expect(autoTagNeeded({ ...small, tool: 'Grep' }, true)).toBe(false)
  expect(autoTagNeeded(fact({ text: 'the task' }))).toBe(false)
  expect(autoTagNeeded(fact({ origin: 'plugin', text: 'the task' }))).toBe(false)
  expect(autoTagNeeded(fact({ door: 'attachment', origin: 'engine', size: 6000 }))).toBe(false)
})

test('AutoTag — малий результат не читає tags.json: neither the registry nor the rows are read, nothing is written; a big one reads the registry', async () => {
  const reads = { tags: 0, rows: 0 }
  const { io, log } = harness(empty(), undefined, {
    readTags: async () => (reads.tags++, empty()),
    rows: async () => (reads.rows++, []),
  })
  await autoTag(io, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['a'], size: 10, results: [{ id: 'a', text: '0123456789' }] }))
  expect(reads).toEqual({ tags: 0, rows: 0 })
  expect(log.tagWrites).toBe(0)
  await autoTag(io, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['a'], size: BIG_ROW, results: [{ id: 'a', text: 'x'.repeat(BIG_ROW) }] }))
  expect(reads.tags).toBe(1)
})

test('AppendRow — малий результат: no folder asked, no AutoTag queued on the registry chain; a delivery behind it is still recorded', async () => {
  const small = appender()
  await appendRow(small.io, resultRow(['a'], 'short'), small.store)
  expect(small.calls).toEqual(['observe', 'store'])
  const search = appender()
  await appendRow(search.io, resultRow(['a'], 'short', 'Grep'), search.store)
  expect(search.calls).toEqual(['observe', 'storage', 'store', 'autoTag'])
  const delivery = appender({}, ITEM)
  await appendRow(delivery.io, resultRow(['a'], 'short'), delivery.store)
  expect(delivery.calls).toEqual(['observe', 'storage', 'store', 'record u1'])
})

test('PinsFrom — an unreadable registry gives no pins; a readable one its pinned targets', async () => {
  const rows = [prompt('p'), use('a'), result('a')]
  expect(pinsFrom(unreadableRead('x'), rows)).toBe(NO_PINS)
  const r = reg([{ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 }])
  expect(pinsFrom(okRead(r), rows)).toEqual(pinnedTargets(rows, r))
  expect([...pinsFrom(okRead(r), rows).ids]).toEqual(['a'])
})

// ---- [SP_CTX_02_12] [SP_CTX_01_11] phase 31 (CF-52): a search tool's error is no search output

test('AutoTag — R3 помилка: a Grep error gets no tag; a Grep without one review search; a 5000-char Read error review big; of two Glob results only the one without an error', async () => {
  const errorRow = (ids: string[], text: string, tool: string, failed: string[]) =>
    appendFacts({
      door: 'tool-result',
      origin: { kind: 'tool', tool },
      message: { content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: text, ...(failed.includes(id) ? { is_error: true } : {}) })) },
    })
  const grepError = errorRow(['g'], 'Error: bad regex', 'Grep', ['g'])
  expect(grepError.results[0]!.isError).toBe(true)
  const none = harness(empty())
  await autoTag(none.io, grepError)
  expect(none.log.tagWrites).toBe(0)
  const ok = harness(empty())
  await autoTag(ok.io, errorRow(['g'], 'match list', 'Grep', []))
  expect(ok.log.tags!.tags.map(t => t.reason)).toEqual(['search'])
  const read = harness(empty())
  await autoTag(read.io, errorRow(['r'], BIG, 'Read', ['r']))
  expect(read.log.tags!.tags.map(t => t.reason)).toEqual(['big'])
  const two = harness(empty())
  await autoTag(two.io, errorRow(['x', 'y'], 'paths', 'Glob', ['x']))
  expect(two.log.tags!.tags).toEqual([{ kind: 'review', reason: 'search', target: { tool_use_id: 'y' }, ttl_turns: SEARCH_TTL, created_turn: 0 }])
})

test('AutoTagNeeded — помилка пошуку: a 200-char Grep error needs no rule (no wait for the registry chain); one without an error does', async () => {
  const grep = fact({ door: 'tool-result', origin: 'tool', tool: 'Grep', ids: ['g'], size: 200, results: [{ id: 'g', text: 'e'.repeat(200), isError: true }] })
  expect(autoTagNeeded(grep)).toBe(false)
  expect(autoTagNeeded({ ...grep, results: [{ id: 'g', text: 'e'.repeat(200) }] })).toBe(true)
})

// ---- [SP_CTX_02_18] [SP_CTX_DEC_31] PruneDeadTags and RegistryFull (phase 30, CF-34)

test('PruneDeadTags — чужа компактизація: the pin and review big of the gone pair a go; review search on b, the state slot on a gone row and a range whose ends stay remain', async () => {
  const r = rows()
  const kept = [r[0]!, r[4]!, r[5]!, r[6]!]
  const range = { anchor: fingerprint(r[4]!), hint: 4, toAnchor: fingerprint(r[6]!), toHint: 6 }
  const before = reg(
    [
      { kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 },
      { kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 },
      { kind: 'pin', target: anchorOf(3), created_turn: 0 },
      { kind: 'review', reason: 'search', target: { tool_use_id: 'b' }, ttl_turns: SEARCH_TTL, created_turn: 0 },
      { kind: 'state', target: anchorOf(3), created_turn: 0 },
      { kind: 'disposable', target: range, note: 'n', created_turn: 0 },
    ],
    { lastApply: { at: 1, tokensBefore: 9 }, turn: 4 },
  )
  const after = pruneDeadTags(before, r, kept)
  expect(after.tags.map(t => t.kind)).toEqual(['review', 'state', 'disposable'])
  expect(after.tags[0]!.reason).toBe('search')
  // the other fields stay; lastApply is the observer's to drop
  expect(after.lastApply).toEqual({ at: 1, tokensBefore: 9 })
  expect(after.turn).toBe(4)
})

test('PruneDeadTags — нічого прибирати: every target in the rows, or no tags: the same registry', async () => {
  const all = reg([
    { kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'pin', target: anchorOf(0), created_turn: 0 },
  ])
  expect(pruneDeadTags(all, rows(), rows())).toBe(all)
  const none = reg([])
  expect(pruneDeadTags(none, rows(), [])).toBe(none)
  // no input rows of the compaction: nothing is known gone
  expect(pruneDeadTags(all, [], [])).toBe(all)
})

// review fix: a mid-turn compaction returns the rows of its input only; a row
// appended after it started is no target the compaction took
test('PruneDeadTags — рядок після компактизації: a tag on a pair outside the compaction\'s input stays; one on a pair it took and left out goes', async () => {
  const r = rows()
  const input = r.slice(0, 3)
  const tags = reg([
    { kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', reason: 'search', target: { tool_use_id: 'b' }, ttl_turns: SEARCH_TTL, created_turn: 0 },
  ])
  const after = pruneDeadTags(tags, input, [r[0]!])
  expect(after.tags.map(t => t.reason)).toEqual(['search'])
})

test('RegistryFull: 1000 tags / 999 tags and a small file / 10 tags in a file above MAX_REGISTRY_BYTES − TAG_ROOM', async () => {
  const tag = (i: number, note = 'n'): Tag => ({ kind: 'disposable', target: { tool_use_id: `t${i}` }, note, created_turn: 0 })
  const full = reg(Array.from({ length: MAX_TAGS }, (_, i) => tag(i)))
  const at = registryFull(full)!
  expect(at.tags).toBe(1000)
  expect(tagsFullLine(at)).toBe(`Tags: the registry is full (1000 tags, ${at.kb} KB): automatic review tags have stopped; remove tags you no longer need with context_tag "remove"`)
  expect(registryFull(reg(Array.from({ length: MAX_TAGS - 1 }, (_, i) => tag(i))))).toBeUndefined()
  const heavy = reg(Array.from({ length: 10 }, (_, i) => tag(i, 'x'.repeat(Math.ceil((MAX_REGISTRY_BYTES - TAG_ROOM) / 10)))))
  expect(registryFull(heavy)).toEqual({ tags: 10, kb: Math.ceil(new TextEncoder().encode(JSON.stringify(heavy)).length / 1024) })
})

test('AutoTag — повний реєстр: 1000 tags; a Grep result and a 5000-char Read result add no tag, nothing is written', async () => {
  const full = reg(Array.from({ length: MAX_TAGS }, (_, i): Tag => ({ kind: 'pin', target: { tool_use_id: `t${i}` }, created_turn: 0 })), { firstPromptPinned: true })
  const { io, log } = harness(okRead(full))
  await autoTag(io, fact({ door: 'tool-result', origin: 'tool', tool: 'Grep', ids: ['b'], size: 10, results: [{ id: 'b', text: 'match list' }] }))
  await autoTag(io, fact({ door: 'tool-result', origin: 'tool', tool: 'Read', ids: ['a'], size: 5000, results: [{ id: 'a', text: BIG }] }))
  expect(log.tagWrites).toBe(0)
})

// ---- [SP_CTX_02_65] R6

const lines = (from: number, texts: string[]) => texts.map((t, i) => `${from + i}\t${t}`).join('\n')

test('SupersededRead — той самий діапазон, інший текст: a second Read of the file after a change marks the earlier pair superseded, replacing review big', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', lines(1, ['x', 'y'])), readUse('b', { file_path: '/f' }), result('b', lines(1, ['x', 'z']))]
  const out = markSuperseded(reg([{ kind: 'review', reason: 'big', target: { tool_use_id: 'a' }, created_turn: 0 }], { turn: 2 }), r, '/f', 'b', { file_path: '/f' }, lines(1, ['x', 'z']))
  expect(out.tags).toEqual([{ kind: 'review', reason: 'superseded', target: { tool_use_id: 'a' }, created_turn: 2 }])
  // the same text: nothing changed
  const start = reg([])
  expect(markSuperseded(start, r, '/f', 'b', { file_path: '/f' }, lines(1, ['x', 'y']))).toBe(start)
})

test('SupersededRead — інший діапазон, спільні рядки різні: lines 40–60 after a full read with line 50 changed: superseded', async () => {
  const full = lines(1, Array.from({ length: 100 }, (_, i) => `line ${i + 1}`))
  const part = lines(40, Array.from({ length: 21 }, (_, i) => (i + 40 === 50 ? 'changed' : `line ${i + 40}`)))
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', full), readUse('b', { file_path: '/f', offset: 40, limit: 21 }), result('b', part)]
  expect(markSuperseded(reg([]), r, '/f', 'b', { file_path: '/f', offset: 40, limit: 21 }, part).tags[0]!.reason).toBe('superseded')
  // the common lines equal: no tag
  const same = lines(40, Array.from({ length: 21 }, (_, i) => `line ${i + 40}`))
  expect(markSuperseded(reg([]), r, '/f', 'b', { file_path: '/f', offset: 40, limit: 21 }, same).tags).toEqual([])
})

test('SupersededRead — без спільних рядків: lines 1–10, then 200–210: no tag', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/f', limit: 10 }), result('a', lines(1, Array(10).fill('a'))), readUse('b', { file_path: '/f', offset: 200, limit: 11 })]
  const start = reg([])
  expect(markSuperseded(start, r, '/f', 'b', { file_path: '/f', offset: 200, limit: 11 }, lines(200, Array(11).fill('b')))).toBe(start)
  expect(changedRead(lines(1, ['a']), lines(1, ['a']), false)).toBe(false)
  expect(numberedLines('     7\tseven\nno number\n12\t')).toEqual(new Map([[7, 'seven'], [12, '']]))
})

test('SupersededRead — R6 не чіпає pin, disposable, state, stale: those tags stay; duplicate becomes superseded; an error, a compressed result or another path is skipped', async () => {
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', lines(1, ['x'])), readUse('b', { file_path: '/f' })]
  const after = lines(1, ['y'])
  for (const t of [
    { kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'disposable', target: { tool_use_id: 'a' }, note: 'n', created_turn: 0 },
    { kind: 'state', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', reason: 'stale', target: { tool_use_id: 'a' }, created_turn: 0 },
    { kind: 'review', reason: 'agent', target: { tool_use_id: 'a' }, created_turn: 0 },
  ] as Tag[]) {
    const start = reg([t])
    expect(markSuperseded(start, r, '/f', 'b', { file_path: '/f' }, after)).toBe(start)
  }
  expect(markSuperseded(reg([{ kind: 'review', reason: 'duplicate', target: { tool_use_id: 'a' }, created_turn: 0 }]), r, '/f', 'b', { file_path: '/f' }, after).tags[0]!.reason).toBe('superseded')
  const failed: SessionMessage[] = [readUse('a', { file_path: '/f' }), { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: true }] }, readUse('b', { file_path: '/f' })]
  expect(markSuperseded(reg([]), failed, '/f', 'b', { file_path: '/f' }, after).tags).toEqual([])
  const compressed: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', `${SUMMARIZED_OF}Read f`), readUse('b', { file_path: '/f' })]
  expect(markSuperseded(reg([]), compressed, '/f', 'b', { file_path: '/f' }, after).tags).toEqual([])
  expect(markSuperseded(reg([]), r, '/g', 'b', { file_path: '/g' }, after).tags).toEqual([])
})

test('SupersededRead — ReadPaths: the first read of a path only records it; supersededReads writes once on a change and not over an unreadable registry', async () => {
  const paths = new Set<string>()
  expect(seenRead(paths, '/f')).toBe(false)
  expect(seenRead(paths, '/f')).toBe(true)
  expect(seenRead(paths, '/g')).toBe(false)
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', lines(1, ['x'])), readUse('b', { file_path: '/f' })]
  const { io, log } = harness(okRead(reg([])), undefined, { rows: async () => r })
  await supersededReads(io, '/f', 'b', { file_path: '/f' }, lines(1, ['y']))
  expect(log.tags!.tags[0]!.reason).toBe('superseded')
  const bad = harness({ state: 'unreadable', reason: 'x' }, undefined, { rows: async () => r })
  await supersededReads(bad.io, '/f', 'b', { file_path: '/f' }, lines(1, ['y']))
  expect(bad.log.tagWrites).toBe(0)
})

test('Tag reason superseded parses; an unknown reason is unreadable', async () => {
  expect(parseRegistry(JSON.stringify(reg([{ kind: 'review', reason: 'superseded', target: { tool_use_id: 'a' }, created_turn: 0 }]))).state).toBe('ok')
  expect(parseRegistry(JSON.stringify(reg([{ kind: 'review', reason: 'outdated' as 'stale', target: { tool_use_id: 'a' }, created_turn: 0 }]))).state).toBe('unreadable')
})

test('SupersededRead — незмінений файл: the host\'s "File unchanged" stub, a reminder after the lines or an error output gives no tag; the same range losing a line does', async () => {
  const stub = 'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.'
  const first = lines(1, ['x', 'y'])
  const r: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', first), readUse('b', { file_path: '/f' })]
  const start = reg([])
  expect(markSuperseded(start, r, '/f', 'b', { file_path: '/f' }, stub)).toBe(start)
  expect(markSuperseded(start, r, '/f', 'b', { file_path: '/f' }, first + '\n\n<system-reminder>fresh</system-reminder>')).toBe(start)
  expect(changedRead(first, lines(1, ['x']), true)).toBe(true)
  expect(changedRead(first, lines(1, ['x']), false)).toBe(false)
  expect(changedRead(lines(1, ['x']), lines(2, ['x']), true)).toBe(true)
})

test('SupersededRead — порядок рядків: a Read after the current call, a parallel Read of the same path in its row, or a current call not found gives no tag', async () => {
  const before = lines(1, ['x'])
  const after = lines(1, ['y'])
  const later: SessionMessage[] = [readUse('b', { file_path: '/f' }), result('b', after), readUse('c', { file_path: '/f' }), result('c', before)]
  expect(markSuperseded(reg([]), later, '/f', 'b', { file_path: '/f' }, after).tags).toEqual([])
  const parallel: SessionMessage[] = [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: { file_path: '/f' } }, { tool_use_id: 'b', tool: 'Read', input: { file_path: '/f' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: before, isError: false }, { tool_use_id: 'b', text: after, isError: false }] },
  ]
  expect(markSuperseded(reg([]), parallel, '/f', 'b', { file_path: '/f' }, after).tags).toEqual([])
  const gone: SessionMessage[] = [readUse('a', { file_path: '/f' }), result('a', before)]
  expect(markSuperseded(reg([]), gone, '/f', 'b', { file_path: '/f' }, after).tags).toEqual([])
})
