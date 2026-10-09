import { expect, test } from 'claude-code/testing'
import { movedSince, newTurns, turnCompleted, turnStarted } from '../hooks/turns'

// ---- [SP_CTX_02] the turn counter of the main conversation

test('turn counter: starts at zero, not in a turn, last turn not aborted', async () => {
  expect(newTurns()).toEqual({ turns: 0, inTurn: false, lastTurnAborted: false })
})

test('turn counter: a start counts and opens the turn; its end closes it and records the abort', async () => {
  const t = newTurns()
  turnStarted(t)
  expect(t).toEqual({ turns: 1, inTurn: true, lastTurnAborted: false })
  turnCompleted(t, true)
  expect(t).toEqual({ turns: 1, inTurn: false, lastTurnAborted: true })
  turnStarted(t)
  turnCompleted(t, false)
  expect(t).toEqual({ turns: 2, inTurn: false, lastTurnAborted: false })
})

test('Лічильник ходів — промпт з цитатою мітки: an ordinary turn, counted like any other', async () => {
  // the turn.start of a prompt with the text "context-editor: apply queued edits"
  const t = newTurns()
  const snapshot = t.turns
  turnStarted(t)
  expect(t.turns).toBe(1)
  expect(t.inTurn).toBe(true)
  expect(movedSince(t, snapshot)).toBe(true)
  turnCompleted(t, false)
  expect(movedSince(t, snapshot)).toBe(true)
  expect(movedSince(t, t.turns)).toBe(false)
})

// Лічильник ходів — команди мода: that the host raises no turn events for
// the mod's `/clear` and `/compact` is a host property; it is verified live
// (scenario «Завершення команди після обробника», spike Entry 4), not here.
// Unit level only: the counter moves through turnStarted / turnCompleted alone.
test('turn counter (unit-level placeholder for «команди мода»): nothing but turn events moves it', async () => {
  const t = newTurns()
  turnStarted(t)
  turnCompleted(t, false)
  expect(t).toEqual({ turns: 1, inTurn: false, lastTurnAborted: false })
  expect(movedSince(t, 1)).toBe(false)
})

test('MovedSince: a running turn, or a turn count other than the snapshot', async () => {
  expect(movedSince({ turns: 3, inTurn: false, lastTurnAborted: false }, 3)).toBe(false)
  expect(movedSince({ turns: 3, inTurn: true, lastTurnAborted: false }, 3)).toBe(true)
  expect(movedSince({ turns: 4, inTurn: false, lastTurnAborted: false }, 3)).toBe(true)
})
