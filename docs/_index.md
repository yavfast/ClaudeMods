# Documentation Index

Маршрутизатор по `docs/`: один рядок на файл і карта префіксів ID. Похідний перелік — документи є джерелом істини.

## Documents

| File | ID | Status | Що це |
|------|----|--------|-------|
| [context_editor.concept.md](context_editor.concept.md) | C_CTX | active | Концепт мода-редактора контексту (парасолька набору): спільні філософія й обмеження хоста, склад набору, покажчик рішень C_CTX_DEC_*; дочірні концепти — ядро й інструменти, методи оптимізації контексту, курування історії |
| [context_editor.sp.md](context_editor.sp.md) | SP_CTX | active | Специфікація (парасолька набору): правила валідації, відкат, покажчик рішень SP_CTX_DEC_*, перелік дочірніх файлів зі структурами, контрактами за модулями, станами і критеріями перевірки |
| [context_editor.plan.md](context_editor.plan.md) | PL_CTX | completed | План (парасолька): мета, технологічні рішення, прогрес, таблиця фаз, backlog, рішення; кожна фаза — у дочірньому `context_editor.p<NN>.plan.md`. Фази 1–47 виконано (38 — можливості хоста, 39–46 — курування історії, 47 — тека архівів від кореня проєкту сесії); backlog відкритий |

## Maps

| File | Що це |
|------|-------|
| [_framework.md](_framework.md) | Архітектурна карта коду мода: шари модулів `hooks/*.ts`, шаблон портів, де живе стан, заплановані абстракції з аудиту коду (ведуть лише onboard і `audit code`) |

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
| [context_editor_uses.spike.md](context_editor_uses.spike.md) | concluded | Інші застосування вільного редагування попередніх повідомлень, крім стиснення: правка історії як важіль поведінки, урок замість сирої невдачі, «вигляд ≠ запис», «присвоювати дію, а не зміст»; thinking-підписи й авто-режим як обмеження |

## ID prefixes

| Prefix | File |
|--------|------|
| `C_CTX_01`, `C_CTX_SET` (набір концептів), `C_CTX_DEC` (покажчик рішень), `C_CTX_DEC_32` | [context_editor.concept.md](context_editor.concept.md) |
| `C_CTX_02`, `C_CTX_03` (крім 03_02, 03_06, 03_09), `C_CTX_04`; `C_CTX_DEC_01`–`03`, `05`–`10`, `18`, `20`–`22`, `24`–`26`, `28`, `29`, `31` | [context_editor.core.concept.md](context_editor.core.concept.md) |
| `C_CTX_03_02`, `C_CTX_03_06`, `C_CTX_03_09`; `C_CTX_DEC_04`, `11`–`17`, `19`, `23`, `27`, `30` | [context_editor.methods.concept.md](context_editor.methods.concept.md) |
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
| `SP_CTX_05_05`–`05_08` (курування: критерії перевірки) | [context_editor.curation.verification.sp.md](context_editor.curation.verification.sp.md) |
| `SP_CTX_04` (переходи станів) | [context_editor.states.sp.md](context_editor.states.sp.md) |
| `SP_CTX_05_01` (модульні очікування; рядки — у `context_editor.expectations.<модуль>.sp.md`) | [context_editor.expectations.sp.md](context_editor.expectations.sp.md) |
| `SP_CTX_05_02`–`05_03` (інваріанти, сценарії) | [context_editor.scenarios.sp.md](context_editor.scenarios.sp.md) |
| `SP_CTX_05_04` (граничні випадки) | [context_editor.edges.sp.md](context_editor.edges.sp.md) |
| `SP_CTX_DEC_01`–`DEC_20` | [context_editor.decisions-01.sp.md](context_editor.decisions-01.sp.md) |
| `SP_CTX_DEC_21`–`DEC_38`, `DEC_45` | [context_editor.decisions-21.sp.md](context_editor.decisions-21.sp.md) |
| `SP_CTX_02`, `SP_CTX_03`, `SP_CTX_05`, `SP_CTX_06`, `SP_CTX_DEC` (покажчик рішень) | [context_editor.sp.md](context_editor.sp.md) |
| `PL_CTX` | [context_editor.plan.md](context_editor.plan.md) |
| `PL_CTX_P<N>` | `context_editor.p<NN>.plan.md` (N двома цифрами, напр. `PL_CTX_P7` → [context_editor.p07.plan.md](context_editor.p07.plan.md)) |

Старіші рядки Changelog документів — у `context_editor.{concept,sp,plan}.log.md` і `context_editor.{edits,structures}.sp.log.md` (поза перевірками цілісності).
