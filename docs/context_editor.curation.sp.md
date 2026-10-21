# Редактор контексту агента — Specification: курування історії

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-21
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
> **Children:** [edits](./context_editor.curation.edits.sp.md) — джерело й поля правок, слова людини, `describe`, відкривачі, перевірка залежностей, слід, застаріле читання, готові заміни, піни, правила й тексти навички (active); [slot](./context_editor.curation.slot.sp.md) — пункти слота стану й операція `state` (active); [hostrows](./context_editor.curation.hostrows.sp.md) — рядки хоста (active); [verification](./context_editor.curation.verification.sp.md) — критерії перевірки (active)
> **Concept:** [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)
> **Spikes:** [context_editor_uses](./context_editor_uses.spike.md), [context_editor_hostrows](./context_editor_hostrows.spike.md)
> **Depends on:** [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04), [SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07), [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12), [SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16), [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18), [SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27), [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29), [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)
> **Used by:** —
>
> Курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)) у термінах контрактів: структури (походження, пункти слота стану, нові поля правок і тегів, записи рядків хоста, константи), контракти (правило слів людини з відмовою при постановці й застосуванні, `describe` для вставок, запис рядків хоста і їх список з `id`, тексти замін з походженням, перевірка залежностей, слід власних викликів, застаріле читання й готові заміни, операція `state`, піни, правила й тексти навички), перевірки, життєві цикли, критерії перевірки, відкат і рішення SP_CTX_DEC_39–DEC_44. Парасолька курування тримає константи, перевірки, відкат і рішення; структури, контракти, життєві цикли й критерії — у дочірніх файлах (Children). Наявні контракти, які курування змінює, лишаються у своїх файлах із посиланням сюди. Читати перед реалізацією будь-якого механізму курування.

## Contents

- [01. Data Structures — курування](#SP_CTX_01_32) — константи курування; джерело заміненого змісту й поля правок і тегів — у [edits](./context_editor.curation.edits.sp.md#SP_CTX_01_27), пункт слота стану — у [slot](./context_editor.curation.slot.sp.md#SP_CTX_01_29), записи рядків хоста — у [hostrows](./context_editor.curation.hostrows.sp.md#SP_CTX_01_31)
- [02. Contracts — курування](./context_editor.curation.edits.sp.md#SP_CTX_02_58) — слова людини, `describe` для вставок, відкривачі замін, перевірка залежностей, слід власних викликів, застаріле читання, готові заміни, піни, правила й тексти навички — у edits; операція `state` — у [slot](./context_editor.curation.slot.sp.md#SP_CTX_02_67); запис рядків хоста і їх список з `id` — у [hostrows](./context_editor.curation.hostrows.sp.md#SP_CTX_02_60)
- [03. Validation Rules — курування](#SP_CTX_03_03) — що перевіряється на вході агента і в результаті застосування
- [04. State Transitions — курування](./context_editor.curation.slot.sp.md#SP_CTX_04_08) — життєвий цикл пункту слота стану (slot) і запису рядків хоста ([hostrows](./context_editor.curation.hostrows.sp.md#SP_CTX_04_09))
- [05. Verification Criteria — курування](./context_editor.curation.verification.sp.md#SP_CTX_05_05) — модульні очікування, інваріанти, живі сценарії, граничні випадки (verification)
- [06. Reversibility — курування](#SP_CTX_06_02) — як вимкнути кожен механізм і що лишається
- [07. Design Decisions — курування](#SP_CTX_DEC_39) — де лежить специфікація, форма статусу та його зняття після воріт, операція слота стану, як агент бачить і прибирає рядки хоста, де правила курування

## 01. Data Structures — курування

Структури 01_27, 01_28, 01_30 — у [edits](./context_editor.curation.edits.sp.md), 01_29 — у [slot](./context_editor.curation.slot.sp.md), 01_31 — у [hostrows](./context_editor.curation.hostrows.sp.md).

### 01_32. Curation Constants  {#SP_CTX_01_32}

| Name | Value | Meaning |
|------|-------|---------|
| MAX_SOURCE | 120 | Найбільша довжина Source, символи |
| MAX_STATE_ITEMS | 40 | Найбільше пунктів слота стану і змін в одній правці `state` |
| MAX_STATE_ITEM | 500 | Найбільша довжина тексту пункту, символи |
| ARCHIVE_ROOM | 600 | Запас SLOT_TOO_LONG при постановці на рядок архіву (≈ довжина кореня проєкту + 110) і номери нових пунктів, символи |
| MAX_DEP_FRAGMENTS | 100 | Найбільше фрагментів оригіналу, які шукає DependencyCheck |
| DEP_MIN, DEP_MAX | 6, 120 | Межі довжини фрагмента, символи |
| DEP_EXAMPLES | 3 | Скільки фрагментів називає застереження |
| MAX_HOST_ROWS | 200 | Найбільше записів рядків хоста; старіші йдуть першими |
| MAX_HOST_TEXT | 100000 | Найбільше символів тексту в записі |
| MAX_HEAD | 80 | Найбільша довжина голови попереднього рядка в записі й голови рядка хоста в списку, символи |
| MAX_HOST_LIST | 20 | Скільки найновіших записів список показує повними рядками |
| MAX_TRACE | 400 | Найбільша довжина рядка сліду, символи |
| CURATION_MAX | 6000 | Найбільша довжина файлу правил курування `curation.md`, символи ([SP_CTX_DEC_43](#SP_CTX_DEC_43)) |
| SKILL_FRAME | `Base directory for this skill: ` | Початок розгорнутого тексту навички |
| PEER_FRAME | `Another Claude session sent a message:\n<agent-message` | Початок звіту субагента між ходами; обидві рамки й HostFrame живуть у `rows.ts` (STRUCT-01) |
| SUMMARIZED_OF, TAG_SUMMARIZED_OF | `Later, your context_edit summarize call replaced the full output of `, `Later, your context_tag disposable tag replaced the full output of ` | Голови відкривачів `summarize` з джерелом |
| DESCRIBED_HEAD | `Later, your context_edit describe call replaced the ` | Голова кожного відкривача `describe` |
| STATE_REBUILT | `Later, your context_edit state call rebuilt your state slot here from its items` | Відкривач рядка слота після `state` |
| TRACE_OPENER | `Later, your context_* calls here were removed when your edits applied` | Відкривач рядка сліду |

## 03. Validation Rules — курування

### 03_03. Input Validation  {#SP_CTX_03_03}

- Поля статусу правки й теги не мають ([SP_CTX_DEC_44](#SP_CTX_DEC_44)): `status` мод ігнорує, як будь-яке зайве поле (checkShape правки, isTag тегу).
- Правка, що захоплює слова людини, відхиляється при постановці (PERSON_WORDS) і не застосовується (PERSON_WORDS_NOW); тег `disposable` над ними не ставиться (PERSON_TAG). `describe` дозволено над промптом людини, коли в ньому є медіа чи вставка.
- Правка `state` вимагає слота і пунктів, на які посилається; `rewrite` слота з пунктами і `rewrite` слота поряд із `state` в одному пакеті відхиляються.
- `drop` з `host` бере `id` зі списку рядків хоста і не бере `tool_use_id` чи `ref` (HOST_EXCLUSIVE, HOST_UNKNOWN, HOST_TWICE); інші операції рядків хоста не бачать.
- `context_list` з `"rules": true` інших параметрів не бере, а `"rules"` — лише `true` (BAD_RULES).

### 03_04. Output Validation  {#SP_CTX_03_04}

- Кожна заміна, яку пише ця версія, починається з повного відкривача чи голови з REPLACEMENT_OPENERS, говорить від імені агента і, для `summarize`, називає джерело; слів статусу в ній немає.
- Набраний людиною текст рядка після `describe` той самий, що в оригіналі, з позначками вставок на їхніх місцях.
- Текст із рамкою хоста ніколи не рахується словами людини (PersonText порожній); після застосування лишаються лише записи, чий попередник повернувся зі своїм `handle`; рядок перед прибраним рядком хоста повертається без `handle`, а результат і звіт кажуть, що він утратив.
- Текст слота стану після застосування `state` — рівно STATE_REBUILT, рядок архіву й Assemble(items).
- Рядок сліду стоїть лише у відрізку, де застосування прибрало власні пари.

## 06. Reversibility — курування

### 06_02. Rollback Strategy  {#SP_CTX_06_02}

| Aspect | Rollback approach |
|--------|-------------------|
| Data/state changes | `hostrows.json` можна видалити: список рядків хоста порожніє, а самі рядки лишаються в розмові. Полів `quoted` правок, `items`, `nextItem`, `docChecked` реєстру старіша версія не бачить: її розбір пропускає зайві поля (parseRegistry зливає невідомі поля верхнього рівня, checkShape і isTag зайвих ключів не перевіряють). Ламають її розбір лише причина `superseded` тегу `review`, операція `state` і `drop` з `host` у черзі: реєстр чи черга для неї `unreadable`. Перед поверненням версії — прибрати теги `superseded` (або видалити `tags.json` сесії) і застосувати чи видалити чергу з правками `state` і `drop` з `host` |
| Artifacts | `skills/context-stages/curation.md` прибирається разом із рядком навички про нього |
| Dependent modules | тексти замін цієї версії лишаються в збережених сесіях як інертний текст; старіша версія не розпізнає нових голів як заміну, тож позначки `*` переліку й R5 їх не бачать — прийнято |
| External contracts | параметри `state`, `"rules"` і ціль `host` правки `drop` зникають з інструментів; повернення попередження замість відмови — у PersonWarnings ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)); повернення R1 — рядок таблиці [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11) |

Кожен механізм відокремлюваний ([C_CTX_06_12](./context_editor.curation.concept.md#C_CTX_06_12)): правила навички відкочуються текстом, тексти замін — як у [C_CTX_DEC_25](./context_editor.core.concept.md#C_CTX_DEC_25), список рядків хоста — без запису `hostrows.json` і без цілі `host`.

## 07. Design Decisions — курування

### DEC_39 — Де лежить специфікація курування  {#SP_CTX_DEC_39}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Головний файл специфікації (21.7 тис. слів), структури (19.3 тис.) й очікування (25.3 тис.) уже понад `hard_split` (12 тис.), а Docs Scaling вимагає ділити файл, перш ніж додавати новий матеріал. Де розмістити специфікацію курування?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — окремий файл курування з власними структурами, контрактами, станами, перевірками, відкатом і рішеннями; у головному файлі — рядок таблиці файлів і покажчик рішень | великі файли не ростуть; наявні контракти отримують посилання сюди; поділ великих файлів — окремий пункт backlog |
| B — спершу поділити великі файли, потім дописати курування за нинішнім розкладом | окремий великий коміт перед специфікацією |
| C — дописати в наявні файли з записаним обґрунтуванням | файли ростуть понад межу |

**Decision:** A — розробник, 2026-10-15: «Окремий файл курування (Recommended)».
**Rationale:** курування — окрема відповідальність, як і в концепті ([C_CTX_DEC_32](./context_editor.concept.md#C_CTX_DEC_32)); новий матеріал не йде у файли понад межу.
**Rejected because:** B — затримує специфікацію великим поділом; C — порушує Docs Scaling.

### DEC_40 — Форма епістемного статусу  {#SP_CTX_DEC_40}

> **Status:** superseded
> **Date:** 2026-10-15

**Question:** Концепт лишив специфікації, чи статус один на заміну, чи стоїть і біля окремих фактів ([C_CTX_06_06](./context_editor.curation.concept.md#C_CTX_06_06)).

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — один на правку, обов'язковий для `summarize` і `collapse`, необов'язковий для `rewrite` і `describe`, без нього для `drop` | агент щоразу каже, наскільки надійний переказ; окремі факти позначає своїми словами |
| B — один на правку, необов'язковий | без статусу відкривач мовчить, як зараз |
| C — позначки біля фактів, які мод перевіряє й переносить у відкривач | точніше, але мод розбирає текст агента |

**Decision:** A — розробник, 2026-10-15: «Один на правку, обов'язковий (Recommended)».
**Rationale:** переказ чужого змісту — саме те місце, де виведене плутають із прочитаним; обов'язковий статус змушує агента сказати це щоразу, а мод не розбирає тексту.
**Rejected because:** B — статус пропускатимуть; C — мод розбирав би вільний текст агента.
**Superseded:** 2026-10-15 — [SP_CTX_DEC_44](#SP_CTX_DEC_44): ворота фази 39 показали, що слова статусу майже не змінюють довіри агента; статус знято з правок, тегів і відкривачів, заміна несе лише джерело.

### DEC_41 — Якою операцією змінюються пункти слота стану  {#SP_CTX_DEC_41}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Концепт лишив специфікації форму дельти слота стану: параметри переписування чи окрема операція ([C_CTX_06_08](./context_editor.curation.concept.md#C_CTX_06_08)).

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — операція `state` у `context_edit`: дельти add, set, mark, remove; пункти в реєстрі, текст збирає застосування | пункти й текст змінюються разом, як решта правок |
| B — параметр `items` у `rewrite` | без нової операції, але `rewrite` має два режими |
| C — через `context_tag` | реєстр змінюється одразу, текст — на застосуванні, тож перегляд показує пункти раніше, ніж вони є в розмові |

**Decision:** A — розробник, 2026-10-15: «Операція state у context_edit (Recommended)».
**Rationale:** зміна пунктів — правка рядка слота, тож вона йде тим самим шляхом і тим самим застосуванням, що й інші правки.
**Rejected because:** B — два режими однієї операції; C — розбіжність реєстру й розмови до застосування.

### DEC_42 — Як агент бачить і прибирає рядки хоста  {#SP_CTX_DEC_42}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Як мод робить рядки хоста видимими агенту і як агент їх прибирає? Обробник компактизації їх не отримує (`ledger.json`: 157 рядків входу застосування, жодного `isMeta`), а після застосування хост сам ставить кожен за видимим рядком перед ним, якщо той повернувся з `handle` (спайк [context_editor_hostrows](./context_editor_hostrows.spike.md), Q4, Q6).

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — після наступного застосування: мод записує їх із виходу власного застосування | неможливо: у виході обробника рядків хоста немає |
| B — одразу при додаванні: хук `session.append` читає розмову, щоб знайти місце | читання розмови в цьому хуку не перевірене (ризик затримки чи блокування запису) |
| B′ — серед рядків перегляду на їхніх місцях: запис при `session.append` з `handle` попередника, віртуальні рядки в перегляді й застосуванні | у перегляді `handle` немає, тож потрібні ще відбитки попередника; якір змагається з копіями застосування; два раунди рев'ю знаходили тут `must` |
| B″ — окремий список з `id`: запис при `session.append` з `handle` попередника, список у `context_list`, `drop` за `id` | видно одразу; індекси рядків не змінюються; якір потрібен лише в застосуванні, а там `handle` є; рядки, що прийшли у вікні копій (звіти одразу після `/compact` мода), поза списком; попередник прибраного рядка втрачає `handle` |
| C — не показувати рядків хоста | P24 лишається: розгорнуті навички й звіти субагентів займають контекст до кінця сесії |

**Decision:** B″ — розробник, 2026-10-15: «Окремий список з id (Recommended)». Перша відповідь, «Після наступного застосування (Recommended)» (A), спиралася на засновок, який спростувало рев'ю.
**Rationale:** рядків хоста немає ні в перегляді, ні у вході обробника, тож розміщувати їх серед індексів означало б будувати віртуальні рядки й два якорі для одного рядка. Список з `id` прибирає цю частину: якір — лише `handle`, а застосування його має; `handle` = `uuid` транскрипту показали `ledger.json` і ремонт фази 32 ([SP_CTX_02_45](./context_editor.resume.sp.md#SP_CTX_02_45)). Вікно копій замість перевірки походження: від синхронного скидання на початку кожної гілки компактизації до наступного ходу чи промпту людини жоден рядок не стає попередником.
**Rejected because:** A — неможливо; B — читання розмови в хуку не потрібне, коли якір є в пам'яті модуля; B′ — складніше, і два раунди рев'ю знаходили в ньому `must`; C — лишає вади P24.

### DEC_43 — Де лежать правила курування  {#SP_CTX_DEC_43}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Посібник навички SKILL.md має 8198 з 9000 символів, а правила курування потребують ще приблизно 2–2.5 тис. Як бути?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — підняти межу SKILL.md до 11 000 | усі правила в посібнику першого промпту; ~+500 токенів на початку кожної сесії |
| B — окремий файл навички, на який посилається посібник; агент читає його, коли курує | дешевше; правила можуть лишитися непрочитаними |
| C — у пораді закриття етапу й описах інструментів | порада закриття довшає на кожному етапі |

**Decision:** B — розробник, 2026-10-15: «Окремий файл навички».
**Rationale:** правила курування потрібні, коли агент курує, а не на кожному початку сесії. Читання поза проєктом хост дозволяє лише з дозволу людини ([C_CTX_DEC_28](./context_editor.core.concept.md#C_CTX_DEC_28)), а встановлений мод лежить поза проєктом, тож файл віддає сам мод: `context_list` з `"rules": true` ([SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69)); посібник каже, коли його відкрити. Чи агент справді відкриває правила, перевіряють живі прогони.
**Rejected because:** A — ціна на кожному початку сесії; C — ціна на кожному закритті етапу.

### DEC_44 — Статус змісту в заміні після воріт  {#SP_CTX_DEC_44}

> **Status:** resolved
> **Date:** 2026-10-15

**Question:** Ворота текстів замін (фаза 39, [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07), `.dev_flow/cache/live-test/curation-gate/texts/results.md`) показали: з джерелом у відкривачі агент визнає стискання своїм (28 з 28 сесій з джерелом і статусом, 9 з 9 у контролі з поточними текстами; P13, P23 не повертаються, хоча у варіантах зі статусом траплялись 1 заперечення власних викликів і 2 «вигадав» при малому n), але слова статусу довіри майже не змінюють. Чи лишати обов'язковий статус ([SP_CTX_DEC_40](#SP_CTX_DEC_40))?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — джерело й обов'язковий статус ([SP_CTX_DEC_40](#SP_CTX_DEC_40), A) | агент щоразу вибирає статус, мод тримає перелік, відмови STATUS_REQUIRED і BAD_STATUS, правило навички й місце в описах інструментів — заради ефекту, якого ворота не показали |
| B — лише джерело, без статусу | менше полів, відмов і тексту в описах; надійність окремих фактів агент за потреби називає своїми словами в тексті заміни |
| C — сильніші слова статусу й ще один прогін воріт | ще одна фаза воріт перед кодом без певності, що сильніші слова подіють |

**Decision:** B — розробник, 2026-10-15: «Лише джерело, без статусу».
**Rationale:** у другому раунді воріт (haiku, 5 сесій на варіант, впевненість 0–100 у стиснутому після застосування) контроль (поточні тексти, без джерела й статусу) — 94.6, `read` — 91.4, `inferred` — 93.8, `assumed` — 86.0; позначку `assumed` згадано лише у 2 з 5 відповідей, а незалежний доказ у тому самому контексті тягне впевненість угору у всіх варіантах. Критерій «частіше перевіряє виведене й припущене» не доведено, тож статус коштує полів, відмов і місця в описах без виміряного ефекту. Авторство тримає джерело й власний відкривач, а не статус.
**Rejected because:** A — ціна без ефекту; C — затримує код текстів замін ще однією фазою воріт без підстави чекати іншого результату.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-21 | Фаза 47 ([SP_CTX_DEC_45](./context_editor.decisions-21.sp.md#SP_CTX_DEC_45)): ARCHIVE_ROOM — запас від довжини кореня проєкту сесії, не робочого каталогу |
| 2026-10-17 | structural-event (аудит dev-flow, Docs Scaling `hard_split`: 14 640 слів): поділ на дочірні файли за модулями, розділи перенесено дослівно, якорі незмінні — [edits](./context_editor.curation.edits.sp.md) (01_27, 01_28, 01_30, 02_58, 02_59, 02_62, 02_63, 02_64, 02_65, 02_66, 02_68, 02_69), [slot](./context_editor.curation.slot.sp.md) (01_29, 02_67, 04_08), [hostrows](./context_editor.curation.hostrows.sp.md) (01_31, 02_60, 02_61, 04_09), [verification](./context_editor.curation.verification.sp.md) (05_05, 05_06, 05_07, 05_08); тут лишились 01_32, 03_03, 03_04, 06_02, DEC_39, DEC_40, DEC_41, DEC_42, DEC_43, DEC_44 |
| 2026-10-17 | Статус draft → active (аудит dev-flow): усі контракти 02_58–02_69 і структури 01_28–01_32 реалізовано фазами 39–46 PL_CTX (178c7c7 — фаза 45, fad0845 — фаза 46) |
| 2026-10-16 | Фаза 46 реалізована: `curation.md`, `context_list` з `"rules": true` (BAD_RULES для інших параметрів і не `true`; рядки не читаються), рядки про правила в SKILL.md і INTRO_TEXT, урок у STAGE_ADVICE ([SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69), [SP_CTX_03_03](#SP_CTX_03_03)); правила виправлень — без прогону на новому акаунті, рішення розробника |
| 2026-10-16 | Фаза 45 реалізована: HostRows, RecordHostRows, HostList ([SP_CTX_01_31](./context_editor.curation.hostrows.sp.md#SP_CTX_01_31), [SP_CTX_02_60](./context_editor.curation.hostrows.sp.md#SP_CTX_02_60), [SP_CTX_02_61](./context_editor.curation.hostrows.sp.md#SP_CTX_02_61)) — абзаци «Реалізація (фаза 45)»; за живим прогоном RebaseHostRows: запис після застосування тримає позицію попередника `#<k>` серед повернутих рядків (хост пише їх копіями з новими `uuid`), ремонт позицій не переносить; за рев'ю — PersonPrompt не рахує рядків локальної команди, Detach відмовляє й для промпту поза обрізаним вікном API, запис «no such row now» не повторюється в рядку про рядки, що пішли, спостерігач лишає `next`, межа пам'яті на процес; EDIT_DESCRIPTION — 2043 з 2048 ([SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69)) |
| 2026-10-16 | Фаза 44 реалізована: StateEdit ([SP_CTX_02_67](./context_editor.curation.slot.sp.md#SP_CTX_02_67)) — дім `hooks/state.ts` і `edits.ts`; ціль ставлять PrepareEdits і ScreenPinned за тегом `state` у мить постановки й застосування; ARCHIVE_ROOM для SLOT_TOO_LONG при постановці; за рев'ю — межа пунктів і довжини при застосуванні, засів ставить ціль до відбору; мітка `state (<зміни>)`; `(no items)`; поля `items`/`nextItem` старого реєстру відсутні ([SP_CTX_01_29](./context_editor.curation.slot.sp.md#SP_CTX_01_29)); EDIT_DESCRIPTION — 2037 з 2048; SKILL.md і відмова BAD_TARGET називають операцію `state` ([SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69)) |
| 2026-10-16 | Фаза 43 реалізована: SupersededRead ([SP_CTX_02_65](./context_editor.curation.edits.sp.md#SP_CTX_02_65)) — вивід із `text` виклику, `agent` не заміняється, дім у `tags.ts`; за рев'ю Changed порівнює лише пронумеровані рядки (заглушка хоста «File unchanged» тегу не дає), рядок поточного виклику не знайдено — тегу немає; текст `duplicate` — «a later read repeated this read of <path>»; ReadyReplacements ([SP_CTX_02_66](./context_editor.curation.edits.sp.md#SP_CTX_02_66)) — `; +<n> more.`, псевдонім і cwd з BlockIO; легенда переліку й опис `context_tag` називають `superseded` |
| 2026-10-16 | Фаза 42 реалізована: DependencyCheck ([SP_CTX_02_63](./context_editor.curation.edits.sp.md#SP_CTX_02_63)) — за живим прогоном фрагменти беруться з пізніших текстів агента (рядок за рядком), Fragments бере токени з літер і цифр; за рев'ю — вхід за значеннями, а не за JSON, обрізання прози й markdown; Keep(op): застереження `drop` радить `summarize`; `later` — лише текст рядків; дім у `edits.ts`, виклик у QueueEdits. TraceOwnCalls ([SP_CTX_02_64](./context_editor.curation.edits.sp.md#SP_CTX_02_64)) — `add <m> <kind> tag(s)` замість `<kind> <m>`, лічильники по всіх викликах відрізка, вхід не тієї форми — ім'я інструмента |
| 2026-10-16 | Фаза 41 реалізована: Source ([SP_CTX_01_28](./context_editor.curation.edits.sp.md#SP_CTX_01_28)) — дім `sourceOf` у `hooks/edits.ts` (`rows.ts` — ядро L0), робочий каталог через CompactionIO/HandoffIO `cwd`; за рев'ю — рядок носія `collapse`, правило шляху (кінцеві `/`, cwd `/`), місце шляху `Grep`, userinfo до останнього `@` |
| 2026-10-15 | Рев'ю фази 40: `describe` вставки поряд із незаархівованим медіа відхиляється (`media could not be archived`); межа блоку без id і межа «немає тегу» PinDocument записані в 02_59 і 02_68 |
| 2026-10-15 | Фаза 40 реалізована ([PL_CTX_P40](./context_editor.p40.plan.md#PL_CTX_P40)): EDIT_DESCRIPTION — 1888 з 2048 (абзац про `ref` — в опис поля, текст відновлення за замовчуванням — в опис `resume_prompt`); [SP_CTX_02_59](./context_editor.curation.edits.sp.md#SP_CTX_02_59): опис лише вставки не застосовується, коли медіа промпту застосуванню невидиме (вікно API, незіставлені медіа) |
| 2026-10-15 | Рев'ю фази 39 (pass with fixes): числа воріт уточнено — авторство 28 з 28 з джерелом і статусом, контроль з поточними текстами 9 з 9 і 94.6; варіант лише з джерелом окремо не проганяли — рядок [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07) «Тексти замін з джерелом» для фази 41; надсилання вставок розширенням VS Code — за його кодом, не наживо |
| 2026-10-15 | Ворота текстів замін (фаза 39): статус змісту знято ([SP_CTX_DEC_44](#SP_CTX_DEC_44), рішення розробника «Лише джерело, без статусу»; [SP_CTX_DEC_40](#SP_CTX_DEC_40) — `superseded`): 01_27 вилучено; поля `status` правок і тегів, STATUS_WORDS, StatusWords, STATUS_REQUIRED і BAD_STATUS прибрано з [SP_CTX_01_30](./context_editor.curation.edits.sp.md#SP_CTX_01_30), [SP_CTX_02_59](./context_editor.curation.edits.sp.md#SP_CTX_02_59), [SP_CTX_02_62](./context_editor.curation.edits.sp.md#SP_CTX_02_62), [SP_CTX_02_66](./context_editor.curation.edits.sp.md#SP_CTX_02_66), [SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69), [SP_CTX_03_03](#SP_CTX_03_03), [SP_CTX_03_04](#SP_CTX_03_04), [SP_CTX_05_05](./context_editor.curation.verification.sp.md#SP_CTX_05_05), [SP_CTX_05_06](./context_editor.curation.verification.sp.md#SP_CTX_05_06), [SP_CTX_06_02](#SP_CTX_06_02); відкривач несе джерело і `which you quoted from later`; результат воріт — у [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07) |
| 2026-10-15 | Вузьке рев'ю B″ (pass with fixes): PersonPrompt не бере рядків з маркером мода; вікно копій відкривається на вході хука `session.compact` гілки `pass`; тека сховища береться синхронно (CONC-01); прибирання записів — лише після точки фіксації; `drop` за `host`, чий попередник відсутній у вході, падає; HOST_MEDIA з перевірками `collapse`; HOST_EXCLUSIVE, HOST_TWICE; голова рядка команди; межа двох процесів ([SP_CTX_02_60](./context_editor.curation.hostrows.sp.md#SP_CTX_02_60), [SP_CTX_02_61](./context_editor.curation.hostrows.sp.md#SP_CTX_02_61)) |
| 2026-10-15 | Рев'ю 2 (fail → виправлено): рядки хоста — окремий список з `id` ([SP_CTX_DEC_42](#SP_CTX_DEC_42), B″, рішення розробника «Окремий список з id (Recommended)»): запис при `session.append` з `handle`, видом і головою попередника, вікно копій від синхронного скидання на початку кожної гілки компактизації до `turn.start` чи промпту людини, список у `context_list`, `drop` з `host`; віртуальних рядків, WithHost, HOST_TARGET і HOST_GROUP немає; примітки до команд не записуються; DetachNote в результаті й звіті; запис прибирає фіксація того самого застосування; навичку інструмента `Skill` і [SP_CTX_DEC_02](./context_editor.decisions-01.sp.md#SP_CTX_DEC_02) названо. PersonRow — за DescribedText; тексти слота стану в [SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69); коди збоїв `run state`; [SP_CTX_04_08](./context_editor.curation.slot.sp.md#SP_CTX_04_08) — `set` і `mark` позначеного пункту; промпт лише з медіа в [SP_CTX_05_08](./context_editor.curation.verification.sp.md#SP_CTX_05_08) |
| 2026-10-15 | Живий зонд Q6: правило розміщення рядків хоста підтверджено; ворота «`uuid` = `handle`» знято, запасний якір із відбитків трьох рядків прибрано; після компактизації `lastVisible` порожній ([SP_CTX_02_60](./context_editor.curation.hostrows.sp.md#SP_CTX_02_60), [SP_CTX_05_07](./context_editor.curation.verification.sp.md#SP_CTX_05_07), [SP_CTX_DEC_42](#SP_CTX_DEC_42)) |
| 2026-10-15 | Рев'ю 1 (fail → виправлено): рядки хоста записуються при `session.append` з якорем на попереднику і прибираються перебудовою попередника (Detach); спайк Q4 виправлено, додано Q6; DEC_42 — `proposed`. Описаний промпт лишається словами людини; `state` — шоста операція з винятками в 02_03, ScreenPinned і RebindTags, одна перебудова на пакет; ворота «Обгортка вставок»; ціль перевірки залежностей; місце рядка сліду; бюджет опису `context_edit`; відкат за фактичним розбором старішої версії; файл доставок — названий виняток |
| 2026-10-15 | Initial version: курування історії за [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06); рішення [SP_CTX_DEC_39](#SP_CTX_DEC_39)–[SP_CTX_DEC_43](#SP_CTX_DEC_43) з інтерв'ю специфікації; спайк [context_editor_hostrows](./context_editor_hostrows.spike.md) |
