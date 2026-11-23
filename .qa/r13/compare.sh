#!/bin/bash
# 使い方: compare.sh <all のラベル> <ラベル>  → 高さとチャンクの比べを .qa/r13/cmp-<ラベル>-{heights,chunks}.log に。
set -uo pipefail
cd /Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02 || exit 92
base="$1"
label="$2"
nix develop --command just compare-expressway-heights "$base" "$label" "--report .qa/expressway/$label.report.json" >".qa/r13/cmp-$label-heights.log" 2>&1
echo "$label heights code=$?"
nix develop --command just compare-expressway-chunks ".cache/expressway-area/$base" ".cache/expressway-area/$label" >".qa/r13/cmp-$label-chunks.log" 2>&1
echo "$label chunks code=$?"
node .qa/r13/classify.mjs "$base" "$label" >".qa/r13/cls-$label.json" 2>".qa/r13/cls-$label.err"
echo "$label classify code=$?"
