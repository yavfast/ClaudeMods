# Редактор контексту агента — Implementation Plan: фаза 47 — Тека архівів від кореня проєкту сесії

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-21
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 47 — Тека архівів від кореня проєкту сесії [DONE]  {#PL_CTX_P47}

**Depends on:** Phase 34 (архіви субагентів), Phase 35 (ArchiveRoot), Phase 41 (база шляхів SourceOf).
**Implements:** [SP_CTX_DEC_45](./context_editor.decisions-21.sp.md#SP_CTX_DEC_45); [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07) ArchiveRoot, [SP_CTX_02_49](./context_editor.subagents.sp.md#SP_CTX_02_49), база відносних шляхів [SP_CTX_01_28](./context_editor.curation.edits.sp.md#SP_CTX_01_28) і [SP_CTX_02_66](./context_editor.curation.edits.sp.md#SP_CTX_02_66), файл лічильників зонда [SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57); пункт backlog «Тека архівів іде за поточною текою оболонки», клас «`cd`».
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядок ArchiveRoot (випадок «оболонка після `cd`»); `grep -n 'session\.cwd' mods/context-editor/hooks/*.ts` — порожньо, `$.session.root()` — лише в ProjectRoot; tsc, `claude plugin validate`, `claude plugin test`, `tests/skill-limits.sh` зелені; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Тека архівів після `cd`» (stream-json, haiku).

| Що | Де |
|----|----|
| ProjectRoot: `projectRoot($)` — `$.session.root()`, збій → `undefined`; через нього ArchiveRoot, порти `cwd` у BlockIO (`blockHost`) і HandoffIO, CompactionIO `cwd`, `writeCounts`; збій — рядок у debug-лог (ERR-01); коментарі ArchiveRoot, `writeCounts` і `ownArchives` | `mods/context-editor/hooks/register.ts`, `hooks/cleanup.ts` (коментар) |
| Коментарі бази шляхів: SourceOf, ApplyOptions `cwd`, ARCHIVE_ROOM, BlockIO `cwd`, CompactionIO `cwd`, HandoffIO і SeedInput `cwd` | `mods/context-editor/hooks/edits.ts`, `hooks/stages.ts`, `hooks/compaction.ts`, `hooks/handoff.ts` |
| CLAUDE.md: де лежать архіви (`<project>` = `$.session.root()`), `archives.txt` — один рядок на корінь проєкту | `CLAUDE.md` |

Поза фазою: рядок «Диск, у проєкті» в [_framework.md](./_framework.md) веде лише `audit code` — розбіжність `<cwd>` → `<project>` лишається наступному аудиту коду; назви полів `cwd` у портах (`CompactionIO`, `HandoffIO`, `ApplyOptions`, `BlockIO`, `SeedInput`) лишаються — поле несе корінь проєкту, перейменування поведінки не дає.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-21 | Фаза створена: пункт backlog «Тека архівів іде за поточною текою оболонки», напрям (б) — розробник «Виправ мод context-editor через $.session.root()»; живий зонд — `.dev_flow/cache/live-test/root-probe/results.md` |
| 2026-10-21 | Фаза виконана: рев'ю — раунди 26 (FAIL, лише документи) і 27 (confirm, PASS); tsc, validate, 984 тести; живий сценарій «Тека архівів після `cd`» — pass (`.dev_flow/cache/live-test/p47-cd/results.md`); правило STRUCT-03, пункт 76 навички plugin-hooks |
