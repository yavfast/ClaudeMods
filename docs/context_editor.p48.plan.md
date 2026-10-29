# Редактор контексту агента — Implementation Plan: фаза 48 — Заголовок сесії за темою задачі

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-29
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 48 — Заголовок сесії за темою задачі  {#PL_CTX_P48}

**Depends on:** Phase 45 (крок Detach рядків хоста і записи HostRows), Phase 44 (запити `context_tag` поряд зі слотом стану), Phase 21 (передача несе реєстр тегів).
**Implements:** [C_CTX_03_12](./context_editor.methods.concept.md#C_CTX_03_12), [C_CTX_DEC_41](./context_editor.methods.concept.md#C_CTX_DEC_41)–[C_CTX_DEC_44](./context_editor.methods.concept.md#C_CTX_DEC_44); [SP_CTX_01_33](./context_editor.title.sp.md#SP_CTX_01_33) TitleState, [SP_CTX_02_70](./context_editor.title.sp.md#SP_CTX_02_70) TitleOp, [SP_CTX_02_71](./context_editor.title.sp.md#SP_CTX_02_71) PersonRename, [SP_CTX_02_72](./context_editor.title.sp.md#SP_CTX_02_72) RenameAtTurnEnd, [SP_CTX_02_73](./context_editor.title.sp.md#SP_CTX_02_73) DropRenameRows, [SP_CTX_02_74](./context_editor.title.sp.md#SP_CTX_02_74) CarryTitle, [SP_CTX_DEC_46](./context_editor.title.sp.md#SP_CTX_DEC_46).
**Verify:** рядки [§05 заголовка](./context_editor.title.sp.md#SP_CTX_TITLE_05) (01_33, 02_70–02_74) у `tests/title.test.ts` і тестах модулів, що змінилися; tsc, `claude plugin validate`, `claude plugin test`, `tests/skill-limits.sh` зелені; живий сценарій §05 у терміналі (`ce.sh`) і stream-json — зокрема ворота SP_CTX_DEC_46: після застосування з правками у формі API немає рядків `/rename`.

| Що | Де |
|----|----|
| Чистий модуль заголовка: тип TitleState і перевірка поля, TitleDue, операція заголовка над станом (рядки результату, коди TITLE_*), PersonRename, переходи «команда пройшла» / «відмова», обрізання `runs`, IsRenameRow (видимий рядок команди `/rename` з тими args), CarryTitle; константи MAX_TITLE, MAX_TITLE_RUNS, MAX_TITLE_REFUSED | `mods/context-editor/hooks/title.ts` (новий), `tests/title.test.ts` (новий) |
| Поле `title` реєстру (ParseRegistry), операція `title` у ApplyTagRequests, коди TITLE_FIELDS, TITLE_TEXT, TITLE_PERSON, текст BAD_OP | `hooks/tags.ts`, `tests/tags.test.ts` |
| Схема й опис `context_tag`: `op` = `title`, поле `text` | `hooks/tools.ts` |
| FlushIO: порт `title` (TitleDue, перейменування); FlushAfterTurn планує й для TitleDue; Flush перейменовує після PERSON_MOVED і перед `/compact`, FLUSH_PASSED_OVER — лише для компактизації; `renamed` у результаті | `hooks/flush.ts`, `tests/flush.test.ts` |
| DropRenameRows після Detach: опція `renames`, рядок звіту, ті, що лишились; коміт пише `title.runs` | `hooks/edits.ts`, `hooks/compaction.ts`, `tests/compaction.test.ts` |
| CarryTitle у копії реєстру передачі | `hooks/handoff.ts`, `tests/handoff.test.ts` |
| Прив'язка: порт `title` Flush (реєстр на ланцюжку `tags`, `handle` останнього рядка `$.session.messages()`, `$.command.run` `rename`), хук `command.run` на `rename` з `.catch` → `next(e)`, `runs` із реєстру в опції застосування | `hooks/register.ts` |
| Посібник: операція заголовка і рядки перейменування мода | `skills/context-stages/SKILL.md` (≤ 9000) |
| CLAUDE.md: модуль `hooks/title.ts` у переліку портів | `CLAUDE.md` |

Поза фазою: `/rename` без назви від мода (хост генерує назву окремим запитом до моделі) і заголовок, обраний людиною до встановлення мода, — мод їх не бачить.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-29 | Рев'ю (pass with advisories, виправлено) і живий сценарій у stream-json і терміналі: усі критерії §05 виконано; дефект `after` з `$.session.messages()` (без `handle`) замінено на HostMemory.last; 1013 pass |
| 2026-10-29 | Код і модульні тести фази (1008 pass); лишились рев'ю і живий сценарій |
| 2026-10-29 | Фаза створена з пункту backlog «Заголовок сесії за темою задачі»: концепт C_CTX_03_12, специфікація `context_editor.title.sp.md` |
