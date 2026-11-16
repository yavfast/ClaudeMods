# Dev-Flow Active Context

A thin index over the task files in [`tasks/`](tasks/) — active and recently completed tasks only; per-task state lives in those files.

## Resume

- `/dev-flow resume task_C_CTX` — `plan` — next: вибір роботи з backlog PL_CTX (фази 1–48 закомічені; фаза 48 — заголовок сесії) — branch `main` — 2026-10-21
- `/dev-flow resume task_20261010_083402_stage-cleanup` — `verify` — next: практика — реальна довга задача з модом (≥150k, opus), потім розбір сесії → P26+ — branch `main` (= `feat/context-editor`) — 2026-10-11

## Active Tasks

| Task | Phase | Status | Contributors | Updated |
|------|-------|--------|--------------|---------|
| [task_20261116_141010_helper-concept](tasks/task_20261116_141010_helper-concept.md) — Концепт помічника мода (C_HELP) | concept | in-progress | 9a12e9ac | 2026-11-16 |
| [task_C_CTX](tasks/task_C_CTX.md) — Редактор контексту агента | plan (backlog PL_CTX; фази 1–47 закомічені) | in-progress | bd80217a, 8e44a3be, a3902d56, decd4bc6, d5614704, 4118db51, 4cdf50ec, 355660b2, af2d71e6, a477d71d | 2026-10-21 |
| [task_20261010_083402_stage-cleanup](tasks/task_20261010_083402_stage-cleanup.md) — Динамічна оптимізація частини контексту за етапами | verify (практика) | in-progress | decd4bc6, d5614704, 355660b2 | 2026-10-17 |

## Recently Completed

| Task | Phase | Completed | Contributors | Result |
|------|-------|-----------|--------------|--------|
| [task_20261116_123729_helper](tasks/task_20261116_123729_helper.md) — Субагент-помічник для context-editor (спайк) | done | 2026-11-16 | 9a12e9ac | спайк `context_helper` concluded: мод питає sonnet без агента (`complete`, JSON 35 з 35); перший кандидат — питання до архіву згортки; пастки хоста 88–90; навичка `helper-evidence` |
| [task_20261116_102446_supervisor](tasks/task_20261116_102446_supervisor.md) — Субагент-наглядач за головним контекстом (спайк) | done | 2026-11-16 | 9a12e9ac | спайк `context_supervisor` concluded: окремий агент — найдорожча форма; дешевше правило → одне судження моделі → прихований контекст у безпечний момент; пастки хоста 84–87; навичка `supervisor-evidence` |
| [task_C_FOLD](tasks/task_C_FOLD.md) — Згортки й пам'ять завдань | done | 2026-11-15 | 90e21609, 85408971 | PL_FOLD фази 1–6: облік згорток, `context_recall` з поверненням, згортка зі словами людини, вкладені області й завдання з карткою, вставки `optimize`/`close`/`note`; фаза 4 переваги карток не виміряла (спайк, Entry 14–15) |
| [task_20261114_135602_service-info](tasks/task_20261114_135602_service-info.md) — Службова інформація в контексті чату (спайк) | done | 2026-11-14 | 90e21609 | спайк `context_service_info` concluded: 29 варіантів (10 варті концепту, 13 потребують даних, 6 відхилено); навичка `service-info-evidence` |
| [task_20261110_093704_fix-autocontinue](tasks/task_20261110_093704_fix-autocontinue.md) — Автоматичне продовження після застосування на початку етапу | done | 2026-11-10 | 23a7a081 | останній явний вибір пакета перемагає; ResumesAfter для звіту й результатів; вибори ходу без правок скидаються; TAGS_STOP; 1018 тестів, живий прогін A–D |

## Deferred (todos)

_7 candidate · 1 queued · 0 contested — у [backlog PL_CTX](../docs/context_editor.plan.md#PL_CTX_BACKLOG)_
- ⚠ backlog CF-28…CF-53 ([план PL_AUD_CTX](audit/context-editor_20261011_182951.plan.md#PL_AUD_CTX_BACKLOG), кожен пункт з тригером) прив'язаний до **закритої** task_PL_AUD_CTX — бере `/dev-flow resume task_C_CTX`

## Notes

- Гілка: 2026-10-17 створено `main` на cda33b6; `feat/context-editor`, де йшла робота, вказує на той самий коміт — робота продовжується на `main`. Замінені записи `## Resume` — у [session_2026-10-17](session_history/session_2026-10-17.md).

---

*Dashboard maintained by dev-flow commands. Hygiene: keep under ~80 lines; any contributor may rebuild it from `tasks/*.md` when in doubt. See `phases/status.md` (dev-flow skill).*
