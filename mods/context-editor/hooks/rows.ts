// [SP_CTX_01_12] [SP_CTX_02_04] The rows kernel: predicates over conversation
// rows, the pair lookup by id, sizes, text normalization, the mod's own text
// prefixes and the policy of which outputs are worth editing. Pure, and the
// lowest layer: it imports no other hook module, so every module can import
// it. Each predicate and shared literal has this one home (rule STRUCT-01;
// audit PL_AUD_CTX, CF-17, CF-18).
import type { SessionMessage, ToolResultSummary } from 'claude-code'

// ---- [SP_CTX_01_12] constants

// The prefix of the text of a replaced row or result ([SP_CTX_DEC_17]).
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

// A user row without results: a prompt, a delivery, a command's row, or a
// row a drop left empty. The base of the prompt predicates below.
export function isPlainUserRow(row: SessionMessage): boolean {
  return row.role === 'user' && !resultsOf(row).length
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
// condition of an alias mark and, rule by rule, of R2 and R3.
export function worthEditing(tool: string, size: number): boolean {
  return isBig(size) || isSearchTool(tool)
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
