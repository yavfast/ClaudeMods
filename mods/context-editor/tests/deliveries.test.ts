import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  cutDelivery,
  deliveryKind,
  deliveryWords,
  DELIVERY_FRAMES,
  insertDeliveries,
  MAX_DELIVERIES,
  MAX_DELIVERY_TEXT,
  newAnchorMemory,
  observeAppend,
  parseDeliveries,
  personDelivered,
  pruneDeliveries,
  recordDelivery,
  trimDeliveries,
  type Deliveries,
  type DeliveryEvent,
  type QueuedDelivery,
} from '../hooks/deliveries'
import { MAX_QUEUE_BYTES } from '../hooks/queue'
import { renewOf, updateOf, type Read } from '../hooks/store'

import { AGENT_TEXT, PERSON_TEXT, TASK_TEXT } from './delivery-fixtures'
import { memStore, result, use, missingRead, okRead, unreadableRead } from './row-fixtures'

function event(door: string, extra: Partial<DeliveryEvent> = {}, content: DeliveryEvent['message']['content'] = []): DeliveryEvent {
  return { door, uuid: `u-${door}`, origin: { kind: 'tool' }, message: { type: 'user', content }, ...extra }
}
function resultEvent(...ids: string[]): DeliveryEvent {
  return event('tool-result', {}, ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: 'x' })))
}
function deliveryEvent(text: string, uuid = 'd1', more: { type: string; [k: string]: unknown }[] = []): DeliveryEvent {
  return { door: 'delivery', uuid, origin: { kind: 'unclassified' }, message: { type: 'attachment', name: 'queued_command', content: [{ type: 'text', text }, ...more] } }
}

function item(uuid: string, anchor: string[], text = PERSON_TEXT, kind: QueuedDelivery['kind'] = 'person'): QueuedDelivery {
  return { uuid, anchor, kind, origin: 'unclassified', text, cut: 0, media: 0, at: 1 }
}

// The deliveries' file behind a real Store: `renew` for RecordDelivery, `update` for PruneDeliveries.
function fakeIO(start: Read<Deliveries>) {
  const { store, log } = memStore<Deliveries>(start, () => ({ items: [] }), parseDeliveries)
  return { renew: renewOf(store), update: updateOf(store), log }
}

// ---- [SP_CTX_01_22] DeliveryKind

test('DeliveryKind — рамки: person, agent (with attributes), task, another reminder, no frame', async () => {
  expect(deliveryKind(PERSON_TEXT)).toBe('person')
  expect(deliveryKind(AGENT_TEXT)).toBe('agent')
  expect(deliveryKind(TASK_TEXT)).toBe('task')
  expect(deliveryKind('<system-reminder>\nSomething else\n</system-reminder>')).toBe('other')
  expect(deliveryKind(`${DELIVERY_FRAMES.person}\nhi`)).toBe('other')
  expect(deliveryWords(PERSON_TEXT)).toBe('Remember PELICAN')
  expect(deliveryWords(AGENT_TEXT)).toBe('')
  expect(deliveryWords('plain prompt')).toBeUndefined()
})

// ---- [SP_CTX_02_35] RecordDelivery

test('RecordDelivery — якір — попередній результат: the delivery takes the result ids of the tool-result row before it', async () => {
  const mem = newAnchorMemory()
  expect(observeAppend(mem, resultEvent('a', 'b'), 5)).toBeUndefined()
  const got = observeAppend(mem, deliveryEvent(PERSON_TEXT), 7)!
  expect(got).toEqual({ uuid: 'd1', anchor: ['a', 'b'], kind: 'person', origin: 'unclassified', text: PERSON_TEXT, cut: 0, media: 0, at: 7 })
})

test('RecordDelivery — ланцюжок доставок: two deliveries after one result share its anchor, in order', async () => {
  const mem = newAnchorMemory()
  observeAppend(mem, resultEvent('a'), 1)
  // another door (a note) does not move the anchor
  observeAppend(mem, event('note'), 1)
  const d1 = observeAppend(mem, deliveryEvent(AGENT_TEXT, 'd1'), 2)!
  const d2 = observeAppend(mem, deliveryEvent(TASK_TEXT, 'd2'), 3)!
  expect([d1.anchor, d2.anchor]).toEqual([['a'], ['a']])
  expect([d1.kind, d2.kind]).toEqual(['agent', 'task'])
})

test('RecordDelivery — без якоря: after a prompt or a response row, and before any result, nothing is recorded', async () => {
  const mem = newAnchorMemory()
  expect(observeAppend(mem, deliveryEvent(PERSON_TEXT), 1)).toBeUndefined()
  observeAppend(mem, resultEvent('a'), 1)
  observeAppend(mem, event('prompt'), 1)
  expect(observeAppend(mem, deliveryEvent(PERSON_TEXT), 1)).toBeUndefined()
  observeAppend(mem, resultEvent('a'), 1)
  observeAppend(mem, event('response'), 1)
  expect(observeAppend(mem, deliveryEvent(PERSON_TEXT), 1)).toBeUndefined()
  // an attachment of another name is no delivery
  observeAppend(mem, resultEvent('a'), 1)
  expect(observeAppend(mem, { ...deliveryEvent(PERSON_TEXT), message: { type: 'attachment', name: 'total_tokens_reminder', content: [{ type: 'text', text: 'x' }] } }, 1)).toBeUndefined()
})

test('RecordDelivery — субагент: events of a subagent change neither the anchor nor the record', async () => {
  const mem = newAnchorMemory()
  observeAppend(mem, resultEvent('a'), 1)
  observeAppend(mem, { ...resultEvent('s'), agentId: 'sub' }, 1)
  expect(observeAppend(mem, { ...deliveryEvent(PERSON_TEXT), agentId: 'sub' }, 1)).toBeUndefined()
  expect(observeAppend(mem, deliveryEvent(PERSON_TEXT), 1)!.anchor).toEqual(['a'])
})

test('RecordDelivery — копія stream-json: the same text behind a copy of the same anchor is no new item', async () => {
  const { renew, log } = fakeIO(okRead({ items: [item('d1', ['a'])] }))
  await recordDelivery(renew, item('d1-copy', ['a']), MAX_QUEUE_BYTES)
  expect(log.writes).toBe(0)
  await recordDelivery(renew, item('d2', ['b']), MAX_QUEUE_BYTES)
  expect(log.file.state === 'ok' && log.file.value.items.map(x => x.uuid)).toEqual(['d1', 'd2'])
})

test('RecordDelivery — межі: a long text is cut, the oldest item goes past the caps, an unreadable file is moved aside', async () => {
  const mem = newAnchorMemory()
  observeAppend(mem, resultEvent('a'), 1)
  const long = observeAppend(mem, deliveryEvent('y'.repeat(50_000), 'd', [{ type: 'image' }]), 1)!
  expect(long.cut).toBe(10_000)
  expect(long.media).toBe(1)
  expect(long.text.startsWith('y'.repeat(MAX_DELIVERY_TEXT))).toBe(true)
  expect(long.text.endsWith('… [context-editor: 10000 chars cut]')).toBe(true)
  expect(parseDeliveries(JSON.stringify({ items: [long] })).state).toBe('ok')

  const full = Array.from({ length: MAX_DELIVERIES }, (_, k) => item(`d${k}`, [`a${k}`], `text ${k}`))
  const a = fakeIO(okRead({ items: full }))
  await recordDelivery(a.renew, item('new', ['z'], 'new text'), MAX_QUEUE_BYTES)
  const items = a.log.file.state === 'ok' ? a.log.file.value.items : []
  expect(items.length).toBe(MAX_DELIVERIES)
  expect(items[0]!.uuid).toBe('d1')
  expect(items.at(-1)!.uuid).toBe('new')
  // the byte cap drops the oldest too
  const b = fakeIO(okRead({ items: [item('old', ['o'], 'o'.repeat(500))] }))
  await recordDelivery(b.renew, item('new', ['n'], 'n'.repeat(500)), 800)
  expect(b.log.file.state === 'ok' && b.log.file.value.items.map(x => x.uuid)).toEqual(['new'])

  const c = fakeIO(unreadableRead('not JSON'))
  await recordDelivery(c.renew, item('d', ['a']), MAX_QUEUE_BYTES)
  expect(c.log.quarantined).toBe(1)
  expect(c.log.file.state === 'ok' && c.log.file.value.items.length).toBe(1)
  // [PL_AUD_CTX_P7] a file that cannot be moved aside is never overwritten
  const stuck = fakeIO(unreadableRead('not JSON'))
  stuck.log.stuck = true
  await recordDelivery(stuck.renew, item('d', ['a']), MAX_QUEUE_BYTES)
  expect(stuck.log.writes).toBe(0)
  expect(stuck.log.file.state).toBe('unreadable')
  expect(parseDeliveries('{"items":[{"uuid":1}]}').state).toBe('unreadable')
  expect(parseDeliveries('[]').state).toBe('unreadable')
})

test('PruneDeliveries — only the done items go; items recorded meanwhile stay; an unreadable file is left alone', async () => {
  const { update, log } = fakeIO(okRead({ items: [item('d1', ['a']), item('d2', ['b']), item('d3', ['c'])] }))
  await pruneDeliveries(update, new Set(['d1']))
  expect(log.file.state === 'ok' && log.file.value.items.map(x => x.uuid)).toEqual(['d2', 'd3'])
  const bad = fakeIO(unreadableRead('x'))
  await pruneDeliveries(bad.update, new Set(['d1']))
  expect(bad.log.writes).toBe(0)
})

// ---- [SP_CTX_02_36] InsertDeliveries

const prompt: SessionMessage = { role: 'user', text: 'task', toolUses: [], handle: 'h0' }

test('InsertDeliveries — незмінений якір перезібрано: a user row with the text right after the rebuilt anchor row', async () => {
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2'), use('b', 'Read', 'h3'), result('b', undefined, 'h4')]
  const rows = [prompt, use('a'), result('a'), use('b'), result('b')]
  const out = insertDeliveries(before, rows, [item('d1', ['a'])], new Map(), false)
  expect(out.rows.length).toBe(6)
  expect(out.rows[3]).toEqual({ role: 'user', text: PERSON_TEXT, toolUses: [] })
  expect(out.counts).toEqual({ inserted: 1, removed: 0 })
  expect([...out.done]).toEqual(['d1'])
  expect(out.added).toBe(PERSON_TEXT.length)
})

test('InsertDeliveries — якір з handle: the host carries the attachment; no insert, the item stays', async () => {
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2')]
  const out = insertDeliveries(before, before, [item('d1', ['a'])], new Map(), false)
  expect(out.rows.length).toBe(3)
  expect(out.counts).toEqual({ inserted: 0, removed: 0 })
  expect(out.done.size).toBe(0)
})

test('InsertDeliveries — summarize якоря: the delivery follows the result row under its fresh id', async () => {
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2')]
  const rows = [prompt, use('a_ce1'), result('a_ce1')]
  const out = insertDeliveries(before, rows, [item('d1', ['a'])], new Map([['a', 'a_ce1']]), false)
  expect(out.rows[3]!.text).toBe(PERSON_TEXT)
  expect(out.counts.inserted).toBe(1)
})

test('InsertDeliveries — drop і collapse якоря: the delivery goes with its anchor; removed counts it', async () => {
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2'), use('b', 'Read', 'h3'), result('b', undefined, 'h4')]
  const dropped = [prompt, use('b'), result('b')]
  const out = insertDeliveries(before, dropped, [item('d1', ['a'])], new Map(), false)
  expect(out.rows).toEqual(dropped)
  expect(out.counts).toEqual({ inserted: 0, removed: 1 })
  expect([...out.done]).toEqual(['d1'])
})

test('InsertDeliveries — уже рядок / якір зник: no insert, nothing removed, the item is done', async () => {
  const already: SessionMessage = { role: 'user', text: PERSON_TEXT, toolUses: [], handle: 'h3' }
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2'), already]
  const rows = [prompt, use('a'), result('a'), already]
  const out = insertDeliveries(before, rows, [item('d1', ['a']), item('d2', ['gone'], 'other text')], new Map(), false)
  expect(out.rows).toEqual(rows)
  expect(out.counts).toEqual({ inserted: 0, removed: 0 })
  expect([...out.done].sort()).toEqual(['d1', 'd2'])
})

test('InsertDeliveries — дві доставки за одним якорем: both right after the anchor, in file order', async () => {
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2'), use('b', 'Read', 'h3'), result('b', undefined, 'h4')]
  const rows = [prompt, use('a'), result('a'), use('b'), result('b')]
  const out = insertDeliveries(before, rows, [item('d1', ['a'], AGENT_TEXT, 'agent'), item('d2', ['a'], TASK_TEXT, 'task')], new Map(), false)
  expect(out.rows.map(r => r.text)).toEqual(['task', '', '', AGENT_TEXT, TASK_TEXT, '', ''])
})

test('InsertDeliveries — засів: allRebuilt inserts behind an anchor that had a handle', async () => {
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2')]
  const out = insertDeliveries(before, before, [item('d1', ['a'])], new Map(), true)
  expect(out.rows[3]!.text).toBe(PERSON_TEXT)
  expect(out.counts.inserted).toBe(1)
})

test('InsertDeliveries — однаковий текст за різними якорями: the same words after two results are two deliveries; a later apply inserts the one not yet a row', async () => {
  const before = [prompt, use('a', 'Read', 'h1'), result('a', undefined, 'h2'), use('b', 'Read', 'h3'), result('b', undefined, 'h4')]
  const out = insertDeliveries(before, before, [item('d1', ['a']), item('d2', ['b'])], new Map(), true)
  expect(out.counts).toEqual({ inserted: 2, removed: 0 })
  expect(out.rows.map(r => r.text)).toEqual(['task', '', '', PERSON_TEXT, '', '', PERSON_TEXT])
  // a later apply: d1 is already a row right after a; d2 (same text) behind b is not
  const row: SessionMessage = { role: 'user', text: PERSON_TEXT, toolUses: [], handle: 'h5' }
  const later = [prompt, use('a'), result('a'), row, use('b'), result('b')]
  const again = insertDeliveries(later, later, [item('d1', ['a']), item('d2', ['b'])], new Map(), false)
  expect(again.counts).toEqual({ inserted: 1, removed: 0 })
  expect(again.rows.at(-1)!.text).toBe(PERSON_TEXT)
  expect([...again.done].sort()).toEqual(['d1', 'd2'])
})

test('InsertDeliveries — рядок з handle, що піде: a row kept with its handle that DropOwnCalls removes later gets the delivery', async () => {
  const before = [prompt, use('z', 'Read', 'h1'), result('z', undefined, 'h2')]
  const kept = insertDeliveries(before, before, [item('d1', ['z'])], new Map(), false)
  expect(kept.counts.inserted).toBe(0)
  const goes = insertDeliveries(before, before, [item('d1', ['z'])], new Map(), false, r => (r.toolResults ?? []).some(t => t.tool_use_id === 'z'))
  expect(goes.rows[3]!.text).toBe(PERSON_TEXT)
})

// ---- [SP_CTX_02_35] the cut keeps the frame (audit PL_AUD_CTX_P5, CF-9)

test('RecordDelivery — обрізання в рамці: a long framed delivery is cut inside its body; the closing tag comes back; the length bound holds', async () => {
  const words = 'w'.repeat(50_000)
  const full = PERSON_TEXT.replace('Remember PELICAN', words)
  const mem = newAnchorMemory()
  observeAppend(mem, resultEvent('a'), 1)
  const got = observeAppend(mem, deliveryEvent(full), 1)!
  expect(got.kind).toBe('person')
  expect(got.text).toStartWith('<system-reminder>\nThe user sent a new message while you were working:\nwww')
  // the body is cut, not the tag: one closing tag, the last thing of the text
  expect(got.text).toEndWith(`… [context-editor: ${got.cut} chars cut]\n</system-reminder>`)
  expect(got.text.split('</system-reminder>').length).toBe(2)
  expect(got.cut).toBe(full.length - (MAX_DELIVERY_TEXT - '\n</system-reminder>'.length))
  expect(got.text.length).toBeLessThanOrEqual(MAX_DELIVERY_TEXT + `… [context-editor: ${got.cut} chars cut]`.length)
  expect(parseDeliveries(JSON.stringify({ items: [got] })).state).toBe('ok')
  // the person's words of the cut delivery: the kept part with the mark
  expect(deliveryWords(got.text)!).toEndWith(`… [context-editor: ${got.cut} chars cut]`)
})

test('cutDelivery — вкладені теги: the innermost tag closes first; a tag the body never closes adds nothing; a tag cut in half still closes', async () => {
  const report = AGENT_TEXT.replace('The color is TEAL.', `<br> Array<string> ${'r'.repeat(200)}`)
  const out = cutDelivery(report, 260)
  expect(out.text).toEndWith(' chars cut]\n</agent-message>\n</system-reminder>')
  expect(out.text).toContain('<br> Array<string> rrr')
  expect(out.text).not.toContain('</br>')
  expect(out.text).not.toContain('</string>')
  expect(out.text.length).toBeLessThanOrEqual(260 + `… [context-editor: ${out.cut} chars cut]`.length)
  // the cut falls inside the closing tag: the head makes room, the tag closes whole once
  const full = `<system-reminder>\n${'b'.repeat(30)}\n</system-reminder>`
  const half = cutDelivery(full, 55)
  expect(half.text).toBe(`<system-reminder>\n${'b'.repeat(18)}… [context-editor: 31 chars cut]\n</system-reminder>`)
  // no frame: a plain cut, as before; within the bound: the text as it is
  expect(cutDelivery('y'.repeat(100), 60)).toEqual({ text: `${'y'.repeat(60)}… [context-editor: 40 chars cut]`, cut: 40 })
  expect(cutDelivery(PERSON_TEXT)).toEqual({ text: PERSON_TEXT, cut: 0 })
})

test('cutDelivery — закривальний тег з атрибутом: a pasted text in the terminal host closes as </pasted_content id="…">; both closing tags come back as written, innermost first, within the bound', async () => {
  const pasted = `<system-reminder>\n${DELIVERY_FRAMES.person}\n<pasted_content id="7dd3">\n${'p'.repeat(300)}\n</pasted_content id="7dd3">\n\nThis is how Claude Code surfaces messages the user sends mid-turn.\n</system-reminder>`
  const out = cutDelivery(pasted, 200)
  expect(out.text).toStartWith(`<system-reminder>\n${DELIVERY_FRAMES.person}\n<pasted_content id="7dd3">\nppp`)
  expect(out.text).toEndWith(' chars cut]\n</pasted_content id="7dd3">\n</system-reminder>')
  expect(out.text.split('</pasted_content id="7dd3">').length).toBe(2)
  expect(out.text.split('</system-reminder>').length).toBe(2)
  expect(out.text.length).toBeLessThanOrEqual(200 + `… [context-editor: ${out.cut} chars cut]`.length)
  expect(deliveryKind(out.text)).toBe('person')
})

test('cutDelivery — голова скорочується за тег: the first head opens <agent-message> and needs both closing tags; the shorter head stops before it and needs only </system-reminder>', async () => {
  // max 140: the first head ends past `<agent-message from="aeb75">`; making
  // room for two closing tags moves the head back into that opening tag
  const out = cutDelivery(AGENT_TEXT, 140)
  expect(out.text).toStartWith('<system-reminder id="f4473d66c2ae9d44">\nAnother Claude session sent a message while you were working:\n')
  expect(out.text).toEndWith(' chars cut]\n</system-reminder>')
  expect(out.text).not.toContain('</agent-message>')
  expect(out.text.split('</system-reminder>').length).toBe(2)
  const mark = `… [context-editor: ${out.cut} chars cut]`
  expect(out.text.length).toBeLessThanOrEqual(140 + mark.length)
  // the over-cut: the head is shorter than the room the one closing tag needs
  expect(AGENT_TEXT.length - out.cut).toBeLessThanOrEqual(140 - '\n</system-reminder>'.length - 1)
})

test('PersonDelivered — паралельні результати: a drop of one of two results in the anchor row leaves the delivery; a drop of all of them does not', async () => {
  const rows: SessionMessage[] = [prompt, { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false }, { tool_use_id: 'b', text: 'y', isError: false }] }]
  const items = [item('d1', ['a', 'b'])]
  expect(personDelivered(rows, 1, items)).toBe(true)
  expect(personDelivered(rows, 1, items, new Set(['a']))).toBe(false)
  expect(personDelivered(rows, 1, items, new Set(['a', 'b']))).toBe(true)
  expect(personDelivered(rows, 1, [item('d2', ['a'], AGENT_TEXT, 'agent')])).toBe(false)
})

// ---- [SP_CTX_01_22] the deliveries file: per-field checks and the caps (audit PL_AUD_CTX_P6, TST-22)

test('parseDeliveries — перевірка полів: every field of an item is checked; one bad item makes the file unreadable and names it', async () => {
  const good = item('d1', ['a'])
  const reasonOf = (...items: unknown[]) => {
    const r = parseDeliveries(JSON.stringify({ items }))
    return r.state === 'unreadable' ? r.reason : 'ok'
  }
  expect(reasonOf(good)).toBe('ok')
  // every kind of DeliveryKind passes, another does not
  for (const kind of ['person', 'agent', 'task', 'other']) expect(reasonOf({ ...good, kind })).toBe('ok')
  expect(reasonOf({ ...good, kind: 'system' })).toBe('bad item 1')
  expect(reasonOf({ ...good, kind: 1 })).toBe('bad item 1')
  // the text: not blank, at most MAX_DELIVERY_TEXT + 100 (room for the cut mark and the closing tags)
  expect(reasonOf({ ...good, text: '' })).toBe('bad item 1')
  expect(reasonOf({ ...good, text: ' \n\t ' })).toBe('bad item 1')
  expect(reasonOf({ ...good, text: 'x'.repeat(MAX_DELIVERY_TEXT + 100) })).toBe('ok')
  expect(reasonOf({ ...good, text: 'x'.repeat(MAX_DELIVERY_TEXT + 101) })).toBe('bad item 1')
  // the anchor: a non-empty list of strings
  expect(reasonOf({ ...good, anchor: [] })).toBe('bad item 1')
  expect(reasonOf({ ...good, anchor: 'a' })).toBe('bad item 1')
  expect(reasonOf({ ...good, anchor: ['a', 2] })).toBe('bad item 1')
  // cut, media and at: whole numbers, not negative
  for (const field of ['cut', 'media', 'at']) {
    expect(reasonOf({ ...good, [field]: 0 })).toBe('ok')
    expect(reasonOf({ ...good, [field]: -1 })).toBe('bad item 1')
    expect(reasonOf({ ...good, [field]: 1.5 })).toBe('bad item 1')
    expect(reasonOf({ ...good, [field]: '1' })).toBe('bad item 1')
  }
  // a missing field fails the same way
  for (const field of ['uuid', 'anchor', 'kind', 'origin', 'text', 'cut', 'media', 'at']) {
    const { [field]: _gone, ...rest } = good as Record<string, unknown>
    expect(reasonOf(rest)).toBe('bad item 1')
  }
  expect(reasonOf({ ...good, uuid: 7 })).toBe('bad item 1')
  expect(reasonOf({ ...good, origin: null })).toBe('bad item 1')
  // an item that is no object
  expect(reasonOf(null)).toBe('bad item 1')
  expect(reasonOf([good])).toBe('bad item 1')
  expect(reasonOf('d1')).toBe('bad item 1')
  // the first bad item is named by its place, 1-based
  expect(reasonOf(good, item('d2', ['b']), { ...good, uuid: 'd3', kind: 'nope' }, { ...good, uuid: 'd4', anchor: [] })).toBe('bad item 3')
})

test('parseDeliveries — файл: not JSON, not an object, no items list, more than MAX_DELIVERIES items: unreadable; exactly MAX_DELIVERIES: ok', async () => {
  const notJson = parseDeliveries('{')
  expect(notJson.state === 'unreadable' && notJson.reason).toStartWith('not JSON: ')
  expect(parseDeliveries('null')).toEqual({ state: 'unreadable', reason: 'not an object' })
  expect(parseDeliveries('[]')).toEqual({ state: 'unreadable', reason: 'not an object' })
  expect(parseDeliveries('{}')).toEqual({ state: 'unreadable', reason: 'bad field(s): items' })
  expect(parseDeliveries('{"items":{}}')).toEqual({ state: 'unreadable', reason: 'bad field(s): items' })
  expect(parseDeliveries('{"items":[]}')).toEqual({ state: 'ok', value: { items: [] } })
  const many = (n: number) => Array.from({ length: n }, (_, k) => item(`d${k}`, [`a${k}`], `text ${k}`))
  const full = parseDeliveries(JSON.stringify({ items: many(MAX_DELIVERIES) }))
  expect(full.state === 'ok' && full.value.items.length).toBe(MAX_DELIVERIES)
  expect(parseDeliveries(JSON.stringify({ items: many(MAX_DELIVERIES + 1) }))).toEqual({ state: 'unreadable', reason: 'bad field(s): items' })
})

test('trimDeliveries — межі: the oldest go first past maxBytes; past MAX_DELIVERIES the newest MAX_DELIVERIES stay; within both the same list comes back', async () => {
  const bytes = (d: Deliveries) => new TextEncoder().encode(JSON.stringify(d)).length
  const three: Deliveries = { items: [item('d1', ['a'], 'one'), item('d2', ['b'], 'two'), item('d3', ['c'], 'three')] }
  // within the bound: the very same object
  expect(trimDeliveries(three, bytes(three))).toBe(three)
  // one byte short: only the oldest goes
  const trimmed = trimDeliveries(three, bytes(three) - 1)
  expect(trimmed.items.map(x => x.uuid)).toEqual(['d2', 'd3'])
  // room for the newest only
  const last: Deliveries = { items: [three.items[2]!] }
  expect(trimDeliveries(three, bytes(last)).items.map(x => x.uuid)).toEqual(['d3'])
  // the count cap keeps the newest MAX_DELIVERIES
  const many: Deliveries = { items: Array.from({ length: MAX_DELIVERIES + 5 }, (_, k) => item(`d${k}`, [`a${k}`], `text ${k}`)) }
  const capped = trimDeliveries(many, MAX_QUEUE_BYTES)
  expect(capped.items.length).toBe(MAX_DELIVERIES)
  expect(capped.items[0]!.uuid).toBe('d5')
  expect(capped.items.at(-1)!.uuid).toBe(`d${MAX_DELIVERIES + 4}`)
})

test('trimDeliveries — один елемент більший за maxBytes: the whole list goes, the item too; RecordDelivery then writes an empty list', async () => {
  const huge = item('big', ['a'], 'x'.repeat(2000))
  expect(trimDeliveries({ items: [item('d1', ['b'], 'small'), huge] }, 1000)).toEqual({ items: [] })
  expect(trimDeliveries({ items: [huge] }, 1000)).toEqual({ items: [] })
  // even the empty list over the bound stays empty, no loop
  expect(trimDeliveries({ items: [huge] }, 1)).toEqual({ items: [] })
  // RecordDelivery of an item that alone exceeds the bound: the earlier items are lost with it
  const { renew, log } = fakeIO(okRead({ items: [item('d1', ['b'], 'small')] }))
  await recordDelivery(renew, huge, 1000)
  expect(log.writes).toBe(1)
  expect(log.file).toEqual({ state: 'ok', value: { items: [] } })
})
