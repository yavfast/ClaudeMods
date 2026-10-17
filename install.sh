#!/bin/sh
# Installs the context-editor mod from this clone on the current machine.
#
#   ./install.sh [--managed | --user] [--dry-run] [--yes]
#
# --managed  declare the marketplace `claudemods` in the machine's managed settings
#            (root): the only mode in which the mod keeps /compact and attachments
#            on a Team/Enterprise account or a machine with managed settings,
#            where the host's sec-default passes them over for user-installed
#            plugins (README, "Керований плагін").
# --user     add the marketplace and install the plugin for this user only.
# Without a mode the script picks one: managed when the machine already has
# managed settings or the account belongs to a Team/Enterprise organization.
#
# The mod loads in place from this clone, so `git pull` updates it; a new
# session (or /reload-plugins) picks up the change.
set -eu

MIN_VERSION=2.1.295
PLUGIN=context-editor@claudemods

die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

mode= dry=0 yes=0
for arg in "$@"; do
  case $arg in
    --managed) mode=managed ;;
    --user) mode=user ;;
    --dry-run) dry=1 ;;
    --yes|-y) yes=1 ;;
    -h|--help) sed -n '2,16s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg (see --help)" ;;
  esac
done

repo=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
[ -f "$repo/.claude-plugin/marketplace.json" ] || die "no .claude-plugin/marketplace.json in $repo"
[ -d "$repo/mods/context-editor" ] || die "no mods/context-editor in $repo"

case $(uname -s) in
  Linux) managed_file=/etc/claude-code/managed-settings.json ;;
  Darwin)
    managed_file='/Library/Application Support/ClaudeCode/managed-settings.json'
    say "note: macOS is not tested with this mod; the capability probe falls back to \`claude\` from PATH." ;;
  *) die "unsupported system $(uname -s): the mod is tested on Linux only" ;;
esac

command -v claude >/dev/null 2>&1 || die "claude is not on PATH"
command -v jq >/dev/null 2>&1 || die "jq is required to merge settings"

# Version check: claude --version prints "2.1.299 (Claude Code)".
version=$(claude --version 2>/dev/null | awk '{print $1; exit}')
older=$(printf '%s\n%s\n' "$version" "$MIN_VERSION" | awk -F. '
  NR == 1 { split($0, a, ".") } NR == 2 { split($0, b, ".") }
  END { for (i = 1; i <= 3; i++) { if (a[i] + 0 < b[i] + 0) { print 1; exit } if (a[i] + 0 > b[i] + 0) { print 0; exit } } print 0 }')
[ "$older" = 0 ] || die "Claude Code $version is older than $MIN_VERSION"
say "Claude Code $version, clone $repo"

if ! { command -v zip && command -v unzip; } >/dev/null 2>&1 && ! command -v bsdtar >/dev/null 2>&1; then
  say "warning: neither zip/unzip nor bsdtar found: old sessions will not be packed."
fi

config=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
org=$(jq -r '.oauthAccount.organizationType // empty' "$HOME/.claude.json" 2>/dev/null || true)
if [ -z "$mode" ]; then
  if [ -f "$managed_file" ]; then
    mode=managed reason="the machine has managed settings"
  else
    case $org in
      claude_team|claude_enterprise) mode=managed reason="the account's organization type is $org" ;;
      *) mode=user reason="no managed settings, organization type '${org:-none}'" ;;
    esac
  fi
  say "mode: $mode ($reason)"
fi

# Other copies of the mod this user enabled (e.g. an old local marketplace).
stale=$(jq -c '[.enabledPlugins // {} | to_entries[]
  | select(.key | startswith("context-editor@")) | select(.key != $plugin)
  | select(.value == true) | .key]' --arg plugin "$PLUGIN" "$config/settings.json" 2>/dev/null || echo '[]')

run() {
  say "+ $*"
  [ "$dry" = 1 ] || "$@"
}

# A failed CLI call (already installed, a stale copy whose marketplace is gone)
# is reported, not fatal, so the script can be run again.
try() {
  run "$@" || say "warning: failed: $*"
}

sudo_cmd=
if [ "$(id -u)" != 0 ]; then
  sudo_cmd=sudo
fi

if [ "$mode" = managed ]; then
  tmp=$(mktemp) old=$(mktemp)
  trap 'rm -f "$tmp" "$old"' EXIT
  trap 'exit 130' HUP INT TERM
  if [ -f "$managed_file" ]; then
    if [ -r "$managed_file" ]; then
      cat "$managed_file" >"$old"
    else
      say "$managed_file is not readable by $(id -un): reading it with sudo"
      $sudo_cmd cat "$managed_file" >"$old"
    fi
    jq -e 'type == "object"' "$old" >/dev/null 2>&1 || die "$managed_file is not a JSON object"
  else
    echo '{}' >"$old"
  fi
  # Merge, keeping every other key: sec-default@builtin stays ahead of the mod
  # in prependPlugins, so its protection holds.
  jq --arg path "$repo" --arg plugin "$PLUGIN" --argjson stale "$stale" '
    .extraKnownMarketplaces = ((.extraKnownMarketplaces // {})
      + {claudemods: {source: {source: "directory", path: $path}}})
    | .enabledPlugins = ((.enabledPlugins // {}) + ($stale | map({(.): false}) | add // {}) + {($plugin): true})
    | .prependPlugins = (((.prependPlugins // []) - [$plugin]) as $p
      | ($p | index("sec-default@builtin")) as $i
      | if $i == null then ["sec-default@builtin", $plugin] + $p
        else $p[:$i + 1] + [$plugin] + $p[$i + 1:] end)' "$old" >"$tmp"

  # Compared by content: jq rewrites the formatting of a hand-written file.
  if [ -f "$managed_file" ] && [ "$(jq -S . "$old")" = "$(jq -S . "$tmp")" ]; then
    say "$managed_file already holds these settings."
  else
    say "$managed_file (rewritten in jq's formatting):"
    if [ -f "$managed_file" ]; then diff -u "$old" "$tmp" || true; else cat "$tmp"; fi
    if [ "$dry" = 0 ]; then
      if [ "$yes" = 0 ]; then
        printf 'Write it? [y/N] '
        read -r answer </dev/tty || answer=
        case $answer in y|Y|yes) ;; *) die "nothing written" ;; esac
      fi
      [ -z "$sudo_cmd" ] || command -v sudo >/dev/null 2>&1 || die "sudo is required to write $managed_file"
      $sudo_cmd mkdir -p "$(dirname "$managed_file")"
      $sudo_cmd install -m 644 "$tmp" "$managed_file"
      say "written $managed_file"
    fi
  fi
  [ "$stale" = '[]' ] || say "disabled in managed settings$([ "$dry" = 0 ] || echo ' (dry run: would be)'): $stale (left in $config/settings.json; the managed value wins)"
else
  known=$(claude plugin marketplace list --json 2>/dev/null \
    | jq -r '.[] | select(.name == "claudemods") | "\(.source) \(.path // .repo // "")"' 2>/dev/null || true)
  if [ -z "$known" ]; then
    run claude plugin marketplace add "$repo"
  elif [ "$known" = "directory $repo" ]; then
    say "marketplace claudemods already points to this clone."
  else
    die "marketplace claudemods already points elsewhere ($known): remove it with \`claude plugin marketplace remove claudemods\` first"
  fi
  try claude plugin install "$PLUGIN" --scope user
  for key in $(printf '%s' "$stale" | jq -r '.[]'); do
    try claude plugin disable "$key" --scope user
  done
fi

run claude plugin validate "$repo/mods/context-editor"

say ""
say "Done. Start a new Claude Code session; the mod loads from $repo/mods/context-editor."
say "The VS Code extension runs its own bundled host: it must be $MIN_VERSION or newer too."
[ "$mode" = managed ] || say "If sessions then report that /compact is passed over, run ./install.sh --managed."
