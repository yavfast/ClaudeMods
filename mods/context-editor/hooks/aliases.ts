import type { SessionMessage } from 'claude-code'
import { callLabel, OWN_TOOLS, touchedBy, unknownRef, type QueuedEdit, type RefResolver, type Resolved } from './edits'
import { findToolResult, findToolUse, isPromptRowStrict, MARK, resultsOf, worthEditing } from './rows'
import { jsonObject, type Read } from './store'

// [SP_CTX_01_12]
export const ALIAS_PREFIX = 'c'
export const MAX_ALIASES = 2000

// [SP_CTX_01_13] alias -> tool_use_id. A `last` field of a file from before
// phase 21 is ignored: "last" resolves on the rows ([SP_CTX_02_17]).
export type AliasRegistry = { next: number; map: Record<string, string> }

export const EMPTY_ALIASES: AliasRegistry = { next: 1, map: {} }

function owns(map: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key)
}

const ALIAS = new RegExp(`^${ALIAS_PREFIX}([1-9][0-9]*)$`)

function aliasNumber(alias: string): number | undefined {
  const m = ALIAS.exec(alias)
  return m ? Number(m[1]) : undefined
}

// [SP_CTX_01_13] Read states as the queue's: a wrong field or entry makes the
// whole file unreadable, never silently an empty registry.
export function parseAliases(text: string): Read<AliasRegistry> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  const reg = { ...EMPTY_ALIASES, ...(raw.value as Partial<AliasRegistry>) }
  const map = reg.map as unknown
  const bad = [
    !(typeof reg.next === 'number' && Number.isInteger(reg.next) && reg.next >= 1) && 'next',
    (typeof map !== 'object' || map === null || Array.isArray(map)) && 'map',
  ].filter(Boolean)
  if (bad.length) return { state: 'unreadable', reason: `bad field(s): ${bad.join(', ')}` }
  const entries = Object.entries(reg.map)
  if (entries.length > MAX_ALIASES) return { state: 'unreadable', reason: `more than ${MAX_ALIASES} aliases` }
  const badEntry = entries.find(([alias, id]) => {
    const n = aliasNumber(alias)
    return n === undefined || n >= reg.next || typeof id !== 'string' || id === ''
  })
  if (badEntry) return { state: 'unreadable', reason: `bad alias ${JSON.stringify(badEntry[0])}` }
  return { state: 'ok', value: { next: reg.next, map: { ...reg.map } } }
}

// [SP_CTX_02_16] [SP_CTX_01_13] A new alias for `toolUseId`; an alias older
// than the newest MAX_ALIASES numbers goes: the one MAX_ALIASES numbers back,
// without a sort ([PL_AUD_CTX_P11], CF-22). A registry that still holds more
// than MAX_ALIASES (older numbers kept past pruned ones by a file from before
// phase 11) loses every number below the window at once. Pure.
export function addAlias(reg: AliasRegistry, toolUseId: string): { registry: AliasRegistry; alias: string } {
  const alias = `${ALIAS_PREFIX}${reg.next}`
  const map = { ...reg.map, [alias]: toolUseId }
  const oldest = reg.next - MAX_ALIASES
  delete map[`${ALIAS_PREFIX}${oldest}`]
  if (Object.keys(map).length > MAX_ALIASES) for (const key of Object.keys(map)) if (aliasNumber(key)! <= oldest) delete map[key]
  return { registry: { next: reg.next + 1, map }, alias }
}

// [SP_CTX_01_12] LAST_TEXTS
export const LAST_NONE = '"last" names no call: no finished call of yours before this one (context_* calls do not count)'
export function lastPending(label: string): string {
  return `"last" is ${label}, which has no result yet; use "last" once its result is in, or name another target`
}
export function lastOrphan(label: string): string {
  return `"last" is ${label}, a call of an earlier turn that never got a result, so it cannot be a target; name the call you mean by its "tool_use_id" or alias`
}
export function lastLine(label: string): string {
  return `"last" = ${label}`
}

// [SP_CTX_02_17] ResolveLast: the latest call of the conversation written
// before this one (`callId`), marked or not, the mod's own tools aside; one
// of the same response without a result yet is refused, never swapped for an
// older one. The row of this call is already in the rows mid-turn (plugin-hooks
// item 52); without it every row counts. Parallel calls are rows in the order
// they were written (item 40): the one written last wins. A call left without
// a result by an earlier turn is refused by its own text. Pure.
export function resolveLast(rows: readonly SessionMessage[], callId?: string, aliases: ReadonlyMap<string, string> = new Map()): Resolved {
  const found = callId ? findToolUse(rows, callId) : -1
  const carrier = found < 0 ? rows.length : found
  for (let i = Math.min(carrier, rows.length - 1); i >= 0; i--) {
    const uses = rows[i]!.toolUses
    const end = i === carrier ? uses.findIndex(u => u.tool_use_id === callId) : uses.length
    for (let k = end - 1; k >= 0; k--) {
      const use = uses[k]!
      if (use.tool.startsWith(OWN_TOOLS)) continue
      const label = callLabel(use, aliases.get(use.tool_use_id))
      const later = rows.slice(i + 1, Math.max(carrier, i + 1))
      if (findToolResult(rows.slice(i + 1), use.tool_use_id) >= 0) return { id: use.tool_use_id, line: lastLine(label) }
      // a prompt row between the call and this one: the call's turn ended
      // without a result (a process killed mid-tool, then --resume; the host
      // repairs the pair only in the API view, plugin-hooks item 40)
      return { error: later.some(isPromptRowStrict) ? lastOrphan(label) : lastPending(label) }
    }
  }
  return { error: LAST_NONE }
}

// [SP_CTX_02_17] ResolveRef: `c<n>` by the registry, "last" by the rows (it
// resolves even when the registry cannot be read); `callId` is the tool_use_id
// of the context_* call that resolves it.
export function refResolver(read: Read<AliasRegistry>, callId?: string): RefResolver {
  const reg = read.state === 'unreadable' ? undefined : read.value
  return (ref, rows) => {
    if (ref === 'last') return resolveLast(rows, callId, reg ? aliasesById(reg) : new Map())
    if (reg && aliasNumber(ref) !== undefined && owns(reg.map, ref)) return { id: reg.map[ref]! }
    return { error: unknownRef(ref) }
  }
}

// [SP_CTX_02_01] The alias of each tool_use_id, for the listing.
export function aliasesById(reg: AliasRegistry): Map<string, string> {
  const byId = new Map<string, string>()
  for (const [alias, id] of Object.entries(reg.map)) byId.set(id, alias)
  return byId
}

// [SP_CTX_02_14] The registry after a batch: aliases of pairs an applied edit
// changed go, so do aliases whose pair is not in the new rows. The same
// registry when nothing goes. Pure.
export function pruneAliases(
  reg: AliasRegistry,
  before: readonly SessionMessage[],
  after: readonly SessionMessage[],
  applied: readonly QueuedEdit[],
): AliasRegistry {
  const edited = new Set<string>()
  for (const edit of applied) for (const id of touchedBy(before, edit)?.ids ?? []) edited.add(id)
  const uses = new Set(after.flatMap(r => r.toolUses.map(u => u.tool_use_id)))
  const pairs = new Set(after.flatMap(r => resultsOf(r).map(t => t.tool_use_id)).filter(id => uses.has(id)))
  const map: Record<string, string> = {}
  let removed = 0
  for (const [alias, id] of Object.entries(reg.map)) {
    if (edited.has(id) || !pairs.has(id)) removed++
    else map[alias] = id
  }
  if (!removed) return reg
  return { ...reg, map }
}

// [SP_CTX_02_16] What MarkCall reads from one finished tool call.
export type CallFacts = { agentId?: unknown; denied: boolean; tool: string; tool_use_id?: string; size: number }

type Settled = { deny?: unknown; result?: unknown; text?: unknown }

// The size of the result as the model reads it: core's `text`, else the
// serialized `result` of a hook's own answer.
export function callFacts(e: { agentId?: unknown; tool: unknown; tool_use_id?: unknown }, done: Settled): CallFacts {
  const size = typeof done.text === 'string' ? done.text.length : (JSON.stringify(done.result) ?? '').length
  return {
    agentId: e.agentId,
    denied: done.deny !== undefined,
    tool: String(e.tool),
    tool_use_id: typeof e.tool_use_id === 'string' && e.tool_use_id ? e.tool_use_id : undefined,
    size,
  }
}

// [SP_CTX_02_16] Only calls worth editing of the main loop get an alias.
export function wantsMark(f: CallFacts): boolean {
  if (f.agentId || f.denied || f.tool.startsWith(OWN_TOOLS) || !f.tool_use_id) return false
  return worthEditing(f.tool, f.size)
}

export function aliasLine(alias: string): string {
  return `${MARK} id ${alias}: use it as "ref" in context_tag / context_edit`
}

// What MarkCall needs from the host; register.ts binds it to `$` and runs it
// on the alias registry's serial chain.
export type AliasIO = {
  ready: () => Promise<boolean>
  readAliases: () => Promise<Read<AliasRegistry>>
  writeAliases: (reg: AliasRegistry) => Promise<void>
}

// [SP_CTX_02_16] The new alias of the call, or undefined: no mark without
// storage, from an unreadable registry, or when the registry could not be
// written (the alias would resolve to nothing).
export async function markAlias(io: AliasIO, f: CallFacts): Promise<string | undefined> {
  if (!wantsMark(f) || !(await io.ready())) return undefined
  const read = await io.readAliases()
  if (read.state === 'unreadable') return undefined
  const { registry, alias } = addAlias(read.value, f.tool_use_id!)
  try {
    await io.writeAliases(registry)
  } catch {
    return undefined
  }
  return alias
}

// [SP_CTX_02_16] The alias line to add after the call's result, or undefined;
// a soft hint replaces it with a line that starts with the same id ([SP_CTX_02_37]).
export async function markCall(io: AliasIO, f: CallFacts): Promise<string | undefined> {
  const alias = await markAlias(io, f)
  return alias ? aliasLine(alias) : undefined
}

// The settled result with `lines` added to what the model reads after it;
// the same object when there are none.
export function withContext<T extends object>(done: T, lines: readonly string[]): T {
  if (!lines.length) return done
  const before = (done as { context?: readonly string[] }).context ?? []
  return { ...done, context: [...before, ...lines] }
}
