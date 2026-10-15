# Редактор контексту агента — Implementation Plan: фаза 3 — Теги

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 3 — Теги [DONE]  {#PL_CTX_P3}

**Depends on:** Phase 1 (виконується перед фазою 2, [PL_CTX_DEC_02](./context_editor.plan.md#PL_CTX_DEC_02))
**Implements:** [SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)–[01_11](./context_editor.structures.sp.md#SP_CTX_01_11), [02_11](./context_editor.tags.sp.md#SP_CTX_02_11)–[02_14](./context_editor.tags.sp.md#SP_CTX_02_14), заміни з тегів у [02_09](./context_editor.edits.sp.md#SP_CTX_02_09), перевірка `pin` у [02_03](./context_editor.edits.sp.md#SP_CTX_02_03) і [02_07](./context_editor.apply.sp.md#SP_CTX_02_07), теги в [02_01](./context_editor.edits.sp.md#SP_CTX_02_01); [C_CTX_03_04](./context_editor.core.concept.md#C_CTX_03_04)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки PrepareEdits «pin», context_tag «помилки», AutoTag, QueueTagReplacements, Nudge «заміни достатньо», RebindTags; [SP_CTX_05_04](./context_editor.edges.sp.md#SP_CTX_05_04) рядки про теги; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Автоматичне чищення з тегів», «Захист початкового завдання»

| Що | Де |
|----|----|
| Tag, TagRegistry, правила R1–R3, валідація запитів | новий `mods/context-editor/hooks/tags.ts` (чиста логіка) |
| context_tag, AutoTag (`session.append`), лічильник ходів, QueueTagReplacements, RebindTags | `tags.ts` через порт; зв'язування в `register.ts` |
| Перевірка `pin` | `edits.ts` (`prepare` приймає множину цілей з `pin`), `compaction.ts` |
| Теги в переліку | `edits.ts` `listRows` |

Pseudocode sketch:
    ON row appended (main loop): stored = next(row); apply R1..R3 to the registry on its serial chain
    ON nudge threshold: freed = QueueTagReplacements(); nudge only if tokens - freed stays above the threshold
    ON compaction: drop edits touching `pin`; after ApplyEdits: RebindTags

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
