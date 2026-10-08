# Редактор контексту агента — Specification  {#SP_CTX}

> **Code:** SP_CTX
> **Status:** draft
> **Created:** 2026-10-08
> **Updated:** 2026-10-08
>
> **Concept:** [C_CTX](./context_editor.concept.md)
> **Depends on:** none
> **Used by:** —
> **Plan:** [PL_CTX](./context_editor.plan.md)
>
> Специфікація двох розширень Claude Code — редактора (`context-editor`) і тригера (`context-editor-trigger`): структури рядків, медіа-ресурсів, правок, тегів, черги, звіту і сховища; контракти інструментів агента, застосування правок, тригера, обробника компактизації, доставки звіту, нагадувань, пошуку медіа і тегування; правила перевірки; життєві цикли; критерії перевірки з живими сценаріями; відкат. Читати перед зміною коду мода або написанням тестів до нього.

## Contents

- [01. Data Structures](#SP_CTX_01) — рядок розмови, правки, черга, звіт, архів, сховище, медіа-ресурс, теги та їх реєстр, реєстр псевдонімів, константи
- [02. Contracts](#SP_CTX_02) — перегляд, постановка правок, застосування, прибирання службових викликів, тригер, обробник компактизації, доставка звіту, нагадування, пошук медіа, тегування, автоправила, заміни з тегів, узгодження тегів, підготовка сховища, позначка викликів і розв'язання псевдонімів
- [03. Validation Rules](#SP_CTX_03) — що перевіряється для вводу агента і для результату застосування
- [04. State Transitions](#SP_CTX_04) — життєвий цикл черги, окремої правки і тегу
- [05. Verification Criteria](#SP_CTX_05) — модульні очікування, інваріанти, інтеграційні сценарії, граничні випадки
- [06. Reversibility](#SP_CTX_06) — як вимкнути мод і що лишається
- [07. Design Decisions](#SP_CTX_DEC) — рішення рівня контрактів

## 01. Data Structures  {#SP_CTX_01}

> Implements: [C_CTX_02](./context_editor.concept.md#C_CTX_02)

Нотація типів абстрактна: `string`, `int`, `bool`, `list<T>`, `map<K, V>`, `set<T>`, `json` (будь-яке значення JSON), `T?` — необов'язкове поле без значення за замовчуванням. «Розмір» тексту — кількість символів.

### 01_01. Row  {#SP_CTX_01_01}

Рядок розмови в поданні хоста. Хост віддає не більше 4096 останніх рядків; індекс 0 — найстаріший доступний рядок.

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

Файл `<storage>/pending.json` ([SP_CTX_01_07](#SP_CTX_01_07)). Пише лише редактор; тригер лише читає.

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
| mediaFiles | list<string> | ≤ кількості медіа-блоків у видимому вікні (≤ 4096 повідомлень). Шляхи медіа-файлів, збережених цим застосуванням |

Текстовий звіт: `context-editor: applied N edit(s): <applied>. Not applied: <failed>. Conversation ~<before> -> ~<after> chars (~<(before-after)/4> tokens freed). Originals archived at <path>. Media archived: <paths>.` — частини без даних пропускаються.

### 01_06. Archive  {#SP_CTX_01_06}

- Файл `<storage>/<reportId>.json` — `ApplyReport.originals` одного застосування. Шлях вписується в текст кожного зміненого рядка (`(original: <path>)`) лише тоді, коли файл записано.
- Медіа-файли: кожен замінений медіа-ресурс — файл `<storage>/<reportId>/<n>.<ext>` (`n` від 1 у межах застосування; `ext` за `mediaType`: `png`, `jpg`, `gif`, `webp`, `pdf`, інакше `bin`), записаний з декодованих даних. Шляхи вписуються в текст зміненого рядка (`(media: <path>, …)`); для `drop` — лише у звіт.
- Зберігання: мод архіви не видаляє; їх обсяг обмежений сумою замінених даних сесії. Очищення — видаленням каталогу сховища ([SP_CTX_06_01](#SP_CTX_06_01)).

### 01_07. Storage  {#SP_CTX_01_07}

`<storage>` = `<HOME>/.claude/context-editor/<session_id>`. Без змінної `HOME` сховище недоступне. Сховище прив'язане до поточного `session_id`: `/clear` і `/resume` у тому самому процесі змінюють сесію без події старту сесії, тому редактор перед кожною операцією порівнює поточний `session_id` зі збереженим і за розбіжності готує сховище заново ([SP_CTX_02_15](#SP_CTX_02_15)); черга і звіти попередньої сесії лишаються в її каталозі.

| Field | Type | Description |
|-------|------|-------------|
| state | `ready` \| `unavailable` | `ready` — каталог існує і доступний лише власникові |
| reason | string? | Чому `unavailable` |

Файл готовності `<storage>/editor-ready`: текст — час останнього запису в мс; редактор переписує його кожні HEARTBEAT, поки сховище `ready`. Готовність для тригера — інструмент `mcp__context-editor__context_edit` зареєстрований у тому самому процесі хоста і файл не старший за READY_FRESH ([SP_CTX_02_06](#SP_CTX_02_06)).

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

Файл `<storage>/tags.json`. Пише лише редактор.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| tags | list<Tag> | yes | `[]` | ≤ MAX_TAGS; серіалізований файл ≤ MAX_QUEUE_BYTES | Теги сесії |
| turn | int | yes | 0 | ≥ 0 | Кількість завершених ходів основної розмови |
| firstPromptPinned | bool | yes | false | — | Правило R1 уже спрацювало |

Стани читання — як у Queue (`missing`, `ok`, `unreadable`); `unreadable` не трактується як порожній реєстр.

### 01_11. AutoTagRules  {#SP_CTX_01_11}

| Rule | Condition (рядок щойно додано в основну розмову) | Tag |
|------|--------------------------------------------------|-----|
| R1 | двері `prompt`, походження — людина (`composer`, `bridge`, `sdk`), `firstPromptPinned = false` | `pin` на `{ anchor }` цього рядка; `firstPromptPinned = true` |
| R2 | двері `tool-result`, `size ≥ BIG_ROW`, інструмент з походження не з OWN_TOOLS, ціль без тегу | `review` на `{ tool_use_id }`, без терміну |
| R3 | двері `tool-result`, інструмент з походження входить у SEARCH_TOOLS, ціль без тегу | `review` на `{ tool_use_id }`, `ttl_turns = SEARCH_TTL` |

Правила не перезаписують наявний тег і не додають тегу до повного реєстру (межі TAGS_FULL [SP_CTX_02_11](#SP_CTX_02_11)).

### 01_12. Constants  {#SP_CTX_01_12}

| Name | Value | Meaning |
|------|-------|---------|
| MARK | `[context-editor]` | Префікс тексту зміненого рядка або результату |
| MARKER | `context-editor: apply queued edits` | Інструкція компактизації, якою тригер позначає свій запит |
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
| HEARTBEAT / READY_FRESH | 5 с / 15 с | Період запису готовності / найбільший вік, за якого тригер вважає редактор готовим; HEARTBEAT × 3 ≤ READY_FRESH |
| TRIGGER_DELAY | 300 мс | Пауза між завершенням ходу і першим запитом компактизації |
| TRIGGER_RETRIES | 20 × 500 мс | Повтори запиту, поки хост відхиляє його через хід, що триває |

### 01_13. AliasRegistry  {#SP_CTX_01_13}

Файл `<storage>/aliases.json`. Пише лише редактор, на власному послідовному ланцюжку.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| next | int | yes | 1 | ≥ 1 | Номер наступного псевдоніма |
| last | string? | no | — | ключ `map` | Останній виданий псевдонім |
| map | map<string, string> | yes | `{}` | ≤ MAX_ALIASES записів; ключ `c<число>`, значення — `tool_use_id` | Псевдонім → виклик |

Стани читання — як у Queue; `unreadable` (зокрема ключ не `c<число>`, число ключа ≥ `next`, порожнє значення, `last` поза `map`, більше MAX_ALIASES записів) не трактується як порожній реєстр: позначок немає, жоден `ref` не розв'язується. Коли записів стало б більше за MAX_ALIASES, найстаріші (з найменшим числом) видаляються. Якщо очищення ([SP_CTX_02_14](#SP_CTX_02_14)) прибирає псевдонім, названий у `last`, поле `last` видаляється: `last` не розв'язується до наступної позначки.

## 02. Contracts  {#SP_CTX_02}

Усі читання-змінювання-запису файлу в редакторі проходять через одну послідовну чергу на файл: дві операції над одним файлом не перекриваються.

### 02_01. context_list  {#SP_CTX_02_01}

Purpose: інструмент агента; показує рядки основної розмови від найстарішого, сторінками.

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
        rows = read main conversation rows
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
        rows = remove rows without handle that became empty
        RETURN rows, report

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

### 02_05. DropOwnCalls  {#SP_CTX_02_05}

Purpose: прибрати з результату ApplyEdits виклики інструментів мода та їхні результати.

Input: рядки, `mediaOwners`, `knownResults`. Logic: множина ідентифікаторів викликів, чия назва починається з OWN_TOOLS, крім тих службових пар, у рядку результату яких є інший результат з власником у `mediaOwners` або з id поза `knownResults` — такі пари лишаються разом із рядками, бо перезбирання знищило б незаархівоване медіа. Кожен рядок, що містить решту службових викликів або результатів, перезбирається без них; рядки без `handle`, що стали порожніми, видаляються. Рядок-носій `collapse` ніколи не є службовим викликом ([SP_CTX_02_04](#SP_CTX_02_04)).

### 02_06. TriggerCompaction  {#SP_CTX_02_06}

Purpose: розширення `context-editor-trigger`; запустити застосування після ходу і продовжити сесію.

Processing logic (pseudocode):
    ON turn completed (main loop, not aborted):
        IF not scheduled AND Queue state = ok AND len(Queue.edits) > 0:
            scheduled = true; AFTER TRIGGER_DELAY: Flush()

    FUNCTION Flush():
        IF NOT EditorReady(): status line "context-editor is not running; queued edits wait"; scheduled = false; RETURN
        clear the status line
        REPEAT up to 20 times:
            IF Queue state != ok OR len(Queue.edits) == 0: BREAK
            TRY request compaction with instructions = MARKER; BREAK
            CATCH: wait 500 ms
        q = read Queue
        IF q.report AND q.reportResume AND q.reportId != lastSubmittedReportId:
            TRY submit prompt q.reportPrompt                 # звіт додає редактор, SP_CTX_02_08
                lastSubmittedReportId = q.reportId
            CATCH: status line "could not resume the session; send any prompt to continue"
        scheduled = false

    FUNCTION EditorReady(): tool mcp__context-editor__context_edit is in this process's tool list
                            AND file <storage>/editor-ready exists AND now - its mtime <= READY_FRESH

Тригер ніколи не пише у файли сховища.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| EDITOR_NOT_READY | інструмента редактора немає в процесі або файл готовності застарів | компактизація не запитується; попередження в рядку стану до наступного готового стану |
| HOST_REFUSED | хост відхилив запит компактизації 20 разів | черга лишається; наступна спроба — після наступного ходу |
| RESUME_FAILED | відправка промпту продовження відхилена (виняток або результат з `drop`) | `lastSubmittedReportId` не змінюється; попередження; звіт дійде з наступним промптом людини |

### 02_07. HandleCompaction  {#SP_CTX_02_07}

> **Criticality:** core

Purpose: обробник події компактизації в редакторі.

Input: подія компактизації з `trigger`, `instructions`, `messages: list<Row>`, `agentId?`.

Processing logic (pseudocode):
    ON compaction(trigger = plugin):
        IF instructions != MARKER OR agentId present: pass to next handler
        IF storage unavailable: RETURN skip "storage unavailable"
        q = read Queue; IF state = unreadable: RETURN skip "queue unreadable"
        IF q.edits empty: RETURN skip "no queued edits"
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
        rows = DropOwnCalls(rows, mediaOwners, knownResults); report.charsAfter = Σ size(rows)
        IF the dispatch was abandoned (interrupt, budget): RETURN skip "compaction abandoned"   # пакет лишається в черзі
        RebindTags(rows, report)
        text = report text
        write Queue { edits: [], resume: true, resumePrompt: DEFAULT_RESUME, tagsOnly: false,
                      report: (q.report ? q.report + "\n" : "") + text, reportId: id,
                      reportResume: q.resume AND NOT q.tagsOnly, reportPrompt: q.resumePrompt }
        toast first 200 chars of text
        IF report.applied empty: RETURN skip "no edit could be applied"
        RETURN { messages: rows }

    ON handler failure:
        IF instructions != MARKER: pass to next handler
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
| SKIP_NONE_APPLIED | жодна правка не застосувалась | звіт пояснює причини |
| SKIP_FAILED | обробник впав | розмова не змінюється; черга очищена; звіт про збій чекає наступного промпту |
| SKIP_ABANDONED | хост покинув диспетчеризацію до повернення | розмова і черга не змінюються; медіа-файли й архів, уже записані, лишаються без посилань |
| SKIP_NOT_ARCHIVED | файл оригіналів не записався | жодна правка не застосовується; пакет очищено; звіт називає кожну правку |

Справжнє підсумовування для запиту з MARKER не запускається за жодної гілки обробника: гілка збою відповідає `skip` одразу, не чекаючи запису черги. Якщо хост відкидає повернений список (збій хука після відповіді), спрацьовує гілка збою: звіт про збій дописується після вже записаного звіту і повідомляє, що розмову не змінено. Обробник не відправляє промпт і не чекає на нього ([SP_CTX_DEC_04](#SP_CTX_DEC_04)).

### 02_08. DeliverReport  {#SP_CTX_02_08}

Purpose: довести звіт до агента рівно один раз.

Logic: при кожному промпті основної розмови (людини або розширення) редактор, якщо `Queue.report` присутній, додає `report` як прихований контекст промпту і передає промпт далі. Лише коли промпт увійшов (результат без `drop`), редактор на послідовному ланцюжку черги видаляє з `report` саме доставлений текст: увесь звіт, якщо він не змінився (тоді також `reportId`, `reportResume = false`, `reportPrompt = DEFAULT_RESUME`), або лише доставлений початок, якщо тим часом дописано новий звіт. Промпт, відхилений нижчим обробником, лишає звіт у черзі для наступного промпту.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| PROMPT_DROPPED | нижчий обробник відхилив промпт | звіт лишається в черзі |
| DELIVERY_FAILED | збій читання або запису черги | промпт іде без звіту або звіт лишається; доставка повториться з наступним промптом | Тригер ([SP_CTX_02_06](#SP_CTX_02_06)) при `reportResume = true` надсилає лише `reportPrompt`; звіт до нього додає цей самий крок. Збій кроку не впливає на промпт.

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

Input: `api` — основна розмова у форматі Messages API, як її повертає читання розмови з поданням `api` (до 4096 повідомлень, починається з повідомлення `user`); `rows` — рядки розмови. Output: `found: map<owner, list<MediaRef>>` (не більше записів, ніж медіа-блоків у `api`), `knownResults: set<string>` (усі `tool_use_id` результатів у `api`), `unmatchedPromptMedia: int` (повідомлення людини з медіа, для яких PromptMatch дав «немає»).

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
| NOTE_REQUIRED | `disposable` без коректного `note` | додати нотатку-заміну |
| BAD_TARGET | `disposable` за індексом на рядок, що не є текстом агента без викликів | для результатів — тегувати за `tool_use_id` |
| BAD_TTL | `ttl_turns` < 1 або не для `review` | — |
| TAGS_FULL | новий тег (не заміна) при MAX_TAGS тегах у реєстрі, або файл реєстру став би більшим за MAX_QUEUE_BYTES | зняти непотрібні теги |
| NO_TAG | `remove` для цілі без тегу | — |

Processing logic (pseudocode):
    FUNCTION context_tag(tags):
        REQUIRE storage ready, TagRegistry state != unreadable
        rows = read main conversation rows; reg = TagRegistry
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
        IF storage ready AND TagRegistry state != unreadable:
            door, origin = from the append event
            R1: door = prompt AND origin.kind IN (composer, bridge, sdk)
            R2, R3: door = tool-result; tool = origin.tool; ids = tool_use_id of each tool_result block
            write TagRegistry if changed
        RETURN stored
    ON turn completed (main loop, not aborted): TagRegistry.turn += 1
    ON hook failure: RETURN stored row unchanged

Обробник ніколи не змінює і не відхиляє рядок. Рядок R1 у переліку [SP_CTX_02_01](#SP_CTX_02_01) — останній рядок `user` без результатів, текст якого збігається з текстовими блоками промпту без урахування пробільних символів (або містить їх); не знайдено — R1 не спрацьовує і `firstPromptPinned` лишається `false`.

### 02_13. QueueTagReplacements  {#SP_CTX_02_13}

Purpose: поставити в чергу заміни з тегів `disposable` і оцінити звільнення.

Output: `freed: int` — `(Σ size замінюваного − Σ довжина нотаток) / 4`.

Processing logic (pseudocode):
    FUNCTION QueueTagReplacements():
        rows = read main conversation rows; reg = TagRegistry; q = Queue
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

Purpose: створити сховище, доступне лише власникові, і повідомляти тригеру про готовність редактора.

Processing logic (pseudocode):
    ON session start (editor), and before any operation whose session_id differs from the stored one:
        stored session_id = current; nudged = -1
        IF HOME absent: storage = unavailable "HOME is not set"; RETURN
        run host command: create <storage> with parents
        run host command: set permissions owner-only (700) on <HOME>/.claude/context-editor and on <storage>
        IF any command fails or exits non-zero: storage = unavailable "<command>: <stderr>"; status line warning; RETURN
        storage = ready; write editor-ready
    EVERY HEARTBEAT: re-check the session_id as above; write editor-ready

Медіа-файли пишуться командою хоста, що декодує base64 з потоку вводу у файл; файли лежать у каталозі сховища, доступному лише власникові.

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

Logic: `last` → `map[last]`; `c<число>` → `map[ref]`; інакше або за відсутності запису — `unknown ref <ref>`. Розв'язання відбувається при постановці правки чи тегу; у черзі й реєстрі тегів зберігається `tool_use_id`. Виклик, що вийшов за вікно 4096 рядків, розв'язується, але правка відхиляється перевірками [SP_CTX_02_03](#SP_CTX_02_03).

## 03. Validation Rules  {#SP_CTX_03}

### 03_01. Input Validation  {#SP_CTX_03_01}

- Інструменти мода відмовляють виклику з субагента.
- Кожна правка проходить [SP_CTX_02_03](#SP_CTX_02_03) незалежно; кожен запит тегу — таблицю помилок [SP_CTX_02_11](#SP_CTX_02_11).
- `resume_prompt` з самих пробілів ігнорується; довший за MAX_TEXT відхиляє весь виклик (DENIED_PROMPT_TOO_LONG).
- Жодна правка — від агента чи з тегів — не зачіпає ціль з тегом `pin`, ні при постановці, ні при застосуванні.

### 03_02. Output Validation  {#SP_CTX_03_02}

- Новий список рядків задовольняє інваріант пар [SP_CTX_01_01](#SP_CTX_01_01).
- Жоден змінений рядок не зберігає `handle`; незмінений рядок з результатами інструментів зберігає `handle` тоді й лише тоді, коли має медіа ([C_CTX_DEC_06](./context_editor.concept.md#C_CTX_DEC_06)).
- Текст кожного зміненого результату інструменту і кожного зміненого рядка без результатів починається з MARK.
- Медіа зникає з розмови лише разом з правкою, що його замінила, і лише після запису його файлу.
- Пакет застосовується лише тоді, коли файл оригіналів записано; тож кожен змінений текст має посилання `original:` на наявний файл.

## 04. State Transitions  {#SP_CTX_04}

### 04_01. Queue Lifecycle  {#SP_CTX_04_01}

    [empty] --context_edit / QueueTagReplacements--> [pending] --turn completed, editor ready, host accepts--> [applying] --handler done--> [reported] --next prompt--> [empty]

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| empty | pending | прийнято ≥ 1 правку | рядок стану показує кількість |
| pending | pending | ще правки; хід перервано; редактор не готовий; хост 20 разів відхилив запит | рядок стану лишається або показує попередження |
| pending | applying | хід завершено, редактор готовий, хост прийняв компактизацію | — |
| applying | reported | обробник застосував пакет, жодна правка не застосувалась або обробник впав | архів, спливне повідомлення, пакет очищено, звіт записано |
| applying | pending | хост покинув диспетчеризацію | черга не змінюється, звіту немає |
| pending | pending | сховище недоступне (SKIP_STORAGE) | черга не змінюється |
| reported | reported + pending | context_edit до доставки звіту | звіт чекає, нові правки в пакеті |
| any | unreadable | файл черги пошкоджено | тригер і обробник чекають; нагадування не приходять |
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

## 05. Verification Criteria  {#SP_CTX_05}

### 05_01. Functional Expectations  {#SP_CTX_05_01}

| Contract | Scenario | Input | Expected outcome |
|----------|----------|-------|------------------|
| ApplyEdits | summarize | пара `a`, результат 5000 символів | рядки пари перезібрано, спільний id `a_ce…`, виклик без `text`, результат містить summary; рядки без результатів зберігають `handle` |
| ApplyEdits | collapse | рядки 2..5 з двома парами | 2 рядки-носії з новим id, `4 rows collapsed`; наступний рядок не змінено |
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
| DeliverReport | один раз | звіт у черзі, два промпти поспіль | звіт додано лише до першого |
| TriggerCompaction | редактор не готовий | `editor-ready` старіший за READY_FRESH | компактизація не запитується, попередження |
| TriggerCompaction | продовження один раз | той самий reportId двічі | промпт продовження надіслано один раз |
| context_tag | помилки | кожен рядок таблиці Errors [SP_CTX_02_11](#SP_CTX_02_11) | відповідний код |
| AutoTag | R1, R2, R3 | перший промпт людини; Read 5000 символів; Grep | `pin`; `review`; `review` з `ttl_turns = 3`; другий промпт без тегу |
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
| TriggerCompaction | відправка відхилена | `submit` падає | `lastSubmittedReportId` не змінюється, попередження |
| TriggerCompaction | хост відмовляє | `compact` падає 20 разів | 20 очікувань по 500 мс; черга лишається |

Модульні тести: `mods/context-editor/tests/edits.test.ts` (ApplyEdits, PrepareEdits, DropOwnCalls, FreshId, CollectMedia, перегляд), `queue.test.ts` (розбір черги, context_edit, доставка звіту), `compaction.test.ts` (HandleCompaction через порти), `mods/context-editor-trigger/tests/flush.test.ts` (TriggerCompaction через порти). Зв'язування портів з `$` (PrepareStorage, EditorReady через список інструментів) перевіряється живими сценаріями. Теги — `tags.test.ts` (context_tag, AutoTag, QueueTagReplacements, Nudge, RebindTags, розбір реєстру, перелік з тегами) і `compaction.test.ts` (повторна перевірка `pin` і RebindTags у HandleCompaction). Псевдоніми — `aliases.test.ts` (розбір реєстру, MarkCall, межа MAX_ALIASES, ResolveRef, `ref` у context_edit і context_tag, перелік з псевдонімами, очищення після застосування через порт HandleCompaction). describe і PromptMatch не реалізовані (план PL_CTX).

### 05_02. Invariant Checks  {#SP_CTX_05_02}

| Invariant | Verification method |
|-----------|-------------------|
| Пари виклик—результат цілі | після ApplyEdits кожен id виклику має результат і навпаки (модульні тести); наживо — API не відхиляє запит |
| Справжнє підсумовування не запускається через мод | журнал налагодження після запиту тригера: `a hook's N messages stand … core never ran` або `skip`; без готовності редактора запиту немає |
| Змінені тексти позначено | починаються з MARK |
| Файли мода доступні лише власникові | права каталогу `<HOME>/.claude/context-editor` — 700 |

### 05_03. Integration Scenarios  {#SP_CTX_05_03}

Живі сценарії в окремому екземплярі Claude Code з обома розширеннями (`--plugin-dir`), керованому через tmux. Статус `pass (2026-10-08, після раунду 3)` — повторний прогін на коді після виправлень рев'ю раундів 1–3; просто `pass` — лише на прототипі до виправлень.

| Scenario | Preconditions | Steps | Expected result | Status |
|----------|--------------|-------|-----------------|--------|
| Стиснення в межах сесії | файл 500 рядків `KEY_NNNN = hex` | прочитати; summarize, лишивши KEY_0042; спитати KEY_0377 без інструментів | KEY_0042 відомий, KEY_0377 «немає в контексті»; контекст 61.4k → 43.4k токенів | pass (2026-10-08, після раунду 3) |
| Три операції | той самий файл, файл-шум, неіснуючі файли, хибний висновок | drop, collapse, rewrite одним викликом | усі застосовано | pass (2026-10-08, після раунду 3) |
| Нагадування з початку | 5 файлів по ~12k токенів; редагувати лише за нагадуванням | прочитати всі, знайти найбільше KEY_0100 | нагадування після 3-го файлу, три найстаріші читання стиснуто; відповідь big2 | pass (2026-10-08, після раунду 3) |
| Самостійне стиснення | ті самі 5 файлів | те саме | стискає кожен файл після читання; відповідь big2 | pass |
| Дослідження з веб-пошуком | — | порівняння векторних БД | 10 правок, ~42.6k → ~22.9k символів | pass |
| Редактор вимкнено | лише тригер; черга з правками у файлі | завершити хід | компактизації немає, попередження | not run |
| Скриншот у результаті інструменту | PNG з написами | прочитати; summarize з описом | опис у контексті, медіа-файл в архіві відкривається | not run |
| Документ у результаті інструменту | PDF | прочитати; summarize | те саме | not run |
| Незмінене медіа | два скриншоти | summarize першого | другий агент бачить | not run |
| Зображення в промпті людини | скриншот у промпті | describe | залежить від [SP_CTX_DEC_06](#SP_CTX_DEC_06) | blocked |
| Тег за псевдонімом | 5 файлів | після кожного Read агент ставить `disposable` з `ref: last`, без `context_list` | жодного `context_list`; теги на правильних викликах; заміни на порозі | pass (2026-10-08, фаза 7) |
| Автоматичне чищення з тегів | 5 файлів | агент ставить `disposable` з нотатками | на порозі заміни застосовано без нагадування | pass (2026-10-08, фаза 3) |
| Захист початкового завдання | довга сесія | collapse діапазону з першим промптом | відхилено (`pin`) | pass (2026-10-08, фаза 3) |
| Відновлення сесії | «стиснення» завершено | `claude --resume <id>`, спитати KEY_0377 | «немає в контексті» | **fail** — [C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05) |

### 05_04. Edge Cases and Boundaries  {#SP_CTX_05_04}

| Case | Input | Expected behavior |
|------|-------|-------------------|
| Порожня черга при запиті з MARKER | `edits = []` | skip |
| Жодну правку не знайдено | усі id перейменовано попередньою правкою | skip; звіт з причинами |
| Хост відхиляє компактизацію | хід ще триває | до 20 повторів; далі черга лишається |
| Хід перервано | — | тригер не спрацьовує |
| Звичайна `/compact` людини | інструкція ≠ MARKER | обробник передає далі, черга не чіпається |
| Перезавантаження модуля редактора | черга непорожня | правки застосовуються після наступного ходу; готовність відновлюється з першим записом |
| Модуль редактора не завантажився після перезавантаження | черга непорожня | якщо хост прибрав інструменти редактора — тригер чекає; якщо інструменти лишились зареєстрованими, а файл готовності молодший за READY_FRESH, запит з MARKER дійде до core — залишковий ризик, вікно ≤ 15 с ([C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)) |
| `/clear` або `/resume` у тому самому процесі | сесія змінилась без старту сесії | перед наступною операцією сховище готується для нової сесії; черга і звіт попередньої лишаються в її каталозі |
| Другий процес хоста з тією самою сесією | файл готовності свіжий від іншого процесу | тригер цього процесу перевіряє інструменти свого процесу; без редактора в ньому — чекає |
| Межі `e.messages` інші, ніж у API-поданні | рядки з результатами поза API-вікном | такі рядки зберігають `handle`; Locate за підказкою може влучити в дублікат відбитку — перевіряється спайком [SP_CTX_DEC_06](#SP_CTX_DEC_06) |
| Контекст зменшився | рівень нагадування впав | наступне нагадування — при переході наступного порогу |
| Сесія довша за 4096 рядків | — | перегляд і правки охоплюють лише останні 4096; старіші id відхиляються як невідомі |
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
| Data/state changes | Розмови, змінені в поточних сесіях, лишаються зміненими до кінця сесії; після `--resume` хост повертає оригінали ([C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05)) |
| Artifacts | Видалити `<HOME>/.claude/context-editor/` (черги, реєстри тегів і псевдонімів, архіви, медіа-файли, файли готовності) |
| Dependent modules | Немає |
| External contracts | Рядки `[context-editor] id …` після результатів лишаються в розмові як текст без дії; інструменти `context_list`, `context_edit`, `context_tag` зникають з наступного старту сесії; промпти й навички, що на них посилаються, треба прибрати |

Вимкнення: прибрати обидва розширення з `--plugin-dir` / `CLAUDE_CODE_PLUGIN_DIRS` або зі встановлених плагінів. Вимкнути лише редактор безпечно: без інструменту редактора в процесі тригер не запитує компактизацію, крім вікна ≤ 15 с після невдалого перезавантаження ([C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)). Вимкнути лише тригер можна, але правки лишаться в черзі без застосування.

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
> **Date:** 2026-10-08

**Question:** Як звіт про застосування доходить до агента?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — обробник компактизації надсилає промпт і чекає | взаємне блокування: відправка завершується, коли стартує хід, а хід стартує після компактизації — підтверджено наживо |
| B — тригер надсилає промпт зі звітом і сам чистить звіт у черзі | два записувачі одного файлу; можлива подвійна доставка |
| C — редактор додає звіт до наступного промпту і чистить його; тригер лише надсилає текст продовження | один записувач черги; доставка рівно один раз |

**Decision:** C.
**Rationale:** без блокування і з єдиним записувачем файлу черги (рев'ю раунд 1).
**Rejected because:** A — блокування; B — гонка двох записувачів.

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
