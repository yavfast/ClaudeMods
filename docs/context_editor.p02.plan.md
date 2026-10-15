# Редактор контексту агента — Implementation Plan: фаза 2 — Медіа в результатах інструментів

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 2 — Медіа в результатах інструментів [DONE]  {#PL_CTX_P2}

**Depends on:** Phase 1; виконується після фаз 3 і 7 ([PL_CTX_DEC_02](./context_editor.plan.md#PL_CTX_DEC_02), [PL_CTX_DEC_03](./context_editor.plan.md#PL_CTX_DEC_03))
**Implements:** [SP_CTX_01_08](./context_editor.structures.sp.md#SP_CTX_01_08), [SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10) для результатів інструментів, медіа-частини [02_04](./context_editor.edits.sp.md#SP_CTX_02_04), [02_05](./context_editor.edits.sp.md#SP_CTX_02_05), [02_07](./context_editor.edits.sp.md#SP_CTX_02_07); [C_CTX_DEC_06](./context_editor.core.concept.md#C_CTX_DEC_06)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки CollectMedia, «незмінений рядок з медіа», «медіа не заархівовано», «медіа сусідньої пари», «вікно API», DropOwnCalls «спільний рядок» (модульні — є); [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Скриншот у результаті інструменту», «Документ у результаті інструменту», «Незмінене медіа» — плюс: медіа-файл в архіві відкривається інструментом читання і має права 0600

Код і модульні тести вже є. Живі сценарії «Скриншот…», «Документ…», «Незмінене медіа» — pass (2026-10-09); тестові файли — `.dev_flow/cache/live-test/make-media.sh`. Припущення підтверджено наживо:
- блоки `image` і `document` в API-поданні мають `source.type = base64` — заархівовано всі медіа сценаріїв, жодного «media could not be archived»;
- `stdin` у `$.process.run` приймає кілька мегабайт: архів одного застосування 6.2 МБ записано через `writeText`. До `writeMedia` більше ~0.7 МБ base64 не доходить: Read перекодовує великі зображення в JPEG до ~0.5 МБ, а великий PDF віддає сторінками-JPEG, не документом.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
