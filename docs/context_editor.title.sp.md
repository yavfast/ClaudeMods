# Редактор контексту агента — Specification: Session Title

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-29
> **Updated:** 2026-10-29
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> Структура 01_33 і контракти 02_70–02_74 специфікації [SP_CTX](./context_editor.sp.md): заголовок сесії за темою задачі ([C_CTX_03_12](./context_editor.methods.concept.md#C_CTX_03_12), [C_CTX_DEC_41](./context_editor.methods.concept.md#C_CTX_DEC_41)–[C_CTX_DEC_44](./context_editor.methods.concept.md#C_CTX_DEC_44); [спайк](./context_editor_session_title.spike.md)) — операція заголовка `context_tag`, перейменування людиною, перейменування в кінці ходу, прибирання рядків перейменувань мода в застосуванні, перенесення передачею; рішення [SP_CTX_DEC_46](#SP_CTX_DEC_46). Читати перед зміною операцій `context_tag`, Flush, кроку Detach застосування чи хука `command.run`.

## Contents

- [01_33. TitleState](#SP_CTX_01_33) — стан заголовка в реєстрі тегів
- [02_70. TitleOp](#SP_CTX_02_70) — операція `{"op":"title"}` інструмента `context_tag`
- [02_71. PersonRename](#SP_CTX_02_71) — `/rename` людини: хук `command.run`
- [02_72. RenameAtTurnEnd](#SP_CTX_02_72) — перейменування у Flush, перед застосуванням
- [02_73. DropRenameRows](#SP_CTX_02_73) — застосування прибирає рядки перейменувань мода
- [02_74. CarryTitle](#SP_CTX_02_74) — передача несе заголовок
- [04. Переходи стану](#SP_CTX_TITLE_04) · [05. Перевірка](#SP_CTX_TITLE_05) · [06. Відкат](#SP_CTX_TITLE_06) · [Рішення](#SP_CTX_DEC_46)

## 01. Data Structures — заголовок

### 01_33. TitleState  {#SP_CTX_01_33}

Поле `title` реєстру тегів ([SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10), `tags.json`); відсутнє — те саме, що порожній об'єкт. Пишеться на ланцюжку `tags`, як решта реєстру.

| Поле | Тип | Обмеження | Призначення |
|------|-----|-----------|-------------|
| `want` | string? | 1..MAX_TITLE символів, один рядок, без пробілів по краях | Заголовок, який сесія має показувати: останній з операції заголовка агента, з `/rename <назва>` людини або перенесений передачею |
| `set` | string? | як `want` | Заголовок, з яким мод чи людина востаннє перейменували сесію в цьому сховищі |
| `person` | true? | лише `true` або відсутнє | Людина перейменувала сесію: операція заголовка агента відмовляє до кінця сесії |
| `refused` | string? | 1..MAX_TITLE_REFUSED символів | Текст відмови хоста на останнє перейменування мода; живе до наступної операції заголовка, яка його називає |
| `runs` | {after: string, title: string}[]? | ≤ MAX_TITLE_RUNS, від старого до нового; `after` — `handle` рядка, `title` — як `want` | Перейменування мода, чиї рядки ще в розмові: `after` — `uuid` останнього видимого рядка основної розмови, який бачив RecordHostRows (`HostMemory.last`, [SP_CTX_02_60](./context_editor.curation.hostrows.sp.md#SP_CTX_02_60)): `$.session.messages()` не несе `handle`, а `uuid` рядка в `session.append` і є його `handle` у компактизації |

Інваріанти: `TitleDue(s) = s.want ≠ undefined AND s.want ≠ s.set`. Поле з неправильним типом робить увесь реєстр нечитаним, як і інші поля ([SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10)). Понад MAX_TITLE_RUNS записів — найстаріші йдуть.

## 02. Contracts — заголовок

### 02_70. TitleOp  {#SP_CTX_02_70}

Purpose: агент називає новий заголовок сесії, коли тема задачі змінилася ([C_CTX_DEC_41](./context_editor.methods.concept.md#C_CTX_DEC_41)).

Input: запит пакета `context_tag` ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) `{"op":"title","text":<string>}`; інших полів немає. Субагенту `context_tag` відмовляє й так (`DENIED_SUBAGENT`).

Processing logic (pseudocode):
    IF fields ≠ {op, text}: REJECT TITLE_FIELDS
    t = trim(text)
    IF text not a string OR t empty OR len(t) > MAX_TITLE OR t has a line break: REJECT TITLE_TEXT
    s = registry.title ?? {}
    IF s.refused: line "The last rename failed: <s.refused>."; s.refused = undefined
    IF s.person: REJECT TITLE_PERSON; RETURN                  # заголовок людини лишається
    s.want = t
    line (t = s.set) ? "The session already has this title." : "Title \"<t>\" set: the mod renames the session when this turn ends."
    registry.title = s; changed = true

Кілька операцій заголовка в одному пакеті обробляються по черзі; після кінця ходу діє остання. Операція не відкриває й не закриває етапу і не впливає на інші запити пакета.

Errors:

| Code | Condition | Result |
|------|-----------|--------|
| TITLE_FIELDS | у запиті є поле, крім `op` і `text` | запит відхилено, решта пакета йде |
| TITLE_TEXT | `text` не рядок, порожній після обрізання, довший за MAX_TITLE чи має перенесення рядка | запит відхилено |
| TITLE_PERSON | `person` = true | запит відхилено: «the person named this session; the mod keeps their title» |

### 02_71. PersonRename  {#SP_CTX_02_71}

Purpose: власне перейменування людини перемагає заголовки агента до кінця сесії ([C_CTX_DEC_43](./context_editor.methods.concept.md#C_CTX_DEC_43)).

Processing logic (pseudocode):
    ON command.run (command = rename):                      # власний $.command.run мода хост цьому хуку не показує (спайк)
        IF e.origin.kind = plugin: RETURN next(e)           # інший плагін: не людина
        a = OneLine(trim(e.args)), cut to MAX_TITLE
        ON tags chain: s = registry.title ?? {}; s.person = true; s.refused = undefined
            IF a non-empty: s.want = a; s.set = a
            ELSE: s.want = undefined; s.set = undefined     # назву генерує хост, мод її не знає
        RETURN next(e)
    ON hook failure: RETURN next(e)                          # команда людини йде завжди

`runs` лишаються: рядки перейменувань мода до цього прибирає наступне застосування. Рядки перейменування людини мод не записує й не прибирає.

Errors: сховище недоступне чи реєстр нечитаний — нічого не записано, команда йде далі; хук падає — `.catch` → `next(e)`.

### 02_72. RenameAtTurnEnd  {#SP_CTX_02_72}

Purpose: перейменувати сесію після кінця ходу, у Flush, перед застосуванням правок ([C_CTX_DEC_44](./context_editor.methods.concept.md#C_CTX_DEC_44)).

Processing logic (pseudocode):
    FlushAfterTurn (SP_CTX_02_06): plans one Flush also when TitleDue(registry.title) (registry readable, no queue.handoff), with the same conditions (main loop, not aborted, not planned), also when `compact` is known to be passed over (SP_CTX_02_54 then plans nothing for the queue)
    Flush (SP_CTX_02_06), after the session check, the queue read and the PERSON_MOVED check:
        IF queue.handoff: no rename                         # заголовок несе передача (02_74)
        IF nothing queued AND NOT TitleDue: RETURN nothing-queued
        IF TitleDue (registry re-read):
            want = title.want
            after = HostMemory.last.handle (uuid of the last visible row seen at session.append), or none
            TRY $.command.run({ command: rename, args: want })    # одна спроба
                ON tags chain: title.set = want; IF after: title.runs += {after, title: want}
                renamed = ran
            CATCH err:
                ON tags chain: title.refused = errorText(err) cut to MAX_TITLE_REFUSED; IF title.want = want: title.want = undefined
                renamed = refused
        IF renamed AND edits queued AND PERSON_MOVED again: RETURN person-moved   # /rename чекав простою; за ним хід — компактизацію не ставимо
        then the compaction of queued edits as before; FLUSH_PASSED_OVER gates only the compaction

Перейменування без правок у черзі не дає ні компактизації, ні промпту відновлення. Результат Flush несе `renamed` (`ran` | `refused`) для тестів і налагоджувального журналу. Запис у реєстр після команди перевіряє, що `want` не змінився за час команди: інакше `set` бере значення, з яким команда йшла (відмова скидає лише той `want`, з яким команда йшла), і новий `want` лишається до наступного Flush. Флеш без правок і без запиту `/compact` питає вердикт обходу (`compactPassed`) лише для компактизації: перейменування саме його не чекає. Перевірки походження людини (`isPersonRename`) і рядка команди (`commandOf`, ядро рядків `rows.ts`) живуть у чистих модулях, `register.ts` лише прив'язує.

Errors:

| Condition | Result |
|-----------|--------|
| Хост відхилив `/rename` | `refused` записано, `want` скинуто; наступна операція заголовка називає відмову; застосування правок іде далі |
| Реєстр нечитаний | перейменування немає, застосування йде далі |
| `HostMemory.last` порожня (вікно копій після компактизації, новий процес) | перейменування йде без запису `runs`: його рядки лишаються в розмові |
| Почався хід людини (PERSON_MOVED) | нічого не запущено; Flush планується знову, як і для правок |

### 02_73. DropRenameRows  {#SP_CTX_02_73}

Purpose: застосування правок прибирає рядки перейменувань мода ([C_CTX_DEC_42](./context_editor.methods.concept.md#C_CTX_DEC_42), [SP_CTX_DEC_46](#SP_CTX_DEC_46)).

Рядки однієї команди перейменування — `<local-command-caveat>` з `isMeta`, рядок команди, `<local-command-stdout>`, а в терміналі ще нагадування «The user named this session …». У терміналі жоден із них не входить у `$.session.messages()` і `e.messages` компактизації; у stream-json входить лише рядок команди (спайк, `runs/*-title-probe.json`). Хост ставить невидимі рядки після видимого рядка, що стояв перед ними, лише коли той повернувся зі своїм `handle` ([SP_CTX_02_61](./context_editor.curation.hostrows.sp.md#SP_CTX_02_61)).

Processing logic (pseudocode), у ApplyEdits (SP_CTX_02_04) після кроку Detach рядків хоста (SP_CTX_02_61):
    FOR each run r IN options.renames (= registry.title.runs):
        inAt = index in input of the row with handle = r.after; none: CONTINUE      # рядок пішов: запис зникає при коміті
        IF r.after not detached already AND some host record (SP_CTX_01_31) has after = r.after: keep r; CONTINUE   # пішли б і ті рядки хоста
        IF the Detach checks fail (media of the row, outside the API window): keep r; CONTINUE
        at = index in rows of r.after; none: CONTINUE                                # рядок перебудовано правкою — його рядки хоста пішли з ним
        rows[at] = the row without its handle (unless detached already); firsts += inAt
        IF rows[at+1] is a command row with command-name /rename AND command-args = r.title AND no host record has after = its handle: remove rows[at+1]   # stream-json; рядок хоста на рядку команди пішов би з ним
        dropped += 1
    IF dropped > 0: report.hostLines += "removed the rows of <dropped> rename(s) the mod ran"
    Commit (SP_CTX_02_07): title.runs = the runs kept above whose row is still in the output

Рядок перед перейменуванням — зазвичай остання відповідь агента ходу: без `handle` вона втрачає лише власні блоки thinking. Застосування без правок не запускається, тож рядки перейменувань чекають наступного застосування з правками. Ремонт після відновлення і засів передачі `runs` не читають.

Errors: кожна причина «keep r» лишає запис і рядки до наступного застосування; помилок у звіті немає.

### 02_74. CarryTitle  {#SP_CTX_02_74}

Purpose: передача в нову сесію переносить поточний заголовок і те, чи обрала його людина ([C_CTX_DEC_44](./context_editor.methods.concept.md#C_CTX_DEC_44)).

Processing logic (pseudocode), у копії реєстру нової сесії (CarryRegistries, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)):
    old = registry.title ?? {}
    w = old.want ?? old.set
    new.title = { want: w (when defined), person: old.person (when true) }    # без set, refused, runs; нічого, коли обидва відсутні

Нова сесія без `set`, тож її перший Flush перейменовує її в перенесений заголовок — і коли `person` = true: перенесення не є вибором агента.

## 04. Переходи стану  {#SP_CTX_TITLE_04}

| Подія | `want` | `set` | `person` | `refused` | `runs` |
|-------|--------|-------|----------|-----------|--------|
| TitleOp прийнято | t | — | — | скинуто | — |
| TitleOp, `person` | — | — | — | скинуто | — |
| `/rename <a>` людини | a | a | true | скинуто | — |
| `/rename` людини без назви | скинуто | скинуто | true | скинуто | — |
| RenameAtTurnEnd: команда пройшла | — | want | — | — | + {after, want} |
| RenameAtTurnEnd: відмова | скинуто | — | — | текст | — |
| DropRenameRows, коміт | — | — | — | — | лишаються ті, що не прибрано і чий рядок є |
| CarryTitle (нова сесія) | want ?? set | скинуто | як було | скинуто | скинуто |

«—» — без змін.

## 05. Verification  {#SP_CTX_TITLE_05}

Модульні очікування (`tests/title.test.ts`, `tests/tags.test.ts`, `tests/flush.test.ts`, `tests/compaction.test.ts`, `tests/handoff.test.ts`):

| Контракт | Вхід → очікуваний результат |
|----------|-----------------------------|
| 01_33 | реєстр з `title.want` числом → нечитаний; без `title` → читається; `runs` понад MAX_TITLE_RUNS → найстаріші йдуть |
| 02_70 | `{"op":"title","text":" Нова тема "}` → `want` = «Нова тема», рядок «… set …»; `text` = `set` → «already has this title»; поле `stage` → TITLE_FIELDS; 81 символ чи `\n` → TITLE_TEXT; `person` → TITLE_PERSON і `want` без змін; `refused` → рядок «The last rename failed: …» і `refused` скинуто; дві операції в пакеті → `want` останньої |
| 02_71 | origin `composer`, args «Моя назва» → `person`, `want` = `set` = «Моя назва»; args порожні → `person`, `want`/`set` скинуто; origin `plugin` → нічого; реєстр нечитаний → `next` викликано |
| 02_72 | черга порожня, TitleDue → Flush заплановано, `/rename` з `want`, `set` = want, `runs` + {after: HostMemory.last}, компактизації і промпту немає; TitleDue і правки → `/rename` раніше за `/compact`; відмова `/rename` → `refused`, `want` скинуто, `/compact` іде; `queue.handoff` → без `/rename`; хід почався → без `/rename`; хід почався під час `/rename` → без `/compact`; обхід `compact` відомий → Flush планується лише для TitleDue; не TitleDue → без `/rename` |
| 02_73 | `runs` з рядком у вході, без записів хоста на ньому → рядок повернуто без `handle`, рядок звіту «removed the rows of 1 rename(s)»; видимий рядок команди `/rename` з тими args після нього → прибрано, з іншими args → лишається; запис хоста на тому рядку → рядок з `handle`, `runs` лишається; запис хоста на рядку команди → рядок команди лишається; рядка немає → запис зникає; PersonText рядка `/rename` порожній |
| 02_74 | `want` «A» → нова сесія `want` «A», без `set`/`runs`; лише `set` «B», `person` → `want` «B», `person` |

Живий сценарій (термінал через `.dev_flow/cache/live-test/ce.sh` і stream-json): агент дає операцію заголовка → після кінця ходу заголовок на рамці поля вводу / подія `session_title_changed`; черговий хід з правками → у формі `{ as: 'api' }` немає рядків `/rename`, `Session renamed to` і «The user named this session»; `/rename` людини → наступна операція заголовка відмовляє TITLE_PERSON; `/handoff` → нова сесія має той самий заголовок.

## 06. Відкат  {#SP_CTX_TITLE_06}

Прибрати операцію `title`, крок RenameAtTurnEnd, хук `command.run` на `rename` і крок DropRenameRows. Поле `title` у `tags.json` старіші версії мода читають як невідоме і лишають; сесія зберігає останній заголовок, далі хост поводиться як без мода. Рядки перейменувань, ще не прибрані, лишаються в розмові.

## Рішення  {#SP_CTX_TITLE_DEC}

### DEC_46 — Як прибрати рядки перейменування мода  {#SP_CTX_DEC_46}

**Status:** resolved (agent)
**Date:** 2026-10-29
**Question:** Розробник обрав прибирати рядки перейменувань мода наступним застосуванням ([C_CTX_DEC_42](./context_editor.methods.concept.md#C_CTX_DEC_42)); як, коли в терміналі жоден із цих рядків не видно в `$.session.messages()` і `e.messages`?

| Option | Плюси | Мінуси |
|--------|-------|--------|
| A. Повернути рядок перед перейменуванням без `handle` (як Detach рядка хоста, [SP_CTX_02_61](./context_editor.curation.hostrows.sp.md#SP_CTX_02_61)), а видимий рядок команди stream-json прибрати | Працює в обох хостах тим самим механізмом, що вже перевірено для рядків хоста | Рядок перед ним (остання відповідь ходу) втрачає thinking; з ним пішли б і записані рядки хоста — тоді рядки лишаються |
| B. Прибирати лише видимий рядок команди | Без втрат | У терміналі нічого не прибирає; у stream-json лишаються примітка і вивід |
| C. Записувати рядки команди як рядки хоста (HostRows) і прибирати через `drop` | Агент бачить їх у списку | Агент мусить сам їх прибирати; суперечить рішенню розробника «прибирає наступне застосування» |

**Decision:** A.
**Rationale:** Лише A прибирає рядки в терміналі; ціна — thinking однієї відповіді, якого API для минулих ходів і так не шле. Записи рядків хоста на тому самому рядку мають пріоритет: їх агент міг ще не прочитати.
**Rejected because:** B лишає рядки в терміналі, C перекладає прибирання на агента.
**Verify:** живий сценарій [§05](#SP_CTX_TITLE_05) — у формі API після застосування немає рядків перейменування (чи хост лишає рядки `system` команди після рядка без `handle` так само, як рядки `isMeta`, спайк не перевіряв).
