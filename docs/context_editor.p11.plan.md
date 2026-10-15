# Редактор контексту агента — Implementation Plan: фаза 11 — Довіра межі, чесний звіт, реєстри після передачі

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 11 — Довіра межі, чесний звіт, реєстри після передачі [DONE]  {#PL_CTX_P11}

**Depends on:** Phase 10; спайк [context_editor_handoff_long](./context_editor_handoff_long.spike.md) Entry 6; рішення розробника 2026-10-09 ([SP_CTX_DEC_10](./context_editor.decisions-01.sp.md#SP_CTX_DEC_10)) і рев'ю раунд 20 (ідентичність без `ps`, зняття `host` після `/resume` у процесі); виконується перед фазами 4 і 5
**Implements:** [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (`FormatReport(report, archive, kind)`, без рядка розміру при 0 правок), [01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (HOST_ENV), [01_14](./context_editor.records.sp.md#SP_CTX_01_14) (`host`, `hostId`, ParseHostId), [01_17](./context_editor.records.sp.md#SP_CTX_01_17) (`visible`, `edits`, інваріант реєстрів), [02_04](./context_editor.apply.sp.md#SP_CTX_02_04) (`apiTruncated`), [02_07](./context_editor.apply.sp.md#SP_CTX_02_07), [02_10](./context_editor.apply.sp.md#SP_CTX_02_10) (`apiTruncated` при ≥ ROW_WINDOW − 1), [02_14](./context_editor.tags.sp.md#SP_CTX_02_14), [02_15](./context_editor.tags.sp.md#SP_CTX_02_15), [02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (`Trusted(b)`, власна межа, зняття `host` після перемикання сесії), [02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) (крок реєстрів: читання, узгодження, запис), [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22) (`charsAfter` до CarryNote і голови, WINDOW_FULL); [SP_CTX_DEC_07](./context_editor.decisions-01.sp.md#SP_CTX_DEC_07), [SP_CTX_DEC_10](./context_editor.decisions-01.sp.md#SP_CTX_DEC_10)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки: CurrentRows «гаряче перезавантаження», «перший перелік після перезавантаження», «інший процес», «межа без `host`», «власна межа без `host`», «`/resume` у тому самому процесі», «перша підготовка після завантаження», «ідентичність не прочиталась», «межа засіяної сесії»; ParseHostId «розбір»; hostId «ще не прочитано»; RecordBoundary «запис», «`host`»; HandleSeed «засів»; CollectMedia «`apiTruncated`»; ApplyEdits «правка поза вікном», «промпт перед першою парою, повне подання», «промпт перед першою парою, обрізане подання»; FormatReport «форми»; HandleCompaction «жодної правки», «правки застосовано»; BuildSeed «засів без правок», «засів з правками»; RunHandoff «теги й псевдоніми», «псевдонім зміненої пари», «тег на зміненій парі», «disposable з заміною в пакеті засіву», «збій узгодження реєстру», «незмінена пара», «пара поза засівом». [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03): «Гаряче перезавантаження (обидва хости)», «Передача засівом зі зміненою парою з псевдонімом (обидва хости)», «Відновлення сесії (лише текст)», «Відновлення сесії (медіа або злиття відповіді)». [SP_CTX_05_04](./context_editor.edges.sp.md#SP_CTX_05_04): «Другий процес хоста з тією самою сесією». Живе: у сесії з компактизацією, яку хост відхилив обробником (`skip`), людина бачить рядок хоста «Not compacted · <причина>» — це мітка хоста для скасованої компактизації, а звіт мода при цьому без «tokens freed». Плюс механічне: `claude plugin test`, `claude plugin validate`, tsc (лише відомі `isDeferred`)

| Що | Де |
|----|----|
| ParseHostId (чиста функція), `hostId` — одна обіцянка на екземпляр модуля (токен HOST_ENV через `$.env.set`, `sh -c 'echo $PPID'`), `host` у Boundary, `Trusted(b)` з власною межею, `host` не рядком ігнорується, зняття `host` після перемикання сесії в процесі | `mods/context-editor/hooks/edits.ts` (ParseHostId, `currentRows`, тип Boundary, Trusted), `register.ts` (читання ідентичності — одна обіцянка з `session.start` або першого PrepareStorage; `$.env.get`/`$.env.set` приймають рядковий літерал, тож `'CONTEXT_EDITOR_HOST'` пишеться прямо у викликах, а HOST_ENV лише документує значення; `view()`, RecordBoundary, HandleSeed, PrepareStorage); `tests/boundary.test.ts` |
| `apiTruncated` у CollectMedia (≥ ROW_WINDOW − 1), умова `earlyPrompt`, WINDOW_FULL | `edits.ts`; `compaction.ts`, `handoff.ts` (виклики); `tests/edits.test.ts`, `handoff.test.ts` |
| `FormatReport(…, kind)`, `charsAfter` засіву до CarryNote і голови, звіт передачі без зайвого переносу | `edits.ts` (`formatReport`), `compaction.ts`, `handoff.ts`; `tests/edits.test.ts`, `compaction.test.ts`, `handoff.test.ts` |
| HandoffSeed `visible` і `edits`; реєстри нової сесії — читання старого, RebindTags / обрізання псевдонімів, запис нового, окремо для кожного | `handoff.ts` (крок реєстрів), `tags.ts`, `aliases.ts`, `register.ts`; `tests/handoff.test.ts` |
| Навичка й CLAUDE.md | `.dev_flow/skills/claude-code/plugin-hooks.md` — пункти 7, 30, 32–35 (32: ідентичність токеном і pid без `ps`); `CLAUDE.md` (рядок про `/clear` і межу — довіра за процесом хоста) |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
