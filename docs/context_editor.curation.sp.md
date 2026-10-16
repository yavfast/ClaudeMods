# Редактор контексту агента — Specification: курування історії

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** draft
> **Created:** 2026-10-15
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
> **Concept:** [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)
> **Spikes:** [context_editor_uses](./context_editor_uses.spike.md), [context_editor_hostrows](./context_editor_hostrows.spike.md)
> **Depends on:** [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04), [SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07), [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12), [SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16), [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18), [SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27), [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29), [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)
> **Used by:** —
>
> Курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)) у термінах контрактів: структури (походження, пункти слота стану, нові поля правок і тегів, записи рядків хоста, константи), контракти (правило слів людини з відмовою при постановці й застосуванні, `describe` для вставок, запис рядків хоста і їх список з `id`, тексти замін з походженням, перевірка залежностей, слід власних викликів, застаріле читання й готові заміни, операція `state`, піни, правила й тексти навички), перевірки, життєві цикли, критерії перевірки, відкат і рішення SP_CTX_DEC_39–DEC_44. Наявні контракти, які курування змінює, лишаються у своїх файлах із посиланням сюди. Читати перед реалізацією будь-якого механізму курування.

## Contents

- [01. Data Structures — курування](#SP_CTX_01_27) — джерело заміненого змісту, пункт слота стану й нові поля реєстру, нові поля правок і тегів, записи рядків хоста, константи курування
- [02. Contracts — курування](#SP_CTX_02_58) — слова людини, `describe` для вставок, запис рядків хоста і їх список з `id`, відкривачі замін, перевірка залежностей, слід власних викликів, застаріле читання, готові заміни, операція `state`, піни, правила й тексти навички
- [03. Validation Rules — курування](#SP_CTX_03_03) — що перевіряється на вході агента і в результаті застосування
- [04. State Transitions — курування](#SP_CTX_04_08) — життєвий цикл пункту слота стану і запису рядків хоста
- [05. Verification Criteria — курування](#SP_CTX_05_05) — модульні очікування, інваріанти, живі сценарії, граничні випадки
- [06. Reversibility — курування](#SP_CTX_06_02) — як вимкнути кожен механізм і що лишається
- [07. Design Decisions — курування](#SP_CTX_DEC_39) — де лежить специфікація, форма статусу та його зняття після воріт, операція слота стану, як агент бачить і прибирає рядки хоста, де правила курування

## 01. Data Structures — курування

### 01_27. EpistemicStatus (вилучено)  {#SP_CTX_01_27}

Вилучено 2026-10-15 рішенням [SP_CTX_DEC_44](#SP_CTX_DEC_44): слова статусу (`verified`, `read`, `inferred`, `assumed`) у відкривачі заміни на воротах фази 39 майже не змінили довіри агента до стиснутого ([SP_CTX_05_07](#SP_CTX_05_07)), тож заміна несе лише джерело ([SP_CTX_01_28](#SP_CTX_01_28)) і `which you quoted from later`. Поля `status` у правках і тегах, переліку STATUS_WORDS, слів StatusWords і відмов STATUS_REQUIRED і BAD_STATUS немає; надійність окремих фактів агент, коли треба, називає власними словами в тексті заміни. Якір лишається для посилань.

### 01_28. Source  {#SP_CTX_01_28}

Звідки взято замінений зміст ([C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06)): мод виводить його з виклику заміненої пари, а не зі слів агента. `SourceOf(call) → string`, не довше за MAX_SOURCE символів, обрізання — OneLine ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04): не розрізає сурогатної пари, кінець `…`).

| Tool of the call | Source |
|------------------|--------|
| `Read`, `Edit`, `Write` | `<tool> <path>`: `file_path` відносно робочого каталогу, коли він усередині нього, інакше абсолютний |
| `NotebookEdit` | `NotebookEdit <path>` з `notebook_path`, так само |
| `Bash` | `Bash "<command>"`: команда одним рядком |
| `Grep`, `Glob` | `<tool> "<pattern>"`, для `Grep` з ` in <path>`, коли `path` є (шлях — так само відносно робочого каталогу) |
| `WebFetch` | `WebFetch <host><path>`: без userinfo, запиту й фрагмента (запит буває носієм токена) |
| `WebSearch` | `WebSearch "<query>"` |
| `Agent`, `Task` | `subagent "<description>"` |
| носій `collapse` (вхід з полем `collapsed`, [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) | `collapsed rows (<перелік>)`: заміна стискає нотатку згортання, а не вивід інструмента |
| інший | `<tool>` і, коли KeyArg ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) непорожній, ` <KeyArg>` |

Обрізання значення в лапках лишає закривну лапку; лапки всередині значення не екрануються. Шлях порівнюється з робочим каталогом без кінцевих `/`: сам каталог — `.`, каталог `/` проєкту не називає (шлях лишається абсолютним). У `Grep` шаблон бере щонайбільше половину MAX_SOURCE, а шлях — решту. userinfo URL відкидається до останнього `@`. Дім — `sourceOf` у `hooks/edits.ts` поряд із KeyArg і OneLine (`rows.ts` — ядро L0 без імпортів). Робочий каталог — `$.session.cwd()`, який компактизація (CompactionIO `cwd`) і передача (HandoffIO `cwd`) передають у ApplyEdits (ApplyOptions `cwd`); без нього шлях абсолютний.

Invariants: джерело ніколи не бере тексту результату; команда й шлях уже стоять у вході виклику, який `summarize` лишає в розмові, тож джерело не відкриває нічого нового.

### 01_29. StateItem  {#SP_CTX_01_29}

Пункт слота стану ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08), [SP_CTX_DEC_41](#SP_CTX_DEC_41)).

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
| docChecked | bool | yes | false | — | PinDocument ([SP_CTX_02_68](#SP_CTX_02_68)) уже переглянув перший рядок сесії |

Реєстр, записаний до фази 44, полів `items` і `nextItem` не має: відсутність читається як `[]` і 1, і мод пише їх лише разом із першою правкою `state`.

Invariants: `id` унікальні; `len(STATE_REBUILT) + len(Assemble(items))` + довжина рядка архіву ≤ MAX_TEXT; `firstPromptPinned` реєстру з цієї версії ніхто не читає; PinSummary ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) і далі пише його для старіших версій.

### 01_30. Curation Fields of Edits and Tags  {#SP_CTX_01_30}

Edit ([SP_CTX_01_02](./context_editor.structures.sp.md#SP_CTX_01_02)) і QueuedEdit ([SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03)):

| Field | Applies to | Type | Required | Description |
|-------|------------|------|----------|-------------|
| changes | `state` (нова операція) | list<StateChange> | yes | 1..MAX_STATE_ITEMS змін, у порядку застосування |
| quoted | QueuedEdit `summarize`, `drop`, `collapse` | `true`? | no | DependencyCheck знайшов цитати оригіналу ([SP_CTX_02_63](#SP_CTX_02_63)); пише мод |
| host | `drop` | string? | no | `id` запису рядка хоста ([SP_CTX_01_31](#SP_CTX_01_31)); виключає `tool_use_id` і `ref` ([SP_CTX_02_61](#SP_CTX_02_61)) |

StateChange — одне з: `{ "do": "add", "kind": <kind>, "text": <string> }`, `{ "do": "set", "id": <id>, "text": <string> }`, `{ "do": "mark", "id": <id>, "as": "harmful" | "outdated" }`, `{ "do": "unmark", "id": <id> }`, `{ "do": "remove", "id": <id> }`. Правка `state` має форму `{ "op": "state", "changes": [...] }`; ціллю є рядок, що тримає тег `state` у мить застосування.

Tag ([SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)): `reason` тегу `review` додає `superseded` (R6, [SP_CTX_02_65](#SP_CTX_02_65)).

Розбір файлів: невідоме значення `do`, `kind`, `as` чи `reason` робить чергу або реєстр `unreadable`, як будь-яке погане поле ([SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04)). Черга, записана старішою версією, поля `quoted` не має: така правка застосовується без застереження про цитати. Поля статусу немає ([SP_CTX_DEC_44](#SP_CTX_DEC_44)): `status` у правці чи тегу мод ігнорує разом зі значенням, як будь-яке зайве поле (checkShape правки, [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03); isTag тегу).

### 01_31. HostRows  {#SP_CTX_01_31}

Записи рядків хоста ([C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11), [SP_CTX_DEC_42](#SP_CTX_DEC_42)). Файл `<storage>/hostrows.json`, послідовний ланцюжок `hostrows` рангу 4 — поряд із `deliveries`, `journal`, `hostattach`, без вкладення з ними ([SP_CTX_02](./context_editor.sp.md#SP_CTX_02)). Пише лише мод.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| rows | list<HostRowRecord> | yes | `[]` | ≤ MAX_HOST_ROWS; файл ≤ MAX_QUEUE_BYTES; понад межу йдуть найстаріші | У порядку запису |
| next | int | yes | 1 | ≥ 1, більше за число кожного `id` в `rows` | Число наступного `id` |

HostRowRecord:

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | string | yes | — | `h` і число; унікальний у файлі | Як агент називає рядок хоста в правці `drop` |
| kind | `skill` \| `peer` | yes | — | — | Вид рамки хоста (HostFrame) |
| after | string | yes | — | непорожній | `handle` видимого рядка, за яким хост тримає цей рядок: `uuid` попереднього видимого рядка в мить запису ([SP_CTX_02_60](#SP_CTX_02_60)); після застосування, що повернуло цей рядок із `handle`, — `#<k>`, його позиція серед повернутих рядків (RebaseHostRows нижче) |
| afterKind | `prompt` \| `response` \| `result` | yes | — | — | Що це за рядок: промпт, відповідь агента (текст чи виклики) чи рядок результатів |
| afterHead | string | yes | — | ≤ MAX_HEAD символів, один рядок | Голова цього рядка для списку |
| text | string | yes | — | ≤ MAX_HOST_TEXT символів; довший — його голова | Текст рядка хоста: для списку й архіву |
| chars | int | yes | — | ≥ len(text) | Повна довжина тексту |

`HostFrame(text)`: `skill`, коли текст починається з SKILL_FRAME; `peer` — з PEER_FRAME; інакше немає. Рядок хоста — рядок `user` з `isMeta`, без результатів і без медіа, текст якого має HostFrame. Примітку до локальної команди (`<local-command-caveat>`) хост теж пише з `isMeta`, але мод її не записує: вона коротка, з'являється з кожною командою `/compact` мода, а прибрати її можна лише разом із рядком перед нею; PersonText її й так не рахує словами людини ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)).

RebaseHostRows. Повернутий із `handle` рядок хост пише в ланцюжок копією з новим `uuid` (живий прогін фази 45, сесія 751106d3: рядок команди `/hello` `30e8cce4` повернувся як `68e09e30`, а навичку хост поставив за копією), тож `handle` попередника змінюється з кожним застосуванням, а `$.session.messages()` `handle` не показує. Тому фіксація застосування пише в запис позицію попередника серед повернутих рядків, `#<k>`, а наступна компактизація, чий вхід починається з цих рядків, бере `handle` її рядка `k` (на рядках після DropPulled), якщо той рядок має `handle`, того самого виду (`afterKind`) і з тією самою головою (`afterHead`, Head того рядка); інакше позиція не називає жодного рядка. Перевірка голови не дає позиції прив'язатися до іншого рядка того самого виду, коли крок збереження не відбувся (позиції старшого застосування) чи завантажений ланцюжок зсунутий. Ремонт позицій не переносить: у завантаженому ланцюжку оригінали стоять поруч із копіями, і позиції зсуваються; такий запис іде.

Invariants: `id` унікальні; запис лишається, лише поки рядок із `handle` = `after` (після RebaseHostRows) повертається з цим `handle` ([SP_CTX_02_61](#SP_CTX_02_61)): перебудований без `handle` чи прибраний попередник забирає рядки хоста за ним (так поводиться хост), і фіксація того самого застосування прибирає їхні записи. Серед рядків перегляду рядків хоста немає, і номерів рядків вони не зсувають. Зіпсований файл не показує нічого; наступний запис відкладає його вбік, як Store ([SP_CTX_02](./context_editor.sp.md#SP_CTX_02)), і починає новий.

### 01_32. Curation Constants  {#SP_CTX_01_32}

| Name | Value | Meaning |
|------|-------|---------|
| MAX_SOURCE | 120 | Найбільша довжина Source, символи |
| MAX_STATE_ITEMS | 40 | Найбільше пунктів слота стану і змін в одній правці `state` |
| MAX_STATE_ITEM | 500 | Найбільша довжина тексту пункту, символи |
| ARCHIVE_ROOM | 600 | Запас SLOT_TOO_LONG при постановці на рядок архіву (≈ довжина cwd + 110) і номери нових пунктів, символи |
| MAX_DEP_FRAGMENTS | 100 | Найбільше фрагментів оригіналу, які шукає DependencyCheck |
| DEP_MIN, DEP_MAX | 6, 120 | Межі довжини фрагмента, символи |
| DEP_EXAMPLES | 3 | Скільки фрагментів називає застереження |
| MAX_HOST_ROWS | 200 | Найбільше записів рядків хоста; старіші йдуть першими |
| MAX_HOST_TEXT | 100000 | Найбільше символів тексту в записі |
| MAX_HEAD | 80 | Найбільша довжина голови попереднього рядка в записі й голови рядка хоста в списку, символи |
| MAX_HOST_LIST | 20 | Скільки найновіших записів список показує повними рядками |
| MAX_TRACE | 400 | Найбільша довжина рядка сліду, символи |
| CURATION_MAX | 6000 | Найбільша довжина файлу правил курування `curation.md`, символи ([SP_CTX_DEC_43](#SP_CTX_DEC_43)) |
| SKILL_FRAME | `Base directory for this skill: ` | Початок розгорнутого тексту навички |
| PEER_FRAME | `Another Claude session sent a message:\n<agent-message` | Початок звіту субагента між ходами; обидві рамки й HostFrame живуть у `rows.ts` (STRUCT-01) |
| SUMMARIZED_OF, TAG_SUMMARIZED_OF | `Later, your context_edit summarize call replaced the full output of `, `Later, your context_tag disposable tag replaced the full output of ` | Голови відкривачів `summarize` з джерелом |
| DESCRIBED_HEAD | `Later, your context_edit describe call replaced the ` | Голова кожного відкривача `describe` |
| STATE_REBUILT | `Later, your context_edit state call rebuilt your state slot here from its items` | Відкривач рядка слота після `state` |
| TRACE_OPENER | `Later, your context_* calls here were removed when your edits applied` | Відкривач рядка сліду |

## 02. Contracts — курування

### 02_58. PersonWords  {#SP_CTX_02_58}

> **Criticality:** core

Purpose: слова людини в поточній сесії лишаються дослівними: правку, що їх захоплює, мод відхиляє при постановці в чергу й наново при застосуванні; дозволу на неї немає ([C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10), [C_CTX_DEC_38](./context_editor.curation.concept.md#C_CTX_DEC_38)). Замінює попередження PersonWarnings і PersonTagWarnings ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)).

Processing logic (pseudocode):
    PersonText(text): as SP_CTX_02_02, with one more rule before the last:
        IF HostFrame(t) present → empty                # текст розгорнутої навички чи звіту субагента — не слова людини, де б він не стояв
    PersonRow(r) (SP_CTX_02_02) holds also for a user row without results whose text is DescribedText (SP_CTX_02_04: DESCRIBED_HEAD of this version and the older forms; isDescribedText in hooks/rows.ts, STRUCT-01)   # промпт після describe: набраний людиною текст стоїть за описом (SP_CTX_02_59); мітка "#i (described prompt)"
    PersonHits(rows, edit, deliveries):                # PersonRow, PersonPair, PersonDelivered — SP_CTX_02_02
        collapse → PersonRow rows, PersonPair result rows and PersonDelivered rows in its span
        summarize or drop of a PersonPair → its result row
        drop whose result row is PersonDelivered by a delivery whose every anchor id is the dropped pair → that row
        rewrite, describe, state → none                # rewrite і state — лише власні рядки агента; describe лишає набраний текст (SP_CTX_02_59)
    in PrepareEdits (context_edit): an edit with hits is rejected
        "<label>: covers the person's words: #i (prompt), #j (AskUserQuestion answer), #k (message sent during this tool call); they stay verbatim in this session: narrow the range or split it around them"
        a pair: "<label>: the AskUserQuestion answer is the person's words; it stays verbatim"
        a drop with a delivery: "<label>: the person's message sent during this tool call goes with it; summarize the call instead: the message stays after it"
    in context_tag, add disposable: the same hits for its target → the request is refused with the same text
    in QueueTagReplacements (SP_CTX_02_13): a tag whose target has hits now is not queued; it is removed, and the result of the call that queued the replacements (the close report of context_tag, or the result of context_edit that ended a waiting block) says "disposable <target> dropped: it covers the person's words"
    in ApplyEdits of HandleCompaction and BuildSeed, before any replacement, beside ScreenPinned (SP_CTX_02_07):
        ScreenPerson: hits on the rows of the event (e.messages; visible rows of the seed) and the deliveries file → the edit fails "<label>: covers the person's words now; they stay verbatim"; failed edits go first in report.failed
        hits come from the rows and the deliveries only, never from tags.json or pending.json   # стан мода агент може змінити оболонкою (C_CTX_06_10)

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| PERSON_WORDS | правка при постановці захоплює слова людини | звузити чи розділити діапазон; для пари з відповіддю — нічого; для `drop` з доставкою — `summarize` |
| PERSON_TAG | `disposable` захоплює слова людини | так само |
| PERSON_WORDS_NOW | при застосуванні правка захоплює слова людини (черга змінена поза інструментами, рядки зсунулись) | правку не застосовано; решта пакета йде |

Файл доставок — виняток із правила «за рядками, а не за станом на диску»: повідомлення людини посеред ходу хост дає вкладенням, а не рядком, і `deliveries.json` — єдиний його запис до першого застосування ([SP_CTX_02_35](./context_editor.deliveries.sp.md#SP_CTX_02_35)). Оболонка може змінити й цей файл — та сама межа, що й для самого запису доставки ([C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10)).

Правило діє лише в поточній сесії: передача «документом» — поза ним ([C_CTX_DEC_36](./context_editor.curation.concept.md#C_CTX_DEC_36)); засів «транскриптом» застосовує правки, тож ScreenPerson діє і в BuildSeed ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)). Команди, що знімала б відмову, немає.

### 02_59. DescribePasted  {#SP_CTX_02_59}

Purpose: `describe` замінює медіа й вставлені блоки промпту людини описом агента; набраний людиною текст лишається дослівним, оригінал іде в архів ([C_CTX_DEC_39](./context_editor.curation.concept.md#C_CTX_DEC_39)). Розширює `run describe` ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)).

Processing logic (pseudocode):
    PasteBlocks(text) = the spans <pasted_content id="X">…</pasted_content id="X"> (the closing tag repeats the id) and <pasted_content>…</pasted_content>, in order, not nested
    in PrepareEdits: describe of a prompt row needs media of the row OR PasteBlocks(text) not empty; else rejected "no media or pasted text found in that row"
    run describe (rows of the apply):
        kinds = (media of the row archived ? media) + (PasteBlocks(text) ? pasted text)
        IF kinds empty: fail "no media or pasted text found in that row now"
        typed = text with paste block k (from 1) replaced by "[pasted text <k>, <chars> chars: see your description above]"
        row text = DescribedWords(kinds) + note + mediaNote(row) + ": " + description + "\n\n" + typed
        DescribedWords: media → "Later, your context_edit describe call replaced the media you had seen here with your own description" (DESCRIBED, як досі)
                        pasted text → "Later, your context_edit describe call replaced the pasted text you had seen here with your own description"
                        both → "Later, your context_edit describe call replaced the media and the pasted text you had seen here with your own description"

Набраний текст — усе поза блоками вставок і медіа, зокрема рамки хоста в тому самому рядку (контекст редактора, нагадування): `describe` їх не чіпає. Опис уже описаного рядка можливий, лише коли в ньому лишилися медіа чи вставки. isDescribedText (`hooks/rows.ts`, STRUCT-01) розпізнає DESCRIBED_HEAD — голову кожного відкривача `describe` цієї версії — і старі форми, тож CollapsedList і PersonRow ([SP_CTX_02_58](#SP_CTX_02_58)) бачать описаний промпт.

Ворота перед кодом пройдено (фаза 39, 2026-10-15, хости 2.1.296 і 2.1.299; [SP_CTX_05_07](#SP_CTX_05_07)): хост ставить обгортку в сам текст рядка — її бачать `prompt.submit`, `session.append`, `$.session.messages()`, форма API і транскрипт, тож PasteBlocks читає текст рядка. Обгорнуто: велику вставку в терміналі (згорнуту в «[Pasted text #1 +N lines]»), записи поля SDK `pasted_content` (дописані після набраного тексту) і `inline_pastes` (на своєму місці в тексті); розширення VS Code (OSS, 2.1.299 і 2.1.300) за своїм кодом шле вставки полем `inline_pastes` — наживо не спостережено. Коротка вставка в терміналі, яку хост не згортає, лишається набраним текстом без обгортки (спостережено на 2.1.299) — `describe` її не відрізнить, і вона лишається дослівною. Id обгортки — один на сесію (чотири шістнадцяткові знаки), тож блоки розрізняє лише порядок, а не id.

Опис лише вставки перебудовує рядок, тож медіа промпту, якого застосування не бачить, пропало б без архіву: коли форма API обрізана вікном до цього рядка, правка не застосовується («outside the API window; media unknown»), а коли медіа промптів не зіставлено з рядками — «the prompt may hold media that cannot be archived» (як для `collapse`, [SP_CTX_DEC_06](./context_editor.decisions-01.sp.md#SP_CTX_DEC_06)).

Медіа, яке застосування знайшло, але не заархівувало, лишається в рядку: опис самої вставки поряд із ним не застосовується («media could not be archived», як для медіа). Межа: блок без id закінчується першим `</pasted_content>` у тексті, тож вставка, що сама містить цей тег, обріжеться на ньому; блоки з id (термінал і поля SDK, [SP_CTX_05_07](#SP_CTX_05_07)) цього не мають, бо закривальний тег повторює id.

Errors: NO_MEDIA при постановці («no media or pasted text found in that row») і при застосуванні («… now»), як для медіа.

### 02_60. RecordHostRows  {#SP_CTX_02_60}

Purpose: записати рядок хоста в мить, коли хост його додає, з `handle` видимого рядка перед ним, щоб список показав його агенту, а правка `drop` могла його прибрати ([C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11), [SP_CTX_DEC_42](#SP_CTX_DEC_42)).

Як хост поводиться з цими рядками (спайк [context_editor_hostrows](./context_editor_hostrows.spike.md), Q1, Q4, Q6; P24). Він пише їх з `isMeta`; ні `$.session.messages()`, ні `e.messages` обробника компактизації їх не мають: усі 157 рядків входу застосування сесії 355660b2, які назвав `ledger.json`, — звичайні рядки. Після того як обробник повернув рядки, хост сам ставить кожен рядок хоста одразу за видимим рядком, що стояв перед ним, якщо той повернувся зі своїм `handle`; повернутий без `handle` чи прибраний попередник забирає рядки хоста за ним. Живий зонд підтвердив це правило (спайк, Q6): після застосування `1792073861340` H1 передбачала 8 приміток і 3 звіти субагентів, H3 (хост тримає всі) — 10 і 5, а в ланцюжку стало 7 і 3: зайву примітку забрав KeepResponsesWhole, що перебудував її попередника без `handle`; системний рядок хоста між видимим рядком і рядком хоста попередником не рахується. `handle` дорівнює `uuid` рядка транскрипту: так показують `ledger.json` і ремонт фази 32 ([SP_CTX_02_45](./context_editor.resume.sp.md#SP_CTX_02_45)), а типи хоста описують `uuid` у `session.append` як ідентифікатор рядка, той самий у транскрипті й на кожному пізнішому читанні.

Processing logic (pseudocode):
    memory of the module, per session id: lastVisible: { handle, kind, head }?; window: bool = false
    ON session.append of the main conversation (no agentId):
        m = e.message
        IF m.type ∈ {user, assistant} AND NOT m.isMeta:
            IF window AND NOT PersonPrompt(e): RETURN              # копії застосування й рядки команди мода не стають попередником
            window = false; lastVisible = { handle: e.uuid, kind: KindOf(m), head: Head(m) }; RETURN
        IF m.type = user AND m.isMeta AND NOT window AND lastVisible AND m has no media and no tool_result:
            k = HostFrame(text of m)
            IF k:
                at = the storage folder of this session, taken synchronously at the event (as RecordDelivery, CONC-01); none → RETURN
                put on the hostrows chain synchronously, run in the background in at:
                append { id: "h" + next, kind: k, after: lastVisible.handle, afterKind: lastVisible.kind, afterHead: lastVisible.head,
                         text: text cut to MAX_HOST_TEXT, chars: len(text) }; next += 1
                drop the oldest records while their count > MAX_HOST_ROWS or the file > MAX_QUEUE_BYTES
    ON turn.start: window = false
    at the very start of HandleCompaction, HandleRepair, HandleSeed, and at the entry of the session.compact hook on the pass branch (main conversation, not precompute) before next, synchronously, before any await:
        window = true; lastVisible = none                         # спостерігач чужої компактизації біжить після next, коли копії хоста вже пройшли
    PersonPrompt(e) = e.door ∈ {prompt, command} AND e.origin.kind ∈ HUMAN (composer, bridge, sdk, unclassified; SP_CTX_02_12)
                      AND the text carries no compaction marker of the mod (markerKind, REPAIR_MARKER; rows.ts, STRUCT-01)   # у терміналі власна /compact мода дає рядок поза ланцюжком з дверима prompt
    KindOf(m) = assistant → response; user with a tool_result → result; else prompt
    Head(m) = one line cut to MAX_HEAD by OneLine: prompt → 'the prompt "<its text>"', a command row (<command-name>) → 'the command "/<name> <args>"' from its command-name and command-args; response → 'your text "<its text>"', or 'your call <tool name>' without text; result → 'the result of a tool call'
    after the commit point of HandleCompaction (SP_CTX_02_07: rows returned, dispatch not abandoned) and of the repair (SP_CTX_02_47), in the background on the hostrows chain, reading the file anew (CONC-02):
        rebase the records on the input (RebaseHostRows; the repair rebases none), keep those whose after is the handle of a row of out that came back with it,
        each now after = "#<k>", the index of that row in out (the host gives the copies new uuids, SP_CTX_01_31); the others are gone (SP_CTX_02_61)
    a skip (nothing applied), a failure or an abandoned dispatch leaves the file as it was: the conversation did not change
    observer of another compaction (SP_CTX_02_18): every record goes, `next` stays; seed (SP_CTX_02_26): the new session starts without records

Вікно копій відкривається синхронно на початку кожної гілки компактизації, тож жоден рядок, що прийде після неї, не стане попередником, поки не почнеться наступний хід (`turn.start`) чи не прийде промпт людини. Так копії застосування (у stream-json вони знову проходять `session.append`, асистентські — дверима `response` з моделлю `<synthetic>`), рядки команди `/compact` мода (у терміналі вони `session.append` минають) і промпт продовження Flush не стають попередником, хай яке їхнє походження. Поза вікном попередником стає будь-який не-`isMeta` рядок `user` чи `assistant` основної розмови.

Поза записами лишаються: рядок хоста, що прийшов у вікні копій, — найчастіше звіт субагента між ходами одразу після власної `/compact` мода (у ланцюжку після застосування `1792073861340` — усі три): він не потрапляє до списку і йде лише разом із рядком перед ним, рядком виводу команди `/compact`, який агент може згорнути; рядки, що з'явилися до запуску модуля (відновлена сесія, модуль підключено пізніше); усі рядки там, де вбудований керований плагін пропускає двері `session.append` повз мод ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)).

Errors: відмов немає; збій запису лише лишає рядок хоста поза списком.

Реалізація (фаза 45). Дім — `hooks/hostrows.ts`: `observeHostRow` (синхронно, над пам'яттю модуля HostMemory), `openWindow`/`closeWindow`, `recordHostRow`, `keepHostRows`. Пам'ять одна на екземпляр модуля, а не на `session_id`: після `/clear` першим видимим рядком нової сесії стає її промпт, а передача сесії й так відкриває вікно своєю компактизацією. Межа: звіт субагента, що прийшов після `/clear` чи `/resume` раніше за перший видимий рядок нової сесії, записується з `after` старої сесії; такий запис не має попередника, і перше ж застосування називає його серед рядків, що пішли, і прибирає. PersonPrompt не рахує промптом рядки виводу й примітки локальної команди (`<local-command-stdout>`, `<local-command-caveat>`): у терміналі їх пише власна `/compact` мода. `register.ts` відкриває вікно на вході хука `session.compact`, щойно відома гілка, до будь-якого `await`: для власних гілок мода (застосування, засів, ремонт) завжди, для гілки `pass` — лише основної розмови й не `precompute`; це той самий синхронний момент, що «на самому початку» кожного обробника. Запис стає на ланцюжок `hostrows` синхронно, а `recordHostRow` читає, відкладає вбік зіпсований файл і пише всередині цього ланцюжка (як RecordDelivery): `Store.update` бере свій ланцюжок сам, тож у вже взятому ланцюжку той самий ланцюжок чекав би вічно. KeepHostRows після фіксації застосування й ремонту — `Store.update` поза ланцюжком, у фоні. Спостерігач чужої компактизації прибирає записи, але лишає `next`: `id`, який агент ще пам'ятає, не назве іншого рядка.

### 02_61. HostList  {#SP_CTX_02_61}

Purpose: показати записані рядки хоста агенту окремим списком з `id` і прибирати їх правкою `drop` за `id`, повертаючи рядок перед ними без `handle` ([SP_CTX_DEC_42](#SP_CTX_DEC_42)). Серед рядків перегляду їх немає: індекси, ключ переліку, діапазони й теги лишаються такими, як без курування.

Processing logic (pseudocode):
    in context_list (SP_CTX_02_01), IF the hostrows file has records:
        header line, also with "count":0: 'Host rows: <n> (~<chars> chars), not in the indexes; drop one with {"op":"drop","host":"<id>"}: h1 skill, h2 peer, …'
        after the rows of a page that holds the newest row: "Host rows (added by the host, not the person's words):", then for each of the newest MAX_HOST_LIST records, newest last:
            '<id> <kind>, <chars> chars, after <afterHead>: "<the head of its text, one line, cut to MAX_HEAD>"'
        older records are named only in the header line
    in PrepareEdits (SP_CTX_02_03), drop with host:
        host together with tool_use_id or ref → rejected HOST_EXCLUSIVE
        no record with that id → rejected HOST_UNKNOWN
        the same id already in this call or in the queued batch → rejected HOST_TWICE
        QueuedEdit keeps { op: drop, host: id }; the result of the call adds DetachNote(record)
    in ApplyEdits (SP_CTX_02_04) of HandleCompaction, after every other step of the batch:
        rec = the record with that id in the hostrows file read for this apply, rebased on the rows after DropPulled (RebaseHostRows); absent → fails "drop <id>: no such host row now"
        P = the row of e.messages with handle = rec.after
        P rebuilt or removed by an earlier step of this batch → the edit counts as applied: "<id> went with the rows your edits replaced"
        P not in e.messages at all → fails "drop <id>: no such row now"; the record goes in the commit step (SP_CTX_02_60)
        P ∈ mediaOwners, or P a prompt while unmatchedPromptMedia > 0 → fails HOST_MEDIA   # ті самі перевірки, що в collapse: без handle медіа P пропало б
        P a result outside knownResults, or a prompt before the first known result while the API form is cut by its window → fails "drop <id>: outside the API window; media unknown"
        Detach(P): P comes back without its handle, rebuilt from its text, calls and results; every host row after P goes with it
        the archive of the apply gets the text of each record whose after = P.handle
        Detach counts as a change of P for FrozenPrefix and KeepResponsesWhole (SP_CTX_02_04)
    report (SP_CTX_02_04): "dropped host row <id> (<kind>, <chars> chars)"; each other record after the same P: "<id2> (<kind>) went with it: the host keeps them after the same row"; DetachNote(rec)
        records not named by a drop whose P came back without its handle or not at all: "Host rows that went with rebuilt rows: <id> (<kind>), …."
    BuildSeed (SP_CTX_02_22): the seed takes no host rows; a drop with host counts as applied
    DetachNote(rec): afterKind prompt → "the prompt before it comes back without its handle: the host's attachments of that prompt (reminders, files, editor context) go; its text stays"
                     response → "your response before it comes back without its handle: its thinking blocks go, and host rows after its other rows go with it"
                     result → none                              # рядки результатів застосування й так перебудовує (SP_CTX_DEC_02)

Наслідки в наявних контрактах. Перелік ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)) додає рядок заголовка й секцію списку; позначок рядків хоста серед рядків немає, і Key() ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) не змінюється. Правка `drop` бере нову ціль `host` ([SP_CTX_01_30](#SP_CTX_01_30)). Рядок хоста не буває ціллю `collapse`, `summarize`, `rewrite`, `describe` чи тегу: його немає серед рядків, а згортання рядка перед ним забирає його з собою, і звіт про це каже.

Текст навички, яку відкрив інструмент `Skill`, — рядок хоста за рядком результату «Launching skill» (навичка plugin-hooks, п. 46; порядок дверей щодо цього рядка наживо не перевірено, SP_CTX_05_07). Перебудова незмінних рядків результатів ([SP_CTX_DEC_02](./context_editor.decisions-01.sp.md#SP_CTX_DEC_02)) повертає цей рядок без `handle`, тож перше ж застосування без `keep_cache` забирає текст навички, а повторний `Skill` хост не вставляє. Звіт називає такий запис серед рядків, що пішли з перебудованими; як зберегти таку навичку, вирішує пункт backlog PL_CTX «Навичка, відкрита інструментом `Skill`, зникає після застосування».

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| HOST_UNKNOWN | `drop` з `host`, якого немає у файлі | `no host row <id>; context_list names them` |
| HOST_MEDIA | рядок перед рядком хоста має медіа, чи це промпт при неспівставлених медіа промптів (перевіряється при застосуванні: у перегляді `handle` немає) | `the row before <id> holds media that would be lost; describe or summarize it first` |
| HOST_EXCLUSIVE | `drop` має `host` разом із `tool_use_id` чи `ref` | `edit <n>: host excludes tool_use_id and ref` |
| HOST_TWICE | той самий `id` двічі в пакеті | `edit <n>: host row <id> is already in this batch` |

Межа: два процеси хоста на одній сесії ведуть кожен свою пам'ять модуля й можуть дати однакові `h<n>` у тому самому файлі, як і з іншими файлами сховища ([SP_CTX_DEC_10](./context_editor.decisions-01.sp.md#SP_CTX_DEC_10)); `drop` тоді бере найновіший запис із цим `id`.

Реалізація (фаза 45). Список будує `contextList` (`hooks/stages.ts`) з `hostHeader` і `hostSection`; рядок заголовка стоїть після телеметрії. `drop` з `host` — окремий варіант Edit `{ op: 'drop', host }` (`isHostDrop`, `isPairEdit` у `edits.ts`); `id` не тієї форми відхиляє checkShape (`host is the id of a host row from context_list (h1, h2, …)`). HOST_UNKNOWN і HOST_TWICE перевіряє PrepareEdits до перевірок цілі: пін, слот стану й індекси рядка хоста не стосуються. Результат виклику додає `drop <id>: <DetachNote>.`. Detach іде в `applyEdits` після решти кроків. Друга правка того самого попередника в пакеті рахується застосованою без нового рядка звіту; правка, чийого попередника немає у вході («no such row now»), теж називає свій запис, тож рядок про рядки, що пішли, його не повторює. Нечитабельний `hostrows.json` при постановці дає HOST_UNKNOWN: записів, які можна назвати, немає. Рядки звіту (`ApplyReport.hostLines`) стоять після рядка про доставки, кожен закінчується крапкою; рядок DetachNote має вигляд `<id>: <DetachNote>.`. Рядок «Host rows that went with rebuilt rows» рахується на остаточних рядках, після InsertDeliveries і DropOwnCalls: рядок, який перебудувала DropOwnCalls, теж забирає рядки хоста за ним. Засів відбирає правки `drop` з `host` до `applyEdits` і додає їх до застосованих.

### 02_62. ReplacementOpeners  {#SP_CTX_02_62}

Purpose: текст заміни говорить від імені агента і несе походження змісту; статусу змісту він не несе ([C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06), [C_CTX_DEC_33](./context_editor.curation.concept.md#C_CTX_DEC_33), [C_CTX_DEC_40](./context_editor.curation.concept.md#C_CTX_DEC_40), [SP_CTX_DEC_44](#SP_CTX_DEC_44)). Змінює тексти `run summarize`, `run collapse`, `run rewrite`, `run describe` ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)).

Processing logic (pseudocode):
    Quoted(q) = q ? ", which you quoted from later," : ""
    summarize: (via = tag ? TAG_SUMMARIZED_OF : SUMMARIZED_OF) + SourceOf(call) + " you had read here" + Quoted(quoted) + (via = tag ? " with your own note" : " with your own summary")
    collapse:  collapsedWords(n, list, via) with Quoted(quoted) before " with your own note"   # перелік у дужках і далі — походження діапазону (CollapsedList)
    rewrite:   RewrittenWords(via)
    describe:  DescribedWords(kinds)   # SP_CTX_02_59
    then, as before: note (" (original: <archive>, open with Read)") + mediaNote + ": " + agent text

Приклад: `Later, your context_edit summarize call replaced the full output of Read docs/x.md you had read here, which you quoted from later, with your own summary (original: …, open with Read): …`.

Розпізнавання (ReplacementText, `hooks/rows.ts`, STRUCT-01): REPLACEMENT_OPENERS отримує голови SUMMARIZED_OF, TAG_SUMMARIZED_OF, DESCRIBED_HEAD, STATE_REBUILT і TRACE_OPENER; повні відкривачі фази 28 лишаються в списку, бо збережені сесії мають і їх. Голови `rewrite`, `collapse` і тегових `rewrite`/`collapse` не змінюються. Заміна тегу `disposable` будується тими самими словами з `via = tag`.

Ворота перед кодом пройдено (фаза 39, 2026-10-15; живий сценарій «Тексти замін з походженням і статусом», [SP_CTX_05_07](#SP_CTX_05_07), як спайк [context_editor_authorship](./context_editor_authorship.spike.md)): з джерелом у відкривачі агент і далі визнає стискання своїм (28 з 28 сесій з джерелом і статусом, 9 з 9 у контролі з поточними текстами; P13, P23 не повертаються, хоча у варіантах зі статусом траплялись 1 заперечення власних викликів і 2 «вигадав» при малому n). Слова статусу після «with your own summary» довіри майже не змінили (впевненість haiku: контроль (поточні тексти, без джерела й статусу) 94.6, `read` 91.4, `inferred` 93.8, `assumed` 86.0), тож відкривач іде лише з джерелом ([SP_CTX_DEC_44](#SP_CTX_DEC_44)).

Errors: власних відмов немає; поле `status` правки чи тегу мод ігнорує як зайве ([SP_CTX_01_30](#SP_CTX_01_30), [SP_CTX_DEC_44](#SP_CTX_DEC_44)).

### 02_63. DependencyCheck  {#SP_CTX_02_63}

Purpose: попередити, коли факти оригіналу процитовано в пізніших текстах агента і після правки їхнє єдине джерело зникне з вигляду ([C_CTX_06_07](./context_editor.curation.concept.md#C_CTX_06_07); гіпотеза). Ніколи не відмовляє.

Processing logic (pseudocode):
    FUNCTION DependencyHits(rows, edit) → { rows, examples }:   # PrepareEdits: summarize, drop, collapse
        target = the result of the pair (summarize: the call's input stays) | the call's input and its result (drop) | texts, inputs and results of rows[from..to] (collapse)   # не весь рядок результатів: у ньому бувають результати паралельних викликів
        later = assistant rows after the end of target with non-empty text that is not ReplacementText
        frags = Fragments of each text of later, row by row in row order, distinct, ≤ MAX_DEP_FRAGMENTS in all   # не з цілі: перші MAX_DEP_FRAGMENTS фрагментів великого виводу бувають самим наповненням
        an input counts by its values (strings and numbers), not by its JSON text: JSON escapes quotes, backslashes and line breaks
        others = every text, input and result of the conversation outside target and outside later
        hits = f ∈ frags WITH target contains f AND no row of others contains f
        RETURN { rows: rows of later holding hits (≤ MAX_BLOCK_INDEXES), examples: first DEP_EXAMPLES hits }
    Fragments(text) — distinct, in text order, ≤ MAX_DEP_FRAGMENTS, each DEP_MIN..DEP_MAX chars:
        quoted spans between "…", “…”, «…» or `…`;
        identifiers [A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)+; tokens of letters, digits, "_" and "-" with at least one letter and one digit (hashes, values such as secret-value-9f3a2b);
        paths: tokens with "/" and a ".", or starting with "/", "./" or "~/"; URLs;
        numbers with at least 4 digits, a decimal point or a "%";
        each trimmed of a trailing ".,:;!?" and of "*" or "_" at either end (prose and markdown around a quote)
    an accepted edit with hits: QueuedEdit.quoted = true; the result of context_edit adds
        "Note: <label> — facts from it are quoted in your later text #i, #j (e.g. "<f1>", "<f2>"); " + Keep(op) + "."
    Keep(drop) = "after the edit no row holds their source: summarize it instead to keep them"
    Keep(summarize | collapse) = "after the edit only your replacement holds their source: keep them in it"

Заміна з `quoted` каже `which you quoted from later` ([SP_CTX_02_62](#SP_CTX_02_62)); `drop` тексту заміни не має, тож для нього сигнал — лише застереження, і воно радить `summarize` замість `drop`. Фрагменти беруться з пізніших текстів, а не з цілі, і токени з літер і цифр входять у Fragments: так показав живий прогін фази 42 — агент процитував значення `secret-value-9f3a2b` зі 173-го рядка файлу, ключ якого стояв і в промпті людини; старі правила не дали жодного фрагмента. Тексти `later` — лише текст рядків; виклики тих самих рядків належать до `others`. Рядки й фрагменти нумерує той самий перегляд, що й `context_list`. Fragments, DependencyHits і текст застереження (`dependencyNote`) живуть у `edits.ts`, виклик — у QueueEdits (`queue.ts`) після PersonWords. Тег `disposable` перевірки не проходить: концепт називає лише три операції. Ціна — пошук фрагментів у пізніших текстах агента, обмежений MAX_DEP_FRAGMENTS; чи варта перевірка своєї ціни, показують живі прогони ([SP_CTX_05_07](#SP_CTX_05_07)).

### 02_64. TraceOwnCalls  {#SP_CTX_02_64}

Purpose: на місці прибраних викликів `context_*` лишити один рядок голосом агента: що він тут зробив ([C_CTX_06_07](./context_editor.curation.concept.md#C_CTX_06_07); гіпотеза проти P13 і P23). Частина DropOwnCalls ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)).

Processing logic (pseudocode):
    in DropOwnCalls, after the own pairs to remove are known and before KeepResponsesWhole:
        FOR each stretch from a prompt row to the next (Responses, SP_CTX_02_04) with at least one removed own pair:
            calls = the removed own calls of the stretch, in order
            trace = Row { role: assistant, text: TraceText(calls), toolUses: [] }   # без handle
            put trace in place of the row of the first call of calls when DropOwnCalls removes that row, else right before that row   # не між викликом і його результатом
    TraceText(calls) = TRACE_OPENER + "; you had called " + items joined ", " + "."   # ≤ MAX_TRACE, обрізання OneLine
        items by tool, in order of first call:
            context_list → "context_list" + (n > 1 ? " " + n + " times" : "")
            context_edit → "context_edit with <k> edit(s)"          # k — сума len(input.edits) його викликів
            context_tag → "context_tag to " + parts joined ", ", one per distinct part in order of its first request: "open stage \"<name>\"" ("open a stage" without a string name), "close the stage", "add <m> <kind> tag(s)" (додані теги за видом), "remove <m> tag(s)"; no part → "context_tag"
            context_note → "context_note (<a> added, <r> removed)"
            context_handoff → "context_handoff"

Однакові рядки сліду одного відрізка (пари, що лишились після одного застосування й пішли з наступним) RepeatsIn ([SP_CTX_02_46](./context_editor.resume.sp.md#SP_CTX_02_46)) повтором не вважає. Лічильники кожного інструмента сумуються по всіх його викликах відрізка; вхід не тієї форми дає ім'я інструмента без подробиць (`context_edit with 0 edit(s)`). Опис іде за входом виклику, а не за результатом: виклик, який мод відхилив, теж названо, тож рядок каже «called», а не «queued». Пари замороженого префікса й пари біля медіа лишаються в розмові, і сліду для них немає; відрізок, де лишились усі власні пари, сліду не отримує. MergeCallRows ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) може влити рядок сліду в текст попереднього перезібраного рядка викликів — прийнято. Звіт застосування й далі каже OwnCallsText. BuildSeed робить так само.

### 02_65. SupersededRead  {#SP_CTX_02_65}

Purpose: позначити раннє читання файлу, чий вміст відтоді змінився, `superseded` ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08)). Правило R6, частина MarkCall ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)) поряд із R4; R5 (`duplicate`, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)) не змінюється.

Processing logic (pseudocode):
    memory of the module: ReadPaths: set<string> = {}   # шляхи, чиї читання бачив цей екземпляр; перезавантаження скидає
    ON a finished, not denied, non-error Read call of the main loop:
        path = input.file_path
        IF path NOT IN ReadPaths: ReadPaths += path; RETURN
        in the background, on the registry chain, IF storage ready AND TagRegistry not unreadable:
            rows = CurrentRows()
            FOR each earlier Read pair e (its call row before this call's row; this call's row not found: none) WITH input.file_path = path, result not error, result not ReplacementText:
                IF e has a tag other than review big, search or duplicate: CONTINUE
                same = offset, limit, pages of the two calls equal (absent equals only absent)
                IF Changed(e.result, this result, same): tag e { review, reason superseded }   # заміняє review big, search, duplicate
            write TagRegistry if changed
    Changed(a, b, same) = NumberedLines(a) and NumberedLines(b) both non-empty AND ((same AND the two maps differ in numbers or text) OR some line number n is in both with different text)
    NumberedLines(text) = the lines matching ^\s*(\d+)\t(.*)$ → number → text   # форма виводу Read (cat -n)

Діапазони без спільних рядків нічого не кажуть про зміну і тегу не дають. Зміни через оболонку правило бачить лише тоді, коли агент перечитав файл ([SP_CTX_DEC_13](./context_editor.decisions-01.sp.md#SP_CTX_DEC_13)). Тег показується `[review: superseded]`; він не заміняє `stale`, `pin`, `disposable` і `state`. Вивід цього виклику — `text` результату `tool.call`, як його читає модель; без нього (відповідь хука) R6 не діє. Дім: `markSuperseded`, `changedRead`, `numberedLines`, `seenRead` і `supersededReads` у `hooks/tags.ts`; ReadPaths — у пам'яті модуля `register.ts`, R6 — гілка читання того самого `afterCall`, що для запису запускає R4, на ланцюжку реєстру; шлях іде в ReadPaths і тоді, коли `text` немає. Тег `review` з причиною `agent` R6 теж не заміняє; як і R4, R6 бачить лише теги з ціллю `tool_use_id` пари (діапазон `disposable` чи пін за якорем рядка її не захищають). Порівнюються лише пронумеровані рядки: на повторне `Read` незміненого файлу хост (2.1.299) відповідає заглушкою «File unchanged since last read…» без рядків, а текст навколо рядків (нагадування хоста) змінюється сам; вивід без пронумерованих рядків тегу не дає (рев'ю фази 43).

### 02_66. ReadyReplacements  {#SP_CTX_02_66}

Purpose: у звіті закриття етапу назвати застарілі читання блоку з готовими текстами замін; приймає їх агент своїм пакетом, сам мод нічого не замінює ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08), [C_CTX_DEC_08](./context_editor.core.concept.md#C_CTX_DEC_08)). Частина BlockReport ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)).

Processing logic (pseudocode):
    in BlockReport, after "Candidates in the block":
        ready = Read pairs with call and result in a..e, an active review tag of reason superseded, stale or duplicate, result not ReplacementText
        IF ready: text += "\nReady replacements (summarize each with its text and what you still need from it): "
                       + ("#<i> <alias or tool_use_id> \"<Ready(tag, path)>\"" for each, ≤ MAX_BLOCK_INDEXES, then "+<n> more") joined "; " + "."
    Ready: superseded → "Outdated: <path> was read again later and its content had changed."
           stale → "Outdated: you changed <path> later."
           duplicate → "Duplicate: a later read repeated this read of <path>."
    path = the path part of SourceOf (SP_CTX_01_28)

Понад MAX_BLOCK_INDEXES записів рядок закінчується `; +<n> more.`. Текст `duplicate` не каже «той самий вивід»: R5 позначає і те саме читання діапазону з іншим текстом, коли R6 не спрацював (перше перечитування після перезавантаження). Пара `Read` без шляху запису не дає. Псевдонім і cwd BlockReport бере з BlockIO (`readAliases`, `cwd`, обидва — погляди); без них — `tool_use_id` і абсолютний шлях. Дім: `readyReplacements` у `hooks/stages.ts`. Тексти не мають індексів: після застосування індекси зсуваються, а текст заміни лишається. Агент копіює текст у `summarize` разом із тим, що зі старої версії ще потрібно; джерело в заміну ставить мод ([SP_CTX_02_62](#SP_CTX_02_62)).

### 02_67. StateEdit  {#SP_CTX_02_67}

Purpose: змінювати слот стану дельтами пунктів; текст рядка слота збирає мод при застосуванні ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08), [SP_CTX_DEC_41](#SP_CTX_DEC_41)).

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

### 02_68. Pins  {#SP_CTX_02_68}

Purpose: піни — рішення агента; мод ставить два піни передачі — рядок документа в новій сесії (PinDocument) і, як досі, підсумок засіву «транскриптом» (PinSummary, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) — і кожен із них агент знімає ([C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10), [C_CTX_DEC_36](./context_editor.curation.concept.md#C_CTX_DEC_36), [C_CTX_DEC_38](./context_editor.curation.concept.md#C_CTX_DEC_38)).

Processing logic (pseudocode):
    AutoTag (SP_CTX_02_12): rule R1 is removed; AutoTagNeeded loses its R1 clause   # перший промпт людини не пінить ніхто
    PinDocument, at the turn end, in the change of step (2) (TagRegistry.turn += 1, SP_CTX_02):
        IF NOT reg.docChecked:
            rows = CurrentRows()
            IF rows not empty:
                d = the first i < (index of the first assistant row, or len(rows)) with DocumentRow(rows[i])   # stream-json: the host writes the rows of the mod's /clear before the document
                IF d exists AND rows[d] has no tag AND len(reg.tags) < MAX_TAGS:   # «no tag»: no tag whose target is row 0 or a range starting at it (sameTarget, by the first row's anchor); a pair tag does not count
                    put Tag { kind: pin, target: { anchor: fingerprint(rows[d]), hint: d }, created_turn: reg.turn }
                reg.docChecked = true
    DocumentRow(row) = a user row without results whose text, after a leading line that matches ^The .+ plugin sent a message:$ (PLUGIN_FRAME, SP_CTX_02_02), starts with DOCUMENT_FRAME

Кожен пін агент знімає `context_tag` з `remove`, коли має причину: свій, пін документа, пін підсумку засіву (PinSummary, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) і піни, які R1 поставив у сесіях до цієї версії. Документ, що поїхав прихованим контекстом промпту людини (шлях черги, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), рядком не є і піна не отримує. Перший кінець ходу кожної сесії один раз читає перегляд.

### 02_69. CurationTexts  {#SP_CTX_02_69}

Purpose: правила й тексти, якими агент дізнається про курування ([C_CTX_06_09](./context_editor.curation.concept.md#C_CTX_06_09), [C_CTX_06_12](./context_editor.curation.concept.md#C_CTX_06_12), [SP_CTX_DEC_43](#SP_CTX_DEC_43)). Точні тексти пише фаза реалізації в межах, названих тут.

Файл правил курування `skills/context-stages/curation.md` (≤ CURATION_MAX символів, перевіряє `tests/skill-limits.sh`) — друга частина навички. Він містить: правила [C_CTX_06_09](./context_editor.curation.concept.md#C_CTX_06_09) (урок із лічбою спроб і причиною; виправлення лише за зовнішнім сигналом, пакетом на межі етапу; дослівна цитата недовіреного тексту з атрибуцією; архів перед каяттям у вигадці; правка замість «ігноруй»; зведення вимог додаванням; не видаляти архівів і транскриптів; огляд підстав і згортання розвідки до висновку на закритті етапу; засліплена перевірка — лише порада), форму операції `state`, рядки сліду й готові заміни, список рядків хоста і `drop` за `id`, `describe` для медіа і вставок.

`context_list` з `"rules": true` ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)) повертає текст `curation.md`, який мод читає з `$.plugin.root`, замість переліку: читання поза проєктом хост дозволяє лише з дозволу людини ([C_CTX_DEC_28](./context_editor.core.concept.md#C_CTX_DEC_28)), а мод читає власний файл без цього. Файл не прочитався — `context-editor: the curation rules could not be read: <error>`.

Зміни наявних текстів:

| Текст | Зміна |
|-------|-------|
| SKILL.md ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) | «Usually keep verbatim: the person's messages…» і «(the person's first prompt is pinned for you)» → повідомлення й відповіді людини в цій сесії лишаються дослівними: правку, що їх захоплює, мод відхиляє; описати медіа чи вставку її промпту можна; піни ставить і знімає агент; рядки хоста зі списку `context_list` — не слова людини, їх прибирає `drop` за `id`. «It is no loss and nothing you made up» → заміну зробив агент, а джерело в ній каже, звідки зміст; перш ніж назвати щось вигадкою, відкрити архів. Рядок про правила курування: `context_list` з `"rules": true`. Межа 9000 символів лишається |
| INTRO_TEXT | «the person's messages, rules and skills in use usually stay verbatim» → «the person's messages stay verbatim; rules and skills in use usually too»; рядок про правила курування |
| STAGE_ADVICE (і через неї WaitingAdvice та звіт закриття) | повідомлення людини «stay verbatim: edits that cover them are refused» замість «keep them verbatim unless you drop them deliberately»; «Usually keep verbatim the person's messages, rules…» → «Usually keep the rules and skills still in force…»; додати: невдалі спроби — у урок «tried X ×N → failed because Y → do Z» |
| EDIT_DESCRIPTION ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), ≤ MAX_DESCRIPTION; 2043 з 2048 після фази 45: рядок `drop` — `{"op":"drop","tool_use_id", "ref" or "host"}: remove a useless call and its result, or a host row.`, а речення про слот — «changes only by a rewrite, or by the state op once it has items»; що таке `host`, каже опис поля в схемі; 2037 після фази 44, 1888 після фази 40, до неї 2024; на ціль `"host"` фази 45 лишилося 11 символів, `tests/boundary.test.ts`) | додати: рядок операції `{"op":"state","changes"}`; вставки в рядку `describe`; ціль `"host"` у рядку `drop`; «або операцією `state`, коли слот має пункти» в реченні про `[state]`; в останньому абзаці — повідомлення людини (і відповіді AskUserQuestion) лишаються дослівними, правки, що їх захоплюють, відхиляються. Місце: абзац про `ref` переходить в опис поля REF (там уже те саме), текст відновлення за замовчуванням — в опис поля `resume_prompt`; подробиці `changes` — в описі поля. Порядок скорочення пунктів 02_02 не змінюється, нові речення стоять поряд із тими, що їх стосуються |
| TAG_DESCRIPTION ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), ≤ MAX_DESCRIPTION) | без «The person's first prompt is pinned for you.»; у пункті про слот стану «change it only by a rewrite of that row» → «change it by a rewrite of that row, or by the state op once it has items» |
| Відмова STATE_SLOT ([SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03)) і інваріант тегу `state` ([SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)) | «change it only by rewrite of that row» → «change it by rewrite of that row, or by the state op once it has items»; інваріант — так само |
| SKILL.md, розділ State slot (фаза 44) | після речення про `rewrite`: пункти через `{"op":"state","changes":[…]}` (`set`, `mark` harmful/outdated, `unmark`, `remove` за `id`), застосування перебудовує слот, далі його змінює лише `state`; тег іде за перебудованим рядком |
| Відмова BAD_TARGET тегу `disposable` на слоті ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) | «change it only by a rewrite of that row» → «change it by a rewrite of that row, or by the state op once it has items» |
| Легенда переліку ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)) | причина `superseded`; `[state] your state slot (rewrite only)` → `(rewrite, or the state op once it has items)`; рядок заголовка й секція рядків хоста ([SP_CTX_02_61](#SP_CTX_02_61)) |

Тексти COMPACT_ADVICE, COMPACT_REPLY і CompactBrief ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42), [SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55)) уже кажуть лишати слова людини дослівними і не змінюються; запит документа передачі (HANDOFF_PROMPT) і опис `context_handoff` і далі просять завдання й обмеження людини дослівно ([C_CTX_DEC_36](./context_editor.curation.concept.md#C_CTX_DEC_36)).

## 03. Validation Rules — курування

### 03_03. Input Validation  {#SP_CTX_03_03}

- Поля статусу правки й теги не мають ([SP_CTX_DEC_44](#SP_CTX_DEC_44)): `status` мод ігнорує, як будь-яке зайве поле (checkShape правки, isTag тегу).
- Правка, що захоплює слова людини, відхиляється при постановці (PERSON_WORDS) і не застосовується (PERSON_WORDS_NOW); тег `disposable` над ними не ставиться (PERSON_TAG). `describe` дозволено над промптом людини, коли в ньому є медіа чи вставка.
- Правка `state` вимагає слота і пунктів, на які посилається; `rewrite` слота з пунктами і `rewrite` слота поряд із `state` в одному пакеті відхиляються.
- `drop` з `host` бере `id` зі списку рядків хоста і не бере `tool_use_id` чи `ref` (HOST_EXCLUSIVE, HOST_UNKNOWN, HOST_TWICE); інші операції рядків хоста не бачать.
- `context_list` з `"rules": true` інших параметрів не бере.

### 03_04. Output Validation  {#SP_CTX_03_04}

- Кожна заміна, яку пише ця версія, починається з повного відкривача чи голови з REPLACEMENT_OPENERS, говорить від імені агента і, для `summarize`, називає джерело; слів статусу в ній немає.
- Набраний людиною текст рядка після `describe` той самий, що в оригіналі, з позначками вставок на їхніх місцях.
- Текст із рамкою хоста ніколи не рахується словами людини (PersonText порожній); після застосування лишаються лише записи, чий попередник повернувся зі своїм `handle`; рядок перед прибраним рядком хоста повертається без `handle`, а результат і звіт кажуть, що він утратив.
- Текст слота стану після застосування `state` — рівно STATE_REBUILT, рядок архіву й Assemble(items).
- Рядок сліду стоїть лише у відрізку, де застосування прибрало власні пари.

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

### 04_09. Host Row Record Lifecycle  {#SP_CTX_04_09}

State diagram:
    [none] --session.append of the host row outside the copy window--> [recorded]
    [recorded] --apply returns its predecessor with the handle--> [recorded]
    [recorded] --drop by its id, or its predecessor rebuilt without the handle or left out--> [none]
    [recorded] --another compaction--> [none]

Transition rules:
| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| none | recorded | `session.append` рядка `isMeta` з HostFrame поза вікном копій, попередник відомий | запис з `id` і `after`; рядок у списку |
| recorded | recorded | застосування повернуло попередника з `handle` | хост ставить рядок хоста назад; запис лишається |
| recorded | none | `drop` за `id` (Detach), або застосування перебудувало попередника без `handle` (правка самого попередника, KeepResponsesWhole, перебудова незмінних рядків результатів) чи прибрало його | фіксація цього самого застосування прибирає запис; звіт називає рядок хоста |
| recorded | none | чужа компактизація | записи прибрано, `next` лишається |

## 05. Verification Criteria — курування

### 05_05. Functional Expectations  {#SP_CTX_05_05}

| Contract | Scenario | Input | Expected outcome |
|----------|----------|-------|------------------|
| PersonWords | діапазон над промптом | `collapse` #3..#6, #4 — промпт людини | відхилено PERSON_WORDS з #4 (prompt); правки з виклику не стали в чергу |
| PersonWords | пара AskUserQuestion | `summarize` пари AskUserQuestion | відхилено: «the AskUserQuestion answer is the person's words» |
| PersonWords | `drop` з доставкою | `drop` пари, за результатом якої висить доставка людини | відхилено з порадою `summarize` |
| PersonWords | тег над промптом | `disposable` #2..#5 з промптом | запит відхилено, тегу немає |
| PersonWords | перевірка при застосуванні | `pending.json` змінено поза інструментами: `collapse` над промптом | застосування: PERSON_WORDS_NOW першим у `failed`, рядки людини на місці |
| PersonWords | рамка хоста | PersonText тексту, що починається з PEER_FRAME | порожній: не слова людини |
| PersonWords | описаний промпт | `collapse` діапазону з промптом після `describe` | відхилено PERSON_WORDS з `#i (described prompt)` |
| PersonWords | тег у QueueTagReplacements | `disposable`, чия ціль тепер захоплює промпт | тег прибрано; рядок `disposable <target> dropped: it covers the person's words` у результаті виклику |
| DescribePasted | лише вставка | `describe` промпту «Лог: <pasted_content id="a">…</pasted_content id="a"> що не так?» | текст: голова «…replaced the pasted text…», опис, далі «Лог: [pasted text 1, <n> chars: see your description above] що не так?»; оригінал в архіві |
| DescribePasted | медіа і вставка | промпт із зображенням і вставкою | голова «…replaced the media and the pasted text…» |
| DescribePasted | нічого замінювати | промпт без медіа й вставок | NO_MEDIA |
| RecordHostRows | розгорнута навичка | `session.append` рядка `isMeta` з SKILL_FRAME після команди людини `/dev-flow spec` | запис `{ id: h1, kind: skill, after: <uuid команди>, afterKind: prompt, afterHead: 'the command "/dev-flow spec"' }` |
| RecordHostRows | вікно копій | рядок `isMeta` з PEER_FRAME після рядків команди `/compact` мода, до промпту людини | запису немає |
| RecordHostRows | копія асистента в stream-json | рядок дверима `response` з моделлю `<synthetic>` у вікні | `lastVisible` порожній, як був |
| RecordHostRows | промпт людини закриває вікно | промпт людини після застосування, за ним рядок навички | вікно закрито; запис за промптом |
| HostList | список | `context_list` з двома записами | рядок заголовка `… h1 skill, h2 peer`; секція з двома рядками; індекси рядків ті самі |
| HostList | `drop` за `id` | `{"op":"drop","host":"h1"}` | у результаті DetachNote; при застосуванні попередник без `handle`, звіт `dropped host row h1 (skill, <n> chars)`, текст рядка в архіві, запису немає |
| HostList | два рядки за одним попередником | `drop` h3, за тим самим рядком стоїть h4 | обидва прибрано; звіт `h4 (peer) went with it` |
| HostList | невідомий `id` | `drop` h9 | HOST_UNKNOWN |
| HostList | попередник із медіа | `drop` рядка за промптом із зображенням | HOST_MEDIA |
| HostList | попередника згорнуто | `collapse` над попередником h2 | звіт `Host rows that went with rebuilt rows: h2 (peer).`; запису немає |
| HostList | навичка інструмента `Skill` | застосування без `keep_cache` після `Skill` | запис за рядком «Launching skill» зник; звіт його називає |
| HostList | чужа компактизація | вбудована `/compact` | файл прибрано, списку немає |
| ReplacementOpeners | `summarize` з джерелом | `Read docs/x.md` | текст починається `Later, your context_edit summarize call replaced the full output of Read docs/x.md you had read here with your own summary (original:` |
| ReplacementOpeners | зайве поле `status` | `summarize` з `"status": "inferred"` | прийнято; поле ігнорується, слів статусу в заміні немає |
| ReplacementOpeners | розпізнавання | старі й нові відкривачі | ReplacementText — так для обох |
| DependencyCheck | цитата в пізнішому тексті | ідентифікатор оригіналу є лише в пізнішому тексті агента | прийнято із застереженням, що називає рядок і фрагмент; заміна каже `which you quoted from later` |
| DependencyCheck | інше джерело лишається | той самий фрагмент і в іншому рядку поза ціллю | застереження немає |
| TraceOwnCalls | відрізок з `context_tag` і `context_edit` | `open` етапу й правка з трьома правками | один рядок `…; you had called context_tag to open stage "x", context_edit with 3 edit(s).` |
| TraceOwnCalls | заморожений префікс | `keep_cache`, власні пари в префіксі | сліду для них немає |
| SupersededRead | той самий діапазон, інший текст | друге `Read` того самого файлу після зміни | раннє читання — `review superseded` |
| SupersededRead | інший діапазон, спільні рядки різні | `Read` рядків 40–60 після повного читання і зміни рядка 50 | `superseded` |
| SupersededRead | без спільних рядків | рядки 1–10, потім 200–210 | тегу немає |
| ReadyReplacements | блок із застарілим читанням | закриття етапу | рядок `Ready replacements …: #12 c45 "Outdated: docs/x.md was read again later and its content had changed."` |
| StateEdit | додати пункт плану | `{"op":"state","changes":[{"do":"add","kind":"plan","text":"write spec"}]}` | текст слота: STATE_REBUILT, рядок архіву, `Plan:` і `- p1: write spec`; `items`, `nextItem` = 2 |
| StateEdit | немає слота | правка `state` без тегу `state` | NO_STATE_SLOT |
| StateEdit | `rewrite` слота з пунктами | `rewrite` рядка слота | STATE_ITEMS |
| Pins | перший промпт | початок сесії | пінів немає |
| Pins | передача «документом» | перший кінець ходу нової сесії | пін на рядку 0; `docChecked` = true |
| CurationTexts | правила курування | `context_list` з `"rules": true` | текст `curation.md` |
| CurationTexts | файл понад межу | `curation.md` довший за CURATION_MAX | `tests/skill-limits.sh` падає |
| CurationTexts | файл не прочитався | у `$.plugin.root` немає `curation.md` | `context-editor: the curation rules could not be read: <error>` |
| StateEdit | дві правки `state` | дві правки в одному пакеті | одна перебудова слота, обидві в `applied` |
| StateEdit | `rewrite` і `state` слота разом | `state`, потім `rewrite` рядка слота | друга відхилена STATE_CONFLICT |

### 05_06. Invariant Checks  {#SP_CTX_05_06}

| Invariant | Verification method |
|-----------|-------------------|
| Жодне застосування не змінює набраного людиною тексту | модульний тест на ScreenPerson і `describe`; живий сценарій «Слова людини» |
| Рядок хоста не рахується словами людини | PersonText для кожної рамки HostFrame порожній |
| Заміни цієї версії несуть джерело і не несуть статусу | тести текстів `run summarize`, `run collapse`; ReplacementText для нових голів |
| Слот стану дорівнює зібраним пунктам | тест `run state`: текст = STATE_REBUILT + архів + Assemble |
| Запис лишається, лише поки попередник повертається зі своїм `handle` | тест фіксації: попередник із `handle`, без нього, відсутній |
| У вікні копій записів немає | тест RecordHostRows з відкритим вікном: копії, рядки команди, рядок `isMeta` |
| R6 не чіпає `pin`, `disposable`, `state`, `stale` | тест MarkCall з такими тегами на ранньому читанні |
| Рядок сліду лише там, де прибрано власні пари | тест DropOwnCalls зі збереженими парами (префікс, медіа) |

### 05_07. Integration Scenarios  {#SP_CTX_05_07}

| Scenario | Preconditions | Steps | Expected result |
|----------|--------------|-------|-----------------|
| Тексти замін з походженням і статусом (ворота перед кодом текстів) | копія сесії, як у спайку [context_editor_authorship](./context_editor_authorship.spike.md); haiku і sonnet | застосувати `summarize` і `collapse` з новими текстами й різними статусами; спитати агента про стиснуте | агент визнає стискання своїм (P13, P23 не повертаються) і частіше перевіряє виведене й припущене, ніж прочитане. Спостережено 2026-10-15 (фаза 39, 57 сесій на 2.1.296, `.dev_flow/cache/live-test/curation-gate/texts/results.md`): авторство — 28 з 28 з джерелом і статусом, 9 з 9 у контролі, «не бачив вмісту» не частіше, ніж у контролі; впевненість після стискання (haiku, 5 сесій на варіант) — контроль (поточні тексти, без джерела й статусу) 94.6, `read` 91.4, `inferred` 93.8, `assumed` 86.0: статус довіри майже не змінює; розробник: «Лише джерело, без статусу» ([SP_CTX_DEC_44](#SP_CTX_DEC_44)) |
| Тексти замін з джерелом (повтор у фазі 41, на коді мода) | копія сесії, як у спайку [context_editor_authorship](./context_editor_authorship.spike.md); haiku і sonnet | застосувати `summarize` і `collapse` з відкривачем лише з джерелом ([SP_CTX_DEC_44](#SP_CTX_DEC_44)); спитати агента, хто писав стиснуте і чи бачив він вміст | агент визнає стискання своїм не рідше, ніж у контролі воріт фази 39 (9 з 9), і не каже частіше, що вмісту не бачив (P13, P23 не повертаються). Спостережено 2026-10-16 (фаза 41, 9 сесій на 2.1.296, `.dev_flow/cache/live-test/curation-p41/results.md`): авторство 9 з 9; «вмісту не бачив» 2 з 9 (haiku 1 з 6, sonnet 1 з 3) проти 3 з 9 у контролі (haiku 3 з 6, sonnet 0 з 3); «вигадав» і заперечень викликів немає |
| Слід власних викликів | живий прогін з кількома етапами | закрити етап, застосувати, спитати про власні виклики й цитати їхнього виводу | агент не заперечує викликів і не називає цитат вигадкою (P13, P23). Спостережено 2026-10-16 (фаза 42, 12 сесій на 2.1.296, контроль — код фази 41, `.dev_flow/cache/live-test/curation-p42/results.md`): слід у 6/6, агенти називають виклики за ним; заперечення викликів 0 з 6 проти 1 з 6 у контролі; прямого «вигадав» 0 з 6 проти 1 з 6, обережне «may have made up» про вивід прибраного `context_list` лишилось (3 з 6 проти 1 з 6): слід називає виклик, а не вивід. DependencyCheck: застереження 6/6, заміна каже `which you quoted from later`; чи змінює воно рішення агента — `unobserved` (людина звеліла стиснути без фактів) |
| Рядки хоста | термінал і stream-json; навичка зі slash-командою; звіт субагента між ходами без застосування; звіт одразу після рядків команди `/compact` мода; навичка з інструмента `Skill` | (1) записи після `session.append`, `context_list`; (2) `drop` за `id`, застосувати; (3) застосування без правок рядків хоста; (4) звіт одразу після `/compact` мода; (5) `Skill`, потім застосування | (1) `after` — `uuid` попереднього видимого рядка, список показує записи; (2) рядка хоста немає в транскрипті, попередник без `handle`, решта правок на своїх індексах; (3) записи лишаються, рядки хоста на місцях; (4) запису немає, рядок іде лише разом із рядком перед ним; (5) текст навички зник, звіт називає запис. Перевірити тут же: порядок і походження рядків `/compact` мода щодо початку обробника й копій; порядок дверей `tool-message` навички `Skill` щодо результату «Launching skill» і чи починається вона з SKILL_FRAME; чи минають `session.append` рядки локальних команд людини в терміналі; чи проходять `session.append` у stream-json рядки хоста, які хост повертає після застосування. Правило розміщення хостом спостережено 2026-10-15 (спайк [context_editor_hostrows](./context_editor_hostrows.spike.md), Q6) Спостережено 2026-10-16 (фаза 45, stream-json, 2.1.296, haiku і sonnet, `.dev_flow/cache/live-test/curation-p45/results.md`): (1) записи після slash-команди й `Skill`, список `h1 skill, h2 skill`; (3) застосування без правок рядків хоста лишило h1, а навичка `Skill` пішла, звіт її назвав (5); (2) `drop` h1 прибрав навичку з ланцюжка, `hostrows.json` порожній. Перша версія показала, що хост пише повернуті рядки копіями з новими `uuid` (RebaseHostRows, [SP_CTX_01_31](#SP_CTX_01_31)). Термінал, звіти субагентів і крок (4) наживо не перевірено |
| Обгортка вставок (ворота перед кодом `describe` вставок) | термінал і VS Code (stream-json) | вставити текст у промпт; прочитати рядок у `$.session.messages()` і у формі API | де стоїть `<pasted_content …>`: у тексті рядка, лише у формі API чи ніде ([SP_CTX_02_59](#SP_CTX_02_59)); опис замінює лише вставку. Спостережено 2026-10-15 (фаза 39, пробний плагін `.dev_flow/cache/live-test/curation-gate/paste-probe/`): у тексті рядка на 2.1.296 і 2.1.299 — велика вставка в терміналі, `pasted_content` і `inline_pastes` у stream-json; коротка вставка в терміналі не обгортається (2.1.299) |
| Слова людини | живий прогін | попросити агента згорнути блок із промптом людини | відмова PERSON_WORDS; агент ділить діапазон. Спостережено 2026-10-15 (фаза 40, stream-json, haiku): `context_edit` і `context_tag` над промптом дали PERSON_WORDS і PERSON_TAG, черга порожня, промпт дослівний, автопіну немає; на межі незавершеної пари першою спрацьовує відмова пари |
| Thinking-блоки на новому акаунті | акаунт, створений від 2026-08-31, модель із перевіркою префікса | правка посередині розмови, застосування, наступний хід | хід іде або помилка, яку мод називає; поведінкові правки частішають лише після цього прогону ([C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11)). Стандартними засобами `unobserved`: акаунта, створеного від 2026-08-31, немає. Лише спостереження (фаза 39, 2.1.299, opus, недокументований перемикач хоста `CLAUDE_CODE_POLISHED_DEWDROP=block`, на який дизайн не спирається): thinking-блок незмінної відповіді після місця правки дав 400 «Invalid `signature` in `thinking` block…», хост відкинув блок і повторив запит, хід минув; блоки перебудованих рядків мод і так губить |
| Правила курування | сесія з модом, встановленим поза проєктом | `context_list` з `"rules": true` | текст правил без запиту дозволу |
| Пін документа | передача «документом» з продовженням | кінець першого ходу нової сесії; `context_list` | `[pin]` на рядку документа; агент знімає його `remove`. Спостережено 2026-10-15 (фаза 40, stream-json): хост пише рядки `/clear` перед документом (документ на #1), тож PinDocument шукає його серед рядків до першої відповіді; після виправлення пін на #1, `remove` його знімає |

### 05_08. Edge Cases and Boundaries  {#SP_CTX_05_08}

| Case | Input | Expected behavior |
|------|-------|-------------------|
| Людина вставила текст, що починається з рамки хоста | промпт «Base directory for this skill: …», набраний людиною | рахується рядком хоста, а не словами людини; рамку не набирають руками — прийнято |
| Промпт лише з вставки | промпт без набраного тексту | `describe` лишає лише позначку вставки; `collapse` відхилено |
| Чотири однакові розгорнуті навички | записи з тим самим текстом | кожен має свій `id` і свій `after`; `drop` одного не чіпає інших |
| Свіжий рядок хоста | навичку викликано в цьому ході | у списку одразу; номери рядків ті самі |
| Сесія, відкрита знову | `--resume`; рядки хоста з'явилися до запуску модуля | записів немає, рядки поза списком; записи, зроблені до перезапуску, діють, поки попередники зберігають `handle` |
| Обхід дверей `session.append` керованим плагіном | [SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54) | записів немає; списку немає, як до курування |
| Описаний промпт плагіна | `describe` медіа в промпті плагіна | рядок рахується словами людини (DescribedText) — надмірний захист прийнято |
| Попередник рядка хоста — відповідь агента з thinking | `drop` за `id` | Detach перебудовує всю відповідь (KeepResponsesWhole), thinking-блоки пропадають; DetachNote про це каже |
| Попередник рядка хоста — промпт людини | `drop` навички за `id` | промпт повертається без `handle` з тим самим текстом; вкладення хоста цього промпту (нагадування, файли, контекст редактора) зникають; DetachNote про це каже |
| Промпт лише з медіа | до `describe` і після | до опису PersonText порожній, і правило слів людини його не захищає; після — захищає (DescribedText); прийнято |
| Слот без пунктів і правка `state` | вільний текст у слоті | текст переходить в архів, слот — зібрані пункти |
| Два `state` в одному пакеті | дві правки | одна перебудова слота, зміни по черзі; друга при постановці бачить пункти першої, але не їхні `id` |
| `id` зник до застосування | `pending.json` змінено поза інструментами | перебудови немає; усі правки `state` пакета — у `failed` з «no item <id> now» |
| Тег `state` перенесено на рядок із `rewrite` у черзі | `rewrite` рядка X у черзі, потім тег `state` на X при наявних пунктах | застосування переписує слот вільним текстом (STATE_ITEMS при застосуванні не перевіряється), тег іде за переписаним рядком, а пункти лишаються в реєстрі до наступної `state`; `state` у тому ж пакеті — OVERLAP з `rewrite` |
| Реєстр не записався | збій запису у фіксації | слот показує нові пункти, реєстр — старі; звіт про це каже, наступна `state` починає зі збережених |
| Пін першого промпту зі старої сесії | R1 до цієї версії | звичайний пін; агент знімає його `remove` |
| Звіт закриття з 30 застарілими читаннями | блок | 20 записів і `+10 more` |

## 06. Reversibility — курування

### 06_02. Rollback Strategy  {#SP_CTX_06_02}

| Aspect | Rollback approach |
|--------|-------------------|
| Data/state changes | `hostrows.json` можна видалити: список рядків хоста порожніє, а самі рядки лишаються в розмові. Полів `quoted` правок, `items`, `nextItem`, `docChecked` реєстру старіша версія не бачить: її розбір пропускає зайві поля (parseRegistry зливає невідомі поля верхнього рівня, checkShape і isTag зайвих ключів не перевіряють). Ламають її розбір лише причина `superseded` тегу `review`, операція `state` і `drop` з `host` у черзі: реєстр чи черга для неї `unreadable`. Перед поверненням версії — прибрати теги `superseded` (або видалити `tags.json` сесії) і застосувати чи видалити чергу з правками `state` і `drop` з `host` |
| Artifacts | `skills/context-stages/curation.md` прибирається разом із рядком навички про нього |
| Dependent modules | тексти замін цієї версії лишаються в збережених сесіях як інертний текст; старіша версія не розпізнає нових голів як заміну, тож позначки `*` переліку й R5 їх не бачать — прийнято |
| External contracts | параметри `state`, `"rules"` і ціль `host` правки `drop` зникають з інструментів; повернення попередження замість відмови — у PersonWarnings ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)); повернення R1 — рядок таблиці [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11) |

Кожен механізм відокремлюваний ([C_CTX_06_12](./context_editor.curation.concept.md#C_CTX_06_12)): правила навички відкочуються текстом, тексти замін — як у [C_CTX_DEC_25](./context_editor.core.concept.md#C_CTX_DEC_25), список рядків хоста — без запису `hostrows.json` і без цілі `host`.

## 07. Design Decisions — курування

### DEC_39 — Де лежить специфікація курування  {#SP_CTX_DEC_39}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Головний файл специфікації (21.7 тис. слів), структури (19.3 тис.) й очікування (25.3 тис.) уже понад `hard_split` (12 тис.), а Docs Scaling вимагає ділити файл, перш ніж додавати новий матеріал. Де розмістити специфікацію курування?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — окремий файл курування з власними структурами, контрактами, станами, перевірками, відкатом і рішеннями; у головному файлі — рядок таблиці файлів і покажчик рішень | великі файли не ростуть; наявні контракти отримують посилання сюди; поділ великих файлів — окремий пункт backlog |
| B — спершу поділити великі файли, потім дописати курування за нинішнім розкладом | окремий великий коміт перед специфікацією |
| C — дописати в наявні файли з записаним обґрунтуванням | файли ростуть понад межу |

**Decision:** A — розробник, 2026-10-15: «Окремий файл курування (Recommended)».
**Rationale:** курування — окрема відповідальність, як і в концепті ([C_CTX_DEC_32](./context_editor.concept.md#C_CTX_DEC_32)); новий матеріал не йде у файли понад межу.
**Rejected because:** B — затримує специфікацію великим поділом; C — порушує Docs Scaling.

### DEC_40 — Форма епістемного статусу  {#SP_CTX_DEC_40}

> **Status:** superseded
> **Date:** 2026-10-15

**Question:** Концепт лишив специфікації, чи статус один на заміну, чи стоїть і біля окремих фактів ([C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06)).

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — один на правку, обов'язковий для `summarize` і `collapse`, необов'язковий для `rewrite` і `describe`, без нього для `drop` | агент щоразу каже, наскільки надійний переказ; окремі факти позначає своїми словами |
| B — один на правку, необов'язковий | без статусу відкривач мовчить, як зараз |
| C — позначки біля фактів, які мод перевіряє й переносить у відкривач | точніше, але мод розбирає текст агента |

**Decision:** A — розробник, 2026-10-15: «Один на правку, обов'язковий (Recommended)».
**Rationale:** переказ чужого змісту — саме те місце, де виведене плутають із прочитаним; обов'язковий статус змушує агента сказати це щоразу, а мод не розбирає тексту.
**Rejected because:** B — статус пропускатимуть; C — мод розбирав би вільний текст агента.
**Superseded:** 2026-10-15 — [SP_CTX_DEC_44](#SP_CTX_DEC_44): ворота фази 39 показали, що слова статусу майже не змінюють довіри агента; статус знято з правок, тегів і відкривачів, заміна несе лише джерело.

### DEC_41 — Якою операцією змінюються пункти слота стану  {#SP_CTX_DEC_41}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Концепт лишив специфікації форму дельти слота стану: параметри переписування чи окрема операція ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08)).

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — операція `state` у `context_edit`: дельти add, set, mark, remove; пункти в реєстрі, текст збирає застосування | пункти й текст змінюються разом, як решта правок |
| B — параметр `items` у `rewrite` | без нової операції, але `rewrite` має два режими |
| C — через `context_tag` | реєстр змінюється одразу, текст — на застосуванні, тож перегляд показує пункти раніше, ніж вони є в розмові |

**Decision:** A — розробник, 2026-10-15: «Операція state у context_edit (Recommended)».
**Rationale:** зміна пунктів — правка рядка слота, тож вона йде тим самим шляхом і тим самим застосуванням, що й інші правки.
**Rejected because:** B — два режими однієї операції; C — розбіжність реєстру й розмови до застосування.

### DEC_42 — Як агент бачить і прибирає рядки хоста  {#SP_CTX_DEC_42}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Як мод робить рядки хоста видимими агенту і як агент їх прибирає? Обробник компактизації їх не отримує (`ledger.json`: 157 рядків входу застосування, жодного `isMeta`), а після застосування хост сам ставить кожен за видимим рядком перед ним, якщо той повернувся з `handle` (спайк [context_editor_hostrows](./context_editor_hostrows.spike.md), Q4, Q6).

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — після наступного застосування: мод записує їх із виходу власного застосування | неможливо: у виході обробника рядків хоста немає |
| B — одразу при додаванні: хук `session.append` читає розмову, щоб знайти місце | читання розмови в цьому хуку не перевірене (ризик затримки чи блокування запису) |
| B′ — серед рядків перегляду на їхніх місцях: запис при `session.append` з `handle` попередника, віртуальні рядки в перегляді й застосуванні | у перегляді `handle` немає, тож потрібні ще відбитки попередника; якір змагається з копіями застосування; два раунди рев'ю знаходили тут `must` |
| B″ — окремий список з `id`: запис при `session.append` з `handle` попередника, список у `context_list`, `drop` за `id` | видно одразу; індекси рядків не змінюються; якір потрібен лише в застосуванні, а там `handle` є; рядки, що прийшли у вікні копій (звіти одразу після `/compact` мода), поза списком; попередник прибраного рядка втрачає `handle` |
| C — не показувати рядків хоста | P24 лишається: розгорнуті навички й звіти субагентів займають контекст до кінця сесії |

**Decision:** B″ — розробник, 2026-10-15: «Окремий список з id (Recommended)». Перша відповідь, «Після наступного застосування (Recommended)» (A), спиралася на засновок, який спростувало рев'ю.
**Rationale:** рядків хоста немає ні в перегляді, ні у вході обробника, тож розміщувати їх серед індексів означало б будувати віртуальні рядки й два якорі для одного рядка. Список з `id` прибирає цю частину: якір — лише `handle`, а застосування його має; `handle` = `uuid` транскрипту показали `ledger.json` і ремонт фази 32 ([SP_CTX_02_45](./context_editor.resume.sp.md#SP_CTX_02_45)). Вікно копій замість перевірки походження: від синхронного скидання на початку кожної гілки компактизації до наступного ходу чи промпту людини жоден рядок не стає попередником.
**Rejected because:** A — неможливо; B — читання розмови в хуку не потрібне, коли якір є в пам'яті модуля; B′ — складніше, і два раунди рев'ю знаходили в ньому `must`; C — лишає вади P24.

### DEC_43 — Де лежать правила курування  {#SP_CTX_DEC_43}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Посібник навички SKILL.md має 8198 з 9000 символів, а правила курування потребують ще приблизно 2–2.5 тис. Як бути?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — підняти межу SKILL.md до 11 000 | усі правила в посібнику першого промпту; ~+500 токенів на початку кожної сесії |
| B — окремий файл навички, на який посилається посібник; агент читає його, коли курує | дешевше; правила можуть лишитися непрочитаними |
| C — у пораді закриття етапу й описах інструментів | порада закриття довшає на кожному етапі |

**Decision:** B — розробник, 2026-10-15: «Окремий файл навички».
**Rationale:** правила курування потрібні, коли агент курує, а не на кожному початку сесії. Читання поза проєктом хост дозволяє лише з дозволу людини ([C_CTX_DEC_28](./context_editor.core.concept.md#C_CTX_DEC_28)), а встановлений мод лежить поза проєктом, тож файл віддає сам мод: `context_list` з `"rules": true` ([SP_CTX_02_69](#SP_CTX_02_69)); посібник каже, коли його відкрити. Чи агент справді відкриває правила, перевіряють живі прогони.
**Rejected because:** A — ціна на кожному початку сесії; C — ціна на кожному закритті етапу.

### DEC_44 — Статус змісту в заміні після воріт  {#SP_CTX_DEC_44}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Ворота текстів замін (фаза 39, [SP_CTX_05_07](#SP_CTX_05_07), `.dev_flow/cache/live-test/curation-gate/texts/results.md`) показали: з джерелом у відкривачі агент визнає стискання своїм (28 з 28 сесій з джерелом і статусом, 9 з 9 у контролі з поточними текстами; P13, P23 не повертаються, хоча у варіантах зі статусом траплялись 1 заперечення власних викликів і 2 «вигадав» при малому n), але слова статусу довіри майже не змінюють. Чи лишати обов'язковий статус ([SP_CTX_DEC_40](#SP_CTX_DEC_40))?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — джерело й обов'язковий статус ([SP_CTX_DEC_40](#SP_CTX_DEC_40), A) | агент щоразу вибирає статус, мод тримає перелік, відмови STATUS_REQUIRED і BAD_STATUS, правило навички й місце в описах інструментів — заради ефекту, якого ворота не показали |
| B — лише джерело, без статусу | менше полів, відмов і тексту в описах; надійність окремих фактів агент за потреби називає своїми словами в тексті заміни |
| C — сильніші слова статусу й ще один прогін воріт | ще одна фаза воріт перед кодом без певності, що сильніші слова подіють |

**Decision:** B — розробник, 2026-10-15: «Лише джерело, без статусу».
**Rationale:** у другому раунді воріт (haiku, 5 сесій на варіант, впевненість 0–100 у стиснутому після застосування) контроль (поточні тексти, без джерела й статусу) — 94.6, `read` — 91.4, `inferred` — 93.8, `assumed` — 86.0; позначку `assumed` згадано лише у 2 з 5 відповідей, а незалежний доказ у тому самому контексті тягне впевненість угору у всіх варіантах. Критерій «частіше перевіряє виведене й припущене» не доведено, тож статус коштує полів, відмов і місця в описах без виміряного ефекту. Авторство тримає джерело й власний відкривач, а не статус.
**Rejected because:** A — ціна без ефекту; C — затримує код текстів замін ще однією фазою воріт без підстави чекати іншого результату.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-16 | Фаза 45 реалізована: HostRows, RecordHostRows, HostList ([SP_CTX_01_31](#SP_CTX_01_31), [SP_CTX_02_60](#SP_CTX_02_60), [SP_CTX_02_61](#SP_CTX_02_61)) — абзаци «Реалізація (фаза 45)»; за живим прогоном RebaseHostRows: запис після застосування тримає позицію попередника `#<k>` серед повернутих рядків (хост пише їх копіями з новими `uuid`), ремонт позицій не переносить; за рев'ю — PersonPrompt не рахує рядків локальної команди, Detach відмовляє й для промпту поза обрізаним вікном API, запис «no such row now» не повторюється в рядку про рядки, що пішли, спостерігач лишає `next`, межа пам'яті на процес; EDIT_DESCRIPTION — 2043 з 2048 ([SP_CTX_02_69](#SP_CTX_02_69)) |
| 2026-10-16 | Фаза 44 реалізована: StateEdit ([SP_CTX_02_67](#SP_CTX_02_67)) — дім `hooks/state.ts` і `edits.ts`; ціль ставлять PrepareEdits і ScreenPinned за тегом `state` у мить постановки й застосування; ARCHIVE_ROOM для SLOT_TOO_LONG при постановці; за рев'ю — межа пунктів і довжини при застосуванні, засів ставить ціль до відбору; мітка `state (<зміни>)`; `(no items)`; поля `items`/`nextItem` старого реєстру відсутні ([SP_CTX_01_29](#SP_CTX_01_29)); EDIT_DESCRIPTION — 2037 з 2048; SKILL.md і відмова BAD_TARGET називають операцію `state` ([SP_CTX_02_69](#SP_CTX_02_69)) |
| 2026-10-16 | Фаза 43 реалізована: SupersededRead ([SP_CTX_02_65](#SP_CTX_02_65)) — вивід із `text` виклику, `agent` не заміняється, дім у `tags.ts`; за рев'ю Changed порівнює лише пронумеровані рядки (заглушка хоста «File unchanged» тегу не дає), рядок поточного виклику не знайдено — тегу немає; текст `duplicate` — «a later read repeated this read of <path>»; ReadyReplacements ([SP_CTX_02_66](#SP_CTX_02_66)) — `; +<n> more.`, псевдонім і cwd з BlockIO; легенда переліку й опис `context_tag` називають `superseded` |
| 2026-10-16 | Фаза 42 реалізована: DependencyCheck ([SP_CTX_02_63](#SP_CTX_02_63)) — за живим прогоном фрагменти беруться з пізніших текстів агента (рядок за рядком), Fragments бере токени з літер і цифр; за рев'ю — вхід за значеннями, а не за JSON, обрізання прози й markdown; Keep(op): застереження `drop` радить `summarize`; `later` — лише текст рядків; дім у `edits.ts`, виклик у QueueEdits. TraceOwnCalls ([SP_CTX_02_64](#SP_CTX_02_64)) — `add <m> <kind> tag(s)` замість `<kind> <m>`, лічильники по всіх викликах відрізка, вхід не тієї форми — ім'я інструмента |
| 2026-10-16 | Фаза 41 реалізована: Source ([SP_CTX_01_28](#SP_CTX_01_28)) — дім `sourceOf` у `hooks/edits.ts` (`rows.ts` — ядро L0), робочий каталог через CompactionIO/HandoffIO `cwd`; за рев'ю — рядок носія `collapse`, правило шляху (кінцеві `/`, cwd `/`), місце шляху `Grep`, userinfo до останнього `@` |
| 2026-10-15 | Рев'ю фази 40: `describe` вставки поряд із незаархівованим медіа відхиляється (`media could not be archived`); межа блоку без id і межа «немає тегу» PinDocument записані в 02_59 і 02_68 |
| 2026-10-15 | Фаза 40 реалізована ([PL_CTX_P40](./context_editor.p40.plan.md#PL_CTX_P40)): EDIT_DESCRIPTION — 1888 з 2048 (абзац про `ref` — в опис поля, текст відновлення за замовчуванням — в опис `resume_prompt`); [SP_CTX_02_59](#SP_CTX_02_59): опис лише вставки не застосовується, коли медіа промпту застосуванню невидиме (вікно API, незіставлені медіа) |
| 2026-10-15 | Рев'ю фази 39 (pass with fixes): числа воріт уточнено — авторство 28 з 28 з джерелом і статусом, контроль з поточними текстами 9 з 9 і 94.6; варіант лише з джерелом окремо не проганяли — рядок [SP_CTX_05_07](#SP_CTX_05_07) «Тексти замін з джерелом» для фази 41; надсилання вставок розширенням VS Code — за його кодом, не наживо |
| 2026-10-15 | Ворота текстів замін (фаза 39): статус змісту знято ([SP_CTX_DEC_44](#SP_CTX_DEC_44), рішення розробника «Лише джерело, без статусу»; [SP_CTX_DEC_40](#SP_CTX_DEC_40) — `superseded`): 01_27 вилучено; поля `status` правок і тегів, STATUS_WORDS, StatusWords, STATUS_REQUIRED і BAD_STATUS прибрано з [SP_CTX_01_30](#SP_CTX_01_30), [SP_CTX_02_59](#SP_CTX_02_59), [SP_CTX_02_62](#SP_CTX_02_62), [SP_CTX_02_66](#SP_CTX_02_66), [SP_CTX_02_69](#SP_CTX_02_69), [SP_CTX_03_03](#SP_CTX_03_03), [SP_CTX_03_04](#SP_CTX_03_04), [SP_CTX_05_05](#SP_CTX_05_05), [SP_CTX_05_06](#SP_CTX_05_06), [SP_CTX_06_02](#SP_CTX_06_02); відкривач несе джерело і `which you quoted from later`; результат воріт — у [SP_CTX_05_07](#SP_CTX_05_07) |
| 2026-10-15 | Вузьке рев'ю B″ (pass with fixes): PersonPrompt не бере рядків з маркером мода; вікно копій відкривається на вході хука `session.compact` гілки `pass`; тека сховища береться синхронно (CONC-01); прибирання записів — лише після точки фіксації; `drop` за `host`, чий попередник відсутній у вході, падає; HOST_MEDIA з перевірками `collapse`; HOST_EXCLUSIVE, HOST_TWICE; голова рядка команди; межа двох процесів ([SP_CTX_02_60](#SP_CTX_02_60), [SP_CTX_02_61](#SP_CTX_02_61)) |
| 2026-10-15 | Рев'ю 2 (fail → виправлено): рядки хоста — окремий список з `id` ([SP_CTX_DEC_42](#SP_CTX_DEC_42), B″, рішення розробника «Окремий список з id (Recommended)»): запис при `session.append` з `handle`, видом і головою попередника, вікно копій від синхронного скидання на початку кожної гілки компактизації до `turn.start` чи промпту людини, список у `context_list`, `drop` з `host`; віртуальних рядків, WithHost, HOST_TARGET і HOST_GROUP немає; примітки до команд не записуються; DetachNote в результаті й звіті; запис прибирає фіксація того самого застосування; навичку інструмента `Skill` і [SP_CTX_DEC_02](./context_editor.decisions-01.sp.md#SP_CTX_DEC_02) названо. PersonRow — за DescribedText; тексти слота стану в [SP_CTX_02_69](#SP_CTX_02_69); коди збоїв `run state`; [SP_CTX_04_08](#SP_CTX_04_08) — `set` і `mark` позначеного пункту; промпт лише з медіа в [SP_CTX_05_08](#SP_CTX_05_08) |
| 2026-10-15 | Живий зонд Q6: правило розміщення рядків хоста підтверджено; ворота «`uuid` = `handle`» знято, запасний якір із відбитків трьох рядків прибрано; після компактизації `lastVisible` порожній ([SP_CTX_02_60](#SP_CTX_02_60), [SP_CTX_05_07](#SP_CTX_05_07), [SP_CTX_DEC_42](#SP_CTX_DEC_42)) |
| 2026-10-15 | Рев'ю 1 (fail → виправлено): рядки хоста записуються при `session.append` з якорем на попереднику і прибираються перебудовою попередника (Detach); спайк Q4 виправлено, додано Q6; DEC_42 — `proposed`. Описаний промпт лишається словами людини; `state` — шоста операція з винятками в 02_03, ScreenPinned і RebindTags, одна перебудова на пакет; ворота «Обгортка вставок»; ціль перевірки залежностей; місце рядка сліду; бюджет опису `context_edit`; відкат за фактичним розбором старішої версії; файл доставок — названий виняток |
| 2026-10-15 | Initial version: курування історії за [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06); рішення [SP_CTX_DEC_39](#SP_CTX_DEC_39)–[SP_CTX_DEC_43](#SP_CTX_DEC_43) з інтерв'ю специфікації; спайк [context_editor_hostrows](./context_editor_hostrows.spike.md) |
