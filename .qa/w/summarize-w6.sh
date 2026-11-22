#!/bin/bash
# Prints the E3 lists of a countW5 output (w6-*.json): the L-only segments with each sense's way,
# 659's street under L, the doubled overlaps of 10 m or more, the entry-less nodes and same-width cuts.
set -euo pipefail
f="$1"
jq -c '.summary' "$f"
echo "== L-only"
jq -c '.e3.lOnly[] | {seg, width, length, L: "\(.L.lanes)/\(.L.median)/\(.L.carriageway) \(.L.basis)", samples: [.samples[] | [.senses[] | (if .way then "\(.sense):side \(.way.side) ow\(.way.oneway) f\(.way.forward) <- \([.owners[] | "\(.rel) w\(.width) \(.d)"] | join(", "))" else "\(.sense):none" end)]]}' "$f"
echo "== 659 under L"
jq -c '.e3.chain659L.segments[]? | [.seg, .len, .returned, .lanes, .median, .carriageway]' "$f"
echo "== doubled overlaps (10 m or more)"
jq -c '.lists["L:doubled"][] | select(.cells >= 10) | {cells, nets: (.nets | length), segs: [.segs[] | "\(.seg) w\(.width) \(.len)m \(.ans)"]}' "$f"
echo "== entry-less"
jq -c '.e3.lEntryless[] | {node, seg, width, around: [.around[] | "\(.seg) w\(.width) \(.source) eff\(.eff) leaves\(.leaves)\(if .straight then " straight" else "" end)"]}' "$f"
echo "== same-width cuts"
jq -c '.e3.lCutsSame[] | {side, node, seg, width, partner, around: [.around[] | "\(.seg) w\(.width) eff\(.eff) leaves\(.leaves)\(if .straight then " straight" else "" end)"]}' "$f"
