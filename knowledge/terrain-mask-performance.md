---
type: Metric
title: 地形の水域マスク式をタイル間で共有する
description: 同じ地形シェーダーの再生成を減らす。両backend・昼夜・マスク交換の8192000値が一致。実ワープの地形生成CPU181.5→32.4ms、204.4→10.1ms。原点変更100msなどの停止は残る。
tags: [terrain, rendering, water, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T00:36:44Z }
verified:
  - { by: process:chrome154-webgpu-webgl2-day-night-mask-parity, at: 2026-10-06T00:27:00Z }
  - { by: process:chrome154-clock-mapped-night-rain-warp-profile, at: 2026-10-06T00:30:00Z }
  - { by: process:chrome154-nonprofiled-five-streaming-scenarios, at: 2026-10-06T00:33:00Z }
  - { by: process:chrome154-recenter-profile-and-terminal-error-logs, at: 2026-10-06T00:34:00Z }
  - { by: process:985-tests-typecheck-lint-format-build-just-actions-knowledge, at: 2026-10-06T00:36:30Z }
sources:
  - id: code
    resource: ../src/world/terrainMaterial.ts, ../src/world/terrain.ts
    title: 共有マスク式と写真・水域更新からの利用
  - id: native
    resource: ../node_modules/three/src/nodes/core/Node.js, ../node_modules/three/src/materials/nodes/NodeMaterial.js, ../node_modules/three/src/nodes/accessors/MaterialReferenceNode.js, ../node_modules/three/src/nodes/accessors/ReferenceNode.js
    title: Three 0.186.1のノードIDによるキーと描画対象の材質を読む参照
  - id: before
    resource: ../.qa/perf/2026-10-06T00-19-10-170Z-streaming/report.json, ../.qa/perf/2026-10-06T00-19-10-170Z-streaming/frame-stacks.json
    title: タイル別シェーダー生成の回数・CPU・実フレーム（ローカル保存）
  - id: parity
    resource: ../scripts/qa/terrain-mask-parity.html, ../scripts/qa/terrain-mask-parity.mjs, ../.qa/perf/2026-10-06T00-26-46-529Z-terrain-mask/report.json
    title: 新旧の全画素比較と生成CPU、backend・昼夜・5つのマスク状態（ローカル保存）
  - id: after
    resource: ../.qa/perf/2026-10-06T00-28-03-808Z-streaming/report.json, ../.qa/perf/2026-10-06T00-28-03-808Z-streaming/frame-stacks.json
    title: 同条件の修正後ワープと残る経路探索のスタック（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T00-31-04-278Z-streaming/report.json
    title: Profilerなしの5場面と道路資源・原点・最後のワープの検査（ローカル保存）
  - id: recenter
    resource: ../.qa/perf/2026-10-06T00-33-11-629Z-streaming/report.json, ../.qa/perf/2026-10-06T00-33-11-629Z-streaming/frame-stacks.json
    title: 原点変更だけの追試では100msが再現せず50msだった記録（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/9f20080f-a92d-4d2c-ab70-8351a2dc6418.jsonl, ../.qa/logs/2026-10-06/c0185c30-1883-4ee7-bc15-49d0ec917732.jsonl
    title: 端末保存の1238行・615行、warnとerrorは双方0件（ローカル保存）
  - id: tests
    resource: ../tests/terrainMaterial.test.ts
    title: Threeの実際のprogram keyを使うタイル間共有・サイズ違い・更新の回帰検査
---

# 実フレームで特定した原因

建物の属性解析を省いた後も、夜雨の新地域へのワープに116.6msのフレームが残った。その区間では、頂点4225個の地形タイル8件の同期シェーダー生成が約77.6msを使っていた。材質のクラス・メッシュ名・頂点属性を生成時に記録し、建物の外壁と区別した。CPUサンプリング上もシェーダー生成の包含時間は約70.6ms。分類は重なるので加算しない。[^before]

地形の写真が届くたびに、同じ水域の切り抜き式を別のTextureNodeから作っていた。ThreeのNodeの既定キーは自身のIDを含むため、式が同じでも材質のノードグラフのキーが別になる。標準のNodeMaterialとMaterialReferenceNodeの実装を読んで確認した。[^native] [^code]

水域マスクの式を一つにし、materialReferenceが描画対象の材質のterrainWaterMapを読むようにした。各材質にはTextureNodeではなくTextureを保持する。写真や水域が更新されたときに現在のTextureへ結び直す。北から並ぶマスクのUV反転と0.5のしきい値を保ち、写真が付く前に切り抜きを始めない。地形の物理形状を決めるwaterMask・waterSizeの処理は従来のまま。[^code] [^native]

# 両backendでの全画素比較

M2 Max・Chrome154。8枚の違う色の写真と8種類の水域マスクを持つ別材質を、WebGPUとWebGL2の両方、昼と夜で描いた。初期状態・タイル間の交換・16×16マスクへの交換と描画順の反転・全域陸地・全域水の5状態。20画像、RGBA各409600値、合計8192000値が新旧で完全一致した。マスク変更で実際に画像が変わることも検査した。[^parity]

| 条件     | 旧生成回数 / CPU | 共有後の生成回数 / CPU |
| -------- | ---------------: | ---------------------: |
| WebGPU昼 |     8回 / 36.5ms |            1回 / 3.3ms |
| WebGPU夜 |     8回 / 21.4ms |            1回 / 2.6ms |
| WebGL2昼 |     8回 / 25.7ms |            1回 / 3.5ms |
| WebGL2夜 |     8回 / 24.0ms |            1回 / 3.3ms |

以後のマスク交換・サイズ変更による追加生成は新旧とも0回。これは固定シーンの部品比較で、雨・動く水面・影・地理座標の変更は対象外。CPUは同期builder.buildの計測であり、GPU側の全コンパイル時間ではない。ゲーム中の計測も同期buildだけを記録する。[^parity]

# 実ゲームの計測と限界

M2 Max・Chrome154・実WebGPU・1280×800・DPR1・ultra・夜雨・seed20261006。30秒温めてから同じ新地域・連続ワープを行った。計測中に編集・テスト・ビルドは行わない。

| 場面                     | 地形の生成回数 旧→共有後 | 地形の生成CPU 旧→共有後 | 最長rAF間隔 旧→共有後 |
| ------------------------ | -----------------------: | ----------------------: | --------------------: |
| 新地域                   |                   18→3回 |            181.5→32.4ms |         116.6→100.0ms |
| 古い依頼を挟む連続ワープ |                   21→1回 |            204.4→10.1ms |           83.4→66.7ms |

Profilerを使う前後各1回の観測。ネットワーク到着や他の仕事の重なりは固定されないため、最長値の差をゲーム全体の改善率にしない。新地域の生成が3回だった点も、すべての地形が必ず1回で済むという保証ではない。[^before] [^after]

修正後の新地域100msの区間では、シェーダー生成は観測されず、パトカー出現時の経路作成が主な仕事になった。search約33.0ms、planRoute約19.4ms、bestStart約8.5msなどで、スタックはspawnPatrolへ続く。その他の長い区間には建物の読み込み、地形・舗道・コライダー生成、描画、GCが残る。[^after]

Profilerなしの一通りの観測は以下。全場面runtime errorは0件。道路資源の再利用、原点変更中の地理位置の保持、最後のワープへの着地の検査も通った。[^normal]

| 場面                     | 最長rAF間隔 | 50ms超 |
| ------------------------ | ----------: | -----: |
| 通常プレイ               |      33.5ms |    0回 |
| 同じ道路の更新           |      33.4ms |    0回 |
| 原点変更                 |     100.0ms |    5回 |
| 新地域                   |      66.7ms |    8回 |
| 古い依頼を挟む連続ワープ |      83.4ms |    7回 |

原点変更の位置付け直し自体は3.0ms。その後のtickに約98.6msが記録されたが、この実行にはCPUプロファイルがなく内部の原因は断定できない。原点変更のみのProfiler追試では最長50ms・50ms超0回となり、100msは再現しなかった。最長区間は通常描画・影・バッファ更新・道路網復元などだった。このばらつきを隠して原点変更が解消したとは扱わない。[^normal] [^recenter]

端末のjust show-errorsで通常5場面1238行・原点変更追試615行を確認し、双方warn/errorは0件。再現URLはhttp://localhost:5173/tokyo-od-game/?seed=20261006&start=35.681236%2C139.767125&time=night&weather=rain。[^logs]

再現はjust measure-terrain-mask。実ゲームはQA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streamingとProfilerなしのQA_MODES=baseline,update,recenter,coldWarp,latestWarp。Threeの実program keyの回帰検査もCIの通常テストに含める。[^parity] [^tests]

[^code]: 共有ノードと材質ごとの水域テクスチャ参照。

[^native]: インストール済みThree 0.186.1の一次実装。

[^before]: 変更前の地形生成の実フレームと材質ごとの記録。

[^parity]: 両backend・昼夜・マスク交換の固定シーン比較。

[^after]: 修正後のワープとCPUスタック。

[^normal]: Profilerなしの5場面の実測。

[^recenter]: 原点変更のCPUプロファイルによる追試。

[^logs]: .qa/logsへ保存した端末ログ。

[^tests]: 独立マスクと交換後も同じシェーダーキーであることの検査。
