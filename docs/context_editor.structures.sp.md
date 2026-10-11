# Редактор контексту агента — Specification: Data Structures

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-11
> **Updated:** 2026-10-11
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §01 Data Structures (01_01–01_22) специфікації [SP_CTX](./context_editor.sp.md): структури: рядок розмови, правка, черга, звіт, архів, сховище, медіа-ресурс, теги та реєстр, автоправила, константи (01_12), псевдоніми, межа, запит передачі, засів, етап і позначки рядків, журнал, телеметрія, нотатка, доставка хоста. Читати перед зміною будь-якої структури даних або константи мода.

## Contents

- [01. Data Structures](#SP_CTX_01) — рядки, правки, черга, звіт, архів, сховище, медіа, теги, константи, псевдоніми, межа, передача, етапи, журнал, телеметрія, нотатки, доставки

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

Row не містить зображень і документів; їх знаходить [SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10).

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

Обмеження: `summary`, `text`, `description` — непорожні після обрізання пробілів, не довші за MAX_TEXT. Для `summarize` і `drop` задається рівно одне з `tool_use_id` і `ref`; `ref` — псевдонім виклику або `last` ([SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17)), у черзі правка зберігається вже з `tool_use_id`. Індекси — позиції в переліку [SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01).

### 01_03. QueuedEdit  {#SP_CTX_01_03}

Edit плюс `anchors: list<string>?` — відбитки рядків для правок за індексом: для `collapse` — `[fingerprint(row[from_index]), fingerprint(row[to_index])]`, для `rewrite` і `describe` — `[fingerprint(row[index])]`, для правок за ідентифікатором — відсутні.

`fingerprint(row)` = `role` + `|` + ідентифікатори викликів (`u:<id>`) і результатів (`r:<id>`) через кому + `|` + перші 160 символів `text`.

### 01_04. Queue  {#SP_CTX_01_04}

Файл `<storage>/pending.json` ([SP_CTX_01_07](#SP_CTX_01_07)). Читає і пише лише мод; кожен запис іде послідовним ланцюжком черги.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| edits | list<QueuedEdit> | yes | `[]` | ≤ MAX_QUEUE_EDITS; серіалізований файл ≤ MAX_QUEUE_BYTES | Правки поточного пакета |
| resume | bool | yes | true | — | Продовжувати сесію після застосування поточного пакета. У ході оптимізації (`optimizePrompted = true`), поки агент не обрав продовження (`resumeSet = false`), виклик `context_edit` без `resume` ставить `false`, а з непорожнім `resume_prompt` — `true` ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16)) |
| resumePrompt | string | yes | DEFAULT_RESUME | непорожній, ≤ MAX_TEXT | Текст продовження поточного пакета |
| resumeSet | bool | yes | false | — | Агент уже обрав продовження цього пакета (`resume` або непорожній `resume_prompt` у будь-якому виклику `context_edit`, навіть без прийнятих правок); файл без поля читається як `false` (фаза 18, рев'ю 46) |
| tagsOnly | bool | yes | false | — | Пакет складається лише із замін з тегів |
| keepCache | bool | yes | false | — | Агент попросив для цього пакета заморожений префікс (`keep_cache`, [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22)): останнє явне значення в пакеті; скидається з пакетом; файл без поля читається як `false` (фаза 23, після живого прогону) |
| report | string? | no | — | — | Недоставлені звіти застосувань, з'єднані переносом рядка |
| reportId | int? | no | — | є разом з `report` | Час застосування, мс від епохи; ідентифікує звіт |
| reportResume | bool | yes | false | — | Після цього звіту потрібно продовжити сесію |
| reportPrompt | string | yes | DEFAULT_RESUME | — | Текст продовження для цього звіту |
| handoff | HandoffRequest? | no | — | [SP_CTX_01_15](#SP_CTX_01_15) | Запит передачі в нову сесію; поки він є, правки черги належать передачі |
| optimize | bool | yes | false | — | Мітку оптимізації помічено ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)): запит чекає ходу оптимізації ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)) або промпту людини ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)); блок запиту — `TagRegistry.lastClosed` ([SP_CTX_01_10](#SP_CTX_01_10)) |
| optimizePrompted | bool | yes | false | — | Промпт ходу оптимізації увійшов: мітку у відповіді наступного ходу основної розмови (ходу оптимізації) DetectOptimize ігнорує і знімає прапорець ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)); промпт людини між ходами теж його знімає ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)) — запобіжник петлі |

Стан файлу при читанні: `missing` (файлу немає — значення за замовчуванням), `ok`, `unreadable` (не читається, не розбирається або будь-яке поле має не свій тип). `unreadable` ніколи не трактується як порожня черга.

Invariants:
- `resume`, `resumePrompt`, `resumeSet`, `tagsOnly` стосуються лише поточного пакета і скидаються до значень за замовчуванням під час застосування. Заміна Flush `optimize` → `optimizePrompted` ставить `resume = false`, `resumeSet = false` пакету, що лишився в черзі (його компактизацію покинуто), — продовження вирішує хід оптимізації ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)).
- `report` і непорожній `edits` можуть існувати одночасно: звіт стосується попереднього пакета.
- `optimize` і `optimizePrompted` не бувають `true` одночасно: Flush заміняє `optimize = true` на `optimizePrompted = true` одним записом (порівняння-і-запис: лише коли `optimize` ще `true`) перед відправкою промпту ходу оптимізації і робить зворотну заміну, якщо промпт відхилено ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)); `optimizePrompted` знімає кінець наступного ходу основної розмови (DetectOptimize) або промпт людини між ходами.
- Поки є `handoff`, `optimize` не стає `true` ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)).
- Поля `optimize` і `optimizePrompted` змінюють лише DetectOptimize, Flush (Optimize) і DeliverReport. Кожен інший запис черги — HandleCompaction (зокрема гілка збою), context_edit, QueueTagReplacements, RemoveDelivered, записи передачі — переносить їх без змін: він читає чергу і змінює лише свої поля, а не будує файл зі значень за замовчуванням.

### 01_05. ApplyReport  {#SP_CTX_01_05}

| Field | Type | Description |
|-------|------|-------------|
| applied | list<string> | ≤ MAX_QUEUE_EDITS. Описи застосованих правок (`summarize <id>`, `drop <id>`, `collapse #a..#b`, `rewrite #i`, `describe #i`) — за ціллю в черзі, тобто за індексами до застосування; за цими рядками HandleCompaction і BuildSeed звіряють застосовані правки з пакетом, тож FormatReport їх не змінює, а лише доповнює в тексті (нижче) |
| failed | list<string> | ≤ MAX_QUEUE_EDITS. Опис неприйнятої правки з причиною |
| charsBefore | int | Сума `size` рядків до застосування |
| charsAfter | int | Сума `size` рядків після застосування і [SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05) |
| originals | list<{ edit: string, rows: list<Row> }> | ≤ MAX_QUEUE_EDITS записів, рядків не більше, ніж у розмові. Оригінали змінених рядків для архіву |
| produced | list<{ edit: string, index: int, fingerprint: string }> | ≤ MAX_QUEUE_EDITS. Для кожної застосованої правки, що заміняє рядки (`summarize`, `collapse`, `rewrite`, `describe`), — опис правки, індекс і відбиток останнього рядка, який вона створила (рядок результату пари для `summarize` і `collapse` з носієм, єдиний рядок підсумку для `collapse` без носія, переписаний рядок для `rewrite` і `describe`), у **кінцевому** списку: після DropOwnCalls і KeepResponsesWhole у компактизації, після нормалізації засіву в BuildSeed. Рядок, якого в кінцевому списку вже немає, запису не має. Рахує Produced нижче; читає RebindTags для меж етапів ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)) |
| notesDropped | list<string> | ≤ MAX_NOTES. Ідентифікатори нотаток, чиї рядки це застосування прибрало без заміни (RebindTags, [SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)); заповнюється після RebindTags |
| ownCallsRemoved | int | ≥ 0. Скільки власних викликів мода (пар) прибрав DropOwnCalls ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)) у списку, який замінює розмову; 0 — не прибрано жодного |
| mediaFiles | list<string> | ≤ кількості медіа-блоків у видимому вікні (≤ ROW_WINDOW повідомлень). Шляхи медіа-файлів, збережених цим застосуванням; для засіву ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) — і медіа замінених пар, і медіа, перенесеного файлами |
| deliveries | `{ inserted: int, removed: int, unreadable: string? }` | `inserted`, `removed` ≥ 0. Доставки хоста посеред ходу ([SP_CTX_01_22](#SP_CTX_01_22)), які InsertDeliveries ([SP_CTX_02_36](./context_editor.stages.sp.md#SP_CTX_02_36)) вставило рядками (`inserted`) і які пішли разом із рядком-якорем, що його правка прибрала чи згорнула (`removed`); `unreadable` — причина, коли файл доставок не прочитався і вставок не було. Заповнюється після ApplyEdits (фаза 20) |

Текстовий звіт — `FormatReport(report, archive, kind)`, `kind` = `compaction` | `seed`; форма залежить від того, чи застосовано хоч одну правку:
- `applied` непорожній: `context-editor: applied N edit(s): <applied with NowIndex>. Not applied: <failed>. Conversation ~<before> -> ~<after> chars (estimate: <Estimate(before − after, ratio)> freed; context_list telemetry shows the measured change after the next response). Originals archived at <path>. Media archived: <paths>.` Число звіту — оцінка за символами; справжню зміну вимірює телеметрія (`Last apply`, [SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)): прогін на копії сесії дав оцінку на 46 % вищу за виміряну зміну (рев'ю 39)
- `applied` порожній, `kind = compaction`: `context-editor: no edit was applied; the conversation was not changed. Not applied: <failed>.` — без рядка розміру і без «tokens freed»: обробник відповідає `skip`, і розмова справді не змінилась. Інваріант: у компактизації пакет непорожній, і кожна його правка або застосована, або в `failed`, тож тут `failed` непорожній.
- `applied` порожній, `kind = seed` ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)): `context-editor: no queued edit was applied. Not applied: <failed>.`, а коли `failed` теж порожній — порожній рядок. Рядка розміру немає: без правок розмір засіву відрізняється від видимих рядків лише прибраними службовими викликами мода, доданими CarryNote, головою-підсумком і нормалізацією (прибрані провідні рядки асистента й сирітські результати, рядок TRANSCRIPT_LINE), і «звільнено» про це було б неправдою.

NowIndex (фаза 18; живий прогін фази 15: звіт казав `rewrite #23`, а агент після DropOwnCalls бачив той самий рядок як `#18` і не міг зіставити звіт із переліком): у тексті звіту кожен опис з `applied`, для якого `produced` має запис (`produced.edit` = цей опис), отримує суфікс ` (now #<produced.index>)` — `rewrite #23 (now #18)`, `summarize toolu_X (now #12)`, `collapse #10..#14 (now #11)`, `describe #0 (now #0)`; описи без запису в `produced` (`drop`, правка, чийого рядка в кінцевому списку вже немає) лишаються як є. Індекс — рядок із текстом заміни (рядок результату пари для `summarize` і `collapse` з носієм, рядок підсумку для `collapse` без носія, переписаний рядок для `rewrite` і `describe`), у кінцевому списку, тобто в переліку `context_list` одразу після цього застосування (у засіві — у засіяній сесії). Одна форма для всіх видів: суфікс додається і коли індекс не змінився, а для `summarize` він важливий так само, бо пара отримала новий ідентифікатор (FreshId) і старий `tool_use_id` у переліку вже не знайти. Індекс чинний для переліку відразу після цього застосування; звіт, дописаний до ще не доставленого (RESUME_FAILED), несе індекси своїх застосувань, і пізніше застосування їх зсуває — прийнято, як і для будь-якого індексу з минулого переліку. Межі довжини звіту немає; суфікс додає ≤ 12 символів на правку (≤ MAX_QUEUE_EDITS правок), спливне повідомлення однаково обрізає звіт до 200 символів. Описи в `failed` суфікса не мають: їхні правки нічого не створили.

Після будь-якої з форм, коли `notesDropped` непорожній, додається ` Notes dropped (their rows were removed): <ids>.` Далі, коли серед `applied` є `describe`, — ` `+DESCRIBE_DROPS ([SP_CTX_01_12](#SP_CTX_01_12)). Далі, коли повернений список замінює розмову (у компактизації — `applied` непорожній; у засіві — завжди) і `deliveries.inserted + deliveries.removed` > 0, — ` Messages delivered during your tool calls: <inserted> now stand as rows, <removed> went with the rows your edits replaced.` (частина з нулем пропускається), а коли є `deliveries.unreadable` — ` Messages delivered during your tool calls could not be restored (<unreadable>).` (фаза 20: агент, який бачить на місці системного ходу рядок `user` з `<system-reminder>`, знає, звідки він; згорнуту доставку він бачив у попередженні постановки, [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)). Далі, коли `ownCallsRemoved` > 0 і повернений список замінює розмову (у компактизації — `applied` непорожній; у засіві — завжди), додається ` Your own context-editor calls (<ownCallsRemoved>) were removed; tags and notes stay — see context_list.` (пропозиція P13: агент, чиї виклики `context_note` чи `context_edit` зникли з розмови, не впізнавав своїх дій — живі прогони фаз 14 і 17). Порожній звіт з однією з цих частин починається з `context-editor:`. `ratio` — `TagRegistry.charsPerToken`, прочитаний обробником (HandleCompaction уже читає реєстр) або BuildSeed; обробник телеметрії не запитує ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34)). Частини без даних пропускаються. Правило мінімальне: рядок розміру є тоді й лише тоді, коли застосовано хоч одну правку. `charsBefore` — розмір рядків, до яких правки застосовано (рядки події компактизації або видимі рядки засіву); `charsAfter` — розмір тих самих рядків після ApplyEdits і DropOwnCalls: у компактизації це повернений список, у засіві — до CarryNote і голови, тож «звільнено» рахує лише правки; рядки доставок, вставлені InsertDeliveries, у `charsAfter` не входять — у `charsBefore` їх теж не було (доставка не рядок).

### 01_06. Archive  {#SP_CTX_01_06}

- Файл `<storage>/<reportId>.json` — `ApplyReport.originals` одного застосування. У `result` викликів і результатів пари, чиї медіа заархівовано окремими файлами, кожен рядок у алфавіті base64 довжиною ≥ MEDIA_DATA у полі `base64` або `data` замінено на `[media archived: <шляхи>]`; інші рядки, зокрема довгий текст у цих полях, лишаються: дані медіа не дублюються в JSON. Шлях вписується в текст кожного зміненого рядка (`(original: <path>, open with Read)`, [C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)) лише тоді, коли файл записано.
- Медіа-файли: кожен замінений медіа-ресурс — файл `<storage>/<reportId>/<n>.<ext>` (`n` від 1 у межах застосування; `ext` за `mediaType`: `png`, `jpg`, `gif`, `webp`, `pdf`, інакше `bin`), записаний з декодованих даних. Шляхи вписуються в текст зміненого рядка (`(media: <path>, …)`); для `drop` — лише у звіт.
- Передача способом `transcript` пише в сховище **старої** сесії за тією самою схемою: `<storage>/<id>.json` — оригінали змінених рядків, `<storage>/<id>/<n>.<ext>` — медіа замінених пар і медіа, перенесене файлами ([C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14)), `<storage>/<id>/seed.json` — засіяні рядки ([SP_CTX_01_17](#SP_CTX_01_17)); `id` — час збирання засіву, мс від епохи. Шляхи цих файлів вписано в текст засіяних рядків до очищення сесії, коли ідентифікатор нової сесії ще невідомий ([SP_CTX_DEC_09](./context_editor.sp.md#SP_CTX_DEC_09)).
- Зберігання: мод архіви не видаляє; їх обсяг обмежений сумою замінених і перенесених даних сесії. Винятки — файли засіву, який не дійшов до очищення сесії (відкладено або відмовлено): їх видаляє RunHandoff ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), бо жоден рядок на них не посилається. Очищення — видаленням каталогу сховища ([SP_CTX_06_01](./context_editor.sp.md#SP_CTX_06_01)).

### 01_07. Storage  {#SP_CTX_01_07}

`<storage>` = `<HOME>/.claude/context-editor/<session_id>`. Без змінної `HOME` сховище недоступне. Сховище прив'язане до поточного `session_id`: `/clear` і `/resume` у тому самому процесі змінюють сесію без події старту сесії, тому мод перед кожною операцією порівнює поточний `session_id` зі збереженим і за розбіжності готує сховище заново ([SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15)); черга і звіти попередньої сесії лишаються в її каталозі.

| Field | Type | Description |
|-------|------|-------------|
| state | `ready` \| `unavailable` | `ready` — каталог існує і доступний лише власникові |
| reason | string? | Чому `unavailable` |

Файли каталогу: `pending.json` (Queue), `tags.json` (TagRegistry), `aliases.json` (AliasRegistry), `boundary.json` (Boundary), `journal.json` (Journal, [SP_CTX_01_19](#SP_CTX_01_19)), `deliveries.json` (доставки хоста посеред ходу, [SP_CTX_01_22](#SP_CTX_01_22); фаза 20), архіви й медіа-файли застосувань і передач ([SP_CTX_01_06](#SP_CTX_01_06)), перенесені вбік черги `pending.json.bad-<ms>` і файли доставок `deliveries.json.bad-<ms>`. Файли стану (`pending.json`, `tags.json`, `aliases.json`, `boundary.json`, `journal.json`, `deliveries.json`) лежать у каталозі 700 і власних прав не потребують: `$.fs.write` прав не задає (новий файл — 644, навичка plugin-hooks, пункт 9), але інші користувачі до файлів у каталозі 700 не дістаються. Архіви й медіа-файли, як і раніше, пише команда хоста з `umask 077` (600). Запис кожного файлу стану командою хоста (пункт (d) фази 17) відкинуто: `tags.json` пишеться майже на кожен виклик інструменту, а процес на кожен запис — зайва затримка без виграшу в захисті. Файлу готовності немає: компактизацію запускає той самий модуль, що її обробляє ([C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)). Файл `editor-ready`, лишений версією з двома розширеннями, мод не читає і не пише.

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
| kind | `pin` \| `disposable` \| `review` \| `state` | yes | — | — | Значення тегу ([C_CTX_03_04](./context_editor.mechanisms.concept.md#C_CTX_03_04)) |
| target | `{ tool_use_id: string }` \| `{ anchor: string, hint: int }` \| `{ anchor: string, hint: int, toAnchor: string, toHint: int }` | yes | — | `anchor`, `toAnchor` — fingerprint, `hint`, `toHint` — індекси на момент тегування; діапазон — лише для `disposable`, `hint < toHint` | Ціль: пара виклику, рядок або діапазон рядків від `anchor` до `toAnchor` включно |
| note | string? | no | — | для `disposable` обов'язковий, непорожній, ≤ MAX_TEXT | Нотатка-заміна |
| reason | `big` \| `search` \| `stale` \| `duplicate` \| `agent`? | no | — | лише для `review` | Чому рядок — кандидат: `big` — R2, `search` — R3, `stale` — R4, `duplicate` — R5 ([SP_CTX_01_11](#SP_CTX_01_11)), `agent` — тег агента, записаний версією з фази 15. Відсутня в тезі, записаному до фази 15 (автоматичні R2/R3 і агентські теги фаз 3–17 причини не мають, і встановити її вже не можна): такий тег показується як `[review]` без причини і рахується в телеметрії окремою групою `no reason` ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01), [SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)) |
| ttl_turns | int? | no | — | ≥ 1; лише для `review` | Через скільки завершених ходів тег стає активним |
| created_turn | int | yes | — | ≥ 0 | Лічильник ходів у момент тегування |

Invariants:
- На одній цілі не більше одного тегу; новий тег на ту саму ціль заміняє попередній. Ціль-рядок і ціль-діапазон ототожнюються за `anchor` першого рядка: на рядку починається не більше одного тегу рядка чи діапазону; тег рядка всередині чужого діапазону допустимий.
- `disposable` з `{ anchor }` без діапазону допустимий лише для рядка `assistant` без викликів, який не несе тегу `state` (слот змінює лише `rewrite` його рядка, [C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)); діапазон містить кожен виклик разом з його результатом (правило `collapse`, [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03)) і не захоплює рядка чи пари з тегом `pin` або `state` на момент тегування.
- `state` — лише на `{ anchor }` рядка `assistant` без викликів з непорожнім текстом; у реєстрі не більше одного тегу `state`: новий заміняє попередній, де б той не стояв ([C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)).
- `review` активний, коли `ttl_turns` відсутній або `turn - created_turn >= ttl_turns`; `reason` є в кожному тезі `review`, який пише ця версія.

### 01_10. TagRegistry  {#SP_CTX_01_10}

Файл `<storage>/tags.json`. Пише лише мод.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| tags | list<Tag> | yes | `[]` | ≤ MAX_TAGS; серіалізований файл ≤ MAX_QUEUE_BYTES | Теги сесії |
| turn | int | yes | 0 | ≥ 0 | Кількість завершених ходів основної розмови |
| firstPromptPinned | bool | yes | false | — | Правило R1 уже спрацювало |
| charsPerToken | number? | no | — | CALIB_MIN..CALIB_MAX | Останнє калібрування оцінок розміру: символів поточної розмови на токен рядків розмови з телеметрії ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34)); відсутнє — оцінки «символи/4» з позначкою `approx.` |
| stage | Stage? | no | — | [SP_CTX_01_18](#SP_CTX_01_18) | Відкритий етап; не більше одного |
| lastClosed | ClosedBlock? | no | — | [SP_CTX_01_18](#SP_CTX_01_18) | Останній закритий блок: етап, закритий інструментом або міткою, чи блок без етапу, закритий міткою; його `end` — початок наступного блоку без етапу |
| introduced | bool | yes | false | — | Інструкцію на початку сесії вже доставлено в цій сесії ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) |
| lastApply | `{ at: int, tokensBefore: int }`? | no | — | `tokensBefore` ≥ 0 | Останнє застосування з правками: його `reportId` і розмір запиту (`$.session.usage().context.tokens`) перед ним; телеметрія після наступної відповіді моделі показує виміряну зміну один раз і знімає поле ([SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)); від'ємна зміна не показується (поле теж знімається). Передача (копія реєстру) і компактизація, що не є застосуванням мода (спостерігач [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)), поле знімають: виміряна після них зміна не була б звільненням застосування (рев'ю 40) |
| notes | list<Note> | yes | `[]` | ≤ MAX_NOTES; разом з тегами — у межі файлу MAX_QUEUE_BYTES | Службові нотатки агента ([SP_CTX_01_21](#SP_CTX_01_21)) |
| nextNote | int | yes | 1 | ≥ 1, більше за число кожного `id` у `notes` | Номер наступної нотатки |
| hint | `{ tokens: int?, marks: int, proposed: int? }`? | no | — | `marks` ≥ 1; `tokens`, `proposed` ≥ 0 | Стан м'якого нагадування ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37)): `marks` — `AliasRegistry.next` у мить останньої пропозиції будь-яким каналом, останньої перевірки каналу ходу, що спожила серію, або зменшення контексту, яке побачив канал розміру; `tokens` — розмір запиту (`$.session.usage().context.tokens`) у мить останньої пропозиції, відсутній до першої; `proposed` (int?, ≥ 0; фаза 23, рев'ю 54) — скільки токенів звільняв пакет останньої пропозиції. Поле, що не проходить обмежень, робить реєстр `unreadable`. Передача копіює його разом з реєстром; менший запит у новій сесії починає лічбу заново. Формат з фази 22; фаза 23 додала `proposed`, яке версія фази 22 не перевіряє і при записі губить |

Стани читання — як у Queue (`missing`, `ok`, `unreadable`); `unreadable` не трактується як порожній реєстр. Поле `stage` або `lastClosed`, що не проходить своїх обмежень, робить реєстр `unreadable`, як і погане поле тегу.

### 01_11. AutoTagRules  {#SP_CTX_01_11}

| Rule | Event and condition | Tag |
|------|---------------------|-----|
| R1 | рядок додано: двері `prompt`, походження — людина (`composer`, `bridge`, `sdk`, `unclassified`), `firstPromptPinned = false` | `pin` на `{ anchor }` цього рядка; `firstPromptPinned = true` |
| R2 | рядок додано: двері `tool-result`, `size ≥ BIG_ROW`, інструмент з походження не з OWN_TOOLS, ціль без тегу | `review`, `reason = big`, на `{ tool_use_id }`, без терміну |
| R3 | рядок додано: двері `tool-result`, інструмент з походження входить у SEARCH_TOOLS, ціль без тегу | `review`, `reason = search`, на `{ tool_use_id }`, `ttl_turns = SEARCH_TTL` |
| R4 | виклик завершено ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)): інструмент з WRITE_TOOLS, виклик не відхилено і результат не помилка; шлях = `input.file_path` (`Edit`, `Write`) або `input.notebook_path` (`NotebookEdit`) | `review`, `reason = stale`, без терміну, на `{ tool_use_id }` кожної пари `Read` поточної розмови, чий рядок виклику стоїть перед рядком виклику запису, з `input.file_path`, що дорівнює шляху дослівно; заміняє наявний `review` будь-якої причини, інших тегів не чіпає ([SP_CTX_DEC_13](./context_editor.sp.md#SP_CTX_DEC_13)) |
| R5 | рядок додано, походження не плагін: (а) двері `tool-result`, інструмент не з OWN_TOOLS — для кожного результату цього рядка: його текст довжиною ≥ BIG_ROW і або дорівнює тексту результату ранішої пари, або (інструмент виклику цього результату — `Read`) `file_path`, `offset`, `limit`, `pages` виклику дорівнюють полям ранішої пари `Read` (відсутнє дорівнює лише відсутньому); результат ранішої пари, текст якого починається з MARK (вже стиснутий), дублікатом не є; (б) двері `prompt`, `tool-message` або `attachment`, рядок — `user` без результатів, текст ≥ BIG_ROW дорівнює тексту ранішого рядка `user` без результатів | `review`, `reason = duplicate`, без терміну, на **ранішу** копію: `{ tool_use_id }` ранішої пари (а) або `{ anchor }` ранішого рядка (б); заміняє наявний `review` з причиною `big` або `search`, інших тегів не чіпає |

Правила R1–R3 не перезаписують наявний тег; R4 і R5 — лише в межах, названих у таблиці. Жодне правило не додає тегу до повного реєстру (межі TAGS_FULL [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)). «Раніша пара» і «раніший рядок» — у поточній розмові ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) перед рядком, що спрацював; для R4 — пара `Read`, рядок виклику якої стоїть перед рядком виклику запису (паралельний `Read` у тій самій відповіді після запису не позначається; рядка виклику запису ще немає в розмові — ранішими вважаються всі). R5 (б) — умовний контракт. Головний випадок, заради якого він є, — повторно вкладений текст навички (P3: навичка dev-flow двічі по ~10 тисяч токенів); чи хост додає такий текст рядком поточної розмови і якими дверима, не перевірено, а вкладення хоста (перелік навичок, доставки `queued_command`) рядками `$.session.messages()` не є (навичка plugin-hooks, пункти 41 і 43). Тому фаза 15 починає з проби «Дублікат вставки навички» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)): якщо повторна вставка стоїть рядком поточної розмови, R5 (б) реалізується для дверей, які назве проба; якщо ні — R5 (б) цілком переходить у backlog плану з тригером повернення, а R5 (а) лишається. До фази 15 хук `session.append` мода слухає лише двері `prompt` і `tool-result` ([SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)). Результат проби (фаза 15, 2026-10-10, stream-json, 2.1.295; `.dev_flow/cache/phase15/probe/log.jsonl`): текст навички, яку відкрив `Skill`, проходить `session.append` дверима `tool-message` (`origin { kind: tool, tool: Skill }`, `isMeta`), але рядком `$.session.messages()` (поточної розмови) не є, а повторний `Skill` тієї самої навички хост удруге не вставляє (рядок «Skill … is already loaded above», 73 символи). R5 (б) тому не реалізовано: він у backlog плану з тригером «хост почав передавати вставки навичок рядками розмови або агент скаржиться на дубльовану навичку»; R5 (а) реалізовано, хук і далі слухає лише `prompt` і `tool-result`.

### 01_12. Constants  {#SP_CTX_01_12}

| Name | Value | Meaning |
|------|-------|---------|
| MARK | `[context-editor]` | Префікс тексту зміненого рядка або результату. Код розпізнає змінені рядки лише за цим префіксом (позначка `*` переліку, R5 (а), PersonText); слова після нього — частина тексту заміни: хто і коли її написав (`you read the full output here, then replaced it with your summary`, [SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17); [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) |
| MARKER | `context-editor: apply queued edits` | Аргумент вбудованої команди компактизації, яким мод позначає застосування черги ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)); обробник бачить його як `instructions`. Текст самопояснювальний: модель бачить його в рядку команди `/compact` разом з позначкою виконання |
| HANDOFF_MARKER | `context-editor: seed the handed-off conversation` | Аргумент вбудованої команди компактизації, яким мод засіває очищену сесію ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21), [SP_CTX_02_26](./context_editor.handoff.sp.md#SP_CTX_02_26)); видимий моделі так само, як MARKER |
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
| WRITE_TOOLS | `Edit`, `Write`, `NotebookEdit` | Інструменти правила R4: зміна файлу, після якої ранні читання цього шляху застаріли ([SP_CTX_DEC_13](./context_editor.sp.md#SP_CTX_DEC_13)) |
| REPRODUCIBLE_TOOLS | `Read`, `Grep`, `Glob` | Інструменти, чий вивід відтворюється з диска; окремого інструмента читання блокнотів хост не має (блокнот читає `Read`) |
| REPRO_FLAG | `~` | Позначка класу пари в перегляді: ставиться на частину `tool_use` і частину `tool_result` кожної пари інструмента з REPRODUCIBLE_TOOLS ([C_CTX_03_04](./context_editor.mechanisms.concept.md#C_CTX_03_04), «Відтворюваність») |
| OPTIMIZE_MARK | `[context-editor: optimize]` | Мітка оптимізації: діє лише як останній непорожній рядок фінального тексту ходу, що після обрізання пробільних символів дорівнює їй дослівно, з урахуванням регістру ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30), [SP_CTX_DEC_12](./context_editor.sp.md#SP_CTX_DEC_12)); процитована посеред тексту не діє |
| MESSAGES_ROW | `Messages` | Назва рядка розбивки контексту (`kind` `used`) з розміром рядків розмови без незмінної частини (навичка plugin-hooks, пункт 37). Хост радить розгалужуватись за `kind`, а не за назвою; власного `kind` цей рядок не має, тож пошук — за назвою, а без рядка — запасна міра ([SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)) |
| MAX_STAGE_NAME | 80 | Найбільша довжина назви етапу після обрізання пробілів, символи |
| MAX_NOTES / MAX_NOTE | 200 / 1000 | Найбільше нотаток у реєстрі / найбільша довжина тексту нотатки, символи ([SP_CTX_01_21](#SP_CTX_01_21)) |
| NOTE_PREFIX / MAX_REMIND | `n` / 1000 | Префікс ідентифікатора нотатки / найбільше `remind_in_turns` |
| CALIB_MIN / CALIB_MAX / CALIB_TOKENS | 1.0 / 8.0 / 20 000 | Межі відношення символів на токен / найменший розмір рядків розмови в токенах, за якого калібрування довіряють ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34)) |
| SUGGESTION | `[context-editor: suggestion]` | Префікс рядка м'якого нагадування ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37), фаза 23, [SP_CTX_DEC_23](./context_editor.sp.md#SP_CTX_DEC_23)): окремий рядок після рядка псевдоніма, а не на його місці, з власним префіксом — щоб пропозицію не читали як службову довідку (P22) |
| HINT_CONVERSATION / HINT_WINDOW_SHARE | 150 000 токенів / 0.35 | Поріг каналу розміру ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37)): рядки розмови (MESSAGES_ROW) не менші за `min(HINT_CONVERSATION, HINT_WINDOW_SHARE · window)`. 150 тисяч рядків розмови — контекст ~190–220 тисяч разом з незмінною частиною 40–70 тисяч, тобто початок зони L_q = 200k спайку [ефективності](./context_editor_efficiency.spike.md), де за ціною вже проходять пакети етапів (R̂ ≈ 60+, θ ≈ 0,4); частка вікна тримає поріг нижче автоматичної компактизації у вікні 200k (70 тисяч). До фази 23 — 50 000 без частки вікна: за спайком це 4–5-й запит робочої сесії, коли майже кожен рядок казав би «невигідно» |
| HINT_STEP / HINT_STEP_SHARE | 75 000 токенів / 0.1 | Ріст запиту від минулої пропозиції до наступної за розміром: `min(HINT_STEP, HINT_STEP_SHARE · window)` — середина рекомендованих спайком 50–100 тисяч (20–50 запитів робочої сесії між пропозиціями); у вікні 200k — 20 тисяч. До фази 23 — 50 000 |
| HINT_BATCH / HINT_CANDIDATES | 0.1 / 15 000 токенів | Найменше, що звільняє пакет (сума кандидатів мінус оцінка їхніх підсумків, Summary [SP_CTX_02_38](./context_editor.stages.sp.md#SP_CTX_02_38)): `max(HINT_CANDIDATES, HINT_BATCH · рядки розмови)` — гістерезис «пакет ≥ 10% розмови» спайку ефективності (S4h, S5) прибирає «тремтіння» поодиноких правок; HINT_CANDIDATES — нижня межа для малої розмови (значення розробника з фази 22, «~15k»; до фази 23 міряв суму кандидатів, а не звільнене) |
| HINT_RUN / HINT_NAMES | 5 / 6 | Скільки позначених виводів (виданих псевдонімів) від минулої пропозиції потрібно каналу ходу (до фази 23 — першому запису файлу) / скільки кандидатів рядок називає за псевдонімом |
| HINT_RECHECK / HINT_WAIT | 5 000 токенів / 500 мс | Ріст запиту, після якого перевірка за розміром, що не знайшла пакета, повторюється (обмеження ціни: читання рядків і розбивки) / скільки результат інструмента чи промпт людини найдовше чекає рядка пропозиції |
| CACHE_LOOKBACK | 20 позицій | Скільки позицій назад мітка кешу API шукає попередній запис (серії рахуються в межах відповіді, як їх надсилає хост: усі виклики відповіді — одне повідомлення, їхні результати — наступне): серія суміжних `tool_use` — одна позиція, серія суміжних `tool_result` — теж, thinking, текст і промпт — кожен окремою (довідка API, § «20-block lookback window»; спайк [context_editor_cache](./context_editor_cache.spike.md), Entry 3: відстань 20 — влучання, 26 — промах; навичка plugin-hooks, пункт 55). CacheCost ([SP_CTX_02_38](./context_editor.stages.sp.md#SP_CTX_02_38)) |
| CostRatios / DEFAULT_RATIOS | Opus 5.5 — 40 / 100; Sonnet і Haiku — 20 / 50; Fable і Mythos 5.1 — 80 / 200; Fable і Mythos 5 — 20 / 50; невідома модель — 80 / 200 | Відношення ціни запису кешу з TTL 1h (2× входу) і вихідного токена до ціни читання кешу за родиною моделі `$.session.model()` (рев'ю 54). Джерело — опубліковані ціни (довідка `claude-api`, `shared/models.md`, `shared/prompt-caching.md`: читання 0,05× входу на Opus 5.5, 0,025× на Fable / Mythos 5.1, 0,1× на інших). Від моделі вердикт залежить: на Fable 5.1 точка беззбитковості вдвічі далі, ніж на Opus 5.5, на Sonnet — удвічі ближче. Невідомій моделі — найбільші відношення: вердикт тоді рідше «вигідно», ніколи частіше. Калібрування спайку ефективності за `costUSD` хоста дало для sonnet читання 0,10 $ за мільйон, а опубліковано 0,20 $ (0,1× входу): відкрите питання спайку, мод бере опубліковані ціни |
| APPLY_MARGIN | 10 позицій | Скільки позицій канал розміру додає до глибини, виміряної зараз, оцінюючи варіант з `keep_cache` (без нього застосування переписує всю розмову): застосування — в кінці ходу, і виклики до нього штовхають першу зміну глибше (рев'ю 54); канал ходу вважає правку глибокою завжди (запас ∞) |
| VERDICT_MARGIN | 3 | Запас вердикту: «невигідно поки», коли точка беззбитковості більша за VERDICT_MARGIN · R̂ (копернікова оцінка R̂ має 50% інтервал `[R̂/3, 3R̂]`; спайк ефективності, Entry 4) |
| SUMMARY_REPRO / SUMMARY_OTHER | 5%, не менше 40 токенів / 25%, не менше 150 токенів | Оцінка розміру підсумку кандидата: вказівник для відтворюваного виводу (виклик з REPRODUCIBLE_TOOLS) / обережний підсумок для іншого; не більша за оригінал (спайк ефективності, Entry 1, φ_max) |
| PERSON_TOOLS | `AskUserQuestion` | Інструменти, чий результат — повідомлення людини (відповідь на запитання агента); невідтворювані ([C_CTX_03_04](./context_editor.mechanisms.concept.md#C_CTX_03_04)) |
| MAX_FULL_ROW | 20 000 | Найбільше символів одного рядка в повному перегляді (`context_list` з `index` і `full`) |
| MAX_BLOCK_INDEXES | 20 | Скільки індексів кандидатів однієї причини називає звіт закриття етапу ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)); решта — числом |
| MAX_JOURNAL | 1000 | Найбільше записів журналу ефекту; найстаріші видаляються ([SP_CTX_01_19](#SP_CTX_01_19)) |
| MAX_DELIVERIES / MAX_DELIVERY_TEXT | 200 / 40 000 | Найбільше записів у `deliveries.json` / найбільша довжина тексту однієї доставки, символи: довший текст обрізається з хвостом `… [context-editor: <n> chars cut]` ([SP_CTX_01_22](#SP_CTX_01_22)). Файл, як і черга, не більший за MAX_QUEUE_BYTES; понад межі першими видаляються найстаріші записи. Робоча сесія decd4bc6: 35 доставок, найдовша — 15 253 символи |
| DELIVERY_FRAMES | person: `The user sent a new message while you were working:`; agent: `Another Claude session sent a message while you were working:`; task: `[SYSTEM NOTIFICATION - NOT USER INPUT]` | Перший непорожній рядок після відкривного `<system-reminder…>` у відрендереному тексті доставки; за ним DeliveryKind ([SP_CTX_01_22](#SP_CTX_01_22)). Тексти хоста 2.1.295–2.1.296 з транскрипту decd4bc6; інший рядок — клас `other` |
| SKILL | `context-stages` | Тека навички мода `skills/context-stages/SKILL.md`; агент бачить її в переліку як `context-editor:context-stages` (навичка plugin-hooks, пункт 39; [SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) |
| INTRO_TEXT | `context-editor: you can manage your own context. At the start of a logical stage of the task call context_tag with {"tags":[{"op":"open","stage":"<name>"}]}; when the stage is done, {"tags":[{"op":"close"}]} returns its rows, size, cleanup candidates and advice, and you compress what is processed there with ONE context_edit (originals stay readable with Read; the person's messages, rules and skills in use usually stay verbatim). If you end your turn and want the block optimized, make [context-editor: optimize] the last line of your final answer: an optimization turn follows. context_list with "count":0 shows context telemetry. A [context-editor: suggestion] line may propose compressing earlier outputs, with gain, cache cost and a verdict; it only informs: decide by the logical state of the work. When edits apply, your own context_* calls are removed from the conversation; tags and notes stay (see context_list). Guide: skill context-editor:context-stages.` | Інструкція на початку сесії, прихований контекст першого промпту ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27), [SP_CTX_DEC_11](./context_editor.sp.md#SP_CTX_DEC_11)); 968 символів, близько 242 токенів за оцінкою символи/4. Речення про власні виклики `context_*` додає фаза 15 (пропозиція P13); речення про м'яке нагадування замість «Nothing reminds you by size» — фаза 22 ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37)); фаза 23 — рядок `[context-editor: suggestion]` з виграшем, ціною кешу і вердиктом ([SP_CTX_DEC_23](./context_editor.sp.md#SP_CTX_DEC_23)) ; речення про власні виклики — як до фази 23: заморожений префікс, що лишає частину з них, тепер вибір агента (`keep_cache`), і про нього каже опис поля ([SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22)) |
| STAGE_ADVICE | `Review the block as a whole and compress, in ONE context_edit, what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media already seen (by a description if the task allows). Write a stage record: goal; decisions with the reason, the person's verbatim words behind them and why other options were rejected; verified facts with sources (paths, lines, versions); changed artifacts; open questions. The person's messages, including answers to your questions (AskUserQuestion), are not reproducible: keep them verbatim unless you drop them deliberately. Pairs from Read, Grep and Glob are reproducible: they can shrink to a pointer (what, where, what was found; re-read if needed); others need a careful summary. Usually keep verbatim the person's messages, rules and skills still in force, and conclusions you need next. Originals stay readable with Read. If nothing needs compressing, queue nothing.` | Порада закриття етапу і ходу оптимізації ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29); [C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04), D; запис етапу — пропозиції P5 і P11, відтворюваність — P2 і P12, [C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21)). Текст фази 14 називає відтворювані інструменти без позначки `~`, якої перелік фази 14 ще не показує (Verify фази 14, D3); фаза 15 разом з REPRO_FLAG повертає в цей текст вказівку на `~` (`Reproducible pairs (~: Read, Grep, Glob) can shrink …`) |
| ALIAS_PREFIX / MAX_ALIASES | `c` / 2000 | Префікс псевдоніма виклику / найбільше псевдонімів у реєстрі |
| LAST_TEXTS | рядок результату: `"last" = <CallLabel>`; відмови: LAST_NONE `"last" names no call: no finished call of yours before this one (context_* calls do not count)`, LAST_PENDING `"last" is <CallLabel>, which has no result yet; use "last" once its result is in, or name another target`, LAST_ORPHAN `"last" is <CallLabel>, a call of an earlier turn that never got a result, so it cannot be a target; name the call you mean by its "tool_use_id" or alias` | Тексти ResolveLast ([SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17), фаза 21, [SP_CTX_DEC_20](./context_editor.sp.md#SP_CTX_DEC_20); LAST_ORPHAN — рев'ю 50). CallLabel — той самий запис виклику, що в переліку, одна функція `callLabel` в `hooks/edits.ts`: `<tool>` (у переліку — з REPRO_FLAG), ` id=<tool_use_id>`, псевдонім ` (cN)`, якщо є, і `input="<JSON.stringify(input) в один рядок, до 70 символів>"` — внутрішні лапки JSON не екрануються ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)) |
| FLUSH_DELAY | 300 мс | Пауза між завершенням ходу і запуском Flush: команди компактизації, промпту продовження або промпту ходу оптимізації |
| HEAD_ROWS | 8 | Скільки перших рядків компактизації запам'ятовує Boundary |
| HOST_ENV | `CONTEXT_EDITOR_HOST` | Змінна середовища процесу хоста з випадковим токеном для `hostId` ([SP_CTX_01_14](#SP_CTX_01_14)) |
| ROW_WINDOW | 4096 | Найбільше рядків, які віддає читання розмови, і найбільше повідомлень API-подання; рядки події компактизації (`e.messages`) цієї межі не мають — це всі рядки після останньої межі (навичка plugin-hooks, пункт 49) |
| NO_MEDIA_NOW | `no media found in that row now` | Причина відмови `describe` при застосуванні, коли медіа рядка цим застосуванням не знайдено (PromptMatch дав «немає»); знайдене, але не заархівоване медіа відхиляється з `media could not be archived` ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) |
| DESCRIBE_DROPS | `describe: attachments the host added to that prompt (file contents from @path, reminders) are dropped; re-read files if needed.` | Рядок результату `context_edit` з прийнятим `describe` і звіту застосування з `describe` ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) |
| PROMPT_DECORATIONS | `<system-reminder`, `<local-command-caveat>`, `[Image: source: ` | Початки текстових блоків, які хост додає до API-повідомлення промпту і яких немає в рядках (вкладення, застереження команди, isMeta-нотатка збереженого зображення); рядок, що так починається, — вставлений модом (доставка, [SP_CTX_02_36](./context_editor.stages.sp.md#SP_CTX_02_36)). Перший — без `>` (фаза 20): звіт субагента хост рендерить як `<system-reminder id="…">` (транскрипт decd4bc6), і рядок такої доставки інакше починав би хід людини в PromptMatch. PromptMatch їх пропускає ([SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10); навичка plugin-hooks, пункт 47) |
| SUMMARY_OPENER | `This session is being continued from a previous conversation` | Початок тексту підсумку вбудованої компактизації в API-поданні і в транскрипті (спайк context_editor_handoff_long, Entry 2) |
| TRANSCRIPT_LINE | `read the full transcript at:` | Початок рядка в підсумку вбудованої компактизації, що вказує на файл старої сесії; засів прибирає такі рядки ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) |
| MEDIA_DATA | 256 | Найкоротший рядок base64, який архів вважає даними медіа |
| MAX_DESCRIPTION | 2048 | Найбільша довжина опису інструмента, яку хост передає моделі |
| MAX_DOCUMENT | 60 000 | Найбільша довжина документа передачі, символи |
| HANDOFF_DELAY | 1 с | Пауза між кінцем ходу (або командою людини) і початком RunHandoff |
| SEED_ROOM | 16 | Скільки рядків вікна читання нової сесії лишається для рядків `/clear` і команди компактизації; засів не довший за ROW_WINDOW − SEED_ROOM ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) |
| SEED_WAIT / SEED_POLL | 2000 мс / 100 мс | Скільки AwaitSeeded чекає появи засіяних рядків у читанні розмови / інтервал опитування ([SP_CTX_02_24](./context_editor.handoff.sp.md#SP_CTX_02_24); Verify фази 10, F2) |
| SEED_PROBE | 80 | Скільки перших символів тексту першого засіяного рядка шукає CheckSeeded ([SP_CTX_02_24](./context_editor.handoff.sp.md#SP_CTX_02_24)) |
| HANDOFF_STALE | 120 с | Вік запиту `running`, після якого він вважається покинутим |
| HANDOFF_PROMPT | `Write a handoff document for a fresh session that continues this work: the person's task and constraints verbatim, decisions in force, facts, numbers, paths and sources still needed, open questions and the next step. Do not call any tools: answer with the document text only. Plain text, no preamble.` | Запит до моделі, коли документа немає. Окремий запит бачить інструменти сесії і може їх викликати (кожен виклик відхиляється), а відповідь тоді засмічується (Verify фази 10, 2026-10-09, F4); тому промпт прямо забороняє виклики |

### 01_13. AliasRegistry  {#SP_CTX_01_13}

Файл `<storage>/aliases.json`. Пише лише мод, на власному послідовному ланцюжку.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| next | int | yes | 1 | ≥ 1 | Номер наступного псевдоніма |
| last | — | — | — | — | Вилучено (фаза 21, [SP_CTX_DEC_20](./context_editor.sp.md#SP_CTX_DEC_20)): до фази 21 — останній виданий псевдонім, ціль `ref: "last"`. Файл зі старим полем читається, поле ігнорується і при наступному записі зникає |
| map | map<string, string> | yes | `{}` | ≤ MAX_ALIASES записів; ключ `c<число>`, значення — `tool_use_id` | Псевдонім → виклик |

Стани читання — як у Queue; `unreadable` (зокрема ключ не `c<число>`, число ключа ≥ `next`, порожнє значення, більше MAX_ALIASES записів) не трактується як порожній реєстр: позначок немає, жоден `ref` виду `c<число>` не розв'язується; `last` реєстру не читає і розв'язується й тоді ([SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17)). Коли записів стало б більше за MAX_ALIASES, найстаріші (з найменшим числом) видаляються. До фази 21 `last` брався з цього реєстру — останній *позначений* виклик; позначку отримують лише виклики від BIG_ROW і SEARCH_TOOLS ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)), а реєстр живе в сховищі сесії (переживає `--resume` і переноситься передачею), тож після малого виклику `last` мовчки вказував на старіший, навіть з іншого процесу (живий прогін фази 20, s5).

### 01_14. Boundary  {#SP_CTX_01_14}

Файл `<storage>/boundary.json`: початок поточної розмови після останньої компактизації основної розмови. Пише лише мод ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| head | list<string> | yes | — | 1..HEAD_ROWS елементів | `fingerprint` перших рядків розмови, яку повернула компактизація |
| count | int | yes | — | ≥ len(head) | Скільки рядків повернула компактизація |
| host | string? | no | — | `hostId` на момент запису | Ідентичність процесу хоста, у якому межу записано; відсутня, коли `hostId` ще не прочитано або не вдалося прочитати |

Стани читання: файл відсутній або `unreadable` — межі немає, поточна розмова — увесь транскрипт. Поле `host`, що не є рядком, ігнорується: межа читається, але вважається записаною без `host`. Якій межі мод довіряє — [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18), `Trusted`, і [SP_CTX_DEC_10](./context_editor.sp.md#SP_CTX_DEC_10).

Ідентичність процесу хоста (`hostId: string?`, пам'ять модуля) = `"<token>:<ppid>"`:
- `token` — значення змінної середовища HOST_ENV процесу хоста. Якщо змінної немає, модуль один раз ставить її `$.env.set` випадковим рядком (≥ 16 символів `[0-9a-z]`). Змінна живе в процесі хоста: переживає гаряче перезавантаження модуля, а новий процес (перезапуск, `--resume`) її не має (навичка plugin-hooks, пункт 32).
- `ppid` — вивід команди хоста `sh -c 'echo $PPID'`, тобто pid процесу `claude`. Дочірні процеси успадковують змінну середовища, тож прив'язка до pid відрізняє процес хоста, запущений з-під іншого.
- `ParseHostId(token, stdout)` — чиста функція: `stdout` після обрізання пробільних символів складається лише з десяткових цифр і `token` непорожній → `token + ":" + stdout`; інакше — відсутній.
- Читання — одна обіцянка на екземпляр модуля (один виклик `$.env` і одна команда `echo`), яку модуль запускає в `session.start` або в першому PrepareStorage — що раніше — і запам'ятовує; під час завантаження модуля `$` ще немає.
- Читачі поза компактизацією — CurrentRows, `Key()` і зняття `host` при перемиканні сесії в PrepareStorage — **чекають** обіцянку: вони працюють у шляхах інструментів, промптів і перемикання сесії, де бюджету ~1 с немає. Для них `hostId` відсутній лише тоді, коли читання не вдалося.
- Обробники компактизації (HandleCompaction, HandleSeed, спостерігач межі [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) обіцянки не чекають і процесів не запускають: виконано — значення, ще ні або не вдалося — `hostId` відсутній, і RecordBoundary пише межу без `host`. Якщо їхній PrepareStorage — перший, він лише запускає обіцянку, не чекаючи її.

### 01_15. HandoffRequest  {#SP_CTX_01_15}

Запит перенести розмову в нову сесію ([C_CTX_03_06](./context_editor.mechanisms.concept.md#C_CTX_03_06)). Живе в Queue.

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
- RunHandoff не лишає запит у стані `running`, коли повертається або падає: кожен вихід — HandedOff, Fail, FailAfterClear або Defer ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), хіба що не вдався сам запис старої черги цим кроком. Після засіву Seed перехоплює кожен збій на місці (обробник винятку RunHandoff його не бачить), а спливне повідомлення називає крок, що не вдався; коли не вдався HandedOff, воно каже, що стара сесія досі тримає запит `running`. Тож `running` без `handoffInFlight` буває лише тоді, коли процес перервано, модуль вивантажено посеред передачі або не вдався запис старої черги; через HANDOFF_STALE такий запит знову належний.

### 01_16. TranscriptRecord (вилучено)  {#SP_CTX_01_16}

Вилучено 2026-10-09: передача більше не пише файл сесії хоста і не перемикає процес командою відновлення, якої немає в неінтерактивному хості ([C_CTX_DEC_11](./context_editor.concept.md#C_CTX_DEC_11), схема S). Вміст нової сесії описує [SP_CTX_01_17](#SP_CTX_01_17).

### 01_17. HandoffSeed  {#SP_CTX_01_17}

Засів нової сесії способом `transcript`: рядки, які обробник компактизації нової сесії поверне замість порожньої розмови ([C_CTX_03_06](./context_editor.mechanisms.concept.md#C_CTX_03_06)). Живе в пам'яті модуля від збирання ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) до кінця RunHandoff ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)); у пам'яті модуля одночасно не більше одного засіву. Рядки засіву лежать і файлом — для повідомлення про збій і для людини.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| old | string | yes | — | непорожній | Ідентифікатор старої сесії |
| id | int | yes | — | мс від епохи | Час збирання; ім'я файлів засіву в сховищі старої сесії і `reportId` звіту нової |
| rows | list<Row> | yes | — | 1..ROW_WINDOW − SEED_ROOM рядків; жоден не має `handle`; проходить [SP_CTX_02_23](./context_editor.handoff.sp.md#SP_CTX_02_23) | Засіяні рядки |
| file | string | yes | — | `<old storage>/<id>/seed.json` | Файл з `rows` (JSON-список Row), доступний лише власникові; пишеться командою хоста, тож межа 4 MiB файлового API хоста його не обмежує |
| archive | string | yes | — | `<old storage>/<id>.json` або `""` | Архів оригіналів змінених рядків; `""`, коли жодна правка не застосувалась |
| report | ApplyReport | yes | — | [SP_CTX_01_05](#SP_CTX_01_05) | Звіт застосування правок черги до засіву |
| visible | list<Row> | yes | — | рядки з `handle` старої сесії; лише в пам'яті, у файл не пишуться | Рядки, до яких BuildSeed застосував правки (вхід ApplyEdits) — «до» для RebindTags у кроці реєстрів |
| edits | list<QueuedEdit> | yes | `[]` | ≤ MAX_QUEUE_EDITS | Пакет, який узяв BuildSeed, до перевірки `pin` — «пакет» для RebindTags; застосовані — ті, чий опис є в `report.applied` |
| fromSummary | bool | yes | false | — | Перший рядок засіву — підсумок попередньої компактизації: голова з API-подання ([C_CTX_DEC_12](./context_editor.concept.md#C_CTX_DEC_12), C) або перший рядок CurrentRows, що вже починався з SUMMARY_OPENER (після `--resume` сесії з вбудованою `/compact` читання починається з рядка-підсумку; Verify фази 10, 2026-10-09, F5) |
| unmatchedPromptMedia | int | yes | 0 | ≥ 0 | Медіа в промптах людини, яке не перенеслось ([SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10)) |
| carried | list<string> | yes | `[]` | `tool_use_id` результатів засіву | Результати, до тексту яких BuildSeed дописав CarryNote: їхні рядки «змінено засівом», хоч відбиток рядка той самий ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)) |
| ratio | number? | no | — | CALIB_MIN..CALIB_MAX | `TagRegistry.charsPerToken` старої сесії на момент збирання: оцінка звіту засіву ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34)) |
| new | string? | no | — | ставить RunHandoff після `/clear` | Ідентифікатор сесії, яку створив `/clear`; HandleSeed засіває лише її |
| taken | bool | yes | false | — | Обробник засіву повернув `rows` хосту ([SP_CTX_02_26](./context_editor.handoff.sp.md#SP_CTX_02_26)) |

Invariants:
- Кожен `tool_use_id` у `rows` — ідентифікатор виклику зі старої сесії: незмінена пара зберігає свій, змінена — FreshId ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)). Тому теги й псевдоніми незмінених пар, скопійовані в сховище нової сесії, розв'язуються на тих самих парах, а теги й псевдоніми змінених пар RunHandoff видаляє за правилами RebindTags ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)); це очікування перевіряє живий сценарій «Передача засівом» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)).
- Медіа в `rows` немає: рядок без `handle` хост будує лише з тексту і блоків інструментів ([C_CTX_DEC_14](./context_editor.concept.md#C_CTX_DEC_14)); медіа незмінених пар лежить файлами, а текст результату називає їх.

### 01_18. Stage, ClosedBlock and RowMark  {#SP_CTX_01_18}

Етап — логічний блок рядків, який агент позначає сам ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02), [C_CTX_DEC_16](./context_editor.concept.md#C_CTX_DEC_16)). Живе в TagRegistry, поза повідомленнями. Етапи пласкі: відкритий не більше одного.

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
| name | string? | no | — | як `Stage.name` | Назва закритого етапу; відсутня — блок без етапу, закритий міткою оптимізації ([SP_CTX_DEC_14](./context_editor.sp.md#SP_CTX_DEC_14)) |
| after | RowMark? | yes | — | — | Початок блоку, як у Stage |
| end | RowMark? | yes | — | `null` — блок порожній (перед ним немає жодного рядка з ідентифікатором чи текстом) | Останній рядок блоку |
| turn | int | yes | — | ≥ 0 | `TagRegistry.turn` у момент закриття; `turn = TagRegistry.turn` на кінці ходу означає «закрито в цьому ході» ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)) |

Функції над поточною розмовою `rows`:

    Distinctive(row) = row has a call, a result or a non-empty text            # рядок лише з thinking має відбиток "assistant||", який не розрізняє рядків
    MarkBefore(rows, i) = { anchor: fingerprint(rows[k]), hint: k } for the largest k < i with Distinctive(rows[k]); none → null
    MarkIndex(rows, m) = m null → -1; Locate(rows, m.anchor, m.hint) found → that index; else → lost   # Locate — SP_CTX_02_04
    StartOf(rows, after) = MarkIndex(rows, after) + 1, where lost counts as -1 (the block starts at the head)

Межа, рядок якої вже не знаходиться (`lost`: вбудована компактизація хоста, межа вийшла за вікно ROW_WINDOW), діє як голова для `after`; загублений `end` — кінець блоку невідомий, і його ніколи не показують як порожній блок (`null`). Перегляд, телеметрія і звіт закриття про це кажуть ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01), [SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28), [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)). context_tag і DetectOptimize, які читають поточну розмову, записують `null` на місце загубленого `stage.after` і `lastClosed.after` (для них `null` і `lost` означають те саме — голову); загублений `lastClosed.end` лишається як є, щоб не стати «порожнім блоком», а як `after` наступного блоку без етапу він діє як голова. Застосування правок і засів переносять межу за правилами [SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14).

Invariants:
- Відкриття етапу при відкритому етапі спершу закриває поточний ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)); реєстр ніколи не має двох відкритих.
- `lastClosed` змінюють лише закриття етапу (інструментом або міткою) і мітка без відкритого етапу; RebindTags лише переносить його межі, а context_tag і DetectOptimize лише заміняють загублений `after` на `null`.

### 01_19. Journal  {#SP_CTX_01_19}

Файл `<storage>/journal.json`: журнал ефекту — що стиснуло кожне застосування і які вже стиснуті відтворювані виводи чи архіви агент читав знову ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02), пропозиція P9). Скільки звільнило застосування, журнал не рахує: це вимірює телеметрія (`lastApply`, рядок `Last apply`, [SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)), а оцінка за символами розходилася з виміром на 46–54 % ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34); рішення розробника на design sign-off фази 15). Пише лише мод, на власному послідовному ланцюжку.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| entries | list<JournalEntry> | yes | `[]` | ≤ MAX_JOURNAL; серіалізований файл ≤ MAX_QUEUE_BYTES — коли запис перевищив би будь-яку межу, найстаріші записи видаляються, доки не вміститься | Записи від найстарішого |

JournalEntry — варіант за полем `kind`:
| kind | Поля | Значення |
|------|------|----------|
| `apply` | `at: int` (мс від епохи, `reportId` застосування), `edits: int` (≥ 1, застосовані правки), `archive: string` (шлях архіву або `""`), `compressed: list<string>` (≤ MAX_QUEUE_EDITS, без повторів) | Застосування пакета компактизацією ([SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07)); `compressed` — `input.file_path` викликів `Read` у парах, які застосовані правки стиснули, прибрали або згорнули |
| `changed` | `at: int`, `path: string` | Агент змінив інструментом з WRITE_TOOLS файл, названий у `compressed` якогось запису `apply` ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)); пізніше читання цього шляху — не повторне читання стиснутого, а читання нового вмісту |
| `reread` | `at: int`, `path: string`, `tool_use_id: string`, `archive: bool` | Агент знову прочитав `Read` шлях, названий у `compressed` запису `apply`, після якого не було запису `changed` з тим самим шляхом (`archive = false`), або файл архіву чи медіа застосування — шлях `archive` або шлях усередині `<storage>/<at>/` (`archive = true`) ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)) |

Стани читання — як у Queue (`missing`, `ok`, `unreadable`). Журнал `unreadable` не перезаписується: записи пропускаються, телеметрія каже «journal unreadable» з причиною; щоб відновити журнал, людина видаляє файл. Збій запису журналу не впливає ні на застосування, ні на результат інструменту.

### 01_20. Telemetry  {#SP_CTX_01_20}

Телеметрія контексту на запит ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02), «Телеметрія на запит»); живе лише під час побудови тексту, у файли не потрапляє. Обчислює [SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28).

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
| reviews | map<reason \| `none`, list<int>> | yes | `{}` | ключі — причини 01_09 і `none` для тегів без причини, записаних до фази 15 (за причинами — з фази 15; до неї — один список); індекси — перші рядки цілей | Активні теги `review`, ціль яких є в розмові, за причиною, з рядками |
| ratio | number? | no | — | CALIB_MIN..CALIB_MAX | Відношення символів на токен, яким пораховано оцінки цієї телеметрії ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34)); відсутнє — `approx.` |
| disposable | int | yes | 0 | ≥ 0 | Теги `disposable`, ціль яких є в розмові |
| journal | `{ applications: int, rereads: int, archiveRereads: int }` \| `{ unreadable: string }` | yes | — | `archiveRereads` ≤ `rereads` | Підсумок журналу ефекту: записи `apply`, записи `reread` і з них `archive = true`; файлу немає — усі нулі. Рядок тексту — лише коли журнал `unreadable` або `applications + rereads > 0` |
| state | `{ row: int }` \| `none` \| `lost` | yes | — | — | Слот стану: рядок тегу `state`, тегу немає, або рядка тегу вже немає в розмові. Рядок тексту — лише для `{ row }` і `lost` |
| measuredFreed | int? | no | — | — | Виміряна зміна запиту від останнього застосування: `lastApply.tokensBefore − context.tokens` після першої відповіді моделі після нього; один раз ([SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)) |
| notes | `{ count: int, reminders: int }` | yes | — | `reminders` — нотатки з `remindAt`, порахованi після доставки нагадувань цього виклику | Нотатки реєстру і скільки з них чекають нагадування |
| cache | `{ start: int, chars: int }`? | no | — | `start` = LookbackStart(rows), 0..len(rows); `chars` — сума `size` рядків від `start` до кінця | Звідки правка лишає кеш промпту до себе ([SP_CTX_02_38](./context_editor.stages.sp.md#SP_CTX_02_38)): застосування, чия найраніша правка стоїть від `start`, переписує лише рядки від неї, раніша — усю розмову; відсутнє без рядків (фаза 23) |

### 01_21. Note  {#SP_CTX_01_21}

Службова нотатка агента до рядка, діапазону рядків або пари виклику ([C_CTX_03_07](./context_editor.mechanisms.concept.md#C_CTX_03_07), [C_CTX_DEC_20](./context_editor.concept.md#C_CTX_DEC_20)). Живе в TagRegistry, поза повідомленнями; нічого не змінює і не захищає.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | string | yes | — | NOTE_PREFIX + число, унікальний у реєстрі | Ідентифікатор (`n3`); не використовується повторно в межах сесії |
| target | як у Tag ([SP_CTX_01_09](#SP_CTX_01_09)): `{ tool_use_id }` \| `{ anchor, hint }` \| `{ anchor, hint, toAnchor, toHint }` | yes | — | діапазон: `hint < toHint`; правил пар немає — нотатка нічого не змінює | Ціль |
| text | string | yes | — | непорожній після обрізання, ≤ MAX_NOTE | Текст нотатки |
| createdTurn | int | yes | — | ≥ 0 | `TagRegistry.turn` у момент запису |
| remindAt | int? | no | — | > `createdTurn` | `TagRegistry.turn`, починаючи з якого нагадування належне ([SP_CTX_02_33](./context_editor.stages.sp.md#SP_CTX_02_33)); знімається після доставки |

Invariants:
- На одній цілі може бути кілька нотаток; нотатки і теги незалежні: тег на тій самій цілі не заміняє нотатку і навпаки.
- Нотатка на рядку, який правка замінила, переходить на останній створений правкою рядок; на рядку, прибраному без заміни, — видаляється ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)).

### 01_22. QueuedDelivery  {#SP_CTX_01_22}

Доставка хоста посеред ходу — вкладення `queued_command`: повідомлення людини, набране під час ходу, звіт субагента, сповіщення фонової задачі. Хост пише її записом-вкладенням транскрипту, що висить за рядком з `tool_result`, і показує моделі системним ходом; рядком розмови вона не є — її немає ні в `$.session.messages()`, ні в `e.messages` компактизації, ні в API-поданні. Рядок, повернений обробником компактизації з `handle`, хост копіює разом із вкладеннями за ним; перезібраний без `handle` — без них, і модель потім відрікається від власних слів про зниклий текст (спайк [context_editor_attachments](./context_editor_attachments.spike.md); навичка plugin-hooks, пункти 43–44). Мод записує текст доставки в мить появи ([SP_CTX_02_35](./context_editor.stages.sp.md#SP_CTX_02_35)) і вставляє його рядком, коли застосування чи засів повертає рядок, за яким вона висить, без `handle` ([SP_CTX_02_36](./context_editor.stages.sp.md#SP_CTX_02_36)). Фаза 20.

Файл `<storage>/deliveries.json` — `{ items: list<QueuedDelivery> }` у порядку запису, ≤ MAX_DELIVERIES записів і ≤ MAX_QUEUE_BYTES. Стани читання — як у черги: `missing` — порожньо, `unreadable` — файл не JSON, не об'єкт або запис не відповідає таблиці.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| uuid | string | yes | — | — | `uuid` події `session.append` доставки; для діагностики |
| anchor | list<string> | yes | — | 1+ ідентифікаторів | `tool_use_id` кожного результату рядка-якоря — останнього рядка основної розмови з дверима `tool-result`, що пройшов `session.append` перед доставкою |
| kind | `person` \| `agent` \| `task` \| `other` | yes | — | — | DeliveryKind(text), нижче |
| origin | string | yes | — | — | `origin.kind` події як є (`composer`, `unclassified`, `task-notification`, …); класу не визначає: людина в stream-json має `unclassified`, у терміналі — `composer` |
| text | string | yes | — | непорожній, ≤ MAX_DELIVERY_TEXT разом із хвостом обрізання (розбір файлу допускає ще 100 символів хвоста) | відрендерений текст — текстові блоки `content` події, з'єднані `\n`, з рамкою `<system-reminder…>` як є |
| cut | int | yes | 0 | ≥ 0 | скільки символів обрізано за MAX_DELIVERY_TEXT |
| media | int | yes | 0 | ≥ 0 | скільки нетекстових блоків мав `content`; вони не переносяться: рядок без `handle` медіа не несе (навичка plugin-hooks, пункт 6) |
| at | int | yes | — | мс від епохи | час запису |

DeliveryKind(text): коли `text` без пробілів зліва починається з `<system-reminder`, береться перший непорожній рядок після рядка відкривного тегу; він дорівнює рядку DELIVERY_FRAMES — клас `person`, `agent` чи `task`; інакше (і без рамки) — `other`. Клас визначає текст, а не `origin`: походження розходяться між хостами, а звіти субагентів у VS Code мають у транскрипті `origin.kind: peer` (транскрипт decd4bc6: 3 `human`, 13 `peer`, 19 `task-notification`, усі за рядком з `tool_result`). `person` — повідомлення людини ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), PersonText); `agent` і `task` — невідтворювані звіти, які агент може згорнути, як інші результати ([C_CTX_03_04](./context_editor.mechanisms.concept.md#C_CTX_03_04), «Відтворюваність»).

Invariants:
- Пара (`text`, спільний ідентифікатор в `anchor`) унікальна у файлі: копія доставки, яку stream-json після компактизації знову проводить через `session.append` (за копією рядка-якоря), нового запису не дає.
- Запис живе, доки рядок-якір лишається в розмові з `handle` (вкладення тоді переносить хост). Вставлений рядком, пішовши разом зі згорнутим чи прибраним якорем, або з якорем, якого вже немає в рядках компактизації (вбудована компактизація, межа), запис видаляється при наступному застосуванні мода ([SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07)).
- Файл належить сесії ([SP_CTX_01_07](#SP_CTX_01_07)); `--resume` у новому процесі має той самий `session_id`, тож записи лишаються. Передача файлу не переносить: засів несе доставки рядками ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)). Доставки форка сесії, старішої сесії чи такі, що прийшли до завантаження мода, записів не мають — запасне читання транскрипту (R2 спайку) — у backlog плану ([SP_CTX_DEC_19](./context_editor.sp.md#SP_CTX_DEC_19)).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §01 Data Structures (01_01–01_22) перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.structures.sp.md](./context_editor.structures.sp.md), якорі без змін |
