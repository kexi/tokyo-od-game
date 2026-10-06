---
type: Metric
title: 道路Workerの返答をバッファで転送する
description: 実道路2地域の両方式それぞれ8829456数値比較が一致。24返答の読み出し・展開・復元CPU100.6→83.5ms、172.5→143.3ms。夜雨の新地域66.7msは残る。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T04:29:42Z }
verified:
  - { by: process:1063-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T04:24:24Z }
  - { by: process:chrome154-native-reply-read-and-8829456-values-per-format, at: 2026-10-06T04:24:24Z }
  - {
      by: process:chrome154-eight-night-rain-scenarios-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T04:29:42Z,
    }
  - { by: process:chrome154-clock-mapped-warp-cpu-profile-and-terminal-logs, at: 2026-10-06T04:29:42Z }
sources:
  - id: code
    resource: ../src/world/roadNetworkPacket.ts, ../src/world/roadNetwork.worker.ts, ../src/world/roadNetworkBuilder.ts, ../src/world/roadNetworkData.ts, ../src/world/roads.ts
    title: Doubleを保つバッファ転送と直接のVector3復元
  - id: original
    resource: https://github.com/kexi/tokyo-od-game/blob/fc2f2059827dddbb5b229d8b4eb18601758e3cb6/src/world/roadNetwork.worker.ts
    title: 比較へ固定した元のWorker返答
  - id: chromium
    resource: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/events/message_event.cc
    title: MessageEventのdata getterからのDeserialize（mainを参照、Chrome154の同一revisionは未照合）
  - id: initial
    resource: ../.qa/perf/2026-10-06T04-08-20-294Z-road-replies/report.json
    title: getterの初回実測。同期参照が混入したフレーム値は無効（ローカル保存）
  - id: intermediate
    resource: ../.qa/perf/2026-10-06T04-18-46-902Z-road-replies/report.json
    title: 中間の座標tupleを復元していた版（ローカル保存）
  - id: component
    resource: ../scripts/qa/perf-road-replies.mjs, ../.qa/perf/2026-10-06T04-22-46-219Z-road-replies/report.json
    title: 最終版の実道路2地域・各方式24依頼・4交互標本と数値一致（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T04-24-42-001Z-streaming/report.json, ../.qa/perf/2026-10-06T04-24-42-001Z-streaming/night-rain.png
    title: Profilerなしの8場面と目視した夜雨の画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T04-27-31-591Z-streaming/report.json, ../.qa/perf/2026-10-06T04-27-31-591Z-streaming/frame-stacks.json
    title: ソース28ファイルと時計対応付きの新地域・連続ワープCPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/068723d4-f33b-43c5-ab2f-370046da8d5b.jsonl, ../.qa/logs/2026-10-06/ba256f53-8493-4f7f-a51f-b6f8e88fbd9d.jsonl, ../.qa/logs/2026-10-06/7e02682b-4564-4b56-af38-70dc9b050a17.jsonl
    title: 最終部品・通常8場面・Profilerの端末ログ（ローカル保存）
  - id: tests
    resource: ../tests/roadNetworkWorker.test.ts, ../tests/log.test.ts
    title: 転送・所有権・特殊なDouble・検索と規制・共有参照・時刻・古い返答と失敗の検証
  - id: previous
    resource: terrain-worker-performance.md
    title: 返答コールバックの7.7msと復元0.5〜0.9msを区別した記録
---

# 返答を読む時間を切り分ける

前の66.6msフレームの道路返答コールバック約7.7msに対し、restoreMsは0.5〜0.9msだった。Vector3の復元が7.7msかかるという判断はできない。Chromeのnative MessageEvent.data getterを包み、最初の呼び出しだけを直接計時した。初回の東京駅12依頼は3.6〜5.0ms、吾妻橋は6.0〜7.7ms、2回目以降は計時精度内で0msだった。Chromium mainのgetterはserialized dataからDeserializeを呼ぶ。実測と整合するが、参照ソースをChrome154の同一revisionと扱わない。[^previous] [^initial] [^chromium]

**初回のフレーム値149.9/266.6msは無効。** 比較用の同期computeRoadNetworkが最初のrAFタイムスタンプへ混入していた。Long Animation Frameにも測定開始より約130/230ms前のimport.thenが載っていた。Worker返答のフレーム停止と解釈してはいけない。計測では参照計算の後250ms待ち、描画を返してから観測を開始するように修正した。getter自体の初回時間と、この無効なフレーム値は区別する。[^initial] [^component]

# Doubleの転送と直接復元

Workerで頂点のxyzと検索セルの区間・点番号をそれぞれFloat64Arrayへ並べ、区間とセルの境界をUint32Arrayへ並べる。セルのキーと配列順、区間のmetadata・節点・規制・診断は保つ。新たに作る4バッファだけをtransferし、元のsnapshotや入力をdetachしない。Float32へ落とさずDoubleの値を維持する。[^code] [^tests]

メインで検索セルのMapとpair配列を展開し、頂点は平坦なバッファから直接Vector3へ戻す。中間のxyz tupleを作ってからVector3を作る二重の割り当てを省く。既存の同期snapshotも復元できる。古い返答は展開前に破棄する。Workerの失敗・タイムアウト・破棄と、規制から区間・停止線への共有参照を保持する。[^code] [^tests]

road_network_preparedにreadMs・unpackMs・packMsを追加する。readMsは最初のdata取得、unpackMsは検索セルの展開、restoreMsはRoadGraph・Vector3・規制の復元、packMsはWorkerの平坦化だけ。WorkerのpostMessage内部の複製やログ等まで含むCPU合計ではない。返答待ちはdurationMsで別に測る。[^code] [^component]

# 実道路2地域で旧返答と比較

M2 Max・Chrome154.0.8037.97・WebGPU・ultra・1280×800・DPR1・夜雨・seed20261006。使用中の生道路と規制を取得する。東京駅1189区間・2929点・1991セル・8665pair、吾妻橋2373区間・5318点・2138セル・11143pair。旧Worker・計算・道路ソースはfc2f2059827dddbb5b229d8b4eb18601758e3cb6に固定して保存する。両方式を同じ最終Builderで計時し、6依頼ずつ4標本、順番をraw→packed / packed→rawと交互にする。計算は実Workerで行い、ゲームの使用中グラフを置き換えていないことも確認した。[^original] [^component]

座標・区間・節点・規制・検索セル等はObject.isで全照合した。**両方式それぞれ、東京駅3256056・吾妻橋5573400、計8829456数値比較が一致**。共有参照の同一性と時間規制後の検索は単体テストでも検査した。最終版6ファイルのソースSHAが計測後の作業ツリーと一致した。[^component] [^tests]

| 24返答の指標                | 東京駅・旧 | 東京駅・転送 | 吾妻橋・旧 | 吾妻橋・転送 |
| --------------------------- | ---------: | -----------: | ---------: | -----------: |
| 読み出しCPU合計             |     93.4ms |       65.6ms |    156.7ms |      120.8ms |
| 展開・復元を含む受信CPU合計 |    100.6ms |       83.5ms |    172.5ms |      143.3ms |
| 受信CPU中央値               |      4.1ms |        3.5ms |     6.75ms |        5.8ms |
| 受信CPU最大                 |      5.5ms |        3.8ms |     12.0ms |        7.7ms |
| 入力送信CPU合計             |     26.7ms |       26.1ms |     34.6ms |       35.4ms |
| Workerの平坦化CPU合計       |        0ms |       16.6ms |        0ms |       23.6ms |
| 返答待ち中央値              |    116.3ms |     116.45ms |    229.7ms |      225.7ms |

受信対象のCPU合計は両地域とも約17%減った。Workerの平坦化が増え、返答待ちは大幅に短縮されない。全ゲームの改善率と読み替えない。東京駅の8標本は最長33.4〜33.5ms・50ms超0、吾妻橋の転送4標本は33.4〜50.0ms・同0。吾妻橋の旧方式に66.8ms・同1があり、そのLong Animation Frameはtick50.2msと返答12.2msを含む。フレーム全体を返答の時間に帰属させない。[^component]

最初の転送版は中間tupleを作っていた。受信CPU合計96.9→91.0ms、164.0→152.2msと改善が小さく、東京駅の転送の最大5.1msは旧4.3msより大きかった。tupleの二重割り当てを省いて再計測し、上の最終値を得た。各起動の変動もあるため、変更前後の差のすべてをtuple削除の効果とは断定しない。[^intermediate] [^component]

# 全ゲームの停止は残る

Profilerなしの全8場面は次のとおり。変わらない道路125メッシュ・駐車16台を保持し、原点変更中の旧フレーム保持と連続ワープの最終地点への着地も通った。例外・Worker・道路・地形・ログ検証の失敗は0。画面で地面・建物・夜雨・ナビ・Yを目視した。端末2292行はすべてinfo。[^normal] [^logs]

| 場面                     |          最長rAF間隔 |      50ms超 |
| ------------------------ | -------------------: | ----------: |
| 通常走行2標本            |        33.4 / 33.4ms |     0 / 0回 |
| 同じ道路の更新3回        | 33.4 / 50.0 / 50.1ms | 0 / 0 / 2回 |
| 原点変更                 |               50.0ms |         0回 |
| 新地域                   |               50.1ms |         4回 |
| 古い依頼を挟む連続ワープ |               50.1ms |         1回 |

別起動のProfilerでは新地域66.7ms・50ms超11、連続ワープ50.1ms・同1。新地域の最長区間はシェーダー生成の包含約22.2ms、DEMのsampleGlobal self約4.3ms、toGeodetic self約4.3msを含んだ。連続ワープの最長区間はsampleGlobal self約7.4ms、toGeodetic約3.2ms等があった。包含とselfの値は足し合わせない。端末1957行はすべてinfo。ソース28ファイルが最終版と一致し、sessionとCDPの時計対応を確認した。**この転送で停止を完全修正したとはしない。** 次は道路の高さ照会とシェーダー生成、別計測で残った建物コライダーの生成を調べる。[^profile] [^logs] [^previous]

全1063テスト、型・lint・整形・justfile・Actions・knowledgeと本番ビルド（1.49s）が通った。転送時の元データ保持、NaN・符号付き0等のDouble、null/空セル、規制・検索・時刻・参照・古い返答・失敗を検査する。再現はjust measure-road-replies、just measure-road-streaming、QA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streaming。計測中は編集・ビルド・テストをしない。[^tests] [^component] [^profile]

[^code]: Workerの平坦化・転送とメインでの復元。

[^original]: 固定した旧返答。

[^chromium]: getterのDeserialize呼び出しの参考。

[^initial]: フレーム観測の混入を訂正した初回の記録。

[^intermediate]: 中間tupleの割り当てが残った版。

[^component]: 最終版の実道路・交互比較と値の一致。

[^normal]: Profilerなしの実ゲーム8場面と画面。

[^profile]: 時計対応付きの最終CPUスタック。

[^logs]: traceで限定して読んだ端末の全ログ。

[^tests]: Double・所有権・規制・検索・共有参照・寿命・失敗の回帰検証。

[^previous]: 復元の時間と返答全体の時間を区別した前段。
