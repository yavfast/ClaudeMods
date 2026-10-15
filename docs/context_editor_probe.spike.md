# Редактор контексту агента — Spike: процес-зонд можливостей хоста

> **Status:** completed
> **Date:** 2026-10-14
> **Feeds:** [C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31) (а) D, [SP_CTX_DEC_38](./context_editor.decisions-21.sp.md#SP_CTX_DEC_38)
> **Evidence:** `.dev_flow/cache/live-test/probe-spike/` (git-ignored): `probe/` — плагін-зонд рівня `user`, `parent/` — плагін, що запускає дочірній процес, `probe-run.sh`, `runs/` — журнали налагодження, stdout і лічильники.

## Питання і відповіді

**Q1. Дочірній `claude` з хука.** `$.process.run(argv, { cwd, env, stdin, timeoutMs })` — без оболонки; `env` додається поверх змінних хоста (зняти змінну не можна); `stdin` пишеться і закривається; тайм-аут типово 30 с, найбільше 10 хв; stdout і stderr — до 4 MiB кожен. Валідатор приймає. З `$.clock.after(1000)`, запланованого в `session.start`, дочірній `claude` скінчився за 3.9 с (exit 0); прямо в `session.start` — 3.7 с, але це тримає старт сесії. Довгі запуски працюють (`sleep 45` з `timeoutMs: 60000` — 45004 мс); перевищення тайм-ауту — виняток «aborted: still running after …». `$PPID` дочірнього процесу — сам хост: `/proc/$PPID/exe` — точний бінарник хоста (у VS Code — не той `claude`, що в PATH), `/proc/$PPID/cmdline` — його аргументи з `--plugin-dir`. Дочірній процес успадковує змінні хоста (зокрема `CLAUDE_CODE_MESSAGING_SOCKET`/`TOKEN`, у VS Code ще `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION=1`) — видимої шкоди немає.

**Q2. Форма зонда.** Працює stream-json з двома повідомленнями — `hi`, потім `/compact <MARK>` — і закритим stdin, з `ANTHROPIC_BASE_URL=http://127.0.0.1:9` і `CLAUDE_CODE_MAX_RETRIES=0`:

| | 2.1.296 | 2.1.299, зонд рівня `user` |
|---|---|---|
| результат | `Not compacted · ceprobe: hook reached`, $0, 3.7 с | `Not enough messages to compact.` (у журналі `session.compact bypassed by cc-plugin-sec-default`, `runs/R299.debug.txt:1060`), $0, 4.0 с |
| `prompt.attachment` | 9 (environment, model, skill_listing, …) | 0 |
| двері `session.append` | attachment 10, hook-context 1, prompt 1, response 1, command 3 | attachment і hook-context 0; нові двері `queue` 2 |
| `prompt.submit`, `turn.start`, `turn.complete` | по 1 | по 1 |
| `session.compact` | 1 | 0 |

Не працюють: разовий `-p` з `/compact` із `turn.complete` (гонка: із запуску з плагіна — «no session is bound», `runs/child1.probe.json:27`); `/compact` у порожній сесії («No messages to compact»); рядок `$.session.append` замість ходу (розмова лишається порожньою, а на 2.1.299 це дає **хибне «дійшло»**: `sec-default` кидає виняток на порожніх рядках і пропускається, `runs/B299.debug.txt:912-919`). Коли хук пропущено, а API досяжний, хост робить справжній підсумок (`Forked agent [reactive-compact]`, `runs/C299.debug.txt:1146`): 5.1 с, ~$0.0027 на haiku.

**Q3. Ціна.** Запиту моделі не треба: з недосяжною адресою API хід закінчується одразу (ECONNREFUSED), а вкладення й двері спрацьовують; $0, ~4 с (переважно старт). Команда до першого промпту непридатна: компактизація потребує хоч одного ходу. Залишки: порожній `~/.claude/projects/<cwd-slug>/memory/` (транскрипту з `--no-session-persistence` немає) і `~/.claude/context-editor/<sid>/tags.json` від керованого мода в дочірньому процесі; записів у `~/.claude.json` немає. Неперевірений ризик: керовані налаштування організації з `env.ANTHROPIC_BASE_URL` можуть перекрити недосяжну адресу — тоді хід коштує запит haiku, а пропущений хук — справжній підсумок у тимчасовій сесії.

**Q4. Рівень мода в дочірньому процесі.** Керований мод дочірній процес отримує сам (`tier prepend` у журналі); мод з marketplace користувача — через `enabledPlugins` (не перевірено); для `--plugin-dir` батька треба передати `--plugin-dir $.plugin.root`. Дублікат безпечний: «--plugin-dir copy of "context-editor" ignored: plugin is locked by managed settings» (`runs/K299.debug.txt:52`, так само на 2.1.296). Рівень свого модуля батько бачить у `next.origin` власного хука `session.append {door:'note'}` після свого ж `$.session.append` (`{"plugin":"ceparent","tier":"user"}`, ціна — службовий рядок у транскрипті) або порівнянням `/proc/$PPID/cmdline` з `$.plugin.root`; `$.plugin`, `e.plugins` і `plugin.register` рівня не дають.

**Q5. Захист від рекурсії.** `env` з `$.process.run` доходить: дочірній мод читає `$.env.get('CEPROBE_CHILD')` = `1`, зокрема на рівні `user` на 2.1.299; назва — рядковий літерал (валідатор її перелічує).

## Висновок

Зонд здійсненний і дешевий: ~4 с, $0, без запиту моделі, і він бачить пропуск `session.compact` без справжнього підсумку в розмові людини. Форма: бінарник з `/proc/$PPID/exe`, тимчасова тека (`mktemp -d`), `timeoutMs` 60000; `-p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --model haiku` (+ `--plugin-dir <root>`); stdin — `hi` і `/compact <PROBE_MARKER>`; env — мітка зонда, недосяжна адреса API, `CLAUDE_CODE_MAX_RETRIES=0`, `DISABLE_AUTOUPDATER=1`. Мод у дочірньому процесі не чіпає сховища, ремонту, прибирання і не запускає власного зонда; він рахує вкладення й двері і відповідає на мітку `{ skip: '<префікс> …лічильники' }`. Батько читає останній `result` stream-json: «Not compacted · <префікс>» — `session.compact` доходить. Після запуску — прибрати тимчасову теку й теку проєкту `~/.claude/projects/<cwd-slug>`.
