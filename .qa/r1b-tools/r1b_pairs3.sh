#!/bin/bash
# R1-1b 追記 3 C4: the three pairs' facts (r1b_pair.mts) in G3, into .qa/r1b/pairs3.txt.
cd "$(dirname "$0")/../.." || exit 1
T=.qa/r1b-tools/r1b_pair.mts
G=.cache/expressway-area/r1b-g3
run() { ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs "$T" "$@" 2>&1 | grep -v '^{"ts'; }
{
    echo "### 760596454:0 start / 26956960"
    run "$G" 760596454:0 start 26956960 -2.06 -1.81
    echo "### 203832847:0 start / 756785283"
    run "$G" 203832847:0 start 756785283 4.63 4.38
    echo "### 24040126:4 end / 165913323"
    run "$G" 24040126:4 end 165913323 -4.12 -3.87 -3.62 -3.37
    echo "### 165913323:0 start / 24040126"
    run "$G" 165913323:0 start 24040126 -4.12 -3.87 -3.62
    echo "### 45068169:0 start / 45068170 (default)"
    run public/data/expressway 45068169:0 start 45068170 -4.12 -3.87 -3.62 -3.37
} >.qa/r1b/pairs3.txt
echo PAIRSDONE
