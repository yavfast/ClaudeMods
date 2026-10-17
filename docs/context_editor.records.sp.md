# Редактор контексту агента — Specification: Data Structures — реєстри, межа, передача, етапи, журнал, телеметрія, доставки, вкладення, можливості

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §01_13–01_26 специфікації [SP_CTX](./context_editor.sp.md): AliasRegistry, Boundary, HandoffRequest, HandoffSeed, Stage, Journal, Telemetry, Note, QueuedDelivery, HostAttachState, ApplyLedger, Capabilities, CapabilityCache. Читати, коли змінюєте файли стану сесії.

## Contents

Розділи цього файлу:

- [01_13. AliasRegistry](#SP_CTX_01_13)
- [01_14. Boundary](#SP_CTX_01_14)
- [01_15. HandoffRequest](#SP_CTX_01_15)
- [01_16. TranscriptRecord (вилучено)](#SP_CTX_01_16)
- [01_17. HandoffSeed](#SP_CTX_01_17)
- [01_18. Stage, ClosedBlock and RowMark](#SP_CTX_01_18)
- [01_19. Journal](#SP_CTX_01_19)
- [01_20. Telemetry](#SP_CTX_01_20)
- [01_21. Note](#SP_CTX_01_21)
- [01_22. QueuedDelivery](#SP_CTX_01_22)
- [01_23. HostAttachState](#SP_CTX_01_23)
- [01_24. ApplyLedger](#SP_CTX_01_24)
- [01_25. Capabilities](#SP_CTX_01_25)
- [01_26. CapabilityCache](#SP_CTX_01_26)

## 01. Data Structures — реєстри і стан сесії

### 01_13. AliasRegistry  {#SP_CTX_01_13}

Файл `<storage>/aliases.json`. Пише лише мод, на власному послідовному ланцюжку `aliases` (ранг 3: усередині `queue` і `tags`, ніколи навпаки, [SP_CTX_02](./context_editor.sp.md#SP_CTX_02)), через порт сховища ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| next | int | yes | 1 | ≥ 1 | Номер наступного псевдоніма |
| last | — | — | — | — | Вилучено (фаза 21, [SP_CTX_DEC_20](./context_editor.decisions-01.sp.md#SP_CTX_DEC_20)): до фази 21 — останній виданий псевдонім, ціль `ref: "last"`. Файл зі старим полем читається, поле ігнорується і при наступному записі зникає |
| map | map<string, string> | yes | `{}` | ≤ MAX_ALIASES записів; ключ `c<число>`, значення — `tool_use_id` | Псевдонім → виклик |

Стани читання — як у Queue; `unreadable` (зокрема ключ не `c<число>`, число ключа ≥ `next`, порожнє значення, більше MAX_ALIASES записів) не трактується як порожній реєстр: позначок немає, жоден `ref` виду `c<число>` не розв'язується; `last` реєстру не читає і розв'язується й тоді ([SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17)). Новий псевдонім витісняє той, що на MAX_ALIASES номерів старший (`c<n − MAX_ALIASES>` для нового `c<n>`, без сортування; аудит PL_AUD_CTX, фаза 11): реєстр тримає лише псевдоніми з останніх MAX_ALIASES номерів, навіть коли частину з них прибрало застосування. Файл, що досі тримає більше за MAX_ALIASES (старіші номери, залишені до фази 11 поза прибраними), при першому переповненні втрачає всі номери нижче вікна. До фази 11 видалялися найстаріші (з найменшим числом), лише коли записів ставало більше за MAX_ALIASES. До фази 21 `last` брався з цього реєстру — останній *позначений* виклик; позначку отримують лише виклики від BIG_ROW і SEARCH_TOOLS ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)), а реєстр живе в сховищі сесії (переживає `--resume` і переноситься передачею), тож після малого виклику `last` мовчки вказував на старіший, навіть з іншого процесу (живий прогін фази 20, s5).

### 01_14. Boundary  {#SP_CTX_01_14}

Файл `<storage>/boundary.json`: початок поточної розмови після останньої компактизації основної розмови. Пише лише мод ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| head | list<string> | yes | — | 1..HEAD_ROWS елементів | `fingerprint` перших рядків розмови, яку повернула компактизація |
| count | int | yes | — | ≥ len(head) | Скільки рядків повернула компактизація |
| host | string? | no | — | `hostId` на момент запису | Ідентичність процесу хоста, у якому межу записано; відсутня, коли `hostId` ще не прочитано або не вдалося прочитати |

Стани читання: файл відсутній або `unreadable` — межі немає, поточна розмова — увесь транскрипт. Поле `host`, що не є рядком, ігнорується: межа читається, але вважається записаною без `host`. Якій межі мод довіряє — [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18), `Trusted`, і [SP_CTX_DEC_10](./context_editor.decisions-01.sp.md#SP_CTX_DEC_10).

Ідентичність процесу хоста (`hostId: string?`, пам'ять модуля) = `"<token>:<ppid>"`:
- `token` — значення змінної середовища HOST_ENV процесу хоста. Якщо змінної немає, модуль один раз ставить її `$.env.set` випадковим рядком (≥ 16 символів `[0-9a-z]`). Змінна живе в процесі хоста: переживає гаряче перезавантаження модуля, а новий процес (перезапуск, `--resume`) її не має (навичка plugin-hooks, пункт 32).
- `ppid` — вивід команди хоста `sh -c 'echo $PPID'`, тобто pid процесу `claude`. Дочірні процеси успадковують змінну середовища, тож прив'язка до pid відрізняє процес хоста, запущений з-під іншого.
- `ParseHostId(token, stdout)` — чиста функція: `stdout` після обрізання пробільних символів складається лише з десяткових цифр і `token` непорожній → `token + ":" + stdout`; інакше — відсутній.
- Читання — одне читання в польоті на екземпляр модуля (один виклик `$.env` і одна команда `echo`), яке модуль запускає в `session.start` або в першому PrepareStorage — що раніше; під час завантаження модуля `$` ще немає. Читання, що закінчилося ідентичністю, запам'ятовується на весь час життя екземпляра. Читання, що закінчилося без неї (збій виклику `$.env` чи команди, вивід не число), не запам'ятовується: наступний читач, що чекає, запускає нове, але не більше HOST_ID_READS читань на екземпляр. Читання, яке не закінчується, тримає своє місце: повтору тоді немає, читачі після тайм-ауту бачать `hostId` відсутнім, доки воно не закінчиться. Живий прогін фази 12 аудиту (`.dev_flow/cache/live-test/audit-p12-results.md`) показав, що хост завершує `$.process.run` приблизно через 30 с, тож на практиці читання закінчується (не підтверджено документацією хоста) ([SP_CTX_DEC_24](./context_editor.decisions-21.sp.md#SP_CTX_DEC_24)).
- Читачі поза компактизацією — CurrentRows, `Key()` і зняття `host` при перемиканні сесії в PrepareStorage — **чекають** читання, але не довше HOST_ID_WAIT_MS від його початку: вони працюють у шляхах інструментів, промптів і перемикання сесії, де бюджету ~1 с немає. Для них `hostId` відсутній, коли читання не вдалося або ще йде після HOST_ID_WAIT_MS. Тайм-аут не запам'ятовується: читання триває, і щойно воно дасть ідентичність, її бачать наступні читачі й обробники компактизації (`peek`); читачі, що прийшли після тайм-ауту, поки читання ще йде, не чекають ([SP_CTX_DEC_24](./context_editor.decisions-21.sp.md#SP_CTX_DEC_24)).
- Обробники компактизації (HandleCompaction, HandleSeed, спостерігач межі [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) читання не чекають і, крім першого читання нижче, процесів не запускають: прочитано — значення, ще ні або не вдалося — `hostId` відсутній, і RecordBoundary пише межу без `host`. Якщо їхній PrepareStorage — перший, він лише запускає перше читання екземпляра, не чекаючи його (єдиний процес, який може запустити шлях обробника компактизації); повтору читання обробник не запускає ніколи (`kickHostId`). Обробник, що приєднується до підготовки, яку почав інший шлях і яка чекає читання, підганяє її: крок межі бере `hostId` лише якщо його вже прочитано ([SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15)).

### 01_15. HandoffRequest  {#SP_CTX_01_15}

Запит перенести розмову в нову сесію ([C_CTX_03_06](./context_editor.methods.concept.md#C_CTX_03_06)). Живе в Queue.

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

Вилучено 2026-10-09: передача більше не пише файл сесії хоста і не перемикає процес командою відновлення, якої немає в неінтерактивному хості ([C_CTX_DEC_11](./context_editor.methods.concept.md#C_CTX_DEC_11), схема S). Вміст нової сесії описує [SP_CTX_01_17](#SP_CTX_01_17).

### 01_17. HandoffSeed  {#SP_CTX_01_17}

Засів нової сесії способом `transcript`: рядки, які обробник компактизації нової сесії поверне замість порожньої розмови ([C_CTX_03_06](./context_editor.methods.concept.md#C_CTX_03_06)). Живе в пам'яті модуля від збирання ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) до кінця RunHandoff ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)); у пам'яті модуля одночасно не більше одного засіву. Рядки засіву лежать і файлом — для повідомлення про збій і для людини.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| old | string | yes | — | непорожній | Ідентифікатор старої сесії |
| id | int | yes | — | мс від епохи | Час збирання; ім'я файлів засіву в сховищі старої сесії і `reportId` звіту нової |
| rows | list<Row> | yes | — | 1..ROW_WINDOW − SEED_ROOM рядків; жоден не має `handle`; проходить [SP_CTX_02_23](./context_editor.handoff.sp.md#SP_CTX_02_23) | Засіяні рядки |
| file | string | yes | — | `<old storage>/<id>/seed.json` | Файл з `rows` (JSON-список Row), доступний лише власникові; пишеться командою хоста, тож межа 4 MiB файлового API хоста його не обмежує |
| archive | string | yes | — | `<old storage>/<id>.json` або `""` | Архів оригіналів змінених рядків; `""`, коли жодна правка не застосувалась |
| report | ApplyReport | yes | — | [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) | Звіт застосування правок черги до засіву |
| visible | list<Row> | yes | — | рядки з `handle` старої сесії; лише в пам'яті, у файл не пишуться | Рядки, до яких BuildSeed застосував правки (вхід ApplyEdits) — «до» для RebindTags у кроці реєстрів |
| edits | list<QueuedEdit> | yes | `[]` | ≤ MAX_QUEUE_EDITS | Пакет, який узяв BuildSeed, до перевірки `pin` — «пакет» для RebindTags; застосовані — ті, чий опис є в `report.applied` |
| fromSummary | bool | yes | false | — | Перший рядок засіву — підсумок попередньої компактизації: голова з API-подання ([C_CTX_DEC_12](./context_editor.methods.concept.md#C_CTX_DEC_12), C) або перший рядок CurrentRows, що вже починався з SUMMARY_OPENER (після `--resume` сесії з вбудованою `/compact` читання починається з рядка-підсумку; Verify фази 10, 2026-10-09, F5) |
| unmatchedPromptMedia | int | yes | 0 | ≥ 0 | Медіа в промптах людини, яке не перенеслось ([SP_CTX_02_10](./context_editor.apply.sp.md#SP_CTX_02_10)) |
| carried | list<string> | yes | `[]` | `tool_use_id` результатів засіву | Результати, до тексту яких BuildSeed дописав CarryNote: їхні рядки «змінено засівом», хоч відбиток рядка той самий ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)) |
| ratio | number? | no | — | CALIB_MIN..CALIB_MAX | `TagRegistry.charsPerToken` старої сесії на момент збирання: оцінка звіту засіву ([SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34)) |
| new | string? | no | — | ставить RunHandoff після `/clear` | Ідентифікатор сесії, яку створив `/clear`; HandleSeed засіває лише її |
| taken | bool | yes | false | — | Обробник засіву повернув `rows` хосту ([SP_CTX_02_26](./context_editor.handoff.sp.md#SP_CTX_02_26)) |

Invariants:
- Кожен `tool_use_id` у `rows` — ідентифікатор виклику зі старої сесії: незмінена пара зберігає свій, змінена — FreshId ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)). Тому теги й псевдоніми незмінених пар, скопійовані в сховище нової сесії, розв'язуються на тих самих парах, а теги й псевдоніми змінених пар RunHandoff видаляє за правилами RebindTags ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)); це очікування перевіряє живий сценарій «Передача засівом» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)).
- Медіа в `rows` немає: рядок без `handle` хост будує лише з тексту і блоків інструментів ([C_CTX_DEC_14](./context_editor.methods.concept.md#C_CTX_DEC_14)); медіа незмінених пар лежить файлами, а текст результату називає їх.

### 01_18. Stage, ClosedBlock and RowMark  {#SP_CTX_01_18}

Етап — логічний блок рядків, який агент позначає сам ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), [C_CTX_DEC_16](./context_editor.methods.concept.md#C_CTX_DEC_16)). Живе в TagRegistry, поза повідомленнями. Етапи пласкі: відкритий не більше одного.

RowMark — межа «блок починається після цього рядка» або «блок закінчується цим рядком»; `null` на місці RowMark означає голову розмови (перед рядком 0).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| anchor | string | yes | — | fingerprint ([SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03)), що містить ідентифікатор виклику чи результату або непорожній текст | Відбиток рядка межі |
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
| name | string? | no | — | як `Stage.name` | Назва закритого етапу; відсутня — блок без етапу, закритий міткою оптимізації ([SP_CTX_DEC_14](./context_editor.decisions-01.sp.md#SP_CTX_DEC_14)) |
| after | RowMark? | yes | — | — | Початок блоку, як у Stage |
| end | RowMark? | yes | — | `null` — блок порожній (перед ним немає жодного рядка з ідентифікатором чи текстом) | Останній рядок блоку |
| turn | int | yes | — | ≥ 0 | `TagRegistry.turn` у момент закриття; `turn = TagRegistry.turn` на кінці ходу означає «закрито в цьому ході» ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)) |

Функції над поточною розмовою `rows`:

    Distinctive(row) = row has a call, a result or a non-empty text            # рядок лише з thinking має відбиток "assistant||", який не розрізняє рядків
    MarkBefore(rows, i) = { anchor: fingerprint(rows[k]), hint: k } for the largest k < i with Distinctive(rows[k]); none → null
    MarkIndex(rows, m) = m null → -1; Locate(rows, m.anchor, m.hint) found → that index; else → lost   # Locate — SP_CTX_02_04
    StartOf(rows, after) = MarkIndex(rows, after) + 1, where lost counts as -1 (the block starts at the head)

Межа, рядок якої вже не знаходиться (`lost`: вбудована компактизація хоста, межа вийшла за вікно ROW_WINDOW), діє як голова для `after`; загублений `end` — кінець блоку невідомий, і його ніколи не показують як порожній блок (`null`). Перегляд, телеметрія і звіт закриття про це кажуть ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01), [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28), [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)). context_tag і DetectOptimize, які читають поточну розмову, записують `null` на місце загубленого `stage.after` і `lastClosed.after` (для них `null` і `lost` означають те саме — голову); загублений `lastClosed.end` лишається як є, щоб не стати «порожнім блоком», а як `after` наступного блоку без етапу він діє як голова. Застосування правок і засів переносять межу за правилами [SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14).

Invariants:
- Відкриття етапу при відкритому етапі спершу закриває поточний ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)); реєстр ніколи не має двох відкритих.
- `waiting` є лише при `lastClosed`; закриття чи відкриття етапу інструментом знімає `waiting` до того, як замінить `lastClosed` (звіт блоку, що чекав, — у результаті виклику), а мітка при `waiting` зливає блоки ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)).
- `lastClosed` змінюють лише закриття етапу (інструментом або міткою) і мітка без відкритого етапу; RebindTags лише переносить його межі, а context_tag і DetectOptimize лише заміняють загублений `after` на `null`.

### 01_19. Journal  {#SP_CTX_01_19}

Файл `<storage>/journal.json`: журнал ефекту — що стиснуло кожне застосування і які вже стиснуті відтворювані виводи чи архіви агент читав знову ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), пропозиція P9). Скільки звільнило застосування, журнал не рахує: це вимірює телеметрія (`lastApply`, рядок `Last apply`, [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)), а оцінка за символами розходилася з виміром на 46–54 % ([SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34); рішення розробника на design sign-off фази 15). Пише лише мод, на власному послідовному ланцюжку.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| entries | list<JournalEntry> | yes | `[]` | ≤ MAX_JOURNAL; серіалізований файл ≤ MAX_QUEUE_BYTES — коли запис перевищив би будь-яку межу, найстаріші записи видаляються, доки не вміститься | Записи від найстарішого |

JournalEntry — варіант за полем `kind`:
| kind | Поля | Значення |
|------|------|----------|
| `apply` | `at: int` (мс від епохи, `reportId` застосування), `edits: int` (≥ 1, застосовані правки), `archive: string` (шлях архіву або `""`), `compressed: list<string>` (≤ MAX_QUEUE_EDITS, без повторів) | Застосування пакета компактизацією ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)); `compressed` — `input.file_path` викликів `Read` у парах, які застосовані правки стиснули, прибрали або згорнули |
| `changed` | `at: int`, `path: string` | Агент змінив інструментом з WRITE_TOOLS файл, названий у `compressed` якогось запису `apply` ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)); пізніше читання цього шляху — не повторне читання стиснутого, а читання нового вмісту |
| `reread` | `at: int`, `path: string`, `tool_use_id: string`, `archive: bool` | Агент знову прочитав `Read` шлях, названий у `compressed` запису `apply`, після якого не було запису `changed` з тим самим шляхом (`archive = false`), або файл архіву чи медіа застосування — шлях `archive` або шлях усередині `<storage>/<at>/` (`archive = true`) ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)) |

Стани читання — як у Queue (`missing`, `ok`, `unreadable`). Журнал `unreadable` не перезаписується: записи пропускаються, телеметрія каже «journal unreadable» з причиною; щоб відновити журнал, людина видаляє файл. Збій запису журналу не впливає ні на застосування, ні на результат інструменту.

### 01_20. Telemetry  {#SP_CTX_01_20}

Телеметрія контексту на запит ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), «Телеметрія на запит»); живе лише під час побудови тексту, у файли не потрапляє. Обчислює [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28).

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| measure | `messages` \| `request` \| `unknown` \| `unavailable` | yes | — | — | `messages` — є рядок MESSAGES_ROW розбивки; `request` — розбивки чи рядка немає, показано весь запит; `unknown` — моделі ще не відповідали (свіжа сесія, щойно після компактизації: `tokens` відсутній або розбивка має `apiUsage = null`); `unavailable` — читання розміру впало |
| conversation | int? | no | — | ≥ 0; лише для `messages` | Токени рядків розмови без незмінної частини |
| attached | int? | no | — | > 0; лише для `messages` | Токени рядків розбивки FIXED_IN_MESSAGES: частина `fixed`, чий текст лежить у повідомленнях запиту; Whole = `conversation + attached` ([SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)) |
| fixed | int? | no | — | ≥ 0; лише для `messages` | Незмінна частина: `breakdown.totalTokens − conversation` (системний промпт, схеми інструментів, навички, пам'ять); з `attached` текст показує `fixed − attached` окремо від `attached` ([SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)) |
| request | int? | no | — | ≥ 0; лише для `request` | Розмір останнього запиту разом із незмінною частиною |
| window | int? | no | — | ≥ 1 | Вікно: `breakdown.rawMaxTokens`, а без розбивки — `context.window`; відсутнє лише для `unavailable` |
| autoCompactLeft | int? | no | — | — | `breakdown.autoCompactThreshold − breakdown.totalTokens`, коли поріг є; відсутній — автоматична компактизація вимкнена або розбивки немає |
| autoCompactOff | bool | yes | false | — | Розбивка є, а порогу автоматичної компактизації в ній немає |
| error | string? | no | — | лише для `unavailable` | Текст збою |
| stage | `{ name: string, first: int, chars: int, turnsAgo: int, lost: bool }`? | no | — | `first` = StartOf; `chars` — сума `size` рядків від `first` до кінця | Відкритий етап |
| lastClosed | `{ name: string?, start: int, end: int?, chars: int?, lost: bool, startLost: bool }`? | no | — | `start` = StartOf(rows, lastClosed.after); `end` = MarkIndex(rows, lastClosed.end), відсутній, коли `end` — `null` (порожній блок) або `lost`; `chars` — сума `size` рядків `start..end`; `lost` — рядка кінця вже немає; `startLost` — рядка початку вже немає, блок діє від #0 | Останній закритий блок і його межі |
| reviews | map<reason \| `none`, list<int>> | yes | `{}` | ключі — причини 01_09 і `none` для тегів без причини, записаних до фази 15 (за причинами — з фази 15; до неї — один список); індекси — перші рядки цілей | Активні теги `review`, ціль яких є в розмові, за причиною, з рядками |
| ratio | number? | no | — | CALIB_MIN..CALIB_MAX | Відношення символів на токен, яким пораховано оцінки цієї телеметрії ([SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34)); відсутнє — `approx.` |
| chars | int? | no | — | ≥ 0 | ApiChars API-подання ([SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34)); відсутнє без подання (немає, збій читання, порожнє) і коли воно сягнуло свого вікна ROW_WINDOW |
| disposable | int | yes | 0 | ≥ 0 | Теги `disposable`, ціль яких є в розмові |
| journal | `{ applications: int, rereads: int, archiveRereads: int }` \| `{ unreadable: string }` | yes | — | `archiveRereads` ≤ `rereads` | Підсумок журналу ефекту: записи `apply`, записи `reread` і з них `archive = true`; файлу немає — усі нулі. Рядок тексту — лише коли журнал `unreadable` або `applications + rereads > 0` |
| state | `{ row: int }` \| `none` \| `lost` | yes | — | — | Слот стану: рядок тегу `state`, тегу немає, або рядка тегу вже немає в розмові. Рядок тексту — лише для `{ row }` і `lost` |
| measuredFreed | int? | no | — | — | Виміряна зміна запиту від останнього застосування: `lastApply.tokensBefore − context.tokens` після першої відповіді моделі після нього; один раз ([SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)) |
| notes | `{ count: int, reminders: int }` | yes | — | `reminders` — нотатки з `remindAt`, порахованi після доставки нагадувань цього виклику | Нотатки реєстру і скільки з них чекають нагадування |
| hostAttach | `{ copies: int, chars: int }`? | no | — | ≥ 0 | `HostAttachState.left` сесії ([SP_CTX_01_23](#SP_CTX_01_23)), прочитаний через кеш; рядок тексту `Host attachments: <copies> stale cop(y\|ies) of instruction files and skill listings left out of each request (<Estimate(chars, ratio)>)` — лише коли `copies` > 0, після рядка `Cache` (фаза 24) |
| tagsFull | `{ tags: int, kb: int }`? | no | — | — | RegistryFull реєстру тегів ([SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12) TAG_ROOM): скільки тегів і кілобайтів; рядок TAGS_FULL_LINE — лише коли поле є (фаза 30, [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)) |
| cache | `{ start: int, tokens: int, approx: bool }`? | no | — | `start` = LookbackStart(rows), 0..len(rows); `tokens` = TailTokens(rows, start, ratio або PLAIN_RATIO, Whole) — запит від `start` з вкладеннями ([SP_CTX_02_38](./context_editor.telemetry.sp.md#SP_CTX_02_38)); `approx` — без відношення | Звідки правка лишає кеш промпту до себе ([SP_CTX_02_38](./context_editor.telemetry.sp.md#SP_CTX_02_38)): застосування, чия найраніша правка стоїть від `start`, переписує лише рядки від неї, раніша — усю розмову; відсутнє без рядків (фаза 23) |

### 01_21. Note  {#SP_CTX_01_21}

Службова нотатка агента до рядка, діапазону рядків або пари виклику ([C_CTX_03_07](./context_editor.core.concept.md#C_CTX_03_07), [C_CTX_DEC_20](./context_editor.core.concept.md#C_CTX_DEC_20)). Живе в TagRegistry, поза повідомленнями; нічого не змінює і не захищає.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | string | yes | — | NOTE_PREFIX + число, унікальний у реєстрі | Ідентифікатор (`n3`); не використовується повторно в межах сесії |
| target | як у Tag ([SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)): `{ tool_use_id }` \| `{ anchor, hint }` \| `{ anchor, hint, toAnchor, toHint }` | yes | — | діапазон: `hint < toHint`; правил пар немає — нотатка нічого не змінює | Ціль |
| text | string | yes | — | непорожній після обрізання, ≤ MAX_NOTE | Текст нотатки |
| createdTurn | int | yes | — | ≥ 0 | `TagRegistry.turn` у момент запису |
| remindAt | int? | no | — | > `createdTurn` | `TagRegistry.turn`, починаючи з якого нагадування належне ([SP_CTX_02_33](./context_editor.stages.sp.md#SP_CTX_02_33)); знімається після доставки |

Invariants:
- На одній цілі може бути кілька нотаток; нотатки і теги незалежні: тег на тій самій цілі не заміняє нотатку і навпаки.
- Нотатка на рядку, який правка замінила, переходить на останній створений правкою рядок; на рядку, прибраному без заміни, — видаляється ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)).

### 01_22. QueuedDelivery  {#SP_CTX_01_22}

Доставка хоста посеред ходу — вкладення `queued_command`: повідомлення людини, набране під час ходу, звіт субагента, сповіщення фонової задачі. Хост пише її записом-вкладенням транскрипту, що висить за рядком з `tool_result`, і показує моделі системним ходом; рядком розмови вона не є — її немає ні в `$.session.messages()`, ні в `e.messages` компактизації, ні в API-поданні. Рядок, повернений обробником компактизації з `handle`, хост копіює разом із вкладеннями за ним; перезібраний без `handle` — без них, і модель потім відрікається від власних слів про зниклий текст (спайк [context_editor_attachments](./context_editor_attachments.spike.md); навичка plugin-hooks, пункти 43–44). Мод записує текст доставки в мить появи ([SP_CTX_02_35](./context_editor.deliveries.sp.md#SP_CTX_02_35)) і вставляє його рядком, коли застосування чи засів повертає рядок, за яким вона висить, без `handle` ([SP_CTX_02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36)). Фаза 20.

Файл `<storage>/deliveries.json` — `{ items: list<QueuedDelivery> }` у порядку запису, ≤ MAX_DELIVERIES записів і ≤ MAX_QUEUE_BYTES. Стани читання — як у черги: `missing` — порожньо, `unreadable` — файл не JSON, не об'єкт або запис не відповідає таблиці.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| uuid | string | yes | — | — | `uuid` події `session.append` доставки; для діагностики |
| anchor | list<string> | yes | — | 1+ ідентифікаторів | `tool_use_id` кожного результату рядка-якоря — останнього рядка основної розмови з дверима `tool-result`, що пройшов `session.append` перед доставкою |
| kind | `person` \| `agent` \| `task` \| `other` | yes | — | — | DeliveryKind(text), нижче |
| origin | string | yes | — | — | `origin.kind` події як є (`composer`, `unclassified`, `task-notification`, …); класу не визначає: людина в stream-json має `unclassified`, у терміналі — `composer` |
| text | string | yes | — | непорожній; обрізаний — голова і закривальні теги рамки разом не довші за MAX_DELIVERY_TEXT, плюс хвіст обрізання (розбір файлу допускає ще 100 символів хвоста) | відрендерений текст — текстові блоки `content` події, з'єднані `\n`, з рамкою `<system-reminder…>` як є; довгий — CutDelivery ([SP_CTX_02_35](./context_editor.deliveries.sp.md#SP_CTX_02_35)): рамка лишається цілою |
| cut | int | yes | 0 | ≥ 0 | скільки символів оригіналу після голови обрізано (разом із закривальними тегами, які CutDelivery дописує заново) |
| media | int | yes | 0 | ≥ 0 | скільки нетекстових блоків мав `content`; вони не переносяться: рядок без `handle` медіа не несе (навичка plugin-hooks, пункт 6) |
| at | int | yes | — | мс від епохи | час запису |

DeliveryKind(text): коли `text` без пробілів зліва починається з `<system-reminder`, береться перший непорожній рядок після рядка відкривного тегу; він дорівнює рядку DELIVERY_FRAMES — клас `person`, `agent` чи `task`; інакше (і без рамки) — `other`. Клас визначає текст, а не `origin`: походження розходяться між хостами, а звіти субагентів у VS Code мають у транскрипті `origin.kind: peer` (транскрипт decd4bc6: 3 `human`, 13 `peer`, 19 `task-notification`, усі за рядком з `tool_result`). `person` — повідомлення людини ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), PersonText); `agent` і `task` — невідтворювані звіти, які агент може згорнути, як інші результати ([C_CTX_03_04](./context_editor.core.concept.md#C_CTX_03_04), «Відтворюваність»).

Invariants:
- Пара (`text`, спільний ідентифікатор в `anchor`) унікальна у файлі: копія доставки, яку stream-json після компактизації знову проводить через `session.append` (за копією рядка-якоря), нового запису не дає.
- Запис живе, доки рядок-якір лишається в розмові з `handle` (вкладення тоді переносить хост). Вставлений рядком, пішовши разом зі згорнутим чи прибраним якорем, або з якорем, якого вже немає в рядках компактизації (вбудована компактизація, межа), запис видаляється при наступному застосуванні мода ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)).
- Файл належить сесії ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)); `--resume` у новому процесі має той самий `session_id`, тож записи лишаються. Передача файлу не переносить: засів несе доставки рядками ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)). Доставки форка сесії, старішої сесії чи такі, що прийшли до завантаження мода, записів не мають — запасне читання транскрипту (R2 спайку) — у backlog плану ([SP_CTX_DEC_19](./context_editor.decisions-01.sp.md#SP_CTX_DEC_19)).

### 01_23. HostAttachState  {#SP_CTX_01_23}

Рішення про вкладення хоста ([SP_CTX_02_39](./context_editor.hostattach.sp.md#SP_CTX_02_39)–[02_41](./context_editor.hostattach.sp.md#SP_CTX_02_41); фаза 24). Файл `<storage>/hostattach.json`, ланцюжок `hostattach` (ранг 4); пише лише застосування мода (CommitAttachments), перевірка прогнозу на першому кінці ходу після нього (VerifyPredictions → RollbackPredictions: `answers`, `predicted`, `uncomparable`, `left`) і спостерігач іншої компактизації (ClearAttachments); хук `prompt.attachment` лише читає — через кеш файлів сховища (як реєстри тегів і псевдонімів, [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)), тож запис застосування одразу бачить перепитування після компактизації. Стани читання — як у черги: `missing` — порожній стан (усе лишається), `unreadable` — не JSON, не об'єкт або поле порушує таблицю; хук тоді лишає кожне вкладення, а наступне застосування переносить файл у `hostattach.json.bad-<ms>` і пише рішення заново; файл, який не вдалося перенести, не перезаписується.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| answers | map<TextHash, AttachDecision> | yes | `{}` | ≤ MAX_ATTACH_ANSWERS записів | Відповідь у силі для тексту вкладення за його TextHash |
| matched | list<SectionKey> | no | `[]` | ≤ MAX_ATTACH_KEYS, останні | Розділи, чий вміст збігся з файлом, коли їх уперше побачили (порівнюваність, [SP_CTX_02_40](./context_editor.hostattach.sp.md#SP_CTX_02_40)) |
| predicted | map<path, SectionKey> | no | `{}` | ≤ MAX_ATTACH_PATHS | Прогноз останнього застосування: найновіша копія шляху відрізнялась від файлу, тож хост мав докласти нову; перевіряється на першому кінці ходу після застосування (VerifyPredictions, [SP_CTX_02_40](./context_editor.hostattach.sp.md#SP_CTX_02_40)) і наступним застосуванням |
| uncomparable | list<path> | no | `[]` | ≤ MAX_ATTACH_PATHS | Шляхи, для яких прогноз не справдився: диск для них більше не порівнюється |
| left | `{ copies: int, chars: int }` | no | `{0, 0}` | ≥ 0 | Що відповіді в силі лишають поза кожним запитом: прибрані копії і замінені розділи, символи; для звіту і телеметрії |

AttachDecision:

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| copies | int | yes | ≥ 1 | Скільки копій цього тексту мала розмова, коли рішення ухвалено; копія понад них (у серії чи від початку проходу) — нова й лишається |
| repeat | true? | no | — | Побайтовий повтор: перша копія серії лишається, решта пропускаються |
| drop | true? | no | — | Пропустити кожну копію (усі розділи застарілі й немає преамбули; перелік, усі назви якого має один новіший перелік) |
| stale | list<SectionKey>? | no | ≤ MAX_ATTACH_KEYS | Розділи, які копія замінює рядком SUPERSEDED |

TextHash(s) = довжина і два 32-бітні хеші (FNV-1a і djb2-xor) у base 36, через крапку; SectionKey(path, body) = TextHash(path + «\0» + trim(body)).

Invariants:
- Рішення змінюються лише в застосуванні мода, що змінило розмову, у VerifyPredictions на першому кінці ходу після нього (лише знімає прогноз, якого хост не справдив) і в ClearAttachments; між ними хук відповідає за файлом, тож відновлений процес (`--resume`, пам'ять порожня) надсилає ті самі байти.
- Копія з преамбулою (PREAMBLE_HEAD) ніколи не пропускається цілком; вкладення, яке розбір не розуміє, і тип поза ATTACH_TYPES не мають рішення.
- Файл належить сесії; передача його не переносить (нова сесія має свої вкладення).

### 01_24. ApplyLedger  {#SP_CTX_01_24}

Журнал входу застосувань (фаза 32; спайк [context_editor_resume](./context_editor_resume.spike.md)): `handle` рядків, які застосування мода отримало на вхід і які після `--resume` хост може повернути оригіналами (оригінал до межі несе `handle`, що дорівнює його uuid, тобто `handle` рядка входу). Файл `<storage>/ledger.json`, ланцюжок `ledger` (ранг 4); пише HandleCompaction у фоні після точки фіксації (RecordInputs, [SP_CTX_02_44](./context_editor.resume.sp.md#SP_CTX_02_44)) і HandleRepair, що очищує його після ремонту ([SP_CTX_02_47](./context_editor.resume.sp.md#SP_CTX_02_47)); читають NeedsRepair, HandleRepair, HandleCompaction і BuildSeed (DropPulled, [SP_CTX_02_45](./context_editor.resume.sp.md#SP_CTX_02_45)). Стани читання — як у черги; `unreadable` запис переносить убік (карантин, [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)) і починає новий журнал; читачі вважають його порожнім.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| clean | bool | no | — | лише `true` | Ремонт цієї сесії відповів «nothing to repair» після останнього застосування: NeedsRepair мовчить; RecordInputs і очищення після ремонту поле знімають (рев'ю фази 32) |
| entries | list<LedgerEntry> | yes | `[]` | Σ `handles` ≤ MAX_LEDGER_HANDLES; серіалізований файл ≤ MAX_QUEUE_BYTES — коли запис перевищив би межу, найстаріші записи видаляються, доки не вміститься | Записи від найстарішого |

LedgerEntry:

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| at | int | yes | мс від епохи | `reportId` застосування |
| handles | list<string> | yes | 1..MAX_LEDGER_HANDLES, без повторів (фаза 32, код: `e.messages` не має межі ROW_WINDOW) | `handle` рядків асистента і рядків з результатами входу застосування (промпти й інші рядки `user` без результатів не записуються — вони нічого не тягнуть) |

Invariants:
- Журнал належить сесії; передача його не переносить (засіяні рядки не мають `handle`).
- Після ремонту, що стоїть, журнал порожній: жоден рядок асистента чи результатів розмови не має `handle`, тож старі оригінали більше не підтягнуться.
- Журнал без запису не забороняє ремонту: залишкове правило DropPulled працює і без нього, якщо сесія мала застосування (запис `apply` журналу ефекту, [SP_CTX_01_19](#SP_CTX_01_19)).

### 01_25. Capabilities  {#SP_CTX_01_25}

Пам'ять модуля, з якої Capabilities ([SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53)) виводить вердикти: один об'єкт на екземпляр модуля (процес хоста), без файлу; перемикання сесії його не скидає, перезавантаження модуля — скидає.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| attachments | int | yes | 0 | ≥ 0 | Скільки разів хост викликав хук `prompt.attachment` мода (будь-який тип) |
| mainTurns | int | yes | 0 | ≥ 0 | Завершені не перервані ходи основної розмови в цьому екземплярі |
| live | map<Capability, `reached` \| `passed`> | yes | `{}` | — | Живі ознаки цього процесу |
| probe | map<Capability, `reached` \| `passed`> | yes | `{}` | — | Результат зонда цього процесу |
| cache | map<Capability, `reached` \| `passed`> | yes | `{}` | — | Запис кешу для версії цього хоста ([SP_CTX_01_26](#SP_CTX_01_26)) |
| probeState | `none` \| `planned` \| `running` \| `done` | yes | `none` | — | Зонд цього процесу (один на процес) |
| version | string | no | — | `x.y.z` | `$.session.version().version`, прочитана один раз; відсутня — читання кинуло (кешу і зонда немає) |
| noticed | list<Capability> | yes | `[]` | — | Можливості, які PassedText уже назвав у цьому процесі |
| ownSeen | int | yes | 0 | ≥ 0 | Скільки власних міток мода (MARKER, HANDOFF_MARKER, REPAIR_MARKER) побачив обробник `session.compact` цього процесу; NoteCommandUnseen порівнює до і після команди |
| passSeen | int | yes | 0 | ≥ 0 | Скільки інших компактизацій основної розмови (не precompute) побачив обробник; маршрут `brief` пропускає ObservePassedCompact, коли лічильник зріс |
| probeDone | Promise<void> | no | — | є лише з плануванням зонда | Справджується, коли зонд цього процесу закінчився (чи не запустився); на нього чекає дія, поки `compact` невідомий (`compactPassed`, ≤ PROBE_WAIT_MS, [SP_CTX_02_56](./context_editor.bypass.sp.md#SP_CTX_02_56)) |
| settle | функція | no | — | разом із `probeDone` | Справджує `probeDone`; кличе кінець зонда або невдале планування |

Capability: `compact` \| `attachments`.

Invariants:
- `attachments` і `mainTurns` лише зростають.
- Вердикт — функція полів (Verdict: `live` → `probe` → `cache` → `unknown`), окремо не зберігається.

### 01_26. CapabilityCache  {#SP_CTX_01_26}

Файл `<root>/capabilities.json` (корінь сховища `$HOME/.claude/context-editor/`, режим 700): вердикти за версією хоста, спільні для всіх сесій машини. Пише Merge ([SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53)) записом цілого файлу (останній записувач виграє: записи різних процесів однієї версії однакові або новіші за живими ознаками); читає старт сесії. Нечитабельний — як порожній, наступний запис його замінює.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| entries | map<string, CapEntry> | yes | `{}` | ≤ CAP_CACHE_VERSIONS ключів; при перевищенні видаляються записи з найстарішим `at` | Ключ — версія хоста |

CapEntry: `compact` і `attachments` — `reached` \| `passed` (кожне необов'язкове), `at` — мс від епохи, `source` — `probe` \| `live`.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділи перенесено дослівно з [context_editor.structures.sp.md](./context_editor.structures.sp.md): поділ файлу за модулями, якорі ті самі (structural-event) |
| 2026-10-17 | Аудит коду (SPEC-7, SPEC-13): 01_23 — рішення пише й VerifyPredictions на першому кінці ходу після застосування (знімає прогноз, якого хост не справдив), `predicted` перевіряється й там; 01_25 — поля `probeDone` і `settle` (очікування зонда) |
