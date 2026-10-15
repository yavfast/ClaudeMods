# Редактор контексту агента — Implementation Plan: фаза 9 — Передача в нову сесію

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 9 — Передача в нову сесію [DONE]  {#PL_CTX_P9}

**Depends on:** Phase 8 (поточна розмова); спайк [context_editor_session](./context_editor_session.spike.md); [C_CTX_DEC_11](./context_editor.methods.concept.md#C_CTX_DEC_11), [C_CTX_DEC_12](./context_editor.methods.concept.md#C_CTX_DEC_12), [C_CTX_DEC_13](./context_editor.methods.concept.md#C_CTX_DEC_13)
**Implements:** [SP_CTX_01_15](./context_editor.structures.sp.md#SP_CTX_01_15), [01_16](./context_editor.structures.sp.md#SP_CTX_01_16), поле `handoff` у [01_04](./context_editor.structures.sp.md#SP_CTX_01_04), [02_19](./context_editor.handoff.sp.md#SP_CTX_02_19)–[02_24](./context_editor.handoff.sp.md#SP_CTX_02_24), skip у [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), константи [01_12](./context_editor.structures.sp.md#SP_CTX_01_12)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки BuildTranscript, CheckTranscript, CheckSwitched, context_handoff, HandleCompaction «передача в черзі», RunHandoff «запасний шлях»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Передача транскриптом», «Передача документом», «Запасний шлях», «Команда людини»; регрес — «Стиснення в межах сесії», «Перегляд після компактизації»

- `hooks/handoff.ts` (новий): `buildTranscript`, `checkTranscript`, `checkSwitched`, розбір і постановка HandoffRequest (`contextHandoff`), оркестрація `runHandoff` через порт `HandoffIO` (читання черги, CurrentRows, API-подання, пошук транскрипту, запис файлу, сховище нової сесії, `command.run`, `session.id`, `model.fork`, `prompt.submit`, тост);
- `hooks/queue.ts`: поле `handoff` у Queue, його перевірка при розборі; `hooks/compaction.ts`: skip `handoff pending`;
- `hooks/register.ts`: інструмент `context_handoff`, команда `/handoff`, запуск RunHandoff після `turn.complete` з паузою HANDOFF_DELAY, зв'язування `HandoffIO` з `$`;
- `tests/handoff.test.ts`: чисті функції й оркестрація через порт (успіх, обидва збої, повернення в стару сесію);
- живі сценарії — драйвер `ce.sh`; збирач і перевірки спайку — `.dev_flow/cache/session-transcript/`.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
