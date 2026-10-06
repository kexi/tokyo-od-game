# 利用できるレシピ一覧を表示する
default:
    @just --list

# 依存パッケージをインストールする（pnpm-workspace.yaml の minimumReleaseAge が効く）
install-deps:
    pnpm install --frozen-lockfile

# 開発サーバを起動する
serve-dev:
    pnpm exec vite

# 本番ビルドを dist/ に出力する
build-app:
    pnpm exec vite build

# ビルド成果物をローカルで配信して確認する
preview-app: build-app
    pnpm exec vite preview

# 東京都オープンデータ等を取得し public/data を再生成する（ライセンス検証込み）
fetch-data:
    pnpm exec tsx scripts/fetch-data.ts

# JARTIC 交通規制情報と OSM の信号機を取得し public/data/regs・signals を再生成する
fetch-regs:
    pnpm exec tsx scripts/regulations.ts

# 車のテクスチャ（assets/car/textures）を手続き生成し直す（フォントはコミット固定の Noto Sans JP）
make-car-textures:
    uv run scripts/textures/car_textures.py

# Blender CLI で車をモデリングし public/models/car.glb を書き出す（Blender は nix の別シェル）
make-car-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/car.py -- public/models/car.glb

# 道路標識の板・支柱を Blender CLI でモデリングし public/models/signs.glb を書き出す
make-sign-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/signs.py -- public/models/signs.glb

# 歩行者を Blender CLI でモデリングし public/models/human.glb を書き出す
make-human-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/human.py -- public/models/human.glb

# 信号機（車両用・歩行者用灯器、信号柱）を Blender CLI でモデリングし public/models/signals.glb を書き出す
make-signal-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/signals.py -- public/models/signals.glb

# 高規格救急車を Blender CLI でモデリングし public/models/ambulance.glb を書き出す
make-ambulance-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/ambulance.py -- public/models/ambulance.glb

# ゲームのティザー動画 out/teaser.mp4 を撮影・編集する（開発サーバーか開発ビルドが必要）
make-teaser base="http://localhost:5173/tokyo-od-game/":
    node scripts/teaser/teaser.mjs --base {{ base }} --out out/teaser.mp4

# 英語版の紹介動画 out/teaser.en.mp4（機能を 1 つずつ、2 分以内、曲にゲームの音を重ねる）を撮影・編集する（開発サーバーか開発ビルドが必要）
make-teaser-en base="http://localhost:5173/tokyo-od-game/":
    node scripts/teaser/teaser.mjs --lang en --base {{ base }} --out out/teaser.en.mp4

# 撮影済みのティザーの音だけを作り直す（曲にゲームの音を重ね、−16 LUFS で映像と合わせる。ja は out/teaser.sfx.mp4 に書く。開発サーバーか開発ビルドが必要）
mix-teaser-sound lang="en" base="http://localhost:5173/tokyo-od-game/":
    node scripts/teaser/sound.mjs --lang {{ lang }} --base {{ base }}

# 自動運転で走らせて画面と状態を .qa/runs/ に記録する（road-qa スキルの判定用、開発サーバーが必要）
record-drive minutes="3" every="6" time="day":
    node scripts/qa/drive.mjs --minutes {{ minutes }} --every {{ every }} --time {{ time }}

# アセット管理画面（3D モデルとテクスチャのプレビューとレビュー）を開発サーバーで開く
open-assets:
    pnpm exec vite --open /tokyo-od-game/assets.html

# 最新のセッションのログを 1 行 1 イベントで末尾 n 行表示する（開発サーバーが .qa/logs に書いたもの）
show-logs n="40":
    pnpm exec tsx scripts/logs.ts tail {{ n }}

# 最新のセッションのログを追いかけて表示し続ける（再読み込みで新しいセッションに移る、Ctrl-C で終了）
follow-logs:
    pnpm exec tsx scripts/logs.ts tail 20 --follow

# セッションの warn・error だけを表示する（uncaught_error は発生箇所・span・状態・直前の行も、既定は最新）
show-errors session="":
    pnpm exec tsx scripts/logs.ts errors {{ session }}

# span とそこから起きた span の行を表示する（例: just trace-span vio-…、既定は最新のセッション）
trace-span span session="":
    pnpm exec tsx scripts/logs.ts trace {{ span }} {{ session }}

# 直近 minutes 分の全セッションの行を時刻順に表示する
show-logs-since minutes="10":
    pnpm exec tsx scripts/logs.ts since {{ minutes }}

# 2 つのセッションの warn・error の件数を比べる（既定は 1 つ前と最新、修正の確認用）
compare-logs before="" after="":
    pnpm exec tsx scripts/logs.ts compare {{ before }} {{ after }}

# セッションを同じ seed・出発地・時刻・天気で読み込み直す URL を表示する（既定は最新）
print-repro-url session="":
    pnpm exec tsx scripts/logs.ts repro {{ session }}

# ログのセッションを新しい順に件数と build 付きで一覧する
list-logs n="10":
    pnpm exec tsx scripts/logs.ts files {{ n }}

# アセット台帳（assets/manifest.yml）が全ファイル・生成スクリプト・レシピ・ライセンスと食い違っていないか検査する
check-assets:
    pnpm exec vitest run tests/assetManifest.test.ts

# 道路標識・歩行者・建物外壁・信号機・救急車・バス・トラック・バイク・警察官・ベビーカー・自転車・車内・ランドマーク・アスファルト・警察車両・東京駅丸の内駅舎のテクスチャを手続き生成し直す
make-textures:
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
    uv run scripts/textures/tokyo_station_textures.py

# 道路標識の図柄と catalog.json を作り直し、群ごとのコンタクトシートを書き出す
make-sign-textures sheet="${TMPDIR:-/tmp}/signs":
    uv run scripts/textures/sign_textures.py --sheet {{ sheet }}

# 文字や車線が変わる道路標識を 1 枚描く（例: just render-sign 327の7-A --lanes "left+through,through,right" -o out.png）
render-sign *args:
    uv run scripts/textures/sign_textures.py render {{ args }}

# 大型路線バス（ノンステップ）を Blender CLI でモデリングし public/models/bus.glb を書き出す
make-bus-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/bus.py -- public/models/bus.glb

# 10t 級 3 軸ウイング車と 8t 増トン平ボディ車を Blender CLI でモデリングし public/models/truck10t.glb・truck8t.glb を書き出す
make-truck-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/truck.py -- 10t public/models/truck10t.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/truck.py -- 8t public/models/truck8t.glb

# 250cc バイク（軽二輪）とライダーを Blender CLI でモデリングし public/models/motorbike.glb を書き出す
make-motorbike-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/motorbike.py -- public/models/motorbike.glb

# 制服警察官（活動服・夏服・交通整理の装備）を Blender CLI でモデリングし public/models/police.glb を書き出す
make-police-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police.py -- public/models/police.glb

# ベビーカー（A 形）を Blender CLI でモデリングし public/models/stroller.glb を書き出す
make-stroller-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/stroller.py -- public/models/stroller.glb

# 自転車（ママチャリ・クロスバイク）を Blender CLI でモデリングし public/models/bicycle.glb を書き出す
make-bicycle-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/bicycle.py -- public/models/bicycle.glb

# 違反を撮影する通行人のスマートフォン（ケース色違い・画面は別ノード）を Blender CLI でモデリングし public/models/smartphone.glb を書き出す
make-smartphone-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/smartphone.py -- public/models/smartphone.glb

# 白黒パトカーと覆面パトカーを Blender CLI でモデリングし public/models/police_{patrol,unmarked}.glb を書き出す
make-police-car-models:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_car.py -- patrol public/models/police_patrol.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_car.py -- unmarked public/models/police_unmarked.glb

# 白バイ（隊員乗車）と立ち姿の白バイ隊員を Blender CLI でモデリングし public/models/police_{shirobai,rider}.glb を書き出す
make-police-bike-models:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_bike.py -- shirobai public/models/police_shirobai.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_bike.py -- rider public/models/police_rider.glb

# 逃走車を追う警察ヘリ（汎用の中型双発機）と検問の資材（パイロン・コーンバー・誘導灯・立て看板・赤色灯）を Blender CLI でモデリングし public/models/police_heli.glb・checkpoint.glb を書き出す
make-pursuit-models:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/police_heli.py -- public/models/police_heli.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/checkpoint.py -- public/models/checkpoint.glb

# 車内視点用のコックピット（右ハンドル）を Blender CLI でモデリングし public/models/cockpit.glb を書き出す（先に car-model）
make-cockpit-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/cockpit.py -- public/models/cockpit.glb

# ランドマーク 3 体をライトアップ用の発光マテリアル付きで Blender CLI でモデリングし public/models と landmarks.json を書き出す
make-landmark-models:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/landmarks.py -- public/models/tokyo_tower.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/landmarks.py -- public/models/tokyo_skytree.glb
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/landmarks.py -- public/models/tokyo_station.glb

# オービス（門型・柱型）と予告看板を Blender CLI でモデリングし public/models/orbis.glb を書き出す（看板の図柄 assets/orbis/textures も作り直す）
make-orbis-model:
    uv run scripts/textures/orbis_textures.py
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/orbis.py -- public/models/orbis.glb

# 可搬式オービス（三脚の測定部・ストロボ・地面のケース）を Blender CLI でモデリングし public/models/portable_orbis.glb を書き出す
make-portable-orbis-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/portable_orbis.py -- public/models/portable_orbis.glb

# ミラーの飾り（クマのぬいぐるみ・交通安全のお守り）を Blender CLI でモデリングし public/models/mirror_charms.glb を書き出す（錦と毛並みのテクスチャ assets/charms/textures も作り直す）
make-charm-models:
    uv run scripts/textures/charm_textures.py
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/mirror_charms.py -- public/models/mirror_charms.glb

# 案内標識（108 系）の国道・都道番号・通称名・OSM の行き先と表示地名を public/data/routes・guide-places.json に書き出す（OSM は just fetch-regs のキャッシュを使う）
make-guide-data:
    pnpm exec tsx scripts/guide-signs.ts

# ナビの目的地の一覧（23 区内の駅・名所と注目の目的地）を OSM から public/data/destinations.json に書き出す（OSM は just fetch-regs のキャッシュを使う）
make-destinations:
    pnpm exec tsx scripts/destinations.ts

# 案内標識の板の文字に使う Noto Sans JP・Overpass のサブセット（woff2）を assets/signs/guide に書き出す
make-guide-fonts:
    uv run scripts/textures/guide_fonts.py

# 案内標識の支柱（片持式 F 形・路側式）・腕・標示板を Blender CLI でモデリングし public/models/guide_signs.glb を書き出す
make-guide-sign-model:
    nix develop .#blender -c blender --background --factory-startup --python scripts/blender/guide_signs.py -- public/models/guide_signs.glb

# SNS 共有カード public/og.png を作り直す（最高画質のゲーム画面で雨の夜の東京駅を車内から撮り、題字を重ねる。開発サーバーが必要）
make-og-image base="http://localhost:5173/tokyo-od-game/":
    node scripts/teaser/og.mjs --base {{ base }} --out out/og
    uv run scripts/textures/og_image.py out/og/scene.png public/og.png

# 東京駅・スカイツリー・東京タワーの写真 6 枚と、Y の炎上・違反切符・法令遵守の 3 枚を out/photos に撮り、カバーと同じ体裁で英語の作品名・見出しを入れる（最高画質・雨の夜・車内から・PNG。lang はゲームの言語、開発サーバーが必要）
make-photos lang="en" base="http://localhost:5173/tokyo-od-game/":
    node scripts/teaser/photos.mjs --base {{ base }} --lang {{ lang }} --out out/photos
    node scripts/teaser/features.mjs --base {{ base }} --lang {{ lang }} --out out/photos
    uv run scripts/textures/photo_poster.py out/photos

# ゲームのカバー画像 out/cover.png（16:9・PNG・英語）を、make-photos の東京タワーの写真から作る
make-cover-image:
    uv run scripts/textures/cover_image.py out/photos/tokyo-tower-east-raw.png out/cover.png

# 公開・審査用の画像 9 枚と英語版の動画・YouTube の説明文を out/final に番号付きでまとめる（make-photos・make-cover-image・make-teaser-en の後）
collect-final-media:
    rm -rf out/final && mkdir -p out/final
    i=1; for n in cover y-viral police-chase police-window ticket violation-review law-abiding tokyo-station tokyo-skytree-close; do \
        src=out/photos/$n.png; [ "$n" = cover ] && src=out/cover.png; \
        cp "$src" "out/final/$(printf '%02d' $i)-$n.png"; i=$((i + 1)); \
    done
    cp out/teaser.en.mp4 out/final/teaser-en.mp4
    [ -f out/youtube-description.txt ] && cp out/youtube-description.txt out/final/ || true

# 実時間で昼晴れ・夜雨のフレーム時間と描画負荷を各3回計測する（開発サーバーが必要）
measure-perf label="sample":
    node scripts/qa/perf.mjs --label {{ label }}

# シーンを固定して従来・改善後の描画CPU時間を交互に各4回計測する（開発サーバーが必要）
measure-perf-fixed:
    node scripts/qa/perf-fixed-scene.mjs

# 交通と雨が動く通常プレイで夜雨の従来・改善後を交互に各4回計測する
measure-perf-night:
    node scripts/qa/perf-fixed-scene.mjs --live --seconds 20

# 道路Workerと同期フォールバックの処理時間・フレーム停止を実データで比較する
measure-road-worker:
    node scripts/qa/perf-road-worker.mjs

# 実道路2地域で旧Worker返答とバッファ転送を交互に全比較し、読み出し・復元CPUを測る
measure-road-replies:
    node scripts/qa/perf-road-replies.mjs

# 実道路2地域でWorker返答の復元を前段と交互に全比較し、CPU区間と待機時間を測る
measure-road-reply-slices:
    node scripts/qa/perf-road-reply-slices.mjs

# 保存した実PBF/MVTを旧同期・実Worker・分割フォールバックで比較し、全座標とCPUを測る
measure-vector-tiles report:
    QA_VECTOR_INPUT={{ quote(report) }} node scripts/qa/perf-vector-tiles.mjs

# 夜雨で目撃写真・動画の証拠画像を4件作り、描画・GPU要求の内訳を測る
measure-witness-photos:
    node scripts/qa/perf-witness-photos.mjs

# 道路の分割反映・原点変更・未読込地域への移動を夜雨で最後まで計測する
measure-road-streaming:
    node scripts/qa/perf-road-streaming.mjs

# 実道路の近傍検索を旧全探索と交互比較し、結果の一致とCPU時間を計測する
measure-road-nearest:
    node scripts/qa/perf-road-nearest.mjs

# 車内の行列更新を旧処理と交互比較し、昼晴れ・夜雨の画素と行列の一致を確認する
measure-scene-matrices:
    node scripts/qa/perf-scene-matrices.mjs

# 実水域のWorker・フレーム分割フォールバックを旧処理と比較し、全画素と停止時間を検証する
measure-water-masks:
    node scripts/qa/perf-water-masks.mjs

# 実川岸2地域で水位・潮位・標高サンプルを旧処理と照合し、川岸生成CPUを計測する
measure-water-samples:
    node scripts/qa/perf-water-samples.mjs

# 不透明な外壁の影を旧処理と両backend・全窓設定で全画素比較し、生成CPUを計測する
measure-facade-shadows:
    node scripts/qa/facade-shadow-parity.mjs

# 実建物の属性解析を省く前後でGLB・頂点・ID・行列を比較し、メインスレッドの停止を計測する
measure-building-metadata:
    node scripts/qa/perf-building-metadata.mjs

# 建物のGPU解放・再表示を両backend・全窓設定で画素比較し、シェーダー再生成を測る
measure-building-gpu:
    node scripts/qa/perf-building-gpu.mjs

# 建物の表示前の非同期シェーダー準備を両backend・昼夜・全窓設定で画素比較し、同期生成を測る
measure-building-shaders:
    node scripts/qa/perf-building-shaders.mjs

# 道路インスタンスの表示前の非同期準備を両backend・昼夜で画素比較し、初回生成と中断を検証する
measure-instance-shaders:
    node scripts/qa/perf-instance-shaders.mjs

# 実建物の座標・外壁属性を固定した旧処理とWorker・分割フォールバックで比較してCPUを測る
measure-building-worker:
    node scripts/qa/perf-building-worker.mjs

# 地形の共有マスク式を両backend・昼夜・別タイル・更新・交換で全画素比較し、生成CPUを測る
measure-terrain-mask:
    node scripts/qa/terrain-mask-parity.mjs

# 初期の灰色地形・写真の到着・変更・水域・交換を両backend・昼夜で画素比較し、再生成を測る
measure-terrain-imagery:
    node scripts/qa/perf-terrain-imagery.mjs

# 実地形・実建物の物理形状とレイを旧処理・Worker・フォールバックで比較し、登録CPUを測る
measure-collider-worker:
    node scripts/qa/perf-collider-worker.mjs

# 実地形の水域三角形の結果とCPUを前段と比較し、岸・閾値・全水域も検査する
measure-terrain-water:
    node scripts/qa/perf-terrain-water.mjs

# 実地形の標高・頂点・法線・境界を固定した旧処理とWorker・分割版で比較してCPUを測る
measure-terrain-worker:
    node scripts/qa/perf-terrain-worker.mjs

# 実道路・DEM2地域で高さと座標を旧処理と照合し、境界と橋を含め照会CPUを計測する
measure-ground-queries:
    node scripts/qa/perf-ground-queries.mjs

# 実歩道2地域で補正高・描画・物理を旧処理と照合し、大きな生成区間のCPUを計測する
measure-pavement-slices:
    node scripts/qa/perf-pavement-slices.mjs

# 実建物のランドマーク除外を旧処理と照合し、三角形走査とCPUを計測する
measure-building-footprints:
    node scripts/qa/perf-building-footprints.mjs

# 実道路2地域で旧経路探索と全経路・自動運転計画を比較し、CPUを測る
measure-route-search:
    node scripts/qa/perf-route-search.mjs

# 実Workerと固定した同期版の運転経路を全比較し、メインCPUと返答待ち時間を別々に測る
measure-driver-worker:
    QA_WORKER=1 QA_REFERENCE=b8a66bace759de324efca6559a26211d206db12d node scripts/qa/perf-route-search.mjs

# 実道路2地域で新旧の信号・停止線・位相・参照の一致と道路対応付けのCPUを測る
measure-signal-network:
    node scripts/qa/perf-signal-network.mjs

# 型チェックを行う
check-types:
    pnpm exec tsc --noEmit

# リンターを実行する
lint-code:
    pnpm exec oxlint

# コードを整形する
format-code:
    pnpm exec oxfmt
    just --fmt --unstable

# 整形済みかを検査する
check-format:
    pnpm exec oxfmt --check

# ユニットテストを実行する
run-tests:
    pnpm exec vitest run

# justfile の整形とレシピコメント必須を検査する
lint-justfile:
    bash bin/lint-justfile.sh

# GitHub Actions の SHA pin と構文を検査する
lint-actions:
    pinact run --check
    actionlint

# シークレットの混入を検査する
scan-secrets:
    gitleaks git --no-banner --redact

# knowledge/ の OKF 適合と tag 語彙を検査する
lint-knowledge:
    bash bin/lint-knowledge.sh

# CI と同じ検査を一括で実行する
check-all: check-types lint-code check-format run-tests lint-justfile lint-actions lint-knowledge

# 英語・中国語のsanoTTS資産を固定コミットとSHA-256で照合して配置する
fetch-sanotts:
    pnpm exec tsx scripts/fetch-sanotts.ts

# 新規Chromeプロファイルで3言語の音声初期化・合成・WebAudio再生を実測する
measure-tts:
    node scripts/qa/perf-tts.mjs
