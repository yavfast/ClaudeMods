# Редактор контексту агента — Implementation Plan: фаза 20 — Доставки хоста посеред ходу

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 20 — Доставки хоста посеред ходу [DONE]  {#PL_CTX_P20}

**Depends on:** Phase 5 (PromptMatch, PROMPT_DECORATIONS), Phase 17 (PersonText, PersonWarnings), Phase 18 (Produced, NowIndex); Phase 19 — не за змістом, а за файлами (обидві змінюють `edits.ts` і тести текстів замін: спершу 19); [SP_CTX_DEC_19](./context_editor.decisions-01.sp.md#SP_CTX_DEC_19) = A, рішення розробника 2026-10-11 (R1 спайку, R2 — backlog); спайк [context_editor_attachments](./context_editor_attachments.spike.md); навичка plugin-hooks, пункти 6, 24, 43–45
**Implements:** [SP_CTX_01_22](./context_editor.records.sp.md#SP_CTX_01_22) (QueuedDelivery, `deliveries.json`), [01_07](./context_editor.structures.sp.md#SP_CTX_01_07), [01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (MAX_DELIVERIES, MAX_DELIVERY_TEXT, DELIVERY_FRAMES, PROMPT_DECORATIONS з `<system-reminder`), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`deliveries`, речення звіту, `charsAfter` без вставлених рядків), [02_35](./context_editor.deliveries.sp.md#SP_CTX_02_35) RecordDelivery і зв'язування в [02_12](./context_editor.tags.sp.md#SP_CTX_02_12), [02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36) InsertDeliveries, [02_04](./context_editor.apply.sp.md#SP_CTX_02_04) (`renamed`), [02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [02_07](./context_editor.apply.sp.md#SP_CTX_02_07), [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (PersonText з рамками доставок, PersonDelivered у PersonWarnings і PersonTagWarnings), [02_10](./context_editor.apply.sp.md#SP_CTX_02_10)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки RecordDelivery, DeliveryKind, InsertDeliveries, HandleCompaction «доставка за службовим викликом», «звіт і розмір з доставками», «файл доставок після застосування», «нечитабельний файл доставок», BuildSeed «доставки в засіві», PersonText «вставлені доставки», PersonWarnings «доставка від людини», PromptMatch «вставлена доставка»; [05_04](./context_editor.edges.sp.md#SP_CTX_05_04) рядки доставок; `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Доставки посеред ходу» в обох хостах (повідомлення людини, фоновий субагент і фонова задача, паралельні виклики) і «Доставка в передачі» у stream-json; «Доставка після `--resume`» — за можливості

| Що | Де |
|----|----|
| QueuedDelivery: розбір, стани читання, межі MAX_DELIVERIES / MAX_DELIVERY_TEXT / MAX_QUEUE_BYTES; DeliveryKind; RecordDelivery за портом (читання, перенос, запис) з перевіркою копії; InsertDeliveries | `mods/context-editor/hooks/deliveries.ts` (новий, чистий); `tests/deliveries.test.ts` (новий) |
| `renamed` з `applyEdits`; речення доставок у FormatReport | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| HandleCompaction: читання файлу, InsertDeliveries до DropOwnCalls, `charsAfter` без вставлених, видалення записів `done` у фоні | `mods/context-editor/hooks/compaction.ts`; `tests/compaction.test.ts` |
| BuildSeed (вхід `deliveries`, вставка з `allRebuilt`), prepareSeed (читання файлу старої сесії); передача файл не переносить | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| PersonText (рамки DELIVERY_FRAMES, `<system-reminder …>` з атрибутами), PersonDelivered у PersonWarnings і PersonTagWarnings; читання файлу в `context_edit` і `context_tag` | `mods/context-editor/hooks/queue.ts`, `hooks/tags.ts`; `tests/queue.test.ts`, `tests/tags.test.ts` |
| PROMPT_DECORATIONS: `<system-reminder` без `>` | `mods/context-editor/hooks/media.ts`; `tests/media.test.ts` |
| Зв'язування: `lastAnchor` і двері `tool-result` / `prompt` / `response` / `delivery` у хуку `session.append`, серійний ланцюжок `deliveries`, файл `deliveries.json` і перенос `.bad-<ms>`, порти для HandleCompaction (`readDeliveries`, `pruneDeliveries`), HandoffIO (`readDeliveries`), TagIO (`deliveries`) і `context_edit` | `mods/context-editor/hooks/register.ts` |
| Живі сценарії: драйвери за зразком `scen1.sh`, `scen2.sh` спайку (термінал і stream-json), передача | `.dev_flow/cache/live-test/` (локально) |
| Навичка plugin-hooks: що покажуть живі сценарії (паралельні виклики з доставкою, `--resume`) | `.dev_flow/skills/claude-code/plugin-hooks.md` |

Стан 2026-10-11: код і модульні тести готові (463 тести після рев'ю 48, було 434; `claude plugin validate` і tsc проходять); живі сценарії 05_03 — далі. Відхилень від таблиці файлів немає, крім спільного файлу фікстур `tests/delivery-fixtures.ts` (тексти доставок для `deliveries.test.ts` і `queue.test.ts`).

Ризики, які перевіряє Verify: (1) припущення, що доставка йде після останнього результату відповіді (KeepResponsesWhole вважає вставлений рядок промптом) — сценарій з паралельними викликами, журнал без `ensureToolResultPairing`; (2) рамки DELIVERY_FRAMES — тексти хоста, що можуть змінитися з версією: тоді клас `other`, доставка все одно вставляється, але повідомлення людини втрачає попередження; (3) у stream-json копії доставок після компактизації — перевірка пари (`text`, `anchor`).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
