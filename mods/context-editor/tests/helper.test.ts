import { expect, test } from 'claude-code/testing'
import { failureReason, HELP_RETRY_TEXT, HELP_TIMEOUT_MS, helperCall, parseReply, type CompleteRequest, type CompleteResult } from '../hooks/helper'
import { journalSummary, parseJournal } from '../hooks/journal'
import { helperLine } from '../hooks/stages'

// [SP_HELP_05_01] ParseReply: the fence, the text around, extra fields
test('ParseReply — огорожа, текст довкола, зайві поля: one ```json object is read; extra fields are ignored', () => {
  const text = 'Here it is:\n```json\n{"status": "answered", "answer": "The budget is 40k", "quotes": [{"text": "budget 40k", "row": 3}], "extra": 1}\n```\nDone.'
  expect(parseReply(text)).toEqual({ status: 'answered', answer: 'The budget is 40k', quotes: [{ text: 'budget 40k', row: 3 }], reason: '' })
  // no fence: the text from the first { to the last }
  expect(parseReply('ok {"status":"not_found"} bye')).toEqual({ status: 'not_found', answer: '', quotes: [], reason: '' })
})

// [SP_HELP_05_01] ParseReply: a format failure
test('ParseReply — збій: no {…}; a status out of the list; "answered" without an answer', () => {
  expect(parseReply('no object here')).toBeUndefined()
  expect(parseReply('{"status": "maybe", "answer": "x"}')).toBeUndefined()
  expect(parseReply('{"status": "answered", "answer": "  "}')).toBeUndefined()
  expect(parseReply('{"status": "answered", "answer": "x"')).toBeUndefined()
})

function io(replies: CompleteResult[]) {
  const seen: CompleteRequest[] = []
  return {
    seen,
    io: {
      complete: async (r: CompleteRequest) => {
        seen.push(r)
        return replies.shift() ?? { failed: 'no more', in: 0, out: 0 }
      },
    },
  }
}

// [SP_HELP_05_01] HelperCall: the retry of a format failure
test('HelperCall — повтор: the first reply is no JSON, the second is: calls = 2, the second status, tokens of both', async () => {
  const h = io([
    { text: 'I think the answer is 40k.', in: 100, out: 10 },
    { text: '{"status":"answered","answer":"40k","quotes":[]}', in: 120, out: 12 },
  ])
  const r = await helperCall(h.io, 'What is the budget?', 'Material: …')
  expect(r).toEqual(expect.objectContaining({ status: 'answered', calls: 2, in: 220, out: 22 }))
  expect(h.seen[0]!.model).toBe('sonnet')
  expect(h.seen[0]!.prompt).toEqual(['Question: What is the budget?', 'Material: …'])
  expect(h.seen[1]!.prompt[2]).toBe(HELP_RETRY_TEXT)
})

// [SP_HELP_05_01] HelperCall: no retry of an API error
test('HelperCall — без повтору: an API error is failed after one call; a second format failure is failed "format"', async () => {
  const a = await helperCall(io([{ failed: 'api-error 529', in: 0, out: 0 }]).io, 'q', 'p')
  expect(a).toEqual({ status: 'failed', reply: null, reason: 'api-error 529', calls: 1, in: 0, out: 0 })
  const b = await helperCall(io([{ text: 'nope', in: 1, out: 1 }, { text: 'still nope', in: 1, out: 1 }]).io, 'q', 'p')
  expect(b).toEqual(expect.objectContaining({ status: 'failed', reason: 'format', calls: 2 }))
})

// [SP_HELP_02_13] the helper's line: the sums of the journal's `ask` entries
test('Телеметрія — помічник: the sums of the ask entries and their cost; no line without one', () => {
  const ask = (verified: number) => ({ kind: 'ask' as const, at: 1, folds: ['f1'], parts: 1, calls: 2, in: 30_000, out: 1_000, verified, rejected: 1, status: 'answered' as const })
  const sum = journalSummary({ state: 'ok', value: { entries: [ask(2), ask(1)] } })
  if ('unreadable' in sum) throw new Error('unreadable')
  expect(helperLine(sum.helper!)).toBe('Helper: 2 question(s), 4 call(s), ~60k in / ~2k out tokens (~$0.14); quotes verified 3, rejected 2.')
  const none = journalSummary({ state: 'ok', value: { entries: [] } })
  expect('helper' in none).toBe(false)
  // a journal with an ask entry reads back
  expect(parseJournal(JSON.stringify({ entries: [ask(1)] })).state).toBe('ok')
})

// [SP_HELP_02_01] FailureReason: the host's arms without text
test('HelperCall — причина збою: api-error with and without a status, empty-reply, a cut call before and at the timeout', () => {
  expect(failureReason({ reason: 'api-error', status: 529 }, 10, HELP_TIMEOUT_MS)).toBe('api-error 529')
  expect(failureReason({ reason: 'api-error', status: null }, 10, HELP_TIMEOUT_MS)).toBe('api-error without a response')
  expect(failureReason({ reason: 'empty-reply' }, 10, HELP_TIMEOUT_MS)).toBe('empty-reply')
  expect(failureReason({ reason: 'aborted' }, HELP_TIMEOUT_MS - 1, HELP_TIMEOUT_MS)).toBe('aborted')
  expect(failureReason({ reason: 'aborted' }, HELP_TIMEOUT_MS, HELP_TIMEOUT_MS)).toBe('timeout')
})
