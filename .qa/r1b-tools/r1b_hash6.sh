#!/bin/bash
# r1b_hash.mts over the six folders, in this worktree and in the ea62e55 one (.qa/r1b-ea62), into .qa/r1b/hash-<side>-<folder>.json.
W="$(cd "$(dirname "$0")/../.." && pwd)"
E="$W/.qa/r1b-ea62"
mkdir -p "$E/.qa/r1b-tools" "$W/.qa/r1b"
cp "$W/.qa/r1b-tools/r1b_hash.mts" "$E/.qa/r1b-tools/r1b_hash.mts"
for d in public/data/expressway .cache/expressway-area/r1b-g3 .cache/expressway-area/r1b-g4 .cache/expressway-area/r1b-g5 .cache/expressway-area/r1b-g1-pruned .cache/expressway-area/r1b-g2-all; do
    n=$(basename "$d")
    for side in now ea62; do
        root=$W
        [[ "$side" == ea62 ]] && root=$E
        (cd "$root" && ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_hash.mts "$W/$d" "$W/.qa/r1b/hash-$side-$n.json" 2>&1 | grep -v '^{"ts' | tail -3)
    done
    echo "== $n"
done
echo HASHDONE
