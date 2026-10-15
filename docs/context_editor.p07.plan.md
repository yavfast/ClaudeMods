# Редактор контексту агента — Implementation Plan: фаза 7 — Псевдоніми викликів

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 7 — Псевдоніми викликів [DONE]  {#PL_CTX_P7}

**Depends on:** Phase 3; виконується перед фазою 2 ([PL_CTX_DEC_03](./context_editor.plan.md#PL_CTX_DEC_03))
**Implements:** [SP_CTX_01_13](./context_editor.structures.sp.md#SP_CTX_01_13), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16), [02_17](./context_editor.tags.sp.md#SP_CTX_02_17); `ref` у [01_02](./context_editor.structures.sp.md#SP_CTX_01_02), [02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [02_11](./context_editor.tags.sp.md#SP_CTX_02_11); псевдоніми в [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) і [02_14](./context_editor.tags.sp.md#SP_CTX_02_14); [C_CTX_03_05](./context_editor.core.concept.md#C_CTX_03_05)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки MarkCall, ResolveRef, context_tag «ціль за ref», AliasRegistry «межа», RebindTags (псевдонім); [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Тег за псевдонімом»

| Що | Де |
|----|----|
| AliasRegistry, розбір, MarkCall, ResolveRef, очищення | новий `mods/context-editor/hooks/aliases.ts` (чиста логіка + порт) |
| `ref` у правках | `edits.ts` (`checkShape`), `queue.ts` (розв'язання перед `prepare`) |
| `ref` у тегах | `tags.ts`, схема `context_tag` у `register.ts` |
| Позначка в спільному хуку з нагадуванням, ланцюжок `serial('aliases')` | `register.ts` |
| Псевдоніми в переліку | `edits.ts` `listRows` |

Код і модульні тести є (`tests/aliases.test.ts`). Лишилось: живий сценарій «Тег за псевдонімом» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)); перевірити наживо, що `e.tool_use_id` хука `tool.call` збігається з `tool_use_id` рядків розмови, а рядок `[context-editor] id cN` доходить до моделі після результату.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
