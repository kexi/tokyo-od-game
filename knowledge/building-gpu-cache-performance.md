---
type: Metric
title: 建物のGPU解放で外壁のシェーダーを捨てない
description: CPUキャッシュに残る建物の材質を保持し、頂点バッファだけ解放する。8棟を3回再表示する生成27回→0回、両backendの36044800画素値が一致。夜雨の実ワープには66〜83msが残る。
tags: [rendering, plateau, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T02:55:00Z }
verified:
  - { by: process:chrome154-building-gpu-lifecycle-16-conditions, at: 2026-10-06T02:46:40Z }
  - { by: process:vitest-geometry-hidden-window-settings-and-cpu-eviction, at: 2026-10-06T02:48:45Z }
  - { by: process:chrome154-clock-mapped-night-rain-profile, at: 2026-10-06T02:48:35Z }
  - { by: process:chrome154-nonprofiled-eight-streaming-scenarios, at: 2026-10-06T02:51:15Z }
  - { by: process:1027-tests-types-lint-format-build-just-actions-knowledge, at: 2026-10-06T02:54:00Z }
sources:
  - id: code
    resource: ../src/world/buildingGpuUnload.ts, ../src/world/buildings.ts, ../src/world/facade.ts
    title: 頂点バッファの解放と外壁材質の所有権・窓設定・CPUタイル破棄
  - id: dependencies
    resource: ../node_modules/3d-tiles-renderer/src/three/plugins/UnloadTilesPlugin.js, ../node_modules/three/src/renderers/common/RenderObject.js, ../node_modules/three/src/renderers/common/nodes/NodeManager.js
    title: 3d-tiles-renderer 0.5.3のGPU解放とThree 0.186.1の材質・ジオメトリ破棄
  - id: parity
    resource: ../scripts/qa/building-gpu-parity.html, ../scripts/qa/perf-building-gpu.mjs, ../.qa/perf/2026-10-06T02-45-56-760Z-building-gpu/report.json
    title: 実GPUでの初期画像・3回の再表示・非表示中の設定変更と生成CPU・資源数（JSONはローカル保存）
  - id: before
    resource: ../.qa/perf/2026-10-06T02-33-40-970Z-streaming/report.json, ../.qa/perf/2026-10-06T02-33-40-970Z-streaming/frame-stacks.json
    title: Worker導入後・材質保持前の夜雨ワープと時計対応付きCPUサンプル（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T02-46-49-089Z-streaming/report.json, ../.qa/perf/2026-10-06T02-46-49-089Z-streaming/frame-stacks.json
    title: 材質保持後の夜雨ワープと時計対応付きCPUサンプル（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T02-48-59-730Z-streaming/report.json, ../.qa/perf/2026-10-06T02-48-59-730Z-streaming/night-rain.png
    title: Profilerなしの通常更新3回・原点変更・新地域・連続ワープと目視した画面（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/ff3c4def-b123-4c82-8978-1076f7ce79f4.jsonl, ../.qa/logs/2026-10-06/95edcd5a-ad28-4a89-b1d8-4d32fc5d92ad.jsonl, ../.qa/logs/2026-10-06/4449bf19-ad19-4994-8830-5d8919f4c6be.jsonl
    title: 各起動のtrace別端末ログと警告・エラーの確認（ローカル保存）
  - id: tests
    resource: ../tests/buildingGpuUnload.test.ts
    title: 元の頂点・インデックス、実プラグインの表示イベントとLRU解放、設定変更、CPU破棄の回帰テスト
  - id: previous
    resource: driving-route-worker-performance.md, opaque-facade-shadow-performance.md
    title: Worker後に残る停止と、同じタスク内だけで描画した影の更新差の注意
---

# 外壁の材質の寿命をCPUタイルに合わせる

近景のタイルは、非表示になるとUnloadTilesPluginがGPUのジオメトリ・材質・テクスチャをdisposeする。CPUの頂点データとMeshはタイルのLRUキャッシュに残り、再表示時に再アップロードできる。しかしThreeのmaterial.disposeはRenderObjectも破棄し、そのシェーダーのbuilder stateを参照している最後のRenderObjectが消えると共有キャッシュも削除する。geometry.disposeだけなら頂点バッファを解放し、RenderObjectの属性参照を更新する処理で済む。[^dependencies]

BuildingGpuUnloadPluginは従来のUnloadTilesPluginを継承し、GPU解放のフックでgeometryだけdisposeする。表示イベント・非表示の遅延・GPUのLRU管理は親のまま。近景で使う外壁の共有テクスチャはタイル所有ではない。元のGLTF材質は外壁へ置き換えた時に破棄する。置き換えた外壁は既存のdispose-model処理でCPUタイルからの削除時に破棄する。遠景の処理は変えない。[^code] [^dependencies]

外壁のfactoryはdisposeイベントで材質を画質設定の通知対象から外す。以前のGPU解放後は、CPUに残るタイルが窓設定の変更を受け取れなかった。保持した材質は非表示中にも設定を受け取り、再表示時に現在の設定で描ける。[^code] [^tests] [^parity]

この変更はGPU資源をすべて空にするものではない。大きい頂点バッファを従来どおり解放し、外壁の材質に結び付くシェーダー状態と描画資源をCPUタイルの寿命まで保持する。保持数はCPUタイルのキャッシュにあるモデル数に依存する。GPUの正確なバイト数や大規模な長時間走行の上限は今回測っていない。生成回数とジオメトリ・shader stateの数を下記の繰り返しで確認した。[^code] [^parity]

# 両backendの再表示と画素・資源

8棟にそれぞれ別の外壁材質、PCFの太陽影と影を受ける地面、320×320・RGBA・AAなし、固定の姿勢と時計。WebGPU/強制WebGL2、昼/夜雨、flat/lit/roomsの12条件。従来の実UnloadTilesPluginと新プラグインで、初期描画と非表示→頂点解放→再表示を3回比較する。旧→新、新→旧を交互にし、各描画の前に実rAFを待つ。Threeの同じタスク内だけの影更新を比較しない。[^parity] [^previous]

初期画像の旧/新、各再表示の旧/新、新の初期/各再表示はすべて一致。さらに、非表示中にflat→roomsへ変えた新の画像と新規rooms画像を両backend・昼夜の4条件で比較し、すべて一致した。変更前後の画像は100値以上変わり、設定が実際の表示に反映されていることを確認。合計**36044800画素値の差が0**だった。[^parity]

8棟を3回再表示する生成は各条件**27回→0回**。12条件合計324回・405.8msの同期生成が0回・0msになった。CPUは実際のNodeBuilder.buildを囲んだ値で、GPU時間・全ゲームのフレーム時間ではない。初めて読み込む建物や窓・照明・属性構成の変更のシェーダー生成は残る。[^parity]

| backend | 窓    | 夜雨・3回再表示の生成CPU（旧→新） |
| ------- | ----- | --------------------------------: |
| WebGPU  | flat  |                          22.3→0ms |
| WebGPU  | lit   |                          37.1→0ms |
| WebGPU  | rooms |                          38.3→0ms |
| WebGL2  | flat  |                          25.4→0ms |
| WebGL2  | lit   |                          37.6→0ms |
| WebGL2  | rooms |                          43.2→0ms |

全12条件で、geometryのGPU資源数は初期9（地面1＋建物8）→非表示1→再表示9を3回繰り返した。新のshader stateは表示/非表示で10のまま、材質・geometryのCPU破棄後は1（地面）へ戻った。CPU破棄後の数は旧処理とも一致した。これはfixtureで確認した個数で、バイト数の推定ではない。[^parity]

単体テストは頂点・インデックスの全値を保持すること、geometryのdisposeだけが呼ばれることを確認する。実Buildingsのload-modelで元の材質を外壁へ替え、実TilesRendererの表示イベントと親プラグインのLRU処理を通して非表示時の解放を起こす。非表示中の窓変更と、dispose-model後に設定通知から外れることも確認した。[^tests]

# 実ゲームでまだ残る停止

M2 Max、HeadlessChrome154、実WebGPU、ultra・1280×800・DPR1、夜雨、seed20261006、東京駅から開始して30秒待つ。前後のProfiler計測ではCDPとページの時計が対応することを検査し、同じsessionが最後まで続くことを確認。ソースとSHA-256を各測定ディレクトリへ保存した。計測中に編集・ビルド・テストをしなかった。[^before] [^profile] [^normal]

| 場面                 | 変更前Profilerあり・最長/50ms超 | 変更後Profilerあり・最長/50ms超 | 変更後Profilerなし・最長/50ms超 |
| -------------------- | ------------------------------: | ------------------------------: | ------------------------------: |
| 原点変更             |                      50.0ms / 0 |                      50.0ms / 0 |                      33.4ms / 0 |
| 新地域（吾妻橋）     |                      83.3ms / 8 |                      83.3ms / 3 |                      66.7ms / 7 |
| 連続ワープ（東京駅） |                      83.3ms / 7 |                      66.7ms / 7 |                      66.8ms / 7 |

Profilerなしでは通常走行の2標本33.5/33.4ms、同じ道路の更新3回33.4/49.9/50.0msで、各標本の50ms超は0。更新では道路125メッシュ・駐車16台の参照を全保持し、原点変更で旧原点が準備完了まで維持されること、最新ワープだけが最終原点になることを確認した。[^normal]

全ゲームはネットワーク到着・見える建物・交通・GCで変動する。上表の1起動ずつの値から、最長フレームの改善率や全shader buildの削減率は断定しない。部品で再生成を防げたことと、ゲーム全体の停止の解消は分ける。[^parity] [^before] [^profile] [^normal]

変更後の新地域の最長83.3msには、CPUサンプルでGC約9.1ms、fromBufferAttribute約6.0ms、shaderBuild包含約10.3msがあった。連続ワープの66.7msには道路データ復元・DEM照会・座標変換・Wasmなどが残り、別の66.7msにはshaderBuild包含約8.7msもあった。これらはCPUサンプルの推定で、包含分類は足し合わせない。次は初回の建物属性準備と道路反映・物理の同期部分を調べる。**停止の完全修正ではない。**[^profile]

変更前の端末ログは1839行、tide_table_failedの外部取得警告1・error0。変更後Profilerは1871行、Profilerなしは5728行でともに全行info・警告/error0。各測定のruntime error配列は空。同じtraceの端末JSONLも確認し、Profilerなしの画面は建物、雨滴、ナビ、Yの動画ポストが描けていることを目視した。[^logs] [^normal]

再現はjust measure-building-gpu。実ゲームはQA_PROFILE=1 QA_MODES=recenter,coldWarp,latestWarp just measure-road-streaming、Profilerなしはjust measure-road-streaming。CPUの対応付けはnode scripts/qa/profile-frame-stalls.mjs <report.json>。依存のGPU解放フックやThreeの寿命処理が変わる場合は、回帰テストと両backendの部品計測も繰り返す。[^parity] [^profile] [^tests]

[^code]: 外壁とCPUタイルの所有権に合わせたGPU解放。

[^dependencies]: インストール済み依存のdisposeとplugin呼び出し。

[^parity]: 両backendの画素・生成CPU・GPU資源とCPU破棄の実測。

[^before]: 材質保持前の夜雨の実ゲームと対応付けたCPUサンプル。

[^profile]: 材質保持後の夜雨の実ゲームと対応付けたCPUサンプル。

[^normal]: Profilerなしの8場面と目視した画面。

[^logs]: trace別に端末へ保存された全JSONL。

[^tests]: 実モデルイベントとLRU解放を使った回帰テスト。

[^previous]: Worker後の残る停止と以前の影更新差。
