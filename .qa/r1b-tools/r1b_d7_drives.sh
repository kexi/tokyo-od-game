#!/bin/bash
# R1-1b 追記 4 D7: the drives past the walls that gave way, on this branch (.qa/r1b-qa, :5331) and on
# main (.qa/r1b-main at 5d0b7a2, :5332), each worktree serving the data as its public/data/expressway
# (copied in, never committed). One drive at a time under the lock (r1b_drive_wait2.sh). Results
# in .qa/r1b/drives-d7-<side>-w0/.
set -uo pipefail
W="$(cd "$(dirname "$0")/../.." && pwd)"
T="$W/.qa/r1b-tools"

# Serve <data folder> from <worktree> on <port>: data copied in, server restarted.
serve() {
    local wt=$1 data=$2 port=$3
    pkill -f "vite --port $port --strictPort" || echo "Skipped stopping :$port (none)"
    [[ -e "$wt/node_modules" ]] || ln -s "$W/node_modules" "$wt/node_modules"
    rm -rf "$wt/public/data/expressway"
    cp -R "$data" "$wt/public/data/expressway"
    (cd "$wt" && nohup ./node_modules/.bin/vite --port "$port" --strictPort >"$W/.qa/r1b/vite-$port.log" 2>&1 &)
    for _ in $(seq 1 30); do
        curl -s -o /dev/null "http://localhost:$port/tokyo-od-game/" && return 0
        sleep 1
    done
    echo "no server on :$port" && return 1
}

G3="$W/.cache/expressway-area/r1b-g3"
G1="$W/.cache/expressway-area/r1b-g1-pruned"
for side in qa main; do
    port=5331
    [[ "$side" == main ]] && port=5332
    wt="$W/.qa/r1b-$side"
    serve "$wt" "$G3" "$port" || exit 1
    bash "$T/r1b_drive_wait2.sh" "d7-$side" onward-756785283-by-203832847 "$port" 0 "$G3"
    serve "$wt" "$G1" "$port" || exit 1
    for lane in 0 1; do
        bash "$T/r1b_drive_wait2.sh" "d7-$side" "onward-491625692-763353050-lane$lane" "$port" 0 "$G1"
    done
    pkill -f "vite --port $port --strictPort" || echo "Skipped stopping :$port"
done
echo D7DONE
