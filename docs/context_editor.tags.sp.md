# Редактор контексту агента — Specification: Contracts: tags, aliases, current rows

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-11
> **Updated:** 2026-10-12
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_11–02_18 специфікації [SP_CTX](./context_editor.sp.md): контракти `context_tag`, AutoTag, QueueTagReplacements, RebindTags, PrepareStorage, MarkCall, ResolveRef, CurrentRows. Читати перед зміною `hooks/tags.ts`, `aliases.ts` або межі поточної розмови в `edits.ts`.

## Contents

Розділи цього файлу (h3 розділу «02. Contracts» парасольки):

- [02_11. context_tag](#SP_CTX_02_11)
- [02_12. AutoTag](#SP_CTX_02_12)
- [02_13. QueueTagReplacements](#SP_CTX_02_13)
- [02_14. RebindTags](#SP_CTX_02_14)
- [02_15. PrepareStorage](#SP_CTX_02_15)
- [02_16. MarkCall](#SP_CTX_02_16)
- [02_17. ResolveRef](#SP_CTX_02_17)
- [02_18. CurrentRows](#SP_CTX_02_18)

## 02. Contracts — теги, псевдоніми, поточна розмова

### 02_11. context_tag  {#SP_CTX_02_11}

> **Курування:** `disposable` над словами людини відхиляється — [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58); `status` для `disposable` — [SP_CTX_01_30](./context_editor.curation.sp.md#SP_CTX_01_30); опис без автопіну — [SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69).

Purpose: інструмент агента; ставить і знімає теги, відкриває і закриває етапи ([C_CTX_DEC_16](./context_editor.methods.concept.md#C_CTX_DEC_16), [C_CTX_DEC_17](./context_editor.methods.concept.md#C_CTX_DEC_17)).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| tags | list<TagRequest> | yes | 1..MAX_TAGS; запити обробляються по порядку, кожен бачить реєстр після попередніх |

Також хук бере з події `tool.call` власний `tool_use_id` цього виклику (`callId`): за ним знаходиться рядок, що несе виклик.

TagRequest:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| op | `add` \| `remove` \| `open` \| `close` | yes | — | — | Дія |
| kind | `pin` \| `disposable` \| `review` \| `state` | для `add` | — | — | Значення тегу; агентський `review` отримує `reason = agent` |
| tool_use_id | string? | для `add`/`remove` рівно одне з трьох | — | — | Ціль — пара виклику |
| index | int? | для `add`/`remove` рівно одне з трьох; для `open` — необов'язковий | — | 0..len-1 | Ціль — рядок за індексом [SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01); для `open` — перший рядок блоку; для діапазону — його перший рядок |
| ref | string? | для `add`/`remove` рівно одне з трьох | — | псевдонім або `last` | Ціль — пара виклику за псевдонімом ([SP_CTX_02_17](#SP_CTX_02_17)) |
| to | int? | no | — | лише з `op = add`, `kind = disposable` і `index`; `index < to ≤ len-1` | Останній рядок діапазону включно ([C_CTX_03_04](./context_editor.core.concept.md#C_CTX_03_04): гілка, яку агент щойно відкинув) |
| note | string? | для `disposable` | — | непорожній, ≤ MAX_TEXT | Нотатка-заміна |
| ttl_turns | int? | no | — | ≥ 1; лише з `kind = review` | Термін |
| stage | string? | для `open` | — | 1..MAX_STAGE_NAME після обрізання пробілів | Назва етапу |

Output: скільки тегів поставлено і знято, відхилені запити з причинами; рядок `"last" = <CallLabel>`, коли запит з `ref: "last"` розв'язався (LAST_TEXTS, фаза 21; так само в `context_note`); для кожного закриття етапу (зокрема того, що закрило `open`) — звіт закриття (BlockReport, [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)); для першого прийнятого `open` чи `close`, поки блок чекає стискання (`TagRegistry.waiting`), — спершу звіт цього блоку з індексами і порадою WAIT_MOVED (BlockReport з `waiting`, [SP_CTX_DEC_37](./context_editor.sp.md#SP_CTX_DEC_37)), а очікування знято; для `open` — `Stage "<name>" opened; its block starts at #<first>.`; для `add state` поверх наявного — `The state slot moved from #<old> to #<new>.`; для поставленого `add disposable` з діапазоном, що містить повідомлення людини, і для `add disposable` на пару з PERSON_TOOLS — попередження PersonTagWarnings ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)): тег ставиться, а результат називає рядки людини, бо заміна з тегу піде в чергу пізніше без попередження ([C_CTX_DEC_21](./context_editor.core.concept.md#C_CTX_DEC_21))

Errors (рівень виклику позначено *, решта — рівень запиту, і решта пакета обробляється):
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT* | виклик із субагента | `a subagent's context cannot be tagged; only the main conversation's.` |
| DENIED_EMPTY* | `tags` відсутній, порожній, не список або довший за MAX_TAGS | `"tags" must be a list of 1..<MAX_TAGS> requests.` |
| DENIED_STORAGE* | сховище `unavailable` | `storage unavailable: <reason>` |
| DENIED_REGISTRY_READ* | TagRegistry `unreadable` | `the tag registry cannot be read (<reason>); it is left as it is.`; реєстр не перезаписується |
| DENIED_REGISTRY_WRITE* | реєстр не записався | `could not save the tag registry: <error>`; етапи цього виклику не відкрито і не закрито, заміни з тегів не поставлено |
| BAD_OP | `op` не з чотирьох | — |
| KIND_REQUIRED | `add` без коректного `kind` | — |
| TARGET_REQUIRED | `add`/`remove`: вказано не рівно одне з `tool_use_id` / `index` / `ref` | — |
| UNKNOWN_REF | `ref` не розв'язується | позначені виклики мають рядок `[context-editor] id …`; для `last` текст — причина ResolveLast (LAST_NONE / LAST_PENDING / LAST_ORPHAN, [SP_CTX_02_17](#SP_CTX_02_17)) |
| TARGET_NOT_FOUND | немає пари з таким id або рядка з таким індексом (зокрема `index` у `open`); `add` за `index` без `to` на рядку асистента без тексту і без викликів (лише thinking, відбиток `assistant||`; промпт людини з самих медіа, відбиток `user||`, ціллю бути може, як і раніше: жоден сусідній рядок його не замінить): Locate не знаходить такого рядка однозначно, і перше ж застосування зняло б тег чи перенесло на інший рядок, як для нотатки ([SP_CTX_02_32](./context_editor.stages.sp.md#SP_CTX_02_32); аудит PL_AUD_CTX, CF-3). `remove` за таким індексом не відхиляється: він знімає тег, поставлений раніше | оновити перегляд; для рядка без тексту — `row #<i> cannot be tracked (no text, no tool call); use a neighbouring row` |
| INDEXES_STALE | ціль за `index` (зокрема `index` у `open` і `to`), а межа поточної розмови змінилась від останнього `context_list` з рядками чи звіту закриття етапу у цьому процесі ([SP_CTX_02_18](#SP_CTX_02_18)) | оновити перегляд |
| NOTE_REQUIRED | `disposable` без коректного `note` | додати нотатку-заміну |
| BAD_TARGET | `disposable` за індексом без `to` на рядок, що не є текстом агента без викликів, або на рядок з тегом `state`; `state` не за `index` або на рядок, що не є текстом агента без викликів з непорожнім текстом | для результатів — тегувати за `tool_use_id`; слот стану — власний текстовий рядок |
| BAD_RANGE | `to` не з `add disposable` за `index`; `to ≤ index` або поза межами; діапазон розриває пару виклику; діапазон захоплює рядок чи пару з тегом `pin` або `state`; рядок `to` — рядок асистента лише з thinking (`row #<to> holds only thinking and cannot end a range`; ту саму причину дає PrepareEdits для згортання цього діапазону): кінець — якір діапазону. Перший рядок діапазону може бути лише з thinking: його знаходить LocateSpan ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) | кінець — рядок з текстом чи викликом |
| BAD_TTL | `ttl_turns` < 1 або не для `review` | — |
| TAGS_FULL | новий тег (не заміна) при MAX_TAGS тегах у реєстрі, або файл реєстру став би більшим за MAX_QUEUE_BYTES | зняти непотрібні теги; з фази 30 у реєстрі лише теги цілей поточної розмови (і `state`): теги зниклих рядків прибирають застосування мода і спостерігач чужої компактизації ([SP_CTX_02_18](#SP_CTX_02_18)), тож кожен тег, який можна зняти, видно в переліку й телеметрії; повний реєстр телеметрія називає рядком TAGS_FULL_LINE ([SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28)) |
| NO_TAG | `remove` для цілі без тегу | — |
| STAGE_NAME_REQUIRED | `open` без коректного `stage` | назва 1..MAX_STAGE_NAME символів |
| STAGE_FIELDS | `open` з полем, крім `op`, `stage`, `index`; `close` з будь-яким полем, крім `op` | — |
| NO_STAGE | `close` без відкритого етапу | щоб закрити блок, який не відкривали, — `open` з `index` першого рядка і `close` в одному виклику |

Processing logic (pseudocode):
    FUNCTION context_tag(tags, callId):
        REQUIRE storage ready, TagRegistry state != unreadable
        rows = CurrentRows() (SP_CTX_02_18); reg = TagRegistry; closes = []; waited = none
        normalize reg.stage.after and reg.lastClosed.after that are lost on rows to null; a lost lastClosed.end stays (SP_CTX_01_18)
        carrier = index of the row of rows whose toolUses hold callId; none → len(rows)   # рядок, що несе цей виклик; ще не записаний — після останнього
        FOR req IN tags:
            validate (table above); on error → rejected += reason; CONTINUE
            IF req.op IN (open, close) AND reg.waiting present:              # SP_CTX_DEC_37: агент іде далі — блок, що чекав, більше не чекає
                waited = reg.lastClosed; reg.waiting = absent                 # до CloseStage, що замінить lastClosed
            open:  IF reg.stage: closes += CloseStage(reg, rows, carrier)                       # SP_CTX_02_29
                   after = req.index given ? MarkBefore(rows, req.index) : MarkBefore(rows, carrier)   # SP_CTX_01_18
                   reg.stage = { name: trimmed req.stage, after, openedTurn: reg.turn }
            close: closes += CloseStage(reg, rows, carrier)
            add, remove:
                target = req.index given ? { anchor: fingerprint(rows[req.index]), hint: req.index }
                                           + (req.to given ? { toAnchor: fingerprint(rows[req.to]), toHint: req.to } : {})
                                         : { tool_use_id: req.tool_use_id or ResolveRef(req.ref, rows, callId) }   # SP_CTX_02_17; last — за рядками до carrier
                add state: remove the registry's other state tag, if any
                add: replace any tag on target (same tool_use_id, or same first-row anchor) with Tag(req, created_turn = reg.turn, reason = agent for review)
                remove: delete the tag on target
        write TagRegistry
        replaced = (closes not empty OR waited) ? QueueTagReplacements() : none   # SP_CTX_02_13, на ланцюжку черги, після запису реєстру
        RETURN text report + (waited ? BlockReport(waited, closes empty ? replaced : none, waiting = true) : "")
               + BlockReport of each close (with replaced in the last one)   # SP_CTX_02_29

Відкриття без `index` ставить межу перед рядком, що несе виклик `open`: блок починається з відповіді, в якій агент відкрив етап. Рядок виклику шукається за `callId` у поточній розмові; якщо хост ще не записав рядок асистента з цим викликом до хука `tool.call` (не перевірено), `carrier = len(rows)`, і межа — останній рядок розмови, тобто той самий рядок перед відповіддю. Межа ніколи не стоїть на рядку лише з thinking (MarkBefore пропускає такі рядки: їхні відбитки однакові й не знаходять рядка однозначно). Відкриття з `index` 0 дає `after = null` — блок від голови. Відкриття нового етапу при відкритому спершу закриває поточний: кінець його блоку — рядок перед рядком виклику, а звіт закриття входить у результат. Закриття і заміни з тегів відбуваються лише після вдалого запису реєстру; QueueTagReplacements після кількох закриттів одного виклику запускається один раз. Блок, що чекав стискання ([C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30)): перший прийнятий `open` чи `close` — це перехід агента до наступного етапу, зокрема без людини, коли агент іде за планом; результат несе звіт блоку з індексами, як звіт закриття, і заміни з тегів `disposable` ставляться в чергу так само, як при закритті; запит, відхилений перевіркою (наприклад, NO_STAGE), очікування не знімає. Агент стискає блок правкою в тому самому ході, завершує хід рядком стану, і після застосування мод продовжує сесію промптом з правки ([C_CTX_DEC_03](./context_editor.core.concept.md#C_CTX_DEC_03)). Збій запису реєстру (DENIED_REGISTRY_WRITE) лишає очікування як було. Порядок запитів має значення: `open` з `index` і `close` в одному виклику закривають блок, який агент не відкривав заздалегідь ([C_CTX_03_03](./context_editor.core.concept.md#C_CTX_03_03), «Закриття без відкритого етапу»).

Опис інструмента (TAG_DESCRIPTION) не довший за MAX_DESCRIPTION. Після фази 17 текст — 1769 символів, тож на нове фази 15 лишається 279. Бюджет фази 15: `state` у пункті (4) — до 150 символів, діапазон `index`..`to` у пункті (2) — до 60, причини в пункті (5) — до 90 (разом до 300); ще щонайменше 30 символів звільняє скорочення пункту (6) до «A new tag on a target replaces the old one; "remove" drops it.» і пояснення `ref` у пункті (2) до «"ref" (a call alias "cN" or "last")». Обов'язковий зміст за пріоритетом: (1) теги живуть поза розмовою і не коштують токенів; обгортка `{"tags":[…]}`, запити по порядку; (2) цілі — `tool_use_id`, `ref` (рядки `[context-editor] id cN`, `last`), `index`, діапазон `index`..`to` для `disposable`; (3) `open` з `stage` і необов'язковим `index`, `close` — повертає межі блоку, кандидатів, телеметрію і пораду; `open` закриває відкритий етап; (4) види: `pin`; `disposable` з нотаткою — заміна ставиться в чергу, коли агент закриває етап або йде далі від блоку, позначеного міткою (з 2026-10-14; текст опису — у межах MAX_DESCRIPTION, напр. «when you close a stage or move on from a marked block»); `review` з `ttl_turns`; `state` — один власний текстовий рядок, що змінюється лише `rewrite`; (5) автоматичні `review` мають причину (big, search, stale, duplicate); (6) `remove` і заміна тегу на тій самій цілі; (7) вказівка на навичку `context-editor:<SKILL>`. Лише в навичці: коли відкривати і закривати етапи, мітка оптимізації, шаблон запису етапу, що робити з кожною причиною `review`. Скорочується спершу текст пунктів (5) і (6); пункти (1)–(4) лишаються повністю.

### 02_12. AutoTag  {#SP_CTX_02_12}

> **Курування:** правило R1 прибрано — [SP_CTX_02_68](./context_editor.curation.sp.md#SP_CTX_02_68).

Purpose: застосувати правила R1, R2, R3 і R5 [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11) до кожного нового рядка основної розмови (R4 — у хуку викликів, [SP_CTX_02_16](#SP_CTX_02_16)).

Processing logic (pseudocode):
    ON row appended (main loop):                   # AppendRow (`appendRow` у hooks/tags.ts) за портом AppendIO; спершу крок якоря доставок (02_35) і запит теки — до next
        stored = next(row)                         # рядок зберігається без змін
        door, origin = from the append event
        IF origin.kind = plugin: RETURN stored     # копія після компактизації плагіна або нотатка плагіна — не новий рядок
        IF door = tool-result AND every tool_use_id of the row is in Copied: RETURN stored   # копія рядка результату приходить з походженням свого інструмента (проба фази 15)
        IF door NOT IN (prompt, tool-result): RETURN stored               # tool-message, attachment — лише для R5 (б), який у backlog (01_11)
        IF NOT AutoTagNeeded(row): RETURN stored                          # фаза 11 аудиту (CF-22): жодне правило рядка не змінить реєстру — ні ланцюжка реєстру, ні читання, ні запиту теки
        in the background, on the registry chain, IF storage ready AND TagRegistry state != unreadable:
            R1: door = prompt AND origin.kind IN (composer, bridge, sdk, unclassified)   # stream-json дає промпту людини unclassified (F3)
            R2, R3: door = tool-result; tool = origin.tool; ids = tool_use_id of each tool_result block; reason big / search   # R3 — лише для блоків без `is_error: true` (фаза 31, CF-52); R2 — за розміром рядка, як і досі
            R5 (a): door = tool-result AND some result text of the row ≥ BIG_ROW:
                rows = CurrentRows()
                FOR each result r of the row WITH len(r.text) ≥ BIG_ROW:
                    call = the call with r.tool_use_id in rows; IF absent OR call.tool starts with OWN_TOOLS: CONTINUE   # інструмент — з власного виклику результату, не з походження рядка
                    earlier = the pairs of rows before the row of r whose result text = r.text
                              + (call.tool = Read ? the earlier Read pairs whose call has equal file_path, offset, limit, pages : none)
                              − pairs whose result text is ReplacementText                 # уже стиснута пара — не дублікат; ReplacementText = повний відкривач фази 28 чи MARK на початку (SP_CTX_01_12)
                    FOR e IN earlier: tag e { review, reason duplicate } unless e has a tag other than review big/search
            # R5 (b) — у backlog (проба фази 15, SP_CTX_01_11): гілки немає, двері tool-message і attachment відсікає перевірка вище
            write TagRegistry if changed
        RETURN stored
    ON turn completed (main loop, not aborted): TagRegistry.turn += 1     # після DetectOptimize (преамбула 02); команди мода подій ходу не дають

    AutoTagNeeded(row) = (door = prompt AND origin.kind IN (composer, bridge, sdk, unclassified))          # R1 (чи перший промпт уже закріплено — з реєстру)
                         OR (door = tool-result AND tool present AND tool not OWN_TOOLS AND ids not empty
                             AND (size ≥ BIG_ROW OR (tool IN SEARCH_TOOLS AND some tool_result block is not is_error)))   # R2, R3 (фаза 31: помилка пошуку — не вивід пошуку)
                         OR (door = tool-result AND some result text of the row ≥ BIG_ROW)                 # R5 (a)
    ON hook failure: RETURN stored row unchanged

Обробник ніколи не змінює і не відхиляє рядок. Рядки з `origin.kind = plugin` правила не бачать: у неінтерактивному хості кожен рядок, повернений обробником компактизації, знову проходить подію додавання (спайк context_editor_handoff_long, Entry 4; навичка plugin-hooks, пункт 24), і рядки промптів приходять з походженням плагіна, що запустив `/compact`. Рядок результату інструменту приходить інакше: двері `tool-result` і походження `{ kind: tool, tool: <інструмент виклику> }`, хоч у транскрипті рядок має штамп `origin: plugin` (проба фази 15, `.dev_flow/cache/phase15/probe/log.jsonl`; рядки асистента — `{ kind: model, model: "<synthetic>" }`). Тому фільтр походження копії результату не відсікав, і на копії реальної сесії R2 поставив `review` на старий великий вивід (діагностика фази 15). `Copied` — `tool_use_id` результатів у рядках, які повернула остання компактизація, побачена хуком компактизації мода (власне застосування, засів або чужа компактизація, що пройшла далі); множина замінюється з кожною такою компактизацією і очищується на початку ходу: копії пишуться між ходами, а свіжий результат буває лише в ході. Рядок, де хоч один результат не з `Copied`, — новий. У терміналі копії `session.append` не проходять (пункт 24), і множина просто чекає наступного ходу. Фільтр охоплює будь-який плагін, а не лише цей мод: копії після компактизації іншого плагіна — так само не нові рядки, а свіжий результат інструменту походження плагіна не має. Промпт, який плагін передає від імені людини (`asUser`), має походження плагіна і теж пропускається; поведінка від цього не змінюється, бо R1 і без фільтра вимагає походження людини. Походження людини для R1 — `composer`, `bridge`, `sdk` і `unclassified`: у неінтерактивному хості рядки промптів людини доходять до події додавання з походженням `unclassified`, а не `sdk` (Verify фази 10, 2026-10-09, F3); рядки з походженням плагіна відсікає фільтр вище, тож копії і промпти плагінів R1 не бачить. Інших хуків додавання рядка мод не має. Рядок R1 у переліку [SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01) — останній рядок `user` без результатів, текст якого збігається з текстовими блоками промпту без урахування пробільних символів (або містить їх); не знайдено — R1 не спрацьовує і `firstPromptPinned` лишається `false`.

R5 ([C_CTX_03_04](./context_editor.core.concept.md#C_CTX_03_04), «Дублікат»; пропозиція P3) позначає ранішу копію, бо пізніша — свіжа і, найімовірніше, потрібна далі. Порівняння тексту — точна рівність; поля `Read` — `file_path`, `offset`, `limit`, `pages` виклику (вхід виклику береться з рядка асистента з тим самим `tool_use_id` у поточній розмові; виклику не знайдено — рівності полів немає). Перетини різних діапазонів одного файлу не позначаються: концепт обмежує дублікат тим самим результатом і тим самим діапазоном. R5 бачить лише великий текст (від BIG_ROW, концепт: «великий текст повторює вміст раннього рядка») і читає поточну розмову лише для результатів і рядків без результатів від BIG_ROW, у фоні, не затримуючи рядка. Інструмент кожного результату береться з його власного виклику: рядок з кількома результатами паралельних викликів має одне походження, а інструменти в ньому різні. Двері `tool-message` і `attachment` хук дивиться лише заради R5 (б); R1–R3 їх не бачать.

Фаза 15 (виконано 2026-10-10). Перед R4 і R5 з'ясовано, чому на копії реальної сесії R2 поставив `review` на старий великий вивід у першому ході (`.dev_flow/cache/live-test/fork-test-results.md`, розділ «Host, resumed or forked process»): копія рядка результату пройшла фільтр походження плагіна, бо приходить з походженням свого інструмента; її тепер відсікає `Copied` (вище) — інакше R5 (а), що читає поточну розмову на кожен великий результат, позначав би ранішу копію самої себе. Проба «Дублікат вставки навички» ([SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03)) показала, що вставка навички — не рядок поточної розмови, тож R5 (б) перейшов у backlog плану, а хук мода (`session.append`; з фази 10 аудиту PL_AUD_CTX — чиста функція AppendRow у `hooks/tags.ts`) і далі пропускає до правил лише двері `prompt` і `tool-result`; R5 (а) реалізовано ([SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11)).

Той самий хук `session.append` веде й RecordDelivery ([SP_CTX_02_35](./context_editor.stages.sp.md#SP_CTX_02_35); фаза 20): двері `tool-result`, `prompt` і `response` основної розмови оновлюють якір у пам'яті модуля, двері `delivery` з вкладенням `queued_command` пишуть запис доставки у фоні. AutoTag від цього не змінюється: доставка — не рядок, правил R1–R5 вона не проходить, а вставлений модом рядок доставки в stream-json приходить дверима `prompt` з походженням плагіна і правила його не бачать.

### 02_13. QueueTagReplacements  {#SP_CTX_02_13}

> **Курування:** тег над словами людини не стає в чергу — [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58).

Purpose: поставити в чергу заміни з тегів `disposable` і оцінити звільнення. Запускають лише закриття етапу інструментом ([SP_CTX_02_11](#SP_CTX_02_11), [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)) і кінець очікування блоку, позначеного міткою оптимізації ([SP_CTX_DEC_37](./context_editor.sp.md#SP_CTX_DEC_37)): перший `open` чи `close` у context_tag або перший `context_edit` з прийнятою правкою агента ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)) — усі читають поточну розмову посеред ходу, коли компактизація щойно не відбувалась; заміни йдуть тим самим пакетом, що й правки агента цього ходу. До 2026-10-14 заміни ставила мітка на кінці свого ходу (DetectOptimize). Ні Flush, ні DeliverReport замін не ставлять. Порогу розміру немає ([C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15)).

Output: `{ queued: int, freed: int }` — кількість поставлених правок і `freed` — Estimate (`Σ size замінюваного − Σ довжина нотаток`) з `TagRegistry.charsPerToken` ([SP_CTX_02_34](./context_editor.stages.sp.md#SP_CTX_02_34)); для `collapse` замінюване — сума `size` рядків діапазону.

Processing logic (pseudocode):
    FUNCTION QueueTagReplacements():                    # на ланцюжку черги
        rows = CurrentRows() (SP_CTX_02_18); reg = TagRegistry; q = Queue
        IF reg or q unreadable: RETURN { 0, 0 }
        edits = []
        FOR tag IN reg.tags WHERE kind = disposable AND its replacement (key below) is not already in q.edits:
            { tool_use_id } AND pair exists → summarize(tool_use_id, tag.note)
            { anchor } without range AND Locate finds the row → rewrite(index, tag.note)
            range AND Locate finds both ends, from < to → collapse(from, to, tag.note)
        (queued, errors) = PrepareEdits(rows, edits, reg, checkListedKey = false)   # pin, state, пари діапазону — як для правок агента; без перевірки listedKey
        queued = [e with via = tag FOR e IN queued]          # фаза 28: текст заміни називає тег агента (`Later, your context_tag disposable tag replaced …`), а не виклик context_edit (SP_CTX_02_04)
        IF queued empty OR len(q.edits) + len(queued) > MAX_QUEUE_EDITS OR the file would exceed MAX_QUEUE_BYTES: RETURN { 0, 0 }
        IF len(q.edits) == 0: q.tagsOnly = true
        q.edits += queued; write Queue (a write failure → RETURN { 0, 0 })
        RETURN { len(queued), freed }

Перевірки `listedKey` рядка 02_03 «межа поточної розмови не змінилась від останнього `context_list`» QueueTagReplacements не робить: індекси замін він бере щойно з Locate на поточній розмові, а не з переліку агента, тож застарілими вони бути не можуть. Ключ заміни — те, за чим RebindTags упізнає заміну тегу в пакеті: `summarize` з `tool_use_id` цілі і `summary = note`; `rewrite` з якорем цілі і `text = note`; `collapse` з якорями обох кінців і `summary = note`. Тег, чия заміна вже стоїть у черзі (закриття етапу інструментом, а потім правка агента при очікуванні в тому самому ході), удруге не ставиться. Відхилені PrepareEdits заміни не повідомляються окремо: тег лишається, а агент бачить його в переліку.

Пакет лише з тегів не продовжує сесію: звіт піде з наступним промптом людини ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)). Правка агента в тому самому пакеті знімає `tagsOnly` ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)).

### 02_14. RebindTags  {#SP_CTX_02_14}

> **Курування:** тег `state` іде й за перебудовою слота правкою `state`, як за `rewrite` — [SP_CTX_02_67](./context_editor.curation.sp.md#SP_CTX_02_67).

Purpose: тримати реєстр узгодженим з розмовою після застосування: теги, псевдоніми, межі етапів і слот стану.

Logic: у [SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07) після ApplyEdits, а також у реєстрах, скопійованих у сховище нової сесії після засіву ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21), крок `registries`; рядки «до» — ті, до яких BuildSeed застосував правки, «після» — засіяні), видалити псевдоніми змінених і зниклих пар з AliasRegistry, а також теги, чиї цілі змінено застосованими правками (пари `summarize`/`drop` разом з їхніми рядками, пари й рядки діапазонів `collapse`, рядки `rewrite`/`describe`; для тегу-діапазону — будь-який рядок діапазону), теги `disposable`, чия заміна (ключ [SP_CTX_02_13](#SP_CTX_02_13)) була в пакеті — застосована чи відхилена ([SP_CTX_04_03](./context_editor.states.sp.md#SP_CTX_04_03)), і теги, чиї цілі не знайдено в новому списку рядків (за `tool_use_id` або Locate; для діапазону — обидва кінці, LocateSpan, [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)); новий список: у компактизації — повернені рядки, а якщо не застосовано жодної правки — рядки події; для засіву — засіяні рядки `s.rows`, а «до» — `s.visible`, пакет — `s.edits` (до перевірки `pin`), застосовані — правки з `s.edits`, чий опис є в `s.report.applied`. Тег рядка, що лишився, отримує новий індекс як `hint` (діапазон — і `toHint`). Тег рядка з викликами, якого правки не зачепили, але Locate його вже не знаходить, бо MergeCallRows злив рядки викликів однієї відповіді ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)), переходить на злитий рядок — рядок «після», що містить перший виклик рядка (`anchor` — відбиток злитого рядка), як нотатка нижче (рев'ю 37, W1; аудит PL_AUD_CTX, CF-4): `pin` на рядку паралельного виклику не губиться від `summarize` сусіднього виклику. Два теги на одному злитому рядку не лишаються: тег один на ціль, і `pin` перемагає. `pin`, що перейшов на злитий рядок, стереже весь рядок, отже й сусідні виклики в ньому: їх уже не стиснути й не прибрати (`target is pinned`), поки `pin` не знято — так задумано, бо тег рядка стереже рядок, а не один виклик (живий прогін аудиту, фаза 3). Тег-діапазон, жодного рядка якого правки не зачепили (RangeAfter): кожен кінець спершу за тотожністю — рядок, повернений з `handle`, той самий об'єкт, хоч би InsertDeliveries вставила рядок доставки всередину діапазону чи перезбирання прибрало з нього рядок лише з thinking; інакше кінець — Locate, а перший рядок — LocateSpan ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)), причому перший рядок лише з thinking — лише коли й кінець не знайшовся за тотожністю (усі рядки перезібрано, як у засіві): якщо кінець лишився тим самим, а такого першого рядка за тотожністю немає, його прибрано з перезібраною відповіддю. Перший рядок, що зник чи не знайшовся, поступається першому рядку діапазону, що лишився тим самим (Survivors), як межа етапу; нічого перед кінцем не лишилось або не знайшовся кінець — тег знімається. Діапазон отримує відбитки нових кінців і їхні індекси. Збій запису реєстру не скасовує застосування. У компактизації RebindTags рахує з реєстрів, прочитаних у кроці фіксації (ланцюжки реєстру і псевдонімів тримаються до запису черги), і нічого не пише, якщо хост покинув диспетчеризацію; записані реєстри повертаються такими, як прочитано, коли запис черги не вдався або диспетчеризацію покинуто до нього ([SP_CTX_02_07](./context_editor.edits.sp.md#SP_CTX_02_07)).

Слот стану ([C_CTX_DEC_19](./context_editor.methods.concept.md#C_CTX_DEC_19)). Тег `state` переживає застосовану `rewrite` власного рядка: тег переходить на переписаний рядок — `anchor` = відбиток рядка нового списку, текст якого дорівнює тексту, який ApplyEdits записав для цієї правки (`MARK + " rewritten" + note + ": " + text`), `hint` — його індекс; кілька таких рядків — найближчий до старого `hint`. Будь-яка інша втрата рядка (згортання діапазону з ним неможливе за PrepareEdits, але ціль може зникнути з вікна, засів може лишити рядок до підсумку) видаляє тег, як інші.

Межі етапів ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02), «Етап»). `stage.after`, `lastClosed.after` і `lastClosed.end` не видаляються, а переносяться:

    FUNCTION Survivors(before, after, changed) → map<int, int>       # індекс у before → індекс у after
        j = 0; map = {}
        FOR i IN 0 .. len(before) − 1:
            IF i ∈ changed OR NOT Distinctive(before[i]): CONTINUE    # SP_CTX_01_18
            k = the first index ≥ j with fingerprint(after[k]) = fingerprint(before[i]); IF none: CONTINUE
            map[i] = k; j = k + 1
        RETURN map

    FUNCTION RelocateMark(m, before, after, applied, produced, changed):
        IF m null: RETURN null
        x = MarkIndex(before, m); IF lost: RETURN null              # рядка вже не було в «до» — межа діє від голови
        Es = the applied edits that replace x (summarize of a pair with a row at x, collapse whose span holds x, rewrite or describe of x) and have a produced entry
        IF Es not empty:
            P = the produced entry of Es with the largest index          # спільний рядок результату кількох summarize — найпізніший створений рядок
            RETURN { anchor: P.fingerprint, hint: P.index }            # заміна: межа на останньому рядку, створеному правкою; індекс — з кінцевого списку
        map = Survivors(before, after, changed)
        FOR p = x DOWN TO 0: IF p ∈ map: RETURN { anchor: fingerprint(after[map[p]]), hint: map[p] }   # прибрано без заміни або змінено засівом
        RETURN null

`changed` — рядки `before`, які не лишились тими самими: зачеплені застосованими правками (як для тегів вище) і, для засіву, рядки з результатом із `s.carried` — CarryNote змінив текст результату, хоч відбиток рядка (роль, ідентифікатори, текст рядка) той самий ([C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02): «змінено засівом»). `produced` — `report.produced` застосування ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)); у засіві — `s.report.produced`.

Межа, чий рядок **замінила** правка (стиснення пари, згортання діапазону, переписування, опис медіа), переходить на останній рядок, створений цією правкою: стиснутий хвіст блоку лишається в ньому, а етап, відкритий одразу після закриття, його не захоплює. Межа, чий рядок **прибрано без заміни** (`drop`, рядок, з якого DropOwnCalls прибрав службовий виклик чи який спорожнів, рядок лише з thinking, що зник) або **змінено засівом**, переїжджає за найближчий попередній рядок, що лишився незміненим. Рядок «лишився», коли його відбиток стоїть у новому списку в тому самому порядку і він не в `changed`. Перезбирання без змін вмісту (рядки результатів без медіа, KeepResponsesWhole, [SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) відбитка не змінює, тож межу на такому рядку не переносить — це той самий рядок. Рядок, з якого DropOwnCalls прибрав службовий виклик, отримує інший відбиток або зникає — і межа переїжджає. Так межа, поставлена після результату перегляду, зробленого перед відкриттям етапу, переїжджає за останній рядок перед тим переглядом, а не зникає. Збіг відбитків шукається вперед від попереднього збігу: зсув можливий лише через дубль відбитка після зниклого рядка, і тоді межа стає раніше, ніж могла б, а не пізніше. `produced` рахується вже на кінцевому списку, тож індекс і відбиток створеного рядка враховують DropOwnCalls (зокрема прибраний службовий результат з того самого рядка) і нормалізацію засіву; створений рядок, якого в кінцевому списку немає, запису не має, і діє правило прибраного рядка. Кілька правок, що замінили рядок межі (паралельні виклики, чиї результати в одному рядку: кожен `summarize` створює свій рядок результату), — межа на найпізнішому створеному рядку, щоб увесь стиснутий хвіст лишився в блоці. Без жодного попереднього рядка, що лишився, межа стає `null` (голова).

Нотатки ([SP_CTX_01_21](./context_editor.structures.sp.md#SP_CTX_01_21)). Кожну нотатку RebindTags переносить окремо, тим самим `produced` і Survivors, що й межі етапів, але з іншим правилом для прибраного рядка:

    FUNCTION RelocateNote(n, before, after, applied, produced) → Note | dropped:
        map = Survivors(before, after, changed = rows touched by applied edits)      # засів: рядки з CarryNote лишаються тими самими рядками — відбиток не змінюється
        Spot(x) = the produced entry with the largest index of the applied edits that replace x, if any → its row;
                  ELSE x ∈ map → after[map[x]];
                  ELSE x not touched by an applied edit AND before[x] has calls AND some row of after holds the first of them → that row   # MergeCallRows злив рядки викликів однієї відповіді (SP_CTX_02_04): відбиток злитого рядка не збігається з жодним оригіналом (рев'ю 37, W1)
                  ELSE removed
        { tool_use_id }: rows of the pair in before (none → dropped); r = Spot(result row) → a row target { anchor: fingerprint(r), hint } when the pair was replaced,
                         the same { tool_use_id } when the pair is untouched and still in after, dropped when removed
        { anchor, hint }: x = Locate(before); lost → dropped; r = Spot(x); removed → dropped; ELSE target = r
        range: s = Spot(start), e = Spot(end); a removed end moves inward to the nearest row of the range that Spot maps (start forward, end backward);
               none → dropped; s = e → a row target; ELSE a range target with both new hints
        dropped → report.notesDropped += n.id

Прибрана без заміни ціль (`drop`, рядок, що DropOwnCalls чи KeepResponsesWhole спорожнив, ціль поза новим списком) видаляє нотатку, і звіт застосування називає її ідентифікатор ([SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05)): текст нотатки агент писав про рядок, якого вже немає, тож переносити його на сусідній рядок — дезорієнтувати. Заміна правкою (стиснення пари, згортання, переписування, опис медіа) переносить нотатку на останній створений рядок: стиснутий рядок — та сама річ у новому вигляді. Зміна засівом (CarryNote дописує текст результату, а відбиток рядка той самий) нотатку не рухає. `remindAt` переноситься без змін. Збій запису реєстру не скасовує застосування, а `notesDropped` тоді порожній.

Вбудована компактизація хоста (`/compact host` людини, автоматична) RebindTags не викликає. Межа етапу, чий рядок уже не в поточній розмові, при використанні — `lost` ([SP_CTX_01_18](./context_editor.structures.sp.md#SP_CTX_01_18)): відкритий етап діє від голови, кінець закритого блоку невідомий («its end row is gone», не порожній блок), перегляд і телеметрія про це кажуть, а context_tag і DetectOptimize записують `null` лише на місце загубленого `after`. З фази 30 ([SP_CTX_DEC_31](./context_editor.sp.md#SP_CTX_DEC_31)) теги зниклих рядків, крім `state`, прибирає сам спостерігач такої компактизації (PruneDeadTags, [SP_CTX_02_18](#SP_CTX_02_18)), а не наступне застосування мода: до фази 30 вони лишались у реєстрі до застосування, а в сесії без застосувань накопичувались до MAX_TAGS, після чого AutoTag і R4 мовчки ставали (аудит PL_AUD_CTX, CF-34). Тег `state` і нотатки зниклих рядків, як і раніше, видаляє наступне застосування мода ([C_CTX_03_03](./context_editor.core.concept.md#C_CTX_03_03), «Вбудована компактизація хоста»): слот стану телеметрія до того показує як `its row is no longer in the conversation`, а прибрану нотатку звіт застосування називає (`notesDropped`).

### 02_15. PrepareStorage  {#SP_CTX_02_15}

Purpose: створити сховище, доступне лише власникові, для поточної сесії.

Processing logic (pseudocode):
    FUNCTION EnsureStorage():                                  # перед кожною операцією
        id = current session_id
        IF published session_id = id AND no PrepareStorage(id) runs: RETURN published storage
        RETURN PrepareStorage(id)

    FUNCTION PrepareStorage(id):                               # on session start (з поточним id), і з EnsureStorage
        IF PrepareStorage(id) already runs: IF the caller is a compaction handler: hurry it; RETURN its result      # одна підготовка на id; AfterPrepare — один раз; підігнана підготовка бере hostId лише якщо його вже прочитано (SP_CTX_01_14)
        prev = published session_id
        IF HOME absent: state = unavailable "HOME is not set"
        ELSE IF HOME is not absolute: state = unavailable "HOME is not an absolute path (…)"
        ELSE IF id does not match SESSION_ID: state = unavailable "the session id cannot name a folder (…)"   # SP_CTX_01_12
        ELSE:
            RestoreSession(id) (SP_CTX_02_52); IF it fails: state = unavailable "packed storage cannot be restored"   # фаза 36: запакована сесія розпаковується до першого звернення
            run one host command: create <storage> with parents, permissions owner-only (700) on <HOME>/.claude/context-editor and on <storage>
            IF it fails or exits non-zero: state = unavailable "cannot make <base> owner-only: <stderr | exit N>"
            ELSE: state = ready <storage>; AfterPrepare(prev, id)    # SP_CTX_02_18: зняти `host` з межі після перемикання
        IF state unavailable: status line warning
        IF current session_id = id:                              # сесію не покинуто під час підготовки
            publish (session_id = id, state) in one step; own boundary and listedKey of the previous session go
        RETURN (id, state)                                       # викликачі цієї підготовки працюють у її каталозі

    Each operation calls EnsureStorage once, keeps the folder it got and passes it to every read and write it makes (`<storage>` of SP_CTX_01_07); a step that needs the storage and has none refuses with "storage unavailable: <reason>".

Ідентичність процесу хоста (`hostId`, [SP_CTX_01_14](./context_editor.structures.sp.md#SP_CTX_01_14)) від сховища не залежить: модуль запускає її читання в `session.start` або першому PrepareStorage — що раніше — і тримає прочитане значення весь свій час життя (читання без ідентичності повторює наступний читач, до HOST_ID_READS разів; [SP_CTX_DEC_24](./context_editor.sp.md#SP_CTX_DEC_24)), і зміна сесії в тому самому процесі її не змінює. Підготовка сховища після перемикання сесії в тому самому процесі знімає з межі нової сесії `host` цього процесу ([SP_CTX_02_18](#SP_CTX_02_18)). Опубліковане сховище не скидається на час підготовки: поки вона йде, діє попередня пара, а виклики з новим id чекають її результату ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)). Підготовка для сесії, яку покинули, поки вона йшла, нічого не публікує: її викликачі закінчують роботу в її каталозі. Періодичного запису немає: зміну сесії (`/clear`, `/resume`, зокрема ті, що запускає RunHandoff) мод помічає перед наступною операцією. Медіа-файли пишуться командою хоста, що декодує base64 з потоку вводу у файл; файли лежать у каталозі сховища, доступному лише власникові.

### 02_16. MarkCall  {#SP_CTX_02_16}

> **Курування:** правило R6 (`superseded`) — [SP_CTX_02_65](./context_editor.curation.sp.md#SP_CTX_02_65).

Purpose: загальний хук завершених викликів інструментів основної розмови: дати агенту псевдонім виклику, який варто редагувати, і після нього окремим рядком пропозицію каналу розміру м'якого нагадування ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37); до фази 23 — на місці рядка псевдоніма), доставити належні нагадування нотаток ([SP_CTX_02_33](./context_editor.stages.sp.md#SP_CTX_02_33); після інструментів мода їх додають самі інструменти), позначити застарілі читання (R4, [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11)) і записати повторне читання вже стиснутого вмісту в журнал ефекту ([SP_CTX_02_31](./context_editor.stages.sp.md#SP_CTX_02_31)).

Processing logic (pseudocode):
    ON tool call finished (main loop, not denied, tool not OWN_TOOLS, tool_use_id present):
        alias = none
        IF WorthEditing(tool, len(result text), isError) AND storage ready AND AliasRegistry readable:   # WorthEditing = size ≥ BIG_ROW OR (tool IN SEARCH_TOOLS AND NOT isError) — та сама політика, що R2/R3 (SP_CTX_01_11; фаза 31, CF-52); дім — `hooks/rows.ts`
            n = next; alias = ALIAS_PREFIX + n; next += 1; map[alias] = tool_use_id   # поля last з фази 21 немає: last розв'язується за рядками (SP_CTX_02_17)
            remove map[ALIAS_PREFIX + (n − MAX_ALIASES)]                    # фаза 11 аудиту: витіснення за O(1), вікно останніх MAX_ALIASES номерів (01_13)
            IF len(map) > MAX_ALIASES: remove every alias numbered ≤ n − MAX_ALIASES   # файл з-до фази 11, що тримає старіші номери
            write AliasRegistry; IF written: alias = the new alias          # MarkAlias; псевдонім без запису не розв'язався б
        marked = WorthEditing(tool, len(result text), isError)          # помилка пошуку — без позначки і без пропозиції м'якого нагадування (фаза 31)
        line = alias ? "[context-editor] id <alias>: use it as \"ref\" in context_tag / context_edit" : none   # рядок псевдоніма — як до фази 22 (P19)
        hint = marked AND storage ready ? Bounded(SoftHint(), HINT_WAIT) : none   # SP_CTX_02_37, канал розміру; фаза 23: окремий рядок SUGGESTION, і без псевдоніма
        IF result is not an error AND storage ready:                     # у фоні: результат не чекає ні R4, ні журналу
            IF tool IN WRITE_TOOLS: on the registry chain: R4(path = input.file_path or input.notebook_path, tool_use_id); on the journal chain: JournalChanged(path)   # SP_CTX_02_31
            IF tool = Read: on the journal chain: JournalReread(input.file_path, tool_use_id)   # SP_CTX_02_31
        reminders = storage ready ? NoteReminders() : []                 # SP_CTX_02_33: належні нагадування нотаток, після рядка псевдоніма; відомий реєстр без жодного remindAt — без ланцюжка й читання (ворота в пам'яті)
        lines = CallLines(marked, alias, hint) + reminders            # SP_CTX_02_37: рядок псевдоніма, далі пропозиція; без позначки — жодного (рев'ю 54: чиста функція)
        RETURN lines ? result + additional context lines : result unchanged

    FUNCTION R4(path, writeId):
        reg = TagRegistry; IF unreadable: RETURN
        rows = CurrentRows()
        w = index of the row of rows whose toolUses hold writeId; none → len(rows)   # рядок самого виклику запису
        FOR each pair of rows whose call is Read with input.file_path = path AND whose call row index < w:
            IF the pair has no tag OR its tag is review with reason ≠ stale   # уже stale — без змін: повторний запис реєстру не переписує: put { review, reason stale, target { tool_use_id }, created_turn = reg.turn } (TAGS_FULL limits as AutoTag)
        write TagRegistry if changed

Позначка, пропозиція м'якого нагадування ([SP_CTX_02_37](./context_editor.stages.sp.md#SP_CTX_02_37)) і належні нагадування нотаток, які агент сам замовив, — єдине, що хук додає до результату: нагадувань, що вимагають чищення, немає ([SP_CTX_02_09](./context_editor.edits.sp.md#SP_CTX_02_09)), а після звичайного виклику без позначки й без належного нагадування нотатки результат повертається незмінним (пропозиція буває лише після позначеного виводу). Запис файлу після фази 23 рядка пропозиції не дає: межу етапу замінив канал ходу ([SP_CTX_02_08](./context_editor.edits.sp.md#SP_CTX_02_08)). Збій будь-якого кроку не змінює результату інструменту і не зупиняє інших кроків. «Довжина тексту результату» — текст результату так, як його читає модель (поле `text` результату від хоста); у відповіді іншого хука без `text` — довжина серіалізованого `result`; «помилка» — `isError` результату. Хук чекає запису реєстру псевдонімів перед поверненням результату, тож псевдонім, який бачить агент, уже розв'язується; R4 і журнал ідуть у фоні після повернення, тож виклик запису файлу не чекає читання розмови. Усі кроки — в одному хуку без матчера: одну подію модуль може зареєструвати без матчера лише раз (навичка plugin-hooks, Key Concepts). Зміни файлів командами оболонки (`Bash`, зокрема `git checkout`) R4 не помічає ([SP_CTX_DEC_13](./context_editor.sp.md#SP_CTX_DEC_13)): агент може сам поставити `review` раннім читанням.

### 02_17. ResolveRef  {#SP_CTX_02_17}

Purpose: перетворити `ref` на `tool_use_id`.

Logic: `c<число>` → `map[ref]` AliasRegistry; `last` → ResolveLast(rows, callId) за поточною розмовою (фаза 21, [SP_CTX_DEC_20](./context_editor.sp.md#SP_CTX_DEC_20)); номер, який реєстр уже видавав (`< next`), а запису немає, — ALIAS_GONE (фаза 31, CF-53); інакше — `unknown ref <ref>`. Розв'язання відбувається при постановці правки, тегу чи нотатки; у черзі й реєстрі тегів зберігається `tool_use_id`. Виклик, що вийшов за вікно ROW_WINDOW рядків, розв'язується, але правка відхиляється перевірками [SP_CTX_02_03](./context_editor.edits.sp.md#SP_CTX_02_03). Субагент `ref` не розв'язує (як досі).

    FUNCTION ResolveRef(ref, rows, callId) → (tool_use_id, line?) | reason:
        IF ref = "last": RETURN ResolveLast(rows, callId)
        IF ref matches c<число> AND AliasRegistry readable AND map has ref: RETURN (map[ref], none)
        IF ref matches c<n> AND AliasRegistry readable AND n < next: RETURN ALIAS_GONE(ref)   # фаза 31, CF-53: псевдонім прибрало застосування (PruneAliases, SP_CTX_02_14), чужа компактизація чи вікно MAX_ALIASES
        RETURN "unknown ref <ref> (" + REF_HINT + ")"

    FUNCTION ResolveLast(rows, callId):                                 # rows = CurrentRows() (SP_CTX_02_18)
        carrier = index of the row whose toolUses hold callId; none → len(rows)   # як у context_tag (SP_CTX_02_11); хост уже має цей рядок посеред ходу (навичка plugin-hooks, пункт 52)
        u = the latest ToolUse in rows[0 .. carrier] (rows before carrier, then the carrier row's own calls written before callId) whose tool does not start with OWN_TOOLS
        IF none: RETURN LAST_NONE
        IF no row after u's row holds a ToolResult with u.tool_use_id:
            IF a prompt row (PromptRowStrict: a user row without toolResults, with a handle or text other than whitespace) stands between u's row and carrier: RETURN LAST_ORPHAN(CallLabel(u))   # хід виклику скінчився без результату (рев'ю 50)
            RETURN LAST_PENDING(CallLabel(u))                           # виклик тієї самої відповіді, ще без результату
        RETURN (u.tool_use_id, "\"last\" = " + CallLabel(u))

`last` — останній виклик агента в поточній розмові, написаний перед цим викликом `context_*`, позначений чи ні: розмір виводу й псевдонім значення не мають. Порядок — порядок рядків викликів, тобто порядок, у якому агент їх написав (паралельні виклики однієї відповіді хост пише рядком на кожен, пункт 40 навички plugin-hooks): для паралельних викликів `last` — написаний останнім, а не той, що завершився останнім; агент бачить свою відповідь так само і може це передбачити. Виклики інструментів мода (OWN_TOOLS) не рахуються: «позначив нотаткою, потім стиснув» з `ref: "last"` в обох викликах влучає в ту саму пару. Виклик тієї самої відповіді, що ще не має результату (паралельний з цим `context_*` або чекає черги), не підміняється старішим: LAST_PENDING; той, що вже має результат (хост виконав його раніше), — ціль. Осиротілий виклик — без результату, а між ним і цим викликом стоїть рядок промпту (процес убито посеред інструмента, далі `--resume`; хост лагодить пару лише в API-поданні, пункт 40 навички plugin-hooks) — результату вже не отримає: LAST_ORPHAN називає його і просить назвати ціль явно, а не чекати (рев'ю 50). Без `message.id` «інша відповідь того самого ходу» від «тієї самої відповіді» не відрізняється, тож межа — лише рядок промпту. Виклики після рядка `callId` (написані в тій самій відповіді пізніше) не розглядаються. Відмова чи помилка інструмента (`isError`) — теж завершений виклик. Пара, вже змінена застосуванням (FreshId), лишається викликом розмови: `last` її називає, а рядок `"last" = …` показує, що вона вже замінена. Розмова — та, яку бачить модель ([SP_CTX_02_18](#SP_CTX_02_18)): після `--resume` — завантажений ланцюжок, після передачі — засіяні рядки; реєстр псевдонімів і процес, що його писав, значення не мають, тож `last` не перетинає ні процесів, ні сесій. Рядок `"last" = <CallLabel>` додається до результату `context_edit`, `context_tag` і `context_note` один раз на виклик (усі `last` одного виклику — та сама пара).

### 02_18. CurrentRows  {#SP_CTX_02_18}

> **Курування:** спостерігач прибирає `hostrows.json` і відкриває вікно копій — [SP_CTX_02_60](./context_editor.curation.sp.md#SP_CTX_02_60); рядків хоста серед рядків знімка немає — [SP_CTX_02_61](./context_editor.curation.sp.md#SP_CTX_02_61).

> **Criticality:** core

Purpose: відрізати від транскрипту рядки, що лишились до останньої компактизації основної розмови.

Читання розмови хоста повертає весь транскрипт: після кожної компактизації в ньому стоять рядки до межі, за ними — рядки, які повернула компактизація, далі нові. Вхід компактизації `e.messages` — лише хвіст після останньої межі. Позначки межі в рядках немає ([SP_CTX_DEC_07](./context_editor.sp.md#SP_CTX_DEC_07)).

Processing logic (pseudocode):
    FUNCTION RecordBoundary(rows):                 # rows — розмова, яку повернула компактизація основної розмови
        IF rows empty: RETURN
        text = Boundary { head: [fingerprint(r) FOR r IN rows[0 .. min(len(rows), HEAD_ROWS))], count: len(rows),
                          host: hostId (absent when hostId is absent or pending) }
        write text; IF written: ownBoundary = text  # пам'ять екземпляра; збій запису не зупиняє компактизацію: межа лишається попередньою

    ON storage prepared (SP_CTX_02_15):
        listedKey = none; ownBoundary = none          # коли підготовка публікує пару (id, стан)
        start a hostId read if none is in flight and none has given the identity
        IF this instance already had another session_id (a switch in the same process — /clear, /resume; not the first prepare after load):
            id = await hostId (outside a compaction handler, at most HOST_ID_WAIT_MS from the read's start; inside one, the value if read, else absent)
            b = read Boundary of the new session
            IF b.host is a string AND id present AND b.host = id: write b without host   # /resume у тому самому процесі: читання — завантажений ланцюжок
                IF the write fails: remove the Boundary file of the new session; IF that fails too: toast "context-editor: the boundary of the resumed session could not be untrusted: <error>"   # без межі — увесь транскрипт, що після /resume і правильно

    Trusted(b) = (b.host is a string AND hostId present AND b.host = hostId)   # той самий процес хоста (SP_CTX_DEC_10); hostId — після очікування читання
                 OR (raw text of b = ownBoundary)                              # межу записав цей екземпляр у цій сесії — зокрема коли hostId відсутній

    ON compaction (any trigger):                   # гілка `pass` обробника; ObserveCompaction (`observeCompaction` у hooks/compaction.ts) за портом ObserveIO
        result = next(e)
        IF agentId present                          # компактизація субагента — не основна розмова
           OR trigger = precompute                  # нічого не встановлює; стоїть лише при використанні через manual/auto
           OR MarkerKind(instructions) present   # MARKER, HANDOFF_MARKER і їхні тексти до фази 25; власну межу пишуть HandleCompaction і HandleSeed, за будь-якого trigger
           OR result is skip: RETURN result
        RecordBoundary(result.messages)
        on the registry chain, one change: PruneDeadTags(reg, e.messages, result.messages); remove lastApply; IF introduced: reintroduce = true (фаза 33, SP_CTX_DEC_36: підсумок прибрав посібник); no write when nothing changed   # SP_CTX_01_10: інша компактизація — не застосування мода; фаза 30 (SP_CTX_DEC_31, CF-34)
        ClearAttachments (SP_CTX_02_41); RETURN result   # фаза 24: рішення про вкладення хоста йдуть разом із розмовою

    PruneDeadTags(reg, before, after) = reg with tags kept only when kind = state OR ResolveTarget(before, …) does not find it OR ResolveTarget(after, tag.target, RowIndex(after)) finds it   # рев'ю фази 30: тег іде лише тоді, коли його ціль була у вході компактизації (before = e.messages) і зникла з її рядків (after = result.messages) — тег рядка, дописаного після початку компактизації посеред ходу, лишається; без вхідних рядків нічого не прибирається; `{ tool_use_id }` — пара в rows; рядок — Locate; діапазон — обидва кінці; межі етапів, нотатки, `firstPromptPinned` і решта полів — без змін; той самий реєстр, коли нічого не прибрано

    FUNCTION CurrentRows():
        await hostId (at most HOST_ID_WAIT_MS from the read's start)   # шлях інструментів і промптів: очікування дозволене; тайм-аут не запам'ятовується (SP_CTX_DEC_24)
        transcript = read main conversation rows (the whole transcript, ≤ ROW_WINDOW newest)
        b = read Boundary; IF absent or unreadable: RETURN transcript
        IF NOT Trusted(b): RETURN transcript       # інший процес або /resume у цьому: читання — завантажений ланцюжок, який і бачить модель
        p = the largest index such that fingerprint(transcript[p + k]) = b.head[k] for every k < len(b.head)
            AND len(transcript) - p ≥ b.count
        IF none: RETURN transcript                  # межа поза вікном ROW_WINDOW або відбитки не збіглися
        RETURN transcript[p ..]

    FUNCTION BoundaryAt(transcript, head, count):  # спільний пошук для CurrentRows і CheckSeeded (SP_CTX_02_24)
        RETURN the largest p as above, or none

    FUNCTION Key(): await hostId (as in CurrentRows); b = read Boundary (one read); session_id + (b present AND Trusted(b) ? raw text of b : "")
    Snapshot (per event or tool call): CurrentRows with Key() and the API form, each read at most once, on first use; a failed read is not kept   # фаза 11 аудиту (CF-21)
    context_list with count ≥ 1: listedKey = Key(), once the listing is built (a failed listing or count 0 renews nothing)
    BlockReport of a tool close (SP_CTX_02_29): listedKey = Key() read before the rows it lists   # промпт ходу оптимізації і порада з промптом людини індексів не мають і ключа не оновлюють
    context_edit, context_tag, context_note: index targets are refused (SP_CTX_02_03, SP_CTX_02_11, SP_CTX_02_32) when listedKey ≠ Key(); the refusal text (STALE_INDEXES, SP_CTX_02_03) asks for a page of rows (count > 0); count 0 and full renew nothing

Знімок (аудит PL_AUD_CTX, фаза 11, CF-21). Одна подія чи виклик інструмента читає CurrentRows, Key() і API-подання не більше ніж по разу, коли вони вперше знадобились, і передає їх донизу всім своїм крокам: `context_tag` (перевірка застарілих індексів, запити, заміни з тегів і звіти закриття — закриття етапу читає розмову один раз, а не шість), `context_note`, `context_list` (сторінка, медіа й рядок `Cache` телеметрії — одне читання API-подання), `context_edit`, м'яке нагадування після виклику й з промптом людини, DetectOptimize і заміни з тегів наприкінці ходу. Під час виклику інструмента розмова не змінюється, крім рядків паралельних викликів, які пишуться після нього; компактизація йде лише між ходами. Повторне читання лишається там, де розмову опитують, доки рядки не з'являться (AwaitSeeded, [SP_CTX_02_24](./context_editor.handoff.sp.md#SP_CTX_02_24)), і в обробнику компактизації. Розв'язання цілей тегів і нотаток на одному списку рядків іде за індексом рядків (відбиток → рядки, `tool_use_id` → рядок виклику і рядок результату), побудованим раз на прохід: Locate і пошук пари дають те саме, що й перегляд рядків ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04); CF-23).

Без межі, без довіри або без збігу результат — увесь транскрипт: так само, як до запису межі. Після гарячого перезавантаження з першим читанням `hostId`, повільнішим за HOST_ID_WAIT_MS, CurrentRows до кінця читання — увесь транскрипт (межа з `host` ще не довірена), а коли ідентичність прочитано — від межі; `Key()` тоді змінюється один раз, і ціль за індексом з переліку до того отримує одну відмову STALE_INDEXES ([SP_CTX_DEC_24](./context_editor.sp.md#SP_CTX_DEC_24)). Довіра — збіг `host` межі з ідентичністю процесу хоста цього екземпляра або межа, яку записав сам цей екземпляр ([SP_CTX_DEC_10](./context_editor.sp.md#SP_CTX_DEC_10)). У тому самому процесі, поки сесію в ньому не перемикали (зокрема після гарячого перезавантаження модуля), читання — це оригінали плюс копії, і межа збігається в правильному місці. В іншому процесі (перезапуск, `--resume`) і після `/resume` у тому самому процесі читання — завантажений ланцюжок, тобто саме те, що бачить модель, і весь транскрипт правильний (спайк context_editor_handoff_long, Entry 6; навичка plugin-hooks, пункт 7); тому при перемиканні сесії в процесі мод знімає `host` з межі нової сесії, якщо ту межу записав цей процес. Запасний шлях без `hostId` (власна межа екземпляра) нічого не втрачає порівняно з колишнім прапорцем у пам'яті. Межа засіяної сесії, яку пише HandleSeed, несе `host` і стає власною межею екземпляра: засів іде в тому самому процесі, а підготовка сховища нової сесії передує засіву. Власна компактизація мода — команда з `trigger: 'manual'`, як і `/compact` людини; їх розрізняє лише `instructions`, тож спостерігач пропускає саме MARKER і HANDOFF_MARKER, а `/compact` людини з будь-яким іншим текстом (або без нього) записує межу з рядків, які повернула вбудована компактизація. У засіяній сесії межу записує HandleSeed ([SP_CTX_02_26](./context_editor.handoff.sp.md#SP_CTX_02_26)) уже в сховище нової сесії: перед засіяними рядками в транскрипті стоять лише рядки команди очищення, і CurrentRows їх відрізає. Межа міняється між переліком і правкою, коли компактизація (мода, `/compact` або автоматична, зокрема посеред ходу) пройшла після `context_list`: тоді індекси, які тримає агент, називають інші рядки, і правки та теги за індексом відхиляються до нового переліку; цілі за `tool_use_id` і `ref` від індексів не залежать. Ключ пам'ятає лише останній перелік: індекси зі сторінки, отриманої до компактизації, після нового переліку іншої сторінки проходять цю перевірку; такі правки ловить лише пошук якорів при застосуванні (Locate). Межа записується до того, як хост прийме повернений список: якщо зовнішній хук іншого плагіна відкине або перепише результат, голова може не знайтися, і CurrentRows поверне весь транскрипт. Індекси переліку, перевірка правок, теги, закріплення й лічильник активних `review` працюють на поточній розмові, тож індекс з переліку відповідає позиції рядка в `e.messages` наступної компактизації.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-13 | Фаза 36: PrepareStorage спершу розпаковує запаковану сесію (RestoreSession, [SP_CTX_02_52](./context_editor.cleanup.sp.md#SP_CTX_02_52)) |
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §02 Contracts 02_11–02_18 перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.tags.sp.md](./context_editor.tags.sp.md), якорі без змін |
| 2026-10-11 | PL_AUD_CTX фаза 1 (CF-1): PrepareStorage — одна підготовка на `session_id`, перевірка `HOME` і SESSION_ID перед побудовою шляху, публікація пари (id, стан) наприкінці і лише для поточної сесії; EnsureStorage дає операції каталог, який вона тримає до кінця (02_15, 02_18) |
| 2026-10-11 | PL_AUD_CTX фаза 2 (CF-2): RebindTags і очищення псевдонімів у компактизації — з реєстрів кроку фіксації, без запису після покинутої диспетчеризації, з поверненням реєстрів, коли запис черги не вдався (02_14) |
| 2026-10-11 | PL_AUD_CTX фаза 1, рев'ю: обробник компактизації, що приєднався до підготовки, підганяє її крок межі — без очікування `hostId` (02_15) |
| 2026-10-11 | PL_AUD_CTX фаза 3 (CF-3, CF-4): `context_tag` — `add` за індексом без `to` на рядку лише з thinking — TARGET_NOT_FOUND, кінець діапазону лише з thinking — BAD_RANGE (рядки таблиці 02_11); RebindTags — тег рядка виклику, злитого MergeCallRows, переходить на злитий рядок, `pin` перемагає (02_14); діапазон тегу — LocateSpan |
| 2026-10-11 | PL_AUD_CTX фаза 3, рев'ю: 02_11 — відмови лише для рядка асистента лише з thinking; 02_14 — діапазон тегу після застосування за тотожністю рядків, LocateSpan — запасний шлях, зниклий перший рядок — перший рядок, що лишився; `pin` на злитому рядку стереже й сусідні виклики |
| 2026-10-11 | PL_AUD_CTX фаза 9 (аудит коду, CF-17): 02_17 — рядок промпту ResolveLast названо PromptRowStrict (`hooks/rows.ts`): на відміну від PromptRow (edits 02_04), текст лише з пробілів без handle — не промпт; 01_11 R2/R3 і позначка псевдоніма (02_16) — одна політика «вихід вартий правки» (BIG_ROW або SEARCH_TOOLS). Без зміни поведінки |
| 2026-10-11 | PL_AUD_CTX фаза 10 (аудит коду, CF-19): 02_12 — тіло хука додавання рядка — AppendRow за портом AppendIO (`hooks/tags.ts`), з тестами порядку (крок якоря і тека до збереження рядка, правила й запис доставки після) і відмовленого рядка; 02_18 — спостерігач чужої компактизації — ObserveCompaction за портом ObserveIO (`hooks/compaction.ts`), з тестом «чужа компактизація прибирає `lastApply`». Без зміни поведінки |
| 2026-10-11 | PL_AUD_CTX фаза 11 (аудит коду, CF-21…CF-23): 02_18 — знімок розмови на подію чи виклик інструмента (CurrentRows, Key() і API-подання не більше ніж по разу; закриття етапу через `context_tag` читає розмову один раз), індекс рядків для цілей тегів і нотаток; 02_12 — AutoTagNeeded: рядок, який жодне правило не змінить (малий результат не пошукового інструмента), не йде на ланцюжок реєстру і не читає його; 02_16 — витіснення псевдоніма за O(1) (вікно останніх MAX_ALIASES номерів), ворота нагадувань у пам'яті |
| 2026-10-11 | PL_AUD_CTX фаза 12 (аудит коду, CF-24, CF-25): 02_11 — тексти відмов рівня виклику, DENIED_EMPTY і для списку, довшого за MAX_TAGS; 02_15, 02_18 — очікування `hostId` не довше HOST_ID_WAIT_MS від початку читання, тайм-аут не запам'ятовується ([SP_CTX_DEC_24](./context_editor.sp.md#SP_CTX_DEC_24)) |
| 2026-10-11 | PL_AUD_CTX фаза 12, рев'ю: 02_18 — після гарячого перезавантаження з першим читанням `hostId`, повільнішим за HOST_ID_WAIT_MS, CurrentRows — увесь транскрипт до кінця читання, потім `Key()` змінюється один раз (одна відмова STALE_INDEXES) |
| 2026-10-12 | Фаза 24: 02_18 — спостерігач компактизації, що стоїть, запускає ClearAttachments ([SP_CTX_02_41](./context_editor.hostattach.sp.md#SP_CTX_02_41)) |
| 2026-10-12 | Фаза 25: 02_18 — спостерігач не пише межі для MarkerKind (нові мітки і тексти до фази 25, [SP_CTX_DEC_26](./context_editor.sp.md#SP_CTX_DEC_26)) |
| 2026-10-12 | Фаза 28: 02_16 R5 (а) — уже стиснута пара за ReplacementText (тексти замін фази 28 без MARK і старі з MARK; [SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17), A″) |
| 2026-10-12 | Фаза 28, рев'ю: 02_13 — правки з тегів несуть `via: 'tag'`, їхній текст називає `context_tag` ([SP_CTX_02_04](./context_editor.edits.sp.md#SP_CTX_02_04)) |
| 2026-10-12 | Дизайн фаз 29–31: 02_11 — TAGS_FULL: у реєстрі лише теги цілей поточної розмови, повний реєстр — рядок телеметрії; 02_12 — R3 і AutoTagNeeded без результатів-помилок (фаза 31, CF-52); 02_14 — теги зниклих рядків після чужої компактизації прибирає спостерігач, `state` і нотатки — наступне застосування ([SP_CTX_DEC_31](./context_editor.sp.md#SP_CTX_DEC_31), фаза 30, CF-34); 02_16 — WorthEditing з `isError`; 02_17 — ALIAS_GONE для прибраного псевдоніма (фаза 31, CF-53); 02_18 — PruneDeadTags у спостерігачі однією зміною з `lastApply` |
| 2026-10-12 | Фази 30–31 реалізовано: 02_18 — `pruneDeadTags` (RowIndex один раз) і одна зміна реєстру в `observeCompaction` разом зі зняттям `lastApply` ([SP_CTX_DEC_31](./context_editor.sp.md#SP_CTX_DEC_31) B); 02_12 — AppendFacts несе `isError` результату, R3 і AutoTagNeeded пропускають результат-помилку пошуку; 02_16 — `worthEditing(tool, size, isError)`, `callFacts` бере `done.isError` (зв'язування `register.ts` не змінилось: позначка пропозиції м'якого нагадування вже йде через `wantsMark`); 02_17 — `aliasGone` (ALIAS_GONE) у `refResolver` |
| 2026-10-12 | Рев'ю фази 30: 02_18 — PruneDeadTags(reg, before, after) прибирає тег лише тоді, коли його ціль була у вході компактизації (`e.messages`) і зникла з результату; тег рядка, дописаного після початку компактизації, лишається. Живий прогін фаз 30–31 — pass в обох хостах |
| 2026-10-14 | Перехід між етапами ([SP_CTX_DEC_37](./context_editor.sp.md#SP_CTX_DEC_37)): 02_11 — перший `open`/`close` при `waiting` звітує про блок, що чекав (BlockReport з `waiting`), знімає очікування і ставить заміни з тегів; 02_13 — заміни ставить кінець очікування, а не мітка |
