import type { SessionMessage } from 'claude-code'

// [SP_CTX_02_10] PromptMatch: which conversation row a person's prompt media
// in the Messages API form belongs to ([SP_CTX_DEC_06], B with A as the
// check of every pair; spike docs/context_editor_media.spike.md). Pure.
//
// Both forms end with the same turn. They are cut into turn units from the
// tail and paired one by one; a pair counts only when its texts and its
// call and result ids agree, so a shift gives "none", never a wrong row.

// [SP_CTX_01_12] Text the host adds to a prompt's API message that no row
// holds (reminders, the command caveat, the saved-image note). A row whose
// text starts so is left out the same way: one the mod inserted (a delivery
// rendered as a reminder) or a host row of that kind.
// `<system-reminder` without `>`: a subagent's report is `<system-reminder id="…">` (phase 20).
export const REMINDER_PREFIX = '<system-reminder'
export const PROMPT_DECORATIONS: readonly string[] = [REMINDER_PREFIX, '<local-command-caveat>', '[Image: source: ']
// [SP_CTX_02_10] Rows of a slash command and of its output: never a media owner.
const COMMAND_ROWS: readonly string[] = ['<command-name>', '<local-command-stdout>']

type Block = Record<string, unknown>
type Msg = { role: unknown; blocks: Block[] }

// The blocks of one API message; a string content is one text block.
export function apiBlocks(msg: unknown): Block[] {
  const c = (msg as { content?: unknown } | null)?.content
  if (Array.isArray(c)) return c as Block[]
  if (typeof c === 'string') return [{ type: 'text', text: c }]
  return []
}

export function isMediaBlock(b: Block): boolean {
  return b.type === 'image' || b.type === 'document'
}

const squash = (s: string): string => s.replace(/\s+/g, '')
const textOf = (b: Block): string => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')
const decoration = (t: string): boolean => {
  const s = t.trimStart()
  return PROMPT_DECORATIONS.some(d => s.startsWith(d))
}
const commandRow = (t: string): boolean => {
  const s = t.trimStart()
  return COMMAND_ROWS.some(d => s.startsWith(d))
}

type Unit = { members: number[]; lead: number[]; answered: boolean }

// A unit starts at a prompt-bearing user row after an assistant row of the
// unit before; it holds that row, the user rows right after it (`lead`) and
// everything up to the next start.
function rowUnits(rows: readonly SessionMessage[]): Unit[] {
  const out: Unit[] = []
  rows.forEach((r, i) => {
    const starts = r.role === 'user' && !(r.toolResults ?? []).length && !decoration(r.text)
    const cur = out[out.length - 1]
    if (starts && (!cur || cur.answered)) return void out.push({ members: [i], lead: [i], answered: false })
    if (!cur) return
    cur.members.push(i)
    if (r.role === 'assistant') cur.answered = true
    else if (!cur.answered) cur.lead.push(i)
  })
  return out
}

// The same over API messages: a unit starts at a user message with text that
// is no decoration, or with media; a message of decorations alone (an
// attachment the host did not merge) starts nothing.
function apiUnits(msgs: readonly Msg[]): Unit[] {
  const out: Unit[] = []
  msgs.forEach((m, i) => {
    const starts = m.role === 'user' && m.blocks.some(b => (b.type === 'text' && !decoration(textOf(b))) || isMediaBlock(b))
    const cur = out[out.length - 1]
    if (starts && (!cur || cur.answered)) return void out.push({ members: [i], lead: [i], answered: false })
    if (!cur) return
    cur.members.push(i)
    if (m.role === 'assistant') cur.answered = true
  })
  return out
}

const sorted = (xs: string[]): string => JSON.stringify([...xs].sort())

// [SP_CTX_02_10] A pair agrees on the person's text and on the assistant's
// text (whitespace removed, decorations left out, thinking not counted) and
// on the ids of its tool results and tool calls.
function agrees(rows: readonly SessionMessage[], ru: Unit, msgs: readonly Msg[], au: Unit): boolean {
  const rUser = ru.members.map(i => rows[i]!).filter(r => r.role === 'user')
  const rAsst = ru.members.map(i => rows[i]!).filter(r => r.role === 'assistant')
  const mUser = au.members.map(i => msgs[i]!).filter(m => m.role === 'user')
  const mAsst = au.members.map(i => msgs[i]!).filter(m => m.role === 'assistant')
  const userText = squash(rUser.filter(r => !decoration(r.text)).map(r => r.text).join(''))
  const apiUserText = squash(mUser.flatMap(m => m.blocks.map(textOf).filter(t => !decoration(t))).join(''))
  if (userText !== apiUserText) return false
  const results = rUser.flatMap(r => (r.toolResults ?? []).map(t => t.tool_use_id))
  const apiResults = mUser.flatMap(m => m.blocks.filter(b => b.type === 'tool_result').map(b => String(b.tool_use_id)))
  if (sorted(results) !== sorted(apiResults)) return false
  if (squash(rAsst.map(r => r.text).join('')) !== squash(mAsst.flatMap(m => m.blocks.map(textOf)).join(''))) return false
  const calls = rAsst.flatMap(r => r.toolUses.map(u => u.tool_use_id))
  const apiCalls = mAsst.flatMap(m => m.blocks.filter(b => b.type === 'tool_use').map(b => String(b.id)))
  return sorted(calls) === sorted(apiCalls)
}

// [SP_CTX_02_10] For every user message of `api` with top-level media that
// PromptMatch ties to a row: its index in `api` → the row's index in `rows`.
// A message absent from the map is "none". `rows`: CurrentRows, or the
// compaction's `e.messages`; both end where the API form ends.
export function matchPrompts(api: readonly unknown[], rows: readonly SessionMessage[]): Map<number, number> {
  const out = new Map<number, number>()
  let msgs: Msg[] = api.map(m => ({ role: (m as { role?: unknown } | null)?.role, blocks: apiBlocks(m) }))
  // (1) the terminal's off-chain "/compact <args>" prompt during a compaction
  const last = msgs[msgs.length - 1]
  if (last?.role === 'user' && rows[rows.length - 1]?.role === 'assistant' && squash(last.blocks.map(textOf).filter(t => !decoration(t)).join('')).startsWith('/compact'))
    msgs = msgs.slice(0, -1)
  const ru = rowUnits(rows)
  const au = apiUnits(msgs)
  const n = Math.min(ru.length, au.length)
  // (4) pairs from the tail until the first that disagrees
  let agreed = 0
  while (agreed < n && agrees(rows, ru[ru.length - 1 - agreed]!, msgs, au[au.length - 1 - agreed]!)) agreed += 1
  const failedAtStart = agreed < n && au[au.length - 1 - agreed]!.members[0] === 0
  for (let k = 0; k < agreed; k++) {
    // (5) the next older pair agreed too, or there is none, or it failed at the API form's start
    if (!(k + 1 < agreed || agreed === n || failedAtStart)) continue
    const r = ru[ru.length - 1 - k]!
    const a = au[au.length - 1 - k]!
    // (6) the media of the unit's first message; the one person's row of its lead
    const head = msgs[a.members[0]!]!
    if (!head.blocks.some(isMediaBlock) || head.blocks.some(b => b.type === 'tool_result')) continue
    const owners = r.lead.filter(i => {
      const row = rows[i]!
      return row.role === 'user' && !(row.toolResults ?? []).length && !commandRow(row.text) && !decoration(row.text)
    })
    if (owners.length === 1) out.set(a.members[0]!, owners[0]!)
  }
  return out
}
