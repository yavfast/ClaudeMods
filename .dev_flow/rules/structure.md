# Rules: structure of the hook modules

Where shared logic lives in `mods/*/hooks/`. Origin: code audit PL_AUD_CTX, phase 3 (CF-3, CF-4, CF-5).

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
