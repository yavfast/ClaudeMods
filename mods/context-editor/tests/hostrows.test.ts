import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  closeWindow,
  detachNote,
  emptyHostRows,
  headOf,
  hostHeader,
  hostKind,
  hostSection,
  keepHostRows,
  rebaseHostRows,
  MAX_HEAD,
  MAX_HOST_LIST,
  MAX_HOST_ROWS,
  newHostMemory,
  observeHostRow,
  openWindow,
  parseHostRows,
  recordHostRow,
  withHostRow,
  type HostEvent,
  type HostRowRecord,
  type HostRows,
} from '../hooks/hostrows'
import { applyEdits, checkShape, formatReport, ownerKey, prepare, type QueuedEdit } from '../hooks/edits'
import { handleCompaction } from '../hooks/compaction'
import { EMPTY_QUEUE, queueEdits } from '../hooks/queue'
import { MARKER, PEER_FRAME, SKILL_FRAME } from '../hooks/rows'
import { renewOf, type Read } from '../hooks/store'
import { harness } from './compaction-fixtures'
import { memStore, okRead } from './row-fixtures'

const SKILL = `${SKILL_FRAME}/home/u/.claude/skills/dev-flow\n\n# Concept-Driven Development`
const PEER = `${PEER_FRAME} from="a1">done</agent-message>`

// A `session.append` event of the main conversation.
function ev(door: string, uuid: string, type: 'user' | 'assistant' | 'attachment', text: string, extra: Partial<HostEvent> & { meta?: boolean; blocks?: HostEvent['message']['content'] } = {}): HostEvent {
  const { meta, blocks, ...rest } = extra
  return {
    door,
    uuid,
    origin: { kind: door === 'response' ? 'model' : 'unclassified' },
    message: { type, ...(meta ? { isMeta: true as const } : {}), content: blocks ?? [{ type: 'text', text }] },
    ...rest,
  }
}

const command = (name: string, args: string) => `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`

function record(id: string, after: string, kind: HostRowRecord['kind'] = 'skill', afterKind: HostRowRecord['afterKind'] = 'prompt', text = kind === 'skill' ? SKILL : PEER): HostRowRecord {
  return { id, kind, after, afterKind, afterHead: 'the prompt "task"', text, chars: text.length }
}

// ---- [SP_CTX_02_60] RecordHostRows

test('RecordHostRows — розгорнута навичка: an isMeta row in the skill frame after the person\'s /dev-flow spec is recorded after the command', () => {
  const mem = newHostMemory()
  expect(observeHostRow(mem, ev('command', 'u-cmd', 'user', command('dev-flow', 'spec')))).toBe(undefined)
  const draft = observeHostRow(mem, ev('note', 'u-skill', 'user', SKILL, { meta: true, origin: { kind: 'engine' } }))
  expect(draft).toEqual({ kind: 'skill', after: 'u-cmd', afterKind: 'prompt', afterHead: 'the command "/dev-flow spec"', text: SKILL, chars: SKILL.length })
  expect(withHostRow(emptyHostRows(), draft!, 1 << 20)).toEqual({ rows: [{ id: 'h1', ...draft! }], next: 2 })
})

test('RecordHostRows — вікно копій: after a compaction branch opened it, a copy, the mod\'s /compact rows and a peer report are no row before; nothing is recorded', () => {
  const mem = newHostMemory()
  observeHostRow(mem, ev('prompt', 'u1', 'user', 'task'))
  openWindow(mem)
  expect(mem.last).toBe(undefined)
  // the mod's own /compact by the prompt door (terminal), its marker in the args
  expect(observeHostRow(mem, ev('prompt', 'u-compact', 'user', command('compact', MARKER)))).toBe(undefined)
  // a copy of an assistant row in stream-json
  expect(observeHostRow(mem, ev('response', 'u-copy', 'assistant', 'old answer', { origin: { kind: 'model' } }))).toBe(undefined)
  expect(observeHostRow(mem, ev('note', 'u-peer', 'user', PEER, { meta: true, origin: { kind: 'peer' } }))).toBe(undefined)
  expect(mem.last).toBe(undefined)
  expect(mem.window).toBe(true)
})

test('RecordHostRows — промпт людини закриває вікно: the record stands after the person\'s prompt; turn.start closes it too', () => {
  const mem = newHostMemory()
  openWindow(mem)
  observeHostRow(mem, ev('prompt', 'u-next', 'user', 'go on'))
  expect(mem.window).toBe(false)
  expect(observeHostRow(mem, ev('note', 's', 'user', SKILL, { meta: true }))?.after).toBe('u-next')
  openWindow(mem)
  closeWindow(mem)
  observeHostRow(mem, ev('response', 'r1', 'assistant', 'ok'))
  expect(mem.last?.handle).toBe('r1')
})

test('RecordHostRows — рядок виводу локальної команди: <local-command-stdout> of the mod\'s /compact keeps the window open', () => {
  const mem = newHostMemory()
  openWindow(mem)
  observeHostRow(mem, ev('prompt', 'out', 'user', '<local-command-stdout>Compacted </local-command-stdout>', { origin: { kind: 'composer' } }))
  expect(mem.window).toBe(true)
  expect(observeHostRow(mem, ev('note', 'p', 'user', PEER, { meta: true, origin: { kind: 'peer' } }))).toBe(undefined)
})

test('RecordHostRows — інші рядки: a reminder without a frame, a subagent\'s row, an attachment, a row with a result or media, and a host row before any visible row give nothing', () => {
  const mem = newHostMemory()
  expect(observeHostRow(mem, ev('note', 's0', 'user', SKILL, { meta: true }))).toBe(undefined)
  observeHostRow(mem, ev('prompt', 'u1', 'user', 'task'))
  expect(observeHostRow(mem, ev('note', 'm', 'user', '<system-reminder>x</system-reminder>', { meta: true }))).toBe(undefined)
  expect(observeHostRow(mem, ev('note', 'm', 'user', '<local-command-caveat>x</local-command-caveat>', { meta: true }))).toBe(undefined)
  expect(observeHostRow(mem, ev('note', 's', 'user', SKILL, { meta: true, agentId: 'sub' }))).toBe(undefined)
  expect(observeHostRow(mem, ev('delivery', 'd', 'attachment', PEER))).toBe(undefined)
  expect(observeHostRow(mem, ev('note', 's', 'user', SKILL, { meta: true, blocks: [{ type: 'text', text: SKILL }, { type: 'image', source: {} }] }))).toBe(undefined)
  // a subagent's row never moves the row before
  observeHostRow(mem, ev('response', 'sub-r', 'assistant', 'x', { agentId: 'sub' }))
  expect(mem.last?.handle).toBe('u1')
})

test('RecordHostRows — Head: a prompt, a command, a response with text, a call row, a result; cut to MAX_HEAD', () => {
  expect(headOf('prompt', 'fix the bug', [])).toBe('the prompt "fix the bug"')
  expect(headOf('prompt', command('dev-flow', 'spec'), [])).toBe('the command "/dev-flow spec"')
  expect(headOf('response', 'I read it', ['Read'])).toBe('your text "I read it"')
  expect(headOf('response', '', ['Skill'])).toBe('your call Skill')
  expect(headOf('result', 'Launching skill', [])).toBe('the result of a tool call')
  const long = headOf('prompt', 'x'.repeat(500), [])
  expect(long.length <= MAX_HEAD).toBe(true)
  expect(long.endsWith('…"')).toBe(true)
  // the kinds of rows before: a result row of the main conversation
  const mem = newHostMemory()
  observeHostRow(mem, ev('tool-result', 'res', 'user', '', { blocks: [{ type: 'tool_result', tool_use_id: 't', content: 'Launching skill' }], origin: { kind: 'tool' } }))
  expect(observeHostRow(mem, ev('tool-message', 's', 'user', SKILL, { meta: true, origin: { kind: 'tool' } }))).toMatchObject({ after: 'res', afterKind: 'result', afterHead: 'the result of a tool call' })
})

test('HostFrame: the skill frame, the peer frame, none', () => {
  expect(hostKind(SKILL)).toBe('skill')
  expect(hostKind(PEER)).toBe('peer')
  expect(hostKind('Base directory')).toBe(undefined)
})

test('HostRows file: ids from next, the oldest go past MAX_HOST_ROWS or the byte cap; parse checks the records; a long text is cut', () => {
  let h: HostRows = emptyHostRows()
  const draft = { kind: 'peer' as const, after: 'u', afterKind: 'response' as const, afterHead: 'your text "x"', text: 'p', chars: 1 }
  for (let k = 0; k < MAX_HOST_ROWS + 3; k++) h = withHostRow(h, draft, 1 << 30)
  expect(h.rows.length).toBe(MAX_HOST_ROWS)
  expect(h.rows[0]!.id).toBe('h4')
  expect(h.next).toBe(MAX_HOST_ROWS + 4)
  expect(parseHostRows(JSON.stringify(h))).toEqual({ state: 'ok', value: h })
  expect(withHostRow(emptyHostRows(), { ...draft, text: 'y'.repeat(400) }, 300).rows).toEqual([])
  expect(parseHostRows('{"rows":[],"next":0}').state).toBe('unreadable')
  expect(parseHostRows(JSON.stringify({ rows: [{ ...draft, id: 'h2' }], next: 2 })).state).toBe('unreadable')
  expect(parseHostRows(JSON.stringify({ rows: [{ ...draft, id: 'x1' }], next: 2 })).state).toBe('unreadable')
  expect(parseHostRows(JSON.stringify({ rows: [{ ...draft, id: 'h1', chars: 0 }], next: 2 })).state).toBe('unreadable')
  const mem = newHostMemory()
  observeHostRow(mem, ev('prompt', 'u', 'user', 'go'))
  const big = `${SKILL}${'z'.repeat(200_000)}`
  const cut = observeHostRow(mem, ev('note', 's', 'user', big, { meta: true }))!
  expect(cut.text.length).toBe(100_000)
  expect(cut.chars).toBe(big.length)
})

test('RecordHostRows — запис: an unreadable file goes aside and a new one starts; one that cannot be moved aside is never overwritten', async () => {
  const draft = { kind: 'skill' as const, after: 'u', afterKind: 'prompt' as const, afterHead: 'the prompt "go"', text: SKILL, chars: SKILL.length }
  const bad: Read<HostRows> = { state: 'unreadable', reason: 'not JSON' }
  const moved = memStore<HostRows>(bad, emptyHostRows, parseHostRows)
  await recordHostRow(renewOf(moved.store), draft, 1 << 20)
  expect(moved.log.quarantined).toBe(1)
  expect(moved.log.file).toEqual({ state: 'ok', value: { rows: [{ id: 'h1', ...draft }], next: 2 } })
  const stuck = memStore<HostRows>(bad, emptyHostRows, parseHostRows)
  stuck.log.stuck = true
  await recordHostRow(renewOf(stuck.store), draft, 1 << 20)
  expect(stuck.log.writes).toBe(0)
  expect(stuck.log.file.state).toBe('unreadable')
})

test('KeepHostRows: a record stays only while its row before came back with its handle, then by its position among the returned rows; the next apply rebases it', () => {
  const h: HostRows = { rows: [record('h1', 'p0'), record('h2', 'r4', 'peer', 'response')], next: 3 }
  // the apply returned p0 at 0 with its handle, r4 rebuilt
  const kept = keepHostRows(h, [], ['p0', undefined, 'r2'])!
  expect(kept).toEqual({ rows: [{ ...record('h1', 'p0'), after: '#0' }], next: 3 })
  // the host's copies have new uuids: row 0 of the next input is the copy of p0
  const next: SessionMessage[] = [{ role: 'user', text: 'task', toolUses: [], handle: 'p0-copy' }, { role: 'assistant', text: 'x', toolUses: [], handle: 'r9' }]
  expect(rebaseHostRows(kept.rows, next)[0]!.after).toBe('p0-copy')
  // a position on a row of another kind, or without a handle, names no row
  expect(rebaseHostRows([{ ...record('h1', 'p0'), after: '#1' }], next)[0]!.after).toBe('#1')
  expect(rebaseHostRows([{ ...record('h1', 'p0'), after: '#5' }], next)[0]!.after).toBe('#5')
  // a prompt at that position with another head (stale positions, a shifted chain) is not the row before
  expect(rebaseHostRows([{ ...record('h1', 'p0'), after: '#0' }], [{ role: 'user', text: 'another prompt', toolUses: [], handle: 'x' }])[0]!.after).toBe('#0')
  // a row without a handle there names no row
  expect(rebaseHostRows([{ ...record('h1', 'p0'), after: '#0' }], [{ role: 'user', text: 'task', toolUses: [] }])[0]!.after).toBe('#0')
  // a second apply that returns the copy at 3: the record follows it
  expect(keepHostRows(kept, next, [undefined, undefined, undefined, 'p0-copy'])).toEqual({ rows: [{ ...record('h1', 'p0'), after: '#3' }], next: 3 })
  // the same positions: nothing to write; a position not rebased goes
  expect(keepHostRows(kept, [], ['p0'])).toEqual({ rows: [], next: 3 })
  expect(keepHostRows({ rows: [{ ...record('h1', 'p0'), after: '#0' }], next: 3 }, next, ['p0-copy'])).toBe(undefined)
})

// ---- [SP_CTX_02_61] HostList

test('HostList — список: the header names every record, the section the newest MAX_HOST_LIST, newest last; none without records', () => {
  expect(hostHeader(emptyHostRows())).toBe('')
  expect(hostSection(emptyHostRows())).toBe('')
  const h: HostRows = { rows: [record('h1', 'p0'), record('h2', 'r4', 'peer', 'response')], next: 3 }
  expect(hostHeader(h)).toBe(`Host rows: 2 (~${SKILL.length + PEER.length} chars), not in the indexes; drop one with {"op":"drop","host":"<id>"}: h1 skill, h2 peer`)
  const section = hostSection(h).split('\n')
  expect(section[0]).toBe("Host rows (added by the host, not the person's words):")
  expect(section[1]!.startsWith(`h1 skill, ${SKILL.length} chars, after the prompt "task": "Base directory for this skill:`)).toBe(true)
  expect(section[2]!.startsWith('h2 peer')).toBe(true)
  const many: HostRows = { rows: Array.from({ length: MAX_HOST_LIST + 5 }, (_, k) => record(`h${k + 1}`, 'p0')), next: MAX_HOST_LIST + 6 }
  const lines = hostSection(many).split('\n')
  expect(lines.length).toBe(MAX_HOST_LIST + 1)
  expect(lines[1]!.startsWith('h6 ')).toBe(true)
  expect(hostHeader(many)).toContain('h1 skill, h2 skill')
})

test('DetachNote: a prompt, a response; none for a result row', () => {
  expect(detachNote({ afterKind: 'prompt' })).toContain("the host's attachments of that prompt (reminders, files, editor context) go; its text stays")
  expect(detachNote({ afterKind: 'response' })).toContain('its thinking blocks go')
  expect(detachNote({ afterKind: 'result' })).toBe('')
})

// The rows before the host rows: a prompt, a response, a call and its result, a text.
function conversation(): SessionMessage[] {
  return [
    { role: 'user', text: 'task', toolUses: [], handle: 'p0' },
    { role: 'assistant', text: 'on it', toolUses: [], handle: 'r1' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b', tool: 'Skill', input: { skill: 'dev-flow' } }], handle: 'r2' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b', text: 'Launching skill: dev-flow', isError: false }], handle: 'res3' },
    { role: 'assistant', text: 'done', toolUses: [], handle: 'r4' },
  ]
}

const RECORDS = [record('h1', 'p0'), record('h2', 'r4', 'peer', 'response'), record('h3', 'res3', 'skill', 'result'), record('h4', 'res3', 'peer', 'result')]

test('HostList — постановка: host excludes tool_use_id and ref, an unknown id, the same id twice in the batch; DetachNote in the result', () => {
  expect(checkShape({ op: 'drop', host: 'h1', tool_use_id: 'b' })).toBe('host excludes tool_use_id and ref')
  expect(checkShape({ op: 'drop', host: 'h1', ref: 'c1' })).toBe('host excludes tool_use_id and ref')
  expect(checkShape({ op: 'drop', host: 'x' })).toContain('host is the id of a host row')
  expect(checkShape({ op: 'drop', host: 'h1' })).toEqual({ op: 'drop', host: 'h1' })
  const rows = conversation()
  const out = queueEdits({ ...EMPTY_QUEUE, edits: [] }, rows, { edits: [{ op: 'drop', host: 'h1' }, { op: 'drop', host: 'h9' }, { op: 'drop', host: 'h1' }, { op: 'drop', host: 'h1', ref: 'c3' }] }, undefined, undefined, false, undefined, [], RECORDS)
  if ('deny' in out) throw new Error(out.deny)
  expect(out.queue.edits).toEqual([{ op: 'drop', host: 'h1' }])
  expect(out.errors).toEqual(['drop h9: no host row h9; context_list names them', 'edit 3: host row h1 is already in this batch', 'edit 4: host excludes tool_use_id and ref'])
  expect(out.warnings).toEqual([`drop h1: ${detachNote({ afterKind: 'prompt' })}.`])
  // one already queued
  const again = prepare(rows, [{ op: 'drop', host: 'h1' }], undefined, undefined, false, [{ op: 'drop', host: 'h1' }], RECORDS)
  expect(again.errors).toEqual(['edit 1: host row h1 is already in this batch'])
  // a result row before it: no note
  const r = queueEdits({ ...EMPTY_QUEUE, edits: [] }, rows, { edits: [{ op: 'drop', host: 'h3' }] }, undefined, undefined, false, undefined, [], RECORDS)
  if ('deny' in r) throw new Error(r.deny)
  expect(r.warnings).toEqual([])
})

test('HostList — drop за id: the row before comes back without its handle, its text the same; the host row\'s text goes to the archive; the report names it', () => {
  const rows = conversation()
  const out = applyEdits(rows, [{ op: 'drop', host: 'h1' }], '/a/1.json', new Map(), new Set(), { hostRows: RECORDS })
  expect(out.report.applied).toEqual(['drop h1'])
  expect(out.rows[0]).toEqual({ role: 'user', text: 'task', toolUses: [], toolResults: undefined })
  expect(out.rows.slice(1).every(r => r.handle !== undefined || r.toolResults?.length)).toBe(true)
  expect(out.report.originals).toEqual([{ edit: 'drop h1', rows: [{ role: 'user', text: SKILL, toolUses: [] }] }])
  expect(out.report.hostLines).toEqual([`dropped host row h1 (skill, ${SKILL.length} chars)`, `h1: ${detachNote({ afterKind: 'prompt' })}`])
  expect([...out.hostNamed]).toEqual(['h1'])
  const text = formatReport(out.report, '/a/1.json', 'compaction')
  expect(text).toContain(`dropped host row h1 (skill, ${SKILL.length} chars).`)
})

test('HostList — два рядки за одним попередником: drop h3, h4 stands after the same row; both go, the report says so; dropping both names each once', () => {
  const rows = conversation()
  const out = applyEdits(rows, [{ op: 'drop', host: 'h3' }], '', new Map(), new Set(), { hostRows: RECORDS })
  expect(out.report.hostLines).toEqual([`dropped host row h3 (skill, ${SKILL.length} chars)`, 'h4 (peer) went with it: the host keeps them after the same row'])
  expect(out.rows[3]!.handle).toBe(undefined)
  expect(out.report.originals[0]!.rows.map(r => r.text)).toEqual([SKILL, PEER])
  const both = applyEdits(rows, [{ op: 'drop', host: 'h3' }, { op: 'drop', host: 'h4' }], '', new Map(), new Set(), { hostRows: RECORDS })
  expect(both.report.applied).toEqual(['drop h3', 'drop h4'])
  expect(both.report.failed).toEqual([])
})

test('HostList — попередника змінено іншою правкою: a rewrite of the row before takes the host row with it; the drop counts as applied', () => {
  const rows = conversation()
  const edits: QueuedEdit[] = [{ op: 'rewrite', index: 4, text: 'finished' }, { op: 'drop', host: 'h2' }]
  const out = applyEdits(rows, edits, '', new Map(), new Set(), { hostRows: RECORDS })
  expect(out.report.applied).toEqual(['rewrite #4', 'drop h2'])
  expect(out.report.hostLines).toEqual(['h2 went with the rows your edits replaced.'])
})

test('HostList — відмови при застосуванні: media in the row before (HOST_MEDIA), a prompt beside unmatched prompt media, no record now, no such row now, a result outside the API window', () => {
  const rows = conversation()
  const media = applyEdits(rows, [{ op: 'drop', host: 'h3' }], '', new Map(), new Set([ownerKey({ tool_use_id: 'b' })]), { hostRows: RECORDS })
  expect(media.report.failed).toEqual(['drop h3: the row before h3 holds media that would be lost; describe or summarize it first'])
  expect(media.rows[3]!.handle).toBe('res3')
  const prompt = applyEdits(rows, [{ op: 'drop', host: 'h1' }], '', new Map(), new Set(), { hostRows: RECORDS, unmatchedPromptMedia: 1 })
  expect(prompt.report.failed).toEqual(['drop h1: the row before h1 holds media that would be lost; describe or summarize it first'])
  const gone = applyEdits(rows, [{ op: 'drop', host: 'h1' }], '', new Map(), new Set(), { hostRows: [] })
  expect(gone.report.failed).toEqual(['drop h1: no such host row now'])
  const noRow = applyEdits(rows, [{ op: 'drop', host: 'h7' }], '', new Map(), new Set(), { hostRows: [record('h7', 'elsewhere')] })
  expect(noRow.report.failed).toEqual(['drop h7: no such row now'])
  expect([...noRow.hostNamed]).toEqual(['h7'])
  const window = applyEdits(rows, [{ op: 'drop', host: 'h3' }], '', new Map(), new Set(), { hostRows: RECORDS, knownResults: new Set() })
  expect(window.report.failed).toEqual(['drop h3: outside the API window; media unknown'])
  // two records with one id: the newest
  const twice = applyEdits(rows, [{ op: 'drop', host: 'h1' }], '', new Map(), new Set(), { hostRows: [record('h1', 'elsewhere'), record('h1', 'p0')] })
  expect(twice.report.applied).toEqual(['drop h1'])
})

test('HostList — попередник із thinking-відповіді: Detach rebuilds the whole response (KeepResponsesWhole); FrozenPrefix stops before it', () => {
  const rows = conversation()
  const out = applyEdits(rows, [{ op: 'drop', host: 'h2' }], '', new Map(), new Set(), { hostRows: RECORDS, freeze: { api: [] } })
  // the response of r4 starts at r1: the prompt alone stays frozen, every row of the response is rebuilt
  expect(out.prefix).toBe(1)
  expect(out.rows[0]!.handle).toBe('p0')
  expect(out.rows.slice(1).every(r => r.handle === undefined)).toBe(true)
})

test('HandleCompaction — рядки хоста: the drop applies, the records whose row before went are named, the kept handles go to KeepHostRows after the commit', async () => {
  const conv = (): SessionMessage[] => [
    { role: 'user', text: 'task', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'z', tool: 'mcp__context-editor__context_list', input: {} }], handle: 'h1' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'z', text: 'listing', isError: false }], handle: 'h2' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'h3' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x'.repeat(5000), isError: false }], handle: 'h4' },
  ]
  const records = [record('h1', 'h0'), record('h2', 'h4', 'peer', 'result'), record('h5', 'h2', 'peer', 'result')]
  let kept: readonly (string | undefined)[] | undefined
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits: [{ op: 'drop', host: 'h1' }] as QueuedEdit[] }), {
    readHostRows: async () => okRead({ rows: records, next: 6 }),
    keepHostRows: (_input, out) => void (kept = out),
  })
  const out = await handleCompaction(io, conv())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(out.messages[0]!.handle).toBe(undefined)
  expect(written.queue!.report).toContain(`dropped host row h1 (skill, ${SKILL.length} chars).`)
  expect(written.queue!.report).toContain('Host rows that went with rebuilt rows: h5 (peer).')
  expect(written.archiveText).toContain('Base directory for this skill')
  // the result row of a keeps its handle (its image in the API form), and its record with it
  expect(kept?.includes('h4')).toBe(true)
  expect(kept?.includes('h0')).toBe(false)
})

test('HandleCompaction — без правок рядків хоста: the records stay where their rows keep the handle; an unreadable file names nothing', async () => {
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits: [{ op: 'summarize', tool_use_id: 'a', summary: 's' }] as QueuedEdit[] }), {
    readHostRows: async () => ({ state: 'unreadable', reason: 'not JSON' }),
    keepHostRows: () => {
      throw new Error('not called without records')
    },
  })
  const out = await handleCompaction(io, [
    { role: 'user', text: 'task', toolUses: [], handle: 'h0' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'h3' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x'.repeat(5000), isError: false }], handle: 'h4' },
  ])
  expect('messages' in out).toBe(true)
  expect(written.queue!.report).not.toContain('Host rows')
})

test('HandleCompaction — запис після попереднього застосування: a record kept as #0 names row 0 of this input (the copy, a new handle); the drop detaches it', async () => {
  let kept: readonly (string | undefined)[] | undefined
  const { io, written } = harness(okRead({ ...EMPTY_QUEUE, edits: [{ op: 'drop', host: 'h1' }] as QueuedEdit[] }), {
    readHostRows: async () => okRead({ rows: [{ ...record('h1', 'old-uuid'), after: '#0' }, { ...record('h2', 'old-r'), after: '#1', afterKind: 'response' as const }], next: 3 }),
    keepHostRows: (_input, out) => void (kept = out),
  })
  const out = await handleCompaction(io, [
    { role: 'user', text: 'task', toolUses: [], handle: 'copy-0' },
    { role: 'assistant', text: 'ok', toolUses: [], handle: 'copy-1' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'copy-2' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x'.repeat(5000), isError: false }], handle: 'copy-3' },
  ])
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.queue!.report).toContain('dropped host row h1')
  expect(out.messages[0]!.handle).toBe(undefined)
  expect(kept).toBeDefined()
})
