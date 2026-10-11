import type { SessionMessage } from 'claude-code'
import { pruneAliases, type AliasRegistry } from './aliases'
import {
  applyEdits,
  boundaryOf,
  collectMedia,
  describeEdit,
  dropOwnCallsCounted,
  formatReport,
  ownerKey,
  OWN_TOOLS,
  PINNED,
  producedRows,
  replacedOwners,
  STATE_SLOT,
  totalChars,
  touchesPin,
  touchesState,
  type ApplyReport,
  type Boundary,
  type MediaRef,
  type QueuedEdit,
} from './edits'
import { insertDeliveries, type Deliveries } from './deliveries'
import { applyEntry, type JournalEntry } from './journal'
import { appendReport, HANDOFF_MARKER, keepOtherSteps, MARKER, type Queue, type Read } from './queue'
import { rebindNotes } from './notes'
import { relocateStageMarks } from './stages'
import { pinnedTargets, rebindTags, type TagRegistry } from './tags'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

// [SP_CTX_01_06] The file extension of a media file by its media type.
export function mediaExt(mediaType: string): string {
  return EXT[mediaType] ?? 'bin'
}

// [SP_CTX_01_06] A base64 string this long under `base64` or `data` is media data.
export const MEDIA_DATA = 256
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// [SP_CTX_01_12] The args of the built-in /compact the mod runs: the handler
// sees them as `instructions`, and the model reads them in the command's rows,
// so they explain themselves.
export { HANDOFF_MARKER, MARKER } from './queue'

function isOwnInstruction(instructions: string | undefined): boolean {
  return instructions === MARKER || instructions === HANDOFF_MARKER
}

type CompactionEvent = { agentId?: string; trigger: string; instructions?: string }

// [SP_CTX_02_07] Which branch of the handler a compaction takes. A match is
// by `instructions` and no `agentId`, under any trigger but `precompute`: the
// mod's command arrives as `manual`, as does the person's `/compact MARKER`.
export type CompactionRoute = 'apply' | 'seed' | 'pass'

export function compactionRoute(e: CompactionEvent): CompactionRoute {
  if (e.agentId || e.trigger === 'precompute') return 'pass'
  if (e.instructions === MARKER) return 'apply'
  if (e.instructions === HANDOFF_MARKER) return 'seed'
  return 'pass'
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
      return { skip: 'context-editor: seeding failed', recordFailure: false }
    case 'apply':
      return { skip: 'context-editor: applying the edits failed', recordFailure: true }
  }
}

// What HandleCompaction needs from the host; register.ts binds it to `$`.
export type CompactionIO = {
  dir: string
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
  // whole handler holds); absent: runs it as it is
  onRegistries?: <T>(work: () => Promise<T>) => Promise<T>
  // [SP_CTX_02_07] the report of this apply is in the queue and the dispatch
  // was not abandoned when it was written: its id. The caller counts it only
  // once the handler returned without an abandon.
  reported?: (reportId: number) => void
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
}

export type CompactionOutcome = { skip: string } | { messages: SessionMessage[] }

// [SP_CTX_02_07] SKIP_ABANDONED: the host went on without the handler.
const ABANDONED: CompactionOutcome = { skip: 'context-editor: compaction abandoned; the batch stays queued' }

// [SP_CTX_02_07] Applies the queued batch to the compaction's rows. The
// caller runs it on the queue's serial chain.
export async function handleCompaction(io: CompactionIO, messages: readonly SessionMessage[]): Promise<CompactionOutcome> {
  const read = await io.readQueue()
  if (read.state === 'unreadable') return { skip: 'context-editor: queue unreadable' }
  const q = read.value
  if (!q.edits.length) return { skip: 'context-editor: no queued edits' }

  if (q.handoff) return { skip: 'context-editor: handoff pending' }

  const tokensBefore = await (io.requestTokens?.() ?? Promise.resolve(undefined)).catch(() => undefined)
  const tagsRead = await io.readTags()
  const { edits, refused } = screenPinned(messages, q.edits, tagsRead)
  // [SP_CTX_02_34] the calibration the registry holds: the handler never asks for telemetry
  const ratio = tagsRead.state === 'unreadable' ? undefined : tagsRead.value.charsPerToken
  const api = await io.readApi()
  const { found, knownResults, unmatchedPromptMedia, apiTruncated } = collectMedia(api, messages)
  const mediaOwners = new Set(found.keys())
  const id = io.now()
  const media = await archiveMedia(found, replacedOwners(messages, edits), `${io.dir}/${id}`, io.writeMedia)

  // [SP_CTX_02_04] [SP_CTX_DEC_22] FrozenPrefix, only when the batch asked for
  // it ("keep_cache"): the rows before the response of the first change come
  // back as they came, so the prompt cache holds up to it; by default the
  // stretch is rebuilt as before, and --resume stays clean
  const options = { knownResults, unmatchedPromptMedia, apiTruncated, ...(q.keepCache ? { freeze: { api } } : {}) }
  const archive = `${io.dir}/${id}.json`
  const applied = applyEdits(messages, edits, archive, media, mediaOwners, options)
  const frozen = new Set(messages.slice(0, applied.prefix))
  applied.report.failed.unshift(...refused)
  // [C_CTX_01_01] Originals never vanish: without their archive nothing applies.
  if (applied.report.originals.length && !(await io.writeArchive(archive, archiveText(applied.report.originals, media)))) {
    if (io.isAborted()) return ABANDONED
    const text = formatReport(
      {
        ...applied.report,
        applied: [],
        failed: [...refused, ...edits.map(e => `${describeEdit(e)}: originals could not be archived`)],
        charsAfter: applied.report.charsBefore,
        produced: [],
        mediaFiles: [],
      },
      '',
      'compaction',
    )
    await io.writeQueue(reported(q, text, id))
    io.reported?.(id)
    io.toast(text.slice(0, 200))
    return { skip: 'context-editor: originals could not be archived' }
  }
  const archived = archive
  // [SP_CTX_02_05] the count goes into the report's P13 sentence ([SP_CTX_01_05])
  // [SP_CTX_02_36] the host's deliveries behind rebuilt rows go back as rows,
  // before DropOwnCalls: one behind an own call's result keeps its place
  const delivered = await readDeliveries(io)
  // a row of own results kept by its handle (outside the API window) is
  // removed by DropOwnCalls below: the host would not carry its attachments
  const own = new Set(messages.flatMap(r => r.toolUses.filter(u => u.tool.startsWith(OWN_TOOLS)).map(u => u.tool_use_id)))
  // (a frozen row stays, own calls and all: it carries its attachments itself)
  const goes = (r: SessionMessage) => !frozen.has(r) && (r.toolResults ?? []).length > 0 && (r.toolResults ?? []).every(t => own.has(t.tool_use_id))
  const put = insertDeliveries(messages, applied.rows, delivered.items, applied.renamed, false, goes)
  applied.report.deliveries = { ...put.counts, ...(delivered.unreadable !== undefined ? { unreadable: delivered.unreadable } : {}) }
  const { rows, removed } = dropOwnCallsCounted(put.rows, mediaOwners, knownResults, frozen)
  applied.report.ownCallsRemoved = removed
  // [SP_CTX_01_05] a delivery was no row before: it frees nothing and takes nothing
  applied.report.charsAfter = totalChars(rows) - put.added
  // [SP_CTX_01_05] where the made rows stand in the list returned
  applied.report.produced = producedRows(rows, applied.made)

  // An abandoned dispatch changes nothing: the batch stays queued for the
  // next turn, and the files written so far are only orphans in the archive.
  if (io.isAborted()) return ABANDONED

  // [SP_CTX_02_14] Best effort: a stale tag only names a target that is gone.
  // With nothing applied the conversation stays as it was. The stage marks
  // move with the rows, never vanish.
  const names = new Set(applied.report.applied)
  const done = edits.filter(e => names.has(describeEdit(e)))
  const after = done.length ? rows : messages
  const produced = applied.report.produced
  // [SP_CTX_02_31] [SP_CTX_02_18] what the steps after the commit need, made
  // before it: nothing after the queue's write can throw
  const entry = applyEntry(id, applied.report, archived, messages, edits)
  const boundary = boundaryOf(rows, io.hostId())
  const rebind = (reg: TagRegistry) => {
    const out = rebindNotes(relocateStageMarks(rebindTags(reg, messages, after, done, q.edits, produced), messages, after, done, produced), messages, after, done, produced)
    // [SP_CTX_02_28] the telemetry measures what this apply freed
    return { registry: done.length && tokensBefore !== undefined ? { ...out.registry, lastApply: { at: id, tokensBefore } } : out.registry, dropped: out.dropped }
  }
  // [SP_CTX_02_07] Commit: the waits for the registries' chains are over, so
  // every change is made from the registries as they are now, and nothing is
  // written once the host abandoned the dispatch. The registries go first,
  // the queue last: its write is the commit point. If it fails, or the
  // dispatch was abandoned before it, the registries are put back as read.
  const onRegistries = io.onRegistries ?? (<T>(work: () => Promise<T>) => work())
  const text = await onRegistries(async (): Promise<string | undefined> => {
    const tagsNow = await io.readTags().catch((err): Read<TagRegistry> => ({ state: 'unreadable', reason: String(err) }))
    const aliasesNow = await io.readAliases().catch((err): Read<AliasRegistry> => ({ state: 'unreadable', reason: String(err) }))
    const tags = tagsNow.state === 'unreadable' ? undefined : { before: tagsNow.value, ...rebind(tagsNow.value) }
    // An alias of a changed or vanished pair has done its job: it no longer resolves.
    const pruned = aliasesNow.state === 'unreadable' ? undefined : pruneAliases(aliasesNow.value, messages, after, done)
    const aliases = aliasesNow.state !== 'unreadable' && pruned !== undefined && pruned !== aliasesNow.value ? { before: aliasesNow.value, next: pruned } : undefined
    if (io.isAborted()) return undefined
    // [SP_CTX_02_14] RelocateNote: notes on removed rows go and the report
    // names them, only once the registry is written
    const tagsWritten = tags ? await io.writeTags(tags.registry).then(() => true, () => false) : false
    if (tags && tagsWritten) applied.report.notesDropped = tags.dropped
    const aliasesWritten = aliases && !io.isAborted() ? await io.writeAliases(aliases.next).then(() => true, () => false) : false
    const putBack = async () => {
      if (tags && tagsWritten) await io.writeTags(tags.before).catch(() => undefined)
      if (aliases && aliasesWritten) await io.writeAliases(aliases.before).catch(() => undefined)
    }
    if (io.isAborted()) {
      await putBack()
      return undefined
    }
    // [SP_CTX_01_05] without an applied edit: "not changed", no size line
    const report = formatReport(applied.report, archived, 'compaction', ratio)
    try {
      await io.writeQueue(reported(q, report, id))
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
    io.reported?.(id)
    return report
  })
  if (text === undefined) return ABANDONED
  // After the commit point nothing throws and nothing is awaited: the
  // handler answers right away.
  io.toast(text.slice(0, 200))
  if (applied.report.applied.length === 0) return { skip: 'context-editor: no edit could be applied' }
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
  // [SP_CTX_02_31] what this application compressed; never delays the answer
  if (entry && io.journal && !io.isAborted())
    try {
      io.journal(entry)
    } catch {
      // the journal is no part of the application
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
): { edits: QueuedEdit[]; refused: string[] } {
  if (tags.state === 'unreadable') return { edits: [], refused: queued.map(e => `${describeEdit(e)}: tag registry unreadable`) }
  const pinned = pinnedTargets(messages, tags.value)
  const edits: QueuedEdit[] = []
  const refused: string[] = []
  for (const e of queued) {
    if (touchesPin(messages, e, pinned)) refused.push(`${describeEdit(e)}: ${PINNED}`)
    else if (touchesState(messages, e, pinned)) refused.push(`${describeEdit(e)}: ${STATE_SLOT}`)
    else edits.push(e)
  }
  return { edits, refused }
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
function reported(q: Queue, text: string, id: number): Queue {
  return appendReport(keepOtherSteps(q), text, id, q.resume && !q.tagsOnly, q.resumePrompt)
}

// [SP_CTX_02_07] The failure branch's write of the queue it read on the
// queue's chain, or undefined: nothing to write. The apply that failed may
// have reached its commit point first (`lastReported`, the id of the last
// report an apply of this module instance wrote and returned without an
// abandon): when the queue holds no batch and carries that report, the batch
// is gone and its report stands, so no failure report goes beside it. An
// apply the host gave up on never counts, so its failure is always recorded.
export function failureRecord(read: Read<Queue>, lastReported: number | undefined, reason: string, now: number): Queue | undefined {
  const q = read.state === 'unreadable' ? undefined : read.value
  if (q && !q.edits.length && lastReported !== undefined && q.reportId === lastReported) return undefined
  return failedQueue(q, reason, now)
}

// [SP_CTX_02_07] The queue after the handler failed: batch dropped, a report
// of the failure waits for the next prompt.
export function failedQueue(q: Queue | undefined, reason: string, now: number): Queue {
  // [SP_CTX_01_04] the fields of other steps stay as read
  return appendReport(keepOtherSteps(q), `context-editor: applying the edits failed (${reason}); the conversation was not changed and the batch was dropped.`, now)
}
