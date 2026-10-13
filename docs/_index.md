# Documentation Index

Маршрутизатор по `docs/`: один рядок на файл і карта префіксів ID. Похідний перелік — документи є джерелом істини.

## Documents

| File | ID | Status | Що це |
|------|----|--------|-------|
| [context_editor.concept.md](context_editor.concept.md) | C_CTX | active | Концепт мода-редактора контексту (парасолька набору): філософія, доменна модель, інтеграція, рішення C_CTX_DEC_*; механізми — у дочірньому файлі |
| [context_editor.sp.md](context_editor.sp.md) | SP_CTX | active | Специфікація (парасолька набору): правила валідації, відкат, рішення SP_CTX_DEC_*, перелік дочірніх файлів зі структурами, контрактами за модулями, станами і критеріями перевірки |
| [context_editor.plan.md](context_editor.plan.md) | PL_CTX | in-progress | План: фази 1–28 виконані; фази 29–31 (калібрування перед застосуванням, теги зниклих рядків, дрібні вади CF-43/52/53) — дизайн; фаза 32 (ремонт після відновлення, CF-46/51) — дизайн; backlog наступної роботи |

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

## ID prefixes

| Prefix | File |
|--------|------|
| `C_CTX_01`, `C_CTX_02`, `C_CTX_04`, `C_CTX_DEC` | [context_editor.concept.md](context_editor.concept.md) |
| `C_CTX_03` | [context_editor.mechanisms.concept.md](context_editor.mechanisms.concept.md) |
| `SP_CTX_01` (структури, константи 01_12) | [context_editor.structures.sp.md](context_editor.structures.sp.md) |
| `SP_CTX_02_01`–`02_10` (перегляд, правки, застосування, компактизація, медіа) | [context_editor.edits.sp.md](context_editor.edits.sp.md) |
| `SP_CTX_02_11`–`02_18` (теги, псевдоніми, поточна розмова) | [context_editor.tags.sp.md](context_editor.tags.sp.md) |
| `SP_CTX_02_19`–`02_26` (передача) | [context_editor.handoff.sp.md](context_editor.handoff.sp.md) |
| `SP_CTX_02_27`–`02_38`, `02_42`–`02_43` (етапи, телеметрія, нотатки, доставки, нагадування, кеш, `/compact` людини, рядок людини після застосування) | [context_editor.stages.sp.md](context_editor.stages.sp.md) |
| `SP_CTX_02_39`–`02_41` (вкладення хоста) | [context_editor.hostattach.sp.md](context_editor.hostattach.sp.md) |
| `SP_CTX_02_44`–`02_48` (ремонт після відновлення: журнал входу, DropPulled, ремонт, ToolRefText) | [context_editor.resume.sp.md](context_editor.resume.sp.md) |
| `SP_CTX_02_50`–`02_52` (старі сесії: SweepSessions, PackSession, RestoreSession) | [context_editor.cleanup.sp.md](context_editor.cleanup.sp.md) |
| `SP_CTX_02_49` (результати субагентів: ShapeSubagentResult) | [context_editor.subagents.sp.md](context_editor.subagents.sp.md) |
| `SP_CTX_04` (переходи станів) | [context_editor.states.sp.md](context_editor.states.sp.md) |
| `SP_CTX_05_01` (модульні очікування) | [context_editor.expectations.sp.md](context_editor.expectations.sp.md) |
| `SP_CTX_05_02`–`05_04` (інваріанти, сценарії, граничні випадки) | [context_editor.scenarios.sp.md](context_editor.scenarios.sp.md) |
| `SP_CTX_02`, `SP_CTX_03`, `SP_CTX_05`, `SP_CTX_06`, `SP_CTX_DEC` | [context_editor.sp.md](context_editor.sp.md) |
| `PL_CTX` | [context_editor.plan.md](context_editor.plan.md) |

Старіші рядки Changelog документів — у `context_editor.{concept,sp,plan}.log.md` (поза перевірками цілісності).
