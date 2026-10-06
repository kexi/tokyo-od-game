---
type: Metric
title: 歩行者の部品コピーと傘・アニメーションの割り当てを減らす
description: 実GLBの生成CPU95.3→53.1ms、歩行更新73.0→64.4ms。温めた1人のgeometry/material生成18/16→0/0。4967616数値と両backend昼夜の18874368画素byteが一致。夜雨の50.1msとLoAF51.7msは残る
tags: [rendering, testing, logging, assets]
status: draft
generated: { by: codex, at: 2026-10-06T13:05:18Z }
verified:
  - {
      by: process:1159-tests-types-lint-format-just-actions-knowledge-and-production-build,
      at: 2026-10-06T13:05:18Z,
    }
  - {
      by: process:four-human-independent-state-morph-subclass-and-shared-disposal-tests-and-types,
      at: 2026-10-06T12:56:45Z,
    }
  - {
      by: process:chrome154-real-glb-alternating-cpu-resource-ids-4967616-values-48-images-and-six-hashes,
      at: 2026-10-06T12:55:30Z,
    }
  - { by: process:chrome154-final-eight-night-rain-scenes-57-hashes-logs-and-image, at: 2026-10-06T12:59:30Z }
  - {
      by: process:chrome154-before-loop-change-two-warps-direct-spawns-clock-mapped-stacks-and-logs,
      at: 2026-10-06T12:51:43Z,
    }
sources:
  - id: code
    resource: ../src/world/human.ts, ../src/world/humanParts.ts
    title: 共有形状を渡してコピーする部品、共有傘geometry、tupleを作らない歩行ループ
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/8c76a385ea81a65cf96e12c0572092353a2bbe32/src/world/human.ts
    title: 比較対象PR32の固定HEADの旧human実装
  - id: tests
    resource: ../tests/human.test.ts, ../tests/humanParts.test.ts
    title: 独立した姿勢・userData・morph、特殊Meshのclone、共有geometryの破棄を防ぐ検証
  - id: baseline
    resource: ../.qa/perf/2026-10-06T12-37-12-420Z-streaming/report.json
    title: 変更前の実ワープでPedestrians.spawn/fillを直接測ったJSON（ローカル保存）
  - id: comparison
    resource: ../scripts/qa/perf-human-models.mjs, ../scripts/qa/human-model-parity.html, ../.qa/perf/2026-10-06T12-54-11-884Z-human-models/report.json
    title: 最終コードの実GLB・CPU・constructor数・行列/頂点/材質・全画素比較（ローカル保存）
  - id: initial
    resource: ../.qa/perf/2026-10-06T12-44-21-119Z-human-models/report.json, ../.qa/perf/2026-10-06T12-46-23-342Z-streaming/report.json
    title: ループ変更前の生成比較と夜雨8場面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T12-49-10-200Z-streaming/report.json, ../.qa/perf/2026-10-06T12-49-10-200Z-streaming/frame-stacks.json
    title: ループ変更前の直接spawn/fillとCDP時計対応付きCPU診断（ローカル保存）
  - id: live
    resource: ../scripts/qa/perf-road-streaming.mjs, ../.qa/perf/2026-10-06T12-56-47-542Z-streaming/report.json, ../.qa/perf/2026-10-06T12-56-47-542Z-streaming/night-rain.png
    title: 最終コードの診断ラッパーなし夜雨8場面と目視した車内・傘・Yの画面（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/565ec59c-b62c-4508-a100-34e4ce294f77.jsonl, ../.qa/logs/2026-10-06/fe919114-aaf3-430e-b84d-3f66c553c96c.jsonl
    title: 最終通常計測とループ変更前診断のtrace限定端末JSONL（ローカル保存）
  - id: three
    resource: ../node_modules/three/src/core/Object3D.js, ../node_modules/three/src/objects/Mesh.js
    title: Three 0.186.1のcloneは空のMeshを作り、copyはgeometry/materialを共有する
  - id: previous
    resource: vector-tile-worker-performance.md, uniform-upload-measurements.md
    title: GC・GPU転送・影・反映の重なりと効果が小さかった転送案
---

# 部品を共有していても、コピー先の既定資源を作っていた

human.glbの部品は剛体のMeshとGroupで、手足はpivotを持つGroupを動かしている。旧Object3D.cloneはnew this.constructor().copyで、通常のMeshは空のBufferGeometryとMeshBasicMaterialを作ってから元のgeometry/materialで上書きする。実GLBの1人には16個の部品Meshがあり、この既定資源は利用されない。傘のConeGeometryとCylinderGeometryも人ごとに同じ頂点を作っていた。[^code] [^three] [^comparison]

通常のMeshだけは元のgeometry/materialをコンストラクタに渡し、copy(source, false)の後に子を同じ順序でコピーする。Groupや特殊なMeshは元のclone(false)を使い、専用クラスを失わない。コピーの姿勢・morph・userDataは各人物で独立、形状と材質の共有は元の契約どおり。傘の形状はmoduleで2個だけ用意し、各人物の傘Meshにsharedを付ける。disposeHumanは共有資源を壊さず、人物だけが所有する添付物を解放する。人数・見える範囲・影・物理・画質は変更しない。[^code] [^tests]

毎フレームのanimateHumanは2本の脚のtuple配列とiteratorを作るループを整数ループへ変更する。位相は0とMath.PI、歩行・走行・傘の式は同じ。実際のVMの全割り当て数を計測したわけではないので、配列記述を除いたことだけからGCの削減率は出さない。[^code] [^comparison]

# 直接計測と同じ旧ソースとの比較

変更前の実夜雨ワープではspawnはcoldWarp 63人・CPU10.6ms・最大2.1ms、latestWarp 33人・CPU5.3ms・最大0.4ms。fillは最大2.7 / 0.9msで、spawnと入れ子なので合計を足さない。古いBufferGeometryのCPUサンプルを関数の実時間と扱わず、生成を直接測った。[^baseline] [^previous]

M2 Max、Native Chrome154 / Metal。固定PR32の旧humanソースを別moduleへ取り出し、旧・新それぞれ実GLBを読み込む。12種類の色・身長・髪を128人分ずつ温め、旧→新→新→旧→新→旧→旧→新で64人×4バッチを各期間生成する。1方式1024人、CPUはバッチ全体の生成で、disposeとGPU描画を含まない。[^reference] [^comparison]

| 比較対象           | 旧CPU合計 | 新CPU合計 |      差 |
| ------------------ | --------: | --------: | ------: |
| 1024人の生成       |    95.3ms |    53.1ms | 約44%減 |
| 102400回の歩行更新 |    73.0ms |    64.4ms | 約12%減 |

64人の生成の最大バッチは7.1→3.9ms、6400歩行更新の最大バッチは5.1→4.9ms。歩行は同じ64人物の状態を使い、100更新ずつ4バッチ、同じ交互順序で比べた。ゲーム全体のCPUやGCがこの割合で減るという意味ではない。[^comparison]

色の材質cacheを温めた1人の実constructor数はgeometry18→0、material16→0。CPU計測の外でThreeの資源IDの前後差を取るので、捨てられる既定資源も数える。同じ同期呼出し中に他のJSが割り込まない条件での数で、新しい色の初回材質生成は元どおり発生する。[^comparison]

最初のループ変更前比較でも生成94.1→51.1ms（約46%減）、constructor数は同じだった。その版の夜雨8場面にはlatestWarp 50.1ms・LoAF50.0msが残っていた。最初の結果を最終コードの証拠と取り違えない。[^initial]

# 実モデル・姿勢・画素・破棄の同値性

旧・新の12人物を6姿勢で動かし、sceneの階層・名前・可視性・影・行列・頂点・index・属性構成・材質値の4967616値をObject.isで比較し、全部一致した。身長と3種の髪、停止・歩行・傘の見え方を含む。数値比較は両backend・昼夜で繰り返し、単一の描画回数の値ではない。[^comparison]

WebGPUとWebGL2の昼夜・6姿勢・2カメラ、48画像のHDR12582912byte＋RGBA6291456byte、計18874368byteが全部一致した。実際に姿勢を変えた画像が変化することも確認し、空の画像同士の一致を成功としない。影の比較は各描画の前に実rAFを待つ。geometry、材質、アニメーションの描画は省略しない。実GLBを含む6ソースhashは計測中不変だった。[^comparison]

unitのGLTFLoaderは最小の部品を返すmockで、実GLBの証拠に使わない。4テストは共有形状のまま各人物の姿勢・morph・userDataを独立に動かせること、特殊Meshの専用cloneを使うこと、1人を捨てても他人の傘geometryを解放せず、所有する添付物だけ解放することを保証する。実GLBは上のNative比較で確認した。[^tests] [^comparison]

# 停止は完全には解消していない

最終コードの診断なし夜雨8場面のrAF最大は33.5 / 33.4 / 33.5 / 33.4 / 33.4 / 33.4 / **50.1** / **50.0ms**。coldWarpは50ms超1回、他は0回、errorsはすべて空。latestWarpのLoAFは**51.7ms**・blockingMs 0で、tick 19.1ms、建物配信のResponse.arrayBuffer.then 7.4ms、道路Worker.onmessage 6.9msが同じframeにある。rAFとLoAFは異なる区間なので大小を入れ替えない。57実行ソースhashは全不変、trace565ec59c…の端末ログ3819行は全部info。夜雨の車内・濡れた街・傘・自然なYの画面を目視した。[^live] [^logs]

ループ変更前の別起動では、診断付きcoldWarpのspawn62人・CPU5.0ms・最大0.2ms、fill最大0.5ms。latestWarpは37人・CPU10.1ms・spawn最大**7.7ms**、fill最大8.1msで、大きな時間が消えたわけではない。7.7msの直接区間とCDPのsampleを時計対応させるとGCの推定約6.085msが重なる。これはGC sampleの推定であり、生成の純粋なCPUやGCの総量ではない。[^profile]

この診断のrAF最大50.1 / 50.0ms、LoAF両方0件。CDP mapped33480.631msはpage.before33480.0〜after33500.2msに入り、時計対応を確認した。計測時の57hash不変、tracefe919114…3265行は全部info。影描画・行列更新・地面照会・GC・応答の重なりが残るので、部品のCPU短縮から停止の完全修正を宣言しない。[^profile] [^logs]

再現はjust measure-human-models。旧referenceソースは固定commitから生成し、計測後に削除する。通常夜雨はQA_TIMING_ONLY=1 just measure-road-streaming、直接生成診断はQA_PEDESTRIANS=1 QA_MODES=coldWarp,latestWarpを加える。CPU診断を加えた起動のフレーム値を診断なしの値と同列に速度比較しない。計測中にソース編集・テスト・build・別のNative GPU計測をしない。[^comparison] [^live] [^profile]

[^code]: sharedはgeometryの所有権を表し、人物Meshと姿勢を共有するものではない。

[^reference]: 旧関数の書き直しを比較対象にしない。

[^tests]: mockの成功と実GLB・実GPUの成功を分けて記録する。

[^baseline]: メソッドを囲った直接計測は診断ラッパーの負荷も含む。

[^comparison]: 生の全バッチ、資源counter、数値数、画像byte数とソースsnapshotをローカル保存する。

[^initial]: 初回の版には整数の歩行ループをまだ含めない。

[^profile]: sampling intervalの大きな値を単一関数の直接時間としない。

[^live]: 通常・再反映・原点変更・新地域・連続ワープを実際の描画まで計測する。

[^logs]: ブラウザコンソールではなくtrace限定の端末JSONLを読む。

[^three]: 特殊なMeshの専用cloneを通常のMeshへ置き換えない。

[^previous]: uniform転送をまとめる案は本番に入れていない。
