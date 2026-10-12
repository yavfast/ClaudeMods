# Implementation Plan: Редактор контексту агента  {#PL_CTX}

> **Code:** PL_CTX
> **Status:** in-progress
> **Created:** 2026-10-08
> **Updated:** 2026-10-12
>
> **Concept:** [C_CTX](./context_editor.concept.md)
> **Specification:** [SP_CTX](./context_editor.sp.md)
> **Depends on:** none
> **Used by:** —
>
> План реалізації мода-редактора контексту: фази 1–24 виконано (основний функціонал, теги, псевдоніми, медіа, поточна розмова, передача в нову сесію, один плагін і компактизація командою, етапи і мітка оптимізації, нотатки, доставки хоста, м'яке нагадування і ціна кешу, застарілі вкладення хоста); відкрита робота — backlog. Читати перед вибором наступної роботи з backlog або перед новою фазою.

## Goal

Агент сам редагує свою основну розмову: стискає опрацьовані виводи, медіа і хибні кроки, чистить контекст порціями з початку, коли той росте, і заздалегідь позначає важливе та те, що можна прибрати. Цільовий стан — усі контракти [SP_CTX](./context_editor.sp.md) реалізовано і перевірено модульними тестами та живими сценаріями §05_03. Очікуваний результат, який перевіряє розробник: у живій сесії агент звільняє контекст без втрати потрібних фактів, медіа зникає лише разом з описом і архівом, позначене `pin` не змінюється, а заміни з тегів застосовуються на порозі без участі агента.

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Хост і API | Claude Code ≥ 2.1.295 (старіші не підтримуються — рішення розробника 2026-10-09), function hooks (плагіни з `hooks/hooks.json`); інтерактивний термінал і неінтерактивний хост з потоковим входом (розширення VS Code, `--input-format stream-json`); одноразовий `claude -p "<промпт>"` — поза обсягом | єдиний механізм, що дає змінити збережені рядки ([C_CTX_DEC_01](./context_editor.concept.md#C_CTX_DEC_01)); мод має працювати там, де його запускає розробник ([C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02)) |
| Мова | TypeScript, ES-модулі | вимога хоста до модулів хуків |
| Розбиття | один плагін `mods/context-editor`; компактизація — `$.command.run({ command: 'compact', args })` (до фази 10 — два плагіни з тригером) | [C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02) C |
| Модулі редактора | `hooks/edits.ts` (чиста логіка правок, перегляду, CollectMedia), `hooks/queue.ts` (черга, context_edit, доставка звіту через порт QueueIO), `hooks/compaction.ts` (обробник через порт CompactionIO), `hooks/register.ts` (зв'язування портів з `$`) | тестованість без імітації хоста ([PL_CTX_DEC_01](#PL_CTX_DEC_01)) |
| Запуск компактизації і передача | `hooks/flush.ts` (Flush через порт FlushIO), `hooks/handoff.ts` (BuildSeed, CheckSeed, CheckSeeded, RunHandoff через порт HandoffIO) | те саме |
| Сховище | JSON-файли в `<HOME>/.claude/context-editor/<session_id>/`, каталог 700 | [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07) |
| Команди хоста | `$.process.run` з argv: `sh -c` з позиційними аргументами (`mkdir`, `chmod`, `cat`, `base64 -d`), `mv` | права доступу і запис без межі 4 MiB; лише POSIX |
| Тести | `claude plugin test <mod>` (`claude-code/testing`), файли `tests/*.test.ts` | вбудований набір хоста |
| Типи | `tsc` з `npx -p typescript@5.6.3`, типи хоста з `.claude-plugin/types/` | у системі немає `tsc` |
| Живі сценарії | окремий `claude --plugin-dir …` у tmux, керований скриптом-драйвером (`ce.sh`); неінтерактивний хост — `claude -p --input-format stream-json --output-format stream-json` драйвером `drive.sh` | відтворювано і видно людині через `tmux attach -r`; stream-json — так хост запускає розширення VS Code |

## Required Knowledge

| Kind | Ref | Applies to | Note |
|------|-----|-----------|------|
| skill (create) | claude-code-plugin-hooks | Phase 3 | зафіксувати пастки хоста, знайдені в прототипі: розширення не бачить власної компактизації; `$.prompt.submit` всередині обробника компактизації блокує; `prompt.submit` повертає `{ drop }`, а не помилку; рядки з `handle` після межі посилаються на старі; `--resume` ігнорує компактизацію від обробника; `/clear` не викликає старту сесії; межа `$.fs.write` 4 MiB; `$.tool.list()` для перевірки процесу |
| skill (update) | claude-code-plugin-hooks | Phase 10 | пункти 6–7 і 16–24: неінтерактивний хост без `/resume` і без `$.session.compact`; `command.run('compact')` з `trigger: 'manual'` викликає хуки ініціатора; засів очищеної сесії; рядок без `handle` і чужий `handle` гублять медіа; API-подання після `/compact`; команди мода без подій ходу, черга за походженням таймера, копії рядків у stream-json |

## Progress

- [x] [Phase 1 — Основний функціонал](#PL_CTX_P1)
- [x] [Phase 6 — Залишкове вікно тригера](#PL_CTX_P6) (рішення A)
- [x] [Phase 3 — Теги](#PL_CTX_P3)
- [x] [Phase 7 — Псевдоніми викликів](#PL_CTX_P7)
- [x] [Phase 2 — Медіа в результатах інструментів](#PL_CTX_P2)
- [x] [Phase 8 — Поточна розмова, опис context_edit, архів без дубля медіа](#PL_CTX_P8)
- [x] [Phase 9 — Передача в нову сесію](#PL_CTX_P9)
- [x] [Phase 10 — Один плагін, компактизація командою, передача засівом](#PL_CTX_P10)
- [x] [Phase 11 — Довіра межі, чесний звіт, реєстри після передачі](#PL_CTX_P11)
- [x] [Phase 12 — Цілісна відповідь з thinking (backlog K, крок 1)](#PL_CTX_P12)
- [x] [Phase 13 — Покрокове вибіркове чищення (C_CTX_DEC_04, D)](#PL_CTX_P13)
- [x] [Phase 14 — Етапи і свідомий тригер оптимізації: ядро](#PL_CTX_P14)
- [x] [Phase 15 — Етапи: авторозмітка, діапазон, слот стану, журнал](#PL_CTX_P15)
- [x] [Phase 16 — Службові нотатки агента](#PL_CTX_P16)
- [x] [Phase 17 — Знахідки прогону на копії реальної сесії](#PL_CTX_P17)
- [x] [Phase 4 — Дослідження: медіа в промптах і межі вікон](#PL_CTX_P4)
- [x] [Phase 5 — Операція describe](#PL_CTX_P5)
- [x] [Phase 18 — Дрібні знахідки практики](#PL_CTX_P18)
- [x] [Phase 19 — Хто написав заміну (F1 фази 18)](#PL_CTX_P19)
- [x] [Phase 20 — Доставки хоста посеред ходу](#PL_CTX_P20)
- [x] [Phase 21 — ref "last"](#PL_CTX_P21)
- [x] [Phase 22 — М'яке нагадування](#PL_CTX_P22)
- [x] [Phase 23 — Кеш промпту при застосуванні і нагадування з вердиктом](#PL_CTX_P23) (живі сценарії pass 2026-10-11)
- [x] [Phase 24 — Застарілі вкладення хоста після застосувань](#PL_CTX_P24) (живий прогін 2026-10-12: сценарії 1–4 pass, 5 виправлено й повторено — pass, відкат передбачення — pass)

Порядок фаз — за [PL_CTX_DEC_02](#PL_CTX_DEC_02), [PL_CTX_DEC_04](#PL_CTX_DEC_04) і [PL_CTX_DEC_05](#PL_CTX_DEC_05); номери фаз — незмінні ідентифікатори, а не черговість.
- [backlog] Збереження правок після `--resume`; налаштовувані пороги; поширення через маркетплейс

## Phases

### Phase 1 — Основний функціонал [DONE]  {#PL_CTX_P1}

**Depends on:** none
**Implements:** [SP_CTX_01_01](./context_editor.structures.sp.md#SP_CTX_01_01)–[01_07](./context_editor.structures.sp.md#SP_CTX_01_07), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12); [02_01](./context_editor.edits.sp.md#SP_CTX_02_01)–[02_08](./context_editor.edits.sp.md#SP_CTX_02_08); [02_09](./context_editor.edits.sp.md#SP_CTX_02_09) без замін з тегів; [02_15](./context_editor.tags.sp.md#SP_CTX_02_15)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки ApplyEdits (крім describe), PrepareEdits, DropOwnCalls, context_list, context_edit, HandleCompaction, DeliverReport, TriggerCompaction; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Стиснення в межах сесії», «Три операції», «Нагадування з початку» — pass 2026-10-08 після раунду 3

| Що | Де |
|----|----|
| Правки, перегляд, DropOwnCalls, FreshId | `mods/context-editor/hooks/edits.ts` |
| Черга, context_edit, доставка звіту | `mods/context-editor/hooks/queue.ts` |
| Обробник компактизації | `mods/context-editor/hooks/compaction.ts` |
| Хуки, сховище, нагадування | `mods/context-editor/hooks/register.ts` |
| Тригер | `mods/context-editor-trigger/hooks/{flush,register}.ts` |

Рев'ю: раунди 1–3 виправлено; раунд 4 зупинено на вимогу розробника перед живою перевіркою.

### Phase 7 — Псевдоніми викликів [DONE]  {#PL_CTX_P7}

**Depends on:** Phase 3; виконується перед фазою 2 ([PL_CTX_DEC_03](#PL_CTX_DEC_03))
**Implements:** [SP_CTX_01_13](./context_editor.structures.sp.md#SP_CTX_01_13), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16), [02_17](./context_editor.tags.sp.md#SP_CTX_02_17); `ref` у [01_02](./context_editor.structures.sp.md#SP_CTX_01_02), [02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [02_11](./context_editor.tags.sp.md#SP_CTX_02_11); псевдоніми в [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) і [02_14](./context_editor.tags.sp.md#SP_CTX_02_14); [C_CTX_03_05](./context_editor.mechanisms.concept.md#C_CTX_03_05)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки MarkCall, ResolveRef, context_tag «ціль за ref», AliasRegistry «межа», RebindTags (псевдонім); [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Тег за псевдонімом»

| Що | Де |
|----|----|
| AliasRegistry, розбір, MarkCall, ResolveRef, очищення | новий `mods/context-editor/hooks/aliases.ts` (чиста логіка + порт) |
| `ref` у правках | `edits.ts` (`checkShape`), `queue.ts` (розв'язання перед `prepare`) |
| `ref` у тегах | `tags.ts`, схема `context_tag` у `register.ts` |
| Позначка в спільному хуку з нагадуванням, ланцюжок `serial('aliases')` | `register.ts` |
| Псевдоніми в переліку | `edits.ts` `listRows` |

Код і модульні тести є (`tests/aliases.test.ts`). Лишилось: живий сценарій «Тег за псевдонімом» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)); перевірити наживо, що `e.tool_use_id` хука `tool.call` збігається з `tool_use_id` рядків розмови, а рядок `[context-editor] id cN` доходить до моделі після результату.

### Phase 2 — Медіа в результатах інструментів [DONE]  {#PL_CTX_P2}

**Depends on:** Phase 1; виконується після фаз 3 і 7 ([PL_CTX_DEC_02](#PL_CTX_DEC_02), [PL_CTX_DEC_03](#PL_CTX_DEC_03))
**Implements:** [SP_CTX_01_08](./context_editor.structures.sp.md#SP_CTX_01_08), [SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10) для результатів інструментів, медіа-частини [02_04](./context_editor.edits.sp.md#SP_CTX_02_04), [02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [02_07](./context_editor.edits.sp.md#SP_CTX_02_07); [C_CTX_DEC_06](./context_editor.concept.md#C_CTX_DEC_06)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки CollectMedia, «незмінений рядок з медіа», «медіа не заархівовано», «медіа сусідньої пари», «вікно API», DropOwnCalls «спільний рядок» (модульні — є); [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Скриншот у результаті інструменту», «Документ у результаті інструменту», «Незмінене медіа» — плюс: медіа-файл в архіві відкривається інструментом читання і має права 0600

Код і модульні тести вже є. Живі сценарії «Скриншот…», «Документ…», «Незмінене медіа» — pass (2026-10-09); тестові файли — `.dev_flow/cache/live-test/make-media.sh`. Припущення підтверджено наживо:
- блоки `image` і `document` в API-поданні мають `source.type = base64` — заархівовано всі медіа сценаріїв, жодного «media could not be archived»;
- `stdin` у `$.process.run` приймає кілька мегабайт: архів одного застосування 6.2 МБ записано через `writeText`. До `writeMedia` більше ~0.7 МБ base64 не доходить: Read перекодовує великі зображення в JPEG до ~0.5 МБ, а великий PDF віддає сторінками-JPEG, не документом.

### Phase 3 — Теги [DONE]  {#PL_CTX_P3}

**Depends on:** Phase 1 (виконується перед фазою 2, [PL_CTX_DEC_02](#PL_CTX_DEC_02))
**Implements:** [SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)–[01_11](./context_editor.structures.sp.md#SP_CTX_01_11), [02_11](./context_editor.tags.sp.md#SP_CTX_02_11)–[02_14](./context_editor.tags.sp.md#SP_CTX_02_14), заміни з тегів у [02_09](./context_editor.edits.sp.md#SP_CTX_02_09), перевірка `pin` у [02_03](./context_editor.edits.sp.md#SP_CTX_02_03) і [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), теги в [02_01](./context_editor.edits.sp.md#SP_CTX_02_01); [C_CTX_03_04](./context_editor.mechanisms.concept.md#C_CTX_03_04)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки PrepareEdits «pin», context_tag «помилки», AutoTag, QueueTagReplacements, Nudge «заміни достатньо», RebindTags; [SP_CTX_05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки про теги; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Автоматичне чищення з тегів», «Захист початкового завдання»

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

### Phase 8 — Поточна розмова, опис context_edit, архів без дубля медіа [DONE]  {#PL_CTX_P8}

**Depends on:** Phase 2 (знахідки її живих сценаріїв)
**Implements:** [SP_CTX_01_14](./context_editor.structures.sp.md#SP_CTX_01_14), [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18), [SP_CTX_DEC_07](./context_editor.sp.md#SP_CTX_DEC_07), запис межі в [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), архів [01_06](./context_editor.structures.sp.md#SP_CTX_01_06), MAX_DESCRIPTION ([01_12](./context_editor.structures.sp.md#SP_CTX_01_12))
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки CurrentRows, RecordBoundary, «архів без дубля медіа», «опис інструмента»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Перегляд після компактизації»; регрес — «Скриншот у результаті інструменту»

- `edits.ts`: `boundaryOf`, `currentRows` (чисті); `compaction.ts`: `archiveText` і запис межі через порт `CompactionIO.writeBoundary`;
- `register.ts`: одне читання поточної розмови для `context_list`, `context_edit`, тегів, закріплень і лічильника `review`; хук запису межі для компактизацій не редактора; коротший опис `context_edit`, експорт описів для тесту.
- рев'ю раунд 4: правки й теги за індексом з переліку, зробленого до зміни межі, відхиляються; межа іншого процесу не довіряється; предикат спостерігача — чиста `observedBoundary`; архів замінює лише рядки в алфавіті base64.

### Phase 9 — Передача в нову сесію [DONE]  {#PL_CTX_P9}

**Depends on:** Phase 8 (поточна розмова); спайк [context_editor_session](./context_editor_session.spike.md); [C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11), [C_CTX_DEC_12](./context_editor.concept.md#C_CTX_DEC_12), [C_CTX_DEC_13](./context_editor.concept.md#C_CTX_DEC_13)
**Implements:** [SP_CTX_01_15](./context_editor.structures.sp.md#SP_CTX_01_15), [01_16](./context_editor.structures.sp.md#SP_CTX_01_16), поле `handoff` у [01_04](./context_editor.structures.sp.md#SP_CTX_01_04), [02_19](./context_editor.handoff.sp.md#SP_CTX_02_19)–[02_24](./context_editor.handoff.sp.md#SP_CTX_02_24), skip у [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), константи [01_12](./context_editor.structures.sp.md#SP_CTX_01_12)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки BuildTranscript, CheckTranscript, CheckSwitched, context_handoff, HandleCompaction «передача в черзі», RunHandoff «запасний шлях»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Передача транскриптом», «Передача документом», «Запасний шлях», «Команда людини»; регрес — «Стиснення в межах сесії», «Перегляд після компактизації»

- `hooks/handoff.ts` (новий): `buildTranscript`, `checkTranscript`, `checkSwitched`, розбір і постановка HandoffRequest (`contextHandoff`), оркестрація `runHandoff` через порт `HandoffIO` (читання черги, CurrentRows, API-подання, пошук транскрипту, запис файлу, сховище нової сесії, `command.run`, `session.id`, `model.fork`, `prompt.submit`, тост);
- `hooks/queue.ts`: поле `handoff` у Queue, його перевірка при розборі; `hooks/compaction.ts`: skip `handoff pending`;
- `hooks/register.ts`: інструмент `context_handoff`, команда `/handoff`, запуск RunHandoff після `turn.complete` з паузою HANDOFF_DELAY, зв'язування `HandoffIO` з `$`;
- `tests/handoff.test.ts`: чисті функції й оркестрація через порт (успіх, обидва збої, повернення в стару сесію);
- живі сценарії — драйвер `ce.sh`; збирач і перевірки спайку — `.dev_flow/cache/session-transcript/`.

### Phase 10 — Один плагін, компактизація командою, передача засівом [DONE]  {#PL_CTX_P10}

**Depends on:** Phase 9; спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md) (Entries 1–4); [C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02), [C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09), [C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11)–[C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14); виконується перед фазами 4 і 5 ([PL_CTX_DEC_04](#PL_CTX_DEC_04))
**Implements:** преамбула [SP_CTX_02](./context_editor.sp.md#SP_CTX_02) (команди в черзі хоста, походження команди, лічильник ходів); [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`mediaFiles` засіву), [01_06](./context_editor.structures.sp.md#SP_CTX_01_06), [01_07](./context_editor.structures.sp.md#SP_CTX_01_07), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12), [01_15](./context_editor.structures.sp.md#SP_CTX_01_15) (`owner`, `handoffInFlight`, `handoffScheduled`, Due), вилучення [01_16](./context_editor.structures.sp.md#SP_CTX_01_16), [01_17](./context_editor.structures.sp.md#SP_CTX_01_17); [02_06](./context_editor.edits.sp.md#SP_CTX_02_06) Flush, [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), [02_12](./context_editor.tags.sp.md#SP_CTX_02_12) (копії рядків, лічильник ходів реєстру), [02_15](./context_editor.tags.sp.md#SP_CTX_02_15), [02_18](./context_editor.tags.sp.md#SP_CTX_02_18), [02_19](./context_editor.handoff.sp.md#SP_CTX_02_19)–[02_24](./context_editor.handoff.sp.md#SP_CTX_02_24), вилучення [02_25](./context_editor.handoff.sp.md#SP_CTX_02_25), [02_26](./context_editor.handoff.sp.md#SP_CTX_02_26); [03_02](./context_editor.sp.md#SP_CTX_03_02); [04_01](./context_editor.states.sp.md#SP_CTX_04_01), [04_04](./context_editor.states.sp.md#SP_CTX_04_04); [SP_CTX_DEC_04](./context_editor.sp.md#SP_CTX_DEC_04), [DEC_08](./context_editor.sp.md#SP_CTX_DEC_08), [DEC_09](./context_editor.sp.md#SP_CTX_DEC_09)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки Flush, Лічильник ходів, HandleCompaction, HandleSeed, AutoTag (копії рядків), BuildSeed, CheckSeed, CheckSeeded, PinSummary, RunHandoff, Due, HandoffCommand, context_handoff, cancelHandoff, CurrentRows «межа засіяної сесії», RecordBoundary, DeliverReport; [SP_CTX_05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) «Справжнє підсумовування не запускається через мод», «Рядки команди несуть самопояснювальну мітку, і обробник бачить її ж», «Засіяна сесія переживає відновлення»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) — обов'язкові в обох хостах: «Завершення команди після обробника», «Мітка в розмові», «Команда людини»; нові: «Стиснення в неінтерактивному хості», «Мод вимкнено», «Передача засівом (термінал)», «Передача засівом (неінтерактивний хост)», «Передача довгої сесії після `/compact`», «Запасний шлях до очищення» (в обох хостах, без документа агента — перевіряє `$.model.fork` у stream-json), «Збій засіву після очищення»; повторний прогін в обох хостах — «Стиснення в межах сесії», «Три операції», «Нагадування з початку», «Скриншот у результаті інструменту», «Незмінене медіа», «Перегляд після компактизації», «Передача документом», «Автоматичне чищення з тегів», «Захист початкового завдання»; у терміналі — «Тег за псевдонімом»; [SP_CTX_05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки «Хост відхиляє команду компактизації», «Команда чекає кінця ходу», «Разовий `claude -p "<prompt>"`», «Передача після `--resume` відредагованої сесії», «Перезавантаження модуля посеред передачі», «Рядки, повернені компактизацією, у stream-json», «Передача, коли модель бачить не всі рядки», «Передача заповненої розмови», «Хід почався в новій сесії до засіву», «Запис старої черги після засіву не вдався», «`/compact` людини з текстом HANDOFF_MARKER». Плюс механічне: `claude plugin validate`, tsc, жодної згадки `context-editor-trigger`, `editor-ready`, `$.session.compact`, `FLUSH_RETRIES` у коді

| Що | Де |
|----|----|
| Лічильник ходів основної розмови (`turns`, `inTurn`, `lastTurnAborted`), спільний для Flush, AutoTag і RunHandoff | новий `mods/context-editor/hooks/turns.ts` (чиста логіка + порт), тести `tests/turns.test.ts` |
| Flush: логіка тригера переходить у редактор, порт FlushIO, одна спроба, без перевірки готовності | новий `mods/context-editor/hooks/flush.ts`, тести `tests/flush.test.ts` (з тригера) |
| Запуск Flush з паузи після `turn.complete` (FLUSH_DELAY), `command.run('compact', MARKER)`; HandleCompaction за інструкцією (крім `precompute`); без `editor-ready` | `mods/context-editor/hooks/register.ts`, `compaction.ts`; `tests/compaction.test.ts` |
| AutoTag пропускає рядки з `origin.kind = plugin` | `tags.ts`, `register.ts`; `tests/tags.test.ts` |
| BuildSeed (повний і хвостовий режими, медіа по елементах, SEED_ROOM), CheckSeed, CheckSeeded, PinSummary, RunHandoff у новому порядку з `Deliver`, HandleSeed, `owner`/`handoffInFlight`, `/handoff` через Schedule(); HandoffIO без пошуку транскрипту, запису `.jsonl` і `/resume`; відмова команди хоста — у причинах | `mods/context-editor/hooks/handoff.ts`, `compaction.ts`, `queue.ts`, `register.ts`; `tests/handoff.test.ts` |
| Межа: власна компактизація мода — `manual` з MARKER/HANDOFF_MARKER; межа засіяної сесії | `compaction.ts` (`observedBoundary`), `edits.ts` (`currentRows`), `register.ts`; `tests/boundary.test.ts` |
| Константи (HANDOFF_MARKER, ROW_WINDOW, TRANSCRIPT_LINE, SUMMARY_OPENER, SEED_PROBE, SEED_ROOM, FLUSH_DELAY) | `queue.ts` / `handoff.ts` / `flush.ts` за місцем використання |
| Вилучення тригера | видалити `mods/context-editor-trigger/` і `scripts/check-shared.sh` |
| Документація поза `docs/` (propagate) | `CLAUDE.md` (один плагін, команди, пастки неінтерактивного хоста), кореневий `README.md` (опис тригера, команда запуску), драйвер `.dev_flow/cache/live-test/ce.sh` (один `--plugin-dir`) |
| Навичка хоста | `.dev_flow/skills/claude-code/plugin-hooks.md`: `TriggerIO` → `FlushIO` у «Key Concepts»; «Usage in This Project» без `mods/context-editor-trigger` |

Pseudocode sketch:
    ON turn start (main loop): turns += 1; inTurn = true       # команди мода подій ходу не дають (спайк Entry 4)
    ON turn complete (main loop): inTurn = false; lastTurnAborted = aborted; IF not aborted AND queue has edits AND no handoff: after FLUSH_DELAY — a turn since scheduling → no command (PERSON_MOVED: wait for the next completed turn, or reschedule if it already ended not aborted); else run /compact MARKER once (queued by the host until idle); a refusal → status line; else report + resume prompt once
    ON compaction (not precompute): instructions = MARKER → HandleCompaction; = HANDOFF_MARKER → HandleSeed; any failure → skip
    ON row appended: origin.kind = plugin → AutoTag skips it
    RunHandoff(transcript): claim (in flight, owner for diagnostics) → PrepareSeed in the old session → Moved? defer : /clear → turn check → MovedSince check → /compact HANDOFF_MARKER → CheckSeeded → HandedOff first, then registries, PinSummary, Deliver; failure before clear → document; after clear → second clear only if the seed was taken, then document or notice via Deliver; any exception → Fail / guarded AfterClear / FailAfterClear; FINALLY not in flight

Живий прогін у неінтерактивному хості — драйвер `.dev_flow/cache/handoff-long/drive.sh` (`--plugin-dir mods/context-editor`, `--model haiku`); наприкінці — повторна жива передача з VS Code (сесія розробника, розширення на актуальній версії), яка й виявила ваду.

### Phase 11 — Довіра межі, чесний звіт, реєстри після передачі [DONE]  {#PL_CTX_P11}

**Depends on:** Phase 10; спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md) Entry 6; рішення розробника 2026-10-09 ([SP_CTX_DEC_10](./context_editor.sp.md#SP_CTX_DEC_10)) і рев'ю раунд 20 (ідентичність без `ps`, зняття `host` після `/resume` у процесі); виконується перед фазами 4 і 5
**Implements:** [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`FormatReport(report, archive, kind)`, без рядка розміру при 0 правок), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (HOST_ENV), [01_14](./context_editor.structures.sp.md#SP_CTX_01_14) (`host`, `hostId`, ParseHostId), [01_17](./context_editor.structures.sp.md#SP_CTX_01_17) (`visible`, `edits`, інваріант реєстрів), [02_04](./context_editor.edits.sp.md#SP_CTX_02_04) (`apiTruncated`), [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), [02_10](./context_editor.edits.sp.md#SP_CTX_02_10) (`apiTruncated` при ≥ ROW_WINDOW − 1), [02_14](./context_editor.tags.sp.md#SP_CTX_02_14), [02_15](./context_editor.tags.sp.md#SP_CTX_02_15), [02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (`Trusted(b)`, власна межа, зняття `host` після перемикання сесії), [02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) (крок реєстрів: читання, узгодження, запис), [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22) (`charsAfter` до CarryNote і голови, WINDOW_FULL); [SP_CTX_DEC_07](./context_editor.sp.md#SP_CTX_DEC_07), [SP_CTX_DEC_10](./context_editor.sp.md#SP_CTX_DEC_10)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки: CurrentRows «гаряче перезавантаження», «перший перелік після перезавантаження», «інший процес», «межа без `host`», «власна межа без `host`», «`/resume` у тому самому процесі», «перша підготовка після завантаження», «ідентичність не прочиталась», «межа засіяної сесії»; ParseHostId «розбір»; hostId «ще не прочитано»; RecordBoundary «запис», «`host`»; HandleSeed «засів»; CollectMedia «`apiTruncated`»; ApplyEdits «правка поза вікном», «промпт перед першою парою, повне подання», «промпт перед першою парою, обрізане подання»; FormatReport «форми»; HandleCompaction «жодної правки», «правки застосовано»; BuildSeed «засів без правок», «засів з правками»; RunHandoff «теги й псевдоніми», «псевдонім зміненої пари», «тег на зміненій парі», «disposable з заміною в пакеті засіву», «збій узгодження реєстру», «незмінена пара», «пара поза засівом». [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03): «Гаряче перезавантаження (обидва хости)», «Передача засівом зі зміненою парою з псевдонімом (обидва хости)», «Відновлення сесії (лише текст)», «Відновлення сесії (медіа або злиття відповіді)». [SP_CTX_05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04): «Другий процес хоста з тією самою сесією». Живе: у сесії з компактизацією, яку хост відхилив обробником (`skip`), людина бачить рядок хоста «Not compacted · <причина>» — це мітка хоста для скасованої компактизації, а звіт мода при цьому без «tokens freed». Плюс механічне: `claude plugin test`, `claude plugin validate`, tsc (лише відомі `isDeferred`)

| Що | Де |
|----|----|
| ParseHostId (чиста функція), `hostId` — одна обіцянка на екземпляр модуля (токен HOST_ENV через `$.env.set`, `sh -c 'echo $PPID'`), `host` у Boundary, `Trusted(b)` з власною межею, `host` не рядком ігнорується, зняття `host` після перемикання сесії в процесі | `mods/context-editor/hooks/edits.ts` (ParseHostId, `currentRows`, тип Boundary, Trusted), `register.ts` (читання ідентичності — одна обіцянка з `session.start` або першого PrepareStorage; `$.env.get`/`$.env.set` приймають рядковий літерал, тож `'CONTEXT_EDITOR_HOST'` пишеться прямо у викликах, а HOST_ENV лише документує значення; `view()`, RecordBoundary, HandleSeed, PrepareStorage); `tests/boundary.test.ts` |
| `apiTruncated` у CollectMedia (≥ ROW_WINDOW − 1), умова `earlyPrompt`, WINDOW_FULL | `edits.ts`; `compaction.ts`, `handoff.ts` (виклики); `tests/edits.test.ts`, `handoff.test.ts` |
| `FormatReport(…, kind)`, `charsAfter` засіву до CarryNote і голови, звіт передачі без зайвого переносу | `edits.ts` (`formatReport`), `compaction.ts`, `handoff.ts`; `tests/edits.test.ts`, `compaction.test.ts`, `handoff.test.ts` |
| HandoffSeed `visible` і `edits`; реєстри нової сесії — читання старого, RebindTags / обрізання псевдонімів, запис нового, окремо для кожного | `handoff.ts` (крок реєстрів), `tags.ts`, `aliases.ts`, `register.ts`; `tests/handoff.test.ts` |
| Навичка й CLAUDE.md | `.dev_flow/skills/claude-code/plugin-hooks.md` — пункти 7, 30, 32–35 (32: ідентичність токеном і pid без `ps`); `CLAUDE.md` (рядок про `/clear` і межу — довіра за процесом хоста) |

### Phase 12 — Цілісна відповідь з thinking (backlog K, крок 1) [DONE]  {#PL_CTX_P12}

**Depends on:** Phase 11; Verify фази 11 («Відновлення сесії (лише текст)» з thinking — fail); спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md) Entry 5 (варіант vR — pass в обох хостах)
**Implements:** [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04) (KeepResponsesWhole на весь відрізок), [SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05) (той самий крок), [SP_CTX_03_02](./context_editor.sp.md#SP_CTX_03_02)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки ApplyEdits «одна відповідь: текст і два Read», «без перезібраного асистента у відрізку», «рядок лише з thinking», «thinking перед зміненим викликом», DropOwnCalls «службовий виклик посеред відповіді»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Відновлення сесії (лише текст)» з thinking (haiku за замовчуванням) в обох хостах і «Незмінене медіа» (регресія); `claude plugin test`, `claude plugin validate`, tsc

| Що | Де |
|----|----|
| KeepResponsesWhole: відрізок з перезібраним або вставленим рядком асистента — перезібрати всі його рядки асистента з `handle` | `mods/context-editor/hooks/edits.ts` (`rebuildSplitResponses`); `tests/edits.test.ts` |
| Навичка: правило пункту 30 | `.dev_flow/skills/claude-code/plugin-hooks.md` |

### Phase 13 — Покрокове вибіркове чищення (C_CTX_DEC_04, D) [DONE]  {#PL_CTX_P13}

**Depends on:** Phase 12; перегляд [C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04) (2026-10-09)
**Implements:** NudgeText у [SP_CTX_02_09](./context_editor.edits.sp.md#SP_CTX_02_09); порада в описі `context_edit` (обмеження довжини — [SP_CTX_02](./context_editor.sp.md#SP_CTX_02), MAX_DESCRIPTION)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) «context_list, context_edit, context_tag, context_handoff — опис інструмента» (boundary.test.ts) і Nudge «текст просить порцію» (tags.test.ts); `claude plugin test`, `claude plugin validate`, tsc; живий сценарій «Нагадування з початку» в терміналі — не виконано: нагадування за розміром прибирає фаза 14 ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)); живе чищення за D у VS Code 2026-10-09 (два нагадування, стиснуто лише опрацьоване) — єдине спостереження

| Що | Де |
|----|----|
| Текст нагадування: наступна порція опрацьованого, не вся розмова; без змін — повідомлення людини, правила й навички, робоча частина | `mods/context-editor/hooks/tags.ts` (`nudgeText`); `tests/tags.test.ts` |
| Порада в описі `context_edit` замість «one large collapse» | `mods/context-editor/hooks/register.ts` (`EDIT_DESCRIPTION`) |

### Phase 14 — Етапи і свідомий тригер оптимізації: ядро [DONE]  {#PL_CTX_P14}

**Depends on:** Phase 13; [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)–[DEC_17](./context_editor.concept.md#C_CTX_DEC_17); [SP_CTX_DEC_11](./context_editor.sp.md#SP_CTX_DEC_11)–[DEC_15](./context_editor.sp.md#SP_CTX_DEC_15); задача `.dev_flow/tasks/task_20261010_083402_stage-cleanup.md` (відкриті знахідки рев'ю 35 — «Перевірити на практиці»)
**Implements:** [SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04) (`optimize`, `optimizePrompted`), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`produced`), [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`stage`, `lastClosed`, `introduced`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (без NUDGE_*; OPTIMIZE_MARK, MESSAGES_ROW, MAX_STAGE_NAME, MAX_BLOCK_INDEXES, INTRO_TEXT, STAGE_ADVICE, SKILL), [01_17](./context_editor.structures.sp.md#SP_CTX_01_17) (`carried`), [01_18](./context_editor.structures.sp.md#SP_CTX_01_18), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20) без кандидатів за причинами, журналу і слоту стану; [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) з телеметрією, `count: 0`, `[stage ▶]`, `[block ▶]`/`[block end]`; [02_06](./context_editor.edits.sp.md#SP_CTX_02_06) (Optimize); [02_07](./context_editor.edits.sp.md#SP_CTX_02_07) (перенесення `optimize`, `optimizePrompted`; `produced`); [02_08](./context_editor.edits.sp.md#SP_CTX_02_08) (вступ, PersonAdvice, `optimizePrompted`); [02_09](./context_editor.edits.sp.md#SP_CTX_02_09) (вилучено); [02_11](./context_editor.tags.sp.md#SP_CTX_02_11) `open`/`close`; [02_13](./context_editor.tags.sp.md#SP_CTX_02_13) тригери закриття і мітки; [02_14](./context_editor.tags.sp.md#SP_CTX_02_14) RelocateMark; [02_15](./context_editor.tags.sp.md#SP_CTX_02_15), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) без нагадування; [02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (`listedKey` звітом закриття); [02_21](./context_editor.handoff.sp.md#SP_CTX_02_21), [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22) (мітки, `introduced`, `carried`); [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (вступ і навичка — лише ядро), [02_28](./context_editor.stages.sp.md#SP_CTX_02_28), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29), [02_30](./context_editor.stages.sp.md#SP_CTX_02_30); [04_05](./context_editor.states.sp.md#SP_CTX_04_05), [04_06](./context_editor.states.sp.md#SP_CTX_04_06)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки контрактів зі списку Implements (Telemetry, StageBlock, DetectOptimize, Flush/Optimize, DeliverReport, context_tag `open`/`close`, RebindTags/RelocateMark, produced, HandleCompaction зберігає `optimize`), [05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) інваріанти етапу й черги, [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) відповідні рядки; `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03): «Етап: закриття і стискання блоку», «Мітка оптимізації, stream-json», «Мітка оптимізації, термінал», «Мітка при непорожній черзі», «Людина випереджає хід оптимізації», «Інструкція на початку сесії», «Межа етапу після застосування», «Вбудована компактизація при відкритому етапі»; результати живих прогонів — у задачі етапів (знахідки «Перевірити на практиці» підтвердити або закрити)

**Результат (2026-10-10):** 304 модульні тести, validate, tsc 0; живі сценарії фази 14 — pass в обох хостах (`.dev_flow/cache/live-test/phase14-results.md`); знайдено й виправлено D1 (стискання паралельних викликів рвало пару — MergeCallRows, 02_04), D2 (телеметрія після `/compact` хоста), D3 (`~` у пораді); рев'ю коду раунд 36 — WARNINGS, виправлено. Практика: haiku етапів без вказівки не відкриває, sonnet обирає мітку — питання до фази 15 і навички.

| Що | Де |
|----|----|
| Етапи: RowMark, StartOf, MarkBefore, RelocateMark, CloseStage, BlockReport, OptimizeText, PersonAdvice, ListHint, DetectOptimize, Telemetry (чисті функції за портами) | `mods/context-editor/hooks/stages.ts` (новий); `tests/stages.test.ts` (новий) |
| Реєстр: `stage`, `lastClosed`, `introduced`; `context_tag` `open`/`close`; прибрати `nudge`, `nudgeText`, NUDGE_*; QueueTagReplacements без перевірки `listedKey` | `mods/context-editor/hooks/tags.ts`; `tests/tags.test.ts` |
| Черга: `optimize`, `optimizePrompted`; DeliverReport — вступ, PersonAdvice, скидання `optimizePrompted` | `mods/context-editor/hooks/queue.ts`; `tests/queue.test.ts` |
| Flush: Optimize, перевірка перед заміною і CAS, OPTIMIZE_* | `mods/context-editor/hooks/flush.ts`; `tests/flush.test.ts` |
| `produced` після DropOwnCalls; перенесення `optimize`/`optimizePrompted` у записах черги | `mods/context-editor/hooks/edits.ts`, `hooks/compaction.ts`; тести відповідних модулів |
| Передача: копія реєстрів з перенесеними мітками, `introduced = false`, `carried` | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| Реєстрація: опис і схема `context_tag` (`open`/`close`), опис `context_list` і `context_edit` (пріоритети MAX_DESCRIPTION), DetectOptimize у `turn.complete`, вступ у `prompt.submit`, телеметрія через `$.session.usage({ breakdown: 'summary' })`, хук `tool.call` без нагадування | `mods/context-editor/hooks/register.ts` |
| Навичка мода (ядро: етапи, мітка, телеметрія, запис етапу, повернення через архів) | `mods/context-editor/skills/context-stages/SKILL.md` (новий) |
| Живі сценарії: драйвери для мітки й етапів у терміналі і stream-json; тестові файли | `.dev_flow/cache/live-test/` (локально) |

### Phase 15 — Етапи: авторозмітка, діапазон, слот стану, журнал [DONE]  {#PL_CTX_P15}

**Depends on:** Phase 14 і її живі прогони ([PL_CTX_DEC_05](#PL_CTX_DEC_05)), Phase 16 (нотатки, RelocateNote), Phase 17 (Estimate, PersonText/PersonWarnings, `lastApply`); design sign-off 2026-10-10 — розробник: «Вся фаза 15 за спецом» (без поділу), журнал без оцінки звільненого, P13 — «Навичка + речення в звіті», навичка — «Скоротити наявні розділи», етапи в навичці — «Ні, лише опис можливості» (C_CTX_DEC_15 без змін)
**Implements:** [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`ownCallsRemoved`, речення P13 у FormatReport), [01_09](./context_editor.structures.sp.md#SP_CTX_01_09) (`state`, `reason`, діапазон; `review` без причини — `[review]`), [01_11](./context_editor.structures.sp.md#SP_CTX_01_11) (R2/R3 з причинами, R4, R5 (а); R5 (б) — за пробою), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (REPRODUCIBLE_TOOLS, WRITE_TOOLS, REPRO_FLAG, MAX_JOURNAL; INTRO_TEXT з реченням P13; STAGE_ADVICE з `~`), [01_19](./context_editor.structures.sp.md#SP_CTX_01_19) (без `freedChars`), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20) (кандидати за причинами з групою `no reason`, журнал, слот стану — рядки лише коли є що показати); [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) (`~`, `[review: причина]`/`[review]`, `[state]`, діапазон); [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (PersonTagWarnings; бюджет EDIT_DESCRIPTION)/[02_03](./context_editor.edits.sp.md#SP_CTX_02_03) (захист `state`, ScreenPinned); [02_05](./context_editor.edits.sp.md#SP_CTX_02_05) (лічильник `removed`); [02_07](./context_editor.edits.sp.md#SP_CTX_02_07) (ScreenPinned, `ownCallsRemoved`, запис журналу); [02_11](./context_editor.tags.sp.md#SP_CTX_02_11) (`state`, діапазон `disposable`, PersonTagWarnings; бюджет TAG_DESCRIPTION); [02_12](./context_editor.tags.sp.md#SP_CTX_02_12) (R5); [02_13](./context_editor.tags.sp.md#SP_CTX_02_13) (діапазон → collapse); [02_14](./context_editor.tags.sp.md#SP_CTX_02_14) (`state` після `rewrite`); [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) (R4, повторні читання); [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22) (ScreenPinned, `ownCallsRemoved`); [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (повна навичка в межах 8000 символів); [02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (рядки `Effect`, `State slot`, кандидати за причинами); [02_29](./context_editor.stages.sp.md#SP_CTX_02_29) (кандидати блоку за причинами, відтворювані пари); [02_31](./context_editor.stages.sp.md#SP_CTX_02_31); [04_03](./context_editor.states.sp.md#SP_CTX_04_03)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки цих контрактів (зокрема Journal без оцінки звільненого, Telemetry «журнал», «кандидати», «слот стану», context_list «`review` без причини», context_tag «попередження про людину», ScreenPinned, DropOwnCalls «лічильник», FormatReport «власні виклики (P13)», SessionIntro INTRO_TEXT, опис п'яти інструментів ≤ MAX_DESCRIPTION, SKILL.md ≤ 8000), [05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02), [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04); `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03): «Дублікат вставки навички» (проба, крок 2), «Застаріле читання», «Слот стану», частина зі слотом стану у «Вбудована компактизація при відкритому етапі»

Порядок перших кроків — до коду R4 і R5:
1. Діагностика R2 на копії сесії: у першому ході копії реальної сесії автоматичний `review` став на старий великий вивід (`.dev_flow/cache/live-test/fork-test-results.md`, розділ «Host, resumed or forked process»), хоча фільтр рядків з походженням плагіна (`isPluginRow`, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)) є. З'ясувати за журналом налагодження і подіями `session.append`, яким походженням і дверима прийшов рядок; виправити фільтр, якщо копії проходять його, — R5 (а) інакше позначав би копію як дублікат самої себе.
2. Проба «Дублікат вставки навички» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)): чи повторна вставка навички — рядок поточної розмови і якими дверима проходить `session.append` (сьогодні хук мода слухає лише `prompt` і `tool-result`). Рядок є — R5 (б) реалізується для названих дверей; немає — R5 (б) цілком переходить у backlog з тригером «хост почав передавати вставки навичок рядками розмови або агент скаржиться на дубльовану навичку», R5 (а) лишається; результат — у навичку plugin-hooks і SP_CTX_01_11.

Бюджети текстів для агента:
- EDIT_DESCRIPTION (2038 з 2048): пункт (4) отримує відмову для рядка `state` (≤ 100 символів); стільки ж звільняє пункт (6) — без «(context_tag close), or without stages the earliest processed or excess span» і «and the working part» ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)).
- TAG_DESCRIPTION (1769 з 2048): `state` у пункті (4) ≤ 150, діапазон `index`..`to` у пункті (2) ≤ 60, причини в пункті (5) ≤ 90; пункт (6) скорочується до «A new tag on a target replaces the old one; "remove" drops it.», пояснення `ref` у пункті (2) — до «"ref" (a call alias "cN" or "last")» ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)).
- LIST_DESCRIPTION (1179): додаються `~`, причини `[review: …]`, `[state]` і діапазон `disposable` — запас достатній.
- INTRO_TEXT: 748 → 866 символів (≤ 1000) з реченням P13.
- SKILL.md (7916 з 8000): новий зміст — розділ «State slot» (з порадою оновлювати слот разом із правками блоку), причини `review` і `[review]` без причини в «Candidates», `~` у «Compressing a block», діапазон `index`..`to` у «Dead ends», рядок `Effect` у «Telemetry» і «Restoring an original», речення P13, «нотатки — про зміст, а не про номери рядків» у «Notes» — вміщується скороченням наявних розділів: «Optimization mark» (дубль із INTRO_TEXT і OptimizeText), «Telemetry» (рядки, які пояснюють себе), приклади «Notes» і «Stages»; межа 8000 лишається ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)).

| Що | Де |
|----|----|
| Крок 1: діагностика R2 на копії сесії; за потреби — виправлення фільтра AutoTag | `mods/context-editor/hooks/tags.ts`, `hooks/register.ts`; `tests/tags.test.ts`; журнал — `.dev_flow/cache/live-test/` (локально) |
| Крок 2: проба «Дублікат вставки навички» в обох хостах | `.dev_flow/cache/live-test/` (локально); навичка plugin-hooks; SP_CTX_01_11 |
| Теги: `state`, `reason` (старі теги без причини — `[review]`), діапазон; R2–R4, R5 (а) і за пробою R5 (б); заміна діапазону — collapse; PersonTagWarnings у `context_tag` | `mods/context-editor/hooks/tags.ts`, `hooks/edits.ts`; `tests/tags.test.ts`, `tests/edits.test.ts` |
| Захист `state`: PrepareEdits і ScreenPinned (одна перевірка для застосування і засіву); `state` після `rewrite` у RebindTags | `mods/context-editor/hooks/edits.ts`, `hooks/compaction.ts`, `hooks/tags.ts`; `tests/edits.test.ts`, `tests/compaction.test.ts`, `tests/handoff.test.ts` |
| P13: лічильник DropOwnCalls, `ownCallsRemoved`, речення FormatReport | `mods/context-editor/hooks/edits.ts`, `hooks/compaction.ts`, `hooks/handoff.ts`; тести відповідних модулів |
| Журнал ефекту без оцінки звільненого: застосування, `changed`, повторні читання стиснутого й архівів | `mods/context-editor/hooks/journal.ts` (новий); `tests/journal.test.ts` (новий) |
| Перегляд і телеметрія: `~`, причини з групою `no reason`, `[state]`, рядки `Effect` і `State slot` лише коли є що показати; кандидати блоку за причинами і відтворювані пари; STAGE_ADVICE з `~` | `mods/context-editor/hooks/edits.ts`, `hooks/stages.ts`; `tests/edits.test.ts`, `tests/stages.test.ts` |
| Реєстрація: R4 і повторні читання в загальному хуку `tool.call`; двері R5 (б) у `session.append` за пробою; схема `context_tag` (`state`, `to`); описи трьох інструментів за бюджетами; INTRO_TEXT | `mods/context-editor/hooks/register.ts`, `hooks/stages.ts`; `tests/boundary.test.ts` (довжини описів) |
| Навичка мода — повна, ≤ 8000 скороченням наявних розділів | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живі сценарії: «Застаріле читання», «Слот стану», частина зі слотом стану у «Вбудована компактизація при відкритому етапі» | `.dev_flow/cache/live-test/` (локально) |

### Phase 16 — Службові нотатки агента [DONE]  {#PL_CTX_P16}

**Depends on:** Phase 14 (реєстр тегів з етапами, `produced`, Survivors, BlockReport, OptimizeText, телеметрія); [C_CTX_DEC_20](./context_editor.concept.md#C_CTX_DEC_20). Від фази 15 не залежить: інструмент окремий, опис `context_tag` не змінюється
**Implements:** [SP_CTX_01_21](./context_editor.structures.sp.md#SP_CTX_01_21), [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`notes`, `nextNote`), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`notesDropped`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (MAX_NOTES, MAX_NOTE, NOTE_PREFIX, MAX_REMIND), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20)/[02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (рядок `Notes`), [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) (`[nN]`, блок `Notes:`), [02_14](./context_editor.tags.sp.md#SP_CTX_02_14) (RelocateNote), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16)/[02_33](./context_editor.stages.sp.md#SP_CTX_02_33) (нагадування), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29) (нотатки в BlockReport, NotesHint), [02_06](./context_editor.edits.sp.md#SP_CTX_02_06)/[02_08](./context_editor.edits.sp.md#SP_CTX_02_08) (кількість нотаток у промпті), [02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) (нотатки в передачі), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (розділ навички), [02_32](./context_editor.stages.sp.md#SP_CTX_02_32), [04_07](./context_editor.states.sp.md#SP_CTX_04_07)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки context_note, NoteReminders, RebindTags (нотатки), context_list, BlockReport, OptimizeText/PersonAdvice, Telemetry (нотатки), опис п'яти інструментів ≤ MAX_DESCRIPTION; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки нотаток; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Нотатки і нагадування» в обох хостах

| Що | Де |
|----|----|
| Note, розбір і межі в реєстрі; `context_note` (чиста функція за портом TagIO); RelocateNote і `notesDropped` у rebindTags; NoteReminders | `mods/context-editor/hooks/notes.ts` (новий), `hooks/tags.ts`; `tests/notes.test.ts` (новий), `tests/tags.test.ts` |
| Перегляд: `[nN]` і блок `Notes:`; рядок звіту `Notes dropped` у FormatReport | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| Телеметрія, BlockReport, NotesHint в OptimizeText і PersonAdvice | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts` |
| Передача: нотатки в копії реєстру | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| Реєстрація: інструмент `context_note` (опис ≈ 700 символів, схема), нагадування в загальному хуку `tool.call` після рядка псевдоніма | `mods/context-editor/hooks/register.ts` |
| Навичка: розділ «Notes» з прикладами | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живий сценарій «Нотатки і нагадування»: драйвери в терміналі і stream-json | `.dev_flow/cache/live-test/` (локально) |

### Phase 17 — Знахідки прогону на копії реальної сесії [DONE]  {#PL_CTX_P17}

**Depends on:** Phase 14 (телеметрія, BlockReport, STAGE_ADVICE), Phase 16 (нотатки, NoteReminders); [C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21); результати прогону `.dev_flow/cache/live-test/fork-test-results.md`; пропозиції P11–P12 задачі `.dev_flow/tasks/task_20261010_083402_stage-cleanup.md`
**Implements:** [SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34) і [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`charsPerToken`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (CALIB_*, PERSON_TOOLS, MAX_FULL_ROW, STAGE_ADVICE), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (Estimate у звіті), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20)/[02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (кандидати з рядками, `ratio`), [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) (один розмір, `index` + `full`, `Notes elsewhere`), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (PersonWarnings, EDIT_DESCRIPTION), [02_13](./context_editor.tags.sp.md#SP_CTX_02_13), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29) (Estimate), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16)/[02_33](./context_editor.stages.sp.md#SP_CTX_02_33)/[02_32](./context_editor.stages.sp.md#SP_CTX_02_32) (нагадування після інструментів мода), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (навичка: P11, P12, нагадування)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки Calibrate, Estimate, HandleCompaction (звіт з відношенням), context_list (один розмір, повний рядок, нотатки поза сторінкою), Telemetry (кандидати з рядками), context_edit (повідомлення людини), NoteReminders (після інструмента мода), опис інструментів ≤ MAX_DESCRIPTION; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки калібрування й повідомлень людини; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Повтор на копії сесії» в обох хостах (телеметрія один раз показує виміряне звільнення `Last apply`; число звіту позначено як оцінку)

| Що | Де |
|----|----|
| Calibrate, Estimate; `charsPerToken` у реєстрі; оцінки телеметрії, блоку, етапу, журналу; кандидати з рядками | `mods/context-editor/hooks/stages.ts`, `hooks/tags.ts`; `tests/stages.test.ts`, `tests/tags.test.ts` |
| Один розмір у заголовку переліку, `index` + `full`, `Notes elsewhere`; Estimate у звіті застосування (FormatReport з відношенням); PersonWarnings | `mods/context-editor/hooks/edits.ts`, `hooks/queue.ts`; `tests/edits.test.ts`, `tests/queue.test.ts` |
| Відношення в обробнику компактизації і BuildSeed (з реєстру, без телеметрії) | `mods/context-editor/hooks/compaction.ts`, `hooks/handoff.ts`; тести відповідних модулів |
| Нагадування після інструментів мода | `mods/context-editor/hooks/notes.ts`, `hooks/register.ts`; `tests/notes.test.ts` |
| Описи `context_list`, `context_edit`, `context_note` (EDIT — пріоритети MAX_DESCRIPTION); схема `context_list` (`index`, `full`) | `mods/context-editor/hooks/register.ts` |
| STAGE_ADVICE і навичка: дослівні цитати людини, причини відмови, AskUserQuestion — повідомлення людини, нагадування після будь-якого інструменту | `mods/context-editor/hooks/stages.ts`, `skills/context-stages/SKILL.md` |
| Живий сценарій «Повтор на копії сесії»: драйвер копії сесії (stream-json і термінал) | `.dev_flow/cache/live-test/` (локально) |

### Phase 18 — Дрібні знахідки практики [DONE]  {#PL_CTX_P18}

**Depends on:** Phase 14 (хід оптимізації, OptimizeText, `optimizePrompted`), Phase 15 (P13 у звіті, `produced` після DropOwnCalls), Phase 17; [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16) — C, рішення розробника 2026-10-10; пункти backlog «Текст відмови `INDEXES_STALE`» і «Індекси у звіті застосування» (живий прогін фази 15, `.dev_flow/cache/live-test/phase15-results.md`); пропозиція P15 задачі `.dev_flow/tasks/task_20261010_083402_stage-cleanup.md` (практика 1, `.dev_flow/cache/practice/manim-c376ec30.jsonl`)
**Implements:** (1) текст STALE_INDEXES — [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (відмова INDEXES_STALE у `context_edit`, `context_tag`, `context_note`); (2) NowIndex у FormatReport — [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (компактизація і засів); (3) продовження після ходу оптимізації за [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16) — [01_04](./context_editor.structures.sp.md#SP_CTX_01_04), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [02_06](./context_editor.edits.sp.md#SP_CTX_02_06), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27), [02_29](./context_editor.stages.sp.md#SP_CTX_02_29), [04_06](./context_editor.states.sp.md#SP_CTX_04_06)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки PrepareEdits/context_tag/context_note «текст відмови після `count: 0`», FormatReport «NowIndex» і «NowIndex без запису», HandleCompaction «NowIndex після DropOwnCalls», BuildSeed «NowIndex у засіві», context_edit «хід оптимізації без `resume`», «з продовженням», «другий виклик», «поза ходом оптимізації», OptimizeText «без індексів» (нове речення), Flush «хід оптимізації без пакета» / «після пакета»; SKILL.md ≤ 8000 символів, опис інструментів ≤ MAX_DESCRIPTION (EDIT_DESCRIPTION не змінюється); `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Хід оптимізації після завершеного завдання» у stream-json (драйвер практики з FIFO): після пакета ходу оптимізації без `resume` — жодного промпту мода, промпт людини несе лише звіт, звіт з `(now #k)` збігається з переліком; другий прогін з `"resume": true` — промпт продовження надіслано

| Що | Де |
|----|----|
| STALE_INDEXES: «call context_list with rows (count > 0) for current indexes — count 0 shows telemetry only» | `mods/context-editor/hooks/edits.ts` (константа, спільна для `context_edit`, `context_tag`, `context_note`); `tests/boundary.test.ts` (застарілі індекси в правках і тегах), `tests/notes.test.ts` |
| NowIndex: суфікс ` (now #k)` з `report.produced` у `formatReport`; `report.applied` без змін | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` (FormatReport), `tests/compaction.test.ts` (після DropOwnCalls), `tests/handoff.test.ts` (засів) |
| Продовження в ході оптимізації: поле `resumeSet`, правило `resume` у `queueEdits` за `optimizePrompted`, `resumeSet` і `resume_prompt`; речення зупинки в `queuedText` | `mods/context-editor/hooks/queue.ts`; `tests/queue.test.ts` |
| Заміна Flush скидає продовження пакета, що лишився в черзі (`swapOptimize`) | `mods/context-editor/hooks/flush.ts`; `tests/flush.test.ts` |
| EDIT_DESCRIPTION: виняток ходу оптимізації (≤ 2048) | `mods/context-editor/hooks/register.ts`; `tests/boundary.test.ts` |
| Останнє речення OptimizeText | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts`, `tests/flush.test.ts` (тексти промпту ходу оптимізації) |
| Рядок навички «Optimization mark» (≤ 8000 символів, зараз 7987) | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живий сценарій: драйвер практики (FIFO, зупинка файлом `stop`) з коротким завданням і промптом людини після простою | `.dev_flow/cache/practice/` (локально) |

Розбір P15 (2026-10-10, практика 1): поведінка мода в прогоні збігалася зі специфікацією. Агент у ході оптимізації передав `"resume": false` (порада OptimizeText), тож обробник записав `reportResume = false`, Flush після компактизації нічого не надіслав, і процес простоював без очікування чогось; `resume: true` і `resumePrompt` у `pending.json` — значення за замовчуванням для наступного пакета, а DeliverReport віддав би наступному промпту людини лише звіт, без тексту продовження. Хибне «Continue the task from where you stopped.» прийшло б лише тоді, коли агент у ході оптимізації не передав би `resume`; пункт (3) прибирає саме цей випадок (подробиці й варіанти — [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16)).

Стан 2026-10-10: живий сценарій пройдено; рев'ю 46 (WARNINGS) виправлено — `resumeSet`, скидання пакета, що лишився, у заміні Flush, речення зупинки в `queuedText`, EDIT_DESCRIPTION 2045/2048, навичка 7991 символ (7997 байтів), 434 тести. До рев'ю: код і модульні тести готові (431 тест, було 422; `claude plugin validate` і tsc проходять; навичка 7987 символів, EDIT_DESCRIPTION без змін). Живий сценарій 05_03 тоді ще не запускався. Відхилення від таблиці файлів: тест засіву — без голови-підсумку (індекс з `produced`, 05_01 уточнено); у навичці друге речення рядка скорочено до «Mid-work, close the stage with the tool.», щоб файл лишився ≤ 8000 байтів.

### Phase 19 — Хто написав заміну (F1 фази 18) [DONE]  {#PL_CTX_P19}

**Depends on:** Phase 18; [SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17) — A′, рішення розробника 2026-10-11; пункт backlog «Агент не впізнає власних підсумків» (живий прогін фази 18, F1, `.dev_flow/cache/live-test/phase18-results.md`)
**Implements:** [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04) (тексти замін з автором і часом: `you read the full output here, then replaced it with your summary`, `you read these <n> rows, then collapsed them into your note`, `you rewrote this row`, `you saw the media here, then replaced it with your description`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (MARK — розпізнавання лише за префіксом)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки ApplyEdits «хто написав заміну», QueueTagReplacements «заміна з тегу називає автора», наявні рядки з текстами замін (NowIndex, RebindTags зі слотом стану, describe) з новими словами; EDIT_DESCRIPTION, SKILL.md і INTRO_TEXT не змінюються; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Хто написав підсумки» (stream-json, драйвер фази 18, haiku). Не пройде — спайк «підсумок власним рядком асистента після заглушки результату» (backlog)

| Що | Де |
|----|----|
| Шаблони текстів чотирьох замін у `applyEdits`; MARK, CarryNote і рядок псевдоніма без змін | `mods/context-editor/hooks/edits.ts` |
| Тести з текстами замін: `toBe` і `startsWith` з повним текстом, а також `toContain` зі старими словами (`summarized`, `rows collapsed`, `rewritten`, `media replaced`) — усі на тексти A′ | `mods/context-editor/tests/edits.test.ts`, `tests/media.test.ts`, `tests/compaction.test.ts`, `tests/handoff.test.ts`, `tests/tags.test.ts` |
| Живий сценарій «Хто написав підсумки»: сценарій 1 фази 18 і промпт «What did you do?» | `.dev_flow/cache/live-test/phase18/` (драйвер), результат — `.dev_flow/cache/live-test/phase19-results.md` (локально) |

Стан 2026-10-11: код і модульні тести готові (436 тестів після фази 19; тексти — константи `SUMMARIZED`, `REWRITTEN`, `DESCRIBED`, `collapsedWords` у `edits.ts`); живий сценарій — далі. EDIT_DESCRIPTION, SKILL.md і INTRO_TEXT не змінено.

P16 (читання через `Bash`) у фазу не входить: [SP_CTX_DEC_18](./context_editor.sp.md#SP_CTX_DEC_18) = A, лише спостерігати (пункт backlog нижче).

### Phase 20 — Доставки хоста посеред ходу [DONE]  {#PL_CTX_P20}

**Depends on:** Phase 5 (PromptMatch, PROMPT_DECORATIONS), Phase 17 (PersonText, PersonWarnings), Phase 18 (Produced, NowIndex); Phase 19 — не за змістом, а за файлами (обидві змінюють `edits.ts` і тести текстів замін: спершу 19); [SP_CTX_DEC_19](./context_editor.sp.md#SP_CTX_DEC_19) = A, рішення розробника 2026-10-11 (R1 спайку, R2 — backlog); спайк [context_editor_attachments](./context_editor_attachments.spike.md); навичка plugin-hooks, пункти 6, 24, 43–45
**Implements:** [SP_CTX_01_22](./context_editor.structures.sp.md#SP_CTX_01_22) (QueuedDelivery, `deliveries.json`), [01_07](./context_editor.structures.sp.md#SP_CTX_01_07), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (MAX_DELIVERIES, MAX_DELIVERY_TEXT, DELIVERY_FRAMES, PROMPT_DECORATIONS з `<system-reminder`), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`deliveries`, речення звіту, `charsAfter` без вставлених рядків), [02_35](./context_editor.stages.sp.md#SP_CTX_02_35) RecordDelivery і зв'язування в [02_12](./context_editor.tags.sp.md#SP_CTX_02_12), [02_36](./context_editor.stages.sp.md#SP_CTX_02_36) InsertDeliveries, [02_04](./context_editor.edits.sp.md#SP_CTX_02_04) (`renamed`), [02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (PersonText з рамками доставок, PersonDelivered у PersonWarnings і PersonTagWarnings), [02_10](./context_editor.edits.sp.md#SP_CTX_02_10)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки RecordDelivery, DeliveryKind, InsertDeliveries, HandleCompaction «доставка за службовим викликом», «звіт і розмір з доставками», «файл доставок після застосування», «нечитабельний файл доставок», BuildSeed «доставки в засіві», PersonText «вставлені доставки», PersonWarnings «доставка від людини», PromptMatch «вставлена доставка»; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки доставок; `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Доставки посеред ходу» в обох хостах (повідомлення людини, фоновий субагент і фонова задача, паралельні виклики) і «Доставка в передачі» у stream-json; «Доставка після `--resume`» — за можливості

| Що | Де |
|----|----|
| QueuedDelivery: розбір, стани читання, межі MAX_DELIVERIES / MAX_DELIVERY_TEXT / MAX_QUEUE_BYTES; DeliveryKind; RecordDelivery за портом (читання, перенос, запис) з перевіркою копії; InsertDeliveries | `mods/context-editor/hooks/deliveries.ts` (новий, чистий); `tests/deliveries.test.ts` (новий) |
| `renamed` з `applyEdits`; речення доставок у FormatReport | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| HandleCompaction: читання файлу, InsertDeliveries до DropOwnCalls, `charsAfter` без вставлених, видалення записів `done` у фоні | `mods/context-editor/hooks/compaction.ts`; `tests/compaction.test.ts` |
| BuildSeed (вхід `deliveries`, вставка з `allRebuilt`), prepareSeed (читання файлу старої сесії); передача файл не переносить | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| PersonText (рамки DELIVERY_FRAMES, `<system-reminder …>` з атрибутами), PersonDelivered у PersonWarnings і PersonTagWarnings; читання файлу в `context_edit` і `context_tag` | `mods/context-editor/hooks/queue.ts`, `hooks/tags.ts`; `tests/queue.test.ts`, `tests/tags.test.ts` |
| PROMPT_DECORATIONS: `<system-reminder` без `>` | `mods/context-editor/hooks/media.ts`; `tests/media.test.ts` |
| Зв'язування: `lastAnchor` і двері `tool-result` / `prompt` / `response` / `delivery` у хуку `session.append`, серійний ланцюжок `deliveries`, файл `deliveries.json` і перенос `.bad-<ms>`, порти для HandleCompaction (`readDeliveries`, `pruneDeliveries`), HandoffIO (`readDeliveries`), TagIO (`deliveries`) і `context_edit` | `mods/context-editor/hooks/register.ts` |
| Живі сценарії: драйвери за зразком `scen1.sh`, `scen2.sh` спайку (термінал і stream-json), передача | `.dev_flow/cache/live-test/` (локально) |
| Навичка plugin-hooks: що покажуть живі сценарії (паралельні виклики з доставкою, `--resume`) | `.dev_flow/skills/claude-code/plugin-hooks.md` |

Стан 2026-10-11: код і модульні тести готові (463 тести після рев'ю 48, було 434; `claude plugin validate` і tsc проходять); живі сценарії 05_03 — далі. Відхилень від таблиці файлів немає, крім спільного файлу фікстур `tests/delivery-fixtures.ts` (тексти доставок для `deliveries.test.ts` і `queue.test.ts`).

Ризики, які перевіряє Verify: (1) припущення, що доставка йде після останнього результату відповіді (KeepResponsesWhole вважає вставлений рядок промптом) — сценарій з паралельними викликами, журнал без `ensureToolResultPairing`; (2) рамки DELIVERY_FRAMES — тексти хоста, що можуть змінитися з версією: тоді клас `other`, доставка все одно вставляється, але повідомлення людини втрачає попередження; (3) у stream-json копії доставок після компактизації — перевірка пари (`text`, `anchor`).

### Phase 21 — ref "last" [DONE]  {#PL_CTX_P21}

**Depends on:** Phase 7 (псевдоніми), Phase 15 (`callId` і рядок-носій у `context_tag`), Phase 16 (`context_note`), Phase 20 (живий прогін, s5 — `.dev_flow/cache/live-test/phase20-results.md`, F1); [SP_CTX_DEC_20](./context_editor.sp.md#SP_CTX_DEC_20) = A + C, рішення розробника 2026-10-11
**Implements:** [SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17) (ResolveRef з рядками і `callId`, ResolveLast, рядок `"last" = <CallLabel>`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (LAST_TEXTS), [01_13](./context_editor.structures.sp.md#SP_CTX_01_13) (без поля `last`; старий файл читається), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) (MarkCall без `last`), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (`callId`, вихід, EDIT_DESCRIPTION пункт (3), опис поля `ref`), [02_03](./context_editor.edits.sp.md#SP_CTX_02_03) (причини LAST_NONE / LAST_PENDING), [02_11](./context_editor.tags.sp.md#SP_CTX_02_11) і [02_32](./context_editor.stages.sp.md#SP_CTX_02_32) (ResolveRef з рядками, `callId` у `context_note`, рядок `last` у виході, текст UNKNOWN_REF)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки MarkCall «великий вивід», ResolveRef, context_tag «ціль за `ref`», ResolveLast (малий виклик після позначеного, власні виклики, паралельні виклики, виклик тієї самої відповіді з результатом і без, виклики після свого, немає виклику, без `callId`, реєстр нечитабельний чи старий), EDIT_DESCRIPTION «`last`»; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки `ref: "last"`; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «`ref: "last"` після малого виклику» у stream-json: (а) відтворення s5 фази 20 — процес 1 `sleep 14; cat big.log` (`c1`), процес 2 `-p --resume`, `cat c.log`, summarize з `"ref":"last"` — замінено `c.log`, `big.log` незмінний, у результаті `context_edit` рядок `"last" = Bash … cat c.log`; (б) те саме в одному процесі з `context_note` перед `context_edit`. SKILL.md (7991 з 8000) і INTRO_TEXT не змінюються: приклад `{"notes":[{"op":"add","ref":"last",…}]}` у навичці за A стає точнішим

| Що | Де |
|----|----|
| ResolveLast і CallLabel (чисті), ResolveRef з рядками і `callId`, що повертає id з рядком або причину; AliasRegistry без `last` (`addAlias`, `pruneAliases`, `parseAliases` ігнорує старе поле) | `mods/context-editor/hooks/aliases.ts`; `tests/aliases.test.ts` |
| Тип RefResolver з причиною відмови, `resolveEditRefs` і `refError` з причиною ResolveLast; CallLabel — спільний з переліком запис виклику (`oneLine`, 70 символів) | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| `contextEdit` / `queueEdits` з `callId`, рядок `"last" = …` у `queuedText` | `mods/context-editor/hooks/queue.ts`; `tests/queue.test.ts` |
| `context_tag` і `context_note`: розв'язання за рядками (вже прочитаними в обробнику) і `callId`, рядок `last` у результаті, причина в UNKNOWN_REF | `mods/context-editor/hooks/tags.ts`, `hooks/notes.ts`; `tests/tags.test.ts`, `tests/notes.test.ts` |
| Зв'язування: `resolver` з рядками і `e.tool_use_id` для `context_edit` і `context_note`; EDIT_DESCRIPTION пункт (3) (2035 з 2048), описи поля `ref` у схемах `context_edit` і `context_tag` | `mods/context-editor/hooks/register.ts`; `tests/boundary.test.ts` (довжини описів), тести з `ref: 'last'` у `tests/handoff.test.ts`, `tests/media.test.ts` — перевірити |
| Живий сценарій: драйвер фази 20 і фікстури | `.dev_flow/cache/live-test/phase20/` (основа), результат — `.dev_flow/cache/live-test/phase21-results.md` (локально) |

Стан 2026-10-11: код і модульні тести готові (473 тести, було 463; `claude plugin validate` і tsc проходять; EDIT_DESCRIPTION 2035, TAG_DESCRIPTION 1891 з 2048; SKILL.md 7991 з 8000 — без змін); живий сценарій 05_03 — далі. Відхилення від таблиці файлів: `hooks/register.ts` без нового модуля — `resolver($, callId)` лише зв'язує; тести ResolveLast — у `tests/aliases.test.ts`, рядок `last` у результатах — у `tests/queue.test.ts`, `tests/notes.test.ts`, EDIT_DESCRIPTION — у `tests/boundary.test.ts`; `tests/edits.test.ts` і `tests/tags.test.ts` змін не потребували, `tests/media.test.ts` `ref: 'last'` не має (збіг слова), `tests/handoff.test.ts` — лише новий підпис `resolveEditRefs` / `refResolver`. Рев'ю 50 (PASS з побажаннями) і живий сценарій 05_03 — pass в обох варіантах (`.dev_flow/cache/live-test/phase21-results.md`): LAST_ORPHAN для виклику без результату, відділеного рядком промпту (процес убито посеред інструмента, далі `--resume`) — інакше LAST_PENDING назавжди просив би чекати; опис поля `ref` у схемах — `your latest call (context_* calls do not count)`; `callLabel` перенесено в `hooks/edits.ts` і перелік (`listRows`) друкує виклик ним же (REPRO_FLAG — параметром); 474 тести. Причина відмови `ref` у `context_edit` переходить від `resolveEditRefs` до `checkShape` символом на сирій правці (не полем, яке може надіслати агент).

Ризик, який перевіряє Verify: рядок поточного виклику `context_*` є в `$.session.messages()` посеред ходу (навичка plugin-hooks, пункт 52; в обох хостах — `.dev_flow/cache/live-test/phase14-results.md`, пункт d: `context_list` лічить і власний рядок виклику, `e.tool_use_id` є в `context_tag`) — інакше carrier = кінець рядків, і виклик тієї самої відповіді без результату дасть LAST_PENDING лише тоді, коли його рядок уже записано; сценарій (б) і модульний рядок «без `callId`» це покривають.

### Phase 22 — М'яке нагадування [DONE]  {#PL_CTX_P22}

**Depends on:** Phase 7 (псевдоніми), Phase 14 (телеметрія, MESSAGES_ROW), Phase 15 (причини `review`, WRITE_TOOLS), Phase 17 (калібрування); [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15) = E і [SP_CTX_DEC_21](./context_editor.sp.md#SP_CTX_DEC_21) = C, рішення розробника 2026-10-11 («Розмір + межа етапу»; мета — «збільшення часу якісної роботи агента над складним завданням в одній сесії без ситуації повного заповнення контексту»); практика 3 (P18, P19 задачі етапів; `.dev_flow/cache/practice/`)
**Implements:** [SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37) SoftHint (Candidates, HintText, Bounded), [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (поле `hint`), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (HINT_CONVERSATION, HINT_CANDIDATES, HINT_STEP, HINT_RUN, HINT_NAMES, HINT_RECHECK, HINT_WAIT; INTRO_TEXT), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) (MarkAlias, злитий рядок), [02_09](./context_editor.edits.sp.md#SP_CTX_02_09), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (навичка: речення в «Telemetry», без речення про `[review]` без причини), [02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (Telemetry без `lastApply` для нагадування)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки SoftHint (розмір: перше нагадування, малий запит, крок, мало кандидатів, мала розмова, lastApply лишається, без псевдоніма, назви, межа етапу, межа етапу без розміру, межа етапу без кандидатів, зменшення, реєстри, без відповіді моделі, паралельний виклик, запис після зменшення, запізнення, одна перевірка за раз), Candidates, Bounded, HintText, HintCall і PickLine, TagRegistry «поле `hint`», MarkCall «злитий рядок» і «без нагадувань», SessionIntro «INTRO_TEXT»; [05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) «М'яке нагадування нічого не запускає і не дублюється»; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки м'якого нагадування; `claude plugin test`, `claude plugin validate`, tsc; бюджети: SKILL.md ≤ 8000 (7953), INTRO_TEXT ≤ 1000 (944), описи інструментів без змін (EDIT_DESCRIPTION 2035 з 2048); живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «М'яке нагадування (stream-json, opus)» — повтор дослідження практики 3 з тим самим промптом, порівняння з практикою 3

| Що | Де |
|----|----|
| SoftHint через порт HintIO (дешеві пороги, рядки й черга, розбивка лише за розміром, порівняння-і-запис стану, одна перевірка за раз), Candidates, HintText, Bounded, HintCall, PickLine, константи HINT_* | `mods/context-editor/hooks/hints.ts` (новий, чистий); `tests/hints.test.ts` (новий) |
| Поле `hint` реєстру тегів: тип HintState, розбір | `mods/context-editor/hooks/tags.ts`; `tests/hints.test.ts` |
| MarkAlias (псевдонім без рядка), MarkCall — обгортка | `mods/context-editor/hooks/aliases.ts` |
| INTRO_TEXT: речення про нагадування замість «Nothing reminds you by size» | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts` |
| Зв'язування: `hintIO` (звичайна `usage`, розбивка, калібрування у фоні, стан на ланцюжку реєстру), `hintFor` з HINT_WAIT, хук `tool.call` через HintCall і PickLine; пам'ять `checked`, `busy` | `mods/context-editor/hooks/register.ts` |
| Навичка: речення в «Telemetry», скорочення інших розділів | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живий сценарій: драйвер практики 3, модель opus | `.dev_flow/cache/practice/` (локально) |

Стан 2026-10-11: код і модульні тести готові (494 тести, було 474; `claude plugin validate` і tsc проходять). Рев'ю 52 (WARNINGS) виправлено: `busy` і гальмування після запізнілої перевірки, запис після зменшення контексту, HintCall і PickLine, тексти «(see context_list)» і «up to»; 498 тестів. Живий сценарій 05_03 — далі.

Ризики, які перевіряє Verify: (1) агент і далі не зважує рядок (P18 повторюється) — тоді рядок лише шум, і рішення повертається до розробника (C_CTX_DEC_15); (2) пороги — перші значення розробника, а не виміряні: у дослідженні з великими WebFetch рядок за розміром може прийти рано або пізно, а межа етапу — лише після запису, а не перед ним (мод не бачить наміру писати); (3) ціна на гарячому шляху: рядки розмови читаються на кожному позначеному виводі, поки запит понад поріг, а кандидатів мало (обмежено HINT_RECHECK), — живий журнал покаже, чи результати не затримуються; (4) у довгому ході правки агента застосовуються лише в його кінці: кандидати без поставлених у чергу, але розмір контексту до кінця ходу не зменшується, тож наступне нагадування за розміром прийде за кроком росту.

### Phase 23 — Кеш промпту при застосуванні і нагадування з вердиктом [DONE]  {#PL_CTX_P23}

**Depends on:** Phase 12 (KeepResponsesWhole), Phase 14 (MergeCallRows, телеметрія), Phase 20 (InsertDeliveries), Phase 22 (SoftHint); спайки [context_editor_cache](./context_editor_cache.spike.md) (вікно пошуку кешу API ~20 позицій; мод сам зсував першу зміну) і [context_editor_efficiency](./context_editor_efficiency.spike.md) (модель ціни, правило беззбитковості, пороги); практика 5 (P22 задачі етапів); рішення розробника 2026-10-11 «Усе разом: пункти 1–3» (мета — «збільшення часу якісної роботи агента над складним завданням в одній сесії без ситуації повного заповнення контексту»)
**Implements:** [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04) FrozenPrefix і ResponseStart, [02_05](./context_editor.edits.sp.md#SP_CTX_02_05) (власні пари префікса), [02_07](./context_editor.edits.sp.md#SP_CTX_02_07) (`freeze` з API-поданням), [02_36](./context_editor.stages.sp.md#SP_CTX_02_36) (доставки за рядками префікса), [02_38](./context_editor.stages.sp.md#SP_CTX_02_38) CacheCost (нова), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20) і [02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (рядок `Cache`), [02_37](./context_editor.stages.sp.md#SP_CTX_02_37) SoftHint і TurnSuggestion, [02_08](./context_editor.edits.sp.md#SP_CTX_02_08) (пропозиція з промптом людини), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) (окремий рядок), [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (SUGGESTION, HINT_*, CACHE_LOOKBACK, COST_WRITE, COST_OUT, VERDICT_MARGIN, SUMMARY_*; INTRO_TEXT), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (навичка); [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22), [SP_CTX_DEC_23](./context_editor.sp.md#SP_CTX_DEC_23), перегляд [SP_CTX_DEC_02](./context_editor.sp.md#SP_CTX_DEC_02); [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15) (E, фаза 23)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки фази 23: ResponseStart (відповідь, паралельні виклики), ApplyEdits (заморожений префікс, без заморожування, найраніша правка, collapse і rewrite з префіксом), HandleCompaction (заморожений префікс, префікс без API-повідомлень), Positions, ResponseStartRows, LookbackStart, CacheCost, Requests, BreakEven, Verdict, Summary, Telemetry «рядок Cache», SoftHint (розмір, вигідно; глибоко; невигідно; вікно; малий пакет і змінені рядки фази 22), TurnSuggestion (межа ходу, коротка серія, невигідно, без кандидатів), Candidates, Propose, SuggestionText, DeliverReport «пропозиція», MarkCall «окремий рядок» і «без пропозицій», SessionIntro «INTRO_TEXT»; [05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) «Префікс до першої зміни незмінний», «М'яке нагадування нічого не запускає і не дублюється»; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки фази 23; `claude plugin test` (528 тестів, було 498), `claude plugin validate`, tsc; бюджети: INTRO_TEXT ≤ 1000 (968), SKILL.md ≤ 8000 (7982), EDIT_DESCRIPTION 2029 з 2048 (поле `keep_cache` пояснює опис поля); живі сценарії [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Кеш після застосування» (обидва хости, проксі-журнал: `cache_read_input_tokens` першого запиту після неглибокої і глибокої правки), «Відновлення після застосування із замороженим префіксом», «Пропозиція з вердиктом (stream-json, opus)»

| Що | Де |
|----|----|
| FrozenPrefix: `freeze` у ApplyEdits, `prefix` у виході; ResponseStart за API-поданням із запасною межею відрізка; KeepResponsesWhole, MergeCallRows і DropOwnCalls не чіпають рядків префікса | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| HandleCompaction: `freeze` з тим самим читанням API, що й CollectMedia; `frozen` для `goes` InsertDeliveries і DropOwnCalls | `mods/context-editor/hooks/compaction.ts`; `tests/compaction.test.ts` |
| CacheCost: Positions, ResponseStartRows, LookbackStart, CacheCost, Requests, Summary, BreakEven, Verdict, константи CACHE_LOOKBACK, COST_*, VERDICT_MARGIN, SUMMARY_* | `mods/context-editor/hooks/cache.ts` (новий, чистий); `tests/cache.test.ts` (новий) |
| Рядок `Cache` телеметрії (поле `cache`); INTRO_TEXT (975) | `mods/context-editor/hooks/stages.ts`; `tests/cache.test.ts`, `tests/stages.test.ts` |
| SoftHint (канал розміру) і TurnSuggestion (канал ходу), Candidates з відтворюваністю, Propose, SuggestionText, пороги Threshold/Step від вікна, пакет HINT_BATCH; без HintCall, PickLine і запису файлу як тригера | `mods/context-editor/hooks/hints.ts`; `tests/hints.test.ts` (переписано) |
| DeliverReport: порт `suggestion` між ходами без `optimize` | `mods/context-editor/hooks/queue.ts`; `tests/queue.test.ts` |
| Зв'язування: рядок псевдоніма і окремий рядок пропозиції в хуку `tool.call`; `suggestionFor` з HINT_WAIT у `prompt.submit` | `mods/context-editor/hooks/register.ts` |
| Навичка: кеш за вікном, власні виклики від найранішої правки, рядок пропозиції, слот стану; скорочено рядок `Tools:` і пункт `[pin]` | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живі сценарії: драйвери спайку кешу з проксі-журналом (`.dev_flow/cache/cache-spike/`), драйвер практики 3 | `.dev_flow/cache/` (локально) |

Стан 2026-10-11: код і модульні тести готові (519 тестів, було 498; `claude plugin validate` і tsc проходять). Рев'ю 54 (WARNINGS) виправлено: глибина за кінцем ходу (APPLY_MARGIN, канал ходу — глибоко), CostRatios за родиною моделі з опублікованих цін, Responses за API-поданням для паралельних викликів, CallLines, канал ходу не повторює лишеного пакета (`proposed`); 525 тестів. Живі сценарії 05_03 — далі.

Живий прогін 2026-10-11 (`.dev_flow/cache/live-test/phase23-results.md`, haiku, обидва хости): кеш після неглибокого застосування зберігся (читання 97 410 проти 69 697; термінал 122 898), глибоке — `tools + system` (69 693), межа CACHE_LOOKBACK підтверджена, обидва канали пропозиції з'явились з вердиктами; але `--resume` після неглибокого застосування дублює кожну відповідь замороженого префікса (68 рядків замість 34). Рішення розробника: «Роби, як вважаєш за потрібне. Але які опції використовувати, повинен вирішувати сам ai-агент.» — заморожений префікс став вибором агента (`keep_cache` у `context_edit`, типово вимкнено: перезбирання як до фази 23, чисте відновлення); ціна за замовчуванням — уся розмова, пропозиція називає `keep_cache`, лише коли той змінює вердикт; 528 тестів. Повтор відновлення з `keep_cache` і без нього — далі.

Ризики, які перевіряє Verify: (1) `--resume` після застосування з `keep_cache` дублює відповіді префікса (виміряно; відомий компроміс, який опис поля називає агенту) — без нього чисто; агент може обирати поле, не зважуючи відновлення; (2) межа вікна — оцінка за рядками: вкладення промпту, доставки й кілька блоків thinking одного рядка невидимі, тож рядок `Cache` і `within` пропозиції біля межі оптимістичні на кілька позицій, а глибина міряється до кінця ходу, у якому правку застосують; (3) ResponseStart залежить від API-подання: текст відповіді, що збігається з текстом раннішої (напр. «Done.»), може відсунути межу назад — лише дорожче, не небезпечніше; поза вікном API — поведінка до фази 23; (4) власні виклики `context_*` до першої зміни лишаються в розмові — більше рядків, ніж до фази 23, і агент бачить свої давні `context_list`; (5) R̂ — відповіді в поточних рядках: після згортання етапу чи передачі він менший, тож вердикт консервативніший; (6) канал ходу додає до кожного промпту людини між ходами два читання реєстрів, а раз на серію — рядки й розбивку (до HINT_WAIT); (7) пороги і вердикт — з моделі на двох слідах; живий сценарій «Пропозиція з вердиктом» покаже, чи агент діє за ними; (8) відношення цін — опубліковані за родиною моделі, а калібрування спайку ефективності за `costUSD` хоста для Sonnet дало вдвічі дешевше читання кешу — розбіжність відкрита (спайк, «Unverified»), невідома модель отримує найбільші відношення; (9) глибина міряється зараз, а застосування — в кінці ходу: APPLY_MARGIN (10 позицій) — припущення про кілька викликів до кінця ходу, живий сценарій «Кеш після застосування» має його перевірити.

### Phase 24 — Застарілі вкладення хоста після застосувань [DONE]  {#PL_CTX_P24}

**Depends on:** Phase 10 (застосування компактизацією командою), Phase 23 (`keep_cache`, FrozenPrefix, Responses); спайк [context_editor_host_attachments](./context_editor_host_attachments.spike.md) (concluded: `prompt.attachment` бачить кожне вкладення з текстом, `{ text: null }` прибирає копію, після компактизації хост перепитує все в порядку розмови, прогноз у застосуванні прибирає стару копію в тому самому запиті); пункт backlog «Застарілі вкладення хоста після застосувань» (сесія d5614704: ≈ 177 тисяч символів, ≈ 45 тисяч токенів на запит); рішення ініціатора за делегуванням розробника (дизайн — [SP_CTX_DEC_25](./context_editor.sp.md#SP_CTX_DEC_25), [C_CTX_DEC_22](./context_editor.concept.md#C_CTX_DEC_22))
**Implements:** [SP_CTX_02_39](./context_editor.hostattach.sp.md#SP_CTX_02_39) AttachmentAnswer, [02_40](./context_editor.hostattach.sp.md#SP_CTX_02_40) PlanAttachments, FrozenAttachments і CommitAttachments, [02_41](./context_editor.hostattach.sp.md#SP_CTX_02_41) ClearAttachments (новий дочірній файл), [01_23](./context_editor.structures.sp.md#SP_CTX_01_23) HostAttachState, [01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (ATTACH_TYPES, PREAMBLE_HEAD, REREAD_HEAD, LISTING_HEAD, SUPERSEDED, PASS_GAP_MS, MAX_ATTACH_*, CHAIN_RANK `hostattach`), [01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (AttachText), [01_07](./context_editor.structures.sp.md#SP_CTX_01_07), [01_20](./context_editor.structures.sp.md#SP_CTX_01_20) і [02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (рядок `Host attachments`), [02_07](./context_editor.edits.sp.md#SP_CTX_02_07) (крок рішень у фіксації), [02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (спостерігач), [06_01](./context_editor.sp.md#SP_CTX_06_01); [C_CTX_03_08](./context_editor.mechanisms.concept.md#C_CTX_03_08)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки фази 24: ParseAttachment (перша копія; копія після компактизації і nested_memory; невідома рамка; заголовок у вмісті), AttachmentAnswer (поза обсягом; файл стану; нова копія і новий прохід; відновлений процес; повернутий вміст), PlanAttachments (новіша копія; диск; прогноз; переліки; інкрементні переліки), FrozenAttachments (keep_cache; рішення ховає поточне), VerifyPredictions (перший кінець ходу), HostAttachState (обмеження), CommitAttachments (файл непридатний; порожній каталог; ланцюжки; нове речення), HandleCompaction (вкладення; вкладення, покинуто; вкладення з keep_cache; commit вкладень кидає; запис черги кидає, вкладення), ClearAttachments (інша компактизація; відповіді недійсні), Telemetry (вкладення); [05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) «Вкладення хоста змінюються лише застосуванням і не губляться»; [05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки вкладень хоста; `claude plugin test` (711 тестів, було 681), `claude plugin validate` (хуки `prompt.attachment{type=instructions|nested_memory|skill_listing}`), tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Застарілі копії інструкцій після застосувань» (обидва хости, проксі-журнал: перший запит після застосування без проміжних копій, преамбула з `superseded`, `--resume` — ті самі байти вкладень, `keep_cache` — заморожена копія незмінна) — далі

| Що | Де |
|----|----|
| ParseAttachment, TextHash, SectionKey; AttachMemory (каталог, серія, `matched`), NoteAsk, ResetPass; AttachmentAnswer, AnswerFor, RewriteSections; PlanAttachments (переліки за покриттям назв, ListingNames), FrozenAttachments, AttachPort (`disk`, `commit`, `putBack`, `passed`), AttachText, AnswersKey; RollbackPredictions і VerifyPredictions (порт VerifyIO); VoidAnswers; HostAttachState і його розбір; ClearedAnswers | `mods/context-editor/hooks/hostattach.ts` (новий, чистий); `tests/hostattach.test.ts` (новий, 30 тестів) |
| HandleCompaction: порт `attachments` — читання файлів до фіксації, CommitAttachments у кроці фіксації після реєстрів (повернення при покинутій диспетчеризації), речення звіту, ResetPass після відповіді рядками; ObserveCompaction: `attachments.passed` і `clear` для компактизації, що стоїть | `mods/context-editor/hooks/compaction.ts` |
| Ланцюжок `hostattach` (ранг 4) і текст порядку ланцюжків | `mods/context-editor/hooks/store.ts`; `tests/store.test.ts` |
| Рядок `Host attachments` телеметрії `context_list` (поле `hostAttach`, порт ListIO `hostAttach`) | `mods/context-editor/hooks/stages.ts` |
| Зв'язування: VerifyPredictions на `turn.complete` основної розмови з `$.ui.invalidate('prompt.attachment')`; три хуки `prompt.attachment` з рядковими матчерами, `hostattach.json` у Stores з кешем файлів, `readFileText`, AttachIO, ResetPass на публікації сховища і після засіву, порт `attachments` у застосуванні і спостерігачі, `hostAttach` у ListIO | `mods/context-editor/hooks/register.ts` |

Стан 2026-10-12: код і модульні тести готові (701 тест, було 681; `claude plugin validate` і tsc проходять). Навичка і INTRO_TEXT без змін: агенту нічого робити — рядок телеметрії і речення звіту самопояснювальні. Засів передачі вкладень не несе: BuildSeed збирає рядки (`$.session.messages()`), а з API-подання бере лише перше повідомлення без блоків `<system-reminder>`; нова сесія отримує свої вкладення від хоста, а файл рішень у неї порожній (передача його не переносить), тож засів не воскрешає застарілих копій і не губить поточної — окремого пункту backlog не потрібно.

Живий прогін 2026-10-12 (`.dev_flow/cache/live-test/phase24-results.md`, haiku, 2.1.296, обидва хости): сценарії 1–4 pass — застарілі копії CLAUDE.md переписано чи пропущено, преамбула й поточна копія лишились, модель щоразу знала новий вміст, `--resume` надіслав побайтно ті самі блоки вкладень, `keep_cache` зберіг заморожені копії; сценарій 5 fail — пізніші `skill_listing` інкрементні (той самий заголовок, лише додані навички), і правило «лишати найновіший перелік» прибрало повний перелік (модель втратила навички). Виправлено разом із рев'ю (PASS with WARNINGS): перелік прибирається, лише коли один новіший має всі його назви; копія нова й за кількістю запитів від початку проходу (повернений вміст); `keep_cache` не тримає рішення, що ховає поточне; невиконаний прогноз знімається на першому кінці ходу (VerifyPredictions, `$.ui.invalidate`); `voided` після іншої компактизації; прохід лише зі справжнім перемиканням сесії; commit усередині ланцюжків фіксації; SECTION_HEAD лише після порожнього рядка і для `/` чи `~`; речення звіту порівнює рішення без `copies`; тести на збій commit і запису черги. 711 тестів (було 701), validate і tsc. Повторний прогін (stream-json): регресія сценарію 1 pass; сценарій 5 pass — повний перелік і два інкрементні лишились у всіх 13 запитах (прибирання переліку, покритого повним повторним, наживо не відтворено — хост такого не надсилав; покрито тестами); відкат передбачення pass — після кінця ходу шлях у `uncomparable`, наступний запит без компактизації знову несе поточну копію, кеш влучив.

Ризики, які перевіряє Verify: (1) прогноз (б) спирається на поведінку хоста 2.1.296 — нова копія зміненого файлу з першим промптом після межі (підтверджено живим прогоном); якщо хост її не докладе, хід після застосування йде без поточного вмісту цього файлу, а на його кінці VerifyPredictions знімає прогноз і через `$.ui.invalidate` повертає копію з наступного ходу; (2) без `keep_cache` зміна відповіді на першу копію переписує кеш від першого повідомлення — CacheCost і м'яке нагадування цього не моделюють (свідомо: типове застосування й так переписує всю розмову); (3) заголовок `Contents of <path> (…):` усередині самого файлу інструкцій ділить розділ лише після порожнього рядка і з `/` чи `~` — лишковий ризик хибного розділу з реальним шляхом іншого файлу; (4) прохід, який почав інший плагін (`$.ui.invalidate`), подвоює лічильник копій каталогу — тоді лишаються всі копії до наступної компактизації (безпечний бік); (4а) правило переліків спирається на рядки `- <name>:` — перелік без них лишається; (5) рамки вкладень (преамбула, REREAD_HEAD, LISTING_HEAD) — тексти хоста 2.1.296: після оновлення хоста невідома рамка просто лишає все; (6) повтор сценарію 5 (інкрементні переліки) і перевірка VerifyPredictions наживо — далі.

### Phase 4 — Дослідження: медіа в промптах і межі вікон [DONE]  {#PL_CTX_P4}

**Depends on:** Phase 2
**Implements:** закриття [SP_CTX_DEC_06](./context_editor.sp.md#SP_CTX_DEC_06)
**Verify:** spike-файл [context_editor_media.spike.md](./context_editor_media.spike.md) з даними живого прогону: обидва подання розмови і рядки `e.messages` для сесії з промптами людини з медіа і нагадуваннями; висновок A / B / C; межі вікон трьох подань — concluded 2026-10-10

Time-box: одна сесія. Результат (2026-10-10, хост 2.1.296, stream-json і термінал): розробник обрав B з перевіркою A — ходи людини від хвоста, кожна пара перевіряється текстом і ідентифікаторами ([SP_CTX_DEC_06](./context_editor.sp.md#SP_CTX_DEC_06) resolved, правило — PromptMatch у [SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10)); межі вікон — рядки 4096 з усього транскрипту, API 4096 повідомлень від межі, `e.messages` — усе від межі без ліміту (навичка plugin-hooks, пункти 47–51). Проба, драйвери, дампи й еталон `match.py` — `.dev_flow/cache/media-spike/` (локально).

### Phase 5 — Операція describe [DONE]  {#PL_CTX_P5}

**Depends on:** Phase 4 (рішення B з перевіркою A)
**Implements:** `PromptMatch` і CollectMedia з рядками в [SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10); PROMPT_DECORATIONS у [01_12](./context_editor.structures.sp.md#SP_CTX_01_12); `describe` у [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (схема, опис, `hasMedia` з API-подання лише для `describe`), [02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [02_04](./context_editor.edits.sp.md#SP_CTX_02_04) (код уже був, тепер досяжний); CollectMedia з `e.messages` у [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), з CurrentRows у [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) і [02_29](./context_editor.stages.sp.md#SP_CTX_02_29); медіа промптів у засіві [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22); навичка ([02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) — `describe` для медіа в промпті
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки PromptMatch (живі дампи, лише зображення, однаковий текст, прикраси, рядки команди, `@файл`, зсув, `tool_result` у повідомленні, `/compact` у хвості, паралельні виклики, після вбудованої `/compact`), CollectMedia «медіа в промпті» і «медіа в промпті зіставлено», ApplyEdits / context_edit / HandleCompaction / BuildSeed «describe», опис інструментів ≤ MAX_DESCRIPTION; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Зображення в промпті людини» в обох хостах

| Що | Де |
|----|----|
| PromptMatch (`matchPrompts`): ходи людини, прикраси, пари від хвоста, довіра, власник | `mods/context-editor/hooks/media.ts` (новий, чистий) |
| CollectMedia з рядками і власниками `{row}` | `mods/context-editor/hooks/edits.ts` |
| `hasMedia` у context_edit: `needsApi` (API-подання лише для `describe`), `hasMediaFrom`; рядок DESCRIBE_DROPS у результаті | `mods/context-editor/hooks/queue.ts` (`queueEdits`, `contextEdit`) |
| `describe` при застосуванні лише з медіа, заархівованим цим застосуванням (NO_MEDIA_NOW), DESCRIBE_DROPS у звіті | `mods/context-editor/hooks/edits.ts` (`applyEdits`, `formatReport`) |
| CollectMedia з `e.messages` | `mods/context-editor/hooks/compaction.ts` |
| BuildSeed: CollectMedia по видимих рядках, медіа промпту лише для правки, що його замінює, лічба незмінених | `mods/context-editor/hooks/handoff.ts` |
| Схема й опис `describe` (EDIT_DESCRIPTION: пункт (7) — вказівка на навичку), зв'язування: API-подання для `describe`, CurrentRows для переліку й блоку | `mods/context-editor/hooks/register.ts` |
| Навичка: `describe` для медіа в промпті | `mods/context-editor/skills/context-stages/SKILL.md` |
| Тести: PromptMatch на обрізаних живих дампах (фікстури зібрано `make_fixtures.py` з дампів проби; очікування — з еталону `match_v3` у `.dev_flow/cache/media-spike/match.py`) і штучних випадках, describe наскрізно | `mods/context-editor/tests/media.test.ts`, `tests/media-fixtures.ts`; `tests/edits.test.ts` (CollectMedia з рядками) |

Стан 2026-10-10: код і модульні тести готові (421 тест після рев'ю 44), живий сценарій 05_03 — після рев'ю.

### Phase 6 — Залишкове вікно тригера [DONE]  {#PL_CTX_P6}

**Depends on:** рішення розробника щодо [C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)
**Implements:** C_CTX_DEC_09
**Verify:** DEC_09 `resolved` (варіант A, розробник 2026-10-08); код не змінюється — готовність уже перевіряється за інструментом редактора в процесі і свіжістю файлу готовності. 2026-10-09: DEC_09 переглянуто (C — один плагін); файл готовності прибирає [фаза 10](#PL_CTX_P10)

## Backlog

- Збереження правок після `claude --resume` ([C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05)) — return when: вийде версія Claude Code, у якій API компактизації дає позначити рядок-підсумок або відновлення поважає компактизацію від обробника.
- Правки компактизації командою після `--resume` (K, спайк Entry 6): незмінені рядки з медіа тягнуть ланцюжок оригіналів (батько до межі), рядки асистента з тим самим `message.id` підтягуються разом із вилученими викликами — `tool_use` дублюються. Напрям: повертати рядки так, щоб ланцюжок не перетинав межу (медіа файлом, як у засіві) — окремий спайк. — return when: розробник попросить надійне збереження правок без передачі, або скарга на дублікати після відновлення. Крок 1 (відповідь з thinking) — фаза 12.
- Збережений thinking і правки минулих ходів (рев'ю раунд 25): моделі, що зберігають thinking минулих ходів, після правки раннього ходу мають у пізніших відрізках thinking, підписаний для іншої розмови; хост може його відкинути або API — відповісти 400. У сесії a3902d56 (Opus 5.5) компактизації мода минали без помилок. — return when: 400 «Invalid signature in thinking block» після компактизації мода.
- R1 і сповіщення IDE (I): у VS Code тег `pin` отримав рядок «user opened file»; поза VS Code `unclassified` мають лише промпти людини. — return when: наступний живий прогін у VS Code на поточному хості (≥ 2.1.296; тригер «2.1.295» минув без перевірки — audit 2026-10-11).
- Очищені хостом результати в засіві (навичка plugin-hooks, пункт 33): після «context hint» хост заміняє вміст старих результатів, але рядки транскрипту, з яких BuildSeed збирає засів, несуть повний текст — нова сесія отримує назад уміст, який хост уже прибрав, і більший контекст. — return when: передача після події «context hint» або скарга на розмір засіяної сесії.
- Правила чищення з досвіду ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04), D): зараз лише порада в нагадуванні й описі `context_edit` (за C_CTX_DEC_15 — у результаті закриття етапу й описі `context_edit`); розробник: «правила оптимізації та редагувань потім сформуються у процесі роботи над реальними задачами». — return when: на реальній задачі агент стиснув потрібне або лишив явно зайве, чи розробник сформулює правило.
- Дослідження: як змінний контекст впливає на якість виконання завдань ([C_CTX](./context_editor.concept.md)). Розробник: «концепція змінного контексту сесії, який ai-агент може сам редагувати — це щось нове та потребує додаткових досліджень, як ця можливість може вплинути на якість виконання завдань». Питання: чи покращують правки фокус і результат; як часто агент потім шукає стиснуте (читання архіву, повторні запити); ціна скинутого кешу промпту; які правки шкодять. Спосіб — `/dev-flow research`: однакові реальні задачі з модом і без, метрики (успіх, помилки, повторні читання, токени, кількість правок і скидань кешу), розбір журналів сесій. — return when: розробник запустить дослідження, або накопичиться кілька реальних задач, виконаних з модом.
- R5 (б) — дублікати рядків без результатів (повторні вставки навички, [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11)): проба фази 15 показала, що текст навички від `Skill` — не рядок поточної розмови, а повторний `Skill` хост удруге не вставляє (навичка plugin-hooks, пункт 46). Живий прогін фази 15 (термінал, `.dev_flow/cache/live-test/phase15-results.md`): після `Skill X` slash-команда людини `/X` вставляє повний текст удруге (двері `note`, `origin engine`, `isMeta`), і це теж не рядок `$.session.messages()` — дубль є, але мод його не бачить. — return when: хост почав передавати вставки навичок рядками розмови або агент скаржиться на дубльовану навичку.
- Медіа незмінених промптів людини в засіві передачі ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)): після фази 5 воно зіставлене, але засів його не несе (лише лічить у «Media in <n> of the person's prompt(s) was not carried over»). Можна нести файлом, як CarryNote результатів, але дописаний до тексту промпту рядок змінює його відбиток (теги, `pin` першого промпту). — return when: людина скаржиться на втрачене зображення після передачі.
- Доставки, яких мод не бачив (R2 спайку вкладень; [SP_CTX_DEC_19](./context_editor.sp.md#SP_CTX_DEC_19), варіант B): форк сесії, старіша сесія, доставки до завантаження мода чи до першого рядка `tool-result` після перезавантаження модуля. Напрям — запасне джерело для того самого InsertDeliveries: записи `queued_command` транскрипту після останнього `compact_boundary`, якір за `parentUuid` (`.dev_flow/cache/attach-spike/queued.jq`), читання через `$.process.run` (файл буває > 4 MiB). Окремо від фази 20, бо формат файлу недокументований (навичка plugin-hooks, пункт 17), а `--resume` фаза 20 покриває файлом сесії. — return when: форк чи практика на копії сесії загубить доставку після застосування.
- Спайк «підсумок власним рядком асистента після заглушки результату» ([SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17)): результат інструмента замінюється короткою заглушкою, а підсумок стоїть окремим рядком асистента після неї — агент бачить його як власні слова, а не як вивід інструмента. Окремої ролі «context-editor» немає: Messages API має лише `user` і `assistant`, ролі задає хост. Питання спайку: злиття з відповіддю за `message.id` (пункт 30), KeepResponsesWhole, теги й нотатки на парі, розмір. Живий сценарій фази 19 (2026-10-11): haiku 0/3, sonnet 2/2 (`.dev_flow/cache/live-test/phase19-results.md`). — return when: моделі класу haiku помиляються, а A′ лишається; повернутися, якщо помилка з'явиться в sonnet чи opus на практиці.
- Рядки власної команди мода `/compact` (`<command-name>/compact</command-name>` з MARKER, `<local-command-caveat>… run directly in Claude Code…`) моделі читають як команду людини: «the `/compact` you ran» (haiku r1, sonnet s1, живий сценарій фази 19, `.dev_flow/cache/live-test/phase19-results.md`). — return when: це спричинить хибну дію агента.
- Читання файлів через `Bash` (пропозиція P16, практика 1; [SP_CTX_DEC_18](./context_editor.sp.md#SP_CTX_DEC_18) = A — спостерігати): `~`, R4 і журнал не бачать `cat`/`head`/`sed -n`; агент і без `~` стиснув правильно. — return when: агент лишить великі виводи оболонки нестиснутими чи стисне їх як невідтворювані, або журнал покаже потрібні повторні читання файлів, прочитаних оболонкою.
- Рядки псевдонімів як шум, коли агент мода не використовує (P19 задачі етапів, практика 3: 18 рядків ~1 тисяча символів): фаза 22 лише злила м'яке нагадування з рядком псевдоніма (один рядок, той самий `cN`); фаза 23 знову розділила їх (пропозиція — окремий рядок SUGGESTION), тож голі рядки псевдонімів лишились, як до фази 22. Варіанти — коротший запис (`[context-editor] id c12`) або псевдоніми лише після першого виклику `context_*` (тоді нагадування мусить нести псевдоніми само). — return when: живий сценарій фази 22 чи наступна практика покаже ті самі рядки «службовим шумом».
- Згортання хвоста при глибокій правці (спайк [context_editor_cache](./context_editor_cache.spike.md), варіант 3; [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22), E): рядки викликів і результатів після першої зміни до наступного промпту повертати одним рядком викликів і одним рядком результатів — серії стають однією позицією, і мітка кешу знову бачить префікс (проба `fold-12`: читання 82 841 замість 64 148, запис 14 582 замість 33 123, без `ensureToolResultPairing`). Ризики: модель бачить послідовні виклики як паралельні, тексти між викликами зібрано перед ними, thinking хвоста зникає — якість відповідей не міряно (opus, sonnet); кожен промпт людини в хвості додає 3–5 позицій, тож допомагає лише для хвоста з кількох ходів; злиття відповідей ламає межі відповідей для KeepResponsesWhole і `--resume` (навичка plugin-hooks, пункти 7б, 30); нотатки, теги за якорем і межі етапів на злитих рядках переїжджають (RebindTags); доставки посеред хвоста мусять стати після рядка результатів, тобто зсуваються. — Стан тригера (audit 2026-10-11): згортання хвоста має сенс лише із замороженим префіксом (`keep_cache`), а він тепер вибір агента і типово вимкнений (без нього застосування читає лише tools+system, 69 789, за будь-якої глибини правки). — return when: на практиці агент обиратиме `keep_cache`, а застосування з ним двічі і більше за сесію виявляться глибокими (перша зміна далі ~20 позицій від кінця), або розробник попросить A/B якості.
- Ремонт після відновлення (фаза 23, живий прогін; [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22)): після застосування з `keep_cache` `--resume` дублює кожну відповідь замороженого префікса (копії з `handle` після межі підтягують оригінали за `message.id`, навичка plugin-hooks, пункти 7б, 30, 36; `ensureToolResultPairing` на кожному запиті). Напрям: у новому процесі хоста (ідентичність процесу, SP_CTX_01_14) помітити задубльовані відповіді від застосувань з префіксом і один раз перезібрати розмову без них компактизацією мода — кеш після паузи відновлення зазвичай і так холодний, тож перебудова майже безкоштовна. Що має перевірити спайк: чи відрізняє мод копії від оригіналів у завантаженому ланцюжку (`$.session.messages()` після `--resume` — ланцюжок з дублікатами; відбитки однакові, бо вміст той самий; чи видно `handle`/порядок, чи треба журнал застосувань з відбитками префікса); що бачить модель до ремонту (API-подання з дублікатами); чи ремонт не губить медіа й доставок префікса; чи один ремонт достатній після кількох застосувань; як поводиться `/resume` у терміналі. — return when: агенти частіше обирають `keep_cache`, а сесії відновлюють, або розробник попросить.
- Розбіжність цін Sonnet (спайк [context_editor_efficiency](./context_editor_efficiency.spike.md)): ціни з `costUSD` дають для sonnet 2/10 $/Mtok, опублікований прайс — інші числа; відносні результати моделі від цього не залежать (відношення ρ однакові), абсолютні суми — залежать. — return when: рішення чи текст мода покладеться на абсолютну ціну sonnet.
- Довга задача з тиском контексту (≥150k) на opus з пропозицією фази 23 (вердикт вигідності): чи стискає агент вчасно і чи росте горизонт якісної роботи. — return when: розробник дасть реальну довгу задачу або попросить практику.
- Заголовок розділу всередині файлу інструкцій ([SP_CTX_02_39](./context_editor.hostattach.sp.md#SP_CTX_02_39), фаза 24): рядок `Contents of <path> (…):` з порожнім рядком після нього в самому CLAUDE.md розбір приймає за новий розділ; коли `<path>` — реальний файл, що є й окремим розділом (MEMORY.md), правило (а) може зробити справжню копію того файлу застарілою. Напрям: приймати розділ лише з описом, який хост ставить (відомі описи), або перевіряти, що хибний розділ не новіший за справжній. — return when: такий текст з'явиться в реальному CLAUDE.md чи пам'яті, або живий сценарій 05_03 фази 24 покаже інший формат заголовків. — виконано 2026-10-12 (рев'ю фази 24): SECTION_HEAD приймає заголовок лише на початку тексту або після порожнього рядка і лише для шляху з `/` чи `~`; лишковий ризик — заголовок, процитований після порожнього рядка, у ризиках фази 24.
- Ціна кешу прибраних вкладень хоста в CacheCost і м'якому нагадуванні ([SP_CTX_02_38](./context_editor.stages.sp.md#SP_CTX_02_38), фаза 24, [SP_CTX_DEC_25](./context_editor.sp.md#SP_CTX_DEC_25)): зміна відповіді на першу копію `instructions` переписує кеш від першого повідомлення; оцінка `keep_cache` цього не бачить (з `keep_cache` заморожені вкладення не змінюються, без нього застосування зазвичай і так переписує все). — return when: живий сценарій 05_03 фази 24 покаже читання кешу нижче за оцінку `Cache` після застосування з неглибокою правкою без `keep_cache`.
- Поширення через маркетплейс (`.claude-plugin/marketplace.json`) — return when: розробник вирішить ділитися модом.
- Калібрування символів на токен не бачить вкладень хоста ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34), сесія d5614704, 2026-10-12): Calibrate ділить символи рядків `$.session.messages()` на виміряні токени розмови, а ті містять і вкладення хоста, яких рядки не несуть (повторні копії CLAUDE.md, переліки навичок, `deferred_tools_delta`, контекст хуків). У сесії d5614704: рядки ~186k символів, розмова ~206k токенів → співвідношення впирається в CALIB_MIN 1.0 (записано 1.005), тож оцінка кожного рядка й вигода м'якого нагадування завищені приблизно втричі (нагадування обіцяло ~45k за ~60k символів англійського тексту, реально ~16k), вердикт окупності надто оптимістичний. Заголовок і виміряний ефект правильні (беруть виміряні токени: 198k + 52k ≈ 250k проти 252,5k у `usage` транскрипту). Напрям: рахувати символи форми API (`$.session.messages({ as: "api" })` несе нагадування текстовими блоками) або віднімати символи вкладень. — return when: одразу (виправлення в роботі, 2026-10-12). — виправлено 2026-10-12 (Calibrate ділить символи API-подання на Whole = `Messages` + рядки розбивки FIXED_IN_MESSAGES, без подання лишає збережене відношення; запис застосування рахує вкладення: глибоке — Whole, хвіст — за API-поданням; проба 2.1.296 підтвердила, що пам'ять, навички й інструкції MCP лежать у повідомленнях, а розбивка лічить їх у незмінній частині; для чисел d5614704 відношення ~2 замість 1,0, оцінки й «frees» утричі менші; 681 тест).
- Застарілі вкладення хоста після застосувань ([C_CTX](./context_editor.concept.md), сесія d5614704, 2026-10-12): кожне застосування — це `/compact`, після нього хост перечитує файли інструкцій і, якщо CLAUDE.md змінився, додає до наступного промпту його повну нову копію («Instruction files were re-read after the conversation was compacted … each replaces its earlier copy»), але старі копії лишаються в запиті. У сесії d5614704 після 15 застосувань — 10 вкладень `instructions` (~137k символів, ≈35k токенів) і 3 `skill_listing` (~93k символів); разом приблизно чверть розмови — дублікати, яких ні агент, ні мод не бачать як рядки й не можуть стиснути. Напрям: хук `prompt.attachment` (`{ text: null }` прибирає вкладення; відповідь тримається на процес, перепитується після `$.ui.invalidate` чи відновлення) — лишати лише останню копію кожного файлу інструкцій і переліку, перепитувати під час застосування (кеш і так переписується). Спершу спайк: чи викликається хук для `instructions` і `skill_listing`, порядок викликів, як дізнатися, що копія застаріла (текст ≠ останній побачений для того самого шляху), що робить `$.ui.invalidate("prompt.attachment")` з кешем, і що бачить `context_list`. Спайк завершено 2026-10-12 ([context_editor_host_attachments.spike.md](./context_editor_host_attachments.spike.md), concluded): хук бачить кожне вкладення з текстом, `{ text: null }` прибирає копію із запиту, після кожної компактизації хост перепитує всі вкладення в порядку розмови; робочий варіант — під час застосування позначати розділи, що відрізняються від файлу на диску, першу копію (з преамбулою) переписувати, решту застарілих прибирати, рішення зберігати в теці сесії (після `--resume` повертаються всі копії), `*_delta` не чіпати; у d5614704 це ≈177k символів (≈45k токенів) на кожному запиті. — return when: одразу (нова фаза PL_CTX, 2026-10-12). — виконано 2026-10-12 ([фаза 24](#PL_CTX_P24): хук `prompt.attachment` для `instructions`, `nested_memory`, `skill_listing`; рішення лише в застосуванні мода, збережені в `hostattach.json` для `--resume`; перша копія переписується, решта застарілих пропускається; 701 тест; живий сценарій — далі).
- Пін «першого промпту» після підключення мода посеред сесії ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16), сесія d5614704, 2026-10-12): AutoTag ставить `pin` на перший промпт людини, який побачив екземпляр модуля (`firstPromptPinned`), тож після `/reload-plugins` посеред сесії закріплено випадкову репліку («Продовжуй. Але раніше…», #41), а справжній перший промпт (#0) — ні. Шкоди мало (пін лише забороняє правку одного короткого рядка). — return when: мод підключатимуть до наявних сесій частіше, ніж запускатимуть з ним.
- Пара-носій `collapse` бере назву першого виклику діапазону ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04), сесії d5614704 і живий прогін фази 3 аудиту): підсумок етапу стоїть як результат `Bash`/`Agent`/`Read` з `input {}` (у d5614704 #106 — «Agent»); для `Read` перелік ставить прапорець `~` «відтворюваний», хоча рядок — підсумок; модель може читати його як вивід субагента. — return when: агент прийме підсумок за вивід інструмента або повторно «відтворить» його читанням.

## Design Decisions  {#PL_CTX_DEC}

### DEC_01 — Як тестувати логіку, що залежить від хоста  {#PL_CTX_DEC_01}

> **Status:** resolved
> **Date:** 2026-10-08

**Question:** Тестувати хуки через імітацію подій хоста в `claude-code/testing` чи винести логіку за порти?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — хуки через тестовий набір хоста | перевіряє і зв'язування з `$`; потребує імітації майже всіх іменників `$` (fs, process, session, tool, prompt) |
| B — логіка за портами (QueueIO, CompactionIO, TriggerIO), звичайні модульні тести | швидко і детерміновано; зв'язування портів з `$` перевіряють живі сценарії |

**Decision:** B.
**Rationale:** рев'ю раундів 2–3 вимагало тестів для контрактів у `register.ts`; порти дали їх без імітації хоста і зменшили `register.ts` до зв'язування.
**Rejected because:** A — велика імітація хоста заради перевірки тонкого зв'язування.

### DEC_02 — Порядок фаз після основного функціоналу  {#PL_CTX_DEC_02}

> **Status:** resolved
> **Date:** 2026-10-08

**Question:** Що робити після фази 1?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — медіа (живі сценарії) → теги → дослідження → describe | спершу дешеве завершення вже написаного коду, потім найцінніша нова можливість; describe останнім, бо залежить від дослідження |
| B — теги → медіа → дослідження → describe | найшвидше до автоматичного чищення; код медіа лишається неперевіреним наживо довше |

**Decision:** B — рішення розробника 2026-10-08.
**Rationale:** найшвидше до автоматичного чищення з тегів — можливості, якої ще немає; код медіа вже працює в модульних тестах і чекає живої перевірки у фазі 2.
**Rejected because:** A — відкладає нову можливість заради перевірки наявного коду.

### DEC_03 — Коли робити псевдоніми викликів  {#PL_CTX_DEC_03}

> **Status:** resolved
> **Date:** 2026-10-08

**Question:** Реалізувати псевдоніми ([C_CTX_DEC_10](./context_editor.concept.md#C_CTX_DEC_10)) до чи після медіа?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — перед медіа (фаза 7 після фази 3) | теги одразу стають зручними; живі сценарії медіа вже спиратимуться на псевдоніми |
| B — після медіа | медіа перевіряється раніше; теги довше потребують перегляду розмови |

**Decision:** A — рішення розробника 2026-10-08.
**Rationale:** знахідка живого сценарію фази 3 знижує цінність тегів, доки її не виправлено.
**Rejected because:** B — довше тримає підтверджену незручність.

### DEC_04 — Коли переходити на один плагін  {#PL_CTX_DEC_04}

> **Status:** resolved
> **Date:** 2026-10-09

**Question:** Об'єднати плагіни окремою фазою після виправлення компактизації і передачі чи одразу, однією фазою?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — окремою фазою після виправлення | менші кроки рев'ю; проміжний код для двох плагінів з командою компактизації, який потім видаляється |
| B — одразу, однією фазою 10 | одна зміна без проміжного стану; ширше рев'ю і живі тести |

**Decision:** B — розробник, 2026-10-09: «Об'єднати одразу». Фаза 10 виконується перед фазами 4 і 5: без неї мод не застосовує правок у VS Code.
**Rationale:** проміжний код для двох плагінів не має споживача після фази.
**Rejected because:** A — код, що живе одну фазу.

### DEC_05 — Як перевіряти етапи на практиці  {#PL_CTX_DEC_05}

> **Status:** resolved
> **Date:** 2026-10-10

**Question:** Реалізувати специфікацію етапів однією фазою, ядро спершу, чи швидкий прототип без повних тестів?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — ядро спершу (фаза 14: етапи, мітка, телеметрія, вступ, без нагадувань; фаза 15: авторозмітка, діапазон, слот стану, журнал) | живий прогін ядра раніше; практика може змінити фазу 15 до її реалізації |
| B — усе однією фазою | довше до першого живого прогону; більше коду під ризиком переробки |
| C — швидкий прототип без повних тестів і рев'ю, потім повна реалізація | найшвидший живий прогін; код прототипу викидається або переробляється |

**Decision:** A — розробник, 2026-10-10 («Ядро спочатку»), після слів: «Пропоную спочатку перевірити концепти на практиці, а не крутити багато раундів ревью з доколупуванням до дрібниць».
**Rationale:** рев'ю специфікації (раунди 30–35) почали давати дрібниці; відповідь на відкриті питання дасть живий прогін ядра.
**Rejected because:** B — довше до практики; C — подвійна робота над кодом.

## Changelog

| Date | Change |
|------|--------|
| — | Старіші 40 записів — у [context_editor.plan.log.md](./context_editor.plan.log.md) |
| 2026-10-11 | Фази 19 і 20 реалізовано: код і модульні тести (459 тестів), validate і tsc; живі сценарії 05_03 «Хто написав підсумки», «Доставки посеред ходу», «Доставка в передачі» — далі; CLAUDE.md — `hooks/deliveries.ts` у переліку портів і `deliveries.json` у сховищі |
| 2026-10-11 | Рев'ю 48 фаз 19–20 виправлено; живий сценарій «Хто написав підсумки»: haiku 0/3, sonnet 2/2, A′ лишається (SP_CTX_DEC_17); backlog — уточнений тригер спайку, новий пункт про рядки власної `/compact`, що читаються як команда людини |
| 2026-10-11 | Дизайн фази 21 (документи): `ref: "last"` — останній невласний виклик поточної розмови перед цим викликом `context_*`, з псевдонімом чи без, LAST_PENDING для виклику тієї самої відповіді без результату, рядок `"last" = <CallLabel>` у результатах (SP_CTX_DEC_20 proposed, рекомендація A + C; SP_CTX 01_12, 01_13, 02_02, 02_03, 02_11, 02_16, 02_17, 02_32, 05_01, 05_03, 05_04; C_CTX §3.5); пункт backlog про `last` став фазою 21 |
| 2026-10-11 | SP_CTX_DEC_20 = A + C (рішення розробника); фаза 21 реалізована: код і модульні тести (473 тести), validate і tsc; живий сценарій 05_03 «`ref: "last"` після малого виклику» — далі |
| 2026-10-11 | Фаза 21: живий сценарій «`ref: "last"` після малого виклику» — pass (a1, b1); рев'ю 50 — LAST_ORPHAN, текст поля `ref` у схемах, спільна `callLabel` для переліку і рядка `last`, посилання на phase14-results (d) у ризику; 474 тести |
| 2026-10-11 | Фаза 22 — м'яке нагадування (C_CTX_DEC_15 переглянуто — E; SP_CTX_DEC_21 = C, рішення розробника «Розмір + межа етапу»; SP_CTX 02_37 і зміни 01_10, 01_12, 02_09, 02_16, 02_27, 02_28, 05_01–05_04, 06_01): код і модульні тести (494 тести), validate і tsc; живий сценарій 05_03 «М'яке нагадування (stream-json, opus)» — далі; backlog — рядки псевдонімів як шум (P19) |
| 2026-10-11 | Фаза 22, рев'ю 52 (WARNINGS → виправлено): одна перевірка нагадування за раз, запізніла перевірка гальмує наступні, запис після зменшення контексту, HintCall і PickLine у `hints.ts`, тексти «(see context_list)» і «up to»; 498 тестів |
| 2026-10-11 | Фаза 23 — кеш промпту при застосуванні і нагадування з вердиктом (рішення розробника «Усе разом: пункти 1–3»; спайки context_editor_cache і context_editor_efficiency): заморожений префікс (ResponseStart за API-поданням), ціна кешу за вікном у телеметрії й нагадуванні (CacheCost), окремий рядок `[context-editor: suggestion]` з дією, виграшем, ціною кешу і вердиктом, канал розміру з новими порогами і канал ходу з промптом людини; код і модульні тести (519), живі сценарії — далі; беклог — згортання хвоста з ризиками |
| 2026-10-11 | Фаза 23, рев'ю 54 (WARNINGS → виправлено): глибина за кінцем ходу, ціни кешу за моделлю (розбіжність з калібруванням спайку — ризик і «Unverified» спайку), паралельні виклики за API-поданням, CallLines, повтор пакета каналу ходу; 525 тестів |
| 2026-10-11 | Фаза 23 після живого прогону: заморожений префікс — вибір агента (`keep_cache`, типово вимкнено) через дублікати після `--resume`; ціна за замовчуванням — уся розмова; беклог — ремонт після відновлення зі спайком; 528 тестів |
| 2026-10-12 | Фаза 24 — застарілі вкладення хоста (спайк context_editor_host_attachments; SP_CTX_DEC_25 і C_CTX_DEC_22 resolved (delegated)): `hooks/hostattach.ts` — хук `prompt.attachment` для `instructions`, `nested_memory`, `skill_listing`; рішення лише в застосуванні мода (новіша копія, прогноз з диска для порівнюваного шляху), перша копія переписується, решта застарілих пропускається, повтори лишають першу, переліки — найновіший; `hostattach.json` з ланцюжком рангу 4 для `--resume`; `keep_cache` не чіпає вкладень замороженого префікса; речення звіту й рядок телеметрії; код і модульні тести (701, було 681); живий сценарій 05_03 — далі; backlog: заголовок розділу всередині файлу інструкцій, ціна кешу прибраних вкладень |
| 2026-10-12 | Фаза 24, живий прогін (сценарії 1–4 pass, 5 fail — інкрементні переліки) і рев'ю (PASS with WARNINGS): правило переліків за покриттям назв, нова копія за `count`, `keep_cache` не тримає рішення, що ховає поточне, VerifyPredictions з `$.ui.invalidate`, `voided`, прохід лише при справжньому перемиканні, commit у ланцюжках фіксації, SECTION_HEAD з порожнім рядком, речення звіту без `copies`; 711 тестів; backlog — пункт про заголовок розділу виконано |
