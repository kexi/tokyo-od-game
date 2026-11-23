#!/bin/bash
# R1-1b 追記 5 E2: the fixed open check (this worktree's scripts/expresswayEndWalls.ts) over 110def4's
# deck (.qa/r1b-110d), ship: it must call 45392984:2 end and 806097479:0 end open. Into .qa/r1b/net110.txt.
W="$(cd "$(dirname "$0")/../.." && pwd)"
E="$W/.qa/r1b-110d"
[[ -e "$E/node_modules" ]] || ln -s "$W/node_modules" "$E/node_modules"
cp "$W/scripts/expresswayEndWalls.ts" "$E/scripts/expresswayEndWalls.ts"
cd "$E" || exit 1
./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs scripts/expresswayEndWalls.ts "$W/.cache/expressway-area/r1b-g1-pruned" --out "$W/.qa/r1b/net110-ship.json" 2>&1 | tail -1 | grep -o '"walls".*' | cut -c1-200 >"$W/.qa/r1b/net110.txt"
git -C "$E" checkout -q -- scripts/expresswayEndWalls.ts
python3 -I -c "
import json
d = json.load(open('$W/.qa/r1b/net110-ship.json'))
for w in d['walls']:
    if w['misses'] > 0:
        print(w['chunk'], w['end'], 'misses', w['misses'], 'rays', w['rays'], 'openM', w['openM'], 'yieldedM', w.get('yieldedM'))
" >>"$W/.qa/r1b/net110.txt"
echo NETDONE
