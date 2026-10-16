# Редактор контексту агента — Implementation Plan: фаза 38 — Можливості хоста: зонд раз на версію, вимкнення пропущеного

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-16
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 38 — Можливості хоста: зонд раз на версію, вимкнення пропущеного [DONE]  {#PL_CTX_P38}

**Depends on:** Phase 37 (BlockReport, WaitingAdvice), Phase 32 (ремонт), Phase 25 (`/compact` людини).
**Status (2026-10-14):** код, тести (889 pass), рев'ю з чистим контекстом (1 must і 11 should/prefer виправлено) і живі сценарії з керованим модом (зонд на 2.1.296 і 2.1.299, кеш, живе проти кешу, ProbeMode) — зроблено. Живий сценарій самого обходу на 2.1.299 (`--plugin-dir` без керованого мода) відкладено рішенням розробника; файли — `.dev_flow/cache/live-test/phase38b/`.
**Result (2026-10-16):** живі сценарії в stream-json пройдено (`.dev_flow/cache/live-test/phase38c/results.md`): обхід — копією мода (`ce-gate`) через `--plugin-dir` поруч із керованими налаштуваннями, без зміни `/etc`; кеш і живі ознаки, керований мод, ремонт з першого ходу (2.1.296). Прогін дав два виправлення: ProbeMode не пише в сховище і пропускає `/compact`, `/handoff`, чужу компактизацію і `tool.call` ([SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57)); OBSERVE_LATER — спостерігач `/compact` з брифом повторюється на початку наступного ходу, бо хост 2.1.299 показує підсумок у читанні не одразу ([SP_CTX_02_55](./context_editor.bypass.sp.md#SP_CTX_02_55)). Термінал не перевірено.
**Implements:** [C_CTX_DEC_31](./context_editor.core.concept.md#C_CTX_DEC_31), [C_CTX_03_11](./context_editor.core.concept.md#C_CTX_03_11); [SP_CTX_DEC_38](./context_editor.decisions-21.sp.md#SP_CTX_DEC_38); [SP_CTX_01_25](./context_editor.records.sp.md#SP_CTX_01_25), [SP_CTX_01_26](./context_editor.records.sp.md#SP_CTX_01_26), [SP_CTX_02_53](./context_editor.bypass.sp.md#SP_CTX_02_53)–[SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57); спайк [context_editor_probe](./context_editor_probe.spike.md); посилання в 02_02, 02_06, 02_08, 02_19–02_21, 02_29, 02_37, 02_42, 02_46.
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки Capabilities, RunProbe, ParseProbe, ProbeMode, context_edit/context_handoff/HandoffCommand/RunHandoff/Flush/DeliverReport/BlockReport «обхід», CompactRoute «обхід», CompactBrief, ObservePassedCompact, ScheduleRepair «перший хід процесу»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Зонд на 2.1.296 і 2.1.299», «Кеш і живі ознаки», «Обхід: виявлення і відмови», «/compact при обході», «Керований мод», «Ремонт з першого ходу»; tsc, `claude plugin test`, `claude plugin validate`, skill-limits.

| Що | Де |
|----|----|
| Capabilities: стан, NoteAttachment, NoteTurn, NoteOwnCompaction, NoteCommandUnseen, Verdict, Merge, PassedText; кеш `capabilities.json`; CompactBrief, Targets, Fit; ObservePassedCompact за портом | новий `hooks/capabilities.ts` |
| RunProbe (ScheduleProbe, ProbeArgs, ProbeInput, ParseProbe, прибирання) з `session.start`; очікування зонда в Flush, RunHandoff, RunRepair і маршруті `/compact` | `hooks/capabilities.ts`, `hooks/register.ts` |
| ProbeMode: `CONTEXT_EDITOR_PROBE` — без сховища, ремонту, прибирання, зонда, посібника; лічильники, PROBE_FILE, відповідь `skip` на PROBE_MARKER; відмова `context_*` | `hooks/register.ts`, `hooks/compaction.ts` (маршрут мітки), `hooks/capabilities.ts` |
| хук `prompt.attachment` без матчера (рахує, `next(e)`); NoteTurn першим у AfterTurn; `$.session.version()` один раз; `$.ui.log` PassedText | `hooks/register.ts`, `hooks/flush.ts` (AfterTurn) |
| відмови DENIED_PASSED_OVER: `context_edit`, `context_handoff`, `/handoff`; HANDOFF_PASSED_OVER у RunHandoff | `hooks/queue.ts`, `hooks/handoff.ts`, прив'язка в `hooks/register.ts` |
| Flush: не планувати при `passed`, FLUSH_PASSED_OVER на запуску | `hooks/flush.ts` |
| DeliverReport без WaitingAdvice і підказки, підказка в каналі виводу, BlockReport з PASSED_ADVICE | `hooks/queue.ts`, `hooks/hints.ts`, `hooks/stages.ts` |
| CompactRoute `brief`; хук `command.run` з брифом і ObservePassedCompact | `hooks/personcompact.ts`, `hooks/register.ts` |
| ScheduleRepair з кінця першого ходу процесу, не з `session.start`; при `passed` — ні | `hooks/repair.ts`, `hooks/register.ts` |
| константи PROBE_*, CAP_CACHE_VERSIONS, BRIEF_MAX, BRIEF_HEAD, BRIEF_RECORDS, PASSED_ADVICE | `hooks/capabilities.ts` |
| розділ «Керований плагін (Managed plugin)» у README репозиторію (на нього посилаються PassedText і відмови); CLAUDE.md | `README.md`, `CLAUDE.md` |
| тести рядків 05_01 | `tests/capabilities.test.ts`, наявні тести flush, queue, handoff, personcompact, repair, stages |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
| 2026-10-16 | Фазу завершено: живі сценарії обходу в stream-json, виправлення ProbeMode і OBSERVE_LATER |
