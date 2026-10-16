// [SP_CTX_01_12] [SP_CTX_02_04] The rows kernel: predicates over conversation
// rows, the pair lookup by id, sizes, text normalization, the mod's own text
// prefixes and the policy of which outputs are worth editing. Pure, and the
// lowest layer: it imports no other hook module, so every module can import
// it. Each predicate and shared literal has this one home (rule STRUCT-01;
// audit PL_AUD_CTX, CF-17, CF-18).
import type { SessionMessage, ToolResultSummary } from 'claude-code'

// ---- [SP_CTX_01_12] constants

// The prefix of the mod's own lines among the rows and the call context: the
// alias line, a note's reminder, CarryNote. Before phase 28 it also opened
// the text of every replaced row or result ([SP_CTX_DEC_17], A′); the
// replacements of now open with REPLACED instead (A″).
export const MARK = '[context-editor]'
// The prefix of the mod's own words: reports, frames, status lines, skip
// reasons. PersonText ([SP_CTX_02_02]) reads a row starting with it as no
// message of the person.
export const PREFIX = 'context-editor:'
// The "big row" threshold, chars (rule R2, the `!` flag, alias marks).
export const BIG_ROW = 4000
// The tools of rule R3; their outputs are worth editing at any size.
export const SEARCH_TOOLS: readonly string[] = ['Glob', 'Grep', 'WebSearch', 'ToolSearch']
// [SP_CTX_02_34] Chars per token without a calibration.
export const PLAIN_RATIO = 4

// ---- mod text

// [SP_CTX_01_12] One text of the mod's own: PREFIX, a space, the words.
export function modText(text: string): string {
  return `${PREFIX} ${text}`
}

// [SP_CTX_01_12] [SP_CTX_DEC_26] The mod's compaction marks (queue.ts and
// compaction.ts re-export them): the model reads them in the rows of the command
// (`/compact <args>`, which the host frames as run by the person), so each
// says who ran it.
// (no apostrophe or other quote: nothing a host might escape breaks the exact match)
export const MARKER = modText('apply queued edits (run automatically by the mod for context edits the agent queued, not by the person)')
export const HANDOFF_MARKER = modText('seed the handed-off conversation (run automatically by the mod, not by the person)')
// [SP_CTX_01_12] The marks before phase 25: rows of earlier applies, and a
// command an older instance of the module queued before a reload.
export const LEGACY_MARKER = modText('apply queued edits')
export const LEGACY_HANDOFF_MARKER = modText('seed the handed-off conversation')
// [SP_CTX_01_12] [SP_CTX_02_46] The mark of the repair after a resume (phase
// 32): the mod rebuilds a conversation the host loaded with originals beside
// their copies.
export const REPAIR_MARKER = modText('repair the resumed conversation (run automatically by the mod: resuming loaded some answers twice; not by the person)')
// [SP_CTX_02_57] The probe process's /compact (phase 38): the mod there answers it with skip.
export const PROBE_MARKER = modText('capability probe (run by the mod in a throwaway process)')

// [SP_CTX_01_12] [SP_CTX_02_48] TOOLREF_TEXT: the text of a ToolSearch result
// rebuilt without its handle, which would be empty (CF-51): a rebuilt row
// cannot carry tool_reference blocks. A service line of the mod, so MARK.
export function toolRefWords(names: readonly string[]): string {
  return `${MARK} ToolSearch loaded: ${names.join(', ')}. A rebuilt result cannot carry the loaded schemas: call these tools by name, or search again if a call fails.`
}

// [SP_CTX_01_05] [SP_CTX_01_12] PULLED_TEXT: the report's sentence when the
// apply first dropped originals a resume had loaded beside their copies.
export function pulledWords(n: number): string {
  return `${n} row(s) that resuming the session had loaded a second time were dropped first.`
}

// ---- [SP_CTX_02_04] [SP_CTX_DEC_17] replacement texts

// (A″, phase 28; spike context_editor_authorship, V6) A replacement's text is
// the agent's own note in the place of what it had read: no MARK prefix
// (haiku read `[context-editor]` as the plugin's words), the agent as the
// subject, its own call named, and "Later" for when. Every replacement opens
// with REPLACED; the full opener names the step and how the agent asked for
// it: a context_edit call, or a disposable tag of context_tag the mod queued.
export const REPLACED = 'Later, your context_'
const BY_EDIT = `${REPLACED}edit `
const BY_TAG = `${REPLACED}tag disposable tag replaced `
// [SP_CTX_01_03] How the agent asked for a replacement: QueuedEdit.via
export type Via = 'edit' | 'tag'
// The summarize openers of phases 28–40 (no source): sessions applied before
// phase 41 still carry them.
export const SUMMARIZED = `${BY_EDIT}summarize call replaced the full output you had read here with your own summary`
// [SP_CTX_01_32] [SP_CTX_02_62] The heads of the summarize openers with the
// source (phase 41): SourceOf follows the head.
export const SUMMARIZED_OF = `${BY_EDIT}summarize call replaced the full output of `
export const TAG_SUMMARIZED_OF = `${BY_TAG}the full output of `
export const REWRITTEN = `${BY_EDIT}rewrite call replaced the text of this row with your own rewrite`
// [SP_CTX_01_32] The head of every describe opener: media, pasted text or both ([SP_CTX_02_59]).
export const DESCRIBED_HEAD = `${BY_EDIT}describe call replaced the `
export const DESCRIBED = `${DESCRIBED_HEAD}media you had seen here with your own description`
// [SP_CTX_02_59] DescribedWords: what the describe replaced
export function describedWords(media: boolean, pasted: boolean): string {
  const what = media && pasted ? 'media and the pasted text' : pasted ? 'pasted text' : 'media'
  return `${DESCRIBED_HEAD}${what} you had seen here with your own description`
}
export const TAG_SUMMARIZED = `${BY_TAG}the full output you had read here with your own note`
export const TAG_REWRITTEN = `${BY_TAG}the text of this row with your own note`
// [SP_CTX_DEC_29] The collapse words name what the span held (CollapsedList,
// phase 27) in parentheses after the row count.
export const COLLAPSED_OPENER = `${BY_EDIT}collapse call replaced these `
export const TAG_COLLAPSED_OPENER = `${BY_TAG}these `
export function collapsedWords(n: number, list = '', via: Via = 'edit', quoted = false): string {
  return `${via === 'tag' ? TAG_COLLAPSED_OPENER : COLLAPSED_OPENER}${n} rows you had read${list ? ` (${list})` : ''}${quotedWords(quoted)} with your own note`
}
// [SP_CTX_02_62] Quoted: the original's facts are quoted in later texts
// (DependencyCheck, QueuedEdit.quoted).
export function quotedWords(quoted: boolean): string {
  return quoted ? ', which you quoted from later,' : ''
}
// [SP_CTX_02_62] The summarize opener names where the replaced content came
// from (SourceOf of edits.ts); no epistemic status ([SP_CTX_DEC_44]).
export function summarizedWords(source: string, via: Via = 'edit', quoted = false): string {
  return `${via === 'tag' ? TAG_SUMMARIZED_OF : SUMMARIZED_OF}${source} you had read here${quotedWords(quoted)}${via === 'tag' ? ' with your own note' : ' with your own summary'}`
}
// [SP_CTX_01_32] [SP_CTX_02_64] The opener of a trace row: one row where
// DropOwnCalls removed the agent's own context_* calls (TraceText of edits.ts).
export const TRACE_OPENER = `${REPLACED}* calls here were removed when your edits applied`
// [SP_CTX_01_32] [SP_CTX_02_67] The opener of the state slot's row once a
// state edit rebuilt it from its items (Assemble of state.ts, phase 44).
export const STATE_REBUILT = `${BY_EDIT}state call rebuilt your state slot here from its items`
export function rewrittenWords(via: Via = 'edit'): string {
  return via === 'tag' ? TAG_REWRITTEN : REWRITTEN
}
// Every full opener of phase 28: the test of a replacement is the whole
// opener, not REPLACED alone (a person quoting the start back is no replacement).
// [SP_CTX_02_59] DESCRIBED_HEAD stands for every describe opener of phase 40;
// [SP_CTX_02_62] SUMMARIZED_OF and TAG_SUMMARIZED_OF for the summarize
// openers with a source (phase 41); the full openers before them stay.
// [SP_CTX_02_64] TRACE_OPENER: the trace row of removed own calls (phase 42).
// [SP_CTX_02_67] STATE_REBUILT: the state slot rebuilt from its items (phase 44).
export const REPLACEMENT_OPENERS: readonly string[] = [SUMMARIZED, REWRITTEN, DESCRIBED_HEAD, COLLAPSED_OPENER, TAG_SUMMARIZED, TAG_REWRITTEN, TAG_COLLAPSED_OPENER, SUMMARIZED_OF, TAG_SUMMARIZED_OF, TRACE_OPENER, STATE_REBUILT]
// [SP_CTX_01_12] The openers of phases 19–27 (A′): sessions applied before
// phase 28 still carry them.
export const LEGACY_DESCRIBED = `${MARK} you saw the media here, then replaced it with your description`
export const LEGACY_COLLAPSED_OPENER = `${MARK} you read these `

// [SP_CTX_02_04] The text of a replaced row or result: a full opener of
// phase 28 (REPLACEMENT_OPENERS) or any text an apply before phase 28 marked
// with MARK (A′ and the forms before it). The one test of "already replaced"
// (the `*` flag, R5 (a), the hint's candidates, PersonText; rule STRUCT-01).
export function isReplacementText(text: string): boolean {
  return REPLACEMENT_OPENERS.some(o => text.startsWith(o)) || text.startsWith(MARK)
}

// [SP_CTX_02_04] The text of a collapse note, by context_edit or a tag, of
// now or of phases 19–27.
export function isCollapseText(text: string): boolean {
  return text.startsWith(COLLAPSED_OPENER) || text.startsWith(TAG_COLLAPSED_OPENER) || text.startsWith(LEGACY_COLLAPSED_OPENER)
}

// [SP_CTX_02_04] A person's prompt after a describe (its words follow the
// description), of now or of phases 19–27.
export function isDescribedText(text: string): boolean {
  return text.startsWith(DESCRIBED_HEAD) || text.startsWith(LEGACY_DESCRIBED)
}

// [SP_CTX_01_32] [SP_CTX_02_58] The frames of the text the host adds as a
// user row: an expanded skill, a subagent's report between turns. HostFrame:
// such a text is never the person's words.
export const SKILL_FRAME = 'Base directory for this skill: '
export const PEER_FRAME = 'Another Claude session sent a message:\n<agent-message'
export function hostFrame(text: string): boolean {
  return text.startsWith(SKILL_FRAME) || text.startsWith(PEER_FRAME)
}

// [SP_CTX_02_59] PasteBlocks: the host's wrapper of pasted text in a
// prompt's text, `<pasted_content id="X">…</pasted_content id="X">` (the
// closing tag repeats the id) or without an id; in order, not nested.
const PASTE = /<pasted_content( id="[^"]*")?>([\s\S]*?)<\/pasted_content\1>/g
export type PasteBlock = { start: number; end: number; chars: number }
export function pasteBlocks(text: string): PasteBlock[] {
  return [...text.matchAll(PASTE)].map(m => ({ start: m.index!, end: m.index! + m[0].length, chars: m[2]!.length }))
}
// [SP_CTX_02_59] The typed text with paste block k (from 1) in its place as a mark.
export function withPasteMarks(text: string, blocks: readonly PasteBlock[]): string {
  let out = ''
  let at = 0
  blocks.forEach((b, k) => {
    out += `${text.slice(at, b.start)}[pasted text ${k + 1}, ${b.chars} chars: see your description above]`
    at = b.end
  })
  return out + text.slice(at)
}

// [SP_CTX_01_12] [SP_CTX_02_07] Which of the mod's compactions a command's
// args name, by the marks of now or before phase 25; exact text only.
// [SP_CTX_02_47] `repair`: the repair after a resume (phase 32).
export type MarkerKind = 'apply' | 'seed' | 'repair'

export function markerKind(text: string | undefined): MarkerKind | undefined {
  if (text === MARKER || text === LEGACY_MARKER) return 'apply'
  if (text === HANDOFF_MARKER || text === LEGACY_HANDOFF_MARKER) return 'seed'
  if (text === REPAIR_MARKER) return 'repair'
  return undefined
}

// ---- row predicates

// The tool results of a row; none for a row without them.
export function resultsOf(row: SessionMessage): ToolResultSummary[] {
  return row.toolResults ?? []
}

// A row with no text, no calls and no results: thinking only, a prompt of
// media alone, or a result row a drop left empty.
export function isEmptyRow(row: SessionMessage): boolean {
  return !row.text && row.toolUses.length === 0 && !resultsOf(row).length
}

// [SP_CTX_02_22] Blank: EmptyRow, except that text of whitespace alone
// counts as none too: a seed and a repair drop such rows, and CheckPairs
// refuses them.
export function isBlankRow(row: SessionMessage): boolean {
  return !row.text.trim() && row.toolUses.length === 0 && !resultsOf(row).length
}

// A user row without results: a prompt, a delivery, a command's row, or a
// row a drop left empty. The base of the prompt predicates below.
export function isPlainUserRow(row: SessionMessage): boolean {
  return row.role === 'user' && !resultsOf(row).length
}

// [SP_CTX_02_02] The host's frame of a plugin's prompt: its first line.
export const PLUGIN_FRAME = /^The .+ plugin sent a message:/
const PLUGIN_FRAME_LINE = new RegExp(`${PLUGIN_FRAME.source}[ \\t]*\\n`)
// [SP_CTX_01_12] [SP_CTX_02_21] The first line of a handoff document in the new session.
export const DOCUMENT_FRAME = modText("your handoff document from the previous session follows; it is your own text, not the person's.")

// [SP_CTX_02_68] DocumentRow: a user row without results whose text, after
// the host's frame of a plugin's prompt, starts with DOCUMENT_FRAME.
export function documentRow(row: SessionMessage): boolean {
  if (!isPlainUserRow(row)) return false
  const t = row.text.trimStart()
  const frame = PLUGIN_FRAME_LINE.exec(t)
  return (frame ? t.slice(frame[0].length).trimStart() : t).startsWith(DOCUMENT_FRAME)
}

// [SP_CTX_02_04] PromptRow: a user row without results that is not a result
// row a drop left empty (it has a handle or content). No response crosses
// one: it ends the stretch of KeepResponsesWhole and bounds Responses. The
// one prompt predicate of ResponseStart, FrozenPrefix and CacheCost
// ([SP_CTX_02_38]).
export function isPromptRow(row: SessionMessage): boolean {
  return isPlainUserRow(row) && (row.handle !== undefined || !isEmptyRow(row))
}

// [SP_CTX_02_16] A row that starts a turn for ResolveLast (`ref: "last"`):
// PromptRow, except that a row of whitespace alone without a handle is no
// prompt here (PromptRow counts any text). Kept apart from PromptRow, which
// the apply and the cache cost share: changing either would change what the
// other decides.
export function isPromptRowStrict(row: SessionMessage): boolean {
  return isPlainUserRow(row) && (row.text.trim() !== '' || row.handle !== undefined)
}

// ---- pairs

// The row holding the call with this id; -1 when none.
export function findToolUse(rows: readonly SessionMessage[], id: string): number {
  return rows.findIndex(r => r.toolUses.some(u => u.tool_use_id === id))
}

// The row holding the result of the call with this id; -1 when none.
export function findToolResult(rows: readonly SessionMessage[], id: string): number {
  return rows.findIndex(r => resultsOf(r).some(t => t.tool_use_id === id))
}

// ---- sizes

// The chars of a row as the listing counts them: text, call inputs, results.
export function rowChars(row: SessionMessage): number {
  let n = row.text.length
  for (const u of row.toolUses) n += JSON.stringify(u.input ?? {}).length
  for (const r of resultsOf(row)) n += r.text.length
  return n
}

export function totalChars(rows: readonly SessionMessage[]): number {
  return rows.reduce((n, r) => n + rowChars(r), 0)
}

// The chars of rows[from..to], both ends included and clamped to the rows.
export function charsOf(rows: readonly SessionMessage[], from: number, to: number): number {
  let n = 0
  for (let i = Math.max(0, from); i <= to && i < rows.length; i++) n += rowChars(rows[i]!)
  return n
}

// [SP_CTX_02_34] The chars of one API message by the measure of rowChars:
// text blocks (the host's attachments among them: reminders, memory files,
// listings, hook context), call inputs and the text of results; thinking and
// media add none, as they add none to a row.
export function apiMessageChars(msg: unknown): number {
  let n = 0
  for (const b of apiBlocks(msg)) {
    if (b.type === 'text' && typeof b.text === 'string') n += b.text.length
    else if (b.type === 'tool_use') n += JSON.stringify(b.input ?? {}).length
    else if (b.type === 'tool_result') for (const c of apiBlocks(b)) if (c.type === 'text' && typeof c.text === 'string') n += c.text.length
  }
  return n
}

// [SP_CTX_02_34] The chars of the API form, the request's messages.
export function apiChars(api: readonly unknown[]): number {
  return api.reduce((n: number, m) => n + apiMessageChars(m), 0)
}

// ---- [SP_CTX_02_16] [SP_CTX_01_11] which outputs are worth editing

export function isBig(size: number): boolean {
  return size >= BIG_ROW
}

export function isSearchTool(tool: string): boolean {
  return SEARCH_TOOLS.includes(tool)
}

// An output is worth editing when it is big or comes from a search tool: the
// condition of an alias mark and, rule by rule, of R2 and R3. A search
// tool's error is no search output (phase 31, CF-52): only its size counts.
export function worthEditing(tool: string, size: number, isError = false): boolean {
  return isBig(size) || (isSearchTool(tool) && !isError)
}

// ---- text

// A text with all whitespace taken out: the host joins text blocks its own way.
export function squash(s: string): string {
  return s.replace(/\s+/g, '')
}

// Two texts the same, whitespace aside.
export function sameText(a: string, b: string): boolean {
  return squash(a) === squash(b)
}

export type Block = Record<string, unknown>

// The blocks of one API message; a string content is one text block.
export function apiBlocks(msg: unknown): Block[] {
  const c = (msg as { content?: unknown } | null)?.content
  if (Array.isArray(c)) return c as Block[]
  if (typeof c === 'string') return [{ type: 'text', text: c }]
  return []
}

// The message of a caught error, for a status line or a report.
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
