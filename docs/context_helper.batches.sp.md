# Помічник мода — Specification: відкладені пакети — поля черги, годинник кешу, відкладені пакети, простій, новий процес

> **Code:** SP_HELP (дочірній файл набору)
> **Status:** draft
> **Created:** 2026-11-16
> **Updated:** 2026-11-16
> **Umbrella:** [SP_HELP](./context_helper.sp.md)
>
> §01_06–01_07 і §02_09–02_12 специфікації [SP_HELP](./context_helper.sp.md): відкладені пакети правок, годинник кешу, застосування в простої й у новому процесі. Читати, коли змінюєте чергу, Flush чи застосування.

## Contents

Розділи цього файлу (позначення типів — як у [§01 парасольки](./context_helper.sp.md#SP_HELP_01)):

- [01_06. Поля відкладеного пакета в черзі](#SP_HELP_01_06)
- [01_07. CacheClock](#SP_HELP_01_07)
- [02_09. CacheClock: оновлення, вердикт, підтвердження](#SP_HELP_02_09)
- [02_10. Відкладені пакети](#SP_HELP_02_10)
- [02_11. IdleRun: таймер простою](#SP_HELP_02_11)
- [02_12. StartRun: новий процес](#SP_HELP_02_12)

## 01. Data Structures

### 01_06. Поля відкладеного пакета в черзі  {#SP_HELP_01_06}

Розширення QueuedEdit і Queue ([SP_CTX_01_03](./context_editor.structures.sp.md#SP_CTX_01_03), [SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04)).

QueuedEdit:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| deferred | string | no | відсутнє | BATCH_PREFIX + номер | Пакет, до якого належить правка; є лише в правок виклику `context_edit` з `defer: true` |

Queue:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| nextBatch | int | no | 1 | ≥ 1; не повторюється в сесії | Номер наступного відкладеного пакета |
| applyDeferred | bool | no | false | — | Наступне застосування бере всі відкладені пакети; знімається разом з `coldSince` у точці фіксації застосування |
| coldSince | int | no | відсутнє | час | `lastRequestAt`, на якому таймер простою (§02_11) чи StartRun (§02_12) поставив `applyDeferred`; поки воно не дорівнює поточному `lastRequestAt`, `applyDeferred` не діє (§02_10). Дія `apply` і порожній хід стискання ставлять `applyDeferred` без нього |
| deferredSince | `{ [batch]: int }` | no | `{}` | ключ — пакет у черзі | Хід, у якому пакет поставлено, для телеметрії |

Invariants:
- Правки повернення (`via: 'return'`) і заміни тегів (`via: 'tag'`) ніколи не мають `deferred`.
- Порядок правок у черзі зберігається: невибрані відкладені правки лишаються в черзі в тому самому порядку (§02_10).
- Відкладені правки лічаться в MAX_QUEUE_EDITS і MAX_QUEUE_BYTES, як усі правки черги.
- Розподіл полів для KeepOtherSteps ([SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04), змінено). Поля іншого кроку — лишаються як прочитано в кожному записі, що закінчує пакет: правки з `deferred` у їхньому порядку, `deferredSince`, `nextBatch`. Поля пакета — скидаються до значень за замовчуванням разом з ним: `applyDeferred`, `coldSince`. Правки з `deferred` прибирають лише застосування, що їх вибрало, засів передачі способом «транскрипт», скидання черги в передачі способом «документ» і очищення черги ObservePassedCompact ([SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55): відкладені правки йдуть у бриф разом з рештою); номери пакетів у сесії не повторюються.

### 01_07. CacheClock  {#SP_HELP_01_07}

Годинник кешу основної розмови в реєстрі сесії (`tags.json`, поле `cache`).

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| lastRequestAt | int \| null | yes | null | час | Кінець останнього запиту на префіксі основної розмови: кінець кроку основного ходу, зокрема перерваного, чи мить після відповіді форку розмови модом (§02_09). Виклик помічника його не змінює |
| coldAt | int \| null | yes | null | час | Коли взято останній вердикт «холодний» |
| check | bool | yes | false | — | Вердикт «холодний» чекає підтвердження першим кроком основного ходу, що приніс `usage` (§02_09) |

Поле `cache` відсутнє — годинник у цій сесії ще не писали (читається як `lastRequestAt = null`); поле не цієї форми (час — ціле ≥ 0 чи null, `check` — bool) робить реєстр `unreadable` з причиною `bad field(s): cache` ([SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10)). Реалізація — чистий модуль `hooks/cacheclock.ts` (PL_HELP, фаза 2).

ClockMemory — пам'ять модуля, не файл: `{ session, at }` — кінець останнього запиту однієї сесії в цьому процесі. Запит тієї самої сесії лише підвищує `at`, запит іншої сесії замінює пам'ять; перезавантаження модуля її скидає. LastRequest — пізніше з `cache.lastRequestAt` реєстру й `at` пам'яті, коли пам'ять належить тій самій сесії; немає жодного — null. Далі «`lastRequestAt`» у правилах читачів означає LastRequest.

Температура (Temperature): `cold`, коли `lastRequestAt` є й `now − lastRequestAt > CACHE_TTL_MS`; `warm` — коли є й не більше; `unknown` — коли `lastRequestAt` = null. Вердикт «холодний» для одного простою береться один раз: умова — `coldAt` null або `coldAt < lastRequestAt`.

## 02. Contracts

### 02_09. CacheClock: оновлення, вердикт, підтвердження  {#SP_HELP_02_09}

> Implements: [C_HELP_03_04](./context_helper.concept.md#C_HELP_03_04)

- **Оновлення.** Хук `turn.step` основної розмови (крок з `agentId` — субагента — проходить без змін) лише пропускає потік кроку (`yield* next(e)`), а після кроку, зокрема перерваного (`finally`), ставить у пам'ять модуля (ClockMemory, §01_07) сесії кроку час кінця кроку. У реєстр пам'ять пише ClockAfter окремим записом на ланцюжку реєстру в кінці кожного основного ходу, зокрема перерваного (крок `clock` AfterTurn після лічильника ходів, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)); пам'ять не новіша за `cache.lastRequestAt` реєстру — запису немає; теки сховища немає — теж. Після форка основної розмови модом, що відповів (документ передачі, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), — так само: пам'ять (час після відповіді), потім запис реєстру старої сесії; форк без відповіді годинника не чіпає. Читачі (телеметрія, вердикт на промпті, підтвердження; таймер простою й обробник компактизації — з фаз, що їх вводять) беруть LastRequest (§01_07). Виклик помічника й власна компактизація мода `lastRequestAt` не змінюють.
- **Вердикт «холодний» (ColdVerdict).** Береться таймером простою (§02_11) і на першому промпті основної розмови між ходами — у DeliverReport до входу промпту ([SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)); промпти власної компактизації мода й пробудження хуків мода не проходять, а повідомлення людини посеред ходу вердикту не бере. Умова — `now − lastRequestAt > CACHE_TTL_MS` (LastRequest). Лише якщо для цього простою вердикту ще не було (§01_07): на ланцюжку реєстру `cache = { lastRequestAt: LastRequest, coldAt: now, check: true }`, потім CheckErrands з умовою `cold` (§02_07; фаза 7). Збій вердикту промпту не тримає; промпт, відхилений нижчим обробником, вердикт не повертає. Реєстр, відомий з погляду кешу, без вердикту, що настав, ланцюжка не займає.
- **Підтвердження.** На початку кожного кроку основного ходу хук бере LastRequest до кроку з пам'яті модуля й погляду кешу реєстру, без читання файла й без ланцюжка (`prev`; погляду немає — `prev` невідомий). Перевірку забирає синхронно, одразу після кроку, перший крок, що приніс `usage` (не null), поки інша перевірка не йде (StartCheck: прапорець пам'яті модуля): пізніший крок того самого ходу не перевіряє своїми числами. Він при `check = true` в реєстрі у фоні після кроку читає його витрати: `read` — прочитане з кешу, `written` — записане, `input` — увесь вхід (некешований + записаний + прочитаний); `messages` — рядки розмови без незмінної частини з розбивки `usage`, прочитаної після кроку (рядок MESSAGES_ROW, лише коли телеметрія міряє `messages`, [SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28), [SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34)); `mismatch = read − (input − messages) > COLD_MISMATCH × messages`: з кешу прочитано більше за незмінну частину й половину рядків розмови (незмінну частину хост може прочитати зі спільного кешу); розбивки немає — `messages = null`, `mismatch = null`; `mismatch = null` і тоді, коли LastRequest до кроку невідомий або крок почався не пізніше CACHE_TTL_MS після нього (між вердиктом і цим кроком був крок без `usage`: перевіряти вже нічого). Confirm на ланцюжку реєстру: `lastRequestAt = max(lastRequestAt, кінець кроку)`, `check = false`; лише коли цей запис щось змінив (`check` ще стояв), — запис журналу `cache` (JournalCache, [SP_CTX_02_31](./context_editor.telemetry.sp.md#SP_CTX_02_31)) з `at` = кінець кроку й `idle` = початок кроку − LastRequest до кроку (`prev`; невідомий — час реєстру, лише коли він раніший за початок кроку, бо пізніший — це запис кінця ходу цього самого кроку; `0`, коли немає й його). Збій читання розбивки чи запису годинника (кінець ходу, форк, перевірка) лишає рядок журналу налагодження (ERR-01). Крок без `usage` (зокрема перерваний до відповіді) нічого не перевіряє, і `check` лишається для наступного кроку. У ProbeMode перевірки немає ([SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57)).

### 02_10. Відкладені пакети  {#SP_HELP_02_10}

> Implements: [C_HELP_03_04](./context_helper.concept.md#C_HELP_03_04), [C_HELP_DEC_09](./context_helper.concept.md#C_HELP_DEC_09)

Purpose: пакет правок, позначений агентом, застосовується лише тоді, коли не додає власного переписування кешу.

**Постановка.** `context_edit` отримує поле `defer?: bool` (за замовчуванням false). З `defer: true` кожна прийнята правка виклику отримує `deferred = BATCH_PREFIX + nextBatch`; `nextBatch` зростає; `deferredSince[batch] = turn`. До рядка результату додається `Deferred as <batch>: it applies with your next apply that rewrites the cache from no later a point, when the cache turns cold in idle, or in a handoff.` Обхід компактизації — відмова DENIED_PASSED_OVER (текст EDIT_PASSED_OVER), як для будь-якої правки. Виклик з `defer: true` не змінює виборів пакета черги (`resume`, `resumePrompt`, `resumeSet`, `keepCache`, `tagsOnly`): вони належать пакету, який застосовується найближчим, а відкладений пакет найближчим не застосовується; поля `resume`, `resume_prompt` і `keep_cache` такого виклику ігноруються з реченням `resume and keep_cache do not apply to a deferred batch.` у результаті. Повернень такий виклик не додає (§02_05). Очікування блоку він не закінчує й замін тегів `disposable` не ставить (QueueTagReplacements, [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)): заміни — звичайні правки, вони запланували б застосування, якого відкладення уникає; блок чекає далі, і очікування закінчує перший прийнятий виклик без `defer` ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), змінено). Рядок результату такого виклику не обіцяє звільнення «when this turn ends»: замість речення `queued` він несе речення `Deferred as <batch>…`. PrepareEdits і правило слів людини ([SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58)) перевіряють відкладені правки так само, як звичайні; ціль невибраної правки перевіряє лише застосування, яке її вибере.

**Початок переписування (RewriteStart(S, rows, keep)).** Застосування без `keep_cache` переписує всю розмову (рядок Cache, [SP_CTX_02_38](./context_editor.telemetry.sp.md#SP_CTX_02_38)): `keep` = false → 0. З `keep_cache` — той самий початок, що в ціні кешу: `first` — найраніший рядок, який змінює набір S; `start = ResponseStart(first)`; позицій API від `start` до кінця більше за CACHE_LOOKBACK → 0 (уся розмова). Обробник рахує над рядками, які отримав, без APPLY_MARGIN: запас на рядки, що додадуться до застосування, потрібен лише оцінці посеред ходу. Порожній набір — нескінченність.

**Вибір (SelectEdits)** — в обробнику компактизації до ApplyEdits ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)) і в оцінці ціни:

    FUNCTION SelectEdits(queue, rows):
        O = NonDeferred(queue)                        // правки агента, повернення, заміни тегів
        IF queue.applyDeferred AND (queue.coldSince absent OR queue.coldSince = lastRequestAt): RETURN all queued edits
        IF O is empty: RETURN O
        sO = RewriteStart(O, rows, queue.keepCache)
        selected = O + every deferred batch B (in queue order) with sO ≤ RewriteStart(B, rows, true)
        RETURN selected in queue order

Порожній вибір: обробник відповідає `skip "no applicable edits"` до будь-якої перебудови, а `applyDeferred` з `coldSince`, що вже не дорівнює `lastRequestAt`, знімає на ланцюжку черги.

Ціль відкладеної правки на рядках, що змінилися після постановки, розв'язується наявними прив'язками; нерозв'язна ціль — правка «Not applied», як будь-яка. Заморожений префікс з `keep_cache` рахується над вибраним набором (контракт не змінюється): вибраний пакет починається не раніше за `sO`.

**Фіксація.** Черга, записана в точці фіксації застосування, зберігає невибрані відкладені правки в їхньому порядку разом з `deferredSince` їхніх пакетів; `applyDeferred = false`, `coldSince` відсутнє. Звіт застосування додає `Deferred: <k> edit(s) of <m> batch(es) applied; <r> still wait.`, коли відкладені правки були в черзі.

**Прив'язка невибраних правок.** Невибрана відкладена правка з якорями рядків (`collapse`, `rewrite`, `describe`, рядок `state`) у точці фіксації прив'язується до перебудованих рядків так само, як RebindTags прив'язує якорі тегів ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)): спершу за тотожністю рядків (рядок повернуто незміненим), LocateSpan — запасний шлях. Правка, чий рядок пішов чи змінився застосованим набором (згорнутий, перебудований, злитий), виходить з черги рядком звіту `Not applied: <edit>: its rows changed in this apply.`. Правки за ідентифікатором (`summarize`, `drop` за `tool_use_id`, `ref` чи `host`) прив'язки не потребують. Свіжість індексів (`listedKey`, STALE_INDEXES, [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)) правка проходить один раз — під час постановки; для наступних застосувань її замінює ця прив'язка.

**Продовження після застосування** ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07), змінено). `ResumesAfter = false`, коли у виборі немає правки без `deferred` (лише відкладені пакети: дія `apply`, простій, порожній хід стискання `/compact`): мод сам агента не будить ([C_CTX_01_01](./context_editor.concept.md#C_CTX_01_01) у зміні C_HELP — лише пробудження за `wake`); звіт чекає промпту пробудження (§02_08) чи наступного промпту, що проходить хуки мода (DeliverReport, [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)). Інакше — як нині (`q.resume AND (q.resumeSet OR NOT q.tagsOnly)`).

**Гілка збою** ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07), змінено). Перевірка «застосування дійшло до точки фіксації» — `len(NonDeferred(q)) = 0 AND q.reportId = lastReported AND жодна правка пакетів selectedBatches не лишилася в q` замість `q.edits empty AND …`. `selectedBatches` (пам'ять модуля поруч із `lastReported`) обробник очищає на своєму початку й ставить у SelectEdits; невідомий `selectedBatches` (вибору ще не було) — третя частина перевірки хибна, тобто застосування до фіксації не дійшло. Запис гілки збою будує чергу KeepOtherSteps: невідкладені правки й вибори пакета скидаються, а з відкладених прибираються лише правки пакетів, які вибрало невдале застосування (`selectedBatches`; невідомо — не прибирається жодна); `applyDeferred` і `coldSince` скидаються. Текст збою додає `Deferred batches <ids> went with it; <r> deferred edit(s) still wait.`, коли такі пакети були. Покинута компактизація відкладених правок не прибирає.

**Черга без відкладених правок** ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06), [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13), [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30), змінено). `NonDeferred(q)` — правки черги без `deferred`; `Applicable(q)` — усі правки, коли `q.applyDeferred` діє (умова SelectEdits), інакше NonDeferred(q). Flush рахує `len(Applicable(q))` усюди, де нині рахує `len(q.edits)`: планування в кінці ходу (разом з `optimize` і TitleDue), ранній вихід, калібрування, гілка застосування, скидання `resume` після покинутої компактизації; KeepOtherSteps після ходу, що не поставив правок, рахує `len(Applicable(q))` (діючий `applyDeferred` веде до застосування, а не до скидання); QueueTagReplacements (`tagsOnly`) і DetectOptimize (порожній хід стискання) рахують `len(NonDeferred(q))`. Черга лише з відкладеними правками без `applyDeferred` Flush не планує й команди не запускає.

**`/compact` людини** ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42), змінено): перше застосування, перед ходом стискання, вибирає за SelectEdits без `applyDeferred`. Хід стискання завершився, черга не має правок без `deferred`, а відкладені є → `applyDeferred = true` і планується Flush; тост COMPACT_NOTHING у цьому разі не показується — людина бачить рядок застосування.

**Передача.** Спосіб «транскрипт»: засів застосовує всі правки черги, відкладені теж ([SP_CTX_02_22](./context_editor.handoff.sp.md#SP_CTX_02_22); правило STRUCT-04). Спосіб «документ»: скидання черги прибирає їх; результат передачі додає `<n> deferred edit(s) were dropped with the old conversation.`, коли n > 0, а наявне число правок черги в результаті передачі (`hooks/handoff.ts`) рахує NonDeferred, щоб відкладені не лічилися двічі.

### 02_11. IdleRun: таймер простою  {#SP_HELP_02_11}

> Implements: [C_HELP_03_04](./context_helper.concept.md#C_HELP_03_04) (мить 2)

Purpose: помітити простій, довший за час життя кешу, і в ньому застосувати відкладені пакети, виконати доручення з умовою `cold` і, якщо агент просив, розбудити його.

**Взведення.** У кінці кожного завершеного, не перерваного основного ходу, після планування Flush, мод ставить таймер `CACHE_TTL_MS + IDLE_SLACK_MS` і запам'ятовує в пам'яті модуля сесію, лічильник ходів модуля (`armedTurns = turns`, той, що читає MovedSince, [SP_CTX §02](./context_editor.sp.md#SP_CTX_02)) і походження `armedBy = turn`; новий таймер замінює попередній. Таймер ставить і StartRun (§02_12) з `armedBy = start`: його ланцюжок почався в `session.start`, тож IdleRun з такого таймера WakeCheck не викликає (I5: пробудження лише з ланцюжка `turn.complete`); доручення з `wake` чекають кінця першого ходу. Таймер живе в процесі хоста: гаряче перезавантаження модуля чи кінець процесу його прибирає; тоді доручення `cold` спрацьовують на першому промпті після простою (§02_09), а відкладені пакети чекають іншої миті (новий процес — StartRun, §02_12). Простою понад годину таймер доживає (зонд DEC_10: 3 900 000 мс, запізнення 8–288 мс; керований мод застосував правку без ходу й без запиту до моделі). Перерваний хід таймера не ставить, а таймер попереднього ходу виходить за MovedSince: після переривання (Esc у терміналі, запит `interrupt` у stream-json) хост відмовляє кожну команду плагіна, доки людина нічого не введе (`the session was stopped and nobody has sent input since`; зонд DEC_10, обидва хости), тож застосування в простої відмовили б, а доручення `cold` спрацюють на першому промпті. Запит `interrupt` у stream-json у простої, без ходу, теж зупиняє сесію (зонд DEC_10, `smoke`): команда таймера відмовлена, гілка відмови нижче. Esc у терміналі в простої, яким людина закрила панель `/cost`, сесії не зупинив (`R1`); інших випадків Esc у простої не перевіряли. Відкрита панель термінала (наприклад, `/cost`) притримує команду до свого закриття.

Processing logic (pseudocode):

    ON idle timer:
        IF session changed OR MovedSince(armedTurns): RETURN           // хід іде або почався від взведення
        IF Temperature(now) = unknown: RETURN
        IF Temperature(now) = warm: re-arm for lastRequestAt + CACHE_TTL_MS + IDLE_SLACK_MS − now; RETURN
        ColdVerdict(now, 'idle')                                   // §02_09 → errands `cold` (§02_07)
        IF queue has a deferred edit OR queue.applyDeferred:
            IF CompactPassed(): status line "context-editor: deferred edits wait: this host passes over the mod's compaction"
            ELSE:
                on the queue chain: applyDeferred = true; coldSince = lastRequestAt
                Calibrate as Flush does (bounded by CALIB_WAIT_MS)
                IF MovedSince(armedTurns): on the queue chain: applyDeferred = false, coldSince absent; RETURN
                applying = true (module memory) … finally applying = false
                run the mod's own compaction with MARKER, one attempt, as Flush runs it   // SP_CTX_02_06
                    a turn that starts before the command runs makes it wait for that turn's end; the handler then sees a newer lastRequestAt and selects by SelectEdits alone
                    no resume prompt and no optimization prompt follow
                    the person's line LogApply as after every apply
                    the report waits in the queue: the wake prompt carries it (§02_08), otherwise the next prompt that passes the mod's hooks (DeliverReport, SP_CTX_02_08)
                ON refusal: on the queue chain: applyDeferred = false, coldSince absent; status line "context-editor: idle apply refused: <error>; deferred edits wait"
        IF armedBy = turn: WakeCheck()                              // §02_08; таймер StartRun — без пробудження (I5)

Пробудження йде після застосування: хід, який воно починає, бачить уже стиснуті рядки, а звіт застосування мод дописує в текст промпту пробудження (§02_08).

### 02_12. StartRun: новий процес  {#SP_HELP_02_12}

> Implements: [C_HELP_03_04](./context_helper.concept.md#C_HELP_03_04) (новий процес), [C_HELP_DEC_10](./context_helper.concept.md#C_HELP_DEC_10)

Purpose: застосувати відкладені пакети, що пережили процес хоста, ще до першого запиту нового процесу, коли кеш уже холодний; коли кеш ще теплий — взвести таймер простою на залишок часу його життя.

Факти зонда DEC_10 (2.1.325, керований мод цієї машини, термінал через GNU screen і stream-json, sonnet; дані — `.dev_flow/cache/live-test/dec10-probe/`): `session.start` настає і в `claude --resume`, і в stream-json з `--resume`; `$.session.id()` у ньому — відновлена сесія, а `$.session.messages()` уже завантажено. Хост не бере першого промпту, доки не закінчиться ланцюжок `session.start` (0,9–1,5 с з керованим модом), а команда, поставлена з `$.clock.after(0)` усередині хука `session.start`, виконалася до цього промпту в 3 з 3 варіантів: людина набрала промпт через 15 с; набрала одразу, ще до `session.start`; stream-json з промптом у stdin від запуску. Запас між кінцем команди й промптом, що вже чекав (набраний одразу; stream-json), — 157–342 мс; з промптом через 15 с — близько 11 с. Що хост гарантує такий порядок, — висновок з прогонів, не документ хоста. Кеш сервера переживає процес: відновлена сесія в межах години читає кеш, записаний попереднім процесом. Повторний вхід для команди з таймера `session.start` хост не пропускає: хук `command.run` самого мода бачить цю команду (з таймера `turn.complete` — ні, «skipped: re-entry»).

Processing logic (pseudocode):

    ON session start (main conversation, new host process), after PrepareStorage:   // не ProbeMode; `/resume` у процесі `session.start` не дає — StartRun немає
        IF Verdict(compact) ≠ reached: RETURN                     // SP_CTX_02_53: на старті — кеш за версією хоста; unknown не досить, зонда не чекає (DEC_09)
        q = read Queue (missing or unreadable → RETURN)
        IF q has no deferred edit OR q.handoff present: RETURN
        clock = later of module memory and the registry for this session (§01_07; the registry unreadable → RETURN)
        SWITCH Temperature(now):
            unknown: RETURN
            warm: arm the idle timer for lastRequestAt + CACHE_TTL_MS + IDLE_SLACK_MS − now (§02_11, armedTurns = turns, armedBy = start); RETURN
            cold:
                on the queue chain: applyDeferred = true; coldSince = lastRequestAt
                plan $.clock.after(0); wait in this hook until its callback has called $.command.run, at most START_WAIT_MS; the hook never awaits the command's promise
                    the callback returns at once when the wait has already ended; otherwise it calls $.command.run first, before any read or write
                    the run: the mod's own compaction with MARKER, one attempt (SP_CTX_02_06), without calibration; the person's line LogApply
                    no resume prompt and no optimization prompt, even when the queue also holds edits without `deferred` or an `optimize` left by the last process: the person or the streaming host is about to send the first prompt
                    the report waits for the first prompt that passes the mod's hooks (DeliverReport, SP_CTX_02_08)
                    ON refusal: on the queue chain: applyDeferred = false, coldSince absent; status line "context-editor: start apply refused: <error>; deferred edits wait"
                ON wait timeout, or the callback failing before $.command.run: the wait ends; on the queue chain: applyDeferred = false, coldSince absent; debug log line

Вердикт «холодний» StartRun не бере: його бере перший промпт (§02_09), бо `lastRequestAt` застосування не змінює; доручення `cold` спрацьовують там. Пробудження StartRun не надсилає: людина чи потоковий хост от-от дадуть промпт.

Застосування StartRun проходить DropPulled обробника компактизації ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)): оригінали, які завантажувач повернув поруч із копіями, відпадають до першого запиту, межа після застосування довірена, і ремонт, запланований на кінець першого ходу ([SP_CTX_02_46](./context_editor.resume.sp.md#SP_CTX_02_46)), бачить `NeedsRepair = false`.

Калібрування перед командою не йде: час до першого промпту — соті частки секунди, а оцінка в рядку людині бере збережене калібрування. Читання черги й реєстру та запис на ланцюжку черги стоять до планування таймера, щоб команда стала в чергу хоста раніше, ніж закінчиться ланцюжок `session.start`. Очікування в хуку має межу START_WAIT_MS: хост не бере першого промпту, доки ланцюжок `session.start` не закінчиться, тож хук без межі тримав би введення людини. Зонд таймер планував і не чекав, і команда однаково стала першою в 3 з 3; очікування з межею — запобіжник порядку, не умова, яку виявив зонд.

Промпту продовження й промпту оптимізації StartRun не надсилає за будь-якого вибору: у черзі, що пережила процес, можуть бути й невідкладені правки (Flush відмовили після переривання, процес закінчився раніше за FLUSH_DELAY) чи `optimize`; обробник застосовує їх разом з пакетами (SelectEdits з `applyDeferred`), звіт чекає першого промпту, а `optimize` — кінця першого ходу.

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| — | вердикт `compact` не `reached`, черга без відкладених правок, запит передачі, годинник невідомий чи теплий | нічого; теплий — таймер простою |
| — | `$.command.run` відмовлено | рядок стану; `applyDeferred` і `coldSince` зняті; пакети чекають |
| — | зворотний виклик не запустив команди за START_WAIT_MS чи впав до неї | очікування закінчено, перший промпт не тримається; `applyDeferred` і `coldSince` зняті; рядок журналу налагодження; пакети чекають |
| — | вердикт `reached` з кешу застарів: мод перевели з керованого плагіна на рівень user на тій самій версії хоста | команда йде повз обробник мода, і хост робить справжній підсумок (залишковий ризик DEC_09); живі ознаки першого ходу виправляють кеш для наступних дій |
| — | промпт випередив команду | команда чекає кінця ходу (як кожна команда); обробник бачить новіший `lastRequestAt` і вибирає за SelectEdits без `applyDeferred`; порожній вибір — `skip "no applicable edits"`, у stream-json видно `Not compacted · context-editor: no applicable edits` (як хибна тривога ремонту, SP_CTX_02_46); запланований потім Flush знаходить чергу за Applicable |

## Changelog

| Date | Change |
|------|--------|
| 2026-11-16 | Розділи перенесено дослівно з [context_helper.sp.md](./context_helper.sp.md): поділ файлу за модулями (11 739 слів, перед виправленнями рев'ю 2 і §02_12 — понад `hard_split`), якорі ті самі (structural-event) |
| 2026-11-16 | Рев'ю 2: див. рядок у [Changelog парасольки](./context_helper.sp.md) |
| 2026-11-16 | §02_12 StartRun за зондом DEC_10; §02_11: таймер лише після завершеного ходу, відмова команд після переривання, простій понад годину виміряно |
| 2026-11-16 | Рев'ю 3: StartRun без промпту продовження й оптимізації; очікування хука з межею START_WAIT_MS; таймер StartRun (`armedBy = start`) без WakeCheck; перевірка гілки збою з `selectedBatches`; Esc у простої в терміналі не перевірено; запас порядку уточнено; `coldSince` ставить і StartRun |
| 2026-11-16 | PL_HELP фаза 2 (код `hooks/cacheclock.ts`): §01_07 — `lastRequestAt` — кінець кроку; відсутнє й погане поле `cache`; ClockMemory за сесією й LastRequest; §02_09 — хук `turn.step` лише пропускає потік і в `finally` ставить кінець кроку; запис реєстру — крок `clock` кінця ходу після лічильника і форк, що відповів; ColdVerdict — у DeliverReport між ходами до входу промпту; підтвердження — перший крок з `usage`, `idle` до початку кроку, журнал лише після запису Confirm; крок без `usage` нічого не перевіряє |
| 2026-11-16 | PL_HELP фаза 2, рев'ю коду: `prev` — з початку кроку; перевірку забирає перший крок з `usage` (StartCheck); `mismatch = null` для кроку в межах CACHE_TTL_MS від останнього запиту; час реєстру не раніший за початок кроку не береться; рядки налагодження збоїв годинника; вердикт промпту без ланцюжка, коли не настав — §02_09 |
