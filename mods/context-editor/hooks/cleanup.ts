// [SP_CTX_02_50] [SP_CTX_02_51] [SP_CTX_02_52] [C_CTX_DEC_29] The data of old
// sessions: deleted once the host deleted the session's transcript, packed
// into `.zip` once nobody opened it for PACK_IDLE_MS, restored before the mod
// or the agent reads it again. Pure: register.ts binds CleanupIO to `$`.

import { PACKED_REASON, SESSION_ID } from './store'

export { PACKED_REASON }

export const SWEEP_EVERY_MS = 86_400_000
export const SWEEP_DELAY_MS = 60_000
export const SWEEP_LOCK_MS = 3_600_000
export const PACK_IDLE_MS = 604_800_000
export const SWEEP_GRACE_MS = 86_400_000
export const SWEEP_MAX = 50

// [SP_CTX_02_51] The tool that writes and reads `.zip`; GNU tar writes a .tar
// under that name, so it is none.
export type Packer = 'zip' | 'bsdtar' | 'none'

export type CleanupEntry = { name: string; kind: 'file' | 'dir' | 'other' }

// What the sweep needs from the host. Every call resolves: a failure is
// `undefined` or `false`, never a throw.
export type CleanupIO = {
  now: () => number
  // the entries of a folder; undefined when it cannot be listed
  list: (dir: string) => Promise<readonly CleanupEntry[] | undefined>
  // the mtime of a path; undefined when it is missing
  mtime: (path: string) => Promise<number | undefined>
  exists: (path: string) => Promise<boolean>
  // the non-empty lines of a text file; none when it is missing
  lines: (path: string) => Promise<string[]>
  write: (path: string, text: string) => Promise<boolean>
  // an atomic mkdir: false when the folder exists already
  lock: (path: string) => Promise<boolean>
  // rm -rf: a missing path is no failure
  remove: (path: string) => Promise<boolean>
  // an atomic rename: false when `from` is gone or `to` exists
  rename: (from: string, to: string) => Promise<boolean>
  packer: () => Promise<Packer>
  // writes `zip` with the whole content of `folder`, then checks it
  pack: (packer: Packer, folder: string, zip: string) => Promise<boolean>
  // extracts `zip` into `folder`, made by it; `keep`: files already there stay
  unpack: (packer: Packer, zip: string, folder: string, keep: boolean) => Promise<boolean>
}

export type SweepResult = { removed: number; packed: number } | { skipped: string }

// [SP_CTX_02_51] Packer by what the probes say: zip and unzip both run, or tar
// says it is bsdtar.
export function choosePacker(zipRuns: boolean, unzipRuns: boolean, tarVersion: string | undefined): Packer {
  if (zipRuns && unzipRuns) return 'zip'
  if (tarVersion && /bsdtar/i.test(tarVersion)) return 'bsdtar'
  return 'none'
}

// [SP_CTX_02_51] The commands of a packer: write and check `zip` from
// `folder` (bsdtar is told the format: the name `.zip.part` names none).
export function packCommands(packer: Packer, folder: string, zip: string): { argv: string[]; cwd?: string }[] {
  if (packer === 'zip') return [{ argv: ['zip', '-qrX', zip, '.'], cwd: folder }, { argv: ['unzip', '-tq', zip] }]
  if (packer === 'bsdtar') return [{ argv: ['tar', '--format', 'zip', '-cf', zip, '-C', folder, '.'] }, { argv: ['tar', '-tf', zip] }]
  return []
}

// [SP_CTX_02_52] Extract `zip` into `folder` (made before); `keep`: never
// overwrite a file already there.
export function unpackCommands(packer: Packer, zip: string, folder: string, keep: boolean): { argv: string[] }[] {
  if (packer === 'zip') return [{ argv: ['unzip', keep ? '-qn' : '-qo', zip, '-d', folder] }]
  if (packer === 'bsdtar') return [{ argv: ['tar', keep ? '-xkf' : '-xf', zip, '-C', folder] }]
  return []
}

// The archive folder of session `id` is touched only under its own name: an
// absolute path without `.`/`..` segments ending in `/.claude/context-editor/<id>`,
// and never the storage itself (a session whose project root, its cwd before
// phase 47, was $HOME).
export function ownArchives(path: string, id: string, root: string): boolean {
  return (
    path.startsWith('/') &&
    !path.split('/').some(seg => seg === '.' || seg === '..') &&
    path.endsWith(`/.claude/context-editor/${id}`) &&
    path !== `${root}/${id}`
  )
}

// [SP_CTX_02_50] The archive folders of session `id`: from its archives.txt
// and from `<id>.where`; only its own.
async function archivesOf(io: CleanupIO, root: string, id: string): Promise<string[]> {
  // both: after a merge restore the storage's archives.txt may lack a folder only .where names
  const found = [...(await io.lines(`${root}/${id}/archives.txt`)), ...(await io.lines(`${root}/${id}.where`))]
  return [...new Set(found)].filter(a => ownArchives(a, id, root))
}

// [SP_CTX_02_50] The ids of the host's transcripts, `<config>/projects/*/<id>.jsonl`;
// undefined when any folder of them cannot be listed or none is found: then
// nothing is deleted.
export async function liveSessions(io: CleanupIO, config: string): Promise<Set<string> | undefined> {
  const projects = await io.list(`${config}/projects`)
  if (!projects) return undefined
  const live = new Set<string>()
  for (const p of projects) {
    if (p.kind !== 'dir') continue
    const files = await io.list(`${config}/projects/${p.name}`)
    if (!files) return undefined
    for (const f of files) if (f.name.endsWith('.jsonl')) live.add(f.name.slice(0, -'.jsonl'.length))
  }
  return live.size ? live : undefined
}

type Session = { id: string; zip: boolean; touched: number }

// The session entries of the root: `<id>` folders and `<id>.zip` files, with
// the newest mtime of each (a folder: its own and its entries').
async function sessionsOf(io: CleanupIO, root: string, entries: readonly CleanupEntry[]): Promise<Session[]> {
  const out: Session[] = []
  for (const e of entries) {
    const zip = e.kind === 'file' && e.name.endsWith('.zip')
    const id = zip ? e.name.slice(0, -'.zip'.length) : e.name
    if (!SESSION_ID.test(id) || (!zip && e.kind !== 'dir')) continue
    const path = `${root}/${e.name}`
    let touched = (await io.mtime(path)) ?? 0
    if (!zip) for (const f of (await io.list(path)) ?? []) touched = Math.max(touched, (await io.mtime(`${path}/${f.name}`)) ?? 0)
    out.push({ id, zip, touched })
  }
  // a folder and its .zip of one id: the folder decides (RestoreSession merges them)
  return out.filter(s => !s.zip || !out.some(o => !o.zip && o.id === s.id)).sort((a, b) => a.touched - b.touched)
}

// [SP_CTX_02_50] The sweeper's lock: a fresh mkdir, or a stale lock taken over
// by an atomic rename, so two takers never both win.
async function takeLock(io: CleanupIO, lock: string, now: number): Promise<boolean> {
  if (await io.lock(lock)) return true
  const held = await io.mtime(lock)
  if (held === undefined || now - held < SWEEP_LOCK_MS) return false
  const stale = `${lock}.stale-${now}-${Math.random().toString(36).slice(2, 10)}`
  if (!(await io.rename(lock, stale))) return false
  // another taker may have made a fresh lock meanwhile: then it is theirs
  const moved = await io.mtime(stale)
  if (moved === undefined || now - moved < SWEEP_LOCK_MS) {
    await io.rename(stale, lock)
    return false
  }
  await io.remove(stale)
  return io.lock(lock)
}

export type SweepWhere = { home: string; config: string; current: string }

// [SP_CTX_02_50] Sweep: at most once per SWEEP_EVERY_MS on the machine, one
// sweeper at a time; deletes the data of sessions whose transcript is gone
// and packs the ones nobody opened for PACK_IDLE_MS. `current` is never touched.
// `config`: the host's config folder, which holds `projects/`.
export async function sweepSessions(io: CleanupIO, where: SweepWhere): Promise<SweepResult> {
  const root = `${where.home}/.claude/context-editor`
  const now = io.now()
  const last = await io.mtime(`${root}/.sweep`)
  if (last !== undefined && now - last < SWEEP_EVERY_MS) return { skipped: 'swept recently' }
  const lock = `${root}/.sweep.lock`
  if (!(await takeLock(io, lock, now))) return { skipped: 'another sweep runs' }
  try {
    await io.write(`${root}/.sweep`, String(now))
    const entries = await io.list(root)
    if (!entries) return { skipped: 'the storage root cannot be listed' }
    const live = await liveSessions(io, where.config)
    let packer: Packer | undefined
    let removed = 0
    let packed = 0
    for (const s of await sessionsOf(io, root, entries)) {
      if (removed + packed >= SWEEP_MAX) break
      if (s.id === where.current) continue
      const idle = now - s.touched
      if (live && !live.has(s.id) && idle >= SWEEP_GRACE_MS) {
        if (await removeSession(io, root, s.id)) removed++
      } else if (!s.zip && idle >= PACK_IDLE_MS) {
        packer ??= await io.packer()
        if (packer !== 'none' && (await packSession(io, root, s.id, packer))) packed++
      }
    }
    return { removed, packed }
  } finally {
    await io.remove(lock)
  }
}

// [SP_CTX_02_50] Remove(id): the storage, its .zip and .where, and its own
// archive folders with their .zip.
export async function removeSession(io: CleanupIO, root: string, id: string): Promise<boolean> {
  const archives = await archivesOf(io, root, id)
  let ok = true
  for (const p of [`${root}/${id}`, `${root}/${id}.zip`, `${root}/${id}.where`]) ok = (await io.remove(p)) && ok
  for (const a of archives) for (const p of [a, `${a}.zip`]) ok = (await io.remove(p)) && ok
  return ok
}

// [SP_CTX_02_51] PackSession: every .zip written and checked before any folder
// goes; a stale .zip.part goes first; an empty archive folder is removed, not packed.
export async function packSession(io: CleanupIO, root: string, id: string, packer: Packer): Promise<boolean> {
  const archives = await archivesOf(io, root, id)
  // a .zip already beside a folder waits for RestoreSession to merge it: never packed over
  for (const f of [`${root}/${id}`, ...archives]) if (await io.exists(`${f}.zip`)) return false
  const folders = [`${root}/${id}`]
  for (const a of archives) {
    const inside = await io.list(a)
    if (inside?.length) folders.push(a)
    else if (inside) await io.remove(a)
  }
  const drop = async (fs: readonly string[]) => {
    for (const f of fs) await io.remove(`${f}.zip.part`)
  }
  for (const f of folders) {
    await io.remove(`${f}.zip.part`)
    if (!(await io.pack(packer, f, `${f}.zip.part`))) {
      await drop(folders)
      return false
    }
  }
  const packedArchives = folders.slice(1)
  if (packedArchives.length && !(await io.write(`${root}/${id}.where`, packedArchives.map(a => `${a}\n`).join('')))) {
    await drop(folders)
    return false
  }
  for (const f of folders) if (!(await io.rename(`${f}.zip.part`, `${f}.zip`))) return false
  for (const f of folders) await io.remove(f)
  return true
}

// [SP_CTX_02_52] RestoreSession: the storage first (its archives.txt then
// names the archive folders), then each archive folder. False only when the
// storage's own .zip stays.
export async function restoreSession(io: CleanupIO, root: string, id: string): Promise<boolean> {
  const where = `${root}/${id}.where`
  if (!(await restoreFolder(io, `${root}/${id}`))) return false
  // an archive folder that stays packed does not take the storage away: its
  // .zip and .where wait for the next preparation
  let all = true
  for (const a of await archivesOf(io, root, id)) all = (await restoreFolder(io, a)) && all
  if (all && (await io.exists(where))) await io.remove(where)
  return true
}

// A .zip without its folder comes back through `.part` and a rename; a .zip
// beside its folder (a pack cut short, or a folder a live process made anew
// after the pack) is extracted into it without overwriting, then goes.
async function restoreFolder(io: CleanupIO, folder: string): Promise<boolean> {
  const zip = `${folder}.zip`
  if (!(await io.exists(zip))) return true
  const packer = await io.packer()
  if (packer === 'none') return false
  if (await io.exists(folder)) return (await io.unpack(packer, zip, folder, true)) && io.remove(zip)
  const part = `${folder}.part`
  await io.remove(part)
  if (!(await io.unpack(packer, zip, part, false)) || !(await io.rename(part, folder))) {
    await io.remove(part)
    return false
  }
  return io.remove(zip)
}

// [SP_CTX_02_52] Whether the current session's storage must be prepared anew
// at a prompt: it was not restored, its folder is gone, or a .zip of it is back.
export async function needsRestore(io: Pick<CleanupIO, 'exists'>, dir: string | undefined, reason: string | undefined): Promise<boolean> {
  if (reason === PACKED_REASON) return true
  if (!dir) return false
  return !(await io.exists(dir)) || (await io.exists(`${dir}.zip`))
}
