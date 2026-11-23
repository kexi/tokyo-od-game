#!/bin/bash
# 使い方: gen.sh <ラベル> <range> <below> "<flags>"
# 鍵を取り、caffeinate の下で just measure-expressway-area を 1 本走らせ、25 分で子孫ごと止める。
# Why not timeout(1) / setpgid: このマシンでは setpgid が拒まれることがあり、プロセス群で殺せない。
# 子孫を pgrep -P でたどって止める。
set -uo pipefail
S=/private/tmp/claude-501/-Users-kei-ghq-github-com-kexi-tokyo-od-game/b5023d79-0cd6-4ccb-b30d-ed8c9d56f16c/scratchpad
WT=/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02
label="$1"
range="$2"
below="$3"
flags="${4:-}"
LOG="$WT/.qa/r13/gen-$label.log"
LIMIT_S=1500

kill_tree() {
    local pid="$1"
    local child
    for child in $(pgrep -P "$pid"); do kill_tree "$child"; done
    kill -TERM "$pid" 2>/dev/null
}

bash "$S/qa-take.sh" R13 "$label" || exit 91
cd "$WT" || exit 92
start=$(date +%s)
echo "start $(date -u +%FT%TZ) $label $range $below $flags" >"$LOG"
# ラベル make-default: フラグなしで public/data/expressway を作り直す（バイト一致の確かめ）。
if [[ "$label" == make-default ]]; then
    caffeinate -d -i nix develop --command just make-expressway-data >>"$LOG" 2>&1 &
else
    caffeinate -d -i nix develop --command just measure-expressway-area "$label" "$range" "$below" "$flags" >>"$LOG" 2>&1 &
fi
job=$!
while kill -0 "$job" 2>/dev/null; do
    elapsed=$(($(date +%s) - start))
    if [[ "$elapsed" -gt "$LIMIT_S" ]]; then
        echo "timeout after ${elapsed}s" >>"$LOG"
        kill_tree "$job"
        break
    fi
    sleep 10
done
wait "$job"
code=$?
echo "end $(date -u +%FT%TZ) code=$code elapsed=$(($(date +%s) - start))s" >>"$LOG"
bash "$S/qa-give.sh" R13 || exit 90
exit "$code"
