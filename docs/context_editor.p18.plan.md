# Редактор контексту агента — Implementation Plan: фаза 18 — Дрібні знахідки практики

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 18 — Дрібні знахідки практики [DONE]  {#PL_CTX_P18}

**Depends on:** Phase 14 (хід оптимізації, OptimizeText, `optimizePrompted`), Phase 15 (P13 у звіті, `produced` після DropOwnCalls), Phase 17; [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16) — C, рішення розробника 2026-10-10; пункти backlog «Текст відмови `INDEXES_STALE`» і «Індекси у звіті застосування» (живий прогін фази 15, `.dev_flow/cache/live-test/phase15-results.md`); пропозиція P15 задачі `.dev_flow/tasks/task_20261010_083402_stage-cleanup.md` (практика 1, `.dev_flow/cache/practice/manim-c376ec30.jsonl`)
**Implements:** (1) текст STALE_INDEXES — [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (відмова INDEXES_STALE у `context_edit`, `context_tag`, `context_note`); (2) NowIndex у FormatReport — [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (компактизація і засів); (3) продовження після ходу оптимізації за [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16) — [01_04](./context_editor.structures.sp.md#SP_CTX_01_04), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [02_06](./context_editor.edits.sp.md#SP_CTX_02_06), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29), [04_06](./context_editor.states.sp.md#SP_CTX_04_06)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки PrepareEdits/context_tag/context_note «текст відмови після `count: 0`», FormatReport «NowIndex» і «NowIndex без запису», HandleCompaction «NowIndex після DropOwnCalls», BuildSeed «NowIndex у засіві», context_edit «хід оптимізації без `resume`», «з продовженням», «другий виклик», «поза ходом оптимізації», OptimizeText «без індексів» (нове речення), Flush «хід оптимізації без пакета» / «після пакета»; SKILL.md ≤ 8000 символів, опис інструментів ≤ MAX_DESCRIPTION (EDIT_DESCRIPTION не змінюється); `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Хід оптимізації після завершеного завдання» у stream-json (драйвер практики з FIFO): після пакета ходу оптимізації без `resume` — жодного промпту мода, промпт людини несе лише звіт, звіт з `(now #k)` збігається з переліком; другий прогін з `"resume": true` — промпт продовження надіслано

| Що | Де |
|----|----|
| STALE_INDEXES: «call context_list with rows (count > 0) for current indexes — count 0 shows telemetry only» | `mods/context-editor/hooks/edits.ts` (константа, спільна для `context_edit`, `context_tag`, `context_note`); `tests/boundary.test.ts` (застарілі індекси в правках і тегах), `tests/notes.test.ts` |
| NowIndex: суфікс ` (now #k)` з `report.produced` у `formatReport`; `report.applied` без змін | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` (FormatReport), `tests/compaction.test.ts` (після DropOwnCalls), `tests/handoff.test.ts` (засів) |
| Продовження в ході оптимізації: поле `resumeSet`, правило `resume` у `queueEdits` за `optimizePrompted`, `resumeSet` і `resume_prompt`; речення зупинки в `queuedText` | `mods/context-editor/hooks/queue.ts`; `tests/queue.test.ts` |
| Заміна Flush скидає продовження пакета, що лишився в черзі (`swapOptimize`) | `mods/context-editor/hooks/flush.ts`; `tests/flush.test.ts` |
| EDIT_DESCRIPTION: виняток ходу оптимізації (≤ 2048) | `mods/context-editor/hooks/register.ts`; `tests/boundary.test.ts` |
| Останнє речення OptimizeText | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts`, `tests/flush.test.ts` (тексти промпту ходу оптимізації) |
| Рядок навички «Optimization mark» (≤ 8000 символів, зараз 7987) | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живий сценарій: драйвер практики (FIFO, зупинка файлом `stop`) з коротким завданням і промптом людини після простою | `.dev_flow/cache/practice/` (локально) |

Розбір P15 (2026-10-10, практика 1): поведінка мода в прогоні збігалася зі специфікацією. Агент у ході оптимізації передав `"resume": false` (порада OptimizeText), тож обробник записав `reportResume = false`, Flush після компактизації нічого не надіслав, і процес простоював без очікування чогось; `resume: true` і `resumePrompt` у `pending.json` — значення за замовчуванням для наступного пакета, а DeliverReport віддав би наступному промпту людини лише звіт, без тексту продовження. Хибне «Continue the task from where you stopped.» прийшло б лише тоді, коли агент у ході оптимізації не передав би `resume`; пункт (3) прибирає саме цей випадок (подробиці й варіанти — [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16)).

Стан 2026-10-10: живий сценарій пройдено; рев'ю 46 (WARNINGS) виправлено — `resumeSet`, скидання пакета, що лишився, у заміні Flush, речення зупинки в `queuedText`, EDIT_DESCRIPTION 2045/2048, навичка 7991 символ (7997 байтів), 434 тести. До рев'ю: код і модульні тести готові (431 тест, було 422; `claude plugin validate` і tsc проходять; навичка 7987 символів, EDIT_DESCRIPTION без змін). Живий сценарій 05_03 тоді ще не запускався. Відхилення від таблиці файлів: тест засіву — без голови-підсумку (індекс з `produced`, 05_01 уточнено); у навичці друге речення рядка скорочено до «Mid-work, close the stage with the tool.», щоб файл лишився ≤ 8000 байтів.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
