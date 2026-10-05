---
type: Metric
title: 道路反映のフレーム分割と原点変更時のコライダー再利用
description: 夜雨の道路反映を4 msのCPU予算で描画フレームへ分け、物理形状と描画資源を再利用する。原点変更の同期処理は約495 msから約3 msへ短縮。標高処理もWorkerへ移し、通常の更新は約50 msだが新地域の初回描画には約133〜150 msが残る。
tags: [roads, terrain, physics, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T19:24:00Z }
verified:
  - { by: process:vitest, at: 2026-10-05T19:19:20Z }
  - { by: process:tsc, at: 2026-10-05T19:19:21Z }
  - { by: process:headless-chrome-cdp, at: 2026-10-05T19:12:22Z }
sources:
  - id: baseline
    resource: road-surface-performance.md, ../.qa/perf/2026-10-05T18-12-21-897Z-roads/report.json
    title: 前回マージ版の夜雨の道路反映（ローカル保存）
  - id: samples
    resource: ../.qa/perf/nonblocking-second/report.json, ../.qa/perf/nonblocking-third/report.json, ../.qa/perf/nonblocking-fourth/report.json
    title: 通常プレイ・道路反映・原点変更の中間計測（ローカル保存）
  - id: final-warm
    resource: ../.qa/perf/2026-10-05T19-27-16-098Z-streaming/report.json
    title: 通常更新3回・原点変更・新地域と連続ワープ（ローカル保存、Profilerなし）
  - id: cold-worker
    resource: ../.qa/perf/2026-10-05T19-45-01-101Z-streaming/report.json, ../.qa/perf/2026-10-05T19-45-01-101Z-streaming/coldWarp.cpuprofile, ../.qa/perf/2026-10-05T19-45-01-101Z-streaming/latestWarp.cpuprofile
    title: DEM Worker導入後の新地域と連続ワープ（ローカル保存、Profilerあり）
  - id: heights
    resource: ../.qa/perf/2026-10-05T19-50-13-047Z-roads/report.json
    title: 実ゲームの地形・橋・原点変更・最後のワープの検証（ローカル保存）
  - id: dem
    resource: ../src/world/demCompute.ts, ../src/world/demData.ts, ../src/world/dem.worker.ts, ../tests/demCompute.test.ts, ../tests/waterStreaming.test.ts
    title: 標高処理のWorkerと代替経路、水面の原点変更・タイル破棄の回帰検証
  - id: code
    resource: ../src/game/frameWork.ts, ../src/game/serialWork.ts, ../src/physics/reanchor.ts, ../src/main.ts
    title: CPU予算・反映順序・原点変換
  - id: tests
    resource: ../tests/frameWork.test.ts, ../tests/reanchor.test.ts, ../tests/pavementsStreaming.test.ts, ../tests/trafficStreaming.test.ts, ../tests/streetLightsStreaming.test.ts, ../tests/roadGeometrySteps.test.ts
    title: 描画への譲歩、物理形状、歩道・駐車車両・夜の街灯の回帰検証
  - id: qa
    resource: ../scripts/qa/perf-road-streaming.mjs, ../scripts/qa/perf-road-worker.mjs
    title: 反映終了後までフレームを計測する手順
---

# 変更

道路網の計算をWorkerへ移しても、受け取った道路をシーンへ反映する同期処理と、初めての描画資源の組み立てが残った。前回マージ版は夜雨で道路反映CPU約244〜285 ms、更新時の最長フレーム400〜533 msだった。[^baseline]

`FrameWork`は実際に処理したCPU時間だけを加算し、4 msを使ったら次のrequestAnimationFrameまで待つ。Promiseのmicrotaskだけでは描画が進まないため、描画フレームを明示的に渡す。新しいMeshを公開する段階では、CPU予算内でも1段階ごとに描画を渡し、GPUの初回処理をまとめない。法令判断・道路グラフ・歩行者の接続は一度に切り替え、視覚モデルの生成を分ける。[^code]

原点変更と道路反映・歩道反映は直列にする。生成途中で座標系が変わらないよう、Workerへの依頼時と反映キューの開始時の両方で世代・原点を調べる。地形・建物・歩道のtrimeshは形状やBVHを再生成せず、既存コライダーの位置と回転を変える。歩道は逆変換した点で包含判定する。橋の床と旧歩道の衝突形状を準備中も保持し、新しい歩道の分割コライダーは無効のbodyに作ってから切り替える。[^code] [^tests]

路面の法線・境界、信号、規制標識、案内標識、街灯、街路設備も段階生成する。街灯・交差点名・補助標識・消火栓・駐車車両の描画資源を再利用する。駐車車両は押されたあとの位置と衝突形状も保持し、走行中の車は同じ道路形状があれば全道路の探索を避ける。[^tests]

# 中間計測（2026-10-06 JST）

M2 Max、Headless Chrome154、WebGPU、ultra、1280×800・DPR1、東京駅・夜雨・seed20261006。実ゲームの交通・気象を動かし、通常時を6秒、更新開始の150 ms前から反映終了後2秒まで計測した。別起動の計測を同一のA/Bと扱わない。[^samples]

| 版                        | 通常時の最長 | 道路反映の最長 | 原点変更の最長 | 原点変更の同期処理 |
| ------------------------- | -----------: | -------------: | -------------: | -----------------: |
| 第2回（歩道を同期再生成） |      33.5 ms |  49.9〜50.0 ms |       583.2 ms |           494.9 ms |
| 第3回（歩道を原点変換）   |      50.0 ms |        66.7 ms |        83.3 ms |             2.9 ms |
| 第4回（駐車車両も再利用） |      66.7 ms |        83.3 ms |       116.7 ms |             3.4 ms |

第3回は道路反映CPU229.7 ms・最大CPU区間11.6 ms、要求から完了まで約4.1秒。第4回はCPU295.7 ms・最大区間15.6 ms、約5.7秒で、駐車車両の段階は0.3 msだった。分割により一度の停止を減らす代わりに、完了までの実時間が伸びる。通常時も重くなっている第4回だけから、駐車車両の再利用でFPSが悪化したとは結論しない。走行中の車の対応付けとWorker復元後のフレーム譲歩は第4回の後に加えており、まだこの表には含めない。[^samples]

# 通常更新と新地域の計測

道路データを読み込み、プレイを開始して30秒待った`19-27-16`の実測では、通常時2回の最長フレーム33.4 / 33.5 ms、道路更新3回はすべて50.1 ms（p95は33.4〜33.5 ms）。更新CPU207.0〜223.4 ms、最大CPU区間5.6〜8.7 ms、要求から完了まで3.7〜4.5秒。検査した125個の描画Meshと16台の駐車車両は全件再利用した。原点変更は最長50.1 ms、同期変換2.5 ms。吾妻橋へ初めて移動した場合は199.9 ms、続けて別のワープを上書きした場合は349.9 msが残った。[^final-warm]

新地域のLong Animation FrameにはDEMのPromise継続処理160.6 msがあった。平滑化（5×5中央値＋3×3binomial）と測量テキストの解析を専用Workerへ移した。Workerが使えない・壊れた場合は同じ処理を4 msの予算で直列分割する。地形や水位に使うFloat32値とNaNは変えない。川岸の水位計算・水面・護岸も分割し、生成途中の原点変更では新しい座標系で作り直す。破棄済みタイルはシーンに公開しない。[^dem]

導入後の`19-45-01`はProfiler付きの別起動で、吾妻橋の最長133.4 ms（p95 50.1 ms）、連続ワープ150.0 ms（p95 50.0 ms）、例外・道路処理失敗・ログのスキーマエラー0件。実Workerと同期参照の各65,536値（地面と測量）のビット一致を確認した。初回描画にWebGPU rendererの約90〜103 msの呼び出しが残り、CPUプロファイルでは影描画のmaterial cache key計算が大きい。Profiler自体の負荷と別起動の差があるため、前後を厳密な同条件A/Bとしては扱わない。[^cold-worker]

**停止の完全解消は未達。** 新地域の描画・3Dタイルの展開には100 ms以上のフレームがある。また分割反映には数秒かかり、実行中の古い反映は最後まで進んでから新しい反映へ移る。信号・標識・街灯の見た目は段階的に公開される。この変更だけで新地域への移動を一定のフレーム時間に保証しない。従来の固定1800 msの計測窓では数秒の反映の後半を取りこぼすため、反映完了後2秒まで観測し、新地域では読み込み後も10秒を追加する。`QA_MODES`で操作、`QA_PROFILE=1`でCPUプロファイルを選べる。[^qa]

# 正しさと見つかった不具合

全体945テスト、型チェック、lint、本番buildを実行。HTTPログテストはsandbox内のlistenが拒否されるため、localhostへlistenできる環境で実行する。Rapierの実形状で、原点変更後の高さ・衝突形状のhandleの維持、歩道の穴、準備中の旧歩道の高さ、複数コライダーへの分割後の描画との一致を検証した。駐車車両の移動済み位置と衝突形状の再利用、新しい車を描画フレームへ分けることも検証した。[^tests]

実ゲームで道路中点1,183箇所の地形照会とRapierコライダーを比較し、誤差は原点変更前0.0000229 m・変更後0.0000306 m、橋12箇所は誤差0。原点変更後も車の地理座標を保持し、連続ワープの最後の東京駅座標に着地した。session `6a314adc-c645-4bc7-81e5-8c959461f6d9`はdrive_started・frame_recentered・warp_landedが同一traceで、例外・道路失敗・スキーマエラー0件。[^heights]

第2回では街灯の分割反映中に、古い灯数の配列だけが残り、`undefined.threshold`の例外が3件出た。灯を消すときに座標・live配列も空にする修正と、生成途中でも夜雨のupdateが動く回帰テストを追加した。端末ログで、session `cb088415-c52f-471d-8d76-5b20de0cf6b1`から`2a764c5d-37f1-4ea6-9ba5-4f61642e9360`への比較で3→0・goneを確認した。第3・4回の例外・道路失敗・スキーマエラーは0件。[^samples] [^tests]

測定中にHMRが起きた`2026-10-05T19-20-21-903Z-streaming`の結果は無効。再読み込み後にプレイを開始しておらず、道路も0本だったので、見かけの16.7 msを性能改善の根拠に使わない。測定スクリプトはプレイ状態・道路100本以上・反映ログ・同一sessionを検査する。[^qa]

[^baseline]: 前回マージ版の夜雨計測

[^samples]: 中間版の実プレイ計測

[^code]: フレーム予算と原点変更の実装

[^tests]: 物理と分割反映の回帰テスト

[^qa]: 全反映を含むQAスクリプト

[^final-warm]: 通常更新・新地域の実プレイ測定（Profilerなし）

[^cold-worker]: DEM Worker導入後の実プレイ測定とCPUプロファイル

[^dem]: Workerと代替処理の検証、水面の非同期生成の回帰検証

[^heights]: 実ゲームの地形コライダー・橋の高さと原点変更、最終ワープの検証
