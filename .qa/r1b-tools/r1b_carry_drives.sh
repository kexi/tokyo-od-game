#!/bin/bash
# R1-1b 追記 1 A3 / A4 の 6 / A5 (carried over): on the default data, the branch (.qa/r1b-qa, :5331)
# and main (.qa/r1b-main, :5332), one drive at a time under the lock:
# - wall-45068170 lane 0 and lane 1 at the posted speed (the ends that end on each other, the lane
#   under 24402125's deck; and 45068170 neared from 24402611, not from 芝公園, for the reading order);
# - auto-shibakoen-shiodome with a 40 s wait, three times each.
# Results in .qa/r1b/drives-carry-<side>-w<wait>/.
set -uo pipefail
W="$(cd "$(dirname "$0")/../.." && pwd)"
T="$W/.qa/r1b-tools"
DEFAULT="$W/public/data/expressway"

serve() {
    local wt=$1 port=$2
    pkill -f "vite --port $port --strictPort" || echo "Skipped stopping :$port (none)"
    [[ -e "$wt/node_modules" ]] || ln -s "$W/node_modules" "$wt/node_modules"
    rm -rf "$wt/public/data/expressway"
    cp -R "$DEFAULT" "$wt/public/data/expressway"
    (cd "$wt" && nohup ./node_modules/.bin/vite --port "$port" --strictPort >"$W/.qa/r1b/vite-$port.log" 2>&1 &)
    for _ in $(seq 1 30); do
        curl -s -o /dev/null "http://localhost:$port/tokyo-od-game/" && return 0
        sleep 1
    done
    echo "no server on :$port" && return 1
}

for side in qa main; do
    port=5331
    [[ "$side" == main ]] && port=5332
    serve "$W/.qa/r1b-$side" "$port" || exit 1
    for lane in 0 1; do
        bash "$T/r1b_drive_wait2.sh" "carry-$side" "wall-45068170-lane$lane-posted" "$port" 0
    done
    for i in 1 2 3; do
        bash "$T/r1b_drive_wait2.sh" "carry-$side-$i" auto-shibakoen-shiodome "$port" 40
    done
    pkill -f "vite --port $port --strictPort" || echo "Skipped stopping :$port"
done
echo CARRYDONE
