---
type: Metric
title: 水域マスクのWorker化とタイル間のフレーム予算
description: 実水域25タイル・2解像度の全16384000画素が旧処理と一致する。Workerと共有予算のフォールバックは単体計測で最長50ms・50ms超0回。夜雨のワープには116.7msが残り、同期シェーダー生成を継続調査する。
tags: [water, terrain, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T23:29:00Z }
verified:
  - { by: process:vitest-46-water-and-log-tests, at: 2026-10-05T23:22:00Z }
  - { by: process:chrome154-real-worker-legacy-pixel-parity-and-fallback, at: 2026-10-05T23:23:00Z }
  - { by: process:chrome154-clock-mapped-cpu-profiles, at: 2026-10-05T23:25:00Z }
  - { by: process:chrome154-nonprofiled-night-rain-streaming, at: 2026-10-05T23:28:00Z }
  - { by: process:977-tests-typecheck-lint-format-build-just-actions-knowledge, at: 2026-10-05T23:31:00Z }
  - { by: process:terminal-session-log-185-lines-zero-warn-error, at: 2026-10-05T23:31:00Z }
sources:
  - id: code
    resource: ../src/world/waterCompute.ts, ../src/world/water.worker.ts, ../src/world/waterMasks.ts, ../src/world/water.ts
    title: Worker・Transferable・同じ演算を使うフレーム分割・結果の現行範囲確認
  - id: tests
    resource: ../tests/waterCompute.test.ts, ../tests/waterStreaming.test.ts, ../tests/water.test.ts, ../tests/log.test.ts
    title: 同時依頼・故障・タイムアウト・破棄・移動・連続小タイル・水域と切り抜きの検証
  - id: micro
    resource: ../scripts/qa/perf-water-masks.mjs, ../.qa/perf/2026-10-05T23-22-04-619Z-water/report.json
    title: 実水域25タイルの旧処理・本物のWorker・フォールバック比較（JSONはローカル保存）
  - id: initial
    resource: ../.qa/perf/2026-10-05T23-20-06-603Z-water/report.json
    title: タイルごとの予算ではフォールバックに停止が残った初回（ローカル保存）
  - id: before-profile
    resource: ../.qa/perf/2026-10-05T23-07-24-444Z-streaming/report.json, ../.qa/perf/2026-10-05T23-07-24-444Z-streaming/frame-stacks.json
    title: Worker前の最長フレームと時刻を対応付けたCPU（ローカル保存）
  - id: after-profile
    resource: ../.qa/perf/2026-10-05T23-23-37-205Z-streaming/report.json, ../.qa/perf/2026-10-05T23-23-37-205Z-streaming/frame-stacks.json
    title: Worker後の最長フレームと残るシェーダー生成（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-05T23-26-29-516Z-streaming/report.json
    title: Profilerなしの通常描画・更新・原点変更・新地域・連続ワープ（ローカル保存）
  - id: profiler
    resource: ../scripts/qa/perf-road-streaming.mjs, ../scripts/qa/profile-frame-stalls.mjs
    title: CDP時刻の対応検証と最長rAF区間のCPUサンプル集計
  - id: previous
    resource: scene-matrix-performance.md, rivers-and-water.md
    title: 行列更新削減後にも残る停止、水位・橋・切り抜きの条件
---

# 計測から特定した処理

行列更新を減らした親コミット7b3a61fでも、連続ワープの最長フレームは183.3msだった。この区間のCPUサンプルにはcoverage約22.8ms、dilate約19.0ms、rasterizeを含む水域マスク全体約43.3msがあった。影の描画約76.1msとシェーダー生成約71.8msも同じ区間にある。後者の分類は重複するため加算できない。[^before-profile]

CDPのTimeTicksにあるNavigationStartをperformance.nowの原点に対応付け、Performance.getMetricsのTimestampを取得の前後のページ時刻の範囲（許容1ms）と照合した。CPUプロファイルのsample/timeDeltaを、記録した最長rAF区間へ対応付けて集計する。依頼したサンプリング間隔は1msだが実際の間隔は一定でなく、個々の処理時間はサンプルによる推定値である。スクリプトのgroupsはスタック祖先を含む分類なので互いに重複する。GPUの時間や描画が終わる時刻を測った値ではない。[^profiler]

# 変更と動作の条件

水域判定用rasterと地形切り抜き用cutは、グローバルなタイル座標とポリゴンだけで決まる。WaterComputeで専用Workerへ依頼し、Uint8Arrayの2つのbufferをTransferableで返す。水位、岸の高さ、橋、物理ワールドの演算は従来の場所のまま。Workerの依存は配列演算だけで、waterGeometryの三角形生成やpavementsの物理・材質を読み込まない。[^code]

同時依頼はidで照合する。Workerの作成・postMessage・返信エラー・messageerror・実行時エラー・30秒のタイムアウトでは、入力を保持して同じ演算をFrameWorkで行う。処理途中の配列を公開せず、完成した両マスクだけをタイルへ取り付ける。ネットワーク取得後とWorker待機後に現在の読込範囲を照合し、移動で遠くなったタイルは取り付けない。WaterLayerの破棄ではWorkerを止め、待機中の計算を終了させる。[^code] [^tests]

**初回で判明した誤り**：フォールバックをSerialWorkで直列にするだけでは足りなかった。個々のタイルが4msより短いと、タイルごとのFrameWorkは一度も描画へ返さず、Promiseの連鎖を通じて約75.5ms続いた。最長フレーム100.1msだった。修正では全タイルで1つのFrameWorkを共有し、CPU予算を次のタイルにも持ち越す。小さいタイルが30個連続しても描画へ返す回帰テストを追加した。[^initial] [^tests]

# 実水域の単体比較

M2 Max、Headless Chrome154、WebGPU、1280×800・DPR1、夜雨、seed20261006、吾妻橋付近で開始後30秒。ゲームが実際に読み込んだ25タイル（21タイルが水域あり）を256と512の両解像度で計算し、50依頼を比較した。参照は親7b3a61fのrasterize/coverage/dilateをGitから取り出した、変更前の関数。参照の作成と全画素比較はフレーム計測の外で行った。[^micro]

| 方法                     | 完了まで |      計算CPU合計 | 最長フレーム | 50ms超 | 旧処理との一致 |
| ------------------------ | -------: | ---------------: | -----------: | -----: | -------------- |
| 旧同期処理               |   65.0ms | 65.0ms（ページ） |      100.0ms |      1 | 全16384000画素 |
| 本物のWorker             |  173.5ms | 71.8ms（Worker） |       50.0ms |      0 | 全16384000画素 |
| 共有予算のフォールバック |  621.6ms | 75.5ms（ページ） |       50.0ms |      0 | 全16384000画素 |

Workerは計算自体のCPUや読込完了を速める変更ではない。CPUをページから外し、入力・描画が計算を待たないようにする。フォールバックのCPUには行ごとの予算確認も含まれる。フレーム間隔は交通・描画を動かしたページ全体の値であり、マスク計算だけの時間ではない。Workerの有無とログのbackendを確認し、失敗で知らないうちにフォールバックしていた試行は成功扱いにしない。ここでは意図的なフォールバック試験の警告1件以外にruntime errorは無かった。[^micro]

初回も全画素は一致したが、旧同期83.3ms・Worker33.4ms・誤ったフォールバック100.1msだった。最長値は描画の揺れがあるため、修正後にWorkerが常に33.4msになるとは主張しない。[^initial] [^micro]

# 実ゲームの停止と残る作業

同じ東京駅開始の夜雨・ultra・seedで、通常の交通と描画を動かして計測した。Profilerありの最長フレームは新地域116.7ms、連続ワープ116.8ms。両方で25タイルを実際のWorkerが完了し、マスク計算CPUはWorker上でそれぞれ47.4ms・47.6msだった。最長3区間のページCPUでは水域マスク0msとなり、連続ワープの最長区間にはシェーダー生成約58.3ms・影描画約70.3msが残った。新地域の最長区間もシェーダー生成約62.2msがある。[^after-profile]

Profilerなしの追加計測は以下。移動後の道路データの更新、最新のワープが最終原点になったこと、更新で描画資源と駐車車両を再利用したことをスクリプトで検証した。全モードでruntime errorは0。[^normal]

| 場面                     | 最長フレーム | 50ms超 |
| ------------------------ | -----------: | -----: |
| 通常描画                 |       50.0ms |      0 |
| 道路更新                 |       33.4ms |      0 |
| 原点変更                 |       50.0ms |      0 |
| 新地域（吾妻橋付近）     |      116.7ms |     23 |
| 古い依頼を挟む連続ワープ |      116.7ms |     25 |

親のProfilerあり100.1ms/183.3msと、この変更の116.7ms/116.8msは別の起動で、建物の到着・初回パイプライン生成のタイミングも違う。水域計算を外した根拠は単体の全画素比較・Workerの使用・対応するページスタックの消失であり、ワープの最長値の差だけから因果や改善率を断定しない。水域Workerだけで停止の完全修正とはしない。次の対象は新しい描画データが見える際の同期シェーダー生成と建物タイルの処理。AI同時実行・複数目撃者・事故を含む全場面の完了監査も残る。[^before-profile] [^after-profile] [^normal]

再現：just measure-water-masks、QA_PROFILE=1 just measure-road-streaming。CPU集計はnode scripts/qa/profile-frame-stalls.mjs .qa/perf/<run>-streaming/report.json。JSONと画像は.qa/perfに保存し、計測中は編集・ビルド・テストを行わない。[^profiler] [^micro]

[^code]: 配列演算とWorkerの実装。

[^tests]: Workerの故障とタイル反映の回帰テスト。

[^micro]: 実水域の変更前・Worker・共有予算フォールバック比較。

[^initial]: 予算がタイルごとにリセットされていた最初の試行。

[^before-profile]: 親のCPUプロファイルと対応するフレームのスタック。

[^after-profile]: Worker後のCPUプロファイルと対応するフレームのスタック。

[^normal]: Profilerなしの夜雨の計測。

[^profiler]: 時刻の対応とCPUの集計を再現するスクリプト。

[^previous]: 水域の仕様と親の残る停止。
