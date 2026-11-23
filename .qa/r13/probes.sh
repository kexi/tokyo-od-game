#!/bin/bash
# 使い方: probes.sh <ラベル>  → .cache/expressway-area/<ラベル> に探りを全部掛け、.qa/r13/p-<ラベル>-*.{json,log} に置く。
# Node の読むだけの探りなので鍵は取らない（指示書 最初に守る決まり）。
set -uo pipefail
WT=/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02
cd "$WT" || exit 92
label="$1"
D=".cache/expressway-area/$label"
P=".qa/r13/p-$label"
probe() {
    local name="$1"
    shift
    nix develop --command just "$@" >"$P-$name.log" 2>&1
    echo "$label $name code=$?"
}
probe lanes check-expressway-lanes "$D" "--cases $P-lanes.json"
probe holes check-hole-lanes "$D" "--cases $P-holes.json"
probe feet check-expressway-feet "$D" "--cache-only"
probe terrain check-expressway-terrain "$D"
probe same check-same-road-pieces "$D"
probe bands measure-street-bands "$D" "--out $P-bands.json"
