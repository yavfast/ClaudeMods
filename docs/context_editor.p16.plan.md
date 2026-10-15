# Редактор контексту агента — Implementation Plan: фаза 16 — Службові нотатки агента

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 16 — Службові нотатки агента [DONE]  {#PL_CTX_P16}

**Depends on:** Phase 14 (реєстр тегів з етапами, `produced`, Survivors, BlockReport, OptimizeText, телеметрія); [C_CTX_DEC_20](./context_editor.core.concept.md#C_CTX_DEC_20). Від фази 15 не залежить: інструмент окремий, опис `context_tag` не змінюється
**Implements:** [SP_CTX_01_21](./context_editor.structures.sp.md#SP_CTX_01_21), [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`notes`, `nextNote`), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`notesDropped`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (MAX_NOTES, MAX_NOTE, NOTE_PREFIX, MAX_REMIND), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20)/[02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (рядок `Notes`), [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) (`[nN]`, блок `Notes:`), [02_14](./context_editor.tags.sp.md#SP_CTX_02_14) (RelocateNote), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16)/[02_33](./context_editor.stages.sp.md#SP_CTX_02_33) (нагадування), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29) (нотатки в BlockReport, NotesHint), [02_06](./context_editor.edits.sp.md#SP_CTX_02_06)/[02_08](./context_editor.edits.sp.md#SP_CTX_02_08) (кількість нотаток у промпті), [02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) (нотатки в передачі), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (розділ навички), [02_32](./context_editor.stages.sp.md#SP_CTX_02_32), [04_07](./context_editor.states.sp.md#SP_CTX_04_07)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки context_note, NoteReminders, RebindTags (нотатки), context_list, BlockReport, OptimizeText/PersonAdvice, Telemetry (нотатки), опис п'яти інструментів ≤ MAX_DESCRIPTION; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки нотаток; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Нотатки і нагадування» в обох хостах

| Що | Де |
|----|----|
| Note, розбір і межі в реєстрі; `context_note` (чиста функція за портом TagIO); RelocateNote і `notesDropped` у rebindTags; NoteReminders | `mods/context-editor/hooks/notes.ts` (новий), `hooks/tags.ts`; `tests/notes.test.ts` (новий), `tests/tags.test.ts` |
| Перегляд: `[nN]` і блок `Notes:`; рядок звіту `Notes dropped` у FormatReport | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| Телеметрія, BlockReport, NotesHint в OptimizeText і PersonAdvice | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts` |
| Передача: нотатки в копії реєстру | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| Реєстрація: інструмент `context_note` (опис ≈ 700 символів, схема), нагадування в загальному хуку `tool.call` після рядка псевдоніма | `mods/context-editor/hooks/register.ts` |
| Навичка: розділ «Notes» з прикладами | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живий сценарій «Нотатки і нагадування»: драйвери в терміналі і stream-json | `.dev_flow/cache/live-test/` (локально) |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
