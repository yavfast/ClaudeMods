# Редактор контексту агента — Implementation Plan: фаза 42 — Перевірка залежностей і слід власних викликів

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-16
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 42 — Перевірка залежностей і слід власних викликів [DONE]  {#PL_CTX_P42}

**Depends on:** Phase 41 (Quoted у відкривачі).
**Implements:** [C_CTX_06_07](./context_editor.curation.concept.md#C_CTX_06_07); [SP_CTX_02_63](./context_editor.curation.sp.md#SP_CTX_02_63), [SP_CTX_02_64](./context_editor.curation.sp.md#SP_CTX_02_64); поле `quoted` у [SP_CTX_01_30](./context_editor.curation.sp.md#SP_CTX_01_30); MAX_DEP_FRAGMENTS, DEP_MIN, DEP_MAX, DEP_EXAMPLES, MAX_TRACE і голова TRACE_OPENER з [SP_CTX_01_32](./context_editor.curation.sp.md#SP_CTX_01_32); пункт [SP_CTX_03_04](./context_editor.curation.sp.md#SP_CTX_03_04) про рядок сліду.
**Verify:** [SP_CTX_05_05](./context_editor.curation.sp.md#SP_CTX_05_05) рядки DependencyCheck (2), TraceOwnCalls (2); [SP_CTX_05_06](./context_editor.curation.sp.md#SP_CTX_05_06) «Рядок сліду лише там, де прибрано власні пари»; [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) «Слід власних викликів». Обидва механізми — гіпотези: якщо живий прогін не прибирає P13 і P23 або слід заважає, механізм спрощують чи знімають (backlog із причиною), а не латають раундами рев'ю; відкат — [SP_CTX_06_02](./context_editor.curation.sp.md#SP_CTX_06_02).

| Що | Де |
|----|----|
| Fragments і Note при постановці `summarize`, `drop`, `collapse`; прапор `quoted` у правці | `hooks/edits.ts`, `hooks/queue.ts` |
| TraceOwnCalls у DropOwnCalls: один рядок на відрізок від промпту до промпту; голова TRACE_OPENER — у REPLACEMENT_OPENERS | `hooks/edits.ts`, `hooks/rows.ts` |
| тести | `tests/edits.test.ts`, `tests/compaction.test.ts`, `tests/rows.test.ts` (ReplacementText), `tests/queue.test.ts` (QueueEdits, ParseQueue), `tests/handoff.test.ts` (засів), `tests/repair.test.ts` (Repeats) |

**Результат (2026-10-16):** 923 тести, рев'ю «pass with advisories» (виправлено: обмежені lookahead-и, фрагменти рядок за рядком, вхід за значеннями, обрізання прози й markdown, `open a stage`, Repeats не рахує сліду). Живий прогін 12 сесій проти коду фази 41 (`.dev_flow/cache/live-test/curation-p42/results.md`): слід 6/6, заперечення викликів 0/6 (контроль 1/6), прямого «вигадав» 0/6 (1/6), обережне «may have made up» про вивід прибраного `context_list` лишилось (3/6 проти 1/6) — слід називає виклик, не вивід; DependencyCheck 6/6, вплив на рішення агента `unobserved`. Відхилення від специфікації за прогоном: фрагменти з пізніших текстів агента, токени з літер і цифр ([SP_CTX_02_63](./context_editor.curation.sp.md#SP_CTX_02_63)).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-16 | Фазу виконано: код, тести, рев'ю, живий прогін; результат вище |
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
