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

# 高規格救急車を Blender CLI でモデリングし public/models/ambulance.glb を書き出す
ambulance-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/ambulance.py -- public/models/ambulance.glb

# ゲームのティザー動画 out/teaser.mp4 を撮影・編集する（開発サーバーか開発ビルドが必要）
teaser base="http://localhost:5173/tokyo-od-game/":
    node scripts/teaser/teaser.mjs --base {{ base }} --out out/teaser.mp4

# 自動運転で走らせて画面と状態を .qa/runs/ に記録する（road-qa スキルの判定用、開発サーバーが必要）
qa-drive minutes="3" every="6" time="day":
    node scripts/qa/drive.mjs --minutes {{ minutes }} --every {{ every }} --time {{ time }}

# アセット管理画面（3D モデルとテクスチャのプレビューとレビュー）を開発サーバーで開く
assets:
    pnpm exec vite --open /tokyo-od-game/assets.html

# 道路標識・歩行者・建物外壁・信号機・救急車・バス・トラック・バイク・警察官・ベビーカー・自転車・車内・ランドマーク・アスファルト・警察車両のテクスチャを手続き生成し直す
textures:
    uv run scripts/textures/sign_textures.py
    uv run scripts/textures/human_textures.py
    uv run scripts/textures/building_textures.py
    uv run scripts/textures/signal_textures.py
    uv run scripts/textures/ambulance_textures.py
    uv run scripts/textures/bus_textures.py
    uv run scripts/textures/truck_textures.py
    uv run scripts/textures/motorbike_textures.py
    uv run scripts/textures/police_textures.py
    uv run scripts/textures/stroller_textures.py
    uv run scripts/textures/bicycle_textures.py
    uv run scripts/textures/cockpit_textures.py
    uv run scripts/textures/landmark_textures.py
    uv run scripts/textures/asphalt_textures.py
    uv run scripts/textures/police_vehicle_textures.py

# 道路標識の図柄と catalog.json を作り直し、群ごとのコンタクトシートを書き出す
sign-textures sheet="${TMPDIR:-/tmp}/signs":
    uv run scripts/textures/sign_textures.py --sheet {{ sheet }}

# 文字や車線が変わる道路標識を 1 枚描く（例: just sign-render 327の7-A --lanes "left+through,through,right" -o out.png）
sign-render *args:
    uv run scripts/textures/sign_textures.py render {{ args }}

# 大型路線バス（ノンステップ）を Blender CLI でモデリングし public/models/bus.glb を書き出す
bus-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/bus.py -- public/models/bus.glb

# 10t 級 3 軸ウイング車と 8t 増トン平ボディ車を Blender CLI でモデリングし public/models/truck10t.glb・truck8t.glb を書き出す
truck-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/truck.py -- 10t public/models/truck10t.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/truck.py -- 8t public/models/truck8t.glb

# 250cc バイク（軽二輪）とライダーを Blender CLI でモデリングし public/models/motorbike.glb を書き出す
motorbike-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/motorbike.py -- public/models/motorbike.glb

# 制服警察官（活動服・夏服・交通整理の装備）を Blender CLI でモデリングし public/models/police.glb を書き出す
police-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police.py -- public/models/police.glb

# ベビーカー（A 形）を Blender CLI でモデリングし public/models/stroller.glb を書き出す
stroller-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/stroller.py -- public/models/stroller.glb

# 自転車（ママチャリ・クロスバイク）を Blender CLI でモデリングし public/models/bicycle.glb を書き出す
bicycle-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/bicycle.py -- public/models/bicycle.glb

# 違反を撮影する通行人のスマートフォン（ケース色違い・画面は別ノード）を Blender CLI でモデリングし public/models/smartphone.glb を書き出す
smartphone-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/smartphone.py -- public/models/smartphone.glb

# 白黒パトカーと覆面パトカーを Blender CLI でモデリングし public/models/police_{patrol,unmarked}.glb を書き出す
police-car-models:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_car.py -- patrol public/models/police_patrol.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_car.py -- unmarked public/models/police_unmarked.glb

# 白バイ（隊員乗車）と立ち姿の白バイ隊員を Blender CLI でモデリングし public/models/police_{shirobai,rider}.glb を書き出す
police-bike-models:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_bike.py -- shirobai public/models/police_shirobai.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_bike.py -- rider public/models/police_rider.glb

# 車内視点用のコックピット（右ハンドル）を Blender CLI でモデリングし public/models/cockpit.glb を書き出す（先に car-model）
cockpit-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/cockpit.py -- public/models/cockpit.glb

# ランドマーク 3 体をライトアップ用の発光マテリアル付きで Blender CLI でモデリングし public/models と landmarks.json を書き出す
landmark-models:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/landmarks.py -- public/models/tokyo_tower.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/landmarks.py -- public/models/tokyo_skytree.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/landmarks.py -- public/models/tokyo_station.glb

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
