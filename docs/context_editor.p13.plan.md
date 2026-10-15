# Редактор контексту агента — Implementation Plan: фаза 13 — Покрокове вибіркове чищення (C_CTX_DEC_04, D)

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 13 — Покрокове вибіркове чищення (C_CTX_DEC_04, D) [DONE]  {#PL_CTX_P13}

**Depends on:** Phase 12; перегляд [C_CTX_DEC_04](./context_editor.methods.concept.md#C_CTX_DEC_04) (2026-10-09)
**Implements:** NudgeText у [SP_CTX_02_09](./context_editor.edits.sp.md#SP_CTX_02_09); порада в описі `context_edit` (обмеження довжини — [SP_CTX_02](./context_editor.sp.md#SP_CTX_02), MAX_DESCRIPTION)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) «context_list, context_edit, context_tag, context_handoff — опис інструмента» (boundary.test.ts) і Nudge «текст просить порцію» (tags.test.ts); `claude plugin test`, `claude plugin validate`, tsc; живий сценарій «Нагадування з початку» в терміналі — не виконано: нагадування за розміром прибирає фаза 14 ([C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15)); живе чищення за D у VS Code 2026-10-09 (два нагадування, стиснуто лише опрацьоване) — єдине спостереження

| Що | Де |
|----|----|
| Текст нагадування: наступна порція опрацьованого, не вся розмова; без змін — повідомлення людини, правила й навички, робоча частина | `mods/context-editor/hooks/tags.ts` (`nudgeText`); `tests/tags.test.ts` |
| Порада в описі `context_edit` замість «one large collapse» | `mods/context-editor/hooks/register.ts` (`EDIT_DESCRIPTION`) |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
