# Редактор контексту агента — Implementation Plan: фаза 39 — Ворота курування наживо: тексти замін, обгортка вставок, thinking

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 39 — Ворота курування наживо: тексти замін, обгортка вставок, thinking [DONE]  {#PL_CTX_P39}

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

**Результат (2026-10-15):**
- **Тексти замін:** 57 сесій на 2.1.296 (копія мода `ce-gate`, бо керований context-editor блокує копію з тим самим іменем у `--plugin-dir`; `.dev_flow/cache/live-test/curation-gate/texts/results.md`). Авторство — 28 з 28 з джерелом і статусом, 9 з 9 у контролі; P13/P23 не повертаються (у варіантах зі статусом 1 заперечення власних викликів і 2 «вигадав», n мале); статус змісту довіри майже не змінює (впевненість: контроль (поточні тексти, без джерела й статусу) 94.6, `read` 91.4, `inferred` 93.8, `assumed` 86.0). Розробник: «Лише джерело, без статусу» — [C_CTX_DEC_40](./context_editor.curation.concept.md#C_CTX_DEC_40), [SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44); фаза 41 — лише джерело.
- **Обгортка вставок:** у тексті рядка на 2.1.296 і 2.1.299 (велика вставка в терміналі, `pasted_content` і `inline_pastes` у stream-json; розширення VS Code за своїм кодом шле `inline_pastes`, наживо не спостережено); коротка вставка в терміналі не обгортається ([SP_CTX_02_59](./context_editor.curation.sp.md#SP_CTX_02_59)). Фаза 40 робить `describe` вставок за текстом рядка.
- **Thinking на новому акаунті:** `unobserved` стандартними засобами (такого акаунта немає); спостереження з недокументованим перемикачем хоста, на яке дизайн не спирається, — у [SP_CTX_05_07](./context_editor.curation.sp.md#SP_CTX_05_07). Правило пакета на межі етапу ([C_CTX_DEC_30](./context_editor.methods.concept.md#C_CTX_DEC_30)) лишається; чи вмикати правила фази 46, що закликають до виправлень посеред історії, без прогону на новому акаунті, вирішує розробник перед фазою 46.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Фазу додано: план курування історії ([C_CTX_06](./context_editor.curation.concept.md#C_CTX_06), [SP_CTX_02_58](./context_editor.curation.sp.md#SP_CTX_02_58)–[SP_CTX_02_69](./context_editor.curation.sp.md#SP_CTX_02_69)), рішення розробника [PL_CTX_DEC_06](./context_editor.plan.md#PL_CTX_DEC_06) |
| 2026-10-15 | Фазу виконано: ворота текстів (статус знято, [SP_CTX_DEC_44](./context_editor.curation.sp.md#SP_CTX_DEC_44)), обгортка вставок у тексті рядка, thinking — `unobserved` стандартними засобами |
