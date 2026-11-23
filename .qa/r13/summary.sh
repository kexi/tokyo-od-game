#!/bin/bash
# 使い方: summary.sh <ラベル>  → 探りのログの最後のイベント行を短く出す。
set -uo pipefail
cd /Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02/.qa/r13 || exit 92
label="$1"
for f in p-"$label"-*.log; do
    echo "== $f"
    grep -o '"event":"[a-z_]*".*' "$f" | tail -1 | sed -E 's/"(list|byRun|chunks|top|cases|rows)":\[[^]]*\]/"\1":[…]/g' | cut -c1-700
done
