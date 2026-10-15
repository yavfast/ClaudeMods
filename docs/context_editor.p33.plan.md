# Редактор контексту агента — Implementation Plan: фаза 33 — Посібник навички на початку сесії

> **Code:** PL_CTX (дочірній файл набору)
> **Status:** completed
> **Updated:** 2026-10-15
> **Umbrella:** [PL_CTX](./context_editor.plan.md)

### Phase 33 — Посібник навички на початку сесії [DONE]  {#PL_CTX_P33}

**Depends on:** Phase 14 (SessionIntro, `introduced`), Phase 30 (спостерігач чужої компактизації, одна зміна реєстру).
**Implements:** [SP_CTX_DEC_36](./context_editor.decisions-21.sp.md#SP_CTX_DEC_36); [SP_CTX_02_27](./context_editor.stages.sp.md#SP_CTX_02_27) (GuideText, `reintroduce`), [SP_CTX_02_08](./context_editor.flush.sp.md#SP_CTX_02_08) (Intro), [SP_CTX_02_18](./context_editor.tags.sp.md#SP_CTX_02_18) (спостерігач ставить `reintroduce`), [SP_CTX_01_10](./context_editor.structures.sp.md#SP_CTX_01_10) (`reintroduce`), [SP_CTX_01_12](./context_editor.constants.sp.md#SP_CTX_01_12) (GUIDE_FRAME).
**Verify:** [SP_CTX_05_01](./context_editor.expectations.sp.md#SP_CTX_05_01) рядки SessionIntro (перший промпт, GUIDE_UNREAD, після чужої компактизації, компактизація до вступу, GuideText); живий прогін у stream-json: перший промпт несе посібник (журнал `--debug`, `prompt.attachment hook_additional_context` ~9 тисяч символів), агент не відкриває `Skill`; після `/compact host` наступний промпт несе INTRO_TEXT.

| Що | Де |
|----|----|
| GUIDE_FRAME, GuideText (чиста: текст файлу → посібник або нічого), `introFor(read, guide)` з `reintroduce`, `withIntroduced` знімає `reintroduce` | `mods/context-editor/hooks/stages.ts`; `tests/stages.test.ts` |
| Поле `reintroduce` у TagRegistry: розбір (необов'язкове bool), запис | `mods/context-editor/hooks/tags.ts`; `tests/tags.test.ts` |
| Спостерігач: `reintroduce = true` в одній зміні з PruneDeadTags і `lastApply`, коли `introduced` | `mods/context-editor/hooks/compaction.ts`; `tests/compaction.test.ts` |
| Передача: копія реєстру без `reintroduce` | `mods/context-editor/hooks/handoff.ts`; `tests/handoff.test.ts` |
| Зв'язування: читання `${$.plugin.root}/skills/context-stages/SKILL.md` раз на екземпляр модуля (невдачу — повторити з наступним вступом) | `mods/context-editor/hooks/register.ts` |
| CLAUDE.md: рядок про посібник у першому промпті | `CLAUDE.md` |

## Changelog

| Date | Change |
|------|--------|
| 2026-10-15 | Розділ перенесено дослівно з [context_editor.plan.md](./context_editor.plan.md): поділ плану по фазах (structural-event) |
