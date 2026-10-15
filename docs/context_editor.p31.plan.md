# Редактор контексту агента — Implementation Plan: фаза 31 — Дрібні вади: запит форку передачі, помилки пошуку, прибраний псевдонім

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 31 — Дрібні вади: запит форку передачі, помилки пошуку, прибраний псевдонім [DONE]  {#PL_CTX_P31}

**Depends on:** PL_AUD_CTX фаза 5 (рамка автора тексту мода, [SP_CTX_DEC_17](./context_editor.sp.md#SP_CTX_DEC_17), DOCUMENT_FRAME), фаза 6a (живий прогін, де знайдено CF-43), фаза 11 (живий прогін, де знайдено CF-52 і CF-53); пункти backlog аудиту CF-43, CF-52, CF-53 (standard, S). Розвилок немає — рішення без DEC.
**Implements:** [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) і [SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (HANDOFF_PROMPT з рамкою, CF-43); [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11) R3, [SP_CTX_02_12](./context_editor.tags.sp.md#SP_CTX_02_12) AutoTagNeeded, [SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16) WorthEditing з `isError` (CF-52); [SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17) і [SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12) ALIAS_GONE (CF-53)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки DocumentWay (рамка запиту форку), AutoTag (R3 помилка), AutoTagNeeded і MarkCall (помилка пошуку), ResolveRef (прибраний псевдонім), наявні AutoTag «R1, R2, R3», MarkCall «великий вивід», ResolveRef «розв'язання»; [SP_CTX_05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки фази 31; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Документ форку передачі без запиту мода» (stream-json і термінал; лише CF-43 залежить від хоста — як модель форку читає рамку)

Рішення без розвилок: (1) CF-43 — HANDOFF_PROMPT відкриває PREFIX з автором, як DOCUMENT_FRAME фази 5 аудиту, і закінчується реченням «This request and its rules apply to this answer only: leave them out of the document.»; заборона викликів лишається — вона потрібна форку (Verify фази 10, F4); (2) CF-52 — помилка пошуку не вивід пошуку: R3, AutoTagNeeded і WorthEditing (псевдонім і пропозиція м'якого нагадування) пропускають результат з `is_error`, а великий результат-помилка лишається для R2 і псевдоніма за розміром — він займає контекст однаково; (3) CF-53 — UNKNOWN_REF для `c<n>` з `n < next` без запису каже ALIAS_GONE (нового стану не треба: `next` уже в реєстрі); перелік прибраних псевдонімів у `context_list` не додається — дорожче, а агент дізнається тоді, коли звертається.

| Що | Де |
|----|----|
| HANDOFF_PROMPT з рамкою автора і реченням про документ | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| WorthEditing(tool, size, isError) | `mods/context-editor/hooks/rows.ts`; `tests/rows.test.ts` |
| AppendFacts: `isError` кожного результату з `is_error` блоку; R3 і AutoTagNeeded — лише для результатів без помилки | `mods/context-editor/hooks/tags.ts`; `tests/tags.test.ts` |
| CallFacts `isError` (з `done.isError`), WantsMark через WorthEditing; ALIAS_GONE (дім — поруч із LAST_TEXTS) у RefResolver | `mods/context-editor/hooks/aliases.ts`; `tests/aliases.test.ts` |
| `callFacts(e, done)` бере `done.isError`; позначка пропозиції м'якого нагадування — через WorthEditing | `mods/context-editor/hooks/register.ts` |

Кроки: три незалежні правки, кожна зі своїми тестами 05_01; далі `claude plugin test`, validate, tsc; живий сценарій форку. Навичка, INTRO_TEXT і описи інструментів (`tools.ts`) без змін.

Ризики, які перевіряє Verify: (1) модель форку може й далі переносити заборону викликів у документ — тоді спробувати сильніше формулювання в живому сценарії, не міняючи механіки; (2) `is_error` хост ставить на результат відхиленого чи невдалого виклику; пошук, що «нічого не знайшов», помилкою не є і позначається як раніше; (3) ALIAS_GONE не розрізняє причину (застосування, чужа компактизація, вікно MAX_ALIASES) — свідомо, порада однакова.

Стан 2026-10-12: код і модульні тести готові — 771 тест після фази 31 (750 до фаз 29–31); validate, tsc, skill-limits проходять. HANDOFF_PROMPT — `modText(…)` з рамкою і кінцевим реченням; `worthEditing(tool, size, isError)`; AppendFacts — `isError` результату, R3 і AutoTagNeeded без помилок пошуку; CallFacts — `isError` з `done.isError`; `aliasGone` (ALIAS_GONE) у `refResolver`. Відхилення від таблиці файлів: `register.ts` без змін — `callFacts(e, done)` уже отримує `done`, а позначка пропозиції м'якого нагадування вже йде через `wantsMark` (тепер — WorthEditing з `isError`); тест передачі «псевдонім зміненої пари» і рядки 05_01 (RunHandoff), 05_03 (передача засівом з псевдонімом), 02_02 (помилки `ref`) тепер називають ALIAS_GONE. Навичка, INTRO_TEXT і `tools.ts` без змін. Живий сценарій 05_03 «Документ форку передачі без запиту мода» — pass в обох хостах (`.dev_flow/cache/live-test/phase29-31-results.md`).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
