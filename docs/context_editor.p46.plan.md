# Редактор контексту агента — Implementation Plan: фаза 46 — Правила курування і тексти навички

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-16
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 46 — Правила курування і тексти навички [DONE]  {#PL_CTX_P46}

**Depends on:** Phases 40–45 (правила описують механізми, що вже працюють); ворота thinking фази 39 — `unobserved` стандартними засобами (немає акаунта, створеного від 2026-08-31), тож перед фазою 46 потрібне рішення розробника, чи вмикати правила, що закликають до виправлень посеред історії, без такого прогону (питання поставлено 2026-10-15 при коміті фази 39).
**Implements:** [C_CTX_06_09](./context_editor.curation.concept.md#C_CTX_06_09) (зокрема урок [C_CTX_06_04](./context_editor.curation.concept.md#C_CTX_06_04) і виправлення за зовнішнім сигналом [C_CTX_06_05](./context_editor.curation.concept.md#C_CTX_06_05)), [SP_CTX_DEC_43](./context_editor.curation.sp.md#SP_CTX_DEC_43); [SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69) (файл `curation.md`, `context_list` з `"rules": true`, решта змін текстів), пункт [SP_CTX_03_03](./context_editor.curation.sp.md#SP_CTX_03_03) про `"rules"`, CURATION_MAX з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32).
**Verify:** [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05) рядки CurationTexts (4); [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) «Правила курування» (мод, встановлений поза проєктом); `tests/skill-limits.sh`: SKILL.md ≤ 9000, `curation.md` ≤ CURATION_MAX; описи `context_edit` і `context_tag` ≤ MAX_DESCRIPTION (`tests/boundary.test.ts`); відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| правила курування, форма операції `state`, слід і готові заміни, список рядків хоста й `drop` за `id`, `describe` для медіа і вставок | новий `skills/context-stages/curation.md` |
| `context_list` з `"rules": true`: текст файлу з `$.plugin.root`, помилка читання | `hooks/stages.ts`, схема в `hooks/tools.ts` |
| рядок про правила в SKILL.md і INTRO_TEXT; узгодження всіх текстів 02_69 | `skills/context-stages/SKILL.md`, `hooks/stages.ts`, `hooks/tools.ts` |
| межі файлів | `tests/skill-limits.sh` |
| CLAUDE.md (правила курування в навичці, `"rules"`), навичка `context-editing/history-editing-evidence` (стан кандидатів) | `CLAUDE.md`, `.dev_flow/skills/` |

**Result:** рішення розробника перед фазою (2026-10-16, AskUserQuestion): «Вмикати, пакетом» — правила виправлень посередині історії увімкнено без прогону на акаунті, створеному від 2026-08-31; `curation.md` велить ставити їх пакетом на межі етапу й називає ризик thinking-блоків. Новий `skills/context-stages/curation.md` (5213 з 6000 символів); `context_list` з `"rules": true` (CurationRules у `hooks/stages.ts`, ListIO.rules у `register.ts`; BAD_RULES для інших параметрів і не `true`); рядки про правила в SKILL.md (8987 з 9000), INTRO_TEXT (997 з 1000, вступ стиснуто) і описі `context_list`; урок у STAGE_ADVICE; `tests/skill-limits.sh` перевіряє `curation.md`. Решту змін текстів 02_69 зробили фази 40–45. Живий прогін «Правила курування» (хост 2.1.296, мод поза текою сесії, без пропуску дозволів, haiku і sonnet): текст правил без запиту дозволу 2/2; урок «×N → причина → наслідок» у заміні серії невдалих спроб 2/2 (правила відкрито на прохання, тож самостійне відкриття не виміряно), `.dev_flow/cache/live-test/curation-p46/results.md`. За рев'ю: `curation.md` каже, що текст правил зникає при застосуванні, що перша `state` замінює вільний текст слота, що `drop` рядка хоста відмовляє при медіа, і точніше про thinking-блоки.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-16 | Фазу виконано (див. Result) |
| 2026-10-15 | Значень статусів у `curation.md` немає: статус змісту знято після воріт фази 39 ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)) |
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
