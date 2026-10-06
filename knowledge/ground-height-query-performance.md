---
type: Metric
title: 地形の高さ照会のタイル検索と一時Vector3を減らす
description: 実道路・DEM2地域の42411比較が完全一致。最終24回のDEM照会CPU19.9→11.7ms・34.2→18.9ms、橋を含む地面照会70.4→63.9ms・126.6→110.5ms。通常約33ms、両ワープの50.1・66.6msは残る。
tags: [terrain, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T08:20:00Z }
verified:
  - {
      by: process:chrome154-final-two-real-regions-42411-values-source-hashes-and-terminal-logs,
      at: 2026-10-06T08:23:32Z,
    }
  - { by: process:1111-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T08:12:00Z }
  - {
      by: process:chrome154-two-real-regions-42411-values-alternating-cpu-and-terminal-logs,
      at: 2026-10-06T08:13:30Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T08:16:11Z,
    }
  - { by: process:clock-mapped-warp-profiler-source-hashes-and-terminal-logs, at: 2026-10-06T08:18:17Z }
sources:
  - id: code
    resource: ../src/world/dem.ts, ../src/geo/frame.ts, ../src/main.ts
    title: タイル内の4画素を1回の検索で読み、同期の照会用Vector3を再利用する
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/a0f4fb0f9454c01010d9e9360fe67daef7f9cf3d
    title: 比較に固定した前段のコード
  - id: component
    resource: ../scripts/qa/perf-ground-queries.mjs, ../.qa/perf/2026-10-06T08-22-23-130Z-ground-queries/report.json, ../.qa/perf/2026-10-06T08-12-23-044Z-ground-queries/report.json
    title: 実道路点・実DEMの境界・橋と24回の交互CPU比較（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T08-14-00-828Z-streaming/report.json, ../.qa/perf/2026-10-06T08-14-00-828Z-streaming/night-rain.png
    title: 最終の診断ラッパーなしの8場面と目視した夜雨の画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T08-16-40-674Z-streaming/report.json, ../.qa/perf/2026-10-06T08-16-40-674Z-streaming/frame-stacks.json
    title: 最終の時計対応付き両ワープのCPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/3a1fd2a1-d721-4372-a07f-973586792297.jsonl, ../.qa/logs/2026-10-06/5f2a3d3b-e8f8-45e3-be49-c0a71fd81522.jsonl, ../.qa/logs/2026-10-06/bc9b4f71-3fb4-4149-9cdd-ea183fefddb9.jsonl, ../.qa/logs/2026-10-06/a77bc481-3e8a-44b6-a6b7-25e551c870f7.jsonl
    title: 4計測のtraceで限定した端末ログ（ローカル保存）
  - id: tests
    resource: ../tests/demSampling.test.ts, ../tests/geo.test.ts, ../tests/terrainWorker.test.ts
    title: 補間・境界・未読込と到着・負座標・NaN・返却値と入力の保持・既存の地形
  - id: previous
    resource: facade-shader-layout-performance.md, terrain-and-geoid.md, road-worker-reply-performance.md
    title: 外壁生成を除いた後の地形照会、標高と座標の契約、道路返答の内訳
---

# 残った照会と変更

前段の50.1ms区間には、歩道の高さ補正からのtoGeodetic self約4.5ms、水域の高さ照会からのsampleGlobal self約3.0ms・surveyedAt self約2.8msがあった。別区間には道路Worker返答・影描画も残っており、地形だけを停止の原因と断定しない。[^previous]

sampleGlobalは補間の4画素それぞれで文字列キーとMap照会を作っていた。4画素が同じタイル内なら、1回のMap検索で配列から読む。タイルをまたぐ東端・南端・角は従来のpixel経路を使う。floor、負座標の剰余、4画素の補間式と演算順、欠損タイルの0、heightAtの未読込nullを保つ。結果やタイルをキャッシュしないので、後から届いたタイルも即座に反映される。[^code] [^tests]

LocalFrame.toGeodeticは専用のVector3へ入力をcopyしてから従来のapplyMatrix4とECEFの反復計算を使う。mainのgroundYも入力とtoLocalの出力に専用のVector3を再利用する。同期の計算だけで使い、入力ベクトルや以前の返却値は変更しない。橋は先にdeckAtを返すまま。緯度経度の近似や丸め、高さのキャッシュは導入していない。[^code] [^tests]

# 固定した旧処理と実データで比較

M2 Max・Native Chrome154.0.8037.97 / revision b510e9d7cd3a2fbd78d0ddc42234103206c5f78d・Metal WebGPU・ultra・rooms・1280×800・DPR1・夜雨・seed20261006。a0f4fb0のDemStoreとLocalFrameを保存し、旧DEMはゲームと同じloaded Mapとジオイドを読む。変更前のgroundYの橋優先・未読込null・座標変換を比較用に組み立てる。旧toLocalは変更していない。[^reference] [^component]

東京駅の道路2929点・DEM64タイルと、実ワープ後の吾妻橋5318点・DEM108タイルを使う。道路点からのDEM座標に加え、読み込み済みタイルの内部・東端・南端・角を照会する。各lat/lon/h・補間値・地面高と繰り返しのchecksumをObject.isで比較し、**42411比較が完全一致**した。橋16点・20点も一致。実道路点に未読込nullは無かったため、その契約は単体テストで別に検査した。4ソースの保存ハッシュが最終版と一致した。[^component] [^tests]

各処理4回を温め、24回ずつ順番を交互に測る。各組の間に実フレームを挟み、計測中には編集・テスト・ビルドをしない。比較と待機の時間はCPU値に含めない。ゲームのframe・graphが変わっていないことも確認した。[^component]

| 24回の照会CPU合計  | 東京駅・旧 | 東京駅・変更後 | 吾妻橋・旧 | 吾妻橋・変更後 |
| ------------------ | ---------: | -------------: | ---------: | -------------: |
| DEM補間            |     19.9ms |         11.7ms |     34.2ms |         18.9ms |
| 緯度経度への変換   |     37.9ms |         38.9ms |     68.0ms |         70.1ms |
| 橋を含む地面の高さ |     70.4ms |         63.9ms |    126.6ms |        110.5ms |

最終のDEM補間CPUは約41%・45%、地面高の照会は約9%・13%減った。座標変換単体のCPUは最終では約3%増え、最初の起動では37.9→37.6ms・68.2→68.4msだった。Vector3再利用の速度向上をこの結果からは主張しない。Vector3の作成はコード上減るが、heap割当量は計測していない。全ゲームの改善率とは読み替えない。最初の起動でも42411比較が一致し、DEMは18.6→10.1ms・32.8→18.9ms、地面高は68.8→60.0ms・122.7→107.0msだった。規約に合わせて比較用の条件式へ名前を付けた後の起動が上の最終表で、runtimeは変更していない。[^component] [^logs]

最初の端末2221行と最終の端末2243行は全てinfo、対象失敗0件。ブラウザには両起動とも既存のTilesRendererのversion1.1サポート警告が4件ある。[^component] [^logs]

# 全ゲームは未解決

診断ラッパーとProfilerを外した最終8場面。rAF・LoAF・構造化ログは残るため、診断のコストが完全に0とはしない。39ソースの保存ハッシュが一致した。[^normal]

| 場面       | 最長rAF間隔 | 50ms超 |
| ---------- | ----------: | -----: |
| 通常1      |      33.4ms |    0回 |
| 更新1      |      33.4ms |    0回 |
| 通常2      |      33.4ms |    0回 |
| 更新2      |      33.4ms |    0回 |
| 更新3      |      33.5ms |    0回 |
| 原点変更   |      33.4ms |    0回 |
| 未読込地域 |      50.1ms |    3回 |
| 連続ワープ |      66.6ms |    3回 |

未読込地域の完了24.6秒・道路反映9.19秒、連続ワープの完了16.2秒・反映3.03秒。道路125メッシュ・駐車16台の再利用、原点変更中の旧フレーム保持、連続ワープの最後の地点への着地が通った。夜雨の画面を目視した。端末3647行のうちinfo3646・warn1。warnはtide_table_failed（外部潮汐表のfetch失敗）で、対象Worker・道路・地形・未捕捉例外の失敗は0。[^normal] [^logs]

別起動の時計対応付きProfilerは未読込地域50.0ms・50ms超0、連続66.7ms・同4。before35485.4ms ≤ mapped35485.969ms ≤ after35503.5ms。連続の最長区間はshaderBuild0ms、GC self11.805ms、影包含4.542ms、createBindings self3.271ms、heightAt self3.038ms、writeBuffer self2.980msが載った。別の50.1msには道路Worker返答self7.095msやECEF変換もある。包含群をCPU合計として足さない。通常計測の連続ワープのLoAF52.6msはtick22.6msとWorker返答10.1msを含むが、両値がフレーム全体の時間という意味ではない。[^normal] [^profile]

最終Profilerも39ソースが一致。端末3236行は全てinfo、対象失敗0件。両ワープの外壁の同期・非同期生成はともに0回を維持した。通常材質の同期生成は未読込地域Body_6に13.9ms、連続に9.1msが別区間で残る。[^profile] [^logs]

前段の別起動では両ワープ50.1/50.1msだった。今回の50.1/66.6msを、全体のフレーム改善と主張しない。起動・ロード・GC・実行の重なりが異なる。地形照会の部品CPUは削れたが、停止の完全修正は未達成。次は返答と道路反映の同タスク内の重なり、GC・描画資源の準備を調べる。[^previous] [^normal] [^profile]

全108ファイル・1111テスト、型・lint・整形・justfile・Actions・SHA pin・ナレッジ検査PASS、本番ビルド2.09秒。最初のローカル検査はHTTPログ検査のlisten EPERMで失敗し、localhost待受けを許可した最終実行で成功した。再現はjust measure-ground-queries、env QA_TIMING_ONLY=1 node scripts/qa/perf-road-streaming.mjs、env QA_PROFILE=1 QA_MODES=coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjs。[^tests]

[^code]: 同じ補間・座標変換と橋優先を保った照会処理。

[^reference]: 保存した旧処理のcommit固定。

[^component]: 実道路点・実DEM境界・橋と交互のCPU比較。

[^normal]: 最終の診断ラッパーなしの8場面。

[^profile]: 最終の時計対応付きCPUとbuild記録。

[^logs]: 4traceの端末JSONLを検査した結果。

[^tests]: 境界・到着・欠損・NaN・所有権と既存地形の回帰検査。

[^previous]: 前段の実フレームと地形の標高・座標の契約。
