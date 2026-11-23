#!/bin/bash
# batch.log に生成が 1 本終わるたび、その生成に探りを掛ける（鍵は要らない）。batch done で終わる。
set -uo pipefail
cd /Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02 || exit 92
LOG=.qa/r13/batch.log
DONE=.qa/r13/probed.txt
touch "$DONE"
while true; do
    for label in $(grep -o 'r13-[a-z-]* code=0' "$LOG" | cut -d' ' -f1); do
        isShipBaseline=$([[ "$label" == r13-ship-* ]] && echo y || echo n)
        if [[ "$isShipBaseline" == y ]] || grep -qx "$label" "$DONE"; then continue; fi
        bash .qa/r13/probes.sh "$label" >>.qa/r13/probe-follow.log 2>&1
        echo "$label" >>"$DONE"
        echo "probed $label"
    done
    if grep -q "batch done" "$LOG"; then break; fi
    sleep 30
done
