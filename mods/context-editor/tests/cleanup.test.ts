import { expect, test } from 'claude-code/testing'
import {
  choosePacker,
  needsRestore,
  ownArchives,
  packCommands,
  PACKED_REASON,
  unpackCommands,
  PACK_IDLE_MS,
  restoreSession,
  sweepSessions,
  SWEEP_EVERY_MS,
  SWEEP_GRACE_MS,
  SWEEP_LOCK_MS,
  SWEEP_MAX,
  type CleanupIO,
  type Packer,
} from '../hooks/cleanup'

const HOME = '/h'
const ROOT = `${HOME}/.claude/context-editor`
const NOW = 10_000_000_000
const DAY = 86_400_000
const W = { home: HOME, config: `${HOME}/.claude`, current: 'cur' }

type Node = { kind: 'file' | 'dir'; mtime: number; text?: string; packed?: Map<string, Node> }

// An in-memory file system: every folder is a node of its own.
function fakeFs(packer: Packer = 'zip') {
  const nodes = new Map<string, Node>()
  const fail = { pack: false, unpack: false }
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'))
  const mkdirs = (p: string, mtime: number) => {
    for (let d = p; d && !nodes.has(d); d = parent(d)) nodes.set(d, { kind: 'dir', mtime })
  }
  const file = (p: string, text = 'x', mtime = NOW) => {
    mkdirs(parent(p), mtime)
    nodes.set(p, { kind: 'file', mtime, text })
  }
  const dir = (p: string, mtime = NOW) => mkdirs(p, mtime)
  const under = (p: string) => [...nodes.keys()].filter(k => k === p || k.startsWith(`${p}/`))
  const io: CleanupIO = {
    now: () => NOW,
    list: async d =>
      nodes.get(d)?.kind === 'dir'
        ? [...nodes.entries()].filter(([k]) => parent(k) === d).map(([k, n]) => ({ name: k.slice(d.length + 1), kind: n.kind }))
        : undefined,
    mtime: async p => nodes.get(p)?.mtime,
    exists: async p => nodes.has(p),
    lines: async p => (nodes.get(p)?.text ?? '').split('\n').filter(Boolean),
    write: async (p, text) => (file(p, text), true),
    lock: async p => (nodes.has(p) ? false : (dir(p), true)),
    remove: async p => (under(p).forEach(k => nodes.delete(k)), true),
    rename: async (from, to) => {
      if (!nodes.has(from) || nodes.has(to)) return false
      for (const k of under(from)) {
        nodes.set(to + k.slice(from.length), nodes.get(k)!)
        nodes.delete(k)
      }
      return true
    },
    packer: async () => packer,
    pack: async (_p, folder, zip) => {
      if (fail.pack) return false
      const snap = new Map<string, Node>()
      for (const k of under(folder)) if (k !== folder) snap.set(k.slice(folder.length), nodes.get(k)!)
      mkdirs(parent(zip), NOW)
      nodes.set(zip, { kind: 'file', mtime: NOW, packed: snap })
      return true
    },
    unpack: async (_p, zip, folder, keep) => {
      const z = nodes.get(zip)
      if (fail.unpack || !z?.packed) return false
      dir(folder)
      for (const [rel, n] of z.packed) if (!keep || !nodes.has(folder + rel)) nodes.set(folder + rel, n)
      return true
    },
  }
  return { io, nodes, file, dir, fail }
}

// A session `id` touched `age` ago, with its archive folder in the project.
function session(fs: ReturnType<typeof fakeFs>, id: string, age: number, archives = true) {
  const t = NOW - age
  fs.file(`${ROOT}/${id}/tags.json`, '{}', t)
  fs.nodes.get(`${ROOT}/${id}`)!.mtime = t
  if (archives) {
    const a = `/p/.claude/context-editor/${id}`
    fs.file(`${ROOT}/${id}/archives.txt`, `${a}\n`, t)
    fs.file(`${a}/1.json`, '[]', t)
  }
}

function transcripts(fs: ReturnType<typeof fakeFs>, ...ids: string[]) {
  fs.dir(`${HOME}/.claude/projects`)
  for (const id of ids) fs.file(`${HOME}/.claude/projects/-p/${id}.jsonl`)
}

test('SweepSessions: a session without a transcript, idle past the grace, goes with its archives', async () => {
  const fs = fakeFs()
  session(fs, 'gone', 2 * DAY)
  fs.file(`/p/.claude/context-editor/gone.zip`)
  transcripts(fs, 'other')
  const out = await sweepSessions(fs.io, W)
  expect(out).toEqual({ removed: 1, packed: 0 })
  expect(fs.nodes.has(`${ROOT}/gone`)).toBe(false)
  expect(fs.nodes.has('/p/.claude/context-editor/gone')).toBe(false)
  expect(fs.nodes.has('/p/.claude/context-editor/gone.zip')).toBe(false)
  expect(fs.nodes.has(`${ROOT}/.sweep.lock`)).toBe(false)
  expect(fs.nodes.has(`${ROOT}/.sweep`)).toBe(true)
})

test('SweepSessions: a transcript, a fresh session or the current one stay', async () => {
  const fs = fakeFs()
  session(fs, 'live', 2 * DAY)
  session(fs, 'fresh', DAY / 2)
  session(fs, 'cur', 30 * DAY)
  transcripts(fs, 'live')
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 0 })
  for (const id of ['live', 'fresh', 'cur']) expect(fs.nodes.has(`${ROOT}/${id}`)).toBe(true)
})

test('SweepSessions: idle past PACK_IDLE_MS with a transcript is packed; without a packer it stays', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  transcripts(fs, 'old')
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 1 })
  expect(fs.nodes.has(`${ROOT}/old`)).toBe(false)
  expect(fs.nodes.has(`${ROOT}/old.zip`)).toBe(true)
  expect(fs.nodes.has('/p/.claude/context-editor/old')).toBe(false)
  expect(fs.nodes.has('/p/.claude/context-editor/old.zip')).toBe(true)
  expect(fs.nodes.get(`${ROOT}/old.where`)?.text).toBe('/p/.claude/context-editor/old\n')

  const none = fakeFs('none')
  session(none, 'old', PACK_IDLE_MS + DAY)
  transcripts(none, 'old')
  expect(await sweepSessions(none.io, W)).toEqual({ removed: 0, packed: 0 })
  expect(none.nodes.has(`${ROOT}/old`)).toBe(true)
})

test('SweepSessions: once per SWEEP_EVERY_MS, one sweeper; a stale lock is taken over', async () => {
  const fs = fakeFs()
  session(fs, 'gone', 2 * DAY)
  transcripts(fs, 'other')
  fs.file(`${ROOT}/.sweep`, '', NOW - SWEEP_EVERY_MS / 2)
  expect(await sweepSessions(fs.io, W)).toEqual({ skipped: 'swept recently' })
  fs.nodes.delete(`${ROOT}/.sweep`)
  fs.dir(`${ROOT}/.sweep.lock`, NOW - 1000)
  expect(await sweepSessions(fs.io, W)).toEqual({ skipped: 'another sweep runs' })
  fs.nodes.get(`${ROOT}/.sweep.lock`)!.mtime = NOW - SWEEP_LOCK_MS
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 1, packed: 0 })
})

test('SweepSessions: unreadable transcripts delete nothing; a foreign archive path is kept', async () => {
  const fs = fakeFs()
  session(fs, 'gone', 2 * DAY)
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 0 })
  expect(fs.nodes.has(`${ROOT}/gone`)).toBe(true)

  const other = fakeFs()
  session(other, 'gone', 2 * DAY, false)
  other.file(`${ROOT}/gone/archives.txt`, '/p/src\n', NOW - 2 * DAY)
  other.file('/p/src/main.ts')
  transcripts(other, 'other')
  expect(await sweepSessions(other.io, W)).toEqual({ removed: 1, packed: 0 })
  expect(other.nodes.has('/p/src/main.ts')).toBe(true)
})

test('SweepSessions: at most SWEEP_MAX actions, oldest first; a packed session without a transcript goes', async () => {
  const fs = fakeFs()
  for (let i = 0; i < SWEEP_MAX + 2; i++) session(fs, `s${i}`, 2 * DAY + i * 1000, false)
  fs.file(`${ROOT}/z.zip`, '', NOW - 3 * DAY)
  fs.file(`${ROOT}/z.where`, '/p/.claude/context-editor/z\n', NOW - 3 * DAY)
  fs.file('/p/.claude/context-editor/z.zip', '', NOW - 3 * DAY)
  transcripts(fs, 'other')
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: SWEEP_MAX, packed: 0 })
  expect(fs.nodes.has(`${ROOT}/z.zip`)).toBe(false)
  expect(fs.nodes.has('/p/.claude/context-editor/z.zip')).toBe(false)
  // z and the 49 oldest folders go; the three newest stay
  for (const id of ['s0', 's1', 's2']) expect(fs.nodes.has(`${ROOT}/${id}`)).toBe(true)
  expect(fs.nodes.has(`${ROOT}/s3`)).toBe(false)
  expect(SWEEP_GRACE_MS).toBe(DAY)
})

test('PackSession: a failed pack leaves the folders and no .zip.part', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  transcripts(fs, 'old')
  fs.fail.pack = true
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 0 })
  expect(fs.nodes.has(`${ROOT}/old`)).toBe(true)
  expect(fs.nodes.has('/p/.claude/context-editor/old/1.json')).toBe(true)
  expect([...fs.nodes.keys()].some(k => k.endsWith('.zip.part') || k.endsWith('.zip'))).toBe(false)
})

test('Packer: zip and unzip, else bsdtar, else none', () => {
  expect(choosePacker(true, true, 'tar (GNU tar) 1.35')).toBe('zip')
  expect(choosePacker(true, false, 'bsdtar 3.7.4 - libarchive 3.7.4')).toBe('bsdtar')
  expect(choosePacker(false, false, 'tar (GNU tar) 1.35')).toBe('none')
  expect(choosePacker(false, false, undefined)).toBe('none')
})

test('RestoreSession: a packed session comes back under the same paths', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  transcripts(fs, 'old')
  await sweepSessions(fs.io, W)
  expect(await restoreSession(fs.io, ROOT, 'old')).toBe(true)
  expect(fs.nodes.get(`${ROOT}/old/tags.json`)?.text).toBe('{}')
  expect(fs.nodes.get('/p/.claude/context-editor/old/1.json')?.text).toBe('[]')
  for (const p of [`${ROOT}/old.zip`, `${ROOT}/old.where`, '/p/.claude/context-editor/old.zip', `${ROOT}/old.part`]) expect(fs.nodes.has(p)).toBe(false)
})

test('RestoreSession: a folder and its .zip both there (a pack cut short) keep the folder\'s files; nothing packed is a no-op', async () => {
  const fs = fakeFs()
  session(fs, 's', DAY, false)
  fs.nodes.set(`${ROOT}/s.zip`, { kind: 'file', mtime: NOW, packed: new Map([['/tags.json', { kind: 'file', mtime: NOW, text: 'zipped' }]]) })
  expect(await restoreSession(fs.io, ROOT, 's')).toBe(true)
  expect(fs.nodes.has(`${ROOT}/s.zip`)).toBe(false)
  expect(fs.nodes.get(`${ROOT}/s/tags.json`)?.text).toBe('{}')
  expect(await restoreSession(fs.io, ROOT, 'new')).toBe(true)
})

test('RestoreSession: a broken .zip or no tool keeps the .zip and says false', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  transcripts(fs, 'old')
  await sweepSessions(fs.io, W)
  fs.fail.unpack = true
  expect(await restoreSession(fs.io, ROOT, 'old')).toBe(false)
  expect(fs.nodes.has(`${ROOT}/old.zip`)).toBe(true)
  expect(fs.nodes.has(`${ROOT}/old.part`)).toBe(false)

  const none = fakeFs('none')
  none.file(`${ROOT}/x.zip`)
  expect(await restoreSession(none.io, ROOT, 'x')).toBe(false)
})

test('SweepSessions: no transcript found at all deletes nothing; CLAUDE_CONFIG_DIR names the projects folder', async () => {
  const fs = fakeFs()
  session(fs, 'gone', 2 * DAY)
  fs.dir(`${HOME}/.claude/projects`)
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 0 })
  expect(fs.nodes.has(`${ROOT}/gone`)).toBe(true)

  const cfg = fakeFs()
  session(cfg, 'live', 2 * DAY)
  cfg.file(`/cfg/projects/-p/live.jsonl`)
  cfg.file(`${HOME}/.claude/projects/-p/stale.jsonl`)
  expect(await sweepSessions(cfg.io, { ...W, config: '/cfg' })).toEqual({ removed: 0, packed: 0 })
  expect(cfg.nodes.has(`${ROOT}/live`)).toBe(true)
})

test('PackSession: a stale .zip.part goes first; a foreign or $HOME archive path is neither packed nor removed', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY, false)
  fs.file(`${ROOT}/old/archives.txt`, `/p/src\n${ROOT}/old\n/p/.claude/context-editor/old\n`, NOW - PACK_IDLE_MS - DAY)
  fs.file('/p/src/main.ts')
  fs.file('/p/.claude/context-editor/old/1.json', '[]', NOW - PACK_IDLE_MS - DAY)
  fs.file(`${ROOT}/old.zip.part`, 'stale')
  transcripts(fs, 'old')
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 1 })
  expect(fs.nodes.has('/p/src/main.ts')).toBe(true)
  expect(fs.nodes.has('/p/src.zip')).toBe(false)
  expect(fs.nodes.get(`${ROOT}/old.zip`)?.packed?.has('/tags.json')).toBe(true)
  expect(fs.nodes.get(`${ROOT}/old.where`)?.text).toBe('/p/.claude/context-editor/old\n')
})

test('PackSession and RestoreSession: two archive folders (two cwds) both packed and restored', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  fs.nodes.get(`${ROOT}/old/archives.txt`)!.text = '/p/.claude/context-editor/old\n/q/.claude/context-editor/old\n'
  fs.file('/q/.claude/context-editor/old/2.json', '[2]', NOW - PACK_IDLE_MS - DAY)
  transcripts(fs, 'old')
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 1 })
  expect(fs.nodes.has('/q/.claude/context-editor/old.zip')).toBe(true)
  expect(await restoreSession(fs.io, ROOT, 'old')).toBe(true)
  expect(fs.nodes.get('/q/.claude/context-editor/old/2.json')?.text).toBe('[2]')
  expect(fs.nodes.get('/p/.claude/context-editor/old/1.json')?.text).toBe('[]')
})

test('RestoreSession: a folder made anew after the pack is merged with its .zip, the new files kept', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  transcripts(fs, 'old')
  await sweepSessions(fs.io, W)
  fs.file(`${ROOT}/old/deliveries.json`, 'new')
  fs.file(`${ROOT}/old/tags.json`, 'newer')
  expect(await restoreSession(fs.io, ROOT, 'old')).toBe(true)
  expect(fs.nodes.get(`${ROOT}/old/tags.json`)?.text).toBe('newer')
  expect(fs.nodes.get(`${ROOT}/old/deliveries.json`)?.text).toBe('new')
  expect(fs.nodes.get(`${ROOT}/old/archives.txt`)?.text).toBe('/p/.claude/context-editor/old\n')
  expect(fs.nodes.has(`${ROOT}/old.zip`)).toBe(false)
  expect(fs.nodes.get('/p/.claude/context-editor/old/1.json')?.text).toBe('[]')
})

test('Packer commands: bsdtar is told the zip format; keep never overwrites', () => {
  expect(packCommands('bsdtar', '/f', '/f.zip.part')[0]!.argv).toEqual(['tar', '--format', 'zip', '-cf', '/f.zip.part', '-C', '/f', '.'])
  expect(packCommands('zip', '/f', '/f.zip.part')).toEqual([{ argv: ['zip', '-qrX', '/f.zip.part', '.'], cwd: '/f' }, { argv: ['unzip', '-tq', '/f.zip.part'] }])
  expect(packCommands('none', '/f', '/z')).toEqual([])
  expect(unpackCommands('zip', '/z', '/f', true)[0]!.argv).toEqual(['unzip', '-qn', '/z', '-d', '/f'])
  expect(unpackCommands('zip', '/z', '/f', false)[0]!.argv).toEqual(['unzip', '-qo', '/z', '-d', '/f'])
  expect(unpackCommands('bsdtar', '/z', '/f', true)[0]!.argv).toEqual(['tar', '-xkf', '/z', '-C', '/f'])
})

test('ownArchives: absolute, no dot segments, its own id, never the storage', () => {
  expect(ownArchives('/p/.claude/context-editor/s', 's', ROOT)).toBe(true)
  expect(ownArchives('p/.claude/context-editor/s', 's', ROOT)).toBe(false)
  expect(ownArchives('/p/../x/.claude/context-editor/s', 's', ROOT)).toBe(false)
  expect(ownArchives('/p/.claude/context-editor/t', 's', ROOT)).toBe(false)
  expect(ownArchives(`${ROOT}/s`, 's', ROOT)).toBe(false)
})

test('NeedsRestore: not restored, folder gone, or a .zip back; else no', async () => {
  const fs = fakeFs()
  fs.dir(`${ROOT}/s`)
  expect(await needsRestore(fs.io, `${ROOT}/s`, undefined)).toBe(false)
  expect(await needsRestore(fs.io, `${ROOT}/t`, undefined)).toBe(true)
  fs.file(`${ROOT}/s.zip`)
  expect(await needsRestore(fs.io, `${ROOT}/s`, undefined)).toBe(true)
  expect(await needsRestore(fs.io, undefined, PACKED_REASON)).toBe(true)
  expect(await needsRestore(fs.io, undefined, 'HOME is not set')).toBe(false)
})

test('RestoreSession: an archive .zip that stays keeps .where and does not take the storage away', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  transcripts(fs, 'old')
  await sweepSessions(fs.io, W)
  fs.nodes.get('/p/.claude/context-editor/old.zip')!.packed = undefined
  expect(await restoreSession(fs.io, ROOT, 'old')).toBe(true)
  expect(fs.nodes.has(`${ROOT}/old/tags.json`)).toBe(true)
  expect(fs.nodes.has('/p/.claude/context-editor/old.zip')).toBe(true)
  expect(fs.nodes.has(`${ROOT}/old.where`)).toBe(true)
})

test('archivesOf: a folder only .where names (after a merge) is still restored and removed', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  transcripts(fs, 'old')
  await sweepSessions(fs.io, W)
  fs.dir(`${ROOT}/old`)
  fs.file(`${ROOT}/old/tags.json`, 'live')
  expect(await restoreSession(fs.io, ROOT, 'old')).toBe(true)
  expect(fs.nodes.get('/p/.claude/context-editor/old/1.json')?.text).toBe('[]')
})

test('PackSession: a .zip already beside a folder is never packed over', async () => {
  const fs = fakeFs()
  session(fs, 'old', PACK_IDLE_MS + DAY)
  fs.nodes.set(`${ROOT}/old.zip`, { kind: 'file', mtime: NOW, packed: new Map([['/only-in-zip.json', { kind: 'file', mtime: NOW, text: 'z' }]]) })
  transcripts(fs, 'old')
  expect(await sweepSessions(fs.io, W)).toEqual({ removed: 0, packed: 0 })
  expect(fs.nodes.get(`${ROOT}/old.zip`)?.packed?.has('/only-in-zip.json')).toBe(true)
  expect(fs.nodes.has(`${ROOT}/old`)).toBe(true)
})

test('SweepSessions: a stale lock renamed while another taker made a fresh one is given back', async () => {
  const fs = fakeFs()
  session(fs, 'gone', 2 * DAY)
  transcripts(fs, 'other')
  fs.dir(`${ROOT}/.sweep.lock`, NOW - SWEEP_LOCK_MS)
  const rename = fs.io.rename
  let first = true
  fs.io.rename = async (from, to) => {
    // the other taker's fresh lock is what gets renamed
    if (first && from.endsWith('.sweep.lock')) fs.nodes.get(from)!.mtime = NOW
    first = false
    return rename(from, to)
  }
  expect(await sweepSessions(fs.io, W)).toEqual({ skipped: 'another sweep runs' })
  expect(fs.nodes.get(`${ROOT}/.sweep.lock`)?.mtime).toBe(NOW)
  expect(fs.nodes.has(`${ROOT}/gone`)).toBe(true)
})
