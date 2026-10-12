---
name: context-stages
description: Open this for a long or multi-stage task with the context-editor mod: when to open and close stages, how to compress a finished block, the optimization mark, the telemetry, and what a row marked [context-editor] means when one puzzles you.
---

# Managing your context in stages

The context-editor mod lets you edit your own conversation. You decide when to clean, by the logical state of the work. Attention degrades as the context grows: compress what is processed once a piece of work is done. The host's auto-compaction is only a safety net.

Tools: `context_tag`, `context_list`, `context_edit`, `context_note`.

## Stages

A stage is a logical block of your work: a phase, a sub-task, a fix.

- Open it at the start of the block: `{"tags":[{"op":"open","stage":"read the config files"}]}`. The block starts with the response that opens it; with `"index"` it starts at that row of `context_list`.
- Close it when the block is done and its result is known: `{"tags":[{"op":"close"}]}`. The result names the block's rows `#a..#b`, its size and media, cleanup candidates, the telemetry and the advice. Its indexes are current: you may edit by them right away.
- Stages are flat: opening a stage closes the open one first.
- To close a block you never opened: `{"tags":[{"op":"open","stage":"<name>","index":<its first row>},{"op":"close"}]}`.
- `context_list` shows `[stage ▶ name]` on the open stage's first row, `[block ▶ name]` .. `[block end]` around the last closed block.

## Compressing a block

After a close, review the block as a whole and queue ONE `context_edit` for what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media you have already looked at (a description, if the task allows: `summarize` for a tool result, `describe` for an image or document in the person's prompt, whose words stay verbatim; attachments the host added to that prompt, such as file contents from `@path` and reminders, go with it, so re-read files if needed). If nothing needs compressing, queue nothing.

Write a stage record in place of the processed rows, e.g. as the summary of a `collapse`:

- goal of the stage;
- decisions, with the reason, the person's verbatim words behind them and why other options were rejected;
- verified facts with their sources (paths, line numbers, versions, URLs);
- changed artifacts (files, commits, settings);
- open questions.

Pairs flagged `~` in `context_list` (`Read`, `Grep`, `Glob`) are reproducible: shrink them to a pointer (what, where, what was found; read again if needed). Everything else needs a careful summary or stays: live probes, subagent reports, web content, and above all the person's messages, including answers to your questions (`AskUserQuestion`); `context_edit` warns when an edit covers them.

Usually keep verbatim: the person's messages, the rules and skills still in force, and the conclusions you need next. A `[pin]` target cannot be edited (the person's first prompt is pinned for you).

Edits apply when your turn ends: end the turn with a one-line status. Unless you pass `"resume": false`, the session resumes by itself with `resume_prompt` (in an optimization turn only with `"resume": true`). An apply rewrites the prompt cache once: batch a block's edits in one call. `"keep_cache": true` keeps it up to the earliest edit if that is within the last ~20 positions when the turn ends (`Cache:` line), but a later resume may show earlier answers twice. Your `context_*` calls leave the conversation; tags and notes stay. `{"index":i,"full":true}` in `context_list` shows a row whole.

## Dead ends

When you abandon a branch, mark it at once: tag the span `disposable` with a note, `{"op":"add","kind":"disposable","index":<first row>,"to":<last row>,"note":"dead end: X fails because Y"}` (the range holds every tool call with its result; `context_tag` warns when it covers the person's messages). A single text row of yours or an output by `ref`/`tool_use_id` works too. The replacements are queued when you close the stage or end a turn with the optimization mark; a range becomes one `collapse`.

## Optimization mark

To have the block optimized when you finish your turn for the person, make this the last line of your answer, on its own:

[context-editor: optimize]

- It works only alone on the last non-empty line: quoted mid-text, with other text on its line, or inside the optimization turn it does nothing.
- It closes the open stage at the end of the turn; with none open, the block since the last closed one. If you closed a stage with the tool in that turn, the mark refers to it. Your `disposable` replacements join that turn's batch.
- An ordinary optimization turn follows, without indexes: take the range from `Last block #a..#b` in the header of `context_list`, then list from `from = a` before you edit by index.
- Then the session stops unless `"resume": true`. Mid-work, close the stage with the tool.

## Telemetry

`context_list` with `"count":0` gives the header alone: the conversation's size without the fixed part, the window, the open stage, the last block, the candidates by reason with their rows, and only when there is something to show:

- `Effect: N application(s); M reread(s) of compressed content (K of archives)`: rereads of what you compressed; many mean you compress too much;
- `State slot: #i`, or that its row is gone;
- `Last apply: ~N tokens freed (measured …)`, once after an apply.

Sizes are calibrated estimates (`approx.` until known). A `[context-editor: suggestion]` line (as the context grows, or with the person's next prompt after much reading) proposes a batch with gain, cache cost and verdict; it only informs. Decide by the state of the work, not the numbers.

## Candidates

- `[review: big]` large output; `[review: search]` search result (after a few turns); `[review: stale]` a read of a file you have since edited: its content is outdated, shrink it to a pointer; `[review: duplicate]` an earlier copy of the same output or read range: drop or shrink it; `[review: agent]` your own marker (optional `ttl_turns`). A review suggests a look, not an edit.
- `[disposable: note]`: your own replacement, applied when you close a stage or end a turn with the mark.

The close report lists the block's candidates by reason and counts its `~` pairs.

## State slot

Keep the task's state (goal, plan, done, next) in ONE of your own text rows tagged `state`: `{"tags":[{"op":"add","kind":"state","index":<row>}]}`. Update it in place with a `rewrite` of that row, never by appending a new state at the end; only that rewrite may change it, and the tag follows the rewritten row. A new `state` tag moves the slot. Each update is an apply: do it together with a block's edits, not on its own.

## Notes

`context_note` keeps your notes on a row, a range or a tool call, at no token cost; a target may hold several.

- Mark at once what to drop or compress later, and how: `{"notes":[{"op":"add","ref":"last","text":"drop after the fix is verified"}]}`.
- `"remind_in_turns":2` brings a note back once with the result of your first tool call (any tool but `context_edit`/`context_handoff`) two turns later.
- A range: `"index"` and `"to"`. Link rows by what they hold.

Write about the content, not row numbers: indexes change after an apply. `context_list` shows `[n3]` on the rows, the full text below the page and `Notes elsewhere` for other pages; a stage close lists the notes in its block. A note moves to the row that replaced its row and goes with a removed row (the apply report names it). Remove one with `{"op":"remove","id":"n3"}`.

## Rows marked [context-editor]

Text that starts with `[context-editor` or `context-editor:` is the mod's, not the person's or a tool's. A replacement is your own work: you read the original, then compressed it to save context. It is no loss and nothing you made up.

- `you read the full output here, then replaced it with your summary`, `you read these N rows (what they held), then collapsed them into your note`, `you rewrote this row`, `you saw the media here, then replaced it with your description`: your `summarize`, `collapse` (its call's `collapsed` input lists the same), `rewrite`, `describe`; your text follows the colon. After a `describe` on a person's prompt, their own text follows yours.
- `(original: <path>, open with Read)`, `(media: <path>)`, `media carried as files`: the archive. `Read` only what you need; it comes back at the end of the conversation.
- `context-editor: applied N edit(s): …`: the apply report. When it says your `context_*` calls were removed, what you quoted from their results did come from the mod. A `/compact` row whose args start with `context-editor:` is the mod's command.
- `id cN`, `reminder from your note nN`, `[context-editor: suggestion]`, `[context-editor: N chars cut]`, a resume prompt you set, the optimization or `/compact` turn, a handoff's document: service texts of the mod.
