import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  attachmentAnswer,
  attachPort,
  attachText,
  clearedAnswers,
  emptyHostAttach,
  frozenAttachments,
  LISTING_HEAD,
  newAttachMemory,
  parseAttachment,
  parseHostAttach,
  PASS_GAP_MS,
  planAttachments,
  PREAMBLE_HEAD,
  REREAD_HEAD,
  SUPERSEDED,
  textHash,
  answersKey,
  listingNames,
  rollbackPredictions,
  verifyPredictions,
  voidAnswers,
  resetPass,
  type AttachAnswer,
  type AttachIO,
  type AttachMemory,
  type HostAttachState,
} from '../hooks/hostattach'
import { handleCompaction, observeCompaction } from '../hooks/compaction'
import { prepare } from '../hooks/edits'
import { EMPTY_QUEUE, type Queue } from '../hooks/queue'
import { telemetryText, type Telemetry } from '../hooks/stages'
import type { Read } from '../hooks/store'
import { harness } from './compaction-fixtures'
import { apiOf, missingRead, okRead, prompt, reply, result, unreadableRead, use } from './row-fixtures'

// ---- fixtures: the host's framing as the spike recorded it (2.1.296)

const P = '/w/CLAUDE.md'
const M = '/home/u/.claude/memory/MEMORY.md'
const PRE = `${PREAMBLE_HEAD} Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n`
const REREAD = `${REREAD_HEAD} these differ from their earlier copies — each replaces its earlier copy, and the instructions preamble above still applies:\n\n`
const body = (v: string) => `# Project\n\nRule A.\nVERSION-MARK: ${v}`
const sec = (path: string, text: string, desc = 'project instructions, checked into the codebase') => `Contents of ${path} (${desc}):\n\n${text}`
// the first copy: preamble, CLAUDE.md and MEMORY.md
const first = (v: string) => PRE + sec(P, body(v)) + '\n\n' + sec(M, '- memo', "user's auto-memory, persists across conversations")
// a copy after a compaction: the re-read frame and the changed file only
const reread = (v: string) => REREAD + sec(P, body(v))
const nested = (text: string) => `Contents of /w/sub/CLAUDE.md:\n\n${text}`
const listing = (names: string[]) => `${LISTING_HEAD}\n\n${names.map(n => `- ${n}: does ${n}`).join('\n')}`

type Ask = { type: string; text: string; agentId?: string }
const ins = (text: string): Ask => ({ type: 'instructions', text })
const lst = (text: string): Ask => ({ type: 'skill_listing', text })

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

// A hook port over fakes: the state file's read, the files on disk, a clock.
function hookIO(state: () => Read<HostAttachState> | undefined, files: Record<string, string> = {}, clock = { now: 1_000_000 }): AttachIO {
  return {
    decisions: async () => state(),
    readFile: async path => files[path],
    now: () => clock.now,
  }
}

// One pass of the host: every attachment asked in the conversation's order.
async function pass(mem: AttachMemory, io: AttachIO, asks: readonly Ask[]): Promise<AttachAnswer[]> {
  const out = await Promise.all(asks.map(a => attachmentAnswer(mem, io, a)))
  await flush()
  return out
}

// The text the model reads for each answer (null: left out).
const texts = (asks: readonly Ask[], answers: readonly AttachAnswer[]) => answers.map((a, i) => ('keep' in a ? asks[i]!.text : a.text))

// A fake Store of the state file: every write recorded.
function stateStore(start: Read<HostAttachState>, moved = true) {
  const log: { writes: HostAttachState[]; quarantined: number; within?: unknown } = { writes: [], quarantined: 0 }
  let now = start
  const store = {
    read: async () => now,
    write: async (s: HostAttachState) => {
      log.writes.push(s)
      now = okRead(s)
    },
    quarantine: async () => {
      log.quarantined++
      return moved ? '/s/hostattach.json.bad-1' : undefined
    },
    onChain: async <R>(work: (held: { keys: readonly never[] }) => Promise<R>, within?: unknown) => {
      log.within = within
      return work({ keys: [] })
    },
  }
  return { store, log, current: () => now }
}

// ---- [SP_CTX_02_39] ParseAttachment

test('ParseAttachment — перша копія: the preamble and two sections (CLAUDE.md, MEMORY.md) with their paths', async () => {
  const p = parseAttachment('instructions', first('v1'))!
  if (p.kind !== 'files') throw new Error('not files')
  expect(p.preamble).toBe(true)
  expect(p.sections.map(s => s.path)).toEqual([P, M])
  expect(p.sections[0]!.body.trim()).toBe(body('v1'))
  expect(p.pre + p.sections.map(s => s.head + s.body).join('')).toBe(first('v1'))
})

test('ParseAttachment — копія після компактизації і nested_memory: the re-read frame without preamble; nested memory has no description', async () => {
  const r = parseAttachment('instructions', reread('v2'))!
  expect(r.kind === 'files' && r.preamble).toBe(false)
  const n = parseAttachment('nested_memory', nested('NESTED-RULE: birds.'))!
  expect(n.kind === 'files' && n.sections.map(s => s.path)).toEqual(['/w/sub/CLAUDE.md'])
})

test('ParseAttachment — невідома рамка: another frame, no section header, a listing without its header, another type: not understood', async () => {
  expect(parseAttachment('instructions', 'Some new host wording:\n\n' + sec(P, body('v1')))).toBeUndefined()
  expect(parseAttachment('instructions', 'just text')).toBeUndefined()
  expect(parseAttachment('skill_listing', 'The following skills were added:\n- x')).toBeUndefined()
  expect(parseAttachment('deferred_tools_delta', reread('v1'))).toBeUndefined()
  expect(parseAttachment('skill_listing', listing(['a']))).toEqual({ kind: 'listing' })
})

// ---- [SP_CTX_02_39] AttachmentAnswer

test('AttachmentAnswer — поза обсягом: a *_delta, a subagent\'s copy and an unknown frame pass through and are never noted', async () => {
  const mem = newAttachMemory()
  const decided: HostAttachState = { ...emptyHostAttach(), answers: { [textHash(reread('v1'))]: { copies: 1, drop: true } } }
  const io = hookIO(() => okRead(decided))
  expect(await attachmentAnswer(mem, io, { type: 'deferred_tools_delta', text: reread('v1') })).toEqual({ keep: true })
  expect(await attachmentAnswer(mem, io, { type: 'instructions', text: reread('v1'), agentId: 'sub-1' })).toEqual({ keep: true })
  expect(await attachmentAnswer(mem, io, ins('Unknown frame:\n\n' + sec(P, body('v1'))))).toEqual({ keep: true })
  expect(mem.catalog.size).toBe(0)
  // the main loop's copy of the same text is answered from the decision
  expect(await attachmentAnswer(mem, io, ins(reread('v1')))).toEqual({ text: null })
})

test('AttachmentAnswer — файл стану: missing, unreadable or no storage keeps every attachment', async () => {
  const d = { ...emptyHostAttach(), answers: { [textHash(reread('v1'))]: { copies: 1, drop: true as const } } }
  for (const read of [missingRead(emptyHostAttach()), unreadableRead<HostAttachState>('not JSON'), undefined]) {
    const mem = newAttachMemory()
    expect(await attachmentAnswer(mem, hookIO(() => read), ins(reread('v1')))).toEqual({ keep: true })
  }
  // a read that throws keeps it too
  const mem = newAttachMemory()
  const io: AttachIO = { ...hookIO(() => okRead(d)), decisions: async () => Promise.reject(new Error('fs')) }
  expect(await attachmentAnswer(mem, io, ins(reread('v1')))).toEqual({ keep: true })
})

// ---- [SP_CTX_02_40] PlanAttachments: staleness

test('PlanAttachments — новіша копія: the first copy keeps its preamble and MEMORY.md, its CLAUDE.md section becomes a SUPERSEDED line; a middle copy all stale goes; the newest stays', async () => {
  const asks = [ins(first('v1')), lst(listing(['a'])), ins(reread('v2')), ins(reread('v3'))]
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), asks)
  const plan = planAttachments(emptyHostAttach(), mem, new Map())
  expect(plan.changed).toBe(true)
  // the next pass answers from the new decisions
  const after = newAttachMemory()
  const out = texts(asks, await pass(after, hookIO(() => okRead(plan.state)), asks))
  expect(out[0]).toBe(PRE + `Contents of ${P}: ${SUPERSEDED}\n\n` + sec(M, '- memo', "user's auto-memory, persists across conversations"))
  expect(out[1]).toBe(asks[1]!.text)
  expect(out[2]).toBeNull()
  expect(out[3]).toBe(reread('v3'))
  // left: the section of the first copy and the whole second copy
  expect(plan.state.left.copies).toBe(2)
  expect(plan.state.left.chars).toBe(first('v1').length - out[0]!.length + reread('v2').length)
})

test('PlanAttachments — диск: a path whose newest instructions copy matched the file when first seen and differs now is predicted stale (the host attaches a new copy after the apply); missing file, a nested memory file or no first match keeps it', async () => {
  const files: Record<string, string> = { [P]: body('v1') + '\n', [M]: '- memo' }
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined, files), [ins(first('v1'))])
  const plan = planAttachments(emptyHostAttach(), mem, new Map([[P, body('v2')], [M, '- memo']]))
  const key = parseAttachment('instructions', first('v1'))
  if (!key || key.kind !== 'files') throw new Error('parse')
  expect(plan.state.predicted).toEqual({ [P]: key.sections[0]!.key })
  expect(plan.state.answers[textHash(first('v1'))]).toEqual({ copies: 1, stale: [key.sections[0]!.key] })
  // missing on disk: nothing predicted
  expect(planAttachments(emptyHostAttach(), mem, new Map([[P, undefined]])).changed).toBe(true)
  expect(planAttachments(emptyHostAttach(), mem, new Map([[P, undefined]])).state.answers).toEqual({})
  // a nested memory file: the host attaches it again only when read again, so no prediction
  const sub = newAttachMemory()
  await pass(sub, hookIO(() => undefined, { '/w/sub/CLAUDE.md': 'NESTED v1' }), [{ type: 'nested_memory', text: nested('NESTED v1') }])
  expect(planAttachments(emptyHostAttach(), sub, new Map([['/w/sub/CLAUDE.md', 'NESTED v2']])).state.answers).toEqual({})
  // the content did not match the file when first seen (imports, another rendering): never compared
  const other = newAttachMemory()
  await pass(other, hookIO(() => undefined, { [P]: 'rendered differently' }), [ins(first('v1'))])
  expect(planAttachments(emptyHostAttach(), other, new Map([[P, body('v2')]])).state.answers).toEqual({})
})

test('PlanAttachments — прогноз: confirmed by a newer copy it ends; when no newer copy came, the path is compared no more and its copy comes back', async () => {
  const files = { [P]: body('v1') }
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined, files), [ins(first('v1'))])
  const one = planAttachments(emptyHostAttach(), mem, new Map([[P, body('v2')]])).state
  // confirmed: the host attached v2 after the apply
  const ok = newAttachMemory()
  ok.matched = mem.matched
  await pass(ok, hookIO(() => okRead(one), { [P]: body('v2') }), [ins(first('v1')), ins(reread('v2'))])
  const two = planAttachments(one, ok, new Map([[P, body('v2')]])).state
  expect(two.predicted).toEqual({})
  expect(two.uncomparable).toEqual([])
  expect(Object.keys(two.answers)).toEqual([textHash(first('v1'))])
  // failed: no newer copy in the next pass
  const no = newAttachMemory()
  await pass(no, hookIO(() => okRead(one), files), [ins(first('v1'))])
  const back = planAttachments(one, no, new Map([[P, body('v2')]])).state
  expect(back.uncomparable).toEqual([P])
  expect(back.predicted).toEqual({})
  expect(back.answers).toEqual({})
})

// ---- [SP_CTX_02_40] listings and repeats

test('PlanAttachments — переліки: a byte-identical repeat keeps its first copy; a different, older listing goes; a listing without its header stays', async () => {
  const A = listing(['a'])
  const B = listing(['a', 'b'])
  const asks = [lst(A), ins(first('v1')), lst(B), lst(B), lst('Skills changed: c')]
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), asks)
  const plan = planAttachments(emptyHostAttach(), mem, new Map())
  expect(plan.state.answers[textHash(B)]).toEqual({ copies: 2, repeat: true })
  const out = texts(asks, await pass(newAttachMemory(), hookIO(() => okRead(plan.state)), asks))
  expect(out).toEqual([null, first('v1'), B, null, 'Skills changed: c'])
  expect(plan.state.left).toEqual({ copies: 2, chars: A.length + B.length })
})

test('AttachmentAnswer — нова копія і новий прохід: a copy beyond the decided copies is new and kept; an unseen re-ask keeps every copy; after a pass begins the repeat goes again', async () => {
  const B = listing(['b'])
  const state = { ...emptyHostAttach(), answers: { [textHash(B)]: { copies: 2, repeat: true as const } } }
  const clock = { now: 1_000_000 }
  const io = hookIO(() => okRead(state), {}, clock)
  const mem = newAttachMemory()
  expect(texts([lst(B), lst(B), lst(B)], await pass(mem, io, [lst(B), lst(B), lst(B)]))).toEqual([B, null, B])
  // another plugin invalidated the answers (a pass the mod does not see): the asks exceed the copies, every copy is kept
  clock.now += PASS_GAP_MS + 1
  expect(texts([lst(B), lst(B)], await pass(mem, io, [lst(B), lst(B)]))).toEqual([B, B])
  // a compaction begins a pass: the first copy is kept again, the repeat left out
  resetPass(mem)
  clock.now += PASS_GAP_MS + 1
  expect(texts([lst(B), lst(B)], await pass(mem, io, [lst(B), lst(B)]))).toEqual([B, null])
})

// ---- [SP_CTX_02_40] keep_cache

test('FrozenAttachments — keep_cache: an attachment in the frozen prefix keeps the text it sends; one after the prefix changes', async () => {
  const asks = [ins(first('v1')), ins(reread('v2')), ins(reread('v3'))]
  const rows: SessionMessage[] = [prompt('task'), use('a'), result('a'), reply('done'), prompt('next'), use('b'), result('b'), reply('ok')]
  // first copy before row 0, v2 before row 4, v3 after the apply (not yet in the form)
  const api = apiOf(rows, i => (i === 0 ? [`<system-reminder>\n${first('v1')}\n</system-reminder>`] : i === 4 ? [`<system-reminder>\n${reread('v2')}\n</system-reminder>`] : []))
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), asks)
  // the prefix ends before the first call's response: row 1 is the first row after it
  const frozen = frozenAttachments(rows, api, 1)!
  expect(frozen(first('v1'))).toBe(true)
  expect(frozen(reread('v2'))).toBe(false)
  const plan = planAttachments(emptyHostAttach(), mem, new Map(), frozen)
  expect(plan.state.answers[textHash(first('v1'))]).toBeUndefined()
  expect(plan.state.answers[textHash(reread('v2'))]).toEqual({ copies: 1, drop: true })
  // without keep_cache both change
  expect(Object.keys(planAttachments(emptyHostAttach(), mem, new Map()).state.answers).length).toBe(2)
  // no prefix: nothing frozen
  expect(frozenAttachments(rows, api, 0)).toBeUndefined()
})

// ---- [SP_CTX_02_40] persistence

test('AttachmentAnswer — відновлений процес: a new module instance (empty memory) answers the resumed pass with the same bytes from the saved decisions', async () => {
  const asks = [lst(listing(['a'])), ins(first('v1')), ins(reread('v2')), lst(listing(['a', 'b'])), ins(reread('v3'))]
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), asks)
  const s = stateStore(missingRead(emptyHostAttach()))
  const port = attachPort(mem, { store: s.store, readFile: async () => undefined })
  const c = (await port.commit(await port.disk()))!
  expect(c.written).toBe(true)
  port.passed()
  expect(mem.catalog.size).toBe(0)
  const saved = JSON.parse(JSON.stringify(s.current()))
  const live = texts(asks, await pass(mem, hookIO(() => s.current()), asks))
  const resumed = texts(asks, await pass(newAttachMemory(), hookIO(() => parseHostAttach(JSON.stringify(saved.value))), asks))
  expect(resumed).toEqual(live)
  expect(live.filter(t => t === null).length).toBe(2)
})

// ---- [SP_CTX_01_23] [SP_CTX_02_40] the state file

test('HostAttachState — обмеження: a malformed decision, list or count makes the file unreadable; a round trip keeps it', async () => {
  const good: HostAttachState = { answers: { h: { copies: 2, repeat: true, stale: ['k'] } }, matched: ['k'], predicted: { [P]: 'k' }, uncomparable: [M], left: { copies: 1, chars: 10 } }
  expect(parseHostAttach(JSON.stringify(good))).toEqual(okRead(good))
  expect(parseHostAttach('[]').state).toBe('unreadable')
  expect(parseHostAttach(JSON.stringify({ answers: { h: { copies: 0 } } })).state).toBe('unreadable')
  expect(parseHostAttach(JSON.stringify({ answers: { h: { copies: 1, drop: 'yes' } } })).state).toBe('unreadable')
  expect(parseHostAttach(JSON.stringify({ answers: {}, matched: [1] })).state).toBe('unreadable')
  expect(parseHostAttach(JSON.stringify({ answers: {}, left: { copies: -1, chars: 0 } })).state).toBe('unreadable')
  expect(parseHostAttach(JSON.stringify({ answers: {} }))).toEqual(okRead(emptyHostAttach()))
})

test('CommitAttachments — файл непридатний: the apply moves it aside and writes new decisions; a file that cannot be moved is never overwritten', async () => {
  const asks = [ins(first('v1')), ins(reread('v2'))]
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), asks)
  const s = stateStore(unreadableRead('not JSON'))
  const c = await attachPort(mem, { store: s.store, readFile: async () => undefined }).commit(new Map())
  expect(s.log.quarantined).toBe(1)
  expect(c!.before).toEqual(emptyHostAttach())
  expect(s.log.writes.length).toBe(1)
  const stuck = stateStore(unreadableRead('not JSON'), false)
  expect(await attachPort(mem, { store: stuck.store, readFile: async () => undefined }).commit(new Map())).toBeUndefined()
  expect(stuck.log.writes).toEqual([])
})

test('CommitAttachments — порожній каталог: no pass seen since the last apply changes nothing and writes nothing', async () => {
  const s = stateStore(okRead({ ...emptyHostAttach(), answers: { h: { copies: 1, drop: true } } }))
  const c = await attachPort(newAttachMemory(), { store: s.store, readFile: async () => undefined }).commit(new Map())
  expect(c!.written).toBe(false)
  expect(s.log.writes).toEqual([])
})

// ---- [SP_CTX_02_07] [SP_CTX_02_40] inside HandleCompaction

const BIG = 'x'.repeat(5000)
function conversation(): SessionMessage[] {
  return [prompt('task', 'h0'), use('a', 'Read', 'h1'), result('a', BIG, 'h2'), reply('done', 'h3')]
}
function queued(extra: Partial<Queue> = {}): Read<Queue> {
  return okRead({ ...EMPTY_QUEUE, ...extra, edits: prepare(conversation(), [{ op: 'summarize', tool_use_id: 'a', summary: 's' }]).queued })
}

async function seenTwoCopies(): Promise<AttachMemory> {
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), [ins(first('v1')), ins(reread('v2'))])
  return mem
}

test('HandleCompaction — вкладення: the decisions are written inside the commit before the queue, the report names what is left out, the catalog starts over', async () => {
  const mem = await seenTwoCopies()
  const s = stateStore(missingRead(emptyHostAttach()))
  const port = attachPort(mem, { store: s.store, readFile: async () => undefined })
  const { io, written } = harness(queued(), {
    attachments: {
      ...port,
      commit: async (...args) => {
        written.order.push('hostattach')
        return port.commit(...args)
      },
    },
  })
  const out = await handleCompaction(io, conversation())
  if (!('messages' in out)) throw new Error(out.skip)
  expect(written.order.indexOf('hostattach')).toBeLessThan(written.order.indexOf('queue'))
  expect(written.queue!.report).toContain('Stale host attachments left out of each request from now on: 1 older copy')
  expect(s.log.writes.length).toBe(1)
  expect(mem.catalog.size).toBe(0)
})

test('HandleCompaction — вкладення, покинуто: an abandon after the decisions were written puts them back; nothing applied decides nothing', async () => {
  const mem = await seenTwoCopies()
  const s = stateStore(missingRead(emptyHostAttach()))
  let aborted = false
  const port = attachPort(mem, { store: s.store, readFile: async () => undefined })
  const { io } = harness(queued(), {
    isAborted: () => aborted,
    attachments: {
      ...port,
      commit: async (...args) => {
        const c = await port.commit(...args)
        aborted = true
        return c
      },
    },
  })
  const out = await handleCompaction(io, conversation())
  expect('skip' in out && out.skip).toContain('abandoned')
  expect(s.log.writes.map(w => Object.keys(w.answers).length)).toEqual([1, 0])
  expect(mem.catalog.size).toBe(2)
  // a batch whose every edit fails: no compaction, so no decision
  const t = stateStore(missingRead(emptyHostAttach()))
  const gone = okRead({ ...EMPTY_QUEUE, edits: prepare([...conversation(), use('z'), result('z', BIG)], [{ op: 'drop', tool_use_id: 'z' }]).queued })
  const { io: io2 } = harness(gone, { attachments: attachPort(mem, { store: t.store, readFile: async () => undefined }) })
  const skipped = await handleCompaction(io2, conversation())
  expect('skip' in skipped).toBe(true)
  expect(t.log.writes).toEqual([])
})

test('HandleCompaction — вкладення з keep_cache: the copy in the frozen prefix keeps its text; the decision covers only copies after it', async () => {
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), [ins(first('v1')), ins(reread('v2')), ins(reread('v3'))])
  const rows = [prompt('task', 'h0'), use('a', 'Read', 'h1'), result('a', BIG, 'h2'), reply('done', 'h3'), prompt('more', 'h4'), reply('ok', 'h5')]
  // the first copy with the first prompt (frozen: the prefix is row 0), v2 with the second
  const api = apiOf(rows, i => (i === 0 ? [first('v1')] : i === 4 ? [reread('v2')] : []))
  const s = stateStore(missingRead(emptyHostAttach()))
  const q = okRead({ ...EMPTY_QUEUE, keepCache: true, edits: prepare(rows, [{ op: 'summarize', tool_use_id: 'a', summary: 's' }]).queued })
  const { io } = harness(q, { readApi: async () => api, attachments: attachPort(mem, { store: s.store, readFile: async () => undefined }) })
  const out = await handleCompaction(io, rows)
  if (!('messages' in out)) throw new Error(out.skip)
  const answers = s.log.writes.at(-1)!.answers
  expect(answers[textHash(first('v1'))]).toBeUndefined()
  expect(answers[textHash(reread('v2'))]).toEqual({ copies: 1, drop: true })
})

// ---- [SP_CTX_02_41] another compaction

test('ClearAttachments — інша компактизація: a compaction that stands starts the catalog over and clears the answers; a skipped one leaves both', async () => {
  const calls: string[] = []
  const io = {
    copies: () => undefined,
    hostId: () => undefined,
    storage: async () => '/s',
    writeBoundary: async () => undefined,
    updateTags: () => async () => true,
    attachments: { passed: () => void calls.push('passed'), clear: async (dir: string) => void calls.push(`clear ${dir}`) },
  }
  await observeCompaction(io, { trigger: 'auto' }, { messages: [prompt('summary')] })
  expect(calls).toEqual(['passed', 'clear /s'])
  calls.length = 0
  await observeCompaction(io, { trigger: 'auto' }, { skip: 'no' })
  expect(calls).toEqual([])
  const s: HostAttachState = { ...emptyHostAttach(), answers: { h: { copies: 1, drop: true } }, matched: ['k'], left: { copies: 1, chars: 5 } }
  expect(clearedAnswers(s)).toEqual({ ...emptyHostAttach(), matched: ['k'] })
  expect(clearedAnswers(emptyHostAttach())).toBeUndefined()
})

// ---- [SP_CTX_02_28] the telemetry line, [SP_CTX_01_05] the report's sentence

test('Telemetry — вкладення: one line when copies are left out; none otherwise', async () => {
  const t: Telemetry = { measure: 'unknown', autoCompactOff: false, registry: false, reviews: new Map(), disposable: 0, state: 'none', notes: { count: 0, reminders: 0 }, ratio: 4 }
  expect(telemetryText({ ...t, hostAttach: { copies: 3, chars: 4000 } })).toContain('Host attachments: 3 stale copies of instruction files and skill listings left out of each request (~1000 tokens)')
  expect(telemetryText({ ...t, hostAttach: { copies: 0, chars: 0 } })).not.toContain('Host attachments')
  expect(attachText({ copies: 0, chars: 0 })).toBe('')
  expect(attachText({ copies: 2, chars: 800 }, 4)).toBe('Stale host attachments left out of each request from now on: 2 older copies of instruction files and skill listings (~200 tokens).')
})

// ---- review and live-run fixes (phase 24)

test('PlanAttachments — інкрементні переліки: a later listing that holds only the skills added keeps the full listing; a listing that names every skill of an older one replaces it; a listing without names stays', async () => {
  const full = listing(['a', 'b', 'c'])
  const added = listing(['d'])
  const all = listing(['a', 'b', 'c', 'd'])
  const odd = `${LISTING_HEAD}\n\nno skill lines here`
  expect([...listingNames(listing(['ctx:stages', 'x']))]).toEqual(['ctx:stages', 'x'])
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), [lst(full), lst(odd), lst(added)])
  expect(planAttachments(emptyHostAttach(), mem, new Map()).state.answers).toEqual({})
  await pass(mem, hookIO(() => undefined), [lst(all)])
  const answers = planAttachments(emptyHostAttach(), mem, new Map()).state.answers
  expect(Object.keys(answers).sort()).toEqual([textHash(full), textHash(added)].sort())
})

test('AttachmentAnswer — повернутий вміст: a lone copy whose text equals a decided one is new once the asks since the pass began exceed its copies', async () => {
  const v1 = reread('v1')
  const state = { ...emptyHostAttach(), answers: { [textHash(v1)]: { copies: 1, drop: true as const } } }
  const clock = { now: 1_000_000 }
  const io = hookIO(() => okRead(state), {}, clock)
  const mem = newAttachMemory()
  expect(await attachmentAnswer(mem, io, ins(v1))).toEqual({ text: null })
  // the file went back to v1: its new copy comes alone, in a later burst
  clock.now += PASS_GAP_MS + 1
  expect(await attachmentAnswer(mem, io, ins(v1))).toEqual({ keep: true })
})

test('FrozenAttachments — рішення ховає поточне: an old decision held for the cache never hides a section that is current now', async () => {
  const asks = [ins(first('v1')), ins(reread('v2'))]
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined), asks)
  const k2 = (parseAttachment('instructions', reread('v2')) as { sections: { key: string }[] }).sections[0]!.key
  // a failed prediction dropped v2, the newest copy; v2 lies in the frozen prefix
  const before = { ...emptyHostAttach(), answers: { [textHash(reread('v2'))]: { copies: 1, drop: true as const } } }
  const plan = planAttachments(before, mem, new Map(), () => true)
  expect(plan.state.answers[textHash(reread('v2'))]).toBeUndefined()
  expect(k2.length > 0).toBe(true)
  // an old decision that hides only stale content is still held
  const more = newAttachMemory()
  await pass(more, hookIO(() => undefined), [...asks, ins(reread('v3'))])
  const old = { copies: 1, stale: [k2] }
  const kept = planAttachments({ ...emptyHostAttach(), answers: { [textHash(reread('v2'))]: old } }, more, new Map(), () => true)
  expect(kept.state.answers[textHash(reread('v2'))]).toEqual(old)
})

test('VerifyPredictions — перший кінець ходу: no copy came after the prediction: the path is compared no more, its copy comes back, the answers are asked again; a copy that came keeps everything', async () => {
  const files = { [P]: body('v1') }
  const mem = newAttachMemory()
  await pass(mem, hookIO(() => undefined, files), [ins(first('v1'))])
  const s = stateStore(missingRead(emptyHostAttach()))
  const port = attachPort(mem, { store: s.store, readFile: async () => undefined })
  await port.commit(new Map([[P, body('v2')]]))
  port.passed()
  expect(mem.verify).toBe(true)
  let invalidated = 0
  const io = { update: async (change: (x: HostAttachState) => HostAttachState | undefined) => {
    const now = s.current()
    if (now.state === 'unreadable') return false
    const next = change(now.value)
    if (next) await s.store.write(next)
    return !!next
  }, invalidate: () => void invalidated++ }
  expect(await verifyPredictions(mem, io)).toBe('waiting')
  // the pass after the apply: no new copy of CLAUDE.md
  await pass(mem, hookIO(() => s.current(), files), [ins(first('v1'))])
  expect(await verifyPredictions(mem, io)).toBe('rolled back')
  expect(invalidated).toBe(1)
  const after = (s.current() as { value: HostAttachState }).value
  expect(after.answers).toEqual({})
  expect(after.predicted).toEqual({})
  expect(after.uncomparable).toEqual([P])
  expect(mem.catalog.size).toBe(0)
  expect(await verifyPredictions(mem, io)).toBe('none')
  // fulfilled: the prediction ends without an invalidation
  const ok = newAttachMemory()
  await pass(ok, hookIO(() => undefined, files), [ins(first('v1'))])
  const t = stateStore(missingRead(emptyHostAttach()))
  const p2 = attachPort(ok, { store: t.store, readFile: async () => undefined })
  await p2.commit(new Map([[P, body('v2')]]))
  p2.passed()
  await pass(ok, hookIO(() => t.current()), [ins(first('v1')), ins(reread('v2'))])
  const r = rollbackPredictions((t.current() as { value: HostAttachState }).value, ok.catalog)!
  expect(r.failed).toBe(false)
  expect(r.state.predicted).toEqual({})
  expect(Object.keys(r.state.answers)).toEqual([textHash(first('v1'))])
})

test('HandleCompaction — commit вкладень кидає: the apply goes on, its report has no attachment sentence, nothing is put back', async () => {
  const mem = await seenTwoCopies()
  const port = attachPort(mem, { store: stateStore(missingRead(emptyHostAttach())).store, readFile: async () => undefined })
  let putBack = 0
  const { io, written } = harness(queued(), {
    attachments: { ...port, commit: async () => Promise.reject(new Error('disk')), putBack: async () => void putBack++ },
  })
  const out = await handleCompaction(io, conversation())
  expect('messages' in out).toBe(true)
  expect(written.queue!.report).not.toContain('Stale host attachments')
  expect(putBack).toBe(0)
})

test('HandleCompaction — запис черги кидає, вкладення: the decisions written are put back and the failure goes on', async () => {
  const mem = await seenTwoCopies()
  const s = stateStore(missingRead(emptyHostAttach()))
  const { io } = harness(queued(), {
    attachments: attachPort(mem, { store: s.store, readFile: async () => undefined }),
    writeQueue: async () => Promise.reject(new Error('disk full')),
  })
  let error = ''
  await handleCompaction(io, conversation()).catch(err => void (error = String(err)))
  expect(error).toContain('disk full')
  expect(s.log.writes.map(w => Object.keys(w.answers).length)).toEqual([1, 0])
})

test('CommitAttachments — ланцюжки: the commit enters the state file\'s chain within the chains the registries hold', async () => {
  const mem = await seenTwoCopies()
  const s = stateStore(missingRead(emptyHostAttach()))
  const held = { keys: ['queue', 'tags', 'aliases'] }
  const { io } = harness(queued(), {
    attachments: attachPort(mem, { store: s.store, readFile: async () => undefined }),
    onRegistries: async work => work(held as never),
  })
  await handleCompaction(io, conversation())
  expect(s.log.within).toEqual(held)
})

test('ClearAttachments — відповіді недійсні: after another compaction every attachment is kept until the next apply, which decides from no old answer', async () => {
  const v2 = reread('v2')
  const state = { ...emptyHostAttach(), answers: { [textHash(v2)]: { copies: 1, drop: true as const } } }
  const mem = newAttachMemory()
  voidAnswers(mem)
  expect(await attachmentAnswer(mem, hookIO(() => okRead(state)), ins(v2))).toEqual({ keep: true })
  const s = stateStore(okRead(state))
  const c = (await attachPort(mem, { store: s.store, readFile: async () => undefined }).commit(new Map()))!
  expect(c.after.answers).toEqual({})
  expect(mem.voided).toBe(false)
})

test('ParseAttachment — заголовок у вмісті: a header line inside a file\'s content without an empty line before it, or with a relative path, is no section', async () => {
  const text = PRE + sec(P, '# P\nContents of /home/u/.claude/memory/MEMORY.md (x):\n\nquoted') + '\n\n' + sec('notes/x.md', 'y')
  const p = parseAttachment('instructions', text)!
  expect(p.kind === 'files' && p.sections.map(s => s.path)).toEqual([P])
})

test('CommitAttachments — нове речення: the report sentence comes only when what the model reads changes, not when only the copies counted do', async () => {
  expect(answersKey({ h: { copies: 1, drop: true } })).toBe(answersKey({ h: { copies: 3, drop: true } }))
  expect(answersKey({ h: { copies: 1, drop: true } })).not.toBe(answersKey({ h: { copies: 1, stale: ['k'] } }))
})
