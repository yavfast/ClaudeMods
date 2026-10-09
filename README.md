# ClaudeMods

Моди (плагіни function hooks) для Claude Code, що розробляються за процесом dev-flow: спершу концепт і специфікація в `docs/`, потім код у `mods/`.

| Мод | Що робить | Документи |
|-----|-----------|-----------|
| `mods/context-editor` | Інструменти агента `context_list` / `context_edit` / `context_tag` / `context_handoff` і команда `/handoff`: агент замінює опрацьовані виводи, медіа і хибні кроки у своєму контексті стислими нотатками, а після ходу мод сам застосовує правки вбудованою командою `/compact`; нагадування чистити контекст з початку; передача розмови в нову сесію. Працює в інтерактивному терміналі і в неінтерактивному хості з потоковим входом (розширення VS Code, SDK); Claude Code ≥ 2.1.295 | [C_CTX](docs/context_editor.concept.md), [SP_CTX](docs/context_editor.sp.md) |

## Запуск

```sh
claude --plugin-dir ~/Projects/ClaudeMods/mods/context-editor
```

## Перевірки

```sh
claude plugin validate mods/context-editor
claude plugin test mods/context-editor
```

`mods/*/tsconfig.json` розширює `.claude-plugin/types/tsconfig.json`. Цей каталог генерує Claude Code при кожному завантаженні мода, і він не зберігається в git; у свіжому клоні типи з'являються після першого запуску мода через `--plugin-dir`.
