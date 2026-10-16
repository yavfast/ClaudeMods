import type { EngineInterface, Register, SessionMessage } from 'claude-code'
import { callFacts, EMPTY_ALIASES, markAlias, parseAliases, refResolver, wantsMark, withContext, type AliasIO, type AliasRegistry } from './aliases'
import { compactionFailed, compactionRoute, handleCompaction, observeCompaction } from './compaction'
import {
  afterPrepare,
  boundaryOf,
  collectMedia,
  HOST_ID_WAIT_MS,
  isTrustedBoundary,
  kickHostId,
  newHostIdMemo,
  newHostToken,
  NO_REFS,
  OWN_TOOLS,
  parseBoundary,
  parseHostId,
  peekHostId,
  readView,
  recordBoundary,
  snapshotOf,
  startHostId,
  type Boundary,
  type BoundaryMemory,
  type RefResolver,
  type Snapshot,
  type View,
} from './edits'
import { afterTurn, enteredOrThrow, flushAfterTurn, isPlanned, newFlushState, requestFlush, type FlushIO } from './flush'
import { bounded, callLines, HINT_WAIT_MS, newHintMemo, softHint, turnSuggestion, type HintIO } from './hints'
import { compactFailure, personCompact, type PersonCompactIO } from './personcompact'
import { contextHandoff, handleSeed, handoffAfterTurn, handoffCommand, newHandoffMemory, parseSeedNames, type HandoffArgs, type HandoffIO, type SeedIO } from './handoff'
import { contextEdit, hasMediaFrom, needsApi, deliverReport, EMPTY_QUEUE, MAX_QUEUE_BYTES, parseQueue, settledQueue, withoutReport, type Queue, type QueueIO } from './queue'
import { adviceFor, adviseWaiting, blockName, calibrateBeforeApply, contextList, detectOptimize, endWaiting, guideText, introFor, SKILL, tagCallIO, withIntroduced, type BlockHost, type DetectIO, type ListArgs, type ListIO, type UsageInfo } from './stages'
import { contextNote, noteReminders, reminderPending, remindable, remindsAfter, withReminderLines, type NoteArgs } from './notes'
import { modText, REPAIR_MARKER } from './rows'
import {
  cleanLedger,
  emptyLedger,
  handleRepair,
  needsRepair,
  newRepairMemory,
  parseLedger,
  pulledOf,
  recordInputs,
  repairAtTurnEnd,
  repairSwitched,
  REPAIR_SKIP,
  repairAtStart,
  type ApplyLedger,
  type NeedsIO,
  type Pulled,
  type RepairIO,
} from './repair'
import {
  attachmentAnswer,
  attachPort,
  clearedAnswers,
  emptyHostAttach,
  newAttachMemory,
  parseHostAttach,
  resetPass,
  verifyPredictions,
  voidAnswers,
  type AttachIO,
  type HostAttachState,
} from './hostattach'
import { HANDOFF_COMMAND, NOTE, TAG, TOOLS } from './tools'
import { newTurns, turnCompleted, turnStarted } from './turns'
import {
  CAP_CACHE_FILE,
  capsOf,
  compactBrief,
  compactPassed,
  EDIT_PASSED_OVER,
  briefedQueue,
  briefedTags,
  isPassed,
  merge,
  needsProbe,
  notePassCompaction,
  passedCaps,
  newCapabilities,
  noteAttachment,
  noteCommandUnseen,
  noteOwnCompaction,
  noteTurn,
  noticeOnce,
  observePassedCompact,
  parseCapCache,
  PROBE_FILE,
  PROBE_MARKER,
  probeSkip,
  runProbe,
  scheduleProbe,
  type CapabilityIO,
  type CapEntry,
  type ProbeCounts,
  type ProbeIO,
} from './capabilities'
import { shapeSubagentResult, type ShapeIO } from './subagents'
import { choosePacker, needsRestore, packCommands, restoreSession, sweepSessions, SWEEP_DELAY_MS, unpackCommands, type CleanupIO, type Packer } from './cleanup'
import {
  carry,
  changeOf,
  dirOf,
  dropFileCache,
  ensureStorage as ensureIn,
  jsonFile,
  newFileCache,
  newStorageMemory,
  prepareStorage as prepareFor,
  publishedDir,
  serialChains,
  storageRefusal,
  updateOf,
  type ChainKey,
  type FileIO,
  type Held,
  type Lock,
  type PrepareIO,
  type Read,
  type SessionStorage,
  type StorageState,
  type Store,
  STORAGE_BASE,
} from './store'
import { newAnchorMemory, observeAppend, parseDeliveries, pruneDeliveries, recordDelivery, type Deliveries, type QueuedDelivery } from './deliveries'
import { EMPTY_JOURNAL, journalApply, journalChanged, journalReread, journalSummary, parseJournal, type Journal, type JournalIO, type JournalSummary } from './journal'
import {
  appendRow,
  autoTag,
  callFollowUp,
  contextTag,
  countTurn,
  EMPTY_REGISTRY,
  parseRegistry,
  pinsFrom,
  queueTagReplacements,
  resultIds,
  staleReads,
  seenRead,
  supersededReads,
  type TagArgs,
  type TagIO,
  type TagRegistry,
} from './tags'

// [SP_CTX_01_07] [SP_CTX_02_15] The storage of the session: published once
// its preparation ends, one preparation per session id at a time. Every
// operation takes the folder EnsureStorage gives it once and keeps it.
const storage = newStorageMemory()
// [SP_CTX_02_07] The id of the last report an apply of this instance wrote
// and answered without an abandon, and the folder of the apply running now
// (the failure branch writes there). [SP_CTX_02_43] `line`: the person's
// line of that report (ApplyLine), which Flush logs once its command returned.
const applies: { reported?: number; dir?: string; line?: { id: number; text: string } } = {}
// [SP_CTX_01_14] The identity of the host process, read once per module
// instance. [SP_CTX_02_18] [SP_CTX_DEC_10] A boundary counts when this host
// process wrote it, or this instance in this session (ownBoundary): one left
// by another process (a resumed session) may name rows the host restored.
const hostId = newHostIdMemo()
const ownBoundary: BoundaryMemory = {}
// [SP_CTX_02_18] What the conversation's start was when the agent last listed it.
const listed: { key?: string } = {}
// [SP_CTX_02] The turn counter of the main conversation.
const turns = newTurns()
// [SP_CTX_02_06] Flush planned, and the last report whose resume was sent.
const flushState = newFlushState()
// [SP_CTX_01_15] The handoff of this module instance; `instance` marks its claims.
const handoff = newHandoffMemory(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
// [SP_CTX_02_12] The result ids of the rows the last compaction returned: in
// stream-json each one passes session.append again, with its tool's origin;
// AutoTag skips them. A turn start ends the copies (they come between turns).
const copied = new Set<string>()
// [SP_CTX_02_35] The result ids of the last tool-result row of the main
// conversation: the anchor of a delivery that follows it.
const anchorMem = newAnchorMemory()
// [SP_CTX_02_37] The request size of the last size check without a hint.
const hintMemo = newHintMemo()
// [SP_CTX_02_27] the skill's guide, read once per module instance; a failed
// read is tried again with the next intro (GUIDE_UNREAD gives INTRO_TEXT)
let guide: string | undefined
// [SP_CTX_02_51] the packer this module instance found, probed once
let packer: Promise<Packer> | undefined
// [SP_CTX_01_07] [PL_AUD_CTX_P11] The cache of the tag and alias registries (and [SP_CTX_01_23] hostattach.json):
// a new epoch each time a storage is published (a session start or switch).
const fileCache = newFileCache()
// [SP_CTX_02_39] The host attachments asked since the last pass began, and the
// sections that matched their files when first seen.
const attachMem = newAttachMemory()
// [SP_CTX_02_39] The session the catalog belongs to: a pass begins only on a real switch.
const attachSession: { id?: string } = {}
// [SP_CTX_02_46] The repair after a resume: one attempt per session in this
// instance, the switch that waits for a turn end, the session this instance
// compacted itself, and the last repair's summary for the person's line.
const repairMem = newRepairMemory()
// [SP_CTX_01_25] the host's capabilities: one per host process
const caps = newCapabilities()
let capsLoaded = false
// [SP_CTX_02_57] the mod in a probe process, read once; what it counted
let probeFlag: Promise<boolean> | undefined
const probeCounts: ProbeCounts = { attachments: 0, doors: {} }
// [SP_CTX_01_25] the host's version, read once
let versionRead: Promise<string | undefined> | undefined

function noteCopies(rows: readonly SessionMessage[] | undefined): void {
  copied.clear()
  for (const id of resultIds(rows ?? [])) copied.add(id)
}

// [SP_CTX_02] [PL_AUD_CTX_P7] One serial chain per kind of storage file, in
// the lock order of CHAIN_RANK: no two read-modify-writes of a file overlap.
const serial = serialChains()

// [PL_AUD_CTX_P7] The host's file system, bound once: every storage file and
// the boundary are read and written through it.
function files($: EngineInterface): FileIO {
  return {
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    move: async (from, to) => (await $.process.run(['mv', from, to]).catch(() => ({ exitCode: -1 }))).exitCode === 0,
    now: () => Date.now(),
  }
}

// [SP_CTX_02] The chain `key`; a chain entered out of the lock order goes to
// the debug log only, and the work still runs.
function chainOf($: EngineInterface, key: ChainKey): Lock {
  return (work, within) => serial(key, work, { ...(within ? { within } : {}), report: text => $.ui.log(text, { to: 'debug' }) })
}

type Stores = {
  queue: Store<Queue>
  tags: Store<TagRegistry>
  aliases: Store<AliasRegistry>
  deliveries: Store<Deliveries>
  journal: Store<Journal>
  hostattach: Store<HostAttachState>
  ledger: Store<ApplyLedger>
}

// [SP_CTX_01_07] The storage files of the session whose storage is `dir`,
// each on its chain. The status line follows the current session's queue only.
function stores($: EngineInterface, dir: string): Stores {
  const fs = files($)
  return {
    queue: jsonFile(fs, `${dir}/pending.json`, () => ({ ...EMPTY_QUEUE }), parseQueue, {
      lock: chainOf($, 'queue'),
      written: q => {
        if (dir === publishedDir(storage)) $.ui.status(q.edits.length ? `${q.edits.length} context edit(s) queued` : undefined)
      },
    }),
    tags: jsonFile(fs, `${dir}/tags.json`, () => ({ ...EMPTY_REGISTRY }), parseRegistry, { lock: chainOf($, 'tags'), cache: fileCache }),
    aliases: jsonFile(fs, `${dir}/aliases.json`, () => ({ ...EMPTY_ALIASES, map: {} }), parseAliases, { lock: chainOf($, 'aliases'), cache: fileCache }),
    deliveries: jsonFile(fs, `${dir}/deliveries.json`, (): Deliveries => ({ items: [] }), parseDeliveries, { lock: chainOf($, 'deliveries') }),
    journal: jsonFile(fs, `${dir}/journal.json`, () => ({ ...EMPTY_JOURNAL, entries: [] }), parseJournal, { lock: chainOf($, 'journal') }),
    // [SP_CTX_01_23] read by the prompt.attachment hook through the cache
    hostattach: jsonFile(fs, `${dir}/hostattach.json`, emptyHostAttach, parseHostAttach, { lock: chainOf($, 'hostattach'), cache: fileCache }),
    // [SP_CTX_01_24] the applies' inputs (phase 32)
    ledger: jsonFile(fs, `${dir}/ledger.json`, emptyLedger, parseLedger, { lock: chainOf($, 'ledger') }),
  }
}

// [SP_CTX_02_45] The ledger and the journal of effect in `dir`, read without
// their chains (a reader only); a failed read counts as unreadable.
async function pulledAt($: EngineInterface, dir: string): Promise<Pulled> {
  const s = stores($, dir)
  const ledger = await s.ledger.read().catch((err): Read<ApplyLedger> => ({ state: 'unreadable', reason: String(err) }))
  const journal = await s.journal.read().catch((err): Read<Journal> => ({ state: 'unreadable', reason: String(err) }))
  return pulledOf(ledger, journal)
}

// [SP_CTX_02_44] RecordInputs on the ledger's chain in `dir`, in the
// background; an unreadable ledger goes aside and a new one starts.
function recordInputsAt($: EngineInterface, dir: string, messages: readonly SessionMessage[], id: number): void {
  void stores($, dir)
    .ledger.update(read => recordInputs(read.value, messages, id), { onUnreadable: 'quarantine' })
    .catch(() => undefined)
}

// [SP_CTX_02_46] NeedsRepair bound to the host: the current session's
// storage, its boundary trusted by this host process or this instance.
function needsIO($: EngineInterface): NeedsIO {
  return {
    sessionId: () => $.session.id(),
    storage: () => storageDir($),
    pulled: dir => pulledAt($, dir),
    trusted: async dir => {
      const raw = await readBoundaryText($, dir)
      const b = raw === undefined ? undefined : parseBoundary(raw)
      return !!b && isTrustedBoundary(b, raw!, await hostIdOf($), ownBoundary.own)
    },
    rows: () => $.session.messages(),
  }
}

// [SP_CTX_02_46] ScheduleRepair and RunRepair bound to the host. The timer
// comes from session.start or turn.complete only.
function repairIO($: EngineInterface): RepairIO {
  return {
    sessionId: () => $.session.id(),
    after: (ms, fn) => void $.clock.after(ms, fn),
    needs: () => needsRepair(needsIO($), repairMem),
    // one attempt; a refusal rejects with the host's text
    command: () => ownCompact($, REPAIR_MARKER),
    status: text => $.ui.status(text),
    log: text => $.ui.log(text),
    debug: text => $.ui.log(text, { to: 'debug' }),
    passed: () => passedNow($, true),
  }
}

// [SP_CTX_02_39] [SP_CTX_02_40] A file a section of an instructions
// attachment names; undefined when missing or unreadable.
async function readFileText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
  } catch {
    return undefined
  }
}

// [SP_CTX_02_40] VerifyPredictions bound to the host, in the storage the
// turn ended in; never awaited.
function verifyAttachments($: EngineInterface, at: Promise<string | undefined>): void {
  if (!attachMem.verify) return
  void (async () => {
    const dir = await at
    if (!dir) return
    await verifyPredictions(attachMem, {
      update: change => updateOf(stores($, dir).hostattach)(change),
      invalidate: () => $.ui.invalidate('prompt.attachment'),
    })
  })().catch(() => undefined)
}

// [SP_CTX_02_39] The prompt.attachment hook bound to the host: the decisions
// of the current session's storage, through the cache.
function attachIO($: EngineInterface): AttachIO {
  return {
    decisions: async () => {
      const dir = await storageDir($)
      return dir ? stores($, dir).hostattach.cached() : undefined
    },
    readFile: path => readFileText($, path),
    now: () => Date.now(),
  }
}

// [SP_CTX_01_14] HOST_ENV: the token of the host process, set once when the
// process has none (the validator takes the name only as a literal), and the
// pid of `claude` as the parent of the command's shell.
async function readHostIdOnce($: EngineInterface): Promise<string | undefined> {
  let token = await $.env.get('CONTEXT_EDITOR_HOST')
  if (!token) {
    token = newHostToken()
    await $.env.set('CONTEXT_EDITOR_HOST', token)
  }
  const ran = await $.process.run(['sh', '-c', 'echo $PPID'])
  return ran.exitCode === 0 ? parseHostId(token, ran.stdout) : undefined
}

// [SP_CTX_02_07] The request size before an apply: the plain usage, bounded,
// since a compaction handler never waits long.
const USAGE_WAIT_MS = 500

async function requestTokens($: EngineInterface): Promise<number | undefined> {
  return Promise.race([$.session.usage().then(u => u.context.tokens), $.clock.sleep(USAGE_WAIT_MS).then(() => undefined)])
}

// [SP_CTX_01_14] The read of this module instance, started on first use;
// a reader waits at most HOST_ID_WAIT_MS from the read's start, while the read
// goes on and a later reader gets its identity ([SP_CTX_DEC_24]).
function hostIdOf($: EngineInterface): Promise<string | undefined> {
  return startHostId(
    hostId,
    () => readHostIdOnce($),
    () => $.clock.sleep(HOST_ID_WAIT_MS),
  )
}

async function readBoundaryText($: EngineInterface, dir: string): Promise<string | undefined> {
  const fs = files($)
  if (!(await fs.exists(`${dir}/boundary.json`))) return undefined
  return fs.read(`${dir}/boundary.json`).catch(() => undefined)
}

// [SP_CTX_02_18] The rows of the current conversation, the transcript from
// the last compaction's head on, and a key that changes with that start.
function view($: EngineInterface): Promise<View> {
  return readView({
    hostId: () => hostIdOf($),
    messages: () => $.session.messages(),
    storage: async () => {
      const st = await ensureStorage($)
      return { sessionId: st.sessionId, dir: dirOf(st) }
    },
    readBoundary: dir => readBoundaryText($, dir),
    own: () => ownBoundary.own,
  })
}

// [SP_CTX_02_18] [PL_AUD_CTX_P11] The reads of the conversation of one event
// or tool call: CurrentRows with Key() and the API form, each once.
function snapshot($: EngineInterface): Snapshot {
  return snapshotOf({ view: () => view($), api: () => apiMessages($) })
}

// [SP_CTX_02_18] Indexes from a listing taken before the start moved name other rows.
async function staleIndexes(snap: Snapshot): Promise<boolean> {
  return listed.key !== (await snap.key())
}

// [SP_CTX_02_18] RecordBoundary's write into the storage `dir`; once written
// it is the own boundary, when `dir` is the current session's.
async function writeBoundaryAt($: EngineInterface, dir: string, b: Boundary): Promise<void> {
  const write = (text: string) => files($).write(`${dir}/boundary.json`, text)
  if (dir === publishedDir(storage)) await recordBoundary(ownBoundary, write, b)
  else await write(JSON.stringify(b))
}

// [SP_CTX_02_17] Resolves refs for the context_* call `callId`: aliases
// against the registry as it is now (none without storage or from an
// unreadable registry), "last" on the rows the caller reads.
async function resolver($: EngineInterface, dir: string | undefined, callId: unknown): Promise<RefResolver> {
  const id = typeof callId === 'string' && callId ? callId : undefined
  return refResolver(dir ? await stores($, dir).aliases.cached() : { state: 'missing', value: { ...EMPTY_ALIASES, map: {} } }, id)
}

// [SP_CTX_02_31] Each change on the journal's own chain, in the background,
// in the storage `at`: the folder of the session the event came in, taken
// when it came, not when the chain's turn comes.
function onJournal($: EngineInterface, work: (io: JournalIO, dir: string) => Promise<void>, at: string | Promise<string | undefined>): void {
  void chainOf($, 'journal')(async () => {
    const dir = await at
    if (dir) await work(stores($, dir).journal, dir)
  }).catch(() => undefined)
}

// [SP_CTX_02_49] The ports of ShapeSubagentResult: the archive folder only in
// the project, else the result is not cut.
function shapeIO($: EngineInterface): ShapeIO {
  return {
    storage: async () => {
      const dir = await storageNow($)
      return dir ? archiveRoot($, dir) : undefined
    },
    write: (path, text) => writeText($, path, text),
  }
}

// [SP_CTX_01_07] [C_CTX_DEC_28] ArchiveRoot: the archives of storage `dir`
// go to the session's working directory, where the host lets Read in without
// asking, under a folder that git-ignores itself; none without a cwd or when
// the folder cannot be made. [SP_CTX_02_50] The storage remembers each such
// folder (one per cwd) in `archives.txt`, so a sweep finds them from another session.
async function archiveRoot($: EngineInterface, dir: string): Promise<string | undefined> {
  const cwd = await $.session.cwd().catch(() => undefined)
  if (!cwd) return undefined
  const root = `${cwd}/.claude/context-editor`
  const folder = `${root}/${dir.slice(dir.lastIndexOf('/') + 1)}`
  // a session whose cwd is $HOME: the archive folder would be the storage itself
  if (folder === dir) return undefined
  const ran = await $.process
    .run([
      'sh',
      '-c',
      'umask 077 && mkdir -p "$2" && { [ -e "$1/.gitignore" ] || printf \'*\\n\' > "$1/.gitignore"; } && { grep -qxF -- "$2" "$3/archives.txt" 2>/dev/null || printf \'%s\\n\' "$2" >> "$3/archives.txt"; }',
      'sh',
      root,
      folder,
      dir,
    ])
    .catch(() => ({ exitCode: -1 }))
  return ran.exitCode === 0 ? folder : undefined
}

// [SP_CTX_01_07] The archive folder of the main conversation: the storage when
// the project has none.
async function archivesOf($: EngineInterface, dir: string): Promise<string> {
  return (await archiveRoot($, dir)) ?? dir
}

// [SP_CTX_01_07] The folder of the current session, asked for now; a failure gives none.
function storageNow($: EngineInterface): Promise<string | undefined> {
  return storageDir($).catch(() => undefined)
}

// [SP_CTX_02_02] [SP_CTX_02_11] [SP_CTX_02_58] The deliveries not yet rows,
// for the refusals over the person's words: none when the file is missing or
// unreadable (the rows still count). `within`: the
// chains the caller holds.
async function deliveredNow($: EngineInterface, dir: string, within?: Held): Promise<readonly QueuedDelivery[]> {
  const d = stores($, dir).deliveries
  const read = await d.onChain(() => d.read(), within).catch((): Read<Deliveries> => ({ state: 'unreadable', reason: 'read failed' }))
  return read.state === 'ok' ? read.value.items : []
}

// [SP_CTX_02_28] The journal's part of the telemetry; a failed read says why.
async function journalNow($: EngineInterface, dir: string | undefined): Promise<JournalSummary | undefined> {
  if (!dir) return undefined
  return journalSummary(await stores($, dir).journal.read().catch((err): Read<Journal> => ({ state: 'unreadable', reason: String(err) })))
}

// [SP_CTX_02_15] PrepareStorage bound to the host. No ready file: the module
// that runs the compaction command also handles it ([C_CTX_DEC_09]).
// `inCompaction`: called from a compaction handler, which never waits for hostId.
function prepareIO($: EngineInterface, inCompaction: boolean): PrepareIO {
  return {
    urgent: inCompaction,
    sessionId: () => $.session.id(),
    home: () => {
      // [SP_CTX_01_14] started here or in session.start, whichever comes first; not
      // awaited. A compaction handler starts only the first read, never a retry.
      if (inCompaction) kickHostId(hostId, () => readHostIdOnce($), () => $.clock.sleep(HOST_ID_WAIT_MS))
      else void hostIdOf($)
      return $.env.get('HOME')
    },
    mkdir: (dir, base) => $.process.run(['sh', '-c', 'umask 077 && mkdir -p "$1" && chmod 700 "$2" "$1"', 'sh', dir, base]),
    restore: (base, id) => restoreSession(cleanupIO($), base, id),
    // [SP_CTX_02_18] a switch in this process (/clear, /resume): the new
    // session's boundary this process wrote no longer names the rows read here
    after: (prev, now, dir, hurried) =>
      afterPrepare({
        prev,
        now,
        inCompaction,
        hurried,
        wait: () => hostIdOf($),
        peek: () => peekHostId(hostId),
        read: () => readBoundaryText($, dir),
        write: text => files($).write(`${dir}/boundary.json`, text),
        remove: () => removeFile($, `${dir}/boundary.json`),
        toast: text => $.ui.toast(text),
      }),
    published: () => {
      ownBoundary.own = undefined
      listed.key = undefined
      // [SP_CTX_01_07] no cached read crosses into another session
      dropFileCache(fileCache)
      // [SP_CTX_02_39] another conversation (a real switch, not a first or
      // repeated publication of the same session): its attachments are asked anew
      // [SP_CTX_02_46] and its repair waits for the turn end
      if (attachSession.id !== undefined && attachSession.id !== storage.sessionId) {
        resetPass(attachMem)
        if (storage.sessionId !== undefined) repairSwitched(repairMem, storage.sessionId)
      }
      attachSession.id = storage.sessionId
    },
    status: text => $.ui.status(text),
  }
}

// [SP_CTX_02_15] A preparation for the session current now, even when it has
// its storage already (the session start).
async function prepareStorage($: EngineInterface): Promise<SessionStorage> {
  return prepareFor(storage, prepareIO($, false), await $.session.id())
}

async function removeFile($: EngineInterface, path: string): Promise<void> {
  const ran = await $.process.run(['rm', '-f', '--', path])
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `rm: exit ${ran.exitCode}`)
}

// [SP_CTX_02_50] [SP_CTX_02_51] [SP_CTX_02_52] The sweep's ports: every call
// resolves, a failure is undefined or false; commands run owner-only (umask 077).
function cleanupIO($: EngineInterface): CleanupIO {
  const ok = (argv: readonly string[], cwd?: string) =>
    $.process
      .run(['sh', '-c', 'umask 077 && exec "$@"', 'sh', ...argv], { timeoutMs: 120_000, ...(cwd ? { cwd } : {}) })
      .then(r => r.exitCode === 0, () => false)
  const runs = async (cmds: { argv: string[]; cwd?: string }[]) => {
    if (!cmds.length) return false
    for (const c of cmds) if (!(await ok(c.argv, c.cwd))) return false
    return true
  }
  return {
    now: () => Date.now(),
    list: dir => $.fs.list(dir).then(
      es => es.map(e => ({ name: e.name, kind: e.kind })),
      () => undefined,
    ),
    mtime: path => $.fs.stat(path).then(st => st.mtimeMs, () => undefined),
    exists: path => $.fs.exists(path).catch(() => false),
    lines: path =>
      $.fs.read(path).then(
        t => t.split('\n').map(l => l.trim()).filter(Boolean),
        () => [],
      ),
    write: (path, text) => writeText($, path, text),
    lock: path => ok(['mkdir', '--', path]),
    remove: path => ok(['rm', '-rf', '--', path]),
    // never over an existing `to`: mv would replace a file or move into a folder
    rename: (from, to) => ok(['sh', '-c', '[ ! -e "$2" ] && mv -- "$1" "$2"', 'sh', from, to]),
    packer: () =>
      (packer ??= (async () => {
        const probe = (argv: string[]) => $.process.run(argv).catch(() => undefined)
        const [zip, unzip, tar] = await Promise.all([probe(['zip', '-v']), probe(['unzip', '-v']), probe(['tar', '--version'])])
        return choosePacker(zip?.exitCode === 0, unzip?.exitCode === 0, tar?.exitCode === 0 ? tar.stdout : undefined)
      })()),
    pack: (p, folder, zip) => runs(packCommands(p, folder, zip)),
    unpack: async (p, zip, folder, keep) => (await ok(['mkdir', '-p', '--', folder])) && runs(unpackCommands(p, zip, folder, keep)),
  }
}

// [SP_CTX_02_50] One sweep from the deferred action of a session start; its
// one line goes to the debug log.
async function runSweep($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (!home?.startsWith('/')) return
  const base = home.replace(/\/+$/, '')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR'))?.replace(/\/+$/, '') || `${base}/.claude`
  const out = await sweepSessions(cleanupIO($), { home: base, config, current: await $.session.id() })
  $.ui.log(modText('skipped' in out ? `old sessions not swept: ${out.skipped}` : `old sessions: ${out.removed} removed, ${out.packed} packed`), { to: 'debug' })
}

// [SP_CTX_01_07] /clear or /resume in the same process change the session
// without a session start: the storage follows the current session. The
// folder or why there is none, and the session they belong to.
function ensureStorage($: EngineInterface, inCompaction = false): Promise<SessionStorage> {
  return ensureIn(storage, prepareIO($, inCompaction))
}

// [SP_CTX_02_27] [SP_CTX_DEC_36] GuideText of the mod's skill file, or none.
async function skillGuide($: EngineInterface): Promise<string | undefined> {
  if (guide === undefined) guide = await $.fs.read(`${$.plugin.root}/skills/${SKILL}/SKILL.md`).then(guideText, () => undefined)
  return guide
}

// The folder of the current session's storage, or undefined.
async function storageDir($: EngineInterface, inCompaction = false): Promise<string | undefined> {
  return dirOf(await ensureStorage($, inCompaction))
}

// Writes an owner-only text file through the host shell, its folder made: no
// size limit of $.fs.write.
async function writeText($: EngineInterface, path: string, text: string): Promise<boolean> {
  const ran = await $.process
    .run(['sh', '-c', 'umask 077 && mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path], { stdin: text })
    .catch(() => ({ exitCode: -1 }))
  return ran.exitCode === 0
}

// Writes one media file from base64, inside the owner-only storage.
async function writeMedia($: EngineInterface, path: string, data: string): Promise<boolean> {
  const ran = await $.process
    .run(['sh', '-c', 'umask 077 && mkdir -p "$(dirname "$1")" && base64 -d > "$1"', 'sh', path], { stdin: data })
    .catch(() => ({ exitCode: -1 }))
  return ran.exitCode === 0
}

async function apiMessages($: EngineInterface): Promise<readonly unknown[]> {
  return (await $.session.messages({ as: 'api' })) as unknown as readonly unknown[]
}

// The folder a port without storage never reaches: its caller refuses first.
function need(dir: string | undefined): string {
  if (!dir) throw new Error(storageRefusal('no folder for this step'))
  return dir
}

// The read state of a port whose storage is unavailable.
function unavailable<T>(st: StorageState): Read<T> {
  return { state: 'unreadable', reason: storageRefusal('reason' in st ? st.reason : 'no folder') }
}

function queueIO($: EngineInterface, dir: string): QueueIO {
  const q = stores($, dir).queue
  return { readQueue: q.read, writeQueue: q.write, quarantine: q.quarantine, queuePath: q.path }
}

// [SP_CTX_02_16] `dir` undefined: no storage, MarkAlias marks nothing.
function aliasIO($: EngineInterface, dir: string | undefined): AliasIO {
  return {
    ready: async () => dir !== undefined,
    readAliases: () => stores($, need(dir)).aliases.read(),
    writeAliases: reg => stores($, need(dir)).aliases.write(reg),
  }
}

// [SP_CTX_02_06] Flush bound to the host. Its timer comes from the
// turn.complete hook that calls `flushAfterTurn`. Each step takes the storage
// of the session current when it runs.
function flushIO($: EngineInterface): FlushIO {
  let tagsDir: string | undefined
  return {
    readQueue: async () => {
      const st = await ensureStorage($)
      return 'dir' in st ? stores($, st.dir).queue.read() : unavailable(st)
    },
    updateQueue: async change => {
      const dir = await storageDir($)
      return dir ? updateOf(stores($, dir).queue)(change) : false
    },
    readTags: async () => {
      const st = await ensureStorage($)
      tagsDir = 'dir' in st ? st.dir : undefined
      return 'dir' in st ? stores($, st.dir).tags.read() : unavailable(st)
    },
    // [SP_CTX_DEC_37] AdviseWaiting on the registry's chain, in the folder the
    // advice was read from: a /clear or /resume meanwhile leaves the new
    // session's block marked
    advised: async () => {
      if (tagsDir) await changeOf(stores($, tagsDir).tags)(adviseWaiting)
    },
    // one attempt; a refusal rejects with the host's text
    compact: args => ownCompact($, args),
    compactPassed: wait => passedNow($, wait),
    // [SP_CTX_02_34] CalibrateBeforeApply in the storage taken once, the
    // registry's view from the cache, its change on the registry's chain
    calibrate: async () => {
      const dir = await storageDir($)
      if (!dir) return
      const s = stores($, dir)
      await calibrateBeforeApply({ usage: () => usageInfo($), api: () => apiMessages($), readTags: s.tags.cached, updateTags: updateOf(s.tags) })
    },
    sleep: ms => $.clock.sleep(ms),
    // a timer the host refuses at once throws here, to the planner
    after: (ms, fn) => void $.clock.after(ms, fn),
    // A refused prompt resolves with `drop`; Flush treats it as a failure.
    submit: text => enteredOrThrow($.prompt.submit({ text })),
    removeDelivered: delivered => removeDelivered($, delivered),
    status: text => $.ui.status(text),
    toast: text => $.ui.toast(text),
    // [SP_CTX_02_43] a line in the chat for the person; the model never sees it
    log: text => $.ui.log(text),
    appliedLine: id => (applies.line?.id === id ? applies.line.text : undefined),
    now: () => Date.now(),
    sessionId: () => $.session.id(),
    turns,
  }
}

// [SP_CTX_02_42] The person's /compact bound to the host. Flush's timer
// comes from the command.run hook, which no turn waits on (as /handoff's);
// `$.clock.after` throwing reaches personCompact. `aborted`: the hook's signal.
function personCompactIO($: EngineInterface, aborted: () => boolean): PersonCompactIO {
  return {
    storage: async () => {
      const st = await ensureStorage($)
      return 'dir' in st ? { dir: st.dir, session: await $.session.id() } : undefined
    },
    updateQueueAt: dir => updateOf(stores($, dir).queue),
    aborted,
    planFlush: session => void requestFlush(flushIO($), flushState, session),
    toast: text => $.ui.toast(text),
    now: () => Date.now(),
    compactPassed: () => passedNow($, true),
    brief: () => briefNow($),
  }
}

// [SP_CTX_02_08] RemoveDelivered: the delivered text leaves the current
// session's queue, on its serial chain; Flush's after its own prompt.
async function removeDelivered($: EngineInterface, delivered: string): Promise<void> {
  const dir = await storageDir($)
  if (dir) await updateOf(stores($, dir).queue)(q => withoutReport(q, delivered))
}

// [SP_CTX_02_28] The usage with the breakdown the telemetry reads (no API request).
function usageInfo($: EngineInterface): Promise<UsageInfo> {
  return $.session.usage({ breakdown: 'summary' })
}

// [SP_CTX_02_33] The due reminders after one of the mod's own tools, on the
// registry's chain, called once the tool's own work left every chain; none
// for a subagent or a refused call, nor after context_edit and
// context_handoff (remindsAfter).
async function dueLines($: EngineInterface): Promise<string[]> {
  const dir = await storageDir($).catch(() => undefined)
  if (!dir) return []
  const tags = stores($, dir).tags
  // [PL_AUD_CTX_P11] a known registry without a pending reminder: no chain, no read
  if (!reminderPending(tags.peek())) return []
  return tags.onChain(() => noteReminders(tagIO($, dir))).catch((): string[] => [])
}

async function remindAfter<T extends object>($: EngineInterface, tool: string, agentId: unknown, out: T): Promise<T> {
  if (agentId || 'deny' in out || !remindsAfter(tool)) return out
  return withReminderLines(out, await dueLines($))
}

// [SP_CTX_02_37] SoftHint bound to the host in the storage `dir`: the plain
// usage first, the breakdown only for the size trigger, the calibration in
// the background (SoftHint does not wait for it), the hint state on the
// registry's chain (true when written).
function hintIO($: EngineInterface, dir: string, snap: Snapshot = snapshot($)): HintIO {
  const s = stores($, dir)
  return {
    // [SP_CTX_01_07] views and gates: the cache; the claim reads the file (changeTags)
    readTags: s.tags.cached,
    readAliases: () => s.aliases.onChain(() => s.aliases.cached()),
    readQueue: s.queue.read,
    rows: snap.rows,
    request: async () => {
      const u = await $.session.usage()
      return { tokens: u.context.tokens, window: u.context.window }
    },
    usage: () => usageInfo($),
    // [SP_CTX_02_38] the responses of the rows and the model's cost ratios
    api: snap.api,
    model: () => $.session.model(),
    updateTags: updateOf(s.tags),
    changeTags: changeOf(s.tags),
  }
}

// [SP_CTX_02_37] The size channel's suggestion after a marked output. Never
// longer than HINT_WAIT_MS.
async function hintFor($: EngineInterface): Promise<string | undefined> {
  // [SP_CTX_02_54] no suggestion of a tool that refuses
  if (isPassed(caps)) return undefined
  const dir = await storageDir($).catch(() => undefined)
  if (!dir) return undefined
  return bounded(
    d => softHint(hintIO($, dir), hintMemo, d).then(o => o.line),
    () => $.clock.sleep(HINT_WAIT_MS),
  )
}

// [SP_CTX_02_37] The turn channel's suggestion for the person's prompt
// between turns. Never longer than HINT_WAIT_MS.
function suggestionFor($: EngineInterface, dir: string): Promise<string | undefined> {
  if (isPassed(caps)) return Promise.resolve(undefined)
  return bounded(
    d => turnSuggestion(hintIO($, dir), hintMemo, d).then(o => o.line),
    () => $.clock.sleep(HINT_WAIT_MS),
  )
}

// [SP_CTX_02_29] BlockReport's host (the conversation comes from the call's
// snapshot, tagCallIO). [SP_CTX_02_34] [SP_CTX_02_28] A change of the
// telemetry (a new calibration, the measured apply consumed) goes into the
// registry in `dir`, on its chain.
function blockHost($: EngineInterface, dir: string): BlockHost {
  const s = stores($, dir)
  return {
    // [SP_CTX_01_07] a view: the cache
    readTags: s.tags.cached,
    updateTags: updateOf(s.tags),
    usage: () => usageInfo($),
    journal: async () => (await journalNow($, dir)) ?? { applications: 0, rereads: 0, archiveRereads: 0 },
    setListed: key => {
      listed.key = key
    },
    passed: () => isPassed(caps),
    // [SP_CTX_02_66] views: the cache
    readAliases: s.aliases.cached,
    cwd: () => $.session.cwd(),
  }
}

// [SP_CTX_02_30] DetectOptimize bound to the host in the storage `dir`
// (undefined: none, the mark is ignored): each queue change on the queue's
// chain, each registry change on the registry's, never one inside the other.
function detectIO($: EngineInterface, dir: string | undefined, snap: Snapshot = snapshot($)): DetectIO {
  const s = () => stores($, need(dir))
  return {
    ready: async () => dir !== undefined,
    readQueue: async () => s().queue.read(),
    changeQueue: async change => changeOf(s().queue)(change),
    changeTags: async change => changeOf(s().tags)(change),
    rows: snap.rows,
    status: text => $.ui.status(text),
    toast: text => $.ui.toast(text),
    now: () => Date.now(),
  }
}

// [SP_CTX_02_21] The handoff bound to the host. Its timers come from the
// turn.complete hook or the /handoff command that calls in.
function handoffIO($: EngineInterface): HandoffIO {
  return {
    now: () => Date.now(),
    turns,
    after: (ms, fn) => void $.clock.after(ms, fn),
    sleep: ms => $.clock.sleep(ms),
    sessionId: () => $.session.id(),
    storage: async () => {
      const st = await ensureStorage($)
      return 'dir' in st ? { dir: st.dir } : { reason: st.reason }
    },
    readQueue: dir => stores($, dir).queue.read(),
    changeQueue: (dir, change) => changeOf(stores($, dir).queue)(change),
    view: () => view($),
    readApi: () => apiMessages($),
    readTags: dir => stores($, dir).tags.read(),
    // [SP_CTX_02_22] the deliveries go into the seed as rows
    readDeliveries: dir => {
      const d = stores($, dir).deliveries
      return d.onChain(() => d.read())
    },
    // [SP_CTX_02_45] BuildSeed's DropPulled
    readLedger: dir => pulledAt($, dir),
    changeTags: (dir, change) => changeOf(stores($, dir).tags)(change),
    listSeeds: async dir =>
      parseSeedNames((await $.process.run(['sh', '-c', 'for f in "$1"/*/seed.json; do [ -f "$f" ] && basename "$(dirname "$f")"; done; true', 'sh', dir])).stdout),
    archives: dir => archivesOf($, dir),
    cwd: () => $.session.cwd(),
    writeMedia: (path, data) => writeMedia($, path, data),
    writeText: (path, text) => writeText($, path, text),
    remove: async path => {
      await $.process.run(['rm', '-rf', '--', path])
    },
    // [SP_CTX_02_21] the storage folders are owner-only (700)
    carryTags: (from, to, change) => carry(stores($, from).tags, stores($, to).tags, change, 'the tag registry'),
    carryAliases: (from, to, change) => carry(stores($, from).aliases, stores($, to).aliases, change, 'the alias registry'),
    // [C_CTX_DEC_13] one attempt; the host's refusal is never swallowed: it rejects with its text
    runCommand: async (command, args) => {
      if (command === 'compact') await ownCompact($, args ?? '')
      else await $.command.run({ command, args: args ?? '' })
    },
    compactPassed: wait => passedNow($, wait),
    fork: async prompt => {
      const r = await $.model.fork({ prompt })
      if (!r.isAnswered) throw new Error(`no reply: ${r.reason}`)
      return r.text
    },
    // A refused prompt resolves with `drop`; the handoff treats it as a failure.
    submit: text => enteredOrThrow($.prompt.submit({ text })),
    toast: text => $.ui.toast(text),
    // [SP_CTX_02_43] a line in the chat for the person; the model never sees it
    log: text => $.ui.log(text),
    status: text => $.ui.status(text),
  }
}

// [SP_CTX_02_26] HandleSeed bound to the host: the boundary goes to the
// storage of the session the compaction runs in, the new one.
function seedIO($: EngineInterface): SeedIO {
  return {
    sessionId: () => $.session.id(),
    recordBoundary: async b => {
      const dir = await storageDir($, true)
      if (dir) await writeBoundaryAt($, dir, b)
    },
    hostId: () => peekHostId(hostId),
  }
}

// [SP_CTX_02_11] The registry's port in the storage `dir`; undefined: none,
// and the caller refuses before it reads.
function tagIO($: EngineInterface, dir: string | undefined, snap: Snapshot = snapshot($)): TagIO {
  const s = () => stores($, need(dir))
  return {
    rows: snap.rows,
    readTags: () => s().tags.read(),
    writeTags: reg => s().tags.write(reg),
    readQueue: () => s().queue.read(),
    writeQueue: q => s().queue.write(q),
  }
}

// [SP_CTX_02_65] ReadPaths: the paths whose reads this module instance saw; a reload empties it.
const readPaths = new Set<string>()

// [SP_CTX_02_16] [SP_CTX_02_31] After a call without error: a write tool
// marks the earlier reads of its path stale (R4) and journals the change of a
// compressed path; a Read journals a reread of compressed content or of an
// archive and, on a path read before, marks the earlier reads whose content
// changed superseded (R6, [SP_CTX_02_65]). Each on its own chain, in the background.
function afterCall($: EngineInterface, tool: string, input: Record<string, unknown>, id: string, isError: boolean, text: unknown): void {
  const next = callFollowUp(tool, input, isError)
  if (!next) return
  // the folder of the session the call ran in, taken now
  const at = storageNow($)
  if ('write' in next) {
    void chainOf($, 'tags')(async () => {
      const dir = await at
      if (dir) await staleReads(tagIO($, dir), next.write, id)
    }).catch(() => undefined)
    onJournal($, io => journalChanged(io, next.write, Date.now()), at)
    return
  }
  onJournal($, io => journalReread(io, next.read, id, Date.now()), at)
  if (!seenRead(readPaths, next.read) || typeof text !== 'string') return
  void chainOf($, 'tags')(async () => {
    const dir = await at
    if (dir) await supersededReads(tagIO($, dir), next.read, id, input, text)
  }).catch(() => undefined)
}

function deny(reason: string) {
  return { deny: modText(reason) }
}

// [SP_CTX_02_01] context_list bound to the host.
function listIO($: EngineInterface, snap: Snapshot = snapshot($)): ListIO {
  return {
    view: snap.view,
    api: snap.api,
    storage: () => storageDir($),
    // [SP_CTX_01_07] a view: the cache
    readTags: dir => stores($, dir).tags.cached(),
    readAliases: dir => stores($, dir).aliases.cached(),
    usage: () => usageInfo($),
    updateTags: dir => updateOf(stores($, dir).tags),
    journal: dir => journalNow($, dir),
    dueLines: () => dueLines($),
    setListed: key => {
      listed.key = key
    },
    // [SP_CTX_02_28] a view: the cache
    hostAttach: async dir => {
      const read = await stores($, dir).hostattach.cached()
      return read.state === 'unreadable' ? undefined : read.value.left
    },
  }
}

// [SP_CTX_02_11] [SP_CTX_02_32] What context_tag and context_note take from
// the host first, in this order: the storage (none for a subagent), the ref
// resolver and whether the listed indexes are stale, on the call's `snap`.
async function registryCall($: EngineInterface, e: { agentId?: string; tool_use_id?: unknown }, snap: Snapshot) {
  const st = e.agentId ? undefined : await ensureStorage($)
  const dir = st && dirOf(st)
  const down = st && 'reason' in st ? st.reason : undefined
  const refs = e.agentId ? NO_REFS : await resolver($, dir, e.tool_use_id)
  return { dir, down, refs, stale: !!dir && (await staleIndexes(snap)) }
}

// ---- [SP_CTX_02_53]–[SP_CTX_02_57] the host's capabilities

// [SP_CTX_02_57] The mod runs in a probe process (CONTEXT_EDITOR_PROBE=1).
function isProbe($: EngineInterface): Promise<boolean> {
  probeFlag ??= $.env
    .get('CONTEXT_EDITOR_PROBE')
    .then(v => v === '1')
    .catch(() => false)
  return probeFlag
}

// [SP_CTX_01_25] The host's version, read once per instance; undefined: the read threw (CAP_NO_VERSION).
function hostVersion($: EngineInterface): Promise<string | undefined> {
  versionRead ??= $.session
    .version()
    .then(v => v.version)
    .catch(() => undefined)
  return versionRead
}

// [SP_CTX_01_26] <root>/capabilities.json, shared by the machine's sessions.
async function capCachePath($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? `${home.replace(/\/+$/, '')}/${STORAGE_BASE}/${CAP_CACHE_FILE}` : undefined
}

function capIO($: EngineInterface): CapabilityIO {
  return {
    readCache: async () => {
      const path = await capCachePath($)
      return parseCapCache(path ? await readFileText($, path) : undefined)
    },
    writeCache: async cache => {
      const path = await capCachePath($)
      if (!path || !(await writeText($, path, JSON.stringify(cache)))) throw new Error('the cache file was not written')
    },
    now: () => Date.now(),
    scheduleProbe: () => void planProbe($),
    debug: text => $.ui.log(text, { to: 'debug' }),
  }
}

function mergeCaps($: EngineInterface, source: CapEntry['source']): Promise<void> {
  return merge(capIO($), caps, source)
}

// [SP_CTX_02_56] One probe per process, from a deferred action.
function planProbe($: EngineInterface): boolean {
  return scheduleProbe({ after: (ms, fn) => void $.clock.after(ms, fn) }, caps, () => runProbe(probeIO($), caps))
}

function probeIO($: EngineInterface): ProbeIO {
  return {
    after: (ms, fn) => void $.clock.after(ms, fn),
    // the shell's parent is the host itself; in VS Code the claude on PATH is another one
    hostExe: async () => (await $.process.run(['sh', '-c', 'readlink /proc/$PPID/exe'])).stdout,
    tempDir: async () => (await $.process.run(['mktemp', '-d'])).stdout,
    run: (argv, init) => $.process.run([...argv], init),
    readFile: path => readFileText($, path),
    remove: async paths => {
      const r = await $.process.run(['rm', '-rf', ...paths])
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `exit ${r.exitCode}`)
    },
    projectsDir: async () => {
      const home = (await $.env.get('HOME'))?.replace(/\/+$/, '')
      const config = (await $.env.get('CLAUDE_CONFIG_DIR'))?.replace(/\/+$/, '') || (home ? `${home}/.claude` : undefined)
      return config ? `${config}/projects` : undefined
    },
    pluginRoot: $.plugin.root,
    merge: () => mergeCaps($, 'probe'),
    debug: text => $.ui.log(text, { to: 'debug' }),
  }
}

// [SP_CTX_02_56] `compact` passed over; `wait`: while unknown, wait for the
// probe of this process at most PROBE_WAIT_MS.
function passedNow($: EngineInterface, wait: boolean): Promise<boolean> {
  return compactPassed(caps, ms => $.clock.sleep(ms), wait)
}

// [SP_CTX_02_53] The mod's own compaction command: NoteCommandUnseen when the
// command returned and the handler never saw its marker. One attempt; a
// refusal rejects with the host's text.
async function ownCompact($: EngineInterface, args: string): Promise<void> {
  const seen = caps.ownSeen
  await $.command.run({ command: 'compact', args })
  if (caps.ownSeen === seen) {
    noteCommandUnseen(caps)
    void mergeCaps($, 'live').catch(() => undefined)
  }
}

// [SP_CTX_02_53] NoteOwnCompaction from the handler of a marker of the mod.
function ownCompactionSeen($: EngineInterface): void {
  const was = caps.live.compact
  noteOwnCompaction(caps)
  if (was !== 'reached') void mergeCaps($, 'live').catch(() => undefined)
}

// [SP_CTX_02_53] notePassCompaction from the handler's `pass` route.
function passCompactionSeen($: EngineInterface): void {
  const was = caps.live.compact
  notePassCompaction(caps)
  if (was !== 'reached') void mergeCaps($, 'live').catch(() => undefined)
}

// [SP_CTX_02_53] [SP_CTX_02_56] Once per process, at its first session start:
// the cache entry of this host version, or a probe.
async function loadCapabilities($: EngineInterface): Promise<void> {
  if (capsLoaded) return
  capsLoaded = true
  caps.version = await hostVersion($)
  if (!caps.version) return
  const cache = await capIO($).readCache()
  caps.cache = capsOf(cache.entries[caps.version])
  if (needsProbe(cache.entries[caps.version])) planProbe($)
}

// [SP_CTX_02_53] AfterTurn's first step: NoteTurn, Merge, and the person's
// one line per process.
async function capabilitiesAtTurnEnd($: EngineInterface, aborted: boolean, at: Promise<string | undefined>): Promise<void> {
  if (aborted) return
  noteTurn(caps)
  await mergeCaps($, 'live')
  if (!passedCaps(caps).some(cap => !caps.noticed.includes(cap))) return
  let queued = 0
  // [SP_CTX_01_07] CONC-01: the folder AfterTurn took at the turn end
  const dir = await at.catch(() => undefined)
  if (dir) {
    const q = await stores($, dir).queue.read().catch(() => undefined)
    if (q && q.state !== 'unreadable') queued = q.value.edits.length
  }
  const line = noticeOnce(caps, queued)
  if (line) $.ui.log(line)
}

// [SP_CTX_02_55] CompactBrief over one read of each source; an unreadable one is left out.
async function briefNow($: EngineInterface): Promise<string> {
  const dir = await storageDir($)
  const { rows } = await snapshot($).view()
  const s = dir ? stores($, dir) : undefined
  const reg = s ? await s.tags.read().catch(() => undefined) : undefined
  const q = s ? await s.queue.read().catch(() => undefined) : undefined
  return compactBrief(rows, reg && reg.state !== 'unreadable' ? reg.value : undefined, q && q.state !== 'unreadable' ? q.value : undefined)
}

// [SP_CTX_02_55] ObservePassedCompact after the host's summary under the brief.
async function observeBrief($: EngineInterface, before: readonly SessionMessage[]): Promise<void> {
  const after = await $.session.messages()
  const dir = await storageDir($)
  if (!dir) return
  const s = stores($, dir)
  await observePassedCompact(
    {
      hostId: () => peekHostId(hostId),
      writeBoundary: b => writeBoundaryAt($, dir, b),
      updateTags: (was, now) => updateOf(s.tags)(reg => briefedTags(reg, was, now)),
      clearQueue: () => updateOf(s.queue)(q => briefedQueue(q, EMPTY_QUEUE)),
      // [SP_CTX_02_41] the summary stands: the answers about attachments go
      clearAttachments: async () => {
        voidAnswers(attachMem)
        await updateOf(s.hostattach)(clearedAnswers)
      },
      boundaryOf,
    },
    before,
    after,
  )
}

// [SP_CTX_02_57] The probe process's counts, in its working folder.
async function writeCounts($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd().catch(() => undefined)
  probeCounts.version = await hostVersion($)
  if (cwd) await $.fs.write(`${cwd}/${PROBE_FILE}`, JSON.stringify(probeCounts)).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: no storage, repair, sweep, probe or tools
    if (await isProbe($)) return next(e)
    // [SP_CTX_01_14] the identity's one read starts here or in the first PrepareStorage
    void hostIdOf($)
    for (const tool of TOOLS) await $.tool.register(tool)
    await $.command.register(HANDOFF_COMMAND)
    await prepareStorage($)
    // [SP_CTX_02_53] [SP_CTX_02_56] the cached verdicts of this host version, or a probe
    await loadCapabilities($).catch(() => undefined)
    // [SP_CTX_02_46] [SP_CTX_02_54] a new host process (--resume, a restart, an
    // IDE opening the session): the repair's one attempt, planned at the end
    // of the first turn, once the compaction hook's verdict is known
    repairAtStart(repairMem)
    // [SP_CTX_02_50] the sweep of old sessions, in the background
    void $.clock.after(SWEEP_DELAY_MS, () => runSweep($).catch(() => undefined))
    return next(e)
  })

  // [SP_CTX_02_01]
  on('tool.call', { tool: 'mcp__context-editor__context_list' }, async ($, e) => {
    const out = await contextList(listIO($), { ...(e as unknown as ListArgs), agentId: e.agentId })
    return 'deny' in out ? deny(out.deny) : out
  }).catch(($, e, next) => (next.called ? next(e) : deny(`listing failed: ${next.error.kind}`)))

  // [SP_CTX_02_02]
  on('tool.call', { tool: 'mcp__context-editor__context_edit' }, async ($, e) => {
    if (e.agentId) return deny("a subagent's context cannot be edited; only the main conversation's.")
    // [SP_CTX_02_54] DENIED_PASSED_OVER, before the queue is read
    if (isPassed(caps)) return deny(EDIT_PASSED_OVER)
    const st = await ensureStorage($)
    if ('reason' in st) return deny(storageRefusal(st.reason))
    const { dir } = st
    const args = e as unknown as { edits?: unknown; resume?: unknown; resume_prompt?: unknown; keep_cache?: unknown }
    const out = await stores($, dir).queue.onChain(async held => {
      const snap = snapshot($)
      const { rows, key } = await snap.view()
      // [SP_CTX_02_10] the API form is read only for a describe
      const found = needsApi(args) ? collectMedia(await snap.api(), rows).found : undefined
      const pins = pinsFrom(await stores($, dir).tags.read(), rows)
      // [SP_CTX_DEC_37] an accepted edit ends the waiting block (the registry's
      // chain inside the queue's) and queues its disposable replacements on
      // the queue's chain this call holds
      const io: QueueIO = {
        ...queueIO($, dir),
        endWaiting: async () => {
          let name: string | undefined
          await changeOf(stores($, dir).tags, held)(read => {
            const ended = read.state === 'unreadable' ? undefined : endWaiting(read.value)
            if (ended) name = blockName(ended.block)
            return ended?.registry
          })
          return name
        },
        // [SP_CTX_02_58] the tags over the person's words leave the registry on its chain
        replace: () =>
          queueTagReplacements({ ...tagIO($, dir, snap), onRegistry: work => chainOf($, 'tags')(() => work(), held), deliveries: () => deliveredNow($, dir, held) }),
      }
      return contextEdit(io, rows, args, pins, await resolver($, dir, e.tool_use_id), listed.key !== key, hasMediaFrom(found), await deliveredNow($, dir, held))
    })
    // [SP_CTX_02_33] no reminder: this call goes with the apply it triggers (DropOwnCalls)
    return 'deny' in out ? deny(out.deny) : out
  }).catch(($, e, next) => (next.called ? next(e) : deny(`queueing failed: ${next.error.kind}`)))

  // [SP_CTX_02_11]
  on('tool.call', { tool: 'mcp__context-editor__context_tag' }, async ($, e) => {
    const args = e as unknown as TagArgs
    // [PL_AUD_CTX_P11] one read of the conversation for the whole call: the
    // stale check, the requests, the replacements and the close reports
    const snap = snapshot($)
    const { dir, down, refs, stale } = await registryCall($, e, snap)
    // the registry's read-modify-write on its chain; the replacements on the
    // queue's afterwards, which may take the registry's chain inside it to
    // drop a tag over the person's words (queue → tags); the deliveries read
    // inside the registry's chain (tags → deliveries)
    let held: Held | undefined
    const { rows: _rows, ...registry } = tagIO($, dir, snap)
    const io = tagCallIO(
      snap,
      {
        ...registry,
        onRegistry: work =>
          chainOf($, 'tags')(h => {
            held = h
            return work().finally(() => (held = undefined))
          }),
        deliveries: () => deliveredNow($, need(dir), held),
      },
      work => chainOf($, 'queue')(work),
      () => blockHost($, need(dir)),
    )
    const out = await contextTag(io, { agentId: e.agentId, tags: args.tags }, down, refs, stale, typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined)
    return 'deny' in out ? deny(out.deny) : remindAfter($, TAG, e.agentId, { result: out.result })
  }).catch(($, e, next) => (next.called ? next(e) : deny(`tagging failed: ${next.error.kind}`)))

  // [SP_CTX_02_32] The registry's read-modify-write on its chain. A regex, as
  // for context_handoff: the host's generated types list a new tool only once
  // a session has loaded it.
  on('tool.call', { tool: /^mcp__context-editor__context_note$/ }, async ($, e) => {
    const args = e as unknown as NoteArgs
    const snap = snapshot($)
    const { dir, down, refs, stale } = await registryCall($, e, snap)
    const out = await contextNote({ ...tagIO($, dir, snap), onRegistry: work => chainOf($, 'tags')(work) }, { agentId: e.agentId, notes: args.notes }, down, refs, stale)
    return 'deny' in out ? deny(out.deny) : remindAfter($, NOTE, e.agentId, { result: out.result })
  }).catch(($, e, next) => (next.called ? next(e) : deny(`noting failed: ${next.error.kind}`)))

  // [SP_CTX_02] The turn counter: every turn of the main conversation counts;
  // the mod's own commands raise no turn events.
  on('turn.start', async ($, e, next) => {
    turnStarted(turns)
    // [SP_CTX_02_12] the copies of the last compaction came before this turn
    copied.clear()
    return next(e)
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_19] It only queues the request: the end of the turn runs it. A
  // regex: the host's generated types do not list this tool until a session
  // has loaded it; a string literal is the goal once they do.
  on('tool.call', { tool: /^mcp__context-editor__context_handoff$/ }, async ($, e) => {
    const out = await contextHandoff(handoffIO($), handoff, { ...(e as unknown as HandoffArgs), agentId: e.agentId })
    // [SP_CTX_02_33] no reminder: the seed drops this call (DropOwnCalls)
    return 'deny' in out ? deny(out.deny) : out
  }).catch(($, e, next) => (next.called ? next(e) : deny(`handoff failed: ${next.error.kind}`)))

  // [SP_CTX_02_20] A handler no turn waits on: its deferred action may run commands.
  on('command.run', { command: 'handoff' }, async ($, e) => ({ text: await handoffCommand(handoffIO($), handoff, e.args) })).catch(($, e, next) =>
    // [SP_CTX_02_20] no mod prefix: the host shows the reply under the plugin's name
    next.called ? next(e) : { text: `handoff failed: ${next.error.kind}` },
  )

  // [SP_CTX_02_42] The person's plain /compact: the agent compresses in a
  // compression turn; `/compact host` runs the host's summary; other args
  // and every plugin's run (the mod's MARKER, HANDOFF_MARKER) pass unchanged.
  // A run the host raised beneath the mod's own $.command.run skips this hook
  // (re-entry): the handler lets it through, as it does after `next`.
  on('command.run', { command: 'compact' }, async ($, e, next) => {
    const out = await personCompact(personCompactIO($, () => next.signal.aborted), e, () => isPlanned(flushState, Date.now()))
    if ('text' in out) return { text: out.text }
    if (!out.brief) return out.next === e.args ? next(e) : next({ ...e, args: out.next })
    // [SP_CTX_02_55] the host's summary under the brief, then ObservePassedCompact
    const before = await $.session.messages().catch(() => undefined)
    const seen = caps.passSeen
    const done = await next({ ...e, args: out.next })
    // the handler saw it after all: its observer did the work
    if (before && caps.passSeen === seen) await observeBrief($, before).catch(() => undefined)
    return done
  }).catch(($, e, next) => {
    const out = compactFailure(e, { called: next.called, kind: next.error.kind })
    return 'next' in out ? next(e) : out
  })

  // [SP_CTX_02_12] [SP_CTX_02_35] AppendRow: the row is stored first and
  // returned unchanged; RecordDelivery and the rules run after it, in the
  // background, each on its chain in the folder asked for at the event.
  on('session.append', async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: the doors are counted, the row stored unchanged
    if (await isProbe($)) {
      probeCounts.doors[e.door] = (probeCounts.doors[e.door] ?? 0) + 1
      return next(e)
    }
    // [SP_CTX_02_49] a subagent's big tool result is cut before it is stored
    const row = e.agentId && e.door === 'tool-result' ? await shapeSubagentResult(shapeIO($), e).catch(() => e) : e
    return appendRow(
      {
        // observeAppend is sync and reads pinned fields only
        observe: () => observeAppend(anchorMem, row, Date.now()),
        storage: () => storageNow($),
        record: (at, item) =>
          void chainOf($, 'deliveries')(async () => {
            const dir = await at
            if (dir) await recordDelivery(stores($, dir).deliveries, item, MAX_QUEUE_BYTES)
          }).catch(() => undefined),
        autoTag: (at, facts, copy) =>
          void chainOf($, 'tags')(async () => {
            const dir = await at
            if (dir) await autoTag(tagIO($, dir), facts, copy)
          }).catch(() => undefined),
        copied,
      },
      row,
      () => next(row),
    )
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02] [SP_CTX_02_30] [SP_CTX_02_12] [SP_CTX_02_06] [SP_CTX_02_21]
  // The end of a turn of the main conversation: the counter first; then, in
  // the background, AfterTurn (DetectOptimize, the turn count, Flush; the
  // handoff besides).
  on('turn.complete', async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: the counts file, read by RunProbe
    if (await isProbe($)) {
      await writeCounts($)
      return next(e)
    }
    // nothing starts while the turn ends: the counter moves whatever `next` does
    if (!e.agentId) turnCompleted(turns, e.isAborted)
    const done = await next(e)
    if (e.agentId) return done
    void afterTurn(
      {
        capabilities: (aborted, at) => capabilitiesAtTurnEnd($, aborted, at),
        storage: () => storageDir($),
        detect: (dir, end) => detectOptimize(detectIO($, dir), end),
        countTurn: dir => stores($, dir).tags.onChain(() => countTurn(tagIO($, dir))),
        repair: () => repairAtTurnEnd(repairIO($), repairMem),
        flush: aborted => flushAfterTurn(flushIO($), flushState, aborted),
        handoff: aborted => handoffAfterTurn(handoffIO($), handoff, aborted),
      },
      { aborted: e.isAborted, answer: e.answer },
    ).catch(() => undefined)
    // [SP_CTX_02_40] the first turn end after an apply that predicted new copies
    verifyAttachments($, storageNow($))
    return done
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_07] [SP_CTX_02_26] The mod's own compactions, by `instructions`,
  // under any trigger but precompute. [SP_CTX_02_18] Any other compaction of
  // the main conversation that stands moves its start too; a precomputed one
  // stands only when it is used. (One hook: the host takes one unmatched
  // `session.compact` hook per module.)
  on('session.compact', async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: the probe's marker is answered with the counts
    if (e.instructions === PROBE_MARKER && (await isProbe($))) {
      await writeCounts($)
      return { skip: probeSkip(probeCounts) }
    }
    const route = compactionRoute(e)
    // [SP_CTX_02_53] the handler got one of the mod's own markers, or another
    // compaction of the main conversation: the hook is called
    if (route !== 'pass') ownCompactionSeen($)
    else if (!e.agentId && e.trigger !== 'precompute') passCompactionSeen($)
    if (route === 'pass') {
      const done = await next(e)
      await observeCompaction(
        {
          copies: noteCopies,
          hostId: () => peekHostId(hostId),
          storage: () => storageDir($, true),
          writeBoundary: (dir, b) => writeBoundaryAt($, dir, b),
          updateTags: dir => updateOf(stores($, dir).tags),
          // [SP_CTX_02_41] a compaction that stands replaced the attachments
          attachments: { passed: () => voidAnswers(attachMem), clear: dir => updateOf(stores($, dir).hostattach)(clearedAnswers) },
        },
        e,
        done,
      )
      return done
    }
    if (route === 'seed') {
      const seeded = await handleSeed(seedIO($), handoff, e.messages)
      if ('messages' in seeded) {
        noteCopies(seeded.messages)
        // [SP_CTX_02_39] the seeded session's attachments are asked anew
        resetPass(attachMem)
        // [SP_CTX_02_46] the seeded rows have no handle: nothing to repair here
        if (!next.signal.aborted) repairMem.compactedHere = await $.session.id()
      }
      return seeded
    }
    if (route === 'repair') {
      const dir = await storageDir($, true)
      if (!dir) return { skip: REPAIR_SKIP.storage }
      const session = await $.session.id()
      const s = stores($, dir)
      const archives = await archivesOf($, dir)
      const done = await s.queue.onChain(q =>
        handleRepair(
          {
            dir,
            archives,
            now: () => Date.now(),
            handoffRunning: () => handoff.inFlight,
            readLedger: s.ledger.read,
            readJournal: s.journal.read,
            readApi: () => apiMessages($),
            writeMedia: (path, data) => writeMedia($, path, data),
            readDeliveries: () => s.deliveries.onChain(() => s.deliveries.read(), q),
            isAborted: () => next.signal.aborted,
            toast: text => $.ui.toast(text),
            readTags: s.tags.read,
            writeTags: s.tags.write,
            readAliases: s.aliases.read,
            writeAliases: s.aliases.write,
            onRegistries: work => s.tags.onChain(t => s.aliases.onChain(a => work(a), t), q),
            hostId: () => peekHostId(hostId),
            writeBoundary: b => writeBoundaryAt($, dir, b),
            clearLedger: () => void s.ledger.update<'change'>(() => emptyLedger(), { onUnreadable: 'change' }).catch(() => undefined),
            markClean: () => void s.ledger.update(read => cleanLedger(read.value)).catch(() => undefined),
            pruneDeliveries: gone => void s.deliveries.onChain(() => pruneDeliveries(s.deliveries, gone), q).catch(() => undefined),
          },
          e.messages,
        ),
      )
      if ('messages' in done.outcome && !next.signal.aborted) {
        noteCopies(done.outcome.messages)
        // [SP_CTX_02_39] the host asks every attachment again; the decisions stay
        resetPass(attachMem)
        repairMem.compactedHere = session
        if (done.summary) repairMem.last = { session, ...done.summary }
      }
      return done.outcome
    }
    applies.dir = undefined
    const dir = await storageDir($, true)
    if (!dir) return { skip: modText('storage unavailable') }
    applies.dir = dir
    const session = await $.session.id()
    // [SP_CTX_02_07] the report counts as the apply's only once the handler
    // returned without an abandon; set on the queue's chain, before the
    // failure branch's write queued behind it reads it
    let wrote: number | undefined
    let line: string | undefined
    const s = stores($, dir)
    const archives = await archivesOf($, dir)
    const cwd = await $.session.cwd().catch(() => undefined)
    const outcome = await s.queue.onChain(async q => {
      const done = await handleCompaction(
        {
          dir,
          archives,
          ...(cwd ? { cwd } : {}),
          now: () => Date.now(),
          readQueue: s.queue.read,
          writeQueue: s.queue.write,
          readApi: () => apiMessages($),
          writeMedia: (path, data) => writeMedia($, path, data),
          writeArchive: (path, text) => writeText($, path, text),
          isAborted: () => next.signal.aborted,
          toast: text => $.ui.toast(text),
          readTags: s.tags.read,
          writeTags: s.tags.write,
          readAliases: s.aliases.read,
          writeAliases: s.aliases.write,
          // [SP_CTX_02_07] the commit holds the registry's chain, then the
          // alias registry's, inside the queue's: the order queue → tags → aliases
          onRegistries: work => s.tags.onChain(t => s.aliases.onChain(a => work(a), t), q),
          reported: (id, text) => {
            wrote = id
            line = text
          },
          writeBoundary: b => writeBoundaryAt($, dir, b),
          hostId: () => peekHostId(hostId),
          // [SP_CTX_02_07] the plain usage: no breakdown, no API request
          requestTokens: () => requestTokens($),
          // [SP_CTX_02_31] on the journal's chain, never awaited here
          journal: entry => onJournal($, io => journalApply(io, entry), dir),
          // [SP_CTX_02_07] [SP_CTX_02_36] on the deliveries' chain
          readDeliveries: () => s.deliveries.onChain(() => s.deliveries.read(), q),
          pruneDeliveries: done => void s.deliveries.onChain(() => pruneDeliveries(s.deliveries, done), q).catch(() => undefined),
          // [SP_CTX_02_40] the host attachments' decisions of this apply
          attachments: attachPort(attachMem, { store: s.hostattach, readFile: path => readFileText($, path) }),
          // [SP_CTX_02_45] [SP_CTX_02_44] the originals a resume put back, and this apply's inputs
          readPulled: () => pulledAt($, dir),
          compactedHere: () => repairMem.compactedHere === session,
          recordInputs: (messages, id) => recordInputsAt($, dir, messages, id),
        },
        e.messages,
      )
      if (wrote !== undefined && !next.signal.aborted) {
        applies.reported = wrote
        applies.line = line !== undefined ? { id: wrote, text: line } : undefined
      }
      return done
    })
    if ('messages' in outcome) {
      noteCopies(outcome.messages)
      // [SP_CTX_02_46] this process now reads originals + copies
      if (!next.signal.aborted) repairMem.compactedHere = session
    }
    return outcome
  }).catch(($, e, next) => {
    // Never let a failure fall through to a real, summarizing compaction:
    // answer at once, and record a failed batch in the background, in the
    // apply's folder.
    const out = compactionFailed(
      {
        dir: applies.dir ?? publishedDir(storage),
        reported: applies.reported,
        now: () => Date.now(),
        changeQueue: (dir, change) => changeOf(stores($, dir).queue)(change),
      },
      e,
      next.error.kind,
    )
    return 'pass' in out ? next(e) : out
  })

  // [SP_CTX_02_16] After any other tool call of the main loop: the alias line
  // of a call worth editing, then on a marked output the suggestion of the
  // size channel, a line of its own ([SP_CTX_02_37]; it only informs), then
  // the due reminders of the agent's own notes ([SP_CTX_02_33]). It never
  // changes the result itself; a failure only drops its line. The alias
  // chain, then the registry's chain, one after the other.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || done.deny !== undefined || String(e.tool).startsWith(OWN_TOOLS)) return done
    const facts = callFacts(e, done)
    if (!remindable(facts)) return done
    const lines: string[] = []
    const marked = wantsMark(facts)
    // [SP_CTX_01_07] the folder of the session the call ran in, taken now
    const alias = marked
      ? await storageNow($)
          .then(dir => chainOf($, 'aliases')(() => markAlias(aliasIO($, dir), facts)))
          .catch(() => undefined)
      : undefined
    const hint = marked ? await hintFor($).catch(() => undefined) : undefined
    lines.push(...callLines(marked, alias, hint))
    lines.push(...(await dueLines($)))
    // [SP_CTX_02_16] R4, R6 and the journal in the background, queued only once the
    // lines are built: the result waits for neither (the reminders above share
    // the registry's chain with R4)
    afterCall($, String(e.tool), e as unknown as Record<string, unknown>, facts.tool_use_id!, done.isError === true, done.text)
    return withContext(done, lines)
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_39] The host's copies of instruction files and skill listings
  // in the main loop, answered from the decisions in force; every other
  // attachment (a `*_delta`, hook context) has no hook here. A failure keeps
  // the attachment.
  // [SP_CTX_02_53] [SP_CTX_02_57] Every attachment, any type and origin, only
  // counted: the host calls the mod's attachment hooks at all (NoteAttachment)
  on('prompt.attachment', async ($, e, next) => {
    if (await isProbe($)) probeCounts.attachments++
    else noteAttachment(caps)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('prompt.attachment', { type: 'instructions' }, async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: no storage
    if (await isProbe($)) return next(e)
    const a = await attachmentAnswer(attachMem, attachIO($), e)
    return 'keep' in a ? next(e) : a.text === null ? { text: null } : next({ ...e, text: a.text })
  }).catch(($, e, next) => next(e))
  on('prompt.attachment', { type: 'nested_memory' }, async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: no storage
    if (await isProbe($)) return next(e)
    const a = await attachmentAnswer(attachMem, attachIO($), e)
    return 'keep' in a ? next(e) : a.text === null ? { text: null } : next({ ...e, text: a.text })
  }).catch(($, e, next) => next(e))
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: no storage
    if (await isProbe($)) return next(e)
    const a = await attachmentAnswer(attachMem, attachIO($), e)
    return 'keep' in a ? next(e) : a.text === null ? { text: null } : next({ ...e, text: a.text })
  }).catch(($, e, next) => next(e))

  // [SP_CTX_02_08] [SP_CTX_02_27] The next prompt of the person (or another
  // plugin) carries the session intro once, the report, the advice of an
  // unserved /compact request or WaitingAdvice of a marked block; each leaves only once that prompt has
  // entered. The host skips this hook for prompts the mod submits itself.
  on('prompt.submit', async ($, e, next) => {
    // [SP_CTX_02_57] ProbeMode: no guide, advice or hint
    if (await isProbe($)) return next(e)
    // [SP_CTX_02_52] a sweep of another process packed this session's storage
    const st = storage.state
    if (await needsRestore({ exists: path => $.fs.exists(path).catch(() => false) }, dirOf(st), 'reason' in st ? st.reason : undefined)) await prepareStorage($)
    const dir = await storageDir($)
    if (!dir) return next(e)
    const s = stores($, dir)
    return deliverReport({
      readQueue: s.queue.read,
      intro: async () => {
        const reg = await s.tags.cached()
        return introFor(reg, reg.state !== 'unreadable' && !reg.value.introduced ? await skillGuide($) : undefined)
      },
      // [SP_CTX_02_54] no WaitingAdvice of a tool that refuses; the block stays marked
      advice: async () => (isPassed(caps) ? undefined : adviceFor(await s.tags.cached())),
      advised: async () => void (await changeOf(s.tags)(adviseWaiting)),
      inTurn: () => turns.inTurn,
      enter: context => (context.length ? next({ ...e, context: [...(e.context ?? []), ...context] }) : next(e)),
      markIntroduced: async () => void (await changeOf(s.tags)(withIntroduced)),
      // [SP_CTX_02_08] DeliverReport's write once the prompt entered: the
      // report, the optimization request and the loop guard, on the queue's
      // chain, in the storage the prompt's delivery read
      settle: async done => void (await updateOf(s.queue)(q => settledQueue(q, done))),
      // [SP_CTX_02_37] the turn channel, between turns only
      suggestion: () => suggestionFor($, dir),
    })
  }).catch(($, e, next) => next(e))
}
