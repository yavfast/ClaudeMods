# Архітектурна карта: context-editor

> **Status:** active
> **Updated:** 2026-10-12 (фаза 24 PL_CTX: `hostattach` у шарах і стані — на прохання ініціатора фази; `/dev-flow audit code`, прогін 20261011_182951)
>
> Жива карта шарів мода `mods/context-editor` — огляд і посилання, не правила. Деталі й обов'язкові обмеження живуть у джерелах нижче; ця карта їх не повторює. Підтримують її лише `onboard` і `audit code`, не фічі.

## Джерела

- [CLAUDE.md](../CLAUDE.md) — що робить мод, команди, патерн портів, список модулів і їхніх IO-інтерфейсів, поведінка хоста.
- [.dev_flow/skills/claude-code/plugin-hooks.md](../.dev_flow/skills/claude-code/plugin-hooks.md) — пастки хоста (форма хука, `.catch`, `$.command.run`, `session.compact`, межі `$.fs`).
- [docs/_index.md](./_index.md) — маршрутизатор документів і карта префіксів ID.
- Концепт: [context_editor.concept.md](./context_editor.concept.md) + [context_editor.mechanisms.concept.md](./context_editor.mechanisms.concept.md); специфікація: [context_editor.sp.md](./context_editor.sp.md) і дочірні `context_editor.<module>.sp.md`; план: [context_editor.plan.md](./context_editor.plan.md).
- Останній аудит: [.dev_flow/audit/context-editor_20261011_182951.plan.md](../.dev_flow/audit/context-editor_20261011_182951.plan.md) (CF-ідентифікатори нижче).

## Патерн портів

Чиста логіка в `hooks/<module>.ts` за малими IO-інтерфейсами (`QueueIO`, `CompactionIO`, `ObserveIO`, `FailureIO`, `FlushIO`, `TurnEndIO`, `TagIO`, `AppendIO`, `AliasIO`, `HintIO`, `HandoffIO`, `SeedIO`, `JournalIO`, `DeliveryIO`, `ViewIO`, `ListIO`, `BlockIO`, `DetectIO`); `hooks/register.ts` — єдиний модуль, що бачить `$`, і лише прив'язує ці інтерфейси до хоста (з Ф10 аудиту); статичні метадані інструментів — `hooks/tools.ts`. Тести (`tests/*.test.ts`) викликають чисті функції з фейковим IO. Рішення: [PL_CTX_DEC_01](./context_editor.plan.md#PL_CTX_DEC_01). Обмеження валідатора на передачу `$` — у CLAUDE.md.

## Шари модулів (граф імпорту значень)

Нижчий шар не імпортує вищий. `t:` — лише типи.

| Шар | Модулі | Імпортують |
|-----|--------|-----------|
| L0 | `rows` (ядро рядків: предикати, пошук пари, розміри, префікси тексту мода), `turns` | — |
| L1 | `media`, `store` | rows |
| L2 | `edits`, `deliveries` | edits: media, rows; deliveries: media, rows, store |
| L3 | `cache`, `hostattach`, `queue`, `aliases` | cache: edits, rows; hostattach (вкладення хоста, Ф24 PL_CTX): edits, rows, store; queue: deliveries, edits, rows, store; aliases: edits, rows, store (з Ф9 не імпортує `tags`; з Ф10 його імпортує `stages` — `aliasesById` для переліку) |
| L4 | `journal` | edits, queue, store |
| L5 | `tags` ⇄ `stages` ⇄ `notes` (цикл значень) | edits, rows, store; stages також aliases, cache; tags також queue; t: deliveries, journal, queue |
| L6 | `tools` (статичні метадані інструментів, Ф10) | edits, notes, queue, rows, stages, tags |
| L7 | `hints`, `compaction` | hints: aliases, cache, edits, rows, stages, tags; t: queue, store; compaction: aliases, deliveries, edits, hostattach, journal, notes, queue, rows, stages, tags; t: store |
| L8 | `flush`, `handoff` (оркестратори) | flush: compaction, queue, rows, stages, turns; t: store, tags; handoff: aliases, compaction, deliveries, edits, media, notes, queue, rows, stages, store, tags, turns |
| L9 | `register` | 17 з 19: усі, крім cache і media |

Хаби за fan-in (значення й типи): `rows` (16), `store` і `edits` (по 12), `queue` (9), `tags` і `stages` (по 8). Відомі відхилення від шарів — цикл L5 через агрегат реєстру в `tags.ts`, `queue.ts` як «спільне ядро» (тип `Read<T>`, маркери, детекція людини), реекспорти (`stages` → `distinctive`, `estimate`; `compaction` → `MARKER`, `HANDOFF_MARKER`; `handoff` → `ROW_WINDOW`, `SUMMARY_OPENER`).

## Де живе стан

- **Диск, на сесію:** `$HOME/.claude/context-editor/<session_id>/` (700): `pending.json` (черга), `tags.json` (реєстр: теги, етапи, нотатки, підказка, `lastApply` — один файл за [C_CTX_DEC_07](./context_editor.concept.md#C_CTX_DEC_07), [C_CTX_DEC_20](./context_editor.concept.md#C_CTX_DEC_20)), `aliases.json`, `boundary.json` (довіра — [SP_CTX_DEC_10](./context_editor.sp.md#SP_CTX_DEC_10)), `journal.json`, `deliveries.json`, `hostattach.json` (рішення про вкладення хоста, Ф24), архіви замінених оригіналів і медіа, файли засіву. Структури — [SP_CTX_01](./context_editor.structures.sp.md).
- **Пам'ять інстансу модуля** (`register.ts`): опублікована пара сесія + тека сховища і підготовки в польоті (`store.ts`), id останнього звіту застосування, ідентичність хост-процесу, власна межа, ключ останнього перегляду, лічильник ходів, стан Flush і передачі, скопійовані id результатів, якір доставки, мемо підказки, каталог вкладень хоста з останнього проходу (`hostattach.ts`, AttachMemory), ланцюги `serial` на файл.
- **Порядок RMW:** один ланцюг `serial` на вид файлу, типізовані ключі з рангами (`CHAIN_RANK` у `store.ts`): queue (1) → tags (2) → aliases (3) → deliveries | journal | hostattach (4); вкладення лише queue → tags → aliases (крок фіксації компактизації), queue → deliveries, tags → deliveries; вкладення нижчого чи того самого рангу з явно переданим тримачем → налагоджувальний журнал.

## Кандидати абстракцій (з аудиту)

| Абстракція | Стан | Що дає | CF |
|------------|------|--------|----|
| Тека сховища на операцію (`dir` з `ensureStorage`, одна підготовка в польоті) | зроблено (Ф1): `hooks/store.ts` — `StorageState`, PrepareStorage/EnsureStorage, SESSION_ID | жодного читання глобальної теки після `await` | CF-1 |
| `hooks/store.ts` (доповнити): `Read<T>`, `jsonFile`, `Store<T>.update`, типізовані ранжовані ланцюги `serial` | зроблено (Ф7): `Read<T>`, `jsonFile` → `Store<T>` (read/write/quarantine/update на ланцюжку файлу), контракти портів Update/Change (`updateOf`/`changeOf`), `carry`, `jsonObject`/`bytes`/`isCount`/`trimOldest`, `serialChains` з рангами й перевіркою вкладення; `register.ts` прив'язує `FileIO` до `$.fs` один раз (`files`, `stores`) | один контракт RMW замість ~17 копій; `serial` з тестами | CF-15 |
| Одне джерело `responses()` / ResponseStart | зроблено (Ф8): `edits.ts` — `isPromptRow` (один предикат промпту), `responses(rows, api)` → `{start, known, floor}`, `responseStart` похідний від нього; `cache.ts` — `cacheShape` (відповіді й позиції раз на пропозицію), `cacheCost` бере початок з `responseStart` | FrozenPrefix і ціна кешу бачать ту саму відповідь | CF-16 |
| `hooks/rows.ts`: предикати рядків, пошук пари, `charsOf`, `sameText`, `worthEditing`; `PREFIX`/`modText()` | зроблено (Ф9): L0-модуль `hooks/rows.ts` — `isPromptRow` (PromptRow), `isPromptRowStrict` (ResolveLast), `isEmptyRow`, `isPlainUserRow`, `resultsOf`, `findToolUse`/`findToolResult`, `rowChars`/`totalChars`/`charsOf`, `squash`/`sameText`, `apiBlocks`, `errorText`, `isBig`/`isSearchTool`/`worthEditing`; константи MARK, PREFIX (`modText()`), BIG_ROW, SEARCH_TOOLS, PLAIN_RATIO; тест виробників тексту мода проти PersonText | одне визначення на поняття | CF-17, CF-18 |
| `contextList` / `afterTurn` / `observeCompaction` у портах; `hooks/tools.ts` | зроблено (Ф10): `stages.ts` — `contextList` (ListIO), `listLabels`, `listAliases`; `flush.ts` — `afterTurn` (TurnEndIO); `compaction.ts` — `observeCompaction` (ObserveIO), `compactionFailed` (FailureIO); `tags.ts` — `appendRow` (AppendIO), `pinsFrom`; `handoff.ts` — `parseSeedNames`; `hooks/tools.ts` — назви, описи, схеми, `TOOLS`, `HANDOFF_COMMAND` (ліміти з констант) | `register.ts` — лише зв'язування (1249 → 910 рядків) | CF-19, CF-20 |
| Знімок CurrentRows на подію, кеш реєстру з поколінням, індекс цілей | зроблено (Ф11): `edits.ts` — `Snapshot`/`snapshotOf` (CurrentRows, Key() і API-подання раз на подію чи виклик), `RowIndex`/`indexRows` (відбиток → рядки, перший рядок виклику й результату; Locate, LocateSpan, TouchedBy беруть індекс); `store.ts` — `FileCache` (`newFileCache`, `dropFileCache`, опція `cache` у `jsonFile`, `Store.cached`/`Store.peek` лише для показу й воріт, читання-змінювання-запис читає файл), ключ (сесія, каталог, епоха), нова епоха на публікації сховища; ворота `autoTagNeeded` (`tags.ts`), `reminderPending` (`notes.ts`); `addAlias` за O(1); CheckSeed за картами індексів | без повних перечитувань на кожному хуку | CF-21…CF-23 |
| `hooks/registry.ts` + спільне ядро apply/rebind | backlog | розрив циклу L5; один конвеєр застосування для compaction і seed | CF-28 |
| Поділ `edits.ts` (boundary / listing / apply / report), `stages.ts`, `tags.ts`, `handoff.ts` (`seed.ts`) | backlog | менші хаби, менший радіус змін | CF-29 |

Після виконання кожного пункту оновлюються список модулів у CLAUDE.md і ця таблиця (стан → «є»).
