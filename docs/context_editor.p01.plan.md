# Редактор контексту агента — Implementation Plan: фаза 1 — Основний функціонал

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 1 — Основний функціонал [DONE]  {#PL_CTX_P1}

**Depends on:** none
**Implements:** [SP_CTX_01_01](./context_editor.structures.sp.md#SP_CTX_01_01)–[01_07](./context_editor.structures.sp.md#SP_CTX_01_07), [01_12](./context_editor.constants.sp.md#SP_CTX_01_12); [02_01](./context_editor.edits.sp.md#SP_CTX_02_01)–[02_08](./context_editor.flush.sp.md#SP_CTX_02_08); [02_09](./context_editor.edits.sp.md#SP_CTX_02_09) без замін з тегів; [02_15](./context_editor.tags.sp.md#SP_CTX_02_15)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки ApplyEdits (крім describe), PrepareEdits, DropOwnCalls, context_list, context_edit, HandleCompaction, DeliverReport, TriggerCompaction; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Стиснення в межах сесії», «Три операції», «Нагадування з початку» — pass 2026-10-08 після раунду 3

| Що | Де |
|----|----|
| Правки, перегляд, DropOwnCalls, FreshId | `mods/context-editor/hooks/edits.ts` |
| Черга, context_edit, доставка звіту | `mods/context-editor/hooks/queue.ts` |
| Обробник компактизації | `mods/context-editor/hooks/compaction.ts` |
| Хуки, сховище, нагадування | `mods/context-editor/hooks/register.ts` |
| Тригер | `mods/context-editor-trigger/hooks/{flush,register}.ts` |

Рев'ю: раунди 1–3 виправлено; раунд 4 зупинено на вимогу розробника перед живою перевіркою.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
