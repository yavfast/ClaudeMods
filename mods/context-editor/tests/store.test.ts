import { expect, test } from 'claude-code/testing'
import {
  bytes,
  carry,
  CHAIN_RANK,
  changeOf,
  dirOf,
  dropFileCache,
  ensureStorage,
  isCount,
  jsonFile,
  jsonObject,
  lockOrder,
  madeStorage,
  newFileCache,
  newStorageMemory,
  NOT_HELD,
  prepareStorage,
  publishedDir,
  renewOf,
  serialChains,
  singleFlight,
  storagePlan,
  storageRefusal,
  trimOldest,
  updateOf,
  type ChainKey,
  type FileIO,
  type Held,
  type Lock,
  type PrepareIO,
  type Read,
} from '../hooks/store'
import { contextTag, type TagIO } from '../hooks/tags'
import { contextNote } from '../hooks/notes'
import { afterPrepare } from '../hooks/edits'
import { memStore, okRead, unreadableRead } from './row-fixtures'

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

// ---- [SP_CTX_02] [PL_AUD_CTX_P7] the serial chains

// A work that waits at its gate until opened; `log` records its start and end.
function gated(log: string[], name: string) {
  let open: () => void = () => undefined
  const gate = new Promise<void>(r => (open = r))
  const work = async () => {
    log.push(`${name} start`)
    await gate
    log.push(`${name} end`)
    return name
  }
  return { work, open }
}

test('serialChains — порядок: works on one chain run one after another in call order; another chain does not wait', async () => {
  const serial = serialChains()
  const log: string[] = []
  const a = gated(log, 'a')
  const b = gated(log, 'b')
  const c = gated(log, 'c')
  const pa = serial('queue', a.work)
  const pb = serial('queue', b.work)
  const pc = serial('tags', c.work)
  await yields()
  // b waits for a; c, on its own chain, has started
  expect(log).toEqual(['a start', 'c start'])
  c.open()
  b.open()
  await yields()
  expect(log).toEqual(['a start', 'c start', 'c end'])
  a.open()
  expect(await Promise.all([pa, pb, pc])).toEqual(['a', 'b', 'c'])
  expect(log).toEqual(['a start', 'c start', 'c end', 'a end', 'b start', 'b end'])
})

test('serialChains — ізоляція збою: a work that throws rejects its own caller only; the chain goes on with the next work', async () => {
  const serial = serialChains()
  const failed = serial('tags', async () => {
    throw new Error('disk full')
  })
  const sync = serial('tags', () => {
    throw new Error('sync throw')
  })
  const next = serial('tags', async held => held.keys)
  expect(await failed.then(() => 'ok', err => String(err))).toBe('Error: disk full')
  expect(await sync.then(() => 'ok', err => String(err))).toBe('Error: sync throw')
  expect(await next).toEqual(['tags'])
})

test('serialChains — порядок вкладення: queue → tags → aliases → deliveries passes silently; a chain of a lower or equal rank inside its holder is reported to the debug report, never thrown, and its work runs', async () => {
  const serial = serialChains()
  const problems: string[] = []
  const report = (p: string) => void problems.push(p)
  const held = await serial('queue', q => serial('tags', t => serial('aliases', a => serial('deliveries', async d => d.keys, { within: a }), { within: t }), { within: q }), { report })
  expect(held).toEqual(['queue', 'tags', 'aliases', 'deliveries'])
  expect(problems).toEqual([])
  // queue inside tags: the report inherited from the holder names both chains
  const ran = await serial('tags', t => serial('queue', async () => 'ran', { within: t }), { report })
  expect(ran).toBe('ran')
  expect(problems).toEqual(['context-editor: chain order: "queue" (rank 1) entered inside "tags" (rank 2); the order is queue → tags → aliases → deliveries | journal | hostattach | ledger | hostrows'])
  // the journal inside deliveries: one rank, never nested
  await serial('deliveries', d => serial('journal', async () => undefined, { within: d }), { report })
  expect(problems[1]).toContain('"journal" (rank 4) entered inside "deliveries" (rank 4)')
  // a chain inside itself with its holder's token: a re-entry, no order problem
  expect(await serial('aliases', a => serial('aliases', async () => 'inside', { within: a }), { report })).toBe('inside')
  expect(problems.length).toBe(2)
})

test('serialChains — повторний вхід: a work entering the chain it holds runs on its turn, nested re-entries too; a later work waits; a token whose work settled holds nothing', async () => {
  const serial = serialChains()
  const order: string[] = []
  let token: Held | undefined
  let release!: () => void
  const gate = new Promise<void>(r => void (release = r))
  const first = serial('hostrows', async held => {
    token = held
    await gate
    // a re-entry is a holder of its own: its nested re-entry runs at once too
    await serial('hostrows', h => serial('hostrows', async () => void order.push('re-entry'), { within: h }), { within: held })
    order.push('first')
  })
  const later = serial('hostrows', async () => void order.push('later'))
  release()
  await Promise.all([first, later])
  expect(order).toEqual(['re-entry', 'first', 'later'])
  // the holder settled: its token queues behind the chain's tail and the order problem is reported
  const problems: string[] = []
  expect(await serial('hostrows', async () => 'queued', { within: token!, report: p => void problems.push(p) })).toBe('queued')
  expect(problems[0]).toContain('"hostrows" (rank 4) entered inside "hostrows" (rank 4)')
})

test('serialChains — повторний вхід без обходу: re-entries of one token run one after another; one not awaited ends before the next work; a nested token outliving the holder of the outer chain queues', async () => {
  const serial = serialChains()
  const order: string[] = []
  // a few turns of the microtask queue: long enough for any work that could start, to start
  const tick = async () => {
    for (let k = 0; k < 20; k++) await Promise.resolve()
  }
  // two re-entries at once with one token: the second starts after the first ended
  await serial('queue', held =>
    Promise.all([
      serial('queue', async () => (order.push('a+'), await tick(), order.push('a-')), { within: held }),
      serial('queue', async () => void order.push('b'), { within: held }),
    ]),
  )
  expect(order).toEqual(['a+', 'a-', 'b'])
  // a re-entry the holder does not await still ends before the next work of the chain
  order.length = 0
  const holder = serial('queue', async held => {
    void serial('queue', async () => (await tick(), order.push('stray')), { within: held })
  })
  const next = serial('queue', async () => void order.push('next'))
  await Promise.all([holder, next])
  expect(order).toEqual(['stray', 'next'])
  // the deliveries' token of a queue work that settled: entering the queue with it waits for the running queue work
  order.length = 0
  let nested: Held | undefined
  let free!: () => void
  const nestedDone = new Promise<void>(r => void (free = r))
  await serial('queue', q => {
    void serial('deliveries', async d => ((nested = d), await nestedDone), { within: q })
    return Promise.resolve()
  })
  let open!: () => void
  const running = serial('queue', async () => (order.push('queue+'), await new Promise<void>(r => void (open = r)), order.push('queue-')))
  await tick()
  const bypass = serial('queue', async () => void order.push('entered'), { within: nested!, report: () => undefined })
  await tick()
  open()
  free()
  await Promise.all([running, bypass])
  expect(order).toEqual(['queue+', 'queue-', 'entered'])
})

test('Store.update — повторний вхід: an update with the token of the chain it runs on writes at once instead of waiting forever', async () => {
  const serial = serialChains()
  const lock: Lock = (work, within) => serial('hostrows', work, within ? { within } : {})
  const { store, log } = memStore<{ n: number }>(okRead({ n: 1 }), () => ({ n: 0 }), text => okRead(JSON.parse(text)), lock)
  const wrote = await lock(held => updateOf(store, held)(v => ({ n: v.n + 1 })))
  expect(wrote).toBe(true)
  expect(log.file).toEqual({ state: 'ok', value: { n: 2 } })
})

test('renewOf — Renew: an unreadable file goes aside and the change sees the default; one that cannot be moved aside is never written; the value as read writes nothing', async () => {
  const moved = memStore<{ n: number }>(unreadableRead('not JSON'), () => ({ n: 0 }), text => okRead(JSON.parse(text)))
  expect(await renewOf(moved.store)(v => ({ n: v.n + 5 }))).toBe(true)
  expect(moved.log.quarantined).toBe(1)
  expect(moved.log.file).toEqual({ state: 'ok', value: { n: 5 } })
  const stuck = memStore<{ n: number }>(unreadableRead('not JSON'), () => ({ n: 0 }), text => okRead(JSON.parse(text)))
  stuck.log.stuck = true
  expect(await renewOf(stuck.store)(v => ({ n: v.n + 5 }))).toBe(false)
  expect(stuck.log.writes).toBe(0)
  const same = memStore<{ n: number }>(okRead({ n: 3 }), () => ({ n: 0 }), text => okRead(JSON.parse(text)))
  expect(await renewOf(same.store)(v => v)).toBe(false)
  expect(same.log.writes).toBe(0)
})

test('serialChains — збій звіту: a report that throws never breaks the work; without a report the problem is dropped', async () => {
  const serial = serialChains()
  const out = await serial('aliases', a => serial('tags', async () => 'ok', { within: a, report: () => { throw new Error('no log') } }))
  expect(out).toBe('ok')
  expect(await serial('aliases', a => serial('queue', async () => 'quiet', { within: a }))).toBe('quiet')
})

test('lockOrder: the rank table is the lock order in force; nothing held gives no problem', async () => {
  const order: ChainKey[] = ['queue', 'tags', 'aliases', 'deliveries']
  expect(order.map(k => CHAIN_RANK[k])).toEqual([1, 2, 3, 4])
  expect(CHAIN_RANK.journal).toBe(CHAIN_RANK.deliveries)
  // [SP_CTX_01_31] the host rows' chain (phase 45) beside the other files of rank 4
  expect(CHAIN_RANK.hostrows).toBe(CHAIN_RANK.deliveries)
  expect(lockOrder('hostrows', { keys: ['queue'] })).toBeUndefined()
  expect(lockOrder('hostrows', { keys: ['deliveries'] })).toContain('"hostrows" (rank 4) entered inside "deliveries" (rank 4)')
  expect(lockOrder('queue', NOT_HELD)).toBeUndefined()
  expect(lockOrder('deliveries', { keys: ['tags'] })).toBeUndefined()
  expect(lockOrder('journal', { keys: ['queue', 'tags', 'aliases'] })).toBeUndefined()
  // the highest rank held counts, not the last one entered
  expect(lockOrder('aliases', { keys: ['deliveries', 'tags'] })).toContain('inside "deliveries"')
})

// ---- [SP_CTX_01_07] [PL_AUD_CTX_P7] the store of one storage file

type Doc = { n: number; tag?: string }

function parseDoc(text: string): Read<Doc> {
  const raw = jsonObject(text)
  if (raw.state === 'unreadable') return raw
  return isCount(raw.value.n) ? { state: 'ok', value: { n: raw.value.n } } : { state: 'unreadable', reason: 'bad field(s): n' }
}

// Files in memory; `failRead`/`failWrite`/`failMove` make the host calls fail.
function memFiles(init: Record<string, string> = {}) {
  const files = new Map(Object.entries(init))
  const log: string[] = []
  const fail = { read: false, write: false, move: false }
  const fs: FileIO = {
    exists: async path => files.has(path),
    read: async path => {
      if (fail.read) throw new Error('EIO')
      return files.get(path)!
    },
    write: async (path, text) => {
      if (fail.write) throw new Error('disk full')
      log.push(`write ${path}`)
      files.set(path, text)
    },
    move: async (from, to) => {
      if (fail.move) return false
      log.push(`move ${from} ${to}`)
      files.set(to, files.get(from)!)
      files.delete(from)
      return true
    },
    now: () => 7,
  }
  return { fs, files, log, fail }
}

const PATH = '/s/a/doc.json'

function docStore(init: Record<string, string> = {}, lock?: Lock) {
  const m = memFiles(init)
  const written: Doc[] = []
  const store = jsonFile<Doc>(m.fs, PATH, () => ({ n: 0 }), parseDoc, { ...(lock ? { lock } : {}), written: d => void written.push(d) })
  return { ...m, store, written }
}

test('jsonFile read — стани: no file → missing with the default; a parsed file → ok; a bad field, bad JSON, a failed read or a throwing parse → unreadable with the reason', async () => {
  expect(await docStore().store.read()).toEqual({ state: 'missing', value: { n: 0 } })
  expect(await docStore({ [PATH]: '{"n":3}' }).store.read()).toEqual({ state: 'ok', value: { n: 3 } })
  expect(await docStore({ [PATH]: '{"n":-1}' }).store.read()).toEqual({ state: 'unreadable', reason: 'bad field(s): n' })
  expect(await docStore({ [PATH]: '[1]' }).store.read()).toEqual({ state: 'unreadable', reason: 'not an object' })
  const bad = await docStore({ [PATH]: '{' }).store.read()
  expect(bad.state === 'unreadable' && bad.reason.startsWith('not JSON: ')).toBe(true)
  const eio = docStore({ [PATH]: '{"n":1}' })
  eio.fail.read = true
  expect(await eio.store.read()).toEqual({ state: 'unreadable', reason: 'Error: EIO' })
  const m = memFiles({ [PATH]: '{}' })
  const throwing = jsonFile<Doc>(m.fs, PATH, () => ({ n: 0 }), () => {
    throw new Error('parser bug')
  })
  expect(await throwing.read()).toEqual({ state: 'unreadable', reason: 'Error: parser bug' })
})

test('Store.update — запис: the change sees the value; a new value is written as JSON (written runs) and resolves true; undefined writes nothing and resolves false', async () => {
  const d = docStore({ [PATH]: '{"n":1}' })
  expect(await d.store.update(read => ({ n: read.value.n + 1 }))).toBe(true)
  expect(d.files.get(PATH)).toBe('{"n":2}')
  expect(d.written).toEqual([{ n: 2 }])
  expect(await d.store.update(() => undefined)).toBe(false)
  expect(d.log).toEqual([`write ${PATH}`])
  // missing: the change sees the default, and its result creates the file
  const fresh = docStore()
  expect(await fresh.store.update(read => (read.state === 'missing' ? { n: 5 } : undefined))).toBe(true)
  expect(fresh.files.get(PATH)).toBe('{"n":5}')
})

test('Store.update — skipUnchanged: the very value read writes nothing (missing too); without it the same value is written again', async () => {
  const d = docStore({ [PATH]: '{"n":1}' })
  expect(await d.store.update(read => read.value, { skipUnchanged: true })).toBe(false)
  const fresh = docStore()
  expect(await fresh.store.update(read => read.value, { skipUnchanged: true })).toBe(false)
  expect(fresh.files.has(PATH)).toBe(false)
  expect(await d.store.update(read => read.value)).toBe(true)
  expect(d.log).toEqual([`write ${PATH}`])
})

test('Store.update — onUnreadable: skip (default) calls no change; change passes the unreadable read; quarantine moves the file aside and changes the default', async () => {
  const skip = docStore({ [PATH]: 'garbage' })
  let called = false
  expect(await skip.store.update(() => ((called = true), { n: 1 }))).toBe(false)
  expect(called).toBe(false)
  expect(skip.files.get(PATH)).toBe('garbage')
  const change = docStore({ [PATH]: 'garbage' })
  const seen: string[] = []
  expect(await change.store.update(read => void seen.push(read.state), { onUnreadable: 'change' })).toBe(false)
  expect(await change.store.update(read => (read.state === 'unreadable' ? { n: 9 } : undefined), { onUnreadable: 'change' })).toBe(true)
  expect(seen).toEqual(['unreadable'])
  expect(change.files.get(PATH)).toBe('{"n":9}')
  const q = docStore({ [PATH]: 'garbage' })
  expect(await q.store.update(read => ({ n: read.value.n + 1 }), { onUnreadable: 'quarantine' })).toBe(true)
  expect(q.files.get(`${PATH}.bad-7`)).toBe('garbage')
  expect(q.files.get(PATH)).toBe('{"n":1}')
  expect(q.log).toEqual([`move ${PATH} ${PATH}.bad-7`, `write ${PATH}`])
  // the move fails (EACCES, EXDEV): no change is called, the unreadable file is never overwritten
  const stuck = docStore({ [PATH]: 'garbage' })
  stuck.fail.move = true
  let changed = false
  expect(await stuck.store.update(() => ((changed = true), { n: 1 }), { onUnreadable: 'quarantine' })).toBe(false)
  expect(changed).toBe(false)
  expect(stuck.files.get(PATH)).toBe('garbage')
  expect(stuck.log).toEqual([])
})

test('Store.update — збої: a failed write or a throwing change rejects; a failed existence check rejects (never a silent default)', async () => {
  const d = docStore({ [PATH]: '{"n":1}' })
  d.fail.write = true
  expect(await d.store.update(() => ({ n: 2 })).then(String, err => String(err))).toBe('Error: disk full')
  expect(d.written).toEqual([])
  const t = docStore({ [PATH]: '{"n":1}' })
  expect(
    await t.store
      .update(() => {
        throw new Error('bad change')
      })
      .then(String, err => String(err)),
  ).toBe('Error: bad change')
  const m = memFiles()
  m.fs.exists = async () => {
    throw new Error('EACCES')
  }
  const s = jsonFile<Doc>(m.fs, PATH, () => ({ n: 0 }), parseDoc)
  expect(await s.read().then(() => 'read', err => String(err))).toBe('Error: EACCES')
})

test('Store.update — на ланцюжку: two updates at once both land (the second reads what the first wrote); `within` checks the order against the holder', async () => {
  const serial = serialChains()
  const problems: string[] = []
  const lock: Lock = (work, within) => serial('tags', work, { ...(within ? { within } : {}), report: p => void problems.push(p) })
  const d = docStore({ [PATH]: '{"n":0}' }, lock)
  await Promise.all([d.store.update(read => ({ n: read.value.n + 1 })), d.store.update(read => ({ n: read.value.n + 1 }))])
  expect(d.files.get(PATH)).toBe('{"n":2}')
  // inside the aliases chain: tags is of a lower rank
  await serial('aliases', a => d.store.update(read => ({ n: read.value.n + 1 }), { within: a }))
  expect(d.files.get(PATH)).toBe('{"n":3}')
  expect(problems.length).toBe(1)
  expect(problems[0]).toContain('"tags" (rank 2) entered inside "aliases" (rank 3)')
})

test('Store.quarantine: the new path once moved; undefined when the move fails, and the file stays', async () => {
  const d = docStore({ [PATH]: 'garbage' })
  expect(await d.store.quarantine()).toBe(`${PATH}.bad-7`)
  const f = docStore({ [PATH]: 'garbage' })
  f.fail.move = true
  expect(await f.store.quarantine()).toBeUndefined()
  expect(f.files.get(PATH)).toBe('garbage')
})

test('updateOf / changeOf — контракти портів: Update skips an unreadable file and an unchanged value; Change sees the unreadable read; both resolve true once written', async () => {
  const bad = docStore({ [PATH]: 'garbage' })
  let called = 0
  expect(await updateOf(bad.store)(d => (called++, { n: d.n + 1 }))).toBe(false)
  expect(called).toBe(0)
  const seen: string[] = []
  expect(await changeOf(bad.store)(read => (seen.push(read.state), read.state === 'unreadable' ? { n: 1 } : undefined))).toBe(true)
  expect(seen).toEqual(['unreadable'])
  const ok = docStore({ [PATH]: '{"n":4}' })
  expect(await updateOf(ok.store)(d => d)).toBe(false)
  expect(await changeOf(ok.store)(read => (read.state === 'ok' ? read.value : undefined))).toBe(false)
  expect(await updateOf(ok.store)(d => ({ n: d.n * 2 }))).toBe(true)
  expect(ok.files.get(PATH)).toBe('{"n":8}')
  expect(ok.log).toEqual([`write ${PATH}`])
})

test('carry — у сховище іншої сесії: missing writes nothing; ok is changed and written into the new folder; unreadable rejects with the name', async () => {
  const m = memFiles({ '/s/old/doc.json': '{"n":3}', '/s/bad/doc.json': '{"n":-1}' })
  const at = (dir: string) => jsonFile<Doc>(m.fs, `${dir}/doc.json`, () => ({ n: 0 }), parseDoc)
  expect(await carry(at('/s/none'), at('/s/new'), d => d, 'the doc')).toBe('missing')
  expect(m.files.has('/s/new/doc.json')).toBe(false)
  expect(await carry(at('/s/old'), at('/s/new'), d => ({ ...d, tag: 'carried' }), 'the doc')).toBe('carried')
  expect(m.files.get('/s/new/doc.json')).toBe('{"n":3,"tag":"carried"}')
  expect(await carry(at('/s/bad'), at('/s/new2'), d => d, 'the doc').then(String, err => String(err))).toBe('Error: the doc of the old session cannot be read (bad field(s): n)')
  expect(m.files.has('/s/new2/doc.json')).toBe(false)
})

// ---- [PL_AUD_CTX_P7] the shared helpers of the storage parsers

test('bytes, isCount, jsonObject: the JSON size in UTF-8 bytes; integers from a minimum; the parse prologue', async () => {
  expect(bytes({ a: 'é' })).toBe(10)
  expect(isCount(0)).toBe(true)
  expect(isCount(0, 1)).toBe(false)
  expect(isCount(1.5)).toBe(false)
  expect(isCount('1')).toBe(false)
  expect(jsonObject('{"a":1}')).toEqual({ state: 'ok', value: { a: 1 } })
  expect(jsonObject('null')).toEqual({ state: 'unreadable', reason: 'not an object' })
  expect(jsonObject('[]')).toEqual({ state: 'unreadable', reason: 'not an object' })
  expect(jsonObject('{').state).toBe('unreadable')
})

test('trimOldest: the newest maxItems stay; then the oldest go while the framed file exceeds maxBytes; the same array when nothing goes', async () => {
  const items = ['aa', 'bb', 'cc', 'dd']
  expect(trimOldest(items, 10, 1000)).toBe(items)
  expect(trimOldest(items, 2, 1000)).toEqual(['cc', 'dd'])
  // ["cc","dd"] is 11 bytes; framed as {"items":[...]} 21
  expect(trimOldest(items, 10, bytes(['cc', 'dd']))).toEqual(['cc', 'dd'])
  expect(trimOldest(items, 10, 21, i => ({ items: i }))).toEqual(['cc', 'dd'])
  expect(trimOldest(items, 10, 1)).toEqual([])
})

// ---- [SP_CTX_01_07] [PL_AUD_CTX_P11] the cache of storage files (CF-22, X1)

// Files in memory that count the host's calls per path.
function countedFiles(init: Record<string, string> = {}) {
  const m = memFiles(init)
  const calls = { exists: 0, read: 0 }
  const fs: FileIO = {
    ...m.fs,
    exists: async path => (calls.exists++, m.fs.exists(path)),
    read: async path => (calls.read++, m.fs.read(path)),
  }
  return { ...m, fs, calls }
}

test('FileCache — читання з кешу: a view (cached) after a read takes no host call; a write replaces the entry with what it wrote; peek gives it without waiting', async () => {
  const cache = newFileCache()
  const f = countedFiles({ [PATH]: '{"n":1}' })
  const store = jsonFile<Doc>(f.fs, PATH, () => ({ n: 0 }), parseDoc, { cache })
  expect(store.peek()).toBeUndefined()
  expect(await store.cached()).toEqual({ state: 'ok', value: { n: 1 } })
  expect(await store.cached()).toEqual({ state: 'ok', value: { n: 1 } })
  expect(f.calls).toEqual({ exists: 1, read: 1 })
  // another store of the same file (a new port each event) shares the entry
  const again = jsonFile<Doc>(f.fs, PATH, () => ({ n: 0 }), parseDoc, { cache })
  expect(again.peek()).toEqual({ state: 'ok', value: { n: 1 } })
  // a read-modify-write reads the file, whatever the cache holds
  expect(await updateOf(again)(d => ({ n: d.n + 1 }))).toBe(true)
  expect(f.calls).toEqual({ exists: 2, read: 2 })
  expect(f.files.get(PATH)).toBe('{"n":2}')
  expect(await store.cached()).toEqual({ state: 'ok', value: { n: 2 } })
  expect(f.calls).toEqual({ exists: 2, read: 2 })
  // missing is kept too
  const fresh = countedFiles()
  const doc = jsonFile<Doc>(fresh.fs, PATH, () => ({ n: 0 }), parseDoc, { cache: newFileCache() })
  expect(await doc.cached()).toEqual({ state: 'missing', value: { n: 0 } })
  expect(await doc.cached()).toEqual({ state: 'missing', value: { n: 0 } })
  expect(fresh.calls.exists).toBe(1)
})

test('FileCache — другий записувач: the cache holds n:1, the file is changed past the Store to n:5; an update +1 writes 6 (it reads the file), and the view follows', async () => {
  const cache = newFileCache()
  const f = countedFiles({ [PATH]: '{"n":1}' })
  const store = jsonFile<Doc>(f.fs, PATH, () => ({ n: 0 }), parseDoc, { cache })
  expect(await store.cached()).toEqual({ state: 'ok', value: { n: 1 } })
  f.files.set(PATH, '{"n":5}')
  // a view may lag until the next read of the file
  expect(await store.cached()).toEqual({ state: 'ok', value: { n: 1 } })
  expect(await updateOf(store)(d => ({ n: d.n + 1 }))).toBe(true)
  expect(f.files.get(PATH)).toBe('{"n":6}')
  expect(await store.cached()).toEqual({ state: 'ok', value: { n: 6 } })
})

test('FileCache — читання під час запису чи перенесення: a read that starts while a write or a move is in flight and saw the old file keeps nothing; the write\'s own entry stands', async () => {
  const cache = newFileCache()
  const m = memFiles({ [PATH]: '{"n":1}' })
  let openWrite: () => void = () => undefined
  const writeGate = new Promise<void>(r => (openWrite = r))
  let openRead: () => void = () => undefined
  const readGate = new Promise<void>(r => (openRead = r))
  const fs: FileIO = {
    ...m.fs,
    write: async (path, text) => {
      await writeGate
      m.files.set(path, text)
    },
    read: async path => {
      const text = m.files.get(path)!
      await readGate
      return text
    },
  }
  const store = jsonFile<Doc>(fs, PATH, () => ({ n: 0 }), parseDoc, { cache })
  const writing = store.write({ n: 2 })
  await yields()
  const reading = store.read()
  await yields()
  openWrite()
  await writing
  expect(store.peek()).toEqual({ state: 'ok', value: { n: 2 } })
  openRead()
  expect(await reading).toEqual({ state: 'ok', value: { n: 1 } })
  expect(m.files.get(PATH)).toBe('{"n":2}')
  expect(store.peek()).toEqual({ state: 'ok', value: { n: 2 } })

  // the same for a quarantine: a read during the move never caches the moved file as ok
  const q = memFiles({ [PATH]: '{"n":3}' })
  let openMove: () => void = () => undefined
  const moveGate = new Promise<void>(r => (openMove = r))
  let openRead2: () => void = () => undefined
  const readGate2 = new Promise<void>(r => (openRead2 = r))
  const qfs: FileIO = {
    ...q.fs,
    move: async (from, to) => (await moveGate, q.fs.move(from, to)),
    read: async path => {
      const text = q.files.get(path)!
      await readGate2
      return text
    },
  }
  const qs = jsonFile<Doc>(qfs, PATH, () => ({ n: 0 }), parseDoc, { cache: newFileCache() })
  const moving = qs.quarantine()
  await yields()
  const during = qs.read()
  await yields()
  openMove()
  expect(await moving).toBe(`${PATH}.bad-7`)
  openRead2()
  expect(await during).toEqual({ state: 'ok', value: { n: 3 } })
  expect(qs.peek()).toBeUndefined()
  expect(await qs.cached()).toEqual({ state: 'missing', value: { n: 0 } })
})

test('FileCache — не кешується: an unreadable read, a failed write and a quarantine leave no entry; the next read goes to the file', async () => {
  const cache = newFileCache()
  const f = countedFiles({ [PATH]: '{"n":-1}' })
  const store = jsonFile<Doc>(f.fs, PATH, () => ({ n: 0 }), parseDoc, { cache })
  expect((await store.read()).state).toBe('unreadable')
  expect((await store.read()).state).toBe('unreadable')
  expect(f.calls.read).toBe(2)
  // repaired by hand: read again, then kept
  f.files.set(PATH, '{"n":4}')
  expect(await store.read()).toEqual({ state: 'ok', value: { n: 4 } })
  f.fail.write = true
  await expect(store.write({ n: 5 })).rejects.toThrow('disk full')
  expect(store.peek()).toBeUndefined()
  f.fail.write = false
  expect(await store.read()).toEqual({ state: 'ok', value: { n: 4 } })
  expect(await store.quarantine()).toBe(`${PATH}.bad-7`)
  expect(store.peek()).toBeUndefined()
  expect(await store.read()).toEqual({ state: 'missing', value: { n: 0 } })
})

test('FileCache — читання, яке обігнав запис: a read in flight when the file is written keeps nothing; the entry is the written value', async () => {
  const cache = newFileCache()
  const m = memFiles({ [PATH]: '{"n":1}' })
  let open: () => void = () => undefined
  const gate = new Promise<void>(r => (open = r))
  const fs: FileIO = {
    ...m.fs,
    read: async path => {
      const text = m.files.get(path)!
      await gate
      return text
    },
  }
  const store = jsonFile<Doc>(fs, PATH, () => ({ n: 0 }), parseDoc, { cache })
  const slow = store.read()
  await yields()
  await store.write({ n: 2 })
  open()
  expect(await slow).toEqual({ state: 'ok', value: { n: 1 } })
  expect(store.peek()).toEqual({ state: 'ok', value: { n: 2 } })
})

test('FileCache — зміна сесії: a published storage drops every entry; a read of the session left and come back to sees the file as it is now', async () => {
  const cache = newFileCache()
  const mem = newStorageMemory()
  const h = host('A', { published: () => dropFileCache(cache) })
  const dirA = dirOf(await ensureStorage(mem, h.io))!
  const pathA = `${dirA}/doc.json`
  const f = countedFiles({ [pathA]: '{"n":1}' })
  const inA = () => jsonFile<Doc>(f.fs, pathA, () => ({ n: 0 }), parseDoc, { cache })
  expect(await inA().cached()).toEqual({ state: 'ok', value: { n: 1 } })
  expect(inA().peek()).toEqual({ state: 'ok', value: { n: 1 } })
  // /clear: session B is published, the cache drops
  h.log.session = 'B'
  expect(dirOf(await ensureStorage(mem, h.io))).toBe('/home/u/.claude/context-editor/B')
  expect(inA().peek()).toBeUndefined()
  // meanwhile session A's file changed past this instance (another process)
  f.files.set(pathA, '{"n":9}')
  // /resume back to A: published again, read from the file
  h.log.session = 'A'
  expect(dirOf(await ensureStorage(mem, h.io))).toBe(dirA)
  expect(await inA().cached()).toEqual({ state: 'ok', value: { n: 9 } })
  expect(f.calls.read).toBe(2)
})

test('FileCache — скидання під час читання: a read that a drop overtook keeps nothing in the new epoch', async () => {
  const cache = newFileCache()
  const m = memFiles({ [PATH]: '{"n":1}' })
  let open: () => void = () => undefined
  const gate = new Promise<void>(r => (open = r))
  const fs: FileIO = { ...m.fs, read: async path => (await gate, m.files.get(path)!) }
  const store = jsonFile<Doc>(fs, PATH, () => ({ n: 0 }), parseDoc, { cache })
  const slow = store.read()
  await yields()
  dropFileCache(cache)
  open()
  await slow
  expect(store.peek()).toBeUndefined()
  // a store without a cache never peeks
  expect(jsonFile<Doc>(m.fs, PATH, () => ({ n: 0 }), parseDoc).peek()).toBeUndefined()
})

test('PrepareStorage — RestoreSession: restored before mkdir; a .zip that stays gives the reason', async () => {
  const calls: string[] = []
  const ok = host('A', { restore: async (base, id) => (calls.push(`${base}|${id}`), true) })
  expect(await prepareStorage(newStorageMemory(), ok.io, 'A')).toEqual({ dir: '/home/u/.claude/context-editor/A', sessionId: 'A' })
  expect(calls).toEqual(['/home/u/.claude/context-editor|A'])
  const packed = host('A', { restore: async () => false })
  expect(await prepareStorage(newStorageMemory(), packed.io, 'A')).toEqual({ reason: 'packed storage cannot be restored', sessionId: 'A' })
  expect(packed.log.mkdirs).toEqual([])
  expect(packed.log.afters).toEqual([])
  const thrown = host('A', {
    restore: async () => {
      throw new Error('x')
    },
  })
  expect(await prepareStorage(newStorageMemory(), thrown.io, 'A')).toEqual({ reason: 'packed storage cannot be restored', sessionId: 'A' })
})
