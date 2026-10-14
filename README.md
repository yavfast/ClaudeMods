# ClaudeMods

Моди (плагіни function hooks) для Claude Code, що розробляються за процесом dev-flow: спершу концепт і специфікація в `docs/`, потім код у `mods/`.

| Мод | Що робить | Документи |
|-----|-----------|-----------|
| `mods/context-editor` | Інструменти агента `context_list` / `context_edit` / `context_tag` / `context_note` / `context_handoff` і команда `/handoff`: агент замінює опрацьовані виводи, медіа і хибні кроки у своєму контексті стислими нотатками, а після ходу мод сам застосовує правки вбудованою командою `/compact`; етапи завдання і мітка оптимізації — чищення за рішенням агента, телеметрія контексту на запит, службові нотатки з нагадуваннями, навичка `context-editor:context-stages`; передача розмови в нову сесію. Працює в інтерактивному терміналі і в неінтерактивному хості з потоковим входом (розширення VS Code, SDK); Claude Code ≥ 2.1.295 | [C_CTX](docs/context_editor.concept.md), [SP_CTX](docs/context_editor.sp.md) |

## Запуск

```sh
claude --plugin-dir ~/Projects/ClaudeMods/mods/context-editor
```

## Керований плагін (Managed plugin)

На хості 2.1.299+ з обліковим записом Team чи Enterprise (або з керованими налаштуваннями на машині) вбудований `cc-plugin-sec-default` стає найзовнішнім і пропускає хуки `session.compact` і `prompt.attachment` кожного плагіна, встановленого людиною, зокрема через `--plugin-dir`. Тоді `/compact` мода став би справжнім підсумком хоста, тож мод це перевіряє (окремий процес-зонд раз на версію хоста і живі ознаки) і вимикає те, що пропущено: `context_edit`, `context_handoff` і `/handoff` відмовляють, а `/compact` іде до хоста з брифом мода. Людина бачить про це один рядок у чаті.

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

`sec-default@builtin` лишається першим у `prependPlugins`, щоб зберегти його захист. Кожна нова сесія на машині тоді завантажує робоче дерево мода; копію з `--plugin-dir` керований мод ігнорує. Перевірено на 2.1.299 (спайк у `.dev_flow/cache/live-test/host-2.1.299-bypass.md`, `managed-spike/`). Розширення VS Code запускає власний вбудований хост, не встановлений.

## Перевірки

```sh
claude plugin validate mods/context-editor
claude plugin test mods/context-editor
```

`mods/*/tsconfig.json` розширює `.claude-plugin/types/tsconfig.json`. Цей каталог генерує Claude Code при кожному завантаженні мода, і він не зберігається в git; у свіжому клоні типи з'являються після першого запуску мода через `--plugin-dir`.
