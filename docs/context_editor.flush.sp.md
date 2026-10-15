# Редактор контексту агента — Specification: Contracts — запуск застосування після ходу і доставка звіту

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_06, 02_08 специфікації [SP_CTX](./context_editor.sp.md): Flush (`/compact` мода після ходу, продовження) і DeliverReport. Читати, коли змінюєте кінець ходу чи доставку звіту.

## Contents

Розділи цього файлу:

- [02_06. Flush](#SP_CTX_02_06)
- [02_08. DeliverReport](#SP_CTX_02_08)

## 02. Contracts — Flush і доставка звіту

### 02_06. Flush  {#SP_CTX_02_06}

Purpose: після ходу основної розмови запустити застосування черги вбудованою командою компактизації і продовжити сесію ([C_CTX_DEC_02](./context_editor.core.concept.md#C_CTX_DEC_02), C), а після `/compact` людини — запустити хід стискання ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42)) замість промпту продовження. Промпт продовження несе й пораду про блок, що чекає стискання (WaitingAdvice, [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)): він оминає хуки мода, тож DeliverReport її не додасть. Мітка оптимізації з 2026-10-14 ходу оптимізації не запускає ([C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30)); до того — [C_CTX_DEC_17](./context_editor.methods.concept.md#C_CTX_DEC_17), A. Працює однаково в інтерактивному терміналі і в неінтерактивному хості з потоковим входом (stream-json: розширення VS Code, SDK streaming). До 2026-10-09 цей контракт виконувало окреме розширення `context-editor-trigger` (TriggerCompaction).

Логіка — чиста функція за портом FlushIO: читання й запис черги, читання реєстру тегів (лише назва блоку для промпту ходу оптимізації), запуск команди хоста, пауза, відправка промпту, рядок стану, калібрування перед застосуванням (порт `calibrate` — CalibrateBeforeApply у теці поточної сесії; межу CALIB_WAIT_MS тримає сам Flush через порт `sleep`, тож тайм-аут перевіряє модульний тест; фаза 29); зв'язування з хостом — у реєстрації мода. Порядок кінця ходу (преамбула 02: DetectOptimize → лічильник ходів реєстру → планування Flush; передача поруч) — чиста функція AfterTurn (`afterTurn` у `hooks/flush.ts`) за портом TurnEndIO, кожен крок якого — порт; збій кроку не зупиняє наступного (аудит PL_AUD_CTX, фаза 10, CF-19).

Input: подія завершення ходу (`agentId?`, `isAborted`). Стан у пам'яті модуля: `scheduled: bool` (false), `lastSubmittedReportId: int` (0), лічильник ходів (`turns`, `inTurn`, `lastTurnAborted`) з преамбули розділу 02; перезавантаження модуля скидає їх.

Processing logic (pseudocode):
    IsPlanned(now) = scheduled AND NOT (plannedAt present AND now − plannedAt > FLUSH_STALE)   # таймер, що не спрацював FLUSH_STALE, загублений (хост міг мовчки його відхилити)

    ON turn completed (main loop, not aborted), after DetectOptimize (SP_CTX_02_30):   # DetectOptimize уже зняв запобіжник ходу стискання; мітка черги не змінює
        IF NOT IsPlanned(now) AND storage ready AND Queue state = ok AND Queue.handoff absent
           AND (len(Queue.edits) > 0 OR Queue.optimize):
            Schedule()                                                        # таймер, відхилений одразу (виняток), нічого не лишає запланованим

    FUNCTION RequestFlush(session):                                           # SP_CTX_02_42: з хука command.run /compact людини — походження, на яке хід не чекає (як /handoff)
        IF IsPlanned(now): IF plannedAt present: compactSession = session; RETURN   # таймер ще не спрацював; Flush, що вже йде, свій compactSession спожив — новий не ставиться
        compactSession = session; Schedule()                                  # виняток таймера: compactSession = none; виняток іде до хука
                                                                              # уже запланований Flush того ходу обслужить і запит: другого таймера немає

    FUNCTION Schedule(): scheduled = true; plannedAt = now; turns0 = turns; AFTER FLUSH_DELAY: Flush(turns0)   # відкладена дія з turn.complete чи command.run — походження, яке хост ставить у чергу
        IF the timer throws: scheduled = false; plannedAt = none; rethrow

    FUNCTION Flush(turns0):
        plannedAt = none; session = compactSession; compactSession = none   # таймер спрацював
        clear the status line
        IF session present AND current session id ≠ session: toast "context-editor: /compact skipped: the session changed before the compression turn; run /compact again"; scheduled = false; RETURN   # COMPACT_SESSION_CHANGED (SP_CTX_02_42)
        after reading Queue: IF q.compactEndedAt present: on the queue chain: compactEndedAt = absent   # SP_CTX_02_42: Flush кінця ходу стискання виконується
        finally: scheduled = false; compactSession = none                     # жодна перевірка сесії не переживає цього Flush
        q = read Queue
        IF q state = ok AND q.optimize AND NOT q.compact: on the queue chain: optimize = false; q.optimize = false   # OPTIMIZE_LEGACY: запит мітки з файлу попередньої версії (SP_CTX_DEC_37)
        IF q state = unreadable OR q.handoff present OR (len(q.edits) == 0 AND NOT q.optimize): scheduled = false; RETURN   # правки з передачею застосує RunHandoff
        IF len(q.edits) > 0: race(CalibrateBeforeApply(), sleep(CALIB_WAIT_MS))     # фаза 29 (SP_CTX_02_34); виняток `calibrate`, зокрема синхронний, — як тайм-аут; пауза, що кинула виняток одразу, — без очікування (рев'ю): звіт і рядок людини — з відношенням цієї розмови; збій чи тайм-аут — далі без нього; до перевірки ходу, щоб ця пауза не ставила команду за новим ходом
        IF MovedSince(turns0):                                                # хід почався від планування: команду не ставити в чергу за ним
            scheduled = false
            IF NOT inTurn AND NOT lastTurnAborted: scheduled = true; turns0 = turns; AFTER FLUSH_DELAY: Flush(turns0)   # кінець того ходу вже минув і нового планування не дасть
            RETURN                                                            # хід іде — його кінець запланує Flush; хід перервано — черга чекає наступного завершеного ходу; optimize лишається для DeliverReport
        compacted = false
        IF len(q.edits) > 0:                                                  # правки агента і заміни з тегів, поставлені в ході, — один пакет
            id0 = q.reportId
            TRY run built-in command compact with args = MARKER               # одна спроба; команда чекає, доки сесія вільна
            CATCH err: status line "context-editor: compaction refused: <err text>; queued edits wait for the next turn" (with q.compact also a toast); scheduled = false; RETURN   # optimize лишається: порада піде з промптом людини
            q = read Queue; compacted = (q.reportId present AND q.reportId ≠ id0)   # обробник записав звіт цього застосування: skip без звіту чи покинута диспетчеризація — false
            IF compacted: LogApply(q.reportId)                              # SP_CTX_02_43: рядок людини ($.ui.log), до продовження; модель його не бачить
        IF q.optimize: Optimize(q, turns0, compacted); scheduled = false; RETURN
        Resume(q, turns0)
        scheduled = false                                                     # за будь-якого виходу, зокрема після винятку

    FUNCTION Resume(q, turns0):                                               # звичайне продовження після застосування
        IF q.report AND q.reportResume AND q.reportId != lastSubmittedReportId:
            IF MovedSince(turns0):                                            # хід почався між перевіркою і виконанням команди
                lastSubmittedReportId = q.reportId                            # продовження не надсилається; звіт лишається в черзі для DeliverReport з наступним промптом людини
            ELSE:
                text = q.report                                               # увесь недоставлений звіт
                reg = read TagRegistry; wait = (reg ok AND reg.waiting = marked AND reg.lastClosed present) ? WaitingAdvice(reg.lastClosed, len(reg.notes)) : none   # SP_CTX_02_29; збій побудови — none
                TRY entered = submit prompt (NoteOnce(text) + "\n\n" + ResumeText(q.reportPrompt) + (wait ? "\n\n" + wait : ""))   # NoteOnce: COMMAND_NOTE один раз (SP_CTX_01_05); RemoveDelivered — власний текст черги   # звіт — у самому тексті промпту: власні хуки prompt.submit мода для нього пропускаються (F1); текст продовження — з рамкою автора
                    IF entered (no drop):
                        lastSubmittedReportId = q.reportId
                        on the queue chain: RemoveDelivered(text)              # SP_CTX_02_08: увесь звіт або лише доставлений початок
                        IF wait: on the registry chain: IF reg.waiting = marked: waiting = advised; write   # AdviseWaiting: порівняння-і-запис; збій — порада піде ще раз
                CATCH (exception or result with drop): status line "context-editor: could not resume the session; send any prompt to continue"   # звіт лишається в черзі

    FUNCTION Optimize(q, turns0, compacted):                                  # промпт ходу стискання (/compact людини, q.compact) заміняє промпт продовження цього кінця ходу
        IF MovedSince(turns0): PersonFirst(q); RETURN                         # OPTIMIZE_PERSON
        reg = read TagRegistry                                                # лише кількість нотаток; рядків розмови Optimize не читає
        Say(text) = toast text                                                # SP_CTX_02_42: /compact людини — те, що людина мусить побачити в будь-якому хості
        TRY:
            report = (q.report present AND q.reportId != lastSubmittedReportId) ? q.report : none
            advice = CompactTurnText(notes)                                   # notes = len(reg.notes), 0 для unreadable; SP_CTX_02_42; хід стискання охоплює всю розмову, тож WaitingAdvice не додається
        CATCH err:                                                            # OPTIMIZE_BUILD_FAILED
            IF compacted AND q.reportResume: on the queue chain: optimize = false, compact = false; Say("context-editor: compression turn not started: <err>"); RETURN Resume(q, turns0)   # пакет просив продовження
            Say("context-editor: compression turn not started: <err>; the advice goes with your next prompt"); RETURN   # optimize лишається true для DeliverReport
        IF MovedSince(turns0): PersonFirst(q); RETURN                         # повторна перевірка перед заміною: людина могла почати хід за час команди
        swapped = on the queue chain: re-read Queue; IF optimize = true: optimize = false, optimizePrompted = true; IF len(edits) > 0: resume = false, resumeSet = false; write; RETURN true; ELSE RETURN false   # порівняння-і-запис; пакет, що лишився (компактизацію покинуто), продовження не зберігає (SP_CTX_DEC_16)
        IF NOT swapped: PersonFirst(q); RETURN                                # DeliverReport уже віддав пораду з промптом людини і зняв optimize: нічого не надсилати
        TRY entered = submit prompt ((report ? NoteOnce(report) + "\n\n" : "") + advice)   # власний текст продовження черги не пересилається: продовження вирішує агент у ході оптимізації
            IF entered (no drop):
                IF report: lastSubmittedReportId = q.reportId; on the queue chain: RemoveDelivered(report)
        CATCH (exception or result with drop):                                # OPTIMIZE_FAILED
            on the queue chain: optimizePrompted = false, optimize = true      # зворотна заміна одним записом
            Say("context-editor: could not start the compression turn; the advice goes with your next prompt")

    PersonFirst(q): IF q.report: lastSubmittedReportId = q.reportId           # звіт і порада — з промптом людини (DeliverReport); промпту немає

    ResumeText(p, frame = RESUME_FRAME) = (p = DEFAULT_RESUME) ? "context-editor: " + DEFAULT_RESUME : frame + p   # SP_CTX_DEC_17; RunHandoff передає HANDOFF_RESUME_FRAME (SP_CTX_02_21)

Автор тексту продовження ([SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17), аудит PL_AUD_CTX, CF-8). Промпт продовження мод надсилає з роллю `user`, а виклик `context_edit`, що поставив `resume_prompt`, прибирає DropOwnCalls ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)), тож без рамки текст агента виглядав би словами людини — і для моделі, і для того, хто читає транскрипт; інструкція з ін'єкції в прочитаному вмісті, переписана агентом у `resume_prompt`, стала б «проханням людини». Тому текст агента йде за рамкою RESUME_FRAME: `context-editor: the resume prompt you set before your edits applied: <text>`. Текст за замовчуванням (DEFAULT_RESUME) — власний текст мода, і він іде з префіксом мода без слів про агента: `context-editor: Continue the task from where you stopped.`. Рамку додає лише Flush у момент відправки; у черзі (`resumePrompt`, `reportPrompt`) і в результаті `context_edit` («The session then resumes by itself with: …») текст лишається таким, яким його дав агент. DeliverReport текст продовження не пересилає ніколи, а промпт ходу оптимізації — власний текст мода, тож рамка там не потрібна.

Чергу пишуть обробник компактизації ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)) і, після прийнятого промпту, RemoveDelivered самого Flush ([SP_CTX_02_08](#SP_CTX_02_08)) — обидва на ланцюжку черги. Хост ставить команду в чергу і виконує, коли сесія вільна, з `trigger: 'manual'` і `instructions = MARKER`, і викликає обробники всіх розширень, разом із самим модом ([C_CTX_01_02](./context_editor.concept.md#C_CTX_01_02)); рядки самої команди (`/compact <MARKER>` і позначка виконання) лишаються в розмові з міткою як є: у терміналі хост пише їх повз подію додавання рядка, тож сховати мітку неможливо (спайк context_editor_handoff_long, Entry 4, «Мітка в рядках команди»; навичка plugin-hooks, пункт 24), а текст мітки самопояснювальний ([SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)). Відмова хоста остаточна, тож повторів немає: черга лишається до наступного завершеного ходу. Хід, що почався від планування, означає, що людина активна. Перед командою Flush її не запускає: команда, поставлена в чергу за ходом, могла б пережити модуль (див. залишкове вікно в [SP_CTX_05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02)), а правки застосує наступний кінець ходу. Якщо хід почався вже після перевірки, Flush не перебиває людину промптом продовження, і звіт дійде з її наступним промптом. Звіт у промпт продовження вписує сам Flush: хост пропускає власні хуки `prompt.submit` плагіна для промптів, які той надсилає через `$.prompt.submit` («prompt.submit skipped: re-entry (the plugin's own code raised it)»; Verify фази 10, 2026-10-09, F1), тож DeliverReport ([SP_CTX_02_08](#SP_CTX_02_08)) до промпту продовження звіту не додасть. Звіт прибирається з черги лише після того, як промпт увійшов; відхилений промпт лишає звіт для наступного промпту людини. Запуск команди завершується після того, як обробник відповів, тож наступне читання черги бачить звіт цього застосування (черга записана до відповіді обробника); рядків розмови Flush не читає ні для продовження, ні для промпту ходу оптимізації, тож запізнення рядків у неінтерактивному хості (F2, [SP_CTX_02_24](./context_editor.handoff.sp.md#SP_CTX_02_24)) його не стосується: промпт ходу оптимізації не називає індексів, а перегляд, який агент робить у ході оптимізації перед правками за індексами, читає поточну розмову ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) пізніше, коли рядки вже стоять у читанні; це очікування обов'язково перевіряє сценарій «Завершення команди після обробника» в обох хостах ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)). Відповідь `skip` обробника не є відмовою хоста: причина видна людині рядком «Not compacted».

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| HOST_REFUSED | хост відхилив команду (виняток з текстом причини) | черга лишається; рядок стану показує текст відмови; наступна спроба — після наступного завершеного ходу |
| PERSON_MOVED | хід почався від планування, до запуску команди | команда не запускається; Flush заплановано знову кінцем того ходу або одразу, якщо він уже скінчився не перерваним; після перерваного ходу черга чекає наступного завершеного ходу |
| PERSON_ACTIVE | хід почався між перевіркою і виконанням команди | продовження не надсилається; звіт — з наступним промптом людини |
| RESUME_FAILED | відправка промпту продовження відхилена (виняток або результат з `drop`) | `lastSubmittedReportId` не змінюється; звіт лишається в черзі; рядок стану «could not resume the session; send any prompt to continue»; звіт дійде з наступним промптом людини (DeliverReport) |
| QUEUE_UNREADABLE | Queue `unreadable` | команда не запускається, нічого не пишеться; файл перенесе наступний `context_edit` ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)) |
| FLUSH_PASSED_OVER | вердикт `passed` на запуску ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)) | команди немає; `scheduled = false`; черга як є |
| OPTIMIZE_PERSON | є `optimize`, а хід людини почався до відправки промпту ходу оптимізації (до команди або після неї) або DeliverReport уже зняв `optimize` (порівняння-і-запис не вдалося) | ходу оптимізації немає, нічого не надіслано; `optimize` лишається для DeliverReport або вже доставлений ним разом зі звітом, назвою блоку й порадою ([SP_CTX_02_08](#SP_CTX_02_08)) |
| OPTIMIZE_BUILD_FAILED | CompactTurnText кинув виняток до заміни | пакет просив продовження (`compacted AND reportResume`) — `optimize = false` і звичайне продовження (Resume); інакше — `optimize` лишається `true`, промпту немає, COMPACT_ADVICE піде з промптом людини (DeliverReport); спливне повідомлення |
| OPTIMIZE_LEGACY | `optimize` без `compact` (запит мітки з файлу попередньої версії) | `optimize = false` без ходу і без поради; далі як без запиту ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)). OPTIMIZE_NO_BLOCK вилучено 2026-10-14: хід стискання блоку не потребує |
| WAIT_ADVICE_LOST | порада про блок, що чекає, увійшла з промптом продовження, а запис `advised` не вдався | порада піде ще раз з наступним промптом (щонайменше один раз) |
| OPTIMIZE_FAILED | промпт ходу оптимізації відхилено (виняток або результат з `drop`) | `optimizePrompted` знято, `optimize` повернуто одним записом; звіт лишається в черзі; рядок стану; звіт і порада підуть з наступним промптом людини |

Хід оптимізації з 2026-10-14 буває лише ходом стискання `/compact` людини ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42), [SP_CTX_04_06](./context_editor.states.sp.md#SP_CTX_04_06)): мітка оптимізації лише позначає блок, що чекає стискання, і черги не змінює ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30), [C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30)). Тож після ходу з міткою Flush робить те саме, що й після будь-якого ходу: застосовує непорожню чергу і, якщо пакет просив, надсилає промпт продовження. Цей промпт хуків мода не проходить (F1), тому Flush сам додає до нього WaitingAdvice ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)), якщо блок ще `marked`, і після входу промпту ставить `advised` порівнянням-і-записом на ланцюжку реєстру: агент, що продовжує роботу після власного пакета, бачить, що блок чекає, і на переході до наступного етапу стискає його. Рядків розмови Flush для поради не читає: вона називає блок без індексів, як і раніше ([SP_CTX_DEC_15](./context_editor.decisions-01.sp.md#SP_CTX_DEC_15)). Між першою перевіркою `MovedSince` і відправкою промпту ходу стискання минає команда компактизації; за цей час промпт людини може пройти DeliverReport, віддати звіт і COMPACT_ADVICE і зняти `optimize`. Тому Optimize перевіряє `MovedSince` ще раз безпосередньо перед заміною і робить саму заміну (`optimize` → `optimizePrompted`) порівнянням-і-записом на ланцюжку черги: `optimize` уже `false` — нічого не надсилається. Залишкове вікно — промпт людини між заміною і відправкою: промпт ходу стискання стає в чергу за ходом людини, а DeliverReport знімає `optimizePrompted` (між ходами) — прийнятий ризик. Запобіжник петлі: мітку у відповіді ходу стискання DetectOptimize ігнорує за `optimizePrompted` і знімає прапорець. До 2026-10-14 цей абзац описував хід оптимізації за міткою (OptimizeText, заміни з тегів на кінці ходу з міткою, дві компактизації); історія — Changelog.

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): AfterTurn першим кроком виконує NoteTurn Capabilities ([SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53)), ще до DetectOptimize. При `compact = passed` Flush не планується, а запланований раніше не запускає команди (FLUSH_PASSED_OVER); при `unknown` під час зонда Flush чекає його не довше PROBE_WAIT_MS ([SP_CTX_02_56](./context_editor.bypass.sp.md#SP_CTX_02_56)): черга лишається для брифу `/compact` людини ([SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55)). Ремонт планується з кінця першого ходу процесу ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)).

### 02_08. DeliverReport  {#SP_CTX_02_08}

Purpose: довести звіт до агента рівно один раз з промптом, який мод не надсилав сам; тим самим промптом довести пораду про блок, що чекає стискання (WaitingAdvice, [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)), і пораду запиту `/compact`, якого не вдалося виконати ходом стискання, інструкцію на початку сесії ([SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) і між ходами — пропозицію каналу ходу м'якого нагадування ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37), фаза 23).

Processing logic (pseudocode):
    ON prompt submitted (main conversation, passes the mod's hooks):
        context = []
        IF storage ready (TagRegistry state ok or missing): context += Intro(reg)   # SP_CTX_02_27: introduced = false — GuideText() ?? INTRO_TEXT; reintroduce = true — INTRO_TEXT; інакше нічого
        q = read Queue
        IF q.report: context += NoteOnce(q.report)                          # SP_CTX_01_05: COMMAND_NOTE один раз на повідомлення
        IF q.optimize AND q.compact: context += COMPACT_ADVICE              # SP_CTX_02_42: /compact людини, хід стискання не почався (HOST_REFUSED, PERSON_MOVED, OPTIMIZE_PERSON, OPTIMIZE_FAILED, OPTIMIZE_BUILD_FAILED, перезавантаження)
        # optimize без compact — запит мітки з файлу попередньої версії (OPTIMIZE_LEGACY): поради немає, знімається після входу
        waitAdded = false
        reg = read TagRegistry (now, at hook time)
        IF NOT (q.optimize AND q.compact) AND reg readable AND reg.waiting = marked AND reg.lastClosed present:   # SP_CTX_DEC_37: перший промпт після мітки
            TRY context += WaitingAdvice(reg.lastClosed, notes = len(reg.notes)); waitAdded = true   # SP_CTX_02_29: без індексів, розміру і кандидатів; рядків не читає
            CATCH: advice skipped                                           # ADVICE_FAILED: стан лишається marked
        IF NOT inTurn AND NOT q.optimize AND NOT waitAdded:                 # фаза 23: порада вже каже, що стискати
            line = Bounded(TurnSuggestion(), HINT_WAIT)                     # SP_CTX_02_37; стан пропозиції записано до входу промпту
            IF line: context += line                                        # останньою; збій — промпт іде без неї
        tookOver = q.optimizePrompted AND NOT inTurn                        # промпт людини між ходами: людина взяла хід, запобіжник петлі більше не потрібен
        entered = next(prompt with context appended as hidden context)
        IF entered (no drop):
            IF an intro was added: on the registry chain: introduced = true, reintroduce = false
            on the queue chain: IF q.report was added: RemoveDelivered(q.report); IF q.optimize: optimize = false, compact = false; IF tookOver: optimizePrompted = false, compact = false
            IF waitAdded: on the registry chain: IF waiting = marked: waiting = advised   # AdviseWaiting; збій — порада піде ще раз (WAIT_ADVICE_LOST)
        RETURN entered

Logic: при кожному промпті основної розмови, що проходить хуки мода (промпт людини або іншого розширення), мод, якщо `Queue.report` присутній, додає `report` як прихований контекст промпту і передає промпт далі. Лише коли промпт увійшов (результат без `drop`), мод на послідовному ланцюжку черги виконує `RemoveDelivered(text)`: видаляє з `report` саме доставлений текст — увесь звіт, якщо він не змінився (тоді також `reportId`, `reportResume = false`, `reportPrompt = DEFAULT_RESUME`), або лише доставлений початок, якщо тим часом дописано новий звіт. Той самий крок виконує Flush після свого промпту продовження ([SP_CTX_02_06](#SP_CTX_02_06)). Промпт, відхилений нижчим обробником, лишає звіт у черзі для наступного промпту.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| PROMPT_DROPPED | нижчий обробник відхилив промпт | звіт лишається в черзі |
| DELIVERY_FAILED | збій читання або запису черги | промпт іде без звіту або звіт лишається; доставка повториться з наступним промптом — тобто при збої запису після вже прийнятого промпту звіт буде доставлено вдруге (щонайменше один раз, не рівно один) |
| ADVICE_FAILED | побудова WaitingAdvice кинула виняток | промпт іде без поради (зі звітом, якщо він є); `waiting` лишається `marked` — повтор з наступним промптом |
| WAIT_ADVICE_LOST | порада увійшла, а запис `advised` не вдався | порада піде ще раз з наступним промптом (щонайменше один раз). ADVICE_NO_BLOCK вилучено 2026-10-14: `waiting` без `lastClosed` реєстр не приймає |
| SUGGESTION_LOST | нижчий обробник відхилив промпт, що ніс пропозицію | її стан уже записано: пропозиція не повторюється до нової серії позначених виводів (фаза 23) |
| INTRO_NOT_RECORDED | `introduced = true` не записалось після прийнятого промпту | інструкцію буде додано й до наступного промпту (щонайменше один раз); реєстр `unreadable` — інструкції немає взагалі, бо її доставку нема де записати |

Промпти, які мод надсилає сам (`$.prompt.submit`: продовження Flush, хід стискання, Deliver передачі), цих хуків не проходять — хост пропускає для них власні хуки `prompt.submit` плагіна (Verify фази 10, 2026-10-09, F1). Тому такі промпти несуть звіт у власному тексті, а DeliverReport служить лише промптам людини (зокрема коли продовження вимкнено або людина вже почала хід). Збій кроку не впливає на промпт.

Пропозиція з промптом людини (фаза 23, [SP_CTX_DEC_23](./context_editor.decisions-21.sp.md#SP_CTX_DEC_23)). Між ходами (`inTurn = false`) і без `optimize` DeliverReport питає TurnSuggestion ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37)) не довше HINT_WAIT і додає її рядок останнім: кінець ходу — природна межа пакета, тож агент бачить пропозицію («close stage X and summarize …? It frees …») на початку наступного ходу, разом із завданням людини, і вирішує сам. Повідомлення людини посеред ходу (`inTurn = true`) пропозиції не несе: хід ще триває. Промпти, які мод надсилає сам, хука не проходять, тож пропозиція не приходить ні з продовженням, ні з ходом оптимізації. На відміну від звіту, стан пропозиції записується до входу промпту (претензія порівнянням-і-записом, як у каналу розміру): відхилений промпт її губить (SUGGESTION_LOST) — це м'який сигнал, а повтор з кожним промптом був би шумом. Рядків розмови й розбивки канал ходу не читає, доки від минулої пропозиції не набралося HINT_RUN позначених виводів, тож звичайний промпт людини чекає лише двох малих читань реєстрів.

Порада з промптом людини ([C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30), [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)). Мітка оптимізації позначає блок `lastClosed` як такий, що чекає стискання (`waiting = marked`, [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30)). Перший промпт, що проходить хук мода (людини чи іншого розширення), несе WaitingAdvice — назву блоку, пораду стиснути його, якщо промпт переходить до наступного етапу, і лишити, якщо продовжує етап, ListHint і STAGE_ADVICE ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)); індексів, розміру і кандидатів порада не має ([SP_CTX_DEC_15](./context_editor.decisions-01.sp.md#SP_CTX_DEC_15)). Коли промпт увійшов, стан стає `advised`, і наступні промпти поради не несуть; блок і далі чекає, доки агент не відкриє чи не закриє етап або не поставить правку ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)). Промпт продовження Flush хука не проходить і несе пораду сам ([SP_CTX_02_06](#SP_CTX_02_06)). Нічого в чергу DeliverReport не ставить: заміни з тегів `disposable` ставить кінець очікування. Для поради DeliverReport читає лише реєстр, рядків розмови не читає. Коли є запит `/compact` (`optimize` з `compact`), промпт несе COMPACT_ADVICE замість WaitingAdvice: стискання всієї розмови охоплює й блок, а перша ж правка агента зніме очікування. `optimizePrompted` знімає промпт людини, що проходить хук між ходами (`inTurn = false`, лічильник ходів преамбули 02): людина взяла хід, і мітка в наступній відповіді агента знову діє. Повідомлення людини посеред ходу стискання вливається в цей хід і проходить хук при `inTurn = true`, тож прапорця не чіпає; після перезавантаження модуля `inTurn` починається з `false`, і таке повідомлення зняло б прапорець — тоді мітка у відповіді ходу стискання позначила б блок (прийнято: петлі немає, мітка ходу не запускає). До 2026-10-14 тут була PersonAdvice — запасний шлях ходу оптимізації за міткою.

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): при `passed` WaitingAdvice не додається (стан `marked` лишається) і підказки немає; звіт і COMPACT_ADVICE — як завжди.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділи перенесено дослівно з [context_editor.edits.sp.md](./context_editor.edits.sp.md): поділ файлу за модулями, якорі ті самі (structural-event) |
