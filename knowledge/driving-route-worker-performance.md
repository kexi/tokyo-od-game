---
type: Metric
title: 自動運転の経路選択をWorkerへ移す
description: 実Workerの704ケース・1222067数値が同期版と一致。経路選択のメインCPU最大35.1→4.6ms、39.5→7.1ms。返答待ちは増え、夜雨のワープには66.7msの停止が残る。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T02:24:00Z }
verified:
  - { by: process:1025-tests-typecheck-lint-format-build-just-actions-knowledge, at: 2026-10-06T02:26:26Z }
  - {
      by: process:chrome154-real-worker-full-route-driver-exact-comparison-span-matched-cpu,
      at: 2026-10-06T02:16:11Z,
    }
  - { by: process:chrome154-night-rain-five-scenarios-terminal-log-inspection, at: 2026-10-06T02:23:00Z }
  - { by: process:chrome154-clock-mapped-worker-and-synchronous-gameplay-profiles, at: 2026-10-06T02:19:00Z }
sources:
  - id: code
    resource: ../src/game/drivingRoute.ts, ../src/game/drivingRouteData.ts, ../src/game/drivingRoutePlanner.ts, ../src/game/drivingRoute.worker.ts
    title: 純粋な経路選択・全経路の転送・車両ごとの依頼・Worker
  - id: callers
    resource: ../src/game/autoDriver.ts, ../src/game/policePatrol.ts, ../src/game/robotaxi.ts, ../src/main.ts
    title: 待機・取消・原点変更・巡回と追跡・自車の自動運転
  - id: baseline
    resource: https://github.com/kexi/tokyo-od-game/blob/b8a66bace759de324efca6559a26211d206db12d/src/game/autoDriver.ts
    title: 固定した同期版AutoDriver
  - id: controller
    resource: ../scripts/qa/perf-route-search.mjs, ../scripts/qa/perf-road-streaming.mjs
    title: 実Workerの出力比較・依頼ごとのCPU照合・実ゲームの夜雨計測
  - id: parity
    resource: ../.qa/perf/2026-10-06T02-14-55-188Z-route-search/report.json
    title: 704ケース・実Worker192件・全出力hash・道路入力・旧新ソース（ローカル保存）
  - id: unmatched
    resource: ../.qa/perf/2026-10-06T02-05-43-593Z-route-search/report.json, ../.qa/perf/2026-10-06T02-11-59-789Z-route-search/report.json
    title: 依頼のspanを照合しなかった初期計測（CPU集計には採用しない）
  - id: worker-profile
    resource: ../.qa/perf/2026-10-06T02-07-23-862Z-streaming/report.json, ../.qa/perf/2026-10-06T02-07-23-862Z-streaming/frame-stacks.json
    title: Worker版の実フレームと残る建物・シェーダー・GC（ローカル保存）
  - id: sync-profile
    resource: ../.qa/perf/2026-10-06T02-16-56-969Z-streaming/report.json, ../.qa/perf/2026-10-06T02-16-56-969Z-streaming/frame-stacks.json
    title: syncRoutesで同期計算する実ゲームのCPUスタック（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T02-20-10-016Z-streaming/report.json
    title: Profilerなしの5場面・資源・原点・最後のワープ先・各時点のソース（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/635a4aea-1cd1-4abe-9c0e-055dbaede810.jsonl, ../.qa/logs/2026-10-06/67fa49ef-348e-4756-b0f0-ea36fe6669ba.jsonl
    title: 端末保存の比較1622行・実ゲーム1557行のログ検査（ローカル保存）
  - id: tests
    resource: ../tests/drivingRouteData.test.ts, ../tests/drivingRouteWorker.test.ts
    title: 全経路の復元・失敗・公平な待ち行列・取消・規制・連続座標変換
  - id: binary
    resource: ../.qa/perf/2026-10-06T01-26-07-363Z-route-search/report.json, ../.qa/perf/2026-10-06T01-26-07-363Z-route-search/native-insert-trial.patch
    title: 採用しなかった二分挿入とsplice（ローカル保存）
  - id: scratch
    resource: ../.qa/perf/2026-10-06T01-30-23-158Z-route-search/report.json, ../.qa/perf/2026-10-06T01-30-23-158Z-route-search/scratch-trial.patch
    title: 採用しなかった一時ベクトルの再利用（ローカル保存）
  - id: starts
    resource: ../.qa/perf/2026-10-06T01-33-20-312Z-route-search/report.json
    title: 採用しなかった開始道路候補の空間索引化と全ソース（ローカル保存）
---

# 残った巡回車の経路計算

[信号照合の改善](signal-network-performance.md)後の99.9msの区間には、巡回車の出現でAutoDriverが開始道路を選び、最大6候補の経路と車線規制による再探索を同じフレームで計算する仕事が残っていた。[^baseline]

開始道路と経路を選ぶ関数を、車両の状態・物理・描画から切り出した。WorkerはRoadGraphのsnapshot、規制の道路ID、時計、位置、方向、目的地を受け取る。経路の全点・累積距離・方向・車線・角・案内・復帰操作を返し、ページでVector3と現在のSegmentへの共有参照を復元する。計算WorkerはAutoDriver・Vehicle・描画モデルを読み込まない。[^code]

1件だけ計算を進め、待ち行列は車両ごとに最新の依頼を保持する。他車両の依頼を取り消さず、取り消した計算の返答を適用しない。エラー・返信のdecode失敗・送信失敗・起動失敗・15秒のtimeoutは同期計算へフォールバックする。フォールバックの機能をテストしたが、そのCPUを小さくする変更ではない。[^code] [^tests]

巡回・追跡と自車の自動運転を非同期計画に接続した。計算待ちはブレーキを保持するため、追跡の再計画中にも短い減速が入る。停止・配置・破棄で取消し、原点変更後は変換した目的地へ再計画する。道路グラフが変わった、規制の効力・一方通行・通行止め・車線が変わった返答は破棄して再依頼する。小数のゲーム時刻が毎フレーム進むだけでは破棄しない。到達不能な巡回車は撤去する。[^callers] [^tests]

タクシーの配車・乗車、行き詰まり後のretry、障害物の前での明示的な引き返しなど、一部の入口は同期APIを維持する。全経路計算がWorkerへ移ったという意味ではない。[^callers]

# 実道路と実Workerの比較

M2 Max・Chrome154・実WebGPU・1280×800・DPR1・ultra・夜雨・seed20261006。東京駅1189区間と実ワープ後の吾妻橋2373区間の道路・規制を凍結し、同じ入力を固定commitの同期版と現行版へ渡す。車・徒歩、2方向、2時刻の直接経路計算512件と、車線上・逆向き・道路外の運転計画192件で、合計704件。Workerの運転計画を6件温め、旧新の順序を交互にして、組ごとに実フレームを挟む。[^controller] [^parity]

全経路と運転状態の出力が一致した。Object.isで1222067数値を比較し、未到達・計画失敗も除外していない。Workerの192件はbackendがworkerであること、該当するPlannerのownerとspanを照合したprepared/appliedが1組あることを検査する。道路snapshot・全照会・hash・固定commit・各ソースとSHA-256を保存した。[^parity]

| 地域・運転計画96件 | 同期版メインCPU合計 | Worker版メインCPU合計 | p95 同期→Worker | 最大 同期→Worker |
| ------------------ | ------------------: | --------------------: | --------------: | ---------------: |
| 東京駅             |             418.9ms |               368.8ms |      16.1→4.2ms |       35.1→4.6ms |
| 吾妻橋             |            1136.9ms |               554.5ms |      36.6→6.5ms |       39.5→7.1ms |

同期版はplanの呼び出しを囲む。Worker版はplanAsyncのawaitの前後でメインの処理だけを合計し、返答の復元CPUを足す。比較用Plannerは同時に1車両だけ依頼するため、その依頼のsnapshot作成とpostMessageの同期処理もplanAsyncの計測内に入る。比較・hash・フレーム待ち・Workerでの計算時間をメインCPUに加算しない。これは経路選択のメインCPUであり、ゲーム全体のFPSや待ち行列内の全車両のCPUではない。[^controller]

Worker版のpostMessage合計は東京駅319.7ms、吾妻橋486.2ms。大きな道路snapshotの複製はページ側に残る。Worker計算合計は421.2・1270.0msで、同期版の計算そのものより速くなったとは言えない。返答待ちを含む96件の合計は東京駅418.9→2321.7ms、吾妻橋1136.9→3523.6ms、最大は35.1→49.6ms・39.5→78.7msになった。画面を止める一度の計算を小さくする代わりに、依頼完了までの待ちは増える。[^parity]

最初の2回は、ページで同時に走る他車両のprepared/appliedを先頭から拾っていた。他車両が混ざる可能性があるため、それらのメインCPU集計と当初報告した33.6→10.5ms・40.6→7.0msは検証済みの値として採用しない。計算依頼から準備・破棄・適用まで同じspanを伝播し、比較用Plannerのownerから取得したspanで対応付けて再計測した。全経路の一致と返答待ちの計測は、このログ集計とは独立している。[^unmatched] [^controller] [^parity]

# 夜雨の実プレイと残る停止

Profiler付きWorker版の最長は原点変更50.0ms・新地域83.4ms・連続ワープ66.7ms。新地域83.4msにはシェーダー生成の包含時間11.5ms、GC8.2ms、建物の属性付与と読み込みが残った。原点変更50msにもsnapshot送信のpump約4.5msがあった。メインの経路探索が消えても、別の仕事が同じフレームへ集まる。[^worker-profile]

同じ最終コードでsyncRoutesを付け、運転計画を同期計算に戻す比較もした。原点変更50.1ms・新地域66.7ms・連続ワープ66.8msで、原点変更のピークにはplanRoute・searchが記録された。新地域はシェーダー・建物などが支配した。各1回・読み込みの到着・巡回車の目標と走行状態が違うため、実ゲーム全体の最大値が必ずWorkerで改善するという根拠にはしない。同期版1153行の端末ログには潮汐表の取得失敗1件、error0件。Worker版1945行はwarn/error0件だった。[^sync-profile] [^worker-profile]

ProfilerなしのWorker版は5場面を完走した。道路と駐車車両の資源再利用、原点変更中の地理位置、連続ワープの最後の目的地、ゲームオブジェクトとtraceIdの維持も検査を通った。[^normal]

| 場面                     | 最長rAF間隔 | 50ms超 |
| ------------------------ | ----------: | -----: |
| 通常プレイ               |      33.4ms |    0回 |
| 同じ道路の更新           |      50.1ms |    1回 |
| 原点変更                 |      49.9ms |    0回 |
| 新地域                   |      66.7ms |    5回 |
| 古い依頼を挟む連続ワープ |      66.7ms |    8回 |

端末のjust show-errorsで、経路比較1622行とこの実プレイ1557行はwarn/error0件。実プレイには202件のWorker結果があり、計画失敗1件もエラー扱いせず処理した。停止の完全修正は未達成。タクシーなど残る同期入口、snapshotの送信、建物・地形の読み込み・シェーダー・影・物理・GCの重なりが次の対象になる。[^logs] [^normal] [^callers]

実測時点のコードはreportと隣のソースに固定した。実測後、返答前に連続して2回座標変換されたときも再依頼フラグを保つ修正を追加した。この状態遷移はunitテストで検証し、上のCPU・rAFの値をその後の再計測値とは扱わない。経路選択・転送・CPU計測の処理は変更していない。[^tests] [^normal] [^parity]

# Worker化前に採用しなかった小さな最適化

いずれもf50795dの同期版を比較元にし、704件・1222067数値の出力は一致したが、採用しなかった。試作のソースとhashを各reportに保存している。[^binary] [^scratch] [^starts]

| 試作                       | 東京駅の運転CPU合計 旧→試作 | 吾妻橋の運転CPU合計 旧→試作 |
| -------------------------- | --------------------------: | --------------------------: |
| 待ち行列の二分挿入とsplice |               378.6→391.9ms |             1114.7→1172.0ms |
| 一時Vector3の再利用        |               370.1→366.0ms |             1099.6→1078.3ms |
| 開始道路候補の空間索引化   |               370.3→369.0ms |             1096.2→1068.6ms |

二分挿入は合計が悪化。一時ベクトルと開始道路の索引化は小さな差にとどまり、東京駅の最大値や直接経路のCPUが改善しない場合があった。1回ずつの実行で効果が明確にならず、試作をすべて戻して、最も長い候補ごとの経路計算をメインから切り離した。[^binary] [^scratch] [^starts]

再現はjust measure-driver-worker。実ゲームはQA_MODES=baseline,update,recenter,coldWarp,latestWarp just measure-road-streaming、CPUスタックはQA_PROFILE=1を付け、profile-frame-stalls.mjsへreportを渡す。syncRoutesは開発版だけの同期比較、inlineRoutesは開発版だけの同期フォールバック指定で、両者は異なる。同期フォールバックはsnapshotの復元もページで行う。[^controller] [^callers]

[^code]: Workerの計算・転送と車両単位の待ち行列。

[^callers]: 実ゲームに接続した入口・残した同期API・取消と待機。

[^baseline]: PR13の固定した同期計算。

[^controller]: 実Workerの識別と同一入力による比較。

[^parity]: ownerとspanを照合した704件の全出力と時間。

[^unmatched]: 初期の未照合集計を採用しないという訂正。

[^worker-profile]: Worker版に残った別のフレーム負荷。

[^sync-profile]: 同期版でも実フレームの最大値が変動した測定。

[^normal]: Profilerなしの資源・原点・フレームとソース保存。

[^logs]: 端末ログによる実行時失敗の検査。

[^tests]: 返答の復元と状態遷移・失敗・公平性の回帰検査。

[^binary]: 出力一致でもCPUが悪化した二分挿入。

[^scratch]: 明確な改善にならなかった一時ベクトル。

[^starts]: 最大停止の解消につながらなかった開始候補の索引化。
