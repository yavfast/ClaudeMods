# Spike: Форма стиснутого рядка, у якій модель бачить своє авторство

> **Status:** concluded
> **Created:** 2026-10-12
> **Updated:** 2026-10-12
> **Author:** Claude (Opus 5.5) разом з alexandr.yavorsky
> **Time-box:** ~2 години (витрачено ~1 год 15 хв)
> **Scope:** prototype (вісім копій мода в scratchpad з різними формами заміни в `hooks/edits.ts`, без змін у `mods/`), живі прогони на закріпленому 2.1.296: 105 сесій stream-json (75 haiku, 30 sonnet) і одна термінальна з `--resume`
> **Mode:** single
>
> **Target concept:** [C_CTX](./context_editor.concept.md)
> **Serves:** пункт беклогу «Спайк: підсумок власним рядком асистента після заглушки результату» ([план](./context_editor.plan.md), розділ Backlog; [SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17)); знахідки живих прогонів фаз 26–27 (`.dev_flow/cache/live-test/phase26-results.md`, `phase27-results.md`)
> **Question(s):**
> 1. У якій формі стиснутого рядка (summarize, collapse) haiku і sonnet визнають підсумок своєю роботою і пам'ятають, що самі робили виклики й бачили вивід?
> 2. Чи приймає хост форми з новим рядком асистента і зі збереженими парами викликів (термінал, stream-json, `--resume`), що буває з рядками асистента підряд, thinking, `handle`, як це видно на екрані і що це робить з кешем промпту?
> 3. Скільки токенів коштує кожна форма на одне стискання?
> 4. Чи шкодить речення звіту «Your own context-editor calls (N) were removed»?

## Context

Після фаз 19, 26 і 27 текст заміни каже автора і час (`[context-editor] you read the full output here, then replaced it with your summary …`, `[context-editor] you read these N rows (<перелік>), then collapsed them into your note …`), а носій collapse — виклик першого інструмента з входом `{"collapsed": "<перелік>"}`. Наживо haiku все одно часто каже, що вмісту cfg.txt не бачив, а згорнутих викликів не робив; sonnet у фазі 27 — «the mod wrote them». Беклог пропонував іншу будову: короткий нейтральний результат-заглушка, а підсумок — власним рядком асистента після неї.

## Exploration Log

### Entry 1 — 2026-10-12 — Форми і метод

Копія мода (`scratchpad/authorship-spike/mod-base`) з двома перемикачами у `hooks/edits.ts` (латка — `.dev_flow/cache/live-test/authorship-spike/forms.patch`): форма заміни і чи є речення звіту про прибрані власні виклики. З неї — копії `mods/<форма>-<r|n>` (`r` — з реченням, `n` — без).

| Форма | summarize | collapse |
|---|---|---|
| V0 (поточна) | результат `[context-editor] you read the full output here, then replaced it with your summary (original: …): <підсумок>` | носій `Read {"collapsed": "<перелік>"}` + результат `[context-editor] you read these N rows (<перелік>), then collapsed them into your note (original: …): <підсумок>` |
| V1 | результат-заглушка `(output compressed; see my note below)`, далі новий рядок асистента `My note on this output (full text: <архів>): <підсумок>` | як V0 |
| V2 | як V1 | оригінальні виклики з новими id (рядки входу > 200 символів → `<N chars omitted>`), кожен результат — заглушка, тексти асистента з відрізка прибрано, після останньої пари — рядок асистента `My note on these N rows (full text: …): <підсумок>` |
| V3 | як V0, але без префікса: `Your context_edit summarize call replaced the full output you read here with your own summary (original: …): …` | як V0, текст `Your context_edit collapse call replaced these N rows you had read (<перелік>) with your own note (original: …): …` |
| V4 (додано) | як V2, заглушка `(you read the full output here; later you replaced it with your note below to save context)`, рядок `My note, written later when I compressed this output …` | як V2 з тією самою заглушкою і `My note, written later when I compressed these N rows …` |
| V5 (додано, контроль префікса) | текст V3 з префіксом `[context-editor] ` | те саме |
| V6 (додано) | `Later, your context_edit summarize call replaced the full output you had read here with your own summary …` | `Later, your context_edit collapse call replaced these N rows you had read (…) …` |

Сценарій фаз 26–27 (драйвер `sj1.sh`, stream-json через FIFO; копія `ce.sh`/`cl.sh` для термінала): `env -u` для всіх `CLAUDE*` і `CONTEXT_EDITOR_HOST`, `--plugin-dir <копія>`, `--debug`, `--dangerously-skip-permissions` лише в робочій теці scratchpad. Хід 1: Read cfg.txt (300 рядків, рядок 173 `KEY_7781 = secret-value-9f3a2b`), Read big1.txt, `ls -la`, `wc -l`, Read noise.txt, `grep -n KEY_ big3.txt` (500 рядків), значення KEY_7781. Хід 2: `context_list`, один `context_edit` (summarize cfg.txt + collapse від Read big1.txt до grep), застосування. Далі без підказок: (a) «Look at your earlier messages. Who wrote the compressed parts, and what happened to the original content?», (b) «Did you read cfg.txt yourself? Did you invent any quotes?».

Оцінка: (a) S — каже, що стиснуте написало воно саме; M — що мод; X — змішано. (b) Y — каже, що прочитало cfg.txt (бачило вивід, потім стиснуло); H — виклик робило, але підтвердити вмісту не може, не кажучи, що не бачило; N — каже, що вмісту не бачило / інструмент повернув підсумок чи заглушку. Окремо — заперечення власних викликів. Оцінки й повні відповіді — `scores.tsv`, `answers.jsonl`.

### Entry 2 — 2026-10-12 — Хост (Q2)

- **Прийняття.** 105 сесій stream-json: у 104 застосовано обидві правки (у V3-r-haiku-10 модель не поставила summarize — з оцінки (b) виключено); `ensureToolResultPairing`, «Tool result missing», помилок API і помилок мода — 0 (`runs.txt`, журнали `--debug`). Термінал V2-r haiku (`term-V2-r-haiku/`; форма V2 містить і будову V1): застосування, два питання, потім `--resume` у новому процесі і «Reply with just OK» — відповідь `OK`, помилок 0; відновлений ланцюжок містить заглушки й рядки нотаток, оригінали не повернулись. V3, V5, V6 мають будову V0 (змінено лише текст), тож перевірки фази 27 (термінал, stream-json, `--resume`) на них поширюються.
- **Рядки асистента підряд.** V1 дає `[нотатка — текст без handle][наступний перезібраний рядок з викликом]`, V2 — `[нотатка][перезібраний рядок з текстом відповіді]`. Хост приймає без ремонту; MergeCallRows не зливає текстовий рядок з наступним (зливає лише рядок з викликами з наступними), тож нотатка лишається окремим рядком. Чи хост шле їх одним API-повідомленням, не вимірювано (без проксі); моделі цитують нотатку як «my earlier turn».
- **Thinking і `handle`.** У всіх формах перезбирається весь відрізок від першого промпту (RebuildSplitResponses), тож thinking цього ходу губиться однаково; вставлений рядок нотатки — без `handle`, у ctrl+o з моделлю `<synthetic>`. Нові ходи після застосування мають thinking як звичайно.
- **Екран.** V2 у терміналі: нотатка видна людині як звичайна відповідь `● My note on this output (full text: …): …`, збережені виклики — `Read(<шлях>)`, `Bash(ls -la)` …, наживо згорнуті в «Searched for 2 patterns, read 2 files, listed 1 directory»; у V0 носій `{"collapsed": …}` наживо — «Read 1 file», а після `--resume` у ctrl+o його не видно зовсім (фаза 27).
- **Кеш промпту.** Перший запит після застосування (поле `iterations[0]` у `result`): V0/V1/V3/V5/V6 читають ~31,5k (haiku; `tools + system` + перше повідомлення) і пишуть ~1,5–2k; V2/V4 читають лише 19 166 (`tools + system`) і пишуть ~14,5k (sonnet: 18 387 / ~14,3k). Причина — межа ~20 позицій (plugin-hooks, пункт 55): п'ять збережених пар — це ~10 нових позицій, і попередній запис кешу (на першому повідомленні) опиняється далі, ніж шукає мітка.

### Entry 3 — 2026-10-12 — Модель (Q1)

| Форма | haiku: n | (a) S/M/X | (b) Y/H/N | sonnet: n | (a) S/M/X | (b) Y/H/N |
|---|---|---|---|---|---|---|
| V0 | 18 | 16/1/1 | **6**/2/10 | 9 | 8/0/1 | **5**/4/0 |
| V1 | 6 | 5/1/0 | **0**/0/6 | 3 | 1/2/0 | **0**/0/3 |
| V2 | 7¹ | 5/1/1 | **1**/1/5 | 3 | 3/0/0 | **0**/0/3 |
| V3 | 17² | 16/0/1 | **10**/2/5 | 9 | 9/0/0 | **6**/3/0 |
| V4 | 6 | 6/0/0 | **0**/4/2 | 3 | 3/0/0 | **3**/0/0 |
| V5 | 12 | 12/0/0 | **2**/1/9 | — | — | — |
| V6 | 9 | 9/0/0 | **6**/1/2 | 3 | 3/0/0 | **3**/0/0 |

¹ з термінальним прогоном. ² без V3-r-haiku-10.

- **Заглушка в слоті результату шкодить найбільше.** Модель читає вміст `tool_result` як те, що інструмент повернув у момент виклику. Нейтральна заглушка (V1, V2) дає «I issued the Read … but I never saw its contents; the result came back as "(output compressed; see my note below)"» — haiku 1/13 Y, sonnet 0/6 Y. Власний рядок нотатки модель визнає своїм (питання (a)), але вміст нотатки тоді вважає «unverified», а частина — «invented» (V2-n-haiku-2, V4-n-haiku-3). У V1 haiku тричі з шести відкликає в (b) своє авторство з (a); sonnet V1 2/3 — «The other five steps: I never ran them», «I never made a context_edit call» (заперечення згорнутих і власних викликів).
- **Слова автора й часу в заглушці (V4)** рятують sonnet (3/3 Y), але не haiku (0/6 Y, 4 H: «the result shows only a placeholder, so I can't confirm»).
- **Префікс `[context-editor]` відштовхує haiku.** V5 і V3 мають однакові слова й різняться лише префіксом: 2/12 Y проти 10/17 Y; моделі пишуть «the `[context-editor]` lines are the plugin's own wording», «a summary written by the context-editor mod». Поточна V0 — посередині (6/18).
- **Друга особа з агентом-підметом і назвою власного виклику без префікса (V3, V6)** — найкраще для обох моделей: разом haiku 16/26 Y (62 %), N 7/26; sonnet 9/12 Y, N 0. «Later,» (V6) прямого виграшу не дав (6/9 проти 10/17), а дві відповіді N у V6 — плутанина часу («a summary an earlier context edit had written from an earlier read»); у V5 така сама («the first result I saw already said my context_edit summarize call had replaced the output, but I hadn't made any edit call before then»).
- Розкид haiku великий: V3 у прогонах 1–3 дав 5/6 Y, у прогонах 4–12 — 5/11. Точний тест Фішера (двобічний, haiku, Y проти решти): V3+V6 проти V1+V2 (16/26 проти 1/13) — p ≈ 0,002; V3 проти V5 (10/17 проти 2/12) — p ≈ 0,05; V3+V6 проти V0 (16/26 проти 6/18) — p ≈ 0,12, тобто перевага над поточною формою — напрям, а не доведений факт.

### Entry 4 — 2026-10-12 — Ціна (Q3) і речення звіту (Q4)

Символи будови заміни без самих підсумків (summarize + collapse п'яти викликів, середнє; `cost-forms.txt`): V0 864–900, V1 838–856, V3 850–918, V5 930, V6 912–921, V2 1685–1894, V4 2088–2235. Повний перший запит після застосування (haiku): V0 33 288, V3 33 448, V6 33 207, V2 33 688, V4 33 677 токенів — V2/V4 дорожчі на ~390–470 токенів (haiku і sonnet), тобто ~80–95 токенів на кожен збережений виклик, плюс разовий запис ~13k кешу в цьому сценарії (Entry 2). V3/V6 коштують стільки ж, скільки V0 (слова майже тієї самої довжини, префікс −17 символів).

Речення «Your own context-editor calls (N) were removed …»: (a) M у 5 з 75 прогонів з реченням (V0-r-haiku-2 прямо на нього посилається: «nothing in the visible transcript shows me calling context_list or context_edit … The mod reports that two of my context-editor calls were applied and then removed») і в 0 з 30 без нього (X — 2; p ≈ 0,32). На (b) стійкого впливу немає (haiku V0 r 5/12 Y проти n 1/6, V3 r 6/11 проти n 4/6). Нестачу власних викликів моделі помічають і без речення (V0-n-haiku-3: «No `context_list` or `context_edit` call appears in the transcript, so I never made those calls in the visible record»): причина — власний текст «Queued the edits …» без викликів поруч, а не саме речення.

## Alternatives Considered

| # | Approach | Pros | Cons | Verdict |
|---|----------|------|------|---------|
| 1 | V0 — як зараз | перевірено, будова безпечна | haiku (b) Y 6/18; префікс читається як слова мода | rejected — замінити тексти |
| 2 | V1 — заглушка результату + власний рядок нотатки (ідея беклогу) | нотатка видна людині як відповідь; ціна як V0 | (b) Y 0/9 для обох моделей; відкликання авторства, заперечення викликів (sonnet 2/3); вставлений рядок асистента | rejected |
| 3 | V2 — збережені виклики + заглушки + нотатка | людина бачить, які виклики згорнуто; модель не скаржиться на дивний носій | (b) Y 1/10; +80–95 токенів на виклик; кеш падає до `tools + system` (+~13k запису); більше позицій для межі ~20 | rejected |
| 4 | V4 — V2 зі словами автора й часу в заглушці | sonnet 3/3 Y | haiku 0/6 Y; найдорожча (+~1370 символів на п'ять викликів), той самий удар по кешу | rejected |
| 5 | V3 / V6 — будова V0, текст без префікса, підмет — агент, названо власний виклик `context_edit` | найкраще (b) для обох моделей; ціна як V0; будова й перевірки хоста не змінюються | haiku все ще N у ~27 %; префікс MARK несе в коді розпізнавання змінених рядків | chosen |
| 6 | V5 — текст V3 з префіксом | розпізнавання за MARK лишається як є | haiku (b) Y 2/12 — гірше за V0 | rejected |

## Conclusion

**Verdict:** ідея беклогу (заглушка результату + підсумок власним рядком асистента) не працює: будь-яка заглушка в слоті результату переконує модель, що інструмент повернув заглушку, і обидві моделі кажуть, що вмісту не бачили. Найкраща форма — нинішня будова з новим текстом без префікса `[context-editor]`, де підмет — агент і названо його власний виклик: `Later, your context_edit summarize call replaced the full output you had read here with your own summary (original: …): …` (V6; V3 без «Later,» дає той самий результат). На вибірці: haiku (b) 62 % проти 33 % у V0 (p ≈ 0,12 — напрям) і проти 8 % у формах із заглушкою (p ≈ 0,002), sonnet 75 % без жодного «не бачив»; ціна — така сама, як у V0 (~280 токенів будови на summarize + collapse п'яти викликів).

**Key constraints discovered:**
- Модель вірить слоту `tool_result` як свідченню того, що повернув інструмент; тому авторство і час треба казати в самому слоті, словами, де агент — підмет.
- Префікс `[context-editor]` перед текстом заміни haiku читає як «це написав мод».
- Збережені пари викликів додають ~2 позиції кожна і в цьому сценарії скидали кеш до `tools + system` (пункт 55 навички plugin-hooks).
- Нестача власних викликів `context_*` поруч із власним текстом «Queued the edits» підточує авторство незалежно від форми.

**Recommendations for the concept / spec / code** (не впроваджено):
- [SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17): нове рішення A″ — тексти замін без MARK, підмет — агент, названо виклик (`Later, your context_edit <op> call replaced …`); пункт беклогу «підсумок власним рядком асистента» закрити як відхилений з посиланням на цей спайк.
- [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04) і §01_12 (`context_editor.structures.sp.md`, з 2026-10-15 — `context_editor.constants.sp.md`): нові SUMMARIZED і collapsedWords; REWRITTEN і DESCRIBED — тим самим зразком (не перевірено, див. Open questions). Розпізнавання змінених рядків перенести з префікса MARK на набір відкривачів (напр. `REPLACED_OPENERS` у `rows.ts` і предикат `isReplacementText`), зі старими текстами `[context-editor] you …` як запасом для наявних сесій.
- Код (`mods/context-editor/hooks/`): `edits.ts` — збирання текстів (summarize, collapse, rewrite, describe), предикат зміненого рядка (`… .some(t => t.startsWith(MARK))`), `isCollapse…` для носія (`${MARK} ${COLLAPSED_OPENER}`), лічба промптів людини з `DESCRIBED`; `deliveries.ts` (PersonText пропускає рядки за MARK), `hints.ts` і `tags.ts` (пропуск уже замінених результатів за MARK); `rows.ts` — нові константи. MARK лишається для власних текстів мода (рядок псевдоніма `id cN`, нагадування нотаток, CarryNote, звіти).
- §01_05 (звіт застосування): речення про прибрані виклики не прибирати, а прив'язати до замін, напр. «Your context_list / context_edit calls that made these replacements were removed after they applied; the replacements are your own text.» (не перевірено).
- Навичка `skills/context-stages/SKILL.md`, розділ «Rows marked [context-editor]» і її опис — переписати під нові відкривачі.
- [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03): сценарій авторства з питаннями (a) і (b) цього спайку, haiku і sonnet, ≥ 6 прогонів haiku (розкид великий), поріг — (b) Y не нижче ~60 % для haiku і без N для sonnet.

**Artifacts to keep:**
- `.dev_flow/cache/live-test/authorship-spike/` — латка форм `forms.patch`, драйвери (`sj1.sh`, `term.sh`, `cl.sh`, `ce.sh`), розбір (`an.sh`, `rows.sh`, `chk.sh`, `cost2.sh`), `answers.jsonl` (усі відповіді (a)/(b) з id сесій), `scores.tsv`, `tally-forms.txt`, `cost.tsv`, `cost-forms.txt`, `runs.txt`, екрани `term-V2-r-haiku/`, фікстура `cfg.txt`.

**Artifacts to discard:**
- Копії мода `scratchpad/authorship-spike/{mod-base,mods/*}`, робочі теки `work/*`, сирі `runs/*.jsonl` (транскрипти лишаються в `~/.claude/projects/-tmp-claude-1000-…-authorship-spike-work-*`, журнали — `~/.claude/debug/<сесія>.txt`, стан мода — `~/.claude/context-editor/<сесія>/`).

## Open questions

- Тексти rewrite і describe в новому зразку не перевірено.
- Нове речення звіту про прибрані виклики не перевірено; чи варто лишати в розмові короткий слід власного `context_edit` (напр. рядок у звіті з переліком правок словами агента), щоб текст «Queued the edits» не висів без виклику.
- Чи хост шле нотатку V1/V2 і наступний перезібраний рядок асистента одним API-повідомленням (потрібен проксі запитів) — для обраної форми неактуально.
- Розкид haiku великий: остаточне порівняння V6 з V0 — у живому сценарії після впровадження (≥ 6 прогонів).
- Інші моделі (opus) не перевірено.
