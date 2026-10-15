# Редактор контексту агента — Implementation Plan: фаза 35 — Архіви основної розмови в проєкті

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 35 — Архіви основної розмови в проєкті [DONE]  {#PL_CTX_P35}

**Depends on:** Phase 34 (каталог архівів субагентів).
**Implements:** [C_CTX_DEC_28](./context_editor.core.concept.md#C_CTX_DEC_28); [SP_CTX_01_06](./context_editor.structures.sp.md#SP_CTX_01_06), [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07) ArchiveRoot; шляхи в HandleCompaction ([SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07)), PrepareSeed і RemoveSeedFiles ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), HandleRepair ([SP_CTX_02_47](./context_editor.resume.sp.md#SP_CTX_02_47)), JournalReread ([SP_CTX_02_31](./context_editor.stages.sp.md#SP_CTX_02_31)).
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки ArchiveRoot, HandleCompaction «архів у каталозі архівів», PrepareSeed «файли засіву», MarkCall «читання архіву»; живий сценарій 05_03 «Архів основної розмови в проєкті» (stream-json, haiku, без `bypassPermissions`).

| Що | Де |
|----|----|
| ArchiveRoot: `archiveRoot($, dir)` — `<cwd>/.claude/context-editor/<basename dir>` або `undefined` (каталог сесії створюється в тому ж виклику), `archivesOf` з відкатом на `dir`; порт субагентів (`shapeIO`) — через `archiveRoot`; поле `archives` у `CompactionIO`, `RepairHandlerIO`, порт `archives(dir)` у `HandoffIO` (каталог медіа засіву — `HandoffSeed.media`) | `mods/context-editor/hooks/register.ts`, `compaction.ts`, `repair.ts`, `handoff.ts` |
| JournalReread: медіа — шлях архіву без `.json` + `/`, параметр `dir` прибрано | `mods/context-editor/hooks/journal.ts` |
| Тести: шляхи архіву й медіа в каталозі архівів (компактизація, засів, відновлення), видалення файлів засіву, повторне читання в обох каталогах | `tests/compaction.test.ts`, `tests/handoff.test.ts`, `tests/repair.test.ts`, `tests/journal.test.ts` |
| CLAUDE.md: де лежать архіви | `CLAUDE.md` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
