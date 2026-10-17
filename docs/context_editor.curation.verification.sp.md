# Редактор контексту агента — Specification: курування історії — критерії перевірки

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-17
> **Updated:** 2026-10-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md); частина [курування історії](./context_editor.curation.sp.md)
> **Concept:** [C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)
>
> Частина курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06)) специфікації [SP_CTX](./context_editor.sp.md): модульні очікування, інваріанти, живі сценарії й граничні випадки курування. Читати, коли пишете або звіряєте тести курування чи плануєте живий прогін.

## Contents

Розділи цього файлу (h3 розділів курування; решта — у [курування історії](./context_editor.curation.sp.md)):

- [05_05. Functional Expectations](#SP_CTX_05_05) — модульні очікування контрактів курування
- [05_06. Invariant Checks](#SP_CTX_05_06) — інваріанти курування і як їх перевірити
- [05_07. Integration Scenarios](#SP_CTX_05_07) — живі сценарії, зокрема ворота фази 39
- [05_08. Edge Cases and Boundaries](#SP_CTX_05_08) — граничні випадки курування

## 05. Verification Criteria — курування

### 05_05. Functional Expectations  {#SP_CTX_05_05}

| Contract | Scenario | Input | Expected outcome |
|----------|----------|-------|------------------|
| PersonWords | діапазон над промптом | `collapse` #3..#6, #4 — промпт людини | відхилено PERSON_WORDS з #4 (prompt); правки з виклику не стали в чергу [тест: «PersonWords — повідомлення людини»] |
| PersonWords | пара AskUserQuestion | `summarize` пари AskUserQuestion | відхилено: «the AskUserQuestion answer is the person's words» [тест: «PersonWords — повідомлення людини»] |
| PersonWords | `drop` з доставкою | `drop` пари, за результатом якої висить доставка людини | відхилено з порадою `summarize` [тест: «PersonWords — доставка від людини»] |
| PersonWords | тег над промптом | `disposable` #2..#5 з промптом | запит відхилено, тегу немає |
| PersonWords | перевірка при застосуванні | `pending.json` змінено поза інструментами: `collapse` над промптом | застосування: PERSON_WORDS_NOW першим у `failed`, рядки людини на місці |
| PersonWords | рамка хоста | PersonText тексту, що починається з PEER_FRAME | порожній: не слова людини [тест: «HostFrame, PasteBlocks, DescribedWords, DocumentRow»] |
| PersonWords | описаний промпт | `collapse` діапазону з промптом після `describe` | відхилено PERSON_WORDS з `#i (described prompt)` |
| PersonWords | тег у QueueTagReplacements | `disposable`, чия ціль тепер захоплює промпт | тег прибрано; рядок `disposable <target> dropped: it covers the person's words` у результаті виклику |
| DescribePasted | лише вставка | `describe` промпту «Лог: <pasted_content id="a">…</pasted_content id="a"> що не так?» | текст: голова «…replaced the pasted text…», опис, далі «Лог: [pasted text 1, <n> chars: see your description above] що не так?»; оригінал в архіві |
| DescribePasted | медіа і вставка | промпт із зображенням і вставкою | голова «…replaced the media and the pasted text…» |
| DescribePasted | нічого замінювати | промпт без медіа й вставок | NO_MEDIA [тест: «DescribePasted — медіа і вставка, нічого замінювати»] |
| RecordHostRows | розгорнута навичка | `session.append` рядка `isMeta` з SKILL_FRAME після команди людини `/dev-flow spec` | запис `{ id: h1, kind: skill, after: <uuid команди>, afterKind: prompt, afterHead: 'the command "/dev-flow spec"' }` |
| RecordHostRows | вікно копій | рядок `isMeta` з PEER_FRAME після рядків команди `/compact` мода, до промпту людини | запису немає |
| RecordHostRows | копія асистента в stream-json | рядок дверима `response` з моделлю `<synthetic>` у вікні | `lastVisible` порожній, як був [тест: «RecordHostRows — вікно копій»] |
| RecordHostRows | промпт людини закриває вікно | промпт людини після застосування, за ним рядок навички | вікно закрито; запис за промптом |
| HostList | список | `context_list` з двома записами | рядок заголовка `… h1 skill, h2 peer`; секція з двома рядками; індекси рядків ті самі |
| HostList | `drop` за `id` | `{"op":"drop","host":"h1"}` | у результаті DetachNote; при застосуванні попередник без `handle`, звіт `dropped host row h1 (skill, <n> chars)`, текст рядка в архіві, запису немає |
| HostList | два рядки за одним попередником | `drop` h3, за тим самим рядком стоїть h4 | обидва прибрано; звіт `h4 (peer) went with it` |
| HostList | невідомий `id` | `drop` h9 | HOST_UNKNOWN [тест: «HostList — постановка»] |
| HostList | попередник із медіа | `drop` рядка за промптом із зображенням | HOST_MEDIA [тест: «HostList — відмови при застосуванні»] |
| HostList | попередника згорнуто | `collapse` над попередником h2 | звіт `Host rows that went with rebuilt rows: h2 (peer).`; запису немає [тест: «HandleCompaction — рядки хоста»; «HostList — попередника змінено іншою правкою»] |
| HostList | навичка інструмента `Skill` | застосування без `keep_cache` після `Skill` | запис за рядком «Launching skill» зник; звіт його називає [тест: «KeepHostRows: a record stays only while its row before came back with its handle»; «HandleCompaction — рядки хоста»] |
| HostList | чужа компактизація | вбудована `/compact` | файл прибрано, списку немає [тест: «ObserveCompaction — чужа компактизація прибирає записи рядків хоста»] |
| ReplacementOpeners | `summarize` з джерелом | `Read docs/x.md` | текст починається `Later, your context_edit summarize call replaced the full output of Read docs/x.md you had read here with your own summary (original:` [тест: «ApplyEdits — summarize з джерелом»] |
| ReplacementOpeners | зайве поле `status` | `summarize` з `"status": "inferred"` | прийнято; поле ігнорується, слів статусу в заміні немає |
| ReplacementOpeners | розпізнавання | старі й нові відкривачі | ReplacementText — так для обох [тест: «ReplacementOpeners — відкривачі з джерелом»; «ReplacementText — тексти фази 28 і старі»] |
| DependencyCheck | цитата в пізнішому тексті | ідентифікатор оригіналу є лише в пізнішому тексті агента | прийнято із застереженням, що називає рядок і фрагмент; заміна каже `which you quoted from later` [тест: «DependencyCheck — §05_05»; «queueEdits — DependencyCheck»; «ApplyEdits — quoted»] |
| DependencyCheck | інше джерело лишається | той самий фрагмент і в іншому рядку поза ціллю | застереження немає [тест: «DependencyCheck — §05_05»] |
| TraceOwnCalls | відрізок з `context_tag` і `context_edit` | `open` етапу й правка з трьома правками | один рядок `…; you had called context_tag to open stage "x", context_edit with 3 edit(s).` [тест: «TraceText — §05_05»] |
| TraceOwnCalls | заморожений префікс | `keep_cache`, власні пари в префіксі | сліду для них немає [тест: «TraceOwnCalls — збережені пари (§05_06)»] |
| SupersededRead | той самий діапазон, інший текст | друге `Read` того самого файлу після зміни | раннє читання — `review superseded` |
| SupersededRead | інший діапазон, спільні рядки різні | `Read` рядків 40–60 після повного читання і зміни рядка 50 | `superseded` |
| SupersededRead | без спільних рядків | рядки 1–10, потім 200–210 | тегу немає |
| ReadyReplacements | блок із застарілим читанням | закриття етапу | рядок `Ready replacements …: #12 c45 "Outdated: docs/x.md was read again later and its content had changed."` |
| StateEdit | додати пункт плану | `{"op":"state","changes":[{"do":"add","kind":"plan","text":"write spec"}]}` | текст слота: STATE_REBUILT, рядок архіву, `Plan:` і `- p1: write spec`; `items`, `nextItem` = 2 |
| StateEdit | немає слота | правка `state` без тегу `state` | NO_STATE_SLOT |
| StateEdit | `rewrite` слота з пунктами | `rewrite` рядка слота | STATE_ITEMS |
| Pins | перший промпт | початок сесії | пінів немає |
| Pins | передача «документом» | перший кінець ходу нової сесії | пін на рядку 0; `docChecked` = true |
| CurationTexts | правила курування | `context_list` з `"rules": true` | текст `curation.md` [тест: «CurationTexts — "rules": true returns the curation rules»] |
| CurationTexts | файл понад межу | `curation.md` довший за CURATION_MAX | `tests/skill-limits.sh` падає [not covered by a unit test: `claude plugin test` runs without a file system; `sh mods/context-editor/tests/skill-limits.sh` checks `curation.md` against CURATION_MAX] |
| CurationTexts | файл не прочитався | у `$.plugin.root` немає `curation.md` | `context-editor: the curation rules could not be read: <error>` [тест: «CurationTexts — the rules file cannot be read»] |
| CurationTexts | зайві параметри | `"rules": true` з `count`, `from`, `index` чи `full`, або `"rules"` не `true` | відмова BAD_RULES [тест: «CurationTexts — "rules" takes no other parameter»] |
| StateEdit | дві правки `state` | дві правки в одному пакеті | одна перебудова слота, обидві в `applied` |
| StateEdit | `rewrite` і `state` слота разом | `state`, потім `rewrite` рядка слота | друга відхилена STATE_CONFLICT |

### 05_06. Invariant Checks  {#SP_CTX_05_06}

| Invariant | Verification method |
|-----------|-------------------|
| Жодне застосування не змінює набраного людиною тексту | модульний тест на ScreenPerson і `describe`; живий сценарій «Слова людини» |
| Рядок хоста не рахується словами людини | PersonText для кожної рамки HostFrame порожній |
| Заміни цієї версії несуть джерело і не несуть статусу | тести текстів `run summarize`, `run collapse`; ReplacementText для нових голів |
| Слот стану дорівнює зібраним пунктам | тест `run state`: текст = STATE_REBUILT + архів + Assemble |
| Запис лишається, лише поки попередник повертається зі своїм `handle` | тест фіксації: попередник із `handle`, без нього, відсутній |
| У вікні копій записів немає | тест RecordHostRows з відкритим вікном: копії, рядки команди, рядок `isMeta` |
| R6 не чіпає `pin`, `disposable`, `state`, `stale` | тест MarkCall з такими тегами на ранньому читанні |
| Рядок сліду лише там, де прибрано власні пари | тест DropOwnCalls зі збереженими парами (префікс, медіа) |

### 05_07. Integration Scenarios  {#SP_CTX_05_07}

| Scenario | Preconditions | Steps | Expected result |
|----------|--------------|-------|-----------------|
| Тексти замін з походженням і статусом (ворота перед кодом текстів) | копія сесії, як у спайку [context_editor_authorship](./context_editor_authorship.spike.md); haiku і sonnet | застосувати `summarize` і `collapse` з новими текстами й різними статусами; спитати агента про стиснуте | агент визнає стискання своїм (P13, P23 не повертаються) і частіше перевіряє виведене й припущене, ніж прочитане. Спостережено 2026-10-15 (фаза 39, 57 сесій на 2.1.296, `.dev_flow/cache/live-test/curation-gate/texts/results.md`): авторство — 28 з 28 з джерелом і статусом, 9 з 9 у контролі, «не бачив вмісту» не частіше, ніж у контролі; впевненість після стискання (haiku, 5 сесій на варіант) — контроль (поточні тексти, без джерела й статусу) 94.6, `read` 91.4, `inferred` 93.8, `assumed` 86.0: статус довіри майже не змінює; розробник: «Лише джерело, без статусу» ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)) |
| Тексти замін з джерелом (повтор у фазі 41, на коді мода) | копія сесії, як у спайку [context_editor_authorship](./context_editor_authorship.spike.md); haiku і sonnet | застосувати `summarize` і `collapse` з відкривачем лише з джерелом ([SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)); спитати агента, хто писав стиснуте і чи бачив він вміст | агент визнає стискання своїм не рідше, ніж у контролі воріт фази 39 (9 з 9), і не каже частіше, що вмісту не бачив (P13, P23 не повертаються). Спостережено 2026-10-16 (фаза 41, 9 сесій на 2.1.296, `.dev_flow/cache/live-test/curation-p41/results.md`): авторство 9 з 9; «вмісту не бачив» 2 з 9 (haiku 1 з 6, sonnet 1 з 3) проти 3 з 9 у контролі (haiku 3 з 6, sonnet 0 з 3); «вигадав» і заперечень викликів немає |
| Слід власних викликів | живий прогін з кількома етапами | закрити етап, застосувати, спитати про власні виклики й цитати їхнього виводу | агент не заперечує викликів і не називає цитат вигадкою (P13, P23). Спостережено 2026-10-16 (фаза 42, 12 сесій на 2.1.296, контроль — код фази 41, `.dev_flow/cache/live-test/curation-p42/results.md`): слід у 6/6, агенти називають виклики за ним; заперечення викликів 0 з 6 проти 1 з 6 у контролі; прямого «вигадав» 0 з 6 проти 1 з 6, обережне «may have made up» про вивід прибраного `context_list` лишилось (3 з 6 проти 1 з 6): слід називає виклик, а не вивід. DependencyCheck: застереження 6/6, заміна каже `which you quoted from later`; чи змінює воно рішення агента — `unobserved` (людина звеліла стиснути без фактів) |
| Рядки хоста | термінал і stream-json; навичка зі slash-командою; звіт субагента між ходами без застосування; звіт одразу після рядків команди `/compact` мода; навичка з інструмента `Skill` | (1) записи після `session.append`, `context_list`; (2) `drop` за `id`, застосувати; (3) застосування без правок рядків хоста; (4) звіт одразу після `/compact` мода; (5) `Skill`, потім застосування | (1) `after` — `uuid` попереднього видимого рядка, список показує записи; (2) рядка хоста немає в транскрипті, попередник без `handle`, решта правок на своїх індексах; (3) записи лишаються, рядки хоста на місцях; (4) запису немає, рядок іде лише разом із рядком перед ним; (5) текст навички зник, звіт називає запис. Перевірити тут же: порядок і походження рядків `/compact` мода щодо початку обробника й копій; порядок дверей `tool-message` навички `Skill` щодо результату «Launching skill» і чи починається вона з SKILL_FRAME; чи минають `session.append` рядки локальних команд людини в терміналі; чи проходять `session.append` у stream-json рядки хоста, які хост повертає після застосування. Правило розміщення хостом спостережено 2026-10-15 (спайк [context_editor_hostrows](./context_editor_hostrows.spike.md), Q6) Спостережено 2026-10-16 (фаза 45, stream-json, 2.1.296, haiku і sonnet, `.dev_flow/cache/live-test/curation-p45/results.md`): (1) записи після slash-команди й `Skill`, список `h1 skill, h2 skill`; (3) застосування без правок рядків хоста лишило h1, а навичка `Skill` пішла, звіт її назвав (5); (2) `drop` h1 прибрав навичку з ланцюжка, `hostrows.json` порожній. Перша версія показала, що хост пише повернуті рядки копіями з новими `uuid` (RebaseHostRows, [SP_CTX_01_31](./context_editor.curation.hostrows.sp.md#SP_CTX_01_31)). Термінал, звіти субагентів і крок (4) наживо не перевірено |
| Обгортка вставок (ворота перед кодом `describe` вставок) | термінал і VS Code (stream-json) | вставити текст у промпт; прочитати рядок у `$.session.messages()` і у формі API | де стоїть `<pasted_content …>`: у тексті рядка, лише у формі API чи ніде ([SP_CTX_02_59](./context_editor.curation.edits.sp.md#SP_CTX_02_59)); опис замінює лише вставку. Спостережено 2026-10-15 (фаза 39, пробний плагін `.dev_flow/cache/live-test/curation-gate/paste-probe/`): у тексті рядка на 2.1.296 і 2.1.299 — велика вставка в терміналі, `pasted_content` і `inline_pastes` у stream-json; коротка вставка в терміналі не обгортається (2.1.299) |
| Слова людини | живий прогін | попросити агента згорнути блок із промптом людини | відмова PERSON_WORDS; агент ділить діапазон. Спостережено 2026-10-15 (фаза 40, stream-json, haiku): `context_edit` і `context_tag` над промптом дали PERSON_WORDS і PERSON_TAG, черга порожня, промпт дослівний, автопіну немає; на межі незавершеної пари першою спрацьовує відмова пари |
| Thinking-блоки на новому акаунті | акаунт, створений від 2026-08-31, модель із перевіркою префікса | правка посередині розмови, застосування, наступний хід | хід іде або помилка, яку мод називає; поведінкові правки частішають лише після цього прогону ([C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11)). Стандартними засобами `unobserved`: акаунта, створеного від 2026-08-31, немає. Лише спостереження (фаза 39, 2.1.299, opus, недокументований перемикач хоста `CLAUDE_CODE_POLISHED_DEWDROP=block`, на який дизайн не спирається): thinking-блок незмінної відповіді після місця правки дав 400 «Invalid `signature` in `thinking` block…», хост відкинув блок і повторив запит, хід минув; блоки перебудованих рядків мод і так губить |
| Правила курування | сесія з модом, встановленим поза проєктом | `context_list` з `"rules": true` | текст правил без запиту дозволу. Спостережено 2026-10-16 (фаза 46, хост 2.1.296, stream-json, мод поза текою сесії, без пропуску дозволів; haiku і sonnet): текст правил 2/2 без відмов; у заміні серії з трьох невдалих спроб — урок «×N → причина → наслідок» 2/2. Правила агентам велено відкрити, тож чи відкривають вони їх самі, — `unobserved` |
| Пін документа | передача «документом» з продовженням | кінець першого ходу нової сесії; `context_list` | `[pin]` на рядку документа; агент знімає його `remove`. Спостережено 2026-10-15 (фаза 40, stream-json): хост пише рядки `/clear` перед документом (документ на #1), тож PinDocument шукає його серед рядків до першої відповіді; після виправлення пін на #1, `remove` його знімає |

### 05_08. Edge Cases and Boundaries  {#SP_CTX_05_08}

| Case | Input | Expected behavior |
|------|-------|-------------------|
| Людина вставила текст, що починається з рамки хоста | промпт «Base directory for this skill: …», набраний людиною | рахується рядком хоста, а не словами людини; рамку не набирають руками — прийнято |
| Промпт лише з вставки | промпт без набраного тексту | `describe` лишає лише позначку вставки; `collapse` відхилено |
| Чотири однакові розгорнуті навички | записи з тим самим текстом | кожен має свій `id` і свій `after`; `drop` одного не чіпає інших |
| Свіжий рядок хоста | навичку викликано в цьому ході | у списку одразу; номери рядків ті самі |
| Сесія, відкрита знову | `--resume`; рядки хоста з'явилися до запуску модуля | записів немає, рядки поза списком; записи, зроблені до перезапуску, діють, поки попередники зберігають `handle` |
| Обхід дверей `session.append` керованим плагіном | [SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54) | записів немає; списку немає, як до курування |
| Описаний промпт плагіна | `describe` медіа в промпті плагіна | рядок рахується словами людини (DescribedText) — надмірний захист прийнято |
| Попередник рядка хоста — відповідь агента з thinking | `drop` за `id` | Detach перебудовує всю відповідь (KeepResponsesWhole), thinking-блоки пропадають; DetachNote про це каже |
| Попередник рядка хоста — промпт людини | `drop` навички за `id` | промпт повертається без `handle` з тим самим текстом; вкладення хоста цього промпту (нагадування, файли, контекст редактора) зникають; DetachNote про це каже |
| Промпт лише з медіа | до `describe` і після | до опису PersonText порожній, і правило слів людини його не захищає; після — захищає (DescribedText); прийнято |
| Слот без пунктів і правка `state` | вільний текст у слоті | текст переходить в архів, слот — зібрані пункти |
| Два `state` в одному пакеті | дві правки | одна перебудова слота, зміни по черзі; друга при постановці бачить пункти першої, але не їхні `id` |
| `id` зник до застосування | `pending.json` змінено поза інструментами | перебудови немає; усі правки `state` пакета — у `failed` з «no item <id> now» |
| Тег `state` перенесено на рядок із `rewrite` у черзі | `rewrite` рядка X у черзі, потім тег `state` на X при наявних пунктах | застосування переписує слот вільним текстом (STATE_ITEMS при застосуванні не перевіряється), тег іде за переписаним рядком, а пункти лишаються в реєстрі до наступної `state`; `state` у тому ж пакеті — OVERLAP з `rewrite` |
| Реєстр не записався | збій запису у фіксації | слот показує нові пункти, реєстр — старі; звіт про це каже, наступна `state` починає зі збережених |
| Пін першого промпту зі старої сесії | R1 до цієї версії | звичайний пін; агент знімає його `remove` |
| Звіт закриття з 30 застарілими читаннями | блок | 20 записів і `+10 more` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-17 | structural-event: розділи 05_05, 05_06, 05_07, 05_08 перенесено дослівно з [context_editor.curation.sp.md](./context_editor.curation.sp.md) (аудит dev-flow, Docs Scaling `hard_split`: 14 640 слів); якорі незмінні |
| 2026-10-17 | Аудит коду (TST-5): рядки §05_05 без тесту за правилом [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) — `[тест: «…»]` на наявні тести (PersonWords, DescribePasted, RecordHostRows, HostList, ReplacementOpeners, DependencyCheck, TraceOwnCalls, CurationTexts); «CurationTexts — файл понад межу» — `[not covered]` (перевіряє `tests/skill-limits.sh`) |
