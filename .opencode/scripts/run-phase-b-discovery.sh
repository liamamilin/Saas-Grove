#!/bin/zsh
# Phase B discovery runner: retries on provider rate limit, logs everything.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.." || exit 1

PROMPT_FILE=".opencode/prompts/phase-b-discovery.md"
LOG="reports/phase-b-discovery/_run.log"
MODEL="commandcode/deepseek/deepseek-v4.1-flash"

mkdir -p reports/phase-b-discovery

attempt=0
max_attempts=100
started=0

while (( attempt < max_attempts )); do
  attempt=$((attempt+1))
  echo "=== attempt $attempt at $(date -Iseconds) (continued=$started) ===" >> "$LOG"

  if (( started == 0 )); then
    out=$(opencode run --agent factory-discoverer --model "$MODEL" --title "PhaseB-discovery" "$(cat "$PROMPT_FILE")" 2>&1)
  else
    out=$(opencode run --agent factory-discoverer --model "$MODEL" --continue \
      "Continue the Phase B discovery task in reports/phase-b-discovery/. Original instructions: $(cat "$PROMPT_FILE")" 2>&1)
  fi
  code=$?
  echo "$out" >> "$LOG"
  echo "--- exit=$code ---" >> "$LOG"

  if grep -qi "rate limit" <<< "$out"; then
    sleep 90
    continue
  fi

  started=1
  echo "=== finished (exit=$code) at $(date -Iseconds) ===" >> "$LOG"
  exit $code
done

echo "=== gave up after $max_attempts attempts ===" >> "$LOG"
exit 1
