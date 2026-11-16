// Questions to the archive ([C_HELP_03_02], [SP_HELP_01_02]–[SP_HELP_01_04],
// [SP_HELP_02_02]–[SP_HELP_02_04]): the agent asks about the levels of folds
// it names; the mod splits their rows into parts, the helper (helper.ts)
// answers each part, and only the quotes the mod finds verbatim in one
// fragment of the archive reach the agent, each marked whose it is. The pair
// lives as a recall does (folds.ts: Question, MarkDue, AddReturns). Pure
// logic behind AskIO; register.ts binds it to `$`.
import type { SessionMessage } from 'claude-code'
import { personText, deliveryKind } from './deliveries'
import { inputText, MAX_SOURCE, oneLine, sourceOf } from './edits'
import { FOLD_ID, levelOf, levelRowText, MAX_ASK_FOLDS, MAX_QUESTIONS, pruneRecalls, type FoldEntry, type FoldLedger, type Question, type RecallIO } from './folds'
import { helperCall, MAX_QUESTION, MAX_QUOTE, MAX_QUOTES, type HelperIO, type HelperQuote, type HelperResult, type HelperStatus } from './helper'
import { PERSON_TOOLS } from './queue'
import { ASKED_HEAD, errorText, hostKind, isModText, modText, QUESTION_HEAD, RECALL_TOOL, resultsOf } from './rows'
import type { Read } from './store'

// [SP_HELP_01_09]
export const HELP_PART_CHARS = 60_000
export const HELP_MAX_PARTS = 4
export const MAX_ASK_RESULT = 16_000

// [SP_HELP_01_02] One part of the material of a question.
export type Part = { fold: string; index: number; parts: number; from: number; to: number; text: string }

// [SP_HELP_01_02] Fragment: a piece of a level row with its origin.
export type Origin = 'own' | 'person' | 'external' | 'service'
export type Fragment = { row: number; text: string; origin: Origin; source: string }

// [SP_HELP_01_03]
export type VerifiedQuote = { fold: string; row: number; text: string; origin: Origin; source: string }

// [SP_HELP_01_02] Split: the rows of a level in order; a part takes rows until
// its text would go over HELP_PART_CHARS, and the row that would take it over
// starts the next part. `texts`: LevelRowText of each row (cut at
// MAX_RECALL_ROW, under the bound). The header is counted in the bound.
export function splitLevel(fold: string, texts: readonly string[]): Part[] {
  const head = (index: number, parts: number, from: number, to: number) => `Material: fold ${fold}, part ${index} of ${parts}, rows #${from}–#${to}`
  // the longest header a part of this level can have
  const room = HELP_PART_CHARS - head(999, 999, texts.length, texts.length).length - 2
  const groups: { from: number; to: number }[] = []
  let size = 0
  for (let n = 0; n < texts.length; n++) {
    const add = texts[n]!.length + 2
    const last = groups[groups.length - 1]
    if (last && size + add <= room) {
      last.to = n
      size += add
    } else {
      groups.push({ from: n, to: n })
      size = add
    }
  }
  return groups.map((g, i) => ({
    fold,
    index: i + 1,
    parts: groups.length,
    from: g.from,
    to: g.to,
    text: [head(i + 1, groups.length, g.from, g.to), ...texts.slice(g.from, g.to + 1)].join('\n\n'),
  }))
}

// [SP_HELP_01_02] A subagent's report or a task's notification in a user row,
// delivered mid-turn or as a `peer` prompt between turns.
function isReport(text: string): boolean {
  const kind = deliveryKind(text)
  const t = text.trimStart()
  return kind === 'agent' || kind === 'task' || hostKind(t) === 'peer' || t.startsWith('<task-notification>')
}

// [SP_HELP_01_02] The fragments of one level row, by the rule of origin:
// - the agent's text and the input of its calls: own;
// - the person's words as PersonText reads them, the answers to
//   AskUserQuestion: person (the rest of such a row's text: service);
// - a tool's result: external, its source the call's SourceOf;
// - a subagent's report, a task's notification: external, `subagent report`;
// - the mod's text and the host's service rows: service.
// `level`: all rows of the level, where a result's call is looked up.
export function fragmentsOf(r: SessionMessage, n: number, level: readonly SessionMessage[], cwd?: string): Fragment[] {
  const out: Fragment[] = []
  const put = (text: string, origin: Origin, source = '') => {
    if (text.trim()) out.push({ row: n, text, origin, source })
  }
  if (r.text) {
    if (isModText(r.text)) put(r.text, 'service')
    else if (r.role === 'assistant') put(r.text, 'own')
    else {
      const words = personText(r.text)
      if (words) {
        put(words, 'person')
        if (words !== r.text.trim()) put(r.text, 'service')
      } else if (isReport(r.text)) put(r.text, 'external', 'subagent report')
      else put(r.text, 'service')
    }
  }
  for (const u of r.toolUses) {
    put(sourceOf(u.tool, u.input, cwd), 'own')
    put(inputText(u.input), 'own')
  }
  for (const t of resultsOf(r)) {
    const call = level.flatMap(x => x.toolUses).find(u => u.tool_use_id === t.tool_use_id)
    if (call && PERSON_TOOLS.includes(call.tool)) put(t.text, 'person')
    else if (isModText(t.text)) put(t.text, 'service')
    else put(t.text, 'external', oneLine(call ? sourceOf(call.tool, call.input, cwd) : 'a tool', MAX_SOURCE))
  }
  return out
}

// [SP_HELP_02_04] Normalize: NFC, every run of whitespace (no-break space
// included) as one space, trimmed. The letters' case stays.
export function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

// [SP_HELP_02_04] The labels of LevelRowText that frame the material, which
// a helper sometimes quotes with the text: `#<n> <role>:`, then `call: `,
// `result: ` or `result (error): `. A quote is checked and shown without them.
const LABELS = /^(?:#\d+ [a-z]+:\s*)?(?:call: |result(?: \(error\))?: )?/

export function stripLabels(text: string): string {
  return text.trimStart().replace(LABELS, '')
}

// [SP_HELP_02_04] VerifyQuotes: the quotes of one reply found verbatim (after
// StripLabels and Normalize) inside one fragment of the part's rows: first
// the fragments of the row the helper named, then all in row order. A quote
// across fragments or rows, an empty one, one longer than MAX_QUOTE and those
// past MAX_QUOTES are rejected; a repeat of a verified quote is neither.
export function verifyQuotes(quotes: readonly HelperQuote[], part: Pick<Part, 'fold' | 'from' | 'to'>, fragments: readonly Fragment[]): { verified: VerifiedQuote[]; rejected: number } {
  const verified: VerifiedQuote[] = []
  const seen = new Set<string>()
  let rejected = 0
  const norm = fragments.map(f => normalize(f.text))
  for (const q of quotes.slice(0, MAX_QUOTES)) {
    if (!q.text || q.text.length > MAX_QUOTE) {
      rejected++
      continue
    }
    const text = stripLabels(q.text)
    const nq = normalize(text)
    if (!nq) {
      rejected++
      continue
    }
    const named = q.row >= part.from && q.row <= part.to ? fragments.map((f, i) => (f.row === q.row ? i : -1)).filter(i => i >= 0) : []
    const order = [...named, ...fragments.map((_, i) => i)]
    const at = order.find(i => norm[i]!.includes(nq))
    if (at === undefined) {
      rejected++
      continue
    }
    const s = fragments[at]!
    const key = `${s.row}\u0000${nq}`
    if (seen.has(key)) continue
    seen.add(key)
    verified.push({ fold: part.fold, row: s.row, text, origin: s.origin, source: s.source })
  }
  rejected += Math.max(0, quotes.length - MAX_QUOTES)
  return { verified, rejected }
}

// [SP_HELP_01_03] The mark of a quote for the agent.
export function quoteMark(q: Pick<VerifiedQuote, 'origin' | 'source'>): string {
  switch (q.origin) {
    case 'own':
      return '[your own]'
    case 'person':
      return "[the person's]"
    case 'external':
      return `[external: ${q.source}]`
    default:
      return '[service text]'
  }
}

// [SP_HELP_02_03] One part's answer as AskText reads it.
export type PartAnswer = { part: Part; result: HelperResult; verified: VerifiedQuote[]; rejected: number }

// [SP_HELP_02_03] AskText's first line: the helper's reading is external.
export function askedLine(folds: readonly string[]): string {
  return `${ASKED_HEAD}fold(s) ${folds.join(', ')} — the helper's reading follows. A model outside this conversation read the archive, external content included; its reading is not your own text. Only quotes found verbatim in the archive are shown.`
}

// [SP_HELP_02_03] AskText: the lines in order; over MAX_ASK_RESULT the quote
// lines go from the end with one line of how many went. Lines 1–3 are never cut.
export function askText(folds: readonly string[], answers: readonly PartAnswer[]): string {
  const many = answers.length > 1
  const head = [askedLine(folds)]
  for (const a of answers) {
    const { part, result } = a
    const where = part.parts > 1 ? ` part ${part.index} of ${part.parts}` : ''
    if (result.status === 'answered' && result.reply) {
      const confirmed = a.verified.length > 0
      const label = many
        ? `Reading (${part.fold}, part ${part.index} of ${part.parts}${confirmed ? '' : ', not confirmed by the archive'})`
        : `Reading${confirmed ? '' : ' (not confirmed by the archive)'}`
      head.push(`${label}: ${result.reply.answer}`)
    } else if (result.status === 'not_found') head.push(`Not found in ${part.fold}${where}.`)
    else if (result.status === 'refused') head.push(`The helper refused ${part.fold}${where}: ${result.reason || 'no reason given'}.`)
    else head.push(`The helper did not answer for ${part.fold}${where}: ${result.reason}.`)
  }
  const quotes = answers.flatMap(a => a.verified).map(q => `${q.fold} #${q.row} ${quoteMark(q)}: "${q.text}"`)
  const rejected = answers.reduce((n, a) => n + a.rejected, 0)
  const tail = [
    ...(rejected ? [`Rejected: ${rejected} quote(s) not found verbatim in the archive.`] : []),
    ...(answers.some(a => a.result.status === 'answered') ? [] : [`${RECALL_TOOL} shows the whole level.`]),
  ]
  const join = (shown: readonly string[], hidden: number) =>
    [...head, ...(shown.length ? ['Verified quotes:', ...shown] : []), ...(hidden ? [`… ${hidden} more verified quote(s) not shown.`] : []), ...tail].join('\n')
  let shown = quotes
  let text = join(shown, 0)
  while (text.length > MAX_ASK_RESULT && shown.length) {
    shown = shown.slice(0, -1)
    text = join(shown, quotes.length - shown.length)
  }
  return text
}

// [SP_HELP_02_03] The status of a question for the journal.
export function askStatus(results: readonly Pick<HelperResult, 'status'>[]): HelperStatus | 'failed' {
  for (const s of ['answered', 'not_found', 'refused'] as const) if (results.some(r => r.status === s)) return s
  return 'failed'
}

// [SP_HELP_01_08] The journal's entry of a question.
export type AskEntry = {
  kind: 'ask'
  at: number
  folds: string[]
  parts: number
  calls: number
  in: number
  out: number
  verified: number
  rejected: number
  status: HelperStatus | 'failed'
  errand?: string
}

// [SP_HELP_02_02] [SP_HELP_02_03] The refusals of the helper's tool and of a question.
export type AskDeny =
  | 'DENIED_SUBAGENT'
  | 'BAD_OP'
  | 'HELPER_PASSED_OVER'
  | 'ASK_QUESTION'
  | 'ASK_FOLDS'
  | 'DENIED_STORAGE'
  | 'FOLD_UNKNOWN'
  | 'ASK_MEDIA'
  | 'QUESTIONS_FULL'
  | 'ARCHIVE_UNREADABLE'
  | 'ASK_TOO_BIG'

// [SP_HELP_02_02] The tool's arguments; `agentId` from the event.
export type HelperArgs = { agentId?: unknown; op?: unknown; folds?: unknown; question?: unknown } & Record<string, unknown>

// [SP_HELP_02_02] The fields of the other operations: none of them goes with `ask`.
const OTHER_FIELDS = ['when', 'n', 'name', 'action', 'text', 'wake', 'id'] as const

// [SP_HELP_02_02] [SP_HELP_02_03] HELPER_PASSED_OVER, DENIED_SUBAGENT
export const HELPER_PASSED_OVER =
  "this host passes over the mod's compaction hook: the question's pair could never be returned; open the original with Read at the path in the fold record."
export const HELPER_SUBAGENT = "a subagent cannot use the mod's helper; only the main conversation's folds and errands are kept."
export const ASK_UNRECORDED = ' The question was not recorded: its pair goes with your next apply.'

// [SP_HELP_02_03] What Ask needs from the host; register.ts binds it.
export type AskIO = Pick<RecallIO, 'passedOver' | 'storageDown' | 'storageRefusal' | 'rows' | 'region' | 'readArchive' | 'onLedger' | 'live' | 'note' | 'cwd'> & {
  // the fold ledger as it is now, read once outside every chain
  readLedger: () => Promise<Read<FoldLedger>>
  helper: HelperIO
  // the journal's entry, written in the background
  journal: (entry: AskEntry) => void
  now: () => number
  // the call was cut (Esc, an `interrupt`): the host shows no answer
  aborted: () => boolean
  debug: (text: string) => void
}

// [SP_HELP_02_02] [SP_HELP_02_03] Ask: the refusals in the order of the
// spec; the ledger and the archives are read once, outside every chain; the
// parts are asked at once; the record is written on the ledger's chain with
// QUESTIONS_FULL checked again. Nothing is queued and no apply runs.
export async function contextAsk(io: AskIO, args: HelperArgs, callId: string | undefined): Promise<{ result: string } | { deny: string; code: AskDeny }> {
  const no = (code: AskDeny, deny: string) => ({ code, deny: `${deny} (${code})` })
  if (args.agentId) return { code: 'DENIED_SUBAGENT', deny: HELPER_SUBAGENT }
  const other = OTHER_FIELDS.filter(f => args[f] !== undefined)
  if (args.op !== 'ask' || other.length)
    return no('BAD_OP', `${args.op === 'ask' ? `"ask" takes no ${other.map(f => `"${f}"`).join(', ')}; it` : '"op" is "ask"; it'} takes "folds" (fold ids from their records) and "question"`)
  if (io.passedOver()) return { code: 'HELPER_PASSED_OVER', deny: HELPER_PASSED_OVER }
  const question = typeof args.question === 'string' ? args.question.trim() : ''
  if (!question || question.length > MAX_QUESTION) return no('ASK_QUESTION', `"question" is a text of 1..${MAX_QUESTION} chars`)
  const folds = args.folds
  if (!Array.isArray(folds) || !folds.length || folds.length > MAX_ASK_FOLDS || !folds.every(f => typeof f === 'string') || new Set(folds).size !== folds.length)
    return no('ASK_FOLDS', `"folds" is a list of 1..${MAX_ASK_FOLDS} distinct fold ids, e.g. ["f3"]`)
  const ids = folds as string[]
  const down = await io.storageDown()
  if (down !== undefined) return { code: 'DENIED_STORAGE', deny: io.storageRefusal(down) }
  const read = await io.readLedger().catch((err): Read<FoldLedger> => ({ state: 'unreadable', reason: errorText(err) }))
  if (read.state === 'unreadable') return no('FOLD_UNKNOWN', `the fold ledger cannot be read (${read.reason}); the originals are at the paths in the fold records: open them with Read`)
  const rows = await io.rows()
  const entries: FoldEntry[] = []
  for (const id of ids) {
    const f = FOLD_ID.test(id) ? read.value.folds.find(x => x.id === id) : undefined
    if (!f) return no('FOLD_UNKNOWN', `no fold ${oneLine(id, 40)} in the fold ledger; its original is at the path in the fold record: open it with Read`)
    entries.push(f)
  }
  const media = entries.find(f => f.kind === 'media')
  if (media) return no('ASK_MEDIA', `fold ${media.id} folded media; the helper reads text only; use ${RECALL_TOOL}`)
  const waiting = pruneRecalls(read.value, rows, io.live()).questions.length
  if (waiting >= MAX_QUESTIONS) return no('QUESTIONS_FULL', `${waiting} questions wait for their regions to close; summarize or drop an answered question pair first`)
  const archives = new Map<string, Promise<string | undefined>>()
  const levels: { fold: FoldEntry; level: SessionMessage[] }[] = []
  for (const f of entries) {
    if (!archives.has(f.archive)) archives.set(f.archive, io.readArchive(f.archive).catch(() => undefined))
    const text = await archives.get(f.archive)!
    const level = text === undefined ? undefined : levelOf(text, f)
    if (!level) return no('ARCHIVE_UNREADABLE', `the archive of fold ${f.id} cannot be read (${f.archive}, element ${f.entry}); the fold record stays the description of what it held`)
    levels.push({ fold: f, level })
  }
  const parts = levels.flatMap(({ fold, level }) => splitLevel(fold.id, level.map((r, n) => levelRowText(r, n, io.cwd))).map(part => ({ part, level })))
  if (parts.length > HELP_MAX_PARTS) {
    const chars = parts.reduce((n, p) => n + p.part.text.length, 0)
    return no('ASK_TOO_BIG', `the material of ${ids.join(', ')} (~${chars} chars) needs ${parts.length} parts, over the limit of ${HELP_MAX_PARTS}; ask about fewer folds, or open a part with ${RECALL_TOOL} from/count`)
  }
  const region = await io.region()
  const results = await Promise.all(parts.map(p => helperCall(io.helper, question, p.part.text)))
  const answers: PartAnswer[] = parts.map(({ part, level }, i) => {
    const result = results[i]!
    // only an answered reply's quotes are checked ([SP_HELP_02_03])
    if (result.status !== 'answered' || !result.reply) return { part, result, verified: [], rejected: 0 }
    const fragments = level.slice(part.from, part.to + 1).flatMap((r, k) => fragmentsOf(r, part.from + k, level, io.cwd))
    return { part, result, ...verifyQuotes(result.reply.quotes, part, fragments) }
  })
  let text = askText(ids, answers)
  const verified = answers.reduce((n, a) => n + a.verified.length, 0)
  const rejected = answers.reduce((n, a) => n + a.rejected, 0)
  // a cut call: the host gives the agent its refusal, not this answer, so
  // there is no pair to keep or return; the journal still counts the cost
  const cut = io.aborted()
  if (callId && !cut) {
    const record: Question = {
      tool_use_id: callId,
      folds: ids,
      question: question.slice(0, QUESTION_HEAD),
      verified,
      rejected,
      depth: region.depth,
      scope: region.scope,
      turn: region.turn,
      due: false,
    }
    const written = await io
      .onLedger(async (ledger, write) => {
        const pruned = pruneRecalls(ledger, rows, io.live())
        // QUESTIONS_FULL again, on the chain: the answer stays, the record does not
        if (pruned.questions.length >= MAX_QUESTIONS) return false
        await write({ ...pruned, questions: [...pruned.questions, record] })
        return true
      })
      .catch(err => {
        io.debug(modText(`ask record not written: ${errorText(err)}`))
        return false
      })
    if (written) io.note(callId)
    else text += ASK_UNRECORDED
  } else if (!cut) text += ASK_UNRECORDED
  io.journal({
    kind: 'ask',
    at: io.now(),
    folds: ids,
    parts: parts.length,
    calls: results.reduce((n, r) => n + r.calls, 0),
    in: results.reduce((n, r) => n + r.in, 0),
    out: results.reduce((n, r) => n + r.out, 0),
    verified,
    rejected,
    status: askStatus(results),
  })
  return { result: text }
}
