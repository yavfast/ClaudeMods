import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applyEdits, describeEdit, dropOwnCalls, fingerprint, formatReport, listRows, mergeCallRows, prepare, producedRows, type QueuedEdit } from '../hooks/edits'
import { EMPTY_QUEUE, type Queue } from '../hooks/queue'
import {
  afterReminders,
  applyNoteRequests,
  blockNotes,
  contextNote,
  dueReminders,
  MAX_NOTE,
  MAX_NOTES,
  MAX_REMIND,
  noteLabels,
  noteLines,
  noteReminders,
  rebindNotes,
  remindable,
  remindsAfter,
  withReminderLines,
  type Note,
} from '../hooks/notes'
import { blockReport, optimizeText, personAdvice, telemetry, telemetryText, type BlockIO, type UsageInfo } from '../hooks/stages'
import { applyTagRequests, EMPTY_REGISTRY, MAX_REGISTRY_BYTES, parseRegistry, type TagIO, type TagRegistry } from '../hooks/tags'

const prompt = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const say = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })
const use = (id: string, tool = 'Read'): SessionMessage => ({ role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input: {} }] })
const result = (id: string, text = `out ${id}`): SessionMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError: false }] })

// #0 prompt, then pairs a..j on #1/#2, #3/#4, ... with a text row every third row
function rows(n = 21): SessionMessage[] {
  const out: SessionMessage[] = [prompt('task')]
  let k = 0
  while (out.length < n) {
    const id = String.fromCharCode(97 + (k % 26)) + (k >= 26 ? k : '')
    if (out.length % 5 === 0) out.push(say(`step ${out.length}`))
    else if (out.length + 1 < n) {
      out.push(use(id), result(id))
      k++
    } else out.push(say(`end ${out.length}`))
  }
  return out
}

const reg = (extra: Partial<TagRegistry> = {}): TagRegistry => ({ ...EMPTY_REGISTRY, tags: [], notes: [], ...extra })
const at = (r: readonly SessionMessage[], i: number) => ({ anchor: fingerprint(r[i]!), hint: i })
const note = (id: string, target: Note['target'], extra: Partial<Note> = {}): Note => ({ id, target, text: `text of ${id}`, createdTurn: 0, ...extra })

function harness(start: TagRegistry, list: SessionMessage[] = rows(), over: Partial<TagIO> = {}) {
  const log = { tags: start, writes: 0 }
  const io: TagIO = {
    rows: async () => list,
    readTags: async () => ({ state: 'ok', value: log.tags }),
    writeTags: async r => {
      log.tags = r
      log.writes++
    },
    readQueue: async () => ({ state: 'ok', value: { ...EMPTY_QUEUE } as Queue }),
    writeQueue: async () => undefined,
    ...over,
  }
  return { io, log }
}

async function call(io: TagIO, notes: unknown[], resolve = (ref: string) => (ref === 'last' ? 'a' : undefined), stale = false) {
  const out = await contextNote(io, { notes }, undefined, resolve, stale)
  if ('deny' in out) throw new Error(out.deny)
  return out.result
}

// ---- [SP_CTX_02_32] context_note

test('context_note — додати і зняти: n1..n4 on a pair by ref, row #5, range #4..#7, the same pair again; remove n2; the next new note is n5', async () => {
  const r = rows()
  const { io, log } = harness(reg({ turn: 3 }), r)
  const text = await call(io, [
    { op: 'add', ref: 'last', text: 'drop after the check' },
    { op: 'add', index: 5, text: 'a conclusion' },
    { op: 'add', index: 4, to: 7, text: 'a dead end' },
    { op: 'add', tool_use_id: 'a', text: 'second note on a' },
  ])
  expect(text).toContain('Added n1, n2, n3, n4; removed none; 4 note(s) in the registry.')
  expect(log.tags.nextNote).toBe(5)
  expect(log.tags.notes.map(n => n.target)).toEqual([{ tool_use_id: 'a' }, at(r, 5), { ...at(r, 4), toAnchor: fingerprint(r[7]!), toHint: 7 }, { tool_use_id: 'a' }])
  expect(log.tags.notes[0]!.createdTurn).toBe(3)
  const removed = await call(io, [{ op: 'remove', id: 'n2' }])
  expect(removed).toContain('Added none; removed n2; 3 note(s) in the registry.')
  await call(io, [{ op: 'add', index: 0, text: 'task' }])
  expect(log.tags.notes.map(n => n.id)).toEqual(['n1', 'n3', 'n4', 'n5'])
  // both notes of the pair stay
  expect(log.tags.notes.filter(n => 'tool_use_id' in n.target).length).toBe(2)
})

test('context_note — нотатка і тег незалежні: a pin on a, a note on a, the pin removed: the note stays', async () => {
  const r = rows()
  let state = applyTagRequests(reg(), r, [{ op: 'add', kind: 'pin', tool_use_id: 'a' }]).registry
  state = applyNoteRequests(state, r, [{ op: 'add', tool_use_id: 'a', text: 'n' }]).registry
  state = applyTagRequests(state, r, [{ op: 'remove', tool_use_id: 'a' }]).registry
  expect(state.tags).toEqual([])
  expect(state.notes.length).toBe(1)
  // a tag set on a target with notes is set as always
  expect(applyTagRequests(state, r, [{ op: 'add', kind: 'review', tool_use_id: 'a' }]).added).toBe(1)
})

test('context_note — помилки: each code of the Errors table; the rest of the batch goes on', async () => {
  const r = rows()
  const full = reg({ notes: Array.from({ length: MAX_NOTES }, (_, i) => note(`n${i + 1}`, { tool_use_id: 'a' })), nextNote: MAX_NOTES + 1 })
  const cases: [unknown, string, TagRegistry?, boolean?][] = [
    [{ op: 'edit', id: 'n1' }, 'BAD_OP'],
    [{ op: 'add', index: 1 }, 'NOTE_TEXT_REQUIRED'],
    [{ op: 'add', index: 1, text: '  ' }, 'NOTE_TEXT_REQUIRED'],
    [{ op: 'add', index: 1, text: 'x'.repeat(MAX_NOTE + 1) }, 'NOTE_TEXT_REQUIRED'],
    [{ op: 'add', text: 't' }, 'TARGET_REQUIRED'],
    [{ op: 'add', text: 't', index: 1, tool_use_id: 'a' }, 'TARGET_REQUIRED'],
    [{ op: 'add', text: 't', ref: 'c9' }, 'UNKNOWN_REF'],
    [{ op: 'add', text: 't', tool_use_id: 'zz' }, 'TARGET_NOT_FOUND'],
    [{ op: 'add', text: 't', index: 99 }, 'TARGET_NOT_FOUND'],
    [{ op: 'add', text: 't', index: 3 }, 'INDEXES_STALE', undefined, true],
    [{ op: 'add', text: 't', tool_use_id: 'a', to: 4 }, 'BAD_RANGE'],
    [{ op: 'add', text: 't', index: 4, to: 4 }, 'BAD_RANGE'],
    [{ op: 'add', text: 't', index: 4, to: 99 }, 'BAD_RANGE'],
    [{ op: 'remove', id: 'n1', to: 4 }, 'BAD_RANGE'],
    [{ op: 'add', text: 't', index: 1, remind_in_turns: 0 }, 'BAD_REMIND'],
    [{ op: 'add', text: 't', index: 1, remind_in_turns: MAX_REMIND + 1 }, 'BAD_REMIND'],
    [{ op: 'remove', id: 'n1', remind_in_turns: 2 }, 'BAD_REMIND'],
    [{ op: 'add', text: 't', index: 1 }, 'NOTES_FULL', full],
    [{ op: 'remove', id: 'n77' }, 'NO_NOTE'],
  ]
  for (const [request, code, start, stale] of cases) {
    const out = applyNoteRequests(start ?? reg(), r, [request, { op: 'add', index: 0, text: 'still added' }], () => undefined, stale)
    expect(out.rejected[0]?.reason ?? '').toContain(`(${code})`)
    expect(out.rejected[0]!.reason.startsWith('note 1:')).toBe(true)
    // the second request still applies (not into a full registry; with stale indexes it is refused too)
    expect(out.added.length).toBe(code === 'NOTES_FULL' || stale ? 0 : 1)
  }
})

test('context_note — call-level refusals: a subagent, no list, no storage, an unreadable or unwritable registry', async () => {
  const ok = harness(reg())
  for (const [args, code] of [
    [{ agentId: 'x', notes: [{ op: 'add', index: 0, text: 't' }] }, 'DENIED_SUBAGENT'],
    [{ notes: [] }, 'DENIED_EMPTY'],
    [{ notes: 'n' }, 'DENIED_EMPTY'],
    [{ notes: Array.from({ length: MAX_NOTES + 1 }, () => ({})) }, 'DENIED_EMPTY'],
  ] as const) {
    const out = await contextNote(ok.io, args)
    expect('code' in out && out.code).toBe(code)
  }
  const down = await contextNote(ok.io, { notes: [{ op: 'add', index: 0, text: 't' }] }, 'HOME is not set')
  expect('code' in down && down.code).toBe('DENIED_STORAGE')
  const unread = harness(reg(), rows(), { readTags: async () => ({ state: 'unreadable', reason: 'x' }) })
  const a = await contextNote(unread.io, { notes: [{ op: 'add', index: 0, text: 't' }] })
  expect('code' in a && a.code).toBe('DENIED_REGISTRY_READ')
  const failing = harness(reg(), rows(), {
    writeTags: async () => {
      throw new Error('disk full')
    },
  })
  const b = await contextNote(failing.io, { notes: [{ op: 'add', index: 0, text: 't' }] })
  expect('code' in b && b.code).toBe('DENIED_REGISTRY_WRITE')
  expect(failing.log.tags.notes).toEqual([])
})

test('context_note — нагадування: remind_in_turns 2 at TagRegistry.turn 7 gives remindAt 9', async () => {
  const out = applyNoteRequests(reg({ turn: 7 }), rows(), [{ op: 'add', index: 1, text: 'come back', remind_in_turns: 2 }])
  expect(out.registry.notes[0]!.remindAt).toBe(9)
})

test('Реєстр повний (05_04): tags and notes share the size limit of the file', async () => {
  const empty = reg({ tags: [{ kind: 'disposable', target: { tool_use_id: 'a' }, note: '', created_turn: 0 }] })
  const room = MAX_REGISTRY_BYTES - new TextEncoder().encode(JSON.stringify(empty)).length - 40
  const start = reg({ tags: [{ kind: 'disposable', target: { tool_use_id: 'a' }, note: 'y'.repeat(room), created_turn: 0 }] })
  const out = applyNoteRequests(start, rows(), [{ op: 'add', index: 1, text: 'a note that no longer fits' }])
  expect(out.rejected[0]!.code).toBe('NOTES_FULL')
  expect(applyNoteRequests(reg(), rows(), [{ op: 'add', index: 1, text: 'a note that no longer fits' }]).added).toEqual(['n1'])
})

// ---- [SP_CTX_01_10] read states

test('parseRegistry reads notes and nextNote and refuses bad ones', async () => {
  const good = reg({ notes: [note('n1', { tool_use_id: 'a' }, { remindAt: 3 }), note('n4', { anchor: 'user||t', hint: 0, toAnchor: 'user||u', toHint: 2 })], nextNote: 5 })
  expect(parseRegistry(JSON.stringify(good)).state).toBe('ok')
  // a registry written before phase 16
  const old = parseRegistry(JSON.stringify({ tags: [], turn: 1, firstPromptPinned: false }))
  expect(old.state === 'ok' && old.value.notes).toEqual([])
  expect(old.state === 'ok' && old.value.nextNote).toBe(1)
  for (const bad of [
    { notes: [note('n1', { tool_use_id: 'a' })], nextNote: 1 },
    { notes: [note('n1', { tool_use_id: 'a' }), note('n1', { tool_use_id: 'b' })], nextNote: 2 },
    { notes: [note('x1', { tool_use_id: 'a' })], nextNote: 2 },
    { notes: [note('n1', { tool_use_id: 'a' }, { text: '' })], nextNote: 2 },
    { notes: [note('n1', { tool_use_id: 'a' }, { createdTurn: 3, remindAt: 3 })], nextNote: 2 },
    { notes: [note('n1', { anchor: 'a', hint: 4, toAnchor: 'b', toHint: 4 })], nextNote: 2 },
    { notes: {}, nextNote: 1 },
    { notes: [], nextNote: 0 },
  ]) {
    expect(parseRegistry(JSON.stringify({ ...reg(), ...bad })).state).toBe('unreadable')
  }
})

// ---- [SP_CTX_02_33] NoteReminders

test('NoteReminders — доставка один раз: remindAt 9; turn 8 nothing; turn 9 the line, remindAt removed; once more nothing', async () => {
  const start = (turn: number) => reg({ turn, notes: [note('n1', { tool_use_id: 'a' }, { createdTurn: 7, remindAt: 9, text: 'check the fix' })], nextNote: 2 })
  const early = harness(start(8))
  expect(await noteReminders(early.io)).toEqual([])
  expect(early.log.writes).toBe(0)
  const due = harness(start(9))
  expect(await noteReminders(due.io)).toEqual(['[context-editor] reminder n1 (set 2 turn(s) ago): check the fix'])
  expect(due.log.tags.notes[0]!.remindAt).toBeUndefined()
  expect(due.log.tags.notes[0]!.text).toBe('check the fix')
  expect(await noteReminders(due.io)).toEqual([])
})

test('NoteReminders — не для власних інструментів: own tools, denied calls and subagents get no reminder', async () => {
  expect(remindable({ denied: false, tool: 'Read', tool_use_id: 'x' })).toBe(true)
  expect(remindable({ denied: false, tool: 'mcp__context-editor__context_list', tool_use_id: 'x' })).toBe(false)
  expect(remindable({ denied: true, tool: 'Read', tool_use_id: 'x' })).toBe(false)
  expect(remindable({ agentId: 'sub', denied: false, tool: 'Read', tool_use_id: 'x' })).toBe(false)
  expect(remindable({ denied: false, tool: 'Read' })).toBe(false)
})

test('NoteReminders — збій запису: no line; remindAt stays; the next call delivers', async () => {
  let fail = true
  const h = harness(reg({ turn: 9, notes: [note('n1', { tool_use_id: 'a' }, { remindAt: 9 })], nextNote: 2 }), rows(), {
    writeTags: async r => {
      if (fail) throw new Error('disk full')
      h.log.tags = r
    },
  })
  expect(await noteReminders(h.io)).toEqual([])
  expect(h.log.tags.notes[0]!.remindAt).toBe(9)
  fail = false
  expect((await noteReminders(h.io)).length).toBe(1)
  // missing or unreadable registry: nothing
  const missing = harness(reg(), rows(), { readTags: async () => ({ state: 'missing', value: reg() }) })
  expect(await noteReminders(missing.io)).toEqual([])
})

test('Кілька нагадувань одночасно (05_04): two notes with the same remindAt: both lines, the oldest first', async () => {
  const out = dueReminders(reg({ turn: 5, notes: [note('n2', { tool_use_id: 'a' }, { createdTurn: 1, remindAt: 5 }), note('n7', { tool_use_id: 'b' }, { createdTurn: 3, remindAt: 5 })], nextNote: 8 }))!
  expect(out.lines.map(l => l.split(' ')[2])).toEqual(['n2', 'n7'])
  expect(out.registry.notes.every(n => n.remindAt === undefined)).toBe(true)
})

// ---- [SP_CTX_02_01] the listing

test('context_list — нотатки на сторінці: [n1] on #3, [n2 #5..#8] on #5, a Notes block for the page; n3 off the page; n4 with its reminder', async () => {
  const r = rows(80)
  const g = reg({
    turn: 4,
    notes: [
      note('n1', at(r, 3)),
      note('n2', { ...at(r, 5), toAnchor: fingerprint(r[8]!), toHint: 8 }),
      note('n3', at(r, 70)),
      note('n4', at(r, 9), { createdTurn: 4, remindAt: 6 }),
    ],
    nextNote: 5,
  })
  const text = listRows(r, 0, 60, new Map(), noteLabels(r, g), new Map(), '', noteLines(r, g))
  const line = (i: number) => text.split('\n').find(l => l.startsWith(`#${i} `) || l.startsWith(`#${i}!`))!
  expect(line(3)).toContain('[n1]')
  expect(line(5)).toContain('[n2 #5..#8]')
  expect(line(6)).not.toContain('[n2')
  const block = text.slice(text.indexOf('\nNotes:\n') + 1).split('\n')
  expect(block[0]).toBe('Notes:')
  expect(block).toContain('n1 #3: text of n1')
  expect(block).toContain('n2 #5: text of n2')
  expect(block).toContain('n4 #9: text of n4 (reminder in 2 turn(s))')
  // n3 is off the page: named in the header, not in the block
  expect(text).toContain('Notes elsewhere: n3 #70')
  expect(block.some(l => l.startsWith('n3'))).toBe(false)
  // a pair note shows on both rows of the pair
  const pair = noteLabels(r, reg({ notes: [note('n1', { tool_use_id: 'a' })] }))
  expect([...pair.keys()]).toEqual([1, 2])
})

test('Вбудована компактизація хоста з нотатками (05_04): a note whose row is gone is not listed, the telemetry counts it', async () => {
  const r = rows()
  const g = reg({ notes: [note('n1', { anchor: 'user||gone', hint: 3 })], nextNote: 2 })
  expect(noteLabels(r, g).size).toBe(0)
  expect(noteLines(r, g)).toEqual([{ id: 'n1', line: 'n1: text of n1' }])
  expect(telemetryText(await telemetry(r, g, async () => ({ context: { window: 1000 } })))).toContain('Notes: 1 (0 with a reminder pending)')
})

// ---- [SP_CTX_02_14] RelocateNote

// An apply as HandleCompaction runs it.
function apply(before: SessionMessage[], raw: unknown[]) {
  const edits = prepare(before, raw).queued
  const applied = applyEdits(before, edits, '/s/1.json')
  const after = dropOwnCalls(applied.rows)
  const produced = producedRows(after, applied.made)
  const names = new Set(applied.report.applied)
  const done: QueuedEdit[] = edits.filter(e => names.has(describeEdit(e)))
  return { after, produced, done, report: applied.report }
}

test('RebindTags — нотатка на заміненому рядку: n1 on pair a, summarize a: a row note on the FreshId result row; text and remindAt kept', async () => {
  const before = rows()
  const x = apply(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }])
  const out = rebindNotes(reg({ notes: [note('n1', { tool_use_id: 'a' }, { remindAt: 4 })], nextNote: 2 }), before, x.after, x.done, x.produced)
  const k = x.after.findIndex(r => (r.toolResults ?? []).some(t => t.tool_use_id.startsWith('a_ce')))
  expect(out.registry.notes).toEqual([note('n1', { anchor: fingerprint(x.after[k]!), hint: k }, { remindAt: 4 })])
  expect(out.dropped).toEqual([])
})

test('RebindTags — нотатка на прибраному рядку: n1 on pair b, drop b: n1 goes; the report ends with Notes dropped', async () => {
  const before = rows()
  const x = apply(before, [{ op: 'drop', tool_use_id: 'b' }])
  const out = rebindNotes(reg({ notes: [note('n1', { tool_use_id: 'b' }), note('n2', { tool_use_id: 'c' })], nextNote: 3 }), before, x.after, x.done, x.produced)
  expect(out.dropped).toEqual(['n1'])
  expect(out.registry.notes.map(n => n.id)).toEqual(['n2'])
  // an untouched pair keeps its target
  expect(out.registry.notes[0]!.target).toEqual({ tool_use_id: 'c' })
  const text = formatReport({ ...x.report, notesDropped: out.dropped }, '/s/1.json', 'compaction')
  expect(text.endsWith(' Notes dropped (their rows were removed): n1.')).toBe(true)
  expect(formatReport({ ...x.report, applied: [], failed: [], notesDropped: ['n1'] }, '', 'seed')).toBe('context-editor: Notes dropped (their rows were removed): n1.')
})

test('RebindTags — діапазон нотатки: n2 on #4..#8; the pair at #8/#9 dropped: the end moves to #7; collapse 4..8: a row note on the carrier', async () => {
  // #4 use x, #5 result x, #6 text, #7 text, #8 use y, #9 result y
  const before = [prompt('p'), use('a'), result('a'), say('s'), use('x'), result('x'), say('t'), say('u'), use('y'), result('y'), say('end')]
  const range = note('n2', { ...at(before, 4), toAnchor: fingerprint(before[8]!), toHint: 8 })
  const dropped = apply(before, [{ op: 'drop', tool_use_id: 'y' }])
  const a = rebindNotes(reg({ notes: [range], nextNote: 3 }), before, dropped.after, dropped.done, dropped.produced)
  expect(a.registry.notes[0]!.target).toEqual({ ...at(dropped.after, 4), toAnchor: fingerprint(dropped.after[7]!), toHint: 7 })
  const collapsed = apply(before, [{ op: 'collapse', from_index: 4, to_index: 9, summary: 'S' }])
  const b = rebindNotes(reg({ notes: [range], nextNote: 3 }), before, collapsed.after, collapsed.done, collapsed.produced)
  expect(b.registry.notes[0]!.target).toEqual(at(collapsed.after, 5))
  expect(collapsed.after[5]!.toolResults![0]!.text).toContain('rows collapsed')
})

test('RebindTags — засів з CarryNote: a note on a pair the seed extended stays on the same pair', async () => {
  const before = rows()
  const seeded = before.map(r => (r.toolResults?.[0]?.tool_use_id === 'a' ? { ...r, toolResults: [{ tool_use_id: 'a', text: 'out a\n\n[context-editor] media carried as files', isError: false }] } : r))
  const out = rebindNotes(reg({ notes: [note('n1', { tool_use_id: 'a' }), note('n2', at(before, 2))], nextNote: 3 }), before, seeded, [], [])
  expect(out.registry.notes.map(n => n.target)).toEqual([{ tool_use_id: 'a' }, at(seeded, 2)])
  expect(out.dropped).toEqual([])
})

test('Нотатка на рядку, прибраному без заміни (05_04): DropOwnCalls removes the row of a note: it goes', async () => {
  const before = [prompt('p'), use('l', 'mcp__context-editor__context_list'), result('l'), use('a'), result('a', 'x'.repeat(50))]
  const x = apply(before, [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }])
  const out = rebindNotes(reg({ notes: [note('n1', at(before, 2))], nextNote: 2 }), before, x.after, x.done, x.produced)
  expect(out.dropped).toEqual(['n1'])
})

// ---- [SP_CTX_02_29] BlockReport, OptimizeText, PersonAdvice

const USAGE: UsageInfo = { context: { tokens: 900, window: 200_000 } }

test('BlockReport — нотатки в блоці: block #4..#11, notes on #6 and #20: only n1 #6 is named', async () => {
  const r = rows()
  const g = reg({ notes: [note('n1', at(r, 6)), note('n2', at(r, 20))], nextNote: 3 })
  const io: BlockIO = {
    key: async () => 'K',
    rows: async () => r,
    readTags: async () => ({ state: 'ok', value: g }),
    media: async () => new Map(),
    usage: async () => USAGE,
    setListed: () => undefined,
  }
  const text = await blockReport(io, { name: 'A', after: at(r, 3), end: at(r, 11), turn: 0 })
  expect(text).toContain('Your notes in the block: n1 #6: text of n1')
  expect(text).not.toContain('n2 #20')
  expect(blockNotes(r, g, 0, 20, 1)).toBe('n1 #6: text of n1; +1 more')
})

test('OptimizeText, PersonAdvice — нотатки без рядків: 3 notes give the sentence; none, nothing', async () => {
  const block = { name: 'A', after: null, end: null, turn: 0 }
  const hint = 'You have 3 note(s); context_list shows them next to their rows and in full below each page.'
  expect(optimizeText(block, false, 3)).toContain(hint)
  expect(personAdvice(block, 3)).toContain(hint)
  expect(optimizeText(block, false, 0)).not.toContain('note(s)')
  expect(personAdvice(block)).not.toContain('note(s)')
})

// ---- [SP_CTX_02_28] Telemetry

test('Telemetry — нотатки: 3 notes, one with remindAt / none', async () => {
  const r = rows()
  const three = reg({ notes: [note('n1', at(r, 1)), note('n2', at(r, 2), { remindAt: 5 }), note('n3', at(r, 3))], nextNote: 4 })
  expect(telemetryText(await telemetry(r, three, async () => USAGE))).toContain('Notes: 3 (1 with a reminder pending)')
  expect(telemetryText(await telemetry(r, reg(), async () => USAGE))).not.toContain('Notes:')
})

// [SP_CTX_02_14] review round 37, W1
test('RebindTags — нотатки на паралельних викликах: call rows of one response merged (seed, or an apply): the notes move to the merged row, none dropped', async () => {
  const before = [prompt('p'), say('reading'), use('a'), use('b'), result('a'), result('b'), say('done')]
  const after = mergeCallRows(before.map(r => ({ ...r })))
  expect(after.length).toBe(before.length - 1)
  const notes = [note('n1', at(before, 2)), note('n2', at(before, 3)), note('n3', { ...at(before, 1), toAnchor: fingerprint(before[3]!), toHint: 3 })]
  const seed = rebindNotes(reg({ notes, nextNote: 4 }), before, after, [], [])
  expect(seed.dropped).toEqual([])
  expect(seed.registry.notes.map(n => n.target)).toEqual([at(after, 2), at(after, 2), { ...at(after, 1), toAnchor: fingerprint(after[2]!), toHint: 2 }])
  // an apply: the stretch's call rows rebuilt (KeepResponsesWhole) and merged
  const withHandles = before.map((r, i) => ({ ...r, handle: `h${i}` }))
  const x = apply([...withHandles, use('c'), result('c', 'x'.repeat(50))].map(r => r), [{ op: 'summarize', tool_use_id: 'a', summary: 'A' }])
  const k = x.after.findIndex(r => r.toolUses.some(u => u.tool_use_id === 'b'))
  const out = rebindNotes(reg({ notes: [note('n2', at(withHandles, 3))], nextNote: 3 }), withHandles, x.after, x.done, x.produced)
  expect(out.dropped).toEqual([])
  expect(out.registry.notes[0]!.target).toEqual(at(x.after, k))
})

// [SP_CTX_02_32] review round 37, W2
test('context_note — рядок без тексту: a thinking-only row by index or as "to" is TARGET_NOT_FOUND with the guidance', async () => {
  const list = [prompt('p'), { role: 'assistant' as const, text: '', toolUses: [] }, use('a'), result('a'), say('x')]
  const by = applyNoteRequests(reg(), list, [{ op: 'add', index: 1, text: 't' }])
  expect(by.rejected[0]!.code).toBe('TARGET_NOT_FOUND')
  expect(by.rejected[0]!.reason).toContain('note a neighbouring row')
  const to = applyNoteRequests(reg(), list, [{ op: 'add', index: 0, to: 1, text: 't' }])
  expect(to.rejected[0]!.code).toBe('TARGET_NOT_FOUND')
  // a distinctive row stays tracked through an application that changes nothing
  const ok = applyNoteRequests(reg(), list, [{ op: 'add', index: 4, text: 't' }]).registry
  expect(rebindNotes(ok, list, list, [], []).dropped).toEqual([])
})

// [SP_CTX_02_01] phase 17
test('context_list — нотатки поза сторінкою: page 0..59, notes on #70 and #300, one not found: Notes elsewhere names them', async () => {
  const r = rows(310)
  const g = reg({ notes: [note('n3', at(r, 70)), note('n5', at(r, 300)), note('n7', { anchor: 'user||gone', hint: 2 }), note('n8', at(r, 3))], nextNote: 9 })
  const text = listRows(r, 0, 60, new Map(), noteLabels(r, g), new Map(), '', noteLines(r, g))
  expect(text).toContain('Notes elsewhere: n3 #70, n5 #300, n7 (row not found)')
  expect(text).toContain('n8 #3: text of n8')
  // count 0: no page, so the header names every note
  expect(listRows(r, 0, 0, new Map(), new Map(), new Map(), '', noteLines(r, g))).toContain('Notes elsewhere: n8 #3, n3 #70, n5 #300, n7 (row not found)')
})

// [SP_CTX_02_33] phase 17
test('NoteReminders — після інструмента мода: the lines go at the end of the tool\'s own result; a refused call gets none', async () => {
  expect(withReminderLines({ result: 'listing' }, ['[context-editor] reminder n1 (set 2 turn(s) ago): t'])).toEqual({ result: 'listing\n[context-editor] reminder n1 (set 2 turn(s) ago): t' })
  const refused = { deny: 'no' }
  expect(withReminderLines(refused, ['x'])).toBe(refused)
  const none = { result: 'r' }
  expect(withReminderLines(none, [])).toBe(none)
})

// [SP_CTX_02_33] review round 39
test('NoteReminders — не з context_edit і context_handoff: their calls go with the apply they trigger; the others carry reminders', async () => {
  expect(remindsAfter('mcp__context-editor__context_edit')).toBe(false)
  expect(remindsAfter('mcp__context-editor__context_handoff')).toBe(false)
  for (const t of ['context_list', 'context_tag', 'context_note']) expect(remindsAfter(`mcp__context-editor__${t}`)).toBe(true)
})

// [SP_CTX_02_33] review round 40: the listing counts as if delivered, and delivers only once built
test('afterReminders — the registry the listing counts: due reminders taken as delivered, the rest pending', async () => {
  const g = reg({ turn: 5, notes: [note('n1', { tool_use_id: 'a' }, { remindAt: 5 }), note('n2', { tool_use_id: 'b' }, { remindAt: 9 })], nextNote: 3 })
  const counted = afterReminders(g)
  expect(counted.notes.map(n => n.remindAt)).toEqual([undefined, 9])
  expect(g.notes[0]!.remindAt).toBe(5)
  expect(telemetryText(await telemetry(rows(), counted, async () => ({ context: { window: 1000 } })))).toContain('Notes: 2 (1 with a reminder pending)')
})
