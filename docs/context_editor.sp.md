# Редактор контексту агента — Specification  {#SP_CTX}

> **Code:** SP_CTX
> **Status:** draft
> **Created:** 2026-10-08
> **Updated:** 2026-10-09
>
> **Concept:** [C_CTX](./context_editor.concept.md)
> **Depends on:** none
> **Used by:** —
> **Plan:** [PL_CTX](./context_editor.plan.md)
>
> Специфікація розширення Claude Code `context-editor` (одне розширення: воно і запускає компактизацію, і обробляє її, [C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02)): структури рядків, медіа-ресурсів, правок, тегів, черги, звіту, сховища і засіву нової сесії; контракти інструментів агента, застосування правок, запуску компактизації вбудованою командою, обробника компактизації, доставки звіту, нагадувань, пошуку медіа, тегування і передачі в нову сесію засівом; правила перевірки; життєві цикли; критерії перевірки з живими сценаріями в інтерактивному терміналі і в неінтерактивному хості з потоковим входом; відкат. Читати перед зміною коду мода або написанням тестів до нього.

## Contents

- [01. Data Structures](#SP_CTX_01) — рядок розмови, правки, черга, звіт, архів, сховище, медіа-ресурс, теги та їх реєстр, реєстр псевдонімів, межа поточної розмови, запит передачі, засів нової сесії, константи
- [02. Contracts](#SP_CTX_02) — перегляд, постановка правок, застосування, прибирання службових викликів, запуск компактизації після ходу, обробник компактизації, доставка звіту, нагадування, пошук медіа, тегування, автоправила, заміни з тегів, узгодження тегів, підготовка сховища, позначка викликів і розв'язання псевдонімів, поточна розмова, передача в нову сесію (засів і його перевірки), обробка засіву
- [03. Validation Rules](#SP_CTX_03) — що перевіряється для вводу агента і для результату застосування
- [04. State Transitions](#SP_CTX_04) — життєвий цикл черги, окремої правки, тегу і запиту передачі
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

Стан файлу при читанні: `missing` (файлу немає — значення за замовчуванням), `ok`, `unreadable` (не читається, не розбирається або будь-яке поле має не свій тип). `unreadable` ніколи не трактується як порожня черга.

Invariants:
- `resume`, `resumePrompt`, `tagsOnly` стосуються лише поточного пакета і скидаються до значень за замовчуванням під час застосування.
- `report` і непорожній `edits` можуть існувати одночасно: звіт стосується попереднього пакета.

### 01_05. ApplyReport  {#SP_CTX_01_05}

| Field | Type | Description |
|-------|------|-------------|
| applied | list<string> | ≤ MAX_QUEUE_EDITS. Описи застосованих правок (`summarize <id>`, `drop <id>`, `collapse #a..#b`, `rewrite #i`, `describe #i`) |
| failed | list<string> | ≤ MAX_QUEUE_EDITS. Опис неприйнятої правки з причиною |
| charsBefore | int | Сума `size` рядків до застосування |
| charsAfter | int | Сума `size` рядків після застосування і [SP_CTX_02_05](#SP_CTX_02_05) |
| originals | list<{ edit: string, rows: list<Row> }> | ≤ MAX_QUEUE_EDITS записів, рядків не більше, ніж у розмові. Оригінали змінених рядків для архіву |
| mediaFiles | list<string> | ≤ кількості медіа-блоків у видимому вікні (≤ ROW_WINDOW повідомлень). Шляхи медіа-файлів, збережених цим застосуванням; для засіву ([SP_CTX_02_22](#SP_CTX_02_22)) — і медіа замінених пар, і медіа, перенесеного файлами |

Текстовий звіт: `context-editor: applied N edit(s): <applied>. Not applied: <failed>. Conversation ~<before> -> ~<after> chars (~<(before-after)/4> tokens freed). Originals archived at <path>. Media archived: <paths>.` — частини без даних пропускаються.

### 01_06. Archive  {#SP_CTX_01_06}

- Файл `<storage>/<reportId>.json` — `ApplyReport.originals` одного застосування. У `result` викликів і результатів пари, чиї медіа заархівовано окремими файлами, кожен рядок у алфавіті base64 довжиною ≥ MEDIA_DATA у полі `base64` або `data` замінено на `[media archived: <шляхи>]`; інші рядки, зокрема довгий текст у цих полях, лишаються: дані медіа не дублюються в JSON. Шлях вписується в текст кожного зміненого рядка (`(original: <path>)`) лише тоді, коли файл записано.
- Медіа-файли: кожен замінений медіа-ресурс — файл `<storage>/<reportId>/<n>.<ext>` (`n` від 1 у межах застосування; `ext` за `mediaType`: `png`, `jpg`, `gif`, `webp`, `pdf`, інакше `bin`), записаний з декодованих даних. Шляхи вписуються в текст зміненого рядка (`(media: <path>, …)`); для `drop` — лише у звіт.
- Передача способом `transcript` пише в сховище **старої** сесії за тією самою схемою: `<storage>/<id>.json` — оригінали змінених рядків, `<storage>/<id>/<n>.<ext>` — медіа замінених пар і медіа, перенесене файлами ([C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14)), `<storage>/<id>/seed.json` — засіяні рядки ([SP_CTX_01_17](#SP_CTX_01_17)); `id` — час збирання засіву, мс від епохи. Шляхи цих файлів вписано в текст засіяних рядків до очищення сесії, коли ідентифікатор нової сесії ще невідомий ([SP_CTX_DEC_09](#SP_CTX_DEC_09)).
- Зберігання: мод архіви не видаляє; їх обсяг обмежений сумою замінених і перенесених даних сесії. Винятки — файли засіву, який не дійшов до очищення сесії (відкладено або відмовлено): їх видаляє RunHandoff ([SP_CTX_02_21](#SP_CTX_02_21)), бо жоден рядок на них не посилається. Очищення — видаленням каталогу сховища ([SP_CTX_06_01](#SP_CTX_06_01)).

### 01_07. Storage  {#SP_CTX_01_07}

`<storage>` = `<HOME>/.claude/context-editor/<session_id>`. Без змінної `HOME` сховище недоступне. Сховище прив'язане до поточного `session_id`: `/clear` і `/resume` у тому самому процесі змінюють сесію без події старту сесії, тому мод перед кожною операцією порівнює поточний `session_id` зі збереженим і за розбіжності готує сховище заново ([SP_CTX_02_15](#SP_CTX_02_15)); черга і звіти попередньої сесії лишаються в її каталозі.

| Field | Type | Description |
|-------|------|-------------|
| state | `ready` \| `unavailable` | `ready` — каталог існує і доступний лише власникові |
| reason | string? | Чому `unavailable` |

Файли каталогу: `pending.json` (Queue), `tags.json` (TagRegistry), `aliases.json` (AliasRegistry), `boundary.json` (Boundary), архіви й медіа-файли застосувань і передач ([SP_CTX_01_06](#SP_CTX_01_06)), перенесені вбік черги `pending.json.bad-<ms>`. Файлу готовності немає: компактизацію запускає той самий модуль, що її обробляє ([C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)). Файл `editor-ready`, лишений версією з двома розширеннями, мод не читає і не пише.

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
| kind | `pin` \| `disposable` \| `review` | yes | — | — | Значення тегу |
| target | `{ tool_use_id: string }` \| `{ anchor: string, hint: int }` | yes | — | `anchor` — fingerprint, `hint` — індекс на момент тегування | Ціль: пара виклику або рядок |
| note | string? | no | — | для `disposable` обов'язковий, непорожній, ≤ MAX_TEXT | Нотатка-заміна |
| ttl_turns | int? | no | — | ≥ 1; лише для `review` | Через скільки завершених ходів тег стає активним |
| created_turn | int | yes | — | ≥ 0 | Лічильник ходів у момент тегування |

Invariants:
- На одній цілі не більше одного тегу; новий тег на ту саму ціль заміняє попередній.
- `disposable` з `{ anchor }` допустимий лише для рядка `assistant` без викликів.
- `review` активний, коли `ttl_turns` відсутній або `turn - created_turn >= ttl_turns`.

### 01_10. TagRegistry  {#SP_CTX_01_10}

Файл `<storage>/tags.json`. Пише лише мод.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| tags | list<Tag> | yes | `[]` | ≤ MAX_TAGS; серіалізований файл ≤ MAX_QUEUE_BYTES | Теги сесії |
| turn | int | yes | 0 | ≥ 0 | Кількість завершених ходів основної розмови |
| firstPromptPinned | bool | yes | false | — | Правило R1 уже спрацювало |

Стани читання — як у Queue (`missing`, `ok`, `unreadable`); `unreadable` не трактується як порожній реєстр.

### 01_11. AutoTagRules  {#SP_CTX_01_11}

| Rule | Condition (рядок щойно додано в основну розмову) | Tag |
|------|--------------------------------------------------|-----|
| R1 | двері `prompt`, походження — людина (`composer`, `bridge`, `sdk`, `unclassified`), `firstPromptPinned = false` | `pin` на `{ anchor }` цього рядка; `firstPromptPinned = true` |
| R2 | двері `tool-result`, `size ≥ BIG_ROW`, інструмент з походження не з OWN_TOOLS, ціль без тегу | `review` на `{ tool_use_id }`, без терміну |
| R3 | двері `tool-result`, інструмент з походження входить у SEARCH_TOOLS, ціль без тегу | `review` на `{ tool_use_id }`, `ttl_turns = SEARCH_TTL` |

Правила не перезаписують наявний тег і не додають тегу до повного реєстру (межі TAGS_FULL [SP_CTX_02_11](#SP_CTX_02_11)).

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
| NUDGE_FIRST / NUDGE_STEP | 80 000 / 40 000 | Пороги нагадування, токени |
| SEARCH_TOOLS | `Glob`, `Grep`, `WebSearch`, `ToolSearch` | Інструменти правила R3 |
| SEARCH_TTL | 3 | Термін тегу R3, ходи |
| ALIAS_PREFIX / MAX_ALIASES | `c` / 2000 | Префікс псевдоніма виклику / найбільше псевдонімів у реєстрі |
| FLUSH_DELAY | 300 мс | Пауза між завершенням ходу і запуском команди компактизації |
| HEAD_ROWS | 8 | Скільки перших рядків компактизації запам'ятовує Boundary |
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

Стани читання: файл відсутній або `unreadable` — межі немає, поточна розмова — увесь транскрипт.

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
| fromSummary | bool | yes | false | — | Перший рядок засіву — підсумок попередньої компактизації: голова з API-подання ([C_CTX_DEC_12](./context_editor.concept.md#C_CTX_DEC_12), C) або перший рядок CurrentRows, що вже починався з SUMMARY_OPENER (після `--resume` сесії з вбудованою `/compact` читання починається з рядка-підсумку; Verify фази 10, 2026-10-09, F5) |
| unmatchedPromptMedia | int | yes | 0 | ≥ 0 | Медіа в промптах людини, яке не перенеслось ([SP_CTX_02_10](#SP_CTX_02_10)) |
| new | string? | no | — | ставить RunHandoff після `/clear` | Ідентифікатор сесії, яку створив `/clear`; HandleSeed засіває лише її |
| taken | bool | yes | false | — | Обробник засіву повернув `rows` хосту ([SP_CTX_02_26](#SP_CTX_02_26)) |

Invariants:
- Кожен `tool_use_id` у `rows` — ідентифікатор виклику зі старої сесії: незмінена пара зберігає свій, змінена — FreshId ([SP_CTX_02_04](#SP_CTX_02_04)). Тому теги й псевдоніми, скопійовані в сховище нової сесії, розв'язуються на тих самих парах; це очікування перевіряє живий сценарій «Передача засівом» ([SP_CTX_05_03](#SP_CTX_05_03)).
- Медіа в `rows` немає: рядок без `handle` хост будує лише з тексту і блоків інструментів ([C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14)); медіа незмінених пар лежить файлами, а текст результату називає їх.

## 02. Contracts  {#SP_CTX_02}

Усі читання-змінювання-запису файлу в моді проходять через одну послідовну чергу на файл: дві операції над одним файлом не перекриваються. Прямий запит компактизації хоста мод не використовує: неінтерактивний хост відхиляє його завжди, а інтерактивний не викликає для нього обробників самого мода ([C_CTX_01_02](./context_editor.concept.md#C_CTX_01_02)).

Підтримувані хости: Claude Code від версії 2.1.295 — інтерактивний термінал і неінтерактивний хост з потоковим входом (stream-json: розширення VS Code, SDK streaming). Старіші версії не підтримуються. Разовий запуск `claude -p "<prompt>"` — поза межами: після його останнього ходу сесію не прив'язано до процесу, і кожен `$.command.*` відхиляється («no session is bound in this process», навичка plugin-hooks, пункт 18); черга лишається у файлі сесії ([SP_CTX_05_04](#SP_CTX_05_04)).

Команди хоста в черзі. `$.command.run` виконує команду так, ніби її ввела людина: команду поставлено в чергу і виконано, коли сесія вільна; запущена посеред ходу, вона чекає його кінця і виконується одразу після `turn.complete`. Виклик завершується після роботи: `compact` — після відповіді обробника компактизації, `clear` — коли `$.session.id()` уже повертає новий ідентифікатор (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 4; навичка plugin-hooks, пункт 22). Відмова (невідома назва, неприпустиме походження виклику, немає прив'язаної сесії) остаточна, повтор її не змінить. Тому мод робить одну спробу на кожну команду і несе текст відмови хоста в причину або рядок стану.

Походження команди. Хост вирішує, чи ставити команду в чергу, за ланцюжком, з якого її викликано, а не за моментом виклику (навичка plugin-hooks, пункт 23): виклик з таймера, створеного всередині хука `tool.call`, хост відхиляє і через секунди («called from a tool.call hook, it would wait on the turn this hook is holding»; перевірено, Entry 4); для таймера з хука `prompt.submit` те саме виведено за аналогією (хід теж чекає цього хука), не перевірено. Так само виведено, не перевірено окремо: таймер, створений у зворотному виклику таймера, ланцюжок якого почався в `turn.complete` (повторне планування Flush і Schedule), стає в чергу, як і перший; це спостерігають сценарії «Завершення команди після обробника» і «Команда людини» ([SP_CTX_05_03](#SP_CTX_05_03)). Тому мод запускає `$.command.run` лише з відкладеної дії, створеної в обробнику `turn.complete` або іншої події, на яку не чекає жоден хід (зокрема обробник власної команди `/handoff`, [SP_CTX_02_20](#SP_CTX_02_20)), і ніколи з таймера, створеного в хуку `tool.call` чи `prompt.submit`. Інструмент `context_handoff` лише ставить запит у чергу; запускає передачу кінець ходу ([SP_CTX_02_21](#SP_CTX_02_21)).

Лічильник ходів — пам'ять модуля, спільна для [SP_CTX_02_06](#SP_CTX_02_06), [SP_CTX_02_12](#SP_CTX_02_12) і [SP_CTX_02_21](#SP_CTX_02_21); перезавантаження модуля скидає всі три поля до початкових значень: `turns: int` (0) — скільки ходів основної розмови почалося в цьому екземплярі модуля; `inTurn: bool` (false) — хід іде; `lastTurnAborted: bool` (false) — останній завершений хід основної розмови перервано.

    ON turn start (main loop): turns += 1; inTurn = true
    ON turn complete (main loop): inTurn = false; lastTurnAborted = isAborted   # до кроків 02_06, 02_12, 02_21 і до next
    MovedSince(t) = inTurn OR turns ≠ t                                   # хід іде або почався від знімка t

Команди `/clear` і `/compact`, які запускає мод, не породжують ні `prompt.submit`, ні `turn.start`, ні `turn.complete` — в обох хостах (спайк context_editor_handoff_long, Entry 4; навичка plugin-hooks, пункт 22), тож лічильник рахує кожен початок ходу основної розмови і зсувається лише від ходів людини чи агента. Промпт людини, що цитує MARKER, — звичайний хід і рахується. Повідомлення людини посеред ходу вливається в цей хід і окремого початку ходу не дає.

«Рядки основної розмови» в контрактах нижче — поточна розмова за [SP_CTX_02_18](#SP_CTX_02_18), а не весь транскрипт. Опис кожного інструмента не довший за MAX_DESCRIPTION: довший хост обрізає, і модель не бачить його кінця.

### 02_01. context_list  {#SP_CTX_02_01}

Purpose: інструмент агента; показує рядки основної розмови ([SP_CTX_02_18](#SP_CTX_02_18)) від найстарішого, сторінками.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| from | int | no | типово 0; значення поза `0..len-1` обрізається до цих меж |
| count | int | no | типово LIST_COUNT; обрізається до `1..MAX_LIST_COUNT` |

Output: текст. Порожня розмова — `0 rows.`. Інакше заголовок: кількість рядків, загальний розмір (символи і ≈ токени як символи/4), кількість і сумарний розмір медіа, показаний діапазон, розмір рядків перед ним, легенда позначок, `Next page: from=<n>`, якщо далі є рядки. Далі по рядку: `#<index><flags> <role> <size>c: <частини> <теги>`, де `flags` — `*` (текст рядка або результату починається з MARK), `!` (size ≥ BIG_ROW), `@` (є медіа); частини — `text "<90 символів>"`, `tool_use <tool> id=<id>[ (<alias>)] input="<70>"`, `tool_result id=<id>[ ERROR] "<70>"`, `media <mediaType> ~<KB>KB` через ` | `; теги — `[pin]`, `[disposable: "<40 символів нотатки>"]`, `[review]` (лише активний).

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
| collapse, rewrite, describe | межа поточної розмови не змінилась від останнього `context_list` у цьому процесі ([SP_CTX_02_18](#SP_CTX_02_18)) | `the conversation was compacted since your last context_list; call context_list again for current indexes` |
| будь-яка | ціль (пара разом з обома її рядками, рядок, будь-який рядок або пара діапазону `collapse`) не має тегу `pin` | `target is pinned; remove the pin with context_tag first` |

### 02_04. ApplyEdits  {#SP_CTX_02_04}

> **Criticality:** core

Purpose: побудувати новий список рядків з рядків події компактизації і правок черги. Чиста функція.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| rows | list<Row> | yes | рядки події компактизації |
| edits | list<QueuedEdit> | yes | уже перевірені на `pin` ([SP_CTX_02_07](#SP_CTX_02_07)) |
| archive | string | yes | шлях архіву або `""` |
| media | map<owner, list<string>> | yes | шляхи вже збережених медіа-файлів за власником |
| mediaOwners | set<owner> | yes | усі власники медіа в розмові ([SP_CTX_02_10](#SP_CTX_02_10)) |
| knownResults | set<string> | yes | `tool_use_id` результатів, які видно в API-поданні ([SP_CTX_02_10](#SP_CTX_02_10)) |
| unmatchedPromptMedia | int | yes | ≥ 0; кількість повідомлень людини з медіа, не зіставлених з рядками |

Output: `{ rows: list<Row>, report: ApplyReport }`; `charsAfter` дораховує [SP_CTX_02_07](#SP_CTX_02_07).

Processing logic (pseudocode):
    FUNCTION ApplyEdits(rows, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia):
        note = archive ? " (original: " + archive + ")" : ""
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
                    IF the span holds a result whose id is not in knownResults, or a user row without toolResults
                       before the first row whose result is in knownResults:
                       failed "outside the API window; media unknown"
                    IF unmatchedPromptMedia > 0 AND the span holds a user row without toolResults:
                       failed "span may hold prompt media that cannot be archived"
                rewrite, describe: {at} via anchor
            IF edit replaces media of an owner in mediaOwners AND media has no paths for it: failed "media could not be archived"
            plan += (edit, touched, pair?, hi = max(touched))
        SORT plan BY hi DESC; anyRow = {}; exclusiveRow = {}; pairs = {}
        FOR step IN plan:
            conflict = step.pair ? (step.pair ∈ pairs OR step.touched ∩ exclusiveRow ≠ ∅) : step.touched ∩ anyRow ≠ ∅
            IF conflict: report.failed += "overlaps another edit"; CONTINUE
            run step; report.applied += step; anyRow ∪= step.touched
            IF step.pair: pairs += step.pair ELSE exclusiveRow ∪= step.touched
        rows = rebuild every untouched row that has a handle AND toolResults AND none of its owners in mediaOwners
               AND all its result ids in knownResults
        rows = KeepResponsesWhole(rows)
        rows = remove rows without handle that became empty
        RETURN rows, report

    FUNCTION KeepResponsesWhole(rows):            # відповідь моделі не розривається перезібраним рядком
        stretches = rows split before every prompt row (a user row without toolResults that is not a result row a drop left empty: it has a handle or content)   # порожній рядок ще не відфільтровано
        FOR stretch IN stretches:
            k = index of the first assistant row without handle in stretch (rebuilt or inserted); IF none: CONTINUE
            rebuild every assistant row with handle after k in stretch                # thinking-блоки цих рядків губляться
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

Правки пар (summarize, drop) не розрізають рядків, тож кілька правок різних пар на спільних рядках застосовуються послідовно; правки рядків (collapse, rewrite, describe) беруть свої рядки виключно.

«Правка замінює медіа власника»: summarize і drop — власник `{tool_use_id}` пари; collapse — власники всіх пар і рядків діапазону; describe — власник `{row}`.

`Locate(rows, anchor, hint)`: рядок `hint`, якщо його відбиток збігається; інакше єдиний рядок з цим відбитком; інакше «не знайдено».

`FreshId(id)` = `base` + `_ce` + поточний час у base36 + 4 випадкові символи `[0-9a-z]`, де `base` = `id` без кінцевого суфікса `_ce[0-9a-z]+`; результат складається лише з `A–Z a–z 0–9 _ -`. Повторна правка тієї ж пари не подовжує ідентифікатор.

«Перезібрати рядок» = скопіювати `role`, `text`, виклики (`tool_use_id`, `tool`, `input`, `text`) і результати (`tool_use_id`, `text`, `isError`) без `handle`.

Цілісність відповіді (KeepResponsesWhole). Хост зливає рядки асистента з однаковим `message.id` (одна відповідь моделі) при побудові запиту, навіть через рядки з іншим id; `SessionMessage` цього id не показує. Перезібраний рядок отримує синтетичний id і розриває відповідь, а пізніший рядок тієї ж відповіді, повернений з `handle`, хост підтягує назад у раніше повідомлення: його `tool_use` втрачає сусідній результат, модель бачить «Tool result missing due to internal error», а медіа цього результату зникає. Так в обох хостах і обома шляхами компактизації (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 5; навичка plugin-hooks, пункт 30). Відповідь ніколи не перетинає промпт людини, а злиття йде лише назад, тож досить у кожному відрізку між промптами перезібрати рядки асистента з `handle`, що стоять після першого перезібраного або вставленого рядка асистента. Рядки результатів лишаються за чинним правилом: з медіа — з `handle`, без медіа — перезібрані ([SP_CTX_DEC_02](#SP_CTX_DEC_02)); батько до межі в копії рядка результату з `handle` (навичка plugin-hooks, пункт 5) за цього правила не шкодить (Entry 5). Ціна: thinking-блоки пізніших рядків асистента відрізка губляться; рядок, у якому лишився лише thinking, стає порожнім і видаляється. Відбитки (роль, ідентифікатори, текст) від перезбирання не змінюються, тож CurrentRows і межа ([SP_CTX_02_18](#SP_CTX_02_18)) не зачеплені. Засіву ([SP_CTX_02_22](#SP_CTX_02_22)) правило не потрібне: жоден засіяний рядок не має `handle`.

### 02_05. DropOwnCalls  {#SP_CTX_02_05}

Purpose: прибрати з результату ApplyEdits виклики інструментів мода та їхні результати.

Input: рядки, `mediaOwners`, `knownResults`. Logic: множина ідентифікаторів викликів, чия назва починається з OWN_TOOLS, крім тих службових пар, у рядку результату яких є інший результат з власником у `mediaOwners` або з id поза `knownResults` — такі пари лишаються разом із рядками, бо перезбирання знищило б незаархівоване медіа. Кожен рядок, що містить решту службових викликів або результатів, перезбирається без них; потім рядки проходять KeepResponsesWhole ([SP_CTX_02_04](#SP_CTX_02_04)), бо перезібраний рядок асистента зі службовим викликом теж розриває відповідь; рядки без `handle`, що стали порожніми, видаляються. Рядок-носій `collapse` ніколи не є службовим викликом ([SP_CTX_02_04](#SP_CTX_02_04)).

### 02_06. Flush  {#SP_CTX_02_06}

Purpose: після ходу основної розмови запустити застосування черги вбудованою командою компактизації і продовжити сесію ([C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02), C). Працює однаково в інтерактивному терміналі і в неінтерактивному хості з потоковим входом (stream-json: розширення VS Code, SDK streaming). До 2026-10-09 цей контракт виконувало окреме розширення `context-editor-trigger` (TriggerCompaction).

Логіка — чиста функція за портом FlushIO: читання черги, запуск команди хоста, пауза, відправка промпту, рядок стану; зв'язування з хостом — у реєстрації мода.

Input: подія завершення ходу (`agentId?`, `isAborted`). Стан у пам'яті модуля: `scheduled: bool` (false), `lastSubmittedReportId: int` (0), лічильник ходів (`turns`, `inTurn`, `lastTurnAborted`) з преамбули розділу 02; перезавантаження модуля скидає їх.

Processing logic (pseudocode):
    ON turn completed (main loop, not aborted):
        IF NOT scheduled AND storage ready AND Queue state = ok AND len(Queue.edits) > 0 AND Queue.handoff absent:
            scheduled = true; turns0 = turns; AFTER FLUSH_DELAY: Flush(turns0)   # відкладена дія з turn.complete — походження, яке хост ставить у чергу

    FUNCTION Flush(turns0):
        clear the status line
        q = read Queue
        IF q state = unreadable OR len(q.edits) == 0 OR q.handoff present: scheduled = false; RETURN      # правки з передачею застосує RunHandoff
        IF MovedSince(turns0):                                                # хід почався від планування: команду не ставити в чергу за ним
            scheduled = false
            IF NOT inTurn AND NOT lastTurnAborted: scheduled = true; turns0 = turns; AFTER FLUSH_DELAY: Flush(turns0)   # кінець того ходу вже минув і нового планування не дасть
            RETURN                                                            # хід іде — його кінець запланує Flush; хід перервано — черга чекає наступного завершеного ходу
        TRY run built-in command compact with args = MARKER                   # одна спроба; команда чекає, доки сесія вільна
        CATCH err: status line "context-editor: compaction refused: <err text>; queued edits wait for the next turn"; scheduled = false; RETURN
        q = read Queue
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
        scheduled = false                                                     # за будь-якого виходу, зокрема після винятку

Чергу пишуть обробник компактизації ([SP_CTX_02_07](#SP_CTX_02_07)) і, після прийнятого промпту, RemoveDelivered самого Flush ([SP_CTX_02_08](#SP_CTX_02_08)) — обидва на ланцюжку черги. Хост ставить команду в чергу і виконує, коли сесія вільна, з `trigger: 'manual'` і `instructions = MARKER`, і викликає обробники всіх розширень, разом із самим модом ([C_CTX_01_02](./context_editor.concept.md#C_CTX_01_02)); рядки самої команди (`/compact <MARKER>` і позначка виконання) лишаються в розмові з міткою як є: у терміналі хост пише їх повз подію додавання рядка, тож сховати мітку неможливо (спайк context_editor_handoff_long, Entry 4, «Мітка в рядках команди»; навичка plugin-hooks, пункт 24), а текст мітки самопояснювальний ([SP_CTX_01_12](#SP_CTX_01_12)). Відмова хоста остаточна, тож повторів немає: черга лишається до наступного завершеного ходу. Хід, що почався від планування, означає, що людина активна. Перед командою Flush її не запускає: команда, поставлена в чергу за ходом, могла б пережити модуль (див. залишкове вікно в [SP_CTX_05_02](#SP_CTX_05_02)), а правки застосує наступний кінець ходу. Якщо хід почався вже після перевірки, Flush не перебиває людину промптом продовження, і звіт дійде з її наступним промптом. Звіт у промпт продовження вписує сам Flush: хост пропускає власні хуки `prompt.submit` плагіна для промптів, які той надсилає через `$.prompt.submit` («prompt.submit skipped: re-entry (the plugin's own code raised it)»; Verify фази 10, 2026-10-09, F1), тож DeliverReport ([SP_CTX_02_08](#SP_CTX_02_08)) до промпту продовження звіту не додасть. Звіт прибирається з черги лише після того, як промпт увійшов; відхилений промпт лишає звіт для наступного промпту людини. Запуск команди завершується після того, як обробник відповів, тож наступне читання черги бачить звіт цього застосування (черга записана до відповіді обробника); рядків розмови Flush не читає, тож запізнення рядків у неінтерактивному хості (F2, [SP_CTX_02_24](#SP_CTX_02_24)) його не стосується; це очікування обов'язково перевіряє сценарій «Завершення команди після обробника» в обох хостах ([SP_CTX_05_03](#SP_CTX_05_03)). Відповідь `skip` обробника не є відмовою хоста: причина видна людині рядком «Not compacted».

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| HOST_REFUSED | хост відхилив команду (виняток з текстом причини) | черга лишається; рядок стану показує текст відмови; наступна спроба — після наступного завершеного ходу |
| PERSON_MOVED | хід почався від планування, до запуску команди | команда не запускається; Flush заплановано знову кінцем того ходу або одразу, якщо він уже скінчився не перерваним; після перерваного ходу черга чекає наступного завершеного ходу |
| PERSON_ACTIVE | хід почався між перевіркою і виконанням команди | продовження не надсилається; звіт — з наступним промптом людини |
| RESUME_FAILED | відправка промпту продовження відхилена (виняток або результат з `drop`) | `lastSubmittedReportId` не змінюється; звіт лишається в черзі; попередження; звіт дійде з наступним промптом людини (DeliverReport) |
| QUEUE_UNREADABLE | Queue `unreadable` | команда не запускається, нічого не пишеться; файл перенесе наступний `context_edit` ([SP_CTX_02_02](#SP_CTX_02_02)) |

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
        edits = q.edits; pinned edits → failed "target is pinned" (rule of SP_CTX_02_03)
        api = read main conversation in Messages API form
        (found, knownResults, unmatchedPromptMedia) = CollectMedia(api, messages); mediaOwners = keys(found)
        id = now (ms); media = {}; n = 0
        FOR owner IN owners whose media the edits replace:
            FOR ref IN found[owner]:
                n += 1; path = <storage>/<id>/<n>.<ext>
                IF ref.data absent OR writing fails: drop media[owner]; BREAK      # ApplyEdits fails its edits
                media[owner] += path
        archive = <storage>/<id>.json
        (rows, report) = ApplyEdits(messages, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia)
        IF report.originals not empty AND writing archive (compact JSON, through a host command) fails:
            IF the dispatch was abandoned: RETURN skip "compaction abandoned"
            write Queue with every edit failed "originals could not be archived" (report as below)
            RETURN skip "originals could not be archived"                 # оригінали не зникають без архіву
        rows = DropOwnCalls(rows, mediaOwners, knownResults); report.charsAfter = Σ size(rows)   # повернений список уже пройшов KeepResponsesWhole
        IF the dispatch was abandoned (interrupt, budget): RETURN skip "compaction abandoned"   # пакет лишається в черзі
        RebindTags(rows, report)
        text = report text
        write Queue { edits: [], resume: true, resumePrompt: DEFAULT_RESUME, tagsOnly: false,
                      report: (q.report ? q.report + "\n" : "") + text, reportId: id,
                      reportResume: q.resume AND NOT q.tagsOnly, reportPrompt: q.resumePrompt }
        toast first 200 chars of text
        IF report.applied empty: RETURN skip "no edit could be applied"
        RecordBoundary(rows)                                           # SP_CTX_02_18
        RETURN { messages: rows }

    ON handler failure:
        IF agentId present OR trigger = precompute OR instructions NOT IN (MARKER, HANDOFF_MARKER): pass to next handler
        IF instructions = HANDOFF_MARKER: RETURN skip "seeding failed" at once         # RunHandoff побачить, що засів не взято
        RETURN skip "applying the edits failed" at once; in the background, on the queue's serial chain, write
            Queue { edits: [], resume: true, resumePrompt: DEFAULT_RESUME, tagsOnly: false,
                    report: (q.report ? q.report + "\n" : "") + "context-editor: applying the edits failed (<reason>); the conversation was not changed",
                    reportId: now, reportResume: false, reportPrompt: DEFAULT_RESUME }

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

### 02_08. DeliverReport  {#SP_CTX_02_08}

Purpose: довести звіт до агента рівно один раз з промптом, який мод не надсилав сам.

Logic: при кожному промпті основної розмови, що проходить хуки мода (промпт людини або іншого розширення), мод, якщо `Queue.report` присутній, додає `report` як прихований контекст промпту і передає промпт далі. Лише коли промпт увійшов (результат без `drop`), мод на послідовному ланцюжку черги виконує `RemoveDelivered(text)`: видаляє з `report` саме доставлений текст — увесь звіт, якщо він не змінився (тоді також `reportId`, `reportResume = false`, `reportPrompt = DEFAULT_RESUME`), або лише доставлений початок, якщо тим часом дописано новий звіт. Той самий крок виконує Flush після свого промпту продовження ([SP_CTX_02_06](#SP_CTX_02_06)). Промпт, відхилений нижчим обробником, лишає звіт у черзі для наступного промпту.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| PROMPT_DROPPED | нижчий обробник відхилив промпт | звіт лишається в черзі |
| DELIVERY_FAILED | збій читання або запису черги | промпт іде без звіту або звіт лишається; доставка повториться з наступним промптом — тобто при збої запису після вже прийнятого промпту звіт буде доставлено вдруге (щонайменше один раз, не рівно один) |

Промпти, які мод надсилає сам (`$.prompt.submit`: продовження Flush, Deliver передачі), цих хуків не проходять — хост пропускає для них власні хуки `prompt.submit` плагіна (Verify фази 10, 2026-10-09, F1). Тому такі промпти несуть звіт у власному тексті, а DeliverReport служить лише промптам людини (зокрема коли продовження вимкнено або людина вже почала хід). Збій кроку не впливає на промпт.

### 02_09. Nudge  {#SP_CTX_02_09}

Purpose: нагадати агенту почистити контекст з початку.

Processing logic (pseudocode):
    ON tool call finished (main loop, not denied, tool not OWN_TOOLS):
        tokens = context size of the last model request
        level = tokens < NUDGE_FIRST ? -1 : floor((tokens - NUDGE_FIRST) / NUDGE_STEP)
        IF level <= nudged: nudged = min(nudged, level); RETURN result unchanged
        IF storage unavailable OR Queue state = unreadable OR len(Queue.edits) > 0: RETURN result unchanged
        nudged = level
        freed = QueueTagReplacements()                       # SP_CTX_02_13
        IF tokens - freed < NUDGE_FIRST + level * NUDGE_STEP: RETURN result unchanged
        RETURN result + additional context NudgeText(tokens, freed)
    ON hook failure: RETURN the tool result as settled, unchanged

`nudged` живе в пам'яті модуля, починається з -1 і скидається при перезавантаженні модуля. NudgeText: розмір контексту в тисячах токенів, оцінка звільнення від поставлених замін з тегів, кількість активних `review`, вказівка викликати `context_list` (з початку), одним `context_edit` згорнути або стиснути найраніші опрацьовані частини, зберегти дослівно початкове завдання людини, обмеження, відкриті питання і чинні рішення, після чого продовжити.

### 02_10. CollectMedia  {#SP_CTX_02_10}

Purpose: знайти медіа-ресурси розмови, яких немає в Row.

Input: `api` — основна розмова у форматі Messages API, як її повертає читання розмови з поданням `api` (до ROW_WINDOW повідомлень, починається з повідомлення `user`); `rows` — рядки розмови. Output: `found: map<owner, list<MediaRef>>` (не більше записів, ніж медіа-блоків у `api`), `knownResults: set<string>` (усі `tool_use_id` результатів у `api`), `unmatchedPromptMedia: int` (повідомлення людини з медіа, для яких PromptMatch дав «немає»).

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

Purpose: інструмент агента; ставить і знімає теги.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| tags | list<TagRequest> | yes | 1..MAX_TAGS |

TagRequest:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| op | `add` \| `remove` | yes | — | — | Дія |
| kind | `pin` \| `disposable` \| `review` | для `add` | — | — | Значення тегу |
| tool_use_id | string? | рівно одне з трьох | — | — | Ціль — пара виклику |
| index | int? | рівно одне з трьох | — | 0..len-1 | Ціль — рядок за індексом [SP_CTX_02_01](#SP_CTX_02_01) |
| ref | string? | рівно одне з трьох | — | псевдонім або `last` | Ціль — пара виклику за псевдонімом ([SP_CTX_02_17](#SP_CTX_02_17)) |
| note | string? | для `disposable` | — | непорожній, ≤ MAX_TEXT | Нотатка-заміна |
| ttl_turns | int? | no | — | ≥ 1; лише з `kind = review` | Термін |

Output: скільки тегів поставлено і знято, відхилені запити з причинами.

Errors (рівень виклику позначено *, решта — рівень запиту, і решта пакета обробляється):
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT* | виклик із субагента | — |
| DENIED_EMPTY* | `tags` відсутній, порожній або не список | — |
| DENIED_STORAGE* | сховище `unavailable` | — |
| DENIED_REGISTRY_READ* | TagRegistry `unreadable` | реєстр не перезаписується |
| DENIED_REGISTRY_WRITE* | реєстр не записався | причина в повідомленні |
| BAD_OP | `op` не `add`/`remove` | — |
| KIND_REQUIRED | `add` без коректного `kind` | — |
| TARGET_REQUIRED | вказано не рівно одне з `tool_use_id` / `index` / `ref` | — |
| UNKNOWN_REF | `ref` не розв'язується | позначені виклики мають рядок `[context-editor] id …` |
| TARGET_NOT_FOUND | немає пари з таким id або рядка з таким індексом | оновити перегляд |
| INDEXES_STALE | ціль за `index`, а межа поточної розмови змінилась від останнього `context_list` у цьому процесі ([SP_CTX_02_18](#SP_CTX_02_18)) | оновити перегляд |
| NOTE_REQUIRED | `disposable` без коректного `note` | додати нотатку-заміну |
| BAD_TARGET | `disposable` за індексом на рядок, що не є текстом агента без викликів | для результатів — тегувати за `tool_use_id` |
| BAD_TTL | `ttl_turns` < 1 або не для `review` | — |
| TAGS_FULL | новий тег (не заміна) при MAX_TAGS тегах у реєстрі, або файл реєстру став би більшим за MAX_QUEUE_BYTES | зняти непотрібні теги |
| NO_TAG | `remove` для цілі без тегу | — |

Processing logic (pseudocode):
    FUNCTION context_tag(tags):
        REQUIRE storage ready, TagRegistry state != unreadable
        rows = CurrentRows() (SP_CTX_02_18); reg = TagRegistry
        FOR req IN tags:
            validate (table above); on error → rejected += reason; CONTINUE
            target = req.index given ? { anchor: fingerprint(rows[req.index]), hint: req.index }
                                     : { tool_use_id: req.tool_use_id or ResolveRef(req.ref) }
            add: replace any tag on target with Tag(req, created_turn = reg.turn)
            remove: delete the tag on target
        write TagRegistry
        RETURN text report

### 02_12. AutoTag  {#SP_CTX_02_12}

Purpose: застосувати [SP_CTX_01_11](#SP_CTX_01_11) до кожного нового рядка основної розмови.

Processing logic (pseudocode):
    ON row appended (main loop):
        stored = next(row)                         # рядок зберігається без змін
        IF origin.kind = plugin: RETURN stored     # копія після компактизації плагіна або нотатка плагіна — не новий рядок
        IF storage ready AND TagRegistry state != unreadable:
            door, origin = from the append event
            R1: door = prompt AND origin.kind IN (composer, bridge, sdk, unclassified)   # stream-json дає промпту людини unclassified (F3)
            R2, R3: door = tool-result; tool = origin.tool; ids = tool_use_id of each tool_result block
            write TagRegistry if changed
        RETURN stored
    ON turn completed (main loop, not aborted): TagRegistry.turn += 1     # команди мода подій ходу не дають (преамбула 02)
    ON hook failure: RETURN stored row unchanged

Обробник ніколи не змінює і не відхиляє рядок. Рядки з `origin.kind = plugin` правила не бачать: у неінтерактивному хості кожен рядок, повернений обробником компактизації, знову проходить подію додавання з походженням плагіна, що запустив `/compact` (спайк context_editor_handoff_long, Entry 4; навичка plugin-hooks, пункт 24), і без цього фільтра R2 і R3 ставили б теги копіям уже опрацьованих результатів (R2 перевіряє лише, що інструмент не з OWN_TOOLS, а в копії інструмента в походженні немає). Фільтр охоплює будь-який плагін, а не лише цей мод: копії після компактизації іншого плагіна — так само не нові рядки, а свіжий результат інструменту походження плагіна не має. Промпт, який плагін передає від імені людини (`asUser`), має походження плагіна і теж пропускається; поведінка від цього не змінюється, бо R1 і без фільтра вимагає походження людини. Походження людини для R1 — `composer`, `bridge`, `sdk` і `unclassified`: у неінтерактивному хості рядки промптів людини доходять до події додавання з походженням `unclassified`, а не `sdk` (Verify фази 10, 2026-10-09, F3); рядки з походженням плагіна відсікає фільтр вище, тож копії і промпти плагінів R1 не бачить. Інших хуків додавання рядка мод не має. Рядок R1 у переліку [SP_CTX_02_01](#SP_CTX_02_01) — останній рядок `user` без результатів, текст якого збігається з текстовими блоками промпту без урахування пробільних символів (або містить їх); не знайдено — R1 не спрацьовує і `firstPromptPinned` лишається `false`.

### 02_13. QueueTagReplacements  {#SP_CTX_02_13}

Purpose: поставити в чергу заміни з тегів `disposable` і оцінити звільнення.

Output: `freed: int` — `(Σ size замінюваного − Σ довжина нотаток) / 4`.

Processing logic (pseudocode):
    FUNCTION QueueTagReplacements():
        rows = CurrentRows() (SP_CTX_02_18); reg = TagRegistry; q = Queue
        edits = []
        FOR tag IN reg.tags WHERE kind = disposable:
            { tool_use_id } AND pair exists → summarize(tool_use_id, tag.note)
            { anchor } AND Locate finds the row → rewrite(index, tag.note)
        (queued, errors) = PrepareEdits(rows, edits, reg)
        IF queued empty OR len(q.edits) + len(queued) > MAX_QUEUE_EDITS: RETURN 0
        IF len(q.edits) == 0: q.tagsOnly = true
        q.edits += queued; write Queue
        RETURN freed

Пакет лише з тегів не продовжує сесію: звіт піде з наступним промптом людини ([SP_CTX_02_08](#SP_CTX_02_08)). Правка агента в тому самому пакеті знімає `tagsOnly` ([SP_CTX_02_02](#SP_CTX_02_02)).

### 02_14. RebindTags  {#SP_CTX_02_14}

Purpose: тримати реєстр узгодженим з розмовою після застосування.

Logic: у [SP_CTX_02_07](#SP_CTX_02_07) після ApplyEdits видалити псевдоніми змінених і зниклих пар з AliasRegistry, а також теги, чиї цілі змінено застосованими правками (пари `summarize`/`drop` разом з їхніми рядками, пари й рядки діапазонів `collapse`, рядки `rewrite`/`describe`), теги `disposable`, чия заміна (`summarize` пари з `summary = note` або `rewrite` з якорем цілі і `text = note`) була в пакеті — застосована чи відхилена ([SP_CTX_04_03](#SP_CTX_04_03)), і теги, чиї цілі не знайдено в новому списку рядків (за `tool_use_id` або Locate); якщо не застосовано жодної правки, новий список — рядки події. Тег рядка, що лишився, отримує новий індекс як `hint`. Збій запису реєстру не скасовує застосування.

### 02_15. PrepareStorage  {#SP_CTX_02_15}

Purpose: створити сховище, доступне лише власникові, для поточної сесії.

Processing logic (pseudocode):
    ON session start, and before any operation whose session_id differs from the stored one:
        stored session_id = current; nudged = -1
        IF HOME absent: storage = unavailable "HOME is not set"; RETURN
        run host command: create <storage> with parents
        run host command: set permissions owner-only (700) on <HOME>/.claude/context-editor and on <storage>
        IF any command fails or exits non-zero: storage = unavailable "<command>: <stderr>"; status line warning; RETURN
        storage = ready

Періодичного запису немає: зміну сесії (`/clear`, `/resume`, зокрема ті, що запускає RunHandoff) мод помічає перед наступною операцією. Медіа-файли пишуться командою хоста, що декодує base64 з потоку вводу у файл; файли лежать у каталозі сховища, доступному лише власникові.

### 02_16. MarkCall  {#SP_CTX_02_16}

Purpose: дати агенту псевдонім виклику, який варто редагувати.

Processing logic (pseudocode):
    ON tool call finished (main loop, not denied, tool not OWN_TOOLS, tool_use_id present):
        IF len(result text) < BIG_ROW AND tool NOT IN SEARCH_TOOLS: no mark
        IF storage unavailable OR AliasRegistry unreadable: no mark
        alias = ALIAS_PREFIX + next; next += 1; map[alias] = tool_use_id; last = alias; trim to MAX_ALIASES
        write AliasRegistry; IF the write fails: no mark            # псевдонім без запису не розв'язався б
        RETURN result + additional context "[context-editor] id <alias>: use it as \"ref\" in context_tag / context_edit"

Позначка і нагадування ([SP_CTX_02_09](#SP_CTX_02_09)) — один хук: рядок псевдоніма йде першим. Збій позначки не змінює результату інструменту. «Довжина тексту результату» — текст результату так, як його читає модель (поле `text` результату від хоста); у відповіді іншого хука без `text` — довжина серіалізованого `result`. Хук чекає запису реєстру перед поверненням результату, тож псевдонім, який бачить агент, уже розв'язується.

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
        write Boundary { head: [fingerprint(r) FOR r IN rows[0 .. min(len(rows), HEAD_ROWS))], count: len(rows) }
        IF written: trusted = true                 # збій запису не зупиняє компактизацію: межа лишається попередньою

    ON storage prepared (session start, session_id changed — SP_CTX_02_15): trusted = false; listedKey = none

    ON compaction (any trigger):
        result = next(e)
        IF agentId present                          # компактизація субагента — не основна розмова
           OR trigger = precompute                  # нічого не встановлює; стоїть лише при використанні через manual/auto
           OR instructions IN (MARKER, HANDOFF_MARKER)   # власну межу пишуть HandleCompaction і HandleSeed, за будь-якого trigger
           OR result is skip: RETURN result
        RecordBoundary(result.messages); RETURN result

    FUNCTION CurrentRows():
        transcript = read main conversation rows (the whole transcript, ≤ ROW_WINDOW newest)
        IF NOT trusted: RETURN transcript          # файл іншого процесу (--resume): хост міг повернути оригінали
        b = read Boundary; IF absent or unreadable: RETURN transcript
        p = the largest index such that fingerprint(transcript[p + k]) = b.head[k] for every k < len(b.head)
            AND len(transcript) - p ≥ b.count
        IF none: RETURN transcript                  # межа поза вікном ROW_WINDOW або відбитки не збіглися
        RETURN transcript[p ..]

    FUNCTION BoundaryAt(transcript, head, count):  # спільний пошук для CurrentRows і CheckSeeded (SP_CTX_02_24)
        RETURN the largest p as above, or none

    FUNCTION Key(): session_id + (trusted ? raw text of the Boundary file : "")
    context_list: listedKey = Key(), once the listing is built (a failed listing renews nothing)
    context_edit, context_tag: index targets are refused (SP_CTX_02_03, SP_CTX_02_11) when listedKey ≠ Key()

Без межі, без довіри або без збігу результат — увесь транскрипт: так само, як до запису межі. Власна компактизація мода — команда з `trigger: 'manual'`, як і `/compact` людини; їх розрізняє лише `instructions`, тож спостерігач пропускає саме MARKER і HANDOFF_MARKER, а `/compact` людини з будь-яким іншим текстом (або без нього) записує межу з рядків, які повернула вбудована компактизація. У засіяній сесії межу записує HandleSeed ([SP_CTX_02_26](#SP_CTX_02_26)) уже в сховище нової сесії: перед засіяними рядками в транскрипті стоять лише рядки команди очищення, і CurrentRows їх відрізає. Межа міняється між переліком і правкою, коли компактизація (мода, `/compact` або автоматична, зокрема посеред ходу) пройшла після `context_list`: тоді індекси, які тримає агент, називають інші рядки, і правки та теги за індексом відхиляються до нового переліку; цілі за `tool_use_id` і `ref` від індексів не залежать. Ключ пам'ятає лише останній перелік: індекси зі сторінки, отриманої до компактизації, після нового переліку іншої сторінки проходять цю перевірку; такі правки ловить лише пошук якорів при застосуванні (Locate). Межа записується до того, як хост прийме повернений список: якщо зовнішній хук іншого плагіна відкине або перепише результат, голова може не знайтися, і CurrentRows поверне весь транскрипт. Індекси переліку, перевірка правок, теги, закріплення й лічильник активних `review` працюють на поточній розмові, тож індекс з переліку відповідає позиції рядка в `e.messages` наступної компактизації.

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
        built = BuildSeed(transcript, rows, api, Queue.edits, TagRegistry, folder, archive)   # SP_CTX_02_22; пише медіа-файли
        IF built is a refusal: remove folder; RETURN built.reason
        IF CheckSeed(built.rows) gives a reason: remove folder; RETURN that reason           # SP_CTX_02_23
        IF built.report.originals not empty AND writing archive (compact JSON, host command) fails:
            remove folder; RETURN "the originals could not be archived"
        IF writing <folder>/seed.json (JSON list of rows, owner-only, host command) fails: remove folder and archive; RETURN "the seed could not be written"
        RETURN HandoffSeed { old, id, rows: built.rows, file: <folder>/seed.json, archive: (originals written ? archive : ""),
                             report: built.report, fromSummary: built.fromSummary, unmatchedPromptMedia: built.unmatchedPromptMedia, taken: false }
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
        step registries: copy tags.json and aliases.json from oldDir into newDir (owner-only); a failure adds " Tags and aliases were not carried over." to the report
        step pin: IF s.fromSummary: PinSummary(newDir, s.rows[0])
        report = "context-editor: this session continues <old> (transcript)."
                 + (s.fromSummary ? " It starts from the summary of an earlier compaction; the rows before it stay in <old>." : "")
                 + (s.unmatchedPromptMedia > 0 ? " Media in <n> of the person's prompt(s) was not carried over." : "")
                 + pin note of PinSummary, if any
                 + "\n" + report text of s.report (SP_CTX_01_05, archive s.archive)
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
        reg = TagRegistry of dir; IF missing: reg = { tags: [], turn: 0, firstPromptPinned: false }
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

Ідентифікатор нової сесії до `/clear` невідомий, тож файл засіву, архів оригіналів і перенесене медіа лежать у сховищі старої сесії ([SP_CTX_DEC_09](#SP_CTX_DEC_09)); їхні шляхи вписано в текст засіяних рядків. Засів живе в пам'яті модуля: перезавантаження модуля між `/clear` і компактизацією засіву лишає нову сесію порожньою, а запит у старій черзі — у стані `running`; новий екземпляр, у якого `handoffInFlight = false`, вважає його належним через HANDOFF_STALE ([SP_CTX_01_15](#SP_CTX_01_15), [SP_CTX_05_04](#SP_CTX_05_04)). Поки RunHandoff цього екземпляра йде, запит не належний, хоч би скільки `/clear` чекав кінця довгого ходу; будь-який виняток RunHandoff до засіву закінчується Fail, AfterClear або FailAfterClear, а збої після засіву Seed перехоплює сам (спливне повідомлення називає крок), тож запит не лишається `running`, хіба що не вдався сам запис старої черги. Теги й псевдоніми копіюються як є: засіяні пари зберігають ідентифікатори викликів старої сесії ([SP_CTX_01_17](#SP_CTX_01_17)), а цілі змінених пар зникли разом із їхніми ідентифікаторами, тож такі теги й псевдоніми ні на що не вказують.

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

Output: `{ rows: list<Row>, report: ApplyReport, fromSummary: bool, unmatchedPromptMedia: int }` або відмова з причиною.

Processing logic (pseudocode):
    FUNCTION BuildSeed(transcript, rows, api, edits, tags, folder, archive, writeMedia):
        (found, knownResults, unmatchedPromptMedia) = CollectMedia(api, rows)             # SP_CTX_02_10
        hidden = some row of rows holds a tool result whose id is not in knownResults
                 OR some user row of rows other than rows[0] has text that, trimmed, starts with SUMMARY_OPENER   # підсумок посеред рядків — межа не записана
        early = []
        IF NOT hidden:                                                                     # модель бачить усі рядки
            IF rows = transcript (CurrentRows found no boundary) AND len(transcript) = ROW_WINDOW:
                REFUSE "the conversation fills the host's 4096-row window; its start may be cut"
            head = none; visible = rows
        ELSE:                                                                              # після вбудованої компактизації, чию межу цей процес не записав
            IF len(api) = ROW_WINDOW OR len(transcript) = ROW_WINDOW:                       # результат міг випасти з вікна читання, а не з погляду моделі
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
        (edits, refused) = screen edits for pin on visible (SP_CTX_02_07; registry unreadable → every edit "tag registry unreadable")
        n = 0; items = {}                                                                  # items[owner][k] — шлях k-го медіа власника або відсутній
        FOR owner IN found, FOR k, ref IN found[owner]:                                    # кожне медіа окремо
            IF ref.data absent: items[owner][k] = absent; CONTINUE
            n += 1; path = <folder>/<n>.<ext of ref.mediaType>                             # ext — як у SP_CTX_01_06
            IF NOT writeMedia(path, ref.data): REFUSE "media of <owner> could not be archived"
            items[owner][k] = path
        media = for each owner, the present paths of items[owner] in order                 # вхід ApplyEdits: шляхи для mediaNote
        (seed, report) = ApplyEdits(visible, edits, archive, media, mediaOwners = ∅, knownResults, unmatchedPromptMedia)   # SP_CTX_02_04
        report.failed = early + refused + report.failed
        seed = DropOwnCalls(seed, ∅, knownResults)                                         # зокрема виклик context_handoff
        replaced = owners whose media the edits in report.applied replace
        FOR each tool result t in seed whose owner {t.tool_use_id} is in found and not in replaced:
            t.text = t.text + (t.text blank ? "" : "\n\n") + CarryNote(found[owner], items[owner])
        seed = every row of seed rebuilt without handle                                    # handle старої сесії після /clear хост мовчки ігнорує
        IF head present: seed = [head] + seed
        IF seed[0] has role user AND seed[0].text has a line that holds TRANSCRIPT_LINE: remove every such line, then trim seed[0].text
        UNTIL nothing changes: drop leading assistant rows; drop tool results whose call is in no earlier row;
                               drop calls whose result is in no later row; drop rows without text, calls and results
        IF seed empty: REFUSE "no rows to carry over"
        IF len(seed) > ROW_WINDOW − SEED_ROOM: REFUSE "the seed has <n> rows; at most ROW_WINDOW − SEED_ROOM fit the new session's read window"
        report.mediaFiles = every present path in items; report.charsAfter = Σ size(seed)
        RETURN seed, report, fromSummary = (head present OR trimmed text of seed[0] starts with SUMMARY_OPENER), unmatchedPromptMedia   # F5

    CarryNote(refs, paths) = MARK + " media carried as files (open them with Read): " + one item per k, joined ", ":
        paths[k] present → "<refs[k].mediaType> <paths[k]>"; paths[k] absent (refs[k] without inline data) → "<refs[k].mediaType> (not carried: no inline data)"

Голова — підсумок вбудованої компактизації, перше повідомлення API-подання. Вміст повідомлення API-подання, заданий рядком, — один текстовий блок з цим текстом. Результат поза API-поданням означає «модель цього рядка не бачить» лише тоді, коли жодне з вікон читання не заповнене: рядки, що випали за межу ROW_WINDOW, модель ще може бачити, тож за заповненого вікна засів відмовляє (WINDOW_FULL). Блок-нагадування — текстовий блок, обрізаний текст якого починається з `<system-reminder>`. `mediaOwners = ∅` у виклику ApplyEdits: усе медіа засіяних рядків уже лежить файлами, а засіяний рядок ніде не зберігає `handle`, тож правила ApplyEdits, що бережуть незаархівоване медіа сусідніх пар, тут не потрібні; шляхи замінених пар потрапляють у текст правки (`(media: …)`), як при компактизації. Медіа в промптах людини не переноситься, доки відкрите [SP_CTX_DEC_06](#SP_CTX_DEC_06): його кількість (`unmatchedPromptMedia`) називає звіт нової сесії. Thinking-блоки не переносяться: рядок без `handle` хост будує лише з тексту і блоків інструментів. Нагадування хоста (`<system-reminder>`) і повторно вкладені вбудованою компактизацією файли до засіву не потрапляють: голова — лише текст підсумку, а рядки беруться з транскрипту, не з API-подання. Рядки команд (`/compact`, «Compacted») поточної розмови засіваються як звичайні рядки людини.

Errors (кожна — відмова з причиною, RunHandoff переходить на `document`):
| Code | Condition |
|------|-----------|
| WINDOW_FULL | модель бачить усі рядки, CurrentRows не знайшов межі, а читання повернуло рівно ROW_WINDOW рядків; або є результат поза API-поданням, а читання розмови чи API-подання повернуло рівно ROW_WINDOW елементів |
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

## 03. Validation Rules  {#SP_CTX_03}

### 03_01. Input Validation  {#SP_CTX_03_01}

- Інструменти мода відмовляють виклику з субагента.
- Кожна правка проходить [SP_CTX_02_03](#SP_CTX_02_03) незалежно; кожен запит тегу — таблицю помилок [SP_CTX_02_11](#SP_CTX_02_11).
- `resume_prompt` з самих пробілів ігнорується; довший за MAX_TEXT відхиляє весь виклик (DENIED_PROMPT_TOO_LONG).
- Жодна правка — від агента чи з тегів — не зачіпає ціль з тегом `pin`, ні при постановці, ні при застосуванні.

### 03_02. Output Validation  {#SP_CTX_03_02}

- Новий список рядків задовольняє інваріант пар [SP_CTX_01_01](#SP_CTX_01_01).
- Жоден змінений рядок не зберігає `handle`; незмінений рядок з результатами інструментів зберігає `handle` тоді й лише тоді, коли має медіа ([C_CTX_DEC_06](./context_editor.concept.md#C_CTX_DEC_06)); незмінений рядок асистента зберігає `handle` лише тоді, коли в його відрізку між промптами людини перед ним немає перезібраного чи вставленого рядка асистента (KeepResponsesWhole, [SP_CTX_02_04](#SP_CTX_02_04)).
- Текст кожного зміненого результату інструменту і кожного зміненого рядка без результатів починається з MARK.
- Медіа зникає з розмови лише разом з правкою, що його замінила, і лише після запису його файлу.
- Пакет застосовується лише тоді, коли файл оригіналів записано; тож кожен змінений текст має посилання `original:` на наявний файл.
- Засів ([SP_CTX_02_22](#SP_CTX_02_22)) проходить CheckSeed ([SP_CTX_02_23](#SP_CTX_02_23)): жоден засіяний рядок не має `handle`, пари цілі, перший рядок — людини. Медіа незміненої пари в засіві — лише файлом, названим у тексті її результату (CarryNote); медіа без вбудованих даних названо там же як неперенесене. Текст першого рядка засіву не містить рядка з TRANSCRIPT_LINE.
- Рядки команди, яку запускає мод, несуть MARKER або HANDOFF_MARKER без змін, а `instructions` обробника дорівнює цьому тексту: мод рядків команди не переписує.

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
| any | unreadable | файл черги пошкоджено | Flush і обробник чекають; нагадування не приходять |
| unreadable | pending | context_edit переносить файл (QUEUE_QUARANTINED) | нова черга з поставленими правками |
| reported | empty | наступний промпт (людини або продовження) отримав звіт | поля звіту видалено |

### 04_02. Edit Lifecycle  {#SP_CTX_04_02}

    [requested] --PrepareEdits ok--> [queued] --ApplyEdits ok--> [applied]
    [requested] --PrepareEdits error--> [rejected]
    [queued] --pin / not located / overlap / pairing / media not archived--> [failed]

### 04_03. Tag Lifecycle  {#SP_CTX_04_03}

    [absent] --context_tag add / AutoTag--> [tagged] --ttl not passed--> [tagged, inactive review]
    [tagged] --disposable at threshold--> [queued as edit] --applied or failed--> [absent]
    [tagged] --context_tag remove / target edited / target gone--> [absent]

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| absent | tagged | агент або правило поставили тег | запис у реєстр |
| tagged | queued as edit | `disposable`, поріг нагадування перейдено | правка в черзі |
| queued as edit | absent | правку застосовано або відхилено при застосуванні | тег видалено (RebindTags) |
| tagged | absent | тег знято, ціль змінено іншою правкою або ціль зникла | тег видалено |

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
| HandleSeed | засів | засів у пам'яті, сесія нова, `messages` — один рядок `/clear` | повернено рядки засіву, `taken = true`, межу записано в сховище нової сесії |
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
| RunHandoff | теги й псевдоніми | реєстри старої сесії | скопійовано в сховище нової сесії до промпту; збій копіювання — речення у звіті, засів лишається |
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
| CurrentRows | межа поза вікном | голови в транскрипті немає | увесь транскрипт |
| CurrentRows | замало рядків після збігу | збіг голови, але `len - p < count` | цей збіг не підходить |
| RecordBoundary | запис | 12 повернених рядків | `head` — 8 відбитків, `count` 12 |
| RecordBoundary | спостерігач | `manual`, `auto`, `plugin` з іншими інструкціями / MARKER або HANDOFF_MARKER з `manual` чи `plugin`, `precompute`, `agentId`, `skip`, порожній результат | межа / немає межі |
| PrepareEdits, context_tag | застарілі індекси | межа змінилась після переліку; collapse, rewrite, тег за `index`, summarize за id | правки й тег за індексом відхилено, summarize і тег за id прийнято |
| HandleCompaction | довгий текст у `data` | пара з заархівованим медіа і довгим текстом у `data` | текст лишається, замінено лише base64 |
| HandleCompaction | архів без дубля медіа | summarize пари з PNG у `result` виклику і результату | у JSON архіву base64 замінено на `[media archived: …]`; інші поля без змін |
| context_list, context_edit, context_tag, context_handoff | опис інструмента | описи чотирьох інструментів | кожен ≤ MAX_DESCRIPTION |
| ApplyEdits | summarize | пара `a`, результат 5000 символів | рядки пари перезібрано, спільний id `a_ce…`, виклик без `text`, результат містить summary; рядки без результатів зберігають `handle`, крім рядків асистента, що стоять у тому самому відрізку після перезібраного рядка `tool_use a` (KeepResponsesWhole) |
| ApplyEdits | collapse | рядки 2..5 з двома парами | 2 рядки-носії з новим id, `4 rows collapsed`; вміст наступного рядка не змінено (рядок асистента того самого відрізка перезібрано без `handle` — KeepResponsesWhole) |
| ApplyEdits | collapse зі службовим викликом першим | діапазон, що починається з виклику `context_list` | носій — перший не службовий виклик; після DropOwnCalls підсумок присутній |
| ApplyEdits | collapse без викликів | діапазон лише з текстових рядків | один рядок з підсумком |
| ApplyEdits | drop | пара `c` | рядки пари зникли |
| ApplyEdits | перекриття | summarize `b` + collapse 2..5 | одна застосована, одна в `failed` |
| ApplyEdits | паралельні виклики | summarize двох паралельних викликів з тих самих рядків | обидві застосовано, обидва результати змінено, ідентифікатори пар збігаються |
| ApplyEdits | медіа сусідньої пари | summarize `p`, у тому самому рядку результат `q` з медіа | `failed` `row also holds media of q`; рядок зберігає `handle`; з summarize `q` у тому самому пакеті й заархівованим медіа — обидві застосовано |
| ApplyEdits | медіа в промптах не зіставлено | collapse діапазону з рядком промпту, `unmatchedPromptMedia = 1` | `failed`; рядок зберігає `handle` |
| ApplyEdits | вікно API | незмінений рядок результату, id якого немає в knownResults | рядок зберігає `handle` |
| ApplyEdits | правка поза вікном | summarize пари, рядок результату якої має id поза knownResults; collapse з таким рядком або з промптом до першого відомого результату | `failed` `outside the API window; media unknown` |
| ApplyEdits | носій без input | collapse з викликом великого інструменту | у носія `input = {}` |
| DropOwnCalls | спільний рядок | службова пара в рядку з результатом, що має медіа або id поза knownResults | службова пара лишається, рядок зберігає `handle` |
| ApplyEdits | зсув | rewrite #6, на початок додано рядок | застосовано до #7 |
| ApplyEdits | якір не знайдено | rewrite #6, рядок змінено | `failed` з причиною |
| ApplyEdits | архів не записано | archive `""` | немає `original:` у тексті |
| ApplyEdits | незмінений рядок з медіа | mediaOwners містить власника незачепленого результату | рядок зберігає `handle` |
| ApplyEdits | одна відповідь: текст і два Read | відрізок: промпт; рядок асистента з текстом; `tool_use a`; результат `a`; `tool_use b`; результат `b` з медіа (усі з `handle`); summarize `a` | рядок `tool_use a` і результат `a` перезібрано; рядок `tool_use b` теж перезібрано (KeepResponsesWhole); результат `b` з медіа зберігає `handle`; рядок тексту перед ними — з `handle` |
| ApplyEdits | без перезібраного асистента у відрізку | правка лише рядка результату (рядки асистента відрізка не змінено) або перезібраний рядок асистента в іншому відрізку | жоден інший рядок асистента цього відрізка не перезібрано |
| ApplyEdits | рядок лише з thinking | після перезібраного рядка асистента у відрізку стоїть рядок асистента з `handle`, що має лише thinking (`text` порожній, викликів немає) | рядок перезібрано, він порожній і видалений |
| DropOwnCalls | службовий виклик посеред відповіді | відрізок: текст, `context_list`, Read з медіа (одна відповідь) | пару `context_list` прибрано; рядок `tool_use` Read перезібрано; результат Read з `handle` |
| ApplyEdits | медіа не заархівовано | правка замінює власника з mediaOwners без шляхів у media | `failed` `media could not be archived` |
| ApplyEdits | describe | рядок промпту з медіа | текст починається з MARK, далі опис, далі оригінальний текст |
| FreshId | повторна правка | id з суфіксом `_ce…` | один суфікс |
| PrepareEdits | обов'язкові поля | summarize без summary; rewrite з порожнім text | `summary is required`, `text is required` |
| PrepareEdits | помилки | невідомий op; невідомий id; індекс поза межами; collapse розриває пару; rewrite рядка з викликом; describe рядка без медіа | відповідні причини з [SP_CTX_02_03](#SP_CTX_02_03) |
| PrepareEdits | pin | collapse діапазону з рядком `pin` | `target is pinned` |
| DropOwnCalls | службові виклики | пара `context_list` | пару прибрано |
| context_list | сторінка | from 0, count 4 | `#0 user`, `#3! user`, `Next page: from=4`; після summarize — `#3* user` |
| context_list | порожня розмова | 0 рядків | `0 rows.` |
| context_edit | помилки | черга `unreadable`; переповнення; збій запису; довгий resume_prompt | DENIED_QUEUE_READ, DENIED_QUEUE_FULL, DENIED_QUEUE_WRITE, DENIED_PROMPT_TOO_LONG; черга не перезаписана |
| context_edit | продовження | `resume:false`, потім застосування | звіт з `reportResume = false`; наступний пакет знову `resume = true` |
| HandleCompaction | збій запису архіву | запис архіву падає | skip; жодна правка не застосована; пакет очищено; звіт `originals could not be archived` для кожної правки |
| HandleCompaction | збій обробника | виняток у застосуванні | skip; черга очищена; звіт про збій |
| HandleCompaction | charsAfter | пакет з викликами `context_list` | `charsAfter` рахується після DropOwnCalls |
| DeliverReport | один раз | звіт у черзі, два промпти людини поспіль | звіт додано лише до першого |
| Flush | запуск | хід завершено, у черзі 2 правки | після FLUSH_DELAY — одна команда `compact` з аргументом MARKER |
| Flush | передача в черзі | правки + handoff | команда не запускається |
| Flush | людина почала хід | `turns` змінився, поки команда чекала; у звіті `reportResume = true` | промпт продовження не надіслано; `lastSubmittedReportId = reportId`; звіт лишається в черзі для DeliverReport |
| Лічильник ходів | промпт з цитатою мітки | промпт людини з текстом `context-editor: apply queued edits` (`turn.start` з цим текстом) | рахується як хід: `turns` +1, `inTurn`; після його кінця — звичайні кроки 02_06, 02_12, 02_21 |
| Лічильник ходів | команди мода | `$.command.run` `clear` і `compact` без подій ходу (Entry 4) | `turns`, `inTurn` і `TagRegistry.turn` не змінюються |
| Flush | продовження один раз | той самий reportId двічі | промпт продовження надіслано один раз |
| Flush | звіт доходить до ходу продовження | звіт `T` у черзі, `reportResume = true`, хід не зсунувся | надіслано один промпт `T + "\n\n" + reportPrompt`; після входу промпту RemoveDelivered(T): звіту в черзі немає; хук `prompt.submit` мода для цього промпту не викликається (F1) |
| AutoTag | копія промпту | у stream-json рядок промпту, повернений компактизацією, знову додається з `door = prompt`, `origin { kind: plugin, name: context-editor }`, `firstPromptPinned = false` | R1 не спрацьовує; реєстр без змін |
| AutoTag | копія великого результату | копія рядка результату Read 5000 символів з `origin.kind = plugin` | R2 і R3 не спрацьовують; тег не дублюється |
| context_tag | помилки | кожен рядок таблиці Errors [SP_CTX_02_11](#SP_CTX_02_11) | відповідний код |
| AutoTag | R1, R2, R3 | перший промпт людини; Read 5000 символів; Grep | `pin`; `review`; `review` з `ttl_turns = 3`; другий промпт без тегу |
| AutoTag | R1 у stream-json | перший промпт людини з `door = prompt`, `origin.kind = unclassified` (F3) | `pin`, `firstPromptPinned = true`; рядок з `origin.kind = plugin` — без тегу |
| QueueTagReplacements | заміни з тегів | два `disposable` при порожній черзі | дві правки, `tagsOnly = true`; після context_edit — `false` |
| Nudge | заміни достатньо | оцінка звільнення опускає нижче порогу | нагадування немає |
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
| HandleCompaction | покинута диспетчеризація | `next.signal` перервано | skip `compaction abandoned`; черга не записується |
| HandleCompaction | недоставлений звіт | у черзі є попередній звіт | новий звіт дописано після старого |
| DeliverReport | промпт відхилено | нижчий обробник повертає `drop` | звіт лишається в черзі |
| context_edit | нечитабельна черга | файл з полем не свого типу, JSON-масив, елемент `edits` не правка | файл перенесено (QUEUE_QUARANTINED), правки поставлено в нову чергу; без переносу — DENIED_QUEUE_READ зі шляхом |
| DeliverReport | дописаний звіт | під час входу промпту дописано новий звіт | видалено лише доставлений текст |
| Flush | відправка відхилена | `submit` падає або повертає `drop` | `lastSubmittedReportId` не змінюється; звіт лишається в черзі; попередження; наступний промпт людини отримує звіт через DeliverReport |
| Flush | хост відмовляє | `compact` падає з текстом T | одна спроба, без очікувань; черга лишається; рядок стану містить T |

Модульні тести: `mods/context-editor/tests/edits.test.ts` (ApplyEdits, PrepareEdits, DropOwnCalls, FreshId, CollectMedia, перегляд), `queue.test.ts` (розбір черги, context_edit, доставка звіту), `compaction.test.ts` (HandleCompaction через порти, збіг за інструкцією за будь-якого `trigger`, гілка HANDOFF_MARKER), `flush.test.ts` (Flush через порт FlushIO). Зв'язування портів з `$` (PrepareStorage, запуск команд хоста) перевіряється живими сценаріями. Теги — `tags.test.ts` (context_tag, AutoTag, QueueTagReplacements, Nudge, RebindTags, розбір реєстру, перелік з тегами) і `compaction.test.ts` (повторна перевірка `pin` і RebindTags у HandleCompaction). Передача — `handoff.test.ts` (context_handoff, розбір запиту в черзі, BuildSeed, CheckSeed, CheckSeeded, HandleSeed, пропуск компактизації, RunHandoff через порт: засів, збій до і після `/clear`, документ, відкладання, один запуск). Поточна розмова — `boundary.test.ts` (CurrentRows, RecordBoundary, розбір Boundary, застарілі індекси в правках і тегах, довжина описів) і `compaction.test.ts` (запис межі в HandleCompaction, межа спостерігача, архів без дубля медіа). Псевдоніми — `aliases.test.ts` (розбір реєстру, MarkCall, межа MAX_ALIASES, ResolveRef, `ref` у context_edit і context_tag, перелік з псевдонімами, очищення після застосування через порт HandleCompaction). describe і PromptMatch не реалізовані (план PL_CTX).

### 05_02. Invariant Checks  {#SP_CTX_05_02}

| Invariant | Verification method |
|-----------|-------------------|
| Пари виклик—результат цілі | після ApplyEdits кожен id виклику має результат і навпаки (модульні тести); наживо — API не відхиляє запит |
| Справжнє підсумовування не запускається через мод | журнал налагодження після команди мода з MARKER або HANDOFF_MARKER: `a hook's N messages stand … core never ran` або `skip`; у неінтерактивному хості — `result` «Not compacted · <reason>» або засіяні/змінені рядки, ніколи підсумок; модульний тест: кожна гілка HandleCompaction і HandleSeed, зокрема збій, відповідає списком або `skip`; Flush і Seed не запускають команду, коли від планування почався хід (`MovedSince`). Гарантія не абсолютна. Залишкове вікно: хід, що почнеться за мілісекунди між перевіркою `MovedSince` і постановкою команди в чергу хоста, з вивантаженням модуля або невдалим гарячим перезавантаженням під час цього ходу, лишає в черзі хоста `/compact <MARKER>` без обробника — хост виконає справжнє підсумовування ([C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)) |
| Рядки команди несуть самопояснювальну мітку, і обробник бачить її ж | після застосування і після засіву транскрипт і API-подання містять рядок команди `/compact` з MARKER або HANDOFF_MARKER дослівно; журнал обробника — `instructions` дорівнює тому самому тексту (спайк context_editor_handoff_long, Entry 4, «Мітка в рядках команди») |
| Засіяна сесія переживає відновлення | `claude -p --resume <new>` новим процесом: модель бачить засіяні рядки, а не порожню розмову; перед межею у файлі сесії лише рядки `/clear` |
| Змінені тексти позначено | починаються з MARK |
| Файли мода доступні лише власникові | права каталогу `<HOME>/.claude/context-editor` — 700 |

### 05_03. Integration Scenarios  {#SP_CTX_05_03}

Живі сценарії в окремому екземплярі Claude Code з розширенням (`--plugin-dir mods/context-editor --debug`) у двох хостах: інтерактивний термінал під керуванням tmux (драйвер `.dev_flow/cache/live-test/ce.sh`) і неінтерактивний хост з потоковим входом у режимі stream-json, яким його запускає розширення VS Code (`-p --input-format stream-json --output-format stream-json`; драйвер `.dev_flow/cache/handoff-long/drive.sh`). Разовий `claude -p "<prompt>"` поза межами ([SP_CTX_05_04](#SP_CTX_05_04)). Статус `pass (2026-10-08, після раунду 3)` — повторний прогін на коді після виправлень рев'ю раундів 1–3; просто `pass` — лише на прототипі до виправлень. Статуси pass до 2026-10-09 отримано на двох розширеннях (коміт b090f48), у терміналі; після переходу на одне розширення і компактизацію командою сценарії «Стиснення в межах сесії», «Три операції», «Нагадування з початку», «Скриншот у результаті інструменту», «Незмінене медіа», «Перегляд після компактизації», «Автоматичне чищення з тегів», «Захист початкового завдання» і всі сценарії передачі проганяються заново в обох хостах; доти їхній статус — історичний. Події ходу від команд мода не очікуються (спайк context_editor_handoff_long, Entry 4); сценарії лише фіксують їхню відсутність у журналі. Хост — Claude Code ≥ 2.1.295.

| Scenario | Preconditions | Steps | Expected result | Status |
|----------|--------------|-------|-----------------|--------|
| Стиснення в межах сесії | файл 500 рядків `KEY_NNNN = hex` | прочитати; summarize, лишивши KEY_0042; спитати KEY_0377 без інструментів | KEY_0042 відомий, KEY_0377 «немає в контексті»; контекст 61.4k → 43.4k токенів | pass (2026-10-08, після раунду 3) |
| Три операції | той самий файл, файл-шум, неіснуючі файли, хибний висновок | drop, collapse, rewrite одним викликом | усі застосовано | pass (2026-10-08, після раунду 3) |
| Нагадування з початку | 5 файлів по ~12k токенів; редагувати лише за нагадуванням | прочитати всі, знайти найбільше KEY_0100 | нагадування після 3-го файлу, три найстаріші читання стиснуто; відповідь big2 | pass (2026-10-08, після раунду 3) |
| Самостійне стиснення | ті самі 5 файлів | те саме | стискає кожен файл після читання; відповідь big2 | pass |
| Дослідження з веб-пошуком | — | порівняння векторних БД | 10 правок, ~42.6k → ~22.9k символів | pass |
| Стиснення в неінтерактивному хості | stream-json (drive.sh), файл 500 рядків `KEY_NNNN = hex` | прочитати; summarize, лишивши KEY_0042; кінець ходу; спитати KEY_0377 без інструментів | компактизація командою з `trigger: 'manual'`; продовження надіслано один раз; агент отримав звіт (у його наступному ході є текст `context-editor: applied 1 edit(s)`, у черзі звіту більше немає); KEY_0042 відомий, KEY_0377 «немає в контексті»; AutoTag не поставив тегів копіям рядків | not run |
| Завершення команди після обробника (обов'язковий, обидва хости) | термінал і stream-json; одне застосування правок і одна передача засівом | журнал з часовими мітками: відповідь обробника компактизації, завершення `$.command.run('compact')`, читання черги Flush / CheckSeeded | `$.command.run` завершується після відповіді обробника в обох хостах; інакше Flush не побачить звіту, а AfterClear очистив би вдалий засів — тоді специфікацію переглядають до коміту | not run |
| Мітка в розмові (обов'язковий, обидва хости) | термінал і stream-json; одне застосування правок | після продовження спитати агента, які рядки з `/compact` він бачить і що вони означають | правки застосовано (KEY_0377 «немає в контексті»); агент бачить `/compact context-editor: apply queued edits` і позначку виконання і пояснює їх як застосування правок мода, не як підсумок; `instructions` обробника дорівнює MARKER | not run |
| Мод вимкнено | черга з правками у файлі сесії, мод не завантажено | завершити хід; потім увімкнути мод і завершити ще один хід | без мода компактизації немає; після ввімкнення правки застосовано після першого завершеного ходу | not run |
| Скриншот у результаті інструменту | PNG з написами | прочитати; summarize з описом | опис у контексті, медіа-файл в архіві відкривається | pass (2026-10-09, фаза 2) — деталі поза описом агент не знає; архівний PNG байт у байт з оригіналом, 0600, Read його відкриває |
| Документ у результаті інструменту | PDF | прочитати; summarize | те саме | pass (2026-10-09, фаза 2) — блок `document`, `application/pdf`, base64; архівний PDF збігається з оригіналом, 0600 |
| Незмінене медіа (обидва хости) | два скриншоти, прочитані в одній відповіді, перед викликами Read — рядок тексту агента | summarize першого | другий агент бачить; помилки «Tool result missing» немає; рядок другого лишився з `@` | not run (попередній pass фази 2 — без рядка тексту перед викликами, де розриву відповіді не виникало; Verify фази 10 знайшов розрив — знахідка C) |
| Зображення в промпті людини | скриншот у промпті | describe | залежить від [SP_CTX_DEC_06](#SP_CTX_DEC_06) | blocked |
| Тег за псевдонімом | 5 файлів | після кожного Read агент ставить `disposable` з `ref: last`, без `context_list` | жодного `context_list`; теги на правильних викликах; заміни на порозі | pass (2026-10-08, фаза 7) |
| Автоматичне чищення з тегів | 5 файлів | агент ставить `disposable` з нотатками | на порозі заміни застосовано без нагадування | pass (2026-10-08, фаза 3) |
| Захист початкового завдання | довга сесія | collapse діапазону з першим промптом | відхилено (`pin`) | pass (2026-10-08, фаза 3) |
| Перегляд після компактизації | дві компактизації мода і одна `/compact` | після кожної — `context_list` | у переліку лише поточна розмова, без копій старих рядків; правка за індексом з переліку застосовується до того самого рядка | pass (2026-10-09, фаза 8) — перелік 15 і 22 рядки при транскрипті 25 і 54; `rewrite` #5 змінив саме цей рядок; після `/compact` 7 рядків від підсумку хоста |
| Передача засівом (термінал) | розмова з Read великого файлу і скриншотом; агент ставить тег за псевдонімом `c1` на незмінену текстову пару (скриншот псевдоніма не отримує: MarkCall позначає лише текст від BIG_ROW) | summarize великого файлу і context_handoff в одному ході | процес у новій сесії; модель знає лише підсумок; пари викликів на місці; результат скриншота закінчується CarryNote, агент відкриває файл Read і називає деталь скриншота; `context_tag` з `ref: c1` у новій сесії знаходить ту саму пару; `claude --resume <new>` новим процесом показує засіяну розмову; стара сесія без змін | not run (попередній pass фази 9 — на способі файлу сесії, b090f48) |
| Передача засівом (неінтерактивний хост) | stream-json (drive.sh), та сама розмова | те саме | те саме; команди відновлення сесії мод не запускає; `-p --resume <new>` показує засіяні рядки | not run |
| Передача довгої сесії після `/compact` | розмова з ключами до і після вбудованої `/compact`; процес перезапущено з `--resume`, щоб межа не була записана в цьому процесі | context_handoff | нова сесія починається з підсумку без рядка `read the full transcript at:`; модель знає ключ з підсумку і ключ з хвоста; звіт називає старт з підсумку | not run |
| Передача документом | те саме | context_handoff mode `document` з документом | нова сесія з документом першим промптом | not run (попередній pass фази 9 — на двох розширеннях) |
| Запасний шлях до очищення (обов'язковий, обидва хости) | збирач відмовляє (тестовий прапорець, напр. WINDOW_FULL); агент **не** передає документа, тож документ дає окремий запит до моделі (`$.model.fork`) | context_handoff без `document` | `$.model.fork` повертає документ і в терміналі, і в stream-json; спосіб `document` у новій сесії, причина у звіті нової | not run (попередній pass фази 9 — на способі файлу сесії, лише термінал) |
| Збій засіву після очищення | обробник засіву повертає засіяні рядки (`taken = true`), а CheckSeeded відмовляє (тестовий прапорець) | context_handoff з документом / без документа | друге `/clear` прибирає засіяну сесію; документ агента з причиною / повідомлення з ідентифікатором старої сесії і шляхом `seed.json`; стара сесія без змін, її правки в черзі | not run |
| Команда людини (обов'язковий, обидва хости) | — | `/handoff` між ходами | те саме, що інструмент; `/clear` і `/compact` з відкладеної дії обробника команди стають у чергу, а не відхиляються | not run (попередній pass фази 9 — `/handoff document` на двох розширеннях) |
| Відновлення сесії | «стиснення» завершено | `claude --resume <id>`, спитати KEY_0377 | «немає в контексті» | **fail** — [C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05) |

### 05_04. Edge Cases and Boundaries  {#SP_CTX_05_04}

| Case | Input | Expected behavior |
|------|-------|-------------------|
| Порожня черга при запиті з MARKER | `edits = []` | skip |
| Жодну правку не знайдено | усі id перейменовано попередньою правкою | skip; звіт з причинами |
| Хост відхиляє команду компактизації | виняток з текстом | одна спроба; черга лишається, текст відмови в рядку стану; наступна спроба — після наступного завершеного ходу |
| Команда чекає кінця ходу | людина надіслала промпт між плануванням і перевіркою перед `/compact` / між перевіркою і виконанням | команди немає (PERSON_MOVED): Flush заплановано знову кінцем того ходу або одразу, якщо він уже скінчився не перерваним; після перерваного — черга чекає наступного завершеного ходу / команда виконується після цього ходу, продовження не надсилається, звіт іде з наступним промптом людини (PERSON_ACTIVE). Залишкове вікно: хід, що почнеться за мілісекунди між перевіркою `MovedSince` і постановкою команди в чергу хоста, з вивантаженням модуля або невдалим гарячим перезавантаженням під час цього ходу, лишає в черзі хоста `/compact <MARKER>` без обробника — хост виконає справжнє підсумовування |
| Разовий `claude -p "<prompt>"` | черга з правками після останнього ходу | після останнього ходу сесію не прив'язано: `$.command.run` відхиляється («no session is bound in this process»), текст — у рядку стану, якщо він є; нічого не застосовано; черга лишається у файлі сесії і застосується після першого завершеного ходу, коли сесію відновлять у підтримуваному хості |
| Передача після `--resume` відредагованої сесії | транскрипт містить оригінали і копії з тими самими ідентифікаторами викликів; межа не довірена | очікувано: BuildSeed відмовляє (NO_SUMMARY, коли копії змінених пар поза API-поданням) або CheckSeed відмовляє (`repeated call id`); у обох випадках — спосіб `document` у старій сесії з причиною у звіті |
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
| Другий процес хоста з тією самою сесією | обидва процеси читають один файл черги | кожен процес запускає команду лише після свого ходу і лише у своїй розмові; правки, чиї цілі не знайдено, — `failed` |
| Передача, коли модель бачить не всі рядки | після вбудованої компактизації, межа якої не записана в цьому процесі | засів з підсумку і видимих рядків ([SP_CTX_02_22](#SP_CTX_02_22)); правки рядків до підсумку — `failed` |
| Передача заповненої розмови | 4096 рядків без межі | спосіб `transcript` відмовляє (WINDOW_FULL), далі `document` |
| Перерваний промпт у новій сесії до засіву | людина надіслала промпт одразу після `/clear` і перервала його до першого рядка агента | HandleSeed не бачить рядка агента і засіває сесію, замінюючи цей промпт засіяними рядками; прийнято: промпт перервано, і він лишається у файлі сесії перед межею |
| Хід почався в новій сесії до засіву | людина надіслала промпт одразу після `/clear` | TURN_IN_NEW: Seed (`inTurn` або `MovedSince(turnsClear)` перед командою) чи HandleSeed відмовляє; RunHandoff не очищає сесію вдруге; FailAfterClear — звіт у старій черзі і спливне повідомлення; повідомлення про збій через Deliver — у звіт черги нової сесії з `reportResume = false`, без промпту |
| Межі `e.messages` інші, ніж у API-поданні | рядки з результатами поза API-вікном | такі рядки зберігають `handle`; Locate за підказкою може влучити в дублікат відбитку — перевіряється спайком [SP_CTX_DEC_06](#SP_CTX_DEC_06) |
| Контекст зменшився | рівень нагадування впав | наступне нагадування — при переході наступного порогу |
| Сесія довша за ROW_WINDOW рядків | — | перегляд і правки охоплюють лише останні ROW_WINDOW; старіші id відхиляються як невідомі |
| Два промпти з однаковим текстом і медіа | — | PromptMatch «немає», describe відхиляється |
| Медіа посиланням, без даних | — | правка в `failed` |
| collapse діапазону з медіа | діапазон зі скриншотом | медіа заархівовано, шлях у тексті носія |
| Тег на пару, яку потім змінив агент | — | тег видаляється, заміна з тегу не ставиться |
| `pin` після постановки правки | правка в черзі, потім `pin` | при застосуванні правка `failed` |
| Перший рядок — промпт розширення | — | R1 чекає промпту людини |
| `HOME` не задано | — | сховище `unavailable`; мод нічого не пише |

## 06. Reversibility  {#SP_CTX_06}

### 06_01. Rollback Strategy  {#SP_CTX_06_01}

| Aspect | Rollback approach |
|--------|-------------------|
| Data/state changes | Розмови, змінені в поточних сесіях, лишаються зміненими до кінця сесії; після `--resume` хост повертає оригінали ([C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05)). Засіяні сесії — звичайні сесії хоста; їх відновлення показує засіяну розмову і без мода |
| Artifacts | Видалити `<HOME>/.claude/context-editor/` (черги, реєстри тегів і псевдонімів, межі, архіви, медіа-файли, файли засіву, лишені файли `editor-ready`); після цього шляхи до архівів і перенесеного медіа в текстах засіяних сесій ведуть у нікуди. Сесії, створені передачею, — звичайні транскрипти хоста, їх видаляють як будь-які інші; стара сесія лишається незмінною |
| Dependent modules | Немає |
| External contracts | Рядки `[context-editor] id …` після результатів і рядки команди `/compact context-editor: …` лишаються в розмові як текст без дії; інструменти `context_list`, `context_edit`, `context_tag`, `context_handoff` і команда `/handoff` зникають з наступного старту сесії; промпти й навички, що на них посилаються, треба прибрати |

Вимкнення: прибрати розширення з `--plugin-dir` / `CLAUDE_CODE_PLUGIN_DIRS` або зі встановлених плагінів. Черга з правками лишається у файлі сесії і застосується після першого завершеного ходу, коли мод увімкнуть.

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

> **Status:** resolved
> **Date:** 2026-10-08

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
> **Date:** 2026-10-08

**Question:** Застосовувати `disposable` після кожного ходу чи лише на порозі нагадування?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — після кожного ходу | контекст завжди мінімальний; компактизація і скидання кешу щоходу |
| B — при переході порогу нагадування | рідкі пакетні заміни |

**Decision:** B — у складі пропозиції щодо тегів, погодженої розробником 2026-10-08.
**Rationale:** пакетне застосування на порозі зберігає економію кешу, заради якої теги існують.
**Rejected because:** A — щоходове скидання кешу.

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
**Rationale:** спайк 2026-10-09 (Claude Code 2.1.295): при трьох компактизаціях — двох редактором і одній `/compact` — `e.messages` дорівнював хвосту транскрипту після останньої межі, а повернені рядки стояли в наступному читанні суцільним блоком з тими самими відбитками. Розробник погодив підхід, запропонований після живих сценаріїв фази 2 («Виправ всі виявлені проблеми»).
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
