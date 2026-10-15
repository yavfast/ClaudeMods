# Редактор контексту агента — Implementation Plan: фаза 21 — ref "last"

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 21 — ref "last" [DONE]  {#PL_CTX_P21}

**Depends on:** Phase 7 (псевдоніми), Phase 15 (`callId` і рядок-носій у `context_tag`), Phase 16 (`context_note`), Phase 20 (живий прогін, s5 — `.dev_flow/cache/live-test/phase20-results.md`, F1); [SP_CTX_DEC_20](./context_editor.decisions-01.sp.md#SP_CTX_DEC_20) = A + C, рішення розробника 2026-10-11
**Implements:** [SP_CTX_02_17](./context_editor.tags.sp.md#SP_CTX_02_17) (ResolveRef з рядками і `callId`, ResolveLast, рядок `"last" = <CallLabel>`), [01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (LAST_TEXTS), [01_13](./context_editor.records.sp.md#SP_CTX_01_13) (без поля `last`; старий файл читається), [02_16](./context_editor.tags.sp.md#SP_CTX_02_16) (MarkCall без `last`), [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (`callId`, вихід, EDIT_DESCRIPTION пункт (3), опис поля `ref`), [02_03](./context_editor.edits.sp.md#SP_CTX_02_03) (причини LAST_NONE / LAST_PENDING), [02_11](./context_editor.tags.sp.md#SP_CTX_02_11) і [02_32](./context_editor.stages.sp.md#SP_CTX_02_32) (ResolveRef з рядками, `callId` у `context_note`, рядок `last` у виході, текст UNKNOWN_REF)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки MarkCall «великий вивід», ResolveRef, context_tag «ціль за `ref`», ResolveLast (малий виклик після позначеного, власні виклики, паралельні виклики, виклик тієї самої відповіді з результатом і без, виклики після свого, немає виклику, без `callId`, реєстр нечитабельний чи старий), EDIT_DESCRIPTION «`last`»; [05_04](./context_editor.edges.sp.md#SP_CTX_05_04) рядки `ref: "last"`; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «`ref: "last"` після малого виклику» у stream-json: (а) відтворення s5 фази 20 — процес 1 `sleep 14; cat big.log` (`c1`), процес 2 `-p --resume`, `cat c.log`, summarize з `"ref":"last"` — замінено `c.log`, `big.log` незмінний, у результаті `context_edit` рядок `"last" = Bash … cat c.log`; (б) те саме в одному процесі з `context_note` перед `context_edit`. SKILL.md (7991 з 8000) і INTRO_TEXT не змінюються: приклад `{"notes":[{"op":"add","ref":"last",…}]}` у навичці за A стає точнішим

| Що | Де |
|----|----|
| ResolveLast і CallLabel (чисті), ResolveRef з рядками і `callId`, що повертає id з рядком або причину; AliasRegistry без `last` (`addAlias`, `pruneAliases`, `parseAliases` ігнорує старе поле) | `mods/context-editor/hooks/aliases.ts`; `tests/aliases.test.ts` |
| Тип RefResolver з причиною відмови, `resolveEditRefs` і `refError` з причиною ResolveLast; CallLabel — спільний з переліком запис виклику (`oneLine`, 70 символів) | `mods/context-editor/hooks/edits.ts`; `tests/edits.test.ts` |
| `contextEdit` / `queueEdits` з `callId`, рядок `"last" = …` у `queuedText` | `mods/context-editor/hooks/queue.ts`; `tests/queue.test.ts` |
| `context_tag` і `context_note`: розв'язання за рядками (вже прочитаними в обробнику) і `callId`, рядок `last` у результаті, причина в UNKNOWN_REF | `mods/context-editor/hooks/tags.ts`, `hooks/notes.ts`; `tests/tags.test.ts`, `tests/notes.test.ts` |
| Зв'язування: `resolver` з рядками і `e.tool_use_id` для `context_edit` і `context_note`; EDIT_DESCRIPTION пункт (3) (2035 з 2048), описи поля `ref` у схемах `context_edit` і `context_tag` | `mods/context-editor/hooks/register.ts`; `tests/boundary.test.ts` (довжини описів), тести з `ref: 'last'` у `tests/handoff.test.ts`, `tests/media.test.ts` — перевірити |
| Живий сценарій: драйвер фази 20 і фікстури | `.dev_flow/cache/live-test/phase20/` (основа), результат — `.dev_flow/cache/live-test/phase21-results.md` (локально) |

Стан 2026-10-11: код і модульні тести готові (473 тести, було 463; `claude plugin validate` і tsc проходять; EDIT_DESCRIPTION 2035, TAG_DESCRIPTION 1891 з 2048; SKILL.md 7991 з 8000 — без змін); живий сценарій 05_03 — далі. Відхилення від таблиці файлів: `hooks/register.ts` без нового модуля — `resolver($, callId)` лише зв'язує; тести ResolveLast — у `tests/aliases.test.ts`, рядок `last` у результатах — у `tests/queue.test.ts`, `tests/notes.test.ts`, EDIT_DESCRIPTION — у `tests/boundary.test.ts`; `tests/edits.test.ts` і `tests/tags.test.ts` змін не потребували, `tests/media.test.ts` `ref: 'last'` не має (збіг слова), `tests/handoff.test.ts` — лише новий підпис `resolveEditRefs` / `refResolver`. Рев'ю 50 (PASS з побажаннями) і живий сценарій 05_03 — pass в обох варіантах (`.dev_flow/cache/live-test/phase21-results.md`): LAST_ORPHAN для виклику без результату, відділеного рядком промпту (процес убито посеред інструмента, далі `--resume`) — інакше LAST_PENDING назавжди просив би чекати; опис поля `ref` у схемах — `your latest call (context_* calls do not count)`; `callLabel` перенесено в `hooks/edits.ts` і перелік (`listRows`) друкує виклик ним же (REPRO_FLAG — параметром); 474 тести. Причина відмови `ref` у `context_edit` переходить від `resolveEditRefs` до `checkShape` символом на сирій правці (не полем, яке може надіслати агент).

Ризик, який перевіряє Verify: рядок поточного виклику `context_*` є в `$.session.messages()` посеред ходу (навичка plugin-hooks, пункт 52; в обох хостах — `.dev_flow/cache/live-test/phase14-results.md`, пункт d: `context_list` лічить і власний рядок виклику, `e.tool_use_id` є в `context_tag`) — інакше carrier = кінець рядків, і виклик тієї самої відповіді без результату дасть LAST_PENDING лише тоді, коли його рядок уже записано; сценарій (б) і модульний рядок «без `callId`» це покривають.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
