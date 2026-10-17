# Rules: concurrency in hook modules

Hook work runs on `serial()` chains and across awaits while the host may switch the session (`/clear`, `/resume`) or abandon a handler. Origin: code audit PL_AUD_CTX, phases 1–2 (CF-1, CF-2).

## CONC-01 — Take the storage folder once per operation (should)  {#CONC-01}

**Applies to:** `mods/*/hooks/**` — any hook work that reads or writes the session storage across an `await` or a chain turn.

A piece of work resolves the session's storage folder once, at the event that started it, and passes that `dir` to every read and write (`stores($, dir)` in `register.ts`; the older `*At(dir)` helpers such as `writeBoundaryAt`, `updateQueueAt`); it never reads a module-global folder after an `await`.

### Why
A session switch between the event and the chain turn moved writes into the new session's folder or into `<cwd>/undefined/` (CF-1, live run `.dev_flow/cache/live-test/audit-p1-results.md`).

### Examples

**Correct:**
```ts
// mods/context-editor/hooks/register.ts:695 — the port gets `dir` from its caller
function queueIO($: EngineInterface, dir: string): QueueIO {
  const q = stores($, dir).queue
  return { readQueue: q.read, writeQueue: q.write, quarantine: q.quarantine, queuePath: q.path }
}
// mods/context-editor/hooks/personcompact.ts:116 — the folder taken at the event
await io.updateQueueAt(st.dir)(q => { /* … */ })
```

**Incorrect:**
```ts
await io.readTags()
const q = stores($, publishedDir(storage)).queue   // folder read again after an await
```

**Provenance:** [task_PL_AUD_CTX](../tasks/task_PL_AUD_CTX.md) Ф1+Ф2 (CF-1), archived in [session_2026-10-17](../session_history/session_2026-10-17.md); live run `.dev_flow/cache/live-test/audit-p1-results.md`.

## CONC-02 — Commit side effects only after the last abort check (should)  {#CONC-02}

**Applies to:** `mods/*/hooks/**` — handlers the host may abandon (`session.compact`, anything under a host budget).

A handler the host may abandon (`session.compact`, anything under a host budget) computes every change first and writes only after checking `isAborted()` right before each write; a write that turns out to follow an abort is put back.

### Why
An abandoned apply committed tags, aliases, boundary and journal for rows the host never kept (CF-2).

### Examples

**Correct:**
```ts
// mods/context-editor/hooks/compaction.ts:346–357
const aliasesWritten = aliases && !io.isAborted() ? await io.writeAliases(aliases.next).then(() => true, () => false) : false
// …
if (io.isAborted()) {
  await putBack()
  return undefined
}
```

**Incorrect:**
```ts
await io.writeTags(tags.registry)      // written before the abort check
if (io.isAborted()) return ABANDONED   // the tags stay for rows the host dropped
```

**Provenance:** [task_PL_AUD_CTX](../tasks/task_PL_AUD_CTX.md) Ф1+Ф2 (CF-2), archived in [session_2026-10-17](../session_history/session_2026-10-17.md).
