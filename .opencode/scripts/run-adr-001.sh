#!/bin/zsh
# ADR-Factory-001 spec-fix runner: retries on provider rate limit, logs everything.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.." || exit 1

PROMPT_FILE=".opencode/prompts/adr-factory-001.md"
LOG="factory-v1.2/_run.log"
MODEL="commandcode/deepseek/deepseek-v4.1-flash"

mkdir -p factory-v1.2

attempt=0
max_attempts=80
started=0

while (( attempt < max_attempts )); do
  attempt=$((attempt+1))
  echo "=== attempt $attempt at $(date -Iseconds) (continued=$started) ===" >> "$LOG"

  if (( started == 0 )); then
    out=$(opencode run --agent factory-spec-fixer --model "$MODEL" --title "ADR-Factory-001" "$(cat "$PROMPT_FILE")" 2>&1)
  else
    out=$(opencode run --agent factory-spec-fixer --model "$MODEL" --continue \
      "Continue the ADR-Factory-001 spec-fix task in factory-v1.2/. Original instructions follow: $(cat "$PROMPT_FILE")" 2>&1)
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
