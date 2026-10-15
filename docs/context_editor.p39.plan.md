# Редактор контексту агента — Implementation Plan: фаза 39 — Ворота курування наживо: тексти замін, обгортка вставок, thinking

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** todo
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 39 — Ворота курування наживо: тексти замін, обгортка вставок, thinking [TODO]  {#PL_CTX_P39}

**Depends on:** — (метод — спайк [context_editor_authorship](./context_editor_authorship.spike.md)).
**Implements:** ворота перед кодом [SP_CTX_02_62](./context_editor.curation.sp.md#SP_CTX_02_62) (тексти замін) і [SP_CTX_02_59](./context_editor.curation.sp.md#SP_CTX_02_59) (де хост тримає вставку); перевірка thinking-блоків [C_CTX_06_11](./context_editor.curation.concept.md#C_CTX_06_11); рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06).
**Verify:** [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) «Тексти замін з походженням і статусом», «Обгортка вставок», «Thinking-блоки на новому акаунті». Результат кожних воріт записано в [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07) («спостережено …») і в задачі; провал воріт текстів — ескалація в [SP_CTX_02_62](./context_editor.curation.sp.md#SP_CTX_02_62) і [SP_CTX_DEC_40](./context_editor.curation.sp.md#SP_CTX_DEC_40) до фази 41, не обхід у коді; обгортка «ніде» — фаза 40 робить `describe` лише для медіа, а [C_CTX_DEC_39](./context_editor.curation.concept.md#C_CTX_DEC_39) іде до розробника як нездійсненне; без акаунта, створеного від 2026-08-31, — `unobserved` із причиною, і правила фази 46, що закликають до виправлень посеред історії, чекають рішення розробника.

Код, який постачає мод, ця фаза не змінює: усе пробне лежить поза репозиторієм.

| Що | Де |
|----|----|
| копія мода з новими текстами `run summarize` і `run collapse` (джерело, «which you quoted from later», статус) на копії реальної сесії; haiku і sonnet; питання агенту про стиснуте й про власні виклики | `.dev_flow/cache/live-test/curation-gate/texts/`, драйвер `ce.sh` |
| пробний плагін вставок: текст, вставлений у промпт, у терміналі (tmux) і в stream-json; що бачать `prompt.submit`, `$.session.messages()` і `{ as: 'api' }` | `.dev_flow/cache/live-test/curation-gate/paste-probe/` |
| правка посередині розмови на моделі з перевіркою префікса thinking; наступний хід | `.dev_flow/cache/live-test/curation-gate/thinking/` |
| спостереження хоста | навичка `claude-code/plugin-hooks` (нові пункти), `.dev_flow/cache/_index.yaml` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
