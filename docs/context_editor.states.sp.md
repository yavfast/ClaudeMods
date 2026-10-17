# Редактор контексту агента — Specification: State Transitions

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-11
> **Updated:** 2026-10-15
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §04 State Transitions (04_01–04_07) специфікації [SP_CTX](./context_editor.sp.md): життєві цикли черги, правки, тегу, запиту передачі, етапу, запиту оптимізації і нотатки. Читати перед зміною переходів станів черги, тегів, етапів чи передачі.

## Contents

- [04. State Transitions](#SP_CTX_04) — життєвий цикл черги, окремої правки, тегу, запиту передачі, етапу, запиту оптимізації і нотатки

## 04. State Transitions  {#SP_CTX_04}

### 04_01. Queue Lifecycle  {#SP_CTX_04_01}

    [empty] --context_edit / QueueTagReplacements--> [pending] --turn completed, no handoff waiting, host runs the command--> [applying] --handler done--> [reported] --next prompt--> [empty]

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| empty | pending | прийнято ≥ 1 правку | рядок стану показує кількість |
| pending | pending | ще правки; хід перервано; хост відхилив команду (одна спроба, відмова остаточна); у черзі запит передачі (правки застосує RunHandoff); разовий `claude -p` без прив'язаної сесії | рядок стану лишається або показує текст відмови хоста |
| pending | applying | хід основної розмови завершено, запиту передачі немає, хост виконав команду компактизації з MARKER ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)) | рядки команди `/compact <MARKER>` і позначка виконання в розмові |
| applying | reported | обробник застосував пакет, жодна правка не застосувалась або обробник впав | архів, спливне повідомлення, пакет очищено, звіт записано; збій після точки фіксації звіту про збій не додає |
| applying | pending | хост покинув диспетчеризацію до точки фіксації (запису черги) | черга не змінюється, звіту немає; реєстр, псевдоніми, межа, доставки й журнал не змінюються ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)); гілка збою за бюджетом потім очищує пакет звітом про збій |
| pending | pending | сховище недоступне (SKIP_STORAGE) | черга не змінюється |
| pending | reported | передача забрала правки в засів або документ (`HandedOff`, [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)) | пакет очищено; нотатка про передачу у звіті старої черги, `reportResume = false` |
| reported | reported + pending | context_edit до доставки звіту | звіт чекає, нові правки в пакеті |
| any | unreadable | файл черги пошкоджено | Flush і обробник чекають; мітка оптимізації ігнорується (MARK_QUEUE_UNREADABLE) |
| unreadable | pending | context_edit переносить файл (QUEUE_QUARANTINED) | нова черга з поставленими правками |
| reported | empty | наступний промпт (людини, продовження або ходу стискання) отримав звіт | поля звіту видалено |
| pending | applying | є запит `/compact` людини, черга непорожня; хід стискання запускається після застосування ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)) | звіт іде в промпті ходу стискання замість промпту продовження; мітка оптимізації цього рядка з 2026-10-14 не дає ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)) |

### 04_02. Edit Lifecycle  {#SP_CTX_04_02}

    [requested] --PrepareEdits ok--> [queued] --ApplyEdits ok--> [applied]
    [requested] --PrepareEdits error--> [rejected]
    [queued] --pin / state slot / not located / overlap / pairing / media not archived--> [failed]

### 04_03. Tag Lifecycle  {#SP_CTX_04_03}

    [absent] --context_tag add / AutoTag / R4 in the call hook--> [tagged] --ttl not passed--> [tagged, inactive review]
    [tagged review] --R4 (any reason) / R5 (big, search)--> [tagged review, new reason]
    [tagged disposable] --stage closed by the tool / the waiting block ends (open, close, or an accepted context_edit)--> [queued as edit] --applied or failed--> [absent]
    [tagged state] --rewrite of its row applied--> [tagged state on the rewritten row]
    [tagged state] --context_tag add state elsewhere--> [absent] (the new row holds the slot)
    [tagged] --context_tag remove / target edited / target gone--> [absent]

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| absent | tagged | агент або правило поставили тег | запис у реєстр |
| tagged | queued as edit | `disposable`: агент закрив етап інструментом або блок, позначений міткою, перестав чекати — `open`/`close` чи `context_edit` з прийнятою правкою ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)) (QueueTagReplacements, [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13)); діапазон — як `collapse` | правка в черзі; удруге та сама заміна не ставиться |
| queued as edit | absent | правку застосовано або відхилено при застосуванні | тег видалено (RebindTags) |
| tagged | absent | тег знято, ціль змінено іншою правкою (для діапазону — будь-який його рядок) або ціль зникла | тег видалено |
| tagged review | tagged review | R4 на будь-якому `review`, R5 на `review` з причиною `big` або `search` | нова причина, без терміну |
| tagged state | tagged state | застосовано `rewrite` рядка слоту | тег переходить на переписаний рядок (RebindTags, [SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)) |
| tagged state | absent | `add state` на іншому рядку; рядок слоту зник іншим шляхом (вбудована компактизація, вікно, засів до підсумку) | у реєстрі лишається не більше одного `state` |

### 04_04. Handoff Lifecycle  {#SP_CTX_04_04}

```
(none) ──context_handoff / /handoff──▶ queued ──after turn end + HANDOFF_DELAY──▶ running
queued ──the turn the agent asked in is interrupted (by = agent, requestTurn = turns) / /handoff cancel──▶ (none) + report "handoff cancelled"
running, not in flight in this instance ──/handoff cancel──▶ (none) + report "handoff cancelled"
running, stale, a seed.json of that run exists ──claim──▶ (none) + report "a previous handoff stopped after building <file>; it is not re-run"
queued ──new request──▶ queued (replaced)
running ──seeded and checked (transcript)──▶ (none) in the old queue, edits gone + report "handed off to <new> (transcript)"
running ──seed refused before /clear, document way done──▶ (none), edits gone + report "handed off to <new> (document)"
running ──/clear refused, or no document (both ways before /clear)──▶ (none), edits kept + report "handoff failed …; the session was not changed"
running ──(a turn ran while /clear waited, or seeding failed after /clear) with the agent's document, no turn in the new session──▶ (none), edits gone + report "handed off to <new> (document)"
running ──(a turn ran while /clear waited, or seeding failed after /clear) without a document; or a turn began in the new session; or the session changed during seeding──▶ (none), edits kept + report "handoff failed after the session was cleared …"
queued / running ──a turn ran or started since scheduling, seen before /clear is issued──▶ queued (runs after that turn, or at once if it already ended); seed files removed
running ──no handoffInFlight (process gone or module reloaded) and older than HANDOFF_STALE──▶ due again
running ──handoffInFlight in this instance──▶ never due, not replaceable, however long a command waits
running ──any exception before /clear──▶ (none) via one Fail attempt (a failed write gives a toast only)
running ──any exception after /clear, transcript, AfterClear not yet entered──▶ AfterClear once: with the agent's document → handed off (document); without → FailAfterClear + notice
running ──an exception inside AfterClear──▶ caught there; no second /clear, no second delivery, at most one FailAfterClear
running ──after /clear, document way or AfterClear with the document: Deliver fails──▶ (none) + report "handed off to <new> (document)"; a toast names the copy <old storage>/<id>/document.txt (HandDocument)
running ──after /clear, document way or AfterClear with the document: the HandedOff write fails──▶ running; the document still delivered; a toast advises /handoff cancel in the old session
```

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| running | (none) | засів узято і CheckSeeded пройшов | процес у новій сесії із засіяними рядками; теги й псевдоніми скопійовано; звіт і промпт продовження в новій сесії |
| running | (none) | збій до `/clear`, спосіб `document` вдався | процес у новій сесії з документом першим промптом |
| running | (none) | `/clear` відхилено або документа немає | процес у старій сесії; правки в черзі; звіт з причинами |
| running | (none) | збій після `/clear` | один AfterClear; повторне `/clear` лише тоді, коли засів уже взято (і не було ходу в новій сесії чи зміни сесії); документ агента (лише коли в новій сесії не було ходу) або повідомлення з ідентифікатором старої сесії і шляхом до файлу засіву — промптом або, коли людина вже почала хід, у звіт черги поточної сесії; стара сесія без змін |
| running | queued | хід пішов або почався від планування, помічено до того, як `/clear` запущено | файли засіву видалено; `owner` прибрано |

Поки запит є (`queued` чи `running`), обробник компактизації не застосовує черги ([SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07)), а Flush не запускає команди компактизації ([SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06)). Хід, який хост виконав, поки `/clear` чекав вільної сесії, уже не відкладає передачу: засів його не містить, тож RunHandoff іде в AfterClear; хід, що почався в новій сесії після `/clear`, закінчує передачу `FailAfterClear` без повторного очищення ([SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21)).

### 04_05. Stage Lifecycle  {#SP_CTX_04_05}

```
(no stage) ──context_tag open──▶ open(after) ──context_tag close──▶ (no stage), lastClosed = that block
open ──context_tag open (another)──▶ open(new after); lastClosed = the previous block
open ──optimization mark, no tool close in this turn──▶ (no stage), lastClosed = the block up to the end of the turn, waiting = marked
(no stage) ──optimization mark, no tool close in this turn──▶ (no stage), lastClosed = unnamed block after the previous lastClosed.end (or from the head), waiting = marked
(any) ──optimization mark while waiting──▶ lastClosed = merged block (after of the waiting block, end of this turn), waiting = marked
waiting = marked ──the first prompt of the next turn carries WaitingAdvice (DeliverReport or Flush's resume prompt)──▶ waiting = advised
waiting ──context_tag open/close accepted, or context_edit with an accepted edit──▶ no waiting; the block reported (open/close) and disposable replacements queued
open / lastClosed ──applying edits or seeding: the mark row replaced by an edit (summarize, collapse, rewrite, describe)──▶ the mark moves to the last row that edit produced
open / lastClosed ──applying edits or seeding: the mark row removed without replacement (drop, own calls, empty row) or changed by the seed (CarryNote)──▶ the mark moves to the nearest preceding unchanged surviving row, or null
open / lastClosed ──host compaction (/compact, auto): the mark row gone──▶ lost: open stage from the head, lastClosed.end unknown (never shown as empty); a lost after becomes null at the next context_tag or DetectOptimize write
open / lastClosed ──handoff (transcript)──▶ copied into the new session with relocated marks
```

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| no stage | open | `open` прийнято, реєстр записано | `stage = { name, after, openedTurn }`; перегляд показує `[stage ▶ name]` |
| open | no stage | `close` прийнято, реєстр записано | `lastClosed` — блок етапу; QueueTagReplacements; звіт блоку в результаті ([SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29)) |
| open | open | `open` при відкритому етапі | спершу закриття, як у рядку вище (звіт у результаті), потім новий етап |
| open | no stage | мітка оптимізації, у цьому ході етап інструментом не закривали | `lastClosed` до кінця ходу; `waiting = marked`; черга без змін ([SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30), [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)) |
| no stage | no stage | мітка без відкритого етапу і без закриття в цьому ході | `lastClosed` — блок без етапу від попереднього `lastClosed.end` ([SP_CTX_DEC_14](./context_editor.decisions-01.sp.md#SP_CTX_DEC_14)); `waiting = marked` |
| open, no stage | the same | мітка після закриття інструментом у тому самому ході | `lastClosed` не змінюється; відкритий після закриття етап лишається; `waiting = marked` |
| waiting | waiting (merged) | мітка, поки блок чекає, без закриття в цьому ході | `lastClosed.after` — від блоку, що чекав, `end` — кінець ходу; назва — блоку, що чекав, якщо етапу не закрито, інакше без назви; `waiting = marked` |
| waiting `marked` | waiting `advised` | промпт з WaitingAdvice увійшов (DeliverReport; промпт продовження Flush) | порівняння-і-запис на ланцюжку реєстру; збій — порада ще раз |
| waiting | no waiting | перший прийнятий `open` чи `close` у context_tag | звіт блоку з індексами і WAIT_MOVED у результаті; QueueTagReplacements; далі сам запит ([SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11)) |
| waiting | no waiting | `context_edit` з прийнятою правкою агента | QueueTagReplacements тим самим пакетом; рядок у результаті ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02)) |
| waiting | no waiting | `lastClosed` знято (чужа компактизація, що прибрала межі; передача без реєстру) | порада не йде |
| open, no stage | the same, marks moved | застосування правок, засів | RelocateMark ([SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14)): рядок межі замінено правкою — межа на останньому створеному нею рядку; прибрано без заміни або змінено засівом — на найближчому попередньому незміненому рядку |
| open, no stage | the same, marks lost | вбудована компактизація хоста, межа вийшла за ROW_WINDOW | перегляд і телеметрія кажуть, що етап діє від голови або кінець блоку невідомий |
| no stage | no stage | `close` без відкритого етапу | NO_STAGE; реєстр без змін |

### 04_06. Optimization Request Lifecycle  {#SP_CTX_04_06}

З 2026-10-14 ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)) запит оптимізації (`Queue.optimize`) буває лише запитом ходу стискання `/compact` людини ([SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42)); мітка оптимізації черги не змінює — її стан описує `waiting` у [SP_CTX_04_05](#SP_CTX_04_05).

```
(none) ──the person's /compact with empty args, no handoff, not busy (RequestCompact)──▶ requested (optimize = true, compact = true); Flush planned unless planned already
requested ──the hook abandoned, or the host refused Flush's timer──▶ as read before the request
requested ──Flush: queue applied if non-empty; no turn started; compare-and-set swap──▶ prompted (optimizePrompted = true, compact kept); the one prompt is the report (if any) and CompactTurnText
requested ──a turn started before the swap, or DeliverReport already cleared optimize (OPTIMIZE_PERSON)──▶ requested / (none); nothing sent
requested ──compaction refused (HOST_REFUSED) / turn aborted after planning (PERSON_MOVED) / CompactTurnText threw and the batch asked for no continuation (OPTIMIZE_BUILD_FAILED) / module reloaded before Flush──▶ requested → COMPACT_ADVICE with the next person's prompt
requested ──CompactTurnText threw and the batch asked for continuation (OPTIMIZE_BUILD_FAILED)──▶ (none); ordinary resume of that batch
requested ──a person's prompt passes the hook──▶ (none); report and COMPACT_ADVICE ride on that prompt
prompted ──the compression prompt refused (OPTIMIZE_FAILED)──▶ requested (swap undone) → COMPACT_ADVICE with the next person's prompt
prompted ──the next main turn (the compression turn) ends, completed or aborted (DetectOptimize)──▶ (none), compact = false; a mark in its answer is ignored; nothing queued and not aborted → toast COMPACT_NOTHING; its batch applies with the agent's own settings (resume defaults to false in it, SP_CTX_DEC_16)
prompted ──a person's prompt passes the hook between turns──▶ (none); the person took over
legacy (optimize without compact, a file of an earlier version) ──Flush or DeliverReport──▶ (none), nothing sent (OPTIMIZE_LEGACY)
```

| From | To | Condition | Side effects |
|------|----|-----------|-------------|
| none, requested | requested | `/compact` людини без аргументів: немає `handoff`, не зайнято (ні ходу стискання, ні запиту з запланованим Flush), хук не покинуто | `optimize = true`, `optimizePrompted = false`, `compact = true` одним записом; RequestFlush (другого таймера немає, якщо Flush уже заплановано) |
| requested | як до запиту | хук покинуто після запису або хост відхилив таймер Flush (COMPACT_REFUSED) | `optimize`, `optimizePrompted`, `compact` як прочитано; спливне повідомлення при відмові таймера |
| requested | prompted | Flush: хід людини не почався до заміни; порівняння-і-запис застав `optimize = true` | `optimize = false`, `optimizePrompted = true` одним записом (пакет, що лишився в черзі, — також `resume = false`, `resumeSet = false`); далі один промпт зі звітом застосування і CompactTurnText; збої — спливним повідомленням |
| requested | requested | хід людини почався до заміни (OPTIMIZE_PERSON), команду відхилено (HOST_REFUSED), хід перервано після планування (PERSON_MOVED), CompactTurnText кинув виняток, а пакет не просив продовження (OPTIMIZE_BUILD_FAILED), модуль перезавантажено | нічого не надіслано; COMPACT_ADVICE — з наступним промптом людини |
| requested | none | OPTIMIZE_BUILD_FAILED, коли пакет просив продовження (`compacted AND reportResume`) | `optimize = false`, `compact = false`; звичайне продовження застосування (Resume) з `reportPrompt` |
| requested | none | DeliverReport пройшов раніше заміни (порівняння-і-запис не застав `optimize`) | нічого не надіслано |
| requested | none | промпт людини пройшов хук DeliverReport | звіт і COMPACT_ADVICE — прихованим контекстом цього промпту |
| prompted | requested | промпт ходу стискання відхилено | зворотна заміна одним записом; спливне повідомлення (OPTIMIZE_FAILED) |
| prompted | none | кінець наступного ходу основної розмови (ходу стискання), завершеного чи перерваного | `optimizePrompted = false`, `compact = false`; мітка в його відповіді ігнорується (MARK_IN_OPTIMIZATION); не перерваний і без правок у черзі — спливне COMPACT_NOTHING; його пакет — зі своїм `resume`, який без явного значення й без `resume_prompt` — `false` ([SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_DEC_16](./context_editor.decisions-01.sp.md#SP_CTX_DEC_16)) |
| prompted | none | промпт людини пройшов хук між ходами (`inTurn = false`) | `optimizePrompted = false`, `compact = false` ([SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08)) |
| legacy | none | `optimize` без `compact` (файл попередньої версії) — Flush або DeliverReport | `optimize = false`; ні ходу, ні поради (OPTIMIZE_LEGACY) |

### 04_07. Note Lifecycle  {#SP_CTX_04_07}

```
(none) ──context_note add──▶ noted (remindAt optional)
noted, remindAt ≤ turn ──next main-loop tool call──▶ noted (reminder delivered once, remindAt removed)
noted ──its row replaced by an applied edit──▶ noted on the last row that edit produced
noted ──its row removed without replacement, or not found at an application──▶ (none); the apply report names it
noted ──context_note remove──▶ (none)
noted ──handoff (transcript)──▶ noted in the new session (relocated like at an application)
```

## Changelog

| Date | Change |
|------|--------|
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §04 State Transitions (04_01–04_07) перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.states.sp.md](./context_editor.states.sp.md), якорі без змін |
| 2026-10-11 | PL_AUD_CTX фаза 2 (CF-2): applying → pending не змінює нічого, крім файлів архіву; збій після точки фіксації не додає звіту про збій (04_01) |
| 2026-10-11 | PL_AUD_CTX фаза 6a (CF-41): після `/clear` способом `document` збої HandedOff і Deliver перехоплює HandDocument — замість FailAfterClear: «handed off» з копією недоставленого документа або `running` з порадою `/handoff cancel` (04_04) |
| 2026-10-12 | Фаза 25: 04_06 — `/compact` людини веде запит оптимізації в `prompted` ходом стискання (CompactTurn, [SP_CTX_02_42](./context_editor.stages.sp.md#SP_CTX_02_42)) і назад, якщо промпт відхилено |
| 2026-10-12 | Фаза 25, рев'ю: 04_06 — `/compact` людини пише запит `compact` і йде через Flush (requested → prompted), кінець ходу стискання — DetectOptimize; відкат запиту при покинутому хуку чи відхиленому таймері |
| 2026-10-14 | Перехід між етапами ([SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37)): 04_05 — `waiting` (`marked` → `advised` → знято), злиття другою міткою; 04_06 — запит оптимізації лише для `/compact`, OPTIMIZE_LEGACY; 04_01 і тег `disposable` — без ходу оптимізації за міткою |
