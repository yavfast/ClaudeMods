# Редактор контексту агента — Specification: курування історії — правки й тексти замін

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-17
> **Updated:** 2026-10-21
> **Umbrella:** [SP_CTX](./context_editor.sp.md); частина [курування історії](./context_editor.curation.sp.md)
> **Concept:** [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)
>
> Частина курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)) специфікації [SP_CTX](./context_editor.sp.md): джерело заміненого змісту й поля правок і тегів, правило слів людини, `describe` для вставок, відкривачі замін з походженням, перевірка залежностей, слід власних викликів, застаріле читання, готові заміни, піни, правила й тексти навички. Читати перед зміною перевірок правок, текстів замін, `rows.ts`, `edits.ts`, `queue.ts` чи навички.

## Contents

Розділи цього файлу (h3 розділів курування; решта — у [курування історії](./context_editor.curation.sp.md)):

- [01_27. EpistemicStatus (вилучено)](#SP_CTX_01_27) — вилучений епістемний статус: чому його немає і що лишилось від якоря
- [01_28. Source](#SP_CTX_01_28) — джерело заміненого змісту, яке мод виводить з виклику заміненої пари
- [01_30. Curation Fields of Edits and Tags](#SP_CTX_01_30) — нові поля правок (`changes` операції `state`, `quoted`, `host`) і причина тегу `superseded`
- [02_58. PersonWords](#SP_CTX_02_58) — слова людини: відмова при постановці й застосуванні правки, що їх захоплює
- [02_59. DescribePasted](#SP_CTX_02_59) — `describe` для вставок людини: позначки замість вставленого, набраний текст лишається
- [02_62. ReplacementOpeners](#SP_CTX_02_62) — відкривачі замін голосом агента з походженням змісту
- [02_63. DependencyCheck](#SP_CTX_02_63) — застереження, коли факти оригіналу процитовано пізніше і їхнє джерело зникне
- [02_64. TraceOwnCalls](#SP_CTX_02_64) — рядок сліду на місці прибраних власних викликів `context_*`
- [02_65. SupersededRead](#SP_CTX_02_65) — правило R6: раннє читання файлу, чий вміст відтоді змінився, — `superseded`
- [02_66. ReadyReplacements](#SP_CTX_02_66) — готові тексти замін застарілих читань у звіті закриття етапу
- [02_68. Pins](#SP_CTX_02_68) — піни — рішення агента; піни передачі і хто їх знімає
- [02_69. CurationTexts](#SP_CTX_02_69) — правила курування (`curation.md`, `context_list` з `"rules": true`) і тексти навички

## 01. Data Structures — курування

### 01_27. EpistemicStatus (вилучено)  {#SP_CTX_01_27}

Вилучено 2026-10-15 рішенням [SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44): слова статусу (`verified`, `read`, `inferred`, `assumed`) у відкривачі заміни на воротах фази 39 майже не змінили довіри агента до стиснутого ([SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07)), тож заміна несе лише джерело ([SP_CTX_01_28](#SP_CTX_01_28)) і `which you quoted from later`. Поля `status` у правках і тегах, переліку STATUS_WORDS, слів StatusWords і відмов STATUS_REQUIRED і BAD_STATUS немає; надійність окремих фактів агент, коли треба, називає власними словами в тексті заміни. Якір лишається для посилань.

### 01_28. Source  {#SP_CTX_01_28}

Звідки взято замінений зміст ([C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06)): мод виводить його з виклику заміненої пари, а не зі слів агента. `SourceOf(call) → string`, не довше за MAX_SOURCE символів, обрізання — OneLine ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04): не розрізає сурогатної пари, кінець `…`).

| Tool of the call | Source |
|------------------|--------|
| `Read`, `Edit`, `Write` | `<tool> <path>`: `file_path` відносно кореня проєкту сесії, коли він усередині нього, інакше абсолютний |
| `NotebookEdit` | `NotebookEdit <path>` з `notebook_path`, так само |
| `Bash` | `Bash "<command>"`: команда одним рядком |
| `Grep`, `Glob` | `<tool> "<pattern>"`, для `Grep` з ` in <path>`, коли `path` є (шлях — так само відносно кореня проєкту) |
| `WebFetch` | `WebFetch <host><path>`: без userinfo, запиту й фрагмента (запит буває носієм токена) |
| `WebSearch` | `WebSearch "<query>"` |
| `Agent`, `Task` | `subagent "<description>"` |
| носій `collapse` (вхід з полем `collapsed`, [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) | `collapsed rows (<перелік>)`: заміна стискає нотатку згортання, а не вивід інструмента |
| інший | `<tool>` і, коли KeyArg ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) непорожній, ` <KeyArg>` |

Обрізання значення в лапках лишає закривну лапку; лапки всередині значення не екрануються. Шлях порівнюється з коренем проєкту сесії без кінцевих `/`: сам корінь — `.`, корінь `/` проєкту не називає (шлях лишається абсолютним). У `Grep` шаблон бере щонайбільше половину MAX_SOURCE, а шлях — решту. userinfo URL відкидається до останнього `@`. Дім — `sourceOf` у `hooks/edits.ts` поряд із KeyArg і OneLine (`rows.ts` — ядро L0 без імпортів). Корінь проєкту — `$.session.root()` ([SP_CTX_DEC_45](./context_editor.decisions-21.sp.md#SP_CTX_DEC_45)): `cd` оболонки його не рухає, тож після `cd` відносний шлях рахується від тієї самої теки, що й шлях архіву; компактизація (CompactionIO `cwd`) і передача (HandoffIO `cwd`) передають його в ApplyEdits (ApplyOptions `cwd`; назва поля лишилась); без нього шлях абсолютний. Шлях, відносний уже у вхідних даних (`Grep` з `path: "src"`), лишається як є — відносним до теки оболонки на момент виклику.

Invariants: джерело ніколи не бере тексту результату; команда й шлях уже стоять у вході виклику, який `summarize` лишає в розмові, тож джерело не відкриває нічого нового.

### 01_30. Curation Fields of Edits and Tags  {#SP_CTX_01_30}

Edit ([SP_CTX_01_02](./context_editor.structures.sp.md#SP_CTX_01_02)) і QueuedEdit ([SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03)):

| Field | Applies to | Type | Required | Description |
|-------|------------|------|----------|-------------|
| changes | `state` (нова операція) | list<StateChange> | yes | 1..MAX_STATE_ITEMS змін, у порядку застосування |
| quoted | QueuedEdit `summarize`, `drop`, `collapse` | `true`? | no | DependencyCheck знайшов цитати оригіналу ([SP_CTX_02_63](#SP_CTX_02_63)); пише мод |
| host | `drop` | string? | no | `id` запису рядка хоста ([SP_CTX_01_31](./context_editor.curation.hostrows.sp.md#SP_CTX_01_31)); виключає `tool_use_id` і `ref` ([SP_CTX_02_61](./context_editor.curation.hostrows.sp.md#SP_CTX_02_61)) |

StateChange — одне з: `{ "do": "add", "kind": <kind>, "text": <string> }`, `{ "do": "set", "id": <id>, "text": <string> }`, `{ "do": "mark", "id": <id>, "as": "harmful" | "outdated" }`, `{ "do": "unmark", "id": <id> }`, `{ "do": "remove", "id": <id> }`. Правка `state` має форму `{ "op": "state", "changes": [...] }`; ціллю є рядок, що тримає тег `state` у мить застосування.

Tag ([SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)): `reason` тегу `review` додає `superseded` (R6, [SP_CTX_02_65](#SP_CTX_02_65)).

Розбір файлів: невідоме значення `do`, `kind`, `as` чи `reason` робить чергу або реєстр `unreadable`, як будь-яке погане поле ([SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04)). Черга, записана старішою версією, поля `quoted` не має: така правка застосовується без застереження про цитати. Поля статусу немає ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)): `status` у правці чи тегу мод ігнорує разом зі значенням, як будь-яке зайве поле (checkShape правки, [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03); isTag тегу).

## 02. Contracts — курування

### 02_58. PersonWords  {#SP_CTX_02_58}

> **Criticality:** core

Purpose: слова людини в поточній сесії лишаються дослівними: правку, що їх захоплює, мод відхиляє при постановці в чергу й наново при застосуванні; дозволу на неї немає ([C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10), [C_CTX_DEC_38](./context_editor.curation.concept.md#C_CTX_DEC_38)). Замінює попередження PersonWarnings і PersonTagWarnings ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)).

Processing logic (pseudocode):
    PersonText(text): as SP_CTX_02_02, with one more rule before the last:
        IF HostFrame(t) present → empty                # текст розгорнутої навички чи звіту субагента — не слова людини, де б він не стояв
    PersonRow(r) (SP_CTX_02_02) holds also for a user row without results whose text is DescribedText (SP_CTX_02_04: DESCRIBED_HEAD of this version and the older forms; isDescribedText in hooks/rows.ts, STRUCT-01)   # промпт після describe: набраний людиною текст стоїть за описом (SP_CTX_02_59); мітка "#i (described prompt)"
    PersonHits(rows, edit, deliveries):                # PersonRow, PersonPair, PersonDelivered — SP_CTX_02_02
        collapse → PersonRow rows, PersonPair result rows and PersonDelivered rows in its span
        summarize or drop of a PersonPair → its result row
        drop whose result row is PersonDelivered by a delivery whose every anchor id is the dropped pair → that row
        rewrite, describe, state → none                # rewrite і state — лише власні рядки агента; describe лишає набраний текст (SP_CTX_02_59)
    in PrepareEdits (context_edit): an edit with hits is rejected
        "<label>: covers the person's words: #i (prompt), #j (AskUserQuestion answer), #k (message sent during this tool call); they stay verbatim in this session: narrow the range or split it around them"
        a pair: "<label>: the AskUserQuestion answer is the person's words; it stays verbatim"
        a drop with a delivery: "<label>: the person's message sent during this tool call goes with it; summarize the call instead: the message stays after it"
    in context_tag, add disposable: the same hits for its target → the request is refused with the same text
    in QueueTagReplacements (SP_CTX_02_13): a tag whose target has hits now is not queued; it is removed, and the result of the call that queued the replacements (the close report of context_tag, or the result of context_edit that ended a waiting block) says "disposable <target> dropped: it covers the person's words"
    in ApplyEdits of HandleCompaction and BuildSeed, before any replacement, beside ScreenPinned (SP_CTX_02_07):
        ScreenPerson: hits on the rows of the event (e.messages; visible rows of the seed) and the deliveries file → the edit fails "<label>: covers the person's words now; they stay verbatim"; failed edits go first in report.failed
        hits come from the rows and the deliveries only, never from tags.json or pending.json   # стан мода агент може змінити оболонкою (C_CTX_06_10)

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| PERSON_WORDS | правка при постановці захоплює слова людини | звузити чи розділити діапазон; для пари з відповіддю — нічого; для `drop` з доставкою — `summarize` |
| PERSON_TAG | `disposable` захоплює слова людини | так само |
| PERSON_WORDS_NOW | при застосуванні правка захоплює слова людини (черга змінена поза інструментами, рядки зсунулись) | правку не застосовано; решта пакета йде |

Файл доставок — виняток із правила «за рядками, а не за станом на диску»: повідомлення людини посеред ходу хост дає вкладенням, а не рядком, і `deliveries.json` — єдиний його запис до першого застосування ([SP_CTX_02_35](./context_editor.deliveries.sp.md#SP_CTX_02_35)). Оболонка може змінити й цей файл — та сама межа, що й для самого запису доставки ([C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10)).

Правило діє лише в поточній сесії: передача «документом» — поза ним ([C_CTX_DEC_36](./context_editor.curation.concept.md#C_CTX_DEC_36)); засів «транскриптом» застосовує правки, тож ScreenPerson діє і в BuildSeed ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)). Команди, що знімала б відмову, немає.

### 02_59. DescribePasted  {#SP_CTX_02_59}

Purpose: `describe` замінює медіа й вставлені блоки промпту людини описом агента; набраний людиною текст лишається дослівним, оригінал іде в архів ([C_CTX_DEC_39](./context_editor.curation.concept.md#C_CTX_DEC_39)). Розширює `run describe` ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)).

Processing logic (pseudocode):
    PasteBlocks(text) = the spans <pasted_content id="X">…</pasted_content id="X"> (the closing tag repeats the id) and <pasted_content>…</pasted_content>, in order, not nested
    in PrepareEdits: describe of a prompt row needs media of the row OR PasteBlocks(text) not empty; else rejected "no media or pasted text found in that row"
    run describe (rows of the apply):
        kinds = (media of the row archived ? media) + (PasteBlocks(text) ? pasted text)
        IF kinds empty: fail "no media or pasted text found in that row now"
        typed = text with paste block k (from 1) replaced by "[pasted text <k>, <chars> chars: see your description above]"
        row text = DescribedWords(kinds) + note + mediaNote(row) + ": " + description + "\n\n" + typed
        DescribedWords: media → "Later, your context_edit describe call replaced the media you had seen here with your own description" (DESCRIBED, як досі)
                        pasted text → "Later, your context_edit describe call replaced the pasted text you had seen here with your own description"
                        both → "Later, your context_edit describe call replaced the media and the pasted text you had seen here with your own description"

Набраний текст — усе поза блоками вставок і медіа, зокрема рамки хоста в тому самому рядку (контекст редактора, нагадування): `describe` їх не чіпає. Опис уже описаного рядка можливий, лише коли в ньому лишилися медіа чи вставки. isDescribedText (`hooks/rows.ts`, STRUCT-01) розпізнає DESCRIBED_HEAD — голову кожного відкривача `describe` цієї версії — і старі форми, тож CollapsedList і PersonRow ([SP_CTX_02_58](#SP_CTX_02_58)) бачать описаний промпт.

Ворота перед кодом пройдено (фаза 39, 2026-10-15, хости 2.1.296 і 2.1.299; [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07)): хост ставить обгортку в сам текст рядка — її бачать `prompt.submit`, `session.append`, `$.session.messages()`, форма API і транскрипт, тож PasteBlocks читає текст рядка. Обгорнуто: велику вставку в терміналі (згорнуту в «[Pasted text #1 +N lines]»), записи поля SDK `pasted_content` (дописані після набраного тексту) і `inline_pastes` (на своєму місці в тексті); розширення VS Code (OSS, 2.1.299 і 2.1.300) за своїм кодом шле вставки полем `inline_pastes` — наживо не спостережено. Коротка вставка в терміналі, яку хост не згортає, лишається набраним текстом без обгортки (спостережено на 2.1.299) — `describe` її не відрізнить, і вона лишається дослівною. Id обгортки — один на сесію (чотири шістнадцяткові знаки), тож блоки розрізняє лише порядок, а не id.

Опис лише вставки перебудовує рядок, тож медіа промпту, якого застосування не бачить, пропало б без архіву: коли форма API обрізана вікном до цього рядка, правка не застосовується («outside the API window; media unknown»), а коли медіа промптів не зіставлено з рядками — «the prompt may hold media that cannot be archived» (як для `collapse`, [SP_CTX_DEC_06](./context_editor.decisions-01.sp.md#SP_CTX_DEC_06)).

Медіа, яке застосування знайшло, але не заархівувало, лишається в рядку: опис самої вставки поряд із ним не застосовується («media could not be archived», як для медіа). Межа: блок без id закінчується першим `</pasted_content>` у тексті, тож вставка, що сама містить цей тег, обріжеться на ньому; блоки з id (термінал і поля SDK, [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07)) цього не мають, бо закривальний тег повторює id.

Errors: NO_MEDIA при постановці («no media or pasted text found in that row») і при застосуванні («… now»), як для медіа.

### 02_62. ReplacementOpeners  {#SP_CTX_02_62}

Purpose: текст заміни говорить від імені агента і несе походження змісту; статусу змісту він не несе ([C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06), [C_CTX_DEC_33](./context_editor.curation.concept.md#C_CTX_DEC_33), [C_CTX_DEC_40](./context_editor.curation.concept.md#C_CTX_DEC_40), [SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)). Змінює тексти `run summarize`, `run collapse`, `run rewrite`, `run describe` ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)).

Processing logic (pseudocode):
    Quoted(q) = q ? ", which you quoted from later," : ""
    summarize: (via = tag ? TAG_SUMMARIZED_OF : SUMMARIZED_OF) + SourceOf(call) + " you had read here" + Quoted(quoted) + (via = tag ? " with your own note" : " with your own summary")
    collapse:  collapsedWords(n, list, via) with Quoted(quoted) before " with your own note"   # перелік у дужках і далі — походження діапазону (CollapsedList)
    rewrite:   RewrittenWords(via)
    describe:  DescribedWords(kinds)   # SP_CTX_02_59
    then, as before: note (" (original: <archive>, open with Read)") + mediaNote + ": " + agent text

Приклад: `Later, your context_edit summarize call replaced the full output of Read docs/x.md you had read here, which you quoted from later, with your own summary (original: …, open with Read): …`.

Розпізнавання (ReplacementText, `hooks/rows.ts`, STRUCT-01): REPLACEMENT_OPENERS отримує голови SUMMARIZED_OF, TAG_SUMMARIZED_OF, DESCRIBED_HEAD, STATE_REBUILT і TRACE_OPENER; повні відкривачі фази 28 лишаються в списку, бо збережені сесії мають і їх. Голови `rewrite`, `collapse` і тегових `rewrite`/`collapse` не змінюються. Заміна тегу `disposable` будується тими самими словами з `via = tag`.

Ворота перед кодом пройдено (фаза 39, 2026-10-15; живий сценарій «Тексти замін з походженням і статусом», [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07), як спайк [context_editor_authorship](./context_editor_authorship.spike.md)): з джерелом у відкривачі агент і далі визнає стискання своїм (28 з 28 сесій з джерелом і статусом, 9 з 9 у контролі з поточними текстами; P13, P23 не повертаються, хоча у варіантах зі статусом траплялись 1 заперечення власних викликів і 2 «вигадав» при малому n). Слова статусу після «with your own summary» довіри майже не змінили (впевненість haiku: контроль (поточні тексти, без джерела й статусу) 94.6, `read` 91.4, `inferred` 93.8, `assumed` 86.0), тож відкривач іде лише з джерелом ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)).

Errors: власних відмов немає; поле `status` правки чи тегу мод ігнорує як зайве ([SP_CTX_01_30](#SP_CTX_01_30), [SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)).

### 02_63. DependencyCheck  {#SP_CTX_02_63}

Purpose: попередити, коли факти оригіналу процитовано в пізніших текстах агента і після правки їхнє єдине джерело зникне з вигляду ([C_CTX_06_07](./context_editor.curation.concept.md#C_CTX_06_07); гіпотеза). Ніколи не відмовляє.

Processing logic (pseudocode):
    FUNCTION DependencyHits(rows, edit) → { rows, examples }:   # PrepareEdits: summarize, drop, collapse
        target = the result of the pair (summarize: the call's input stays) | the call's input and its result (drop) | texts, inputs and results of rows[from..to] (collapse)   # не весь рядок результатів: у ньому бувають результати паралельних викликів
        later = assistant rows after the end of target with non-empty text that is not ReplacementText
        frags = Fragments of each text of later, row by row in row order, distinct, ≤ MAX_DEP_FRAGMENTS in all   # не з цілі: перші MAX_DEP_FRAGMENTS фрагментів великого виводу бувають самим наповненням
        an input counts by its values (strings and numbers), not by its JSON text: JSON escapes quotes, backslashes and line breaks
        others = every text, input and result of the conversation outside target and outside later
        hits = f ∈ frags WITH target contains f AND no row of others contains f
        RETURN { rows: rows of later holding hits (≤ MAX_BLOCK_INDEXES), examples: first DEP_EXAMPLES hits }
    Fragments(text) — distinct, in text order, ≤ MAX_DEP_FRAGMENTS, each DEP_MIN..DEP_MAX chars:
        quoted spans between "…", “…”, «…» or `…`;
        identifiers [A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)+; tokens of letters, digits, "_" and "-" with at least one letter and one digit (hashes, values such as secret-value-9f3a2b);
        paths: tokens with "/" and a ".", or starting with "/", "./" or "~/"; URLs;
        numbers with at least 4 digits, a decimal point or a "%";
        each trimmed of a trailing ".,:;!?" and of "*" or "_" at either end (prose and markdown around a quote)
    an accepted edit with hits: QueuedEdit.quoted = true; the result of context_edit adds
        "Note: <label> — facts from it are quoted in your later text #i, #j (e.g. "<f1>", "<f2>"); " + Keep(op) + "."
    Keep(drop) = "after the edit no row holds their source: summarize it instead to keep them"
    Keep(summarize | collapse) = "after the edit only your replacement holds their source: keep them in it"

Заміна з `quoted` каже `which you quoted from later` ([SP_CTX_02_62](#SP_CTX_02_62)); `drop` тексту заміни не має, тож для нього сигнал — лише застереження, і воно радить `summarize` замість `drop`. Фрагменти беруться з пізніших текстів, а не з цілі, і токени з літер і цифр входять у Fragments: так показав живий прогін фази 42 — агент процитував значення `secret-value-9f3a2b` зі 173-го рядка файлу, ключ якого стояв і в промпті людини; старі правила не дали жодного фрагмента. Тексти `later` — лише текст рядків; виклики тих самих рядків належать до `others`. Рядки й фрагменти нумерує той самий перегляд, що й `context_list`. Fragments, DependencyHits і текст застереження (`dependencyNote`) живуть у `edits.ts`, виклик — у QueueEdits (`queue.ts`) після PersonWords. Тег `disposable` перевірки не проходить: концепт називає лише три операції. Ціна — пошук фрагментів у пізніших текстах агента, обмежений MAX_DEP_FRAGMENTS; чи варта перевірка своєї ціни, показують живі прогони ([SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07)).

### 02_64. TraceOwnCalls  {#SP_CTX_02_64}

Purpose: на місці прибраних викликів `context_*` лишити один рядок голосом агента: що він тут зробив ([C_CTX_06_07](./context_editor.curation.concept.md#C_CTX_06_07); гіпотеза проти P13 і P23). Частина DropOwnCalls ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)).

Processing logic (pseudocode):
    in DropOwnCalls, after the own pairs to remove are known and before KeepResponsesWhole:
        FOR each stretch from a prompt row to the next (Responses, SP_CTX_02_04) with at least one removed own pair:
            calls = the removed own calls of the stretch, in order
            trace = Row { role: assistant, text: TraceText(calls), toolUses: [] }   # без handle
            put trace in place of the row of the first call of calls when DropOwnCalls removes that row, else right before that row   # не між викликом і його результатом
    TraceText(calls) = TRACE_OPENER + "; you had called " + items joined ", " + "."   # ≤ MAX_TRACE, обрізання OneLine
        items by tool, in order of first call:
            context_list → "context_list" + (n > 1 ? " " + n + " times" : "")
            context_edit → "context_edit with <k> edit(s)"          # k — сума len(input.edits) його викликів
            context_tag → "context_tag to " + parts joined ", ", one per distinct part in order of its first request: "open stage \"<name>\"" ("open a stage" without a string name), "close the stage", "add <m> <kind> tag(s)" (додані теги за видом), "remove <m> tag(s)"; no part → "context_tag"
            context_note → "context_note (<a> added, <r> removed)"
            context_handoff → "context_handoff"

Однакові рядки сліду одного відрізка (пари, що лишились після одного застосування й пішли з наступним) RepeatsIn ([SP_CTX_02_46](./context_editor.resume.sp.md#SP_CTX_02_46)) повтором не вважає. Лічильники кожного інструмента сумуються по всіх його викликах відрізка; вхід не тієї форми дає ім'я інструмента без подробиць (`context_edit with 0 edit(s)`). Опис іде за входом виклику, а не за результатом: виклик, який мод відхилив, теж названо, тож рядок каже «called», а не «queued». Пари замороженого префікса й пари біля медіа лишаються в розмові, і сліду для них немає; відрізок, де лишились усі власні пари, сліду не отримує. MergeCallRows ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) може влити рядок сліду в текст попереднього перезібраного рядка викликів — прийнято. Звіт застосування й далі каже OwnCallsText. BuildSeed робить так само.

### 02_65. SupersededRead  {#SP_CTX_02_65}

Purpose: позначити раннє читання файлу, чий вміст відтоді змінився, `superseded` ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08)). Правило R6, частина MarkCall ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)) поряд із R4; R5 (`duplicate`, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)) не змінюється.

Processing logic (pseudocode):
    memory of the module: ReadPaths: set<string> = {}   # шляхи, чиї читання бачив цей екземпляр; перезавантаження скидає
    ON a finished, not denied, non-error Read call of the main loop:
        path = input.file_path
        IF path NOT IN ReadPaths: ReadPaths += path; RETURN
        in the background, on the registry chain, IF storage ready AND TagRegistry not unreadable:
            rows = CurrentRows()
            FOR each earlier Read pair e (its call row before this call's row; this call's row not found: none) WITH input.file_path = path, result not error, result not ReplacementText:
                IF e has a tag other than review big, search or duplicate: CONTINUE
                same = offset, limit, pages of the two calls equal (absent equals only absent)
                IF Changed(e.result, this result, same): tag e { review, reason superseded }   # заміняє review big, search, duplicate
            write TagRegistry if changed
    Changed(a, b, same) = NumberedLines(a) and NumberedLines(b) both non-empty AND ((same AND the two maps differ in numbers or text) OR some line number n is in both with different text)
    NumberedLines(text) = the lines matching ^\s*(\d+)\t(.*)$ → number → text   # форма виводу Read (cat -n)

Діапазони без спільних рядків нічого не кажуть про зміну і тегу не дають. Зміни через оболонку правило бачить лише тоді, коли агент перечитав файл ([SP_CTX_DEC_13](./context_editor.decisions-01.sp.md#SP_CTX_DEC_13)). Тег показується `[review: superseded]`; він не заміняє `stale`, `pin`, `disposable` і `state`. Вивід цього виклику — `text` результату `tool.call`, як його читає модель; без нього (відповідь хука) R6 не діє. Дім: `markSuperseded`, `changedRead`, `numberedLines`, `seenRead` і `supersededReads` у `hooks/tags.ts`; ReadPaths — у пам'яті модуля `register.ts`, R6 — гілка читання того самого `afterCall`, що для запису запускає R4, на ланцюжку реєстру; шлях іде в ReadPaths і тоді, коли `text` немає. Тег `review` з причиною `agent` R6 теж не заміняє; як і R4, R6 бачить лише теги з ціллю `tool_use_id` пари (діапазон `disposable` чи пін за якорем рядка її не захищають). Порівнюються лише пронумеровані рядки: на повторне `Read` незміненого файлу хост (2.1.299) відповідає заглушкою «File unchanged since last read…» без рядків, а текст навколо рядків (нагадування хоста) змінюється сам; вивід без пронумерованих рядків тегу не дає (рев'ю фази 43).

### 02_66. ReadyReplacements  {#SP_CTX_02_66}

Purpose: у звіті закриття етапу назвати застарілі читання блоку з готовими текстами замін; приймає їх агент своїм пакетом, сам мод нічого не замінює ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08), [C_CTX_DEC_08](./context_editor.core.concept.md#C_CTX_DEC_08)). Частина BlockReport ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)).

Processing logic (pseudocode):
    in BlockReport, after "Candidates in the block":
        ready = Read pairs with call and result in a..e, an active review tag of reason superseded, stale or duplicate, result not ReplacementText
        IF ready: text += "\nReady replacements (summarize each with its text and what you still need from it): "
                       + ("#<i> <alias or tool_use_id> \"<Ready(tag, path)>\"" for each, ≤ MAX_BLOCK_INDEXES, then "+<n> more") joined "; " + "."
    Ready: superseded → "Outdated: <path> was read again later and its content had changed."
           stale → "Outdated: you changed <path> later."
           duplicate → "Duplicate: a later read repeated this read of <path>."
    path = the path part of SourceOf (SP_CTX_01_28)

Понад MAX_BLOCK_INDEXES записів рядок закінчується `; +<n> more.`. Текст `duplicate` не каже «той самий вивід»: R5 позначає і те саме читання діапазону з іншим текстом, коли R6 не спрацював (перше перечитування після перезавантаження). Пара `Read` без шляху запису не дає. Псевдонім і корінь проєкту BlockReport бере з BlockIO (`readAliases`, `cwd` — `$.session.root()`; обидва — погляди); без них — `tool_use_id` і абсолютний шлях. Дім: `readyReplacements` у `hooks/stages.ts`. Тексти не мають індексів: після застосування індекси зсуваються, а текст заміни лишається. Агент копіює текст у `summarize` разом із тим, що зі старої версії ще потрібно; джерело в заміну ставить мод ([SP_CTX_02_62](#SP_CTX_02_62)).

### 02_68. Pins  {#SP_CTX_02_68}

Purpose: піни — рішення агента; мод ставить два піни передачі — рядок документа в новій сесії (PinDocument) і, як досі, підсумок засіву «транскриптом» (PinSummary, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) — і кожен із них агент знімає ([C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10), [C_CTX_DEC_36](./context_editor.curation.concept.md#C_CTX_DEC_36), [C_CTX_DEC_38](./context_editor.curation.concept.md#C_CTX_DEC_38)).

Processing logic (pseudocode):
    AutoTag (SP_CTX_02_12): rule R1 is removed; AutoTagNeeded loses its R1 clause   # перший промпт людини не пінить ніхто
    PinDocument, at the turn end, in the change of step (2) (TagRegistry.turn += 1, SP_CTX_02):
        IF NOT reg.docChecked:
            rows = CurrentRows()
            IF rows not empty:
                d = the first i < (index of the first assistant row, or len(rows)) with DocumentRow(rows[i])   # stream-json: the host writes the rows of the mod's /clear before the document
                IF d exists AND rows[d] has no tag AND len(reg.tags) < MAX_TAGS:   # «no tag»: no tag whose target is row 0 or a range starting at it (sameTarget, by the first row's anchor); a pair tag does not count
                    put Tag { kind: pin, target: { anchor: fingerprint(rows[d]), hint: d }, created_turn: reg.turn }
                reg.docChecked = true
    DocumentRow(row) = a user row without results whose text, after a leading line that matches ^The .+ plugin sent a message:$ (PLUGIN_FRAME, SP_CTX_02_02), starts with DOCUMENT_FRAME

Кожен пін агент знімає `context_tag` з `remove`, коли має причину: свій, пін документа, пін підсумку засіву (PinSummary, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) і піни, які R1 поставив у сесіях до цієї версії. Документ, що поїхав прихованим контекстом промпту людини (шлях черги, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), рядком не є і піна не отримує. Перший кінець ходу кожної сесії один раз читає перегляд.

### 02_69. CurationTexts  {#SP_CTX_02_69}

Purpose: правила й тексти, якими агент дізнається про курування ([C_CTX_06_09](./context_editor.curation.concept.md#C_CTX_06_09), [C_CTX_06_12](./context_editor.curation.concept.md#C_CTX_06_12), [SP_CTX_DEC_43](./context_editor.curation.sp.md#SP_CTX_DEC_43)). Точні тексти пише фаза реалізації в межах, названих тут.

Файл правил курування `skills/context-stages/curation.md` (≤ CURATION_MAX символів, перевіряє `tests/skill-limits.sh`) — друга частина навички. Він містить: правила [C_CTX_06_09](./context_editor.curation.concept.md#C_CTX_06_09) (урок із лічбою спроб і причиною; виправлення лише за зовнішнім сигналом, пакетом на межі етапу; дослівна цитата недовіреного тексту з атрибуцією; архів перед каяттям у вигадці; правка замість «ігноруй»; зведення вимог додаванням; не видаляти архівів і транскриптів; огляд підстав і згортання розвідки до висновку на закритті етапу; засліплена перевірка — лише порада), форму операції `state`, рядки сліду й готові заміни, список рядків хоста і `drop` за `id`, `describe` для медіа і вставок.

`context_list` з `"rules": true` ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)) повертає текст `curation.md`, який мод читає з `$.plugin.root`, замість переліку: читання поза проєктом хост дозволяє лише з дозволу людини ([C_CTX_DEC_28](./context_editor.core.concept.md#C_CTX_DEC_28)), а мод читає власний файл без цього. Файл не прочитався — `context-editor: the curation rules could not be read: <error>`. `"rules"` бере лише `true` і без інших параметрів (`from`, `count`, `index`, `full`), інакше відмова BAD_RULES; субагенту, як і для переліку, відмовлено раніше. Рядки розмови при цьому не читаються, і `listedKey` не оновлюється.

Реалізація (фаза 46): `RULES_FILE` і CurationRules у `hooks/stages.ts` (ListIO.rules читає `skills/context-stages/curation.md` з `$.plugin.root` у `register.ts`); речення про `{"rules":true}` — в кінці опису `context_list` і в описі поля `rules`; рядок про правила в SKILL.md (8987 з 9000) і INTRO_TEXT (997 з 1000: вступ стиснуто, щоб рядок умістився, [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)); урок із невдалих спроб — у STAGE_ADVICE. Решту змін таблиці нижче зробили фази 40–45. Правила виправлень посередині історії увімкнено без прогону на акаунті, створеному від 2026-08-31 (розробник, 2026-10-16: «Вмикати, пакетом»): `curation.md` велить ставити їх пакетом на межі етапу й називає ризик thinking-блоків.

Зміни наявних текстів:

| Текст | Зміна |
|-------|-------|
| SKILL.md ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) | «Usually keep verbatim: the person's messages…» і «(the person's first prompt is pinned for you)» → повідомлення й відповіді людини в цій сесії лишаються дослівними: правку, що їх захоплює, мод відхиляє; описати медіа чи вставку її промпту можна; піни ставить і знімає агент; рядки хоста зі списку `context_list` — не слова людини, їх прибирає `drop` за `id`. «It is no loss and nothing you made up» → заміну зробив агент, а джерело в ній каже, звідки зміст; перш ніж назвати щось вигадкою, відкрити архів. Рядок про правила курування: `context_list` з `"rules": true`. Межа 9000 символів лишається |
| INTRO_TEXT | «the person's messages, rules and skills in use usually stay verbatim» → «the person's messages stay verbatim; rules and skills in use usually too»; рядок про правила курування |
| STAGE_ADVICE (і через неї WaitingAdvice та звіт закриття) | повідомлення людини «stay verbatim: edits that cover them are refused» замість «keep them verbatim unless you drop them deliberately»; «Usually keep verbatim the person's messages, rules…» → «Usually keep the rules and skills still in force…»; додати: невдалі спроби — у урок «tried X ×N → failed because Y → do Z» |
| EDIT_DESCRIPTION ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), ≤ MAX_DESCRIPTION; 2043 з 2048 після фази 45: рядок `drop` — `{"op":"drop","tool_use_id", "ref" or "host"}: remove a useless call and its result, or a host row.`, а речення про слот — «changes only by a rewrite, or by the state op once it has items»; що таке `host`, каже опис поля в схемі; 2037 після фази 44, 1888 після фази 40, до неї 2024; на ціль `"host"` фази 45 лишилося 11 символів, `tests/boundary.test.ts`) | додати: рядок операції `{"op":"state","changes"}`; вставки в рядку `describe`; ціль `"host"` у рядку `drop`; «або операцією `state`, коли слот має пункти» в реченні про `[state]`; в останньому абзаці — повідомлення людини (і відповіді AskUserQuestion) лишаються дослівними, правки, що їх захоплюють, відхиляються. Місце: абзац про `ref` переходить в опис поля REF (там уже те саме), текст відновлення за замовчуванням — в опис поля `resume_prompt`; подробиці `changes` — в описі поля. Порядок скорочення пунктів 02_02 не змінюється, нові речення стоять поряд із тими, що їх стосуються |
| TAG_DESCRIPTION ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), ≤ MAX_DESCRIPTION) | без «The person's first prompt is pinned for you.»; у пункті про слот стану «change it only by a rewrite of that row» → «change it by a rewrite of that row, or by the state op once it has items» |
| Відмова STATE_SLOT ([SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03)) і інваріант тегу `state` ([SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)) | «change it only by rewrite of that row» → «change it by rewrite of that row, or by the state op once it has items»; інваріант — так само |
| SKILL.md, розділ State slot (фаза 44) | після речення про `rewrite`: пункти через `{"op":"state","changes":[…]}` (`set`, `mark` harmful/outdated, `unmark`, `remove` за `id`), застосування перебудовує слот, далі його змінює лише `state`; тег іде за перебудованим рядком |
| Відмова BAD_TARGET тегу `disposable` на слоті ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) | «change it only by a rewrite of that row» → «change it by a rewrite of that row, or by the state op once it has items» |
| Легенда переліку ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)) | причина `superseded`; `[state] your state slot (rewrite only)` → `(rewrite, or the state op once it has items)`; рядок заголовка й секція рядків хоста ([SP_CTX_02_61](./context_editor.curation.hostrows.sp.md#SP_CTX_02_61)) |

Тексти COMPACT_ADVICE, COMPACT_REPLY і CompactBrief ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42), [SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55)) уже кажуть лишати слова людини дослівними і не змінюються; запит документа передачі (HANDOFF_PROMPT) і опис `context_handoff` і далі просять завдання й обмеження людини дослівно ([C_CTX_DEC_36](./context_editor.curation.concept.md#C_CTX_DEC_36)).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-17 | structural-event: розділи 01_27, 01_28, 01_30, 02_58, 02_59, 02_62, 02_63, 02_64, 02_65, 02_66, 02_68, 02_69 перенесено дослівно з [context_editor.curation.sp.md](./context_editor.curation.sp.md) (аудит dev-flow, Docs Scaling `hard_split`: 14 640 слів); якорі незмінні |
| 2026-10-21 | Фаза 47 ([SP_CTX_DEC_45](./context_editor.decisions-21.sp.md#SP_CTX_DEC_45)): база відносних шляхів SourceOf (01_28) і готових замін BlockReport (02_66) — корінь проєкту `$.session.root()`, не робочий каталог |
