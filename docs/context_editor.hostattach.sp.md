# Редактор контексту агента — Specification: Contracts: host attachments

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-12
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_39–02_41 специфікації [SP_CTX](./context_editor.sp.md): контракти AttachmentAnswer (хук `prompt.attachment`), PlanAttachments і CommitAttachments (рішення всередині застосування), ClearAttachments (інша компактизація). Читати перед зміною `hooks/hostattach.ts` або зв'язування `prompt.attachment` у `hooks/register.ts`.

## Contents

Розділи цього файлу (h3 розділу «02. Contracts» парасольки):

- [02_39. AttachmentAnswer](#SP_CTX_02_39)
- [02_40. PlanAttachments і CommitAttachments](#SP_CTX_02_40)
- [02_41. ClearAttachments](#SP_CTX_02_41)

## 02. Contracts — вкладення хоста

Вкладення хоста — повідомлення, які хост сам додає до запиту (нагадування, файли інструкцій, перелік навичок); рядків `$.session.messages()` для них немає, у API-поданні вони — текстові блоки `<system-reminder>` у повідомленнях `user` ([C_CTX_03_08](./context_editor.core.concept.md#C_CTX_03_08); спайк [context_editor_host_attachments](./context_editor_host_attachments.spike.md); навичка plugin-hooks, пункт 59). Мод відповідає лише на копії файлів інструкцій (`instructions`, `nested_memory`) і переліку навичок (`skill_listing`) основної розмови ([SP_CTX_DEC_25](./context_editor.decisions-21.sp.md#SP_CTX_DEC_25)). Хост докладає нову копію CLAUDE.md лише після компактизації, ніколи на звичайному ході (живий прогін фази 24, обидва хости; `.dev_flow/cache/live-test/phase24-results.md`); пізніші переліки навичок — **інкрементні**: той самий заголовок LISTING_HEAD, але лише додані навички (≈ 140 символів; у транскрипті `isInitial: false`), а хук бачить лише текст. Хост питає хук не на кожен запит: нове вкладення — раз, коли з'являється, далі відповідь тримається на процес; усі вкладення розмови — після кожної компактизації, після `$.ui.invalidate('prompt.attachment')` (з наступного ходу) і в новому процесі після `--resume`, у порядку розмови, нова копія останньою. Тому рішення змінюються лише в застосуванні мода (компактизація, після якої хост перепитує все, а кеш промпту однаково переписується), а між застосуваннями хук відповідає за збереженими рішеннями ([SP_CTX_01_23](./context_editor.records.sp.md#SP_CTX_01_23)); `$.ui.invalidate` мод не кличе.

Пам'ять модуля (AttachMemory; скидається перезавантаженням модуля): `catalog` — тексти вкладень, яких хук питали від початку поточного проходу, за TextHash: тип, текст, `seq` останнього запиту (наскрізний лічильник екземпляра) і `count` — скільки разів питали (копії); `burst` — поточна серія запитів (`at`, лічильник входжень тексту в серії); `matched` — SectionKey розділів, чий вміст збігся з файлом, коли цей екземпляр уперше їх побачив; `checked` — розділи, для яких цю перевірку вже запущено; `voided` — відповіді старої розмови недійсні до наступного застосування ([SP_CTX_02_41](#SP_CTX_02_41)); `verify` — останнє застосування мало прогнози, перший кінець ходу їх перевіряє (VerifyPredictions). Прохід починається (ResetPass: `catalog` і `burst` порожні, `matched` лишається) з кожною компактизацією, що стоїть (застосування мода, засів, інша компактизація, [SP_CTX_02_41](#SP_CTX_02_41)), зі справжнім перемиканням сесії (публікація сховища сесії, іншої за попередню, [SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15); перша чи повторна публікація тієї самої сесії прохід не починає), з відкликанням прогнозу (VerifyPredictions) і зі стартом модуля.

### 02_39. AttachmentAnswer  {#SP_CTX_02_39}

Purpose: відповісти на одне вкладення основної розмови за рішеннями в силі; невідоме — лишити.

Signature: хук `prompt.attachment` з матчерами `{ type: 'instructions' }`, `{ type: 'nested_memory' }`, `{ type: 'skill_listing' }` (рядкові літерали); `AttachmentAnswer(mem, io, e) → { keep } | { text: string | null }`; `keep` → `next(e)`, `{ text: null }` — вкладення пропущено, `{ text }` → `next({ ...e, text })`. Збій хука (`.catch`) — `next(e)`.

Processing logic (pseudocode):
    SECTION_HEAD = рядок «Contents of <path> (<опис>):» або «Contents of <path>:» (nested_memory), далі порожній рядок; опис без вкладених дужок;
                   лише на початку тексту або після порожнього рядка і лише для шляху, що починається з `/` або `~` (рядок усередині вмісту файлу рідко схожий на заголовок)
    ParseAttachment(type, text):
        skill_listing: text починається з LISTING_HEAD → { listing } ; інакше → не зрозуміло
        instructions | nested_memory: розділи за SECTION_HEAD; немає жодного → не зрозуміло
            pre = текст до першого заголовка; pre ≠ "" і не починається ні з PREAMBLE_HEAD, ні з REREAD_HEAD → не зрозуміло
            section = { path, head (заголовок з порожнім рядком), body (до наступного заголовка, з роздільником), key = SectionKey(path, body) }
            RETURN { files, pre, preamble = pre починається з PREAMBLE_HEAD, sections }
        інший тип → не зрозуміло
    SectionKey(path, body) = TextHash(path + "\0" + trim(body))
    AttachmentAnswer(mem, io, e):
        IF e.agentId OR e.type ∉ ATTACH_TYPES OR ParseAttachment не зрозумів: RETURN keep        # нічого не записано в пам'ять
        { hash, occurrence } = NoteAsk(mem, e.type, e.text, now)                                # синхронно, до першого await: порядок — порядок запитів хоста
        для кожного розділу з абсолютним шляхом, якого ще немає в checked: у фоні прочитати файл; trim(файл) = trim(body) → matched += key   # відповідь диска не чекає
        read = стан файлу hostattach.json сесії через кеш (Store.cached) ; немає сховища, unreadable, збій → keep
        IF voided: RETURN keep
        RETURN AnswerFor(parsed, e.text, read.answers[hash], occurrence, count)
    NoteAsk(mem, type, text, now):
        hash = TextHash(text); IF now − burst.at > PASS_GAP_MS: burst.counts = {}
        burst.at = now; occurrence = ++burst.counts[hash]; seq += 1
        catalog[hash] = { type, text, seq, count + 1 }; RETURN { hash, occurrence, count }       # нове — count 1
    AnswerFor(parsed, text, d, k, count):
        IF d відсутнє OR k > d.copies OR count > d.copies: keep     # копія понад вирішені — у серії чи від початку проходу — нова
        IF d.repeat AND k > 1: null                                  # побайтовий повтор у серії: лишається перша
        IF d.drop: preamble ? keep : null                             # копія з преамбулою цілком не прибирається ніколи
        IF d.stale непорожній і parsed — files: RewriteSections(parsed, d.stale) або keep, якщо жоден розділ не застарів
        keep
    RewriteSections(parsed, stale) = pre + для кожного розділу: key ∈ stale ? "Contents of <path>: " + SUPERSEDED + хвіст пробілів body : head + body

Серія (`burst`): хост питає всі вкладення проходу за мілісекунди, тож запит, що прийшов пізніше за PASS_GAP_MS після попереднього, починає нову серію. Копія нова, коли її входження в серії або кількість запитів її тексту від початку проходу (`count` каталогу) більша за `copies` рішення: так поодинока копія, текст якої збігся з уже вирішеним (файл повернули до v1, чию копію раніше прибрано; перелік, що повернувся до раннішого), лишається, хоч і приходить окремою серією (рев'ю фази 24). Прохід, який почав інший плагін (`$.ui.invalidate`) і якого мод не бачить, подвоює `count`: тоді лишаються всі копії (безпечний бік) до наступної компактизації.

Errors: відмов немає — будь-який збій лишає вкладення (`keep`).

### 02_40. PlanAttachments і CommitAttachments  {#SP_CTX_02_40}

Purpose: усередині застосування мода вирішити, які копії файлів інструкцій і переліків застарілі, і зберегти рішення так, щоб перепитування одразу після компактизації і відновлений процес надіслали ті самі байти.

Signature: порт `attachments` обробника компактизації ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)) — `AttachPort { disk, commit(disk, frozen, ratio, held), putBack, passed }`; `PlanAttachments(before, mem, disk, frozen?) → { state, changed }`; `FrozenAttachments(rows, api, prefix) → (text → bool) | none`; `RollbackPredictions(state, catalog) → { state, failed } | none`; `VerifyPredictions(mem, io) → none | waiting | kept | rolled back` (порт VerifyIO: Update файлу рішень, `$.ui.invalidate('prompt.attachment')`).

Processing logic (pseudocode):
    # у HandleCompaction, лише коли застосовано хоч одну правку (done непорожній):
    disk = для кожного абсолютного шляху розділів каталогу — файл або none (відсутній, нечитабельний); до кроку фіксації, без побічних дій
    frozen = keepCache пакета ? FrozenAttachments(rows, api, prefix) : none
    # у кроці фіксації, після реєстрів, перед чергою (CONC-02):
    CommitAttachments(disk, frozen) на ланцюжку hostattach, усередині ланцюжків, які тримає крок фіксації (queue → tags → aliases; LockOrder їх перевіряє):
        read = файл; unreadable → перенести в <file>.bad-<ms>; не вдалося → нічого (рішення в силі лишаються); вдалося → before = порожній стан
        base = voided ? before без answers і predicted (ClearedAnswers) : before; voided = false
        plan = PlanAttachments(base, mem, disk, frozen); verify = plan.predicted непорожній; не змінено (і base = before) → не писати
        записати plan.state; речення звіту = AttachText(left), коли змінилися відповіді (порівняння без `copies`) і left.copies > 0
    покинуто після запису → putBack пише before; застосування відповіло рядками → passed() = ResetPass (хост зараз перепитає все)

    PlanAttachments(before, mem, disk, frozen):
        entries = зрозумілі вкладення каталогу за seq; немає → { before, changed: false }
        newest[path] = розділ шляху з вкладення з найбільшим seq
        known = before.matched ∪ mem.matched
        для кожного (path, key) з before.predicted: newest[path] немає → лишити прогноз; newest[path].key = key → path ∈ uncomparable (нової копії не було); інакше прогноз справдився
        stale = { s.key | s.key ≠ newest[s.path].key }                                  # (а) новіша інша копія шляху
        для кожного path: newest — з вкладення `instructions`, path ∉ uncomparable, newest.key ∈ known, disk[path] є і trim(disk) ≠ trim(newest.body)
            → stale += newest.key; predicted[path] = newest.key                         # (б) хост докладе нову копію з першим промптом після межі
        covered = переліки, усі назви навичок яких (рядки `- <name>:`) має один новіший інший перелік; перелік без жодної назви — ніколи
        для кожного вкладення: d = { copies: count }; count > 1 → repeat
            files: усі розділи в stale і без преамбули → drop; інакше застарілі розділи → stale
            listing ∈ covered → drop                                     # пізніші переліки інкрементні: найновіший не замінює повного
            frozen і рішення змінилось, а хоч одна копія з поточною відповіддю (не null) лежить у замороженому префіксі → лишити старе рішення,
                крім старого рішення, що ховає поточне: розділ, який тепер не застарілий (найновіший для свого шляху, зокрема шляху `uncomparable` після знятого прогнозу), чи перелік, який тепер не покритий
        рішення вкладень, яких цей прохід не питав, лишаються (до MAX_ATTACH_ANSWERS)
        left = для кожної копії вкладення: null → copies + 1, chars + довжина; переписано → copies + кількість замінених розділів, chars + різниця довжин
        state = { answers, matched = known (останні MAX_ATTACH_KEYS), predicted, uncomparable, left }; changed = state ≠ before
    FrozenAttachments(rows, api, prefix):
        prefix ≤ 0 → none
        end = найменший індекс повідомлення асистента (Responses.message) серед рядків ≥ prefix; немає → len(api)
        text → trim(text) міститься в текстовому блоці повідомлення user з api[0..end); або подання обрізане вікном (ApiCut) і текст не знайдено ніде

    RollbackPredictions(state, catalog):
        для кожного (path, key) з state.predicted: каталог не має path → лишити; newest[path].key = key → path ∈ uncomparable, key відкликано; інакше прогноз справдився
        нічого не відкликано і нічого не справдилось → none
        із кожного рішення прибрати відкликані ключі зі `stale`; копію, пропущену цілком через відкликаний ключ, вирішити знову лише за правилом (а); порожнє рішення — вилучити; left — заново
    VerifyPredictions(mem, io), ON turn complete (main loop), у сховищі, де хід закінчився:
        verify = false → none; каталог порожній (проходу ще не було) → waiting, перевірка — на наступному кінці ходу
        verify = false; Update файлу: RollbackPredictions(state, catalog)
        відкликано → ResetPass; $.ui.invalidate('prompt.attachment')   # хост перепитає все з наступного ходу: поточний вміст знову в запиті (безпека важливіша за кеш)

Порівнюваність: прогноз (б) спирається на те, що хост перечитує файли інструкцій з першим промптом після межі компактизації і докладає змінені повною копією, а розділ збігається з файлом після `trim()` (спайк, Entry 1, 3). Шлях порівнюваний, лише коли його найновіша копія збіглася з файлом, коли цей розділ уперше побачили (`matched`), — інакше відмінність може бути рендерингом хоста (імпорти, обрізання), а не зміною файлу. Відсутній файл чи непорівнюваний шлях лишає свої копії. Прогноз — лише для копій `instructions`: їх хост перечитує після межі (спайк, Entry 3); вкладений файл (`nested_memory`) хост докладає знову, лише коли його знову прочитано, тож для нього діє тільки правило (а). Прогноз, за яким нова копія не прийшла, знімається вже на першому кінці ходу після застосування (VerifyPredictions, рев'ю фази 24: наступного застосування може й не бути): шлях стає `uncomparable` назавжди для цієї сесії, і копія повертається з перепитуванням, яке мод сам запускає `$.ui.invalidate`; PlanAttachments наступного застосування робить те саме, якщо перевірка не відбулася (порожній каталог, перезавантаження модуля).

`keep_cache` ([SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22)): вкладення, чий поточний текст лежить у замороженому префіксі, не змінює відповіді в цьому застосуванні — інакше його нові байти переписали б кеш, який агент обрав зберегти; вкладення без тексту (пропущене) в поданні знайти не можна, тож його повернення (знятий прогноз) не стримується; і старе рішення, що ховає поточний вміст (розділ, який тепер найновіший для свого шляху, або шлях `uncomparable`; перелік, який тепер не покритий), ніколи не тримається заради кешу: безпека важливіша за кеш (рев'ю фази 24). Без `keep_cache` зміна відповіді переписує кеш від позиції вкладення, і це може бути раніше за першу правку (перша копія `instructions` — у першому повідомленні); CacheCost ([SP_CTX_02_38](./context_editor.telemetry.sp.md#SP_CTX_02_38)) цього не моделює.

Errors:
| Condition | Outcome |
|-----------|---------|
| файл рішень unreadable, перенесення вдалося | рішення з порожнього стану; звіт як завжди |
| файл рішень unreadable, перенесення не вдалося | нічого не записано, рішення в силі (хук лишає все, бо файл unreadable) |
| читання файлу на диску не вдалося | шлях без прогнозу (б) |
| збій `commit` | рішення в силі лишаються, нічого не повертається; застосування правок не зачеплене, звіт без речення про вкладення |
| запис черги не вдався | записані рішення повертаються як прочитані (putBack); збій іде до гілки збою |
| диспетчеризацію покинуто після запису | записане повертається як прочитане (putBack) |
| жодної правки не застосовано | рішень не змінено, ResetPass немає (компактизації не було) |

### 02_41. ClearAttachments  {#SP_CTX_02_41}

Purpose: після компактизації, що не мода і що стоїть ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)), — підсумок замінив розмову разом з її вкладеннями — рішення про старі копії більше не стосуються розмови.

Processing logic (pseudocode):
    ON observed compaction with boundary b (RecordBoundary):
        VoidAnswers(mem) = ResetPass; voided = true    # синхронно: перепитування після цієї компактизації не бачить старих відповідей, навіть поки фоновий запис не закінчився
        у фоні, на ланцюжку hostattach, у каталозі сесії: answers = {}, predicted = {}, left = 0; matched і uncomparable лишаються   # Update: unreadable лишається як є
    ON seed (HandleSeed відповів рядками): ResetPass(mem)     # нова сесія — свій файл рішень, порожній; передача файлу не переносить

Errors: збій запису — рішення лишаються; нова копія з тим самим текстом, що вирішений раніше, поза `copies` лишається (AnswerFor).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-12 | Новий дочірній файл (фаза 24, спайк context_editor_host_attachments): 02_39 AttachmentAnswer, 02_40 PlanAttachments і CommitAttachments, 02_41 ClearAttachments; SP_CTX_DEC_25 |
| 2026-10-12 | Рев'ю і живий прогін фази 24: інкрементні переліки — перелік прибирається, лише коли один новіший має всі його назви (02_40; сценарій 5 прогону); копія нова й за `count` від початку проходу (02_39); старе рішення, що ховає поточне, не тримається з `keep_cache`; VerifyPredictions і RollbackPredictions на першому кінці ходу з `$.ui.invalidate`; `voided` після іншої компактизації (02_41); SECTION_HEAD лише після порожнього рядка і для `/` чи `~`; прохід — лише зі справжнім перемиканням сесії; commit усередині ланцюжків фіксації; живі факти: нова копія CLAUDE.md лише після компактизації, пізніші переліки інкрементні |
