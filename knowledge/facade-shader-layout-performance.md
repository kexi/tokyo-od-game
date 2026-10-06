---
type: Metric
title: PLATEAUの外壁シェーダーの頂点構成を保持する
description: 実タイルの同じキーの再生成を確認し、2構成を小さなメッシュで保持する。両backend・昼夜・全窓設定の26214400画素成分が一致し、再表示を含む同期生成4→0回。実夜雨の両ワープも外壁生成0回、最長50.1msが残る。
tags: [plateau, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T07:57:00Z }
verified:
  - { by: process:1107-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T07:50:54Z }
  - { by: process:chrome154-real-warp-geometry-layouts-and-cache-keys, at: 2026-10-06T07:40:17Z }
  - {
      by: process:chrome154-both-backends-day-night-all-window-settings-reload-and-cancellation,
      at: 2026-10-06T07:51:28Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T07:54:21Z,
    }
  - { by: process:clock-mapped-warp-profiler-source-hashes-and-terminal-logs, at: 2026-10-06T07:56:27Z }
sources:
  - id: code
    resource: ../src/world/facadeShaderLayouts.ts, ../src/world/buildings.ts, ../src/main.ts
    title: 小さな2構成を表示せず準備し、材質でシェーダーを保持する
  - id: tests
    resource: ../tests/facadeShaderLayouts.test.ts, ../tests/buildingShaders.test.ts, ../tests/buildingFacadeWorker.test.ts
    title: 構成・所有権・待機の共有・中断・再試行と既存ロードの契約
  - id: installed
    resource: ../node_modules/three/src/renderers/common/RenderObject.js, ../node_modules/three/src/renderers/common/nodes/NodeManager.js
    title: 使用中のThree.js 0.186.1のキーと材質破棄による参照の解放
  - id: baseline
    resource: ../.qa/perf/2026-10-06T07-38-23-406Z-streaming/report.json, ../.qa/perf/2026-10-06T07-38-23-406Z-streaming/frame-stacks.json
    title: 前段6ad546eの実キャッシュキーと時計対応付きCPU（ローカル保存）
  - id: parity
    resource: ../scripts/qa/building-shader-parity.html, ../scripts/qa/perf-building-shaders.mjs, ../.qa/perf/2026-10-06T07-50-54-793Z-building-shaders/report.json
    title: 両backendの全24条件と破棄後の再表示（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T07-51-53-257Z-streaming/report.json, ../.qa/perf/2026-10-06T07-51-53-257Z-streaming/night-rain.png
    title: 最終の診断ラッパーなし8場面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T07-54-50-301Z-streaming/report.json, ../.qa/perf/2026-10-06T07-54-50-301Z-streaming/frame-stacks.json
    title: 時計対応付きの最終ワープのCPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/d730034e-7e04-4e1a-ab57-285797ef9251.jsonl, ../.qa/logs/2026-10-06/be3f9859-4fc7-4695-9e62-30b9b45cb0d9.jsonl
    title: 最終の通常計測とProfilerの端末JSONL（ローカル保存）
  - id: previous
    resource: streamed-instance-shader-performance.md, building-shader-performance.md, building-gpu-cache-performance.md
    title: 非同期化後も残った外壁の初回生成とキャッシュの破棄
---

# 実際の頂点構成とキャッシュ

前段の66.7ms区間には外壁のbuildAsyncとGCが重なった。追加Profilerで、吾妻橋と戻り先の両方に同じgeometryKeyとcacheKeyのFacadeMaterial生成があった。構成は_feature_id_0（Uint16・stride2・offset0・itemSize1）と、Float32のposition/normal各3、facade2、indexあり。UVは無い。前段の追加計測は未読込地域50.1ms・連続66.7msで、同じ構成の外壁生成wall timeは21.4/17.9msだった。[^baseline] [^previous]

Three.jsのRenderObjectのキーは未使用の属性名・stride・offset・itemSize・normalized・indexの有無も含む。NodeManagerは材質破棄でRenderObjectの参照数を減らし、同じキーを使う最後の参照がなくなるとnode builder状態を削除する。共有のノードグラフだけでは、全タイルが離れた地域から戻る時の再生成を防げない。[^installed]

_batchidの非interleaved構成と、実測した_feature_id_0のstride2構成を、各3頂点の専用メッシュで準備する。初回タイルの準備とロード画面のprecompileで同じbankを使い、同時依頼は同じPromiseを待つ。geometry.disposeでGPU頂点バッファを解放するが、専用材質は保持してキャッシュの参照を残す。新しい材質versionは再準備し、失敗は準備済みにせず再試行できる。破棄中の非同期処理が終わった後にも材質を解放する。[^code] [^tests]

専用メッシュは実シーンへ追加しない。実タイルの属性・行列・材質・形状は変更しない。ここで保持するのは調査した2構成で、未知の属性構成は既存の実タイルのprepareBuildingShadersへフォールバックする。GPU資源や準備のCPUが無償になる変更ではない。材質の持つシェーダー状態とbindingは小さな準備メッシュにも残る。[^code]

# 再表示と描画の検査

M2 Max・Native Chrome154.0.8037.97 / revision b510e9d7cd3a2fbd78d0ddc42234103206c5f78d。従来のUVありの全窓設定・準備中設定変更・中断の20条件を保持し、実PLATEAUと同じUVなしの2構成でタイル破棄後の新規メッシュの再表示4条件を追加した。両backend・昼夜で全24条件が成功し、**26214400個の8bit画素成分が完全一致**した。元の属性・geometry/material・混在cullingも一致。6ソースのハッシュは最終コードと一致し、ブラウザの警告・エラーは0件。[^parity]

| 2構成の初回・破棄後再表示 | 前段の同期生成 / CPU合計 | 保持後の同期生成 |
| ------------------------- | -----------------------: | ---------------: |
| WebGPU 昼                 |             4回 / 39.9ms |              0回 |
| WebGPU 夜                 |             4回 / 35.5ms |              0回 |
| WebGL2 昼                 |             4回 / 38.7ms |              0回 |
| WebGL2 夜                 |             4回 / 50.0ms |              0回 |

保持後には先に専用メッシュの非同期buildが2回ある。reportのpreparationMs（0.5〜0.8ms）はその後の実タイルのprepareBuildingShadersのみで、専用メッシュを準備する合計時間ではない。専用材質も破棄した後のnode builder状態数は従来と同じ1（残った床の状態）。元の4中断では、外壁のGPU頂点と状態は0へ戻った。[^parity]

最初の再表示試験はUVありのBoxGeometryとUVなしの専用メッシュで比較して失敗した。画像は一致しても、別キーの材質を準備しており保持の証明になっていなかった。キーを記録してこの違いを確認し、元のUVあり試験を残した上で、調査したUVなし構成の比較を独立させた。失敗した結果は.qa/perf/2026-10-06T07-45-43-161Z-building-shadersと07-47-48-106Z-building-shadersに保存されている。[^parity] [^installed]

# 夜・雨の実ゲーム

WebGPU・ultra・rooms・1280×800・DPR1・seed20261006。最終の全描画比較・実ゲーム計測は編集・テスト・ビルドと同時実行しなかった。QA_TIMING_ONLY=1ではメソッド/シェーダーの診断ラッパーとProfilerを外すが、rAF・LoAF・構造化ログは残す。最終38ソースの保存ハッシュを照合した。[^normal]

| 場面       | 最長rAF間隔 | 50ms超 |
| ---------- | ----------: | -----: |
| 通常1      |      33.4ms |    0回 |
| 更新1      |      33.4ms |    0回 |
| 通常2      |      33.4ms |    0回 |
| 更新2      |      33.4ms |    0回 |
| 更新3      |      33.5ms |    0回 |
| 原点変更   |      33.5ms |    0回 |
| 未読込地域 |      50.1ms |    6回 |
| 連続ワープ |      50.1ms |    3回 |

未読込地域のp50/p95は33.3/33.4ms、完了26.2秒、道路反映9.32秒。連続ワープは16.7/33.4ms、完了16.7秒、道路反映3.23秒。前段の別起動は両ワープ50.1/66.7msで、ロード・GC・場面が変動するので全体の改善率や上限保証にはしない。道路125メッシュ・駐車16台の再利用、原点変更中の旧フレーム保持、最後のワープ先への着地、夜雨の画像を確認した。端末4116行は全てinfo、対象失敗0件。[^normal] [^previous] [^logs]

別起動のProfilerでは両ワープの外壁の同期・非同期buildがともに0回。未読込地域50.1ms・50ms超5回、連続50.0ms・同0回。時計はbefore35558.8ms ≤ mapped35559.550ms ≤ after35589.3ms。最長の未読込区間はshaderBuild0ms・影包含7.033ms・GC self1.515msで、toGeodetic self4.502msやsampleGlobal self3.012msが載った。別の50.1ms区間には道路返答の復元とbuildSignalsがある。連続の最長50.0msもshaderBuild0ms。通常メッシュの同期生成は別区間に1回・9.6msが残る。包含群を足してCPU合計にしない。38ソースのハッシュが一致し、端末3229行は全てinfo、対象失敗0件。[^profile] [^logs]

外壁の再生成は測定した両ワープから除けたが、道路反映・地形照会・影描画などによる約50msは残っている。停止の完全修正は未達成。再現はjust measure-building-shaders、env QA_TIMING_ONLY=1 node scripts/qa/perf-road-streaming.mjs、env QA_PROFILE=1 QA_MODES=coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjs。全107ファイル・1107テストと型・lint・整形・justfile・Actions・SHA pin・OKF検査PASS、本番ビルド1.52秒。[^tests]

[^code]: 専用の2構成と、ロード画面・実タイルへの組み込み。

[^tests]: 保持・非同期待機・破棄・再試行と既存のロード回帰検査。

[^installed]: lockfileで固定した実Three.jsのキャッシュ実装。

[^baseline]: 実タイルで同じキャッシュキーが生成された前段計測。

[^parity]: 最終24条件の画素・同期生成・中断・破棄検査。

[^normal]: 最終の診断ラッパーなしの8場面。

[^profile]: 最終の時計対応付きProfilerとbuild記録。

[^logs]: 最終2traceを端末で検査した構造化ログ。

[^previous]: 前段で確認した非同期生成・GCとキャッシュの寿命。
