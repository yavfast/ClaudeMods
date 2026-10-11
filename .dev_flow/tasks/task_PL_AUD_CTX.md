# Task: Рефакторинг context-editor за аудитом коду (PL_AUD_CTX)

> **Task ID:** `task_PL_AUD_CTX`
> **Created:** 2026-10-11 19:10
> **Last updated:** 2026-10-11 21:13
> **Status:** `in-progress`
> **Contributors:** `claude-session-d5614704`
> **Autonomy:** `full` — "Продовжуй автономно на свій вибір. Це технічні моменти, у яких я не розбираюсь, тож приймай рішення самостійно."

## Current Work Item

| Field | Value |
|-------|-------|
| **Document** | `plan` — [.dev_flow/audit/context-editor_20261011_182951.plan.md](../audit/context-editor_20261011_182951.plan.md) |
| **Pipeline phase** | `implement` — Ф8 (CF-16) |
| **Traceable ID** | `PL_AUD_CTX_P8` |

## Intent

- **Goal (why):** виправити дефекти коректності, знайдені аудитом коду (коміт 739ee44), і зробити логіку мода тестованою за портами, не змінюючи поведінки, закріпленої рішеннями `*_DEC_*`.
- **Target state:** `mods/context-editor` після 12 фаз плану PL_AUD_CTX; специфікація синхронна з кодом.
- **Expected result:** коміт на кожну пачку фаз з тестами, рев'ю субагентом і (де план вимагає) живим прогоном.

## Рішення, ухвалені автономно (resolved (delegated))

- Порядок: пачки Ф1+Ф2 → Ф3+Ф4 → Ф5 → Ф6 → Ф7–Ф11 → Ф12; коміт після кожної пачки без зупинки на sign-off.
- Конфлікти лінз: X1 — кеші лише з ключем (session, dir, generation) після Ф1/Ф7; X2 — перевіряти MARK за made/journal, без nonce (SP_CTX_DEC_17 не змінюється); X3 — ліміту самовідновлень не вводити (C_CTX_DEC_03), лишається в backlog; X4, X5 — backlog (зміни концепту, не дефекти); X6 — лише мітка й причина в логах; X7 — `registry.ts` за умови одного файлу `tags.json`.
- Тексти Ф5 (рамка автора) обирає агент у специфікації, в межах SP_CTX_DEC_17 (A′).
- Правила проєкту з аудиту (`should`) створюються на рефлексії тієї фази, що їх підтверджує.

## Subtasks

### [claude-session-d5614704] Виконання PL_AUD_CTX

- **Status:** in-progress
- **Progress:**
  - [x] Ф1+Ф2 (CF-1, CF-2) — store.ts, крок фіксації; 545 тестів; живий /clear PASS (.dev_flow/cache/live-test/audit-p1-results.md); правила CONC-01, CONC-02
  - [x] Ф3+Ф4 (CF-3…CF-7) — якорі thinking-only, LocateSpan/RangeAfter, пін на злитому рядку, appendReport/keepOtherSteps, обмеження parseQueue; 559 тестів; живий прогін PASS (.dev_flow/cache/live-test/audit-p3-results.md); правило STRUCT-01
  - [x] Ф5 (CF-8, CF-9) — рамка автора для тексту моделі в промптах (resume, документ передачі), cutDelivery повертає закривальні теги як їх пише хост; 565 тестів; живий прогін PASS (.dev_flow/cache/live-test/audit-p5-results.md)
  - [x] Ф6 (CF-10…CF-14) — страхувальні тести, `tests/row-fixtures.ts`, `ApplyOptions.newId`; 565 → 606 тестів; знайдено дефект DocumentWay після /clear → CF-41
  - [x] Ф6a (CF-41) — DocumentWay після /clear: HandDocument (кроки HandedOff/Deliver з тостом), копія документа `<old>/<id>/document.txt` і при відмові хоста в промпті, і при ході в новій сесії; 606 → 610 тестів; живий прогін PASS (.dev_flow/cache/live-test/audit-p6a-results.md); у backlog CF-42 (повтор передачі після збою HandedOff), CF-43 (fork-промпт потрапляє в документ як слова людини)
  - [x] Ф7 (CF-15) — `store.ts`: Read<T>, jsonFile/Store.update, контракти Update/Change, ранговані ланцюги serialChains з перевіркою вкладення в журнал налагодження; карантин без перезапису, якщо переміщення не вдалось; `register.ts` 1345 → 1248 рядків; 610 → 627 тестів; живий прогін PASS (.dev_flow/cache/live-test/audit-p7-results.md); у backlog CF-44 (решта ручних RMW-місць)
  - [ ] Ф8–Ф11 (CF-16…CF-23)
  - [ ] Ф12 (CF-24…CF-27)

## Coordination Notes

## Blocking Issues

## Relevant Context

- Аудит: [звіт](../audit/code-audit_20261011_182951.report.md), [карта](../../docs/_framework.md), знахідки лінз — лише в scratchpad сесії d5614704 (L1).

## Shared Activity Log

- 2026-10-11 21:13 [claude-session-d5614704] Ф7 закомічено; рев'ю WARNINGS (2 should, 4 prefer) виправлено: карантин із невдалим переміщенням нічого не пише (і в recordDelivery), формулювання CLAUDE.md/§02 приведено до коду, усі ланцюги через chainOf з перевіркою порядку, tags → deliveries у context_tag перевіряється; решта ручних RMW → CF-44.
- 2026-10-11 20:48 [claude-session-d5614704] Ф6a закомічено; рев'ю WARNINGS (2 should, 2 prefer): відмова хоста в промпті й хід у новій сесії теж зберігають копію документа, тест «поруч із seed» посилено; повтор передачі після збою HandedOff → CF-42; живий прогін знайшов, що fork /handoff записує інструкцію мода як слова людини → CF-43.
- 2026-10-11 20:40 [claude-session-d5614704] Ф6 закомічено; рев'ю WARNINGS (2 should, 6 prefer) виправлено; тести знайшли дефект DocumentWay (`handoff.ts:990–991`) — винесено у фазу Ф6a (CF-41), наступна; живий прогін не потрібен (лише тести).
- 2026-10-11 20:25 [claude-session-d5614704] Ф5 закомічено; рев'ю PASS (5 prefer виправлено); живий прогін знайшов закривальний тег з атрибутом (`</pasted_content id="…">`) — виправлено; реалізатор був без Bash (блок перевірки безпеки), тести й tsc проганяв я; час попередніх записів виправлено за часом комітів (був вигаданий).

- 2026-10-11 20:00 [claude-session-d5614704] Ф3+Ф4 закомічено; відступ від плану (CF-3): діапазон, що починається з рядка лише з thinking, не відхиляється — його знаходить LocateSpan від кінця (звіт закриття радить саме такий `a`); рев'ю WARNINGS (1 should, 4 prefer) виправлено й підтверджено механічно.
- 2026-10-11 19:35 [claude-session-d5614704] Ф1+Ф2 закомічено; рев'ю WARNINGS (7 зауважень) виправлено; фоновий запис межі після фіксації — прийнятий ризик (мілісекунди до наступного ходу).
- 2026-10-11 19:10 [claude-session-d5614704] задачу створено; повна автономія за словами розробника.
