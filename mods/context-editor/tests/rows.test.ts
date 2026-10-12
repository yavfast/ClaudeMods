import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { aliasLine } from '../hooks/aliases'
import { failedQueue } from '../hooks/compaction'
import { formatReport, REF_HINT, type ApplyReport } from '../hooks/edits'
import { cancelHandoff, carryNote, DOCUMENT_FRAME, documentText } from '../hooks/handoff'
import { dueReminders } from '../hooks/notes'
import { COMMAND_NOTE, COMPACT_ADVICE, EMPTY_QUEUE, HANDOFF_MARKER, HANDOFF_RESUME_FRAME, LEGACY_HANDOFF_MARKER, LEGACY_MARKER, MARKER, personText, RESUME_FRAME, resumeText, DEFAULT_RESUME } from '../hooks/queue'
import { COMPACT_NOTHING } from '../hooks/stages'
import {
  charsOf,
  findToolResult,
  findToolUse,
  isEmptyRow,
  isPromptRow,
  isPromptRowStrict,
  MARK,
  modText,
  PREFIX,
  sameText,
  worthEditing,
} from '../hooks/rows'
import { compactTurnText, INTRO_TEXT, optimizeText, personAdvice, type ClosedBlock } from '../hooks/stages'
import { EMPTY_REGISTRY } from '../hooks/tags'

const block: ClosedBlock = { name: 'stage', after: null, end: null, turn: 3 }

const report: ApplyReport = {
  applied: ['summarize a'],
  failed: [],
  charsBefore: 9000,
  charsAfter: 1000,
  originals: [],
  produced: [],
  notesDropped: [],
  ownCallsRemoved: 0,
  mediaFiles: [],
}

// [SP_CTX_01_12] [SP_CTX_02_02] Every text the mod writes into the
// conversation under its own name — PREFIX or MARK first — is no message of
// the person: PersonText reads it as "". The producers converted to
// PREFIX/modText and MARK in audit phase 9 (CF-18).
test('PersonText — mod text producers: every text the mod writes under PREFIX or MARK is no message of the person', () => {
  const produced: [string, string][] = [
    ['modText', modText('anything at all')],
    ['MARKER', MARKER],
    ['HANDOFF_MARKER', HANDOFF_MARKER],
    ['resumeText default', resumeText(DEFAULT_RESUME)],
    ['resumeText RESUME_FRAME', resumeText('go on with the task')],
    ['resumeText HANDOFF_RESUME_FRAME', resumeText('go on with the task', HANDOFF_RESUME_FRAME)],
    ['DOCUMENT_FRAME', documentText('my notes', modText('this session continues s1 (document).'))],
    ['INTRO_TEXT', INTRO_TEXT],
    ['optimizeText', optimizeText(block, true)],
    ['personAdvice', personAdvice(block)],
    ['compactTurnText', compactTurnText(2)],
    ['COMPACT_NOTHING', COMPACT_NOTHING],
    ['COMPACT_ADVICE', COMPACT_ADVICE],
    ['formatReport compaction', formatReport(report, '/a/1.json', 'compaction')],
    ['formatReport compaction (no edit)', formatReport({ ...report, applied: [] }, '', 'compaction')],
    ['failedQueue report', failedQueue(undefined, 'boom', 1).report!],
    ['cancelHandoff report', cancelHandoff({ ...EMPTY_QUEUE, handoff: { mode: 'transcript', resume: true, resumePrompt: DEFAULT_RESUME, by: 'agent', state: 'queued', at: 1 } }, 'interrupted', 2).report!],
    ['aliasLine', aliasLine('c1')],
    ['carryNote', carryNote([], [])],
    ['dueReminders', dueReminders({ ...EMPTY_REGISTRY, turn: 5, notes: [{ id: 'n1', text: 'look again', createdTurn: 2, remindAt: 5, target: { tool_use_id: 'a' } }] })!.lines[0]!],
  ]
  for (const [name, text] of produced) {
    expect(text.startsWith(PREFIX) || text.startsWith(MARK) ? name : `${name}: no mod prefix`).toBe(name)
    expect(personText(text) === '' ? name : `${name}: read as the person's words`).toBe(name)
  }
  // the compaction marks as a slash command's arguments, as the host writes them
  expect(personText(`<command-name>/compact</command-name><command-args>${MARKER}</command-args>`)).toBe('')
  expect(personText(`<command-name>/compact</command-name><command-args>${HANDOFF_MARKER}</command-args>`)).toBe('')
  // [SP_CTX_DEC_26] rows of applies before phase 25 carry the old marks
  expect(personText(`<command-name>/compact</command-name><command-args>${LEGACY_MARKER}</command-args>`)).toBe('')
  expect(personText(`<command-name>/compact</command-name><command-args>${LEGACY_HANDOFF_MARKER}</command-args>`)).toBe('')
  // the person's own /compact instructions are the person's words
  expect(personText('<command-name>/compact</command-name><command-args>keep the API notes</command-args>')).toBe('keep the API notes')
  // CommandNote names the prefix of the marks it explains
  expect(COMMAND_NOTE).toContain(`"${PREFIX}"`)
})

// [SP_CTX_01_12] The texts built from PREFIX and MARK are byte-identical to
// the literals they replaced.
test('PREFIX і MARK — точні тексти: the built constants match the literals the host and the spec name', () => {
  expect(PREFIX).toBe('context-editor:')
  expect(MARK).toBe('[context-editor]')
  expect(modText('x')).toBe('context-editor: x')
  expect(MARKER).toBe('context-editor: apply queued edits (run automatically by the mod for context edits the agent queued, not by the person)')
  expect(HANDOFF_MARKER).toBe('context-editor: seed the handed-off conversation (run automatically by the mod, not by the person)')
  expect(LEGACY_MARKER).toBe('context-editor: apply queued edits')
  expect(LEGACY_HANDOFF_MARKER).toBe('context-editor: seed the handed-off conversation')
  expect(RESUME_FRAME).toBe('context-editor: the resume prompt you set before your edits applied: ')
  expect(HANDOFF_RESUME_FRAME).toBe('context-editor: the resume prompt you set before the handoff: ')
  expect(DOCUMENT_FRAME).toBe("context-editor: your handoff document from the previous session follows; it is your own text, not the person's.")
  expect(resumeText(DEFAULT_RESUME)).toBe('context-editor: Continue the task from where you stopped.')
  expect(REF_HINT).toBe('marked calls carry a "[context-editor] id cN" line after their result')
  expect(INTRO_TEXT.startsWith('context-editor: you can manage your own context.')).toBe(true)
})

const user = (text: string, extra: Partial<SessionMessage> = {}): SessionMessage => ({ role: 'user', text, toolUses: [], ...extra })

// [SP_CTX_02_04] [SP_CTX_02_16] The two prompt predicates differ only on a
// user row of whitespace alone without a handle.
test('PromptRow і PromptRowStrict: they differ only on a whitespace-only user row without a handle', () => {
  const blank = user('  \n')
  expect(isPromptRow(blank)).toBe(true)
  expect(isPromptRowStrict(blank)).toBe(false)
  for (const r of [user('hi'), user('', { handle: 'h' } as never), user(''), user('x', { toolResults: [{ tool_use_id: 'a', text: 'r' }] } as never)]) {
    expect(isPromptRow(r)).toBe(isPromptRowStrict(r))
  }
  expect(isEmptyRow(user(''))).toBe(true)
  expect(isPromptRow(user(''))).toBe(false)
})

test('rows kernel: pair lookup by id, chars of a span, text whitespace aside, the worth-editing policy', () => {
  const rows: SessionMessage[] = [
    user('go'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] } as SessionMessage,
    user('', { toolResults: [{ tool_use_id: 'a', text: 'abc' }] } as never),
  ]
  expect(findToolUse(rows, 'a')).toBe(1)
  expect(findToolResult(rows, 'a')).toBe(2)
  expect(findToolUse(rows, 'z')).toBe(-1)
  expect(charsOf(rows, 0, 0)).toBe(2)
  expect(charsOf(rows, -3, 99)).toBe(2 + 2 + 3)
  expect(sameText('a b\nc', 'abc')).toBe(true)
  expect(worthEditing('Read', 3999)).toBe(false)
  expect(worthEditing('Read', 4000)).toBe(true)
  expect(worthEditing('Grep', 1)).toBe(true)
})
