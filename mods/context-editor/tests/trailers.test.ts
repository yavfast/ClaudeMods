import { expect, test } from 'claude-code/testing'
import { MAX_NOTE } from '../hooks/notes'
import { answerRow, isTrailerLine, MAX_TRAILERS, OPTIMIZE_MARK, parseTrailers, TRAILER_HEAD } from '../hooks/trailers'
import { prompt, reply, result, use } from './row-fixtures'

// ---- [SP_FOLD_02_06] ParseTrailers

test('ParseTrailers — сумісність: an answer whose last line is the optimization mark gives [optimize]', () => {
  expect(OPTIMIZE_MARK).toBe('[context-editor: optimize]')
  expect(TRAILER_HEAD).toBe('[context-editor: ')
  expect(MAX_TRAILERS).toBe(5)
  expect(parseTrailers(`Done.\n\n${OPTIMIZE_MARK}`)).toEqual({ signals: [{ kind: 'optimize' }], unknown: [], lines: [OPTIMIZE_MARK] })
  // blank lines and spaces around the lines do not count
  expect(parseTrailers(`text\n\n  ${OPTIMIZE_MARK}  \n\n`).signals).toEqual([{ kind: 'optimize' }])
})

test('ParseTrailers — кілька сигналів: `note …` and `close` as the two last lines give both, in order', () => {
  const t = parseTrailers('Done.\n[context-editor: note the fix is in parse.py:78]\n[context-editor: close]')
  expect(t.signals).toEqual([{ kind: 'note', text: 'the fix is in parse.py:78' }, { kind: 'close' }])
  expect(t.unknown).toEqual([])
  expect(t.lines).toEqual(['[context-editor: note the fix is in parse.py:78]', '[context-editor: close]'])
  // the note's text is trimmed; a "]" inside it stays
  expect(parseTrailers('[context-editor: note   see [x] here  ]').signals).toEqual([{ kind: 'note', text: 'see [x] here' }])
})

test('ParseTrailers — не в кінці: a trailer followed by text gives nothing', () => {
  for (const answer of [
    `${OPTIMIZE_MARK}\nmore text`,
    'put [context-editor: optimize] on the last line\nok',
    'x\nsee [context-editor: optimize]',
    'x\n[context-editor:optimize]',
    'x\n[Context-Editor: optimize]',
    '',
  ])
    expect(parseTrailers(answer)).toEqual({ signals: [], unknown: [], lines: [] })
  expect(parseTrailers(undefined)).toEqual({ signals: [], unknown: [], lines: [] })
})

test('ParseTrailers — межа: of seven trailer lines in a row only the last five are read; the earlier ones are neither signals nor unknown', () => {
  const seven = ['[context-editor: foo]', '[context-editor: bar]', ...Array.from({ length: 5 }, (_, i) => `[context-editor: note n${i}]`)]
  const t = parseTrailers(`text\n${seven.join('\n')}`)
  expect(t.signals).toEqual(Array.from({ length: 5 }, (_, i) => ({ kind: 'note' as const, text: `n${i}` })))
  expect(t.unknown).toEqual([])
  expect(t.lines.length).toBe(MAX_TRAILERS)
})

test('ParseTrailers — нерозпізнане: an unknown body, a note without text or longer than MAX_NOTE (never cut)', () => {
  const long = `[context-editor: note ${'x'.repeat(MAX_NOTE + 1)}]`
  const t = parseTrailers(`a\n[context-editor: foo]\n[context-editor: note  ]\n${long}\n[context-editor: Close]\n[context-editor: close]`)
  expect(t.signals).toEqual([{ kind: 'close' }])
  expect(t.unknown).toEqual(['[context-editor: foo]', '[context-editor: note  ]', long, '[context-editor: Close]'])
  expect(parseTrailers(`[context-editor: note ${'x'.repeat(MAX_NOTE)}]`).signals).toEqual([{ kind: 'note', text: 'x'.repeat(MAX_NOTE) }])
  expect(isTrailerLine('[context-editor: x]')).toBe(true)
  expect(isTrailerLine('[context-editor: x')).toBe(false)
})

// ---- the row of the answer

test('answerRow: the last assistant row of the turn whose text holds the line; none before the last prompt', () => {
  const line = '[context-editor: close]'
  const rows = [prompt('p'), reply(`old\n${line}`), prompt('q'), use('a'), result('a'), reply(`Done.\n${line}`)]
  expect(answerRow(rows, line)).toBe(5)
  // the answer row is not in the rows (yet): the reply of an earlier turn is not taken
  expect(answerRow(rows.slice(0, 5), line)).toBeUndefined()
  expect(answerRow([], line)).toBeUndefined()
})
