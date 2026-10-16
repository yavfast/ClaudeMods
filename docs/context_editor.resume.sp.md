# Редактор контексту агента — Specification: Contracts: repair after resume

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** draft
> **Created:** 2026-10-12
> **Updated:** 2026-10-13 (код фази 32)
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_44–02_48 специфікації [SP_CTX](./context_editor.sp.md): журнал входу застосувань (RecordInputs), розпізнавання підтягнутих оригіналів (DropPulled), виявлення і запуск ремонту в новому процесі хоста (ScheduleRepair, RunRepair), обробник компактизації ремонту (HandleRepair), результат ToolSearch, перебудований без `handle` (ToolRefText). Читати перед зміною `hooks/repair.ts`, гілки ремонту в `hooks/compaction.ts`, зв'язування `session.start` у `hooks/register.ts` або перебудови результатів у `hooks/edits.ts`.

## Contents

Розділи цього файлу (h3 розділу «02. Contracts» парасольки):

- [02_44. RecordInputs](#SP_CTX_02_44)
- [02_45. DropPulled](#SP_CTX_02_45)
- [02_46. ScheduleRepair і RunRepair](#SP_CTX_02_46)
- [02_47. HandleRepair](#SP_CTX_02_47)
- [02_48. ToolRefText](#SP_CTX_02_48)

## 02. Contracts — ремонт після відновлення

Навіщо (спайк [context_editor_resume](./context_editor_resume.spike.md); навичка plugin-hooks, пункти 63–66). Застосування мода повертає незачеплені відповіді з `handle` — і типово, і з `keep_cache` ([SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22), переглянуто). Хост пише копії після межі з новими uuid, але рядок з `handle` — це оригінальне повідомлення з тим самим `message.id`. Після `claude --resume` чи `/resume` завантажувач, пройшовши ланцюжок від листа, вставляє поруч з кожним рядком асистента рядки **всього файлу** з тим самим `message.id` разом з їхніми результатами (шлях 7(б)), не зважаючи на межу; копія рядка результату з `handle` ще й має батька до межі, і обхід від неї йде оригіналами (шлях 7(а)). Модель бачить подвоєні тексти й thinking, кожен запит пише `ensureToolResultPairing`, перелік показує подвоєні рядки, а передача `transcript` відмовляє «repeated call id» (CF-46, CF-51 аудиту PL_AUD_CTX). Застосування в сесії мод не змінює — кеш промпту в робочій сесії не страждає. Натомість у новому процесі хоста (чи після перемикання сесії в процесі) мод один раз, до першого запиту, перебудовує завантажену розмову своєю компактизацією: прибирає підтягнуті оригінали, що мають двійника, і повертає рядки асистента і результатів без `handle`, щоб наступне відновлення було чистим ([SP_CTX_DEC_32](./context_editor.decisions-21.sp.md#SP_CTX_DEC_32)–[SP_CTX_DEC_35](./context_editor.decisions-21.sp.md#SP_CTX_DEC_35); рішення розробника — напрям «Ремонт після відновлення (Recommended)»).

Факти, на яких стоїть ремонт (спайк, Entries 3–5; 2.1.296, stream-json): (1) у відновленому процесі і `$.session.messages()`, і `e.messages` обробника компактизації — завантажений ланцюжок з дублікатами, але `handle` несуть лише рядки `e.messages` (тип хоста: `handle` «absent on `$.session.messages()`»; жива перевірка фази 32 — усі рядки читання в сесії 26ed3e59 без нього); вставлений оригінал несе `handle`, що дорівнює його uuid до межі, тобто `handle` рядка входу того застосування, яке його повернуло (перевірено наживо 2026-10-12, сесія `26ed3e59-2ecf-49ef-8bdc-7628b3ac430b`: 21 `handle` входу застосування = 21 uuid рядків JSONL до межі, а 7 оригіналів у вході обробника відновленого процесу несуть саме ці `handle`; дані — `.dev_flow/cache/live-test/phase32-precheck/`); вміст оригіналу і копії однаковий, тож відбитки їх не розрізняють; (2) рядок без `handle` нічого не тягне, копія промпту з `handle` теж безпечна — тягнуть лише рядки асистента (за `message.id`) і рядки результатів (батько до межі); (3) прибирання всіх рядків до межі без перевірки двійника губить рядки, копій яких у ланцюжку немає (перший промпт після обходу через межу, сесія b); (4) компактизація мода, запланована з `session.start` через `$.clock.after`, виконується до першого промпту (stream-json; термінал і `/resume` у процесі — не перевірено, сценарії 05_03).

Пам'ять модуля (скидається перезавантаженням модуля): `repair = { session: string?, state: none | planned | running | done | failed }` — ремонт сесії `session` у цьому екземплярі (одна спроба на сесію); `repairAtTurnEnd: bool` (false) — перемикання сесії в процесі чекає кінця ходу; `compactedHere: string?` — сесія, для якої цей екземпляр уже обробив власну компактизацію (застосування, засів чи ремонт), відколи її сховище опубліковано; `lastRepair: { session, dropped, rows, media }?` — підсумок останнього ремонту, який обробник лишає для рядка людини (як `appliedLine` застосування, [SP_CTX_02_43](./context_editor.stages.sp.md#SP_CTX_02_43)).

### 02_44. RecordInputs  {#SP_CTX_02_44}

> **Criticality:** core

Purpose: записати, які рядки входу застосування після `--resume` можуть повернутися оригіналами, — щоб ремонт розпізнав їх за `handle`.

Input: `messages` обробника HandleCompaction ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)) після DropPulled, `id` застосування (`reportId`). Output: запис ApplyLedger ([SP_CTX_01_24](./context_editor.records.sp.md#SP_CTX_01_24)) або нічого.

    RecordInputs(messages, id):                                      # HandleCompaction, після точки фіксації, у фоні на ланцюжку `ledger` (як JournalApply), лише коли обробник повертає рядки і диспетчеризацію не покинуто
        handles = [r.handle FOR r IN messages IF r.handle present AND (r.role = assistant OR r has toolResults)]   # промпти й інші рядки `user` без результатів не тягнуть нічого (спайк, Q2)
        IF handles empty: RETURN
        IF len(handles) > MAX_LEDGER_HANDLES: keep the newest MAX_LEDGER_HANDLES   # `e.messages` не має межі ROW_WINDOW (навичка plugin-hooks, пункт 49), тож запис обмежує загальна межа журналу
        Update ledger: entries += { at: id, handles }; WHILE Σ len(entries[k].handles) > MAX_LEDGER_HANDLES OR serialized > MAX_QUEUE_BYTES: drop entries[0]   # найстаріші першими
        unreadable → перенести файл убік (карантин, SP_CTX_01_07) і почати новий журнал з цього запису   # старі оригінали тоді розпізнає лише залишкове правило DropPulled

Чому всі рядки асистента і результатів входу, а не лише повернені з `handle`: обидва шляхи хоста тягнуть рядки входу якогось застосування (рядки того самого `message.id` і їхні результати; оригінали до перетину межі), а точний підмножинний облік вимагав би повторити правила KeepResponsesWhole і FrozenPrefix; запис зайвого `handle` нічого не ламає — без двійника рядок однаково лишається (02_45). Засів ([SP_CTX_02_26](./context_editor.handoff.sp.md#SP_CTX_02_26)) і ремонт (02_47) нічого не записують: їхні рядки асистента і результатів не мають `handle`.

Errors: збій запису журналу не впливає ні на застосування, ні на звіт; оригінали цього застосування після `--resume` розпізнає лише залишкове правило DropPulled (рядки з ідентифікаторами).

### 02_45. DropPulled  {#SP_CTX_02_45}

> **Criticality:** core

Purpose: у завантаженому ланцюжку знайти рядки, що повернулися оригіналами, і прибрати ті, що мають двійника; решту лишити. Як розпізнавати — [SP_CTX_DEC_34](./context_editor.decisions-21.sp.md#SP_CTX_DEC_34) (рекомендація D: журнал + залишкове правило). Чиста функція (`dropPulled` у `hooks/repair.ts`); її беруть NeedsRepair (02_46), HandleRepair (02_47), HandleCompaction ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)) і BuildSeed ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)).

Input: `rows: list<Row>`, `ledger: ApplyLedger` (стан `missing` — порожній), `applied: bool` — сесія мала застосування мода (запис `apply` у журналі ефекту або запис у ApplyLedger). Output: `{ kept: list<Row>, dropped: list<int>, residual: int }` — індекси прибраних рядків у `rows` і скільки з них прибрало залишкове правило.

    DropPulled(rows, ledger, applied):
        H = ∪ entry.handles; own(r) = r.handle present AND r.handle ∈ H                     # оригінал, повернений хостом після --resume, або рядок до перетину межі
        ids(r) = call ids of r.toolUses ∪ result ids of r.toolResults
        carried(id, role) = some row q with NOT own(q), q.role = role, id ∈ ids(q)          # копія з тим самим викликом чи результатом
        seg(i) = index of the latest row k ≤ i with isPromptRow(rows[k]) (or 0)             # відрізок між промптами людини
        drop = {}
        FOR i, r IN rows WHERE own(r) AND (r.role = assistant OR r has toolResults):        # промпти й інші рядки `user` без результатів лишаються завжди
            IF ids(r) not empty:
                IF every id IN ids(r) is carried(id, r.role): drop += i                      # (1) двійник за ідентифікаторами: копія, зокрема змінена правкою (summarize), виграє
            ELSE IF trimmed r.text = "": drop += i                                          # (2) лише thinking: без handle він однаково порожній і зникає
            ELSE IF an unused q with NOT own(q), q.role = r.role, q.text = r.text, seg(q) = seg(i): drop += i; q used   # (3) текстова відповідь і її копія в тому самому відрізку; кожна копія — двійник лише одного оригіналу (рев'ю фази 32)
        IF applied:                                                                         # (4) залишкове правило: журнал обрізано, втрачено чи сесія старша за фазу 32
            FOR each group G of rows ∉ drop, same role, with a shared id in ids:            # повтори одного виклику чи результату
                IF exactly one row m of G has ReplacementText text (SP_CTX_02_04): drop += rows of G − m whose ids all are in ids(m)   # правка мода — копія; рядок з ідентифікатором, якого m не має, лишається (рев'ю фази 32: оригінал [a,b] поруч з копіями a і b)
                ELSE IF every row of G has the same role, text and ids: drop += G − last row of G
                ELSE: nothing                                                               # неоднозначно — лишити, хост і далі лагодить пари
        PairsWhole: WHILE some id had a call before a result in rows but not among rows without drop: drop −= rows that hold that id   # прибирання ніколи не лишає виклик без результату чи результат без виклику (рев'ю фази 32)
        RETURN { kept = rows without drop, dropped = sorted drop, residual = count added by (4) }

Чому рядок з ідентифікаторами порівнюється без тексту: ідентифікатор виклику й результату унікальний, тож рядок поза журналом з тим самим ідентифікатором — копія того самого виклику; якщо копію змінила правка (підсумок `summarize`), прибрати треба саме оригінал — так правка переживає відновлення. Текстовий рядок без ідентифікаторів такого ключа не має, тож двійника шукаємо лише в його відрізку і з тим самим текстом; рядок, що змінила `rewrite`, двійника не знайде й лишиться (обмеження нижче). Рядок без двійника — рядок, який хост завантажив лише оригіналом (обхід через межу, шлях 7(а)): його прибирання загубило б частину розмови (сесія b спайку — перший промпт).

Медіа результату, який завантажений ланцюжок показує двічі (оригінал і копія), CollectMedia лічить один раз — з першого блоку `tool_result` цього ідентифікатора (живий прогін фази 32, (г): одна картинка давала два однакові файли).

Обмеження (05_04): (а) правки до рядка, через який обхід перетнув межу (результат з медіа, повернений з `handle`; префікс `keep_cache` правок не має), після `--resume` втрачено — копій у ланцюжку немає, і ремонт лишає оригінали; (б) оригінал, копію якого прибрала правка `drop`, `collapse` чи змінила `rewrite`, двійника не має і лишається — так буває лише, коли хост підтягнув його через інший рядок тієї самої відповіді, а KeepResponsesWhole і ResponseStart цього не допускають; (в) залишкове правило не бачить текстових повторів без ідентифікаторів.

Де є `handle`. Правила (1)–(3) спираються на `handle`, а його несуть лише рядки події компактизації: HandleCompaction і HandleRepair розпізнають оригінали за журналом; BuildSeed бере рядки читання розмови (CurrentRows), де `handle` немає, тож там діє лише залишкове правило (4) (фаза 32, код; [SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)).

Errors: немає (чиста функція). Порожній журнал і `applied = false` → нічого не прибрано.

### 02_46. ScheduleRepair і RunRepair  {#SP_CTX_02_46}

> **Criticality:** normal

Purpose: у новому процесі хоста чи після перемикання сесії в процесі помітити завантажений ланцюжок з оригіналами і один раз запустити компактизацію ремонту.

    ON session start (main conversation), after PrepareStorage:                 # новий процес хоста: --resume, перезапуск, VS Code відкриває сесію
        repairAtTurnEnd = true                                                 # з 2026-10-14 (SP_CTX_02_54): ремонт — з кінця першого ходу, коли вердикт compact відомий
    ON PrepareStorage publishes another session in this process (a real switch: /resume; /clear теж — нова сесія без журналу, перевірка нічого не знайде):
        repair = { session: new id, state: none }; compactedHere = none; repairAtTurnEnd = true   # таймер звідси не ставиться: перемикання бачать шляхи tool.call / prompt.submit, з таймерів яких команда не йде
    ON turn complete (main loop), in AfterTurn after the turn count, before Flush:
        IF repairAtTurnEnd: repairAtTurnEnd = false; ScheduleRepair()          # SP_CTX_DEC_32: перший хід після /resume у процесі ще з дублікатами

    ScheduleRepair():
        id = current session id
        IF repair.session = id AND repair.state ≠ none: RETURN                 # одна спроба на сесію в екземплярі
        repair = { session: id, state: planned }
        $.clock.after(REPAIR_DELAY_MS, RunRepair)                              # команда — лише з відкладеної дії, запланованої в turn.complete

    RunRepair():
        IF current session id ≠ repair.session: RETURN                         # перемикання за час очікування — нова сесія планує своє
        IF NOT NeedsRepair(): repair.state = done; RETURN
        repair.state = running; lastRepair = none
        TRY await $.command.run({ command: 'compact', args: REPAIR_MARKER })   # одна спроба; посеред ходу команда чекає його кінця
        CATCH err: repair.state = failed; $.ui.status(REPAIR_REFUSED + err message); debug log; RETURN   # сесія лишається як є; наступний новий процес спробує знову
        IF lastRepair.session = id: repair.state = done; LogRepair(lastRepair)
        ELSE: repair.state = failed                                            # обробник відповів skip: причина в журналі налагодження і спливному повідомленні обробника

    NeedsRepair():
        IF compactedHere = current session id: RETURN false                    # цей екземпляр уже компактизував сесію: читання — оригінали + копії
        dir = EnsureStorage; IF none: RETURN false
        ledger = read ApplyLedger; journal = read Journal; applied = ledger has entries OR journal has an `apply` entry
        IF NOT applied: RETURN false                                           # мод у цій сесії нічого не застосовував
        IF ledger.clean: RETURN false                                          # ремонт уже відповів «nothing to repair» після останнього застосування: повтори — не підтягнуті оригінали (той самий текст двічі в ході); RecordInputs вердикт знімає
        b = read Boundary; IF b present AND Trusted(b) (SP_CTX_02_18, await hostId ≤ HOST_ID_WAIT_MS): RETURN false   # той самий процес: межа довірена, читання — оригінали + копії, ремонт не потрібен
        rows = read main conversation rows (≤ ROW_WINDOW)                       # у новому процесі — завантажений ланцюжок, який бачить модель; рядки читання без handle
        RETURN Repeats(rows)                                                   # точне рішення за handle — в обробнику (DropPulled); без повторів команди немає

    Repeats(rows):                                                             # фаза 32, код: читання розмови не дає handle, тож DropPulled тут нічого не розпізнав би
        some call or result id in two rows of the same role
        OR some assistant text (whitespace aside, non-empty) twice in the same stretch between prompt rows

    LogRepair(r):                                                              # з RunRepair, після команди: рядок лягає після компактизації (як LogApply)
        line = "repaired the resumed conversation: dropped " + r.dropped + " row(s) loaded twice" + (r.media ? "; media of " + r.media + " result(s) carried as files" : "")
        $.ui.log(line)                                                         # спливне повідомлення вже дав обробник; $.ui.notify для VS Code (пункт 62: там видно лише його) — опція, не в цій фазі

Чому Repeats, а не DropPulled (відхилення коду від дизайну, жива перевірка фази 32): `$.session.messages()` не несе `handle`, тож за дизайном NeedsRepair завжди давав би `false`. Repeats бачить те, що завантажувач додає (подвоєні виклики, результати й тексти відповіді в одному відрізку); хибна тривога (той самий текст двічі в ході) коштує одну компактизацію, яка відповідає `skip nothing to repair` (у stream-json лишається рядок команди). Рядок сліду власних викликів (TRACE_OPENER, [SP_CTX_02_64](./context_editor.curation.sp.md#SP_CTX_02_64)) Repeats не рахує: два однакові сліди одного відрізка — не повтор.

Хости (до 2026-10-14, коли ремонт планувався з `session.start`). stream-json: компактизація з `session.start` виконувалася до першого промпту (спайк, cr2); тепер перший хід після відновлення йде з дублікатами в усіх хостах. Термінал з `claude --resume`: `session.start` теж є; якщо людина встигне надіслати промпт за REPAIR_DELAY_MS, команда чекає кінця ходу — перший запит тоді йде з дублікатами (живий сценарій). `/resume` у процесі: `session.start` немає, перемикання бачить PrepareStorage; ремонт іде після першого ходу (хук `command.run` на `resume` як ранній тригер — лише якщо живий прогін покаже, що він спрацьовує і повертається після перемикання; SP_CTX_DEC_32). Разовий `claude -p --resume <id> "<prompt>"`: команда, поставлена посеред єдиного ходу, після нього відхиляється («no session is bound») — рядок стану, сесія як є.

Порядок з Flush не потрібен для правильності: якщо застосування черги прийде раніше за ремонт (ремонт відмовлено чи ще не встиг), HandleCompaction сам прибирає підтягнуті оригінали DropPulled ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)), а після нього межа довірена і NeedsRepair — `false`. Черги ремонт не читає й не пише: правки в ній цілять за `tool_use_id` і відбитками (роль, ідентифікатори, текст), які перебудова без `handle` не змінює (крім результату ToolSearch, 02_48, і злитих рядків викликів — як і в застосуванні).

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| REPAIR_REFUSED | `$.command.run` відхилено (немає прив'язаної сесії, неприпустиме походження) | одна спроба; рядок стану з текстом відмови; розмова як є; наступний новий процес хоста спробує знову |
| — | NeedsRepair: сховища немає, журнал нечитабельний, межа довірена | команди немає, мовчки (журнал налагодження) |

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54), [C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31) (д)): з 2026-10-14 ScheduleRepair не викликається з `session.start`: новий процес хоста ставить `repairAtTurnEnd = true`, і ремонт планується на кінці першого ходу основної розмови, коли вердикт `compact` уже з кешу чи зонда ([SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53)); при `passed` ремонту немає, при зонді, що йде, RunRepair чекає його не довше PROBE_WAIT_MS. Ремонт до першого промпту (stream-json) і рядок «Хости» вище про `session.start` — історія.

### 02_47. HandleRepair  {#SP_CTX_02_47}

> **Criticality:** core

Purpose: обробник компактизації з REPAIR_MARKER: повернути завантажену розмову без підтягнутих оригіналів, з рядками асистента і результатів без `handle`.

Input: подія компактизації з MarkerKind(`instructions`) = `repair`, без `agentId`, `trigger` ≠ `precompute` (команда мода приходить з `manual`). Output: `{ messages }` або `skip` з текстом за PREFIX.

    HandleRepair(messages):
        IF storage unavailable: RETURN skip "storage unavailable"
        IF handoffInFlight: RETURN skip "handoff running"                       # передача засіє нову сесію; BuildSeed сам бере DropPulled
        ledger = read ApplyLedger (unreadable → RETURN skip "ledger unreadable"); applied = as in NeedsRepair
        (kept, dropped, residual) = DropPulled(messages, ledger, applied)
        IF dropped empty: IF NOT abandoned: in the background, on the ledger chain: ledger.clean = true; RETURN skip "nothing to repair"   # вердикт для NeedsRepair наступних процесів
        api = read main conversation in Messages API form
        (found, knownResults, unmatched, apiTruncated, toolRefs) = CollectMedia(api, kept)       # SP_CTX_02_10; toolRefs — 02_48
        id = now; n = 0; paths = {}
        FOR each result row t of kept, FOR ref IN found[{t.tool_use_id}]:
            IF ref.data absent: paths[...] = absent; CONTINUE
            n += 1; path = <archives>/<id>/<n>.<ext>; IF writing fails: RETURN skip "media could not be written"   # як у засіві; без файлу медіа зникло б
        rows = []
        FOR r IN kept:
            IF r.role = user AND r has no toolResults: rows += r                 # промпти, рядки команд, вставлені доставки — з handle: копії безпечні, вкладення їдуть з ними
            ELSE IF r.role = assistant: rows += { role, text, toolUses } without handle   # thinking зникає
            ELSE: rows += r without handle, each result text = ToolRefText(t, toolRefs) (02_48), + CarryNote(found, paths) when it had media   # SP_CTX_02_22
        rows = drop rows without text, calls and results; MergeCallRows(rows)      # SP_CTX_02_04
        deliveries = read QueuedDeliveries (unreadable → none)
        (rows, _, done, _) = InsertDeliveries(kept, rows, deliveries, renamed = ∅, allRebuilt = rows rebuilt above)   # SP_CTX_02_36: доставка за рядком, перебудованим без handle, інакше губиться (пункт 44)
        problem = CheckPairs(rows)                                                # правила CheckSeed про пари й унікальні ідентифікатори (SP_CTX_02_23), без «немає handle» і «перший рядок — людини»
        IF problem: RETURN skip "repair would break pairs: " + problem
        IF the dispatch was abandoned: RETURN skip "compaction abandoned"
        COMMIT (tags chain, then aliases — as in SP_CTX_02_07): reg' = RebindTags(reg, rows, report without applied edits); aliases' = PruneAliases(aliases, rows); abandoned before or during → put back as read; RETURN skip "compaction abandoned"
        after the handler returned, IF NOT abandoned: compactedHere = session; lastRepair = { session, dropped: len(dropped), rows: len(rows), media: count of results with CarryNote }
        toast "context-editor: repaired the resumed conversation (" + len(dropped) + " rows loaded twice)"
        in the background, each only IF NOT abandoned right before it (CONC-02): RecordBoundary(rows) (SP_CTX_02_18); on the ledger chain: entries = []   # жоден повернений рядок асистента чи результату не має handle — старі оригінали більше не підтягнуться
        in the background, on the deliveries chain: remove done (як у SP_CTX_02_07)
        IF the attachments port: ResetPass                                         # SP_CTX_02_39: хост перепитає вкладення; рішення лишаються
        RETURN { messages: rows }

    ON handler failure (CompactionFailed, MarkerKind = repair): RETURN skip "repair failed" at once; nothing written   # справжнього підсумку немає за жодної гілки

Чому промпти лишаються з `handle`: копія промпту з `handle` не тягне нічого (спайк, e і g), а з нею хост переносить вкладення першого повідомлення, медіа промптів людини і нагадування — без `handle` вони зникли б, як у засіві ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)). Чому всі рядки асистента і результатів — без `handle`, а не лише двійники: будь-який рядок асистента, повернений з `handle`, після наступного `--resume` знову підтягне свій оригінал (спайк, Entry 4: «наступне відновлення потягне два покоління»), а рядок результату з `handle` поведе обхід через межу ([SP_CTX_DEC_33](./context_editor.decisions-21.sp.md#SP_CTX_DEC_33)).

Ціна (спайк, ar2, br2): кеш промпту розмови пишеться наново від першого рядка асистента (після паузи відновлення понад TTL кешу він і так холодний; копія з дублікатами — уже інші байти, ніж кешовані до виходу); thinking усіх ранніх відповідей зникає; відкладені інструменти з ToolSearch зникають зі списку `tools` (02_48); медіа результатів — файлами, назви в тексті результату.

Звіту агентові ремонт не ставить у чергу і промпту не надсилає: людина продовжує сама. Модель бачить рядок команди `/compact` з REPAIR_MARKER, який каже, що команду запустив мод (у stream-json рядки команди лишаються серед рядків, у терміналі — ні; навичка plugin-hooks, пункт 60).

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| SKIP_STORAGE | сховища немає | розмова як є |
| SKIP_HANDOFF_RUNNING | іде передача | розмова як є; засів бере DropPulled сам |
| SKIP_LEDGER | ApplyLedger `unreadable` | розмова як є; наступне застосування перенесе файл убік |
| SKIP_NOTHING | DropPulled нічого не прибрав | розмова як є (`repair.state = failed`, рядка людини немає) |
| SKIP_MEDIA | медіа результату не записалось | розмова як є; наступний новий процес спробує знову |
| SKIP_PAIRS | перебудова порушила б пари | розмова як є; причина в спливному повідомленні й журналі налагодження |
| SKIP_ABANDONED | хост покинув диспетчеризацію | розмова, реєстри, межа і журнал як були |
| SKIP_FAILED | обробник упав | `skip` одразу, нічого не записано |

### 02_48. ToolRefText  {#SP_CTX_02_48}

> **Criticality:** normal

Purpose: результат ToolSearch, перебудований без `handle`, не повинен ставати порожнім (CF-51; спайк, Q5; навичка plugin-hooks, пункт 66).

Результат ToolSearch у API-поданні — блоки `{"type":"tool_reference","tool_name":…}`; рядок `SessionMessage` несе порожній `text`. Рядок без `handle` хост будує з `text`, тож блоків `tool_reference` не передати (спайк, f, g, h): перебудований результат стає `""`, модель бачить «нічого не повернуто», а відкладений інструмент зникає зі списку `tools` наступного запиту (виклик за назвою хост однаково виконує; кеш `tools + system` не скидається). Повертати такий рядок з `handle` не можна — після `--resume` його копія веде обхід через межу ([SP_CTX_DEC_35](./context_editor.decisions-21.sp.md#SP_CTX_DEC_35)).

    CollectMedia (SP_CTX_02_10) додає вихід toolRefs: map<tool_use_id, list<string>> — для кожного блоку tool_result API-подання, чий вміст має блоки tool_reference, назви `tool_name` по порядку
    ToolRefText(t, toolRefs) = trimmed t.text ≠ "" OR toolRefs[t.tool_use_id] absent ? t.text
                               : TOOLREF_TEXT(names = toolRefs[t.tool_use_id] joined ", ")

Де діє: кожен рядок результату, який мод повертає без `handle` і не змінює правкою — ApplyEdits (правило [SP_CTX_DEC_02](./context_editor.decisions-01.sp.md#SP_CTX_DEC_02) і KeepResponsesWhole, [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04)), BuildSeed ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22)) і HandleRepair (02_47). Результат, що лишився з `handle`, несе свої блоки сам. Відбиток такого рядка змінюється (інший текст): тег за якорем на ньому губиться, теги пари за `tool_use_id` і псевдонім лишаються.

Errors: немає. Поза вікном API (`toolRefs` не знає виклику) — порожній текст, як до фази 32.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-12 | Новий дочірній файл (дизайн фази 32; спайк [context_editor_resume](./context_editor_resume.spike.md); рішення розробника «Ремонт після відновлення (Recommended)»): 02_44 RecordInputs, 02_45 DropPulled, 02_46 ScheduleRepair і RunRepair, 02_47 HandleRepair, 02_48 ToolRefText (CF-51); [SP_CTX_DEC_32](./context_editor.decisions-21.sp.md#SP_CTX_DEC_32)–[SP_CTX_DEC_35](./context_editor.decisions-21.sp.md#SP_CTX_DEC_35) proposed |
| 2026-10-12 | Код фази 32 (`hooks/repair.ts`): перший крок живого сценарію — `handle` рядка входу застосування = uuid рядка JSONL до межі = `handle` вставленого оригіналу у відновленому процесі (сесія 26ed3e59, `.dev_flow/cache/live-test/phase32-precheck/`); преамбула — `$.session.messages()` не несе `handle`; 02_46 — NeedsRepair перевіряє Repeats(rows) замість DropPulled (відхилення: без `handle` DropPulled нічого не розпізнає); 02_44 — запис входу ≤ MAX_LEDGER_HANDLES (`e.messages` без межі ROW_WINDOW); 02_45 — «Де є `handle`»: у BuildSeed діє лише залишкове правило |
| 2026-10-12 | Рев'ю і живий прогін фази 32 (`.dev_flow/cache/live-test/phase32-results.md`): 02_45 — правило (3) за кількістю (копія — двійник одного оригіналу), залишкове правило прибирає рядок лише коли заміна має всі його ідентифікатори, PairsWhole (прибирання не розриває пар); 02_46 — вердикт `ApplyLedger.clean` після «nothing to repair» глушить NeedsRepair до наступного застосування; HandleCompaction не читає журнал, коли `compactedHere` = сесія; 02_47 — записи після фіксації лише без покинутої диспетчеризації (CONC-02); CollectMedia — медіа і `tool_reference` результату один раз за ідентифікатором |
