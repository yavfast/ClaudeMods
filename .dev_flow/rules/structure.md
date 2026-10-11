# Rules: structure of the hook modules

Where shared logic lives in `mods/*/hooks/`. Origin: code audit PL_AUD_CTX, phase 3 (CF-3, CF-4, CF-5).

## Give each row predicate and shared literal one home — should {#STRUCT-01}

A predicate over conversation rows (distinctive, thinking-only, merged call row) or a text the host matches on (a `<system-reminder` prefix, a marker) is defined once, in the pure module that owns that concept, and imported everywhere else; no module keeps its own copy.

**Why:** copies drifted: handoff.ts had its own reminder prefix and missed reminders with attributes (NO_SUMMARY), and notes.ts and tags.ts rebound merged call rows differently, so a pin was lost where a note survived (CF-4, CF-5).
