#!/bin/bash
# PR #136 のレビューの直し: フラグなしの既定範囲と、ship/pruned の基準を 1 本ずつ鍵を取って作り直す。
# 25 分で子孫ごと止める（setpgid は拒まれることがあるので pgrep -P でたどる）。
set -uo pipefail
S=/private/tmp/claude-501/-Users-kei-ghq-github-com-kexi-tokyo-od-game/b5023d79-0cd6-4ccb-b30d-ed8c9d56f16c/scratchpad
WT=/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02
cd "$WT" || exit 92
LIMIT_S=1500

kill_tree() {
    local pid="$1"
    local child
    for child in $(pgrep -P "$pid"); do kill_tree "$child"; done
    kill -TERM "$pid" 2>/dev/null
}

run_one() {
    local label="$1"
    shift
    local log=".qa/r13fix/gen-$label.log"
    bash "$S/qa-take.sh" R13 "$label" || return 91
    local start
    start=$(date +%s)
    echo "start $(date -u +%FT%TZ) $label $*" >"$log"
    caffeinate -d -i nix develop --command just "$@" >>"$log" 2>&1 &
    local job=$!
    while kill -0 "$job" 2>/dev/null; do
        if [[ $(($(date +%s) - start)) -gt "$LIMIT_S" ]]; then
            echo "timeout" >>"$log"
            kill_tree "$job"
            break
        fi
        sleep 10
    done
    wait "$job"
    local code=$?
    echo "end $(date -u +%FT%TZ) code=$code elapsed=$(($(date +%s) - start))s" >>"$log"
    bash "$S/qa-give.sh" R13 || return 90
    return "$code"
}

run_one make-default make-expressway-data
echo "make-default code=$?"
run_one r13f-ship-pruned measure-expressway-area r13f-ship-pruned ship pruned "--baseline .qa/r13fix/fixture-ship.json"
echo "ship code=$?"
