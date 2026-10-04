#!/usr/bin/env bash
# Wakes the Claude session when アセット管理 (assets.html) submits a review into .review/pending/.
# Registered as an async hook with asyncRewake (SessionStart and Stop): exit 2 sends stderr to
# Claude as a system reminder. One watcher at a time (PID lock); each review is announced once.
set -euo pipefail

input="$(cat || true)"
# Stop hooks must not loop: nothing to do while Claude is continuing because of a Stop hook.
if [[ "$input" == *'"stop_hook_active":true'* ]]; then
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$PWD}/.review"
mkdir -p "$root/pending"
lock="$root/.watcher.pid"
if [[ -f "$lock" ]] && kill -0 "$(cat "$lock")" 2>/dev/null; then
  exit 0
fi
echo "$$" >"$lock"
trap 'rm -f "$lock"' EXIT
notified="$root/.notified"
touch "$notified"

while true; do
  for review in "$root"/pending/*.json; do
    [[ -e "$review" ]] || continue
    name="$(basename "$review")"
    if ! grep -qxF "$name" "$notified"; then
      echo "$name" >>"$notified"
      echo "アセット管理からレビューが届きました: .review/pending/${name}（要約: .review/pending/${name%.json}.md）。asset-review スキルの手順で対応してください。" >&2
      exit 2
    fi
  done
  sleep 3
done
