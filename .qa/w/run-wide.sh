#!/bin/bash
# Runs countWide.mts in 4 shards under the machine lock (qa-take.sh W), merges them, gives the lock back.
# The lock is returned even when a shard fails.
set -euo pipefail
SCRATCH="/private/tmp/claude-501/-Users-kei-ghq-github-com-kexi-tokyo-od-game/b5023d79-0cd6-4ccb-b30d-ed8c9d56f16c/scratchpad"
cd "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a5195e3853739145f"
bash "$SCRATCH/qa-take.sh" W j3-wide
echo "lock taken $(date -u +%FT%TZ)"
trap 'bash "$SCRATCH/qa-give.sh" W; echo "lock given $(date -u +%FT%TZ)"' EXIT
pids=()
for k in 0 1 2 3; do
    pnpm exec tsx .qa/w/countWide.mts public/data/expressway .cache/gsi-vector ".qa/w/wide-$k.json" "$k" 4 > ".qa/w/wide-$k.log" 2>&1 &
    pids+=("$!")
done
for pid in "${pids[@]}"; do
    wait "$pid" || echo "shard $pid failed"
done
pnpm exec tsx .qa/w/mergeWide.mts .qa/w/wide.json .qa/w/wide-0.json .qa/w/wide-1.json .qa/w/wide-2.json .qa/w/wide-3.json
echo "finished $(date -u +%FT%TZ)"
