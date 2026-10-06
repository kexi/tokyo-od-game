---
type: Metric
title: 建物の外壁シェーダーを表示前に非同期で準備する
description: 両backend・昼夜・全窓設定と準備中変更の19660800画素値が一致。表示時の外壁生成32→0回、中断後のGPU資源解放も確認。夜雨の新地域66.7msは残る。
tags: [rendering, plateau, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T05:02:00Z }
verified:
  - { by: process:1071-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T04:56:25Z }
  - {
      by: process:chrome154-19660800-pixel-values-settings-change-and-cancelled-gpu-release,
      at: 2026-10-06T04:56:51Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenarios-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T05:00:00Z,
    }
  - { by: process:chrome154-clock-mapped-warp-cpu-profile-and-terminal-logs, at: 2026-10-06T05:01:30Z }
sources:
  - id: code
    resource: ../src/world/buildingShaders.ts, ../src/world/buildingFacadePlugin.ts, ../src/world/buildings.ts
    title: 実タイル・実シーンでの非同期準備と中断時の解放
  - id: renderer
    resource: https://threejs.org/docs/pages/Renderer.html
    title: 公開compileAsync API
  - id: builder
    resource: https://threejs.org/docs/pages/NodeBuilder.html
    title: buildAsyncのshader stage間のyield
  - id: installed
    resource: three 0.186.1 の src/renderers/common/Renderer.js, src/renderers/common/nodes/NodeManager.js, src/nodes/core/NodeBuilder.js, src/utils.js; 3d-tiles-renderer 0.5.3 の src/three/renderer/tiles/TilesRenderer.js と src/core/renderer/tiles/TilesRendererBase.js
    title: 実際にインストールされたコンパイル・キャッシュ・ロードと中断の実装
  - id: component
    resource: ../scripts/qa/building-shader-parity.html, ../scripts/qa/perf-building-shaders.mjs, ../.qa/perf/2026-10-06T04-56-25-910Z-building-shaders/report.json
    title: 最終版の16画素比較条件と4中断条件、ソース5ファイル（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T04-56-51-478Z-streaming/report.json, ../.qa/perf/2026-10-06T04-56-51-478Z-streaming/night-rain.png
    title: Profilerなしの夜雨8場面と目視した画面、ソース29ファイル（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T04-59-31-646Z-streaming/report.json, ../.qa/perf/2026-10-06T04-59-31-646Z-streaming/frame-stacks.json
    title: 最終版の時計対応付きの新地域・連続ワープCPU（ローカル保存）
  - id: initial
    resource: ../.qa/perf/2026-10-06T04-45-38-734Z-streaming/report.json, ../.qa/perf/2026-10-06T04-45-38-734Z-streaming/frame-stacks.json
    title: 中断時の解放を追加する前の初回Profiler（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/d72df83c-d402-4991-aec5-90149470504e.jsonl, ../.qa/logs/2026-10-06/9b34c163-bb8a-4187-a996-fa7ca4ed2f63.jsonl
    title: 通常8場面と最終Profilerの端末ログ（ローカル保存）
  - id: tests
    resource: ../tests/buildingShaders.test.ts, ../tests/buildingFacadeWorker.test.ts, ../tests/log.test.ts
    title: 実オブジェクト・カリング・設定変更・失敗・破棄・同じタイルの再依頼とログスキーマの検証
  - id: previous
    resource: road-worker-reply-performance.md
    title: 前段の外壁同期生成21.5msと、停止が残った計測
---

# 表示する前に実タイルを準備する

前段の新地域66.7msフレームには、近景のFacadeMaterialの同期buildが21.5ms載っていた。buildAsyncを使う公開compileAsyncで表示前に準備する。three 0.186.1の実装はshader stageごとにyieldし、次のオブジェクトとの間でもyieldする。GPUの完了待ちだけを非同期にするAPIではない。一方、処理はメインスレッド上にあり、Workerへ移したわけではない。[^previous] [^renderer] [^builder] [^installed]

標準タイルパーサーがprocessTileModelの完了を待つ間に、旧load-model内と同じランドマークの切り抜き・影設定・外壁材質への置換を行う。その実タイルを実カメラ・実シーンでcompileAsyncへ渡す。別の仮材質や別シーンでは、実描画とキャッシュ・照明が一致しない可能性があるため使わない。まだECEF座標でシーン未接続なので、メッシュのfrustumCulledを一時的にfalseにして対象へ含め、成功・失敗の両方で元に戻す。複数タイルのコンパイルはSerialWorkで直列化する。[^code] [^installed] [^tests]

待機中に窓設定が変わった場合、材質versionの変化を検出して再コンパイルする。コンパイル不可・失敗時は元の初回描画の経路を残し、失敗は登録したbuilding_shader_failedへ書く。building_shader_preparedのdurationMsはyieldとGPU待ちを含む経過時間で、CPU時間ではない。[^code] [^tests]

# 中断したタイルのGPU資源を解放する

標準パーサーはprocessTileModelの後にengineData.scene/materials/geometryを記録する。その前に読み込みが中断されると、標準disposeTileは事前コンパイルの資源を参照できない。そこで準備中のタイルごとにAbortControllerを保持し、disposeTile・plugin.disposeで中断する。直列キュー内で中断済みならコンパイルを始めず、既に始まった非同期コンパイルは完了を待ってから頂点と材質を解放する。待機中に解放してコンパイルと競合させない。古い依頼の完了で同じタイルの新しい依頼を消さないことも検証した。[^installed] [^code] [^tests]

実WebGPU/WebGL2の昼夜4条件では、実NodeBuilderの非同期コンパイルを開始した後にタイルを中断した。AbortErrorでロードが終わり、メッシュのGPU頂点バッファ数・nodeBuilderCache数はいずれも0へ戻った。この中断試験の座標属性計算だけはfake computeを使い、コンパイルとGPU解放は実装を使っている。通常の8場面では本番のBuildingFacade Workerが動いている。[^component] [^normal]

# 初回表示と画素の比較

M2 Max、Chrome154.0.8037.97（revision b510e9d7cd3a2fbd78d0ddc42234103206c5f78d）、320×320、antialiasなし、同じ8棟・床・太陽・影。_batchidと_feature_id_0の2種類の属性配置を含める。WebGPU/WebGL2×昼夜×flat/lit/rooms/準備中flat→roomsの16条件で、同期初回描画と非同期準備後の初回描画を交互の順番で比較した。非同期側のモデルはシーン未接続・遠方座標でコンパイルし、接続・座標移動後の最初の画像を読み出す。[^component]

初回・継続表示・原点相当の座標移動後を各条件で比較し、**19660800画素値が完全一致**した。geometry/materialの参照・座標配列・元のカリング値も保持した。CPU破棄後のキャッシュは両方式とも床だけの1状態へ戻った。同期の外壁生成は計32回・315.4msだったものが、準備後の表示時には全16条件で0回になった。非同期側のCPU全体が0になったという意味ではない。[^component]

| 条件              | 同期の外壁生成CPU | 準備後の表示時の外壁生成CPU | 初回renderの同期経過時間（前→後） | 非同期準備の経過時間 |
| ----------------- | ----------------: | --------------------------: | --------------------------------: | -------------------: |
| WebGPU・夜・rooms |            21.8ms |                         0ms |                        33.3→5.8ms |               34.8ms |
| WebGL2・夜・rooms |            20.0ms |                         0ms |                       82.7→17.2ms |             1700.5ms |

準備完了まで建物の表示を待つため、待ち時間は増える。WebGL2・夜・roomsの約1.7秒は先の試行でも再現した。buildAsyncの経過時間合計では説明できず、CPU・GPU待ちの内訳まではこのfixtureで分離していない。表示時の同期停止と、準備完了を待つ時間を混同しない。[^component]

# 夜雨の全ゲームには停止が残る

本番の実ゲームをWebGPU・ultra・rooms・1280×800・DPR1・夜雨・seed20261006でProfilerなしに測った。ソース29ファイルのハッシュは最終作業ツリーと一致する。変わらない道路125メッシュ・駐車16台を再利用し、原点変更中の旧フレーム保持・連続ワープの最終地点への着地も確認した。建物・地面・夜雨・ナビ・Yを画像で目視し、端末2788行はすべてinfo、例外・Worker・道路・地形・ログ検証の失敗は0だった。[^normal] [^logs]

| 場面                 | 最長rAF間隔 | 50ms超の回数 |
| -------------------- | ----------: | -----------: |
| 通常1                |      33.4ms |            0 |
| 通常更新1            |      33.4ms |            0 |
| 通常2                |      33.5ms |            0 |
| 通常更新2            |      33.4ms |            0 |
| 通常更新3            |      50.0ms |            0 |
| 原点変更             |      50.1ms |            1 |
| 未読込の吾妻橋へ移動 |      66.7ms |           10 |
| 連続ワープ           |      50.0ms |            0 |

全8場面の外壁同期生成は0。新地域では非同期buildが4回・各16.5〜19.8msの経過時間、準備ログは279件だった。一方、Long Animation Frameにはtick20.8msとScheduler.yieldの継続7.7/5.9/5.1msが同居しており、分割だけで必ずフレーム予算内に収まるとは言えない。前段のProfilerなしの新地域は50.1msだったので、今回の66.7msを全ゲームの改善と扱わない。起動間の変動を含む単発比較で、悪化の因果まで断定はしていない。[^normal] [^previous]

最終Profilerでは新地域66.6ms・50ms超4回、連続ワープ66.7ms・同2回が残った。両場面とも外壁同期生成は0。CDPとページの時計を合わせた最長区間では、新地域のGCがself17.942ms、連続ワープのshader生成inclusive11.930msとshadow描画inclusive11.989ms、地形画像の反映や行列更新等が観測された。inclusive群は重なるので加算しない。他の50ms区間にもコライダー・DEMサンプリング・測地座標変換が残る。端末3051行はすべてinfo、ソース29ファイルも一致した。[^profile] [^logs]

初回の中断対処前Profilerも新地域・連続ワープは66.7msであり、外壁同期生成は既に0だった。この変更は外壁の初回描画の生成を取り除いたが、全停止の完全修正には至っていない。[^initial]

再現するには開発サーバーを起動し、just measure-building-shaders、just measure-road-streaming、QA_PROFILE=1 QA_MODES=coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjsを順に実行する。GPU計測と編集・ビルド・テストを同時に走らせない。ローカルのcheck-allは102ファイル・1071テストが通り、型・lint・整形・justfile・SHA pin・actionlint・既存OKF検査が通った。本番ビルドは1.49秒。コミット直前にこの文書の整形とOKFも検証する。[^tests]

[^code]: 実タイルをロード完了前に準備し、待機中の中断を追う実装。

[^renderer]: three.js公式Renderer API。

[^builder]: three.js公式NodeBuilder API。

[^installed]: 使用中のthreeとタイルローダーの実ソース確認。

[^component]: 両backend・16画素条件・4GPU中断条件の最終実測。

[^normal]: Profilerを使わない夜雨8場面の実測と画面。

[^profile]: 時計対応を確認した最終ワープCPUサンプル。

[^initial]: 中断対処前の初回Profiler。最終ソースの結果とは区別する。

[^logs]: 端末のtrace別JSONL。

[^tests]: 新しい8テストと既存を含む1071テスト。

[^previous]: 前段の外壁同期生成21.5msと全ゲームの残る停止。
