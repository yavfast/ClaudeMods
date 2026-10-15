# Редактор контексту агента — Implementation Plan: фаза 41 — Відкривачі замін з джерелом і статусом

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** todo
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 41 — Відкривачі замін з джерелом і статусом [TODO]  {#PL_CTX_P41}

**Depends on:** Phase 39 (тексти пройшли ворота), Phase 40.
**Implements:** [C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06), [C_CTX_DEC_33](./context_editor.curation.concept.md#C_CTX_DEC_33); [SP_CTX_01_27](./context_editor.curation.sp.md#SP_CTX_01_27), [SP_CTX_01_28](./context_editor.curation.sp.md#SP_CTX_01_28), поле `status` у [SP_CTX_01_30](./context_editor.curation.sp.md#SP_CTX_01_30), STATUS_WORDS і MAX_SOURCE з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32), [SP_CTX_02_62](./context_editor.curation.sp.md#SP_CTX_02_62), пункти [SP_CTX_03_03](./context_editor.curation.sp.md#SP_CTX_03_03) і [SP_CTX_03_04](./context_editor.curation.sp.md#SP_CTX_03_04) про статус і відкривачі; [SP_CTX_DEC_40](./context_editor.curation.sp.md#SP_CTX_DEC_40); рядки `summarize`, `collapse` і поле `status` в описах `context_edit` і `context_tag`; речення SKILL.md «It is no loss and nothing you made up» ([SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)).
**Verify:** [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05) рядки ReplacementOpeners (4); [SP_CTX_05_06](./context_editor.curation.sp.md#SP_CTX_05_06) «Заміни цієї версії несуть джерело й статус»; короткий повтор [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) «Тексти замін з походженням і статусом» на коді мода; опис `context_edit` ≤ MAX_DESCRIPTION (`tests/boundary.test.ts` тримає точну довжину); відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| SourceOf, StatusWords, Quoted; голови SUMMARIZED_OF і TAG_SUMMARIZED_OF у REPLACEMENT_OPENERS | `hooks/rows.ts` |
| тексти `run summarize`, `run collapse`, `run rewrite`, `run describe` | `hooks/edits.ts` |
| STATUS_REQUIRED і BAD_STATUS у PrepareEdits і `context_tag` (`disposable` з парою чи діапазоном); `status` у черзі, стара черга без нього читається | `hooks/edits.ts`, `hooks/tags.ts`, `hooks/queue.ts` |
| описи: `,"status"` у рядках `summarize` і `collapse`, подробиці `status` — в описі поля (місце звільнила фаза 40) | `hooks/tools.ts` |
| тести | `tests/rows.test.ts`, `tests/edits.test.ts`, `tests/tags.test.ts`, `tests/queue.test.ts`, `tests/boundary.test.ts` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
