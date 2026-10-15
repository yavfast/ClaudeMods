# Редактор контексту агента — Implementation Plan: фаза 17 — Знахідки прогону на копії реальної сесії

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 17 — Знахідки прогону на копії реальної сесії [DONE]  {#PL_CTX_P17}

**Depends on:** Phase 14 (телеметрія, BlockReport, STAGE_ADVICE), Phase 16 (нотатки, NoteReminders); [C_CTX_DEC_21](./context_editor.core.concept.md#C_CTX_DEC_21); результати прогону `.dev_flow/cache/live-test/fork-test-results.md`; пропозиції P11–P12 задачі `.dev_flow/tasks/task_20261010_083402_stage-cleanup.md`
**Implements:** [SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34) і [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`charsPerToken`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (CALIB_*, PERSON_TOOLS, MAX_FULL_ROW, STAGE_ADVICE), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (Estimate у звіті), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20)/[02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (кандидати з рядками, `ratio`), [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) (один розмір, `index` + `full`, `Notes elsewhere`), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (PersonWarnings, EDIT_DESCRIPTION), [02_13](./context_editor.tags.sp.md#SP_CTX_02_13), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29) (Estimate), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16)/[02_33](./context_editor.stages.sp.md#SP_CTX_02_33)/[02_32](./context_editor.stages.sp.md#SP_CTX_02_32) (нагадування після інструментів мода), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (навичка: P11, P12, нагадування)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки Calibrate, Estimate, HandleCompaction (звіт з відношенням), context_list (один розмір, повний рядок, нотатки поза сторінкою), Telemetry (кандидати з рядками), context_edit (повідомлення людини), NoteReminders (після інструмента мода), опис інструментів ≤ MAX_DESCRIPTION; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки калібрування й повідомлень людини; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Повтор на копії сесії» в обох хостах (телеметрія один раз показує виміряне звільнення `Last apply`; число звіту позначено як оцінку)

| Що | Де |
|----|----|
| Calibrate, Estimate; `charsPerToken` у реєстрі; оцінки телеметрії, блоку, етапу, журналу; кандидати з рядками | `mods/context-editor/hooks/stages.ts`, `hooks/tags.ts`; `tests/stages.test.ts`, `tests/tags.test.ts` |
| Один розмір у заголовку переліку, `index` + `full`, `Notes elsewhere`; Estimate у звіті застосування (FormatReport з відношенням); PersonWarnings | `mods/context-editor/hooks/edits.ts`, `hooks/queue.ts`; `tests/edits.test.ts`, `tests/queue.test.ts` |
| Відношення в обробнику компактизації і BuildSeed (з реєстру, без телеметрії) | `mods/context-editor/hooks/compaction.ts`, `hooks/handoff.ts`; тести відповідних модулів |
| Нагадування після інструментів мода | `mods/context-editor/hooks/notes.ts`, `hooks/register.ts`; `tests/notes.test.ts` |
| Описи `context_list`, `context_edit`, `context_note` (EDIT — пріоритети MAX_DESCRIPTION); схема `context_list` (`index`, `full`) | `mods/context-editor/hooks/register.ts` |
| STAGE_ADVICE і навичка: дослівні цитати людини, причини відмови, AskUserQuestion — повідомлення людини, нагадування після будь-якого інструменту | `mods/context-editor/hooks/stages.ts`, `skills/context-stages/SKILL.md` |
| Живий сценарій «Повтор на копії сесії»: драйвер копії сесії (stream-json і термінал) | `.dev_flow/cache/live-test/` (локально) |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
