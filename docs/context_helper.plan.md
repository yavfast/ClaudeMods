# Implementation Plan: Помічник мода  {#PL_HELP}

> **Code:** PL_HELP
> **Status:** active
> **Created:** 2026-11-16
> **Updated:** 2026-11-16
>
> **Concept:** [C_HELP](./context_helper.concept.md)
> **Specification:** [SP_HELP](./context_helper.sp.md) (парасолька й дочірні [ask](./context_helper.ask.sp.md), [errands](./context_helper.errands.sp.md), [batches](./context_helper.batches.sp.md))
> **Depends on:** [PL_CTX](./context_editor.plan.md) — фази 1–48 мода context-editor виконано; [PL_FOLD](./context_folds.plan.md) — згортки, розгортання й повернення згаданого виконано; цей план додає механізми в той самий мод
> **Used by:** —
>
> План реалізації помічника в моді `mods/context-editor`: питання агента до архіву згорток з перевіреними цитатами, годинник кешу, відкладені пакети правок з застосуванням у простої й у новому процесі, доручення з умовою з доставкою в безпечний момент і пробудження за проханням агента.

## Goal

Звільнити основний контекст агента від роботи, яку може зробити помічник мода чи правило мода (намір задачі `task_20261116_141010_helper-concept`): агент питає про вміст своєї згортки й отримує висновок помічника з дослівними цитатами, перевіреними за архівом, замість розгортання цілого рівня; ставить доручення з умовою на стан контексту, яке мод виконує сам; позначає пакет правок відкладеним, і мод застосовує його лише тоді, коли той не додає власного переписування кешу промпту. Коли план виконано, три механізми працюють у моді, що запускається як керований плагін, у терміналі й у потоковому хості, а живі сценарії [SP_HELP_05_03](./context_helper.sp.md#SP_HELP_05_03) пройдено або записано як `unobserved` з причиною.

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Мова й середовище | TypeScript, function hooks хоста Claude Code 2.1.325, як увесь мод | стандарт проєкту (`CLAUDE.md`) |
| Розкладка коду | шаблон портів: нові чисті модулі `hooks/helper.ts`, `hooks/ask.ts`, `hooks/cacheclock.ts`, `hooks/batches.ts`, `hooks/idle.ts`, `hooks/errands.ts`; наявні модулі змінюються лише в точках, які називає [SP_HELP_03_03](./context_helper.sp.md#SP_HELP_03_03); `hooks/register.ts` лише зв'язує з `$` | правило STRUCT-02, `CLAUDE.md` «Ports pattern»; [DEC_02](#PL_HELP_DEC_02) |
| Виклик помічника | `$.model.complete({ model: 'sonnet', system: HELP_SYSTEM, prompt: [питання, частина], maxTokens, timeoutMs })` через порт `HelperIO.complete`; частини одного питання — `Promise.all`; без позначок кешу в блоках промпту | плагін-хуки 88 (формат і ціна `complete` на sonnet); стандарт «sonnet для власних викликів моделі»; повтор рідкісний, а запис кешу дорожчий за читання |
| Крок основного ходу | хук `turn.step` як генератор `async function*`, що пропускає потік (`const r = yield* next(e); …; return r`), лише без `agentId`; пише `lastRequestAt` у пам'ять модуля, а на першому кроці з `check` читає `r.usage` | типи хоста 2.1.325 (`TurnStepInput`, `TurnStepResult`); плагін-хуки 79 |
| Сховище | нового Store немає: `errands`, `nextErrand`, `cache` — у реєстрі `tags.json` (ранг 2), `questions` — в обліку `folds.json` (ранг 4), поля відкладених пакетів — у черзі `pending.json` (ранг 1); ланцюжки беруться один за одним, не вкладено | [SP_HELP_DEC_05](./context_helper.sp.md#SP_HELP_DEC_05); `serialChains` і CHAIN_RANK у `hooks/store.ts` |
| Читання архіву для питання | `levelOf` з `hooks/folds.ts` (архів через `$.process.run(['cat', …])`) і нова функція фрагментів над тими самими рядками архіву, без обрізання MAX_RECALL_ROW | [SP_HELP_01_02](./context_helper.ask.sp.md#SP_HELP_01_02); межа 4 MiB у `$.fs.read` |
| Нормалізація цитат | `String.prototype.normalize('NFC')` і заміна кожної послідовності пробільних символів (зокрема ` `) одним пробілом | вбудовано в ES2022, без Node API |
| Таймери й команди | `$.clock.after` лише з ланцюжка `turn.complete` (таймер простою, повторна перевірка пробудження) і з `session.start` (StartRun); команда — `$.command.run('compact', MARKER)`, одна спроба, як у Flush | плагін-хуки 89, 91, 92; [SP_HELP_DEC_09](./context_helper.sp.md#SP_HELP_DEC_09) |
| Відкриття агенту | кожна фаза відкриває агенту лише те, що вже працює: фаза 1 — операцію `ask`, фаза 4 — поле `defer` (його тексти ще без простою), фаза 5 — речення про простій у текстах `defer` і рядок-покажчик `defer` в HELPER_DESCRIPTION, фаза 7 — операції доручень, фаза 8 — поле `wake` | мод на цій машині — керований плагін, кожна нова сесія завантажує робоче дерево; [DEC_03](#PL_HELP_DEC_03) |
| Тексти для агента | подробиці — в HELPER_DESCRIPTION (≤ MAX_DESCRIPTION) і в описі властивості `defer` схеми `context_edit`; EDIT_DESCRIPTION не змінюється (за вимірюванням рецензії плану — 2043 з 2048 символів); навичка `skills/context-stages/SKILL.md` не змінюється: `tests/skill-limits.sh` дає 8994 з 9000 символів (беклог) | `tests/boundary.test.ts`, `tests/skill-limits.sh`; практика PL_FOLD (тексти для агента оновлює фаза, що вводить механізм) |
| Тести | `claude plugin test mods/context-editor`: нові `tests/helper.test.ts`, `tests/ask.test.ts`, `tests/cacheclock.test.ts`, `tests/batches.test.ts`, `tests/idle.test.ts`, `tests/errands.test.ts`; доповнення `compaction`, `flush`, `queue`, `handoff`, `folds`, `notes`, `boundary` | практика мода; колонка Test специфікації (`keep` — постійний тест) |
| Живі прогони | термінал під GNU screen і потоковий хост (`-p --input-format stream-json --output-format stream-json --verbose`), керований мод цієї машини; драйвери — `.dev_flow/cache/live-test/dec10-probe/`; сценарії з простоєм понад годину (L3, L4, L8) — одним прогоном у фазі 9 | `CLAUDE.md` «Live testing»; [DEC_04](#PL_HELP_DEC_04) |

## Required Knowledge

| Kind | Ref | Applies to | Note |
|------|-----|-----------|------|
| rule | CONC-01, CONC-02 | Фази 1–8 | тека сховища раз на операцію; фіксація черги, реєстру й обліку — після останньої перевірки переривання; фонове питання доручення пише результат окремою операцією |
| rule | STRUCT-01 | Фази 1, 4, 7, 8 | ASKED_HEAD, ASK_RETURNED_HEAD (у REPLACEMENT_OPENERS), WAKE_TEXT і рядок доручення — один дім у `hooks/rows.ts` |
| rule | STRUCT-02 | усі фази з кодом | рішення (SelectEdits, CheckErrands, IdleRun, StartRun, WakeCheck) — у чистих модулях з тестом, не в `register.ts` |
| rule | STRUCT-03 | Фаза 1 | шлях архіву згортки — із запису згортки й `projectRoot($)`, ніколи з `$.session.cwd()` |
| rule | STRUCT-04 | Фази 1, 2, 4, 7 | засів передачі: `questions: []` (1), поле `cache` не переноситься — `carryRegistries` копіює весь реєстр (2), усі правки черги з відкладеними (4), перенесені `errands`, `nextErrand` (7) — у тій самій зміні з тестом |
| rule | ERR-01 | Фази 1, 5, 6, 7, 8 | проковтнутий збій фонової роботи (виклик помічника, таймер простою, StartRun, пробудження) лишає один рядок журналу налагодження з міткою й помилкою, без вмісту |
| rule | PROC-01 | усі фази | час у файлах задач — з годинника чи git |
| skill (apply) | claude-code/plugin-hooks (+ тематичні файли) | усі фази з кодом | пункти 25 (власні промпти плагіна не проходять його `prompt.submit`), 79 (`turn.step`), 84, 88 (`$.model.fork`, `$.model.complete`), 89, 91, 92 (команди з таймера простою, після переривання, з `session.start`) перевірено на 2.1.325; решту перед опорою звірити живим прогоном |
| skill (apply) | context-editing/HelperEvidence | Фази 1, 7 | ціна й затримка `complete`, перевірка цитат підрядком, ризики вижимок |
| skill (apply) | context-editing/SupervisorEvidence | Фази 7, 8 | безпечний момент доставки; самопозначений прихований контекст |
| skill (apply) | context-editing/HistoryEditingEvidence | Фаза 1 | авторство: висновок помічника — третій автор, зовнішній зміст |
| skill (update) | claude-code/plugin-hooks | Фази 1, 2, 9 | факти живих прогонів: `$.model.complete` з хука `tool.call`, зокрема переривання Esc (`aborted`) — фаза 1; хук-генератор `turn.step`, що лише пропускає потік, у терміналі й stream-json на opus і sonnet — фаза 2; застосування з таймера простою й з `session.start` у моді, а не в зонді — фаза 9 |
| skill (update) | context-editing/HelperEvidence | Фаза 9 | виміряні в живих прогонах ціна й час питань, частка перевірених цитат |

## Progress

- [x] [Phase 1 — Помічник і питання до архіву](#PL_HELP_P1)
- [x] [Phase 2 — Годинник кешу](#PL_HELP_P2)
- [x] [Phase 3 — Відкладені пакети в обробнику й черзі](#PL_HELP_P3)
- [x] [Phase 4 — Поле `defer` і видимі відкладені пакети](#PL_HELP_P4)
- [x] [Phase 5 — Простій](#PL_HELP_P5)
- [x] [Phase 6 — Новий процес](#PL_HELP_P6)
- [x] [Phase 7 — Доручення з умовою й доставка](#PL_HELP_P7)
- [ ] [Phase 8 — Пробудження](#PL_HELP_P8)
- [ ] [Phase 9 — Живий прогін і передача знань](#PL_HELP_P9)

## Phases

Кожна фаза з кодом проходить повний цикл: тести, рев'ю з чистим контекстом, живий прогін з коротким сценарієм фази, коміт. Мод на цій машині — керований плагін, і кожна нова сесія завантажує робоче дерево, тож фаза лишає мод робочим і відкриває агенту лише те, що вже працює ([DEC_03](#PL_HELP_DEC_03)). Поле **Змінює** називає розділи SP_CTX, SP_FOLD, C_CTX і C_FOLD з таблиць [SP_HELP_03_03](./context_helper.sp.md#SP_HELP_03_03) і [C_HELP_04_01](./context_helper.concept.md#C_HELP_04_01), які фаза оновлює разом з кодом. Перевірки входів [SP_HELP_03_01](./context_helper.sp.md#SP_HELP_03_01) та інваріанти [SP_HELP_03_02](./context_helper.sp.md#SP_HELP_03_02) реалізує фаза, що вводить відповідний контракт; константи [SP_HELP_01_09](./context_helper.sp.md#SP_HELP_01_09) — фаза, що їх уперше використовує.

### Phase 1 — Помічник і питання до архіву (`hooks/helper.ts`, `hooks/ask.ts`) [DONE]  {#PL_HELP_P1}

**Depends on:** none
**Implements:** [SP_HELP_01_01](./context_helper.ask.sp.md#SP_HELP_01_01), [SP_HELP_01_02](./context_helper.ask.sp.md#SP_HELP_01_02), [SP_HELP_01_03](./context_helper.ask.sp.md#SP_HELP_01_03), [SP_HELP_01_04](./context_helper.ask.sp.md#SP_HELP_01_04), [SP_HELP_02_01](./context_helper.ask.sp.md#SP_HELP_02_01), [SP_HELP_02_02](./context_helper.ask.sp.md#SP_HELP_02_02) (лише операція `ask`), [SP_HELP_02_03](./context_helper.ask.sp.md#SP_HELP_02_03), [SP_HELP_02_04](./context_helper.ask.sp.md#SP_HELP_02_04), [SP_HELP_02_05](./context_helper.ask.sp.md#SP_HELP_02_05), [SP_HELP_04_03](./context_helper.sp.md#SP_HELP_04_03); запис журналу `ask` з [SP_HELP_01_08](./context_helper.sp.md#SP_HELP_01_08) (без поля `errand`); рядок «Помічник» з [SP_HELP_02_13](./context_helper.sp.md#SP_HELP_02_13); рядок «Записи питань» з [SP_HELP_02_14](./context_helper.sp.md#SP_HELP_02_14); рядки `context_helper`, `op`, `folds`, `question`, матеріал і обхід з [SP_HELP_03_01](./context_helper.sp.md#SP_HELP_03_01); інваріанти I1–I3; константи HELP_*, MAX_QUOTE, MAX_QUOTES, MAX_QUESTION, MAX_ASK_FOLDS, MAX_ASK_RESULT, MAX_QUESTIONS, QUESTION_HEAD, ASKED_HEAD, ASK_RETURNED_HEAD, HELP_SYSTEM, HELP_RETRY_TEXT
**Змінює:** [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (ASK_RETURNED_HEAD, сьомий інструмент), [SP_CTX_01_19](./context_editor.records.sp.md#SP_CTX_01_19) і [SP_CTX_02_31](./context_editor.telemetry.sp.md#SP_CTX_02_31) (запис `ask`), [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28) (рядок Helper), [SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53) і [SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54) (`ask` відхиляється), [SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57) (у ProbeMode інструмента немає), [SP_FOLD_01_02](./context_folds.sp.md#SP_FOLD_01_02), [SP_FOLD_02_03](./context_folds.sp.md#SP_FOLD_02_03), [SP_FOLD_02_08](./context_folds.sp.md#SP_FOLD_02_08), [SP_FOLD_02_09](./context_folds.sp.md#SP_FOLD_02_09), [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04) і [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07) (слід ASK_RETURNED, параметр `questions`, речення `Returned <n> question pair(s).`); правила [C_CTX_06_07](./context_editor.curation.concept.md#C_CTX_06_07), [C_CTX_DEC_08](./context_editor.core.concept.md#C_CTX_DEC_08), [C_FOLD_DEC_08](./context_folds.concept.md#C_FOLD_DEC_08), [C_FOLD_03_05](./context_folds.concept.md#C_FOLD_03_05)
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядки ParseReply (обидва), HelperCall (обидва), Split, Ask (усі чотири), VerifyQuotes (усі три), «Повернення пар» (обидва), «Телеметрія» в частині помічника; [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I1, I2 (питання агента), I3; [SP_HELP_05_04](./context_helper.sp.md#SP_HELP_05_04) «Згортку повернув архів іншої сесії», «Архів змінився після згортки»; сценарій L1 з [SP_HELP_05_03](./context_helper.sp.md#SP_HELP_05_03) у терміналі й stream-json — плюс: HELPER_DESCRIPTION ≤ MAX_DESCRIPTION; `tests/skill-limits.sh` проходить; передача способом «транскрипт» із записом питання дає `questions: []` і засів без пари питання

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| HelperReply, ParseReply, HelperCall, порт `HelperIO` | `hooks/helper.ts` | один виклик помічника з повтором формату |
| Part, Split, Fragment, правило походження, Normalize, VerifyQuotes, AskText, Ask, порт `AskIO` | `hooks/ask.ts` | питання до рівнів згорток; походження — через `personText` (`hooks/deliveries.ts`), `sourceOf` (`hooks/edits.ts`), `modText` і `isReplacementText` (`hooks/rows.ts`) |
| Question, поле `questions`, розбір, `markDue` і `addReturns` для питань, `pruneRecalls` для питань, `questions: []` у `carryFolds` | `hooks/folds.ts`, `hooks/handoff.ts` | облік і повернення пар питань тим самим механізмом, що згадане |
| Слід ASK_RETURNED, речення звіту `Returned <n> question pair(s).`, пари `context_helper` у `ownPairs` | `hooks/edits.ts`, `hooks/compaction.ts` | застосування повертає пари питань і лишає їх до повернення |
| ASKED_HEAD, ASK_RETURNED_HEAD у REPLACEMENT_OPENERS | `hooks/rows.ts` | STRUCT-01 |
| Інструмент `context_helper` (схема з `op: 'ask'`), HELPER_DESCRIPTION без доручень і `defer` | `hooks/tools.ts` | відкриття лише працюючої операції |
| Хук `tool.call` для `context_helper` з `.catch`, прив'язка `$.model.complete`, запис журналу `ask` | `hooks/register.ts`, `hooks/journal.ts` | зв'язування з `$` |
| Рядок `Helper:` заголовка | `hooks/stages.ts` | сума записів журналу `ask` |

Notes:
- Частини питання викликаються одночасно; облік і архіви читаються один раз поза ланцюжками, запис Question — на ланцюжку обліку з повторною перевіркою QUESTIONS_FULL ([SP_HELP_02_03](./context_helper.ask.sp.md#SP_HELP_02_03)).
- Цитата шукається лише в одному фрагменті; спершу фрагменти рядка, який назвав помічник, потім усі по порядку.

Pseudocode sketch:

    ON tool.call context_helper (main loop):
        IF subagent: DENY DENIED_SUBAGENT
        IF op ≠ 'ask' OR foreign fields: DENY BAD_OP
        text = Ask(folds, question, scope, depth)       // ask.ts: checks, Split, HelperCall ×parts, VerifyQuotes, AskText
        RETURN text

### Phase 2 — Годинник кешу (`hooks/cacheclock.ts`) [DONE]  {#PL_HELP_P2}

**Depends on:** none (порядок після фази 1 — [DEC_01](#PL_HELP_DEC_01))
**Implements:** [SP_HELP_01_07](./context_helper.batches.sp.md#SP_HELP_01_07), [SP_HELP_02_09](./context_helper.batches.sp.md#SP_HELP_02_09), [SP_HELP_04_04](./context_helper.sp.md#SP_HELP_04_04); запис журналу `cache` з [SP_HELP_01_08](./context_helper.sp.md#SP_HELP_01_08); рядки «Годинник кешу» й «Перевірки годинника» з [SP_HELP_02_13](./context_helper.sp.md#SP_HELP_02_13); рядок «Годинник кешу» з [SP_HELP_02_14](./context_helper.sp.md#SP_HELP_02_14); інваріанти I8, I9; константи CACHE_TTL_MS, COLD_MISMATCH. Вердикт «холодний» у цій фазі лише записує `coldAt` і `check`: доручення з умовою `cold` перевіряє фаза 7
**Змінює:** [SP_CTX §02](./context_editor.sp.md#SP_CTX_02) (преамбула: запис `cache.lastRequestAt` у кінці кожного основного ходу; підписка на крок ходу), [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (поле `cache`), [SP_CTX_01_19](./context_editor.records.sp.md#SP_CTX_01_19) і [SP_CTX_02_31](./context_editor.telemetry.sp.md#SP_CTX_02_31) (запис `cache`), [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08) (DeliverReport бере вердикт «холодний»), [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12), [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) (форк документа оновлює `lastRequestAt`), [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28), [SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57) (у ProbeMode годинника немає)
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядки CacheClock (усі три; «вердикт один раз» — ColdVerdict з джерелом `idle` напряму, без таймера фази 5) і «Телеметрія» в частині годинника; [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I8, I9 — плюс: живий прогін у терміналі й stream-json, на opus і на sonnet — відповідь іде потоком як без хука `turn.step`, `cache.lastRequestAt` у `tags.json` після кожного ходу, зокрема перерваного Esc, рядок `Cache clock: warm` у `context_list`; форк документа передачі оновлює `lastRequestAt`; нова сесія після передачі будь-яким способом починає з `lastRequestAt = null`

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| CacheClock, розбір поля `cache`, Temperature, ColdVerdict, Confirm (запис `cache`) | `hooks/cacheclock.ts` | чиста логіка годинника |
| Хук-генератор `turn.step` основної розмови; пам'ять модуля `lastRequestAt`; запис реєстру в кінці ходу й на першому кроці з `check` | `hooks/register.ts`, `hooks/flush.ts` (`afterTurn`) | крок ходу й окремий запис |
| ColdVerdict на першому промпті основної розмови (крім промптів власної компактизації й пробудження) | `hooks/register.ts` (`prompt.submit`), `hooks/queue.ts` (DeliverReport) | вердикт на промпті |
| Оновлення годинника після форка документа | `hooks/handoff.ts` | [SP_HELP_02_09](./context_helper.batches.sp.md#SP_HELP_02_09) |
| Рядки `Cache clock` і `Cache clock checks` | `hooks/stages.ts` | телеметрія |
| Вид `cache` у `JournalEntry` й `isEntry` (невідомий вид робить журнал нечитним), підсумок для `Cache clock checks` | `hooks/journal.ts` | запис `cache` |
| `carryRegistries` не переносить поле `cache` у нову сесію | `hooks/handoff.ts` | STRUCT-04 |

### Phase 3 — Відкладені пакети в обробнику й черзі (`hooks/batches.ts`) [DONE]  {#PL_HELP_P3}

**Depends on:** Phase 2 (SelectEdits порівнює `coldSince` з `lastRequestAt`)
**Implements:** [SP_HELP_01_06](./context_helper.batches.sp.md#SP_HELP_01_06); з [SP_HELP_02_10](./context_helper.batches.sp.md#SP_HELP_02_10) — RewriteStart, SelectEdits і порожній вибір, фіксація, прив'язка невибраних правок, продовження після застосування, гілка збою, NonDeferred і Applicable; [SP_HELP_04_02](./context_helper.sp.md#SP_HELP_04_02) (усі переходи, крім передачі); поле `deferred` запису `apply` з [SP_HELP_01_08](./context_helper.sp.md#SP_HELP_01_08); інваріанти I6, I12 і I7 у частині вибору лише з відкладених; константа BATCH_PREFIX. Агент відкладених правок ще не ставить: фаза інертна для живих сесій, поки черга не має поля `deferred`
**Змінює:** [SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03), [SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04) (поля й розподіл KeepOtherSteps), [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04), [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07), [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06) (Applicable замість `len(q.edits)`, NonDeferred у KeepOtherSteps), [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13) (`tagsOnly`), [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30) і [SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42) (порожній хід стискання — за NonDeferred), [SP_CTX_01_19](./context_editor.records.sp.md#SP_CTX_01_19) і [SP_CTX_02_31](./context_editor.telemetry.sp.md#SP_CTX_02_31) (поле `deferred` запису `apply`)
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядки SelectEdits (усі п'ять), «Flush — лише відкладені», KeepOtherSteps (без очікування «наступний `defer` — `b2`»: його перевіряє фаза 4), «Гілка збою» (усі три), «Фіксація» (усі три); [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I6, I7 (вибір лише з відкладених), I12; [SP_HELP_05_04](./context_helper.sp.md#SP_HELP_05_04) «Ціль відкладеної правки зникла» — плюс: увесь наявний набір тестів проходить без змін (черга без `deferred` поводиться як раніше); живе застосування з `keep_cache` і без нього в терміналі й stream-json дає ті самі рядок людині, звіт і промпт продовження, що до фази

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| NonDeferred, Applicable, RewriteStart (над `cacheShape` і `cacheCost` з `hooks/cache.ts`: `start`, `positions`, `within` проти CACHE_LOOKBACK; API-форму обробник уже читає), SelectEdits, BindUnselected (як RebindTags, `hooks/tags.ts`), розподіл полів для KeepOtherSteps | `hooks/batches.ts` | чиста логіка вибору й прив'язки |
| Розбір і запис `deferred`, `nextBatch`, `applyDeferred`, `coldSince`, `deferredSince`; `keepOtherSteps` за розподілом | `hooks/queue.ts` | черга |
| SelectEdits до ApplyEdits, `skip "no applicable edits"`, фіксація з невибраними правками, `selectedBatches` у пам'яті модуля, гілка збою, ResumesAfter, речення звіту | `hooks/compaction.ts`, `hooks/edits.ts` | обробник |
| Applicable у плануванні, ранньому виході, калібруванні, гілці застосування й скиданні `resume` | `hooks/flush.ts` | Flush |
| NonDeferred у QueueTagReplacements і DetectOptimize | `hooks/tags.ts`, `hooks/stages.ts` | заміни тегів, порожній хід стискання |
| Поле `deferred` запису `apply` (JournalApply) | `hooks/journal.ts` | журнал |

Pseudocode sketch:

    FUNCTION SelectEdits(queue, rows, lastRequestAt):
        IF queue.applyDeferred AND (no coldSince OR coldSince = lastRequestAt): RETURN all edits
        O = NonDeferred(queue); IF O empty: RETURN []
        sO = RewriteStart(O, rows, queue.keepCache)
        RETURN O + batches B with sO ≤ RewriteStart(B, rows, true), in queue order

### Phase 4 — Поле `defer` і видимі відкладені пакети [DONE]  {#PL_HELP_P4}

**Depends on:** Phase 3
**Implements:** з [SP_HELP_02_10](./context_helper.batches.sp.md#SP_HELP_02_10) — постановка (поле `defer`, речення `Deferred as <batch>…` поки без частини «when the cache turns cold in idle» — її додає фаза 5, ігнорування `resume`, `resume_prompt`, `keep_cache`, без повернень, без замін тегів, очікування блоку не закінчується), `/compact` людини, передача; переходи передачі з [SP_HELP_04_02](./context_helper.sp.md#SP_HELP_04_02); рядок «Відкладені» з [SP_HELP_02_13](./context_helper.sp.md#SP_HELP_02_13) у теплому варіанті без «a cold cache in idle» (холодний варіант і цю частину додає фаза 5); рядок «Відкладені правки» з [SP_HELP_02_14](./context_helper.sp.md#SP_HELP_02_14); рядок `defer` з [SP_HELP_03_01](./context_helper.sp.md#SP_HELP_03_01); інваріант I10; рядок «Черга» з [SP_HELP_06_01](./context_helper.sp.md#SP_HELP_06_01)
**Змінює:** [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (поле `defer`, рядок результату, прив'язка замість `listedKey` для наступних застосувань), [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30) і [SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42) (відкладені після порожнього ходу стискання, без COMPACT_NOTHING), [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) і [SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22) (засів «транскрипт» з усіма правками; «документ» скидає відкладені; число правок — за NonDeferred), [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28) (рядок Deferred), [SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55) (ObservePassedCompact і CompactBrief), [SP_FOLD_02_03](./context_folds.sp.md#SP_FOLD_02_03) (виклик з `defer` повернень не додає); правило [C_CTX_DEC_03](./context_editor.core.concept.md#C_CTX_DEC_03) у частині очікування застосування й передачі (простій — фаза 5)
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядки «Постановка» (обидва), KeepOtherSteps (наступний `defer` — `b2`), «`/compact` людини», «Передача» (обидва, у частині відкладених), «Телеметрія» в частині пакетів; [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I10; сценарії L5 і L6 (відкладений пакет) з [SP_HELP_05_03](./context_helper.sp.md#SP_HELP_05_03) — плюс: живий виклик `context_edit` з `defer: true` лишає пакет у черзі після кінця ходу, а наступне застосування з неглибоким `keep_cache` бере лише пакети з початком переписування не раніше за свій; опис і схема `context_edit` ≤ MAX_DESCRIPTION; `tests/skill-limits.sh` проходить

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| Поле `defer` у постановці, речення результату, `deferredSince`, `nextBatch` | `hooks/queue.ts`, `hooks/edits.ts` (PrepareEdits без змін перевірок) | постановка пакета |
| Поле `defer` у схемі `context_edit` з описом властивості (EDIT_DESCRIPTION без змін) | `hooks/tools.ts` | відкриття агенту |
| Порожній хід стискання з відкладеними → `applyDeferred` і Flush | `hooks/stages.ts` (DetectOptimize), `hooks/personcompact.ts` | `/compact` людини |
| Засів «транскрипт» з усіма правками; «документ» — речення про скинуті; NonDeferred у результаті передачі | `hooks/handoff.ts` | передача (STRUCT-04) |
| ObservePassedCompact очищає відкладені; CompactBrief називає їх | `hooks/capabilities.ts` | обхід компактизації |
| Рядок `Deferred:` з ціною CacheCost відкладених правок окремо | `hooks/stages.ts`, `hooks/cache.ts` | телеметрія |

### Phase 5 — Простій (`hooks/idle.ts`) [DONE]  {#PL_HELP_P5}

**Depends on:** Phases 2, 4
**Implements:** [SP_HELP_02_11](./context_helper.batches.sp.md#SP_HELP_02_11) (без виклику WakeCheck — його додає фаза 8); частина «when the cache turns cold in idle» речення `Deferred as <batch>…` з [SP_HELP_02_10](./context_helper.batches.sp.md#SP_HELP_02_10); рядок «Відкладені» з [SP_HELP_02_13](./context_helper.sp.md#SP_HELP_02_13) повністю (теплий варіант з простоєм і холодний); рядок-покажчик `defer` в HELPER_DESCRIPTION з [SP_HELP_02_02](./context_helper.ask.sp.md#SP_HELP_02_02); поле `idle` запису `apply` з [SP_HELP_01_08](./context_helper.sp.md#SP_HELP_01_08); інваріант I7 у частині простою; константа IDLE_SLACK_MS
**Змінює:** [SP_CTX §02](./context_editor.sp.md#SP_CTX_02) (преамбула: взведення таймера простою після Flush з ланцюжка `turn.complete`), [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06) (взведення після Flush), [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08) (звіт застосування в простої чекає наступного промпту, без промпту продовження), [SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53) і [SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54) (застосування в простої пропускається), [SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57) (у ProbeMode таймера немає), [SP_CTX_01_19](./context_editor.records.sp.md#SP_CTX_01_19) і [SP_CTX_02_31](./context_editor.telemetry.sp.md#SP_CTX_02_31) (поле `idle` запису `apply`); правила [C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02) і [C_CTX_DEC_03](./context_editor.core.concept.md#C_CTX_DEC_03) у частині простою
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядок «IdleRun — гілки»; [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I7; [SP_HELP_05_04](./context_helper.sp.md#SP_HELP_05_04) «Переривання, потім простій», «Відкрита панель термінала в простої» — плюс: живий прогін — таймер взводиться в кінці ходу (рядок журналу налагодження), хід, що почався, його знімає; на теплому кеші таймер перевзводиться на залишок, нічого не застосовуючи (L3 з простоєм понад годину — у фазі 9)

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| IdleRun, взведення (`armedTurns`, `armedBy`), гілки Temperature, відмова й обхід, порт `IdleIO` | `hooks/idle.ts` | чиста логіка простою |
| Взведення після Flush у кінці завершеного ходу; пам'ять модуля таймера й `applying` | `hooks/flush.ts` (`afterTurn`), `hooks/register.ts` | порядок кінця ходу |
| Застосування без промпту продовження й промпту оптимізації; рядок людині LogApply; звіт чекає промпту | `hooks/flush.ts` (спільна частина з Flush), `hooks/compaction.ts` | [SP_HELP_02_11](./context_helper.batches.sp.md#SP_HELP_02_11) |
| Поле `idle` запису `apply` | `hooks/journal.ts` | журнал |
| Частина про простій у реченні `Deferred as <batch>…` і в рядку `Deferred:`; рядок-покажчик `defer` в HELPER_DESCRIPTION | `hooks/queue.ts`, `hooks/stages.ts`, `hooks/tools.ts` | тексти агенту тепер правдиві |

### Phase 6 — Новий процес (`hooks/idle.ts`) [DONE]  {#PL_HELP_P6}

**Depends on:** Phase 5
**Implements:** [SP_HELP_02_12](./context_helper.batches.sp.md#SP_HELP_02_12), [SP_HELP_DEC_09](./context_helper.sp.md#SP_HELP_DEC_09) (A: StartRun); інваріанти I13 і I7 у частині StartRun; константа START_WAIT_MS
**Змінює:** [SP_CTX §02](./context_editor.sp.md#SP_CTX_02) (преамбула: виняток для команди StartRun і таймера, який вона взводить), [SP_CTX_02_44](./context_editor.resume.sp.md#SP_CTX_02_44), [SP_CTX_02_46](./context_editor.resume.sp.md#SP_CTX_02_46) (ремонт після застосування StartRun бачить довірену межу), [SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42) (маршрут: власна команда StartRun проходить `command.run` мода й пропускається за походженням `plugin`), [SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53) і [SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54) (лише вердикт `reached`, без очікування зонда)
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядки StartRun (усі три) і «IdleRun — таймер StartRun» у частині «пакет застосовано» (WakeCheck — фаза 8); [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I13; [SP_HELP_05_04](./context_helper.sp.md#SP_HELP_05_04) «Перша сесія на новій версії хоста», «Промпт випередив команду» — плюс: живий `claude --resume` на теплому кеші з відкладеним пакетом взводить таймер простою й не тримає перший промпт довше за START_WAIT_MS; холодна гілка без години чекання — `--resume` сесії з відкладеним пакетом і `cache.lastRequestAt`, зсунутим у `tags.json` назад більше ніж на CACHE_TTL_MS: пакет застосовано до першого промпту (L8 зі справді холодним кешем — у фазі 9)

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| StartRun: вердикт `compact`, читання черги й годинника, гілки, очікування зворотного виклику з межею, відмова, порт `StartIO` | `hooks/idle.ts` | чиста логіка нового процесу |
| Виклик з хука `session.start` після PrepareStorage (не ProbeMode); `$.clock.after(0)` і очікування з межею START_WAIT_MS | `hooks/register.ts` | зв'язування |
| Перевірка маршруту `compactRoute` для власної команди з `session.start` | `hooks/personcompact.ts` (тест) | [SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42) |

### Phase 7 — Доручення з умовою й доставка (`hooks/errands.ts`) [DONE]  {#PL_HELP_P7}

**Depends on:** Phases 1, 2, 5 (дії `ask` і `apply`, умова `cold`, застосування в простої)
**Implements:** [SP_HELP_01_05](./context_helper.errands.sp.md#SP_HELP_01_05), [SP_HELP_02_06](./context_helper.errands.sp.md#SP_HELP_02_06), [SP_HELP_02_07](./context_helper.errands.sp.md#SP_HELP_02_07), з [SP_HELP_02_08](./context_helper.errands.sp.md#SP_HELP_02_08) — безпечні моменти ToolResult і Prompt, блок доставки, власні промпти мода (без пробудження); [SP_HELP_04_01](./context_helper.sp.md#SP_HELP_04_01); поле `errand` запису `ask` з [SP_HELP_01_08](./context_helper.sp.md#SP_HELP_01_08); рядок «Доручення» з [SP_HELP_02_13](./context_helper.sp.md#SP_HELP_02_13) і [SP_HELP_02_14](./context_helper.sp.md#SP_HELP_02_14); рядки доручень з [SP_HELP_03_01](./context_helper.sp.md#SP_HELP_03_01); інваріанти I4, I11; константи ERRAND_PREFIX, MAX_ERRANDS, MAX_ERRAND_RESULT, MAX_SIZE_TOKENS, STALE_RUNNING_MS, MAX_DELIVERY
**Змінює:** [SP_CTX §02](./context_editor.sp.md#SP_CTX_02) (преамбула: CheckErrands у порядку кінця ходу), [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`errands`, `nextErrand`), [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06) (CheckErrands; блок доставки в тексті промптів Flush), [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08) (блок доставки в прихованому контексті; відкинутий промпт повертає блок), [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), [SP_FOLD_02_05](./context_folds.sp.md#SP_FOLD_02_05) і [SP_FOLD_02_06](./context_folds.sp.md#SP_FOLD_02_06) (`markDue` з назвами закритих областей), [SP_CTX_02_33](./context_editor.stages.sp.md#SP_CTX_02_33) (нагадування нотаток і з промптом), [SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37) (умови `size` до порогів), [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30) і [SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42) (блок у промпті ходу стискання), [SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53) і [SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54) (доручення з `ask` і `apply` відхиляються), [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) і [SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22) (перенесення доручень, `running` → `fired`; «документ» — речення про скинуті), [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28), [SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57) (у ProbeMode доручень не перевіряють); правило [C_CTX_03_07](./context_editor.core.concept.md#C_CTX_03_07)
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядки errand_add, errand_remove, «Власні виклики — errand_list», CheckErrands (усі три), Fire (обидва), «Доставка» (усі п'ять), «Передача» (у частині доручень), «Телеметрія» в частині доручень; [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I2 (дія `ask`), I4, I11; сценарії L2 і L6 (доручення) з [SP_HELP_05_03](./context_helper.sp.md#SP_HELP_05_03); [SP_HELP_05_04](./context_helper.sp.md#SP_HELP_05_04) «Гаряче перезавантаження в простої», «Доручення `ask` після передачі», «`size` досягнуто посеред довгого ходу», «Помічник довго відповідає, агент знімає доручення» — плюс: HELPER_DESCRIPTION з операціями доручень ≤ MAX_DESCRIPTION

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| Errand, Condition, Action, розбір полів реєстру, операції `errand_add`, `errand_list`, `errand_remove`, CheckErrands, Fire, рядок доручення, STALE_RUNNING_MS, DeliveryBlock (нагадування нотаток + доручення ≤ MAX_DELIVERY), відкат блоку | `hooks/errands.ts` | чиста логіка доручень і доставки |
| Рядок доручення й тексти доручень (APPLY_*, STALE_TEXT, HANDED_OFF_TEXT) — в одному місці, `hooks/errands.ts` (зроблено там, не в `rows.ts`: їх читає лише `errands.ts` і тести; STRUCT-01 виконано — одне визначення) | `hooks/errands.ts` | STRUCT-01 |
| `dueReminders` як частина DeliveryBlock; доставка з результатом інструмента й з промптом | `hooks/notes.ts`, `hooks/register.ts` (`tool.call`, `prompt.submit`) | безпечні моменти |
| CheckErrands у кінці ходу після лічильника, до Flush; блок у тексті промптів Flush і ходу стискання з відкатом при `{ drop }` | `hooks/flush.ts`, `hooks/stages.ts` | власні промпти мода |
| AreaClosed: порт `markDue(after, closed)` (назви з `closeStage`; `folds.ts` MarkDue без змін, CheckErrands — у `markDueNow` прив'язки) з `context_tag` close і вставок `close`, `optimize` | `hooks/stages.ts` (`closeStage`, DetectOptimize),  `hooks/tags.ts` (закриття `context_tag`), `hooks/stages.ts` (вставки), `hooks/register.ts` (`markDueNow`) | умова `closed` |
| ColdVerdict → подія `cold` для CheckErrands: вердикт першого промпту й таймера простою (зроблено в прив'язці: порти `cold` DeliverReport і `coldVerdict` IdleRun) | `hooks/register.ts` (`prompt.submit`, `idleIO`) | умова `cold` |
| BigOutput: читання `usage` для умов `size` до воріт нагадування (WantsSize, OutputSize у `errands.ts`; виклик у загальному хуку `tool.call` до HintFor) | `hooks/errands.ts`, `hooks/register.ts` | умова `size` |
| Фонове питання дії `ask` (Ask з фази 1 з першим рядком доручення) | `hooks/errands.ts`, `hooks/ask.ts` | дія «питання помічнику» |
| Перенесення `errands`, `nextErrand` у засів; речення «документа» | `hooks/handoff.ts` | STRUCT-04 |
| Операції доручень у схемі й описі `context_helper` (без `wake`) | `hooks/tools.ts` | відкриття агенту |

### Phase 8 — Пробудження (`hooks/errands.ts`) [TODO]  {#PL_HELP_P8}

**Depends on:** Phases 5, 7
**Implements:** з [SP_HELP_02_08](./context_helper.errands.sp.md#SP_HELP_02_08) — пробудження (WakeCheck) і повторна перевірка фонового питання; поле `wake` операції `errand_add` з [SP_HELP_02_02](./context_helper.ask.sp.md#SP_HELP_02_02) і [SP_HELP_02_06](./context_helper.errands.sp.md#SP_HELP_02_06); виклик WakeCheck в IdleRun з [SP_HELP_02_11](./context_helper.batches.sp.md#SP_HELP_02_11) (`armedBy = turn`); інваріант I5; константи WAKE_RECHECK_MS, WAKE_TEXT
**Змінює:** [SP_CTX §02](./context_editor.sp.md#SP_CTX_02) (преамбула: WakeCheck у порядку кінця ходу; таймер повторної перевірки з ланцюжка `turn.complete`), [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06) (WakeCheck у кінці Flush без промпту), [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08) (звіт застосування в простої несе промпт пробудження); правило [C_CTX_01_01](./context_editor.concept.md#C_CTX_01_01)
**Verify:** [SP_HELP_05_01](./context_helper.sp.md#SP_HELP_05_01) рядки WakeCheck (усі чотири) і «IdleRun — таймер StartRun» у частині WakeCheck (не викликано; доручення з `wake` чекає кінця першого ходу); [SP_HELP_05_02](./context_helper.sp.md#SP_HELP_05_02) I5; [SP_HELP_05_04](./context_helper.sp.md#SP_HELP_05_04) «Хост відхилив промпт пробудження» — плюс: живе доручення `turns` + `remind` + `wake`, що спрацювало в кінці ходу з порожньою чергою, дає один промпт пробудження; другого в тому самому простої немає (L4 з простоєм понад годину — у фазі 9)

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| WakeCheck (умови з пам'яті модуля, `wokeAt`), промпт пробудження з блоком і звітом, відкат при `{ drop }`, рядок стану | `hooks/errands.ts` | чиста логіка пробудження |
| WAKE_TEXT | `hooks/rows.ts` | STRUCT-01 |
| WakeCheck у кінці ходу, у кінці Flush без промпту, в IdleRun з `armedBy = turn`; таймер повторної перевірки WAKE_RECHECK_MS з ланцюжка `turn.complete`, знятий MovedSince | `hooks/flush.ts`, `hooks/idle.ts`, `hooks/register.ts` | точки виклику |
| Поле `wake` у схемі й описі `context_helper`, речення результату `errand_add` | `hooks/tools.ts`, `hooks/errands.ts` | відкриття агенту |

### Phase 9 — Живий прогін і передача знань [TODO]  {#PL_HELP_P9}

**Depends on:** Phases 1–8
**Implements:** [SP_HELP_05_03](./context_helper.sp.md#SP_HELP_05_03) (L1–L8 разом), [SP_HELP_06_01](./context_helper.sp.md#SP_HELP_06_01) (перевірка оборотності)
**Verify:** L1–L8 у терміналі й stream-json; L3, L4 і L8 — одним прогоном із простоєм понад CACHE_TTL_MS + IDLE_SLACK_MS ([DEC_04](#PL_HELP_DEC_04)); I1 — кожна показана цитата знаходиться `grep -F` в архіві; I6 — аудит записів журналу `apply` з `deferred` і `idle`; L7 (обхід) і край «мод перевели з керованого плагіна на рівень user» на цій машині не відтворити (керовані налаштування вантажать мод для кожної сесії) — `unobserved` з причиною, гілки покривають тести фаз 1, 4, 5, 6, 7 — плюс: SP_HELP переходить у `active`, PL_HELP — у `completed`

What to do:
| Item | Where | Purpose |
|------|-------|---------|
| Драйвер довгого прогону: три сесії (простій з пакетом і дорученням `cold`, пробудження, закритий процес) паралельно, одна година очікування | `.dev_flow/cache/live-test/` (за зразком `dec10-probe/`) | L3, L4, L8 |
| Оборотність: вимкнути реєстрацію `context_helper`, поле `defer` і таймер простою в робочій копії; черга з відкладеними правками без `defer` застосовується як звичайна | тимчасова гілка, без коміту | [SP_HELP_06_01](./context_helper.sp.md#SP_HELP_06_01) |
| Документи: `README.md` (інструменти, механізми), `CLAUDE.md` (модулі `helper`, `ask`, `cacheclock`, `batches`, `idle`, `errands`, події `turn.step`), статуси SP_HELP і PL_HELP, `docs/_index.md` | `README.md`, `CLAUDE.md`, `docs/` | propagate |
| Навички: факти живих прогонів | `.dev_flow/skills/claude-code/plugin-hooks*.md`, `.dev_flow/skills/context-editing/helper-evidence.md` | Required Knowledge, skill (update) |

## Backlog

Items deferred from the current implementation cycle (each with a return trigger):
- Живий сценарій L7 (обхід компактизації) і край «мод перевели з керованого плагіна на рівень user» — return when: доступна машина чи обліковий запис без керованих налаштувань для мода, або розробник попросить відтворити обхід іншим способом.
- Рядок про помічника й відкладені пакети в навичці `context-stages` (зараз 8994 з 9000 символів за `tests/skill-limits.sh`) — return when: живий прогін фази 9 покаже, що агент не бере `context_helper` чи `defer` там, де вони вигідні, або навичка звільнить місце.
- Пошук по архівах кількох сесій ([C_FOLD_DEC_03](./context_folds.concept.md#C_FOLD_DEC_03), відкладено концептом) — return when: розробник відкриє цей пункт концепту.
- Знижка кешу в оцінці ціни помічника (HELP_PRICE_IN — оцінка зверху) — return when: журнал `ask` фази 9 покаже, що оцінка розходиться з рахунком більш ніж удвічі.

## Design Decisions  {#PL_HELP_DEC}

### DEC_01 — Порядок фаз  {#PL_HELP_DEC_01}

> **Status:** resolved
> **Date:** 2026-11-16

**Question:** У якому порядку реалізовувати три механізми C_HELP, якщо доручення спираються і на питання, і на відкладені пакети, і на годинник кешу?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — питання першими: помічник і питання → годинник → пакети (обробник, потім `defer`) → простій → новий процес → доручення → пробудження → прогін | найсильніший за спайком механізм з'являється першим і не чіпає ядра застосування; пакети приходять пізніше |
| B — пакети першими: годинник → пакети → простій → новий процес → питання → доручення → пробудження → прогін | ядро концепту з'являється першим, але з першої ж фази змінюється обробник компактизації |
| C — лише питання зараз, решта в беклозі | найменша зміна; два з трьох механізмів концепту чекають живого досвіду |

**Decision:** A — розробник: «Питання першими (Recommended)».
**Rationale:** питання до архіву — найсильніша за доказами спайку помічника форма делегування; вони не залежать від решти механізмів і не змінюють обробника компактизації, тож перший живий досвід приходить з найменшим ризиком для застосування правок.
**Rejected because:**
- B — перша ж фаза змінює ядро застосування, а користь для агента з'являється лише після фаз постановки й простою.
- C — концепт прийнято з трьома механізмами; відкладати два без тригера з живого досвіду — прихований «потім».

### DEC_02 — Нові модулі замість розширення наявних  {#PL_HELP_DEC_02}

> **Status:** resolved (agent; developer approved at the design sign-off)
> **Date:** 2026-11-16

**Question:** Де живе логіка помічника, годинника, пакетів, простою й доручень?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — шість нових чистих модулів (`helper`, `ask`, `cacheclock`, `batches`, `idle`, `errands`), наявні модулі змінюються лише в точках §03_03 | кожен механізм тестується окремо; наявні файли ростуть мало |
| B — розширити `edits.ts`, `flush.ts`, `notes.ts` | менше файлів, але `edits.ts` уже 2824 рядки, а рішення розмазуються по модулях з іншою відповідальністю |

**Decision:** A.
**Rationale:** шаблон портів `CLAUDE.md` і правило STRUCT-02 вимагають рішення в чистому модулі з тестом; окремий модуль на механізм дає зрозумілу межу для рев'ю кожної фази.
**Rejected because:**
- B — найбільший модуль мода росте далі, а зміна одного механізму зачіпає тести інших.

### DEC_03 — Поступове відкриття механізмів агенту  {#PL_HELP_DEC_03}

> **Status:** resolved (agent; developer approved at the design sign-off)
> **Date:** 2026-11-16

**Question:** Коли агент бачить нові операції й поля?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — кожна фаза відкриває лише те, що вже працює: `ask` (1), `defer` (4), простій у текстах `defer` (5), операції доручень (7), `wake` (8) | опис `context_helper` змінюється чотири рази; агент ніколи не бачить операції чи обіцянки без реалізації |
| B — повна схема з першої фази, нереалізовані операції відмовляють | один опис, але живі сесії цієї машини бачать інструмент, що відмовляє |

**Decision:** A.
**Rationale:** мод — керований плагін, кожна нова сесія завантажує робоче дерево, тож незавершена фаза одразу доходить до живих сесій розробника. Тексти кожної фази називають лише шляхи, що вже працюють: у фазі 4 речення `Deferred as <batch>…` і рядок `Deferred:` не згадують простою, фаза 5 додає ці частини разом із застосуванням у простої; між фазами 4 і 5 відкладена правка застосовується найближчим застосуванням, що переписує кеш не пізніше, `/compact` людини чи передачею.
**Rejected because:**
- B — агент учиться на відмовах і може покинути інструмент до того, як він запрацює.

### DEC_04 — Довгі живі сценарії одним прогоном  {#PL_HELP_DEC_04}

> **Status:** resolved (agent; developer approved at the design sign-off)
> **Date:** 2026-11-16

**Question:** Як перевіряти сценарії, що вимагають простою понад годину (L3, L4, L8)?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — у фазі 9, три сесії паралельно, одне очікування | одна година чекання; фази 5, 6, 8 перевіряють живо коротку частину (взведення, перевзведення, StartRun на теплому кеші, пробудження в кінці ходу) |
| B — у кожній фазі окремо | три години очікування, але кожна фаза закривається з повним живим сценарієм |

**Decision:** A.
**Rationale:** механізм таймера понад годину й застосування з `session.start` уже перевірив зонд DEC_10 (плагін-хуки 89, 92); у фазах лишається ризик власного коду, який покривають тести й короткі живі сценарії.
**Rejected because:**
- B — утричі довше без нового знання про хост.

## Changelog

| Date | Change |
|------|--------|
| 2026-11-16 | План створено за SP_HELP (draft); порядок фаз — DEC_01 (розробник) |
| 2026-11-16 | Підписання дизайну: розробник запустив `/dev-flow implement` після питання про затвердження плану з DEC_02–04 — план `active`, DEC_02–04 прийнято; фаза 1 `[IN PROGRESS]` |
| 2026-11-16 | Рев'ю 1 (pass with advisories): рядки перевірки перенесено у фази, де є їхній контракт (KeepOtherSteps `b2` → 4, «таймер StartRun» → 6 і 8, «Гаряче перезавантаження» → 7, I2 → 1 і 7); фаза 2 — вид `cache` у журналі й `carryRegistries`; запис `apply` (SP_CTX_02_31, `journal.ts`) у фазах 3 і 5, SP_CTX_02_04 і 02_07 у фазі 1; частина `defer` про простій — у фазі 5, правила C_CTX_03_02 і C_CTX_DEC_03 (простій) — у фазі 5; SKILL.md і EDIT_DESCRIPTION без змін; модулі AreaClosed і умови `cold` у фазі 7; RewriteStart над `cacheShape`/`cacheCost`; холодна гілка StartRun живо у фазі 6 |
| 2026-11-16 | Фаза 1 `[DONE]`: код, тести (1106), рев'ю з чистим контекстом (pass with advisories, усе виправлено), живий L1 у stream-json і терміналі; перерваний виклик не пише запису питання; мітки матеріалу в цитатах помічника знімаються перевіркою |
| 2026-11-16 | Фаза 2 `[DONE]`: годинник кешу (`hooks/cacheclock.ts`, хук `turn.step`, вердикт на промпті, перевірка першим кроком, рядки телеметрії, форк і передача), тести (1123), рев'ю з чистим контекстом (pass with advisories, усе виправлено: ConfirmCheck у чистому модулі зі StartCheck, `prev` з початку кроку, `mismatch` лише за межею CACHE_TTL_MS), живі прогони stream-json на sonnet і термінал на opus; попутно сигнал хука в `$.model.complete` (фаза 1) |
| 2026-11-17 | Фаза 3 `[DONE]`: відкладені пакети в обробнику й черзі (`hooks/batches.ts`: NonDeferred, Applicable, RewriteStart на спільному `withinLookback`, SelectEdits з другим зважуванням після екранів, BindUnselected; поля черги, фіксація, гілка збою з `selectedBatches`, Flush за Applicable, поле `deferred` запису `apply`), тести (1140), рев'ю з чистим контекстом (pass with advisories, 0 must / 0 should / 4 prefer — усе виправлено), живі S1 і T1 (група `help-p3`); хост за ніч оновився до 2.1.326 — тип-перевірка на його типах чиста |
| 2026-11-17 | Фаза 4 `[DONE]`: поле `defer` у `context_edit` (пакет `b<n>`, вибори пакета без змін, без повернень і замін тегів; DEFER_RETURN для правки над ще не поверненою парою розгортання чи питання, DEFER_STATE для правок слота стану — рішення делеговані), рядок стану з відкладеними окремо, порожній хід стискання `/compact` застосовує пакети, передача (засів «транскрипт» застосовує, «документ» скидає з реченням), бриф обходу, рядок `Deferred:` у `context_list`; тести (1154), рецензія з чистим контекстом (pass with advisories, усе виправлено), живі прогони S2, S3 (stream-json) і T1 (термінал) на хості 2.1.326: L5, L6, неглибокий `keep_cache` лишає ранній пакет |
| 2026-11-17 | Фаза 5 `[DONE]`: IdleRun (`hooks/idle.ts`): таймер CACHE_TTL_MS + IDLE_SLACK_MS після Flush у кінці кожного завершеного ходу (новий замінює попередній; хід, що вже почався, таймера не ставить), гілки за температурою (теплий — перевзведення на залишок), вердикт `cold`, позначка черги й власна компактизація без ходу й промпту, звіт чекає наступного промпту; папка сховища раз на прогін, позначка на порожній черзі знімається без команди, запланований Flush і зміна сесії лишають прогін; обробник пропускає команду, яку хід випередив (SKIP_IDLE_OVERTAKEN); поле `idle` запису `apply`; частина про простій у `Deferred as …`, описі `defer`, рядку `Deferred:` (холодний варіант) і рядок-покажчик в HELPER_DESCRIPTION; тести (1167), рецензія з чистим контекстом (pass with advisories, усе виправлено), живі прогони S1, S2 і L1 (простій 62 хв: пакет застосовано без ходу, `idle: true`, звіт з наступним промптом, `mismatch: false`) на 2.1.326 у stream-json і зонд вкладеного таймера N1; перевзведення на теплому кеші наживо не спостерігали (`unobserved`: теплий кеш у мить спрацювання потребує запиту поза ходом, а такий робить лише форк передачі, що змінює сесію) — його покривають тест «IdleRun — гілки» і зонд N1 (команда з вкладеного таймера проходить); термінал — у фазі 9 |
| 2026-11-17 | Фаза 6 `[DONE]`: StartRun (`hooks/idle.ts`, StartIO, START_WAIT_MS) з хука `session.start` після PrepareStorage, вердиктів і плану ремонту: вердикт `compact` = `reached` з кешу версії хоста; теплий кеш — таймер простою на залишок (`armedBy` start); холодний — позначка `applyDeferred` до таймера, команда з `$.clock.after(0)`, хук чекає лише її запуску (≤ START_WAIT_MS); без калібрування й без промптів; відмова й межа очікування знімають позначку. Рецензія: пропуск обробником команди StartRun, яку випередив перший хід (пам'ять `starting`, `skip "start apply overtaken by a turn"`), причини `start run: nothing (…)`, тести гілок. Живий прогін (2.1.326, sonnet): stream-json теплий і холодний `--resume`, термінал холодний, одноразові `-p --resume` json і text — `.dev_flow/cache/live-test/help-p6/`; таймер StartRun, що спрацьовує без ходу, — L8 у фазі 9 |
| 2026-11-17 | Фаза 7 `[DONE]`: доручення з умовою (`hooks/errands.ts`): реєстр `errands`/`nextErrand`; `context_helper` операції `errand_add`, `errand_list`, `errand_remove` (`wake` — BAD_OP до фази 8); CheckErrands на TurnEnd (після годинника, до Flush, лише завершені ходи), BigOutput, AreaClosed (назви закритих областей; позначка вже закритого цим ходом блоку подій не дає), ColdVerdict (промпт і таймер простою); Fire: `remind`, `apply` (позначка черги без `coldSince`, що переживає власні IdleRun і StartRun), `ask` у фоні (ErrandAsk на кроках Ask, FinishAsk); DeliveryBlock (нагадування нотаток + доручення ≤ MAX_DELIVERY) з результатом інструмента (не `ask` і не `context_recall`), у прихованому контексті промпту й у тексті промптів Flush і ходу стискання, з поверненням при відмові; передача (CarriedErrands; речення «документа»); рядок `Errands:`; мертві NoteReminders/ReminderPending/AfterReminders прибрано (їхні тести — на DeliveryBlock). Відхилення від «What to create» — рядки таблиці фази виправлено. 1205 тестів, tsc, validate; живий прогін `.dev_flow/cache/live-test/help-p7/` (L2 з перевіреною цитатою людини, доставка з промптом і власним промптом мода, L6). Рецензія: pass with advisories 0 must / 5 should / 5 prefer — виправлено. Не спостережено наживо: блок у промпті людини посеред ходу, гілка `cold` таймера простою з `apply now, in this idle` (фаза 9), блок у промпті ходу стискання |
