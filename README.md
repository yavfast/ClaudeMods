# ClaudeMods

Моди (плагіни function hooks) для Claude Code, що розробляються за процесом dev-flow: спершу концепт і специфікація в `docs/`, потім код у `mods/`.

| Мод | Що робить | Документи |
|-----|-----------|-----------|
| `mods/context-editor` | Інструменти агента `context_list` / `context_edit` / `context_tag` / `context_note` / `context_recall` / `context_helper` / `context_handoff` і команда `/handoff`: агент замінює опрацьовані виводи, медіа і хибні кроки у своєму контексті стислими нотатками, а після ходу мод сам застосовує правки вбудованою командою `/compact`; області (етапи) завдання — чищення за рішенням агента, телеметрія контексту на запит, службові нотатки з нагадуваннями; згортки: замінене лягає в архів, агент розгортає його по рівню (`context_recall`), а після закриття області мод сам повертає згадане коротким слідом; вкладені області й завдання з карткою; службові вставки `[context-editor: optimize]`, `close` і `note` в кінці відповіді; помічник мода (`context_helper`): питання агента до архівів своїх згорток, на які окрема модель (sonnet, поза розмовою) відповідає цитатами, а до агента доходять лише ті, що мод знайшов в архіві дослівно, кожна з позначкою, чия вона; доручення з умовою (минуло N ходів, контекст досяг розміру, кеш промптів вистиг, закрилась область) з нагадуванням, питанням помічнику чи застосуванням відкладеного, результат яких доходить у безпечний момент, а на прохання агента будить його в простої; відкладені пакети правок (`defer` у `context_edit`), що застосовуються лише тоді, коли не переписують кеш даремно: разом зі звичайним застосуванням, у простої після вистигання кешу без ходу агента, на старті нового процесу, за дорученням `apply`, після порожнього ходу стискання на `/compact` людини чи в передачі; навичка `context-editor:context-stages`; передача розмови в нову сесію. Працює в інтерактивному терміналі і в неінтерактивному хості з потоковим входом (розширення VS Code, SDK); Claude Code ≥ 2.1.295 | [C_CTX](docs/context_editor.concept.md), [SP_CTX](docs/context_editor.sp.md), [C_FOLD](docs/context_folds.concept.md), [SP_FOLD](docs/context_folds.sp.md), [C_HELP](docs/context_helper.concept.md), [SP_HELP](docs/context_helper.sp.md) |
| `mods/ui-probe` | Тестовий мод, не для роботи: показує пронумероване повідомлення через кожен канал сповіщень плагіна (`$.ui.log`, toast, status, notify, notice), щоб побачити, які з них малює поверхня (розширення VS Code малює лише `$.ui.notify`) | [backlog PL_CTX](docs/context_editor.plan.md#PL_CTX_BACKLOG) |

## Запуск

```sh
claude --plugin-dir ~/Projects/ClaudeMods/mods/context-editor
```

Там, де мод увімкнено як керований плагін (розділ нижче), кожна нова сесія вже завантажує його з клону, а копію з `--plugin-dir` хост відхиляє («plugin is locked by managed settings»).

## Встановлення на іншій машині

Мод завантажується на місці з клону репозиторію, тож на кожній машині потрібен свій клон і шлях до нього. Маркетплейс з GitHub не підходить: керованим хост вважає лише плагін із локальної теки маркетплейсу, вказаний у ньому відносним шляхом.

```sh
git clone <url репозиторію> ~/Projects/ClaudeMods
cd ~/Projects/ClaudeMods
./install.sh            # режим обирається сам; --dry-run показує зміни, нічого не пишучи
```

| Машина | Режим | Що робить `install.sh` |
|--------|-------|------------------------|
| Особистий обліковий запис (Pro/Max), керованих налаштувань немає | `--user` | `claude plugin marketplace add <клон>`, `claude plugin install context-editor@claudemods --scope user` |
| Team чи Enterprise або на машині вже є керовані налаштування | `--managed` (потрібен root або sudo) | об'єднує три ключі з розділу нижче в наявний `managed-settings.json`, показує diff і питає підтвердження (`--yes` — без питання) |

Режим без прапорця: `--managed`, коли на машині вже є керовані налаштування або `oauthAccount.organizationType` у `~/.claude.json` — `claude_team` чи `claude_enterprise`; інакше `--user`. Якщо в сесіях `--user` мод повідомляє, що `/compact` пропущено, запустіть `./install.sh --managed`. Інші копії мода, ввімкнені в `~/.claude/settings.json` (наприклад, старий локальний маркетплейс), скрипт вимикає: у керованих налаштуваннях або через `claude plugin disable`. Наприкінці він запускає `claude plugin validate`.

Вимоги: Claude Code ≥ 2.1.295 (розширення VS Code має власний вбудований хост, його версія теж має бути не нижчою), `jq`, `zip`/`unzip` або `bsdtar` для пакування старих сесій. Перевірено на Linux. macOS не перевірено: керовані налаштування там у `/Library/Application Support/ClaudeCode/managed-settings.json`, а зонд можливостей без `/proc` бере `claude` з `PATH`. Windows не підтримується: скрипт працює лише на Linux і macOS.

Оновлення: `git pull` у клоні, потім нова сесія або `/reload-plugins`.

## Керований плагін (Managed plugin)

На хості 2.1.299+ з обліковим записом Team чи Enterprise (або з керованими налаштуваннями на машині) вбудований `cc-plugin-sec-default` стає найзовнішнім і пропускає хуки `session.compact` і `prompt.attachment` кожного плагіна, встановленого людиною, зокрема через `--plugin-dir`. Тоді `/compact` мода став би справжнім підсумком хоста, тож мод це перевіряє (окремий процес-зонд раз на версію хоста і живі ознаки) і вимикає те, що пропущено: `context_edit`, `context_recall`, `context_handoff` і `/handoff` відмовляють, `context_helper` відмовляє в питаннях і дорученнях `ask` та `apply` (нагадування працюють), а `/compact` іде до хоста з брифом мода. Людина бачить про це один рядок у чаті.

Щоб мод працював повністю, його запускають як керований плагін. `.claude-plugin/marketplace.json` у корені репозиторію — marketplace `claudemods` (мод завантажується на місці з `mods/context-editor`). Файл `/etc/claude-code/managed-settings.json` (потрібні права root):

```json
{
  "extraKnownMarketplaces": {
    "claudemods": { "source": { "source": "directory", "path": "/home/<user>/Projects/ClaudeMods" } }
  },
  "enabledPlugins": { "context-editor@claudemods": true },
  "prependPlugins": ["sec-default@builtin", "context-editor@claudemods"]
}
```

`./install.sh --managed` записує ці ключі з шляхом клону, не чіпаючи інших. `sec-default@builtin` лишається першим у `prependPlugins`, щоб зберегти його захист. Кожна нова сесія на машині тоді завантажує робоче дерево мода; копію з `--plugin-dir` хост відхиляє («plugin is locked by managed settings»). Перевірено на 2.1.299 ([PL_CTX_P38](docs/context_editor.p38.plan.md)) і на 2.1.325 (зонд DEC_10: компактизація мода з таймера в простої й до першого промпту нового процесу, [SP_HELP §02_11–02_12](docs/context_helper.batches.sp.md#SP_HELP_02_11)). Розширення VS Code запускає власний вбудований хост, не встановлений.

## Перевірки

```sh
claude plugin validate mods/context-editor
claude plugin test mods/context-editor
sh mods/context-editor/tests/skill-limits.sh        # межі SKILL.md і curation.md
npx -p typescript@5.6.3 tsc -p mods/context-editor/tsconfig.json --noEmit   # перевірка типів
```

`mods/*/tsconfig.json` розширює `.claude-plugin/types/tsconfig.json`. Цей каталог генерує Claude Code при кожному завантаженні мода, і він не зберігається в git; у свіжому клоні типи з'являються після першого запуску мода через `--plugin-dir`. Коли мод працює як керований плагін, хост теки типів не пише й `--plugin-dir` відхиляє: типи перевіряють тимчасовим tsconfig, чий `files` — вбудований у хост `plugin-authoring/types/claude-code.d.ts` (у `/tmp/claude-<uid>/bundled-skills/<version>/`), з `lib: ["es2022"]` і `include` тек `hooks/` і `tests/` мода.
