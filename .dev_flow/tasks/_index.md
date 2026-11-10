# Tasks Directory Index

Each file here is the shared working space for one research topic, feature, or fix; several agents may contribute in parallel.

The parent file [`../active_context.md`](../active_context.md) is a thin dashboard derived from these files; if it ever drifts, this directory wins.

## Conventions

**Filename:**
- `task_<TRACEABLE_ID>.md` when the task is tied to a concept/spec/plan (e.g. `task_C_CTX.md`, `task_PL_AUD_CTX.md`).
- `task_YYYYMMDD_HHMMSS_<slug>.md` otherwise. The slug is 1–3 kebab-case words (e.g. `task_20261010_083402_stage-cleanup.md`).

**Collaboration model:** a task is a shared file. Each contributor owns one **Subtask block** and its own tagged entries, appends to shared sections, and **must not rewrite another contributor's content**. Coordination happens via the file's **Coordination Notes**. Full rules: `phases/status.md` → Collaboration Model (dev-flow skill).

**Lifecycle:**
- A task is created with one Subtask (the creator's work).
- Other contributors join by adding a new Subtask block. They are also added to the task's `Contributors` field.
- Each Subtask is marked `done` by its author when finished.
- When all Subtasks are `done`, any contributor may set the task's overall `Status: done`.
- Completed tasks stay here for ~30 days, then move to [`../session_history/`](../session_history/) — except a task file that still holds an open proportionality row. Completed subtask blocks are archived there by date.

**No exclusive locks** and no time-based takeover. To continue a stale line of work, add a *new* Subtask block referencing the original; the original stays untouched as a historical record.

## Active Tasks

- [task_C_CTX](task_C_CTX.md) — `bd80217a, 8e44a3be, a3902d56, decd4bc6, d5614704, 4118db51, 4cdf50ec, 355660b2, af2d71e6` — `plan` — Редактор контексту агента: фази PL_CTX 1–46 закомічені, відкрите — backlog PL_CTX
- [task_20261010_083402_stage-cleanup](task_20261010_083402_stage-cleanup.md) — `decd4bc6, d5614704, 355660b2` — `verify` — Динамічна оптимізація частини контексту за етапами; практика на реальних задачах (P1–P25)

## Recently Completed

- [task_20261110_093704_fix-autocontinue](task_20261110_093704_fix-autocontinue.md) — `23a7a081` — `done` 2026-11-10 — Автоматичне продовження після застосування на початку етапу
- [task_20261031_211349_adopt-token-economizer](task_20261031_211349_adopt-token-economizer.md) — `d4fbce3a` — `done` — Аналіз запозичень з TokenEconomizer (advisory, `docs/ext_adoption/`)
- [task_20261029_073500_session-title](task_20261029_073500_session-title.md) — `72a009d8` — `done` — Заголовок сесії за темою задачі: фаза 48 (C_CTX_03_12, SP_CTX_02_70–02_74)
- [task_20261019_155837_adopt-context-mode](task_20261019_155837_adopt-context-mode.md) — `9841457b` — `done` — Аналіз запозичень з context-mode (advisory, `docs/ext_adoption/`)

- [task_PL_AUD_CTX](task_PL_AUD_CTX.md) — done 2026-10-11 — рефакторинг context-editor за аудитом коду: 12 фаз (+Ф6a), 528 → 677 тестів

---

*Tasks index is regenerable. Any dev-flow command may rebuild it by listing `task_*.md` files in this directory. See `phases/status.md` (dev-flow skill).*
