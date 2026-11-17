# Редактор контексту агента — Specification: Contracts: session intro, stages, notes, person's /compact

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-11
> **Updated:** 2026-11-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
> **Used by:** [курування історії](./context_editor.curation.sp.md) — спирається на [SP_CTX_02_27](#SP_CTX_02_27), [SP_CTX_02_29](#SP_CTX_02_29)
>
> §02 Contracts 02_27, 02_29, 02_30, 02_32, 02_33, 02_42, 02_43 специфікації [SP_CTX](./context_editor.sp.md): контракти SessionIntro, StageBlock, DetectOptimize, `context_note`, NoteReminders, PersonCompact (`/compact` людини, фаза 25), ApplyLine і LogApply. Телеметрія, журнал ефекту, оцінки, м'яке нагадування й ціна кешу — у [telemetry](./context_editor.telemetry.sp.md), доставки хоста — у [deliveries](./context_editor.deliveries.sp.md). Читати перед зміною `hooks/stages.ts`, `notes.ts` або `personcompact.ts`.

## Contents

Розділи (перенесені 2026-10-15 — у дочірніх файлах набору, за посиланнями; h3 розділу «02. Contracts» парасольки):

- [02_27. SessionIntro](#SP_CTX_02_27)
- [02_28. Telemetry](./context_editor.telemetry.sp.md#SP_CTX_02_28)
- [02_29. StageBlock](#SP_CTX_02_29)
- [02_30. DetectOptimize](#SP_CTX_02_30)
- [02_31. Journal](./context_editor.telemetry.sp.md#SP_CTX_02_31)
- [02_32. context_note](#SP_CTX_02_32)
- [02_33. NoteReminders](#SP_CTX_02_33)
- [02_34. Estimate](./context_editor.telemetry.sp.md#SP_CTX_02_34)
- [02_35. RecordDelivery](./context_editor.deliveries.sp.md#SP_CTX_02_35)
- [02_36. InsertDeliveries](./context_editor.deliveries.sp.md#SP_CTX_02_36)
- [02_37. SoftHint](./context_editor.telemetry.sp.md#SP_CTX_02_37)
- [02_38. CacheCost](./context_editor.telemetry.sp.md#SP_CTX_02_38)
- [02_42. PersonCompact](#SP_CTX_02_42)
- [02_43. ApplyLine і LogApply](#SP_CTX_02_43)

## 02. Contracts — вступ сесії, етапи, нотатки, `/compact` людини

### 02_27. SessionIntro  {#SP_CTX_02_27}

> **Курування:** зміни SKILL.md і INTRO_TEXT, файл правил `curation.md` — [SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69).

Purpose: на початку кожної сесії сказати агенту, що він може позначати етапи, просити оптимізацію міткою і бачити телеметрію, а м'яке нагадування ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37)) лише інформує ([C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15); [SP_CTX_DEC_11](./context_editor.decisions-01.sp.md#SP_CTX_DEC_11)): з фази 33 ([SP_CTX_DEC_36](./context_editor.decisions-21.sp.md#SP_CTX_DEC_36)) — повний посібник навички мода прихованим контекстом першого промпту, а після чужої компактизації, що лишилась, — коротка інструкція INTRO_TEXT з наступним промптом (до фази 33 — лише INTRO_TEXT на першому промпті, а посібник — навичкою, яку агент мав відкрити сам).

Processing logic (pseudocode):
    # частина хука prompt.submit DeliverReport (SP_CTX_02_08)
    ON prompt submitted (main conversation, passes the mod's hooks):
        IF storage ready AND TagRegistry state IN (ok, missing):
            IF introduced = false: text = GuideText() ?? INTRO_TEXT          # SP_CTX_DEC_36: посібник; файл не прочитано — INTRO_TEXT
            ELSE IF reintroduce = true: text = INTRO_TEXT                   # після чужої компактизації, що лишилась
            IF text: add text as hidden context, before the report
            once the prompt entered (no drop): on the registry chain, re-read TagRegistry; IF not unreadable: introduced = true, reintroduce = false; write (missing → a new registry with defaults)

    GuideText():                                                            # фаза 33
        file = read `${$.plugin.root}/skills/<SKILL>/SKILL.md` once per module instance (a failed read is retried with the next intro)
        body = file after its frontmatter (the lines from the first `---` to the next `---`), trimmed
        RETURN body empty OR frontmatter left open OR read failed ? none : GUIDE_FRAME + body

Посібник — сам файл навички, тож другого тексту посібника, який треба тримати узгодженим, немає; GUIDE_FRAME каже агенту, що навичку відкривати не треба (інакше `Skill` вставив би той самий текст удруге). Застосування мода першого промпту не прибирає: рядок має `pin`, а прихований контекст промпту — вкладення, яке хост перепитує після компактизації (навичка plugin-hooks, пункт 59). Чужа компактизація, що лишилась (підсумок хоста: `/compact host`, автоматична), прибирає перший промпт разом із посібником, тож її спостерігач ([SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18)) ставить `reintroduce = true`, і наступний промпт, що проходить хуки мода, несе INTRO_TEXT (повний посібник вдруге — ні: ~2,3 тисячі токенів на кожен підсумок; INTRO_TEXT називає навичку). Субагентам посібник не доставляється: `prompt.submit` — лише основної розмови, а їхні виклики `context_*` мод відхиляє.

Прапорець `introduced` живе в реєстрі тегів сесії ([SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10)), тож перезавантаження модуля інструкції не повторює. Сесія — за ідентифікатором: після `/clear` чи `/resume` у тому самому процесі сховище інше (PrepareStorage, [SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15)), і перший промпт нової сесії отримує інструкцію знову; відновлена `/resume` сесія, що вже мала інструкцію, має `introduced = true` і повтору не отримує. Передача копіює реєстр з `introduced = false` ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)). Промпти, які мод надсилає сам (продовження, хід оптимізації, Deliver передачі), хука не проходять (F1), тож інструкцію несе перший промпт людини або іншого розширення. Сховище недоступне або реєстр `unreadable` — інструкції немає: інструменти тоді й так відмовляють, а доставку нема де записати.

Навичка мода. Файл `mods/context-editor/skills/<SKILL>/SKILL.md` поруч із `hooks/`; агент бачить її в переліку навичок як `context-editor:<SKILL>` з описом із frontmatter і відкриває повний текст сам (навичка plugin-hooks, пункт 39). Вимоги до файлу:

| Part | Requirement |
|------|-------------|
| frontmatter `name` | дорівнює SKILL |
| frontmatter `description` | одне речення англійською, ≤ 250 символів: коли відкривати навичку — довга або багатоетапна задача з модом context-editor, рішення про етапи, стискання блоку, вставки (до фази 6 PL_FOLD — мітку), телеметрію, і що означають рядки `Later, your context_…` (з фази 28) і `[context-editor]`; після фази 28 — 236 символів (рев'ю: 261 перевищувало межу) (з фази 26, [SP_CTX_DEC_28](./context_editor.decisions-21.sp.md#SP_CTX_DEC_28): `… the optimization mark, the telemetry, and what rows marked [context-editor] mean.`, 216 символів) |
| розділ «Stages and tasks» (до PL_FOLD фази 5 — «Stages») | коли відкривати етап (початок логічного блоку роботи: фаза, підзадача, дослідження) і закривати (блок завершено, результат відомий); `open` закриває поточний етап; `open` з `index`; `open` з `index` + `close` для блоку, який не відкривали; з фази 5 — завдання (одне прохання людини: `open` з `task` закриває все відкрите, `close` з `task: true`), `nested: true`, позначки `[task ▶ …]`, картка завдання з мінливим фактом знімком; мітка закриває найглибшу область; з verify PL_FOLD — блок завдання починається із запиту людини, а завдання закривають або відкривають наступне перед іншими викликами ходу нового запиту: тоді воно закінчується перед запитом |
| розділ «Compressing a block» | одна `context_edit` на блок; шаблон запису етапу (мета; рішення з причиною, дослівними словами людини і причинами відмови від інших варіантів — пропозиція P11; перевірені факти з джерелами — шляхи, рядки, версії; змінені артефакти; відкриті питання — пропозиція P5); що зазвичай лишається дослівно ([C_CTX_DEC_04](./context_editor.methods.concept.md#C_CTX_DEC_04)); відтворюване (`~`: Read, Grep, Glob) — вказівник «що, де, що знайдено — перечитати за потреби», невідтворюване (живі проби, звіти субагентів, веб-вміст) — обережний підсумок або без змін (пропозиція P2); `collapse` може охопити повідомлення й відповіді людини (AskUserQuestion — P12): вони йдуть в архів, тож запис цитує чинне, а рядки, що мають лишитись дослівними, агент називає в `"keep"`; згортання обходить рядки `[pin]` і `[state]` (PL_FOLD, фаза 3; [SP_FOLD_02_04](./context_folds.sp.md#SP_FOLD_02_04); до неї відповіді людини стояли серед невідтворюваного, а з фази 40 правку над ними мод відхиляв); медіа — описом, якщо завдання дозволяє; одне речення: застосування прибирає з розмови власні виклики `context_*`, а теги й нотатки лишаються — пропозиція P13; застосування переписує кеш промпту один раз — тож правки блоку одним викликом; `"keep_cache": true` зберігає його до найранішої правки, якщо в кінці ходу вона в межах останніх ~20 позицій (рядок `Cache:`), але пізніше відновлення може показати раніші відповіді двічі (фаза 23, [SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22), [SP_CTX_02_38](./context_editor.telemetry.sp.md#SP_CTX_02_38)) |
| розділ «Dead ends» | `disposable` з нотаткою на діапазон `index`..`to` у мить відмови від гілки (пропозиція P4); заміни стають у чергу, коли етап закриває інструмент або агент іде далі від блоку, що чекав (вставка `close` їх не ставить, фаза 6 PL_FOLD) |
| розділ «Trailers» (до фази 6 PL_FOLD — «Optimization mark») | фаза 6 PL_FOLD ([SP_FOLD_02_06](./context_folds.sp.md#SP_FOLD_02_06)): кожна вставка окремим рядком серед останніх непорожніх рядків відповіді, не більше 5; `optimize` — як мітка з 2026-10-14 ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)): ставити, коли агент завершує хід для людини і блок завершено; закриває найглибшу відкриту область (без неї — блок від кінця попереднього; закрита інструментом у тому ході лишається блоком), блок чекає, нічого не стискається; наступний промпт називає блок — стиснути в тому ході, якщо робота йде далі, інакше лишити; відкриття етапу звітує про нього з індексами, воно чи прийнятий `context_edit` закінчує очікування; `close` — закриває найглибшу область, по одній на рядок, з `optimize` не діє: без звіту, без очікування, нічого не ставить у чергу; блок, що чекав, перестає чекати (рев'ю фази 6); `note <text>` — однорядкова нотатка на цій відповіді; деінде чи в ході стискання `/compact` вставки не діють; агент, що сам іде за планом, — етап на фазу, стиснути попередній блок на наступній, завершити хід рядком стану; посеред роботи — закривати етап інструментом. До фази 6 — лише мітка окремим останнім рядком; до 2026-10-14 — хід оптимізації після мітки, «Then the session stops unless \"resume\": true» ([SP_CTX_DEC_16](./context_editor.decisions-01.sp.md#SP_CTX_DEC_16)) |
| розділ «Telemetry» | `context_list` з `count: 0`; що означають рядки TelemetryText ([SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)); м'яке нагадування — рядок `[context-editor: suggestion]` (коли контекст росте або з наступним промптом людини після багатьох читань), що пропонує пакет з виграшем, ціною кешу і вердиктом і лише інформує ([SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37); до фази 23 — рядок `[context-editor]` з кандидатами й розмірами, зокрема на першому записі після багатьох читань); рішення — за логічним станом роботи, а не за розміром; вбудована компактизація хоста — запобіжник; з 2026-10-14 перелік рядків заголовка — в описі `context_list` (навичка посилається на нього), у навичці лишається рядок `Effect` з порадою |
| розділ «Candidates» | причини `review`: `big`, `search`, `stale`, `duplicate`, `agent` ([SP_CTX_01_09](./context_editor.structures.sp.md#SP_CTX_01_09)) і що з ними робити; `[review]` без причини (тег зі старішої версії) пояснює опис `context_list`, тож навичка з фази 22 цього речення не має (місце — для м'якого нагадування) |
| розділ «Compressed rows and mod texts» | з фази 28 (до неї — «Rows marked [context-editor]», фази 26–27, [SP_CTX_DEC_28](./context_editor.decisions-21.sp.md#SP_CTX_DEC_28)): текст, що починається з `Later, your context_edit` чи `Later, your context_tag`, — власна заміна агента (прочитав оригінал, потім стиснув, щоб звільнити контекст; не втрата і не вигадка); початки чотирьох текстів (SUMMARIZED, `collapsedWords` з переліком і полем `collapsed` носія, `rewrite`, `describe`; після `describe` на промпті людини — її власні слова), стара форма `[context-editor] you read …, then replaced …` — те саме; архів (`(original: …)`, `(media: …)`, `media carried as files`); текст з `[context-editor` чи `context-editor:` — мода: звіт застосування (виклики `context_*`, що зробили заміни, прибрано, а процитоване з їхніх результатів — справжнє), рядок `/compact` мода; службові тексти (псевдонім, нагадування нотатки, SUGGESTION, мітка обрізання, продовження, хід оптимізації чи `/compact`, документ передачі) ([SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17), A″) |
| розділ «Notes» | інструмент `context_note`: кілька нотаток на рядок, діапазон чи пару, нуль токенів; приклади — одразу позначити, що рядок можна видалити чи стиснути і як; нагадування собі через `remind_in_turns`; перехресне посилання між рядками; нотатка переходить на рядок заміни і зникає з прибраним рядком; нагадування приходить один раз з результатом наступного виклику будь-якого інструменту основної розмови, зокрема інструментів мода, крім `context_edit` і `context_handoff`; текст нотатки — про зміст, а не про номери рядків: індекси після застосування застарівають (прогін на копії сесії, фаза 17); з 2026-10-14 механіка (кілька нотаток на ціль, діапазон, де їх видно, перенесення, доставка нагадування, видалення) — лише в описі `context_note`, навичка посилається на нього й лишає приклад позначки, `remind_in_turns`, перехресні посилання, «про зміст, а не номери» і нотатки у звіті закриття |
| розділ «State slot» | один власний текстовий рядок з тегом `state`; оновлювати `rewrite` на місці, не дописувати новий стан у кінець ([C_CTX_DEC_19](./context_editor.methods.concept.md#C_CTX_DEC_19)); кожне оновлення — застосування (з фази 23 текст: `Each update is an apply: do it together with a block's edits, not on its own.`), тож оновлювати його разом із правками блоку, а не окремо (прогін на копії сесії: правка біля початку розмови ~250 тисяч токенів коштувала ~$0.9) |
| розмір | ≤ 9000 символів разом із frontmatter (після фази 6 PL_FOLD — 8995: розділ «Trailers» замість «Optimization mark» вміщено скороченням його ж тексту, дужок про `describe` і про шпильки мода, пункту про заміни з тегів, що дублював «Dead ends»; після рев'ю фази 6 — 8981: «Dead ends» і пункт `close` кажуть, що заміни ставить закриття інструментом, а вставка `close` нічого не ставить, коштом речення «You decide when to clean…» вступу і хвоста «State slot»; після verify PL_FOLD — 8994: межі завдання від запиту в «Stages and tasks» коштом скорочення переліку звіту закриття, «Decide by the state of the work», дужки про поле `collapsed` і «; the session resumes» у «Trailers»; до фази 26 — ≤ 8000; межу піднято для розділу «Rows marked [context-editor]», [SP_CTX_DEC_28](./context_editor.decisions-21.sp.md#SP_CTX_DEC_28); після фази 26 і рев'ю — 8997 символів; після фази 27 — 8995: перелік згорнутого і поле `collapsed` у розділі «Rows marked [context-editor]», а приклад «an investigation» у «Stages» і «they change nothing» у «Notes» вилучено); мова — англійська, як у всіх текстах для агента (після фази 22 — 7953 символи: речення про м'яке нагадування вміщено скороченням наявних; після фази 23 — 7982 (з живого прогону: речення про `keep_cache` і його компроміс замість речення про кеш з кінцем ходу; до того — 7992): речення про кеш (з кінцем ходу), власні виклики від найранішої правки і рядок пропозиції вміщено скороченням рядка `Tools:` до назв інструментів, пункту `[pin]` у «Candidates», який дублював речення розділу «Compressing a block», і речення про повторні читання в «Restoring an original»). Після фази 17 файл — 7916 символів, тож новий зміст фази 15 (слот стану, причини `review`, `~`, діапазон, журнал, речення P13, нотатки про зміст) вміщується скороченням наявних розділів (рішення розробника на design sign-off фази 15; [PL_CTX_P15](./context_editor.p15.plan.md#PL_CTX_P15)); після фази 28 — 8988: розділ «Compressed rows and mod texts» і опис з відкривачем `Later, your context_…`. Обидві межі (опис ≤ 250, файл ≤ 9000) перевіряє `sh mods/context-editor/tests/skill-limits.sh`: `claude plugin test` запускає тести без файлової системи, тож модульний тест SKILL.md не прочитає; з 2026-10-14 — 8198: повтори описів інструментів (`context_note`, `context_list`, параметри продовження `context_edit`) і `[disposable: note]` замінено посиланнями; після PL_FOLD фази 5 — 8987: розділ «Stages and tasks» |

Формулювання розділів пише план; специфікація задає обов'язкові частини, межу розміру і те, що INTRO_TEXT називає навичку як `context-editor:<SKILL>`. Файл перевіряє `claude plugin validate` (валідатор приймає теку `skills/`, пункт 39).

Errors: відмов немає — інструкція або додається, або ні; файл навички не прочитано — INTRO_TEXT замість посібника (GUIDE_UNREAD); збій запису `introduced` — INTRO_NOT_RECORDED ([SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)).

### 02_29. StageBlock  {#SP_CTX_02_29}

> **Курування:** готові заміни — [SP_CTX_02_66](./context_editor.curation.edits.sp.md#SP_CTX_02_66); STAGE_ADVICE — [SP_CTX_02_69](./context_editor.curation.edits.sp.md#SP_CTX_02_69).

Purpose: закрити етап і скласти звіт закриття — межі, розмір, медіа, кандидати, телеметрія і порада — для закриття етапу інструментом ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); той самий звіт з індексами — для блоку, що чекав стискання, коли агент відкриває чи закриває етап ([C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30), [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)); скласти без індексів пораду про блок, що чекає, з першим промптом наступного ходу (WaitingAdvice: DeliverReport [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08) і промпт продовження Flush [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)); STAGE_ADVICE одна для всіх ([C_CTX_DEC_17](./context_editor.methods.concept.md#C_CTX_DEC_17), A).

Processing logic (pseudocode):
    FUNCTION CloseStage(reg, rows, carrier, keep = len(Chain(reg)) − 1) → ClosedBlock:   # реєстр пише викликач; PL_FOLD фаза 5: keep — скільки зовнішніх областей лишається; carrier — рядок, перед яким блок закінчується: рядок виклику або промпт ходу для завдання (SP_FOLD_02_05, «Межі завдання від запиту»)
        chain = Chain(reg)                                              # reg.outer + reg.stage, від зовнішньої до внутрішньої
        IF chain empty: error NO_STAGE
        r = chain[keep]                                                 # зовнішня з тих, що закриваються
        reg.lastClosed = { name: r.name, after: r.after, end: MarkBefore(rows, carrier), turn: reg.turn, kind: r.kind }
        Chain(reg) = chain[0 .. keep − 1]                               # stage = last, outer = the rest; empty → both absent
        RETURN reg.lastClosed

    FUNCTION BlockReport(block, replaced?, waiting = false):            # лише виклик context_tag: між ним і звітом компактизації немає; waiting — блок, що чекав стискання (SP_CTX_DEC_37)
        key = Key()                                                     # SP_CTX_02_18, до читання рядків
        rows = CurrentRows(); reg = TagRegistry; api = read main conversation in Messages API form
        t = Telemetry(rows, reg, Journal, api)                               # спершу: Calibrate дає відношення, тож розмір блоку і телеметрія звіту — одним відношенням (рев'ю 39)
        a = StartOf(rows, block.after); e = MarkIndex(rows, block.end)
        head = waiting ? "You marked " + BlockName(block) + " with [context-editor: optimize]; it waited for compression until this call: "
             : (block.name ? "<Stage|Task> \"<name>\" closed: " : "Block (no stage): ")
             + (e is lost ? "its end row is gone; call context_list."
                : block.end null OR a > e ? "no rows in it."
                : "rows #<a>..#<e>, <Estimate(Σ size(rows[a..e]), t.ratio)>, <m> media (~<KB>KB).")   # медіа — CollectMedia(api, rows) для власників у a..e
        IF the block has rows (a ≤ e, e not lost):
            cand = for each reason (a tag without reason, written before phase 15 — "no reason"), active review tags whose target rows lie in a..e: "<reason> #i, #j, …" (≤ MAX_BLOCK_INDEXES, then "+<n> more")
                   + disposable tags in a..e + count of reproducible pairs (REPRO_FLAG) whose call and result lie in a..e, without collapse carriers (CarrierIds, SP_CTX_02_04; фаза 27): "reproducible pairs (~) <n>"
            text = head + "\nCandidates in the block: " + (cand or "none") + "."
            notes = notes of reg whose target (first row of a range) lies in a..e: "<id> #<i>: <text>" (≤ MAX_BLOCK_INDEXES, then "+<n> more")
            IF notes: text += "\nYour notes in the block: " + notes joined "; "
        ELSE text = head
        IF replaced AND replaced.queued > 0: text += "\nReplacements from your disposable tags queued: <queued> (<freed> freed when this turn ends)." + (replaced.resumes = false ? " " + TAGS_STOP : "")   # SP_CTX_DEC_16, нотатка 2026-11-10: пакет лише із замін з тегів сесію не продовжує — агент, що переходить до наступного етапу, бачить це до кінця ходу
        text += "\n" + TelemetryText(t)                                # SP_CTX_02_28
        IF the block has rows: text += "\n" + (waiting ? WAIT_MOVED + " " : "") + STAGE_ADVICE + (block.kind = task ? " " + TASK_CARD : "")   # PL_FOLD фаза 5   # WAIT_MOVED: "You are moving on from it: compress it now unless the next stage still needs its details; it no longer waits."
        IF the block has rows: listedKey = key                          # звіт перелічує індекси рядків блоку, як перелік; «no rows in it.» і загублений кінець — ні
        RETURN text

    BlockName(block) = block.name ? "<stage|task> \"<name>\"" : "the last block (no stage)"

    ListHint = " Call context_list: its header names the block's range (Last block #<a>..#<b>, or Last block from #<a> when its end row is gone); list from its first row (from=<a>) to see those rows ([block ▶ …] .. [block end]) before you edit by index."

    NotesHint(notes) = notes > 0 ? " You have <notes> note(s); context_list shows them next to their rows and in full below each page." : ""   # notes — len(reg.notes); рядків не треба

    WaitingAdvice(block, notes) = "context-editor: you ended your previous answer with [context-editor: optimize]; " + BlockName(block) + " waits for compression."
        + " If this prompt moves on to the next stage, compress the block in this turn: edits apply when it ends. If it continues that stage, leave the block as it is; opening the next stage with context_tag reports it again."
        + ListHint + NotesHint(notes) + "\n" + STAGE_ADVICE + (block.kind = task ? " " + TASK_CARD : "")   # PL_FOLD фаза 6: блок завдання, що чекає, теж просить картку
    # OptimizeText і PersonAdvice вилучено 2026-10-14: мітка не запускає ходу оптимізації (SP_CTX_DEC_37); хід стискання /compact має CompactTurnText (SP_CTX_02_42)

Блок закритого етапу — від рядка після `after` (або від голови) до рядка `end` включно. `block` викликач читає з TagRegistry безпосередньо перед текстом: context_tag — щойно записаний `lastClosed` або, для блоку, що чекав, `lastClosed` до заміни; DeliverReport і Flush — `lastClosed` при `waiting = marked` у момент хука чи відправки. Реєстр `unreadable`, `lastClosed` відсутній або `waiting` не `marked` — поради немає (WAIT_NO_BLOCK). Кінець при закритті інструментом — останній рядок перед рядком із викликом `close` (MarkBefore від `carrier`, [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); при закритті міткою — останній рядок ходу ([SP_CTX_02_30](#SP_CTX_02_30)).

Індекси, розмір і кандидатів має лише BlockReport у результаті context_tag: між викликом і звітом компактизації немає, тож індекси правильні, і звіт із рядками блоку оновлює `listedKey`, як перелік, — інакше правка за індексом з нього без окремого `context_list` відхилялась би; звіт «no rows in it.» або з загубленим кінцем індексів рядків не перелічує і `listedKey` не оновлює. Блок, що чекав стискання, отримує той самий звіт з індексами в результаті першого `open` чи `close` після мітки (`waiting = true`): заголовок називає мітку, а порада WAIT_MOVED каже, що агент іде далі і блок більше не чекає. WaitingAdvice індексів, розміру і кандидатів не має ([SP_CTX_DEC_15](./context_editor.decisions-01.sp.md#SP_CTX_DEC_15)): вона йде на початку ходу, а між нею і правками агента можуть бути застосування, тож агент бачить межі блоку в перегляді, який однаково робить перед правками за індексами; WaitingAdvice `listedKey` не оновлює. Перегляд типово показує першу сторінку від рядка 0 (LIST_COUNT рядків), а блок у довгій розмові стоїть далі, тому ListHint просить узяти діапазон з рядка `Last block #a..#b` заголовка і перелічити рядки від `from = a` — один-два виклики `context_list`. Загублений кінець блоку (`lost`) ніколи не показується як порожній блок: звіт каже, що рядка кінця вже немає. У BlockReport порожній блок поради не має: агент нічого не ставить у чергу, а без тегів `disposable` компактизації немає ([C_CTX_03_03](./context_editor.core.concept.md#C_CTX_03_03)). WaitingAdvice не вирішує за агента: вона лише каже, що блок чекає, і що стискати його варто, коли промпт переходить до наступного етапу; промпт, що продовжує етап, лишає блок як є, а друга мітка того етапу зливає блоки ([SP_CTX_02_30](#SP_CTX_02_30)). Заміни з тегів `disposable` у пораді не рахуються: їх ставить у чергу перший `context_edit` з прийнятою правкою або `open`/`close` при очікуванні ([SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)), і результат цього виклику їх називає.

Errors:
| Code | Condition | Outcome |
|------|-----------|---------|
| NO_STAGE | CloseStage без відкритого етапу | context_tag відхиляє запит ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); реєстр без змін |
| REPORT_FAILED | BlockReport кинув виняток (читання рядків, API-подання чи реєстру) | етап уже закрито й реєстр записано: результат context_tag замість звіту має `<Stage\|Task> "<name>" closed; its report failed: <error>; call context_list`; `listedKey` не оновлено |

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): при `passed` BlockReport закінчується PASSED_ADVICE замість STAGE_ADVICE ([SP_CTX_DEC_38](./context_editor.decisions-21.sp.md#SP_CTX_DEC_38) (в)).

### 02_30. DetectOptimize  {#SP_CTX_02_30}

Purpose: виконати службові вставки в кінці фінального тексту ходу ([SP_FOLD_02_06](./context_folds.sp.md#SP_FOLD_02_06), фаза 6 PL_FOLD): мітка оптимізації (вставка `optimize`) закриває блок і позначає його як такий, що чекає стискання; `close` закриває найглибшу область без очікування; `note` кладе нотатку на рядок відповіді ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), «Мітка оптимізації в тексті»; [C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30); [SP_CTX_DEC_12](./context_editor.decisions-01.sp.md#SP_CTX_DEC_12), [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)); зняти запобіжник ходу стискання `/compact` людини ([SP_CTX_02_42](#SP_CTX_02_42)).

Input: подія завершення ходу (`agentId?`, `isAborted`, `answer` — фінальний видимий текст ходу; навичка plugin-hooks, пункт 38).

Processing logic (pseudocode):
    ON turn completed (main loop, aborted or not), on the registry chain, before TagRegistry.turn += 1 (преамбула 02):
        prompted = false
        IF storage ready: on the queue chain: q = read Queue; IF ok AND q.optimizePrompted: prompted = true; empty = q.compact AND len(NonDeferred(q.edits)) = 0; deferred = q.compact AND len(NonDeferred(q.edits)) < len(q.edits); optimizePrompted = false; compact = false; compactEndedAt = (q.compact AND NOT aborted) ? now : absent; IF empty AND deferred AND NOT aborted: applyDeferred = true, coldSince absent; write   # кінець ходу стискання знімає запобіжник; PL_HELP, фаза 4: відкладені пакети — у тому самому записі
        IF empty AND NOT deferred AND NOT aborted: toast COMPACT_NOTHING        # хід стискання нічого не поставив; підсумку хоста мод не запускає; PL_HELP, фаза 3: відкладені правки не рахуються; фаза 4: з ними — застосування замість тосту
        t = ParseTrailers(answer)                                             # SP_FOLD_02_06: до MAX_TRAILERS останніх рядків вставок
        IF aborted OR t has no lines: RETURN
        IF prompted: RETURN                                                   # MARK_IN_OPTIMIZATION: вставки у відповіді ходу стискання не діють
        said = ["trailer ignored: <line>" for each unknown line]             # рядки стану цього кінця ходу — одним рядком через "; "
        optimize = t has optimize; closes = optimize ? 0 : count of close; notes = texts of note
        IF NOT optimize AND closes = 0 AND no notes: status said; RETURN
        IF storage unavailable: status said + per signal left: "optimization mark ignored: storage unavailable" / "trailer close ignored: …" / "trailer note not saved: …"; RETURN
        IF optimize: q = read Queue
            IF q unreadable: said += "optimization mark ignored: the queue is unreadable"; optimize = false
            ELSE IF q.handoff present: said += "optimization mark ignored: a handoff is pending"; optimize = false   # передача має перевагу; нотатки йдуть далі
        reg = TagRegistry; IF unreadable: the same lines with "the tag registry is unreadable"; RETURN
        IF NOT optimize: (close: CloseAtTurnEnd, нижче; note: нижче); write TagRegistry; status said; MarkDue(len(Chain(reg)), names) when a close closed a region; RETURN   # names — закриті області, від зовнішньої (PL_HELP фаза 7, AreaClosed)
        rows = CurrentRows(); normalize a lost stage.after or lastClosed.after to null; a lost lastClosed.end stays (SP_CTX_01_18)
        IF NOT (reg.lastClosed present AND reg.lastClosed.turn = reg.turn):    # у цьому ході етап інструментом не закривали
            end = MarkBefore(rows, len(rows))                                 # останній рядок ходу, разом із відповіддю з міткою
            merge = reg.waiting present                                       # блок, що чекав: людина продовжила його етап — блоки зливаються
            d = last(Chain(reg)); holds = merge AND d AND StartOf(rows, d.after) ≤ StartOf(rows, reg.lastClosed.after)   # PL_FOLD фаза 5: охопна область блоку, що чекав
            IF d AND NOT holds:                                               # мітка закриває лише найглибшу область
                reg.lastClosed = merge ? { name: absent, after: reg.lastClosed.after, end, turn: reg.turn }
                                       : { name: d.name, after: d.after, end, turn: reg.turn, kind: d.kind }
                Chain(reg) = Chain(reg) without d
            ELSE IF merge: reg.lastClosed = { name: reg.lastClosed.name, kind: reg.lastClosed.kind, after: reg.lastClosed.after, end, turn: reg.turn }   # охопна область лишається відкритою
            ELSE: reg.lastClosed = { name: absent, after: reg.lastClosed ? reg.lastClosed.end : null, end, turn: reg.turn }   # SP_CTX_DEC_14
        reg.waiting = marked
        notes: the same as below, in the same write
        write TagRegistry                                                      # збій запису: status "context-editor: optimization mark ignored: <error>"
        MarkDue(len(Chain(reg)), closed)                                       # SP_FOLD_02_03, після запису; закриття інструментом цього ходу — так само
            # PL_HELP фаза 7 (SP_HELP_02_07, SP_FOLD_02_06): closed = назви областей, які зняла з ланцюжка мітка ([] — блок без області);
            # блок, закритий інструментом у цьому ході (гілка «IF NOT» не виконалась) — closed відсутнє: нових назв немає, CheckErrands не запускається

    CloseAtTurnEnd(reg, rows, closes):                                         # вставка close, по одній області на рядок
        normalize lost starts (SP_CTX_01_18); IF Chain(reg) empty: nothing     # без відкритої області — нічого, MarkDue не викликається
        IF reg.waiting present: end the wait (EndWaiting), as a close by the tool does; nothing queued
        CloseStage(reg, rows, len(rows), keep = max(0, len(Chain(reg)) − closes))   # блок — зовнішня із закритих, до кінця ходу; не чекає

    notes:                                                                     # вставка note
        at = the last assistant row after the last prompt whose text holds the last trailer line
        IF none: said += "trailer note not saved: the row of the answer was not found" per note
        ELSE: ApplyNoteRequests(reg, rows, [{op: add, index: at, text}] per note); each rejection: said += "trailer note not saved: <reason>"

Вставки діють лише останніми рядками фінального тексту ходу (поле `answer` події `turn.complete`): найдовша серія рядків наприкінці, кожен з яких після обрізання пробільних символів починається з TRAILER_HEAD і закінчується `]`, не більше MAX_TRAILERS останніх ([SP_FOLD_02_06](./context_folds.sp.md#SP_FOLD_02_06)); відповідь, останній непорожній рядок якої дорівнює OPTIMIZE_MARK дослівно, діє, як до фази 6 ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02)). Вставка раніше в ході (у проміжному тексті перед викликами), процитована посеред відповіді (агент пояснює людині, як просити оптимізацію) або з іншим текстом у тому самому рядку не діє. Блок мітки — `lastClosed` після цього кроку: якщо в тому самому ході агент закрив етап інструментом (`lastClosed.turn` дорівнює ще не збільшеному `TagRegistry.turn`), мітка стосується блоку цього етапу, а відкритий після нього етап лишається відкритим; інакше мітка закриває відкритий етап кінцем ходу; без відкритого етапу — закриває блок без етапу від кінця попереднього закритого блоку (або від голови) до кінця ходу. Рядок фінальної відповіді вже є в розмові на `turn.complete`: живий прогін фази 6 PL_FOLD (2026-11-15, хост 2.1.325, stream-json) поклав нотатки вставок на рядки відповідей і кінець блоку `close` — на відповідь; у терміналі не перевірено. Якби рядка не було, кінець блоку — рядок перед відповіддю, а нотатка вставки не зберігається з причиною `the row of the answer was not found`. Перерваний хід мітки не дає.

Мітка нічого не стискає і нічого не ставить у чергу ([C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30), B): після кінця ходу немає ні ходу оптимізації, ні компактизації, ні перезапису кешу, якщо агент у цьому ході не поставив правок сам (непорожню чергу Flush застосовує як завжди, [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)). Блок лише чекає стискання (`waiting = marked`): назву блоку й пораду WaitingAdvice ([SP_CTX_02_29](#SP_CTX_02_29)) несе перший промпт наступного ходу — промпт людини чи іншого розширення (DeliverReport, [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)) або промпт продовження Flush — і після доставки стан стає `advised`. Блок перестає чекати, коли агент відкриває чи закриває етап інструментом (результат несе звіт блоку з індексами, [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) або ставить правку (`context_edit` з прийнятою правкою, [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)); у тому самому виклику QueueTagReplacements ставить заміни з тегів `disposable` ([SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)). Без переходу (сесія скінчилась) мод нічого не стискає. Друга мітка, поки блок чекає (людина продовжила етап, і агент знову завершив хід міткою), зливає блоки: початок — від блоку, що чекав, кінець — новий; назва — блоку, що чекав, якщо мітка не закрила етапу, інакше блок без назви (злиття двох етапів), і стан знову `marked`, тож порада піде ще раз ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)). Мітка після закриття інструментом у тому самому ході злиття не має: закриття вже зняло очікування попереднього блоку. Запобіжник петлі ходу стискання `/compact` людини: Flush ставить `optimizePrompted`, коли промпт ходу стискання увійшов; кінець наступного ходу основної розмови (зокрема перерваного) знімає прапорець, а мітку в його відповіді ігнорує. «Закрито в цьому ході» звіряється з лічильником завершених ходів: етап, закритий у перерваному ході (лічильник тоді не росте), мітка наступного ходу вважає закритим у своєму ході і бере його блок.

Errors (жодна не виходить до агента; рядок стану бачить людина):
| Code | Condition | Outcome |
|------|-----------|---------|
| MARK_NO_STORAGE | сховище `unavailable` | мітка ігнорується (з нею `close` і `note`: TRAILER_CLOSE_IGNORED, TRAILER_NOTE_NOT_SAVED) |
| MARK_QUEUE_UNREADABLE | Queue `unreadable` | мітка ігнорується (перевірку передачі не зробити); файл перенесе наступний `context_edit` |
| MARK_REGISTRY_UNREADABLE | TagRegistry `unreadable` або не записався | мітка ігнорується; блок не закрито, нічого не чекає |
| MARK_HANDOFF | у черзі запит передачі | мітка ігнорується: передача переносить розмову цілою, а позначити блок агент може в новій сесії; `note` тієї самої відповіді записується |
| MARK_IN_OPTIMIZATION | `optimizePrompted` був `true` — це відповідь ходу стискання `/compact` | вставки ігноруються мовчки; прапорець знято |
| TRAILER_IGNORED | рядок вставки, який не розпізнано (інше тіло; `note` без тексту чи довший за MAX_NOTE) | рядок стану `context-editor: trailer ignored: <рядок>`; решта сигналів виконується |
| TRAILER_NOTE_NOT_SAVED | нотатка не записалась: сховище, реєстр, повний реєстр нотаток, рядка відповіді не знайдено | рядок стану `context-editor: trailer note not saved: <причина>` |
| TRAILER_CLOSE_IGNORED | `close` при недоступному сховищі чи нечитному реєстрі | рядок стану `context-editor: trailer close ignored: <причина>`; область лишається відкритою |
| COMPACT_NOTHING | кінець ходу стискання `/compact` людини (`compact`), не перерваного, без жодної правки в черзі; з PL_HELP, фази 3 — без жодної правки без `deferred` (NonDeferred); з фази 4 — і без відкладених правок (з ними — `applyDeferred`, нижче) | спливне повідомлення COMPACT_NOTHING ([SP_CTX_02_42](#SP_CTX_02_42)); `compact` знято разом із запобіжником |

Порожній хід стискання (змінено C_HELP: PL_HELP, фази 3–4, реалізовано; [SP_HELP_02_10](./context_helper.batches.sp.md#SP_HELP_02_10)) — за NonDeferred: відкладені правки, що чекають у черзі, хід стискання не наповнюють, тож хід без жодної правки без `deferred` порожній. Порожній не перерваний хід, у черзі якого є відкладені правки, у тому самому записі черги ставить `applyDeferred = true` і знімає `coldSince` (фаза 4): COMPACT_NOTHING немає — людина бачить рядок застосування; Flush кінця ходу знаходить чергу за Applicable ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)), і застосування бере всі пакети без продовження сесії (ResumesAfter = false, [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)). Перерваний хід стискання і хід, що поставив власну правку, `applyDeferred` не ставлять: пакети вибирає SelectEdits. У фазі 3 порожній хід давав COMPACT_NOTHING і за відкладених правок, а пакети чекали далі. Промпт ходу стискання несе в кінці тексту блок доставки — нагадування нотаток і результати доручень (PL_HELP, фаза 7; [SP_CTX_02_42](#SP_CTX_02_42)); блок правок не ставить, тож хід, у якому агент лише прочитав його, лишається порожнім. Доручення `apply`, що спрацювало на кінці ходу стискання (TurnEnd, AreaClosed), ставить ту саму позначку `applyDeferred` незалежно від цього кроку (CheckErrands іде після DetectOptimize, [SP_HELP_02_07](./context_helper.errands.sp.md#SP_HELP_02_07)).

Вилучено 2026-10-14 ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)): MARK_NO_REPLACEMENTS і MARK_NOT_QUEUED — мітка не ставить замін з тегів і не пише черги.

### 02_32. context_note  {#SP_CTX_02_32}

Purpose: інструмент агента; додає і знімає службові нотатки до рядків, діапазонів і пар виклику ([C_CTX_03_07](./context_editor.core.concept.md#C_CTX_03_07), [C_CTX_DEC_20](./context_editor.core.concept.md#C_CTX_DEC_20)). Окремий інструмент, а не операції `context_tag`: опис `context_tag` уже близько 1770 з 2048 символів MAX_DESCRIPTION, а фаза етапів додає до нього `state`, діапазон і причини `review`, тож операції нотаток туди не вмістяться без втрати обов'язкового змісту ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), пріоритети опису).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| notes | list<NoteRequest> | yes | 1..MAX_NOTES; запити обробляються по порядку |

NoteRequest:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| op | `add` \| `remove` | yes | — | — | Дія |
| text | string? | для `add` | — | непорожній після обрізання, ≤ MAX_NOTE | Текст нотатки |
| tool_use_id / ref / index | як у TagRequest ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) | для `add` рівно одне з трьох | — | — | Ціль |
| to | int? | no | — | лише з `add` і `index`; `index < to ≤ len-1` | Останній рядок діапазону включно |
| remind_in_turns | int? | no | — | 1..MAX_REMIND; лише з `add` | Через скільки завершених ходів нагадати: `remindAt = TagRegistry.turn + remind_in_turns` |
| id | string? | для `remove` | — | ідентифікатор нотатки | Яку нотатку зняти |

Output: `Added <ids>; removed <ids>; <n> note(s) in the registry.`, рядок `"last" = <CallLabel>`, коли запит з `ref: "last"` розв'язався (фаза 21), і відхилені запити з причинами.

Errors (рівень виклику позначено *, решта — рівень запиту):
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT* | виклик із субагента | `a subagent's context cannot be noted; only the main conversation's.` |
| DENIED_EMPTY* | `notes` відсутній, порожній, не список або довший за MAX_NOTES | `"notes" must be a list of 1..<MAX_NOTES> requests.` |
| DENIED_STORAGE* | сховище `unavailable` | `storage unavailable: <reason>` |
| DENIED_REGISTRY_READ* | TagRegistry `unreadable` | `the tag registry cannot be read (<reason>); it is left as it is.`; реєстр не перезаписується |
| DENIED_REGISTRY_WRITE* | реєстр не записався | `could not save the tag registry: <error>`; нотатки цього виклику не додано і не знято |
| BAD_OP | `op` не `add`/`remove` | `op must be "add" or "remove"` |
| NOTE_TEXT_REQUIRED | `add` без коректного `text` | `a note needs "text" of 1..<MAX_NOTE> chars` |
| TARGET_REQUIRED, UNKNOWN_REF, TARGET_NOT_FOUND, INDEXES_STALE | як у context_tag ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)); крім того, TARGET_NOT_FOUND — `index` або `to` на рядку без тексту і без викликів чи результатів (рядок лише з thinking, відбиток `assistant||`): Locate не знаходить такого рядка однозначно, і перше ж застосування видалило б нотатку (рев'ю 37, W2); для рядка асистента лише з thinking те саме правило діє для тегів за індексом ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) і для цілі `rewrite` та кінця `collapse` (промпт людини з самих медіа там, на відміну від нотаток, ціллю бути може) ([SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03)) (аудит PL_AUD_CTX, CF-3) | для рядка без тексту — `this row cannot be tracked (no text, no tool call); note a neighbouring row` |
| BAD_RANGE | `to` без `index` чи з `remove`; `to ≤ index` або поза межами | `"to" needs "index", the first row of the range` / `"to" belongs to op "add"` / `"to" is the last row of the range: an integer in <index + 1>..<len − 1>` |
| BAD_REMIND | `remind_in_turns` не ціле в 1..MAX_REMIND або з `remove` | `remind_in_turns is an integer in 1..<MAX_REMIND>` / `"remind_in_turns" belongs to op "add"` |
| NOTES_FULL | MAX_NOTES нотаток у реєстрі або файл реєстру став би більшим за MAX_REGISTRY_BYTES (= MAX_QUEUE_BYTES) | `the registry is full (<MAX_NOTES> notes or <MAX_REGISTRY_BYTES> bytes with the tags); remove notes you no longer need` |
| NO_NOTE | `remove` з `id`, якого немає | `no note <id>; give the "id" of a note` |

Тексти відмов рівня виклику мод подає з префіксом PREFIX; причина відхиленого запиту в результаті — `note <n>: <text> (<code>)`, усі разом у рядку `Rejected: <reasons joined by "; ">.`. Для TARGET_REQUIRED, TARGET_NOT_FOUND, INDEXES_STALE тексти: `give exactly one of tool_use_id (a string), index (an integer) or ref (an alias or "last")`, `no completed tool call with id <id>; refresh context_list`, `index out of range (0..<len − 1>); refresh context_list`, `row #<i> cannot be tracked (no text, no tool call); note a neighbouring row`, STALE_INDEXES ([SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03)); UNKNOWN_REF — причина резолвера ([SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17)).

Processing logic (pseudocode):
    FUNCTION context_note(notes, callId):                             # на ланцюжку реєстру тегів; callId — власний tool_use_id з події tool.call (фаза 21: для ResolveLast)
        REQUIRE storage ready, TagRegistry state != unreadable
        rows = CurrentRows(); reg = TagRegistry
        FOR req IN notes:
            validate (table above); on error → rejected += reason; CONTINUE
            add: target as context_tag builds it (SP_CTX_02_11) + range from to
                 reg.notes += { id: NOTE_PREFIX + reg.nextNote, target, text: trimmed text, createdTurn: reg.turn,
                                remindAt: remind_in_turns ? reg.turn + remind_in_turns : absent }; reg.nextNote += 1
            remove: delete the note with that id
        write TagRegistry
        RETURN text report

Опис інструмента (NOTE_DESCRIPTION, ≤ MAX_DESCRIPTION, близько 880 символів) називає: нотатки живуть поза розмовою і нічого не змінюють; кілька на ціль; цілі — як у `context_tag` плюс діапазон `index`..`to`; `remind_in_turns` — одне нагадування після стількох завершених ходів, з результатом наступного виклику будь-якого інструменту, зокрема інструментів мода, крім `context_edit` і `context_handoff`; нотатки видно в `context_list` (`[nN]` і повний текст під сторінкою) і в результаті `close`; нотатка переходить на рядок, що замінив її рядок, і зникає з прибраним; приклади — позначити, що видалити чи стиснути, нагадування, перехресне посилання. Виклики `context_note`, як і інших інструментів мода, DropOwnCalls прибирає при застосуванні ([SP_CTX_02_05](./context_editor.edits.sp.md#SP_CTX_02_05)).

### 02_33. NoteReminders  {#SP_CTX_02_33}

Purpose: один раз доставити агенту належні нагадування його нотаток ([C_CTX_03_07](./context_editor.core.concept.md#C_CTX_03_07)) після виклику будь-якого інструменту основної розмови: для інструментів хоста й інших розширень — додатковим контекстом у загальному хуку, тим самим шляхом, що й рядок псевдоніма ([SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16)); для інструментів мода (`context_list`, `context_edit`, `context_tag`, `context_note`, `context_handoff`, операції доручень `context_helper`) — рядками в кінці їхнього власного результату ([C_CTX_DEC_21](./context_editor.core.concept.md#C_CTX_DEC_21)). З PL_HELP фази 7 ([SP_HELP_02_08](./context_helper.errands.sp.md#SP_HELP_02_08)) нагадування — перша частина блоку доставки (DeliveryBlock): за ними йдуть результати спрацьованих доручень агента, і той самий блок доходить ще у двох безпечних моментах — з промптом, що проходить хук мода (прихований контекст, [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)), і в кінці тексту власного промпту мода (продовження й хід стискання Flush, [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)).

Processing logic (pseudocode):
    FUNCTION NoteReminders() → list<string>:                          # загальний хук викликів або обробник інструмента мода; на ланцюжку реєстру тегів; результат чекає
        IF the cached TagRegistry (01_07) is known AND no note of it has remindAt: RETURN []   # фаза 11 аудиту (CF-22): ворота в пам'яті — ні ланцюжка, ні читання
        reg = TagRegistry; IF unreadable OR missing: RETURN []
        due = notes of reg with remindAt present AND remindAt ≤ reg.turn, oldest first
        IF due empty: RETURN []
        remove remindAt from each of due; write TagRegistry; IF the write fails: RETURN []   # без запису нагадування повторилось би
        RETURN ["[context-editor] reminder from your note <id> (set <reg.turn − createdTurn> turn(s) ago): <text>" FOR n IN due]   # SP_CTX_DEC_17: рядок називає автора нотатки

    # PL_HELP фаза 7 (SP_HELP_02_08): NoteReminders — перша частина ClaimBlock, що тим самим одним записом реєстру
    # знімає й доставлені доручення; ворота — DeliveryPending: кеш знає реєстр, і в ньому немає ні нотатки з remindAt,
    # ні доручення не в стані open → ні ланцюжка, ні читання. Відкинутий промпт повертає remindAt нотаткам, що ще є
    # й нагадування не мають (RestoreBlock); з результатом інструмента доставка остаточна, щойно запис удався.

Ходи рахує `TagRegistry.turn` (завершені ходи основної розмови, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12)), тож нагадування переживає перезавантаження модуля і не рахує власних команд мода. Нагадування приходить з результатом першого виклику інструменту основної розмови (будь-якого, зокрема інструменту мода; не субагента, не відхиленого), що завершився, коли `turn ≥ remindAt`; без викликів воно чекає. Прогін на копії реальної сесії показав, що агент, який у ході викликає лише інструменти мода (перегляд, правки), нагадування не отримував ([C_CTX_DEC_21](./context_editor.core.concept.md#C_CTX_DEC_21)). Інструмент мода додає нагадування після власного тексту і лише тоді, коли сам виклик не відхилено (`deny`) — так само, як загальний хук пропускає відхилені виклики. Винятки — `context_edit` і `context_handoff`: їхні виклики DropOwnCalls прибирає саме тим застосуванням чи засівом, які вони запускають, тож доставлене з ними нагадування зникло б непрочитаним; `remindAt` лишається для наступного виклику (рев'ю 39). З тієї самої причини блоку не несуть `context_recall` (PL_FOLD, фаза 2) і операція `ask` `context_helper` (PL_HELP): їхня пара повертається слідом (RETURNED, ASK_RETURNED), і блок пішов би разом з нею; операції доручень `context_helper` (`errand_add`, `errand_list`, `errand_remove`) блок несуть після свого результату, а відхилені (`deny`) — ні, як решта інструментів мода (PL_HELP, фаза 7). Нагадування з промптом (з фази 7 PL_HELP) приходить з першим промптом основної розмови, що проходить хук мода, — промптом людини, зокрема посеред ходу, промптом `peer` чи іншого розширення, — коли туди не встиг жоден виклик. `context_list` рахує в телеметрії нагадування так, ніби належні вже доставлено, а доставляє їх (знімає `remindAt`) лише після того, як перелік побудовано: збій переліку нагадувань не губить (рев'ю 40). Доставлене нагадування не повторюється, а нотатка лишається (агент знімає її сам). Ціна — читання реєстру тегів на кожен такий виклик; хук його вже чекає заради псевдоніма лише для великих виводів, тож тут читання додається до кожного виклику (файл малий, читання — мілісекунди); інструменти мода реєстр тегів здебільшого вже читають. Нагадування — запит агента самому собі, а не нагадування за розміром ([C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15)).

Автор нагадування ([SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17), аудит PL_AUD_CTX, CF-8). Текст нотатки написав агент, а виклик `context_note`, що його поставив, DropOwnCalls прибирає при застосуванні, тож рядок нагадування каже, чия це нотатка: `reminder from your note <id>`. Промптом нагадування не стає ніколи: воно йде додатковим контекстом після результату інструмента, рядком у власному результаті інструмента мода, прихованим контекстом промпту чи рядком у кінці тексту власного промпту мода (PL_HELP, фаза 7); у останньому разі хост подає текст як слова людини, і саме тому рядок каже «your note», а рядок доручення — «your errand» ([SP_HELP_02_07](./context_helper.errands.sp.md#SP_HELP_02_07)): окремої рамки, як для тексту продовження ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)) чи документа передачі ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)), рядку не треба; префікс `[context-editor]` — той самий, що в рядку псевдоніма.

Ворота в пам'яті (аудит PL_AUD_CTX, фаза 11, CF-22). `remindAt` з'являється лише записом реєстру (`context_note`), а запис через порт оновлює кеш реєстру ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)); тож коли кеш знає реєстр і в ньому немає жодної нотатки з `remindAt` (з PL_HELP фази 7 — і жодного доручення не в стані `open`, DeliveryPending), виклик не стає на ланцюжок реєстру і не чекає фонової роботи на ньому (AutoTag, R4). Реєстр, якого кеш ще не знає (перший виклик сесії, нова епоха), читається як раніше — на ланцюжку.

Errors: відмов немає; реєстр `unreadable` або збій запису — нагадувань цього виклику немає, `remindAt` лишається, і спроба повториться з наступним викликом (чи промптом).

### 02_42. PersonCompact  {#SP_CTX_02_42}

> **Criticality:** core

Purpose: `/compact` людини, коли мод увімкнено ([C_CTX_DEC_23](./context_editor.methods.concept.md#C_CTX_DEC_23), рішення розробника «Агент стискає сам (Recommended)»): без аргументів — не підсумок хоста, а хід стискання всієї розмови (з 2026-10-14 — єдиний хід оптимізації), у якому агент стискає сам; `/compact host` — стандартний підсумок хоста; `/compact <інструкції>` людини і будь-яка `/compact` розширення (MARKER і HANDOFF_MARKER самого мода теж) — до хоста без змін. Автоматична компактизація хоста команди не запускає і цим контрактом не зачіпається ([SP_CTX_DEC_27](./context_editor.decisions-21.sp.md#SP_CTX_DEC_27)).

Хук лише пише запит у чергу і планує Flush ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)): запит — `Queue.optimize` з `Queue.compact` ([SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04)). Далі все йде шляхом ходу стискання (до 2026-10-14 — спільним із міткою оптимізації, [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)): Flush спершу застосовує те, що в черзі, потім надсилає рівно один промпт — CompactTurnText замість промпту продовження; DetectOptimize на кінці ходу стискання знімає запобіжник і `compact` і, якщо хід нічого не поставив у чергу, каже людині спливним повідомленням ([SP_CTX_02_30](#SP_CTX_02_30)); DeliverReport віддає COMPACT_ADVICE з промптом людини, якщо хід стискання не почався ([SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)). Один порядок — спершу застосування, потім один промпт — і жодних паралельних таймерів (рев'ю фази 25: окремий таймер хука змагався з Flush).

Відкладені пакети (змінено C_HELP: PL_HELP, фази 3–4, реалізовано; [SP_HELP_02_10](./context_helper.batches.sp.md#SP_HELP_02_10)). «Те, що в черзі» — Applicable ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)): перше застосування, перед ходом стискання, іде лише за правками без `deferred` і вибирає відкладені пакети за SelectEdits без `applyDeferred` ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)); черга лише з відкладеними правками команди не запускає, і хід стискання починається одразу. Порожнім хід стискання DetectOptimize рахує за NonDeferred ([SP_CTX_02_30](#SP_CTX_02_30)): з відкладеними правками порожній не перерваний хід ставить `applyDeferred` (без `coldSince`) замість COMPACT_NOTHING, і Flush кінця ходу застосовує всі пакети без продовження сесії (фаза 4; у фазі 3 — COMPACT_NOTHING, пакети чекали далі).

Логіка — чисті функції `hooks/personcompact.ts` (CompactRoute, RequestCompact, PersonCompact, CompactFailure) за портом PersonCompactIO: сховище й id сесії одним читанням (CONC-01), Update черги в цьому каталозі, ознака покинутого хука (`next.signal`, CONC-02), планування Flush (RequestFlush), спливне повідомлення; зв'язування — хук `command.run` з матчером `{ command: 'compact' }` у `register.ts`. Текст промпту — CompactTurnText у `hooks/stages.ts`. Пам'яті модуля, окремої від Flush, немає: «зайнято» читається з черги і з `FlushState`.

Власна команда StartRun ([SP_HELP_02_12](./context_helper.batches.sp.md#SP_HELP_02_12); PL_HELP, фаза 6) йде з таймера `session.start`, і повторного входу хост для неї не пропускає: хук `command.run` мода її бачить (зонд DEC_10; команди з таймера `turn.complete` хост пропускає як re-entry). CompactRoute пропускає її за походженням `plugin` (`pass`, нічого не читається), і MARKER доходить до обробника компактизації без змін (тест «PersonCompact — маршрут», `tests/personcompact.test.ts`).

Input: подія `command.run` (`command = compact`, `args`, `origin`; типи хоста `CommandRunInput`).

Processing logic (pseudocode):
    CompactRoute(e) =
        e.origin.kind = plugin                     → pass        # застосування мода (зокрема StartRun з таймера session.start), засів, інші розширення
        trim(e.args) = ""                          → agent       # людина: composer, sdk, unclassified, bridge — будь-яке походження, крім plugin
        lower(trim(e.args)) = HOST_ARG             → host
        otherwise                                  → pass        # власні інструкції людини для підсумку хоста

    RequestCompact(q, planned) =
        q.handoff present                                          → handoff
        q.compact AND (q.optimizePrompted OR (q.optimize AND planned)) → busy   # хід стискання йде, або запит є і Flush заплановано
        q.compactEndedAt present AND (planned OR now − q.compactEndedAt ≤ FLUSH_STALE) → busy   # хід стискання скінчився, Flush його кінця ще не виконано: хост тримає /compact, набрану під час ходу, до його кінця, і хук може спрацювати ще до планування Flush (живий сценарій 8)
        otherwise → written: q with optimize = true, optimizePrompted = false, compact = true, compactEndedAt absent   # запит мітки попередньої версії (optimize без compact) стає цим; запит, чий Flush загубився, пишеться й планується знову

    ON command.run compact (e):                                   # хук, на який хід не чекає (як /handoff)
        route = CompactRoute(e)
        IF route = pass: RETURN next(e)                            # нічого не читається і не чекається до next
        IF route = host: RETURN next(e with args = "")             # стандартний підсумок хоста
        (dir, session) = storage and session id, read once         # CONC-01; немає або кидає → RETURN next(e) (COMPACT_NO_STORAGE)
        on the queue chain in dir: IF hook aborted: no write (aborted) ELSE RequestCompact(q, IsPlanned(FlushState, now))   # CONC-02: остання перевірка перед записом
        IF handoff: RETURN { text: COMPACT_HANDOFF }
        IF busy: RETURN { text: COMPACT_BUSY }
        IF aborted: RETURN { text: COMPACT_REFUSED }               # нічого не записано
        IF queue unreadable OR write failed: RETURN next(e)        # COMPACT_NO_STORAGE
        IF hook aborted: undo; RETURN { text: COMPACT_REFUSED }    # optimize, optimizePrompted, compact — як прочитано
        TRY RequestFlush(session)                                  # SP_CTX_02_06: FlushState.compactSession = session; планує, якщо Flush не заплановано
        CATCH err (the host refused the timer): undo; toast "context-editor: /compact: <err>"; RETURN { text: COMPACT_REFUSED }   # COMPACT_REFUSED: нічого не лишається запланованим чи запитаним
        RETURN { text: COMPACT_REPLY }                             # без next: хост не запускає компактизації

    ON hook failure (.catch): CompactFailure(e, { called, kind }) =
        called OR kind = re-entry OR e.origin.kind = plugin → next(e)   # повтор next безпечний; власний $.command.run мода хост пропускає як re-entry (навичка plugin-hooks, пункт 60)
        otherwise → { text: "compact failed: <kind>; /compact host runs the host's summary" }   # COMPACT_HOOK_FAILED

    CompactTurnText(notes) = "context-editor: the person ran /compact. With this mod on, the host's summary does not run: you compress the conversation yourself in this turn, and the mod applies your batch when the turn ends."
        + " Call context_list (\"count\":0 gives the telemetry and the candidates by reason; then list the rows from the start). Close an open stage whose work is done with context_tag {\"tags\":[{\"op\":\"close\"}]}; then treat the conversation up to the current work as the block: collapse finished stages into stage records and summarize big outputs you have used."
        + NotesHint(notes) + "\n" + STAGE_ADVICE
        + "\nThe session stops after this batch: pass \"resume\": true (or a resume_prompt) in context_edit only if a task was running and should go on. End your turn with a one-line status. Trailer lines have no effect in this turn."

Хід стискання — звичайний хід оптимізації ([SP_CTX_04_06](./context_editor.states.sp.md#SP_CTX_04_06)): Flush (Optimize) для `compact` не перевіряє закритого блоку і надсилає CompactTurnText; заміна `optimize → optimizePrompted` переносить `compact`; мітку в відповіді ходу DetectOptimize ігнорує; `context_edit` без `resume` у ньому ставить `resume = false` ([SP_CTX_DEC_16](./context_editor.decisions-01.sp.md#SP_CTX_DEC_16)), тож після застосування сесія зупиняється, а звіт іде з наступним промптом людини. Пакет, що вже в черзі, застосовується до промпту, і звіт його застосування їде в тексті промпту стискання. З PL_HELP фази 7 ([SP_HELP_02_08](./context_helper.errands.sp.md#SP_HELP_02_08)) промпт стискання, як і промпт продовження, йде через SubmitWithBlock ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)): після CompactTurnText (і звіту) — порожній рядок і блок доставки (нагадування нотаток, чий хід настав, і результати спрацьованих доручень); відмова промпту (OPTIMIZE_FAILED) повертає блок тим самим одним записом реєстру, і він піде з наступною миттю. Збої шляху `compact` у Flush (відмова команди, промпт відхилено) людина бачить спливним повідомленням, а не лише рядком стану, якого у VS Code / stream-json може не бути. Промпт — власний текст мода з PREFIX: хост обгортає його рамкою «The context-editor plugin sent a message: … in the user's place» (навичка plugin-hooks, пункт 57), тож текст сам каже, що `/compact` запустила людина, а пише — мод ([SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17)). Відповідь мода на команду (COMPACT_REPLY) модель теж бачить рядком виводу команди, тому вона говорить про людину й агента в третій особі.

Хід, що вже йде. Вбудована `/compact` без `immediate`: набрана посеред ходу, вона чекає його кінця, і хук спрацьовує, коли сесія вільна (живий прогін: ~80 мс після `turn.complete`). Якщо Flush того ходу вже заплановано, другого таймера немає: той самий Flush застосовує пакет і надсилає промпт стискання замість промпту продовження. Хід, що почався до промпту (OPTIMIZE_PERSON), не переривається: запит лишається для DeliverReport. Сесія, перемкнена `/clear` чи `/resume` між командою і таймером, — Flush пропускає промпт зі спливним повідомленням (COMPACT_SESSION_CHANGED), запит лишається в черзі старої сесії, і DeliverReport віддасть пораду з першим промптом там.

Відповідь мода (`text` без `next`) хост показує як вивід команди під назвами розширень, що чіпляють команду, і пише рядками команди (`<command-name>/compact</command-name>`, порожні аргументи, `<local-command-stdout>`); PersonText читає їх як порожні ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)). Компактизації немає: обробник `session.compact` не викликається (живий прогін: «answered command.run without next(); nothing beneath it ran»). У stream-json ці рядки лишаються серед рядків розмови і після застосування пакета ходу стискання, у терміналі — ні (навичка plugin-hooks, пункт 60).

Errors:
| Code | Condition | Guidance |
|------|-----------|----------|
| COMPACT_NO_STORAGE | сховища немає, читання сховища кидає, черга `unreadable` або запис не вдався | команда йде до хоста як без мода (підсумок хоста) |
| COMPACT_HANDOFF | у черзі запит передачі | відповідь COMPACT_HANDOFF; нічого не записано і не заплановано |
| COMPACT_BUSY | хід стискання йде (`compact` і `optimizePrompted`), запит є і Flush заплановано, або хід стискання скінчився, а Flush його кінця ще не виконано (`compactEndedAt`: Flush заплановано або минуло ≤ FLUSH_STALE від кінця) | відповідь COMPACT_BUSY; другого запиту, таймера і промпту немає. `compactEndedAt` знімає Flush, коли виконується, і новий запит; поза вікном без Flush він нічого не вирішує |
| COMPACT_REFUSED | хук покинуто до запису чи після нього, або хост відхилив таймер | запит повернуто як прочитано, нічого не заплановано; відповідь COMPACT_REFUSED (при відмові таймера ще й спливне повідомлення з причиною); наступна `/compact` планує знову |
| COMPACT_SESSION_CHANGED | сесія змінилась між командою і таймером Flush | спливне повідомлення «/compact skipped: the session changed …»; промпту немає |
| COMPACT_NOTHING | хід стискання скінчився (не перерваний) без жодної правки в черзі; з PL_HELP — без правки без `deferred` і без відкладених правок (фази 3–4) | спливне повідомлення COMPACT_NOTHING (DetectOptimize); підсумку хоста мод не запускає |
| COMPACT_HOOK_FAILED | хук кинув виняток чи перевищив бюджет до `next` для походження людини | CompactFailure: відповідь «compact failed: <kind>; /compact host runs the host's summary»; компактизації немає |

Обхід хуків мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)): маршрут `agent` при вердикті `passed` стає `brief` — `/compact` іде до хоста з CompactBrief, а після підсумку хук робить ObservePassedCompact ([SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55)); черги ходу стискання не пише. `/compact host` і `/compact <інструкції>` — як завжди.

### 02_43. ApplyLine і LogApply  {#SP_CTX_02_43}

> **Criticality:** normal

Purpose: один рядок для людини в стрічці після кожного застосування, що щось змінило, — скільки правок застосовано і скільки звільнено ([C_CTX_DEC_26](./context_editor.core.concept.md#C_CTX_DEC_26), рішення розробника «Так (Recommended)»). Модель його не бачить: канал — `$.ui.log` (навичка plugin-hooks, пункт 62), у рядки розмови нічого не додається.

Input: ApplyReport ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)), калібрування `TagRegistry.charsPerToken` (ratio), ApiChars API-подання, яке прочитав обробник (`apiChars`; відсутнє, коли подання немає або воно сягнуло вікна, ApiCut; фаза 29).
Output: рядок `$.ui.log` або нічого.

    ApplyLine(report, ratio, apiChars?) → string:   # `applyLine` у hooks/edits.ts, чиста
        IF report.applied empty: RETURN ""
        tokens(c) = max(0, round(c / (ratio OR PLAIN_RATIO)))                 # заокруглення Estimate звіту (SP_CTX_02_34)
        freed = tokens(charsBefore − charsAfter)                              # як «estimate: … freed» звіту, не різниця заокруглених розмірів
        before = apiChars present ? apiChars : charsBefore                    # фаза 29: розмір розмови — символи API-подання (з вкладеннями хоста, як чисельник калібрування); без нього — рядки, як до фази 29
        after = before − (charsBefore − charsAfter)
        head = "applied <len(applied)> edit(s)" + (failed ? ", <len(failed)> not applied" : "")
        notes = [ratio absent ? "approx." : "", freed > 0 ? "freed ~" + Kilo(freed) : ""] without empty, joined "; "
        RETURN head + ": conversation ~" + Kilo(tokens(before)) + " → ~" + Kilo(tokens(after)) + " tokens" + (notes ? " (" + notes + ")" : "")   # спершу що виміряно, далі звільнене (рев'ю фази 28)
    Kilo(n) = n < 1000 → n; n < 10000 → n/1000 з одним знаком після коми, без ".0", + "k"; інакше round(n/1000) + "k"   # 950, 4.2k, 41k

    LogApply(id):                                   # `logApplied` у hooks/flush.ts; Flush (SP_CTX_02_06), одразу після `compact`, до продовження чи ходу оптимізації
        IF compacted (обробник записав звіт id цього застосування): line = AppliedLine(id); IF line: $.ui.log(line)   # будь-який збій губить лише рядок
    AppliedLine(id) = пам'ять екземпляра модуля: рядок, який HandleCompaction (SP_CTX_02_07) лишив разом із `lastReported` = id, коли `applied` непорожній; інакше нічого

    LogSeeded(seed):                                # `logSeeded` у hooks/handoff.ts; RunHandoff (SP_CTX_02_21), щойно нова сесія тримає засів
        line = ApplyLine(seed.report, seed.ratio); IF line: $.ui.log("handoff: " + line)   # без apiChars: засів збирає рядки, розмір — за ними, як до фази 29

Приклад: `applied 3 edit(s): conversation ~150k → ~109k tokens (freed ~41k)`, без калібрування — `… tokens (approx.; freed ~41k)`; у терміналі хост малює його сірим рядком `● context-editor: applied 3 edit(s): …` під `⎿ Compacted`; передача — `● context-editor: handoff: applied 2 edit(s): …`. Без калібрування (розмова менша за CALIB_TOKENS) оцінка — PLAIN_RATIO: у живому прогоні фази 28 у терміналі рядок показав ~24k проти ~41,5k за проксі (на виводі `seq` — ~9,7k проти ~22,6k), бо JSON і цифри мають менше символів на токен; тому «approx.»; фаза 29 калібрує перед кожним застосуванням і знижує CALIB_TOKENS ([SP_CTX_02_34](./context_editor.telemetry.sp.md#SP_CTX_02_34), [SP_CTX_DEC_30](./context_editor.decisions-21.sp.md#SP_CTX_DEC_30)). Розмір розмови до фази 29 рахувався за символами рядків, а відношення — за символами API-подання з вкладеннями хоста (CLAUDE.md, перелік навичок, `deferred_tools_delta`): рядок занижував розмову на токени вкладень, хоч і звільнене, і відношення були правильні; з фази 29 «до» — ApiChars, «після» — «до» мінус звільнені символи. Число близьке до Whole ([SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)), тож більше за `conversation` заголовка `context_list` на рядки FIXED_IN_MESSAGES (пам'ять, навички в першому повідомленні).

Чому з Flush, а не з обробника. Обробник `session.compact` працює посеред компактизації хоста; рядок `$.ui.log`, записаний тоді, у терміналі ліг би перед межею компактизації, яку хост ще не записав, і людина могла б його не побачити. Команда `$.command.run('compact')` повертається, коли обробник відповів, тож Flush пише рядок після застосування. Обробник лише лишає рядок у пам'яті екземпляра разом з ідентифікатором звіту (порт `reported(id, line)`), а Flush пише його, коли після команди бачить у черзі звіт саме з цим ідентифікатором. `/compact` людини (хід стискання, [SP_CTX_02_42](#SP_CTX_02_42)) застосовує свій пакет тим самим Flush, тож рядок з'являється і тоді. Скільки звільнено — оцінка тієї самої форми, що в звіті агенту; виміряну зміну показує лише телеметрія агента після наступної відповіді ([SP_CTX_02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28)).

Хости (навичка plugin-hooks, пункт 62; живий прогін фази 28). Термінал: сірий рядок `● <plugin>: <text>` у стрічці, у JSONL сесії — рядок `system`/`informational`, видимий і після `--resume`; модель не бачить ні наживо, ні після відновлення (27 тіл запитів без нього). stream-json: подія `{"type":"system","subtype":"ui_log","plugin":…,"text":…}` у потоці (17/17 сесій, одна на застосування), у JSONL сесії не пишеться; розширення VS Code її не малює (2.1.296, спостереження людини 2026-10-12; там видно лише `$.ui.notify` — backlog плану).

Errors: відмов немає. Рядка немає, коли жодна правка не застосувалась, обробник відповів `skip` без звіту, хост відхилив команду, звіт записав інший екземпляр модуля (перезавантаження між обробником і Flush) або `/compact` з MARKER запустила сама людина (05_04).

Правки повернення (PL_FOLD, фаза 2; [SP_FOLD_02_03](./context_folds.sp.md#SP_FOLD_02_03)) в числі правок рядка не рахуються; пакет лише з повернень дає `returned <n> recall(s)`, а з поверненими парами питань ([SP_HELP_02_05](./context_helper.ask.sp.md#SP_HELP_02_05); PL_HELP, фаза 1) — `returned <n> recall(s) and <m> question pair(s)`.

## Changelog

| Date | Change |
|------|--------|
| 2026-11-17 | PL_HELP фаза 7 ([SP_HELP_02_07](./context_helper.errands.sp.md#SP_HELP_02_07), [SP_HELP_02_08](./context_helper.errands.sp.md#SP_HELP_02_08)): 02_30 — MarkDue вставок з назвами закритих областей (`[]` — блок без області; мітка блоку, закритого інструментом у цьому ході, — без назв); блок доставки в промпті ходу стискання ходу не наповнює; 02_33 — нагадування — перша частина блоку доставки: і з промптом, і в тексті власних промптів мода; ворота DeliveryPending; блок несуть операції доручень `context_helper`, не несуть `context_recall` і `ask` (пара повертається слідом); рядок «your note» і в промпті; 02_42 — промпт стискання через SubmitWithBlock, відмова повертає блок |
| 2026-11-17 | PL_HELP фаза 6 ([SP_HELP_02_12](./context_helper.batches.sp.md#SP_HELP_02_12)): 02_42 — хук `command.run` мода бачить власну команду StartRun з таймера `session.start` (повторного входу хост там не пропускає); CompactRoute пропускає її за походженням `plugin` |
| 2026-11-17 | PL_HELP фаза 4 ([SP_HELP_02_10](./context_helper.batches.sp.md#SP_HELP_02_10)): 02_30 — порожній не перерваний хід стискання з відкладеними правками в тому самому записі черги ставить `applyDeferred` і знімає `coldSince`, без COMPACT_NOTHING; перерваний хід і хід із власною правкою — нічого; 02_42 — Flush кінця такого ходу застосовує всі пакети без продовження |
| 2026-11-16 | PL_HELP фаза 3 ([SP_HELP_02_10](./context_helper.batches.sp.md#SP_HELP_02_10)): 02_30 — порожній хід стискання за NonDeferred (COMPACT_NOTHING і за відкладених правок; `applyDeferred` після нього — фаза 4); 02_42 — перше застосування перед ходом стискання — за Applicable і SelectEdits без `applyDeferred` |
| 2026-11-15 | Verify PL_FOLD, виправлення ([SP_FOLD_02_05](./context_folds.sp.md#SP_FOLD_02_05)): 02_27 — навичка: блок завдання із запиту людини, закривати завдання до інших викликів ходу нового запиту, 8994 символи; 02_29 — `carrier` CloseStage може бути промптом ходу |
| 2026-11-15 | PL_FOLD, фаза 6 ([SP_FOLD_02_06](./context_folds.sp.md#SP_FOLD_02_06)): 02_27 — розділ навички «Trailers» замість «Optimization mark», INTRO_TEXT називає три вставки; 02_30 — DetectOptimize виконує вставки (ParseTrailers, CloseAtTurnEnd, нотатка на рядку відповіді), рядки стану TRAILER_IGNORED, TRAILER_NOTE_NOT_SAVED, TRAILER_CLOSE_IGNORED; текст ходу `/compact`: «Trailer lines have no effect in this turn.»; 02_29 — WaitingAdvice для блоку завдання несе TASK_CARD, як звіт закриття (живий прогін фази 6); рев'ю фази 6: INTRO_TEXT «each on its own line» (997), навичка 8981 (заміни `disposable` — від закриття інструментом), рядок стану обрізає невідомий рядок до TRAILER_ECHO, збій читання розмови дає рядок стану |
| 2026-11-15 | PL_FOLD, фаза 5 ([SP_FOLD_02_05](./context_folds.sp.md#SP_FOLD_02_05)): 02_29 — CloseStage з `keep` над ланцюжком, `kind` у закритому блоці, `Task "…" closed`, TASK_CARD після STAGE_ADVICE для завдання; 02_30 — мітка закриває найглибшу область, друга мітка при блоці, що чекає, лишає охопну область відкритою й подовжує блок, MarkDue з довжиною ланцюжка; 02_27 — навичка: розділ «Stages and tasks» |
| 2026-11-14 | PL_FOLD, фаза 3 ([SP_FOLD_02_04](./context_folds.sp.md#SP_FOLD_02_04)): 02_27 — розділ навички «Compressing a block» каже, що `collapse` бере повідомлення й відповіді людини в архів, називає `keep` і обхід `[pin]` і `[state]` |
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §02 Contracts 02_27–02_38 перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.stages.sp.md](./context_editor.stages.sp.md), якорі без змін |
| 2026-10-11 | PL_AUD_CTX фаза 3 (CF-3): 02_32 — правило «рядок лише з thinking не ціль за індексом» спільне з тегами і правками `rewrite`/`collapse` (посилання) |
| 2026-10-11 | PL_AUD_CTX фаза 3, рев'ю: 02_32 — правило стосується лише рядка асистента з одним thinking; підказка людини лише з медіа лишається ціллю тегів, `context_note` її, як і раніше, не приймає |
| 2026-10-11 | PL_AUD_CTX фаза 5 (CF-8, CF-9): рядок нагадування називає автора — `reminder from your note <id>`, промптом нагадування не стає (02_33); CutDelivery обрізає доставку в рамці всередині тіла і повертає закривальні теги, які забрало обрізання, у межах MAX_DELIVERY_TEXT (02_35) |
| 2026-10-11 | PL_AUD_CTX фаза 7, рев'ю: RecordDelivery (02_35) — файл доставок, який не вдалося перенести вбік, не перезаписується; запис втрачено |
| 2026-10-11 | PL_AUD_CTX фаза 8 (аудит коду, CF-16): 02_38 — Responses, ResponseStart і предикат промпту беруться з [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04) (одне джерело з FrozenPrefix); ResponseStartRows прибрано, CacheCost бере `start` з ResponseStart (без API-подання — початок відрізка, як застосування); CacheShape — відповіді й позиції один раз на пропозицію |
| 2026-10-11 | PL_AUD_CTX фаза 8, рев'ю: 02_38 — Kinds не рахує порожнього рядка `user`, що не промпт; LookbackStart бере ResponseStart кожного рядка (лише рядки, що самі свій початок), рядок `Cache` телеметрії читає API-подання (`context_list`, звіт закриття етапу) |
| 2026-10-11 | PL_AUD_CTX фаза 11 (аудит коду, CF-22): 02_33 — ворота в пам'яті: відомий з кешу реєстр без жодного `remindAt` — без ланцюжка реєстру й читання; 02_37 — реєстри тегів і псевдонімів на гарячому шляху читаються з кешу модуля; порядок воріт не змінено (крок «запит зменшився» потребує `hint` з реєстру) |
| 2026-10-11 | PL_AUD_CTX фаза 12 (аудит коду, CF-25, CF-26): 02_32 — тексти відмов `context_note` дослівно (DENIED_EMPTY і для списку, довшого за MAX_NOTES; MAX_REGISTRY_BYTES); 02_38 — CostRatios: Opus 5.5 лише за ідентифікатором з 5.5, інший Opus і псевдонім без версії — DEFAULT_RATIOS |
| 2026-10-11 | PL_AUD_CTX фаза 12, рев'ю: 02_38 — голий псевдонім `opus` / `opus[1m]` теж має співвідношення Opus 5.5 (псевдонім іде за поточним Opus; переглянути, коли він зміниться) |
| 2026-10-12 | Калібрування бачить вкладення хоста (беклог, сесія d5614704): 02_34 — Calibrate ділить символи API-подання (ApiChars) на Whole, без подання лишає збережене відношення; 02_28 — `t.attached`, `t.chars`, Whole, `cache.tokens` за TailTokens, Telemetry бере `cache = false`; 02_37 — Measure калібрує за API-поданням і повертає `whole`, Propose передає його в CacheCost і BreakEven; 02_38 — ApiTailChars, TailTokens, глибокий запис = Whole − freed |
| 2026-10-12 | Калібрування бачить вкладення хоста, рев'ю і живий прогін (сесія ac285189: відношення 2,43 при істині ≈2,38, після трьох застосувань 2,73 при ≈2,58, стара формула ≈1,49 і падала; «freed» −20…+10 % від виміряного, нагадування в межах ~5 %): 02_28 — рядок розміру називає вкладення першого повідомлення окремо від незмінної частини (`fixed part (system prompt, tools) ~<fixed − attached>; attached in the first message … ~<attached>`), хвіст рядка `Cache` — тисячами (tokensText), ApiCut замість `len < ROW_WINDOW`; 02_37 — запис застосування названо «all the request's messages» |
| 2026-10-12 | Фаза 24: 02_28 — рядок `Host attachments` телеметрії `context_list` (HostAttachState.left; [SP_CTX_02_40](./context_editor.hostattach.sp.md#SP_CTX_02_40)) |
| 2026-10-12 | Фаза 25: 02_42 PersonCompact — `/compact` людини з модом: хід стискання (хід оптимізації на всю розмову), CompactTurnText, CompactTurnEnded зі спливним повідомленням, `/compact host`, походження plugin і власні інструкції — до хоста ([C_CTX_DEC_23](./context_editor.methods.concept.md#C_CTX_DEC_23), [SP_CTX_DEC_27](./context_editor.decisions-21.sp.md#SP_CTX_DEC_27)) |
| 2026-10-12 | Фаза 25, рев'ю і живий прогін: 02_42 — запит у черзі (`Queue.compact`) і Flush замість окремого таймера (один порядок: застосування, потім один промпт), RequestCompact, COMPACT_BUSY і для ходу, що йде, COMPACT_REFUSED (покинутий хук, відмова таймера), COMPACT_SESSION_CHANGED, CompactFailure — чиста функція; 02_30 — кінець ходу стискання знімає `compact` і дає COMPACT_NOTHING |
| 2026-10-12 | Фаза 25, живий сценарій 8 (fail → виправлено): `/compact`, яку хост тримав до кінця ходу стискання, — COMPACT_BUSY за `compactEndedAt` (DetectOptimize ставить, Flush і новий запит знімають, вікно FLUSH_STALE); RequestFlush ставить `compactSession` лише для таймера, що ще не спрацював, Flush знімає його у `finally` |
| 2026-10-12 | Фаза 26 ([SP_CTX_DEC_28](./context_editor.decisions-21.sp.md#SP_CTX_DEC_28)): 02_27 — розділ навички «Rows marked [context-editor]» замість «Restoring an original» (розшифровка кожного тексту мода, власні виклики, прибрані застосуванням), опис навички називає рядки `[context-editor]`, межа SKILL.md — 9000 символів (8940) |
| 2026-10-12 | Фаза 27 ([SP_CTX_DEC_29](./context_editor.decisions-21.sp.md#SP_CTX_DEC_29)): 02_27 — розділ «Rows marked [context-editor]» називає перелік згорнутого і поле `collapsed`, навичка 8995 символів; 02_29 — пара-носій `collapse` не рахується відтворюваною |
| 2026-10-12 | Фаза 28: 02_43 ApplyLine і LogApply — рядок людини після застосування й передачі через `$.ui.log` ([C_CTX_DEC_26](./context_editor.core.concept.md#C_CTX_DEC_26), рішення розробника «Так (Recommended)»); 02_27 — розділ навички «Compressed rows and mod texts» замість «Rows marked [context-editor]», опис з відкривачем `Later, your context_edit` (8994 символи; [SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17), A″); 02_37 — кандидати без замінених за ReplacementText |
| 2026-10-12 | Фаза 28, рев'ю і живий прогін: 02_43 — рядок `conversation ~A → ~B tokens (freed ~X)`, «approx.» без калібрування, звільнене заокруглено як Estimate; результати прогону (термінал, `--resume`, stream-json 17/17); 02_27 — опис навички 236 символів (було 261 > 250), межі перевіряє `tests/skill-limits.sh` |
| 2026-10-12 | Дизайн фаз 29–30: 02_28 — поле `tagsFull` і рядок TAGS_FULL_LINE (фаза 30, CF-34, [SP_CTX_DEC_31](./context_editor.decisions-21.sp.md#SP_CTX_DEC_31)); 02_34 — CalibrateBeforeApply у Flush з Measure, спільним з Telemetry, CALIB_TOKENS 5 000 ([SP_CTX_DEC_30](./context_editor.decisions-21.sp.md#SP_CTX_DEC_30), proposed), передача калібрує як досі; 02_43 — ApplyLine рахує розмову за ApiChars API-подання обробника, без нього — за рядками (фаза 29). Первісний дефект калібрування (символи рядків проти токенів з вкладеннями) виправлено раніше, у 0f9e54f |
| 2026-10-12 | Фази 29–30 реалізовано: 02_34 — `measure(u)` (Measure) виділено з Telemetry без зміни поведінки, `calibrateBeforeApply` за портом CalibrateIO (`usage`, `api`, `readTags` — кеш, `updateTags` — ланцюжок реєстру), CALIB_TOKENS 5 000 ([SP_CTX_DEC_30](./context_editor.decisions-21.sp.md#SP_CTX_DEC_30) B); 02_43 — `applyLine(report, ratio, apiChars?)`; 02_28 — `t.tagsFull` з RegistryFull і рядок TAGS_FULL_LINE (`tagsFullLine` у `hooks/tags.ts`) після рядка нотаток |
| 2026-10-12 | Живий прогін фази 29: 02_34 — CALIB_TOKENS знову 20 000 ([SP_CTX_DEC_30](./context_editor.decisions-21.sp.md#SP_CTX_DEC_30) → A; розбивка хоста завищує системну частину на 13–25 тисяч, похибка 36–51 %); CalibrateBeforeApply і ApplyLine за ApiChars лишаються |
| 2026-10-12 | Фаза 32: 02_37 — речення пропозиції з `keep_cache` більше не каже «with it, a later --resume may show earlier answers twice» (хибно: дублікати дає і типове застосування, а лікує ремонт після відновлення, [SP_CTX_02_47](./context_editor.resume.sp.md#SP_CTX_02_47); виправлення [SP_CTX_DEC_22](./context_editor.decisions-21.sp.md#SP_CTX_DEC_22)) |
| 2026-10-14 | Перехід між етапами ([C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30), [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)): 02_30 — мітка лише закриває блок і ставить `waiting = marked`, друга мітка зливає блоки, без замін з тегів і запису черги (MARK_NO_REPLACEMENTS, MARK_NOT_QUEUED вилучено); 02_29 — BlockReport `waiting` з WAIT_MOVED, WaitingAdvice замість OptimizeText і PersonAdvice |
| 2026-10-15 | Поділ за модулями: розділи 02_28, 02_31, 02_34, 02_37, 02_38, 02_35, 02_36 — дослівно в [context_editor.telemetry.sp.md](./context_editor.telemetry.sp.md), [context_editor.deliveries.sp.md](./context_editor.deliveries.sp.md), якорі ті самі (structural-event) |
