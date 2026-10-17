# Rules: process records in `.dev_flow/`

How task files record history. Origin: audit 2026-10-17 (reflection harvest from task_PL_AUD_CTX).

## PROC-01 — Take log timestamps from git or the clock, never estimate them (should)  {#PROC-01}

**Applies to:** `.dev_flow/tasks/**`, `.dev_flow/session_history/**`, `.dev_flow/active_context.md` — log entries, `Last updated`, session history records.

A time in a task log entry, `Last updated` or a session history record comes from `git log --format=%ci` (for work tied to a commit) or from `date` at the moment of writing; when neither is available, write the date alone.

### Why
In task_PL_AUD_CTX the Ф5 entry had to correct earlier entries whose times were invented («час попередніх записів виправлено за часом комітів (був вигаданий)»); audits and `resume` order history by these times.

### Examples

**Correct:**
```
# git log -1 --format=%ci 4be53fd → 2026-10-13 …
- 2026-10-13 — фаза 35 закомічена (4be53fd)
- 2026-10-17 — audit: … (time unknown → date alone)
```

**Incorrect:**
```
- 2026-10-13 14:00 — фаза 35 закомічена   (time guessed, not from git or `date`)
```

**Provenance:** [task_PL_AUD_CTX](../tasks/task_PL_AUD_CTX.md) (Ф5 entry), audit 2026-10-17; log archived in [session_2026-10-17](../session_history/session_2026-10-17.md).
