---
skill: ClaudeCodePluginHooksCommands
domain: claude-code
topics: [command.run, clear, resume, headless, stream-json, vscode, turn.complete, prompt.submit, ui.log, ui.notify]
source: implementation
updated: 2026-10-17
kind: procedural
promotion: candidate
written_against: Claude Code 2.1.296
state: stale
---

# Моди Claude Code: команди, ходи й промпти плагіна: `$.command.run`, неінтерактивний хост, події ходу, `$.prompt.submit`, `$.ui.log`

Тематичний файл навички [ClaudeCodePluginHooks](plugin-hooks.md): пункти 3, 8, 16, 18, 22, 23, 25, 27, 38, 51, 57, 60, 62, 71 її списку пасток, дослівно і з тими самими номерами (якір `#p<N>`), тож посилання «plugin-hooks N» / «навичка, пункт N» ведуть сюди через [покажчик](plugin-hooks.md#pitfalls). Посилання «пункт N» у тексті — на номер у тому самому списку, хоч би в якому тематичному файлі він лежав.

## Applicability Boundary

- **when_to_use:** пишете або змінюєте мод у `mods/` і зачіпаєте цю тему (команди, ходи й промпти плагіна).
- **when_not:** класичні хуки `settings.json` (команди оболонки) — інший механізм.
- **version_or_context_scope:** версії хоста, на яких перевірено кожен пункт, — у [вхідному файлі](plugin-hooks.md#applicability-boundary); `state: stale` — на встановленому хості 2.1.299 і хості VS Code 2.1.301 пункти не перезвірено (рішення про перезвірку наживо — за розробником).

## Pitfalls

<a id="p3"></a>
3. **Відмова промпту — це `{ drop }`, а не виняток.** І `next(e)` у `prompt.submit`, і `$.prompt.submit` резолвляться з `drop`; перевіряйте поле.

<a id="p8"></a>
8. **`/clear` і `/resume` у тому самому процесі змінюють `session_id` без `session.start`** — стан, прив'язаний до сесії, перевіряйте перед кожною операцією.

<a id="p16"></a>
16. **`$.command.run` запускає вбудовані `/resume <id>` і `/clear`** (`/resume` — лише в інтерактивному хості, див. 18) — з відкладеної дії після `turn.complete` (`$.clock.after`), не з хука, якого чекає хід (хост відхиляє з поясненням). За типами хоста команда стає в чергу і виконується, коли сесія вільна: виклик посеред ходу чекає його кінця, а відмова (невідома команда, хук, якого чекає хід) остаточна. Перемикання дає `session.end` з `reason`, але не `session.start`; невдалий `resume` (невідомий id) резолвиться `{}` без помилки — успіх перевіряйте за `$.session.id()` до і після. Перевірено на 2.1.295.

<a id="p18"></a>
18. **Неінтерактивний хост (VS Code, SDK, `-p`) — інший набір можливостей.** VS Code запускає `claude --input-format stream-json --output-format stream-json`. Там `/resume` немає в `$.command.list()` (`local-jsx` без `supportsNonInteractive`), і `$.command.run({ command: 'resume' })` відхиляється: «no command named /resume in this session»; `clear` і `compact` є. `$.session.compact` відхиляється завжди: «not available in a headless (-p / SDK) session yet …». У звичайному `claude -p "<prompt>"` після останнього ходу будь-який `$.command.*` дає «no session is bound in this process». Перевірено на 2.1.289 і 2.1.295.

<a id="p22"></a>
22. **Команди, які запускає плагін (`$.command.run`), не породжують подій ходу** — ні `prompt.submit`, ні `turn.start`/`turn.complete`, для `/clear` і `/compact` в обох хостах; `command.run('compact')` завершується після відповіді обробника, `command.run('clear')` — коли `$.session.id()` уже новий. Лічильник ходів людини від них не зсувається. Перевірено на 2.1.295.

<a id="p23"></a>
23. **Черга команди залежить від походження таймера, а не від моменту виклику.** Таймер, створений у хуку `tool.call`, хост відхиляє і через секунди («called from a tool.call hook…»); з опитувача, запущеного в `session.start`, команда стає в чергу і виконується після кінця поточного ходу (перевірено наживо); для таймера з паузи після `turn.complete` те саме випливає з типів хоста («queued and run once the session is idle»), наживо посеред ходу ще не спостерігалось. Повідомлення людини посеред ходу вливається в цей хід (`prompt.submit` з `turnId` ходу), окремого ходу немає. Перевірено на 2.1.295.

<a id="p25"></a>
25. **Власні хуки `prompt.submit` плагіна пропускаються для промптів, які він надсилає сам** (`$.prompt.submit`; у журналі «prompt.submit skipped: re-entry (the plugin's own code raised it)»). Один плагін не може додати контекст до власного промпту через свій же хук — текст треба класти в сам промпт. Перевірено на 2.1.295.

<a id="p27"></a>
27. **У stream-json промпт людини проходить `session.append` з `origin` `unclassified`**, не `sdk` (у TUI — `composer`). Правила «це рядок людини» мають враховувати обидва. Перевірено на 2.1.295.

<a id="p38"></a>
38. **Промпт розширення після кінця ходу без команди** (2.1.295, проба в неінтерактивному хості з потоковим входом 2026-10-10): у `turn.complete` поле `e.answer` — фінальний текст ходу; `$.prompt.submit({ text })` з `$.clock.after(300, …)`, запланованого в `turn.complete`, без жодної `$.command.run` перед ним, запускає новий хід (результат `{ text, origin: { kind: 'plugin', … } }`, далі звичайні події ходу). В інтерактивному терміналі не перевірялось.

<a id="p51"></a>
51. **У stream-json компактизація від обробника дає подію `result` з порожнім `result`** (успіх; відмова `{skip}` — «Not compacted», пункт 19). Драйвер живого прогону, що чекає ходів за лічильником `result`, після такої компактизації збивається на одиницю — чекайте маркер проби або перелічуйте `result` заново (2.1.296).

<a id="p57"></a>
57. **Хост обгортає кожен промпт, який надсилає плагін** (2.1.296, термінал, живий прогін PL_AUD_CTX_P5, `.dev_flow/cache/live-test/audit-p5-results.md`). Рядок `user` у транскрипті й у запиті має вигляд `The <plugin> plugin sent a message:\n<текст>\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.` Плагін цієї рамки не контролює, а її хвіст «in the user's place» штовхає модель називати вміст «your message»: текст моделі, який плагін повертає промптом, мусить сам казати свого автора всередині рамки (SP_CTX_DEC_17, CF-8). Хост так само закриває вставлений людиною текст тегом з атрибутом: `<pasted_content id="7dd3">…</pasted_content id="7dd3">` — розбір закривальних тегів не може шукати лише `</name>`.

<a id="p60"></a>
60. **Хук `command.run` на вбудовану `/compact`** (2.1.296, термінал і stream-json, haiku і sonnet, живий прогін фази 25 PL_CTX, `.dev_flow/cache/live-test/phase25-results.md`). (а) Хук `{ command: 'compact' }`, що відповідає `{ text }` без `next`, зупиняє вбудовану команду: у журналі `<plugin> (user) answered command.run without next() in 2.9ms; nothing beneath it ran for this dispatch`, компактизації і `session.compact` немає. `text` хост пише виводом команди `<local-command-stdout><plugins>: <text></local-command-stdout>` під назвами всіх плагінів, що чіпляють команду (`context-editor+cc-plugin-agents-md: …`); модель бачить і його. (б) Власний `$.command.run({ command: 'compact', args })` плагіна його ж хук `command.run` **пропускає**: `command.run skipped: re-entry (the plugin's own code raised it; origin <plugin>)` — далі працює лише `.catch` з `next.error.kind === 're-entry'` і `called = false`, і він мусить викликати `next(e)`, інакше плагін заблокує власну компактизацію; `session.compact` того самого плагіна при цьому викликається (пункт 19). (в) `next({ ...e, args: '' })` дає стандартний підсумок хоста з порожніми аргументами в рядку команди. (г) `/compact`, набрана посеред ходу, чекає його кінця: хук спрацьовує ~80 мс після `turn.complete`; `$.prompt.submit` з `$.clock.after`, запланованого в цьому хуку, входить через ~0,3 с новим ходом. (ґ) Різниця хостів: у stream-json рядки `/compact` людини і виводу хука лишаються серед рядків розмови після компактизації від обробника, у терміналі їх у перебудованих рядках немає (командні рядки термінала оминають `session.append`, пункт 24). (д) `/compact` повідомленням `user` у stream-json проходить той самий хук `command.run`.

<a id="p62"></a>
62. **`$.ui.log`: рядок для людини поза контекстом моделі** (2.1.296, термінал з `--resume` і stream-json, haiku, проксі-журнал тіл запитів; проба `.dev_flow/cache/live-test/ui-log-probe-results.md`). (а) Термінал: окремий сірий рядок `● <plugin>: <text>` у стрічці (ANSI 38;5;246), одразу після рядка ходу; у JSONL сесії — `{"type":"system","subtype":"informational","content":"<plugin>: <text>","level":"notice","isMeta":false,…}` у ланцюжку `parentUuid`, тож після `--resume` у новому процесі рядок на своєму місці. (б) Модель його не бачить ні наживо, ні після відновлення: у тілах запитів немає ні тексту, ні назви плагіна. (в) stream-json: подія `{"type":"system","subtype":"ui_log","plugin":"<plugin>","text":"<text>",…}` у потоці (з `turn.complete` — після `result` ходу), але в JSONL сесії рядок **не пишеться** — після відновлення такої сесії (VS Code, `--resume`) його немає; розширення VS Code (2.1.296, сесія d5614704, 2026-10-12) `ui_log` **не малює**: після застосування людина бачила в чаті лише промпт плагіна (звіт і продовження в обгортці «The context-editor plugin sent a message: …»), рядка `applied N edit(s): conversation ~A → ~B tokens` не було. Тож у VS Code звіт застосування людина бачить через сам промпт, а `$.ui.log` — канал лише термінала. Проба всіх каналів (мод `mods/ui-probe`, 2026-10-12): у VS Code не видно й `toast`, `status`, `notice`; видно лише `$.ui.notify` — спливне сповіщення VS Code знизу праворуч, і з таймера після кінця ходу, хоча виклик повертає `{ isSent: false, reason: 'no-surface' }` (результат `notify` у VS Code не означає, що людина не бачила). (г) `$.ui.log(text, { to: 'debug' })` — лише журнал `--debug`, ні екрана, ні JSONL, ні потоку; звичайний `$.ui.log` теж іде в журнал (`[<plugin>] $.ui.log: …`). (ґ) Для порівняння: `$.ui.toast` — рамка в правому верхньому куті, зникає (stream-json: `system`/`ui_toast` з `timeout_ms` 4000); `$.ui.status` — рядок під полем вводу до наступного виклику, після `--resume` не повертається (stream-json: `system`/`ui_status`); обидва — поза JSONL і запитом. Мод пише рядок застосування з відкладеної дії Flush після команди `/compact`, а не з обробника `session.compact`: так рядок лягає після компактизації (SP_CTX_02_43). Живий прогін фази 28 (`.dev_flow/cache/live-test/phase28-results.md`): у терміналі рядок стоїть під `⎿ Compacted`, після `--resume` — на місці (у JSONL перше застосування дало рядок двічі з тим самим timestamp: друге застосування переписало його копію, на екрані — по разу); 27 тіл запитів без нього; stream-json — подія `ui_log` у 17/17 сесій, одна на застосування, після `ui_toast` і перед `result` команди `/compact`.

<a id="p71"></a>
71. **`$.prompt.submit` — повідомлення плагіна, а не людини** (типи хоста `index.d.ts` ≈8970–8988 і ≈9019–9034; транскрипт сесії 355660b2, VS Code, хост 2.1.296; бандл 2.1.299, читано 2026-10-15). Без `asUser` модель читає промпт під рамкою хоста: між ходами — «The <name> plugin sent a message:» і речення «This is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.», посеред ходу — «The <name> plugin sent a message while you were working:». Транскрипт пише рядок `type: user` з `origin: {kind: 'plugin', name}` і рамкою в тексті. `asUser: true` подає текст голим, як слова людини, але походження для кожного хука й перевірки походження хоста лишається плагіновим; `@file` і вставлені зображення в промпті плагіна не розгортаються. Бандл 2.1.299 ділить рядки на `person` і `machine`: рядок плагіна без `asUser` — `machine`. Чи зважає на це класифікатор авто-режиму (пункт 70), не перевірено. Для мода: промпт продовження Flush, звіти й документ передачі йдуть без `asUser`, тож модель бачить їх як повідомлення плагіна; першим промптом нової сесії документ не потрапляє під автопін R1 (той пінить лише людські походження `composer`, `bridge`, `sdk`, `unclassified`), тож пін документа — окремий механізм (C_CTX_DEC_36).

## Structural events

- 2026-10-17 — створено поділом `plugin-hooks.md` (7760 слів > `full_read_limit` 4000): пункти перенесено дослівно, номери збережено (audit 2026-10-17, `claude-session-c265a77e`).
