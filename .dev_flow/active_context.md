# Dev-Flow Active Context

A thin index over the task files in [`tasks/`](tasks/) — active and recently completed tasks only; per-task state lives in those files.

## Resume

- `/dev-flow resume task_C_CTX` — `plan` — next: вибір роботи з backlog PL_CTX (фази 1–46 закомічені; фаза 38 завершена a713b45, далі cda33b6 install.sh) — branch `main` (= `feat/context-editor`) — 2026-10-16
- `/dev-flow resume task_20261010_083402_stage-cleanup` — `verify` — next: практика — реальна довга задача з модом (≥150k, opus), потім розбір сесії → P26+ — branch `main` (= `feat/context-editor`) — 2026-10-11

## Active Tasks

| Task | Phase | Status | Contributors | Updated |
|------|-------|--------|--------------|---------|
| [task_C_CTX](tasks/task_C_CTX.md) — Редактор контексту агента | plan (backlog PL_CTX; фази 1–46 закомічені) | in-progress | bd80217a, 8e44a3be, a3902d56, decd4bc6, d5614704, 4118db51, 4cdf50ec, 355660b2, af2d71e6 | 2026-10-17 |
| [task_20261010_083402_stage-cleanup](tasks/task_20261010_083402_stage-cleanup.md) — Динамічна оптимізація частини контексту за етапами | verify (практика) | in-progress | decd4bc6, d5614704, 355660b2 | 2026-10-17 |

## Recently Completed

| Task | Phase | Completed | Contributors | Result |
|------|-------|-----------|--------------|--------|
| [task_PL_AUD_CTX](tasks/task_PL_AUD_CTX.md) — Рефакторинг context-editor за аудитом коду | done | 2026-10-11 | d5614704 | 12 фаз (+Ф6a), 528 → 677 тестів, кожна фаза з рев'ю й живим прогоном |

## Deferred (todos)

_4 candidate · 1 queued · 0 contested — у [backlog PL_CTX](../docs/context_editor.plan.md#PL_CTX_BACKLOG)_
- ⚠ backlog CF-28…CF-53 ([план PL_AUD_CTX](audit/context-editor_20261011_182951.plan.md#PL_AUD_CTX_BACKLOG), кожен пункт з тригером) прив'язаний до **закритої** task_PL_AUD_CTX — бере `/dev-flow resume task_C_CTX`

## Notes

- Гілка: 2026-10-17 створено `main` на cda33b6; `feat/context-editor`, де йшла робота, вказує на той самий коміт — робота продовжується на `main`. Замінені записи `## Resume` — у [session_2026-10-17](session_history/session_2026-10-17.md).

---

*Dashboard maintained by dev-flow commands. Hygiene: keep under ~80 lines; any contributor may rebuild it from `tasks/*.md` when in doubt. See `phases/status.md` (dev-flow skill).*
