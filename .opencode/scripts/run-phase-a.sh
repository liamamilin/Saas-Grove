#!/bin/zsh
# Phase A audit runner: retries on provider rate limit, logs everything.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.." || exit 1

PROMPT_FILE=".opencode/prompts/phase-a-audit.md"
LOG="reports/factory-readonly/_run.log"
MODEL="commandcode/deepseek/deepseek-v4.1-flash"

mkdir -p reports/factory-readonly

attempt=0
max_attempts=60
started=0

while (( attempt < max_attempts )); do
  attempt=$((attempt+1))
  echo "=== attempt $attempt at $(date -Iseconds) (continued=$started) ===" >> "$LOG"

  if (( started == 0 )); then
    out=$(opencode run --agent factory-auditor --model "$MODEL" --title "PhaseA-factory-audit" "$(cat "$PROMPT_FILE")" 2>&1)
  else
    out=$(opencode run --agent factory-auditor --model "$MODEL" --continue \
      "Continue the Phase A audit. Re-read the task prompt if needed: $(cat "$PROMPT_FILE")" 2>&1)
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
