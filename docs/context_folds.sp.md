# Згортки й пам'ять завдань — Specification  {#SP_FOLD}

> **Code:** SP_FOLD
> **Status:** active
> **Created:** 2026-11-14
> **Updated:** 2026-11-16
>
> **Concept:** [C_FOLD](./context_folds.concept.md)
> **Depends on:** [SP_CTX](./context_editor.sp.md) — структури й контракти мода context-editor, які ця специфікація розширює й у названих місцях змінює (§03_03)
> **Used by:** [SP_HELP](./context_helper.sp.md) — помічник мода (draft; змінені розділи — у його §03_03)
> **Plan:** [PL_FOLD](./context_folds.plan.md)
>
> Структури й контракти згорток: облік згорток, розгортання одного рівня власним інструментом мода, повернення згаданого, згортка з повідомленнями людини й обходом закріплених рядків, ланцюжок вкладених областей із завданням, службові вставки в кінці відповіді. Читати тому, хто реалізує чи перевіряє ці механізми в моді context-editor: кожен контракт названо разом із контрактом SP_CTX, на який він лягає.

## Contents

- [01. Data Structures](#SP_FOLD_01) — запис обліку згортки, облік, згадування, ланцюжок областей, сигнал вставки, константи
- [02. Contracts](#SP_FOLD_02) — облік згортки при застосуванні, розгортання, повернення згаданого, згортка зі словами людини й обходом, області, вставки, перелік згорток, передача, власні виклики розгортання
- [03. Validation Rules](#SP_FOLD_03) — перевірки входів, інваріанти між структурами, змінені розділи SP_CTX
- [04. State Transitions](#SP_FOLD_04) — життєвий цикл згадування й області
- [05. Verification Criteria](#SP_FOLD_05) — очікування за контрактами, інваріанти, живі сценарії, граничні випадки
- [06. Reversibility](#SP_FOLD_06) — як вимкнути механізми й що стає нечитним для попередньої версії
- [07. Design Decisions](#SP_FOLD_DEC) — вісім розвилок контрактів

## 01. Data Structures  {#SP_FOLD_01}

> Implements: [C_FOLD_02](./context_folds.concept.md#C_FOLD_02)

Позначення типів — як у SP_CTX: `int`, `string`, `bool`, `T[]`, `T | null`, `?` — необов'язкове поле. `RowMark` — межа «після рядка» з [SP_CTX_01_18](./context_editor.records.sp.md#SP_CTX_01_18). «Службова вставка» далі — «вставка».

### 01_01. FoldEntry  {#SP_FOLD_01_01}

Запис обліку однієї згортки. Створюється для кожної застосованої правки, що лишає запис згортки: стиснення виводу (`summarize`), згортання діапазону (`collapse`), опис медіа (`describe`), зокрема з тегу `disposable`.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | string | yes | — | `FOLD_PREFIX` + номер; унікальний серед записів згорток розмови | Ідентифікатор у записі згортки |
| archive | string | yes | — | абсолютний шлях файла архіву застосування | Де лежить рівень; той самий шлях стоїть у записі згортки |
| entry | int | yes | — | ≥ 0 | Індекс елемента в масиві архіву (`originals` звіту застосування) на мить запису архіву |
| kind | `'output' \| 'range' \| 'media'` | yes | — | — | Що згорнуто |
| call | string | yes | — | одне з: `context_edit summarize call`, `context_edit collapse call`, `context_edit describe call`, `context_tag disposable tag` | Чия дія згорнула, для рядка RECALLED |
| what | string | yes | — | ≤ `MAX_SOURCE` | Походження для рядка RECALLED: для `output` — джерело виводу (`SourceOf`, [SP_CTX_02_62](./context_editor.curation.edits.sp.md#SP_CTX_02_62)); для `range` — `stage "<назва>"` чи `task "<назва>"`, коли `region` є, інакше перелік згорнутого (`CollapsedList`), обрізаний до межі; для `media` — `media of a <роль> row` |
| region | `{ name: string, kind: 'task' \| 'stage' }` | no | відсутнє | лише для `range` | Проміжок згортки на мить постановки в чергу збігся з блоком останньої закритої області (`lastClosed`), що має назву: від її початку до кінця. Значення рахується при постановці й лежить у записі черги до застосування; блок без назви області не дає |
| rows | int | yes | — | ≥ 1 | Скільки рядків у рівні |
| chars | int | yes | — | ≥ 0 | Розмір рівня в символах тексту |
| turn | int | yes | — | лічильник ходів реєстру | Хід, після якого згортку застосовано |
| parent | string | no | відсутнє | `id` іншого FoldEntry | Згортка, у рівні якої лежить запис цієї згортки |

Invariants:
- Запис не змінюється після створення, крім поля `parent`, яке ставиться один раз.
- `parent` вказує на запис пізнішого застосування: його номер більший за номер самого запису й менший за `nextFold`; інакше файл обліку нечитабельний.
- Запис із `region.kind = 'task'` — картка завдання.

### 01_02. FoldLedger  {#SP_FOLD_01_02}

Файл сесії `folds.json` у сховищі сесії (поза текою проєкту), на власному ланцюжку рангу 4 (`CHAIN_RANK`, [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)).

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| folds | FoldEntry[] | yes | `[]` | ≤ `MAX_FOLDS`; найстаріші відкидаються | Облік згорток |
| nextFold | int | yes | 1 | ≥ 1; не зменшується | Наступний номер згортки |
| recalls | Recall[] | yes | `[]` | ≤ `MAX_RECALLS` | Неповернуті згадування |
| questions | Question[] | no | `[]` | ≤ `MAX_QUESTIONS`; `tool_use_id` без повторів; `folds` — 1..`MAX_ASK_FOLDS` різних ідентифікаторів згортки, яких в `folds` може вже не бути; `question` ≤ `QUESTION_HEAD` | Неповернуті питання до архіву ([SP_HELP_01_04](./context_helper.ask.sp.md#SP_HELP_01_04); PL_HELP, фаза 1). Облік без поля (записаний до PL_HELP) читається як `[]`; запис порушує обмеження — файл нечитабельний. RecordFolds, відкидаючи найстаріші згортки, записів питань не чіпає: відповідь лежить у самій парі |

Invariants:
- Відсутній файл читається як порожній облік. Файл, що не розбирається, відкладається вбік правилом Renew ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)), і облік починається порожнім.
- Номер нової згортки ніколи не повторює номер, який уже стоїть у записі згортки в розмові: правило нижньої межі в [02_01](#SP_FOLD_02_01) діє за будь-якого стану обліку (порожній, відкладений, не перенесений передачею, видалений).
- Файл не більший за `MAX_QUEUE_BYTES`.

### 01_03. Recall  {#SP_FOLD_01_03}

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| fold | string | yes | — | `id` наявного FoldEntry | Що згадано |
| from | int | yes | 0 | ≥ 0 | Перший рядок рівня у згаданій частині |
| count | int | yes | — | ≥ 1 | Скільки рядків рівня згадано |
| tool_use_id | string | yes | — | ідентифікатор виклику розгортання | Пара виклику, що несе згадане |
| depth | int | yes | — | ≥ 0; довжина ланцюжка відкритих областей на мить згадування | Глибина області згадування; 0 — жодної відкритої |
| scope | string | yes | — | назва найглибшої відкритої області на мить згадування або порожній рядок | Для тексту RECALLED і RETURNED |
| turn | int | yes | — | — | Хід згадування |
| due | bool | yes | `false` | — | Область закрито; заміна чекає найближчого пакета агента |

### 01_04. OpenRegion і ланцюжок областей  {#SP_FOLD_01_04}

Ланцюжок відкритих областей живе в реєстрі тегів ([SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10)). Поле `stage` лишається й означає найглибшу відкриту область; нове поле `outer` тримає області, що її охоплюють.

OpenRegion — це `Stage` з [SP_CTX_01_18](./context_editor.records.sp.md#SP_CTX_01_18) з одним новим полем:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| name | string | yes | — | 1..`MAX_STAGE_NAME` | Назва області |
| after | RowMark \| null | yes | — | — | Межа початку |
| openedTurn | int | yes | — | — | Хід відкриття |
| kind | `'task' \| 'stage'` | no | `'stage'` | — | Завдання чи етап |

Нове поле реєстру тегів:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| outer | OpenRegion[] | no | `[]` | ≤ `MAX_DEPTH` − 1; від зовнішньої до внутрішньої | Області, що охоплюють `stage` |

`ClosedBlock` (`lastClosed`) отримує необов'язкове поле `kind` з тим самим значенням.

Invariants:
- Завдання в ланцюжку щонайбільше одне, і воно зовнішнє: `kind = 'task'` можливе лише в `outer[0]` або в `stage` при порожньому `outer`.
- Межі вкладені: початок кожної внутрішньої області не раніший за початок зовнішньої.
- **Нормалізація при читанні.** `outer` без `stage` відкидається, а не робить реєстр нечитним: попередня версія мода, закривши етап, лишає невідоме їй поле `outer` на місці. Елемент `outer` з `kind = 'task'` не на першому місці читається як `'stage'`.
- Реєстр без `outer` і без `kind` читається як ланцюжок з однієї області чи порожній.

### 01_05. TrailerSignal  {#SP_FOLD_01_05}

Сигнал вставки, розібраний із фінальної відповіді ходу.

| Variant | Fields | Meaning |
|---------|--------|---------|
| optimize | — | Закрити найглибшу відкриту область; блок чекає згортання ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)) |
| close | — | Закрити найглибшу відкриту область; блок не чекає |
| note | text: string, 1..`MAX_NOTE` | Нотатка до рядка фінальної відповіді |

### 01_06. Constants  {#SP_FOLD_01_06}

| Name | Value | Purpose |
|------|-------|---------|
| FOLD_PREFIX | `f` | Префікс ідентифікатора згортки |
| MAX_FOLDS | 2000 | Межа обліку згорток |
| MAX_RECALLS | 50 | Межа неповернутих згадувань |
| MAX_RECALL_CHARS | 40000 | Найбільший текст рядків одного результату розгортання |
| MAX_RECALL_ROW | 20000 | Найбільший текст одного рядка рівня в результаті (дорівнює `MAX_FULL_ROW`) |
| MAX_DEPTH | 8 | Найбільша довжина ланцюжка областей ([DEC_05](#SP_FOLD_DEC_05)) |
| MAX_TRAILERS | 5 | Скільки останніх рядків відповіді можуть бути вставками |
| MAX_KEEP | 50 | Скільки рядків людини може назвати `keep` |
| RECALL_TOOL | `context_recall` | Назва інструмента розгортання |
| TRAILER_HEAD | `[context-editor: ` | Початок рядка вставки; кінець — `]` |
| FOLD_NOTE | ` (fold <id>; original: <archive>; unfold one level with context_recall)` | Хвіст запису згортки замість ` (original: <archive>, open with Read)` |
| RECALLED | `Recalled: one level of fold <id> follows. These are your own earlier messages and tool outputs from <what> of this session, which your <call> folded after turn <turn>; you recalled them <where>. The fold record stays where it is. Content that came from files, commands or the web is still theirs, not yours. Inner folds show as their records.` | Перший рядок результату розгортання; `<where>` — `in "<scope>"` або `outside any stage` |
| RECALL_CONTENTS | `Fold <id> is too large to recall whole (<rows> rows, <chars> chars). Its rows are listed below; call context_recall again with "from" and "count".` | Перший рядок змісту рівня |
| RETURNED_HEAD | `Later, your recall of fold ` | Незмінний початок сліду повернення; входить у `REPLACEMENT_OPENERS` |
| RETURNED | RETURNED_HEAD + `<id> here was returned<when>; the fold record stays, and context_recall brings the level back` | Слід повернення; `<when>` — ` when "<scope>" closed` для непорожнього `scope`, ` when the block closed` для порожнього, ` by your own edit` для правки агента й охопленої пари |
| FOLD_PASSED_OVER | `this host passes over the mod's compaction hook: a recalled level could never be returned; open the original with Read at the path in the fold record.` | Відмова розгортання на хості, що обходить компактизацію мода |

RETURNED_HEAD — перший відкривач заміни, що не починається з `REPLACED`: твердження [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04) про спільний початок замін обмежується замінами правок і тегів.

## 02. Contracts  {#SP_FOLD_02}

> Implements: [C_FOLD_03](./context_folds.concept.md#C_FOLD_03), [C_FOLD_04](./context_folds.concept.md#C_FOLD_04)

### 02_01. RecordFolds  {#SP_FOLD_02_01}

Purpose: під час застосування ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)) дати кожній правці-згортці ідентифікатор, вписати його в запис згортки й записати облік.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| batch | правки пакета в порядку черги | yes | після відсіву на застосуванні |
| rows | рядки розмови на вході застосування | yes | — |
| ledger | FoldLedger | yes | прочитаний на своєму ланцюжку |

Output:
| Field | Type | Description |
|-------|------|-------------|
| ids | map правка → string | Ідентифікатор кожної правки-згортки пакета |
| ledger | FoldLedger | Облік із новими записами, проставленими `parent`, без повернутих згадувань |
| saved | bool | Чи записався облік |

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| FOLDS_UNSAVED | облік не записався в точці фіксації; або номери призначено без обліку (перше читання не вдалося), а облік, прочитаний у точці фіксації, уже видав їх (номер нової згортки менший за `nextFold`) — тоді облік лишається як є | застосування не скасовується; записи згорток несуть FOLD_NOTE; звіт застосування отримує речення `The fold ledger could not be saved: context_recall will not know these folds; their originals are at the paths in the records.`; у журнал налагодження — один рядок з міткою й помилкою (правило ERR-01, [errors.md](../.dev_flow/rules/errors.md)) |

Processing logic (pseudocode):

    FUNCTION AssignFoldIds(batch, rows, ledger):                    # before the replacement rows are built
        floor = 1 + largest fold number named by a FOLD_NOTE in rows, or 1
        next = max(ledger.nextFold, floor)
        FOR EACH edit IN batch, in queue order, WHERE edit leaves a fold record:   # summarize, collapse, describe; not drop, rewrite, state, return
            ids[edit] = FOLD_PREFIX + next; next += 1                # an edit that later fails keeps its number: numbers may have gaps
        RETURN ids, next

    FUNCTION RecordFolds(report, ids, next, ledger, archivePath, turn):   # after the apply ran
        FOR EACH applied edit WITH an id:
            inner = fold ids named by FOLD_NOTE in those replaced rows that are fold records (replacement texts)
            # the record's own note only: the text starts with a summarize, collapse or describe opener and the note
            # stands right after the opener's closing words ("with your own summary|note|description");
            # a note quoted in the source, the list or the agent's words is not counted
            FOR EACH f IN inner WHERE f in ledger.folds AND f.parent absent: f.parent = ids[edit]
            ledger.folds += { id: ids[edit], archive: archivePath,
                              entry: index of this edit's element in report.originals,
                              kind, call, what, region?, rows, chars, turn }
        ledger.nextFold = next
        trim ledger.folds to MAX_FOLDS, oldest first; drop recalls whose fold is gone
        RETURN ledger

Порядок: ідентифікатори призначаються до побудови рядків заміни, бо текст запису несе `id`. Облік пишеться в точці фіксації застосування, після останньої перевірки переривання (правило CONC-02, [concurrency.md](../.dev_flow/rules/concurrency.md)), разом із реєстрами; перерване застосування чи збій запису черги повертає облік таким, яким його прочитано, як реєстри. `entry` рахується за масивом `originals` на мить запису архіву: у ньому стоять елементи всіх застосованих правок у порядку виконання, зокрема тих, що згортками не є.

### 02_02. Recall (інструмент `context_recall`)  {#SP_FOLD_02_02}

Purpose: розгорнути один рівень згортки в кінець контексту результатом інструмента мода.

Input:
| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| fold | string | yes | — | `id` з запису згортки |
| from | int | no | 0 | ≥ 0; номер рядка рівня, з якого почати |
| count | int | no | до кінця рівня | ≥ 1; скільки рядків рівня віддати |

Output — текст результату:
| Part | Description |
|------|-------------|
| перший рядок | RECALLED; для змісту рівня — RECALL_CONTENTS |
| рядки рівня | для кожного рядка: `#<номер у рівні> <роль>:` і текст; для виклику — назва інструмента й джерело (`SourceOf`); для результату — його текст. Запис вкладеної згортки й позначки архівованих медіа (`[media archived: <шляхи>]`) виходять як лежать в архіві. Текст рядка, довший за MAX_RECALL_ROW, обрізається з приміткою `[row cut at <n> chars; the whole row is in the archive]` |
| зміст рівня | замість рядків, коли частина за замовчуванням (увесь рівень, після обрізання рядків) більша за MAX_RECALL_CHARS і ні `from`, ні `count` не задано: номер, роль, розмір і перші 80 символів кожного рядка |

Errors (відмова з текстом), у порядку перевірки:
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT | виклик із субагента | розгортається лише основна розмова |
| FOLD_PASSED_OVER | хост обходить компактизацію мода | текст FOLD_PASSED_OVER |
| FOLD_REQUIRED | `fold` відсутнє чи не рядок | назвати ідентифікатор із запису згортки |
| BAD_PART | `from` чи `count` не цілі в межах | — |
| DENIED_STORAGE | сховище сесії не готове | чинний текст відмови сховища |
| FOLD_UNKNOWN | в обліку немає такого `id` | оригінал читається за шляхом із запису згортки |
| ALREADY_RECALLED | є неповернуте згадування тієї самої згортки, частина якого перетинається з названою | назвати рядки вже згаданої частини; нічого не дописувати |
| RECALLS_FULL | неповернутих згадувань уже MAX_RECALLS | закрити область або згорнути згадане |
| ARCHIVE_UNREADABLE | архів не читається, не розбирається чи не має елемента `entry` | запис згортки лишається чинним описом |
| BAD_PART | `from` ≥ числа рядків рівня | взяти номери зі змісту рівня |
| PART_TOO_BIG | названа частина більша за MAX_RECALL_CHARS, а `from` чи `count` задано | звузити `count` |

Processing logic (pseudocode):

    FUNCTION Recall(fold, from = 0, count?):
        check DENIED_SUBAGENT, FOLD_PASSED_OVER, FOLD_REQUIRED, BAD_PART (types), DENIED_STORAGE
        ON the ledger chain:
            PruneRecalls(ledger, rows)                               # drop records whose pair is not in the conversation
            entry = ledger.folds[fold] ELSE deny FOLD_UNKNOWN
            IF a recall of this fold overlaps [from, from+count): deny ALREADY_RECALLED
            IF length(ledger.recalls) >= MAX_RECALLS: deny RECALLS_FULL
            level = parse(read entry.archive)[entry.entry] ELSE deny ARCHIVE_UNREADABLE
            IF from >= rows(level): deny BAD_PART
            part = level.rows[from .. from+count)
            IF chars(part) > MAX_RECALL_CHARS:                       # measured after the per-row cut
                IF from or count was given: deny PART_TOO_BIG
                RETURN RECALL_CONTENTS + table of contents of level  # not a recall: no record is written
            ledger.recalls += { fold, from, count: rows(part), tool_use_id, depth, scope, turn, due: false }
            RETURN RECALLED + render(part)

Розгортання не ставить правок у чергу й не запускає застосування. `depth` і `scope` беруться з ланцюжка областей реєстру на мить виклику. `PruneRecalls` прибирає записи, пари яких у розмові вже немає (після чужої компактизації, передачі, відновлення сесії). Запис виклику поточного ходу Recall не чистить: рядок цього виклику може ще не бути записаним у розмову (паралельні виклики однієї відповіді). Ідентифікатори таких викликів тримає пам'ять процесу до початку наступного ходу, тож запис перерваного ходу, пара якого рядком так і не стала, зникає з наступним ходом. Рядок `fold`, що не має форми ідентифікатора, дає FOLD_UNKNOWN. Архів читається через процес (`cat`): читання сховища обмежене розміром.

### 02_03. ReturnRecalled  {#SP_FOLD_02_03}

Purpose: замінити згадане слідом RETURNED після закриття області, у якій його згадали, не запускаючи власного застосування ([C_FOLD_DEC_08](./context_folds.concept.md#C_FOLD_DEC_08)).

Внутрішня правка повернення — запис черги такого вигляду:
| Field | Type | Value |
|-------|------|-------|
| op | string | `summarize` |
| tool_use_id | string | пара розгортання |
| summary | string | порожній рядок або текст агента; порожнє значення чинне лише разом із `via: 'return'`, для решти правок `summarize` лишається правило непорожнього тексту |
| via | string | `return` — третє значення поруч із `edit` і `tag` |

Її мітка у звітах — `return of fold <id>`. У числі правок рядка для людини ([SP_CTX_02_43](./context_editor.stages.sp.md#SP_CTX_02_43)) вона не рахується; звіт застосування агентові називає повернення окремим реченням `Returned <n> recall(s): <ids>.`

**Пари питань (PL_HELP, фаза 1; [SP_HELP_02_05](./context_helper.ask.sp.md#SP_HELP_02_05)).** Записи `questions` обліку живуть за тим самим механізмом: MarkDue позначає їх за тим самим правилом глибини, AddReturns бере записи `Returnables(ledger)` — спершу згадування, потім питання, кожні від найстаріших, — і ставить правку повернення того самого вигляду над парою питання; `summarize` чи тег `disposable` агента на такій парі — її повернення словами агента, `drop` прибирає пару разом із записом. Слід — ASK_RETURNED замість RETURNED, мітка — `return of the question to fold(s) <ids>`, речення звіту — `Returned <n> question pair(s).`; рядок людини пакета лише з повернень — `returned <n> recall(s) and <m> question pair(s)`. Речення результату `context_edit` про повернення в пакеті: `<n> recalled level(s) or question pair(s) of closed stages return with this batch: each becomes a one-line trace, and the fold records stay.` Прибирання записів у точці фіксації — те саме правило (PruneRecalls прибирає й записи питань).

Contracts:

**MarkDue** — Input: довжина ланцюжка після закриття `after`. Effect: кожне згадування з `depth` > `after` отримує `due = true`; згадування з `depth = 0` стає належним при закритті будь-якої області, а також коли вставка `optimize` закриває блок без області (як мітка сьогодні). Викликається з кожного закриття ([02_05](#SP_FOLD_02_05), [02_06](#SP_FOLD_02_06)).

**AddReturns** — Input: черга після того, як прийнято хоча б одну правку агента (`context_edit`) або в чергу стали заміни з тегів `disposable` ([SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)); рядки розмови; облік. Output: черга з доданими правками повернення.

    FUNCTION AddReturns(queue, rows, ledger):
        PruneRecalls(ledger, rows)
        FOR EACH recall WHERE due, oldest first:
            IF the queue already holds an edit whose target is this pair, or whose span covers it: CONTINUE
            IF length(queue) >= MAX_QUEUE_EDITS: BREAK                   # the rest stay due for the next batch
            queue += { op: 'summarize', tool_use_id: recall.tool_use_id, summary: '', via: 'return' }
        RETURN queue

Пара розгортання з тегом `pin` пропускається й лишається належною. Коли в чергу пізніше стає правка, що охоплює пару або має її ціллю, — з виклику `context_edit` чи із заміни з тегу `disposable`, — правка повернення цієї пари з черги зникає.

**Правка агента над парою розгортання.** Пару розгортання агент називає за `tool_use_id`: псевдонімів власні виклики мода не мають. `summarize` пари, для якої є запис згадування, стає правкою повернення з `summary` агента: так агент дописує, що взяв зі згаданого. Тег `disposable` на такій парі дає те саме з нотаткою тегу. `drop` такої пари прибирає її без сліду й без архіву. Усі три прибирають запис згадування в точці фіксації, незалежно від `due`. Пара розгортання без запису згадування (відмова, зміст рівня) правкою повернення не стає: її прибирає звичайне правило власних викликів.

**Виконання на застосуванні.** Правка повернення замінює текст результату пари на RETURNED; до непорожнього `summary` додається `: <summary>`. Виклик лишається; пара отримує новий ідентифікатор, як будь-яка змінена пара. В архів і в `originals` нічого не йде: рівень уже лежить в архіві своєї згортки. FoldEntry для неї не створюється. Нотатки на парі переходять на рядок сліду за чинним правилом ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)). Якщо пари в розмові немає, правка мовчки не застосовується й до невдалих у звіті не потрапляє.

**Проміжок охопив пару.** Коли згортання діапазону охоплює пару розгортання, в елементі архіву цього згортання текст результату пари замінено на RETURNED з `<when>` = ` by your own edit`; запис згадування зникає в точці фіксації.

**Заморожений префікс.** Правки повернення беруть участь у межі замороженого префікса (`keep_cache`) як будь-які правки пакета: префікс закінчується перед найранішою з них.

**Прибирання записів.** У точці фіксації застосування з `recalls` зникають записи повернутих, охоплених і прибраних пар. Правило одне: запис лишається, доки його пара є серед рядків, які повертає обробник (повернута пара отримує новий ідентифікатор, тож її запис зникає за тим самим правилом).

Errors: для агента відмов немає.

### 02_04. Згортка зі словами людини й обхід закріплених рядків  {#SP_FOLD_02_04}

Purpose: змінити перевірки згортання діапазону й стиснення виводу ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58)) за рішеннями [C_FOLD_DEC_10](./context_folds.concept.md#C_FOLD_DEC_10) і [C_FOLD_DEC_13](./context_folds.concept.md#C_FOLD_DEC_13).

Нове поле правки `collapse`:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| keep | int[] | no | ≤ MAX_KEEP; індекси рядків усередині `from_index..to_index`; кожен — рядок людини (PersonRow, [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58)) |

Правила:
- **Слова людини.** `collapse` бере рядки людини свого проміжку, крім названих у `keep`. `summarize` бере пару відповіді людини на питання агента. Відмова PERSON_WORDS для цих двох операцій зникає; повторна перевірка на застосуванні (PERSON_WORDS_NOW) для них теж. Тег `disposable` на таких цілях дозволено: PERSON_TAG для нього зникає. `drop`, `rewrite` і `describe` тримають чинні правила.
- **Виняток: доставлене посеред ходу.** Проміжок, у якому за результатом інструмента стоїть повідомлення людини, доставлене хостом посеред ходу й не подане окремим рядком (PersonDelivered), відхиляється чинною відмовою PERSON_WORDS: таке повідомлення не має рядка, його не можна ні назвати в `keep`, ні покласти в архів. `summarize` пари з такою доставкою працює, як сьогодні: доставка лишається за результатом.
- **Роль запису.** Запис згортки діапазону ніколи не є рядком ролі людини. Якщо в згорнутому є виклик чужого інструмента, запис — пара-носій, як сьогодні; інакше — один текстовий рядок асистента, хоч би з якого рядка починався проміжок.
- **Обхід.** У проміжку `collapse` не згортаються й не дають відмови: рядок із тегом `pin`; рядок, що несе хоч один виклик чи результат із тегом `pin`, разом із парним йому рядком — цілими рядками; рядок слота стану; рядки з `keep`.
- **Місце запису.** Запис згортки стає на місце першого згорнутого рядка. Обійдені рядки перед ним лишаються перед ним, решта обійдених — одразу після нього, усі в початковому порядку.
- **Початок розмови.** Якщо перший згорнутий рядок — перший рядок розмови, правка відхиляється з HEAD_ROW: розмова не починається рядком асистента. Агент називає перший рядок у `keep` або починає проміжок після нього. Відмови PINNED і STATE_SLOT лишаються для правки, чия ціль — саме такий рядок чи пара. Діапазонний тег `disposable` з таким рядком усередині дозволено так само (чинна відмова BAD_RANGE за пін чи слот зникає).
- **Що означає «не змінюються».** Обійдені рядки зберігають текст, виклики й результати. Маркер хоста й thinking-блоки вони можуть втратити на тих самих умовах, що й будь-який рядок перебудованого проміжку ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)).
- **Цілісність пар.** Якщо обхід лишив би виклик без результату чи результат без виклику серед згорнутого, правка відхиляється з KEEP_SPLITS_PAIR.
- **Порожня згортка.** Якщо після обходу згортати нічого, правка відхиляється з NOTHING_TO_FOLD.
- **Якорі `keep`.** Кожен індекс `keep` отримує якір у мить постановки в чергу, як межі проміжку. На застосуванні рядок шукається за якорем; якщо його не знайдено або він уже не рядок людини, правка не застосовується з причиною `a kept row is no longer there`.
- **Медіа в промпті.** Чинна невдача застосування для проміжку з медіа промпту, які не можна архівувати, лишається: такий промпт агент називає в `keep` або спершу описує операцією `describe`.
- **Перелік у записі.** Список згорнутого (`CollapsedList`) називає кількість згорнутих повідомлень людини, як сьогодні.
- **Тексти для агента.** Порада звіту закриття, вступ сесії, навичка мода й описи інструментів більше не кажуть, що правки над повідомленнями людини відхиляються; вони кажуть правило цього розділу.

Errors (додаються до чинних):
| Code | Condition | Guidance |
|------|-----------|----------|
| BAD_KEEP | `keep` не масив цілих; індекс поза проміжком; рядок не є рядком людини; більше MAX_KEEP | назвати рядки людини з перегляду |
| KEEP_SPLITS_PAIR | обхід розриває пару виклику | розділити проміжок або зняти пін |
| NOTHING_TO_FOLD | у проміжку лишилися тільки обійдені рядки | звузити проміжок |
| HEAD_ROW | перший згорнутий рядок — перший рядок розмови | назвати його в `keep` або почати проміжок після нього |

Processing logic (pseudocode):

    FUNCTION FoldSpan(rows, from, to, keep, pins, slot):
        kept = rows in from..to that are pinned, or carry a pinned call or result (with their pair rows), or are the state slot, or are in keep
        folded = rows in from..to not in kept
        IF folded is empty: reject NOTHING_TO_FOLD
        IF a tool call and its result fall on different sides, or both are kept and the record would stand between them: reject KEEP_SPLITS_PAIR
        IF the first folded row is row 0 of the conversation: reject HEAD_ROW
        archive element = folded rows, in order
        record = carrier pair IF folded holds a foreign tool call ELSE one assistant text row
        result = kept rows before the first folded row + [record] + the other kept rows, in original order

Порядок перевірок у підготовці правки: форма (зокрема форма `keep`) → свіжість індексів (`STALE_INDEXES`) → `keep` (BAD_KEEP) → ціль → обхід (NOTHING_TO_FOLD, KEEP_SPLITS_PAIR, HEAD_ROW — у цьому порядку) → PersonDelivered.

Примітки реалізації (фаза 3):
- **(a) Пара по обидва боки запису.** KEEP_SPLITS_PAIR дається й тоді, коли обидва рядки пари обійдено, але рядок виклику стоїть перед першим згорнутим рядком, а рядок результату — після нього: запис став би між викликом і його результатом.
- **(b) Порядок усередині обходу.** NOTHING_TO_FOLD, потім KEEP_SPLITS_PAIR, потім HEAD_ROW (`foldSpan` у `hooks/edits.ts`).
- **(c) Крок на обійденому рядку в тому самому пакеті.** Правка, чия ціль — рядок, який згортання обходить (`rewrite` рядка слота стану, операція `state`, `describe` залишеного промпту), застосовується перед цим згортанням, і воно несе рядок таким, яким його лишив той крок. До цієї фази така пара правок давала невдачу `overlaps another edit`. Два згортання спільного проміжку не мають і далі ([SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)).
- **(d) Тимчасове поле `kept`.** Застосоване згортання після ApplyEdits несе поле `kept` — індекси рядків, які воно лишило, на вхідних рядках застосування; у чергу поле не пишеться. За ним RebindTags, нотатки, псевдоніми, журнал ефекту й межі етапів читають ці рядки як незачеплені: `touchedBy` їх не називає ([SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03), [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07), [SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)).
- **(e) Перевірки медіа — лише над згорнутими рядками.** Перевірки вікна API, медіа промптів, які не можна архівувати, і заархівованих медіа, як і самі медіа, що йдуть в архів, стосуються лише згорнутих рядків. Текст невдачі для медіа промпту: `span may hold prompt media that cannot be archived; describe that media first, or name its prompt rows that have text in "keep"` (промпт із самих медіа не є рядком людини, і `keep` його не бере).
- **(f) Обхід закріпленої пари замкнено по парах.** Рядок із закріпленим викликом чи результатом лишається цілим разом з усіма рядками, що несуть другу половину будь-якої пари цього рядка, і так далі до нерухомої точки: рядок викликів, зібраний із паралельних викликів, має результати в кількох рядках, і всі вони лишаються. Рядок, закріплений за індексом, рядок слота стану й рядки `keep` по парах не замикаються: для них розрив пари дає KEEP_SPLITS_PAIR.
- **(g) Передача сесії.** BuildSeed повертає пакет, у якому застосоване згортання теж несе `kept` (індекси на видимих рядках), тож CarryRegistries переносить теги, нотатки й псевдоніми обійдених рядків у нову сесію ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)).
- **(h) Тег діапазону.** Відмови обходу для тегу `disposable` на діапазон ідуть без поради про `keep`, якого тег не має (`rangeRefusal` у `hooks/tags.ts`); оцінка звільненого для замін із тегів рахує лише згорнуті рядки.
- **(i) Живий зонд початку розмови (2026-11-14, хост 2.1.325, stream-json).** З вимкненою відмовою HEAD_ROW згортання від рядка 0 дало розмову, що починається парою-носієм; хост прийняв її, два наступні ходи пройшли без помилок API. Варіант із текстовим записом асистента на початку не перевірено. Відмова HEAD_ROW лишається до окремого рішення.

Піни й слот стану для обходу на застосуванні дає ScreenPinned: він більше не відхиляє `collapse` і повертає закріплені цілі, які HandleCompaction і BuildSeed передають в ApplyEdits (`pinned`), де FoldSpan рахується наново на рядках застосування ([SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)). Тексти відмов слів людини й PERSON_WORDS_NOW — у [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58).

### 02_05. Області: відкриття й закриття  {#SP_FOLD_02_05}

Purpose: розширити операції `open` і `close` інструмента тегування ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) до ланцюжка областей.

Input (зміни):
| Op | Field | Type | Required | Constraints |
|----|-------|------|----------|-------------|
| open | stage | string | одне з `stage`, `task` | 1..MAX_STAGE_NAME |
| open | task | string | одне з `stage`, `task` | 1..MAX_STAGE_NAME |
| open | nested | bool | no | лише разом зі `stage` |
| open | index | int | no | як сьогодні |
| close | task | bool | no | `true` — закрити ланцюжок разом із завданням |

Поведінка:
| Запит | Що закривається | Що відкривається |
|-------|-----------------|------------------|
| `open` + `task` | увесь ланцюжок | завдання, єдина область ланцюжка |
| `open` + `stage` | найглибша область, якщо вона етап | етап на тому самому рівні (усередині завдання, якщо воно відкрите) |
| `open` + `stage` + `nested` | нічого | етап усередині найглибшої області; при порожньому ланцюжку — як без `nested` |
| `close` | найглибша область | — |
| `close` + `task` | увесь ланцюжок | — |

Output: чинний звіт закриття (`BlockReport`) для блоку, що записується в `lastClosed`; рядок відкриття називає охопну область: `Stage "<name>" opened inside "<parent>"; its block starts at #<n>.` або `Task "<name>" opened; its block starts at #<n>.`

`lastClosed` після запиту, що закрив кілька областей, — зовнішня з них: блок від її початку до поточного кінця розмови, з її назвою й `kind`.

Errors (додаються до чинних):
| Code | Condition | Guidance |
|------|-----------|----------|
| STAGE_FIELDS | `open` має і `stage`, і `task`, або `nested` без `stage`; `close` має поле, крім `op` і `task` | одна назва на запит |
| DEPTH_FULL | ланцюжок уже має MAX_DEPTH областей | закрити область |
| NO_TASK | `close` + `task`, а завдання не відкрите | закрити найглибшу область звичайним `close` |
| REGION_BOUNDS | область, що відкривається всередині охопної (вкладений етап або етап у завданні), починається раніше за охопну (`index` чи рядок виклику) | почати з першого рядка охопної або пізніше; інваріант меж [01_04](#SP_FOLD_01_04) (додано на реалізації фази 5) |

Кожне закриття викликає MarkDue ([02_03](#SP_FOLD_02_03)). Правила блоку, що чекає, і постановки замін із тегів `disposable` не змінюються.

Примітки реалізації (фаза 5, 2026-11-15): (a) `close` з `task: false` — звичайний `close`; (b) звіт закриття завдання після поради STAGE_ADVICE несе абзац TASK_CARD: картка завдання — мета, зроблене (коміти, змінені файли), факти й знання на потім з джерелом, мінливе значення (налаштування, версія, число у файлі) — знімком «as read in <file> at turn N; check before use», вказівки постійні й лише для цього завдання з позначкою, відкриті питання (вхід фази 4: застаріла відповідь з картки, [C_FOLD_DEC_14](./context_folds.concept.md#C_FOLD_DEC_14)); той самий абзац несе порада WaitingAdvice, коли вставка `optimize` закрила завдання і блок чекає стискання (фаза 6, живий прогін); (c) друга мітка (вставка `optimize`) при блоці, що чекає, лишає відкритою область, яка цей блок охоплює (початок не пізніший за початок блоку), і подовжує блок, що чекає, з його назвою й `kind`; область, відкрита після початку блоку, закривається, і блоки зливаються без назви, як раніше; (d) `close`, що в тому самому виклику йде після відхиленого `open` (без прийнятого `open` між ними), відхиляється з OPEN_REFUSED: інакше шаблон «`open` з `index` + `close`» для блоку, що почався раніше за завдання, закрив би саме завдання (рев'ю фази 5); (e) загублений початок внутрішньої області діє як початок охопної, а не голова (ChainStarts; NormalizeLost пише на його місце межу охопної): межі лишаються вкладеними; (f) `close` + `task` при порожньому ланцюжку — NO_STAGE, як і `close`.

Межі завдання від запиту (verify PL_FOLD, рішення розробника 2026-11-15: «Межі від запиту», уточнене «Перед промптом, якщо хід ще не працював»): завдання — один запит людини, тож його межі йдуть за запитом. TurnPrompt — останній PromptRow перед рядком виклику зі словами людини (PersonText [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)) або без тексту (лише медіа): промпт продовження мода, рядки його `/compact` і сповіщення хоста запитом не є, тож межі не зсуваються через застосування правок між запитом і викликом. TurnWorked — між запитом і рядком виклику є рядок з викликом, крім інструментів мода. Підлога — рядок після кінця `lastClosed` (закритого цим викликом або раніше): жодна нова межа не стає за нею, тож нове завдання не починається всередині закритого блоку, а завдання не закінчується раніше за вже закритий вкладений у нього етап.
| Запит | Межа |
|-------|------|
| `open` + `task` без `index`, хід ще не працював (не TurnWorked) або нічого не відкрито | блок завдання починається із запиту (коли запит — рядок #0, з рядка після нього: HEAD_ROW); ланцюжок, який він закриває, закінчується перед запитом, якщо почався раніше за запит |
| `open` + `task` без `index`, відкрита область і хід уже працював; ланцюжок почався після запиту; запиту немає; запит за підлогою; блок почався б із голови | як раніше: блок завдання починається з рядка виклику, закритий ланцюжок закінчується перед ним (робота ходу належить відкритій області) |
| `close` (з `task` чи найглибшої області-завдання), завдання почалося раніше за запит, хід ще не працював, підлога не за запитом | блок завдання закінчується перед запитом: запит належить тому, що йде далі |
| те саме, хід уже працював або закритий блок сягає за запит | перед рядком виклику, як раніше: робота ходу належить завданню |
| `open` з `index` | блок починається з цього рядка, як раніше; `close` того самого виклику йде за правилом `close` (шаблон «`open` з `index` + `close`» для завдання закінчується перед запитом) |
| етапи, вставки `optimize` і `close` у кінці відповіді | як раніше |

Тому `open` + `task` і пара `close` + `task`, `open` + `task` в одному виклику дають ті самі межі. Наступний запит, з яким агент спершу закриває завдання або відкриває наступне, не потрапляє в картку старого; завдання, яке агент дороблює в пізнішому ході (людина пише «Продовжуй») і закриває чи змінює наступним після роботи, лишає цю роботу у своєму блоці. Якщо агент почав працювати над новим запитом, не закривши старе завдання, запит лишається в старому блоці; навичка каже закривати завдання або відкривати наступне перед іншими викликами ходу. Рев'ю з чистим контекстом знайшло перекриття через виклики одного ходу, `open` + `task` у ході, що працював, промпти мода як запит і завдання, що закінчувалось раніше за свій закритий етап, — усі виправлено.

### 02_06. ParseTrailers і виконання вставок  {#SP_FOLD_02_06}

Purpose: замінити правило останнього рядка мітки оптимізації ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)) розбором кількох вставок.

Input: `answer: string` — текст фінальної відповіді ходу. Output: `TrailerSignal[]` у порядку рядків і перелік нерозпізнаних рядків.

Processing logic (pseudocode):

    FUNCTION ParseTrailers(answer):
        lines = non-empty lines of answer, trimmed
        tail = longest run of trailing lines, each starting with TRAILER_HEAD and ending with "]", at most MAX_TRAILERS
        FOR EACH line IN tail, top to bottom:
            body = text between TRAILER_HEAD and the closing "]"
            "optimize"           -> optimize
            "close"              -> close
            "note " + text       -> note(text) when 1 <= length(text) <= MAX_NOTE
            otherwise            -> unknown(line)
        RETURN signals, unknown

Якщо підряд іде більше MAX_TRAILERS таких рядків, беруться останні MAX_TRAILERS; раніші не є ні сигналами, ні нерозпізнаними.

Виконання наприкінці ходу, на місці кроку DetectOptimize, у порядку рядків:
- `optimize` — чинна поведінка мітки над найглибшою відкритою областю. Якщо серед сигналів є `optimize`, сигнали `close` тієї самої відповіді не виконуються.
- `close` — закрити найглибшу відкриту область без очікування згортання; кожен сигнал `close` закриває одну область; без відкритої області нічого не робить. Заміни з тегів `disposable` у чергу не ставить: застосування має запросити агент.
- `note` — додати нотатку до рядка фінальної відповіді ([SP_CTX_02_32](./context_editor.stages.sp.md#SP_CTX_02_32)). Будь-яка відмова нотатки (повний реєстр, сховище, рядок не знайдено) дає рядок стану людині `context-editor: trailer note not saved: <причина>`.
- Нерозпізнаний рядок — рядок стану людині `context-editor: trailer ignored: <рядок>`; решта сигналів виконується.
- Перерваний хід і хід оптимізації після `/compact` людини вставок не виконують, як сьогодні для мітки.
- Жоден сигнал не ставить правок у чергу й не запускає застосування.
- **Хост, що обходить компактизацію мода.** `close` і `note` виконуються, бо змінюють лише метаінформацію. `optimize` поводиться, як мітка сьогодні на такому хості.

Сумісність: відповідь, останній непорожній рядок якої — `[context-editor: optimize]`, дає той самий результат, що й сьогодні.

Примітки реалізації (фаза 6, 2026-11-15; `hooks/trailers.ts`, DetectOptimize у `hooks/stages.ts`): (a) рядок відповіді для `note` — останній рядок асистента після останнього промпту, текст якого містить останній рядок вставки; без нього — `trailer note not saved: the row of the answer was not found`; (b) усі рядки стану одного кінця ходу йдуть людині одним рядком через `; `; (c) `close`, якого не виконати (сховище недоступне, реєстр не читається чи не записався), дає рядок стану `context-editor: trailer close ignored: <причина>`; (d) `close` при блоці, що чекає, закінчує очікування, як закриття інструментом ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)), без постановки замін: новий закритий блок не чекає, а порада про блок, що чекав, не приходить; (e) мітка, відхилена через нечитну чергу чи запит передачі, нотаток тієї самої відповіді не зупиняє; (f) кілька `close` закривають області одним CloseStage: блок — зовнішня із закритих, до кінця ходу; `close` понад довжину ланцюжка закривають увесь ланцюжок; (g) текст ходу стискання `/compact` каже «Trailer lines have no effect in this turn.»; (h) рядок стану повторює не більше TRAILER_ECHO = 80 символів невідомого рядка, а причина повного реєстру нотаток іде людині без поради агентові; збій читання розмови, як і збій запису реєстру, дає рядок стану для кожного сигналу, що лишився (рев'ю фази 6); вступ сесії (997 символів, кожна вставка окремим рядком) і розділ навички «Trailers» називають три вставки.

### 02_07. Перелік згорток і областей  {#SP_FOLD_02_07}

Purpose: дати агентові метаінформацію на запит через інструмент перегляду ([SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01)).

- Заголовок перегляду називає ланцюжок відкритих областей від зовнішньої до внутрішньої замість одного відкритого етапу і число неповернутих згадувань, коли воно > 0: `Recalled levels in the conversation: <N> (<ids згорток>)`, а коли є належні — ще `; <K> return with your next batch of edits`. Рядок рахує лише записи, чия пара є в розмові.
- Новий параметр `folds: bool`. `true` повертає замість рядків розмови перелік обліку згорток, новіші першими: `id`, `kind`, `what`, хід, рядки й розмір рівня, `parent`, позначка `card` для картки завдання, позначка `recalled` для згортки з неповернутим згадуванням. Разом із `folds` дозволені лише `from` і `count` з їхніми чинними значеннями за замовчуванням і межами (`LIST_COUNT`, `MAX_LIST_COUNT`); вони гортають перелік.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| BAD_FOLDS | `folds` разом із параметром, крім `from` і `count` | викликати окремо |

### 02_08. Передача в нову сесію  {#SP_FOLD_02_08}

Purpose: доповнити перенесення реєстрів ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)).

- `folds` і `nextFold` копіюються в сховище нової сесії способом «транскрипт»; спосіб «документ» обліку не переносить: записів згорток у новій розмові немає. Архіви старої сесії пакує прибирання старих сесій ([C_CTX_DEC_29](./context_editor.core.concept.md#C_CTX_DEC_29)), після чого розгортання перенесеної згортки дає ARCHIVE_UNREADABLE (пункт backlog плану). FoldEntry несе абсолютний шлях архіву, тож розгортання в новій сесії читає архіви старої.
- Правки, які передача застосовує при збиранні засіву, отримують номери тим самим AssignFoldIds від перенесеного `nextFold`; їхні FoldEntry з шляхом архіву засіву дописуються в облік нової сесії.
- `recalls` у новій сесії порожній. Спосіб «транскрипт» прибирає пари розгортання разом з іншими власними викликами мода, зі слідами повернення теж; згадане в засів не йде. Правки повернення з черги засів не виконує.
- `questions` у новій сесії теж порожній (PL_HELP, фаза 1; [SP_HELP_02_14](./context_helper.sp.md#SP_HELP_02_14)): засів прибирає пари питань `context_helper`, як пари розгортання.
- Ланцюжок областей переноситься разом із реєстром, з `outer`.
- Збій копіювання обліку не зриває передачу: звіт засіву отримує речення про те, що облік згорток не перенесено. Правило нижньої межі з [02_01](#SP_FOLD_02_01) не дає новим згорткам повторити номери перенесених записів.

### 02_09. Власні виклики розгортання в застосуванні  {#SP_FOLD_02_09}

Purpose: змінити DropOwnCalls ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [SP_CTX_02_64](./context_editor.curation.edits.sp.md#SP_CTX_02_64)).

Rule: пара інструмента RECALL_TOOL лишається в розмові, якщо для неї є запис у `recalls` або текст її результату починається з RETURNED_HEAD. Решта пар цього інструмента (відмови, зміст рівня) прибирається разом з іншими власними викликами й входить у рядок сліду. Рядок результату пари, що лишається, не вважається рядком, який іде: доставки хоста за ним лишаються при ньому й не дублюються ([SP_CTX_02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36)). Перевірка залежностей ([SP_CTX_02_63](./context_editor.curation.edits.sp.md#SP_CTX_02_63)) пар розгортання не враховує.

Пари питань (PL_HELP, фаза 1; [SP_HELP_02_05](./context_helper.ask.sp.md#SP_HELP_02_05)): пара `context_helper` лишається за тим самим правилом, якщо для неї є запис у `questions` або текст її результату починається з ASK_RETURNED_HEAD; кожна інша пара `context_helper` (відмови) прибирається як власний виклик. Засів передачі (без набору пар, що лишаються) прибирає всі такі пари, як і пари розгортання.

## 03. Validation Rules  {#SP_FOLD_03}

### 03_01. Input Validation  {#SP_FOLD_03_01}

- Ідентифікатор згортки — `FOLD_PREFIX` і десяткове число без провідних нулів, не довше дев'яти цифр. Довший схожий рядок у виводі інструмента чи файлі номером не вважається і на нижню межу не впливає.
- Назви `stage` і `task` — ті самі обмеження, що в чинної назви етапу.
- Текст вставки `note` — один рядок; довший за MAX_NOTE дає нерозпізнаний рядок, а не обрізання.
- Тексти, які мод вписує в розмову від себе (RECALLED, RETURNED, речення звітів), — факти, не накази ([спайк](./context_service_info.spike.md), варіант Г5).

### 03_02. Cross-Structure Invariants  {#SP_FOLD_03_02}

- Кожен `Recall.fold` є в `folds`. Для `Question.folds` цього правила немає: згортки питання можуть уже вийти з `folds` ([SP_HELP_01_04](./context_helper.ask.sp.md#SP_HELP_01_04); PL_HELP, фаза 1).
- Ідентифікатор у тексті запису згортки збігається з FoldEntry того самого застосування, коли облік записався.
- Правка повернення не стає в чергу без прийнятої правки агента чи заміни з тегу в тому самому пакеті.
- Запис згортки діапазону не є рядком ролі людини.

### 03_03. Змінені розділи SP_CTX  {#SP_FOLD_03_03}

Ця специфікація змінює названі місця SP_CTX; їхній текст оновлюється в тій самій фазі плану, що й код.

| Розділ SP_CTX | Зміна | Контракт |
|---------------|-------|----------|
| [SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03) | поля `keep` і `region` правки з якорями `keep`; значення `via: 'return'` і порожній `summary` з ним | [02_03](#SP_FOLD_02_03), [02_04](#SP_FOLD_02_04) |
| [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10), [SP_CTX_01_18](./context_editor.records.sp.md#SP_CTX_01_18) | поля `outer`, `kind`; етапи вкладаються | [01_04](#SP_FOLD_01_04) |
| [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12) | нові константи | [01_06](#SP_FOLD_01_06) |
| [SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01) | ланцюжок у заголовку, параметр `folds` | [02_07](#SP_FOLD_02_07) |
| [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03) | `keep`, обхід, правки агента над парою розгортання, AddReturns | [02_03](#SP_FOLD_02_03), [02_04](#SP_FOLD_02_04) |
| [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04), [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07) | FOLD_NOTE, роль запису, виконання повернення, облік у точці фіксації, RETURNED_HEAD серед відкривачів | [02_01](#SP_FOLD_02_01), [02_03](#SP_FOLD_02_03), [02_04](#SP_FOLD_02_04) |
| [SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [SP_CTX_02_64](./context_editor.curation.edits.sp.md#SP_CTX_02_64), [SP_CTX_02_36](./context_editor.deliveries.sp.md#SP_CTX_02_36) | пари розгортання, що лишаються | [02_09](#SP_FOLD_02_09) |
| [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13) | `task`, `nested`, `close` + `task`; діапазонний тег із піном усередині; повернення в пакеті замін із тегів | [02_05](#SP_FOLD_02_05), [02_04](#SP_FOLD_02_04), [02_03](#SP_FOLD_02_03) |
| [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) | перенесення обліку згорток | [02_08](#SP_FOLD_02_08) |
| [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30) | розбір кількох вставок | [02_06](#SP_FOLD_02_06) |
| [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58) | відмови за слова людини лишаються для `drop`, `rewrite`, `describe` і для доставленого посеред ходу | [02_04](#SP_FOLD_02_04) |

## 04. State Transitions  {#SP_FOLD_04}

### 04_01. Згадування  {#SP_FOLD_04_01}

    [немає] --Recall--> [живе] --MarkDue--> [належне] --застосування з правкою повернення--> [запису немає]
    [живе | належне] --правка агента над парою, або проміжок охопив пару--> [запису немає]
    [живе | належне] --PruneRecalls: пари немає в розмові--> [запису немає]

| From | To | Condition | Side effects |
|------|----|-----------|--------------|
| немає | живе | Recall віддав рядки рівня (не зміст рівня) | запис у `recalls` |
| живе | належне | закрилася область і `depth` більша за довжину ланцюжка після закриття; або `depth = 0` і закрилася будь-яка область чи блок без області | `due = true` |
| належне | запису немає | застосування з правкою повернення дійшло точки фіксації | результат пари — RETURNED |
| живе, належне | запису немає | `summarize` чи `drop` агента над парою; згортання діапазону охопило пару | слід із текстом агента; пари немає; RETURNED в елементі архіву |
| живе, належне | запису немає | PruneRecalls не знайшов пари (передача, чужа компактизація, відновлення сесії) | — |

### 04_02. Область  {#SP_FOLD_04_02}

    [немає] --open--> [відкрита] --close | open сусідньої | open task | вставка close--> [закритий блок]
    [відкрита] --вставка optimize--> [чекає] --прийнята правка або наступне відкриття--> [закритий блок]
    [закритий блок] --вставка optimize--> [чекає]

| From | To | Condition | Side effects |
|------|----|-----------|--------------|
| немає | відкрита | `open`; ланцюжок коротший за MAX_DEPTH | `stage` і `outer` оновлено |
| відкрита | закритий блок | `close`; `open` + `stage` над етапом; `open` + `task`; `close` + `task`; вставка `close` | `lastClosed` — зовнішня із закритих; MarkDue |
| відкрита | чекає | вставка `optimize` | область закрито; `waiting`, як сьогодні; MarkDue |
| закритий блок | чекає | вставка `optimize` без відкритої області в ході, де область закрито інструментом | `waiting`, як сьогодні |
| чекає | чекає | вставка `optimize` при блоці, що чекає; найглибша відкрита область охоплює блок або її немає | блок подовжено до кінця ходу; охопна область лишається відкритою (фаза 5) |
| чекає | закритий блок | прийнята правка агента або наступне відкриття чи закриття | `waiting` знято, як сьогодні |
| закритий блок | — | наступне закриття | `lastClosed` перезаписано |

## 05. Verification Criteria  {#SP_FOLD_05}

Позначка `keep` стоїть лише на складній логіці: розрахунку ідентифікаторів і зв'язків, виборі рядків обходу, додаванні повернень, розборі вставок, переходах ланцюжка.

### 05_01. Functional Expectations  {#SP_FOLD_05_01}

| Contract | Scenario | Input | Expected outcome | Test |
|----------|----------|-------|------------------|------|
| RecordFolds | пакет із двома згортками | summarize і collapse | два FoldEntry з `archive` і `entry` за місцем у `originals`; тексти записів несуть FOLD_NOTE з цими `id` | keep |
| RecordFolds | згортка поверх згортки | collapse проміжку із записом `f1` | `f1.parent` = новий `id` | keep |
| RecordFolds | нижня межа номера | облік порожній, у розмові запис `fold f7` | нова згортка — `f8` | keep |
| RecordFolds | невдала правка | друга з трьох згорток не застосувалася | її номер пропущено; третя має свій | keep |
| RecordFolds | правки без запису | drop, rewrite, state | записів обліку немає; `entry` згорток рахує елементи цих правок | — |
| RecordFolds | облік не записався | збій запису | застосування пройшло; записи з FOLD_NOTE; речення FOLDS_UNSAVED у звіті | — |
| RecordFolds | картка завдання | collapse на весь блок закритого завдання | `region.kind = 'task'`, `what` = `task "<назва>"` | — |
| Recall | рівень у межах | `fold` наявний | RECALLED з `<what>`, `<call>`, `<where>`; рядки рівня; запис у `recalls` | — |
| Recall | великий рівень | рівень > MAX_RECALL_CHARS без `from` і `count` | зміст рівня; `recalls` без змін | — |
| Recall | частина | `from`, `count` | лише названі рядки; запис несе `from`, `count` | — |
| Recall | перетин частин | друга частина перетинається з неповернутою | ALREADY_RECALLED; без перетину — другий запис | keep |
| Recall | довгий рядок | рядок рівня > MAX_RECALL_ROW | рядок обрізано з приміткою | — |
| Recall | відмови | субагент; хост обходить компактизацію; немає `fold`; невідомий `id`; `from` за межами; частина завелика; 50 неповернутих; архіву немає | DENIED_SUBAGENT; FOLD_PASSED_OVER; FOLD_REQUIRED; FOLD_UNKNOWN; BAD_PART; PART_TOO_BIG; RECALLS_FULL; ARCHIVE_UNREADABLE | — |
| Recall | пари вже немає | запис згадування без пари в розмові | запис прибрано до перевірок; повторне згадування проходить | — |
| MarkDue | глибина | згадування на глибині 2; закрито область глибини 2, потім 1 | належне після першого закриття | keep |
| MarkDue | без області | згадування з `depth = 0`; вставка `optimize` без відкритої області; те саме з `close` | після `optimize` — належне; після `close` — без змін | — |
| AddReturns | агент згортає | закриття, потім прийнята правка | у черзі правка повернення; після застосування результат пари — RETURNED, запису згадування немає, архів без нового елемента | keep |
| AddReturns | пакета немає | закриття без правок і тегів | черга порожня; `due = true` | keep |
| AddReturns | правка агента охопила пару | collapse над парою в тому самому чи пізнішому виклику | окремої правки повернення в черзі немає; в елементі архіву RETURNED | keep |
| AddReturns | черга повна | належних більше, ніж місця до MAX_QUEUE_EDITS | додано, скільки вміщається; решта належні | — |
| Повернення | текст агента | `summarize` пари розгортання з `summary` | RETURNED + `: <summary>`; архіву немає; запис згадування зник | — |
| Повернення | `drop` пари | `drop` пари розгортання | пари немає; запис згадування зник | — |
| Повернення | пара під піном; пара без запису | належне згадування з піном на парі; `summarize` пари-відмови | правки повернення в черзі немає, згадування лишається належним; пара-відмова правкою повернення не стала | — |
| Повернення | заміна з тегу охопила пару | тег `disposable` на діапазон із парою розгортання, закриття етапу | у черзі одне згортання діапазону, без окремої правки повернення | keep |
| Повернення | пари немає на застосуванні | правка повернення, пара зникла | застосування без невдалої правки у звіті | — |
| FoldSpan | слова людини | collapse над рядком людини без `keep` | прийнято; запис — рядок асистента; перелік називає одне повідомлення людини | keep |
| FoldSpan | проміжок із промпту | проміжок починається рядком людини, без викликів | запис — один текстовий рядок асистента | keep |
| FoldSpan | `keep` | collapse з `keep` на рядок людини | рядок стоїть одразу після запису, дослівно | keep |
| FoldSpan | пін і слот стану | проміжок з обома | обидва лишилися після запису в початковому порядку; відмови немає | keep |
| FoldSpan | пін на рядку | проміжок із текстовим рядком під піном перед згорнутими й після них | рядок перед записом лишився перед ним, рядок після — після | keep |
| FoldSpan | початок розмови | проміжок від рядка 0 без `keep` | HEAD_ROW; з `keep` на рядок 0 — прийнято | keep |
| FoldSpan | закріплена пара в спільному рядку | рядок із двома викликами, один під піном | обидва рядки пари лишилися цілими | keep |
| FoldSpan | відмови | `keep` на чужий рядок; обхід розриває пару; все обійдено | BAD_KEEP; KEEP_SPLITS_PAIR; NOTHING_TO_FOLD | keep |
| FoldSpan | доставлене посеред ходу | проміжок із доставкою людини за результатом | чинна відмова PERSON_WORDS | — |
| FoldSpan | `keep` зник | рядок із `keep` змінився до застосування | правка не застосована: `a kept row is no longer there` | — |
| FoldSpan | інші операції | `drop` пари відповіді людини; `rewrite` рядка людини | чинні відмови | — |
| FoldSpan | діапазонний тег | `disposable` на діапазон із піном і рядком людини | тег прийнято; заміна обходить пін | — |
| Області | завдання й етапи | `open task`, `open stage` двічі | другий етап закриває перший; завдання відкрите | keep |
| Області | вкладення | `open stage` + `nested` | ланцюжок довший на одну; при порожньому — одна область | keep |
| Області | закриття завдання | `close` + `task` з двома відкритими етапами | ланцюжок порожній; `lastClosed` — завдання; звіт для нього | keep |
| Області | відмови | дев'ята область; `close task` без завдання; `stage` і `task` разом | DEPTH_FULL; NO_TASK; STAGE_FIELDS | — |
| ParseTrailers | сумісність | відповідь з останнім рядком мітки оптимізації | `[optimize]` | keep |
| ParseTrailers | кілька сигналів | `note …` і `close` двома останніми рядками | обидва, у порядку | keep |
| ParseTrailers | не в кінці | вставка, після якої є текст | порожньо | keep |
| ParseTrailers | межа | сім рядків вставок підряд | останні п'ять | keep |
| Вставки | `optimize` і `close` разом | обидва сигнали | область закрита й чекає; `close` не виконано | — |
| Вставки | два `close` | ланцюжок із трьох | лишилася одна область | — |
| Вставки | нерозпізнане й невдала нотатка | `[context-editor: foo]`; повний реєстр нотаток | рядки стану людині; інші сигнали виконано | — |
| Перелік | заголовок | ланцюжок із двох, одне згадування | заголовок називає обидві області й число згадувань | — |
| Перелік | `folds` | три згортки, одна — картка, одна згадана | перелік новіші першими з позначками `card` і `recalled`; `from`, `count` гортають; інший параметр — BAD_FOLDS | — |
| Передача | облік | передача способом «транскрипт» | облік у новому сховищі; `recalls` порожній; пар розгортання в засіві немає; розгортання в новій сесії читає архів старої | — |
| Передача | згортки засіву | передача з правками в черзі | записи засіву несуть FOLD_NOTE з номерами після перенесених; їхні FoldEntry — в обліку нової сесії | — |
| Передача | збій копіювання | облік не скопійовано | речення у звіті засіву; нова згортка не повторює номер із розмови | — |
| DropOwnCalls | пари розгортання | застосування з парою, що має запис; з парою з RETURNED; з парою-відмовою | перші дві лишилися; третю прибрано й названо в сліді | keep |
| DropOwnCalls | залежності | правка, чий текст цитує пару розгортання | перевірка залежностей пару не враховує | — |

### 05_02. Invariant Checks  {#SP_FOLD_05_02}

| Invariant | Verification method | Test |
|-----------|---------------------|------|
| Реєстр чинного мода читається без `outer` і `kind` | розбір реєстру з одним `stage` і без нього | — |
| `outer` без `stage` нормалізується | розбір такого реєстру: реєстр читний, ланцюжок порожній | keep |
| Завдання лише зовнішнє | послідовності `open` із `task` і `nested` | keep |
| Правка повернення не стає в чергу сама | закриття області без правок і тегів | keep |
| Номер згортки не повторюється | облік порожній, відкладений, не перенесений | keep |
| Облік не росте понад MAX_FOLDS | 2001 згортка: найстаріша зникла | — |
| Обійдені рядки зберігають текст, виклики й результати | порівняння рядків до й після FoldSpan | keep |
| Запис згортки діапазону не є рядком людини | проміжки, що починаються рядком людини й рядком асистента | keep |
| Вставки не запускають застосування | хід лише з вставками; черга порожня | — |

### 05_03. Integration Scenarios  {#SP_FOLD_05_03}

Живі сценарії в неінтерактивному потоковому хості й у терміналі; моделі — sonnet і opus.

| Scenario | Preconditions | Steps | Expected result | Test |
|----------|--------------|-------|-----------------|------|
| Згортка з повідомленням людини | мод як керований плагін | задача з читанням і рішенням; згортання діапазону разом із промптом людини | запис із `fold f<N>` не є рядком людини: пара-носій, якщо в проміжку є виклик чужого інструмента, інакше рядок асистента ([02_04](#SP_FOLD_02_04), «Роль запису»); промпту людини в розмові немає, він в архіві; рядок для людини після застосування | — |
| Згортка завдання й згадування | попередній сценарій | стороння задача; розгортання | результат із RECALLED; агент називає факт із рівня | — |
| Повернення | згортка є | відкрити етап, розгорнути, закрити етап, згорнути блок | після застосування пара розгортання несе RETURNED; `recalls` порожній | — |
| Вкладена згортка | дві згортки, друга поверх першої | розгорнути зовнішню, потім внутрішню | перший результат містить запис внутрішньої, другий — її рядки | — |
| Згадування після відновлення сесії | згадування є; `--resume` | розгорнути ту саму згортку; закрити етап і згорнути блок | ALREADY_RECALLED, бо пара лишилася в розмові; після застосування пара несе RETURNED | — |
| Вставки | відкрита область | відповідь з `note` і `close` в кінці | нотатка на рядку відповіді; область закрита; застосування немає | — |
| Хост обходить компактизацію | мод без керованих налаштувань | розгортання; відповідь зі вставкою `close` | FOLD_PASSED_OVER; область закрита | — |
| Порівняльний прогін ([C_FOLD_DEC_14](./context_folds.concept.md#C_FOLD_DEC_14)) | згортка завдання й розгортання реалізовані | послідовність завдань із закладеними конфліктами й нагодами повторного використання в трьох рукавах: сира історія, картки, картки з розгортанням | звіт із числами за рукавами у спайку; рішення DEC_14 закриває розробник | — |

### 05_04. Edge Cases and Boundaries  {#SP_FOLD_05_04}

| Case | Input | Expected behavior | Test |
|------|-------|-------------------|------|
| Облік не читається | зіпсований `folds.json` | файл відкладено; облік порожній; нова згортка не повторює номер із розмови | — |
| Архів більший за межу читання сховища | Recall | архів читається через процес | — |
| Закриття зовнішньої області з відкритими внутрішніми | `close` + `task` | усі згадування ланцюжка належні | — |
| Вставка в ході оптимізації після `/compact` | відповідь зі вставкою | не виконується | — |
| Запис згортки зник після чужої компактизації | Recall за `id` з обліку | відповідає; облік не чиститься | — |
| Проміжок із медіа промпту | collapse над промптом із зображенням, якого не можна архівувати | чинна невдача застосування; з `keep` на цей промпт — застосовано | — |
| Повернення й `keep_cache` | повернення раніше за першу правку агента | заморожений префікс закінчується перед парою розгортання | — |

## 06. Reversibility  {#SP_FOLD_06}

### 06_01. Rollback Strategy  {#SP_FOLD_06_01}

Кожен механізм вимикається окремо. Архіви й розмови відкат не змінює; один файл стану попередня версія мода може не прочитати.

| Aspect | Rollback approach |
|--------|-------------------|
| Data/state changes | `folds.json` попередня версія не читає й не чіпає; його можна видалити: згортки лишаються записами в розмові, оригінали читаються за шляхом. Поля `outer` і `kind` реєстру попередня версія не читає й не втрачає через них `stage`; закривши етап, вона лишає `outer`, і нова версія нормалізує його при читанні ([01_04](#SP_FOLD_01_04)). Обмеження (рев'ю фази 5): якщо попередня версія після такого закриття ще й відкриє етап, вона запише `stage` поруч із залишеним `outer`, і нова версія прочитає ланцюжок із давно закритою зовнішньою областю (її межу попередня версія не переносила); відрізнити такий `outer` від справжнього не можна, тож агент закриває зайву область сам — вона видна в заголовку переліку |
| Черга | Черга, у якій стоїть правка повернення (`via: 'return'`), для попередньої версії нечитна: вона відкладає файл, і правки цього пакета втрачаються. Перед відкатом треба дати черзі застосуватися або очистити її |
| Artifacts | Архіви не змінюються. Записи згорток із FOLD_NOTE і сліди RETURNED лишаються в розмовах; попередня версія розпізнає записи за чинними відкривачами, а слід RETURNED читає як звичайний результат власного виклику й прибирає його наступним застосуванням |
| Dependent modules | Інструмент розгортання прибирається разом зі своїм описом; пари розгортання в розмовах тоді прибирає звичайне правило власних викликів |
| External contracts | Поле `keep`, параметри `task`, `nested`, `folds` — необов'язкові; їх зникнення повертає чинні відмови |

Найменший безпечний стан: мод без інструмента розгортання й без обліку — поведінка SP_CTX з однією різницею: згортання діапазону бере повідомлення людини. Повернути й цю відмову — окрема зміна [SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58).

## 07. Design Decisions  {#SP_FOLD_DEC}

### DEC_01 — Якими інструментами агент згортає й розгортає  {#SP_FOLD_DEC_01}

> **Status:** resolved
> **Date:** 2026-11-14

**Question:** згортка — нова операція чи наявні, і де живе розгортання?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — наявні операції плюс один новий інструмент розгортання | словник агента той самий; описи двох інструментів треба скоротити (вони впритул до межі в 2048 символів) |
| B — окремий інструмент згортки й розгортання | два способи стиснути те саме |
| C — операція `fold` замість `collapse` | ламка зміна контракту й текстів |

**Decision:** A (розробник).
**Rationale:** концепт називає чинні операції окремими випадками згортки.
**Rejected because:** B — подвоєння; C — ламає старі сесії й навичку.

### DEC_02 — Як агент відкриває вкладені області  {#SP_FOLD_DEC_02}

> **Status:** resolved
> **Date:** 2026-11-14

**Question:** чи кожне відкриття вкладає?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — завдання явно, етапи пласкі, глибше за прапорцем | звичка «етап на фазу» ціла |
| B — кожне відкриття вкладає | агент, що забув закрити етап, непомітно заглиблюється |

**Decision:** A (розробник).
**Rationale:** найменша зміна поведінки агента при тій самій виразності.
**Rejected because:** B — ламає чинну звичку й навичку.

### DEC_03 — Набір вставок  {#SP_FOLD_DEC_03}

> **Status:** resolved
> **Date:** 2026-11-14

**Question:** які сигнали входять у першу версію?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — `optimize`, `close`, `note` | покриває назване в концепті |
| B — ще й відкриття області та завдання | область починається лише з наступного ходу |
| C — лише `optimize` і `note` | закрити область без наміру згортати вставкою не можна |

**Decision:** A (розробник).
**Rationale:** найменший набір без сигналів, чия помилка видна лише наступного ходу.
**Rejected because:** B — відкриття потребує результату; C — замало.

### DEC_04 — Де знімається відмова за слова людини  {#SP_FOLD_DEC_04}

> **Status:** resolved
> **Date:** 2026-11-14

**Question:** які операції беруть повідомлення людини?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — усі згортки, крім `drop` | одне правило для єдиної дії; `drop` не лишає запису |
| B — лише згортка, що збігається із закритою областю | два правила для однієї дії |

**Decision:** A (розробник).
**Rationale:** згортка лишає запис і оригінал в архіві; прибирання без запису згорткою не є.
**Rejected because:** B — розходиться з [C_FOLD_DEC_04](./context_folds.concept.md#C_FOLD_DEC_04).

Два уточнення агента в межах цього рішення: повідомлення, доставлене посеред ходу без власного рядка, згортка не бере, бо його нема чим покласти в архів; запис згортки — завжди рядок асистента чи пара-носій, бо його текст пише агент.

### DEC_05 — Де живе облік згорток і ланцюжок областей  {#SP_FOLD_DEC_05}

> **Status:** resolved (agent)
> **Date:** 2026-11-14

**Question:** новий файл сесії чи поля реєстру тегів, і чи обмежувати глибину?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — облік згорток у новому файлі; ланцюжок — полем `outer` поруч із чинним `stage`; глибина до MAX_DEPTH | реєстр не росте з числом згорток; попередня версія мода читає реєстр як раніше |
| B — усе в реєстрі тегів | спільна межа розміру файла; вада нового поля робить нечитним увесь реєстр |
| C — ланцюжок новим полем замість `stage` | відкат втрачає відкритий етап |

**Decision:** A.
**Rationale:** облік росте з кожним застосуванням, а реєстр читається на кожній події; `outer` додає вкладення без зміни змісту `stage`. Межа глибини 8 — запобіжник від некерованого заглиблення; концепт говорить про довільну глибину без названого числа, і вісім рівнів (завдання й сім етапів) цю вимогу на практиці не звужують.
**Rejected because:** B — ризик для реєстру; C — гірший відкат.

### DEC_06 — Як повертається згадане  {#SP_FOLD_DEC_06}

> **Status:** resolved (agent)
> **Date:** 2026-11-14

**Question:** якою правкою і коли замінюється пара розгортання?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — запис черги виду `summarize` з `via: 'return'` у найближчому пакеті агента; виклик лишається, результат стає слідом; `summarize` агента над парою — той самий шлях із його текстом | слід видний на місці; власного застосування немає; агент дописує, що взяв |
| B — пара прибирається разом з іншими власними викликами | слід зникає в рядку «виклики прибрано» |
| C — застосування одразу після закриття області | ціна кешу й хід без запиту агента |

**Decision:** A.
**Rationale:** виконує [C_FOLD_DEC_08](./context_folds.concept.md#C_FOLD_DEC_08) і не суперечить правилу, що оптимізацію запускає лише агент.
**Rejected because:** B — губить слід; C — суперечить [C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30).

### DEC_07 — Безпекові механізми відкладено  {#SP_FOLD_DEC_07}

> **Status:** resolved
> **Date:** 2026-11-14

**Question:** чи входять у цю специфікацію відбиток архіву при розгортанні й обробка рядків у чужому виводі, схожих на тексти мода?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — відкласти обидва | специфікація й план менші; розгортання віддає архів як є |
| B — відбиток архіву й примітка про схожі рядки вже тепер | два механізми без виміряної користі до того, як основний функціонал перевірено |

**Decision:** A (розробник: «Безпекові питання відкласти, коли основний функціонал буде працювати стабільно та відповідати очікуванням»; про схожі рядки — «Нічого в цьому плані»).
**Rationale:** спершу має запрацювати й підтвердитися основний механізм ([C_FOLD_DEC_15](./context_folds.concept.md#C_FOLD_DEC_15)).
**Rejected because:** B — передчасно.

### DEC_08 — Журнал ефекту й розгортання  {#SP_FOLD_DEC_08}

> **Status:** resolved (agent)
> **Date:** 2026-11-14

**Question:** чи записувати розгортання в журнал ефекту новим видом запису?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — не записувати | журнал лишається читним для попередньої версії мода; облік згадувань відкладено разом з обліком етапу |
| B — новий вид запису `recall` | сировина для обліку, якого ще ніхто не читає; попередня версія мода вважає журнал із невідомим видом нечитним |

**Decision:** A.
**Rationale:** споживача запису в цьому обсязі немає ([C_FOLD_DEC_03](./context_folds.concept.md#C_FOLD_DEC_03) відкладає облік згадувань), а ціна — гірший відкат.
**Rejected because:** B — запис без споживача.

## Changelog

| Date | Change |
|------|--------|
| 2026-11-14 | Initial version |
| 2026-11-15 | Status → active: PL_FOLD виконано, verify пройдено (регресія, живі прогони в терміналі й stream-json) |
| 2026-11-16 | PL_HELP фаза 1 ([SP_HELP_03_03](./context_helper.sp.md#SP_HELP_03_03)): 01_02 — поле `questions` обліку (відсутнє — `[]`); 02_03 — повернення пар питань тим самим механізмом (MarkDue, AddReturns над згадуваннями, потім питаннями; ASK_RETURNED, речення звіту й результату `context_edit`); 02_08 — `questions: []` у новій сесії; 02_09 — пари `context_helper` із записом чи слідом ASK_RETURNED лишаються |
| 2026-11-15 | Verify PL_FOLD, виправлення: 02_05 — межі завдання від запиту (TurnPrompt — запит людини, TurnWorked, підлога закритого блоку): `open` + `task` і `close` завдання до роботи над запитом ставлять межу на запиті (рішення розробника; рев'ю) |
| 2026-11-15 | Verify PL_FOLD: 05_03 «Згортка з повідомленням людини» — запис названо за правилом «Роль запису» 02_04 (пара-носій чи рядок асистента) |
| 2026-11-15 | PL_FOLD, фаза 6: 02_06 — примітки реалізації (a)–(g): рядок відповіді для `note`, один рядок стану на кінець ходу, `trailer close ignored`, `close` при блоці, що чекає, нотатки при відхиленій мітці, кілька `close` одним закриттям, текст ходу `/compact` |
| 2026-11-15 | PL_FOLD, фаза 5: 02_05 — відмова REGION_BOUNDS, примітки реалізації (a)–(c): `task: false`, TASK_CARD у звіті закриття завдання (картка зі знімком мінливого факту — вхід фази 4), друга мітка лишає охопну область відкритою; 04_02 — перехід «чекає → чекає» |
| 2026-11-14 | PL_FOLD, фаза 3: 02_04 — примітки реалізації (a)–(e): KEEP_SPLITS_PAIR і для обійденої пари по обидва боки запису; порядок обходу NOTHING_TO_FOLD → KEEP_SPLITS_PAIR → HEAD_ROW; крок на обійденому рядку йде перед згортанням; тимчасове поле `kept`; перевірки медіа лише над згорнутими рядками й новий текст невдачі медіа промпту; ScreenPinned передає піни в ApplyEdits |
| 2026-11-14 | PL_FOLD, фаза 2, рев'ю коду: кожна невдача правки повернення має мітку `return of fold <id>`, правка мода над парою під піном пропускається без невдачі; Recall береже лише записи викликів поточного ходу (не за номером ходу); FOLD_UNKNOWN для рядка без форми ідентифікатора; межа черги не рахує правок повернення мода; заголовок рахує лише пари, що є в розмові; облік переносить лише спосіб «транскрипт» |
| 2026-11-14 | PL_FOLD, фаза 2: Recall не чистить запис поточного ходу й читає архів через процес; одне правило прибирання записів у точці фіксації; текст рядка заголовка про згадування; передача прибирає й сліди повернення |
| 2026-11-14 | PL_FOLD, фаза 1, рев'ю коду: номер згортки — до дев'яти цифр; `parent` більший за номер запису й менший за `nextFold`; власний хвіст запису згортки стоїть одразу після слів відкривача; FOLDS_UNSAVED і для номерів, призначених без обліку, які облік уже видав |
| 2026-11-14 | Рев'ю (раунд 1): запис згортки — завжди рядок асистента чи пара-носій; доставлене посеред ходу не згортається; FoldEntry несе шлях архіву й дію; нижня межа номера згортки; розгортання відмовляє на хості, що обходить компактизацію; повний контракт повернення (вид правки, правки агента над парою, заморожений префікс); пари розгортання лишаються лише із записом чи слідом; якорі `keep`; нормалізація `outer`; відбиток архіву й примітку про схожі рядки відкладено (рішення розробника); запису журналу `recall` немає |
