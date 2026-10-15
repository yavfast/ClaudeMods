# Редактор контексту агента — Implementation Plan: фаза 41 — Відкривачі замін з джерелом

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** todo
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 41 — Відкривачі замін з джерелом [TODO]  {#PL_CTX_P41}

**Depends on:** Phase 39 (тексти пройшли ворота), Phase 40.
**Implements:** [C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06), [C_CTX_DEC_33](./context_editor.curation.concept.md#C_CTX_DEC_33), [C_CTX_DEC_40](./context_editor.curation.concept.md#C_CTX_DEC_40); [SP_CTX_01_28](./context_editor.curation.sp.md#SP_CTX_01_28), MAX_SOURCE з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32), [SP_CTX_02_62](./context_editor.curation.sp.md#SP_CTX_02_62), пункти [SP_CTX_03_03](./context_editor.curation.sp.md#SP_CTX_03_03) і [SP_CTX_03_04](./context_editor.curation.sp.md#SP_CTX_03_04) про поле `status` і відкривачі; [SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44) (статусу немає: [SP_CTX_01_27](./context_editor.curation.sp.md#SP_CTX_01_27) вилучено); речення SKILL.md «It is no loss and nothing you made up» ([SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)).
**Verify:** [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05) рядки ReplacementOpeners (3); [SP_CTX_05_06](./context_editor.curation.sp.md#SP_CTX_05_06) «Заміни цієї версії несуть джерело і не несуть статусу»; повтор [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) «Тексти замін з джерелом» на коді мода; опис `context_edit` ≤ MAX_DESCRIPTION (`tests/boundary.test.ts` тримає точну довжину); відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| SourceOf, Quoted; голови SUMMARIZED_OF і TAG_SUMMARIZED_OF у REPLACEMENT_OPENERS | `hooks/rows.ts` |
| тексти `run summarize`, `run collapse`, `run rewrite`, `run describe` | `hooks/edits.ts` |
| тест: поле `status` правки чи тегу ігнорується як зайве, відмов за ним немає (зайві ключі й так не перевіряються; рядок [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05)) | `tests/queue.test.ts`, `tests/tags.test.ts` |
| тести | `tests/rows.test.ts`, `tests/edits.test.ts`, `tests/tags.test.ts`, `tests/queue.test.ts`, `tests/boundary.test.ts` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Після воріт фази 39 статус змісту знято ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44), [C_CTX_DEC_40](./context_editor.curation.concept.md#C_CTX_DEC_40), рішення розробника «Лише джерело, без статусу»): назва фази, Implements і Verify без статусу; StatusWords, STATUS_REQUIRED, BAD_STATUS, поле `status` у черзі й описах інструментів прибрано |
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
