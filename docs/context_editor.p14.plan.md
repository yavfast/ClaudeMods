# Редактор контексту агента — Implementation Plan: фаза 14 — Етапи і свідомий тригер оптимізації: ядро

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 14 — Етапи і свідомий тригер оптимізації: ядро [DONE]  {#PL_CTX_P14}

**Depends on:** Phase 13; [C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15)–[DEC_17](./context_editor.methods.concept.md#C_CTX_DEC_17); [SP_CTX_DEC_11](./context_editor.decisions-01.sp.md#SP_CTX_DEC_11)–[DEC_15](./context_editor.decisions-01.sp.md#SP_CTX_DEC_15); задача `.dev_flow/tasks/task_20261010_083402_stage-cleanup.md` (відкриті знахідки рев'ю 35 — «Перевірити на практиці»)
**Implements:** [SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04) (`optimize`, `optimizePrompted`), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`produced`), [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`stage`, `lastClosed`, `introduced`), [01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (без NUDGE_*; OPTIMIZE_MARK, MESSAGES_ROW, MAX_STAGE_NAME, MAX_BLOCK_INDEXES, INTRO_TEXT, STAGE_ADVICE, SKILL), [01_17](./context_editor.records.sp.md#SP_CTX_01_17) (`carried`), [01_18](./context_editor.records.sp.md#SP_CTX_01_18), [01_20](./context_editor.records.sp.md#SP_CTX_01_20) без кандидатів за причинами, журналу і слоту стану; [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) з телеметрією, `count: 0`, `[stage ▶]`, `[block ▶]`/`[block end]`; [02_06](./context_editor.flush.sp.md#SP_CTX_02_06) (Optimize); [02_07](./context_editor.apply.sp.md#SP_CTX_02_07) (перенесення `optimize`, `optimizePrompted`; `produced`); [02_08](./context_editor.flush.sp.md#SP_CTX_02_08) (вступ, PersonAdvice, `optimizePrompted`); [02_09](./context_editor.edits.sp.md#SP_CTX_02_09) (вилучено); [02_11](./context_editor.tags.sp.md#SP_CTX_02_11) `open`/`close`; [02_13](./context_editor.tags.sp.md#SP_CTX_02_13) тригери закриття і мітки; [02_14](./context_editor.tags.sp.md#SP_CTX_02_14) RelocateMark; [02_15](./context_editor.tags.sp.md#SP_CTX_02_15), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) без нагадування; [02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (`listedKey` звітом закриття); [02_21](./context_editor.handoff.sp.md#SP_CTX_02_21), [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22) (мітки, `introduced`, `carried`); [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (вступ і навичка — лише ядро), [02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29), [02_30](./context_editor.stages.sp.md#SP_CTX_02_30); [04_05](./context_editor.states.sp.md#SP_CTX_04_05), [04_06](./context_editor.states.sp.md#SP_CTX_04_06)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки контрактів зі списку Implements (Telemetry, StageBlock, DetectOptimize, Flush/Optimize, DeliverReport, context_tag `open`/`close`, RebindTags/RelocateMark, produced, HandleCompaction зберігає `optimize`), [05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) інваріанти етапу й черги, [05_04](./context_editor.edges.sp.md#SP_CTX_05_04) відповідні рядки; `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03): «Етап: закриття і стискання блоку», «Мітка оптимізації, stream-json», «Мітка оптимізації, термінал», «Мітка при непорожній черзі», «Людина випереджає хід оптимізації», «Інструкція на початку сесії», «Межа етапу після застосування», «Вбудована компактизація при відкритому етапі»; результати живих прогонів — у задачі етапів (знахідки «Перевірити на практиці» підтвердити або закрити)

**Результат (2026-10-10):** 304 модульні тести, validate, tsc 0; живі сценарії фази 14 — pass в обох хостах (`.dev_flow/cache/live-test/phase14-results.md`); знайдено й виправлено D1 (стискання паралельних викликів рвало пару — MergeCallRows, 02_04), D2 (телеметрія після `/compact` хоста), D3 (`~` у пораді); рев'ю коду раунд 36 — WARNINGS, виправлено. Практика: haiku етапів без вказівки не відкриває, sonnet обирає мітку — питання до фази 15 і навички.

| Що | Де |
|----|----|
| Етапи: RowMark, StartOf, MarkBefore, RelocateMark, CloseStage, BlockReport, OptimizeText, PersonAdvice, ListHint, DetectOptimize, Telemetry (чисті функції за портами) | `mods/context-editor/hooks/stages.ts` (новий); `tests/stages.test.ts` (новий) |
| Реєстр: `stage`, `lastClosed`, `introduced`; `context_tag` `open`/`close`; прибрати `nudge`, `nudgeText`, NUDGE_*; QueueTagReplacements без перевірки `listedKey` | `mods/context-editor/hooks/tags.ts`; `tests/tags.test.ts` |
| Черга: `optimize`, `optimizePrompted`; DeliverReport — вступ, PersonAdvice, скидання `optimizePrompted` | `mods/context-editor/hooks/queue.ts`; `tests/queue.test.ts` |
| Flush: Optimize, перевірка перед заміною і CAS, OPTIMIZE_* | `mods/context-editor/hooks/flush.ts`; `tests/flush.test.ts` |
| `produced` після DropOwnCalls; перенесення `optimize`/`optimizePrompted` у записах черги | `mods/context-editor/hooks/edits.ts`, `hooks/compaction.ts`; тести відповідних модулів |
| Передача: копія реєстрів з перенесеними мітками, `introduced = false`, `carried` | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| Реєстрація: опис і схема `context_tag` (`open`/`close`), опис `context_list` і `context_edit` (пріоритети MAX_DESCRIPTION), DetectOptimize у `turn.complete`, вступ у `prompt.submit`, телеметрія через `$.session.usage({ breakdown: 'summary' })`, хук `tool.call` без нагадування | `mods/context-editor/hooks/register.ts` |
| Навичка мода (ядро: етапи, мітка, телеметрія, запис етапу, повернення через архів) | `mods/context-editor/skills/context-stages/SKILL.md` (новий) |
| Живі сценарії: драйвери для мітки й етапів у терміналі і stream-json; тестові файли | `.dev_flow/cache/live-test/` (локально) |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
