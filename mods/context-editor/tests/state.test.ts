import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { handleCompaction } from '../hooks/compaction'
import { buildSeed, carryRegistries } from '../hooks/handoff'
import { applyEdits, fingerprint, MAX_TEXT, prepare, STATE_SLOT, type Pinned, type QueuedEdit } from '../hooks/edits'
import { EMPTY_QUEUE, parseQueue, queueEdits } from '../hooks/queue'
import { isReplacementText, STATE_REBUILT } from '../hooks/rows'
import {
  applyChanges,
  assemble,
  badItemFields,
  checkChanges,
  ITEMS_UNSAVED,
  MAX_STATE_ITEM,
  MAX_STATE_ITEMS,
  NO_ITEM,
  NO_ITEM_NOW,
  NO_STATE_SLOT,
  STATE_CONFLICT,
  STATE_GONE,
  STATE_ITEMS,
  TOO_MANY_ITEMS,
  type StateItem,
} from '../hooks/state'
import { EMPTY_REGISTRY, parseRegistry, pinnedTargets, rebindTags, type TagRegistry } from '../hooks/tags'
import { harness } from './compaction-fixtures'
import { okRead } from './row-fixtures'

// [SP_CTX_02_67] phase 44: the items of the state slot

const SLOT = 'Goal: ship phase 44\nNext: tests'

function chat(): SessionMessage[] {
  return [
    { role: 'user', text: 'implement phase 44', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: SLOT, toolUses: [], handle: 'h1' },
    { role: 'user', text: 'go on', toolUses: [], handle: 'h2' },
    { role: 'assistant', text: 'working on it', toolUses: [], handle: 'h3' },
  ]
}

function registry(items: StateItem[] = [], nextItem?: number, rows = chat()): TagRegistry {
  return {
    ...EMPTY_REGISTRY,
    turn: 7,
    tags: [{ kind: 'state', target: { anchor: fingerprint(rows[1]!), hint: 1 }, created_turn: 0 }],
    ...(items.length || nextItem ? { items, nextItem: nextItem ?? items.length + 1 } : {}),
  }
}

const item = (id: string, kind: StateItem['kind'], text: string, extra: Partial<StateItem> = {}): StateItem => ({ id, kind, text, turn: 1, ...extra })
const pins = (reg: TagRegistry, rows = chat()): Pinned => pinnedTargets(rows, reg)
const add = (kind: string, text: string) => ({ do: 'add', kind, text })

test('StateChange — форма: a known do with its fields; texts on one line; BAD_CHANGE names the field', () => {
  expect(checkChanges([add('plan', 'write\n  spec'), { do: 'mark', id: 'p1', as: 'outdated' }, { do: 'unmark', id: 'p1' }, { do: 'remove', id: 'p1' }, { do: 'set', id: 'g1', text: 'x' }])).toEqual([
    { do: 'add', kind: 'plan', text: 'write spec' },
    { do: 'mark', id: 'p1', as: 'outdated' },
    { do: 'unmark', id: 'p1' },
    { do: 'remove', id: 'p1' },
    { do: 'set', id: 'g1', text: 'x' },
  ])
  expect(checkChanges([])).toContain('changes must be a list')
  expect(checkChanges(Array.from({ length: MAX_STATE_ITEMS + 1 }, () => add('plan', 'x')))).toContain('changes must be a list')
  expect(checkChanges([{ do: 'drop', id: 'p1' }])).toContain('change 1: do must be')
  expect(checkChanges([add('task', 'x')])).toContain('change 1: kind must be')
  expect(checkChanges([add('plan', ' \n ')])).toBe('change 1: text is required')
  expect(checkChanges([add('plan', 'x'.repeat(MAX_STATE_ITEM + 1))])).toContain('too long')
  expect(checkChanges([{ do: 'mark', id: 'p1', as: 'wrong' }])).toContain('as must be')
  expect(checkChanges([{ do: 'remove' }])).toBe('change 1: id is required')
})

test('ApplyChanges і Assemble: ids from nextItem by kind, turn on every touched item, blocks in kind order with marks', () => {
  const out = applyChanges([item('g1', 'goal', 'ship')], 2, 9, [
    { do: 'add', kind: 'plan', text: 'write spec' },
    { do: 'add', kind: 'lesson', text: 'read the stub' },
    { do: 'mark', id: 'g1', as: 'harmful' },
  ])
  if ('missing' in out) throw new Error(out.missing)
  expect(out.nextItem).toBe(4)
  expect(out.items).toEqual([item('g1', 'goal', 'ship', { mark: 'harmful', turn: 9 }), item('p2', 'plan', 'write spec', { turn: 9 }), item('l3', 'lesson', 'read the stub', { turn: 9 })])
  expect(assemble(out.items)).toBe('Goal:\n- g1 (harmful): ship\nPlan:\n- p2: write spec\nLessons:\n- l3: read the stub')
  const back = applyChanges(out.items, out.nextItem, 10, [{ do: 'unmark', id: 'g1' }, { do: 'set', id: 'p2', text: 'spec written' }, { do: 'remove', id: 'l3' }])
  if ('missing' in back) throw new Error(back.missing)
  expect(back.items).toEqual([item('g1', 'goal', 'ship', { turn: 10 }), item('p2', 'plan', 'spec written', { turn: 10 })])
  expect(back.nextItem).toBe(4)
  expect(applyChanges(out.items, 4, 10, [{ do: 'set', id: 'p9', text: 'x' }])).toEqual({ missing: 'p9' })
  expect(assemble([])).toBe('(no items)')
})

test('StateEdit — додати пункт плану: the slot text is STATE_REBUILT, the archive line and the assembled items; items and nextItem 2', () => {
  const reg = registry()
  const { queued, errors } = prepare(chat(), [{ op: 'state', changes: [add('plan', 'write spec')] }], undefined, pins(reg))
  expect(errors).toEqual([])
  expect(queued[0]).toEqual({ op: 'state', changes: [{ do: 'add', kind: 'plan', text: 'write spec' }], index: 1, anchors: [fingerprint(chat()[1]!)] })
  const out = applyEdits(chat(), queued, '/a.json', undefined, undefined, { state: { items: [], nextItem: 1, turn: 7 } })
  expect(out.report.applied).toEqual(['state (add plan)'])
  expect(out.rows[1]!.text).toBe(`${STATE_REBUILT} (original: /a.json, open with Read):\nPlan:\n- p1: write spec`)
  expect(out.rows[1]!.handle).toBeUndefined()
  expect(isReplacementText(out.rows[1]!.text)).toBe(true)
  // the free text of the slot goes to the archive
  expect(out.report.originals).toEqual([{ edit: 'state (add plan)', rows: [chat()[1]!] }])
  expect(out.state).toEqual({ items: [item('p1', 'plan', 'write spec', { turn: 7 })], nextItem: 2 })
})

test('StateEdit — немає слота: NO_STATE_SLOT; a bad change is refused by its shape', () => {
  const { queued, errors } = prepare(chat(), [{ op: 'state', changes: [add('plan', 'x')] }, { op: 'state', changes: [{ do: 'x' }] }])
  expect(queued).toEqual([])
  expect(errors).toEqual([`state (add plan): ${NO_STATE_SLOT}`, 'edit 2: change 1: do must be "add", "set", "mark", "unmark" or "remove"'])
})

test('StateEdit — rewrite слота з пунктами: STATE_ITEMS; without items the rewrite queues as before', () => {
  const rewrite = { op: 'rewrite', index: 1, text: 'new state' }
  expect(prepare(chat(), [rewrite], undefined, pins(registry([item('p1', 'plan', 'x')]))).errors).toEqual([`rewrite #1: ${STATE_ITEMS}`])
  expect(prepare(chat(), [rewrite], undefined, pins(registry())).queued.length).toBe(1)
})

test('StateEdit — rewrite і state слота разом: the second is refused STATE_CONFLICT, in either order and against the queued batch', () => {
  const p = pins(registry())
  const state = { op: 'state', changes: [add('plan', 'x')] }
  const rewrite = { op: 'rewrite', index: 1, text: 'new state' }
  expect(prepare(chat(), [state, rewrite], undefined, p).errors).toEqual([`rewrite #1: ${STATE_CONFLICT('state')}`])
  expect(prepare(chat(), [rewrite, state], undefined, p).errors).toEqual([`state (add plan): ${STATE_CONFLICT('rewrite')}`])
  const pending = prepare(chat(), [rewrite], undefined, p).queued
  expect(prepare(chat(), [state], undefined, p, false, pending).errors).toEqual([`state (add plan): ${STATE_CONFLICT('rewrite')}`])
})

test('StateEdit — пункти: NO_ITEM for an id not there; the batch sees the items of an earlier state edit, not their ids; TOO_MANY_ITEMS; SLOT_TOO_LONG', () => {
  const p = pins(registry([item('p1', 'plan', 'x')]))
  expect(prepare(chat(), [{ op: 'state', changes: [{ do: 'set', id: 'p2', text: 'y' }] }], undefined, p).errors).toEqual([`state (set p2): ${NO_ITEM('p2')}`])
  const two = prepare(chat(), [{ op: 'state', changes: [{ do: 'remove', id: 'p1' }] }, { op: 'state', changes: [{ do: 'set', id: 'p1', text: 'y' }] }], undefined, p)
  expect(two.errors).toEqual([`state (set p1): ${NO_ITEM('p1')}`])
  const many = Array.from({ length: MAX_STATE_ITEMS }, () => add('done', 'step'))
  expect(prepare(chat(), [{ op: 'state', changes: many }], undefined, p).errors).toEqual([`state (${many.map(() => 'add done').join(', ')}): ${TOO_MANY_ITEMS}`])
  const long = Array.from({ length: 20 }, () => add('done', 'y'.repeat(MAX_STATE_ITEM)))
  expect(prepare(chat(), [{ op: 'state', changes: long }], undefined, p).errors[0]).toContain('the assembled slot would be too long')
  expect(MAX_TEXT).toBe(8000)
})

test('StateEdit — дві правки state: one rebuild of the slot, both applied, changes in order', () => {
  const reg = registry([item('g1', 'goal', 'ship')], 2)
  const { queued } = prepare(chat(), [{ op: 'state', changes: [add('plan', 'a')] }, { op: 'state', changes: [{ do: 'set', id: 'g1', text: 'ship it' }, add('next', 'b')] }], undefined, pins(reg))
  expect(queued.length).toBe(2)
  const out = applyEdits(chat(), queued, '/a.json', undefined, undefined, { state: { items: reg.items!, nextItem: 2, turn: 8 } })
  expect(out.report.applied).toEqual(['state (add plan)', 'state (set g1, add next)'])
  expect(out.report.originals.length).toBe(1)
  expect(out.rows[1]!.text.endsWith(':\nGoal:\n- g1: ship it\nPlan:\n- p2: a\nNext:\n- n3: b')).toBe(true)
  expect(out.state!.nextItem).toBe(4)
})

test('StateEdit — слот зник і id зник до застосування: every state edit fails, no rebuild, items unchanged', () => {
  const { queued } = prepare(chat(), [{ op: 'state', changes: [{ do: 'remove', id: 'p1' }] }, { op: 'state', changes: [add('plan', 'x')] }], undefined, pins(registry([item('p1', 'plan', 'x')])))
  // unstamped: no slot row to rebuild
  const gone = applyEdits(chat(), queued.map(e => (e.op === 'state' ? { op: 'state', changes: e.changes } : e) as QueuedEdit), '/a.json')
  expect(gone.report.failed).toEqual([`state (remove p1): ${STATE_GONE}`, `state (add plan): ${STATE_GONE}`])
  expect(gone.state).toBeUndefined()
  const now = applyEdits(chat(), queued, '/a.json', undefined, undefined, { state: { items: [], nextItem: 2, turn: 8 } })
  expect(now.report.failed).toEqual([`state (remove p1): ${NO_ITEM_NOW('p1')}`, `state (add plan): ${NO_ITEM_NOW('p1')}`])
  expect(now.report.applied).toEqual([])
  expect(now.rows[1]!.text).toBe(SLOT)
})

test('ScreenPinned і STATE_SLOT: a collapse over the slot is still refused; the state op on it passes', () => {
  const p = pins(registry())
  const out = prepare(chat(), [{ op: 'collapse', from_index: 1, to_index: 2, summary: 's' }], undefined, p)
  expect(out.errors).toEqual([`collapse #1..#2: ${STATE_SLOT}`])
  expect(STATE_SLOT).toContain('or by the state op once it has items')
})

test('RebindTags — слот стану: the state tag follows the row the state edit rebuilt', () => {
  const reg = registry()
  const { queued } = prepare(chat(), [{ op: 'state', changes: [add('plan', 'a')] }], undefined, pins(reg))
  const out = applyEdits(chat(), queued, '/a.json')
  const next = rebindTags(reg, chat(), out.rows, queued, queued, out.report.produced)
  expect(next.tags).toEqual([{ kind: 'state', target: { anchor: fingerprint(out.rows[1]!), hint: 1 }, created_turn: 0 }])
})

test('HandleCompaction — слот стану: the registry gets the items and nextItem, the slot is the assembled text; a failed registry write gives ITEMS_UNSAVED', async () => {
  const reg = registry([item('g1', 'goal', 'ship')], 2)
  const edits = prepare(chat(), [{ op: 'state', changes: [add('plan', 'write spec')] }], undefined, pins(reg)).queued
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits }), { readApi: async () => [] }, okRead(reg))
  const out = await handleCompaction(io, chat())
  if (!('messages' in out)) throw new Error(out.skip)
  const slot = out.messages.find(r => r.text.startsWith(STATE_REBUILT))!
  expect(slot.text).toBe(`${STATE_REBUILT} (original: /s/1000.json, open with Read):\nGoal:\n- g1: ship\nPlan:\n- p2: write spec`)
  expect(written.tags!.items).toEqual([item('g1', 'goal', 'ship'), item('p2', 'plan', 'write spec', { turn: 7 })])
  expect(written.tags!.nextItem).toBe(3)
  expect(written.tags!.tags[0]!.target).toEqual({ anchor: fingerprint(slot), hint: out.messages.indexOf(slot) })
  expect(written.queue!.report).toContain('applied 1 edit(s): state (add plan)')

  const failing = harness(okRead({ ...EMPTY_QUEUE, edits }), {
    readApi: async () => [],
    writeTags: async () => {
      throw new Error('disk full')
    },
  }, okRead(reg))
  const kept = await handleCompaction(failing.io, chat())
  if (!('messages' in kept)) throw new Error(kept.skip)
  expect(failing.written.queue!.report).toContain(ITEMS_UNSAVED('Error: disk full'))
})

test('HandleCompaction — тег state перенесено: a state edit queued on the old slot rebuilds the row the tag names at the apply', async () => {
  const rows = chat()
  const edits = prepare(rows, [{ op: 'state', changes: [add('plan', 'x')] }], undefined, pins(registry())).queued
  const moved: TagRegistry = { ...registry(), tags: [{ kind: 'state', target: { anchor: fingerprint(rows[3]!), hint: 3 }, created_turn: 1 }] }
  const { io } = harness(okRead({ ...EMPTY_QUEUE, edits }), { readApi: async () => [] }, okRead(moved))
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  expect(out.messages[1]!.text).toBe(SLOT)
  expect(out.messages[3]!.text.startsWith(STATE_REBUILT)).toBe(true)
})

test('Реєстр і черга — розбір: items and nextItem parse; a wrong item, a duplicate id or an id at nextItem is unreadable; a queued state edit parses', () => {
  const reg = registry([item('p1', 'plan', 'x')], 2)
  const ok = parseRegistry(JSON.stringify(reg))
  expect(ok.state === 'ok' && ok.value.items).toEqual(reg.items)
  expect(parseRegistry(JSON.stringify({ ...reg, items: [{ ...item('p1', 'plan', 'x'), kind: 'goal' }] })).state).toBe('unreadable')
  expect(badItemFields([item('p1', 'plan', 'x'), item('p1', 'plan', 'y')], 3)).toBe('items')
  expect(badItemFields([item('p2', 'plan', 'x')], 2)).toBe('nextItem')
  expect(badItemFields(undefined, undefined)).toBe(false)
  const queued = prepare(chat(), [{ op: 'state', changes: [add('plan', 'x')] }], undefined, pins(registry())).queued
  const q = parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: queued }))
  expect(q.state === 'ok' && q.value.edits).toEqual(queued)
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [{ ...queued[0], index: 'x' }] })).state).toBe('unreadable')
})

test('QueueEdits — state: the queued batch counts; a state edit after a queued rewrite of the slot is refused', () => {
  const p = pins(registry())
  const first = queueEdits({ ...EMPTY_QUEUE }, chat(), { edits: [{ op: 'rewrite', index: 1, text: 'free' }] }, p)
  if ('deny' in first) throw new Error(first.deny)
  const second = queueEdits(first.queue, chat(), { edits: [{ op: 'state', changes: [add('plan', 'x')] }] }, p)
  if ('deny' in second) throw new Error(second.deny)
  expect(second.queued).toBe(0)
  expect(second.errors).toEqual([`state (add plan): ${STATE_CONFLICT('rewrite')}`])
})

test('StateEdit — межі при застосуванні: a queue changed outside the tools past MAX_STATE_ITEMS, or a slot past MAX_TEXT, fails every state edit', () => {
  const p = pins(registry())
  const many = (n: number) => ({ op: 'state', changes: Array.from({ length: n }, () => add('done', 'step')) })
  const a = prepare(chat(), [many(30)], undefined, p).queued
  const b = prepare(chat(), [many(30)], undefined, p).queued
  const out = applyEdits(chat(), [...a, ...b], '/a.json')
  expect(out.report.applied).toEqual([])
  expect(out.report.failed.every(f => f.endsWith(TOO_MANY_ITEMS))).toBe(true)
  const long = Array.from({ length: 16 }, () => item('d1', 'done', 'z'.repeat(MAX_STATE_ITEM))).map((x, k) => ({ ...x, id: `d${k + 1}` }))
  const edit = prepare(chat(), [{ op: 'state', changes: [add('done', 'more')] }], undefined, p).queued
  const tooLong = applyEdits(chat(), edit, '/a.json', undefined, undefined, { state: { items: long, nextItem: 17, turn: 1 } })
  expect(tooLong.report.failed[0]).toContain('the assembled slot would be too long')
  expect(tooLong.rows[1]!.text).toBe(SLOT)
})

test('HandleCompaction — тег state перенесено: the registry tag follows the rebuilt row', async () => {
  const rows = chat()
  const edits = prepare(rows, [{ op: 'state', changes: [add('plan', 'x')] }], undefined, pins(registry())).queued
  const moved: TagRegistry = { ...registry(), tags: [{ kind: 'state', target: { anchor: fingerprint(rows[3]!), hint: 3 }, created_turn: 1 }] }
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits }), { readApi: async () => [] }, okRead(moved))
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  const slot = out.messages.findIndex(r => r.text.startsWith(STATE_REBUILT))
  expect(written.tags!.tags).toEqual([{ kind: 'state', target: { anchor: fingerprint(out.messages[slot]!), hint: slot }, created_turn: 1 }])
})

test('BuildSeed і CarryRegistries — пункти: the seed rebuilds the slot the tag names now, and the carried registry gets the items and the tag on the rebuilt row', async () => {
  const rows = chat()
  const edits = prepare(rows, [{ op: 'state', changes: [add('plan', 'x')] }], undefined, pins(registry())).queued
  const moved: TagRegistry = { ...registry(), tags: [{ kind: 'state', target: { anchor: fingerprint(rows[3]!), hint: 3 }, created_turn: 1 }] }
  const out = await buildSeed({ transcript: rows, rows, api: [], edits, tags: okRead(moved), folder: '/f', archive: '/s/old/1.json', writeMedia: async () => true })
  if ('refuse' in out) throw new Error(out.reason)
  const slot = out.rows.findIndex(r => r.text.startsWith(STATE_REBUILT))
  expect(slot).toBe(3)
  expect(out.items).toEqual({ items: [item('p1', 'plan', 'x', { turn: 7 })], nextItem: 2 })
  let carried: TagRegistry | undefined
  const io = {
    carryTags: async (_f: string, _t: string, change: (reg: TagRegistry) => TagRegistry) => ((carried = change(moved)), 'carried' as const),
    carryAliases: async () => 'missing' as const,
  }
  await carryRegistries(io, { ...out, edits: out.batch }, '/old', '/new')
  expect(carried!.items).toEqual(out.items!.items)
  expect(carried!.nextItem).toBe(2)
  expect(carried!.tags).toEqual([{ kind: 'state', target: { anchor: fingerprint(out.rows[slot]!), hint: slot }, created_turn: 1 }])
})
