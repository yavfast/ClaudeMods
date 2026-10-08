import type { SessionMessage } from 'claude-code'
import { BIG_ROW, MARK, OWN_TOOLS, touchedBy, type QueuedEdit, type RefResolver } from './edits'
import type { Read } from './queue'
import { SEARCH_TOOLS } from './tags'

// [SP_CTX_01_12]
export const ALIAS_PREFIX = 'c'
export const MAX_ALIASES = 2000

// [SP_CTX_01_13] alias -> tool_use_id; `last` is the alias given last.
export type AliasRegistry = { next: number; last?: string; map: Record<string, string> }

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
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { state: 'unreadable', reason: `not JSON: ${String(err)}` }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unreadable', reason: 'not an object' }
  const reg = { ...EMPTY_ALIASES, ...(raw as Partial<AliasRegistry>) }
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
  if (reg.last !== undefined && (typeof reg.last !== 'string' || !owns(reg.map, reg.last))) return { state: 'unreadable', reason: 'bad field(s): last' }
  return { state: 'ok', value: { next: reg.next, map: { ...reg.map }, ...(reg.last !== undefined ? { last: reg.last } : {}) } }
}

// [SP_CTX_02_16] A new alias for `toolUseId`; the oldest go past MAX_ALIASES. Pure.
export function addAlias(reg: AliasRegistry, toolUseId: string): { registry: AliasRegistry; alias: string } {
  const alias = `${ALIAS_PREFIX}${reg.next}`
  const map = { ...reg.map, [alias]: toolUseId }
  const keys = Object.keys(map)
  if (keys.length > MAX_ALIASES) {
    keys.sort((a, b) => aliasNumber(a)! - aliasNumber(b)!)
    for (const old of keys.slice(0, keys.length - MAX_ALIASES)) delete map[old]
  }
  return { registry: { next: reg.next + 1, last: alias, map }, alias }
}

// [SP_CTX_02_17] The tool_use_id a ref names, or undefined: `last` is the call
// marked last, `c<n>` its own entry; an unreadable registry resolves nothing.
export function resolveRef(read: Read<AliasRegistry>, ref: string): string | undefined {
  if (read.state === 'unreadable') return undefined
  const reg = read.value
  if (ref === 'last') return reg.last !== undefined ? reg.map[reg.last] : undefined
  return aliasNumber(ref) !== undefined && owns(reg.map, ref) ? reg.map[ref] : undefined
}

export function refResolver(read: Read<AliasRegistry>): RefResolver {
  return ref => resolveRef(read, ref)
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
  const pairs = new Set(after.flatMap(r => (r.toolResults ?? []).map(t => t.tool_use_id)).filter(id => uses.has(id)))
  const map: Record<string, string> = {}
  let removed = 0
  for (const [alias, id] of Object.entries(reg.map)) {
    if (edited.has(id) || !pairs.has(id)) removed++
    else map[alias] = id
  }
  if (!removed) return reg
  const { last, ...rest } = reg
  return last !== undefined && owns(map, last) ? { ...rest, last, map } : { ...rest, map }
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
  return f.size >= BIG_ROW || SEARCH_TOOLS.includes(f.tool)
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

// [SP_CTX_02_16] The alias line to add after the call's result, or undefined:
// no mark without storage, from an unreadable registry, or when the registry
// could not be written (the alias would resolve to nothing).
export async function markCall(io: AliasIO, f: CallFacts): Promise<string | undefined> {
  if (!wantsMark(f) || !(await io.ready())) return undefined
  const read = await io.readAliases()
  if (read.state === 'unreadable') return undefined
  const { registry, alias } = addAlias(read.value, f.tool_use_id!)
  try {
    await io.writeAliases(registry)
  } catch {
    return undefined
  }
  return aliasLine(alias)
}

// The settled result with `lines` added to what the model reads after it;
// the same object when there are none.
export function withContext<T extends object>(done: T, lines: readonly string[]): T {
  if (!lines.length) return done
  const before = (done as { context?: readonly string[] }).context ?? []
  return { ...done, context: [...before, ...lines] }
}
