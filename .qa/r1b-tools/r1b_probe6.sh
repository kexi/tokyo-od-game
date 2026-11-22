#!/usr/bin/env bash
# The end-wall probe over the six folders (and with --raise 0.1 over default and G3), summary lines.
cd /Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-af5772ac5313c8ce5 || exit 1
p() { ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs scripts/expresswayEndWalls.ts "$@" 2>&1 | tail -1 | grep -o '"walls".*' | cut -c1-200; }
for d in public/data/expressway .cache/expressway-area/r1b-g3 .cache/expressway-area/r1b-g4 .cache/expressway-area/r1b-g5 .cache/expressway-area/r1b-g1-pruned .cache/expressway-area/r1b-g2-all; do
  echo "== $d"; p "$d"
done
for d in public/data/expressway .cache/expressway-area/r1b-g3; do
  n=$(basename "$d"); echo "== raise $d"; p "$d" --raise 0.1 --out ".qa/expressway/end-walls-$n-raise.json"
done
echo PROBEDONE
