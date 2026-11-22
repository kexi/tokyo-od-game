#!/usr/bin/env bash
# One drive under the lock with a pre-wait: drive_wait.sh <label> <route> <port> <wait> [XW_DATA_DIR].
# Writes .qa/r1b/drives-<label>-w<wait>/<route>.json. The drive's whole process group is killed at
# 25 min (a plain timeout left the node and Chrome under pnpm running, 49 min).
set -uo pipefail
S=/private/tmp/claude-501/-Users-kei-ghq-github-com-kexi-tokyo-od-game/b5023d79-0cd6-4ccb-b30d-ed8c9d56f16c/scratchpad
W=/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-af5772ac5313c8ce5
label=$1; route=$2; port=$3; wait=$4; data=${5:-}
cd "$W" || exit 1
bash "$S/qa-take.sh" R1 "r1b-$label-$route-w$wait"
trap 'bash "$S/qa-give.sh" R1' EXIT
if [ -n "$data" ]; then export XW_DATA_DIR="$data"; fi
set -m
./node_modules/.bin/tsx scripts/qa/drive-deck.ts --label "$label" --route "$route" --pre-wait "$wait" \
  --base "http://localhost:$port/tokyo-od-game/" --out ".qa/r1b/drives-$label-w$wait" > "$S/drive-$label-$route-w$wait.log" 2>&1 &
pid=$!
deadline=$(( $(date +%s) + 1500 ))
while kill -0 "$pid" 2>/dev/null && [ "$(date +%s)" -lt "$deadline" ]; do sleep 5; done
if kill -0 "$pid" 2>/dev/null; then kill -KILL -- "-$pid"; echo "killed at 25 min"; fi
wait "$pid"; code=$?
tail -1 "$S/drive-$label-$route-w$wait.log" | cut -c1-400
echo "exit $code"
