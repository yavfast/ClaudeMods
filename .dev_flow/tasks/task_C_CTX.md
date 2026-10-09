# Task: Редактор контексту агента — концепт і специфікація

> **Task ID:** `task_C_CTX`
> **Created:** 2026-10-08 20:00
> **Last updated:** 2026-10-09 08:50
> **Status:** `in-progress`
> **Contributors:** `claude-session-bd80217a`, `claude-session-8e44a3be`
> **Autonomy:** `checkpoints`

## Current Work Item

| Field | Value |
|-------|-------|
| **Document** | `plan` — фаза 2 «Медіа в результатах інструментів», [docs/context_editor.plan.md](../../docs/context_editor.plan.md#PL_CTX_P2) |
| **Pipeline phase** | `verify` |
| **Traceable ID** | `C_CTX` / `SP_CTX` / `PL_CTX` |

## Intent

- **Goal (why):** задокументувати мод, що дає AI-агенту редагувати власний контекст, щоб розвивати його через dev-flow, а не лише як прототип.
- **Target state:** проєкт ~/Projects/ClaudeMods з концептом і специфікацією мода.
- **Expected result:** `docs/context_editor.concept.md` і `docs/context_editor.sp.md`, що описують перевірений прототип, його обмеження і відкриті рішення.

## Description

Прототип мода складається з двох розширень Claude Code — `context-editor` і `context-editor-trigger` — і перевірений модульними та живими тестами в сесії bd80217a. Документи описують його поведінку зворотно, за кодом і результатами тестів. — claude-session-bd80217a

## Subtasks

### Subtask: фаза 2 PL_CTX — живі сценарії медіа
> Author: `claude-session-8e44a3be` — Created: 2026-10-09 07:40 — Last updated: 2026-10-09 08:50 — Status: `in-progress`

**Goal:** закрити Verify фази 2 PL_CTX — живі сценарії SP_CTX §05_03 «Скриншот…», «Документ…», «Незмінене медіа» і два припущення фази (base64-джерело блоків у API-поданні; stdin base64 кількох МБ у `$.process.run`).

**Progress:**
- [x] Resume: дерево відповідає запису (гілка `feat/context-editor`, 8d01f39; незакомічені лише `.dev_flow/` і новий `CLAUDE.md`)
- [x] Медіа-фікстури: `.dev_flow/cache/live-test/make-media.sh <dir>` (shot1/shot2.png, doc.pdf з 3 сторінок через ps2pdf, big.pdf 4.8 МБ)
- [x] Живі сценарії (субагент): скриншот, PDF, незмінене медіа — pass; припущення base64 і multi-MB stdin — підтверджено (6.2 МБ через `writeText`)
- [x] SP_CTX §05_03 — статуси pass; PL_CTX фаза 2 → DONE, backlog +3 знахідки; навичка plugin-hooks — пастки 13–15
- [x] Розробник: «Виправ всі виявлені проблеми» → фаза 8 PL_CTX
- [x] Спайк межі компактизації (зонд-плагін у scratchpad, 2.1.295): `e.messages` = хвіст транскрипту після останньої межі; повернені рядки — суцільний блок з тими самими відбитками → SP_CTX_DEC_07 (A)
- [x] Документи: C_CTX обмеження хоста; SP_CTX 01_06, 01_12, 01_14, 02_18, DEC_07, 05_01, 05_03; PL_CTX фаза 8
- [x] Код: `edits.ts` (Boundary, currentRows), `compaction.ts` (archiveText, writeBoundary), `register.ts` (conversation, хук межі, опис 1.9k); тести 87 + 6, tsc/validate/check-shared чисті
- [x] Живий сценарій «Перегляд після компактизації» — pass; регрес скриншота — PNG ідентичний, base64 в архіві немає, попередження про обрізаний опис зникло
- [x] Рев'ю раунд 4 (повний обсяг): FAIL — 3 should (core); виправлено: застарілі індекси відхиляються, 02_18 precompute/субагенти, `observedBoundary`; поради A2–A4 (A1 задокументовано); тести 91 + 6; живо: перелік→rewrite прийнято, старий індекс після застосування відхилено
- [x] Рев'ю раунд 5 (дельта): PASS; порада A6 виправлена (ключ переліку — лише після успішного переліку), A5 задокументована в 02_18, A7 (тест ключа в register.ts) не робилась
- [ ] **Next:** погодження коміту фаз 2 і 8 розробником. CLAUDE.md: у списку файлів сховища бракує `boundary.json` — правити лише за згодою розробника

**Activity:**
- 08:50 — раунд 5 PASS; чекаю погодження коміту
- 08:40 — рев'ю раунд 4 FAIL (3 should) → виправлено; раунд 5 (дельта) запущено
- 08:30 — живий сценарій фази 8 pass; рев'ю раунд 4 запущено
- 08:12 — спайк: межа компактизації невидима в `SessionMessage` і `session.append`; рішення A погоджене відповіддю розробника
- 08:05 — знахідки живих сценаріїв: старі рядки до межі компактизації в перегляді й черзі (підтверджено за кодом і типами хоста: `$.session.messages()` — весь транскрипт, межі не позначено); опис context_edit обрізано до 2048; base64 двічі в архіві — усі в backlog PL_CTX
- 07:38 — системний pdflatex зламаний (формат-файл від іншої версії): PDF-фікстура будується з PostScript через ps2pdf

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
- [x] Коміт 7842616 (гілка feat/context-editor)
- [x] План PL_CTX: фаза 1 DONE, фази 2–6, backlog
- [x] Погодження дизайну: PL_CTX_DEC_02 = B (теги → медіа → describe), C_CTX_DEC_09 = A
- [x] Фаза 3 PL_CTX — теги: реалізація (субагент), 61+6 тестів, tsc/validate/check-shared чисті; живі сценарії «pin першого промпту» і «автоматичне чищення з тегів» pass; навичка .dev_flow/skills/claude-code/plugin-hooks.md
- [x] Фаза 7 PL_CTX — псевдоніми викликів (субагент): 77+6 тестів, перевірки чисті; живий сценарій «Тег за псевдонімом» pass
- [x] Коміт 8d01f39: фази 3 і 7, навичка claude-code-plugin-hooks
- [ ] **Next:** згенерувати PNG-скриншот з написами і PDF на кілька сторінок, прогнати живі сценарії фази 2 (SP_CTX §05_03 «Скриншот у результаті інструменту», «Документ у результаті інструменту», «Незмінене медіа») драйвером `.dev_flow/cache/live-test/ce.sh` і перевірити припущення фази 2 (формат блоків image/document в API-поданні, stdin base64 у `$.process.run`)

**Activity:**
- 21:52 — фаза 3: агент не бачить tool_use_id власних викликів, тому кожен context_tag потребує context_list → backlog PL_CTX
- 21:36 — розробник: порядок фаз «Теги → медіа → describe»; DEC_09 «Прийняти вікно»
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
| 4 | full (reason: plan backlog; 8d01f39 без рев'ю) | full | робоче дерево 2026-10-09 08:27 | FAIL | new: stale indexes after boundary move (core) → 1; 02_18 precompute → 1; observer predicate untested → 1; advisory A1–A4 (A1 documented, A2–A4 fixed) |
| 5 | incremental (delta over 4) | full | робоче дерево 2026-10-09 08:45 | PASS | round-4 1–3 resolved; advisory A5 documented, A6 fixed, A7 open |

**Always in scope:** —

## Coordination Notes

- 07:40 [claude-session-8e44a3be] — resume у новій сесії; продовжую фазу 2 окремим Subtask-блоком (блок bd80217a не змінюю); живі сценарії веде субагент тим самим драйвером `ce.sh`
- 22:12 [claude-session-bd80217a] — checkpoint: гілка `feat/context-editor`, останній коміт 8d01f39, робоче дерево чисте до цього checkpoint (він змінює лише `.dev_flow/`). Живі сценарії: драйвер `.dev_flow/cache/live-test/ce.sh` (start/send/idle/screen/stop у tmux), тестові файли — `.dev_flow/cache/live-test/make-fixtures.sh <dir>`; мод запускати `claude --plugin-dir mods/context-editor --plugin-dir mods/context-editor-trigger --debug`, журнал `~/.claude/debug/<session>.txt`. Реалізацію фаз 3 і 7 вели субагенти з чистим контекстом за посиланнями на план/специфікацію — підхід спрацював, повторити для фаз 4–5
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
| Skill | `.dev_flow/skills/claude-code/plugin-hooks.md` | пастки хоста — читати перед будь-якою зміною `mods/` — `claude-session-bd80217a` |
| Cache | `.dev_flow/cache/live-test/` | драйвер живих сценаріїв і генератор тестових файлів (локально, не в git) — `claude-session-bd80217a` |
| Code | `scripts/check-shared.sh`, `README.md` | перевірки модів і як їх запускати — `claude-session-bd80217a` |
| Plan | `docs/context_editor.plan.md` | фази, технологічні рішення, backlog — `claude-session-bd80217a` |
| Spec | `docs/context_editor.sp.md` | структури, контракти, живі сценарії §05_03 — `claude-session-bd80217a` |

## Shared Activity Log

- 20:00 [claude-session-bd80217a] — created task
