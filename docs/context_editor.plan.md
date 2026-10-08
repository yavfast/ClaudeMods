# Implementation Plan: Редактор контексту агента  {#PL_CTX}

> **Code:** PL_CTX
> **Status:** in-progress
> **Created:** 2026-10-08
> **Updated:** 2026-10-08
>
> **Concept:** [C_CTX](./context_editor.concept.md)
> **Specification:** [SP_CTX](./context_editor.sp.md)
> **Depends on:** none
> **Used by:** —
>
> План реалізації мода-редактора контексту: виконану фазу основного функціоналу і фази, що лишились — медіа в результатах інструментів, теги, дослідження зіставлення медіа в промптах, операція `describe`, рішення щодо залишкового вікна тригера. Читати перед початком роботи над будь-якою фазою.

## Goal

Агент сам редагує свою основну розмову: стискає опрацьовані виводи, медіа і хибні кроки, чистить контекст з початку, коли той росте, і заздалегідь позначає важливе та те, що можна прибрати. Цільовий стан — усі контракти [SP_CTX](./context_editor.sp.md) реалізовано і перевірено модульними тестами та живими сценаріями §05_03. Очікуваний результат, який перевіряє розробник: у живій сесії агент звільняє контекст без втрати потрібних фактів, медіа зникає лише разом з описом і архівом, позначене `pin` не змінюється, а заміни з тегів застосовуються на порозі без участі агента.

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Хост і API | Claude Code ≥ 2.1.294, function hooks (плагіни з `hooks/hooks.json`) | єдиний механізм, що дає змінити збережені рядки ([C_CTX_DEC_01](./context_editor.concept.md#C_CTX_DEC_01)) |
| Мова | TypeScript, ES-модулі | вимога хоста до модулів хуків |
| Розбиття | два плагіни: `mods/context-editor`, `mods/context-editor-trigger` | [C_CTX_DEC_02](./context_editor.concept.md#C_CTX_DEC_02) |
| Модулі редактора | `hooks/edits.ts` (чиста логіка правок, перегляду, CollectMedia), `hooks/queue.ts` (черга, context_edit, доставка звіту через порт QueueIO), `hooks/compaction.ts` (обробник через порт CompactionIO), `hooks/register.ts` (зв'язування портів з `$`) | тестованість без імітації хоста ([PL_CTX_DEC_01](#PL_CTX_DEC_01)) |
| Модулі тригера | `hooks/flush.ts` (логіка через порт TriggerIO), `hooks/register.ts` | те саме |
| Сховище | JSON-файли в `<HOME>/.claude/context-editor/<session_id>/`, каталог 700 | [SP_CTX_01_07](./context_editor.sp.md#SP_CTX_01_07) |
| Команди хоста | `$.process.run` з argv: `sh -c` з позиційними аргументами (`mkdir`, `chmod`, `cat`, `base64 -d`), `mv` | права доступу і запис без межі 4 MiB; лише POSIX |
| Тести | `claude plugin test <mod>` (`claude-code/testing`), файли `tests/*.test.ts` | вбудований набір хоста |
| Типи | `tsc` з `npx -p typescript@5.6.3`, типи хоста з `.claude-plugin/types/` | у системі немає `tsc` |
| Узгодженість двох модів | `scripts/check-shared.sh` | спільні константи без спільного коду |
| Живі сценарії | окремий `claude --plugin-dir …` у tmux, керований скриптом-драйвером | відтворювано і видно людині через `tmux attach -r` |

## Required Knowledge

| Kind | Ref | Applies to | Note |
|------|-----|-----------|------|
| skill (create) | claude-code-plugin-hooks | Phase 3 | зафіксувати пастки хоста, знайдені в прототипі: розширення не бачить власної компактизації; `$.prompt.submit` всередині обробника компактизації блокує; `prompt.submit` повертає `{ drop }`, а не помилку; рядки з `handle` після межі посилаються на старі; `--resume` ігнорує компактизацію від обробника; `/clear` не викликає старту сесії; межа `$.fs.write` 4 MiB; `$.tool.list()` для перевірки процесу |

Правил і навичок у `.dev_flow/` ще немає.

## Progress

- [x] [Phase 1 — Основний функціонал](#PL_CTX_P1)
- [x] [Phase 6 — Залишкове вікно тригера](#PL_CTX_P6) (рішення A)
- [ ] [Phase 3 — Теги (наступна)](#PL_CTX_P3)
- [ ] [Phase 2 — Медіа в результатах інструментів](#PL_CTX_P2)
- [ ] [Phase 4 — Дослідження: медіа в промптах і межі вікон](#PL_CTX_P4)
- [ ] [Phase 5 — Операція describe](#PL_CTX_P5)

Порядок фаз — за [PL_CTX_DEC_02](#PL_CTX_DEC_02); номери фаз — незмінні ідентифікатори, а не черговість.
- [backlog] Збереження правок після `--resume`; налаштовувані пороги; поширення через маркетплейс

## Phases

### Phase 1 — Основний функціонал [DONE]  {#PL_CTX_P1}

**Depends on:** none
**Implements:** [SP_CTX_01_01](./context_editor.sp.md#SP_CTX_01_01)–[01_07](./context_editor.sp.md#SP_CTX_01_07), [01_12](./context_editor.sp.md#SP_CTX_01_12); [02_01](./context_editor.sp.md#SP_CTX_02_01)–[02_08](./context_editor.sp.md#SP_CTX_02_08); [02_09](./context_editor.sp.md#SP_CTX_02_09) без замін з тегів; [02_15](./context_editor.sp.md#SP_CTX_02_15)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки ApplyEdits (крім describe), PrepareEdits, DropOwnCalls, context_list, context_edit, HandleCompaction, DeliverReport, TriggerCompaction; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Стиснення в межах сесії», «Три операції», «Нагадування з початку» — pass 2026-10-08 після раунду 3

| Що | Де |
|----|----|
| Правки, перегляд, DropOwnCalls, FreshId | `mods/context-editor/hooks/edits.ts` |
| Черга, context_edit, доставка звіту | `mods/context-editor/hooks/queue.ts` |
| Обробник компактизації | `mods/context-editor/hooks/compaction.ts` |
| Хуки, сховище, нагадування | `mods/context-editor/hooks/register.ts` |
| Тригер | `mods/context-editor-trigger/hooks/{flush,register}.ts` |

Рев'ю: раунди 1–3 виправлено; раунд 4 зупинено на вимогу розробника перед живою перевіркою.

### Phase 2 — Медіа в результатах інструментів [IN PROGRESS]  {#PL_CTX_P2}

**Depends on:** Phase 1; виконується після фази 3 ([PL_CTX_DEC_02](#PL_CTX_DEC_02))
**Implements:** [SP_CTX_01_08](./context_editor.sp.md#SP_CTX_01_08), [SP_CTX_02_10](./context_editor.sp.md#SP_CTX_02_10) для результатів інструментів, медіа-частини [02_04](./context_editor.sp.md#SP_CTX_02_04), [02_05](./context_editor.sp.md#SP_CTX_02_05), [02_07](./context_editor.sp.md#SP_CTX_02_07); [C_CTX_DEC_06](./context_editor.concept.md#C_CTX_DEC_06)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки CollectMedia, «незмінений рядок з медіа», «медіа не заархівовано», «медіа сусідньої пари», «вікно API», DropOwnCalls «спільний рядок» (модульні — є); [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Скриншот у результаті інструменту», «Документ у результаті інструменту», «Незмінене медіа» — плюс: медіа-файл в архіві відкривається інструментом читання і має права 0600

Код і модульні тести вже є. Лишилось:
- живі сценарії зі скриншотом (PNG з написами), PDF і двома скриншотами, з яких стискається один;
- перевірити наживо припущення: формат блоків `image`/`document` в API-поданні збігається з очікуваним `source.type = base64`; `stdin` у `$.process.run` приймає base64 кількох мегабайт;

### Phase 3 — Теги [TODO]  {#PL_CTX_P3}

**Depends on:** Phase 1 (виконується перед фазою 2, [PL_CTX_DEC_02](#PL_CTX_DEC_02))
**Implements:** [SP_CTX_01_09](./context_editor.sp.md#SP_CTX_01_09)–[01_11](./context_editor.sp.md#SP_CTX_01_11), [02_11](./context_editor.sp.md#SP_CTX_02_11)–[02_14](./context_editor.sp.md#SP_CTX_02_14), заміни з тегів у [02_09](./context_editor.sp.md#SP_CTX_02_09), перевірка `pin` у [02_03](./context_editor.sp.md#SP_CTX_02_03) і [02_07](./context_editor.sp.md#SP_CTX_02_07), теги в [02_01](./context_editor.sp.md#SP_CTX_02_01); [C_CTX_03_04](./context_editor.concept.md#C_CTX_03_04)
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки PrepareEdits «pin», context_tag «помилки», AutoTag, QueueTagReplacements, Nudge «заміни достатньо», RebindTags; [SP_CTX_05_04](./context_editor.sp.md#SP_CTX_05_04) рядки про теги; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Автоматичне чищення з тегів», «Захист початкового завдання»

| Що | Де |
|----|----|
| Tag, TagRegistry, правила R1–R3, валідація запитів | новий `mods/context-editor/hooks/tags.ts` (чиста логіка) |
| context_tag, AutoTag (`session.append`), лічильник ходів, QueueTagReplacements, RebindTags | `tags.ts` через порт; зв'язування в `register.ts` |
| Перевірка `pin` | `edits.ts` (`prepare` приймає множину цілей з `pin`), `compaction.ts` |
| Теги в переліку | `edits.ts` `listRows` |

Pseudocode sketch:
    ON row appended (main loop): stored = next(row); apply R1..R3 to the registry on its serial chain
    ON nudge threshold: freed = QueueTagReplacements(); nudge only if tokens - freed stays above the threshold
    ON compaction: drop edits touching `pin`; after ApplyEdits: RebindTags

### Phase 4 — Дослідження: медіа в промптах і межі вікон [TODO]  {#PL_CTX_P4}

**Depends on:** Phase 2
**Implements:** закриття [SP_CTX_DEC_06](./context_editor.sp.md#SP_CTX_DEC_06)
**Verify:** spike-файл `docs/context_editor.spike.md` з даними живого прогону: обидва подання розмови і рядки `e.messages` для сесії з промптами людини з медіа і нагадуваннями; висновок A / B / C; межі вікон трьох подань

Time-box: одна сесія. Результат — рішення в SP_CTX_DEC_06 і, за потреби, правка [SP_CTX_02_10](./context_editor.sp.md#SP_CTX_02_10).

### Phase 5 — Операція describe [TODO]  {#PL_CTX_P5}

**Depends on:** Phase 4 (рішення A або B; за рішення C фаза переходить у backlog як відкинута)
**Implements:** `PromptMatch` у [SP_CTX_02_10](./context_editor.sp.md#SP_CTX_02_10), `describe` у [02_03](./context_editor.sp.md#SP_CTX_02_03) і [02_04](./context_editor.sp.md#SP_CTX_02_04), операція в описі й схемі `context_edit`
**Verify:** [SP_CTX_05_01](./context_editor.sp.md#SP_CTX_05_01) рядки «describe», CollectMedia «медіа в промпті»; [SP_CTX_05_03](./context_editor.sp.md#SP_CTX_05_03) «Зображення в промпті людини»

### Phase 6 — Залишкове вікно тригера [DONE]  {#PL_CTX_P6}

**Depends on:** рішення розробника щодо [C_CTX_DEC_09](./context_editor.concept.md#C_CTX_DEC_09)
**Implements:** C_CTX_DEC_09
**Verify:** DEC_09 `resolved` (варіант A, розробник 2026-10-08); код не змінюється — готовність уже перевіряється за інструментом редактора в процесі і свіжістю файлу готовності

## Backlog

- Збереження правок після `claude --resume` ([C_CTX_DEC_05](./context_editor.concept.md#C_CTX_DEC_05)) — return when: вийде версія Claude Code, у якій API компактизації дає позначити рядок-підсумок або відновлення поважає компактизацію від обробника.
- Налаштовувані пороги нагадувань ([SP_CTX_DEC_03](./context_editor.sp.md#SP_CTX_DEC_03)) — return when: розробник попросить змінювати пороги без правки коду.
- Поширення через маркетплейс (`.claude-plugin/marketplace.json`) — return when: розробник вирішить ділитися модом.
- Рев'ю раунд 4 повного обсягу — return when: перед наступним комітом коду (раунд по змінах фаз 2–6).

## Design Decisions  {#PL_CTX_DEC}

### DEC_01 — Як тестувати логіку, що залежить від хоста  {#PL_CTX_DEC_01}

> **Status:** resolved
> **Date:** 2026-10-08

**Question:** Тестувати хуки через імітацію подій хоста в `claude-code/testing` чи винести логіку за порти?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — хуки через тестовий набір хоста | перевіряє і зв'язування з `$`; потребує імітації майже всіх іменників `$` (fs, process, session, tool, prompt) |
| B — логіка за портами (QueueIO, CompactionIO, TriggerIO), звичайні модульні тести | швидко і детерміновано; зв'язування портів з `$` перевіряють живі сценарії |

**Decision:** B.
**Rationale:** рев'ю раундів 2–3 вимагало тестів для контрактів у `register.ts`; порти дали їх без імітації хоста і зменшили `register.ts` до зв'язування.
**Rejected because:** A — велика імітація хоста заради перевірки тонкого зв'язування.

### DEC_02 — Порядок фаз після основного функціоналу  {#PL_CTX_DEC_02}

> **Status:** resolved
> **Date:** 2026-10-08

**Question:** Що робити після фази 1?

**Options considered:**
| Option | Consequence |
|--------|-------------|
| A — медіа (живі сценарії) → теги → дослідження → describe | спершу дешеве завершення вже написаного коду, потім найцінніша нова можливість; describe останнім, бо залежить від дослідження |
| B — теги → медіа → дослідження → describe | найшвидше до автоматичного чищення; код медіа лишається неперевіреним наживо довше |

**Decision:** B — рішення розробника 2026-10-08.
**Rationale:** найшвидше до автоматичного чищення з тегів — можливості, якої ще немає; код медіа вже працює в модульних тестах і чекає живої перевірки у фазі 2.
**Rejected because:** A — відкладає нову можливість заради перевірки наявного коду.

## Changelog

| Date | Change |
|------|--------|
| 2026-10-08 | Initial version: фаза 1 виконана й перевірена наживо; фази 2–6 і backlog |
| 2026-10-08 | Погодження дизайну: PL_CTX_DEC_02 = B (теги перед медіа), C_CTX_DEC_09 = A (фаза 6 виконана рішенням) |
