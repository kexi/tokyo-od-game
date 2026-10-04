#!/bin/bash
# sanoTTS-jp（日本語 TTS、C99）を Emscripten で WASM 化し、モデル重み・辞書・ライセンス文書と
# 一緒に public/tts/ へ配置する。成果物はコミットするので CI に emscripten は要らない。
#
# Why not npm / CDN 配布物を使う: sanoTTS-jp は npm 配布が無く、重みは独自ライセンス
#   （LicenseRef-sanoTTS-jp-Model-1.0）で (A) ブロック・Apache-2.0 全文の同梱が義務。
#   タグ固定＋SHA256 検証でビルドを再現可能にし、同梱物をレビューできる形にする。
set -euo pipefail

TAG="v1.2.0"
REPO="ayutaz/sanoTTS-jp"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/tts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet --depth 1 --branch "$TAG" "https://github.com/$REPO.git" "$WORK/src"
(cd "$WORK/src" && EM_CACHE="$WORK/emcache" nix shell nixpkgs#emscripten -c bash web/build.sh)

gh release download "$TAG" -R "$REPO" -D "$WORK/rel" \
    -p saanotts-jp-v4-int8.bin -p k1-dict-438750.bin -p SHA256SUMS.txt \
    -p LICENSE-MODEL.md -p LICENSE-APACHE-2.0.txt -p 'NOTICE*.txt'
(cd "$WORK/rel" && shasum -a 256 --ignore-missing -c SHA256SUMS.txt)

mkdir -p "$OUT"
cp "$WORK/src/web/dist/saan_web_w8a32.mjs" "$WORK/src/web/dist/saan_web_w8a32.wasm" "$OUT/"
cp "$WORK/rel/saanotts-jp-v4-int8.bin" "$OUT/student_i8.bin"
gzip -9 -n -c "$WORK/rel/k1-dict-438750.bin" >"$OUT/k1_dict.bin.gz"
cp "$WORK/rel/LICENSE-MODEL.md" "$WORK/rel/LICENSE-APACHE-2.0.txt" "$WORK/rel"/NOTICE*.txt "$OUT/"
echo "$TAG $(git -C "$WORK/src" rev-parse HEAD)" >"$OUT/VERSION"
ls -la "$OUT"
