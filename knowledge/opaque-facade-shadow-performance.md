---
type: Metric
title: 不透明な外壁の影アルファを定数にする
description: 常にalpha=1の外壁が影で色のTSLグラフを生成していた。影の生成CPUは夜rooms・8棟で33.0→1.0ms。両backend・全窓設定・昼夜の新規画像が全画素一致。実ワープの100〜117msは残る。
tags: [rendering, plateau, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T23:46:00Z }
verified:
  - { by: process:chrome154-fresh-pose-parity-12-conditions, at: 2026-10-05T23:41:00Z }
  - { by: process:vitest-18-facade-shadow-tests-and-typecheck, at: 2026-10-05T23:43:00Z }
  - { by: process:chrome154-clock-mapped-streaming-profile, at: 2026-10-05T23:38:00Z }
  - { by: process:chrome154-nonprofiled-night-rain-warps, at: 2026-10-05T23:45:00Z }
  - { by: process:977-tests-typecheck-lint-format-build-just-actions-knowledge, at: 2026-10-05T23:48:00Z }
sources:
  - id: code
    resource: ../src/world/facade.ts, ../src/render/stableShadow.ts
    title: 影の材質での不透明アルファと従来の通常描画
  - id: three
    resource: ../node_modules/three/src/renderers/common/Renderer.js, ../node_modules/three/src/nodes/lighting/ShadowBaseNode.js, ../node_modules/three/src/nodes/tsl/TSLCore.js
    title: Three 0.186.1の色アルファ取得・影のフラグ・Fnのbuilder引数
  - id: parity
    resource: ../scripts/qa/facade-shadow-parity.html, ../scripts/qa/facade-shadow-parity.mjs, ../.qa/perf/2026-10-05T23-40-21-763Z-facade-shadow/report.json
    title: 全設定と両backendの新規姿勢の全画素比較・影生成CPU（JSONはローカル保存）
  - id: initial
    resource: 本セッションの初回検証CLI stderr、2026-10-05T23:39Z（JSON保存前の失敗を実行結果から記録）
    title: 移動直後の画像差で最初の比較が失敗した記録（CLI出力から記録、JSON保存前）
  - id: before
    resource: ../.qa/perf/2026-10-05T23-23-37-205Z-streaming/frame-stacks.json
    title: 水域Worker後にも残っていた影の同期生成（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-05T23-35-56-002Z-streaming/report.json, ../.qa/perf/2026-10-05T23-35-56-002Z-streaming/frame-stacks.json
    title: 定数アルファ後のワープと次のCPU占有処理（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-05T23-43-30-658Z-streaming/report.json
    title: Profilerなしの新地域と連続ワープ（ローカル保存）
  - id: tests
    resource: ../tests/facade.test.ts, ../tests/stableShadow.test.ts
    title: 外壁の点灯・ハッシュと影材質の所有権・変更・破棄・API動作の回帰テスト
  - id: previous
    resource: water-mask-performance.md, shadow-cache-performance.md
    title: 残る停止と以前も観測した同じタスク内の影更新差
---

# 同期生成の理由と変更

水域マスクをWorkerへ移した後の連続ワープの長い区間には、影の描画約70.3ms、その中に重複するシェーダー生成約58.3msがあった。Threeはsource materialにcolorNodeがあると、その.aを使って影のalphaを組み立てる。外壁のsurface関数はcolourを計算してからvec4(colour, 1)を返すため、影のalphaが常に1でも、窓の点灯・濡れ・テクスチャ・微分を含む色のFnをビルドしていた。[^before] [^code] [^three]

TSLのFnに渡されるbuilder.materialがisShadowPassMaterialの場合に限り、vec4(0, 0, 0, 1)を直接返す。通常の外壁・窓・部屋・雨の関数はそのまま。Threeの標準影材質と既存のStableShadowNodeはともにこのフラグを設定する。Threeの非公開メソッドを差し替えず、既存の影材質が持つフラグを参照する。0.186.1で実装と実描画を照合した。将来フラグが変われば定数化されず従来の計算へ戻るので、更新時は計測も繰り返す。[^code] [^three] [^parity]

# 影と外壁の比較

320×320・RGBA、8種類の外壁を持つ8棟、影を受ける地面、PCF・512pxの太陽影、固定カメラ・時計。WebGPUと強制WebGL2、flat/lit/rooms、昼晴れ/夜雨の12条件を実際のbackendの識別子で確認した。参照はViteが配信した外壁モジュールから新しい定数アルファのブロックだけを取り除いて作った。builder引数も元のFn(() => ...)へ戻し、他の関数・ノード・テクスチャは同じ。参照のテクスチャと時計も揃え、各画像は同じ2回の描画・読取りで準備する。[^parity]

**新規シーンでの初期位置と移動先**の24画像は全9830400値が完全一致。影を消したときの変化は約16000値以上、棟を移動した変化は約10000値以上で、背景だけを比較していないことを確認した。[^parity]

| backend | 窓    | 8棟の影build CPU（夜、旧→新） | fragmentの文字数（1棟、旧→新） |
| ------- | ----- | ----------------------------: | -----------------------------: |
| WebGPU  | flat  |                    14.1→1.4ms |                       6941→855 |
| WebGPU  | lit   |                    30.0→1.4ms |                      20402→855 |
| WebGPU  | rooms |                    33.0→1.0ms |                      20402→855 |
| WebGL2  | flat  |                    12.3→2.2ms |                      6278→1118 |
| WebGL2  | lit   |                    29.9→1.7ms |                     17904→1118 |
| WebGL2  | rooms |                    30.5→1.4ms |                     17904→1118 |

CPUはrenderer.debug.onNodeBuilderCreatedで実際の同期buildを囲んだ値。参照→新の順の部品比較で、全ゲームのCPUやGPU時間の改善率ではない。8棟すべてを異なるsource materialで描き、どの条件も実際に8回の影buildがあった。[^parity]

## 移動直後の更新差は未解決

初回はWebGPU・flat・夜で初期画像が一致し、同じシーンの棟を動かした後に1397値・最大24の差が出たため失敗した。新規の移動先の参照を追加して原因を分けた。旧処理の移動直後→旧処理の新規姿勢、新処理の移動直後→新処理の新規姿勢にも差がある（同条件で双方1397値・最大24）。旧/新それぞれの新規姿勢は全画素一致した。[^initial] [^parity]

このfixtureはrAFでゲームを進めず、renderとGPUの読取り待ちを続ける。WebGPUの更新差は多くの条件で旧/新とも同じ値だが、rooms・昼では旧に1533値の差、新は0だった。一度の観測から原因や修正を断定しない。WebGL2の全条件はどちらも更新差0。以前の影材質の比較にも同様の差があり、今回、移動直後の影更新を直したとは主張しない。新規姿勢でのshader出力の同一性と、毎フレームの影更新の正しさは分けて扱う。[^parity] [^previous]

# 実ゲームで残る停止

M2 Max、Chrome154、WebGPU・ultra、1280×800・DPR1、夜雨、seed20261006、東京駅で30秒待つ従来のワープ計測。Profilerありでは新地域133.3ms、連続ワープ100.1ms。エラー0、最新ワープが最終原点であることと道路更新完了を確認。連続ワープの最長区間では影描画約4.5ms・シェーダー生成約1.5msになり、FeatureTableコンストラクタ(Q$1)約31.1ms・TextDecoder.decode約25.6msが目立った。新地域の最長区間には通常側のシェーダー生成約73.8msが残る。これらは区間内のサンプルによる推定・包含分類で、場面をまたぐ改善率を表さない。[^profile]

Profilerなしの再計測は新地域116.6ms（50ms超19回）、連続ワープ99.9ms（同19回）。両方のruntime errorは0。影の生成費用は減ったが、新地域の最長値は変わらず、停止の完全修正とはしない。次は建物タイルの属性表の展開・外壁の準備と、通常側の初回シェーダー生成を調べる。[^normal] [^profile]

このProfilerなしの起動では、端末に保存された137行のログにAMEdASと潮位表の外部取得失敗の警告が各1件あった。開始時の警告で、スクリプトのruntime error検査はこれらを含まない。すべての警告が0件だったとは扱わない。参照と新処理の画像比較は固定の昼/夜・濡れ・時計・テクスチャを使い、これらの外部取得を使わない。[^normal] [^parity]

再現はjust measure-facade-shadows。実ゲームはQA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streaming。結果をprofile-frame-stalls.mjsで時刻対応付きで集計する。計測中に編集・ビルド・テストをしない。[^parity] [^profile]

[^code]: 不透明な影アルファと外壁の実装。

[^three]: インストール済みThree 0.186.1のコード。

[^parity]: 実際の両backendでの全画素比較とbuildのCPU。

[^initial]: 最初に失敗した移動直後の比較のCLI出力。

[^before]: 水域Worker後の同期生成のCPU。

[^profile]: 影アルファ定数化後のCPUプロファイルと対応するフレーム。

[^normal]: Profilerなしの実ゲームの計測。

[^tests]: 点灯と影材質の既存回帰テスト。

[^previous]: 先行の計測と影更新差の記録。
