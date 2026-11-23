#!/bin/bash
# The end-wall probe over the six folders in this worktree (R1-1b 追記 3), summary lines. Optional
# first argument: extra flags (e.g. "--raise 0.1"); second: a suffix for the out files.
cd "$(dirname "$0")/../.." || exit 1
EXTRA=${1:-}
SUFFIX=${2:-}
for d in public/data/expressway .cache/expressway-area/r1b-g3 .cache/expressway-area/r1b-g4 .cache/expressway-area/r1b-g5 .cache/expressway-area/r1b-g1-pruned .cache/expressway-area/r1b-g2-all; do
    n=$(basename "$d")
    echo "== $d"
    # shellcheck disable=SC2086
    ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs scripts/expresswayEndWalls.ts "$d" $EXTRA --out ".qa/expressway/end-walls-$n$SUFFIX.json" 2>&1 | tail -1 | grep -o '"walls".*' | cut -c1-260
done
echo PROBEDONE
