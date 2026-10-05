#!/bin/bash
# knowledge/ の OKF v0.2 最低限の適合検証と tag 統制語彙の検証。
# - 予約ファイル（index.md / log.md）以外の全 .md が非空の type を持つこと（OKF v0.2 §11）
# - tags が knowledge/tags.yml に説明付きで定義済みであること（ローカル規約）
# - sources に挙げたテスト（tests/*.test.ts）が実在すること（ローカル規約）
# Why not full schema validation: 仕様は「未知のキー・未知の type を拒否するな」と定めており、
#   厳格なスキーマ検証は仕様の意図に反する。

set -uo pipefail

TAGS_FILE="knowledge/tags.yml"

if ! command -v yq >/dev/null 2>&1; then
    echo "Skipped: yq not installed"
    exit 0
fi

failed=0
known=$(yq eval 'keys | .[]' "$TAGS_FILE")

while IFS= read -r file; do
    case "$(basename "$file")" in
    index.md | log.md) continue ;;
    esac
    if ! yq --front-matter=extract eval '.type // ""' "$file" 2>/dev/null | grep -qv '^$'; then
        echo "$file: 非空の type が必要（OKF v0.2 §11）"
        failed=1
    fi
    while IFS= read -r tag; do
        [[ -z "$tag" ]] && continue
        if ! grep -qx "$tag" <<<"$known"; then
            echo "$file: 未定義の tag \"$tag\"（$TAGS_FILE に説明付きで追加してから使う）"
            failed=1
        fi
    done < <(yq --front-matter=extract eval '.tags[]' "$file" 2>/dev/null)
    # sources が根拠に挙げるテスト（tests/*.test.ts）が実在すること。改名・削除で根拠が消えた文書を見つける。
    # Why not src/ 等も: three.js のリポジトリ内のパス（src/nodes/…）を出典に書く文書があり、区別できない。
    while IFS= read -r test; do
        [[ -z "$test" ]] && continue
        if [[ ! -f "$test" ]]; then
            echo "$file: sources のテスト $test が無い（改名・削除なら文書を直す）"
            failed=1
        fi
    done < <(yq --front-matter=extract eval '.sources[].resource' "$file" 2>/dev/null | grep -oE 'tests/[A-Za-z0-9_-]+\.test\.ts' | sort -u)
done < <(find knowledge -name '*.md')

exit "$failed"
