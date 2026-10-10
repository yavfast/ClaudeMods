# Редактор контексту агента — Specification  {#SP_CTX}

> **Code:** SP_CTX
> **Status:** draft
> **Created:** 2026-10-08
> **Updated:** 2026-10-10
>
> **Concept:** [C_CTX](./context_editor.concept.md)
> **Depends on:** none
> **Used by:** —
> **Plan:** [PL_CTX](./context_editor.plan.md)
>
> Специфікація розширення Claude Code `context-editor` (одне розширення: воно і запускає компактизацію, і обробляє її, [C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02)): структури рядків, медіа-ресурсів, правок, тегів, етапів, черги, звіту, журналу ефекту, телеметрії, сховища і засіву нової сесії; контракти інструментів агента, застосування правок, запуску компактизації вбудованою командою, обробника компактизації, доставки звіту, пошуку медіа, тегування й авторозмітки, етапів і мітки оптимізації з ходом оптимізації, телеметрії на запит, інструкції на початку сесії і передачі в нову сесію засівом; правила перевірки; життєві цикли; критерії перевірки з живими сценаріями в інтерактивному терміналі і в неінтерактивному хості з потоковим входом; відкат. Читати перед зміною коду мода або написанням тестів до нього.

## Contents

- [01. Data Structures](#SP_CTX_01) — рядок розмови, правки, черга (із запитом оптимізації), звіт, архів, сховище, медіа-ресурс, теги та їх реєстр, реєстр псевдонімів, межа поточної розмови, запит передачі, засів нової сесії, етап і межа «після рядка», журнал ефекту, телеметрія, константи
- [02. Contracts](#SP_CTX_02) — перегляд з телеметрією, постановка правок, застосування, прибирання службових викликів, запуск компактизації і ходу оптимізації після ходу, обробник компактизації, доставка звіту, пошук медіа, тегування з етапами і слотом стану, автоправила, заміни з тегів, узгодження тегів і меж етапів, підготовка сховища, хук викликів (псевдоніми, застарілі читання, повторні читання), розв'язання псевдонімів, поточна розмова, передача в нову сесію (засів і його перевірки), обробка засіву, інструкція на початку сесії, телеметрія, блок етапу, мітка оптимізації, журнал ефекту
- [03. Validation Rules](#SP_CTX_03) — що перевіряється для вводу агента і для результату застосування
- [04. State Transitions](#SP_CTX_04) — життєвий цикл черги, окремої правки, тегу, запиту передачі, етапу і запиту оптимізації
- [05. Verification Criteria](#SP_CTX_05) — модульні очікування, інваріанти, інтеграційні сценарії, граничні випадки
- [06. Reversibility](#SP_CTX_06) — як вимкнути мод і що лишається
- [07. Design Decisions](#SP_CTX_DEC) — рішення рівня контрактів

## 01. Data Structures  {#SP_CTX_01}

> Implements: [C_CTX_02](./context_editor.concept.md#C_CTX_02)

Нотація типів абстрактна: `string`, `int`, `bool`, `list<T>`, `map<K, V>`, `set<T>`, `json` (будь-яке значення JSON), `T?` — необов'язкове поле без значення за замовчуванням. «Розмір» тексту — кількість символів.

### 01_01. Row  {#SP_CTX_01_01}

Рядок розмови в поданні хоста. Хост віддає не більше ROW_WINDOW останніх рядків; індекс 0 — найстаріший доступний рядок.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| role | `user` \| `assistant` | yes | — | — | Хто написав рядок |
| text | string | yes | `""` | — | Текстові блоки рядка, з'єднані |
| toolUses | list<ToolUse> | yes | `[]` | лише в рядку `assistant` | Виклики інструментів |
| toolResults | list<ToolResult>? | no | — | лише в рядку `user` | Результати інструментів |
| handle | string? | no | — | непрозорий; ставить лише хост | Присутній — хост зберігає рядок як є (з thinking-блоками і медіа); відсутній — хост збирає рядок лише з полів вище |

ToolUse:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| tool_use_id | string | yes | — | непорожній | Ідентифікатор виклику |
| tool | string | yes | — | непорожній | Повна назва інструменту |
| input | map<string, json> | yes | `{}` | — | Аргументи виклику |
| text | string? | no | — | — | Результат, як його прочитала модель; у зміненому виклику відсутній |

ToolResult:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| tool_use_id | string | yes | — | збігається з викликом | Ідентифікатор виклику |
| text | string | yes | `""` | — | Текстові блоки результату |
| isError | bool | yes | false | — | Результат — помилка |

Row не містить зображень і документів; їх знаходить [SP_CTX_02_10](#SP_CTX_02_10).

Invariants:
- Кожному `tool_use_id` у `toolUses` відповідає рівно один ToolResult з тим самим ідентифікатором у пізнішому рядку, і навпаки.
- `size(row)` = довжина `text` + довжина серіалізованого `input` кожного виклику + довжина `text` кожного результату.

### 01_02. Edit  {#SP_CTX_01_02}

Правка, як її передає агент. Варіант визначає поле `op`; кожне поле варіанта обов'язкове.

| op | Поля | Значення |
|----|------|----------|
| `summarize` | `tool_use_id: string` або `ref: string`, `summary: string` | Замінити результат виклику на `summary`; медіа цього результату замінюється разом з текстом |
| `drop` | `tool_use_id: string` або `ref: string` | Прибрати виклик і його результат разом з медіа |
| `collapse` | `from_index: int`, `to_index: int`, `summary: string` | Замінити рядки `from_index..to_index` (включно) одним підсумком |
| `rewrite` | `index: int`, `text: string` | Замінити текст рядка агента без викликів інструментів |
| `describe` | `index: int`, `description: string` | Замінити медіа в рядку промпту людини описом; текст промпту зберігається дослівно |

Обмеження: `summary`, `text`, `description` — непорожні після обрізання пробілів, не довші за MAX_TEXT. Для `summarize` і `drop` задається рівно одне з `tool_use_id` і `ref`; `ref` — псевдонім виклику або `last` ([SP_CTX_02_17](#SP_CTX_02_17)), у черзі правка зберігається вже з `tool_use_id`. Індекси — позиції в переліку [SP_CTX_02_01](#SP_CTX_02_01).

### 01_03. QueuedEdit  {#SP_CTX_01_03}

Edit плюс `anchors: list<string>?` — відбитки рядків для правок за індексом: для `collapse` — `[fingerprint(row[from_index]), fingerprint(row[to_index])]`, для `rewrite` і `describe` — `[fingerprint(row[index])]`, для правок за ідентифікатором — відсутні.

`fingerprint(row)` = `role` + `|` + ідентифікатори викликів (`u:<id>`) і результатів (`r:<id>`) через кому + `|` + перші 160 символів `text`.

### 01_04. Queue  {#SP_CTX_01_04}

Файл `<storage>/pending.json` ([SP_CTX_01_07](#SP_CTX_01_07)). Читає і пише лише мод; кожен запис іде послідовним ланцюжком черги.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| edits | list<QueuedEdit> | yes | `[]` | ≤ MAX_QUEUE_EDITS; серіалізований файл ≤ MAX_QUEUE_BYTES | Правки поточного пакета |
| resume | bool | yes | true | — | Продовжувати сесію після застосування поточного пакета |
| resumePrompt | string | yes | DEFAULT_RESUME | непорожній, ≤ MAX_TEXT | Текст продовження поточного пакета |
| tagsOnly | bool | yes | false | — | Пакет складається лише із замін з тегів |
| report | string? | no | — | — | Недоставлені звіти застосувань, з'єднані переносом рядка |
| reportId | int? | no | — | є разом з `report` | Час застосування, мс від епохи; ідентифікує звіт |
| reportResume | bool | yes | false | — | Після цього звіту потрібно продовжити сесію |
| reportPrompt | string | yes | DEFAULT_RESUME | — | Текст продовження для цього звіту |
| handoff | HandoffRequest? | no | — | [SP_CTX_01_15](#SP_CTX_01_15) | Запит передачі в нову сесію; поки він є, правки черги належать передачі |
| optimize | bool | yes | false | — | Мітку оптимізації помічено ([SP_CTX_02_30](#SP_CTX_02_30)): запит чекає ходу оптимізації ([SP_CTX_02_06](#SP_CTX_02_06)) або промпту людини ([SP_CTX_02_08](#SP_CTX_02_08)); блок запиту — `TagRegistry.lastClosed` ([SP_CTX_01_10](#SP_CTX_01_10)) |
| optimizePrompted | bool | yes | false | — | Промпт ходу оптимізації увійшов: мітку у відповіді наступного ходу основної розмови (ходу оптимізації) DetectOptimize ігнорує і знімає прапорець ([SP_CTX_02_30](#SP_CTX_02_30)); промпт людини між ходами теж його знімає ([SP_CTX_02_08](#SP_CTX_02_08)) — запобіжник петлі |

Стан файлу при читанні: `missing` (файлу немає — значення за замовчуванням), `ok`, `unreadable` (не читається, не розбирається або будь-яке поле має не свій тип). `unreadable` ніколи не трактується як порожня черга.

Invariants:
- `resume`, `resumePrompt`, `tagsOnly` стосуються лише поточного пакета і скидаються до значень за замовчуванням під час застосування.
- `report` і непорожній `edits` можуть існувати одночасно: звіт стосується попереднього пакета.
- `optimize` і `optimizePrompted` не бувають `true` одночасно: Flush заміняє `optimize = true` на `optimizePrompted = true` одним записом (порівняння-і-запис: лише коли `optimize` ще `true`) перед відправкою промпту ходу оптимізації і робить зворотну заміну, якщо промпт відхилено ([SP_CTX_02_06](#SP_CTX_02_06)); `optimizePrompted` знімає кінець наступного ходу основної розмови (DetectOptimize) або промпт людини між ходами.
- Поки є `handoff`, `optimize` не стає `true` ([SP_CTX_02_30](#SP_CTX_02_30)).
- Поля `optimize` і `optimizePrompted` змінюють лише DetectOptimize, Flush (Optimize) і DeliverReport. Кожен інший запис черги — HandleCompaction (зокрема гілка збою), context_edit, QueueTagReplacements, RemoveDelivered, записи передачі — переносить їх без змін: він читає чергу і змінює лише свої поля, а не будує файл зі значень за замовчуванням.

### 01_05. ApplyReport  {#SP_CTX_01_05}

| Field | Type | Description |
|-------|------|-------------|
| applied | list<string> | ≤ MAX_QUEUE_EDITS. Описи застосованих правок (`summarize <id>`, `drop <id>`, `collapse #a..#b`, `rewrite #i`, `describe #i`) |
| failed | list<string> | ≤ MAX_QUEUE_EDITS. Опис неприйнятої правки з причиною |
| charsBefore | int | Сума `size` рядків до застосування |
| charsAfter | int | Сума `size` рядків після застосування і [SP_CTX_02_05](#SP_CTX_02_05) |
| originals | list<{ edit: string, rows: list<Row> }> | ≤ MAX_QUEUE_EDITS записів, рядків не більше, ніж у розмові. Оригінали змінених рядків для архіву |
| produced | list<{ edit: string, index: int, fingerprint: string }> | ≤ MAX_QUEUE_EDITS. Для кожної застосованої правки, що заміняє рядки (`summarize`, `collapse`, `rewrite`, `describe`), — опис правки, індекс і відбиток останнього рядка, який вона створила (рядок результату пари для `summarize` і `collapse` з носієм, єдиний рядок підсумку для `collapse` без носія, переписаний рядок для `rewrite` і `describe`), у **кінцевому** списку: після DropOwnCalls і KeepResponsesWhole у компактизації, після нормалізації засіву в BuildSeed. Рядок, якого в кінцевому списку вже немає, запису не має. Рахує Produced нижче; читає RebindTags для меж етапів ([SP_CTX_02_14](#SP_CTX_02_14)) |
| mediaFiles | list<string> | ≤ кількості медіа-блоків у видимому вікні (≤ ROW_WINDOW повідомлень). Шляхи медіа-файлів, збережених цим застосуванням; для засіву ([SP_CTX_02_22](#SP_CTX_02_22)) — і медіа замінених пар, і медіа, перенесеного файлами |

Текстовий звіт — `FormatReport(report, archive, kind)`, `kind` = `compaction` | `seed`; форма залежить від того, чи застосовано хоч одну правку:
- `applied` непорожній: `context-editor: applied N edit(s): <applied>. Not applied: <failed>. Conversation ~<before> -> ~<after> chars (~<(before-after)/4> tokens freed). Originals archived at <path>. Media archived: <paths>.`
- `applied` порожній, `kind = compaction`: `context-editor: no edit was applied; the conversation was not changed. Not applied: <failed>.` — без рядка розміру і без «tokens freed»: обробник відповідає `skip`, і розмова справді не змінилась. Інваріант: у компактизації пакет непорожній, і кожна його правка або застосована, або в `failed`, тож тут `failed` непорожній.
- `applied` порожній, `kind = seed` ([SP_CTX_02_22](#SP_CTX_02_22)): `context-editor: no queued edit was applied. Not applied: <failed>.`, а коли `failed` теж порожній — порожній рядок. Рядка розміру немає: без правок розмір засіву відрізняється від видимих рядків лише прибраними службовими викликами мода, доданими CarryNote, головою-підсумком і нормалізацією (прибрані провідні рядки асистента й сирітські результати, рядок TRANSCRIPT_LINE), і «звільнено» про це було б неправдою.

Частини без даних пропускаються. Правило мінімальне: рядок розміру є тоді й лише тоді, коли застосовано хоч одну правку. `charsBefore` — розмір рядків, до яких правки застосовано (рядки події компактизації або видимі рядки засіву); `charsAfter` — розмір тих самих рядків після ApplyEdits і DropOwnCalls: у компактизації це повернений список, у засіві — до CarryNote і голови, тож «звільнено» рахує лише правки.

### 01_06. Archive  {#SP_CTX_01_06}

- Файл `<storage>/<reportId>.json` — `ApplyReport.originals` одного застосування. У `result` викликів і результатів пари, чиї медіа заархівовано окремими файлами, кожен рядок у алфавіті base64 довжиною ≥ MEDIA_DATA у полі `base64` або `data` замінено на `[media archived: <шляхи>]`; інші рядки, зокрема довгий текст у цих полях, лишаються: дані медіа не дублюються в JSON. Шлях вписується в текст кожного зміненого рядка (`(original: <path>, open with Read)`, [C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)) лише тоді, коли файл записано.
- Медіа-файли: кожен замінений медіа-ресурс — файл `<storage>/<reportId>/<n>.<ext>` (`n` від 1 у межах застосування; `ext` за `mediaType`: `png`, `jpg`, `gif`, `webp`, `pdf`, інакше `bin`), записаний з декодованих даних. Шляхи вписуються в текст зміненого рядка (`(media: <path>, …)`); для `drop` — лише у звіт.
- Передача способом `transcript` пише в сховище **старої** сесії за тією самою схемою: `<storage>/<id>.json` — оригінали змінених рядків, `<storage>/<id>/<n>.<ext>` — медіа замінених пар і медіа, перенесене файлами ([C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14)), `<storage>/<id>/seed.json` — засіяні рядки ([SP_CTX_01_17](#SP_CTX_01_17)); `id` — час збирання засіву, мс від епохи. Шляхи цих файлів вписано в текст засіяних рядків до очищення сесії, коли ідентифікатор нової сесії ще невідомий ([SP_CTX_DEC_09](#SP_CTX_DEC_09)).
- Зберігання: мод архіви не видаляє; їх обсяг обмежений сумою замінених і перенесених даних сесії. Винятки — файли засіву, який не дійшов до очищення сесії (відкладено або відмовлено): їх видаляє RunHandoff ([SP_CTX_02_21](#SP_CTX_02_21)), бо жоден рядок на них не посилається. Очищення — видаленням каталогу сховища ([SP_CTX_06_01](#SP_CTX_06_01)).

### 01_07. Storage  {#SP_CTX_01_07}

`<storage>` = `<HOME>/.claude/context-editor/<session_id>`. Без змінної `HOME` сховище недоступне. Сховище прив'язане до поточного `session_id`: `/clear` і `/resume` у тому самому процесі змінюють сесію без події старту сесії, тому мод перед кожною операцією порівнює поточний `session_id` зі збереженим і за розбіжності готує сховище заново ([SP_CTX_02_15](#SP_CTX_02_15)); черга і звіти попередньої сесії лишаються в її каталозі.

| Field | Type | Description |
|-------|------|-------------|
| state | `ready` \| `unavailable` | `ready` — каталог існує і доступний лише власникові |
| reason | string? | Чому `unavailable` |

Файли каталогу: `pending.json` (Queue), `tags.json` (TagRegistry), `aliases.json` (AliasRegistry), `boundary.json` (Boundary), `journal.json` (Journal, [SP_CTX_01_19](#SP_CTX_01_19)), архіви й медіа-файли застосувань і передач ([SP_CTX_01_06](#SP_CTX_01_06)), перенесені вбік черги `pending.json.bad-<ms>`. Файлу готовності немає: компактизацію запускає той самий модуль, що її обробляє ([C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)). Файл `editor-ready`, лишений версією з двома розширеннями, мод не читає і не пише.

### 01_08. MediaRef  {#SP_CTX_01_08}

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| mediaType | string | yes | — | напр. `image/png`, `application/pdf` | Тип даних блоку |
| bytes | int | yes | — | ≥ 0 | Розмір декодованих даних; 0 без вбудованих даних |
| data | string? | no | — | base64 | Вбудовані дані; відсутні — медіа неможливо архівувати |
| owner | `{ tool_use_id: string }` \| `{ row: int }` | yes | — | — | Чий ресурс: результату виклику або рядка промпту людини |

MediaRef живе лише під час перегляду і застосування; у файли не потрапляє. Список MediaRef одного власника не довший за кількість медіа-блоків його повідомлення.

### 01_09. Tag  {#SP_CTX_01_09}

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| kind | `pin` \| `disposable` \| `review` \| `state` | yes | — | — | Значення тегу ([C_CTX_03_04](./context_editor.concept.md#C_CTX_03_04)) |
| target | `{ tool_use_id: string }` \| `{ anchor: string, hint: int }` \| `{ anchor: string, hint: int, toAnchor: string, toHint: int }` | yes | — | `anchor`, `toAnchor` — fingerprint, `hint`, `toHint` — індекси на момент тегування; діапазон — лише для `disposable`, `hint < toHint` | Ціль: пара виклику, рядок або діапазон рядків від `anchor` до `toAnchor` включно |
| note | string? | no | — | для `disposable` обов'язковий, непорожній, ≤ MAX_TEXT | Нотатка-заміна |
| reason | `big` \| `search` \| `stale` \| `duplicate` \| `agent`? | no | — | лише для `review` | Чому рядок — кандидат: `big` — R2, `search` — R3, `stale` — R4, `duplicate` — R5 ([SP_CTX_01_11](#SP_CTX_01_11)), `agent` — тег агента. Відсутня в тезі, записаному версією до 2026-10-10, і читається як `agent` |
| ttl_turns | int? | no | — | ≥ 1; лише для `review` | Через скільки завершених ходів тег стає активним |
| created_turn | int | yes | — | ≥ 0 | Лічильник ходів у момент тегування |

Invariants:
- На одній цілі не більше одного тегу; новий тег на ту саму ціль заміняє попередній. Ціль-рядок і ціль-діапазон ототожнюються за `anchor` першого рядка: на рядку починається не більше одного тегу рядка чи діапазону; тег рядка всередині чужого діапазону допустимий.
- `disposable` з `{ anchor }` без діапазону допустимий лише для рядка `assistant` без викликів; діапазон містить кожен виклик разом з його результатом (правило `collapse`, [SP_CTX_02_03](#SP_CTX_02_03)) і не захоплює рядка чи пари з тегом `pin` або `state` на момент тегування.
- `state` — лише на `{ anchor }` рядка `assistant` без викликів з непорожнім текстом; у реєстрі не більше одного тегу `state`: новий заміняє попередній, де б той не стояв ([C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)).
- `review` активний, коли `ttl_turns` відсутній або `turn - created_turn >= ttl_turns`; `reason` є в кожному тезі `review`, який пише ця версія.

### 01_10. TagRegistry  {#SP_CTX_01_10}

Файл `<storage>/tags.json`. Пише лише мод.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| tags | list<Tag> | yes | `[]` | ≤ MAX_TAGS; серіалізований файл ≤ MAX_QUEUE_BYTES | Теги сесії |
| turn | int | yes | 0 | ≥ 0 | Кількість завершених ходів основної розмови |
| firstPromptPinned | bool | yes | false | — | Правило R1 уже спрацювало |
| stage | Stage? | no | — | [SP_CTX_01_18](#SP_CTX_01_18) | Відкритий етап; не більше одного |
| lastClosed | ClosedBlock? | no | — | [SP_CTX_01_18](#SP_CTX_01_18) | Останній закритий блок: етап, закритий інструментом або міткою, чи блок без етапу, закритий міткою; його `end` — початок наступного блоку без етапу |
| introduced | bool | yes | false | — | Інструкцію на початку сесії вже доставлено в цій сесії ([SP_CTX_02_27](#SP_CTX_02_27)) |

Стани читання — як у Queue (`missing`, `ok`, `unreadable`); `unreadable` не трактується як порожній реєстр. Поле `stage` або `lastClosed`, що не проходить своїх обмежень, робить реєстр `unreadable`, як і погане поле тегу.

### 01_11. AutoTagRules  {#SP_CTX_01_11}

| Rule | Event and condition | Tag |
|------|---------------------|-----|
| R1 | рядок додано: двері `prompt`, походження — людина (`composer`, `bridge`, `sdk`, `unclassified`), `firstPromptPinned = false` | `pin` на `{ anchor }` цього рядка; `firstPromptPinned = true` |
| R2 | рядок додано: двері `tool-result`, `size ≥ BIG_ROW`, інструмент з походження не з OWN_TOOLS, ціль без тегу | `review`, `reason = big`, на `{ tool_use_id }`, без терміну |
| R3 | рядок додано: двері `tool-result`, інструмент з походження входить у SEARCH_TOOLS, ціль без тегу | `review`, `reason = search`, на `{ tool_use_id }`, `ttl_turns = SEARCH_TTL` |
| R4 | виклик завершено ([SP_CTX_02_16](#SP_CTX_02_16)): інструмент з WRITE_TOOLS, виклик не відхилено і результат не помилка; шлях = `input.file_path` (`Edit`, `Write`) або `input.notebook_path` (`NotebookEdit`) | `review`, `reason = stale`, без терміну, на `{ tool_use_id }` кожної пари `Read` поточної розмови, чий рядок виклику стоїть перед рядком виклику запису, з `input.file_path`, що дорівнює шляху дослівно; заміняє наявний `review` будь-якої причини, інших тегів не чіпає ([SP_CTX_DEC_13](#SP_CTX_DEC_13)) |
| R5 | рядок додано, походження не плагін: (а) двері `tool-result`, інструмент не з OWN_TOOLS — для кожного результату цього рядка: його текст довжиною ≥ BIG_ROW і або дорівнює тексту результату ранішої пари, або (інструмент виклику цього результату — `Read`) `file_path`, `offset`, `limit`, `pages` виклику дорівнюють полям ранішої пари `Read` (відсутнє дорівнює лише відсутньому); (б) двері `prompt`, `tool-message` або `attachment`, рядок — `user` без результатів, текст ≥ BIG_ROW дорівнює тексту ранішого рядка `user` без результатів | `review`, `reason = duplicate`, без терміну, на **ранішу** копію: `{ tool_use_id }` ранішої пари (а) або `{ anchor }` ранішого рядка (б); заміняє наявний `review` з причиною `big` або `search`, інших тегів не чіпає |

Правила R1–R3 не перезаписують наявний тег; R4 і R5 — лише в межах, названих у таблиці. Жодне правило не додає тегу до повного реєстру (межі TAGS_FULL [SP_CTX_02_11](#SP_CTX_02_11)). «Раніша пара» і «раніший рядок» — у поточній розмові ([SP_CTX_02_18](#SP_CTX_02_18)) перед рядком, що спрацював; для R4 — пара `Read`, рядок виклику якої стоїть перед рядком виклику запису (паралельний `Read` у тій самій відповіді після запису не позначається; рядка виклику запису ще немає в розмові — ранішими вважаються всі). R5 (б) спрацьовує лише тоді, коли такий рядок є серед рядків поточної розмови: чи хост додає повторно вкладений текст навички рядком, який мод читає, не перевірено — це перевіряє живий сценарій «Дублікат вставки навички» ([SP_CTX_05_03](#SP_CTX_05_03)); якщо такого рядка немає, R5 (б) бачить лише дослівно повторені великі промпти.

### 01_12. Constants  {#SP_CTX_01_12}

| Name | Value | Meaning |
|------|-------|---------|
| MARK | `[context-editor]` | Префікс тексту зміненого рядка або результату |
| MARKER | `context-editor: apply queued edits` | Аргумент вбудованої команди компактизації, яким мод позначає застосування черги ([SP_CTX_02_06](#SP_CTX_02_06)); обробник бачить його як `instructions`. Текст самопояснювальний: модель бачить його в рядку команди `/compact` разом з позначкою виконання |
| HANDOFF_MARKER | `context-editor: seed the handed-off conversation` | Аргумент вбудованої команди компактизації, яким мод засіває очищену сесію ([SP_CTX_02_21](#SP_CTX_02_21), [SP_CTX_02_26](#SP_CTX_02_26)); видимий моделі так само, як MARKER |
| OWN_TOOLS | `mcp__context-editor__` | Префікс назв інструментів мода |
| DEFAULT_RESUME | `Continue the task from where you stopped.` | Текст продовження за замовчуванням |
| BIG_ROW | 4000 | Поріг позначки «великий рядок», символи |
| MEDIA_FLAG | `@` | Позначка рядка з медіа в перегляді |
| LIST_COUNT / MAX_LIST_COUNT | 60 / 200 | Рядків на сторінці перегляду: типово / найбільше |
| MAX_TEXT | 8000 | Найбільша довжина summary, text, description, note, resume_prompt |
| MAX_QUEUE_EDITS | 200 | Найбільше правок у черзі |
| MAX_QUEUE_BYTES | 3 MiB | Найбільший розмір файлу черги; межа читання файлів хоста — 4 MiB |
| MAX_TAGS | 1000 | Найбільше тегів у реєстрі |
| SEARCH_TOOLS | `Glob`, `Grep`, `WebSearch`, `ToolSearch` | Інструменти правила R3 |
| SEARCH_TTL | 3 | Термін тегу R3, ходи |
| WRITE_TOOLS | `Edit`, `Write`, `NotebookEdit` | Інструменти правила R4: зміна файлу, після якої ранні читання цього шляху застаріли ([SP_CTX_DEC_13](#SP_CTX_DEC_13)) |
| REPRODUCIBLE_TOOLS | `Read`, `Grep`, `Glob` | Інструменти, чий вивід відтворюється з диска; окремого інструмента читання блокнотів хост не має (блокнот читає `Read`) |
| REPRO_FLAG | `~` | Позначка класу пари в перегляді: ставиться на частину `tool_use` і частину `tool_result` кожної пари інструмента з REPRODUCIBLE_TOOLS ([C_CTX_03_04](./context_editor.concept.md#C_CTX_03_04), «Відтворюваність») |
| OPTIMIZE_MARK | `[context-editor: optimize]` | Мітка оптимізації: діє лише як останній непорожній рядок фінального тексту ходу, що після обрізання пробільних символів дорівнює їй дослівно, з урахуванням регістру ([SP_CTX_02_30](#SP_CTX_02_30), [SP_CTX_DEC_12](#SP_CTX_DEC_12)); процитована посеред тексту не діє |
| MESSAGES_ROW | `Messages` | Назва рядка розбивки контексту (`kind` `used`) з розміром рядків розмови без незмінної частини (навичка plugin-hooks, пункт 37). Хост радить розгалужуватись за `kind`, а не за назвою; власного `kind` цей рядок не має, тож пошук — за назвою, а без рядка — запасна міра ([SP_CTX_02_28](#SP_CTX_02_28)) |
| MAX_STAGE_NAME | 80 | Найбільша довжина назви етапу після обрізання пробілів, символи |
| MAX_BLOCK_INDEXES | 20 | Скільки індексів кандидатів однієї причини називає звіт закриття етапу ([SP_CTX_02_29](#SP_CTX_02_29)); решта — числом |
| MAX_JOURNAL | 1000 | Найбільше записів журналу ефекту; найстаріші видаляються ([SP_CTX_01_19](#SP_CTX_01_19)) |
| SKILL | `context-stages` | Тека навички мода `skills/context-stages/SKILL.md`; агент бачить її в переліку як `context-editor:context-stages` (навичка plugin-hooks, пункт 39; [SP_CTX_02_27](#SP_CTX_02_27)) |
| INTRO_TEXT | `context-editor: you can manage your own context. At the start of a logical stage of the task call context_tag with {"tags":[{"op":"open","stage":"<name>"}]}; when the stage is done, {"tags":[{"op":"close"}]} returns its rows, size, cleanup candidates and advice, and you compress what is processed there with ONE context_edit (originals stay readable with Read; the person's messages, rules and skills in use usually stay verbatim). If you end your turn and want the block optimized, make [context-editor: optimize] the last line of your final answer: an optimization turn follows. context_list with "count":0 shows context telemetry. Nothing reminds you by size: decide by the logical state of the work. Guide: skill context-editor:context-stages.` | Інструкція на початку сесії, прихований контекст першого промпту ([SP_CTX_02_27](#SP_CTX_02_27), [SP_CTX_DEC_11](#SP_CTX_DEC_11)); 748 символів, близько 187 токенів за оцінкою символи/4 |
| STAGE_ADVICE | `Review the block as a whole and compress, in ONE context_edit, what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media already seen (by a description if the task allows). Write a stage record: goal; decisions with the reason and the person's words; verified facts with sources (paths, lines, versions); changed artifacts; open questions. Pairs from Read, Grep and Glob are reproducible: they can shrink to a pointer (what, where, what was found; re-read if needed); others need a careful summary. Usually keep verbatim the person's messages, rules and skills still in force, and conclusions you need next. Originals stay readable with Read. If nothing needs compressing, queue nothing.` | Порада закриття етапу і ходу оптимізації ([SP_CTX_02_29](#SP_CTX_02_29); [C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04), D; запис етапу — пропозиція P5, відтворюваність — P2). Текст фази 14 називає відтворювані інструменти без позначки `~`, якої перелік фази 14 ще не показує (Verify фази 14, D3); фаза 15 разом з REPRO_FLAG повертає в цей текст вказівку на `~` (`Reproducible pairs (~: Read, Grep, Glob) can shrink …`) |
| ALIAS_PREFIX / MAX_ALIASES | `c` / 2000 | Префікс псевдоніма виклику / найбільше псевдонімів у реєстрі |
| FLUSH_DELAY | 300 мс | Пауза між завершенням ходу і запуском Flush: команди компактизації, промпту продовження або промпту ходу оптимізації |
| HEAD_ROWS | 8 | Скільки перших рядків компактизації запам'ятовує Boundary |
| HOST_ENV | `CONTEXT_EDITOR_HOST` | Змінна середовища процесу хоста з випадковим токеном для `hostId` ([SP_CTX_01_14](#SP_CTX_01_14)) |
| ROW_WINDOW | 4096 | Найбільше рядків, які віддає читання розмови, і найбільше повідомлень API-подання |
| SUMMARY_OPENER | `This session is being continued from a previous conversation` | Початок тексту підсумку вбудованої компактизації в API-поданні і в транскрипті (спайк context_editor_handoff_long, Entry 2) |
| TRANSCRIPT_LINE | `read the full transcript at:` | Початок рядка в підсумку вбудованої компактизації, що вказує на файл старої сесії; засів прибирає такі рядки ([SP_CTX_02_22](#SP_CTX_02_22)) |
| MEDIA_DATA | 256 | Найкоротший рядок base64, який архів вважає даними медіа |
| MAX_DESCRIPTION | 2048 | Найбільша довжина опису інструмента, яку хост передає моделі |
| MAX_DOCUMENT | 60 000 | Найбільша довжина документа передачі, символи |
| HANDOFF_DELAY | 1 с | Пауза між кінцем ходу (або командою людини) і початком RunHandoff |
| SEED_ROOM | 16 | Скільки рядків вікна читання нової сесії лишається для рядків `/clear` і команди компактизації; засів не довший за ROW_WINDOW − SEED_ROOM ([SP_CTX_02_22](#SP_CTX_02_22)) |
| SEED_WAIT / SEED_POLL | 2000 мс / 100 мс | Скільки AwaitSeeded чекає появи засіяних рядків у читанні розмови / інтервал опитування ([SP_CTX_02_24](#SP_CTX_02_24); Verify фази 10, F2) |
| SEED_PROBE | 80 | Скільки перших символів тексту першого засіяного рядка шукає CheckSeeded ([SP_CTX_02_24](#SP_CTX_02_24)) |
| HANDOFF_STALE | 120 с | Вік запиту `running`, після якого він вважається покинутим |
| HANDOFF_PROMPT | `Write a handoff document for a fresh session that continues this work: the person's task and constraints verbatim, decisions in force, facts, numbers, paths and sources still needed, open questions and the next step. Do not call any tools: answer with the document text only. Plain text, no preamble.` | Запит до моделі, коли документа немає. Окремий запит бачить інструменти сесії і може їх викликати (кожен виклик відхиляється), а відповідь тоді засмічується (Verify фази 10, 2026-10-09, F4); тому промпт прямо забороняє виклики |

### 01_13. AliasRegistry  {#SP_CTX_01_13}

Файл `<storage>/aliases.json`. Пише лише мод, на власному послідовному ланцюжку.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| next | int | yes | 1 | ≥ 1 | Номер наступного псевдоніма |
| last | string? | no | — | ключ `map` | Останній виданий псевдонім |
| map | map<string, string> | yes | `{}` | ≤ MAX_ALIASES записів; ключ `c<число>`, значення — `tool_use_id` | Псевдонім → виклик |

Стани читання — як у Queue; `unreadable` (зокрема ключ не `c<число>`, число ключа ≥ `next`, порожнє значення, `last` поза `map`, більше MAX_ALIASES записів) не трактується як порожній реєстр: позначок немає, жоден `ref` не розв'язується. Коли записів стало б більше за MAX_ALIASES, найстаріші (з найменшим числом) видаляються. Якщо очищення ([SP_CTX_02_14](#SP_CTX_02_14)) прибирає псевдонім, названий у `last`, поле `last` видаляється: `last` не розв'язується до наступної позначки.

### 01_14. Boundary  {#SP_CTX_01_14}

Файл `<storage>/boundary.json`: початок поточної розмови після останньої компактизації основної розмови. Пише лише мод ([SP_CTX_02_18](#SP_CTX_02_18)).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| head | list<string> | yes | — | 1..HEAD_ROWS елементів | `fingerprint` перших рядків розмови, яку повернула компактизація |
| count | int | yes | — | ≥ len(head) | Скільки рядків повернула компактизація |
| host | string? | no | — | `hostId` на момент запису | Ідентичність процесу хоста, у якому межу записано; відсутня, коли `hostId` ще не прочитано або не вдалося прочитати |

Стани читання: файл відсутній або `unreadable` — межі немає, поточна розмова — увесь транскрипт. Поле `host`, що не є рядком, ігнорується: межа читається, але вважається записаною без `host`. Якій межі мод довіряє — [SP_CTX_02_18](#SP_CTX_02_18), `Trusted`, і [SP_CTX_DEC_10](#SP_CTX_DEC_10).

Ідентичність процесу хоста (`hostId: string?`, пам'ять модуля) = `"<token>:<ppid>"`:
- `token` — значення змінної середовища HOST_ENV процесу хоста. Якщо змінної немає, модуль один раз ставить її `$.env.set` випадковим рядком (≥ 16 символів `[0-9a-z]`). Змінна живе в процесі хоста: переживає гаряче перезавантаження модуля, а новий процес (перезапуск, `--resume`) її не має (навичка plugin-hooks, пункт 32).
- `ppid` — вивід команди хоста `sh -c 'echo $PPID'`, тобто pid процесу `claude`. Дочірні процеси успадковують змінну середовища, тож прив'язка до pid відрізняє процес хоста, запущений з-під іншого.
- `ParseHostId(token, stdout)` — чиста функція: `stdout` після обрізання пробільних символів складається лише з десяткових цифр і `token` непорожній → `token + ":" + stdout`; інакше — відсутній.
- Читання — одна обіцянка на екземпляр модуля (один виклик `$.env` і одна команда `echo`), яку модуль запускає в `session.start` або в першому PrepareStorage — що раніше — і запам'ятовує; під час завантаження модуля `$` ще немає.
- Читачі поза компактизацією — CurrentRows, `Key()` і зняття `host` при перемиканні сесії в PrepareStorage — **чекають** обіцянку: вони працюють у шляхах інструментів, промптів і перемикання сесії, де бюджету ~1 с немає. Для них `hostId` відсутній лише тоді, коли читання не вдалося.
- Обробники компактизації (HandleCompaction, HandleSeed, спостерігач межі [SP_CTX_02_18](#SP_CTX_02_18)) обіцянки не чекають і процесів не запускають: виконано — значення, ще ні або не вдалося — `hostId` відсутній, і RecordBoundary пише межу без `host`. Якщо їхній PrepareStorage — перший, він лише запускає обіцянку, не чекаючи її.

### 01_15. HandoffRequest  {#SP_CTX_01_15}

Запит перенести розмову в нову сесію ([C_CTX_03_06](./context_editor.concept.md#C_CTX_03_06)). Живе в Queue.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| mode | `transcript` \| `document` | yes | `transcript` | — | Спосіб, який обрав агент або людина: `transcript` — засів очищеної сесії рядками розмови, `document` — документ першим промптом |
| document | string? | no | — | непорожній, ≤ MAX_DOCUMENT | Документ передачі від агента; для `document` без нього — підсумок через окремий запит до моделі; для `transcript` — запасний документ, зокрема після збою засіву вже в очищеній сесії |
| resume | bool | yes | true | — | Продовжити нову сесію промптом продовження |
| resumePrompt | string | yes | DEFAULT_RESUME | непорожній, ≤ MAX_TEXT | Текст продовження |
| by | `agent` \| `person` | yes | — | — | Хто запитав |
| state | `queued` \| `running` | yes | `queued` | — | `running` — RunHandoff уже йде; другий запуск не починається |
| at | int | yes | — | мс від епохи | Час запиту або початку виконання |
| owner | string? | no | — | непорожній; є лише в стані `running` | Мітка екземпляра модуля, що захопив запит (випадковий рядок, який модуль створює один раз при завантаженні). Лише для діагностики: пишеться при захопленні, прибирається при Defer, жодне рішення його не читає |

Стан передачі в пам'яті модуля: `handoffInFlight: bool` (false) — RunHandoff цього екземпляра модуля йде (від першого кроку до повернення результату чи винятку; скидається на кожному виході); `handoffScheduled: bool` (false) — запуск RunHandoff уже заплановано через HANDOFF_DELAY і ще не почався; `requestTurn: int?` (відсутній) — значення `turns`, коли `context_handoff` поставив запит; перезавантаження модуля його губить, і тоді перерваний хід запиту не знімає; `instance: string` — мітка цього екземпляра для поля `owner`.

`Due(q)` — запит треба запустити: `q.handoff` є AND `handoffInFlight = false` AND (`state = queued` OR (`state = running` AND `now − at > HANDOFF_STALE`)).

Invariants:
- Поки `handoffInFlight`, запит не належний за жодного віку: Schedule не планує нового запуску, захоплення його не бере, а `context_handoff` і `/handoff` відмовляють з DENIED_RUNNING — запит не можна замінити, хоч би скільки `/clear` чи компактизація засіву чекали кінця довгого ходу.
- RunHandoff не лишає запит у стані `running`, коли повертається або падає: кожен вихід — HandedOff, Fail, FailAfterClear або Defer ([SP_CTX_02_21](#SP_CTX_02_21)), хіба що не вдався сам запис старої черги цим кроком. Після засіву Seed перехоплює кожен збій на місці (обробник винятку RunHandoff його не бачить), а спливне повідомлення називає крок, що не вдався; коли не вдався HandedOff, воно каже, що стара сесія досі тримає запит `running`. Тож `running` без `handoffInFlight` буває лише тоді, коли процес перервано, модуль вивантажено посеред передачі або не вдався запис старої черги; через HANDOFF_STALE такий запит знову належний.

### 01_16. TranscriptRecord (вилучено)  {#SP_CTX_01_16}

Вилучено 2026-10-09: передача більше не пише файл сесії хоста і не перемикає процес командою відновлення, якої немає в неінтерактивному хості ([C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11), схема S). Вміст нової сесії описує [SP_CTX_01_17](#SP_CTX_01_17).

### 01_17. HandoffSeed  {#SP_CTX_01_17}

Засів нової сесії способом `transcript`: рядки, які обробник компактизації нової сесії поверне замість порожньої розмови ([C_CTX_03_06](./context_editor.concept.md#C_CTX_03_06)). Живе в пам'яті модуля від збирання ([SP_CTX_02_22](#SP_CTX_02_22)) до кінця RunHandoff ([SP_CTX_02_21](#SP_CTX_02_21)); у пам'яті модуля одночасно не більше одного засіву. Рядки засіву лежать і файлом — для повідомлення про збій і для людини.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| old | string | yes | — | непорожній | Ідентифікатор старої сесії |
| id | int | yes | — | мс від епохи | Час збирання; ім'я файлів засіву в сховищі старої сесії і `reportId` звіту нової |
| rows | list<Row> | yes | — | 1..ROW_WINDOW − SEED_ROOM рядків; жоден не має `handle`; проходить [SP_CTX_02_23](#SP_CTX_02_23) | Засіяні рядки |
| file | string | yes | — | `<old storage>/<id>/seed.json` | Файл з `rows` (JSON-список Row), доступний лише власникові; пишеться командою хоста, тож межа 4 MiB файлового API хоста його не обмежує |
| archive | string | yes | — | `<old storage>/<id>.json` або `""` | Архів оригіналів змінених рядків; `""`, коли жодна правка не застосувалась |
| report | ApplyReport | yes | — | [SP_CTX_01_05](#SP_CTX_01_05) | Звіт застосування правок черги до засіву |
| visible | list<Row> | yes | — | рядки з `handle` старої сесії; лише в пам'яті, у файл не пишуться | Рядки, до яких BuildSeed застосував правки (вхід ApplyEdits) — «до» для RebindTags у кроці реєстрів |
| edits | list<QueuedEdit> | yes | `[]` | ≤ MAX_QUEUE_EDITS | Пакет, який узяв BuildSeed, до перевірки `pin` — «пакет» для RebindTags; застосовані — ті, чий опис є в `report.applied` |
| fromSummary | bool | yes | false | — | Перший рядок засіву — підсумок попередньої компактизації: голова з API-подання ([C_CTX_DEC_12](./context_editor.concept.md#C_CTX_DEC_12), C) або перший рядок CurrentRows, що вже починався з SUMMARY_OPENER (після `--resume` сесії з вбудованою `/compact` читання починається з рядка-підсумку; Verify фази 10, 2026-10-09, F5) |
| unmatchedPromptMedia | int | yes | 0 | ≥ 0 | Медіа в промптах людини, яке не перенеслось ([SP_CTX_02_10](#SP_CTX_02_10)) |
| carried | list<string> | yes | `[]` | `tool_use_id` результатів засіву | Результати, до тексту яких BuildSeed дописав CarryNote: їхні рядки «змінено засівом», хоч відбиток рядка той самий ([SP_CTX_02_14](#SP_CTX_02_14)) |
| new | string? | no | — | ставить RunHandoff після `/clear` | Ідентифікатор сесії, яку створив `/clear`; HandleSeed засіває лише її |
| taken | bool | yes | false | — | Обробник засіву повернув `rows` хосту ([SP_CTX_02_26](#SP_CTX_02_26)) |

Invariants:
- Кожен `tool_use_id` у `rows` — ідентифікатор виклику зі старої сесії: незмінена пара зберігає свій, змінена — FreshId ([SP_CTX_02_04](#SP_CTX_02_04)). Тому теги й псевдоніми незмінених пар, скопійовані в сховище нової сесії, розв'язуються на тих самих парах, а теги й псевдоніми змінених пар RunHandoff видаляє за правилами RebindTags ([SP_CTX_02_14](#SP_CTX_02_14)); це очікування перевіряє живий сценарій «Передача засівом» ([SP_CTX_05_03](#SP_CTX_05_03)).
- Медіа в `rows` немає: рядок без `handle` хост будує лише з тексту і блоків інструментів ([C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14)); медіа незмінених пар лежить файлами, а текст результату називає їх.

### 01_18. Stage, ClosedBlock and RowMark  {#SP_CTX_01_18}

Етап — логічний блок рядків, який агент позначає сам ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), [C_CTX_DEC_16](./context_editor.concept.md#C_CTX_DEC_16)). Живе в TagRegistry, поза повідомленнями. Етапи пласкі: відкритий не більше одного.

RowMark — межа «блок починається після цього рядка» або «блок закінчується цим рядком»; `null` на місці RowMark означає голову розмови (перед рядком 0).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| anchor | string | yes | — | fingerprint ([SP_CTX_01_03](#SP_CTX_01_03)), що містить ідентифікатор виклику чи результату або непорожній текст | Відбиток рядка межі |
| hint | int | yes | — | ≥ 0 | Індекс рядка в поточній розмові на момент запису |

Stage:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| name | string | yes | — | 1..MAX_STAGE_NAME символів після обрізання пробілів | Назва етапу від агента |
| after | RowMark? | yes | — | `null` — блок від голови | Блок починається з рядка після цього |
| openedTurn | int | yes | — | ≥ 0 | `TagRegistry.turn` у момент відкриття; телеметрія називає, скільки ходів тому етап відкрито |

ClosedBlock:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| name | string? | no | — | як `Stage.name` | Назва закритого етапу; відсутня — блок без етапу, закритий міткою оптимізації ([SP_CTX_DEC_14](#SP_CTX_DEC_14)) |
| after | RowMark? | yes | — | — | Початок блоку, як у Stage |
| end | RowMark? | yes | — | `null` — блок порожній (перед ним немає жодного рядка з ідентифікатором чи текстом) | Останній рядок блоку |
| turn | int | yes | — | ≥ 0 | `TagRegistry.turn` у момент закриття; `turn = TagRegistry.turn` на кінці ходу означає «закрито в цьому ході» ([SP_CTX_02_30](#SP_CTX_02_30)) |

Функції над поточною розмовою `rows`:

    Distinctive(row) = row has a call, a result or a non-empty text            # рядок лише з thinking має відбиток "assistant||", який не розрізняє рядків
    MarkBefore(rows, i) = { anchor: fingerprint(rows[k]), hint: k } for the largest k < i with Distinctive(rows[k]); none → null
    MarkIndex(rows, m) = m null → -1; Locate(rows, m.anchor, m.hint) found → that index; else → lost   # Locate — SP_CTX_02_04
    StartOf(rows, after) = MarkIndex(rows, after) + 1, where lost counts as -1 (the block starts at the head)

Межа, рядок якої вже не знаходиться (`lost`: вбудована компактизація хоста, межа вийшла за вікно ROW_WINDOW), діє як голова для `after`; загублений `end` — кінець блоку невідомий, і його ніколи не показують як порожній блок (`null`). Перегляд, телеметрія і звіт закриття про це кажуть ([SP_CTX_02_01](#SP_CTX_02_01), [SP_CTX_02_28](#SP_CTX_02_28), [SP_CTX_02_29](#SP_CTX_02_29)). context_tag і DetectOptimize, які читають поточну розмову, записують `null` на місце загубленого `stage.after` і `lastClosed.after` (для них `null` і `lost` означають те саме — голову); загублений `lastClosed.end` лишається як є, щоб не стати «порожнім блоком», а як `after` наступного блоку без етапу він діє як голова. Застосування правок і засів переносять межу за правилами [SP_CTX_02_14](#SP_CTX_02_14).

Invariants:
- Відкриття етапу при відкритому етапі спершу закриває поточний ([SP_CTX_02_29](#SP_CTX_02_29)); реєстр ніколи не має двох відкритих.
- `lastClosed` змінюють лише закриття етапу (інструментом або міткою) і мітка без відкритого етапу; RebindTags лише переносить його межі, а context_tag і DetectOptimize лише заміняють загублений `after` на `null`.

### 01_19. Journal  {#SP_CTX_01_19}

Файл `<storage>/journal.json`: журнал ефекту — що звільнило кожне застосування і які вже стиснуті відтворювані виводи агент читав знову ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), пропозиція P9). Пише лише мод, на власному послідовному ланцюжку.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| entries | list<JournalEntry> | yes | `[]` | ≤ MAX_JOURNAL; серіалізований файл ≤ MAX_QUEUE_BYTES — коли запис перевищив би будь-яку межу, найстаріші записи видаляються, доки не вміститься | Записи від найстарішого |

JournalEntry — варіант за полем `kind`:
| kind | Поля | Значення |
|------|------|----------|
| `apply` | `at: int` (мс від епохи, `reportId` застосування), `freedChars: int` (≥ 0, `charsBefore − charsAfter`), `edits: int` (≥ 1, застосовані правки), `archive: string` (шлях архіву або `""`), `compressed: list<string>` (≤ MAX_QUEUE_EDITS, без повторів) | Застосування пакета компактизацією ([SP_CTX_02_07](#SP_CTX_02_07)); `compressed` — `input.file_path` викликів `Read` у парах, які застосовані правки стиснули, прибрали або згорнули |
| `changed` | `at: int`, `path: string` | Агент змінив інструментом з WRITE_TOOLS файл, названий у `compressed` якогось запису `apply` ([SP_CTX_02_16](#SP_CTX_02_16)); пізніше читання цього шляху — не повторне читання стиснутого, а читання нового вмісту |
| `reread` | `at: int`, `path: string`, `tool_use_id: string`, `archive: bool` | Агент знову прочитав `Read` шлях, названий у `compressed` запису `apply`, після якого не було запису `changed` з тим самим шляхом (`archive = false`), або файл архіву чи медіа застосування — шлях `archive` або шлях усередині `<storage>/<at>/` (`archive = true`) ([SP_CTX_02_16](#SP_CTX_02_16)) |

Стани читання — як у Queue (`missing`, `ok`, `unreadable`). Журнал `unreadable` не перезаписується: записи пропускаються, телеметрія каже «journal unreadable» з причиною; щоб відновити журнал, людина видаляє файл. Збій запису журналу не впливає ні на застосування, ні на результат інструменту.

### 01_20. Telemetry  {#SP_CTX_01_20}

Телеметрія контексту на запит ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), «Телеметрія на запит»); живе лише під час побудови тексту, у файли не потрапляє. Обчислює [SP_CTX_02_28](#SP_CTX_02_28).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| measure | `messages` \| `request` \| `unknown` \| `unavailable` | yes | — | — | `messages` — є рядок MESSAGES_ROW розбивки; `request` — розбивки чи рядка немає, показано весь запит; `unknown` — моделі ще не відповідали (свіжа сесія, щойно після компактизації: `tokens` відсутній або розбивка має `apiUsage = null`); `unavailable` — читання розміру впало |
| conversation | int? | no | — | ≥ 0; лише для `messages` | Токени рядків розмови без незмінної частини |
| fixed | int? | no | — | ≥ 0; лише для `messages` | Незмінна частина: `breakdown.totalTokens − conversation` (системний промпт, схеми інструментів, навички, пам'ять) |
| request | int? | no | — | ≥ 0; лише для `request` | Розмір останнього запиту разом із незмінною частиною |
| window | int? | no | — | ≥ 1 | Вікно: `breakdown.rawMaxTokens`, а без розбивки — `context.window`; відсутнє лише для `unavailable` |
| autoCompactLeft | int? | no | — | — | `breakdown.autoCompactThreshold − breakdown.totalTokens`, коли поріг є; відсутній — автоматична компактизація вимкнена або розбивки немає |
| autoCompactOff | bool | yes | false | — | Розбивка є, а порогу автоматичної компактизації в ній немає |
| error | string? | no | — | лише для `unavailable` | Текст збою |
| stage | `{ name: string, first: int, chars: int, turnsAgo: int, lost: bool }`? | no | — | `first` = StartOf; `chars` — сума `size` рядків від `first` до кінця | Відкритий етап |
| lastClosed | `{ name: string?, start: int, end: int?, chars: int?, lost: bool, startLost: bool }`? | no | — | `start` = StartOf(rows, lastClosed.after); `end` = MarkIndex(rows, lastClosed.end), відсутній, коли `end` — `null` (порожній блок) або `lost`; `chars` — сума `size` рядків `start..end`; `lost` — рядка кінця вже немає; `startLost` — рядка початку вже немає, блок діє від #0 | Останній закритий блок і його межі |
| reviews | map<reason, int> | yes | `{}` | ключі — причини 01_09 | Активні теги `review`, ціль яких є в розмові, за причиною |
| disposable | int | yes | 0 | ≥ 0 | Теги `disposable`, ціль яких є в розмові |
| journal | `{ applications: int, freedChars: int, rereads: int }` \| `{ unreadable: string }` | yes | — | — | Підсумок журналу ефекту |
| state | `{ row: int }` \| `none` \| `lost` | yes | — | — | Слот стану: рядок тегу `state`, тегу немає, або рядка тегу вже немає в розмові |

## 02. Contracts  {#SP_CTX_02}

Усі читання-змінювання-запису файлу в моді проходять через одну послідовну чергу на файл: дві операції над одним файлом не перекриваються. Прямий запит компактизації хоста мод не використовує: неінтерактивний хост відхиляє його завжди, а інтерактивний не викликає для нього обробників самого мода ([C_CTX_01_02](./context_editor.concept.md#C_CTX_01_02)).

Підтримувані хости: Claude Code від версії 2.1.295 — інтерактивний термінал і неінтерактивний хост з потоковим входом (stream-json: розширення VS Code, SDK streaming). Старіші версії не підтримуються. Разовий запуск `claude -p "<prompt>"` — поза межами: після його останнього ходу сесію не прив'язано до процесу, і кожен `$.command.*` відхиляється («no session is bound in this process», навичка plugin-hooks, пункт 18); черга лишається у файлі сесії ([SP_CTX_05_04](#SP_CTX_05_04)).

Команди хоста в черзі. `$.command.run` виконує команду так, ніби її ввела людина: команду поставлено в чергу і виконано, коли сесія вільна; запущена посеред ходу, вона чекає його кінця і виконується одразу після `turn.complete`. Виклик завершується після роботи: `compact` — після відповіді обробника компактизації, `clear` — коли `$.session.id()` уже повертає новий ідентифікатор (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 4; навичка plugin-hooks, пункт 22). Відмова (невідома назва, неприпустиме походження виклику, немає прив'язаної сесії) остаточна, повтор її не змінить. Тому мод робить одну спробу на кожну команду і несе текст відмови хоста в причину або рядок стану.

Походження команди. Хост вирішує, чи ставити команду в чергу, за ланцюжком, з якого її викликано, а не за моментом виклику (навичка plugin-hooks, пункт 23): виклик з таймера, створеного всередині хука `tool.call`, хост відхиляє і через секунди («called from a tool.call hook, it would wait on the turn this hook is holding»; перевірено, Entry 4); для таймера з хука `prompt.submit` те саме виведено за аналогією (хід теж чекає цього хука), не перевірено. Так само виведено, не перевірено окремо: таймер, створений у зворотному виклику таймера, ланцюжок якого почався в `turn.complete` (повторне планування Flush і Schedule), стає в чергу, як і перший; це спостерігають сценарії «Завершення команди після обробника» і «Команда людини» ([SP_CTX_05_03](#SP_CTX_05_03)). Тому мод запускає `$.command.run` лише з відкладеної дії, створеної в обробнику `turn.complete` або іншої події, на яку не чекає жоден хід (зокрема обробник власної команди `/handoff`, [SP_CTX_02_20](#SP_CTX_02_20)), і ніколи з таймера, створеного в хуку `tool.call` чи `prompt.submit`. Інструмент `context_handoff` лише ставить запит у чергу; запускає передачу кінець ходу ([SP_CTX_02_21](#SP_CTX_02_21)).

Лічильник ходів — пам'ять модуля, спільна для [SP_CTX_02_06](#SP_CTX_02_06), [SP_CTX_02_12](#SP_CTX_02_12) і [SP_CTX_02_21](#SP_CTX_02_21); перезавантаження модуля скидає всі три поля до початкових значень: `turns: int` (0) — скільки ходів основної розмови почалося в цьому екземплярі модуля; `inTurn: bool` (false) — хід іде; `lastTurnAborted: bool` (false) — останній завершений хід основної розмови перервано.

    ON turn start (main loop): turns += 1; inTurn = true
    ON turn complete (main loop): inTurn = false; lastTurnAborted = isAborted   # до кроків 02_06, 02_12, 02_21 і до next
    MovedSince(t) = inTurn OR turns ≠ t                                   # хід іде або почався від знімка t

Порядок кроків кінця ходу основної розмови після `next`: (1) DetectOptimize ([SP_CTX_02_30](#SP_CTX_02_30)) на ланцюжку реєстру тегів — до (2) лічильника `TagRegistry.turn += 1` ([SP_CTX_02_12](#SP_CTX_02_12)) на тому самому ланцюжку, бо «етап закрито в цьому ході» звіряє `ClosedBlock.turn` з ще не збільшеним `TagRegistry.turn`; (3) планування Flush ([SP_CTX_02_06](#SP_CTX_02_06)) — лише після того, як DetectOptimize поставив заміни з тегів і записав або не записав `Queue.optimize`; (4) передача ([SP_CTX_02_21](#SP_CTX_02_21)). Кроки 1 і 3 хук виконує послідовно у фоні, не затримуючи відповіді `turn.complete`.

Команди `/clear` і `/compact`, які запускає мод, не породжують ні `prompt.submit`, ні `turn.start`, ні `turn.complete` — в обох хостах (спайк context_editor_handoff_long, Entry 4; навичка plugin-hooks, пункт 22), тож лічильник рахує кожен початок ходу основної розмови і зсувається лише від ходів людини чи агента. Промпт людини, що цитує MARKER, — звичайний хід і рахується. Повідомлення людини посеред ходу вливається в цей хід і окремого початку ходу не дає.

«Рядки основної розмови» в контрактах нижче — поточна розмова за [SP_CTX_02_18](#SP_CTX_02_18), а не весь транскрипт. Опис кожного інструмента не довший за MAX_DESCRIPTION: довший хост обрізає, і модель не бачить його кінця.

### 02_01. context_list  {#SP_CTX_02_01}

Purpose: інструмент агента; показує рядки основної розмови ([SP_CTX_02_18](#SP_CTX_02_18)) від найстарішого, сторінками.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| from | int | no | типово 0; значення поза `0..len-1` обрізається до цих меж |
| count | int | no | типово LIST_COUNT; обрізається до `0..MAX_LIST_COUNT`; `0` — лише заголовок (телеметрія без рядків) |

Output: текст. Порожня розмова — `0 rows.`, за ним телеметрія. Інакше заголовок: кількість рядків, загальний розмір (символи і ≈ токени як символи/4), кількість і сумарний розмір медіа, показаний діапазон і розмір рядків перед ним (лише при `count ≥ 1`), телеметрія (TelemetryText, [SP_CTX_02_28](#SP_CTX_02_28)) — з відкритим етапом, його першим рядком і розміром, останнім закритим блоком, кандидатами, журналом і слотом стану, легенда позначок, `Next page: from=<n>`, якщо далі є рядки. Далі по рядку: `#<index><flags> <role> <size>c: <частини> <теги>`, де `flags` — `*` (текст рядка або результату починається з MARK), `!` (size ≥ BIG_ROW), `@` (є медіа); частини — `text "<90 символів>"`, `tool_use <tool>[~] id=<id>[ (<alias>)] input="<70>"`, `tool_result[~] id=<id>[ ERROR] "<70>"` (REPRO_FLAG `~` — клас пари: інструмент пари входить у REPRODUCIBLE_TOOLS; інструмент результату — з виклику з тим самим `tool_use_id` у поточній розмові, виклику немає — без `~`), `media <mediaType> ~<KB>KB` через ` | `; позначки після частин — `[stage ▶ <name>]` на першому рядку відкритого етапу (`StartOf(rows, stage.after)`, [SP_CTX_01_18](#SP_CTX_01_18)); `[block ▶ <name>]` (без назви — `[block ▶]`) на першому рядку останнього закритого блоку (`StartOf(rows, lastClosed.after)`) і `[block end]` на його останньому рядку (`lastClosed.end`); далі теги: `[pin]`, `[disposable: "<40 символів нотатки>"]`, `[disposable #<a>..#<b>: "<40>"]` на першому рядку діапазону, `[review: <reason>]` (лише активний; тег без `reason` — `[review: agent]`), `[state]`. Тег пари стоїть на обох її рядках. Загублений початок (`stage.after` чи `lastClosed.after` — `lost`) діє як голова: позначка `[stage ▶ …]` чи `[block ▶ …]` стоїть на #0, а телеметрія каже «its start row is gone, so it runs from #0» — позначка не зникає мовчки. Загублений кінець блоку позначки `[block end]` не дає, а телеметрія каже «its end row is gone». Порожній блок (`end` — `null` або перший рядок після кінця) позначок не має, телеметрія каже «it is empty». Межі останнього закритого блоку в переліку і телеметрії — те, з чого агент бере індекси в ході оптимізації і після поради з промптом людини: ці тексти індексів не мають ([SP_CTX_02_29](#SP_CTX_02_29)).

Перелік з `count = 0` не оновлює `listedKey` ([SP_CTX_02_18](#SP_CTX_02_18)): індекси в його телеметрії (перший рядок етапу, рядок слоту стану, `Last block #a..#b`) — для орієнтації, а правки за індексом потребують переліку з рядками; навичка, OptimizeText і PersonAdvice (ListHint) просять саме перелік з рядками. Перелік з `count ≥ 1` оновлює його, як і раніше. Збій телеметрії не валить переліку: TelemetryText тоді — рядок `unavailable` з причиною ([SP_CTX_01_20](#SP_CTX_01_20)).

Опис інструмента (LIST_DESCRIPTION, ≤ MAX_DESCRIPTION) називає: порядок від найстарішого, позначки рядка `* ! @` і клас пари `~`, теги з причинами `review`, `[state]`, `[stage ▶ …]`, `[block ▶ …]` і `[block end]`, те, що `count: 0` дає лише телеметрію, і що індекси — позиції цього переліку.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT | виклик із субагента | редагується лише основна розмова |
| DENIED_FAILURE | збій під час побудови переліку | повторити пізніше; причина в повідомленні |

### 02_02. context_edit  {#SP_CTX_02_02}

Purpose: інструмент агента; перевіряє правки і дописує прийняті до черги.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| edits | list<Edit> | yes | 1..MAX_QUEUE_EDITS |
| resume | bool | no | задає `Queue.resume` поточного пакета |
| resume_prompt | string | no | ≤ MAX_TEXT; непорожній після обрізання задає `Queue.resumePrompt`, порожній ігнорується |

Output: `Queued <n> edit(s); <m> pending in total.`, відхилені правки з причинами, при непорожній черзі — вказівка завершити хід і текст продовження.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT | виклик із субагента | — |
| DENIED_EMPTY | `edits` відсутній, порожній або не список | передати 1..MAX_QUEUE_EDITS правок |
| DENIED_PROMPT_TOO_LONG | `resume_prompt` довший за MAX_TEXT | скоротити |
| DENIED_STORAGE | сховище `unavailable` | причина в повідомленні; мод нічого не пише |
| QUEUE_QUARANTINED | Queue `unreadable` | файл переноситься в `pending.json.bad-<ms>` командою хоста; виклик продовжується з порожньою чергою, результат повідомляє шлях і причину; правки з перенесеного файлу не застосовуються |
| DENIED_QUEUE_READ | Queue `unreadable` і перенести файл не вдалося | повідомлення містить шлях і причину; файл треба виправити або видалити |
| DENIED_QUEUE_FULL | після додавання правок стало б більше MAX_QUEUE_EDITS або файл більший за MAX_QUEUE_BYTES | дочекатися застосування поточного пакета |
| DENIED_QUEUE_WRITE | файл черги не записався | причина в повідомленні |
| DENIED_FAILURE | інший збій обробника | причина в повідомленні |

Processing logic (pseudocode):
    FUNCTION context_edit(edits, resume?, resume_prompt?):
        REQUIRE storage ready
        IF Queue state = unreadable: move the file aside (QUEUE_QUARANTINED) or deny (DENIED_QUEUE_READ); q = empty
        rows = CurrentRows()                                           # SP_CTX_02_18
        edits = edits with each resolvable `ref` of summarize/drop replaced by its tool_use_id (ResolveRef, SP_CTX_02_17)
        (queued, errors) = PrepareEdits(rows, edits, TagRegistry)   # реєстр unreadable → без перевірки pin; HandleCompaction відхилить кожну правку
        REQUIRE len(q.edits) + len(queued) <= MAX_QUEUE_EDITS AND size of the new file <= MAX_QUEUE_BYTES
        q.edits += queued; IF queued not empty: q.tagsOnly = false
        IF resume given: q.resume = resume
        IF resume_prompt non-empty after trim: q.resumePrompt = resume_prompt
        write Queue; status line = "<len(q.edits)> context edit(s) queued"
        RETURN text report

Опис інструмента (EDIT_DESCRIPTION) не довший за MAX_DESCRIPTION; сьогоднішній текст — близько 1990 з 2048 символів, тож нове місце звільняється скороченням. Обов'язковий зміст за пріоритетом (хост обрізає кінець, [SP_CTX_02](#SP_CTX_02)): (1) призначення і що правки застосовуються після кінця ходу, з продовженням `resume` / `resume_prompt`; (2) операції з обов'язковими полями і правило пар `collapse`; (3) `ref` і `last`; (4) відмова для цілей з `pin` і для рядка з `state`, крім `rewrite` цього рядка; (5) оригінали архівуються у файл, названий у заміні, і читаються `Read` ([C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)); (6) порада одним реченням — стискати блок завершеного етапу (`context_tag` `close`) або, без етапів, найранішу ділянку з опрацьованим чи зайвим вмістом, лишаючи зазвичай дослівно повідомлення людини, чинні правила й навички і робочу частину ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04)); (7) шаблон запису етапу одним рядком — мета; рішення з причиною і словами людини; факти з джерелами; змінені артефакти; відкриті питання (пропозиція P5); (8) пакетування і ціна скидання кешу; (9) вказівка на навичку `context-editor:<SKILL>`. Лише в навичці SKILL ([SP_CTX_02_27](#SP_CTX_02_27)): відтворюване проти невідтворюваного, глухі кути діапазоном `disposable`, мітка оптимізації, телеметрія, причини `review`, слот стану докладно. Скорочується спершу текст пунктів (8) і (6), потім (7) зводиться до вказівки на навичку; пункти (1)–(5) лишаються повністю. Довжину перевіряє рядок 05_01 «опис інструмента».

### 02_03. PrepareEdits  {#SP_CTX_02_03}

Purpose: перевірити правки на поточній розмові і поставити якорі. Відхилення однієї правки не зупиняє інших.

| Правка | Приймається, якщо | Інакше (причина) |
|--------|-------------------|------------------|
| будь-яка | `op` — один з п'яти; обов'язкові поля варіанта присутні і мають свій тип; текстові поля непорожні і ≤ MAX_TEXT | `unknown op` / `<field> is required` / `<field> is too long` |
| summarize, drop з `ref` | `ref` розв'язується ([SP_CTX_02_17](#SP_CTX_02_17)) | `unknown ref <ref>` / `ref and tool_use_id are exclusive` |
| summarize, drop | існують і виклик, і результат з `tool_use_id` | `no completed tool call with that id` |
| collapse | `0 ≤ from ≤ to < len` і діапазон містить кожен виклик разом з його результатом | `indexes out of range` / `range splits a tool call from its result` |
| rewrite | рядок `index` існує, має роль `assistant`, не має викликів | `index out of range` / `only an assistant text row can be rewritten; use collapse` |
| describe | рядок `index` існує, має роль `user`, не має результатів, має медіа за [SP_CTX_02_10](#SP_CTX_02_10) | `index out of range` / `describe applies to a user prompt row; use summarize for tool results` / `no media found in that row` |
| collapse, rewrite, describe | межа поточної розмови не змінилась від останнього `context_list` з рядками чи звіту закриття етапу у цьому процесі ([SP_CTX_02_18](#SP_CTX_02_18)) | `the conversation was compacted since your last context_list; call context_list again for current indexes` |
| будь-яка | ціль (пара разом з обома її рядками, рядок, будь-який рядок або пара діапазону `collapse`) не має тегу `pin` | `target is pinned; remove the pin with context_tag first` |
| будь-яка, крім `rewrite` рядка з тегом `state` | ціль (як у рядку вище) не містить рядка з тегом `state` ([C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)) | `target holds the state slot; change it only by rewrite of that row, or remove its state tag first` |

Рядок з тегом `state` змінює лише `rewrite` саме цього рядка; `collapse`, що його захоплює, відхиляється так само, як для `pin`. Обидві перевірки (`pin` і `state`) повторюються при застосуванні ([SP_CTX_02_07](#SP_CTX_02_07)) і в засіві ([SP_CTX_02_22](#SP_CTX_02_22)) на тодішньому реєстрі. Рядок перевірки межі поточної розмови (`listedKey`) діє лише для правок агента з `context_edit`; заміни з тегів (QueueTagReplacements, [SP_CTX_02_13](#SP_CTX_02_13)) проходять PrepareEdits без нього (`checkListedKey = false`).

### 02_04. ApplyEdits  {#SP_CTX_02_04}

> **Criticality:** core

Purpose: побудувати новий список рядків з рядків події компактизації і правок черги. Чиста функція.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| rows | list<Row> | yes | рядки події компактизації |
| edits | list<QueuedEdit> | yes | уже перевірені на `pin` і `state` ([SP_CTX_02_07](#SP_CTX_02_07)) |
| archive | string | yes | шлях архіву або `""` |
| media | map<owner, list<string>> | yes | шляхи вже збережених медіа-файлів за власником |
| mediaOwners | set<owner> | yes | усі власники медіа в розмові ([SP_CTX_02_10](#SP_CTX_02_10)) |
| knownResults | set<string> | yes | `tool_use_id` результатів, які видно в API-поданні ([SP_CTX_02_10](#SP_CTX_02_10)) |
| unmatchedPromptMedia | int | yes | ≥ 0; кількість повідомлень людини з медіа, не зіставлених з рядками |
| apiTruncated | bool | yes | API-подання обрізане вікном: `len(api) ≥ ROW_WINDOW − 1` ([SP_CTX_02_10](#SP_CTX_02_10)); тоді рядки до першого відомого результату можуть лежати поза поданням |

Output: `{ rows: list<Row>, report: ApplyReport }`; `charsAfter` дораховує [SP_CTX_02_07](#SP_CTX_02_07).

Processing logic (pseudocode):
    FUNCTION ApplyEdits(rows, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia, apiTruncated):
        note = archive ? " (original: " + archive + ", open with Read)" : ""   # заміна сама каже, як повернути оригінал (C_CTX_DEC_18)
        plan = []
        FOR edit IN edits:                                # позиції — на НЕЗМІНЕНОМУ списку
            resolve touched rows or report.failed += reason:
                summarize, drop: {useAt, resAt} by tool_use_id; pair = tool_use_id
                    IF the result row holds another pair whose owner is in mediaOwners AND that pair is not
                       summarized or dropped in this batch with its media archived:
                       failed "row also holds media of <id>; summarize it in the same batch"
                    IF the result row holds a result whose id is not in knownResults:
                       failed "outside the API window; media unknown"
                collapse: {from..to} via anchors (Locate); recheck pairing
                    IF the span holds a result whose id is not in knownResults,
                       or (apiTruncated AND the span holds a user row without toolResults before the first row whose result is in knownResults):
                       failed "outside the API window; media unknown"     # без обрізання подання промпт перед першим результатом — звичайний
                    IF unmatchedPromptMedia > 0 AND the span holds a user row without toolResults:
                       failed "span may hold prompt media that cannot be archived"
                rewrite, describe: {at} via anchor
            IF edit replaces media of an owner in mediaOwners AND media has no paths for it: failed "media could not be archived"
            plan += (edit, touched, pair?, hi = max(touched))
        SORT plan BY hi DESC; anyRow = {}; exclusiveRow = {}; pairs = {}
        FOR step IN plan:
            conflict = step.pair ? (step.pair ∈ pairs OR step.touched ∩ exclusiveRow ≠ ∅) : step.touched ∩ anyRow ≠ ∅
            IF conflict: report.failed += "overlaps another edit"; CONTINUE
            run step; report.applied += step; anyRow ∪= step.touched; IF step replaces rows: step.last = its last produced row (a reference, kept on the row through later rebuilds)
            IF step.pair: pairs += step.pair ELSE exclusiveRow ∪= step.touched
        rows = rebuild every untouched row that has a handle AND toolResults AND none of its owners in mediaOwners
               AND all its result ids in knownResults
        rows = KeepResponsesWhole(rows)
        rows = remove rows without handle that became empty
        rows = MergeCallRows(rows)                    # виклики однієї відповіді без handle — одним рядком
        RETURN rows, report

    FUNCTION KeepResponsesWhole(rows):            # відповідь моделі не розривається перезібраним рядком
        stretches = rows split before every prompt row (a user row without toolResults that is not a result row a drop left empty: it has a handle or content)   # порожній рядок ще не відфільтровано
        FOR stretch IN stretches:
            IF stretch holds no assistant row without handle (rebuilt or inserted): CONTINUE
            rebuild every assistant row with handle in stretch                        # і до, і після перезібраного; thinking-блоки цих рядків губляться
        RETURN rows                                                                   # рядки результатів — за правилом вище (SP_CTX_DEC_02)

    run summarize: id' = FreshId(id); use row rebuilt, call gets id' and loses text; result row rebuilt, result gets id' and text MARK+" summarized"+note+mediaNote(id)+": "+summary
    run drop: call removed from its row, result from its row; both rows rebuilt; media paths of id go to the report only
    run collapse: span = rows[from..to] → originals; carrier = first call in span whose tool does not start with OWN_TOOLS
        carrier exists → 2 rows: assistant {text "", toolUses [carrier with id' = FreshId, input {}, no text]}, user {toolResults [{id', isError false, text T}]}
        no carrier → 1 row {role span[0].role, text T, toolUses []}
        T = MARK+" <n> rows collapsed"+note+mediaNote(all owners in span)+": "+summary
    run rewrite: row text = MARK+" rewritten"+note+": "+text; row rebuilt
    run describe: row text = MARK+" media replaced"+note+mediaNote(row)+": "+description+"\n\n"+original text; row rebuilt
    mediaNote(owners) = media has paths for these owners ? " (media: "+paths joined ", "+")" : ""

    FUNCTION Produced(final, steps) → list:                         # викликають HandleCompaction після DropOwnCalls і BuildSeed після нормалізації
        RETURN [ (step label, k, fingerprint(final[k])) FOR step IN applied replacing steps WHERE the row step.last refers to (or the row rebuilt from it) stands at index k of final ]

    FUNCTION MergeCallRows(rows):                 # Verify фази 14, D1
        FOR each row r of rows in order:
            IF the row before it (as merged so far) is an assistant row without handle with toolUses AND r is an assistant row without handle:
                merge r into it: text = the two texts joined by a blank line (empty ones left out), toolUses = its calls, then the calls of r
        RETURN rows

Правки пар (summarize, drop) не розрізають рядків, тож кілька правок різних пар на спільних рядках застосовуються послідовно; правки рядків (collapse, rewrite, describe) беруть свої рядки виключно.

«Правка замінює медіа власника»: summarize і drop — власник `{tool_use_id}` пари; collapse — власники всіх пар і рядків діапазону; describe — власник `{row}`.

`Locate(rows, anchor, hint)`: рядок `hint`, якщо його відбиток збігається; інакше єдиний рядок з цим відбитком; інакше «не знайдено».

`FreshId(id)` = `base` + `_ce` + поточний час у base36 + 4 випадкові символи `[0-9a-z]`, де `base` = `id` без кінцевого суфікса `_ce[0-9a-z]+`; результат складається лише з `A–Z a–z 0–9 _ -`. Повторна правка тієї ж пари не подовжує ідентифікатор.

«Перезібрати рядок» = скопіювати `role`, `text`, виклики (`tool_use_id`, `tool`, `input`, `text`) і результати (`tool_use_id`, `text`, `isError`) без `handle`.

Цілісність відповіді (KeepResponsesWhole). Хост зливає рядки асистента з однаковим `message.id` (одна відповідь моделі) при побудові запиту, навіть через рядки з іншим id; `SessionMessage` цього id не показує. Перезібраний рядок отримує синтетичний id і розриває відповідь, а пізніший рядок тієї ж відповіді, повернений з `handle`, хост підтягує назад у раніше повідомлення: його `tool_use` втрачає сусідній результат, модель бачить «Tool result missing due to internal error», а медіа цього результату зникає. Так в обох хостах і обома шляхами компактизації (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 5; навичка plugin-hooks, пункт 30). Відповідь ніколи не перетинає промпт людини, тож у кожному відрізку між промптами, де є перезібраний або вставлений рядок асистента, перезбираються всі рядки асистента з `handle` — і ті, що стоять після нього, і ті, що перед ним. Пізніші рядки треба перезібрати, бо злиття йде назад (Entry 5). Раніші — бо модель з thinking пише одну відповідь кількома рядками з тим самим `message.id` (рядок лише з thinking, далі рядок з `tool_use`): рядок thinking, повернений з `handle`, після `--resume` чи `/resume` за злиттям `message.id` підтягує з-до межі оригінальний `tool_use` разом із результатом, і правка втрачається навіть у суто текстовій розмові (Verify фази 11; навичка plugin-hooks, пункти 7б і 36). Відрізок ширший за одну відповідь (кілька відповідей агентного циклу між двома промптами), але `message.id` модові не видно, тож ціна — перезібрати й інші відповіді того самого відрізка. Рядки результатів лишаються за чинним правилом: з медіа — з `handle`, без медіа — перезібрані ([SP_CTX_DEC_02](#SP_CTX_DEC_02)); батько до межі в копії рядка результату з `handle` (навичка plugin-hooks, пункт 5) за цього правила не шкодить (Entry 5). Ціна: thinking-блоки всіх рядків асистента такого відрізка губляться. Моделі, що зберігають thinking минулих ходів, втрачають міркування раніших відповідей відрізка; міркування після точки правки правка й так робить неактуальними. Рядок, у якому лишився лише thinking, стає порожнім і видаляється. Відоме обмеження: згортання без носія, що починається на промпті людини й закінчується посеред відповіді (рядок thinking чи тексту в межах, рядок `tool_use` тієї ж відповіді — поза ними), вставляє рядок `user` без `handle`, який KeepResponsesWhole вважає промптом; решта відповіді лишається з `handle`. У тому самому процесі це не шкодить; після `--resume` злиття за `message.id` повертає згорнутий оригінал (backlog K, [C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05)). Відбитки (роль, ідентифікатори, текст) від перезбирання не змінюються, тож CurrentRows і межа ([SP_CTX_02_18](#SP_CTX_02_18)) не зачеплені. Засіву ([SP_CTX_02_22](#SP_CTX_02_22)) правило не потрібне: жоден засіяний рядок не має `handle`.

Виклики однієї відповіді (MergeCallRows). Рядок без `handle` хост надсилає окремим повідомленням із синтетичним id і зливає лише рядки з одним `message.id`. Паралельні виклики однієї відповіді хост пише окремими рядками асистента (рядок `tool_use a`, рядок `tool_use b`, далі рядок результатів); перезібрані KeepResponsesWhole чи правкою, вони стають повідомленнями `assistant(tool_use a)`, `assistant(tool_use b)`, `user(results a, b)`: перший `tool_use` не має результатів одразу після себе, хост пише `[ERROR] ensureToolResultPairing: repaired missing tool_result blocks`, а модель бачить «Tool result missing due to internal error» (Verify фази 14, D1, обидва хости; навичка plugin-hooks, пункт 30). Тому після видалення порожніх рядків кожен рядок асистента без `handle` з викликами вбирає наступні рядки асистента без `handle` до першого рядка іншої ролі чи рядка з `handle`: тексти — по порядку через порожній рядок, виклики — по порядку. Рядки асистента поспіль — одна відповідь: відповідь ніколи не перетинає рядка результатів чи промпту, а KeepResponsesWhole у відрізку з перезібраним рядком лишає без `handle` всі рядки асистента. Рядок тексту чи thinking перед викликами лишається окремим: таку пару хост приймає (спайк context_editor_handoff_long, Entry 5, vR — pass). Злитий рядок має новий відбиток (роль і всі ідентифікатори викликів), тож для RebindTags рядки, що злились, — «прибрані без заміни»: теги пар за `tool_use_id` і псевдоніми розв'язуються як раніше, тег за якорем на рядку виклику губиться (такі теги — рідкість: `disposable` за індексом лише на тексті без викликів), межа етапу на такому рядку переїжджає за попередній незмінений рядок ([SP_CTX_02_14](#SP_CTX_02_14)); `produced` правки `rewrite`, чий рядок злився з рядком викликів, знаходиться за частиною тексту злитого рядка. Перевіряється наживо лише випадок спільного рядка результатів (D1); рядки результатів паралельних викликів, записані окремо (`user(result a)`, `user(result b)` після злитого рядка), — сусідні повідомлення `user` — рядок 05_03 «Паралельні виклики після застосування».

### 02_05. DropOwnCalls  {#SP_CTX_02_05}

Purpose: прибрати з результату ApplyEdits виклики інструментів мода та їхні результати.

Input: рядки, `mediaOwners`, `knownResults`. Logic: множина ідентифікаторів викликів, чия назва починається з OWN_TOOLS, крім тих службових пар, у рядку результату яких є інший результат з власником у `mediaOwners` або з id поза `knownResults` — такі пари лишаються разом із рядками, бо перезбирання знищило б незаархівоване медіа. Кожен рядок, що містить решту службових викликів або результатів, перезбирається без них; потім рядки проходять KeepResponsesWhole ([SP_CTX_02_04](#SP_CTX_02_04)), бо перезібраний рядок асистента зі службовим викликом теж розриває відповідь; рядки без `handle`, що стали порожніми, видаляються, а виклики однієї відповіді без `handle` зливаються в один рядок (MergeCallRows, [SP_CTX_02_04](#SP_CTX_02_04)): прибраний службовий рядок посеред паралельних викликів інакше лишив би два окремі перезібрані рядки викликів. Рядок-носій `collapse` ніколи не є службовим викликом ([SP_CTX_02_04](#SP_CTX_02_04)).

### 02_06. Flush  {#SP_CTX_02_06}

Purpose: після ходу основної розмови запустити застосування черги вбудованою командою компактизації і продовжити сесію ([C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02), C), а коли агент поставив мітку оптимізації — запустити хід оптимізації ([C_CTX_DEC_17](./context_editor.concept.md#C_CTX_DEC_17), A) замість промпту продовження. Працює однаково в інтерактивному терміналі і в неінтерактивному хості з потоковим входом (stream-json: розширення VS Code, SDK streaming). До 2026-10-09 цей контракт виконувало окреме розширення `context-editor-trigger` (TriggerCompaction).

Логіка — чиста функція за портом FlushIO: читання й запис черги, читання реєстру тегів (лише назва блоку для промпту ходу оптимізації), запуск команди хоста, пауза, відправка промпту, рядок стану; зв'язування з хостом — у реєстрації мода.

Input: подія завершення ходу (`agentId?`, `isAborted`). Стан у пам'яті модуля: `scheduled: bool` (false), `lastSubmittedReportId: int` (0), лічильник ходів (`turns`, `inTurn`, `lastTurnAborted`) з преамбули розділу 02; перезавантаження модуля скидає їх.

Processing logic (pseudocode):
    ON turn completed (main loop, not aborted), after DetectOptimize (SP_CTX_02_30):   # DetectOptimize уже поставив заміни з тегів для мітки
        IF NOT scheduled AND storage ready AND Queue state = ok AND Queue.handoff absent
           AND (len(Queue.edits) > 0 OR Queue.optimize):
            scheduled = true; turns0 = turns; AFTER FLUSH_DELAY: Flush(turns0)   # відкладена дія з turn.complete — походження, яке хост ставить у чергу

    FUNCTION Flush(turns0):
        clear the status line
        q = read Queue
        IF q state = unreadable OR q.handoff present OR (len(q.edits) == 0 AND NOT q.optimize): scheduled = false; RETURN   # правки з передачею застосує RunHandoff
        IF MovedSince(turns0):                                                # хід почався від планування: команду не ставити в чергу за ним
            scheduled = false
            IF NOT inTurn AND NOT lastTurnAborted: scheduled = true; turns0 = turns; AFTER FLUSH_DELAY: Flush(turns0)   # кінець того ходу вже минув і нового планування не дасть
            RETURN                                                            # хід іде — його кінець запланує Flush; хід перервано — черга чекає наступного завершеного ходу; optimize лишається для DeliverReport
        compacted = false
        IF len(q.edits) > 0:                                                  # правки агента і (на кінці ходу з міткою) заміни з тегів — один пакет
            id0 = q.reportId
            TRY run built-in command compact with args = MARKER               # одна спроба; команда чекає, доки сесія вільна
            CATCH err: status line "context-editor: compaction refused: <err text>; queued edits wait for the next turn"; scheduled = false; RETURN   # optimize лишається: порада піде з промптом людини
            q = read Queue; compacted = (q.reportId present AND q.reportId ≠ id0)   # обробник записав звіт цього застосування: skip без звіту чи покинута диспетчеризація — false
        IF q.optimize: Optimize(q, turns0, compacted); scheduled = false; RETURN
        Resume(q, turns0)
        scheduled = false                                                     # за будь-якого виходу, зокрема після винятку

    FUNCTION Resume(q, turns0):                                               # звичайне продовження після застосування
        IF q.report AND q.reportResume AND q.reportId != lastSubmittedReportId:
            IF MovedSince(turns0):                                            # хід почався між перевіркою і виконанням команди
                lastSubmittedReportId = q.reportId                            # продовження не надсилається; звіт лишається в черзі для DeliverReport з наступним промптом людини
            ELSE:
                text = q.report                                               # увесь недоставлений звіт
                TRY entered = submit prompt (text + "\n\n" + q.reportPrompt)   # звіт — у самому тексті промпту: власні хуки prompt.submit мода для нього пропускаються (F1)
                    IF entered (no drop):
                        lastSubmittedReportId = q.reportId
                        on the queue chain: RemoveDelivered(text)              # SP_CTX_02_08: увесь звіт або лише доставлений початок
                CATCH (exception or result with drop): status line "context-editor: could not resume the session; send any prompt to continue"   # звіт лишається в черзі

    FUNCTION Optimize(q, turns0, compacted):                                  # промпт ходу оптимізації заміняє промпт продовження цього кінця ходу
        IF MovedSince(turns0): PersonFirst(q); RETURN                         # OPTIMIZE_PERSON
        reg = read TagRegistry                                                # лише назва блоку; рядків розмови Optimize не читає
        IF reg unreadable OR reg.lastClosed absent:                           # OPTIMIZE_NO_BLOCK
            on the queue chain: optimize = false; status line "context-editor: optimization turn skipped: <the tag registry is unreadable | no closed block>"
            RETURN Resume(q, turns0)                                          # звичайне продовження цього застосування
        TRY:
            report = (q.report present AND q.reportId != lastSubmittedReportId) ? q.report : none
            advice = OptimizeText(reg.lastClosed, compacted)                  # SP_CTX_02_29; заміни з тегів уже застосовано цим пакетом і названо у звіті
        CATCH err:                                                            # OPTIMIZE_BUILD_FAILED
            IF compacted AND q.reportResume: on the queue chain: optimize = false; status line "context-editor: optimization turn not started: <err>"; RETURN Resume(q, turns0)   # пакет просив продовження
            status line "context-editor: optimization turn not started: <err>; the advice goes with your next prompt"; RETURN   # optimize лишається true для DeliverReport
        IF MovedSince(turns0): PersonFirst(q); RETURN                         # повторна перевірка перед заміною: людина могла почати хід за час команди
        swapped = on the queue chain: re-read Queue; IF optimize = true: optimize = false, optimizePrompted = true; write; RETURN true; ELSE RETURN false   # порівняння-і-запис
        IF NOT swapped: PersonFirst(q); RETURN                                # DeliverReport уже віддав пораду з промптом людини і зняв optimize: нічого не надсилати
        TRY entered = submit prompt ((report ? report + "\n\n" : "") + advice)   # власний текст продовження черги не пересилається: продовження вирішує агент у ході оптимізації
            IF entered (no drop):
                IF report: lastSubmittedReportId = q.reportId; on the queue chain: RemoveDelivered(report)
        CATCH (exception or result with drop):                                # OPTIMIZE_FAILED
            on the queue chain: optimizePrompted = false, optimize = true      # зворотна заміна одним записом
            status line "context-editor: could not start the optimization turn; the advice goes with your next prompt"

    PersonFirst(q): IF q.report: lastSubmittedReportId = q.reportId           # звіт і порада — з промптом людини (DeliverReport); промпту немає

Чергу пишуть обробник компактизації ([SP_CTX_02_07](#SP_CTX_02_07)) і, після прийнятого промпту, RemoveDelivered самого Flush ([SP_CTX_02_08](#SP_CTX_02_08)) — обидва на ланцюжку черги. Хост ставить команду в чергу і виконує, коли сесія вільна, з `trigger: 'manual'` і `instructions = MARKER`, і викликає обробники всіх розширень, разом із самим модом ([C_CTX_01_02](./context_editor.concept.md#C_CTX_01_02)); рядки самої команди (`/compact <MARKER>` і позначка виконання) лишаються в розмові з міткою як є: у терміналі хост пише їх повз подію додавання рядка, тож сховати мітку неможливо (спайк context_editor_handoff_long, Entry 4, «Мітка в рядках команди»; навичка plugin-hooks, пункт 24), а текст мітки самопояснювальний ([SP_CTX_01_12](#SP_CTX_01_12)). Відмова хоста остаточна, тож повторів немає: черга лишається до наступного завершеного ходу. Хід, що почався від планування, означає, що людина активна. Перед командою Flush її не запускає: команда, поставлена в чергу за ходом, могла б пережити модуль (див. залишкове вікно в [SP_CTX_05_02](#SP_CTX_05_02)), а правки застосує наступний кінець ходу. Якщо хід почався вже після перевірки, Flush не перебиває людину промптом продовження, і звіт дійде з її наступним промптом. Звіт у промпт продовження вписує сам Flush: хост пропускає власні хуки `prompt.submit` плагіна для промптів, які той надсилає через `$.prompt.submit` («prompt.submit skipped: re-entry (the plugin's own code raised it)»; Verify фази 10, 2026-10-09, F1), тож DeliverReport ([SP_CTX_02_08](#SP_CTX_02_08)) до промпту продовження звіту не додасть. Звіт прибирається з черги лише після того, як промпт увійшов; відхилений промпт лишає звіт для наступного промпту людини. Запуск команди завершується після того, як обробник відповів, тож наступне читання черги бачить звіт цього застосування (черга записана до відповіді обробника); рядків розмови Flush не читає ні для продовження, ні для промпту ходу оптимізації, тож запізнення рядків у неінтерактивному хості (F2, [SP_CTX_02_24](#SP_CTX_02_24)) його не стосується: промпт ходу оптимізації не називає індексів, а перегляд, який агент робить у ході оптимізації перед правками за індексами, читає поточну розмову ([SP_CTX_02_18](#SP_CTX_02_18)) пізніше, коли рядки вже стоять у читанні; заміни з тегів для мітки DetectOptimize ставить ще до компактизації, на рядках ходу з міткою; це очікування обов'язково перевіряє сценарій «Завершення команди після обробника» в обох хостах ([SP_CTX_05_03](#SP_CTX_05_03)). Відповідь `skip` обробника не є відмовою хоста: причина видна людині рядком «Not compacted».

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| HOST_REFUSED | хост відхилив команду (виняток з текстом причини) | черга лишається; рядок стану показує текст відмови; наступна спроба — після наступного завершеного ходу |
| PERSON_MOVED | хід почався від планування, до запуску команди | команда не запускається; Flush заплановано знову кінцем того ходу або одразу, якщо він уже скінчився не перерваним; після перерваного ходу черга чекає наступного завершеного ходу |
| PERSON_ACTIVE | хід почався між перевіркою і виконанням команди | продовження не надсилається; звіт — з наступним промптом людини |
| RESUME_FAILED | відправка промпту продовження відхилена (виняток або результат з `drop`) | `lastSubmittedReportId` не змінюється; звіт лишається в черзі; рядок стану «could not resume the session; send any prompt to continue»; звіт дійде з наступним промптом людини (DeliverReport) |
| QUEUE_UNREADABLE | Queue `unreadable` | команда не запускається, нічого не пишеться; файл перенесе наступний `context_edit` ([SP_CTX_02_02](#SP_CTX_02_02)) |
| OPTIMIZE_PERSON | є `optimize`, а хід людини почався до відправки промпту ходу оптимізації (до команди або після неї) або DeliverReport уже зняв `optimize` (порівняння-і-запис не вдалося) | ходу оптимізації немає, нічого не надіслано; `optimize` лишається для DeliverReport або вже доставлений ним разом зі звітом, назвою блоку й порадою ([SP_CTX_02_08](#SP_CTX_02_08)) |
| OPTIMIZE_BUILD_FAILED | OptimizeText кинув виняток до заміни | пакет просив продовження (`compacted AND reportResume`) — `optimize = false` і звичайне продовження (Resume), як OPTIMIZE_NO_BLOCK; інакше — `optimize` лишається `true`, промпту немає, порада піде з промптом людини (DeliverReport); рядок стану |
| OPTIMIZE_NO_BLOCK | після застосування TagRegistry `unreadable` або `lastClosed` відсутній | `optimize = false`; рядок стану; звичайне продовження цього застосування (Resume) |
| OPTIMIZE_FAILED | промпт ходу оптимізації відхилено (виняток або результат з `drop`) | `optimizePrompted` знято, `optimize` повернуто одним записом; звіт лишається в черзі; рядок стану; звіт і порада підуть з наступним промптом людини |

Хід оптимізації ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), «Мітка оптимізації в тексті»). Мітку помічає DetectOptimize ([SP_CTX_02_30](#SP_CTX_02_30)): він закриває блок у реєстрі (`lastClosed`) і на кінці ходу з міткою — коли всі рядки ходу вже на місці, а компактизації ще не було — ставить у чергу заміни з тегів `disposable` тим самим пакетом, що й правки агента цього ходу. Flush застосовує непорожню чергу як завжди, а потім, замість промпту продовження цього кінця ходу, надсилає один промпт ходу оптимізації: звіт застосування (якщо є), назву блоку, ListHint, STAGE_ADVICE і пораду про продовження. Власний текст продовження черги (`reportPrompt`) не пересилається: хід оптимізації — звичайний хід, і чи продовжувати після застосування його правок, агент вирішує налаштуванням `resume` свого `context_edit`, як завжди ([C_CTX_DEC_03](./context_editor.concept.md#C_CTX_DEC_03)); OptimizeText радить зазвичай зупинитися (`resume: false`), бо мітку ставлять, завершуючи хід для людини. Рядків розмови Flush не читає: з реєстру він бере лише назву блоку; індексів, розміру і кандидатів промпт не має ([SP_CTX_DEC_15](#SP_CTX_DEC_15)): після застосування індекси попереднього перегляду вже не діють (`listedKey`, [SP_CTX_02_18](#SP_CTX_02_18)), а в неінтерактивному хості повернені рядки з'являються в читанні із запізненням (F2), тож межі блоку агент бачить у перегляді — з позначками `[block ▶ …]` і `[block end]` ([SP_CTX_02_01](#SP_CTX_02_01)). Між першою перевіркою `MovedSince` і відправкою минає команда компактизації; за цей час промпт людини може пройти DeliverReport, віддати звіт і пораду і зняти `optimize`. Тому Optimize перевіряє `MovedSince` ще раз безпосередньо перед заміною і робить саму заміну (`optimize` → `optimizePrompted`) порівнянням-і-записом на ланцюжку черги: `optimize` уже `false` — нічого не надсилається. Залишкове вікно — промпт людини між заміною і відправкою: промпт ходу оптимізації стає в чергу за ходом людини, а DeliverReport знімає `optimizePrompted` (між ходами), тож мітка того ходу знову діяла б — прийнятий ризик. Запобіжник петлі: мітку у відповіді ходу оптимізації DetectOptimize ігнорує за `optimizePrompted` і знімає прапорець. Дві компактизації бувають лише тоді, коли черга ходу з міткою була непорожня (агент і правив, і поставив мітку, або були теги `disposable`): перша застосовує пакет ходу з міткою, друга — правки ходу оптимізації ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02)). Промпт ходу оптимізації надсилається з тієї самої відкладеної дії після `turn.complete`, що й промпт продовження; без команди перед ним він запускає новий хід у неінтерактивному хості з потоковим входом (навичка plugin-hooks, пункт 38), а в терміналі це перевіряє живий сценарій «Мітка оптимізації» ([SP_CTX_05_03](#SP_CTX_05_03)).

### 02_07. HandleCompaction  {#SP_CTX_02_07}

> **Criticality:** core

Purpose: обробник події компактизації в моді: застосувати чергу для MARKER, засіяти нову сесію для HANDOFF_MARKER.

Input: подія компактизації з `trigger`, `instructions`, `messages: list<Row>`, `agentId?`. Збіг — за `instructions` і відсутністю `agentId`, за будь-якого `trigger`, крім `precompute` (попереднє обчислення нічого не встановлює, як і в спостерігача [SP_CTX_02_18](#SP_CTX_02_18)): команда компактизації, яку запускає мод, приходить з `trigger: 'manual'` ([SP_CTX_02_06](#SP_CTX_02_06)).

Processing logic (pseudocode):
    ON compaction (any trigger):
        IF agentId present OR trigger = precompute OR instructions NOT IN (MARKER, HANDOFF_MARKER): pass to next handler
        IF instructions = HANDOFF_MARKER: RETURN HandleSeed(messages)          # SP_CTX_02_26
        IF storage unavailable: RETURN skip "storage unavailable"
        q = read Queue; IF state = unreadable: RETURN skip "queue unreadable"
        IF q.edits empty: RETURN skip "no queued edits"
        IF q.handoff present: RETURN skip "handoff pending"            # правки належать передачі (SP_CTX_02_21)
        reg = read TagRegistry (unreadable → every edit failed "tag registry unreadable")
        edits = q.edits; pinned edits → failed "target is pinned"; edits touching the state row other than its rewrite → failed "target holds the state slot" (rules of SP_CTX_02_03)
        api = read main conversation in Messages API form
        (found, knownResults, unmatchedPromptMedia, apiTruncated) = CollectMedia(api, messages); mediaOwners = keys(found)
        id = now (ms); media = {}; n = 0
        FOR owner IN owners whose media the edits replace:
            FOR ref IN found[owner]:
                n += 1; path = <storage>/<id>/<n>.<ext>
                IF ref.data absent OR writing fails: drop media[owner]; BREAK      # ApplyEdits fails its edits
                media[owner] += path
        archive = <storage>/<id>.json
        (rows, report) = ApplyEdits(messages, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia, apiTruncated)
        IF report.originals not empty AND writing archive (compact JSON, through a host command) fails:
            IF the dispatch was abandoned: RETURN skip "compaction abandoned"
            write Queue with every edit failed "originals could not be archived" (report and kept fields as below)
            RETURN skip "originals could not be archived"                 # оригінали не зникають без архіву
        rows = DropOwnCalls(rows, mediaOwners, knownResults); report.charsAfter = Σ size(rows)   # повернений список уже пройшов KeepResponsesWhole
        report.produced = Produced(rows, applied steps)                # SP_CTX_02_04: індекси в кінцевому списку
        IF the dispatch was abandoned (interrupt, budget): RETURN skip "compaction abandoned"   # пакет лишається в черзі
        RebindTags(rows, report)                                       # SP_CTX_02_14: теги, псевдоніми, межі етапів, слот стану
        text = FormatReport(report, archive, compaction)               # SP_CTX_01_05: без правок — «not changed», без рядка розміру
        write Queue { edits: [], resume: true, resumePrompt: DEFAULT_RESUME, tagsOnly: false,
                      report: (q.report ? q.report + "\n" : "") + text, reportId: id,
                      reportResume: q.resume AND NOT q.tagsOnly, reportPrompt: q.resumePrompt,
                      optimize: q.optimize, optimizePrompted: q.optimizePrompted, handoff: q.handoff }   # поля чужих кроків — як прочитано (SP_CTX_01_04)
        toast first 200 chars of text
        IF report.applied empty: RETURN skip "no edit could be applied"
        RecordBoundary(rows)                                           # SP_CTX_02_18
        in the background, on the journal chain: JournalApply(id, report, archive, messages, edits)   # SP_CTX_02_31; не затримує відповіді
        RETURN { messages: rows }

    ON handler failure:
        IF agentId present OR trigger = precompute OR instructions NOT IN (MARKER, HANDOFF_MARKER): pass to next handler
        IF instructions = HANDOFF_MARKER: RETURN skip "seeding failed" at once         # RunHandoff побачить, що засів не взято
        RETURN skip "applying the edits failed" at once; in the background, on the queue's serial chain, write
            Queue { edits: [], resume: true, resumePrompt: DEFAULT_RESUME, tagsOnly: false,
                    report: (q.report ? q.report + "\n" : "") + "context-editor: applying the edits failed (<reason>); the conversation was not changed",
                    reportId: now, reportResume: false, reportPrompt: DEFAULT_RESUME,
                    optimize, optimizePrompted, handoff: as read from the queue file on that chain }

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| SKIP_STORAGE | сховище `unavailable` | розмова не змінюється |
| SKIP_QUEUE_READ | Queue `unreadable` | розмова і черга не змінюються |
| SKIP_EMPTY | черга порожня | розмова не змінюється |
| SKIP_HANDOFF | у черзі запит передачі | розмова і черга не змінюються; правки застосує передача |
| SKIP_NONE_APPLIED | жодна правка не застосувалась | звіт пояснює причини |
| SKIP_FAILED | обробник впав | розмова не змінюється; черга очищена; звіт про збій чекає наступного промпту |
| SKIP_ABANDONED | хост покинув диспетчеризацію до повернення | розмова і черга не змінюються; медіа-файли й архів, уже записані, лишаються без посилань |
| SKIP_NOT_ARCHIVED | файл оригіналів не записався | жодна правка не застосовується; пакет очищено; звіт називає кожну правку |

Справжнє підсумовування для компактизації з MARKER або HANDOFF_MARKER не запускається за жодної гілки обробника: кожна гілка відповідає або списком рядків, або `skip`, а гілка збою відповідає `skip` одразу, не чекаючи запису черги. На цьому стоїть [C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09): команду з міткою запускає лише код того самого модуля, тож обробник завантажений, коли вона приходить. Якщо хост відкидає повернений список (збій хука після відповіді), спрацьовує гілка збою: звіт про збій дописується після вже записаного звіту і повідомляє, що розмову не змінено. Обробник не відправляє промпт і не чекає на нього ([SP_CTX_DEC_04](#SP_CTX_DEC_04)). Компактизація з іншими інструкціями (зокрема `/compact` людини) іде далі без змін; її межу записує спостерігач [SP_CTX_02_18](#SP_CTX_02_18). Людина, що введе `/compact` з текстом MARKER, отримає те саме, що й запуск мода.

Кожен запис черги цього обробника (застосування, відмова архіву, гілка збою) змінює лише пакет і поля звіту, а `optimize` і `optimizePrompted` переносить без змін ([SP_CTX_01_04](#SP_CTX_01_04)): у ході з міткою і непорожньою чергою Flush читає чергу після команди і мусить побачити `optimize`, інакше хід оптимізації не запустився б.

### 02_08. DeliverReport  {#SP_CTX_02_08}

Purpose: довести звіт до агента рівно один раз з промптом, який мод не надсилав сам; тим самим промптом довести назву блоку й пораду запиту оптимізації, якого не вдалося виконати ходом оптимізації, та інструкцію на початку сесії ([SP_CTX_02_27](#SP_CTX_02_27)).

Processing logic (pseudocode):
    ON prompt submitted (main conversation, passes the mod's hooks):
        context = []
        IF storage ready AND TagRegistry.introduced = false (state ok or missing): context += INTRO_TEXT            # SP_CTX_02_27
        q = read Queue
        IF q.report: context += q.report
        IF q.optimize:                                                      # хід оптимізації не відбувся (HOST_REFUSED, PERSON_MOVED після перерваного ходу, OPTIMIZE_PERSON, OPTIMIZE_FAILED, OPTIMIZE_BUILD_FAILED, перезавантаження модуля)
            reg = read TagRegistry (now, at hook time)
            IF reg readable AND reg.lastClosed present:
                TRY context += PersonAdvice(reg.lastClosed)                  # SP_CTX_02_29: без індексів, розміру і кандидатів; рядків не читає; заміни з тегів уже поставив DetectOptimize
                CATCH: advice skipped                                       # ADVICE_FAILED: одна спроба
            # реєстр unreadable або lastClosed відсутній — поради немає (ADVICE_NO_BLOCK)
        tookOver = q.optimizePrompted AND NOT inTurn                        # промпт людини між ходами: людина взяла хід, запобіжник петлі більше не потрібен
        entered = next(prompt with context appended as hidden context)
        IF entered (no drop):
            IF INTRO_TEXT was added: on the registry chain: introduced = true
            on the queue chain: IF q.report was added: RemoveDelivered(q.report); IF q.optimize: optimize = false; IF tookOver: optimizePrompted = false
        RETURN entered

Logic: при кожному промпті основної розмови, що проходить хуки мода (промпт людини або іншого розширення), мод, якщо `Queue.report` присутній, додає `report` як прихований контекст промпту і передає промпт далі. Лише коли промпт увійшов (результат без `drop`), мод на послідовному ланцюжку черги виконує `RemoveDelivered(text)`: видаляє з `report` саме доставлений текст — увесь звіт, якщо він не змінився (тоді також `reportId`, `reportResume = false`, `reportPrompt = DEFAULT_RESUME`), або лише доставлений початок, якщо тим часом дописано новий звіт. Той самий крок виконує Flush після свого промпту продовження ([SP_CTX_02_06](#SP_CTX_02_06)). Промпт, відхилений нижчим обробником, лишає звіт у черзі для наступного промпту.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| PROMPT_DROPPED | нижчий обробник відхилив промпт | звіт лишається в черзі |
| DELIVERY_FAILED | збій читання або запису черги | промпт іде без звіту або звіт лишається; доставка повториться з наступним промптом — тобто при збої запису після вже прийнятого промпту звіт буде доставлено вдруге (щонайменше один раз, не рівно один) |
| ADVICE_FAILED | побудова поради кинула виняток | промпт іде без поради (зі звітом, якщо він є); після входу `optimize = false` |
| ADVICE_NO_BLOCK | `optimize`, але TagRegistry `unreadable` або `lastClosed` відсутній | промпт іде без поради (зі звітом, якщо він є); після входу `optimize = false` |
| INTRO_NOT_RECORDED | `introduced = true` не записалось після прийнятого промпту | інструкцію буде додано й до наступного промпту (щонайменше один раз); реєстр `unreadable` — інструкції немає взагалі, бо її доставку нема де записати |

Промпти, які мод надсилає сам (`$.prompt.submit`: продовження Flush, хід оптимізації, Deliver передачі), цих хуків не проходять — хост пропускає для них власні хуки `prompt.submit` плагіна (Verify фази 10, 2026-10-09, F1). Тому такі промпти несуть звіт у власному тексті, а DeliverReport служить лише промптам людини (зокрема коли продовження вимкнено або людина вже почала хід). Збій кроку не впливає на промпт.

Порада з промптом людини. Якщо `Queue.optimize` є, коли промпт людини проходить хук (хост відхилив команду компактизації — HOST_REFUSED; хід почався від планування, а після перерваного ходу Flush не планується знову — PERSON_MOVED; людина почала хід раніше, ніж Flush надіслав промпт ходу оптимізації — OPTIMIZE_PERSON; промпт ходу оптимізації відхилено — OPTIMIZE_FAILED; текст ходу оптимізації не зібрався — OPTIMIZE_BUILD_FAILED; гаряче перезавантаження скасувало заплановану дію Flush), DeliverReport додає PersonAdvice — назву блоку `lastClosed`, STAGE_ADVICE і вказівку спершу викликати `context_list` ([SP_CTX_02_29](#SP_CTX_02_29)); індексів, розміру і кандидатів порада не має ([SP_CTX_DEC_15](#SP_CTX_DEC_15)), тож вона не застаріває, коли Flush пізніше застосує правки, що ще в черзі (зокрема заміни з тегів, якщо команду відхилено). Для поради DeliverReport читає лише реєстр і чергу, рядків розмови не читає; нічого в чергу DeliverReport не ставить: заміни з тегів `disposable` для мітки вже поставив DetectOptimize на кінці ходу з міткою ([SP_CTX_02_13](#SP_CTX_02_13)), тож на запасному шляху вони не губляться. `optimize` знімається, коли промпт увійшов, — з порадою чи без неї (збій побудови поради не повторюється з кожним промптом). `optimizePrompted` знімає промпт людини, що проходить хук між ходами (`inTurn = false`, лічильник ходів преамбули 02): людина взяла хід, і мітка в наступній відповіді агента знову діє. Повідомлення людини посеред ходу оптимізації вливається в цей хід і проходить хук при `inTurn = true`, тож прапорця не чіпає; після перезавантаження модуля `inTurn` починається з `false`, і таке повідомлення зняло б прапорець — тоді мітка у відповіді ходу оптимізації дала б ще один хід оптимізації (прийнято: петлі немає, бо наступний промпт ходу оптимізації знову ставить прапорець).

### 02_09. Nudge (вилучено)  {#SP_CTX_02_09}

Вилучено 2026-10-10: автоматичного нагадування за розміром контексту немає ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15), B). Поріг усього запиту спрацьовував, коли звільняти було нічого (незмінна частина в розширенні VS Code — близько 70 тисяч токенів), і відволікав агента на кількість повідомлень. Оптимізацію запускає лише рішення агента — закриття етапу ([SP_CTX_02_29](#SP_CTX_02_29)) або мітка оптимізації ([SP_CTX_02_30](#SP_CTX_02_30)); розмір агент бачить у телеметрії на запит ([SP_CTX_02_28](#SP_CTX_02_28)), а про можливість дізнається з інструкції на початку сесії ([SP_CTX_02_27](#SP_CTX_02_27)). Хук викликів ([SP_CTX_02_16](#SP_CTX_02_16)) після звичайних викликів інструментів нічого, крім рядка псевдоніма, не додає; константи NUDGE_FIRST і NUDGE_STEP і змінна `nudged` вилучені; заміни з тегів ставить у чергу закриття етапу і хід оптимізації ([SP_CTX_02_13](#SP_CTX_02_13)).

### 02_10. CollectMedia  {#SP_CTX_02_10}

Purpose: знайти медіа-ресурси розмови, яких немає в Row.

Input: `api` — основна розмова у форматі Messages API, як її повертає читання розмови з поданням `api` (до ROW_WINDOW повідомлень, починається з повідомлення `user`); `rows` — рядки розмови. Output: `found: map<owner, list<MediaRef>>` (не більше записів, ніж медіа-блоків у `api`), `knownResults: set<string>` (усі `tool_use_id` результатів у `api`), `unmatchedPromptMedia: int` (повідомлення людини з медіа, для яких PromptMatch дав «немає»), `apiTruncated: bool` = `len(api) ≥ ROW_WINDOW − 1` (читання API-подання повернуло найбільшу кількість повідомлень, тож старіші могли лишитися поза ним; навичка plugin-hooks, пункт 10). Мінус один — бо подання починається з повідомлення `user`, і хост може відкинути провідне повідомлення асистента після обрізання; хибне спрацювання лише повертає колишню відмову (ApplyEdits, «outside the API window»), а пропуск дав би правку поза поданням.

Processing logic (pseudocode):
    FUNCTION CollectMedia(api, rows):
        FOR block IN tool_result blocks of api:
            FOR inner IN block.content WHERE inner.type IN (image, document):
                result[{tool_use_id: block.tool_use_id}] += MediaRef(inner)
        FOR msg IN user messages of api WITH top-level image/document blocks:
            PromptMatch(msg, rows) → index or none           # SP_CTX_DEC_06
            IF index: result[{row: index}] += MediaRef(each media block)
        RETURN result

`MediaRef(block)`: `mediaType` і `data` — з `block.source`, якщо джерело типу `base64`; інакше `data` відсутнє; `bytes` = довжина декодованих даних.

Зіставлення за `tool_use_id` однозначне. `PromptMatch` для медіа в промптах людини — відкрите рішення [SP_CTX_DEC_06](#SP_CTX_DEC_06); доки його не закрито, `PromptMatch` завжди повертає «немає», тож `describe` відхиляється з `no media found in that row`.

### 02_11. context_tag  {#SP_CTX_02_11}

Purpose: інструмент агента; ставить і знімає теги, відкриває і закриває етапи ([C_CTX_DEC_16](./context_editor.concept.md#C_CTX_DEC_16), [C_CTX_DEC_17](./context_editor.concept.md#C_CTX_DEC_17)).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| tags | list<TagRequest> | yes | 1..MAX_TAGS; запити обробляються по порядку, кожен бачить реєстр після попередніх |

Також хук бере з події `tool.call` власний `tool_use_id` цього виклику (`callId`): за ним знаходиться рядок, що несе виклик.

TagRequest:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| op | `add` \| `remove` \| `open` \| `close` | yes | — | — | Дія |
| kind | `pin` \| `disposable` \| `review` \| `state` | для `add` | — | — | Значення тегу; агентський `review` отримує `reason = agent` |
| tool_use_id | string? | для `add`/`remove` рівно одне з трьох | — | — | Ціль — пара виклику |
| index | int? | для `add`/`remove` рівно одне з трьох; для `open` — необов'язковий | — | 0..len-1 | Ціль — рядок за індексом [SP_CTX_02_01](#SP_CTX_02_01); для `open` — перший рядок блоку; для діапазону — його перший рядок |
| ref | string? | для `add`/`remove` рівно одне з трьох | — | псевдонім або `last` | Ціль — пара виклику за псевдонімом ([SP_CTX_02_17](#SP_CTX_02_17)) |
| to | int? | no | — | лише з `op = add`, `kind = disposable` і `index`; `index < to ≤ len-1` | Останній рядок діапазону включно ([C_CTX_03_04](./context_editor.concept.md#C_CTX_03_04): гілка, яку агент щойно відкинув) |
| note | string? | для `disposable` | — | непорожній, ≤ MAX_TEXT | Нотатка-заміна |
| ttl_turns | int? | no | — | ≥ 1; лише з `kind = review` | Термін |
| stage | string? | для `open` | — | 1..MAX_STAGE_NAME після обрізання пробілів | Назва етапу |

Output: скільки тегів поставлено і знято, відхилені запити з причинами; для кожного закриття етапу (зокрема того, що закрило `open`) — звіт закриття (BlockReport, [SP_CTX_02_29](#SP_CTX_02_29)); для `open` — `Stage "<name>" opened; its block starts at #<first>.`; для `add state` поверх наявного — `The state slot moved from #<old> to #<new>.`

Errors (рівень виклику позначено *, решта — рівень запиту, і решта пакета обробляється):
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT* | виклик із субагента | — |
| DENIED_EMPTY* | `tags` відсутній, порожній або не список | — |
| DENIED_STORAGE* | сховище `unavailable` | — |
| DENIED_REGISTRY_READ* | TagRegistry `unreadable` | реєстр не перезаписується |
| DENIED_REGISTRY_WRITE* | реєстр не записався | причина в повідомленні; етапи цього виклику не відкрито і не закрито, заміни з тегів не поставлено |
| BAD_OP | `op` не з чотирьох | — |
| KIND_REQUIRED | `add` без коректного `kind` | — |
| TARGET_REQUIRED | `add`/`remove`: вказано не рівно одне з `tool_use_id` / `index` / `ref` | — |
| UNKNOWN_REF | `ref` не розв'язується | позначені виклики мають рядок `[context-editor] id …` |
| TARGET_NOT_FOUND | немає пари з таким id або рядка з таким індексом (зокрема `index` у `open`) | оновити перегляд |
| INDEXES_STALE | ціль за `index` (зокрема `index` у `open` і `to`), а межа поточної розмови змінилась від останнього `context_list` з рядками чи звіту закриття етапу у цьому процесі ([SP_CTX_02_18](#SP_CTX_02_18)) | оновити перегляд |
| NOTE_REQUIRED | `disposable` без коректного `note` | додати нотатку-заміну |
| BAD_TARGET | `disposable` за індексом без `to` на рядок, що не є текстом агента без викликів; `state` не за `index` або на рядок, що не є текстом агента без викликів з непорожнім текстом | для результатів — тегувати за `tool_use_id`; слот стану — власний текстовий рядок |
| BAD_RANGE | `to` не з `add disposable` за `index`; `to ≤ index` або поза межами; діапазон розриває пару виклику; діапазон захоплює рядок чи пару з тегом `pin` або `state` | — |
| BAD_TTL | `ttl_turns` < 1 або не для `review` | — |
| TAGS_FULL | новий тег (не заміна) при MAX_TAGS тегах у реєстрі, або файл реєстру став би більшим за MAX_QUEUE_BYTES | зняти непотрібні теги |
| NO_TAG | `remove` для цілі без тегу | — |
| STAGE_NAME_REQUIRED | `open` без коректного `stage` | назва 1..MAX_STAGE_NAME символів |
| STAGE_FIELDS | `open` з полем, крім `op`, `stage`, `index`; `close` з будь-яким полем, крім `op` | — |
| NO_STAGE | `close` без відкритого етапу | щоб закрити блок, який не відкривали, — `open` з `index` першого рядка і `close` в одному виклику |

Processing logic (pseudocode):
    FUNCTION context_tag(tags, callId):
        REQUIRE storage ready, TagRegistry state != unreadable
        rows = CurrentRows() (SP_CTX_02_18); reg = TagRegistry; closes = []
        normalize reg.stage.after and reg.lastClosed.after that are lost on rows to null; a lost lastClosed.end stays (SP_CTX_01_18)
        carrier = index of the row of rows whose toolUses hold callId; none → len(rows)   # рядок, що несе цей виклик; ще не записаний — після останнього
        FOR req IN tags:
            validate (table above); on error → rejected += reason; CONTINUE
            open:  IF reg.stage: closes += CloseStage(reg, rows, carrier)                       # SP_CTX_02_29
                   after = req.index given ? MarkBefore(rows, req.index) : MarkBefore(rows, carrier)   # SP_CTX_01_18
                   reg.stage = { name: trimmed req.stage, after, openedTurn: reg.turn }
            close: closes += CloseStage(reg, rows, carrier)
            add, remove:
                target = req.index given ? { anchor: fingerprint(rows[req.index]), hint: req.index }
                                           + (req.to given ? { toAnchor: fingerprint(rows[req.to]), toHint: req.to } : {})
                                         : { tool_use_id: req.tool_use_id or ResolveRef(req.ref) }
                add state: remove the registry's other state tag, if any
                add: replace any tag on target (same tool_use_id, or same first-row anchor) with Tag(req, created_turn = reg.turn, reason = agent for review)
                remove: delete the tag on target
        write TagRegistry
        replaced = closes not empty ? QueueTagReplacements() : none            # SP_CTX_02_13, на ланцюжку черги, після запису реєстру
        RETURN text report + BlockReport of each close (with replaced in the last one)   # SP_CTX_02_29

Відкриття без `index` ставить межу перед рядком, що несе виклик `open`: блок починається з відповіді, в якій агент відкрив етап. Рядок виклику шукається за `callId` у поточній розмові; якщо хост ще не записав рядок асистента з цим викликом до хука `tool.call` (не перевірено), `carrier = len(rows)`, і межа — останній рядок розмови, тобто той самий рядок перед відповіддю. Межа ніколи не стоїть на рядку лише з thinking (MarkBefore пропускає такі рядки: їхні відбитки однакові й не знаходять рядка однозначно). Відкриття з `index` 0 дає `after = null` — блок від голови. Відкриття нового етапу при відкритому спершу закриває поточний: кінець його блоку — рядок перед рядком виклику, а звіт закриття входить у результат. Закриття і заміни з тегів відбуваються лише після вдалого запису реєстру; QueueTagReplacements після кількох закриттів одного виклику запускається один раз. Порядок запитів має значення: `open` з `index` і `close` в одному виклику закривають блок, який агент не відкривав заздалегідь ([C_CTX_03_03](./context_editor.concept.md#C_CTX_03_03), «Закриття без відкритого етапу»).

Опис інструмента (TAG_DESCRIPTION) не довший за MAX_DESCRIPTION; сьогоднішній текст — близько 1270 символів, і нове додає близько 700. Обов'язковий зміст за пріоритетом: (1) теги живуть поза розмовою і не коштують токенів; обгортка `{"tags":[…]}`, запити по порядку; (2) цілі — `tool_use_id`, `ref` (рядки `[context-editor] id cN`, `last`), `index`, діапазон `index`..`to` для `disposable`; (3) `open` з `stage` і необов'язковим `index`, `close` — повертає межі блоку, кандидатів, телеметрію і пораду; `open` закриває відкритий етап; (4) види: `pin`; `disposable` з нотаткою — заміна ставиться в чергу, коли агент закриває етап або просить оптимізацію; `review` з `ttl_turns`; `state` — один власний текстовий рядок, що змінюється лише `rewrite`; (5) автоматичні `review` мають причину (big, search, stale, duplicate); (6) `remove` і заміна тегу на тій самій цілі; (7) вказівка на навичку `context-editor:<SKILL>`. Лише в навичці: коли відкривати і закривати етапи, мітка оптимізації, шаблон запису етапу, що робити з кожною причиною `review`. Скорочується спершу текст пунктів (5) і (6); пункти (1)–(4) лишаються повністю.

### 02_12. AutoTag  {#SP_CTX_02_12}

Purpose: застосувати правила R1, R2, R3 і R5 [SP_CTX_01_11](#SP_CTX_01_11) до кожного нового рядка основної розмови (R4 — у хуку викликів, [SP_CTX_02_16](#SP_CTX_02_16)).

Processing logic (pseudocode):
    ON row appended (main loop):
        stored = next(row)                         # рядок зберігається без змін
        door, origin = from the append event
        IF origin.kind = plugin: RETURN stored     # копія після компактизації плагіна або нотатка плагіна — не новий рядок
        IF door NOT IN (prompt, tool-result, tool-message, attachment): RETURN stored
        in the background, on the registry chain, IF storage ready AND TagRegistry state != unreadable:
            R1: door = prompt AND origin.kind IN (composer, bridge, sdk, unclassified)   # stream-json дає промпту людини unclassified (F3)
            R2, R3: door = tool-result; tool = origin.tool; ids = tool_use_id of each tool_result block; reason big / search
            R5 (a): door = tool-result AND some result text of the row ≥ BIG_ROW:
                rows = CurrentRows()
                FOR each result r of the row WITH len(r.text) ≥ BIG_ROW:
                    call = the call with r.tool_use_id in rows; IF absent OR call.tool starts with OWN_TOOLS: CONTINUE   # інструмент — з власного виклику результату, не з походження рядка
                    earlier = the pairs of rows before the row of r whose result text = r.text
                              + (call.tool = Read ? the earlier Read pairs whose call has equal file_path, offset, limit, pages : none)
                    FOR e IN earlier: tag e { review, reason duplicate } unless e has a tag other than review big/search
            R5 (b): door IN (prompt, tool-message, attachment) AND the appended row is user without results AND its text ≥ BIG_ROW:
                rows = CurrentRows(); at = the row of rows that is this row (promptRow match, as R1); none → skip
                FOR each earlier user row without results whose text = rows[at].text: tag it { review, reason duplicate } by anchor, same overwrite rule
            write TagRegistry if changed
        RETURN stored
    ON turn completed (main loop, not aborted): TagRegistry.turn += 1     # після DetectOptimize (преамбула 02); команди мода подій ходу не дають
    ON hook failure: RETURN stored row unchanged

Обробник ніколи не змінює і не відхиляє рядок. Рядки з `origin.kind = plugin` правила не бачать: у неінтерактивному хості кожен рядок, повернений обробником компактизації, знову проходить подію додавання з походженням плагіна, що запустив `/compact` (спайк context_editor_handoff_long, Entry 4; навичка plugin-hooks, пункт 24), і без цього фільтра R2 і R3 ставили б теги копіям уже опрацьованих результатів (R2 перевіряє лише, що інструмент не з OWN_TOOLS, а в копії інструмента в походженні немає). Фільтр охоплює будь-який плагін, а не лише цей мод: копії після компактизації іншого плагіна — так само не нові рядки, а свіжий результат інструменту походження плагіна не має. Промпт, який плагін передає від імені людини (`asUser`), має походження плагіна і теж пропускається; поведінка від цього не змінюється, бо R1 і без фільтра вимагає походження людини. Походження людини для R1 — `composer`, `bridge`, `sdk` і `unclassified`: у неінтерактивному хості рядки промптів людини доходять до події додавання з походженням `unclassified`, а не `sdk` (Verify фази 10, 2026-10-09, F3); рядки з походженням плагіна відсікає фільтр вище, тож копії і промпти плагінів R1 не бачить. Інших хуків додавання рядка мод не має. Рядок R1 у переліку [SP_CTX_02_01](#SP_CTX_02_01) — останній рядок `user` без результатів, текст якого збігається з текстовими блоками промпту без урахування пробільних символів (або містить їх); не знайдено — R1 не спрацьовує і `firstPromptPinned` лишається `false`.

R5 ([C_CTX_03_04](./context_editor.concept.md#C_CTX_03_04), «Дублікат»; пропозиція P3) позначає ранішу копію, бо пізніша — свіжа і, найімовірніше, потрібна далі. Порівняння тексту — точна рівність; поля `Read` — `file_path`, `offset`, `limit`, `pages` виклику (вхід виклику береться з рядка асистента з тим самим `tool_use_id` у поточній розмові; виклику не знайдено — рівності полів немає). Перетини різних діапазонів одного файлу не позначаються: концепт обмежує дублікат тим самим результатом і тим самим діапазоном. R5 бачить лише великий текст (від BIG_ROW, концепт: «великий текст повторює вміст раннього рядка») і читає поточну розмову лише для результатів і рядків без результатів від BIG_ROW, у фоні, не затримуючи рядка. Інструмент кожного результату береться з його власного виклику: рядок з кількома результатами паралельних викликів має одне походження, а інструменти в ньому різні. Двері `tool-message` і `attachment` хук дивиться лише заради R5 (б); R1–R3 їх не бачать.

### 02_13. QueueTagReplacements  {#SP_CTX_02_13}

Purpose: поставити в чергу заміни з тегів `disposable` і оцінити звільнення. Запускають лише закриття етапу інструментом ([SP_CTX_02_11](#SP_CTX_02_11), [SP_CTX_02_29](#SP_CTX_02_29)) і мітка оптимізації на кінці свого ходу (DetectOptimize, [SP_CTX_02_30](#SP_CTX_02_30)) — обидва читають поточну розмову, коли компактизація щойно не відбувалась і всі рядки ходу вже на місці; заміни мітки йдуть тим самим пакетом, що й правки агента цього ходу. Ні Flush, ні DeliverReport замін не ставлять. Порогу розміру немає ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)).

Output: `{ queued: int, freed: int }` — кількість поставлених правок і `freed = (Σ size замінюваного − Σ довжина нотаток) / 4`; для `collapse` замінюване — сума `size` рядків діапазону.

Processing logic (pseudocode):
    FUNCTION QueueTagReplacements():                    # на ланцюжку черги
        rows = CurrentRows() (SP_CTX_02_18); reg = TagRegistry; q = Queue
        IF reg or q unreadable: RETURN { 0, 0 }
        edits = []
        FOR tag IN reg.tags WHERE kind = disposable AND its replacement (key below) is not already in q.edits:
            { tool_use_id } AND pair exists → summarize(tool_use_id, tag.note)
            { anchor } without range AND Locate finds the row → rewrite(index, tag.note)
            range AND Locate finds both ends, from < to → collapse(from, to, tag.note)
        (queued, errors) = PrepareEdits(rows, edits, reg, checkListedKey = false)   # pin, state, пари діапазону — як для правок агента; без перевірки listedKey
        IF queued empty OR len(q.edits) + len(queued) > MAX_QUEUE_EDITS OR the file would exceed MAX_QUEUE_BYTES: RETURN { 0, 0 }
        IF len(q.edits) == 0: q.tagsOnly = true
        q.edits += queued; write Queue (a write failure → RETURN { 0, 0 })
        RETURN { len(queued), freed }

Перевірки `listedKey` рядка 02_03 «межа поточної розмови не змінилась від останнього `context_list`» QueueTagReplacements не робить: індекси замін він бере щойно з Locate на поточній розмові, а не з переліку агента, тож застарілими вони бути не можуть. Ключ заміни — те, за чим RebindTags упізнає заміну тегу в пакеті: `summarize` з `tool_use_id` цілі і `summary = note`; `rewrite` з якорем цілі і `text = note`; `collapse` з якорями обох кінців і `summary = note`. Тег, чия заміна вже стоїть у черзі (закриття етапу інструментом, а потім мітка в тому самому ході), удруге не ставиться. Відхилені PrepareEdits заміни не повідомляються окремо: тег лишається, а агент бачить його в переліку.

Пакет лише з тегів не продовжує сесію: звіт піде з наступним промптом людини ([SP_CTX_02_08](#SP_CTX_02_08)). Правка агента в тому самому пакеті знімає `tagsOnly` ([SP_CTX_02_02](#SP_CTX_02_02)).

### 02_14. RebindTags  {#SP_CTX_02_14}

Purpose: тримати реєстр узгодженим з розмовою після застосування: теги, псевдоніми, межі етапів і слот стану.

Logic: у [SP_CTX_02_07](#SP_CTX_02_07) після ApplyEdits, а також у реєстрах, скопійованих у сховище нової сесії після засіву ([SP_CTX_02_21](#SP_CTX_02_21), крок `registries`; рядки «до» — ті, до яких BuildSeed застосував правки, «після» — засіяні), видалити псевдоніми змінених і зниклих пар з AliasRegistry, а також теги, чиї цілі змінено застосованими правками (пари `summarize`/`drop` разом з їхніми рядками, пари й рядки діапазонів `collapse`, рядки `rewrite`/`describe`; для тегу-діапазону — будь-який рядок діапазону), теги `disposable`, чия заміна (ключ [SP_CTX_02_13](#SP_CTX_02_13)) була в пакеті — застосована чи відхилена ([SP_CTX_04_03](#SP_CTX_04_03)), і теги, чиї цілі не знайдено в новому списку рядків (за `tool_use_id` або Locate; для діапазону — обидва кінці); новий список: у компактизації — повернені рядки, а якщо не застосовано жодної правки — рядки події; для засіву — засіяні рядки `s.rows`, а «до» — `s.visible`, пакет — `s.edits` (до перевірки `pin`), застосовані — правки з `s.edits`, чий опис є в `s.report.applied`. Тег рядка, що лишився, отримує новий індекс як `hint` (діапазон — і `toHint`). Збій запису реєстру не скасовує застосування.

Слот стану ([C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)). Тег `state` переживає застосовану `rewrite` власного рядка: тег переходить на переписаний рядок — `anchor` = відбиток рядка нового списку, текст якого дорівнює тексту, який ApplyEdits записав для цієї правки (`MARK + " rewritten" + note + ": " + text`), `hint` — його індекс; кілька таких рядків — найближчий до старого `hint`. Будь-яка інша втрата рядка (згортання діапазону з ним неможливе за PrepareEdits, але ціль може зникнути з вікна, засів може лишити рядок до підсумку) видаляє тег, як інші.

Межі етапів ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), «Етап»). `stage.after`, `lastClosed.after` і `lastClosed.end` не видаляються, а переносяться:

    FUNCTION Survivors(before, after, changed) → map<int, int>       # індекс у before → індекс у after
        j = 0; map = {}
        FOR i IN 0 .. len(before) − 1:
            IF i ∈ changed OR NOT Distinctive(before[i]): CONTINUE    # SP_CTX_01_18
            k = the first index ≥ j with fingerprint(after[k]) = fingerprint(before[i]); IF none: CONTINUE
            map[i] = k; j = k + 1
        RETURN map

    FUNCTION RelocateMark(m, before, after, applied, produced, changed):
        IF m null: RETURN null
        x = MarkIndex(before, m); IF lost: RETURN null              # рядка вже не було в «до» — межа діє від голови
        Es = the applied edits that replace x (summarize of a pair with a row at x, collapse whose span holds x, rewrite or describe of x) and have a produced entry
        IF Es not empty:
            P = the produced entry of Es with the largest index          # спільний рядок результату кількох summarize — найпізніший створений рядок
            RETURN { anchor: P.fingerprint, hint: P.index }            # заміна: межа на останньому рядку, створеному правкою; індекс — з кінцевого списку
        map = Survivors(before, after, changed)
        FOR p = x DOWN TO 0: IF p ∈ map: RETURN { anchor: fingerprint(after[map[p]]), hint: map[p] }   # прибрано без заміни або змінено засівом
        RETURN null

`changed` — рядки `before`, які не лишились тими самими: зачеплені застосованими правками (як для тегів вище) і, для засіву, рядки з результатом із `s.carried` — CarryNote змінив текст результату, хоч відбиток рядка (роль, ідентифікатори, текст рядка) той самий ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02): «змінено засівом»). `produced` — `report.produced` застосування ([SP_CTX_01_05](#SP_CTX_01_05)); у засіві — `s.report.produced`.

Межа, чий рядок **замінила** правка (стиснення пари, згортання діапазону, переписування, опис медіа), переходить на останній рядок, створений цією правкою: стиснутий хвіст блоку лишається в ньому, а етап, відкритий одразу після закриття, його не захоплює. Межа, чий рядок **прибрано без заміни** (`drop`, рядок, з якого DropOwnCalls прибрав службовий виклик чи який спорожнів, рядок лише з thinking, що зник) або **змінено засівом**, переїжджає за найближчий попередній рядок, що лишився незміненим. Рядок «лишився», коли його відбиток стоїть у новому списку в тому самому порядку і він не в `changed`. Перезбирання без змін вмісту (рядки результатів без медіа, KeepResponsesWhole, [SP_CTX_02_04](#SP_CTX_02_04)) відбитка не змінює, тож межу на такому рядку не переносить — це той самий рядок. Рядок, з якого DropOwnCalls прибрав службовий виклик, отримує інший відбиток або зникає — і межа переїжджає. Так межа, поставлена після результату перегляду, зробленого перед відкриттям етапу, переїжджає за останній рядок перед тим переглядом, а не зникає. Збіг відбитків шукається вперед від попереднього збігу: зсув можливий лише через дубль відбитка після зниклого рядка, і тоді межа стає раніше, ніж могла б, а не пізніше. `produced` рахується вже на кінцевому списку, тож індекс і відбиток створеного рядка враховують DropOwnCalls (зокрема прибраний службовий результат з того самого рядка) і нормалізацію засіву; створений рядок, якого в кінцевому списку немає, запису не має, і діє правило прибраного рядка. Кілька правок, що замінили рядок межі (паралельні виклики, чиї результати в одному рядку: кожен `summarize` створює свій рядок результату), — межа на найпізнішому створеному рядку, щоб увесь стиснутий хвіст лишився в блоці. Без жодного попереднього рядка, що лишився, межа стає `null` (голова).

Вбудована компактизація хоста (`/compact` людини, автоматична) RebindTags не викликає. Межа етапу, чий рядок уже не в поточній розмові, при використанні — `lost` ([SP_CTX_01_18](#SP_CTX_01_18)): відкритий етап діє від голови, кінець закритого блоку невідомий («its end row is gone», не порожній блок), перегляд і телеметрія про це кажуть, а context_tag і DetectOptimize записують `null` лише на місце загубленого `after`. Теги зниклих рядків, зокрема `state`, видаляються наступним застосуванням мода, як і раніше ([C_CTX_03_03](./context_editor.concept.md#C_CTX_03_03), «Вбудована компактизація хоста»).

### 02_15. PrepareStorage  {#SP_CTX_02_15}

Purpose: створити сховище, доступне лише власникові, для поточної сесії.

Processing logic (pseudocode):
    ON session start, and before any operation whose session_id differs from the stored one:
        stored session_id = current
        IF HOME absent: storage = unavailable "HOME is not set"; RETURN
        run host command: create <storage> with parents
        run host command: set permissions owner-only (700) on <HOME>/.claude/context-editor and on <storage>
        IF any command fails or exits non-zero: storage = unavailable "<command>: <stderr>"; status line warning; RETURN
        storage = ready

Ідентичність процесу хоста (`hostId`, [SP_CTX_01_14](#SP_CTX_01_14)) від сховища не залежить: модуль запускає її читання один раз за свій час життя (у `session.start` або першому PrepareStorage — що раніше), і зміна сесії в тому самому процесі її не змінює. Підготовка сховища після перемикання сесії в тому самому процесі знімає з межі нової сесії `host` цього процесу ([SP_CTX_02_18](#SP_CTX_02_18)). Періодичного запису немає: зміну сесії (`/clear`, `/resume`, зокрема ті, що запускає RunHandoff) мод помічає перед наступною операцією. Медіа-файли пишуться командою хоста, що декодує base64 з потоку вводу у файл; файли лежать у каталозі сховища, доступному лише власникові.

### 02_16. MarkCall  {#SP_CTX_02_16}

Purpose: загальний хук завершених викликів інструментів основної розмови: дати агенту псевдонім виклику, який варто редагувати, позначити застарілі читання (R4, [SP_CTX_01_11](#SP_CTX_01_11)) і записати повторне читання вже стиснутого вмісту в журнал ефекту ([SP_CTX_02_31](#SP_CTX_02_31)).

Processing logic (pseudocode):
    ON tool call finished (main loop, not denied, tool not OWN_TOOLS, tool_use_id present):
        line = none
        IF (len(result text) ≥ BIG_ROW OR tool IN SEARCH_TOOLS) AND storage ready AND AliasRegistry readable:
            alias = ALIAS_PREFIX + next; next += 1; map[alias] = tool_use_id; last = alias; trim to MAX_ALIASES
            write AliasRegistry; IF written: line = "[context-editor] id <alias>: use it as \"ref\" in context_tag / context_edit"   # псевдонім без запису не розв'язався б
        IF result is not an error AND storage ready:                     # у фоні: результат не чекає ні R4, ні журналу
            IF tool IN WRITE_TOOLS: on the registry chain: R4(path = input.file_path or input.notebook_path, tool_use_id); on the journal chain: JournalChanged(path)   # SP_CTX_02_31
            IF tool = Read: on the journal chain: JournalReread(input.file_path, tool_use_id)   # SP_CTX_02_31
        RETURN line ? result + additional context line : result unchanged

    FUNCTION R4(path, writeId):
        reg = TagRegistry; IF unreadable: RETURN
        rows = CurrentRows()
        w = index of the row of rows whose toolUses hold writeId; none → len(rows)   # рядок самого виклику запису
        FOR each pair of rows whose call is Read with input.file_path = path AND whose call row index < w:
            IF the pair has no tag OR its tag is review: put { review, reason stale, target { tool_use_id }, created_turn = reg.turn } (TAGS_FULL limits as AutoTag)
        write TagRegistry if changed

Позначка — єдине, що хук додає до результату: нагадувань за розміром немає ([SP_CTX_02_09](#SP_CTX_02_09)), а після звичайного виклику без позначки результат повертається незмінним. Збій будь-якого кроку не змінює результату інструменту і не зупиняє інших кроків. «Довжина тексту результату» — текст результату так, як його читає модель (поле `text` результату від хоста); у відповіді іншого хука без `text` — довжина серіалізованого `result`; «помилка» — `isError` результату. Хук чекає запису реєстру псевдонімів перед поверненням результату, тож псевдонім, який бачить агент, уже розв'язується; R4 і журнал ідуть у фоні після повернення, тож виклик запису файлу не чекає читання розмови. Усі три кроки — в одному хуку без матчера: одну подію модуль може зареєструвати без матчера лише раз (навичка plugin-hooks, Key Concepts). Зміни файлів командами оболонки (`Bash`, зокрема `git checkout`) R4 не помічає ([SP_CTX_DEC_13](#SP_CTX_DEC_13)): агент може сам поставити `review` раннім читанням.

### 02_17. ResolveRef  {#SP_CTX_02_17}

Purpose: перетворити `ref` на `tool_use_id`.

Logic: `last` → `map[last]`; `c<число>` → `map[ref]`; інакше або за відсутності запису — `unknown ref <ref>`. Розв'язання відбувається при постановці правки чи тегу; у черзі й реєстрі тегів зберігається `tool_use_id`. Виклик, що вийшов за вікно ROW_WINDOW рядків, розв'язується, але правка відхиляється перевірками [SP_CTX_02_03](#SP_CTX_02_03).

### 02_18. CurrentRows  {#SP_CTX_02_18}

> **Criticality:** core

Purpose: відрізати від транскрипту рядки, що лишились до останньої компактизації основної розмови.

Читання розмови хоста повертає весь транскрипт: після кожної компактизації в ньому стоять рядки до межі, за ними — рядки, які повернула компактизація, далі нові. Вхід компактизації `e.messages` — лише хвіст після останньої межі. Позначки межі в рядках немає ([SP_CTX_DEC_07](#SP_CTX_DEC_07)).

Processing logic (pseudocode):
    FUNCTION RecordBoundary(rows):                 # rows — розмова, яку повернула компактизація основної розмови
        IF rows empty: RETURN
        text = Boundary { head: [fingerprint(r) FOR r IN rows[0 .. min(len(rows), HEAD_ROWS))], count: len(rows),
                          host: hostId (absent when hostId is absent or pending) }
        write text; IF written: ownBoundary = text  # пам'ять екземпляра; збій запису не зупиняє компактизацію: межа лишається попередньою

    ON storage prepared (SP_CTX_02_15):
        listedKey = none; ownBoundary = none
        start the hostId promise if it is not started
        IF this instance already had another session_id (a switch in the same process — /clear, /resume; not the first prepare after load):
            id = await hostId (outside a compaction handler; inside one, the value if resolved, else absent)
            b = read Boundary of the new session
            IF b.host is a string AND id present AND b.host = id: write b without host   # /resume у тому самому процесі: читання — завантажений ланцюжок
                IF the write fails: remove the Boundary file of the new session; IF that fails too: toast "context-editor: the boundary of the resumed session could not be untrusted: <error>"   # без межі — увесь транскрипт, що після /resume і правильно

    Trusted(b) = (b.host is a string AND hostId present AND b.host = hostId)   # той самий процес хоста (SP_CTX_DEC_10); hostId — після await обіцянки
                 OR (raw text of b = ownBoundary)                              # межу записав цей екземпляр у цій сесії — зокрема коли hostId відсутній

    ON compaction (any trigger):
        result = next(e)
        IF agentId present                          # компактизація субагента — не основна розмова
           OR trigger = precompute                  # нічого не встановлює; стоїть лише при використанні через manual/auto
           OR instructions IN (MARKER, HANDOFF_MARKER)   # власну межу пишуть HandleCompaction і HandleSeed, за будь-якого trigger
           OR result is skip: RETURN result
        RecordBoundary(result.messages); RETURN result

    FUNCTION CurrentRows():
        await the hostId promise                   # шлях інструментів і промптів: очікування дозволене
        transcript = read main conversation rows (the whole transcript, ≤ ROW_WINDOW newest)
        b = read Boundary; IF absent or unreadable: RETURN transcript
        IF NOT Trusted(b): RETURN transcript       # інший процес або /resume у цьому: читання — завантажений ланцюжок, який і бачить модель
        p = the largest index such that fingerprint(transcript[p + k]) = b.head[k] for every k < len(b.head)
            AND len(transcript) - p ≥ b.count
        IF none: RETURN transcript                  # межа поза вікном ROW_WINDOW або відбитки не збіглися
        RETURN transcript[p ..]

    FUNCTION BoundaryAt(transcript, head, count):  # спільний пошук для CurrentRows і CheckSeeded (SP_CTX_02_24)
        RETURN the largest p as above, or none

    FUNCTION Key(): await the hostId promise; b = read Boundary (one read); session_id + (b present AND Trusted(b) ? raw text of b : "")
    context_list with count ≥ 1: listedKey = Key(), once the listing is built (a failed listing or count 0 renews nothing)
    BlockReport of a tool close (SP_CTX_02_29): listedKey = Key() read before the rows it lists   # промпт ходу оптимізації і порада з промптом людини індексів не мають і ключа не оновлюють
    context_edit, context_tag: index targets are refused (SP_CTX_02_03, SP_CTX_02_11) when listedKey ≠ Key()

Без межі, без довіри або без збігу результат — увесь транскрипт: так само, як до запису межі. Довіра — збіг `host` межі з ідентичністю процесу хоста цього екземпляра або межа, яку записав сам цей екземпляр ([SP_CTX_DEC_10](#SP_CTX_DEC_10)). У тому самому процесі, поки сесію в ньому не перемикали (зокрема після гарячого перезавантаження модуля), читання — це оригінали плюс копії, і межа збігається в правильному місці. В іншому процесі (перезапуск, `--resume`) і після `/resume` у тому самому процесі читання — завантажений ланцюжок, тобто саме те, що бачить модель, і весь транскрипт правильний (спайк context_editor_handoff_long, Entry 6; навичка plugin-hooks, пункт 7); тому при перемиканні сесії в процесі мод знімає `host` з межі нової сесії, якщо ту межу записав цей процес. Запасний шлях без `hostId` (власна межа екземпляра) нічого не втрачає порівняно з колишнім прапорцем у пам'яті. Межа засіяної сесії, яку пише HandleSeed, несе `host` і стає власною межею екземпляра: засів іде в тому самому процесі, а підготовка сховища нової сесії передує засіву. Власна компактизація мода — команда з `trigger: 'manual'`, як і `/compact` людини; їх розрізняє лише `instructions`, тож спостерігач пропускає саме MARKER і HANDOFF_MARKER, а `/compact` людини з будь-яким іншим текстом (або без нього) записує межу з рядків, які повернула вбудована компактизація. У засіяній сесії межу записує HandleSeed ([SP_CTX_02_26](#SP_CTX_02_26)) уже в сховище нової сесії: перед засіяними рядками в транскрипті стоять лише рядки команди очищення, і CurrentRows їх відрізає. Межа міняється між переліком і правкою, коли компактизація (мода, `/compact` або автоматична, зокрема посеред ходу) пройшла після `context_list`: тоді індекси, які тримає агент, називають інші рядки, і правки та теги за індексом відхиляються до нового переліку; цілі за `tool_use_id` і `ref` від індексів не залежать. Ключ пам'ятає лише останній перелік: індекси зі сторінки, отриманої до компактизації, після нового переліку іншої сторінки проходять цю перевірку; такі правки ловить лише пошук якорів при застосуванні (Locate). Межа записується до того, як хост прийме повернений список: якщо зовнішній хук іншого плагіна відкине або перепише результат, голова може не знайтися, і CurrentRows поверне весь транскрипт. Індекси переліку, перевірка правок, теги, закріплення й лічильник активних `review` працюють на поточній розмові, тож індекс з переліку відповідає позиції рядка в `e.messages` наступної компактизації.

### 02_19. context_handoff  {#SP_CTX_02_19}

Purpose: інструмент агента; ставить запит передачі розмови в нову сесію ([C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11)).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| mode | `transcript` \| `document` | no | типово `transcript` |
| document | string | no | ≤ MAX_DOCUMENT; запасний документ для `transcript`, основний для `document` |
| resume | bool | no | типово true |
| resume_prompt | string | no | ≤ MAX_TEXT |

Output: `Handoff queued (<mode>): it runs when this turn ends. End your turn now with a one-line status.` Після запису запиту `requestTurn = turns` ([SP_CTX_01_15](#SP_CTX_01_15)). Новий запит замінює попередній у стані `queued`; правки, вже поставлені в чергу, застосує передача.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT | виклик із субагента | передає лише основна розмова |
| DENIED_STORAGE | сховище `unavailable` | причина в повідомленні |
| DENIED_BAD_MODE | `mode` не з двох значень | — |
| DENIED_TOO_LONG | `document` > MAX_DOCUMENT або `resume_prompt` > MAX_TEXT | скоротити |
| DENIED_RUNNING | `handoffInFlight`, або запит у стані `running`, який не покинутий за `Due` ([SP_CTX_01_15](#SP_CTX_01_15)) | дочекатися кінця передачі; запит не замінюється |
| DENIED_QUEUE | Queue `unreadable` або не записалась | причина в повідомленні |

### 02_20. HandoffCommand  {#SP_CTX_02_20}

Purpose: команда людини `/handoff [document|cancel]` — те саме, що інструмент, без ходу агента; `cancel` знімає запит, що ще не почався, або запит `running`, який цей екземпляр модуля не веде (зокрема лишений після невдалого запису старої черги).

Processing logic (pseudocode):
    ON command handoff (args):
        IF args trimmed = "cancel": drop a queued request, or a running one while handoffInFlight = false (SP_CTX_04_04); RETURN text "handoff cancelled" or "no handoff waiting"
        mode = args trimmed = "document" ? document : transcript
        write Queue.handoff = { mode, resume: true, resumePrompt: DEFAULT_RESUME, by: person, state: queued, at: now }   # помилки — як у 02_19, зокрема DENIED_RUNNING
        Schedule()                                  # SP_CTX_02_21: знімок turns0 і HANDOFF_DELAY; no-op, поки handoffInFlight
        RETURN text "handoff (<mode>) starts"

Команда не позначається `immediate`: під час ходу вона чекає його кінця, як вбудовані команди. Відповіді команди (`text`) не починаються з `context-editor:`: хост сам показує їх під назвою плагіна (у stream-json — з префіксом плагіна), і префікс мода повторився б; помилки з [SP_CTX_02_19](#SP_CTX_02_19) повертаються тим самим текстом без префікса. Обробник команди — подія, на яку не чекає жоден хід, тож відкладена дія з нього має походження, яке хост ставить у чергу (преамбула розділу 02); це підтверджує обов'язковий сценарій «Команда людини» в обох хостах ([SP_CTX_05_03](#SP_CTX_05_03)).

### 02_21. RunHandoff  {#SP_CTX_02_21}

> **Criticality:** core

Purpose: виконати запит передачі. Для `transcript` — зібрати засів у старій сесії, очистити сесію вбудованою командою `/clear` і засіяти нову власною компактизацією з HANDOFF_MARKER ([C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11), S); для `document` або коли засів не зібрався — передати документ першим промптом очищеної сесії. Засів спирається лише на вбудовані команди `/clear` і `/compact`, тож розрахований і на інтерактивний термінал, і на неінтерактивний хост з потоковим входом (stream-json: розширення VS Code, SDK streaming), де команди відновлення сесії немає. Спосіб `document` без документа агента додатково спирається на окремий запит до моделі (`$.model.fork`), перевірений лише в терміналі; у stream-json його підтверджує обов'язковий сценарій «Запасний шлях до очищення» ([SP_CTX_05_03](#SP_CTX_05_03)).

Логіка — чиста функція за портом HandoffIO: читання й запис черги сесії за каталогом, рядки й API-подання, реєстр тегів, сховище нової сесії, запис і видалення файлів, команда хоста (`clear`, `compact`), відмова якої несе текст хоста, окремий запит до моделі, відправка промпту, спливне повідомлення, засів у пам'яті модуля.

Processing logic (pseudocode):
    # turns, inTurn — лічильник ходів з преамбули розділу 02; handoffInFlight, handoffScheduled, instance, Due — SP_CTX_01_15
    ON turn complete (main loop), after inTurn = false:
        IF aborted AND Queue.handoff.by = agent AND requestTurn = turns: drop it (SP_CTX_04_04)   # запит агента з цього ходу
        ELSE IF Due(Queue): Schedule()                                      # і після перерваного ходу, що відклав передачу

    FUNCTION Schedule():
        IF handoffInFlight OR handoffScheduled: RETURN                      # другий запуск посеред першого неможливий
        handoffScheduled = true; turns0 = turns
        after HANDOFF_DELAY:                                                # відкладена дія з turn.complete або з обробника /handoff
            handoffScheduled = false                                        # до RunHandoff і до повторного Schedule
            outcome = RunHandoff(turns0); ON any exception: toast "context-editor: handoff failed: <error>"; outcome = failed
            IF outcome = deferred AND NOT inTurn: Schedule()                # хід, що відклав передачу, уже скінчився: інший кінець ходу її не запустить

    Moved() = MovedSince(turns0)                                           # хід ішов або почався від планування
    MovedSince(t) = inTurn OR turns ≠ t

    Outcome = deferred | nothing | failed | transcript | document          # результат RunHandoff

    FUNCTION RunHandoff(turns0) → Outcome:
        handoffInFlight = true; cleared = false; turnsClear = none          # cleared — /clear уже створив нову сесію
        afterClearEntered = false; terminal = false; sessionChanged = false # terminal — запис HandedOff, Fail чи FailAfterClear удався
        seed: HandoffSeed? = none; seedReason: string? = none
        IF Moved(): RETURN deferred                                         # запит лишається queued
        old = session id; oldDir = storage of old (prepared)
        claim: on the queue chain, IF Due(q) ignoring handoffInFlight:
            IF state = running AND some <oldDir>/<id>/seed.json with id ≥ at exists:   # покинутий запуск дійшов до засіву і міг дійти до /clear
                handoff absent, report += "a previous handoff stopped after building <that file>; it is not re-run; ask again with /handoff or context_handoff"
                RETURN nothing
            state = running, at = now, owner = instance
        ELSE RETURN nothing
        h = the claimed request; reasons = []
        IF h.mode = transcript:
            (seed, seedReason) = PrepareSeed()                              # рівно одне з двох; лише стара сесія, без команд хоста
            IF seedReason: reasons += "transcript: " + seedReason; seed = none   # сесія як була — далі document
            ELSE IF Moved(): remove <oldDir>/<seed.id> and seed.archive; Defer(); RETURN deferred
            ELSE: RETURN Seed(seed)
        RETURN DocumentWay(reasons)
        ON any exception after the claim:                                   # запит ніколи не лишається running; жоден запис не повторюється
            pending seed = none
            IF NOT cleared:
                remove seed files of seed, if any
                IF NOT terminal: TRY Fail(reasons + "failed: <error>") CATCH: toast "context-editor: handoff failed: <error>; the old queue could not be written"
            ELSE IF seed present AND NOT afterClearEntered AND NOT sessionChanged:
                RETURN AfterClear(seed, "failed: <error>", turnsClear)        # AfterClear ніколи не кидає; при SESSION_CHANGED — лише FailAfterClear нижче (сесія не мода)
            ELSE IF NOT terminal:
                TRY FailAfterClear(seed, reasons + "failed: <error>") CATCH: toast "context-editor: handoff failed after /clear: <error>; the old queue could not be written"
            RETURN failed
        FINALLY: handoffInFlight = false                                    # на кожному виході: поверненні, винятку, deferred, nothing
                 IF cleared: status line = "<n> context edit(s) queued" from the current session's queue, or cleared when it is empty   # рядок стану старої сесії не лишається в новій

    FUNCTION PrepareSeed() → (HandoffSeed, none) | (none, reason):
        transcript = read main conversation rows; rows = CurrentRows(); api = read main conversation in Messages API form
        id = now; folder = <oldDir>/<id>; archive = <oldDir>/<id>.json
        batch = Queue.edits
        built = BuildSeed(transcript, rows, api, batch, TagRegistry, folder, archive)   # SP_CTX_02_22; пише медіа-файли
        IF built is a refusal: remove folder; RETURN built.reason
        IF CheckSeed(built.rows) gives a reason: remove folder; RETURN that reason           # SP_CTX_02_23
        IF built.report.originals not empty AND writing archive (compact JSON, host command) fails:
            remove folder; RETURN "the originals could not be archived"
        IF writing <folder>/seed.json (JSON list of rows, owner-only, host command) fails: remove folder and archive; RETURN "the seed could not be written"
        RETURN HandoffSeed { old, id, rows: built.rows, file: <folder>/seed.json, archive: (originals written ? archive : ""),
                             report: built.report, visible: built.visible, edits: batch,
                             fromSummary: built.fromSummary, unmatchedPromptMedia: built.unmatchedPromptMedia, carried: built.carried, taken: false }
        ON any exception: remove folder and archive; RETURN "failed: <error>"

    FUNCTION Seed(s):
        TRY run built-in command clear                                      # одна спроба; чекає, доки сесія вільна
        CATCH err: remove <oldDir>/<s.id> and s.archive; Fail(["transcript: /clear was refused: " + err]); RETURN failed
        new = session id
        IF new = old: remove <oldDir>/<s.id> and s.archive; Fail(["transcript: /clear did not start a new session"]); RETURN failed
        # процес уже в очищеній сесії; повернення в стару немає
        cleared = true; s.new = new
        turnsClear = turns                                                  # змінна RunHandoff; ходи після цієї точки — уже в новій сесії
        IF inTurn: RETURN AfterClear(s, "a turn began in the new session", turnsClear)          # TURN_IN_NEW
        IF turns ≠ turns0: RETURN AfterClear(s, "a turn ran before /clear; the seed would miss it", turnsClear)   # /clear чекав, доки хід скінчиться
        newDir = PrepareStorage for new (SP_CTX_02_15)
        IF unavailable: RETURN AfterClear(s, "the storage of the new session cannot be made: <reason>", turnsClear)
        pending seed = s                                                    # пам'ять модуля; HandleSeed віддає його рядки
        IF MovedSince(turnsClear): RETURN AfterClear(s, "a turn began in the new session", turnsClear)   # перевірка безпосередньо перед командою (SP_CTX_05_02)
        TRY run built-in command compact with args = HANDOFF_MARKER         # одна спроба; чекає, доки сесія вільна
        CATCH err: RETURN AfterClear(s, "the seed compaction was refused: " + err, turnsClear)
        IF session id ≠ new:                                                # людина могла відкрити іншу сесію
            sessionChanged = true; pending seed = none; FailAfterClear(s, ["transcript: the session changed during seeding"]); RETURN failed   # без другого /clear і без промпту; виняток тут — лише FailAfterClear обробника
        IF NOT s.taken: RETURN AfterClear(s, "the seed compaction did not take the seed", turnsClear)     # skip (зокрема хід у новій сесії), збій обробника або відповідь іншого обробника
        why = AwaitSeeded(s.rows, old, session id)                           # SP_CTX_02_24: опитування до SEED_WAIT (F2)
        IF why: RETURN AfterClear(s, "the host did not keep the seeded conversation: " + why, turnsClear)
        pending seed = none
        # засіяно: далі жодного переходу на інший спосіб, хоч би що впало; кожен крок нижче захищений тут же,
        # і обробник винятку RunHandoff не бачить жодного збою після цієї точки
        step HandedOff: HandedOff(new, transcript)                          # спершу: стара черга більше не тримає запит running
        step registries: done = [e IN s.edits | EditLabel(e) IN s.report.applied]   # EditLabel — опис правки, як у ApplyReport.applied
                         FOR reg IN (TagRegistry, AliasRegistry):                        # окремо для кожного, на ланцюжку реєстру в newDir
                             read reg from oldDir → transform → write into newDir (owner-only)   # реєстру в старій сесії немає — для нього нічого не пишеться, без речення
                             transform: tags — RebindTags(reg, before = s.visible, after = s.rows, done, batch = s.edits), with the stage marks and the state slot (SP_CTX_02_14), and introduced = false;
                                        aliases — pruning of changed and vanished pairs (SP_CTX_02_14)
                             # теги й псевдоніми змінених пар (FreshId) і пар, яких засів не містить, видаляються — так само, як після компактизації в тій самій сесії
                             a read or write failure, or a transform failure (then nothing is written): report += " Tags and aliases were not carried over." (once)
        step pin: IF s.fromSummary: PinSummary(newDir, s.rows[0])
        report = "context-editor: this session continues <old> (transcript)."
                 + (s.fromSummary ? " It starts from the summary of an earlier compaction; the rows before it stay in <old>." : "")
                 + (s.unmatchedPromptMedia > 0 ? " Media in <n> of the person's prompt(s) was not carried over." : "")
                 + pin note of PinSummary, if any
                 + (text ? "\n" + text : "")  WHERE text = FormatReport(s.report, s.archive, seed)   # SP_CTX_01_05; порожній — без переносу
        Deliver(report, h.resumePrompt, turnsClear, queueOnly = NOT h.resume)    # без продовження звіт чекає наступного промпту (DeliverReport)
        ON a failure of any step after seeding (caught here, the remaining steps still run):
            toast "context-editor: seeded the new session, but step <step> failed: <error>"
                  + (step = HandedOff ? " The old session <old> still holds a running handoff request; run /handoff cancel there." : "")
        RETURN transcript

    FUNCTION AfterClear(s, reason, turnsClear):                             # процес в очищеній сесії, стара — на диску без змін; ніколи не кидає
        afterClearEntered = true; pending seed = none; reasons = ["transcript: " + reason]
        # кожен крок нижче захищений тут же; збій кроку додає його назву до спливного повідомлення, решта кроків іде далі
        IF MovedSince(turnsClear):                                          # людина вже працює в новій сесії: її не чіпати
            step fail: FailAfterClear(s, reasons); step deliver: Deliver(notice(s, reasons), none, turnsClear, queueOnly = true)
            RETURN failed                                                   # notice — у чергу поточної сесії
        # другий /clear відхилено: `now` лишається засіяною сесією, і HandedOff та документ потрапляють у неї поверх засіву (прийнято)
        step clear: IF s.taken: TRY run built-in command clear CATCH err: reasons += "/clear: " + err   # прибрати засіяну сесію; без засіву вона й так порожня
        now = session id
        IF h.document present:
            step handed: HandedOff(now, document)
            step deliver: Deliver(h.document + "\n\ncontext-editor: this session continues <old> (document). The transcript way failed (" + reasons + ")." + dropped, h.resumePrompt, turnsClear, queueOnly = NOT h.resume)
            RETURN document
        step fail: FailAfterClear(s, reasons)
        step deliver: Deliver(notice(s, reasons), h.resumePrompt, turnsClear, queueOnly = NOT h.resume)
        RETURN failed
        ON a failure of any step (caught here): toast "context-editor: handoff after /clear: step <step> failed: <error>"

    notice(s, reasons) = "context-editor: the handoff from <old> failed after the session was cleared (" + reasons + "). The previous session <old> is unchanged." + (s present ? " The assembled conversation is in " + s.file + "." : "")

    FUNCTION Deliver(text, resumePrompt?, turnsClear, queueOnly = false):   # кожна відправка після /clear
        IF queueOnly OR MovedSince(turnsClear):                             # продовження вимкнено (h.resume = false) або людина активна
            Queue of the current session: report += text, reportId = now, reportResume = false   # DeliverReport віддасть з наступним промптом
        ELSE: submit prompt (text + (resumePrompt ? "\n\n" + resumePrompt : ""))

    FUNCTION PinSummary(dir, row):                                          # у реєстрі тегів нової сесії, на його послідовному ланцюжку
        reg = TagRegistry of dir; IF missing: reg = { tags: [], turn: 0, firstPromptPinned: false, introduced: false }
        IF reg unreadable: RETURN note " The summary row was not pinned: the tag registry is unreadable."
        IF the target already has a tag: replace it; ELSE IF len(reg.tags) = MAX_TAGS: RETURN note " The summary row was not pinned: the tag registry is full."
        put Tag { kind: pin, target: { anchor: fingerprint(row), hint: 0 }, created_turn: reg.turn }; firstPromptPinned = true
        write; IF the write fails: RETURN note " The summary row was not pinned: the tag registry could not be written."

    FUNCTION DocumentWay(reasons):
        doc = h.document OR model fork over the session with HANDOFF_PROMPT (no tools); a fork error adds "document: model fork failed: <error>" to reasons
        IF doc empty: Fail(reasons + "document: no handoff document"); RETURN failed
        IF Moved(): Defer(); RETURN deferred
        TRY run built-in command clear CATCH err: Fail(reasons + "document: /clear was refused: " + err); RETURN failed
        IF session id = old: Fail(reasons + "document: /clear did not start a new session"); RETURN failed
        cleared = true; turnsClear = turns
        why = reasons not empty ? " The transcript way failed (" + reasons + ")." : ""
        IF turns ≠ turns0: why += " A turn ran before /clear; it stays in <old> and is not in this document."   # /clear чекав кінця ходу
        new = session id; HandedOff(new, document)                         # стара черга — до промпту
        Deliver(doc + "\n\ncontext-editor: this session continues <old> (document)." + why + dropped, h.resumePrompt, turnsClear, queueOnly = NOT h.resume)
        RETURN document

    FUNCTION HandedOff(to, mode): old Queue: edits = [], handoff absent, report += "this session was handed off to <to> (<mode>)", reportId = now, reportResume = false; terminal = true
    FUNCTION Defer(): old Queue: handoff.state = queued, owner removed     # знову після наступного кінця ходу
    FUNCTION Fail(reasons): old Queue: handoff absent, report += "handoff failed: <reasons>; the session was not changed", reportId = now, reportResume = false; terminal = true; toast
    FUNCTION FailAfterClear(s?, reasons): old Queue: handoff absent, report += "handoff failed after the session was cleared: <reasons>; this session was not changed" + (s present ? "; the assembled conversation is in <s.file>" : ""), reportId = now, reportResume = false; terminal = true; toast
    # terminal ставиться лише після вдалого запису; у межах одного запуску жоден з трьох записів не робиться двічі

`dropped` = ` The <n> queued edit(s) were not carried over.`, коли черга мала правки. Причина з відмови команди хоста несе текст винятку хоста дослівно: мод ніколи не ковтає відмову `/clear` чи `/compact` ([C_CTX_DEC_13](./context_editor.concept.md#C_CTX_DEC_13)). Відправка промпту, відхилена хостом (виняток або `drop`), дає спливне повідомлення з текстом відмови хоста і не кидає винятку далі: результат лишається `transcript` (REPORT_LOST) або `document`.

Порядок має значення. Засів збирається і пишеться до очищення сесії: після `/clear` читання розмови й API-подання бачать уже нову, порожню сесію, а окремий запит до моделі над старою розмовою неможливий. Тому збій збирання веде до способу `document` у старій сесії, а збій після очищення — до повторного очищення (лише коли засів уже взято) і документа агента, а без нього — повідомлення з ідентифікатором старої сесії і шляхом до файлу засіву. Правки черги старої сесії при `Fail` і `FailAfterClear` лишаються в її черзі: стара сесія не змінена, і її можна відновити; при `HandedOff` вони йдуть у засів або, для `document`, не переносяться (`dropped`).

Ідентифікатор нової сесії до `/clear` невідомий, тож файл засіву, архів оригіналів і перенесене медіа лежать у сховищі старої сесії ([SP_CTX_DEC_09](#SP_CTX_DEC_09)); їхні шляхи вписано в текст засіяних рядків. Засів живе в пам'яті модуля: перезавантаження модуля між `/clear` і компактизацією засіву лишає нову сесію порожньою, а запит у старій черзі — у стані `running`; новий екземпляр, у якого `handoffInFlight = false`, вважає його належним через HANDOFF_STALE ([SP_CTX_01_15](#SP_CTX_01_15), [SP_CTX_05_04](#SP_CTX_05_04)). Поки RunHandoff цього екземпляра йде, запит не належний, хоч би скільки `/clear` чекав кінця довгого ходу; будь-який виняток RunHandoff до засіву закінчується Fail, AfterClear або FailAfterClear, а збої після засіву Seed перехоплює сам (спливне повідомлення називає крок), тож запит не лишається `running`, хіба що не вдався сам запис старої черги. Теги й псевдоніми копіюються і одразу проходять ті самі RebindTags і очищення псевдонімів, що й після компактизації в тій самій сесії ([SP_CTX_02_14](#SP_CTX_02_14)): незмінені засіяні пари зберігають ідентифікатори викликів старої сесії ([SP_CTX_01_17](#SP_CTX_01_17)), тож їхні теги й псевдоніми працюють далі; змінені пари отримали FreshId, і їхні теги й псевдоніми видаляються, тож `ref` такої пари в новій сесії дає UNKNOWN_REF, а не TARGET_NOT_FOUND.

Етапи, слот стану й інструкція в новій сесії. Відкритий етап і останній закритий блок переходять у реєстр нової сесії з межами, перенесеними RelocateMark з `s.visible` на `s.rows` ([SP_CTX_02_14](#SP_CTX_02_14)): межа, чий рядок замінила правка засіву, переходить на останній створений нею рядок; рядок, що лишився до підсумку (`fromSummary`), має `lost` у «до» і дає `null`; рядок, змінений засівом (CarryNote, `s.carried`) або прибраний нормалізацією, — найближчий попередній незмінений засіяний рядок або `null`. Тег `state` незміненого рядка переходить за відбитком; переписаний правкою засіву — за правилом слоту стану. `introduced` у копії — `false`: нова сесія — інший ідентифікатор, а прихований контекст першого промпту старої сесії в засіяні рядки не потрапляє, тож інструкцію отримає перший промпт нової сесії, що проходить хуки мода ([SP_CTX_02_27](#SP_CTX_02_27)); власні промпти мода (продовження після засіву, документ) хуків не проходять (F1). Журнал ефекту не переноситься: він лишається у сховищі старої сесії разом з архівами, які називає. Способом `document` реєстрів у новій сесії немає, тож `introduced` там теж `false`.

Команди в черзі хоста. Кожна команда (`/clear`, `/compact HANDOFF_MARKER`, друге `/clear` в AfterClear) — одна спроба: відмова остаточна, її текст іде в причину. Команда, запущена, поки триває хід, чекає його кінця, тож лічильник ходів звіряється після кожної команди. Хід між плануванням і першим `/clear` уже виконано в старій сесії, і засів його не містить — Seed переходить до AfterClear; у способі `document` такий хід лишається в старій сесії, а промпт це називає. Хід, що йде одразу після `/clear` (`inTurn`), або хід між `/clear` і компактизацією засіву відбувається в новій сесії: Seed чи HandleSeed ([SP_CTX_02_26](#SP_CTX_02_26)) відмовляють, і AfterClear за `MovedSince(turnsClear)` не очищає сесію вдруге. Кожен текст після `/clear` (звіт засіву, документ, повідомлення про збій) іде через Deliver: якщо людина вже почала хід, текст лягає у звіт черги поточної сесії з `reportResume = false`, і DeliverReport ([SP_CTX_02_08](#SP_CTX_02_08)) додасть його до її наступного промпту, а промпту мод не надсилає. Якщо після компактизації засіву сесія інша, ніж створив `/clear` (людина могла відкрити іншу сесію), мод не очищає її і нічого в неї не надсилає: лише звіт у черзі старої сесії. Залишкове вікно: хід, що почнеться між перевіркою `MovedSince(turnsClear)` в AfterClear і виконанням другого `/clear`, хост виконає в напівзасіяній сесії, і друге `/clear` його прибере; хід лишиться лише в транскрипті цієї сесії.

Закріплення підсумку. Коли засів починається з підсумку (`fromSummary`: голова з API-подання або перший рядок, що вже починався з SUMMARY_OPENER), у ньому, а не в першому промпті людини, лежить початкове завдання. R1 ([SP_CTX_01_11](#SP_CTX_01_11)) бачить лише нові рядки людини, а засіяні рядки подію додавання або оминають (термінал), або проходять з походженням плагіна, яке AutoTag пропускає (stream-json, [SP_CTX_02_12](#SP_CTX_02_12)); скинути `firstPromptPinned` недостатньо — R1 закріпив би наступний промпт людини, а не підсумок. Тому RunHandoff сам ставить `pin` на перший засіяний рядок у скопійованому реєстрі (PinSummary): один запис, без нового правила. Реєстру немає — PinSummary створює його; реєстр повний (MAX_TAGS) або нечитабельний — `pin` не ставиться, і звіт нової сесії це називає. Інакше скопійований `pin` першого промпту знаходить той самий рядок за відбитком.

Errors: відмови не виходять назовні — кожна причина потрапляє у звіт старої черги (`Fail`, `FailAfterClear`), у промпт нової сесії або веде до способу `document`.

| Code | Condition | Outcome |
|------|-----------|---------|
| SEED_REFUSED | BuildSeed або CheckSeed відмовили, архів чи файл засіву не записались, виняток під час збирання | файли засіву видалено; спосіб `document` у старій сесії |
| CLEAR_REFUSED | `/clear` відхилено або сесія не змінилась (обидва способи) | `Fail`: стара сесія без змін, правки лишаються в черзі |
| TURN_BEFORE_CLEAR | `/clear` чекав кінця ходу, що почався після планування | AfterClear з `a turn ran before /clear; the seed would miss it` |
| NEW_STORAGE | сховище нової сесії не створилось | AfterClear |
| SEED_COMPACT_REFUSED | команду компактизації засіву відхилено | AfterClear з текстом відмови хоста |
| SEED_NOT_TAKEN | обробник не взяв засів (`skip`, збій, інший обробник відповів) | AfterClear |
| SEED_NOT_KEPT | CheckSeeded знайшов розбіжність | AfterClear з причиною розбіжності |
| TURN_IN_NEW | хід іде одразу після `/clear` або почався в новій сесії до кінця засіву | FailAfterClear без повторного очищення; повідомлення про збій — у звіт черги поточної сесії (Deliver), без промпту |
| SESSION_CHANGED | після компактизації засіву поточна сесія — не та, що створив `/clear` | FailAfterClear без повторного очищення, без промпту і без запису в поточну сесію |
| PERSON_ACTIVE | людина почала хід до відправки звіту, документа чи повідомлення | текст — у звіт черги поточної сесії з `reportResume = false`; промпту немає |
| REPORT_LOST | після засіву звіт не доставлено | спливне повідомлення; результат передачі — `transcript` |

### 02_22. BuildSeed  {#SP_CTX_02_22}

Purpose: зібрати рядки нової сесії з того, що бачить модель, і правок черги ([C_CTX_DEC_12](./context_editor.concept.md#C_CTX_DEC_12), C). Чиста функція, крім запису медіа-файлів через порт. До 2026-10-09 — BuildTranscript, що збирав записи файлу сесії.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| transcript | list<Row> | yes | рядки, як їх повернуло читання розмови, ≤ ROW_WINDOW |
| rows | list<Row> | yes | CurrentRows ([SP_CTX_02_18](#SP_CTX_02_18)) — суфікс `transcript` |
| api | list<json> | yes | API-подання основної розмови, ≤ ROW_WINDOW повідомлень |
| edits | list<QueuedEdit> | yes | Queue.edits старої сесії, ≤ MAX_QUEUE_EDITS |
| tags | TagRegistry зі станом читання | yes | для перевірки `pin`, як у [SP_CTX_02_07](#SP_CTX_02_07) |
| folder | string | yes | `<old storage>/<id>` |
| archive | string | yes | `<old storage>/<id>.json` |
| writeMedia | функція (path, base64) → bool | yes | порт запису медіа-файлу, доступного лише власникові |

Output: `{ rows: list<Row>, report: ApplyReport, visible: list<Row>, fromSummary: bool, unmatchedPromptMedia: int, carried: list<string> }` або відмова з причиною; `visible` — рядки, передані в ApplyEdits; `carried` — результати з CarryNote.

Processing logic (pseudocode):
    FUNCTION BuildSeed(transcript, rows, api, edits, tags, folder, archive, writeMedia):
        (found, knownResults, unmatchedPromptMedia, apiTruncated) = CollectMedia(api, rows)   # SP_CTX_02_10
        hidden = some row of rows holds a tool result whose id is not in knownResults
                 OR some user row of rows other than rows[0] has text that, trimmed, starts with SUMMARY_OPENER   # підсумок посеред рядків — межа не записана
        early = []
        IF NOT hidden:                                                                     # модель бачить усі рядки
            IF rows = transcript (CurrentRows found no boundary) AND len(transcript) ≥ ROW_WINDOW:
                REFUSE "the conversation fills the host's 4096-row window; its start may be cut"
            head = none; visible = rows
        ELSE:                                                                              # після вбудованої компактизації, чию межу цей процес не записав
            IF apiTruncated OR len(transcript) ≥ ROW_WINDOW:                                # результат міг випасти з вікна читання, а не з погляду моделі
                REFUSE "the conversation fills the host's 4096-row window; its start may be cut"
            first = api[0]
            summary = the text blocks of first that are not reminder blocks, joined with "\n\n"   # content given as a string = one text block; reminder block: trimmed text starts with "<system-reminder>"
            IF first is not a user message OR first holds a tool_result block OR trimmed summary does not start with SUMMARY_OPENER:
                REFUSE "the model does not see every row, and what it sees does not start with a compaction summary"
            stripped(x) = x with every whitespace character removed
            k = min(160, len(stripped(summary)))
            s = the largest index such that rows[s] has role user, no toolResults,
                and stripped(rows[s].text) starts with the first k characters of stripped(summary)    # SP_CTX_DEC_08
            IF none: REFUSE "the summary the model sees was not found among the rows"
            visible = rows[s+1 ..]
            IF some row of visible holds a tool result whose id is not in knownResults: REFUSE "rows the model does not see follow the summary"
            head = Row { role: user, text: summary, toolUses: [] }
            FOR edit IN edits whose target lies in rows but not in visible:      # summarize, drop: call or result outside visible;
                early += "<edit>: the model no longer sees this row"; remove edit  # collapse, rewrite, describe: Locate finds the anchor in rows, not in visible
        (edits, refused) = screen edits for pin and state on visible (SP_CTX_02_07; registry unreadable → every edit "tag registry unreadable")
        n = 0; items = {}                                                                  # items[owner][k] — шлях k-го медіа власника або відсутній
        FOR owner IN found, FOR k, ref IN found[owner]:                                    # кожне медіа окремо
            IF ref.data absent: items[owner][k] = absent; CONTINUE
            n += 1; path = <folder>/<n>.<ext of ref.mediaType>                             # ext — як у SP_CTX_01_06
            IF NOT writeMedia(path, ref.data): REFUSE "media of <owner> could not be archived"
            items[owner][k] = path
        media = for each owner, the present paths of items[owner] in order                 # вхід ApplyEdits: шляхи для mediaNote
        (seed, report) = ApplyEdits(visible, edits, archive, media, mediaOwners = ∅, knownResults, unmatchedPromptMedia, apiTruncated)   # SP_CTX_02_04
        report.failed = early + refused + report.failed
        seed = DropOwnCalls(seed, ∅, knownResults)                                         # зокрема виклик context_handoff
        report.charsAfter = Σ size(seed)                                                   # тут: «звільнено» рахує лише правки, без CarryNote і голови
        replaced = owners whose media the edits in report.applied replace
        FOR each tool result t in seed whose owner {t.tool_use_id} is in found and not in replaced:
            t.text = t.text + (t.text blank ? "" : "\n\n") + CarryNote(found[owner], items[owner])
        seed = every row of seed rebuilt without handle                                    # handle старої сесії після /clear хост мовчки ігнорує
        IF head present: seed = [head] + seed
        IF seed[0] has role user AND seed[0].text has a line that holds TRANSCRIPT_LINE: remove every such line, then trim seed[0].text
        UNTIL nothing changes: drop leading assistant rows; drop tool results whose call is in no earlier row;
                               drop calls whose result is in no later row; drop rows without text, calls and results
        seed = MergeCallRows(seed)                                                         # SP_CTX_02_04: жоден засіяний рядок не має handle — паралельні виклики однієї відповіді одним рядком (Verify фази 14, D1)
        IF seed empty: REFUSE "no rows to carry over"
        report.produced = Produced(seed, applied steps)               # після голови і нормалізації: індекси засіяних рядків
        IF len(seed) > ROW_WINDOW − SEED_ROOM: REFUSE "the seed has <n> rows; at most ROW_WINDOW − SEED_ROOM fit the new session's read window"
        report.mediaFiles = every present path in items; carried = tool_use_id of every result that got CarryNote
        RETURN seed, report, fromSummary = (head present OR trimmed text of seed[0] starts with SUMMARY_OPENER), unmatchedPromptMedia, carried   # F5

    CarryNote(refs, paths) = MARK + " media carried as files (open them with Read): " + one item per k, joined ", ":
        paths[k] present → "<refs[k].mediaType> <paths[k]>"; paths[k] absent (refs[k] without inline data) → "<refs[k].mediaType> (not carried: no inline data)"

Голова — підсумок вбудованої компактизації, перше повідомлення API-подання. Вміст повідомлення API-подання, заданий рядком, — один текстовий блок з цим текстом. Результат поза API-поданням означає «модель цього рядка не бачить» лише тоді, коли жодне з вікон читання не заповнене: рядки, що випали за межу ROW_WINDOW, модель ще може бачити, тож за заповненого вікна засів відмовляє (WINDOW_FULL). Блок-нагадування — текстовий блок, обрізаний текст якого починається з `<system-reminder>`. `mediaOwners = ∅` у виклику ApplyEdits: усе медіа засіяних рядків уже лежить файлами, а засіяний рядок ніде не зберігає `handle`, тож правила ApplyEdits, що бережуть незаархівоване медіа сусідніх пар, тут не потрібні; шляхи замінених пар потрапляють у текст правки (`(media: …)`), як при компактизації. Медіа в промптах людини не переноситься, доки відкрите [SP_CTX_DEC_06](#SP_CTX_DEC_06): його кількість (`unmatchedPromptMedia`) називає звіт нової сесії. Thinking-блоки не переносяться: рядок без `handle` хост будує лише з тексту і блоків інструментів. Нагадування хоста (`<system-reminder>`) і повторно вкладені вбудованою компактизацією файли до засіву не потрапляють: голова — лише текст підсумку, а рядки беруться з транскрипту, не з API-подання. Рядки команд (`/compact`, «Compacted») поточної розмови засіваються як звичайні рядки людини.

Errors (кожна — відмова з причиною, RunHandoff переходить на `document`):
| Code | Condition |
|------|-----------|
| WINDOW_FULL | модель бачить усі рядки, CurrentRows не знайшов межі, а читання повернуло ROW_WINDOW рядків; або є результат поза API-поданням, а читання розмови повернуло ROW_WINDOW рядків чи API-подання обрізане (`apiTruncated`, ≥ ROW_WINDOW − 1 повідомлень) |
| NO_SUMMARY | модель бачить не всі рядки, а перше повідомлення API-подання — не текст людини, що починається з SUMMARY_OPENER |
| SUMMARY_NOT_FOUND | у рядках немає рядка людини з початком підсумку |
| HIDDEN_AFTER_SUMMARY | після знайденого підсумку є результат, якого немає в API-поданні |
| MEDIA_NOT_ARCHIVED | медіа з вбудованими даними не записалось у файл |
| EMPTY | після нормалізації не лишилось рядків |
| SEED_TOO_LONG | засів довший за ROW_WINDOW − SEED_ROOM рядків: разом з рядками `/clear` і команди компактизації він не вмістився б у вікно читання нової сесії, і CheckSeeded не знайшов би межі |

### 02_23. CheckSeed  {#SP_CTX_02_23}

Purpose: відкинути засів, який хост прийняв би, але модель отримала б зіпсовану розмову або API відхилив би запит ([C_CTX_DEC_13](./context_editor.concept.md#C_CTX_DEC_13), перевірка перед засівом). Чиста функція; повертає першу порушену умову як причину або «гаразд». До 2026-10-09 — CheckTranscript.

Rules (`i` — індекс рядка засіву):
| Rule | Reason |
|------|--------|
| рядків ≥ 1 | `no rows to carry over` |
| перший рядок має роль `user` | `the first row is not the person's` |
| жоден рядок не має `handle` | `row <i>: holds a handle` |
| у кожному рядку є текст, виклик або результат | `row <i>: empty` |
| виклики лише в рядках `assistant`, результати лише в рядках `user` | `row <i>: tool_use in a user row` / `row <i>: tool_result in an assistant row` |
| ідентифікатори викликів унікальні; ідентифікатори результатів унікальні | `row <i>: repeated call id <id>` / `row <i>: repeated result id <id>` |
| кожен виклик має результат з тим самим ідентифікатором у пізнішому рядку, і між ними немає рядка `user` без результатів | `row <i>: call <id> has no result before the next prompt` |
| кожен результат відповідає виклику з ранішого рядка | `row <i>: result <id> answers no call` |

Рядки однієї ролі поспіль допустимі: засів зберігає форму рядків, у якій хост віддає їх обробнику компактизації і приймає назад при кожному застосуванні правок; BuildSeed рядків не зливає.

### 02_24. CheckSeeded  {#SP_CTX_02_24}

Purpose: після компактизації засіву переконатися, що хост тримає саме засіяну розмову ([C_CTX_DEC_13](./context_editor.concept.md#C_CTX_DEC_13), A). Чиста функція; повертає причину або «гаразд». До 2026-10-09 — CheckSwitched.

Input: `seed: list<Row>` (HandoffSeed.rows), `read: list<Row>` (рядки, прочитані в новій сесії після команди, увесь транскрипт), `old`, `now` — ідентифікатори старої і поточної сесії.

Logic (перша порушена умова — причина):
- `now ≠ old`, інакше `the session id did not change`;
- `p = BoundaryAt(read, head = fingerprints of seed[0 .. min(len(seed), HEAD_ROWS)), count = len(seed))` ([SP_CTX_02_18](#SP_CTX_02_18)); немає — `the seeded rows were not found`;
- текст `read[p]` — першого рядка після межі — містить перші SEED_PROBE символів тексту `seed[0]`, якщо той непорожній; інакше `the first row after the boundary is not the seeded one`;
- кожен ідентифікатор виклику з `seed` є серед викликів `read[p ..]`; інакше `seeded call <id> is missing`.

Очікування рядків. У неінтерактивному хості `$.command.run('compact')` завершується після відповіді обробника, але ще до того, як повернені рядки з'являються в читанні розмови (приблизно через 50 мс); у терміналі вони вже є на момент завершення (Verify фази 10, 2026-10-09, F2). Тому RunHandoff перевіряє засів через AwaitSeeded:

    FUNCTION AwaitSeeded(seed, old, now):
        deadline = clock + SEED_WAIT
        LOOP:
            why = CheckSeeded(seed, read main conversation rows, old, now)
            IF why absent OR clock ≥ deadline: RETURN why                   # остання причина — SEED_NOT_KEPT
            wait SEED_POLL

Інших читань рядків одразу після компактизації мода немає: Flush читає лише чергу, записану до відповіді обробника; межу записують HandleCompaction і HandleSeed з рядків, які вони самі повертають, а спостерігач [SP_CTX_02_18](#SP_CTX_02_18) — з результату `next`, не з читання.

Рядки перед `p` — рядки команди очищення, рядки після засіяних — рядки команди компактизації з HANDOFF_MARKER; перевірку вони не зачіпають. Повернені рядки стоять у наступному читанні суцільним блоком з тими самими відбитками (навичка plugin-hooks, пункт 13), тож межа знаходиться тим самим пошуком, що й у CurrentRows.

### 02_25. ScrubCommandRows (вилучено)  {#SP_CTX_02_25}

Вилучено 2026-10-09: у терміналі рядки команди, яку запускає мод, і копії після межі компактизації пишуться у файл сесії повз подію додавання рядка, тож переписати мітку там неможливо (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 4, «Мітка в рядках команди»; навичка plugin-hooks, пункт 24). Рядки команди лишаються з міткою; MARKER і HANDOFF_MARKER — самопояснювальні тексти ([SP_CTX_01_12](#SP_CTX_01_12)), а інваріант [SP_CTX_05_02](#SP_CTX_05_02) перевіряє, що обробник бачить ту саму мітку як `instructions`.

### 02_26. HandleSeed  {#SP_CTX_02_26}

> **Criticality:** core

Purpose: гілка обробника компактизації для HANDOFF_MARKER ([SP_CTX_02_07](#SP_CTX_02_07)): повернути засіяні рядки замість розмови щойно очищеної сесії.

Input: `messages: list<Row>` події компактизації; засів у пам'яті модуля (HandoffSeed або нічого); поточний ідентифікатор сесії.

Processing logic (pseudocode):
    FUNCTION HandleSeed(messages):
        s = pending seed; IF absent: RETURN skip "no handoff seed waiting"
        IF session id ≠ s.new: RETURN skip "this is not the session the handoff created"   # зокрема стара сесія; мод не пише в сесію, якої не створив
        IF messages hold a row with role assistant: RETURN skip "the new session already has a turn"
        s.taken = true
        RecordBoundary(s.rows)                       # SP_CTX_02_18, у сховище нової сесії; збій запису не зупиняє засіву
        RETURN { messages: s.rows }

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| SKIP_NO_SEED | засіву в пам'яті немає (команду ввела людина, модуль перезавантажено) | розмова не змінюється |
| SKIP_NOT_CLEARED | поточна сесія — не `s.new` (стара або інша, яку відкрила людина) | розмова не змінюється, мод нічого в неї не пише; RunHandoff — AfterClear або SESSION_CHANGED |
| SKIP_TURN_STARTED | у новій сесії вже є рядок агента | розмова не змінюється; RunHandoff не очищає сесію вдруге |
| SKIP_SEED_FAILED | обробник впав | `skip` одразу ([SP_CTX_02_07](#SP_CTX_02_07)); RunHandoff — AfterClear |

Обробник не читає і не пише черги: засів не стосується черги нової сесії. Після очищення вхід компактизації — лише рядки команди `/clear` (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 2), тож повернений список заміняє їх, а відновлення нової сесії бачить саме засіяні рядки: перед межею у файлі сесії немає нічого, крім команди очищення ([C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05) тут не діє).

### 02_27. SessionIntro  {#SP_CTX_02_27}

Purpose: на початку кожної сесії сказати агенту, що він може позначати етапи, просити оптимізацію міткою і бачити телеметрію, без нагадувань за розміром ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15); [SP_CTX_DEC_11](#SP_CTX_DEC_11)): коротка інструкція прихованим контекстом першого промпту і навичка мода з повним посібником.

Processing logic (pseudocode):
    # частина хука prompt.submit DeliverReport (SP_CTX_02_08)
    ON prompt submitted (main conversation, passes the mod's hooks):
        IF storage ready AND TagRegistry state IN (ok, missing) AND introduced = false:
            add INTRO_TEXT as hidden context, before the report
            once the prompt entered (no drop): on the registry chain, re-read TagRegistry; IF not unreadable: introduced = true; write (missing → a new registry with defaults)

Прапорець `introduced` живе в реєстрі тегів сесії ([SP_CTX_01_10](#SP_CTX_01_10)), тож перезавантаження модуля інструкції не повторює. Сесія — за ідентифікатором: після `/clear` чи `/resume` у тому самому процесі сховище інше (PrepareStorage, [SP_CTX_02_15](#SP_CTX_02_15)), і перший промпт нової сесії отримує інструкцію знову; відновлена `/resume` сесія, що вже мала інструкцію, має `introduced = true` і повтору не отримує. Передача копіює реєстр з `introduced = false` ([SP_CTX_02_21](#SP_CTX_02_21)). Промпти, які мод надсилає сам (продовження, хід оптимізації, Deliver передачі), хука не проходять (F1), тож інструкцію несе перший промпт людини або іншого розширення. Сховище недоступне або реєстр `unreadable` — інструкції немає: інструменти тоді й так відмовляють, а доставку нема де записати.

Навичка мода. Файл `mods/context-editor/skills/<SKILL>/SKILL.md` поруч із `hooks/`; агент бачить її в переліку навичок як `context-editor:<SKILL>` з описом із frontmatter і відкриває повний текст сам (навичка plugin-hooks, пункт 39). Вимоги до файлу:

| Part | Requirement |
|------|-------------|
| frontmatter `name` | дорівнює SKILL |
| frontmatter `description` | одне речення англійською, ≤ 250 символів: коли відкривати навичку — довга або багатоетапна задача з модом context-editor, рішення про етапи, стискання блоку, мітку, телеметрію |
| розділ «Stages» | коли відкривати етап (початок логічного блоку роботи: фаза, підзадача, дослідження) і закривати (блок завершено, результат відомий); етапи пласкі, `open` закриває поточний; `open` з `index`; `open` з `index` + `close` для блоку, який не відкривали |
| розділ «Compressing a block» | одна `context_edit` на блок; шаблон запису етапу (мета; рішення з причиною і словами людини; перевірені факти з джерелами — шляхи, рядки, версії; змінені артефакти; відкриті питання — пропозиція P5); що зазвичай лишається дослівно ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04)); відтворюване (`~`: Read, Grep, Glob) — вказівник «що, де, що знайдено — перечитати за потреби», невідтворюване (відповіді людини, живі проби, звіти субагентів, веб-вміст) — обережний підсумок або без змін (пропозиція P2); медіа — описом, якщо завдання дозволяє |
| розділ «Dead ends» | `disposable` з нотаткою на діапазон `index`..`to` у мить відмови від гілки (пропозиція P4) |
| розділ «Optimization mark» | OPTIMIZE_MARK дослівно; ставити окремим останнім рядком фінальної відповіді ходу (посеред тексту чи з іншим текстом у рядку вона не діє), коли агент завершує хід для людини, а посеред роботи — закривати етап інструментом; у ході оптимізації взяти діапазон з рядка `Last block #a..#b` заголовка `context_list` і перелічити рядки від `from = a` перед правками за індексом; хід оптимізації — звичайний хід, заміни з тегів ставляться на кінці ходу з міткою, після оптимізації зазвичай зупинитися (`resume: false`); мітка в ході оптимізації не діє |
| розділ «Telemetry» | `context_list` з `count: 0`; що означають рядки TelemetryText ([SP_CTX_02_28](#SP_CTX_02_28)); рішення — за логічним станом роботи, а не за розміром; вбудована компактизація хоста — запобіжник |
| розділ «Candidates» | причини `review`: `big`, `search`, `stale`, `duplicate`, `agent` ([SP_CTX_01_09](#SP_CTX_01_09)) і що з ними робити |
| розділ «Restoring an original» | оригінал читається `Read` за шляхом `(original: …)` у заміні ([C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)); журнал ефекту рахує такі читання |
| розділ «State slot» | один власний текстовий рядок з тегом `state`; оновлювати `rewrite` на місці, не дописувати новий стан у кінець ([C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)) |
| розмір | ≤ 8000 символів разом із frontmatter; мова — англійська, як у всіх текстах для агента |

Формулювання розділів пише план; специфікація задає обов'язкові частини, межу розміру і те, що INTRO_TEXT називає навичку як `context-editor:<SKILL>`. Файл перевіряє `claude plugin validate` (валідатор приймає теку `skills/`, пункт 39).

Errors: відмов немає — інструкція або додається, або ні; збій запису `introduced` — INTRO_NOT_RECORDED ([SP_CTX_02_08](#SP_CTX_02_08)).

### 02_28. Telemetry  {#SP_CTX_02_28}

Purpose: обчислити телеметрію контексту ([SP_CTX_01_20](#SP_CTX_01_20)) на запит агента — у заголовку перегляду (і окремо, з `count: 0`) та у звіті закриття етапу інструментом — і ніколи після звичайного виклику інструменту ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)).

Input: `rows` — поточна розмова; `reg` — TagRegistry; `journal` — Journal зі станом читання; порт `usage(breakdown)` — `$.session.usage({ breakdown: 'summary' })`.

Processing logic (pseudocode):
    FUNCTION Telemetry(rows, reg, journal):
        TRY u = usage(summary)                          # 23–87 мс, без запитів до API (навичка plugin-hooks, пункт 37)
        CATCH err: u = none; t.measure = unavailable; t.error = err text   # частини розміру нижче пропускаються, решта рахується
        IF u present:
            b = u.context.breakdown
            IF u.context.tokens absent OR (b present AND b.apiUsage = null): t.measure = unknown   # моделі ще не відповідали в живому вікні
            ELSE IF b present AND some category c of b has kind = used AND name = MESSAGES_ROW AND b.totalTokens − c.tokens <= u.context.tokens:   # після /compact хоста розбивка завищує незмінну частину понад весь запит і урізає MESSAGES_ROW (Verify фази 14, D2); сума понад запит сама по собі нормальна — оцінка рядків після останньої відповіді (рев'ю 36)
                t.measure = messages; t.conversation = c.tokens; t.fixed = max(0, b.totalTokens − c.tokens)
            ELSE: t.measure = request; t.request = u.context.tokens      # незмінна частина всередині
            t.window = b ? b.rawMaxTokens : u.context.window
            IF b: IF b.autoCompactThreshold present: t.autoCompactLeft = b.autoCompactThreshold − b.totalTokens ELSE t.autoCompactOff = true
        IF reg.stage: first = StartOf(rows, reg.stage.after); t.stage = { name, first, chars = Σ size(rows[first ..]), turnsAgo = reg.turn − openedTurn, lost = MarkIndex is lost }
        IF reg.lastClosed: s0 = StartOf(rows, after); e = MarkIndex(rows, end)
            t.lastClosed = { name, start = s0, end = (e is an index ? e : absent), chars = (e is an index AND s0 ≤ e ? Σ size(rows[s0..e]) : absent), lost = e is lost, startLost = MarkIndex(rows, after) is lost }
        t.reviews = active review tags whose target resolves on rows, counted by reason (absent → agent)
        t.disposable = disposable tags whose target resolves on rows
        t.journal = journal unreadable ? { unreadable: reason } : { applications: count of apply, freedChars: Σ freedChars, rereads: count of reread }
        t.state = the state tag ? (Locate finds its row ? { row } : lost) : none
        RETURN t

    TelemetryText(t) = lines, numbers of tokens in thousands rounded to an integer ("~12k"), under 1000 as they are:
        messages:    "Context: conversation ~<conversation> tokens; fixed part (system prompt, tools, skills, memory) ~<fixed>; window <window>; auto-compaction in ~<autoCompactLeft>" | "...; auto-compaction off"
        request:     "Context: last request ~<request> tokens, the fixed part (system prompt, tools, skills, memory) included; window <window>" + the same auto-compaction part when the breakdown has it
        unknown:     "Context: size unknown yet (no model response since the session start or the last compaction); window <window>"
        unavailable: "Context: size unavailable (<error>)"
        stage:       "Stage \"<name>\" open from #<first> (opened <turnsAgo> turn(s) ago), ~<chars/4> tokens" + (lost ? "; its start row is gone, so it runs from #0" : "") | "No open stage"
        lastClosed:  "Last block \"<name>\" | (no stage) #<start>..#<end> (~<chars/4> tokens)" | (end null or start > end) "...: it is empty" | (end lost) "Last block \"<name>\" | (no stage) from #<start>: its end row is gone"; + (startLost ? "; its start row is gone, so it runs from #0" : "") — line omitted without lastClosed; a lost end is never shown as an empty block
        candidates:  "Candidates: review <total> (<reason> <n>, …, reasons with 0 omitted); disposable <n>"
        journal:     "Effect: <applications> application(s), ~<freedChars/4> tokens freed, <rereads> reread(s) of compressed content" | "Effect: journal unreadable (<reason>)"
        state:       "State slot: #<row>" | "State slot: none" | "State slot: its row is no longer in the conversation"

Розмір рядків розмови береться з рядка MESSAGES_ROW розбивки: розмір усього запиту для рішення не годиться, бо незмінна частина залежить від хоста (~38 тисяч токенів у терміналі, ~70 тисяч у розширенні VS Code, [C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02)). Рядок шукається за назвою: власного `kind` він не має, а типи хоста радять розгалужуватись за `kind`; якщо назва зміниться в іншій версії хоста, телеметрія переходить на весь запит із позначкою, що незмінна частина в ньому (`request`), і нічого не ламається. `tokens` відсутній, поки моделі не відповіли (свіжа сесія, щойно після компактизації), — тоді `unknown`. Щойно після вбудованої компактизації хоста `tokens` ще є (це останній запит до неї), а рядок MESSAGES_ROW — гола локальна оцінка (наживо «conversation ~15 tokens», Verify фази 14, D2): розбивка позначає це полем `apiUsage = null` (відповіді API в живому вікні ще не було; рядок `Messages` звіряється саме з нею), і тоді теж `unknown`. Поле `apiUsage` відсутнє (інша версія хоста) — правило не діє. Розбивка рахує «зараз» з локальною оцінкою рядків після останньої відповіді, а `tokens` — останній запит, тож суми не мусять збігатися. Збій `usage` не валить переліку чи звіту блоку: решта рядків телеметрії не залежить від нього. Розмір блоку й етапу — символи/4 рядків поточної розмови, а не розбивка: вона не ділиться за рядками.

### 02_29. StageBlock  {#SP_CTX_02_29}

Purpose: закрити етап і скласти звіт закриття — межі, розмір, медіа, кандидати, телеметрія і порада — для закриття етапу інструментом ([SP_CTX_02_11](#SP_CTX_02_11)); скласти без індексів текст промпту ходу оптимізації ([SP_CTX_02_06](#SP_CTX_02_06)) і поради з промптом людини ([SP_CTX_02_08](#SP_CTX_02_08)); порада одна для всіх трьох ([C_CTX_DEC_17](./context_editor.concept.md#C_CTX_DEC_17), A).

Processing logic (pseudocode):
    FUNCTION CloseStage(reg, rows, carrier) → ClosedBlock:            # реєстр пише викликач
        IF reg.stage absent: error NO_STAGE
        reg.lastClosed = { name: reg.stage.name, after: reg.stage.after, end: MarkBefore(rows, carrier), turn: reg.turn }
        reg.stage = absent
        RETURN reg.lastClosed

    FUNCTION BlockReport(block, replaced?):                            # лише закриття інструментом: між закриттям і звітом компактизації немає
        key = Key()                                                     # SP_CTX_02_18, до читання рядків
        rows = CurrentRows(); reg = TagRegistry; api = read main conversation in Messages API form
        a = StartOf(rows, block.after); e = MarkIndex(rows, block.end)
        head = (block.name ? "Stage \"<name>\" closed: " : "Block (no stage): ")
             + (e is lost ? "its end row is gone; call context_list."
                : block.end null OR a > e ? "no rows in it."
                : "rows #<a>..#<e>, ~<Σ size(rows[a..e]) / 4> tokens, <m> media (~<KB>KB).")   # медіа — CollectMedia(api, rows) для власників у a..e
        IF the block has rows (a ≤ e, e not lost):
            cand = for each reason, active review tags whose target rows lie in a..e: "<reason> #i, #j, …" (≤ MAX_BLOCK_INDEXES, then "+<n> more")
                   + disposable tags in a..e + count of reproducible pairs (REPRO_FLAG) in a..e
            text = head + "\nCandidates in the block: " + (cand or "none") + "."
        ELSE text = head
        IF replaced AND replaced.queued > 0: text += "\nReplacements from your disposable tags queued: <queued> (~<freed> tokens freed when this turn ends)."
        text += "\n" + TelemetryText(Telemetry(rows, reg, Journal))   # SP_CTX_02_28
        IF the block has rows: text += "\n" + STAGE_ADVICE
        IF the block has rows: listedKey = key                          # звіт перелічує індекси рядків блоку, як перелік; «no rows in it.» і загублений кінець — ні
        RETURN text

    BlockName(block) = block.name ? "stage \"<name>\"" : "the last block (no stage)"

    ListHint = " Call context_list: its header names the block's range (Last block #<a>..#<b>, or Last block from #<a> when its end row is gone); list from its first row (from=<a>) to see those rows ([block ▶ …] .. [block end]) before you edit by index."

    OptimizeText(block, compacted) = "context-editor: optimization turn for " + BlockName(block)
        + " (you ended your last answer with [context-editor: optimize])."
        + (compacted ? " The batch queued in that turn, with the replacements from your disposable tags, was processed (see the report above); if it changed the conversation, indexes from earlier listings no longer hold." : "")
        + ListHint + "\n" + STAGE_ADVICE
        + "\nYou asked for this while finishing your turn for the person, so usually stop after it: pass \"resume\": false in context_edit unless the task should go on, then end your turn. The mark has no effect in this turn."

    PersonAdvice(block) = "context-editor: you asked to optimize " + BlockName(block) + " after your previous answer; the optimization turn did not run, so the advice comes with this prompt."
        + ListHint + "\n" + STAGE_ADVICE
        + "\nCompress the block when it suits the person's request; edits apply when your turn ends."

Блок закритого етапу — від рядка після `after` (або від голови) до рядка `end` включно. `block` викликач читає з TagRegistry безпосередньо перед текстом: context_tag — щойно записаний `lastClosed`; Flush — `lastClosed` після команди компактизації (його межі вже переніс RebindTags, але Flush бере лише назву); DeliverReport — `lastClosed` у момент хука. Реєстр `unreadable` або `lastClosed` відсутній — тексту немає: Flush — OPTIMIZE_NO_BLOCK ([SP_CTX_02_06](#SP_CTX_02_06)), DeliverReport — ADVICE_NO_BLOCK ([SP_CTX_02_08](#SP_CTX_02_08)); в обох `optimize` стає `false`. Кінець при закритті інструментом — останній рядок перед рядком із викликом `close` (MarkBefore від `carrier`, [SP_CTX_02_11](#SP_CTX_02_11)); при закритті міткою — останній рядок ходу ([SP_CTX_02_30](#SP_CTX_02_30)).

Індекси, розмір і кандидатів має лише звіт закриття інструментом: між закриттям і звітом компактизації немає, тож індекси правильні, і звіт із рядками блоку оновлює `listedKey`, як перелік, — інакше правка за індексом з нього без окремого `context_list` відхилялась би; звіт «no rows in it.» або з загубленим кінцем індексів рядків не перелічує і `listedKey` не оновлює. OptimizeText і PersonAdvice індексів, розміру і кандидатів не мають ([SP_CTX_DEC_15](#SP_CTX_DEC_15)): у ході з міткою застосування черги змінює індекси, а в неінтерактивному хості повернені рядки з'являються в читанні із запізненням (F2), тож агент бачить межі блоку в перегляді, який однаково робить перед правками за індексами; ці тексти `listedKey` не оновлюють. Перегляд типово показує першу сторінку від рядка 0 (LIST_COUNT рядків), а блок у довгій розмові стоїть далі, тому ListHint просить узяти діапазон з рядка `Last block #a..#b` заголовка і перелічити рядки від `from = a` — один-два виклики `context_list`. Речення про оброблений пакет (з замінами з тегів) OptimizeText додає лише при `compacted = true`; воно не каже «застосовано», бо обробник міг відповісти «no edit was applied» — тоді звіт у промпті це називає, а індекси попереднього перегляду лишаються чинними. Загублений кінець блоку (`lost`) ніколи не показується як порожній блок: звіт каже, що рядка кінця вже немає. У BlockReport порожній блок поради не має: агент нічого не ставить у чергу, а без тегів `disposable` компактизації немає ([C_CTX_03_03](./context_editor.concept.md#C_CTX_03_03)). Порада про продовження в OptimizeText: хід оптимізації — звичайний хід, і його пакет застосовується з `resume` і `resume_prompt` власного `context_edit` агента ([C_CTX_DEC_03](./context_editor.concept.md#C_CTX_DEC_03)); оскільки мітку ставлять, завершуючи хід для людини, промпт радить передати `resume: false`, якщо завдання не має йти далі. Агент, що нічого не ставить у чергу, просто завершує хід — компактизації і промпту продовження тоді немає. Заміни з тегів `disposable` у промпті не рахуються: на кінці ходу з міткою їх поставив DetectOptimize, і застосування перед промптом їх уже обробило — звіт називає кожну.

Errors:
| Code | Condition | Outcome |
|------|-----------|---------|
| NO_STAGE | CloseStage без відкритого етапу | context_tag відхиляє запит ([SP_CTX_02_11](#SP_CTX_02_11)); реєстр без змін |
| REPORT_FAILED | BlockReport кинув виняток (читання рядків, API-подання чи реєстру) | етап уже закрито й реєстр записано: результат context_tag замість звіту має `Stage "<name>" closed; its report failed: <error>; call context_list`; `listedKey` не оновлено |

### 02_30. DetectOptimize  {#SP_CTX_02_30}

Purpose: помітити мітку оптимізації у фінальному тексті ходу, закрити блок і поставити запит оптимізації ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), «Мітка оптимізації в тексті»; [SP_CTX_DEC_12](#SP_CTX_DEC_12)).

Input: подія завершення ходу (`agentId?`, `isAborted`, `answer` — фінальний видимий текст ходу; навичка plugin-hooks, пункт 38).

Processing logic (pseudocode):
    ON turn completed (main loop, aborted or not), on the registry chain, before TagRegistry.turn += 1 (преамбула 02):
        prompted = false
        IF storage ready: on the queue chain: q = read Queue; IF ok AND q.optimizePrompted: prompted = true; optimizePrompted = false; write   # кінець ходу оптимізації знімає запобіжник
        IF aborted OR LastLine(answer) ≠ OPTIMIZE_MARK: RETURN                # LastLine — останній рядок, непорожній після обрізання пробільних символів, обрізаний
        IF prompted: RETURN                                                   # MARK_IN_OPTIMIZATION: мітка у відповіді ходу оптимізації не діє — мод не входить у петлю
        IF storage unavailable: status "context-editor: optimization mark ignored: storage unavailable"; RETURN
        q = read Queue
        IF q unreadable: status "context-editor: optimization mark ignored: the queue is unreadable"; RETURN
        IF q.handoff present: status "context-editor: optimization mark ignored: a handoff is pending"; RETURN   # передача має перевагу
        reg = TagRegistry; IF unreadable: status "context-editor: optimization mark ignored: the tag registry is unreadable"; RETURN
        rows = CurrentRows(); normalize a lost stage.after or lastClosed.after to null; a lost lastClosed.end stays (SP_CTX_01_18)
        IF NOT (reg.lastClosed present AND reg.lastClosed.turn = reg.turn):    # у цьому ході етап інструментом не закривали
            end = MarkBefore(rows, len(rows))                                 # останній рядок ходу, разом із відповіддю з міткою
            IF reg.stage: reg.lastClosed = { name: reg.stage.name, after: reg.stage.after, end, turn: reg.turn }; reg.stage = absent
            ELSE: reg.lastClosed = { name: absent, after: reg.lastClosed ? reg.lastClosed.end : null, end, turn: reg.turn }   # SP_CTX_DEC_14
        write TagRegistry                                                      # збій запису: status "...ignored: <error>"; RETURN
        TRY QueueTagReplacements()                                            # SP_CTX_02_13: заміни з disposable — тим самим пакетом, що й правки агента цього ходу; рядки ходу на місці, компактизації ще не було
        CATCH: replacements skipped                                           # MARK_NO_REPLACEMENTS: обробка мітки йде далі
        on the queue chain: re-read Queue
            IF unreadable OR handoff present: status "context-editor: optimization mark: the block is closed, but no optimization turn: <the queue is unreadable | a handoff is pending>"; RETURN   # MARK_NOT_QUEUED
            optimize = true; write                                             # збій запису: той самий рядок стану з "<error>" (MARK_NOT_QUEUED)

Мітка діє лише окремим останнім рядком фінального тексту ходу (поле `answer` події `turn.complete`): останній непорожній рядок після обрізання пробільних символів дорівнює OPTIMIZE_MARK дослівно ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02)). Мітка раніше в ході (у проміжному тексті перед викликами), процитована посеред відповіді (агент пояснює людині, як просити оптимізацію) або з іншим текстом у тому самому рядку не діє. Блок мітки — `lastClosed` після цього кроку: якщо в тому самому ході агент закрив етап інструментом (`lastClosed.turn` дорівнює ще не збільшеному `TagRegistry.turn`), мітка стосується блоку цього етапу, а відкритий після нього етап лишається відкритим; інакше мітка закриває відкритий етап кінцем ходу; без відкритого етапу — закриває блок без етапу від кінця попереднього закритого блоку (або від голови) до кінця ходу. Межі блоку в реєстрі переносить застосування, якщо воно відбудеться до ходу оптимізації (RebindTags, [SP_CTX_02_14](#SP_CTX_02_14)), тож перегляд агента в ході оптимізації показує `[block ▶ …]` і `[block end]` уже після нього; Flush бере з `lastClosed` лише назву. Чи записано рядок фінальної відповіді в транскрипт до `turn.complete`, не перевірено: якщо ні, кінець блоку — рядок перед відповіддю, і відповідь з міткою в блок не потрапляє (на пораду це не впливає). Перерваний хід мітки не дає. Заміни з тегів `disposable` DetectOptimize ставить у чергу на кінці ходу з міткою — рядки ходу вже на місці, а компактизації ще не було, тож цілі знаходяться на тих самих рядках, які застосування візьме з події компактизації; це той самий пакет, що й правки агента цього ходу, і Flush застосовує його однією компактизацією перед промптом ходу оптимізації. Запобіжник петлі: Flush ставить `optimizePrompted`, коли промпт ходу оптимізації увійшов; кінець наступного ходу основної розмови (ходу оптимізації, зокрема перерваного) знімає прапорець, а мітку в його відповіді ігнорує. «Закрито в цьому ході» звіряється з лічильником завершених ходів: етап, закритий у перерваному ході (лічильник тоді не росте), мітка наступного ходу вважає закритим у своєму ході і бере його блок.

Errors (жодна не виходить до агента; рядок стану бачить людина):
| Code | Condition | Outcome |
|------|-----------|---------|
| MARK_NO_STORAGE | сховище `unavailable` | мітка ігнорується |
| MARK_QUEUE_UNREADABLE | Queue `unreadable` | мітка ігнорується; файл перенесе наступний `context_edit` |
| MARK_REGISTRY_UNREADABLE | TagRegistry `unreadable` або не записався | мітка ігнорується; блок не закрито |
| MARK_HANDOFF | у черзі запит передачі | мітка ігнорується: передача переносить розмову цілою, а оптимізацію агент може попросити в новій сесії |
| MARK_IN_OPTIMIZATION | `optimizePrompted` був `true` — це відповідь ходу оптимізації | мітка ігнорується мовчки; прапорець знято |
| MARK_NO_REPLACEMENTS | QueueTagReplacements кинув виняток | заміни з тегів не поставлено (теги лишаються до наступного закриття етапу чи мітки); блок закрито, `optimize` пишеться як завжди |
| MARK_NOT_QUEUED | реєстр уже записано (блок закрито), а запис черги не вдався або повторне читання черги знайшло `unreadable` чи `handoff` | блок лишається закритим у реєстрі; ходу оптимізації і поради немає; рядок стану «the block is closed, but no optimization turn: <причина>»; агент може закрити наступний блок або поставити мітку знову |

### 02_31. Journal  {#SP_CTX_02_31}

Purpose: вести журнал ефекту ([SP_CTX_01_19](#SP_CTX_01_19)): що звільнило кожне застосування і які вже стиснуті відтворювані виводи агент читав знову — сигнал надмірного стискання і матеріал для дослідження впливу змінного контексту на якість завдань ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), «Журнал ефекту»).

Processing logic (pseudocode):
    FUNCTION JournalApply(id, report, archive, before, edits):             # HandleCompaction (SP_CTX_02_07), коли report.applied непорожній; у фоні
        j = read Journal; IF unreadable: RETURN                            # не перезаписується
        applied = [e IN edits | EditLabel(e) IN report.applied]
        compressed = distinct input.file_path of every Read call in the pairs of before that applied summarize or drop edits name, or that applied collapse spans hold (≤ MAX_QUEUE_EDITS, first ones kept)
        j.entries += { kind: apply, at: id, freedChars: max(0, report.charsBefore − report.charsAfter), edits: len(applied), archive, compressed }
        Trim(j); write Journal                                             # збій запису — без наслідків для застосування

    FUNCTION JournalReread(path, tool_use_id):                             # хук викликів (SP_CTX_02_16), після Read без помилки; у фоні
        j = read Journal; IF unreadable OR missing: RETURN
        archiveHit = some apply entry e with e.archive ≠ "" AND (path = e.archive OR path starts with "<storage>/<e.at>/")
        compressedHit = some apply entry e with path IN e.compressed AND no later changed entry with that path   # власний Edit/Write після стискання — читається новий вміст
        IF NOT archiveHit AND NOT compressedHit: RETURN
        j.entries += { kind: reread, at: now, path, tool_use_id, archive: archiveHit }
        Trim(j); write Journal

    FUNCTION JournalChanged(path):                                         # хук викликів, після WRITE_TOOLS без помилки; у фоні
        j = read Journal; IF unreadable OR missing: RETURN
        IF some apply entry e has path IN e.compressed: j.entries += { kind: changed, at: now, path }; Trim(j); write Journal

    Trim(j): drop the oldest entries while len(j.entries) > MAX_JOURNAL or the serialized file > MAX_QUEUE_BYTES

Повторне читання помічається лише для `Read`: `Grep` і `Glob` шляху одного файлу не мають, тож їх повтор журнал не бачить. Читання файлу архіву або медіа застосування (`archive = true`) — повернення оригіналу ([C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)); часті такі записи — тригер повернутися до операції відновлення на місці (C_CTX_DEC_18, B). Засів нової сесії записів журналу не робить, і журнал у нову сесію не переноситься ([SP_CTX_02_21](#SP_CTX_02_21)). Журнал — частина телеметрії ([SP_CTX_02_28](#SP_CTX_02_28)); інших читачів у моді немає.

Errors: відмов немає; журнал `unreadable` — записи пропускаються, телеметрія показує причину; збій запису — запис губиться.

## 03. Validation Rules  {#SP_CTX_03}

### 03_01. Input Validation  {#SP_CTX_03_01}

- Інструменти мода відмовляють виклику з субагента.
- Кожна правка проходить [SP_CTX_02_03](#SP_CTX_02_03) незалежно; кожен запит тегу — таблицю помилок [SP_CTX_02_11](#SP_CTX_02_11).
- `resume_prompt` з самих пробілів ігнорується; довший за MAX_TEXT відхиляє весь виклик (DENIED_PROMPT_TOO_LONG).
- Жодна правка — від агента чи з тегів — не зачіпає ціль з тегом `pin`, ні при постановці, ні при застосуванні.
- Жодна правка — від агента чи з тегів — не зачіпає рядка з тегом `state`, крім `rewrite` саме цього рядка, ні при постановці, ні при застосуванні, ні в засіві.
- Запити етапів (`open`, `close`) і діапазони `disposable` проходять таблицю помилок [SP_CTX_02_11](#SP_CTX_02_11); діапазон тегу перевіряється тими самими правилами пар, що й `collapse`.
- Мітка оптимізації — лише останній непорожній рядок фінального тексту ходу основної розмови, що після обрізання дорівнює OPTIMIZE_MARK ([SP_CTX_02_30](#SP_CTX_02_30)).

### 03_02. Output Validation  {#SP_CTX_03_02}

- Новий список рядків задовольняє інваріант пар [SP_CTX_01_01](#SP_CTX_01_01).
- Жоден змінений рядок не зберігає `handle`; незмінений рядок з результатами інструментів зберігає `handle` тоді й лише тоді, коли має медіа ([C_CTX_DEC_06](./context_editor.concept.md#C_CTX_DEC_06)); незмінений рядок асистента зберігає `handle` лише тоді, коли в його відрізку між промптами людини немає жодного перезібраного чи вставленого рядка асистента (KeepResponsesWhole, [SP_CTX_02_04](#SP_CTX_02_04)).
- Жоден рядок асистента без `handle` з викликами не стоїть перед іншим рядком асистента без `handle`: після нього йде рядок результатів (MergeCallRows, [SP_CTX_02_04](#SP_CTX_02_04)); те саме для засіву.
- Текст кожного зміненого результату інструменту і кожного зміненого рядка без результатів починається з MARK.
- Медіа зникає з розмови лише разом з правкою, що його замінила, і лише після запису його файлу.
- Пакет застосовується лише тоді, коли файл оригіналів записано; тож кожен змінений текст має посилання `original:` на наявний файл.
- Засів ([SP_CTX_02_22](#SP_CTX_02_22)) проходить CheckSeed ([SP_CTX_02_23](#SP_CTX_02_23)): жоден засіяний рядок не має `handle`, пари цілі, перший рядок — людини. Медіа незміненої пари в засіві — лише файлом, названим у тексті її результату (CarryNote); медіа без вбудованих даних названо там же як неперенесене. Текст першого рядка засіву не містить рядка з TRANSCRIPT_LINE.
- Рядки команди, яку запускає мод, несуть MARKER або HANDOFF_MARKER без змін, а `instructions` обробника дорівнює цьому тексту: мод рядків команди не переписує.
- Після застосування і засіву межі етапів (`stage.after`, `lastClosed.after`, `lastClosed.end`) або `null`, або вказують на рядок нового списку, що має ідентифікатор чи непорожній текст ([SP_CTX_02_14](#SP_CTX_02_14)); у реєстрі не більше одного відкритого етапу і не більше одного тегу `state`.
- Після звичайного виклику інструменту мод додає до результату лише рядок псевдоніма ([SP_CTX_02_16](#SP_CTX_02_16)); телеметрія з'являється тільки в результатах інструментів мода (перегляд, закриття етапу); промпт ходу оптимізації і порада з промптом людини її не несуть — агент бачить її в перегляді.

## 04. State Transitions  {#SP_CTX_04}

### 04_01. Queue Lifecycle  {#SP_CTX_04_01}

    [empty] --context_edit / QueueTagReplacements--> [pending] --turn completed, no handoff waiting, host runs the command--> [applying] --handler done--> [reported] --next prompt--> [empty]

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| empty | pending | прийнято ≥ 1 правку | рядок стану показує кількість |
| pending | pending | ще правки; хід перервано; хост відхилив команду (одна спроба, відмова остаточна); у черзі запит передачі (правки застосує RunHandoff); разовий `claude -p` без прив'язаної сесії | рядок стану лишається або показує текст відмови хоста |
| pending | applying | хід основної розмови завершено, запиту передачі немає, хост виконав команду компактизації з MARKER ([SP_CTX_02_06](#SP_CTX_02_06)) | рядки команди `/compact <MARKER>` і позначка виконання в розмові |
| applying | reported | обробник застосував пакет, жодна правка не застосувалась або обробник впав | архів, спливне повідомлення, пакет очищено, звіт записано |
| applying | pending | хост покинув диспетчеризацію | черга не змінюється, звіту немає |
| pending | pending | сховище недоступне (SKIP_STORAGE) | черга не змінюється |
| pending | reported | передача забрала правки в засів або документ (`HandedOff`, [SP_CTX_02_21](#SP_CTX_02_21)) | пакет очищено; нотатка про передачу у звіті старої черги, `reportResume = false` |
| reported | reported + pending | context_edit до доставки звіту | звіт чекає, нові правки в пакеті |
| any | unreadable | файл черги пошкоджено | Flush і обробник чекають; мітка оптимізації ігнорується (MARK_QUEUE_UNREADABLE) |
| unreadable | pending | context_edit переносить файл (QUEUE_QUARANTINED) | нова черга з поставленими правками |
| reported | empty | наступний промпт (людини, продовження або ходу оптимізації) отримав звіт | поля звіту видалено |
| pending | applying | хід з міткою оптимізації завершено, черга непорожня; хід оптимізації запускається після застосування ([SP_CTX_02_06](#SP_CTX_02_06)) | звіт іде в промпті ходу оптимізації замість промпту продовження |

### 04_02. Edit Lifecycle  {#SP_CTX_04_02}

    [requested] --PrepareEdits ok--> [queued] --ApplyEdits ok--> [applied]
    [requested] --PrepareEdits error--> [rejected]
    [queued] --pin / state slot / not located / overlap / pairing / media not archived--> [failed]

### 04_03. Tag Lifecycle  {#SP_CTX_04_03}

    [absent] --context_tag add / AutoTag / R4 in the call hook--> [tagged] --ttl not passed--> [tagged, inactive review]
    [tagged review] --R4 (any reason) / R5 (big, search)--> [tagged review, new reason]
    [tagged disposable] --stage closed by the tool / end of the optimization turn--> [queued as edit] --applied or failed--> [absent]
    [tagged state] --rewrite of its row applied--> [tagged state on the rewritten row]
    [tagged state] --context_tag add state elsewhere--> [absent] (the new row holds the slot)
    [tagged] --context_tag remove / target edited / target gone--> [absent]

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| absent | tagged | агент або правило поставили тег | запис у реєстр |
| tagged | queued as edit | `disposable`: агент закрив етап інструментом або завершився хід оптимізації (QueueTagReplacements, [SP_CTX_02_13](#SP_CTX_02_13)); діапазон — як `collapse` | правка в черзі; удруге та сама заміна не ставиться |
| queued as edit | absent | правку застосовано або відхилено при застосуванні | тег видалено (RebindTags) |
| tagged | absent | тег знято, ціль змінено іншою правкою (для діапазону — будь-який його рядок) або ціль зникла | тег видалено |
| tagged review | tagged review | R4 на будь-якому `review`, R5 на `review` з причиною `big` або `search` | нова причина, без терміну |
| tagged state | tagged state | застосовано `rewrite` рядка слоту | тег переходить на переписаний рядок (RebindTags, [SP_CTX_02_14](#SP_CTX_02_14)) |
| tagged state | absent | `add state` на іншому рядку; рядок слоту зник іншим шляхом (вбудована компактизація, вікно, засів до підсумку) | у реєстрі лишається не більше одного `state` |

### 04_04. Handoff Lifecycle  {#SP_CTX_04_04}

```
(none) ──context_handoff / /handoff──▶ queued ──after turn end + HANDOFF_DELAY──▶ running
queued ──the turn the agent asked in is interrupted (by = agent, requestTurn = turns) / /handoff cancel──▶ (none) + report "handoff cancelled"
running, not in flight in this instance ──/handoff cancel──▶ (none) + report "handoff cancelled"
running, stale, a seed.json of that run exists ──claim──▶ (none) + report "a previous handoff stopped after building <file>; it is not re-run"
queued ──new request──▶ queued (replaced)
running ──seeded and checked (transcript)──▶ (none) in the old queue, edits gone + report "handed off to <new> (transcript)"
running ──seed refused before /clear, document way done──▶ (none), edits gone + report "handed off to <new> (document)"
running ──/clear refused, or no document (both ways before /clear)──▶ (none), edits kept + report "handoff failed …; the session was not changed"
running ──(a turn ran while /clear waited, or seeding failed after /clear) with the agent's document, no turn in the new session──▶ (none), edits gone + report "handed off to <new> (document)"
running ──(a turn ran while /clear waited, or seeding failed after /clear) without a document; or a turn began in the new session; or the session changed during seeding──▶ (none), edits kept + report "handoff failed after the session was cleared …"
queued / running ──a turn ran or started since scheduling, seen before /clear is issued──▶ queued (runs after that turn, or at once if it already ended); seed files removed
running ──no handoffInFlight (process gone or module reloaded) and older than HANDOFF_STALE──▶ due again
running ──handoffInFlight in this instance──▶ never due, not replaceable, however long a command waits
running ──any exception before /clear──▶ (none) via one Fail attempt (a failed write gives a toast only)
running ──any exception after /clear, transcript, AfterClear not yet entered──▶ AfterClear once: with the agent's document → handed off (document); without → FailAfterClear + notice
running ──an exception inside AfterClear──▶ caught there; no second /clear, no second delivery, at most one FailAfterClear
running ──any exception after /clear, document way──▶ (none) via FailAfterClear, without a seed.json path
```

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| running | (none) | засів узято і CheckSeeded пройшов | процес у новій сесії із засіяними рядками; теги й псевдоніми скопійовано; звіт і промпт продовження в новій сесії |
| running | (none) | збій до `/clear`, спосіб `document` вдався | процес у новій сесії з документом першим промптом |
| running | (none) | `/clear` відхилено або документа немає | процес у старій сесії; правки в черзі; звіт з причинами |
| running | (none) | збій після `/clear` | один AfterClear; повторне `/clear` лише тоді, коли засів уже взято (і не було ходу в новій сесії чи зміни сесії); документ агента (лише коли в новій сесії не було ходу) або повідомлення з ідентифікатором старої сесії і шляхом до файлу засіву — промптом або, коли людина вже почала хід, у звіт черги поточної сесії; стара сесія без змін |
| running | queued | хід пішов або почався від планування, помічено до того, як `/clear` запущено | файли засіву видалено; `owner` прибрано |

Поки запит є (`queued` чи `running`), обробник компактизації не застосовує черги ([SP_CTX_02_07](#SP_CTX_02_07)), а Flush не запускає команди компактизації ([SP_CTX_02_06](#SP_CTX_02_06)). Хід, який хост виконав, поки `/clear` чекав вільної сесії, уже не відкладає передачу: засів його не містить, тож RunHandoff іде в AfterClear; хід, що почався в новій сесії після `/clear`, закінчує передачу `FailAfterClear` без повторного очищення ([SP_CTX_02_21](#SP_CTX_02_21)).

### 04_05. Stage Lifecycle  {#SP_CTX_04_05}

```
(no stage) ──context_tag open──▶ open(after) ──context_tag close──▶ (no stage), lastClosed = that block
open ──context_tag open (another)──▶ open(new after); lastClosed = the previous block
open ──optimization mark, no tool close in this turn──▶ (no stage), lastClosed = the block up to the end of the turn
(no stage) ──optimization mark, no tool close in this turn──▶ (no stage), lastClosed = unnamed block after the previous lastClosed.end (or from the head)
open / lastClosed ──applying edits or seeding: the mark row replaced by an edit (summarize, collapse, rewrite, describe)──▶ the mark moves to the last row that edit produced
open / lastClosed ──applying edits or seeding: the mark row removed without replacement (drop, own calls, empty row) or changed by the seed (CarryNote)──▶ the mark moves to the nearest preceding unchanged surviving row, or null
open / lastClosed ──host compaction (/compact, auto): the mark row gone──▶ lost: open stage from the head, lastClosed.end unknown (never shown as empty); a lost after becomes null at the next context_tag or DetectOptimize write
open / lastClosed ──handoff (transcript)──▶ copied into the new session with relocated marks
```

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| no stage | open | `open` прийнято, реєстр записано | `stage = { name, after, openedTurn }`; перегляд показує `[stage ▶ name]` |
| open | no stage | `close` прийнято, реєстр записано | `lastClosed` — блок етапу; QueueTagReplacements; звіт блоку в результаті ([SP_CTX_02_29](#SP_CTX_02_29)) |
| open | open | `open` при відкритому етапі | спершу закриття, як у рядку вище (звіт у результаті), потім новий етап |
| open | no stage | мітка оптимізації, у цьому ході етап інструментом не закривали | `lastClosed` до кінця ходу; `Queue.optimize` ([SP_CTX_02_30](#SP_CTX_02_30)) |
| no stage | no stage | мітка без відкритого етапу і без закриття в цьому ході | `lastClosed` — блок без етапу від попереднього `lastClosed.end` ([SP_CTX_DEC_14](#SP_CTX_DEC_14)) |
| open, no stage | the same | мітка після закриття інструментом у тому самому ході | `lastClosed` не змінюється; відкритий після закриття етап лишається |
| open, no stage | the same, marks moved | застосування правок, засів | RelocateMark ([SP_CTX_02_14](#SP_CTX_02_14)): рядок межі замінено правкою — межа на останньому створеному нею рядку; прибрано без заміни або змінено засівом — на найближчому попередньому незміненому рядку |
| open, no stage | the same, marks lost | вбудована компактизація хоста, межа вийшла за ROW_WINDOW | перегляд і телеметрія кажуть, що етап діє від голови або кінець блоку невідомий |
| no stage | no stage | `close` без відкритого етапу | NO_STAGE; реєстр без змін |

### 04_06. Optimization Request Lifecycle  {#SP_CTX_04_06}

```
(none) ──last line of the answer is the mark; optimizePrompted false (DetectOptimize)──▶ requested (optimize = true); block closed; disposable replacements queued with the turn's edits
requested ──Flush: queue applied if non-empty; no turn started; compare-and-set swap──▶ prompted (optimizePrompted = true), the optimization prompt is sent instead of the resume prompt
requested ──a turn started before the swap, or DeliverReport already cleared optimize (OPTIMIZE_PERSON)──▶ requested / (none); nothing sent
requested ──compaction refused (HOST_REFUSED) / turn aborted after planning (PERSON_MOVED) / OptimizeText threw and the batch asked for no continuation (OPTIMIZE_BUILD_FAILED) / module reloaded before Flush──▶ requested → advice with the next person's prompt
requested ──registry unreadable or no lastClosed (OPTIMIZE_NO_BLOCK), or OptimizeText threw and the batch asked for continuation (OPTIMIZE_BUILD_FAILED)──▶ (none); ordinary resume of that batch
requested ──a person's prompt passes the hook──▶ (none); report, block name and advice ride on that prompt
prompted ──optimization prompt refused (OPTIMIZE_FAILED)──▶ requested (swap undone) → advice with the next person's prompt
prompted ──the next main turn (the optimization turn) ends, completed or aborted──▶ (none); a mark in its answer is ignored; its batch applies with the agent's own settings
prompted ──a person's prompt passes the hook between turns──▶ (none); the person took over
```

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| none | requested | мітка — останній рядок фінального тексту ходу основної розмови; `optimizePrompted = false`; немає `handoff`; черга і реєстр читаються | блок закрито в реєстрі; заміни з тегів у черзі разом із правками ходу; `optimize = true` |
| none | none | реєстр записано, а черга — ні (MARK_NOT_QUEUED) | блок закрито, запиту немає; рядок стану |
| requested | prompted | Flush: хід людини не почався до заміни; порівняння-і-запис застав `optimize = true` | `optimize = false`, `optimizePrompted = true` одним записом; далі один промпт зі звітом застосування і OptimizeText замість промпту продовження |
| requested | requested | хід людини почався до заміни (OPTIMIZE_PERSON), команду відхилено (HOST_REFUSED), хід перервано після планування (PERSON_MOVED), OptimizeText кинув виняток, а пакет не просив продовження (OPTIMIZE_BUILD_FAILED), модуль перезавантажено | нічого не надіслано; порада — з наступним промптом людини |
| requested | none | OPTIMIZE_NO_BLOCK; OPTIMIZE_BUILD_FAILED, коли пакет просив продовження (`compacted AND reportResume`) | `optimize = false`; звичайне продовження застосування (Resume) з `reportPrompt` |
| requested | none | DeliverReport пройшов раніше заміни (порівняння-і-запис не застав `optimize`) | нічого не надіслано |
| requested | none | промпт людини пройшов хук DeliverReport | звіт, назва блоку й порада — прихованим контекстом цього промпту; заміни з тегів уже в черзі з кінця ходу з міткою |
| prompted | requested | промпт ходу оптимізації відхилено | зворотна заміна одним записом; рядок стану (OPTIMIZE_FAILED) |
| prompted | none | кінець наступного ходу основної розмови (ходу оптимізації), завершеного чи перерваного | `optimizePrompted = false`; мітка в його відповіді ігнорується (MARK_IN_OPTIMIZATION); його пакет — зі своїм `resume` |
| prompted | none | промпт людини пройшов хук між ходами (`inTurn = false`) | `optimizePrompted = false` ([SP_CTX_02_08](#SP_CTX_02_08)) |

## 05. Verification Criteria  {#SP_CTX_05}

### 05_01. Functional Expectations  {#SP_CTX_05_01}

| Contract | Scenario | Input | Expected outcome |
|----------|----------|-------|------------------|
| BuildSeed | правки й медіа | розмова з парою з PNG, summarize іншої пари, drop третьої | summarize і drop застосовані; PNG незміненої пари записано в `<folder>/1.png`, текст її результату закінчується CarryNote `image/png <path>`; виклику context_handoff немає; жоден рядок не має `handle` |
| BuildSeed | однакові ролі поспіль | два рядки агента підряд | обидва рядки лишаються окремими, CheckSeed їх приймає |
| BuildSeed | модель бачить усе | усі результати є в API-поданні | голови немає, `fromSummary = false`, засів — CurrentRows з правками |
| BuildSeed | після вбудованої компактизації | рядки: 6 старих (результат `a` поза API-поданням), рядок-підсумок, що починається з SUMMARY_OPENER, з `read the full transcript at: …/old.jsonl`, копія тексту агента, пара `b`; API: підсумок, копія, `<system-reminder>`, пара `b` | перший рядок — підсумок без рядка зі шляхом, далі копія і пара `b`; `fromSummary = true`; `<system-reminder>` не перенесено; summarize `a` — `failed` `the model no longer sees this row` |
| BuildSeed | відновлена сесія після `/compact` | CurrentRows після `--resume` починаються з рядка-підсумку (F5), усі результати видно | голови немає, але `fromSummary = true`; звіт нової сесії каже, що вона починається з підсумку; PinSummary закріплює перший рядок |
| BuildSeed | підсумку немає | є результат поза API-поданням, перше повідомлення API — асистента / з `tool_result` / промпт людини без SUMMARY_OPENER | відмова NO_SUMMARY |
| BuildSeed | заповнене вікно при прихованих рядках | є результат поза API-поданням, API-подання — рівно 4096 повідомлень (або читання — 4096 рядків), перше — підсумок | відмова WINDOW_FULL, підсумок не шукається |
| BuildSeed | збіг підсумку | текст рядка-підсумку відрізняється від API лише пробілами й переносами; підсумок коротший за 160 символів | рядок знайдено (порівнюються перші min(160, довжина) символів без пробільних) |
| BuildSeed | нагадування в підсумку | перше повідомлення API: текст підсумку + блок, обрізаний текст якого починається з `<system-reminder>` | голова — лише текст підсумку |
| BuildSeed | підсумок не знайдено | перше повідомлення API — текст, якого немає в жодному рядку людини | відмова SUMMARY_NOT_FOUND |
| BuildSeed | заповнене вікно | 4096 рядків, межі немає, усі результати видно | відмова WINDOW_FULL |
| BuildSeed | завеликий засів | після нормалізації засів довший за ROW_WINDOW − SEED_ROOM рядків | відмова SEED_TOO_LONG до `/clear`; спосіб `document` |
| BuildSeed | підсумок посеред рядків | усі результати видно, але рядок людини, крім першого, починається з SUMMARY_OPENER | гілка прихованих рядків: засів від останнього підсумку |
| BuildSeed | вміст рядком | перше повідомлення API має `content` рядком, що починається з SUMMARY_OPENER | рядок — один текстовий блок; підсумок знайдено |
| BuildSeed | заповнене вікно з межею | 4096 рядків, CurrentRows знайшов межу | засів зібрано |
| BuildSeed | медіа не записалось | запис PNG незміненої пари падає | відмова MEDIA_NOT_ARCHIVED |
| BuildSeed | медіа без даних | document `source.type = url` у незміненій парі (без `media_type` в API-поданні) | CarryNote `document (not carried: no inline data)` — тип береться з `media_type`, а без нього — з типу блоку; засів зібрано |
| BuildSeed | змішане медіа одного власника | незмінена пара: image з даними і document без даних | image записано в `<folder>/1.png`; CarryNote `image/png <folder>/1.png, document (not carried: no inline data)`; засів зібрано |
| BuildSeed | рядок зі шляхом у повній розмові | CurrentRows після `/compact` у цьому процесі починається з підсумку з рядком TRANSCRIPT_LINE | у першому рядку засіву цього рядка немає |
| CheckSeed | порушення | рядок з `handle`; `tool_result` без виклику; виклик без результату; результат після нового промпту; дубль id виклику; перший рядок агента; порожній рядок | кожне — своя причина з таблиці [SP_CTX_02_23](#SP_CTX_02_23) |
| CurrentRows | межа засіяної сесії | рядки `/clear`, засіяні рядки, рядки команди; Boundary від HandleSeed | від першого засіяного рядка |
| CheckSeeded | засів на місці | прочитано: рядок `/clear`, засіяні рядки, два рядки команди | «гаразд» |
| AwaitSeeded | рядки з запізненням | засіяні рядки з'являються в читанні через 50 мс після завершення `compact` (stream-json) | перше читання — `the seeded rows were not found`; після опитувань — «гаразд»; передача вдалася |
| AwaitSeeded | рядків немає | засіяні рядки так і не з'являються | після SEED_WAIT — остання причина; RunHandoff — AfterClear з SEED_NOT_KEPT |
| CheckSeeded | засів не взято | прочитано лише рядок `/clear` і рядки команди | `the seeded rows were not found` |
| CheckSeeded | бракує виклику | засіяні рядки є, один виклик відсутній | `seeded call <id> is missing` |
| CheckSeeded | сесія та сама | `now = old` | `the session id did not change` |
| context_handoff | постановка | mode без значення / `document` / задовгий документ / запит `running` | `transcript` / `document` / DENIED_TOO_LONG / DENIED_RUNNING |
| HandleCompaction | передача в черзі | правки + handoff | skip `handoff pending`, черга без змін |
| HandleCompaction | збіг за інструкцією | MARKER з `trigger` `manual` / `plugin`; MARKER з `agentId`; інша інструкція з `manual` | застосування / застосування / далі / далі |
| HandleCompaction | попереднє обчислення | `trigger = precompute`, інструкція MARKER або HANDOFF_MARKER | далі без змін; черга і засів не чіпаються |
| HandleCompaction | збій гілки засіву | виняток у HandleSeed | skip `seeding failed` одразу, черга не чіпається |
| HandleSeed | засів | засів у пам'яті, сесія нова, `messages` — один рядок `/clear` | повернено рядки засіву, `taken = true`, межу записано в сховище нової сесії з `host` = `hostId` (за наявності) і як власну межу екземпляра |
| HandleSeed | відмови | засіву немає / сесія ≠ `s.new` (стара чи інша) / у `messages` є рядок агента | SKIP_NO_SEED / SKIP_NOT_CLEARED / SKIP_TURN_STARTED; `taken` не змінюється |
| RunHandoff | засів | transcript, усе вдалося | порядок: збирання, файли в `<old storage>/<id>`, `clear`, сховище нової сесії, `compact HANDOFF_MARKER`, CheckSeeded, HandedOff, копії реєстрів, PinSummary, промпт зі звітом і продовженням |
| RunHandoff | збирання відмовило | BuildSeed — WINDOW_FULL | файли засіву видалено; спосіб `document`, документ від окремого запиту до моделі; причина у звіті |
| RunHandoff | хід почався | хід іде або лічильник змінився від планування — до захоплення, після збирання, перед `clear` способу `document` | `deferred`: без захоплення / файли засіву видалено; запит знову `queued` |
| RunHandoff | хід перед `/clear` | `turns` змінився між плануванням і завершенням `clear` (transcript) | AfterClear з `a turn ran before /clear; the seed would miss it`; без другого `clear` (засів не взято); документ або повідомлення |
| RunHandoff | хід перед `/clear` у способі document | те саме, `document` | документ надіслано; промпт називає хід, що лишився в `<old>` |
| RunHandoff | закріплення підсумку | засів з `fromSummary = true` | у скопійованому реєстрі `pin` на перший засіяний рядок, `firstPromptPinned = true` |
| RunHandoff | `/clear` відхилено | `clear` кидає виняток з текстом T | `Fail` з причиною, що містить T; правки лишаються; файли засіву видалено |
| RunHandoff | компактизацію засіву відхилено | `compact` кидає виняток з текстом T | AfterClear без другого `clear` (засів не взято); з документом агента — HandedOff `document`, промпт з T у причині; без документа — FailAfterClear і промпт з `<old>` і шляхом `seed.json` |
| RunHandoff | засів не взято | обробник відповів `skip` | AfterClear з `the seed compaction did not take the seed`, без другого `clear` (засів не взято) |
| RunHandoff | розбіжність | CheckSeeded повертає причину | AfterClear з цією причиною |
| RunHandoff | хід у новій сесії | хід почався після `clear` (`MovedSince(turnsClear)`), HandleSeed відповів SKIP_TURN_STARTED | FailAfterClear; другого `clear` і промпту немає |
| RunHandoff | resume false | спосіб `transcript` | промпту немає; звіт у черзі нової сесії; у старій — нотатка, `reportResume` false |
| RunHandoff | resume false, запасні тексти | `h.resume = false`; документ після збою засіву / повідомлення AfterClear / документ способу `document` | жодного промпту: кожен текст — у звіт черги нової сесії з `reportResume = false` |
| RunHandoff | теги й псевдоніми | реєстри старої сесії | скопійовано в сховище нової сесії до промпту і узгоджено RebindTags; збій копіювання чи узгодження — речення у звіті, засів лишається |
| RunHandoff | псевдонім зміненої пари | `c3` → пара `a`, summarize `a` застосовано в засіві | у новій сесії `ref: c3` — UNKNOWN_REF (`unknown ref c3`), не TARGET_NOT_FOUND |
| RunHandoff | тег на зміненій парі | `review` на парі `a`, summarize `a` застосовано в засіві | у реєстрі нової сесії тегу немає — так само, як після компактизації в тій самій сесії |
| RunHandoff | disposable з заміною в пакеті засіву | `disposable` на парі `b` з нотаткою N, у пакеті summarize `b` з `summary = N` — застосована або відхилена (зокрема через `pin`) | у реєстрі нової сесії тегу немає (пакет `s.edits` — до перевірки `pin`) |
| RunHandoff | збій узгодження реєстру | RebindTags кидає виняток | реєстр у нову сесію не записано; у звіті « Tags and aliases were not carried over.» |
| RunHandoff | незмінена пара | `c4` і `pin` на парі `b`, правок до `b` немає | у новій сесії `ref: c4` розв'язується на `b`; `pin` на `b` лишився |
| RunHandoff | пара поза засівом | тег і псевдонім на парі, рядки якої лишились до підсумку (`fromSummary`) | видалено: цілі в засіяних рядках немає |
| cancelHandoff | скасування | запит `queued` / `running` без `handoffInFlight` / `running` під час `handoffInFlight` | знятий зі звітом / знятий зі звітом / без змін |
| RunHandoff | покинутий запуск із засівом | `running`, старший за HANDOFF_STALE, у сховищі є `<id>/seed.json` з `id ≥ at` | запит знято зі звітом «not re-run»; RunHandoff — `nothing` |
| context_handoff | перерваний хід запиту | запит агента, `requestTurn = turns`, хід перервано / після перезавантаження модуля (`requestTurn` відсутній) | запит знято / запит лишається і запуститься після наступного кінця ходу |
| RunHandoff | відкладено, хід уже скінчився | хід, що відклав передачу, скінчився до повернення RunHandoff (`deferred`, `inTurn = false`) | `handoffScheduled` скинуто до виклику; другий RunHandoff через HANDOFF_DELAY без жодного нового ходу |
| RunHandoff | виняток до `/clear` | виняток після захоплення, до `/clear` | один Fail з `failed: <error>`, файли засіву видалено; запит не лишається `running`; `handoffInFlight = false` |
| RunHandoff | Fail кидає до `/clear` | запис старої черги в Fail падає | одна спроба, повтору немає; спливне повідомлення; `handoffInFlight = false` |
| RunHandoff | виняток після `/clear`, transcript | виняток у Seed до AfterClear | один AfterClear: з документом агента — HandedOff `document` і документ; без документа — FailAfterClear і повідомлення з шляхом `seed.json` |
| RunHandoff | виняток усередині AfterClear | крок AfterClear кидає | перехоплено в AfterClear: жодного ще одного `/clear`, один FailAfterClear, без повторної доставки; спливне повідомлення називає крок |
| RunHandoff | виняток після `/clear`, document | виняток у DocumentWay після `/clear` | FailAfterClear без шляху `seed.json`; повторної доставки немає |
| Due | running без handoffInFlight | `running`, `handoffInFlight = false`, старший за HANDOFF_STALE / молодший | належний / ні (поле `owner` не читається) |
| Flush | хід від планування, хід іде | `MovedSince(turns0)` перед командою, `inTurn = true` | команди немає, `scheduled = false`; кінець ходу запланує Flush |
| Flush | хід від планування, скінчився звичайно | `MovedSince(turns0)`, `inTurn = false`, `lastTurnAborted = false` | команди немає; Flush заплановано знову через FLUSH_DELAY |
| Flush | хід від планування, перерваний | `MovedSince(turns0)`, `inTurn = false`, `lastTurnAborted = true` | команди немає, повторного планування немає; черга чекає наступного завершеного ходу |
| RunHandoff | хід перед компактизацією засіву | `MovedSince(turnsClear)` безпосередньо перед `compact HANDOFF_MARKER` | команди немає; AfterClear → FailAfterClear без другого `clear` |
| RunHandoff | засів не взято, сесія порожня | компактизацію засіву відхилено (`taken = false`) | AfterClear без другого `clear`; документ або повідомлення через Deliver |
| HandleSeed | інша сесія | засів у пам'яті, поточна сесія ≠ `s.new` | SKIP_NOT_CLEARED; нічого не записано |
| RunHandoff | довгий хід під час `/clear` | `/clear` чекає кінця ходу довше за HANDOFF_STALE; кінець цього ходу знову перевіряє Due | другого запуску немає (`handoffInFlight`); `context_handoff` і `/handoff` — DENIED_RUNNING, запит не замінюється |
| HandoffCommand | планування | `/handoff` між ходами | Schedule(): знімок `turns0`, запуск через HANDOFF_DELAY; під час `handoffInFlight` — DENIED_RUNNING |
| RunHandoff | сесія змінилась під час засіву | після `compact` поточна сесія ≠ створеної `/clear` | FailAfterClear; другого `clear`, промпту і запису в поточну сесію немає |
| RunHandoff | хід одразу після `/clear` | `inTurn` після завершення `clear` | AfterClear → FailAfterClear без другого `clear`; повідомлення — у звіт черги нової сесії, `reportResume = false` |
| RunHandoff | людина активна перед відправкою | засів вдався, але `MovedSince(turnsClear)` перед відправкою звіту | звіт — у черзі нової сесії з `reportResume = false`, промпту немає |
| PinSummary | реєстр нової сесії | реєстру немає / повний (MAX_TAGS) / нечитабельний | створено з одним `pin` / `pin` не поставлено, звіт називає причину / те саме |
| BuildSeed | вікно посеред пари | перший рядок — результат без виклику | сирітські результати прибрано, перший рядок — людини; без рядка людини — відмова EMPTY |
| CurrentRows | без межі | транскрипт 9 рядків, Boundary відсутній | усі 9 рядків |
| CurrentRows | після компактизації | старі 9 рядків, повернені 7, нові 3; Boundary з голови повернених | 10 рядків, починаючи з першого поверненого |
| CurrentRows | дві компактизації | транскрипт з трьох сегментів, голови однакові | від останнього входження голови |
| CurrentRows | гаряче перезавантаження | Boundary з `host` = `hostId`; модуль перезавантажено в тому самому процесі (токен HOST_ENV і ppid ті самі) | межа довірена; рядки від неї |
| CurrentRows | інший процес | Boundary з `host` іншого процесу (перезапуск, `--resume`) | увесь транскрипт |
| CurrentRows | межа без `host` | Boundary без поля `host` (зокрема записана версією до цього правила) / з `host` не рядком; записана не цим екземпляром | увесь транскрипт (межа читається, `host` ігнорується) |
| CurrentRows | власна межа без `host` | `hostId` відсутній; цей екземпляр записав Boundary у цій сесії (`ownBoundary` = текст файлу) | межа довірена; після перезавантаження модуля або зміни сесії — увесь транскрипт |
| CurrentRows | `/resume` у тому самому процесі | процес записав Boundary сесії A з `host` = `hostId`; `/clear`, потім `/resume` A в тому самому процесі | підготовка сховища A знімає `host` з її межі; CurrentRows — увесь транскрипт |
| CurrentRows | перша підготовка після завантаження | модуль щойно завантажено (зокрема гаряче перезавантаження), Boundary поточної сесії з `host` = `hostId` | `host` не знімається; межа довірена. Залишкове вікно: гаряче перезавантаження між `/resume` у тому самому процесі і наступним PrepareStorage старого екземпляра лишає `host` — новий екземпляр довіряє межі над завантаженим ланцюжком; так само, коли перше після перемикання PrepareStorage припало на обробник компактизації, а обіцянка ще не виконана |
| CurrentRows | ідентичність не прочиталась | `sh -c 'echo $PPID'` не вдалася або вивід не десяткове число, або `$.env.set` не вдався | `hostId` відсутній; RecordBoundary пише Boundary без `host`; довіра лише до власної межі екземпляра |
| ParseHostId | розбір | (`k3x9…`, `"12345\n"`) / (`k3x9…`, `"abc"`) / (`""`, `"12345"`) / (`k3x9…`, `""`) | `k3x9…:12345` / відсутній / відсутній / відсутній |
| hostId | ще не прочитано | обробник компактизації (лише HandleCompaction, HandleSeed, спостерігач) пише межу, поки обіцянка `hostId` не виконана | не чекає і процесу не запускає; Boundary без `host`; межа — власна межа екземпляра |
| CurrentRows | перший перелік після перезавантаження | обіцянка `hostId` ще виконується; Boundary з `host` = `hostId` | чекає обіцянку; межа довірена; `Key()` не змінюється після її виконання |
| CurrentRows | межа поза вікном | голови в транскрипті немає | увесь транскрипт |
| CurrentRows | замало рядків після збігу | збіг голови, але `len - p < count` | цей збіг не підходить |
| RecordBoundary | запис | 12 повернених рядків | `head` — 8 відбитків, `count` 12 |
| RecordBoundary | `host` | `hostId` є / відсутній | Boundary з `host` = `hostId` / без `host`; в обох випадках `ownBoundary` = записаний текст |
| RecordBoundary | спостерігач | `manual`, `auto`, `plugin` з іншими інструкціями / MARKER або HANDOFF_MARKER з `manual` чи `plugin`, `precompute`, `agentId`, `skip`, порожній результат | межа / немає межі |
| PrepareEdits, context_tag | застарілі індекси | межа змінилась після переліку; collapse, rewrite, тег за `index`, summarize за id | правки й тег за індексом відхилено, summarize і тег за id прийнято |
| HandleCompaction | довгий текст у `data` | пара з заархівованим медіа і довгим текстом у `data` | текст лишається, замінено лише base64 |
| HandleCompaction | архів без дубля медіа | summarize пари з PNG у `result` виклику і результату | у JSON архіву base64 замінено на `[media archived: …]`; інші поля без змін |
| context_list, context_edit, context_tag, context_handoff | опис інструмента | описи чотирьох інструментів | кожен ≤ MAX_DESCRIPTION |
| ApplyEdits | summarize | пара `a`, результат 5000 символів | рядки пари перезібрано, спільний id `a_ce…`, виклик без `text`, результат містить summary; рядки без результатів зберігають `handle`, крім рядків асистента того самого відрізка, що й перезібраний рядок `tool_use a` — і до, і після нього (KeepResponsesWhole) |
| ApplyEdits | collapse | рядки 2..5 з двома парами | 2 рядки-носії з новим id, `4 rows collapsed`; вміст наступного рядка не змінено (рядок асистента того самого відрізка перезібрано без `handle` — KeepResponsesWhole) |
| ApplyEdits | collapse зі службовим викликом першим | діапазон, що починається з виклику `context_list` | носій — перший не службовий виклик; після DropOwnCalls підсумок присутній |
| ApplyEdits | collapse без викликів | діапазон лише з текстових рядків | один рядок з підсумком |
| ApplyEdits | drop | пара `c` | рядки пари зникли |
| ApplyEdits | перекриття | summarize `b` + collapse 2..5 | одна застосована, одна в `failed` |
| ApplyEdits | паралельні виклики | summarize двох паралельних викликів з тих самих рядків | обидві застосовано, обидва результати змінено, ідентифікатори пар збігаються |
| ApplyEdits | медіа сусідньої пари | summarize `p`, у тому самому рядку результат `q` з медіа | `failed` `row also holds media of q`; рядок зберігає `handle`; з summarize `q` у тому самому пакеті й заархівованим медіа — обидві застосовано |
| ApplyEdits | медіа в промптах не зіставлено | collapse діапазону з рядком промпту, `unmatchedPromptMedia = 1` | `failed`; рядок зберігає `handle` |
| ApplyEdits | вікно API | незмінений рядок результату, id якого немає в knownResults | рядок зберігає `handle` |
| ApplyEdits | правка поза вікном | summarize пари, рядок результату якої має id поза knownResults; collapse з таким рядком; collapse з промптом до першого відомого результату при `apiTruncated = true` | `failed` `outside the API window; media unknown` |
| ApplyEdits | промпт перед першою парою, повне подання | collapse промпту людини і першої пари; API-подання повне (`len(api) < ROW_WINDOW − 1`, `apiTruncated = false`), усі результати в knownResults | застосовано |
| ApplyEdits | промпт перед першою парою, обрізане подання | те саме, `len(api) ≥ ROW_WINDOW − 1` (`apiTruncated = true`) | `failed` `outside the API window; media unknown` |
| ApplyEdits | носій без input | collapse з викликом великого інструменту | у носія `input = {}` |
| DropOwnCalls | спільний рядок | службова пара в рядку з результатом, що має медіа або id поза knownResults | службова пара лишається, рядок зберігає `handle` |
| ApplyEdits | зсув | rewrite #6, на початок додано рядок | застосовано до #7 |
| ApplyEdits | якір не знайдено | rewrite #6, рядок змінено | `failed` з причиною |
| ApplyEdits | архів не записано | archive `""` | немає `original:` у тексті |
| ApplyEdits | незмінений рядок з медіа | mediaOwners містить власника незачепленого результату | рядок зберігає `handle` |
| ApplyEdits | одна відповідь: текст і два Read | відрізок: промпт; рядок асистента з текстом; `tool_use a`; результат `a`; `tool_use b`; результат `b` з медіа (усі з `handle`); summarize `a` | рядок `tool_use a` і результат `a` перезібрано; рядок `tool_use b` теж перезібрано (KeepResponsesWhole); результат `b` з медіа зберігає `handle`; рядок тексту перед ними теж перезібрано (вміст той самий, без `handle`) |
| ApplyEdits | без перезібраного асистента у відрізку | правка лише рядка результату (рядки асистента відрізка не змінено) або перезібраний рядок асистента в іншому відрізку | жоден інший рядок асистента цього відрізка не перезібрано |
| ApplyEdits | рядок лише з thinking | у відрізку з перезібраним рядком асистента — до нього або після — стоїть рядок асистента з `handle`, що має лише thinking (`text` порожній, викликів немає) | рядок перезібрано, він порожній і видалений |
| ApplyEdits | thinking перед зміненим викликом | відрізок: промпт; рядок лише з thinking; `tool_use a`; результат `a` (одна відповідь з thinking, усі з `handle`); summarize `a` | рядок thinking перезібрано й видалено; рядок `tool_use a` і результат перезібрано; жоден рядок асистента відрізка не має `handle` |
| DropOwnCalls | службовий виклик посеред відповіді | відрізок: текст, `context_list`, Read з медіа (одна відповідь) | пару `context_list` прибрано; рядок `tool_use` Read і рядок тексту перед ним перезібрано (вміст той самий); результат Read з `handle` |
| ApplyEdits | медіа не заархівовано | правка замінює власника з mediaOwners без шляхів у media | `failed` `media could not be archived` |
| ApplyEdits | describe | рядок промпту з медіа | текст починається з MARK, далі опис, далі оригінальний текст |
| FreshId | повторна правка | id з суфіксом `_ce…` | один суфікс |
| PrepareEdits | обов'язкові поля | summarize без summary; rewrite з порожнім text | `summary is required`, `text is required` |
| PrepareEdits | помилки | невідомий op; невідомий id; індекс поза межами; collapse розриває пару; rewrite рядка з викликом; describe рядка без медіа | відповідні причини з [SP_CTX_02_03](#SP_CTX_02_03) |
| PrepareEdits | pin | collapse діапазону з рядком `pin` | `target is pinned` |
| DropOwnCalls | службові виклики | пара `context_list` | пару прибрано |
| ApplyEdits | паралельні виклики в окремих рядках | промпт; рядок `tool_use x`; рядок `tool_use y`; рядок результатів `x`, `y` (усі з `handle`); summarize `x` і `y` | один рядок асистента без `handle` з обома викликами (FreshId, по порядку), одразу за ним рядок результатів; `produced` обох правок — цей рядок результатів |
| MergeCallRows | змішані рядки | текст агента; `tool_use a`; `tool_use b`; текст агента; рядок результатів; `tool_use c`; `tool_use d` з `handle` (рядки без `handle`, крім останнього) | текст перед викликами окремо; `a`, `b` і текст після них — один рядок; рядок результатів, `c`, `d` (з `handle`) — без змін |
| DropOwnCalls | службовий виклик між паралельними | `tool_use a`, `tool_use context_list`, `tool_use b` окремими рядками, спільний рядок результатів | службову пару прибрано; `a` і `b` — один рядок, за ним результати `a`, `b` |
| BuildSeed | паралельні виклики в окремих рядках | незмінені `tool_use a`, `tool_use c` окремими рядками, спільний рядок результатів | у засіві один рядок з обома викликами, за ним результати; CheckSeed приймає |
| context_list | сторінка | from 0, count 4 | `#0 user`, `#3! user`, `Next page: from=4`; після summarize — `#3* user` |
| context_list | порожня розмова | 0 рядків | `0 rows.`, далі телеметрія |
| context_list | лише телеметрія | `count: 0`, 12 рядків | заголовок з кількістю рядків і TelemetryText, жодного рядка `#…`, без `Next page`; `listedKey` не змінюється |
| context_list | позначки етапів і тегів | відкритий етап з `after` на #3; `state` на #5; `review` з `reason = stale` на парі в #7/#8; діапазон `disposable` #9..#11; Read у #12/#13 | `[stage ▶ <name>]` на #4; `[state]` на #5; `[review: stale]` на #7 і #8; `[disposable #9..#11: "…"]` на #9; `tool_use Read~` на #12 і `tool_result~` на #13 |
| context_list | `~` у змішаному рядку | рядок асистента з паралельними `Read` і `WebFetch` та їхній рядок результатів | `~` лише на частинах пари `Read`; частини `WebFetch` без `~` |
| context_list | останній закритий блок | `lastClosed = { name A, after #3, end #9 }` / без назви | `[block ▶ A]` на #4, `[block end]` на #9 / `[block ▶]` на #4; телеметрія `Last block "A" #4..#9 (~… tokens)` |
| context_list | кінець блоку загублено | `lastClosed.end` не знаходиться (вбудована компактизація) | позначки `[block end]` немає; телеметрія `...: its end row is gone`, а не `it is empty` |
| context_list | межа етапу зникла | `stage.after` не знаходиться (Locate — не знайдено) | `[stage ▶ …]` на #0; телеметрія: `its start row is gone, so it runs from #0` |
| context_list | початок блоку зник | `lastClosed.after` не знаходиться, `end` — #9 | `[block ▶ …]` на #0, `[block end]` на #9; телеметрія `Last block … #0..#9 (…); its start row is gone, so it runs from #0` |
| context_edit | помилки | черга `unreadable`; переповнення; збій запису; довгий resume_prompt | DENIED_QUEUE_READ, DENIED_QUEUE_FULL, DENIED_QUEUE_WRITE, DENIED_PROMPT_TOO_LONG; черга не перезаписана |
| context_edit | продовження | `resume:false`, потім застосування | звіт з `reportResume = false`; наступний пакет знову `resume = true` |
| HandleCompaction | збій запису архіву | запис архіву падає | skip; жодна правка не застосована; пакет очищено; звіт `originals could not be archived` для кожної правки |
| HandleCompaction | збій обробника | виняток у застосуванні | skip; черга очищена; звіт про збій |
| HandleCompaction | charsAfter | пакет з викликами `context_list` | `charsAfter` рахується після DropOwnCalls |
| FormatReport | форми | `kind = compaction`, applied порожній, failed [x] / `kind = seed`, обидва порожні / applied [y] | «no edit was applied; the conversation was not changed. Not applied: x.» без рядка розміру / порожній рядок (звіт передачі без переносу) / рядок розміру є |
| HandleCompaction | жодної правки | усі правки пакета `failed` (напр. ціль не знайдено) | skip `no edit could be applied`; звіт `context-editor: no edit was applied; the conversation was not changed. Not applied: …` без рядка розміру і без «tokens freed» |
| HandleCompaction | правки застосовано | ≥ 1 правку застосовано | звіт з рядком `Conversation ~A -> ~B chars (~N tokens freed)` |
| BuildSeed | засів без правок | черга порожня або всі правки `failed`; у рядках є виклик `context_list` | звіт нової сесії без рядка розміру; без `failed` — без речення про правки взагалі; з `failed` — `no queued edit was applied. Not applied: …` |
| BuildSeed | засів з правками | ≥ 1 правку застосовано; у рядках є незмінена пара з медіа | рядок розміру: `charsBefore` — видимі рядки, `charsAfter` — після ApplyEdits і DropOwnCalls, до CarryNote і голови |
| DeliverReport | один раз | звіт у черзі, два промпти людини поспіль | звіт додано лише до першого |
| DeliverReport | порада з промптом людини | `optimize` є, `lastClosed` — етап «A», один `disposable` у ньому | прихований контекст — PersonAdvice з назвою «A», ListHint і STAGE_ADVICE, без індексів; замін з тегів не поставлено, рядків розмови не читано; після входу `optimize` знято, `listedKey` не змінено |
| DeliverReport | ADVICE_FAILED | побудова PersonAdvice кидає виняток | промпт без поради; після входу `optimize = false` |
| DeliverReport | збій поради | побудова поради кидає виняток | промпт іде без поради (зі звітом, якщо він є); після входу `optimize` знято |
| DeliverReport | без блоку | `optimize = true`, реєстр `unreadable` або без `lastClosed` | ADVICE_NO_BLOCK: промпт без поради; після входу `optimize = false` |
| DeliverReport | INTRO_NOT_RECORDED | промпт з INTRO_TEXT увійшов, запис `introduced = true` падає | наступний промпт знову несе INTRO_TEXT |
| SessionIntro | перший промпт | реєстр відсутній або `introduced = false`, промпт людини | прихований контекст починається з INTRO_TEXT; після входу `introduced = true`; другий промпт без INTRO_TEXT |
| SessionIntro | нова сесія | `/clear`, потім промпт людини | сховище нової сесії, реєстру немає — INTRO_TEXT знову |
| SessionIntro | промпт відхилено | нижчий обробник повертає `drop` | `introduced` лишається `false` |
| SessionIntro | реєстр нечитабельний | TagRegistry `unreadable` | INTRO_TEXT не додається |
| SessionIntro | перезавантаження модуля | `introduced = true`, модуль перезавантажено | INTRO_TEXT не повторюється |
| SessionIntro | INTRO_TEXT | константа | ≤ 1000 символів; містить OPTIMIZE_MARK дослівно, `"op":"open"`, `"op":"close"`, `"count":0` і `context-editor:` + SKILL |
| SKILL.md | файл навички | `mods/context-editor/skills/<SKILL>/SKILL.md` | `name` = SKILL; `description` ≤ 250 символів; є всі розділи таблиці [SP_CTX_02_27](#SP_CTX_02_27); ≤ 8000 символів; `claude plugin validate` проходить |
| Flush | запуск | хід завершено, у черзі 2 правки | після FLUSH_DELAY — одна команда `compact` з аргументом MARKER |
| Flush | хід оптимізації без пакета | `optimize` є, черга порожня (агент нічого не ставив, тегів `disposable` немає), хід не зсунувся | команди немає; рядків розмови не читано; один промпт OptimizeText з порадою зупинитися (`resume: false`); перед відправкою `optimize = false`, `optimizePrompted = true` одним записом |
| Flush | хід оптимізації після пакета | `optimize` є, у черзі 2 правки агента з `resume = true`, `resume_prompt = P` і заміна з тегу | `compact MARKER` одним пакетом; один промпт: звіт застосування + OptimizeText з назвою блоку, ListHint і порадою про `resume: false`; текст P не пересилається; окремого промпту продовження немає; RemoveDelivered(звіт) після входу |
| Flush | людина почала хід | `optimize` є, `MovedSince(turns0)` перед командою або після неї | промпту ходу оптимізації немає (OPTIMIZE_PERSON); `optimize` лишається; звіт лишається для DeliverReport |
| Flush | промпт ходу оптимізації відхилено | `submit` повертає `drop` | `optimizePrompted = false`, `optimize = true` одним записом; звіт лишається; рядок стану (OPTIMIZE_FAILED) |
| Flush | людина під час команди | промпт людини проходить DeliverReport, поки Flush чекає `compact` | DeliverReport віддає звіт і пораду, `optimize = false`; Optimize бачить `MovedSince(turns0)` перед заміною (або порівняння-і-запис не застає `optimize`) — OPTIMIZE_PERSON, `optimizePrompted` не записано, промпт не надіслано |
| OptimizeText | без індексів | блок `lastClosed` з назвою «A» / без назви; `compacted = true` / `false` | текст містить `stage "A"` / `the last block (no stage)`, ListHint (`Last block #<a>..#<b>`, `from=<a>`), STAGE_ADVICE, пораду зупинитися (`"resume": false`), без лічильника замін з тегів; речення `The batch queued in that turn, with the replacements from your disposable tags, was processed…` лише при `compacted = true`; жодного індексу рядка, розміру чи кандидатів; `listedKey` не змінено |
| OptimizeText | ListHint при загубленому кінці | `lastClosed.end` загублено, `start` — #4 | заголовок переліку `Last block … from #4: its end row is gone`; ListHint посилається на `from=<a>` з цього рядка |
| OptimizeText | усі правки пакета не застосовано | `compacted = true`, звіт «no edit was applied» | речення про оброблений пакет і «see the report above», без «applied» |
| Flush | OPTIMIZE_BUILD_FAILED | OptimizeText кидає виняток; пакет не просив / просив продовження (`compacted AND reportResume`) | промпту ходу оптимізації немає, `optimizePrompted` не записано; `optimize` лишається `true` / `optimize = false` і Resume з `reportPrompt` |
| Flush | `compacted` за `reportId` | команда виконалась, але обробник відповів `skip` «no queued edits» без запису звіту | `compacted = false`; з `optimize` — OptimizeText без речення про пакет; без `optimize` — Resume нічого не надсилає (нового звіту немає) |
| Flush | OPTIMIZE_NO_BLOCK | після застосування реєстр `unreadable` / `lastClosed` відсутній | `optimize = false`; рядок стану; продовження застосування за `reportResume`, як без мітки |
| DetectOptimize | заміни на кінці ходу з міткою | мітка; у реєстрі `disposable` на парі `a`; агент поставив summarize `b` | QueueTagReplacements на рядках ходу ставить summarize `a` у ту саму чергу; Flush застосовує `a` і `b` однією компактизацією, потім промпт ходу оптимізації |
| DetectOptimize | MARK_NO_REPLACEMENTS | QueueTagReplacements кидає виняток | заміни не поставлено; блок закрито; `optimize = true` |
| DetectOptimize | запобіжник петлі | `optimizePrompted = true`; хід оптимізації завершився відповіддю з міткою останнім рядком / без мітки / перерваний | мітку проігноровано (MARK_IN_OPTIMIZATION); у всіх трьох випадках `optimizePrompted = false`; блок не закривається, `optimize` не пишеться |
| DeliverReport | людина взяла хід | `optimizePrompted = true`; промпт людини між ходами / повідомлення посеред ходу | після входу `optimizePrompted = false` / лишається |
| Flush | передача в черзі | правки + handoff | команда не запускається |
| Flush | людина почала хід | `turns` змінився, поки команда чекала; у звіті `reportResume = true` | промпт продовження не надіслано; `lastSubmittedReportId = reportId`; звіт лишається в черзі для DeliverReport |
| Лічильник ходів | промпт з цитатою мітки | промпт людини з текстом `context-editor: apply queued edits` (`turn.start` з цим текстом) | рахується як хід: `turns` +1, `inTurn`; після його кінця — звичайні кроки 02_06, 02_12, 02_21 |
| Лічильник ходів | команди мода | `$.command.run` `clear` і `compact` без подій ходу (Entry 4) | `turns`, `inTurn` і `TagRegistry.turn` не змінюються |
| Flush | продовження один раз | той самий reportId двічі | промпт продовження надіслано один раз |
| Flush | звіт доходить до ходу продовження | звіт `T` у черзі, `reportResume = true`, хід не зсунувся | надіслано один промпт `T + "\n\n" + reportPrompt`; після входу промпту RemoveDelivered(T): звіту в черзі немає; хук `prompt.submit` мода для цього промпту не викликається (F1) |
| AutoTag | копія промпту | у stream-json рядок промпту, повернений компактизацією, знову додається з `door = prompt`, `origin { kind: plugin, name: context-editor }`, `firstPromptPinned = false` | R1 не спрацьовує; реєстр без змін |
| AutoTag | копія великого результату | копія рядка результату Read 5000 символів з `origin.kind = plugin` | R2 і R3 не спрацьовують; тег не дублюється |
| context_tag | помилки | кожен рядок таблиці Errors [SP_CTX_02_11](#SP_CTX_02_11) | відповідний код |
| context_tag | відкриття без index | рядки #0..#9; рядок асистента з викликом `open` (`callId`) — #8, #7 — результат | `stage.after` = RowMark #7; результат `opened; its block starts at #8` |
| context_tag | рядок виклику ще не записано | `callId` не знайдено в рядках #0..#9 | `stage.after` = RowMark #9 |
| context_tag | межа не на thinking | перед рядком виклику — рядок лише з thinking (#7), перед ним результат (#6) | `stage.after` = RowMark #6 |
| context_tag | відкриття з index | `open` з `index: 4` / `index: 0` | `after` = RowMark #3 / `null` |
| context_tag | закриття | етап з `after` #3, рядок виклику `close` — #12 | `lastClosed = { name, after #3, end #11, turn }`; `stage` знято; результат — звіт блоку #4..#11 з телеметрією і STAGE_ADVICE; QueueTagReplacements один раз |
| context_tag | open при відкритому етапі | етап A відкрито, `open` B | звіт закриття A в результаті; `lastClosed` — блок A; `stage` — B з тією самою межею, що й кінець A |
| context_tag | закриття без етапу | `close`, етапу немає | NO_STAGE; `open` з `index` + `close` в одному виклику — блок від `index` закрито |
| context_tag | порожній блок | `close` одразу після `open` | звіт `no rows in it.` без STAGE_ADVICE |
| context_tag | REPORT_FAILED | `close`, BlockReport кидає виняток | етап закрито, реєстр записано; результат `Stage "<name>" closed; its report failed: <error>; call context_list` |
| BlockReport | без рядків | `close` одразу після `open` (`no rows in it.`) / кінець блоку загублено | `listedKey` не оновлено; другий випадок — текст `its end row is gone; call context_list.`, а не `no rows in it.` |
| Telemetry | порожній блок | `lastClosed.end = null` / `start > end` | `Last block … : it is empty` |
| BlockReport | межа індексів | 25 активних `review` з причиною `big` у блоці | `big #i, …` — 20 індексів (MAX_BLOCK_INDEXES), далі `+5 more` |
| context_tag | слот стану | `add state` на #5 (текст агента), потім `add state` на #9 | один тег `state` на #9; результат `The state slot moved from #5 to #9.` |
| context_tag | слот стану не там | `add state` на рядок з викликом / на результат за `tool_use_id` / рядок лише з thinking | BAD_TARGET |
| context_tag | діапазон | `add disposable` з `index: 4`, `to: 7`, note — пари цілі / `to: 5` розриває пару / у діапазоні `pin` / `to` з `pin` | тег-діапазон / BAD_RANGE / BAD_RANGE / BAD_RANGE |
| context_tag | зняття діапазону | `remove` з `index: 4` | тег-діапазон, що починається на #4, знято |
| context_tag | агентський review | `add review` на пару | `reason = agent` |
| context_tag | застарілі індекси етапу | `open` з `index` після компактизації без нового переліку | INDEXES_STALE |
| context_tag | загублена межа | `stage.after` і `lastClosed.end` не знаходяться; будь-який `add` | записаний реєстр має `stage.after = null`; `lastClosed.end` лишається тим самим RowMark (не `null`) |
| AutoTag | R5 однаковий результат | два Read по 5000 символів з однаковим текстом (різні виклики) | `review` з `reason = duplicate` на першій парі; друга без нового тегу (R2 — `big`) |
| AutoTag | R5 той самий діапазон | Read `f` з `offset 10, limit 50` двічі, тексти по 5000 символів різні (файл змінився) / `offset 10` і `offset 60` / той самий діапазон, тексти по 300 символів | перша пара — `duplicate` / тегу дубліката немає / тегу дубліката немає (менше BIG_ROW) |
| AutoTag | R5 паралельні виклики | рядок з результатами паралельних `Read` (5000) і `Grep` (5000), обидва тексти повторюють раніші | `duplicate` на обидві раніші пари; поле `Read` звіряється лише для результату `Read` |
| AutoTag | R5 перезапис | раніша пара має `review` `big` / `stale` / `pin` | стає `duplicate` / лишається `stale` / лишається `pin` |
| AutoTag | R5 рядок без результатів | два рядки `user` без результатів (двері `attachment`, текст 6000 символів однаковий), обидва в поточній розмові | `review` `duplicate` на раніший рядок за `anchor`; рядка в поточній розмові немає — тегу немає |
| MarkCall | R4 застаріле читання | Read `f` (пара `a`, тег `review big`), Read `g` (пара `b`), Edit `f` без помилки | на `a` — `review` `stale`; `b` без змін; результат Edit без доданого тексту |
| MarkCall | R4 не чіпає інших тегів | Read `f` з `pin` / з `disposable`; Edit `f` | теги лишаються |
| MarkCall | R4 відмова чи помилка | Edit `f` відхилено / з `isError` | тегів немає |
| MarkCall | R4 NotebookEdit | Read `n.ipynb`, NotebookEdit з `notebook_path` `n.ipynb` | пара Read — `stale` |
| MarkCall | без нагадувань | будь-який виклик без позначки при контексті 200k | результат незмінний |
| MarkCall | повторне читання | у журналі `apply` з `compressed` [`/p/f`]; Read `/p/f` | запис `reread { path: /p/f, archive: false }` |
| MarkCall | читання після власної зміни | `apply` з `compressed` [`/p/f`]; Edit `/p/f`; Read `/p/f` | запис `changed { path: /p/f }`; `reread` немає |
| MarkCall | R4 лише раніші читання | одна відповідь: Edit `f`, далі паралельний Read `f`; раніше — Read `f` у минулому ході | `stale` лише на раніше читання; Read після запису без тегу |
| MarkCall | читання архіву | Read `<storage>/<at>.json` / `<storage>/<at>/1.png` запису `apply` | `reread` з `archive: true` |
| Journal | застосування | HandleCompaction застосував summarize пари Read `/p/f` і drop пари Grep | запис `apply` з `freedChars = charsBefore − charsAfter`, `edits = 2`, `compressed = [/p/f]` |
| Journal | межа | MAX_JOURNAL записів, ще один | найстаріший видалено |
| Journal | нечитабельний | файл не JSON | записи пропускаються, файл не перезаписується; телеметрія `Effect: journal unreadable (…)` |
| Telemetry | рядок Messages | розбивка з `Messages` 12 000 (`used`), `totalTokens` 82 000, `autoCompactThreshold` 160 000, `tokens` є | `Context: conversation ~12k tokens; fixed part … ~70k; window …; auto-compaction in ~78k` |
| Telemetry | без рядка Messages | розбивки немає або в ній немає `Messages` | `Context: last request ~<tokens> tokens, the fixed part … included` |
| Telemetry | ще невідомо | `tokens` відсутній | `Context: size unknown yet …` |
| Telemetry | щойно після компактизації | `tokens` є, розбивка з `apiUsage = null` і `Messages` 15 | `Context: size unknown yet …`, а не «~15 tokens»; з `apiUsage` — `messages` |
| Telemetry | незмінна частина більша за запит | `tokens` 36 979, `totalTokens` 43 062, `Messages` 15 (живий прогін після `/compact` хоста) | `Context: last request ~37k tokens, the fixed part … included`, а не «conversation ~15» |
| Telemetry | сума трохи більша за запит | `tokens` 57 471, `totalTokens` 60 000, `Messages` 17 000 | `Context: conversation ~17k tokens` (міра лишається `messages`) |
| Telemetry | збій | `usage` кидає виняток | `Context: size unavailable (<error>)`; решта рядків є; перелік будується |
| Telemetry | автокомпактизація вимкнена | розбивка без `autoCompactThreshold` | `auto-compaction off` |
| Telemetry | кандидати | `review` big ×1, stale ×1, без `reason` ×1, `agent` з невичерпаним `ttl_turns` ×1; `disposable` ×1, ціль якого зникла | `review 3 (big 1, stale 1, agent 1); disposable 0` |
| Telemetry | слот стану | тег `state` знаходиться / не знаходиться / тегу немає | `State slot: #5` / `its row is no longer in the conversation` / `none` |
| DetectOptimize | мітка з відкритим етапом | останній рядок `answer` — OPTIMIZE_MARK, етап відкрито, рядки #0..#20 | `lastClosed = { name, after, end #20, turn }`; `stage` знято; `optimize = true` записано до кроку `TagRegistry.turn += 1` |
| DetectOptimize | без етапу | етапу немає, `lastClosed.end` — #8 | `lastClosed = { name відсутня, after #8, end #20 }` |
| DetectOptimize | без етапу, перший блок | етапів не було | `lastClosed = { after: null, end #20 }` |
| DetectOptimize | закрито інструментом у цьому ході | `lastClosed.turn = TagRegistry.turn`, відкрито новий етап | `lastClosed` і `stage` без змін; `optimize` записано |
| DetectOptimize | мітка не дослівно | останній рядок `[context-editor:optimize]` / `[Context-Editor: optimize]` | мітки немає |
| DetectOptimize | цитата посеред тексту | `answer`: «put [context-editor: optimize] on the last line», далі ще рядок / мітка з текстом у тому самому останньому рядку | мітки немає |
| DetectOptimize | останній рядок | `answer`: текст, порожній рядок, `  [context-editor: optimize]  `, порожні рядки в кінці | мітка діє |
| DetectOptimize | ігнорується | `handoff` є / черга `unreadable` / хід перервано / субагент | нічого не записано; рядок стану для `handoff` і `unreadable` |
| DetectOptimize | MARK_NO_STORAGE | сховище `unavailable` | нічого не записано; рядок стану `optimization mark ignored: storage unavailable` |
| DetectOptimize | MARK_REGISTRY_UNREADABLE | реєстр `unreadable` / запис реєстру падає | блок не закрито, `optimize` не записано; рядок стану з причиною |
| DetectOptimize | MARK_NOT_QUEUED | реєстр записано, а запис черги падає / повторне читання черги знаходить `handoff` | блок закрито в реєстрі; `optimize = false`; рядок стану `the block is closed, but no optimization turn: …` |
| RebindTags | межа після перегляду | `stage.after` — рядок результату `context_list` (#7), #6 — рядок асистента лише з викликом `context_list`, #5 — текст агента; застосовано summarize іншої пари | DropOwnCalls прибрав #6 і #7; `stage.after` — відбиток #5 з новим індексом |
| RebindTags | межа на переписаному рядку | `lastClosed.end` — рядок `rewrite` | межа на переписаному рядку (`report.produced`) |
| RebindTags | закриття, стискання і новий етап | закрито етап A (кінець — рядок результату останньої пари A, #11), відкрито B (`after` = той самий рядок); застосовано summarize цієї пари | `lastClosed.end` і `stage.after` B — рядок результату з FreshId; B починається після носія A, стиснутий хвіст A — у блоці A |
| RebindTags | найпізніший створений рядок | `lastClosed.end` — рядок асистента #7 з паралельними викликами `a` і `b`, результати яких у різних рядках; застосовано summarize `a` і summarize `b`; у кінцевому списку їхні рядки результатів — #9 і #10 | межа — рядок #10 (найбільший індекс серед `produced` правок, що замінили #7) |
| RebindTags | спільний рядок результатів | рядок #8 тримає результати паралельних викликів `a` і `b`; `lastClosed.end` — #8; застосовано summarize `a` і summarize `b` | `produced` має обидві правки з індексами в кінцевому списку; межа на рядку з найбільшим індексом серед них |
| ApplyEdits | `produced` після DropOwnCalls | summarize пари, чий рядок результату ділить службовий результат `context_list` | `produced.index` і `fingerprint` — рядка після прибирання службового результату |
| RebindTags | межа на згорнутому діапазоні | `stage.after` — #6, застосовано collapse 4..7 з носієм | межа на рядку результату носія |
| RebindTags | межа на прибраній парі | `stage.after` — рядок результату пари, яку прибрав `drop` | межа на найближчому попередньому рядку, що лишився |
| RebindTags | засів з CarryNote | `stage.after` — рядок результату незміненої пари з медіа, якому засів дописав CarryNote | межа на найближчому попередньому незміненому рядку засіву |
| RebindTags | межа на перезібраному рядку | `stage.after` — рядок асистента з `handle`, перезібраний KeepResponsesWhole без змін | межа лишається на ньому (відбиток той самий), `hint` оновлено |
| RebindTags | межа без попередників | межа на #1, пару #0/#1 прибрано `drop` | `null` |
| RebindTags | слот стану переписано | `state` на #5, застосовано `rewrite` #5 | тег `state` на переписаному рядку (`anchor` — відбиток `[context-editor] rewritten (original: …): <text>`) |
| RebindTags | діапазон | тег-діапазон #4..#7, застосовано summarize пари в #6/#7 / зсув на 2 рядки без правок у діапазоні | тег видалено / `hint` і `toHint` оновлено |
| RebindTags | заміна діапазону в пакеті | `collapse` 4..7 з `summary = note` діапазону | тег видалено (застосована чи відхилена) |
| RunHandoff | етапи в новій сесії | відкритий етап і `lastClosed`, `introduced = true` у старій сесії | у реєстрі нової сесії межі перенесено RelocateMark з `s.visible` на `s.rows`; `introduced = false` |
| PrepareEdits | слот стану | `state` на #5: rewrite #5 / collapse 3..6 / rewrite #5 після `remove` тегу | прийнято / `target holds the state slot…` / прийнято |
| HandleCompaction | слот стану при застосуванні | у черзі collapse 3..6, а `state` на #5 поставлено після постановки | `failed` `target holds the state slot` |
| ApplyEdits | примітка оригіналу | archive `/s/1.json` | текст заміни містить `(original: /s/1.json, open with Read)` |
| AutoTag | R1, R2, R3 | перший промпт людини; Read 5000 символів; Grep | `pin`; `review` з `reason = big`; `review` з `reason = search` і `ttl_turns = 3`; другий промпт без тегу |
| AutoTag | R1 у stream-json | перший промпт людини з `door = prompt`, `origin.kind = unclassified` (F3) | `pin`, `firstPromptPinned = true`; рядок з `origin.kind = plugin` — без тегу |
| QueueTagReplacements | заміни з тегів | два `disposable` при порожній черзі | дві правки, `tagsOnly = true`; після context_edit — `false` |
| QueueTagReplacements | діапазон | `disposable` з діапазоном #4..#7 і нотаткою N | правка `collapse` 4..7 з `summary = N` і якорями кінців; `freed` рахує суму `size` рядків діапазону |
| QueueTagReplacements | без повтору | `disposable` на парі `a`, його заміна вже в черзі (закриття етапу), потім мітка в тому самому ході | друга постановка нічого не додає (`queued = 0`) |
| QueueTagReplacements | слот стану в діапазоні | діапазон `disposable`, у який після тегування потрапив рядок `state` | PrepareEdits відхиляє `collapse`; черга без змін; тег лишається |
| RebindTags | після застосування | тег на змінену пару і на незмінену | перший видалено, другий лишився; псевдонім зміненої пари видалено |
| MarkCall | великий вивід | Read 5000 символів | рядок `[context-editor] id c1`; `last = c1` |
| MarkCall | малий вивід / службовий інструмент | Read 100 символів; `context_list` | без позначки |
| MarkCall | реєстр нечитабельний | — | без позначки, результат не змінено |
| ResolveRef | розв'язання | `last`, `c1`, `c99`, `ref` разом з `tool_use_id` | id; id; `unknown ref c99`; `ref and tool_use_id are exclusive` |
| context_tag | ціль за `ref` | `{op: add, kind: disposable, ref: last, note}` | тег на пару останнього позначеного виклику |
| AliasRegistry | межа | MAX_ALIASES + 1 позначок | найстаріший псевдонім видалено |
| PrepareStorage | права | команда встановлення прав завершується з помилкою | сховище `unavailable`, інструменти відмовляють DENIED_STORAGE |
| CollectMedia | медіа в результаті | `tool_result` з image base64 | власник `{tool_use_id}`, `data` присутні, `bytes` = довжина декодованих даних |
| CollectMedia | медіа посиланням | `tool_result` з document `source.type = url` | MediaRef без `data`; правка, що його замінює, — `media could not be archived` |
| CollectMedia | медіа в промпті | повідомлення людини з image | не в `found`; `unmatchedPromptMedia = 1` |
| CollectMedia | вікно | три `tool_result`, один без медіа | `knownResults` містить усі три id |
| CollectMedia | `apiTruncated` | 4096 / 4095 / 4094 повідомлень API-подання | true / true / false (поріг ROW_WINDOW − 1) |
| HandleCompaction | покинута диспетчеризація | `next.signal` перервано | skip `compaction abandoned`; черга не записується |
| HandleCompaction | недоставлений звіт | у черзі є попередній звіт | новий звіт дописано після старого |
| HandleCompaction | зберігає optimize | у черзі правки, `optimize = true`; застосування / відмова архіву / гілка збою | записана черга має `optimize = true` і те саме `optimizePrompted`, що було прочитано |
| DeliverReport | промпт відхилено | нижчий обробник повертає `drop` | звіт лишається в черзі |
| context_edit | нечитабельна черга | файл з полем не свого типу, JSON-масив, елемент `edits` не правка | файл перенесено (QUEUE_QUARANTINED), правки поставлено в нову чергу; без переносу — DENIED_QUEUE_READ зі шляхом |
| DeliverReport | дописаний звіт | під час входу промпту дописано новий звіт | видалено лише доставлений текст |
| Flush | відправка відхилена | `submit` падає або повертає `drop` | `lastSubmittedReportId` не змінюється; звіт лишається в черзі; попередження; наступний промпт людини отримує звіт через DeliverReport |
| Flush | хост відмовляє | `compact` падає з текстом T | одна спроба, без очікувань; черга лишається; рядок стану містить T |

Модульні тести: `mods/context-editor/tests/edits.test.ts` (ApplyEdits, PrepareEdits, DropOwnCalls, FreshId, CollectMedia, перегляд), `queue.test.ts` (розбір черги, context_edit, доставка звіту), `compaction.test.ts` (HandleCompaction через порти, збіг за інструкцією за будь-якого `trigger`, гілка HANDOFF_MARKER), `flush.test.ts` (Flush через порт FlushIO). Зв'язування портів з `$` (PrepareStorage, запуск команд хоста) перевіряється живими сценаріями. Теги — `tags.test.ts` (context_tag з етапами, слотом стану і діапазонами, AutoTag з R5, R4, QueueTagReplacements, RebindTags з межами етапів і слотом стану, розбір реєстру, перелік з тегами, позначками етапу і `~`) і `compaction.test.ts` (повторна перевірка `pin` і RebindTags у HandleCompaction). Передача — `handoff.test.ts` (context_handoff, розбір запиту в черзі, BuildSeed, CheckSeed, CheckSeeded, HandleSeed, пропуск компактизації, RunHandoff через порт: засів, збій до і після `/clear`, документ, відкладання, один запуск). Поточна розмова — `boundary.test.ts` (CurrentRows, RecordBoundary, розбір Boundary, застарілі індекси в правках і тегах, довжина описів) і `compaction.test.ts` (запис межі в HandleCompaction, межа спостерігача, архів без дубля медіа). Псевдоніми — `aliases.test.ts` (розбір реєстру, MarkCall, межа MAX_ALIASES, ResolveRef, `ref` у context_edit і context_tag, перелік з псевдонімами, очищення після застосування через порт HandleCompaction). Етапи, мітка і хід оптимізації — `stages.test.ts` (CloseStage, BlockReport, OptimizeText, PersonAdvice, DetectOptimize, Telemetry через порт `usage`, SessionIntro) і `flush.test.ts` (хід оптимізації, повторна перевірка й порівняння-і-запис, запасні шляхи до звичайного продовження); журнал — `journal.test.ts` (JournalApply, JournalReread, Trim, розбір файлу); вміст навички (рядок SKILL.md вище) перевіряють `claude plugin validate` і рев'ю за таблицею [SP_CTX_02_27](#SP_CTX_02_27), бо модулі мода не мають файлового API поза `$`. describe і PromptMatch не реалізовані (план PL_CTX).

### 05_02. Invariant Checks  {#SP_CTX_05_02}

| Invariant | Verification method |
|-----------|-------------------|
| Пари виклик—результат цілі | після ApplyEdits кожен id виклику має результат і навпаки (модульні тести); наживо — API не відхиляє запит |
| Справжнє підсумовування не запускається через мод | журнал налагодження після команди мода з MARKER або HANDOFF_MARKER: `a hook's N messages stand … core never ran` або `skip`; у неінтерактивному хості — `result` «Not compacted · <reason>» або засіяні/змінені рядки, ніколи підсумок; модульний тест: кожна гілка HandleCompaction і HandleSeed, зокрема збій, відповідає списком або `skip`; Flush і Seed не запускають команду, коли від планування почався хід (`MovedSince`). Гарантія не абсолютна. Залишкове вікно: хід, що почнеться за мілісекунди між перевіркою `MovedSince` і постановкою команди в чергу хоста, з вивантаженням модуля або невдалим гарячим перезавантаженням під час цього ходу, лишає в черзі хоста `/compact <MARKER>` без обробника — хост виконає справжнє підсумовування ([C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)) |
| Рядки команди несуть самопояснювальну мітку, і обробник бачить її ж | після застосування і після засіву транскрипт і API-подання містять рядок команди `/compact` з MARKER або HANDOFF_MARKER дослівно; журнал обробника — `instructions` дорівнює тому самому тексту (спайк context_editor_handoff_long, Entry 4, «Мітка в рядках команди») |
| Засіяна сесія переживає відновлення | `claude -p --resume <new>` новим процесом: модель бачить засіяні рядки, а не порожню розмову; перед межею у файлі сесії лише рядки `/clear` |
| Змінені тексти позначено | починаються з MARK |
| Файли мода доступні лише власникові | права каталогу `<HOME>/.claude/context-editor` — 700 |
| Не більше одного відкритого етапу і одного тегу `state` | модульні тести context_tag і DetectOptimize: після кожного запиту в реєстрі ≤ 1 `stage`, ≤ 1 тег `state` |
| `optimize` і `optimizePrompted` не обидва `true` | модульні тести Flush, DetectOptimize і DeliverReport: жоден запис черги не лишає обидва; заміна — порівнянням-і-записом |
| Межі етапів — розрізняльні рядки | після CloseStage, DetectOptimize, RebindTags і засіву кожна межа — `null` або відбиток рядка з ідентифікатором чи непорожнім текстом (Distinctive) |
| Чужі записи черги не гублять `optimize` і `optimizePrompted` | модульні тести HandleCompaction (усі гілки), context_edit, QueueTagReplacements, RemoveDelivered |

### 05_03. Integration Scenarios  {#SP_CTX_05_03}

Живі сценарії в окремому екземплярі Claude Code з розширенням (`--plugin-dir mods/context-editor --debug`) у двох хостах: інтерактивний термінал під керуванням tmux (драйвер `.dev_flow/cache/live-test/ce.sh`) і неінтерактивний хост з потоковим входом у режимі stream-json, яким його запускає розширення VS Code (`-p --input-format stream-json --output-format stream-json`; драйвер `.dev_flow/cache/handoff-long/drive.sh`). Разовий `claude -p "<prompt>"` поза межами ([SP_CTX_05_04](#SP_CTX_05_04)). Статус `pass (2026-10-08, після раунду 3)` — повторний прогін на коді після виправлень рев'ю раундів 1–3; просто `pass` — лише на прототипі до виправлень. Статуси pass до 2026-10-09 отримано на двох розширеннях (коміт b090f48), у терміналі; після переходу на одне розширення і компактизацію командою сценарії «Стиснення в межах сесії», «Три операції», «Скриншот у результаті інструменту», «Незмінене медіа», «Перегляд після компактизації», «Автоматичне чищення з тегів», «Захист початкового завдання» і всі сценарії передачі проганяються заново в обох хостах; доти їхній статус — історичний. Сценарій «Нагадування з початку» вилучено 2026-10-10 разом з Nudge ([SP_CTX_02_09](#SP_CTX_02_09)); його місце займають сценарії етапів, мітки оптимізації й авторозмітки зі статусом `pending (задача етапів)`. Події ходу від команд мода не очікуються (спайк context_editor_handoff_long, Entry 4); сценарії лише фіксують їхню відсутність у журналі. Хост — Claude Code ≥ 2.1.295.

| Scenario | Preconditions | Steps | Expected result | Status |
|----------|--------------|-------|-----------------|--------|
| Стиснення в межах сесії | файл 500 рядків `KEY_NNNN = hex` | прочитати; summarize, лишивши KEY_0042; спитати KEY_0377 без інструментів | KEY_0042 відомий, KEY_0377 «немає в контексті»; контекст 61.4k → 43.4k токенів | pass (2026-10-08, після раунду 3) |
| Три операції | той самий файл, файл-шум, неіснуючі файли, хибний висновок | drop, collapse, rewrite одним викликом | усі застосовано | pass (2026-10-08, після раунду 3) |
| Етап: закриття і стискання блоку (обидва хости) | 5 файлів по ~12k токенів; агент знає лише інструкцію на початку сесії й описи інструментів | завдання з двох фаз: «прочитай файли 1–3 і знайди найбільше KEY_0100», потім «те саме для 4–5»; агент сам відкриває і закриває етапи | агент відкрив етап `open`, після фази — `close`; результат закриття має межі `#a..#b`, ≈ токени, кандидатів, телеметрію і пораду; одна `context_edit` стиснула лише опрацьовані рядки блоку (Read → вказівник), промпти людини дослівно; після звичайних викликів інструментів жодного доданого тексту, крім рядків псевдонімів; відповідь big2 | pass 2026-10-10, коли людина просить працювати етапами (sonnet); без вказівки haiku етапів не відкриває, sonnet обирає мітку (`phase14-results.md`) |
| Мітка оптимізації, stream-json | drive.sh; черга порожня, тегів `disposable` немає; етап відкрито | агента просять у кінці відповіді поставити OPTIMIZE_MARK | після кінця ходу без жодної команди мода надіслано один промпт OptimizeText з порадою зупинитися (`resume: false`); він запускає хід оптимізації; промпт без індексів, агент спершу викликає `context_list`, і перелік показує `[block ▶ <name>]` і `[block end]`; агент стискає блок з `resume: false` і завершує хід; після застосування промпту продовження немає, звіт — з наступним промптом людини; мітка у відповіді ходу оптимізації (якщо агент її повторить) не діє | pass 2026-10-10 (2.1.295; `.dev_flow/cache/live-test/phase14-results.md`) |
| Мітка оптимізації, термінал | tmux (ce.sh), те саме | те саме | `turn.complete` у терміналі несе `answer` з міткою, а `$.prompt.submit` з відкладеної дії після кінця ходу без команди запускає новий хід (навичка plugin-hooks, пункт 38 — у терміналі не перевірялось); далі як у stream-json. Якщо промпт не запускає ходу — специфікацію переглядають до коміту | pass 2026-10-10 (2.1.295; `.dev_flow/cache/live-test/phase14-results.md`) |
| Мітка при непорожній черзі (обидва хости) | у ході з міткою агент поставив summarize з `resume_prompt` P; у реєстрі тег `disposable` | кінець ходу | заміна з тегу стала в чергу на кінці ходу з міткою; одна команда `compact MARKER` застосовує правку агента і заміну одним пакетом; потім **один** промпт: звіт застосування (з обома правками) + OptimizeText; текст P у промпті не пересилається, окремого промпту продовження немає; `context_list` агента в ході оптимізації показує межі блоку вже після застосування (в stream-json — коли повернені рядки вже в читанні); правки ходу оптимізації — друга компактизація, після неї продовження лише за `resume` агента в цьому ході | pass 2026-10-10 (2.1.295; `.dev_flow/cache/live-test/phase14-results.md`) |
| Людина випереджає хід оптимізації (stream-json) | мітка в кінці ходу | людина надсилає промпт одразу (до FLUSH_DELAY) | ходу оптимізації немає; прихований контекст промпту людини несе PersonAdvice з назвою блоку і вказівкою викликати `context_list`; `optimize` знято | pass 2026-10-10 (2.1.295; `.dev_flow/cache/live-test/phase14-results.md`) |
| Інструкція на початку сесії (обидва хости) | мод з навичкою в `skills/<SKILL>/` | перший промпт; другий промпт (просить назвати мітку оптимізації і пояснити її одним реченням, без нічого після); `/clear` і ще промпт | INTRO_TEXT прихованим контекстом лише першого промпту і першого після `/clear`; агент називає етапи й мітку посеред речення, і ходу оптимізації після цієї відповіді немає; навичка в переліку як `context-editor:<SKILL>` з описом, повний текст відкривається | pass 2026-10-10 (2.1.295; `.dev_flow/cache/live-test/phase14-results.md`) |
| Застаріле читання (обидва хости) | файл `f` | Read `f`; Edit `f`; `context_list` | на парі Read — `[review: stale]`; результат Edit без доданого тексту | pending (задача етапів) |
| Дублікат вставки навички (обидва хости) | навичка ~10k токенів | агент двічі відкриває ту саму навичку (`Skill`), між ними кілька ходів; `context_list` | записати: якими дверима (`tool-result`, `tool-message`, `attachment`) і з яким походженням текст навички проходить `session.append`, і чи стоїть він рядком у поточній розмові. Є рядком — R5 позначає ранішу копію `[review: duplicate]`; немає — R5 (б) для вставок не спрацьовує, і результат записується в навичку plugin-hooks і в 01_11 | pending (задача етапів) |
| Межа етапу після застосування (обидва хости) | розмова з кількома парами | `context_list`, потім одразу `context_tag open` (межа — після результату перегляду); summarize ранішої пари; кінець ходу; `context_list` | після застосування `[stage ▶ …]` стоїть на першому рядку після останнього рядка, що лишився перед переглядом (службові рядки прибрано); телеметрія називає той самий перший рядок | pass 2026-10-10 (2.1.295; `.dev_flow/cache/live-test/phase14-results.md`) |
| Вбудована компактизація при відкритому етапі (термінал) | етап відкрито, тег `state` на рядку агента | `/compact` людини; `context_list` | телеметрія: етап діє від `#0`, `State slot: its row is no longer in the conversation`; наступний `context_tag` пише `stage.after = null` | pass 2026-10-10 для етапу і блоку; частина зі слотом стану — фаза 15 (`phase14-results.md`) |
| Слот стану (обидва хости) | тег `state` на рядку агента | `rewrite` цього рядка; потім collapse діапазону з ним | `rewrite` застосовано, `[state]` на переписаному рядку; collapse відхилено з причиною слоту стану | pending (задача етапів) |
| Самостійне стиснення | ті самі 5 файлів | те саме | стискає кожен файл після читання; відповідь big2 | pass |
| Дослідження з веб-пошуком | — | порівняння векторних БД | 10 правок, ~42.6k → ~22.9k символів | pass |
| Стиснення в неінтерактивному хості | stream-json (drive.sh), файл 500 рядків `KEY_NNNN = hex` | прочитати; summarize, лишивши KEY_0042; кінець ходу; спитати KEY_0377 без інструментів | компактизація командою з `trigger: 'manual'`; продовження надіслано один раз; агент отримав звіт (у його наступному ході є текст `context-editor: applied 1 edit(s)`, у черзі звіту більше немає); KEY_0042 відомий, KEY_0377 «немає в контексті»; AutoTag не поставив тегів копіям рядків | not run |
| Завершення команди після обробника (обов'язковий, обидва хости) | термінал і stream-json; одне застосування правок і одна передача засівом | журнал з часовими мітками: відповідь обробника компактизації, завершення `$.command.run('compact')`, читання черги Flush / CheckSeeded | `$.command.run` завершується після відповіді обробника в обох хостах; інакше Flush не побачить звіту, а AfterClear очистив би вдалий засів — тоді специфікацію переглядають до коміту | not run |
| Мітка в розмові (обов'язковий, обидва хости) | термінал і stream-json; одне застосування правок | після продовження спитати агента, які рядки з `/compact` він бачить і що вони означають | правки застосовано (KEY_0377 «немає в контексті»); агент бачить `/compact context-editor: apply queued edits` і позначку виконання і пояснює їх як застосування правок мода, не як підсумок; `instructions` обробника дорівнює MARKER | not run |
| Мод вимкнено | черга з правками у файлі сесії, мод не завантажено | завершити хід; потім увімкнути мод і завершити ще один хід | без мода компактизації немає; після ввімкнення правки застосовано після першого завершеного ходу | not run |
| Скриншот у результаті інструменту | PNG з написами | прочитати; summarize з описом | опис у контексті, медіа-файл в архіві відкривається | pass (2026-10-09, фаза 2) — деталі поза описом агент не знає; архівний PNG байт у байт з оригіналом, 0600, Read його відкриває |
| Документ у результаті інструменту | PDF | прочитати; summarize | те саме | pass (2026-10-09, фаза 2) — блок `document`, `application/pdf`, base64; архівний PDF збігається з оригіналом, 0600 |
| Паралельні виклики після застосування (обидва хости) | два файли | «прочитай X і Y паралельно (обидва Read в одній відповіді)», потім один `context_edit` зі summarize обох; кінець ходу; спитати про результати; окремо — summarize лише X | у журналі налагодження немає `ensureToolResultPairing`; модель бачить обидва підсумки (і незмінений Y), без «Tool result missing»; записати, як хост пише результати паралельних викликів — одним рядком чи кількома | pass 2026-10-10 (2.1.295; `.dev_flow/cache/live-test/phase14-results.md`) |
| Незмінене медіа (обидва хости) | два скриншоти, прочитані в одній відповіді, перед викликами Read — рядок тексту агента | summarize першого | другий агент бачить; помилки «Tool result missing» немає; рядок другого лишився з `@` | not run (попередній pass фази 2 — без рядка тексту перед викликами, де розриву відповіді не виникало; Verify фази 10 знайшов розрив — знахідка C) |
| Зображення в промпті людини | скриншот у промпті | describe | залежить від [SP_CTX_DEC_06](#SP_CTX_DEC_06) | blocked |
| Тег за псевдонімом | 5 файлів | після кожного Read агент ставить `disposable` з `ref: last`, без `context_list`; потім закриває етап | жодного `context_list`; теги на правильних викликах; заміни застосовано після закриття етапу | pass (2026-10-08, фаза 7) — тоді заміни на порозі нагадування; частина про закриття етапу — pending (задача етапів) |
| Автоматичне чищення з тегів (обидва хости) | 5 файлів, етап відкрито | агент ставить `disposable` з нотатками (зокрема діапазон глухого кута), потім закриває етап, нічого не додаючи | заміни (і `collapse` діапазону) поставлено закриттям і застосовано після кінця ходу; пакет лише з тегів не продовжує сесію | pending (задача етапів; до 2026-10-10 — pass 2026-10-08, фаза 3, на порозі нагадування) |
| Захист початкового завдання | довга сесія | collapse діапазону з першим промптом | відхилено (`pin`) | pass (2026-10-08, фаза 3) |
| Перегляд після компактизації | дві компактизації мода і одна `/compact` | після кожної — `context_list` | у переліку лише поточна розмова, без копій старих рядків; правка за індексом з переліку застосовується до того самого рядка | pass (2026-10-09, фаза 8) — перелік 15 і 22 рядки при транскрипті 25 і 54; `rewrite` #5 змінив саме цей рядок; після `/compact` 7 рядків від підсумку хоста |
| Гаряче перезавантаження (обидва хости) | одне застосування правок у сесії; межа записана з `host` | змінити файл мода, щоб хост перезавантажив модуль; `context_list`; collapse раннього відрізка з промптом людини | перелік починається від межі (довіра збережена); collapse застосовано при повному API-поданні; після перезапуску процесу з `--resume` — перелік усього завантаженого ланцюжка | pass (2.1.295, фаза 11) — термінал: зміна вмісту файлу копії мода; stream-json: перезавантаження лише через `/reload-plugins` (навичка, пункт 31); перелік від межі, згортання з промптом людини застосовано |
| Передача засівом (термінал) | розмова з Read великого файлу і скриншотом; агент ставить тег за псевдонімом `c1` на незмінену текстову пару (скриншот псевдоніма не отримує: MarkCall позначає лише текст від BIG_ROW) | summarize великого файлу і context_handoff в одному ході | процес у новій сесії; модель знає лише підсумок; пари викликів на місці; результат скриншота закінчується CarryNote, агент відкриває файл Read і називає деталь скриншота; `context_tag` з `ref: c1` у новій сесії знаходить ту саму пару; `claude --resume <new>` новим процесом показує засіяну розмову; стара сесія без змін | not run (попередній pass фази 9 — на способі файлу сесії, b090f48) |
| Передача засівом (неінтерактивний хост) | stream-json (drive.sh), та сама розмова | те саме | те саме; команди відновлення сесії мод не запускає; `-p --resume <new>` показує засіяні рядки | not run |
| Передача засівом зі зміненою парою з псевдонімом (обидва хости) | розмова з двома Read великих текстових файлів, кожен з псевдонімом (`c1`, `c2`) | summarize пари `c1` і context_handoff в одному ході; у новій сесії `context_tag` з `ref: c1` і з `ref: c2` | `ref: c1` — `unknown ref c1`; `ref: c2` знаходить ту саму незмінену пару | pass (2.1.295, фаза 11, обидва хости) — `ref c1` → UNKNOWN_REF, `c2` незміненої пари працює, `pin` збережено, межа з `host` |
| Передача довгої сесії після `/compact` | розмова з ключами до і після вбудованої `/compact`; процес перезапущено з `--resume`, щоб межа не була записана в цьому процесі | context_handoff | нова сесія починається з підсумку без рядка `read the full transcript at:`; модель знає ключ з підсумку і ключ з хвоста; звіт називає старт з підсумку | not run |
| Передача документом | те саме | context_handoff mode `document` з документом | нова сесія з документом першим промптом | not run (попередній pass фази 9 — на двох розширеннях) |
| Запасний шлях до очищення (обов'язковий, обидва хости) | збирач відмовляє (тестовий прапорець, напр. WINDOW_FULL); агент **не** передає документа, тож документ дає окремий запит до моделі (`$.model.fork`) | context_handoff без `document` | `$.model.fork` повертає документ і в терміналі, і в stream-json; спосіб `document` у новій сесії, причина у звіті нової | not run (попередній pass фази 9 — на способі файлу сесії, лише термінал) |
| Збій засіву після очищення | обробник засіву повертає засіяні рядки (`taken = true`), а CheckSeeded відмовляє (тестовий прапорець) | context_handoff з документом / без документа | друге `/clear` прибирає засіяну сесію; документ агента з причиною / повідомлення з ідентифікатором старої сесії і шляхом `seed.json`; стара сесія без змін, її правки в черзі | not run |
| Команда людини (обов'язковий, обидва хости) | — | `/handoff` між ходами | те саме, що інструмент; `/clear` і `/compact` з відкладеної дії обробника команди стають у чергу, а не відхиляються | not run (попередній pass фази 9 — `/handoff document` на двох розширеннях) |
| Відновлення сесії (лише текст) | «стиснення» без медіа: summarize текстового результату, відповідь перезібрано цілою (KeepResponsesWhole) | `claude --resume <id>`, спитати KEY_0377 | очікувано: підсумок пережив відновлення, KEY_0377 «немає в контексті» (навичка plugin-hooks, пункт 7; спайк context_editor_handoff_long, Entry 6) | pass (2.1.295, фаза 12, haiku з thinking) — обидва хости, новий процес `--resume` і `/resume` у тому самому процесі: ключа з оригіналу немає, підсумок є; після межі жодного рядка асистента з оригінальним `message.id`, жодного `ensureToolResultPairing`; до кроку 1 K — fail з thinking |
| Відновлення сесії (медіа або злиття відповіді) | summarize пари, поруч з якою лишився рядок з медіа з `handle`, або відповідь, частину якої повернено з `handle` | `claude --resume <id>`, спитати про змінену пару | очікувано: оригінали повертаються (батько до межі в копії рядка з `handle`; рядки асистента з тим самим `message.id`) — [C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05) | pass (2.1.295, фаза 11) — оригінал зображення повертається, як і очікувано; `context_list` у новому процесі — увесь завантажений ланцюжок |

### 05_04. Edge Cases and Boundaries  {#SP_CTX_05_04}

| Case | Input | Expected behavior |
|------|-------|-------------------|
| Порожня черга при запиті з MARKER | `edits = []` | skip |
| Жодну правку не знайдено | усі id перейменовано попередньою правкою | skip; звіт з причинами |
| Хост відхиляє команду компактизації | виняток з текстом | одна спроба; черга лишається, текст відмови в рядку стану; наступна спроба — після наступного завершеного ходу |
| Команда чекає кінця ходу | людина надіслала промпт між плануванням і перевіркою перед `/compact` / між перевіркою і виконанням | команди немає (PERSON_MOVED): Flush заплановано знову кінцем того ходу або одразу, якщо він уже скінчився не перерваним; після перерваного — черга чекає наступного завершеного ходу / команда виконується після цього ходу, продовження не надсилається, звіт іде з наступним промптом людини (PERSON_ACTIVE). Залишкове вікно: хід, що почнеться за мілісекунди між перевіркою `MovedSince` і постановкою команди в чергу хоста, з вивантаженням модуля або невдалим гарячим перезавантаженням під час цього ходу, лишає в черзі хоста `/compact <MARKER>` без обробника — хост виконає справжнє підсумовування |
| Разовий `claude -p "<prompt>"` | черга з правками після останнього ходу | після останнього ходу сесію не прив'язано: `$.command.run` відхиляється («no session is bound in this process»), текст — у рядку стану, якщо він є; нічого не застосовано; черга лишається у файлі сесії і застосується після першого завершеного ходу, коли сесію відновлять у підтримуваному хості |
| Передача після `--resume` відредагованої сесії | читання — завантажений ланцюжок (навичка, пункт 7): з медіа чи злиттям рядків однієї відповіді — з оригіналами й дублікатами тих самих ідентифікаторів викликів; межа іншого процесу не довірена | очікувано: BuildSeed відмовляє (NO_SUMMARY, коли копії змінених пар поза API-поданням) або CheckSeed відмовляє (`repeated call id`); у обох випадках — спосіб `document` у старій сесії з причиною у звіті |
| Хід перервано | — | Flush не запускається |
| Звичайна `/compact` людини | інструкція ≠ MARKER і ≠ HANDOFF_MARKER | обробник передає далі, черга не чіпається; межу записує спостерігач |
| `/compact` людини з текстом MARKER | інструкція = MARKER | обробляється як запуск мода |
| `/compact` людини з текстом HANDOFF_MARKER | засіву в пам'яті немає | skip SKIP_NO_SEED, розмова без змін |
| Перезавантаження модуля | черга непорожня або запит передачі `queued`; Flush чи RunHandoff вже заплановано | гаряче перезавантаження відкидає заплановані таймери старого екземпляра (Verify фази 10, 2026-10-09, F6), а `scheduled` і `handoffScheduled` нового — false; правки застосовуються, а передача запускається після наступного завершеного ходу: черга і запит лежать у файлі |
| Запис старої черги після засіву не вдався | HandedOff не записав стару чергу (диск, права) | нова сесія засіяна, звіт і продовження доставлено; спливне повідомлення називає крок HandedOff, каже, що стара сесія `<old>` досі тримає запит `running`, і радить `/handoff cancel` у ній; якщо стару сесію відновлять без цього, після HANDOFF_STALE її захоплення побачить `<id>/seed.json` цього запуску і зніме запит зі звітом «not re-run» ([SP_CTX_02_21](#SP_CTX_02_21)) — повторної передачі немає |
| Перезавантаження модуля посеред передачі | між `/clear` і компактизацією засіву | нова сесія лишається порожньою; запит у старій черзі — `running` до HANDOFF_STALE; файл засіву лишається в сховищі старої сесії |
| Мод вимкнено | черга непорожня | компактизацію ніхто не запускає; черга чекає в файлі сесії |
| Рядки, повернені компактизацією, у stream-json | кожен рядок знову проходить подію додавання з `origin.kind = plugin` | AutoTag їх пропускає; теги не дублюються |
| `/clear` або `/resume` у тому самому процесі | сесія змінилась без старту сесії | перед наступною операцією сховище готується для нової сесії; черга і звіт попередньої лишаються в її каталозі |
| Другий процес хоста з тією самою сесією | обидва процеси читають один файл черги і одну межу | кожен процес запускає команду лише після свого ходу і лише у своїй розмові; правки, чиї цілі не знайдено, — `failed`. Межа перемикається: компактизація одного процесу пише Boundary зі своїм `host`, і другий процес до власної компактизації бачить увесь транскрипт (а його `context_list` — інші індекси), потім навпаки |
| Передача, коли модель бачить не всі рядки | після вбудованої компактизації, межа якої не записана в цьому процесі | засів з підсумку і видимих рядків ([SP_CTX_02_22](#SP_CTX_02_22)); правки рядків до підсумку — `failed` |
| Передача заповненої розмови | 4096 рядків без межі | спосіб `transcript` відмовляє (WINDOW_FULL), далі `document` |
| Перерваний промпт у новій сесії до засіву | людина надіслала промпт одразу після `/clear` і перервала його до першого рядка агента | HandleSeed не бачить рядка агента і засіває сесію, замінюючи цей промпт засіяними рядками; прийнято: промпт перервано, і він лишається у файлі сесії перед межею |
| Хід почався в новій сесії до засіву | людина надіслала промпт одразу після `/clear` | TURN_IN_NEW: Seed (`inTurn` або `MovedSince(turnsClear)` перед командою) чи HandleSeed відмовляє; RunHandoff не очищає сесію вдруге; FailAfterClear — звіт у старій черзі і спливне повідомлення; повідомлення про збій через Deliver — у звіт черги нової сесії з `reportResume = false`, без промпту |
| Межі `e.messages` інші, ніж у API-поданні | рядки з результатами поза API-вікном | такі рядки зберігають `handle`; Locate за підказкою може влучити в дублікат відбитку — перевіряється спайком [SP_CTX_DEC_06](#SP_CTX_DEC_06) |
| Сесія довша за ROW_WINDOW рядків | — | перегляд і правки охоплюють лише останні ROW_WINDOW; старіші id відхиляються як невідомі |
| Два промпти з однаковим текстом і медіа | — | PromptMatch «немає», describe відхиляється |
| Медіа посиланням, без даних | — | правка в `failed` |
| collapse діапазону з медіа | діапазон зі скриншотом | медіа заархівовано, шлях у тексті носія |
| Тег на пару, яку потім змінив агент | — | тег видаляється, заміна з тегу не ставиться |
| `pin` після постановки правки | правка в черзі, потім `pin` | при застосуванні правка `failed` |
| Перший рядок — промпт розширення | — | R1 чекає промпту людини |
| `HOME` не задано | — | сховище `unavailable`; мод нічого не пише |
| Етап закрито, а в блоці нема чого стискати | агент після `close` нічого не ставить | без тегів `disposable` черга порожня — компактизації немає; з ними — пакет лише з тегів, без продовження |
| Відкриття етапу при відкритому етапі | `open` B, поки відкрито A | A закривається з межами блоку і порадою (звіт у результаті), потім відкривається B |
| Закриття без відкритого етапу | `close` | NO_STAGE з порадою: `open` з `index` першого рядка і `close` в одному виклику |
| Мітка, процитована посеред відповіді | агент пояснює людині, як просити оптимізацію, і пише мітку в реченні | мітка не діє: діє лише окремий останній непорожній рядок |
| Мітка оптимізації без відкритого етапу | мітка, етапів немає або всі закриті | блок без етапу від кінця останнього закритого блоку (або від голови) до кінця ходу ([SP_CTX_DEC_14](#SP_CTX_DEC_14)) |
| Людина почала хід до ходу оптимізації | промпт людини до відправки промпту ходу оптимізації | ходу оптимізації немає; заміни з тегів уже в черзі з кінця ходу з міткою (застосовані перед промптом або застосуються з правками ходу людини); назва блоку й порада — прихованим контекстом промпту людини (PersonAdvice) |
| Черга непорожня на кінці ходу з міткою | правки агента або заміни з тегів, які DetectOptimize поставив на кінці ходу з міткою | застосування одним пакетом, потім один промпт ходу оптимізації зі звітом, без тексту продовження черги; межі блоку перегляд показує після застосування; правки ходу оптимізації — друга компактизація (дві компактизації лише в цьому випадку) |
| Закриття етапу інструментом і мітка в тому самому ході | `close`, потім мітка у відповіді | мітка стосується блоку щойно закритого етапу; відкритий після нього етап лишається |
| Мітка у відповіді ходу оптимізації | `optimizePrompted = true` | мітка ігнорується; прапорець знімає кінець цього ходу |
| Мітка при запиті передачі | `handoff` у черзі | мітка ігнорується, рядок стану; передача іде своїм шляхом |
| Діапазон захоплює слот стану | collapse або діапазон `disposable` з рядком `state` | правка відхиляється з причиною слоту стану; тег-діапазон — BAD_RANGE |
| Вбудована компактизація хоста (своя або людини) | етап відкрито, `lastClosed` і `state` є | межа відкритого етапу — `lost` (етап від голови), кінець закритого — невідомий («its end row is gone», не порожній блок); перегляд і телеметрія про це кажуть; `state` — «row is no longer in the conversation», тег видаляє наступне застосування мода |
| Рядок межі етапу замінено правкою | `summarize` пари, `collapse` діапазону, `rewrite` з рядком межі | межа переходить на останній рядок, створений правкою: стиснутий кінець блоку лишається в ньому, наступний етап його не захоплює |
| Рядок межі етапу прибрано без заміни або змінено засівом | `drop`, DropOwnCalls, KeepResponsesWhole (порожній рядок thinking), CarryNote засіву | межа переїжджає за найближчий попередній незмінений рядок, що лишився; перезбирання без зміни відбитка межі не рухає |
| Телеметрія недоступна | немає розбивки / немає рядка `Messages` / немає відповіді моделі / `usage` впав | весь запит з позначкою незмінної частини / те саме / «size unknown yet» / «size unavailable (<error>)»; перелік і звіт блоку будуються |
| Межа етапу на рядку лише з thinking | відкриття, коли перед рядком виклику стоїть рядок лише з thinking | межа стає на останньому рядку перед ним з ідентифікатором чи текстом (MarkBefore) |
| Промпт людини під час команди ходу з міткою | людина надсилає промпт, поки Flush застосовує чергу | DeliverReport віддає звіт і пораду і знімає `optimize`; Flush перевіряє `MovedSince` перед заміною і робить заміну порівнянням-і-записом — промпту ходу оптимізації немає, дубля за ходом людини немає |
| Перезавантаження між заміною і відправкою | `optimizePrompted = true`, а промпт ходу оптимізації так і не надіслано | кінець наступного ходу основної розмови або промпт людини між ходами знімає прапорець; мітка в наступній відповіді ігнорується лише один раз |
| Перезавантаження модуля між міткою і Flush | `optimize` записано, заплановану дію скасовано (F6) | хід оптимізації не запускається; наступний промпт людини несе PersonAdvice |
| Мітка при недоставленому `optimize` | ще одна мітка, поки `optimize` ще є (хід між ними почав промпт, що оминає хуки мода) | `lastClosed` — новий блок до кінця цього ходу; `optimize` лишається `true`; порада одна — про новий блок |
| Етап закрито в перерваному ході | `close` у ході, який перервано, мітка в наступному | лічильник ходів не зріс, тож мітка бере блок того етапу як закритого «в цьому ході» |
| Застаріле читання через оболонку | файл змінено командою `Bash` (`sed -i`, `git checkout`) | R4 не спрацьовує ([SP_CTX_DEC_13](#SP_CTX_DEC_13)); агент може сам поставити `review` |
| Журнал нечитабельний | `journal.json` пошкоджено | записи пропускаються, файл не перезаписується; телеметрія показує причину; людина видаляє файл |
| Хід оптимізації перервано | людина перериває хід оптимізації | кінець перерваного ходу знімає `optimizePrompted`; пакет, якщо є, застосується після наступного завершеного ходу зі своїми налаштуваннями |
| Повторне читання архіву | агент читає `Read` файл `(original: …)` | запис `reread` з `archive = true`; оригінал повертається в кінець розмови, а не на своє місце ([C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)) |

## 06. Reversibility  {#SP_CTX_06}

### 06_01. Rollback Strategy  {#SP_CTX_06_01}

| Aspect | Rollback approach |
|--------|-------------------|
| Data/state changes | Розмови, змінені в поточних сесіях, лишаються зміненими до кінця сесії; після `--resume` хост може повернути оригінали — через батька до межі в копії рядка, поверненого з `handle`, і через рядки асистента з тим самим `message.id` ([C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05); навичка plugin-hooks, пункт 7); текстові правки з перезібраною цілою відповіддю переживають відновлення. Засіяні сесії — звичайні сесії хоста; їх відновлення показує засіяну розмову і без мода |
| Artifacts | Видалити `<HOME>/.claude/context-editor/` (черги, реєстри тегів і псевдонімів, межі, журнали ефекту, архіви, медіа-файли, файли засіву, лишені файли `editor-ready`); після цього шляхи до архівів і перенесеного медіа в текстах засіяних сесій ведуть у нікуди. Сесії, створені передачею, — звичайні транскрипти хоста, їх видаляють як будь-які інші; стара сесія лишається незмінною |
| Dependent modules | Немає |
| External contracts | Рядки `[context-editor] id …` після результатів, рядки команди `/compact context-editor: …`, промпти ходу оптимізації і мітки `[context-editor: optimize]` у відповідях агента лишаються в розмові як текст без дії; інструменти `context_list`, `context_edit`, `context_tag`, `context_handoff`, команда `/handoff` і навичка `context-editor:<SKILL>` зникають з наступного старту сесії; INTRO_TEXT більше не додається; промпти й навички, що на них посилаються, треба прибрати |

Вимкнення: прибрати розширення з `--plugin-dir` / `CLAUDE_CODE_PLUGIN_DIRS` або зі встановлених плагінів. Черга з правками лишається у файлі сесії і застосується після першого завершеного ходу, коли мод увімкнуть.

Відкат етапів і авторозмітки (2026-10-10) до попередньої версії мода. Нові поля й файли стара версія читає так:
- `tags.json`: поля `stage`, `lastClosed`, `introduced` і поле тегу `reason` вона не перевіряє і зберігає при записі (розбір доповнює значення за замовчуванням і записує реєстр цілим); тег-діапазон вона бачить як тег рядка за `anchor` і ставить замість `collapse` діапазону `rewrite` першого рядка, яку PrepareEdits приймає лише для тексту агента без викликів. Тег з `kind = state` стара версія вважає поганим, і весь реєстр стає `unreadable`: `context_tag` відмовляє, AutoTag мовчить, а HandleCompaction відхиляє кожну правку («tag registry unreadable»). Тому перед відкатом агент знімає `state` і теги-діапазони (`context_tag` `remove`), або людина видаляє `tags.json` (губляться теги й закріплення першого промпту).
- `pending.json`: поля `optimize` і `optimizePrompted` стара версія не перевіряє і зберігає лише записами, що доповнюють прочитану чергу; її HandleCompaction будує чергу зі значень за замовчуванням і на першому застосуванні їх скидає, а Flush їх не читає, тож хід оптимізації не запускається. Якщо після відкату мод оновлять знову, лишений `optimize` дасть пораду з наступним промптом людини, а лишений `optimizePrompted` змусить проігнорувати одну мітку — щоб цього не було, ці поля видаляють з файлу.
- `journal.json` і тека `skills/` стара версія не знає: журнал лежить без читача, навичка зникає разом з кодом нової версії.
- Повертається Nudge з порогами 80k / +40k, і заміни з тегів знову ставляться на порозі.

Повернення до двох розширень: відкотити код мода до коміту b090f48 (`mods/context-editor`, `mods/context-editor-trigger`, `scripts/check-shared.sh`) і запускати хост з обома `--plugin-dir`. Формат файлів сховища (Queue з полем `handoff`, TagRegistry, AliasRegistry, Boundary, архіви) не змінювався, крім необов'язкового поля `HandoffRequest.owner`, якого стара версія не перевіряє й не використовує, тож вона читає файли як є; файли засіву вона ігнорує, а файл `editor-ready` створить заново. Версія b090f48 не працює в неінтерактивному хості: правки там лишаються в черзі ([C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02)).

## 07. Design Decisions  {#SP_CTX_DEC}

### DEC_01 — Ідентифікатор зміненої пари  {#SP_CTX_DEC_01}

> **Status:** resolved
> **Date:** 2026-10-08

**Question:** Чи зберігати змінена пара свій ідентифікатор виклику?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — зберегти | простіше; гіпотетично хост при відновленні бере перший результат з цим id |
| B — новий id за FreshId для обох половин пари | повторна правка за старим id не знаходить пару (коректна відмова) |

**Decision:** B.
**Rationale:** усуває одну з можливих причин повернення оригіналу при відновленні; на поведінку в межах сесії не впливає.
**Rejected because:** A — живий тест не виключив цю причину. Сценарій відновлення лишається fail і з B, тож B — запобіжний захід, а не виправлення.

### DEC_02 — Рядки з результатами інструментів, які не змінено  {#SP_CTX_DEC_02}

> **Status:** resolved
> **Date:** 2026-10-08

**Question:** Повертати їх хосту з `handle` чи перезбирати?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — з `handle` | хост зберігає їх із посиланням на батьківський рядок до межі компактизації; відновлення сесії переходить у стару історію (підтверджено в транскрипті) |
| B — перезбирати | посилання на батьків правильні; втрачається структурований запис результату для відображення і медіа |

**Decision:** B, крім незмінених рядків з медіа — вони зберігають `handle` ([C_CTX_DEC_06](./context_editor.concept.md#C_CTX_DEC_06)).
**Rationale:** A псує ланцюжок рядків у транскрипті; перезбирання рядка з медіа знищило б медіа без рішення агента.
**Rejected because:** A — підтверджена помилка ланцюжка.

### DEC_03 — Пороги нагадувань  {#SP_CTX_DEC_03}

> **Status:** superseded
> **Date:** 2026-10-08; замінено 2026-10-10

Замінено [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15) (B): нагадувань за розміром немає, Nudge вилучено ([SP_CTX_02_09](#SP_CTX_02_09)), константи NUDGE_FIRST і NUDGE_STEP прибрано з [SP_CTX_01_12](#SP_CTX_01_12). Запис лишається як історія.

**Question:** Константи в коді чи налаштування розширення, які задає людина?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — константи 80k / +40k | мінімальна поверхня; зміна — правкою коду |
| B — налаштування розширення | людина змінює без коду; більше контрактів і перевірок |

**Decision:** A.
**Rationale:** мінімальність: споживача налаштування ще немає. Перехід на B — коли розробник попросить налаштовувати пороги.
**Rejected because:** B — контракт без підтвердженого споживача.

### DEC_04 — Хто доставляє звіт  {#SP_CTX_DEC_04}

> **Status:** resolved
> **Date:** 2026-10-08, переглянуто 2026-10-09 (двічі)

**Question:** Як звіт про застосування доходить до агента?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — обробник компактизації надсилає промпт і чекає | взаємне блокування: відправка завершується, коли стартує хід, а хід стартує після компактизації — підтверджено наживо |
| B — крок запуску компактизації (до 2026-10-09 — тригер) надсилає промпт зі звітом і сам чистить звіт у черзі | звіт доходить лише з промптом продовження; з двома розширеннями — два записувачі одного файлу і можлива подвійна доставка |
| C — DeliverReport додає звіт до наступного промпту (людини чи продовження) і чистить його; Flush лише надсилає текст продовження | з одним розширенням не працює для продовження: хост пропускає власні хуки `prompt.submit` мода для промпту, який мод надсилає сам (Verify фази 10, 2026-10-09, F1) — звіт не доходив до ходу продовження |
| D — Flush вписує звіт у текст промпту продовження і прибирає його з черги (RemoveDelivered), коли промпт увійшов; DeliverReport додає звіт до наступного промпту людини, коли продовження немає (вимкнено, людина вже почала хід, промпт продовження відхилено) | обидва шляхи пишуть чергу її послідовним ланцюжком одним кроком RemoveDelivered; доставка рівно один раз, крім DELIVERY_FAILED (щонайменше один раз); звіт пакета лише з тегів доходить з промптом людини |

**Decision:** D (Verify фази 10, 2026-10-09). До того діяло C (рев'ю раунд 1, дві розширення: промпт тригера проходив хуки редактора).
**Rationale:** у одному розширенні лише D доводить звіт до ходу продовження; з одним модом записувач черги один, тож заперечення проти B (гонка двох записувачів) зникло, а частину C для промптів людини D зберігає.
**Rejected because:** A — блокування; B — звіт губиться, коли продовження вимкнено або відхилено; C — власний промпт мода оминає його хук.

### DEC_05 — Коли автоматично застосовувати заміни з тегів  {#SP_CTX_DEC_05}

> **Status:** resolved
> **Date:** 2026-10-08, переглянуто 2026-10-10

**Question:** Застосовувати `disposable` після кожного ходу, на порозі нагадування чи на рішенні агента?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — після кожного ходу | контекст завжди мінімальний; компактизація і скидання кешу щоходу |
| B — при переході порогу нагадування | рідкі пакетні заміни; порогу після 2026-10-10 немає |
| C — коли агент закриває етап інструментом і на кінці ходу з міткою ([SP_CTX_02_13](#SP_CTX_02_13)) | заміни йдуть тим самим пакетом, що правки агента для блоку, без окремої компактизації |

**Decision:** C (перегляд 2026-10-10 — наслідок [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15), B, і концепту §1.1 «Теги наперед»). До того — B, у складі пропозиції щодо тегів, погодженої розробником 2026-10-08.
**Rationale:** пакетне застосування разом з правками агента зберігає економію кешу, заради якої теги існують; порогу, на який B спирався, більше немає.
**Rejected because:** A — щоходове скидання кешу; B — поріг вилучено.

### DEC_06 — Як зіставити медіа в промпті людини з рядком розмови  {#SP_CTX_DEC_06}

> **Status:** open
> **Date:** 2026-10-08

**Question:** Як знайти рядок розмови, якому належить повідомлення API-подання з медіа в промпті людини?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — рівність тексту: текстові блоки повідомлення, з'єднані так само, як хост з'єднує `Row.text` | просто; хост нормалізує API-подання (нагадування як текстові блоки), тож рівність не гарантована |
| B — позиційне зіставлення промптів людини в обох поданнях | стійке до вмісту; залежить від однакової кількості промптів в обох поданнях |
| C — відмовитися від `describe`; медіа в промптах лише через `collapse` діапазону | не потребує зіставлення; втрачається точкова заміна |

**Decision:** OPEN — see resolution trigger. До закриття `PromptMatch` повертає «немає».
**Rationale:** жодне припущення про нормалізацію API-подання не перевірено на хості.
**Rejected because:** —
**Resolution trigger:** research spike перед фазою медіа плану PL_CTX: зняти обидва подання розмови (і рядки події компактизації `e.messages`) з промптами людини з медіа і нагадуваннями, перевірити A і B та межі вікон усіх трьох подань; якщо A і B ненадійні — C.

### DEC_07 — Як відрізати рядки до межі компактизації  {#SP_CTX_DEC_07}

> **Status:** resolved
> **Date:** 2026-10-09

**Question:** Читання розмови хоста повертає весь транскрипт, разом із рядками до кожної компактизації, і межі не позначає. Як знайти початок поточної розмови?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — запам'ятати відбитки перших рядків, які повернула компактизація (Boundary), і брати транскрипт від їх останнього входження | працює для кожної компактизації основної розмови, яку бачать хуки мода; без запису або за розбіжності відбитків — увесь транскрипт, як раніше |
| B — зіставити транскрипт з API-поданням, у якому старих рядків уже немає | API-подання нормалізоване (нагадування як текстові блоки, підсумок замість старих рядків); однозначного зіставлення рядків немає — та сама проблема, що в DEC_06 |
| C — рахувати рядки, додані після компактизації | `session.append` не бачить рядків компактизації, а читання розмови не містить вкладень і сповіщень: лічильники не збігаються |

**Decision:** A
**Rationale:** спайк 2026-10-09 (Claude Code 2.1.295): при трьох компактизаціях — двох редактором і одній `/compact` — `e.messages` дорівнював хвосту транскрипту після останньої межі, а повернені рядки стояли в наступному читанні суцільним блоком з тими самими відбитками. Розробник погодив підхід, запропонований після живих сценаріїв фази 2 («Виправ всі виявлені проблеми»). Межа діє лише в тому процесі хоста, де її записано ([SP_CTX_DEC_10](#SP_CTX_DEC_10)): після `--resume` читання розмови — завантажений ланцюжок, а не «оригінали + копії» (навичка plugin-hooks, пункт 7; спайк context_editor_handoff_long, Entry 6), і збережена межа там може не збігтися або збігтися не там.
**Rejected because:** B — немає однозначного зіставлення рядків; C — лічильники хоста не узгоджені між подіями й читанням.
**Resolution trigger:** —

### DEC_08 — Як знайти видиму частину розмови для засіву  {#SP_CTX_DEC_08}

> **Status:** resolved (delegated)
> **Date:** 2026-10-09

**Question:** Коли модель бачить не всі рядки (вбудована компактизація, чию межу цей процес не записав: відновлення сесії, компактизація до завантаження мода), засів починається з підсумку з API-подання, за яким ідуть лише видимі рядки; заповнене вікно читання (ROW_WINDOW) сюди не належить — тоді засів відмовляє ([C_CTX_DEC_12](./context_editor.concept.md#C_CTX_DEC_12), C). Як визначити, з якого рядка транскрипту починаються видимі рядки?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — перше повідомлення API-подання має бути підсумком вбудованої компактизації (текст починається з SUMMARY_OPENER); знайти в рядках рядок-підсумок: останній рядок людини без результатів, чий текст без жодного пробільного символу починається з перших min(160, довжина) символів тексту підсумку, так само очищеного; видимі — рядки після нього | одне текстове порівняння з рядком, який хост пише сам (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 2: підсумок стоїть у транскрипті рядком `user`); копія останнього тексту агента і хвіст переходять цілими; при кількох компактизаціях береться остання; нагадування хоста не переносяться |
| B — опорою взяти перший виклик інструменту API-подання: видимі — рядки від рядка з цим `tool_use_id`, усе, що в API-поданні перед ним, іде в голову | лише точне зіставлення за ідентифікатором; текст агента і промпти людини між підсумком і першим викликом або губляться, або стають текстом людини в голові |
| C — зіставити кожне повідомлення API-подання з рядком (роль, ідентифікатори викликів, для тексту — вміщення без пробільних символів, як у R1) | найточніше «як бачить модель»; та сама проблема нормалізації API-подання, що в [SP_CTX_DEC_06](#SP_CTX_DEC_06) і [SP_CTX_DEC_07](#SP_CTX_DEC_07), і найбільше коду |

**Decision:** A
**Rationale:** підсумок — єдине повідомлення, яке гарантовано є і в API-поданні, і в транскрипті; збіг початку тексту з одним рядком надійніший за зіставлення кожного повідомлення, а відмова при незбігу веде до способу `document`, не до хибного засіву. Нормалізація пробільних символів — та сама, що в R1 ([SP_CTX_02_12](#SP_CTX_02_12)).
**Rejected because:** B — губить текст між підсумком і першим викликом; C — зіставлення без підтвердженої стійкості до нормалізації.
**Resolution trigger:** — (розробник, 2026-10-09: «Способи технічної реалізації - на твій вибір»); перевірка — живий сценарій «Передача довгої сесії після `/compact`» ([SP_CTX_05_03](#SP_CTX_05_03)): якщо рядок-підсумок не знаходиться (текст у транскрипті і в API-поданні відрізняється початком), перейти на B.

### DEC_09 — Де лежать файли передачі  {#SP_CTX_DEC_09}

> **Status:** resolved (delegated)
> **Date:** 2026-10-09

**Question:** Засів містить шляхи до архіву оригіналів і до файлів перенесеного медіа, а також пишеться файлом. У сховищі якої сесії їх писати, якщо засів збирається до `/clear`, коли ідентифікатор нової сесії ще невідомий?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — сховище старої сесії, `<old storage>/<id>…` | шляхи відомі до очищення; збій до очищення прибирає їх у межах одного каталогу; стара сесія — повний архів разом з файлами передачі |
| B — зібрати засів після `/clear` у сховищі нової сесії | `$.command.run('clear')` завершується, коли `$.session.id()` уже повертає новий ідентифікатор (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 4, «command.run завершується після роботи»), тож після нього читання розмови й API-подання бачать нову, порожню сесію; збирати нема з чого |
| C — писати в стару, після засіву скопіювати в нове сховище | шляхи в тексті засіяних рядків уже вказують на старе сховище; копія — дубль даних без читача |

**Decision:** A — задано постановкою ревізії SP_CTX (2026-10-09).
**Rationale:** єдиний варіант, у якому шляхи в засіяному тексті відомі на момент збирання; файли лежать під тим самим захистом (каталог 700).
**Rejected because:** B — нічого збирати після очищення; C — копія без читача.
**Resolution trigger:** —

### DEC_10 — Коли довіряти збереженій межі  {#SP_CTX_DEC_10}

> **Status:** resolved
> **Date:** 2026-10-09

**Question:** Boundary лежить у файлі сесії й переживає перезапуск хоста, а читання розмови після `--resume` — інший вигляд транскрипту. Коли CurrentRows може спиратися на збережену межу?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — лише в тому самому процесі хоста: Boundary несе `host` (токен змінної середовища процесу хоста і pid процесу `claude`), довіра — збіг з ідентичністю процесу цього екземпляра модуля; після `/resume` у тому самому процесі межа нової сесії втрачає `host`; без ідентичності — довіра лише до межі, яку записав сам екземпляр | гаряче перезавантаження модуля довіру зберігає, перезапуск, `--resume` і `/resume` у процесі — ні; в іншому процесі весь транскрипт — це завантажений ланцюжок, який бачить модель (Entry 6); без ідентичності — як колишній прапорець у пам'яті |
| B — A плюс звірка хвоста після межі з API-поданням за ідентифікаторами результатів | точніше, але знову зіставлення з нормалізованим API-поданням (SP_CTX_DEC_07, B) і очищеним вмістом старих результатів (навичка plugin-hooks, пункт 33) |
| C — лише API-подання, без збереженої межі | та сама проблема зіставлення рядків, що в SP_CTX_DEC_07, B |

**Decision:** A — розробник, 2026-10-09 («той самий процес хоста»); ідентичність без `ps` — токен і pid, і зняття `host` після `/resume` у процесі — рішення розробника в рев'ю раунд 20.
**Rationale:** спайк context_editor_handoff_long, Entry 6 (2.1.295): у тому самому процесі і після гарячого перезавантаження межа збігалась у правильному місці, а хвіст відповідав API-поданню один до одного за ідентифікаторами; у відновленому процесі межа не збіглася (дублікати), а весь транскрипт був саме тим, що бачить модель. Ідентичність процесу стабільна при перезавантаженні модуля і нова після перезапуску (навичка plugin-hooks, пункт 32). Пам'ять модуля (колишній прапорець `trusted`) губила довіру при гарячому перезавантаженні.
**Rejected because:** B — зайве зіставлення без підтвердженої потреби; C — немає однозначного зіставлення рядків.
**Resolution trigger:** —

### DEC_11 — Як дати агенту інструкцію на початку сесії  {#SP_CTX_DEC_11}

> **Status:** resolved
> **Date:** 2026-10-10

**Question:** Концепт ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), [C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)) вимагає, щоб агент на початку сесії дізнавався про етапи, мітку оптимізації, телеметрію і пораду, коли чистити, — навичкою мода або вступом до першого промпту. Яким способом?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — лише вступ до першого промпту | агент бачить інструкцію одразу, у кожній сесії; кожен токен вступу — у контексті до кінця сесії, тож він мусить бути коротким і не вміщує повного посібника |
| B — лише навичка мода | нуль токенів, доки агент її не відкриє; у переліку видно лише опис, і агент може не відкрити її саме тоді, коли варто відкрити етап |
| C — обидва: короткий вступ (INTRO_TEXT, 748 символів, близько 187 токенів) прихованим контекстом першого промпту, що проходить хук мода, і навичка з повним посібником | агент знає про можливість з першого промпту і має де прочитати подробиці; два тексти треба тримати узгодженими |

**Decision:** C — розробник, 2026-10-10.
**Rationale:** вступ гарантує, що агент знає про можливість (вимога розробника «AI-агент повинен це рішення прийняти свідомо та знати про таку можливість»), а навичка вміщує запис етапу, відтворюваність, повернення оригіналу і слот стану, які не вміщуються ні у вступ, ні в MAX_DESCRIPTION описів інструментів. Механізм вступу — той самий прихований контекст промпту, що в DeliverReport ([SP_CTX_02_08](#SP_CTX_02_08)); навички плагіна хост показує як `<plugin>:<name>` (навичка plugin-hooks, пункт 39). Прапорець `introduced` у реєстрі тегів сесії не дає перезавантаженню модуля повторити вступ ([SP_CTX_02_27](#SP_CTX_02_27)).
**Rejected because:** A — не вміщує посібника; B — агент може не дізнатися про можливість.

### DEC_12 — Синтаксис мітки оптимізації  {#SP_CTX_DEC_12}

> **Status:** resolved
> **Date:** 2026-10-10

**Question:** Яким текстом агент просить оптимізацію у фінальній відповіді ходу ([C_CTX_DEC_17](./context_editor.concept.md#C_CTX_DEC_17))?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — `[context-editor: optimize]` | самопояснювальний для людини, яка її бачить, і того самого вигляду, що MARK і MARKER мода; ASCII, агент пише її без помилок |
| B — `⟦ctx:optimize⟧` | коротка і майже не трапляється випадково; символи поза ASCII агент може замінити схожими, і точний збіг не спрацює |
| C — `<context-optimize/>` | схожа на розмітку; її можуть сховати рендерери, що розбирають HTML, і людина не побачить, чому почався хід оптимізації |

**Decision:** A — розробник, 2026-10-10. Мітка діє лише окремим останнім непорожнім рядком поля `answer` події `turn.complete` (навичка plugin-hooks, пункт 38), що після обрізання дорівнює OPTIMIZE_MARK дослівно; концепт уточнено рев'ю раунд 30.
**Rationale:** мітку видно людині ([C_CTX_DEC_17](./context_editor.concept.md#C_CTX_DEC_17)), тож вона має пояснювати себе так само, як рядки команди `/compact context-editor: …`. Вимога окремого останнього рядка не дає спрацювати цитаті: агент, що пояснює людині, як просити оптимізацію, або повторює INTRO_TEXT, пише мітку посеред тексту; точний збіг без нормалізації регістру не дає хибних спрацювань на зміненому написанні.
**Rejected because:** B — ризик неточного відтворення символів; C — може бути прихована від людини.

### DEC_13 — Які зміни файлу роблять читання застарілим  {#SP_CTX_DEC_13}

> **Status:** resolved
> **Date:** 2026-10-10

**Question:** Правило R4 ([SP_CTX_01_11](#SP_CTX_01_11); концепт [C_CTX_03_04](./context_editor.concept.md#C_CTX_03_04), «Застаріле читання»; пропозиція P1) позначає ранні читання файлу, який агент потім змінив. Які зміни воно помічає?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — лише інструменти файлів WRITE_TOOLS (`Edit`, `Write`, `NotebookEdit`) за точним `file_path` / `notebook_path`, рівним `file_path` ранішого `Read` | без хибних спрацювань; зміни командами оболонки не помічаються |
| B — A плюс евристики команд `Bash` (`sed -i`, `git checkout`, перенаправлення `>` у файл) | ловить більше випадків (зокрема відкат `git checkout` у сесії decd4bc6); розбір довільної команди оболонки дає хибні спрацювання і пропуски |

**Decision:** A — розробник, 2026-10-10. Зміни оболонкою R4 не помічає; агент може сам поставити `review` раннім читанням.
**Rationale:** `review` — лише позначка для агента, але хибна позначка «застаріле» підриває довіру до всіх; точний шлях інструментів файлів однозначний.
**Rejected because:** B — хибні спрацювання евристик.

### DEC_14 — Мітка оптимізації без відкритого етапу  {#SP_CTX_DEC_14}

> **Status:** resolved
> **Date:** 2026-10-10

**Question:** Концепт: «без етапу блок — рядки після кінця останнього закритого етапу або від початку розмови» ([C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02)). Чи стає блок, який мітка оптимізувала без етапу, «закритим» для наступної мітки?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — мітка без відкритого етапу закриває блок без назви: `lastClosed = { name відсутня, after: попередній lastClosed.end, end: кінець ходу }` | агент без етапів чистить порціями: кожна мітка пропонує лише рядки після попередньої порції; реєстр має одне поле `lastClosed` для обох випадків; телеметрія показує «Last block (no stage)» |
| B — мітка без етапу не змінює `lastClosed`: блок завжди від кінця останнього етапу, закритого інструментом або міткою при відкритому етапі | дослівно за текстом концепту; кожна наступна мітка без етапів знову пропонує вже оптимізовані рядки (вони позначені `*`, але блок і порада ростуть з кожною міткою) |

**Decision:** — (рекомендація: A; специфікація написана за A — [SP_CTX_02_30](#SP_CTX_02_30), [SP_CTX_04_05](#SP_CTX_04_05)) Погоджено розробником 2026-10-10 (design sign-off: «Так»).
**Rationale:** A — покрокове чищення порціями ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04), D) і для агента, що не відкриває етапів; блок мітки — та сама порція, яку агент щойно розглянув.
**Rejected because:** —
**Resolution trigger:** design sign-off задачі етапів (task_20261010_083402_stage-cleanup): розробник обирає A або B; за B — DetectOptimize без відкритого етапу лише будує блок від `lastClosed.end` без запису `lastClosed`, а ClosedBlock.name стає обов'язковим.

### DEC_15 — Що несе промпт ходу оптимізації  {#SP_CTX_DEC_15}

> **Status:** resolved
> **Date:** 2026-10-10

**Question:** Чи має промпт ходу оптимізації (і порада з промптом людини) називати межі блоку, його розмір, кандидатів і телеметрію, як звіт закриття етапу інструментом?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — лише звіт застосування (якщо є), назва блоку (або «the last block»), STAGE_ADVICE, ListHint і порада зазвичай зупинитися (`resume: false`); межі блоку (`[block ▶ …]`, `[block end]`) і телеметрію показує перегляд; заміни з тегів ставить DetectOptimize на кінці ходу з міткою | Flush не читає рядків розмови для промпту ходу оптимізації: немає очікування повернених рядків, правил вікна й шляху без індексів; агент однаково робить перегляд перед правками за індексами, бо застосування в ході з міткою робить індекси попереднього перегляду недійсними (`listedKey`); агенту це коштує один-два виклики `context_list`: заголовок називає діапазон блоку (`Last block #a..#b`), а в довгій розмові другий виклик перелічує рядки від `from = a` |
| B — повний звіт блоку з індексами, як при закритті інструментом, після очікування повернених рядків (рев'ю раунди 29–30) | агент бачить межі без перегляду; у неінтерактивному хості повернені рядки з'являються в читанні із запізненням (F2), і першим рядкам копій відповідають відбитки старого хвоста, тож індекси, пораховані Flush, ненадійні без складного очікування (позиція, повне вікно ROW_WINDOW, шлях без індексів) |

**Decision:** — (рекомендація: A; специфікація написана за A — [SP_CTX_02_06](#SP_CTX_02_06), [SP_CTX_02_08](#SP_CTX_02_08), [SP_CTX_02_29](#SP_CTX_02_29); концепт оновлено координатором задачі за рев'ю раунд 31: [C_CTX_03_02](./context_editor.concept.md#C_CTX_03_02), «Мітка оптимізації в тексті») Погоджено розробником 2026-10-10 (design sign-off: «Так»).
**Rationale:** перегляд у ході оптимізації читає рядки пізніше, коли повернені рядки вже в читанні, і сам оновлює `listedKey`; звіт закриття інструментом індекси зберігає, бо між закриттям і звітом компактизації немає.
**Rejected because:** —
**Resolution trigger:** design sign-off задачі етапів (task_20261010_083402_stage-cleanup): розробник підтверджує A або обирає B; за B повертаються очікування повернених рядків з перевіркою позиції і шлях звіту без індексів (історія — рев'ю раунд 30).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-08 | Initial version: специфікація за прототипом і результатами живих тестів |
| 2026-10-08 | Медіа-ресурси: MediaRef, describe, CollectMedia, медіа-файли архіву, збереження handle для рядків з медіа |
| 2026-10-08 | Теги: Tag, TagRegistry, AutoTagRules, context_tag, AutoTag, QueueTagReplacements, RebindTags, захист pin, оновлений Nudge |
| 2026-10-08 | Рев'ю раунд 1: сховище з правами власника і готовність редактора (01_07, 02_15); пакетні поля черги і доставка звіту одним записувачем (01_04, 02_08, DEC_04); стани читання файлів; межі MAX_*; носій collapse без службових викликів; архів лише після запису; charsAfter після DropOwnCalls; обов'язкові поля правок; ApplyEdits з mediaOwners і перекриттям за множинами рядків; MARK першим у describe; таблиці ToolUse, ToolResult, TagRequest; повні помилки context_tag; джерела AutoTag; межа 4096 рядків; DEC_06 відкрите (PromptMatch); критерії для всіх контрактів |
| 2026-10-08 | Рев'ю раунд 2: правки пар на спільних рядках застосовуються разом; відмова при медіа сусідньої пари і при незіставленому медіа в промптах; вікно API (knownResults); покинута компактизація; доставка звіту після входу промпту; карантин нечитабельної черги; MAX_QUEUE_BYTES; перевірка типів полів черги; готовність через список інструментів процесу, HEARTBEAT 5 с / READY_FRESH 15 с; помилки тригера; межі колекцій; критерії CollectMedia |
| 2026-10-08 | Рев'ю раунд 3: DropOwnCalls зберігає службові пари поряд з медіа і поза вікном; правки поза вікном API відхиляються; носій collapse без input; без архіву оригіналів пакет не застосовується; сховище стежить за зміною session_id; гілка збою відповідає одразу; звіт прибирається за доставленим текстом; помилки DeliverReport; відхилений промпт продовження; стани черги в 04_01 |
| 2026-10-08 | Фаза 3 (теги), уточнення за реалізацією: межа файлу реєстру MAX_QUEUE_BYTES і TAGS_FULL за нею (01_10, 02_11, 01_11); `pin` пари захищає і її рядки (02_03); context_edit при нечитабельному реєстрі ставить правки без перевірки `pin` (02_02); Nudge мовчить лише при `unreadable` черзі, а не при відсутньому файлі (02_09); як R1 знаходить рядок промпту (02_12); RebindTags видаляє `disposable`, чия заміна була в пакеті, і оновлює `hint` (02_14, узгоджено з 04_03); перелік модульних тестів тегів (05_01) |
| 2026-10-08 | Живі сценарії фази 3 (теги): «Захист початкового завдання», «Автоматичне чищення з тегів» — pass |
| 2026-10-08 | Псевдоніми викликів: AliasRegistry (01_13), MarkCall (02_16), ResolveRef (02_17), `ref` у правках і тегах, очищення псевдонімів у RebindTags |
| 2026-10-08 | Фаза 7 (псевдоніми), уточнення за реалізацією: стани `unreadable` реєстру псевдонімів і видалення `last` при очищенні (01_13); крок ResolveRef перед PrepareEdits (02_02) і ціль за `ref` у псевдокоді context_tag (02_11); без запису реєстру позначки немає, що таке довжина тексту результату, хук чекає запису (02_16); модульні тести псевдонімів (05_01) |
| 2026-10-08 | Живий сценарій «Тег за псевдонімом» — pass |
| 2026-10-09 | Живі сценарії «Скриншот у результаті інструменту», «Документ у результаті інструменту», «Незмінене медіа» — pass (фаза 2) |
| 2026-10-09 | Поточна розмова: Boundary (01_14), CurrentRows і RecordBoundary (02_18), DEC_07; HEAD_ROWS, MAX_DESCRIPTION; архів без дубля base64 медіа (01_06); модульні очікування й живий сценарій «Перегляд після компактизації» |
| 2026-10-09 | Рев'ю раунд 4: precompute і субагенти в 02_18; межа іншого процесу без довіри; правки й теги за застарілими індексами відхиляються (02_03, 02_11); MEDIA_DATA і алфавіт base64 в архіві (01_06, 01_12) |
| 2026-10-09 | Передача в нову сесію: HandoffRequest (01_15), TranscriptRecord (01_16), поле `handoff` у Queue, context_handoff (02_19), HandoffCommand (02_20), RunHandoff (02_21), BuildTranscript (02_22), CheckTranscript (02_23), CheckSwitched (02_24); skip у HandleCompaction; константи; критерії й живі сценарії |
| 2026-10-09 | Рев'ю раунд 6: RunHandoff — відкладання при новому ході, перевірене повернення й прибирання файлу, перевірка рядків поза API-поданням, без переходу на document після перемикання; скасування запиту (04_04, `/handoff cancel`); нормалізація BuildTranscript; CheckSwitched і CheckTranscript — як у коді |
| 2026-10-09 | Одне розширення і компактизація вбудованою командою (C_CTX_DEC_02 C, DEC_09 C; спайк context_editor_handoff_long): TriggerCompaction → Flush у моді (02_06), обробник збігається за `instructions` за будь-якого `trigger` (02_07, 02_18), ScrubCommandRows (02_25); файл готовності, HEARTBEAT/READY_FRESH і спільні константи двох розширень вилучено (01_07, 02_15, 01_12); передача засівом очищеної сесії (C_CTX_DEC_11 S): HandoffSeed (01_17), TranscriptRecord вилучено (01_16), RunHandoff (02_21), BuildTranscript/CheckTranscript/CheckSwitched → BuildSeed/CheckSeed/CheckSeeded (02_22–02_24), HandleSeed (02_26), джерело для довгих сесій (C_CTX_DEC_12 C), медіа архівом і шляхом (C_CTX_DEC_14); константи HANDOFF_MARKER, COMMAND_NOTE, ROW_WINDOW, TRANSCRIPT_LINE, SEED_PROBE, FLUSH_*; 03_02, 04_01, 04_04, 05_01–05_04 (сценарії в терміналі і в stream-json), 06_01 (повернення до b090f48), DEC_04 переглянуто, DEC_08 (resolved, delegated), DEC_09 |
| 2026-10-09 | Рев'ю раунд 9 (дизайн фази 10): команди хоста в черзі — одна спроба, відмова остаточна, FLUSH_RETRIES вилучено (01_12, 02_06, 04_01, 05_04); лічильник ходів без власних ходів мода і припущення про події ходу в stream-json (02, 02_12, 02_21); хід під час `/clear` → AfterClear, AfterClear рахує ходи після `/clear` (02_21); `pin` на підсумок засіву; BuildSeed — WINDOW_FULL і за прихованих рядків, підсумок за SUMMARY_OPENER, точне порівняння, блок-нагадування, медіа поштучно (02_22); HandleCompaction без `precompute` (02_07); межі підтримуваних хостів, разовий `-p` поза межами; нові рядки 05_01, 05_03, 05_04; DEC_08 уточнено |
| 2026-10-09 | Рев'ю раунд 10 і спайк context_editor_handoff_long Entry 4: хост ≥ 2.1.295; команди мода не дають подій ходу — OwnTurn вилучено, лічильник рахує кожен хід (02, 02_06, 02_12, 02_21); походження `$.command.run` лише з відкладеної дії поза хуком, якого чекає хід (02), HandoffCommand через Schedule (02_20); ScrubCommandRows вилучено, COMMAND_NOTE вилучено, мітка лишається самопояснювальною (01_12, 02_25, 03_02, 05_02, 05_03); AutoTag пропускає рядки з походженням плагіна (02_12); `handoffInFlight`, `owner` і Due (01_15, 02_19, 02_21, 04_04); Deliver після `/clear`, зміна сесії під час засіву, хід одразу після `/clear`, PinSummary (02_21); SEED_ROOM і SEED_TOO_LONG, підсумок посеред рядків, вміст рядком (01_12, 01_17, 02_22); DEC_09 спирається на Entry 4; 05_01, 05_03, 05_04, 06_01 |
| 2026-10-09 | Рев'ю раунд 11: `handoffScheduled` скидається до RunHandoff (01_15, 02_21); Due без `owner` (лише діагностика), виняток RunHandoff → Fail / FailAfterClear, `handoffInFlight` скидається на кожному виході (01_15, 02_21, 04_04); перевірка `MovedSince` безпосередньо перед `/compact` у Flush і Seed, залишкове вікно справжнього підсумовування (02, 02_06, 02_21, 05_02, 05_04); HandleSeed засіває лише `s.new` (01_17, 02_26); друге `/clear` лише після засіву; `$.model.fork` у stream-json — обов'язковий сценарій (02_21, 05_03); PinSummary і TRANSCRIPT_LINE уточнено (02_21, 02_22); походження таймера з `prompt.submit` — виведене (02); AutoTag і `asUser` (02_12) |
| 2026-10-09 | Рев'ю раунд 12: `lastTurnAborted` — Flush не перепланує себе після перерваного ходу (02, 02_06); поля лічильника ходів оголошено; друге `/clear` лише після взятого засіву — у 04_04, 05_01, 05_03 і прозі 02_21; порядок кроків засіву в 05_01; Outcome RunHandoff, змінні `seed` і `seedReason`, захищена спроба AfterClear в обробнику винятку, кроки після засіву перехоплює Seed і називає у спливному повідомленні; інваріанти з застереженням про запис старої черги (01_15, 02_21), рядок 05_04; виведене походження таймера з таймера (02) |
| 2026-10-09 | Рев'ю раунд 14: AfterClear ніколи не кидає (кроки перехоплюються на місці), `afterClearEntered` і `terminal` — жоден з HandedOff, Fail, FailAfterClear не пишеться двічі (02_21); 04_04 і 05_01 для винятків до і після `/clear`; Schedule перехоплює виняток RunHandoff; `h.resume = false` — запасні тексти у звіт черги (Deliver `queueOnly`); `requestTurn` (01_15, 02_19, 02_21); покинутий `running` з наявним `seed.json` знімається зі звітом, `/handoff cancel` знімає `running` поза `handoffInFlight` (02_20, 02_21, 04_04); FailAfterClear і notice без шляху засіву, коли засіву немає; `why` ініціалізовано; 05_04 «Команда чекає кінця ходу», перерваний промпт у новій сесії; Flush перелічує `lastTurnAborted` |
| 2026-10-09 | Реалізація фази 10 (зворотний зв'язок імплементатора): SESSION_CHANGED — обробник винятків не входить в AfterClear (`sessionChanged`); відмова промпту в Deliver — спливне повідомлення з текстом хоста без повторного винятку; CarryNote медіа без `media_type` — тип блоку; поведінка при відхиленому другому `/clear` |
| 2026-10-09 | Verify фази 10 (F1–F6): Flush вписує звіт у промпт продовження і прибирає його RemoveDelivered після входу промпту, DeliverReport — лише для промптів людини (02_06, 02_08, DEC_04 → D); AwaitSeeded з SEED_WAIT / SEED_POLL (01_12, 02_21, 02_24); R1 рахує `unclassified` (01_11, 02_12); `fromSummary` і для рядка-підсумку на початку CurrentRows (01_17, 02_21, 02_22); 05_04 «Запис старої черги після засіву не вдався» узгоджено з правилом захоплення; HANDOFF_PROMPT забороняє виклики інструментів; рядок стану після `/clear`; відповіді `/handoff` без префікса; рядки 05_01 |
| 2026-10-09 | Знахідка C Verify фази 10 (спайк context_editor_handoff_long Entry 5, навичка plugin-hooks пункт 30): KeepResponsesWhole — у відрізку між промптами після першого перезібраного рядка асистента перезбираються й решта рядків асистента з `handle` (02_04, 02_05, 02_07, 03_02); рядки 05_01; «Незмінене медіа» з рядком тексту перед викликами, в обох хостах (05_03) |
| 2026-10-09 | Рев'ю раунд 18: KeepResponsesWhole — рядок результату, спорожнілий після drop, не є промптом (02_04; перемежована відповідь 2.1.295); Flush пише чергу через RemoveDelivered (02_06); DELIVERY_FAILED — доставка щонайменше один раз |
| 2026-10-09 | Повторний Verify фази 10 (2.1.295, TUI + stream-json): усі сценарії pass; передумова «Передача засівом» — псевдонім на текстовій парі |
| 2026-10-09 | backlog H, N1: FormatReport без рядка розміру й «tokens freed», коли жодної правки не застосовано — для компактизації «the conversation was not changed», для засіву — лише неприйняті правки (01_05, 02_07); реєстри тегів і псевдонімів, скопійовані в нову сесію, проходять RebindTags і очищення псевдонімів (01_17, 02_14, 02_21); рядки 05_01 |
| 2026-10-09 | backlog G, J: Boundary несе `host` — ідентичність процесу хоста; CurrentRows довіряє межі лише з тим самим `host` замість прапорця в пам'яті (01_14, 02_15, 02_18, DEC_07, DEC_10 новий); ApplyEdits відхиляє collapse з промптом перед першим відомим результатом лише при обрізаному API-поданні (`apiTruncated` з CollectMedia) (02_04, 02_07, 02_10, 02_22); рядки 05_01 |
| 2026-10-09 | рев'ю раунд 20: HandoffSeed `visible` і `edits`, крок реєстрів — читання, узгодження, запис окремо для кожного реєстру (01_17, 02_14, 02_21); `hostId` — токен HOST_ENV і ppid без `ps`, ParseHostId, читання однією обіцянкою, власна межа екземпляра як запасна довіра, `host` не рядком ігнорується, зняття `host` після `/resume` у тому самому процесі (01_12, 01_14, 02_15, 02_18, DEC_10); FormatReport з `kind`, інваріант `failed` при 0 правок, `charsAfter` засіву до CarryNote і голови (01_05, 02_07, 02_21, 02_22); `apiTruncated` при ≥ ROW_WINDOW − 1, WINDOW_FULL узгоджено (02_04, 02_10, 02_22); «Відновлення сесії» розділено, 06_01 — «може повернути»; 05_01, 05_04 |
| 2026-10-09 | рев'ю раунд 21: обіцянка `hostId` стартує в `session.start` або першому PrepareStorage; CurrentRows, `Key()` і зняття `host` при перемиканні сесії чекають її, обробники компактизації — ні (01_14, 02_15, 02_18); залишкове вікно гарячого перезавантаження після `/resume` у процесі; поріг повного подання в 05_01; обґрунтування форми звіту засіву; відсутній реєстр старої сесії нічого не пише (02_21) |
| 2026-10-09 | Рев'ю коду раунд 23: збій перезапису межі при перемиканні сесії — файл межі видаляється (02_18) |
| 2026-10-09 | Verify фази 11: статуси 05_03 (гаряче перезавантаження, передача зі зміненою парою, обидва рядки відновлення) |
| 2026-10-09 | Backlog K, крок 1 (Verify фази 11): KeepResponsesWhole перезбирає всі рядки асистента відрізка з перезібраним рядком, і раніші теж — рядок thinking тієї ж відповіді з `handle` повертав оригінал після `--resume` (02_04, 03_02, 05_01) |
| 2026-10-09 | Рев'ю раунд 25: рядок 05_01 summarize і DropOwnCalls за новим правилом; ціна KeepResponsesWhole для моделей зі збереженим thinking; відоме обмеження — згортання без носія посеред відповіді |
| 2026-10-09 | NudgeText і порада в описі `context_edit` за переглянутим C_CTX_DEC_04: наступна порція опрацьованого вмісту замість згортання найранішого одним великим підсумком; повідомлення людини, правила й навички, робоча частина — зазвичай без змін, на розсуд агента (02_09) |
| 2026-10-10 | Етапи і свідомий тригер оптимізації (C_CTX_DEC_15–DEC_19, задача етапів): Stage, ClosedBlock і RowMark (01_18), поля `stage`, `lastClosed`, `introduced` у TagRegistry (01_10); Tag — `state`, `review` з `reason`, діапазон `disposable` (01_09); R4 застарілі читання і R5 дублікати (01_11); `optimize` і `optimizing` у Queue (01_04); Journal (01_19), Telemetry (01_20); константи OPTIMIZE_MARK, MESSAGES_ROW, REPRODUCIBLE_TOOLS, WRITE_TOOLS, REPRO_FLAG, MAX_STAGE_NAME, MAX_BLOCK_INDEXES, MAX_JOURNAL, SKILL, INTRO_TEXT, STAGE_ADVICE, NUDGE_* вилучено (01_12); перегляд з телеметрією, `count: 0`, `~`, позначками етапу і причин (02_01); `state` у PrepareEdits (02_03), примітка оригіналу «open with Read» (01_06, 02_04); Flush з ходом оптимізації і AwaitCompacted (02_06); журнал у HandleCompaction (02_07); порада й інструкція в DeliverReport (02_08); Nudge вилучено (02_09); context_tag з `open`/`close`, `state`, діапазоном (02_11); AutoTag з причинами і R5 (02_12); QueueTagReplacements без порогу (02_13); RebindTags — межі етапів (Survivors, RelocateMark) і слот стану (02_14); хук викликів — R4 і повторні читання без нагадувань (02_16); `listedKey` і звіт блоку (02_18); реєстри передачі (02_21); нові SessionIntro, Telemetry, StageBlock, DetectOptimize, Journal (02_27–02_31); 03, 04_01–04_03, нові 04_05, 04_06; 05_01–05_04 (сценарій «Нагадування з початку» вилучено); 06_01; DEC_03 superseded, DEC_05 переглянуто, DEC_11–DEC_13 resolved, DEC_14 proposed |
| 2026-10-10 | Рев'ю раунд 30: записи черги переносять `optimize`/`optimizing` (01_04, 02_07); `optimize` — bool; Optimize перевіряє `MovedSince` перед заміною, заміна — порівняння-і-запис, OPTIMIZE_NO_BLOCK, REPORT_FAILED, `compacted` за зміною `reportId`, AwaitCompacted приймає межу лише на `p ≥ n0` (02_06); DeliverReport знімає застаріле `optimizing`, ADVICE_NO_BLOCK (02_08); межа, чий рядок замінила правка, — на останньому створеному рядку (`ApplyReport.produced`, `HandoffSeed.carried`, RelocateMark; 01_05, 01_17, 02_14, 04_05); мітка — лише окремий останній рядок відповіді (01_12, 02_30, DEC_12, INTRO_TEXT); MARK_NOT_QUEUED (02_30); пріоритети змісту EDIT_DESCRIPTION і TAG_DESCRIPTION (02_02, 02_11); QueueTagReplacements без перевірки `listedKey` (02_03, 02_13); R5 лише для великого тексту, інструмент з власного виклику (01_11, 02_12); R4 лише раніші читання, запис журналу `changed` (01_19, 02_16, 02_31); `~` — клас пари в частинах переліку (01_12, 02_01); телеметрія без `u` після збою, порожній і загублений кінець блоку (02_28); 04_06; 05_01, 05_02, 05_04; 06_01 |
| 2026-10-10 | Рев'ю раунд 31 (спрощення, SP_CTX_DEC_15 proposed): промпт ходу оптимізації і порада з промптом людини без індексів, розміру і кандидатів — назва блоку, STAGE_ADVICE, продовження і вказівка викликати `context_list` (02_06, 02_08, 02_29); AwaitCompacted, `n0`, захист повного вікна і шлях звіту без індексів вилучено (02_06, 01_12 SEED_WAIT, 04_06, 05_01, 05_04); `listedKey` оновлює лише звіт закриття інструментом (02_18, 02_29); перелік і телеметрія показують межі останнього закритого блоку `[block ▶ …]` / `[block end]` (01_20, 02_01, 02_28); загублений кінець блоку ніколи не показується порожнім і не нормалізується в `null` (01_18, 02_11, 02_14, 02_29, 02_30, 04_05); `ApplyReport.produced` — індекс і відбиток у кінцевому списку, межа на найпізнішому створеному рядку (01_05, 02_04, 02_07, 02_14, 02_22); 05_01, 05_03, 05_04 |
| 2026-10-10 | Рев'ю раунд 32: ListHint — діапазон з рядка `Last block #a..#b` і перелік від `from = a` (02_29, навичка 02_27, DEC_15); речення про застосовані правки лише при `compacted` (02_29); Flush читає рядки лише через QueueTagReplacements, застаріле читання нешкідливе, OPTIMIZE_BUILD_FAILED (02_06, 04_06); `count: 0` і `listedKey`, BlockReport оновлює `listedKey` лише з рядками (02_01, 02_29); причини, чому хід оптимізації не відбувся (02_08, 04_06); загублений початок блоку чи етапу — позначка на #0 і `startLost` у телеметрії (01_20, 02_01, 02_28); 05_01, 05_04 |
| 2026-10-10 | Рев'ю раунд 33: заміни з тегів `disposable` для шляху мітки — наприкінці ходу оптимізації, коли рядки ходу на місці; Optimize і DeliverReport рядків розмови не читають і замін не ставлять; OptimizeText називає кількість тегів `disposable`, продовження одне для обох випадків; ResumeOnly для порожнього ходу оптимізації з успадкованим продовженням; OPTIMIZE_BUILD_FAILED з успадкованим продовженням — Resume (02_06, 02_08, 02_13, 02_29, 04_03, 04_06, DEC_15); `Last block … from #<start>` при загубленому кінці (02_28); речення про оброблений пакет (02_29); пояснення `count: 0` без INTRO_TEXT (02_01); навичка (02_27); 05_01, 05_03, 05_04 |
| 2026-10-10 | Рев'ю раунд 34 (спрощення): хід оптимізації — звичайний хід; `optimizing`, успадковане продовження, примусове `tagsOnly`, ResumeOnly і крок кінця ходу оптимізації вилучено, пакет ходу оптимізації застосовується з власним `resume` агента, OptimizeText радить `resume: false` (01_04, 02_02, 02_06, 02_29); заміни з тегів для мітки ставить DetectOptimize на кінці ходу з міткою тим самим пакетом (02_13, 02_30, MARK_NO_REPLACEMENTS); промпт ходу оптимізації заміняє промпт продовження і не пересилає текст продовження черги; запобіжник петлі `optimizePrompted` (01_04, 02_06, 02_08, 02_30, MARK_IN_OPTIMIZATION); дві компактизації лише при непорожній черзі ходу з міткою; DEC_05 C, DEC_15 A, FLUSH_DELAY, RESUME_FAILED; 04_06; 05_01–05_04 |
| 2026-10-10 | Verify фази 14: D1 — MergeCallRows: перезібрані рядки викликів однієї відповіді зливаються в один рядок (02_04, 02_05, 02_22, 03_02; 05_01, сценарій 05_03 «Паралельні виклики після застосування»); D2 — `unknown`, коли розбивка має `apiUsage = null` (01_20, 02_28, 05_01); D3 — STAGE_ADVICE фази 14 без позначки `~` (01_12) |
| 2026-10-10 | Повторний Verify фази 14: D2 — після `/compact` хоста `apiUsage` не null, а розбивка завищує незмінну частину (сума більша за запит, MESSAGES_ROW урізано до 15): тоді міра — весь запит (02_28, 05_01) |
| 2026-10-10 | Рев'ю 36: ознака D2 — незмінна частина більша за весь запит (а не сума більша за запит); живі сценарії фази 14 — pass (05_03) |
