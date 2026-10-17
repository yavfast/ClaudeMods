# Редактор контексту агента — Specification: курування історії — пункти слота стану

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-17
> **Updated:** 2026-10-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md); частина [курування історії](./context_editor.curation.sp.md)
> **Concept:** [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)
>
> Частина курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)) специфікації [SP_CTX](./context_editor.sp.md): пункт слота стану, операція `state` і життєвий цикл пункту. Читати перед зміною `hooks/state.ts` чи операції `state` в `hooks/edits.ts`.

## Contents

Розділи цього файлу (h3 розділів курування; решта — у [курування історії](./context_editor.curation.sp.md)):

- [01_29. StateItem](#SP_CTX_01_29) — пункт слота стану й нові поля реєстру
- [02_67. StateEdit](#SP_CTX_02_67) — операція `state`: перевірка змін, застосування і перебудова слота з пунктів
- [04_08. State Item Lifecycle](#SP_CTX_04_08) — життєвий цикл пункту слота стану

## 01. Data Structures — курування

### 01_29. StateItem  {#SP_CTX_01_29}

Пункт слота стану ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08), [SP_CTX_DEC_41](./context_editor.curation.sp.md#SP_CTX_DEC_41)).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | string | yes | — | літера виду і число: `g` goal, `p` plan, `d` done, `n` next, `l` lesson (`p3`); унікальний у реєстрі | Як агент називає пункт у дельтах |
| kind | `goal` \| `plan` \| `done` \| `next` \| `lesson` | yes | — | — | Розділ слота |
| text | string | yes | — | 1..MAX_STATE_ITEM символів, один рядок (переноси при постановці стають пробілами) | Зміст пункту |
| mark | `harmful` \| `outdated`? | no | — | — | Позначка агента: пункт лишається видимим із нею |
| turn | int | yes | — | ≥ 0 | `TagRegistry.turn` останньої зміни пункту |

Нові поля TagRegistry ([SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10)):

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| items | list<StateItem> | yes | `[]` | ≤ MAX_STATE_ITEMS; разом з тегами й нотатками — у межі файлу MAX_QUEUE_BYTES | Пункти слота стану |
| nextItem | int | yes | 1 | ≥ 1, більше за число кожного `id` в `items` | Число наступного пункту |
| docChecked | bool | yes | false | — | PinDocument ([SP_CTX_02_68](./context_editor.curation.edits.sp.md#SP_CTX_02_68)) уже переглянув перший рядок сесії |

Реєстр, записаний до фази 44, полів `items` і `nextItem` не має: відсутність читається як `[]` і 1, і мод пише їх лише разом із першою правкою `state`.

Invariants: `id` унікальні; `len(STATE_REBUILT) + len(Assemble(items))` + довжина рядка архіву ≤ MAX_TEXT; `firstPromptPinned` реєстру з цієї версії ніхто не читає; PinSummary ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) і далі пише його для старіших версій.

## 02. Contracts — курування

### 02_67. StateEdit  {#SP_CTX_02_67}

Purpose: змінювати слот стану дельтами пунктів; текст рядка слота збирає мод при застосуванні ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08), [SP_CTX_DEC_41](./context_editor.curation.sp.md#SP_CTX_DEC_41)).

Processing logic (pseudocode):
    PrepareEdits (SP_CTX_02_03): op is one of six; the STATE_SLOT rule and ScreenPinned let state through on the slot row, as they let rewrite of that row through
    in PrepareEdits, op state:
        slot = the row of the view with the state tag; absent → rejected NO_STATE_SLOT
        batch = the state edits already in pending.json, then the earlier ones of this call
        a rewrite of the slot row in pending.json or in this call → rejected STATE_CONFLICT
        items = reg.items with the changes of batch applied in order   # нові пункти пакета ще без id
        FOR c IN changes:
            add: kind in the list, text 1..MAX_STATE_ITEM after newlines become spaces → append { kind, text }
            set, mark, unmark, remove: id in items (with an id) else NO_ITEM; set — text as for add; mark — as harmful | outdated
        len(items) ≤ MAX_STATE_ITEMS else TOO_MANY_ITEMS; the assembled text fits MAX_TEXT else SLOT_TOO_LONG
    in PrepareEdits, op rewrite of the slot row: reg.items not empty → rejected STATE_ITEMS; a state edit in pending.json or in this call → rejected STATE_CONFLICT
    run state (ApplyEdits): pure over (reg.items, reg.nextItem, reg.turn) of the registry read for this apply → (items', nextItem'), which the commit step writes; all state edits of the batch together, one rebuild of the slot
        slot = Locate(rows, anchor, hint) of the state tag; absent → every state edit fails STATE_GONE
        items' = reg.items with the changes of the batch in order; each add gets id = letter(kind) + reg.nextItem, reg.nextItem += 1; every item that an add, set, mark or unmark touches gets turn = reg.turn
        a change naming an id absent from items' → every state edit fails NO_ITEM_NOW
        len(items') > MAX_STATE_ITEMS (a queue changed outside the tools) → every state edit fails TOO_MANY_ITEMS; the assembled text over MAX_TEXT → SLOT_TOO_LONG
        archive the slot row; the row rebuilt without handle, text = STATE_REBUILT + " (original: <archive>, open with Read):\n" + Assemble(items')
        commit step (after the last abort check, CONC-02): reg.items = items', reg.nextItem; the state tag follows the rebuilt row: anchor = the fingerprint of the row whose text equals the text run state wrote, hint its index (RebindTags, SP_CTX_02_14, as for rewrite)
        the registry write fails → ITEMS_UNSAVED: the slot text is ahead of the saved items
    Assemble(items) = for kind in goal, plan, done, next, lesson with items: "<Goal|Plan|Done|Next|Lessons>:\n" + lines "- <id>" + (mark ? " (" + mark + ")" : "") + ": " + text
                      blocks joined "\n"

Правки `state` пакета — одна перебудова слота, тож OVERLAP між ними не діє; `rewrite` слота і `state` в одному пакеті не стоять (STATE_CONFLICT). Поки пунктів немає, слот лишається вільним текстом, і `rewrite` діє, як досі ([C_CTX_DEC_19](./context_editor.methods.concept.md#C_CTX_DEC_19)). Тег `state` на новішому рядку переносить слот: наступна правка `state` збирає пункти вже в ньому, а старий рядок лишає останній зібраний текст — агент стискає його, як будь-який свій рядок. Засів «транскриптом» застосовує правки `state` так само, а копія реєстру несе пункти; передача «документом» пунктів не переносить.

Реалізація (фаза 44): чиста логіка пунктів — `hooks/state.ts` (CheckChanges, DraftChanges, ApplyChanges, Assemble); операцію веде `hooks/edits.ts`. Ціль правки `state` — рядок слота: PrepareEdits ставить на неї `index` і `anchors` рядка з тегом `state` (stampState), а ScreenPinned при застосуванні й засіві ставить їх наново за тегом у ту мить, тож тег, перенесений після постановки, веде правку на новий рядок; без слота правка лишається без них і застосування дає STATE_GONE. Pinned несе `items` реєстру, щоб PrepareEdits бачив пункти. SLOT_TOO_LONG при постановці лишає ARCHIVE_ROOM символів на рядок архіву, шлях якого ще невідомий, і на номери нових пунктів (пункт пакета рахується як `p?`); застосування перевіряє точну довжину. Засів ставить ціль так само: BuildSeed ставить правкам `state` рядок за тегом до свого відбору, і цей пакет (BuiltSeed.batch) — «the batch» кроку реєстрів, тож тег і пункти переходять у нову сесію з перебудованим рядком. CompactBrief ([SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55)) правок `state` у черзі не переказує: коли `compact` пропущено, правка `state` відхиляється ще при постановці, як і решта. Мітка правки — `state (<зміни>)`, кожна зміна як `add <kind>` чи `<do> <id>`. Слот без пунктів після `remove` усіх — текст `(no items)`, і `rewrite` знову діє. ITEMS_UNSAVED стоїть у звіті застосування після рядка вкладень; причина — помилка запису або нечитабельність реєстру у фіксації.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| NO_STATE_SLOT | немає рядка з тегом `state` | `state: no state slot; tag one of your own text rows with context_tag (kind "state") first` |
| NO_ITEM | `id` немає серед пунктів | `state: no item <id>; items added in this batch get their ids when it applies` |
| BAD_CHANGE | невідомий `do`, `kind` чи `as`, порожній текст | назва поля й допустимі значення |
| TOO_MANY_ITEMS, SLOT_TOO_LONG | забагато пунктів чи задовгий слот | прибрати чи скоротити пункти |
| STATE_ITEMS | `rewrite` слота, що має пункти | `your state slot is built from items; change it with the state op` |
| STATE_CONFLICT | `rewrite` слота і правка `state` в одному пакеті | `your state slot already has a <rewrite or state> edit in this batch; end the turn first` |
| STATE_GONE | при застосуванні рядка з тегом `state` немає | `state: the state slot is gone; items unchanged` — усі правки `state` пакета в `failed` |
| NO_ITEM_NOW | при застосуванні зміна називає `id`, якого вже немає | `state: no item <id> now; items unchanged` — так само |
| ITEMS_UNSAVED | реєстр не записався у фіксації | звіт: `state: the items could not be saved (<error>); your slot shows them, the next state edit starts from the saved ones` |

## 04. State Transitions — курування

### 04_08. State Item Lifecycle  {#SP_CTX_04_08}

State diagram:
    [queued add] --apply--> [active] --set--> [active]
    [active] --mark--> [marked] --unmark--> [active]
    [marked] --set, mark--> [marked]
    [active | marked] --remove--> [removed]

Transition rules:
| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| queued add | active | застосування з правкою `state` | `id` = літера + `nextItem`; `nextItem` + 1; текст слота зібрано |
| active | active | `set` | новий текст, `turn` |
| active | marked | `mark` | `mark` = harmful \| outdated |
| marked | active | `unmark` | `mark` знято |
| marked | marked | `set` чи `mark` | новий текст чи інша позначка, `turn` |
| active, marked | removed | `remove` | пункт зникає з реєстру й тексту слота |
| будь-який | без змін | застосування не знайшло слота (STATE_GONE) чи пункту (NO_ITEM_NOW) | пункти не змінено, правка в `report.failed` |
| active | active | `unmark` пункту без позначки | нічого не змінено, крім `turn` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-17 | structural-event: розділи 01_29, 02_67, 04_08 перенесено дослівно з [context_editor.curation.sp.md](./context_editor.curation.sp.md) (аудит dev-flow, Docs Scaling `hard_split`: 14 640 слів); якорі незмінні |
