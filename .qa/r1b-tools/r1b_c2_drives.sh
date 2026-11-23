#!/bin/bash
# shibakoen-shiodome three times after R1-1b 追記 3 C2 (each under its own lock), on this worktree's :5330.
cd "$(dirname "$0")" || exit 1
for i in 1 2 3; do
    bash ./r1b_drive_wait2.sh "c2-$i" shibakoen-shiodome 5330 0
done
echo DRIVESDONE
