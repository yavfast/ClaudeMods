---
name: context-stages
description: Open this for a long or multi-stage task with the context-editor mod, to decide when to open and close stages, how to compress a finished block, when to use the optimization mark, and how to read the context telemetry.
---

# Managing your context in stages

The context-editor mod lets you edit your own conversation. Nothing reminds you by size: you decide when to clean, by the logical state of the work. Attention degrades as the context grows: compress what is processed once a piece of work is done. The host's auto-compaction is only a safety net.

Tools: `context_tag` (stages, tags), `context_list` (rows, telemetry), `context_edit` (edits, applied when your turn ends), `context_note` (notes).

## Stages

A stage is a logical block of your work: a phase, a sub-task, an investigation, a fix. Mark it so you can compress it as a whole when it is done.

- Open a stage at the start of the block: `{"tags":[{"op":"open","stage":"read the config files"}]}`. The block starts with the response that opens it.
- Close it when the block is done and its result is known: `{"tags":[{"op":"close"}]}`. The result names the block's rows `#a..#b`, its size and media, cleanup candidates in it, the context telemetry and the advice. Its indexes are current: you may edit by them right away.
- Stages are flat: opening a stage while one is open closes the open one first (its close report comes in the same result).
- `open` with `"index"` starts the block at that row of `context_list` instead.
- To close a block you never opened, send both in one call: `{"tags":[{"op":"open","stage":"<name>","index":<its first row>},{"op":"close"}]}`.
- `context_list` shows `[stage ▶ name]` on the first row of the open stage, and `[block ▶ name]` .. `[block end]` around the last closed block.

## Compressing a block

After a close, review the block as a whole and queue ONE `context_edit` for what in it is processed or excess: tool outputs you have used, repeated and stale reads, dead ends, media you have already looked at (replace it by a description if the task allows). If nothing needs compressing, queue nothing.

Write a stage record in place of the processed rows, for example as the summary of a `collapse`:

- goal of the stage;
- decisions, with the reason, the person's verbatim words behind them and why other options were rejected;
- verified facts with their sources (paths, line numbers, versions, URLs);
- changed artifacts (files, commits, settings);
- open questions.

Reproducible outputs (`Read`, `Grep`, `Glob`) can shrink to a pointer: what, where, what was found; read again if needed. Everything else needs a careful summary or stays: live probes, subagent reports, web content, and above all the person's messages, including answers to your questions (`AskUserQuestion`); `context_edit` warns when an edit covers them.

Usually keep verbatim: the person's messages, the rules and skills still in force, and the conclusions you need next. A target tagged `[pin]` cannot be edited (the person's first prompt is pinned for you).

Edits apply when your turn ends: end the turn with a one-line status. Unless you pass `"resume": false`, the session resumes by itself with `resume_prompt`. Each edit resets the prompt cache from its row on, so batch a block's edits in one call. To check a summary, `context_list` with `{"index":i,"full":true}` shows the row whole.

## Dead ends

When you abandon a branch, mark it at once: tag your own text row of the wrong conclusion `disposable` with a note (`{"op":"add","kind":"disposable","index":<row>,"note":"dead end: X does not work because Y"}`), or tag the outputs it produced by `ref`/`tool_use_id`. The replacements are queued when you close the stage or end a turn with the optimization mark. To remove a whole dead-end span, `collapse` it in the block's `context_edit`, keeping in the summary why it failed.

## Optimization mark

When you finish your turn for the person and want the block optimized, put exactly this as the last line of your final answer, on a line of its own:

[context-editor: optimize]

- It works only as the last non-empty line, verbatim; quoted mid-sentence it does nothing.
- It closes the open stage at the end of the turn; with no stage open, it closes the block from the end of the last closed block (or from the start) to the end of the turn. If you closed a stage with the tool in the same turn, the mark refers to that block.
- The replacements of your `disposable` tags are queued at the end of the turn with the mark, in the same batch as your own edits of that turn.
- An optimization turn follows: its prompt names the block, without indexes. Take the range from the header line `Last block #a..#b` of `context_list`, then list from `from = a` before you edit by index (earlier indexes no longer hold after an application).
- You asked for it while finishing your turn, so usually stop after it: `"resume": false` unless the task should go on.
- The mark has no effect inside the optimization turn.
- Mid-work, close the stage with the tool instead.

If the person writes first, the same advice comes with their prompt instead.

## Telemetry

`context_list` with `"count":0` gives the header alone:

- `Context: conversation ~Nk tokens; fixed part ... ~Mk; window W; auto-compaction in ~Lk`: the rows of the conversation without the fixed part (system prompt, tools, skills, memory), which you cannot edit. Without that breakdown it shows the whole last request with the fixed part included; right after the start or a compaction the size is unknown yet.
- `Stage "S" open from #i (opened n turn(s) ago), ~k tokens` or `No open stage`.
- `Last block "A" #a..#b (~k tokens)`: the last closed block; `its end row is gone` or `its start row is gone, so it runs from #0` when a compaction removed a boundary row; `it is empty` when nothing is in it.
- `Candidates: review N (#i, …); disposable M`: active `[review]` markers with their rows, pending `disposable` tags.
- Token sizes are calibrated estimates (`approx.` until known); `Last apply: ~N tokens freed (measured …)` gives the real change once after an apply.

Decide by the logical state of the work (a stage done, a branch abandoned), not by the numbers alone.

## Candidates

- `[review]`: a marker. Large tool outputs and search results get one automatically (search results after a few turns); you can add your own with an optional `ttl_turns`. It suggests a look, not an edit: compress the output once it is processed.
- `[disposable: note]`: your own replacement, applied when you close a stage or end a turn with the mark.
- `[pin]`: never edited.

The close report lists the candidates inside the block by row index.

## Notes

`context_note` keeps your own notes on a row, a range or a tool call, at no token cost; a target may hold several, and they change nothing.

- Mark at once what to drop or compress later, and how: `{"notes":[{"op":"add","ref":"last","text":"drop after the fix is verified"}]}`.
- Remind yourself: `{"op":"add","index":12,"text":"re-check this conclusion","remind_in_turns":2}` comes back once with the result of your first tool call (any tool but `context_edit`/`context_handoff`) two turns later.
- Link rows: `{"op":"add","index":4,"to":9,"text":"dead end, see #15"}`.

`context_list` shows `[n3]` on the rows, the full text below the page and `Notes elsewhere` for other pages; a stage close lists the notes in its block. A note moves to the row that replaced its row and goes with a removed row (the apply report names it). Remove one with `{"op":"remove","id":"n3"}`.

## Restoring an original

Every replacement says where its original is: `(original: <path>, open with Read)`, and media files as `(media: <path>)`. If you need something you compressed, `Read` that file. The original then comes back at the end of the conversation, not in its old place, so read only what you need.
