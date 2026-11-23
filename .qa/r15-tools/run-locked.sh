#!/bin/bash
# R1-5 PR A: one browser run under the machine lock (R15), from this worktree:
#   run-locked.sh <label> <port> <data-dir|-> <command...>
# Starts this worktree's dev server on <port> (XW_DATA_DIR=<data-dir> unless "-"), runs the command
# under caffeinate with BASE set to the server's URL, kills it and its descendants (leaves first, as
# R1-1b's r1b_drive_wait2.sh) at 25 min, stops the server, gives the lock back. Start / end (UTC) and
# the exit code go to .qa/r15-runs/<label>.times, the command's output to <label>.log.
set -uo pipefail
S=/private/tmp/claude-501/-Users-kei-ghq-github-com-kexi-tokyo-od-game/b5023d79-0cd6-4ccb-b30d-ed8c9d56f16c/scratchpad
W=/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/r15-street-drive
LABEL=$1
PORT=$2
DATA=$3
shift 3
cd "$W" || exit 1
mkdir -p .qa/r15-runs
LOG=".qa/r15-runs/$LABEL.log"
TIMES=".qa/r15-runs/$LABEL.times"

descendants() {
    local kid
    for kid in $(pgrep -P "$1"); do
        descendants "$kid"
        echo "$kid"
    done
}
stop_tree() {
    local tree
    tree=$(descendants "$1")
    for p in $tree "$1"; do kill -KILL "$p" 2>/dev/null || echo "Skipped $p (gone)"; done
}

bash "$S/qa-take.sh" R15 "$LABEL" || exit 1
echo "lock $(date -u +%FT%TZ)" >"$TIMES"
if [[ "$DATA" != "-" ]]; then export XW_DATA_DIR="$DATA"; else unset XW_DATA_DIR; fi
./node_modules/.bin/vite --port "$PORT" --strictPort >".qa/r15-runs/$LABEL.server.log" 2>&1 &
server=$!
for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://localhost:$PORT/tokyo-od-game/" && break
    sleep 1
done
export BASE="http://localhost:$PORT/tokyo-od-game/"
echo "start $(date -u +%FT%TZ) XW_DATA_DIR=${XW_DATA_DIR:-}" >>"$TIMES"
caffeinate -d -i "$@" >"$LOG" 2>>"$TIMES" &
pid=$!
deadline=$(($(date +%s) + 1500))
while kill -0 "$pid" 2>/dev/null && [[ "$(date +%s)" -lt "$deadline" ]]; do sleep 5; done
if kill -0 "$pid" 2>/dev/null; then
    stop_tree "$pid"
    echo "killed at 25 min" >>"$TIMES"
fi
wait "$pid"
code=$?
echo "end $(date -u +%FT%TZ) exit $code" >>"$TIMES"
stop_tree "$server"
bash "$S/qa-give.sh" R15 || exit 90
tail -3 "$LOG" | cut -c1-800
echo "exit $code"
exit "$code"
