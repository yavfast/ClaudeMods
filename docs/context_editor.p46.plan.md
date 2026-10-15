# Редактор контексту агента — Implementation Plan: фаза 46 — Правила курування і тексти навички

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** todo
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 46 — Правила курування і тексти навички [TODO]  {#PL_CTX_P46}

**Depends on:** Phases 40–45 (правила описують механізми, що вже працюють); ворота thinking фази 39 — `unobserved` стандартними засобами (немає акаунта, створеного від 2026-08-31), тож перед фазою 46 потрібне рішення розробника, чи вмикати правила, що закликають до виправлень посеред історії, без такого прогону (питання поставлено 2026-10-15 при коміті фази 39).
**Implements:** [C_CTX_06_09](./context_editor.curation.concept.md#C_CTX_06_09) (зокрема урок [C_CTX_06_04](./context_editor.curation.concept.md#C_CTX_06_04) і виправлення за зовнішнім сигналом [C_CTX_06_05](./context_editor.curation.concept.md#C_CTX_06_05)), [SP_CTX_DEC_43](./context_editor.curation.sp.md#SP_CTX_DEC_43); [SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69) (файл `curation.md`, `context_list` з `"rules": true`, решта змін текстів), пункт [SP_CTX_03_03](./context_editor.curation.sp.md#SP_CTX_03_03) про `"rules"`, CURATION_MAX з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32).
**Verify:** [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05) рядки CurationTexts (3); [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) «Правила курування» (мод, встановлений поза проєктом); `tests/skill-limits.sh`: SKILL.md ≤ 9000, `curation.md` ≤ CURATION_MAX; описи `context_edit` і `context_tag` ≤ MAX_DESCRIPTION (`tests/boundary.test.ts`); відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| правила курування, форма операції `state`, слід і готові заміни, список рядків хоста й `drop` за `id`, `describe` для медіа і вставок | новий `skills/context-stages/curation.md` |
| `context_list` з `"rules": true`: текст файлу з `$.plugin.root`, помилка читання | `hooks/stages.ts`, схема в `hooks/tools.ts` |
| рядок про правила в SKILL.md і INTRO_TEXT; узгодження всіх текстів 02_69 | `skills/context-stages/SKILL.md`, `hooks/stages.ts`, `hooks/tools.ts` |
| межі файлів | `tests/skill-limits.sh` |
| CLAUDE.md (правила курування в навичці, `"rules"`), навичка `context-editing/history-editing-evidence` (стан кандидатів) | `CLAUDE.md`, `.dev_flow/skills/` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Значень статусів у `curation.md` немає: статус змісту знято після воріт фази 39 ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)) |
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
