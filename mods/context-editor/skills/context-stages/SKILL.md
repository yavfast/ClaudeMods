---
name: context-stages
description: Open this for a long or multi-stage task with the context-editor mod, to decide when to open and close stages, how to compress a finished block, when to use the optimization mark, and how to read the context telemetry.
---

# Managing your context in stages

The context-editor mod lets you edit your own conversation. Nothing reminds you by size: you decide when to clean, by the logical state of the work. Attention degrades as the context grows: compress what is processed once a piece of work is done. The host's auto-compaction is only a safety net.

Tools: `context_tag` (stages, tags), `context_list` (rows, telemetry), `context_edit` (edits, applied when your turn ends), `context_note` (notes).

## Stages

A stage is a logical block of your work: a phase, a sub-task, an investigation, a fix.

- Open it at the start of the block: `{"tags":[{"op":"open","stage":"read the config files"}]}`. The block starts with the response that opens it; with `"index"` it starts at that row of `context_list`.
- Close it when the block is done and its result is known: `{"tags":[{"op":"close"}]}`. The result names the block's rows `#a..#b`, its size and media, cleanup candidates, the telemetry and the advice. Its indexes are current: you may edit by them right away.
- Stages are flat: opening a stage closes the open one first.
- To close a block you never opened: `{"tags":[{"op":"open","stage":"<name>","index":<its first row>},{"op":"close"}]}`.
- `context_list` shows `[stage ▶ name]` on the first row of the open stage, and `[block ▶ name]` .. `[block end]` around the last closed block.

## Compressing a block

After a close, review the block as a whole and queue ONE `context_edit` for what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media you have already looked at (a description, if the task allows). If nothing needs compressing, queue nothing.

Write a stage record in place of the processed rows, e.g. as the summary of a `collapse`:

- goal of the stage;
- decisions, with the reason, the person's verbatim words behind them and why other options were rejected;
- verified facts with their sources (paths, line numbers, versions, URLs);
- changed artifacts (files, commits, settings);
- open questions.

Pairs flagged `~` in `context_list` (`Read`, `Grep`, `Glob`) are reproducible: shrink them to a pointer (what, where, what was found; read again if needed). Everything else needs a careful summary or stays: live probes, subagent reports, web content, and above all the person's messages, including answers to your questions (`AskUserQuestion`); `context_edit` warns when an edit covers them.

Usually keep verbatim: the person's messages, the rules and skills still in force, and the conclusions you need next. A target tagged `[pin]` cannot be edited (the person's first prompt is pinned for you).

Edits apply when your turn ends: end the turn with a one-line status. Unless you pass `"resume": false`, the session resumes by itself with `resume_prompt`. Each edit resets the prompt cache from its row on, so batch a block's edits in one call. When edits apply, your own `context_*` calls are removed from the conversation; your tags and notes stay (see `context_list`). `{"index":i,"full":true}` in `context_list` shows a row whole.

## Dead ends

When you abandon a branch, mark it at once: tag the span `disposable` with a note, `{"op":"add","kind":"disposable","index":<first row>,"to":<last row>,"note":"dead end: X fails because Y"}` (the range holds every tool call with its result; `context_tag` warns when it covers the person's messages). A single text row of yours or an output by `ref`/`tool_use_id` works too. The replacements are queued when you close the stage or end a turn with the optimization mark; a range becomes one `collapse`.

## Optimization mark

When you finish your turn for the person and want the block optimized, make this the last line of your final answer, on its own:

[context-editor: optimize]

- It works only alone on the last non-empty line: quoted mid-text, with other text on its line, or inside the optimization turn it does nothing.
- It closes the open stage at the end of the turn; with none open, the block since the last closed one. If you closed a stage with the tool in that turn, the mark refers to it. Your `disposable` replacements join that turn's batch.
- An ordinary optimization turn follows, without indexes: take the range from `Last block #a..#b` in the header of `context_list`, then list from `from = a` before you edit by index.
- Usually stop after it (`"resume": false`). Mid-work, close the stage with the tool instead.

## Telemetry

`context_list` with `"count":0` gives the header alone: the conversation's size without the fixed part (system prompt, tools, skills, memory), the window, the open stage, the last block, the candidates by reason with their rows, and only when there is something to show:

- `Effect: N application(s); M reread(s) of compressed content (K of archives)`: rereads of what you compressed; many mean you compress too much;
- `State slot: #i`, or that its row is gone;
- `Last apply: ~N tokens freed (measured …)`, once after an apply.

Sizes are calibrated estimates (`approx.` until known). Decide by the logical state of the work, not by the numbers alone.

## Candidates

- `[review: big]` large output; `[review: search]` search result (after a few turns); `[review: stale]` a read of a file you have since edited: its content is outdated, shrink it to a pointer; `[review: duplicate]` an earlier copy of the same output or read range: drop or shrink it; `[review: agent]` your own marker (optional `ttl_turns`). A bare `[review]` comes from an older version. A review suggests a look, not an edit.
- `[disposable: note]`: your own replacement, applied when you close a stage or end a turn with the mark.
- `[pin]`: never edited.

The close report lists the candidates in the block by reason, with the count of `~` pairs.

## State slot

Keep the task's state (goal, plan, done, next) in ONE of your own text rows tagged `state`: `{"tags":[{"op":"add","kind":"state","index":<row>}]}`. Update it in place with a `rewrite` of that row, never by appending a new state at the end; only that rewrite may change it, and the tag follows the rewritten row. A new `state` tag moves the slot. Each update resets the prompt cache from the slot's row on, so update it together with a block's edits, not on its own.

## Notes

`context_note` keeps your notes on a row, a range or a tool call, at no token cost; a target may hold several, and they change nothing.

- Mark at once what to drop or compress later, and how: `{"notes":[{"op":"add","ref":"last","text":"drop after the fix is verified"}]}`.
- `"remind_in_turns":2` brings a note back once with the result of your first tool call (any tool but `context_edit`/`context_handoff`) two turns later.
- A range: `"index"` and `"to"`. Link rows by what they hold.

Write about the content, not row numbers: indexes change after an apply. `context_list` shows `[n3]` on the rows, the full text below the page and `Notes elsewhere` for other pages; a stage close lists the notes in its block. A note moves to the row that replaced its row and goes with a removed row (the apply report names it). Remove one with `{"op":"remove","id":"n3"}`.

## Restoring an original

Every replacement says where its original is: `(original: <path>, open with Read)`, and media files as `(media: <path>)`. If you need something you compressed, `Read` that file. It comes back at the end of the conversation, not in its old place, so read only what you need. Such reads count in the `Effect` line.
