# Task: Редактор контексту агента — концепт і специфікація

> **Task ID:** `task_C_CTX`
> **Created:** 2026-10-08 20:00
> **Last updated:** 2026-10-08 21:33
> **Status:** `in-progress`
> **Contributors:** `claude-session-bd80217a`
> **Autonomy:** `checkpoints`

## Current Work Item

| Field | Value |
|-------|-------|
| **Document** | `spec` — Редактор контексту агента, [docs/context_editor.sp.md](../../docs/context_editor.sp.md) |
| **Pipeline phase** | `verify` |
| **Traceable ID** | `C_CTX` / `SP_CTX` |

## Intent

- **Goal (why):** задокументувати мод, що дає AI-агенту редагувати власний контекст, щоб розвивати його через dev-flow, а не лише як прототип.
- **Target state:** проєкт ~/Projects/ClaudeMods з концептом і специфікацією мода.
- **Expected result:** `docs/context_editor.concept.md` і `docs/context_editor.sp.md`, що описують перевірений прототип, його обмеження і відкриті рішення.

## Description

Прототип мода складається з двох розширень Claude Code — `context-editor` і `context-editor-trigger` — і перевірений модульними та живими тестами в сесії bd80217a. Документи описують його поведінку зворотно, за кодом і результатами тестів. — claude-session-bd80217a

## Subtasks

### Subtask: концепт і специфікація за прототипом
> Author: `claude-session-bd80217a` — Created: 20:00 — Last updated: 20:00 — Status: `done`

**Goal:** створити проєкт і написати C_CTX та SP_CTX за прототипом.

**Progress:**
- [x] Проєкт, git-репозиторій, .gitignore для локальних файлів dev-flow
- [x] Концепт C_CTX
- [x] Специфікація SP_CTX
- [x] Код перенесено в mods/
- [x] Виправлення рев'ю раунду 1 (специфікація переписана, код і тести оновлено)
- [x] Виправлення рев'ю раунду 2 (логіка винесена в queue.ts, compaction.ts, trigger flush.ts; 38 тестів)
- [x] Виправлення рев'ю раунду 3 (44 тести)
- [x] Рев'ю раунд 4 зупинено на вимогу розробника: спершу перевірити основний функціонал наживо
- [x] Verify: 3 основні живі сценарії pass на поточному коді (стиснення, drop+collapse+rewrite, нагадування з початку); сховище 700, архів 0600
- [ ] **Next:** коміт основного функціоналу (за згодою розробника); медіа, теги, describe, C_CTX_DEC_09, resume — наступні етапи (PL_CTX)

**Activity:**
- 21:33 — розробник: «спочатку перевірити основний функціонал… вторинний функціонал залиш на наступні етапи»; рев'ю раунд 4 зупинено; живі сценарії основного функціоналу pass
- 21:26 — рев'ю раунд 3 FAIL (2 must, 5 should, 2 contested) → усе виправлено; contestedи (формулювання DEC_09, тести портів context_edit/DeliverReport) закрито виправленням, тож todo не створено
- 21:13 — рев'ю раунд 2 FAIL (3 must, 8 should) → виправлено в коді й документах; новий C_CTX_DEC_09 (proposed) — залишкове вікно ≤15 с; SRP: порти CompactionIO/TriggerIO замість хост-моків у тестах
- 20:57 — рев'ю раунд 1 FAIL → виправлено: criticality → core (розробник); SP_CTX переписано (сховище 700 і готовність редактора, один записувач черги, пакетні поля, межі, стани читання, DEC_06 open); код: носій collapse, архів після запису, charsAfter, обов'язкові поля, медіа-власники, FreshId, .catch на хуках, тригер з перевіркою готовності; 17 тестів, tsc чистий. Не реалізовано (план PL_CTX): теги (02_11–02_14), describe/PromptMatch, QueueTagReplacements у Nudge
- 20:33 — розробник погодив C_CTX_DEC_06 = B і теги; додано C_CTX §3.4, DEC_07, DEC_08; SP_CTX §01_09–01_11, §02_11–02_14, §04_03, SP_CTX_DEC_05
- 20:25 — додано медіа-ресурси (C_CTX, SP_CTX §01_08, §02_10, describe); C_CTX_DEC_06 чекає погодження; специфікація випередила код: прототип медіа не підтримує
- 20:00 — відкрите рішення C_CTX_DEC_05: правки не переживають `--resume` (обмеження хоста 2.1.294)

## Review Rounds

| Round | Scope | Mode | Baseline | Verdict | Carry-over (identity → recurrence) |
|-------|-------|------|----------|---------|-------------------------------------|
| 1 | full (no-baseline) | full | робоче дерево 2026-10-08 20:44, комітів немає | FAIL | code: collapse-носій зі службовим викликом → 1; посилання на архів при збої запису → 1; charsAfter до DropOwnCalls → 1; немає перевірки обов'язкових полів правки → 1; тригер без редактора запускає core-компактизацію → 1; права 0644 на архіви (security) → 1; spec: ApplyEdits/CollectMedia медіа-входи → 1; pin при застосуванні → 1; describe vs MARK → 1; resume між пакетами → 1; red flags 1/2/3/6 → 1; критерії перевірки неповні → 1 |
| 2 | full (reason: upstream spec changed) | full | робоче дерево 2026-10-08 21:13, комітів немає | FAIL | carry-over 1–12 resolved, 13 → 2 (CollectMedia criteria); new: shared-row media → 1; prompt-media collapse → 1; parallel summarize contradiction → 1; DeliverReport exactly-once → 1; abandoned compaction → 1; host windows → 1; readiness wording C vs SP → 1; hook-level tests → 1; unreadable queue exit + size → 1; trigger errors → 1 |
| 3 | full (reason: upstream spec changed) | full | робоче дерево 2026-10-08 21:26, комітів немає | FAIL | round-2 carry-over: 1–5, 9–11 resolved; 6 → 2, 7 → 2 (contested, wording), 8 → 2 (contested, tests); new N1 dropOwnCalls media → 1; N2 out-of-window edits → 2; N3 session change → 1; N4 trigger drop → 1; N5 archive >4 MiB → 1; N6 catch budget → 1; N7 spec 02_07 args → 1. Contested 7 and 8 fixed after the round, so no todo was filed |

**Always in scope:** —

## Coordination Notes

- 20:34 [claude-session-bd80217a] — код прототипу перенесено в проєкт: mods/context-editor, mods/context-editor-trigger (валідація і 9 тестів проходять); у сесії bd80217a папки dev-mods стали символьними посиланнями на проєкт
- 20:25 [claude-session-bd80217a] — дефект прототипу: він перезбирає всі рядки з результатами інструментів, тож кожне застосування правок мовчки прибирає з контексту всі медіа в цих результатах; виправлення — C_CTX_DEC_06 (B), у плані PL_CTX
- 20:00 [claude-session-bd80217a] — код прототипу лежить поза проєктом: ~/.claude/dev-mods/bd80217a-3404-4c87-b362-5d8332904668/{context-editor,context-editor-trigger}

## Blocking Issues

{No blockers yet.}

## Relevant Context

| Type | Name / Path | Note (added by) |
|------|-------------|-----------------|
| Concept | `docs/context_editor.concept.md` | ідея, обмеження хоста, рішення DEC_01–08 — `claude-session-bd80217a` |
| Code | `mods/context-editor/`, `mods/context-editor-trigger/` | прототип; відстає від SP_CTX: немає тегів і describe — `claude-session-bd80217a` |
| Spec | `docs/context_editor.sp.md` | структури, контракти, живі сценарії §05_03 — `claude-session-bd80217a` |

## Shared Activity Log

- 20:00 [claude-session-bd80217a] — created task
