# Documentation Index

Маршрутизатор по `docs/`: один рядок на файл і карта префіксів ID. Похідний перелік — документи є джерелом істини.

## Documents

| File | ID | Status | Що це |
|------|----|--------|-------|
| [context_editor.concept.md](context_editor.concept.md) | C_CTX | active | Концепт мода-редактора контексту (парасолька набору): спільні філософія й обмеження хоста, склад набору, покажчик рішень C_CTX_DEC_*; дочірні концепти — ядро й інструменти, методи оптимізації контексту, курування історії |
| [context_editor.sp.md](context_editor.sp.md) | SP_CTX | active | Специфікація (парасолька набору): правила валідації, відкат, покажчик рішень SP_CTX_DEC_*, перелік дочірніх файлів зі структурами, контрактами за модулями, станами і критеріями перевірки |
| [context_editor.plan.md](context_editor.plan.md) | PL_CTX | in-progress | План (парасолька): мета, технологічні рішення, прогрес, таблиця фаз, backlog, рішення; кожна фаза — у дочірньому `context_editor.p<NN>.plan.md`. Фази 1–47 виконано, фаза 48 (заголовок сесії) в роботі (38 — можливості хоста, 39–46 — курування історії, 47 — тека архівів від кореня проєкту сесії); backlog відкритий |
| [context_folds.concept.md](context_folds.concept.md) | C_FOLD | active | Концепт згорток і пам'яті завдань: згортка як єдина дія, вкладені області, покрокове розгортання в кінець контексту з поверненням, картки завдань, вставки після ходу, довіра за авторством; спирається на C_CTX і змінює шість його правил; відкрите рішення DEC_14 з тригером; безпекові механізми відкладено (DEC_15) |
| [context_folds.sp.md](context_folds.sp.md) | SP_FOLD | active | Специфікація згорток: облік згорток, інструмент розгортання `context_recall`, повернення згаданого, згортка зі словами людини й обходом пінів, ланцюжок областей, службові вставки; таблиця змінених розділів SP_CTX |
| [context_folds.plan.md](context_folds.plan.md) | PL_FOLD | completed | План: шість фаз у моді context-editor, усі виконано; фаза 4 — порівняльний прогін (перевагу карток не виміряв), далі вкладені області й вставки |
| [context_helper.concept.md](context_helper.concept.md) | C_HELP | active | Концепт помічника мода: питання агента до архівів згорток з цитатами, які мод перевіряє в архіві (помічник — один виклик sonnet поза розмовою); доручення з умовою про стан контексту з доставкою в безпечний момент; відкладені пакети правок без власного переписування кешу; спирається на C_CTX і C_FOLD і змінює сім їхніх правил; DEC_10 закрито зондом |
| [context_helper.sp.md](context_helper.sp.md) | SP_HELP | draft | Специфікація помічника мода: інструмент `context_helper` (питання до архіву згорток з перевіреними цитатами, доручення з умовою), поле `defer` у `context_edit`, годинник кешу й простій, доставка в безпечний момент і пробудження; таблиця змінених розділів SP_CTX і SP_FOLD; парасолька й три дочірні файли (ask, errands, batches) |
| [context_helper.plan.md](context_helper.plan.md) | PL_HELP | active | План реалізації помічника мода: дев'ять фаз — помічник і питання до архіву, годинник кешу, відкладені пакети в обробнику, поле `defer`, простій, новий процес, доручення й доставка, пробудження, живий прогін; порядок фаз — рішення розробника (DEC_01) |

## Maps

| File | Що це |
|------|-------|
| [_framework.md](_framework.md) | Архітектурна карта коду мода: шари модулів `hooks/*.ts`, шаблон портів, де живе стан, заплановані абстракції з аудиту коду (ведуть лише onboard і `audit code`) |
| [_glossary.md](_glossary.md) | Канонічні терміни предметної області (область, згортка, згадане, вставка тощо) з посиланням на концепт, що їх визначає |

## Spikes

| File | Status | Що досліджено |
|------|--------|---------------|
| [context_editor_session.spike.md](context_editor_session.spike.md) | concluded | Нова сесія через новий файл транскрипту (схема B) |
| [context_editor_handoff_long.spike.md](context_editor_handoff_long.spike.md) | concluded | Передача через транскрипт для довгих сесій і хостів без `/resume` |
| [context_editor_attachments.spike.md](context_editor_attachments.spike.md) | concluded | Вкладення `queued_command` і компактизація від обробника |
| [context_editor_media.spike.md](context_editor_media.spike.md) | concluded | Медіа в промптах людини і межі вікон трьох подань |
| [context_editor_efficiency.spike.md](context_editor_efficiency.spike.md) | concluded | Модель ефективності стиснення контексту |
| [context_editor_cache.spike.md](context_editor_cache.spike.md) | concluded | Чому apply мода скидає кеш промпту всієї розмови |
| [context_editor_host_attachments.spike.md](context_editor_host_attachments.spike.md) | concluded | Застарілі вкладення хоста (`instructions`, `skill_listing`) після застосувань |
| [context_editor_authorship.spike.md](context_editor_authorship.spike.md) | concluded | Форма стиснутого рядка, у якій haiku і sonnet бачать своє авторство (заглушка + власний рядок, збережені виклики, тексти без префікса) |
| [context_editor_resume.spike.md](context_editor_resume.spike.md) | concluded | Дублікати відповідей після `--resume` сесії із застосуваннями мода (злиття за `message.id`, ремонт після відновлення, ToolSearch) |
| [context_editor_subagents.spike.md](context_editor_subagents.spike.md) | concluded | Мод у субагентах: читання й переписування розмови субагента (компактизація хоста з `agentId`, `session.append` з `tool-result`), доставка посібника й інструментів, економіка редагування реальних субагентів |
| [context_editor_probe.spike.md](context_editor_probe.spike.md) | concluded | Процес-зонд можливостей хоста: чи доходять хуки мода (`session.compact`, вкладення) на 2.1.296 і 2.1.299 |
| [context_editor_hostrows.spike.md](context_editor_hostrows.spike.md) | concluded | Рядки, які додає хост (`isMeta`: розгорнуті навички, звіти субагентів, примітки до команд): ні перегляд `$.session.messages()`, ні `e.messages` обробника їх не мають; після застосування хост повертає кожен за рядком перед ним, якщо той зберіг `handle`; мод записує їх при `session.append` |
| [context_editor_session_title.spike.md](context_editor_session_title.spike.md) | concluded | Заголовок сесії за темою задачі: `/rename` через `$.command.run` працює в терміналі й stream-json, заголовок доходить до людини й VS Code; ціна — три рядки в розмові на запуск, у терміналі ще нагадування «The user named this session» |
| [context_editor_uses.spike.md](context_editor_uses.spike.md) | concluded | Інші застосування вільного редагування попередніх повідомлень, крім стиснення: правка історії як важіль поведінки, урок замість сирої невдачі, «вигляд ≠ запис», «присвоювати дію, а не зміст»; thinking-підписи й авто-режим як обмеження |
| [context_service_info.spike.md](context_service_info.spike.md) | concluded | Службова інформація в контексті чату як універсальний інструмент агента: мод уже несе всі чотири класи, бракує узагальнення; «змінне поза контекстом, у хвіст лише незмінне», «справжність маркера дає канал»; 29 варіантів — 10 варті концепту, 13 потребують даних; думковий експеримент нескінченної сесії, рамка розробника, два живі зонди; джерело концепту C_FOLD |
| [context_supervisor.spike.md](context_supervisor.spike.md) | concluded | Субагент-наглядач за головним контекстом: механізми хоста 2.1.325 (`$.model.fork`/`complete`, `$.agent.spawn`, тригери, канали доставки порад), докази про монітори й критиків агента, сценарії для context-editor |
| [context_helper.spike.md](context_helper.spike.md) | concluded | Субагент-помічник для context-editor: автономні запити мода з відповіддю для розбору (sonnet; за часом, після простою, за умовою агента), делегування задач з основного контексту, докази про стиснення виводів і ізоляцію контексту |

## ID prefixes

| Prefix | File |
|--------|------|
| `C_CTX_01`, `C_CTX_SET` (набір концептів), `C_CTX_DEC` (покажчик рішень), `C_CTX_DEC_32` | [context_editor.concept.md](context_editor.concept.md) |
| `C_CTX_02`, `C_CTX_03` (крім 03_02, 03_06, 03_09, 03_12), `C_CTX_04`; `C_CTX_DEC_01`–`03`, `05`–`10`, `18`, `20`–`22`, `24`–`26`, `28`, `29`, `31` | [context_editor.core.concept.md](context_editor.core.concept.md) |
| `C_CTX_03_02`, `C_CTX_03_06`, `C_CTX_03_09`, `C_CTX_03_12`; `C_CTX_DEC_04`, `11`–`17`, `19`, `23`, `27`, `30`, `41`–`44` | [context_editor.methods.concept.md](context_editor.methods.concept.md) |
| `C_CTX_06`; `C_CTX_DEC_33`–`40` | [context_editor.curation.concept.md](context_editor.curation.concept.md) |
| `SP_CTX_01`, `01_01`–`01_11` (структури) | [context_editor.structures.sp.md](context_editor.structures.sp.md) |
| `SP_CTX_01_12` (константи) | [context_editor.constants.sp.md](context_editor.constants.sp.md) |
| `SP_CTX_01_13`–`01_26` (реєстри і стан сесії) | [context_editor.records.sp.md](context_editor.records.sp.md) |
| `SP_CTX_02_01`–`02_03`, `02_05`, `02_09` (перегляд, правки) | [context_editor.edits.sp.md](context_editor.edits.sp.md) |
| `SP_CTX_02_04`, `02_07`, `02_10` (застосування, обробник компактизації, медіа) | [context_editor.apply.sp.md](context_editor.apply.sp.md) |
| `SP_CTX_02_06`, `02_08` (Flush, доставка звіту) | [context_editor.flush.sp.md](context_editor.flush.sp.md) |
| `SP_CTX_02_11`–`02_18` (теги, псевдоніми, поточна розмова) | [context_editor.tags.sp.md](context_editor.tags.sp.md) |
| `SP_CTX_02_19`–`02_26` (передача) | [context_editor.handoff.sp.md](context_editor.handoff.sp.md) |
| `SP_CTX_02_27`, `02_29`, `02_30`, `02_32`, `02_33`, `02_42`, `02_43` (вступ сесії, етапи, мітка, нотатки, `/compact` людини, рядок людини після застосування) | [context_editor.stages.sp.md](context_editor.stages.sp.md) |
| `SP_CTX_02_28`, `02_31`, `02_34`, `02_37`, `02_38` (телеметрія, журнал ефекту, оцінки, м'яке нагадування, кеш) | [context_editor.telemetry.sp.md](context_editor.telemetry.sp.md) |
| `SP_CTX_02_35`, `02_36` (доставки хоста посеред ходу) | [context_editor.deliveries.sp.md](context_editor.deliveries.sp.md) |
| `SP_CTX_02_39`–`02_41` (вкладення хоста) | [context_editor.hostattach.sp.md](context_editor.hostattach.sp.md) |
| `SP_CTX_02_44`–`02_48` (ремонт після відновлення: журнал входу, DropPulled, ремонт, ToolRefText) | [context_editor.resume.sp.md](context_editor.resume.sp.md) |
| `SP_CTX_02_50`–`02_52` (старі сесії: SweepSessions, PackSession, RestoreSession) | [context_editor.cleanup.sp.md](context_editor.cleanup.sp.md) |
| `SP_CTX_02_49` (результати субагентів: ShapeSubagentResult) | [context_editor.subagents.sp.md](context_editor.subagents.sp.md) |
| `SP_CTX_02_53`–`SP_CTX_02_57` (можливості хоста: Capabilities, дії при обході, CompactBrief, RunProbe, ProbeMode) | [context_editor.bypass.sp.md](context_editor.bypass.sp.md) |
| `SP_CTX_01_32`, `03_03`–`03_04`, `06_02`, `SP_CTX_DEC_39`–`44` (курування історії: парасолька — константи, перевірки, відкат, рішення) | [context_editor.curation.sp.md](context_editor.curation.sp.md) |
| `SP_CTX_01_27`, `01_28`, `01_30`, `02_58`, `02_59`, `02_62`–`02_66`, `02_68`, `02_69` (курування: правки, тексти замін, піни, правила навички) | [context_editor.curation.edits.sp.md](context_editor.curation.edits.sp.md) |
| `SP_CTX_01_29`, `02_67`, `04_08` (курування: пункти слота стану) | [context_editor.curation.slot.sp.md](context_editor.curation.slot.sp.md) |
| `SP_CTX_01_31`, `02_60`, `02_61`, `04_09` (курування: рядки хоста) | [context_editor.curation.hostrows.sp.md](context_editor.curation.hostrows.sp.md) |
| `SP_CTX_01_33`, `02_70`–`02_74`, `SP_CTX_DEC_46` (заголовок сесії) | [context_editor.title.sp.md](context_editor.title.sp.md) |
| `SP_CTX_05_05`–`05_08` (курування: критерії перевірки) | [context_editor.curation.verification.sp.md](context_editor.curation.verification.sp.md) |
| `SP_CTX_04` (переходи станів) | [context_editor.states.sp.md](context_editor.states.sp.md) |
| `SP_CTX_05_01` (модульні очікування; рядки — у `context_editor.expectations.<модуль>.sp.md`) | [context_editor.expectations.sp.md](context_editor.expectations.sp.md) |
| `SP_CTX_05_02`–`05_03` (інваріанти, сценарії) | [context_editor.scenarios.sp.md](context_editor.scenarios.sp.md) |
| `SP_CTX_05_04` (граничні випадки) | [context_editor.edges.sp.md](context_editor.edges.sp.md) |
| `SP_CTX_DEC_01`–`DEC_20` | [context_editor.decisions-01.sp.md](context_editor.decisions-01.sp.md) |
| `SP_CTX_DEC_21`–`DEC_38`, `DEC_45` | [context_editor.decisions-21.sp.md](context_editor.decisions-21.sp.md) |
| `SP_CTX_02`, `SP_CTX_03`, `SP_CTX_05`, `SP_CTX_06`, `SP_CTX_DEC` (покажчик рішень) | [context_editor.sp.md](context_editor.sp.md) |
| `PL_CTX` | [context_editor.plan.md](context_editor.plan.md) |
| `C_FOLD`, `C_FOLD_01`–`C_FOLD_04`, `C_FOLD_DEC_01`–`15` | [context_folds.concept.md](context_folds.concept.md) |
| `SP_FOLD`, `SP_FOLD_01`–`SP_FOLD_06`, `SP_FOLD_DEC_01`–`08` | [context_folds.sp.md](context_folds.sp.md) |
| `PL_FOLD`, `PL_FOLD_P1`–`P6`, `PL_FOLD_DEC_01`–`02` | [context_folds.plan.md](context_folds.plan.md) |
| `C_HELP`, `C_HELP_01`–`C_HELP_04`, `C_HELP_DEC_01`–`10` | [context_helper.concept.md](context_helper.concept.md) |
| `SP_HELP`, `SP_HELP_01`, `SP_HELP_01_08`–`01_09`, `SP_HELP_02`, `SP_HELP_02_13`–`02_14`, `SP_HELP_03`–`SP_HELP_06`, `SP_HELP_DEC_01`–`09` | [context_helper.sp.md](context_helper.sp.md) (парасолька) |
| `SP_HELP_01_01`–`01_04`, `SP_HELP_02_01`–`02_05` | [context_helper.ask.sp.md](context_helper.ask.sp.md) |
| `SP_HELP_01_05`, `SP_HELP_02_06`–`02_08` | [context_helper.errands.sp.md](context_helper.errands.sp.md) |
| `SP_HELP_01_06`–`01_07`, `SP_HELP_02_09`–`02_12` | [context_helper.batches.sp.md](context_helper.batches.sp.md) |
| `PL_HELP`, `PL_HELP_P1`–`P9`, `PL_HELP_DEC_01`–`04` | [context_helper.plan.md](context_helper.plan.md) |
| `PL_CTX_P<N>` | `context_editor.p<NN>.plan.md` (N двома цифрами, напр. `PL_CTX_P7` → [context_editor.p07.plan.md](context_editor.p07.plan.md)) |

Старіші рядки Changelog документів — у `context_editor.{concept,sp,plan}.log.md` і `context_editor.{edits,structures}.sp.log.md` (поза перевірками цілісності).

## Adoption notes

Аналізи зовнішніх репозиторіїв (`/dev-flow adopt`): які їхні ідеї варто адаптувати тут. Advisory — без воріт, без traceable ID, не backlog.

| Source repo | Що приносить | Результат прогону |
|-------------|--------------|-------------------|
| [token-economizer](./ext_adoption/token-economizer.md) · [concept](./ext_adoption/token-economizer.concept.md) | TokenEconomizer @ `e428fc9` — запобіжник петель, облік вартості з власними накладними, життєвий цикл вивчених правил, рукави експерименту, журнал поведінки хостів | high — 0; medium — 4 (усі defer); похідні D1–D2 (D2 має запис: навичка plugin-hooks `stale`) |
