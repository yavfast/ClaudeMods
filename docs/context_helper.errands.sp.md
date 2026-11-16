# Помічник мода — Specification: доручення з умовою — запис доручення, операції, CheckErrands і Fire, доставка в безпечний момент і пробудження

> **Code:** SP_HELP (дочірній файл набору)
> **Status:** draft
> **Created:** 2026-11-16
> **Updated:** 2026-11-16
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
| ASK_QUESTION, ASK_FOLDS, FOLD_UNKNOWN, ASK_MEDIA | для `action: 'ask'` — як у питанні (§02_03); розмір і архів перевіряються в мить спрацювання | — |
| DENIED_STORAGE, DENIED_REGISTRY_READ, DENIED_REGISTRY_WRITE | як для нотаток ([SP_CTX_02_32](./context_editor.stages.sp.md#SP_CTX_02_32)) | — |
| ERRANDS_FULL | доручень MAX_ERRANDS | `<n> errands are set; remove one with errand_remove first.` |

Поточний розмір для `size` — Size (§02_07). Результат: `Errand <id> set: when <умова> → <дія>.`; з `wake: true` додається `If it fires while the session is idle, it wakes you: that turn is a full request, on a cold cache a write of the whole context.` Тексти умов: `<n> turn(s) from now (turn <createdTurn + n>)`; `the request reaches ~<n> tokens, the fixed part included (now ~<cur>)`; `the prompt cache turns cold after an idle of over <CACHE_TTL_MS у хвилинах> min`; `region "<name>" closes` чи `a region closes`. Тексти дій: `remind: "<перші 80 символів>"`; `ask the helper about <ids>: "<перші 80 символів питання>"`; `apply your deferred edits`.

**`errand_list`.** Результат: `Errands: <k> of <MAX_ERRANDS>.` і по рядку на доручення `<id> [<state>]: when <умова> → <дія>[ (wake)]`; без доручень — `No errands.` Відмови — лише спільні й DENIED_STORAGE, DENIED_REGISTRY_READ.

**`errand_remove`.** NO_ERRAND — доручення з таким `id` немає. Доручення в стані `running` знімається; результат його виклику помічника, що повернеться пізніше, мод відкидає. Результат: `Errand <id> removed.`

### 02_07. CheckErrands і Fire  {#SP_HELP_02_07}

Purpose: детерміновано перевірити умови доручень на подіях мода й виконати дію спрацьованих ([C_HELP_DEC_07](./context_helper.concept.md#C_HELP_DEC_07)). Модель умов не перевіряє.

Події:
| Подія | Умови | Де |
|-------|-------|-----|
| TurnEnd | `turns`, `size` | кінець завершеного (не перерваного) основного ходу, після кроку лічильника ходів і до планування Flush: порядок кінця ходу ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)) — DetectOptimize → лічильник ходів → CheckErrands → Flush → WakeCheck (§02_08). Перерваний хід лічильника не крокує ([SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)) і доручень не перевіряє |
| BigOutput | `size` | кожен позначений вивід основного агента (тег `review`, що його ставить AutoTag, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)): коли за кешем реєстру (Store.peek) є доручення `open` з умовою `size`, мод сам читає звичайну `usage` (1–3 мс) до будь-яких воріт м'якого нагадування ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37): `busy`, читабельність реєстру, наявність тегу `review`, Threshold, Step, HINT_CANDIDATES) і перевіряє умови `size`; канал нагадування далі працює за своїми воротами, як нині |
| AreaClosed | `closed` | кожне закриття: `context_tag` close, службові вставки `close` і `optimize` ([SP_FOLD_02_05](./context_folds.sp.md#SP_FOLD_02_05)). Вхід — `closed`: назви областей, закритих цим закриттям (порожній список — закрито блок без області); порт `markDue` отримує цей список разом з `after` |
| ColdVerdict | `cold` | вердикт «холодний» годинника кешу (§02_09) |

**Size** — `context.tokens` звичайної `usage`: увесь останній запит основної розмови з незмінною частиною, як у каналі розміру SP_CTX_02_37 (1–3 мс, без розбивки). На BigOutput до нього додається оцінка позначеного виводу: його символи ÷ `charsPerToken` реєстру (4, коли відношення ще немає, [SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34)). Виміру немає (`tokens` відсутній) — умови `size` не перевіряються.

**Fire(errand, moment)** — лише для доручення в стані `open`, на ланцюжку реєстру:

| Дія | Що робить мод | Стан після |
|-----|---------------|------------|
| `remind` | `result` = рядок доручення + текст агента | `fired` |
| `ask` | ставить `running` і `firedAt`; поза ланцюжком, без очікування подією, запускає питання (§02_03: Split, HelperCall, VerifyQuotes, AskText з першим рядком `Errand <id> asked fold(s) <ids> — …` замість ASKED_HEAD); по завершенні на ланцюжку реєстру: доручення ще є й у стані `running` → `fired` з результатом, обрізаним до MAX_ERRAND_RESULT; журнал `ask` з полем `errand`. Помилки питання (згортки немає, архів не читається, ASK_TOO_BIG, обхід компактизації) дають `fired` з текстом відмови | `running`, потім `fired` |
| `apply` | немає відкладених правок → `result` = рядок доручення + `nothing deferred was queued`; інакше спершу на ланцюжку черги ставить `applyDeferred: true` (без `coldSince`), потім `result` = рядок доручення + `your deferred edits apply after this turn` (TurnEnd, AreaClosed, BigOutput, вердикт на промпті: їх бере Flush кінця ходу, а хід, перерваний людиною, переносить застосування на кінець наступного завершеного ходу) чи `… apply now, in this idle` (вердикт таймера простою, §02_11) | `fired` |

Рядок доручення: `[context-editor] your errand <id> fired (<умова коротко>, set <turn − createdTurn> turn(s) ago): ` — «your» називає автора доручення, бо рядок іде і в тексті промпту, який хост подає як слова людини ([SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17)). Кілька доручень, що спрацювали на одній події, спрацьовують усі; доставка одна (§02_08). Доручення в стані `running`, чий `firedAt` старший за STALE_RUNNING_MS, у мить доставки стає `fired` з текстом `the helper call did not finish: the host process ended or was reloaded`.

Ланцюжки: черга (ранг 1) і реєстр (ранг 2) беруться послідовно, не вкладено ([SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12), CHAIN_RANK).

### 02_08. Доставка в безпечний момент і пробудження  {#SP_HELP_02_08}

> Implements: [C_HELP_DEC_08](./context_helper.concept.md#C_HELP_DEC_08)

Purpose: результати спрацьованих доручень і нагадування нотаток доходять до агента лише з результатом інструмента чи з промптом; агента будить лише доручення з `wake`.

Безпечні моменти:
1. **ToolResult** — завершений, не відхилений виклик інструмента основного агента, та сама точка, що для нагадувань нотаток ([SP_CTX_02_33](./context_editor.stages.sp.md#SP_CTX_02_33)): блок іде в додатковий контекст після результату інструмента хоста чи іншого плагіна, а до результату інструмента мода — у сам результат (крім `context_edit` і `context_handoff`, як нині).
2. **Prompt** — промпт основної розмови, що проходить хук `prompt.submit` мода: промпт людини, промпт `peer` (звіт субагента), промпт іншого плагіна; блок іде в прихований контекст промпту. Нижчий обробник відкинув промпт (`{ drop }`) чи хук кинув виняток (`.catch`) → тим самим одним записом реєстру доручення повертаються як `fired`, а нотатки — з попереднім `remindAt`, як для власних промптів мода. Власні промпти мода хуків мода не проходять (plugin-hooks 25): для них — абзац «Власні промпти мода» нижче.

Блок: рядки нагадувань нотаток, чий хід настав, потім рядки спрацьованих доручень у порядку `firedAt`, разом не довше за MAX_DELIVERY; доручення, що не вмістилися, лишаються `fired` до наступної миті. Доставка одноразова: на ланцюжку реєстру спершу знімаються `remindAt` і видаляються доставлені доручення одним записом; доставка — лише після вдалого запису; збій запису — нічого не доставлено, наступний момент пробує знову (правило нагадувань, SP_CTX_02_33).

**Власні промпти мода** — продовження й промпт оптимізації Flush ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)), промпт ходу стискання `/compact` ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42)), промпт пробудження. Перед надсиланням мод одним записом реєстру знімає блок (як для доставки) і дописує його в кінець тексту промпту. Хост відхилив промпт (`{ drop }`) чи надсилання кинуло виняток → тим самим одним записом доручення повертаються як `fired`, а нотатки — з попереднім `remindAt`. Звіт застосування, що чекає в черзі, промпт пробудження несе так само, як промпт продовження Flush (NoteOnce, SP_CTX_02_06).

**Пробудження (WakeCheck).** Виконується наприкінці кінця ходу (TurnEnd: з цієї миті сесія в простої), наприкінці IdleRun (§02_11), після того як Flush, що не надіслав промпту, зняв `scheduled` ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)), і в повторній перевірці фонового питання (нижче). Умови: хід не йде (пам'ять модуля), лічильник ходів той самий, що в кінці останнього ходу, Flush не заплановано й не йде (IsPlanned, SP_CTX_02_06), власна компактизація мода не йде (пам'ять модуля), запиту передачі немає (`Queue.handoff` відсутній: передача не чекає й не йде, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), серед спрацьованих доручень є `wake: true`, і в цьому простої пробудження ще не було (`wokeAt` у пам'яті модуля не пізніший за `lastRequestAt`). Тоді мод надсилає промпт плагіна з текстом `WAKE_TEXT + "\n\n" + блок` за правилом власних промптів мода; хост відхилив промпт → людина бачить ще й рядок стану `context-editor: could not wake the agent for errand(s) <ids>: <причина>`. Доручення з `wake`, що спрацювало посеред ходу, доставляється звичайно: пробудження не потрібне. Flush заплановано в кінці ходу → блок несе його промпт, а коли Flush промпту не надсилає, пробудження перевіряє його кінець.

**Повторна перевірка фонового питання.** Фонове питання доручення (дія `ask`) може завершитися в простої, але його ланцюжок почався в хуку `tool.call` чи `prompt.submit`, а команду з такого ланцюжка хост відхиляє (походження команди, [SP_CTX §02](./context_editor.sp.md#SP_CTX_02); для промпту плагіна виведено за аналогією, не перевірено). Тому завершення питання саме WakeCheck не викликає. TurnEnd, коли серед доручень є `running` з `wake`, ставить `$.clock.after(WAKE_RECHECK_MS)` з ланцюжка `turn.complete`; зворотний виклик запускає WakeCheck і, поки таке доручення лишається `running`, а його `firedAt` не старший за STALE_RUNNING_MS, ставить себе знову. Таймер, поставлений у зворотному виклику таймера з ланцюжка `turn.complete`, стає в чергу хоста, як і перший (виведено, спостерігається сценаріями Flush, SP_CTX §02). Початий хід повторну перевірку знімає (MovedSince).

Зі своєї причини мод агента не будить: промпт пробудження надсилається лише за дорученням з `wake: true` ([C_CTX_01_01](./context_editor.concept.md#C_CTX_01_01) змінено, §03_03).

## Changelog

| Date | Change |
|------|--------|
| 2026-11-16 | Розділи перенесено дослівно з [context_helper.sp.md](./context_helper.sp.md): поділ файлу за модулями (11 739 слів, перед виправленнями рев'ю 2 і §02_12 — понад `hard_split`), якорі ті самі (structural-event) |
| 2026-11-16 | Рев'ю 2: див. рядок у [Changelog парасольки](./context_helper.sp.md) |
