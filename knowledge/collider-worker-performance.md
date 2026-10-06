---
type: Metric
title: 地形と建物のコライダーBVHをWorkerで準備する
description: 実地形24・実建物24の入力4916043値と、Worker/フォールバック各4912275物理値・766レイが前段と一致。メインCPU合計83.0→16.1ms、136.6→36.0ms。全水域を空trimeshなしで扱う。Profilerの未読込地域66.7msと水域の同期更新は残る。
tags: [physics, terrain, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T06:33:00Z }
verified:
  - { by: process:1089-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T06:21:54Z }
  - {
      by: process:chrome154-real48-colliders-worker-fallback-766-rays-and-full-water-fall,
      at: 2026-10-06T06:23:47Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenarios-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T06:26:00Z,
    }
  - { by: process:clock-mapped-warp-cpu-profile-source-hashes-and-terminal-logs, at: 2026-10-06T06:33:00Z }
sources:
  - id: code
    resource: ../src/physics/colliderSnapshot.ts, ../src/physics/colliderCompute.ts, ../src/physics/collider.worker.ts, ../src/world/terrain.ts, ../src/world/buildings.ts
    title: 準備済み形状の登録と原点・破棄時の無効化
  - id: serialization
    resource: https://rapier.rs/docs/user_guides/javascript/serialization/
    title: Rapier 0.21のWorld snapshotの転送と復元
  - id: native
    resource: "@dimforge/rapier3d-compat 0.21.0 dist/rapier.mjs.mapのgeometry/shape.ts, geometry/collider_set.ts, pipeline/world.ts"
    title: Shape.intoRawのBVH構築・coShapeの共有形状・登録後のJS形状保持
  - id: component
    resource: ../scripts/qa/perf-collider-worker.mjs, ../.qa/perf/2026-10-06T06-21-54-491Z-collider-worker/report.json
    title: 前段024a067・実48タイル・実Worker・フォールバックの形状とレイ（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T06-23-47-974Z-streaming/report.json, ../.qa/perf/2026-10-06T06-23-47-974Z-streaming/night-rain.png
    title: Profilerなしの夜雨8場面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T06-29-32-984Z-streaming/report.json, ../.qa/perf/2026-10-06T06-29-32-984Z-streaming/frame-stacks.json, ../.qa/perf/2026-10-06T06-29-32-984Z-streaming/coldWarp.cpuprofile
    title: 時計対応付きの最終ワープCPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/9c027d78-d23d-4ef0-83f5-6a42591b7ef1.jsonl, ../.qa/logs/2026-10-06/252a2880-6f65-4f00-84f6-7c40de50c2b9.jsonl, ../.qa/logs/2026-10-06/a5849167-6720-4889-bd97-da2c1f816da9.jsonl
    title: 比較・通常8場面・Profilerの端末JSONL（ローカル保存）
  - id: tests
    resource: ../tests/colliderSnapshot.test.ts, ../tests/buildingColliders.test.ts, ../tests/terrainWorker.test.ts, ../tests/log.test.ts
    title: 物理世界と形状の寿命・Worker失敗・原点・破棄・スポーン・既存地形・ログ
  - id: previous
    resource: terrain-imagery-performance.md
    title: 前段の地形6.961msと建物9.950msのtrimesh生成スタック
---

# 登録時にBVHを作り直さない

前段の夜雨では、地形・建物のRapier.trimeshが最長フレームに載っていた。建物の4ms予算は登録が終わった後の判定なので、1タイルの約10msは分割されない。座標の準備だけをWorkerへ移してもこの処理は残る。[^previous]

RapierのWorld snapshotはUint8Arrayとして転送・復元できる。実0.21.0ではColliderSet.createColliderがdesc.shape.intoRawを呼び、TriMesh.intoRawは頂点からBVHを構築する。一方、RawColliderSet.coShapeは既存の共有形状を取り出せる。[^serialization] [^native]

Workerにコピーした頂点・三角形・flagsを渡し、固定trimeshを1つ持つ仮のWorldでBVHを構築してsnapshotを転送する。メインでは仮Worldを復元し、登録する1回だけintoRawをcoShapeに置き換える。登録直後に元のintoRawへ戻して仮Worldを解放するので、返ったColliderのJS形状・その後のshape.castRayは仮Worldに依存しない。生きているゲームWorld自体のsnapshotを置き換える処理ではない。入力の元配列を保持して送信するコピーだけをtransferし、Workerの失敗時は従来のtrimesh登録へ戻る。[^code] [^tests]

地形は1フレームに準備または登録1件。建物は従来の4ms予算内で準備・完成分の登録を進める。一度近くで見えたタイルの準備は、ドライバーが視線を外しても完成後の壁として保持する。原点変更・範囲外・破棄時にはpendingを中断し、遅れて届く結果を登録しない。建物の頂点・三角形の一時number配列は必要サイズのTypedArrayへ直接書くようにした。順序・座標演算・Float32への丸め・未indexedの三角形を保持する。[^code] [^tests]

水域が変わる際の既存地形の切り抜きは従来と同じフレームに同期で更新する。スポーンのbuildCollidersNearも同期契約を保持し、準備済みならsnapshotを使い、未完成なら従来の生成を行う。この2つの同期経路をなくした変更ではない。[^code] [^tests]

全三角形が水域で除かれる場合、Rapier 0.21.0の空trimesh登録は実APIで例外になった。空形状をWorkerや同期登録に渡さず、物理準備済みの水域として記録する。hasColliderAtはその状態でも準備完了を返し、固い地面が存在しない場所で車を待機させ続けない。水域→乾いた地面→水域の遷移、原点変更後の状態保持を検査した。実タイルの全水域マスクでもWorkerの追加仕事と固い地形コライダーが0件になり、実Rapierの動的ボディは30ステップでY=3から1.7635316848754883へ落下した。[^code] [^tests] [^component]

# 実タイルの形状とCPU

M2 Max・Chrome154.0.8037.97、revision b510e9d7cd3a2fbd78d0ddc42234103206c5f78d。実ゲームの東京駅周辺と吾妻橋で、実地形24タイル・実建物24タイルを取得する。前段024a067のTerrain/Buildingsの本物のcreateColliderを保存した参照モジュールとして呼び、最終のcolliderMeshの入力を先に比較する。[^component]

入力4916043値が一致。Rapierで取得した頂点・三角形は**Workerとフォールバックそれぞれ4912275値が一致**。766レイの命中距離・法線・featureもそれぞれ一致し、766本全てが命中した。退化面を除いた各ケース15〜16本を使用する。地形24のうち10タイルには水域による三角形の除去がある。全ケースで本物のWorkerとsnapshotの存在も検査する。最終6ソースのハッシュは作業ツリーと一致。[^component]

実Rapierの回帰テストでは、準備済みの地形に動的ボディを接触させ、内側の三角形境界を跨ぐ180ステップの位置・回転・速度・角速度・接触回数が同期生成と厳密に一致した。別の検査で既存Worldのボディ・ジョイント・時刻・無関係なコライダーを保持し、仮World解放後のshape.castRayも一致した。[^tests]

| 実タイル | 前段メインCPU合計 / 最大1件 | Worker使用時メインCPU合計 / 最大1件 | 最終Worker完了待ち合計 / 最大1件 |
| -------- | --------------------------: | ----------------------------------: | -------------------------------: |
| 地形24   |              83.0ms / 5.2ms |                      16.1ms / 1.5ms |                 606.2ms / 82.4ms |
| 建物24   |            136.6ms / 13.9ms |                      36.0ms / 3.8ms |                 540.4ms / 35.7ms |

最終メインCPUはローカル頂点・indexの準備、送信呼び出し、snapshot復元・登録・解放。入力準備は地形5.3ms・建物19.0ms、送信呼び出しは1.3ms・1.9ms、登録は9.5ms・15.1ms。座標とindexの準備自体をWorkerへ移した変更ではない。Workerの生成CPUは別に地形95.9ms・建物121.3msある。準備の完了待ちには初回のWorker/Rapier起動・メッセージ待ちを含み、CPU削減と同じ値にしない。snapshotは48件で合計74110713 bytes。Worker出力とメインでの復元に伴う転送・一時記憶も必要になる。Workerなしではメイン合計82.8ms / 117.6msで、BVH生成は残る。[^component]

比較は各タイルで前段→Worker→フォールバックの順に実施した。初回JITやGC等の変動があるため、これをゲーム全体の改善率や統計的な保証にはしない。[^component]

比較の端末2209行はinfo2208・warn1。warnはQAで意図的にWorkerを使えなくしたcollider_worker_failedである。通常ゲームでの失敗とは区別する。[^logs]

# 夜雨の実ゲーム

WebGPU・ultra・rooms・1280×800・DPR1・夜雨・seed20261006。GPU計測中は編集・テスト・ビルドを同時実行しなかった。夜雨の画面を目視し、道路125メッシュ・駐車16台の再利用、原点変更中の旧フレーム保持、連続ワープの最後の地点への着地を確認した。33ソースが最終作業ツリーと一致。[^normal]

| Profilerなしの場面   | 最長rAF間隔 | 50ms超 |
| -------------------- | ----------: | -----: |
| 通常1                |      33.4ms |    0回 |
| 通常更新1            |      50.1ms |    1回 |
| 通常2                |      33.4ms |    0回 |
| 通常更新2            |      33.4ms |    0回 |
| 通常更新3            |      33.5ms |    0回 |
| 原点変更             |      50.0ms |    0回 |
| 未読込の吾妻橋へ移動 |      50.1ms |    7回 |
| 連続ワープ           |      50.1ms |    1回 |

新地域の準備27件・連続ワープ33件は全てWorker。新地域の建物登録は最大0.9ms、連続は最大3.1ms。一方、地形の水域更新は最大6.4/6.5msで、この同期経路は残る。新地域はp50=33.3ms・p95=49.9ms、連続はp50=16.7ms・p95=33.3msで、最長値だけで滑らかになったとは結論しない。端末3426行はinfo3425・warn1で、開始時に外部amedas_fetch_failedがある。対象の例外・Worker・道路・地形・ログスキーマの失敗0件。雨はURLで固定されている。[^normal] [^logs]

別のProfiler計測は新地域66.7ms・50ms超12回、連続ワープ50.1ms・同2回。ページ/CDPの時計対応はbefore=36637.1ms、mapped=36638.0ms、after=36662.8msで範囲内。新地域の最長区間にはshaderBuildの包含17.523ms、GC self2.613ms、water.samplesAt self3.303ms、描画のintersectsObject self4.303ms等が載った。次の66.6ms区間にはshaderBuildの包含25.875msが載る。実cpuprofileの全親スタックを辿ると、prepareBuildingShadersからの準備にもそれぞれ7.477ms・10.238msがある。compileAsyncでもJavaScriptのシェーダー構築CPUまでWorkerへ移るわけではない。どの描画物か不明な別のシェーダーサンプルもあり、包含する群を足してCPU合計にしない。連続ワープの最長区間はshadowRender包含9.031ms等が載る。[^profile]

Profilerの対象の失敗0件、33ソース一致。端末3268行は全てinfo。全水域の修正前の暫定Profilerでは連続ワープ66.6msに道路Workerの返答コールバック・GC・標高計算も載っていたが、最終コードの実測は上記の別区間・別ピークになった。独立した起動間の最長フレームは変動し、最終Profilerで66.7msが残るため、停止の完全修正とは扱わない。[^profile] [^logs]

再現は開発サーバー上でjust measure-collider-workerとjust measure-road-streamingを順に実行する。Profilerはenv QA_PROFILE=1 QA_MODES=coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjs。ローカルcheck-allは104ファイル・1089テストと全設定検査PASS。本番ビルド1.26秒、collider.workerの出力4333.43kBを確認した。地形・建物がそれぞれWorkerを持つため、このバンドルとRapierの初期化・仮Worldの費用もある。この記録・レシピもコミット前に整形とOKFを検証する。[^tests]

[^code]: 準備済みのtrimeshと登録・中断処理。

[^serialization]: 公式のWorld snapshot API。

[^native]: インストール済みRapierの一次実装。

[^component]: 保存した前段と最終ソースでの実48タイル比較。

[^normal]: Profilerなしの夜雨8場面。

[^profile]: 最終の時計対応付きCPUプロファイル。

[^logs]: 各traceの端末JSONL。

[^tests]: 実Rapier・本番Buildingsの寿命と既存Terrain・ログの回帰検査。

[^previous]: 前段のBVH生成を確認したスタック。
