---
type: Metric
title: GPUのuniform転送をまとめても描画CPUはほぼ変わらない
description: 実ワープの転送回数は約28〜36%減るが、交互比較の描画CPUは昼夜とも約0.35%差。全18874368画素byteは一致。50.1msが残るため本番適用を見送ってQA限定に保存
tags: [rendering, testing, logging]
status: draft
generated: { by: codex, at: 2026-10-06T12:29:58Z }
verified:
  - {
      by: process:1155-tests-types-lint-format-just-actions-knowledge-and-production-build,
      at: 2026-10-06T12:29:58Z,
    }
  - { by: process:chrome154-48-native-images-18874368-bytes-and-five-source-hashes, at: 2026-10-06T12:20:50Z }
  - {
      by: process:chrome154-two-scenes-eight-alternating-cpu-samples-each-and-seven-source-hashes,
      at: 2026-10-06T12:24:45Z,
    }
  - {
      by: process:chrome154-two-live-warps-native-write-counters-54-source-hashes-and-terminal-logs,
      at: 2026-10-06T12:26:39Z,
    }
  - { by: process:five-uniform-bits-offsets-fallback-and-lifetime-tests, at: 2026-10-06T12:26:54Z }
sources:
  - id: experiment
    resource: ../scripts/qa/uniformUploads.ts, ../tests/uniformUploads.test.ts
    title: QA限定の小さなuniform転送実験とビット・offset・復旧の検証
  - id: baseline
    resource: ../.qa/perf/2026-10-06T11-54-38-551Z-streaming/report.json
    title: 実ワープの旧binding更新CPUとrangeに基づく転送回数見積り（ローカル保存）
  - id: parity
    resource: ../scripts/qa/uniform-upload-parity.html, ../scripts/qa/uniform-upload-parity.mjs, ../.qa/perf/2026-10-06T12-20-18-681Z-uniform-parity/report.json
    title: WebGPU/WebGL2・昼夜・6姿勢・2カメラの実GPU画素byte比較（ローカル保存）
  - id: cpu
    resource: ../scripts/qa/perf-uniform-uploads.mjs, ../.qa/perf/2026-10-06T12-20-59-188Z-uniform-cpu/report.json, ../.qa/perf/2026-10-06T12-13-54-388Z-uniform-cpu/report.json
    title: 更新を止めた同じ実ゲームで、転送ごとの診断なしのCPU交互比較2起動（ローカル保存）
  - id: live
    resource: ../scripts/qa/perf-road-streaming.mjs, ../.qa/perf/2026-10-06T12-24-54-943Z-streaming/report.json
    title: QA_BINDINGS=1 QA_COALESCE=1の夜雨の実ワープ（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/db7e8c90-eedf-4db7-9f44-fe84b2a2d33c.jsonl, ../.qa/logs/2026-10-06/5e2a3b4f-b06a-4ad6-b734-77c55e6e1422.jsonl, ../.qa/logs/2026-10-06/244d1b36-d0ea-479f-ba4d-eb9c0dbad0ef.jsonl
    title: 最終計測の3traceに限定して読んだ端末JSONL（ローカル保存）
  - id: comparison-fix
    resource: ../.qa/perf/2026-10-06T12-01-49-550Z-uniform-parity/report.json, ../.qa/perf/2026-10-06T12-04-56-338Z-uniform-parity/report.json, ../.qa/perf/2026-10-06T12-07-20-570Z-uniform-parity/report.json, ../.qa/perf/2026-10-06T12-08-30-650Z-uniform-parity/report.json, ../.qa/perf/2026-10-06T12-09-57-753Z-uniform-parity/report.json
    title: 比較器の影更新・WebGL読出しの問題と旧処理同士の再検証（ローカル保存）
  - id: queue-api
    resource: https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer
    title: typed arrayのdataOffsetとsizeは要素数、bufferOffsetはbyte
  - id: previous
    resource: vector-tile-worker-performance.md
    title: 停止区間でGPU転送・影・GC・地面照会が重なった前段
---

# 転送回数の削減だけを速度改善と扱わない

前段のCPUプロファイルにはwriteBufferのself約3.232msなどがあるが、サンプリングからの推定であり、単一関数を直接測った値ではない。実ワープでbindingUtils.updateBindingを囲った旧処理のCPU合計はcoldWarp 1121.9ms、latestWarp 585.3ms。rangeから数えた旧転送の見積りは2237470回・1256346回、まとめられるspanの最大は672byteだった。計測ラッパーの負荷を含み、この合計から描画全体の改善率は出せない。[^previous] [^baseline]

Three 0.186.1のUniformsGroupは変更箇所だけでなく全値とpaddingをCPUのFloat32Arrayに持つ。4KiB以下の離れたrangeの間も含めて1回転送するQA限定の実験を作った。range順・ビット値・layoutを維持し、WebGL、単一range、大きなbufferは元の処理を使う。private backendへの依存と追加転送量に見合う効果がないため、src/の描画コードには導入しない。[^experiment] [^queue-api]

# 同じゲーム内の描画CPUを交互比較

M2 Max、Native Chrome154 / Metal WebGPU、ultra・rooms、1280×800 DPR1、seed20261006。ゲームを30秒温め、通常の車内視点を捕まえてシミュレーション更新だけを止める。同じシーン・車内・ミラー・ナビ転送条件で、旧→実験→実験→旧→実験→旧→旧→実験の順に各8秒（2秒温め＋6秒計測）描画。各方式1448描画、各期間の前後と期間間でobject数・姿勢・可視性のhashが一致した。GPU転送やbinding更新ごとの診断を入れず、車内・街・present全体を1つの時計区間で測る。[^cpu]

| 場面                 | 旧処理の平均CPU | 実験版の平均CPU |      差 |
| -------------------- | --------------: | --------------: | ------: |
| 夜雨・3777 objects   |        11.061ms |        11.022ms | 約0.35% |
| 昼晴れ・3759 objects |        10.540ms |        10.503ms | 約0.36% |

別起動の同じ順序でも夜雨11.442→11.435ms（約0.07%）、昼晴れ10.559→10.484ms（約0.71%）。起動間で読み込まれた対象が違うため合算しない。最終比較の夜雨のCPU最大は旧17.0ms・実験18.2ms、昼晴れは17.1ms・16.2ms。全期間のrAF最大16.8ms、50ms超0回で両方式とも同じだった。シミュレーションを止めた部品比較であり、実ワープの停止が直った証拠ではない。LoAFはこのCPU比較では計測していない。7ソースhashは全不変、errors配列は空、最終2traceの端末ログはinfo1856行・1800行のみ。[^cpu] [^logs]

# 実ワープのnative転送数と増えた転送量

QA_BINDINGS=1は実際のqueue.writeBuffer呼出しとbyteを数え、元のrangeに基づく旧処理の見積りをlegacyWrites / legacyBytesとして別に記録する。QA_COALESCE=1で実験版だけを適用した同一ワープ内では以下になった。全フレームでnative数・byteが旧rangeから算出した結果と一致した。旧見積りとactualを混同しない。[^live]

| 場面       | 旧rangeの転送見積り | 実native転送 | 回数減 | 転送byte増 |
| ---------- | ------------------: | -----------: | -----: | ---------: |
| coldWarp   |             2129605 |      1536641 |  約28% |      約18% |
| latestWarp |             1315884 |       846022 |  約36% |      約25% |

coldWarp rAF最大50.1ms（50ms超2回）、latestWarp 50.0ms（0回）、LoAF両方0件、errors空。binding診断のCPU合計は1085.0ms / 607.1msだが、旧の別起動と呼出し量も計測負荷も異なるため速度比較に使わない。54ソースhashすべて不変、trace244d1b36…の端末ログ3418行はすべてinfoだった。転送の削減は確かめたが、CPU差の再現性と停止改善が得られないため本番適用を見送った。[^live] [^logs]

# 描画の一致と比較器の修正

実GPUの比較器は行列・vec3・float・int・uintのuniform、24個の箱、床、4灯、太陽の影を使う。6姿勢と2カメラで値・光・材質・カメラを変え、途中でgeometryを交換。WebGPU HDR12582912byte＋WebGL2 RGBA6291456byte、計48画像・18874368byteが完全一致した。各昼夜・backendで実際の画像変化も確認し、空画像同士の一致を成功としない。WebGPU各条件のnative転送2283→615回、byte92932→150032。これは合成場面の値で、実ゲームの削減率に使わない。各bindingの旧rangeが作る論理bufferと実転送byteも一致し、5ソースhashは全不変だった。[^parity]

初期の比較器では画素差が出たが、GPUへ渡す論理byteは一致し、旧処理同士でも同じ画素差が出た。Threeの影更新は実rAFのframeIdとcameraで再利用するので、同じ実フレーム内で連続して光・姿勢を変えると、shadow.needsUpdateだけでは同じ比較条件にならなかった。毎回のwarm描画と比較描画の前に実rAFを待つよう直した。WebGLのHalfFloat読出しでは空の値を比較していたためUnsignedByteへ変更し、resolveDepthBufferを実ゲームと同じfalseにした。修正後の旧処理同士を先に確認し、その後に実験版を確認した。初期の失敗を転送実験の不具合の証拠として使わない。[^comparison-fix] [^parity]

再現は起動中の開発サーバーに対してjust check-uniform-upload-parity、just measure-uniform-uploads。実ワープ診断はQA_TIMING_ONLY=1 QA_BINDINGS=1 QA_COALESCE=1 QA_MODES=coldWarp,latestWarp just measure-road-streaming。QA_BINDINGSもQA_COALESCEも既定は無効。計測中はソース編集、テスト・build、別のNative GPU計測を並行しない。[^experiment] [^cpu] [^live]

[^experiment]: QA専用module。production rendererは前段と同じ。

[^baseline]: 初回のwrites / bytesはrange由来の見積り。最終計測器ではlegacyという名前で明示する。

[^parity]: Native readRenderTargetPixelsAsyncと実queue呼出しを使用。

[^cpu]: 2起動の生の全期間とソースsnapshotをローカルJSONに保存。

[^live]: 通常シミュレーション・ストリーミングを動かす診断付きの別起動。

[^logs]: ブラウザコンソールを不具合判断の根拠にせず、計測trace限定の端末JSONLを読む。

[^comparison-fix]: 不一致と空画像の比較を失敗記録として残す。

[^queue-api]: Float32ArrayのdataOffset / sizeをbyteとして渡さない。

[^previous]: 50ms区間のsample deltaを直接CPU計測と取り違えない。
