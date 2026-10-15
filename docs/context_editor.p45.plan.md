# Редактор контексту агента — Implementation Plan: фаза 45 — Рядки хоста: запис і список з `id`

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** todo
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 45 — Рядки хоста: запис і список з `id` [TODO]  {#PL_CTX_P45}

**Depends on:** Phase 40 (HostFrame, слова людини).
**Implements:** [C_CTX_06_10](./context_editor.curation.concept.md#C_CTX_06_10), [C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11) (рядки хоста), [SP_CTX_DEC_42](./context_editor.curation.sp.md#SP_CTX_DEC_42) B″; [SP_CTX_01_31](./context_editor.curation.sp.md#SP_CTX_01_31), MAX_HOST_ROWS, MAX_HEAD, MAX_HOST_LIST і MAX_HOST_TEXT з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32), поле `host` правки `drop` у [SP_CTX_01_30](./context_editor.curation.sp.md#SP_CTX_01_30), [SP_CTX_02_60](./context_editor.curation.sp.md#SP_CTX_02_60), [SP_CTX_02_61](./context_editor.curation.sp.md#SP_CTX_02_61), [SP_CTX_04_09](./context_editor.curation.sp.md#SP_CTX_04_09), пункти [SP_CTX_03_03](./context_editor.curation.sp.md#SP_CTX_03_03) і [SP_CTX_03_04](./context_editor.curation.sp.md#SP_CTX_03_04) про `host` і записи; ланцюжок `hostrows` (ранг 4).
**Verify:** [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05) рядки RecordHostRows (4), HostList (8); [SP_CTX_05_06](./context_editor.curation.sp.md#SP_CTX_05_06) «Запис лишається, лише поки попередник повертається зі своїм `handle`», «У вікні копій записів немає»; [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) «Рядки хоста» (п'ять кроків і чотири перевірки практики) в терміналі й stream-json; [SP_CTX_05_08](./context_editor.curation.sp.md#SP_CTX_05_08) «Чотири однакові розгорнуті навички», «Свіжий рядок хоста», «Сесія, відкрита знову», «Обхід дверей `session.append` керованим плагіном», «Попередник рядка хоста — відповідь агента з thinking», «Попередник рядка хоста — промпт людини»; опис `context_edit` ≤ MAX_DESCRIPTION (`tests/boundary.test.ts` тримає точну довжину); відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| сховище `hostrows.json`, RecordHostRows, вікно копій, фіксація після точки фіксації обробника, ремонт, засів, чужа компактизація | новий `hooks/hostrows.ts` (порт HostRowsIO), `hooks/store.ts` (ланцюжок `hostrows`) |
| прив'язка: `session.append` (тека сховища одразу, CONC-01), вхід хука `session.compact`, `turn.start` і промпт людини закривають вікно | `hooks/register.ts` |
| список рядків хоста в `context_list` (рядок заголовка й секція) | `hooks/stages.ts` |
| `drop` з `host`: HOST_EXCLUSIVE, HOST_UNKNOWN, HOST_TWICE при постановці, DetachNote; при застосуванні після решти кроків — Detach за `handle`, HOST_MEDIA, рядки звіту | `hooks/edits.ts`, `hooks/compaction.ts` |
| BuildSeed без записів, ремонт і спостерігач | `hooks/handoff.ts`, `hooks/repair.ts`, `hooks/compaction.ts` |
| ціль `"host"` у рядку `drop` опису `context_edit` | `hooks/tools.ts` |
| CLAUDE.md: модуль `hooks/hostrows.ts`, файл `hostrows.json` і ланцюжок `hostrows` у `serialChains` | `CLAUDE.md` |
| тести | новий `tests/hostrows.test.ts`, `tests/store.test.ts` (ланцюжок), `tests/edits.test.ts`, `tests/compaction.test.ts`, `tests/stages.test.ts`, `tests/boundary.test.ts` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
