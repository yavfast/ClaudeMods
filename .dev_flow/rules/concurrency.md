# Rules: concurrency in hook modules

Hook work runs on `serial()` chains and across awaits while the host may switch the session (`/clear`, `/resume`) or abandon a handler. Origin: code audit PL_AUD_CTX, phases 1–2 (CF-1, CF-2).

## Take the storage folder once per operation — should {#CONC-01}

A piece of work resolves the session's storage folder once, at the event that started it, and passes that `dir` to every read and write (`*At(dir)`); it never reads a module-global folder after an `await`.

**Why:** a session switch between the event and the chain turn moved writes into the new session's folder or into `<cwd>/undefined/` (CF-1, live run `.dev_flow/cache/live-test/audit-p1-results.md`).

## Commit side effects only after the last abort check — should {#CONC-02}

A handler the host may abandon (`session.compact`, anything under a host budget) computes every change first and writes only after checking `isAborted()` right before each write; a write that turns out to follow an abort is put back.

**Why:** an abandoned apply committed tags, aliases, boundary and journal for rows the host never kept (CF-2).
