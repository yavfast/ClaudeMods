# Редактор контексту агента — Specification: Contracts: subagent results

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-13
> **Updated:** 2026-10-17
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_49 специфікації [SP_CTX](./context_editor.sp.md): обрізання великих результатів інструментів субагента в мить запису ([C_CTX_03_09](./context_editor.methods.concept.md#C_CTX_03_09), [C_CTX_DEC_27](./context_editor.methods.concept.md#C_CTX_DEC_27)). Читати перед зміною `hooks/subagents.ts` або хука `session.append`.

## Contents

- [02_49. ShapeSubagentResult](#SP_CTX_02_49)

## 02. Contracts — результати субагентів

### 02_49. ShapeSubagentResult  {#SP_CTX_02_49}

Purpose: великий новий результат інструмента субагента зберегти в архів і записати в розмову субагента головою, хвостом і рядком обрізання зі шляхом архіву.

Processing logic (pseudocode):
    ON row appended (door = tool-result, agentId present):        # хук session.append, до AppendRow (02_12) і до next
        IF origin.kind ≠ tool OR origin.tool IN (Read, unknown) OR origin.tool starts with OWN_TOOLS: RETURN next(row)
        IF agentId NOT matching SUB_ID: RETURN next(row)
        dir = <cwd>/.claude/context-editor/<session_id>                # cwd і session_id основної сесії; .claude/context-editor/.gitignore = "*" створюється, коли його немає
        IF storage, cwd or that folder absent: RETURN next(row)
        content = row.message.content
        FOR each block b of content WITH b.type = tool_result:
            IF b.tool_use_id NOT matching SUB_ID: CONTINUE
            text = b.content when a string; else the text blocks of b.content joined by "\n" when every block is text; else CONTINUE   # медіа — не обрізається
            IF len(text) < SUB_CUT_AT: CONTINUE
            path = <dir>/subagents/<agentId>/<b.tool_use_id>.txt
            IF NOT write text to path (owner-only, no size cap): CONTINUE  # не записалось — блок як є
            b.content = Cut(text, path)                                  # рядок; is_error і tool_use_id лишаються
        RETURN next(row with content) when some block changed, else next(row)
    ON hook failure: RETURN next(row)

    Cut(text, path):
        h = SUB_HEAD; IF the last "\n" in text[0:SUB_HEAD] is at i ≥ SUB_HEAD/2: h = i + 1
        t = len(text) − SUB_TAIL; IF the first "\n" in text[t:] is at j with j − t < SUB_TAIL/2: t = j + 1
        RETURN text[0:h] + "\n[context-editor: " + (t − h) + " chars cut; full output: " + path + ", open with Read]\n" + text[t:]

Обрізання — правило, а не вибір агента ([C_CTX_DEC_27](./context_editor.methods.concept.md#C_CTX_DEC_27)): інструментів редагування в субагенті немає, а компактизацію субагента плагін запустити не може (навичка plugin-hooks, пункт 67). Рядок ще не був у жодному запиті, тож кеш промпту не переписується. Хост зберігає і надсилає переписаний `content` (проба спайку context_editor_subagents, прогін 1); `tool_use_id` він кладе назад сам. Основна розмова, `Read` (агент задає його розмір сам і ним читає архів) і власні інструменти мода не обрізаються; результат з медіа — теж: замінити медіа текстом хост дозволяє, але опис медіа агенту субагента нікому дати.

Архів — простий текстовий файл з повним виводом (режим 600) у робочому каталозі сесії, а не в сховищі мода ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)): читання поза проєктом хост без дозволу відхиляє, а в робочому каталозі дозволяє (живий прогін фази 34, [C_CTX_DEC_27](./context_editor.methods.concept.md#C_CTX_DEC_27)). Каталог `.claude/context-editor/` проєкту несе власний `.gitignore` із `*`, тож git проєкту архівів не бачить, а `.gitignore` проєкту мод не змінює. Запис через оболонку хоста, без межі 4 MiB `$.fs.write`. Ім'я — `tool_use_id`: повторний запис того самого результату перезаписує файл тим самим текстом. Архіви субагентів не входять у журнал ефекту; поки сесія жива, мод їх не прибирає, як і архіви основної розмови, а з даними старої сесії їх видаляє чи пакує SweepSessions ([SP_CTX_02_50](./context_editor.cleanup.sp.md#SP_CTX_02_50)).

Errors:

| Condition | Result |
|-----------|--------|
| Сховище недоступне | рядок без змін |
| Запис архіву не вдався | цей блок без змін, інші обрізаються |
| `agentId` або `tool_use_id` не відповідає SUB_ID | рядок або блок без змін (шлях з нього не будується) |
| Хук падає | рядок без змін (`.catch` → `next(e)`) |
