# Dev-Flow Active Context

A thin index over the task files in [`tasks/`](tasks/) — active and recently completed tasks only; per-task state lives in those files.

## Resume

- `/dev-flow resume task_C_CTX` — `implement` — фаза 42 (перевірка залежностей і слід власних викликів) виконана: рев'ю pass with advisories, живий прогін 12 сесій (слід знімає P13; обережне P23 щодо виводу лишилось); закомічено; далі — фаза 43 — 2026-10-16
- `/dev-flow resume task_C_CTX` — `implement` — фаза 41 (відкривачі замін з джерелом) виконана: рев'ю pass with advisories, живий повтор 9/9; закомічено; далі — фаза 42 (перевірка залежностей і слід власних викликів) — 2026-10-16
- `/dev-flow resume task_C_CTX` — `implement` — фаза 40 (слова людини, піни, `describe` вставок) виконана й закомічена: рев'ю, живий прогін у stream-json (PinDocument шукає документ після рядків `/clear`); далі — фаза 41 (тексти замін з джерелом) — 2026-10-15
- `/dev-flow resume task_C_CTX` — `implement` — фаза 39 (живі ворота) виконана: статус змісту знято за воротами (C_CTX_DEC_40, SP_CTX_DEC_44), обгортка вставок у тексті рядка, thinking `unobserved`; закомічено; великі файли специфікації поділено за модулями (якорі ті самі); далі — фаза 40 (слова людини, піни, `describe` вставок) — 2026-10-15
- `/dev-flow resume task_C_CTX` — `plan` — план курування історії: PL_CTX поділено по фазах (дочірні `context_editor.p<NN>.plan.md`), додано фази 39–46 і [PL_CTX_DEC_06](../docs/context_editor.plan.md#PL_CTX_DEC_06) (спершу живі ворота); закомічено; далі — поділ великих файлів специфікації (queued, до фази 40), потім `implement` фази 39 (живі ворота) — branch `feat/context-editor` — 2026-10-15
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

_4 candidate · 1 queued · 0 contested — у [backlog PL_CTX](../docs/context_editor.plan.md#PL_CTX_BACKLOG): «Згода людини при першому використанні мода» (candidate), «Дані мода без слідів на диску» (candidate), «Навичка, відкрита інструментом `Skill`, зникає після застосування» (candidate), «Текст STALE_INDEXES без жодного `context_list`» (candidate), «Розділити план PL_CTX» — залишок (queued: довгі пункти backlog і `soft_split`)_
