// [SP_FOLD_01_05] [SP_FOLD_02_06] The trailers: service lines the agent puts
// at the end of its final answer of a turn (`[context-editor: optimize]`,
// `[context-editor: close]`, `[context-editor: note <text>]`). This module
// parses them and finds the row of the answer a note goes on; DetectOptimize
// (stages.ts) runs the signals at the end of the turn. Pure. Its top level
// uses no import, so the cycle stages → trailers → notes → stages is safe in
// any load order.
import type { SessionMessage } from 'claude-code'
import { MAX_NOTE } from './notes'
import { isPromptRow } from './rows'

// ---- [SP_FOLD_01_06] constants

// The start of a trailer line; it ends with "]".
export const TRAILER_HEAD = '[context-editor: '
// How many last lines of an answer can be trailers.
export const MAX_TRAILERS = 5
// [SP_CTX_02_30] The optimization mark: the trailer `optimize`.
export const OPTIMIZE_MARK = `${TRAILER_HEAD}optimize]`

// ---- [SP_FOLD_01_05] TrailerSignal

export type TrailerSignal = { kind: 'optimize' } | { kind: 'close' } | { kind: 'note'; text: string }

// `unknown`: the trailer lines no signal reads, as written; `lines`: every
// trailer line read, in order (the row of the answer holds them).
export type Trailers = { signals: TrailerSignal[]; unknown: string[]; lines: string[] }

// A line, trimmed, that starts with TRAILER_HEAD and ends with "]", case included.
export function isTrailerLine(line: string): boolean {
  return line.length > TRAILER_HEAD.length && line.startsWith(TRAILER_HEAD) && line.endsWith(']')
}

// [SP_FOLD_02_06] ParseTrailers: the longest run of trailer lines at the end
// of the answer (empty lines left out, each line trimmed), at most the last
// MAX_TRAILERS of it; earlier lines of a longer run are neither signals nor
// unknown. Signals in the order of the lines. A note is one line of
// 1..MAX_NOTE chars once trimmed; a longer or empty one is unknown, never cut.
export function parseTrailers(answer: string | undefined): Trailers {
  const lines = (answer ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
  let from = lines.length
  while (from > 0 && isTrailerLine(lines[from - 1]!)) from--
  const out: Trailers = { signals: [], unknown: [], lines: lines.slice(Math.max(from, lines.length - MAX_TRAILERS)) }
  for (const line of out.lines) {
    const body = line.slice(TRAILER_HEAD.length, -1)
    if (body === 'optimize') out.signals.push({ kind: 'optimize' })
    else if (body === 'close') out.signals.push({ kind: 'close' })
    else if (body.startsWith('note ') && isNoteText(body.slice(5).trim())) out.signals.push({ kind: 'note', text: body.slice(5).trim() })
    else out.unknown.push(line)
  }
  return out
}

// [SP_FOLD_02_06] The row of the final answer a trailer note goes on: the
// last row of the assistant after the last prompt whose text holds the
// last trailer line; undefined when none (the note is not saved).
export function answerRow(rows: readonly SessionMessage[], line: string): number | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (isPromptRow(row)) return undefined
    if (row.role === 'assistant' && row.text.includes(line)) return i
  }
  return undefined
}

function isNoteText(text: string): boolean {
  return text.length >= 1 && text.length <= MAX_NOTE
}
