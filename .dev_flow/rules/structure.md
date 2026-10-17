# Rules: structure of the hook modules

Where shared logic lives in `mods/*/hooks/`. Origin: code audit PL_AUD_CTX, phase 3 (CF-3, CF-4, CF-5); STRUCT-02 — code audit PL_AUD2_CTX (CF2-30).

## STRUCT-01 — Give each row predicate and shared literal one home (should)  {#STRUCT-01}

**Applies to:** `mods/*/hooks/**` — row predicates and texts the host matches on.

A predicate over conversation rows (distinctive, thinking-only, merged call row) or a text the host matches on (a `<system-reminder` prefix, a marker) is defined once, in the pure module that owns that concept, and imported everywhere else; no module keeps its own copy.

### Why
Copies drifted: handoff.ts had its own reminder prefix and missed reminders with attributes (NO_SUMMARY), and notes.ts and tags.ts rebound merged call rows differently, so a pin was lost where a note survived (CF-4, CF-5).

### Examples

**Correct:**
```ts
// mods/context-editor/hooks/handoff.ts:40 — predicates and frames from the rows kernel
import { apiBlocks, DOCUMENT_FRAME, errorText, isBlankRow, isPlainUserRow, modText, resultsOf, squash, totalChars } from './rows'
```

**Incorrect:**
```ts
// a module-local copy of a host-matched prefix
const REMINDER = '<system-reminder>'   // misses `<system-reminder attr=…>`
```

**Provenance:** [task_PL_AUD_CTX](../tasks/task_PL_AUD_CTX.md) Ф3+Ф4 (CF-3…CF-5) and Ф9 (CF-17, `hooks/rows.ts`), archived in [session_2026-10-17](../session_history/session_2026-10-17.md); CLAUDE.md «Ports pattern» (`hooks/rows.ts`).

## STRUCT-02 — Keep decisions out of register.ts: a branch over state goes into a ports module with a test (should)  {#STRUCT-02}

**Applies to:** `mods/*/hooks/register.ts` and the ports module that owns the concept — any new `if`/route/verdict in a hook body.

`register.ts` binds ports to `$` and orders hook steps; a decision over mod state (a verdict, a gate, a path rule, a counter that turns into a result) is a pure function in the module that owns the concept, called from the hook and covered by a `tests/*.test.ts` case.

### Why
Audit 20261011 moved this logic out (CF-19, `register.ts` 1249 → 910 lines); phases 32–46 put verdicts, probe counters and the archive path rule back (910 → 1772 lines), and none of it is reachable from a test (audit 20261017: ARCH-1, TST-1…TST-3, TST-8).

### Examples

**Correct:**
```ts
// mods/context-editor/hooks/register.ts:1507 — the hook binds, the decision lives in compaction.ts
await observeCompaction({ hostId: () => peekHostId(hostId), /* … ports … */ }, e, done)
```

**Incorrect:**
```ts
// mods/context-editor/hooks/register.ts:1140 — a verdict decided in the binding file
if (caps.ownSeen === seen) { noteCommandUnseen(caps); void mergeCaps($, 'live') }
```

**Provenance:** [PL_AUD2_CTX](../audit/context-editor_20261017_101904.plan.md) CF2-30 (audit 20261017_101904); PL_CTX_DEC_01; earlier CF-19 in [PL_AUD_CTX](../audit/context-editor_20261011_182951.plan.md).
