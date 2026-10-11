# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Mods for Claude Code: plugins built from **function hooks** (TypeScript modules listed in `hooks/hooks.json`, run by the host, not shell hooks from `settings.json`). Work follows the dev-flow process: concept → spec → plan in `docs/`, then code in `mods/`, with per-task state in `.dev_flow/`. Docs, README and `.dev_flow/` are written in Ukrainian. Code, code comments and commit messages are in English.

## Commands

```sh
# run Claude Code with the mod loaded
claude --plugin-dir ~/Projects/ClaudeMods/mods/context-editor

claude plugin validate mods/context-editor          # module validator (also checks how `$` is passed around)
claude plugin test mods/context-editor              # runs every tests/*.test.ts of the mod

# type check (there is no global tsc)
npx -p typescript@5.6.3 tsc -p mods/context-editor/tsconfig.json --noEmit
```

`claude plugin test` takes only a directory and has no filter. To run one test file, point it at a temporary folder that holds just that file plus the `hooks/` it imports.

`mods/*/tsconfig.json` extends `.claude-plugin/types/tsconfig.json`. Claude Code generates that folder each time it loads the mod, and git ignores it. In a fresh clone, the types and `tsc` only work after the mod has been loaded once with `--plugin-dir`.

## Architecture

### One plugin that both runs and handles the compaction

`mods/context-editor` gives the agent the MCP tools `context_list`, `context_edit`, `context_tag`, `context_note` and `context_handoff`, the skill `context-editor:context-stages`, and the person the command `/handoff`. The agent decides when to optimize: it closes a task stage with `context_tag`, or ends an answer with the `[context-editor: optimize]` line, which starts an optimization turn. Nothing reminds it to clean: a separate soft hint line, `[context-editor: suggestion]` (after a big output once the conversation is large and has grown, or with the person's next prompt after a run of them), only proposes compressing the outputs not compressed yet, with the gain, the prompt-cache cost and a break-even verdict; `context_list` shows context telemetry on request, including where the API's ~20-position cache lookback starts. Edits are not applied right away. They go into a queue file. After a turn of the main conversation, Flush runs the built-in `/compact` with the marker `context-editor: apply queued edits` through `$.command.run`, and the mod's own `session.compact` handler, matching on that `instructions` text, applies the queue and returns the new rows; only when the agent asked for it (`keep_cache` in `context_edit`) do the rows before the response that holds the first change come back as they came, with their `handle` (the frozen prefix: the prompt cache holds up to it, but `--resume` then shows those responses twice). Then Flush sends the resume prompt.

A plugin's `$.command.run({ command: 'compact', args })` reaches that plugin's own hooks, works in the non-interactive host too, and arrives with `trigger: 'manual'`. `$.session.compact` is never used: the host skips the calling plugin's own hooks for it, and the non-interactive host refuses it outright. That is why the mod no longer needs a second plugin or a ready file.

The handoff (`context_handoff`, `/handoff`) builds a seed from what the model sees, runs `/clear`, then `/compact` with `context-editor: seed the handed-off conversation`; the handler returns the seeded rows in place of the cleared session's. Media of untouched pairs goes as files named in the result text.

Commands run only from a deferred action (`$.clock.after`) planned in `turn.complete` or in the `/handoff` command handler, never from a timer made in a `tool.call` or `prompt.submit` hook. Each command gets one attempt; the host's refusal text goes into the reasons or the status line.

Shared state lives on disk at `$HOME/.claude/context-editor/<session_id>/`, a directory with mode 700. It holds `pending.json` (the queue), `tags.json`, `aliases.json`, `boundary.json`, `journal.json` (the journal of effect), `deliveries.json` (the host's mid-turn deliveries, recorded so an apply can put them back as rows), archives of the replaced originals with their media, and the handoff's seed files.

### Ports pattern (how the code is split for testing)

Faking the whole host `$` is expensive, so the logic sits in pure modules behind small IO interfaces, and `register.ts` binds those interfaces to `$`:

- `hooks/edits.ts`: edit, listing and media logic (pure, incl. the frozen prefix and ResponseStart), and the compaction boundary: CurrentRows (`ViewIO`), the host process identity and which boundary to trust.
- `hooks/media.ts`: PromptMatch, which ties media in a person's prompt in the API form to its row (pure; used by CollectMedia in `edits.ts`).
- `hooks/queue.ts` (`QueueIO`): the queue, `context_edit`, and delivering the report.
- `hooks/compaction.ts` (`CompactionIO`): the markers, which branch a compaction takes, applying queued edits inside `session.compact`, and the boundary observer.
- `hooks/flush.ts` (`FlushIO`): running the compaction command after a turn and the resume prompt.
- `hooks/turns.ts`: the turn counter Flush, AutoTag and the handoff share.
- `hooks/handoff.ts` (`HandoffIO`, `SeedIO`): the handoff request, BuildSeed, CheckSeed, CheckSeeded, RunHandoff and HandleSeed.
- `hooks/tags.ts` (`TagIO`), `hooks/aliases.ts` (`AliasIO`): tags, auto-tagging rules, `context_tag` (incl. stage open/close), and the `cN` call aliases.
- `hooks/stages.ts`: stages and their row marks, the close report, the optimization mark and turn texts, telemetry and calibrated size estimates.
- `hooks/hints.ts` (`HintIO`): the soft hint: its two channels (a marked output, the person's next prompt), its candidates, proposal and text, and its state (`hint` in `tags.json`).
- `hooks/cache.ts`: what an apply costs the prompt cache (API positions, the lookback start, the rewrite), the break-even and the verdict (pure).
- `hooks/notes.ts`: the agent's service notes (`context_note`), their relocation after edits, and note reminders.
- `hooks/journal.ts` (`JournalIO`): the journal of effect: what each application compressed, own writes of compressed paths, rereads of compressed content and archives.
- `hooks/deliveries.ts` (`DeliveryIO`): the host's mid-turn deliveries (`queued_command`: the person's messages typed during a turn, subagent reports, task notifications): RecordDelivery from `session.append`, InsertDeliveries after a rebuilt anchor row in the compaction and the seed, and the frames PersonText reads.
- `hooks/register.ts`: tool schemas and descriptions, the event hooks, and storage I/O. It has its own `serial()` chain per file so that read-modify-write cycles never overlap.

Tests in `tests/*.test.ts` use `claude-code/testing`, call these pure functions with fake IO objects, and build `SessionMessage` rows by hand. New logic belongs in a ports module with a test. `register.ts` should only do the binding.

### Traceability IDs

Code comments and commit subjects cite IDs from `docs/`: `C_CTX_*` (concept), `SP_CTX_NN_MM` (spec sections, e.g. `[SP_CTX_02_06]`), `PL_CTX_P*` (plan phases), and `*_DEC_*` (design decisions). Commit subjects start with the doc codes they touch, e.g. `[PL_CTX][SP_CTX][C_CTX] ...`. When behavior changes, update the spec section that the comment cites. `docs/context_editor.sp.md` §01_12 holds the full constants table.

## Host behavior you must know

`.dev_flow/skills/claude-code/plugin-hooks.md` lists host pitfalls found by testing live, against Claude Code 2.1.294–2.1.296 (older hosts are not supported). Read it before changing hooks. The ones you hit most often:

- A hook has the shape `($, e, next)`. If it never calls `next`, it answers the event itself. Modules have no Node or DOM APIs, so everything goes through `$`. The validator allows `$` to be passed only to functions declared at the top level of the same file. A `tool.call` matcher must be a string or regex literal (no template strings: `${...}` in a matcher gives `tool=?`). One module may register an event without a matcher only once (e.g. one `session.compact` hook). `$.env.get` and `$.env.set` take the variable's name only as a string literal (the validator lists the names), so `'CONTEXT_EDITOR_HOST'` is spelled out at each call.
- Hooks that can refuse (`tool.call`, `prompt.submit`, `session.compact`) need `.catch`. Without one, a failing hook is skipped and the event goes on. `.catch` has a budget of about 1 s. In `session.compact`, the `.catch` must return `{ skip }` for the mod's own instructions, so that a failure never falls through to a real summarizing compaction.
- Never await `$.prompt.submit` inside a `session.compact` hook: it deadlocks. A refused prompt resolves with `{ drop }`. It does not throw.
- `$.command.run` queues a command until the session is idle and returns after the work (`compact` once the handler answered, `clear` once `$.session.id()` is new). Its refusal is final. It refuses a call from a timer made inside a `tool.call` hook. The mod's own `/clear` and `/compact` raise no `prompt.submit`, `turn.start` or `turn.complete`.
- The non-interactive host (VS Code, SDK, stream-json) has no `/resume` for `$.command.run`, and `$.session.compact` always fails there; `clear` and `compact` work. In a one-shot `claude -p "<prompt>"`, every `$.command.*` after the last turn fails with "no session is bound in this process".
- In stream-json every row a compaction handler returns passes through `session.append` again, with an origin that depends on the row: prompt rows `origin.kind = 'plugin'`, assistant rows `model '<synthetic>'`, tool-result rows `origin.kind = 'tool'` (so an origin filter does not catch copied results; the mod remembers their `tool_use_id`s until the next turn). In the terminal those rows and the command's rows bypass `session.append`.
- A row without `handle`, or with a `handle` from another session, loses its media and thinking blocks.
- A compaction runs only between turns; a command started mid-turn waits for the turn's end, and a turn may start meanwhile, so recheck the turn counter after each command. `/clear` and `/resume` change `session_id` without a `session.start`, so check the session before each storage operation. The read of the conversation is "originals + copies" only in the host process that ran the compaction; after `--resume` or `/resume` it is the loaded chain. So `boundary.json` is trusted by host process: it carries `host` = `<CONTEXT_EDITOR_HOST token>:<ppid>` (one read per module instance, awaited by readers, only peeked by compaction handlers), or this module instance wrote it in this session; a session switch in the same process strips `host` from the new session's boundary (SP_CTX_DEC_10).
- `$.fs.read` and `$.fs.write` are capped at 4 MiB. Write larger files through `$.process.run(['sh','-c','umask 077 && cat > "$1"','sh',path], { stdin })`.

## Live testing

Unit tests don't cover how the host behaves. Run live scenarios in a separate `claude --plugin-dir mods/context-editor --debug` process: in the terminal inside tmux, driven by a script, and in the non-interactive host in stream-json mode (`-p --input-format stream-json --output-format stream-json`), as VS Code runs it. The debug log goes to `~/.claude/debug/<session>.txt`. The current task's drivers are `.dev_flow/cache/live-test/ce.sh` (terminal) and `.dev_flow/cache/handoff-long/drive.sh` (stream-json); git ignores `.dev_flow/cache/`. To find the active task and its next step, read `.dev_flow/active_context.md`.
