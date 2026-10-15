# Dev-Flow Active Context

A thin index over the task files in [`tasks/`](tasks/) — active and recently completed tasks only; per-task state lives in those files.

## Resume

- `/dev-flow resume task_C_CTX` — `research` — спайк [context_editor_uses](../docs/context_editor_uses.spike.md) concluded і закомічено (інші застосування редагування історії, панель 4 лінз); далі — зміна концепту C_CTX за Т1/Т2 (design sign-off); перед наступною суттєвою правкою плану — «Розділити план PL_CTX» (queued у backlog) — 2026-10-15
- `/dev-flow resume task_C_CTX` також бере backlog рефакторингу CF-28…CF-53 ([план PL_AUD_CTX](audit/context-editor_20261011_182951.plan.md#PL_AUD_CTX_BACKLOG), кожен пункт з тригером)
- `/dev-flow resume task_C_CTX` — `plan` — next: вибір роботи з backlog PL_CTX (ремонт після відновлення, згортання хвоста, `/compact` мода приписують людині, R2 доставок, спайк «підсумок рядком асистента», I, K); усі фази 1–23 закомічені (152f694) — branch `feat/context-editor` — 2026-10-11
- `/dev-flow resume task_20261010_083402_stage-cleanup` — `verify` — next: практика — реальна довга задача з модом (≥150k, opus), потім розбір сесії → P23+ — branch `feat/context-editor` — 2026-10-11

## Active Tasks

| Task | Phase | Status | Contributors | Updated |
|------|-------|--------|--------------|---------|
| [task_C_CTX](tasks/task_C_CTX.md) — Редактор контексту агента | plan (backlog); фази 33–35 закомічені (1e053ad, bd75156, 4be53fd), 36 (59dfd4d) | in-progress | claude-session-bd80217a, claude-session-8e44a3be, claude-session-a3902d56, claude-session-decd4bc6, claude-session-d5614704, claude-session-4118db51, claude-session-355660b2 | 2026-10-15 |
| [task_20261010_083402_stage-cleanup](tasks/task_20261010_083402_stage-cleanup.md) — Динамічна оптимізація частини контексту за етапами | verify (практика) | in-progress | claude-session-decd4bc6, claude-session-d5614704 | 2026-10-11 |

## Recently Completed

- [task_PL_AUD_CTX](tasks/task_PL_AUD_CTX.md) — Рефакторинг context-editor за аудитом коду: 12 фаз (+Ф6a), 528 → 677 тестів, кожна фаза з рев'ю й живим прогоном — 2026-10-11

## Deferred (todos)

_1 candidate · 1 queued · 0 contested — у [backlog PL_CTX](../docs/context_editor.plan.md#PL_CTX_BACKLOG): «Згода людини при першому використанні мода» (candidate), «Розділити план PL_CTX» (queued, після коміту спайку)_
