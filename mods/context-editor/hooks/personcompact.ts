// [SP_CTX_02_42] [C_CTX_DEC_23] The person's /compact with the mod on: the
// agent compresses the conversation itself in an optimization turn instead of
// the host's summary. `/compact host` runs the host's summary; any other args
// (the person's own summary instructions) and every plugin's run (the mod's
// MARKER and HANDOFF_MARKER among them) go to the host unchanged. Automatic
// compaction raises no command and is not touched.
//
// The hook only writes the request into the queue (`optimize` with `compact`)
// and plans Flush: Flush applies what is queued first, then sends exactly one
// prompt, CompactTurnText ([SP_CTX_02_06]); DetectOptimize ends the turn and
// tells the person when it queued nothing ([SP_CTX_02_30]). Free of the host:
// register.ts binds PersonCompactIO to `$`.
import type { Queue } from './queue'
import { FLUSH_STALE_MS } from './flush'
import { errorText, modText } from './rows'
import type { Update } from './store'

// [SP_CTX_01_12] The args that ask for the host's summary (trimmed, any case).
export const HOST_ARG = 'host'
// [SP_CTX_01_12] The command's answers: the host shows them under the
// plugin's name, so no mod prefix (as /handoff's); the model reads them too,
// so they speak of the person and the agent in the third person.
export const COMPACT_REPLY = "the agent will compress the conversation itself; the person's messages stay verbatim. For the host's summary, run /compact host."
export const COMPACT_HANDOFF = "a handoff is pending; nothing was compressed. /compact host runs the host's summary."
export const COMPACT_BUSY = 'a compression turn is already planned or running'
export const COMPACT_REFUSED = "the compression turn could not be planned; nothing was compressed. /compact host runs the host's summary."

// [SP_CTX_02_42] Who answers a /compact: `pass` — the host, args unchanged
// (a plugin's run, or the person's own instructions); `host` — the host with
// empty args (the standard summary); `agent` — the mod (empty args from the
// person: any origin but a plugin's).
export type CompactRoute = 'pass' | 'host' | 'agent'

export function compactRoute(e: { args: string; origin: { kind: string } }): CompactRoute {
  if (e.origin.kind === 'plugin') return 'pass'
  const args = e.args.trim()
  if (args === '') return 'agent'
  return args.toLowerCase() === HOST_ARG ? 'host' : 'pass'
}

// [SP_CTX_02_42] COMPACT_HOOK_FAILED: the hook's `.catch`. The host replays
// `next` safely once it was called; a run the host raised beneath the mod's own
// $.command.run skips the hook (`re-entry`) and must go on; a plugin's run
// always goes on. Otherwise the person learns why, and no host summary runs.
export function compactFailure(e: { origin: { kind: string } }, caught: { called: boolean; kind: string }): { next: true } | { text: string } {
  if (caught.called || caught.kind === 're-entry' || e.origin.kind === 'plugin') return { next: true }
  return { text: `compact failed: ${caught.kind}; /compact host runs the host's summary` }
}

// What the person's /compact needs from the host; register.ts binds it to `$`.
export type PersonCompactIO = {
  // [CONC-01] the storage folder and the session id, read once at the event; undefined: none
  storage: () => Promise<{ dir: string; session: string } | undefined>
  // the queue's Update contract ([SP_CTX_01_07]) in `dir`, on its chain
  updateQueueAt: (dir: string) => Update<Queue>
  // [CONC-02] the host abandoned the hook (`next.signal`)
  aborted: () => boolean
  // Flush planned for `session` (requestFlush); a refused timer throws
  planFlush: (session: string) => void
  toast: (text: string) => void
  now: () => number
}

// The hook's answer: `next` — pass to the host with these args; `text` —
// answer in its place, no compaction runs.
export type CompactAnswer = { next: string } | { text: string }

// [SP_CTX_02_42] What the queue says about a new request.
type Verdict = 'written' | 'busy' | 'handoff' | 'aborted'

// [SP_CTX_02_42] The request in the queue: `optimize` with `compact`; an
// optimization request of the mark becomes this one (the whole conversation
// covers its block). Busy: a compression turn runs (`optimizePrompted`), or one
// is requested and Flush is planned (`planned`), or a compression turn ended and
// the Flush of its end has not run yet (`compactEndedAt`: the host held a
// /compact typed during that turn until its end, maybe before that end
// planned its Flush), while a Flush is planned or within FLUSH_STALE_MS of the
// end. A request whose Flush was lost is written again and planned anew.
export function requestCompact(q: Queue, planned: boolean, now: number): { next?: Queue; verdict: Exclude<Verdict, 'aborted'> } {
  if (q.handoff) return { verdict: 'handoff' }
  if (q.compact && (q.optimizePrompted || (q.optimize && planned))) return { verdict: 'busy' }
  if (q.compactEndedAt !== undefined && (planned || now - q.compactEndedAt <= FLUSH_STALE_MS)) return { verdict: 'busy' }
  const { compactEndedAt: _ended, ...rest } = q
  return { next: { ...rest, optimize: true, optimizePrompted: false, compact: true }, verdict: 'written' }
}

// [SP_CTX_02_42] ON command.run /compact. Nothing is awaited before a pass:
// the mod's own MARKER run goes on at once. `planned`: Flush planned now.
export async function personCompact(io: PersonCompactIO, e: { args: string; origin: { kind: string } }, planned: () => boolean): Promise<CompactAnswer> {
  const route = compactRoute(e)
  if (route === 'pass') return { next: e.args }
  if (route === 'host') return { next: '' }
  const st = await io.storage().catch(() => undefined)
  // COMPACT_NO_STORAGE: without the mod's storage the host's /compact runs as without the mod
  if (!st) return { next: e.args }
  let verdict: Verdict | undefined
  let before: Queue | undefined
  const written = await io
    .updateQueueAt(st.dir)(q => {
      // [CONC-02] the last abort check before the write
      if (io.aborted()) return (verdict = 'aborted'), undefined
      const out = requestCompact(q, planned(), io.now())
      verdict = out.verdict
      if (out.next) before = q
      return out.next
    })
    .catch(() => false)
  if (verdict === 'handoff') return { text: COMPACT_HANDOFF }
  if (verdict === 'busy') return { text: COMPACT_BUSY }
  // an abandoned hook leaves nothing; its answer is not shown
  if (verdict === 'aborted') return { text: COMPACT_REFUSED }
  // COMPACT_NO_STORAGE: an unreadable queue or a failed write
  if (!written || !before) return { next: e.args }
  const undo = async () => {
    const was = before!
    await io
      .updateQueueAt(st.dir)(q => ({ ...q, optimize: was.optimize, optimizePrompted: was.optimizePrompted, compact: was.compact, ...(was.compactEndedAt !== undefined ? { compactEndedAt: was.compactEndedAt } : {}) }))
      .catch(() => undefined)
  }
  if (io.aborted()) return await undo(), { text: COMPACT_REFUSED }
  try {
    io.planFlush(st.session)
  } catch (err) {
    // COMPACT_REFUSED: the host refused the timer; nothing stays planned or requested
    await undo()
    io.toast(modText(`/compact: ${errorText(err)}`))
    return { text: COMPACT_REFUSED }
  }
  return { text: COMPACT_REPLY }
}
