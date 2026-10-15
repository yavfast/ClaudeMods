# Редактор контексту агента — Implementation Plan: фаза 4 — Дослідження: медіа в промптах і межі вікон

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 4 — Дослідження: медіа в промптах і межі вікон [DONE]  {#PL_CTX_P4}

**Depends on:** Phase 2
**Implements:** закриття [SP_CTX_DEC_06](./context_editor.decisions-01.sp.md#SP_CTX_DEC_06)
**Verify:** spike-файл [context_editor_media.spike.md](./context_editor_media.spike.md) з даними живого прогону: обидва подання розмови і рядки `e.messages` для сесії з промптами людини з медіа і нагадуваннями; висновок A / B / C; межі вікон трьох подань — concluded 2026-10-10

Time-box: одна сесія. Результат (2026-10-10, хост 2.1.296, stream-json і термінал): розробник обрав B з перевіркою A — ходи людини від хвоста, кожна пара перевіряється текстом і ідентифікаторами ([SP_CTX_DEC_06](./context_editor.decisions-01.sp.md#SP_CTX_DEC_06) resolved, правило — PromptMatch у [SP_CTX_02_10](./context_editor.apply.sp.md#SP_CTX_02_10)); межі вікон — рядки 4096 з усього транскрипту, API 4096 повідомлень від межі, `e.messages` — усе від межі без ліміту (навичка plugin-hooks, пункти 47–51). Проба, драйвери, дампи й еталон `match.py` — `.dev_flow/cache/media-spike/` (локально).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
