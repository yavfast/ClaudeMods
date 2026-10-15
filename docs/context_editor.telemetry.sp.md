# Редактор контексту агента — Specification: Contracts — телеметрія, журнал ефекту, оцінка, м'яке нагадування, кеш

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_28, 02_31, 02_34, 02_37, 02_38 специфікації [SP_CTX](./context_editor.sp.md): Telemetry, Journal, Estimate, SoftHint, CacheCost. Читати, коли змінюєте телеметрію, оцінки розміру чи нагадування.

## Contents

Розділи цього файлу:

- [02_28. Telemetry](#SP_CTX_02_28)
- [02_31. Journal](#SP_CTX_02_31)
- [02_34. Estimate](#SP_CTX_02_34)
- [02_37. SoftHint](#SP_CTX_02_37)
- [02_38. CacheCost](#SP_CTX_02_38)

## 02. Contracts — телеметрія, журнал ефекту, оцінки, м'яке нагадування, ціна кешу

### 02_28. Telemetry  {#SP_CTX_02_28}

Purpose: обчислити телеметрію контексту ([SP_CTX_01_20](./context_editor.records.sp.md#SP_CTX_01_20)) на запит агента — у заголовку перегляду (і окремо, з `count: 0`) та у звіті закриття етапу інструментом — і ніколи після звичайного виклику інструменту ([C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15)). Виняток без тексту телеметрії: м'яке нагадування ([SP_CTX_02_37](#SP_CTX_02_37)) викликає Telemetry лише заради рядка MESSAGES_ROW і калібрування, з реєстром без `lastApply`, тож виміряне звільнення агент і далі бачить у своїй телеметрії.

Input: `rows` — поточна розмова; `reg` — TagRegistry; `journal` — Journal зі станом читання; порт `usage(breakdown)` — `$.session.usage({ breakdown: 'summary' })`; порт `api` — `$.session.messages({ as: 'api' })` зі знімка події (одне читання на подію); `cache` — чи потрібен рядок `Cache` (SoftHint — ні).

Processing logic (pseudocode):
    FUNCTION Telemetry(rows, reg, journal, api, cache = true):   # api — читач API-подання; немає чи збій — без нього (PL_AUD_CTX фаза 8, рев'ю)
        TRY u = usage(summary)                          # 23–87 мс, без запитів до API (навичка plugin-hooks, пункт 37)
        CATCH err: u = none; t.measure = unavailable; t.error = err text   # частини розміру нижче пропускаються, решта рахується
        IF u present:
            b = u.context.breakdown
            IF u.context.tokens absent OR (b present AND b.apiUsage = null): t.measure = unknown   # моделі ще не відповідали в живому вікні
            ELSE IF b present AND some category c of b has kind = used AND name = MESSAGES_ROW AND b.totalTokens − c.tokens <= u.context.tokens:   # після /compact хоста розбивка завищує незмінну частину понад весь запит і урізає MESSAGES_ROW (Verify фази 14, D2); сума понад запит сама по собі нормальна — оцінка рядків після останньої відповіді (рев'ю 36)
                t.measure = messages; t.conversation = c.tokens; t.fixed = max(0, b.totalTokens − c.tokens)
                t.attached = Σ tokens of the categories of b with kind = used AND name IN FIXED_IN_MESSAGES   # 0 — поле відсутнє; частина fixed, чий текст лежить у повідомленнях (2026-10-12)
            ELSE: t.measure = request; t.request = u.context.tokens      # незмінна частина всередині
            t.window = b ? b.rawMaxTokens : u.context.window
            IF b: IF b.autoCompactThreshold present: t.autoCompactLeft = b.autoCompactThreshold − b.totalTokens ELSE t.autoCompactOff = true
        form = api() (none or a failed read → [])
        IF len(form) > 0 AND NOT ApiCut(form): t.chars = ApiChars(form)   # SP_CTX_02_34; ApiCut = len ≥ ROW_WINDOW − 1, той самий предикат, що CollectMedia (SP_CTX_02_10): хост обрізає вікно до повідомлення user
        IF reg: t.ratio = Calibrate(t.chars, t, reg)                     # SP_CTX_02_34: оновлює TagRegistry.charsPerToken за API-поданням; без нього — збережене
        IF rows not empty AND cache: k = LookbackStart(rows, form); t.cache = { start: k, tokens: TailTokens(rows, k, t.ratio or PLAIN_RATIO, Whole(t)), approx: t.ratio absent }   # SP_CTX_02_38, фаза 23; і без реєстру
        IF reg absent: RETURN t
        IF reg.stage: first = StartOf(rows, reg.stage.after); t.stage = { name, first, chars = Σ size(rows[first ..]), turnsAgo = reg.turn − openedTurn, lost = MarkIndex is lost }
        IF reg.lastClosed: s0 = StartOf(rows, after); e = MarkIndex(rows, end)
            t.lastClosed = { name, start = s0, end = (e is an index ? e : absent), chars = (e is an index AND s0 ≤ e ? Σ size(rows[s0..e]) : absent), lost = e is lost, startLost = MarkIndex(rows, after) is lost }
        t.reviews = active review tags whose target resolves on rows, by reason (absent → none: a tag written before phase 15, SP_CTX_01_09), with the first row of each target
        t.disposable = disposable tags whose target resolves on rows
        t.journal = journal unreadable ? { unreadable: reason } : { applications: count of apply, rereads: count of reread, archiveRereads: count of reread with archive }   # missing → zeros
        t.state = the state tag ? (Locate finds its row ? { row } : lost) : none
        t.notes = { count: len(reg.notes), reminders: count of reg.notes with remindAt }   # після доставки нагадувань цього виклику
        IF RegistryFull(reg): t.tagsFull = { tags: len(reg.tags), kb: ceil(bytes(reg) / 1024) }   # фаза 30, CF-34: RegistryFull = len(tags) ≥ MAX_TAGS OR bytes(reg) > MAX_REGISTRY_BYTES − TAG_ROOM
        IF reg.lastApply AND t.measure IN (messages, request) AND u.context.tokens ≠ reg.lastApply.tokensBefore:   # перша відповідь моделі після застосування
            t.measuredFreed = reg.lastApply.tokensBefore − u.context.tokens; on the registry chain: remove lastApply
        RETURN t

    Whole(t) = t.measure = messages ? t.conversation + (t.attached or 0) : none   # токени, які тримають повідомлення запиту

    TelemetryText(t) = lines, numbers of tokens in thousands rounded to an integer ("~12k"), under 1000 as they are:
        messages:    (attached) "Context: conversation ~<conversation> tokens; fixed part (system prompt, tools) ~<fixed − attached>; attached in the first message (memory, skills, MCP instructions, agents) ~<attached>; window <window>; auto-compaction in ~<autoCompactLeft>" | (no attached) "Context: conversation ~<conversation> tokens; fixed part (system prompt, tools, skills, memory) ~<fixed>; window …" | "...; auto-compaction off"
        request:     "Context: last request ~<request> tokens, the fixed part (system prompt, tools, skills, memory) included; window <window>" + the same auto-compaction part when the breakdown has it
        unknown:     "Context: size unknown yet (no model response since the session start or the last compaction); window <window>"
        unavailable: "Context: size unavailable (<error>)"
        cache:       right after the size line, without rows omitted: (start = len(rows)) "Cache: an apply rewrites the whole conversation once; even the last response is beyond the API's ~20-position cache lookback, so \"keep_cache\" would not help" | (start = 0) "Cache: an apply rewrites the whole conversation once; with \"keep_cache\": true only the rows from its earliest edit (the whole conversation is within the API's ~20-position cache lookback)" | "Cache: an apply rewrites the whole conversation once; with \"keep_cache\": true, an earliest edit from #<start> on (within the API's ~20-position cache lookback) rewrites only the rows from it (at most ~<tokensText(cache.tokens)> tokens" + (cache.approx ? " (approx.)" : "") + ") if your turn ends soon: edits apply at its end, and each call until then pushes them deeper"
        hostAttach:  right after the cache line, also without a readable registry, only when t.hostAttach.copies > 0 (context_list only): "Host attachments: <copies> stale cop(y|ies) of instruction files and skill listings left out of each request (<Estimate(chars, t.ratio)>)"   # фаза 24, SP_CTX_02_40: HostAttachState.left через кеш
        stage:       "Stage \"<name>\" open from #<first> (opened <turnsAgo> turn(s) ago), <Estimate(chars, t.ratio)>" + (lost ? "; its start row is gone, so it runs from #0" : "") | "No open stage"
        lastClosed:  "Last block \"<name>\" | (no stage) #<start>..#<end> (<Estimate(chars, t.ratio)>)" | (end null or start > end) "...: it is empty" | (end lost) "Last block \"<name>\" | (no stage) from #<start>: its end row is gone"; + (startLost ? "; its start row is gone, so it runs from #0" : "") — line omitted without lastClosed; a lost end is never shown as an empty block
        candidates:  "Candidates: review <total> (<reason> <n>: #<i>, …; reasons with 0 omitted; the group none is named \"no reason\"; ≤ MAX_BLOCK_INDEXES rows per reason, then +<n> more); disposable <n>"
        journal:     "Effect: <applications> application(s); <rereads> reread(s) of compressed content (<archiveRereads> of archives)" | "Effect: journal unreadable (<reason>)" — line omitted when the journal is readable and applications + rereads = 0
        state:       "State slot: #<row>" | "State slot: its row is no longer in the conversation" — line omitted when there is no state tag
        notes:       "Notes: <count> (<reminders> with a reminder pending)" — line omitted when count = 0
        tagsFull:    TAGS_FULL_LINE with <n> = t.tagsFull.tags, <kb> = t.tagsFull.kb — only when t.tagsFull is present   # фаза 30: автоправила на повному реєстрі мовчать (SP_CTX_01_11), рядок каже це агенту
        measured:    "Last apply: ~<measuredFreed> tokens freed (measured: request before it − request now; net of the rows added since)" — once, only when measuredFreed is present

Рядок `Cache` (фаза 23, [SP_CTX_02_38](#SP_CTX_02_38)) каже агенту, що типове застосування переписує всю розмову один раз, хоч би скільки правок було в пакеті, і де межа вікна пошуку кешу API для `keep_cache`: правки від `#<start>` з цим полем переписують лише хвіст від найранішої з них (заморожений префікс, [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)); тому правки варто збирати в один пакет, а щойно опрацьовані виводи останніх викликів з `keep_cache` стискати недорого. Межа — оцінка за рядками без API-подання (LookbackStart): блоки вкладень промпту, доставки й кілька блоків thinking одного рядка не видно, тож біля межі вона оптимістична на кілька позицій, а паралельні виклики, записані «виклик, результат, виклик», рахуються окремими відповідями — песимістично. Межа міряється зараз, а застосування буде в кінці ходу: рядок це каже (рев'ю 54). Розбивки рядок не потребує і є також у звіті закриття етапу.

Розмір рядків розмови береться з рядка MESSAGES_ROW розбивки: розмір усього запиту для рішення не годиться, бо незмінна частина залежить від хоста (~38 тисяч токенів у терміналі, ~70 тисяч у розширенні VS Code, [C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02)). Рядок шукається за назвою: власного `kind` він не має, а типи хоста радять розгалужуватись за `kind`; якщо назва зміниться в іншій версії хоста, телеметрія переходить на весь запит із позначкою, що незмінна частина в ньому (`request`), і нічого не ламається. `tokens` відсутній, поки моделі не відповіли (свіжа сесія, щойно після компактизації), — тоді `unknown`. Щойно після вбудованої компактизації хоста `tokens` ще є (це останній запит до неї), а рядок MESSAGES_ROW — гола локальна оцінка (наживо «conversation ~15 tokens», Verify фази 14, D2): розбивка позначає це полем `apiUsage = null` (відповіді API в живому вікні ще не було; рядок `Messages` звіряється саме з нею), і тоді теж `unknown`. Поле `apiUsage` відсутнє (інша версія хоста) — правило не діє. Розбивка рахує «зараз» з локальною оцінкою рядків після останньої відповіді, а `tokens` — останній запит, тож суми не мусять збігатися. Збій `usage` не валить переліку чи звіту блоку: решта рядків телеметрії не залежить від нього. Розмір блоку й етапу — Estimate ([SP_CTX_02_34](#SP_CTX_02_34)) суми символів рядків поточної розмови з відношенням цієї телеметрії (`t.ratio`; без нього — символи/4 з позначкою `approx.`), а не розбивка: вона не ділиться за рядками. Це те, що звільнять правки цих рядків; а те, що тримає чи переписує запит (хвіст рядка `Cache`, Whole), рахується з вкладеннями хоста — за API-поданням чи виміряними токенами ([SP_CTX_02_38](#SP_CTX_02_38)). Whole — `Messages` разом із рядками FIXED_IN_MESSAGES: пам'ять, перелік навичок, інструкції MCP і агентів лежать у першому повідомленні `user`, хоч розбивка лічить їх у незмінній частині (проба 2.1.296, 2026-10-12, [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)). Журнал не дає оцінки звільненого: виміряну зміну показує рядок `Last apply` ([SP_CTX_01_19](./context_editor.records.sp.md#SP_CTX_01_19)). Рядки журналу і слоту стану, як і `Notes`, з'являються лише тоді, коли є що показати: інакше кожна телеметрія несла б два рядки без інформації.

### 02_31. Journal  {#SP_CTX_02_31}

Purpose: вести журнал ефекту ([SP_CTX_01_19](./context_editor.records.sp.md#SP_CTX_01_19)): що стиснуло кожне застосування (без оцінки звільненого — її дає виміряний `Last apply`, [SP_CTX_02_28](#SP_CTX_02_28)) і які вже стиснуті відтворювані виводи агент читав знову — сигнал надмірного стискання і матеріал для дослідження впливу змінного контексту на якість завдань ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), «Журнал ефекту»).

Processing logic (pseudocode):
    FUNCTION JournalApply(id, report, archive, before, edits):             # HandleCompaction (SP_CTX_02_07), коли report.applied непорожній; у фоні
        j = read Journal; IF unreadable: RETURN                            # не перезаписується
        applied = [e IN edits | EditLabel(e) IN report.applied]
        compressed = distinct input.file_path of every Read call in the pairs of before that applied summarize or drop edits name, or that applied collapse spans hold (≤ MAX_QUEUE_EDITS, first ones kept)
        j.entries += { kind: apply, at: id, edits: len(applied), archive, compressed }
        Trim(j); write Journal                                             # збій запису — без наслідків для застосування

    FUNCTION JournalReread(path, tool_use_id):                             # хук викликів (SP_CTX_02_16), після Read без помилки; у фоні
        j = read Journal; IF unreadable OR missing: RETURN
        archiveHit = some apply entry e with e.archive ≠ "" AND (path = e.archive OR path starts with e.archive without ".json" + "/")   # медіа поруч з архівом, в обох каталогах (фаза 35)
        compressedHit = some apply entry e with path IN e.compressed AND no later changed entry with that path   # власний Edit/Write після стискання — читається новий вміст
        IF NOT archiveHit AND NOT compressedHit: RETURN
        j.entries += { kind: reread, at: now, path, tool_use_id, archive: archiveHit }
        Trim(j); write Journal

    FUNCTION JournalChanged(path):                                         # хук викликів, після WRITE_TOOLS без помилки; у фоні
        j = read Journal; IF unreadable OR missing: RETURN
        IF some apply entry e has path IN e.compressed: j.entries += { kind: changed, at: now, path }; Trim(j); write Journal

    Trim(j): drop the oldest entries while len(j.entries) > MAX_JOURNAL or the serialized file > MAX_QUEUE_BYTES

Повторне читання помічається лише для `Read`: `Grep` і `Glob` шляху одного файлу не мають, тож їх повтор журнал не бачить. Читання файлу архіву або медіа застосування (`archive = true`) — повернення оригіналу ([C_CTX_DEC_18](./context_editor.core.concept.md#C_CTX_DEC_18)); часті такі записи — тригер повернутися до операції відновлення на місці (C_CTX_DEC_18, B). Засів нової сесії записів журналу не робить, і журнал у нову сесію не переноситься ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)). Журнал — частина телеметрії ([SP_CTX_02_28](#SP_CTX_02_28)); інших читачів у моді немає.

Errors: відмов немає; журнал `unreadable` — записи пропускаються, телеметрія показує причину; збій запису — запис губиться.

### 02_34. Estimate  {#SP_CTX_02_34}

Purpose: оцінювати розмір у токенах калібровано за телеметрією, а не «символи/4» ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), «Телеметрія на запит»; [C_CTX_DEC_21](./context_editor.core.concept.md#C_CTX_DEC_21)). Прогін на копії реальної сесії: перелік казав «~57 тисяч токенів» при 268 тисячах за телеметрією, звіт — «~121 тисяча звільнено» при ~271 тисячі: україномовний текст займає близько 1,8 символу на токен, а приховані міркування моделі займають токени, яких мод як текст не бачить.

Processing logic (pseudocode):
    ApiChars(form) = Σ over the messages of form, over their blocks: text → len(text); tool_use → len(JSON(input)); tool_result → Σ len(text) of its text content; thinking, image, document → 0   # міра size рядка (SP_CTX_02_01), але з вкладеннями хоста

    FUNCTION Calibrate(chars, t, reg) → number?:                      # Telemetry (SP_CTX_02_28): перелік, звіт закриття, SoftHint; chars = t.chars
        IF t.measure = messages AND t.conversation ≥ CALIB_TOKENS AND chars present AND chars > 0:   # CALIB_TOKENS = 20 000 (SP_CTX_DEC_30 A: 5 000 фази 29 відкликано після живого прогону): на зовсім малій розмові відношення шумне
            r = clamp(chars / Whole(t), CALIB_MIN, CALIB_MAX)         # Whole = Messages + FIXED_IN_MESSAGES (SP_CTX_02_28)
            IF reg.charsPerToken absent OR |r − reg.charsPerToken| > 0.05 · reg.charsPerToken:
                on the registry chain: re-read TagRegistry; IF not unreadable: charsPerToken = r; write   # збій запису — без наслідків
            RETURN r
        RETURN reg.charsPerToken                                      # без MESSAGES_ROW чи без API-подання — останнє калібрування

    FUNCTION CalibrateBeforeApply():                                  # фаза 29; Flush (SP_CTX_02_06), перед командою compact, лише з правками в черзі; ≤ CALIB_WAIT_MS
        u = $.session.usage({ breakdown: summary }); form = API form    # те саме читання, що в Telemetry; рядків розмови не читає
        t = Measure(u)                                                  # частина Telemetry (SP_CTX_02_28): measure, conversation, attached, fixed — одна функція для обох
        chars = (form not empty AND NOT ApiCut(form)) ? ApiChars(form) : absent
        reg = TagRegistry (cache); IF unreadable or missing: RETURN
        Calibrate(chars, t, reg, save on the registry chain)            # збій, тайм-аут чи `measure` ≠ messages — нічого; застосування бере те відношення, що вже є

    Estimate(chars, ratio?) = ratio ? "~<round(chars / ratio)> tokens" : "~<round(chars / 4)> tokens (approx.)"

Чисельник і знаменник рахують той самий вміст — повідомлення запиту. До 2026-10-12 чисельником були символи рядків `$.session.messages()`, а знаменником — токени `Messages`, куди входять і вкладення хоста, яких рядки не несуть (повторні копії CLAUDE.md після компактизацій, переліки навичок, `deferred_tools_delta`, контекст хуків). У сесії d5614704 (VS Code, Opus 5.5) рядки мали ~186 тисяч символів, вкладення — ще ~250 тисяч, `Messages` — ~206 тисяч токенів: відношення впиралося в CALIB_MIN (записано 1,005), тож кожна оцінка рядка і кожне «frees ~N» (м'яке нагадування, звіт закриття, звіт черги) були завищені приблизно втричі, а вердикт окупності — надто оптимістичний. Тепер чисельник — символи API-подання (нагадування в ньому — текстові блоки), знаменник — Whole: `Messages` разом із рядками розбивки, які лежать у повідомленнях, але лічаться в незмінній частині (FIXED_IN_MESSAGES). Без API-подання (збій читання, подання біля вікна ROW_WINDOW) калібрування не рахується з рядків — лишається збережене: рядки знову поклали б токени вкладень на свої символи. Thinking і медіа не мають символів ні в рядках, ні в чисельнику — їхні токени, як і раніше, розподілено в середньому.

Відношення зберігається в реєстрі тегів сесії (`charsPerToken`), а не в пам'яті модуля: обробник компактизації (звіт застосування, [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)) і BuildSeed мусять мати його без запиту телеметрії — обробник не чекає розбивки (23–87 мс) і не запускає зайвого; перезавантаження модуля його не губить. Після компактизації збережене відношення діє далі (застосування змінює і символи, і токени, але склад розмови переважно той самий), а наступна телеметрія калібрує заново; передача копіює його разом із реєстром. Оцінки, що спираються на збережене відношення: розмір блоку в звіті закриття, розмір етапу і блоку в телеметрії, «freed» звіту застосування й QueueTagReplacements, підсумок журналу. Без відношення (свіжа сесія без відповіді моделі, розмова менша за CALIB_TOKENS, реєстр нечитабельний) — «символи/4» з позначкою `approx.`. Розміри окремих рядків (`<size>c`) лишаються в символах. Калібрування рахує й приховані міркування в середньому по розмові, тож оцінка окремого блоку з багатьма міркуваннями чи без них відхиляється від справжньої в обидва боки; живий сценарій «Повтор на копії сесії» перевіряє, що телеметрія один раз показує виміряне звільнення (`Last apply`), а число звіту позначено як оцінку (критерій ±20 % для оцінки відкинуто, рев'ю 39–40). Залишкове зміщення калібрування (рев'ю 39, прогін на копії сесії: оцінка «freed» на 46 % вища за виміряну): приховані міркування моделі (thinking) мають токени без видимих символів і розподілені нерівно — стиснуті рядки бувають «важкими» на символи, а лишені — на міркування; системні ходи запиту (`role: system`: доставки, промотовані нагадування) мають токени в `Messages`, але не мають символів в API-поданні; медіа рахується токенами без символів; читання бачить не більше ROW_WINDOW рядків. Тому відношення служить лише орієнтовним розмірам переліку, етапу і блоку, а «freed» застосування вимірює телеметрія (`Last apply`, [SP_CTX_02_28](#SP_CTX_02_28)); число звіту позначено як оцінку.

Калібрування перед застосуванням (фаза 29). До фази 29 відношення рахувала лише телеметрія — `context_list`, звіт закриття етапу, SoftHint. Застосування в сесії, де жодна з них не калібрувала (агент поставив правки за `tool_use_id` чи `ref`, не читаючи переліку; м'яке нагадування не спрацювало), брало PLAIN_RATIO, і звіт застосування, «freed» QueueTagReplacements та рядок людини ([SP_CTX_02_43](./context_editor.stages.sp.md#SP_CTX_02_43)) занижували звільнене на JSON і цифрах (живий прогін фази 28, термінал: ~24k проти ~41,5k). Тепер Flush перед командою `compact` калібрує сам (CalibrateBeforeApply): Flush і так чекає між ходами, тож читання розбивки (23–87 мс) і API-подання агента не затримує, а обробник компактизації, як і раніше, телеметрії не просить. Заразом відношення свіжіше: склад розмови змінюється (англійський текст проти JSON), а до фази 29 збережене відношення оновлювала лише телеметрія. Передача калібрування перед засівом не робить: RunHandoff бере відношення старої сесії, як і досі (05_04). Поріг CALIB_TOKENS ([SP_CTX_DEC_30](./context_editor.decisions-21.sp.md#SP_CTX_DEC_30), A): 20 000. Фаза 29 знизила його до 5 000, бо чисельник і знаменник тепер рахують той самий вміст, але живий прогін (`.dev_flow/cache/live-test/phase29-31-results.md`) показав іншу причину шуму: розбивка хоста завищує системний промпт і інструменти на 13–25 тисяч токенів, тож рядок `Messages` малої розмови сильно занижений (stream-json: відношення 4,22 при справжніх ~2,1–2,4, рядок людини занижений на 36–51 %), а термінал 2.1.296 рядка `Messages` не дав зовсім; поріг повернуто до 20 000, де ця похибка відносно мала. Далі описано, що мало дати зниження: Шум малої розмови — thinking і медіа без символів: одна картинка в розмові на 5 тисяч токенів знижує відношення приблизно на третину, і оцінки тоді завищені; межі CALIB_MIN/CALIB_MAX і калібрування на кожному застосуванні та телеметрії тримають це в межах. Живий сценарій «Калібрування перед застосуванням» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)) порівнює рядок людини з проксі; похибка понад 25 % на розмові 5–20 тисяч — повернення до 20 000.

Errors: відмов немає; збій запису відношення — оцінки цього виклику з новим відношенням, наступні — зі старим.

### 02_37. SoftHint  {#SP_CTX_02_37}

Purpose: м'яке нагадування ([C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15), E; [C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02); [SP_CTX_DEC_21](./context_editor.decisions-21.sp.md#SP_CTX_DEC_21); з фази 23 — [SP_CTX_DEC_23](./context_editor.decisions-21.sp.md#SP_CTX_DEC_23)) — окремий рядок-пропозиція з префіксом SUGGESTION, лише коли є що пропонувати: пакет усіх ще не стиснутих кандидатів як одне застосування — яка дія (які `cN` стиснути, чи закрити відкритий етап), що вона звільняє, скільки коштує кешу промпту і вердикт беззбитковості ([SP_CTX_02_38](#SP_CTX_02_38)). Два канали: (1) розміру — у результаті великого виводу чи пошуку (виклик, що отримав позначку, [SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)), коли рядки розмови ≥ Threshold(window) і запит від минулої пропозиції виріс на Step(window); (2) ходу — прихованим контекстом наступного промпту людини між ходами ([SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)), коли від минулої пропозиції набралося HINT_RUN позначених виводів: кінець ходу — природна межа пакета. Обидва — лише коли пакет звільняє ≥ max(HINT_CANDIDATES, HINT_BATCH · розмова). Рядок нічого не ставить у чергу, не закриває етапу і не запускає оптимізації: рішення — за агентом. До фази 23 рядок стояв на місці рядка псевдоніма й починався ним, другим моментом був перший запис файлу після серії позначених виводів, поріг розміру — 50 тисяч, а вердикту не було.

Input: порти: TagRegistry, AliasRegistry (на ланцюжку псевдонімів, уже з псевдонімом цього виклику), Queue, CurrentRows, звичайна `usage` (1–3 мс; `context.tokens` — увесь останній запит з незмінною частиною, `context.window`), `usage` з розбивкою (23–87 мс), запис стану на ланцюжку реєстру тегів з повідомленням, чи записано. Пам'ять модуля, спільна для обох каналів: `checked: int?` — розмір запиту останньої перевірки за розміром, яка читала рядки і пропозиції не дала (або запізнилась); `busy: bool` — перевірка йде зараз.

Processing logic (pseudocode):
    Threshold(window) = window ? min(HINT_CONVERSATION, round(HINT_WINDOW_SHARE · window)) : HINT_CONVERSATION
    Step(window)      = window ? min(HINT_STEP, round(HINT_STEP_SHARE · window)) : HINT_STEP

    FUNCTION SoftHint(deadline):                                           # канал розміру: після позначеного виводу
        IF busy: RETURN none; busy = true; … ; finally busy = false        # одна перевірка за раз на обидва канали
        reg = TagRegistry; aliases = AliasRegistry
        IF reg is not ok OR aliases is unreadable OR no tag of reg is review: RETURN none
        state = reg.hint; next = aliases.next
        tokens, window = plain usage                                       # 1–3 мс
        IF state.tokens present AND tokens present AND tokens < state.tokens:   # застосування, компактизація чи передача між пропозиціями
            checked = none; in the background: CAS(state → { tokens, marks: next }); RETURN none   # і серію каналу ходу: виводи до застосування вже були в його пакеті (рев'ю 54)
        IF tokens absent: RETURN none                                      # моделі ще не відповідали
        T = Threshold(window)
        IF tokens < T OR tokens − (state.tokens or 0) < Step(window): RETURN none   # запит містить незмінну частину: менший запит — менша розмова
        IF checked present AND checked ≤ tokens < checked + HINT_RECHECK: RETURN none
        Settle = checked = tokens                                          # перевірка, що нічого не дала чи запізнилась, чекає HINT_RECHECK росту
        rows = CurrentRows(); cands = Candidates(rows, reg, Queue.edits (unreadable → []), aliases)
        IF Freed(cands, reg.charsPerToken or 4) < HINT_CANDIDATES: Settle; RETURN none   # до розбивки
        (conversation, whole, ratio) = Measure(rows, reg)
        IF conversation < T: Settle; RETURN none
        p = Propose(rows, cands, { ratio, conversation, whole, request: tokens, channel: size, api: API form, ratios: CostRatios($.session.model()) })   # API і модель — лише тут, після дешевих порогів; збій — рядки самі, DEFAULT_RATIOS
        IF p.freed < max(HINT_CANDIDATES, HINT_BATCH · conversation): Settle; RETURN none
        line = SuggestionText(p)                                           # і з вердиктом «not worth it yet»: розмова вже велика (SP_CTX_DEC_23)
        Claim({ tokens, marks: next, proposed: p.freed }) — late: Settle; RETURN none; taken: RETURN none
        checked = none; RETURN line

    FUNCTION TurnSuggestion(deadline):                                     # канал ходу: промпт людини між ходами без optimize (SP_CTX_02_08)
        busy as above; reg, aliases and their gates as above
        state = reg.hint; next = aliases.next
        IF next − (state ? state.marks : 1) < HINT_RUN: RETURN none        # без жодного читання хоста
        Settle = in the background: CAS(state → { tokens: state.tokens, proposed: state.proposed, marks: next })   # перевірка споживає серію: наступна — після нової
        rows, cands as above; IF Freed(cands, reg.charsPerToken or 4) < HINT_CANDIDATES: Settle; RETURN none
        (conversation, whole, ratio) = Measure(rows, reg); tokens, window = plain usage
        p = Propose(rows, cands, { ratio, conversation, whole, request: tokens, channel: turn, stage: reg.stage ? reg.stage.name : none, api, ratios })
        IF p.freed < max(HINT_CANDIDATES, HINT_BATCH · conversation): Settle; RETURN none
        IF NOT (state.tokens present AND tokens present AND tokens < state.tokens)          # без застосування між ними
           AND state.proposed present AND p.freed − state.proposed < max(HINT_CANDIDATES, HINT_BATCH · conversation): Settle; RETURN none   # пакет, який агент лишив, — знову лише коли виріс на цілий пакет (рев'ю 54)
        IF p.verdict = not-yet AND conversation < Threshold(window): Settle; RETURN none   # мала розмова і невигідно: нічого пропонувати (SP_CTX_DEC_23)
        line = SuggestionText(p)
        Claim({ tokens, marks: next, proposed: p.freed }) — late: Settle; RETURN none; taken: RETURN none   # tokens absent — без поля
        checked = none; RETURN line

    Claim(next): IF deadline expired: late; on the registry chain: IF deadline expired: late; IF reg.hint still = state: claimed; hint = next; write ELSE taken   # паралельний виклик уже дав рядок — другого немає
    Measure(rows, reg): t = Telemetry(rows, reg without lastApply, api, cache = false); ratio = t.ratio or reg.charsPerToken or 4   # SP_CTX_02_28: рядок MESSAGES_ROW і калібрування за API-поданням (те саме читання знімка, що й у Propose); lastApply лишається для телеметрії агента
                        conversation = t.measure = messages ? t.conversation : (t.chars or Σ size(rows)) / ratio
                        whole = Whole(t) or conversation                                   # SP_CTX_02_28: з рядками незмінної частини, що лежать у повідомленнях

    Candidates(rows, reg, queued, aliases): for each tag of reg with kind = review AND IsActive(tag, reg.turn) whose target resolves on rows:
        skip it IF a queued edit touches its target (TouchedBy: its tool_use_id or any of its rows)   # правка вже в черзі, застосується в кінці ходу
        pair target: skip it IF the result's text is ReplacementText (SP_CTX_01_12; фаза 28 — без MARK, старі — з ним); chars = len(result text); alias = alias of its tool_use_id, if any; reproducible = the call's tool IN REPRODUCIBLE_TOOLS
        row target: chars = Σ size of its rows; no alias; reproducible = false
        row = the first row of the target
      sorted by chars descending, then by row

    Freed(cands, ratio) = Σ (t − Summary(t, reproducible)), t = chars / ratio of each candidate   # Summary — SP_CTX_02_38

    Propose(rows, cands, { ratio, conversation, whole, request, channel, stage, api, ratios }):   # whole відсутній — conversation
        freed = Freed(cands, ratio); summary = Σ Summary(t, reproducible)
        cost = CacheCost(rows, the least row of cands, freed, whole, ratio, margin = ∞, api)   # типове застосування: уся розмова (SP_CTX_DEC_22) з вкладеннями
        rHat = Requests(rows, api); rStar = BreakEven(cost.rewrite, freed, summary, request or whole, ratios or DEFAULT_RATIOS); verdict = Verdict(rStar, rHat)
        IF channel = size:                                                # варіант з keep_cache; канал ходу пропонує на початку ходу — завжди глибоко (рев'ю 54)
            k = CacheCost(…, margin = APPLY_MARGIN, api); kStar = BreakEven(k.rewrite, …); kVerdict = Verdict(kStar, rHat)
            IF k.within AND kVerdict better than verdict: keep = { cost: k, rStar: kStar, verdict: kVerdict }
        named = the aliases of cands in their order, at most HINT_NAMES; more = len(cands) − len(named)
        RETURN { channel, stage, named, more, freed, conversation, cost, rStar, rHat, verdict, keep }

    SuggestionText(p) = SUGGESTION + " " + by verdict and channel, with
        names = named joined ", " + (more ? " +<more> more (see context_list)" : "")        # без псевдонімів — "<more> candidates (see context_list)"
        what  = named ? "summarize <names> by ref" : "compress <names>"
        verb  = not-yet ? "would rewrite" : "rewrites"; whole = "<verb> the prompt cache of all the request's messages once (~<rewrite>)"
        cache = turn ? whole + ": edits queued now apply when this turn ends, beyond the ~20 positions the API looks back"
              : positions + APPLY_MARGIN > 20 ? whole + ": its earliest row is ~<positions> positions back, beyond the ~20 the API looks back"
              : whole
        keep present (size only): "<what> in one context_edit with \"keep_cache\": true: frees <gain>; that keeps the prompt cache up to the earliest and rewrites only the rows from it (~<keep.rewrite>) if you end the turn within a few calls (edits apply when it ends; the earliest is ~<keep.positions> positions back now, and past ~20 the API finds no cache); <pays(keep.rStar)> → <keep verdict>. Without keep_cache: all the request's messages (~<rewrite>), pays back after ~<rStar> → <verdict>."
        pays  = "pays back after ~<rStar> requests, this conversation has made ~<rHat>"   # rStar округлено; ≥ 100 000 — "100000+"
        gain  = "~<freed> of the ~<conversation> conversation"
        not-yet (both): "not worth it yet: to <what> would free <gain> but <cache>; <pays>. Batch more, or compress at the end of a stage."
        size:           "<what> in one context_edit: frees <gain>; <cache>; <pays> → <verdict>."
        turn:           "before you go on: " + (stage ? "close stage \"<stage>\" with context_tag and " : "") + "<what> in one context_edit? It frees <gain>; <cache>; <pays> → <verdict>. Your call: nothing runs unless you do it."
        verdict: worth → "worth it now"; borderline → "borderline: worth it only if the work goes on that long"
      numbers of tokens in thousands as TelemetryText ("~12k")

    CallLines(marked, alias, hint) = marked ? (alias ? [alias line] : []) + (hint ? [hint] : []) : []   # порядок рядків виклику (SP_CTX_02_16)

    Bounded(work, HINT_WAIT): the line of `work`, or none once HINT_WAIT passes first; a claim made before that is waited for, so a written state always has its line, and after it no claim writes

Приклади (модульні тести фази 23; вікно 1M, Opus 5.5). Канал розміру, кандидати щойно прочитані, сесія довга — `keep_cache` змінює вердикт, тож рядок його називає: `[context-editor: suggestion] summarize c1, c2, c3, c4, c5 by ref in one context_edit with "keep_cache": true: frees ~38k of the ~200k conversation; that keeps the prompt cache up to the earliest and rewrites only the rows from it (~13k) if you end the turn within a few calls (edits apply when it ends; the earliest is ~10 positions back now, and past ~20 the API finds no cache); pays back after ~53 requests, this conversation has made ~155 → worth it now. Without keep_cache: all the request's messages (~163k), pays back after ~209 → borderline: worth it only if the work goes on that long.` Ті самі кандидати за 15 обмінами з людиною (поза вікном, `keep_cache` не допоможе): `… rewrites the prompt cache of all the request's messages once (~163k): its earliest row is ~40 positions back, beyond the ~20 the API looks back; pays back after ~209 requests, this conversation has made ~170 → borderline: worth it only if the work goes on that long.` Рано в сесії (і з `keep_cache` невигідно): `[context-editor: suggestion] not worth it yet: to summarize c1, c2, c3, c4, c5 by ref would free ~38k of the ~200k conversation but would rewrite the prompt cache of all the request's messages once (~162k); pays back after ~208 requests, this conversation has made ~5. Batch more, or compress at the end of a stage.` На Sonnet 5.5 той самий пакет вигідний і без `keep_cache` (`pays back after ~105 requests … → worth it now`), і рядок поля не називає. Канал ходу з відкритим етапом: `[context-editor: suggestion] before you go on: close stage "read" with context_tag and summarize c1, c2, c3, c4, c5 by ref in one context_edit? It frees ~38k of the ~200k conversation; rewrites the prompt cache of all the request's messages once (~163k): edits queued now apply when this turn ends, beyond the ~20 positions the API looks back; pays back after ~209 requests, this conversation has made ~255 → worth it now. Your call: nothing runs unless you do it.`

Чому так. Пропозиція — одна дія над усім пакетом, бо ціна застосування визначається не обсягом, а тим, де перша зміна: усередині вікна пошуку кешу платиться лише хвіст, поза ним — уся розмова, хоч би скільки правок було в пакеті (спайки кешу й ефективності; [SP_CTX_02_38](#SP_CTX_02_38)). Агент практики 5 (P22) прочитав рядок фази 22 як службову довідку через спільний префікс з рядками псевдонімів і попросив окремий рядок, конкретну дію з вердиктом «вигідно / невигідно» і пропозицію наприкінці ходу; він сам оцінив стиснення c11–c13 як «збиток або нуль» — правило беззбитковості дає ~150 запитів проти 14 зроблених, тобто «not worth it yet». Поріг розміру — на рядках розмови (MESSAGES_ROW), бо незмінна частина залежить від хоста; 150 тисяч рядків розмови — початок зони L_q спайку ефективності (контекст ~200k), де R̂ уже десятки запитів і за ціною проходять пакети етапів; частка вікна тримає канал живим у вікні 200k. Крок 75 тисяч — 20–50 запитів робочої сесії між рядками. Пакет ≥ 10% розмови — гістерезис спайку, який прибирає часті дрібні застосування. «Not worth it yet» канал розміру каже коротко, бо розмова вже велика: для мети розробника вирішальне місце, і агент має бачити обмін місця на ціну, а рядок підказує, як зробити його вигідним (більший пакет, кінець етапу); канал ходу в малій розмові за такого вердикту мовчить — тиску місця немає, а рядок був би шумом (P19). Канал ходу замінив перший запис файлу: мод не бачить наміру писати, тож рядок межі етапу приходив уже після запису, а кінець ходу — межа, яку бачить і мод; агент отримує пропозицію разом із наступним завданням людини і вирішує, чи закрити етап зараз. Типове застосування переписує всю розмову (заморожений префікс — лише з `keep_cache`, [SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22)); варіант з `keep_cache` рядок називає лише тоді, коли той змінює вердикт, і разом з компромісом відновлення — рішення за агентом. Глибина міряється зараз, а правки застосовуються в кінці ходу (рев'ю 54): для варіанта з `keep_cache` канал розміру додає APPLY_MARGIN позицій і каже агенту, що неглибока ціна — лише якщо хід скінчиться за кілька викликів; канал ходу пропонує на початку ходу, тож до застосування пройде весь хід — правку він вважає глибокою завжди. Пакет, який агент лишив без дії, канал ходу не повторює з кожною серією: лише коли той виріс на цілий пакет (max(HINT_CANDIDATES, HINT_BATCH · розмова)) або між ними було застосування (менший запит). Відношення цін — за родиною моделі (CostRatios). Холодний кеш (пауза людини понад TTL) не робить пропозицію вигідною: правки застосовуються в кінці ходу, у якому агент їх поставив, а перший запит цього ходу вже переписав кеш. Кандидати — ті самі активні `review`, що в рядку `Candidates` телеметрії, без уже поставлених у чергу (у довгому ході правки застосовуються лише в його кінці) і без замінених; поточний вивід кандидатом ще не є (його тег ставить AutoTag після цього хука, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)); «+n more (see context_list)» лише відсилає до переліку, де вони мають `[review: …]`. Рядок псевдоніма лишається як до фази 22: пропозиція — окремий рядок після нього (P19 — кандидат беклогу).

Що звільняє пакет, рахується символами рядків кандидатів за відношенням (правки замінюють саме рядки); «of the ~N conversation» — виміряний рядок `Messages`; що переписує застосування — з вкладеннями хоста: глибоке — Whole, з `keep_cache` — хвіст API-подання (TailTokens, [SP_CTX_02_38](#SP_CTX_02_38)). Тому число «rewrites … (~Z)» може бути більшим за різницю розмови і звільненого: Z містить і пам'ять та переліки першого повідомлення, і рядок називає його «all the request's messages», а не «the whole conversation», щоб розбіжність не читалась як помилка (2026-10-12, рев'ю).

Ціна на гарячому шляху. Кожен позначений вивід читає два малі реєстри (тегів і псевдонімів; з фази 11 аудиту — з кешу в пам'яті модуля, [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07), без файлової системи, доки їх не змінив запис) і звичайну `usage` (1–3 мс); рядки розмови й черга читаються лише після дешевих порогів (запит ≥ Threshold, ріст ≥ Step, не раніше ніж через HINT_RECHECK після невдалої перевірки), розбивка (23–87 мс) і API-подання (для калібрування, далі те саме читання — для CacheCost) — лише коли кандидатів досить. Кожен промпт людини між ходами читає ті самі два реєстри; рядки й розбивку — лише раз на серію з HINT_RUN позначених виводів. Результат і промпт чекають не довше HINT_WAIT; калібрування з розбивки пишеться у фоні; CacheCost — лінійний прохід по рядках.

Errors: відмов немає; будь-який збій — рядок псевдоніма без пропозиції (промпт — без неї), стан не змінюється. Стан пишеться порівнянням-і-записом: якщо паралельний виклик змінив `hint` між читанням і записом, другий рядок не з'являється.

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): при `passed` підказка не додається в жодному каналі.

### 02_38. CacheCost  {#SP_CTX_02_38}

Purpose: оцінити, скільки кешу промпту коштує застосування, і чи окупиться воно ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02); спайки [context_editor_cache](./context_editor_cache.spike.md) і [context_editor_efficiency](./context_editor_efficiency.spike.md); [SP_CTX_DEC_23](./context_editor.decisions-21.sp.md#SP_CTX_DEC_23)). Чисті функції `hooks/cache.ts`; читають SoftHint ([SP_CTX_02_37](#SP_CTX_02_37)) і Telemetry ([SP_CTX_02_28](#SP_CTX_02_28)). Фаза 23.

Модель. Хост ставить мітки кешу на системний промпт і на останній блок двох останніх повідомлень кожного запиту; мітка знаходить попередній запис кешу не далі ніж за CACHE_LOOKBACK позицій назад (навичка plugin-hooks, пункти 53–55). Тому перший запит після застосування читає кеш до першої зміни, лише коли від неї до кінця розмови ≤ CACHE_LOOKBACK позицій, і тоді пише лише хвіст від неї; глибше — читає тільки незмінну частину (`tools + system`, P0) і пише всю розмову. Повідомлення запиту — це C − P0 = Whole ([SP_CTX_02_28](#SP_CTX_02_28)): рядок MESSAGES_ROW разом із рядками розбивки FIXED_IN_MESSAGES (файли пам'яті, перелік навичок, інструкції MCP, агенти), які лежать у першому повідомленні, хоч розбивка лічить їх у незмінній частині; до 2026-10-12 запис глибокої правки рахувався без них і був занижений на ці 15–20 тисяч токенів. Типове застосування перезбирає відрізок і прибирає всі власні пари, тож переписує всю розмову; лише з `keep_cache` ([SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22)) першою зміною FrozenPrefix ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) робить відповідь найранішої правки, і тоді діє вікно; до фази 23 мод сам зсував її на початок ходу чи розмови, і спайк ефективності міряв лише режим «уся розмова» (`p0`).

Processing logic (pseudocode):
    Kinds(row): assistant → "text" if text, then "use" per call; neither → "thinking"   # thinking видно лише як рядок без тексту й викликів (навичка plugin-hooks, пункт 36)
                user → "result" per result, then "text" if text or no result; a user row that is no PromptRow and has no results → nothing   # порожній рядок усередині відповіді не ділить серію результатів (PL_AUD_CTX фаза 8, рев'ю)
    Responses(rows, api), ResponseStart(rows, at, api), PromptRow: of SP_CTX_02_04, the one source with FrozenPrefix   # рев'ю 54; PL_AUD_CTX фаза 8 — раніше тут був свій прохід зі своїм предикатом промпту
    CacheShape(rows, api) = (Responses(rows, api), Positions(rows, ·, api)), once for every estimate over the same rows and api   # Propose рахує його раз на пропозицію
    Positions(rows, i, api) = from the start of rows[i]'s response to the end, each response counted in the order the host sends it — the kinds of its assistant rows, then of its other rows —
        so that a "use" right after a "use" and a "result" right after a "result" (also across responses) add nothing   # серії — одна позиція (довідка API; спайк кешу, Entry 4)
    LookbackStart(rows, api) = the least k such that Positions(rows, ResponseStart(rows, j, api), api) ≤ CACHE_LOOKBACK for every j in k..len(rows)−1; len(rows) when not even the last row passes   # такий k — сам свій ResponseStart; без API-подання годяться лише початки відрізків (PL_AUD_CTX фаза 8, рев'ю)
    ApiTailChars(rows, start, api) = ApiChars(api[m..]), m = the API message of the first assistant row k ≥ start that one holds (by a call id, else by its text); a user row at start (a prompt) → m − 1 when api[m − 1] is user (the prompt with its attachments); none when no such row
    TailTokens(rows, start, ratio, whole) = min(whole, round(t)), t = ApiTailChars present ? ApiTailChars / ratio
                                            : whole present ? Σ size(rows[start..]) · whole / Σ size(rows)   # без подання: вкладення в середньому
                                            : Σ size(rows[start..]) / ratio
    CacheCost(rows, first, freed, whole, ratio, margin = 0, api):     # whole = Whole (SP_CTX_02_28) — усі повідомлення запиту
        start = ResponseStart(rows, first, api); positions = Positions(rows, start, api); within = positions + margin ≤ CACHE_LOOKBACK   # той самий початок, що FrozenPrefix застосування з тим самим api
        RETURN { start, positions, within, rewrite: max(0, (within ? TailTokens(rows, start, ratio, whole) : whole) − freed) }
    Requests(rows, api) = max(1, number of assistant rows i with Responses(rows, api).start[i] = i)   # R̂: запити розмови досі; копернікова оцінка — попереду стільки ж
    Summary(t, reproducible) = min(t, max(min, share · t)), SUMMARY_REPRO for a reproducible output, SUMMARY_OTHER otherwise
    CostRatios(model) = the first row of the CostRatios table (01_12) whose pattern the model id matches (Fable/Mythos 5.1, Fable/Mythos, Opus 5.5 ids and the bare alias opus / opus[1m], Sonnet/Haiku); none → DEFAULT_RATIOS   # інший Opus — DEFAULT_RATIOS; псевдонім іде за поточним Opus (5.5), переглянути, коли він зміниться (CF-26)
    BreakEven(rewrite, freed, summary, request, r) = ((r.write − 1) · rewrite + r.out · summary + request) / freed   # freed ≤ 0 → ∞
    Verdict(rStar, rHat) = rStar ≤ rHat ? worth : rStar > VERDICT_MARGIN · rHat ? not-yet : borderline

BreakEven — точка беззбитковості спайку ефективності (Entry 4): чистий виграш після R запитів `G(R) = r_r·Δ·R − (r_w − r_r)·(x − Δ) − r_out·S − n_x·r_r·C` дорівнює нулю при `R* = (ρ_w − 1)·(x − Δ)/Δ + ρ_o·S/Δ + n_x·C/Δ`; тут `ρ_w`, `ρ_o` — CostRatios моделі (у спайку — 40 і 100 з калібрування за `costUSD`; з рев'ю 54 — опубліковані ціни за родиною моделі), `n_x = 1` (запит, що ставить правку, читає весь контекст C), `x − Δ = rewrite`, `Δ = freed`, `S = summary`. Від спайку відрізняється `x`: хвіст від відповіді найранішої правки в межах вікна і вся розмова поза ним (спайк кешу, рекомендація «режим вікно»), а не завжди вся розмова. Приклад P22 (контекст 84k, перебудова 44k, звільнено 12k) — R* = 150 на Opus 5.5 і ~77 на Sonnet 5.5. Без API-подання (телеметрія, збій читання) паралельні виклики, записані «виклик, результат, виклик», рахуються окремими відповідями: позицій більше, R̂ теж більше (рев'ю 54) — тому SoftHint читає API-подання після дешевих порогів. Початок CacheCost без нього — початок відрізка (запасна межа ResponseStart), як і FrozenPrefix застосування з тим самим поданням: вердикт тоді консервативний, а не «вигідно» за межею, якої застосування не дасть (PL_AUD_CTX фаза 8). З тієї ж причини рядок `Cache` телеметрії ([SP_CTX_02_28](#SP_CTX_02_28)) читає API-подання для LookbackStart (`context_list`, звіт закриття етапу; збій читання — без нього, тоді годяться лише початки відрізків), а канал розміру SoftHint, якому рядок `Cache` не потрібен, його для телеметрії не читає. Оцінка R̂ — копернікова (попереду стільки ж запитів, скільки позаду), груба, тож вердикт має три значення із запасом VERDICT_MARGIN. Позиції — за рядками: блоки вкладень промпту, доставки й кілька блоків thinking одного рядка не видно, тож оцінка оптимістична на 1–3 позиції; глибина міряється зараз, а застосування буде в кінці ходу, коли хвіст ще виросте, — звідси `margin` (APPLY_MARGIN для каналу розміру, ∞ для каналу ходу). Межу й вердикт калібрує живий сценарій 05_03 «Кеш після застосування».

Запис рахує те, що тримає запит, а не лише рядки: з відношенням за API-поданням ([SP_CTX_02_34](#SP_CTX_02_34), ~2 символи на токен у сесії d5614704) хвіст лише з символів рядків був би занижений утричі — у ньому немає нагадувань і контексту хуків, які хост вкладає в кожен промпт. Тому хвіст береться з API-подання від повідомлення відповіді найранішої правки; без подання — символи рядків хвоста з густиною вкладень усієї розмови (Whole на символ рядка), а не за відношенням.

Errors: відмов немає (чисті функції).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділи перенесено дослівно з [context_editor.stages.sp.md](./context_editor.stages.sp.md): поділ файлу за модулями, якорі ті самі (structural-event) |
