# Редактор контексту агента — Implementation Plan: фаза 30 — Теги зниклих рядків після чужої компактизації і повний реєстр

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 30 — Теги зниклих рядків після чужої компактизації і повний реєстр [DONE]  {#PL_CTX_P30}

**Depends on:** PL_AUD_CTX фаза 3 (RebindTags прибирає теги зниклих цілей на застосуванні), фаза 10 (ObserveCompaction за портом ObserveIO), фаза 11 (RowIndex, CF-22); пункт backlog аудиту CF-34 (PERF-9); [SP_CTX_DEC_31](./context_editor.sp.md#SP_CTX_DEC_31) (resolved B)
**Implements:** [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (PruneDeadTags у спостерігачі), [SP_CTX_02_14](./context_editor.tags.sp.md#SP_CTX_02_14), [SP_CTX_02_11](./context_editor.tags.sp.md#SP_CTX_02_11) (TAGS_FULL), [SP_CTX_02_28](./context_editor.stages.sp.md#SP_CTX_02_28) (`tagsFull`, TAGS_FULL_LINE), [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10), [SP_CTX_01_11](./context_editor.structures.sp.md#SP_CTX_01_11), [SP_CTX_01_12](./context_editor.structures.sp.md#SP_CTX_01_12) (TAG_ROOM, TAGS_FULL_LINE), [SP_CTX_01_20](./context_editor.structures.sp.md#SP_CTX_01_20)
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки PruneDeadTags (чужа компактизація; нічого прибирати), Telemetry (повний реєстр), AutoTag (повний реєстр), наявний «чужа компактизація прибирає `lastApply`»; [SP_CTX_05_04](./context_editor.scenarios.sp.md#SP_CTX_05_04) рядки фази 30; `claude plugin test`, `claude plugin validate`, tsc; живий сценарій [SP_CTX_05_03](./context_editor.scenarios.sp.md#SP_CTX_05_03) «Мертві теги після `/compact host`» (обидва хости: `result.messages` хост дає спостерігачу і для власного підсумку — на цьому вже стоїть RecordBoundary, але теги на ньому не перевіряли)

Що знайдено (перевірка CF-34 2026-10-12, код і 250 тек сесій у `~/.claude/context-editor/`): ріст реєстру до MAX_TAGS **практично не справжній**. RebindTags на кожному застосуванні мода лишає лише теги, чиї цілі є в перезібраних рядках — зокрема прибирає ті, що зникли раніше з чужою компактизацією; `/clear` і передача дають новий реєстр. Мертві теги живуть лише між застосуваннями мода після `/compact host` людини чи автоматичної компактизації хоста, а до ліміту треба сотні великих чи пошукових виводів без жодного застосування; найбільший реєстр серед 250 сесій — 62 теги (20224a10), у d5614704 — 6. Справжня вада — інша: на ліміті AutoTag і R4 мовчать, а TAGS_FULL радить зняти теги, яких агент не бачить (мертві цілі немає в переліку й телеметрії). Тому фаза мала: спостерігач прибирає мертві теги там, де вони виникають, а повний реєстр (тоді — лише живих тегів) телеметрія називає. Лінива чистка на ліміті (варіант C рішення) не потрібна.

| Що | Де |
|----|----|
| PruneDeadTags(reg, rows) — RowIndex один раз, ResolveTarget для кожного тегу, `state` лишається, той самий реєстр без змін; RegistryFull; TAG_ROOM, TAGS_FULL_LINE | `mods/context-editor/hooks/tags.ts`; `tests/tags.test.ts` |
| ObserveCompaction: одна зміна реєстру — PruneDeadTags(`done.messages`) і зняття `lastApply`, без запису, коли нічого не змінилось | `mods/context-editor/hooks/compaction.ts`; `tests/compaction.test.ts` |
| Telemetry: поле `tagsFull`, рядок TAGS_FULL_LINE після рядка нотаток | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts` |

Кроки: (1) PruneDeadTags і RegistryFull з тестами; (2) спостерігач — зміна реєстру, що вже знімає `lastApply`, стає «прибрати мертві теги, зняти `lastApply`» (порт ObserveIO без змін: `updateTags` уже є); (3) Telemetry — `tagsFull` і рядок; (4) тести, validate, tsc; живий сценарій. `register.ts` не змінюється.

Ризики, які перевіряє Verify: (1) рядки, які повертає підсумок хоста, — лише підсумок і, можливо, хвіст; тег на рядку, який хост переписав (інший текст — інший відбиток), зникає разом із ним — так і задумано (ціль справді зникла); (2) тег `state` лишається до наступного застосування, щоб телеметрія сказала, що рядок слота зник (як до фази 30); (3) нотатки зниклих рядків фаза не чіпає (SP_CTX_DEC_31) — `Notes: N` може рахувати й нотатки зниклих рядків до наступного застосування; (4) спостерігач уже на ланцюжку реєстру — додатковий запис лише тоді, коли щось прибрано.

Стан 2026-10-12: код і модульні тести готові — 766 тестів після фази 30; validate, tsc, skill-limits проходять. `pruneDeadTags`, `registryFull`, TAG_ROOM і `tagsFullLine` (TAGS_FULL_LINE — функція, бо має підстановки) у `hooks/tags.ts`; спостерігач — одна зміна реєстру `dropLastApply(pruneDeadTags(reg, rows))`, без запису, коли нічого не змінилось; Telemetry — `tagsFull` і рядок після рядка нотаток. `register.ts` не змінено. Рев'ю: PruneDeadTags(reg, before, after) прибирає тег лише тоді, коли його ціль була у вході компактизації (`e.messages`) і зникла з результату — тег рядка, дописаного після початку компактизації посеред ходу, лишається (тест). Живий сценарій 05_03 «Мертві теги після `/compact host`» — pass в обох хостах (`.dev_flow/cache/live-test/phase29-31-results.md`).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
