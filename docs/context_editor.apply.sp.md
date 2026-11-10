# Редактор контексту агента — Specification: Contracts — застосування правок, обробник компактизації, пошук медіа

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
> **Used by:** [курування історії](./context_editor.curation.sp.md) — спирається на [SP_CTX_02_04](#SP_CTX_02_04), [SP_CTX_02_07](#SP_CTX_02_07)
>
> §02 Contracts 02_04, 02_07, 02_10 специфікації [SP_CTX](./context_editor.sp.md): ApplyEdits (перебудова рядків і тексти замін), HandleCompaction (обробник `session.compact` мода), CollectMedia. Читати, коли змінюєте застосування правок.

## Contents

Розділи цього файлу:

- [02_04. ApplyEdits](#SP_CTX_02_04)
- [02_07. HandleCompaction](#SP_CTX_02_07)
- [02_10. CollectMedia](#SP_CTX_02_10)

## 02. Contracts — застосування правок, обробник компактизації, медіа

### 02_04. ApplyEdits  {#SP_CTX_02_04}

> **Курування:** тексти замін з походженням — [SP_CTX_02_62](./context_editor.curation.edits.sp.md#SP_CTX_02_62); `describe` для вставок — [SP_CTX_02_59](./context_editor.curation.edits.sp.md#SP_CTX_02_59); `run state` — [SP_CTX_02_67](./context_editor.curation.slot.sp.md#SP_CTX_02_67); Detach попередника рядка хоста — [SP_CTX_02_61](./context_editor.curation.hostrows.sp.md#SP_CTX_02_61).

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
| apiTruncated | bool | yes | API-подання обрізане вікном: ApiCut(api) = `len(api) ≥ ROW_WINDOW − 1` ([SP_CTX_02_10](#SP_CTX_02_10); один предикат з калібруванням, [SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34)); тоді рядки до першого відомого результату можуть лежати поза поданням |
| freeze | `{ api: list<json> }`? | no | передає лише HandleCompaction ([SP_CTX_02_07](#SP_CTX_02_07)) і лише для пакета з `keepCache`; засів — ні | заморожений префікс (фаза 23, [SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22)): `api` — API-подання тієї самої розмови, з якого ResponseStart бачить межі відповідей |
| newId | `(id) → string`? | no | фабрика FreshId для змінених викликів (`summarize`, носій `collapse`); без неї — FreshId; передають лише тести, щоб ідентифікатори були детерміновані (аудит PL_AUD_CTX, CF-14) |

Output: `{ rows: list<Row>, report: ApplyReport, renamed: map<string, string>, prefix: int }`; `charsAfter` дораховує [SP_CTX_02_07](#SP_CTX_02_07); `renamed` — для кожної застосованої `summarize` її `tool_use_id` → FreshId, з яким пара стоїть у `rows` (читає InsertDeliveries, [SP_CTX_02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36); фаза 20); `prefix` — довжина замороженого префікса: `rows[0..prefix)` — ті самі рядки входу з `handle`; без `freeze` — 0, з `freeze` без застосованої правки — `len(rows)`.

Processing logic (pseudocode):
    FUNCTION ApplyEdits(rows, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia, apiTruncated, freeze):
        note = archive ? " (original: " + archive + ", open with Read)" : ""   # заміна сама каже, як повернути оригінал (C_CTX_DEC_18)
        plan = []
        FOR edit IN edits:                                # позиції — на НЕЗМІНЕНОМУ списку
            resolve touched rows or report.failed += "<edit>: " + reason:     # <edit> — DescribeEdit
                summarize, drop: {useAt, resAt} by tool_use_id; pair = tool_use_id
                    IF the call or the result is not found: failed "call or result not found"
                    IF the result row holds another pair whose owner is in mediaOwners AND that pair is not
                       summarized or dropped in this batch with its media archived:
                       failed "row also holds media of <id>; summarize it in the same batch"
                    IF the result row holds a result whose id is not in knownResults:
                       failed "outside the API window; media unknown"
                collapse: {from..to} via anchors (LocateSpan); IF not found: failed "the rows it named are no longer there"
                    recheck pairing: failed "range #<from>..#<to> splits a tool call from its result (<ids>); widen or narrow it" (як у PrepareEdits)
                    IF the span holds a result whose id is not in knownResults,
                       or (apiTruncated AND the span holds a user row without toolResults before the first row whose result is in knownResults):
                       failed "outside the API window; media unknown"     # без обрізання подання промпт перед першим результатом — звичайний
                    IF unmatchedPromptMedia > 0 AND the span holds a user row without toolResults:
                       failed "span may hold prompt media that cannot be archived; collapse a span without prompt rows"
                rewrite, describe: {at} via anchor; IF not found: failed "the row it named is no longer there"
                    IF describe AND media has no paths for {row: at}: failed ("media could not be archived" IF {row: at} in mediaOwners OR media has the key ELSE NO_MEDIA_NOW)   # медіа цього рядка знайдено (PromptMatch на рядках застосування) і заархівовано саме цим застосуванням; інакше рядок не змінюється
            IF edit replaces media of an owner in mediaOwners AND media has no paths for it: failed "media could not be archived"
            plan += (edit, touched, pair?, hi = max(touched))
        SORT plan BY hi DESC; anyRow = {}; exclusiveRow = {}; pairs = {}
        FOR step IN plan:
            conflict = step.pair ? (step.pair ∈ pairs OR step.touched ∩ exclusiveRow ≠ ∅) : step.touched ∩ anyRow ≠ ∅
            IF conflict: report.failed += "<edit>: overlaps another edit"; CONTINUE
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
        stretches = rows split before every PromptRow   # порожній рядок ще не відфільтровано
        FOR stretch IN stretches:
            IF stretch holds no assistant row without handle (rebuilt or inserted): CONTINUE
            rebuild every assistant row with handle in stretch that is not in frozen   # і до, і після перезібраного; thinking-блоки цих рядків губляться; префікс ResponseStart не ділить відповіді з перезібраним рядком
        RETURN rows                                                                   # рядки результатів — за правилом вище (SP_CTX_DEC_02)

    PromptRow(r) = r is a user row without toolResults AND (r has a handle OR r is not empty)   # рядок результату, який drop лишив порожнім, — не промпт; один предикат для KeepResponsesWhole, Responses, FrozenPrefix і CacheCost (SP_CTX_02_38)
    # PromptRow, EmptyRow («порожній»: без тексту, викликів і результатів) і пошук пари за id мають один дім — L0-модуль `hooks/rows.ts` (PL_AUD_CTX фаза 9, CF-17); ResolveLast (SP_CTX_02_17) бере варіант PromptRowStrict — текст лише з пробілів без handle там не промпт

    FUNCTION Responses(rows, api) → (start, known, floor, message):   # відповіді рядків одним проходом (PL_AUD_CTX фаза 8: одне джерело для ResponseStart і CacheCost)
        message(r) = for an assistant row: the index in api of the assistant message that holds a tool_use id of r, or else the non-empty text of r (whitespace removed); none otherwise   # повертається й сам: CacheShape читає з нього хвіст API-подання (SP_CTX_02_38, 2026-10-12)
        FOR i IN 0..len(rows)−1:
            floor[i] = the index after the last PromptRow before i (0 without one)       # відповідь не перетинає промпту
            assistant row: start[i] = start[i−1] if rows[i−1] is an assistant row else i   # рядки асистента поспіль — одна відповідь
                           IF message(rows[i]) = m was met before, after the last prompt: start[i] = min(start[i], the start where m was first met)   # паралельні виклики «виклик, результат, виклик», текст після результатів: хост злив їх в одне повідомлення
                           known[i] = some row of the run of assistant rows around i has a message
            PromptRow: start[i] = i; known[i] = true                                       # промпт чи доставка — рядок сам по собі
            other user row: k = the earliest row after the last prompt that holds a call of its results
                           k exists → start[i] = start[k], known[i] = known[k]             # рядок результатів — відповідь його викликів
                           none → start[i] = i; known[i] = false                           # результат без виклику, порожній рядок без handle — невідомо
        a response that took a later row in pulls the rows between into it; every start then names the first row of its response
        an empty user row pulled into a response: known[i] = known[start[i]]                 # непритягнутий лишається невідомим: ResponseStart дає початок відрізка, FrozenPrefix не ділить на ньому відповідь
    FUNCTION ResponseStart(rows, at, api):        # перший рядок відповіді моделі, що містить rows[at] (фаза 23; з PL_AUD_CTX фази 8 — за Responses)
        at ≤ 0 → 0; at ≥ len(rows) → len(rows)
        RETURN known[at] ? start[at] : floor[at]                                         # поза вікном API, прогін без викликів і тексту, результат без виклику, непритягнутий порожній рядок: початок відрізка, як KeepResponsesWhole

    run summarize: id' = FreshId(id); use row rebuilt, call gets id' and loses text; result row rebuilt, result gets id' and text SummarizedWords(SourceOf(call), via, quoted)+note+mediaNote(id)+": "+summary   # via = tag (QueuedEdit.via, правка з тегу disposable) → TAG_SUMMARIZED_OF, інакше SUMMARIZED_OF; з фази 41 — "Later, your context_edit summarize call replaced the full output of <source> you had read here with your own summary" (SP_CTX_02_62, SP_CTX_01_28; до фази 41 — SUMMARIZED без джерела); автор, час і власний виклик — SP_CTX_DEC_17 (A″, фаза 28; до неї A′ з MARK)
    run drop: call removed from its row, result from its row; both rows rebuilt; media paths of id go to the report only
    run collapse: span = rows[from..to] → originals; carrier = first call in span whose tool does not start with OWN_TOOLS
        list = CollapsedList(span)                     # фаза 27, SP_CTX_DEC_29
        carrier exists → 2 rows: assistant {text "", toolUses [carrier with id' = FreshId, input {COLLAPSED_KEY: list}, no text]}, user {toolResults [{id', isError false, text T}]}   # назва — інструмент носія; вхід — не аргументи першого виклику, а list
        no carrier → 1 row {role span[0].role, text T, toolUses []}
        T = collapsedWords(n, list, via)+note+mediaNote(all owners in span)+": "+summary   # "Later, your context_edit collapse call replaced these <n> rows you had read (<list>) with your own note"; via = tag → "Later, your context_tag disposable tag replaced these …"
    run rewrite: row text = RewrittenWords(via)+note+": "+text; row rebuilt   # via = tag → TAG_REWRITTEN "Later, your context_tag disposable tag replaced the text of this row with your own note"; REWRITTEN = "Later, your context_edit rewrite call replaced the text of this row with your own rewrite"
    run describe: row text = DESCRIBED+note+mediaNote(row)+": "+description+"\n\n"+original text; row rebuilt   # DESCRIBED = "Later, your context_edit describe call replaced the media you had seen here with your own description"   # вкладення хоста на handle рядка (вміст файлу з @шлях, нагадування) зникають разом із медіа (навичка plugin-hooks, пункт 44); звіт і результат context_edit кажуть це DESCRIBE_DROPS
    mediaNote(owners) = media has paths for these owners ? " (media: "+paths joined ", "+")" : ""

    FUNCTION Produced(final, steps) → list:                         # викликають HandleCompaction після DropOwnCalls і BuildSeed після нормалізації
        RETURN [ (step label, k, fingerprint(final[k])) FOR step IN applied replacing steps WHERE the row step.last refers to (or the row rebuilt from it) stands at index k of final ]

    FUNCTION MergeCallRows(rows, frozen):         # Verify фази 14, D1
        FOR each row r of rows in order:
            IF the row before it (as merged so far) is an assistant row without handle with toolUses AND r is an assistant row without handle AND neither is in frozen:
                merge r into it: text = the two texts joined by a blank line (empty ones left out), toolUses = its calls, then the calls of r
        RETURN rows

Правки пар (summarize, drop) не розрізають рядків, тож кілька правок різних пар на спільних рядках застосовуються послідовно; правки рядків (collapse, rewrite, describe) беруть свої рядки виключно.

Хто і коли написав заміну (фаза 19; [SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17) — A′; живий прогін фази 18, F1). Текст кожної заміни каже, що агент сам бачив оригінал на цьому місці, а потім сам його замінив: `you read the full output here, then replaced it with your summary`, `you read these <n> rows (<що в них було>), then collapsed them into your note` (перелік у дужках — з фази 27, нижче), `you rewrote this row`, `you saw the media here, then replaced it with your description` — і для правок агента, і для замін з тегів `disposable` (нотатку теж написав агент, [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)). Без цих слів haiku після власного `summarize` трьох виводів `cat` на питання «What did you do?» відповідав, що від `cat` отримав «готовий підсумок плагіна» і сирих файлів не перевіряв (`.dev_flow/cache/live-test/phase18-results.md`, F1): заміна стоїть там, де був результат, одразу після виклику, а власний виклик `context_edit` прибирає DropOwnCalls, тож причина — позиційна, і текст мусить назвати і автора, і час. Префікс MARK не змінюється, тож розпізнавання змінених рядків (позначка `*`, R5 (а), PersonText) не зачеплено; CarryNote засіву (`media carried as files`) і рядок псевдоніма (`id cN`) пише мод, а не агент, — їх слова лишаються.

Від імені агента, без позначки (фаза 28; [SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17) — A″; спайк [context_editor_authorship](./context_editor_authorship.spike.md), V6). Тексти A′ вище — історія: з фази 28 текст кожної заміни починається REPLACED (`Later, your context_`), підмет — агент, і названо його власний пізніший виклик `context_edit` (заміни з тегів — `context_tag`, нижче): SUMMARIZED `Later, your context_edit summarize call replaced the full output you had read here with your own summary`, `collapsedWords` `Later, your context_edit collapse call replaced these <n> rows you had read (<перелік>) with your own note`, REWRITTEN `Later, your context_edit rewrite call replaced the text of this row with your own rewrite`, DESCRIBED `Later, your context_edit describe call replaced the media you had seen here with your own description`; далі, як і раніше, `(original: …)`, `(media: …)`, двокрапка і текст агента. Префікса MARK немає: у спайку haiku з тим самим текстом і префіксом `[context-editor]` визнав, що читав оригінал, у 2 з 12 прогонів, а без префікса — у 10 з 17 («the `[context-editor]` lines are the plugin's own wording»); форми із заглушкою на місці результату (підсумок окремим рядком асистента) дали 1 з 13 (haiku) і 0 з 6 (sonnet), бо модель вірить слоту `tool_result` як тому, що повернув інструмент. Будова заміни (пара з новим id, носій `collapse`, рядок `rewrite`/`describe`) не змінюється, тож перевірки хоста фаз 19–27 лишаються в силі; ціна — та сама (слова майже тієї самої довжини). Заміни з тегів `disposable` ставить у чергу мод за тегом агента (QueueTagReplacements, [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)), тож їхні правки несуть `via: "tag"` ([SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03)), і текст називає тег, а не виклик, якого не було (рев'ю фази 28): TAG_SUMMARIZED `Later, your context_tag disposable tag replaced the full output you had read here with your own note`, `collapsedWords(n, list, 'tag')` `Later, your context_tag disposable tag replaced these <n> rows you had read (<перелік>) with your own note`, TAG_REWRITTEN `Later, your context_tag disposable tag replaced the text of this row with your own note`. Живий прогін фази 28 ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Авторство замін від імені агента»): summarize + collapse — haiku (b) «читав сам» 6/9 (A′ — 6/18), sonnet 3/3, (a) 12/12 «написав сам»; `rewrite` — своє; `describe` слабкий — haiku 0/3 каже, що бачило картинку, двоє з трьох відкликають і авторство опису (backlog плану: форма DESCRIBED).

З фази 41 відкривач `summarize` (і `summarize` з тегу) називає джерело заміненого змісту, а `summarize` і `collapse` — Quoted, коли DependencyCheck знайшов цитати ([SP_CTX_02_62](./context_editor.curation.edits.sp.md#SP_CTX_02_62)); тексти SUMMARIZED і TAG_SUMMARIZED вище лишаються в збережених сесіях.

Розпізнавання змінених рядків (ReplacementText, `isReplacementText` у `hooks/rows.ts`, STRUCT-01): текст починається з повного відкривача фази 28 (REPLACEMENT_OPENERS: чотири `context_edit` і три `context_tag`; `describe` — головою DESCRIBED_HEAD з фази 40, `summarize` з джерелом — головами SUMMARIZED_OF і TAG_SUMMARIZED_OF з фази 41) або з MARK. Спільного початку REPLACED (`Later, your context_`) замало: людина, що цитує початок заміни, чи документ репозиторію про неї — не заміна (рев'ю фази 28). Другий випадок — усі заміни до фази 28 (A′ і раніші `[context-editor] summarized …`) і власні рядки мода, що стоять самі (CarryNote результату без тексту): наявні сесії зберігають позначку `*` переліку, R5 (а) ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)), кандидатів м'якого нагадування ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37)) і PersonText ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)) такими, як були. CollapseText (`isCollapseText`) приймає COLLAPSED_OPENER, TAG_COLLAPSED_OPENER і LEGACY_COLLAPSED_OPENER, DescribedText (`isDescribedText`) — відкривачі фази 28 і фаз 19–27 (LEGACY_COLLAPSED_OPENER, LEGACY_DESCRIBED). MARK лишається префіксом службових текстів мода: рядка псевдоніма, нагадування нотатки, CarryNote; звіти, рамки і статуси — з PREFIX.

Що згорнуто (фаза 27; [SP_CTX_DEC_29](./context_editor.decisions-21.sp.md#SP_CTX_DEC_29); живий прогін фази 26). Текст `collapse` і вхід пари-носія називають, що було в діапазоні: без цього пара-носій `Read {}` здавалась викликом без аргументів, і haiku вирішив, що не читав файлів діапазону, а значення взялись лише з підсумку (`.dev_flow/cache/live-test/phase26-results.md`).

    FUNCTION CollapsedList(span) → string:        # ≤ MAX_COLLAPSED_LIST символів
        carriers = CarrierIds(span)
        groups = calls of span by tool, in order of first use, without OWN_TOOLS calls and carriers   # власні виклики прибирає DropOwnCalls
        group = tool, n (calls), args = distinct non-empty KeyArg(input) in order
        render(group) = n = 1 → tool [+ " " + args joined ", "] ; n > 1 → tool + " ×" + n [+ ": " + args joined ", "]
        counts (rows of span without results), each only when > 0, in this order:
            "<k> of the person's messages"   — user row whose PersonText (SP_CTX_02_02) is not empty, or DescribedText(text) (промпт після describe: DESCRIBED або LEGACY_DESCRIBED фаз 19–27), or a PromptRow without text (промпт з самих медіа — так, це повідомлення людини)
            "<k> of your texts"              — assistant row with text
            "<k> of your earlier notes"      — carriers in span + rows whose CollapseText(text) (COLLAPSED_OPENER або LEGACY_COLLAPSED_OPENER; згортання без носія)
        інші рядки user (рамки хоста, `/compact` мода, тексти мода, порожній рядок без handle) не рахуються   # рев'ю фази 27: окремий лічильник «service messages» був копією PersonText, що розійшлась з нею (STRUCT-01)
        tail = counts joined "; "
        calls = CapCalls(groups, MAX_COLLAPSED_LIST − (tail ? len(tail)+2 : 0))
        RETURN [calls, tail] without empty joined "; "

    FUNCTION CapCalls(groups, max):               # лічильники хвоста ніколи не обрізаються
        FOR each group k: reserve = later calls ? len("; …, +<later> more") : 0
            render(group) fits with reserve → add; next group
            else: args of this group while render(args)+", …" fits with reserve
                  some arg fits → add it with ", …"; later calls → add "…, +<later> more"
                  none → add "…, +<calls of this and later groups> more"   # вироджений випадок: не вміщається навіть перший аргумент чи назва; місце для цього хвоста лишила попередня група
                  stop

    KeyArg(input) — перше з: base name `file_path` чи `notebook_path`; `"pattern"` у лапках; перше слово `command` після `cd <dir> &&`/`;` (каталог і в лапках: `cd "/a b" && ls` → `ls`) і присвоєнь `VAR=…` (base name, тобто `/usr/bin/git` → `git`); host `url` (до `/`, `?`, `#`) без userinfo (`https://user:secret@host/` → `host`: пароль у текст не йде); `"description"` чи `"query"` у лапках; base name `path`; інакше порожньо. Кожне ≤ MAX_COLLAPSED_ARG символів (обрізане закінчується `…`). Обрізання (OneLine) не розрізає сурогатної пари UTF-16: висячий сурогат у тексті заміни чи вході носія зберігається в розмові, і API відхиляє кожен наступний запит (рев'ю фази 27); тому OneLine відкидає кінцевий старший сурогат.

    CarrierIds(rows) = calls whose result is CollapseText (фаза 28 або фази 19–27) AND whose input is exactly {COLLAPSED_KEY: string} (фаза 27) or {} (носій застосування до фази 27)   # MCP-виклик з власним полем `collapsed` носієм не є

Приклад тексту (фаза 28): `Later, your context_edit collapse call replaced these 12 rows you had read (Read ×2: cfg.txt, big1.txt; Bash ×2: ls, wc; Grep "KEY_"; 1 of the person's messages; 2 of your texts) with your own note (original: …): <summary>`; вхід носія — `{"collapsed": "Read ×2: cfg.txt, big1.txt; Bash ×2: ls, wc; Grep \"KEY_\"; 1 of the person's messages; 2 of your texts"}`.

Чому вхід носія порожній був і чому назва — перший виклик. Від прототипу (2026-10-08) носій бере назву першого невласного виклику діапазону, а вхід — `{}`, щоб не копіювати аргументів першого виклику (тест «a collapse carrier keeps no copy of the first call input»): ті аргументи — великі (вміст `Write`, довга команда) і кажуть, що весь підсумок — вивід одного виклику, а модель могла б повторити такий виклик. Жодне обмеження хоста чи API порожнього входу не вимагало: перезбирання копіює `input` як є, а хост і раніше приймав вхід, що не відповідає схемі інструмента (`{}` без обов'язкового `file_path`). Вхід з одним полем `collapsed` теж не відповідає схемі жодного інструмента і не схожий на виклик, який варто повторити. Назву лишено: пара-носій мусить бути парою `tool_use`/`tool_result` (рядки результатів без пари ламають чергування ролей і парування), а інструмент, який сесія мала, — єдиний перевірений наживо вибір; власний інструмент мода прибрав би DropOwnCalls, а вигадана назва не перевірена ні з хостом, ні з API. Текст результату й поле `collapsed` кажуть, що це нотатка, а не вивід цього інструмента. PersonText живе в `hooks/deliveries.ts`, мітки MARKER і MarkerKind — у `hooks/rows.ts` (з фази 27; `queue.ts` їх реекспортує), щоб `edits.ts` читав PersonText без циклу імпортів (STRUCT-01). Перелік `context_list` не ставить носієві `~` (CarrierIds; [SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)), а звіт закриття етапу не рахує його відтворюваною парою ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)). Журнал ефекту (`compressed`) і R4 беруть `file_path` викликів `Read`, якого носій не має, — як і до фази 27.

«Правка замінює медіа власника»: summarize і drop — власник `{tool_use_id}` пари; collapse — власники всіх пар і рядків діапазону; describe — власник `{row}`. Для `describe` умова сильніша за «власник у mediaOwners»: власника могло не бути в mediaOwners, якщо PromptMatch на рядках застосування дав «немає» (зсув, рядок у хвості, якого немає в API), — тоді опис без медіа-файлу мовчки знищив би зображення людини; тому `describe` вимагає шляхів медіа свого рядка в `media` і інакше відхиляється з NO_MEDIA_NOW. Так і в HandleCompaction (`media` — архів цього застосування), і в BuildSeed (`mediaOwners = ∅`, `media` — файли засіву).

`Locate(rows, anchor, hint)`: рядок `hint`, якщо його відбиток збігається; інакше єдиний рядок з цим відбитком; інакше «не знайдено».

`LocateSpan(rows, from, to)` (аудит PL_AUD_CTX, CF-3): перший і останній рядок діапазону — `collapse` і діапазону тегу `disposable` ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)). Останній рядок — не рядок асистента лише з thinking (PrepareEdits, `context_tag`) і знаходиться через Locate. Перший рядок, що не розрізняльний (відбиток `<role>||`: лише thinking або промпт з самих медіа), знаходиться від останнього за довжиною діапазону, `to − (toHint − fromHint)`, і має мати той самий відбиток; пошук такого відбитка по всіх рядках узяв би інший рядок лише з thinking (зсув індексів у гілці підсумку BuildSeed, `visible = rows.slice(s+1)`). Розрізняльний перший рядок знаходиться через Locate, як і раніше. Кінець не знайдено або кінці перехрещені — «не знайдено». Обмеження: відлік від кінця припускає, що діапазон зберіг кількість рядків; між рядками, на яких агент поставив ціль, і рядками, де її шукають, так і є для правок черги (їх знаходять на рядках події компактизації, перевірених `listedKey`) і для зсуву всієї голови (гілка підсумку BuildSeed). Після застосування — ні: InsertDeliveries ([SP_CTX_02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36)) вставляє рядки доставок усередину діапазону, а перезбирання відповіді прибирає її рядки лише з thinking; тому RebindTags шукає діапазон тегу спершу за тотожністю рядків, а LocateSpan — лише запасний шлях ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)).

`FreshId(id)` = `base` + `_ce` + поточний час у base36 + 4 випадкові символи `[0-9a-z]`, де `base` = `id` без кінцевого суфікса `_ce[0-9a-z]+`; результат складається лише з `A–Z a–z 0–9 _ -`. Повторна правка тієї ж пари не подовжує ідентифікатор.

«Перезібрати рядок» = скопіювати `role`, `text`, виклики (`tool_use_id`, `tool`, `input`, `text`) і результати (`tool_use_id`, `text`, `isError`) без `handle`.

Цілісність відповіді (KeepResponsesWhole). Хост зливає рядки асистента з однаковим `message.id` (одна відповідь моделі) при побудові запиту, навіть через рядки з іншим id; `SessionMessage` цього id не показує. Перезібраний рядок отримує синтетичний id і розриває відповідь, а пізніший рядок тієї ж відповіді, повернений з `handle`, хост підтягує назад у раніше повідомлення: його `tool_use` втрачає сусідній результат, модель бачить «Tool result missing due to internal error», а медіа цього результату зникає. Так в обох хостах і обома шляхами компактизації (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 5; навичка plugin-hooks, пункт 30). Відповідь ніколи не перетинає промпт людини, тож у кожному відрізку між промптами, де є перезібраний або вставлений рядок асистента, перезбираються всі рядки асистента з `handle` — і ті, що стоять після нього, і ті, що перед ним. Пізніші рядки треба перезібрати, бо злиття йде назад (Entry 5). Раніші — бо модель з thinking пише одну відповідь кількома рядками з тим самим `message.id` (рядок лише з thinking, далі рядок з `tool_use`): рядок thinking, повернений з `handle`, після `--resume` чи `/resume` за злиттям `message.id` підтягує з-до межі оригінальний `tool_use` разом із результатом, і правка втрачається навіть у суто текстовій розмові (Verify фази 11; навичка plugin-hooks, пункти 7б і 36). Відрізок ширший за одну відповідь (кілька відповідей агентного циклу між двома промптами), але `message.id` модові не видно, тож ціна — перезібрати й інші відповіді того самого відрізка. Рядки результатів лишаються за чинним правилом: з медіа — з `handle`, без медіа — перезібрані ([SP_CTX_DEC_02](./context_editor.decisions-01.sp.md#SP_CTX_DEC_02)); батько до межі в копії рядка результату з `handle` (навичка plugin-hooks, пункт 5) за цього правила не шкодить (Entry 5). Ціна: thinking-блоки всіх рядків асистента такого відрізка губляться. Моделі, що зберігають thinking минулих ходів, втрачають міркування раніших відповідей відрізка; міркування після точки правки правка й так робить неактуальними. Рядок, у якому лишився лише thinking, стає порожнім і видаляється. Відоме обмеження: згортання без носія, що починається на промпті людини й закінчується посеред відповіді (рядок thinking чи тексту в межах, рядок `tool_use` тієї ж відповіді — поза ними), вставляє рядок `user` без `handle`, який KeepResponsesWhole вважає промптом; решта відповіді лишається з `handle`. У тому самому процесі це не шкодить; після `--resume` злиття за `message.id` повертає згорнутий оригінал (backlog K, [C_CTX_DEC_05](./context_editor.core.concept.md#C_CTX_DEC_05)). Відбитки (роль, ідентифікатори, текст) від перезбирання не змінюються, тож CurrentRows і межа ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) не зачеплені. Засіву ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) правило не потрібне: жоден засіяний рядок не має `handle`.

Заморожений префікс (FrozenPrefix, фаза 23; [SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22); з живого прогону — лише на вибір агента, `keep_cache`, типово вимкнено). Мітка кешу API знаходить попередній запис не далі ніж за CACHE_LOOKBACK позицій назад, тож запит після застосування читає кеш до першої зміни, лише коли байти до неї ті самі, що в попередньому запиті ([SP_CTX_02_38](./context_editor.telemetry.sp.md#SP_CTX_02_38); спайк [context_editor_cache](./context_editor_cache.spike.md)). Перезібраний рядок результату з простим текстом дає ті самі байти, але перезібраний рядок асистента губить thinking, а перезібраний рядок результату — доставку за ним (повідомлення `role: "system"`, яке InsertDeliveries повертає текстовим блоком, тобто іншими байтами); DropOwnCalls ранніх власних пар теж міняє байти. До фази 23 ці три кроки зсували першу зміну на початок ходу чи розмови: правка останнього з 12 результатів одного ходу давала читання 69 697 (лише `tools + system`) замість 96 656 (Entry 4 спайку). Тому з `freeze` рядки до відповіді, що містить першу зміну, повертаються як отримано — тими самими рядками з `handle`: їх не перезбирає правило [SP_CTX_DEC_02](./context_editor.decisions-01.sp.md#SP_CTX_DEC_02), KeepResponsesWhole і MergeCallRows, а DropOwnCalls лишає власні пари в них ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)). Перша зміна — найменший рядок, якого торкається застосований крок: рядок виклику пари для `summarize` і `drop`, перший рядок діапазону `collapse`, рядок `rewrite` і `describe`; правка, що не застосувалась, префікса не зсуває. Відповідь, що містить першу зміну, перезбирається вся (ResponseStart): рядок thinking тієї самої відповіді, лишений з `handle`, після `--resume` підтягнув би оригінальний виклик за злиттям `message.id` (навичка plugin-hooks, пункти 7б і 36). `message.id` моду не видно, тож межу відповіді дає API-подання: хост зливає рядки однієї відповіді в одне повідомлення асистента, зокрема паралельні виклики, записані «виклик, результат, виклик» (пункти 30, 40); без такого повідомлення (поза вікном API) межа — початок відрізка від промпту, як у KeepResponsesWhole до фази 23. Раніші відповіді того самого відрізка вже не перезбираються: за ResponseStart жодна з них не ділить `message.id` з перезібраним рядком. Доставка за рядком результату в префіксі їде на його `handle` (пункт 44), тож InsertDeliveries її не вставляє ([SP_CTX_02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36)). Ціна: рядки результатів префікса стоять після межі з `handle`, і після `--resume` усе до останнього такого рядка вантажиться з оригіналів (пункт 7а); вміст цих рядків той самий, що в поточній розмові, бо префікс не змінено, — але живий сценарій 05_03 «Відновлення після застосування із замороженим префіксом» показав, що `--resume` дублює кожну відповідь префікса: копії з `handle` після межі підтягують оригінали за `message.id` (навичка plugin-hooks, пункти 7б, 30, 36). Тому заморожений префікс — лише за `keep_cache` пакета, а типовий шлях перезбирає відрізок, як до фази 23. Виправлення 2026-10-12 (спайк [context_editor_resume](./context_editor_resume.spike.md), CF-46): типовий шлях теж **не** відновлюється чисто — кожна незачеплена відповідь, повернена з `handle`, після `--resume` повертає свій оригінал за `message.id` (навичка plugin-hooks, пункт 63); чистим був лише сценарій, у якому мод перезібрав усі рядки. Застосування від цього не змінюється: дублікати прибирає ремонт після відновлення (фаза 32, [SP_CTX_02_47](./context_editor.resume.sp.md#SP_CTX_02_47); [SP_CTX_DEC_32](./context_editor.decisions-21.sp.md#SP_CTX_DEC_32)). Засів ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) `freeze` не передає: у засіяній сесії жоден рядок не має `handle`, і правила вище діють як до фази 23.

Виклики однієї відповіді (MergeCallRows). Рядок без `handle` хост надсилає окремим повідомленням із синтетичним id і зливає лише рядки з одним `message.id`. Паралельні виклики однієї відповіді хост пише окремими рядками асистента (рядок `tool_use a`, рядок `tool_use b`, далі рядок результатів); перезібрані KeepResponsesWhole чи правкою, вони стають повідомленнями `assistant(tool_use a)`, `assistant(tool_use b)`, `user(results a, b)`: перший `tool_use` не має результатів одразу після себе, хост пише `[ERROR] ensureToolResultPairing: repaired missing tool_result blocks`, а модель бачить «Tool result missing due to internal error» (Verify фази 14, D1, обидва хости; навичка plugin-hooks, пункт 30). Тому після видалення порожніх рядків кожен рядок асистента без `handle` з викликами вбирає наступні рядки асистента без `handle` до першого рядка іншої ролі чи рядка з `handle`: тексти — по порядку через порожній рядок, виклики — по порядку. Рядки асистента поспіль — одна відповідь: відповідь ніколи не перетинає рядка результатів чи промпту, а KeepResponsesWhole у відрізку з перезібраним рядком лишає без `handle` всі рядки асистента. Рядок тексту чи thinking перед викликами лишається окремим: таку пару хост приймає (спайк context_editor_handoff_long, Entry 5, vR — pass). Злитий рядок має новий відбиток (роль і всі ідентифікатори викликів), тож для RebindTags рядки, що злились, — «прибрані без заміни»: теги пар за `tool_use_id` і псевдоніми розв'язуються як раніше, тег за якорем на рядку виклику губиться (такі теги — рідкість: `disposable` за індексом лише на тексті без викликів), межа етапу на такому рядку переїжджає за попередній незмінений рядок ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)); `produced` правки `rewrite`, чий рядок злився з рядком викликів, знаходиться за частиною тексту злитого рядка. Перевіряється наживо лише випадок спільного рядка результатів (D1); рядки результатів паралельних викликів, записані окремо (`user(result a)`, `user(result b)` після злитого рядка), — сусідні повідомлення `user` — рядок 05_03 «Паралельні виклики після застосування».

### 02_07. HandleCompaction  {#SP_CTX_02_07}

> **Курування:** ScreenPerson поряд із ScreenPinned — [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58); запис рядків хоста в кроці фіксації — [SP_CTX_02_60](./context_editor.curation.hostrows.sp.md#SP_CTX_02_60).

> **Criticality:** core

Purpose: обробник події компактизації в моді: застосувати чергу для MARKER, засіяти нову сесію для HANDOFF_MARKER.

Input: подія компактизації з `trigger`, `instructions`, `messages: list<Row>`, `agentId?`. Збіг — за `instructions` і відсутністю `agentId`, за будь-якого `trigger`, крім `precompute` (попереднє обчислення нічого не встановлює, як і в спостерігача [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)): команда компактизації, яку запускає мод, приходить з `trigger: 'manual'` ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)).

Тексти `skip` нижче мод подає з префіксом PREFIX (`context-editor: <text>`, ModText, [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)).

Processing logic (pseudocode):
    ON compaction (any trigger):
        IF agentId present OR trigger = precompute OR MarkerKind(instructions) absent: pass to next handler   # MarkerKind: MARKER, HANDOFF_MARKER і їхні тексти до фази 25 (SP_CTX_DEC_26)
        IF MarkerKind(instructions) = seed: RETURN HandleSeed(messages)          # SP_CTX_02_26
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
                n += 1; path = <archives>/<id>/<n>.<ext>             # SP_CTX_01_07 ArchiveRoot
                IF ref.data absent OR writing fails: drop media[owner]; BREAK      # ApplyEdits fails its edits
                media[owner] += path
        archive = <archives>/<id>.json
        (rows, report, renamed, prefix) = ApplyEdits(messages, edits, archive, media, mediaOwners, knownResults, unmatchedPromptMedia, apiTruncated, freeze = q.keepCache ? { api } : none)   # SP_CTX_02_04 FrozenPrefix лише на вибір агента (SP_CTX_DEC_22); типово prefix = 0, як до фази 23
        frozen = messages[0..prefix)                                   # ті самі рядки; кеш промпту тримається до них
        IF report.originals not empty AND writing archive (compact JSON, through a host command) fails:
            IF the dispatch was abandoned: RETURN skip "compaction abandoned; the batch stays queued"
            write Queue with every edit failed "originals could not be archived" (report and kept fields as below)
            RETURN skip "originals could not be archived"                 # оригінали не зникають без архіву
        deliveries = read QueuedDeliveries on the deliveries chain (unreadable → none; report.deliveries.unreadable = reason)   # SP_CTX_01_22, фаза 20
        (rows, report.deliveries, done, added) = InsertDeliveries(messages, rows, deliveries, renamed, allRebuilt = false, goes = r ∉ frozen AND r holds only own results)   # SP_CTX_02_36: до DropOwnCalls; done — uuid записів, що більше не потрібні; added — розмір вставлених рядків; рядок префікса не «піде»: DropOwnCalls його не чіпає
        (rows, report.ownCallsRemoved) = DropOwnCalls(rows, mediaOwners, knownResults, frozen); report.charsAfter = Σ size(rows) − added   # повернений список уже пройшов KeepResponsesWhole; лічильник — для речення P13 (SP_CTX_01_05); доставки — не звільнене місце
        report.produced = Produced(rows, applied steps)                # SP_CTX_02_04: індекси в кінцевому списку
        IF the dispatch was abandoned (interrupt, budget): RETURN skip "compaction abandoned; the batch stays queued"   # пакет лишається в черзі
        entry = JournalEntry(id, report, archive, messages, edits); boundary = Boundary(rows)   # усе, що потрібне після точки фіксації, — до неї: після запису черги ніщо не кидає
        IF some edit applied AND the attachments port: disk = the files the catalog's sections name; frozen = q.keepCache ? FrozenAttachments(messages, api, prefix) : none   # SP_CTX_02_40, фаза 24: читання без побічних дій, до фіксації
        COMMIT, holding the registry's chain, then the alias registry's (inside the queue's: порядок queue → tags → aliases):
            reg = read TagRegistry; aliases = read AliasRegistry          # як вони є тепер, коли очікування ланцюжків скінчилось
            (reg', dropped) = RebindTags(reg, rows, report)               # SP_CTX_02_14: теги, межі етапів, слот стану, нотатки; lastApply — нижче
            aliases' = PruneAliases(aliases, rows)
            IF the dispatch was abandoned: RETURN skip "compaction abandoned; the batch stays queued"   # нічого не записано
            IF reg readable: write reg' (failure → registry as it was, report names no dropped notes); IF written: report.notesDropped = dropped
            IF aliases readable AND aliases' ≠ aliases AND NOT abandoned: write aliases' (failure → as it was)
            IF disk AND NOT abandoned: attached = CommitAttachments(disk, frozen) on the hostattach chain (failure → decisions as they were)   # SP_CTX_02_40
            IF the dispatch was abandoned: put back the registries written (reg, aliases as read; the attachments' decisions as read); RETURN skip "compaction abandoned; the batch stays queued"
            text = FormatReport(report, archive, compaction) + attached.text   # SP_CTX_01_05: без правок — «not changed», без рядка розміру; AttachText останнім
            write Queue { edits: [], resume: true, resumePrompt: DEFAULT_RESUME, tagsOnly: false,
                          report: (q.report ? q.report + "\n" : "") + text + " " + COMMAND_NOTE, reportId: id,   # CommandNote, SP_CTX_01_05, фаза 25; спливне повідомлення — text без нього
                          reportResume: ResumesAfter(q), reportPrompt: q.resumePrompt,   # SP_CTX_02_02: q.resume AND (q.resumeSet OR NOT q.tagsOnly)
                          optimize: q.optimize, optimizePrompted: q.optimizePrompted, handoff: q.handoff }   # поля чужих кроків — як прочитано (SP_CTX_01_04); точка фіксації
            IF that write fails: put back the registries written; the failure goes to the failure branch
            IF the dispatch was abandoned during that write: write q back as read; put back the registries written; RETURN skip "compaction abandoned; the batch stays queued"
        after the handler returned, IF the dispatch was not abandoned: lastReported = id; applyDir = <storage>; appliedLine = (id, ApplyLine(report, ratio, apiChars)) when report.applied is not empty, else none   # apiChars = ApiChars(api) прочитаного API-подання, відсутнє при ApiCut (фаза 29, SP_CTX_02_43)   # пам'ять екземпляра для гілки збою; на ланцюжку черги, до запису гілки збою за ним; appliedLine читає LogApply у Flush (SP_CTX_02_43) — обробник сам рядка не пише: у терміналі компактизація ще триває
        toast first 200 chars of text
        IF report.applied empty: RETURN skip "no edit could be applied"
        in the background (not awaited): RecordBoundary(boundary)          # SP_CTX_02_18; після точки фіксації обробник нічого не чекає
        lastApply: the request size read before the apply (plain $.session.usage().context.tokens, 1–3 ms, no breakdown, bounded by USAGE_WAIT_MS (SP_CTX_01_12) — the handler never waits longer; absent or late → nothing) goes into TagRegistry.lastApply = { at: id, tokensBefore } with RebindTags   # SP_CTX_02_28: виміряна зміна
        IF NOT abandoned, in the background, on the deliveries chain, IF done not empty: re-read QueuedDeliveries; IF not unreadable: remove the items whose uuid is in done; write   # SP_CTX_02_36: вставлені, згорнуті й зниклі записи йдуть, записані тим часом лишаються; збій запису — повторну вставку відсікає перевірка «уже рядок»
        IF NOT abandoned, in the background, on the journal chain: JournalApply(entry)   # SP_CTX_02_31; не затримує відповіді
        IF the attachments port: ResetPass   # SP_CTX_02_39: компактизація стоїть, хост зараз перепитає всі вкладення
        RETURN { messages: rows }

    ON handler failure:                                                  # CompactionFailed (`compactionFailed` у hooks/compaction.ts) за портом FailureIO
        IF agentId present OR trigger = precompute OR MarkerKind(instructions) absent: pass to next handler   # MarkerKind: MARKER, HANDOFF_MARKER і їхні тексти до фази 25 (SP_CTX_DEC_26)
        IF MarkerKind(instructions) = seed: RETURN skip "seeding failed" at once         # RunHandoff побачить, що засів не взято
        RETURN skip "applying the edits failed" at once; in the background, on the queue's serial chain (after the failed handler, which holds it), read Queue q in the folder of the apply (applyDir; else the current storage);
            IF q readable AND q.edits empty AND q.reportId = lastReported: write nothing   # застосування дійшло до точки фіксації: пакета вже немає, його звіт стоїть — без пари «applied» + «failed»
            ELSE write
            Queue { edits: [], resume: true, resumePrompt: DEFAULT_RESUME, tagsOnly: false,
                    report: (q.report ? q.report + "\n" : "") + "context-editor: applying the edits failed (<reason>); the conversation was not changed and the batch was dropped. " + COMMAND_NOTE,
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
| SKIP_FAILED | обробник впав | розмова не змінюється; черга очищена; звіт про збій чекає наступного промпту; якщо застосування вже записало свій звіт (точка фіксації), черга не змінюється |
| SKIP_ABANDONED | хост покинув диспетчеризацію до повернення | розмова і черга не змінюються; реєстр, псевдоніми, межа, доставки й журнал — теж (записані в кроці фіксації реєстри повернуто); медіа-файли й архів, уже записані, лишаються без посилань |
| SKIP_NOT_ARCHIVED | файл оригіналів не записався | жодна правка не застосовується; пакет очищено; звіт називає кожну правку |

Справжнє підсумовування для компактизації з MARKER або HANDOFF_MARKER не запускається за жодної гілки обробника: кожна гілка відповідає або списком рядків, або `skip`, а гілка збою відповідає `skip` одразу, не чекаючи запису черги. На цьому стоїть [C_CTX_DEC_09](./context_editor.core.concept.md#C_CTX_DEC_09): команду з міткою запускає лише код того самого модуля, тож обробник завантажений, коли вона приходить. Порядок фіксації: усе, що може чекати довго (ланцюжки реєстру й псевдонімів, читання доставок, запис архіву), іде до неї; потім — реєстр, псевдоніми, черга (точка фіксації), і перед кожним записом обробник перевіряє, чи хост не покинув диспетчеризацію. Покинута до точки фіксації або під час запису черги (Esc, бюджет хука ~10 с, що рахує й очікування ланцюжка) — нічого не зафіксовано: черга повертається такою, як прочитано, реєстри, уже записані в кроці фіксації, — такими, як прочитано, пакет лишається в черзі (гілка збою, яку хост викличе по бюджету, потім очищує його одним звітом про збій). Після точки фіксації обробник нічого не чекає: межу він пише у фоні, доставки й журнал — на своїх ланцюжках, і відповідає одразу. Звіт застосування вважається записаним (lastReported) лише коли обробник повернувся без покинутої диспетчеризації; тоді гілка збою, якщо хост відкине повернений список, нічого не пише: пакета вже немає, звіт застосування лишається, пари «applied» + «failed» немає. Застосування, яке хост покинув, гілка збою завжди записує звітом про збій.

Кожен запис черги цього обробника (застосування, відмова архіву, гілка збою) змінює лише пакет і поля звіту, а `optimize` і `optimizePrompted` переносить без змін ([SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04)): після `/compact` людини з непорожньою чергою Flush читає чергу після команди і мусить побачити `optimize` разом із `compact`, інакше хід стискання не запустився б (мітка `optimize` не пише, [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)).

Фаза 32 (ремонт після відновлення, [context_editor.resume.sp.md](./context_editor.resume.sp.md); не змінює кроків вище, лише додає): (1) MarkerKind розпізнає й REPAIR_MARKER — гілка `repair` іде в HandleRepair ([SP_CTX_02_47](./context_editor.resume.sp.md#SP_CTX_02_47)), а гілка збою для неї відповідає `skip "repair failed"` одразу, нічого не пишучи; (2) перед ScreenPinned застосування бере `messages = DropPulled(messages, ApplyLedger, applied).kept` (крім випадку, коли цей екземпляр уже компактизував сесію — `compactedHere` = сесія: читання тоді «оригінали + копії», журнал не читається; рев'ю фази 32) ([SP_CTX_02_45](./context_editor.resume.sp.md#SP_CTX_02_45); журнал читається без ланцюжка, `unreadable` — порожній): у тому самому процесі вхід обробника — поточна розмова без оригіналів, і крок нічого не робить, а в завантаженому ланцюжку (ремонт відмовлено чи ще не встиг) застосування не повертає оригіналів знову; прибране лічить поле звіту `pulledDropped` і речення PULLED_TEXT ([SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)); (3) після точки фіксації, у фоні на ланцюжку `ledger`, як JournalApply: RecordInputs(messages, id) ([SP_CTX_02_44](./context_editor.resume.sp.md#SP_CTX_02_44)); (4) `compactedHere` = сесія, коли обробник повернув рядки без покинутої диспетчеризації; (5) рядки результатів, які ApplyEdits перебудовує без `handle` і не змінює, беруть ToolRefText з `toolRefs` CollectMedia ([SP_CTX_02_48](./context_editor.resume.sp.md#SP_CTX_02_48)).

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
        # фаза 32: результат, який завантажений ланцюжок показує двічі (оригінал і копія), дає медіа і tool_reference лише з першого блоку свого tool_use_id
        FOR block IN tool_result blocks of api WHERE block.content holds tool_reference blocks:   # фаза 32, SP_CTX_02_48 (CF-51)
            toolRefs[block.tool_use_id] = tool_name of each tool_reference block, in order
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

Зіставлення за `tool_use_id` однозначне. Медіа в промптах людини зіставляє PromptMatch ([SP_CTX_DEC_06](./context_editor.decisions-01.sp.md#SP_CTX_DEC_06), спайк [context_editor_media](./context_editor_media.spike.md)): обидва подання закінчуються тим самим ходом, тож ходи людини (одиниці) йдуть парами від хвоста, а текст лише перевіряє кожну пару. Ключем текст бути не може: промпт лише із зображенням має `Row.text = ""` у stream-json, однакові тексти повторюються, а API-повідомлення — це злиття суміжних рядків `user` з вкладеннями хоста. Що бачить хост (2.1.296, обидва хости; навичка plugin-hooks, пункти 47–50): `Row.text` з'єднує текстові блоки без розділювача; в API ті самі блоки дослівні, але з `\n` на стиках злиття — тому порівнюються рядки без пробільних символів; нагадування (`<system-reminder>`) стоять перед блоками промпту, isMeta-нотатка `[Image: source: <шлях>]` — після них, рядки `/compact` і `Compacted` зливаються з наступним промптом разом з блоком `<local-command-caveat>`; у терміналі `@файл` дає окреме API-повідомлення лише з нагадувань. Паралельні виклики рядки пишуть «виклик, результат, виклик», а API зливає їх в одне повідомлення асистента й одне повідомлення результатів — тому одиниця — хід людини, а не відрізок рядків `user`.

«Немає» (медіа йде в `unmatchedPromptMedia`), коли: пара не перевірилась або стоїть за першою неперевіреною (зсув: рядок, якого немає в одному з подань, а також відрізок, обрізаний вікном читання); наступна старша пара не перевірилась не на першому повідомленні API — тоді й ця пара не довірена (одна пара з порожнім текстом промпту не доводить, що зсуву немає); медіа не в першому повідомленні ходу або в повідомленні з `tool_result` (доставка посеред ходу, навичка plugin-hooks, пункт 43); голова ходу має не один рядок людини (два промпти без відповіді між ними). Помилка правила дає «немає», а не чужий рядок; зсув лишається непоміченим лише тоді, коли в сусідніх ходах однакові і промпт, і відповідь, і виклики. Медіа файлу з `@шлях` у терміналі хост кладе в повідомлення промпту — воно належить рядку промпту і зникає разом із перезібраним рядком (навичка plugin-hooks, пункт 44); так само зникають текстові вкладення цього промпту (вміст файлу з `@шлях`, нагадування) — їх `describe` не архівує, а лише попереджає (DESCRIBE_DROPS). PromptMatch рахується і при постановці (`context_edit`), і при застосуванні — на тодішніх рядках; при застосуванні «немає» відхиляє `describe` ([SP_CTX_02_04](#SP_CTX_02_04)). Еталонна реалізація для фікстур — `match_v3` у `.dev_flow/cache/media-spike/match.py`; код — `matchPrompts` у `hooks/media.ts`.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-16 | Фаза 41: `run summarize` пише SummarizedWords(SourceOf(call), via, quoted) — відкривач з джерелом ([SP_CTX_02_62](./context_editor.curation.edits.sp.md#SP_CTX_02_62)); REPLACEMENT_OPENERS з головами SUMMARIZED_OF і TAG_SUMMARIZED_OF |
| 2026-10-15 | Розділи перенесено дослівно з [context_editor.edits.sp.md](./context_editor.edits.sp.md): поділ файлу за модулями, якорі ті самі (structural-event) |
