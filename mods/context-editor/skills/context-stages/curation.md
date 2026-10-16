# Curation rules

Open these when you curate your history: compress failures, correct conclusions, quote what others wrote, keep the person's requirements in view. They add to the guide; the guide still holds. This text goes when your edits apply: ask again the next time you curate.

## When to edit

- Edit a row only by a reason you can name: it is processed, outdated, wrong after an external signal, or a dead end.
- An edit of an old row rewrites the prompt cache from that row and makes every later thinking block invalid; on accounts created from 2026-08-31 the API refuses such a request by default. Put lessons, corrections and replacements of outdated rows into the batch of a stage close, together with the block's compression, not one by one mid-work.
- Replace or reframe what is outdated with an edit. An instruction such as "ignore X" leaves X in view and barely works.

## A lesson in place of a failure

When a series of attempts failed, compress it into a lesson, not into the result alone:

`tried X ×N → failed because Y → do Z`

Name the count, the cause and the next step. The raw trace (calls, errors, interim outputs) goes; the original stays in the archive. A solution that worked can be pinned and marked with a note "sample"; collapse the failed variants.

## Correction after an external signal

When a test, a tool output or a later read refutes an earlier conclusion of yours, rewrite that conclusion as `X is wrong, because Y` and withdraw the conclusions that rested on it. The trigger is only an external signal: correcting yourself without one does harm, and the person's pressure alone is no signal. A `rewrite` may be longer than the original. Never write into an old row what was not there (an agreement in place of a refusal): the opener says the row was rewritten later, and the original stays in the archive. A wrong lesson or correction is withdrawn the same way.

## Quoting and the archive

- Text from a source you do not trust (a web page, a file outside the project, a subagent's report with someone else's content) goes into a replacement as a verbatim quote with its source, `the page says: "…"`, not as your own conclusion.
- Each `summarize` replacement names its source. Before you call anything in your own replacement made up, open its archive (`original: <path>`).
- When an edit removes the only source of something you quoted later, `context_edit` adds a Note and the replacement says `which you quoted from later`: keep those facts in the summary, or summarize instead of a drop.
- Where your edits removed your own `context_*` calls, a row `Later, your context_* calls here were removed when your edits applied; you had called …` says what you called. You made those calls.

## The person's words and requirements

- The person's messages and answers stay verbatim in this session; the mod refuses an edit that covers them. `describe` may describe an image or a pasted text in their prompt: their typed words stay.
- When their requirements are spread over many turns, add a recap (a state item or a text row of yours) that quotes their words; never collapse their messages into it. A service note is not a recap: it is not in the conversation.
- Never delete the archives of originals or the host's transcripts. The mod does not prevent it; you work as the same OS user.

## Closing a stage

Before you compress a block, check what its conclusions rest on: keep the facts and sources they need. Collapse an exploration with rejected options into its conclusion with the list of what was rejected and why.

The close report may give `Ready replacements`: texts for reads that are outdated (`Outdated: <path> was read again later and its content had changed.`, `Outdated: you changed <path> later.`) or repeated (`Duplicate: …`). Summarize each with that text plus what you still need from it.

## State slot items

Once the slot is tagged `state`, keep it as items in `context_edit`:

`{"op":"state","changes":[{"do":"add","kind":"plan","text":"…"},{"do":"set","id":"p2","text":"…"},{"do":"mark","id":"d1","as":"outdated"},{"do":"unmark","id":"d1"},{"do":"remove","id":"n3"}]}`

Kinds: goal, plan, done, next, lesson; ids are a letter and a number (`g1`, `p2`, `d3`, `n4`, `l5`). The apply rebuilds the slot from the items under `Goal:`, `Plan:`, `Done:`, `Next:`, `Lessons:`; while it has items, only the `state` op changes it (no `rewrite`, and not both in one batch). The first `state` op replaces the slot's free text (it goes to the archive): add what you still need as items in the same batch. Mark an item `harmful` or `outdated` instead of silently removing it when the reason matters later.

## Host rows

The host adds some rows the conversation listing does not show: an expanded skill, a subagent's report between turns. `context_list` names them in its header line (`Host rows: 2 (~41000 chars), not in the indexes; … h1 skill, h2 peer`) and lists the newest below a page that holds the newest row. They are not the person's words. Remove one with `{"op":"drop","host":"h1"}` (refused when the row before it holds media): the row before it comes back without its handle (a prompt loses the host's attachments, a response its thinking), and every host row after that row goes with it; the report names them. A host row whose row before was rebuilt goes with it anyway, and the report says so.

## Checking yourself

For an unbiased check of your own work, ask a subagent or a handoff without signs of who wrote it. Asking yourself to "pretend you do not know" does not work.
