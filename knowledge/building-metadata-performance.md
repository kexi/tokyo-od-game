---
type: Metric
title: 未使用の建物属性表の解析を省く
description: PLATEAUのB3DM属性表をローダー前で省略。実タイル39件のGLB・頂点・ID・行列が一致し、属性準備CPUは約18→0.3〜0.4ms。夜雨の新地域116.7ms・連続ワープ83.3ms、原点変更66.6msは残る。
tags: [plateau, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T00:13:00Z }
verified:
  - { by: process:vitest-7-building-metadata-contracts-and-typecheck, at: 2026-10-06T00:06:00Z }
  - { by: process:chrome154-39-real-near-far-tile-parity, at: 2026-10-06T00:10:00Z }
  - { by: process:chrome154-clock-mapped-night-rain-profile, at: 2026-10-06T00:08:00Z }
  - { by: process:chrome154-nonprofiled-five-streaming-scenarios, at: 2026-10-06T00:13:00Z }
  - { by: process:984-tests-typecheck-lint-format-build-just-actions-knowledge, at: 2026-10-06T00:15:00Z }
sources:
  - id: code
    resource: ../src/world/buildingMetadata.ts, ../src/world/buildings.ts
    title: 属性省略プラグインと近景・遠景の利用箇所
  - id: loader
    resource: ../node_modules/3d-tiles-renderer/src/core/renderer/loaders/B3DMLoaderBase.js, ../node_modules/3d-tiles-renderer/src/core/renderer/utilities/FeatureTable.js, ../node_modules/3d-tiles-renderer/src/three/renderer/loaders/B3DMLoader.js, ../node_modules/3d-tiles-renderer/src/three/renderer/tiles/TilesRenderer.js
    title: 3d-tiles-renderer 0.5.3の属性表・RTC_CENTER・GLB・公開parseTileの流れ
  - id: spec
    resource: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/Batched3DModel/README.adoc
    title: B3DMの任意Batch Table・必須Feature Table・GLB境界と末尾padding
  - id: before
    resource: ../.qa/perf/2026-10-05T23-35-56-002Z-streaming/frame-stacks.json
    title: 連続ワープの長いフレームの属性JSON解析（ローカル保存）
  - id: partial
    resource: ../.qa/perf/2026-10-06T00-00-59-625Z-streaming/report.json, ../.qa/perf/2026-10-06T00-00-59-625Z-streaming/frame-stacks.json
    title: Feature Table末尾の境界を限定した初回実装に残った解析（ローカル保存）
  - id: parity
    resource: ../scripts/qa/perf-building-metadata.mjs, ../.qa/perf/2026-10-06T00-09-07-001Z-building-metadata/report.json
    title: 最終版の実タイル比較・部品CPUの4往復計測・URLとSHA256（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T00-06-20-394Z-streaming/report.json, ../.qa/perf/2026-10-06T00-06-20-394Z-streaming/frame-stacks.json
    title: 省略対象から外れたタイルの記録を含む修正後のCPU計測（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T00-10-32-200Z-streaming/report.json
    title: Profilerなしの通常・更新・原点変更・新地域・連続ワープ（ローカル保存）
  - id: tests
    resource: ../tests/buildingMetadata.test.ts
    title: 文字列・バイナリRTC_CENTER、境界違い、GLB、入力保持、非対応形式、標準パーサーへの委譲
---

# 解析を省く理由

外壁の影を簡略化した後、連続ワープの最長100.1msの区間には、FeatureTableコンストラクタ(Q$1)約31.1msとTextDecoder.decode約25.6msがあった。スタックはBatchTableを作るB3DMLoaderBaseへ続く。ローダーはB3DMのBatch Table JSONを同期的に展開する。[^before] [^loader]

ゲームにはその建物属性を読む箇所がない。外壁の種類・高さ・切り抜き・衝突用頂点はメッシュから作り、建物IDもGLBの頂点属性を使う。遠景は読み込んだ後で属性表を破棄していたが、解析時間はすでに支払っていた。利用箇所をsrc/とtests/で検索して確認した。[^code]

BuildingMetadataPluginはB3DMの属性表の区間を取り除いてから、同じTilesRendererの公開parseTileへ渡す。ネットワーク取得・URL・タイル・AbortSignalを既存の処理へ引き継ぐ。Batch Tableは任意で、BATCH_LENGTHとRTC_CENTERを持つFeature Tableと、建物IDを含むGLBは必要なので保持する。GLBの宣言長に含まれる全バイトを変更しない。[^code] [^loader] [^spec]

GLBの開始を8バイト境界にするため、必要な詰め物をFeature Tableのバイナリの**末尾**に追加する。JSONの長さやバイナリ属性の相対オフセットを動かさず、バイナリRTC_CENTERも同じ位置から読める。コンテナの長さも8バイトへ切り上げ、末尾の0バイトはGLBの宣言長から外れる。ヘッダーとGLBの形式・長さが対応しないデータ、別のタイル形式、属性表のないタイルは元のパーサーへ戻す。[^code] [^loader] [^tests]

この最適化は属性UIを持たないPLATEAUのBuildingsに限定する。将来Batch Tableの属性を使うときは省略を外す必要がある。ライブラリ全体のパーサーを差し替えず、プロパティを必要とする他の利用者まで変更しない。[^code]

# 実タイルでの一致とCPU

M2 Max・Chrome154・WebGPU・1280×800・DPR1・夜雨・seed20261006。東京駅で実ゲームを30秒進め、近景15件と遠景24件、重複を除く39件のURLを取得した。配信内容を再取得し、各入力のURL・SHA256・バイト数をJSONへ残した。[^parity]

GLBの全3654000バイトが一致。実際のB3DMLoaderで双方を再度デコードし、39メッシュの頂点・法線・建物ID・インデックス・world行列など全1601721値も一致した。インターリーブ属性の元配列も比較した。Feature TableのJSON、建物数、メッシュ構成・グループも一致した。この39件ではFeature Tableへの追加paddingは0件で、境界違いとバイナリRTC_CENTERは別の7件の契約テストで確認した。GPUの全画素比較や衝突後の実走行比較は今回の測定には含めない。[^parity] [^tests]

同じ39入力を旧パーサーと省略＋パーサーで、順序を入れ替えて4回ずつ計測した。データ取得・形状比較は時間の対象外。

| 対象                       |            旧 |       省略後 |
| -------------------------- | ------------: | -----------: |
| 属性準備を含むCPU          |  17.8〜18.6ms |   0.3〜0.4ms |
| 1タイルの最長CPU           |    3.2〜3.5ms |        0.1ms |
| 保持する入力コンテナの合計 | 12397996bytes | 3655928bytes |
| 計測中の最長rAF間隔        |    33.4〜50ms |       33.4ms |
| 50ms超                     |           0回 |          0回 |

これは部品の比較で、ゲーム全体のCPU・フレーム時間・ヒープ削減率ではない。旧処理もこの小さな39入力の比較では50ms超を起こしていない。実ゲームで556件の省略が記録され、コピーの最長は1.1ms。端末保存の597行のログは警告・エラー0件だった。[^parity]

# 最初の適用範囲の不足

最初はFeature Tableの末尾がすでに8バイト境界のときだけ省略した。実ワープでは295件を省略しても、最長100msの区間にBatchTable由来のコンストラクタ約20.5msとdecode約20.3msが残った。この時点では適用外タイルの一覧を記録していなかったため、個々の原因を断定しない。[^partial]

Feature Table末尾にも詰め物を追加できるようにし、文字列・バイナリRTC_CENTERの値が保たれることをテストした。再計測の新地域103件・連続ワープ294件を省略し、JSON属性のあるB3DMを適用外へ戻した件数は両方0だった。省略のコピーCPUは合計5.6/14.2ms、1件の最長0.6ms。各場面の最長3区間のCPU上位に、以前の大きなBatch Tableの展開は現れなくなった。CPUサンプリングで全解析時間が厳密に0msになったとは扱わない。[^tests] [^profile]

# 停止はまだ残る

Profilerありでは新地域116.5ms・連続ワープ100ms。新地域の最長区間には通常のシェーダー生成約75.3msが残る。連続ワープの最長区間はシェーダー生成約17.9ms・GC約12.0ms・道路網の復元約9.1msなど。包含分類は重複するため加算しない。[^profile]

Profilerなしの一通りの計測では次の値だった。

| 場面                     | 最長rAF間隔 | 50ms超 |
| ------------------------ | ----------: | -----: |
| 通常プレイ               |      33.4ms |    0回 |
| 同じ道路の更新           |      33.4ms |    0回 |
| 原点変更                 |      66.6ms |    3回 |
| 新地域への移動           |     116.7ms |   12回 |
| 古い依頼を挟む連続ワープ |      83.3ms |   12回 |

runtime errorは全場面0。道路の資源再利用、原点変更中の位置保持、最後のワープの原点と道路更新完了もスクリプトの検査を通った。別の実行との最長値の差だけで改善率を主張しない。特に原点変更の66.6ms・新地域116.7msは残っており、停止の完全修正とはしない。次は表示前のシェーダー準備と、建物の頂点・外壁・切り抜きの一括処理を調べる。[^normal] [^profile]

再現はjust measure-building-metadata。実ゲームはQA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streamingと、ProfilerなしのQA_MODES=baseline,update,recenter,coldWarp,latestWarp。計測中は編集・テスト・ビルドをしない。

[^code]: 近景・遠景の利用箇所と省略処理。

[^loader]: インストール済みローダー0.5.3の処理。

[^spec]: CesiumGSのB3DM形式の一次仕様。

[^before]: 変更前の属性JSON解析のCPUスタック。

[^partial]: 最初の適用範囲が狭かった実装の計測。

[^parity]: 最終版の実タイル比較と4往復の部品計測。

[^profile]: 境界補正後の時刻対応付きCPUプロファイル。

[^normal]: Profilerなしの5場面の実測。

[^tests]: 既存パーサーとの契約テスト。
