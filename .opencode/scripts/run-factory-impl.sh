#!/bin/zsh
# factory-impl continuation runner: retries on rate limit, logs everything.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.." || exit 1

PROMPT_FILE=".opencode/prompts/factory-impl-continue.md"
LOG="factory-impl/_run.log"
MODEL="commandcode/deepseek/deepseek-v4.1-flash"

mkdir -p factory-impl

attempt=0
max_attempts=200
started=0

while (( attempt < max_attempts )); do
  attempt=$((attempt+1))
  echo "=== attempt $attempt at $(date -Iseconds) (continued=$started) ===" >> "$LOG"

  if (( started == 0 )); then
    out=$(opencode run --agent factory-impl-dev --model "$MODEL" --title "factory-impl-continue" "$(cat "$PROMPT_FILE")" 2>&1)
  else
    out=$(opencode run --agent factory-impl-dev --model "$MODEL" --continue \
      "Continue the factory-impl defect queue. Re-read PROGRESS.md and the independent review, then keep working P1 -> P2 -> P3. Instructions: $(cat "$PROMPT_FILE")" 2>&1)
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
