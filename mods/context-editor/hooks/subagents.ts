// [SP_CTX_02_49] [C_CTX_03_09] ShapeSubagentResult: a big new tool result of a
// subagent goes to an archive and into the subagent's conversation as a head,
// a cut line naming the archive and a tail. Pure: the storage and the write
// come through ShapeIO.
import { OWN_TOOLS } from './edits'

// [SP_CTX_01_12] Constants of the cut.
export const SUB_CUT_AT = 8000
export const SUB_HEAD = 2500
export const SUB_TAIL = 1500
export const SUB_ID = /^[A-Za-z0-9_-]{1,128}$/

export interface ShapeIO {
  // the folder of the current session, or none
  storage(): Promise<string | undefined>
  // writes an owner-only text file, its folder made; false when it failed
  write(path: string, text: string): Promise<boolean>
}

// The part of a session.append event the shaping reads; the rest is carried.
export interface SubagentRow {
  readonly door: string
  readonly origin: { readonly kind: string; readonly tool?: string }
  readonly agentId?: string
  readonly message: { readonly content?: unknown }
}

// [SP_CTX_02_49] Cut(text, path): head, the cut line, tail; the bounds move to
// a line end when one is in the second half of their window.
export function cutText(text: string, path: string): string {
  let h = SUB_HEAD
  const i = text.lastIndexOf('\n', SUB_HEAD - 1)
  if (i >= SUB_HEAD / 2) h = i + 1
  let t = text.length - SUB_TAIL
  const j = text.indexOf('\n', t)
  if (j >= 0 && j - t < SUB_TAIL / 2) t = j + 1
  return `${text.slice(0, h)}\n[context-editor: ${t - h} chars cut; full output: ${path}, open with Read]\n${text.slice(t)}`
}

// The text of a tool_result's content: a string, or text blocks only joined by
// "\n"; undefined when it holds anything else (media is not cut).
function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.length === 0) return undefined
  const parts: string[] = []
  for (const b of content) {
    if (!b || typeof b !== 'object' || (b as { type?: unknown }).type !== 'text') return undefined
    const t = (b as { text?: unknown }).text
    if (typeof t !== 'string') return undefined
    parts.push(t)
  }
  return parts.join('\n')
}

// [SP_CTX_02_49] The event with the cut content, or the same event when
// nothing changed.
export async function shapeSubagentResult<E extends SubagentRow>(io: ShapeIO, e: E): Promise<E> {
  if (e.door !== 'tool-result' || !e.agentId || e.origin.kind !== 'tool') return e
  const tool = e.origin.tool ?? 'unknown'
  if (tool === 'Read' || tool === 'unknown' || tool.startsWith(OWN_TOOLS)) return e
  if (!SUB_ID.test(e.agentId)) return e
  const content = e.message.content
  if (!Array.isArray(content)) return e
  if (!content.some((b) => isBigResult(b))) return e
  const dir = await io.storage()
  if (!dir) return e
  let changed = false
  const out: unknown[] = []
  for (const b of content) {
    if (!isBigResult(b)) {
      out.push(b)
      continue
    }
    const r = b as { tool_use_id: string; content: unknown }
    const text = resultText(r.content) as string
    const path = `${dir}/subagents/${e.agentId}/${r.tool_use_id}.txt`
    if (!(await io.write(path, text))) {
      out.push(b)
      continue
    }
    out.push({ ...r, content: cutText(text, path) })
    changed = true
  }
  return changed ? { ...e, message: { ...e.message, content: out } } : e
}

// A tool_result block with a valid id whose text reaches SUB_CUT_AT.
function isBigResult(b: unknown): boolean {
  if (!b || typeof b !== 'object') return false
  const r = b as { type?: unknown; tool_use_id?: unknown; content?: unknown }
  if (r.type !== 'tool_result' || typeof r.tool_use_id !== 'string' || !SUB_ID.test(r.tool_use_id)) return false
  const text = resultText(r.content)
  return text !== undefined && text.length >= SUB_CUT_AT
}
