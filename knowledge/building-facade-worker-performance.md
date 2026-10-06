---
type: Metric
title: 建物の座標変換と外壁属性をWorkerで準備する
description: 実建物32メッシュの各7181610数値が旧同期版と一致。本番外壁の2872644数値も一致。128回の入力準備・送信CPU387.3→10.6ms。夜雨の新地域50.1ms・連続ワープ66.7msが残る。
tags: [rendering, plateau, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T03:26:00Z }
verified:
  - {
      by: process:chrome154-32-real-building-meshes-worker-inline-and-legacy-parity,
      at: 2026-10-06T03:12:30Z,
    }
  - {
      by: process:vitest-13-building-worker-transfer-failure-disposal-and-loading-tests,
      at: 2026-10-06T03:13:35Z,
    }
  - { by: process:chrome154-clock-mapped-night-rain-streaming-profile, at: 2026-10-06T03:15:30Z }
  - { by: process:chrome154-webgpu-webgl2-facade-gpu-lifecycle-parity, at: 2026-10-06T03:16:55Z }
  - {
      by: process:chrome154-nonprofiled-eight-streaming-scenarios-and-terminal-logs,
      at: 2026-10-06T03:20:00Z,
    }
  - {
      by: process:1040-vitest-tests-types-lint-format-build-just-actions-and-knowledge,
      at: 2026-10-06T03:24:40Z,
    }
sources:
  - id: code
    resource: ../src/world/buildingFacadeData.ts, ../src/world/buildingFacadeCompute.ts, ../src/world/buildingFacade.worker.ts, ../src/world/buildingFacadePlugin.ts, ../src/world/facadeData.ts, ../src/world/buildings.ts
    title: 純粋な座標・属性計算、転送コピー、分割フォールバックとロード完了前の準備
  - id: original
    resource: https://github.com/kexi/tokyo-od-game/blob/7fe758a04a83835bd9667cef99b34cb21525a7a6/src/world/facade.ts
    title: 比較に固定した旧外壁属性の実装
  - id: parser
    resource: ../node_modules/3d-tiles-renderer/src/three/renderer/tiles/TilesRenderer.js, ../node_modules/3d-tiles-renderer/src/core/renderer/tiles/TilesRendererBase.js
    title: processTileModelの非同期待機、ロード完了イベントとabort判定（0.5.3）
  - id: components
    resource: ../scripts/qa/perf-building-worker.mjs, ../.qa/perf/2026-10-06T03-10-54-383Z-building-worker/report.json
    title: 東京駅・吾妻橋の実属性と階層行列を使う旧同期・実Worker・分割版の交互比較（JSONはローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T03-13-49-065Z-streaming/report.json, ../.qa/perf/2026-10-06T03-13-49-065Z-streaming/frame-stacks.json
    title: Worker導入後の時計対応付きCPUプロファイルと実ワープ（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T03-17-44-348Z-streaming/report.json, ../.qa/perf/2026-10-06T03-17-44-348Z-streaming/night-rain.png
    title: Profilerなしの8場面、資源再利用・原点変更・最新ワープと目視した画面（ローカル保存）
  - id: pixels
    resource: ../scripts/qa/building-gpu-parity.html, ../.qa/perf/2026-10-06T03-16-15-660Z-building-gpu/report.json
    title: 純粋計算の分離後も両backendの画素とGPU/CPU破棄が一致（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/60960284-cd71-41f0-8227-000405156941.jsonl, ../.qa/logs/2026-10-06/81bf82d8-2e9c-4bc2-9036-5da2db9f7618.jsonl, ../.qa/logs/2026-10-06/bcc4934b-3575-4f0f-ad58-25b9653c7aff.jsonl
    title: 部品比較の意図した失敗と実ワープの端末ログ（ローカル保存）
  - id: tests
    resource: ../tests/buildingFacadeWorker.test.ts, ../tests/buildingGpuUnload.test.ts, ../tests/log.test.ts
    title: 属性読み出し、転送、応答対応、失敗・タイムアウト・破棄とモデル準備・ログの回帰テスト
  - id: previous
    resource: building-gpu-cache-performance.md
    title: 材質保持後に残っていた初回の建物準備と変更前の実ゲーム計測
---

# ロード完了前にWorkerで準備する

近景のload-modelで全頂点をECEFへ変換し、建物IDごとの高さ・外壁スタイル・明るさを計算していた。材質を保持した後も、新地域のCPUには頂点読み出しと外壁属性の準備が残った。[^previous]

スタイルの表・ハッシュ・属性計算をレンダラーを含まないfacadeDataへ分離し、座標変換と合わせてWorkerで実行する。ThreeのBufferAttribute、InterleavedBufferAttribute、Float16BufferAttributeのgetterとVector3.applyMatrix4を使い、変換の演算順とFloat32への丸めを保つ。建物の高さ・ID・重み・種の計算順も保つ。遠景の同期APIは同じ純粋計算を呼ぶ。[^code] [^original]

3d-tiles-rendererのprocessTileModelは、タイルのロード完了やload-modelを通知する前にPromiseを待つ。ここで外壁属性を取り付ける。元のGLTF材質から外壁への置き換え、ランドマークの切り抜き、影、コライダーは既存のロード・更新処理へ渡す。材質の置き換えの時点は従来と同じなので、標準パーサーが保持する元の資源と外壁の所有権も保つ。[^code] [^parser]

メッシュの行列は、シーンがタイルのgroupへ付く前のECEFで取得する。Worker待機中に浮動原点が変わっても入力は変わらない。返ったECEF配列をランドマーク切り抜きへ渡した後、WeakMapの項目を削除する。パーサー側の既存abort判定が、読み込みを取り消したタイルのロード完了・表示を防ぐ。取り消し時にすでに走るWorker計算を個別に中断するAPIは追加していない。[^code] [^parser]

# 転送と失敗時の扱い

位置とIDの生の属性配列をnative sliceでコピーし、そのコピーだけをtransferする。interleavedの位置とIDが同じ配列ならコピーは1つ。元の配列は描画・レイキャスト・物理用に保持する。Workerの返答はECEFと外壁のFloat32配列をtransferする。[^code] [^tests]

起動・postMessage・error・messageerror・処理エラー・30秒タイムアウトはWorkerを終了し、保持した元の属性と行列から同じ計算を再実行する。フォールバックは4096頂点と256スタイル単位でyieldし、SerialWorkと4msのFrameWorkで描画へ時間を返す。Workerを使えない状態は保持し、後の依頼も分割版へ送る。disposeは待つ依頼をrejectし、すでにyieldしたフォールバックも次の区切りで止める。[^code] [^tests]

各メッシュにspanを付け、building_facade_preparedへbackend・頂点数・計算・入力準備・送信・待機・分割の時間を記録する。building_worker_failedもスキーマへ登録した。計測では各依頼に固有のkeyを付け、同じkeyのログを照合する。他のタイルの処理を取り違えない。[^code] [^components] [^tests]

# 実建物との一致と部品計測

M2 Max、HeadlessChrome154、実WebGPU・ultra、1280×800・DPR1、夜雨、seed20261006。東京駅と吾妻橋から各16、計32メッシュ・1436322頂点を選ぶ。位置・IDの実配列、型・interleaved・normalized・ID属性名、ECEFの階層行列と入力SHA-256を記録。階層のlocal matrixを順番に乗算し、groupの浮動原点を含めず元のECEF行列を再現する。[^components]

参照の外壁モジュールは7fe758a04a83835bd9667cef99b34cb21525a7a6へ固定し、ソースとSHA-256を保存。座標変換は元のVector3/getter/Float32.setの処理で、参照の属性関数へ渡す。実Workerと分割版は**それぞれ7181610数値がObject.isで一致**。さらに、本番で取り付けた外壁の**2872644数値も参照と一致**した。4回の時間計測でも全出力を照合した。比較用の参照は属性を付ける空のBufferGeometryを作って破棄するため、その小さい準備も参照CPUに含む。[^components] [^original]

| 32メッシュ、4回（128依頼） |        旧同期 |        Worker | 分割フォールバック |
| -------------------------- | ------------: | ------------: | -----------------: |
| 計測対象のメインCPU合計    |       387.3ms |        10.6ms |            578.8ms |
| 各回のメインCPU合計        | 92.5〜103.4ms |    2.2〜3.3ms |     143.3〜146.0ms |
| 1依頼のメインCPU最大       |         9.9ms |         0.3ms |     14.3ms（合計） |
| 計算CPU合計                |       387.3ms |       495.7ms |            577.9ms |
| 返答待ち最大 / p95         |   9.9 / 8.9ms | 29.7 / 28.5ms |      88.9 / 79.4ms |
| 描画へ返した回数           |             0 |    Worker待機 |                 60 |

WorkerのメインCPU値は入力の準備・起動とコピー・postMessageの合計。返答ログ、属性の取付け、切り抜き、コライダー、GPU描画を含む全体CPUではない。10.6msの内訳は準備1.2ms・送信9.4ms。返答を待つ時間はメインCPUに足さない。分割版の1依頼の14.3msは複数フレームに分かれた合計で、最大の同期sliceは4.5ms。全12標本の50ms超フレームは0、最長33.4〜49.9msだった。[^components]

**Workerは計算そのものや返答時間を速くしていない。** この32メッシュの計算CPUと待機は増えたが、メインでの長い属性準備を避けた。まず一致を検査し、その後、同期→Worker→分割版と逆順を交互に比較する。各依頼の間に実rAFを待ち、背景のゲームも進める。[^components]

最初の計測CLIはブラウザ評価内のbare import('three')を解決できず、数値の計測前に失敗した。Viteが配信するThreeのURLへ修正して再実行した。成功した部品計測は、フォールバックを意図的に1回起動失敗させた警告だけを記録する。1749行の端末ログはinfo1748・その警告1、error0。[^components] [^logs]

部品計測の後に、dispose時の分割停止のguardと単体テストを追加した。座標・属性・Workerの計算は変更していない。下記の実ワープと全検査はこのguardを含む。計測用のif条件に名前を付ける整形は数値の計算を変えない。全検査後はコメントの位置とDedicatedWorkerのpostMessageに対するlintの誤検出を整理しただけで、実行コードは変更していない。[^tests] [^profile] [^normal]

# 実ワープと残る原因

同じ夜雨の設定で、Profilerありは原点変更50.0ms・50ms超0、新地域66.7ms・同3、連続ワープ66.7ms・同4。CDP/ページ時計とsessionを検査し、ソースを凍結した。新地域220・連続ワープ258件の近景準備がすべてWorkerで、入力準備・送信のメインCPU合計12.1/12.8ms、1件最大2.0/0.9msだった。[^profile]

Profilerなしでは通常走行2標本33.5/33.5ms、通常更新3回33.4/33.4/50.0ms、原点変更33.5msで、各標本の50ms超は0。新地域は50.1ms・同1、連続ワープは66.7ms・同4。新地域195・連続ワープ239件がすべてWorker。通常更新の道路125メッシュ・駐車16台を保持し、準備中の原点と最新ワープの優先を検査した。Profiler2497行、通常2471行の端末ログは全行info・警告/error0だった。画面も建物・雨滴・ナビ・Yが描けていることを目視した。[^normal] [^logs]

前の材質保持後のProfilerは新地域83.3ms・連続ワープ66.7ms、Profilerなしは66.7/66.8ms。起動ごとの読み込み・交通・GCが変動するため、この最長値だけから全ゲームの改善率を断定しない。[^previous] [^profile] [^normal]

今回の連続ワープの66.7msで、fromBufferAttribute約6.0msの呼び出し元は**terrain.buildChunk→computeVertexNormals**だった。建物の外壁準備ではない。同じ区間にはDEM照会約3.8ms、建物コライダーの頂点処理約3.6ms、shaderBuild包含約11.4msもあった。別の66.7msにはDEM照会約9.0msが残る。CPUサンプルによる推定と包含分類を足し合わせない。次は地形の頂点・法線生成とDEM照会を調べる。**停止の完全修正は未達。**[^profile]

属性の純粋計算を分離した後も、WebGPU/WebGL2・昼夜・全窓設定の既存GPU解放fixtureを実行した。36044800画素値が一致し、再表示の生成27→0、geometry9→1→9とCPU破棄後のshader state10→1を維持した。[^pixels]

再現はjust measure-building-worker。全ゲームはQA_PROFILE=1 QA_MODES=recenter,coldWarp,latestWarp just measure-road-streamingと、Profilerなしのjust measure-road-streaming。計測中に編集・ビルド・テストをしない。[^components] [^profile] [^normal]

[^code]: 型付き配列と同じ丸めを使うWorker・分割版の実装。

[^original]: 固定した旧外壁の実装。

[^parser]: パーサーが準備とabort判定を行う順序。

[^components]: 実属性と本番の属性の数値一致、各依頼の時間。

[^profile]: 時計対応付きのフレームと実CPUスタック。

[^normal]: Profilerなしの全ワープ、参照保持と目視した画面。

[^pixels]: 両backendの画素と資源の繰り返し検証。

[^logs]: traceごとの全端末ログ。

[^tests]: 転送の所有権・失敗と破棄・非同期待機・ログの回帰テスト。

[^previous]: 変更前の再表示のキャッシュと実ワープ。
