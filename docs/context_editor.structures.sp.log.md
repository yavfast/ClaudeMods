# Редактор контексту агента — Specification: structures — Changelog archive

> Older rows of the Changelog of [context_editor.structures.sp.md](./context_editor.structures.sp.md), moved when it passed 30 entries (dev-flow Docs Scaling, `changelog_overflow`). Oldest first.

| Date | Change |
|------|--------|
| 2026-10-11 | Структура (audit, Docs Scaling `hard_split`): §01 Data Structures (01_01–01_22) перенесено дослівно з [context_editor.sp.md](./context_editor.sp.md) у [context_editor.structures.sp.md](./context_editor.structures.sp.md), якорі без змін |
| 2026-10-11 | PL_AUD_CTX фаза 1 (CF-1): сховище публікується парою `session_id` + каталог наприкінці підготовки, одна підготовка на id, кожна операція пише в каталог, отриманий один раз; SESSION_ID — перевірка id перед побудовою шляху; форма готовності `{dir} \| {reason}` і текст відмови `storage unavailable: …` (01_07, 01_12) |
| 2026-10-11 | PL_AUD_CTX фаза 1, рев'ю: фонова робота події бере каталог у момент події; обробник компактизації, що приєднався до підготовки, не чекає `hostId` (01_07, 01_14) |
| 2026-10-11 | PL_AUD_CTX фаза 3 (CF-5): 01_12 — REMINDER_PREFIX спільний для PROMPT_DECORATIONS і BuildSeed |
