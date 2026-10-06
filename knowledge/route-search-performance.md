---
type: Metric
title: 経路探索の目的地投影と探索コストの管理を減らす
description: 実道路704ケースの経路と自動運転計画が一致。2373区間の自動運転計画CPU合計1384.9→1122.4ms。ヒープと方向キャッシュは不採用。夜雨の原点変更・ワープには83〜100msが残る。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T01:10:27Z }
verified:
  - { by: process:989-tests-typecheck-lint-format-build-just-actions-knowledge, at: 2026-10-06T01:12:20Z }
  - { by: process:chrome154-real-route-driver-exact-comparison, at: 2026-10-06T01:01:00Z }
  - { by: process:chrome154-clock-mapped-night-rain-warp-profile, at: 2026-10-06T01:04:00Z }
  - { by: process:chrome154-nonprofiled-five-streaming-scenarios-terminal-logs, at: 2026-10-06T01:10:27Z }
sources:
  - id: code
    resource: ../src/game/navigation.ts, ../src/world/roads.ts
    title: 空間インデックスを使う投影候補と方向別のコスト配列
  - id: baseline
    resource: https://github.com/kexi/tokyo-od-game/blob/b73309b1b446d9e4b7a8a26ca6031589a4ca0ce0/src/game/navigation.ts
    title: 全道路投影とMapによる変更前の経路探索
  - id: controller
    resource: ../scripts/qa/perf-route-search.mjs
    title: 実ゲームの2地域・旧版との全出力比較・CPU計測
  - id: heap
    resource: ../.qa/perf/2026-10-06T00-48-28-238Z-route-search/report.json, ../.qa/perf/2026-10-06T00-48-28-238Z-route-search/heap-trial.patch
    title: 採用しなかった二分ヒープの実道路計測とコード（ローカル保存）
  - id: tangent
    resource: ../.qa/perf/2026-10-06T00-52-24-394Z-route-search/report.json
    title: 採用しなかった方向キャッシュの実道路計測とコード（ローカル保存）
  - id: projection
    resource: ../.qa/perf/2026-10-06T00-56-50-664Z-route-search/report.json
    title: 投影候補だけを絞った中間段階の計測（ローカル保存）
  - id: parity
    resource: ../.qa/perf/2026-10-06T00-59-26-728Z-route-search/report.json
    title: 最終実装の704ケース・1222067数値の一致とCPU（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T01-01-39-949Z-streaming/report.json, ../.qa/perf/2026-10-06T01-01-39-949Z-streaming/frame-stacks.json
    title: 修正後の3場面のCPUスタックと道路切り替えの100ms（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T01-08-27-149Z-streaming/report.json
    title: Profilerなしの5場面・道路資源・原点・最後のワープの検査（ローカル保存）
  - id: truncated
    resource: ../.qa/perf/2026-10-06T01-06-22-133Z-streaming/report.json, ../src/log.ts
    title: 保存上限で開始ログが消えた計測と2000件のリングバッファ（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/2f41d7fd-adcf-443f-ac26-ea701a87dd72.jsonl, ../.qa/logs/2026-10-06/30589d07-e395-4410-905f-2397d060ead7.jsonl, ../.qa/logs/2026-10-06/bb41d782-fcf1-45ee-9f99-7a031bb1ca5a.jsonl
    title: 端末保存ログの実行時エラー・警告検査（ローカル保存）
  - id: tests
    resource: ../tests/navigation.test.ts
    title: 目的地の30m許容範囲・地図外・同コスト経路の選択の回帰検査
---

# 投影と探索状態の変更

[前の地形改善](terrain-mask-performance.md)後も、新地域100msの区間でパトカーの出現に伴う経路探索が重なっていた。各探索は目的地を全道路へ投影し、再試行するDijkstraの方向別コストをMapへ保持していた。[^baseline]

道路の既存32mセル索引で、目的地の64m以内から投影候補を調べる。使用できる最寄り道路がその半径以内に見つかるまで半径を倍にし、候補が全道路になった場合も終了する。実際の投影は従来のnearestOnを使う。最寄りまでの距離が確定した後は、最寄りから30m以内という従来のゴール候補を追加で投影する。最初の検索範囲外に安いゴールがある場合も残す。[^code] [^tests]

境界での丸めを覆うため、投影候補の検索には1セル分の余白を付ける。道路が無い・使用可能道路が無い・非有限座標・非常に大きな照会は、既存の全道路へのフォールバックを使う。区間IDが配列位置に一致するRoadGraphの不変条件を使い、探索の方向別コストをFloat64Array、前の区間を配列へ変更する。コストの厳密な大小比較、再試行、同コスト時の選択順は保つ。[^code]

# 採用しなかった変更

待ち行列の並べ替えを二分ヒープへ置き換えると、探索CPUを減らせると予想した。同コストで後から入れた項目を先に取り出す順序も再現し、704ケースの出力は一致したが、CPU合計は増えた。理由はこの計測では分離できていないため、ヒープを削除した。旧コメントの「1200区間なら速い」も測定の根拠ではない。[^heap]

| 地域・仕事           | 旧CPU合計 | ヒープCPU合計 |
| -------------------- | --------: | ------------: |
| 東京駅・経路256件    |   323.8ms |       355.7ms |
| 東京駅・自動運転96件 |   411.1ms |       446.5ms |
| 吾妻橋・経路256件    |   476.5ms |       506.4ms |
| 吾妻橋・自動運転96件 |  1396.8ms |      1451.2ms |

区間の方向ベクトルを1回の計画内でキャッシュし再試行にも共有する案も、全出力は一致したが、吾妻橋の自動運転CPUは1414.4→1445.2ms、最大45.0→50.5msとなった。東京駅では437.6→435.5msで明確な改善はなく、不採用にした。試作はreportのcurrentSourcesと保存したcurrent.txtに残る。[^tangent]

投影候補だけを絞った中間段階では、吾妻橋の自動運転CPUが1391.1→1154.3msになった。最終実装の同一条件の比較は次の節に記す。異なる実行の旧値同士も変動するため、段階間の差を配列化だけの改善率とは扱わない。[^projection]

# 実道路の経路と自動運転計画の比較

M2 Max・Chrome154・実WebGPU・1280×800・DPR1・ultra・夜雨・seed20261006。東京駅1189区間と吾妻橋2373区間をゲームから取得し、snapshotから復元した同じ道路・規制を旧版と現行版へ渡す。車・徒歩、2方向、2時刻、および車線上・逆向き・道路外からのAutoDriver.planを比較する。各地域12件を温めた後、各問い合わせで新旧の実行順を交互にし、問い合わせ間に実フレームを挟む。編集・テスト・ビルドを同時実行しない。[^controller] [^parity]

合計704件で、Routeの全点・累積距離・方向・車線・角・案内・復帰操作と、自動運転の計画成否・経路・残距離・合図・活動状態が一致した。数値は許容誤差ではなくObject.isで比較し、合計1222067値が一致した。同じ復元済み道路への参照も保つ。未到達・計画失敗の結果を除外していない。reportには道路snapshot、規制、各問い合わせ、出力hash、比較元commit、新旧ソースのSHA-256を保存する。[^controller] [^parity]

| 地域・仕事       | 件数 | CPU合計 旧→現行 | p95 旧→現行 | 最大 旧→現行 |
| ---------------- | ---: | --------------: | ----------: | -----------: |
| 東京駅・経路     |  256 |   333.9→294.7ms |   3.5→2.8ms |    5.1→6.0ms |
| 東京駅・自動運転 |   96 |   412.1→374.8ms | 14.7→16.1ms |  32.0→33.2ms |
| 吾妻橋・経路     |  256 |   470.6→409.0ms |   4.6→4.2ms |    6.3→5.7ms |
| 吾妻橋・自動運転 |   96 | 1384.9→1122.4ms | 42.3→36.9ms |  45.1→38.8ms |

CPUはplanRouteまたはAutoDriver.plan呼び出しだけを囲む。入力準備・全出力比較・hash計算・フレーム待ちは含めない。これは計算の比較であり、ゲーム全体のFPSではない。東京駅の自動運転p95・最大値は改善していない。計画をWorkerへ移す変更はこの実装に含まれない。[^controller] [^parity]

# 実ゲームに残る停止

同じ夜雨条件でProfilerを使った原点変更・新地域・連続ワープは、最長66.7・100.0・66.7msだった。新地域100msの区間では、信号を道路へ対応付けるbuildSignals約11.1ms、setNetworkの自己時間約27.3msが見つかった。シェーダー生成はこの区間で0ms。他の長い区間にはシェーダー生成・物理・建物・地形・GCが残る。分類は包含時間で重なるため加算しない。[^profile]

Profilerなしの5場面を最後まで実行した結果は以下。道路・駐車車両の資源再利用、原点変更中の地理位置、連続ワープの最後の目的地への着地も検査を通った。[^normal]

| 場面                     | 最長rAF間隔 | 50ms超 |
| ------------------------ | ----------: | -----: |
| 通常プレイ               |      33.4ms |    0回 |
| 同じ道路の更新           |      50.0ms |    0回 |
| 原点変更                 |      83.3ms |    3回 |
| 新地域                   |      83.3ms |    2回 |
| 古い依頼を挟む連続ワープ |     100.0ms |    9回 |

経路探索のCPU削減を、停止の完全解消とは扱わない。端末のjust show-errorsで、5場面1189行はwarn/errorが0件。Profilerの1150行は潮汐表取得失敗1件、経路比較1182行は天気取得失敗1件の警告で、いずれもerrorは0件だった。[^logs]

最初のProfilerなし実行は、2000件のリングバッファからsession_startが消え、計測側が誤ってHMRと判定して中断した。保存されたroad_network_builtのtraceIdは開始時と一致し、ページが別セッションに変わった根拠はなかった。最新ログのtraceIdとゲームオブジェクトの同一性を両方検査するように修正し、5場面を測り直した。中断した実行を完全な検証結果には数えない。[^truncated] [^normal]

再現はjust measure-route-search、およびQA_MODES=baseline,update,recenter,coldWarp,latestWarp just measure-road-streaming。CPUスタックはQA_PROFILE=1で計測してprofile-frame-stalls.mjsへreportを渡す。ログから確認した再現URLはhttp://localhost:5173/tokyo-od-game/?seed=20261006&start=35.681236%2C139.767125&time=night&weather=rain。[^controller] [^normal] [^logs]

[^code]: 本番の目的地投影と方向別探索状態。

[^baseline]: b73309bの変更前実装。

[^controller]: 旧版を固定し実道路で交互に呼び出す比較スクリプト。

[^heap]: 出力を保持したヒープでも合計CPUが増えた試作。

[^tangent]: 方向キャッシュが明確な改善にならなかった試作。

[^projection]: 空間索引だけを導入した中間計測。

[^parity]: 最終実装と旧版の全結果比較・CPU計測。

[^profile]: CDPとページの時計を対応付けた実フレームのスタック。

[^normal]: Profilerなしの5場面の実測と資源・原点の検査。

[^truncated]: 開始ログの消失による誤判定とバッファ実装。

[^logs]: .qa/logsに保存した各セッションの端末検査。

[^tests]: 30mのゴール候補・地図外・同コスト時の選択の検査。
