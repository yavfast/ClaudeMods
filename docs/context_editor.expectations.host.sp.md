# Редактор контексту агента — Specification: Verification: functional expectations — вкладення хоста, можливості, субагенти, старі сесії, структури

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> Частина §05_01 Functional Expectations специфікації [SP_CTX](./context_editor.sp.md): модульні очікування (вкладення хоста, можливості, субагенти, старі сесії, структури). Читати, коли пишете або звіряєте модульні тести цих контрактів.

## Contents

- Частина таблиці [05_01. Functional Expectations](./context_editor.expectations.sp.md#SP_CTX_05_01): рядки контрактів цього модуля

## 05. Verification Criteria — модульні очікування: вкладення хоста, можливості, субагенти, старі сесії, структури

Частина таблиці [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01): контракти [hostattach](./context_editor.hostattach.sp.md), [bypass](./context_editor.bypass.sp.md), [subagents](./context_editor.subagents.sp.md), [cleanup](./context_editor.cleanup.sp.md) і структури §01 (зокрема черга: `parseQueue`). Правила назв тестів і позначок `[тест: …]`, `[live only: …]`, `[not covered: …]` — у [context_editor.expectations.sp.md](./context_editor.expectations.sp.md#SP_CTX_05_01).

| Contract | Scenario | Input | Expected outcome |
|----------|----------|-------|------------------|
| Queue | `resumeSet` у файлі | `resumeSet: "x"` / поля немає | `unreadable` / `ok` з `resumeSet = false` [тест: «parseQueue reads a good file and refuses bad JSON or a field of the wrong type»] |
| ShapeSubagentResult | великий вивід | субагент, Bash, текст 20 000 символів у рядках | архів `<cwd>/.claude/context-editor/<session_id>/subagents/<agentId>/<id>.txt` з повним текстом; блок — голова ≤ SUB_HEAD, рядок «[context-editor: N chars cut; full output: <path>, open with Read]», хвіст ≤ SUB_TAIL; голова + N + хвіст = 20 000 |
| ShapeSubagentResult | малий вивід / основна розмова / Read / OWN_TOOLS / unknown | текст < SUB_CUT_AT, або без `agentId`, або походження Read, `mcp__context-editor__*`, `unknown` | рядок без змін, архіву немає |
| ShapeSubagentResult | масив блоків | `content` — кілька текстових блоків разом ≥ SUB_CUT_AT | текст склеєно через "\n" і обрізано одним рядком; з блоком зображення — без змін |
| Capabilities | вердикти і пріоритет | `cache.compact = passed`; потім `probe.compact = reached`; потім `live.compact = passed` | `passed`; `reached`; `passed` |
| Capabilities | живі вкладення | NoteAttachment раз; окремо — NoteTurn без вкладень; окремо — перерваний хід і хід субагента | `live.attachments = reached`; `passed`; `mainTurns` не змінюється |
| Capabilities | живе суперечить кешу | кеш `attachments = passed`, вкладення дійшло | запис версії в кеші знято, ScheduleProbe раз; новий запис після зонда |
| Capabilities | NoteOwnCompaction / NoteCommandUnseen | обробник побачив MARKER; окремо — команда повернулася, обробник мітки не бачив | `live.compact = reached`; `passed` і запис кешу `source: live` |
| Capabilities | рядок людині один раз | `compact = passed` на кінці двох ходів, у черзі 3 правки; окремо — `attachments = passed` на першому ході, `compact = passed` після зонда | один `$.ui.log` з PassedText, «compaction», «3 queued edit(s) stay»; на другому ході — нічого; окремо — два рядки: «attachment», потім «compaction and attachment» |
| Capabilities | без версії | `$.session.version()` кидає | кеш не читається й не пишеться, зонда немає; вердикти лише живі |
| RunProbe | планування | старт сесії без запису для версії; другий старт у тому самому процесі; запис є | один таймер PROBE_DELAY_MS; другого немає; таймера немає |
| RunProbe | кеш без вердикту зонда | запису немає; запис без `compact`; запис `source: live` з `compact = passed`; запис зонда | зонд; зонд; зонд; без зонда |
| RunProbe | бінарник хоста | `readlink` дав `…/versions/2.1.299`, `/usr/bin/claude`, `/usr/bin/node`, нічого | той самий шлях; той самий; `claude`; `claude` |
| RunProbe | аргументи і вхід | ProbeArgs, ProbeInput, PROBE_ENV | `-p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --model haiku --plugin-dir <root>`; два повідомлення `hi` і `/compact <PROBE_MARKER>`; env з `CONTEXT_EDITOR_PROBE=1` і недосяжною адресою API |
| ParseProbe | результати | `result` «Not compacted · context-editor-probe: {…}» з лічильниками attachments 9; `result` «Not enough messages to compact.» з лічильниками 0; без `result` і файлу; версія лічильників інша | `compact reached, attachments reached`; `compact passed, attachments passed`; none (PROBE_NO_RESULT); none (PROBE_OTHER_HOST) |
| RunProbe | збій і прибирання | `$.process.run` кидає; окремо — успіх | `probe = {}`, кеш не пишеться; тимчасова тека і тека проєкту видаляються в обох випадках |
| RunProbe | очікування дією | Flush при `unknown`, зонд `running`, кінець через 3 с; окремо — зонд довше PROBE_WAIT_MS | Flush іде за вердиктом зонда; після PROBE_WAIT_MS — як `unknown` |
| ProbeMode | лічильники і відповідь | `CONTEXT_EDITOR_PROBE=1`; вкладення, двері, кінець ходу, `session.compact` з PROBE_MARKER | сховища немає; PROBE_FILE з версією й лічильниками; `{ skip: "context-editor-probe: {…}" }`; інструменти `context_*` і `/handoff` не зареєстровані; нових тек у `~/.claude/context-editor` немає |
| CompactBrief | зміст і порядок | рядок `state`, collapse і drop у черзі, `pin` на виклику, дві нотатки | BRIEF_HEAD; стан; «Use this summary for the rows from … to …» з підсумком; «Leave out <CallLabel>.»; «Keep verbatim: …»; нотатки з прев'ю цілей; BRIEF_RECORDS — у цьому порядку |
| CompactBrief | межа | пункти разом > BRIEF_MAX | пункти цілими до межі, далі `(<n> more item(s) left out)`; результат ≤ BRIEF_MAX |
| CompactBrief | ціль без рядка | правка, чиєї цілі немає в рядках | пункт пропущено |
| ObservePassedCompact | оригінали + копії | `after` = `before` + 3 рядки підсумку | межа за трьома рядками; теги рядків, яких немає в копіях, зняті; `lastApply` знято; `introduced` → `reintroduce`; черга порожня |
| ObservePassedCompact | інший порядок | `after` не починається з `before` | межа не пишеться (OBSERVE_NO_PREFIX); теги чистяться за `after`; черга порожня |
| ShapeSubagentResult | помилка запису | запис архіву повертає false | блок без змін |
| ShapeSubagentResult | недопустимий id | `tool_use_id` з `/` або `..` | блок без змін, запису немає |
| ShapeSubagentResult | is_error | результат з `is_error: true`, великий | обрізано, `is_error` лишається |
| ShapeSubagentResult | сховище недоступне / недопустимий `agentId` | великий вивід, папки сховища немає; або `agentId` = `..` | рядок без змін, запису немає |
| ShapeSubagentResult | межі не на кінці рядка | кінець рядка в першій половині вікна голови (i < SUB_HEAD/2) або хвоста (j − t ≥ SUB_TAIL/2) | межа лишається SUB_HEAD / len − SUB_TAIL |
| SweepSessions | сесія без транскрипту | сховище `<id>` з `archives.txt` = `<cwd>/.claude/context-editor/<id>`, транскрипту `<id>.jsonl` немає, не торкались ≥ SWEEP_GRACE_MS | сховище, `<id>.zip`, `<id>.where`, каталог архівів і `<archives>.zip` видалено |
| SweepSessions | транскрипт є / свіжа / поточна | транскрипт є і сесії торкались < PACK_IDLE_MS; або транскрипту немає, але < SWEEP_GRACE_MS; або це поточна сесія | нічого не змінено |
| SweepSessions | давно не відкрита | транскрипт є, не торкались ≥ PACK_IDLE_MS, Packer ≠ NONE | PackSession; без інструмента — нічого |
| SweepSessions | раз на добу, замок | `.sweep` молодша за SWEEP_EVERY_MS; або `.sweep.lock` свіжий | прибирання не йде; завислий замок (≥ SWEEP_LOCK_MS) забирається атомарним перейменуванням |
| SweepSessions | транскрипти не читаються / чужий архів | `<config>/projects` не читається або без жодного транскрипту; `CLAUDE_CONFIG_DIR` задає `<config>`; рядок `archives.txt` — не OwnArchives (відносний, з `..`, чужий id, саме сховище) | жодного видалення / каталог за чужим шляхом не пакується і не видаляється |
| SweepSessions | SWEEP_MAX | дій більше за SWEEP_MAX | виконано SWEEP_MAX, від найстаріших |
| PackSession | успіх | сховище і каталог архівів | `<id>.zip`, `<archives>.zip`, `<id>.where`; каталоги видалено лише після запису й перевірки обох `.zip` |
| PackSession | збій | пакування або перевірка `.zip` падає | `.zip.part` видалено, каталоги як були, false |
| PackSession | залишок і два каталоги | старий `.zip.part` від обірваного пакування; `archives.txt` з двома власними каталогами (два робочі каталоги) | `.zip.part` спершу видалено; обидва каталоги запаковано, `.where` з обома рядками; RestoreSession повертає обидва |
| Packer | вибір і команди | є `zip`+`unzip` / лише `bsdtar` / лише GNU tar | ZIP / BSDTAR / NONE; bsdtar пише з `--format zip`; розпакування без перезапису — `unzip -n` / `tar -k` |
| RestoreSession | запакована | `<id>.zip` є, каталогу немає (і так само для архівів) | розпаковано через `.part` і перейменування; `.zip` і `.where` видалено; шляхи файлів — ті самі, що до пакування |
| RestoreSession | обидва є | і каталог, і `.zip` (обірване пакування або каталог, створений наново після пакування) | `.zip` розпаковано в каталог без перезапису наявних файлів, потім видалено |
| RestoreSession | збій | `.zip` пошкоджено або немає інструмента | PrepareStorage → `{reason: "packed storage cannot be restored"}`; `.zip` лишається |
| RestoreSession | збій каталогу архівів / шлях лише в `.where` | `.zip` каталогу архівів пошкоджено; або після злиття `archives.txt` сховища не називає каталог, який називає `.where` | сховище діє (true), `.zip` і `.where` лишаються до наступної підготовки / каталог за `.where` розпаковано |
| PackSession | `.zip` поруч | біля каталогу сесії вже лежить її `.zip` (злиття ще не відбулось) | не пакується, `.zip` не перезаписано |
| SweepSessions | перехоплений замок | завислий замок, перейменований саме тоді, коли інший процес створив свіжий | перейменований замок повернуто, прибирання не йде |
| RestoreSession | NeedsRestore при `prompt.submit` | стан `{reason: PACKED_REASON}`; або опублікованого каталогу немає; або поруч є його `.zip` | PrepareStorage знову, з RestoreSession; інакше нічого |
| TagRegistry | поле `hint` | `{ tokens: 120 000, marks: 7 }`, `{ marks: 1 }` / `{ tokens: 5 }`, `{ marks: 0 }`, `{ marks: 2, tokens: −1 }`, `{ marks: 1.5 }`, `"x"` | `ok` / `unreadable` [тест: «TagRegistry.hint — розбір»] |
| ArchiveRoot (прив'язка в `register.ts`; перевіряє живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Архів основної розмови в проєкті») | каталог архівів | `$.session.cwd()` = `/p`, сховище `…/S` / каталог `/p/.claude/context-editor` вже є без `.gitignore` / `cwd` недоступний / `mkdir` не вдався | `/p/.claude/context-editor/S`, `.gitignore` із `*` (режим 700/600) / `.gitignore` дописано, наявний не переписується / `<storage>` для основної розмови, результат субагента не обрізається / так само |
| AliasRegistry | межа | MAX_ALIASES + 1 позначок | найстаріший псевдонім видалено [тест: «past MAX_ALIASES marks the oldest alias goes»] |
| ParseAttachment | перша копія | `instructions` з преамбулою, розділи CLAUDE.md і MEMORY.md | `preamble`, шляхи обох розділів; `pre` + заголовки + тіла дають текст дослівно |
| ParseAttachment | копія після компактизації і nested_memory | рамка REREAD_HEAD; `nested_memory` «Contents of <path>:» без опису | без преамбули; один розділ зі шляхом |
| ParseAttachment | невідома рамка | інший текст перед першим розділом; без заголовка; перелік без LISTING_HEAD; тип `deferred_tools_delta` | не зрозуміло (вкладення лишається); перелік з LISTING_HEAD — `listing` |
| AttachmentAnswer | поза обсягом | `*_delta`, копія субагента (`agentId`), невідома рамка; рішення для того самого тексту є | `keep`, каталог порожній; та сама копія основної розмови — `{ text: null }` |
| AttachmentAnswer | файл стану | `hostattach.json` відсутній / unreadable / сховища немає / читання кидає | `keep` |
| PlanAttachments | новіша копія | копії v1 (преамбула, CLAUDE.md і MEMORY.md), перелік, v2, v3 | перша копія: преамбула і MEMORY.md, CLAUDE.md → `Contents of <path>: superseded by a later copy below.`; v2 пропущено; v3 і перелік лишаються; `left` = 2 копії |
| PlanAttachments | диск | v1 збіглася з файлом при першому баченні, на диску v2 / файлу немає / `nested_memory`, файл змінився / v1 не збіглася з файлом | `predicted[path]` = ключ v1, розділ v1 застарілий / рішень немає / рішень немає / рішень немає |
| PlanAttachments | прогноз | після прогнозу: прохід з новою копією v2 / прохід без нової копії | прогноз знято, v1 застаріла за правилом (а) / шлях у `uncomparable`, рішень немає (копія повертається) |
| PlanAttachments | переліки | перелік A, інструкції, перелік B двічі, перелік без заголовка | A пропущено; B — `{ copies: 2, repeat }`: перша копія лишається, друга пропущена; без заголовка лишається; `left` = 2 |
| AttachmentAnswer | нова копія і новий прохід | рішення `{ copies: 2, repeat }`, у серії три копії; потім пауза > PASS_GAP_MS і дві копії без ResetPass; потім ResetPass і дві копії | B, null, B (третя — нова) / B, B (запити понад `copies`) / B, null |
| AttachmentAnswer | повернутий вміст | рішення `{ copies: 1, drop }` для v1; копія v1, потім після паузи ще одна v1 | null / keep (`count` 2 > `copies`) |
| PlanAttachments | інкрементні переліки | повний перелік a,b,c; перелік без назв; перелік лише d; потім перелік a,b,c,d | спершу рішень немає; потім повний і інкрементний пропущено (обидва покрито), без назв лишається |
| FrozenAttachments | рішення ховає поточне | `keep_cache`, старе рішення пропускає найновішу копію v2 / старе рішення ховає лише застарілу v2 при новішій v3 | старе рішення не тримається / тримається |
| VerifyPredictions | перший кінець ходу | прогноз v1, каталог порожній; прохід без нової копії; прохід з v2 | waiting; rolled back — шлях `uncomparable`, рішень немає, `$.ui.invalidate` один раз, каталог порожній; RollbackPredictions — прогноз справдився, рішення першої копії лишається |
| CommitAttachments | ланцюжки | крок фіксації тримає queue → tags → aliases | `onChain` файлу рішень отримує ці ланцюжки (`within`) |
| ClearAttachments | відповіді недійсні | VoidAnswers, рішення `drop` для v2 | v2 лишається; наступний commit — без старих відповідей, `voided` знято |
| ParseAttachment | заголовок у вмісті | `Contents of <abs path> (x):` без порожнього рядка перед ним; заголовок з відносним шляхом | не розділи — один розділ CLAUDE.md |
| CommitAttachments | нове речення | рішення, що різняться лише `copies` / різні рішення | AnswersKey однаковий / різний |
| FrozenAttachments | keep_cache | перша копія в першому повідомленні, префікс — рядок 0; v2 після префікса | перша копія заморожена — рішення немає; v2 — `drop`; без `keep_cache` змінюються обидві; префікс 0 — нічого не заморожено |
| AttachmentAnswer | відновлений процес | рішення записано застосуванням; новий екземпляр модуля (порожня пам'ять) проходить ті самі вкладення | ті самі тексти відповідей, що й у процесі застосування |
| HostAttachState | обмеження | `copies` 0, `drop` не true, `matched` не рядки, `left` від'ємне, не об'єкт; `{ answers: {} }` | unreadable; порожній стан; повний стан читається назад без змін |
| CommitAttachments | файл непридатний | unreadable, перенесення вдалося / не вдалося | файл перенесено, рішення записано з порожнього стану / нічого не записано |
| CommitAttachments | порожній каталог | жодного вкладення з останнього проходу | нічого не записано, рішення в силі |
| ClearAttachments | інша компактизація | компактизація, що стоїть / пропущена; стан з рішеннями | `passed`, потім очищення в каталозі / нічого; `answers`, `predicted`, `left` порожні, `matched` лишається |
| parseQueue | compact | файл без поля; `compact` без `optimize` і `optimizePrompted`; з `optimize`; `compactEndedAt` число / рядок | `compact = false` / `unreadable` / ok; ok / `unreadable` |
| parseQueue | via | правка з `via: "tag"` / з `via: "edit"` | `ok`, `via` збережено / `unreadable`, `bad edit 1` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Рядки §05_01 перенесено дослівно з [context_editor.expectations.sp.md](./context_editor.expectations.sp.md): поділ таблиці за модулями (structural-event) |
