# Редактор контексту агента — Specification: курування історії — рядки хоста

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-17
> **Updated:** 2026-10-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md); частина [курування історії](./context_editor.curation.sp.md)
> **Concept:** [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)
>
> Частина курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)) специфікації [SP_CTX](./context_editor.sp.md): записи рядків хоста (`isMeta`), їх запис при `session.append`, список з `id` у `context_list`, `drop` з `host` і життєвий цикл запису. Читати перед зміною `hooks/hostrows.ts`.

## Contents

Розділи цього файлу (h3 розділів курування; решта — у [курування історії](./context_editor.curation.sp.md)):

- [01_31. HostRows](#SP_CTX_01_31) — записи рядків хоста у `hostrows.json`
- [02_60. RecordHostRows](#SP_CTX_02_60) — запис рядків хоста при `session.append` і їх збереження після застосування
- [02_61. HostList](#SP_CTX_02_61) — список рядків хоста з `id` у `context_list` і `drop` з `host`
- [04_09. Host Row Record Lifecycle](#SP_CTX_04_09) — життєвий цикл запису рядка хоста

## 01. Data Structures — курування

### 01_31. HostRows  {#SP_CTX_01_31}

Записи рядків хоста ([C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11), [SP_CTX_DEC_42](./context_editor.curation.sp.md#SP_CTX_DEC_42)). Файл `<storage>/hostrows.json`, послідовний ланцюжок `hostrows` рангу 4 — поряд із `deliveries`, `journal`, `hostattach`, `ledger`, без вкладення з ними ([SP_CTX_02](./context_editor.sp.md#SP_CTX_02)). Пише лише мод.

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

## 02. Contracts — курування

### 02_60. RecordHostRows  {#SP_CTX_02_60}

Purpose: записати рядок хоста в мить, коли хост його додає, з `handle` видимого рядка перед ним, щоб список показав його агенту, а правка `drop` могла його прибрати ([C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11), [SP_CTX_DEC_42](./context_editor.curation.sp.md#SP_CTX_DEC_42)).

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

Purpose: показати записані рядки хоста агенту окремим списком з `id` і прибирати їх правкою `drop` за `id`, повертаючи рядок перед ними без `handle` ([SP_CTX_DEC_42](./context_editor.curation.sp.md#SP_CTX_DEC_42)). Серед рядків перегляду їх немає: індекси, ключ переліку, діапазони й теги лишаються такими, як без курування.

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

Наслідки в наявних контрактах. Перелік ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)) додає рядок заголовка й секцію списку; позначок рядків хоста серед рядків немає, і Key() ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) не змінюється. Правка `drop` бере нову ціль `host` ([SP_CTX_01_30](./context_editor.curation.edits.sp.md#SP_CTX_01_30)). Рядок хоста не буває ціллю `collapse`, `summarize`, `rewrite`, `describe` чи тегу: його немає серед рядків, а згортання рядка перед ним забирає його з собою, і звіт про це каже.

Текст навички, яку відкрив інструмент `Skill`, — рядок хоста за рядком результату «Launching skill» (навичка plugin-hooks, п. 46; порядок дверей щодо цього рядка наживо не перевірено, SP_CTX_05_07). Перебудова незмінних рядків результатів ([SP_CTX_DEC_02](./context_editor.decisions-01.sp.md#SP_CTX_DEC_02)) повертає цей рядок без `handle`, тож перше ж застосування без `keep_cache` забирає текст навички, а повторний `Skill` хост не вставляє. Звіт називає такий запис серед рядків, що пішли з перебудованими; як зберегти таку навичку, вирішує пункт backlog PL_CTX «Навичка, відкрита інструментом `Skill`, зникає після застосування».

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| HOST_UNKNOWN | `drop` з `host`, якого немає у файлі | `no host row <id>; context_list names them` |
| HOST_MEDIA | рядок перед рядком хоста має медіа, чи це промпт при неспівставлених медіа промптів (перевіряється при застосуванні: у перегляді `handle` немає) | `the row before <id> holds media that would be lost; describe or summarize it first` |
| HOST_EXCLUSIVE | `drop` має `host` разом із `tool_use_id` чи `ref` | `edit <n>: host excludes tool_use_id and ref` |
| HOST_TWICE | той самий `id` двічі в пакеті | `edit <n>: host row <id> is already in this batch` |

Межа: два процеси хоста на одній сесії пишуть файл кожен під своїм ланцюжком, як і інші файли сховища ([SP_CTX_DEC_10](./context_editor.decisions-01.sp.md#SP_CTX_DEC_10)). Номер `h<n>` береться з поля `next` файлу під ланцюжком, тож у файлі повторів `id` немає (файл із повтором — нечитабельний); одночасні записи двох процесів дають той самий номер, і виграє останній записувач: запис іншого процесу губиться, а його рядок хоста не потрапляє до списку.

Реалізація (фаза 45). Список будує `contextList` (`hooks/stages.ts`) з `hostHeader` і `hostSection`; рядок заголовка стоїть після телеметрії. `drop` з `host` — окремий варіант Edit `{ op: 'drop', host }` (`isHostDrop`, `isPairEdit` у `edits.ts`); `id` не тієї форми відхиляє checkShape (`host is the id of a host row from context_list (h1, h2, …)`). HOST_UNKNOWN і HOST_TWICE перевіряє PrepareEdits до перевірок цілі: пін, слот стану й індекси рядка хоста не стосуються. Результат виклику додає `drop <id>: <DetachNote>.`. Detach іде в `applyEdits` після решти кроків. Друга правка того самого попередника в пакеті рахується застосованою без нового рядка звіту; правка, чийого попередника немає у вході («no such row now»), теж називає свій запис, тож рядок про рядки, що пішли, його не повторює. Нечитабельний `hostrows.json` при постановці дає HOST_UNKNOWN: записів, які можна назвати, немає. Рядки звіту (`ApplyReport.hostLines`) стоять після рядка про доставки, кожен закінчується крапкою; рядок DetachNote має вигляд `<id>: <DetachNote>.`. Рядок «Host rows that went with rebuilt rows» рахується на остаточних рядках, після InsertDeliveries і DropOwnCalls: рядок, який перебудувала DropOwnCalls, теж забирає рядки хоста за ним. Засів відбирає правки `drop` з `host` до `applyEdits` і додає їх до застосованих.

## 04. State Transitions — курування

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

## Changelog

| Date | Change |
|------|--------|
| 2026-10-17 | structural-event: розділи 01_31, 02_60, 02_61, 04_09 перенесено дослівно з [context_editor.curation.sp.md](./context_editor.curation.sp.md) (аудит dev-flow, Docs Scaling `hard_split`: 14 640 слів); якорі незмінні |
| 2026-10-17 | Аудит коду (SPEC-17): 02_61 — межа двох процесів: номер `h<n>` з файлу під ланцюжком, повторів `id` у файлі немає, одночасні записи гублять запис одного процесу |
