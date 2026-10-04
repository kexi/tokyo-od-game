#!/bin/bash

# justfile の整形チェックと「説明コメント無しレシピ」の検出を行う。
# Why not just --fmt --check のみ: フォーマッタはコメントの有無を検査しないため、
#   レシピ行の直前が `#` コメントであることを自前で検査する（rules.yml の
#   justfile ルール「コメント無しレシピは許可しない」の機械検証）。

set -uo pipefail

failed=0

if command -v just >/dev/null 2>&1; then
    just --fmt --check --unstable || {
        echo "justfile is not formatted (run: just --fmt --unstable)"
        failed=1
    }
else
    echo "Skipped: just not installed (format check)"
fi

# レシピ行 = 行頭から始まる `name ...:` 形式（変数代入 `:=` とインデント行は除外）。
prev=""
lineno=0
while IFS= read -r line || [[ -n "$line" ]]; do
    lineno=$((lineno + 1))
    is_recipe=0
    if [[ "$line" =~ ^[A-Za-z_@][^:]*:([^=]|$) ]]; then
        is_recipe=1
    fi
    if [[ "$is_recipe" -eq 1 && ! "$prev" =~ ^# ]]; then
        echo "justfile:$lineno: recipe requires a preceding comment: $line"
        failed=1
    fi
    prev="$line"
done <justfile

exit "$failed"
