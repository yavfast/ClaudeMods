# Редактор контексту агента — Implementation Plan: фаза 5 — Операція describe

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 5 — Операція describe [DONE]  {#PL_CTX_P5}

**Depends on:** Phase 4 (рішення B з перевіркою A)
**Implements:** `PromptMatch` і CollectMedia з рядками в [SP_CTX_02_10](./context_editor.edits.sp.md#SP_CTX_02_10); PROMPT_DECORATIONS у [01_12](./context_editor.structures.sp.md#SP_CTX_01_12); `describe` у [02_02](./context_editor.edits.sp.md#SP_CTX_02_02) (схема, опис, `hasMedia` з API-подання лише для `describe`), [02_03](./context_editor.edits.sp.md#SP_CTX_02_03), [02_04](./context_editor.edits.sp.md#SP_CTX_02_04) (код уже був, тепер досяжний); CollectMedia з `e.messages` у [02_07](./context_editor.edits.sp.md#SP_CTX_02_07), з CurrentRows у [02_01](./context_editor.edits.sp.md#SP_CTX_02_01) і [02_29](./context_editor.stages.sp.md#SP_CTX_02_29); медіа промптів у засіві [02_22](./context_editor.handoff.sp.md#SP_CTX_02_22); навичка ([02_27](./context_editor.stages.sp.md#SP_CTX_02_27)) — `describe` для медіа в промпті
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки PromptMatch (живі дампи, лише зображення, однаковий текст, прикраси, рядки команди, `@файл`, зсув, `tool_result` у повідомленні, `/compact` у хвості, паралельні виклики, після вбудованої `/compact`), CollectMedia «медіа в промпті» і «медіа в промпті зіставлено», ApplyEdits / context_edit / HandleCompaction / BuildSeed «describe», опис інструментів ≤ MAX_DESCRIPTION; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Зображення в промпті людини» в обох хостах

| Що | Де |
|----|----|
| PromptMatch (`matchPrompts`): ходи людини, прикраси, пари від хвоста, довіра, власник | `mods/context-editor/hooks/media.ts` (новий, чистий) |
| CollectMedia з рядками і власниками `{row}` | `mods/context-editor/hooks/edits.ts` |
| `hasMedia` у context_edit: `needsApi` (API-подання лише для `describe`), `hasMediaFrom`; рядок DESCRIBE_DROPS у результаті | `mods/context-editor/hooks/queue.ts` (`queueEdits`, `contextEdit`) |
| `describe` при застосуванні лише з медіа, заархівованим цим застосуванням (NO_MEDIA_NOW), DESCRIBE_DROPS у звіті | `mods/context-editor/hooks/edits.ts` (`applyEdits`, `formatReport`) |
| CollectMedia з `e.messages` | `mods/context-editor/hooks/compaction.ts` |
| BuildSeed: CollectMedia по видимих рядках, медіа промпту лише для правки, що його замінює, лічба незмінених | `mods/context-editor/hooks/handoff.ts` |
| Схема й опис `describe` (EDIT_DESCRIPTION: пункт (7) — вказівка на навичку), зв'язування: API-подання для `describe`, CurrentRows для переліку й блоку | `mods/context-editor/hooks/register.ts` |
| Навичка: `describe` для медіа в промпті | `mods/context-editor/skills/context-stages/SKILL.md` |
| Тести: PromptMatch на обрізаних живих дампах (фікстури зібрано `make_fixtures.py` з дампів проби; очікування — з еталону `match_v3` у `.dev_flow/cache/media-spike/match.py`) і штучних випадках, describe наскрізно | `mods/context-editor/tests/media.test.ts`, `tests/media-fixtures.ts`; `tests/edits.test.ts` (CollectMedia з рядками) |

Стан 2026-10-10: код і модульні тести готові (421 тест після рев'ю 44), живий сценарій 05_03 — після рев'ю.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
