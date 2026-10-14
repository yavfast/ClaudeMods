import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  BRIEF_HEAD,
  briefedQueue,
  briefedTags,
  hostBinary,
  needsProbe,
  notePassCompaction,
  BRIEF_MAX,
  BRIEF_RECORDS,
  CAP_CACHE_VERSIONS,
  cacheWith,
  compactBrief,
  compactPassed,
  merge,
  newCapabilities,
  noteAttachment,
  noteCommandUnseen,
  noteOwnCompaction,
  noteTurn,
  noticeOnce,
  observePassedCompact,
  parseCapCache,
  parseProbe,
  PROBE_DELAY_MS,
  PROBE_ENV,
  PROBE_FILE,
  PROBE_MARKER,
  PROBE_PREFIX,
  PROBE_WAIT_MS,
  probeArgs,
  probeInput,
  probeSkip,
  projectDir,
  runProbe,
  scheduleProbe,
  verdict,
  type CapabilityIO,
  type CapCache,
  type Capabilities,
  type PassedCompactIO,
  type ProbeIO,
} from '../hooks/capabilities'
import { boundaryOf, fingerprint, type Boundary } from '../hooks/edits'
import { SUMMARY_OPENER } from '../hooks/deliveries'
import { EMPTY_QUEUE, type Queue } from '../hooks/queue'
import { prompt, reg, reply, result, use } from './row-fixtures'

// ---- [SP_CTX_02_53] Capabilities

test('Capabilities — вердикти і пріоритет: cache passed; then probe reached; then live passed', async () => {
  const c = newCapabilities()
  expect(verdict(c, 'compact')).toBe('unknown')
  c.cache.compact = 'passed'
  expect(verdict(c, 'compact')).toBe('passed')
  c.probe.compact = 'reached'
  expect(verdict(c, 'compact')).toBe('reached')
  noteCommandUnseen(c)
  expect(verdict(c, 'compact')).toBe('passed')
})

test('Capabilities — живі вкладення: one attachment gives reached; a turn without any gives passed', async () => {
  const c = newCapabilities()
  noteAttachment(c)
  expect(c.live.attachments).toBe('reached')
  noteTurn(c)
  expect(c.live.attachments).toBe('reached')
  expect(c.mainTurns).toBe(1)
  const none = newCapabilities()
  noteTurn(none)
  expect(none.live.attachments).toBe('passed')
})

function capHost(cache: CapCache = { entries: {} }) {
  const log = { cache, writes: 0, probes: 0, now: 100 }
  const io: CapabilityIO = {
    readCache: async () => log.cache,
    writeCache: async c => {
      log.cache = c
      log.writes++
    },
    now: () => log.now,
    scheduleProbe: () => void log.probes++,
  }
  return { io, log }
}

test('Capabilities — живе суперечить кешу: cache attachments passed, an attachment reached: the entry goes, one probe, the live verdict written', async () => {
  const { io, log } = capHost({ entries: { '2.1.299': { attachments: 'passed', compact: 'passed', at: 1, source: 'probe' } } })
  const c: Capabilities = { ...newCapabilities(), version: '2.1.299', cache: { attachments: 'passed', compact: 'passed' } }
  noteAttachment(c)
  await merge(io, c, 'live')
  expect(log.probes).toBe(1)
  expect(c.cache).toEqual({ attachments: 'reached' })
  expect(log.cache.entries['2.1.299']).toEqual({ attachments: 'reached', at: 100, source: 'live' })
  // the compact verdict of the old entry is in doubt: unknown until the probe
  expect(verdict(c, 'compact')).toBe('unknown')
  await merge(io, c, 'live')
  expect(log.writes).toBe(1)
})

test('Capabilities — NoteOwnCompaction / NoteCommandUnseen: reached; passed with a cache entry of source live', async () => {
  const c = newCapabilities()
  noteOwnCompaction(c)
  expect(c.live.compact).toBe('reached')
  expect(c.ownSeen).toBe(1)
  const { io, log } = capHost()
  const d: Capabilities = { ...newCapabilities(), version: '2.1.299' }
  noteCommandUnseen(d)
  await merge(io, d, 'live')
  expect(log.cache.entries['2.1.299']).toEqual({ compact: 'passed', at: 100, source: 'live' })
})

test('Capabilities — рядок людині один раз: compact passed, 3 queued edits; the second turn says nothing', async () => {
  const c = newCapabilities()
  c.probe.compact = 'passed'
  const line = noticeOnce(c, 3)!
  expect(line).toContain("passes over the mod's compaction hooks")
  expect(line).toContain('3 queued edit(s) stay')
  expect(line).toContain('section "Managed plugin"')
  expect(noticeOnce(c, 3)).toBeUndefined()
  const both = newCapabilities()
  both.probe = { compact: 'passed', attachments: 'passed' }
  expect(noticeOnce(both, 0)).toContain('compaction and attachment hooks')
  expect(noticeOnce(newCapabilities(), 0)).toBeUndefined()
  // each capability once: attachment first, compaction when the probe ends later
  const later = newCapabilities()
  later.live.attachments = 'passed'
  expect(noticeOnce(later, 0)).toContain("the mod's attachment hooks")
  later.probe.compact = 'passed'
  expect(noticeOnce(later, 0)).toContain('compaction and attachment hooks')
  expect(noticeOnce(later, 0)).toBeUndefined()
})

test('Capabilities — без версії: nothing is read or written', async () => {
  const { io, log } = capHost()
  let reads = 0
  const c = newCapabilities()
  noteCommandUnseen(c)
  await merge({ ...io, readCache: async () => (reads++, log.cache) }, c, 'live')
  expect(reads).toBe(0)
  expect(log.writes).toBe(0)
})

test('CapabilityCache — розбір і межа версій: bad entries dropped; at most CAP_CACHE_VERSIONS by newest at', async () => {
  expect(parseCapCache('nope')).toEqual({ entries: {} })
  expect(parseCapCache(JSON.stringify({ entries: { a: { compact: 'maybe', at: 1, source: 'probe' }, b: { at: 'x' } } }))).toEqual({ entries: { a: { at: 1, source: 'probe' } } })
  let cache: CapCache = { entries: {} }
  for (let i = 0; i < CAP_CACHE_VERSIONS + 2; i++) cache = cacheWith(cache, `v${i}`, { compact: 'reached', at: i, source: 'probe' })
  expect(Object.keys(cache.entries).sort()).toEqual(['v2', 'v3', 'v4', 'v5', 'v6'])
})

// ---- [SP_CTX_02_56] RunProbe

test('RunProbe — аргументи і вхід: the probe argv, two stream-json messages, the env', async () => {
  expect(probeArgs('/bin/claude', '/mods/ce')).toEqual([
    '/bin/claude',
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--model',
    'haiku',
    '--plugin-dir',
    '/mods/ce',
  ])
  const lines = probeInput().trim().split('\n').map(l => JSON.parse(l))
  expect(lines.map(l => l.message.content)).toEqual(['hi', `/compact ${PROBE_MARKER}`])
  expect(PROBE_ENV.CONTEXT_EDITOR_PROBE).toBe('1')
  expect(PROBE_ENV.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9')
  expect(projectDir('/h/.claude/projects', '/tmp/tmp.Ab_1')).toBe('/h/.claude/projects/-tmp-tmp-Ab-1')
})

const resultLine = (text: string) => JSON.stringify({ type: 'result', result: text })

test('ParseProbe — результати: reached/reached; passed/passed; none without result or file; the version from the skip text', async () => {
  const counts = { version: '2.1.296', attachments: 9, doors: {} }
  expect(parseProbe(`{"type":"system"}\n${resultLine(`Not compacted · ${probeSkip(counts)}`)}\n`, JSON.stringify(counts))).toEqual({ compact: 'reached', attachments: 'reached', version: '2.1.296' })
  expect(parseProbe(resultLine('Not enough messages to compact.'), JSON.stringify({ version: '2.1.299', attachments: 0, doors: {} }))).toEqual({
    compact: 'passed',
    attachments: 'passed',
    version: '2.1.299',
  })
  expect(parseProbe('', undefined)).toBeUndefined()
  // PROBE_FILE not written: the counts in the skip text
  expect(parseProbe(resultLine(`Not compacted · ${PROBE_PREFIX} ${JSON.stringify(counts)}`), undefined)).toEqual({ compact: 'reached', attachments: 'reached', version: '2.1.296' })
})

function probeHost(over: Partial<ProbeIO> = {}) {
  const log = { timers: [] as { ms: number; fn: () => void }[], runs: [] as { argv: readonly string[]; cwd: string }[], removed: [] as string[], merges: 0, files: new Map<string, string>() }
  const io: ProbeIO = {
    after: (ms, fn) => void log.timers.push({ ms, fn }),
    hostExe: async () => '/opt/claude/2.1.299\n',
    tempDir: async () => '/tmp/tmp.X1\n',
    run: async (argv, init) => {
      log.runs.push({ argv, cwd: init.cwd })
      log.files.set(`${init.cwd}/${PROBE_FILE}`, JSON.stringify({ version: '2.1.299', attachments: 0, doors: {} }))
      return { stdout: resultLine('Not enough messages to compact.'), exitCode: 0 }
    },
    readFile: async path => log.files.get(path),
    remove: async paths => void log.removed.push(...paths),
    projectsDir: async () => '/h/.claude/projects',
    pluginRoot: '/mods/ce',
    merge: async () => void log.merges++,
    ...over,
  }
  return { io, log }
}

test('RunProbe — планування: one timer of PROBE_DELAY_MS per process', async () => {
  const c = newCapabilities()
  const { io, log } = probeHost()
  expect(scheduleProbe(io, c, async () => undefined)).toBe(true)
  expect(scheduleProbe(io, c, async () => undefined)).toBe(false)
  expect(log.timers.map(t => t.ms)).toEqual([PROBE_DELAY_MS])
  expect(c.probeState).toBe('planned')
})

test('RunProbe — успіх і прибирання: the host binary, the temp folder as cwd, the verdicts, both folders removed', async () => {
  const c: Capabilities = { ...newCapabilities(), version: '2.1.299' }
  const { io, log } = probeHost()
  await runProbe(io, c)
  expect(log.runs[0]!.argv[0]).toBe('/opt/claude/2.1.299')
  expect(log.runs[0]!.cwd).toBe('/tmp/tmp.X1')
  expect(c.probe).toEqual({ compact: 'passed', attachments: 'passed' })
  expect(c.probeState).toBe('done')
  expect(log.merges).toBe(1)
  expect(log.removed).toEqual(['/tmp/tmp.X1', '/h/.claude/projects/-tmp-tmp-X1'])
})

test('RunProbe — збій і інший хост: a throw leaves probe empty, folders still go; another version is discarded', async () => {
  const c: Capabilities = { ...newCapabilities(), version: '2.1.299' }
  const failing = probeHost({
    run: async () => {
      throw new Error('timeout')
    },
  })
  await runProbe(failing.io, c)
  expect(c.probe).toEqual({})
  expect(failing.log.removed.length).toBe(2)
  const other: Capabilities = { ...newCapabilities(), version: '2.1.296' }
  const { io } = probeHost()
  expect(await runProbe(io, other)).toBeUndefined()
  expect(other.probe).toEqual({})
  // no exe: `claude` from PATH
  const plain = probeHost({ hostExe: async () => undefined })
  await runProbe(plain.io, { ...newCapabilities(), version: '2.1.299' })
  expect(plain.log.runs[0]!.argv[0]).toBe('claude')
})

test('RunProbe — очікування дією: unknown while the probe runs waits for its end; a probe longer than PROBE_WAIT_MS gives unknown', async () => {
  const c = newCapabilities()
  const { io } = probeHost()
  scheduleProbe(io, c, async () => undefined)
  const waits: number[] = []
  const pending = compactPassed(c, async ms => void waits.push(ms))
  // the bound fired first: as unknown
  expect(await pending).toBe(false)
  expect(waits).toEqual([PROBE_WAIT_MS])
  const d = newCapabilities()
  scheduleProbe(io, d, async () => undefined)
  const later = compactPassed(d, () => new Promise(() => undefined))
  d.probe.compact = 'passed'
  d.probeState = 'done'
  d.settle?.()
  expect(await later).toBe(true)
  // no wait asked: the verdict now
  const e = newCapabilities()
  scheduleProbe(io, e, async () => undefined)
  expect(await compactPassed(e, () => new Promise(() => undefined), false)).toBe(false)
})

// ---- [SP_CTX_02_55] CompactBrief

function briefRows(): SessionMessage[] {
  return [prompt('task'), reply('STATE: step 2'), use('a', 'Grep', undefined, { pattern: 'x' }), result('a', 'found'), use('b', 'Read'), result('b', 'file'), reply('done reading')]
}

test('CompactBrief — зміст і порядок: head, state, the collapse summary, Leave out the call, pins, notes, records', async () => {
  const rows = briefRows()
  const r = reg({
    tags: [
      { kind: 'state', target: { anchor: fingerprint(rows[1]!), hint: 1 }, created_turn: 0 },
      { kind: 'pin', target: { anchor: fingerprint(rows[6]!), hint: 6 }, created_turn: 0 },
    ],
    notes: [{ id: 'n1', target: { tool_use_id: 'b' }, text: 'reread later', createdTurn: 0 }],
  })
  const q: Queue = {
    ...EMPTY_QUEUE,
    edits: [
      { op: 'collapse', from_index: 2, to_index: 3, summary: 'grep found x', anchors: [fingerprint(rows[2]!), fingerprint(rows[3]!)] },
      { op: 'drop', tool_use_id: 'b' },
    ],
  }
  const text = compactBrief(rows, r, q)
  const order = [BRIEF_HEAD, 'Keep this task state verbatim:\nSTATE: step 2', 'Use this summary for the rows from', 'grep found x', 'Leave out the call Read id=b', 'Keep verbatim: "done reading"', "The agent's notes: reread later (on", BRIEF_RECORDS]
  let at = -1
  for (const part of order) {
    const next = text.indexOf(part)
    expect(next).toBeGreaterThan(at)
    at = next
  }
})

test('CompactBrief — межа і ціль без рядка: whole items up to BRIEF_MAX, then the count; a target not in the rows is skipped', async () => {
  const rows = briefRows()
  const big = 'x'.repeat(3000)
  const edits = Array.from({ length: 6 }, () => ({ op: 'summarize' as const, tool_use_id: 'a', summary: big }))
  const text = compactBrief(rows, undefined, { ...EMPTY_QUEUE, edits })
  expect(text.length).toBeLessThan(BRIEF_MAX + 1)
  expect(text).toContain('more item(s) left out)')
  expect(text.endsWith(BRIEF_RECORDS)).toBe(true)
  const gone = compactBrief(rows, undefined, { ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'zz' }] })
  expect(gone).toBe(`${BRIEF_HEAD}\n\n${BRIEF_RECORDS}`)
})

// ---- [SP_CTX_02_55] ObservePassedCompact

function observeHost() {
  const log = { boundary: undefined as Boundary | undefined, tags: [] as [number, number][], cleared: 0 }
  const io: PassedCompactIO = {
    hostId: () => 'h:1',
    writeBoundary: async b => void (log.boundary = b),
    updateTags: async (before, after) => void log.tags.push([before.length, after.length]),
    clearQueue: async () => void log.cleared++,
    boundaryOf,
  }
  return { io, log }
}

test('ObservePassedCompact — оригінали + копії: the boundary over the 3 summary rows; tags pruned against the copies; the queue cleared', async () => {
  const before = briefRows()
  const copies = [prompt(`${SUMMARY_OPENER} that ran out of context.`), reply('ok'), prompt('/compact')]
  const { io, log } = observeHost()
  expect(await observePassedCompact(io, before, [...before, ...copies])).toBe('boundary')
  expect(log.boundary).toEqual(boundaryOf(copies, 'h:1'))
  expect(log.tags).toEqual([[before.length, 3]])
  expect(log.cleared).toBe(1)
})

test('ObservePassedCompact — інший порядок і без змін: no boundary (OBSERVE_NO_PREFIX) yet tags and queue; nothing when the read did not change', async () => {
  const before = briefRows()
  const after = [prompt(`${SUMMARY_OPENER}.`)]
  const { io, log } = observeHost()
  expect(await observePassedCompact(io, before, after)).toBe('no-prefix')
  expect(log.boundary).toBeUndefined()
  expect(log.tags).toEqual([[before.length, 1]])
  expect(log.cleared).toBe(1)
  const same = observeHost()
  expect(await observePassedCompact(same.io, before, before)).toBe('none')
  // a row appended meanwhile (a delivery) is no compaction
  expect(await observePassedCompact(same.io, before, [...before, prompt('typed meanwhile')])).toBe('none')
  expect(same.log.cleared).toBe(0)
})

test('RunProbe — кеш без вердикту зонда: no entry, an entry without compact, or one written from live signals plan a probe; a probe entry does not', async () => {
  expect(needsProbe(undefined)).toBe(true)
  expect(needsProbe({ attachments: 'reached', at: 1, source: 'live' })).toBe(true)
  expect(needsProbe({ compact: 'passed', at: 1, source: 'live' })).toBe(true)
  expect(needsProbe({ compact: 'reached', at: 1, source: 'probe' })).toBe(false)
})

test('RunProbe — бінарник хоста: claude or a version-named binary is used; node or nothing gives claude', async () => {
  expect(hostBinary('/home/u/.local/share/claude/versions/2.1.299\n')).toBe('/home/u/.local/share/claude/versions/2.1.299')
  expect(hostBinary('/usr/bin/claude')).toBe('/usr/bin/claude')
  expect(hostBinary('/usr/bin/node')).toBe('claude')
  expect(hostBinary(undefined)).toBe('claude')
})

test('Capabilities — чужа компактизація: a compaction of the main conversation reaching the handler gives compact reached', async () => {
  const c = newCapabilities()
  c.cache.compact = 'passed'
  notePassCompaction(c)
  expect(verdict(c, 'compact')).toBe('reached')
  expect(c.passSeen).toBe(1)
  expect(c.ownSeen).toBe(0)
})

test('ObservePassedCompact — реєстр і черга: lastApply goes, introduced → reintroduce, tags of gone rows go; the batch resets', async () => {
  const before = briefRows()
  const r = reg({ introduced: true, lastApply: { at: 1, tokensBefore: 9 }, tags: [{ kind: 'pin', target: { tool_use_id: 'a' }, created_turn: 0 }] })
  const next = briefedTags(r, before, [prompt(`${SUMMARY_OPENER}.`)])!
  expect(next.lastApply).toBeUndefined()
  expect(next.reintroduce).toBe(true)
  expect(next.tags).toEqual([])
  expect(briefedTags(reg(), [], [])).toBeUndefined()
  const q: Queue = { ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'a' }], keepCache: true, resume: false, resumePrompt: 'go', resumeSet: true }
  expect(briefedQueue(q, EMPTY_QUEUE)).toEqual({ ...q, edits: [], keepCache: false, resume: EMPTY_QUEUE.resume, resumePrompt: EMPTY_QUEUE.resumePrompt, resumeSet: false })
  expect(briefedQueue({ ...EMPTY_QUEUE }, EMPTY_QUEUE)).toBeUndefined()
})
