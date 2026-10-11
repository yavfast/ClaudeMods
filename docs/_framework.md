# Архітектурна карта: context-editor

> **Status:** active
> **Updated:** 2026-10-11 (`/dev-flow audit code`, прогін 20261011_182951)
>
> Жива карта шарів мода `mods/context-editor` — огляд і посилання, не правила. Деталі й обов'язкові обмеження живуть у джерелах нижче; ця карта їх не повторює. Підтримують її лише `onboard` і `audit code`, не фічі.

## Джерела

- [CLAUDE.md](../CLAUDE.md) — що робить мод, команди, патерн портів, список модулів і їхніх IO-інтерфейсів, поведінка хоста.
- [.dev_flow/skills/claude-code/plugin-hooks.md](../.dev_flow/skills/claude-code/plugin-hooks.md) — пастки хоста (форма хука, `.catch`, `$.command.run`, `session.compact`, межі `$.fs`).
- [docs/_index.md](./_index.md) — маршрутизатор документів і карта префіксів ID.
- Концепт: [context_editor.concept.md](./context_editor.concept.md) + [context_editor.mechanisms.concept.md](./context_editor.mechanisms.concept.md); специфікація: [context_editor.sp.md](./context_editor.sp.md) і дочірні `context_editor.<module>.sp.md`; план: [context_editor.plan.md](./context_editor.plan.md).
- Останній аудит: [.dev_flow/audit/context-editor_20261011_182951.plan.md](../.dev_flow/audit/context-editor_20261011_182951.plan.md) (CF-ідентифікатори нижче).

## Патерн портів

Чиста логіка в `hooks/<module>.ts` за малими IO-інтерфейсами (`QueueIO`, `CompactionIO`, `FlushIO`, `TagIO`, `AliasIO`, `HintIO`, `HandoffIO`, `SeedIO`, `JournalIO`, `DeliveryIO`, `ViewIO`); `hooks/register.ts` — єдиний модуль, що бачить `$`, і прив'язує ці інтерфейси до хоста. Тести (`tests/*.test.ts`) викликають чисті функції з фейковим IO. Рішення: [PL_CTX_DEC_01](./context_editor.plan.md#PL_CTX_DEC_01). Обмеження валідатора на передачу `$` — у CLAUDE.md.

## Шари модулів (граф імпорту значень)

Нижчий шар не імпортує вищий. `t:` — лише типи.

| Шар | Модулі | Імпортують |
|-----|--------|-----------|
| L0 | `media`, `turns` | — |
| L1 | `edits` | media |
| L2 | `cache` | edits, media |
| L3 | `queue`, `deliveries` | edits; queue ⇄ deliveries лише типами |
| L4 | `journal` | edits, queue |
| L5 | `tags` ⇄ `stages` ⇄ `notes` (цикл значень) | edits, cache, queue; t: deliveries, journal |
| L6 | `aliases` | edits, tags (лише SEARCH_TOOLS); t: queue |
| L7 | `hints`, `compaction` | hints: aliases, cache, edits, stages, tags; compaction: aliases, deliveries, edits, journal, notes, queue, stages, tags |
| L8 | `flush`, `handoff` (оркестратори) | compaction, queue, stages, turns, …; handoff також aliases, deliveries, edits, notes, tags |
| L9 | `register` | усі 15 |

Хаби за fan-in: `edits` (12), `queue` (10, переважно тип `Read`), `tags` (8). Відомі відхилення від шарів — цикл L5 через агрегат реєстру в `tags.ts`, `queue.ts` як «спільне ядро» (тип `Read<T>`, маркери, детекція людини), реекспорти (`stages` → `estimate`, `compaction` → `MARKER`).

## Де живе стан

- **Диск, на сесію:** `$HOME/.claude/context-editor/<session_id>/` (700): `pending.json` (черга), `tags.json` (реєстр: теги, етапи, нотатки, підказка, `lastApply` — один файл за [C_CTX_DEC_07](./context_editor.concept.md#C_CTX_DEC_07), [C_CTX_DEC_20](./context_editor.concept.md#C_CTX_DEC_20)), `aliases.json`, `boundary.json` (довіра — [SP_CTX_DEC_10](./context_editor.sp.md#SP_CTX_DEC_10)), `journal.json`, `deliveries.json`, архіви замінених оригіналів і медіа, файли засіву. Структури — [SP_CTX_01](./context_editor.structures.sp.md).
- **Пам'ять інстансу модуля** (`register.ts`): опублікована пара сесія + тека сховища і підготовки в польоті (`store.ts`), id останнього звіту застосування, ідентичність хост-процесу, власна межа, ключ останнього перегляду, лічильник ходів, стан Flush і передачі, скопійовані id результатів, якір доставки, мемо підказки, ланцюги `serial` на файл.
- **Порядок RMW:** один ланцюг `serial` на вид файлу, типізовані ключі з рангами (`CHAIN_RANK` у `store.ts`): queue (1) → tags (2) → aliases (3) → deliveries | journal (4); вкладення лише queue → tags → aliases (крок фіксації компактизації), queue → deliveries, tags → deliveries; вкладення нижчого чи того самого рангу з явно переданим тримачем → налагоджувальний журнал.

## Кандидати абстракцій (з аудиту)

| Абстракція | Стан | Що дає | CF |
|------------|------|--------|----|
| Тека сховища на операцію (`dir` з `ensureStorage`, одна підготовка в польоті) | зроблено (Ф1): `hooks/store.ts` — `StorageState`, PrepareStorage/EnsureStorage, SESSION_ID | жодного читання глобальної теки після `await` | CF-1 |
| `hooks/store.ts` (доповнити): `Read<T>`, `jsonFile`, `Store<T>.update`, типізовані ранжовані ланцюги `serial` | зроблено (Ф7): `Read<T>`, `jsonFile` → `Store<T>` (read/write/quarantine/update на ланцюжку файлу), контракти портів Update/Change (`updateOf`/`changeOf`), `carry`, `jsonObject`/`bytes`/`isCount`/`trimOldest`, `serialChains` з рангами й перевіркою вкладення; `register.ts` прив'язує `FileIO` до `$.fs` один раз (`files`, `stores`) | один контракт RMW замість ~17 копій; `serial` з тестами | CF-15 |
| Одне джерело `responses()` / ResponseStart | заплановано (Ф8) | FrozenPrefix і ціна кешу бачать ту саму відповідь | CF-16 |
| `hooks/rows.ts`: предикати рядків, пошук пари, `charsOf`, `sameText`, `worthEditing`; `PREFIX`/`modText()` | заплановано (Ф9) | одне визначення на поняття | CF-17, CF-18 |
| `contextList` / `afterTurn` / `observeCompaction` у портах; `hooks/tools.ts` | заплановано (Ф10) | `register.ts` — лише зв'язування | CF-19, CF-20 |
| Знімок CurrentRows на подію, кеш реєстру з поколінням, індекс цілей | заплановано (Ф11) | без повних перечитувань на кожному хуку | CF-21…CF-23 |
| `hooks/registry.ts` + спільне ядро apply/rebind | backlog | розрив циклу L5; один конвеєр застосування для compaction і seed | CF-28 |
| Поділ `edits.ts` (boundary / listing / apply / report), `stages.ts`, `tags.ts`, `handoff.ts` (`seed.ts`) | backlog | менші хаби, менший радіус змін | CF-29 |

Після виконання кожного пункту оновлюються список модулів у CLAUDE.md і ця таблиця (стан → «є»).
