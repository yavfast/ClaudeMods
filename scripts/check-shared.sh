#!/usr/bin/env bash
# Checks that context-editor and context-editor-trigger agree on the values
# they share ([SP_CTX_01_07], [SP_CTX_01_12]): the compaction MARKER, the
# default resume prompt, the storage layout, the editor's tool name and the
# heartbeat against the trigger's freshness window.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
e_reg=$root/mods/context-editor/hooks/register.ts
e_queue=$root/mods/context-editor/hooks/queue.ts
t_reg=$root/mods/context-editor-trigger/hooks/register.ts
t_flush=$root/mods/context-editor-trigger/hooks/flush.ts
fail=0
check() { "$@" || { echo "mismatch: $*"; fail=1; }; }
value() { grep -oE "$1" "$2" | head -1; }

marker_e=$(value 'MARKER = `\$\{PLUGIN\}: [^`]+`' "$e_reg" | sed -E 's/.*: ([^`]+)`/context-editor: \1/')
marker_t=$(value "MARKER = '[^']+'" "$t_flush" | sed -E "s/MARKER = '([^']+)'/\1/")
check test -n "$marker_e" -a "$marker_e" = "$marker_t"

resume_e=$(value "DEFAULT_RESUME = '[^']+'" "$e_queue")
resume_t=$(value "DEFAULT_RESUME = '[^']+'" "$t_flush")
check test -n "$resume_e" -a "$resume_e" = "$resume_t"

check grep -q '/.claude/${PLUGIN}' "$e_reg"
check grep -q "const PLUGIN = 'context-editor'" "$e_reg"
check grep -q '/.claude/context-editor/${await $.session.id()}' "$t_reg"
check grep -q 'pending.json' "$e_reg"
check grep -q 'pending.json' "$t_reg"
check grep -q 'editor-ready' "$e_reg"
check grep -q 'editor-ready' "$t_reg"
check grep -q "const EDIT = 'context_edit'" "$e_reg"
check grep -q "EDITOR_TOOL = 'mcp__context-editor__context_edit'" "$t_reg"

# fields of the queue file the trigger reads must exist in the editor's Queue
for field in edits report reportId reportResume reportPrompt; do
  check grep -qE "^  ${field}\??:" "$e_queue"
  check grep -q "${field}" "$t_flush"
done

heartbeat=$(value 'HEARTBEAT_MS = [0-9_]+' "$e_reg" | grep -oE '[0-9_]+$' | tr -d _)
fresh=$(value 'READY_FRESH_MS = [0-9_]+' "$t_flush" | grep -oE '[0-9_]+$' | tr -d _)
check test -n "$heartbeat" -a -n "$fresh"
check test $((heartbeat * 3)) -le "$fresh"

((fail == 0)) && echo "shared constants: ok"
exit $fail
