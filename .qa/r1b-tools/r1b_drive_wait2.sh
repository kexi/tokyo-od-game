#!/bin/bash
# One drive under the lock with a pre-wait, from this worktree (R1-1b 追記 3; the first,
# r1b_drive_wait.sh, cds into the earlier担当's worktree):
#   r1b_drive_wait2.sh <label> <route> <port> <wait> [XW_DATA_DIR]
# Writes .qa/r1b/drives-<label>-w<wait>/<route>.json and the log beside it, with the drive's start
# and end (UTC) and any setpgid warning in <route>.times. At 25 min the drive's processes are killed
# by walking its descendants (pgrep -P), leaves first, then checked gone. Why not the process group
# (kill -- -pid, the first version): bash's job control was refused setpgid in 2 of the drives
# (追記 4 D10), and the group is then not the drive's. Chrome mutes itself (scripts/qa/browser.mjs
# --mute-audio); caffeinate keeps the machine awake.
set -uo pipefail
S=/private/tmp/claude-501/-Users-kei-ghq-github-com-kexi-tokyo-od-game/b5023d79-0cd6-4ccb-b30d-ed8c9d56f16c/scratchpad
W="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=$1
ROUTE=$2
PORT=$3
WAIT=$4
DATA=${5:-}
cd "$W" || exit 1
OUT=".qa/r1b/drives-$LABEL-w$WAIT"
mkdir -p "$OUT"
LOG="$OUT/$ROUTE.log"
TIMES="$OUT/$ROUTE.times"

# The pids under $1, deepest first.
descendants() {
    local kid
    for kid in $(pgrep -P "$1"); do
        descendants "$kid"
        echo "$kid"
    done
}

bash "$S/qa-take.sh" R1 "r1b-$LABEL-$ROUTE-w$WAIT" || exit 1
trap 'bash "$S/qa-give.sh" R1' EXIT
if [[ -n "$DATA" ]]; then export XW_DATA_DIR="$DATA"; fi
echo "start $(date -u +%FT%TZ)" >"$TIMES"
caffeinate -d -i ./node_modules/.bin/tsx scripts/qa/drive-deck.ts --label "$LABEL" --route "$ROUTE" --pre-wait "$WAIT" \
    --base "http://localhost:$PORT/tokyo-od-game/" --out "$OUT" >"$LOG" 2>>"$TIMES" &
pid=$!
deadline=$(($(date +%s) + 1500))
while kill -0 "$pid" 2>/dev/null && [[ "$(date +%s)" -lt "$deadline" ]]; do sleep 5; done
if kill -0 "$pid" 2>/dev/null; then
    tree=$(descendants "$pid")
    for p in $tree "$pid"; do kill -KILL "$p" 2>/dev/null || echo "Skipped $p (gone)"; done
    echo "killed at 25 min: $tree $pid" >>"$TIMES"
fi
wait "$pid"
code=$?
left=$(descendants "$pid")
[[ -n "$left" ]] && echo "left after the drive: $left" >>"$TIMES"
echo "end $(date -u +%FT%TZ) exit $code" >>"$TIMES"
tail -1 "$LOG" | cut -c1-600
echo "exit $code"
