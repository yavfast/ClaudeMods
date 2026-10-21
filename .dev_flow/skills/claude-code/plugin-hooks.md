---
skill: ClaudeCodePluginHooks
domain: claude-code
topics: [hooks, session.compact, session.append, prompt.submit, tool.list, process.run, fs, resume, tests, command.run, transcript, headless, stream-json, vscode, prompt-cache, install, prompt.attachment, thinking, auto-mode]
source: implementation
updated: 2026-10-17
kind: procedural
promotion: candidate
written_against: Claude Code 2.1.296
state: stale
---

# Моди Claude Code: поведінка хоста, яку треба знати

Вхідний файл навички: межі застосування, ключові поняття і покажчик пасток хоста. Самі пастки (75 пунктів) лежать у п'яти тематичних файлах цієї теки з тими самими номерами; посилання «plugin-hooks N» знаходить пункт через таблицю в [Pitfalls](#pitfalls). Перед будь-якою зміною хуків у `mods/` — відкрити тематичний файл за темою зміни.

## Contents

- [Applicability Boundary](#applicability-boundary) — коли застосовувати і на яких версіях хоста перевірено пункти
- [Context](#context) — звідки взялися пункти
- [Key Concepts](#key-concepts) — форма хука, валідатор, `.catch`, тести, типи
- [Usage in This Project](#usage-in-this-project) — де в `context-editor` застосовано компактизацію, команди і живі прогони
- [Pitfalls](#pitfalls) — покажчик пунктів 1–76 (поведінка хоста, знайдена наживо; 69–70 — з документації, 75 — з бінарника, наживо не перевірено) → тематичні файли:
  - [plugin-hooks-api.md](plugin-hooks-api.md) — Базові API плагіна: модуль, `$.fs`, `$.process`, `$.tool`, `.catch`, ідентичність процесу, перезавантаження, підключення
  - [plugin-hooks-commands.md](plugin-hooks-commands.md) — Команди, ходи й промпти плагіна: `$.command.run`, неінтерактивний хост, події ходу, `$.prompt.submit`, `$.ui.log`
  - [plugin-hooks-compaction.md](plugin-hooks-compaction.md) — Компактизація від обробника, `handle`, злиття за `message.id`, `--resume` і ремонт
  - [plugin-hooks-views.md](plugin-hooks-views.md) — Подання розмови: `$.session.messages()`, `{ as: 'api' }`, `e.messages`, вікна, медіа, вкладення, доставки, рядки `isMeta`
  - [plugin-hooks-context.md](plugin-hooks-context.md) — Розмір контексту, кеш промпту, thinking, субагенти й класифікатор авто-режиму
- [References](#references) — типи хоста, задача з раундами рев'ю

## Applicability Boundary

- **when_to_use:** пишете або змінюєте мод у `mods/` — хуки подій, виклики `$`, тести, живі сценарії.
- **when_not:** класичні хуки `settings.json` (команди оболонки) — інший механізм.
- **version_or_context_scope:** Claude Code ≥ 2.1.295 — старіші версії не підтримуються (рішення розробника 2026-10-09); пункти 1–15 перевірено на 2.1.294, 16–36 — на 2.1.295, інтерактивно й у stream-json; 37–38 — на 2.1.295 лише в stream-json, 39 — у `claude -p`, 40–42 — живі прогони фази 14, 43–45 — спайк вкладень (обидва хости), 46 — проба фази 15 (stream-json); 47–52 — спайк медіа в промптах на 2.1.296 (обидва хости, `docs/context_editor_media.spike.md`); 53–55 — спайк кешу промпту на 2.1.296 (`docs/context_editor_cache.spike.md`, проксі-журнал запитів); 56 — підключення мода до живої сесії у VS Code на 2.1.296 (частина (а) перевірено наживо, (б) — за документацією); 59 — спайк вкладень хоста на 2.1.296 (обидва хости, `docs/context_editor_host_attachments.spike.md`); 60 — живий прогін фази 25 PL_CTX на 2.1.296 (обидва хости); 61 — спайк авторства на 2.1.296 (stream-json і термінал, `docs/context_editor_authorship.spike.md`); 62 — проба `$.ui.log` і живий прогін фази 28 PL_CTX на 2.1.296 (термінал з `--resume`, stream-json; у VS Code — спостереження людини 2026-10-12); після оновлення хоста факти нижче перевірити заново (типи в `.claude-plugin/types/claude-code/index.d.ts`).
- **promotion scope:** `candidate` — підтверджено одним модом (`context-editor`).

## Context

Типи хоста описують контракти, але кілька важливих поведінок видно лише наживо. Кожен пункт нижче коштував раунду налагодження або рев'ю в задачі `task_C_CTX`.

## Key Concepts

- **Хук — `($, e, next)`.** Без виклику `next` хук відповідає сам; `next({...e, x})` переписує вхід. Модуль не має Node і DOM — усе через `$`.
- **Валідатор модуля** (`claude plugin validate`) вимагає, щоб `$` передавався лише у функції, оголошені на верхньому рівні того самого файлу; замикання всередині хука можуть викликати `$.x.y()`. Шаблони `tool.call` з `${...}` у матчері дають `tool=?` — матчер пишіть рядковим літералом. Одну подію модуль може зареєструвати без матчера лише раз: два `on('session.compact', …)` без матчера валідатор відкидає («registered twice without a matcher») — об'єднуйте їх в одному хуку (перевірено на 2.1.295).
- **Хуки, що можуть відмовити** (`tool.call`, `prompt.submit`, `session.compact`, …), мають мати `.catch`; без нього збій хука пропускається і подія йде далі, як без хука.
- **Тести** — `claude plugin test <mod>`, файли `tests/*.test.ts`, набір `claude-code/testing`. Імітувати весь `$` дорого: логіку виносимо за порти (див. `QueueIO`, `CompactionIO`, `FlushIO`, `HandoffIO`) і тестуємо як чисті функції.
- **Типи без глобального `tsc`:** `npx -p typescript@5.6.3 tsc -p <tsconfig>` з типами з `.claude-plugin/types/` (генеруються хостом при завантаженні мода).

## Usage in This Project

- Застосування правок контексту через `session.compact`: `mods/context-editor/hooks/compaction.ts`, зв'язування — `mods/context-editor/hooks/register.ts`.
- Запуск компактизації командою `$.command.run({ command: 'compact', args: MARKER })` з відкладеної дії після `turn.complete` у тому самому плагіні: `mods/context-editor/hooks/flush.ts`; засів очищеної сесії (`/clear`, потім `/compact` з HANDOFF_MARKER): `mods/context-editor/hooks/handoff.ts`.
- Живий прогін: окремий `claude --plugin-dir …` у tmux (скрипт-драйвер у scratchpad сесії), журнал — `claude --debug`, `~/.claude/debug/<session>.txt`.

## Pitfalls

Покажчик (поділ 2026-10-17): номер пункту → тематичний файл і якір. Номери не змінюються; новий пункт отримує наступний номер (76, …), додається в тематичний файл за темою і рядком у цю таблицю.

| № | Пункт (заголовок) | Файл |
|---|-------------------|------|
| 1 | Плагін не бачить власної компактизації `$.session.compact()`. | [plugin-hooks-compaction.md#p1](plugin-hooks-compaction.md#p1) |
| 2 | Не чекати `$.prompt.submit` у хуку `session.compact`. | [plugin-hooks-compaction.md#p2](plugin-hooks-compaction.md#p2) |
| 3 | Відмова промпту — це `{ drop }`, а не виняток. | [plugin-hooks-commands.md#p3](plugin-hooks-commands.md#p3) |
| 4 | `session.compact` можна лише між ходами | [plugin-hooks-compaction.md#p4](plugin-hooks-compaction.md#p4) |
| 5 | Рядки, повернуті з `handle`, після межі компактизації посилаються на старі батьківські рядки. | [plugin-hooks-compaction.md#p5](plugin-hooks-compaction.md#p5) |
| 6 | Рядок без `handle` хост будує лише з тексту і блоків інструментів | [plugin-hooks-compaction.md#p6](plugin-hooks-compaction.md#p6) |
| 7 | `--resume` і компактизація від обробника (2.1.295). | [plugin-hooks-compaction.md#p7](plugin-hooks-compaction.md#p7) |
| 8 | `/clear` і `/resume` у тому самому процесі змінюють `session_id` без `session.start` | [plugin-hooks-commands.md#p8](plugin-hooks-commands.md#p8) |
| 9 | `$.fs.write` і `$.fs.read` мають межу 4 MiB | [plugin-hooks-api.md#p9](plugin-hooks-api.md#p9) |
| 10 | `$.session.messages()` і `{ as: 'api' }` | [plugin-hooks-views.md#p10](plugin-hooks-views.md#p10) |
| 11 | `$.tool.list()` | [plugin-hooks-api.md#p11](plugin-hooks-api.md#p11) |
| 12 | `.catch` має бюджет ~1 с | [plugin-hooks-api.md#p12](plugin-hooks-api.md#p12) |
| 13 | `$.session.messages()` повертає весь транскрипт, разом з рядками до межі компактизації | [plugin-hooks-views.md#p13](plugin-hooks-views.md#p13) |
| 14 | `$.tool.register` обрізає `description` до 2048 символів | [plugin-hooks-api.md#p14](plugin-hooks-api.md#p14) |
| 15 | Медіа від вбудованого Read не буває великим | [plugin-hooks-views.md#p15](plugin-hooks-views.md#p15) |
| 16 | `$.command.run` запускає вбудовані `/resume <id>` і `/clear` | [plugin-hooks-commands.md#p16](plugin-hooks-commands.md#p16) |
| 17 | Транскрипт сесії — `~/.claude/projects/<cwd з не-буквено-цифровими символами → '-'>/<id>.jsonl`, API для шляху немає. | [plugin-hooks-views.md#p17](plugin-hooks-views.md#p17) |
| 18 | Неінтерактивний хост (VS Code, SDK, `-p`) — інший набір можливостей. | [plugin-hooks-commands.md#p18](plugin-hooks-commands.md#p18) |
| 19 | `$.command.run({ command: 'compact', args })` — компактизація, що працює всюди | [plugin-hooks-compaction.md#p19](plugin-hooks-compaction.md#p19) |
| 20 | Засів очищеної сесії компактизацією. | [plugin-hooks-compaction.md#p20](plugin-hooks-compaction.md#p20) |
| 21 | Після вбудованої `/compact` | [plugin-hooks-compaction.md#p21](plugin-hooks-compaction.md#p21) |
| 22 | Команди, які запускає плагін (`$.command.run`), не породжують подій ходу | [plugin-hooks-commands.md#p22](plugin-hooks-commands.md#p22) |
| 23 | Черга команди залежить від походження таймера, а не від моменту виклику. | [plugin-hooks-commands.md#p23](plugin-hooks-commands.md#p23) |
| 24 | Рядки команди плагіна в TUI оминають `session.append` | [plugin-hooks-compaction.md#p24](plugin-hooks-compaction.md#p24) |
| 25 | Власні хуки `prompt.submit` плагіна пропускаються для промптів, які він надсилає сам | [plugin-hooks-commands.md#p25](plugin-hooks-commands.md#p25) |
| 26 | У stream-json `command.run('compact')` завершується до того, як повернені рядки потрапляють у `$.session.messages()` | [plugin-hooks-compaction.md#p26](plugin-hooks-compaction.md#p26) |
| 27 | У stream-json промпт людини проходить `session.append` з `origin` `unclassified` | [plugin-hooks-commands.md#p27](plugin-hooks-commands.md#p27) |
| 28 | `$.model.fork` дає форкнутому агенту інструменти | [plugin-hooks-api.md#p28](plugin-hooks-api.md#p28) |
| 29 | Після `--resume` сесії з вбудованою `/compact` `$.session.messages()` починається з рядка-підсумку | [plugin-hooks-compaction.md#p29](plugin-hooks-compaction.md#p29) |
| 30 | Хост зливає рядки асистента з однаковим `message.id` (одна відповідь моделі) при побудові запиту — навіть через рядки з іншим id. | [plugin-hooks-compaction.md#p30](plugin-hooks-compaction.md#p30) |
| 31 | Гаряче перезавантаження модуля — лише в терміналі й лише за зміни вмісту файлу | [plugin-hooks-api.md#p31](plugin-hooks-api.md#p31) |
| 32 | Ідентичність процесу хоста | [plugin-hooks-api.md#p32](plugin-hooks-api.md#p32) |
| 33 | Очищення старих результатів хостом | [plugin-hooks-context.md#p33](plugin-hooks-context.md#p33) |
| 34 | Один модуль хуків на плагін | [plugin-hooks-api.md#p34](plugin-hooks-api.md#p34) |
| 35 | Хук `session.compact`, що відповідає без `next`, ховає подію від плагінів, завантажених після нього | [plugin-hooks-compaction.md#p35](plugin-hooks-compaction.md#p35) |
| 36 | Модель з thinking пише одну відповідь кількома рядками з тим самим `message.id`: рядок лише з thinking, далі рядок з `tool_use`. | [plugin-hooks-compaction.md#p36](plugin-hooks-compaction.md#p36) |
| 37 | Розмір рядків розмови без незмінної частини | [plugin-hooks-context.md#p37](plugin-hooks-context.md#p37) |
| 38 | Промпт розширення після кінця ходу без команди | [plugin-hooks-commands.md#p38](plugin-hooks-commands.md#p38) |
| 39 | Плагін з function hooks може мати власні навички | [plugin-hooks-api.md#p39](plugin-hooks-api.md#p39) |
| 40 | Паралельні виклики — окремі рядки, перезібрані рядки — окремі повідомлення | [plugin-hooks-compaction.md#p40](plugin-hooks-compaction.md#p40) |
| 41 | Розбивка контексту одразу після `/compact` хоста | [plugin-hooks-context.md#p41](plugin-hooks-context.md#p41) |
| 42 | Живі прогони: закріплюйте версію хоста. | [plugin-hooks-api.md#p42](plugin-hooks-api.md#p42) |
| 43 | Доставки посеред ходу — вкладення `queued_command`, а не рядки | [plugin-hooks-views.md#p43](plugin-hooks-views.md#p43) |
| 44 | Обробник компактизації переносить вкладення лише разом з рядком з `handle`. | [plugin-hooks-compaction.md#p44](plugin-hooks-compaction.md#p44) |
| 45 | Хуки `classic.*` у модулі можуть не отримати подію | [plugin-hooks-api.md#p45](plugin-hooks-api.md#p45) |
| 46 | Текст навички, відкритої `Skill`, — не рядок розмови | [plugin-hooks-views.md#p46](plugin-hooks-views.md#p46) |
| 47 | Промпт людини з медіа в трьох поданнях | [plugin-hooks-views.md#p47](plugin-hooks-views.md#p47) |
| 48 | API-повідомлення `user` = відрізок суміжних рядків `user`, але не завжди. | [plugin-hooks-views.md#p48](plugin-hooks-views.md#p48) |
| 49 | Межі вікон | [plugin-hooks-views.md#p49](plugin-hooks-views.md#p49) |
| 50 | Термінал: під час компактизації `$.session.messages()` і `{ as: 'api' }` закінчуються рядком промпту `/compact <args>` | [plugin-hooks-views.md#p50](plugin-hooks-views.md#p50) |
| 51 | У stream-json компактизація від обробника дає подію `result` з порожнім `result` | [plugin-hooks-commands.md#p51](plugin-hooks-commands.md#p51) |
| 52 | Посеред ходу (хук `tool.call`) `$.session.messages()` і `{ as: 'api' }` уже мають рядок поточного виклику | [plugin-hooks-views.md#p52](plugin-hooks-views.md#p52) |
| 53 | Будова запиту головної розмови і мітки кешу | [plugin-hooks-context.md#p53](plugin-hooks-context.md#p53) |
| 54 | Компактизація від обробника сама кешу не скидає | [plugin-hooks-context.md#p54](plugin-hooks-context.md#p54) |
| 55 | Після apply кеш читається лише до ~20 позицій перед новими мітками | [plugin-hooks-context.md#p55](plugin-hooks-context.md#p55) |
| 56 | Підключити мод до вже запущеної сесії | [plugin-hooks-api.md#p56](plugin-hooks-api.md#p56) |
| 57 | Хост обгортає кожен промпт, який надсилає плагін | [plugin-hooks-commands.md#p57](plugin-hooks-commands.md#p57) |
| 58 | `$.process.run`, схоже, обривається хостом за ~30 с | [plugin-hooks-api.md#p58](plugin-hooks-api.md#p58) |
| 59 | `prompt.attachment`: коли хост питає вкладення і що дає відповідь | [plugin-hooks-views.md#p59](plugin-hooks-views.md#p59) |
| 60 | Хук `command.run` на вбудовану `/compact` | [plugin-hooks-commands.md#p60](plugin-hooks-commands.md#p60) |
| 61 | Вставлений рядок асистента і збережені пари в поверненні обробника `session.compact` | [plugin-hooks-compaction.md#p61](plugin-hooks-compaction.md#p61) |
| 62 | `$.ui.log`: рядок для людини поза контекстом моделі | [plugin-hooks-commands.md#p62](plugin-hooks-commands.md#p62) |
| 63 | `--resume` вставляє рядки асистента всього файлу з тим самим `message.id`, не зважаючи на межу | [plugin-hooks-compaction.md#p63](plugin-hooks-compaction.md#p63) |
| 64 | Копія `tool_result`, повернена з `handle`, — єдина копія з батьком до межі; рядок з `handle` = оригінал, лише якщо не змінений | [plugin-hooks-compaction.md#p64](plugin-hooks-compaction.md#p64) |
| 65 | Чисте відновлення і ремонт | [plugin-hooks-compaction.md#p65](plugin-hooks-compaction.md#p65) |
| 66 | ToolSearch і перебудований результат | [plugin-hooks-compaction.md#p66](plugin-hooks-compaction.md#p66) |
| 67 | Субагенти: що плагін може з їхнім контекстом | [plugin-hooks-context.md#p67](plugin-hooks-context.md#p67) |
| 68 | `Read` поза робочим каталогом і `tool.check` | [plugin-hooks-api.md#p68](plugin-hooks-api.md#p68) |
| 69 | Thinking-блоки прив'язані до префікса розмови | [plugin-hooks-context.md#p69](plugin-hooks-context.md#p69) |
| 70 | Класифікатор авто-режиму бачить лише повідомлення людини й виклики інструментів | [plugin-hooks-context.md#p70](plugin-hooks-context.md#p70) |
| 71 | `$.prompt.submit` — повідомлення плагіна, а не людини | [plugin-hooks-commands.md#p71](plugin-hooks-commands.md#p71) |
| 72 | `$.session.messages()` не повертає рядків `isMeta` | [plugin-hooks-views.md#p72](plugin-hooks-views.md#p72) |
| 73 | Вставлений текст — у самому тексті рядка, в обгортці `<pasted_content id="X">…</pasted_content id="X">` | [plugin-hooks-views.md#p73](plugin-hooks-views.md#p73) |
| 74 | Thinking після правки посередині: недокументована поведінка хоста — лише спостереження, не основа дизайну | [plugin-hooks-context.md#p74](plugin-hooks-context.md#p74) |
| 75 | Повторне `Read` незміненого файлу — заглушка, а не вміст | [plugin-hooks-views.md#p75](plugin-hooks-views.md#p75) |
| 76 | `$.session.cwd()` іде за `cd` оболонки, `$.session.root()` — ні | [plugin-hooks-api.md#p76](plugin-hooks-api.md#p76) |

## References

- Типи хоста: `.claude-plugin/types/claude-code/index.d.ts` у теці мода (або bundled-копія навички `plugin-authoring`).
- Задача й раунди рев'ю: `.dev_flow/tasks/task_C_CTX.md`.

## Structural events

- 2026-10-17 — поділ: 7760 слів > `full_read_limit` 4000; пункти 1–75 дослівно перенесено в `plugin-hooks-{api,commands,compaction,views,context}.md` з тими самими номерами (якорі `#p<N>`), тут лишились межі, поняття, покажчик (audit 2026-10-17, `claude-session-c265a77e`).
