// [SP_CTX_01_07] [SP_CTX_02_15] The storage of the current session: where it
// is, or why there is none, and its preparation. Pure: register.ts binds
// PrepareIO to `$`. One preparation runs per session id at a time; the
// session id and its folder are published together once it ends, so a reader
// never sees the folder of one session under the id of another, nor none
// while a new one is made.

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
  if ('reason' in state) io.status('context-editor: storage unavailable')
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
