# Редактор контексту агента — Implementation Plan: фаза 36 — Дані старих сесій: видалення і пакування

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 36 — Дані старих сесій: видалення і пакування [DONE]  {#PL_CTX_P36}

**Depends on:** Phase 35 (каталог архівів у проєкті).
**Implements:** [C_CTX_DEC_29](./context_editor.core.concept.md#C_CTX_DEC_29), [C_CTX_03_10](./context_editor.core.concept.md#C_CTX_03_10); [SP_CTX_02_50](./context_editor.cleanup.sp.md#SP_CTX_02_50) SweepSessions, [SP_CTX_02_51](./context_editor.cleanup.sp.md#SP_CTX_02_51) PackSession, [SP_CTX_02_52](./context_editor.cleanup.sp.md#SP_CTX_02_52) RestoreSession; крок RestoreSession у PrepareStorage ([SP_CTX_02_15](./context_editor.tags.sp.md#SP_CTX_02_15)); [SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07) файли `archives.txt`, `.zip`, `.where`, `.sweep`; константи SWEEP_*, PACK_IDLE_MS ([SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)).
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки SweepSessions, PackSession, Packer, RestoreSession; живий сценарій 05_03 «Старі сесії».

| Що | Де |
|----|----|
| SweepSessions, PackSession, RestoreSession, Packer за портом `CleanupIO` (list, stat, exists, run, remove, rename, now) | `mods/context-editor/hooks/cleanup.ts` (новий, чистий) |
| Прив'язка: `session.start` → `$.clock.after(SWEEP_DELAY_MS)` → Sweep; RestoreSession у `prepareIO` до `mkdir`; перевірка каталогу сховища в `prompt.submit`; `archiveRoot` пише `archives.txt` | `mods/context-editor/hooks/register.ts`, `hooks/store.ts` |
| Тести: усі рядки 05_01 фази 36 з фальшивим `CleanupIO` | `tests/cleanup.test.ts` |
| CLAUDE.md: прибирання і пакування | `CLAUDE.md` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
