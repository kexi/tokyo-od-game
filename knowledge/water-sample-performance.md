---
type: Metric
title: 川岸の水位照会で直前の水域・実測標高タイルを再利用する
description: 実川岸2地域の652061比較が完全一致。各4回の川岸生成CPU合計332.1→205.9msで約38%減。夜雨の両ワープは50.1ms・50ms超各1回で、停止の完全解消は未達。
tags: [water, terrain, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T10:09:16Z }
verified:
  - { by: process:1123-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T10:09:16Z }
  - { by: process:34-water-and-dem-tests-and-types, at: 2026-10-06T09:58:00Z }
  - {
      by: process:chrome154-final-two-real-regions-652061-comparisons-and-five-source-hashes,
      at: 2026-10-06T10:07:00Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-43-source-hashes-terminal-logs-and-image,
      at: 2026-10-06T10:03:34Z,
    }
  - { by: process:clock-mapped-warp-profiles-43-source-hashes-and-terminal-logs, at: 2026-10-06T10:05:00Z }
sources:
  - id: code
    resource: ../src/world/dem.ts, ../src/world/water.ts
    title: 実測標高と水域のタイル参照の再利用と、到着・交換・削除での無効化
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/b0106a2b8d732c71bf92b4c191600a8e638706f5
    title: 固定した前段のDemStoreとWaterLayer
  - id: component
    resource: ../scripts/qa/perf-water-samples.mjs, ../.qa/perf/2026-10-06T10-05-31-860Z-water-samples/report.json, ../.qa/perf/2026-10-06T09-59-19-562Z-water-samples/report.json
    title: 実2地域の川岸・水位・潮位・全標高サンプルと4回の交互CPU比較（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T10-01-06-529Z-streaming/report.json, ../.qa/perf/2026-10-06T10-01-06-529Z-streaming/night-rain.png
    title: 診断ラッパーなしの8場面と目視した夜雨の画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T10-03-34-062Z-streaming/report.json, ../.qa/perf/2026-10-06T10-03-34-062Z-streaming/frame-stacks.json
    title: 時計対応付き両ワープのCPUと残った歩道・道路返答・影・GC（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/fc6bc214-d8cb-4bad-ab40-03b4442e8b45.jsonl, ../.qa/logs/2026-10-06/e32a44e8-de55-4cd9-8eb2-1ca60be2d35b.jsonl, ../.qa/logs/2026-10-06/a2906674-8759-422b-83b2-660db51b1a8f.jsonl, ../.qa/logs/2026-10-06/ea03cd6e-548e-47f8-bedb-df6ffa23f392.jsonl
    title: 4計測をtraceで限定した端末JSONL（ローカル保存）
  - id: tests
    resource: ../tests/demSampling.test.ts, ../tests/waterStreaming.test.ts, ../tests/water.test.ts, ../tests/demCompute.test.ts, ../justfile
    title: 直前タイルの検索回数・負座標・NaN・到着・交換・削除・破棄と既存の水位・Worker
  - id: previous
    resource: building-footprint-performance.md, water-mask-performance.md, rivers-and-water.md
    title: 前段の水際照会のCPU、水域Workerと水位・護岸・橋の契約
---

# 残った水際の計算

前段の長いフレームにshoreRingSteps→levelAt→samplesAtからのsurveyedAt・isWaterがあった。岸の1点で半径30m・5m刻みの113点を読み、多くが同じ水域タイル・実測DEMタイルに属する。毎回の文字列キー生成とMap検索を、直前のタイルの参照で省く。[^previous] [^code]

DemStore.surveyedAtはfloorしたタイル座標が一致すると同じFloat32Arrayを読む。欠損は記憶せず、loadSurveyedが結果を登録するたびに参照を無効化する。WaterLayer.isWaterも直前のWaterTileを使い、fetchTileの登録、aroundの削除、disposeのclearで無効化する。空の水域タイルも同じオブジェクトのrasterとpolygonsを読む。[^code] [^tests]

標高値や水位の計算結果を記憶する変更ではない。画素のfloor・負座標の剰余・rasterの境界・NaNと欠損の扱い、標高補間・水位選択・ゲージ補正・川岸の平滑化は維持する。配列内容の更新も参照から読める。private Mapの変更は上記の公開処理で行う前提で、外部から非公開Mapを直接置き換えることへの保証ではない。heap割当量は計測していない。[^code] [^tests]

# 実川岸の一致とCPU

M2 Max、Native Chrome154.0.8037.98 / revision b859317bf11f6be47f9b7799ec690a0a42a1fb33、Metal WebGPU、ultra・rooms、1280×800・DPR1、夜雨・seed20261006。旧処理をb0106a2から保存し、東京駅と実ワープ後の吾妻橋で読み込み済みMapを固定して比較する。Mapのコピーが同じ実データ配列を保持し、比較対象が変わらないようにする。[^reference] [^component]

各地域の25水域タイルから頂点数の多い16輪郭を選ぶ。実測DEMは東京駅15・吾妻橋31タイルが非null。川岸を6m刻みへ分割した東京駅2396点・吾妻橋1839点で、全標高サンプル、各水位選択、川岸の座標・Float32水位・潮位、タイル境界の水域判定と反復checksumをObject.isで比較し、**652061項目が完全一致**した。輪郭入力と旧川岸結果はreportに保存し、実DEMの全配列を保存したものではない。[^component]

各1回を温めた後、各4回を旧→新／新→旧の交互に計測する。ジェネレーターのnextのCPUだけを加算し、4msごとに実フレームへ戻す。選択・Mapコピー・比較・待機・保存はCPUに含めない。計測中は編集・テスト・ビルドを行わない。最終5ソースのハッシュを照合した。[^component]

| 各4回の川岸生成CPU |      旧 |  変更後 |
| ------------------ | ------: | ------: |
| 東京駅・16輪郭     | 199.9ms | 130.0ms |
| 吾妻橋・16輪郭     | 132.2ms |  75.9ms |
| 全32輪郭           | 332.1ms | 205.9ms |

合計約38%減、地域ごとには約35%・43%減。単一next最大は東京駅0.9→0.7ms、吾妻橋1.0→0.7ms。時間分解能と揺れがあるので本番の上限とは扱わない。全ゲームや全水域の改善率へ読み替えない。[^component]

計測スクリプトのdone条件に名前を付ける前の別起動でも652061項目が一致し、201.9→128.2ms、134.4→76.3msだった。最初は最大nextが吾妻橋で旧・新とも0.9msだった。本番2ソースは両計測と全ゲーム計測を通じて同じで、最終再計測後にも変更していない。[^component]

最終の部品計測の端末2348行、最初の部品計測2308行は全てinfo、対象失敗0件。[^logs]

# 全ゲームは未解決

診断ラッパーとProfilerを外した8場面。rAF・LoAF・構造化ログは残る。43本番ソースの保存ハッシュが一致した。[^normal]

| 場面       | 最長rAF間隔 | 50ms超 |
| ---------- | ----------: | -----: |
| 通常1      |      33.5ms |    0回 |
| 更新1      |      50.0ms |    0回 |
| 通常2      |      33.4ms |    0回 |
| 更新2      |      33.4ms |    0回 |
| 更新3      |      33.4ms |    0回 |
| 原点変更   |      33.5ms |    0回 |
| 未読込地域 |      50.1ms |    1回 |
| 連続ワープ |      50.1ms |    1回 |

50ms超の回数は表示を丸める前のrAF間隔で判定する。通常の道路125・駐車16件再利用、原点変更中の旧フレーム保持、最新ワープへの着地が通過した。未読込地域の観測完了23.52秒・道路反映8.376秒、連続16.147秒・3.108秒。最終画面で夜雨の建物・歩道・車内を目視したが、違反・Y表示もあり、全画像比較ではない。端末3667行は全てinfo、対象失敗0件。[^normal] [^logs]

別起動の診断は両ワープ50.1ms、50ms超3回／1回。時計対応はbefore33839.700 ≤ mapped33840.225 ≤ after33861.400ms。43ソースが一致、端末3214行は全てinfo。外壁FacadeMaterialの同期・非同期生成は両ワープ0件を維持した。[^profile] [^logs]

未読込地域の最長3区間には影inclusive12.000・7.462・7.512ms、別区間にGC self10.385msがある。最初の区間のtoLocal self2.977msはterrain.updateからだった。連続ワープの最長区間は歩道liftedHeightStepsからのtoGeodetic self5.990ms、影inclusive4.831ms。別50.0ms区間には道路Worker返答self4.518ms、水際からのisWater self1.504ms、別区間には歩道のtoGeodetic self7.510msがある。selfとinclusiveは重なるため足し合わせない。[^profile]

歩道の準備は883ポリゴンCPU141.9ms・最大5.7ms、2319ポリゴンCPU494.0ms・最大7.9ms。道路反映の最大区間は10.6・9.1ms。連続ワープのLoAF51.1msにはtick18.1ms、Worker返答11.5msと独立したFrameWorkコールバック8.0・5.8msが重なった。道路と歩道自身はroadUpdatesで直列化済みで、初回yieldも既にある。独立した水際の作業、同期の1区間、描画・GCとの重なりを引き続き調べる。[^profile] [^previous]

前段の別起動の両ワープ66.7・66.6msと今回50.1・50.1msは、到着タイミング・GC・描画が異なる。ワープの差をこの変更だけの改善と断定しない。部品CPUを減らせたが、停止の完全修正は未達成。再現はjust measure-water-samples、env QA_TIMING_ONLY=1 just measure-road-streaming、env QA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streaming。[^component] [^normal] [^previous]

追加4テストは実測DEMの連続照会・負座標・NaN・後からの到着・交換と、水域raster境界・タイル交換・移動による削除・破棄を保証する。全109ファイル1123テスト、型・lint・整形・justfile・Actions・knowledgeが通過。本番ビルドはjust build-appで1.55秒。最初に指定したjust buildは存在せず、ビルド処理は始まっていなかった。正しいレシピで実行して成功した。HTTPログ検査を含むcheck-allにはlocalhost待受権限を付けた。[^tests]

[^code]: 直前の実測標高・水域タイル参照と無効化。

[^reference]: 比較に固定した前段のソース。

[^component]: 実川岸2地域の全サンプル・形状・水位と交互CPU。

[^normal]: 診断ラッパーなしの8場面。

[^profile]: 時計対応付きの最長フレームとCPU。

[^logs]: trace限定で検査した端末ログ。

[^tests]: 到着・交換・破棄と既存の水位・DEMの検証。

[^previous]: 前段の残った照会と水域の条件。
