#!/bin/bash
# R1-1b 追記 4 D9: the walls that gave way beyond the three foreseen, their partners' ends (r1b_pair.mts), into .qa/r1b/yields.txt.
cd "$(dirname "$0")/../.." || exit 1
S=.cache/expressway-area/r1b-g1-pruned
run() { ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_pair.mts "$@" 2>&1 | grep -v '^{"ts' | grep -E "^wall|partnersAt|endAhead|partner chunk|^u "; }
{
    echo "### 203832846:0 end / 211286459"
    run "$S" 203832846:0 end 211286459
    echo "### 23704469:0 start / 27155730"
    run "$S" 23704469:0 start 27155730
    echo "### 45392984:2 end / 24636451"
    run "$S" 45392984:2 end 24636451
    echo "### 806097479:0 end / 331692344"
    run "$S" 806097479:0 end 331692344
    echo "### 24334770:0 start / 24372965 (G5)"
    run .cache/expressway-area/r1b-g5 24334770:0 start 24372965
    echo "### 203832847:0 start / 756785283 (G3)"
    run .cache/expressway-area/r1b-g3 203832847:0 start 756785283 4.45 4.5 4.55 4.6 4.65 4.7
} >.qa/r1b/yields.txt
echo YIELDSDONE
