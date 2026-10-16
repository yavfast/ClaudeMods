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
  collapsedWords,
  COLLAPSED_OPENER,
  DESCRIBED,
  DESCRIBED_HEAD,
  describedWords,
  documentRow,
  hostFrame,
  pasteBlocks,
  PEER_FRAME,
  SKILL_FRAME,
  withPasteMarks,
  isCollapseText,
  isDescribedText,
  isReplacementText,
  LEGACY_COLLAPSED_OPENER,
  LEGACY_DESCRIBED,
  MARK,
  REPLACED,
  REPLACEMENT_OPENERS,
  TAG_COLLAPSED_OPENER,
  TAG_REWRITTEN,
  TAG_SUMMARIZED,
  TAG_SUMMARIZED_OF,
  TRACE_OPENER,
  STATE_REBUILT,
  REWRITTEN,
  SUMMARIZED,
  SUMMARIZED_OF,
  summarizedWords,
  modText,
  PREFIX,
  sameText,
  worthEditing,
} from '../hooks/rows'
import { compactTurnText, INTRO_TEXT, waitingAdvice, type ClosedBlock } from '../hooks/stages'
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
    ['waitingAdvice', waitingAdvice(block)],
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
  // phase 31 (CF-52): a search tool's error counts by its size only
  expect(worthEditing('Grep', 1, true)).toBe(false)
  expect(worthEditing('Grep', 5000, true)).toBe(true)
  expect(worthEditing('Read', 5000, true)).toBe(true)
})

// [SP_CTX_02_04] [SP_CTX_DEC_17] (A″, phase 28) The replacement texts open
// with the agent's own context_edit call, without MARK; the openers of phases
// 19–27 (MARK first) still count, since sessions applied before carry them.
test('ReplacementText — тексти фази 28 і старі: the new openers have no MARK; isReplacementText, isCollapseText and isDescribedText take both forms; PersonText reads none as the person', () => {
  expect(REPLACED).toBe('Later, your context_')
  expect(SUMMARIZED).toBe('Later, your context_edit summarize call replaced the full output you had read here with your own summary')
  expect(REWRITTEN).toBe('Later, your context_edit rewrite call replaced the text of this row with your own rewrite')
  expect(DESCRIBED).toBe('Later, your context_edit describe call replaced the media you had seen here with your own description')
  expect(collapsedWords(5, 'Read cfg.txt; Bash ls')).toBe('Later, your context_edit collapse call replaced these 5 rows you had read (Read cfg.txt; Bash ls) with your own note')
  // [SP_CTX_02_13] a disposable tag's replacement names context_tag
  expect(collapsedWords(3, '', 'tag')).toBe('Later, your context_tag disposable tag replaced these 3 rows you had read with your own note')
  expect(REPLACEMENT_OPENERS).toEqual([SUMMARIZED, REWRITTEN, DESCRIBED_HEAD, COLLAPSED_OPENER, TAG_SUMMARIZED, TAG_REWRITTEN, TAG_COLLAPSED_OPENER, SUMMARIZED_OF, TAG_SUMMARIZED_OF, TRACE_OPENER, STATE_REBUILT])
  // [SP_CTX_02_64] the trace row is a replacement text: no person's words, the `*` flag
  expect(isReplacementText(`${TRACE_OPENER}; you had called context_list.`)).toBe(true)
  expect(personText(`${TRACE_OPENER}; you had called context_list.`)).toBe('')
  for (const t of REPLACEMENT_OPENERS) expect(t.startsWith(REPLACED) && !t.includes(MARK)).toBe(true)
  const now = [`${SUMMARIZED}: s`, `${REWRITTEN}: s`, `${DESCRIBED}: d\n\nwhat is it?`, `${collapsedWords(2)}: s`, `${TAG_SUMMARIZED}: s`, `${TAG_REWRITTEN}: s`, `${collapsedWords(2, 'Read a', 'tag')}: s`]
  const legacy = [
    '[context-editor] you read the full output here, then replaced it with your summary: s',
    '[context-editor] you rewrote this row: s',
    `${LEGACY_DESCRIBED}: d\n\nwhat is it?`,
    `${LEGACY_COLLAPSED_OPENER}2 rows, then collapsed them into your note: s`,
    // before phase 19
    '[context-editor] summarized (original: /s/1.json): s',
  ]
  for (const t of [...now, ...legacy]) {
    expect(isReplacementText(t) ? t : `${t}: not a replacement`).toBe(t)
    expect(personText(t)).toBe('')
  }
  expect([...now, ...legacy].map(isCollapseText)).toEqual([false, false, false, true, false, false, true, false, false, false, true, false])
  expect([...now, ...legacy].map(isDescribedText)).toEqual([false, false, true, false, false, false, false, false, false, true, false, false])
  // the person's words and a tool's output are none
  // the whole opener, not its start: a person quoting the start back, or docs about it, is no replacement
  for (const t of ['Later, your build failed', 'later, your context_edit summarize call', 'context_edit summarize', '', 'Later, your context_edit call looked odd', 'Later, your context_tag disposable tag replaced it?']) expect(isReplacementText(t)).toBe(false)
  expect(personText('Later, your context_edit call looked odd')).toBe('Later, your context_edit call looked odd')
  expect(personText('Later, your build failed')).toBe('Later, your build failed')
})

// [SP_CTX_02_62] [SP_CTX_DEC_44] phase 41: the summarize opener names the
// source; Quoted only when DependencyCheck found quotes; no status words.
test('ReplacementOpeners — відкривачі з джерелом: summarize and the tag\'s summarize name the source; Quoted before the tail; collapse takes Quoted; old and new openers are both replacements', () => {
  expect(summarizedWords('Read docs/x.md')).toBe('Later, your context_edit summarize call replaced the full output of Read docs/x.md you had read here with your own summary')
  expect(summarizedWords('Read docs/x.md', 'edit', true)).toBe('Later, your context_edit summarize call replaced the full output of Read docs/x.md you had read here, which you quoted from later, with your own summary')
  expect(summarizedWords('Bash "ls -la"', 'tag')).toBe('Later, your context_tag disposable tag replaced the full output of Bash "ls -la" you had read here with your own note')
  expect(collapsedWords(4, 'Read ×2', 'edit', true)).toBe('Later, your context_edit collapse call replaced these 4 rows you had read (Read ×2), which you quoted from later, with your own note')
  expect(collapsedWords(4, 'Read ×2')).toBe('Later, your context_edit collapse call replaced these 4 rows you had read (Read ×2) with your own note')
  const old = [`${SUMMARIZED}: s`, `${TAG_SUMMARIZED}: s`]
  const fresh = [`${summarizedWords('Read a.md')} (original: /s/1.json, open with Read): s`, `${summarizedWords('WebSearch "q"', 'tag')}: s`]
  for (const t of [...old, ...fresh]) {
    expect(isReplacementText(t) ? t : `${t}: not a replacement`).toBe(t)
    expect(personText(t)).toBe('')
    expect(isCollapseText(t) || isDescribedText(t)).toBe(false)
  }
  for (const t of fresh) expect(/\b(verified|inferred|assumed)\b/.test(t)).toBe(false)
})

// [SP_CTX_02_58] [SP_CTX_02_59] [SP_CTX_02_68] phase 40
test('HostFrame, PasteBlocks, DescribedWords, DocumentRow: the host\'s frames are no person\'s words; paste blocks by order; the document after the plugin frame', async () => {
  const skill = `${SKILL_FRAME}/home/u/.claude/skills/dev-flow\n\n# Concept-Driven Development`
  const peer = `${PEER_FRAME} from="a1">\nreport</agent-message>`
  expect(hostFrame(skill) && hostFrame(peer)).toBe(true)
  expect(personText(skill)).toBe('')
  expect(personText(peer)).toBe('')
  expect(personText('please read Base directory for this skill: x')).toBe('please read Base directory for this skill: x')
  const text = 'a <pasted_content id="f00d">X</pasted_content id="f00d"> b <pasted_content>YY</pasted_content> c <pasted_content id="1">bad</pasted_content id="2">'
  const blocks = pasteBlocks(text)
  expect(blocks.map(b => b.chars)).toEqual([1, 2])
  expect(withPasteMarks(text, blocks).startsWith('a [pasted text 1, 1 chars: see your description above] b [pasted text 2, 2 chars: see your description above] c <pasted_content id="1">')).toBe(true)
  expect(describedWords(true, false)).toBe(DESCRIBED)
  expect(describedWords(false, true).startsWith(DESCRIBED_HEAD)).toBe(true)
  for (const w of [describedWords(false, true), describedWords(true, true)]) {
    expect(isReplacementText(`${w}: d\n\nhi`)).toBe(true)
    expect(isDescribedText(`${w}: d\n\nhi`)).toBe(true)
  }
  const doc = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
  expect(documentRow(doc(`The context-editor plugin sent a message:\n${DOCUMENT_FRAME}\n\nnotes`))).toBe(true)
  expect(documentRow(doc(`${DOCUMENT_FRAME}\n\nnotes`))).toBe(true)
  expect(documentRow(doc(`please look: ${DOCUMENT_FRAME}`))).toBe(false)
  expect(documentRow({ role: 'assistant', text: DOCUMENT_FRAME, toolUses: [] })).toBe(false)
})
