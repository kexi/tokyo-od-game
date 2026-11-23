#!/bin/bash
# R1-3 の生成を 1 本ずつ（1 本ごとに gen.sh が鍵を取って返す）。結果は .qa/r13/batch.log に 1 行ずつ。
set -uo pipefail
WT=/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02
cd "$WT" || exit 92
R="hamazakibashi,rainbow,azabudai,azabudai_exit,shiodome"
S7="--below-junctions compile --portal-approach cut --run-borders cut"
C="--run-borders cut --districts central"
run() {
    bash .qa/r13/gen.sh "$@"
    local code=$?
    echo "$(date -u +%FT%TZ) $1 code=$code" >>.qa/r13/batch.log
}
run r13-ship-pruned ship pruned "--baseline .qa/r13/fixture-ship.json"
run r13-ship-all ship all "--baseline .qa/r13/fixture-ship-all.json"
run r13-d-all "$R" pruned "--decisions all"
run r13-d-feet-only "$R" pruned "--decisions feet-only"
run r13-d-structures-only "$R" pruned "--decisions structures-only"
run r13-d-none "$R" pruned "--decisions none"
run r13-ds-all "$R" all "$S7 --decisions all"
run r13-ds-none "$R" all "$S7 --decisions none"
run r13-c-all ship pruned "$C --decisions all"
run r13-c-none ship pruned "$C --decisions none"
run r13-cs-all ship all "$S7 --districts central --decisions all"
run r13-cs-none ship all "$S7 --districts central --decisions none"
echo "$(date -u +%FT%TZ) batch done" >>.qa/r13/batch.log
