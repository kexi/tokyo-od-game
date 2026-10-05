---
type: Metric
title: 車内の複数の描画でシーン行列を再利用する
description: 車内・ワイパー・ミラーの連続描画でシーン全体の行列更新を約5回から1回へ減らす。夜雨のフレームCPU20.82→18.55 ms、昼晴れ17.20→15.79 ms。両backendで画素・行列が一致するが、新地域と連続ワープの150 msは残る。
tags: [rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T22:58:45Z }
verified:
  - { by: process:vitest-28-cockpit-regressions, at: 2026-10-05T22:33:38Z }
  - { by: process:chrome154-live-ab-and-pixel-matrix-parity, at: 2026-10-05T22:48:00Z }
  - { by: process:chrome154-webgl2-pixel-matrix-parity, at: 2026-10-05T22:49:57Z }
  - { by: process:chrome154-streaming, at: 2026-10-05T22:52:49Z }
  - { by: process:chrome154-violation-evidence, at: 2026-10-05T22:55:12Z }
  - { by: process:965-tests-typecheck-lint-format-build, at: 2026-10-05T22:58:45Z }
sources:
  - id: code
    resource: ../src/render/sceneMatrices.ts, ../src/game/cockpit.ts, ../tests/sceneMatrices.test.ts
    title: 同じ姿勢の連続描画だけを囲む行列更新と所有権の復元
  - id: three-source
    resource: ../node_modules/three/src/core/Object3D.js, ../node_modules/three/src/renderers/common/Renderer.js
    title: インストール済みThree 0.186.1の行列更新とrender時の判定
  - id: three-docs
    resource: https://threejs.org/docs/pages/Object3D.html
    title: 公開されている行列の更新・手動管理API
  - id: live
    resource: ../scripts/qa/perf-scene-matrices.mjs, ../.qa/perf/2026-10-05T22-43-13-032Z-matrices/report.json
    title: 夜雨・昼晴れの交互計測と全画素・行列比較（JSONはローカル保存・git管理外）
  - id: gl
    resource: ../.qa/perf/2026-10-05T22-48-28-058Z-matrices/report.json
    title: WebGL2を指定した実ゲームの夜雨・昼晴れの全画素・行列比較（ローカル保存）
  - id: streaming
    resource: ../.qa/perf/2026-10-05T22-50-14-615Z-streaming/report.json
    title: 通常更新・原点変更・新地域・連続ワープ（Profilerなし、ローカル保存）
  - id: evidence
    resource: ../.qa/perf/2026-10-05T22-54-15-913Z-matrices/report.json
    title: 写真・動画の投稿と証拠画像の完成、後続描画の検証（ローカル保存）
  - id: initial-comparison
    resource: ../.qa/perf/2026-10-05T22-37-16-152Z-matrices/report.json
    title: 最初の短い交互計測のCPU・フレーム値（ローカル保存）
  - id: initial-parity-stderr
    resource: Chrome154検証CLIのstderr、2026-10-05T22:37〜22:41Z（初回と時計固定後の画素差）
    title: 初期スクリプトではJSON保存前に失敗したため、CLI出力から記録した差
  - id: previous
    resource: road-nearest-performance.md
    title: 道路検索を絞った後にも残った描画のCPU負荷と停止
---

# 原因と変更

道路検索を絞った後のCPUプロファイルではシーンの`updateMatrixWorld`が大きいままだった。Threeのrenderは、scene.matrixWorldAutoUpdateがtrueならシーン全体を更新する。車内からはミラー、通常の街、ワイパー、車内を同じ姿勢のまま別のカメラ・レイヤで描き、影でも更新が走る。通常プレイの診断では車内の1描画につき平均4.67回の全体更新だった。[^previous] [^three-source] [^live]

`withSceneMatrices`で連続する同期描画を囲み、最初に全体を1回更新する。その間だけシーンの自動更新を止め、finallyで元の設定へ戻す。子オブジェクトの更新設定やカメラの更新は変更しない。次のフレームでは移動・ワイパー・新しい子・原点変更を再計算する。呼び出し側が既に手動管理していた場合は、その設定を維持する。公開APIのみを使い、追加依存は無い。[^code] [^three-docs]

フレーム全体をキャッシュしない。同じタスクの後半で目撃者の写真を描くときは、車や人物の姿勢が変わるからである。車外では従来の1描画のまま、車内の連続描画だけを対象にする。[^code]

# 通常プレイの交互計測

M2 Max、Headless Chrome154、WebGPU、ultra、1280×800・DPR1、seed20261006、東京駅で開始後30秒待つ。交通・雨・時計を動かした通常プレイ。親コミット11462bdと未コミットの行列変更を使い、旧Cockpit.renderを凍結した参照Aと現行BをA/B/B/A/B/A/A/Bの順で各8秒、各試行の前に2秒待って比較した。昼晴れ・夜雨は別の起動。[^live]

下記は描画回数で重みを付けた1フレームあたりのCPU平均。全体CPUはゲームのtick、車内CPUはCockpit.render、行列CPUはその中のシーン全体更新の時間であり、GPU時間ではない。[^live]

| 条件   |  全体CPU 旧→新 |  車内CPU 旧→新 | 行列CPU 旧→新 | 更新回数 旧→新 |
| ------ | -------------: | -------------: | ------------: | -------------: |
| 夜雨   | 20.82→18.55 ms | 15.00→12.81 ms |  2.84→0.74 ms |         4.67→1 |
| 昼晴れ | 17.20→15.79 ms | 12.82→11.13 ms |  2.48→0.68 ms |         4.67→1 |

夜雨は旧1,511/新1,691描画、昼晴れは旧1,813/新1,911描画。夜雨のp95フレーム間隔は旧33.4 ms、新33.3〜33.4 ms、どちらも最長33.5 ms。昼晴れは旧p95 33.3 ms、新16.7〜16.8 ms、最長50.0→33.4 ms。サンプル中の更新回数を毎回検査し、プレイ継続・同一session・例外0件も確認した。読み込み順やホスト負荷に依存するため、これをすべてのプレイでの改善率や上限にしない。[^live]

# 描画と後続処理の検証

WebGPUとWebGL2の実ゲームで夜雨・昼晴れを比較した。画素比較中だけゲームのtickとperformance.nowを固定し、ミラーの選択を固定、写真ターゲットを準備した後、各条件を2描画ずつ読み出した。409万6千のRGBA値が旧同士・旧新とも完全一致。全シーンのオブジェクトID・world matrixの全値も一致した。車体を35 cm、ワイパーを0.3 rad動かした後も一致し、画像は221万〜248万値変化した。雨粒ありと無しの両方を確認。両backendで例外0件。[^live] [^gl]

最初の比較には旧新で41/32値の1階調差が出た。時計を固定しても旧処理同士に12値の1階調差が残った。写真ターゲットも最初に1回読み出してから比較すると、旧同士も旧新も0差になった。差の原因は確定していないので、最初の写真読み出しの完全一致をこの結果から保証しない。初期スクリプトの失敗の差はCLI stderrから記録した。最終スクリプトは不一致でも結果をJSONへ保存する。[^initial-parity-stderr] [^live]

実時間の夜雨で信号違反を強制し、写真と動画の投稿を1件ずつ検証した。両方とも投稿のmediumと証拠画像の完成を確認。8秒の観測で最長33.5 ms、例外・道路/Worker失敗・スキーマエラー0件。その後の画素・行列比較も一致し、自動更新の設定が戻っていた。AI同時稼働、多数の同時撮影、事故については、この変更の計測としては未検証。[^evidence]

6回帰テストで、複数視点の現在の階層、次のフレームの姿勢・新規モデル・原点変更、同じタスクの後続撮影、手動管理、入れ子、描画例外時の所有権復元を確認。ミラー等も含む関連28テストが成功。[^code]

最終状態で92ファイル965テスト、型チェック、lint、整形、knowledge/justfile lint、production buildが成功。変更ファイルのlint警告は0件。既存ファイルのlint警告とbuildのbundleサイズ等の警告は残る。[^code]

# 残る停止

Profilerなしの別起動では通常時33.4 ms、道路更新50.0 ms、原点変更83.3 ms、新地域150.0 ms、連続ワープ150.0 msが最長だった。全操作で例外・道路/Worker失敗・ログスキーマ不一致0件。DEMの実Workerと参照のビット一致、描画・駐車車両の再利用、古いワープの不採用も維持した。sessionは0faa2178-7691-471a-a1cf-d06c24b8ea62、buildは11462bd+8d91a6。[^streaming]

**停止の完全解消は未達。** 親の検索改善時の新地域116.6 msより、この起動の最長150 msは長い。これらは同一sessionの交互比較ではなく、最長フレームの改善や回帰を単独で断定できない。確認できた効果は上の通常プレイのCPU削減であり、初回読み込み・GPU転送・材質構築等の上限は保証しない。[^previous] [^streaming]

# 再実行

`just serve-dev`で配信後、`just measure-scene-matrices`。`QA_BACKEND=webgl QA_PARITY_ONLY=1`でWebGL2の画素比較のみ、`QA_TIMES=night QA_PARITY_ONLY=1 QA_VIOLATIONS=1`で写真・動画の後続処理を確認する。`QA_SECONDS`で計測秒数を変更できる。ゲーム全体は`QA_MODES=baseline,update,recenter,coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjs`。計測中はHMR、編集、ビルド、テストを動かさない。[^live] [^streaming] [^evidence]

[^code]: 行列の再利用と同期描画後の所有権復元のテスト

[^three-source]: インストール済みThreeの行列更新とrendererの判定

[^three-docs]: ThreeのObject3Dの公開API

[^live]: 通常プレイの交互計測と厳密な画素・行列比較

[^gl]: WebGL2の実ゲームの描画比較

[^streaming]: Profilerなしの全操作計測

[^evidence]: 違反の写真・動画生成と後続描画

[^initial-comparison]: 初回の比較で出た1階調差と短い交互計測

[^initial-parity-stderr]: 最初の画素比較と時計固定後のCLI stderr

[^previous]: 道路検索の改善後の観測
