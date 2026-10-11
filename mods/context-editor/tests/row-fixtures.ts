import type { SessionMessage } from 'claude-code'
import type { Read } from '../hooks/store'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'

// [PL_AUD_CTX_P6] Shared builders of SessionMessage rows and port reads for
// the tests (DUP-8, TST-11). A test keeps its own builder only where its
// defaults differ on purpose (e.g. a call input the test checks).

// An assistant row with one tool call; `handle` only when given.
export function use(id: string, tool = 'Read', handle?: string, input: Record<string, unknown> = {}): SessionMessage {
  return { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input }], ...(handle ? { handle } : {}) }
}

// A user row with the result of one call; `handle` only when given.
export function result(id: string, text = `out ${id}`, handle?: string, isError = false): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError }], ...(handle ? { handle } : {}) }
}

// A person's prompt row.
export function prompt(text: string, handle?: string): SessionMessage {
  return { role: 'user', text, toolUses: [], ...(handle ? { handle } : {}) }
}

// An assistant text row.
export function reply(text: string, handle?: string): SessionMessage {
  return { role: 'assistant', text, toolUses: [], ...(handle ? { handle } : {}) }
}

// A tag registry: EMPTY_REGISTRY with fresh tag and note lists.
export function reg(extra: Partial<TagRegistry> = {}): TagRegistry {
  return { ...EMPTY_REGISTRY, tags: [], notes: [], ...extra }
}

export function okRead<T>(value: T): Read<T> {
  return { state: 'ok', value }
}

export function missingRead<T>(value: T): Read<T> {
  return { state: 'missing', value }
}

export function unreadableRead<T>(reason = 'bad json'): Read<T> {
  return { state: 'unreadable', reason }
}
