# Редактор контексту агента — Implementation Plan: фаза 27 — Що згорнуто: текст і пара-носій `collapse`

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 27 — Що згорнуто: текст і пара-носій `collapse` [DONE]  {#PL_CTX_P27}

**Depends on:** Phase 19 (тексти замін з автором і часом, [SP_CTX_DEC_17](./context_editor.decisions-01.sp.md#SP_CTX_DEC_17)), Phase 26 (розділ навички «Rows marked [context-editor]»); живий прогін фази 26 (`.dev_flow/cache/live-test/phase26-results.md`: пара-носій `Read {}` бентежила haiku і sonnet, haiku вирішив, що не читав файлів); рішення розробника 2026-10-12 «Берись за пропонований опис зміни», форма — делеговано ([SP_CTX_DEC_29](./context_editor.decisions-21.sp.md#SP_CTX_DEC_29))
**Implements:** [SP_CTX_02_04](./context_editor.apply.sp.md#SP_CTX_02_04) (CollapsedList, CapCalls, KeyArg, CarrierIds; текст `collapse` з переліком; вхід носія `{collapsed: <перелік>}`), [SP_CTX_02_01](./context_editor.edits.sp.md#SP_CTX_02_01) (носій без `~`), [SP_CTX_02_29](./context_editor.stages.sp.md#SP_CTX_02_29) (носій — не відтворювана пара), [SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (навичка), [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (COLLAPSED_OPENER, COLLAPSED_KEY, MAX_COLLAPSED_LIST, MAX_COLLAPSED_ARG)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки CollapsedList, KeyArg, collapsedWords, CarrierIds, ApplyEdits «вхід носія», «collapse», «хто написав заміну», context_list «носій без `~`», BlockReport «носій не відтворюваний»; [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Що згорнуто: текст і пара-носій `collapse`» (обидва хости, haiku і sonnet: хост приймає носій з новим входом, зокрема після `--resume`; агент називає прочитані файли своїми); [SP_CTX_05_04](./context_editor.edges.sp.md#SP_CTX_05_04) (великий діапазон, згортання згортань, без ключового аргументу, лише тексти, носій до фази 27); SKILL.md ≤ 9000 символів (вручну); `claude plugin test`, `claude plugin validate`, tsc

| Що | Де |
|----|----|
| `collapsedWords(n, list)`, COLLAPSED_OPENER, COLLAPSED_KEY, MAX_COLLAPSED_LIST, MAX_COLLAPSED_ARG; CollapsedList, CapCalls, KeyArg, CarrierIds; носій `collapse` з входом `{collapsed: list}`; `~` переліку без носіїв | `mods/context-editor/hooks/edits.ts` |
| reproduciblePairs звіту закриття без носіїв | `mods/context-editor/hooks/stages.ts` |
| OneLine без розрізаних сурогатних пар (рев'ю) | `mods/context-editor/hooks/edits.ts` |
| PersonText, SUMMARY_OPENER і рамки, які вона читає, — у `deliveries.ts`; MARKER, HANDOFF_MARKER, LEGACY_*, MarkerKind — у `rows.ts`; `queue.ts` їх реекспортує (рев'ю: CollapsedList рахує людину за PersonText без циклу імпортів, STRUCT-01) | `mods/context-editor/hooks/deliveries.ts`, `rows.ts`, `queue.ts` |
| розділ «Rows marked [context-editor]»: `you read these N rows (what they held), …` і поле `collapsed`; скорочено два речення інших розділів (8995 символів) | `mods/context-editor/skills/context-stages/SKILL.md` |
| тести CollapsedList, KeyArg, collapsedWords, CarrierIds, перелік і звіт закриття з носієм; оновлено тексти `collapse` у наявних | `mods/context-editor/tests/edits.test.ts`, `stages.test.ts`, `notes.test.ts` |

Чому вхід був `{}`: з прототипу (2026-10-08) носій не копіює аргументів першого виклику (тест «a collapse carrier keeps no copy of the first call input»): вони великі (`Write`), кажуть, що весь підсумок — вивід одного виклику, і запрошують повторити виклик. Обмеження хоста чи API за `{}` немає: перезбирання копіює `input` як є, а вхід поза схемою інструмента (`{}` без `file_path`) хост приймав. Назва носія лишається — інструмент, який сесія мала, єдиний перевірений наживо вибір (власний інструмент прибирає DropOwnCalls, вигаданий не перевірено). `summarize` змін не потребує: виклик пари лишається зі своїм входом.

Стан 2026-10-12: код і модульні тести готові; `claude plugin validate` і tsc проходять. Тексти навички — 8995 символів.

Рев'ю (одне must): (1) must — OneLine різав за кодовими одиницями UTF-16, і emoji на межі лишав висячий сурогат у тексті заміни й вході носія, після чого API відхиляє кожен запит: тепер кінцевий старший сурогат відкидається, тест з emoji на межі; (2) KeyArg прибирає userinfo з URL; (3) лічильник «service messages» був розійденою копією PersonText (рядок `<ide_opened_file>`, доставка людини, slash-команда з аргументами йшли як службові) — вилучено, людину рахує PersonText, промпт з самих медіа — теж людини; PersonText переїхала в `deliveries.ts`, мітки — у `rows.ts`; (4) CarrierIds вимагає рядка в `collapsed` і тексту згортання в результаті для обох форм; (5) `cd` з каталогом у лапках; (6) коментар виродженого випадку CapCalls; (7) ціна подвійного переліку — у SP_CTX_DEC_29. 744 тести.

Живий прогін 2026-10-12 (`.dev_flow/cache/live-test/phase27-results.md`, 2.1.296; термінал haiku `08009f62`, sonnet `1759f83d`; stream-json haiku `88679b24`): фаза закрита як **безпечний частковий крок**. Механіка pass: хост приймає `Read {"collapsed": …}` у терміналі, у stream-json і після `--resume`, ремонтів пар і помилок 0, виклик-носій жодна модель не повторила, на «порожні параметри» більше не скаржаться. Мета — частково: stream-json haiku назвав правки своїми; термінальний haiku і далі каже, що згорнутих викликів не робив і cfg.txt не бачив (це від тексту `summarize`, який фаза 27 не змінювала); sonnet відступив гірше, ніж у фазі 26 — «The mod wrote them … can't confirm I wrote those summaries», спираючись на речення звіту «Your own context-editor calls (N) were removed». У терміналі носій згорнуто в «Read 1 file», після `--resume` його не видно (рендер `Read` без `file_path`), тож людина не бачить, що згорнуто. Тригер спайку SP_CTX_DEC_17 (хибне авторство на sonnet) настав — backlog.

Ризики, які перевіряє Verify: (1) вхід поза схемою інструмента з полем, якого схема не знає (`collapsed`), — раніше наживо перевірено лише `{}`; суворіша перевірка схеми хостом під час перебудови чи показу (термінал, stream-json, `--resume`) не виключена; (2) модель може й далі прийняти носій за реальний виклик інструмента з дивним аргументом — текст результату і навичка мають це пояснити; (3) MAX_COLLAPSED_LIST (200) і MAX_COLLAPSED_ARG (40) — оцінки, не виміряні: практика покаже, чи вистачає переліку для довгих записів етапів.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
