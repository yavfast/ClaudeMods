# Редактор контексту агента — Implementation Plan: фаза 8 — Поточна розмова, опис context_edit, архів без дубля медіа

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 8 — Поточна розмова, опис context_edit, архів без дубля медіа [DONE]  {#PL_CTX_P8}

**Depends on:** Phase 2 (знахідки її живих сценаріїв)
**Implements:** [SP_CTX_01_14](./context_editor.structures.sp.md#SP_CTX_01_14), [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18), [SP_CTX_DEC_07](./context_editor.sp.md#SP_CTX_DEC_07), запис межі в [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), архів [01_06](./context_editor.structures.sp.md#SP_CTX_01_06), MAX_DESCRIPTION ([01_12](./context_editor.structures.sp.md#SP_CTX_01_12))
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки CurrentRows, RecordBoundary, «архів без дубля медіа», «опис інструмента»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Перегляд після компактизації»; регрес — «Скриншот у результаті інструменту»

- `edits.ts`: `boundaryOf`, `currentRows` (чисті); `compaction.ts`: `archiveText` і запис межі через порт `CompactionIO.writeBoundary`;
- `register.ts`: одне читання поточної розмови для `context_list`, `context_edit`, тегів, закріплень і лічильника `review`; хук запису межі для компактизацій не редактора; коротший опис `context_edit`, експорт описів для тесту.
- рев'ю раунд 4: правки й теги за індексом з переліку, зробленого до зміни межі, відхиляються; межа іншого процесу не довіряється; предикат спостерігача — чиста `observedBoundary`; архів замінює лише рядки в алфавіті base64.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
