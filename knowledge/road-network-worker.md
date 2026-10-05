---
type: Metric
title: 道路網・規制の Worker 化と、路面の再生成に残る停止
description: 道路網構築と規制適用をWorkerへ移し、クラス・区間参照を復元して反映する。夜雨の計算単体で最長フレーム116〜167→33.4 ms。路面生成の停止は続く。2026-10-06訂正：当初の道路セルインデックスはWorkerで準備されていなかった。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T22:26:39Z }
verified:
  - { by: process:vitest, at: 2026-10-05T17:46:00Z }
  - { by: process:tsc, at: 2026-10-05T17:46:00Z }
  - { by: process:vite-build, at: 2026-10-05T17:46:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-10-05T17:49:00Z }
  - { by: process:production-chrome-cdp, at: 2026-10-05T17:51:00Z }
  - { by: process:road-index-vitest-and-chrome154, at: 2026-10-05T22:26:39Z }
sources:
  - id: code
    resource: ../src/world/roadNetworkBuilder.ts, ../src/world/roadNetwork.worker.ts, ../src/world/roadNetworkData.ts, ../src/world/roads.ts, ../src/main.ts
    title: Worker・データ復元・道路と原点の切り替え
  - id: tests
    resource: tests/roadNetworkWorker.test.ts, tests/regulations.test.ts, tests/log.test.ts
    title: 規制の同値性、参照の復元、古い依頼の破棄、失敗・破棄時の完了
  - id: measurements
    resource: ../scripts/qa/perf-road-worker.mjs, ../.qa/perf/2026-10-05T17-48-07-064Z-roads/report.json
    title: 最終版の夜雨の実測と連続ワープ検証（JSONはローカル保存・git管理外）
  - id: first-measurements
    resource: ../.qa/perf/2026-10-05T17-43-14-445Z-roads/report.json
    title: 初回のWorker比較（反映処理の内訳を追加する前、ローカル保存）
  - id: production-smoke
    resource: ../.qa/perf/worker-production/report.json, ../.qa/perf/worker-production/night-rain.png
    title: production buildのWorker起動と夜雨の描画確認（ローカル保存）
  - id: initial-prototype
    resource: render-performance.md
    title: 先行するWorker試作で約100 msの規制処理を見つけた記録
---

# 実装の範囲

2026-10-06 JST追記：下記はWorker導入直後の計測。続く[地形照会・描画資源の再利用](road-surface-performance.md)で、路面生成の中央値868→162 ms、更新時の最長フレーム間隔1783→500 msまで短縮した。停止はまだ残る。

`RoadGraph` の構築と `applyRegulations` を1個の常駐module Workerへ移した。メインスレッドで初期化時にWorkerを起動し、道路タイルが揃ってから生の `RoadLine[]`・規制・原点を送る。シーン、描画、物理ワールドはメインスレッドに残る。追加パッケージは無く、production WorkerのJSは約210 KB。[^code]

Workerは計算済みの区間、節点、道路の空間インデックス、規制を返す。区間への参照はID、Vector3は数値の組に変換する。受信後に本物の `RoadGraph` / `Vector3` を作り、横断歩道・標識・右左折規制・車線用途を同じ区間オブジェクトへ結び直す。停止標識と停止線の共有参照、単独の停止標識が持つ線の両方を復元する。`Object.setPrototypeOf` で全オブジェクトを巡る方法は使わず、必要な型を明示している。[^code] [^tests]

> **2026-10-06 JST訂正**：「道路の空間インデックスを返す」は、当初の実装では不正確だった。`snapshot()`は遅延生成の`pieces`をそのまま返し、Worker内でその生成を呼ばなかったため通常はnullだった。規制適用の別のGridはWorkerで計算されるが、この道路セルとは異なる。[近傍検索の改善](road-nearest-performance.md)でsnapshot時にセルを準備するように変更し、実Workerから復元したMapが照会前から存在することと、旧探索との4,776件の一致を確認した。当初の記述は訂正の経緯として残す。

同時に処理する依頼は1件、待ち行列は最新の1件のみ。新しい依頼で古いPromiseは `null` で完了し、古い応答は復元・適用しない。Worker起動失敗、実行エラー、返信の復号エラー、送信失敗、15秒のタイムアウトではWorkerを終了し、最新依頼を同じ計算の同期フォールバックで処理する。`dispose` は待っているPromiseをすべて完了させる。フォールバックでは計算のメインスレッド占有が戻る。[^tests]

# 切り替えと古い座標の扱い

- 計算待ちの間は現在の道路網を維持する。結果の世代と要求時の `LocalFrame` が現在と一致するときだけ、最新のゲーム時刻を適用して道路網・交通・信号・路面・標識を同期で切り替える。
- 浮動原点の移動は、移動先の道路網ができるまで現在の原点を維持する。準備できたら車・カメラ・地形等の座標変換と道路網の切り替えを同じタスクで実行する。計算中に車が進んでも、変換時点の車の位置を変換する。
- 連続ワープでは前の場所のタイル要求と道路計算を無効にし、最後の行き先のみ採用する。近距離ワープで原点移動が一度取り消された場合も再試行し、旧原点を目的地と誤認して着地させない。
- Worker内の規制警告はデータとして返してメインで `warn()` する。ページのtraceId・`roads-N` spanを維持し、`.qa/logs/` の同じ経路で追える。計算は `road_network_prepared`、反映は `road_network_built` の `durationMs` / `stagesMs`、失敗は `road_worker_failed` / `road_network_failed`。

# 実測（2026-10-06 JST）

M2 Max / Headless Chrome 154 / WebGPU / reversed depth / ultra、1280×800・DPR 1。東京駅付近で夜・雨、交通と時刻は動かしたまま停車。seed `20261006`、開始指定 `35.681236,139.767125`、開始後30秒待った。元の道路線1,053本から1,189区間を構築、入力はJSON換算762,658 bytes。先行試作と違い、既に分割済みの区間を入力として再利用していない。[^measurements]

計算だけの試験と画面反映まで含む試験を分け、それぞれ同期・Worker・Worker・同期・Worker・同期の順に3回ずつ比較。各回1.8秒の実時間フレームを観測し、開始150 ms後に1回だけ道路処理を起こす。同期の基準は同じデータ変換を通るフォールバックであり、旧版そのままではない。[^measurements]

| 計算だけの指標       | 同期（3回）              | Worker（3回）            |
| -------------------- | ------------------------ | ------------------------ |
| 要求から復元完了まで | 129.3 / 114.4 / 100.1 ms | 151.6 / 151.5 / 164.4 ms |
| メイン側の計時区間   | 128.9 / 114.3 / 100.0 ms | 1.4 / 1.5 / 1.4 ms       |
| 最長フレーム間隔     | 166.7 / 133.4 / 116.6 ms | 33.4 / 33.4 / 33.4 ms    |
| 50 ms超フレーム数    | 1 / 1 / 1                | 0 / 0 / 0                |

メイン側の計時区間は、同期が計算・データ変換・復元、Workerは送信処理と復元の合計。Worker送信は1.0〜1.1 ms、復元は約0.4 ms。ブラウザ内部の受信時の構造化複製は単独計時していない。Workerの計算自体は119〜140 msかかり、返却までの総時間も短くなっていない。**計算を待つ間もフレーム更新できる効果**を確認した。全6回の区間・節点・規制のJSONが一致し、計算だけの試験でゲームの使用中グラフを置き換えていないことも検査した。

## 道路更新全体の停止は残る

| 画面・物理への反映込み | 同期（3回）                 | Worker（3回）               |
| ---------------------- | --------------------------- | --------------------------- |
| 要求から反映完了まで   | 1053.7 / 1029.0 / 1040.0 ms | 1110.8 / 1075.8 / 1155.1 ms |
| 最長フレーム間隔       | 1916.6 / 1833.3 / 1833.2 ms | 1750.0 / 1783.2 / 1833.2 ms |
| 50 ms超フレーム数      | 1 / 1 / 1                   | 1 / 1 / 1                   |

`road_network_built` の反映CPU時間は921〜1,005 ms。内訳は `RoadSurface.rebuild` が843〜925 ms、水面・橋が44〜50 ms、標識16〜18 ms、信号7〜15 ms、その他が各数ms。次の主な改善対象は路面・区画線の再生成である。フレーム間隔は反映の後の描画等も含み、反映CPU時間と同じ値にはならない。今回GPUの処理時間や後続描画の内訳は測っていない。

**このWorker化で道路更新全体のカクつきが解消したとは言えない。** 毎回全体を作り直す試験なので、走行中のすべての更新がこの数値になるとも限らない。次に路面生成の事前計算・既存ジオメトリの再利用・分割反映を検討するときは、橋→路面の高さ、コライダー、信号・歩行者の区間参照を同じ世代に揃える必要がある。

# 検証と再実行

- 全902テスト、型チェック、lint、整形、production buildを通過。規制の同値性・空間検索・時刻変更、停止線と区間の参照、異なる原点、待ち行列の上限、破棄・タイムアウト・Worker実行エラー・送信/復号/起動失敗・無関係な応答を検査した。[^tests]
- Chromeで原点移動中に旧フレームを維持し、移動後も車の経緯度が一致することを確認（高さ差は約1e-8 m）。連続ワープの最後の行き先 `35.6813,139.7671` にだけ着地し、その原点になった。例外・Worker失敗・道路失敗・ログスキーマ不一致は0件。[^measurements]
- production buildを `vite preview` で配信し、Chromeで夜雨の開始後30秒を確認。実際に `backend: worker` で1,189区間を準備・反映し、例外・エラーログは0件。スクリーンショットでも夜雨の描画を確認した。初回読み込みの確認であり、上の繰り返し再生成の性能比較とは条件が異なる。[^production-smoke]
- `just serve-dev` の後、`just measure-road-worker`。JSONとスクリーンショットは `.qa/perf/<UTC日時>-roads/` に保存する。`QA_URL` で開発サーバーを指定できる。計測中はHMR・ビルド・テストを動かさない。
- 開発用 `?inlineRoads` で同期フォールバックを比較できる。開発フック `__game.debug.roads` は計算・反映、原点移動、ワープの自動検証に使う。本番では開発フックとクエリによる切り替えを公開しない。

[^code]: Worker・データ復元・道路と原点の切り替え

[^tests]: 規制の同値性、参照の復元、古い依頼の破棄、失敗・破棄時の完了

[^measurements]: 最終版の夜雨の実測と連続ワープ検証

[^first-measurements]: 初回のWorker比較

[^production-smoke]: production buildのWorker起動と夜雨の描画確認

[^initial-prototype]: 先行するWorker試作
