---
type: Metric
title: 地形の標高・頂点・法線をWorkerで準備する
description: 実地形50タイルの2919450値が旧同期版・Worker・分割版・本番で一致。200依頼の入力準備・送信CPU488.5→19.4ms。夜雨の連続ワープ83.3msは残る。
tags: [terrain, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T04:01:29Z }
verified:
  - {
      by: process:vitest-17-terrain-transfer-failure-bounds-disposal-and-reanchor-tests,
      at: 2026-10-06T03:46:15Z,
    }
  - { by: process:1057-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T03:47:20Z }
  - {
      by: process:chrome154-50-real-terrain-tiles-worker-inline-legacy-and-production-parity,
      at: 2026-10-06T03:50:00Z,
    }
  - {
      by: process:chrome154-nonprofiled-eight-night-rain-scenarios-and-terminal-logs,
      at: 2026-10-06T03:52:35Z,
    }
  - { by: process:chrome154-clock-mapped-final-warp-profile-and-source-hashes, at: 2026-10-06T03:55:30Z }
  - { by: process:road-worker-reply-stack-and-restore-timing-log-distinction, at: 2026-10-06T04:01:29Z }
sources:
  - id: code
    resource: ../src/world/terrainData.ts, ../src/world/terrainCompute.ts, ../src/world/terrain.worker.ts, ../src/world/terrain.ts, ../src/world/dem.ts, ../src/geo/geoid.ts
    title: 標高・ECEF・法線・境界の純粋計算、転送コピーと非同期準備
  - id: original
    resource: https://github.com/kexi/tokyo-od-game/blob/05e60e86882a92f83a386cfe32431b99c0408213/src/world/terrain.ts
    title: 比較に固定した旧地形の同期準備
  - id: three
    resource: ../node_modules/three/src/core/BufferGeometry.js
    title: Three 0.186.1のindexed法線の加算・正規化と境界計算
  - id: component
    resource: ../scripts/qa/perf-terrain-worker.mjs, ../.qa/perf/2026-10-06T03-47-49-734Z-terrain-worker/report.json
    title: 実50タイルの数値一致と旧同期・Worker・分割版の交互比較（JSONはローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T03-50-15-099Z-streaming/report.json, ../.qa/perf/2026-10-06T03-50-15-099Z-streaming/night-rain.png
    title: Profilerなしの全8場面と目視した夜雨の画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T03-53-07-722Z-streaming/report.json, ../.qa/perf/2026-10-06T03-53-07-722Z-streaming/frame-stacks.json
    title: 最終ソース22ファイル・時計対応付きの新地域と連続ワープのCPU（ローカル保存）
  - id: first
    resource: ../.qa/perf/2026-10-06T03-42-02-382Z-terrain-worker/report.json, ../.qa/perf/2026-10-06T03-44-00-358Z-streaming/report.json
    title: 短いフォールバックを1フレームに積まない変更前の部品計測と最初のProfiler（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/b351fc37-64e4-4fcc-93d9-52bf4e46abb2.jsonl, ../.qa/logs/2026-10-06/324f6f24-05a3-4fb3-84e5-92b2d98e0076.jsonl, ../.qa/logs/2026-10-06/9630e2e3-c572-4c02-be15-8a6e28694a2b.jsonl
    title: 部品比較・通常計測・最終Profilerの端末ログ（ローカル保存）
  - id: tests
    resource: ../tests/terrainWorker.test.ts, ../tests/log.test.ts
    title: 旧DEM照会・native法線との一致、転送・失敗・破棄・最新フレームへの反映とログ検査
  - id: previous
    resource: building-facade-worker-performance.md, terrain-and-geoid.md
    title: 前の66.7msに残った地形の法線と高さを合わせる既存の条件
---

# 地形準備をメインから外す

建物をWorkerで準備した後の連続ワープ66.7msでは、terrain.buildChunk→computeVertexNormalsの頂点読み出し約6.0msと、地形のDEM照会がメインに残っていた。1タイルは64×64セル・4225頂点。DEMの返答が重なると、最大3タイルの準備が同じメインのタスクに並ぶ。[^previous]

DemStoreが北西・北東・南西・南東の4タイルを読み、ジオイド格子をsnapshotする。TerrainComputeが4つのDEM配列をnative sliceでコピーし、そのコピーだけをtransferする。元の配列は運転中の高さ照会と、Worker失敗時の再計算のため保持する。Workerは標高の双線形補間・ジオイド補正・ECEFの頂点・UV・三角形・法線・境界を準備して返す。[^code]

DEM照会は4タイルの配列を直接選ぶ。旧DemStore.sampleGlobalのfloor・負座標の剰余・4画素の重みと演算順を保ち、画素ごとの文字列キーとMap照会を省く。頂点はタイル中心のECEFからの差で、浮動原点を含めない。法線はnative Threeと同じVector3/getter、面の加算順、Float32への書き戻しと正規化。[^code] [^three]

メインは返答の属性と境界をBufferGeometryへ取り付け、**その時点の最新フレーム**へ置く。写真・材質・水域による切り抜きと物理形状の既存の処理は同じ頂点と三角形を使う。disposeはWorkerと待つ依頼を終了し、DEM読み込み後・Worker返答後・yieldした分割処理からの追加を防ぐ。[^code] [^tests]

# フォールバックと記録

Workerの起動・送信・error・messageerror・処理エラー・30秒タイムアウトは、保持した入力から同じ計算を再実行する。頂点・indicesは行単位、法線は512三角形と512頂点単位でyieldする。SerialWorkで順序を保ち、FrameWorkの4ms予算で描画へ返す。短い1タイルでも最後に1フレーム返してから次を開始し、複数の短い準備が同じmicrotaskの列に積まれないようにした。[^code] [^tests]

terrain_chunk_preparedに依頼のkey・backend・頂点数・準備・送信・計算・待機・最大slice・yieldを記録する。Workerの失敗とタイル準備の失敗も登録したスキーマで記録する。計測は一意のkeyでその依頼の返答を照合する。[^code] [^component]

# 実地形50タイルとの一致と時間

M2 Max・Chrome154・WebGPU・ultra・1280×800・DPR1・夜雨・seed20261006。東京駅・吾妻橋の表示中の地形を各25タイル、計50・211250頂点から取得する。4つの実DEM配列とジオイド、座標、分割数、入力SHA-256を記録した。[^component]

旧terrain.ts・dem.ts・geoid.tsを05e60e86882a92f83a386cfe32431b99c0408213へ固定し、ソースとSHA-256を保存する。地形の準備部分は旧ソースから切り出す。参照は旧DemStoreのglobal照会とnative ThreeのcomputeVertexNormals・境界計算を使う。**Worker・分割版・本番の各2919450値がObject.isで一致**。対象は位置・UV・indices・法線・ECEF中心・boxの最小最大・sphereの中心と半径。4回の時間計測でも全出力を照合した。[^component] [^original]

| 50タイル、4回（200依頼） |       旧同期 |        Worker | 分割フォールバック |
| ------------------------ | -----------: | ------------: | -----------------: |
| 計測対象のメインCPU合計  |      488.5ms |        19.4ms |            374.0ms |
| 1依頼のメインCPU最大     |       10.5ms |         1.4ms |              2.7ms |
| 計算CPU合計              |      488.5ms |       247.9ms |            372.3ms |
| 返答待ち最大 / p95       | 10.5 / 3.1ms | 36.5 / 32.3ms |      40.4 / 34.0ms |
| 描画へ返した回数         |            0 |    Worker待機 |                200 |

WorkerのメインCPU19.4msは準備1.4msとコピー・送信18.0ms。DEM読み込み・snapshot、返答のログ・属性の取付け・コライダー・描画を含む全体CPUではない。Workerの計算時間と返答待ちは別の値。今回のWorker計算値は小さいが、返答待ちは同期より長く、全体のフレーム改善率とは扱わない。全12標本は最長33.4〜50.0ms、50ms超0回。分割版の最大同期sliceは2.7msだった。[^component]

最初の部品比較も数値が一致し、メインCPU491.2→17.6msだった。その後、短いフォールバックの最後にも描画へ返す処理を追加したため、上の表は追加後に再計測した値を使う。最終版の部品6ファイル、下記の全ゲーム22ファイルのソースSHAは、その後の作業ツリーとすべて一致することを確認した。[^first] [^component] [^normal] [^profile]

# 実ワープと未解消の停止

Profilerなしの8場面は次のとおり。全場面のWorker・タイル準備・実行時・ログ検証のエラーは0。通常更新の道路125メッシュ・駐車16台の参照保持、準備中の原点保持、最後のワープへの着地も通った。[^normal]

| 場面                     |          最長rAF間隔 |      50ms超 |
| ------------------------ | -------------------: | ----------: |
| 通常走行2標本            |        33.4 / 33.4ms |     0 / 0回 |
| 同じ道路の更新3回        | 33.5 / 33.4 / 50.0ms | 0 / 0 / 0回 |
| 原点変更                 |               33.5ms |         0回 |
| 新地域                   |               66.7ms |         3回 |
| 古い依頼を挟む連続ワープ |               83.3ms |         3回 |

新地域37・連続ワープ32件の準備がすべてWorkerで、入力準備・送信のメインCPU合計2.7/3.6ms、1件最大0.2/0.8ms。画面で地面・建物・雨滴・ナビ・Yの表示を目視した。端末の2994行はinfo2993、潮位表の取得失敗（tide_table_failed）1、error0。[^normal] [^logs]

最終版のProfilerでは新地域66.7ms・50ms超4、連続ワープ66.6ms・同4。地形37/32件がすべてWorkerで、入力準備・送信合計4.9/2.7ms、1件最大1.5/0.2msだった。時計の対応とsessionを検査し、CPUスタックを最長rAF区間へ対応させた。2083行はinfo2082、潮位表の取得失敗1、error0。[^profile] [^logs]

新地域66.7msにはシェーダー生成の包含約22.8msと、舗道の高さ補正からのtoGeodetic約5.1msがある。連続ワープ66.6msには道路Workerの返答コールバック約7.7ms、GPUのwriteBuffer約3.8ms、水位のquantile約3.4msがある。別の50.1msには建物コライダーを作るRapierのtrimesh約15.0ms、頂点の変換などが重なる。**地形の法線生成が消えたことだけで、停止の完全修正とはしない。** 分類の包含とself値は足し合わせない。次は道路Workerの返答処理と建物コライダーの準備を調べる。[^profile]

その後、同じsessionのroad_network_preparedを端末で照合した。6件のrestoreMsは0.5〜0.9ms、sendMsは0.9〜1.6msだった。**返答コールバックの約7.7msを、RoadGraph・Vector3の復元時間と読み替えてはいけない。** event.dataへの最初のアクセスなど、structured cloneの受信・デシリアライズはこのrestoreMsに含まれず、現ログでは分けて計測していない。索引の「道路網の復元・コライダーの停止」は「道路Workerの返答・コライダーの停止」へ訂正した。次に返答を読む時間と復元時間を分けて測り、対象を確定する。[^profile] [^logs]

前のProfilerなしの新地域50.1ms・連続ワープ66.7msに対し、今回の最長値は66.7/83.3msだった。起動ごとの到着・交通・GC・GPU待機が変動するため、今回の部品改善から全ゲームの停止が改善したとは断定しない。最初のProfilerも50.1/66.7/66.7msで、短いフォールバックへの追加前の記録として残す。[^previous] [^first] [^normal]

再現はjust measure-terrain-workerとjust measure-road-streaming。最終ProfilerはQA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streaming。計測中に編集・ビルド・テストをしない。単体テストは端の双線形補間、分割数63・64・8、負座標、ジオイドのclampとfallback、最新フレーム、転送と失敗・破棄を検証する。全1057テスト、型・lint・整形・justfile・Actions・knowledgeと本番ビルドが通った。[^component] [^profile] [^tests]

[^code]: 浮動原点を含めないWorkerと分割版、最新フレームでの取付け。

[^original]: 固定した旧同期準備。

[^three]: 法線の演算・Float32書き込みの参照。

[^component]: 実地形の数値と時間。

[^normal]: Profilerなしの8場面と画面。

[^profile]: ソース・時計・CPUスタックの最終記録。

[^first]: 最後の描画yieldを加える前の記録。

[^logs]: 端末へ保存した警告とエラーの確認。

[^tests]: 属性・境界・所有権・失敗と寿命の回帰検査。

[^previous]: 改善前の実ワープと高さの条件。
