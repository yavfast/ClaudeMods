# ClaudeMods

Моди (плагіни function hooks) для Claude Code, що розробляються за процесом dev-flow: спершу концепт і специфікація в `docs/`, потім код у `mods/`.

| Мод | Що робить | Документи |
|-----|-----------|-----------|
| `mods/context-editor` | Інструменти агента `context_list` / `context_edit`: агент замінює опрацьовані виводи, медіа і хибні кроки у своєму контексті стислими нотатками; нагадування чистити контекст з початку | [C_CTX](docs/context_editor.concept.md), [SP_CTX](docs/context_editor.sp.md) |
| `mods/context-editor-trigger` | Після ходу запускає компактизацію, у якій `context-editor` застосовує правки; без нього правки не застосовуються | ті самі |

## Запуск

```sh
claude --plugin-dir ~/Projects/ClaudeMods/mods/context-editor --plugin-dir ~/Projects/ClaudeMods/mods/context-editor-trigger
```

## Перевірки

```sh
claude plugin validate mods/context-editor
claude plugin validate mods/context-editor-trigger
claude plugin test mods/context-editor
claude plugin test mods/context-editor-trigger
scripts/check-shared.sh        # спільні константи двох модів збігаються
```

`mods/*/tsconfig.json` розширює `.claude-plugin/types/tsconfig.json`. Цей каталог генерує Claude Code при кожному завантаженні мода, і він не зберігається в git; у свіжому клоні типи з'являються після першого запуску мода через `--plugin-dir`.
