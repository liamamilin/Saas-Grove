#!/usr/bin/env bash
# Install delegate-impl: the global skill + this project's subagent, config and hooks.
#
#   bash harness-proposals/delegate-impl/install.sh           # refuses to overwrite
#   bash harness-proposals/delegate-impl/install.sh --force   # overwrite skill + agent + config
#
# It never overwrites an existing .claude/settings.json: if one exists, it prints
# the hooks to merge by hand.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$HERE/../.." && pwd)"
SKILL_DST="$HOME/.claude/skills/delegate-impl"
FORCE="${1:-}"

refuse_if_exists() {
  if [ -e "$1" ] && [ "$FORCE" != "--force" ]; then
    echo "already exists: $1  (re-run with --force to overwrite)"; exit 1
  fi
}

refuse_if_exists "$SKILL_DST"
refuse_if_exists "$PROJECT/.claude/agents/impl-haiku.md"
refuse_if_exists "$PROJECT/.claude/delegate-impl.json"

echo "1/4 global skill -> $SKILL_DST"
mkdir -p "$SKILL_DST"
cp -R "$HERE/skill/." "$SKILL_DST/"
mkdir -p "$SKILL_DST/templates"
cp -R "$HERE/project/." "$SKILL_DST/templates/"   # for bootstrapping other projects

echo "2/4 project subagent + config -> $PROJECT/.claude/"
mkdir -p "$PROJECT/.claude/agents"
cp "$HERE/project/agents/impl-haiku.md" "$PROJECT/.claude/agents/impl-haiku.md"
cp "$HERE/project/delegate-impl.json" "$PROJECT/.claude/delegate-impl.json"
printf 'delegate-impl canary: subagents must not be able to modify this file.\n' \
  > "$PROJECT/.claude/delegate-impl-canary.txt"

echo "3/4 project hooks"
if [ -e "$PROJECT/.claude/settings.json" ] && cmp -s "$PROJECT/.claude/settings.json" "$HERE/project/settings.hooks.json"; then
  echo "    .claude/settings.json already has exactly these hooks — up to date"
elif [ -e "$PROJECT/.claude/settings.json" ]; then
  echo "    .claude/settings.json already exists — NOT modified. Merge this by hand:"
  cat "$HERE/project/settings.hooks.json"
else
  cp "$HERE/project/settings.hooks.json" "$PROJECT/.claude/settings.json"
  echo "    created .claude/settings.json"
fi

echo "4/4 self-test"
python3 "$SKILL_DST/scripts/selftest.py"
echo
echo "Done. Start a NEW Claude Code session in this project so the impl-haiku agent is loaded,"
echo "then follow README.md 'Live check' before the first real dispatch."
