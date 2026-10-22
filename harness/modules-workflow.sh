#!/bin/zsh
# Free-model-only production workflow for module templates (no Claude involved).
#   harness/modules-workflow.sh <round-tag> [inner-fix-cycles=2] [jobs=5]
# per module: generate (minimax) -> lint+repair -> [ free review (beam-free) -> fix (minimax) ] x K -> final free review.
# Claude is expected only after this script writes <runs>/modules/<tag>.done.
set -u
TAG=${1:?round tag}; K=${2:-2}; JOBS=${3:-5}
cd "$(dirname "$0")/.."
R=/Users/Shared/saas-template-runs/modules
FREE=opencode-go/beam-free
names=($(node -e 'console.log(JSON.parse(require("fs").readFileSync("templates/modules.json","utf8")).modules.map(m=>m.name).join(" "))'))
node harness/modules.mjs run --jobs $JOBS > $R/$TAG-gen.log 2>&1
node harness/modules-lint.mjs > $R/$TAG-lint0.log 2>&1
per_module() {
  n=$1
  for k in $(seq 1 $K); do
    node harness/modules.mjs review --only $n --round $TAG-w$k --model $FREE > $R/$TAG-$n-review$k.log 2>&1
    node harness/modules.mjs fix --only $n --review $TAG-w$k > $R/$TAG-$n-fix$k.log 2>&1
  done
  node harness/modules.mjs review --only $n --round $TAG-final --model $FREE > $R/$TAG-$n-final.log 2>&1
}
for n in $names; do
  per_module $n &
  while [ $(jobs -r | wc -l) -ge $JOBS ]; do sleep 10; done
done
wait
node harness/modules-lint.mjs > $R/$TAG-lint-final.log 2>&1
echo finished > $R/$TAG.done
