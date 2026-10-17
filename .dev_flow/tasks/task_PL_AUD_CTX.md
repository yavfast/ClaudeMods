# Task: Рефакторинг context-editor за аудитом коду (PL_AUD_CTX)

> **Task ID:** `task_PL_AUD_CTX`
> **Created:** 2026-10-11 19:10
> **Last updated:** 2026-10-17
> **Status:** `done`
> **Contributors:** `claude-session-d5614704`
> **Autonomy:** `full` — "Продовжуй автономно на свій вибір. Це технічні моменти, у яких я не розбираюсь, тож приймай рішення самостійно."

## Current Work Item

| Field | Value |
|-------|-------|
| **Document** | `plan` — [.dev_flow/audit/context-editor_20261011_182951.plan.md](../audit/context-editor_20261011_182951.plan.md) |
| **Pipeline phase** | `done` — усі 12 фаз; далі backlog CF-28…CF-53 плану (кожен з тригером) |
| **Traceable ID** | `PL_AUD_CTX_P12` |

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

### Підсумок (стиснення audit 2026-10-17)

Усі 12 фаз плану PL_AUD_CTX (+Ф6a) виконано автономно `claude-session-d5614704` за 2026-10-11: закрито знахідки CF-1…CF-27 і CF-41 (дефекти коректності: тека сховища на операцію, порядок фіксації, якорі thinking, рамка автора, документ передачі після `/clear`; страхувальні тести), логіку `register.ts` винесено в порти (`store.ts`, `rows.ts`, `tools.ts`, Snapshot/RowIndex; `register.ts` 1345 → 910 рядків), специфікацію звірено з кодом; тести 528 → 677, кожна фаза з рев'ю й живим прогоном (PASS). Правила проєкту CONC-01, CONC-02, STRUCT-01. Коміти: 739ee44 (аудит), 7ba49f2, cc99122, bdac482, fd28b07, 5e742ed, 06ed710, 9853538, 129bbf9, 8187b3e, e0d6b2e, a0b0b0b. Відкрите — backlog CF-28…CF-53 [плану аудиту](../audit/context-editor_20261011_182951.plan.md#PL_AUD_CTX_BACKLOG) (кожен з тригером; CF-34, CF-43, CF-46, CF-51, CF-52, CF-53 закрито фазами 29–32 PL_CTX). Блок виконання і журнал — у [session_2026-10-17](../session_history/session_2026-10-17.md).


## Coordination Notes

## Blocking Issues

## Relevant Context

- Аудит: [звіт](../audit/code-audit_20261011_182951.report.md), [карта](../../docs/_framework.md), знахідки лінз — лише в scratchpad сесії d5614704 (L1).

## Shared Activity Log

- 2026-10-17 [claude-session-c265a77e] audit context: задачу стиснуто — блок виконання й 11 записів журналу перенесено в session_2026-10-17

Full history: ../session_history/session_2026-10-17.md
