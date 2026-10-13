import { expect, test } from 'claude-code/testing'
import { cutText, shapeSubagentResult, SUB_CUT_AT, SUB_HEAD, SUB_TAIL, type ShapeIO, type SubagentRow } from '../hooks/subagents'

const DIR = '/home/u/.claude/context-editor/s1'

function fakeIO(ok = true, dir: string | undefined = DIR): ShapeIO & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    storage: async () => dir,
    write: async (path, text) => {
      if (!ok) return false
      files.set(path, text)
      return true
    },
  }
}

// lines of 99 chars + "\n"
function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `${String(i).padStart(5, '0')} ${'x'.repeat(93)}`).join('\n') + '\n'
}

function row(content: unknown, over: Partial<SubagentRow> = {}): SubagentRow {
  return {
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Bash' },
    agentId: 'a1b2',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content }] },
    ...over,
  }
}

function block(e: SubagentRow): { content: unknown; is_error?: boolean; tool_use_id: string } {
  return (e.message.content as { content: unknown; is_error?: boolean; tool_use_id: string }[])[0]!
}

const CUT = /\n\[context-editor: (\d+) chars cut; full output: (\S+), open with Read\]\n/

test('ShapeSubagentResult: big output is archived and cut to head, line, tail', async () => {
  const text = lines(200) // 20 000 chars
  expect(text.length).toBe(20000)
  const io = fakeIO()
  const out = await shapeSubagentResult(io, row(text))
  const path = `${DIR}/subagents/a1b2/toolu_01.txt`
  expect(io.files.get(path)).toBe(text)
  const cut = block(out).content as string
  const m = CUT.exec(cut)
  expect(m !== null).toBe(true)
  expect(m![2]).toBe(path)
  const head = cut.slice(0, m!.index)
  const tail = cut.slice(m!.index + m![0].length)
  expect(head.length <= SUB_HEAD).toBe(true)
  expect(tail.length <= SUB_TAIL).toBe(true)
  expect(head.length + Number(m![1]) + tail.length).toBe(20000)
  expect(text.startsWith(head)).toBe(true)
  expect(text.endsWith(tail)).toBe(true)
  // bounds on line ends
  expect(head.endsWith('\n')).toBe(true)
  expect(text.slice(0, text.length - tail.length).endsWith('\n')).toBe(true)
  expect(block(out).tool_use_id).toBe('toolu_01')
})

test('cutText: no line end in the window keeps the fixed bounds', () => {
  const text = 'y'.repeat(10000)
  const cut = cutText(text, '/p')
  expect(cut).toBe(`${'y'.repeat(SUB_HEAD)}\n[context-editor: ${10000 - SUB_HEAD - SUB_TAIL} chars cut; full output: /p, open with Read]\n${'y'.repeat(SUB_TAIL)}`)
})

test('cutText: a line end in the first half of a window keeps the fixed bound', () => {
  // head: "\n" at SUB_HEAD/2 - 1; tail: "\n" at t + SUB_TAIL/2
  const n = 10000
  const t = n - SUB_TAIL
  const chars = Array.from({ length: n }, () => 'y')
  chars[SUB_HEAD / 2 - 1] = '\n'
  chars[t + SUB_TAIL / 2] = '\n'
  const text = chars.join('')
  const cut = cutText(text, '/p')
  expect(cut.startsWith(`${text.slice(0, SUB_HEAD)}\n[context-editor: ${t - SUB_HEAD} chars cut;`)).toBe(true)
  expect(cut.endsWith(`open with Read]\n${text.slice(t)}`)).toBe(true)
  // the bound moves at SUB_HEAD/2 exactly
  chars[SUB_HEAD / 2 - 1] = 'y'
  chars[SUB_HEAD / 2] = '\n'
  expect(cutText(chars.join(''), '/p').startsWith(`${chars.join('').slice(0, SUB_HEAD / 2 + 1)}\n[context-editor:`)).toBe(true)
})

test('ShapeSubagentResult: small output, main conversation, Read, own tools, unknown stay', async () => {
  const big = lines(100)
  const cases: SubagentRow[] = [
    row('z'.repeat(SUB_CUT_AT - 1)),
    row(big, { agentId: undefined }),
    row(big, { origin: { kind: 'tool', tool: 'Read' } }),
    row(big, { origin: { kind: 'tool', tool: 'mcp__context-editor__context_list' } }),
    row(big, { origin: { kind: 'tool', tool: 'unknown' } }),
    row(big, { origin: { kind: 'model' } }),
    row(big, { door: 'tool-message' }),
  ]
  for (const e of cases) {
    const io = fakeIO()
    expect(await shapeSubagentResult(io, e)).toBe(e)
    expect(io.files.size).toBe(0)
  }
})

test('ShapeSubagentResult: text blocks are joined and cut with one line; an image keeps the block', async () => {
  const parts = [{ type: 'text', text: 'a'.repeat(5000) }, { type: 'text', text: 'b'.repeat(5000) }]
  const io = fakeIO()
  const out = await shapeSubagentResult(io, row(parts))
  expect(io.files.get(`${DIR}/subagents/a1b2/toolu_01.txt`)).toBe(`${'a'.repeat(5000)}\n${'b'.repeat(5000)}`)
  expect(typeof block(out).content).toBe('string')
  expect(((block(out).content as string).match(/chars cut/g) ?? []).length).toBe(1)

  const media = [...parts, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]
  const e = row(media)
  const io2 = fakeIO()
  expect(await shapeSubagentResult(io2, e)).toBe(e)
  expect(io2.files.size).toBe(0)
})

test('ShapeSubagentResult: a failed write or no storage leaves the row', async () => {
  const e = row(lines(100))
  expect(await shapeSubagentResult(fakeIO(false), e)).toBe(e)
  expect(await shapeSubagentResult({ ...fakeIO(), storage: async () => undefined }, e)).toBe(e)
})

test('ShapeSubagentResult: an invalid id writes nothing', async () => {
  const big = lines(100)
  for (const e of [
    { ...row(big), message: { content: [{ type: 'tool_result', tool_use_id: '../x', content: big }] } },
    { ...row(big), message: { content: [{ type: 'tool_result', tool_use_id: 'a/b', content: big }] } },
    row(big, { agentId: '..' }),
  ]) {
    const io = fakeIO()
    expect(await shapeSubagentResult(io, e)).toBe(e)
    expect(io.files.size).toBe(0)
  }
})

test('ShapeSubagentResult: is_error stays; other blocks are carried', async () => {
  const big = lines(100)
  const e: SubagentRow = {
    ...row(big),
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_01', content: big, is_error: true },
        { type: 'tool_result', tool_use_id: 'toolu_02', content: 'small' },
      ],
    },
  }
  const out = await shapeSubagentResult(fakeIO(), e)
  const blocks = out.message.content as { content: unknown; is_error?: boolean }[]
  expect(blocks[0]!.is_error).toBe(true)
  expect(CUT.test(blocks[0]!.content as string)).toBe(true)
  expect(blocks[1]).toBe((e.message.content as unknown[])[1])
})
