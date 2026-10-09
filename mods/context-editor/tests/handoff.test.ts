import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { handleCompaction, type CompactionIO } from '../hooks/compaction'
import { prepare } from '../hooks/edits'
import {
  buildTranscript,
  checkSwitched,
  cancelHandoff,
  checkTranscript,
  handoffDue,
  HANDOFF_STALE_MS,
  queueHandoff,
  runHandoff,
  type HandoffIO,
  type TranscriptRecord,
} from '../hooks/handoff'
import { EMPTY_QUEUE, MAX_DOCUMENT, parseQueue, type HandoffRequest, type Queue, type Read } from '../hooks/queue'
import { EMPTY_REGISTRY } from '../hooks/tags'

const BIG = 'KEY_0042 = 2c5f\n' + 'x'.repeat(5000)
const PNG = 'iVBORw0KGgo='

function conversation(): SessionMessage[] {
  return [
    { role: 'user', text: 'task', toolUses: [] },
    { role: 'assistant', text: 'reading', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: { file_path: 'big.txt' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: BIG, isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b', tool: 'Read', input: { file_path: 'shot.png' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b', text: '', isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'h', tool: 'mcp__context-editor__context_handoff', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'h', text: 'Handoff queued', isError: false }] },
    { role: 'assistant', text: 'handing off', toolUses: [] },
  ]
}

const API = [
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: BIG }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h', content: 'Handoff queued' }] },
]

function ids(): () => string {
  let n = 0
  return () => `u${++n}`
}

function build(edits: unknown[] = [], media: Map<string, string[]> = new Map()) {
  const rows = conversation()
  return buildTranscript({
    rows,
    edits: prepare(rows, edits).queued,
    found: new Map([['u:b', [{ mediaType: 'image/png', bytes: 8, data: PNG }]]]),
    knownResults: new Set(['a', 'b', 'h']),
    unmatchedPromptMedia: 0,
    archive: '/s/1.json',
    media,
    sessionId: 'new',
    cwd: '/w',
    now: 1_000_000,
    newId: ids(),
  })
}

const handoff = (over: Partial<HandoffRequest> = {}): HandoffRequest => ({ mode: 'transcript', resume: true, resumePrompt: 'go on', by: 'agent', state: 'queued', at: 0, ...over })

test('queueHandoff: transcript by default, document on request; limits and a running request refuse', async () => {
  const q = queueHandoff(EMPTY_QUEUE, {}, 'agent', 5)
  expect('queue' in q && q.queue.handoff).toEqual({ mode: 'transcript', resume: true, resumePrompt: 'Continue the task from where you stopped.', by: 'agent', state: 'queued', at: 5 })
  const d = queueHandoff(EMPTY_QUEUE, { mode: 'document', document: 'doc', resume: false, resume_prompt: 'p' }, 'person', 5)
  expect('queue' in d && d.queue.handoff).toEqual({ mode: 'document', document: 'doc', resume: false, resumePrompt: 'p', by: 'person', state: 'queued', at: 5 })
  expect('deny' in queueHandoff(EMPTY_QUEUE, { mode: 'x' }, 'agent', 5)).toBe(true)
  expect('deny' in queueHandoff(EMPTY_QUEUE, { document: 'd'.repeat(MAX_DOCUMENT + 1) }, 'agent', 5)).toBe(true)
  expect('deny' in queueHandoff(EMPTY_QUEUE, { agentId: 'sub' }, 'agent', 5)).toBe(true)
  const running = { ...EMPTY_QUEUE, handoff: handoff({ state: 'running', at: 0 }) }
  expect('deny' in queueHandoff(running, {}, 'agent', 10)).toBe(true)
  expect('queue' in queueHandoff(running, {}, 'agent', HANDOFF_STALE_MS + 1)).toBe(true)
})

test('handoffDue: a queued request, or a running one gone stale', async () => {
  expect(handoffDue(EMPTY_QUEUE, 0)).toBe(false)
  expect(handoffDue({ ...EMPTY_QUEUE, handoff: handoff() }, 0)).toBe(true)
  expect(handoffDue({ ...EMPTY_QUEUE, handoff: handoff({ state: 'running', at: 0 }) }, 10)).toBe(false)
  expect(handoffDue({ ...EMPTY_QUEUE, handoff: handoff({ state: 'running', at: 0 }) }, HANDOFF_STALE_MS + 1)).toBe(true)
})

test('parseQueue keeps a well-formed handoff and refuses a broken one', async () => {
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, handoff: handoff() })).state).toBe('ok')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, handoff: { ...handoff(), mode: 'x' } })).state).toBe('unreadable')
})

test('buildTranscript: edits applied, own call dropped, rows of one role merged, media of untouched pairs kept, chain whole', async () => {
  const { records, report } = build([{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }])
  expect(report.applied).toEqual(['summarize a'])
  expect(records.map(r => r.type)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
  expect(records[0]!.parentUuid).toBe(null)
  expect(records.every((r, i) => i === 0 || r.parentUuid === records[i - 1]!.uuid)).toBe(true)
  expect(records[1]!.message.content.map(b => b.type)).toEqual(['text', 'tool_use'])
  const summarized = records[2]!.message.content[0]!
  expect(summarized.type === 'tool_result' && JSON.stringify(summarized.content)).toContain('KEY_0042')
  expect(JSON.stringify(records)).not.toContain('x'.repeat(100))
  const shot = records[4]!.message.content[0]!
  expect(shot.type === 'tool_result' && shot.content).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }])
  expect(JSON.stringify(records)).not.toContain('context_handoff')
  expect(records.every(r => r.sessionId === 'new' && r.cwd === '/w')).toBe(true)
  expect(checkTranscript(records)).toBeUndefined()
})

test('buildTranscript: a pair the edits replace loses its media; without its archive the edit is refused', async () => {
  const done = build([{ op: 'summarize', tool_use_id: 'b', summary: 'a screenshot of X' }], new Map([['u:b', ['/s/1/1.png']]]))
  expect(done.report.applied).toEqual(['summarize b'])
  expect(JSON.stringify(done.records)).not.toContain(PNG)
  const refused = build([{ op: 'summarize', tool_use_id: 'b', summary: 'a screenshot of X' }])
  expect(refused.report.failed.join()).toContain('media could not be archived')
  expect(JSON.stringify(refused.records)).toContain(PNG)
})

test('checkTranscript names each broken rule', async () => {
  const { records } = build()
  const at = (i: number, patch: Partial<TranscriptRecord>) => records.map((r, k) => (k === i ? { ...r, ...patch } : r))
  expect(checkTranscript([])).toContain('no rows')
  expect(checkTranscript(at(2, { parentUuid: 'zz' }))).toContain('chain')
  expect(checkTranscript(at(2, { uuid: records[0]!.uuid, parentUuid: records[1]!.uuid }))).toBeDefined()
  expect(checkTranscript([records[0]!, { ...records[0]!, uuid: 'q', parentUuid: records[0]!.uuid }])).toContain('alternate')
  const orphan = at(2, { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'zz', content: [] }] } })
  expect(checkTranscript(orphan)).toContain('do not answer')
  expect(checkTranscript(records.slice(0, 2))).toContain('without results')
})

test('checkSwitched: the first text and every call must be read back', async () => {
  const { records } = build()
  expect(checkSwitched(records, conversation())).toBe(true)
  expect(checkSwitched(records, [{ role: 'user', text: 'task', toolUses: [] }])).toBe(false)
  expect(checkSwitched(records, [])).toBe(false)
})

test('a compaction waits while a handoff is queued: the edits belong to it', async () => {
  const rows = conversation()
  let written: Queue | undefined
  const io = {
    dir: '/s',
    now: () => 1,
    readQueue: async () => ({ state: 'ok' as const, value: { ...EMPTY_QUEUE, edits: prepare(rows, [{ op: 'drop', tool_use_id: 'a' }]).queued, handoff: handoff() } }),
    writeQueue: async (q: Queue) => void (written = q),
  } as unknown as CompactionIO
  const out = await handleCompaction(io, rows)
  expect('skip' in out && out.skip).toContain('handoff pending')
  expect(written).toBeUndefined()
})

// A host where the old session is `old` and commands switch it.
function host(over: Partial<HandoffIO> = {}, h: HandoffRequest = handoff(), edits: unknown[] = []) {
  const rows = conversation()
  const queues = new Map<string, Queue>([['/store/old', { ...EMPTY_QUEUE, edits: prepare(rows, edits).queued, handoff: h }]])
  const state = { session: 'old', turns: 0, inTurn: false, files: new Map<string, string>(), removed: [] as string[], commands: [] as string[], submitted: [] as string[], toasts: [] as string[] }
  let written: TranscriptRecord[] = []
  const io: HandoffIO = {
    now: () => 1_000_000,
    newId: (() => {
      let n = 0
      return () => (n++ === 0 ? 'new' : `u${n}`)
    })(),
    sessionId: async () => state.session,
    storageDir: async () => `/store/${state.session}`,
    turnsStarted: () => state.turns,
    inTurn: () => state.inTurn,
    readQueue: async (): Promise<Read<Queue>> => ({ state: 'ok', value: queues.get(`/store/${state.session}`) ?? { ...EMPTY_QUEUE } }),
    updateQueue: async (dir, change) => void queues.set(dir, change(queues.get(dir) ?? { ...EMPTY_QUEUE })),
    rows: async () => (state.session === 'new' ? written.map(r => ({ role: r.type, text: r.message.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join(''), toolUses: r.message.content.flatMap(b => (b.type === 'tool_use' ? [{ tool_use_id: b.id, tool: b.name, input: b.input }] : [])) })) : rows),
    readApi: async () => API,
    readTags: async () => ({ state: 'missing', value: { ...EMPTY_REGISTRY } }),
    cwd: async () => '/w',
    findTranscript: async () => '/projects/p',
    prepareStorage: async id => `/store/${id}`,
    writeMedia: async () => true,
    writeText: async (path, text) => {
      state.files.set(path, text)
      if (path.endsWith('.jsonl.tmp')) written = text.trim().split('\n').map(l => JSON.parse(l) as TranscriptRecord)
      return true
    },
    rename: async (from, to) => {
      state.files.set(to, state.files.get(from) ?? '')
      return true
    },
    remove: async path => {
      state.removed.push(path)
      state.files.delete(path)
    },
    copyRegistries: async () => undefined,
    runCommand: async (command, args) => {
      state.commands.push(`${command} ${args}`.trim())
      state.session = command === 'clear' ? 'cleared' : args
    },
    fork: async () => 'forked document',
    submit: async text => void state.submitted.push(text),
    toast: text => void state.toasts.push(text),
    ...over,
  }
  return { io, state, queues }
}

test('runHandoff transcript: writes the new session, switches to it, resumes it, clears the old queue', async () => {
  const { io, state, queues } = host({}, handoff(), [{ op: 'summarize', tool_use_id: 'a', summary: 'KEY_0042 = 2c5f' }])
  const out = await runHandoff(io)
  expect(out).toEqual({ outcome: 'transcript', newId: 'new' })
  expect(state.commands).toEqual(['resume new'])
  expect(state.files.has('/projects/p/new.jsonl')).toBe(true)
  expect(state.files.has('/store/new/1000000.json')).toBe(true)
  expect(state.submitted[0]).toContain('continues old (transcript)')
  expect(state.submitted[0]).toContain('go on')
  expect(queues.get('/store/old')!.edits).toEqual([])
  expect(queues.get('/store/old')!.handoff).toBeUndefined()
})

test('runHandoff: a transcript the host opens empty sends it back to the old session and on to the document way', async () => {
  const { io, state } = host({ rows: async () => (state.session === 'new' ? [] : conversation()) })
  const out = await runHandoff(io)
  expect(out).toEqual({ outcome: 'document', newId: 'cleared' })
  expect(state.commands).toEqual(['resume new', 'resume old', 'clear'])
  expect(state.submitted[0]).toContain('forked document')
  expect(state.submitted[0]).toContain('did not open the assembled transcript')
})

test('runHandoff document: the agent document starts the cleared session; queued edits are reported as not carried', async () => {
  const { io, state } = host({}, handoff({ mode: 'document', document: 'my handoff' }), [{ op: 'drop', tool_use_id: 'a' }])
  const out = await runHandoff(io)
  expect(out.outcome).toBe('document')
  expect(state.commands).toEqual(['clear'])
  expect(state.submitted[0]!.startsWith('my handoff')).toBe(true)
  expect(state.submitted[0]).toContain('were not carried over')
})

test('runHandoff: when both ways fail the session stays and the report says why', async () => {
  const { io, state, queues } = host({ findTranscript: async () => undefined, fork: async () => undefined })
  const out = await runHandoff(io)
  expect(out.outcome).toBe('failed')
  expect(state.commands).toEqual([])
  expect(queues.get('/store/old')!.handoff).toBeUndefined()
  expect(queues.get('/store/old')!.report).toContain('transcript of this session was not found')
  expect(state.toasts.length).toBe(1)
})

test('runHandoff does nothing without a due request, and claims it once', async () => {
  const idle = host()
  idle.queues.set('/store/old', { ...EMPTY_QUEUE })
  expect(await runHandoff(idle.io)).toEqual({ outcome: 'nothing' })
  const twice = host()
  const [a, b] = await Promise.all([runHandoff(twice.io), runHandoff(twice.io)])
  expect([a.outcome, b.outcome].filter(o => o === 'nothing').length).toBe(1)
})

test('runHandoff: a turn that started meanwhile puts the handoff off and leaves no new session behind', async () => {
  const { io, state, queues } = host({ copyRegistries: async () => void (state.turns += 1) })
  expect(await runHandoff(io)).toEqual({ outcome: 'deferred' })
  expect(state.commands).toEqual([])
  expect(state.removed).toEqual(['/projects/p/new.jsonl', '/store/new'])
  expect(queues.get('/store/old')!.handoff!.state).toBe('queued')
})

test('runHandoff: a failed way back stops the handoff, without the document way', async () => {
  const { io, state, queues } = host({
    rows: async () => (state.session === 'new' ? [] : conversation()),
    runCommand: async (command, args) => {
      state.commands.push(`${command} ${args}`.trim())
      if (args === 'new') state.session = 'new'
    },
  })
  const out = await runHandoff(io)
  expect(out.outcome).toBe('failed')
  expect(state.commands).toEqual(['resume new', 'resume old'])
  expect(queues.get('/store/old')!.report).toContain('way back to old failed')
})

test('runHandoff: after a way back the broken transcript and the new storage are removed', async () => {
  const { io, state } = host({ rows: async () => (state.session === 'new' ? [] : conversation()) })
  await runHandoff(io)
  expect(state.removed).toEqual(['/projects/p/new.jsonl', '/store/new'])
})

test('runHandoff: rows the model no longer sees send the handoff to the document way', async () => {
  const { io, state } = host({ readApi: async () => API.slice(1) })
  const out = await runHandoff(io)
  expect(out.outcome).toBe('document')
  expect(state.submitted[0]).toContain('rows the model no longer sees')
})

test('runHandoff: no transcript file goes to the document way with a forked document', async () => {
  const { io, state } = host({ findTranscript: async () => undefined })
  const out = await runHandoff(io)
  expect(out.outcome).toBe('document')
  expect(state.submitted[0]!.startsWith('forked document')).toBe(true)
})

test('runHandoff transcript with resume false: no prompt; the report waits in the new session\'s queue', async () => {
  const { io, state, queues } = host({}, handoff({ resume: false }))
  expect((await runHandoff(io)).outcome).toBe('transcript')
  expect(state.submitted).toEqual([])
  expect(queues.get('/store/new')!.report).toContain('continues old (transcript)')
  expect(queues.get('/store/old')!.report).toContain('handed off to new')
  expect(queues.get('/store/old')!.reportResume).toBe(false)
})

test('cancelHandoff drops a queued request, never a running one', async () => {
  const q = cancelHandoff({ ...EMPTY_QUEUE, handoff: handoff() }, 'the turn was interrupted', 7)
  expect(q.handoff).toBeUndefined()
  expect(q.report).toContain('handoff cancelled (the turn was interrupted)')
  const running = { ...EMPTY_QUEUE, handoff: handoff({ state: 'running' }) }
  expect(cancelHandoff(running, 'x', 7)).toBe(running)
})

test('buildTranscript: a drop removes the pair; a window that begins mid-pair loses the orphan result', async () => {
  const dropped = build([{ op: 'drop', tool_use_id: 'a' }])
  expect(JSON.stringify(dropped.records)).not.toContain('big.txt')
  expect(checkTranscript(dropped.records)).toBeUndefined()
  const opts = { edits: [], found: new Map(), knownResults: new Set(['a', 'b', 'h']), unmatchedPromptMedia: 0, archive: '', media: new Map(), sessionId: 'n', cwd: '/w', now: 1, newId: ids() }
  const tail: SessionMessage[] = [{ role: 'user', text: 'next question', toolUses: [] }, { role: 'assistant', text: 'answer', toolUses: [] }]
  const mid = buildTranscript({ ...opts, rows: [...conversation().slice(3), ...tail] })
  expect(JSON.stringify(mid.records)).not.toContain('tool_use_id')
  expect(mid.records.map(r => r.type)).toEqual(['user', 'assistant'])
  expect(checkTranscript(mid.records)).toBeUndefined()
  // no message of the person in the window: nothing to carry over
  expect(buildTranscript({ ...opts, rows: conversation().slice(3) }).records).toEqual([])
})

test('runHandoff: a turn that started after it was scheduled, or one that runs now, puts it off before the claim', async () => {
  const started = host()
  started.state.turns = 1
  expect(await runHandoff(started.io, 0)).toEqual({ outcome: 'deferred' })
  expect(started.queues.get('/store/old')!.handoff!.state).toBe('queued')
  expect(started.state.commands).toEqual([])
  const running = host()
  running.state.inTurn = true
  expect(await runHandoff(running.io, 0)).toEqual({ outcome: 'deferred' })
  expect(running.state.files.size).toBe(0)
})

test('runHandoff: a turn that ran and ended while the document was forked puts the switch off', async () => {
  const { io, state, queues } = host({ fork: async () => ((state.turns += 1), 'forked document') }, handoff({ mode: 'document' }))
  expect(await runHandoff(io, 0)).toEqual({ outcome: 'deferred' })
  expect(state.commands).toEqual([])
  expect(queues.get('/store/old')!.handoff!.state).toBe('queued')
})

test('runHandoff: a step that throws before the switch removes the new storage and goes to the document way', async () => {
  const { io, state } = host({
    writeMedia: async () => {
      throw new Error('disk gone')
    },
  }, handoff(), [{ op: 'summarize', tool_use_id: 'b', summary: 'a screenshot' }])
  const out = await runHandoff(io)
  expect(out.outcome).toBe('document')
  expect(state.removed).toEqual(['/projects/p/new.jsonl.tmp', '/store/new'])
  expect(state.submitted[0]).toContain('disk gone')
})
