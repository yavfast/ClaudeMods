import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { applyEdits } from '../hooks/edits'
import type { HostRowRecord } from '../hooks/hostrows'
import { personText } from '../hooks/deliveries'
import { applyTagRequests, parseRegistry, withTitle } from '../hooks/tags'
import {
  carryTitle,
  isPersonRename,
  isRenameRow,
  keepRuns,
  MAX_TITLE,
  MAX_TITLE_RUNS,
  personRename,
  renameRan,
  renameRefused,
  runRename,
  titleDue,
  titleOp,
  type RenameIO,
  type TitleState,
} from '../hooks/title'
import { prompt, reg, reply } from './row-fixtures'

// ---- [SP_CTX_01_33] TitleState

test('TitleState — розбір: a registry with title.want a number is unreadable; without title it reads; a run without after too', () => {
  const base = { tags: [], turn: 0, firstPromptPinned: false, introduced: false, notes: [], nextNote: 1 }
  expect(parseRegistry(JSON.stringify({ ...base, title: { want: 5 } })).state).toBe('unreadable')
  expect(parseRegistry(JSON.stringify(base)).state).toBe('ok')
  expect(parseRegistry(JSON.stringify({ ...base, title: { want: 'A', set: 'A', person: true, runs: [{ after: 'h', title: 'A' }] } })).state).toBe('ok')
  expect(parseRegistry(JSON.stringify({ ...base, title: { runs: [{ title: 'A' }] } })).state).toBe('unreadable')
  expect(parseRegistry(JSON.stringify({ ...base, title: { person: false } })).state).toBe('unreadable')
  expect(parseRegistry(JSON.stringify({ ...base, title: { want: 'x'.repeat(MAX_TITLE + 1) } })).state).toBe('unreadable')
})

test('TitleDue: a want the session does not show yet', () => {
  expect(titleDue(undefined)).toBe(false)
  expect(titleDue({ want: 'A' })).toBe(true)
  expect(titleDue({ want: 'A', set: 'A' })).toBe(false)
  expect(titleDue({ want: 'B', set: 'A' })).toBe(true)
  expect(titleDue({ set: 'A' })).toBe(false)
})

test('TitleState — runs: past MAX_TITLE_RUNS the oldest go', () => {
  let s: TitleState | undefined
  for (let i = 0; i < MAX_TITLE_RUNS + 3; i++) s = renameRan(s, `T${i}`, `h${i}`)
  expect(s!.runs!.length).toBe(MAX_TITLE_RUNS)
  expect(s!.runs![0]).toEqual({ after: 'h3', title: 'T3' })
  expect(s!.set).toBe(`T${MAX_TITLE_RUNS + 2}`)
})

// ---- [SP_CTX_02_70] TitleOp

test('TitleOp — прийнято: text is trimmed into want; the line says the mod renames at the turn end; the same as set: already has this title', () => {
  const out = titleOp(undefined, { op: 'title', text: ' Нова тема ' })
  expect(out.title).toEqual({ want: 'Нова тема' })
  expect(out.lines).toEqual(['Title "Нова тема" set: the mod renames the session when this turn ends.'])
  expect(out.changed).toBe(true)
  const same = titleOp({ want: 'A', set: 'A' }, { op: 'title', text: 'A' })
  expect(same.lines).toEqual(['The session already has this title.'])
  expect(same.changed).toBe(false)
})

test('TitleOp — відмови: another field TITLE_FIELDS; 81 chars, a line break or no text TITLE_TEXT; person TITLE_PERSON with want unchanged', () => {
  expect(titleOp(undefined, { op: 'title', text: 'A', stage: 'x' }).error?.code).toBe('TITLE_FIELDS')
  expect(titleOp(undefined, { op: 'title', text: 'x'.repeat(MAX_TITLE + 1) }).error?.code).toBe('TITLE_TEXT')
  expect(titleOp(undefined, { op: 'title', text: 'a\nb' }).error?.code).toBe('TITLE_TEXT')
  expect(titleOp(undefined, { op: 'title', text: '  ' }).error?.code).toBe('TITLE_TEXT')
  expect(titleOp(undefined, { op: 'title' }).error?.code).toBe('TITLE_TEXT')
  const person = titleOp({ want: 'P', set: 'P', person: true }, { op: 'title', text: 'A' })
  expect(person.error?.code).toBe('TITLE_PERSON')
  expect(person.title).toEqual({ want: 'P', set: 'P', person: true })
})

test('TitleOp — відмова хоста: refused is named once, then cleared; with person it is cleared too', () => {
  const out = titleOp({ set: 'A', refused: 'no session' }, { op: 'title', text: 'B' })
  expect(out.lines).toEqual(['The last rename failed: no session.', 'Title "B" set: the mod renames the session when this turn ends.'])
  expect(out.title).toEqual({ set: 'A', want: 'B' })
  const person = titleOp({ person: true, refused: 'x' }, { op: 'title', text: 'B' })
  expect(person.lines).toEqual(['The last rename failed: x.'])
  expect(person.title).toEqual({ person: true })
  expect(person.changed).toBe(true)
})

test('TitleOp у context_tag: two ops in a batch leave the last want; a rejected one names its code; other requests go on', () => {
  const rows = [prompt('task', 'p0'), reply('ok', 'r1')]
  const out = applyTagRequests(reg(), rows, [{ op: 'title', text: 'A' }, { op: 'title', text: 'B' }, { op: 'title', text: 'C', x: 1 }, { op: 'add', kind: 'pin', index: 1 }])
  expect(out.registry.title).toEqual({ want: 'B' })
  expect(out.added).toBe(1)
  expect(out.changed).toBe(true)
  expect(out.rejected.map(r => r.code)).toEqual(['TITLE_FIELDS'])
  expect(out.lines.length).toBe(2)
  const bad = applyTagRequests(reg(), rows, [{ op: 'rename' }])
  expect(bad.rejected[0]!.reason).toContain('"title"')
})

// ---- [SP_CTX_02_71] PersonRename

test('PersonRename — походження: composer and sdk are the person; a plugin is not', () => {
  expect(isPersonRename({ origin: { kind: 'composer' } })).toBe(true)
  expect(isPersonRename({ origin: { kind: 'sdk' } })).toBe(true)
  expect(isPersonRename({ origin: { kind: 'plugin' } })).toBe(false)
})

test('PersonRename: with a name want = set = it and person; without one want and set go; refused goes, runs stay', () => {
  expect(personRename({ want: 'A', refused: 'x', runs: [{ after: 'h', title: 'A' }] }, ' Моя назва ')).toEqual({ want: 'Моя назва', set: 'Моя назва', runs: [{ after: 'h', title: 'A' }], person: true })
  expect(personRename({ want: 'A', set: 'A' }, '')).toEqual({ person: true })
  expect(personRename(undefined, 'x'.repeat(MAX_TITLE + 10)).want!.length).toBe(MAX_TITLE)
})

// ---- [SP_CTX_02_72] RunRename

function renameHarness(start: TitleState | undefined, fail?: string) {
  const log = { title: start, ran: [] as string[], debug: [] as string[] }
  const io: RenameIO = {
    readTitle: async () => ({ state: 'ok', value: log.title }),
    lastHandle: async () => 'r9',
    rename: async args => {
      log.ran.push(args)
      if (fail) throw new Error(fail)
    },
    updateTitle: async change => void (log.title = change(log.title)),
    debug: text => void log.debug.push(text),
  }
  return { io, log }
}

test('RunRename — пройшло: /rename with want; set = want and a run after the last row', async () => {
  const { io, log } = renameHarness({ want: 'A' })
  expect(await runRename(io)).toBe('ran')
  expect(log.ran).toEqual(['A'])
  expect(log.title).toEqual({ want: 'A', set: 'A', runs: [{ after: 'r9', title: 'A' }] })
})

test('RunRename — відмова: refused holds the host text, want goes; not due: no command; the rows unread: no run', async () => {
  const { io, log } = renameHarness({ want: 'A', set: 'Z' }, 'no session is bound')
  expect(await runRename(io)).toBe('refused')
  expect(log.title).toEqual({ set: 'Z', refused: 'no session is bound' })
  expect(log.debug).toEqual(['title: rename refused: no session is bound'])
  const idle = renameHarness({ want: 'A', set: 'A' })
  expect(await runRename(idle.io)).toBe(undefined)
  expect(idle.log.ran).toEqual([])
  const blind = renameHarness({ want: 'A' })
  blind.io.lastHandle = async () => {
    throw new Error('x')
  }
  expect(await runRename(blind.io)).toBe('ran')
  expect(blind.log.title).toEqual({ want: 'A', set: 'A' })
})

test('RunRename — want змінився під час команди: set takes the value run, the newer want stays due; a refusal keeps it too', () => {
  expect(renameRan({ want: 'B' }, 'A', 'h')).toEqual({ want: 'B', set: 'A', runs: [{ after: 'h', title: 'A' }] })
  expect(renameRefused({ want: 'B' }, 'A', new Error('no'))).toEqual({ want: 'B', refused: 'no' })
})

// ---- [SP_CTX_02_73] DropRenameRows

const RENAME_ROW = (title: string): SessionMessage => ({ role: 'user', text: `<command-name>/rename</command-name>\n            <command-message>rename</command-message>\n            <command-args>${title}</command-args>`, toolUses: [], handle: 'cmd' })

function talk(): SessionMessage[] {
  return [prompt('task', 'p0'), reply('first', 'r1'), prompt('next', 'p2'), reply('second', 'r3')]
}

test('DropRenameRows: the row before comes back without its handle; the report says so', () => {
  const rows = talk()
  const out = applyEdits(rows, [{ op: 'drop', tool_use_id: 'none' }], '', new Map(), new Set(), { renames: [{ after: 'r1', title: 'A' }] })
  expect(out.rows[1]).toEqual({ role: 'assistant', text: 'first', toolUses: [], toolResults: undefined })
  expect(out.rows[3]!.handle).toBe('r3')
  expect(out.report.hostLines).toEqual(['removed the rows of 1 rename(s) the mod ran'])
  expect(keepRuns({ set: 'A', runs: [{ after: 'r1', title: 'A' }] }, out.rows)).toEqual({ set: 'A' })
})

test('DropRenameRows — stream-json: the visible /rename row with those args goes; with other args it stays', () => {
  const rows = [...talk().slice(0, 2), RENAME_ROW('A'), ...talk().slice(2)]
  const out = applyEdits(rows, [], '', new Map(), new Set(), { renames: [{ after: 'r1', title: 'A' }] })
  expect(out.rows.map(r => r.text)).toEqual(['task', 'first', 'next', 'second'])
  const other = applyEdits(rows, [], '', new Map(), new Set(), { renames: [{ after: 'r1', title: 'B' }] })
  expect(other.rows.length).toBe(5)
  expect(isRenameRow(RENAME_ROW('A'), 'A')).toBe(true)
  expect(isRenameRow(RENAME_ROW('A'), 'B')).toBe(false)
  expect(isRenameRow(prompt('<command-name>/compact</command-name><command-args>A</command-args>'), 'A')).toBe(false)
})

test('DropRenameRows — рядок хоста на тому самому рядку: the row keeps its handle and the run stays; a row gone: the run goes at the commit', () => {
  const host: HostRowRecord = { id: 'h1', kind: 'skill', after: 'r1', afterKind: 'response', afterHead: 'your text "first"', text: 'skill', chars: 5 }
  const out = applyEdits(talk(), [], '', new Map(), new Set(), { renames: [{ after: 'r1', title: 'A' }], hostRows: [host] })
  expect(out.rows[1]!.handle).toBe('r1')
  expect(out.report.hostLines).toBe(undefined)
  expect(keepRuns({ runs: [{ after: 'r1', title: 'A' }] }, out.rows)).toEqual({ runs: [{ after: 'r1', title: 'A' }] })
  expect(keepRuns({ set: 'A', runs: [{ after: 'gone', title: 'A' }] }, talk())).toEqual({ set: 'A' })
})

test('DropRenameRows — рядок уже відʼєднано дропом рядка хоста: the run counts as dropped, the stream-json row goes', () => {
  const host: HostRowRecord = { id: 'h1', kind: 'skill', after: 'r1', afterKind: 'response', afterHead: 'your text "first"', text: 'skill', chars: 5 }
  const rows = [...talk().slice(0, 2), RENAME_ROW('A'), ...talk().slice(2)]
  const out = applyEdits(rows, [{ op: 'drop', host: 'h1' }], '', new Map(), new Set(), { renames: [{ after: 'r1', title: 'A' }], hostRows: [host] })
  expect(out.rows.map(r => r.text)).toEqual(['task', 'first', 'next', 'second'])
  expect(out.report.hostLines).toContain('removed the rows of 1 rename(s) the mod ran')
})

test('DropRenameRows — рядок хоста після рядка команди: the stream-json command row stays while a host row hangs on it', () => {
  const host: HostRowRecord = { id: 'h2', kind: 'skill', after: 'cmd', afterKind: 'prompt', afterHead: 'the command "/rename A"', text: 'skill', chars: 5 }
  const rows = [...talk().slice(0, 2), RENAME_ROW('A'), ...talk().slice(2)]
  const out = applyEdits(rows, [], '', new Map(), new Set(), { renames: [{ after: 'r1', title: 'A' }], hostRows: [host] })
  expect(out.rows.length).toBe(5)
  expect(out.rows[1]!.handle).toBe(undefined)
})

test('PersonText: a /rename row is no message of the person, the mod\'s or the person\'s own', () => {
  expect(personText(RENAME_ROW('A').text)).toBe('')
  expect(personText('<command-name>/model</command-name><command-args>opus</command-args>')).toBe('opus')
})

// ---- [SP_CTX_02_74] CarryTitle

test('CarryTitle: want goes on; a set alone becomes the want; person goes with it; never set, refused, runs', () => {
  expect(carryTitle({ want: 'A', set: 'Z', refused: 'x', runs: [{ after: 'h', title: 'Z' }] })).toEqual({ want: 'A' })
  expect(carryTitle({ set: 'B', person: true })).toEqual({ want: 'B', person: true })
  expect(carryTitle({ person: true })).toEqual({ person: true })
  expect(carryTitle(undefined)).toBe(undefined)
  expect(titleDue(carryTitle({ set: 'B' }))).toBe(true)
})

test('withTitle: undefined drops the field; the same title keeps the object', () => {
  const r = reg({ title: { want: 'A' } })
  expect('title' in withTitle(r, undefined)).toBe(false)
  expect(withTitle(r, r.title)).toBe(r)
})
