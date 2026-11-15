---
name: context-stages
description: Open this for a long or multi-stage task with the context-editor mod: when to open and close stages, how to compress a finished block, the optimization mark, the telemetry, and what "Later, your context_…" or [context-editor] rows mean.
---

# Managing your context in stages

The context-editor mod lets you edit your own conversation. You decide when to clean, by the logical state of the work. Attention degrades as the context grows: compress what is processed once a piece of work is done.

Tools: `context_tag`, `context_list`, `context_edit`, `context_note`, `context_recall`. Curation rules (lessons from failures, corrections, quoting, state items, host rows): `context_list` with `"rules": true`.

## Stages and tasks

A stage is a logical block of your work: a phase, a sub-task, a fix. A task is one request of the person, start to done: in a session that takes task after task, open each as a task, its phases as stages inside it.

- Open: `{"tags":[{"op":"open","stage":"read the config files"}]}`, or `"task":"<name>"` in place of `"stage"`. The block starts with the response that opens it; with `"index"`, at that row of `context_list`.
- Close when the block is done: `{"op":"close"}` closes the deepest open region, `{"op":"close","task":true}` the task with all inside it. The result names the block's rows `#a..#b`, its size and media, cleanup candidates, the telemetry and the advice; its indexes are current.
- Opening a stage closes the open stage first (inside a task it stays inside); `"nested": true` opens it inside the open one. Opening a task closes all.
- To close a block you never opened: `{"tags":[{"op":"open","stage":"<name>","index":<its first row>},{"op":"close"}]}`.
- `context_list` marks the first row of each open region (`[task ▶ name]`, `[stage ▶ name]`) and the last closed block (`[block ▶ name]` .. `[block end]`).

A closed task becomes a task card, one `collapse` of its whole block: goal; what was done; facts for later tasks with sources, a value others may change as a snapshot ("as read in <file> at turn N; check before use"); instructions, standing or this task only, marked so; open questions.

## Compressing a block

After a close, review the block as a whole and queue ONE `context_edit` for what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media you have already looked at (`describe` for an image, document or pasted text in the person's prompt keeps their typed words; the host's attachments to that prompt go with it). If nothing needs compressing, queue nothing.

Write a stage record in place of the processed rows, e.g. as the summary of a `collapse`:

- goal of the stage;
- decisions, with the reason, the person's verbatim words behind them and why other options were rejected;
- verified facts with their sources (paths, line numbers, versions, URLs);
- changed artifacts (files, commits, settings);
- open questions.

Pairs flagged `~` in `context_list` (`Read`, `Grep`, `Glob`) are reproducible: shrink them to a pointer (what, where, what was found; read again if needed). Everything else needs a careful summary or stays: live probes, subagent reports, web content. A `collapse` may cover the person's messages and answers (`AskUserQuestion`): they go to the archive, so quote in the record what is still in force, or list rows to stay verbatim in `"keep"`. It goes around `[pin]` and `[state]` rows.

Usually keep verbatim the rules and skills still in force and the conclusions you need next. A `[pin]` target cannot be edited; pins are yours to set and remove (the mod pins only a handoff's document or seed summary).

Edits apply when your turn ends: end it with a one-line status, and the session resumes by itself. An apply rewrites the prompt cache once: batch a block's edits in one call. `"keep_cache": true` keeps it up to the earliest edit (the `Cache:` line says when that pays). Your `context_*` calls leave the conversation; tags and notes stay.

## Dead ends

When you abandon a branch, mark it at once: tag the span `disposable` with a note, `{"op":"add","kind":"disposable","index":<first row>,"to":<last row>,"note":"dead end: X fails because Y"}`. A single text row of yours or an output by `ref`/`tool_use_id` works too. The replacements are queued when you close the stage or move on from a block you marked; a range becomes one `collapse`.

## Optimization mark

When you finish your turn for the person and the block is done, end your answer with this line, on its own:

[context-editor: optimize]

- Only alone on the last non-empty line; elsewhere, or in the `/compact` turn, it does nothing.
- It closes the deepest open region (if none: the block since the last closed one; a region closed by the tool in that turn stays the block). The block then waits; nothing is compressed.
- The next prompt names the block: compress it in that turn if the work moves on, else leave it. Opening a stage reports it with indexes; that or an accepted `context_edit` ends the wait and queues your `disposable` replacements.
- Following a plan on your own: open a stage per phase; at the next one compress the previous block and end the turn with a status line; the session resumes. Mid-work, close stages by the tool.

## Telemetry

`context_list` with `"count":0` gives the header alone. `Effect: … M reread(s) of compressed content`: many mean you compress too much. A `[context-editor: suggestion]` line proposes a batch with gain, cache cost and verdict; it only informs. Decide by the state of the work.

## Candidates

- `[review: big]` large output; `[review: search]` search result; `[review: stale]` a read of a file you edited since, `[review: superseded]` one a later read showed changed: outdated, shrink to a pointer; `[review: duplicate]` an earlier copy of the same output or read: drop or shrink it; `[review: agent]` your own marker. A review suggests a look, not an edit.
- `[disposable: note]`: your own replacement (see Dead ends).

The close report lists them, with ready texts for outdated and duplicate reads.

## State slot

Keep the task's state (goal, plan, done, next) in ONE of your own text rows tagged `state`: `{"tags":[{"op":"add","kind":"state","index":<row>}]}`. Update it in place with a `rewrite` of that row, never by appending a new state. Or keep it as items: `context_edit` with `{"op":"state","changes":[{"do":"add","kind":"plan","text":"…"}]}` (`set`, `mark` harmful/outdated, `unmark`, `remove` by id such as `p3`); the apply rebuilds the slot from them, and while it has items only the `state` op changes it. The tag follows the rebuilt row. Each update is an apply: do it together with a block's edits, not on its own.

## Notes

`context_note` keeps notes at no token cost (its description gives the ops and where they show).

- Mark at once what to drop or compress later, and how: `{"notes":[{"op":"add","ref":"last","text":"drop after the fix is verified"}]}`.
- `"remind_in_turns":2` brings a note back once, two turns later.

Write about the content, not row numbers: indexes change after an apply. A stage close lists the notes in its block.

## Compressed rows and mod texts

Text opening with `Later, your context_edit` (or `context_tag`) is your own replacement: you read the original there, then compressed it to save context. You made the replacement; the source it names (`the full output of Read docs/x.md`) says where its content came from. Before you call anything in it made up, unfold it.

- `… summarize call replaced the full output of <source> you had read here …`, `… collapse call replaced these N rows you had read (what they held) …` (its call's `collapsed` input lists the same), and likewise `rewrite`, `describe`: your text follows the colon. After a `describe` on a person's prompt, their own text follows yours.
- `(fold fN; original: <path>; …)`: `context_recall` with `{"fold":"fN"}` unfolds one level here; once its region closes, your next edits turn it back into a trace. `(original: <path>, …)`, `(media: <path>)`, `media carried as files`: `Read` only what you need.
- Text that starts with `[context-editor` or `context-editor:` is the mod's, not the person's or a tool's. `context-editor: applied N edit(s): …`: the apply report; the `context_*` calls that made the replacements are removed, yet what you quoted from their results is real. A `/compact` row whose args start with `context-editor:` is the mod's command; `… repair the resumed conversation …`: the mod dropped answers a resume had loaded twice; earlier thinking is gone.
- `/rename`, `Session renamed to: …`, `The user named this session …` right after a turn where you set a title (`{"op":"title"}`): the mod's, removed by the next apply; elsewhere: the person's.
- `id cN`, `reminder from your note nN`, `[context-editor: suggestion]`, `[context-editor: N chars cut]`, a resume prompt you set, the `/compact` turn, a handoff's document: service texts of the mod.
