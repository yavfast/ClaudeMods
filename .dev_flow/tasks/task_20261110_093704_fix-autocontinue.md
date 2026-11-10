# Task: Автоматичне продовження після застосування на початку етапу

> **Task ID:** `task_20261110_093704_fix-autocontinue`
> **Created:** 2026-11-10
> **Last updated:** 2026-11-10
> **Status:** `done`
> **Contributors:** `claude-session-23a7a081`
> **Autonomy:** `checkpoints`

## Intent

- **Goal (why):** розробник: «Після автоматичного compact на початку нового етапу, агент іноді зупиняється та не продовжує виконання нового етапу, але після команди продовжувати - все ОК. Чи можна, продовження відбувалося автоматично?»
- **Target state:** пакет, у якому агент попросив продовження (`resume_prompt` або `resume: true`), після застосування продовжує сесію, навіть якщо раніший виклик того самого пакета передав `resume: false` чи пакет почався із замін з тегів; результат `context_edit` у будь-якому ході каже, чи сесія продовжиться.
- **Expected result:** виправлення в `hooks/queue.ts` і `hooks/compaction.ts` з тестами; специфікація SP_CTX_02_02 і нотатка до SP_CTX_DEC_16; рев'ю, живий прогін, коміт після згоди розробника.

## Subtasks

### claude-session-23a7a081 — fix (done)

- [x] Аналіз: сканування 132 транскриптів з `context_edit`; причина — сесія `d0d12355` (2026-11-10, `~/.claude/projects/-home-yavfast--claude-skills-dev-flow/`): виклик з `resume: false`, що не поставив жодної правки (діапазон закінчувався рядком thinking), записав вибір пакета (`resumeSet`), пізніший виклик лише з `resume_prompt` його не змінив, результат не попередив про зупинку, Resume нічого не надіслав. Другий шлях у коді: заміни з тегів (`tagsOnly`) і виклик з `resume_prompt`, у якому всі правки відхилено, — результат обіцяв продовження, звіт його не давав.
- [x] Рішення (resolved (delegated), за правилом C розробника в SP_CTX_DEC_16 «непорожній `resume_prompt` означає `resume = true`»): останній явний вибір пакета перемагає; одне правило ResumesAfter(q) = `q.resume AND (q.resumeSet OR NOT q.tagsOnly)` для звіту застосування і результату `context_edit`; речення про зупинку в будь-якому ході.
- [x] Специфікація: edits 02_02 (псевдокод і текст), apply 02_07, tags 02_13, structures 01_04, очікування 05_01 (edits), нотатка 2026-11-10 до SP_CTX_DEC_16, Changelog.
- [x] Код: `queue.ts` (`resumesAfter`, правило в `queueEdits`, `queuedText`), `compaction.ts` (`reported`), `tools.ts` (опис `resume_prompt`); тести `queue.test.ts` (+2, 2 змінено); 1015 pass, tsc, validate.
- [x] Backlog PL_CTX: «`edits` рядком JSON» (candidate).
- [x] Review (чистий субагент): pass with advisories. Виправлено: should 1 — вибори ходу без правок скидаються наприкінці ходу (`flushAfterTurn`, `hasBatchChoices` + KeepOtherSteps); should 2 — другий шлях до симптому: пакет лише із замін з тегів після відкриття/закриття етапу; рядок замін у BlockReport закінчується TAGS_STOP (`Replaced.resumes`); should 3 — рядки Input/Output 02_02; prefer 4 — тест `reportResume` у HandleCompaction; prefer 5 — назва тесту й рядок очікувань. SKILL.md:53 не змінено (8996/9000; TAGS_STOP каже те саме в момент дії). 1018 pass, tsc, validate, skill-limits.
- [x] Verify: живий прогін stream-json, хост 2.1.322, haiku — сценарії A (шлях дефекту: продовження настає), B (явна зупинка з реченням), C (вибори ходу без правок скинуто), D (закриття етапу лише з тегами: TAGS_STOP, без продовження, старий `resume_prompt` не спрацював) — усі pass; `.dev_flow/cache/live-test/fix-autocontinue/results.md`.
- [x] Commit sign-off розробника 2026-11-10: «/dev-flow commit».

Activity:
- 2026-11-10 — Відкинуто як не дефект: зупинки після застосування, за якими йшло «Продовжуй» людини, у більшості — очікування design/commit sign-off, а не втрачене продовження.

## Relevant Context

- Скрипти сканування — у scratchpad сесії (не в репозиторії); результат: 148 поставлених пакетів у 38 файлах, з них одна втрата продовження після `resume_prompt` (d0d12355).
