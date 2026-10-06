---
type: Metric
title: 水域の地形三角形判定で一時配列を作らない
description: 実水域16タイル・320比較のCPU合計85.3→25.2ms。829万個のindex値・30境界マスクと実48タイルの物理形状・767レイが一致。夜雨のワープ66.7msと同期BVH更新は残る。
tags: [terrain, physics, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T06:58:36Z }
verified:
  - { by: process:1097-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T06:48:27Z }
  - { by: process:chrome154-real16-water-masks-320-paired-calls-and-30-boundaries, at: 2026-10-06T06:49:37Z }
  - {
      by: process:chrome154-real48-colliders-worker-fallback-767-rays-and-full-water-fall,
      at: 2026-10-06T06:51:31Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenarios-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T06:54:19Z,
    }
  - { by: process:clock-mapped-warp-cpu-profile-source-hashes-and-terminal-logs, at: 2026-10-06T06:55:46Z }
sources:
  - id: code
    resource: ../src/world/terrainWaterTriangles.ts, ../src/world/terrain.ts
    title: 同じ水域条件をTypedArrayへ直接書き込む判定
  - id: tests
    resource: ../tests/terrainWaterTriangles.test.ts, ../tests/terrainWorker.test.ts, ../tests/colliderSnapshot.test.ts
    title: 閾値・岸・中心・端・入力所有権・全水域と実物理接触の検査
  - id: component
    resource: ../scripts/qa/perf-terrain-water.mjs, ../.qa/perf/2026-10-06T06-48-27-075Z-terrain-water/report.json
    title: 前段c5a6558の実処理と実16タイル、交互順の320比較（ローカル保存）
  - id: physics
    resource: ../scripts/qa/perf-collider-worker.mjs, ../.qa/perf/2026-10-06T06-50-00-209Z-collider-worker/report.json
    title: 前段024a067の実処理と変更後の実48タイルの形状・レイ・全水域（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T06-51-31-669Z-streaming/report.json, ../.qa/perf/2026-10-06T06-51-31-669Z-streaming/night-rain.png
    title: Profilerなしの最終夜雨8場面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T06-54-19-243Z-streaming/report.json, ../.qa/perf/2026-10-06T06-54-19-243Z-streaming/frame-stacks.json
    title: 時計対応を検証した最終ワープのCPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/752c543a-f1ce-467b-9f15-11ad5a0bd29e.jsonl, ../.qa/logs/2026-10-06/a013993f-50d3-47f1-ba8d-de6c8c38321a.jsonl, ../.qa/logs/2026-10-06/811ca764-8cf9-4f96-a084-85d26254c2ca.jsonl, ../.qa/logs/2026-10-06/e66f3cb1-c0fb-42dc-b9f0-731c64ab51f2.jsonl
    title: 水域比較・物理比較・通常8場面・Profilerの端末JSONL（ローカル保存）
  - id: previous
    resource: collider-worker-performance.md
    title: 前段で残った同期水域更新6.4/6.5msとワープ66.7ms
---

# 判定の条件と三角形を保持する

地形の水域変更は、描画用のマスクと物理用の地形を同じフレームで更新する。前段の実測ではこの経路に最大6.4/6.5msが残っていた。従来のdryTrianglesは各三角形でindexの配列・座標の組・map結果・everyのコールバックを作り、残すindexをnumber配列へpushしていた。1タイル8192面で、繰り返す水域更新やコライダー準備時に一時割り当てが生じる。[^previous] [^code]

index3個から同じ剰余とfloorで座標を読み、同じmaskのpixelへ同じ上限clampで投影する。三つの角と中心が全て128以上の水域のときだけ地形を除く。岸に触れる面、中心が乾いた面、狭い水域を跨ぐ面を保持する条件を変えない。出力は最大長のUint32Arrayへ直接書き、除去した面があれば必要長へsliceする。入力indexの配列を変更せず、返す配列は独立した所有権を持つ。[^code] [^tests]

水域の同期BVH再生成自体をWorkerへ移した変更ではない。地形・建物のWorker、全水域の準備済み状態、原点変更・中断・スポーン契約も保持する。[^code] [^tests]

# 実水域の交互比較

M2 Max・Native Chrome154.0.8037.97、revision b510e9d7cd3a2fbd78d0ddc42234103206c5f78d。WebGPUの実ゲームを夜雨で開始し、30秒温めて東京駅周辺、ワープ完了から15秒後に吾妻橋のタイルを取得した。実maskをコピーして固定し、前段c5a6558の本物のTerrain.prototype.dryTrianglesと最終の本番メソッドを呼ぶ。各タイルの両処理を4回温め、20回の比較で前→後/後→前を交互に実行し、各比較の間に描画へyieldする。[^component]

実水域は東京9・吾妻橋7の16タイル、各mask1024×1024、入力合計131072面・残す面125846。30境界条件も含めて**8289603個のindex値が一致**した。境界のmaskサイズは1/3/4/63/64/127で、全乾燥・全水域・127/128の閾値・岸・乾いた中心を比較する。実maskのSHA-256と最終3ソースのハッシュも保存し、作業ツリーとの一致を確認した。[^component]

| 実水域のCPU   | 呼び出し | 前段合計 / 最大1回 | 最終合計 / 最大1回 |
| ------------- | -------: | -----------------: | -----------------: |
| 東京9タイル   |      180 |     48.4ms / 0.9ms |     13.8ms / 0.2ms |
| 吾妻橋7タイル |      140 |     36.9ms / 1.1ms |     11.4ms / 0.2ms |
| 合計          |      320 |     85.3ms / 1.1ms |     25.2ms / 0.2ms |

全320回のp50は0.2→0.1ms、p95は0.4→0.2ms。時計の分解能・JIT・GCの変動を含む、固定した16maskに対する観測値であり、任意の水域に対する上限保証やゲーム全体の改善率にはしない。端末2158行は全てinfo、対象の失敗0件。[^component] [^logs]

# 物理形状と全ゲーム

従来024a067の実Terrain/BuildingsのcreateColliderと、変更後の実48タイルを別のNative実行で比較した。入力4350285値、Workerとフォールバックそれぞれ4346517物理値・767本の命中レイの距離/法線/featureが一致した。全水域は固い地形0件で、実動的ボディが30ステップでY=3から1.7635316848754883へ落下した。7ソースのハッシュは最終コードと一致。端末2386行はinfo2385・QAで意図したWorker不可のwarn1で、ゲームの実Worker障害ではない。[^physics] [^logs]

全ゲームはWebGPU・ultra・rooms・1280×800・DPR1・夜雨・seed20261006。GPU計測と編集・テスト・ビルドを同時実行しなかった。34ソースのハッシュが一致し、道路125メッシュ・駐車16台の再利用、原点変更中の旧フレーム保持、連続ワープの最後の地点への着地と夜雨の画面を確認した。[^normal]

| Profilerなしの場面   | 最長rAF間隔 | 50ms超 |
| -------------------- | ----------: | -----: |
| 通常1                |      33.5ms |    0回 |
| 通常更新1            |      33.5ms |    0回 |
| 通常2                |      33.5ms |    0回 |
| 通常更新2            |      33.4ms |    0回 |
| 通常更新3            |      33.4ms |    0回 |
| 原点変更             |      50.0ms |    0回 |
| 未読込の吾妻橋へ移動 |      66.7ms |    5回 |
| 連続ワープ           |      66.7ms |    2回 |

地形の水域更新は最大4.0/3.6ms、同期コライダー登録は最大3.8/3.4msだった。前段の別起動では水域更新6.4/6.5ms・通常の両ワープ最長50.1msであり、今回を全ゲームの改善と扱わない。今回の未読込地域はp50=33.3ms・p95=33.4ms、連続はp50=16.7ms・p95=33.4ms。端末3856行は全てinfoで、対象の失敗0件。[^normal] [^previous] [^logs]

別のCPU Profilerでは未読込地域66.7ms・50ms超11回、連続50.1ms・同2回。CDP/ページの時計対応はbefore=36696.8ms、mapped=36697.491ms、after=36721.6msで範囲内。最長区間はGC self10.789ms・影描画の包含11.045msで、別の66.6ms区間にshaderBuild包含11.219ms、別の50.1ms区間に同18.788msが残った。包含する群は重なるため足してCPU合計にしない。[^profile]

Profilerの水域更新も最大4.1/3.7ms、34ソース一致、対象の失敗0件。端末3147行はinfo3146・外部tide_table_failedのwarn1で、外部fetch失敗を0件としない。これらはphase/shaderを記録する診断付きの実測で、診断の割り当て費用まで0と保証したものではない。非診断のフレーム計測も今後の検証対象とする。独立した起動では場面・非同期ロード・GCが変動し、停止の完全修正は未達成。[^profile] [^logs]

再現は開発サーバー上でjust measure-terrain-water、just measure-collider-worker、just measure-road-streamingを順に実行する。Profilerはenv QA_PROFILE=1 QA_MODES=coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjs。8件の境界テストを加え、全105ファイル・1097テスト、型・lint・整形・justfile・SHA pin・Actions・OKF検査PASS。本番ビルド1.23秒。[^tests]

[^code]: 保持する三角形をTypedArrayへ書く実装とTerrainの呼び出し。

[^tests]: 境界と所有権・全水域・接触・既存地形の回帰検査。

[^component]: 保存した前段の実処理と実水域の交互CPU・index比較。

[^physics]: 実48タイルの形状・レイ・全水域の落下比較。

[^normal]: Profilerなしの最終夜雨8場面。

[^profile]: 時計対応付きの最終CPUサンプル。

[^logs]: 各traceの端末JSONL。

[^previous]: 前段のWorker対応後の実測。
