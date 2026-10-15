# Редактор контексту агента — Specification: Contracts — доставки хоста посеред ходу

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_35, 02_36 специфікації [SP_CTX](./context_editor.sp.md): RecordDelivery і InsertDeliveries. Читати, коли змінюєте облік повідомлень, що хост доставляє посеред ходу.

## Contents

Розділи цього файлу:

- [02_35. RecordDelivery](#SP_CTX_02_35)
- [02_36. InsertDeliveries](#SP_CTX_02_36)

## 02. Contracts — доставки хоста посеред ходу

### 02_35. RecordDelivery  {#SP_CTX_02_35}

Purpose: записати доставку хоста посеред ходу ([SP_CTX_01_22](./context_editor.records.sp.md#SP_CTX_01_22)) в мить, коли хост проводить її через `session.append`, разом із рядком, за яким вона висить. Фаза 20; [SP_CTX_DEC_19](./context_editor.decisions-01.sp.md#SP_CTX_DEC_19).

Джерело тексту — лише `session.append`: доставка проходить його в обох хостах дверима `delivery` (`type: attachment`, `name: queued_command`, `content` — відрендерений текст), а попередній рядок у порядку подій — рядок-якір з `tool_result`, той самий, що батько запису в транскрипті (спайк, Entry 1–2; навичка plugin-hooks, пункт 43). `prompt.submit` з `turnId` дає лише сирий текст людини без рамки й без якоря і не використовується.

Processing logic (pseudocode):
    memory of the module: lastAnchor: list<string> = []              # результати останнього рядка tool-result основної розмови
    # частина хука session.append AutoTag (SP_CTX_02_12): рядок спершу збережено, хук його не змінює і не затримує
    ON row appended (main loop; agentId absent; the row not denied):
        IF door = tool-result: lastAnchor = tool_use_id of every tool_result block of the row; RETURN
        IF door IN (prompt, response): lastAnchor = []; RETURN        # промпт (і рядок, вставлений модом, у stream-json) чи відповідь моделі: наступна доставка висіла б уже не за тим результатом
        IF door = delivery AND message.type = attachment AND message.name = queued_command:
            text = the text blocks of message.content joined with "\n"; media = count of the other blocks
            IF lastAnchor empty OR text blank after trim: RETURN      # не спостерігалось (35 з 35 — за рядком з tool_result); не записується
            item = { uuid: event uuid, anchor: lastAnchor, kind: DeliveryKind(text), origin: origin.kind or "?",
                     text: CutDelivery(text).text, cut: CutDelivery(text).cut, media, at: now }
            in the background, on the deliveries chain, IF storage ready:
                read QueuedDeliveries; unreadable → move the file aside to deliveries.json.bad-<ms> and start empty (the move fails → record nothing: the unreadable file is never overwritten)
                IF some item has text = item.text AND shares an id with item.anchor: RETURN   # копія після компактизації (stream-json)
                append item; drop the oldest items while there are more than MAX_DELIVERIES or the file would exceed MAX_QUEUE_BYTES; write
        # інші двері (note, tool-message, attachment інших назв) lastAnchor не змінюють: ланцюжок доставок за одним результатом ділить якір

    FUNCTION CutDelivery(full, max = MAX_DELIVERY_TEXT) → { text, cut }:  # аудит PL_AUD_CTX, CF-9
        IF len(full) ≤ max: RETURN { text: full, cut: 0 }
        framed = trimmed start of full starts with REMINDER_PREFIX           # рамка хоста <system-reminder…>
        Closing(head) = framed ? for each tag head opens and does not close, innermost first, for which full has a closing tag "</name" + (">" or whitespace … ">") ending after the cut (a tag split by the cut counts): "\n" + the first such tag exactly as full writes it (with its attributes) : ""
        head = full[0 : max]
        WHILE len(head) + len(Closing(head)) > max: head = full[0 : max − len(Closing(head))]   # кожен прохід коротшає голову
        cut = len(full) − len(head)
        RETURN { text: head + "… [context-editor: <cut> chars cut]" + Closing(head), cut }

Хости. Термінал: копії рядків після компактизації (і вкладення за рядками з `handle`) оминають `session.append` (пункт 24), тож копій доставок немає. Stream-json: копія рядка-якоря приходить дверима `tool-result`, за нею копія доставки — дверима `delivery`; запис відсікає перевірка пари (`text`, `anchor`). Рядок, який вставив InsertDeliveries, у stream-json приходить дверима `prompt` з походженням плагіна: він скидає `lastAnchor` і доставкою не є. Подія субагента (`agentId`) не чіпає ні пам'яті, ні файлу.

Обрізання в рамці (аудит PL_AUD_CTX, CF-9). Застосування повертає доставку рядком `user` ([SP_CTX_02_36](#SP_CTX_02_36)), і модель відрізняє її від слів людини лише за рамкою хоста. Тому довга доставка обрізається всередині тіла, а не з кінця тексту: після позначки обрізання йдуть закривальні теги, які обрізання забрало (`</system-reminder>`, для звіту субагента спершу `</agent-message>`), найглибший першим. Тег іде назад лише тоді, коли повний текст справді закриває його після місця обрізання, тож `<br>` чи `Array<string>` у тексті людини зайвих тегів не дають, а тег, розрізаний навпіл, закривається один раз цілим. Закривальний тег — `</name`, за яким `>` або пробільний символ і далі до `>`, і назад він іде дослівно, як у повному тексті: термінал загортає вставлений людиною текст у `<pasted_content id="…">…</pasted_content id="…">`, з атрибутом і на закривальному тезі (живий прогін фази 5). Голова звільняє місце для тегів, тож текст не довший за MAX_DELIVERY_TEXT разом із позначкою (у межах запасу 100 символів, який допускає розбір файлу, [SP_CTX_01_22](./context_editor.records.sp.md#SP_CTX_01_22)); `cut` рахує всі символи після голови, разом із закривальним тегом оригіналу. Текст без рамки (не починається з REMINDER_PREFIX) обрізається, як раніше: голова в MAX_DELIVERY_TEXT і позначка.

Межі. Гаряче перезавантаження модуля скидає `lastAnchor`: доставка до наступного рядка `tool-result` не записується (вікно — один виклик інструмента). `/clear` і `/resume`: сховище переходить до нової сесії (PrepareStorage, [SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15)), а `lastAnchor` скидає перший рядок промпту. `--resume` новим процесом: файл сесії лишається, пам'ять нова. Доставка, що прийшла, коли сесія вільна, починає новий хід звичайним промптом-рядком (`door: prompt`) і не губиться — запису не потребує (спайк, Entry 2).

Errors: відмов немає; збій читання, переносу чи запису губить лише цей запис, рядок розмови не змінюється.

### 02_36. InsertDeliveries  {#SP_CTX_02_36}

Purpose: повернути доставки на їхнє місце в списку, що замінює розмову: рядок `user` з текстом доставки одразу після рядка-якоря, коли цей рядок іде без `handle` і хост вкладення за ним не перенесе. Чиста функція. Фаза 20; [SP_CTX_DEC_19](./context_editor.decisions-01.sp.md#SP_CTX_DEC_19).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| before | list<Row> | yes | рядки, до яких застосовано правки: `e.messages` компактизації або видимі рядки засіву |
| rows | list<Row> | yes | вихід ApplyEdits ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) |
| items | list<QueuedDelivery> | yes | у порядку файлу; порожньо, коли файлу немає чи він не прочитався |
| renamed | map<string, string> | yes | вихід ApplyEdits: `tool_use_id` застосованої `summarize` → FreshId |
| allRebuilt | bool | yes | `true` у засіві: жоден засіяний рядок не має `handle` |
| goes | функція (Row) → bool | no | типово «ні»; у HandleCompaction — рядок з результатами лише службових викликів (OWN_TOOLS) поза замороженим префіксом: поза вікном API він лишається з `handle`, але DropOwnCalls його прибере; рядок префікса DropOwnCalls не чіпає (фаза 23) |

Output: `{ rows, counts: { inserted, removed }, done: set<string>, added: int }`; `done` — `uuid` записів, які більше не потрібні; `added` — сума розмірів вставлених рядків.

Processing logic (pseudocode):
    FUNCTION InsertDeliveries(before, rows, items, renamed, allRebuilt, goes):
        FOR item IN items (file order):
            IF no row of before holds a result whose id is in item.anchor: done += item; CONTINUE   # якір до межі або зник після вбудованої компактизації
            IF a user row with item.text stands right after that row, past result-less user rows only: done += item; CONTINUE   # уже рядок (вставлено раніше, запис не видалився); той самий текст деінде — інша доставка (рев'ю 48)
            ids = item.anchor ∪ { renamed[id] : id ∈ item.anchor }
            k = the index in rows of the row that holds a result whose id is in ids
            IF k absent: removed += 1; done += item; CONTINUE                  # якір прибрано (drop) або згорнуто (collapse): доставка йде з ним; людину попереджено при постановці (SP_CTX_02_02)
            IF rows[k] has handle AND NOT allRebuilt AND NOT goes(rows[k]): CONTINUE   # вкладення переносить хост; вставка дала б дубль (пункт 44); запис лишається. goes — рядок лише службових результатів, який DropOwnCalls прибере (рев'ю 48)
            insert Row { role: user, text: item.text, toolUses: [] } right after rows[k] and after the rows already inserted after it
            inserted += 1; added += size(item.text); done += item
        RETURN rows, { inserted, removed }, done, added

Чому одразу після якоря. Хост зливає рядок результату і наступний рядок `user` в одне повідомлення `user` (`tool_result`, далі текст) без лагодження пар, і модель знову бачить доставку (спайк, Entry 1–2, режим `plain-results-inject`: «PELICAN», «HERON», «TEAL» в обох хостах; без вставки — «NOT-VISIBLE» і відмова від власних слів). Текст лишається відрендереним, з рамкою `<system-reminder…>`; роль — `user` замість системного ходу, як і в пробі. Порядок кількох доставок за одним якорем — порядок запису.

Відповідь не розривається. Хост доставляє чергу після останнього результату відповіді, перед наступним запитом, тож за рядком доставки починається нова відповідь; KeepResponsesWhole (у DropOwnCalls) вважає вставлений рядок промптом — і відповідь через нього справді не йде. Це припущення з даних (35 доставок робочої сесії, кожна за рядком з `tool_result`, спайк — без паралельних викликів); перевіряє сценарій 05_03 «Доставки посеред ходу» з паралельними викликами — без `ensureToolResultPairing` у журналі.

Де викликається. HandleCompaction — після ApplyEdits, до DropOwnCalls ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)): доставка за результатом службового виклику лишається на місці, коли DropOwnCalls прибирає його рядки ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)). BuildSeed — так само, з `allRebuilt = true` ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)). Produced, NowIndex, RebindTags і межа поточної розмови бачать список уже з вставленими рядками; `charsAfter` їх не рахує ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)). Межа етапу «після рядка-якоря» робить рядок доставки першим рядком блоку, а кінець блоку на якорі лишає доставку наступному блоку — прийнято: модель бачила доставку саме після цього результату.

Заморожений префікс (фаза 23, [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)). Рядок результату до відповіді першої зміни повертається з `handle`, тож доставка за ним не вставляється, а їде з ним — тим самим системним повідомленням, що й до застосування: байти префікса й кеш промпту лишаються. Запис такої доставки лишається у файлі до застосування, яке перезбере її якір.

Після вставки доставка — звичайний рядок: `context_list` її показує, `collapse` може її згорнути, PersonText бачить у доставці від людини її слова ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)), PromptMatch вважає її прикрасою (PROMPT_DECORATIONS), а наступне застосування повертає її з `handle`, як будь-який рядок `user` без результатів. Медіа доставки (`media` > 0) не переноситься: рядок несе лише текст.

Errors: відмов немає.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділи перенесено дослівно з [context_editor.stages.sp.md](./context_editor.stages.sp.md): поділ файлу за модулями, якорі ті самі (structural-event) |
