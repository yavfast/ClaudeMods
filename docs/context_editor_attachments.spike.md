# Spike: Вкладення `queued_command` і компактизація від обробника

> **Status:** concluded
> **Created:** 2026-10-10
> **Updated:** 2026-10-11
> **Author:** Claude (Opus 5.5) разом з alexandr.yavorsky
> **Time-box:** ~1.5 години
> **Scope:** codebase (типи хоста, `edits.ts`), prototype (одноразовий плагін `aprobe` у scratchpad, малі сесії `--model haiku` на закріпленому бінарнику 2.1.295: stream-json через fifo і термінал у tmux), розбір транскрипту робочої сесії `decd4bc6…`
> **Mode:** single
>
> **Target concept:** [C_CTX](./context_editor.concept.md)
> **Serves:** дефект «apply мовчки губить `queued_command`» з живого тесту фази 17 (`.dev_flow/cache/live-test/fork-test-results.md`, розділ «Фаза 17», пункт 6)
> **Question(s):**
> 1. Де живуть ці вкладення: записи транскрипту, рядки `$.session.messages()`, `{ as: 'api' }`, `e.messages` події `session.compact`, події `session.append`?
> 2. Чи може обробник `session.compact` їх зберегти (відновлені рядки, рядки з `handle`) без дублікатів і без розриву пар? Чи повертає хост їх сам?
> 3. У яких хостах це стається: stream-json (VS Code), термінал, фонові субагенти й задачі?
> 4. Мінімальні пом'якшення та їхня ціна.

## Context

Живий тест фази 17 на форку робочої сесії показав: після кожного apply зникають повідомлення людини посеред ходу, звіти субагентів і `<task-notification>` — хост доставляє їх як вкладення `queued_command`, і їх немає в рядках, які бачить мод. Текст кожного довгого звіту — 4 рази до межі й 0 після. Треба зрозуміти механізм і вибрати пом'якшення для концепту та специфікації.

## Exploration Log

### Entry 1 — 2026-10-10 — Де живуть доставки (Q1) і чому вони зникають (Q2)

**What was tried / researched:**
Плагін `aprobe` (`session.append`, `prompt.submit`, `turn.complete` → `$.clock.after` → `$.command.run({ command: 'compact', args: 'ASPIKE-MARKER <mode>' })`, обробник `session.compact` з режимами `same` — повернути `e.messages` як є, `plain-results` — рядки з `tool_result` без `handle`, як робить мод за SP_CTX_DEC_02, `plain-results-inject` — те саме плюс відновлені рядки). Сценарій: `Bash` `timeout 25 tail -f /dev/null` на передньому плані, за 9 с — друге повідомлення з ключем, далі компактизація і запитання «яке слово я надіслав посеред ходу» без інструментів. Хост 2.1.295, `--model haiku`. Транскрипт робочої сесії розібрано `jq` (34 доставки).

**Findings:**
- **Транскрипт.** Доставка — запис `type: "attachment"`, `attachment.type: "queued_command"` з `attachment.origin.kind` (`human`, `peer`, `task-notification`), `attachment.prompt` (сирий текст), `source_uuid`, `delivery_id`, а також `rendered[0].content` (рядок або блоки) і `renderedRole: "system"`. Батько запису — рядок `user` з `tool_result` (напряму або через інші вкладення): у робочій сесії так у всіх 34 випадках (18 `task-notification`, 13 `peer` — звіти субагентів, 3 `human`).
- **`$.session.messages()` і `e.messages`:** доставки немає ні як рядка, ні в тексті (`queuedInRows=0`, `queuedInE=0`, кількість рядків однакова).
- **`{ as: 'api' }`:** доставки теж немає. Повідомлення `user` з результатом містить лише `tool_result`, хоча модель текст бачила й відповіла на нього («Noted: I'll remember PELICAN»). Хост додає її до запиту як системний хід (`renderedRole: "system"`; у типах — «reminders promoted to system turns», яких немає в жодному повідомленні). **Відновити доставку з API-подання неможливо.**
- **`session.append`:** доставка проходить з `door: 'delivery'`, `type: 'attachment'`, `name: 'queued_command'`, `role: 'user'`, `content` = відрендерений текст (`<system-reminder>\nThe user sent a new message while you were working:\n…`), власний `uuid`. Попередній рядок у порядку `session.append` — той самий `tool_result`, що й батько в транскрипті. `origin`: `unclassified` (stream-json), `composer` (термінал), `task-notification` (фонові задачі й субагенти в `-p`).
- **`prompt.submit`:** повідомлення посеред ходу й сповіщення теж його породжують — з `turnId` поточного ходу; `origin` `sdk` або `composer` для людини, `task-notification` для сповіщень. Текст — сирий, без обрамлення.
- **Режим `same` (усі рядки з `handle`):** хост сам копіює після межі і рядок, і **вкладення, що висять за ним** (`queued_command`, `total_tokens_reminder`, `prompt_snapshot`, вкладення першого промпту). У транскрипті після межі: копія `tool_result` (`aa9cd1f0`), за нею копія `queued_command` (`e6b7a9f8`); у stream-json копія знову проходить `session.append` з `door=delivery`. Модель після компактизації відповідає «PELICAN».
- **Режим `plain-results` (рядок з `tool_result` без `handle`):** вкладення за ним зникає. Відповідь моделі: «NOT-VISIBLE… my earlier line "Noted: I'll remember PELICAN" was not based on anything you sent, so please disregard it» — модель відрікається від власного раніше правильного тексту. Саме це робить мод: SP_CTX_DEC_02 перезбирає кожен збережений рядок з `tool_result` без медіа, а доставки висять саме за такими рядками.
- **Режим `plain-results-inject`:** після перезібраного рядка `tool_result` вставлено рядок `{ role: 'user', text: <відрендерений текст із session.append> }` без `handle`. У API-поданні після компактизації це одне повідомлення `user`: `tool_result | text[<system-reminder>…]`; помилок `ensureToolResultPairing` у журналі немає. Модель відповідає «PELICAN». Вставлений рядок далі — звичайний рядок `$.session.messages()` (мод його бачить і може редагувати).

**Open questions:**
- Чи переживає вставлений рядок `--resume` — очікувано так (рядок без `handle` у ланцюжку після межі, пастка 7 його не зачіпає), окремо не перевірено.

---

### Entry 2 — 2026-10-10 — Хости та джерела доставок (Q3), відновлення в іншому процесі

**What was tried / researched:**
(а) Термінал у tmux (`ce.sh`): те саме повідомлення посеред `Bash`, далі `plain-results` і `plain-results-inject`. (б) stream-json: фоновий `Bash` (`run_in_background`) і фоновий субагент `Agent`, що завершуються під час 45-секундного `Bash` на передньому плані, далі `plain-results` / `plain-results-inject`. (в) stream-json, два процеси: доставка в першому, `--resume <sid>` у другому, компактизація з відновленням із транскрипту (`queued.jq`: записи `queued_command` після останнього `compact_boundary`, якір — перший рядок `user`/`assistant` вгору по `parentUuid`, його `tool_use_id`). Шлях до транскрипту — з `$.session.cwd()` і `$.session.id()` (пастка 17).

**Findings:**
- **Термінал:** те саме, що в stream-json. Повідомлення, набране під час ходу, приходить `prompt.submit` (`origin: composer`, `turnId`) і `session.append` `door=delivery` одразу після наступного `tool_result`. `plain-results` → «NOT-VISIBLE… that memory is likely wrong»; `plain-results-inject` → «HERON. Your mid-turn message was …».
- **Фонові задачі й субагенти:** сповіщення про завершення доставляються лише на межі виклику інструмента (фоновий `Bash` закінчився за 8 с, а доставка прийшла разом з результатом 45-секундного виклику). Обидва — `queued_command` з `origin: task-notification`. `plain-results` → модель не бачить ні кольору зі звіту субагента, ні сповіщення про `Bash` і відрікається від свого підсумку; `plain-results-inject` → «The subagent reported TEAL». У робочій сесії VS Code звіти субагентів мають `origin.kind: peer` з тілом «[Subagent hand-back] …» — інший вигляд, той самий механізм.
- **Коли сесія вільна**, сповіщення починає новий хід як звичайний промпт — це рядок (`door=prompt`), він не губиться (у транскрипті робочої сесії є такі рядки `user` з `<task-notification>`).
- **Відновлення з транскрипту в іншому процесі (`--resume`):** запис пам'яті `session.append` зник разом з процесом, а `jq` по транскрипту знаходить доставку (`queued=1`, ~40 мс) і вставляє її; модель відповідає «GANNET». Без вставки — «NOT-VISIBLE».
- **`classic.*` у модулі мода не надійні:** хуки `classic.Stop`, `classic.PreCompact`, `classic.SessionStart`, `classic.PostToolUse` в `aprobe` не спрацювали жодного разу; журнал: «aprobe: classic.SessionStart bypassed by cc-plugin-sec-default (tier user)». Вбудований модуль відповідає сам, тож `transcript_path` з подій `classic.*` у цьому середовищі не дістати; шлях треба виводити з `cwd` і `sid`.
- **Передача (`context_handoff`)** — висновок без живої перевірки: засів складається з рядків без `handle` і з API-подання, де доставок немає, тож передана розмова теж їх губить.

---

## Alternatives Considered

| # | Approach | Pros | Cons | Verdict |
|---|----------|------|------|---------|
| H | Лишати `handle` на рядку `tool_result`, за яким є доставка | хост сам копіює вкладення, як системний хід, без зміни тексту | копія `tool_result` має батька до межі (пастка 5) → після `--resume` повертає ланцюжок оригіналів і скасовує правки до цього рядка (пастка 7а); треба все одно знати, за якими рядками є доставки | ні як основне |
| R1 | Вставка: відрендерений текст із `session.append` (`door=delivery`, `name=queued_command`), якір — `tool_use_id` попереднього `tool_result`; зберігати на диск у теці сесії; вставляти рядок `user` одразу після перезібраного рядка-якоря | лише задокументований API хуків; перевірено в обох хостах; без розриву пар; після першого apply доставка стає звичайним рядком, видимим у `context_list` | лише доставки, що прийшли в процесі з модом; форк або старіша сесія їх не мають; рядок `user` замість системного ходу (текст лишає обрамлення `<system-reminder>`) | viable — основне |
| R2 | Вставка з транскрипту: `queued_command` після останнього `compact_boundary`, якір за `parentUuid` | працює після `--resume`, у форку, після перезавантаження модуля; не залежить від того, чи мод бачив доставку | недокументований формат файлу (пастка 17); шлях з `cwd`+`sid`; потрібен `jq` або читання через `$.process.run` (файл буває > 4 MiB) | viable — запасне для R1 |
| W | Лише попередження у звіті й `context_list`: «N доставок (k від людини) у цьому відрізку зникнуть — перекажіть їх» | дешево | вміст усе одно губиться в незмінених відрізках; агент їх не бачить, тож не може переказати | доповнення, не рішення |
| P | Нести текст доставок у промпт відновлення | просто | губиться позиція; великий промпт (звіти 6–14k символів) щоразу | ні |
| X | Відмовляти або відкладати apply, поки є доставки | без втрат | у VS Code з субагентами доставки є майже завжди — редактор перестає працювати | ні |

## Conclusion

**Verdict:** concluded. Доставки `queued_command` (повідомлення людини посеред ходу, звіти субагентів, сповіщення фонових задач) живуть лише як записи-вкладення транскрипту, що висять за рядком `tool_result`; модель отримує їх системним ходом. Їх немає ні в `$.session.messages()`, ні в `e.messages`, ні в `{ as: 'api' }`. Хост переносить їх через компактизацію від обробника лише разом з рядком-якорем, повернутим з `handle`. Мод перезбирає такі рядки без `handle` (SP_CTX_DEC_02), тому губить доставки навіть у незмінених відрізках, в обох хостах. Вставка відрендереного тексту рядком `user` одразу після перезібраного якоря повертає їх без розриву пар.

**Key constraints discovered:**
- Джерела тексту: `session.append` з `door: 'delivery'`, `name: 'queued_command'` (відрендерений текст, обидва хости) і `prompt.submit` з `turnId` (сирий текст); транскрипт — запасне джерело.
- Якір доставки — попередній рядок `tool_result` (у порядку `session.append` і за `parentUuid` у транскрипті).
- Рядок з `handle` тягне за собою свої вкладення; рядок без `handle` — ні.
- `{ as: 'api' }` доставок не показує, тож і засів передачі їх не має.
- `classic.*` хуки модуля в цьому середовищі перехоплює вбудований `cc-plugin-sec-default` — `transcript_path` звідти не взяти.

**Recommendations for the concept:**
- **Концепт:** доставки хоста (`queued_command`) — частина розмови, яку редактор зберігає так само, як рядки людини: незмінений відрізок після apply має містити їх у тому ж місці. Розширити C_CTX_DEC про рядки людини: доставки від людини (`origin` `human`/`composer`/`unclassified`) — як повідомлення людини; звіти субагентів і сповіщення — як результати, які агент може згорнути.
- **Специфікація (R1 + R2):**
  - Спостерігач `session.append` (`door=delivery`, `name=queued_command`) пише в теку сесії `deliveries.json`: `{ uuid, anchor: tool_use_id попереднього tool_result, origin, text }`.
  - `context_list` показує доставки як підрядки рядка-якоря (`#N+q1 delivery (person|subagent|task): …`), щоб агент бачив їх і міг згорнути разом з відрізком; попередження про рядки людини (SP фази 17) поширити на доставки від людини.
  - Apply: для кожного рядка-якоря, перезібраного без `handle`, вставити одразу після нього рядок `user` з текстом доставки; рядок-якір з `handle` (медіа, поза вікном API) — нічого не вставляти (хост копіює сам, інакше дубль); якір усередині згортання — доставка зникає разом з відрізком, у звіті: «N доставок згорнуто».
  - Запасне джерело, коли `deliveries.json` не має записів для поточної розмови (форк, `--resume` старої сесії): транскрипт `~/.claude/projects/<cwd>/<sid>.jsonl`, записи `queued_command` після останнього `compact_boundary`; якщо читання не вдалося — попередження у звіті (W).
  - Після вставки доставка стає рядком; `personRow()` має розпізнавати такі рядки (`<system-reminder>\nThe user sent a new message while you were working:`) як повідомлення людини, а не промпт з `<system-reminder>`.
  - Передача: ті самі вставки в засів.
- **Беклог:** перевірити `--resume` після вставки; перевірити, чи `prompt.submit` з `turnId` потрібен як друге джерело (у `-p` без `session.append`-копій).

**Artifacts to keep:**
- Плагін і сценарії в `.dev_flow/cache/attach-spike/` (перенесено зі scratchpad сесії `decd4bc6…`): `aprobe/` (режими `same`, `plain-results`, `plain-results-inject`, `plain-results-transcript`, `inject`, `inject-end`; директиви `##cmp:<mode>##`, `##api##`), `sj.sh` (драйвер stream-json через fifo), `scen1.sh` (повідомлення посеред ходу), `scen2.sh` (фоновий `Bash` і субагент), `scen3.sh` (доставка, `--resume`, відновлення з транскрипту), `queued.jq` (витяг доставок з транскрипту з якорем).

**Artifacts to discard:**
- Журнали й дампи (`log.txt`, `api-*`, `rows-after-*`, `compact-in-*`, `run-*/`, `sj-*/`) і тестові транскрипти в `~/.claude/projects/-tmp-claude-1000-…-attach-spike-work/`.
