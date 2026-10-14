import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  boundaryOf,
  currentRows,
  fingerprint,
  HEAD_ROWS,
  MAX_DESCRIPTION,
  newHostIdMemo,
  newHostToken,
  parseBoundary,
  parseHostId,
  peekHostId,
  prepare,
  readView,
  recordBoundary,
  sessionSwitched,
  STALE_INDEXES,
  startHostId,
  HOST_ID_READS,
  kickHostId,
  afterPrepare,
  type AfterPrepareIO,
  type BoundaryMemory,
  type ViewIO,
} from '../hooks/edits'
import { applyTagRequests, EMPTY_REGISTRY } from '../hooks/tags'
import { applyNoteRequests } from '../hooks/notes'
import { EDIT_DESCRIPTION, HANDOFF_DESCRIPTION, LIST_DESCRIPTION, NOTE_DESCRIPTION, TAG_DESCRIPTION } from '../hooks/tools'

function row(role: 'user' | 'assistant', text: string): SessionMessage {
  return { role, text, toolUses: [] }
}

// A segment as a compaction leaves it: the prompt, then turns.
function segment(tag: string, n: number): SessionMessage[] {
  return [row('user', 'task'), ...Array.from({ length: n - 1 }, (_, i) => row(i % 2 ? 'user' : 'assistant', `${tag} ${i}`))]
}

test('without a boundary the whole transcript is current', async () => {
  const t = segment('a', 9)
  expect(currentRows(t, undefined)).toEqual(t)
})

test('after a compaction the rows before its head are cut', async () => {
  const old = segment('old', 9)
  const returned = segment('kept', 7)
  const later = [row('user', 'next'), row('assistant', 'answer'), row('assistant', 'more')]
  const cur = currentRows([...old, ...returned, ...later], boundaryOf(returned))
  expect(cur.length).toBe(10)
  expect(cur[0]).toBe(returned[0])
})

test('two compactions with the same head: the last occurrence wins', async () => {
  const first = segment('s', 9)
  const second = segment('s', 7)
  const third = segment('s', 5)
  const t = [...first, ...second, ...third, row('user', 'new')]
  const cur = currentRows(t, boundaryOf(third))
  expect(cur.length).toBe(6)
  expect(cur[0]).toBe(third[0])
})

test('a head that is not in the transcript keeps the whole transcript', async () => {
  const t = segment('a', 9)
  expect(currentRows(t, boundaryOf([row('user', 'elsewhere')]))).toEqual(t)
})

test('a match with fewer rows after it than the compaction returned does not count', async () => {
  const returned = segment('k', 6)
  const old = segment('k', 3)
  // the head matches at 0 (six rows on) but also at 9, where only three rows follow
  const t = [...returned, row('user', 'x'), row('assistant', 'y'), row('user', 'z'), ...old]
  const cur = currentRows(t, boundaryOf(returned))
  expect(cur.length).toBe(t.length)
})

test('boundaryOf keeps the first HEAD_ROWS fingerprints and the count; none for no rows', async () => {
  const rows = segment('b', 12)
  expect(boundaryOf(rows)).toEqual({ head: rows.slice(0, HEAD_ROWS).map(fingerprint), count: 12 })
  expect(boundaryOf([])).toBe(undefined)
})

test('parseBoundary takes only a well-formed boundary', async () => {
  expect(parseBoundary(JSON.stringify({ head: ['a', 'b'], count: 5 }))).toEqual({ head: ['a', 'b'], count: 5 })
  expect(parseBoundary('{')).toBe(undefined)
  expect(parseBoundary('null')).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: [], count: 1 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: ['a', 'b'], count: 1 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: Array(HEAD_ROWS + 1).fill('a'), count: 20 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: [1], count: 1 }))).toBe(undefined)
  expect(parseBoundary(JSON.stringify({ head: ['a'], count: 1.5 }))).toBe(undefined)
})

test('every tool description reaches the model whole (the five tools)', async () => {
  for (const d of [LIST_DESCRIPTION, EDIT_DESCRIPTION, TAG_DESCRIPTION, HANDOFF_DESCRIPTION, NOTE_DESCRIPTION]) expect(d.length <= MAX_DESCRIPTION).toBe(true)
})

// [SP_CTX_02_02] [SP_CTX_DEC_20] phase 21: "last" is the latest call, marked or not
test('EDIT_DESCRIPTION — last (phase 21)', async () => {
  expect(EDIT_DESCRIPTION.length <= MAX_DESCRIPTION).toBe(true)
  expect(EDIT_DESCRIPTION).toContain('"ref":"last" your latest call, without context_list.')
  expect(EDIT_DESCRIPTION).not.toContain('latest marked')
})

// [SP_CTX_02_01] [SP_CTX_02_02] [SP_CTX_02_11] the content phase 15 adds
test('опис інструмента (phase 15): the state slot, the range, the review reasons and the ~ flag are named', async () => {
  expect(EDIT_DESCRIPTION).toContain('A row tagged [state] changes only by a rewrite of that row.')
  expect(EDIT_DESCRIPTION).not.toContain('the working part')
  // [SP_CTX_DEC_16] phase 18, review 46 F2: the optimization turn's exception
  expect(EDIT_DESCRIPTION).toContain('unless "resume" is false; in a /compact turn only on "resume": true or "resume_prompt".')
  expect(TAG_DESCRIPTION).toContain('"state"')
  expect(TAG_DESCRIPTION).toContain('"index" and "to"')
  expect(TAG_DESCRIPTION).toContain('big, search, stale (the file changed since), duplicate')
  expect(TAG_DESCRIPTION).toContain('A new tag on a target replaces the old one; "remove" drops it.')
  expect(LIST_DESCRIPTION).toContain('~ after tool_use/tool_result')
  expect(LIST_DESCRIPTION).toContain('[review: reason]')
  expect(LIST_DESCRIPTION).toContain('[state]')
  expect(LIST_DESCRIPTION).toContain('[disposable #a..#b: note]')
})

test('stale indexes: collapse and rewrite are refused, edits by id still queue', async () => {
  const rows: SessionMessage[] = [
    row('user', 'task'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false }] },
    row('assistant', 'done'),
  ]
  const edits = [
    { op: 'collapse', from_index: 1, to_index: 2, summary: 's' },
    { op: 'rewrite', index: 3, text: 't' },
    { op: 'summarize', tool_use_id: 'a', summary: 's' },
  ]
  const stale = prepare(rows, edits, undefined, undefined, true)
  expect(stale.queued.map(e => e.op)).toEqual(['summarize'])
  expect(stale.errors.length).toBe(2)
  expect(stale.errors.every(e => e.includes(STALE_INDEXES))).toBe(true)
  expect(prepare(rows, edits).queued.length).toBe(3)
})

test('stale indexes: a tag by index is refused, a tag by id is added', async () => {
  const rows: SessionMessage[] = [
    row('user', 'task'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false }] },
    row('assistant', 'done'),
  ]
  const out = applyTagRequests({ ...EMPTY_REGISTRY }, rows, [{ op: 'add', kind: 'pin', index: 3 }, { op: 'add', kind: 'pin', tool_use_id: 'a' }], undefined, true)
  expect(out.added).toBe(1)
  expect(out.rejected.map(r => r.code)).toEqual(['INDEXES_STALE'])
})

// [SP_CTX_02_03] [SP_CTX_02_18] phase 18: a listing with count 0 renews no
// indexes, so every INDEXES_STALE refusal asks for a listing with rows
test('stale indexes: the refusal of context_edit, context_tag and context_note asks for a listing with rows (count > 0)', async () => {
  const rows: SessionMessage[] = [
    row('user', 'task'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false }] },
    row('assistant', 'done'),
  ]
  const edit = prepare(rows, [{ op: 'rewrite', index: 3, text: 't' }], undefined, undefined, true)
  const tag = applyTagRequests({ ...EMPTY_REGISTRY }, rows, [{ op: 'add', kind: 'pin', index: 3 }], undefined, true)
  const note = applyNoteRequests({ ...EMPTY_REGISTRY, notes: [] }, rows, [{ op: 'add', text: 'n', index: 3 }], undefined, true)
  const reasons = [edit.errors[0], tag.rejected[0]?.reason, note.rejected[0]?.reason]
  for (const reason of reasons) {
    expect(reason ?? '').toContain('call context_list with a page of rows (count > 0) for current indexes')
    expect(reason ?? '').toContain('count 0 and "full" do not renew them')
  }
  // once a listing with rows renewed the key, the same targets are taken
  expect(prepare(rows, [{ op: 'rewrite', index: 3, text: 't' }]).queued.length).toBe(1)
  expect(applyTagRequests({ ...EMPTY_REGISTRY }, rows, [{ op: 'add', kind: 'pin', index: 3 }]).added).toBe(1)
  expect(applyNoteRequests({ ...EMPTY_REGISTRY, notes: [] }, rows, [{ op: 'add', text: 'n', index: 3 }]).added.length).toBe(1)
})

// ---- [SP_CTX_01_14] the host process's identity, [SP_CTX_02_18] Trusted(b)

const ID = 'k3x9q2m7v1c8b4n6:12345'

// A session of one compaction: the old rows, the returned rows, later rows.
function compactedSession() {
  const old = segment('old', 9)
  const returned = segment('kept', 7)
  const transcript = [...old, ...returned, row('user', 'next'), row('assistant', 'answer')]
  return { returned, transcript }
}

// CurrentRows bound to fakes: one session `S` with its storage, the
// boundary file as `file.raw`, ownBoundary as `mem.own`.
function viewIO(transcript: SessionMessage[], file: { raw?: string }, hostId: () => Promise<string | undefined>, mem: BoundaryMemory = {}): ViewIO {
  return {
    hostId,
    messages: async () => transcript,
    storage: async () => ({ sessionId: 'S', dir: '/s/S' }),
    readBoundary: async () => file.raw,
    own: () => mem.own,
  }
}

const known = (id: string | undefined) => async () => id

test('ParseHostId — розбір: digits after trimming and a token; anything else is no identity', async () => {
  expect(parseHostId('k3x9', '12345\n')).toBe('k3x9:12345')
  expect(parseHostId('k3x9', 'abc')).toBeUndefined()
  expect(parseHostId('', '12345')).toBeUndefined()
  expect(parseHostId('k3x9', '')).toBeUndefined()
  expect(parseHostId(undefined, '12345')).toBeUndefined()
  // the token a module sets: at least 16 of [0-9a-z]
  expect(/^[0-9a-z]{16,}$/.test(newHostToken())).toBe(true)
})

test('CurrentRows — гаряче перезавантаження: a boundary with host = hostId, written before the reload (no own boundary): trusted; rows from it', async () => {
  const { returned, transcript } = compactedSession()
  const file = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  const v = await readView(viewIO(transcript, file, known(ID)))
  expect(v.rows[0]).toBe(returned[0])
  expect(v.rows.length).toBe(returned.length + 2)
  expect(v.key).toBe(`S|${file.raw}`)
})

test('CurrentRows — перший перелік після перезавантаження: the hostId promise still runs; the read waits for it, trusts the boundary, and Key() does not change once it is done', async () => {
  const { returned, transcript } = compactedSession()
  const file = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  const memo = newHostIdMemo()
  let finish: (v: string) => void = () => undefined
  let reads = 0
  const io = viewIO(transcript, file, () =>
    startHostId(memo, () => {
      reads++
      return new Promise<string>(resolve => (finish = resolve))
    }),
  )
  const pending = readView(io)
  // a compaction handler meanwhile sees no identity
  expect(peekHostId(memo)).toBeUndefined()
  finish(ID)
  const first = await pending
  expect(first.rows[0]).toBe(returned[0])
  const second = await readView(io)
  expect(second.key).toBe(first.key)
  expect(reads).toBe(1)
})

test('CurrentRows — інший процес: a boundary with the host of another process (restart, --resume): the whole transcript', async () => {
  const { returned, transcript } = compactedSession()
  const file = { raw: JSON.stringify(boundaryOf(returned, 'other0token00000:999')) }
  const v = await readView(viewIO(transcript, file, known(ID)))
  expect(v.rows).toEqual(transcript)
  expect(v.key).toBe('S|')
})

test('CurrentRows — межа без host: without the field (an older version) or with a host that is no string, not written by this instance: the whole transcript', async () => {
  const { returned, transcript } = compactedSession()
  const b = boundaryOf(returned)!
  for (const raw of [JSON.stringify(b), JSON.stringify({ ...b, host: 42 })]) {
    expect(parseBoundary(raw)).toEqual(b)
    const v = await readView(viewIO(transcript, { raw }, known(ID)))
    expect(v.rows).toEqual(transcript)
  }
})

test('CurrentRows — власна межа без host: hostId absent; this instance wrote the boundary in this session: trusted; after a reload or a session switch the whole transcript', async () => {
  const { returned, transcript } = compactedSession()
  const file: { raw?: string } = {}
  const mem: BoundaryMemory = {}
  await recordBoundary(mem, async t => void (file.raw = t), boundaryOf(returned, undefined)!)
  expect(mem.own).toBe(file.raw)
  expect((await readView(viewIO(transcript, file, known(undefined), mem))).rows[0]).toBe(returned[0])
  // a reload: a new instance has no own boundary
  expect((await readView(viewIO(transcript, file, known(undefined), {}))).rows).toEqual(transcript)
  // a switch: PrepareStorage resets it
  mem.own = undefined
  expect((await readView(viewIO(transcript, file, known(undefined), mem))).rows).toEqual(transcript)
})

test('CurrentRows — /resume у тому самому процесі: the process wrote A\'s boundary with host = hostId; /clear, then /resume A: preparing A drops the host; CurrentRows gives the whole transcript', async () => {
  const { returned, transcript } = compactedSession()
  const file: { raw?: string } = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  // A → B (/clear) → A (/resume): each prepare after the first is a switch
  expect(sessionSwitched('A', 'B')).toBe(true)
  const { io } = prepareIO(file, { prev: 'B', now: 'A' })
  expect(await afterPrepare(io)).toBe(true)
  expect(parseBoundary(file.raw!)).toEqual(boundaryOf(returned))
  // ownBoundary was reset by the switch
  const v = await readView(viewIO(transcript, file, known(ID), {}))
  expect(v.rows).toEqual(transcript)
  // a boundary of another process, or no identity: left as it is
  const other: { raw?: string } = { raw: JSON.stringify(boundaryOf(returned, 'x:1')) }
  expect(await afterPrepare(prepareIO(other, { prev: 'B', now: 'A' }).io)).toBe(false)
  expect(other.raw).toBe(JSON.stringify(boundaryOf(returned, 'x:1')))
  const noId: { raw?: string } = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  expect(await afterPrepare(prepareIO(noId, { prev: 'B', now: 'A', wait: known(undefined) }).io)).toBe(false)
})

// The boundary step of PrepareStorage bound to fakes; `calls` names each port used.
function prepareIO(file: { raw?: string }, o: Partial<AfterPrepareIO> = {}) {
  const calls: string[] = []
  const toasts: string[] = []
  const io: AfterPrepareIO = {
    inCompaction: false,
    wait: async () => (calls.push('wait'), ID),
    peek: () => (calls.push('peek'), ID),
    read: async () => (calls.push('read'), file.raw),
    write: async t => void (calls.push('write'), (file.raw = t)),
    remove: async () => void (calls.push('remove'), (file.raw = undefined)),
    toast: t => void toasts.push(t),
    ...o,
  }
  return { io, calls, toasts }
}

test('PrepareStorage — перша підготовка: no session before this prepare (the module just loaded): the boundary is never read', async () => {
  const file = { raw: JSON.stringify(boundaryOf(segment('a', 9), ID)) }
  const { io, calls } = prepareIO(file, { now: 'S' })
  expect(await afterPrepare(io)).toBe(false)
  expect(calls).toEqual([])
  // the same session again is no switch either
  const same = prepareIO(file, { prev: 'S', now: 'S' })
  expect(await afterPrepare(same.io)).toBe(false)
  expect(same.calls).toEqual([])
})

test('PrepareStorage — перемикання в обробнику компактизації: a wait that never resolves is never called; the step ends with the peeked value', async () => {
  const returned = segment('a', 9)
  const pending: { raw?: string } = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  // identity not read yet: absent, the host stays
  const notYet = prepareIO(pending, { prev: 'A', now: 'B', inCompaction: true, wait: () => new Promise(() => undefined), peek: () => undefined })
  expect(await afterPrepare(notYet.io)).toBe(false)
  expect(notYet.calls).toEqual(['read'])
  expect(parseBoundary(pending.raw!)!.host).toBe(ID)
  // identity already read: the host goes, still without waiting
  const read = prepareIO(pending, { prev: 'A', now: 'B', inCompaction: true, wait: () => new Promise(() => undefined) })
  expect(await afterPrepare(read.io)).toBe(true)
  expect(read.calls).toEqual(['peek', 'read', 'write'])
  expect(parseBoundary(pending.raw!)!.host).toBeUndefined()
})

test('PrepareStorage — перемикання поза компактизацією: the step awaits the identity, then strips the host', async () => {
  const returned = segment('a', 9)
  const file: { raw?: string } = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  let finish: (v: string) => void = () => undefined
  const { io, calls } = prepareIO(file, { prev: 'A', now: 'B', wait: () => new Promise<string>(r => (finish = r)) })
  const done = afterPrepare(io)
  await Promise.resolve()
  expect(calls).toEqual([])
  finish(ID)
  expect(await done).toBe(true)
  expect(calls).toEqual(['read', 'write'])
  expect(file.raw).toBe(JSON.stringify(boundaryOf(returned)))
})

test('PrepareStorage — перезапис не вдався: the boundary file is removed; if that fails too, a toast names the error', async () => {
  const returned = segment('a', 9)
  const file: { raw?: string } = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  const failedWrite = prepareIO(file, { prev: 'A', now: 'B', write: async () => Promise.reject(new Error('disk full')) })
  expect(await afterPrepare(failedWrite.io)).toBe(true)
  expect(failedWrite.calls).toEqual(['wait', 'read', 'remove'])
  expect(file.raw).toBeUndefined()
  expect(failedWrite.toasts).toEqual([])
  const kept: { raw?: string } = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  const both = prepareIO(kept, {
    prev: 'A',
    now: 'B',
    write: async () => Promise.reject(new Error('disk full')),
    remove: async () => Promise.reject(new Error('rm: permission denied')),
  })
  expect(await afterPrepare(both.io)).toBe(false)
  expect(both.toasts).toEqual(['context-editor: the boundary of the resumed session could not be untrusted: rm: permission denied'])
})

test('CurrentRows — перша підготовка після завантаження: the module just loaded (a hot reload too) with a boundary host = hostId: no switch, the host stays, the boundary is trusted', async () => {
  const { returned, transcript } = compactedSession()
  const file = { raw: JSON.stringify(boundaryOf(returned, ID)) }
  expect(sessionSwitched(undefined, 'S')).toBe(false)
  expect(sessionSwitched('S', 'S')).toBe(false)
  expect(parseBoundary(file.raw)!.host).toBe(ID)
  expect((await readView(viewIO(transcript, file, known(ID)))).rows[0]).toBe(returned[0])
})

test('hostId — тайм-аут не запам\'ятовується: the first reader times out after HOST_ID_WAIT_MS while the read goes on; a later reader, after the read resolves, gets the identity, and so does a peek', async () => {
  const memo = newHostIdMemo()
  let finish: (v: string) => void = () => undefined
  let expire: () => void = () => undefined
  let reads = 0
  const read = () => {
    reads++
    return new Promise<string>(resolve => (finish = resolve))
  }
  const timer = () => new Promise<void>(resolve => (expire = resolve))
  const first = startHostId(memo, read, timer)
  expire()
  expect(await first).toBeUndefined()
  expect(peekHostId(memo)).toBeUndefined()
  // a reader after the timeout, while the read still runs, does not wait
  expect(await startHostId(memo, read, timer)).toBeUndefined()
  finish(ID)
  // the read ends: from then on every reader and peek has the identity
  await memo.current!.read
  expect(await startHostId(memo, read, timer)).toBe(ID)
  expect(peekHostId(memo)).toBe(ID)
  expect(reads).toBe(1)
})

test('hostId — повтор після збою: a read that ends without the identity is dropped; the next reader starts another, up to HOST_ID_READS reads', async () => {
  const memo = newHostIdMemo()
  let reads = 0
  const failing = async () => {
    reads++
    return parseHostId('tok', 'sh: not found')
  }
  for (let i = 0; i < HOST_ID_READS + 2; i++) expect(await startHostId(memo, failing)).toBeUndefined()
  expect(reads).toBe(HOST_ID_READS)
  const retried = newHostIdMemo()
  expect(await startHostId(retried, async () => Promise.reject(new Error('env.set refused')))).toBeUndefined()
  expect(await startHostId(retried, async () => parseHostId('tok', '42\n'))).toBe('tok:42')
  expect(peekHostId(retried)).toBe('tok:42')
})

test('hostId — обробник компактизації: kickHostId starts the first read only, never a retry, and never waits; a timer that throws ends the wait, not the caller', async () => {
  const memo = newHostIdMemo()
  let reads = 0
  const failing = async () => {
    reads++
    return undefined
  }
  kickHostId(memo, failing)
  await memo.current?.read
  expect(reads).toBe(1)
  // the first read ended without the identity: a compaction handler starts no retry
  kickHostId(memo, failing)
  expect(reads).toBe(1)
  expect(memo.current).toBeUndefined()
  // a reader outside a compaction does
  expect(await startHostId(memo, failing)).toBeUndefined()
  expect(reads).toBe(2)
  const throwing = newHostIdMemo()
  const out = startHostId(throwing, () => new Promise<string>(() => undefined), () => {
    throw new Error('sleep refused')
  })
  expect(await out).toBeUndefined()
})

test('CurrentRows — ідентичність не прочиталась: echo $PPID failed or printed no number, or $.env.set failed: hostId absent; the boundary has no host; only the own boundary is trusted', async () => {
  const failed = newHostIdMemo()
  expect(await startHostId(failed, async () => Promise.reject(new Error('env.set refused')))).toBeUndefined()
  // the failed read is not kept: the next reader may start another
  expect(failed.current).toBeUndefined()
  expect(peekHostId(failed)).toBeUndefined()
  const noPid = newHostIdMemo()
  expect(await startHostId(noPid, async () => parseHostId('tok', 'sh: not found'))).toBeUndefined()
  const { returned, transcript } = compactedSession()
  const b = boundaryOf(returned, peekHostId(failed))!
  expect('host' in b).toBe(false)
  const file: { raw?: string } = {}
  const mem: BoundaryMemory = {}
  await recordBoundary(mem, async t => void (file.raw = t), b)
  expect((await readView(viewIO(transcript, file, known(undefined), mem))).rows[0]).toBe(returned[0])
  expect((await readView(viewIO(transcript, file, known(undefined), {}))).rows).toEqual(transcript)
})

test('RecordBoundary — запис: 12 returned rows give a head of 8 fingerprints and count 12', async () => {
  const rows = segment('r', 12)
  const file: { raw?: string } = {}
  await recordBoundary({}, async t => void (file.raw = t), boundaryOf(rows)!)
  const b = parseBoundary(file.raw!)!
  expect(b.head).toEqual(rows.slice(0, 8).map(fingerprint))
  expect(b.count).toBe(12)
})

test('RecordBoundary — host: with hostId the boundary carries it, without it none; either way the written text is the own boundary; a failed write leaves it', async () => {
  const rows = segment('r', 12)
  for (const host of [ID, undefined]) {
    const mem: BoundaryMemory = {}
    const file: { raw?: string } = {}
    const text = await recordBoundary(mem, async t => void (file.raw = t), boundaryOf(rows, host)!)
    expect(parseBoundary(text)!.host).toBe(host)
    expect(mem.own).toBe(file.raw)
  }
  const mem: BoundaryMemory = { own: 'before' }
  await recordBoundary(mem, async () => Promise.reject(new Error('disk full')), boundaryOf(rows, ID)!).catch(() => undefined)
  expect(mem.own).toBe('before')
})

test('EDIT_DESCRIPTION — keep_cache (phase 23): a few words point to the field; the text stays within MAX_DESCRIPTION', async () => {
  expect(EDIT_DESCRIPTION).toContain('Batch edits in one call (see "keep_cache").')
  expect(EDIT_DESCRIPTION.length).toBe(2024)
})

// [PL_AUD_CTX_P6] TST-17: before the storage is ready
test('CurrentRows — сховище не готове: without a storage dir the whole transcript is current, Key is "<session>|", and no boundary is read', async () => {
  const { returned, transcript } = compactedSession()
  let reads = 0
  const io: ViewIO = {
    ...viewIO(transcript, { raw: JSON.stringify(boundaryOf(returned, ID)) }, known(ID)),
    storage: async () => ({ sessionId: 'S' }),
    readBoundary: async () => {
      reads++
      return JSON.stringify(boundaryOf(returned, ID))
    },
  }
  const v = await readView(io)
  expect(v.rows).toBe(transcript)
  expect(v.transcript).toBe(transcript)
  expect(v.key).toBe('S|')
  expect(reads).toBe(0)
})
