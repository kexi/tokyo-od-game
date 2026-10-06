---
type: Metric
title: 道路網の外にある信号の交差点照合を省く
description: 実道路2地域の信号・停止線・位相・共有参照など647063数値が一致。30回の道路設定CPU101.5→56.4ms、220.1→90.1ms。夜雨の新地域にはパトカー経路作成による99.9msが残る。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T01:20:59Z }
verified:
  - { by: process:996-tests-typecheck-lint-format-build-just-actions-knowledge, at: 2026-10-06T01:22:59Z }
  - { by: process:chrome154-real-signal-approach-phase-reference-comparison, at: 2026-10-06T01:19:00Z }
  - { by: process:chrome154-clock-mapped-night-rain-warp-profile-terminal-logs, at: 2026-10-06T01:20:59Z }
sources:
  - id: code
    resource: ../src/world/trafficControl.ts
    title: 交差点の水平境界と25mの厳密な照合距離
  - id: tiles
    resource: ../src/world/regulations.ts
    title: RegulationTiles.aroundによる周辺z14タイルの信号取得
  - id: baseline
    resource: https://github.com/kexi/tokyo-od-game/blob/f50795d3c3b2881db6303e5aae6fa531660d95c8/src/world/trafficControl.ts
    title: 範囲外の信号も全交差点と照合する旧処理
  - id: controller
    resource: ../scripts/qa/perf-signal-network.mjs
    title: 実ゲーム2地域の旧新の出力と30回のCPU比較
  - id: parity
    resource: ../.qa/perf/2026-10-06T01-17-26-160Z-signal-network/report.json
    title: 信号・停止線・位相・参照・停止位置の一致とCPU、固定した新旧ソース（ローカル保存）
  - id: before
    resource: ../.qa/perf/2026-10-06T01-01-39-949Z-streaming/report.json, ../.qa/perf/2026-10-06T01-01-39-949Z-streaming/frame-stacks.json
    title: 新地域100msの道路切り替え・信号照合のスタック（ローカル保存）
  - id: after
    resource: ../.qa/perf/2026-10-06T01-18-58-119Z-streaming/report.json, ../.qa/perf/2026-10-06T01-18-58-119Z-streaming/frame-stacks.json
    title: 修正後の実フレーム・残るパトカーの経路作成（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/be5bcb0b-e923-45ef-a6ff-7995961a9d4a.jsonl, ../.qa/logs/2026-10-06/3690e83c-6d92-4fb4-8803-2f3d5060cc29.jsonl
    title: 比較792行と実プレイ1139行の端末ログ検査（ローカル保存）
  - id: tests
    resource: ../tests/trafficControlNetwork.test.ts
    title: 厳密な25m境界・同距離の交差点・交差点のない道路の一時停止
---

# 実フレームで見つかった全交差点との照合

[経路の投影改善](route-search-performance.md)後、夜雨の新地域100msに、道路を切り替えるsetNetworkの自己時間約27.3msとbuildSignals約11.1msが記録された。そのフレームにはシェーダー生成が無かった。[^before]

取得したすべてのOSM信号について、道路網のすべての交差点との距離を求め、最寄りが25m未満なら信号を対応付けていた。信号の取得単位は周辺のz14タイルで、道路網を構成する道路の範囲と一致しない。「市全体の信号を取得している」という当初の推測は誤りで、実際の東京駅と吾妻橋の信号数は441・427件だった。範囲外にも多数あるという点は成り立つ。[^baseline] [^tiles] [^parity]

交差点の水平座標の最小・最大を調べ、各軸で境界から25m以上外にある信号を先に除外する。すべての交差点までの距離が25m以上になるので、旧処理でも対応付けられない。境界に25mを加減して比較する代わりに座標の差を比較し、旧Math.hypotの入力と同じ減算を使う。残った信号と交差点の照合順、厳密な25m未満のしきい値、クラスタ、位相、JARTIC停止線、一時停止は保つ。境界は各再構築で求め、原点変更後に古い範囲を使わない。[^code] [^tests]

# 実データでの比較

M2 Max・Chrome154・実WebGPU・1280×800・DPR1・ultra・夜雨・seed20261006。30秒温めたゲームの東京駅と、実ワープ後の吾妻橋の道路・規制を使う。固定commitの旧TrafficControlと現行TrafficControlを隔離したSceneに作り、setNetworkを実行する。モデルのGeneratorは進めず、実ゲームの物理・描画資源を変更しない。[^controller] [^parity]

初回は別に記録し、8回の準備後に30回ずつ比較した。呼び出し順は交互にして、1組ごとに実フレームを挟む。編集・テスト・ビルドは同時実行しない。CPUはsetNetworkだけを囲み、出力比較・フレーム待ちを除外する。[^controller]

| 地域   | 道路 / 交差点 / OSM信号 | 生成approach / 制御器 | CPU合計 旧→現行 | 中央値 旧→現行 | 最大 旧→現行 |
| ------ | ----------------------- | --------------------- | --------------: | -------------: | -----------: |
| 東京駅 | 1189 / 479 / 441        | 272 / 73              |    101.5→56.4ms |      3.4→1.8ms |    4.5→2.4ms |
| 吾妻橋 | 2373 / 1092 / 427       | 700 / 75              |    220.1→90.1ms |      7.4→3.0ms |    8.0→3.7ms |

初回CPUは東京駅7.3→4.7ms、吾妻橋7.1→2.8ms。初回も比較専用クラスを初めて呼ぶ時間で、ページ全体のコールドスタート時間ではない。[^parity]

初回と30回で、approachの全ID・道路ID・方向・停止位置・種別・軸・停止線の両端・進行ベクトル・制御器のID/offset/nodes、区間別索引の順序、制御器を共有する組が一致した。13時刻の各信号状態と、停止位置の前後からnextStopの結果も一致した。数値はObject.isで比較し、合計647063値。snapshot・規制・最終全出力・各回の時間・新旧ソースのSHA-256を保存した。固定2地域を繰り返す比較であり、60地域を調べたという意味ではない。3Dモデル・全画素・実Rapierコライダーを生成した比較でもない。[^controller] [^parity]

# 夜雨の実プレイで残った仕事

同じ条件の原点変更・新地域・古い依頼を挟む連続ワープをProfiler付きで完走した。道路資源・駐車車両の再利用、地理位置・最後のワープ先の検査も通った。[^after]

| 場面                     | 道路設定networkのCPU | 最長rAF間隔 | 50ms超 |
| ------------------------ | -------------------: | ----------: | -----: |
| 原点変更                 |                6.7ms |      50.0ms |    0回 |
| 新地域                   |                9.4ms |      99.9ms |    5回 |
| 古い依頼を挟む連続ワープ |                3.1ms |      83.3ms |    6回 |

前の新地域のnetworkは41.2msだったが、両方ともProfiler付き各1回であり、他の仕事の到着・JITなどの変動を固定していない。その差全体を除外処理の効果として扱わない。計算の効果は同じ入力を交互に実行した前節で確認する。[^before] [^after]

修正後の新地域99.9msでは、search約28.9ms、RoadGraph.sample約11.2ms、planRoute約10.5ms、待ち行列push約8.9msなどが記録された。スタックはAutoDriver.routeFrom→bestStart→plan→PolicePatrol.cruise/spawn→spawnPatrol→updatePolice→tickと続いた。シェーダー生成はこの区間で0ms。他の長い区間には建物読み込み・属性付与・地形・物理・影・GCが残る。停止の完全修正はまだ達成していない。[^after]

端末のjust show-errorsで比較792行、実プレイ1139行を検査し、双方warn/errorは0件だった。再現はjust measure-signal-networkとQA_PROFILE=1 QA_MODES=recenter,coldWarp,latestWarp just measure-road-streaming。[^logs] [^controller] [^after]

[^code]: 本番の境界除外と変更していない信号・一時停止の組み立て。

[^tiles]: 周辺z14タイルの取得範囲。

[^baseline]: f50795dの変更前の信号照合。

[^controller]: 固定旧版と隔離した制御器の比較手順。

[^parity]: 実道路2地域の全結果一致とCPU記録。

[^before]: 道路切り替えの100msを特定した実CPUスタック。

[^after]: 改善後に残るパトカー経路探索とその他の負荷。

[^logs]: .qa/logsに保存した端末ログのエラー検査。

[^tests]: 信号の距離・順序・一時停止を保つ検査。
