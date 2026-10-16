# Редактор контексту агента — Specification: Contracts: host capabilities

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-14
> **Updated:** 2026-10-14
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_53–02_57 специфікації [SP_CTX](./context_editor.sp.md): можливості хоста, від яких залежить мод, їх перевірка процесом-зондом раз на версію хоста і живими ознаками, і що мод вимикає, коли хост пропускає його хуки ([C_CTX_03_11](./context_editor.core.concept.md#C_CTX_03_11), [C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31), [SP_CTX_DEC_38](./context_editor.decisions-21.sp.md#SP_CTX_DEC_38); спайк [context_editor_probe](./context_editor_probe.spike.md)). Читати перед зміною `hooks/capabilities.ts`, хуків `prompt.attachment`, `session.start`, `turn.complete`, `command.run`, `session.compact` чи перевірок перед компактизацією мода.

## Contents

- [02_53. Capabilities](#SP_CTX_02_53)
- [02_54. Дії мода, коли можливість пропущено](#SP_CTX_02_54)
- [02_55. CompactBrief і ObservePassedCompact](#SP_CTX_02_55)
- [02_56. RunProbe](#SP_CTX_02_56)
- [02_57. ProbeMode](#SP_CTX_02_57)

## 02. Contracts — можливості хоста

### 02_53. Capabilities  {#SP_CTX_02_53}

> **Criticality:** core

Purpose: для кожної можливості хоста, від якої залежить мод, знати, чи вона доходить до мода: `reached`, `passed` або `unknown` ([C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31), (а) D, рішення розробника: перевірка раз на версію, результат за версією, живі ознаки переважають). Можливості:

| Можливість | Що перевіряє | Від неї залежать |
|------------|--------------|------------------|
| `compact` | хук `session.compact` мода отримує власну компактизацію мода (`$.command.run` з міткою) | застосування черги (Flush), передача, ремонт, хід стискання `/compact` людини |
| `attachments` | хук `prompt.attachment` мода викликається | відповіді про застарілі копії інструкцій і переліки навичок ([SP_CTX_02_39](./context_editor.hostattach.sp.md#SP_CTX_02_39)) |

Логіка — чисті функції `hooks/capabilities.ts` (Verdict, Merge, NoteAttachment, NoteTurn, NoteOwnCompaction, NoteCommandUnseen, PassedText) за портом CapabilityIO; стан — пам'ять модуля `Capabilities` ([SP_CTX_01_25](./context_editor.records.sp.md#SP_CTX_01_25)), один на процес хоста (хуки пропускає процес, а не сесія), і файл кешу `capabilities.json` ([SP_CTX_01_26](./context_editor.records.sp.md#SP_CTX_01_26)). Зв'язування в `register.ts`: хук `prompt.attachment` без матчера (один на модуль; лише рахує і передає `next(e)` без змін, відповіді за типами не змінюються), крок NoteTurn першим у AfterTurn ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)), версія хоста — `$.session.version()` один раз на екземпляр (валідатор вимагає виклику на місці).

Джерела вердикту, від сильнішого: живі ознаки цього процесу (`live`) → результат зонда цього процесу (`probe`) → кеш за версією хоста (`cache`). Сильніше джерело переважає слабше для тієї самої можливості.

    Verdict(c, cap) = c.live[cap] ?? c.probe[cap] ?? c.cache[cap] ?? unknown

    NoteAttachment(c) = c with attachments + 1, live.attachments = reached     # будь-який тип, будь-яке походження

    NoteTurn(c) =                                                              # кінець ходу основної розмови, не перерваного
        c with mainTurns + 1, live.attachments = c.attachments > 0 ? reached : passed   # хост питає вкладення на початку кожного промпту; навичка мода дає перелік навичок у кожній сесії

    NoteOwnCompaction(c) = c with live.compact = reached, ownSeen + 1         # обробник session.compact мода побачив власну мітку: MARKER, HANDOFF_MARKER, REPAIR_MARKER

    NotePassCompaction(c) = c with live.compact = reached, passSeen + 1       # обробник побачив іншу компактизацію основної розмови (не precompute): хук викликається

    NoteCommandUnseen(c) = c with live.compact = passed                       # $.command.run компактизації мода повернувся без винятку, а лічильник ownSeen (NoteOwnCompaction) не зріс: хост віддав мітку іншому (справжній підсумок уже стався — живий сигнал лише після факту)

    Merge(c) =                                                                 # після кожної зміни live або probe
        FOR cap: IF c.live[cap] present AND c.cache[cap] present AND c.live[cap] ≠ c.cache[cap]:
            Invalidate(version)                                               # кеш суперечить живому: мод перевели в керований плагін, змінили налаштування організації; стара відповідь для compact теж під сумнівом
            c.cache = {}; ScheduleProbe()                                      # SP_CTX_02_56: новий зонд у цьому процесі (один на процес)
        Store(version, { compact: Verdict(c, compact), attachments: Verdict(c, attachments) }) when any of them changed and is not unknown

    ON turn completed (main loop, not aborted), first step of AfterTurn:
        was = passed caps; c = NoteTurn(c); Merge(c)
        IF some passed cap is not in c.noticed: c.noticed += passed caps; $.ui.log(PassedText(passed caps, queued))   # C_CTX_DEC_31 (в) A: рядок людині раз на процес для кожної можливості (attachments на першому ході, compact — коли зонд закінчився пізніше)

    PassedText(caps, queued) = "context-editor: this host passes over the mod's " + Names(caps) + " hooks (seen with the built-in cc-plugin-sec-default on host 2.1.299+ with a Team or Enterprise account or managed settings)."
        + (compact in caps ? " The mod does not compress: context_edit, context_handoff and /handoff refuse, and /compact runs the host's summary with the mod's brief." + (queued > 0 ? " " + queued + " queued edit(s) stay; /compact passes them on as preferred summaries." : "") : "")
        + (attachments in caps ? " Stale copies of instruction files stay in each request." : "")
        + " To fix it, run the mod as a managed plugin (the ClaudeMods README, section \"Managed plugin\")."
        # Names: compact → "compaction", attachments → "attachment"; обидві — "compaction and attachment"

`unknown` мод вважає робочим ([C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31), (д) C, рішення розробника «Завжди дозволяти»), але дія, що запускає компактизацію мода (Flush, RunHandoff, RunRepair, маршрут `/compact` людини), спершу чекає зонда, що йде в цьому процесі, не довше PROBE_WAIT_MS ([SP_CTX_02_56](#SP_CTX_02_56)). Наступна сесія тієї самої версії хоста має вердикт з кешу від першого промпту. Помилки: `$.session.version()` кидає — кешу і зонда немає (CAP_NO_VERSION), вердикт лише живий; `$.ui.log` кидає — `noticed` лишається `true`.

### 02_54. Дії мода, коли можливість пропущено  {#SP_CTX_02_54}

> **Criticality:** core

Purpose: при `Verdict(compact) = passed` мод не запускає жодної власної компактизації: її мітку хост віддав би справжньому підсумку ([C_CTX_DEC_09](./context_editor.core.concept.md#C_CTX_DEC_09)). Перевірка — безпосередньо перед дією; `unknown` і `reached` дію дозволяють. При `Verdict(attachments) = passed` мод нічого не вимикає: його хуки вкладень і так не викликаються; лише PassedText каже про це людині.

| Місце | Дія при `compact = passed` | Текст |
|-------|------------------|-------|
| `context_edit` ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)) | відмова до читання черги; нічого не пишеться | DENIED_PASSED_OVER: `this host passes over the mod's compaction hook, so queued edits would become the host's real summary; nothing was queued. Keep working; the person can run the mod as a managed plugin, or run /compact for the host's summary with the mod's brief.` |
| `context_handoff` ([SP_CTX_02_19](./context_editor.handoff.sp.md#SP_CTX_02_19)) | відмова; запиту немає | DENIED_PASSED_OVER: `this host passes over the mod's compaction hook, so the handoff cannot seed a new session; nothing was queued.` |
| `/handoff` ([SP_CTX_02_20](./context_editor.handoff.sp.md#SP_CTX_02_20)) | відмова; `cancel` працює як завжди | `handoff is off: this host passes over the mod's compaction hook (see the ClaudeMods README, section "Managed plugin")` |
| RunHandoff ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) | запит, поставлений до вердикту, не запускається: стан `done` зі звітом HANDOFF_PASSED_OVER | `context-editor: handoff not run: this host passes over the mod's compaction hook.` |
| Flush ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)) | не планується; запланований раніше — команди немає (FLUSH_PASSED_OVER), правки лишаються; запит ходу стискання, записаний до вердикту, знімається (його хід зустрів би лише відмови) | рядка немає: людина вже бачила PassedText |
| RunRepair ([SP_CTX_02_46](./context_editor.resume.sp.md#SP_CTX_02_46)) | команди немає | — |
| `/compact` людини ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42)) | маршрут `brief`: підсумок хоста з CompactBrief ([SP_CTX_02_55](#SP_CTX_02_55)) | — |
| DeliverReport ([SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)), підказка ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37)) | WaitingAdvice і `[context-editor: suggestion]` не додаються: вони радять інструмент, який відмовить | — |
| BlockReport ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)) | замість STAGE_ADVICE — PASSED_ADVICE; речення про заміни з тегів `disposable` каже, що їх несе бриф `/compact`, а не застосування | `Compression is off on this host (context_edit refuses: the host passes over the mod's compaction hook); keep working.` |

Інструменти перегляду, теги, етапи, нотатки й мітка працюють як завжди. Ремонт після відновлення планується з кінця першого ходу основної розмови в процесі, а не з `session.start`: тоді результат зонда чи кешу вже є, а ремонт на вердикті `unknown` першим запустив би справжній підсумок ([C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31), (д)). Ремонт до першого промпту (stream-json) перестає діяти: перший хід після відновлення йде з дублікатами завантажувача, як уже було в терміналі, коли людина встигала надіслати промпт.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_PASSED_OVER | `context_edit`, `context_handoff` чи `/handoff` при `compact = passed` | текст з таблиці; нічого не пишеться |
| HANDOFF_PASSED_OVER | запит передачі з черги при `compact = passed` на запуску | запит знято зі звітом; команди немає |
| FLUSH_PASSED_OVER | запланований Flush при `compact = passed` | команди немає; `scheduled = false`; черга як є |

### 02_55. CompactBrief і ObservePassedCompact  {#SP_CTX_02_55}

> **Criticality:** normal

Purpose: голий `/compact` людини при `compact = passed` — підсумок хоста за інструкціями мода ([C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31), (г) C, рішення розробника «Ok»), і після нього — те, що робив би спостерігач іншої компактизації ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)), якого хост мода не викликає ([SP_CTX_DEC_38](./context_editor.decisions-21.sp.md#SP_CTX_DEC_38) (б)).

Логіка — чисті функції `hooks/capabilities.ts` (CompactBrief, ObservePassedCompact) за портом PassedCompactIO; зв'язування — хук `command.run` на `compact` у `register.ts` (той самий, що PersonCompact): маршрут `agent` при `compact = passed` стає `brief`.

Input: рядки основної розмови (CurrentRows), реєстр тегів, черга, нотатки — кожне одним читанням; нечитабельне — пропускається.

    CompactBrief(rows, reg, q, notes) =                                        # ≤ BRIEF_MAX символів
        lines = [BRIEF_HEAD]
        state = text of the row tagged `state` in reg (rows)
        IF state: lines += "Keep this task state verbatim:\n" + state
        FOR e IN q.edits (queue order):
            collapse / summarize  → "Use this summary for " + Targets(e) + ":\n" + e.summary
            rewrite               → "Use this text for " + Targets(e) + ":\n" + e.text
            drop                  → "Leave out " + Targets(e) + "."
            describe              → "For the media in " + Targets(e) + " keep this description:\n" + e.description
        pins = rows of targets tagged `pin` in reg (not the person's prompts: those stay anyway)
        IF pins: lines += "Keep verbatim: " + join(Preview(r) for r in pins, "; ")
        IF notes: lines += "The agent's notes: " + join(n.text + " (on " + Preview(target) + ")" for n in notes, "; ")
        lines += BRIEF_RECORDS
        RETURN Fit(lines, BRIEF_MAX)                                            # BRIEF_HEAD і BRIEF_RECORDS завжди; пункти між ними цілими в цьому порядку; що не влізло — рядок "(<n> more item(s) left out)"

    Targets(e) = for a call or result: CallLabel of the call (SP_CTX_01_12); for a row: "the row \"" + Preview(row) + "\""; for a range: "the rows from \"" + Preview(first) + "\" to \"" + Preview(last) + "\""   # Preview = oneLine(text, 70); ціль, якої в рядках немає, — пункт пропускається

    ON command.run compact (e), route = brief (CompactRoute = agent AND Verdict(compact) = passed):
        brief = CompactBrief(...) ; on failure: brief = BRIEF_HEAD             # BRIEF_FAILED: команда все одно йде з коротким брифом
        before = main conversation rows (one read)
        result = await next(e with args = brief)                               # підсумок хоста; хук на нього чекає
        IF the host compacted (next resolved: a failed summary rejects it, and the hook's .catch runs) AND storage ready:
            ObservePassedCompact(before, rows now)
            IF it found no summary in the rows now:                            # OBSERVE_LATER: хост 2.1.299 показує підсумок у читанні не одразу після next
                remember (before, session, passSeen)                           # новий /compact з брифом спершу забуває попереднє
    ON prompt.submit (before the report), else ON turn.start:                  # до вступу після компактизації і до того, як модель прочитає рядки
        IF remembered AND same session AND passSeen unchanged: ObservePassedCompact(before, rows now)
        forget

    ObservePassedCompact(before, after) =                                      # SP_CTX_02_18 без події компактизації
        added = after rows from len(before) on when after starts with before (by fingerprint), else after
        IF no row of added is the host's summary (a user row opening with SUMMARY_OPENER): RETURN   # не компактизація (доставка, відмова хоста)
        copies = added when after starts with before; otherwise none
        IF the handler saw a compaction meanwhile (passSeen moved): RETURN     # спостерігач обробника вже все зробив
        IF copies: RecordBoundary(boundaryOf(copies, hostId))                  # у цьому процесі читання — оригінали + копії
        tags: pruneDeadTags(reg, before, copies ?? after); lastApply dropped; introduced → reintroduce   # одна зміна реєстру
        queue: edits = [] (their summaries went into the brief); keepCache, resume, resumePrompt cleared   # QUEUE_BRIEFED
        attachments: the answers go (SP_CTX_02_41)

Коли читання після компактизації не продовжує читання до неї, межа не пишеться (OBSERVE_NO_PREFIX): у цьому процесі перелік показує й рядки до підсумку, до наступного процесу; припущення перевіряє живий сценарій «/compact при обході» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)). Автоматична компактизація хоста при `compact = passed` не видна моду зовсім: та сама межа процесу, прийняте обмеження ([SP_CTX_DEC_38](./context_editor.decisions-21.sp.md#SP_CTX_DEC_38) (б)). `/compact <інструкції>` людини і `/compact host` ідуть до хоста без змін і без ObservePassedCompact.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| BRIEF_FAILED | CompactBrief кинув виняток | команда йде з BRIEF_HEAD; журнал налагодження |
| OBSERVE_NO_PREFIX | рядки після компактизації не починаються рядками до неї | межа не пишеться; теги чистяться за `after`; черга очищається |
| QUEUE_BRIEFED | ObservePassedCompact очистив чергу | правки перейшли в бриф; рядок людині не потрібен |

### 02_56. RunProbe  {#SP_CTX_02_56}

> **Criticality:** core

Purpose: раз на версію хоста перевірити можливості в окремому процесі, без запиту моделі і без справжнього підсумку в розмові людини (спайк [context_editor_probe](./context_editor_probe.spike.md): ~4 с, $0). Логіка — чисті функції `hooks/capabilities.ts` (ScheduleProbe, RunProbe, ProbeArgs, ProbeInput, ParseProbe) за портом ProbeIO (`$.process.run`, `$.fs`, `$.clock.after`).

    ON session start (main conversation, not ProbeMode):
        c.cache = Load(version)                                                # SP_CTX_01_26; немає чи нечитабельний — {}
        IF NeedsProbe(c.cache entry for version): ScheduleProbe()               # немає запису, немає compact, або запис не від зонда (лише живі ознаки: збій зонда, NoteCommandUnseen) — підтвердити зондом

    ScheduleProbe():                                                           # один зонд на процес
        IF c.probeState ≠ none: RETURN
        c.probeState = planned; $.clock.after(PROBE_DELAY_MS, RunProbe)        # не в session.start: запуск тримав би старт сесії

    RunProbe():
        c.probeState = running
        exe = HostBinary(output of $.process.run(['sh','-c','readlink /proc/$PPID/exe']))   # $PPID оболонки — сам хост; у VS Code бінарник у PATH інший; ім'я без "claude" і не версія (node) чи збій → "claude"
        tmp = output of $.process.run(['mktemp','-d']) trimmed
        out = $.process.run(ProbeArgs(exe), { cwd: tmp, env: PROBE_ENV, stdin: ProbeInput(), timeoutMs: PROBE_TIMEOUT_MS })
        r = ParseProbe(out.stdout, read tmp/PROBE_FILE)
        IF r.version ≠ version: r = none                                       # PROBE_OTHER_HOST: зонд запустив інший бінарник
        c.probe = r ?? {}; c.probeState = done; Merge(c)
        finally: $.process.run(['rm','-rf', tmp, ProjectDir(tmp)])             # ProjectDir — тека проєкту хоста для tmp: <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<tmp з кожним не [A-Za-z0-9] → '-'>

    ProbeArgs(exe) = [exe, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--model', 'haiku', '--plugin-dir', $.plugin.root]   # SP_CTX_DEC_38 (а): керований мод копію з --plugin-dir ігнорує (спайк Q4)
    ProbeInput() = two stream-json user messages: "hi", then "/compact " + PROBE_MARKER   # компактизація потребує хоч одного ходу; хід закінчується одразу (недосяжний API)
    PROBE_ENV = { CONTEXT_EDITOR_PROBE: "1", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", CLAUDE_CODE_MAX_RETRIES: "0", DISABLE_AUTOUPDATER: "1" }   # SP_CTX_DEC_38 (г)

    ParseProbe(stdout, file) =
        result = text of the last stream-json line with type = result
        counts = file parsed (ProbeCounts, SP_CTX_02_57) or none
        compact = result contains PROBE_PREFIX ? reached : (result present ? passed : none)   # "Not compacted · <PROBE_PREFIX>…" — обробник мода відповів skip
        attachments = counts ? (counts.attachments > 0 ? reached : passed) : none
        version = counts.version
        RETURN compact or attachments present ? { compact, attachments, version } : none

Дія, що чекає зонда (Flush, RunHandoff, RunRepair, маршрут `/compact` людини): якщо `c.probeState` — `planned` чи `running` і вердикт `compact` — `unknown`, вона чекає кінця зонда не довше PROBE_WAIT_MS від свого початку; далі — як `unknown`.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| PROBE_FAILED | `$.process.run` кидає (немає бінарника, тайм-аут, відмова хоста) | `probe = {}`; кеш не пишеться; вердикт лише живий; наступна сесія спробує знову; журнал налагодження |
| PROBE_NO_RESULT | у stdout немає рядка `result` і файлу лічильників | як PROBE_FAILED |
| PROBE_OTHER_HOST | версія в лічильниках зонда ≠ версія цього хоста | результат відкинуто; кеш не пишеться |
| PROBE_CLEANUP_FAILED | видалення тимчасової теки чи теки проєкту не вдалося | журнал налагодження; результат лишається |

### 02_57. ProbeMode  {#SP_CTX_02_57}

> **Criticality:** normal

Purpose: мод у процесі-зонді (`$.env.get('CONTEXT_EDITOR_PROBE') = "1"`) лише рахує, що до нього дійшло, і відповідає на мітку зонда; нічого не пише в сховище і не запускає власного зонда (спайк, Q5).

    IF ProbeMode:
        session.start: no PrepareStorage, no repair, no sweep, no probe, no tools or /handoff registered
        prompt.submit: no guide, no advice, no hint (next(e) unchanged)
        prompt.attachment (any type): counts.attachments + 1; next(e) unchanged
        session.append (any door): counts.doors[door] + 1; next(e) unchanged
        turn.complete: write PROBE_FILE in cwd = { version: $.session.version(), attachments, doors }   # ProbeCounts; ParseProbe читає його й тоді, коли обробник компактизації не викликано
        session.compact with instructions = PROBE_MARKER: write PROBE_FILE; RETURN { skip: PROBE_PREFIX + " " + JSON(counts) }
        session.compact, other instructions: next(e) unchanged   # без спостерігача: межі не пише
        tool.call (any tool): the result unchanged   # без псевдонімів, тегів, сховища
        command.run compact, handoff: next(e) unchanged   # нічого не ставить у чергу: сховища немає; /handoff іншого плагіна з тим самим іменем іде далі
        tools context_*: not registered (the probe makes no model request, so no tool call comes)

Errors: запис PROBE_FILE не вдався — ParseProbe бере лише `result` (компактизація є, вкладень немає); інші хуки — як без ProbeMode.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-14 | Створено: PassedOver, дії при обході, CompactBrief і ObservePassedCompact ([C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31), [SP_CTX_DEC_38](./context_editor.decisions-21.sp.md#SP_CTX_DEC_38)) |
| 2026-10-14 | Перевірка можливостей процесом-зондом раз на версію хоста замість межі версії (рішення розробника, [C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31) (а) D): 02_53 Capabilities (живі ознаки, зонд, кеш), 02_56 RunProbe, 02_57 ProbeMode; `hooks/bypass.ts` → `hooks/capabilities.ts` |
| 2026-10-14 | Код фази 38: Fit тримає BRIEF_HEAD і BRIEF_RECORDS; ProbeMode не реєструє інструментів; NoteCommandUnseen за лічильником `ownSeen`; Flush при обході знімає запит ходу стискання |
| 2026-10-14 | Рев'ю фази 38: NeedsProbe (запис без вердикту зонда — новий зонд), HostBinary, NotePassCompaction і `passSeen`, рядок людині для кожної можливості, ObservePassedCompact лише з рядком підсумку хоста і з очищенням відповідей про вкладення, заміни з тегів при обході |
| 2026-10-16 | 02_57: у ProbeMode `/compact` і `/handoff` людини йдуть далі без змін: наживо керований мод у ProbeMode відповів на `/handoff` копії мода і записав чергу в сховище (живий сценарій обходу з копією поруч із керованим модом); так само `session.compact` з іншими інструкціями і `tool.call` — без сховища: наживо спостерігач чужої компактизації записав межу, а хук виклику створив теку сесії |
| 2026-10-16 | 02_55: OBSERVE_LATER — наживо (хост 2.1.299, копія мода поруч із керованим) читання одразу після `next` у хуку `/compact` ще не мало підсумку (18 рядків до і після): межі не було, черга лишилась, `context_list` показував рядки до підсумку; спостерігач повторюється на початку наступного ходу |
| 2026-10-16 | 02_55 за рев'ю: OBSERVE_LATER спершу на промпті людини (до звіту, щоб вступ після компактизації не запізнився), інакше на початку ходу; новий `/compact` з брифом забуває попереднє очікування; «хост зробив підсумок» — `next` розв'язався (тип результату `command.run` не має skip/error) |
