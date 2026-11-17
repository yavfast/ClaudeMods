// [SP_HELP_01_06] [SP_HELP_02_10] Deferred batches: the edits of a
// context_edit call with `defer: true` wait in the queue until an apply takes
// them without a cache rewrite of their own. Which edits an apply takes
// (SelectEdits over RewriteStart), how the edits it leaves are bound to the
// rows it returns (BindUnselected), and the counts the rest of the mod reads
// (NonDeferred, Applicable). Pure.
import type { SessionMessage } from 'claude-code'
import { cacheCost, withinLookback, type CacheShape } from './cache'
import { indexRows, locate, locateSpan, responseStart, touchedBy, type QueuedEdit, type RowIndex } from './edits'

// ---- [SP_HELP_01_09] constants
// the prefix of a deferred batch's id: b1, b2, …
export const BATCH_PREFIX = 'b'

// [SP_HELP_01_06] A deferred batch's id.
export function isBatchId(v: unknown): v is string {
  return typeof v === 'string' && new RegExp(`^${BATCH_PREFIX}[1-9][0-9]*$`).test(v)
}

// The fields of the queue these rules read.
export type Deferrable = { edits: readonly QueuedEdit[]; keepCache: boolean; applyDeferred?: boolean; coldSince?: number }

// [SP_HELP_02_10] NonDeferred: the edits of the queue without `deferred` (the
// agent's own, the returns, the tag replacements).
export function nonDeferred(edits: readonly QueuedEdit[]): QueuedEdit[] {
  return edits.filter(e => e.deferred === undefined)
}

// [SP_HELP_02_10] `applyDeferred` holds only while `coldSince` is absent or
// still the last request's time: a request since then made the cache warm.
export function deferredHolds(q: Pick<Deferrable, 'applyDeferred' | 'coldSince'>, lastRequestAt: number | null | undefined): boolean {
  return q.applyDeferred === true && (q.coldSince === undefined || q.coldSince === lastRequestAt)
}

// [SP_HELP_02_10] Applicable: every edit while `applyDeferred` holds, else NonDeferred.
export function applicable(q: Pick<Deferrable, 'edits' | 'applyDeferred' | 'coldSince'>, lastRequestAt: number | null | undefined): QueuedEdit[] {
  return deferredHolds(q, lastRequestAt) ? [...q.edits] : nonDeferred(q.edits)
}

// The batches of the queue, in queue order.
export function batchesOf(edits: readonly QueuedEdit[]): string[] {
  return [...new Set(edits.flatMap(e => (e.deferred === undefined ? [] : [e.deferred])))]
}

// The earliest row an edit changes; undefined when none is found.
export type FirstRow = (e: QueuedEdit) => number | undefined

// [SP_HELP_02_10] The earliest row of `touchedBy` (a host drop has none here:
// the handler passes its own FirstRow that finds the row before it).
export function firstRowOf(rows: readonly SessionMessage[], ix: RowIndex = indexRows(rows)): FirstRow {
  return e => {
    const t = touchedBy(rows, e, ix)
    return t && t.rows.length ? Math.min(...t.rows) : undefined
  }
}

// [SP_HELP_02_10] RewriteStart(S, rows, keep): where the next request after
// an apply of S starts writing the cache again. Without `keep_cache` the whole
// conversation (0). With it, the start of the response that holds the
// earliest row S changes (ResponseStart, as FrozenPrefix and CacheCost), or 0
// when more than CACHE_LOOKBACK positions lie from there to the end; no
// APPLY_MARGIN: the handler counts the rows it got. An empty S, or one that
// changes no row found, rewrites nothing: Infinity.
export function rewriteStart(set: readonly QueuedEdit[], keep: boolean, shape: CacheShape, firstOf: FirstRow): number {
  if (!set.length) return Infinity
  if (!keep) return 0
  const firsts = set.map(firstOf).filter((i): i is number => i !== undefined && i >= 0)
  if (!firsts.length) return Infinity
  const start = responseStart(shape.rows, Math.min(...firsts), shape.api, shape.responses)
  return withinLookback(shape, start) ? start : 0
}

// [SP_HELP_02_10] The batches of the queue that ride along with `own` (the
// edits without `deferred` that apply): those whose RewriteStart(B, keep) is
// not earlier than RewriteStart(own, keepCache); none without `own`.
export function ridersOf(q: Deferrable, own: readonly QueuedEdit[], shape: CacheShape, firstOf: FirstRow): string[] {
  if (!own.length) return []
  const from = rewriteStart(own, q.keepCache, shape, firstOf)
  return batchesOf(q.edits).filter(b => from <= rewriteStart(q.edits.filter(e => e.deferred === b), true, shape, firstOf))
}

// [SP_HELP_02_10] What an apply takes: the edits in queue order and the
// batches among them.
export type Selection = { edits: QueuedEdit[]; batches: string[] }

// [SP_HELP_02_10] SelectEdits: every queued edit while `applyDeferred` holds;
// else, with O = NonDeferred, nothing when O is empty, or O with each batch B
// whose RewriteStart(B, keep) is not earlier than RewriteStart(O, keepCache):
// B then adds no rewrite of its own. `shape` is built only when a batch is
// weighed.
export function selectEdits(q: Deferrable, lastRequestAt: number | null | undefined, shape: () => CacheShape, firstOf: FirstRow): Selection {
  if (deferredHolds(q, lastRequestAt)) return { edits: [...q.edits], batches: batchesOf(q.edits) }
  const own = nonDeferred(q.edits)
  if (!own.length) return { edits: [], batches: [] }
  if (!batchesOf(q.edits).length) return { edits: own, batches: [] }
  return riding(q, ridersOf(q, own, shape(), firstOf))
}

// The selection of the edits without `deferred` and the batches `riders`.
export function riding(q: Pick<Deferrable, 'edits'>, riders: readonly string[]): Selection {
  const picked = new Set(riders)
  return { edits: q.edits.filter(e => e.deferred === undefined || picked.has(e.deferred)), batches: [...riders] }
}

// [SP_HELP_02_10] The edits an apply did not select: the deferred edits of
// the batches it left, in queue order.
export function unselected(edits: readonly QueuedEdit[], selection: Selection): QueuedEdit[] {
  const taken = new Set(selection.batches)
  return edits.filter(e => e.deferred !== undefined && !taken.has(e.deferred))
}

// [SP_HELP_02_10] The deferredSince of the batches still queued.
export function sinceOf(since: Readonly<Record<string, number>> | undefined, edits: readonly QueuedEdit[]): Record<string, number> | undefined {
  if (!since) return undefined
  const left = new Set(batchesOf(edits))
  const out = Object.fromEntries(Object.entries(since).filter(([b]) => left.has(b)))
  return Object.keys(out).length ? out : undefined
}

// [SP_HELP_01_06] The queue once its deferred edits are gone: the transcript
// seed applied them, the document handoff's reset and ObservePassedCompact
// dropped them; with them go `deferredSince` and the batch's `applyDeferred`
// and `coldSince`. `nextBatch` stays: a batch number never repeats.
export function withoutDeferred<Q extends Deferrable & { deferredSince?: Record<string, number> }>(q: Q): Q {
  const { deferredSince: _since, applyDeferred: _apply, coldSince: _cold, ...rest } = q
  return { ...rest, edits: nonDeferred(q.edits) } as unknown as Q
}

// [SP_HELP_02_11] IdleRun's mark: the next apply takes every queued edit
// while the last request is still `coldSince`.
export function withApplyDeferred<Q extends Deferrable>(q: Q, coldSince: number): Q {
  return { ...q, applyDeferred: true, coldSince }
}

// [SP_HELP_02_07] The mark an `apply` errand set: `applyDeferred` without
// `coldSince`, so it holds for any last request (DeferredHolds).
export function errandMarked(q: Deferrable): boolean {
  return q.applyDeferred === true && q.coldSince === undefined
}

// [SP_HELP_02_07] [SP_HELP_02_11] [SP_HELP_02_12] IdleRun's and StartRun's
// mark, which leaves an errand's mark as it is; undefined: no change.
export function idleMarked<Q extends Deferrable>(q: Q, coldSince: number): Q | undefined {
  return errandMarked(q) ? undefined : withApplyDeferred(q, coldSince)
}

// [SP_HELP_02_07] [SP_HELP_02_11] An abandoned or refused own apply removes
// its own mark only: an errand's mark stays for the next apply.
export function withoutIdleMark<Q extends Deferrable>(q: Q): Q | undefined {
  return errandMarked(q) ? undefined : withoutApplyDeferred(q)
}

// [SP_HELP_02_10] [SP_HELP_02_11] The mark gone (a stale one, a refused or
// abandoned idle apply); undefined when there is none.
export function withoutApplyDeferred<Q extends Deferrable>(q: Q): Q | undefined {
  if (q.applyDeferred === undefined && q.coldSince === undefined) return undefined
  const { applyDeferred: _a, coldSince: _c, ...rest } = q
  return rest as Q
}

// [SP_CTX_02_02] [SP_HELP_02_10] The status line of a queue: the edits the
// next apply takes, and the deferred ones apart; undefined when it is empty.
export function queueStatus(edits: readonly QueuedEdit[]): string | undefined {
  const deferred = edits.length - nonDeferred(edits).length
  const own = edits.length - deferred
  if (own && deferred) return `${own} context edit(s) queued, ${deferred} deferred`
  if (own) return `${own} context edit(s) queued`
  if (deferred) return `${deferred} deferred context edit(s)`
  return undefined
}

// [SP_HELP_02_13] What the Deferred line shows of the queue: its batches,
// their edits and the turn of the oldest (absent: no deferredSince for any);
// undefined when no deferred edit waits.
export type DeferredView = { batches: number; edits: number; oldest?: number }

export function deferredView(q: Pick<Deferrable, 'edits'> & { deferredSince?: Readonly<Record<string, number>> }): DeferredView | undefined {
  const edits = q.edits.filter(e => e.deferred !== undefined)
  if (!edits.length) return undefined
  const ids = batchesOf(edits)
  const turns = ids.flatMap(id => (q.deferredSince?.[id] !== undefined ? [q.deferredSince[id]!] : []))
  return { batches: ids.length, edits: edits.length, ...(turns.length ? { oldest: Math.min(...turns) } : {}) }
}

// [SP_HELP_02_13] The cache the deferred edits alone would rewrite, were they
// applied now with keep_cache: CacheCost ([SP_CTX_02_38]) from the earliest
// row they change, nothing subtracted for what they free (an upper estimate);
// undefined when none of their rows is found.
export function deferredRewrite(edits: readonly QueuedEdit[], shape: CacheShape, firstOf: FirstRow, whole: number, ratio: number): number | undefined {
  const firsts = edits.filter(e => e.deferred !== undefined).map(firstOf).filter((i): i is number => i !== undefined && i >= 0)
  if (!firsts.length) return undefined
  return cacheCost(shape, Math.min(...firsts), 0, whole, ratio).rewrite
}

// [SP_HELP_02_10] BindUnselected at the commit point: a deferred edit by row
// anchors (collapse, rewrite, describe, a stamped state) follows its rows to
// the rows the apply returns, by identity first (a row that came back as it
// was), Locate / LocateSpan by its anchors second; one whose row the applied
// edits changed, or that is no longer found, leaves the queue (`dropped`).
// Edits by id (summarize, drop) need no binding.
export type Bound = { edits: QueuedEdit[]; dropped: QueuedEdit[] }

export function bindUnselected(rest: readonly QueuedEdit[], before: readonly SessionMessage[], after: readonly SessionMessage[], applied: readonly QueuedEdit[]): Bound {
  if (!rest.length) return { edits: [], dropped: [] }
  const was = indexRows(before)
  const now = indexRows(after)
  const edited = new Set<number>()
  for (const e of applied) for (const i of touchedBy(before, e, was)?.rows ?? []) edited.add(i)
  const same = new Map<SessionMessage, number>()
  after.forEach((r, i) => same.set(r, i))
  // the row of `anchor` in `after`: the same object first, then Locate
  const moved = (at: number, anchor: string, hint: number): number => {
    const k = at >= 0 ? same.get(before[at]!) : undefined
    return k !== undefined ? k : locate(after, anchor, hint, now)
  }
  const out: QueuedEdit[] = []
  const dropped: QueuedEdit[] = []
  for (const e of rest) {
    const b = bindOne(e, before, was, after, now, edited, moved)
    if (b) out.push(b)
    else dropped.push(e)
  }
  return { edits: out, dropped }
}

function bindOne(
  e: QueuedEdit,
  before: readonly SessionMessage[],
  was: RowIndex,
  after: readonly SessionMessage[],
  now: RowIndex,
  edited: ReadonlySet<number>,
  moved: (at: number, anchor: string, hint: number) => number,
): QueuedEdit | undefined {
  switch (e.op) {
    case 'summarize':
    case 'drop':
      return e
    case 'collapse': {
      const [a, z, ...keeps] = e.anchors ?? []
      if (a === undefined || z === undefined) return e
      const span = locateSpan(before, { anchor: a, hint: e.from_index }, { anchor: z, hint: e.to_index }, was)
      // not found before this apply: the apply that selects it says "Not applied"
      if (!span) return e
      for (let i = span.from; i <= span.to; i++) if (edited.has(i)) return undefined
      const y = moved(span.to, z, e.to_index)
      if (y < 0) return undefined
      const x = moved(span.from, a, y - (span.to - span.from))
      const to = locateSpan(after, { anchor: a, hint: x < 0 ? y - (span.to - span.from) : x }, { anchor: z, hint: y }, now)
      if (!to) return undefined
      const keep: number[] = []
      for (const [k, anchor] of keeps.entries()) {
        const old = e.keep?.[k]
        const at = old === undefined ? -1 : locate(before, anchor, old, was)
        const n = at < 0 ? -1 : moved(at, anchor, old!)
        if (n < to.from || n > to.to) return undefined
        keep.push(n)
      }
      return { ...e, from_index: to.from, to_index: to.to, ...(e.keep ? { keep } : {}) }
    }
    case 'rewrite':
    case 'describe':
    case 'state': {
      const anchor = e.anchors?.[0]
      if (e.index === undefined || anchor === undefined) return e
      const at = locate(before, anchor, e.index, was)
      if (at < 0) return e
      if (edited.has(at)) return undefined
      const n = moved(at, anchor, e.index)
      return n < 0 ? undefined : { ...e, index: n }
    }
  }
}
