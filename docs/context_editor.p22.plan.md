# Редактор контексту агента — Implementation Plan: фаза 22 — М'яке нагадування

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 22 — М'яке нагадування [DONE]  {#PL_CTX_P22}

**Depends on:** Phase 7 (псевдоніми), Phase 14 (телеметрія, MESSAGES_ROW), Phase 15 (причини `review`, WRITE_TOOLS), Phase 17 (калібрування); [C_CTX_DEC_15](./context_editor.methods.concept.md#C_CTX_DEC_15) = E і [SP_CTX_DEC_21](./context_editor.decisions-21.sp.md#SP_CTX_DEC_21) = C, рішення розробника 2026-10-11 («Розмір + межа етапу»; мета — «збільшення часу якісної роботи агента над складним завданням в одній сесії без ситуації повного заповнення контексту»); практика 3 (P18, P19 задачі етапів; `.dev_flow/cache/practice/`)
**Implements:** [SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37) SoftHint (Candidates, HintText, Bounded), [01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (поле `hint`), [01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (HINT_CONVERSATION, HINT_CANDIDATES, HINT_STEP, HINT_RUN, HINT_NAMES, HINT_RECHECK, HINT_WAIT; INTRO_TEXT), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) (MarkAlias, злитий рядок), [02_09](./context_editor.edits.sp.md#SP_CTX_02_09), [02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (навичка: речення в «Telemetry», без речення про `[review]` без причини), [02_28](./context_editor.telemetry.sp.md#SP_CTX_02_28) (Telemetry без `lastApply` для нагадування)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки SoftHint (розмір: перше нагадування, малий запит, крок, мало кандидатів, мала розмова, lastApply лишається, без псевдоніма, назви, межа етапу, межа етапу без розміру, межа етапу без кандидатів, зменшення, реєстри, без відповіді моделі, паралельний виклик, запис після зменшення, запізнення, одна перевірка за раз), Candidates, Bounded, HintText, HintCall і PickLine, TagRegistry «поле `hint`», MarkCall «злитий рядок» і «без нагадувань», SessionIntro «INTRO_TEXT»; [05_02](./context_editor.scenarios.sp.md#SP_CTX_05_02) «М'яке нагадування нічого не запускає і не дублюється»; [05_04](./context_editor.edges.sp.md#SP_CTX_05_04) рядки м'якого нагадування; `claude plugin test`, `claude plugin validate`, tsc; бюджети: SKILL.md ≤ 8000 (7953), INTRO_TEXT ≤ 1000 (944), описи інструментів без змін (EDIT_DESCRIPTION 2035 з 2048); живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «М'яке нагадування (stream-json, opus)» — повтор дослідження практики 3 з тим самим промптом, порівняння з практикою 3

| Що | Де |
|----|----|
| SoftHint через порт HintIO (дешеві пороги, рядки й черга, розбивка лише за розміром, порівняння-і-запис стану, одна перевірка за раз), Candidates, HintText, Bounded, HintCall, PickLine, константи HINT_* | `mods/context-editor/hooks/hints.ts` (новий, чистий); `tests/hints.test.ts` (новий) |
| Поле `hint` реєстру тегів: тип HintState, розбір | `mods/context-editor/hooks/tags.ts`; `tests/hints.test.ts` |
| MarkAlias (псевдонім без рядка), MarkCall — обгортка | `mods/context-editor/hooks/aliases.ts` |
| INTRO_TEXT: речення про нагадування замість «Nothing reminds you by size» | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts` |
| Зв'язування: `hintIO` (звичайна `usage`, розбивка, калібрування у фоні, стан на ланцюжку реєстру), `hintFor` з HINT_WAIT, хук `tool.call` через HintCall і PickLine; пам'ять `checked`, `busy` | `mods/context-editor/hooks/register.ts` |
| Навичка: речення в «Telemetry», скорочення інших розділів | `mods/context-editor/skills/context-stages/SKILL.md` |
| Живий сценарій: драйвер практики 3, модель opus | `.dev_flow/cache/practice/` (локально) |

Стан 2026-10-11: код і модульні тести готові (494 тести, було 474; `claude plugin validate` і tsc проходять). Рев'ю 52 (WARNINGS) виправлено: `busy` і гальмування після запізнілої перевірки, запис після зменшення контексту, HintCall і PickLine, тексти «(see context_list)» і «up to»; 498 тестів. Живий сценарій 05_03 — далі.

Ризики, які перевіряє Verify: (1) агент і далі не зважує рядок (P18 повторюється) — тоді рядок лише шум, і рішення повертається до розробника (C_CTX_DEC_15); (2) пороги — перші значення розробника, а не виміряні: у дослідженні з великими WebFetch рядок за розміром може прийти рано або пізно, а межа етапу — лише після запису, а не перед ним (мод не бачить наміру писати); (3) ціна на гарячому шляху: рядки розмови читаються на кожному позначеному виводі, поки запит понад поріг, а кандидатів мало (обмежено HINT_RECHECK), — живий журнал покаже, чи результати не затримуються; (4) у довгому ході правки агента застосовуються лише в його кінці: кандидати без поставлених у чергу, але розмір контексту до кінця ходу не зменшується, тож наступне нагадування за розміром прийде за кроком росту.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
