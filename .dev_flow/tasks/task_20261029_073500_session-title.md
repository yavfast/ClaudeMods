# Task: Заголовок сесії за темою задачі

> **Task ID:** `task_20261029_073500_session-title`
> **Created:** 2026-10-29
> **Last updated:** 2026-10-29
> **Status:** `done`
> **Contributors:** `claude-session-72a009d8`
> **Autonomy:** `checkpoints`

## Intent

- **Goal (why):** розробник: «Чи можна автоматично змінювати заголовок сесії при зміні поточної теми завдання?»
- **Target state:** спайк `docs/context_editor_session_title.spike.md` відповідає, чи плагін може змінити заголовок сесії, чим це платить розмова і чи бачить результат людина.
- **Expected result:** висновок спайку, пункт навички plugin-hooks, пункт backlog PL_CTX; далі концепт C_CTX_03_12 → специфікація → план → код (кожен крок — окрема команда розробника).

## Subtasks

### claude-session-72a009d8 — ask → research (done)

- [x] `ask`: у `$` немає API заголовка; кандидат — вбудована `/rename` через `$.command.run`.
- [x] Зонд `title-probe` без мережі, хост 2.1.312: stream-json і термінал (`.dev_flow/cache/live-test/title-probe/`).
- [x] Спайк concluded → `docs/context_editor_session_title.spike.md`; навичка `plugin-hooks` пункт 77; backlog PL_CTX «Заголовок сесії за темою задачі».

Activity:
- 2026-10-29 — Знахідка: термінальний `/rename` мода додає нагадування «The user named this session …» — хост приписує дію людині.

### claude-session-72a009d8 — concept (done)

- [x] Інтерв'ю розробника 2026-10-29: явна операція заголовка агента (DEC_41), застосування прибирає рядки перейменувань мода (DEC_42), перейменування людини зупиняє мод до кінця сесії (DEC_43); рішення агента — перейменування після кінця ходу перед застосуванням, передача переносить заголовок (DEC_44).
- [x] [C_CTX_03_12](../../docs/context_editor.methods.concept.md#C_CTX_03_12) у концепті методів; парасолька, ядро §4.1–4.2, `docs/_index.md`, спайк (Target concept), backlog PL_CTX (queued).
- [x] Специфікація передана далі (spec).

### claude-session-72a009d8 — spec → plan → implement (done)

- [x] Специфікація [context_editor.title.sp.md](../../docs/context_editor.title.sp.md) (draft): SP_CTX_01_33, 02_70–02_74, SP_CTX_DEC_46; посилання в парасольці, `_index.md`, константах, tags/flush/structures/handoff/hostrows; уточнення C_CTX_DEC_42.
- [x] План [фаза 48](../../docs/context_editor.p48.plan.md#PL_CTX_P48).
- [x] Design sign-off розробника 2026-10-29: «Ok. Продовжуй».
- [x] Implement: `hooks/title.ts` (новий), `rows.ts` (`commandOf`), `tags.ts` (поле `title`, операція, `withTitle`), `tools.ts` (схема й опис ≤ 2048), `flush.ts` (порт `title`, RenameAtTurnEnd), `edits.ts` (DropRenameRows після Detach), `compaction.ts` (опція `renames`, KeepRuns у коміті), `handoff.ts` (CarryTitle), `register.ts` (порти, хук `command.run` на `rename`); SKILL.md 8987/9000 (рядок про старі заміни → curation.md); CLAUDE.md.
- [x] Test: `tests/title.test.ts` (18), flush (4), compaction (1), handoff (1); 1008 pass, tsc, validate, skill-limits зелені.
- [x] Review (чистий субагент): pass with advisories; виправлено — планування при відомому обході `compact`, перевірка ходу після `/rename`, рядок команди лишається під записом хоста, PersonText `/rename` порожній, рядки налагодження ERR-01, `commandOf` у hostrows/deliveries, текст SKILL.md (8996/9000); 1013 pass, tsc.
- [x] Verify (живий сценарій §05, хост 2.1.312, haiku): stream-json і термінал — заголовок після ходу, рядки `/rename` прибрано застосуванням (ворота SP_CTX_DEC_46 пройдено в обох хостах), `/rename` людини → TITLE_PERSON, `/handoff` переносить заголовок; `.dev_flow/cache/live-test/title-p48/results.md`.
- [x] Commit sign-off розробника 2026-10-29: «ok».

Activity:
- 2026-10-29 — Живий прогін знайшов дефект: `$.session.messages()` не несе `handle`, тож `runs` не записувались; тепер `after` — `uuid` останнього видимого рядка з `session.append` (HostMemory.last); специфікація 01_33/02_72 і навичка plugin-hooks 77 оновлені.
- 2026-10-29 — Відхилення від специфікації, внесене назад у 02_72: відмова скидає лише той `want`, з яким йшла команда.
- 2026-10-29 — Знахідка: у терміналі рядки `/rename` мода не видно в `$.session.messages()`, у stream-json — лише рядок команди; прибирання — Detach рядка перед ними (SP_CTX_DEC_46).

## Coordination Notes

## Blocking Issues
