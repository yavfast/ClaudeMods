// [SP_CTX_02] The turn counter of the main conversation, shared by Flush
// ([SP_CTX_02_06]), AutoTag ([SP_CTX_02_12]) and RunHandoff ([SP_CTX_02_21]).
// Module memory: a reload starts it over. The mod's own commands (`/clear`,
// `/compact`) raise no turn events, so it moves only with the turns of the
// person or the agent.

export type Turns = {
  // turns of the main conversation started in this instance of the module
  turns: number
  // a turn runs now
  inTurn: boolean
  // the last completed turn of the main conversation was interrupted
  lastTurnAborted: boolean
}

export function newTurns(): Turns {
  return { turns: 0, inTurn: false, lastTurnAborted: false }
}

// [SP_CTX_02] ON turn start (main loop): turns += 1; inTurn = true. A prompt
// quoting MARKER is an ordinary turn and counts.
export function turnStarted(t: Turns): void {
  t.turns += 1
  t.inTurn = true
}

// [SP_CTX_02] ON turn complete (main loop), before the steps of 02_06, 02_12,
// 02_21 and before `next`.
export function turnCompleted(t: Turns, aborted: boolean): void {
  t.inTurn = false
  t.lastTurnAborted = aborted
}

// [SP_CTX_02] MovedSince(t): a turn runs, or one started since the snapshot `t`.
export function movedSince(t: Readonly<Turns>, snapshot: number): boolean {
  return t.inTurn || t.turns !== snapshot
}
