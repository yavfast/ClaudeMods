# Архітектурна карта: context-editor

> **Status:** active
> **Updated:** 2026-10-17 (аудит коду 20261017_101904: граф 27 модулів, цикл L6 з `capabilities`, кандидати абстракцій PL_AUD2_CTX)
>
> Жива карта шарів мода `mods/context-editor` — огляд і посилання, не правила. Деталі й обов'язкові обмеження живуть у джерелах нижче; ця карта їх не повторює. Підтримують її лише `onboard` і `audit code`, не фічі.

## Джерела

- [CLAUDE.md](../CLAUDE.md) — що робить мод, команди, патерн портів, список модулів і їхніх IO-інтерфейсів, поведінка хоста.
- [.dev_flow/skills/claude-code/plugin-hooks.md](../.dev_flow/skills/claude-code/plugin-hooks.md) — пастки хоста (форма хука, `.catch`, `$.command.run`, `session.compact`, межі `$.fs`).
- Правила: [concurrency.md](../.dev_flow/rules/concurrency.md) (CONC-01, CONC-02), [structure.md](../.dev_flow/rules/structure.md) (STRUCT-01 — один дім предиката й літерала; STRUCT-02 — рішення не в `register.ts`), [errors.md](../.dev_flow/rules/errors.md) (ERR-01 — слід проковтнутої помилки); маршрутизатор — [_index.yaml](../.dev_flow/rules/_index.yaml).
- [docs/_index.md](./_index.md) — маршрутизатор документів і карта префіксів ID.
- Концепт: [context_editor.concept.md](./context_editor.concept.md) (парасолька) + [ядро й інструменти](./context_editor.core.concept.md), [методи оптимізації](./context_editor.methods.concept.md), [курування історії](./context_editor.curation.concept.md); специфікація: [context_editor.sp.md](./context_editor.sp.md) і дочірні `context_editor.<module>.sp.md`; план: [context_editor.plan.md](./context_editor.plan.md).
- Аудити: [PL_AUD2_CTX](../.dev_flow/audit/context-editor_20261017_101904.plan.md) (поточний, CF2-ідентифікатори нижче), [PL_AUD_CTX](../.dev_flow/audit/context-editor_20261011_182951.plan.md) (completed, CF-ідентифікатори).

## Патерн портів

Чиста логіка в `hooks/<module>.ts` за малими IO-інтерфейсами: сховище й стан (`PrepareIO`, `FileIO`, `QueueIO`, `TagIO`, `AppendIO`, `AliasIO`, `JournalIO`, `DeliveryIO`, `HostRowsIO`, `AttachIO`/`AttachApplyIO`/`AttachPort`), застосування і спостерігачі (`CompactionIO`, `ObserveIO`, `FailureIO`, `RepairIO`, `NeedsIO`, `RepairHandlerIO`), хід і команди (`FlushIO`, `TurnEndIO`, `PersonCompactIO`, `HandoffIO`, `SeedIO`), перегляд (`ViewIO`, `ListIO`, `BlockIO`, `DetectIO`, `CalibrateIO`, `HintIO`), можливості хоста (`CapabilityIO`, `ProbeIO`, `PassedCompactIO`), прибирання й субагенти (`CleanupIO`, `ShapeIO`). Повний список з поясненнями — у CLAUDE.md. `hooks/register.ts` — єдиний модуль, що бачить `$`, і лише прив'язує ці інтерфейси до хоста; статичні метадані інструментів — `hooks/tools.ts`. Тести (`tests/*.test.ts`) викликають чисті функції з фейковим IO. Рішення: [PL_CTX_DEC_01](./context_editor.plan.md#PL_CTX_DEC_01); правило — STRUCT-02. Відоме відхилення: з фаз 32–46 логіка можливостей, брифу, ProbeMode, теки архіву й підсумку маршрутів компактизації знову в `register.ts` (910 → 1772 рядки) — PL_AUD2_CTX CF2-30. Обмеження валідатора на передачу `$` — у CLAUDE.md.

## Шари модулів (граф імпорту значень)

Нижчий шар не імпортує вищий. `t:` — лише типи. Граф — на HEAD 1e653e7 (27 модулів, 15 734 рядки).

| Шар | Модулі | Імпортують |
|-----|--------|-----------|
| L0 | `rows` (ядро рядків: предикати, пошук пари, розміри, префікси тексту мода, відкривачі замін, маркери), `turns` | — |
| L1 | `media`, `store`, `state` (пункти слоту стану, ф44) | rows |
| L2 | `deliveries`, `hostrows` (рядки хоста, ф45), `cleanup` (старі сесії, ф36) | deliveries: media, rows, store; hostrows: rows, store; cleanup: store |
| L3 | `edits` | deliveries, hostrows, media, rows, state |
| L4 | `cache`, `hostattach`, `queue`, `aliases`, `subagents` (обрізання результатів субагента, ф34) | cache: edits, rows; hostattach: edits, rows, store; queue: deliveries, edits, hostrows, rows, store, t: stages; aliases: edits, rows, store; subagents: edits |
| L5 | `journal` | edits, queue, store |
| L6 | `tags` ⇄ `stages` ⇄ `notes` ⇄ `capabilities` (цикл значень) | edits, rows, store; tags також queue, state, t: deliveries; stages також aliases, cache, hostrows, t: journal, queue; capabilities також deliveries, t: notes, queue |
| L7 | `tools` (метадані інструментів), `repair` (ремонт після відновлення, ф32) | tools: edits, notes, queue, rows, stages, state, tags; repair: aliases, deliveries, edits, notes, queue, rows, store, t: compaction, journal, tags |
| L8 | `hints`, `compaction` | hints: aliases, cache, edits, rows, stages, tags; compaction: aliases, deliveries, edits, hostattach, hostrows, journal, notes, queue, repair, rows, state, tags, t: store |
| L9 | `flush`, `handoff` (оркестратори) | flush: compaction, queue, rows, stages, turns; handoff: aliases, capabilities, compaction, deliveries, edits, media, notes, queue, repair, rows, stages, store, tags, turns |
| L10 | `personcompact` (власна `/compact` людини) | capabilities, flush, rows, t: queue, store |
| L11 | `register` | 23 з 26: усі, крім cache, media, state |

Хаби за fan-in (значення й типи): `rows` (22), `store` (17), `edits` (16), `queue` (12), `tags` (10), `stages`, `notes`, `deliveries` (по 8). Відомі відхилення від шарів:

- цикл L6 виріс до чотирьох модулів: `capabilities` у ньому лише тому, що `stages` бере з нього текст PASSED_ADVICE, а він — операції реєстру з `tags` (CF2-44 виводить його з циклу; агрегат реєстру — CF2-58);
- `queue` → `stages` (тип `Replaced`), `repair` → `compaction` (тип) при `compaction` → `repair` (значення: ядро ApplyLedger/DropPulled в оркестраторі ремонту) — CF2-55;
- реекспорти: ~25 імен в 11 інструкціях (`queue` → маркери й `SUMMARY_OPENER`, `compaction` → `MARKER`, `mediaExt`, `handoff` → `SUMMARY_OPENER`, `ROW_WINDOW`, …) — літерал ядра досяжний двома–чотирма шляхами (CF2-49).

## Де живе стан

- **Диск, на сесію:** `$HOME/.claude/context-editor/<session_id>/` (700): `pending.json` (черга), `tags.json` (реєстр: теги, етапи, нотатки, підказка, `lastApply`, пункти слоту — один файл за [C_CTX_DEC_07](./context_editor.core.concept.md#C_CTX_DEC_07), [C_CTX_DEC_20](./context_editor.core.concept.md#C_CTX_DEC_20)), `aliases.json`, `boundary.json` (довіра — [SP_CTX_DEC_10](./context_editor.decisions-01.sp.md#SP_CTX_DEC_10)), `journal.json`, `deliveries.json`, `hostattach.json`, `ledger.json` (ApplyLedger, ф32), `hostrows.json` (ф45), `archives.txt`, файли засіву. Структури — [SP_CTX_01](./context_editor.structures.sp.md).
- **Диск, у проєкті:** архіви замінених оригіналів і медіа — `<cwd>/.claude/context-editor/<session_id>/` (ArchiveRoot, [C_CTX_DEC_28](./context_editor.core.concept.md#C_CTX_DEC_28); запасний шлях — тека сховища), архіви субагентів — `…/subagents/<agentId>/`.
- **Диск, на машину:** `<root>/capabilities.json` (вердикти можливостей хоста за версією, ф38; без ланцюжка й атомарного запису — CF2-11), `<root>/.sweep`, `.sweep.lock`, `<id>.zip`, `<id>.where` (прибирання, [C_CTX_DEC_29](./context_editor.core.concept.md#C_CTX_DEC_29)); корінь спільний для всіх тек конфігурації хоста — CF2-3.
- **Пам'ять інстансу модуля** (`register.ts`): опублікована пара сесія + тека сховища і підготовки в польоті (`store.ts`), кеш файлів реєстрів з епохою (`FileCache`), ідентичність хост-процесу, власна межа, лічильник ходів, стан Flush, передачі й ремонту, скопійовані id результатів, вікно копій і останній видимий рядок (`hostrows.ts`), якір доставки, мемо підказки, каталог вкладень хоста (AttachMemory), вердикти можливостей (`Capabilities`) і стан брифу, ланцюги `serial` на файл.
- **Порядок RMW:** один ланцюг `serial` на вид файлу, типізовані ключі з рангами (`CHAIN_RANK` у `store.ts`): queue (1) → tags (2) → aliases (3) → deliveries | journal | hostattach | ledger | hostrows (4); вкладення лише queue → tags → aliases (крок фіксації компактизації), queue → deliveries, tags → deliveries; вкладення нижчого чи того самого рангу з явно переданим тримачем → налагоджувальний журнал. Обмеження: `Store.update` бере свій ланцюжок сам, тому робота, що вже тримає ланцюжок, поки що пише RMW руками (CF2-56, рішення X1). Правила — CONC-01, CONC-02.

## Кандидати абстракцій (з аудиту)

| Абстракція | Стан | Що дає | CF |
|------------|------|--------|----|
| Тека сховища на операцію (`dir` з `ensureStorage`, одна підготовка в польоті) | зроблено (PL_AUD_CTX Ф1): `hooks/store.ts` — `StorageState`, PrepareStorage/EnsureStorage, SESSION_ID | жодного читання глобальної теки після `await` | CF-1 |
| `hooks/store.ts`: `Read<T>`, `jsonFile` → `Store<T>`, контракти Update/Change, ранжовані ланцюги `serial` | зроблено (Ф7): `register.ts` прив'язує `FileIO` до `$.fs` один раз (`files`, `stores`) | один контракт RMW | CF-15 |
| Одне джерело `responses()` / ResponseStart | зроблено (Ф8): `edits.ts` — `isPromptRow`, `responses(rows, api)`; `cache.ts` — `cacheShape` | FrozenPrefix і ціна кешу бачать ту саму відповідь | CF-16 |
| `hooks/rows.ts`: предикати рядків, пошук пари, розміри, `PREFIX`/`modText()` | зроблено (Ф9); регресії в коді фаз 34–45 — рамки хоста в трьох списках, `SUMMARY_OPENER` поза ядром, назви інструментів і форма `[context-editor: …]` літералами, копії `oneLine`/`callLabel` | одне визначення на поняття | CF-17, CF-18; заплановано PL_AUD2_CTX Ф10 (CF2-42…CF2-50) |
| Логіка `register.ts` у портах; `hooks/tools.ts` | зроблено (Ф10), регрес у фазах 32–46; заплановано: ProbeMemory і CapabilityGate (`capabilities.ts`), ArchiveFolder + argv, підсумок маршрутів `session.compact` у `compaction.ts`/`repair.ts` | `register.ts` — лише зв'язування; рішення досяжні з тестів | CF-19, CF-20; CF2-30 (Ф7) |
| Знімок CurrentRows на подію, кеш реєстру з епохою, індекс цілей | зроблено (Ф11): `Snapshot`, `RowIndex`, `FileCache`, ворота `autoTagNeeded`/`reminderPending`; заплановано: ворота «нагадування настало», одне читання розмови на виклик для R4/R5/R6 | без повних перечитувань на кожному хуку | CF-21…CF-23; CF2-37, CF2-38 (Ф9) |
| Спільне ядро фіксації застосування `commitRegistries` (CONC-02 один раз) для compaction, repair, seed | заплановано (Ф11) | одне місце для поля реєстру чи кроку фіксації; три копії → одна | CF-28 → CF2-51 |
| `archiveMedia(owners, base, policy)` | заплановано (Ф11) | свідома політика медіа без даних і збою запису | CF2-52 |
| Спільний розбір і розв'язання цілі `context_tag`/`context_note` | заплановано (Ф11) | одне правило цілі й одні тексти відмов | CF2-53 |
| Тип події `session.append` і `resultText` у ядрі | заплановано (Ф11) | AutoTag і обрізання субагента міряють той самий текст | CF2-54 |
| `hooks/ledger.ts` (ApplyLedger, DropPulled) | заплановано (Ф11) | одностороннє ребро compaction → ledger ← repair | CF2-55 |
| Правило реєстру після компактизації, що стоїть (одне для обох спостерігачів) | заплановано (Ф5) | спостерігач брифу не розходиться з `observeCompaction` | CF2-18 |
| `Store.update` для взятого ланцюжка; фабрика сліду `quiet($, label)` | заплановано (Ф12) | одна семантика нечитабельного файлу; збої видно в журналі налагодження (ERR-01) | CF-32, CF-44 → CF2-56, CF2-57 |
| `hooks/registry.ts` (агрегат TagRegistry) — розрив циклу L6 | backlog | розрив циклу; один `tags.json` лишається | CF-28 → CF2-58 |
| Поділ `edits.ts` (boundary / listing / apply / report), `stages.ts`, `tags.ts`, `handoff.ts` (`seed.ts`) | backlog | менші хаби, менший радіус змін | CF-29 → CF2-59 |

Після виконання кожного пункту оновлюються список модулів у CLAUDE.md і ця таблиця (стан → «зроблено»).
