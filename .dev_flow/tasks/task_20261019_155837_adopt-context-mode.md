# Task: Аналіз запозичень з context-mode (adopt)

> **Task ID:** `task_20261019_155837_adopt-context-mode`
> **Created:** 2026-10-19
> **Last updated:** 2026-10-19
> **Status:** `done`
> **Contributors:** `claude-session-9841457b`
> **Autonomy:** `checkpoints`

## Intent

- **Goal (why):** знайти в `mksglu/context-mode` ідеї, корисні моду context-editor.
- **Target state:** `docs/ext_adoption/context-mode.concept.md` (аналіз джерела) і `docs/ext_adoption/context-mode.md` (запозичення).
- **Expected result:** advisory-документи; без коду, планів і todo.

## Subtasks

### claude-session-9841457b — adopt (done)

- [x] Клон `ext_repos/context-mode` @ `3bcbec81`; `ext_repos/` додано в `.gitignore`.
- [x] Аналіз джерела (CREATE, субагент) → `docs/ext_adoption/context-mode.concept.md`.
- [x] Вердикти: high 0, medium 4 (усі defer з тригерами), low 15; похідні ідеї D1–D3 → `docs/ext_adoption/context-mode.md`.

Activity:
- 2026-10-19 — Інцидент: архіви обрізання субагента лягли в `ext_repos/context-mode/.claude/context-editor/…`, бо тека оболонки основної сесії після `cd` була там — другий випадок backlog «Тека архівів іде за поточною текою оболонки» (PL_CTX_BACKLOG). Дописати до пункту — рішення розробника.
- 2026-10-19 — Перевірено: `rg` не бачить архівів мода (`.gitignore` з `*`), лише за явним шляхом файлу (D1).

## Coordination Notes

## Blocking Issues
