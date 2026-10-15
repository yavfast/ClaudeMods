# Редактор контексту агента — Implementation Plan: фаза 43 — Застаріле читання і готові заміни

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** todo
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 43 — Застаріле читання і готові заміни [TODO]  {#PL_CTX_P43}

**Depends on:** Phase 41 (SourceOf, з якого рядок готової заміни бере шлях).
**Implements:** [C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08) (застаріле читання); [SP_CTX_02_65](./context_editor.curation.sp.md#SP_CTX_02_65), [SP_CTX_02_66](./context_editor.curation.sp.md#SP_CTX_02_66); причина `superseded` у [SP_CTX_01_30](./context_editor.curation.sp.md#SP_CTX_01_30) і в легенді переліку.
**Verify:** [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05) рядки SupersededRead (3), ReadyReplacements (1); [SP_CTX_05_06](./context_editor.curation.sp.md#SP_CTX_05_06) «R6 не чіпає `pin`, `disposable`, `state`, `stale`»; [SP_CTX_05_08](./context_editor.curation.sp.md#SP_CTX_05_08) «Звіт закриття з 30 застарілими читаннями»; відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| R6 у MarkCall, ReadPaths у пам'яті модуля, Changed за діапазоном і пронумерованими рядками | `hooks/tags.ts`, `hooks/register.ts` |
| готові заміни Outdated і Duplicate у звіті закриття етапу, без індексів | `hooks/stages.ts` (BlockReport) |
| легенда `context_list`: `superseded` | `hooks/stages.ts` |
| тести | `tests/tags.test.ts`, `tests/stages.test.ts` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Depends on: статусу в рядку готової заміни немає ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)); від фази 41 лишається SourceOf |
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
