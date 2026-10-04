# 利用できるレシピ一覧を表示する
default:
    @just --list

# 依存パッケージをインストールする（pnpm-workspace.yaml の minimumReleaseAge が効く）
install:
    pnpm install --frozen-lockfile

# 開発サーバを起動する
dev:
    pnpm exec vite

# 本番ビルドを dist/ に出力する
build:
    pnpm exec vite build

# ビルド成果物をローカルで配信して確認する
preview: build
    pnpm exec vite preview

# 東京都オープンデータ等を取得し public/data を再生成する（ライセンス検証込み）
data:
    node scripts/fetch-data.ts

# JARTIC 交通規制情報と OSM の信号機を取得し public/data/regs・signals を再生成する
regs:
    node scripts/regulations.ts

# 車のテクスチャ（assets/car/textures）を手続き生成し直す（フォントはコミット固定の Noto Sans JP）
car-textures:
    uv run scripts/textures/car_textures.py

# Blender CLI で車をモデリングし public/models/car.glb を書き出す（Blender は nix の別シェル）
car-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/car.py -- public/models/car.glb

# 道路標識の板・支柱を Blender CLI でモデリングし public/models/signs.glb を書き出す
sign-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/signs.py -- public/models/signs.glb

# 歩行者を Blender CLI でモデリングし public/models/human.glb を書き出す
human-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/human.py -- public/models/human.glb

# 信号機（車両用・歩行者用灯器、信号柱）を Blender CLI でモデリングし public/models/signals.glb を書き出す
signal-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/signals.py -- public/models/signals.glb

# 道路標識・歩行者・建物外壁のテクスチャを手続き生成し直す
textures:
    uv run scripts/textures/sign_textures.py
    uv run scripts/textures/human_textures.py
    uv run scripts/textures/building_textures.py
    uv run scripts/textures/signal_textures.py

# SNS 共有カード public/og.jpg を作り直す（自作の車・標識だけを Blender で描き、題字を重ねる）
og:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/og.py -- "${TMPDIR:-/tmp}/tokyo-od-og-scene.png"
    uv run scripts/textures/og_image.py "${TMPDIR:-/tmp}/tokyo-od-og-scene.png" public/og.jpg

# 型チェックを行う
typecheck:
    pnpm exec tsc --noEmit

# リンターを実行する
lint:
    pnpm exec oxlint

# コードを整形する
fmt:
    pnpm exec oxfmt
    just --fmt --unstable

# 整形済みかを検査する
fmt-check:
    pnpm exec oxfmt --check

# ユニットテストを実行する
test:
    pnpm exec vitest run

# justfile の整形とレシピコメント必須を検査する
lint-justfile:
    bash bin/lint-justfile.sh

# GitHub Actions の SHA pin と構文を検査する
lint-actions:
    pinact run --check
    actionlint

# シークレットの混入を検査する
secrets:
    gitleaks git --no-banner --redact

# knowledge/ の OKF 適合と tag 語彙を検査する
lint-knowledge:
    bash bin/lint-knowledge.sh

# CI と同じ検査を一括で実行する
check: typecheck lint fmt-check test lint-justfile lint-actions lint-knowledge
