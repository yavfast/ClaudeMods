# Редактор контексту агента — Implementation Plan: фаза 44 — Пункти слота стану

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-17
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 44 — Пункти слота стану [DONE]  {#PL_CTX_P44}

**Depends on:** Phase 41 (тексти замін і список REPLACEMENT_OPENERS, у який ця фаза додає свою голову).
**Implements:** [C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08) (пункти слота), [SP_CTX_DEC_41](./context_editor.curation.sp.md#SP_CTX_DEC_41); [SP_CTX_01_29](./context_editor.curation.slot.sp.md#SP_CTX_01_29), операція `state` у [SP_CTX_01_30](./context_editor.curation.edits.sp.md#SP_CTX_01_30), [SP_CTX_02_67](./context_editor.curation.slot.sp.md#SP_CTX_02_67), MAX_STATE_ITEMS, MAX_STATE_ITEM і голова STATE_REBUILT з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32), пункти [SP_CTX_03_03](./context_editor.curation.sp.md#SP_CTX_03_03) і [SP_CTX_03_04](./context_editor.curation.sp.md#SP_CTX_03_04) про `state`, [SP_CTX_04_08](./context_editor.curation.slot.sp.md#SP_CTX_04_08); тексти STATE_SLOT, легенди, TAG_DESCRIPTION і рядок операції `state` в EDIT_DESCRIPTION ([SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69)).
**Verify:** [SP_CTX_05_05](./context_editor.curation.verification.sp.md#SP_CTX_05_05) рядки StateEdit (5); [SP_CTX_05_06](./context_editor.curation.verification.sp.md#SP_CTX_05_06) «Слот стану дорівнює зібраним пунктам»; [SP_CTX_05_08](./context_editor.curation.verification.sp.md#SP_CTX_05_08) «Слот без пунктів і правка `state`», «Два `state` в одному пакеті», «`id` зник до застосування», «Реєстр не записався»; опис `context_edit` ≤ MAX_DESCRIPTION (`tests/boundary.test.ts` тримає точну довжину); відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| чиста логіка пунктів: зміни add / set / mark / unmark / remove, Assemble, коди NO_STATE_SLOT, NO_ITEM, BAD_CHANGE, TOO_MANY_ITEMS, SLOT_TOO_LONG, STATE_CONFLICT, STATE_GONE, NO_ITEM_NOW, ITEMS_UNSAVED | новий `hooks/state.ts` |
| `state` у PrepareEdits і в застосуванні (одна перебудова на пакет), винятки STATE_SLOT і ScreenPinned | `hooks/edits.ts`, `hooks/compaction.ts` |
| `items` і `nextItem` у реєстрі, RebindTags, запис після фіксації | `hooks/tags.ts` |
| голова STATE_REBUILT — у REPLACEMENT_OPENERS | `hooks/rows.ts` |
| CLAUDE.md: модуль `hooks/state.ts` у переліку портів | `CLAUDE.md` |
| тексти | `hooks/tools.ts`, `hooks/edits.ts`, `hooks/stages.ts` |
| тести | новий `tests/state.test.ts`, `tests/edits.test.ts`, `tests/compaction.test.ts`, `tests/rows.test.ts`, `tests/boundary.test.ts` |

**Result (2026-10-16):** `hooks/state.ts` (CheckChanges, DraftChanges, ApplyChanges, Assemble, перевірки реєстру); у `edits.ts` — операція `state` у checkShape, PrepareEdits (prepareState, STATE_ITEMS, STATE_CONFLICT із чергою `pending.json`), stampState (ціль ставить і ScreenPinned при застосуванні), runState (одна перебудова на пакет, STATE_GONE, NO_ITEM_NOW); фіксація пише `items`/`nextItem`, ITEMS_UNSAVED у звіті; RebindTags веде тег `state` за перебудованим рядком; засів «транскриптом» несе пункти в копію реєстру. Тексти: рядок операції в EDIT_DESCRIPTION (2037 з 2048), схема `changes`, TAG_DESCRIPTION, STATE_SLOT, легенда, відмова BAD_TARGET, розділ State slot у SKILL.md (поза таблицею плану: інакше SKILL.md казав би «лише rewrite»). Тести: `tests/state.test.ts` (15) і зміни в `boundary`, `rows`.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-16 | Фазу виконано (див. Result) |
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
