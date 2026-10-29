import type { SessionMessage } from 'claude-code'
import { commandOf, errorText } from './rows'

// [SP_CTX_01_33] [SP_CTX_02_70]–[SP_CTX_02_74] The session title (phase 48,
// C_CTX_03_12): the state in the tag registry and its transitions. Pure.

// [SP_CTX_01_12] the longest title, the records of the mod's renames kept,
// the longest refusal text kept
export const MAX_TITLE = 80
export const MAX_TITLE_RUNS = 20
export const MAX_TITLE_REFUSED = 200

// [SP_CTX_01_33] `after`: the handle of the last row of the conversation
// before the mod's /rename; its rows stand after that row.
export type TitleRun = { after: string; title: string }
export type TitleState = { want?: string; set?: string; person?: true; refused?: string; runs?: TitleRun[] }

export type TitleError = 'TITLE_FIELDS' | 'TITLE_TEXT' | 'TITLE_PERSON'

function isTitleText(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= MAX_TITLE && v === v.trim() && !/[\r\n]/.test(v)
}

function isRun(v: unknown): v is TitleRun {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  return typeof r.after === 'string' && r.after.length > 0 && isTitleText(r.title)
}

// [SP_CTX_01_33] Every field by type and constraint: a wrong one makes the
// registry unreadable (ParseRegistry).
export function isTitleState(v: unknown): v is TitleState {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const s = v as Record<string, unknown>
  return (
    (s.want === undefined || isTitleText(s.want)) &&
    (s.set === undefined || isTitleText(s.set)) &&
    (s.person === undefined || s.person === true) &&
    (s.refused === undefined || (typeof s.refused === 'string' && s.refused.length >= 1 && s.refused.length <= MAX_TITLE_REFUSED)) &&
    (s.runs === undefined || (Array.isArray(s.runs) && s.runs.length <= MAX_TITLE_RUNS && s.runs.every(isRun)))
  )
}

// [SP_CTX_01_33] TitleDue: a title the session does not show yet.
export function titleDue(s: TitleState | undefined): s is TitleState & { want: string } {
  return s?.want !== undefined && s.want !== s.set
}

// The state with the fields that are undefined left out, so the stored JSON
// stays as small as the spec's table; undefined when nothing is left.
function tidy(s: TitleState): TitleState | undefined {
  const out: TitleState = {}
  if (s.want !== undefined) out.want = s.want
  if (s.set !== undefined) out.set = s.set
  if (s.person) out.person = true
  if (s.refused !== undefined) out.refused = s.refused
  if (s.runs?.length) out.runs = s.runs
  return Object.keys(out).length ? out : undefined
}

function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const head = flat.slice(0, max - 1)
  return (/[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head) + '…'
}

export type TitleOpOutcome = {
  title: TitleState | undefined
  lines: string[]
  changed: boolean
  error?: { code: TitleError; why: string }
}

// [SP_CTX_02_70] TitleOp over the registry's title: the request's fields are
// checked first; a refusal of the last rename is named once, then cleared.
export function titleOp(s: TitleState | undefined, r: Record<string, unknown>): TitleOpOutcome {
  if (Object.keys(r).some(k => k !== 'op' && k !== 'text'))
    return { title: s, lines: [], changed: false, error: { code: 'TITLE_FIELDS', why: 'title takes only "text"' } }
  const t = typeof r.text === 'string' ? r.text.trim() : undefined
  if (t === undefined || !isTitleText(t))
    return { title: s, lines: [], changed: false, error: { code: 'TITLE_TEXT', why: `title needs "text", one line of 1..${MAX_TITLE} chars` } }
  const lines: string[] = []
  let next: TitleState = { ...s }
  let changed = false
  if (next.refused !== undefined) {
    lines.push(`The last rename failed: ${next.refused}.`)
    next = { ...next, refused: undefined }
    changed = true
  }
  if (next.person)
    return { title: tidy(next), lines, changed, error: { code: 'TITLE_PERSON', why: 'the person named this session; the mod keeps their title' } }
  lines.push(t === next.set ? 'The session already has this title.' : `Title "${t}" set: the mod renames the session when this turn ends.`)
  if (next.want !== t) changed = true
  next.want = t
  return { title: tidy(next), lines, changed }
}

// [SP_CTX_02_71] The person's /rename: any origin but a plugin's (the mod's
// own $.command.run never reaches its hook).
export function isPersonRename(e: { origin: { kind: string } }): boolean {
  return e.origin.kind !== 'plugin'
}

// [SP_CTX_02_71] PersonRename: the person's /rename, with its args; without
// a name the host makes one the mod does not know.
export function personRename(s: TitleState | undefined, args: string): TitleState {
  const a = cut(args, MAX_TITLE)
  return { ...tidy({ ...s, refused: undefined, want: a || undefined, set: a || undefined }), person: true }
}

// [SP_CTX_02_72] The mod's /rename with `ran` went through; `after`: the
// handle of the last row before it, absent when the rows were not read.
export function renameRan(s: TitleState | undefined, ran: string, after?: string): TitleState {
  const runs = after ? [...(s?.runs ?? []), { after, title: ran }].slice(-MAX_TITLE_RUNS) : s?.runs
  return tidy({ ...s, set: ran, runs }) ?? { set: ran }
}

// [SP_CTX_02_72] The host refused the mod's /rename with `ran`: the want goes
// unless a newer one came meanwhile; the next TitleOp names the refusal.
export function renameRefused(s: TitleState | undefined, ran: string, err: unknown): TitleState {
  const text = cut(errorText(err), MAX_TITLE_REFUSED) || 'refused'
  return tidy({ ...s, refused: text, want: s?.want === ran ? undefined : s?.want }) ?? { refused: text }
}

// [SP_CTX_02_73] The visible row of the mod's /rename with `title` (the
// stream-json host shows only this one of its rows).
export function isRenameRow(row: SessionMessage | undefined, title: string): boolean {
  if (!row || row.role !== 'user' || row.toolResults?.length) return false
  const cmd = commandOf(row.text)
  return cmd?.name === '/rename' && cmd.args === title
}

// [SP_CTX_02_73] The commit: a run stays while its row is in the rows
// returned with its handle.
export function keepRuns(s: TitleState | undefined, rows: readonly SessionMessage[]): TitleState | undefined {
  if (!s?.runs?.length) return s
  const handles = new Set(rows.map(r => r.handle).filter(Boolean))
  const runs = s.runs.filter(r => handles.has(r.after))
  return runs.length === s.runs.length ? s : tidy({ ...s, runs })
}

// [SP_CTX_02_74] CarryTitle: the new session gets the title to show and
// whether the person chose it; never `set`, `refused` or `runs`.
export function carryTitle(s: TitleState | undefined): TitleState | undefined {
  const want = s?.want ?? s?.set
  return tidy({ want, person: s?.person })
}

// [SP_CTX_02_72] The ports of the rename at the end of a turn; register.ts
// binds them to `$`.
export type RenameIO = {
  // the registry's title; unreadable: no rename
  readTitle: () => Promise<{ state: 'ok'; value: TitleState | undefined } | { state: 'unreadable' | 'missing' }>
  // the handle (uuid) of the last visible row of the main conversation; a throw: none
  lastHandle: () => Promise<string | undefined>
  // runs the built-in /rename with `args`, once; rejects with the host's text
  rename: (args: string) => Promise<void>
  // on the registry's chain: `change` sees the title as it is then
  updateTitle: (change: (s: TitleState | undefined) => TitleState | undefined) => Promise<unknown>
  // [ERR-01] the trace of the rename and of a swallowed failure; absent: none
  debug?: (text: string) => void
}

export type Renamed = 'ran' | 'refused'

// [SP_CTX_02_72] RenameAtTurnEnd's rename: one attempt with the title due;
// the outcome goes into the registry. Undefined when nothing was due or the
// registry could not be read; never throws.
export async function runRename(io: RenameIO): Promise<Renamed | undefined> {
  const read = await io.readTitle().catch(e => {
    io.debug?.(`title: registry not read: ${errorText(e)}`)
    return { state: 'unreadable' as const }
  })
  const s = read.state === 'ok' ? read.value : undefined
  if (!titleDue(s)) return undefined
  const want = s.want
  const after = await io.lastHandle().catch(e => {
    io.debug?.(`title: no row before the rename: ${errorText(e)}`)
    return undefined
  })
  let outcome: Renamed
  let err: unknown
  try {
    await io.rename(want)
    outcome = 'ran'
  } catch (e) {
    outcome = 'refused'
    err = e
  }
  io.debug?.(outcome === 'ran' ? 'title: renamed the session' : `title: rename refused: ${errorText(err)}`)
  await io.updateTitle(t => (outcome === 'ran' ? renameRan(t, want, after) : renameRefused(t, want, err))).catch(e => io.debug?.(`title: registry not updated: ${errorText(e)}`))
  return outcome
}
