// [SP_CTX_01_07] [SP_CTX_02_15] The storage of the current session: where it
// is, or why there is none, and its preparation. Pure: register.ts binds
// PrepareIO to `$`. One preparation runs per session id at a time; the
// session id and its folder are published together once it ends, so a reader
// never sees the folder of one session under the id of another, nor none
// while a new one is made.
import { modText } from './rows'

// [SP_CTX_01_07] The one readiness form every port takes: the folder, or why
// there is none.
export type StorageState = { dir: string } | { reason: string }

// The same with the session id it belongs to.
export type SessionStorage = StorageState & { sessionId: string }

// [SP_CTX_01_07] A session id that names a folder: no separator, no dots.
export const SESSION_ID = /^[A-Za-z0-9_-]+$/

// [SP_CTX_01_07] The folder of the mod's storages under HOME.
export const STORAGE_BASE = '.claude/context-editor'

// [SP_CTX_02_15] The refusal of a step that needs the storage.
export function storageRefusal(reason: string): string {
  return `storage unavailable: ${reason}`
}

// The folder, or undefined when the storage is unavailable.
export function dirOf(st: StorageState): string | undefined {
  return 'dir' in st ? st.dir : undefined
}

// [SP_CTX_02_15] Where the storage of session `id` goes, or why it cannot:
// no HOME, a HOME that is no absolute path, an id that is no plain name.
export function storagePlan(home: string | undefined, id: string): { base: string; dir: string } | { reason: string } {
  if (!home) return { reason: 'HOME is not set' }
  if (!home.startsWith('/')) return { reason: `HOME is not an absolute path (${home.slice(0, 80)})` }
  if (!SESSION_ID.test(id)) return { reason: `the session id cannot name a folder (${JSON.stringify(id.slice(0, 80))})` }
  const base = `${home.replace(/\/+$/, '')}/${STORAGE_BASE}`
  return { base, dir: `${base}/${id}` }
}

// [SP_CTX_02_15] The storage once its folders were made owner-only, or why not.
export function madeStorage(plan: { base: string; dir: string }, ran: { exitCode: number; stderr?: string }): StorageState {
  if (ran.exitCode === 0) return { dir: plan.dir }
  return { reason: `cannot make ${plan.base} owner-only: ${(ran.stderr ?? '').trim() || `exit ${ran.exitCode}`}` }
}

// One promise per key while it runs: a second caller joins the first.
export function singleFlight<T>(running: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const now = running.get(key)
  if (now) return now
  const p: Promise<T> = start().finally(() => {
    if (running.get(key) === p) running.delete(key)
  })
  running.set(key, p)
  return p
}

// [SP_CTX_01_07] The published storage of this module instance and the
// preparations in flight, by session id.
export type StorageMemory = {
  sessionId?: string
  state: StorageState
  inFlight: Map<string, Promise<SessionStorage>>
  // [SP_CTX_01_14] per preparation in flight: ends its wait for hostId
  hurry: Map<string, () => void>
}

export function newStorageMemory(): StorageMemory {
  return { state: { reason: 'not prepared yet' }, inFlight: new Map(), hurry: new Map() }
}

// The folder published for the current session, read without waiting.
export function publishedDir(mem: StorageMemory): string | undefined {
  return dirOf(mem.state)
}

// What PrepareStorage needs from the host; register.ts binds it to `$`.
export type PrepareIO = {
  // [SP_CTX_01_14] the caller is a compaction handler: it never waits for hostId
  urgent?: boolean
  sessionId: () => Promise<string>
  home: () => Promise<string | undefined>
  // makes `dir` and `base` owner-only (700); exitCode 0 when done
  mkdir: (dir: string, base: string) => Promise<{ exitCode: number; stderr?: string }>
  // [SP_CTX_02_18] the boundary step of the new storage (AfterPrepare); never
  // throws. `hurried` settles once a compaction handler waits for this
  // preparation: from then on it takes hostId only if already read.
  after: (prev: string | undefined, now: string, dir: string, hurried: Promise<void>) => Promise<unknown>
  // the in-memory state of the previous session goes (own boundary, listing key)
  published: () => void
  status: (text: string) => void
}

// [SP_CTX_02_15] PrepareStorage(id): one run per id at a time (a second
// caller joins it, so AfterPrepare runs once); the folders made owner-only,
// the boundary step, then the id and the folder (or the reason) published
// together, only while `id` is still the session: a preparation for a session
// left meanwhile serves its own callers and publishes nothing. A compaction
// handler that joins a preparation in flight hurries it: its boundary step
// stops waiting for hostId ([SP_CTX_01_14]).
export function prepareStorage(mem: StorageMemory, io: PrepareIO, id: string): Promise<SessionStorage> {
  const running = mem.inFlight.get(id)
  if (running) {
    if (io.urgent) mem.hurry.get(id)?.()
    return running
  }
  let hurry: () => void = () => undefined
  const hurried = new Promise<void>(r => (hurry = r))
  if (io.urgent) hurry()
  mem.hurry.set(id, hurry)
  return singleFlight(mem.inFlight, id, async () => {
    try {
      return await prepareOnce(mem, io, id, hurried)
    } finally {
      if (mem.hurry.get(id) === hurry) mem.hurry.delete(id)
    }
  })
}

async function prepareOnce(mem: StorageMemory, io: PrepareIO, id: string, hurried: Promise<void>): Promise<SessionStorage> {
  const prev = mem.sessionId
  const plan = storagePlan(await io.home(), id)
  let state: StorageState = plan
  if ('dir' in plan) {
    const ran = await io.mkdir(plan.dir, plan.base).catch((err: unknown) => ({ exitCode: -1, stderr: String(err) }))
    state = madeStorage(plan, ran)
    if ('dir' in state) await io.after(prev, id, state.dir, hurried).catch(() => undefined)
  }
  if ('reason' in state) io.status(modText('storage unavailable'))
  if ((await io.sessionId()) === id) {
    mem.sessionId = id
    mem.state = state
    io.published()
  }
  return { ...state, sessionId: id }
}

// [SP_CTX_01_07] EnsureStorage: /clear and /resume change the session in the
// same process without a session start, so every operation asks for the
// storage of the session current now, prepared for it if it is not. The
// caller keeps the folder it got for its whole work.
export async function ensureStorage(mem: StorageMemory, io: PrepareIO): Promise<SessionStorage> {
  const id = await io.sessionId()
  if (mem.sessionId === id && !mem.inFlight.has(id)) return { ...mem.state, sessionId: id }
  return prepareStorage(mem, io, id)
}

// ---- [SP_CTX_01_07] [SP_CTX_02] [PL_AUD_CTX_P7] The storage port: the files
// of the storage, their read states, one read-modify-write contract, and the
// serial chains with their lock order. Pure: register.ts binds FileIO to
// `$.fs` once (CF-15).

// [SP_CTX_01_04] [SP_CTX_01_07] The state of a storage file once read:
// missing (no file: its default value), ok, or unreadable (it cannot be read
// or parsed, or a field breaks its constraints); unreadable is never silently
// a default.
export type Read<T> = { state: 'missing' | 'ok'; value: T } | { state: 'unreadable'; reason: string }

// A read that has a value: missing or ok.
export type Readable<T> = Extract<Read<T>, { value: T }>

// The size of `value` in bytes, as a storage file holds it (JSON, UTF-8).
export function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

// An integer of at least `min`.
export function isCount(v: unknown, min = 0): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min
}

// [SP_CTX_01_07] The parse prologue every storage file shares: JSON, then an
// object; the parser checks its fields after it.
export function jsonObject(text: string): { state: 'ok'; value: Record<string, unknown> } | { state: 'unreadable'; reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { state: 'unreadable', reason: `not JSON: ${String(err)}` }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unreadable', reason: 'not an object' }
  return { state: 'ok', value: raw as Record<string, unknown> }
}

// [SP_CTX_01_19] [SP_CTX_01_22] The newest items of a capped list: the oldest
// go while there are more than `maxItems` or the file (`frame` gives its
// value from the items) would exceed `maxBytes`. The same array when nothing goes.
export function trimOldest<I>(items: I[], maxItems: number, maxBytes: number, frame: (items: I[]) => unknown = i => i): I[] {
  let kept = items
  if (kept.length > maxItems) kept = kept.slice(kept.length - maxItems)
  while (kept.length && bytes(frame(kept)) > maxBytes) kept = kept.slice(1)
  return kept
}

// ---- [SP_CTX_02] The serial chains

// [SP_CTX_02] One serial chain per kind of storage file: no two
// read-modify-writes of one file overlap. A chain is shared by the storages
// of every session.
export type ChainKey = 'queue' | 'tags' | 'aliases' | 'deliveries' | 'journal'

// [SP_CTX_02] The lock order: a chain nests only inside chains of a lower
// rank, queue → tags → aliases → deliveries | journal (deliveries and the
// journal never nest in each other).
export const CHAIN_RANK: Readonly<Record<ChainKey, number>> = { queue: 1, tags: 2, aliases: 3, deliveries: 4, journal: 4 }

// The chains a piece of work holds while it runs, and where an order problem
// of a chain nested in it goes.
export type Held = { readonly keys: readonly ChainKey[]; readonly report?: (problem: string) => void }

export const NOT_HELD: Held = { keys: [] }

// How a chain is entered: inside the chains `within` holds (the order is
// checked against them), and where an order problem goes (else the holder's).
export type Nest = { within?: Held; report?: (problem: string) => void }

// [SP_CTX_02] The order problem of entering `key` inside `within`, or
// undefined: the rank of `key` must be above every rank held.
export function lockOrder(key: ChainKey, within: Held): string | undefined {
  let top: ChainKey | undefined
  for (const k of within.keys) if (top === undefined || CHAIN_RANK[k] >= CHAIN_RANK[top]) top = k
  if (top === undefined || CHAIN_RANK[key] > CHAIN_RANK[top]) return undefined
  return modText(`chain order: "${key}" (rank ${CHAIN_RANK[key]}) entered inside "${top}" (rank ${CHAIN_RANK[top]}); the order is queue → tags → aliases → deliveries | journal`)
}

// Runs `work` once every earlier work on the chain `key` settled; it gets
// the chains it holds. A failed work rejects its caller only: the chain goes on.
export type Chains = <T>(key: ChainKey, work: (held: Held) => Promise<T>, nest?: Nest) => Promise<T>

// [SP_CTX_02] [PL_AUD_CTX_P7] The serial chains of one module instance. An
// order problem goes to the report and never throws: the work still runs (a
// chain entered inside itself then waits forever, as before the check).
export function serialChains(): Chains {
  const tails = new Map<ChainKey, Promise<unknown>>()
  return <T>(key: ChainKey, work: (held: Held) => Promise<T>, nest: Nest = {}): Promise<T> => {
    const within = nest.within ?? NOT_HELD
    const report = nest.report ?? within.report
    const problem = lockOrder(key, within)
    if (problem)
      try {
        report?.(problem)
      } catch {
        // a failed report never breaks the work
      }
    const held: Held = { keys: [...within.keys, key], ...(report ? { report } : {}) }
    const run = () => work(held)
    const next = (tails.get(key) ?? Promise.resolve()).then(run, run)
    tails.set(key, next.catch(() => undefined))
    return next
  }
}

// A store's chain: its work runs on it, inside the chains `within` holds.
export type Lock = <R>(work: (held: Held) => Promise<R>, within?: Held) => Promise<R>

// A store without a chain: its work runs at once (tests, a caller that holds the chain).
export const NO_LOCK: Lock = work => work(NOT_HELD)

// ---- [SP_CTX_01_07] The store of one storage file

// [PL_AUD_CTX_P7] What a storage file needs from the host; register.ts binds
// it to `$` once.
export type FileIO = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  // moves `from` to `to`; false when it could not
  move: (from: string, to: string) => Promise<boolean>
  now: () => number
}

// [SP_CTX_01_07] What Update does with an unreadable file: 'skip' leaves it
// and calls no change; 'change' passes the unreadable read to the change;
// 'quarantine' moves it aside and changes the default value, as if missing;
// when the move fails, it calls no change and writes nothing.
export type OnUnreadable = 'skip' | 'change' | 'quarantine'

export type UpdateOptions<U extends OnUnreadable> = {
  onUnreadable?: U
  // a change that returns the very value read writes nothing
  skipUnchanged?: boolean
  // the chains the caller holds: the store's chain nests inside them
  within?: Held
}

// The read a change sees: every state with 'change', else one with a value.
export type Seen<T, U extends OnUnreadable> = U extends 'change' ? Read<T> : Readable<T>

// [SP_CTX_01_07] [PL_AUD_CTX_P11] The cache of storage files of one module
// instance (CF-22, conflict X1): a file's read as this instance last read or
// wrote it, by path (the path holds the session's folder), valid in the
// cache's epoch only. It serves views and gates only (`cached`, `peek`): a
// read-modify-write always reads the file, so a second writer (another
// process on the session, an old module instance) is seen at the next one
// and never overwritten from a stale entry; a view may lag until then. A drop
// (a new storage published: the session start or a switch) begins a new
// epoch, so no read crosses a session; a read of the file renews the entry, a
// write through the Store replaces it with the text written, a failed write
// or a quarantine removes it. An unreadable read is never kept. A read that a
// write, a move or a drop overtook keeps nothing.
export type FileCache = {
  epoch: number
  entries: Map<string, { epoch: number; text?: string; read?: Readable<unknown> }>
  // writes and quarantines per path, so a read in flight knows it was overtaken
  changes: Map<string, number>
}

export function newFileCache(): FileCache {
  return { epoch: 0, entries: new Map(), changes: new Map() }
}

// [SP_CTX_01_07] A new epoch: every entry goes.
export function dropFileCache(cache: FileCache): void {
  cache.epoch++
  cache.entries.clear()
}

export type Store<T> = {
  readonly path: string
  // [SP_CTX_01_07] missing, ok, or unreadable (a failed read or parse); a
  // failed existence check rejects. Always the file: every read-modify-write
  // (update, and any read on the chain for a later write) sees a second
  // writer; with a cache, the read renews its entry.
  read: () => Promise<Read<T>>
  // [PL_AUD_CTX_P11] the read for a view or a gate that writes nothing: a
  // valid cache entry, else the file. It may lag a second writer until the
  // next read of the file.
  cached: () => Promise<Read<T>>
  // [PL_AUD_CTX_P11] the read a valid cache entry holds, without the file
  // system and without waiting for the chain; undefined without one
  peek: () => Readable<T> | undefined
  // a failed write rejects
  write: (value: T) => Promise<void>
  // moves the file aside to `<path>.bad-<ms>`; the new path, or undefined
  quarantine: () => Promise<string | undefined>
  // `work` on the file's chain
  onChain: Lock
  // [SP_CTX_01_07] The one read-modify-write, on the file's chain: read,
  // change, write. `change` returns the new value, or undefined to write
  // nothing; resolves true once written. A failed read, change or write rejects.
  update: <U extends OnUnreadable = 'skip'>(change: (read: Seen<T, U>) => T | undefined | Promise<T | undefined>, opts?: UpdateOptions<U>) => Promise<boolean>
}

// [SP_CTX_01_07] [PL_AUD_CTX_P7] A JSON storage file at `path`: `empty` gives
// its value when missing, `parse` its read state from the text. `lock` is its
// serial chain; `written` runs after each write of this store.
export function jsonFile<T>(
  fs: FileIO,
  path: string,
  empty: () => T,
  parse: (text: string) => Read<T>,
  opts: { lock?: Lock; written?: (value: T) => void; cache?: FileCache } = {},
): Store<T> {
  const lock = opts.lock ?? NO_LOCK
  const cache = opts.cache
  const fromFile = async (): Promise<Read<T>> => {
    if (!(await fs.exists(path))) return { state: 'missing', value: empty() }
    try {
      return parse(await fs.read(path))
    } catch (err) {
      return { state: 'unreadable', reason: String(err) }
    }
  }
  const changes = () => cache?.changes.get(path) ?? 0
  // a change of the file through this store: a read in flight keeps nothing
  const changing = () => {
    if (!cache) return
    cache.changes.set(path, changes() + 1)
    cache.entries.delete(path)
  }
  const peek = (): Readable<T> | undefined => {
    const hit = cache?.entries.get(path)
    if (!cache || !hit || hit.epoch !== cache.epoch) return undefined
    if (!hit.read && hit.text !== undefined) {
      let got: Read<T>
      try {
        got = parse(hit.text)
      } catch (err) {
        got = { state: 'unreadable', reason: String(err) }
      }
      if (got.state === 'unreadable') {
        cache.entries.delete(path)
        return undefined
      }
      hit.read = got
      hit.text = undefined
    }
    return hit.read as Readable<T> | undefined
  }
  // [SP_CTX_01_07] the file itself; its read replaces the entry unless a
  // write, a move or a new epoch overtook it
  const read = async (): Promise<Read<T>> => {
    if (!cache) return fromFile()
    const epoch = cache.epoch
    const seen = changes()
    const got = await fromFile()
    if (cache.epoch === epoch && changes() === seen) {
      if (got.state === 'unreadable') cache.entries.delete(path)
      else cache.entries.set(path, { epoch, read: got })
    }
    return got
  }
  const cached = async (): Promise<Read<T>> => peek() ?? read()
  // A write or a move counts as a change when it starts and again when it
  // ends: nothing a read overlapping it stored (it may have seen either text)
  // outlives the end, which replaces or drops the entry.
  const write = async (value: T): Promise<void> => {
    const text = JSON.stringify(value)
    changing()
    const epoch = cache?.epoch
    const seen = changes()
    try {
      await fs.write(path, text)
    } catch (err) {
      changing()
      throw err
    }
    const alone = changes() === seen
    changing()
    if (cache && alone && cache.epoch === epoch) cache.entries.set(path, { epoch, text })
    opts.written?.(value)
  }
  const quarantine = async (): Promise<string | undefined> => {
    const moved = `${path}.bad-${fs.now()}`
    changing()
    try {
      return (await fs.move(path, moved).catch(() => false)) ? moved : undefined
    } finally {
      changing()
    }
  }
  const update = <U extends OnUnreadable = 'skip'>(change: (read: Seen<T, U>) => T | undefined | Promise<T | undefined>, o: UpdateOptions<U> = {}): Promise<boolean> =>
    lock(async () => {
      let now = await read()
      if (now.state === 'unreadable') {
        const mode: OnUnreadable = o.onUnreadable ?? 'skip'
        if (mode === 'skip') return false
        if (mode === 'quarantine') {
          // a file that could not be moved aside is never overwritten
          if ((await quarantine()) === undefined) return false
          now = { state: 'missing', value: empty() }
        }
      }
      const next = await change(now as Seen<T, U>)
      if (next === undefined) return false
      if (o.skipUnchanged && now.state !== 'unreadable' && next === now.value) return false
      await write(next)
      return true
    }, o.within)
  return { path, read, cached, peek, write, quarantine, onChain: lock, update }
}

// ---- [PL_AUD_CTX_P7] The two read-modify-write contracts of the ports

// [SP_CTX_01_07] Update: `change` sees the value (the default when missing);
// an unreadable file is left alone and `change` is not called. A change that
// returns undefined or the value as read writes nothing. Resolves true once
// written; a failed write rejects.
export type Update<T> = (change: (value: T) => T | undefined) => Promise<boolean>

// [SP_CTX_01_07] Change: `change` sees the read state, unreadable too, and
// decides; otherwise as Update.
export type Change<T> = (change: ChangeFn<T>) => Promise<boolean>

// The change a Change port runs: the new value, or undefined to write nothing.
export type ChangeFn<T> = (read: Read<T>) => T | undefined | Promise<T | undefined>

// The Update port of `store`.
export function updateOf<T>(store: Store<T>, within?: Held): Update<T> {
  return change => store.update(read => change(read.value), { skipUnchanged: true, ...(within ? { within } : {}) })
}

// The Change port of `store`.
export function changeOf<T>(store: Store<T>, within?: Held): Change<T> {
  return change => store.update<'change'>(change, { onUnreadable: 'change', skipUnchanged: true, ...(within ? { within } : {}) })
}

// [SP_CTX_02_21] One file into the storage of another session, on its chain:
// read in `from`, changed, written into `to`. 'missing' when `from` has none
// (nothing written); an unreadable file (named by `name`), a throw of
// `change` or a failed write rejects, and nothing is written.
export function carry<T>(from: Store<T>, to: Store<T>, change: (value: T) => T, name: string): Promise<'missing' | 'carried'> {
  return to.onChain(async () => {
    const read = await from.read()
    if (read.state === 'missing') return 'missing'
    if (read.state === 'unreadable') throw new Error(`${name} of the old session cannot be read (${read.reason})`)
    await to.write(change(read.value))
    return 'carried'
  })
}
