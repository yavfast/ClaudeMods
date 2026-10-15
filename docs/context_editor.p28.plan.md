# Редактор контексту агента — Implementation Plan: фаза 28 — Заміни від імені агента і рядок людини після застосування

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 28 — Заміни від імені агента і рядок людини після застосування [DONE]  {#PL_CTX_P28}

**Depends on:** Phase 19 і 27 (тексти замін, носій `collapse`), спайк [context_editor_authorship](./context_editor_authorship.spike.md) (concluded 2026-10-12, рекомендація V6), проба `$.ui.log` (`.dev_flow/cache/live-test/ui-log-probe-results.md`); рішення розробника 2026-10-12: «Від імені агента, без позначки (Recommended)» і «Так (Recommended)».
**Implements:** [SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17) (перегляд A″), [C_CTX_DEC_25](./context_editor.core.concept.md#C_CTX_DEC_25), [C_CTX_DEC_26](./context_editor.core.concept.md#C_CTX_DEC_26); [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04) (тексти замін, ReplacementText, CollapseText, DescribedText), [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (PersonText), [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06) і [SP_CTX_02_07](./context_editor.apply.sp.md#SP_CTX_02_07) (LogApply, `reported(id, line)`), [SP_CTX_02_16](./context_editor.tags.sp.md#SP_CTX_02_16) (R5 (а)), [SP_CTX_02_21](./context_editor.handoff.sp.md#SP_CTX_02_21) (LogSeeded), [SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (навичка), [SP_CTX_02_37](./context_editor.telemetry.sp.md#SP_CTX_02_37) (кандидати), [SP_CTX_02_43](./context_editor.stages.sp.md#SP_CTX_02_43) (ApplyLine і LogApply), [SP_CTX_01_05](./context_editor.structures.sp.md#SP_CTX_01_05) (OwnCallsText), [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки ReplacementText, ApplyLine (рядок людини, з обробника), LogApply (рядок людини після застосування, передача), FormatReport P13, ApplyEdits «хто написав заміну», «collapse», «describe», collapsedWords, CarrierIds, CollapsedList, AutoTag R5, Candidates, context_list «носій без `~`», QueueTagReplacements, parseQueue «via», SKILL.md (опис ≤ 250, файл ≤ 9000 символів — `sh mods/context-editor/tests/skill-limits.sh`); `claude plugin test`, `claude plugin validate`, tsc; живі сценарії [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Авторство замін від імені агента» (≥ 6 прогонів haiku і ≥ 3 sonnet; поріг — (b) Y ≥ ~60 % для haiku, жодного N для sonnet; тексти `rewrite` і `describe`) і «Рядок людини після застосування» (термінал з `--resume`, stream-json, VS Code — людина бачить рядок); граничні випадки [SP_CTX_05_04](./context_editor.edges.sp.md#SP_CTX_05_04) фази 28

| Що | Де |
|----|----|
| REPLACED, SUMMARIZED, REWRITTEN, DESCRIBED, COLLAPSED_OPENER, `collapsedWords` без MARK (дім — `rows.ts`, `edits.ts` реекспортує); LEGACY_COLLAPSED_OPENER, LEGACY_DESCRIBED; ReplacementText, CollapseText, DescribedText | `mods/context-editor/hooks/rows.ts` |
| тексти замін summarize, collapse, rewrite, describe без MARK; позначка `*`, CarrierIds, CollapsedList — за предикатами `rows.ts`; OwnCallsText; ApplyLine і Kilo | `mods/context-editor/hooks/edits.ts` |
| PersonText, кандидати м'якого нагадування, R5 (а) — за ReplacementText | `mods/context-editor/hooks/deliveries.ts`, `hints.ts`, `tags.ts` |
| HandleCompaction передає `reported(id, ApplyLine)` | `mods/context-editor/hooks/compaction.ts` |
| LogApply (`logApplied`) у Flush після команди, до продовження; порти `log`, `appliedLine` | `mods/context-editor/hooks/flush.ts` |
| LogSeeded (`logSeeded`) після засіяної сесії; порт `log` | `mods/context-editor/hooks/handoff.ts` |
| зв'язування `$.ui.log` (Flush, передача) і пам'ять `applies.line` | `mods/context-editor/hooks/register.ts` |
| розділ «Compressed rows and mod texts» замість «Rows marked [context-editor]», опис з відкривачем `Later, your context_edit` (8994 символи) | `mods/context-editor/skills/context-stages/SKILL.md` |
| тести ReplacementText, ApplyLine, LogApply; оновлено тексти замін і речення P13 у наявних | `mods/context-editor/tests/rows.test.ts`, `edits.test.ts`, `flush.test.ts`, `compaction.test.ts`, `compaction-fixtures.ts`, `handoff.test.ts`, `tags.test.ts`, `hints.test.ts`, `media.test.ts`, `notes.test.ts`, `stages.test.ts` |
| пункт 62 — `$.ui.log` (термінал, `--resume`, stream-json, модель не бачить; результати живого прогону); зміст «пункти 1–62» і рядок версій | `.dev_flow/skills/claude-code/plugin-hooks.md` |
| рев'ю: QueuedEdit `via: 'tag'` з QueueTagReplacements і тексти `Later, your context_tag disposable tag replaced …` (TAG_SUMMARIZED, TAG_REWRITTEN, TAG_COLLAPSED_OPENER); REPLACED = `Later, your context_`, ReplacementText за повними відкривачами (REPLACEMENT_OPENERS); parseQueue приймає лише `via: "tag"` | `mods/context-editor/hooks/rows.ts`, `edits.ts`, `tags.ts`, `queue.ts` |
| рев'ю: OwnCallsText «Your context_* calls (N), including the ones that queued these replacements, were removed …»; ApplyLine `applied N edit(s): conversation ~A → ~B tokens (freed ~X)`, «approx.» без калібрування, звільнене заокруглено як Estimate; зайвий імпорт MARK у `queue.ts` прибрано | `mods/context-editor/hooks/edits.ts`, `queue.ts` |
| рев'ю: опис навички 236 символів (було 261 > 250), файл 8988; перевірка меж `sh mods/context-editor/tests/skill-limits.sh` (тести `claude plugin test` не мають файлової системи — перевірено пробою) | `mods/context-editor/skills/context-stages/SKILL.md`, `mods/context-editor/tests/skill-limits.sh` |

Чому рядок людини пише Flush, а не обробник компактизації: обробник працює посеред компактизації хоста, і в терміналі рядок, записаний тоді, ліг би перед межею, яку хост ще не записав. `$.command.run('compact')` повертається, коли обробник відповів, тож Flush пише рядок після застосування і до продовження; обробник лише лишає рядок у пам'яті екземпляра з ідентифікатором свого звіту ([SP_CTX_02_43](./context_editor.stages.sp.md#SP_CTX_02_43)). `/compact` людини застосовує пакет тим самим Flush.

Стан 2026-10-12: код і модульні тести готові — 750 тестів (744 після фази 27; +6 нових: ReplacementText, ApplyLine, ApplyLine з обробника, LogApply ×2, parseQueue «via»), `claude plugin validate`, tsc і `tests/skill-limits.sh` проходять.

Живий прогін 2026-10-12 (`.dev_flow/cache/live-test/phase28-results.md`, 2.1.296; stream-json — 17 сесій, термінал з проксі і `--resume`): (1) авторство summarize + collapse — haiku (b) «читав cfg.txt сам» 6/9 (A′ — 6/18; p ≈ 0,13, разом зі спайком V3 + V6 22/35 — p ≈ 0,05), N 1/9; sonnet 3/3; (a) «написав сам» 12/12, жодного «написав мод»; нове речення звіту підозри не викликало; (2) `rewrite` — своє; `describe` слабкий — haiku «бачило картинку» 0/3, двоє відкликають і авторство опису → backlog; (3) рядок людини — термінал (сірий, під `⎿ Compacted`, після `--resume` на місці), 0 у 27 тілах запитів, `ui_log` у 17/17 сесіях stream-json, передача і `/compact` людини — pass; у терміналі без калібрування числа занижено на ~40 % (~24k проти ~41,5k) → «approx.» (рев'ю), калібрування — backlog; у VS Code рядок не малюється (див. «Лишається»); (4) не від фази 28: після двох звичайних застосувань `--resume` дав один `ensureToolResultPairing` (злиття за `message.id`) → backlog «Ремонт після відновлення». Журнали: помилок мода, `chain order` і помилок API — 0 у 21.

Рев'ю (без блокерів), виправлено: (1) medium — заміни з тегу `disposable` казали «your context_edit … call», хоча агент ставив тег: `via: 'tag'` і тексти `context_tag`, ReplacementText за повними відкривачами; (2) low-medium — речення звіту рахує всі власні пари, тож «made these replacements» було неточно: «including the ones that queued these replacements»; (3) medium — опис навички 261 > 250 символів: 236, перевірка `tests/skill-limits.sh`; (4) рядок людини: спершу виміряне (`conversation ~A → ~B tokens`), «approx.» без калібрування, заокруглення Estimate; (5) зайвий імпорт MARK; (6) зміст і рядок версій навички plugin-hooks; (7) backlog нижче.

Лишається: (1) розкид haiku (H/N у 3 з 9); (2) `describe` — backlog; (3) фрагмент `context_list` (70 символів) — лише відкривач (backlog); (4) рядок людини в stream-json не пишеться в JSONL, розширення VS Code `ui_log` не малює (спостереження людини 2026-10-12, 2.1.296: у чаті лише промпт плагіна) — у VS Code рядок людини бачить лише через сам звіт у промпті; (5) рядка немає, коли людина сама набрала `/compact` з MARKER або модуль перезавантажився між обробником і Flush (05_04).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
