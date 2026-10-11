import { expect, test } from 'claude-code/testing'
import {
  dirOf,
  ensureStorage,
  madeStorage,
  newStorageMemory,
  prepareStorage,
  publishedDir,
  singleFlight,
  storagePlan,
  storageRefusal,
  type PrepareIO,
} from '../hooks/store'
import { contextTag, type TagIO } from '../hooks/tags'
import { contextNote } from '../hooks/notes'
import { afterPrepare } from '../hooks/edits'

// ---- [SP_CTX_01_07] [SP_CTX_02_15] the storage of the current session

// A host over fakes: the session id can change under a running preparation,
// and mkdir waits at the gate while one is held.
function host(session: string, over: Partial<PrepareIO> = {}) {
  const log = { session, mkdirs: [] as string[], afters: [] as string[], published: 0, statuses: [] as string[] }
  let gate: Promise<void> | undefined
  let open: () => void = () => undefined
  const io: PrepareIO = {
    sessionId: async () => log.session,
    home: async () => '/home/u',
    mkdir: async dir => {
      log.mkdirs.push(dir)
      if (gate) await gate
      return { exitCode: 0 }
    },
    after: async (prev, now) => void log.afters.push(`${prev ?? '-'}>${now}`),
    published: () => void log.published++,
    status: text => void log.statuses.push(text),
    ...over,
  }
  const hold = () => {
    gate = new Promise<void>(r => (open = r))
  }
  const release = () => {
    gate = undefined
    open()
  }
  return { io, log, hold, release }
}

// Lets the running preparations go as far as they can.
async function yields(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test('storagePlan: the folder under HOME; no HOME, a relative HOME or an id that is no plain name: the reason', async () => {
  expect(storagePlan('/home/u', 'a1-B_2')).toEqual({ base: '/home/u/.claude/context-editor', dir: '/home/u/.claude/context-editor/a1-B_2' })
  expect(storagePlan('/home/u/', 's')).toEqual({ base: '/home/u/.claude/context-editor', dir: '/home/u/.claude/context-editor/s' })
  expect(storagePlan(undefined, 's')).toEqual({ reason: 'HOME is not set' })
  expect(storagePlan('', 's')).toEqual({ reason: 'HOME is not set' })
  expect('reason' in storagePlan('home/u', 's')).toBe(true)
  for (const id of ['', '..', '../x', 'a/b', 'a b', 'undefined/..', 's.json'])
    expect((storagePlan('/home/u', id) as { reason: string }).reason).toContain('the session id cannot name a folder')
})

test('madeStorage: the folder when mkdir succeeded; otherwise why, from stderr or the exit code', async () => {
  const plan = { base: '/h/.claude/context-editor', dir: '/h/.claude/context-editor/s' }
  expect(madeStorage(plan, { exitCode: 0 })).toEqual({ dir: plan.dir })
  expect(madeStorage(plan, { exitCode: 1, stderr: 'mkdir: denied\n' })).toEqual({ reason: 'cannot make /h/.claude/context-editor owner-only: mkdir: denied' })
  expect(madeStorage(plan, { exitCode: 2, stderr: '' })).toEqual({ reason: 'cannot make /h/.claude/context-editor owner-only: exit 2' })
  expect(storageRefusal('HOME is not set')).toBe('storage unavailable: HOME is not set')
  expect(dirOf({ dir: '/d' })).toBe('/d')
  expect(dirOf({ reason: 'x' })).toBeUndefined()
})

test('singleFlight: a second caller joins the running promise; a new one starts once it ended', async () => {
  const running = new Map<string, Promise<number>>()
  let starts = 0
  const start = async () => ++starts
  const [a, b] = await Promise.all([singleFlight(running, 'k', start), singleFlight(running, 'k', start)])
  expect([a, b]).toEqual([1, 1])
  expect(running.size).toBe(0)
  expect(await singleFlight(running, 'k', start)).toBe(2)
})

test('EnsureStorage — паралельні виклики на зміні сесії: one preparation, one AfterPrepare, the same folder for both', async () => {
  const mem = newStorageMemory()
  const h = host('A')
  expect(dirOf(await ensureStorage(mem, h.io))).toBe('/home/u/.claude/context-editor/A')
  h.log.session = 'B'
  h.hold()
  const one = ensureStorage(mem, h.io)
  const two = ensureStorage(mem, h.io)
  await yields()
  h.release()
  const [a, b] = await Promise.all([one, two])
  expect(a).toEqual({ dir: '/home/u/.claude/context-editor/B', sessionId: 'B' })
  expect(b).toEqual(a)
  expect(h.log.mkdirs).toEqual(['/home/u/.claude/context-editor/A', '/home/u/.claude/context-editor/B'])
  expect(h.log.afters).toEqual(['->A', 'A>B'])
  expect(h.log.published).toBe(2)
  // the next call takes the published storage without a preparation
  expect(dirOf(await ensureStorage(mem, h.io))).toBe('/home/u/.claude/context-editor/B')
  expect(h.log.mkdirs.length).toBe(2)
})

test('EnsureStorage — під час підготовки: the folder of the previous session stays published, never none; the id and the folder change together', async () => {
  const mem = newStorageMemory()
  const h = host('A')
  await ensureStorage(mem, h.io)
  h.log.session = 'B'
  h.hold()
  const b = ensureStorage(mem, h.io)
  await yields()
  expect(publishedDir(mem)).toBe('/home/u/.claude/context-editor/A')
  expect(mem.sessionId).toBe('A')
  h.release()
  expect(dirOf(await b)).toBe('/home/u/.claude/context-editor/B')
  expect(publishedDir(mem)).toBe('/home/u/.claude/context-editor/B')
  expect(mem.sessionId).toBe('B')
})

test('PrepareStorage — сесію покинуто під час підготовки: it serves its callers and publishes nothing', async () => {
  const mem = newStorageMemory()
  const h = host('A')
  await ensureStorage(mem, h.io)
  h.log.session = 'B'
  h.hold()
  const b = ensureStorage(mem, h.io)
  await yields()
  h.log.session = 'C'
  h.release()
  expect(dirOf(await b)).toBe('/home/u/.claude/context-editor/B')
  expect(mem.sessionId).toBe('A')
  expect(publishedDir(mem)).toBe('/home/u/.claude/context-editor/A')
  expect(dirOf(await ensureStorage(mem, h.io))).toBe('/home/u/.claude/context-editor/C')
  expect(mem.sessionId).toBe('C')
})

test('PrepareStorage — сховище недоступне: no HOME or a failed mkdir publish the reason with a status; the tools refuse DENIED_STORAGE', async () => {
  const mem = newStorageMemory()
  const noHome = host('A', { home: async () => undefined })
  const st = await ensureStorage(mem, noHome.io)
  expect(st).toEqual({ reason: 'HOME is not set', sessionId: 'A' })
  expect(noHome.log.mkdirs).toEqual([])
  expect(noHome.log.afters).toEqual([])
  expect(noHome.log.statuses).toEqual(['context-editor: storage unavailable'])
  expect(publishedDir(mem)).toBeUndefined()
  const reason = 'reason' in st ? st.reason : ''
  const tag = await contextTag({} as TagIO, { tags: [{ op: 'add', kind: 'pin', index: 0 }] }, reason)
  expect('code' in tag && tag.code).toBe('DENIED_STORAGE')
  expect('deny' in tag && tag.deny).toBe('storage unavailable: HOME is not set')
  const note = await contextNote({} as TagIO, { notes: [{ op: 'add', text: 'x', index: 0 }] }, reason)
  expect('code' in note && note.code).toBe('DENIED_STORAGE')

  const mem2 = newStorageMemory()
  const denied = host('A', { mkdir: async () => ({ exitCode: 1, stderr: 'mkdir: Permission denied' }) })
  expect(await ensureStorage(mem2, denied.io)).toEqual({ reason: 'cannot make /home/u/.claude/context-editor owner-only: mkdir: Permission denied', sessionId: 'A' })
  expect(denied.log.afters).toEqual([])
  const thrown = host('A', {
    mkdir: async () => {
      throw new Error('spawn failed')
    },
  })
  expect((await prepareStorage(newStorageMemory(), thrown.io, 'A')) as unknown).toEqual({ reason: 'cannot make /home/u/.claude/context-editor owner-only: Error: spawn failed', sessionId: 'A' })
})

test('PrepareStorage — недійсний id сесії: no folder is made, the reason names the id', async () => {
  const mem = newStorageMemory()
  const h = host('../etc')
  const st = await ensureStorage(mem, h.io)
  expect('reason' in st && st.reason).toContain('the session id cannot name a folder')
  expect(h.log.mkdirs).toEqual([])
})

test('PrepareStorage — сесія стартує знову з тим самим id: a new preparation (the session start), joined by a concurrent EnsureStorage', async () => {
  const mem = newStorageMemory()
  const h = host('A')
  await ensureStorage(mem, h.io)
  h.hold()
  const again = prepareStorage(mem, h.io, 'A')
  const joined = ensureStorage(mem, h.io)
  await yields()
  h.release()
  expect(await joined).toEqual(await again)
  expect(h.log.mkdirs.length).toBe(2)
  expect(h.log.afters).toEqual(['->A', 'A>A'])
})

test('PrepareStorage — обробник компактизації приєднується: the boundary step of a running preparation stops waiting for hostId and takes it only if read', async () => {
  const mem = newStorageMemory()
  const steps: string[] = []
  const never = new Promise<string | undefined>(() => undefined)
  const h = host('A', {
    // a preparation outside a compaction: hostId not read yet, its wait would not end
    after: (prev, now, dir, hurried) =>
      afterPrepare({
        prev: 'B',
        now,
        inCompaction: false,
        hurried,
        wait: () => never,
        peek: () => undefined,
        read: async () => JSON.stringify({ head: ['x'], count: 1, host: 'tok:1' }),
        write: async () => void steps.push('write'),
        remove: async () => void steps.push('remove'),
        toast: () => undefined,
      }),
  })
  const plain = ensureStorage(mem, h.io)
  await yields()
  // the compaction handler's EnsureStorage joins it
  const joined = ensureStorage(mem, { ...h.io, urgent: true })
  const [a, b] = await Promise.all([plain, joined])
  expect(dirOf(a)).toBe('/home/u/.claude/context-editor/A')
  expect(b).toEqual(a)
  expect(h.log.mkdirs.length).toBe(1)
  // hostId absent: the boundary keeps its host (nothing written), as inside a compaction
  expect(steps).toEqual([])
  expect(mem.hurry.size).toBe(0)
})
