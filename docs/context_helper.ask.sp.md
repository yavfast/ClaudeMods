# Помічник мода — Specification: питання до архіву — відповідь помічника, матеріал, перевірена цитата, запис питання, виклик помічника, інструмент `context_helper`, Ask, VerifyQuotes, повернення пар питань

> **Code:** SP_HELP (дочірній файл набору)
> **Status:** draft
> **Created:** 2026-11-16
> **Updated:** 2026-11-17
> **Umbrella:** [SP_HELP](./context_helper.sp.md)
>
> §01_01–01_04 і §02_01–02_05 специфікації [SP_HELP](./context_helper.sp.md): виклик помічника з фіксованим форматом відповіді, інструмент `context_helper` і питання агента до архіву згорток з перевіреними цитатами. Читати, коли змінюєте помічника чи питання до архіву.

## Contents

Розділи цього файлу (позначення типів — як у [§01 парасольки](./context_helper.sp.md#SP_HELP_01)):

- [01_01. HelperReply](#SP_HELP_01_01)
- [01_02. Material і Fragment](#SP_HELP_01_02)
- [01_03. VerifiedQuote](#SP_HELP_01_03)
- [01_04. Question](#SP_HELP_01_04)
- [02_01. HelperCall](#SP_HELP_02_01)
- [02_02. Інструмент `context_helper`](#SP_HELP_02_02)
- [02_03. Ask (операція `ask`)](#SP_HELP_02_03)
- [02_04. VerifyQuotes](#SP_HELP_02_04)
- [02_05. Повернення пар питань](#SP_HELP_02_05)

## 01. Data Structures

### 01_01. HelperReply  {#SP_HELP_01_01}

Відповідь помічника на один виклик — один об'єкт JSON у тексті відповіді моделі. Інструкція помічника (HELP_SYSTEM, §01_09) описує саме цей об'єкт.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| status | `'answered' \| 'not_found' \| 'refused'` | yes | — | одне з трьох | `answered` — відповідь є; `not_found` — у матеріалі відповіді немає; `refused` — помічник відмовився |
| answer | string | для `answered` | `""` | обрізається до HELP_ANSWER символів | Висновок помічника; для агента — «прочитання помічника», зовнішній зміст |
| quotes | `{ text: string, row: int }[]` | no | `[]` | `text` непорожній, обрізання недопустиме (довший за MAX_QUOTE — цитата відкидається); `row` ≥ 0 | Дослівні цитати з матеріалу й номер рядка рівня `#n`, у якому помічник їх бачив |
| reason | string | для `refused` | `""` | обрізається до HELP_REASON символів | Чому помічник відмовився |

Розбір (ParseReply): з тексту відповіді знімається одна огорожа коду з позначкою `json`, якщо вона є; береться підрядок від першої `{` до останньої `}`; він має розібратися як об'єкт JSON з полем `status` одного з трьох значень. Зайві поля ігноруються. Цитати понад MAX_QUOTES не перевіряються й лічаться відкинутими. Будь-що інше — збій формату (§02_01).

Invariants:
- `answered` без `answer` — збій формату; `not_found` і `refused` можуть мати порожній `quotes`.
- Відповідь помічника ніколи не потрапляє до агента без перевірки цитат (§02_04).

### 01_02. Material і Fragment  {#SP_HELP_01_02}

**Material** — текст, який отримує помічник для однієї частини: заголовок частини й рядки рівня згортки в тому вигляді, який дає розгортання (`levelRowText`, [SP_FOLD_02_02](./context_folds.sp.md#SP_FOLD_02_02)): `#n роль:`, текст, `call: <джерело>`, `result: <текст>`, позначки архівованих медіа; рядок, довший за MAX_RECALL_ROW, обрізаний з позначкою.

Fields (Part):
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| fold | string | yes | — | `id` запису згортки | Згортка, з рівня якої частина |
| index | int | yes | — | 1..parts | Номер частини серед частин цієї згортки |
| parts | int | yes | — | ≥ 1 | Скільки частин у рівні цієї згортки |
| from | int | yes | — | ≥ 0 | Перший рядок рівня (`#n`) у частині |
| to | int | yes | — | ≥ from | Останній рядок рівня в частині |
| text | string | yes | — | ≤ HELP_PART_CHARS символів | Заголовок `Material: fold <id>, part <index> of <parts>, rows #<from>–#<to>` і рядки |

Поділ на частини: рядки рівня йдуть по порядку, частина набирає рядки, доки її текст не перевищить HELP_PART_CHARS; рядок, з яким частина перевищила б межу, починає наступну. Рядок довший за межу сам не буває: `levelRowText` обрізає його до MAX_RECALL_ROW < HELP_PART_CHARS.

**Fragment** — шматок тексту рядка рівня з походженням; за фрагментами мод перевіряє цитати (§02_04) і дає кожній перевіреній цитаті походження ([C_HELP_03_02](./context_helper.concept.md#C_HELP_03_02), [C_FOLD_03_05](./context_folds.concept.md#C_FOLD_03_05)).

Fields (Fragment):
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| row | int | yes | — | номер рядка рівня | Рядок `#n` |
| text | string | yes | — | повний текст шматка з архіву, без обрізання MAX_RECALL_ROW | Те, у чому шукається цитата |
| origin | `'own' \| 'person' \| 'external' \| 'service'` | yes | — | — | Походження |
| source | string | для `external` | `""` | ≤ MAX_SOURCE | Джерело для позначки: `SourceOf` виклику, якому належить результат ([SP_CTX_02_62](./context_editor.curation.edits.sp.md#SP_CTX_02_62)) |

Правило походження:

| Шматок рядка | origin |
|--------------|--------|
| текст відповіді агента; вхід його виклику (`call:`) | `own` |
| слова людини, як їх читає PersonText ([SP_CTX_02_58](./context_editor.curation.edits.sp.md#SP_CTX_02_58)): текст її промпту, її відповіді на AskUserQuestion, її повідомлення, доставлені посеред ходу | `person` |
| результат виклику інструмента, зокрема інструментів мода й субагентів, крім відповідей людини на AskUserQuestion | `external`, `source` — джерело виклику |
| звіт субагента й сповіщення задачі: доставлені посеред ходу чи промптом `peer` між ходами | `external`, `source` = `subagent report` |
| текст мода (`modText`, MARK, замінні тексти), службові рядки хоста | `service` |

Медіа фрагментів не дають: цитувати можна лише текст.

### 01_03. VerifiedQuote  {#SP_HELP_01_03}

Цитата помічника, яку мод знайшов у фрагменті дослівно.

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| fold | string | yes | — | — | Згортка |
| row | int | yes | — | рядок рівня, де знайдено | Може відрізнятися від `row` помічника (§02_04) |
| text | string | yes | — | ≤ MAX_QUOTE; рівно текст помічника | Цитата |
| origin | як у Fragment | yes | — | — | Походження фрагмента, у якому знайдено |
| source | string | для `external` | `""` | — | Джерело фрагмента |

Позначка цитати для агента: `own` — `[your own]`, `person` — `[the person's]`, `external` — `[external: <source>]`, `service` — `[service text]`.

### 01_04. Question  {#SP_HELP_01_04}

Запис питання до архіву в обліку згорток (`folds.json`, поле `questions`, [SP_FOLD_01_02](./context_folds.sp.md#SP_FOLD_01_02)). Живе за правилами запису розгортання ([SP_FOLD_01_03](./context_folds.sp.md#SP_FOLD_01_03)): пара лишається до закриття області, у якій агент питав, потім мод її повертає (§02_05).

Fields:
| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| tool_use_id | string | yes | — | унікальний серед `questions` | Пара питання — відповідь |
| folds | string[] | yes | — | 1..MAX_ASK_FOLDS, без повторів | Згортки питання |
| question | string | yes | — | перші QUESTION_HEAD символів питання | Для сліду повернення |
| verified | int | yes | — | ≥ 0 | Скільки цитат дійшло до агента |
| rejected | int | yes | — | ≥ 0 | Скільки відкинуто |
| depth | int | yes | — | 0..MAX_DEPTH | Глибина ланцюжка областей у мить питання, як у Recall |
| scope | string | yes | — | назва найглибшої відкритої області на мить питання або порожній рядок, як у записі розгортання | Для сліду повернення |
| turn | int | yes | — | лічильник ходів реєстру | Хід питання |
| due | bool | yes | false | — | Область закрилась: пара чекає повернення |

Invariants:
- Записів не більше MAX_QUESTIONS; новий понад межу — відмова QUESTIONS_FULL (§02_03).
- Запис є лише для пари, результат якої починається з ASKED_HEAD; відмови до виклику помічника запису не мають.

## 02. Contracts

### 02_01. HelperCall  {#SP_HELP_02_01}

Purpose: один виклик помічника над однією частиною матеріалу. Спільний для питання (§02_03) і дії доручення «питання помічнику» (§02_07). Виконується одним викликом моделі хоста поза розмовою: без інструментів, без ходу, без рядка в розмові; модель обирає мод ([C_HELP_03_01](./context_helper.concept.md#C_HELP_03_01)).

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| question | string | yes | 1..MAX_QUESTION |
| part | Part (§01_02) | yes | — |

Output:
| Field | Type | Description |
|-------|------|-------------|
| status | `'answered' \| 'not_found' \| 'refused' \| 'failed'` | Статус відповіді чи збій |
| reply | HelperReply \| null | Розібрана відповідь для перших трьох статусів |
| reason | string | Для `failed`: `format`, `api-error <status>` (`api-error without a response`, коли відповіді не було), `empty-reply`, `timeout`, `aborted` чи текст відмови хоста; для `refused` — причина помічника |
| calls | int | 1 чи 2 |
| in, out | int | Токени входу (некешований, записаний і прочитаний разом) і виходу всіх викликів |

Errors: виклик не кидає; кожен збій — `status: 'failed'` з причиною.

Processing logic (pseudocode):

    FUNCTION HelperCall(question, part):
        request = { model: HELP_MODEL, system: HELP_SYSTEM,
                    prompt: ["Question: " + question, part.text],
                    maxTokens: HELP_MAX_TOKENS, timeoutMs: HELP_TIMEOUT_MS }
        r = Complete(request)                  // виклик моделі хоста поза розмовою
        calls = 1; ADD usage of r TO (in, out)  // usage є в кожній гілці результату хоста
        IF r not answered: RETURN failed(FailureReason(r))
        reply = ParseReply(r.text)             // §01_01
        IF reply is a format failure AND HELP_RETRIES ≥ 1:
            r = Complete(request with HELP_RETRY_TEXT appended as the last prompt block)
            calls = 2; ADD usage
            IF r not answered: RETURN failed(FailureReason(r))
            reply = ParseReply(r.text)
        IF reply is a format failure: RETURN failed("format")
        RETURN { status: reply.status, reply, reason: reply.reason, calls, in, out }

FailureReason: `api-error` — `api-error <status>`, без статусу — `api-error without a response`; `empty-reply` — так само; `aborted` — `timeout`, коли від початку виклику минуло щонайменше `timeoutMs`, інакше `aborted`; виняток виклику — його текст.

Частини одного питання мод викликає одночасно; кожна має власний повтор.

### 02_02. Інструмент `context_helper`  {#SP_HELP_02_02}

Purpose: один інструмент агента для помічника ([DEC_01](./context_helper.sp.md#SP_HELP_DEC_01)): питання до архіву й доручення з умовою. Відкладення пакета — поле `defer` інструмента `context_edit` (§02_10). Реєстрація, виклик і відмова субагентові — як в інших інструментах мода ([SP_FOLD_02_02](./context_folds.sp.md#SP_FOLD_02_02)); у режимі зонда можливостей ([SP_CTX_02_57](./context_editor.bypass.sp.md#SP_CTX_02_57)) інструмент не реєструється.

Input:
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| op | `'ask' \| 'errand_add' \| 'errand_list' \| 'errand_remove'` | yes | — |
| folds | string[] | для `ask` і `errand_add` з `action: 'ask'` | 1..MAX_ASK_FOLDS ідентифікаторів згорток, без повторів |
| question | string | там само | 1..MAX_QUESTION після обрізання пробілів |
| when | `'turns' \| 'size' \| 'cold' \| 'closed'` | для `errand_add` | — |
| n | int | для `when` `turns` і `size` | `turns`: 1..MAX_REMIND; `size`: токени, більше за поточний Size (§02_07), ≤ MAX_SIZE_TOKENS |
| name | string | no | для `when: 'closed'`; 1..MAX_STAGE_NAME після обрізання |
| action | `'remind' \| 'ask' \| 'apply'` | для `errand_add` | — |
| text | string | для `action: 'remind'` | 1..MAX_NOTE |
| wake | bool | no | лише `errand_add`; за замовчуванням false; до фази 8 PL_HELP поле відхиляється як BAD_OP і в схемі його немає |
| id | string | для `errand_remove` | ідентифікатор доручення |

Output: результат інструмента — текст операції (§02_03, §02_06). Відмова — `context-editor: <причина>`, як в інших інструментах мода.

Errors (спільні, у порядку перевірки):
| Code | Condition | Guidance |
|------|-----------|----------|
| DENIED_SUBAGENT | виклик субагента | `a subagent cannot use the mod's helper; only the main conversation's folds and errands are kept.` |
| BAD_OP | `op` поза переліком чи поле іншої операції | текст називає дозволені поля операції |

Опис інструмента (HELPER_DESCRIPTION, ≤ MAX_DESCRIPTION):

    Ask the mod's helper about your folds, or set errands the mod runs when a condition on the context holds.
    op "ask": a helper model (sonnet, outside this conversation: no turn, no row) reads the levels of the folds you name (ids from their fold records; up to 4 folds and ~240k chars in all) and answers your question. Only quotes the mod finds verbatim in the archive reach you, each marked whose it is; the helper's reading is not your own text, so weigh it as external. It takes seconds and a few cents per ~60k chars. The pair stays until the region you asked in closes; then the mod returns it. Use context_recall when you need the whole level.
    op "errand_add": when (turns: n turns from now; size: the request, fixed part included, reaches n tokens; cold: the prompt cache expired in an idle of over an hour, seen by the mod's idle timer, or by the next prompt when the timer is gone, and an apply then rewrites the re-warmed cache like any; closed: a region closes, or the one named) → action (remind: your text; ask: the helper answers your question about folds then; apply: apply your deferred edits). The result reaches you with your next tool result or the next prompt. wake: true lets an errand that fires while the session is idle send a prompt that starts a turn: a full request, on a cold cache a write of the whole context.
    op "errand_list"; op "errand_remove" with id.
    To defer an edit batch until the cache is cold, pass defer: true to context_edit.

Опис відкривається поетапно: він називає лише те, що вже працює ([PL_HELP_DEC_03](./context_helper.plan.md#PL_HELP_DEC_03)). Після фази 5 (`HELPER_DESCRIPTION` у `hooks/tools.ts`) він має перший рядок без `, or set errands the mod runs when a condition on the context holds` (`Ask the mod's helper about your folds.`), рядок `op "ask"` (фаза 1) і останній рядок `To defer …` (фаза 5: застосування в простої, [§02_11](./context_helper.batches.sp.md#SP_HELP_02_11), робить його правдивим). Рядки `op "errand_add"` і `op "errand_list"; op "errand_remove" with id.` та другу половину першого рядка додає фаза 7, речення про `wake` у рядку `errand_add` — фаза 8.

### 02_03. Ask (операція `ask`)  {#SP_HELP_02_03}

> Implements: [C_HELP_03_02](./context_helper.concept.md#C_HELP_03_02)

Purpose: відповідь помічника на питання агента до рівнів названих згорток з перевіреними цитатами.

Input: `folds`, `question` (§02_02).

Output: текст AskText (нижче) як результат інструмента; запис Question (§01_04); запис журналу `ask`.

Errors (у порядку перевірки, після спільних):
| Code | Condition | Guidance |
|------|-----------|----------|
| HELPER_PASSED_OVER | хост обходить компактизацію мода ([SP_CTX_02_54](./context_editor.bypass.sp.md#SP_CTX_02_54)) | `this host passes over the mod's compaction hook: the question's pair could never be returned; open the original with Read at the path in the fold record.` |
| ASK_QUESTION | питання порожнє чи довше за MAX_QUESTION | називає межу |
| ASK_FOLDS | немає згорток, їх більше за MAX_ASK_FOLDS чи є повтор | називає межу |
| DENIED_STORAGE | сховище сесії не готове | як у SP_CTX |
| FOLD_UNKNOWN | згортки немає в обліку | як у розгортанні; називає ідентифікатор |
| ASK_MEDIA | згортка виду `media` | `fold <id> folded media; the helper reads text only; use context_recall.` |
| QUESTIONS_FULL | записів питань MAX_QUESTIONS | `<n> questions wait for their regions to close; summarize or drop an answered question pair first.` |
| ARCHIVE_UNREADABLE | архів рівня не читається чи не має елемента | як у розгортанні; називає згортку |
| ASK_TOO_BIG | частин за всіма згортками більше за HELP_MAX_PARTS | `the material of <ids> (~<chars> chars) needs <k> parts, over the limit of <HELP_MAX_PARTS>; ask about fewer folds, or open a part with context_recall from/count.` |

Processing logic (pseudocode):

    FUNCTION Ask(folds, question, scope, depth):
        CHECK the errors above in order; ledger and archives are read once, outside every chain
        parts = []
        FOR id IN folds:
            rows = LevelOf(archive of id, entry of id, kind of id)     // SP_FOLD_02_02
            parts += Split(id, rows)                                    // §01_02
        IF |parts| > HELP_MAX_PARTS: DENY ASK_TOO_BIG
        replies = HelperCall(question, p) FOR p IN parts, all at once   // §02_01
        quotes = VerifyQuotes(reply, p, fragments of p) FOR each answered reply   // §02_04
        text = AskText(folds, parts, replies, quotes)
        IF the call was cut (Esc, interrupt): no record, the pair is not live, no sentence
        ELSE ON the folds chain: append Question { tool_use_id, folds, question[0..QUESTION_HEAD],
            verified, rejected, depth, scope, turn, due: false }; on a write failure
            a debug line "ask record not written: <error>", and
            append to text: " The question was not recorded: its pair goes with your next apply."
        journal: ask { at, folds, parts: |parts|, calls, in, out, verified, rejected, status }
        RETURN text

Перерваний виклик (сигнал хука `tool.call` скасовано: Esc у терміналі, `interrupt` у stream-json) хост закінчує власною відмовою, і агент відповіді не бачить (живий прогін L1, S2): запис не пишеться, пара не позначається живою, а запис журналу лишається — виклики коштували токенів. Сигнал хука йде в `$.model.complete` другим аргументом (`options.signal`; у самому `ModelCompleteRequest` поля немає), тож переривання обриває виклик із причиною `aborted`; у живому прогоні L1 хост обірвав його й без сигналу.

`scope` і `depth` беруться так само, як для запису розгортання ([SP_FOLD_02_02](./context_folds.sp.md#SP_FOLD_02_02)). Перевірка QUESTIONS_FULL повторюється на ланцюжку перед дописом; повна межа в цю мить — відповідь повертається, запис не пишеться, з тим самим реченням про запис.

AskText — рядки по порядку:

1. `Asked: fold(s) <ids> — the helper's reading follows. A model outside this conversation read the archive, external content included; its reading is not your own text. Only quotes found verbatim in the archive are shown.`
2. Для кожної частини зі статусом `answered`: `Reading: <answer>`, а коли частин більше за одну — `Reading (<id>, part <i> of <k>): <answer>`. Частина без жодної перевіреної цитати дає `Reading (not confirmed by the archive): …`, а коли частин більше за одну — `Reading (<id>, part <i> of <k>, not confirmed by the archive): …`.
3. Для `not_found`: `Not found in <id>[ part <i> of <k>].`; для `refused`: `The helper refused <id>[ part …]: <reason>.`; для `failed`: `The helper did not answer for <id>[ part …]: <reason>.`
4. `Verified quotes:` і по рядку на цитату: `<fold> #<row> <позначка>: "<text>"` (позначки — §01_03).
5. `Rejected: <n> quote(s) not found verbatim in the archive.` — коли n > 0.
6. `context_recall shows the whole level.` — коли жодна частина не має статусу `answered`.

Текст понад MAX_ASK_RESULT обрізається з кінця рядків цитат з рядком `… <m> more verified quote(s) not shown.`; рядок 1 і рядки 2–3 не обрізаються. Статус журналу: `answered`, якщо хоч одна частина відповіла; інакше `not_found`, якщо хоч одна не знайшла; інакше `refused`, якщо хоч одна відмовила; інакше `failed`.

### 02_04. VerifyQuotes  {#SP_HELP_02_04}

> Implements: [C_HELP_DEC_05](./context_helper.concept.md#C_HELP_DEC_05)

Purpose: лишити з відповіді помічника лише цитати, які стоять в архіві дослівно, і дати кожній походження.

Input: `reply.quotes`, частина `part`, фрагменти рядків `part.from..part.to` з повним текстом з архіву (§01_02).

Output: `VerifiedQuote[]`, кількість відкинутих.

Processing logic (pseudocode):

    FUNCTION Normalize(s):
        RETURN NFC(s) with every run of whitespace (space, tab, line break, no-break space) as one space, trimmed
    FUNCTION StripLabels(s):
        RETURN s without leading whitespace and without a leading "#<n> <role>:" (with the whitespace after it),
            then without one leading "call: ", "result: " or "result (error): "
    FUNCTION VerifyQuotes(quotes, part, fragments):
        verified = []; rejected = 0
        FOR q IN quotes[0..MAX_QUOTES): 
            IF q.text empty OR |q.text| > MAX_QUOTE: rejected += 1; CONTINUE
            text = StripLabels(q.text)
            nq = Normalize(text)
            IF nq empty: rejected += 1; CONTINUE
            order = fragments of row q.row (when part.from ≤ q.row ≤ part.to), then all fragments in row order
            s = first fragment in order whose Normalize(s.text) contains nq
            IF s is none: rejected += 1; CONTINUE
            IF verified has (s.row, nq): CONTINUE           // повтор не лічиться ні тут, ні там
            verified += { fold: part.fold, row: s.row, text, origin: s.origin, source: s.source }
        rejected += max(0, |quotes| − MAX_QUOTES)
        RETURN verified, rejected

Мітки LevelRowText ([SP_FOLD_02_02](./context_folds.sp.md#SP_FOLD_02_02)) обрамлюють матеріал, а не належать йому; HELP_SYSTEM просить їх не цитувати, але помічник інколи цитує рядок разом із міткою (живий прогін L1: 1 з 3 відповідей на тому самому матеріалі). Цитата перевіряється й показується без мітки; лишок усе одно мусить стояти у фрагменті дослівно.

Цитата шукається лише всередині одного фрагмента: цитата, що перетинає межу фрагментів чи рядків, відкидається. Регістр літер не нормалізується.

### 02_05. Повернення пар питань  {#SP_HELP_02_05}

> Implements: [C_HELP_DEC_06](./context_helper.concept.md#C_HELP_DEC_06)

Purpose: пара питання — відповідь живе як згадане й повертається тим самим механізмом ([SP_FOLD_02_03](./context_folds.sp.md#SP_FOLD_02_03)).

- **Позначка.** `markDue(ledger, after)` ставить `due` записам `questions` за тим самим правилом глибини, що й записам `recalls`.
- **Правки повернення.** `addReturns` після записів `recalls` додає для кожного запису з `due` правку `{ op: 'summarize', tool_use_id, summary: '', via: 'return' }`, від найстарішого; пропуски (закріплена пара, пари немає, пара вже ціль чи покрита пакетом) і зупинка на MAX_QUEUE_EDITS — ті самі. Виклик `context_edit` з `defer: true` повернень не додає ні для `questions`, ні для `recalls`: повернення — звичайні правки й запланували б застосування; вони чекають наступного прийнятого виклику без `defer` чи замін тегів.
- **Власна правка агента.** `summarize` чи тег `disposable` на парі питання — її повернення словами агента: результатом пари стає ASK_RETURNED з `<when>` = ` by your own edit` і текстом агента після `: `, як для пари розгортання ([SP_FOLD_02_03](./context_folds.sp.md#SP_FOLD_02_03)), а запис видаляється при фіксації; `drop` прибирає пару разом із записом.
- **Слід.** Застосування замінює результат повернутої пари текстом ASK_RETURNED: `Later, your context_helper question to fold(s) <ids> here was returned< when "<scope>" closed| when the block closed| by your own edit>: "<question>"; verified quotes: <verified>; the folds stay, and context_helper can ask again.` Нічого не архівується.
- **Звіт застосування** додає речення `Returned <n> question pair(s).`
- **Власні виклики** ([SP_FOLD_02_09](./context_folds.sp.md#SP_FOLD_02_09)): пара `context_helper` лишається, якщо має запис питання чи її результат починається з ASK_RETURNED_HEAD; кожна інша пара `context_helper` (операції доручень, відмови) — власний виклик, який прибирає застосування. Перевірка залежностей ([SP_CTX_02_63](./context_editor.curation.edits.sp.md#SP_CTX_02_63)) пар `context_helper` не враховує, як і пар розгортання: перевірені цитати лежать в архівах згорток, тож пара питання — не інше джерело фрагмента.
- **Облік у точці фіксації.** Записи `questions`, чиєї пари немає серед повернутих рядків, видаляються разом із `pruneRecalls`.

## Changelog

| Date | Change |
|------|--------|
| 2026-11-16 | Розділи перенесено дослівно з [context_helper.sp.md](./context_helper.sp.md): поділ файлу за модулями (11 739 слів, перед виправленнями рев'ю 2 і §02_12 — понад `hard_split`), якорі ті самі (structural-event) |
| 2026-11-16 | PL_HELP фаза 1, рев'ю коду й живий прогін L1: FailureReason (`empty-reply`, `api-error without a response`), токени кожного виклику; перерваний виклик не пише запису; рядок налагодження при невдалому записі; StripLabels у VerifyQuotes; слід власної правки на парі питання; перевірка залежностей пар питань не враховує |
| 2026-11-16 | PL_HELP фаза 2: сигнал хука `tool.call` іде в `$.model.complete` другим аргументом (`options.signal`) — §02_03 |
| 2026-11-17 | PL_HELP фаза 5: §02_02 — HELPER_DESCRIPTION отримав останній рядок `To defer an edit batch until the cache is cold, pass defer: true to context_edit.`; речення про поетапне відкриття опису: рядки доручень — фаза 7, `wake` — фаза 8 ([PL_HELP_DEC_03](./context_helper.plan.md#PL_HELP_DEC_03)) |
