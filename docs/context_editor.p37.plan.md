# Редактор контексту агента — Implementation Plan: фаза 37 — Стискання на переході між етапами

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 37 — Стискання на переході між етапами [DONE — код, тести 862/0, рев'ю без блокерів; живі сценарії 05_03 — PASS на 2.1.296]  {#PL_CTX_P37}

**Depends on:** Phase 33 (посібник навички), Phase 25 (хід стискання `/compact`).
**Implements:** [C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30), [C_CTX_03_02](./context_editor.methods.concept.md#C_CTX_03_02) («Мітка оптимізації в тексті», «Перехід агента без людини»); [SP_CTX_DEC_37](./context_editor.decisions-21.sp.md#SP_CTX_DEC_37); [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10) `waiting`, [SP_CTX_01_04](./context_editor.structures.sp.md#SP_CTX_01_04) `optimize` лише з `compact`; [SP_CTX_02_30](./context_editor.stages.sp.md#SP_CTX_02_30) DetectOptimize, [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29) BlockReport `waiting`, WaitingAdvice, [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11), [SP_CTX_02_13](./context_editor.tags.sp.md#SP_CTX_02_13), [SP_CTX_02_02](./context_editor.edits.sp.md#SP_CTX_02_02), [SP_CTX_02_06](./context_editor.flush.sp.md#SP_CTX_02_06), [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08), [SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (посібник), [SP_CTX_04_05](./context_editor.states.sp.md#SP_CTX_04_05), [SP_CTX_04_06](./context_editor.states.sp.md#SP_CTX_04_06).
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки WaitingAdvice, DeliverReport «порада про блок, що чекає», «порада один раз», «`/compact` важливіший», OPTIMIZE_LEGACY, ADVICE_FAILED; Flush «хід стискання …», «WaitingAdvice у промпті продовження», «після ходу з міткою, черга порожня», OPTIMIZE_LEGACY; DetectOptimize «мітка не ставить замін», «друга мітка зливає блоки», «мітка з відкритим етапом», «закрито інструментом у цьому ході»; context_tag «блок, що чекав», «очікування не зняте»; context_edit «правка знімає очікування»; QueueTagReplacements «без повтору»; живі сценарії 05_03 «Перехід між етапами: мітка і продовження етапу», «… мітка і новий етап», «Перехід без людини», «Мітка в кінці сесії» (обидва хости, де вказано); `sh tests/skill-limits.sh`.

| Що | Де |
|----|----|
| `waiting` у TagRegistry: тип, розбір (інше значення чи без `lastClosed` — `unreadable`), запис; перенос з `lastClosed` у RebindTags і спостерігачі (знято разом із `lastClosed`) | `hooks/tags.ts` (parseRegistry, типи), `hooks/compaction.ts` |
| DetectOptimize: без QueueTagReplacements і без запису `optimize`; `waiting = marked`; злиття другою міткою; MARK_NO_REPLACEMENTS, MARK_NOT_QUEUED прибрати | `hooks/stages.ts` (або де живе `detectOptimize`), `hooks/flush.ts` (AfterTurn) |
| BlockReport з `waiting` і WAIT_MOVED; WaitingAdvice замість optimizeText і personAdvice | `hooks/stages.ts` |
| context_tag: перший `open`/`close` при `waiting` — звіт блоку, зняття, QueueTagReplacements | `hooks/tags.ts` |
| context_edit: прийнята правка при `waiting` — зняття і QueueTagReplacements; рядок результату | `hooks/queue.ts`, прив'язка в `hooks/register.ts` |
| Flush: Optimize лише для `compact`, OPTIMIZE_LEGACY, WaitingAdvice у Resume і `advised` після входу | `hooks/flush.ts`, `hooks/register.ts` |
| DeliverReport: WaitingAdvice, `advised` після входу, без пропозиції при пораді, OPTIMIZE_LEGACY; COMPACT_ADVICE без змін | `hooks/queue.ts` |
| Тексти: INTRO_TEXT (речення про мітку), SKILL.md «Optimization mark» (блок чекає до переходу; етап на фазу плану; правка → рядок стану → продовження; ≤ 9000 символів), TAG_DESCRIPTION («once you close a stage or move on from a block you marked», ≤ MAX_DESCRIPTION) | `hooks/stages.ts`, `skills/context-stages/SKILL.md`, `hooks/tools.ts` |
| Тести: рядки 05_01 вище; переписати тести optimizeText/personAdvice і мітки з ходом оптимізації | `tests/stages.test.ts`, `tests/flush.test.ts`, `tests/queue.test.ts`, `tests/tags.test.ts`, `tests/personcompact.test.ts` |
| Живі сценарії: драйвери `ce.sh` (термінал), `drive.sh` (stream-json) | `.dev_flow/cache/live-test/` |
| CLAUDE.md: абзац про мітку (без ходу оптимізації; блок чекає до переходу) | `CLAUDE.md` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
