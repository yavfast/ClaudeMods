# Помічник мода — Specification: доручення з умовою — запис доручення, операції, CheckErrands і Fire, доставка в безпечний момент і пробудження

> **Code:** SP_HELP (дочірній файл набору)
> **Status:** draft
> **Created:** 2026-11-16
> **Updated:** 2026-11-17
> **Umbrella:** [SP_HELP](./context_helper.sp.md)
>
> §01_05 і §02_06–02_08 специфікації [SP_HELP](./context_helper.sp.md): доручення з умовою, перевірка умов, доставка результату в безпечний момент і пробудження. Читати, коли змінюєте доручення чи доставку.

## Contents

Розділи цього файлу (позначення типів — як у [§01 парасольки](./context_helper.sp.md#SP_HELP_01)):

- [01_05. Errand](#SP_HELP_01_05)
- [02_06. Доручення: операції `errand_add`, `errand_list`, `errand_remove`](#SP_HELP_02_06)
- [02_07. CheckErrands і Fire](#SP_HELP_02_07)
- [02_08. Доставка в безпечний момент і пробудження](#SP_HELP_02_08)

## 01. Data Structures

### 01_05. Errand  {#SP_HELP_01_05}

Доручення з умовою в реєстрі сесії (`tags.json`, поля `errands` і `nextErrand`, [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10)).

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | string | yes | — | ERRAND_PREFIX + номер з `nextErrand`; номер не повторюється в сесії | Ідентифікатор для агента |
| when | Condition | yes | — | див. нижче | Умова |
| action | Action | yes | — | див. нижче | Дія |
| wake | bool | yes | false | — | Будити агента, якщо доручення спрацювало в простої |
| createdTurn | int | yes | — | лічильник ходів у мить постановки | Для умови `turns` і рядка доставки |
| state | `'open' \| 'running' \| 'fired'` | yes | `'open'` | — | `running` — дія «питання помічнику» виконується; `fired` — результат чекає доставки |
| result | string | для `fired` | — | ≤ MAX_ERRAND_RESULT | Текст для доставки |
| firedAt | int | для `running` і `fired` | — | час | Коли спрацювало |

Condition:
| kind | Поля | Спрацьовує, коли |
|------|------|------------------|
| `turns` | `n`: int, 1..MAX_REMIND | `turn − createdTurn ≥ n` у кінці ходу |
| `size` | `n`: int, токени, більше за Size (§02_07) у мить постановки, ≤ MAX_SIZE_TOKENS | Size ≥ `n` |
| `cold` | — | годинник кешу дав вердикт «холодний» (§02_09) |
| `closed` | `name?`: string, ≤ MAX_STAGE_NAME | без `name` — будь-яке закриття (AreaClosed, §02_07), зокрема блоку без області; з `name` — серед областей, закритих цим закриттям, є область з точно цією назвою |

Action:
| kind | Поля | Результат |
|------|------|-----------|
| `remind` | `text`: string, 1..MAX_NOTE | текст агента |
| `ask` | `folds`: string[], `question`: string — як у питанні (§02_03) | відповідь помічника з перевіреними цитатами, зібрана в мить спрацювання |
| `apply` | — | застосування відкладених пакетів і рядок про нього |

Invariants:
- Доручень (усіх станів) не більше MAX_ERRANDS.
- Доручення спрацьовує один раз: зі стану `open` переходить у `running` чи `fired` і назад не повертається; після доставки зникає.
- `wake` діє лише в простої (§02_08).

Уточнення реалізації (PL_HELP фаза 7, 2026-11-17; `isErrand`, `badErrandFields` у `hooks/errands.ts`). Читання реєстру перевіряє кожне доручення: `id` — ERRAND_PREFIX і число без провідних нулів; `when` і `action` мають рівно поля своїх рядків таблиць (`n` для `turns` 1..MAX_REMIND, для `size` 1..MAX_SIZE_TOKENS; `name` — непорожній після обрізання, ≤ MAX_STAGE_NAME; `text` 1..MAX_NOTE; `folds` — непорожній список рядків; `question` — непорожній рядок); `result` є лише в `fired` і ≤ MAX_ERRAND_RESULT; `firedAt` — скінченне число в `running` і `fired`, у `open` його немає; `id` не повторюються, і число кожного менше за `nextErrand` (≥ 1, відсутнє — 1). Порушення робить реєстр `unreadable` (`bad field(s): errands` чи `nextErrand`). `text` і `name` мод зберігає обрізаними. `wake` ставить лише `errand_add` (булеве значення; не булеве — ERRAND_WAKE, §02_06); `errand_list` показує його як ` (wake)`.

## 02. Contracts

### 02_06. Доручення: операції `errand_add`, `errand_list`, `errand_remove`  {#SP_HELP_02_06}

> Implements: [C_HELP_03_03](./context_helper.concept.md#C_HELP_03_03)

Purpose: агент ставить, переглядає й знімає доручення. Кожна операція — одна зміна реєстру на його ланцюжку.

**`errand_add`.** Errors (у порядку перевірки, після спільних):
| Code | Condition | Guidance |
|------|-----------|----------|
| HELPER_PASSED_OVER | `action` `ask` чи `apply`, а хост обходить компактизацію мода | доручення з нагадуванням працюють |
| ERRAND_WHEN | `when` відсутнє чи поза переліком; `n` для `cold`/`closed`; `name` не для `closed` | називає поля умови |
| ERRAND_N | `n` поза межами; для `size` — не більше за поточний Size | `the request is already ~<cur> tokens, the fixed part included` |
| ERRAND_ACTION | `action` відсутнє чи поза переліком; поля іншої дії | називає поля дії |
| ERRAND_TEXT | `remind` без тексту чи довше за MAX_NOTE | називає межу |
| ERRAND_WAKE | `wake` не булеве (`true` чи `false`); перевіряється одразу після ERRAND_TEXT, до перевірок питання | `"wake" is true or false` |
| ASK_QUESTION, ASK_FOLDS | для `action: 'ask'` — як у питанні (§02_03), у цьому порядку | — |
| DENIED_STORAGE | сховище недоступне, як для нотаток ([SP_CTX_02_32](./context_editor.stages.sp.md#SP_CTX_02_32)) | — |
| FOLD_UNKNOWN, ASK_MEDIA | для `action: 'ask'` — як у питанні (§02_03): облік згорток читається раз, поза ланцюжками; нечитний облік — FOLD_UNKNOWN; розмір і архів перевіряються в мить спрацювання | — |
| DENIED_REGISTRY_READ, ERRANDS_FULL, DENIED_REGISTRY_WRITE | на ланцюжку реєстру, у цьому порядку; READ і WRITE — як для нотаток | ERRANDS_FULL: `<n> errands are set; remove one with errand_remove first.` |

Порядок DENIED_STORAGE перед FOLD_UNKNOWN і ASK_MEDIA — той самий, що в питанні (§02_03): облік згорток лежить у сховищі, тож без сховища його не читають (рішення коду фази 7, 2026-11-17; до нього таблиця ставила DENIED_STORAGE після перевірок згорток). Спільні відмови, перші для всіх операцій доручень: DENIED_SUBAGENT (§02_02) і BAD_OP, який будує `badHelperOp`: невідомий `op` — `"op" is "ask", "errand_add", "errand_list" or "errand_remove" (BAD_OP)`; поле іншої операції (з `folds`, `question`, `when`, `n`, `name`, `action`, `text`, `wake`, `id`) — `"<op>" takes no "<поле>"[, "<поле>"…]; it takes "<поле>", … (BAD_OP)`, для `errand_list` — `…; it takes no other field (BAD_OP)`. `wake` бере лише `errand_add` (`ERRAND_FIELDS.errand_add`); для `ask`, `errand_list` і `errand_remove` поле з `wake` — BAD_OP. Операція `ask` свій BAD_OP перевіряє сама (§02_03). Тексти відмов: ERRAND_WHEN — `"when" is "turns" (with "n"), "size" (with "n"), "cold" or "closed" (with an optional "name")`, `"<when>" takes no "n"`, `"name" goes only with "when": "closed"`, `"name" is a region's name of 1..<MAX_STAGE_NAME> chars`; ERRAND_N — `"n" is a number of turns in 1..<MAX_REMIND>`, `"n" is a number of tokens up to <MAX_SIZE_TOKENS>`, `the request is already ~<cur> tokens, the fixed part included`; ERRAND_ACTION — `"action" is "remind" (with "text"), "ask" (with "folds" and "question") or "apply"`, `"text" goes only with "action": "remind"`, `"folds" and "question" go only with "action": "ask"`; ERRAND_TEXT — `"remind" needs "text" of 1..<MAX_NOTE> chars`; ERRAND_WAKE — `"wake" is true or false`; NO_ERRAND — `no errand <id>; errand_list lists them`; кожен з кодом у дужках.

Поточний розмір для `size` — Size (§02_07), прочитаний перед ERRAND_ACTION; Size невідомий (виміру немає чи читання впало) — перевірки «не більше за поточний» немає, а текст умови — без `(now ~<cur>)`. Результат: `Errand <id> set: when <умова> → <дія>.`; з `wake: true` додається `If it fires while the session is idle, it wakes you: that turn is a full request, on a cold cache a write of the whole context.` Тексти умов: `<n> turn(s) from now (turn <createdTurn + n>)`; `the request reaches ~<n> tokens, the fixed part included (now ~<cur>)`; `the prompt cache turns cold after an idle of over <CACHE_TTL_MS у хвилинах> min`; `region "<name>" closes` чи `a region closes`. Тексти дій: `remind: "<перші 80 символів>"`; `ask the helper about <ids>: "<перші 80 символів питання>"`; `apply your deferred edits`.

**`errand_list`.** Результат: `Errands: <k> of <MAX_ERRANDS>.` і по рядку на доручення `<id> [<state>]: when <умова> → <дія>[ (wake)]`; без доручень — `No errands.` Умова в переліку: `turns` — `turn <createdTurn + n> (set at turn <createdTurn>)` (хід, коли спрацює, а не «from now»: перелік читають пізніше за постановку); решта — тексти `errand_add` (для `size` — без `(now ~<cur>)`). Відмови — лише спільні й DENIED_STORAGE, DENIED_REGISTRY_READ. Перелік — лише читання, без ланцюжка.

**`errand_remove`.** NO_ERRAND — доручення з таким `id` немає; без `id` (чи не рядок) — `"id" is an errand id, e.g. "e1"; errand_list lists them`. Доручення в стані `running` знімається; результат його виклику помічника, що повернеться пізніше, мод відкидає (FinishAsk не знаходить доручення). Результат: `Errand <id> removed.` Відмови — спільні, DENIED_STORAGE, на ланцюжку реєстру — DENIED_REGISTRY_READ, NO_ERRAND, DENIED_REGISTRY_WRITE.

Результат кожної операції доручень, крім відмови, несе блок доставки (§02_08) після свого тексту, як решта інструментів мода ([SP_CTX_02_33](./context_editor.stages.sp.md#SP_CTX_02_33)); операція `ask` блоку не несе: її пара повертається слідом (§02_05), і блок пішов би з нею.

### 02_07. CheckErrands і Fire  {#SP_HELP_02_07}

Purpose: детерміновано перевірити умови доручень на подіях мода й виконати дію спрацьованих ([C_HELP_DEC_07](./context_helper.concept.md#C_HELP_DEC_07)). Модель умов не перевіряє.

Події:
| Подія | Умови | Де |
|-------|-------|-----|
| TurnEnd | `turns`, `size` | кінець завершеного (не перерваного) основного ходу з текою сховища, після кроку лічильника ходів і до планування Flush: порядок кінця ходу ([SP_CTX §02](./context_editor.sp.md#SP_CTX_02), [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)) — DetectOptimize → лічильник ходів → запис годинника (`clock`) → CheckErrands (`errands`) → ремонт після перемикання (`repair`) → Flush → таймер простою (`idle`) → WakeCheck (§02_08, фаза 8). Перерваний хід лічильника не крокує ([SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)) і доручень не перевіряє |
| BigOutput | `size` | кожен вивід основного агента, що отримав позначку (рядок псевдоніма MarkCall, WorthEditing, [SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16); той самий «позначений вивід», що в каналі розміру): коли за кешем реєстру (Store.peek) є доручення `open` з умовою `size` чи реєстр ще невідомий (WantsSize), мод сам читає звичайну `usage` (1–3 мс) до будь-яких воріт м'якого нагадування ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37): `busy`, читабельність реєстру, наявність тегу `review`, Threshold, Step, HINT_CANDIDATES) і перевіряє умови `size`; `tokens` відсутній — події немає; канал нагадування далі працює за своїми воротами, як нині |
| AreaClosed | `closed` | кожне закриття: `context_tag` close (і закриття, яке робить `open`), службові вставки `close` і `optimize` ([SP_FOLD_02_05](./context_folds.sp.md#SP_FOLD_02_05)). Вхід — `closed`: назви областей, закритих цим закриттям, від зовнішньої (порожній список — закрито блок без області); порт `markDue` отримує цей список разом з `after` і після позначки згаданого запускає CheckErrands. Мітка блоку, який інструмент закрив у цьому самому ході, лише позначає закрите раніше: `closed` відсутній, CheckErrands не запускається ([SP_FOLD_02_06](./context_folds.sp.md#SP_FOLD_02_06)) |
| ColdVerdict | `cold` | новий вердикт «холодний» годинника кешу (§02_09): першого промпту між ходами (`idle = false`, до входу промпту, тож блок цього промпту вже несе те, що спрацювало) чи таймера простою (`idle = true`, до решти IdleRun) |

**Size** — `context.tokens` звичайної `usage`: увесь останній запит основної розмови з незмінною частиною, як у каналі розміру SP_CTX_02_37 (1–3 мс, без розбивки). На BigOutput до нього додається оцінка позначеного виводу: його символи ÷ `charsPerToken` реєстру (4, коли відношення ще немає, [SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34)), округлено. Виміру немає (`tokens` відсутній) — умови `size` не перевіряються. Size мод читає лише тоді, коли може спрацювати доручення `size` (WantsSize: за кешем реєстру є доручення `open` з умовою `size`, чи реєстр ще невідомий або нечитний); інакше TurnEnd іде без Size, а BigOutput не йде зовсім (рішення коду фази 7, 2026-11-17).

**Fire(errand, moment)** — лише для доручення в стані `open`, на ланцюжку реєстру:

| Дія | Що робить мод | Стан після |
|-----|---------------|------------|
| `remind` | `result` = рядок доручення + текст агента | `fired` |
| `ask` | ставить `running` і `firedAt`; поза ланцюжком, без очікування подією, запускає питання (§02_03: Split, HelperCall, VerifyQuotes, AskText з першим рядком `Errand <id> asked fold(s) <ids> — …` замість ASKED_HEAD); по завершенні на ланцюжку реєстру (FinishAsk): доручення ще є й у стані `running` → `fired` з результатом = рядок доручення + AskText, обрізаним до MAX_ERRAND_RESULT; журнал `ask` з полем `errand`. Помилки питання (згортки немає, облік нечитний, архів не читається, ASK_TOO_BIG, обхід компактизації — власний текст ERRAND_ASK_PASSED_OVER `this host passes over the mod's compaction hook, so the helper is not asked there; open the original with Read at the path in the fold record.`, бо в доручення пари немає) дають `fired` з текстом відмови; виняток виклику — `the helper call failed: <помилка>`. Питання з доручення запису Question не пише й QUESTIONS_FULL не перевіряє: пари немає | `running`, потім `fired` |
| `apply` | немає відкладених правок → `result` = рядок доручення + `nothing deferred was queued`; інакше спершу на ланцюжку черги ставить `applyDeferred: true` (без `coldSince`; позначку, що вже без `coldSince`, лишає), потім `result` = рядок доручення + `your deferred edits apply after this turn` (TurnEnd, AreaClosed, BigOutput, вердикт на промпті: їх бере Flush кінця ходу, а хід, перерваний людиною, переносить застосування на кінець наступного завершеного ходу) чи `… apply now, in this idle` (вердикт таймера простою, §02_11) | `fired` |

Рядок доручення: `[context-editor] your errand <id> fired (<умова коротко>, set <turn − createdTurn> turn(s) ago): ` — «your» називає автора доручення, бо рядок іде і в тексті промпту, який хост подає як слова людини ([SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17)). Кілька доручень, що спрацювали на одній події, спрацьовують усі; доставка одна (§02_08). Доручення в стані `running`, чий `firedAt` старший за STALE_RUNNING_MS, у мить доставки стає `fired` з текстом `the helper call did not finish: the host process ended or was reloaded`.

Уточнення реалізації (PL_HELP фаза 7, 2026-11-17; рішення коду):
- **Умова коротко** в рядку доручення: `<n> turn(s)`, `~<n> tokens`, `cold cache`, `region "<name>" closed` чи `a region closed`; `turn` — лічильник реєстру в мить запису результату (для `ask` — кінця питання).
- **Кожен результат** починається рядком доручення, і `ask` теж: рядок + AskText доручення, перший рядок якого — `Errand <id> asked fold(s) <ids> — …` (ASKED_HEAD замінено на `Errand <id> asked `, тож результат за пару питання не впізнається). AskText обрізається до місця, яке рядок лишає в межах MAX_ERRAND_RESULT (цитати — з кінця, як MAX_ASK_RESULT у §02_03); готовий результат ще раз обрізається до MAX_ERRAND_RESULT. Відмова питання й `the helper call failed: …` ідуть після рядка так само.
- **`apply`**: текст результату вибирає те, чи мала черга відкладені правки, коли CheckErrands ставив позначку: спершу ланцюжок черги (позначка й відповідь «були / не було»), потім ланцюжок реєстру (Fire з цією відповіддю).
- **CheckErrands**: відомий за кешем реєстр, у якому жодна умова не справджується на події, не бере ні ланцюжка, ні читання; інакше — `apply` спершу на черзі, потім Fire одним записом реєстру (Update), потім фонові питання `running`. Збій лишає доручення `open` з рядком налагодження `context-editor: errands not checked: <помилка>`; виняток поза цим (зв'язування) — `context-editor: CheckErrands failed: <помилка>`, збій фонового питання поза ним — `context-editor: errand question failed: <помилка>` (обидва — quietFailure). Подію не зупиняє жоден з них.
- **AreaClosed** іде після MarkDue на ланцюжку обліку згорток (ранг 4), потім на ланцюжку реєстру — один за іншим.

Ланцюжки: черга (ранг 1) і реєстр (ранг 2) беруться послідовно, не вкладено ([SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12), CHAIN_RANK).

**Позначка доручення `apply`** (рецензія фази 7, рішення агента): `applyDeferred: true` без `coldSince` (ErrandMarked, `hooks/batches.ts`). IdleRun і StartRun її не переписують (IdleMarked не додає `coldSince`) і не знімають, коли хід випередив команду, хост відхилив її чи обробник пропустив (WithoutIdleMark знімає лише їхню власну позначку); знімає її лише застосування, що взяло пакети, чи черга без жодної правки. Так рядок `… apply now, in this idle` не лишається без застосування: пакети бере найближче застосування. Доручення `apply`, чию умову черговий крок черги не бачив (його не було в прочитаному реєстрі, а на ланцюжку реєстру воно вже є), лишається `open` до наступної події, а не спрацьовує з APPLY_NOTHING. Чисті частини прив'язок — MarkApply (рішення черги через Update), OutputSize (Size + символи виводу ÷ `charsPerToken`, PLAIN_RATIO без нього), ErrandRoom (місце AskText після рядка доручення); реєстр `missing` для WantsSize — відомий (`usage` не читається).

### 02_08. Доставка в безпечний момент і пробудження  {#SP_HELP_02_08}

> Implements: [C_HELP_DEC_08](./context_helper.concept.md#C_HELP_DEC_08)

Purpose: результати спрацьованих доручень і нагадування нотаток доходять до агента лише з результатом інструмента чи з промптом; агента будить лише доручення з `wake`.

Безпечні моменти:
1. **ToolResult** — завершений, не відхилений виклик інструмента основного агента, та сама точка, що для нагадувань нотаток ([SP_CTX_02_33](./context_editor.stages.sp.md#SP_CTX_02_33)): блок іде в додатковий контекст після результату інструмента хоста чи іншого плагіна (після рядків псевдоніма й пропозиції), а до результату інструмента мода — у сам результат (крім `context_edit` і `context_handoff`, як нині, а також `context_recall` і операції `ask` `context_helper`: їхня пара повертається слідом, і блок пішов би з нею; операції доручень блок несуть).
2. **Prompt** — промпт основної розмови, що проходить хук `prompt.submit` мода: промпт людини (зокрема посеред ходу), промпт `peer` (звіт субагента), промпт іншого плагіна; блок іде в прихований контекст промпту останнім — після вступу, звіту, поради й пропозиції ([SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)). Нижчий обробник відкинув промпт (`{ drop }`) чи хук кинув виняток (`.catch`) → тим самим одним записом реєстру доручення повертаються як `fired`, а нотатки — з попереднім `remindAt`, як для власних промптів мода. Власні промпти мода хуків мода не проходять (plugin-hooks 25): для них — абзац «Власні промпти мода» нижче.

Блок: рядки нагадувань нотаток, чий хід настав, потім рядки спрацьованих доручень у порядку `firedAt`, разом не довше за MAX_DELIVERY; доручення, що не вмістилися, лишаються `fired` до наступної миті. Доставка одноразова: на ланцюжку реєстру спершу знімаються `remindAt` і видаляються доставлені доручення одним записом; доставка — лише після вдалого запису; збій запису — нічого не доставлено, наступний момент пробує знову (правило нагадувань, SP_CTX_02_33).

Уточнення реалізації (PL_HELP фаза 7, 2026-11-17; ClaimBlock, RestoreBlock, SubmitWithBlock у `hooks/errands.ts`, рішення коду):
- Порядок блоку — нагадування (усі, чий хід настав, від найстаріших), потім доручення `fired` за `firedAt`; межу MAX_DELIVERY рахує довжина рядків блоку разом з переводами рядків. Перше доручення, що не вміщується, зупиняє набір: воно й пізніші лишаються `fired` до наступної миті (пізніше коротше доручення його не випереджає). Нагадування межею не обрізаються.
- У тому самому записі доручення `running`, старше за STALE_RUNNING_MS, стає `fired` з текстом загубленого виклику (§02_07) і може піти цим же блоком; запис іде й тоді, коли доставити нічого.
- Ворота DeliveryPending: кеш реєстру знає реєстр, і в ньому немає нотатки з `remindAt` чи доручення не в стані `open` → ні ланцюжка, ні читання.
- RestoreBlock одним записом повертає доручення як `fired` (крім тих, чий `id` уже є в реєстрі) і `remindAt` нотаткам, що ще є й нагадування не мають; збій — рядок налагодження `context-editor: delivery put back failed: <помилка>`, блок утрачено.
- Prompt: блок останній у прихованому контексті; знімається в теці сховища хука. Власний промпт мода: блок — у кінці тексту через порожній рядок; знімається в теці поточної сесії. Промпт Deliver передачі блоку не несе.

**Збій взяття блоку** ([ERR-01]): нечитний реєстр чи невдалий запис — блоку немає, у журнал налагодження рядок `context-editor: delivery not claimed: <причина>`; наступна мить пробує знову.

**Власні промпти мода** — продовження й промпт оптимізації Flush ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)), промпт ходу стискання `/compact` ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42)), промпт пробудження. Перед надсиланням мод одним записом реєстру знімає блок (як для доставки) і дописує його в кінець тексту промпту (фаза 7: продовження й промпт ходу стискання Flush — порт FlushIO `submit`; промпт пробудження — фаза 8, `submit` порту WakeIO). Хост відхилив промпт (`{ drop }`) чи надсилання кинуло виняток → тим самим одним записом доручення повертаються як `fired`, а нотатки — з попереднім `remindAt`. Звіт застосування, що чекає в черзі, промпт пробудження несе так само, як промпт продовження Flush (NoteOnce, SP_CTX_02_06).

**Пробудження (WakeCheck).** Виконується наприкінці кінця ходу (TurnEnd: з цієї миті сесія в простої), наприкінці IdleRun (§02_11), після того як Flush, що не надіслав промпту, зняв `scheduled` ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)), і в повторній перевірці фонового питання (нижче). Умови: хід не йде (пам'ять модуля), лічильник ходів той самий, що в кінці останнього ходу, Flush не заплановано й не йде (IsPlanned, SP_CTX_02_06), власна компактизація мода не йде (пам'ять модуля), запиту передачі немає (`Queue.handoff` відсутній: передача не чекає й не йде, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), серед спрацьованих доручень є `wake: true`, і в цьому простої пробудження ще не було (`wokeAt` у пам'яті модуля не пізніший за `lastRequestAt`). Тоді мод надсилає промпт плагіна за правилом власних промптів мода: звіт застосування, що чекає (NoteOnce), `WAKE_TEXT`, WaitingAdvice, кожне через порожній рядок, і блок у кінці (уточнення 2 нижче); хост відхилив промпт → людина бачить ще й рядок стану `context-editor: could not wake the agent for errand(s) <ids>: <причина>`. Доручення з `wake`, що спрацювало посеред ходу, доставляється звичайно: пробудження не потрібне. Flush заплановано в кінці ходу → блок несе його промпт, а коли Flush промпту не надсилає, пробудження перевіряє його кінець.

**Повторна перевірка фонового питання.** Фонове питання доручення (дія `ask`) може завершитися в простої, але його ланцюжок почався в хуку `tool.call` чи `prompt.submit`, а команду з такого ланцюжка хост відхиляє (походження команди, [SP_CTX §02](./context_editor.sp.md#SP_CTX_02); для промпту плагіна виведено за аналогією, не перевірено). Тому завершення питання саме WakeCheck не викликає. TurnEnd і IdleRun, чий таймер поставив хід (доручення `cold` з дією `ask` спрацьовує в ньому, і його питання йде у фоні), коли серед доручень є `running` з `wake`, ставлять `$.clock.after(WAKE_RECHECK_MS)` з ланцюжка `turn.complete`; зворотний виклик запускає WakeCheck і, поки таке доручення лишається `running`, а його `firedAt` не старший за STALE_RUNNING_MS, ставить себе знову. Таймер, поставлений у зворотному виклику таймера з ланцюжка `turn.complete`, стає в чергу хоста, як і перший (виведено, спостерігається сценаріями Flush, SP_CTX §02). Початий хід повторну перевірку знімає (MovedSince), так само інша сесія (`/clear`, `/resume`, передача): перевірка пам'ятає сесію, в якій її поставлено.

Уточнення реалізації (PL_HELP фаза 8, 2026-11-17; `wakeCheck`, `wakeSteps`, `armRecheck`, `cancelRecheck` у `hooks/errands.ts`, `WAKE_TEXT` у `hooks/rows.ts`, `wakeIO` у `hooks/register.ts`, рішення коду):
1. Перерваний хід WakeCheck не запускає: переривання — не простій, у якому будять агента; CheckErrands теж іде лише для завершених ходів. WakeCheck — останній крок порядку кінця ходу (після Flush і таймера простою), лише для завершеного ходу.
2. Текст промпту пробудження: спершу звіт застосування, що чекає (NoteOnce), потім WAKE_TEXT (`<PREFIX> an errand you set fired while the session was idle, and you asked to be woken for it.`), потім WaitingAdvice (як у промпті продовження Flush, [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37): цей промпт жодного хука мода не проходить), потім блок. Після вдалого надсилання — AdviseWaiting і RemoveDelivered звіту; збій видалення звіту лишає його до наступного промпту.
3. Ворота: кеш реєстру знає реєстр, і в ньому немає доручення з `wake`, що чекає доставки (`fired`, чи `running` і застаріле), — нічого не читається (результат `none`). Одне пробудження на простій: `wokeAt` ставиться в тому самому синхронному кроці, що й остання перевірка умов, до взяття блоку; після взяття перевірка ходу йде ще раз; взяття без доручення з `wake` чи початий хід повертає блок і відновлює `wokeAt`. Блок промпту пробудження бере доручення з `wake` першими (далі — за `firedAt`), тож повний блок їх не витісняє (ClaimBlock з `wakeFirst`). Відхилений промпт лишає `wokeAt` (простій має одну спробу), повертає блок і виставляє рядок стану. Умова «власна компактизація мода йде» — OwnCompaction: команда IdleRun чи StartRun, команда ремонту, передача (запланована чи в ході); Flush перевіряє IsPlanned. Запланований ремонт не рахується: кожен процес планує його в кінці першого ходу, здебільшого він команди не запускає, а команда, яку запускає, чекає кінця розбудженого ходу (живий прогін S2: з урахуванням запланованого ремонту перший хід процесу не будив).
4. ERRAND_WAKE — `"wake" is true or false` для не булевого `wake`, одразу після ERRAND_TEXT, до перевірок `ask` (§02_06).
5. Повторну перевірку ставить лише відомий кеш реєстру з `running` дорученням `ask` з `wake`, що не застаріло; нове ставлення скасовує попереднє (`recheckSeq`); таймер, який хост відхилив, лишає рядок налагодження `wake recheck refused: <помилка>`; зворотний виклик, чий хід минув чи чия сесія вже інша, нічого не робить; збій зворотного виклику — рядок `wake recheck failed: <помилка>`, непрочитана сесія — `wake recheck: the session not read: <помилка>` (перевірку не поставлено); незаписана позначка поради — `wake: the advice not marked: <помилка>`.
6. Рядки налагодження (кожен з префіксом `context-editor: `): `wake check: <результат>` (результати `moved`, `flush-planned`, `compacting`, `woken`, `handoff`, `nothing`, `woke`, `refused`; `none` — ворота — рядка не лишає), `wake check: the tag registry cannot be read (<причина>)`, `wake check: the queue cannot be read (<причина>)`, `wake check failed: <помилка>`.
7. Flush: WakeCheck іде наприкінці Flush, що не надіслав ні промпту продовження, ні промпту оптимізації, з `turns0` Flush, після зняття `scheduled`; не після Flush, який запланував `/compact` людини (ланцюжок `command.run`, I5), і не після відхиленої команди чи промпту Flush ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)). IdleRun — у кінці прогону, лише коли таймер поставив хід (`armedBy` `turn`, з `armedTurns`), і не для результатів `moved` (хід, інша сесія), `unknown`, `rearmed`; там же ставиться повторна перевірка; таймер StartRun WakeCheck не викликає.

Зі своєї причини мод агента не будить: промпт пробудження надсилається лише за дорученням з `wake: true` ([C_CTX_01_01](./context_editor.concept.md#C_CTX_01_01) змінено, §03_03).

## Changelog

| Date | Change |
|------|--------|
| 2026-11-16 | Розділи перенесено дослівно з [context_helper.sp.md](./context_helper.sp.md): поділ файлу за модулями (11 739 слів, перед виправленнями рев'ю 2 і §02_12 — понад `hard_split`), якорі ті самі (structural-event) |
| 2026-11-16 | Рев'ю 2: див. рядок у [Changelog парасольки](./context_helper.sp.md) |
| 2026-11-17 | PL_HELP фаза 7 (за кодом `hooks/errands.ts`): §01_05 — перевірка доручення при читанні реєстру, обрізані `text` і `name`, `wake` до фази 8 — `false`; §02_06 — DENIED_STORAGE перед FOLD_UNKNOWN і ASK_MEDIA (як у питанні), READ/ERRANDS_FULL/WRITE на ланцюжку, спільні відмови й тексти BAD_OP (`badHelperOp`, `wake` — BAD_OP), тексти відмов, Size невідомий, `turns` у переліку — `turn <createdTurn + n> (set at turn <createdTurn>)`, блок доставки після результату операцій доручень (не `ask`); §02_07 — порядок кінця ходу з `clock`, `repair`, `idle`; BigOutput — позначений вивід MarkCall, WantsSize; AreaClosed з `open` і мітка блоку, закритого в цьому ході; ColdVerdict `idle`; уточнення: умова коротко, рядок доручення в кожному результаті й місце AskText, текст `apply` за відповіддю черги, CheckErrands і рядки налагодження; §02_08 — `context_recall` і `ask` блоку не несуть, блок останній у прихованому контексті, уточнення ClaimBlock і RestoreBlock |
| 2026-11-17 | PL_HELP фаза 8 (за кодом `hooks/errands.ts`): §01_05 — `wake` ставиться `errand_add`; §02_06 — ERRAND_WAKE (рядок таблиці, текст), `wake` — BAD_OP лише для інших операцій; §02_08 — уточнення реалізації 1–7 (перерваний хід, текст і порядок промпту пробудження, ворота й одне пробудження на простій, перевірка ERRAND_WAKE, повторна перевірка, рядки налагодження, WakeCheck у Flush і IdleRun), абзац «Власні промпти мода» — промпт пробудження зроблено |
| 2026-11-17 | Рецензія фази 7 (рішення агента): §02_07 — позначка доручення `apply` переживає власні IdleRun і StartRun; `apply` без вердикту черги лишається `open`; MarkApply, OutputSize, ErrandRoom — чисті функції; WantsSize — реєстр `missing` відомий; §02_06 — `errand_remove` без `id`; §02_08 — збій взяття блоку з рядком налагодження |
