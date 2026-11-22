#!/usr/bin/env bash
# The two QA worktrees again (the first were emptied by the /tmp clean-up): node_modules and the
# fetched public data linked from this worktree; r1b-qa serves G3's expressway data (never
# committed), r1b-main the default.
set -euo pipefail
S=/private/tmp/claude-501/-Users-kei-ghq-github-com-kexi-tokyo-od-game/b5023d79-0cd6-4ccb-b30d-ed8c9d56f16c/scratchpad
W=/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-af5772ac5313c8ce5
for wt in "$S/r1b-qa" "$S/r1b-main"; do
  [ -e "$wt/node_modules" ] || ln -s "$W/node_modules" "$wt/node_modules"
  for f in "$W"/public/data/*; do
    name=$(basename "$f")
    [ "$name" = expressway ] && continue
    [ -e "$wt/public/data/$name" ] || ln -s "$f" "$wt/public/data/$name"
  done
done
rm -rf "$S/r1b-qa/public/data/expressway"
cp -R "$W/.cache/expressway-area/r1b-g3" "$S/r1b-qa/public/data/expressway"
echo ok
