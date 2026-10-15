# Редактор контексту агента — Specification: Verification: functional expectations — передача і ремонт після відновлення

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> Частина §05_01 Functional Expectations специфікації [SP_CTX](./context_editor.sp.md): модульні очікування (передача і ремонт після відновлення). Читати, коли пишете або звіряєте модульні тести цих контрактів.

## Contents

- Частина таблиці [05_01. Functional Expectations](./context_editor.expectations.sp.md#SP_CTX_05_01): рядки контрактів цього модуля

## 05. Verification Criteria — модульні очікування: передача і ремонт після відновлення

Частина таблиці [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01): контракти [handoff](./context_editor.handoff.sp.md) і [resume](./context_editor.resume.sp.md): `context_handoff`, `/handoff`, RunHandoff, BuildSeed, CheckSeed, HandleSeed, журнал входу, DropPulled, ремонт. Правила назв тестів і позначок `[тест: …]`, `[live only: …]`, `[not covered: …]` — у [context_editor.expectations.sp.md](./context_editor.expectations.sp.md#SP_CTX_05_01).

| Contract | Scenario | Input | Expected outcome |
|----------|----------|-------|------------------|
| BuildSeed | правки й медіа | розмова з парою з PNG, summarize іншої пари, drop третьої | summarize і drop застосовані; PNG незміненої пари записано в `<folder>/1.png`, текст її результату закінчується CarryNote `image/png <path>`; виклику context_handoff немає; жоден рядок не має `handle` |
| BuildSeed | однакові ролі поспіль | два рядки агента підряд | обидва рядки лишаються окремими, CheckSeed їх приймає |
| BuildSeed | модель бачить усе | усі результати є в API-поданні | голови немає, `fromSummary = false`, засів — CurrentRows з правками |
| BuildSeed | після вбудованої компактизації | рядки: 6 старих (результат `a` поза API-поданням), рядок-підсумок, що починається з SUMMARY_OPENER, з `read the full transcript at: …/old.jsonl`, копія тексту агента, пара `b`; API: підсумок, копія, `<system-reminder>`, пара `b` | перший рядок — підсумок без рядка зі шляхом, далі копія і пара `b`; `fromSummary = true`; `<system-reminder>` не перенесено; summarize `a` — `failed` `the model no longer sees this row` |
| BuildSeed | відновлена сесія після `/compact` | CurrentRows після `--resume` починаються з рядка-підсумку (F5), усі результати видно | голови немає, але `fromSummary = true`; звіт нової сесії каже, що вона починається з підсумку; PinSummary закріплює перший рядок |
| BuildSeed | підсумку немає | є результат поза API-поданням, перше повідомлення API — асистента / з `tool_result` / промпт людини без SUMMARY_OPENER | відмова NO_SUMMARY |
| BuildSeed | заповнене вікно при прихованих рядках | є результат поза API-поданням, API-подання — рівно 4096 повідомлень (або читання — 4096 рядків), перше — підсумок | відмова WINDOW_FULL, підсумок не шукається |
| BuildSeed | збіг підсумку | текст рядка-підсумку відрізняється від API лише пробілами й переносами; підсумок коротший за 160 символів | рядок знайдено (порівнюються перші min(160, довжина) символів без пробільних) |
| BuildSeed | нагадування в підсумку | перше повідомлення API: текст підсумку + блок, обрізаний текст якого починається з `<system-reminder>` | голова — лише текст підсумку |
| BuildSeed | підсумок не знайдено | перше повідомлення API — текст, якого немає в жодному рядку людини | відмова SUMMARY_NOT_FOUND |
| BuildSeed | заповнене вікно | 4096 рядків, межі немає, усі результати видно | відмова WINDOW_FULL |
| BuildSeed | завеликий засів | після нормалізації засів довший за ROW_WINDOW − SEED_ROOM рядків | відмова SEED_TOO_LONG до `/clear`; спосіб `document` |
| BuildSeed | підсумок посеред рядків | усі результати видно, але рядок людини, крім першого, починається з SUMMARY_OPENER | гілка прихованих рядків: засів від останнього підсумку |
| BuildSeed | вміст рядком | перше повідомлення API має `content` рядком, що починається з SUMMARY_OPENER | рядок — один текстовий блок; підсумок знайдено |
| BuildSeed | заповнене вікно з межею | 4096 рядків, CurrentRows знайшов межу | засів зібрано |
| BuildSeed | медіа не записалось | запис PNG незміненої пари падає | відмова MEDIA_NOT_ARCHIVED |
| BuildSeed | медіа без даних | document `source.type = url` у незміненій парі (без `media_type` в API-поданні) | CarryNote `document (not carried: no inline data)` — тип береться з `media_type`, а без нього — з типу блоку; засів зібрано |
| BuildSeed | змішане медіа одного власника | незмінена пара: image з даними і document без даних | image записано в `<folder>/1.png`; CarryNote `image/png <folder>/1.png, document (not carried: no inline data)`; засів зібрано |
| BuildSeed | рядок зі шляхом у повній розмові | CurrentRows після `/compact` у цьому процесі починається з підсумку з рядком TRANSCRIPT_LINE | у першому рядку засіву цього рядка немає |
| CheckSeed | порушення | рядок з `handle`; `tool_result` без виклику; виклик без результату; результат після нового промпту; дубль id виклику; перший рядок агента; порожній рядок | кожне — своя причина з таблиці [SP_CTX_02_23](./context_editor.handoff.sp.md#SP_CTX_02_23) |
| CheckSeeded | засів на місці | прочитано: рядок `/clear`, засіяні рядки, два рядки команди | «гаразд» |
| AwaitSeeded | рядки з запізненням | засіяні рядки з'являються в читанні через 50 мс після завершення `compact` (stream-json) | перше читання — `the seeded rows were not found`; після опитувань — «гаразд»; передача вдалася |
| AwaitSeeded | рядків немає | засіяні рядки так і не з'являються | після SEED_WAIT — остання причина; RunHandoff — AfterClear з SEED_NOT_KEPT |
| CheckSeeded | засів не взято | прочитано лише рядок `/clear` і рядки команди | `the seeded rows were not found` |
| CheckSeeded | бракує виклику | засіяні рядки є, один виклик відсутній | `seeded call <id> is missing` |
| CheckSeeded | сесія та сама | `now = old` | `the session id did not change` |
| context_handoff | постановка | mode без значення / `document` / задовгий документ / запит `running` | `transcript` / `document` / DENIED_TOO_LONG / DENIED_RUNNING |
| HandleSeed | засів | засів у пам'яті, сесія нова, `messages` — один рядок `/clear` | повернено рядки засіву, `taken = true`, межу записано в сховище нової сесії з `host` = `hostId` (за наявності) і як власну межу екземпляра |
| HandleSeed | відмови | засіву немає / сесія ≠ `s.new` (стара чи інша) / у `messages` є рядок агента | SKIP_NO_SEED / SKIP_NOT_CLEARED / SKIP_TURN_STARTED; `taken` не змінюється |
| RunHandoff | засів | transcript, усе вдалося | порядок: збирання, файли в `<old storage>/<id>`, `clear`, сховище нової сесії, `compact HANDOFF_MARKER`, CheckSeeded, HandedOff, копії реєстрів, PinSummary, промпт зі звітом і продовженням |
| RunHandoff | збирання відмовило | BuildSeed — WINDOW_FULL | файли засіву видалено; спосіб `document`, документ від окремого запиту до моделі; причина у звіті |
| RunHandoff | хід почався | хід іде або лічильник змінився від планування — до захоплення, після збирання, перед `clear` способу `document` | `deferred`: без захоплення / файли засіву видалено; запит знову `queued` |
| RunHandoff | хід перед `/clear` | `turns` змінився між плануванням і завершенням `clear` (transcript) | AfterClear з `a turn ran before /clear; the seed would miss it`; без другого `clear` (засів не взято); документ або повідомлення |
| RunHandoff | хід перед `/clear` у способі document | те саме, `document` | документ надіслано; промпт називає хід, що лишився в `<old>` |
| RunHandoff | закріплення підсумку | засів з `fromSummary = true` | у скопійованому реєстрі `pin` на перший засіяний рядок, `firstPromptPinned = true` |
| RunHandoff | `/clear` відхилено | `clear` кидає виняток з текстом T | `Fail` з причиною, що містить T; правки лишаються; файли засіву видалено |
| RunHandoff | компактизацію засіву відхилено | `compact` кидає виняток з текстом T | AfterClear без другого `clear` (засів не взято); з документом агента — HandedOff `document`, промпт з T у причині; без документа — FailAfterClear і промпт з `<old>` і шляхом `seed.json` |
| RunHandoff | засів не взято | обробник відповів `skip` | AfterClear з `the seed compaction did not take the seed`, без другого `clear` (засів не взято) |
| RunHandoff | розбіжність | CheckSeeded повертає причину | AfterClear з цією причиною |
| RunHandoff | хід у новій сесії | хід почався після `clear` (`MovedSince(turnsClear)`), HandleSeed відповів SKIP_TURN_STARTED | FailAfterClear; другого `clear` і промпту немає; з документом агента — його копія в `<old storage>/<id>/document.txt`, повідомлення про збій її називає |
| RunHandoff | resume false | спосіб `transcript` | промпту немає; звіт у черзі нової сесії; у старій — нотатка, `reportResume` false |
| RunHandoff | resume false, запасні тексти | `h.resume = false`; документ після збою засіву / повідомлення AfterClear / документ способу `document` | жодного промпту: кожен текст — у звіт черги нової сесії з `reportResume = false` |
| RunHandoff | теги й псевдоніми | реєстри старої сесії | скопійовано в сховище нової сесії до промпту і узгоджено RebindTags; збій копіювання чи узгодження — речення у звіті, засів лишається |
| RunHandoff | псевдонім зміненої пари | `c3` → пара `a`, summarize `a` застосовано в засіві | у новій сесії `ref: c3` — UNKNOWN_REF (з фази 31 — причина ALIAS_GONE `alias c3 is gone: …`; до неї `unknown ref c3`), не TARGET_NOT_FOUND |
| RunHandoff | тег на зміненій парі | `review` на парі `a`, summarize `a` застосовано в засіві | у реєстрі нової сесії тегу немає — так само, як після компактизації в тій самій сесії |
| RunHandoff | disposable з заміною в пакеті засіву | `disposable` на парі `b` з нотаткою N, у пакеті summarize `b` з `summary = N` — застосована або відхилена (зокрема через `pin`) | у реєстрі нової сесії тегу немає (пакет `s.edits` — до перевірки `pin`) |
| RunHandoff | збій узгодження реєстру | RebindTags кидає виняток | реєстр у нову сесію не записано; у звіті « Tags and aliases were not carried over.» |
| RunHandoff | незмінена пара | `c4` і `pin` на парі `b`, правок до `b` немає | у новій сесії `ref: c4` розв'язується на `b`; `pin` на `b` лишився |
| RunHandoff | пара поза засівом | тег і псевдонім на парі, рядки якої лишились до підсумку (`fromSummary`) | видалено: цілі в засіяних рядках немає |
| cancelHandoff | скасування | запит `queued` / `running` без `handoffInFlight` / `running` під час `handoffInFlight` | знятий зі звітом / знятий зі звітом / без змін |
| RunHandoff | покинутий запуск із засівом | `running`, старший за HANDOFF_STALE, у сховищі є `<id>/seed.json` з `id ≥ at` | запит знято зі звітом «not re-run»; RunHandoff — `nothing` |
| context_handoff | перерваний хід запиту | запит агента, `requestTurn = turns`, хід перервано / після перезавантаження модуля (`requestTurn` відсутній) | запит знято / запит лишається і запуститься після наступного кінця ходу |
| RunHandoff | відкладено, хід уже скінчився | хід, що відклав передачу, скінчився до повернення RunHandoff (`deferred`, `inTurn = false`) | `handoffScheduled` скинуто до виклику; другий RunHandoff через HANDOFF_DELAY без жодного нового ходу |
| RunHandoff | виняток до `/clear` | виняток після захоплення, до `/clear` | один Fail з `failed: <error>`, файли засіву видалено; запит не лишається `running`; `handoffInFlight = false` |
| RunHandoff | Fail кидає до `/clear` | запис старої черги в Fail падає | одна спроба, повтору немає; спливне повідомлення; `handoffInFlight = false` |
| RunHandoff | виняток після `/clear`, transcript | виняток у Seed до AfterClear | один AfterClear: з документом агента — HandedOff `document` і документ; без документа — FailAfterClear і повідомлення з шляхом `seed.json` |
| RunHandoff | виняток усередині AfterClear | крок AfterClear кидає | перехоплено в AfterClear: жодного ще одного `/clear`, один FailAfterClear, без повторної доставки; спливне повідомлення називає крок |
| RunHandoff | HandedOff падає після `/clear`, document | запис HandedOff у стару чергу кидає виняток | документ усе одно доставлено; спливне повідомлення називає крок HandedOff і радить `/handoff cancel`; FailAfterClear немає; результат `document` |
| RunHandoff | Deliver документа падає після `/clear` | сховище чи черга нової сесії недоступні: `resume = false` / хід почався між `/clear` і Deliver (шлях черги) / AfterClear з документом агента; або хост відхилив промпт документа (виняток чи `drop`) — тоді спливне повідомлення з текстом відмови хоста | результат `document`; копія тексту в `<old storage>/<id>/document.txt` (`id` — засіву, коли він є, інакше час); спливне повідомлення називає крок deliver і цей файл; копію не записано — «The document is lost» [тест: «DocumentWay — Deliver лише в черзі падає»; «DocumentWay — хід між /clear і Deliver»; «AfterClear з документом — Deliver падає»; «HandDocument — промпт відхилено»] |
| Due | running без handoffInFlight | `running`, `handoffInFlight = false`, старший за HANDOFF_STALE / молодший | належний / ні (поле `owner` не читається) |
| RunHandoff | хід перед компактизацією засіву | `MovedSince(turnsClear)` безпосередньо перед `compact HANDOFF_MARKER` | команди немає; AfterClear → FailAfterClear без другого `clear` |
| RunHandoff | засів не взято, сесія порожня | компактизацію засіву відхилено (`taken = false`) | AfterClear без другого `clear`; документ або повідомлення через Deliver [тест: «RunHandoff — компактизацію засіву відхилено»] |
| HandleSeed | інша сесія | засів у пам'яті, поточна сесія ≠ `s.new` | SKIP_NOT_CLEARED; нічого не записано |
| RecordInputs | запис входу | вхід застосування: промпт з `handle` h1, рядок асистента h2 з викликом `a`, рядок результату `a` h3, рядок `user` без результатів h4, рядок асистента без `handle`; обробник повернув рядки (фаза 32) | запис `{ at: reportId, handles: [h2, h3] }` на ланцюжку `ledger` після точки фіксації; обробник його не чекає |
| RecordInputs | обрізання / нечитабельний журнал | журнал із записами, разом 49 990 `handle`, новий запис — 20 / `ledger.json` `unreadable` | найстаріші записи прибрано, доки Σ ≤ MAX_LEDGER_HANDLES / файл перенесено в `.bad-<ms>`, новий журнал з одним записом |
| RecordInputs | без запису | обробник відповів `skip` / диспетчеризацію покинуто / HandleSeed / HandleRepair | журнал не дописується (HandleRepair очищує його після ремонту) |
| DropPulled | двійник за ідентифікаторами | журнал {h1, h2}; рядки: оригінал виклику `a` (h1), оригінал результату `a` з повним текстом (h2), копія виклику `a` (h5), копія результату `a` з текстом `summarize` (h6) | прибрано обидва оригінали; лишились копії — правка в силі |
| DropPulled | текстова відповідь і thinking | оригінал асистента «alpha-one» (у журналі) і копія з тим самим текстом у тому самому відрізку / копія в іншому відрізку / оригінал лише з thinking | прибрано / лишається / прибрано |
| DropPulled | без двійника | оригінали промпту T1, виклику і результату T1 з журналу, копій немає (обхід через межу, сесія b спайку) | нічого не прибрано; промпт не прибирається ніколи |
| DropPulled | паралельні виклики | оригінал з викликами `a`, `b`; копії `a` і `b` окремими рядками (MergeCallRows) | оригінал прибрано |
| DropPulled | залишкове правило | журнал порожній, `applied = true`: два однакові рядки виклику `a` / результат `a` повний і з текстом заміни / два різні результати `a` без заміни; `applied = false` з тими самими рядками | лишається останній / лишається заміна / обидва лишаються / нічого не прибрано; `residual` лічить прибране |
| NeedsRepair | новий процес | межа з `host` іншого процесу, запис журналу, рядки з оригіналом і копією | `true` |
| NeedsRepair | той самий процес чи нічого лагодити | межа довірена (Trusted) / `compactedHere` = сесія / журнал порожній і журнал ефекту без `apply` / жодного журнального `handle` з двійником | `false`, команди немає |
| ScheduleRepair | одна спроба | `session.start` двічі для тієї самої сесії / після відмови команди | один таймер REPAIR_DELAY_MS на сесію; повтору немає |
| ScheduleRepair | перемикання в процесі | PrepareStorage опублікував іншу сесію (`/resume`); далі кінець ходу | `repairAtTurnEnd = true`; таймер ставить AfterTurn після лічильника ходів і до Flush; з `tool.call` і `prompt.submit` — ніколи |
| RunRepair | ремонт | NeedsRepair `true`; команда повертається, обробник лишив `lastRepair` цієї сесії з `dropped = 7` | `$.command.run({ command: 'compact', args: REPAIR_MARKER })` один раз; `$.ui.log` `repaired the resumed conversation: dropped 7 row(s) loaded twice`; стан `done` |
| RunRepair | відмова і перемикання | команда кидає «no session is bound in this process» / сесія змінилась до таймера / обробник відповів `skip` | стан `failed`, рядок стану REPAIR_REFUSED з текстом відмови, повтору немає / команди немає / стан `failed`, рядка людини немає |
| HandleRepair | ремонт | вхід 30 рядків, 10 оригіналів з двійником (сесія c спайку), промпти з `handle` | повернено рядки без оригіналів і без порожніх (лише thinking); жоден рядок асистента чи результатів не має `handle`, промпти зберігають; пари цілі; межу записано; журнал очищено; `compactedHere` і `lastRepair` |
| HandleRepair | медіа і доставки | незмінений результат з PNG / запис файлу не вдався / доставка в `deliveries.json` за перебудованим результатом | файл `<storage>/<id>/1.png` і CarryNote у тексті результату / `skip media could not be written`, нічого не записано / доставка вставлена рядком `user` після результату і прибрана з файлу |
| HandleRepair | нічого не робить | жодного журнального `handle` з двійником / журнал `unreadable` / передача йде / диспетчеризацію покинуто перед фіксацією / після прибирання виклик без результату | `skip nothing to repair` / `ledger unreadable` / `handoff running` / `compaction abandoned`, реєстри як були / `repair would break pairs: …` |
| HandleRepair | збій | виняток в обробнику ремонту | `skip repair failed` одразу; справжнього підсумку немає; нічого не записано |
| ToolRefText | ToolSearch | результат з `text ""`, API-подання з `tool_reference` `WebFetch` / текст непорожній / виклику немає в API-поданні | TOOLREF_TEXT з `WebFetch` / текст без змін / `""` |
| BuildSeed | після відновлення | рядки з оригіналом і копією виклику `a` (журнал старої сесії) / журналу немає, `applied`, два однакові рядки `a` | засів без повтору, CheckSeed приймає / залишкове правило прибирає повтор, CheckSeed приймає |
| RunHandoff | довгий хід під час `/clear` | `/clear` чекає кінця ходу довше за HANDOFF_STALE; кінець цього ходу знову перевіряє Due | другого запуску немає (`handoffInFlight`); `context_handoff` і `/handoff` — DENIED_RUNNING, запит не замінюється |
| HandoffCommand | планування | `/handoff` між ходами | Schedule(): знімок `turns0`, запуск через HANDOFF_DELAY; під час `handoffInFlight` — DENIED_RUNNING |
| RunHandoff | сесія змінилась під час засіву | після `compact` поточна сесія ≠ створеної `/clear` | FailAfterClear; другого `clear`, промпту і запису в поточну сесію немає |
| RunHandoff | хід одразу після `/clear` | `inTurn` після завершення `clear` | AfterClear → FailAfterClear без другого `clear`; повідомлення — у звіт черги нової сесії, `reportResume = false` |
| RunHandoff | людина активна перед відправкою | засів вдався, але `MovedSince(turnsClear)` перед відправкою звіту | звіт — у черзі нової сесії з `reportResume = false`, промпту немає |
| PinSummary | реєстр нової сесії | реєстру немає / повний (MAX_TAGS) / нечитабельний | створено з одним `pin` / `pin` не поставлено, звіт називає причину / те саме |
| BuildSeed | вікно посеред пари | перший рядок — результат без виклику | сирітські результати прибрано, перший рядок — людини; без рядка людини — відмова EMPTY |
| BuildSeed | describe без зіставлення | те саме для засіву | файлів немає; `failed = [describe #0: no media or pasted text found in that row now]`; текст промпту без змін |
| BuildSeed | медіа в промпті після підсумку | рядки: результат поза API, рядок-підсумок, відповідь, промпт; API починається з підсумку, далі промпт з image; `describe` промпту | PromptMatch на видимих рядках; один файл, шлях у рядку з описом; `fromSummary = true`; `unmatchedPromptMedia = 0` [тест: «BuildSeed — після підсумку: prompt media in the rows after a built-in compaction summary»] |
| BuildSeed | медіа в промптах | два промпти з медіа, `describe #0` | записано лише медіа #0, шлях — у його рядку; `unmatchedPromptMedia = 1` (незмінений #2) |
| BuildSeed | паралельні виклики в окремих рядках | незмінені `tool_use a`, `tool_use c` окремими рядками, спільний рядок результатів | у засіві один рядок з обома викликами, за ним результати; CheckSeed приймає |
| BuildSeed | засів без правок | черга порожня або всі правки `failed`; у рядках є виклик `context_list` | звіт нової сесії без рядка розміру; без `failed` — без речення про правки взагалі; з `failed` — `no queued edit was applied. Not applied: …` |
| BuildSeed | засів з правками | ≥ 1 правку застосовано; у рядках є незмінена пара з медіа | рядок розміру: `charsBefore` — видимі рядки, `charsAfter` — після ApplyEdits і DropOwnCalls, до CarryNote і голови |
| context_handoff | обхід | `passed` | DENIED_PASSED_OVER; запиту немає |
| HandoffCommand | обхід | `passed`; `/handoff`, потім `/handoff cancel` при запиті з черги | відмова без запису; `cancel` знімає запит, як завжди |
| RunHandoff | обхід на запуску | запит `queued`, вердикт став `passed` до таймера | команди немає; запит `done` зі звітом HANDOFF_PASSED_OVER |
| ScheduleRepair | перший хід процесу | новий процес: `session.start`; потім кінець першого ходу при `working`; окремо — при `passed` | таймера з `session.start` немає; ремонт планується на кінці ходу; при `passed` — ні |
| PrepareSeed | файли засіву | передача `transcript` з медіа / засів відкладено або `/clear` відмовлено | `seed.json` у `<oldDir>/<id>/`, архів і медіа в `<oldArchives>/<id>…` / RemoveSeedFiles видаляє всі три |
| BuildSeed | NowIndex у засіві | засів із `summarize a` | звіт нової сесії називає `summarize a (now #k)`, де `k` — індекс рядка результату в засіяному списку (`produced`, після голови, якщо вона є, і нормалізації); `report.applied` — `summarize a` |
| RunHandoff | етапи в новій сесії | відкритий етап і `lastClosed`, `introduced = true` у старій сесії | у реєстрі нової сесії межі перенесено RelocateMark з `s.visible` на `s.rows`; `introduced = false` |
| BuildSeed | доставки в засіві | доставка за незміненою парою, доставка за парою з summarize | обидва рядки доставок — після своїх рядків результату; CheckSeed приймає; `charsAfter` без них |
| RunHandoff | автор тексту (CF-8) | `/handoff` людини (DEFAULT_RESUME), засів; `document` агента D з `resume_prompt` P | промпт закінчується `\n\ncontext-editor: Continue the task from where you stopped.`; промпт `DOCUMENT_FRAME\n\nD\n\ncontext-editor: this session continues <old> (document).\n\ncontext-editor: the resume prompt you set before the handoff: P`; з `resume: false` той самий текст документа — у звіті черги нової сесії |
| DocumentWay | рамка запиту форку | передача без `document`; порт `fork` записує свій промпт (фаза 31, CF-43) | промпт — HANDOFF_PROMPT: починається з `context-editor: this request is the mod's, not the person's`, закінчується `leave them out of the document.` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Рядки §05_01 перенесено дослівно з [context_editor.expectations.sp.md](./context_editor.expectations.sp.md): поділ таблиці за модулями (structural-event) |
