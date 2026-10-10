# Implementation Plan: Редактор контексту агента  {#PL_CTX}

> **Code:** PL_CTX
> **Status:** in-progress
> **Created:** 2026-10-08
> **Updated:** 2026-10-10
>
> **Concept:** [C_CTX](./context_editor.concept.md)
> **Specification:** [SP_CTX](./context_editor.sp.md)
> **Depends on:** none
> **Used by:** —
>
> План реалізації мода-редактора контексту: виконані фази (основний функціонал, теги, псевдоніми, медіа, поточна розмова, передача в нову сесію) і фази, що лишились — перехід на один плагін і шляхи, що працюють у будь-якому хості, дослідження зіставлення медіа в промптах, операція `describe`. Читати перед початком роботи над будь-якою фазою.

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
| Сховище | JSON-файли в `<HOME>/.claude/context-editor/<session_id>/`, каталог 700 | [SP_CTX_01_07](./context_editor.sp.md#SP_CTX_01_07) |
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
- [ ] [Phase 15 — Етапи: авторозмітка, діапазон, слот стану, журнал](#PL_CTX_P15)
- [x] [Phase 16 — Службові нотатки агента](#PL_CTX_P16)
- [ ] [Phase 4 — Дослідження: медіа в промптах і межі вікон](#PL_CTX_P4)
- [ ] [Phase 5 — Операція describe](#PL_CTX_P5)

Порядок фаз — за [PL_CTX_DEC_02](#PL_CTX_DEC_02), [PL_CTX_DEC_04](#PL_CTX_DEC_04) і [PL_CTX_DEC_05](#PL_CTX_DEC_05); номери фаз — незмінні ідентифікатори, а не черговість.
- [backlog] Збереження правок після `--resume`; налаштовувані пороги; поширення через маркетплейс

## Phases

### Phase 1 — Основний функціонал [DONE]  {#PL_CTX_P1}

**Depends on:** none
**Implements:** [SP_CTX_01_01](./context_editor.sp.md#SP_CTX_01_01)–[01_07](./context_editor.sp.md#SP_CTX_01_07), [01_12](./context_editor.sp.md#SP_CTX_01_12); [02_01](./context_editor.sp.md#SP_CTX_02_01)–[02_08](./context_editor.sp.md#SP_CTX_02_08); [02_09](./context_editor.sp.md#SP_CTX_02_09) без замін з тегів; [02_15](./context_editor.sp.md#SP_CTX_02_15)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки ApplyEdits (крім describe), PrepareEdits, DropOwnCalls, context_list, context_edit, HandleCompaction, DeliverReport, TriggerCompaction; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Стиснення в межах сесії», «Три операції», «Нагадування з початку» — pass 2026-10-08 після раунду 3

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
**Implements:** [SP_CTX_01_13](./context_editor.sp.md#SP_CTX_01_13), [02_16](./context_editor.sp.md#SP_CTX_02_16), [02_17](./context_editor.sp.md#SP_CTX_02_17); `ref` у [01_02](./context_editor.sp.md#SP_CTX_01_02), [02_03](./context_editor.sp.md#SP_CTX_02_03), [02_11](./context_editor.sp.md#SP_CTX_02_11); псевдоніми в [02_01](./context_editor.sp.md#SP_CTX_02_01) і [02_14](./context_editor.sp.md#SP_CTX_02_14); [C_CTX_03_05](./context_editor.concept.md#C_CTX_03_05)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки MarkCall, ResolveRef, context_tag «ціль за ref», AliasRegistry «межа», RebindTags (псевдонім); [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Тег за псевдонімом»

| Що | Де |
|----|----|
| AliasRegistry, розбір, MarkCall, ResolveRef, очищення | новий `mods/context-editor/hooks/aliases.ts` (чиста логіка + порт) |
| `ref` у правках | `edits.ts` (`checkShape`), `queue.ts` (розв'язання перед `prepare`) |
| `ref` у тегах | `tags.ts`, схема `context_tag` у `register.ts` |
| Позначка в спільному хуку з нагадуванням, ланцюжок `serial('aliases')` | `register.ts` |
| Псевдоніми в переліку | `edits.ts` `listRows` |

Код і модульні тести є (`tests/aliases.test.ts`). Лишилось: живий сценарій «Тег за псевдонімом» ([SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03)); перевірити наживо, що `e.tool_use_id` хука `tool.call` збігається з `tool_use_id` рядків розмови, а рядок `[context-editor] id cN` доходить до моделі після результату.

### Phase 2 — Медіа в результатах інструментів [DONE]  {#PL_CTX_P2}

**Depends on:** Phase 1; виконується після фаз 3 і 7 ([PL_CTX_DEC_02](#PL_CTX_DEC_02), [PL_CTX_DEC_03](#PL_CTX_DEC_03))
**Implements:** [SP_CTX_01_08](./context_editor.sp.md#SP_CTX_01_08), [SP_CTX_02_10](./context_editor.sp.md#SP_CTX_02_10) для результатів інструментів, медіа-частини [02_04](./context_editor.sp.md#SP_CTX_02_04), [02_05](./context_editor.sp.md#SP_CTX_02_05), [02_07](./context_editor.sp.md#SP_CTX_02_07); [C_CTX_DEC_06](./context_editor.concept.md#C_CTX_DEC_06)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки CollectMedia, «незмінений рядок з медіа», «медіа не заархівовано», «медіа сусідньої пари», «вікно API», DropOwnCalls «спільний рядок» (модульні — є); [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Скриншот у результаті інструменту», «Документ у результаті інструменту», «Незмінене медіа» — плюс: медіа-файл в архіві відкривається інструментом читання і має права 0600

Код і модульні тести вже є. Живі сценарії «Скриншот…», «Документ…», «Незмінене медіа» — pass (2026-10-09); тестові файли — `.dev_flow/cache/live-test/make-media.sh`. Припущення підтверджено наживо:
- блоки `image` і `document` в API-поданні мають `source.type = base64` — заархівовано всі медіа сценаріїв, жодного «media could not be archived»;
- `stdin` у `$.process.run` приймає кілька мегабайт: архів одного застосування 6.2 МБ записано через `writeText`. До `writeMedia` більше ~0.7 МБ base64 не доходить: Read перекодовує великі зображення в JPEG до ~0.5 МБ, а великий PDF віддає сторінками-JPEG, не документом.

### Phase 3 — Теги [DONE]  {#PL_CTX_P3}

**Depends on:** Phase 1 (виконується перед фазою 2, [PL_CTX_DEC_02](#PL_CTX_DEC_02))
**Implements:** [SP_CTX_01_09](./context_editor.sp.md#SP_CTX_01_09)–[01_11](./context_editor.sp.md#SP_CTX_01_11), [02_11](./context_editor.sp.md#SP_CTX_02_11)–[02_14](./context_editor.sp.md#SP_CTX_02_14), заміни з тегів у [02_09](./context_editor.sp.md#SP_CTX_02_09), перевірка `pin` у [02_03](./context_editor.sp.md#SP_CTX_02_03) і [02_07](./context_editor.sp.md#SP_CTX_02_07), теги в [02_01](./context_editor.sp.md#SP_CTX_02_01); [C_CTX_03_04](./context_editor.concept.md#C_CTX_03_04)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки PrepareEdits «pin», context_tag «помилки», AutoTag, QueueTagReplacements, Nudge «заміни достатньо», RebindTags; [SP_CTX_05_04](./context_editor.sp.md#SP_CTX_05_04) рядки про теги; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Автоматичне чищення з тегів», «Захист початкового завдання»

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
**Implements:** [SP_CTX_01_14](./context_editor.sp.md#SP_CTX_01_14), [SP_CTX_02_18](./context_editor.sp.md#SP_CTX_02_18), [SP_CTX_DEC_07](./context_editor.sp.md#SP_CTX_DEC_07), запис межі в [02_07](./context_editor.sp.md#SP_CTX_02_07), архів [01_06](./context_editor.sp.md#SP_CTX_01_06), MAX_DESCRIPTION ([01_12](./context_editor.sp.md#SP_CTX_01_12))
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки CurrentRows, RecordBoundary, «архів без дубля медіа», «опис інструмента»; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Перегляд після компактизації»; регрес — «Скриншот у результаті інструменту»

- `edits.ts`: `boundaryOf`, `currentRows` (чисті); `compaction.ts`: `archiveText` і запис межі через порт `CompactionIO.writeBoundary`;
- `register.ts`: одне читання поточної розмови для `context_list`, `context_edit`, тегів, закріплень і лічильника `review`; хук запису межі для компактизацій не редактора; коротший опис `context_edit`, експорт описів для тесту.
- рев'ю раунд 4: правки й теги за індексом з переліку, зробленого до зміни межі, відхиляються; межа іншого процесу не довіряється; предикат спостерігача — чиста `observedBoundary`; архів замінює лише рядки в алфавіті base64.

### Phase 9 — Передача в нову сесію [DONE]  {#PL_CTX_P9}

**Depends on:** Phase 8 (поточна розмова); спайк [context_editor_session](./context_editor_session.spike.md); [C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11), [C_CTX_DEC_12](./context_editor.concept.md#C_CTX_DEC_12), [C_CTX_DEC_13](./context_editor.concept.md#C_CTX_DEC_13)
**Implements:** [SP_CTX_01_15](./context_editor.sp.md#SP_CTX_01_15), [01_16](./context_editor.sp.md#SP_CTX_01_16), поле `handoff` у [01_04](./context_editor.sp.md#SP_CTX_01_04), [02_19](./context_editor.sp.md#SP_CTX_02_19)–[02_24](./context_editor.sp.md#SP_CTX_02_24), skip у [02_07](./context_editor.sp.md#SP_CTX_02_07), константи [01_12](./context_editor.sp.md#SP_CTX_01_12)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки BuildTranscript, CheckTranscript, CheckSwitched, context_handoff, HandleCompaction «передача в черзі», RunHandoff «запасний шлях»; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Передача транскриптом», «Передача документом», «Запасний шлях», «Команда людини»; регрес — «Стиснення в межах сесії», «Перегляд після компактизації»

- `hooks/handoff.ts` (новий): `buildTranscript`, `checkTranscript`, `checkSwitched`, розбір і постановка HandoffRequest (`contextHandoff`), оркестрація `runHandoff` через порт `HandoffIO` (читання черги, CurrentRows, API-подання, пошук транскрипту, запис файлу, сховище нової сесії, `command.run`, `session.id`, `model.fork`, `prompt.submit`, тост);
- `hooks/queue.ts`: поле `handoff` у Queue, його перевірка при розборі; `hooks/compaction.ts`: skip `handoff pending`;
- `hooks/register.ts`: інструмент `context_handoff`, команда `/handoff`, запуск RunHandoff після `turn.complete` з паузою HANDOFF_DELAY, зв'язування `HandoffIO` з `$`;
- `tests/handoff.test.ts`: чисті функції й оркестрація через порт (успіх, обидва збої, повернення в стару сесію);
- живі сценарії — драйвер `ce.sh`; збирач і перевірки спайку — `.dev_flow/cache/session-transcript/`.

### Phase 10 — Один плагін, компактизація командою, передача засівом [DONE]  {#PL_CTX_P10}

**Depends on:** Phase 9; спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md) (Entries 1–4); [C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02), [C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09), [C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11)–[C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14); виконується перед фазами 4 і 5 ([PL_CTX_DEC_04](#PL_CTX_DEC_04))
**Implements:** преамбула [SP_CTX_02](./context_editor.sp.md#SP_CTX_02) (команди в черзі хоста, походження команди, лічильник ходів); [SP_CTX_01_05](./context_editor.sp.md#SP_CTX_01_05) (`mediaFiles` засіву), [01_06](./context_editor.sp.md#SP_CTX_01_06), [01_07](./context_editor.sp.md#SP_CTX_01_07), [01_12](./context_editor.sp.md#SP_CTX_01_12), [01_15](./context_editor.sp.md#SP_CTX_01_15) (`owner`, `handoffInFlight`, `handoffScheduled`, Due), вилучення [01_16](./context_editor.sp.md#SP_CTX_01_16), [01_17](./context_editor.sp.md#SP_CTX_01_17); [02_06](./context_editor.sp.md#SP_CTX_02_06) Flush, [02_07](./context_editor.sp.md#SP_CTX_02_07), [02_12](./context_editor.sp.md#SP_CTX_02_12) (копії рядків, лічильник ходів реєстру), [02_15](./context_editor.sp.md#SP_CTX_02_15), [02_18](./context_editor.sp.md#SP_CTX_02_18), [02_19](./context_editor.sp.md#SP_CTX_02_19)–[02_24](./context_editor.sp.md#SP_CTX_02_24), вилучення [02_25](./context_editor.sp.md#SP_CTX_02_25), [02_26](./context_editor.sp.md#SP_CTX_02_26); [03_02](./context_editor.sp.md#SP_CTX_03_02); [04_01](./context_editor.sp.md#SP_CTX_04_01), [04_04](./context_editor.sp.md#SP_CTX_04_04); [SP_CTX_DEC_04](./context_editor.sp.md#SP_CTX_DEC_04), [DEC_08](./context_editor.sp.md#SP_CTX_DEC_08), [DEC_09](./context_editor.sp.md#SP_CTX_DEC_09)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки Flush, Лічильник ходів, HandleCompaction, HandleSeed, AutoTag (копії рядків), BuildSeed, CheckSeed, CheckSeeded, PinSummary, RunHandoff, Due, HandoffCommand, context_handoff, cancelHandoff, CurrentRows «межа засіяної сесії», RecordBoundary, DeliverReport; [SP_CTX_05_02](./context_editor.sp.md#SP_CTX_05_02) «Справжнє підсумовування не запускається через мод», «Рядки команди несуть самопояснювальну мітку, і обробник бачить її ж», «Засіяна сесія переживає відновлення»; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) — обов'язкові в обох хостах: «Завершення команди після обробника», «Мітка в розмові», «Команда людини»; нові: «Стиснення в неінтерактивному хості», «Мод вимкнено», «Передача засівом (термінал)», «Передача засівом (неінтерактивний хост)», «Передача довгої сесії після `/compact`», «Запасний шлях до очищення» (в обох хостах, без документа агента — перевіряє `$.model.fork` у stream-json), «Збій засіву після очищення»; повторний прогін в обох хостах — «Стиснення в межах сесії», «Три операції», «Нагадування з початку», «Скриншот у результаті інструменту», «Незмінене медіа», «Перегляд після компактизації», «Передача документом», «Автоматичне чищення з тегів», «Захист початкового завдання»; у терміналі — «Тег за псевдонімом»; [SP_CTX_05_04](./context_editor.sp.md#SP_CTX_05_04) рядки «Хост відхиляє команду компактизації», «Команда чекає кінця ходу», «Разовий `claude -p "<prompt>"`», «Передача після `--resume` відредагованої сесії», «Перезавантаження модуля посеред передачі», «Рядки, повернені компактизацією, у stream-json», «Передача, коли модель бачить не всі рядки», «Передача заповненої розмови», «Хід почався в новій сесії до засіву», «Запис старої черги після засіву не вдався», «`/compact` людини з текстом HANDOFF_MARKER». Плюс механічне: `claude plugin validate`, tsc, жодної згадки `context-editor-trigger`, `editor-ready`, `$.session.compact`, `FLUSH_RETRIES` у коді

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
**Implements:** [SP_CTX_01_05](./context_editor.sp.md#SP_CTX_01_05) (`FormatReport(report, archive, kind)`, без рядка розміру при 0 правок), [01_12](./context_editor.sp.md#SP_CTX_01_12) (HOST_ENV), [01_14](./context_editor.sp.md#SP_CTX_01_14) (`host`, `hostId`, ParseHostId), [01_17](./context_editor.sp.md#SP_CTX_01_17) (`visible`, `edits`, інваріант реєстрів), [02_04](./context_editor.sp.md#SP_CTX_02_04) (`apiTruncated`), [02_07](./context_editor.sp.md#SP_CTX_02_07), [02_10](./context_editor.sp.md#SP_CTX_02_10) (`apiTruncated` при ≥ ROW_WINDOW − 1), [02_14](./context_editor.sp.md#SP_CTX_02_14), [02_15](./context_editor.sp.md#SP_CTX_02_15), [02_18](./context_editor.sp.md#SP_CTX_02_18) (`Trusted(b)`, власна межа, зняття `host` після перемикання сесії), [02_21](./context_editor.sp.md#SP_CTX_02_21) (крок реєстрів: читання, узгодження, запис), [02_22](./context_editor.sp.md#SP_CTX_02_22) (`charsAfter` до CarryNote і голови, WINDOW_FULL); [SP_CTX_DEC_07](./context_editor.sp.md#SP_CTX_DEC_07), [SP_CTX_DEC_10](./context_editor.sp.md#SP_CTX_DEC_10)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки: CurrentRows «гаряче перезавантаження», «перший перелік після перезавантаження», «інший процес», «межа без `host`», «власна межа без `host`», «`/resume` у тому самому процесі», «перша підготовка після завантаження», «ідентичність не прочиталась», «межа засіяної сесії»; ParseHostId «розбір»; hostId «ще не прочитано»; RecordBoundary «запис», «`host`»; HandleSeed «засів»; CollectMedia «`apiTruncated`»; ApplyEdits «правка поза вікном», «промпт перед першою парою, повне подання», «промпт перед першою парою, обрізане подання»; FormatReport «форми»; HandleCompaction «жодної правки», «правки застосовано»; BuildSeed «засів без правок», «засів з правками»; RunHandoff «теги й псевдоніми», «псевдонім зміненої пари», «тег на зміненій парі», «disposable з заміною в пакеті засіву», «збій узгодження реєстру», «незмінена пара», «пара поза засівом». [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03): «Гаряче перезавантаження (обидва хости)», «Передача засівом зі зміненою парою з псевдонімом (обидва хости)», «Відновлення сесії (лише текст)», «Відновлення сесії (медіа або злиття відповіді)». [SP_CTX_05_04](./context_editor.sp.md#SP_CTX_05_04): «Другий процес хоста з тією самою сесією». Живе: у сесії з компактизацією, яку хост відхилив обробником (`skip`), людина бачить рядок хоста «Not compacted · <причина>» — це мітка хоста для скасованої компактизації, а звіт мода при цьому без «tokens freed». Плюс механічне: `claude plugin test`, `claude plugin validate`, tsc (лише відомі `isDeferred`)

| Що | Де |
|----|----|
| ParseHostId (чиста функція), `hostId` — одна обіцянка на екземпляр модуля (токен HOST_ENV через `$.env.set`, `sh -c 'echo $PPID'`), `host` у Boundary, `Trusted(b)` з власною межею, `host` не рядком ігнорується, зняття `host` після перемикання сесії в процесі | `mods/context-editor/hooks/edits.ts` (ParseHostId, `currentRows`, тип Boundary, Trusted), `register.ts` (читання ідентичності — одна обіцянка з `session.start` або першого PrepareStorage; `$.env.get`/`$.env.set` приймають рядковий літерал, тож `'CONTEXT_EDITOR_HOST'` пишеться прямо у викликах, а HOST_ENV лише документує значення; `view()`, RecordBoundary, HandleSeed, PrepareStorage); `tests/boundary.test.ts` |
| `apiTruncated` у CollectMedia (≥ ROW_WINDOW − 1), умова `earlyPrompt`, WINDOW_FULL | `edits.ts`; `compaction.ts`, `handoff.ts` (виклики); `tests/edits.test.ts`, `handoff.test.ts` |
| `FormatReport(…, kind)`, `charsAfter` засіву до CarryNote і голови, звіт передачі без зайвого переносу | `edits.ts` (`formatReport`), `compaction.ts`, `handoff.ts`; `tests/edits.test.ts`, `compaction.test.ts`, `handoff.test.ts` |
| HandoffSeed `visible` і `edits`; реєстри нової сесії — читання старого, RebindTags / обрізання псевдонімів, запис нового, окремо для кожного | `handoff.ts` (крок реєстрів), `tags.ts`, `aliases.ts`, `register.ts`; `tests/handoff.test.ts` |
| Навичка й CLAUDE.md | `.dev_flow/skills/claude-code/plugin-hooks.md` — пункти 7, 30, 32–35 (32: ідентичність токеном і pid без `ps`); `CLAUDE.md` (рядок про `/clear` і межу — довіра за процесом хоста) |

### Phase 12 — Цілісна відповідь з thinking (backlog K, крок 1) [DONE]  {#PL_CTX_P12}

**Depends on:** Phase 11; Verify фази 11 («Відновлення сесії (лише текст)» з thinking — fail); спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md) Entry 5 (варіант vR — pass в обох хостах)
**Implements:** [SP_CTX_02_04](./context_editor.sp.md#SP_CTX_02_04) (KeepResponsesWhole на весь відрізок), [SP_CTX_02_05](./context_editor.sp.md#SP_CTX_02_05) (той самий крок), [SP_CTX_03_02](./context_editor.sp.md#SP_CTX_03_02)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки ApplyEdits «одна відповідь: текст і два Read», «без перезібраного асистента у відрізку», «рядок лише з thinking», «thinking перед зміненим викликом», DropOwnCalls «службовий виклик посеред відповіді»; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Відновлення сесії (лише текст)» з thinking (haiku за замовчуванням) в обох хостах і «Незмінене медіа» (регресія); `claude plugin test`, `claude plugin validate`, tsc

| Що | Де |
|----|----|
| KeepResponsesWhole: відрізок з перезібраним або вставленим рядком асистента — перезібрати всі його рядки асистента з `handle` | `mods/context-editor/hooks/edits.ts` (`rebuildSplitResponses`); `tests/edits.test.ts` |
| Навичка: правило пункту 30 | `.dev_flow/skills/claude-code/plugin-hooks.md` |

### Phase 13 — Покрокове вибіркове чищення (C_CTX_DEC_04, D) [DONE]  {#PL_CTX_P13}

**Depends on:** Phase 12; перегляд [C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04) (2026-10-09)
**Implements:** NudgeText у [SP_CTX_02_09](./context_editor.sp.md#SP_CTX_02_09); порада в описі `context_edit` (обмеження довжини — [SP_CTX_02](./context_editor.sp.md#SP_CTX_02), MAX_DESCRIPTION)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) «context_list, context_edit, context_tag, context_handoff — опис інструмента» (boundary.test.ts) і Nudge «текст просить порцію» (tags.test.ts); `claude plugin test`, `claude plugin validate`, tsc; живий сценарій «Нагадування з початку» в терміналі — не виконано: нагадування за розміром прибирає фаза 14 ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)); живе чищення за D у VS Code 2026-10-09 (два нагадування, стиснуто лише опрацьоване) — єдине спостереження

| Що | Де |
|----|----|
| Текст нагадування: наступна порція опрацьованого, не вся розмова; без змін — повідомлення людини, правила й навички, робоча частина | `mods/context-editor/hooks/tags.ts` (`nudgeText`); `tests/tags.test.ts` |
| Порада в описі `context_edit` замість «one large collapse» | `mods/context-editor/hooks/register.ts` (`EDIT_DESCRIPTION`) |

### Phase 14 — Етапи і свідомий тригер оптимізації: ядро [DONE]  {#PL_CTX_P14}

**Depends on:** Phase 13; [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)–[DEC_17](./context_editor.concept.md#C_CTX_DEC_17); [SP_CTX_DEC_11](./context_editor.sp.md#SP_CTX_DEC_11)–[DEC_15](./context_editor.sp.md#SP_CTX_DEC_15); задача `.dev_flow/tasks/task_20261010_083402_stage-cleanup.md` (відкриті знахідки рев'ю 35 — «Перевірити на практиці»)
**Implements:** [SP_CTX_01_04](./context_editor.sp.md#SP_CTX_01_04) (`optimize`, `optimizePrompted`), [01_05](./context_editor.sp.md#SP_CTX_01_05) (`produced`), [01_10](./context_editor.sp.md#SP_CTX_01_10) (`stage`, `lastClosed`, `introduced`), [01_12](./context_editor.sp.md#SP_CTX_01_12) (без NUDGE_*; OPTIMIZE_MARK, MESSAGES_ROW, MAX_STAGE_NAME, MAX_BLOCK_INDEXES, INTRO_TEXT, STAGE_ADVICE, SKILL), [01_17](./context_editor.sp.md#SP_CTX_01_17) (`carried`), [01_18](./context_editor.sp.md#SP_CTX_01_18), [01_20](./context_editor.sp.md#SP_CTX_01_20) без кандидатів за причинами, журналу і слоту стану; [02_01](./context_editor.sp.md#SP_CTX_02_01) з телеметрією, `count: 0`, `[stage ▶]`, `[block ▶]`/`[block end]`; [02_06](./context_editor.sp.md#SP_CTX_02_06) (Optimize); [02_07](./context_editor.sp.md#SP_CTX_02_07) (перенесення `optimize`, `optimizePrompted`; `produced`); [02_08](./context_editor.sp.md#SP_CTX_02_08) (вступ, PersonAdvice, `optimizePrompted`); [02_09](./context_editor.sp.md#SP_CTX_02_09) (вилучено); [02_11](./context_editor.sp.md#SP_CTX_02_11) `open`/`close`; [02_13](./context_editor.sp.md#SP_CTX_02_13) тригери закриття і мітки; [02_14](./context_editor.sp.md#SP_CTX_02_14) RelocateMark; [02_15](./context_editor.sp.md#SP_CTX_02_15), [02_16](./context_editor.sp.md#SP_CTX_02_16) без нагадування; [02_18](./context_editor.sp.md#SP_CTX_02_18) (`listedKey` звітом закриття); [02_21](./context_editor.sp.md#SP_CTX_02_21), [02_22](./context_editor.sp.md#SP_CTX_02_22) (мітки, `introduced`, `carried`); [02_27](./context_editor.sp.md#SP_CTX_02_27) (вступ і навичка — лише ядро), [02_28](./context_editor.sp.md#SP_CTX_02_28), [02_29](./context_editor.sp.md#SP_CTX_02_29), [02_30](./context_editor.sp.md#SP_CTX_02_30); [04_05](./context_editor.sp.md#SP_CTX_04_05), [04_06](./context_editor.sp.md#SP_CTX_04_06)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки контрактів зі списку Implements (Telemetry, StageBlock, DetectOptimize, Flush/Optimize, DeliverReport, context_tag `open`/`close`, RebindTags/RelocateMark, produced, HandleCompaction зберігає `optimize`), [05_02](./context_editor.sp.md#SP_CTX_05_02) інваріанти етапу й черги, [05_04](./context_editor.sp.md#SP_CTX_05_04) відповідні рядки; `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03): «Етап: закриття і стискання блоку», «Мітка оптимізації, stream-json», «Мітка оптимізації, термінал», «Мітка при непорожній черзі», «Людина випереджає хід оптимізації», «Інструкція на початку сесії», «Межа етапу після застосування», «Вбудована компактизація при відкритому етапі»; результати живих прогонів — у задачі етапів (знахідки «Перевірити на практиці» підтвердити або закрити)

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

### Phase 15 — Етапи: авторозмітка, діапазон, слот стану, журнал [TODO]  {#PL_CTX_P15}

**Depends on:** Phase 14 і її живі прогони ([PL_CTX_DEC_05](#PL_CTX_DEC_05)): знахідки практики можуть змінити специфікацію цієї фази
**Implements:** [SP_CTX_01_09](./context_editor.sp.md#SP_CTX_01_09) (`state`, `reason`, діапазон), [01_11](./context_editor.sp.md#SP_CTX_01_11) (R2/R3 з причинами, R4, R5), [01_12](./context_editor.sp.md#SP_CTX_01_12) (REPRODUCIBLE_TOOLS, WRITE_TOOLS, REPRO_FLAG, MAX_JOURNAL), [01_19](./context_editor.sp.md#SP_CTX_01_19), [01_20](./context_editor.sp.md#SP_CTX_01_20) (кандидати за причинами, журнал, слот стану); [02_01](./context_editor.sp.md#SP_CTX_02_01) (`~`, `[review: причина]`, `[state]`, діапазон); [02_02](./context_editor.sp.md#SP_CTX_02_02)/[02_03](./context_editor.sp.md#SP_CTX_02_03) (захист `state`); [02_07](./context_editor.sp.md#SP_CTX_02_07) (запис журналу); [02_11](./context_editor.sp.md#SP_CTX_02_11) (`state`, діапазон `disposable`); [02_12](./context_editor.sp.md#SP_CTX_02_12) (R5); [02_13](./context_editor.sp.md#SP_CTX_02_13) (діапазон → collapse); [02_14](./context_editor.sp.md#SP_CTX_02_14) (`state` після `rewrite`); [02_16](./context_editor.sp.md#SP_CTX_02_16) (R4, повторні читання); [02_27](./context_editor.sp.md#SP_CTX_02_27) (повна навичка); [02_31](./context_editor.sp.md#SP_CTX_02_31); [04_03](./context_editor.sp.md#SP_CTX_04_03)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки цих контрактів, [05_02](./context_editor.sp.md#SP_CTX_05_02), [05_04](./context_editor.sp.md#SP_CTX_05_04); `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03): «Застаріле читання», «Дублікат вставки навички» (рішення для R5 щодо рядків вставок), «Слот стану»

| Що | Де |
|----|----|
| Теги: `state`, `reason`, діапазон; R2–R5; захист `state`; заміна діапазону — collapse | `mods/context-editor/hooks/tags.ts`, `hooks/edits.ts`; `tests/tags.test.ts`, `tests/edits.test.ts` |
| Журнал ефекту: застосування, `changed`, повторні читання | `mods/context-editor/hooks/journal.ts` (новий); `tests/journal.test.ts` (новий) |
| Перегляд і телеметрія: `~`, причини, слот стану, підсумок журналу | `mods/context-editor/hooks/edits.ts`, `hooks/stages.ts` |
| Навичка мода — повна (відтворюване/невідтворюване, слот стану, діапазон) | `mods/context-editor/skills/context-stages/SKILL.md` |

### Phase 16 — Службові нотатки агента [DONE]  {#PL_CTX_P16}

**Depends on:** Phase 14 (реєстр тегів з етапами, `produced`, Survivors, BlockReport, OptimizeText, телеметрія); [C_CTX_DEC_20](./context_editor.concept.md#C_CTX_DEC_20). Від фази 15 не залежить: інструмент окремий, опис `context_tag` не змінюється
**Implements:** [SP_CTX_01_21](./context_editor.sp.md#SP_CTX_01_21), [01_10](./context_editor.sp.md#SP_CTX_01_10) (`notes`, `nextNote`), [01_05](./context_editor.sp.md#SP_CTX_01_05) (`notesDropped`), [01_12](./context_editor.sp.md#SP_CTX_01_12) (MAX_NOTES, MAX_NOTE, NOTE_PREFIX, MAX_REMIND), [01_20](./context_editor.sp.md#SP_CTX_01_20)/[02_28](./context_editor.sp.md#SP_CTX_02_28) (рядок `Notes`), [02_01](./context_editor.sp.md#SP_CTX_02_01) (`[nN]`, блок `Notes:`), [02_14](./context_editor.sp.md#SP_CTX_02_14) (RelocateNote), [02_16](./context_editor.sp.md#SP_CTX_02_16)/[02_33](./context_editor.sp.md#SP_CTX_02_33) (нагадування), [02_29](./context_editor.sp.md#SP_CTX_02_29) (нотатки в BlockReport, NotesHint), [02_06](./context_editor.sp.md#SP_CTX_02_06)/[02_08](./context_editor.sp.md#SP_CTX_02_08) (кількість нотаток у промпті), [02_21](./context_editor.sp.md#SP_CTX_02_21) (нотатки в передачі), [02_27](./context_editor.sp.md#SP_CTX_02_27) (розділ навички), [02_32](./context_editor.sp.md#SP_CTX_02_32), [04_07](./context_editor.sp.md#SP_CTX_04_07)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки context_note, NoteReminders, RebindTags (нотатки), context_list, BlockReport, OptimizeText/PersonAdvice, Telemetry (нотатки), опис п'яти інструментів ≤ MAX_DESCRIPTION; [05_04](./context_editor.sp.md#SP_CTX_05_04) рядки нотаток; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Нотатки і нагадування» в обох хостах

| Що | Де |
|----|----|
| Note, розбір і межі в реєстрі; `context_note` (чиста функція за портом TagIO); RelocateNote і `notesDropped` у rebindTags; NoteReminders | `mods/context-editor/hooks/notes.ts` (новий), `hooks/tags.ts`; `tests/notes.test.ts` (новий), `tests/tags.test.ts` |
| Перегляд: `[nN]` і блок `Notes:`; рядок звіту `Notes dropped` у FormatReport | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| Телеметрія, BlockReport, NotesHint в OptimizeText і PersonAdvice | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts` |
| Передача: нотатки в копії реєстру | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| Реєстрація: інструмент `context_note` (опис ≈ 700 символів, схема), нагадування в загальному хуку `tool.call` після рядка псевдоніма | `mods/context-editor/hooks/register.ts` |
| Навичка: розділ «Notes» з прикладами | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живий сценарій «Нотатки і нагадування»: драйвери в терміналі і stream-json | `.dev_flow/cache/live-test/` (локально) |

### Phase 4 — Дослідження: медіа в промптах і межі вікон [TODO]  {#PL_CTX_P4}

**Depends on:** Phase 2
**Implements:** закриття [SP_CTX_DEC_06](./context_editor.sp.md#SP_CTX_DEC_06)
**Verify:** spike-файл `docs/context_editor.spike.md` з даними живого прогону: обидва подання розмови і рядки `e.messages` для сесії з промптами людини з медіа і нагадуваннями; висновок A / B / C; межі вікон трьох подань

Time-box: одна сесія. Результат — рішення в SP_CTX_DEC_06 і, за потреби, правка [SP_CTX_02_10](./context_editor.sp.md#SP_CTX_02_10).

### Phase 5 — Операція describe [TODO]  {#PL_CTX_P5}

**Depends on:** Phase 4 (рішення A або B; за рішення C фаза переходить у backlog як відкинута)
**Implements:** `PromptMatch` у [SP_CTX_02_10](./context_editor.sp.md#SP_CTX_02_10), `describe` у [02_03](./context_editor.sp.md#SP_CTX_02_03) і [02_04](./context_editor.sp.md#SP_CTX_02_04), операція в описі й схемі `context_edit`
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки «describe», CollectMedia «медіа в промпті»; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Зображення в промпті людини»

### Phase 6 — Залишкове вікно тригера [DONE]  {#PL_CTX_P6}

**Depends on:** рішення розробника щодо [C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)
**Implements:** C_CTX_DEC_09
**Verify:** DEC_09 `resolved` (варіант A, розробник 2026-10-08); код не змінюється — готовність уже перевіряється за інструментом редактора в процесі і свіжістю файлу готовності. 2026-10-09: DEC_09 переглянуто (C — один плагін); файл готовності прибирає [фаза 10](#PL_CTX_P10)

## Backlog

- Збереження правок після `claude --resume` ([C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05)) — return when: вийде версія Claude Code, у якій API компактизації дає позначити рядок-підсумок або відновлення поважає компактизацію від обробника.
- Правки компактизації командою після `--resume` (K, спайк Entry 6): незмінені рядки з медіа тягнуть ланцюжок оригіналів (батько до межі), рядки асистента з тим самим `message.id` підтягуються разом із вилученими викликами — `tool_use` дублюються. Напрям: повертати рядки так, щоб ланцюжок не перетинав межу (медіа файлом, як у засіві) — окремий спайк. — return when: розробник попросить надійне збереження правок без передачі, або скарга на дублікати після відновлення. Крок 1 (відповідь з thinking) — фаза 12.
- Збережений thinking і правки минулих ходів (рев'ю раунд 25): моделі, що зберігають thinking минулих ходів, після правки раннього ходу мають у пізніших відрізках thinking, підписаний для іншої розмови; хост може його відкинути або API — відповісти 400. У сесії a3902d56 (Opus 5.5) компактизації мода минали без помилок. — return when: 400 «Invalid signature in thinking block» після компактизації мода.
- R1 і сповіщення IDE (I): у VS Code тег `pin` отримав рядок «user opened file»; поза VS Code `unclassified` мають лише промпти людини. — return when: перевірка у VS Code на 2.1.295 (після оновлення розширення).
- Очищені хостом результати в засіві (навичка plugin-hooks, пункт 33): після «context hint» хост заміняє вміст старих результатів, але рядки транскрипту, з яких BuildSeed збирає засів, несуть повний текст — нова сесія отримує назад уміст, який хост уже прибрав, і більший контекст. — return when: передача після події «context hint» або скарга на розмір засіяної сесії.
- Правила чищення з досвіду ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04), D): зараз лише порада в нагадуванні й описі `context_edit` (за C_CTX_DEC_15 — у результаті закриття етапу й описі `context_edit`); розробник: «правила оптимізації та редагувань потім сформуються у процесі роботи над реальними задачами». — return when: на реальній задачі агент стиснув потрібне або лишив явно зайве, чи розробник сформулює правило.
- Тригер чищення і стратегія нагадувань (M разом з етапами завдання): вирішено [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)–[DEC_19](./context_editor.concept.md#C_CTX_DEC_19), специфіковано (SP_CTX 01_18–01_20, 02_27–02_31), стало фазами [14](#PL_CTX_P14) і [15](#PL_CTX_P15).
- Дослідження: як змінний контекст впливає на якість виконання завдань ([C_CTX](./context_editor.concept.md)). Розробник: «концепція змінного контексту сесії, який ai-агент може сам редагувати — це щось нове та потребує додаткових досліджень, як ця можливість може вплинути на якість виконання завдань». Питання: чи покращують правки фокус і результат; як часто агент потім шукає стиснуте (читання архіву, повторні запити); ціна скинутого кешу промпту; які правки шкодять. Спосіб — `/dev-flow research`: однакові реальні задачі з модом і без, метрики (успіх, помилки, повторні читання, токени, кількість правок і скидань кешу), розбір журналів сесій. — return when: розробник запустить дослідження, або накопичиться кілька реальних задач, виконаних з модом.
- Поширення через маркетплейс (`.claude-plugin/marketplace.json`) — return when: розробник вирішить ділитися модом.

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
| 2026-10-08 | Initial version: фаза 1 виконана й перевірена наживо; фази 2–6 і backlog |
| 2026-10-08 | Погодження дизайну: PL_CTX_DEC_02 = B (теги перед медіа), C_CTX_DEC_09 = A (фаза 6 виконана рішенням) |
| 2026-10-08 | Фаза 3 (теги) виконана: 61 + 6 модульних тестів, живі сценарії pass; навичка claude-code-plugin-hooks створена; backlog — ціль тегу без tool_use_id |
| 2026-10-08 | Фаза 7 — псевдоніми викликів (перед медіа, PL_CTX_DEC_03); пункт backlog про ціль тегу без tool_use_id перенесено у фазу 7 |
| 2026-10-08 | Фаза 7 виконана: 77 + 6 тестів; живий сценарій «Тег за псевдонімом» pass — жодного context_list, теги за c1..c5 |
| 2026-10-09 | Фаза 2 виконана: три живі сценарії медіа pass, обидва припущення підтверджено; backlog — старі рядки в перегляді, обрізаний опис context_edit, подвійний base64 в архіві |
| 2026-10-09 | Фаза 8: три знахідки фази 2 з backlog стали фазою (рішення розробника — виправити всі); спайк межі компактизації → SP_CTX_DEC_07 |
| 2026-10-09 | Фаза 8 виконана: 91 + 6 тестів; живий сценарій «Перегляд після компактизації» pass; рев'ю раунд 4 FAIL → виправлено, раунд 5 PASS. Не спостерігалось наживо: автоматична компактизація посеред ходу |
| 2026-10-09 | Фаза 9 — передача в нову сесію (C_CTX §3.6, SP_CTX 01_15–01_16, 02_19–02_24); пункт backlog про нову сесію став фазою |
| 2026-10-09 | Фаза 9 виконана: 115 + 6 тестів; живі сценарії передачі pass; рев'ю раунди 6–8 FAIL → виправлено (останнє — механічне підтвердження і живий прогін) |
| 2026-10-09 | Фаза 10 — один плагін, компактизація `command.run('compact')`, передача засівом очищеної сесії (спайк context_editor_handoff_long; C_CTX DEC_02, DEC_09, DEC_11–DEC_14; SP_CTX 02_06, 02_21–02_26); PL_CTX_DEC_04; технологічні рішення без тригера і `check-shared.sh` |
| 2026-10-09 | Рев'ю раунд 9 (дизайн фази 10): Implements фази 10 — 01_05, 03_02; `observedBoundary` — у `compaction.ts`; propagate — кореневий README і навичка хоста; повторні сценарії — теги; одноразовий `-p` поза обсягом |
| 2026-10-09 | Рев'ю раунд 10 і спайк Entry 4: фаза 10 — лічильник ходів (`turns.ts`), без прибирання мітки, AutoTag без копій, `owner`/in-flight передачі, Verify за новими критеріями; хост ≥ 2.1.295 |
| 2026-10-09 | Рев'ю раунд 11: «Запасний шлях до очищення» — в обох хостах без документа агента |
| 2026-10-09 | Рев'ю раунд 12: ескіз фази 10 — `inTurn` скидається після кожного ходу, перевірка перед командою, HandedOff першим після звірки; Implements 01_15 повний |
| 2026-10-09 | Рев'ю раунд 14: Verify — ще два рядки 05_04; лічильник ходів з `lastTurnAborted` |
| 2026-10-09 | Фаза 10 виконана: 203 тести; рев'ю коду раунди 16–19; Verify FAIL (A, B, C, D, E, F) → виправлено (спайк Entry 5 — злиття за `message.id`) → повторний Verify PASS у TUI і stream-json; backlog — довіра межі після перезавантаження (G), звіт при 0 правок (H), реєстри після передачі (N1), R1 у VS Code (I) |
| 2026-10-09 | Фаза 11: G (довіра межі за процесом хоста, SP_CTX_DEC_10), H, N1, J (`earlyPrompt` лише при обрізаному API-поданні); у backlog — K (правки після `--resume`) |
| 2026-10-09 | Фаза 11 виконана: 234 тести; рев'ю коду раунди 23–24; Verify PASS у TUI і stream-json, крім «Відновлення сесії (лише текст)» з thinking → backlog K (перший крок) |
| 2026-10-09 | Фаза 12 виконана: KeepResponsesWhole на весь відрізок; 235 тестів; рев'ю раунд 25 (WARNINGS → виправлено); Verify PASS в обох хостах («Відновлення сесії (лише текст)» з thinking, «Незмінене медіа») |
| 2026-10-09 | Backlog: пункт L (міграція межі зі старого формату) прибрано — рішення розробника: міграції не потрібні |
| 2026-10-09 | Фаза 13: покрокове вибіркове чищення за переглянутим C_CTX_DEC_04 |
| 2026-10-09 | Backlog: перегляд стратегії нагадувань (M), дослідження впливу змінного контексту на якість завдань |
| 2026-10-10 | Backlog M злито з етапами завдання (окрема задача task_20261010_083402_stage-cleanup); фазу-кандидат 14 скасовано |
| 2026-10-10 | Фази 14 (ядро етапів) і 15 (авторозмітка, діапазон, слот стану, журнал) за SP_CTX 2026-10-10; PL_CTX_DEC_05 — ядро спершу, практика перед фазою 15; фаза 13 закрита без живого Verify (нагадування прибирає фаза 14) |
| 2026-10-10 | Фаза 14 виконана: етапи, мітка оптимізації, телеметрія, вступ і навичка, без нагадувань; 304 тести; живі сценарії pass в обох хостах; D1 MergeCallRows; рев'ю 36 |
| 2026-10-10 | Фаза 16 — службові нотатки агента (C_CTX_DEC_20; SP_CTX 01_21, 02_32, 02_33): окремий інструмент `context_note`, нагадування з результатом виклику інструменту, перенесення на рядок заміни |
| 2026-10-10 | Фаза 16 виконана: службові нотатки агента (`context_note`), нагадування, перенесення на рядок заміни; 331 тест; живий сценарій «Нотатки і нагадування» pass в обох хостах; рев'ю 37 (WARNINGS → виправлено), 38 (confirm) |
