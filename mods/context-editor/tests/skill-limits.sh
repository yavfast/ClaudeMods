#!/bin/sh
# [SP_CTX_02_27] The limits of the skill file: the frontmatter description
# (always visible in the skill listing) at most 250 chars, the whole file at
# most 9000 chars. `claude plugin test` runs *.test.ts without a file system,
# so no unit test can read SKILL.md: run this beside it.
#   sh mods/context-editor/tests/skill-limits.sh
export LC_ALL=C.UTF-8
f="$(dirname "$0")/../skills/context-stages/SKILL.md"
[ -f "$f" ] || { echo "skill-limits: $f not found"; exit 1; }
desc=$(sed -n '2,/^---$/s/^description: //p' "$f" | head -n 1)
d=$(printf %s "$desc" | wc -m)
b=$(wc -m < "$f")
status=0
[ -n "$desc" ] || { echo "skill-limits: no description"; status=1; }
[ "$d" -le 250 ] || { echo "skill-limits: description $d chars > 250"; status=1; }
[ "$b" -le 9000 ] || { echo "skill-limits: SKILL.md $b chars > 9000"; status=1; }
[ "$status" -eq 0 ] && echo "skill-limits: description $d/250, SKILL.md $b/9000 chars"
exit "$status"
