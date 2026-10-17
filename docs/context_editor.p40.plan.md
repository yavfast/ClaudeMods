# Редактор контексту агента — Implementation Plan: фаза 40 — Слова людини, піни і `describe` вставок

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-17
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 40 — Слова людини, піни і `describe` вставок [DONE]  {#PL_CTX_P40}

**Depends on:** Phase 39 (гілка обгортки вставок); пункт backlog «Розділити великі файли специфікації SP_CTX» — до першої фази коду курування, бо вона оновлює контракти в тих файлах (виконано 2026-10-15).
**Implements:** [C_CTX_DEC_34](./context_editor.curation.concept.md#C_CTX_DEC_34), [C_CTX_DEC_36](./context_editor.curation.concept.md#C_CTX_DEC_36) (пін документа), [C_CTX_DEC_38](./context_editor.curation.concept.md#C_CTX_DEC_38), [C_CTX_DEC_39](./context_editor.curation.concept.md#C_CTX_DEC_39); [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58), [SP_CTX_02_59](./context_editor.curation.edits.sp.md#SP_CTX_02_59), [SP_CTX_02_68](./context_editor.curation.edits.sp.md#SP_CTX_02_68); SKILL_FRAME, PEER_FRAME і DESCRIBED_HEAD з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32); тексти [SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69) про слова людини й піни; пункти [SP_CTX_03_03](./context_editor.curation.sp.md#SP_CTX_03_03) і [SP_CTX_03_04](./context_editor.curation.sp.md#SP_CTX_03_04) про слова людини, рамку хоста й `describe`.
**Verify:** [SP_CTX_05_05](./context_editor.curation.verification.sp.md#SP_CTX_05_05) рядки PersonWords (8), DescribePasted (3), Pins (2); [SP_CTX_05_06](./context_editor.curation.verification.sp.md#SP_CTX_05_06) «Жодне застосування не змінює набраного людиною тексту», «Рядок хоста не рахується словами людини»; [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07) «Слова людини», «Пін документа»; [SP_CTX_05_08](./context_editor.curation.verification.sp.md#SP_CTX_05_08) «Людина вставила текст, що починається з рамки хоста», «Промпт лише з вставки», «Описаний промпт плагіна», «Промпт лише з медіа», «Пін першого промпту зі старої сесії»; опис `context_edit` ≤ MAX_DESCRIPTION (`tests/boundary.test.ts` тримає точну довжину); відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| рамки хоста HostFrame (розгорнута навичка, звіт субагента); голова DESCRIBED_HEAD — у REPLACEMENT_OPENERS, щоб ReplacementText, позначка `*` і R5 бачили нові заміни `describe` | `hooks/rows.ts` (правило STRUCT-01) |
| PersonText з HostFrame; PersonRow через DescribedText; відмови PERSON_WORDS і PERSON_TAG при постановці замість попередження; рядок результату виклику для QueueTagReplacements | `hooks/deliveries.ts`, `hooks/queue.ts`, `hooks/tags.ts` |
| ScreenPerson при застосуванні за рядками розмови й доставками, відмова PERSON_WORDS_NOW | `hooks/compaction.ts` |
| DescribePasted за гілкою з фази 39: заміна блоків `<pasted_content>` описом, заступник у тексті людини, оригінал в архіві | `hooks/edits.ts`, `hooks/media.ts` (якщо вставка лише у формі API) |
| R1 прибрано (`firstPromptPinned` лишається для PinSummary); PinDocument на кроці 2 кінця ходу з `docChecked` | `hooks/tags.ts`, `hooks/flush.ts` (AfterTurn), `hooks/handoff.ts` (DocumentRow) |
| тексти про слова людини й піни: SKILL.md, INTRO_TEXT, STAGE_ADVICE, TAG_DESCRIPTION, останній абзац EDIT_DESCRIPTION; місце в EDIT_DESCRIPTION для фаз 40–45: абзац про `ref` — в опис поля REF, текст відновлення за замовчуванням — в опис `resume_prompt` | `skills/context-stages/SKILL.md`, `hooks/stages.ts`, `hooks/tools.ts` |
| тести | `tests/rows.test.ts` (ReplacementText), `tests/queue.test.ts`, `tests/deliveries.test.ts`, `tests/compaction.test.ts`, `tests/tags.test.ts`, `tests/edits.test.ts`, `tests/flush.test.ts`, `tests/boundary.test.ts` (довжина опису) |

**Результат (2026-10-15).** Правку чи тег `disposable` над словами людини мод відхиляє при постановці (PERSON_WORDS, PERSON_TAG), а при застосуванні й засіві знову перевіряє за рядками і файлом доставок (PERSON_WORDS_NOW); тег, чия ціль тепер захоплює слова людини, QueueTagReplacements прибирає з рядком у результаті. Текст навички й звіт субагента (SKILL_FRAME, PEER_FRAME) не рахуються словами людини; описаний промпт рахується (DescribedText). R1 прибрано; PinDocument пінить рядок документа на першому кінці ходу (`docChecked`). `describe` замінює блоки `<pasted_content>` позначками, а опис лише вставки не застосовується, коли медіа промпту застосуванню невидиме. EDIT_DESCRIPTION — 1888 з 2048 (місце для фаз 41–45). Модульні тести: 895 зелені. Рев'ю: «pass with fixes» (must: `describe` вставки поряд із незаархівованим медіа — тепер відмова `media could not be archived`), вузьке повторне рев'ю — «pass with fixes» (коментар у 02_68); модульні тести — 904 зелені. Живий прогін ([SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07), stream-json, haiku; артефакти — `.dev_flow/cache/live-test/curation-p40/`): «Слова людини» пройдено; «Пін документа» спершу не пройшов — хост пише рядки `/clear` перед документом, — PinDocument тепер шукає документ серед рядків до першої відповіді, повтор пройдено. Термінал не прогнано. Помічену ваду тексту STALE_INDEXES без жодного `context_list` записано в backlog.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Фазу виконано: код, тести, тексти; результат вище |
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
