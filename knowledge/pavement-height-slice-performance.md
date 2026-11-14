---
type: Metric
title: 歩道の高さ補正をポリゴン内でもフレーム予算で分割する
description: 実2地域96ポリゴンの4773448比較が一致。4回合計CPUは127.0→130.6ms・79.3→80.1msで削減なし、最長処理区間は5.2→4.9ms・4.3→4.1ms。夜雨の連続ワープ66.7msは残る。50ms件数の説明を訂正。
tags: [roads, terrain, rendering, physics, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T09:34:45Z }
verified:
  - {
      by: process:source-inspection-frame-stats-raw-threshold-before-display-rounding,
      at: 2026-10-06T09:34:45Z,
    }
  - { by: process:1113-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T08:47:17Z }
  - {
      by: process:chrome154-live-ground-96-polygons-4773448-values-source-hashes-and-terminal-logs,
      at: 2026-10-06T08:54:00Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T08:56:48Z,
    }
  - {
      by: process:clock-mapped-two-warp-profiler-pavement-cpu-source-hashes-and-terminal-logs,
      at: 2026-10-06T08:58:16Z,
    }
sources:
  - id: code
    resource: ../src/world/pavements.ts, ../src/game/frameWork.ts
    title: 128回の高さ照会ごとに既存の共有フレーム予算へ戻る
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/bcaffe09690df55bcaec39f744f33778dbfc22a8
    title: ポリゴン単位で戻る前段の歩道処理
  - id: component
    resource: ../scripts/qa/perf-pavement-slices.mjs, ../.qa/perf/2026-10-06T08-52-58-523Z-pavement-slices/report.json
    title: 固定した高さでの数値照合と実ゲームの地面照会での交互CPU比較（ローカル保存）
  - id: initial
    resource: ../.qa/perf/2026-10-06T08-45-38-117Z-pavement-slices/report.json
    title: 初回はCPU計測にも固定Mapを使ったため地形照会の実コストを含まない（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T08-54-30-582Z-streaming/report.json, ../.qa/perf/2026-10-06T08-54-30-582Z-streaming/night-rain.png
    title: 診断ラッパーとProfilerなしの8場面・目視した夜雨の画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T08-56-48-145Z-streaming/report.json, ../.qa/perf/2026-10-06T08-56-48-145Z-streaming/frame-stacks.json
    title: 時計対応を検証したCPUスタックと実歩道準備のCPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/079dfa2c-922d-448a-853c-4214b922030b.jsonl, ../.qa/logs/2026-10-06/33343e5d-f904-43a2-b793-58f2dc41c624.jsonl, ../.qa/logs/2026-10-06/27b1fcf6-b822-47f4-bcd0-7bfd48df8f1c.jsonl
    title: 最終3起動のtraceに限定した端末ログ（ローカル保存）
  - id: tests
    resource: ../tests/pavements.test.ts, ../tests/pavementsStreaming.test.ts
    title: 高さ照会上限、両補正パス、入力保持と大きな単一ポリゴン準備中の旧物理保持
  - id: stats
    resource: ../src/game/perf.ts
    title: 件数は丸める前のrAF間隔で数え、最長表示だけを小数1桁に丸める
  - id: previous
    resource: ground-height-query-performance.md, road-streaming-performance.md
    title: 高さ照会からのCPUと既存の非同期物理交換の契約
---

# ポリゴン内に予算確認を入れる

前段の最新ワープ66.7ms区間には、groundYからliftedHeights、rebuildSteps、FrameWork.runへ続く高さ照会があった。旧処理は各ポリゴンの末尾へ来るまでフレーム予算を確認できず、初期頂点と三角形の内部・辺の4点を2パスとも同期で照会していた。[^previous]

liftedHeightStepsは初期頂点・2パスの照会を合わせて128回ごとにyieldする。FrameWorkが共有の4ms予算を使って実際に次の描画へ戻るので、128回ごとに必ずフレームを待つわけではない。同期APIのliftedHeightsは同じgeneratorを最後まで進める。高さ補正の式・演算順・2パス・上向きの三角形・縁石・UV・物理形状は変えない。頂点、三角形、縁石の配列追加にも128要素ごと、補正値の加算には512要素ごとの境界を入れた。[^code]

三角形ごとの固定プローブ配列と描画indexの一時配列を減らすが、heap割当量を測ったわけではない。座標変換・densify・ShapeUtilsの三角形分割、TypedArray作成、Rapierのコライダー生成などの同期区間は残る。個々の高さ照会やGCも中断できないため、全処理を4ms以内に保証する変更ではない。旧物理は準備完了まで保つ。[^code] [^tests]

# 実2地域の数値とCPU

M2 Max、Native Chrome154.0.8037.97、Metal WebGPU、ultra・rooms、1280×800・DPR1、夜雨・seed20261006。東京駅の2319ポリゴンと、実ワープ後の吾妻橋883ポリゴンから、元の輪郭の頂点数が大きい48件ずつを選ぶ。densify後の最大頂点数は126・132。地域全体の全ポリゴンを比較したわけではない。[^component]

旧版はbcaffe09690df55bcaec39f744f33778dbfc22a8から保存し、参照用Viteモジュールとして読む。照合用には実ゲームのgroundYの値を座標ごとに固定し、倍精度の補正高・描画の全属性とindex・物理の頂点とindex・ポリゴンとmeshとcollider数をObject.isで比較する。CPU比較では固定Mapを使わず、旧版と変更後の両方が実ゲームのgroundYを毎回呼ぶ。結果も固定した基準値と比較する。**4773448項目が完全一致**し、ゲームと原点が計測中に交換されていないことも確認した。[^reference] [^component]

各地域4回ずつ旧→新と新→旧を交互にし、各準備の前に実フレームを挟む。4msのFrameWorkで48件をrebuildAsyncし、その測定CPU合計と最長区間を記録する。数値照合・待機・cleanupはCPUに含めない。計測中は編集・テスト・ビルドをしない。3ソースの保存ハッシュは最終版と一致した。[^component]

| 実地面照会・各4回 | 東京駅・旧 | 東京駅・変更後 | 吾妻橋・旧 | 吾妻橋・変更後 |
| ----------------- | ---------: | -------------: | ---------: | -------------: |
| CPU合計           |    127.0ms |        130.6ms |     79.3ms |         80.1ms |
| 最長区間の最大    |      5.2ms |          4.9ms |      4.3ms |          4.1ms |
| 最長区間の中央値  |     4.65ms |         4.20ms |     4.30ms |         4.10ms |
| 待機込み時間合計  |   1107.8ms |       1177.4ms |    916.5ms |        952.4ms |

CPU削減は確認できず、合計は約2.8%・1.0%増えた。長い処理区間は小さくなったが、今回選んだ実ポリゴンでは効果が小さく、待機時間も増える。大きな単一ポリゴン内で中断できる契約は単体テストで保証する。全ゲームの速度向上と読み替えない。[^component] [^tests]

初回も4773448項目は一致したが、CPU比較のcallbackを固定Mapにしていた。地面照会の実コストを含まないので性能判断に使わず、callbackを実ゲームへ変えて再計測した。初回の結果も消さず保存する。最終端末2252行は全てinfoで対象失敗0件。既存のTilesRendererのversion1.1警告は残る。[^initial] [^component] [^logs]

# 全ゲームは未解決

診断ラッパーとProfilerを外した8場面。rAF・LoAF・構造化ログは残る。40ソースの保存ハッシュが一致した。[^normal]

| 場面       | 最長rAF間隔 | 50ms超 |
| ---------- | ----------: | -----: |
| 通常1      |      33.5ms |    0回 |
| 更新1      |      33.4ms |    0回 |
| 通常2      |      33.4ms |    0回 |
| 更新2      |      33.5ms |    0回 |
| 更新3      |      50.0ms |    0回 |
| 原点変更   |      33.4ms |    0回 |
| 未読込地域 |      50.1ms |    3回 |
| 連続ワープ |      66.7ms |    3回 |

2026-10-06訂正：元の「50ms超は保存されたrAF値に対する厳密な比較で、50.0msは数えない」は表示と件数の説明として不正確だった。件数は丸める前の実rAF間隔への厳密な比較で、最長表示は小数1桁へ丸める。したがって表示が50.0msでも実際に50msを超えていれば件数に入る。この保存済みの更新3の50ms超0回という観測値は変わらない。[^stats] [^normal]

道路描画125件・駐車16件の通常更新での再利用と、原点変更の準備完了までの旧データ保持も維持された。端末3518行は全てinfo、対象失敗0件。最終画像を目視し夜・雨・車内・歩道の表示を確認した。画面には違反とYの投稿表示もあり、ワープ区間の全画素一致をこの画像で保証するわけではない。[^normal] [^logs]

別起動のCPU診断は未読込地域66.6ms・6回、連続ワープ50.1ms・1回。歩道準備883件はCPU147.5ms・最長4.8ms・38回yield・待機込み1275.6ms、2319件はCPU481.2ms・最長5.6ms・120回yield・待機込み2902.1msだった。40ソースの保存ハッシュと時計対応を確認した。外壁FacadeMaterialの同期・非同期生成はいずれも両ワープ0件で、端末3228行は全てinfo、対象失敗0件。[^profile] [^logs]

未読込地域66.6ms区間にはGC self8.756ms、影描画inclusive13.228ms、シェーダー生成inclusive5.102ms、建物のcutFootprints self3.807msがある。連続ワープ50.1ms区間には影inclusive10.903msと歩道高さ照会からのtoGeodetic self4.567msが残る。別の50.0ms区間には道路Worker返答のself4.513msがある。inclusiveとselfは重なるため合計してフレーム全体の内訳としない。描画、GC、別のストリーム処理が重なり、停止の完全修正はまだ達成していない。[^profile]

単体テストは600頂点・598三角形の高さ照会が1step128回以内、両パス計5384照会、入力不変を確認する。1600mの単一歩道では準備中に旧歩道の実Rapierレイが縁石高を返し、完了後に新歩道へ交換する。既存の穴と原点変更のテストも通った。108ファイル1113テスト、型・lint・整形・justfile・Actions・knowledge、ビルド1.84秒を確認した。[^tests]

[^code]: 本番の歩道と共有フレーム予算。

[^reference]: 保存した前段のコミット。

[^component]: 最終の実地面照会を含む数値・CPU比較。

[^initial]: 固定MapでCPUを測った初回。性能判断から除外。

[^normal]: 診断ラッパーなしの8場面。

[^profile]: 時計対応付きCPUと本番歩道の処理区間。

[^logs]: 3起動のtraceで限定した端末JSONL。

[^tests]: 高さ・中断・旧物理保持と既存の歩道テスト。

[^stats]: frameStatsの未丸めの件数判定と丸めた最長表示。

[^previous]: 前段の実ワープ計測と物理交換。
