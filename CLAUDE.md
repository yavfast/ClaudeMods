# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Mods for Claude Code: plugins built from **function hooks** (TypeScript modules listed in `hooks/hooks.json`, run by the host, not shell hooks from `settings.json`). Work follows the dev-flow process: concept → spec → plan in `docs/`, then code in `mods/`, with per-task state in `.dev_flow/`. Docs, README and `.dev_flow/` are written in Ukrainian. Code, code comments and commit messages are in English.

## Commands

```sh
# run Claude Code with both mods loaded (they only work as a pair)
claude --plugin-dir ~/Projects/ClaudeMods/mods/context-editor --plugin-dir ~/Projects/ClaudeMods/mods/context-editor-trigger

claude plugin validate mods/context-editor          # module validator (also checks how `$` is passed around)
claude plugin test mods/context-editor              # runs every tests/*.test.ts of the mod
claude plugin test mods/context-editor-trigger
scripts/check-shared.sh                             # the shared constants of the two mods still match

# type check (there is no global tsc)
npx -p typescript@5.6.3 tsc -p mods/context-editor/tsconfig.json --noEmit
```

`claude plugin test` takes only a directory and has no filter. To run one test file, point it at a temporary folder that holds just that file plus the `hooks/` it imports.

`mods/*/tsconfig.json` extends `.claude-plugin/types/tsconfig.json`. Claude Code generates that folder each time it loads the mod, and git ignores it. In a fresh clone, the types and `tsc` only work after the mod has been loaded once with `--plugin-dir`.

## Architecture

### Two plugins that must agree

- `mods/context-editor` gives the agent the MCP tools `context_list`, `context_edit` and `context_tag`. Edits are not applied right away. They go into a queue file, and the plugin's `session.compact` handler applies them later.
- `mods/context-editor-trigger`: on `turn.complete`, if the queue holds edits and the editor is running in this process, it calls `$.session.compact({ instructions: MARKER })` and then submits the resume prompt.

The split exists because the host skips a plugin's own hooks for a compaction that plugin started ("skipped: re-entry"). The request and the handler have to live in different plugins. The plugins share no code. They agree on string constants (MARKER, DEFAULT_RESUME, storage path, `editor-ready`, the tool name, queue field names, and the rule HEARTBEAT × 3 ≤ READY_FRESH), and `scripts/check-shared.sh` checks them with grep. If you rename or move any of these constants, update that script too.

Shared state lives on disk at `$HOME/.claude/context-editor/<session_id>/`, a directory with mode 700. It holds `pending.json` (the queue), `tags.json`, the aliases registry, `editor-ready` (a heartbeat file the trigger checks for freshness) and archives of the replaced originals. The trigger only reads these files and never writes them.

### Ports pattern (how the code is split for testing)

Faking the whole host `$` is expensive, so the logic sits in pure modules behind small IO interfaces, and `register.ts` binds those interfaces to `$`:

- `hooks/edits.ts`: edit, listing and media logic (pure).
- `hooks/queue.ts` (`QueueIO`): the queue, `context_edit`, and delivering the report.
- `hooks/compaction.ts` (`CompactionIO`): applies queued edits inside `session.compact`.
- `hooks/tags.ts` (`TagIO`), `hooks/aliases.ts` (`AliasIO`): tags, auto-tagging rules, reminders, and the `cN` call aliases.
- `mods/context-editor-trigger/hooks/flush.ts` (`TriggerIO`): the trigger's decision logic.
- `hooks/register.ts` in each mod: tool schemas and descriptions, the event hooks, and storage I/O. Each file has its own `serial()` chain so that read-modify-write cycles never overlap.

Tests in `tests/*.test.ts` use `claude-code/testing`, call these pure functions with fake IO objects, and build `SessionMessage` rows by hand. New logic belongs in a ports module with a test. `register.ts` should only do the binding.

### Traceability IDs

Code comments and commit subjects cite IDs from `docs/`: `C_CTX_*` (concept), `SP_CTX_NN_MM` (spec sections, e.g. `[SP_CTX_02_06]`), `PL_CTX_P*` (plan phases), and `*_DEC_*` (design decisions). Commit subjects start with the doc codes they touch, e.g. `[PL_CTX][SP_CTX][C_CTX] ...`. When behavior changes, update the spec section that the comment cites. `docs/context_editor.sp.md` §01_12 holds the full constants table.

## Host behavior you must know

`.dev_flow/skills/claude-code/plugin-hooks.md` lists host pitfalls found by testing live, against Claude Code 2.1.294. Read it before changing hooks. The ones you hit most often:

- A hook has the shape `($, e, next)`. If it never calls `next`, it answers the event itself. Modules have no Node or DOM APIs, so everything goes through `$`. The validator allows `$` to be passed only to functions declared at the top level of the same file. A `tool.call` matcher must be a string literal.
- Hooks that can refuse (`tool.call`, `prompt.submit`, `session.compact`) need `.catch`. Without one, a failing hook is skipped and the event goes on. `.catch` has a budget of about 1 s. In `session.compact`, the `.catch` must return `{ skip }`, so that a failure never falls through to a real summarizing compaction.
- Never await `$.prompt.submit` inside a `session.compact` hook: it deadlocks. A refused prompt resolves with `{ drop }`. It does not throw.
- `session.compact` can only run between turns. `/clear` and `/resume` change `session_id` without a `session.start`, so check the session before each storage operation.
- `$.fs.read` and `$.fs.write` are capped at 4 MiB. Write larger files through `$.process.run(['sh','-c','umask 077 && cat > "$1"','sh',path], { stdin })`.

## Live testing

Unit tests don't cover how the host behaves. Run live scenarios in a separate `claude --plugin-dir … --debug` process inside tmux, driven by a script. The debug log goes to `~/.claude/debug/<session>.txt`. The current task's driver is `.dev_flow/cache/live-test/ce.sh` (git ignores `.dev_flow/cache/`). To find the active task and its next step, read `.dev_flow/active_context.md`.
