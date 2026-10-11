# Редактор контексту агента — Specification: Contracts: edits and compaction

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-11
> **Updated:** 2026-10-11
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_01–02_10 специфікації [SP_CTX](./context_editor.sp.md): контракти `context_list`, `context_edit`, PrepareEdits, ApplyEdits, DropOwnCalls, Flush, HandleCompaction, DeliverReport, Nudge (вилучено), CollectMedia. Читати перед зміною `hooks/edits.ts`, `queue.ts`, `compaction.ts`, `flush.ts` або `media.ts`.

## Contents

Розділи цього файлу (h3 розділу «02. Contracts» парасольки):

- [02_01. context_list](#SP_CTX_02_01)
- [02_02. context_edit](#SP_CTX_02_02)
- [02_03. PrepareEdits](#SP_CTX_02_03)
- [02_04. ApplyEdits](#SP_CTX_02_04)
- [02_05. DropOwnCalls](#SP_CTX_02_05)
- [02_06. Flush](#SP_CTX_02_06)
- [02_07. HandleCompaction](#SP_CTX_02_07)
- [02_08. DeliverReport](#SP_CTX_02_08)
- [02_09. Nudge (вилучено)](#SP_CTX_02_09)
- [02_10. CollectMedia](#SP_CTX_02_10)

## 02. Contracts — перегляд, правки, застосування, компактизація

### 02_01. context_list  {#SP_CTX_02_01}

Purpose: інструмент агента; показує рядки основної розмови ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) від найстарішого, сторінками.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| from | int | no | типово 0; значення поза `0..len-1` обрізається до цих меж |
| count | int | no | типово LIST_COUNT; обрізається до `0..MAX_LIST_COUNT`; `0` — лише заголовок (телеметрія без рядків) |
| index | int | no | `0..len-1`; лише разом з `full: true` | Рядок для повного перегляду |
| full | bool | no | типово false; `true` вимагає `index`, `from` і `count` тоді ігноруються | Показати один рядок повністю |

Output: текст. Порожня розмова — `0 rows.`, за ним телеметрія. Інакше заголовок: кількість рядків, **один** розмір — рядки розмови в токенах з телеметрії (`measure = messages`), а без неї — Estimate суми символів з позначкою, калібрована ця оцінка чи `approx.` ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34)), кількість і сумарний розмір медіа, показаний діапазон і розмір рядків перед ним (лише при `count ≥ 1`), телеметрія (TelemetryText, [SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)) — з відкритим етапом, його першим рядком і розміром, останнім закритим блоком, кандидатами, журналом і слотом стану (останні два — коли є що показати), легенда позначок, `Next page: from=<n>`, якщо далі є рядки. Далі по рядку: `#<index><flags> <role> <size>c: <частини> <теги>`, де `flags` — `*` (текст рядка або результату починається з MARK), `!` (size ≥ BIG_ROW), `@` (є медіа); частини — `text "<90 символів>"`, `tool_use <tool>[~] id=<id>[ (<alias>)] input="<70>"`, `tool_result[~] id=<id>[ ERROR] "<70>"` (REPRO_FLAG `~` — клас пари: інструмент пари входить у REPRODUCIBLE_TOOLS; інструмент результату — з виклику з тим самим `tool_use_id` у поточній розмові, виклику немає — без `~`), `media <mediaType> ~<KB>KB` через ` | `; позначки після частин — `[stage ▶ <name>]` на першому рядку відкритого етапу (`StartOf(rows, stage.after)`, [SP_CTX_01_18](./context_editor.structures.sp.md#SP_CTX_01_18)); `[block ▶ <name>]` (без назви — `[block ▶]`) на першому рядку останнього закритого блоку (`StartOf(rows, lastClosed.after)`) і `[block end]` на його останньому рядку (`lastClosed.end`); далі теги: `[pin]`, `[disposable: "<40 символів нотатки>"]`, `[disposable #<a>..#<b>: "<40>"]` на першому рядку діапазону, `[review: <reason>]` (лише активний; тег без `reason`, записаний до фази 15, — `[review]` без причини, [SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)), `[state]`; після тегів — `[<id>]` кожної нотатки цілі (діапазон — `[<id> #<a>..#<b>]` на першому рядку). Під рядками сторінки — блок `Notes:` з повним текстом нотаток, чия ціль (перший рядок діапазону) на сторінці: по рядку `<id> #<i>: <text>` + (`remindAt` ? ` (reminder in <remindAt − turn> turn(s))` : ``) ([SP_CTX_01_21](./context_editor.structures.sp.md#SP_CTX_01_21)); нотатка, ціль якої не знаходиться, у переліку не показується, а телеметрія її рахує. Тег пари стоїть на обох її рядках. Загублений початок (`stage.after` чи `lastClosed.after` — `lost`) діє як голова: позначка `[stage ▶ …]` чи `[block ▶ …]` стоїть на #0, а телеметрія каже «its start row is gone, so it runs from #0» — позначка не зникає мовчки. Загублений кінець блоку позначки `[block end]` не дає, а телеметрія каже «its end row is gone». Порожній блок (`end` — `null` або перший рядок після кінця) позначок не має, телеметрія каже «it is empty». Межі останнього закритого блоку в переліку і телеметрії — те, з чого агент бере індекси в ході оптимізації і після поради з промптом людини: ці тексти індексів не мають ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)).

Розміри рядків (`<size>c`) лишаються в символах: це точна міра тексту, а токени рядка без прихованих міркувань моделі не оцінити. Рядок без тексту, викликів і результатів (лише thinking) показується як `(thinking)`, а не `(empty)`: ціллю нотатки чи тегу за індексом він бути не може ([SP_CTX_02_32](./context_editor.stages.sp.md#SP_CTX_02_32)). Нотатки поза сторінкою: заголовок сторінки має рядок `Notes elsewhere: <id> #<i>, …` (з `count: 0` сторінки немає, тож рядок називає всі нотатки) (до MAX_BLOCK_INDEXES, далі `+<n> more`; нотатка, ціль якої не знаходиться, — `<id> (row not found)`), щоб агент не вважав їх загубленими ([C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21)).

Повний рядок (`full: true`, `index`): заголовок `Row #<i> <role> <size>c` і повний вміст рядка — текст, кожен виклик з повним серіалізованим `input`, кожен результат з повним текстом, медіа списком типів і розмірів, теги й нотатки рядка з повним текстом; усе разом обрізається до MAX_FULL_ROW символів з хвостом `… (+<n> chars; the original, if this row was edited, is in the archive named in its text)`. Так агент перевіряє підсумок згортання чи заміни, перш ніж вирішувати, чи читати архів. Повний перегляд не оновлює `listedKey` (він не сторінка) і не рахує телеметрії.

Перелік з `count = 0` не оновлює `listedKey` ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)): індекси в його телеметрії (перший рядок етапу, рядок слоту стану, `Last block #a..#b`) — для орієнтації, а правки за індексом потребують переліку з рядками; навичка, OptimizeText і PersonAdvice (ListHint) просять саме перелік з рядками. Перелік з `count ≥ 1` оновлює його, як і раніше. Збій телеметрії не валить переліку: TelemetryText тоді — рядок `unavailable` з причиною ([SP_CTX_01_20](./context_editor.structures.sp.md#SP_CTX_01_20)).

Опис інструмента (LIST_DESCRIPTION, ≤ MAX_DESCRIPTION) називає: порядок від найстарішого, позначки рядка `* ! @` і клас пари `~`, теги з причинами `review`, `[state]`, `[stage ▶ …]`, `[block ▶ …]` і `[block end]`, позначки нотаток `[nN]`, блок `Notes:` і рядок `Notes elsewhere`, повний перегляд рядка `index` + `full: true`, один розмір у заголовку, те, що `count: 0` дає лише телеметрію, і що індекси — позиції цього переліку.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT | виклик із субагента | редагується лише основна розмова |
| BAD_FULL | `full: true` без `index` або з `index` поза `0..len-1`; `index` без `full: true` | дати `index` рядка з переліку |
| DENIED_FAILURE | збій під час побудови переліку | повторити пізніше; причина в повідомленні |

### 02_02. context_edit  {#SP_CTX_02_02}

Purpose: інструмент агента; перевіряє правки і дописує прийняті до черги.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| edits | list<Edit> | yes | 1..MAX_QUEUE_EDITS |
| resume | bool | no | задає `Queue.resume` поточного пакета; без нього в ході оптимізації — правило нижче ([SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16)) |
| resume_prompt | string | no | ≤ MAX_TEXT; непорожній після обрізання задає `Queue.resumePrompt`, порожній ігнорується |
| keep_cache | bool | no | задає `Queue.keepCache` пакета; останнє явне значення в пакеті виграє, виклик без поля лишає вибір (типово `false`). Опис поля в схемі: `Keep the prompt cache up to the first edit (default false): cheaper when the earliest edit is within your last few calls and you end the turn soon; but if this session is later resumed (--resume, reopening it), earlier answers may show twice.` ([SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22); фаза 23, після живого прогону) |

Output: `Queued <n> edit(s); <m> pending in total.`, рядок `"last" = <CallLabel>`, коли хоч одна правка виклику мала `ref: "last"` і він розв'язався (LAST_TEXTS, фаза 21), відхилені правки з причинами, попередження про повідомлення людини (нижче), для прийнятого `describe` — рядок DESCRIBE_DROPS, при непорожній черзі — вказівка завершити хід і, коли `resume = true`, текст продовження; у ході оптимізації з `resume = false` — `The session then stops; pass "resume": true to go on.`

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
    FUNCTION context_edit(edits, resume?, resume_prompt?, callId):   # callId — власний tool_use_id виклику з події tool.call, як у context_tag
        REQUIRE storage ready
        IF Queue state = unreadable: move the file aside (QUEUE_QUARANTINED) or deny (DENIED_QUEUE_READ); q = empty
        rows = CurrentRows()                                           # SP_CTX_02_18
        edits = edits with each resolvable `ref` of summarize/drop replaced by its tool_use_id (ResolveRef(ref, rows, callId), SP_CTX_02_17); an unresolved one keeps its reason for PrepareEdits
        lastLine = some edit resolved "last" ? "\"last\" = " + CallLabel(that call) : none   # фаза 21: агент бачить, яку пару назвав last
        hasMedia = edits hold a describe ? owner ∈ keys(CollectMedia(API form, rows).found) : false   # SP_CTX_02_10; API-подання читається лише для describe
        (queued, errors) = PrepareEdits(rows, edits, TagRegistry, hasMedia)   # реєстр unreadable → без перевірки pin; HandleCompaction відхилить кожну правку
        deliveries = read QueuedDeliveries (unreadable or missing → none)   # SP_CTX_01_22; лише для попередження
        warnings = PersonWarnings(rows, queued, deliveries)           # попередження, не відмова (C_CTX_DEC_21)
        REQUIRE len(q.edits) + len(queued) <= MAX_QUEUE_EDITS AND size of the new file <= MAX_QUEUE_BYTES
        q.edits += queued; IF queued not empty: q.tagsOnly = false
        prompt = resume_prompt non-empty after trim
        IF resume given: q.resume = resume
        ELSE IF q.optimizePrompted AND NOT q.resumeSet: q.resume = prompt                         # хід оптимізації: без вибору агента — без продовження (SP_CTX_DEC_16)
        IF resume given OR prompt: q.resumeSet = true                                             # вибір лишається й після виклику без прийнятих правок
        IF prompt: q.resumePrompt = resume_prompt
        write Queue; status line = "<len(q.edits)> context edit(s) queued"
        RETURN text report

Продовження в ході оптимізації ([SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16); пропозиція P15 практики 1). Хід оптимізації — хід, який мод запускає після відповіді з міткою, тобто після того, як агент уже завершив хід для людини; продовження за замовчуванням (`resume = true`, DEFAULT_RESUME) після такого ходу надіслало б «Continue the task from where you stopped.» після вже виконаного завдання. Тому, поки `optimizePrompted = true` і агент ще не обрав продовження пакета (`resumeSet = false`), виклик без явного `resume` ставить `resume = false`; непорожній `resume_prompt` без `resume` означає продовження (`resume = true`); явний `resume` діє як завжди. Вибір (`resume` або непорожній `resume_prompt`) записується в `resumeSet` навіть тоді, коли виклик не поставив жодної правки (напр. усі відхилено INDEXES_STALE), тож повтор без `resume` його не скасовує (рев'ю 46); пізніший `resume_prompt` після `resume: false` продовження не вмикає. Заміни з тегів (QueueTagReplacements) `resumeSet` не змінюють. Пакет ходу з міткою, що лишився в черзі (компактизацію покинуто), свого `resume` не зберігає: заміна Flush перед промптом ходу оптимізації ставить йому `resume = false`, `resumeSet = false` ([SP_CTX_02_06](#SP_CTX_02_06)), бо OptimizeText обіцяє зупинку; черга без правок свого `resume = true` не втрачає — інакше наступний пакет ходу людини не продовжився б. Правило — у чистій функції постановки в чергу (QueueEdits) і в заміні Flush (`swapOptimize`); DetectOptimize і DeliverReport не змінюються. Результат виклику (`queuedText`) називає продовження за `resume = true`, а в ході оптимізації за `resume = false` каже `The session then stops; pass "resume": true to go on.`, тож агент бачить наслідок свого виклику. Застряглий `optimizePrompted` (запис DetectOptimize на кінці ходу оптимізації не вдався — його виняток поглинається) робить так само без продовження і пізніші пакети без явного `resume`, доки прапорець не зніме кінець наступного ходу чи промпт людини між ходами; агент бачить це в результаті `context_edit`. Правило стосується лише `context_edit`: `context_handoff` має власне `resume` (за замовчуванням `true`, [SP_CTX_02_19](./context_editor.handoff.sp.md#SP_CTX_02_19)). Залишкові вікна: промпт людини між заміною і відправкою промпту ходу оптимізації знімає `optimizePrompted` (DeliverReport), і хід оптимізації, що стане за ходом людини, отримує звичайне `resume = true`; перерваний хід оптимізації лишає пакет з `resume = false` до наступного завершеного ходу, і той хід без явного `resume` теж не продовжиться — звіт піде з наступним промптом людини.

Повідомлення людини в правці ([C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21); пропозиція P12). Прийнята правка, що захоплює повідомлення людини, не відхиляється, але результат називає ці рядки:

    PersonRow(rows, i) = rows[i] is a user row without toolResults AND PersonText(rows[i].text) is not empty
    PersonText(text):                                                  # що в рядку написала людина
        IF DeliveryKind(text) = person → the lines after the frame line, up to the first line that starts with "This is how Claude Code surfaces" or up to </system-reminder>, trimmed   # вставлена доставка від людини (SP_CTX_01_22, фаза 20)
        IF DeliveryKind(text) IN (agent, task) → empty                  # вставлений звіт субагента чи сповіщення задачі
        t = trimmed text with every leading closed span <ide_opened_file>…</ide_opened_file> or <system-reminder…>…</system-reminder> removed   # VS Code додає відкритий файл перед словами людини (рев'ю 40: 62 рядки в транскриптах репозиторію); тег з атрибутами (`<system-reminder id="…">`) — теж (фаза 20)
        IF t is a command row (holds <command-name>):
            the mod's own /compact with MARKER or HANDOFF_MARKER → empty
            ELSE → the trimmed content of <command-args>, empty when absent   # аргументи slash-команди — слова людини (`/dev-flow research …`)
        IF t starts with MARK, "context-editor:" or SUMMARY_OPENER → empty
        IF t matches /^The .+ plugin sent a message:/ → empty           # промпт розширення: хост зберігає його в такій рамці (типи хоста; рядки транскрипту, рев'ю 39)
        IF t starts with <local-command-stdout>, <local-command-caveat>, <task-notification> or (without <command-name>) <command-message> → empty   # рядки хоста
        ELSE → t
    PersonPair(rows, id) = the call with this id has a tool in PERSON_TOOLS                                                                 # відповідь людини на запитання агента
    PersonDelivered(rows, i, deliveries) = some QueuedDelivery with kind = person has an anchor id among the results of rows[i]   # ще не рядок: висить за цим результатом (SP_CTX_01_22, фаза 20)
    PersonWarnings(rows, queued, deliveries) = for each queued collapse: PersonRow rows, rows of PersonPair results and PersonDelivered rows in its span;
                                   for each queued summarize or drop of a PersonPair: its result row;
                                   for each queued drop whose result row is PersonDelivered by a delivery whose every anchor id is the dropped pair: that row   # summarize лишає доставку на місці (SP_CTX_02_36) — без попередження; drop одного з паралельних результатів лишає рядок і доставку (рев'ю 48)
        → "Warning: <edit label> covers the person's messages: #<i> (prompt), #<j> (AskUserQuestion answer), #<k> (message sent during this tool call), …. Keep them verbatim unless you drop them deliberately."   # до MAX_BLOCK_INDEXES рядків на правку
    PersonTagWarnings(rows, added, deliveries) = for each added disposable range: PersonRow rows, rows of PersonPair results and PersonDelivered rows in #a..#b;   # context_tag, SP_CTX_02_11
                                     for each added disposable on a PersonPair: its result row
        → the same text with the label "disposable #<a>..#<b>" or "disposable <tool_use_id>"

Попередження не повторюється при застосуванні і не впливає на пакет: що стискати, вирішує агент ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04)). Заміни з тегів (QueueTagReplacements) попередження при постановці в чергу не мають: ті самі рядки агент побачив у попередженні результату `context_tag` у мить тегування (PersonTagWarnings, [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) — прогін на копії сесії показав, що агент, який згортає діапазон, не помічає відповідей людини в ньому ([C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21)).

Доставки посеред ходу (фаза 20; [SP_CTX_01_22](./context_editor.structures.sp.md#SP_CTX_01_22)). Повідомлення людини, яке хост доставив посеред ходу, — повідомлення людини так само, як промпт: поки воно ще не рядок, PersonDelivered знаходить його за рядком-якорем, і `collapse` чи `drop`, після яких воно піде разом із якорем ([SP_CTX_02_36](./context_editor.stages.sp.md#SP_CTX_02_36)), отримують попередження; `summarize` якоря доставки не прибирає. Після першого застосування вставлена доставка — рядок `user`, і PersonText розпізнає в ній слова людини за рамкою DELIVERY_FRAMES (`<system-reminder>` з `The user sent a new message while you were working:`), а не відкидає її як нагадування хоста; звіт субагента і сповіщення задачі (`agent`, `task`) повідомленнями людини не є. Файл доставок не прочитався — попереджень про доставки немає, постановка не відмовляє.

Опис інструмента (EDIT_DESCRIPTION) не довший за MAX_DESCRIPTION. Фаза 23: пункт (8) — `Batch edits in one call (see "keep_cache").`, місце звільнено вилученням `, e.g. a wrong conclusion` з рядка `rewrite` (перший абзац уже називає хибні висновки); текст — 2029 з 2048, пояснення компромісу — в описі поля `keep_cache`. Після фази 17 текст був 2038 з 2048 символів, і пункт (8) зведено до «Batch edits in one call.» (пояснення кешу — у навичці). Фаза 5 (2026-10-10) додала до пункту (2) рядок операції `describe` (`{"op":"describe","index","description"}`: медіа в рядку промпту людини, позначка `@` у `context_list`, текст лишається), а місце звільнила за порядком нижче: пункт (6) скорочено до «Compress a finished stage's block into a stage record; usually keep verbatim …», пункт (7) зведено до вказівки на навичку — «Record template and guide: skill context-editor:context-stages.» (шаблон запису етапу — у навичці, розділ «Compressing a block»); текст — 2037 з 2048. Фаза 15 додає до пункту (4) відмову для рядка з `state` (до 100 символів) і звільняє стільки ж у пункті (6): з нього зникають «(`context_tag` close), or without stages the earliest processed or excess span» і «and the working part»; бюджет фази 15 — сума ≤ 2048, перевіряє рядок 05_01 «опис інструмента». Обов'язковий зміст за пріоритетом (хост обрізає кінець, [SP_CTX_02](./context_editor.sp.md#SP_CTX_02)): (1) призначення і що правки застосовуються після кінця ходу, з продовженням `resume` / `resume_prompt`; (2) операції з обов'язковими полями і правило пар `collapse`; (3) `ref` і `last`; (4) відмова для цілей з `pin` і для рядка з `state`, крім `rewrite` цього рядка; (5) оригінали архівуються у файл, названий у заміні, і читаються `Read` ([C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)); (6) порада одним реченням — стискати блок завершеного етапу, лишаючи зазвичай дослівно повідомлення людини — зокрема відповіді на запитання агента (AskUserQuestion) — і чинні правила й навички (ділянка без етапів і робоча частина — у навичці з фази 15) ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04), [C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21)); (7) шаблон запису етапу — мета; рішення з причиною, дослівними словами людини і причиною відмови від інших варіантів; факти з джерелами; змінені артефакти; відкриті питання (пропозиції P5, P11) — з фази 5 в описі лише вказівка на навичку, де шаблон записано; (8) пакетування; (9) вказівка на навичку `context-editor:<SKILL>`. Лише в навичці SKILL ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)): ціна скидання кешу, відтворюване проти невідтворюваного, глухі кути діапазоном `disposable`, мітка оптимізації, телеметрія, причини `review`, слот стану докладно. Пункт (7) уже зведено до вказівки на навичку (фаза 5); далі скорочується текст пунктів (8) і (6); пункти (1)–(5) лишаються повністю. Довжину перевіряє рядок 05_01 «опис інструмента». Фаза 18 (рев'ю 46, живий прогін F2): речення про продовження — `The session then resumes by itself with "resume_prompt" (default: …) unless "resume" is false; in an optimization turn only on "resume": true or "resume_prompt".`; місце дали скорочення «not at once», «already», «compact», речення про архів (`Originals are archived (original: <path> in the replacement)`), `A [pin] target` і «you still need» — 2045 з 2048 символів. Фаза 21 ([SP_CTX_DEC_20](./context_editor.sp.md#SP_CTX_DEC_20)): пункт (3) — `"ref":"cN" targets that call and "ref":"last" your latest call, without context_list.` замість `"ref":"last" the latest marked one, with no context_list call.` — 2035 з 2048 символів; що власні виклики `context_*` не рахуються, каже опис поля `ref` у схемі (`… or "last" for your latest call (context_* calls do not count)`; рев'ю 50: без «finished» — останній виклик без результату дає відмову, а не попередній завершений), а не EDIT_DESCRIPTION.

### 02_03. PrepareEdits  {#SP_CTX_02_03}

Purpose: перевірити правки на поточній розмові і поставити якорі. Відхилення однієї правки не зупиняє інших.

| Правка | Приймається, якщо | Інакше (причина) |
|--------|-------------------|------------------|
| будь-яка | `op` — один з п'яти; обов'язкові поля варіанта присутні і мають свій тип; текстові поля непорожні і ≤ MAX_TEXT | `unknown op` / `<field> is required` / `<field> is too long` |
| summarize, drop з `ref` | `ref` розв'язується ([SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17)) | `unknown ref <ref>` / `ref and tool_use_id are exclusive`; для `last` — причина ResolveLast: LAST_NONE / LAST_PENDING / LAST_ORPHAN (LAST_TEXTS, фаза 21) |
| summarize, drop | існують і виклик, і результат з `tool_use_id` | `no completed tool call with that id` |
| collapse | `0 ≤ from ≤ to < len` і діапазон містить кожен виклик разом з його результатом | `indexes out of range` / `range splits a tool call from its result` |
| rewrite | рядок `index` існує, має роль `assistant`, не має викликів | `index out of range` / `only an assistant text row can be rewritten; use collapse` |
| describe | рядок `index` існує, має роль `user`, не має результатів, має медіа за [SP_CTX_02_10](#SP_CTX_02_10) | `index out of range` / `describe applies to a user prompt row; use summarize for tool results` / `no media found in that row` |
| collapse, rewrite, describe | межа поточної розмови не змінилась від останнього `context_list` з рядками чи звіту закриття етапу у цьому процесі ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) | `the conversation was compacted since your last context_list; call context_list with a page of rows (count > 0) for current indexes — count 0 and "full" do not renew them` (STALE_INDEXES; перегляд одного рядка `full` теж `listedKey` не оновлює; той самий текст — у відмові INDEXES_STALE `context_tag` і `context_note`; фаза 18: до неї текст радив лише «call context_list again», і haiku в живому прогоні фази 15 після `/compact` викликала `context_list` з `count: 0` і далі отримувала відмову) |
| будь-яка | ціль (пара разом з обома її рядками, рядок, будь-який рядок або пара діапазону `collapse`) не має тегу `pin` | `target is pinned; remove the pin with context_tag first` |
| будь-яка, крім `rewrite` рядка з тегом `state` | ціль (як у рядку вище) не містить рядка з тегом `state` ([C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)) | `target holds the state slot; change it only by rewrite of that row, or remove its state tag first` |

Рядок з тегом `state` змінює лише `rewrite` саме цього рядка; `collapse`, що його захоплює, відхиляється так само, як для `pin`. Обидві перевірки (`pin` і `state`) повторюються при застосуванні ([SP_CTX_02_07](#SP_CTX_02_07)) і в засіві ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) на тодішньому реєстрі одним кроком:

    FUNCTION ScreenPinned(rows, edits, reg) → (edits, refused):         # спільний для HandleCompaction і BuildSeed
        IF reg unreadable: RETURN ([], every edit "tag registry unreadable")
        FOR e IN edits: target of e (as in the table above) has a pin → refused "target is pinned"
                        ELSE e is not a rewrite of the state row AND its target holds the state row → refused "target holds the state slot"
                        ELSE keep e

Перевірка `state` живе всередині ScreenPinned, а не окремим кроком викликача: так застосування і засів не розходяться (код фаз 3–17 — `screenPinned` у `hooks/compaction.ts`, його викликають обробник і BuildSeed). Рядок перевірки межі поточної розмови (`listedKey`) діє лише для правок агента з `context_edit`; заміни з тегів (QueueTagReplacements, [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)) проходять PrepareEdits без нього (`checkListedKey = false`).

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
| freeze | `{ api: list<json> }`? | no | передає лише HandleCompaction ([SP_CTX_02_07](#SP_CTX_02_07)) і лише для пакета з `keepCache`; засів — ні | заморожений префікс (фаза 23, [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22)): `api` — API-подання тієї самої розмови, з якого ResponseStart бачить межі відповідей |

Output: `{ rows: list<Row>, report: ApplyReport, renamed: map<string, string>, prefix: int }`; `charsAfter` дораховує [SP_CTX_02_07](#SP_CTX_02_07); `renamed` — для кожної застосованої `summarize` її `tool_use_id` → FreshId, з яким пара стоїть у `rows` (читає InsertDeliveries, [SP_CTX_02_36](./context_editor.stages.sp.md#SP_CTX_02_36); фаза 20); `prefix` — довжина замороженого префікса: `rows[0..prefix)` — ті самі рядки входу з `handle`; без `freeze` — 0, з `freeze` без застосованої правки — `len(rows)`.

Processing logic (pseudocode):
    FUNCTION ApplyEdits(rows, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia, apiTruncated, freeze):
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
                    IF describe AND media has no paths for {row: at}: failed ("media could not be archived" IF {row: at} in mediaOwners OR media has the key ELSE NO_MEDIA_NOW)   # медіа цього рядка знайдено (PromptMatch на рядках застосування) і заархівовано саме цим застосуванням; інакше рядок не змінюється
            IF edit replaces media of an owner in mediaOwners AND media has no paths for it: failed "media could not be archived"
            plan += (edit, touched, pair?, hi = max(touched))
        SORT plan BY hi DESC; anyRow = {}; exclusiveRow = {}; pairs = {}
        FOR step IN plan:
            conflict = step.pair ? (step.pair ∈ pairs OR step.touched ∩ exclusiveRow ≠ ∅) : step.touched ∩ anyRow ≠ ∅
            IF conflict: report.failed += "overlaps another edit"; CONTINUE
            run step; report.applied += step; anyRow ∪= step.touched; IF step replaces rows: step.last = its last produced row (a reference, kept on the row through later rebuilds)
            IF step.pair: pairs += step.pair ELSE exclusiveRow ∪= step.touched
        first = min over applied steps of min(step.touched)   # кожен крок міняє і вирізає рядки лише від своїх, тож рядки до first стоять на своїх індексах
        prefix = freeze absent ? 0 : (applied steps ? ResponseStart(rows, first, freeze.api) : len(rows))   # FrozenPrefix, SP_CTX_DEC_22
        frozen = the rows rows[0..prefix) as received                          # ті самі рядки, з handle
        rows = rebuild every untouched row NOT in frozen that has a handle AND toolResults AND none of its owners in mediaOwners
               AND all its result ids in knownResults                            # SP_CTX_DEC_02 — від відповіді першої зміни
        rows = KeepResponsesWhole(rows, frozen)
        rows = remove rows without handle that became empty
        rows = MergeCallRows(rows, frozen)            # виклики однієї відповіді без handle — одним рядком
        renamed = { id → id' : each applied summarize }   # для InsertDeliveries (SP_CTX_02_36)
        RETURN rows, report, renamed, prefix

    FUNCTION KeepResponsesWhole(rows, frozen):    # відповідь моделі не розривається перезібраним рядком
        stretches = rows split before every prompt row (a user row without toolResults that is not a result row a drop left empty: it has a handle or content)   # порожній рядок ще не відфільтровано
        FOR stretch IN stretches:
            IF stretch holds no assistant row without handle (rebuilt or inserted): CONTINUE
            rebuild every assistant row with handle in stretch that is not in frozen   # і до, і після перезібраного; thinking-блоки цих рядків губляться; префікс ResponseStart не ділить відповіді з перезібраним рядком
        RETURN rows                                                                   # рядки результатів — за правилом вище (SP_CTX_DEC_02)

    FUNCTION ResponseStart(rows, at, api):        # перший рядок відповіді моделі, що містить rows[at] (фаза 23)
        floor = the index after the last prompt row at or before at (0 without one)   # відповідь не перетинає промпту
        i = at
        IF rows[i] is a user row with toolResults:                                   # рядок результатів — відповідь його викликів
            i = the earliest row in floor..at−1 that holds a call of its results; none → RETURN floor
        IF rows[i] is not an assistant row: RETURN i                                 # промпт чи доставка — рядок сам по собі
        LOOP:
            i = back over consecutive assistant rows, not below floor                # рядки асистента поспіль — одна відповідь
            run = the consecutive assistant rows from i on
            m = the latest assistant message of api that holds a tool_use id of run, or a non-empty text of run (whitespace removed)
            IF m absent: RETURN floor                                                # поза вікном API чи прогін без викликів і тексту: як KeepResponsesWhole
            e = the earliest index k in floor..i−1 whose row is an assistant row holding a tool_use id or a text of m
            IF e absent: RETURN i
            i = e                                                                    # паралельні виклики «виклик, результат, виклик»: хост злив їх в одне повідомлення

    run summarize: id' = FreshId(id); use row rebuilt, call gets id' and loses text; result row rebuilt, result gets id' and text MARK+" you read the full output here, then replaced it with your summary"+note+mediaNote(id)+": "+summary   # автор і час — SP_CTX_DEC_17 (A′), фаза 19
    run drop: call removed from its row, result from its row; both rows rebuilt; media paths of id go to the report only
    run collapse: span = rows[from..to] → originals; carrier = first call in span whose tool does not start with OWN_TOOLS
        carrier exists → 2 rows: assistant {text "", toolUses [carrier with id' = FreshId, input {}, no text]}, user {toolResults [{id', isError false, text T}]}
        no carrier → 1 row {role span[0].role, text T, toolUses []}
        T = MARK+" you read these <n> rows, then collapsed them into your note"+note+mediaNote(all owners in span)+": "+summary
    run rewrite: row text = MARK+" you rewrote this row"+note+": "+text; row rebuilt
    run describe: row text = MARK+" you saw the media here, then replaced it with your description"+note+mediaNote(row)+": "+description+"\n\n"+original text; row rebuilt   # вкладення хоста на handle рядка (вміст файлу з @шлях, нагадування) зникають разом із медіа (навичка plugin-hooks, пункт 44); звіт і результат context_edit кажуть це DESCRIBE_DROPS
    mediaNote(owners) = media has paths for these owners ? " (media: "+paths joined ", "+")" : ""

    FUNCTION Produced(final, steps) → list:                         # викликають HandleCompaction після DropOwnCalls і BuildSeed після нормалізації
        RETURN [ (step label, k, fingerprint(final[k])) FOR step IN applied replacing steps WHERE the row step.last refers to (or the row rebuilt from it) stands at index k of final ]

    FUNCTION MergeCallRows(rows, frozen):         # Verify фази 14, D1
        FOR each row r of rows in order:
            IF the row before it (as merged so far) is an assistant row without handle with toolUses AND r is an assistant row without handle AND neither is in frozen:
                merge r into it: text = the two texts joined by a blank line (empty ones left out), toolUses = its calls, then the calls of r
        RETURN rows

Правки пар (summarize, drop) не розрізають рядків, тож кілька правок різних пар на спільних рядках застосовуються послідовно; правки рядків (collapse, rewrite, describe) беруть свої рядки виключно.

Хто і коли написав заміну (фаза 19; [SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17) — A′; живий прогін фази 18, F1). Текст кожної заміни каже, що агент сам бачив оригінал на цьому місці, а потім сам його замінив: `you read the full output here, then replaced it with your summary`, `you read these <n> rows, then collapsed them into your note`, `you rewrote this row`, `you saw the media here, then replaced it with your description` — і для правок агента, і для замін з тегів `disposable` (нотатку теж написав агент, [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)). Без цих слів haiku після власного `summarize` трьох виводів `cat` на питання «What did you do?» відповідав, що від `cat` отримав «готовий підсумок плагіна» і сирих файлів не перевіряв (`.dev_flow/cache/live-test/phase18-results.md`, F1): заміна стоїть там, де був результат, одразу після виклику, а власний виклик `context_edit` прибирає DropOwnCalls, тож причина — позиційна, і текст мусить назвати і автора, і час. Префікс MARK не змінюється, тож розпізнавання змінених рядків (позначка `*`, R5 (а), PersonText) не зачеплено; CarryNote засіву (`media carried as files`) і рядок псевдоніма (`id cN`) пише мод, а не агент, — їх слова лишаються.

«Правка замінює медіа власника»: summarize і drop — власник `{tool_use_id}` пари; collapse — власники всіх пар і рядків діапазону; describe — власник `{row}`. Для `describe` умова сильніша за «власник у mediaOwners»: власника могло не бути в mediaOwners, якщо PromptMatch на рядках застосування дав «немає» (зсув, рядок у хвості, якого немає в API), — тоді опис без медіа-файлу мовчки знищив би зображення людини; тому `describe` вимагає шляхів медіа свого рядка в `media` і інакше відхиляється з NO_MEDIA_NOW. Так і в HandleCompaction (`media` — архів цього застосування), і в BuildSeed (`mediaOwners = ∅`, `media` — файли засіву).

`Locate(rows, anchor, hint)`: рядок `hint`, якщо його відбиток збігається; інакше єдиний рядок з цим відбитком; інакше «не знайдено».

`FreshId(id)` = `base` + `_ce` + поточний час у base36 + 4 випадкові символи `[0-9a-z]`, де `base` = `id` без кінцевого суфікса `_ce[0-9a-z]+`; результат складається лише з `A–Z a–z 0–9 _ -`. Повторна правка тієї ж пари не подовжує ідентифікатор.

«Перезібрати рядок» = скопіювати `role`, `text`, виклики (`tool_use_id`, `tool`, `input`, `text`) і результати (`tool_use_id`, `text`, `isError`) без `handle`.

Цілісність відповіді (KeepResponsesWhole). Хост зливає рядки асистента з однаковим `message.id` (одна відповідь моделі) при побудові запиту, навіть через рядки з іншим id; `SessionMessage` цього id не показує. Перезібраний рядок отримує синтетичний id і розриває відповідь, а пізніший рядок тієї ж відповіді, повернений з `handle`, хост підтягує назад у раніше повідомлення: його `tool_use` втрачає сусідній результат, модель бачить «Tool result missing due to internal error», а медіа цього результату зникає. Так в обох хостах і обома шляхами компактизації (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 5; навичка plugin-hooks, пункт 30). Відповідь ніколи не перетинає промпт людини, тож у кожному відрізку між промптами, де є перезібраний або вставлений рядок асистента, перезбираються всі рядки асистента з `handle` — і ті, що стоять після нього, і ті, що перед ним. Пізніші рядки треба перезібрати, бо злиття йде назад (Entry 5). Раніші — бо модель з thinking пише одну відповідь кількома рядками з тим самим `message.id` (рядок лише з thinking, далі рядок з `tool_use`): рядок thinking, повернений з `handle`, після `--resume` чи `/resume` за злиттям `message.id` підтягує з-до межі оригінальний `tool_use` разом із результатом, і правка втрачається навіть у суто текстовій розмові (Verify фази 11; навичка plugin-hooks, пункти 7б і 36). Відрізок ширший за одну відповідь (кілька відповідей агентного циклу між двома промптами), але `message.id` модові не видно, тож ціна — перезібрати й інші відповіді того самого відрізка. Рядки результатів лишаються за чинним правилом: з медіа — з `handle`, без медіа — перезібрані ([SP_CTX_DEC_02](./context_editor.sp.md#SP_CTX_DEC_02)); батько до межі в копії рядка результату з `handle` (навичка plugin-hooks, пункт 5) за цього правила не шкодить (Entry 5). Ціна: thinking-блоки всіх рядків асистента такого відрізка губляться. Моделі, що зберігають thinking минулих ходів, втрачають міркування раніших відповідей відрізка; міркування після точки правки правка й так робить неактуальними. Рядок, у якому лишився лише thinking, стає порожнім і видаляється. Відоме обмеження: згортання без носія, що починається на промпті людини й закінчується посеред відповіді (рядок thinking чи тексту в межах, рядок `tool_use` тієї ж відповіді — поза ними), вставляє рядок `user` без `handle`, який KeepResponsesWhole вважає промптом; решта відповіді лишається з `handle`. У тому самому процесі це не шкодить; після `--resume` злиття за `message.id` повертає згорнутий оригінал (backlog K, [C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05)). Відбитки (роль, ідентифікатори, текст) від перезбирання не змінюються, тож CurrentRows і межа ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) не зачеплені. Засіву ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) правило не потрібне: жоден засіяний рядок не має `handle`.

Заморожений префікс (FrozenPrefix, фаза 23; [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22); з живого прогону — лише на вибір агента, `keep_cache`, типово вимкнено). Мітка кешу API знаходить попередній запис не далі ніж за CACHE_LOOKBACK позицій назад, тож запит після застосування читає кеш до першої зміни, лише коли байти до неї ті самі, що в попередньому запиті ([SP_CTX_02_38](./context_editor.stages.sp.md#SP_CTX_02_38); спайк [context_editor_cache](./context_editor_cache.spike.md)). Перезібраний рядок результату з простим текстом дає ті самі байти, але перезібраний рядок асистента губить thinking, а перезібраний рядок результату — доставку за ним (повідомлення `role: "system"`, яке InsertDeliveries повертає текстовим блоком, тобто іншими байтами); DropOwnCalls ранніх власних пар теж міняє байти. До фази 23 ці три кроки зсували першу зміну на початок ходу чи розмови: правка останнього з 12 результатів одного ходу давала читання 69 697 (лише `tools + system`) замість 96 656 (Entry 4 спайку). Тому з `freeze` рядки до відповіді, що містить першу зміну, повертаються як отримано — тими самими рядками з `handle`: їх не перезбирає правило [SP_CTX_DEC_02](./context_editor.sp.md#SP_CTX_DEC_02), KeepResponsesWhole і MergeCallRows, а DropOwnCalls лишає власні пари в них ([SP_CTX_02_05](#SP_CTX_02_05)). Перша зміна — найменший рядок, якого торкається застосований крок: рядок виклику пари для `summarize` і `drop`, перший рядок діапазону `collapse`, рядок `rewrite` і `describe`; правка, що не застосувалась, префікса не зсуває. Відповідь, що містить першу зміну, перезбирається вся (ResponseStart): рядок thinking тієї самої відповіді, лишений з `handle`, після `--resume` підтягнув би оригінальний виклик за злиттям `message.id` (навичка plugin-hooks, пункти 7б і 36). `message.id` моду не видно, тож межу відповіді дає API-подання: хост зливає рядки однієї відповіді в одне повідомлення асистента, зокрема паралельні виклики, записані «виклик, результат, виклик» (пункти 30, 40); без такого повідомлення (поза вікном API) межа — початок відрізка від промпту, як у KeepResponsesWhole до фази 23. Раніші відповіді того самого відрізка вже не перезбираються: за ResponseStart жодна з них не ділить `message.id` з перезібраним рядком. Доставка за рядком результату в префіксі їде на його `handle` (пункт 44), тож InsertDeliveries її не вставляє ([SP_CTX_02_36](./context_editor.stages.sp.md#SP_CTX_02_36)). Ціна: рядки результатів префікса стоять після межі з `handle`, і після `--resume` усе до останнього такого рядка вантажиться з оригіналів (пункт 7а); вміст цих рядків той самий, що в поточній розмові, бо префікс не змінено, — але живий сценарій 05_03 «Відновлення після застосування із замороженим префіксом» показав, що `--resume` дублює кожну відповідь префікса: копії з `handle` після межі підтягують оригінали за `message.id` (навичка plugin-hooks, пункти 7б, 30, 36). Тому заморожений префікс — лише за `keep_cache` пакета, а типовий шлях перезбирає відрізок, як до фази 23, і відновлюється чисто. Засів ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) `freeze` не передає: у засіяній сесії жоден рядок не має `handle`, і правила вище діють як до фази 23.

Виклики однієї відповіді (MergeCallRows). Рядок без `handle` хост надсилає окремим повідомленням із синтетичним id і зливає лише рядки з одним `message.id`. Паралельні виклики однієї відповіді хост пише окремими рядками асистента (рядок `tool_use a`, рядок `tool_use b`, далі рядок результатів); перезібрані KeepResponsesWhole чи правкою, вони стають повідомленнями `assistant(tool_use a)`, `assistant(tool_use b)`, `user(results a, b)`: перший `tool_use` не має результатів одразу після себе, хост пише `[ERROR] ensureToolResultPairing: repaired missing tool_result blocks`, а модель бачить «Tool result missing due to internal error» (Verify фази 14, D1, обидва хости; навичка plugin-hooks, пункт 30). Тому після видалення порожніх рядків кожен рядок асистента без `handle` з викликами вбирає наступні рядки асистента без `handle` до першого рядка іншої ролі чи рядка з `handle`: тексти — по порядку через порожній рядок, виклики — по порядку. Рядки асистента поспіль — одна відповідь: відповідь ніколи не перетинає рядка результатів чи промпту, а KeepResponsesWhole у відрізку з перезібраним рядком лишає без `handle` всі рядки асистента. Рядок тексту чи thinking перед викликами лишається окремим: таку пару хост приймає (спайк context_editor_handoff_long, Entry 5, vR — pass). Злитий рядок має новий відбиток (роль і всі ідентифікатори викликів), тож для RebindTags рядки, що злились, — «прибрані без заміни»: теги пар за `tool_use_id` і псевдоніми розв'язуються як раніше, тег за якорем на рядку виклику губиться (такі теги — рідкість: `disposable` за індексом лише на тексті без викликів), межа етапу на такому рядку переїжджає за попередній незмінений рядок ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)); `produced` правки `rewrite`, чий рядок злився з рядком викликів, знаходиться за частиною тексту злитого рядка. Перевіряється наживо лише випадок спільного рядка результатів (D1); рядки результатів паралельних викликів, записані окремо (`user(result a)`, `user(result b)` після злитого рядка), — сусідні повідомлення `user` — рядок 05_03 «Паралельні виклики після застосування».

### 02_05. DropOwnCalls  {#SP_CTX_02_05}

Purpose: прибрати з результату ApplyEdits виклики інструментів мода та їхні результати.

Input: рядки, `mediaOwners`, `knownResults`, `frozen` — рядки замороженого префікса ([SP_CTX_02_04](#SP_CTX_02_04); у засіві й поза компактизацією — жодного). Logic: множина ідентифікаторів викликів, чия назва починається з OWN_TOOLS, крім тих службових пар, у рядку результату яких є інший результат з власником у `mediaOwners` або з id поза `knownResults` — такі пари лишаються разом із рядками, бо перезбирання знищило б незаархівоване медіа, — і крім пар, виклик чи результат яких стоїть у `frozen` (фаза 23, лише з `keep_cache`): їхні байти тримають кеш промпту до першої зміни ([SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22)). Типово `frozen` порожній, і власні виклики прибираються всі, як до фази 23; з `keep_cache` виклики до першої зміни лишаються в розмові. Кожен рядок, що містить решту службових викликів або результатів, перезбирається без них; потім рядки проходять KeepResponsesWhole з тим самим `frozen` ([SP_CTX_02_04](#SP_CTX_02_04)), бо перезібраний рядок асистента зі службовим викликом теж розриває відповідь; рядки без `handle`, що стали порожніми, видаляються, а виклики однієї відповіді без `handle` зливаються в один рядок (MergeCallRows, [SP_CTX_02_04](#SP_CTX_02_04)): прибраний службовий рядок посеред паралельних викликів інакше лишив би два окремі перезібрані рядки викликів. Рядок-носій `collapse` ніколи не є службовим викликом ([SP_CTX_02_04](#SP_CTX_02_04)).

Output: рядки і `removed` — кількість прибраних службових пар (виклик разом з результатом рахується одним; пари, що лишились біля медіа чи поза `knownResults`, не рахуються). HandleCompaction і BuildSeed пишуть її в `report.ownCallsRemoved` ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)): звіт застосування тоді каже агенту, що його власні виклики прибрано, а теги й нотатки лишились (пропозиція P13).

Рядки доставок, які InsertDeliveries ([SP_CTX_02_36](./context_editor.stages.sp.md#SP_CTX_02_36)) вставило перед DropOwnCalls, — рядки `user` без результатів: DropOwnCalls їх не чіпає. Доставка, що висіла за результатом службового виклику, лишається на своєму місці — після решти рядків тієї ж відповіді, бо хост доставляє її після останнього результату відповіді (фаза 20).

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
            advice = OptimizeText(reg.lastClosed, compacted, notes = len(reg.notes))   # SP_CTX_02_29; заміни з тегів уже застосовано цим пакетом і названо у звіті
        CATCH err:                                                            # OPTIMIZE_BUILD_FAILED
            IF compacted AND q.reportResume: on the queue chain: optimize = false; status line "context-editor: optimization turn not started: <err>"; RETURN Resume(q, turns0)   # пакет просив продовження
            status line "context-editor: optimization turn not started: <err>; the advice goes with your next prompt"; RETURN   # optimize лишається true для DeliverReport
        IF MovedSince(turns0): PersonFirst(q); RETURN                         # повторна перевірка перед заміною: людина могла почати хід за час команди
        swapped = on the queue chain: re-read Queue; IF optimize = true: optimize = false, optimizePrompted = true; IF len(edits) > 0: resume = false, resumeSet = false; write; RETURN true; ELSE RETURN false   # порівняння-і-запис; пакет, що лишився (компактизацію покинуто), продовження не зберігає (SP_CTX_DEC_16)
        IF NOT swapped: PersonFirst(q); RETURN                                # DeliverReport уже віддав пораду з промптом людини і зняв optimize: нічого не надсилати
        TRY entered = submit prompt ((report ? report + "\n\n" : "") + advice)   # власний текст продовження черги не пересилається: продовження вирішує агент у ході оптимізації
            IF entered (no drop):
                IF report: lastSubmittedReportId = q.reportId; on the queue chain: RemoveDelivered(report)
        CATCH (exception or result with drop):                                # OPTIMIZE_FAILED
            on the queue chain: optimizePrompted = false, optimize = true      # зворотна заміна одним записом
            status line "context-editor: could not start the optimization turn; the advice goes with your next prompt"

    PersonFirst(q): IF q.report: lastSubmittedReportId = q.reportId           # звіт і порада — з промптом людини (DeliverReport); промпту немає

Чергу пишуть обробник компактизації ([SP_CTX_02_07](#SP_CTX_02_07)) і, після прийнятого промпту, RemoveDelivered самого Flush ([SP_CTX_02_08](#SP_CTX_02_08)) — обидва на ланцюжку черги. Хост ставить команду в чергу і виконує, коли сесія вільна, з `trigger: 'manual'` і `instructions = MARKER`, і викликає обробники всіх розширень, разом із самим модом ([C_CTX_01_02](./context_editor.concept.md#C_CTX_01_02)); рядки самої команди (`/compact <MARKER>` і позначка виконання) лишаються в розмові з міткою як є: у терміналі хост пише їх повз подію додавання рядка, тож сховати мітку неможливо (спайк context_editor_handoff_long, Entry 4, «Мітка в рядках команди»; навичка plugin-hooks, пункт 24), а текст мітки самопояснювальний ([SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12)). Відмова хоста остаточна, тож повторів немає: черга лишається до наступного завершеного ходу. Хід, що почався від планування, означає, що людина активна. Перед командою Flush її не запускає: команда, поставлена в чергу за ходом, могла б пережити модуль (див. залишкове вікно в [SP_CTX_05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02)), а правки застосує наступний кінець ходу. Якщо хід почався вже після перевірки, Flush не перебиває людину промптом продовження, і звіт дійде з її наступним промптом. Звіт у промпт продовження вписує сам Flush: хост пропускає власні хуки `prompt.submit` плагіна для промптів, які той надсилає через `$.prompt.submit` («prompt.submit skipped: re-entry (the plugin's own code raised it)»; Verify фази 10, 2026-10-09, F1), тож DeliverReport ([SP_CTX_02_08](#SP_CTX_02_08)) до промпту продовження звіту не додасть. Звіт прибирається з черги лише після того, як промпт увійшов; відхилений промпт лишає звіт для наступного промпту людини. Запуск команди завершується після того, як обробник відповів, тож наступне читання черги бачить звіт цього застосування (черга записана до відповіді обробника); рядків розмови Flush не читає ні для продовження, ні для промпту ходу оптимізації, тож запізнення рядків у неінтерактивному хості (F2, [SP_CTX_02_24](./context_editor.handoff.sp.md#SP_CTX_02_24)) його не стосується: промпт ходу оптимізації не називає індексів, а перегляд, який агент робить у ході оптимізації перед правками за індексами, читає поточну розмову ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) пізніше, коли рядки вже стоять у читанні; заміни з тегів для мітки DetectOptimize ставить ще до компактизації, на рядках ходу з міткою; це очікування обов'язково перевіряє сценарій «Завершення команди після обробника» в обох хостах ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)). Відповідь `skip` обробника не є відмовою хоста: причина видна людині рядком «Not compacted».

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

Хід оптимізації ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02), «Мітка оптимізації в тексті»). Мітку помічає DetectOptimize ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)): він закриває блок у реєстрі (`lastClosed`) і на кінці ходу з міткою — коли всі рядки ходу вже на місці, а компактизації ще не було — ставить у чергу заміни з тегів `disposable` тим самим пакетом, що й правки агента цього ходу. Flush застосовує непорожню чергу як завжди, а потім, замість промпту продовження цього кінця ходу, надсилає один промпт ходу оптимізації: звіт застосування (якщо є), назву блоку, ListHint, STAGE_ADVICE і пораду про продовження. Власний текст продовження черги (`reportPrompt`) не пересилається: хід оптимізації — звичайний хід, і чи продовжувати після застосування його правок, агент вирішує налаштуванням `resume` свого `context_edit`, як завжди ([C_CTX_DEC_03](./context_editor.concept.md#C_CTX_DEC_03)), але за замовчуванням пакет ходу оптимізації не продовжується: без явного `resume` і без `resume_prompt` він стає `resume = false` ([SP_CTX_02_02](#SP_CTX_02_02), [SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16)), бо мітку ставлять, завершуючи хід для людини; агент, що зупинився посеред роботи лише заради оптимізації, передає `"resume": true` або `resume_prompt`, і OptimizeText це називає. Після пакета без продовження Resume нічого не надсилає (`reportResume = false`), а звіт іде прихованим контекстом наступного промпту людини (DeliverReport, [SP_CTX_02_08](#SP_CTX_02_08)) — лише звіт, без `reportPrompt`: текст продовження DeliverReport не пересилає ніколи. Рядків розмови Flush не читає: з реєстру він бере лише назву блоку; індексів, розміру і кандидатів промпт не має ([SP_CTX_DEC_15](./context_editor.sp.md#SP_CTX_DEC_15)): після застосування індекси попереднього перегляду вже не діють (`listedKey`, [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)), а в неінтерактивному хості повернені рядки з'являються в читанні із запізненням (F2), тож межі блоку агент бачить у перегляді — з позначками `[block ▶ …]` і `[block end]` ([SP_CTX_02_01](#SP_CTX_02_01)). Між першою перевіркою `MovedSince` і відправкою минає команда компактизації; за цей час промпт людини може пройти DeliverReport, віддати звіт і пораду і зняти `optimize`. Тому Optimize перевіряє `MovedSince` ще раз безпосередньо перед заміною і робить саму заміну (`optimize` → `optimizePrompted`) порівнянням-і-записом на ланцюжку черги: `optimize` уже `false` — нічого не надсилається. Залишкове вікно — промпт людини між заміною і відправкою: промпт ходу оптимізації стає в чергу за ходом людини, а DeliverReport знімає `optimizePrompted` (між ходами), тож мітка того ходу знову діяла б — прийнятий ризик. Запобіжник петлі: мітку у відповіді ходу оптимізації DetectOptimize ігнорує за `optimizePrompted` і знімає прапорець. Дві компактизації бувають лише тоді, коли черга ходу з міткою була непорожня (агент і правив, і поставив мітку, або були теги `disposable`): перша застосовує пакет ходу з міткою, друга — правки ходу оптимізації ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02)). Промпт ходу оптимізації надсилається з тієї самої відкладеної дії після `turn.complete`, що й промпт продовження; без команди перед ним він запускає новий хід у неінтерактивному хості з потоковим входом (навичка plugin-hooks, пункт 38), а в терміналі це перевіряє живий сценарій «Мітка оптимізації» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)).

### 02_07. HandleCompaction  {#SP_CTX_02_07}

> **Criticality:** core

Purpose: обробник події компактизації в моді: застосувати чергу для MARKER, засіяти нову сесію для HANDOFF_MARKER.

Input: подія компактизації з `trigger`, `instructions`, `messages: list<Row>`, `agentId?`. Збіг — за `instructions` і відсутністю `agentId`, за будь-якого `trigger`, крім `precompute` (попереднє обчислення нічого не встановлює, як і в спостерігача [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)): команда компактизації, яку запускає мод, приходить з `trigger: 'manual'` ([SP_CTX_02_06](#SP_CTX_02_06)).

Processing logic (pseudocode):
    ON compaction (any trigger):
        IF agentId present OR trigger = precompute OR instructions NOT IN (MARKER, HANDOFF_MARKER): pass to next handler
        IF instructions = HANDOFF_MARKER: RETURN HandleSeed(messages)          # SP_CTX_02_26
        IF storage unavailable: RETURN skip "storage unavailable"
        q = read Queue; IF state = unreadable: RETURN skip "queue unreadable"
        IF q.edits empty: RETURN skip "no queued edits"
        IF q.handoff present: RETURN skip "handoff pending"            # правки належать передачі (SP_CTX_02_21)
        reg = read TagRegistry (unreadable → every edit failed "tag registry unreadable")
        (edits, refused) = ScreenPinned(messages, q.edits, reg); refused → failed   # SP_CTX_02_03: pin і state одним кроком, як у BuildSeed
        api = read main conversation in Messages API form
        (found, knownResults, unmatchedPromptMedia, apiTruncated) = CollectMedia(api, messages); mediaOwners = keys(found)
        id = now (ms); media = {}; n = 0
        FOR owner IN owners whose media the edits replace:
            FOR ref IN found[owner]:
                n += 1; path = <storage>/<id>/<n>.<ext>
                IF ref.data absent OR writing fails: drop media[owner]; BREAK      # ApplyEdits fails its edits
                media[owner] += path
        archive = <storage>/<id>.json
        (rows, report, renamed, prefix) = ApplyEdits(messages, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia, apiTruncated, freeze = q.keepCache ? { api } : none)   # SP_CTX_02_04 FrozenPrefix лише на вибір агента (SP_CTX_DEC_22); типово prefix = 0, як до фази 23
        frozen = messages[0..prefix)                                   # ті самі рядки; кеш промпту тримається до них
        IF report.originals not empty AND writing archive (compact JSON, through a host command) fails:
            IF the dispatch was abandoned: RETURN skip "compaction abandoned"
            write Queue with every edit failed "originals could not be archived" (report and kept fields as below)
            RETURN skip "originals could not be archived"                 # оригінали не зникають без архіву
        deliveries = read QueuedDeliveries on the deliveries chain (unreadable → none; report.deliveries.unreadable = reason)   # SP_CTX_01_22, фаза 20
        (rows, report.deliveries, done, added) = InsertDeliveries(messages, rows, deliveries, renamed, allRebuilt = false, goes = r ∉ frozen AND r holds only own results)   # SP_CTX_02_36: до DropOwnCalls; done — uuid записів, що більше не потрібні; added — розмір вставлених рядків; рядок префікса не «піде»: DropOwnCalls його не чіпає
        (rows, report.ownCallsRemoved) = DropOwnCalls(rows, mediaOwners, knownResults, frozen); report.charsAfter = Σ size(rows) − added   # повернений список уже пройшов KeepResponsesWhole; лічильник — для речення P13 (SP_CTX_01_05); доставки — не звільнене місце
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
        lastApply: the request size read before the apply (plain $.session.usage().context.tokens, 1–3 ms, no breakdown, bounded by a short timeout like hostId — the handler never waits longer; absent or late → nothing) goes into TagRegistry.lastApply = { at: id, tokensBefore } with RebindTags   # SP_CTX_02_28: виміряна зміна
        in the background, on the journal chain: JournalApply(id, report, archive, messages, edits)   # SP_CTX_02_31; не затримує відповіді
        in the background, on the deliveries chain, IF done not empty: re-read QueuedDeliveries; IF not unreadable: remove the items whose uuid is in done; write   # SP_CTX_02_36: вставлені, згорнуті й зниклі записи йдуть, записані тим часом лишаються; збій запису — повторну вставку відсікає перевірка «уже рядок»
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

Справжнє підсумовування для компактизації з MARKER або HANDOFF_MARKER не запускається за жодної гілки обробника: кожна гілка відповідає або списком рядків, або `skip`, а гілка збою відповідає `skip` одразу, не чекаючи запису черги. На цьому стоїть [C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09): команду з міткою запускає лише код того самого модуля, тож обробник завантажений, коли вона приходить. Якщо хост відкидає повернений список (збій хука після відповіді), спрацьовує гілка збою: звіт про збій дописується після вже записаного звіту і повідомляє, що розмову не змінено. Обробник не відправляє промпт і не чекає на нього ([SP_CTX_DEC_04](./context_editor.sp.md#SP_CTX_DEC_04)). Компактизація з іншими інструкціями (зокрема `/compact` людини) іде далі без змін; її межу записує спостерігач [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18). Людина, що введе `/compact` з текстом MARKER, отримає те саме, що й запуск мода.

Кожен запис черги цього обробника (застосування, відмова архіву, гілка збою) змінює лише пакет і поля звіту, а `optimize` і `optimizePrompted` переносить без змін ([SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04)): у ході з міткою і непорожньою чергою Flush читає чергу після команди і мусить побачити `optimize`, інакше хід оптимізації не запустився б.

### 02_08. DeliverReport  {#SP_CTX_02_08}

Purpose: довести звіт до агента рівно один раз з промптом, який мод не надсилав сам; тим самим промптом довести назву блоку й пораду запиту оптимізації, якого не вдалося виконати ходом оптимізації, інструкцію на початку сесії ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) і між ходами — пропозицію каналу ходу м'якого нагадування ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37), фаза 23).

Processing logic (pseudocode):
    ON prompt submitted (main conversation, passes the mod's hooks):
        context = []
        IF storage ready AND TagRegistry.introduced = false (state ok or missing): context += INTRO_TEXT            # SP_CTX_02_27
        q = read Queue
        IF q.report: context += q.report
        IF q.optimize:                                                      # хід оптимізації не відбувся (HOST_REFUSED, PERSON_MOVED після перерваного ходу, OPTIMIZE_PERSON, OPTIMIZE_FAILED, OPTIMIZE_BUILD_FAILED, перезавантаження модуля)
            reg = read TagRegistry (now, at hook time)
            IF reg readable AND reg.lastClosed present:
                TRY context += PersonAdvice(reg.lastClosed, notes = len(reg.notes))   # SP_CTX_02_29: без індексів, розміру і кандидатів; рядків не читає; заміни з тегів уже поставив DetectOptimize
                CATCH: advice skipped                                       # ADVICE_FAILED: одна спроба
            # реєстр unreadable або lastClosed відсутній — поради немає (ADVICE_NO_BLOCK)
        IF NOT inTurn AND NOT q.optimize:                                   # фаза 23: порада запиту оптимізації вже каже, що стискати
            line = Bounded(TurnSuggestion(), HINT_WAIT)                     # SP_CTX_02_37; стан пропозиції записано до входу промпту
            IF line: context += line                                        # останньою; збій — промпт іде без неї
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
| SUGGESTION_LOST | нижчий обробник відхилив промпт, що ніс пропозицію | її стан уже записано: пропозиція не повторюється до нової серії позначених виводів (фаза 23) |
| INTRO_NOT_RECORDED | `introduced = true` не записалось після прийнятого промпту | інструкцію буде додано й до наступного промпту (щонайменше один раз); реєстр `unreadable` — інструкції немає взагалі, бо її доставку нема де записати |

Промпти, які мод надсилає сам (`$.prompt.submit`: продовження Flush, хід оптимізації, Deliver передачі), цих хуків не проходять — хост пропускає для них власні хуки `prompt.submit` плагіна (Verify фази 10, 2026-10-09, F1). Тому такі промпти несуть звіт у власному тексті, а DeliverReport служить лише промптам людини (зокрема коли продовження вимкнено або людина вже почала хід). Збій кроку не впливає на промпт.

Пропозиція з промптом людини (фаза 23, [SP_CTX_DEC_23](./context_editor.sp.md#SP_CTX_DEC_23)). Між ходами (`inTurn = false`) і без `optimize` DeliverReport питає TurnSuggestion ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37)) не довше HINT_WAIT і додає її рядок останнім: кінець ходу — природна межа пакета, тож агент бачить пропозицію («close stage X and summarize …? It frees …») на початку наступного ходу, разом із завданням людини, і вирішує сам. Повідомлення людини посеред ходу (`inTurn = true`) пропозиції не несе: хід ще триває. Промпти, які мод надсилає сам, хука не проходять, тож пропозиція не приходить ні з продовженням, ні з ходом оптимізації. На відміну від звіту, стан пропозиції записується до входу промпту (претензія порівнянням-і-записом, як у каналу розміру): відхилений промпт її губить (SUGGESTION_LOST) — це м'який сигнал, а повтор з кожним промптом був би шумом. Рядків розмови й розбивки канал ходу не читає, доки від минулої пропозиції не набралося HINT_RUN позначених виводів, тож звичайний промпт людини чекає лише двох малих читань реєстрів.

Порада з промптом людини. Якщо `Queue.optimize` є, коли промпт людини проходить хук (хост відхилив команду компактизації — HOST_REFUSED; хід почався від планування, а після перерваного ходу Flush не планується знову — PERSON_MOVED; людина почала хід раніше, ніж Flush надіслав промпт ходу оптимізації — OPTIMIZE_PERSON; промпт ходу оптимізації відхилено — OPTIMIZE_FAILED; текст ходу оптимізації не зібрався — OPTIMIZE_BUILD_FAILED; гаряче перезавантаження скасувало заплановану дію Flush), DeliverReport додає PersonAdvice — назву блоку `lastClosed`, STAGE_ADVICE і вказівку спершу викликати `context_list` ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)); індексів, розміру і кандидатів порада не має ([SP_CTX_DEC_15](./context_editor.sp.md#SP_CTX_DEC_15)), тож вона не застаріває, коли Flush пізніше застосує правки, що ще в черзі (зокрема заміни з тегів, якщо команду відхилено). Для поради DeliverReport читає лише реєстр і чергу, рядків розмови не читає; нічого в чергу DeliverReport не ставить: заміни з тегів `disposable` для мітки вже поставив DetectOptimize на кінці ходу з міткою ([SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)), тож на запасному шляху вони не губляться. `optimize` знімається, коли промпт увійшов, — з порадою чи без неї (збій побудови поради не повторюється з кожним промптом). `optimizePrompted` знімає промпт людини, що проходить хук між ходами (`inTurn = false`, лічильник ходів преамбули 02): людина взяла хід, і мітка в наступній відповіді агента знову діє. Повідомлення людини посеред ходу оптимізації вливається в цей хід і проходить хук при `inTurn = true`, тож прапорця не чіпає; після перезавантаження модуля `inTurn` починається з `false`, і таке повідомлення зняло б прапорець — тоді мітка у відповіді ходу оптимізації дала б ще один хід оптимізації (прийнято: петлі немає, бо наступний промпт ходу оптимізації знову ставить прапорець).

### 02_09. Nudge (вилучено)  {#SP_CTX_02_09}

Вилучено 2026-10-10: автоматичного нагадування за розміром контексту немає ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15), B). Поріг усього запиту спрацьовував, коли звільняти було нічого (незмінна частина в розширенні VS Code — близько 70 тисяч токенів), і відволікав агента на кількість повідомлень. Оптимізацію запускає лише рішення агента — закриття етапу ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)) або мітка оптимізації ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)); розмір агент бачить у телеметрії на запит ([SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)), а про можливість дізнається з інструкції на початку сесії ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)). Хук викликів ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)) після звичайних викликів інструментів нічого, крім рядка псевдоніма, не додає; константи NUDGE_FIRST і NUDGE_STEP і змінна `nudged` вилучені; заміни з тегів ставить у чергу закриття етапу і хід оптимізації ([SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)). З фази 22 (перегляд C_CTX_DEC_15, E) хук додає м'яке нагадування ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37)). Від Nudge воно відрізняється тим, що ніколи не ставить замін у чергу і нічого не просить: називає конкретних ще не стиснутих кандидатів з розмірами, частку вікна і ціну кешу; мовчить без досить кандидатів; міряє рядки розмови (MESSAGES_ROW), а не весь запит; і має другий момент — перший запис файлу після серії позначених виводів. Фаза 23 ([SP_CTX_DEC_23](./context_editor.sp.md#SP_CTX_DEC_23)): рядок — окремий, з префіксом SUGGESTION і вердиктом вигідності за ціною кешу ([SP_CTX_02_38](./context_editor.stages.sp.md#SP_CTX_02_38)), поріг розміру — 150 тисяч рядків розмови (не більше 35% вікна), а другий момент — не перший запис файлу, а наступний промпт людини після серії позначених виводів.

### 02_10. CollectMedia  {#SP_CTX_02_10}

Purpose: знайти медіа-ресурси розмови, яких немає в Row.

Input: `api` — основна розмова у форматі Messages API, як її повертає читання розмови з поданням `api` (до ROW_WINDOW повідомлень від останньої межі, починається з повідомлення `user`); `rows` — рядки розмови, що закінчуються там само, де `api`: CurrentRows ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) для `context_list`, `context_edit` і звіту закриття етапу, `e.messages` для HandleCompaction ([SP_CTX_02_07](#SP_CTX_02_07)), видимі рядки для BuildSeed ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)); власник `{row}` — індекс у цьому самому `rows`. Output: `found: map<owner, list<MediaRef>>` (не більше записів, ніж медіа-блоків у `api`), `knownResults: set<string>` (усі `tool_use_id` результатів у `api`), `unmatchedPromptMedia: int` (повідомлення людини з медіа, для яких PromptMatch дав «немає»), `apiTruncated: bool` = `len(api) ≥ ROW_WINDOW − 1` (читання API-подання повернуло найбільшу кількість повідомлень, тож старіші могли лишитися поза ним; навичка plugin-hooks, пункт 10). Мінус один — бо подання починається з повідомлення `user`, і хост може відкинути провідне повідомлення асистента після обрізання; хибне спрацювання лише повертає колишню відмову (ApplyEdits, «outside the API window»), а пропуск дав би правку поза поданням.

Processing logic (pseudocode):
    FUNCTION CollectMedia(api, rows):
        FOR block IN tool_result blocks of api:
            FOR inner IN block.content WHERE inner.type IN (image, document):
                result[{tool_use_id: block.tool_use_id}] += MediaRef(inner)
        owners = PromptMatch(api, rows)                     # SP_CTX_DEC_06: api index → row index
        FOR msg AT i IN user messages of api WITH top-level image/document blocks:
            IF i IN owners: result[{row: owners[i]}] += MediaRef(each top-level media block of msg)
            ELSE unmatchedPromptMedia += 1
        RETURN result

    FUNCTION PromptMatch(api, rows) → map<int, int>:        # B з перевіркою A кожної пари (SP_CTX_DEC_06)
        decoration(t) = trimmed-left t starts with one of PROMPT_DECORATIONS   # «<system-reminder» без «>»: рядок вставленої доставки і її текстовий блок у повідомленні з tool_result хід не починають — ні в рядках, ні в API (фаза 20, SP_CTX_02_36)
        commandRow(t) = trimmed-left t starts with "<command-name>" or "<local-command-stdout>"
        squash(t) = t with every whitespace character (\s) removed
        text(msg) = text blocks of msg in order; a string content is one text block
        # (1) хвіст: рядок промпту "/compact <args>" поза ланцюжком (термінал, навичка plugin-hooks, пункт 50)
        IF last(api) is user AND last(rows) is assistant AND squash(join(non-decoration text(last(api)))) starts with "/compact":
            api = api without its last message
        # (3) одиниці — ходи людини
        rowUnits: a unit starts at a user row without toolResults whose text is not a decoration, when there is no unit yet
                  or the current unit already holds an assistant row; every other row joins the current unit (rows before
                  the first start belong to none); lead(unit) = its user rows before its first assistant row
        apiUnits: the same over api, a unit starts at a user message with a text block that is not a decoration, or with
                  a top-level image/document; a message of decorations alone starts nothing (термінал, `@файл`)
        # (4) пари від хвоста
        n = min(len(rowUnits), len(apiUnits)); agreed = 0
        WHILE agreed < n AND Agrees(rowUnits[-1-agreed], apiUnits[-1-agreed]): agreed += 1
        Agrees(ru, au) =
            squash(join(text of user rows of ru that are not decorations)) = squash(join(non-decoration text blocks of user messages of au))
            AND multiset(tool_use_id of toolResults of ru) = multiset(tool_use_id of tool_result blocks of au)
            AND squash(join(text of assistant rows of ru)) = squash(join(text blocks of assistant messages of au))   # thinking не входить
            AND multiset(tool_use_id of toolUses of ru) = multiset(id of tool_use blocks of au)
        # (5) довіра
        failedAtStart = agreed < n AND apiUnits[-1-agreed] starts at api[0]          # підсумок вбудованої компактизації чи початок вікна
        FOR k IN 0..agreed-1 WHERE k + 1 < agreed OR agreed = n OR failedAtStart:
            head = first message of apiUnits[-1-k]
            # (6) власник
            IF head has a top-level image/document AND no tool_result block:
                owners = rows of lead(rowUnits[-1-k]) that are user rows without toolResults, not commandRow, not decoration
                IF len(owners) = 1: out[index of head] = index of owners[0]
        RETURN out                                            # (7) решта — «немає»

`MediaRef(block)`: `mediaType` і `data` — з `block.source`, якщо джерело типу `base64`; інакше `data` відсутнє; `bytes` = довжина декодованих даних.

Зіставлення за `tool_use_id` однозначне. Медіа в промптах людини зіставляє PromptMatch ([SP_CTX_DEC_06](./context_editor.sp.md#SP_CTX_DEC_06), спайк [context_editor_media](./context_editor_media.spike.md)): обидва подання закінчуються тим самим ходом, тож ходи людини (одиниці) йдуть парами від хвоста, а текст лише перевіряє кожну пару. Ключем текст бути не може: промпт лише із зображенням має `Row.text = ""` у stream-json, однакові тексти повторюються, а API-повідомлення — це злиття суміжних рядків `user` з вкладеннями хоста. Що бачить хост (2.1.296, обидва хости; навичка plugin-hooks, пункти 47–50): `Row.text` з'єднує текстові блоки без розділювача; в API ті самі блоки дослівні, але з `\n` на стиках злиття — тому порівнюються рядки без пробільних символів; нагадування (`<system-reminder>`) стоять перед блоками промпту, isMeta-нотатка `[Image: source: <шлях>]` — після них, рядки `/compact` і `Compacted` зливаються з наступним промптом разом з блоком `<local-command-caveat>`; у терміналі `@файл` дає окреме API-повідомлення лише з нагадувань. Паралельні виклики рядки пишуть «виклик, результат, виклик», а API зливає їх в одне повідомлення асистента й одне повідомлення результатів — тому одиниця — хід людини, а не відрізок рядків `user`.

«Немає» (медіа йде в `unmatchedPromptMedia`), коли: пара не перевірилась або стоїть за першою неперевіреною (зсув: рядок, якого немає в одному з подань, а також відрізок, обрізаний вікном читання); наступна старша пара не перевірилась не на першому повідомленні API — тоді й ця пара не довірена (одна пара з порожнім текстом промпту не доводить, що зсуву немає); медіа не в першому повідомленні ходу або в повідомленні з `tool_result` (доставка посеред ходу, навичка plugin-hooks, пункт 43); голова ходу має не один рядок людини (два промпти без відповіді між ними). Помилка правила дає «немає», а не чужий рядок; зсув лишається непоміченим лише тоді, коли в сусідніх ходах однакові і промпт, і відповідь, і виклики. Медіа файлу з `@шлях` у терміналі хост кладе в повідомлення промпту — воно належить рядку промпту і зникає разом із перезібраним рядком (навичка plugin-hooks, пункт 44); так само зникають текстові вкладення цього промпту (вміст файлу з `@шлях`, нагадування) — їх `describe` не архівує, а лише попереджає (DESCRIBE_DROPS). PromptMatch рахується і при постановці (`context_edit`), і при застосуванні — на тодішніх рядках; при застосуванні «немає» відхиляє `describe` ([SP_CTX_02_04](#SP_CTX_02_04)). Еталонна реалізація для фікстур — `match_v3` у `.dev_flow/cache/media-spike/match.py`; код — `matchPrompts` у `hooks/media.ts`.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §02 Contracts 02_01–02_10 перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.edits.sp.md](./context_editor.edits.sp.md), якорі без змін |
