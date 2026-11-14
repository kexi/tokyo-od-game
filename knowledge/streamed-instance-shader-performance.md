---
type: Metric
title: 道路インスタンスのシェーダーを表示前に準備する
description: 両backend・昼夜のHDR12582912byteが一致し、固定比較の同期生成9→0回。実夜雨の未読込地域は40回を非同期へ移したが、別計測の連続ワープ66.7msと準備の待ち時間増加が残る。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T07:29:00Z }
verified:
  - { by: process:1104-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T07:28:10Z }
  - {
      by: process:chrome154-both-backends-day-night-hdr-parity-growth-settings-and-cancellation,
      at: 2026-10-06T07:22:22Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-without-method-wrappers-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T07:24:54Z,
    }
  - { by: process:clock-mapped-warp-profiler-source-hashes-and-terminal-logs, at: 2026-10-06T07:27:24Z }
sources:
  - id: code
    resource: ../src/render/streamedInstanceShaders.ts, ../src/game/frameWork.ts, ../src/main.ts, ../src/world/roadInstances.ts
    title: 同じインスタンス・カメラ・シーン・HDR描画先で表示前に準備する
  - id: tests
    resource: ../tests/streamedInstanceShaders.test.ts, ../tests/frameWork.test.ts, ../tests/log.test.ts
    title: 可視性・描画先・削除・失敗・設定変更・順序とログの検査
  - id: parity
    resource: ../scripts/qa/instance-shader-parity.html, ../scripts/qa/perf-instance-shaders.mjs, ../.qa/perf/2026-10-06T07-22-04-336Z-instance-shaders/report.json
    title: 実WebGPU/WebGL・昼夜・6表示状態と準備中削除（ローカル保存）
  - id: baseline
    resource: ../.qa/perf/2026-10-06T07-05-29-266Z-streaming/report.json
    title: 前段1b978b7の診断ラッパーなし8場面（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T07-22-26-651Z-streaming/report.json, ../.qa/perf/2026-10-06T07-22-26-651Z-streaming/night-rain.png
    title: 最終の診断ラッパーなし8場面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T07-25-23-292Z-streaming/report.json, ../.qa/perf/2026-10-06T07-25-23-292Z-streaming/frame-stacks.json
    title: 時計対応付きの最終ワープのCPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/a04b1966-c1ea-4f6f-aca3-d818d249ad9a.jsonl, ../.qa/logs/2026-10-06/730deafe-7c48-48de-a7a5-95ebf12fd683.jsonl
    title: 通常計測とProfilerの端末JSONL（ローカル保存）
  - id: renderer
    url: https://threejs.org/docs/pages/Renderer.html#compileAsync
    title: Three.jsのcompileAsyncと対象シーンの指定
  - id: previous
    resource: collider-worker-performance.md, terrain-water-triangle-performance.md
    title: 前段の同期インスタンス生成と水域改善後の停止
---

# 表示前の準備と再利用

RoadInstancesは同じgeometry/materialのInstancedMeshを再利用するが、容量が足りない時と新しい種類には新しいUUIDが必要になる。Three.js 0.186.1のnode builderのキーにはそのUUIDが含まれ、前段の夜雨計測では未読込地域にMeshStandardMaterialの同期生成40回・CPU410.7msが残っていた。[^previous] [^code]

道路反映に使うFrameWorkのyield前に、シーン直下の新しい可視・非空インスタンスを準備する。実際のメッシュ・カメラ・対象シーンとFrameComposerのHDRターゲットをcompileAsyncへ渡す。先に全対象を非表示にし、初期化済みレンダラーが同期的に対象を収集する間だけ可視化する。ターゲット・cube face・mipmap level・cullingを同期的に復元してからPromiseを待つ。別のフレームへターゲット変更を持ち越さず、後続の未準備メッシュも早く描かせない。[^code] [^renderer]

同じUUID・材質・version・instanceColor構成の再利用では再準備しない。準備中の材質変更では再試行する。外された対象をシーンへ再追加せず、dispose済みの対象を表示しない。disposeがコンパイルより先に来た場合、完了後にインスタンスをもう一度disposeして後から確保された専用バッファを解放する。共有のgeometry/materialの所有権は変えない。コンパイル失敗をstreamed_shader_failedへ記録し、従来の初回描画へ戻して無限再試行を避ける。[^code] [^tests]

compileAsyncのCPU自体はメインスレッドであり、Workerへ移した変更ではない。非同期待ちを除くFrameWorkのroad_network_built.cpuMsにはこのシェーダー処理のCPUは含まれない。streamed_shaders_prepared.durationMsとQAのasyncShadersも待ち時間込みで、同期CPUと足して改善率にはしない。[^code] [^profile]

# HDRの描画と中断

M2 Max・Native Chrome154.0.8037.97（revision b510e9d7cd3a2fbd78d0ddc42234103206c5f78d）。実RoadInstancesを使い、8メッシュを同じ材質で共有し、instanceColor・複数材質・混在culling・影を含める。WebGPU/WebGLの昼夜で、従来描画と表示前準備を比較した。HDR256×256の初回・定常・再利用・容量拡張・準備中のflatShading変更・原点変更の6状態、計**12582912byte（6291456個の16bit成分）が完全一致**した。geometry/material/UUID/matrix/colorも準備前後で一致した。[^parity]

4組それぞれの標準材質の同期生成は9→0回。従来のCPU合計はWebGPU昼32.6ms・夜26.0ms、WebGL昼36.8ms・夜31.2ms。準備の初回wall timeはWebGPU43.2/42.9ms、WebGL634.7/650.7msであり、非同期化で合計時間をゼロにしたものではない。容量2→8の拡張、材質設定変更中の再確認、同じインスタンスの再利用時0msも観測した。[^parity]

各backend・昼夜の4中断で、コンパイルの途中にRoadInstances.clearを実行した。対象は全て外され非表示で、専用のinstanceMatrixバッファは解放済み、同期build0回。共有geometry/materialは最後にQAの所有者が破棄する。4ソースのハッシュは最終コードと一致し、20行のブラウザログに警告・エラーは無い。[^parity]

# 夜・雨の実ゲーム

WebGPU・ultra・rooms・1280×800・DPR1・seed20261006・東京駅から吾妻橋。編集・テスト・ビルドとGPU計測を同時実行しなかった。まず前段の34ソースでQA_TIMING_ONLY=1を実行し、同じ8場面を最終の37ソースでも計測した。両方ともCPU Profilerとメソッド/シェーダーの診断ラッパーを外すが、rAF・LoAF・ゲームの構造化ログは残るので診断費用ゼロとはしない。最終37ソースの保存ハッシュは作業ツリーと一致した。[^baseline] [^normal]

| 場面       | 前段最長 / 50ms超 | 最終最長 / 50ms超 |
| ---------- | ----------------: | ----------------: |
| 通常1      |      33.4ms / 0回 |      33.5ms / 0回 |
| 更新1      |      33.5ms / 0回 |      50.0ms / 0回 |
| 通常2      |      33.4ms / 0回 |      33.5ms / 0回 |
| 更新2      |      33.5ms / 0回 |      50.0ms / 0回 |
| 更新3      |      50.0ms / 0回 |      50.1ms / 1回 |
| 原点変更   |      33.5ms / 0回 |      50.1ms / 2回 |
| 未読込地域 |      66.7ms / 5回 |      50.1ms / 9回 |
| 連続ワープ |      50.1ms / 1回 |      66.7ms / 1回 |

未読込地域のp50/p95は両方33.3/33.4ms。完了まで22.3→26.6秒、道路反映5.36→9.49秒で、42個の準備にwall time合計4.60秒を費やした。起動時の道路反映も4.05→8.21秒だった。連続ワープは16.8→16.6秒、準備9個・合計555.5ms。単一の異なる起動でロード・GC・場面が変動し、全体の高速化や停止の完全修正と扱わない。[^baseline] [^normal]

全8場面でゲーム/traceが維持され、通常更新の道路125メッシュ・駐車16台が再利用された。原点変更では旧フレーム保持、連続ワープでは最後の地点への着地を確認。夜雨画像を目視確認し、端末4683行は全てinfo、対象失敗0件。[^normal] [^logs]

別起動のProfilerでは未読込地域66.7ms・50ms超7回、連続50.1ms・同1回。時計はbefore37504.1ms ≤ mapped37504.923ms ≤ after37531.8msで整合した。未読込地域の標準材質40回とUntonemappedBasicMaterial2回は非同期へ移り、同期buildは影用NodeMaterial117回・合計56.0ms・最大1.8ms。連続は標準材質の非同期9回に加え、通常メッシュの同期2回・合計18.5msが残る。対象以外の同期生成ゼロとはしない。[^profile]

最長66.7ms区間はshaderBuildの包含26.885ms、GC self13.112ms、影描画の包含4.465ms。スタックにはbuildAsyncの段階がある。非同期でも複数の段階とフレーム処理が重なる停止は残る。連続の50.1ms区間はshaderBuild0ms・GC self1.5msで、影やwriteBufferも含む。包含群は重なるため合計CPUに足さない。端末3220行はinfo3219・外部tide_table_failedのwarn1で、ゲーム内対象失敗0件。[^profile] [^logs]

再現はjust measure-instance-shaders、env QA_TIMING_ONLY=1 node scripts/qa/perf-road-streaming.mjs、env QA_PROFILE=1 QA_MODES=coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjsを順番に実行する。7件の状態・順序テストを追加し、全106ファイル・1104テストと型・lint・整形・justfile・Actions・SHA pin・OKFのCI相当検査がPASSした。[^tests]

[^code]: 表示前の準備、材質の再確認、対象の再利用とフレーム順序。

[^tests]: 回帰検査と登録されたログ形状。

[^parity]: 実際の両backendのHDR比較と削除中断。

[^baseline]: 前段の診断ラッパーなしの実ゲーム8場面。

[^normal]: 最終の診断ラッパーなしの実ゲーム8場面。

[^profile]: 最終の時計対応付きCPUサンプルと同期/非同期build記録。

[^logs]: 二つの実ゲームtraceを端末で検査したJSONL。

[^renderer]: 対象シーンの光・環境が設定済みである必要を示す一次資料。

[^previous]: 前段のインスタンス生成と水域の計測。
