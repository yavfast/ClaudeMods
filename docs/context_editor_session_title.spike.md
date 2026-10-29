# Spike: заголовок сесії за поточною темою задачі

> **Status:** concluded
> **Created:** 2026-10-29
> **Updated:** 2026-10-29
> **Author:** агент сесії 72a009d8
> **Time-box:** 1 сесія
> **Scope:** codebase (типи хоста, бандл хоста 2.1.312, бандл розширення VS Code 2.1.312) + prototype (плагін-зонд без мережі)
> **Mode:** single
>
> **Target concept:** [C_CTX_03_12](./context_editor.methods.concept.md#C_CTX_03_12) — заголовок сесії (DEC_41–DEC_44)
> **Serves:** —
> **Question(s):** Q1. Чи може плагін змінити заголовок сесії через `$.command.run({ command: 'rename' })` у терміналі й у stream-json (VS Code)? Q2. Які рядки при цьому додаються в розмову і що з них бачить модель? Q3. Чи доходить новий заголовок до людини (термінал, список сесій, вкладка VS Code) і чи можна відрізнити `/rename` людини від мода?
> **Evidence:** `.dev_flow/cache/live-test/title-probe/` (git-ignored): `probe/` — плагін-зонд `title-probe`, `run-sj.sh` — запуск хоста stream-json без мережі, `runs/` — журнали зонда (`sj-title-probe.json`, `terminal-title-probe.json`), вивід stream-json (`sj-out.jsonl`, `sj-rename-noargs-out.jsonl`) і транскрипт (`sj-transcript.jsonl`).

## Context

Розробник 2026-10-29 (`/dev-flow ask`): «Чи можна автоматично змінювати заголовок сесії при зміні поточної теми завдання?» У типах хоста (`.claude-plugin/types/claude-code/index.d.ts`, 2.1.312) немає ні читання, ні запису заголовка сесії: `title` там є лише в панелей `$.ui.open` і в `$.ui.notify`. Власний автоматичний заголовок хоста (`ai-title`) генерується один раз із першого промпту і за темою не йде. Лишався один шлях — вбудована команда `/rename` через `$.command.run`; невідомо було, чи вона доступна плагіну в обох хостах і чим платить розмова.

## Exploration Log

### Entry 1 — 2026-10-29 — статичний розбір хоста 2.1.312

**What was tried / researched:** типи хоста; рядки бандла `~/.local/share/claude/versions/2.1.312`; записи транскриптів `~/.claude/projects/*/*.jsonl`.

**Findings:**
- `/rename [name]` (аліас `/name`) — вбудована команда у двох варіантах: `local-jsx` з `requires: { ink }` і `immediate` (термінал) та `local` з `supportsNonInteractive` (stream-json, VS Code).
- Заголовок живе в транскрипті як запис `{"type":"custom-title","customTitle":…}`; `/rename` пише ще `{"type":"agent-name","agentName":…}`. Автоматичний заголовок хоста — запис `ai-title` (у транскриптах цієї машини ≈6000 таких записів).
- Порядок відображення в хості: `agentName || customTitle || aiTitle || summary || firstPrompt`. Генерацію `ai-title` хост пропускає, коли сесія вже має власний заголовок.
- `ai-title` хост генерує з перших ≤1000 символів першого промпту, один раз на сесію.
- `/rename` без аргументу генерує назву окремим викликом моделі-помічника без інструментів (`querySource: "rename_generate_name"`, JSON-схема `{ name }`) з розмови.
- Назва унікальна серед живих сесій машини: при збігу хост додає суфікс і пише «Another live session on this machine goes by …».

### Entry 2 — 2026-10-29 — зонд у stream-json (як VS Code)

**What was tried / researched:** `run-sj.sh`: `claude -p --input-format stream-json --output-format stream-json` без мережі (`ANTHROPIC_BASE_URL=http://127.0.0.1:9`), керований context-editor у режимі зонда (`CONTEXT_EDITOR_PROBE=1`), `--plugin-dir probe`. Зонд у `turn.complete` планує `$.clock.after(50, …)`, який читає `$.command.list()`, запускає `$.command.run({ command: 'rename', args: 'Probe title <n>' })` і пише `$.session.messages()` та форму `{ as: 'api' }`; хук `command.run` на `{ command: 'rename' }` записує чужі запуски. Ходи: `first prompt`, `second prompt`, `/rename Person title`, `fourth prompt`.

**Findings:**
- `rename` є в `$.command.list()` (`source: 'builtin'`); `$.command.run` з відкладеної дії кінця ходу виконується за 21–26 мс і повертає `{ text: 'Session renamed to: Probe title 1' }`.
- Транскрипт отримує `custom-title` і `agent-name` на кожне перейменування; останнє (`/rename Person title` людини) стоїть останнім.
- Хост stream-json виводить `{"type":"system","subtype":"session_title_changed","title":…}` на кожне перейменування; розширення VS Code 2.1.312 (`extension.js`) обробляє цю подію через `applySessionTitle`, а список сесій бере `customTitle ?? aiTitle` з хвоста транскрипту.
- Кожен запуск додає в розмову три рядки, і модель бачить усі три (форма `{ as: 'api' }`, `runs/sj-title-probe.json`): `<local-command-caveat>` (`isMeta`), рядок команди `<command-name>/rename</command-name>…<command-args>…` і `<local-command-stdout>Session renamed to: …</local-command-stdout>`; разом ≈500 символів. Рядки стають у кінець розмови, тож префікс кешу промпту не ламається. Рядок команди видно і в `$.session.messages()`, тож він з'явиться в `context_list`.
- `session.append`: рядки запуску плагіна мають двері `command`, походження `plugin` (рядок stdout — `engine`).
- `/rename` людини проходить хук `command.run` плагіна з `origin: { kind: 'sdk' }` і `args: 'Person title'`; власний запуск плагіна хост його ж хукам не показує.

### Entry 3 — 2026-10-29 — зонд у терміналі

**What was tried / researched:** той самий зонд у `claude` під tmux (`ce.sh`), без мережі; ходи `first prompt`, `second prompt`, `/rename Person title` від людини, `fourth prompt`.

**Findings:**
- `$.command.run({ command: 'rename' })` працює і тут (45–56 мс). Новий заголовок одразу видно на рамці поля вводу (`── Probe title 1 ─`); у стрічці запуск мода виглядає так, ніби людина набрала `❯ /rename Probe title 1`.
- Термінальний варіант повертає `{ context: ['<system-reminder>\nThe user named this session "Probe title 1". This may indicate the session\'s focus or intent.\n</system-reminder>'] }`, і модель бачить це нагадування після рядків команди та stdout. Хост приписує людині перейменування, яке зробив мод.
- `/rename` людини в терміналі приходить у хук з `origin: { kind: 'composer' }`.

### Entry 4 — 2026-10-29 — `/rename` без аргументу

**What was tried / researched:** stream-json без мережі, ходи `first prompt about refactoring the parser`, `/rename`.

**Findings:**
- Без відповіді моделі в розмові хост відмовляє: «Could not generate a name: no conversation context yet. Usage: /rename <name>». З мережею команда робить окремий виклик моделі-помічника; його ціну й те, яку частину розмови він читає, не міряно (мережі в зонді немає).

## Alternatives Considered

| # | Approach | Pros | Cons | Verdict |
|---|----------|------|------|---------|
| 1 | Мод запускає `/rename <назва>` у відкладеній дії кінця ходу, назву дає агент (поле `goal` слоту стану, назва етапу або окремий параметр `context_tag`) | працює в обох хостах; назва точна і без зайвого виклику моделі; вузьке місце — лише рішення агента | три рядки на запуск у розмові (≈500 символів); у терміналі нагадування «The user named this session…» приписує назву людині | needs more data: вибір джерела назви — інтерв'ю концепту |
| 2 | Мод запускає `/rename` без аргументу, коли агент позначив зміну теми | назву формулює хост, агент лише подає сигнал | окремий виклик моделі на кожну зміну (ціна не міряна); якість назви й прочитана частина розмови невідомі; ті самі три рядки | needs more data: живий прогін з мережею |
| 3 | Мод сам вирішує, що тема змінилась (евристика за етапами чи інструментами) | агент нічого не робить | суперечить C_CTX_DEC_34/38: рішення за станом роботи належить агенту; хибні перейменування | rejected |
| 4 | Писати `custom-title` у транскрипт напряму | без рядків у розмові | недокументований формат файлу, а не стандартна можливість; поточний процес хоста не бачить зміни | rejected |

## Conclusion

**Verdict:** здійсненно стандартними засобами. Плагін змінює заголовок сесії вбудованою `/rename <назва>` через `$.command.run` з відкладеної дії, у терміналі і в stream-json (VS Code), без мережі за 20–60 мс. Новий заголовок доходить до людини (рамка поля вводу, список `/resume`, подія `session_title_changed` для VS Code). Кожен запуск платить розмові трьома рядками, які бачить модель.

**Key constraints discovered:**
- API заголовка в `$` немає; єдиний шлях — `$.command.run({ command: 'rename', args })`, з тими самими правилами, що й Flush: лише з відкладеної дії (`$.clock.after` у `turn.complete`), одна спроба, команда чекає простою сесії.
- Кожен запуск додає `<local-command-caveat>`, рядок команди і `<local-command-stdout>`; термінал додає ще нагадування «The user named this session …», яке приписує дію людині. Агента треба попередити про ці рядки (тексти мода — у посібнику), або мод прибирає їх у наступному застосуванні.
- Назва `agentName` має пріоритет над `customTitle` і унікальна серед живих сесій машини: збіг дає суфікс.
- `/rename` людини видно хуку `command.run` (`composer` у терміналі, `sdk` у stream-json); після нього мод не повинен перейменовувати сесію сам.
- `ai-title` хоста генерується один раз; після першого `/rename` хост його вже не генерує.

**Recommendations for the concept:**
- Сигнал зміни теми дає агент (C_CTX_DEC_34: перемикач — параметр інструмента агента); кандидати для інтерв'ю: поле `goal` слоту стану, назва етапу, окремий параметр `title`. Назви етапів дрібні («read the config files»), тож годяться погано.
- Перейменовувати лише при зміні назви, не частіше одного разу за хід, у тій самій відкладеній дії кінця ходу, що й Flush (одна черга команд).
- `/rename` людини вимикає автоматичне перейменування до кінця сесії.
- Рядки `/rename` мода — сервісні тексти: посібник має їх назвати, а наступне застосування може їх прибрати.
- Поза межами: власна евристика теми, запис у транскрипт напряму.

**Artifacts to keep:**
- `.dev_flow/cache/live-test/title-probe/` — зонд, запуск stream-json і журнали прогонів (докази цього спайку).

**Artifacts to discard:**
- Тимчасові робочі теки зонда в scratchpad сесії і транскрипти зондових сесій у `~/.claude/projects/` (вже видалені 2026-10-29).
