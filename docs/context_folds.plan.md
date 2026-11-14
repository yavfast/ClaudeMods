# Implementation Plan: Згортки й пам'ять завдань  {#PL_FOLD}

> **Code:** PL_FOLD
> **Status:** draft
> **Created:** 2026-11-14
> **Updated:** 2026-11-14
>
> **Concept:** [C_FOLD](./context_folds.concept.md)
> **Specification:** [SP_FOLD](./context_folds.sp.md)
> **Depends on:** [PL_CTX](./context_editor.plan.md) — фази 1–48 мода context-editor виконано; цей план додає механізми в той самий мод
> **Used by:** —
>
> План реалізації згорток у моді `mods/context-editor`: облік згорток, розгортання з поверненням, згортка зі словами людини; далі порівняльний прогін, якого чекають вкладені області й службові вставки.

## Goal

Одна довга сесія лишається придатною для послідовних завдань: виконані завдання не тиснуть на поточне, а їхній досвід можна згадати (намір задачі `task_C_FOLD`). Коли план виконано, агент згортає область будь-якого розміру в один запис з ідентифікатором, розгортає її рівень за рівнем у кінець контексту, згадане повертається саме, завдання й етапи вкладаються, а сигнали після ходу агент дає службовими вставками. Фази 1–3 дають згортку завдання й згадування; фаза 4 перевіряє головне припущення концепту ([C_FOLD_DEC_14](./context_folds.concept.md#C_FOLD_DEC_14)); фази 5–6 починаються лише після її висновку.

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Мова й середовище | TypeScript, function hooks хоста Claude Code, як увесь мод | стандарт проєкту (`CLAUDE.md`) |
| Розкладка коду | шаблон портів: чиста логіка в `hooks/folds.ts` (порти `FoldIO`, `RecallIO`) і `hooks/trailers.ts`; `hooks/register.ts` лише зв'язує з `$` | правило STRUCT-02 і `CLAUDE.md` «Ports pattern» |
| Сховище обліку | дев'ятий Store сесії `folds.json` через `jsonFile` на власному ланцюжку рангу 4 | [SP_FOLD_DEC_05](./context_folds.sp.md#SP_FOLD_DEC_05); `serialChains` у `hooks/store.ts` |
| Читання архіву | `$.process.run(['cat', path])`, як запис архіву через процес | межа 4 MiB у `$.fs.read` (`CLAUDE.md`); межу виводу процесу перевіряє живий прогін фази 2 |
| Інструмент розгортання | `context_recall` у `TOOLS` (`hooks/tools.ts`), хук `tool.call` з літеральним зіставленням і `.catch` | контракт хоста; [SP_FOLD_DEC_01](./context_folds.sp.md#SP_FOLD_DEC_01) |
| Правка повернення | запис черги `summarize` з `via: 'return'`; розбір черги (`hooks/queue.ts`) приймає третє значення `via` | [SP_FOLD_DEC_06](./context_folds.sp.md#SP_FOLD_DEC_06) |
| Тексти інструментів | описи `context_edit` і `context_tag` скорочуються під нові поля; довжину тримає `tests/boundary.test.ts` (MAX_DESCRIPTION 2048) | описи впритул до межі |
| Тести | `claude plugin test mods/context-editor`: нові `tests/folds.test.ts`, `tests/trailers.test.ts`; доповнення наявних | практика мода |
| Живі прогони | потоковий неінтерактивний хост і термінал, мод як керований плагін (`install.sh`) | без керованих налаштувань хост обходить хуки мода (спайк, Entry 13) |

## Required Knowledge

| Kind | Ref | Applies to | Note |
|------|-----|-----------|------|
| rule | CONC-01, CONC-02 | Фази 1, 2, 3 | тека сховища раз на операцію; облік згорток пишеться в точці фіксації, після останньої перевірки переривання |
| rule | STRUCT-01, STRUCT-02, STRUCT-03 | усі фази з кодом | предикати й літерали — в `rows.ts`; рішення не в `register.ts`; теки — від `projectRoot($)` |
| rule | ERR-01 | Фази 1, 2 | проковтнутий збій лишає один рядок журналу з міткою й помилкою |
| rule | PROC-01 | усі фази | час у файлах задач — з годинника чи git |
| skill (apply) | claude-code/plugin-hooks (+ тематичні файли) | усі фази з кодом | `stale` (2.1.296; хост 2.1.325): перед опорою на пункт про `session.append`, `tool.call` чи команди звірити живим прогоном |
| skill (apply) | context-editing/HistoryEditingEvidence | Фази 2, 3 | авторство тексту заміни, походження |
| skill (apply) | context-editing/ServiceInfoEvidence | Фази 2, 6 | службові рядки — факти; вставки |
| skill (update) | claude-code/plugin-hooks | Фаза 2 | внести факти зондів і живих прогонів на 2.1.325: рядки відповіді в `session.append`, `turn.step`, повідомлення про оминуті хуки, `--resume` переписаного транскрипту |
| skill (update) | context-editing/ServiceInfoEvidence | Фаза 4 | результат порівняльного прогону |

## Progress

- [x] [Phase 1 — Облік згорток](#PL_FOLD_P1)
- [x] [Phase 2 — Розгортання й повернення згаданого](#PL_FOLD_P2)
- [ ] [Phase 3 — Згортка зі словами людини й обхід закріплених рядків](#PL_FOLD_P3)
- [ ] [Phase 4 — Порівняльний прогін](#PL_FOLD_P4)
- [ ] [Phase 5 — Вкладені області й завдання](#PL_FOLD_P5)
- [ ] [Phase 6 — Службові вставки](#PL_FOLD_P6)

## Phases

Кожна фаза з кодом проходить повний цикл: тести, рев'ю з чистим контекстом, живий прогін, коміт. У тій самій фазі оновлюються тексти для агента (описи інструментів, навичка мода `skills/context-stages/`), розділи SP_CTX з таблиці [SP_FOLD_03_03](./context_folds.sp.md#SP_FOLD_03_03) і розділи C_CTX, які фаза змінює. Перевірки входів [SP_FOLD_03_01](./context_folds.sp.md#SP_FOLD_03_01) і інваріанти [SP_FOLD_03_02](./context_folds.sp.md#SP_FOLD_03_02) реалізує та фаза, що вводить відповідний контракт; відкат [SP_FOLD_06](./context_folds.sp.md#SP_FOLD_06) перевіряє фаза 2 (черга з правкою повернення) і фаза 5 (реєстр із `outer`).

### Phase 1 — Облік згорток (`hooks/folds.ts`) [DONE]  {#PL_FOLD_P1}

**Depends on:** none
**Implements:** [SP_FOLD_01_01](./context_folds.sp.md#SP_FOLD_01_01), [SP_FOLD_01_02](./context_folds.sp.md#SP_FOLD_01_02), константи FOLD_PREFIX, MAX_FOLDS, FOLD_NOTE з [SP_FOLD_01_06](./context_folds.sp.md#SP_FOLD_01_06), [SP_FOLD_02_01](./context_folds.sp.md#SP_FOLD_02_01), параметр `folds` з [SP_FOLD_02_07](./context_folds.sp.md#SP_FOLD_02_07) без позначки `recalled`
**Verify:** [SP_FOLD_05_01](./context_folds.sp.md#SP_FOLD_05_01) рядки RecordFolds (крім «картка завдання») і «Перелік: `folds`» без позначок `card` і `recalled`; [SP_FOLD_05_02](./context_folds.sp.md#SP_FOLD_05_02) «номер згортки не повторюється», «облік не росте»; [SP_FOLD_05_04](./context_folds.sp.md#SP_FOLD_05_04) «облік не читається» — плюс: живе застосування дає запис із `fold f1` і файл `folds.json`

What to create:
| Entity | Module | Purpose |
|--------|--------|---------|
| FoldEntry, FoldLedger, розбір, `assignFoldIds`, `recordFolds` | `hooks/folds.ts` | чиста логіка обліку |
| Store `folds.json` | `hooks/store.ts`, `hooks/register.ts` | дев'ятий Store сесії, ранг 4 |
| FOLD_NOTE й ідентифікатор у тексті заміни | `hooks/rows.ts`, `hooks/edits.ts` | хвіст запису згортки |
| Призначення номерів до побудови рядків і запис у точці фіксації | `hooks/compaction.ts` | [SP_FOLD_02_01](./context_folds.sp.md#SP_FOLD_02_01) |
| `region` запису з названого блоку `lastClosed`, у записі черги | `hooks/queue.ts`, `hooks/folds.ts` | у цій фазі — лише `kind: 'stage'` |
| Параметр `folds` перегляду | `hooks/stages.ts`, `hooks/tools.ts` | перелік обліку |

Notes:
- Старі сесії: записи з хвостом ` (original: …, open with Read)` лишаються чинними; предикати замін не змінюються.

Docs: [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12), [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04), [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07), [SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01), `docs/_framework.md`, `CLAUDE.md` (новий модуль і файл сесії).

### Phase 2 — Розгортання й повернення згаданого (`hooks/folds.ts`, `hooks/tools.ts`) [DONE]  {#PL_FOLD_P2}

**Depends on:** Phase 1
**Implements:** [SP_FOLD_01_03](./context_folds.sp.md#SP_FOLD_01_03), решта констант розгортання з [SP_FOLD_01_06](./context_folds.sp.md#SP_FOLD_01_06), [SP_FOLD_02_02](./context_folds.sp.md#SP_FOLD_02_02), [SP_FOLD_02_03](./context_folds.sp.md#SP_FOLD_02_03), [SP_FOLD_02_07](./context_folds.sp.md#SP_FOLD_02_07) (позначка `recalled`, число згадувань у заголовку), [SP_FOLD_02_08](./context_folds.sp.md#SP_FOLD_02_08), [SP_FOLD_02_09](./context_folds.sp.md#SP_FOLD_02_09), [SP_FOLD_04_01](./context_folds.sp.md#SP_FOLD_04_01)
**Verify:** [SP_FOLD_05_01](./context_folds.sp.md#SP_FOLD_05_01) рядки Recall, MarkDue, AddReturns, «Повернення», «Передача», DropOwnCalls, «Перелік: заголовок»; [SP_FOLD_05_02](./context_folds.sp.md#SP_FOLD_05_02) «правка повернення не стає в чергу сама»; [SP_FOLD_05_03](./context_folds.sp.md#SP_FOLD_05_03) сценарії «повернення», «вкладена згортка», «розгортання після відновлення сесії», перша половина «хост обходить компактизацію»; [SP_FOLD_05_04](./context_folds.sp.md#SP_FOLD_05_04) великий архів, «запис згортки зник після чужої компактизації», «повернення й `keep_cache`»

What to implement:
- `recall`, `pruneRecalls`, подання рівня (зміст рівня, частина, обрізання рядка) у `hooks/folds.ts`; порт читання архіву через процес.
- Інструмент `context_recall` у `TOOLS`, хук `tool.call`, відмови субагентам і на хості, що обходить компактизацію.
- `markDue` при закритті етапу (`hooks/tags.ts`, `hooks/stages.ts`); `addReturns` після прийнятої правки (`hooks/queue.ts`) і після постановки замін із тегів (`hooks/tags.ts`).
- Третє значення `via` в черзі й її розборі, порожній `summary` лише з ним (`checkShape` у `hooks/edits.ts`); `summarize`, тег `disposable` і `drop` агента над парою розгортання; виконання правки повернення без архіву (`hooks/edits.ts`); мітка й речення звіту.
- Пари розгортання в `dropOwnCallsCounted`, у правилі рядків, що йдуть (`hooks/compaction.ts`), і в перевірці залежностей.
- Перенесення обліку при передачі й номери для згорток засіву (`hooks/handoff.ts`).
- У цій фазі область — чинний плаский етап: `depth` дорівнює 0 або 1.

Docs: [SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03), [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [SP_CTX_02_64](./context_editor.curation.edits.sp.md#SP_CTX_02_64), [SP_CTX_02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36), [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13), [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21); у C_CTX — [C_CTX_DEC_08](./context_editor.core.concept.md#C_CTX_DEC_08), [C_CTX_DEC_18](./context_editor.core.concept.md#C_CTX_DEC_18), [C_CTX_06_07](./context_editor.curation.concept.md#C_CTX_06_07); навичка мода й вступ сесії — як згадувати.

### Phase 3 — Згортка зі словами людини й обхід закріплених рядків (`hooks/queue.ts`, `hooks/edits.ts`) [TODO]  {#PL_FOLD_P3}

**Depends on:** Phases 1, 2
**Implements:** [SP_FOLD_02_04](./context_folds.sp.md#SP_FOLD_02_04), MAX_KEEP
**Verify:** [SP_FOLD_05_01](./context_folds.sp.md#SP_FOLD_05_01) рядки FoldSpan — плюс живий прогін: чи приймає хост розмову, що починається записом згортки (якщо так, відмову HEAD_ROW можна зняти окремим рішенням); [SP_FOLD_05_02](./context_folds.sp.md#SP_FOLD_05_02) «обійдені рядки…», «запис згортки діапазону не є рядком людини»; [SP_FOLD_05_03](./context_folds.sp.md#SP_FOLD_05_03) «згортка з повідомленням людини», «згортка завдання й згадування»; [SP_FOLD_05_04](./context_folds.sp.md#SP_FOLD_05_04) «проміжок із медіа промпту»

What to implement:
- `personRefusal`, `screenPerson`, `personTagRefusal` (`hooks/queue.ts`, `hooks/tags.ts`): відмова лишається для `drop`, `rewrite`, `describe` і для доставленого посеред ходу.
- Поле `keep` з якорями, обхід `pin`, слота стану й `keep`, місце й роль запису, відмова HEAD_ROW у підготовці й виконанні `collapse` (`hooks/edits.ts`); повторна перевірка на застосуванні (`hooks/compaction.ts`, `screenPinned`); діапазонний тег `disposable` (`hooks/tags.ts`).
- Схема й опис `context_edit` (`hooks/tools.ts`): поле `keep`, нове правило слів людини; скорочення опису до межі.
- Тексти для агента: навичка мода (`SKILL.md`, `curation.md`), вступ сесії, порада закриття етапу, текст ходу `/compact` людини — нове правило замість «повідомлення людини лишаються дослівно».

Docs: [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58), [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11); у C_CTX — усі місця, названі в [C_FOLD_04_01](./context_folds.concept.md#C_FOLD_04_01): [C_CTX_DEC_38](./context_editor.curation.concept.md#C_CTX_DEC_38), [C_CTX_DEC_34](./context_editor.curation.concept.md#C_CTX_DEC_34), [C_CTX_DEC_23](./context_editor.methods.concept.md#C_CTX_DEC_23), [C_CTX_DEC_17](./context_editor.methods.concept.md#C_CTX_DEC_17), [C_CTX_DEC_04](./context_editor.methods.concept.md#C_CTX_DEC_04), [C_CTX_06_02](./context_editor.curation.concept.md#C_CTX_06_02), [C_CTX_06_03](./context_editor.curation.concept.md#C_CTX_06_03), [C_CTX_06_09](./context_editor.curation.concept.md#C_CTX_06_09), [C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10), [C_CTX_01_01](./context_editor.concept.md#C_CTX_01_01), [C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), [C_CTX_03_03](./context_editor.core.concept.md#C_CTX_03_03), [C_CTX_03_04](./context_editor.core.concept.md#C_CTX_03_04), [C_CTX_03_11](./context_editor.core.concept.md#C_CTX_03_11).

### Phase 4 — Порівняльний прогін [TODO]  {#PL_FOLD_P4}

**Depends on:** Phases 2, 3
**Implements:** тригер [C_FOLD_DEC_14](./context_folds.concept.md#C_FOLD_DEC_14)
**Verify:** [SP_FOLD_05_03](./context_folds.sp.md#SP_FOLD_05_03) «порівняльний прогін» — звіт із числами за рукавами у спайку [context_service_info](./context_service_info.spike.md); рішення DEC_14 закриває розробник

What to do:
- Скласти послідовність із 4–6 малих завдань одного проєкту з закладеними конфліктами (застарілий факт, вказівка одного завдання, що не має діяти в наступному) і нагодами повторного використання.
- Три рукави: сира історія; завдання згорнуті в картки; картки з розгортанням. Моделі — sonnet і opus; число прогонів на клітинку й межу сесій розробник погоджує перед запуском (ворота вартості фази дослідження).
- Міри: чи спрацювала пастка; чи використано минулий досвід; чи агент перечитував джерела; розмір контексту.
- Коду мода фаза не змінює. Наступні фази чекають висновку.

### Phase 5 — Вкладені області й завдання (`hooks/tags.ts`, `hooks/stages.ts`) [TODO]  {#PL_FOLD_P5}

**Depends on:** Phase 4 (висновок DEC_14), Phase 2
**Implements:** [SP_FOLD_01_04](./context_folds.sp.md#SP_FOLD_01_04), MAX_DEPTH, [SP_FOLD_02_05](./context_folds.sp.md#SP_FOLD_02_05), ланцюжок у заголовку з [SP_FOLD_02_07](./context_folds.sp.md#SP_FOLD_02_07), [SP_FOLD_04_02](./context_folds.sp.md#SP_FOLD_04_02)
**Verify:** [SP_FOLD_05_01](./context_folds.sp.md#SP_FOLD_05_01) рядки «Області», «MarkDue: глибина», «RecordFolds: картка завдання», позначка `card` переліку; [SP_FOLD_05_02](./context_folds.sp.md#SP_FOLD_05_02) «реєстр чинного мода читається», «`outer` без `stage` нормалізується», «завдання лише зовнішнє»; [SP_FOLD_05_04](./context_folds.sp.md#SP_FOLD_05_04) «закриття зовнішньої області»

What to implement:
- Поля `outer` і `kind` у реєстрі, нормалізація при читанні; перенесення меж усіх областей ланцюжка після застосування (`relocateStageMarks`).
- `open` з `task` і `nested`, `close` з `task`; `lastClosed` для закритого ланцюжка; `depth` і `scope` згадування з ланцюжка.
- Заголовок перегляду й позначки рядків для ланцюжка; схема й опис `context_tag`.
- Навичка мода: завдання, картка завдання (шаблон полів), вкладення.

Docs: [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10), [SP_CTX_01_18](./context_editor.records.sp.md#SP_CTX_01_18), [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11); у C_CTX — [C_CTX_02_01](./context_editor.core.concept.md#C_CTX_02_01), [C_CTX_DEC_16](./context_editor.methods.concept.md#C_CTX_DEC_16).

### Phase 6 — Службові вставки (`hooks/trailers.ts`) [TODO]  {#PL_FOLD_P6}

**Depends on:** Phase 5
**Implements:** [SP_FOLD_01_05](./context_folds.sp.md#SP_FOLD_01_05), MAX_TRAILERS, TRAILER_HEAD, [SP_FOLD_02_06](./context_folds.sp.md#SP_FOLD_02_06)
**Verify:** [SP_FOLD_05_01](./context_folds.sp.md#SP_FOLD_05_01) рядки ParseTrailers, «Вставки», «MarkDue: без області»; [SP_FOLD_05_02](./context_folds.sp.md#SP_FOLD_05_02) «вставки не запускають застосування»; [SP_FOLD_05_03](./context_folds.sp.md#SP_FOLD_05_03) «вставки», друга половина «хост обходить компактизацію»; [SP_FOLD_05_04](./context_folds.sp.md#SP_FOLD_05_04) вставка в ході оптимізації

What to implement:
- `parseTrailers` у `hooks/trailers.ts`; `detectOptimize` (`hooks/stages.ts`) виконує сигнали замість перевірки одного рядка.
- `close` і `note` наприкінці ходу; рядки стану для нерозпізнаної вставки й невдалої нотатки.
- Навичка мода й вступ сесії: три вставки.

Docs: [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30); у C_CTX — [C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30) (мітка стає однією зі вставок).

## Backlog

- Безпекові механізми: відбиток архіву при розгортанні; рядки в чужому виводі, схожі на тексти мода; хеш-ланцюг журналу — owner: розробник; return when: основний функціонал працює стабільно й відповідає очікуванням ([C_FOLD_DEC_15](./context_folds.concept.md#C_FOLD_DEC_15)).
- Згадування за підказкою мода й пошук по архівах — return when: розбір реальної сесії з картками покаже, що агент заново шукав чи читав те, що лежало в картці ([C_FOLD_DEC_03](./context_folds.concept.md#C_FOLD_DEC_03)).
- Життєвий цикл уроків і консолідація карток — return when: розмір карток у сесії стане помітним у телеметрії.
- Облік згадувань і промахів пам'яті, запис розгортань у журнал ефекту — return when: береться пункт «облік етапу» з backlog [PL_CTX](./context_editor.plan.md).
- Подвійне застосування після сумніву агента в посиланнях `c1` і `last` (спайк, Entry 13) — return when: повториться в живому прогоні фаз 1–3; тоді окрема задача `fix`.
- Прибирання вставок з відповіді з інструкцією про це — return when: розробник попросить; зонд спайку (Entry 11) показав точки прибирання.
- Термінальний хост і розширення VS Code після керованих налаштувань — return when: живий прогін фази 1.
- Дев'ять розбіжностей між SP_CTX і кодом, знайдені розвідкою контрактів (попередження проти відмови за слова людини, формат тексту переписаного слота, шляхи архівів та інші; перелік — у файлі задачі `task_C_FOLD`) — owner: розробник; return when: `/dev-flow audit docs` або фаза, що править той самий розділ.
- Прототипи зондів у `.dev_flow/proto/` — owner: розробник.
- Архіви перенесених згорток після пакування старої сесії: розгортання дає ARCHIVE_UNREADABLE (рев'ю фази 2, P6) — return when: живий випадок у сесії після передачі, або береться пункт про прибирання старих сесій.
- Правка повернення пари поза вікном API не застосовується й стає в чергу з кожним пакетом знову (рев'ю фази 2, P7) — return when: повториться в живій сесії.
- Рядок стану й речення передачі для людини рахують у «queued edit(s)» і правки повернення мода (рев'ю фази 2, P2) — return when: фаза 3 або наступна правка цих текстів.
- Предикат «виклик розгортання» в `hooks/edits.ts` повторено п'ять разів (рев'ю фази 2, P5) — return when: наступна зміна цих місць.

## Design Decisions  {#PL_FOLD_DEC}

### DEC_01 — Чи переносити прототип інструмента розгортання  {#PL_FOLD_DEC_01}

> **Status:** resolved (agent)
> **Date:** 2026-11-14

**Question:** копія мода з інструментом `context_recall` із зонда (`.dev_flow/proto/recall/`) — основа фази 2 чи лише довідка?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — писати наново за специфікацією; прототип лишається довідкою | код відповідає контрактам; прототип не має обліку й повернення |
| B — перенести файли прототипу | швидший старт, але прототип вимикав перевірки мода й обходив чергу |

**Decision:** A.
**Rationale:** прототип відповідав на питання зонда (форма рядка згаданого), а не на контракти SP_FOLD; перенесення потребує слова розробника, якого не було.
**Rejected because:** B — більшість файлів довелося б переписати.

### DEC_02 — Порядок фаз до порівняльного прогону  {#PL_FOLD_DEC_02}

> **Status:** resolved (agent)
> **Date:** 2026-11-14

**Question:** що має бути реалізовано до прогону, якого вимагає C_FOLD_DEC_14?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — облік, розгортання з поверненням і згортка зі словами людини; завдання в прогоні — плаский етап | найменший обсяг, що дає «картку завдання» й згадування |
| B — ще й вкладені області до прогону | більше коду на неперевіреному припущенні |

**Decision:** A.
**Rationale:** згортання діапазону разом із повідомленнями людини вже є карткою завдання; вкладення на результат порівняння не впливає.
**Rejected because:** B — суперечить меті тригера: обмежити роботу до перевірки.

## Changelog

| Date | Change |
|------|--------|
| 2026-11-14 | Initial version |
| 2026-11-14 | Рев'ю (раунд 1) і рішення розробника: фазу примітки про схожі рядки й відбиток архіву прибрано в backlog; фаз шість; фаза 3 залежить і від фази 2; позначка `recalled` і число згадувань — у фазі 2 |
