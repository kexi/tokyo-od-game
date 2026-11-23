#!/bin/bash
# R1-1b 追記 3 C2: the nine ends of 追記 1 A1 again (G3), what is over each wall's foot
# (r1b_over.mts) and each end's partners, into .qa/r1b/nine.txt.
cd "$(dirname "$0")/../.." || exit 1
G=.cache/expressway-area/r1b-g3
{
    for e in 203832849:0/end 45068170:0/end 203832847:0/start 203832852:35/end 80581134:0/end 1328383029:0/start 760596454:0/start 5213544:0/start 165913323:0/start; do
        echo "### $e"
        ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_over.mts "$G" "${e%/*}" "${e#*/}" 2>&1 | grep -v '^{"ts'
    done
} >.qa/r1b/nine.txt
echo NINEDONE
