// [SP_CTX_02_39] [SP_CTX_02_40] [SP_CTX_02_41] [C_CTX_DEC_22] Host attachments:
// the copies of instruction files (`instructions`, `nested_memory`) and of the
// skill listing (`skill_listing`) the host attaches to prompts. Every apply of
// the mod is a compaction, after which the host attaches a full new copy of a
// changed instruction file, while every older copy stays in each request; no
// row of `$.session.messages()` holds them, so neither the agent nor an edit
// can reach them. The `prompt.attachment` hook answers each such attachment
// from decisions made only inside the mod's apply (the host asks every
// attachment again right after a compaction, and the prompt cache is
// rewritten there anyway) and saved in the session's storage, so a resumed
// process sends the same bytes. Pure: register.ts binds the ports to `$`.
import type { SessionMessage } from 'claude-code'
import { apiCut, estimate, responses } from './edits'
import { apiBlocks } from './rows'
import { isCount, jsonObject, type Held, type Read, type Store } from './store'

// [SP_CTX_01_12] The attachment types the hook answers; every other type, a
// `*_delta` among them, passes through untouched.
export const ATTACH_TYPES: readonly string[] = ['instructions', 'nested_memory', 'skill_listing']

// [SP_CTX_01_12] The frames the parser understands (host 2.1.296, spike
// context_editor_host_attachments): the first copy's preamble, the frame of a
// copy re-read after a compaction, and the listing's header. Any other text
// before the first section is not understood: the attachment is kept.
export const PREAMBLE_HEAD = 'Codebase and user instructions are shown below.'
export const REREAD_HEAD = 'Instruction files were re-read after the conversation was compacted;'
export const LISTING_HEAD = 'The following skills are available for use with the Skill tool:'

// [SP_CTX_01_12] What a stale section of a kept copy becomes:
// `Contents of <path>: <SUPERSEDED>`.
export const SUPERSEDED = 'superseded by a later copy below.'

// [SP_CTX_01_12] Asks further apart than this start a new pass: the host asks
// every attachment of a pass within milliseconds.
export const PASS_GAP_MS = 2000

// [SP_CTX_01_12] [SP_CTX_01_23] The caps of the state file's lists.
export const MAX_ATTACH_ANSWERS = 200
export const MAX_ATTACH_KEYS = 400
export const MAX_ATTACH_PATHS = 100

// [SP_CTX_02_39] One header of a section: `Contents of <path> (<description>):`
// or `Contents of <path>:` (nested_memory), then an empty line; only at the
// text's start or after an empty line, and only for an absolute or `~` path,
// so a line of a file's own content is rarely taken for one.
const SECTION_HEAD = /(?<=^|\n\n)Contents of ([/~][^\n]*?)(?: \([^()\n]*\))?:\n\n/g

// [SP_CTX_02_40] One skill of a listing: a line `- <name>: …`.
const LISTING_ITEM = /^- (\S+?):(?:\s|$)/gm

// [SP_CTX_02_40] The skill names a listing holds; empty when none parses.
export function listingNames(text: string): Set<string> {
  return new Set([...text.matchAll(LISTING_ITEM)].map(m => m[1]!))
}

// [SP_CTX_01_23] A string hash: its length and two 32-bit hashes, base 36.
export function textHash(s: string): string {
  let a = 0x811c9dc5
  let b = 5381
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = (Math.imul(b, 33) ^ c) >>> 0
  }
  return `${s.length.toString(36)}.${a.toString(36)}.${b.toString(36)}`
}

// [SP_CTX_01_23] SectionKey: one file's content as one copy holds it, its
// edges trimmed (the host's section equals the file after trim).
export function sectionKey(path: string, body: string): string {
  return textHash(`${path}\u0000${body.trim()}`)
}

// [SP_CTX_02_39] One file of an instructions attachment: `head` the header
// with its empty line, `body` the content up to the next header (its
// separator included).
export type Section = { path: string; head: string; body: string; key: string }

export type ParsedAttachment = { kind: 'files'; pre: string; preamble: boolean; sections: Section[] } | { kind: 'listing' }

// [SP_CTX_02_39] ParseAttachment: an instructions or nested_memory text as its
// frame and sections, a skill listing as one; undefined when the parser does
// not understand it (no section header, an unknown frame, a listing without
// its header, another type): such an attachment is always kept.
export function parseAttachment(type: string, text: string): ParsedAttachment | undefined {
  if (type === 'skill_listing') return text.startsWith(LISTING_HEAD) ? { kind: 'listing' } : undefined
  if (type !== 'instructions' && type !== 'nested_memory') return undefined
  const hits = [...text.matchAll(SECTION_HEAD)]
  if (!hits.length) return undefined
  const pre = text.slice(0, hits[0]!.index)
  const preamble = pre.startsWith(PREAMBLE_HEAD)
  if (pre !== '' && !preamble && !pre.startsWith(REREAD_HEAD)) return undefined
  const sections = hits.map((m, i): Section => {
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < hits.length ? (hits[i + 1]!.index ?? text.length) : text.length
    const path = m[1]!
    const body = text.slice(start, end)
    return { path, head: m[0], body, key: sectionKey(path, body) }
  })
  return { kind: 'files', pre, preamble, sections }
}

// ---- [SP_CTX_01_23] The state file

// [SP_CTX_01_23] The answer in force for one attachment text, by its hash:
// `copies` the copies of that text the conversation held when decided (a
// later copy is new and kept); `repeat` keeps the first copy of a pass and
// leaves the others out; `drop` leaves every copy out; `stale` the section
// keys a kept copy replaces by a SUPERSEDED line.
export type AttachDecision = { copies: number; drop?: true; repeat?: true; stale?: string[] }

// [SP_CTX_01_23] What the answers in force leave out of each request.
export type AttachLeft = { copies: number; chars: number }

// [SP_CTX_01_23] `hostattach.json`: the answers, the sections whose content
// matched the file when first seen, the predictions of the last apply by
// path, the paths no longer compared with the disk, and what is left out.
export type HostAttachState = {
  answers: Record<string, AttachDecision>
  matched: string[]
  predicted: Record<string, string>
  uncomparable: string[]
  left: AttachLeft
}

export function emptyHostAttach(): HostAttachState {
  return { answers: {}, matched: [], predicted: {}, uncomparable: [], left: { copies: 0, chars: 0 } }
}

function own<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined
}

function strings(v: unknown, max: number): string[] | undefined {
  return Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string') ? (v as string[]) : undefined
}

function decision(v: unknown): AttachDecision | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const d = v as Record<string, unknown>
  if (!isCount(d.copies, 1)) return undefined
  if (d.drop !== undefined && d.drop !== true) return undefined
  if (d.repeat !== undefined && d.repeat !== true) return undefined
  const stale = d.stale === undefined ? undefined : strings(d.stale, MAX_ATTACH_KEYS)
  if (d.stale !== undefined && !stale) return undefined
  return { copies: d.copies, ...(d.drop ? { drop: true } : {}), ...(d.repeat ? { repeat: true } : {}), ...(stale?.length ? { stale } : {}) }
}

// [SP_CTX_01_23] The file's read state: a field that breaks its constraints
// makes it unreadable (the hook then keeps every attachment; the apply moves
// it aside).
export function parseHostAttach(text: string): Read<HostAttachState> {
  const obj = jsonObject(text)
  if (obj.state === 'unreadable') return obj
  const o = obj.value
  const bad = (why: string): Read<HostAttachState> => ({ state: 'unreadable', reason: why })
  const out = emptyHostAttach()
  if (typeof o.answers !== 'object' || o.answers === null || Array.isArray(o.answers)) return bad('answers is not an object')
  const entries = Object.entries(o.answers as Record<string, unknown>)
  if (entries.length > MAX_ATTACH_ANSWERS) return bad(`more than ${MAX_ATTACH_ANSWERS} answers`)
  for (const [h, v] of entries) {
    const d = decision(v)
    if (!d) return bad(`answer ${h.slice(0, 40)} is malformed`)
    out.answers[h] = d
  }
  if (o.matched !== undefined) {
    const m = strings(o.matched, MAX_ATTACH_KEYS)
    if (!m) return bad('matched is malformed')
    out.matched = m
  }
  if (o.predicted !== undefined) {
    if (typeof o.predicted !== 'object' || o.predicted === null || Array.isArray(o.predicted)) return bad('predicted is not an object')
    const p = Object.entries(o.predicted as Record<string, unknown>)
    if (p.length > MAX_ATTACH_PATHS || !p.every(([, k]) => typeof k === 'string')) return bad('predicted is malformed')
    out.predicted = Object.fromEntries(p) as Record<string, string>
  }
  if (o.uncomparable !== undefined) {
    const u = strings(o.uncomparable, MAX_ATTACH_PATHS)
    if (!u) return bad('uncomparable is malformed')
    out.uncomparable = u
  }
  if (o.left !== undefined) {
    const l = o.left as Record<string, unknown> | null
    if (typeof l !== 'object' || l === null || !isCount(l.copies) || !isCount(l.chars)) return bad('left is malformed')
    out.left = { copies: l.copies, chars: l.chars }
  }
  return { state: 'ok', value: out }
}

// ---- [SP_CTX_02_39] The module's memory of the asks

// [SP_CTX_02_39] One attachment text asked since the last pass began: its
// latest ask's sequence number (a full pass asks in the conversation's order,
// a new copy last) and how many times it was asked (its copies).
export type SeenAttachment = { type: string; text: string; seq: number; count: number }

// [SP_CTX_02_39] The memory of this module instance: the catalog of the asks
// since the last pass began (a compaction that stands, a session switch, the
// module's start), the current burst of asks with the occurrences of each text
// in it, and the sections whose content matched the file when this instance
// first saw them.
// `voided`: another compaction replaced the conversation and its answers are
// being cleared: every attachment is kept until the next apply decides.
// `verify`: the last apply predicted new copies; the first turn end after it
// checks they came (VerifyPredictions).
export type AttachMemory = {
  seq: number
  catalog: Map<string, SeenAttachment>
  burst: { at: number; counts: Map<string, number> }
  matched: Set<string>
  checked: Set<string>
  voided: boolean
  verify: boolean
}

export function newAttachMemory(): AttachMemory {
  return { seq: 0, catalog: new Map(), burst: { at: 0, counts: new Map() }, matched: new Set(), checked: new Set(), voided: false, verify: false }
}

// [SP_CTX_02_39] NoteAsk, synchronous (the host's asks overlap: the order is
// their arrival): the text's occurrence in the current burst, and its entry
// in the catalog with `count`, its asks since the pass began.
export function noteAsk(mem: AttachMemory, type: string, text: string, now: number): { hash: string; occurrence: number; count: number } {
  const hash = textHash(text)
  if (now - mem.burst.at > PASS_GAP_MS) mem.burst.counts.clear()
  mem.burst.at = now
  const occurrence = (mem.burst.counts.get(hash) ?? 0) + 1
  mem.burst.counts.set(hash, occurrence)
  const seq = ++mem.seq
  const seen = mem.catalog.get(hash)
  if (seen) {
    seen.seq = seq
    seen.count += 1
  } else mem.catalog.set(hash, { type, text, seq, count: 1 })
  return { hash, occurrence, count: seen ? seen.count : 1 }
}

// [SP_CTX_02_39] A pass begins: the host asks every attachment again (after a
// compaction that stands) or the conversation is another (a session switch).
export function resetPass(mem: AttachMemory): void {
  mem.catalog.clear()
  mem.burst.counts.clear()
  mem.burst.at = 0
}

// [SP_CTX_02_41] Another compaction stands: a pass begins and, until the next
// apply decides, no answer of the old conversation is used.
export function voidAnswers(mem: AttachMemory): void {
  resetPass(mem)
  mem.voided = true
}

// ---- [SP_CTX_02_39] The hook

export type AttachAnswer = { keep: true } | { text: string | null }

const KEEP: AttachAnswer = { keep: true }

// [SP_CTX_02_39] What the hook needs from the host; register.ts binds it.
export type AttachIO = {
  // the decisions in force: the session's state file through its cache; undefined: no storage
  decisions: () => Promise<Read<HostAttachState> | undefined>
  // a file named by a section; undefined: missing or unreadable
  readFile: (path: string) => Promise<string | undefined>
  now: () => number
}

// [SP_CTX_02_39] AttachmentAnswer: a subagent's attachment, a type outside
// ATTACH_TYPES and a text the parser does not understand pass through; the
// others are noted, their new sections compared with the disk in the
// background, and answered from the decisions in force (an unreadable or
// absent state file keeps everything).
export async function attachmentAnswer(mem: AttachMemory, io: AttachIO, e: { type: string; text: string; agentId?: string }): Promise<AttachAnswer> {
  if (e.agentId || !ATTACH_TYPES.includes(e.type)) return KEEP
  const parsed = parseAttachment(e.type, e.text)
  if (!parsed) return KEEP
  const { hash, occurrence, count } = noteAsk(mem, e.type, e.text, io.now())
  if (parsed.kind === 'files') checkDisk(mem, io, parsed.sections)
  if (mem.voided) return KEEP
  const read = await io.decisions().catch(() => undefined)
  if (!read || read.state === 'unreadable') return KEEP
  return answerFor(parsed, e.text, own(read.value.answers, hash), occurrence, count)
}

// [SP_CTX_02_39] Comparable: a section whose content equals its file (both
// trimmed) when this instance first sees it. In the background: the answer
// never waits for the disk.
function checkDisk(mem: AttachMemory, io: Pick<AttachIO, 'readFile'>, sections: readonly Section[]): void {
  for (const s of sections) {
    if (mem.checked.has(s.key) || !s.path.startsWith('/')) continue
    mem.checked.add(s.key)
    void io
      .readFile(s.path)
      .then(d => {
        if (d !== undefined && d.trim() === s.body.trim()) mem.matched.add(s.key)
      })
      .catch(() => undefined)
  }
}

// [SP_CTX_02_39] AnswerFor: the answer of one occurrence of a text under its
// decision. A copy beyond the copies decided, in its burst or in the asks
// since the pass began (`count`), is new: kept. A copy with the preamble is
// never left out whole.
export function answerFor(parsed: ParsedAttachment, text: string, d: AttachDecision | undefined, occurrence: number, count = occurrence): AttachAnswer {
  if (!d || occurrence > d.copies || count > d.copies) return KEEP
  if (d.repeat && occurrence > 1) return { text: null }
  if (d.drop) return parsed.kind === 'files' && parsed.preamble ? KEEP : { text: null }
  if (d.stale?.length && parsed.kind === 'files') {
    const out = rewriteSections(parsed, new Set(d.stale))
    return out === undefined || out === text ? KEEP : { text: out }
  }
  return KEEP
}

// [SP_CTX_02_39] The copy with each stale section replaced by its SUPERSEDED
// line, the frame and the separators kept; undefined when none is stale.
export function rewriteSections(parsed: Extract<ParsedAttachment, { kind: 'files' }>, stale: ReadonlySet<string>): string | undefined {
  if (!parsed.sections.some(s => stale.has(s.key))) return undefined
  return parsed.pre + parsed.sections.map(s => (stale.has(s.key) ? `Contents of ${s.path}: ${SUPERSEDED}${/\s*$/.exec(s.body)![0]}` : s.head + s.body)).join('')
}

// ---- [SP_CTX_02_40] The decisions, inside the mod's apply

// [SP_CTX_02_40] The files the sections of the catalog name, as read at the
// apply: the text, or undefined (missing or unreadable).
export type AttachDisk = ReadonlyMap<string, string | undefined>

type Entry = SeenAttachment & { hash: string; parsed: ParsedAttachment }

function entriesOf(catalog: ReadonlyMap<string, SeenAttachment>): Entry[] {
  const out: Entry[] = []
  for (const [hash, s] of catalog) {
    const parsed = parseAttachment(s.type, s.text)
    if (parsed) out.push({ ...s, hash, parsed })
  }
  return out.sort((a, b) => a.seq - b.seq)
}

// [SP_CTX_02_40] The absolute paths the catalog's sections name.
export function diskPaths(catalog: ReadonlyMap<string, SeenAttachment>): string[] {
  const paths = new Set<string>()
  for (const e of entriesOf(catalog)) if (e.parsed.kind === 'files') for (const s of e.parsed.sections) if (s.path.startsWith('/')) paths.add(s.path)
  return [...paths]
}

function canonical(d: AttachDecision | undefined): string {
  if (!d) return ''
  return JSON.stringify([d.copies, d.drop === true, d.repeat === true, [...(d.stale ?? [])].sort()])
}

// The text the model reads for one occurrence (null: left out).
function sent(e: Entry, d: AttachDecision | undefined, k: number): string | null {
  const a = answerFor(e.parsed, e.text, d, k)
  return 'keep' in a ? e.text : a.text
}

// [SP_CTX_02_40] The newest section of each path: the section of the
// newest entry (by seq) that holds the path, with that entry's type.
function newestOf(entries: readonly Entry[]): Map<string, { key: string; body: string; type: string }> {
  const newest = new Map<string, { key: string; body: string; type: string }>()
  for (const e of entries) if (e.parsed.kind === 'files') for (const s of e.parsed.sections) newest.set(s.path, { key: s.key, body: s.body, type: e.type })
  return newest
}

// [SP_CTX_01_23] What the answers leave out of the catalog's attachments.
function leftOf(entries: readonly Entry[], answers: Record<string, AttachDecision>): AttachLeft {
  const left: AttachLeft = { copies: 0, chars: 0 }
  for (const e of entries) {
    const d = own(answers, e.hash)
    for (let k = 1; k <= e.count; k++) {
      const t = sent(e, d, k)
      if (t === e.text) continue
      if (t === null) {
        left.copies += 1
        left.chars += e.text.length
      } else {
        left.copies += e.parsed.kind === 'files' ? e.parsed.sections.filter(s => d?.stale?.includes(s.key)).length : 0
        left.chars += e.text.length - t.length
      }
    }
  }
  return left
}

// [SP_CTX_02_40] The decisions, compared without their copies: what changes
// what the model reads.
export function answersKey(answers: Record<string, AttachDecision>): string {
  return JSON.stringify(
    Object.keys(answers)
      .sort()
      .map(h => [h, canonical(answers[h]).replace(/^\[\d+,/, '[')]),
  )
}

// [SP_CTX_02_40] PlanAttachments: the decisions after this apply, from the
// catalog of the latest pass, the state in force and the files on disk. A
// section is stale when (a) a newer copy of its path holds other content, or
// (b) its path's newest content, an `instructions` copy, matched the file when
// first seen, the path is still compared, and the file differs now: the host
// attaches a new copy with the first prompt after this apply (a prediction,
// checked at the first turn end after it and at the next apply: when no newer
// copy came, the path is compared no more and its copies stay). A listing is
// left out only when one newer listing holds every skill it names (later
// listings may hold only the skills added); one that names none stays. A text
// asked more than once keeps its first copy. With `frozen` (keep_cache), an
// attachment whose current text lies in the frozen prefix keeps its decision,
// unless that decision hides a section that is current now (safety over the
// cache). An empty catalog (no pass seen since the last one began) changes
// nothing.
export function planAttachments(
  before: HostAttachState,
  mem: Pick<AttachMemory, 'catalog' | 'matched'>,
  disk: AttachDisk,
  frozen?: (text: string) => boolean,
): { state: HostAttachState; changed: boolean } {
  const entries = entriesOf(mem.catalog)
  if (!entries.length) return { state: before, changed: false }
  const newest = newestOf(entries)
  const matched = [...new Set([...before.matched, ...mem.matched])].slice(-MAX_ATTACH_KEYS)
  const known = new Set(matched)
  const uncomparable = new Set(before.uncomparable)
  const predicted: Record<string, string> = {}
  // [SP_CTX_02_40] the predictions of the last apply: a path whose newest copy
  // is still the one predicted stale got no new copy, so it is compared no more
  for (const [path, key] of Object.entries(before.predicted)) {
    const now = newest.get(path)
    if (!now) predicted[path] = key
    else if (now.key === key) uncomparable.add(path)
  }
  const stale = new Set<string>()
  for (const e of entries) if (e.parsed.kind === 'files') for (const s of e.parsed.sections) if (newest.get(s.path)!.key !== s.key) stale.add(s.key)
  for (const [path, n] of newest) {
    // only `instructions`: the host re-reads those after a compaction (spike, Entry 3); a nested memory file comes back only when read again
    if (n.type !== 'instructions' || uncomparable.has(path) || !known.has(n.key) || !disk.has(path)) continue
    const d = disk.get(path)
    if (d === undefined || d.trim() === n.body.trim()) continue
    stale.add(n.key)
    predicted[path] = n.key
  }
  // [SP_CTX_02_40] a listing goes when one newer, other listing names all its skills
  const listings = entries.filter(e => e.parsed.kind === 'listing').map(e => ({ e, names: listingNames(e.text) }))
  const covered = new Set(
    listings
      .filter(({ e, names }) => names.size && listings.some(l => l.e.seq > e.seq && l.e.hash !== e.hash && [...names].every(n => l.names.has(n))))
      .map(l => l.e.hash),
  )
  // the sections a decision hides that are current now: never held for the cache
  const hidesCurrent = (e: Entry, d: AttachDecision | undefined): boolean => {
    if (!d) return false
    if (e.parsed.kind === 'listing') return !!d.drop && !covered.has(e.hash)
    const hidden = d.drop ? e.parsed.sections.map(s => s.key) : (d.stale ?? [])
    return e.parsed.sections.some(s => hidden.includes(s.key) && !stale.has(s.key))
  }
  const answers: Record<string, AttachDecision> = {}
  for (const e of entries) {
    const d: AttachDecision = { copies: e.count }
    if (e.count > 1) d.repeat = true
    if (e.parsed.kind === 'files') {
      const keys = [...new Set(e.parsed.sections.filter(s => stale.has(s.key)).map(s => s.key))]
      if (keys.length && e.parsed.sections.every(s => stale.has(s.key)) && !e.parsed.preamble) d.drop = true
      else if (keys.length) d.stale = keys
    } else if (covered.has(e.hash)) d.drop = true
    let final: AttachDecision | undefined = d.repeat || d.drop || d.stale ? d : undefined
    const old = own(before.answers, e.hash)
    // [SP_CTX_02_40] keep_cache: an attachment in the frozen prefix keeps the text it sends
    if (frozen && canonical(old) !== canonical(final) && !hidesCurrent(e, old)) {
      const held = Array.from({ length: e.count }, (_, i) => sent(e, old, i + 1)).some(t => t !== null && frozen(t))
      if (held) final = old
    }
    if (final) answers[e.hash] = final
  }
  // the decisions of attachments this pass did not ask stay, within the cap
  for (const [h, d] of Object.entries(before.answers)) {
    if (Object.keys(answers).length >= MAX_ATTACH_ANSWERS) break
    if (!mem.catalog.has(h)) answers[h] = d
  }
  const state: HostAttachState = {
    answers,
    matched,
    predicted: Object.fromEntries(Object.entries(predicted).slice(-MAX_ATTACH_PATHS)),
    uncomparable: [...uncomparable].slice(-MAX_ATTACH_PATHS),
    left: leftOf(entries, answers),
  }
  return { state, changed: JSON.stringify(state) !== JSON.stringify(before) }
}

// [SP_CTX_02_40] RollbackPredictions: the state once the predictions the
// catalog shows unfulfilled (the path's newest copy is still the one predicted
// stale) are withdrawn: the path compared no more, its key out of every
// decision, a copy left out whole for it decided again by rule (a) alone.
// Confirmed predictions end; a path the catalog does not hold stays
// predicted. `failed`: some prediction was withdrawn; undefined: no change.
export function rollbackPredictions(state: HostAttachState, catalog: ReadonlyMap<string, SeenAttachment>): { state: HostAttachState; failed: boolean } | undefined {
  const entries = entriesOf(catalog)
  const newest = newestOf(entries)
  const predicted: Record<string, string> = {}
  const uncomparable = new Set(state.uncomparable)
  const failed = new Set<string>()
  for (const [path, key] of Object.entries(state.predicted)) {
    const now = newest.get(path)
    if (!now) predicted[path] = key
    else if (now.key === key) {
      uncomparable.add(path)
      failed.add(key)
    }
  }
  if (!failed.size && Object.keys(predicted).length === Object.keys(state.predicted).length) return undefined
  const byHash = new Map(entries.map(e => [e.hash, e]))
  const answers: Record<string, AttachDecision> = {}
  for (const [h, d] of Object.entries(state.answers)) {
    const e = byHash.get(h)
    let next: AttachDecision = d
    if (d.stale?.some(k => failed.has(k))) {
      const { stale, ...rest } = d
      const kept = stale!.filter(k => !failed.has(k))
      next = kept.length ? { ...rest, stale: kept } : rest
    } else if (d.drop && e?.parsed.kind === 'files' && e.parsed.sections.some(s => failed.has(s.key))) {
      const { drop: _drop, ...rest } = d
      const keys = e.parsed.sections.filter(s => !failed.has(s.key) && newest.get(s.path)!.key !== s.key).map(s => s.key)
      next = keys.length === e.parsed.sections.length && !e.parsed.preamble ? d : keys.length ? { ...rest, stale: keys } : rest
    }
    if (next.drop || next.repeat || next.stale?.length) answers[h] = next
  }
  const out: HostAttachState = { ...state, answers, predicted, uncomparable: [...uncomparable].slice(-MAX_ATTACH_PATHS), left: leftOf(entries, answers) }
  return { state: out, failed: failed.size > 0 }
}

// [SP_CTX_02_40] What VerifyPredictions needs: the state file's Update on its
// chain, and the host's invalidation of the attachments' answers.
export type VerifyIO = {
  update: (change: (s: HostAttachState) => HostAttachState | undefined) => Promise<unknown>
  // `$.ui.invalidate('prompt.attachment')`: the host asks every attachment again from the next turn
  invalidate: () => void
}

// [SP_CTX_02_40] VerifyPredictions, at the first turn end after an apply that
// predicted new copies, once its pass is in the catalog: a prediction the host
// did not fulfil is withdrawn at once (not at the next apply, which may never
// come) and the answers are asked again from the next turn, so the current
// content is sent again (safety over the cache). An empty catalog waits for
// the next turn end.
export async function verifyPredictions(mem: AttachMemory, io: VerifyIO): Promise<'none' | 'waiting' | 'kept' | 'rolled back'> {
  if (!mem.verify) return 'none'
  if (!mem.catalog.size) return 'waiting'
  mem.verify = false
  const catalog = new Map(mem.catalog)
  let failed = false
  await io.update(s => {
    const out = rollbackPredictions(s, catalog)
    failed = !!out?.failed
    return out?.state
  })
  if (!failed) return 'kept'
  resetPass(mem)
  io.invalidate()
  return 'rolled back'
}

// [SP_CTX_02_40] FrozenAttachments: with keep_cache, whether an attachment's
// current text lies in the frozen prefix: in a user message of the API form
// before the assistant message of the first response after the prefix (all
// of the form when none is known); in a form cut at its window, a text found
// nowhere counts as frozen too. Undefined: nothing is frozen.
export function frozenAttachments(rows: readonly SessionMessage[], api: readonly unknown[], prefix: number): ((text: string) => boolean) | undefined {
  if (prefix <= 0) return undefined
  const after = responses(rows, api)
    .message.slice(prefix)
    .filter((m): m is number => m !== undefined)
  const end = after.length ? after.reduce((a, b) => Math.min(a, b)) : api.length
  const texts = (msgs: readonly unknown[]) =>
    msgs.flatMap(m => ((m as { role?: unknown } | null)?.role === 'user' ? apiBlocks(m).flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])) : []))
  const head = texts(api.slice(0, end))
  const cut = apiCut(api)
  const all = cut ? texts(api) : []
  return text => {
    const t = text.trim()
    if (!t) return false
    if (head.some(b => b.includes(t))) return true
    return cut && !all.some(b => b.includes(t))
  }
}

// [SP_CTX_02_40] What the apply needs: the state file (its chain, read,
// write, quarantine) and the files the sections name.
export type AttachApplyIO = {
  store: Pick<Store<HostAttachState>, 'read' | 'write' | 'quarantine' | 'onChain'>
  readFile: (path: string) => Promise<string | undefined>
}

// [SP_CTX_02_40] One commit of the decisions: the state as read (the default
// when missing or moved aside), as written, whether it was written, and the
// report's sentence ("" when nothing is newly left out).
export type AttachCommit = { before: HostAttachState; after: HostAttachState; written: boolean; text: string }

// [SP_CTX_02_40] The port HandleCompaction takes ([SP_CTX_02_07]).
export type AttachPort = {
  // before the commit: the files the catalog names, read now
  disk: () => Promise<AttachDisk>
  // inside the commit, on the state file's chain within the chains `held`
  // holds: read (an unreadable file moved aside, else nothing), plan, write;
  // undefined: nothing done
  commit: (disk: AttachDisk, frozen?: (text: string) => boolean, ratio?: number, held?: Held) => Promise<AttachCommit | undefined>
  // the commit undone: the state as read written back
  putBack: (c: AttachCommit) => Promise<void>
  // the compaction stands: the host's pass that follows refills the catalog
  passed: () => void
}

// [SP_CTX_01_05] The report's sentence on the attachments left out.
export function attachText(left: AttachLeft, ratio?: number): string {
  if (!left.copies) return ''
  return `Stale host attachments left out of each request from now on: ${left.copies} older cop${left.copies === 1 ? 'y' : 'ies'} of instruction files and skill listings (${estimate(left.chars, ratio)}).`
}

export function attachPort(mem: AttachMemory, io: AttachApplyIO): AttachPort {
  return {
    disk: async () => {
      const out = new Map<string, string | undefined>()
      for (const path of diskPaths(mem.catalog)) out.set(path, await io.readFile(path).catch(() => undefined))
      return out
    },
    commit: (disk, frozen, ratio, held) =>
      io.store.onChain(async () => {
        let read = await io.store.read()
        if (read.state === 'unreadable') {
          // [SP_CTX_01_07] a file that could not be moved aside is never overwritten
          if ((await io.store.quarantine()) === undefined) return undefined
          read = { state: 'missing', value: emptyHostAttach() }
        }
        const before = read.value
        // [SP_CTX_02_41] after another compaction the old answers count for nothing
        const base = mem.voided ? (clearedAnswers(before) ?? before) : before
        const plan = planAttachments(base, mem, disk, frozen)
        mem.voided = false
        mem.verify = Object.keys(plan.state.predicted).length > 0
        if (!plan.changed && base === before) return { before, after: before, written: false, text: '' }
        await io.store.write(plan.state)
        const newly = answersKey(plan.state.answers) !== answersKey(before.answers)
        return { before, after: plan.state, written: true, text: newly ? attachText(plan.state.left, ratio) : '' }
      }, held),
    putBack: async c => {
      if (c.written) await io.store.write(c.before)
    },
    passed: () => resetPass(mem),
  }
}

// [SP_CTX_02_41] After a compaction that is not the mod's and stands (a
// summary replaced the conversation and its attachments): the answers and
// predictions go, the facts about files stay; undefined: nothing to change.
export function clearedAnswers(s: HostAttachState): HostAttachState | undefined {
  if (!Object.keys(s.answers).length && !Object.keys(s.predicted).length && !s.left.copies) return undefined
  return { ...s, answers: {}, predicted: {}, left: { copies: 0, chars: 0 } }
}
