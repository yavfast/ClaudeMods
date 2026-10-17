# Редактор контексту агента — Specification: Verification: functional expectations — теги, псевдоніми, поточна розмова

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-15
> **Updated:** 2026-10-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> Частина §05_01 Functional Expectations специфікації [SP_CTX](./context_editor.sp.md): модульні очікування (теги, псевдоніми, поточна розмова). Читати, коли пишете або звіряєте модульні тести цих контрактів.

## Contents

- Частина таблиці [05_01. Functional Expectations](./context_editor.expectations.sp.md#SP_CTX_05_01): рядки контрактів цього модуля

## 05. Verification Criteria — модульні очікування: теги, псевдоніми, поточна розмова

Частина таблиці [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01): контракти [tags](./context_editor.tags.sp.md): `context_tag`, AutoTag, QueueTagReplacements, RebindTags, PrepareStorage, MarkCall, ResolveRef, CurrentRows, ідентичність хоста. Правила назв тестів і позначок `[тест: …]`, `[live only: …]`, `[not covered: …]` — у [context_editor.expectations.sp.md](./context_editor.expectations.sp.md#SP_CTX_05_01).

| Contract | Scenario | Input | Expected outcome |
|----------|----------|-------|------------------|
| CurrentRows | межа засіяної сесії | рядки `/clear`, засіяні рядки, рядки команди; Boundary від HandleSeed | від першого засіяного рядка |
| CurrentRows | без межі | транскрипт 9 рядків, Boundary відсутній | усі 9 рядків [тест: «without a boundary the whole transcript is current»] |
| CurrentRows | після компактизації | старі 9 рядків, повернені 7, нові 3; Boundary з голови повернених | 10 рядків, починаючи з першого поверненого [тест: «after a compaction the rows before its head are cut»] |
| CurrentRows | дві компактизації | транскрипт з трьох сегментів, голови однакові | від останнього входження голови [тест: «two compactions with the same head»] |
| CurrentRows | гаряче перезавантаження | Boundary з `host` = `hostId`; модуль перезавантажено в тому самому процесі (токен HOST_ENV і ppid ті самі) | межа довірена; рядки від неї |
| CurrentRows | інший процес | Boundary з `host` іншого процесу (перезапуск, `--resume`) | увесь транскрипт |
| CurrentRows | межа без `host` | Boundary без поля `host` (зокрема записана версією до цього правила) / з `host` не рядком; записана не цим екземпляром | увесь транскрипт (межа читається, `host` ігнорується) |
| CurrentRows | власна межа без `host` | `hostId` відсутній; цей екземпляр записав Boundary у цій сесії (`ownBoundary` = текст файлу) | межа довірена; після перезавантаження модуля або зміни сесії — увесь транскрипт |
| CurrentRows | `/resume` у тому самому процесі | процес записав Boundary сесії A з `host` = `hostId`; `/clear`, потім `/resume` A в тому самому процесі | підготовка сховища A знімає `host` з її межі; CurrentRows — увесь транскрипт |
| CurrentRows | перша підготовка після завантаження | модуль щойно завантажено (зокрема гаряче перезавантаження), Boundary поточної сесії з `host` = `hostId` | `host` не знімається; межа довірена. Залишкове вікно: гаряче перезавантаження між `/resume` у тому самому процесі і наступним PrepareStorage старого екземпляра лишає `host` — новий екземпляр довіряє межі над завантаженим ланцюжком; так само, коли перше після перемикання PrepareStorage припало на обробник компактизації, а читання `hostId` ще не закінчилося |
| CurrentRows | ідентичність не прочиталась | `sh -c 'echo $PPID'` не вдалася або вивід не десяткове число, або `$.env.set` не вдався | `hostId` відсутній; RecordBoundary пише Boundary без `host`; довіра лише до власної межі екземпляра |
| ParseHostId | розбір | (`k3x9…`, `"12345\n"`) / (`k3x9…`, `"abc"`) / (`""`, `"12345"`) / (`k3x9…`, `""`) | `k3x9…:12345` / відсутній / відсутній / відсутній |
| hostId | ще не прочитано | обробник компактизації (лише HandleCompaction, HandleSeed, спостерігач) пише межу, поки читання `hostId` не закінчилося | не чекає і процесу не запускає; Boundary без `host`; межа — власна межа екземпляра |
| hostId | тайм-аут не запам'ятовується (PL_AUD_CTX фаза 12, CF-24) | перший читач чекає HOST_ID_WAIT_MS, читання ще йде; потім читання дає ідентичність | перший читач — `hostId` відсутній; читач після тайм-ауту, поки читання йде, не чекає; після кінця читання наступний читач і `peek` — ідентичність; одне читання ([SP_CTX_DEC_24](./context_editor.decisions-21.sp.md#SP_CTX_DEC_24)) |
| hostId | повтор після збою (PL_AUD_CTX фаза 12, CF-24) | читання без ідентичності (збій `$.env`, вивід не число) | наступний читач запускає нове читання, не більше HOST_ID_READS на екземпляр; читання з ідентичністю запам'ятовується |
| hostId | обробник компактизації (PL_AUD_CTX фаза 12, рев'ю) | PrepareStorage обробника компактизації: читань ще не було / перше читання скінчилося без ідентичності; таймер, що кидає одразу | перше читання запущено без очікування / повтору не запущено (його запустить наступний читач поза компактизацією); виняток таймера закінчує очікування, а не викликача |
| CurrentRows | перший перелік після перезавантаження | читання `hostId` ще йде; Boundary з `host` = `hostId` | чекає читання (не довше HOST_ID_WAIT_MS); межа довірена; `Key()` не змінюється після його кінця. Читання, повільніше за HOST_ID_WAIT_MS: до його кінця рядки — увесь транскрипт, потім межа довірена і `Key()` змінюється один раз (одна відмова STALE_INDEXES для цілей за індексом) [live only: повільне читання — живий прогін фази 12 аудиту] |
| CurrentRows | межа поза вікном | голови в транскрипті немає | увесь транскрипт [тест: «a head that is not in the transcript keeps the whole transcript»] |
| CurrentRows | замало рядків після збігу | збіг голови, але `len - p < count` | цей збіг не підходить [тест: «a match with fewer rows after it than the compaction returned does not count»] |
| RecordBoundary | запис | 12 повернених рядків | `head` — 8 відбитків, `count` 12 |
| RecordBoundary | `host` | `hostId` є / відсутній | Boundary з `host` = `hostId` / без `host`; в обох випадках `ownBoundary` = записаний текст |
| RecordBoundary | спостерігач | `manual`, `auto`, `plugin` з іншими інструкціями / MARKER або HANDOFF_MARKER з `manual` чи `plugin`, `precompute`, `agentId`, `skip`, порожній результат | межа / немає межі |
| RebindTags | нотатка на заміненому рядку | `n1` на парі `a`; застосовано summarize `a` | `n1` — ціль-рядок на рядку результату з FreshId (`produced`), текст і `remindAt` ті самі |
| RebindTags | нотатка на прибраному рядку | `n1` на парі `b`; застосовано `drop b` | `n1` видалено; звіт закінчується ` Notes dropped (their rows were removed): n1.` |
| RebindTags | діапазон нотатки | `n2` на #4..#8; `drop` пари в #8/#9 (кінець прибрано) / collapse 4..8 | кінець переходить на #7 (найближчий рядок діапазону, що лишився) / одна ціль-рядок на носії згортання |
| RebindTags | засів з CarryNote | `n1` на парі з медіа, засів дописав CarryNote | `n1` на тій самій парі в реєстрі нової сесії |
| RebindTags | нотатки на паралельних викликах | засів (або застосування) зливає незмінені рядки `tool_use a` і `tool_use b` однієї відповіді; `n1` на рядку `a`, `n2` на рядку `b`, `n3` діапазону, що закінчується на `b` | усі три лишаються, ціль — злитий рядок; `notesDropped` порожній |
| AutoTag | копія промпту | у stream-json рядок промпту, повернений компактизацією, знову додається з `door = prompt`, `origin { kind: plugin, name: context-editor }`, `firstPromptPinned = false` | R1 не спрацьовує; реєстр без змін |
| AutoTag | копія великого результату | копія рядка результату Read 5000 символів з `origin.kind = plugin` / та сама копія з `door = tool-result`, `origin { kind: tool, tool: Read }`, а її `tool_use_id` — у `Copied` (так копію бачить хук у stream-json, проба фази 15) / той самий рядок після початку ходу (`Copied` порожня) | R2 і R3 не спрацьовують; тег не дублюється / теж / новий рядок: `review` `big` |
| context_tag | помилки | кожен рядок таблиці Errors [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11) | відповідний код [тест: «context_tag rejects each bad request with its code»; «context_tag refuses the whole call for a subagent»; «context_tag — stage errors»] |
| context_tag | відкриття без index | рядки #0..#9; рядок асистента з викликом `open` (`callId`) — #8, #7 — результат | `stage.after` = RowMark #7; результат `opened; its block starts at #8` |
| context_tag | рядок виклику ще не записано | `callId` не знайдено в рядках #0..#9 | `stage.after` = RowMark #9 |
| context_tag | межа не на thinking | перед рядком виклику — рядок лише з thinking (#7), перед ним результат (#6) | `stage.after` = RowMark #6 |
| context_tag | відкриття з index | `open` з `index: 4` / `index: 0` | `after` = RowMark #3 / `null` |
| context_tag | закриття | етап з `after` #3, рядок виклику `close` — #12 | `lastClosed = { name, after #3, end #11, turn }`; `stage` знято; результат — звіт блоку #4..#11 з телеметрією і STAGE_ADVICE; QueueTagReplacements один раз |
| context_tag | open при відкритому етапі | етап A відкрито, `open` B | звіт закриття A в результаті; `lastClosed` — блок A; `stage` — B з тією самою межею, що й кінець A |
| context_tag | закриття без етапу | `close`, етапу немає | NO_STAGE; `open` з `index` + `close` в одному виклику — блок від `index` закрито |
| context_tag | порожній блок | `close` одразу після `open` | звіт `no rows in it.` без STAGE_ADVICE |
| context_tag | REPORT_FAILED | `close`, BlockReport кидає виняток | етап закрито, реєстр записано; результат `Stage "<name>" closed; its report failed: <error>; call context_list` |
| context_tag | слот стану | `add state` на #5 (текст агента), потім `add state` на #9 | один тег `state` на #9; результат `The state slot moved from #5 to #9.` |
| context_tag | слот стану не там | `add state` на рядок з викликом / на результат за `tool_use_id` / рядок лише з thinking | BAD_TARGET |
| context_tag | disposable на слоті стану | `state` на #1; `add disposable` за `index: 1` без `to` / за `index: 4` (інший текстовий рядок агента) | BAD_TARGET, тег `state` лишається / тег поставлено |
| context_tag | діапазон | `add disposable` з `index: 4`, `to: 7`, note — пари цілі / `to: 5` розриває пару / у діапазоні `pin` / `to` з `pin` | тег-діапазон / BAD_RANGE / BAD_RANGE / BAD_RANGE |
| context_tag | зняття діапазону | `remove` з `index: 4` | тег-діапазон, що починається на #4, знято |
| context_tag | агентський review | `add review` на пару | `reason = agent` |
| context_tag | застарілі індекси етапу | `open` з `index` після компактизації без нового переліку | INDEXES_STALE [тест: «context_tag — stage errors: STAGE_FIELDS, STAGE_NAME_REQUIRED, TARGET_NOT_FOUND, INDEXES_STALE»] |
| context_tag | загублена межа | `stage.after` і `lastClosed.end` не знаходяться; будь-який `add` | записаний реєстр має `stage.after = null`; `lastClosed.end` лишається тим самим RowMark (не `null`) |
| AutoTag | R5 однаковий результат | два Read по 5000 символів з однаковим текстом (різні виклики) | `review` з `reason = duplicate` на першій парі; друга без нового тегу (R2 — `big`) |
| AutoTag | R5 той самий діапазон | Read `f` з `offset 10, limit 50` двічі, тексти по 5000 символів різні (файл змінився) / `offset 10` і `offset 60` / той самий діапазон, тексти по 300 символів | перша пара — `duplicate` / тегу дубліката немає / тегу дубліката немає (менше BIG_ROW) |
| AutoTag | R5 паралельні виклики | рядок з результатами паралельних `Read` (5000) і `Grep` (5000), обидва тексти повторюють раніші | `duplicate` на обидві раніші пари; поле `Read` звіряється лише для результату `Read` |
| AutoTag | R5 перезапис | раніша пара має `review` `big` / `stale` / `pin` | стає `duplicate` / лишається `stale` / лишається `pin` |
| AutoTag | R5 стиснута раніша пара | раніша пара `Read` того самого діапазону вже стиснута (текст результату — ReplacementText: текст A′ з MARK і текст фази 28 без нього), новий результат 5000 символів | тегу дубліката немає |
| AutoTag | R5 рядок без результатів | два рядки `user` без результатів (двері `attachment`, текст 6000 символів однаковий), обидва в поточній розмові | `review` `duplicate` на раніший рядок за `anchor`; рядка в поточній розмові немає — тегу немає — R5 (б) у backlog (проба фази 15, [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11)): до повернення R5 (б) рядок дверей `attachment` чи `tool-message` правил не викликає, тегу немає |
| MarkCall | R4 застаріле читання | Read `f` (пара `a`, тег `review big`), Read `g` (пара `b`), Edit `f` без помилки | на `a` — `review` `stale`; `b` без змін; результат Edit без доданого тексту |
| MarkCall | R4 не чіпає інших тегів | Read `f` з `pin` / з `disposable`; Edit `f` | теги лишаються |
| MarkCall | R4 повторний запис | пара `Read` `f` уже має `review` `stale`; ще один Edit `f` | реєстр без змін (не переписується) |
| MarkCall | R4 відмова чи помилка | Edit `f` відхилено / з `isError` | тегів немає |
| MarkCall | R4 NotebookEdit | Read `n.ipynb`, NotebookEdit з `notebook_path` `n.ipynb` | пара Read — `stale` [тест: «MarkCall — R4 відмова чи помилка, NotebookEdit»] |
| MarkCall | без пропозицій | будь-який виклик без позначки при контексті 300k, зокрема запис без помилки | результат незмінний; SoftHint не викликається; CallLines без позначки — порожньо (фаза 23: межу етапу замінив канал ходу) [тест: «CallLines — рядки виклику»] |
| MarkCall | окремий рядок (фаза 23) | MarkAlias дає `c4`; SoftHint дає рядок / не дає | рядок псевдоніма `[context-editor] id c4: use it as "ref" in context_tag / context_edit`, далі окремий рядок, що починається `[context-editor: suggestion] ` і не містить ` id c` / лише рядок псевдоніма |
| CallLines | рядки виклику (рев'ю 54) | позначений з `c4` і пропозицією / з `c4` без неї / без псевдоніма з пропозицією / без позначки з пропозицією | рядок псевдоніма, пропозиція / рядок псевдоніма / пропозиція / нічого (рядок «MarkCall без пропозицій») |
| Bounded | строк | робота довша за строк / претензію на стан зроблено до кінця строку | рядка немає і `hint` не записано / рядок повертається, `hint` записано |
| MarkCall | повторне читання | у журналі `apply` з `compressed` [`/p/f`]; Read `/p/f` | запис `reread { path: /p/f, archive: false }` |
| MarkCall | читання після власної зміни | `apply` з `compressed` [`/p/f`]; Edit `/p/f`; Read `/p/f` | запис `changed { path: /p/f }`; `reread` немає |
| MarkCall | R4 лише раніші читання | одна відповідь: Edit `f`, далі паралельний Read `f`; раніше — Read `f` у минулому ході | `stale` лише на раніше читання; Read після запису без тегу |
| MarkCall | читання архіву | Read `<archives>/<at>.json` / `<archives>/<at>/1.png` запису `apply` (і так само в `<storage>` для старих архівів) | `reread` з `archive: true` |
| context_tag | відмова над словами людини ([SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58)) | `add disposable` з `index` 10, `to` 14, у діапазоні промпт людини #11 і результат AskUserQuestion #13 / `add disposable` за `tool_use_id` пари AskUserQuestion / діапазон без рядків людини | тег не поставлено; результат `Rejected: tag 1: disposable #10..#14: covers the person's words: #11 (prompt), #13 (AskUserQuestion answer); they stay verbatim in this session: narrow the range or split it around them` / тег не поставлено: `disposable <id>: the AskUserQuestion answer is the person's words; it stays verbatim` / тег поставлено |
| context_tag | блок, що чекав ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)) | `waiting = advised`, `lastClosed` — етап «A» #3..#10, `disposable` на парі в ньому; виклик `open` «B» / `close` (етап «B» відкрито) / `open` «B» і `close` | результат — спершу звіт «A» з індексами `#3..#10`, `You marked stage "A" …` і WAIT_MOVED, потім `Stage "B" opened…` / звіт закриття «B»; `waiting` знято; QueueTagReplacements один раз; `listedKey` оновлено |
| context_tag | очікування не зняте | `waiting = marked`; лише `add`/`remove` / `close` без етапу (NO_STAGE) / запис реєстру падає | `waiting` без змін; звіту блоку немає |
| RebindTags | межа після перегляду | `stage.after` — рядок результату `context_list` (#7), #6 — рядок асистента лише з викликом `context_list`, #5 — текст агента; застосовано summarize іншої пари | DropOwnCalls прибрав #6 і #7; `stage.after` — відбиток #5 з новим індексом |
| RebindTags | межа на переписаному рядку | `lastClosed.end` — рядок `rewrite` | межа на переписаному рядку (`report.produced`) |
| RebindTags | закриття, стискання і новий етап | закрито етап A (кінець — рядок результату останньої пари A, #11), відкрито B (`after` = той самий рядок); застосовано summarize цієї пари | `lastClosed.end` і `stage.after` B — рядок результату з FreshId; B починається після носія A, стиснутий хвіст A — у блоці A |
| RebindTags | найпізніший створений рядок | `lastClosed.end` — рядок асистента #7 з паралельними викликами `a` і `b`, результати яких у різних рядках; застосовано summarize `a` і summarize `b`; у кінцевому списку їхні рядки результатів — #9 і #10 | межа — рядок #10 (найбільший індекс серед `produced` правок, що замінили #7) |
| RebindTags | спільний рядок результатів | рядок #8 тримає результати паралельних викликів `a` і `b`; `lastClosed.end` — #8; застосовано summarize `a` і summarize `b` | `produced` має обидві правки з індексами в кінцевому списку; межа на рядку з найбільшим індексом серед них |
| RebindTags | межа на згорнутому діапазоні | `stage.after` — #6, застосовано collapse 4..7 з носієм | межа на рядку результату носія [тест: «RebindTags — межа на переписаному рядку / на згорнутому діапазоні»] |
| RebindTags | межа на прибраній парі | `stage.after` — рядок результату пари, яку прибрав `drop` | межа на найближчому попередньому рядку, що лишився |
| RebindTags | засів з CarryNote | `stage.after` — рядок результату незміненої пари з медіа, якому засів дописав CarryNote | межа на найближчому попередньому незміненому рядку засіву |
| RebindTags | межа на перезібраному рядку | `stage.after` — рядок асистента з `handle`, перезібраний KeepResponsesWhole без змін | межа лишається на ньому (відбиток той самий), `hint` оновлено [тест: «RebindTags — межа на прибраній парі / без попередників / на перезібраному рядку»] |
| RebindTags | межа без попередників | межа на #1, пару #0/#1 прибрано `drop` | `null` [тест: «RebindTags — межа на прибраній парі / без попередників / на перезібраному рядку»] |
| RebindTags | слот стану переписано | `state` на #5, застосовано `rewrite` #5 | тег `state` на переписаному рядку (`anchor` — відбиток `Later, your context_edit rewrite call replaced the text of this row with your own rewrite (original: …): <text>`; до фази 28 — `[context-editor] you rewrote this row …`) |
| RebindTags | діапазон | тег-діапазон #4..#7, застосовано summarize пари в #6/#7 / зсув на 2 рядки без правок у діапазоні | тег видалено / `hint` і `toHint` оновлено |
| RebindTags | заміна діапазону в пакеті | `collapse` 4..7 з `summary = note` діапазону | тег видалено (застосована чи відхилена) |
| AutoTag | R2, R3 (R1 вилучено, [SP_CTX_02_68](./context_editor.curation.edits.sp.md#SP_CTX_02_68)) | перший промпт людини; Read 5000 символів; Grep | промпт без тегу; `review` з `reason = big`; `review` з `reason = search` і `ttl_turns = 3` |
| AutoTag | без R1 ([SP_CTX_02_68](./context_editor.curation.edits.sp.md#SP_CTX_02_68)) | перший промпт людини з будь-яким походженням (`composer`, `unclassified`, `plugin`) | без тегу; `firstPromptPinned` не змінюється (його пише лише PinSummary засіву) |
| QueueTagReplacements | заміни з тегів | два `disposable` при порожній черзі | дві правки, `tagsOnly = true`; після context_edit — `false` [тест: «two disposable tags on an empty queue become two edits of a tags-only batch»] |
| QueueTagReplacements | діапазон | `disposable` з діапазоном #4..#7 і нотаткою N | правка `collapse` 4..7 з `summary = N` і якорями кінців; `freed` рахує суму `size` рядків діапазону; з фази 28 правка несе `via: 'tag'` |
| QueueTagReplacements | без повтору | `disposable` на парі `a`, його заміна вже в черзі (закриття етапу), потім `context_edit` з правкою, поки блок чекає, у тому самому ході | друга постановка нічого не додає (`queued = 0`) |
| QueueTagReplacements | слот стану в діапазоні | діапазон `disposable`, у який після тегування потрапив рядок `state` | PrepareEdits відхиляє `collapse`; черга без змін; тег лишається |
| RebindTags | після застосування | тег на змінену пару і на незмінену | перший видалено, другий лишився; псевдонім зміненої пари видалено [тест: «after an apply the tag of the edited pair goes, the tag of the untouched pair stays»; «after an apply the tag and alias of the changed pair go»] |
| MarkCall | великий вивід | Read 5000 символів | рядок `[context-editor] id c1`; `map.c1` = id виклику; поля `last` у записаному реєстрі немає (фаза 21) [тест: «MarkCall gives a big output the first alias»] |
| MarkCall | малий вивід / службовий інструмент | Read 100 символів; `context_list` | без позначки [тест: «MarkCall leaves small outputs, own tools»] |
| MarkCall | реєстр нечитабельний | — | без позначки, результат не змінено [тест: «MarkCall from an unreadable registry»] |
| ResolveRef | розв'язання | `last`, `c1`, `c99`, `ref` разом з `tool_use_id` | id останнього виклику за рядками; id; `unknown ref c99`; `ref and tool_use_id are exclusive` [тест: «ResolveRef: last by the rows, an alias, an unknown alias»; «context_tag rejects an unknown ref and a ref beside another target»] |
| context_tag | ціль за `ref` | `{op: add, kind: disposable, ref: last, note}` | тег на пару останнього виклику перед цим (позначеного чи ні); у результаті `"last" = <CallLabel>` [тест: «context_tag with ref»] |
| ResolveLast | малий виклик після позначеного (s5 фази 20) | Bash `cat big.log` 16 000 символів (`c1`), далі Bash `cat c.log` 2500 символів без псевдоніма, далі `context_edit` summarize `ref: last` | правка на пару `cat c.log`; у результаті `"last" = Bash id=<id> input="{"command":"cat c.log"}"`; `big.log` у черзі не згадано |
| ResolveLast | осиротілий виклик (рев'ю 50) | Read `a` з результатом; Bash `x` без результату; рядок промпту; рядок `context_edit` (callId); окремо — без рядка-носія | LAST_ORPHAN з CallLabel Bash `x` в обох випадках; не LAST_PENDING і не Read `a` |
| ResolveLast | власні виклики не рахуються | Read `a`; `context_note` з `ref: last`; `context_edit` summarize `ref: last` | нотатка і правка — на пару Read `a` |
| ResolveLast | паралельні виклики | одна відповідь: Read `a`, Read `b` (рядки викликів у цьому порядку), результат `b` раніше за `a`; далі `context_tag` з `ref: last` | ціль — Read `b` (написаний останнім), не той, що завершився останнім |
| ResolveLast | виклик тієї самої відповіді без результату | рядки: Read `a` з результатом (минула відповідь); Bash `x` без результату; рядок `context_edit` (callId) | LAST_PENDING з CallLabel Bash `x`; правку відхилено, інші правки виклику поставлено; Read `a` не обрано |
| ResolveLast | виклик тієї самої відповіді з результатом | Bash `x` з результатом перед рядком `context_note` тієї самої відповіді | ціль — Bash `x` |
| ResolveLast | виклики після свого | рядок `context_tag` (callId), за ним рядок Read `z` тієї самої відповіді | ціль — останній виклик перед рядком `context_tag`; Read `z` не розглядається |
| ResolveLast | немає виклику | розмова лише з промптом і власними викликами `context_*` | LAST_NONE |
| ResolveLast | без callId / рядка-носія | `callId` відсутній або його рядка немає | carrier = len(rows): останній невласний виклик розмови; без результату — LAST_PENDING [тест: «ResolveLast — без callId чи рядка-носія»] |
| ResolveLast | реєстр псевдонімів нечитабельний чи старий | `aliases.json` нечитабельний; окремо — старий файл з полем `last` | `last` розв'язується за рядками; `c1` — `unknown ref c1` / старий файл читається, `last` у ньому ігнорується [тест: «ResolveRef: last by the rows, an alias, an unknown alias, an unreadable registry»; «parseAliases reads a good file»] |
| PrepareStorage | права | команда встановлення прав завершується з помилкою | сховище `unavailable`, інструменти відмовляють DENIED_STORAGE [тест: «PrepareStorage — сховище недоступне»; «madeStorage»] |
| PrepareStorage | без HOME / недійсний id | `HOME` відсутній або відносний; `session_id` `../x` | сховище `unavailable` без команди хоста; інструменти відмовляють `storage unavailable: <reason>` (DENIED_STORAGE) [тест: «PrepareStorage — сховище недоступне»; «PrepareStorage — недійсний id сесії»; «storagePlan»] |
| EnsureStorage | паралельно на зміні сесії | два виклики після `/clear`, поки йде підготовка нової сесії | одна підготовка, один AfterPrepare, обидва отримують каталог нової сесії; до кінця підготовки опубліковано каталог старої, а не жодного [тест: «EnsureStorage — паралельні виклики на зміні сесії»] |
| EnsureStorage | робота почата в сесії A | каталог A отримано, потім `/clear` | усі читання й записи цієї роботи — у каталозі A; нічого в `<cwd>/undefined/` і в каталозі нової сесії [live only: the unit test was tautological and was removed (PL_AUD_CTX phase 1); the live run .dev_flow/cache/live-test/audit-p1-results.md is the evidence] |
| PrepareStorage | сесію покинуто під час підготовки | підготовка B, а сесія тим часом — C | B нічого не публікує; наступна операція готує C |
| PrepareStorage | обробник компактизації приєднується | підготовка поза компактизацією чекає непрочитаний `hostId` | крок межі закінчує очікування: `hostId` відсутній, `host` межі лишається |
| QueueTagReplacements | заміна з тегу називає автора (фаза 19; фаза 28 — `via: 'tag'`) | теги `disposable` на пару і на рядок, закриття етапу, застосування; ті самі правки без `via` | у черзі кожна правка з `via: 'tag'`; тексти — `Later, your context_tag disposable tag replaced the full output of Read you had read here with your own note (original: …): <note>` (з фази 41 — з джерелом) і `Later, your context_tag disposable tag replaced the text of this row with your own note (original: …): <note>`; без `via` — тексти `context_edit` (SUMMARIZED_OF, REWRITTEN); обидва — ReplacementText |
| PruneDeadTags | чужа компактизація | реєстр: `pin` на рядку і `review big` на парі `a`, яких немає в `result.messages`; `review search` на парі `b`, що є; `state` на зниклому рядку; `disposable` діапазону, обидва кінці якого є; `lastApply` є | лишаються `review search` `b`, `state` і `disposable`; `lastApply` знято; один запис реєстру на ланцюжку `tags` |
| PruneDeadTags | нічого прибирати | усі цілі є в `result.messages`, `lastApply` немає / `result` — `skip` / `agentId` / MarkerKind в інструкціях / `trigger = precompute` | реєстр не записується / спостерігач реєстру не чіпає |
| AutoTag | повний реєстр | 1000 тегів; результат `Grep`; результат Read 5000 символів | тегу немає, реєстр не записується (як до фази 30; агенту каже телеметрія) |
| AutoTag | R3 помилка | результат `Grep` з `is_error: true` / без помилки / Read 5000 символів з `is_error: true` / рядок з двома результатами `Glob`, один з помилкою (фаза 31, CF-52) | тегу немає / `review search` / `review big` / `review search` лише на парі без помилки |
| AutoTagNeeded | помилка пошуку | результат `Grep` 200 символів з `is_error: true` / без помилки | `false` (ланцюжок реєстру не чекається) / `true` |
| MarkCall | помилка пошуку | `Grep` з `isError`, 200 символів / з `isError`, 5000 символів / без помилки, 200 символів | без псевдоніма і без пропозиції м'якого нагадування, результат незмінний / псевдонім (за розміром) / псевдонім |
| ResolveRef | прибраний псевдонім | реєстр `next = 6`, `map` без `c3` / `c9` / реєстр нечитабельний, `c3` (фаза 31, CF-53) | `alias c3 is gone: aliases go when an apply changes their pair or the pair leaves the conversation; name the call by its tool_use_id from context_list` / `unknown ref c9 (…)` / `unknown ref c3 (…)` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-16 | Фаза 41: рядок «заміна з тегу називає автора» — відкривач з джерелом, без `via` — SUMMARIZED_OF |
| 2026-10-15 | Рядки §05_01 перенесено дослівно з [context_editor.expectations.sp.md](./context_editor.expectations.sp.md): поділ таблиці за модулями (structural-event) |
