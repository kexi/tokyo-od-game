---
type: Metric
title: 地形の写真が届いてもシェーダー構成を変えない
description: 初期色・写真到着・解像度/スタイル・水域・原点・タイル交換の両backend昼夜14745600画素値が一致。固定比較の地形生成3→1回、実ワープ2/1→0回。GCとコライダー等による66.7msは残る。
tags: [terrain, rendering, water, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T05:26:33Z }
verified:
  - { by: process:1074-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T05:18:32Z }
  - {
      by: process:chrome154-webgpu-webgl2-day-night-14745600-pixel-values-and-shader-builds,
      at: 2026-10-06T05:19:34Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenarios-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T05:21:38Z,
    }
  - {
      by: process:chrome154-clock-mapped-warp-cpu-profile-source-hashes-and-terminal-logs,
      at: 2026-10-06T05:24:27Z,
    }
sources:
  - id: code
    resource: ../src/world/terrainMaterial.ts, ../src/world/terrain.ts
    title: 初期の白い参照テクスチャと同じ構成での写真・マスク交換
  - id: material
    resource: https://threejs.org/docs/pages/Material.html
    title: needsUpdateと材質の再コンパイル
  - id: native
    resource: three 0.186.1 の src/renderers/common/RenderObject.js, src/materials/nodes/NodeMaterial.js, src/nodes/accessors/TextureNode.js
    title: 材質・ノード・テクスチャサンプラーの実キャッシュキー
  - id: before
    resource: ../.qa/perf/2026-10-06T04-59-31-646Z-streaming/report.json, ../.qa/perf/2026-10-06T04-59-31-646Z-streaming/frame-stacks.json
    title: 前段の地形生成21.7ms/9.8msと、最長のバス材質を区別した記録（ローカル保存）
  - id: component
    resource: ../scripts/qa/terrain-imagery-parity.html, ../scripts/qa/perf-terrain-imagery.mjs, ../.qa/perf/2026-10-06T05-18-32-805Z-terrain-imagery/report.json
    title: 8枚の地形・9状態・両backend・昼夜の全画素と生成回数（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T05-19-34-410Z-streaming/report.json, ../.qa/perf/2026-10-06T05-19-34-410Z-streaming/night-rain.png
    title: Profilerなしの夜雨8場面・ソース30ファイル・目視した画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T05-21-58-334Z-streaming/report.json, ../.qa/perf/2026-10-06T05-21-58-334Z-streaming/frame-stacks.json, ../.qa/perf/2026-10-06T05-21-58-334Z-streaming/coldWarp.cpuprofile, ../.qa/perf/2026-10-06T05-21-58-334Z-streaming/latestWarp.cpuprofile
    title: 時計対応付きの夜雨ワープCPUと地形生成0回（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/d1598459-8198-47e8-8d49-bebc2aadca34.jsonl, ../.qa/logs/2026-10-06/d4646a74-8818-4b4d-8358-2136403023c5.jsonl
    title: 通常8場面とProfilerの端末ログ（ローカル保存）
  - id: tests
    resource: ../tests/terrainMaterial.test.ts, ../tests/terrainWorker.test.ts
    title: 共有仮テクスチャの所有権・更新中のprogram key・画像前後の水域・既存の高さと原点変更の検証
  - id: previous
    resource: building-shader-performance.md, terrain-mask-performance.md
    title: 外壁の初回生成と水域マスク式の共有を済ませた前段
---

# 写真の到着による構成変更をなくす

前段の新地域50.1ms区間には地形の同期生成11.3/10.4ms、連続ワープ50.1ms区間には9.8msが載っていた。最長66.7msの連続ワープでは別のDest（バス）の材質9.9msが載っており、その区間を地形だけの問題とは扱わない。[^before]

地形は最初mapなし・maskNodeなしで灰色を描き、写真が届くとmap・共有maskNodeを追加してneedsUpdateを立てていた。これでシェーダー構成が変わる。公式APIもneedsUpdateを再コンパイルの指示としている。実three 0.186.1のキーはmap等の有無と、WebGPUのサンプラー設定を含み、テクスチャIDそのものは使わない。[^material] [^native] [^code]

初期から白い1画素のsRGB mapと、乾いた1画素の水域マスクを与える。初期色0x8a8f86と物理設定を保ち、白との乗算で同じ灰色を描く。写真が届くとmap・color・マスク参照の値を差し替え、材質versionを上げない。白のfilter・mipmap・flipY・colorSpaceは写真と合わせる。水域のマスクは画像が付いた後だけ現在のものへ差し替え、画像前に川の部分の灰色を切り抜かない。[^code] [^tests]

白い1画素は読み込み待ちの全タイルで共有するため、タイルの破棄・写真交換でdisposeしない。各タイルが所有する写真は従来どおり交換・破棄時に解放する。頂点・高さ・法線・コライダーの計算は変更していない。[^code] [^tests]

# 両backend・昼夜・9状態の比較

M2 Max・Chrome154.0.8037.97（revision b510e9d7cd3a2fbd78d0ddc42234103206c5f78d）、320×320、antialiasなし、8枚の地形・太陽・影。WebGPU/WebGL2×昼夜の4条件で、前段の初期mapなし・写真時needsUpdateありの処理と、最終関数を交互の順番で比較する。9状態は灰色・画像前の水域待ち・最初の写真・解像度変更・スタイル変更・水域交換・原点相当の移動・タイル交換直後・交換タイルへの写真。[^component]

36画像、**14745600画素値が完全一致**。画像と水域の変更で実際に見た目が変わることも検査し、変化しない実装が比較をすり抜けないようにした。画像前の水域の保持は本番Terrain.applyWaterと準備済みの本番地形で単体テストし、この固定描画では両処理の乾いた状態を比較している。[^component] [^tests]

| 条件     | 前段の生成 / 同期CPU | 最終の生成 / 同期CPU | 最終の画像到着以後の追加生成 |
| -------- | -------------------: | -------------------: | ---------------------------: |
| WebGPU昼 |         3回 / 22.4ms |          1回 / 4.7ms |                          0回 |
| WebGPU夜 |         3回 / 13.8ms |          1回 / 5.5ms |                          0回 |
| WebGL2昼 |         3回 / 19.5ms |          1回 / 6.3ms |                          0回 |
| WebGL2夜 |         3回 / 13.1ms |          1回 / 7.2ms |                          0回 |

前段の3回は最初の灰色・最初の写真・灰色のタイル交換。最終は初期に1回だけで、写真・マスク・サイズ変更と交換時にも再生成しなかった。CPUは同期NodeBuilder.buildだけでGPUの全時間ではなく、初回JIT等の変動もある。全ゲームの改善率にしない。初期の灰色でも写真用の構成を使うので、初期のシェーダー生成自体を非同期化した変更ではない。[^component]

# 実ゲームでの夜雨計測

WebGPU・ultra・rooms・1280×800・DPR1・夜雨・seed20261006。計測中に編集・ビルド・テストを同時実行していない。地形の色・写真・建物・夜雨・ナビ・Yを画面で目視した。変わらない道路125メッシュ・駐車16台を保持し、原点変更中の旧フレーム保持と連続ワープの最後の地点への着地が通った。ソース30ファイルは最終作業ツリーとハッシュ一致。[^normal]

| Profilerなしの場面   | 最長rAF間隔 | 50ms超 |
| -------------------- | ----------: | -----: |
| 通常1                |      33.4ms |    0回 |
| 通常更新1            |      33.4ms |    0回 |
| 通常2                |      33.4ms |    0回 |
| 通常更新2            |      33.5ms |    0回 |
| 通常更新3            |      33.4ms |    0回 |
| 原点変更             |      50.0ms |    0回 |
| 未読込の吾妻橋へ移動 |      50.1ms |    2回 |
| 連続ワープ           |      66.6ms |    3回 |

全8場面の地形の同期生成は0回。例外・Worker・道路・地形・ログスキーマの失敗も0件。端末3387行はinfo3386・warn1。warnは開始時のamedas_fetch_failed（天気情報の外部fetch失敗）で、計測はURLで夜雨を固定した。ネットワーク警告を0件と報告しない。[^normal] [^logs]

最終Profilerは新地域66.7ms・50ms超3回、連続ワープ50.1ms・同2回だった。地形の同期生成は前段の新地域2回21.7ms・連続1回9.8msから**両方0回**になった。CDPとページの時計を合わせた最長新地域にはGC self12.866msとWASM self6.961ms、別の区間には標高照会・測地座標変換・影描画等が残った。生のcpuprofileで親スタックを末尾までたどると、この6.961msはTerrain.createColliderからRapier.trimeshへ入る処理だった。連続ワープの50.1ms区間にも同じWASM関数のself11.171msが載り、うち9.950msはBuildings.createColliderからRapier.trimesh、1.221msは親ルートの無い記録で呼び出し元を特定できなかった。包含する群を足してCPU合計にはしない。[^before] [^profile]

Profilerの端末2864行はすべてinfo、ソース30ファイルは一致、対象の失敗0件。単発の別起動の最長値は変動し、通常計測の連続ワープ66.6msが残る以上、全停止の解消とは扱わない。[^profile] [^logs]

再現は開発サーバーでjust measure-terrain-imagery、just measure-road-streaming、QA_PROFILE=1 QA_MODES=coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjsを順に実行する。ローカルcheck-allは102ファイル・1074テスト、型・lint・整形・justfile・SHA pin・actionlint・既存OKFがPASS。本番ビルドは1.08秒。この記録もコミット前に整形・OKFを検証する。[^tests]

[^code]: 初期から同じ構成を使い、値だけを更新する地形材質。

[^material]: three.js公式Material API。

[^native]: インストール済みthree 0.186.1のキーとテクスチャ生成の一次実装。

[^before]: 前段の時計対応付きワープCPU。最長のバス材質と地形を区別する。

[^component]: 最終3ソースを保存した両backend・昼夜・9状態の固定比較。

[^normal]: Profilerなしの夜雨8場面。

[^profile]: 最終の時計対応付きCPUプロファイル。

[^logs]: traceごとの端末JSONL。

[^tests]: 共有テクスチャの解放と水域の適用時期、既存の高さ・Worker・原点変更の回帰検査。

[^previous]: 前段の外壁と水域マスクの記録。
