import type { SessionMessage } from 'claude-code'
import { pruneAliases, type AliasRegistry } from './aliases'
import {
  applyEdits,
  applyLine,
  boundaryOf,
  collectMedia,
  describeEdit,
  editLabel,
  isReturnEdit,
  indexRows,
  isHostDrop,
  dropOwnCallsCounted,
  formatReport,
  mediaExt,
  ownerKey,
  ownPairs,
  PINNED,
  producedRows,
  replacedOwners,
  STATE_SLOT,
  stampState,
  touchesPin,
  NO_PINS,
  type Pinned,
  touchesState,
  type ApplyReport,
  type Boundary,
  type MediaRef,
  type QueuedEdit,
} from './edits'
import { insertDeliveries, type Deliveries } from './deliveries'
import { assignFoldIds, FOLDS_UNSAVED, pruneRecalls, recordFolds, type FoldLedger, type FoldPort } from './folds'
import { frozenAttachments, type AttachPort } from './hostattach'
import { goneText, handlesOf, rebaseHostRows, type HostRows } from './hostrows'
import { applyEntry, type JournalEntry } from './journal'
import { bindUnselected, deferredHolds, firstRowOf, nonDeferred, ridersOf, riding, selectEdits, sinceOf, unselected, type Selection } from './batches'
import { cacheShape, type CacheShape } from './cache'
import { lastRequest } from './cacheclock'
import { appendReport, keepOtherSteps, markerKind, MAX_QUEUE_BYTES, resumesAfter, screenPerson, withCommandNote, type Queue } from './queue'
import { dropPulled, type Pulled } from './repair'
import { apiChars, errorText, modText, resultsOf, totalChars } from './rows'
import type { ChangeFn, Held, Read, Update } from './store'
import { rebindAfter } from './notes'
import { ITEMS_UNSAVED } from './state'
import { dropLastApply, pinnedTargets, pruneDeadTags, stateInput, withTitle, type TagRegistry } from './tags'
import { keepRuns } from './title'

// [SP_CTX_01_06] The file extension of a media file (its home: edits.ts).
export { mediaExt } from './edits'

// [SP_CTX_01_06] A base64 string this long under `base64` or `data` is media data.
export const MEDIA_DATA = 256
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// [SP_CTX_01_12] The args of the built-in /compact the mod runs: the handler
// sees them as `instructions`, and the model reads them in the command's rows,
// so they explain themselves and say who ran the command ([SP_CTX_DEC_26]).
export { HANDOFF_MARKER, MARKER } from './queue'

// the marks of now or before phase 25 (markerKind)
function isOwnInstruction(instructions: string | undefined): boolean {
  return markerKind(instructions) !== undefined
}

type CompactionEvent = { agentId?: string; trigger: string; instructions?: string; messages?: readonly SessionMessage[] }

// [SP_CTX_02_07] Which branch of the handler a compaction takes. A match is
// by `instructions` and no `agentId`, under any trigger but `precompute`: the
// mod's command arrives as `manual`, as does the person's `/compact MARKER`.
// The marks before phase 25 match too: a command queued before a reload.
// [SP_CTX_02_47] `repair`: the repair after a resume (phase 32).
export type CompactionRoute = 'apply' | 'seed' | 'repair' | 'pass'

export function compactionRoute(e: CompactionEvent): CompactionRoute {
  if (e.agentId || e.trigger === 'precompute') return 'pass'
  return markerKind(e.instructions) ?? 'pass'
}

// [SP_CTX_02_07] ON handler failure: never a real, summarizing compaction for
// the mod's instructions. The seed branch answers at once and leaves the
// queue alone (RunHandoff sees the seed was not taken); the apply branch
// answers at once too and records the failure in the queue in the background.
export function compactionFailure(e: CompactionEvent): { pass: true } | { skip: string; recordFailure: boolean } {
  switch (compactionRoute(e)) {
    case 'pass':
      return { pass: true }
    case 'seed':
      return { skip: modText('seeding failed'), recordFailure: false }
    // [SP_CTX_02_47] a repair writes nothing on its failure
    case 'repair':
      return { skip: modText('repair failed'), recordFailure: false }
    case 'apply':
      return { skip: modText('applying the edits failed'), recordFailure: true }
  }
}

// [SP_CTX_02_07] What the handler's failure branch needs; register.ts binds it.
export type FailureIO = {
  // the folder of the apply that ran, else the current session's; undefined: none
  dir: string | undefined
  // the id of the last report an apply of this instance wrote and answered without an abandon
  reported: number | undefined
  // [SP_HELP_02_10] selectedBatches: the batches the last apply selected;
  // undefined: no selection yet in that apply
  selected?: readonly string[]
  now: () => number
  // the queue's Change port in `dir`, never awaited
  changeQueue: (dir: string, change: ChangeFn<Queue>) => Promise<unknown>
}

// [SP_CTX_02_07] ON handler failure (the hook's `.catch`): a compaction not
// the mod's goes on (`pass`); for the mod's instructions the answer is a skip
// at once, never a real, summarizing compaction, and a failed apply is
// recorded in the queue in the background. `reason`: the kind of the failure.
export function compactionFailed(io: FailureIO, e: CompactionEvent, reason: string): { pass: true } | { skip: string } {
  const out = compactionFailure(e)
  if ('pass' in out) return out
  // [SP_CTX_02_07] nothing when the apply reached its commit point first and was not abandoned
  if (out.recordFailure && io.dir) void io.changeQueue(io.dir, read => failureRecord(read, io.reported, reason, io.now(), io.selected)).catch(() => undefined)
  return { skip: out.skip }
}

// What HandleCompaction needs from the host; register.ts binds it to `$`.
export type CompactionIO = {
  dir: string
  // [SP_CTX_01_07] ArchiveRoot: where the originals and media go (`dir` when
  // the project has no archive folder)
  archives: string
  // [SP_CTX_01_28] the session's project root (SourceOf); none: absolute paths
  cwd?: string
  now: () => number
  readQueue: () => Promise<Read<Queue>>
  writeQueue: (q: Queue) => Promise<void>
  readApi: () => Promise<readonly unknown[]>
  writeMedia: (path: string, base64: string) => Promise<boolean>
  writeArchive: (path: string, text: string) => Promise<boolean>
  // true once the host abandoned the dispatch (interrupt, budget)
  isAborted: () => boolean
  toast: (text: string) => void
  readTags: () => Promise<Read<TagRegistry>>
  writeTags: (reg: TagRegistry) => Promise<void>
  readAliases: () => Promise<Read<AliasRegistry>>
  writeAliases: (reg: AliasRegistry) => Promise<void>
  // [SP_CTX_02_07] [SP_CTX_02_14] runs the commit holding the registry's
  // serial chain, then the alias registry's (inside the queue's, which the
  // whole handler holds), and passes the chains held; absent: runs it as it is
  onRegistries?: <T>(work: (held?: Held) => Promise<T>) => Promise<T>
  // [SP_CTX_02_07] the report of this apply is in the queue and the dispatch
  // was not abandoned when it was written: its id, and [SP_CTX_02_43] the
  // person's line (ApplyLine) when an edit applied. The caller counts them
  // only once the handler returned without an abandon.
  reported?: (reportId: number, line?: string) => void
  // [SP_CTX_02_18] best effort, never awaited: a failed write leaves the previous boundary
  writeBoundary: (b: Boundary) => Promise<void>
  // [SP_CTX_01_14] hostId if its read has ended, else absent: a compaction
  // handler never waits for it nor starts a process
  hostId: () => string | undefined
  // [SP_CTX_02_07] the size of the request before the apply: the plain usage
  // (1–3 ms, no breakdown); undefined when unknown
  requestTokens?: () => Promise<number | undefined>
  // [SP_CTX_02_31] JournalApply in the background, on the journal's chain:
  // never awaited, its failure changes nothing
  journal?: (entry: JournalEntry) => void
  // [SP_CTX_01_22] the host's deliveries recorded in this session, read on
  // their serial chain; absent: none
  readDeliveries?: () => Promise<Read<Deliveries>>
  // [SP_CTX_02_07] in the background, on the deliveries' chain: the items
  // this apply no longer needs go; never awaited
  pruneDeliveries?: (done: ReadonlySet<string>) => void
  // [SP_CTX_02_40] the decisions on the host's attachments: the files read
  // before the commit, the state file written inside it, the catalog started
  // over once the compaction stands; absent: attachments untouched
  attachments?: AttachPort
  // [SP_CTX_02_45] the ledger of the applies' inputs and whether the session
  // had an apply, read without a chain (unreadable: empty); absent: none
  readPulled?: () => Promise<Pulled>
  // [SP_CTX_02_46] this module instance already compacted the session (an
  // apply, a seed or a repair): the read is originals + copies, no DropPulled
  compactedHere?: () => boolean
  // [SP_CTX_02_44] RecordInputs in the background, on the ledger's chain:
  // never awaited, its failure changes nothing
  recordInputs?: (messages: readonly SessionMessage[], id: number) => void
  // [SP_CTX_02_61] the host rows' records, read for this apply (unreadable:
  // none); absent: none
  readHostRows?: () => Promise<Read<HostRows>>
  // [SP_CTX_02_60] after the commit point, in the background on the host
  // rows' chain, reading the file anew: the records whose row before came
  // back with its handle stay, by its position among the returned rows
  // (KeepHostRows over the handles of the input and of the rows returned);
  // never awaited
  keepHostRows?: (input: readonly SessionMessage[], out: readonly (string | undefined)[]) => void
  // [SP_FOLD_02_01] the fold ledger: read before the rows are built, written
  // at the commit point with the registries; absent: no fold gets an id
  folds?: FoldPort
  // [ERR-01] the trace of a failure the apply swallows: a label and the error
  debug?: (text: string) => void
  // [SP_HELP_02_09] the cache clock's memory of this module instance for the
  // session (memoryAt); absent: the registry's time alone
  clockMemory?: () => number | undefined
  // [SP_HELP_02_10] selectedBatches, set by SelectEdits (the caller clears it
  // when the handler starts)
  selected?: (batches: string[]) => void
}

export type CompactionOutcome = { skip: string } | { messages: SessionMessage[] }

// [SP_CTX_02_07] SKIP_ABANDONED: the host went on without the handler.
const ABANDONED: CompactionOutcome = { skip: modText('compaction abandoned; the batch stays queued') }

// [SP_CTX_02_07] Applies the queued batch to the compaction's rows. The
// caller runs it on the queue's serial chain.
export async function handleCompaction(io: CompactionIO, input: readonly SessionMessage[]): Promise<CompactionOutcome> {
  const read = await io.readQueue()
  if (read.state === 'unreadable') return { skip: modText('queue unreadable') }
  const q = read.value
  if (!q.edits.length) return { skip: modText('no queued edits') }

  if (q.handoff) return { skip: modText('handoff pending') }

  // [SP_CTX_02_45] in a loaded chain (the repair refused or not yet run) the
  // originals a resume put back beside their copies go first, so the apply
  // never returns them again; in the process that applied, nothing goes
  const pulled = io.readPulled && !io.compactedHere?.() ? await io.readPulled().catch(() => undefined) : undefined
  const pulledOut = pulled ? dropPulled(input, pulled.ledger, pulled.applied) : undefined
  const messages: readonly SessionMessage[] = pulledOut?.kept ?? input

  const tokensBefore = await (io.requestTokens?.() ?? Promise.resolve(undefined)).catch(() => undefined)
  const tagsRead = await io.readTags()
  const api = await io.readApi()
  // [SP_CTX_02_61] the host rows' records a host drop names
  const hostRead = io.readHostRows ? await io.readHostRows().catch((err): Read<HostRows> => ({ state: 'unreadable', reason: String(err) })) : undefined
  // [SP_CTX_01_31] a record kept by an earlier apply names its row by position
  const hostRows = hostRead && hostRead.state !== 'unreadable' ? rebaseHostRows(hostRead.value.rows, messages) : []
  // [SP_HELP_02_10] SelectEdits before anything is built: the deferred
  // batches that add no rewrite of their own ride along; an empty selection
  // skips, and a stale applyDeferred goes
  const last = lastRequest(tagsRead.state === 'unreadable' ? undefined : tagsRead.value.cache, io.clockMemory?.())
  const touched = firstRowOf(messages, indexRows(messages))
  const firstOf = (e: QueuedEdit): number | undefined => {
    if (!isHostDrop(e)) return touched(e)
    const rec = hostRows.find(r => r.id === e.host)
    const at = rec ? messages.findIndex(m => m.handle === rec.after) : -1
    return at < 0 ? undefined : at
  }
  let shape: CacheShape | undefined
  const shapeOf = () => (shape ??= cacheShape(messages, api))
  let selection = selectEdits(q, last, shapeOf, firstOf)
  io.selected?.(selection.batches)
  if (!selection.edits.length) {
    if (q.applyDeferred && !deferredHolds(q, last) && !io.isAborted()) {
      const { applyDeferred: _a, coldSince: _c, ...rest } = q
      // [ERR-01] a failed write only leaves the stale flag for the next apply
      await io.writeQueue(rest).catch(err => io.debug?.(modText(`stale applyDeferred not cleared: ${errorText(err)}`)))
    }
    return { skip: modText('no applicable edits') }
  }
  // [SP_CTX_02_58] ScreenPerson beside ScreenPinned, on these rows and the
  // deliveries file; refused edits go first in report.failed
  const delivered = await readDeliveries(io)
  const screen = (set: readonly QueuedEdit[]) => {
    const pins = screenPinned(messages, [...set], tagsRead)
    const person = screenPerson(messages, pins.edits, delivered.items, pins.pinned)
    return { pins, person }
  }
  let screened = screen(selection.edits)
  // [SP_HELP_02_10] a batch rides along only with the edits without
  // `deferred` that pass the screens: weighed again over them, none left, no batch
  if (selection.batches.length && !deferredHolds(q, last)) {
    const own = screened.person.edits.filter(e => e.deferred === undefined)
    const riders = ridersOf(q, own, shapeOf(), firstOf)
    if (riders.length !== selection.batches.length) {
      selection = riding(q, riders)
      io.selected?.(selection.batches)
      screened = screen(selection.edits)
    }
  }
  const { pins, person } = screened
  const edits = person.edits
  const refused = [...pins.refused, ...person.refused]
  // [SP_CTX_02_34] the calibration the registry holds: the handler never asks for telemetry
  const ratio = tagsRead.state === 'unreadable' ? undefined : tagsRead.value.charsPerToken
  const { found, knownResults, unmatchedPromptMedia, apiTruncated, toolRefs } = collectMedia(api, messages)
  // [SP_CTX_02_43] the person's line sizes the conversation by the API form
  // read here (phase 29); none when it may be cut at its window
  const apiSize = api.length > 0 && !apiTruncated ? apiChars(api) : undefined
  const mediaOwners = new Set(found.keys())
  const id = io.now()
  const media = await archiveMedia(found, replacedOwners(messages, edits, pins.pinned), `${io.archives}/${id}`, io.writeMedia)

  // [SP_CTX_02_04] [SP_CTX_DEC_22] FrozenPrefix, only when the batch asked for
  // it ("keep_cache"): the rows before the response of the first change come
  // back as they came, so the prompt cache holds up to it; by default the
  // stretch is rebuilt as before, and --resume stays clean
  // [SP_CTX_02_67] run state starts from the items of the registry read here
  const state = tagsRead.state === 'unreadable' ? undefined : stateInput(tagsRead.value)
  const options = {
    knownResults,
    unmatchedPromptMedia,
    apiTruncated,
    toolRefs,
    hostRows,
    // [SP_CTX_02_73] the mod's renames whose rows the apply drops
    ...(tagsRead.state !== 'unreadable' && tagsRead.value.title?.runs?.length ? { renames: tagsRead.value.title.runs } : {}),
    ...(io.cwd ? { cwd: io.cwd } : {}),
    ...(q.keepCache ? { freeze: { api } } : {}),
    ...(state ? { state } : {}),
    // [SP_FOLD_02_04] FoldSpan is checked again on the rows of the apply
    pinned: pins.pinned,
  }
  const archive = `${io.archives}/${id}.json`
  // [SP_FOLD_02_01] AssignFoldIds before the replacement rows are built: the
  // record's text carries the id. An unreadable ledger numbers from the
  // conversation's own records (the lower bound).
  const foldsRead = io.folds ? await io.folds.read() : undefined
  const numbered = foldsRead ? assignFoldIds(edits, messages, foldsRead.state === 'unreadable' ? undefined : foldsRead.value) : undefined
  // [SP_FOLD_02_03] [SP_FOLD_02_09] the recalls not yet returned: the trace
  // of a return edit names their fold and scope, and their pairs stay
  const recalls = foldsRead && foldsRead.state !== 'unreadable' ? foldsRead.value.recalls : []
  // [SP_HELP_02_05] the questions not yet returned, likewise
  const questions = foldsRead && foldsRead.state !== 'unreadable' ? foldsRead.value.questions : []
  const keepRecalls = new Set([...recalls, ...questions].map(r => r.tool_use_id))
  const applied = applyEdits(messages, edits, archive, media, mediaOwners, {
    ...options,
    ...(numbered ? { foldIds: numbered.ids } : {}),
    ...(recalls.length ? { recalls: new Map(recalls.map(r => [r.tool_use_id, { fold: r.fold, scope: r.scope }])) } : {}),
    ...(questions.length
      ? { questions: new Map(questions.map(q => [q.tool_use_id, { folds: q.folds, question: q.question, verified: q.verified, scope: q.scope }])) }
      : {}),
  })
  const frozen = new Set(messages.slice(0, applied.prefix))
  applied.report.failed.unshift(...refused)
  // [SP_CTX_01_05] PULLED_TEXT in the report
  if (pulledOut?.dropped.length) applied.report.pulledDropped = pulledOut.dropped.length
  // [C_CTX_01_01] Originals never vanish: without their archive nothing applies.
  if (applied.report.originals.length && !(await io.writeArchive(archive, archiveText(applied.report.originals, media)))) {
    if (io.isAborted()) return ABANDONED
    const waiting = unselected(q.edits, selection)
    const text = formatReport(
      {
        ...applied.report,
        applied: [],
        failed: [...refused, ...edits.map(e => `${editLabel(messages, e)}: originals could not be archived`)],
        charsAfter: applied.report.charsBefore,
        produced: [],
        mediaFiles: [],
        // [SP_HELP_02_10] none applied; the batches it did not select still wait
        ...(q.edits.some(e => e.deferred !== undefined) ? { deferred: { applied: 0, batches: 0, wait: waiting.length } } : {}),
      },
      '',
      'compaction',
    )
    // [SP_HELP_02_10] as the failure branch: the selected batches go, the others stay
    await io.writeQueue(reported(q, text, id, selection, waiting))
    io.reported?.(id)
    io.toast(text.slice(0, 200))
    return { skip: modText('originals could not be archived') }
  }
  const archived = archive
  // [SP_CTX_02_05] the count goes into the report's P13 sentence ([SP_CTX_01_05])
  // [SP_CTX_02_36] the host's deliveries behind rebuilt rows go back as rows,
  // before DropOwnCalls: one behind an own call's result keeps its place
  // a row of own results kept by its handle (outside the API window) is
  // removed by DropOwnCalls below: the host would not carry its attachments
  // [SP_FOLD_02_09] the result row of a recall pair that stays does not go
  const own = ownPairs(messages, keepRecalls)
  // (a frozen row stays, own calls and all: it carries its attachments itself)
  const goes = (r: SessionMessage) => !frozen.has(r) && resultsOf(r).length > 0 && resultsOf(r).every(t => own.has(t.tool_use_id))
  const put = insertDeliveries(messages, applied.rows, delivered.items, applied.renamed, false, goes)
  applied.report.deliveries = { ...put.counts, ...(delivered.unreadable !== undefined ? { unreadable: delivered.unreadable } : {}) }
  const { rows, removed } = dropOwnCallsCounted(put.rows, mediaOwners, knownResults, frozen, keepRecalls)
  applied.report.ownCallsRemoved = removed
  // [SP_CTX_01_05] a delivery was no row before: it frees nothing and takes nothing
  applied.report.charsAfter = totalChars(rows) - put.added
  // [SP_CTX_01_05] where the made rows stand in the list returned
  applied.report.produced = producedRows(rows, applied.made)
  // [SP_CTX_02_61] the records no drop named whose row before came back
  // without its handle or not at all: the host leaves their rows out
  const kept = handlesOf(rows)
  const gone = goneText(hostRows.filter(r => !kept.has(r.after) && !applied.hostNamed.has(r.id)))
  if (gone) applied.report.hostLines = [...(applied.report.hostLines ?? []), gone]

  // An abandoned dispatch changes nothing: the batch stays queued for the
  // next turn, and the files written so far are only orphans in the archive.
  if (io.isAborted()) return ABANDONED

  // [SP_CTX_02_14] Best effort: a stale tag only names a target that is gone.
  // With nothing applied the conversation stays as it was. The stage marks
  // move with the rows, never vanish.
  const names = new Set(applied.report.applied)
  // [SP_FOLD_02_04] an applied collapse names the rows it left in place, so
  // the tags, notes, aliases and the journal read them as untouched
  const done = edits.filter(e => names.has(describeEdit(e))).map(e => (applied.kept.has(e) ? { ...e, kept: applied.kept.get(e)! } : e))
  const after = done.length ? rows : messages
  // [SP_HELP_02_10] BindUnselected: the deferred edits this apply did not
  // select follow their rows into `after`; one whose rows it changed leaves
  // the queue with a line of the report
  const bound = bindUnselected(unselected(q.edits, selection), messages, after, done)
  for (const e of bound.dropped) applied.report.failed.push(`${editLabel(messages, e)}: its rows changed in this apply`)
  const deferredDone = done.filter(e => e.deferred !== undefined)
  if (q.edits.some(e => e.deferred !== undefined))
    applied.report.deferred = { applied: deferredDone.length, batches: new Set(deferredDone.map(e => e.deferred)).size, wait: bound.edits.length }
  const produced = applied.report.produced
  // [SP_CTX_02_40] the files the attachments' sections name, read before the
  // commit; only an apply that changes the conversation decides (the host
  // asks every attachment again after it). With keep_cache the frozen prefix
  // keeps the attachments it holds as they are sent.
  const attach = done.length ? io.attachments : undefined
  const disk = attach ? await attach.disk().catch(() => undefined) : undefined
  const frozenAttach = disk && q.keepCache ? frozenAttachments(messages, api, applied.prefix) : undefined
  // [SP_CTX_02_31] [SP_CTX_02_18] what the steps after the commit need, made
  // before it: nothing after the queue's write can throw
  const entry = applyEntry(id, applied.report, archived, messages, edits, deferredDone.length)
  const boundary = boundaryOf(rows, io.hostId())
  // [SP_CTX_02_67] the items run state made, written with the registry
  const items = applied.state
  const rebind = (reg: TagRegistry) => {
    const out = rebindAfter(reg, messages, after, done, selection.edits, produced)
    const withItems = items ? { ...out.registry, items: items.items, nextItem: items.nextItem } : out.registry
    // [SP_CTX_02_73] a rename's record stays while its row came back with its handle
    const titled = withTitle(withItems, keepRuns(withItems.title, after))
    // [SP_CTX_02_28] the telemetry measures what this apply freed
    return { registry: done.length && tokensBefore !== undefined ? { ...titled, lastApply: { at: id, tokensBefore } } : titled, dropped: out.dropped }
  }
  // [SP_CTX_02_07] Commit: the waits for the registries' chains are over, so
  // every change is made from the registries as they are now, and nothing is
  // written once the host abandoned the dispatch. The registries go first,
  // the queue last: its write is the commit point. If it fails, or the
  // dispatch was abandoned before it, the registries are put back as read.
  const onRegistries = io.onRegistries ?? (<T>(work: (held?: Held) => Promise<T>) => work())
  const text = await onRegistries(async (held?: Held): Promise<string | undefined> => {
    const tagsNow = await io.readTags().catch((err): Read<TagRegistry> => ({ state: 'unreadable', reason: String(err) }))
    const aliasesNow = await io.readAliases().catch((err): Read<AliasRegistry> => ({ state: 'unreadable', reason: String(err) }))
    const tags = tagsNow.state === 'unreadable' ? undefined : { before: tagsNow.value, ...rebind(tagsNow.value) }
    // An alias of a changed or vanished pair has done its job: it no longer resolves.
    const pruned = aliasesNow.state === 'unreadable' ? undefined : pruneAliases(aliasesNow.value, messages, after, done)
    const aliases = aliasesNow.state !== 'unreadable' && pruned !== undefined && pruned !== aliasesNow.value ? { before: aliasesNow.value, next: pruned } : undefined
    if (io.isAborted()) return undefined
    // [SP_CTX_02_14] RelocateNote: notes on removed rows go and the report
    // names them, only once the registry is written
    let tagsError = tagsNow.state === 'unreadable' ? tagsNow.reason : ''
    const tagsWritten = tags
      ? await io.writeTags(tags.registry).then(
          () => true,
          (err: unknown) => ((tagsError = String(err)), false),
        )
      : false
    if (tags && tagsWritten) applied.report.notesDropped = tags.dropped
    const aliasesWritten = aliases && !io.isAborted() ? await io.writeAliases(aliases.next).then(() => true, () => false) : false
    // [SP_CTX_02_40] the attachments' decisions; a failure leaves the ones in force
    const attached = attach && disk && !io.isAborted() ? await attach.commit(disk, frozenAttach, ratio, held).catch(() => undefined) : undefined
    // [SP_FOLD_02_01] RecordFolds on the ledger as it is now; FOLDS_UNSAVED
    // never stops the apply: the records carry FOLD_NOTE and their paths
    // [SP_FOLD_02_03] in the same write the recalls whose pairs this apply
    // returned, covered or removed go: those not in the rows returned
    let foldsBefore: FoldLedger | undefined
    let foldsUnsaved = ''
    const folding = !!numbered && applied.folded.length > 0
    if (io.folds && (folding || (keepRecalls.size > 0 && done.length > 0)) && !io.isAborted()) {
      const turn = tagsNow.state === 'unreadable' ? 0 : tagsNow.value.turn
      let unchanged = false
      try {
        foldsBefore = await io.folds.record(ledger => {
          const recorded = folding ? recordFolds(ledger, applied.folded, applied.report.originals, numbered.next, archived, turn, MAX_QUEUE_BYTES) : ledger
          const next = done.length ? pruneRecalls(recorded, after) : recorded
          unchanged = next === ledger
          return next
        }, held)
        if (!foldsBefore && !unchanged) throw new Error('the unreadable ledger could not be moved aside')
      } catch (err) {
        if (folding) foldsUnsaved = FOLDS_UNSAVED
        io.debug?.(modText(`RecordFolds failed: ${errorText(err)}`))
      }
    }
    const putBack = async () => {
      if (tags && tagsWritten) await io.writeTags(tags.before).catch(() => undefined)
      if (aliases && aliasesWritten) await io.writeAliases(aliases.before).catch(() => undefined)
      if (attach && attached?.written) await attach.putBack(attached).catch(() => undefined)
      if (io.folds && foldsBefore) await io.folds.putBack(foldsBefore, held).catch(err => io.debug?.(modText(`fold ledger put back failed: ${errorText(err)}`)))
    }
    if (io.isAborted()) {
      await putBack()
      return undefined
    }
    // [SP_CTX_01_05] without an applied edit: "not changed", no size line
    // [SP_CTX_01_05] [SP_CTX_02_40] the attachments newly left out, after the rest
    // [SP_CTX_02_67] ITEMS_UNSAVED: the slot shows items the registry lacks
    const unsaved = items && !tagsWritten ? ITEMS_UNSAVED(tagsError || 'not written') : ''
    const report = [formatReport(applied.report, archived, 'compaction', ratio), attached?.text ?? '', unsaved, foldsUnsaved].filter(Boolean).join(' ')
    try {
      await io.writeQueue(reported(q, report, id, selection, bound.edits))
    } catch (err) {
      await putBack()
      throw err
    }
    // abandoned during the queue's write: the batch goes back as read
    if (io.isAborted()) {
      await io.writeQueue(q).catch(() => undefined)
      await putBack()
      return undefined
    }
    // [SP_CTX_02_43] the person's line goes out after the command (Flush), not from here
    const line = applyLine(applied.report, ratio, apiSize)
    io.reported?.(id, line || undefined)
    return report
  })
  if (text === undefined) return ABANDONED
  // After the commit point nothing throws and nothing is awaited: the
  // handler answers right away.
  io.toast(text.slice(0, 200))
  if (applied.report.applied.length === 0) return { skip: modText('no edit could be applied') }
  // [SP_CTX_02_18] RecordBoundary in the background: with `host` only when hostId is already read
  if (boundary) {
    try {
      void io.writeBoundary(boundary).catch(() => undefined)
    } catch {
      // a failed write leaves the previous boundary
    }
  }
  // [SP_CTX_02_07] the deliveries this apply put back, or that went with their anchor
  if (put.done.size && io.pruneDeliveries && !io.isAborted())
    try {
      io.pruneDeliveries(put.done)
    } catch {
      // a later apply skips a delivery that is already a row
    }
  // [SP_CTX_02_60] the records whose row before came back with its handle stay
  if (io.keepHostRows && hostRows.length && !io.isAborted())
    try {
      io.keepHostRows(
        messages,
        rows.map(r => r.handle),
      )
    } catch {
      // a record whose row went only names a host row that is no longer there
    }
  // [SP_CTX_02_31] what this application compressed; never delays the answer
  if (entry && io.journal && !io.isAborted())
    try {
      io.journal(entry)
    } catch {
      // the journal is no part of the application
    }
  // [SP_CTX_02_44] RecordInputs: the input rows a later resume may put back
  if (io.recordInputs && !io.isAborted())
    try {
      io.recordInputs(messages, id)
    } catch {
      // only the residual rule then recognizes this apply's originals
    }
  // [SP_CTX_02_40] the compaction stands: the host asks every attachment again
  if (attach)
    try {
      attach.passed()
    } catch {
      // the catalog only lags
    }
  return { messages: rows }
}

// [SP_CTX_01_22] The recorded deliveries for an apply; an unreadable file
// gives none and its reason for the report.
async function readDeliveries(io: Pick<CompactionIO, 'readDeliveries'>): Promise<{ items: Deliveries['items']; unreadable?: string }> {
  if (!io.readDeliveries) return { items: [] }
  const read = await io.readDeliveries().catch((err): Read<Deliveries> => ({ state: 'unreadable', reason: String(err) }))
  return read.state === 'unreadable' ? { items: [], unreadable: read.reason } : { items: read.value.items }
}

// [SP_CTX_02_18] The boundary another compaction of the main conversation
// sets once it stands: none for a subagent's, a precomputed one (it stands
// only when used, through manual or auto), the mod's own (MARKER and
// HANDOFF_MARKER under any trigger; HandleCompaction and HandleSeed record
// those) or a skipped one. `host`: hostId if already read ([SP_CTX_01_14]).
export function observedBoundary(
  e: { agentId?: string; trigger: string; instructions?: string },
  done: { skip?: string; messages?: readonly SessionMessage[] },
  host?: string,
): Boundary | undefined {
  if (e.agentId || e.trigger === 'precompute' || isOwnInstruction(e.instructions)) return undefined
  if (done.skip !== undefined || !done.messages) return undefined
  return boundaryOf(done.messages, host)
}

// [SP_CTX_02_18] What the observer of another compaction needs; register.ts binds it.
export type ObserveIO = {
  // [SP_CTX_02_12] Copied = the result ids of these rows
  copies: (rows: readonly SessionMessage[] | undefined) => void
  // [SP_CTX_01_14] hostId if its read has ended: a compaction handler never waits for it
  hostId: () => string | undefined
  // the folder of the current session's storage; undefined: none
  storage: () => Promise<string | undefined>
  // [SP_CTX_02_18] RecordBoundary into `dir`
  writeBoundary: (dir: string, b: Boundary) => Promise<void>
  // [SP_CTX_01_10] the registry's Update port in `dir`, never awaited
  updateTags: (dir: string) => Update<TagRegistry>
  // [SP_CTX_02_41] the compaction stands: the catalog of attachments starts
  // over, and the answers in `dir` go (never awaited); absent: none
  attachments?: { passed: () => void; clear: (dir: string) => Promise<unknown> }
  // [SP_CTX_02_60] the compaction stands: the host rows' records in `dir` go
  // (never awaited); absent: none
  clearHostRows?: (dir: string) => Promise<unknown>
}

// [SP_CTX_02_18] [SP_CTX_02_12] [SP_CTX_01_10] ON compaction that is not the
// mod's (the `pass` branch), once `next` answered: the rows it returned are
// Copied (they may pass session.append again); when it stands, it moves the
// conversation's start (RecordBoundary) and, being no apply of the mod,
// leaves nothing to measure: TagRegistry.lastApply goes, and with it the
// tags of rows it left out (PruneDeadTags, phase 30). A failed write leaves
// the previous boundary; the compaction stands.
export async function observeCompaction(io: ObserveIO, e: CompactionEvent, done: { skip?: string; messages?: readonly SessionMessage[] }): Promise<void> {
  if (!e.agentId && done.skip === undefined) io.copies(done.messages)
  try {
    const b = observedBoundary(e, done, io.hostId())
    if (b) io.attachments?.passed()
    const dir = b && (await io.storage())
    if (b && dir) {
      await io.writeBoundary(dir, b)
      // [SP_CTX_DEC_31] B (phase 30): one change of the registry, the tags of
      // rows that compaction took and left out go with lastApply; no write
      // without either
      const before = e.messages ?? []
      const after = done.messages ?? []
      void io.updateTags(dir)(reg => {
        const pruned = dropLastApply(pruneDeadTags(reg, before, after))
        // [SP_CTX_DEC_36] phase 33: the summary took the guide with the first prompt
        const next = pruned.introduced && !pruned.reintroduce ? { ...pruned, reintroduce: true } : pruned
        return next === reg ? undefined : next
      }).catch(() => undefined)
      if (io.attachments) void io.attachments.clear(dir).catch(() => undefined)
      if (io.clearHostRows) void io.clearHostRows(dir).catch(() => undefined)
    }
  } catch {
    // the previous boundary stays
  }
}

// [SP_CTX_01_06] The archive's JSON. A pair whose media went to files of its
// own keeps their paths in place of the media data, not a second copy.
export function archiveText(originals: ApplyReport['originals'], media: ReadonlyMap<string, string[]>): string {
  const strip = (id: string, result: unknown) => {
    const paths = media.get(ownerKey({ tool_use_id: id })) ?? []
    return paths.length ? withoutMediaData(result, `[media archived: ${paths.join(', ')}]`) : result
  }
  return JSON.stringify(
    originals.map(o => ({
      ...o,
      rows: o.rows.map(r => ({
        ...r,
        toolUses: r.toolUses.map(u => ('result' in u ? { ...u, result: strip(u.tool_use_id, u.result) } : u)),
        ...(r.toolResults ? { toolResults: r.toolResults.map(t => ('result' in t ? { ...t, result: strip(t.tool_use_id, t.result) } : t)) } : {}),
      })),
    })),
  )
}

function withoutMediaData(value: unknown, note: string): unknown {
  if (Array.isArray(value)) return value.map(v => withoutMediaData(v, note))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, (k === 'base64' || k === 'data') && typeof v === 'string' && v.length >= MEDIA_DATA && BASE64.test(v) ? note : withoutMediaData(v, note)]),
  )
}

// [SP_CTX_02_03] [SP_CTX_02_07] [SP_CTX_03_01] ScreenPinned, shared by the
// application and the seed: no edit touches a pinned target, and only a
// rewrite of its own row touches the state slot, however it was queued;
// without a readable registry no edit can be checked.
export function screenPinned(
  messages: readonly SessionMessage[],
  queued: readonly QueuedEdit[],
  tags: Read<TagRegistry>,
): { edits: QueuedEdit[]; refused: string[]; pinned: Pinned } {
  if (tags.state === 'unreadable') return { edits: [], refused: queued.map(e => `${editLabel(messages, e)}: tag registry unreadable`), pinned: NO_PINS }
  const pinned = pinnedTargets(messages, tags.value)
  const edits: QueuedEdit[] = []
  const refused: string[] = []
  for (const raw of queued) {
    // [SP_CTX_02_67] a state edit's target is the slot row now
    const e = raw.op === 'state' ? stampState(messages, raw, pinned.state) : raw
    // [SP_FOLD_02_03] the mod's return of a pinned recall pair is skipped, not
    // refused: the recall stays due
    if (touchesPin(messages, e, pinned)) {
      if (!(isReturnEdit(e) && e.summary === '')) refused.push(`${editLabel(messages, e)}: ${PINNED}`)
    }
    else if (touchesState(messages, e, pinned)) refused.push(`${describeEdit(e)}: ${STATE_SLOT}`)
    else edits.push(e)
  }
  // [SP_FOLD_02_04] a collapse is not refused here: ApplyEdits takes `pinned`
  // and goes around the pinned rows and the slot of its span (FoldSpan)
  return { edits, refused, pinned }
}

// [SP_CTX_01_06] Writes the media of the owners the edits replace into
// `<base>/<n>.<ext>`. An owner whose media cannot all be written keeps none:
// applyEdits then refuses every edit that would replace it.
export async function archiveMedia(
  found: ReadonlyMap<string, readonly MediaRef[]>,
  replaced: ReadonlySet<string>,
  base: string,
  writeMedia: (path: string, base64: string) => Promise<boolean>,
): Promise<Map<string, string[]>> {
  const media = new Map<string, string[]>()
  let n = 0
  for (const [key, refs] of found) {
    if (!replaced.has(key)) continue
    const paths: string[] = []
    for (const ref of refs) {
      n += 1
      const path = `${base}/${n}.${mediaExt(ref.mediaType)}`
      if (!ref.data || !(await writeMedia(path, ref.data))) {
        paths.length = 0
        break
      }
      paths.push(path)
    }
    if (paths.length) media.set(key, paths)
  }
  return media
}

// The queue once a batch was handled: the batch cleared, its report added
// after any report not yet delivered. [SP_CTX_01_04] The fields of other
// steps (the optimization request, a handoff) stay as read (KeepOtherSteps).
// [SP_CTX_01_05] The report enters with CommandNote; the toast goes without it.
// [SP_CTX_02_07] [SP_HELP_02_10] The queue at the commit point: the batch and
// the deferred edits it selected gone; `waiting`, the deferred edits it left
// (bound to the rows returned), stay in their order with the deferredSince of
// their batches. ResumesAfter is false when it selected deferred edits alone.
function reported(q: Queue, text: string, id: number, selection: Selection, waiting: readonly QueuedEdit[]): Queue {
  const { edits: _e, deferredSince: _d, ...base } = keepOtherSteps(q)
  const since = sinceOf(q.deferredSince, waiting)
  const next: Queue = { ...base, edits: [...waiting], ...(since ? { deferredSince: since } : {}) }
  const resumes = nonDeferred(selection.edits).length > 0 && resumesAfter(q)
  return appendReport(next, withCommandNote(text), id, resumes, q.resumePrompt)
}

// [SP_CTX_02_07] The failure branch's write of the queue it read on the
// queue's chain, or undefined: nothing to write. The apply that failed may
// have reached its commit point first (`lastReported`, the id of the last
// report an apply of this module instance wrote and returned without an
// abandon): when the queue holds no batch, carries that report and keeps no
// edit of the batches that apply selected ([SP_HELP_02_10] `selected`; not
// known: no deferred edit may be left), the batch is gone and its report
// stands, so no failure report goes beside it. An apply the host gave up on
// never counts, so its failure is always recorded.
export function failureRecord(read: Read<Queue>, lastReported: number | undefined, reason: string, now: number, selected?: readonly string[]): Queue | undefined {
  const q = read.state === 'unreadable' ? undefined : read.value
  const taken = selected ? new Set(selected) : undefined
  const left = q ? q.edits.some(e => e.deferred !== undefined && (!taken || taken.has(e.deferred))) : false
  if (q && !nonDeferred(q.edits).length && !left && lastReported !== undefined && q.reportId === lastReported) return undefined
  return failedQueue(q, reason, now, selected)
}

// [SP_CTX_02_07] The queue after the handler failed: batch dropped, a report
// of the failure waits for the next prompt. [SP_HELP_02_10] Of the deferred
// edits only those of the batches the failed apply selected go (`selected`;
// not known: none).
export function failedQueue(q: Queue | undefined, reason: string, now: number, selected?: readonly string[]): Queue {
  // [SP_CTX_01_04] the fields of other steps stay as read
  const kept = keepOtherSteps(q)
  const taken = new Set(selected ?? [])
  const went = [...new Set(kept.edits.flatMap(e => (e.deferred !== undefined && taken.has(e.deferred) ? [e.deferred] : [])))]
  const waiting = kept.edits.filter(e => e.deferred === undefined || !taken.has(e.deferred))
  const { edits: _e, deferredSince: _d, ...base } = kept
  const since = sinceOf(kept.deferredSince, waiting)
  const next: Queue = { ...base, edits: waiting, ...(since ? { deferredSince: since } : {}) }
  const deferredWords = went.length ? ` Deferred batches ${went.join(', ')} went with it; ${waiting.length} deferred edit(s) still wait.` : ''
  return appendReport(next, withCommandNote(modText(`applying the edits failed (${reason}); the conversation was not changed and the batch was dropped.${deferredWords}`)), now)
}
