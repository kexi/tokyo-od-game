---
type: Metric
title: 水際と道路・歩道の非同期反映を同じ直列キューで処理する
description: 実川岸652061比較が一致。両ワープの52反映が同一キュー上で重ならず、診断なし8場面のrAF50ms超は0回。ただしLoAF60.5・58.4ms、診断付き66.7ms、最大5.4秒の水際キュー待ちが残り、完全解消は未達。
tags: [water, roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T10:31:25Z }
verified:
  - { by: process:1127-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T10:31:25Z }
  - { by: process:17-shared-queue-water-frame-and-pavement-tests-and-types, at: 2026-10-06T10:19:06Z }
  - {
      by: process:chrome154-two-real-regions-652061-comparisons-five-source-hashes-and-logs,
      at: 2026-10-06T10:21:29Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-44-source-hashes-logs-and-image,
      at: 2026-10-06T10:24:00Z,
    }
  - {
      by: process:clock-mapped-cpu-and-52-queue-jobs-no-overlap-44-source-hashes-and-logs,
      at: 2026-10-06T10:26:13Z,
    }
sources:
  - id: code
    resource: ../src/main.ts, ../src/world/water.ts, ../src/game/serialWork.ts, ../src/game/frameWork.ts
    title: 既存の直列キューの共有と、水際タイルをまたぐCPU予算
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/efda170c8931b01b9f41caa2a4c0feaa93656d4f
    title: 前段PR28の独立した水際キュー
  - id: component
    resource: ../scripts/qa/perf-water-samples.mjs, ../.qa/perf/2026-10-06T10-20-04-694Z-water-samples/report.json
    title: 固定した実2地域の川岸・全標高サンプルと前段比較（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T10-21-29-229Z-streaming/report.json, ../.qa/perf/2026-10-06T10-21-29-229Z-streaming/night-rain.png
    title: 診断ラッパーなし8場面のrAF・LoAFと目視した夜雨の画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T10-24-00-556Z-streaming/report.json, ../.qa/perf/2026-10-06T10-24-00-556Z-streaming/frame-stacks.json
    title: 時計対応付きCPU、水際・道路のキュー実行区間と待機時間（ローカル保存）
  - id: qa
    resource: ../scripts/qa/perf-road-streaming.mjs, ../scripts/qa/profile-frame-stalls.mjs
    title: 詳細計測でキューの実行開始・終了と同時実行数を記録する
  - id: logs
    resource: ../.qa/logs/2026-10-06/d2f11fe3-7ffe-4c1d-8e33-8c46b86f93ce.jsonl, ../.qa/logs/2026-10-06/3c955b93-3f92-4971-bc9f-0c70c24000e2.jsonl, ../.qa/logs/2026-10-06/fbd407fc-3737-42c7-b9f8-61b741ff9c3b.jsonl
    title: 3計測をtraceで限定した端末JSONL（ローカル保存）
  - id: tests
    resource: ../tests/waterStreaming.test.ts, ../tests/frameWork.test.ts, ../tests/pavementsStreaming.test.ts, ../justfile
    title: 待機中の生成・原点変更・削除・破棄と、小タイルをまたぐ予算の保証
  - id: previous
    resource: water-sample-performance.md, water-mask-performance.md, road-streaming-performance.md, violation-hitch.md
    title: 残った複数FrameWorkの重なり、既存の予算共有・直列反映、写真の現像Workerと残る描画
---

# 既存キューを共有する

前段の連続ワープのLoAF51.1msにはtick18.1ms、道路Worker返答11.5ms、独立したFrameWorkコールバック8.0・5.8msがあった。道路・歩道・原点変更は既にroadUpdatesで直列化していたが、水際の生成はWaterLayerの別のtileWorkだった。[^previous]

WaterLayerは任意のSerialWorkを受け取り、本番mainは既存のroadUpdatesを渡す。タイルの川岸・水面・護岸生成が、道路反映・歩道反映・原点変更と同じキューで順番に進む。ほかの呼び出し元には従来どおり自分のキューを作る既定値を残す。ネットワーク・DEM・ゲージ・水域Workerの待機はキューの外で、全データが届いてから生成をキューへ入れる。[^code]

道路・歩道のキュー内コールバックはwater.aroundをawaitしない。water.setRoadsAsyncも渡されたFrameWorkで直接走るので、同じキューを再び待つ循環を作らない。キュー待機後にタイル参照を確認し、移動・破棄で無効になったタイルは生成しない。水際のFrameWorkは全タイルで1つを持ち、前の小タイルの末尾に使ったCPU予算を次へ持ち越す。[^code] [^tests]

共有するのは非同期反映の実行順で、すべてのmain-thread処理のCPU予算ではない。Worker返答、地形・建物の更新、描画、写真、GCはこのキューの外にもある。別のFrameWorkを使う次のジョブが同じ描画フレームで始まる余地もあり、全処理に4msの上限を保証する変更ではない。[^code]

# 実データの一致と直列実行

M2 Max、Native Chrome154.0.8037.98 / Metal WebGPU、ultra・rooms、1280×800・DPR1、夜雨・seed20261006。efda170のWaterLayer・DemStoreを保存し、東京駅と実ワープ後の吾妻橋の読み込み済みMapを固定して、各16輪郭・2396点／1839点を比較する。川岸の座標・Float32水位・潮位、全標高サンプル、各水位選択、境界水域判定・checksumの**652061比較がObject.isで一致**した。5ソースのハッシュが一致。これは固定した入力の演算の比較で、到着時刻が違うすべてのネットワーク実行の形状一致ではない。[^component]

各4回の川岸CPUは東京駅129.6→129.0ms、吾妻橋76.5→74.7ms。単一next最大は東京駅0.7→0.7ms、吾妻橋0.7→0.8ms。計算は変えておらず、この小差からCPU削減は主張しない。コピー・比較・待機・保存をCPUから除き、計測中は編集・テスト・ビルドをしない。[^component]

詳細QAはWaterLayerが持つ共有キューのrunをラップし、実行開始・終了・同時実行数を記録する。呼び出しスタックのWaterLayer.fetchTileを水際、それ以外の本番mainからの反映を道路側（歩道・原点変更を含む）に分類する。[^qa]

| ワープ     | 水際ジョブ | 道路側ジョブ | 実行期間の重なり | 水際の最大キュー待機 |
| ---------- | ---------: | -----------: | ---------------: | -------------------: |
| 未読込地域 |         21 |            4 |              0件 |             5403.6ms |
| 連続       |         21 |            6 |              0件 |             3251.8ms |

全52ジョブの同時実行数が1で、記録を開始順に端末で再照合しても期間の重なりは0だった。長いジョブが終わるまで後続の水際生成が待つため、**最大約5.4秒の待機**がある。待機はCPU占有ではないが、表示の準備が遅くなる制約として残す。新しいキューは導入しておらず、全52ジョブ・すべてのCPU処理が4msで完了するという意味ではない。[^profile] [^code]

# 全ゲームの結果と残った停止

診断ラッパー・Profilerなしの8場面。rAF・LoAF・構造化ログは残る。44本番ソースの保存ハッシュが一致し、道路125・駐車16件の再利用、原点変更中の旧フレーム保持、最新ワープへの着地が通過。夜雨の建物・歩道・車内を目視したが、違反とYの表示を含み、全画像比較ではない。[^normal]

| 場面       | 最長rAF間隔 | 50ms超 |
| ---------- | ----------: | -----: |
| 通常1      |      33.4ms |    0回 |
| 更新1      |      50.0ms |    0回 |
| 通常2      |      33.4ms |    0回 |
| 更新2      |      33.5ms |    0回 |
| 更新3      |      50.0ms |    0回 |
| 原点変更   |      33.5ms |    0回 |
| 未読込地域 |      50.0ms |    0回 |
| 連続ワープ |      50.0ms |    0回 |

50ms超は丸める前のrAF間隔で判定する。8場面で0回でも、LoAFは未読込地域60.5ms（tick40.3ms・建物Worker返答8.9ms）、連続58.4ms（tick38.6ms）を記録した。rAFだけから停止の完全解消とは結論しない。未読込地域の観測完了25.165秒・道路反映8.756秒、連続16.642秒・3.238秒。前段の別起動の23.521秒・16.147秒より短縮したとはしない。[^normal] [^previous]

別起動の診断は未読込地域50.1ms・50ms超4回、連続66.7ms・3回。before36523.400 ≤ mapped36523.985 ≤ after36542.300msで時計を照合し、44ソースが一致した。外壁FacadeMaterialの同期・非同期生成は両方0回。歩道883・2319ポリゴンの準備はCPU139.2・484.2ms、最大CPU区間は両方5.4ms。[^profile]

連続66.7msの1区間にはGC self10.274ms、影inclusive10.460ms、歩道からのecefToGeodetic self3.552ms、地形colliderMeshからのgetZ self3.177msがある。別の66.7msにはWitnessShot.photo self43.421ms、updateTexture self13.471ms、spatialAudioのget placed self9.808msがあった。写真は既に暗室Workerで現像するため、このselfをJPEG現像と断定せず、次はphotoの描画・読み戻しを調べる。別50.1msには道路Worker返答self3.755msと歩道heightAt self2.523ms。selfとinclusiveを加算して全体CPUの内訳にしない。[^profile] [^previous]

端末ログは部品2262行（info2261・warn1）、全体3641行・診断3281行は全てinfo。部品のwarnはtide_table_failed（外部fetch失敗）。対象の道路・水域・Worker・未捕捉例外・ログスキーマ失敗は0件。[^logs]

追加4テストは、道路処理が描画へ譲っている間の水際待機、待機後の新原点でのFloat32描画位置、タイル削除・破棄後の公開抑止、小タイルの末尾予算を次の川岸生成へ持ち越すことを検証する。既存のFrameWork・歩道も含む17テストと型検査が通過した。[^tests]

最終の全109ファイル1127テスト、型・lint・整形・justfile・Actions・knowledgeが通過し、本番ビルドは1.13秒。HTTPログ検査を含むcheck-allにはlocalhost待受権限を付けた。[^tests]

停止の完全解消は未達。キューの待ち時間・ジョブ間のCPU予算、独立したWorker返答、写真、影・GCを残った対象とする。再現はQA_REFERENCE=efda170c8931b01b9f41caa2a4c0feaa93656d4f just measure-water-samples、QA_TIMING_ONLY=1 just measure-road-streaming、QA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streaming。[^qa] [^component] [^profile]

[^code]: 既存キューの共有とタイル間の予算。

[^reference]: 前段の固定ソース。

[^component]: 実2地域の演算とCPUの一致・計測。

[^normal]: 診断なし8場面とLoAF。

[^profile]: 時計対応付きCPUとキューの実行・待機区間。

[^qa]: キューの同時実行数を確認するQA。

[^logs]: trace限定の端末ログ。

[^tests]: 待機・原点・キャンセル・予算の保証。

[^previous]: 前段と既存の水域・写真の条件。
