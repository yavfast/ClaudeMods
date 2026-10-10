import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { MAX_QUEUE_EDITS } from '../hooks/edits'
import {
  contextEdit,
  DEFAULT_RESUME,
  deliverReport,
  EMPTY_QUEUE,
  MAX_QUEUE_BYTES,
  parseQueue,
  personRow,
  personText,
  queueEdits,
  queuedText,
  settledQueue,
  withoutReport,
  type DeliverIO,
  type Queue,
  type QueueIO,
  type Read,
} from '../hooks/queue'
import { adviceFor, INTRO_TEXT, introFor, personAdvice, STAGE_ADVICE, withIntroduced } from '../hooks/stages'
import { EMPTY_REGISTRY, type TagRegistry } from '../hooks/tags'

const rows: SessionMessage[] = [
  { role: 'user', text: 'task', toolUses: [], handle: 'h0' },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }], handle: 'h1' },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x'.repeat(5000), isError: false }], handle: 'h2' },
]

test('parseQueue reads a good file and refuses bad JSON or a field of the wrong type', async () => {
  expect(parseQueue(JSON.stringify(EMPTY_QUEUE)).state).toBe('ok')
  expect(parseQueue('{').state).toBe('unreadable')
  const bad = parseQueue(JSON.stringify({ ...EMPTY_QUEUE, resume: 'no' }))
  expect(bad.state).toBe('unreadable')
  expect(bad.state === 'unreadable' && bad.reason).toContain('resume')
  expect(parseQueue('[]').state).toBe('unreadable')
  // [SP_CTX_01_04] resumeSet: a boolean; absent in an older file, false
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, resumeSet: 'x' })).state).toBe('unreadable')
  const { resumeSet: _r, ...older } = EMPTY_QUEUE
  const old = parseQueue(JSON.stringify(older))
  expect(old.state === 'ok' && old.value.resumeSet).toBe(false)
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [42] })).state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'a', anchors: [1] }] })).state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, edits: [{ op: 'drop', tool_use_id: 'a' }] })).state).toBe('ok')
})

test('queueEdits refuses empty lists, long resume prompts, a full queue and an oversized file', async () => {
  expect('deny' in queueEdits(EMPTY_QUEUE, rows, { edits: [] })).toBe(true)
  expect('deny' in queueEdits(EMPTY_QUEUE, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }], resume_prompt: 'x'.repeat(9000) })).toBe(true)
  const full = { ...EMPTY_QUEUE, edits: Array.from({ length: MAX_QUEUE_EDITS }, () => ({ op: 'drop' as const, tool_use_id: 'a' })) }
  const over = queueEdits(full, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in over && over.deny).toContain('exceed')
  const huge = { ...EMPTY_QUEUE, report: 'x'.repeat(MAX_QUEUE_BYTES) }
  const big = queueEdits(huge, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in big && big.deny).toContain('bytes')
})

test('queueEdits sets the batch fields and keeps rejections beside accepted edits', async () => {
  const out = queueEdits({ ...EMPTY_QUEUE, tagsOnly: true }, rows, {
    edits: [{ op: 'drop', tool_use_id: 'a' }, { op: 'drop', tool_use_id: 'zz' }],
    resume: false,
    resume_prompt: 'go on',
  })
  if ('deny' in out) throw new Error(out.deny)
  expect(out.queued).toBe(1)
  expect(out.errors.length).toBe(1)
  expect(out.queue.tagsOnly).toBe(false)
  expect(out.queue.resume).toBe(false)
  expect(out.queue.resumePrompt).toBe('go on')
})

// [SP_CTX_02_02] [SP_CTX_DEC_16] phase 18: the batch of the optimization turn
const drop = [{ op: 'drop', tool_use_id: 'a' }]
const inOptimization: Queue = { ...EMPTY_QUEUE, optimizePrompted: true }
function batch(q: Queue, args: Record<string, unknown>): Queue {
  const out = queueEdits(q, rows, { edits: drop, ...args })
  if ('deny' in out) throw new Error(out.deny)
  return out.queue
}

test('context_edit — хід оптимізації без resume: an empty queue or only tag replacements; the batch does not resume and the result says nothing of resuming', async () => {
  for (const start of [inOptimization, { ...inOptimization, edits: [{ op: 'drop' as const, tool_use_id: 'a' }], tagsOnly: true }]) {
    const q = batch(start, {})
    expect(q.resume).toBe(false)
    expect(q.resumePrompt).toBe(DEFAULT_RESUME)
    expect(queuedText(q, 1, [])).not.toContain('resumes by itself')
  }
})

test('context_edit — хід оптимізації з продовженням: resume true / only a resume_prompt / resume false with a prompt', async () => {
  expect(batch(inOptimization, { resume: true }).resume).toBe(true)
  const prompted = batch(inOptimization, { resume_prompt: 'P' })
  expect(prompted.resume).toBe(true)
  expect(prompted.resumePrompt).toBe('P')
  expect(queuedText(prompted, 1, [])).toContain('The session then resumes by itself with: "P"')
  const off = batch(inOptimization, { resume: false, resume_prompt: 'P' })
  expect(off.resume).toBe(false)
  expect(off.resumePrompt).toBe('P')
  // a blank prompt is no request to go on
  expect(batch(inOptimization, { resume_prompt: '   ' }).resume).toBe(false)
})

test('context_edit — хід оптимізації, другий виклик: a call without resume or a prompt keeps the choice of the first', async () => {
  expect(batch(batch(inOptimization, { resume: true }), {}).resume).toBe(true)
  expect(batch(batch(inOptimization, {}), {}).resume).toBe(false)
})

// review 46: an explicit choice survives a call that queued nothing
test('context_edit — хід оптимізації, повтор після відмови: resume true on a call whose edits were all refused stays for the retry without resume', async () => {
  const refused = queueEdits(inOptimization, rows, { edits: [{ op: 'drop', tool_use_id: 'zz' }], resume: true })
  if ('deny' in refused) throw new Error(refused.deny)
  expect(refused.queued).toBe(0)
  expect(refused.queue.resume).toBe(true)
  expect(refused.queue.resumeSet).toBe(true)
  const retry = batch(refused.queue, {})
  expect(retry.edits.length).toBe(1)
  expect(retry.resume).toBe(true)
  // the same with a resume_prompt alone, and a later prompt does not undo resume false
  expect(batch(batch(inOptimization, { resume_prompt: 'P' }), {}).resume).toBe(true)
  expect(batch(batch(inOptimization, { resume: false }), { resume_prompt: 'Q' }).resume).toBe(false)
})

test('queuedText — хід оптимізації: a batch that stops the session says so; outside the optimization turn nothing is added', async () => {
  expect(queuedText(batch(inOptimization, {}), 1, [])).toContain('The session then stops; pass "resume": true to go on.')
  expect(queuedText(batch(EMPTY_QUEUE, { resume: false }), 1, [])).not.toContain('stops')
})

test('context_edit — поза ходом оптимізації: without resume the batch keeps its setting (true by default)', async () => {
  expect(batch(EMPTY_QUEUE, {}).resume).toBe(true)
  expect(batch(batch(EMPTY_QUEUE, { resume: false }), {}).resume).toBe(false)
  expect(batch(EMPTY_QUEUE, { resume_prompt: 'P' }).resume).toBe(true)
})

test('withoutReport removes only the delivered text', async () => {
  const q = { ...EMPTY_QUEUE, report: 'r', reportId: 7, reportResume: true, reportPrompt: 'p' }
  const cleared = withoutReport(q, 'r')
  expect(cleared.report).toBeUndefined()
  expect(cleared.reportResume).toBe(false)
  expect(cleared.reportPrompt).toBe(DEFAULT_RESUME)
  const merged = withoutReport({ ...q, report: 'r\nnewer', reportId: 8 }, 'r')
  expect(merged.report).toBe('newer')
  expect(merged.reportId).toBe(8)
  expect(withoutReport(q, 'other')).toBe(q)
})

function io(read: Read<Queue>, over: Partial<QueueIO> = {}) {
  const log: { written?: Queue; quarantined: number } = { quarantined: 0 }
  const port: QueueIO = {
    readQueue: async () => read,
    writeQueue: async q => {
      log.written = q
    },
    quarantine: async () => {
      log.quarantined++
      return '/s/pending.json.bad-1'
    },
    queuePath: '/s/pending.json',
    ...over,
  }
  return { port, log }
}

test('contextEdit quarantines an unreadable queue and continues with an empty one', async () => {
  const { port, log } = io({ state: 'unreadable', reason: 'bad field(s): resume' })
  const out = await contextEdit(port, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('result' in out && out.result).toContain('moved to /s/pending.json.bad-1')
  expect(log.quarantined).toBe(1)
  expect(log.written!.edits.length).toBe(1)
})

test('contextEdit queues an edit given by ref under its tool_use_id', async () => {
  const { port, log } = io({ state: 'missing', value: { ...EMPTY_QUEUE } })
  const out = await contextEdit(port, rows, { edits: [{ op: 'drop', ref: 'last' }, { op: 'drop', ref: 'c5' }] }, undefined, ref => (ref === 'last' ? 'a' : undefined))
  expect('result' in out && out.result).toContain('Queued 1 edit(s)')
  expect('result' in out && out.result).toContain('unknown ref c5')
  expect(log.written!.edits).toEqual([{ op: 'drop', tool_use_id: 'a' }])
})

test('contextEdit refuses when the queue can neither be read nor moved, or cannot be written', async () => {
  const stuck = io({ state: 'unreadable', reason: 'x' }, { quarantine: async () => undefined })
  const a = await contextEdit(stuck.port, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in a && a.deny).toContain('/s/pending.json')
  const failing = io({ state: 'missing', value: { ...EMPTY_QUEUE } }, { writeQueue: async () => { throw new Error('disk full') } })
  const b = await contextEdit(failing.port, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('deny' in b && b.deny).toContain('disk full')
})

// A host for DeliverReport: the queue and the registry in memory, bound as
// register.ts binds them (intro, advice and their writes from stages.ts).
function deliverHarness(queue: Queue, reg: Read<TagRegistry> = { state: 'missing', value: { ...EMPTY_REGISTRY } }, over: Partial<DeliverIO<{ drop?: unknown }>> = {}) {
  const log = { queue, reg, seen: [] as (readonly string[])[], inTurn: false }
  const io: DeliverIO<{ drop?: unknown }> = {
    readQueue: async () => ({ state: 'ok', value: log.queue }),
    intro: async () => introFor(log.reg),
    advice: async () => adviceFor(log.reg),
    inTurn: () => log.inTurn,
    enter: async context => (log.seen.push(context), {}),
    markIntroduced: async () => {
      const next = withIntroduced(log.reg)
      if (next) log.reg = { state: 'ok', value: next }
    },
    settle: async s => void (log.queue = settledQueue(log.queue, s)),
    ...over,
  }
  return { io, log }
}

const introduced = (): Read<TagRegistry> => ({ state: 'ok', value: { ...EMPTY_REGISTRY, introduced: true } })
const BLOCK_A = { name: 'A', after: null, end: { anchor: 'user|r:a|', hint: 2 }, turn: 1 }

test('deliverReport removes the report only once the prompt entered', async () => {
  const q: Queue = { ...EMPTY_QUEUE, report: 'R', reportId: 3 }
  const ok = deliverHarness(q, introduced())
  await deliverReport(ok.io)
  expect(ok.log.seen).toEqual([['R']])
  expect(ok.log.queue.report).toBeUndefined()
  const refused = deliverHarness(q, introduced(), { enter: async () => ({ drop: 'refused' }) })
  const out = await deliverReport(refused.io)
  expect(out.drop).toBe('refused')
  expect(refused.log.queue.report).toBe('R')
  const none = deliverHarness({ ...EMPTY_QUEUE }, introduced())
  await deliverReport(none.io)
  expect(none.log.seen).toEqual([[]])
})

test('DeliverReport — один раз: a report in the queue, two prompts in a row; only the first carries it', async () => {
  const h = deliverHarness({ ...EMPTY_QUEUE, report: 'R', reportId: 3, reportResume: true }, introduced())
  for (let i = 0; i < 2; i++) await deliverReport(h.io)
  expect(h.log.seen).toEqual([['R'], []])
  expect(h.log.queue.report).toBeUndefined()
  expect(h.log.queue.reportResume).toBe(false)
})

test('SessionIntro — перший промпт: the hidden context starts with INTRO_TEXT; once entered, introduced; the second prompt goes without it', async () => {
  const h = deliverHarness({ ...EMPTY_QUEUE, report: 'R', reportId: 3 })
  await deliverReport(h.io)
  await deliverReport(h.io)
  expect(h.log.seen).toEqual([[INTRO_TEXT, 'R'], []])
  expect(h.log.reg.state === 'ok' && h.log.reg.value.introduced).toBe(true)
  // a registry with introduced = false gets it too
  const fresh = deliverHarness({ ...EMPTY_QUEUE }, { state: 'ok', value: { ...EMPTY_REGISTRY } })
  await deliverReport(fresh.io)
  expect(fresh.log.seen).toEqual([[INTRO_TEXT]])
})

test('SessionIntro — промпт відхилено / реєстр нечитабельний / INTRO_NOT_RECORDED', async () => {
  const dropped = deliverHarness({ ...EMPTY_QUEUE }, undefined, { enter: async () => ({ drop: 'no' }) })
  await deliverReport(dropped.io)
  expect(dropped.log.reg.state).toBe('missing')
  const broken = deliverHarness({ ...EMPTY_QUEUE }, { state: 'unreadable', reason: 'x' })
  await deliverReport(broken.io)
  expect(broken.log.seen).toEqual([[]])
  const unwritten = deliverHarness({ ...EMPTY_QUEUE }, undefined, {
    markIntroduced: async () => {
      throw new Error('disk full')
    },
  })
  await deliverReport(unwritten.io)
  await deliverReport(unwritten.io)
  expect(unwritten.log.seen).toEqual([[INTRO_TEXT], [INTRO_TEXT]])
})

test('DeliverReport — порада з промптом людини: PersonAdvice of block "A", no indexes; once entered, optimize is down', async () => {
  const h = deliverHarness({ ...EMPTY_QUEUE, optimize: true, report: 'R', reportId: 4 }, { state: 'ok', value: { ...EMPTY_REGISTRY, introduced: true, lastClosed: BLOCK_A } })
  await deliverReport(h.io)
  expect(h.log.seen.length).toBe(1)
  const [report, advice] = h.log.seen[0]!
  expect(report).toBe('R')
  expect(advice).toBe(personAdvice(BLOCK_A))
  expect(advice).toContain('stage "A"')
  expect(advice).toContain('Last block #<a>..#<b>')
  expect(advice).toContain(STAGE_ADVICE)
  expect(/#\d/.test(advice!)).toBe(false)
  expect(h.log.queue.optimize).toBe(false)
  expect(h.log.queue.report).toBeUndefined()
})

test('DeliverReport — ADVICE_FAILED / без блоку: the prompt goes without advice; once entered, optimize is down', async () => {
  const failing = deliverHarness({ ...EMPTY_QUEUE, optimize: true, report: 'R', reportId: 4 }, introduced(), {
    advice: async () => {
      throw new Error('boom')
    },
  })
  await deliverReport(failing.io)
  expect(failing.log.seen).toEqual([['R']])
  expect(failing.log.queue.optimize).toBe(false)
  for (const reg of [{ state: 'unreadable', reason: 'x' } as Read<TagRegistry>, introduced()]) {
    const h = deliverHarness({ ...EMPTY_QUEUE, optimize: true }, reg)
    await deliverReport(h.io)
    expect(h.log.seen).toEqual([[]])
    expect(h.log.queue.optimize).toBe(false)
  }
  // a dropped prompt keeps the request
  const kept = deliverHarness({ ...EMPTY_QUEUE, optimize: true }, introduced(), { enter: async () => ({ drop: 'no' }) })
  await deliverReport(kept.io)
  expect(kept.log.queue.optimize).toBe(true)
})

test('DeliverReport — людина взяла хід: optimizePrompted goes down with a prompt between turns, stays with a message mid-turn', async () => {
  const between = deliverHarness({ ...EMPTY_QUEUE, optimizePrompted: true }, introduced())
  await deliverReport(between.io)
  expect(between.log.queue.optimizePrompted).toBe(false)
  const mid = deliverHarness({ ...EMPTY_QUEUE, optimizePrompted: true }, introduced())
  mid.log.inTurn = true
  await deliverReport(mid.io)
  expect(mid.log.queue.optimizePrompted).toBe(true)
})

test('Queue: optimize and optimizePrompted parse as booleans and are kept by every other write', async () => {
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, optimize: true })).state).toBe('ok')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, optimize: 'yes' })).state).toBe('unreadable')
  expect(parseQueue(JSON.stringify({ ...EMPTY_QUEUE, optimizePrompted: 1 })).state).toBe('unreadable')
  const q: Queue = { ...EMPTY_QUEUE, optimize: true, report: 'R', reportId: 1 }
  expect(withoutReport(q, 'R').optimize).toBe(true)
  const out = queueEdits(q, rows, { edits: [{ op: 'drop', tool_use_id: 'a' }] })
  expect('queue' in out && out.queue.optimize).toBe(true)
  const prompted: Queue = { ...EMPTY_QUEUE, optimizePrompted: true }
  expect(settledQueue(prompted, { delivered: undefined, optimizeDone: false, tookOver: false })).toBe(prompted)
})

test('DeliverReport — the advice with the person\'s prompt carries the note count (NotesHint)', async () => {
  const notes = [{ id: 'n1', target: { tool_use_id: 'a' }, text: 't', createdTurn: 0 }]
  const h = deliverHarness({ ...EMPTY_QUEUE, optimize: true }, { state: 'ok', value: { ...EMPTY_REGISTRY, introduced: true, lastClosed: BLOCK_A, notes, nextNote: 2 } })
  await deliverReport(h.io)
  expect(h.log.seen[0]![0]).toBe(personAdvice(BLOCK_A, 1))
  expect(h.log.seen[0]![0]).toContain('You have 1 note(s)')
})

// ---- [SP_CTX_02_02] phase 17: the person's messages in an edit

const personRows = (): SessionMessage[] => [
  { role: 'user', text: 'the task', toolUses: [] },
  { role: 'assistant', text: 'plan', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'r', tool: 'Read', input: {} }] },
  { role: 'user', text: 'also check B', toolUses: [] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'r', text: 'file', isError: false }] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'q', tool: 'AskUserQuestion', input: {} }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'q', text: 'User answered: B', isError: false }] },
  { role: 'assistant', text: 'ok', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 's', tool: 'Grep', input: {} }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 's', text: 'hits', isError: false }] },
  { role: 'user', text: '[context-editor] rewritten: x', toolUses: [] },
  { role: 'user', text: 'context-editor: applied 1 edit(s)', toolUses: [] },
  { role: 'user', text: '<command-name>/compact</command-name><command-args>context-editor: apply queued edits</command-args>', toolUses: [] },
  { role: 'assistant', text: 'end', toolUses: [] },
]

test('context_edit — повідомлення людини: collapse 2..9 over a prompt and an AskUserQuestion answer; summarize of the answer; a collapse without them', async () => {
  const r = personRows()
  const out = queueEdits(EMPTY_QUEUE, r, {
    edits: [
      { op: 'collapse', from_index: 2, to_index: 9, summary: 's' },
      { op: 'summarize', tool_use_id: 'q', summary: 'B chosen' },
      { op: 'collapse', from_index: 7, to_index: 9, summary: 's' },
    ],
  })
  if ('deny' in out) throw new Error(out.deny)
  // queued: a warning, never a refusal
  expect(out.queued).toBe(3)
  expect(out.warnings).toEqual([
    "Warning: collapse #2..#9 covers the person's messages: #3 (prompt), #6 (AskUserQuestion answer). Keep them verbatim unless you drop them deliberately.",
    "Warning: summarize q covers the person's messages: #6 (AskUserQuestion answer). Keep them verbatim unless you drop them deliberately.",
  ])
  expect(queuedText(out.queue, out.queued, out.errors, out.warnings)).toContain('covers the person')
})

test('context_edit — не промпти людини: a mod report row, the /compact MARKER row, a changed row: no warning', async () => {
  const r = personRows()
  expect(personRow(r, 10)).toBe(false)
  expect(personRow(r, 11)).toBe(false)
  expect(personRow(r, 12)).toBe(false)
  expect(personRow(r, 3)).toBe(true)
  const out = queueEdits(EMPTY_QUEUE, r, { edits: [{ op: 'collapse', from_index: 10, to_index: 13, summary: 's' }] })
  expect('warnings' in out && out.warnings).toEqual([])
})

// [SP_CTX_02_02] review round 39: rows the host writes as user rows that are no message of the person
test('PersonRow — not the person: a plugin prompt in the host frame, host tag rows, the compaction summary', async () => {
  const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
  const r = [
    user('The context-editor plugin sent a message:\ncontext-editor: optimization turn for stage "A"'),
    user('The other-tool plugin sent a message:\nhello'),
    user('<local-command-stdout>Compacted </local-command-stdout>'),
    user('<local-command-caveat>Caveat: …</local-command-caveat>'),
    user('<command-name>/dev-flow</command-name><command-message>dev-flow</command-message>'),
    user('<command-message>dev-flow is running…</command-message>'),
    user('<ide_opened_file>The user opened x.ts</ide_opened_file>'),
    user('<task-notification>agent done</task-notification>'),
    user('This session is being continued from a previous conversation that ran out of context.'),
    user('Please also check the plugin sent a message: earlier'),
  ]
  expect(r.map((_, i) => personRow(r, i))).toEqual([false, false, false, false, false, false, false, false, false, true])
  const out = queueEdits(EMPTY_QUEUE, [...r, { role: 'assistant', text: 'end', toolUses: [] }], { edits: [{ op: 'collapse', from_index: 0, to_index: 8, summary: 's' }] })
  expect('warnings' in out && out.warnings).toEqual([])
})

// [SP_CTX_02_02] review round 40: real person rows with host framing
test('PersonText — the person\'s words behind an open-file span, and the arguments of a slash command', async () => {
  const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
  const vscode = user('<ide_opened_file>The user opened the file /repo/docs/plan.md in the IDE. This may or may not be related to the current task.</ide_opened_file>\nПродовжуй з фазою 17')
  const reminder = user('<system-reminder>\nnote\n</system-reminder>\n<ide_opened_file>The user opened x.ts</ide_opened_file>\nfix it')
  const slash = user('<command-message>dev-flow</command-message>\n<command-name>/dev-flow</command-name>\n<command-args>research the stage cleanup</command-args>')
  const bare = user('<command-message>dev-flow</command-message>\n<command-name>/dev-flow</command-name>')
  const opened = user('<ide_opened_file>The user opened x.ts</ide_opened_file>')
  const mod = user('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>context-editor: apply queued edits</command-args>')
  expect(personText(vscode.text)).toBe('Продовжуй з фазою 17')
  expect(personText(reminder.text)).toBe('fix it')
  expect(personText(slash.text)).toBe('research the stage cleanup')
  // review round 41: only the mod's own /compact with its exact marker is excluded
  const talksAboutIt = '<command-message>dev-flow</command-message>\n<command-name>/dev-flow</command-name>\n<command-args>do fix the /compact race in context-editor: apply queued edits</command-args>'
  expect(personText(talksAboutIt)).toBe('do fix the /compact race in context-editor: apply queued edits')
  expect(personText('<command-name>/compact</command-name>\n<command-args>context-editor: apply queued edits</command-args>')).toBe('')
  const r = [vscode, reminder, slash, bare, opened, mod]
  expect(r.map((_, i) => personRow(r, i))).toEqual([true, true, true, false, false, false])
  const out = queueEdits(EMPTY_QUEUE, [...r, { role: 'assistant', text: 'end', toolUses: [] }], { edits: [{ op: 'collapse', from_index: 0, to_index: 5, summary: 's' }] })
  expect('warnings' in out && out.warnings[0]).toContain('#0 (prompt), #1 (prompt), #2 (prompt).')
})
