// [SP_CTX_02_53]–[SP_CTX_02_57] [C_CTX_DEC_31] [SP_CTX_DEC_38] The host's
// capabilities the mod depends on: whether its session.compact hook gets the
// mod's own compactions (`compact`) and whether its prompt.attachment hooks
// are called (`attachments`). A host may pass a plugin's hooks over (2.1.299+
// seats cc-plugin-sec-default outermost for Team/Enterprise accounts and
// managed settings): then the mod's MARKER /compact would become the host's
// real summary. The verdict comes from live signals of this process, a probe
// process run once per host version, and a cache by host version. Pure:
// register.ts binds the ports to `$`.
import type { SessionMessage } from 'claude-code'
import { SUMMARY_OPENER } from './deliveries'
import { fingerprint, locate, oneLine, type Boundary, type QueuedEdit } from './edits'
import type { Note } from './notes'
import type { Queue } from './queue'
import { errorText, findToolUse, modText, PROBE_MARKER, REPLACED } from './rows'
import { dropLastApply, isRange, pruneDeadTags, type TagRegistry } from './tags'

export { PROBE_MARKER }

// [SP_CTX_01_12] The probe ([SP_CTX_02_56]).
export const PROBE_DELAY_MS = 1000
export const PROBE_TIMEOUT_MS = 60_000
export const PROBE_WAIT_MS = 15_000
export const PROBE_PREFIX = 'context-editor-probe:'
export const PROBE_FILE = 'probe-counts.json'
export const CAP_CACHE_VERSIONS = 5
export const CAP_CACHE_FILE = 'capabilities.json'
// [SP_CTX_01_12] CompactBrief ([SP_CTX_02_55]).
export const BRIEF_MAX = 12_000
export const BRIEF_HEAD = 'Summarize this conversation for the agent that goes on with it. Keep every message of the person verbatim.'
export const BRIEF_RECORDS = `Keep verbatim the texts that start with "${REPLACED}": they are the agent's own records.`
// [SP_CTX_01_12] [SP_CTX_02_54] The texts of the mod when `compact` is passed over.
export const PASSED_ADVICE = "Compression is off on this host (context_edit refuses: the host passes over the mod's compaction hook); keep working."
export const EDIT_PASSED_OVER =
  "this host passes over the mod's compaction hook, so queued edits would become the host's real summary; nothing was queued. Keep working; the person can run the mod as a managed plugin, or run /compact for the host's summary with the mod's brief."
export const HANDOFF_TOOL_PASSED_OVER = "this host passes over the mod's compaction hook, so the handoff cannot seed a new session; nothing was queued."
export const HANDOFF_COMMAND_PASSED_OVER = 'handoff is off: this host passes over the mod\'s compaction hook (see the ClaudeMods README, section "Managed plugin")'
export const HANDOFF_PASSED_OVER = modText("handoff not run: this host passes over the mod's compaction hook.")

export type Capability = 'compact' | 'attachments'
export type CapVerdict = 'reached' | 'passed'
export type CapMap = Partial<Record<Capability, CapVerdict>>
const CAPS: readonly Capability[] = ['compact', 'attachments']

// [SP_CTX_01_25] Module memory: one per host process (a session switch keeps
// it, a reload of the module starts it over).
export type Capabilities = {
  attachments: number
  mainTurns: number
  live: CapMap
  probe: CapMap
  cache: CapMap
  probeState: 'none' | 'planned' | 'running' | 'done'
  version?: string
  // the capabilities PassedText has named in this process
  noticed: Capability[]
  // compactions of the mod's own markers this process's handler saw (NoteCommandUnseen compares)
  ownSeen: number
  // other compactions of the main conversation the handler saw (they prove `compact` too)
  passSeen: number
  // settled once the probe of this process ends; absent: none planned
  probeDone?: Promise<void>
  settle?: () => void
}

export function newCapabilities(): Capabilities {
  return { attachments: 0, mainTurns: 0, live: {}, probe: {}, cache: {}, probeState: 'none', noticed: [], ownSeen: 0, passSeen: 0 }
}

// [SP_CTX_02_53] live → probe → cache → unknown.
export function verdict(c: Capabilities, cap: Capability): CapVerdict | 'unknown' {
  return c.live[cap] ?? c.probe[cap] ?? c.cache[cap] ?? 'unknown'
}

export function isPassed(c: Capabilities, cap: Capability = 'compact'): boolean {
  return verdict(c, cap) === 'passed'
}

export function passedCaps(c: Capabilities): Capability[] {
  return CAPS.filter(cap => isPassed(c, cap))
}

// [SP_CTX_02_53] Any attachment of any type and origin reached the mod.
export function noteAttachment(c: Capabilities): void {
  c.attachments++
  c.live.attachments = 'reached'
}

// [SP_CTX_02_53] The end of a main-conversation turn not aborted: the host
// asks the attachments at the start of every prompt, and the mod's skill
// gives a skill listing in every session.
export function noteTurn(c: Capabilities): void {
  c.mainTurns++
  c.live.attachments = c.attachments > 0 ? 'reached' : 'passed'
}

// [SP_CTX_02_53] The mod's handler saw its own marker (MARKER, HANDOFF_MARKER, REPAIR_MARKER).
export function noteOwnCompaction(c: Capabilities): void {
  c.ownSeen++
  c.live.compact = 'reached'
}

// [SP_CTX_02_53] Another compaction of the main conversation (not
// precomputed) reached the handler: the hook is called.
export function notePassCompaction(c: Capabilities): void {
  c.passSeen++
  c.live.compact = 'reached'
}

// [SP_CTX_02_53] The mod's compaction command returned without a throw and
// its handler never saw the marker: the host gave it to another (a real
// summary has happened already; the signal comes only after the fact).
export function noteCommandUnseen(c: Capabilities): void {
  c.live.compact = 'passed'
}

// [SP_CTX_01_26] The cache file: verdicts by host version.
export type CapEntry = CapMap & { at: number; source: 'probe' | 'live' }
export type CapCache = { entries: Record<string, CapEntry> }

function isVerdict(v: unknown): v is CapVerdict {
  return v === 'reached' || v === 'passed'
}

// An unreadable file reads as empty: the next write replaces it.
export function parseCapCache(text: string | undefined): CapCache {
  const entries: Record<string, CapEntry> = {}
  if (!text) return { entries }
  try {
    const raw = (JSON.parse(text) as { entries?: unknown } | null)?.entries
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { entries }
    for (const [version, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const e = v as Record<string, unknown>
      if (typeof e.at !== 'number' || (e.source !== 'probe' && e.source !== 'live')) continue
      const entry: CapEntry = { at: e.at, source: e.source }
      for (const cap of CAPS) if (isVerdict(e[cap])) entry[cap] = e[cap] as CapVerdict
      entries[version] = entry
    }
  } catch {
    // unreadable: empty
  }
  return { entries }
}

export function capsOf(entry: CapEntry | undefined): CapMap {
  const out: CapMap = {}
  if (entry) for (const cap of CAPS) if (entry[cap]) out[cap] = entry[cap]
  return out
}

// At most CAP_CACHE_VERSIONS versions: the oldest `at` go first.
export function cacheWith(cache: CapCache, version: string, entry: CapEntry, max = CAP_CACHE_VERSIONS): CapCache {
  const entries = { ...cache.entries, [version]: entry }
  const keys = Object.keys(entries).sort((a, b) => entries[b]!.at - entries[a]!.at)
  for (const k of keys.slice(max)) delete entries[k]
  return { entries }
}

export function cacheWithout(cache: CapCache, version: string): CapCache {
  const { [version]: _gone, ...entries } = cache.entries
  return { entries }
}

function sameCaps(a: CapMap, b: CapMap): boolean {
  return CAPS.every(cap => a[cap] === b[cap])
}

// What Merge needs; register.ts binds it.
export type CapabilityIO = {
  // the whole cache file; a failure reads as empty
  readCache: () => Promise<CapCache>
  writeCache: (cache: CapCache) => Promise<unknown>
  now: () => number
  // a new probe in this process (one per process)
  scheduleProbe: () => void
  debug?: (text: string) => void
}

// [SP_CTX_02_53] Merge, after each change of `live` or `probe`: a cache that
// contradicts a live signal goes (the mod was made a managed plugin, the
// organization's settings changed) and a probe runs anew; then the known
// verdicts go into the cache when they changed. No version: nothing cached.
export async function merge(io: CapabilityIO, c: Capabilities, source: CapEntry['source']): Promise<void> {
  if (!c.version) return
  const version = c.version
  try {
    let cache = await io.readCache()
    let changed = false
    if (CAPS.some(cap => c.live[cap] && c.cache[cap] && c.live[cap] !== c.cache[cap])) {
      cache = cacheWithout(cache, version)
      c.cache = {}
      changed = true
      io.scheduleProbe()
    }
    const known: CapMap = {}
    for (const cap of CAPS) {
      const v = verdict(c, cap)
      if (v !== 'unknown') known[cap] = v
    }
    if (Object.keys(known).length && !sameCaps(known, capsOf(cache.entries[version]))) {
      cache = cacheWith(cache, version, { ...known, at: io.now(), source })
      changed = true
    }
    if (changed) await io.writeCache(cache)
    c.cache = capsOf(cache.entries[version])
  } catch (err) {
    io.debug?.(modText(`capabilities not cached: ${errorText(err)}`))
  }
}

// [SP_CTX_02_53] The person's one line per process.
export function passedText(caps: readonly Capability[], queued: number): string {
  const names = caps.includes('compact') && caps.includes('attachments') ? 'compaction and attachment' : caps.includes('compact') ? 'compaction' : 'attachment'
  let text = modText(
    `this host passes over the mod's ${names} hooks (seen with the built-in cc-plugin-sec-default on host 2.1.299+ with a Team or Enterprise account or managed settings).`,
  )
  if (caps.includes('compact')) {
    text += ' The mod does not compress: context_edit, context_handoff and /handoff refuse, and /compact runs the host\'s summary with the mod\'s brief.'
    if (queued > 0) text += ` ${queued} queued edit(s) stay; /compact passes them on as preferred summaries.`
  }
  if (caps.includes('attachments')) text += ' Stale copies of instruction files stay in each request.'
  return text + ' To fix it, run the mod as a managed plugin (the ClaudeMods README, section "Managed plugin").'
}

// [SP_CTX_02_53] At a turn end: the line when a capability not named yet in
// this process is passed over (each one once per process). Undefined: nothing to say.
export function noticeOnce(c: Capabilities, queued: number): string | undefined {
  const caps = passedCaps(c)
  if (!caps.some(cap => !c.noticed.includes(cap))) return undefined
  c.noticed = [...new Set([...c.noticed, ...caps])]
  return passedText(caps, queued)
}

// [SP_CTX_02_56] A session start plans a probe unless the cache holds a
// probe's verdict on `compact` for this version: an entry written from live
// signals alone (a failed probe, NoteCommandUnseen) is confirmed again.
export function needsProbe(entry: CapEntry | undefined): boolean {
  return !entry || entry.compact === undefined || entry.source !== 'probe'
}

// [SP_CTX_02_56] `/proc/$PPID/exe` is the host's binary unless the host runs
// under a runtime (node): then `claude` from PATH.
export function hostBinary(exe: string | undefined): string {
  const path = exe?.trim()
  const base = path?.split('/').pop() ?? ''
  return path && (/claude/i.test(base) || /^\d+\.\d+\.\d+/.test(base)) ? path : 'claude'
}

// ---- [SP_CTX_02_56] RunProbe

export type ProbeRun = { stdout: string; exitCode: number }

// What RunProbe needs; register.ts binds it.
export type ProbeIO = {
  // a deferred action (from session.start)
  after: (ms: number, fn: () => void) => void
  // `sh -c 'readlink /proc/$PPID/exe'`: the host's own binary; undefined: none
  hostExe: () => Promise<string | undefined>
  // `mktemp -d`
  tempDir: () => Promise<string>
  run: (argv: readonly string[], init: { cwd: string; env: Record<string, string>; stdin: string; timeoutMs: number }) => Promise<ProbeRun>
  readFile: (path: string) => Promise<string | undefined>
  // removes the paths (rm -rf); a failure only goes to the debug log
  remove: (paths: readonly string[]) => Promise<unknown>
  // <CLAUDE_CONFIG_DIR or ~/.claude>/projects
  projectsDir: () => Promise<string | undefined>
  pluginRoot: string
  merge: () => Promise<unknown>
  debug?: (text: string) => void
}

export const PROBE_ENV: Readonly<Record<string, string>> = {
  CONTEXT_EDITOR_PROBE: '1',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  CLAUDE_CODE_MAX_RETRIES: '0',
  DISABLE_AUTOUPDATER: '1',
}

// [SP_CTX_DEC_38] (а): a managed mod ignores the copy of --plugin-dir.
export function probeArgs(exe: string, pluginRoot: string): string[] {
  return [exe, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--model', 'haiku', '--plugin-dir', pluginRoot]
}

// A compaction needs a turn first; the turn ends at once (an unreachable API).
export function probeInput(): string {
  const msg = (content: string) => JSON.stringify({ type: 'user', message: { role: 'user', content } })
  return `${msg('hi')}\n${msg(`/compact ${PROBE_MARKER}`)}\n`
}

// The host's project folder for a working directory.
export function projectDir(projects: string, cwd: string): string {
  return `${projects}/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
}

// [SP_CTX_02_57] What the mod in the probe process counted.
export type ProbeCounts = { version?: string; attachments: number; doors: Record<string, number> }

export function parseCounts(text: string | undefined): ProbeCounts | undefined {
  if (!text) return undefined
  try {
    const v = JSON.parse(text) as Partial<ProbeCounts> | null
    if (!v || typeof v.attachments !== 'number') return undefined
    return { ...(typeof v.version === 'string' ? { version: v.version } : {}), attachments: v.attachments, doors: v.doors && typeof v.doors === 'object' ? v.doors : {} }
  } catch {
    return undefined
  }
}

export type ProbeResult = CapMap & { version?: string }

// [SP_CTX_02_56] The last stream-json `result` and the counts file. The mod's
// handler answers the marker with `skip`: "Not compacted · <PROBE_PREFIX> {counts}".
export function parseProbe(stdout: string, file: string | undefined): ProbeResult | undefined {
  let result: string | undefined
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const v = JSON.parse(line) as { type?: unknown; result?: unknown } | null
      if (v?.type === 'result') result = typeof v.result === 'string' ? v.result : JSON.stringify(v.result ?? '')
    } catch {
      // not a JSON line
    }
  }
  let counts = parseCounts(file)
  const at = result?.indexOf(PROBE_PREFIX) ?? -1
  if (at >= 0 && !counts) counts = parseCounts(result!.slice(at + PROBE_PREFIX.length).trim())
  const out: ProbeResult = {}
  if (result !== undefined) out.compact = at >= 0 ? 'reached' : 'passed'
  if (counts) out.attachments = counts.attachments > 0 ? 'reached' : 'passed'
  if (counts?.version) out.version = counts.version
  return out.compact || out.attachments ? out : undefined
}

// [SP_CTX_02_56] One probe per process, PROBE_DELAY_MS after its planning.
export function scheduleProbe(io: Pick<ProbeIO, 'after'>, c: Capabilities, run: () => Promise<unknown>): boolean {
  if (c.probeState !== 'none') return false
  c.probeState = 'planned'
  c.probeDone = new Promise<void>(resolve => (c.settle = resolve))
  try {
    io.after(PROBE_DELAY_MS, () => void run().catch(() => undefined))
  } catch {
    c.probeState = 'done'
    c.settle?.()
    return false
  }
  return true
}

// [SP_CTX_02_56] RunProbe. PROBE_FAILED and PROBE_NO_RESULT leave `probe`
// empty; PROBE_OTHER_HOST discards the result; the folders go in any case.
export async function runProbe(io: ProbeIO, c: Capabilities): Promise<ProbeResult | undefined> {
  c.probeState = 'running'
  let tmp: string | undefined
  let r: ProbeResult | undefined
  try {
    const exe = hostBinary(await io.hostExe().catch(() => undefined))
    tmp = (await io.tempDir()).trim()
    if (!tmp) throw new Error('no temporary folder')
    const out = await io.run(probeArgs(exe, io.pluginRoot), { cwd: tmp, env: { ...PROBE_ENV }, stdin: probeInput(), timeoutMs: PROBE_TIMEOUT_MS })
    r = parseProbe(out.stdout, await io.readFile(`${tmp}/${PROBE_FILE}`).catch(() => undefined))
    if (!r) io.debug?.(modText(`probe: no result (exit ${out.exitCode})`))
    else if (r.version && c.version && r.version !== c.version) {
      io.debug?.(modText(`probe: another host answered (${r.version}, this one ${c.version})`))
      r = undefined
    }
  } catch (err) {
    io.debug?.(modText(`probe failed: ${errorText(err)}`))
    r = undefined
  }
  c.probe = r ? capsOnly(r) : {}
  c.probeState = 'done'
  try {
    await io.merge()
  } finally {
    c.settle?.()
    if (tmp) {
      const projects = await io.projectsDir().catch(() => undefined)
      await io.remove(projects ? [tmp, projectDir(projects, tmp)] : [tmp]).catch(err => io.debug?.(modText(`probe cleanup failed: ${errorText(err)}`)))
    }
  }
  return r
}

function capsOnly(r: ProbeResult): CapMap {
  const out: CapMap = {}
  for (const cap of CAPS) if (r[cap]) out[cap] = r[cap]
  return out
}

// [SP_CTX_02_56] An action that runs the mod's compaction waits for a probe
// of this process while `compact` is unknown, at most PROBE_WAIT_MS. True:
// `compact` is passed over (the action must not run).
export async function compactPassed(c: Capabilities, sleep: (ms: number) => Promise<unknown>, wait = true): Promise<boolean> {
  if (wait && (c.probeState === 'planned' || c.probeState === 'running') && verdict(c, 'compact') === 'unknown' && c.probeDone) {
    let bound: Promise<unknown>
    try {
      bound = sleep(PROBE_WAIT_MS).catch(() => undefined)
    } catch {
      bound = Promise.resolve()
    }
    await Promise.race([c.probeDone, bound])
  }
  return isPassed(c)
}

// [SP_CTX_02_57] The probe process's answer to PROBE_MARKER.
export function probeSkip(counts: ProbeCounts): string {
  return `${PROBE_PREFIX} ${JSON.stringify(counts)}`
}

// ---- [SP_CTX_02_55] CompactBrief

function preview(row: SessionMessage | undefined): string {
  return row ? oneLine(row.text || row.toolUses.map(u => u.tool).join(', '), 70) : ''
}

function callOf(rows: readonly SessionMessage[], id: string): string | undefined {
  const at = findToolUse(rows, id)
  const use = at >= 0 ? rows[at]!.toolUses.find(u => u.tool_use_id === id) : undefined
  return use ? `the call ${use.tool} id=${use.tool_use_id} input="${oneLine(JSON.stringify(use.input ?? {}), 70)}"` : undefined
}

function rowAt(rows: readonly SessionMessage[], anchors: readonly string[] | undefined, hint: number, k: number): SessionMessage | undefined {
  const anchor = anchors?.[k]
  if (anchor === undefined) return rows[hint]
  const at = locate(rows, anchor, hint)
  return at >= 0 ? rows[at] : undefined
}

// The target of a queued edit as the brief names it; undefined: not in the rows.
export function targets(rows: readonly SessionMessage[], e: QueuedEdit): string | undefined {
  if ('tool_use_id' in e) return callOf(rows, e.tool_use_id)
  if (e.op === 'collapse') {
    const first = rowAt(rows, e.anchors, e.from_index, 0)
    const last = rowAt(rows, e.anchors, e.to_index, (e.anchors?.length ?? 1) - 1)
    return first && last ? `the rows from "${preview(first)}" to "${preview(last)}"` : undefined
  }
  const row = rowAt(rows, e.anchors, e.index, 0)
  return row ? `the row "${preview(row)}"` : undefined
}

function editItem(rows: readonly SessionMessage[], e: QueuedEdit): string | undefined {
  const t = targets(rows, e)
  if (!t) return undefined
  switch (e.op) {
    case 'summarize':
    case 'collapse':
      return `Use this summary for ${t}:\n${e.summary}`
    case 'rewrite':
      return `Use this text for ${t}:\n${e.text}`
    case 'drop':
      return `Leave out ${t}.`
    case 'describe':
      return `For the media in ${t} keep this description:\n${e.description}`
  }
}

function tagRow(rows: readonly SessionMessage[], target: { anchor: string; hint: number } | { tool_use_id: string }): SessionMessage | undefined {
  if ('tool_use_id' in target) {
    const at = findToolUse(rows, target.tool_use_id)
    return at >= 0 ? rows[at] : undefined
  }
  const at = locate(rows, target.anchor, target.hint)
  return at >= 0 ? rows[at] : undefined
}

// Whole items in order between the head and the records line (both always
// there); what does not fit is counted in one line.
export function fit(items: readonly string[], max = BRIEF_MAX): string {
  const sep = '\n\n'
  let text = BRIEF_HEAD
  let left = 0
  const room = max - BRIEF_RECORDS.length - sep.length
  for (const item of items) {
    if (left === 0 && text.length + sep.length + item.length <= room - 40) text += sep + item
    else left++
  }
  if (left) text += `${sep}(${left} more item(s) left out)`
  return text + sep + BRIEF_RECORDS
}

// [SP_CTX_02_55] The host's summary instructions when `compact` is passed
// over: the state slot, the queued edits as preferred summaries, the pinned
// rows and the agent's notes.
export function compactBrief(rows: readonly SessionMessage[], reg: TagRegistry | undefined, q: Queue | undefined, notes: readonly Note[] = reg?.notes ?? []): string {
  const items: string[] = []
  if (reg) {
    const tag = reg.tags.find(t => t.kind === 'state')
    const row = tag && !isRange(tag.target) ? tagRow(rows, tag.target) : undefined
    if (row?.text.trim()) items.push(`Keep this task state verbatim:\n${row.text}`)
  }
  for (const e of q?.edits ?? []) {
    const item = editItem(rows, e)
    if (item) items.push(item)
  }
  if (reg) {
    const pins = reg.tags
      .filter(t => t.kind === 'pin' && !isRange(t.target))
      .map(t => tagRow(rows, t.target as { anchor: string; hint: number }))
      .filter((r): r is SessionMessage => !!r && r.role !== 'user')
    if (pins.length) items.push(`Keep verbatim: ${pins.map(r => `"${preview(r)}"`).join('; ')}`)
  }
  const named = notes.map(n => {
    const row = 'toAnchor' in n.target ? undefined : tagRow(rows, n.target)
    return row ? `${n.text} (on "${preview(row)}")` : n.text
  })
  if (named.length) items.push(`The agent's notes: ${named.join('; ')}`)
  return fit(items)
}

// ---- [SP_CTX_02_55] ObservePassedCompact

// What the observer of a /compact with the brief does: the boundary of the
// copies (none when the read after does not continue the read before), and
// whether the host compacted at all (the read changed).
// The host compacted only when the read after holds its summary row (rows
// appended meanwhile, a delivery, are no compaction).
export function passedCopies(before: readonly SessionMessage[], after: readonly SessionMessage[]): { compacted: boolean; copies?: readonly SessionMessage[] } {
  const prefix = before.length <= after.length && before.every((r, i) => fingerprint(r) === fingerprint(after[i]!))
  const added = prefix ? after.slice(before.length) : after
  if (!added.some(r => r.role === 'user' && r.text.trimStart().startsWith(SUMMARY_OPENER))) return { compacted: false }
  return prefix ? { compacted: true, copies: added } : { compacted: true }
}

// [SP_CTX_02_55] The registry after the host's summary: the tags of rows it
// left out and lastApply go; the guide comes again. Undefined: no change.
export function briefedTags(reg: TagRegistry, before: readonly SessionMessage[], after: readonly SessionMessage[]): TagRegistry | undefined {
  const pruned = dropLastApply(pruneDeadTags(reg, before, after))
  const next = pruned.introduced && !pruned.reintroduce ? { ...pruned, reintroduce: true } : pruned
  return next === reg ? undefined : next
}

// [SP_CTX_02_55] QUEUE_BRIEFED: the edits went into the brief; the batch's choices go back to their defaults.
export function briefedQueue(q: Queue, empty: Pick<Queue, 'resume' | 'resumePrompt'>): Queue | undefined {
  return q.edits.length || q.keepCache || q.resumeSet ? { ...q, edits: [], keepCache: false, resume: empty.resume, resumePrompt: empty.resumePrompt, resumeSet: false } : undefined
}

export type PassedCompactIO = {
  hostId: () => string | undefined
  writeBoundary: (b: Boundary) => Promise<unknown>
  // the registry's change: tags of rows gone, lastApply dropped, the guide again
  updateTags: (before: readonly SessionMessage[], after: readonly SessionMessage[]) => Promise<unknown>
  // QUEUE_BRIEFED: the edits went into the brief
  clearQueue: () => Promise<unknown>
  // [SP_CTX_02_41] the summary stands: the answers about attachments go
  clearAttachments?: () => Promise<unknown>
  boundaryOf: (rows: readonly SessionMessage[], host?: string) => Boundary | undefined
}

// [SP_CTX_02_55] OBSERVE_NO_PREFIX: no boundary; the tags and the queue as for any compaction.
export async function observePassedCompact(io: PassedCompactIO, before: readonly SessionMessage[], after: readonly SessionMessage[]): Promise<'none' | 'boundary' | 'no-prefix'> {
  const { compacted, copies } = passedCopies(before, after)
  if (!compacted) return 'none'
  const b = copies ? io.boundaryOf(copies, io.hostId()) : undefined
  if (b) await io.writeBoundary(b).catch(() => undefined)
  await io.updateTags(before, copies ?? after).catch(() => undefined)
  await io.clearQueue().catch(() => undefined)
  await io.clearAttachments?.().catch(() => undefined)
  return b ? 'boundary' : 'no-prefix'
}
