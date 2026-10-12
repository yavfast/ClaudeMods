# Редактор контексту агента — Specification: Contracts: stages, notes, deliveries, hints, cache

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-11
> **Updated:** 2026-10-12
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_27–02_38 і 02_42 специфікації [SP_CTX](./context_editor.sp.md): контракти SessionIntro, Telemetry, StageBlock, DetectOptimize, Journal, `context_note`, NoteReminders, Estimate, RecordDelivery, InsertDeliveries, SoftHint, CacheCost, PersonCompact (`/compact` людини, фаза 25). Читати перед зміною `hooks/stages.ts`, `notes.ts`, `journal.ts`, `deliveries.ts`, `hints.ts`, `cache.ts` або `personcompact.ts`.

## Contents

Розділи цього файлу (h3 розділу «02. Contracts» парасольки):

- [02_27. SessionIntro](#SP_CTX_02_27)
- [02_28. Telemetry](#SP_CTX_02_28)
- [02_29. StageBlock](#SP_CTX_02_29)
- [02_30. DetectOptimize](#SP_CTX_02_30)
- [02_31. Journal](#SP_CTX_02_31)
- [02_32. context_note](#SP_CTX_02_32)
- [02_33. NoteReminders](#SP_CTX_02_33)
- [02_34. Estimate](#SP_CTX_02_34)
- [02_35. RecordDelivery](#SP_CTX_02_35)
- [02_36. InsertDeliveries](#SP_CTX_02_36)
- [02_37. SoftHint](#SP_CTX_02_37)
- [02_38. CacheCost](#SP_CTX_02_38)
- [02_42. PersonCompact](#SP_CTX_02_42)
- [02_43. ApplyLine і LogApply](#SP_CTX_02_43)

## 02. Contracts — етапи, телеметрія, нотатки, доставки, нагадування, кеш

### 02_27. SessionIntro  {#SP_CTX_02_27}

Purpose: на початку кожної сесії сказати агенту, що він може позначати етапи, просити оптимізацію міткою і бачити телеметрію, а м'яке нагадування ([SP_CTX_02_37](#SP_CTX_02_37)) лише інформує ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15); [SP_CTX_DEC_11](./context_editor.sp.md#SP_CTX_DEC_11)): коротка інструкція прихованим контекстом першого промпту і навичка мода з повним посібником.

Processing logic (pseudocode):
    # частина хука prompt.submit DeliverReport (SP_CTX_02_08)
    ON prompt submitted (main conversation, passes the mod's hooks):
        IF storage ready AND TagRegistry state IN (ok, missing) AND introduced = false:
            add INTRO_TEXT as hidden context, before the report
            once the prompt entered (no drop): on the registry chain, re-read TagRegistry; IF not unreadable: introduced = true; write (missing → a new registry with defaults)

Прапорець `introduced` живе в реєстрі тегів сесії ([SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10)), тож перезавантаження модуля інструкції не повторює. Сесія — за ідентифікатором: після `/clear` чи `/resume` у тому самому процесі сховище інше (PrepareStorage, [SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15)), і перший промпт нової сесії отримує інструкцію знову; відновлена `/resume` сесія, що вже мала інструкцію, має `introduced = true` і повтору не отримує. Передача копіює реєстр з `introduced = false` ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)). Промпти, які мод надсилає сам (продовження, хід оптимізації, Deliver передачі), хука не проходять (F1), тож інструкцію несе перший промпт людини або іншого розширення. Сховище недоступне або реєстр `unreadable` — інструкції немає: інструменти тоді й так відмовляють, а доставку нема де записати.

Навичка мода. Файл `mods/context-editor/skills/<SKILL>/SKILL.md` поруч із `hooks/`; агент бачить її в переліку навичок як `context-editor:<SKILL>` з описом із frontmatter і відкриває повний текст сам (навичка plugin-hooks, пункт 39). Вимоги до файлу:

| Part | Requirement |
|------|-------------|
| frontmatter `name` | дорівнює SKILL |
| frontmatter `description` | одне речення англійською, ≤ 250 символів: коли відкривати навичку — довга або багатоетапна задача з модом context-editor, рішення про етапи, стискання блоку, мітку, телеметрію, і що означають рядки `Later, your context_…` (з фази 28) і `[context-editor]`; після фази 28 — 236 символів (рев'ю: 261 перевищувало межу) (з фази 26, [SP_CTX_DEC_28](./context_editor.sp.md#SP_CTX_DEC_28): `… the optimization mark, the telemetry, and what rows marked [context-editor] mean.`, 216 символів) |
| розділ «Stages» | коли відкривати етап (початок логічного блоку роботи: фаза, підзадача, дослідження) і закривати (блок завершено, результат відомий); етапи пласкі, `open` закриває поточний; `open` з `index`; `open` з `index` + `close` для блоку, який не відкривали |
| розділ «Compressing a block» | одна `context_edit` на блок; шаблон запису етапу (мета; рішення з причиною, дослівними словами людини і причинами відмови від інших варіантів — пропозиція P11; перевірені факти з джерелами — шляхи, рядки, версії; змінені артефакти; відкриті питання — пропозиція P5); що зазвичай лишається дослівно ([C_CTX_DEC_04](./context_editor.concept.md#C_CTX_DEC_04)); відтворюване (`~`: Read, Grep, Glob) — вказівник «що, де, що знайдено — перечитати за потреби», невідтворюване (відповіді людини, зокрема через AskUserQuestion — P12, живі проби, звіти субагентів, веб-вміст) — обережний підсумок або без змін (пропозиція P2); медіа — описом, якщо завдання дозволяє; одне речення: застосування прибирає з розмови власні виклики `context_*`, а теги й нотатки лишаються — пропозиція P13; застосування переписує кеш промпту один раз — тож правки блоку одним викликом; `"keep_cache": true` зберігає його до найранішої правки, якщо в кінці ходу вона в межах останніх ~20 позицій (рядок `Cache:`), але пізніше відновлення може показати раніші відповіді двічі (фаза 23, [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22), [SP_CTX_02_38](#SP_CTX_02_38)) |
| розділ «Dead ends» | `disposable` з нотаткою на діапазон `index`..`to` у мить відмови від гілки (пропозиція P4) |
| розділ «Optimization mark» | OPTIMIZE_MARK дослівно; ставити окремим останнім рядком фінальної відповіді ходу (посеред тексту чи з іншим текстом у рядку вона не діє), коли агент завершує хід для людини, а посеред роботи — закривати етап інструментом; у ході оптимізації взяти діапазон з рядка `Last block #a..#b` заголовка `context_list` і перелічити рядки від `from = a` перед правками за індексом; хід оптимізації — звичайний хід, заміни з тегів ставляться на кінці ходу з міткою, після оптимізації сесія зупиняється, якщо агент не передасть `"resume": true` ([SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16); до фази 18 — «зазвичай зупинитися (`resume: false`)»; рядок фази 18: `Then the session stops unless "resume": true. Mid-work, close the stage with the tool.`; у розділі про правки — виняток ходу оптимізації `(in an optimization turn only with "resume": true)`; файл — 7991 символ, 7997 байтів); мітка в ході оптимізації не діє |
| розділ «Telemetry» | `context_list` з `count: 0`; що означають рядки TelemetryText ([SP_CTX_02_28](#SP_CTX_02_28)); м'яке нагадування — рядок `[context-editor: suggestion]` (коли контекст росте або з наступним промптом людини після багатьох читань), що пропонує пакет з виграшем, ціною кешу і вердиктом і лише інформує ([SP_CTX_02_37](#SP_CTX_02_37); до фази 23 — рядок `[context-editor]` з кандидатами й розмірами, зокрема на першому записі після багатьох читань); рішення — за логічним станом роботи, а не за розміром; вбудована компактизація хоста — запобіжник |
| розділ «Candidates» | причини `review`: `big`, `search`, `stale`, `duplicate`, `agent` ([SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)) і що з ними робити; `[review]` без причини (тег зі старішої версії) пояснює опис `context_list`, тож навичка з фази 22 цього речення не має (місце — для м'якого нагадування) |
| розділ «Compressed rows and mod texts» | з фази 28 (до неї — «Rows marked [context-editor]», фази 26–27, [SP_CTX_DEC_28](./context_editor.sp.md#SP_CTX_DEC_28)): текст, що починається з `Later, your context_edit` чи `Later, your context_tag`, — власна заміна агента (прочитав оригінал, потім стиснув, щоб звільнити контекст; не втрата і не вигадка); початки чотирьох текстів (SUMMARIZED, `collapsedWords` з переліком і полем `collapsed` носія, `rewrite`, `describe`; після `describe` на промпті людини — її власні слова), стара форма `[context-editor] you read …, then replaced …` — те саме; архів (`(original: …)`, `(media: …)`, `media carried as files`); текст з `[context-editor` чи `context-editor:` — мода: звіт застосування (виклики `context_*`, що зробили заміни, прибрано, а процитоване з їхніх результатів — справжнє), рядок `/compact` мода; службові тексти (псевдонім, нагадування нотатки, SUGGESTION, мітка обрізання, продовження, хід оптимізації чи `/compact`, документ передачі) ([SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17), A″) |
| розділ «Notes» | інструмент `context_note`: кілька нотаток на рядок, діапазон чи пару, нуль токенів; приклади — одразу позначити, що рядок можна видалити чи стиснути і як; нагадування собі через `remind_in_turns`; перехресне посилання між рядками; нотатка переходить на рядок заміни і зникає з прибраним рядком; нагадування приходить один раз з результатом наступного виклику будь-якого інструменту основної розмови, зокрема інструментів мода, крім `context_edit` і `context_handoff`; текст нотатки — про зміст, а не про номери рядків: індекси після застосування застарівають (прогін на копії сесії, фаза 17) |
| розділ «State slot» | один власний текстовий рядок з тегом `state`; оновлювати `rewrite` на місці, не дописувати новий стан у кінець ([C_CTX_DEC_19](./context_editor.concept.md#C_CTX_DEC_19)); кожне оновлення — застосування (з фази 23 текст: `Each update is an apply: do it together with a block's edits, not on its own.`), тож оновлювати його разом із правками блоку, а не окремо (прогін на копії сесії: правка біля початку розмови ~250 тисяч токенів коштувала ~$0.9) |
| розмір | ≤ 9000 символів разом із frontmatter (до фази 26 — ≤ 8000; межу піднято для розділу «Rows marked [context-editor]», [SP_CTX_DEC_28](./context_editor.sp.md#SP_CTX_DEC_28); після фази 26 і рев'ю — 8997 символів; після фази 27 — 8995: перелік згорнутого і поле `collapsed` у розділі «Rows marked [context-editor]», а приклад «an investigation» у «Stages» і «they change nothing» у «Notes» вилучено); мова — англійська, як у всіх текстах для агента (після фази 22 — 7953 символи: речення про м'яке нагадування вміщено скороченням наявних; після фази 23 — 7982 (з живого прогону: речення про `keep_cache` і його компроміс замість речення про кеш з кінцем ходу; до того — 7992): речення про кеш (з кінцем ходу), власні виклики від найранішої правки і рядок пропозиції вміщено скороченням рядка `Tools:` до назв інструментів, пункту `[pin]` у «Candidates», який дублював речення розділу «Compressing a block», і речення про повторні читання в «Restoring an original»). Після фази 17 файл — 7916 символів, тож новий зміст фази 15 (слот стану, причини `review`, `~`, діапазон, журнал, речення P13, нотатки про зміст) вміщується скороченням наявних розділів (рішення розробника на design sign-off фази 15; [PL_CTX_P15](./context_editor.plan.md#PL_CTX_P15)); після фази 28 — 8988: розділ «Compressed rows and mod texts» і опис з відкривачем `Later, your context_…`. Обидві межі (опис ≤ 250, файл ≤ 9000) перевіряє `sh mods/context-editor/tests/skill-limits.sh`: `claude plugin test` запускає тести без файлової системи, тож модульний тест SKILL.md не прочитає |

Формулювання розділів пише план; специфікація задає обов'язкові частини, межу розміру і те, що INTRO_TEXT називає навичку як `context-editor:<SKILL>`. Файл перевіряє `claude plugin validate` (валідатор приймає теку `skills/`, пункт 39).

Errors: відмов немає — інструкція або додається, або ні; збій запису `introduced` — INTRO_NOT_RECORDED ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)).

### 02_28. Telemetry  {#SP_CTX_02_28}

Purpose: обчислити телеметрію контексту ([SP_CTX_01_20](./context_editor.structures.sp.md#SP_CTX_01_20)) на запит агента — у заголовку перегляду (і окремо, з `count: 0`) та у звіті закриття етапу інструментом — і ніколи після звичайного виклику інструменту ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)). Виняток без тексту телеметрії: м'яке нагадування ([SP_CTX_02_37](#SP_CTX_02_37)) викликає Telemetry лише заради рядка MESSAGES_ROW і калібрування, з реєстром без `lastApply`, тож виміряне звільнення агент і далі бачить у своїй телеметрії.

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

Рядок `Cache` (фаза 23, [SP_CTX_02_38](#SP_CTX_02_38)) каже агенту, що типове застосування переписує всю розмову один раз, хоч би скільки правок було в пакеті, і де межа вікна пошуку кешу API для `keep_cache`: правки від `#<start>` з цим полем переписують лише хвіст від найранішої з них (заморожений префікс, [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)); тому правки варто збирати в один пакет, а щойно опрацьовані виводи останніх викликів з `keep_cache` стискати недорого. Межа — оцінка за рядками без API-подання (LookbackStart): блоки вкладень промпту, доставки й кілька блоків thinking одного рядка не видно, тож біля межі вона оптимістична на кілька позицій, а паралельні виклики, записані «виклик, результат, виклик», рахуються окремими відповідями — песимістично. Межа міряється зараз, а застосування буде в кінці ходу: рядок це каже (рев'ю 54). Розбивки рядок не потребує і є також у звіті закриття етапу.

Розмір рядків розмови береться з рядка MESSAGES_ROW розбивки: розмір усього запиту для рішення не годиться, бо незмінна частина залежить від хоста (~38 тисяч токенів у терміналі, ~70 тисяч у розширенні VS Code, [C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02)). Рядок шукається за назвою: власного `kind` він не має, а типи хоста радять розгалужуватись за `kind`; якщо назва зміниться в іншій версії хоста, телеметрія переходить на весь запит із позначкою, що незмінна частина в ньому (`request`), і нічого не ламається. `tokens` відсутній, поки моделі не відповіли (свіжа сесія, щойно після компактизації), — тоді `unknown`. Щойно після вбудованої компактизації хоста `tokens` ще є (це останній запит до неї), а рядок MESSAGES_ROW — гола локальна оцінка (наживо «conversation ~15 tokens», Verify фази 14, D2): розбивка позначає це полем `apiUsage = null` (відповіді API в живому вікні ще не було; рядок `Messages` звіряється саме з нею), і тоді теж `unknown`. Поле `apiUsage` відсутнє (інша версія хоста) — правило не діє. Розбивка рахує «зараз» з локальною оцінкою рядків після останньої відповіді, а `tokens` — останній запит, тож суми не мусять збігатися. Збій `usage` не валить переліку чи звіту блоку: решта рядків телеметрії не залежить від нього. Розмір блоку й етапу — Estimate ([SP_CTX_02_34](#SP_CTX_02_34)) суми символів рядків поточної розмови з відношенням цієї телеметрії (`t.ratio`; без нього — символи/4 з позначкою `approx.`), а не розбивка: вона не ділиться за рядками. Це те, що звільнять правки цих рядків; а те, що тримає чи переписує запит (хвіст рядка `Cache`, Whole), рахується з вкладеннями хоста — за API-поданням чи виміряними токенами ([SP_CTX_02_38](#SP_CTX_02_38)). Whole — `Messages` разом із рядками FIXED_IN_MESSAGES: пам'ять, перелік навичок, інструкції MCP і агентів лежать у першому повідомленні `user`, хоч розбивка лічить їх у незмінній частині (проба 2.1.296, 2026-10-12, [SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12)). Журнал не дає оцінки звільненого: виміряну зміну показує рядок `Last apply` ([SP_CTX_01_19](./context_editor.structures.sp.md#SP_CTX_01_19)). Рядки журналу і слоту стану, як і `Notes`, з'являються лише тоді, коли є що показати: інакше кожна телеметрія несла б два рядки без інформації.

### 02_29. StageBlock  {#SP_CTX_02_29}

Purpose: закрити етап і скласти звіт закриття — межі, розмір, медіа, кандидати, телеметрія і порада — для закриття етапу інструментом ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); скласти без індексів текст промпту ходу оптимізації ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)) і поради з промптом людини ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)); порада одна для всіх трьох ([C_CTX_DEC_17](./context_editor.concept.md#C_CTX_DEC_17), A).

Processing logic (pseudocode):
    FUNCTION CloseStage(reg, rows, carrier) → ClosedBlock:            # реєстр пише викликач
        IF reg.stage absent: error NO_STAGE
        reg.lastClosed = { name: reg.stage.name, after: reg.stage.after, end: MarkBefore(rows, carrier), turn: reg.turn }
        reg.stage = absent
        RETURN reg.lastClosed

    FUNCTION BlockReport(block, replaced?):                            # лише закриття інструментом: між закриттям і звітом компактизації немає
        key = Key()                                                     # SP_CTX_02_18, до читання рядків
        rows = CurrentRows(); reg = TagRegistry; api = read main conversation in Messages API form
        t = Telemetry(rows, reg, Journal, api)                               # спершу: Calibrate дає відношення, тож розмір блоку і телеметрія звіту — одним відношенням (рев'ю 39)
        a = StartOf(rows, block.after); e = MarkIndex(rows, block.end)
        head = (block.name ? "Stage \"<name>\" closed: " : "Block (no stage): ")
             + (e is lost ? "its end row is gone; call context_list."
                : block.end null OR a > e ? "no rows in it."
                : "rows #<a>..#<e>, <Estimate(Σ size(rows[a..e]), t.ratio)>, <m> media (~<KB>KB).")   # медіа — CollectMedia(api, rows) для власників у a..e
        IF the block has rows (a ≤ e, e not lost):
            cand = for each reason (a tag without reason, written before phase 15 — "no reason"), active review tags whose target rows lie in a..e: "<reason> #i, #j, …" (≤ MAX_BLOCK_INDEXES, then "+<n> more")
                   + disposable tags in a..e + count of reproducible pairs (REPRO_FLAG) whose call and result lie in a..e, without collapse carriers (CarrierIds, SP_CTX_02_04; фаза 27): "reproducible pairs (~) <n>"
            text = head + "\nCandidates in the block: " + (cand or "none") + "."
            notes = notes of reg whose target (first row of a range) lies in a..e: "<id> #<i>: <text>" (≤ MAX_BLOCK_INDEXES, then "+<n> more")
            IF notes: text += "\nYour notes in the block: " + notes joined "; "
        ELSE text = head
        IF replaced AND replaced.queued > 0: text += "\nReplacements from your disposable tags queued: <queued> (<freed> freed when this turn ends)."
        text += "\n" + TelemetryText(t)                                # SP_CTX_02_28
        IF the block has rows: text += "\n" + STAGE_ADVICE
        IF the block has rows: listedKey = key                          # звіт перелічує індекси рядків блоку, як перелік; «no rows in it.» і загублений кінець — ні
        RETURN text

    BlockName(block) = block.name ? "stage \"<name>\"" : "the last block (no stage)"

    ListHint = " Call context_list: its header names the block's range (Last block #<a>..#<b>, or Last block from #<a> when its end row is gone); list from its first row (from=<a>) to see those rows ([block ▶ …] .. [block end]) before you edit by index."

    NotesHint(notes) = notes > 0 ? " You have <notes> note(s); context_list shows them next to their rows and in full below each page." : ""   # notes — len(reg.notes); рядків не треба

    OptimizeText(block, compacted, notes) = "context-editor: optimization turn for " + BlockName(block)
        + " (you ended your last answer with [context-editor: optimize])."
        + (compacted ? " The batch queued in that turn, with the replacements from your disposable tags, was processed (see the report above); if it changed the conversation, indexes from earlier listings no longer hold." : "")
        + ListHint + NotesHint(notes) + "\n" + STAGE_ADVICE
        + "\nYou asked for this while finishing your turn for the person, so the session stops after this batch: pass \"resume\": true (or a resume_prompt) in context_edit only if the task should go on, then end your turn. The mark has no effect in this turn."   # фаза 18, SP_CTX_DEC_16; до неї — «usually stop after it: pass \"resume\": false … unless the task should go on»

    PersonAdvice(block, notes) = "context-editor: you asked to optimize " + BlockName(block) + " after your previous answer; the optimization turn did not run, so the advice comes with this prompt."
        + ListHint + NotesHint(notes) + "\n" + STAGE_ADVICE
        + "\nCompress the block when it suits the person's request; edits apply when your turn ends."

Блок закритого етапу — від рядка після `after` (або від голови) до рядка `end` включно. `block` викликач читає з TagRegistry безпосередньо перед текстом: context_tag — щойно записаний `lastClosed`; Flush — `lastClosed` після команди компактизації (його межі вже переніс RebindTags, але Flush бере лише назву); DeliverReport — `lastClosed` у момент хука. Реєстр `unreadable` або `lastClosed` відсутній — тексту немає: Flush — OPTIMIZE_NO_BLOCK ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)), DeliverReport — ADVICE_NO_BLOCK ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)); в обох `optimize` стає `false`. Кінець при закритті інструментом — останній рядок перед рядком із викликом `close` (MarkBefore від `carrier`, [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); при закритті міткою — останній рядок ходу ([SP_CTX_02_30](#SP_CTX_02_30)).

Індекси, розмір і кандидатів має лише звіт закриття інструментом: між закриттям і звітом компактизації немає, тож індекси правильні, і звіт із рядками блоку оновлює `listedKey`, як перелік, — інакше правка за індексом з нього без окремого `context_list` відхилялась би; звіт «no rows in it.» або з загубленим кінцем індексів рядків не перелічує і `listedKey` не оновлює. OptimizeText і PersonAdvice індексів, розміру і кандидатів не мають ([SP_CTX_DEC_15](./context_editor.sp.md#SP_CTX_DEC_15)): у ході з міткою застосування черги змінює індекси, а в неінтерактивному хості повернені рядки з'являються в читанні із запізненням (F2), тож агент бачить межі блоку в перегляді, який однаково робить перед правками за індексами; ці тексти `listedKey` не оновлюють. Перегляд типово показує першу сторінку від рядка 0 (LIST_COUNT рядків), а блок у довгій розмові стоїть далі, тому ListHint просить узяти діапазон з рядка `Last block #a..#b` заголовка і перелічити рядки від `from = a` — один-два виклики `context_list`. Речення про оброблений пакет (з замінами з тегів) OptimizeText додає лише при `compacted = true`; воно не каже «застосовано», бо обробник міг відповісти «no edit was applied» — тоді звіт у промпті це називає, а індекси попереднього перегляду лишаються чинними. Загублений кінець блоку (`lost`) ніколи не показується як порожній блок: звіт каже, що рядка кінця вже немає. У BlockReport порожній блок поради не має: агент нічого не ставить у чергу, а без тегів `disposable` компактизації немає ([C_CTX_03_03](./context_editor.mechanisms.concept.md#C_CTX_03_03)). Порада про продовження в OptimizeText: хід оптимізації — звичайний хід, і його пакет застосовується з `resume` і `resume_prompt` власного `context_edit` агента ([C_CTX_DEC_03](./context_editor.concept.md#C_CTX_DEC_03)); оскільки мітку ставлять, завершуючи хід для людини, промпт радить передати `resume: false`, якщо завдання не має йти далі. Агент, що нічого не ставить у чергу, просто завершує хід — компактизації і промпту продовження тоді немає. Заміни з тегів `disposable` у промпті не рахуються: на кінці ходу з міткою їх поставив DetectOptimize, і застосування перед промптом їх уже обробило — звіт називає кожну.

Errors:
| Code | Condition | Outcome |
|------|-----------|---------|
| NO_STAGE | CloseStage без відкритого етапу | context_tag відхиляє запит ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); реєстр без змін |
| REPORT_FAILED | BlockReport кинув виняток (читання рядків, API-подання чи реєстру) | етап уже закрито й реєстр записано: результат context_tag замість звіту має `Stage "<name>" closed; its report failed: <error>; call context_list`; `listedKey` не оновлено |

### 02_30. DetectOptimize  {#SP_CTX_02_30}

Purpose: помітити мітку оптимізації у фінальному тексті ходу, закрити блок і поставити запит оптимізації ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02), «Мітка оптимізації в тексті»; [SP_CTX_DEC_12](./context_editor.sp.md#SP_CTX_DEC_12)).

Input: подія завершення ходу (`agentId?`, `isAborted`, `answer` — фінальний видимий текст ходу; навичка plugin-hooks, пункт 38).

Processing logic (pseudocode):
    ON turn completed (main loop, aborted or not), on the registry chain, before TagRegistry.turn += 1 (преамбула 02):
        prompted = false
        IF storage ready: on the queue chain: q = read Queue; IF ok AND q.optimizePrompted: prompted = true; empty = q.compact AND len(q.edits) = 0; optimizePrompted = false; compact = false; compactEndedAt = (q.compact AND NOT aborted) ? now : absent; write   # кінець ходу оптимізації знімає запобіжник; SP_CTX_02_42: і `compact` ходу стискання
        IF empty AND NOT aborted: toast COMPACT_NOTHING                         # хід стискання нічого не поставив; підсумку хоста мод не запускає
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

Мітка діє лише окремим останнім рядком фінального тексту ходу (поле `answer` події `turn.complete`): останній непорожній рядок після обрізання пробільних символів дорівнює OPTIMIZE_MARK дослівно ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02)). Мітка раніше в ході (у проміжному тексті перед викликами), процитована посеред відповіді (агент пояснює людині, як просити оптимізацію) або з іншим текстом у тому самому рядку не діє. Блок мітки — `lastClosed` після цього кроку: якщо в тому самому ході агент закрив етап інструментом (`lastClosed.turn` дорівнює ще не збільшеному `TagRegistry.turn`), мітка стосується блоку цього етапу, а відкритий після нього етап лишається відкритим; інакше мітка закриває відкритий етап кінцем ходу; без відкритого етапу — закриває блок без етапу від кінця попереднього закритого блоку (або від голови) до кінця ходу. Межі блоку в реєстрі переносить застосування, якщо воно відбудеться до ходу оптимізації (RebindTags, [SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)), тож перегляд агента в ході оптимізації показує `[block ▶ …]` і `[block end]` уже після нього; Flush бере з `lastClosed` лише назву. Чи записано рядок фінальної відповіді в транскрипт до `turn.complete`, не перевірено: якщо ні, кінець блоку — рядок перед відповіддю, і відповідь з міткою в блок не потрапляє (на пораду це не впливає). Перерваний хід мітки не дає. Заміни з тегів `disposable` DetectOptimize ставить у чергу на кінці ходу з міткою — рядки ходу вже на місці, а компактизації ще не було, тож цілі знаходяться на тих самих рядках, які застосування візьме з події компактизації; це той самий пакет, що й правки агента цього ходу, і Flush застосовує його однією компактизацією перед промптом ходу оптимізації. Запобіжник петлі: Flush ставить `optimizePrompted`, коли промпт ходу оптимізації увійшов; кінець наступного ходу основної розмови (ходу оптимізації, зокрема перерваного) знімає прапорець, а мітку в його відповіді ігнорує. «Закрито в цьому ході» звіряється з лічильником завершених ходів: етап, закритий у перерваному ході (лічильник тоді не росте), мітка наступного ходу вважає закритим у своєму ході і бере його блок.

Errors (жодна не виходить до агента; рядок стану бачить людина):
| Code | Condition | Outcome |
|------|-----------|---------|
| MARK_NO_STORAGE | сховище `unavailable` | мітка ігнорується |
| MARK_QUEUE_UNREADABLE | Queue `unreadable` | мітка ігнорується; файл перенесе наступний `context_edit` |
| MARK_REGISTRY_UNREADABLE | TagRegistry `unreadable` або не записався | мітка ігнорується; блок не закрито |
| MARK_HANDOFF | у черзі запит передачі | мітка ігнорується: передача переносить розмову цілою, а оптимізацію агент може попросити в новій сесії |
| MARK_IN_OPTIMIZATION | `optimizePrompted` був `true` — це відповідь ходу оптимізації | мітка ігнорується мовчки; прапорець знято |
| COMPACT_NOTHING | кінець ходу стискання `/compact` людини (`compact`), не перерваного, без жодної правки в черзі | спливне повідомлення COMPACT_NOTHING ([SP_CTX_02_42](#SP_CTX_02_42)); `compact` знято разом із запобіжником |
| MARK_NO_REPLACEMENTS | QueueTagReplacements кинув виняток | заміни з тегів не поставлено (теги лишаються до наступного закриття етапу чи мітки); блок закрито, `optimize` пишеться як завжди |
| MARK_NOT_QUEUED | реєстр уже записано (блок закрито), а запис черги не вдався або повторне читання черги знайшло `unreadable` чи `handoff` | блок лишається закритим у реєстрі; ходу оптимізації і поради немає; рядок стану «the block is closed, but no optimization turn: <причина>»; агент може закрити наступний блок або поставити мітку знову |

### 02_31. Journal  {#SP_CTX_02_31}

Purpose: вести журнал ефекту ([SP_CTX_01_19](./context_editor.structures.sp.md#SP_CTX_01_19)): що стиснуло кожне застосування (без оцінки звільненого — її дає виміряний `Last apply`, [SP_CTX_02_28](#SP_CTX_02_28)) і які вже стиснуті відтворювані виводи агент читав знову — сигнал надмірного стискання і матеріал для дослідження впливу змінного контексту на якість завдань ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02), «Журнал ефекту»).

Processing logic (pseudocode):
    FUNCTION JournalApply(id, report, archive, before, edits):             # HandleCompaction (SP_CTX_02_07), коли report.applied непорожній; у фоні
        j = read Journal; IF unreadable: RETURN                            # не перезаписується
        applied = [e IN edits | EditLabel(e) IN report.applied]
        compressed = distinct input.file_path of every Read call in the pairs of before that applied summarize or drop edits name, or that applied collapse spans hold (≤ MAX_QUEUE_EDITS, first ones kept)
        j.entries += { kind: apply, at: id, edits: len(applied), archive, compressed }
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

Повторне читання помічається лише для `Read`: `Grep` і `Glob` шляху одного файлу не мають, тож їх повтор журнал не бачить. Читання файлу архіву або медіа застосування (`archive = true`) — повернення оригіналу ([C_CTX_DEC_18](./context_editor.concept.md#C_CTX_DEC_18)); часті такі записи — тригер повернутися до операції відновлення на місці (C_CTX_DEC_18, B). Засів нової сесії записів журналу не робить, і журнал у нову сесію не переноситься ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)). Журнал — частина телеметрії ([SP_CTX_02_28](#SP_CTX_02_28)); інших читачів у моді немає.

Errors: відмов немає; журнал `unreadable` — записи пропускаються, телеметрія показує причину; збій запису — запис губиться.

### 02_32. context_note  {#SP_CTX_02_32}

Purpose: інструмент агента; додає і знімає службові нотатки до рядків, діапазонів і пар виклику ([C_CTX_03_07](./context_editor.mechanisms.concept.md#C_CTX_03_07), [C_CTX_DEC_20](./context_editor.concept.md#C_CTX_DEC_20)). Окремий інструмент, а не операції `context_tag`: опис `context_tag` уже близько 1770 з 2048 символів MAX_DESCRIPTION, а фаза етапів додає до нього `state`, діапазон і причини `review`, тож операції нотаток туди не вмістяться без втрати обов'язкового змісту ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), пріоритети опису).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| notes | list<NoteRequest> | yes | 1..MAX_NOTES; запити обробляються по порядку |

NoteRequest:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| op | `add` \| `remove` | yes | — | — | Дія |
| text | string? | для `add` | — | непорожній після обрізання, ≤ MAX_NOTE | Текст нотатки |
| tool_use_id / ref / index | як у TagRequest ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) | для `add` рівно одне з трьох | — | — | Ціль |
| to | int? | no | — | лише з `add` і `index`; `index < to ≤ len-1` | Останній рядок діапазону включно |
| remind_in_turns | int? | no | — | 1..MAX_REMIND; лише з `add` | Через скільки завершених ходів нагадати: `remindAt = TagRegistry.turn + remind_in_turns` |
| id | string? | для `remove` | — | ідентифікатор нотатки | Яку нотатку зняти |

Output: `Added <ids>; removed <ids>; <n> note(s) in the registry.`, рядок `"last" = <CallLabel>`, коли запит з `ref: "last"` розв'язався (фаза 21), і відхилені запити з причинами.

Errors (рівень виклику позначено *, решта — рівень запиту):
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT* | виклик із субагента | `a subagent's context cannot be noted; only the main conversation's.` |
| DENIED_EMPTY* | `notes` відсутній, порожній, не список або довший за MAX_NOTES | `"notes" must be a list of 1..<MAX_NOTES> requests.` |
| DENIED_STORAGE* | сховище `unavailable` | `storage unavailable: <reason>` |
| DENIED_REGISTRY_READ* | TagRegistry `unreadable` | `the tag registry cannot be read (<reason>); it is left as it is.`; реєстр не перезаписується |
| DENIED_REGISTRY_WRITE* | реєстр не записався | `could not save the tag registry: <error>`; нотатки цього виклику не додано і не знято |
| BAD_OP | `op` не `add`/`remove` | `op must be "add" or "remove"` |
| NOTE_TEXT_REQUIRED | `add` без коректного `text` | `a note needs "text" of 1..<MAX_NOTE> chars` |
| TARGET_REQUIRED, UNKNOWN_REF, TARGET_NOT_FOUND, INDEXES_STALE | як у context_tag ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); крім того, TARGET_NOT_FOUND — `index` або `to` на рядку без тексту і без викликів чи результатів (рядок лише з thinking, відбиток `assistant||`): Locate не знаходить такого рядка однозначно, і перше ж застосування видалило б нотатку (рев'ю 37, W2); для рядка асистента лише з thinking те саме правило діє для тегів за індексом ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) і для цілі `rewrite` та кінця `collapse` (промпт людини з самих медіа там, на відміну від нотаток, ціллю бути може) ([SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03)) (аудит PL_AUD_CTX, CF-3) | для рядка без тексту — `this row cannot be tracked (no text, no tool call); note a neighbouring row` |
| BAD_RANGE | `to` без `index` чи з `remove`; `to ≤ index` або поза межами | `"to" needs "index", the first row of the range` / `"to" belongs to op "add"` / `"to" is the last row of the range: an integer in <index + 1>..<len − 1>` |
| BAD_REMIND | `remind_in_turns` не ціле в 1..MAX_REMIND або з `remove` | `remind_in_turns is an integer in 1..<MAX_REMIND>` / `"remind_in_turns" belongs to op "add"` |
| NOTES_FULL | MAX_NOTES нотаток у реєстрі або файл реєстру став би більшим за MAX_REGISTRY_BYTES (= MAX_QUEUE_BYTES) | `the registry is full (<MAX_NOTES> notes or <MAX_REGISTRY_BYTES> bytes with the tags); remove notes you no longer need` |
| NO_NOTE | `remove` з `id`, якого немає | `no note <id>; give the "id" of a note` |

Тексти відмов рівня виклику мод подає з префіксом PREFIX; причина відхиленого запиту в результаті — `note <n>: <text> (<code>)`, усі разом у рядку `Rejected: <reasons joined by "; ">.`. Для TARGET_REQUIRED, TARGET_NOT_FOUND, INDEXES_STALE тексти: `give exactly one of tool_use_id (a string), index (an integer) or ref (an alias or "last")`, `no completed tool call with id <id>; refresh context_list`, `index out of range (0..<len − 1>); refresh context_list`, `row #<i> cannot be tracked (no text, no tool call); note a neighbouring row`, STALE_INDEXES ([SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03)); UNKNOWN_REF — причина резолвера ([SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17)).

Processing logic (pseudocode):
    FUNCTION context_note(notes, callId):                             # на ланцюжку реєстру тегів; callId — власний tool_use_id з події tool.call (фаза 21: для ResolveLast)
        REQUIRE storage ready, TagRegistry state != unreadable
        rows = CurrentRows(); reg = TagRegistry
        FOR req IN notes:
            validate (table above); on error → rejected += reason; CONTINUE
            add: target as context_tag builds it (SP_CTX_02_11) + range from to
                 reg.notes += { id: NOTE_PREFIX + reg.nextNote, target, text: trimmed text, createdTurn: reg.turn,
                                remindAt: remind_in_turns ? reg.turn + remind_in_turns : absent }; reg.nextNote += 1
            remove: delete the note with that id
        write TagRegistry
        RETURN text report

Опис інструмента (NOTE_DESCRIPTION, ≤ MAX_DESCRIPTION, близько 880 символів) називає: нотатки живуть поза розмовою і нічого не змінюють; кілька на ціль; цілі — як у `context_tag` плюс діапазон `index`..`to`; `remind_in_turns` — одне нагадування після стількох завершених ходів, з результатом наступного виклику будь-якого інструменту, зокрема інструментів мода, крім `context_edit` і `context_handoff`; нотатки видно в `context_list` (`[nN]` і повний текст під сторінкою) і в результаті `close`; нотатка переходить на рядок, що замінив її рядок, і зникає з прибраним; приклади — позначити, що видалити чи стиснути, нагадування, перехресне посилання. Виклики `context_note`, як і інших інструментів мода, DropOwnCalls прибирає при застосуванні ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)).

### 02_33. NoteReminders  {#SP_CTX_02_33}

Purpose: один раз доставити агенту належні нагадування його нотаток ([C_CTX_03_07](./context_editor.mechanisms.concept.md#C_CTX_03_07)) після виклику будь-якого інструменту основної розмови: для інструментів хоста й інших розширень — додатковим контекстом у загальному хуку, тим самим шляхом, що й рядок псевдоніма ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)); для інструментів мода (`context_list`, `context_edit`, `context_tag`, `context_note`, `context_handoff`) — рядками в кінці їхнього власного результату ([C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21)).

Processing logic (pseudocode):
    FUNCTION NoteReminders() → list<string>:                          # загальний хук викликів або обробник інструмента мода; на ланцюжку реєстру тегів; результат чекає
        IF the cached TagRegistry (01_07) is known AND no note of it has remindAt: RETURN []   # фаза 11 аудиту (CF-22): ворота в пам'яті — ні ланцюжка, ні читання
        reg = TagRegistry; IF unreadable OR missing: RETURN []
        due = notes of reg with remindAt present AND remindAt ≤ reg.turn, oldest first
        IF due empty: RETURN []
        remove remindAt from each of due; write TagRegistry; IF the write fails: RETURN []   # без запису нагадування повторилось би
        RETURN ["[context-editor] reminder from your note <id> (set <reg.turn − createdTurn> turn(s) ago): <text>" FOR n IN due]   # SP_CTX_DEC_17: рядок називає автора нотатки

Ходи рахує `TagRegistry.turn` (завершені ходи основної розмови, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)), тож нагадування переживає перезавантаження модуля і не рахує власних команд мода. Нагадування приходить з результатом першого виклику інструменту основної розмови (будь-якого, зокрема інструменту мода; не субагента, не відхиленого), що завершився, коли `turn ≥ remindAt`; без викликів воно чекає. Прогін на копії реальної сесії показав, що агент, який у ході викликає лише інструменти мода (перегляд, правки), нагадування не отримував ([C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21)). Інструмент мода додає нагадування після власного тексту і лише тоді, коли сам виклик не відхилено (`deny`) — так само, як загальний хук пропускає відхилені виклики. Винятки — `context_edit` і `context_handoff`: їхні виклики DropOwnCalls прибирає саме тим застосуванням чи засівом, які вони запускають, тож доставлене з ними нагадування зникло б непрочитаним; `remindAt` лишається для наступного виклику (рев'ю 39). `context_list` рахує в телеметрії нагадування так, ніби належні вже доставлено, а доставляє їх (знімає `remindAt`) лише після того, як перелік побудовано: збій переліку нагадувань не губить (рев'ю 40). Доставлене нагадування не повторюється, а нотатка лишається (агент знімає її сам). Ціна — читання реєстру тегів на кожен такий виклик; хук його вже чекає заради псевдоніма лише для великих виводів, тож тут читання додається до кожного виклику (файл малий, читання — мілісекунди); інструменти мода реєстр тегів здебільшого вже читають. Нагадування — запит агента самому собі, а не нагадування за розміром ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15)).

Автор нагадування ([SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17), аудит PL_AUD_CTX, CF-8). Текст нотатки написав агент, а виклик `context_note`, що його поставив, DropOwnCalls прибирає при застосуванні, тож рядок нагадування каже, чия це нотатка: `reminder from your note <id>`. Промптом нагадування не стає ніколи: воно йде додатковим контекстом після результату інструмента або рядком у власному результаті інструмента мода, тож окремої рамки промпту, як для тексту продовження ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)) чи документа передачі ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), йому не треба; префікс `[context-editor]` — той самий, що в рядку псевдоніма.

Ворота в пам'яті (аудит PL_AUD_CTX, фаза 11, CF-22). `remindAt` з'являється лише записом реєстру (`context_note`), а запис через порт оновлює кеш реєстру ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)); тож коли кеш знає реєстр і в ньому немає жодної нотатки з `remindAt`, виклик не стає на ланцюжок реєстру і не чекає фонової роботи на ньому (AutoTag, R4). Реєстр, якого кеш ще не знає (перший виклик сесії, нова епоха), читається як раніше — на ланцюжку.

Errors: відмов немає; реєстр `unreadable` або збій запису — нагадувань цього виклику немає, `remindAt` лишається, і спроба повториться з наступним викликом.

### 02_34. Estimate  {#SP_CTX_02_34}

Purpose: оцінювати розмір у токенах калібровано за телеметрією, а не «символи/4» ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02), «Телеметрія на запит»; [C_CTX_DEC_21](./context_editor.concept.md#C_CTX_DEC_21)). Прогін на копії реальної сесії: перелік казав «~57 тисяч токенів» при 268 тисячах за телеметрією, звіт — «~121 тисяча звільнено» при ~271 тисячі: україномовний текст займає близько 1,8 символу на токен, а приховані міркування моделі займають токени, яких мод як текст не бачить.

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

Калібрування перед застосуванням (фаза 29). До фази 29 відношення рахувала лише телеметрія — `context_list`, звіт закриття етапу, SoftHint. Застосування в сесії, де жодна з них не калібрувала (агент поставив правки за `tool_use_id` чи `ref`, не читаючи переліку; м'яке нагадування не спрацювало), брало PLAIN_RATIO, і звіт застосування, «freed» QueueTagReplacements та рядок людини ([SP_CTX_02_43](#SP_CTX_02_43)) занижували звільнене на JSON і цифрах (живий прогін фази 28, термінал: ~24k проти ~41,5k). Тепер Flush перед командою `compact` калібрує сам (CalibrateBeforeApply): Flush і так чекає між ходами, тож читання розбивки (23–87 мс) і API-подання агента не затримує, а обробник компактизації, як і раніше, телеметрії не просить. Заразом відношення свіжіше: склад розмови змінюється (англійський текст проти JSON), а до фази 29 збережене відношення оновлювала лише телеметрія. Передача калібрування перед засівом не робить: RunHandoff бере відношення старої сесії, як і досі (05_04). Поріг CALIB_TOKENS ([SP_CTX_DEC_30](./context_editor.sp.md#SP_CTX_DEC_30), A): 20 000. Фаза 29 знизила його до 5 000, бо чисельник і знаменник тепер рахують той самий вміст, але живий прогін (`.dev_flow/cache/live-test/phase29-31-results.md`) показав іншу причину шуму: розбивка хоста завищує системний промпт і інструменти на 13–25 тисяч токенів, тож рядок `Messages` малої розмови сильно занижений (stream-json: відношення 4,22 при справжніх ~2,1–2,4, рядок людини занижений на 36–51 %), а термінал 2.1.296 рядка `Messages` не дав зовсім; поріг повернуто до 20 000, де ця похибка відносно мала. Далі описано, що мало дати зниження: Шум малої розмови — thinking і медіа без символів: одна картинка в розмові на 5 тисяч токенів знижує відношення приблизно на третину, і оцінки тоді завищені; межі CALIB_MIN/CALIB_MAX і калібрування на кожному застосуванні та телеметрії тримають це в межах. Живий сценарій «Калібрування перед застосуванням» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)) порівнює рядок людини з проксі; похибка понад 25 % на розмові 5–20 тисяч — повернення до 20 000.

Errors: відмов немає; збій запису відношення — оцінки цього виклику з новим відношенням, наступні — зі старим.

### 02_35. RecordDelivery  {#SP_CTX_02_35}

Purpose: записати доставку хоста посеред ходу ([SP_CTX_01_22](./context_editor.structures.sp.md#SP_CTX_01_22)) в мить, коли хост проводить її через `session.append`, разом із рядком, за яким вона висить. Фаза 20; [SP_CTX_DEC_19](./context_editor.sp.md#SP_CTX_DEC_19).

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

Обрізання в рамці (аудит PL_AUD_CTX, CF-9). Застосування повертає доставку рядком `user` ([SP_CTX_02_36](#SP_CTX_02_36)), і модель відрізняє її від слів людини лише за рамкою хоста. Тому довга доставка обрізається всередині тіла, а не з кінця тексту: після позначки обрізання йдуть закривальні теги, які обрізання забрало (`</system-reminder>`, для звіту субагента спершу `</agent-message>`), найглибший першим. Тег іде назад лише тоді, коли повний текст справді закриває його після місця обрізання, тож `<br>` чи `Array<string>` у тексті людини зайвих тегів не дають, а тег, розрізаний навпіл, закривається один раз цілим. Закривальний тег — `</name`, за яким `>` або пробільний символ і далі до `>`, і назад він іде дослівно, як у повному тексті: термінал загортає вставлений людиною текст у `<pasted_content id="…">…</pasted_content id="…">`, з атрибутом і на закривальному тезі (живий прогін фази 5). Голова звільняє місце для тегів, тож текст не довший за MAX_DELIVERY_TEXT разом із позначкою (у межах запасу 100 символів, який допускає розбір файлу, [SP_CTX_01_22](./context_editor.structures.sp.md#SP_CTX_01_22)); `cut` рахує всі символи після голови, разом із закривальним тегом оригіналу. Текст без рамки (не починається з REMINDER_PREFIX) обрізається, як раніше: голова в MAX_DELIVERY_TEXT і позначка.

Межі. Гаряче перезавантаження модуля скидає `lastAnchor`: доставка до наступного рядка `tool-result` не записується (вікно — один виклик інструмента). `/clear` і `/resume`: сховище переходить до нової сесії (PrepareStorage, [SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15)), а `lastAnchor` скидає перший рядок промпту. `--resume` новим процесом: файл сесії лишається, пам'ять нова. Доставка, що прийшла, коли сесія вільна, починає новий хід звичайним промптом-рядком (`door: prompt`) і не губиться — запису не потребує (спайк, Entry 2).

Errors: відмов немає; збій читання, переносу чи запису губить лише цей запис, рядок розмови не змінюється.

### 02_36. InsertDeliveries  {#SP_CTX_02_36}

Purpose: повернути доставки на їхнє місце в списку, що замінює розмову: рядок `user` з текстом доставки одразу після рядка-якоря, коли цей рядок іде без `handle` і хост вкладення за ним не перенесе. Чиста функція. Фаза 20; [SP_CTX_DEC_19](./context_editor.sp.md#SP_CTX_DEC_19).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| before | list<Row> | yes | рядки, до яких застосовано правки: `e.messages` компактизації або видимі рядки засіву |
| rows | list<Row> | yes | вихід ApplyEdits ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) |
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

Де викликається. HandleCompaction — після ApplyEdits, до DropOwnCalls ([SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07)): доставка за результатом службового виклику лишається на місці, коли DropOwnCalls прибирає його рядки ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)). BuildSeed — так само, з `allRebuilt = true` ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)). Produced, NowIndex, RebindTags і межа поточної розмови бачать список уже з вставленими рядками; `charsAfter` їх не рахує ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)). Межа етапу «після рядка-якоря» робить рядок доставки першим рядком блоку, а кінець блоку на якорі лишає доставку наступному блоку — прийнято: модель бачила доставку саме після цього результату.

Заморожений префікс (фаза 23, [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)). Рядок результату до відповіді першої зміни повертається з `handle`, тож доставка за ним не вставляється, а їде з ним — тим самим системним повідомленням, що й до застосування: байти префікса й кеш промпту лишаються. Запис такої доставки лишається у файлі до застосування, яке перезбере її якір.

Після вставки доставка — звичайний рядок: `context_list` її показує, `collapse` може її згорнути, PersonText бачить у доставці від людини її слова ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)), PromptMatch вважає її прикрасою (PROMPT_DECORATIONS), а наступне застосування повертає її з `handle`, як будь-який рядок `user` без результатів. Медіа доставки (`media` > 0) не переноситься: рядок несе лише текст.

Errors: відмов немає.

### 02_37. SoftHint  {#SP_CTX_02_37}

Purpose: м'яке нагадування ([C_CTX_DEC_15](./context_editor.concept.md#C_CTX_DEC_15), E; [C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02); [SP_CTX_DEC_21](./context_editor.sp.md#SP_CTX_DEC_21); з фази 23 — [SP_CTX_DEC_23](./context_editor.sp.md#SP_CTX_DEC_23)) — окремий рядок-пропозиція з префіксом SUGGESTION, лише коли є що пропонувати: пакет усіх ще не стиснутих кандидатів як одне застосування — яка дія (які `cN` стиснути, чи закрити відкритий етап), що вона звільняє, скільки коштує кешу промпту і вердикт беззбитковості ([SP_CTX_02_38](#SP_CTX_02_38)). Два канали: (1) розміру — у результаті великого виводу чи пошуку (виклик, що отримав позначку, [SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)), коли рядки розмови ≥ Threshold(window) і запит від минулої пропозиції виріс на Step(window); (2) ходу — прихованим контекстом наступного промпту людини між ходами ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)), коли від минулої пропозиції набралося HINT_RUN позначених виводів: кінець ходу — природна межа пакета. Обидва — лише коли пакет звільняє ≥ max(HINT_CANDIDATES, HINT_BATCH · розмова). Рядок нічого не ставить у чергу, не закриває етапу і не запускає оптимізації: рішення — за агентом. До фази 23 рядок стояв на місці рядка псевдоніма й починався ним, другим моментом був перший запис файлу після серії позначених виводів, поріг розміру — 50 тисяч, а вердикту не було.

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
        keep present (size only): "<what> in one context_edit with \"keep_cache\": true: frees <gain>; that keeps the prompt cache up to the earliest and rewrites only the rows from it (~<keep.rewrite>) if you end the turn within a few calls (edits apply when it ends; the earliest is ~<keep.positions> positions back now, and past ~20 the API finds no cache); <pays(keep.rStar)> → <keep verdict>. Without keep_cache: all the request's messages (~<rewrite>), pays back after ~<rStar> → <verdict>; with it, a later --resume may show earlier answers twice."
        pays  = "pays back after ~<rStar> requests, this conversation has made ~<rHat>"   # rStar округлено; ≥ 100 000 — "100000+"
        gain  = "~<freed> of the ~<conversation> conversation"
        not-yet (both): "not worth it yet: to <what> would free <gain> but <cache>; <pays>. Batch more, or compress at the end of a stage."
        size:           "<what> in one context_edit: frees <gain>; <cache>; <pays> → <verdict>."
        turn:           "before you go on: " + (stage ? "close stage \"<stage>\" with context_tag and " : "") + "<what> in one context_edit? It frees <gain>; <cache>; <pays> → <verdict>. Your call: nothing runs unless you do it."
        verdict: worth → "worth it now"; borderline → "borderline: worth it only if the work goes on that long"
      numbers of tokens in thousands as TelemetryText ("~12k")

    CallLines(marked, alias, hint) = marked ? (alias ? [alias line] : []) + (hint ? [hint] : []) : []   # порядок рядків виклику (SP_CTX_02_16)

    Bounded(work, HINT_WAIT): the line of `work`, or none once HINT_WAIT passes first; a claim made before that is waited for, so a written state always has its line, and after it no claim writes

Приклади (модульні тести фази 23; вікно 1M, Opus 5.5). Канал розміру, кандидати щойно прочитані, сесія довга — `keep_cache` змінює вердикт, тож рядок його називає: `[context-editor: suggestion] summarize c1, c2, c3, c4, c5 by ref in one context_edit with "keep_cache": true: frees ~38k of the ~200k conversation; that keeps the prompt cache up to the earliest and rewrites only the rows from it (~13k) if you end the turn within a few calls (edits apply when it ends; the earliest is ~10 positions back now, and past ~20 the API finds no cache); pays back after ~53 requests, this conversation has made ~155 → worth it now. Without keep_cache: all the request's messages (~163k), pays back after ~209 → borderline: worth it only if the work goes on that long; with it, a later --resume may show earlier answers twice.` Ті самі кандидати за 15 обмінами з людиною (поза вікном, `keep_cache` не допоможе): `… rewrites the prompt cache of all the request's messages once (~163k): its earliest row is ~40 positions back, beyond the ~20 the API looks back; pays back after ~209 requests, this conversation has made ~170 → borderline: worth it only if the work goes on that long.` Рано в сесії (і з `keep_cache` невигідно): `[context-editor: suggestion] not worth it yet: to summarize c1, c2, c3, c4, c5 by ref would free ~38k of the ~200k conversation but would rewrite the prompt cache of all the request's messages once (~162k); pays back after ~208 requests, this conversation has made ~5. Batch more, or compress at the end of a stage.` На Sonnet 5.5 той самий пакет вигідний і без `keep_cache` (`pays back after ~105 requests … → worth it now`), і рядок поля не називає. Канал ходу з відкритим етапом: `[context-editor: suggestion] before you go on: close stage "read" with context_tag and summarize c1, c2, c3, c4, c5 by ref in one context_edit? It frees ~38k of the ~200k conversation; rewrites the prompt cache of all the request's messages once (~163k): edits queued now apply when this turn ends, beyond the ~20 positions the API looks back; pays back after ~209 requests, this conversation has made ~255 → worth it now. Your call: nothing runs unless you do it.`

Чому так. Пропозиція — одна дія над усім пакетом, бо ціна застосування визначається не обсягом, а тим, де перша зміна: усередині вікна пошуку кешу платиться лише хвіст, поза ним — уся розмова, хоч би скільки правок було в пакеті (спайки кешу й ефективності; [SP_CTX_02_38](#SP_CTX_02_38)). Агент практики 5 (P22) прочитав рядок фази 22 як службову довідку через спільний префікс з рядками псевдонімів і попросив окремий рядок, конкретну дію з вердиктом «вигідно / невигідно» і пропозицію наприкінці ходу; він сам оцінив стиснення c11–c13 як «збиток або нуль» — правило беззбитковості дає ~150 запитів проти 14 зроблених, тобто «not worth it yet». Поріг розміру — на рядках розмови (MESSAGES_ROW), бо незмінна частина залежить від хоста; 150 тисяч рядків розмови — початок зони L_q спайку ефективності (контекст ~200k), де R̂ уже десятки запитів і за ціною проходять пакети етапів; частка вікна тримає канал живим у вікні 200k. Крок 75 тисяч — 20–50 запитів робочої сесії між рядками. Пакет ≥ 10% розмови — гістерезис спайку, який прибирає часті дрібні застосування. «Not worth it yet» канал розміру каже коротко, бо розмова вже велика: для мети розробника вирішальне місце, і агент має бачити обмін місця на ціну, а рядок підказує, як зробити його вигідним (більший пакет, кінець етапу); канал ходу в малій розмові за такого вердикту мовчить — тиску місця немає, а рядок був би шумом (P19). Канал ходу замінив перший запис файлу: мод не бачить наміру писати, тож рядок межі етапу приходив уже після запису, а кінець ходу — межа, яку бачить і мод; агент отримує пропозицію разом із наступним завданням людини і вирішує, чи закрити етап зараз. Типове застосування переписує всю розмову (заморожений префікс — лише з `keep_cache`, [SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22)); варіант з `keep_cache` рядок називає лише тоді, коли той змінює вердикт, і разом з компромісом відновлення — рішення за агентом. Глибина міряється зараз, а правки застосовуються в кінці ходу (рев'ю 54): для варіанта з `keep_cache` канал розміру додає APPLY_MARGIN позицій і каже агенту, що неглибока ціна — лише якщо хід скінчиться за кілька викликів; канал ходу пропонує на початку ходу, тож до застосування пройде весь хід — правку він вважає глибокою завжди. Пакет, який агент лишив без дії, канал ходу не повторює з кожною серією: лише коли той виріс на цілий пакет (max(HINT_CANDIDATES, HINT_BATCH · розмова)) або між ними було застосування (менший запит). Відношення цін — за родиною моделі (CostRatios). Холодний кеш (пауза людини понад TTL) не робить пропозицію вигідною: правки застосовуються в кінці ходу, у якому агент їх поставив, а перший запит цього ходу вже переписав кеш. Кандидати — ті самі активні `review`, що в рядку `Candidates` телеметрії, без уже поставлених у чергу (у довгому ході правки застосовуються лише в його кінці) і без замінених; поточний вивід кандидатом ще не є (його тег ставить AutoTag після цього хука, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)); «+n more (see context_list)» лише відсилає до переліку, де вони мають `[review: …]`. Рядок псевдоніма лишається як до фази 22: пропозиція — окремий рядок після нього (P19 — кандидат беклогу).

Що звільняє пакет, рахується символами рядків кандидатів за відношенням (правки замінюють саме рядки); «of the ~N conversation» — виміряний рядок `Messages`; що переписує застосування — з вкладеннями хоста: глибоке — Whole, з `keep_cache` — хвіст API-подання (TailTokens, [SP_CTX_02_38](#SP_CTX_02_38)). Тому число «rewrites … (~Z)» може бути більшим за різницю розмови і звільненого: Z містить і пам'ять та переліки першого повідомлення, і рядок називає його «all the request's messages», а не «the whole conversation», щоб розбіжність не читалась як помилка (2026-10-12, рев'ю).

Ціна на гарячому шляху. Кожен позначений вивід читає два малі реєстри (тегів і псевдонімів; з фази 11 аудиту — з кешу в пам'яті модуля, [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07), без файлової системи, доки їх не змінив запис) і звичайну `usage` (1–3 мс); рядки розмови й черга читаються лише після дешевих порогів (запит ≥ Threshold, ріст ≥ Step, не раніше ніж через HINT_RECHECK після невдалої перевірки), розбивка (23–87 мс) і API-подання (для калібрування, далі те саме читання — для CacheCost) — лише коли кандидатів досить. Кожен промпт людини між ходами читає ті самі два реєстри; рядки й розбивку — лише раз на серію з HINT_RUN позначених виводів. Результат і промпт чекають не довше HINT_WAIT; калібрування з розбивки пишеться у фоні; CacheCost — лінійний прохід по рядках.

Errors: відмов немає; будь-який збій — рядок псевдоніма без пропозиції (промпт — без неї), стан не змінюється. Стан пишеться порівнянням-і-записом: якщо паралельний виклик змінив `hint` між читанням і записом, другий рядок не з'являється.

### 02_38. CacheCost  {#SP_CTX_02_38}

Purpose: оцінити, скільки кешу промпту коштує застосування, і чи окупиться воно ([C_CTX_03_02](./context_editor.mechanisms.concept.md#C_CTX_03_02); спайки [context_editor_cache](./context_editor_cache.spike.md) і [context_editor_efficiency](./context_editor_efficiency.spike.md); [SP_CTX_DEC_23](./context_editor.sp.md#SP_CTX_DEC_23)). Чисті функції `hooks/cache.ts`; читають SoftHint ([SP_CTX_02_37](#SP_CTX_02_37)) і Telemetry ([SP_CTX_02_28](#SP_CTX_02_28)). Фаза 23.

Модель. Хост ставить мітки кешу на системний промпт і на останній блок двох останніх повідомлень кожного запиту; мітка знаходить попередній запис кешу не далі ніж за CACHE_LOOKBACK позицій назад (навичка plugin-hooks, пункти 53–55). Тому перший запит після застосування читає кеш до першої зміни, лише коли від неї до кінця розмови ≤ CACHE_LOOKBACK позицій, і тоді пише лише хвіст від неї; глибше — читає тільки незмінну частину (`tools + system`, P0) і пише всю розмову. Повідомлення запиту — це C − P0 = Whole ([SP_CTX_02_28](#SP_CTX_02_28)): рядок MESSAGES_ROW разом із рядками розбивки FIXED_IN_MESSAGES (файли пам'яті, перелік навичок, інструкції MCP, агенти), які лежать у першому повідомленні, хоч розбивка лічить їх у незмінній частині; до 2026-10-12 запис глибокої правки рахувався без них і був занижений на ці 15–20 тисяч токенів. Типове застосування перезбирає відрізок і прибирає всі власні пари, тож переписує всю розмову; лише з `keep_cache` ([SP_CTX_DEC_22](./context_editor.sp.md#SP_CTX_DEC_22)) першою зміною FrozenPrefix ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) робить відповідь найранішої правки, і тоді діє вікно; до фази 23 мод сам зсував її на початок ходу чи розмови, і спайк ефективності міряв лише режим «уся розмова» (`p0`).

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

### 02_42. PersonCompact  {#SP_CTX_02_42}

> **Criticality:** core

Purpose: `/compact` людини, коли мод увімкнено ([C_CTX_DEC_23](./context_editor.concept.md#C_CTX_DEC_23), рішення розробника «Агент стискає сам (Recommended)»): без аргументів — не підсумок хоста, а хід оптимізації на всю розмову (хід стискання), у якому агент стискає сам; `/compact host` — стандартний підсумок хоста; `/compact <інструкції>` людини і будь-яка `/compact` розширення (MARKER і HANDOFF_MARKER самого мода теж) — до хоста без змін. Автоматична компактизація хоста команди не запускає і цим контрактом не зачіпається ([SP_CTX_DEC_27](./context_editor.sp.md#SP_CTX_DEC_27)).

Хук лише пише запит у чергу і планує Flush ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)): запит — `Queue.optimize` з `Queue.compact` ([SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04)). Далі все йде шляхом мітки оптимізації: Flush спершу застосовує те, що в черзі, потім надсилає рівно один промпт — CompactTurnText замість промпту продовження; DetectOptimize на кінці ходу стискання знімає запобіжник і `compact` і, якщо хід нічого не поставив у чергу, каже людині спливним повідомленням ([SP_CTX_02_30](#SP_CTX_02_30)); DeliverReport віддає COMPACT_ADVICE з промптом людини, якщо хід стискання не почався ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)). Один порядок — спершу застосування, потім один промпт — і жодних паралельних таймерів (рев'ю фази 25: окремий таймер хука змагався з Flush).

Логіка — чисті функції `hooks/personcompact.ts` (CompactRoute, RequestCompact, PersonCompact, CompactFailure) за портом PersonCompactIO: сховище й id сесії одним читанням (CONC-01), Update черги в цьому каталозі, ознака покинутого хука (`next.signal`, CONC-02), планування Flush (RequestFlush), спливне повідомлення; зв'язування — хук `command.run` з матчером `{ command: 'compact' }` у `register.ts`. Текст промпту — CompactTurnText у `hooks/stages.ts`. Пам'яті модуля, окремої від Flush, немає: «зайнято» читається з черги і з `FlushState`.

Input: подія `command.run` (`command = compact`, `args`, `origin`; типи хоста `CommandRunInput`).

Processing logic (pseudocode):
    CompactRoute(e) =
        e.origin.kind = plugin                     → pass        # застосування мода, засів, інші розширення
        trim(e.args) = ""                          → agent       # людина: composer, sdk, unclassified, bridge — будь-яке походження, крім plugin
        lower(trim(e.args)) = HOST_ARG             → host
        otherwise                                  → pass        # власні інструкції людини для підсумку хоста

    RequestCompact(q, planned) =
        q.handoff present                                          → handoff
        q.compact AND (q.optimizePrompted OR (q.optimize AND planned)) → busy   # хід стискання йде, або запит є і Flush заплановано
        q.compactEndedAt present AND (planned OR now − q.compactEndedAt ≤ FLUSH_STALE) → busy   # хід стискання скінчився, Flush його кінця ще не виконано: хост тримає /compact, набрану під час ходу, до його кінця, і хук може спрацювати ще до планування Flush (живий сценарій 8)
        otherwise → written: q with optimize = true, optimizePrompted = false, compact = true, compactEndedAt absent   # запит мітки стає цим (уся розмова покриває блок); запит, чий Flush загубився, пишеться й планується знову

    ON command.run compact (e):                                   # хук, на який хід не чекає (як /handoff)
        route = CompactRoute(e)
        IF route = pass: RETURN next(e)                            # нічого не читається і не чекається до next
        IF route = host: RETURN next(e with args = "")             # стандартний підсумок хоста
        (dir, session) = storage and session id, read once         # CONC-01; немає або кидає → RETURN next(e) (COMPACT_NO_STORAGE)
        on the queue chain in dir: IF hook aborted: no write (aborted) ELSE RequestCompact(q, IsPlanned(FlushState, now))   # CONC-02: остання перевірка перед записом
        IF handoff: RETURN { text: COMPACT_HANDOFF }
        IF busy: RETURN { text: COMPACT_BUSY }
        IF aborted: RETURN { text: COMPACT_REFUSED }               # нічого не записано
        IF queue unreadable OR write failed: RETURN next(e)        # COMPACT_NO_STORAGE
        IF hook aborted: undo; RETURN { text: COMPACT_REFUSED }    # optimize, optimizePrompted, compact — як прочитано
        TRY RequestFlush(session)                                  # SP_CTX_02_06: FlushState.compactSession = session; планує, якщо Flush не заплановано
        CATCH err (the host refused the timer): undo; toast "context-editor: /compact: <err>"; RETURN { text: COMPACT_REFUSED }   # COMPACT_REFUSED: нічого не лишається запланованим чи запитаним
        RETURN { text: COMPACT_REPLY }                             # без next: хост не запускає компактизації

    ON hook failure (.catch): CompactFailure(e, { called, kind }) =
        called OR kind = re-entry OR e.origin.kind = plugin → next(e)   # повтор next безпечний; власний $.command.run мода хост пропускає як re-entry (навичка plugin-hooks, пункт 60)
        otherwise → { text: "compact failed: <kind>; /compact host runs the host's summary" }   # COMPACT_HOOK_FAILED

    CompactTurnText(notes) = "context-editor: the person ran /compact. With this mod on, the host's summary does not run: you compress the conversation yourself in this turn, and the mod applies your batch when the turn ends."
        + " Call context_list (\"count\":0 gives the telemetry and the candidates by reason; then list the rows from the start). Close an open stage whose work is done with context_tag {\"tags\":[{\"op\":\"close\"}]}; then treat the conversation up to the current work as the block: collapse finished stages into stage records and summarize big outputs you have used."
        + NotesHint(notes) + "\n" + STAGE_ADVICE
        + "\nThe session stops after this batch: pass \"resume\": true (or a resume_prompt) in context_edit only if a task was running and should go on. End your turn with a one-line status. The optimization mark has no effect in this turn."

Хід стискання — звичайний хід оптимізації ([SP_CTX_04_06](./context_editor.states.sp.md#SP_CTX_04_06)): Flush (Optimize) для `compact` не перевіряє закритого блоку і надсилає CompactTurnText; заміна `optimize → optimizePrompted` переносить `compact`; мітку в відповіді ходу DetectOptimize ігнорує; `context_edit` без `resume` у ньому ставить `resume = false` ([SP_CTX_DEC_16](./context_editor.sp.md#SP_CTX_DEC_16)), тож після застосування сесія зупиняється, а звіт іде з наступним промптом людини. Пакет, що вже в черзі, застосовується до промпту, і звіт його застосування їде в тексті промпту стискання. Збої шляху `compact` у Flush (відмова команди, промпт відхилено) людина бачить спливним повідомленням, а не лише рядком стану, якого у VS Code / stream-json може не бути. Промпт — власний текст мода з PREFIX: хост обгортає його рамкою «The context-editor plugin sent a message: … in the user's place» (навичка plugin-hooks, пункт 57), тож текст сам каже, що `/compact` запустила людина, а пише — мод ([SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17)). Відповідь мода на команду (COMPACT_REPLY) модель теж бачить рядком виводу команди, тому вона говорить про людину й агента в третій особі.

Хід, що вже йде. Вбудована `/compact` без `immediate`: набрана посеред ходу, вона чекає його кінця, і хук спрацьовує, коли сесія вільна (живий прогін: ~80 мс після `turn.complete`). Якщо Flush того ходу вже заплановано, другого таймера немає: той самий Flush застосовує пакет і надсилає промпт стискання замість промпту продовження. Хід, що почався до промпту (OPTIMIZE_PERSON), не переривається: запит лишається для DeliverReport. Сесія, перемкнена `/clear` чи `/resume` між командою і таймером, — Flush пропускає промпт зі спливним повідомленням (COMPACT_SESSION_CHANGED), запит лишається в черзі старої сесії, і DeliverReport віддасть пораду з першим промптом там.

Відповідь мода (`text` без `next`) хост показує як вивід команди під назвами розширень, що чіпляють команду, і пише рядками команди (`<command-name>/compact</command-name>`, порожні аргументи, `<local-command-stdout>`); PersonText читає їх як порожні ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)). Компактизації немає: обробник `session.compact` не викликається (живий прогін: «answered command.run without next(); nothing beneath it ran»). У stream-json ці рядки лишаються серед рядків розмови і після застосування пакета ходу стискання, у терміналі — ні (навичка plugin-hooks, пункт 60).

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| COMPACT_NO_STORAGE | сховища немає, читання сховища кидає, черга `unreadable` або запис не вдався | команда йде до хоста як без мода (підсумок хоста) |
| COMPACT_HANDOFF | у черзі запит передачі | відповідь COMPACT_HANDOFF; нічого не записано і не заплановано |
| COMPACT_BUSY | хід стискання йде (`compact` і `optimizePrompted`), запит є і Flush заплановано, або хід стискання скінчився, а Flush його кінця ще не виконано (`compactEndedAt`: Flush заплановано або минуло ≤ FLUSH_STALE від кінця) | відповідь COMPACT_BUSY; другого запиту, таймера і промпту немає. `compactEndedAt` знімає Flush, коли виконується, і новий запит; поза вікном без Flush він нічого не вирішує |
| COMPACT_REFUSED | хук покинуто до запису чи після нього, або хост відхилив таймер | запит повернуто як прочитано, нічого не заплановано; відповідь COMPACT_REFUSED (при відмові таймера ще й спливне повідомлення з причиною); наступна `/compact` планує знову |
| COMPACT_SESSION_CHANGED | сесія змінилась між командою і таймером Flush | спливне повідомлення «/compact skipped: the session changed …»; промпту немає |
| COMPACT_NOTHING | хід стискання скінчився (не перерваний) без жодної правки в черзі | спливне повідомлення COMPACT_NOTHING (DetectOptimize); підсумку хоста мод не запускає |
| COMPACT_HOOK_FAILED | хук кинув виняток чи перевищив бюджет до `next` для походження людини | CompactFailure: відповідь «compact failed: <kind>; /compact host runs the host's summary»; компактизації немає |

### 02_43. ApplyLine і LogApply  {#SP_CTX_02_43}

> **Criticality:** normal

Purpose: один рядок для людини в стрічці після кожного застосування, що щось змінило, — скільки правок застосовано і скільки звільнено ([C_CTX_DEC_26](./context_editor.concept.md#C_CTX_DEC_26), рішення розробника «Так (Recommended)»). Модель його не бачить: канал — `$.ui.log` (навичка plugin-hooks, пункт 62), у рядки розмови нічого не додається.

Input: ApplyReport ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)), калібрування `TagRegistry.charsPerToken` (ratio), ApiChars API-подання, яке прочитав обробник (`apiChars`; відсутнє, коли подання немає або воно сягнуло вікна, ApiCut; фаза 29).
Output: рядок `$.ui.log` або нічого.

    ApplyLine(report, ratio, apiChars?) → string:   # `applyLine` у hooks/edits.ts, чиста
        IF report.applied empty: RETURN ""
        tokens(c) = max(0, round(c / (ratio OR PLAIN_RATIO)))                 # заокруглення Estimate звіту (SP_CTX_02_34)
        freed = tokens(charsBefore − charsAfter)                              # як «estimate: … freed» звіту, не різниця заокруглених розмірів
        before = apiChars present ? apiChars : charsBefore                    # фаза 29: розмір розмови — символи API-подання (з вкладеннями хоста, як чисельник калібрування); без нього — рядки, як до фази 29
        after = before − (charsBefore − charsAfter)
        head = "applied <len(applied)> edit(s)" + (failed ? ", <len(failed)> not applied" : "")
        notes = [ratio absent ? "approx." : "", freed > 0 ? "freed ~" + Kilo(freed) : ""] without empty, joined "; "
        RETURN head + ": conversation ~" + Kilo(tokens(before)) + " → ~" + Kilo(tokens(after)) + " tokens" + (notes ? " (" + notes + ")" : "")   # спершу що виміряно, далі звільнене (рев'ю фази 28)
    Kilo(n) = n < 1000 → n; n < 10000 → n/1000 з одним знаком після коми, без ".0", + "k"; інакше round(n/1000) + "k"   # 950, 4.2k, 41k

    LogApply(id):                                   # `logApplied` у hooks/flush.ts; Flush (SP_CTX_02_06), одразу після `compact`, до продовження чи ходу оптимізації
        IF compacted (обробник записав звіт id цього застосування): line = AppliedLine(id); IF line: $.ui.log(line)   # будь-який збій губить лише рядок
    AppliedLine(id) = пам'ять екземпляра модуля: рядок, який HandleCompaction (SP_CTX_02_07) лишив разом із `lastReported` = id, коли `applied` непорожній; інакше нічого

    LogSeeded(seed):                                # `logSeeded` у hooks/handoff.ts; RunHandoff (SP_CTX_02_21), щойно нова сесія тримає засів
        line = ApplyLine(seed.report, seed.ratio); IF line: $.ui.log("handoff: " + line)   # без apiChars: засів збирає рядки, розмір — за ними, як до фази 29

Приклад: `applied 3 edit(s): conversation ~150k → ~109k tokens (freed ~41k)`, без калібрування — `… tokens (approx.; freed ~41k)`; у терміналі хост малює його сірим рядком `● context-editor: applied 3 edit(s): …` під `⎿ Compacted`; передача — `● context-editor: handoff: applied 2 edit(s): …`. Без калібрування (розмова менша за CALIB_TOKENS) оцінка — PLAIN_RATIO: у живому прогоні фази 28 у терміналі рядок показав ~24k проти ~41,5k за проксі (на виводі `seq` — ~9,7k проти ~22,6k), бо JSON і цифри мають менше символів на токен; тому «approx.»; фаза 29 калібрує перед кожним застосуванням і знижує CALIB_TOKENS ([SP_CTX_02_34](#SP_CTX_02_34), [SP_CTX_DEC_30](./context_editor.sp.md#SP_CTX_DEC_30)). Розмір розмови до фази 29 рахувався за символами рядків, а відношення — за символами API-подання з вкладеннями хоста (CLAUDE.md, перелік навичок, `deferred_tools_delta`): рядок занижував розмову на токени вкладень, хоч і звільнене, і відношення були правильні; з фази 29 «до» — ApiChars, «після» — «до» мінус звільнені символи. Число близьке до Whole ([SP_CTX_02_28](#SP_CTX_02_28)), тож більше за `conversation` заголовка `context_list` на рядки FIXED_IN_MESSAGES (пам'ять, навички в першому повідомленні).

Чому з Flush, а не з обробника. Обробник `session.compact` працює посеред компактизації хоста; рядок `$.ui.log`, записаний тоді, у терміналі ліг би перед межею компактизації, яку хост ще не записав, і людина могла б його не побачити. Команда `$.command.run('compact')` повертається, коли обробник відповів, тож Flush пише рядок після застосування. Обробник лише лишає рядок у пам'яті екземпляра разом з ідентифікатором звіту (порт `reported(id, line)`), а Flush пише його, коли після команди бачить у черзі звіт саме з цим ідентифікатором. `/compact` людини (хід стискання, [SP_CTX_02_42](#SP_CTX_02_42)) застосовує свій пакет тим самим Flush, тож рядок з'являється і тоді. Скільки звільнено — оцінка тієї самої форми, що в звіті агенту; виміряну зміну показує лише телеметрія агента після наступної відповіді ([SP_CTX_02_28](#SP_CTX_02_28)).

Хости (навичка plugin-hooks, пункт 62; живий прогін фази 28). Термінал: сірий рядок `● <plugin>: <text>` у стрічці, у JSONL сесії — рядок `system`/`informational`, видимий і після `--resume`; модель не бачить ні наживо, ні після відновлення (27 тіл запитів без нього). stream-json: подія `{"type":"system","subtype":"ui_log","plugin":…,"text":…}` у потоці (17/17 сесій, одна на застосування), у JSONL сесії не пишеться; розширення VS Code її не малює (2.1.296, спостереження людини 2026-10-12; там видно лише `$.ui.notify` — backlog плану).

Errors: відмов немає. Рядка немає, коли жодна правка не застосувалась, обробник відповів `skip` без звіту, хост відхилив команду, звіт записав інший екземпляр модуля (перезавантаження між обробником і Flush) або `/compact` з MARKER запустила сама людина (05_04).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §02 Contracts 02_27–02_38 перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.stages.sp.md](./context_editor.stages.sp.md), якорі без змін |
| 2026-10-11 | PL_AUD_CTX фаза 3 (CF-3): 02_32 — правило «рядок лише з thinking не ціль за індексом» спільне з тегами і правками `rewrite`/`collapse` (посилання) |
| 2026-10-11 | PL_AUD_CTX фаза 3, рев'ю: 02_32 — правило стосується лише рядка асистента з одним thinking; підказка людини лише з медіа лишається ціллю тегів, `context_note` її, як і раніше, не приймає |
| 2026-10-11 | PL_AUD_CTX фаза 5 (CF-8, CF-9): рядок нагадування називає автора — `reminder from your note <id>`, промптом нагадування не стає (02_33); CutDelivery обрізає доставку в рамці всередині тіла і повертає закривальні теги, які забрало обрізання, у межах MAX_DELIVERY_TEXT (02_35) |
| 2026-10-11 | PL_AUD_CTX фаза 7, рев'ю: RecordDelivery (02_35) — файл доставок, який не вдалося перенести вбік, не перезаписується; запис втрачено |
| 2026-10-11 | PL_AUD_CTX фаза 8 (аудит коду, CF-16): 02_38 — Responses, ResponseStart і предикат промпту беруться з [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04) (одне джерело з FrozenPrefix); ResponseStartRows прибрано, CacheCost бере `start` з ResponseStart (без API-подання — початок відрізка, як застосування); CacheShape — відповіді й позиції один раз на пропозицію |
| 2026-10-11 | PL_AUD_CTX фаза 8, рев'ю: 02_38 — Kinds не рахує порожнього рядка `user`, що не промпт; LookbackStart бере ResponseStart кожного рядка (лише рядки, що самі свій початок), рядок `Cache` телеметрії читає API-подання (`context_list`, звіт закриття етапу) |
| 2026-10-11 | PL_AUD_CTX фаза 11 (аудит коду, CF-22): 02_33 — ворота в пам'яті: відомий з кешу реєстр без жодного `remindAt` — без ланцюжка реєстру й читання; 02_37 — реєстри тегів і псевдонімів на гарячому шляху читаються з кешу модуля; порядок воріт не змінено (крок «запит зменшився» потребує `hint` з реєстру) |
| 2026-10-11 | PL_AUD_CTX фаза 12 (аудит коду, CF-25, CF-26): 02_32 — тексти відмов `context_note` дослівно (DENIED_EMPTY і для списку, довшого за MAX_NOTES; MAX_REGISTRY_BYTES); 02_38 — CostRatios: Opus 5.5 лише за ідентифікатором з 5.5, інший Opus і псевдонім без версії — DEFAULT_RATIOS |
| 2026-10-11 | PL_AUD_CTX фаза 12, рев'ю: 02_38 — голий псевдонім `opus` / `opus[1m]` теж має співвідношення Opus 5.5 (псевдонім іде за поточним Opus; переглянути, коли він зміниться) |
| 2026-10-12 | Калібрування бачить вкладення хоста (беклог, сесія d5614704): 02_34 — Calibrate ділить символи API-подання (ApiChars) на Whole, без подання лишає збережене відношення; 02_28 — `t.attached`, `t.chars`, Whole, `cache.tokens` за TailTokens, Telemetry бере `cache = false`; 02_37 — Measure калібрує за API-поданням і повертає `whole`, Propose передає його в CacheCost і BreakEven; 02_38 — ApiTailChars, TailTokens, глибокий запис = Whole − freed |
| 2026-10-12 | Калібрування бачить вкладення хоста, рев'ю і живий прогін (сесія ac285189: відношення 2,43 при істині ≈2,38, після трьох застосувань 2,73 при ≈2,58, стара формула ≈1,49 і падала; «freed» −20…+10 % від виміряного, нагадування в межах ~5 %): 02_28 — рядок розміру називає вкладення першого повідомлення окремо від незмінної частини (`fixed part (system prompt, tools) ~<fixed − attached>; attached in the first message … ~<attached>`), хвіст рядка `Cache` — тисячами (tokensText), ApiCut замість `len < ROW_WINDOW`; 02_37 — запис застосування названо «all the request's messages» |
| 2026-10-12 | Фаза 24: 02_28 — рядок `Host attachments` телеметрії `context_list` (HostAttachState.left; [SP_CTX_02_40](./context_editor.hostattach.sp.md#SP_CTX_02_40)) |
| 2026-10-12 | Фаза 25: 02_42 PersonCompact — `/compact` людини з модом: хід стискання (хід оптимізації на всю розмову), CompactTurnText, CompactTurnEnded зі спливним повідомленням, `/compact host`, походження plugin і власні інструкції — до хоста ([C_CTX_DEC_23](./context_editor.concept.md#C_CTX_DEC_23), [SP_CTX_DEC_27](./context_editor.sp.md#SP_CTX_DEC_27)) |
| 2026-10-12 | Фаза 25, рев'ю і живий прогін: 02_42 — запит у черзі (`Queue.compact`) і Flush замість окремого таймера (один порядок: застосування, потім один промпт), RequestCompact, COMPACT_BUSY і для ходу, що йде, COMPACT_REFUSED (покинутий хук, відмова таймера), COMPACT_SESSION_CHANGED, CompactFailure — чиста функція; 02_30 — кінець ходу стискання знімає `compact` і дає COMPACT_NOTHING |
| 2026-10-12 | Фаза 25, живий сценарій 8 (fail → виправлено): `/compact`, яку хост тримав до кінця ходу стискання, — COMPACT_BUSY за `compactEndedAt` (DetectOptimize ставить, Flush і новий запит знімають, вікно FLUSH_STALE); RequestFlush ставить `compactSession` лише для таймера, що ще не спрацював, Flush знімає його у `finally` |
| 2026-10-12 | Фаза 26 ([SP_CTX_DEC_28](./context_editor.sp.md#SP_CTX_DEC_28)): 02_27 — розділ навички «Rows marked [context-editor]» замість «Restoring an original» (розшифровка кожного тексту мода, власні виклики, прибрані застосуванням), опис навички називає рядки `[context-editor]`, межа SKILL.md — 9000 символів (8940) |
| 2026-10-12 | Фаза 27 ([SP_CTX_DEC_29](./context_editor.sp.md#SP_CTX_DEC_29)): 02_27 — розділ «Rows marked [context-editor]» називає перелік згорнутого і поле `collapsed`, навичка 8995 символів; 02_29 — пара-носій `collapse` не рахується відтворюваною |
| 2026-10-12 | Фаза 28: 02_43 ApplyLine і LogApply — рядок людини після застосування й передачі через `$.ui.log` ([C_CTX_DEC_26](./context_editor.concept.md#C_CTX_DEC_26), рішення розробника «Так (Recommended)»); 02_27 — розділ навички «Compressed rows and mod texts» замість «Rows marked [context-editor]», опис з відкривачем `Later, your context_edit` (8994 символи; [SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17), A″); 02_37 — кандидати без замінених за ReplacementText |
| 2026-10-12 | Фаза 28, рев'ю і живий прогін: 02_43 — рядок `conversation ~A → ~B tokens (freed ~X)`, «approx.» без калібрування, звільнене заокруглено як Estimate; результати прогону (термінал, `--resume`, stream-json 17/17); 02_27 — опис навички 236 символів (було 261 > 250), межі перевіряє `tests/skill-limits.sh` |
| 2026-10-12 | Дизайн фаз 29–30: 02_28 — поле `tagsFull` і рядок TAGS_FULL_LINE (фаза 30, CF-34, [SP_CTX_DEC_31](./context_editor.sp.md#SP_CTX_DEC_31)); 02_34 — CalibrateBeforeApply у Flush з Measure, спільним з Telemetry, CALIB_TOKENS 5 000 ([SP_CTX_DEC_30](./context_editor.sp.md#SP_CTX_DEC_30), proposed), передача калібрує як досі; 02_43 — ApplyLine рахує розмову за ApiChars API-подання обробника, без нього — за рядками (фаза 29). Первісний дефект калібрування (символи рядків проти токенів з вкладеннями) виправлено раніше, у 0f9e54f |
| 2026-10-12 | Фази 29–30 реалізовано: 02_34 — `measure(u)` (Measure) виділено з Telemetry без зміни поведінки, `calibrateBeforeApply` за портом CalibrateIO (`usage`, `api`, `readTags` — кеш, `updateTags` — ланцюжок реєстру), CALIB_TOKENS 5 000 ([SP_CTX_DEC_30](./context_editor.sp.md#SP_CTX_DEC_30) B); 02_43 — `applyLine(report, ratio, apiChars?)`; 02_28 — `t.tagsFull` з RegistryFull і рядок TAGS_FULL_LINE (`tagsFullLine` у `hooks/tags.ts`) після рядка нотаток |
| 2026-10-12 | Живий прогін фази 29: 02_34 — CALIB_TOKENS знову 20 000 ([SP_CTX_DEC_30](./context_editor.sp.md#SP_CTX_DEC_30) → A; розбивка хоста завищує системну частину на 13–25 тисяч, похибка 36–51 %); CalibrateBeforeApply і ApplyLine за ApiChars лишаються |
