# Редактор контексту агента — Specification: Contracts: handoff

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-11
> **Updated:** 2026-10-13
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_19–02_26 специфікації [SP_CTX](./context_editor.sp.md): контракти `context_handoff`, `/handoff`, RunHandoff, BuildSeed, CheckSeed, CheckSeeded, ScrubCommandRows (вилучено), HandleSeed. Читати перед зміною `hooks/handoff.ts`.

## Contents

Розділи цього файлу (h3 розділу «02. Contracts» парасольки):

- [02_19. context_handoff](#SP_CTX_02_19)
- [02_20. HandoffCommand](#SP_CTX_02_20)
- [02_21. RunHandoff](#SP_CTX_02_21)
- [02_22. BuildSeed](#SP_CTX_02_22)
- [02_23. CheckSeed](#SP_CTX_02_23)
- [02_24. CheckSeeded](#SP_CTX_02_24)
- [02_25. ScrubCommandRows (вилучено)](#SP_CTX_02_25)
- [02_26. HandleSeed](#SP_CTX_02_26)

## 02. Contracts — передача в нову сесію

### 02_19. context_handoff  {#SP_CTX_02_19}

Purpose: інструмент агента; ставить запит передачі розмови в нову сесію ([C_CTX_DEC_11](./context_editor.methods.concept.md#C_CTX_DEC_11)).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| mode | `transcript` \| `document` | no | типово `transcript` |
| document | string | no | ≤ MAX_DOCUMENT; запасний документ для `transcript`, основний для `document` |
| resume | bool | no | типово true |
| resume_prompt | string | no | ≤ MAX_TEXT |

Output: `Handoff queued (<mode>): it runs when this turn ends. End your turn now with a one-line status.` Після запису запиту `requestTurn = turns` ([SP_CTX_01_15](./context_editor.structures.sp.md#SP_CTX_01_15)). Новий запит замінює попередній у стані `queued`; правки, вже поставлені в чергу, застосує передача.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT | виклик із субагента | передає лише основна розмова |
| DENIED_STORAGE | сховище `unavailable` | причина в повідомленні |
| DENIED_BAD_MODE | `mode` не з двох значень | — |
| DENIED_TOO_LONG | `document` > MAX_DOCUMENT або `resume_prompt` > MAX_TEXT | скоротити |
| DENIED_RUNNING | `handoffInFlight`, або запит у стані `running`, який не покинутий за `Due` ([SP_CTX_01_15](./context_editor.structures.sp.md#SP_CTX_01_15)) | дочекатися кінця передачі; запит не замінюється |
| DENIED_QUEUE | Queue `unreadable` або не записалась | причина в повідомленні |

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): при `passed` — DENIED_PASSED_OVER, запиту немає.

### 02_20. HandoffCommand  {#SP_CTX_02_20}

Purpose: команда людини `/handoff [document|cancel]` — те саме, що інструмент, без ходу агента; `cancel` знімає запит, що ще не почався, або запит `running`, який цей екземпляр модуля не веде (зокрема лишений після невдалого запису старої черги).

Processing logic (pseudocode):
    ON command handoff (args):
        IF args trimmed = "cancel":
            IF handoffInFlight AND the current session's request is running: RETURN text "a handoff is running; it cannot be cancelled"   # SP_CTX_04_04: цей екземпляр його веде
            drop a queued request, or a running one while handoffInFlight = false (SP_CTX_04_04), with the report "context-editor: handoff cancelled (cancelled by the person)."; RETURN text "handoff cancelled" or "no handoff waiting"
        mode = args trimmed = "document" ? document : transcript
        write Queue.handoff = { mode, resume: true, resumePrompt: DEFAULT_RESUME, by: person, state: queued, at: now }   # помилки — як у 02_19, зокрема DENIED_RUNNING
        Schedule()                                  # SP_CTX_02_21: знімок turns0 і HANDOFF_DELAY; no-op, поки handoffInFlight
        RETURN text "handoff (<mode>) starts"

Команда не позначається `immediate`: під час ходу вона чекає його кінця, як вбудовані команди. Відповіді команди (`text`) не починаються з `context-editor:`: хост сам показує їх під назвою плагіна (у stream-json — з префіксом плагіна), і префікс мода повторився б; помилки з [SP_CTX_02_19](#SP_CTX_02_19) повертаються тим самим текстом без префікса. Обробник команди — подія, на яку не чекає жоден хід, тож відкладена дія з нього має походження, яке хост ставить у чергу (преамбула розділу 02); це підтверджує обов'язковий сценарій «Команда людини» в обох хостах ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)).

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): при `passed` команда, крім `cancel`, відповідає відмовою з [SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54) і нічого не пише.

### 02_21. RunHandoff  {#SP_CTX_02_21}

> **Criticality:** core

Purpose: виконати запит передачі. Для `transcript` — зібрати засів у старій сесії, очистити сесію вбудованою командою `/clear` і засіяти нову власною компактизацією з HANDOFF_MARKER ([C_CTX_DEC_11](./context_editor.methods.concept.md#C_CTX_DEC_11), S); для `document` або коли засів не зібрався — передати документ першим промптом очищеної сесії. Засів спирається лише на вбудовані команди `/clear` і `/compact`, тож розрахований і на інтерактивний термінал, і на неінтерактивний хост з потоковим входом (stream-json: розширення VS Code, SDK streaming), де команди відновлення сесії немає. Спосіб `document` без документа агента додатково спирається на окремий запит до моделі (`$.model.fork`), перевірений лише в терміналі; у stream-json його підтверджує обов'язковий сценарій «Запасний шлях до очищення» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)).

Логіка — чиста функція за портом HandoffIO: читання й запис черги сесії за каталогом, рядки й API-подання, реєстр тегів, сховище нової сесії, запис і видалення файлів, команда хоста (`clear`, `compact`), відмова якої несе текст хоста, окремий запит до моделі, відправка промпту, спливне повідомлення, засів у пам'яті модуля.

Processing logic (pseudocode):
    # turns, inTurn — лічильник ходів з преамбули розділу 02; handoffInFlight, handoffScheduled, instance, Due — SP_CTX_01_15
    ON turn complete (main loop), after inTurn = false:
        IF aborted AND Queue.handoff.by = agent AND requestTurn = turns: drop it (SP_CTX_04_04)   # запит агента з цього ходу
        ELSE IF Due(Queue): Schedule()                                      # і після перерваного ходу, що відклав передачу

    FUNCTION Schedule():
        IF handoffInFlight OR handoffScheduled: RETURN                      # другий запуск посеред першого неможливий
        handoffScheduled = true; turns0 = turns
        after HANDOFF_DELAY:                                                # відкладена дія з turn.complete або з обробника /handoff
            handoffScheduled = false                                        # до RunHandoff і до повторного Schedule
            outcome = RunHandoff(turns0); ON any exception: toast "context-editor: handoff failed: <error>"; outcome = failed
            IF outcome = deferred AND NOT inTurn: Schedule()                # хід, що відклав передачу, уже скінчився: інший кінець ходу її не запустить

    Moved() = MovedSince(turns0)                                           # хід ішов або почався від планування
    MovedSince(t) = inTurn OR turns ≠ t

    Outcome = deferred | nothing | failed | transcript | document          # результат RunHandoff

    FUNCTION RunHandoff(turns0) → Outcome:
        handoffInFlight = true; cleared = false; turnsClear = none          # cleared — /clear уже створив нову сесію
        afterClearEntered = false; terminal = false; sessionChanged = false # terminal — запис HandedOff, Fail чи FailAfterClear удався
        seed: HandoffSeed? = none; seedReason: string? = none
        IF Moved(): RETURN deferred                                         # запит лишається queued
        old = session id; oldDir = storage of old (prepared)
        claim: on the queue chain, IF Due(q) ignoring handoffInFlight:
            IF state = running AND some <oldDir>/<id>/seed.json with id ≥ at exists:   # покинутий запуск дійшов до засіву і міг дійти до /clear; id — лише назва теки з цифр (ParseSeedNames, `parseSeedNames` у hooks/handoff.ts)
                handoff absent, report += "a previous handoff stopped after building <that file>; it is not re-run; ask again with /handoff or context_handoff"
                RETURN nothing
            state = running, at = now, owner = instance
        ELSE RETURN nothing
        h = the claimed request; reasons = []
        IF h.mode = transcript:
            (seed, seedReason) = PrepareSeed()                              # рівно одне з двох; лише стара сесія, без команд хоста
            IF seedReason: reasons += "transcript: " + seedReason; seed = none   # сесія як була — далі document
            ELSE IF Moved(): RemoveSeedFiles(seed); Defer(); RETURN deferred
            ELSE: RETURN Seed(seed)
        RETURN DocumentWay(reasons)
        ON any exception after the claim:                                   # запит ніколи не лишається running; жоден запис не повторюється
            pending seed = none
            IF NOT cleared:
                remove seed files of seed, if any
                IF NOT terminal: TRY Fail(reasons + "failed: <error>") CATCH: toast "context-editor: handoff failed: <error>; the old queue could not be written"
            ELSE IF seed present AND NOT afterClearEntered AND NOT sessionChanged:
                RETURN AfterClear(seed, "failed: <error>", turnsClear)        # AfterClear ніколи не кидає; при SESSION_CHANGED — лише FailAfterClear нижче (сесія не мода)
            ELSE IF NOT terminal:
                TRY FailAfterClear(seed, reasons + "failed: <error>") CATCH: toast "context-editor: handoff failed after /clear: <error>; the old queue could not be written"
            RETURN failed
        FINALLY: handoffInFlight = false                                    # на кожному виході: поверненні, винятку, deferred, nothing
                 IF cleared: status line = "<n> context edit(s) queued" from the current session's queue, or cleared when it is empty   # рядок стану старої сесії не лишається в новій

    FUNCTION PrepareSeed() → (HandoffSeed, none) | (none, reason):
        transcript = read main conversation rows; rows = CurrentRows(); api = read main conversation in Messages API form
        id = now; folder = <oldDir>/<id>; oldArchives = ArchiveRoot() of the old session   # SP_CTX_01_07; засів — у сховищі, архів і медіа — у каталозі архівів (фаза 35)
        media = <oldArchives>/<id>; archive = <oldArchives>/<id>.json
        batch = Queue.edits
        built = BuildSeed(transcript, rows, api, batch, TagRegistry, media, archive)    # SP_CTX_02_22; пише медіа-файли в media
        IF built is a refusal: remove media; RETURN built.reason
        IF CheckSeed(built.rows) gives a reason: remove media; RETURN that reason           # SP_CTX_02_23
        IF built.report.originals not empty AND writing archive (compact JSON, host command) fails:
            remove media; RETURN "the originals could not be archived"
        IF writing <folder>/seed.json (JSON list of rows, owner-only, host command) fails: remove folder, media and archive; RETURN "the seed could not be written"
        RETURN HandoffSeed { old, id, rows: built.rows, file: <folder>/seed.json, archive: (originals written ? archive : ""),
                             report: built.report, visible: built.visible, edits: batch,
                             fromSummary: built.fromSummary, unmatchedPromptMedia: built.unmatchedPromptMedia, carried: built.carried, taken: false }
        ON any exception: remove folder, media and archive; RETURN "failed: <error>"

    FUNCTION RemoveSeedFiles(s): remove <oldDir>/<s.id>, s.media (= <oldArchives>/<s.id>, коли відрізняється) and s.archive   # засів, що не дійшов до очищення сесії: жоден рядок на них не посилається

    FUNCTION Seed(s):
        TRY run built-in command clear                                      # одна спроба; чекає, доки сесія вільна
        CATCH err: RemoveSeedFiles(s); Fail(["transcript: /clear was refused: " + err]); RETURN failed
        new = session id
        IF new = old: RemoveSeedFiles(s); Fail(["transcript: /clear did not start a new session"]); RETURN failed
        # процес уже в очищеній сесії; повернення в стару немає
        cleared = true; s.new = new
        turnsClear = turns                                                  # змінна RunHandoff; ходи після цієї точки — уже в новій сесії
        IF inTurn: RETURN AfterClear(s, "a turn began in the new session", turnsClear)          # TURN_IN_NEW
        IF turns ≠ turns0: RETURN AfterClear(s, "a turn ran before /clear; the seed would miss it", turnsClear)   # /clear чекав, доки хід скінчиться
        newDir = PrepareStorage for new (SP_CTX_02_15)
        IF unavailable: RETURN AfterClear(s, "the storage of the new session cannot be made: <reason>", turnsClear)
        pending seed = s                                                    # пам'ять модуля; HandleSeed віддає його рядки
        IF MovedSince(turnsClear): RETURN AfterClear(s, "a turn began in the new session", turnsClear)   # перевірка безпосередньо перед командою (SP_CTX_05_02)
        TRY run built-in command compact with args = HANDOFF_MARKER         # одна спроба; чекає, доки сесія вільна
        CATCH err: RETURN AfterClear(s, "the seed compaction was refused: " + err, turnsClear)
        IF session id ≠ new:                                                # людина могла відкрити іншу сесію
            sessionChanged = true; pending seed = none; FailAfterClear(s, ["transcript: the session changed during seeding"]); RETURN failed   # без другого /clear і без промпту; виняток тут — лише FailAfterClear обробника
        IF NOT s.taken: RETURN AfterClear(s, "the seed compaction did not take the seed", turnsClear)     # skip (зокрема хід у новій сесії), збій обробника або відповідь іншого обробника
        why = AwaitSeeded(s.rows, old, session id)                           # SP_CTX_02_24: опитування до SEED_WAIT (F2)
        IF why: RETURN AfterClear(s, "the host did not keep the seeded conversation: " + why, turnsClear)
        pending seed = none
        LogSeeded(s)                                                          # SP_CTX_02_43: рядок людини "handoff: "+ApplyLine(s.report, s.ratio), лише коли засів застосував правки; модель його не бачить
        # засіяно: далі жодного переходу на інший спосіб, хоч би що впало; кожен крок нижче захищений тут же,
        # і обробник винятку RunHandoff не бачить жодного збою після цієї точки
        step HandedOff: HandedOff(new, transcript)                          # спершу: стара черга більше не тримає запит running
        step registries: done = [e IN s.edits | EditLabel(e) IN s.report.applied]   # EditLabel — опис правки, як у ApplyReport.applied
                         FOR reg IN (TagRegistry, AliasRegistry):                        # окремо для кожного, на ланцюжку реєстру в newDir
                             read reg from oldDir → transform → write into newDir (owner-only)   # реєстру в старій сесії немає — для нього нічого не пишеться, без речення
                             transform: tags — RebindTags(reg, before = s.visible, after = s.rows, done, batch = s.edits), with the stage marks and the state slot (SP_CTX_02_14), and introduced = false;
                                        aliases — pruning of changed and vanished pairs (SP_CTX_02_14)
                             # теги й псевдоніми змінених пар (FreshId) і пар, яких засів не містить, видаляються — так само, як після компактизації в тій самій сесії
                             a read or write failure, or a transform failure (then nothing is written): report += " Tags and aliases were not carried over." (once)
        step pin: IF s.fromSummary: PinSummary(newDir, s.rows[0])
        report = "context-editor: this session continues <old> (transcript)."
                 + (s.fromSummary ? " It starts from the summary of an earlier compaction; the rows before it stay in <old>." : "")
                 + (s.unmatchedPromptMedia > 0 ? " Media in <n> of the person's prompt(s) was not carried over." : "")
                 + pin note of PinSummary, if any
                 + (text ? "\n" + text : "")  WHERE text = FormatReport(s.report, s.archive, seed)   # SP_CTX_01_05; порожній — без переносу
        Deliver(report, h.resumePrompt, turnsClear, queueOnly = NOT h.resume)    # без продовження звіт чекає наступного промпту (DeliverReport)
        ON a failure of any step after seeding (caught here, the remaining steps still run):
            toast "context-editor: seeded the new session, but step <step> failed: <error>"
                  + (step = HandedOff ? " The old session <old> still holds a running handoff request; run /handoff cancel there." : "")
        RETURN transcript

    FUNCTION AfterClear(s, reason, turnsClear):                             # процес в очищеній сесії, стара — на диску без змін; ніколи не кидає
        afterClearEntered = true; pending seed = none; reasons = ["transcript: " + reason]
        # кожен крок нижче захищений тут же; збій кроку додає його назву до спливного повідомлення, решта кроків іде далі
        IF MovedSince(turnsClear):                                          # людина вже працює в новій сесії: її не чіпати
            kept = h.document present ? KeepDocument(DocumentText(h.document, "context-editor: this session continues <old> (document). The transcript way failed (" + reasons + ")." + dropped)) : ""   # документ агента тут не доставляється
            step fail: FailAfterClear(s, reasons); step deliver: Deliver(notice(s, reasons) + kept, none, turnsClear, queueOnly = true)
            RETURN failed                                                   # notice — у чергу поточної сесії; kept називає копію документа
        # другий /clear відхилено: `now` лишається засіяною сесією, і HandedOff та документ потрапляють у неї поверх засіву (прийнято)
        step clear: IF s.taken: TRY run built-in command clear CATCH err: reasons += "/clear: " + err   # прибрати засіяну сесію; без засіву вона й так порожня
        now = session id
        IF h.document present:
            RETURN HandDocument(now, DocumentText(h.document, "context-editor: this session continues <old> (document). The transcript way failed (" + reasons + ")." + dropped), turnsClear)
        step fail: FailAfterClear(s, reasons)
        step deliver: Deliver(notice(s, reasons), h.resumePrompt, turnsClear, queueOnly = NOT h.resume)
        RETURN failed
        ON a failure of any step (caught here): toast "context-editor: handoff after /clear: step <step> failed: <error>"   # кроки HandDocument — зі своїми текстами

    notice(s, reasons) = "context-editor: the handoff from <old> failed after the session was cleared (" + reasons + "). The previous session <old> is unchanged." + (s present ? " The assembled conversation is in " + s.file + "." : "")

    FUNCTION Deliver(text, resumePrompt?, turnsClear, queueOnly = false, refused?):   # кожна відправка після /clear; refused — що додати до тосту відмови
        IF queueOnly OR MovedSince(turnsClear):                             # продовження вимкнено (h.resume = false) або людина активна
            Queue of the current session: report += text, reportId = now, reportResume = false   # DeliverReport віддасть з наступним промптом
        ELSE: submit prompt (text + (resumePrompt ? "\n\n" + ResumeText(resumePrompt, HANDOFF_RESUME_FRAME) : ""))   # SP_CTX_02_06; текст продовження — з рамкою автора
            IF the host refuses it (an exception or drop): toast "context-editor: the handoff prompt was refused: <host text>" + (refused ? "." + refused() : "")   # не кидає далі

    DocumentText(doc, tail) = DOCUMENT_FRAME + "\n\n" + doc + "\n\n" + tail   # документ — текст моделі (агента або форку), рамка називає автора

    FUNCTION PinSummary(dir, row):                                          # у реєстрі тегів нової сесії, на його послідовному ланцюжку
        reg = TagRegistry of dir; IF missing: reg = { tags: [], turn: 0, firstPromptPinned: false, introduced: false }
        IF reg unreadable: RETURN note " The summary row was not pinned: the tag registry is unreadable."
        IF the target already has a tag: replace it; ELSE IF len(reg.tags) = MAX_TAGS: RETURN note " The summary row was not pinned: the tag registry is full."
        put Tag { kind: pin, target: { anchor: fingerprint(row), hint: 0 }, created_turn: reg.turn }; firstPromptPinned = true
        write; IF the write fails: RETURN note " The summary row was not pinned: the tag registry could not be written."

    FUNCTION DocumentWay(reasons):
        doc = h.document OR model fork over the session with HANDOFF_PROMPT (no tools); a fork error adds "document: model fork failed: <error>" to reasons
        IF doc empty: Fail(reasons + "document: no handoff document"); RETURN failed
        IF Moved(): Defer(); RETURN deferred
        TRY run built-in command clear CATCH err: Fail(reasons + "document: /clear was refused: " + err); RETURN failed
        IF session id = old: Fail(reasons + "document: /clear did not start a new session"); RETURN failed
        cleared = true; turnsClear = turns
        why = reasons not empty ? " The transcript way failed (" + reasons + ")." : ""
        IF turns ≠ turns0: why += " A turn ran before /clear; it stays in <old> and is not in this document."   # /clear чекав кінця ходу
        new = session id
        RETURN HandDocument(new, DocumentText(doc, "context-editor: this session continues <old> (document)." + why + dropped), turnsClear)

    FUNCTION HandDocument(to, text, turnsClear):                            # після /clear: DocumentWay і AfterClear з документом агента; ніколи не кидає
        # кожен крок захищений тут же; збій кроку — спливне повідомлення, наступний крок іде далі (аудит PL_AUD_CTX, CF-41)
        step HandedOff: HandedOff(to, document)                            # стара черга — до промпту
        step deliver: Deliver(text, h.resumePrompt, turnsClear, queueOnly = NOT h.resume, refused = KeepDocument(text))   # відхилений промпт теж губив би документ
        ON a failure of step HandedOff: toast "context-editor: handoff after /clear: step HandedOff failed: <error>. The old session <old> still holds a running handoff request; run /handoff cancel there."
        ON a failure of step deliver:                                       # сховище чи черга нової сесії недоступні (шлях черги: resume = false або хід після /clear)
            toast "context-editor: handoff after /clear: step deliver failed: <error>." + KeepDocument(text)
        RETURN document

    FUNCTION KeepDocument(text):                                            # копія недоставленого документа; ніколи не кидає
        file = <old storage>/<id>/document.txt WHERE id = seed present ? seed.id : now   # поруч із файлами засіву, коли засів є
        write text into file (owner-only, host command)                    # текст, який мав піти: з рамкою і хвостом, без продовження
        RETURN written ? " The document is in <file>." : " The document is lost: <file> could not be written."

    FUNCTION HandedOff(to, mode): old Queue: KeepOtherSteps (edits = [], resume, resumePrompt, resumeSet, tagsOnly, keepCache — за замовчуванням), handoff absent, AppendReport("this session was handed off to <to> (<mode>)", reportId = now, reportResume = false); terminal = true   # SP_CTX_01_04: вибори пакета скидаються з пакетом, інакше пакет старої сесії після --resume успадкував би keep_cache (аудит PL_AUD_CTX, CF-6)
    FUNCTION Defer(): old Queue: handoff.state = queued, owner removed     # знову після наступного кінця ходу
    FUNCTION Fail(reasons): old Queue: handoff absent, report += "handoff failed: <reasons>; the session was not changed", reportId = now, reportResume = false; terminal = true; toast
    FUNCTION FailAfterClear(s?, reasons): old Queue: handoff absent, report += "handoff failed after the session was cleared: <reasons>; this session was not changed" + (s present ? "; the assembled conversation is in <s.file>" : ""), reportId = now, reportResume = false; terminal = true; toast
    # terminal ставиться лише після вдалого запису; у межах одного запуску жоден з трьох записів не робиться двічі

Автор тексту в промпті нової сесії ([SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17), аудит PL_AUD_CTX, CF-8). Документ передачі написала модель — агент у `document` або форк моделі з HANDOFF_PROMPT, а `resume_prompt` — агент; мод надсилає їх з роллю `user` у сесію, де виклику `context_handoff` уже немає, тож без рамки вони виглядали б словами людини. Документ відкриває рядок DOCUMENT_FRAME: `context-editor: your handoff document from the previous session follows; it is your own text, not the person's.`; текст продовження агента йде за рамкою HANDOFF_RESUME_FRAME: `context-editor: the resume prompt you set before the handoff: <text>`, а DEFAULT_RESUME (зокрема для `/handoff` людини, яка тексту продовження не задає) — з префіксом мода, як у Flush ([SP_CTX_02_06](./context_editor.edits.sp.md#SP_CTX_02_06)). Рамка — частина самого тексту, тож вона лишається і тоді, коли Deliver кладе текст у звіт черги для DeliverReport. У черзі (`handoff.document`, `handoff.resumePrompt`) тексти зберігаються без рамки. Той самий бік має й запит форку (фаза 31, CF-43): `$.model.fork` подає HANDOFF_PROMPT моделі як промпт людини, і до фази 31 документ переносив його в «Task and constraints (verbatim from the person)», а заборону викликів — у рішення в силі («No tool calls for the current request»; живий прогін фази 6a аудиту, `.dev_flow/cache/live-test/audit-p6a-results.md`): нова сесія могла успадкувати заборону інструментів. Тепер HANDOFF_PROMPT відкриває PREFIX з автором (`context-editor: this request is the mod's, not the person's …`), а кінцеве речення каже, що запит і його правила — лише для цієї відповіді й поза документом ([SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12)). Документ агента (`document`) запиту форку не має і не змінюється.

`dropped` = ` The <n> queued edit(s) were not carried over.`, коли черга мала правки. Причина з відмови команди хоста несе текст винятку хоста дослівно: мод ніколи не ковтає відмову `/clear` чи `/compact` ([C_CTX_DEC_13](./context_editor.methods.concept.md#C_CTX_DEC_13)). Відправка промпту, відхилена хостом (виняток або `drop`), дає спливне повідомлення з текстом відмови хоста і не кидає винятку далі: результат лишається `transcript` (REPORT_LOST) або `document`; для документа спливне повідомлення ще й називає його копію (KeepDocument, DOCUMENT_NOT_DELIVERED), бо HandedOff уже прибрав документ зі старої черги.

Порядок має значення. Засів збирається і пишеться до очищення сесії: після `/clear` читання розмови й API-подання бачать уже нову, порожню сесію, а окремий запит до моделі над старою розмовою неможливий. Тому збій збирання веде до способу `document` у старій сесії, а збій після очищення — до повторного очищення (лише коли засів уже взято) і документа агента, а без нього — повідомлення з ідентифікатором старої сесії і шляхом до файлу засіву. Правки черги старої сесії при `Fail` і `FailAfterClear` лишаються в її черзі: стара сесія не змінена, і її можна відновити; при `HandedOff` вони йдуть у засів або, для `document`, не переносяться (`dropped`).

Ідентифікатор нової сесії до `/clear` невідомий, тож файл засіву, архів оригіналів і перенесене медіа лежать у сховищі старої сесії ([SP_CTX_DEC_09](./context_editor.sp.md#SP_CTX_DEC_09)); їхні шляхи вписано в текст засіяних рядків. Засів живе в пам'яті модуля: перезавантаження модуля між `/clear` і компактизацією засіву лишає нову сесію порожньою, а запит у старій черзі — у стані `running`; новий екземпляр, у якого `handoffInFlight = false`, вважає його належним через HANDOFF_STALE ([SP_CTX_01_15](./context_editor.structures.sp.md#SP_CTX_01_15), [SP_CTX_05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04)). Поки RunHandoff цього екземпляра йде, запит не належний, хоч би скільки `/clear` чекав кінця довгого ходу; будь-який виняток RunHandoff до засіву закінчується Fail, AfterClear або FailAfterClear, а збої після засіву Seed перехоплює сам, як і HandDocument — збої HandedOff і Deliver документа після `/clear` (спливне повідомлення називає крок; документ, який Deliver не віддав, лишається копією в сховищі старої сесії), тож запит не лишається `running`, хіба що не вдався сам запис старої черги. Теги й псевдоніми копіюються і одразу проходять ті самі RebindTags і очищення псевдонімів, що й після компактизації в тій самій сесії ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)): незмінені засіяні пари зберігають ідентифікатори викликів старої сесії ([SP_CTX_01_17](./context_editor.structures.sp.md#SP_CTX_01_17)), тож їхні теги й псевдоніми працюють далі; змінені пари отримали FreshId, і їхні теги й псевдоніми видаляються, тож `ref` такої пари в новій сесії дає UNKNOWN_REF, а не TARGET_NOT_FOUND.

Етапи, слот стану й інструкція в новій сесії. Відкритий етап і останній закритий блок переходять у реєстр нової сесії з межами, перенесеними RelocateMark з `s.visible` на `s.rows` ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)): межа, чий рядок замінила правка засіву, переходить на останній створений нею рядок; рядок, що лишився до підсумку (`fromSummary`), має `lost` у «до» і дає `null`; рядок, змінений засівом (CarryNote, `s.carried`) або прибраний нормалізацією, — найближчий попередній незмінений засіяний рядок або `null`. Тег `state` незміненого рядка переходить за відбитком; переписаний правкою засіву — за правилом слоту стану. `introduced` у копії — `false`: нова сесія — інший ідентифікатор, а прихований контекст першого промпту старої сесії в засіяні рядки не потрапляє, тож інструкцію отримає перший промпт нової сесії, що проходить хуки мода ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)); власні промпти мода (продовження після засіву, документ) хуків не проходять (F1). `lastApply` у копії реєстру знімається (виміряна зміна в новій сесії не була б звільненням застосування). Нотатки переходять разом із тегами: RelocateNote з `s.visible` на `s.rows` ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)); нотатка на рядку виклику незміненої пари, який засів злив з іншими рядками викликів тієї ж відповіді (MergeCallRows: жоден засіяний рядок не має `handle`), переходить на злитий рядок за ідентифікатором свого першого виклику, а не видаляється; `notesDropped` засіву називає звіт нової сесії. Журнал ефекту не переноситься: він лишається у сховищі старої сесії разом з архівами, які називає. Способом `document` реєстрів у новій сесії немає, тож `introduced` там теж `false`.

Команди в черзі хоста. Кожна команда (`/clear`, `/compact HANDOFF_MARKER`, друге `/clear` в AfterClear) — одна спроба: відмова остаточна, її текст іде в причину. Команда, запущена, поки триває хід, чекає його кінця, тож лічильник ходів звіряється після кожної команди. Хід між плануванням і першим `/clear` уже виконано в старій сесії, і засів його не містить — Seed переходить до AfterClear; у способі `document` такий хід лишається в старій сесії, а промпт це називає. Хід, що йде одразу після `/clear` (`inTurn`), або хід між `/clear` і компактизацією засіву відбувається в новій сесії: Seed чи HandleSeed ([SP_CTX_02_26](#SP_CTX_02_26)) відмовляють, і AfterClear за `MovedSince(turnsClear)` не очищає сесію вдруге. Кожен текст після `/clear` (звіт засіву, документ, повідомлення про збій) іде через Deliver: якщо людина вже почала хід, текст лягає у звіт черги поточної сесії з `reportResume = false`, і DeliverReport ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)) додасть його до її наступного промпту, а промпту мод не надсилає. Якщо після компактизації засіву сесія інша, ніж створив `/clear` (людина могла відкрити іншу сесію), мод не очищає її і нічого в неї не надсилає: лише звіт у черзі старої сесії. Залишкове вікно: хід, що почнеться між перевіркою `MovedSince(turnsClear)` в AfterClear і виконанням другого `/clear`, хост виконає в напівзасіяній сесії, і друге `/clear` його прибере; хід лишиться лише в транскрипті цієї сесії.

Закріплення підсумку. Коли засів починається з підсумку (`fromSummary`: голова з API-подання або перший рядок, що вже починався з SUMMARY_OPENER), у ньому, а не в першому промпті людини, лежить початкове завдання. R1 ([SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11)) бачить лише нові рядки людини, а засіяні рядки подію додавання або оминають (термінал), або проходять з походженням плагіна, яке AutoTag пропускає (stream-json, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)); скинути `firstPromptPinned` недостатньо — R1 закріпив би наступний промпт людини, а не підсумок. Тому RunHandoff сам ставить `pin` на перший засіяний рядок у скопійованому реєстрі (PinSummary): один запис, без нового правила. Реєстру немає — PinSummary створює його; реєстр повний (MAX_TAGS) або нечитабельний — `pin` не ставиться, і звіт нової сесії це називає. Інакше скопійований `pin` першого промпту знаходить той самий рядок за відбитком.

Errors: відмови не виходять назовні — кожна причина потрапляє у звіт старої черги (`Fail`, `FailAfterClear`), у промпт нової сесії або веде до способу `document`.

| Code | Condition | Outcome |
|------|-----------|---------|
| SEED_REFUSED | BuildSeed або CheckSeed відмовили, архів чи файл засіву не записались, виняток під час збирання | файли засіву видалено; спосіб `document` у старій сесії |
| CLEAR_REFUSED | `/clear` відхилено або сесія не змінилась (обидва способи) | `Fail`: стара сесія без змін, правки лишаються в черзі |
| TURN_BEFORE_CLEAR | `/clear` чекав кінця ходу, що почався після планування | AfterClear з `a turn ran before /clear; the seed would miss it` |
| NEW_STORAGE | сховище нової сесії не створилось | AfterClear |
| SEED_COMPACT_REFUSED | команду компактизації засіву відхилено | AfterClear з текстом відмови хоста |
| SEED_NOT_TAKEN | обробник не взяв засів (`skip`, збій, інший обробник відповів) | AfterClear |
| SEED_NOT_KEPT | CheckSeeded знайшов розбіжність | AfterClear з причиною розбіжності |
| TURN_IN_NEW | хід іде одразу після `/clear` або почався в новій сесії до кінця засіву | FailAfterClear без повторного очищення; повідомлення про збій — у звіт черги поточної сесії (Deliver), без промпту |
| SESSION_CHANGED | після компактизації засіву поточна сесія — не та, що створив `/clear` | FailAfterClear без повторного очищення, без промпту і без запису в поточну сесію |
| PERSON_ACTIVE | людина почала хід до відправки звіту, документа чи повідомлення | текст — у звіт черги поточної сесії з `reportResume = false`; промпту немає |
| REPORT_LOST | після засіву звіт не доставлено | спливне повідомлення; результат передачі — `transcript` |
| DOCUMENT_NOT_DELIVERED | після `/clear` Deliver документа кинув виняток (сховище чи черга нової сесії недоступні) або хост відхилив його промпт; або хід почався в новій сесії до кінця засіву, коли є документ агента (TURN_IN_NEW) | копія тексту в `<old storage>/<id>/document.txt` (KeepDocument); спливне повідомлення (для TURN_IN_NEW — повідомлення про збій) називає цей файл; результат — `document` (для TURN_IN_NEW — `failed`, стара черга — FailAfterClear) |
| HANDED_OFF_FAILED | після `/clear` запис HandedOff у стару чергу не вдався (способом `document`) | документ усе одно доставлено; спливне повідомлення називає крок і радить `/handoff cancel` у старій сесії, де запит лишився `running`; результат — `document` |

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): запит, поставлений до вердикту, при `passed` на запуску не виконується — стан `done` зі звітом HANDOFF_PASSED_OVER, команди немає.

### 02_22. BuildSeed  {#SP_CTX_02_22}

Purpose: зібрати рядки нової сесії з того, що бачить модель, і правок черги ([C_CTX_DEC_12](./context_editor.methods.concept.md#C_CTX_DEC_12), C). Чиста функція, крім запису медіа-файлів через порт. До 2026-10-09 — BuildTranscript, що збирав записи файлу сесії.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| transcript | list<Row> | yes | рядки, як їх повернуло читання розмови, ≤ ROW_WINDOW |
| rows | list<Row> | yes | CurrentRows ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) — суфікс `transcript` |
| api | list<json> | yes | API-подання основної розмови, ≤ ROW_WINDOW повідомлень |
| edits | list<QueuedEdit> | yes | Queue.edits старої сесії, ≤ MAX_QUEUE_EDITS |
| tags | TagRegistry зі станом читання | yes | для перевірки `pin`, як у [SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07) |
| folder | string | yes | `<old storage>/<id>` |
| archive | string | yes | `<old storage>/<id>.json` |
| writeMedia | функція (path, base64) → bool | yes | порт запису медіа-файлу, доступного лише власникові |
| deliveries | list<QueuedDelivery> зі станом читання | yes | `deliveries.json` старої сесії ([SP_CTX_01_22](./context_editor.structures.sp.md#SP_CTX_01_22)); `unreadable` — без вставок, причина у звіті (фаза 20) |

Output: `{ rows: list<Row>, report: ApplyReport, visible: list<Row>, fromSummary: bool, unmatchedPromptMedia: int, carried: list<string> }` або відмова з причиною; `visible` — рядки, передані в ApplyEdits; `carried` — результати з CarryNote.

Processing logic (pseudocode):
    FUNCTION BuildSeed(transcript, rows, api, edits, tags, folder, archive, writeMedia, deliveries):
        (knownResults, apiTruncated) = CollectMedia(api, rows)                              # SP_CTX_02_10
        hidden = some row of rows holds a tool result whose id is not in knownResults
                 OR some user row of rows other than rows[0] has text that, trimmed, starts with SUMMARY_OPENER   # підсумок посеред рядків — межа не записана
        early = []
        IF NOT hidden:                                                                     # модель бачить усі рядки
            IF rows = transcript (CurrentRows found no boundary) AND len(transcript) ≥ ROW_WINDOW:
                REFUSE "the conversation fills the host's 4096-row window; its start may be cut"
            head = none; visible = rows
        ELSE:                                                                              # після вбудованої компактизації, чию межу цей процес не записав
            IF apiTruncated OR len(transcript) ≥ ROW_WINDOW:                                # результат міг випасти з вікна читання, а не з погляду моделі
                REFUSE "the conversation fills the host's 4096-row window; its start may be cut"
            first = api[0]
            summary = the text blocks of first that are not reminder blocks, joined with "\n\n"   # content given as a string = one text block; reminder block: trimmed text starts with "<system-reminder" (REMINDER_PREFIX; also <system-reminder id="…">)
            IF first is not a user message OR first holds a tool_result block OR trimmed summary does not start with SUMMARY_OPENER:
                REFUSE "the model does not see every row, and what it sees does not start with a compaction summary"
            stripped(x) = x with every whitespace character removed
            k = min(160, len(stripped(summary)))
            s = the largest index such that rows[s] has role user, no toolResults,
                and stripped(rows[s].text) starts with the first k characters of stripped(summary)    # SP_CTX_DEC_08
            IF none: REFUSE "the summary the model sees was not found among the rows"
            visible = rows[s+1 ..]
            IF some row of visible holds a tool result whose id is not in knownResults: REFUSE "rows the model does not see follow the summary"
            head = Row { role: user, text: summary, toolUses: [] }
            FOR edit IN edits whose target lies in rows but not in visible:      # summarize, drop: call or result outside visible;
                early += "<edit>: the model no longer sees this row"; remove edit  # collapse, rewrite, describe: Locate finds the anchor in rows, not in visible
        (edits, refused) = ScreenPinned(visible, edits, tags)                               # SP_CTX_02_03: pin і state, як у SP_CTX_02_07
        (found, unmatched) = CollectMedia(api, visible)                                    # власник {row} — індекс у visible, що закінчується там само, де api
        n = 0; items = {}                                                                  # items[owner][k] — шлях k-го медіа власника або відсутній
        FOR owner IN found WHERE owner is {tool_use_id} OR an edit of edits replaces it, FOR k, ref IN found[owner]:   # кожне медіа окремо; медіа промпту — лише для правки, що його замінює
            IF ref.data absent: items[owner][k] = absent; CONTINUE
            n += 1; path = <folder>/<n>.<ext of ref.mediaType>                             # ext — як у SP_CTX_01_06
            IF NOT writeMedia(path, ref.data): REFUSE "media of <owner> could not be archived"
            items[owner][k] = path
        media = for each owner, the present paths of items[owner] in order                 # вхід ApplyEdits: шляхи для mediaNote
        (seed, report, renamed) = ApplyEdits(visible, edits, archive, media, mediaOwners = ∅, knownResults, unmatched, apiTruncated)   # SP_CTX_02_04
        report.failed = early + refused + report.failed
        (seed, report.deliveries, _, added) = InsertDeliveries(visible, seed, deliveries, renamed, allRebuilt = true)   # SP_CTX_02_36: у засіві жоден рядок не має handle, тож вставляється кожна доставка, чий якір лишився; {as: 'api'} доставок не має (пункт 43), без вставки передана розмова їх губить; фаза 20
        (seed, report.ownCallsRemoved) = DropOwnCalls(seed, ∅, knownResults)                # зокрема виклик context_handoff; лічильник — для речення P13 (SP_CTX_01_05)
        report.charsAfter = Σ size(seed) − added                                           # тут: «звільнено» рахує лише правки, без CarryNote, голови і вставлених доставок
        replaced = owners whose media the edits in report.applied replace
        FOR each tool result t in seed whose owner {t.tool_use_id} is in found and not in replaced:
            t.text = t.text + (t.text blank ? "" : "\n\n") + CarryNote(found[owner], items[owner])
        unmatchedPromptMedia = unmatched + count of owners {row} in found not in replaced   # медіа промптів, якого засів не несе: не зіставлене або не замінене правкою
        seed = every row of seed rebuilt without handle                                    # handle старої сесії після /clear хост мовчки ігнорує
        IF head present: seed = [head] + seed
        IF seed[0] has role user AND seed[0].text has a line that holds TRANSCRIPT_LINE: remove every such line, then trim seed[0].text
        UNTIL nothing changes: drop leading assistant rows; drop tool results whose call is in no earlier row;
                               drop calls whose result is in no later row; drop rows without text, calls and results
        seed = MergeCallRows(seed)                                                         # SP_CTX_02_04: жоден засіяний рядок не має handle — паралельні виклики однієї відповіді одним рядком (Verify фази 14, D1)
        IF seed empty: REFUSE "no rows to carry over"
        report.produced = Produced(seed, applied steps)               # після голови і нормалізації: індекси засіяних рядків
        IF len(seed) > ROW_WINDOW − SEED_ROOM: REFUSE "the seed has <n> rows; at most ROW_WINDOW − SEED_ROOM fit the new session's read window"
        report.mediaFiles = every present path in items; carried = tool_use_id of every result that got CarryNote
        RETURN seed, report, fromSummary = (head present OR trimmed text of seed[0] starts with SUMMARY_OPENER), unmatchedPromptMedia, carried   # F5

    CarryNote(refs, paths) = MARK + " media carried as files (open them with Read): " + one item per k, joined ", ":
        paths[k] present → "<refs[k].mediaType> <paths[k]>"; paths[k] absent (refs[k] without inline data) → "<refs[k].mediaType> (not carried: no inline data)"

Медіа в промпті людини (власник `{row}` за PromptMatch, [SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10)) засів несе лише через правку, що його замінює (`describe`, `collapse`: файл у `<folder>` і шлях у mediaNote); незмінений промпт з медіа переходить без нього і лічиться в `unmatchedPromptMedia` разом із незіставленим («Media in <n> of the person's prompt(s) was not carried over»), а файли для нього не пишуться (фаза 5). Нести таке медіа файлом, як CarryNote для результатів, — backlog плану.

Голова — підсумок вбудованої компактизації, перше повідомлення API-подання. Вміст повідомлення API-подання, заданий рядком, — один текстовий блок з цим текстом. Результат поза API-поданням означає «модель цього рядка не бачить» лише тоді, коли жодне з вікон читання не заповнене: рядки, що випали за межу ROW_WINDOW, модель ще може бачити, тож за заповненого вікна засів відмовляє (WINDOW_FULL). Блок-нагадування — текстовий блок, обрізаний текст якого починається з `<system-reminder` (REMINDER_PREFIX, той самий префікс, що в PROMPT_DECORATIONS PromptMatch, [SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12)): нагадування з атрибутами (`<system-reminder id="…">`, звіт субагента, фаза 20) теж не входить у підсумок (аудит PL_AUD_CTX, CF-5). `mediaOwners = ∅` у виклику ApplyEdits: усе медіа засіяних рядків уже лежить файлами, а засіяний рядок ніде не зберігає `handle`, тож правила ApplyEdits, що бережуть незаархівоване медіа сусідніх пар, тут не потрібні; шляхи замінених пар потрапляють у текст правки (`(media: …)`), як при компактизації. Медіа в промптах людини не переноситься, доки відкрите [SP_CTX_DEC_06](./context_editor.sp.md#SP_CTX_DEC_06): його кількість (`unmatchedPromptMedia`) називає звіт нової сесії. Thinking-блоки не переносяться: рядок без `handle` хост будує лише з тексту і блоків інструментів. Нагадування хоста (`<system-reminder>`) і повторно вкладені вбудованою компактизацією файли до засіву не потрапляють: голова — лише текст підсумку, а рядки беруться з транскрипту, не з API-подання. Рядки команд (`/compact`, «Compacted») поточної розмови засіваються як звичайні рядки людини.

Після `--resume` (фаза 32; спайк [context_editor_resume](./context_editor_resume.spike.md), CF-46, CF-51). Читання розмови в новому процесі — завантажений ланцюжок з оригіналами поруч з копіями: ті самі ідентифікатори викликів двічі, і CheckSeed відмовляв `row <i>: repeated call id <id>` (запасний шлях — `document`). Зазвичай ремонт ([SP_CTX_02_47](./context_editor.resume.sp.md#SP_CTX_02_47)) уже прибрав їх до першого запиту; на випадок, коли його відмовлено чи передачу запущено раніше, BuildSeed першим кроком бере `rows = DropPulled(rows, ApplyLedger старої сесії, applied).kept` (і `transcript` — тим самим рядкам без прибраних) ([SP_CTX_02_45](./context_editor.resume.sp.md#SP_CTX_02_45); журнал читає HandoffIO `readLedger`, `unreadable` — порожній): засів перебудовує всі рядки без `handle`, тож який з двійників лишився — байдуже, а змінена правкою копія виграє за ідентифікаторами. Рядки читання розмови `handle` не несуть (тип хоста; жива перевірка фази 32), тож тут журнал ремонту рядків не розпізнає і діє залишкове правило DropPulled (`applied`: запис журналу чи `apply` журналу ефекту старої сесії) — повтори викликів і результатів; повтори, яких воно не розпізнало (текстові відповіді, неоднакові повтори), лишаються, і CheckSeed відмовляє, як і раніше. Результати ToolSearch засів перебудовує ToolRefText ([SP_CTX_02_48](./context_editor.resume.sp.md#SP_CTX_02_48)).

Errors (кожна — відмова з причиною, RunHandoff переходить на `document`):
| Code | Condition |
|------|-----------|
| WINDOW_FULL | модель бачить усі рядки, CurrentRows не знайшов межі, а читання повернуло ROW_WINDOW рядків; або є результат поза API-поданням, а читання розмови повернуло ROW_WINDOW рядків чи API-подання обрізане (`apiTruncated`, ≥ ROW_WINDOW − 1 повідомлень) |
| NO_SUMMARY | модель бачить не всі рядки, а перше повідомлення API-подання — не текст людини, що починається з SUMMARY_OPENER |
| SUMMARY_NOT_FOUND | у рядках немає рядка людини з початком підсумку |
| HIDDEN_AFTER_SUMMARY | після знайденого підсумку є результат, якого немає в API-поданні |
| MEDIA_NOT_ARCHIVED | медіа з вбудованими даними не записалось у файл |
| EMPTY | після нормалізації не лишилось рядків |
| SEED_TOO_LONG | засів довший за ROW_WINDOW − SEED_ROOM рядків: разом з рядками `/clear` і команди компактизації він не вмістився б у вікно читання нової сесії, і CheckSeeded не знайшов би межі |

### 02_23. CheckSeed  {#SP_CTX_02_23}

Purpose: відкинути засів, який хост прийняв би, але модель отримала б зіпсовану розмову або API відхилив би запит ([C_CTX_DEC_13](./context_editor.methods.concept.md#C_CTX_DEC_13), перевірка перед засівом). Чиста функція; повертає першу порушену умову як причину або «гаразд». До 2026-10-09 — CheckTranscript.

Rules (`i` — індекс рядка засіву):
| Rule | Reason |
|------|--------|
| рядків ≥ 1 | `no rows to carry over` |
| перший рядок має роль `user` | `the first row is not the person's` |
| жоден рядок не має `handle` | `row <i>: holds a handle` |
| у кожному рядку є текст, виклик або результат | `row <i>: empty` |
| виклики лише в рядках `assistant`, результати лише в рядках `user` | `row <i>: tool_use in a user row` / `row <i>: tool_result in an assistant row` |
| ідентифікатори викликів унікальні; ідентифікатори результатів унікальні | `row <i>: repeated call id <id>` / `row <i>: repeated result id <id>` |
| кожен виклик має результат з тим самим ідентифікатором у пізнішому рядку, і між ними немає рядка `user` без результатів | `row <i>: call <id> has no result before the next prompt` |
| кожен результат відповідає виклику з ранішого рядка | `row <i>: result <id> answers no call` |

Рядки однієї ролі поспіль допустимі: засів зберігає форму рядків, у якій хост віддає їх обробнику компактизації і приймає назад при кожному застосуванні правок; BuildSeed рядків не зливає.

### 02_24. CheckSeeded  {#SP_CTX_02_24}

Purpose: після компактизації засіву переконатися, що хост тримає саме засіяну розмову ([C_CTX_DEC_13](./context_editor.methods.concept.md#C_CTX_DEC_13), A). Чиста функція; повертає причину або «гаразд». До 2026-10-09 — CheckSwitched.

Input: `seed: list<Row>` (HandoffSeed.rows), `read: list<Row>` (рядки, прочитані в новій сесії після команди, увесь транскрипт), `old`, `now` — ідентифікатори старої і поточної сесії.

Logic (перша порушена умова — причина):
- `now ≠ old`, інакше `the session id did not change`;
- `p = BoundaryAt(read, head = fingerprints of seed[0 .. min(len(seed), HEAD_ROWS)), count = len(seed))` ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)); немає — `the seeded rows were not found`;
- текст `read[p]` — першого рядка після межі — містить перші SEED_PROBE символів тексту `seed[0]`, якщо той непорожній; інакше `the first row after the boundary is not the seeded one`;
- кожен ідентифікатор виклику з `seed` є серед викликів `read[p ..]`; інакше `seeded call <id> is missing`.

Очікування рядків. У неінтерактивному хості `$.command.run('compact')` завершується після відповіді обробника, але ще до того, як повернені рядки з'являються в читанні розмови (приблизно через 50 мс); у терміналі вони вже є на момент завершення (Verify фази 10, 2026-10-09, F2). Тому RunHandoff перевіряє засів через AwaitSeeded:

    FUNCTION AwaitSeeded(seed, old, now):
        deadline = clock + SEED_WAIT
        LOOP:
            why = CheckSeeded(seed, read main conversation rows, old, now)
            IF why absent OR clock ≥ deadline: RETURN why                   # остання причина — SEED_NOT_KEPT
            wait SEED_POLL

Інших читань рядків одразу після компактизації мода немає: Flush читає лише чергу, записану до відповіді обробника; межу записують HandleCompaction і HandleSeed з рядків, які вони самі повертають, а спостерігач [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18) — з результату `next`, не з читання.

Рядки перед `p` — рядки команди очищення, рядки після засіяних — рядки команди компактизації з HANDOFF_MARKER; перевірку вони не зачіпають. Повернені рядки стоять у наступному читанні суцільним блоком з тими самими відбитками (навичка plugin-hooks, пункт 13), тож межа знаходиться тим самим пошуком, що й у CurrentRows.

### 02_25. ScrubCommandRows (вилучено)  {#SP_CTX_02_25}

Вилучено 2026-10-09: у терміналі рядки команди, яку запускає мод, і копії після межі компактизації пишуться у файл сесії повз подію додавання рядка, тож переписати мітку там неможливо (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 4, «Мітка в рядках команди»; навичка plugin-hooks, пункт 24). Рядки команди лишаються з міткою; MARKER і HANDOFF_MARKER — самопояснювальні тексти ([SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12)), а інваріант [SP_CTX_05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) перевіряє, що обробник бачить ту саму мітку як `instructions`.

### 02_26. HandleSeed  {#SP_CTX_02_26}

> **Criticality:** core

Purpose: гілка обробника компактизації для HANDOFF_MARKER ([SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07)): повернути засіяні рядки замість розмови щойно очищеної сесії.

Input: `messages: list<Row>` події компактизації; засів у пам'яті модуля (HandoffSeed або нічого); поточний ідентифікатор сесії.

Processing logic (pseudocode):
    FUNCTION HandleSeed(messages):
        s = pending seed; IF absent: RETURN skip "no handoff seed waiting"
        IF session id ≠ s.new: RETURN skip "this is not the session the handoff created"   # зокрема стара сесія; мод не пише в сесію, якої не створив
        IF messages hold a row with role assistant: RETURN skip "the new session already has a turn"
        s.taken = true
        RecordBoundary(s.rows)                       # SP_CTX_02_18, у сховище нової сесії; збій запису не зупиняє засіву
        RETURN { messages: s.rows }

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| SKIP_NO_SEED | засіву в пам'яті немає (команду ввела людина, модуль перезавантажено) | розмова не змінюється |
| SKIP_NOT_CLEARED | поточна сесія — не `s.new` (стара або інша, яку відкрила людина) | розмова не змінюється, мод нічого в неї не пише; RunHandoff — AfterClear або SESSION_CHANGED |
| SKIP_TURN_STARTED | у новій сесії вже є рядок агента | розмова не змінюється; RunHandoff не очищає сесію вдруге |
| SKIP_SEED_FAILED | обробник впав | `skip` одразу ([SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07)); RunHandoff — AfterClear |

Обробник не читає і не пише черги: засів не стосується черги нової сесії. Після очищення вхід компактизації — лише рядки команди `/clear` (спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md), Entry 2), тож повернений список заміняє їх, а відновлення нової сесії бачить саме засіяні рядки: перед межею у файлі сесії немає нічого, крім команди очищення ([C_CTX_DEC_05](./context_editor.core.concept.md#C_CTX_DEC_05) тут не діє).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §02 Contracts 02_19–02_26 перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.handoff.sp.md](./context_editor.handoff.sp.md), якорі без змін |
| 2026-10-11 | PL_AUD_CTX фази 3–4 (CF-5, CF-6): блок-нагадування в першому повідомленні API-подання — за префіксом `<system-reminder` (REMINDER_PREFIX), зокрема з атрибутами (02_22); HandedOff скидає вибори пакета старої черги через KeepOtherSteps, звіт — AppendReport (02_21) |
| 2026-10-11 | PL_AUD_CTX фаза 5 (CF-8): документ передачі відкриває DOCUMENT_FRAME (DocumentText), текст продовження агента — за рамкою HANDOFF_RESUME_FRAME, DEFAULT_RESUME — з префіксом мода (Deliver, DocumentWay, AfterClear у 02_21; SP_CTX_DEC_17) |
| 2026-10-11 | PL_AUD_CTX фаза 6a (CF-41): після `/clear` HandedOff і Deliver документа — кроки HandDocument, спільного для DocumentWay і AfterClear: збій кроку — спливне повідомлення, наступний крок іде далі, результат `document`; збій Deliver пише копію тексту в `<old storage>/<id>/document.txt` і називає її; крок `handed` AfterClear перейменовано на HandedOff; помилки DOCUMENT_NOT_DELIVERED, HANDED_OFF_FAILED (02_21) |
| 2026-10-11 | PL_AUD_CTX фаза 6a, рев'ю: KeepDocument — окрема функція; відхилений хостом промпт документа теж пише копію і називає її (Deliver `refused`); AfterClear з ходом у новій сесії (TURN_IN_NEW) копіює документ агента і називає копію в повідомленні про збій; DOCUMENT_NOT_DELIVERED розширено (02_21) |
| 2026-10-11 | PL_AUD_CTX фаза 10 (аудит коду, CF-19): 02_21 — розбір переліку тек засіву (лише назви з цифр) — ParseSeedNames (`hooks/handoff.ts`) з тестом; опис `context_handoff` і команди `/handoff` — у `hooks/tools.ts` (CF-20). Без зміни поведінки |
| 2026-10-11 | PL_AUD_CTX фаза 12 (аудит коду, CF-25): 02_20 — третій текст `/handoff cancel`: `a handoff is running; it cannot be cancelled`, коли цей екземпляр веде запит поточної сесії; звіт зняття `handoff cancelled (cancelled by the person).` |
| 2026-10-12 | Фаза 28: 02_21 — LogSeeded після засіяної сесії: рядок людини `handoff: applied N edit(s): …` ([SP_CTX_02_43](./context_editor.stages.sp.md#SP_CTX_02_43)); звіт засіву — OwnCallsText ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)) |
| 2026-10-12 | Дизайн фази 31 (CF-43): 02_21 — запит форку HANDOFF_PROMPT відкриває рамка автора (PREFIX), кінцеве речення лишає запит поза документом ([SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17), як DOCUMENT_FRAME) |
| 2026-10-12 | Фаза 31 реалізовано: HANDOFF_PROMPT — `modText(…)` з рамкою автора і кінцевим реченням (CF-43), заборона викликів лишається |
| 2026-10-12 | Дизайн фази 32 (спайк context_editor_resume, CF-46, CF-51): 02_22 — BuildSeed після `--resume` бере DropPulled з журналом входу старої сесії (порт HandoffIO `readLedger`) і ToolRefText для результатів ToolSearch; `repeated call id` лишається лише для нерозпізнаних повторів |
| 2026-10-12 | Код фази 32: 02_22 — у BuildSeed рядки без `handle`, тож DropPulled діє залишковим правилом; CarryNote і CheckPairs (правила пар CheckSeed) спільні з ремонтом |
