---
type: Reference
title: "不透明な外壁の影で、色の段を組み立てない（性能 PR #9 の作り直し）"
description: "近景の建物の影のシェーダーを作るとき、three は外壁の colorNode を影の材質に写して alpha を読み、窓の点灯・雨・テクスチャ・微分まで組み立てていた。外壁の alpha は常に 1 なので、影のパスでは surface() が vec4(0, 0, 0, 1) を返す。main で測り直した値は、8 棟の影の組み立ての CPU が 13〜38 → 1.2〜3.3 ms（12 条件 × 2 描画方式、全組で同じ向き）、fragment の長さが 6,941〜20,402 → 855 字（WebGPU）。WebGPU と WebGL2 の 24 画像の 409,600 値ずつが旧処理と一致。ワープの帰属では、影のパスのノードの組み立ての 1 フレームの最大が 432〜470 → 50〜95 ms、最長フレームが 583 / 633 → 350 / 200 ms（別の走り 1 本ずつ）。10 月の旧 PR #9 の数値は引き継がない。"
tags: [rendering, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-28T14:40:00Z }
verified:
  - { by: process:vitest, at: 2026-11-28T14:40:00Z }
  - { by: process:headless-chrome, at: 2026-11-28T13:45:00Z }
sources:
  - id: parity
    resource: "scripts/qa/facade-shadow-parity.mjs（just measure-facade-shadows）を、この枝の作業木（main 9a69baf + この変更、未コミット）の開発サーバーで 1 本（2026-11-28 13:40〜13:41Z、鍵あり）。8 棟の固定の場面で、旧処理（配信された facade.ts から影の分岐を抜いた写し）と新しい処理を、WebGPU・WebGL2 × 窓 flat・lit・rooms × 昼夜の 12 条件で 1 組ずつ描き、影の材質の組み立ての時間と fragment の長さを数え、画素を比べた。結果は作業木の .qa/perf/2026-11-28T13-40-59-300Z-facade-shadow/report.json"
    title: 一致と組み立ての CPU
    author: claude-opus-5-5/1m
  - id: warp
    resource: "scripts/qa/frame-attribution.ts（just measure-frame-attribution）を、この枝の開発サーバー（p9-attr-branch、2026-11-28 13:43〜13:45Z）と main f724a2c（p0-attr-3、同日、perf-baseline.md）で 1 本ずつ。夜雨の新地域ワープと連続ワープ"
    title: ワープの帰属
    author: claude-opus-5-5/1m
  - id: tests
    resource: tests/facadeShadow.test.ts（three の影の材質が isShadowPassMaterial を持つこと、外壁の影の alpha が colorNode だけから来ること＝map も castShadowNode も無いこと）
    title: three の更新で黙って外れないためのテスト
    author: claude-opus-5-5/1m
---

# 何を変えたか

three r186 は影のパスで、外壁の材質の `colorNode` の alpha を影の材質に写す（`Renderer._getShadowNodes` の `hasColorNode`）。外壁の `colorNode` は `surface()` の `Fn` で、窓の点灯・部屋の奥行き・雨・テクスチャ・微分を組み立てるので、alpha を読むだけのために影のシェーダーにそれが全部入っていた。perf-baseline.md の帰属で、最長の 466〜633 ms のフレームの約 400 ms がこの影のパスの組み立てで、中に外壁の TSL（`lampColour`・`hash12`）が出ていた。

`src/world/facade.ts` の `surface()` は、組み立てている材質が three の影の材質（`isShadowPassMaterial`）なら、すぐ `vec4(0, 0, 0, 1)` を返す。外壁の alpha は常に 1 なので、影は同じになる。[^tests]

採らなかった方法:

- `material.castShadowNode`: three は castShadowNode があっても影の alpha に `colorNode.a` を掛けるので色の段は組み立てられる。さらに `shadowMap.transmitted` が無いと警告を出す。
- 影用の材質を別に持つ: 影のパスの材質は three がライトごとに 1 つ選び、こちらの材質からノードを写す。差し替える口が無い。

# 計測

## 8 棟の影の組み立て（just measure-facade-shadows、1 本）

旧処理（A）と新しい処理（B）を条件ごとに続けて描いた。値は 8 棟の影の材質を組み立てる CPU（ms）と、組み立てた fragment の長さ（字）。[^parity]

| 描画方式 | 窓    | 昼 A → B   | 夜 A → B   | fragment A → B |
| -------- | ----- | ---------- | ---------- | -------------- |
| WebGPU   | flat  | 21.1 → 1.8 | 13.3 → 1.5 | 6,941 → 855    |
| WebGPU   | lit   | 36.4 → 2.1 | 31.7 → 1.6 | 20,402 → 855   |
| WebGPU   | rooms | 34.5 → 1.2 | 37.3 → 1.8 | 20,402 → 855   |
| WebGL2   | flat  | 19.3 → 2.2 | 13.7 → 1.9 | 6,278 → 1,118  |
| WebGL2   | lit   | 38.0 → 3.3 | 37.3 → 1.9 | 17,904 → 1,118 |
| WebGL2   | rooms | 36.7 → 1.9 | 36.6 → 2.0 | 17,904 → 1,118 |

- 12 組とも B が小さく、差は 11.8〜35.5 ms（−86〜−97 %）。計画のマージ前の条件（20 % 以上、1 ms 以上、全往復で同じ向き）を満たす。単位は「ワープ 1 回」ではなく 8 棟の固定の場面で、交互の組はこちらで取った。
- 一致: 12 条件の、建物を動かす前に描いた画像と、動かした状態から描き始めた画像の 24 組で、409,600 の値が全部同じ（差 0）。影がある・無い、建物を動かす前・後で画素が変わることも確かめた（影の有無で 16,001〜16,925 値、動かして 100 値超）。

## ワープ（just measure-frame-attribution、枝と main を 1 本ずつ）

夜雨、新地域（coldWarp）と連続ワープ（latestWarp）。プロファイラあり。枝（main 9a69baf + この変更）と main（f724a2c）は別の走りで、main の版も違う（9a69baf → f724a2c の差は QA の道具と knowledge だけで、src は同じ）。[^warp]

|                                                                     | main 新地域   | 枝 新地域  | main 連続ワープ | 枝 連続ワープ |
| ------------------------------------------------------------------- | ------------- | ---------- | --------------- | ------------- |
| 最長フレーム                                                        | 583.3         | 349.9      | 633.3           | 200.0 ms      |
| ノードの組み立て（50 ms 超のフレームの中の合計 / 1 フレームの最大） | 1,794 / 432.5 | 863 / 95.0 | 1,274 / 470.0   | 382 / 49.6 ms |
| 影の描画の 1 フレームの最大                                         | 449.7         | 35.6       | 445.9           | 37.4 ms       |

- 1 回のワープの中のノードの組み立ては、新地域で −931 ms（−52 %）、連続ワープで −892 ms（−70 %）。最長フレームの約 400 ms の影の組み立てが消え、最長はそれぞれ 350 / 200 ms になった。
- 50 ms 超のフレームの数は、新地域で 280 → 422 と増えた。判定に使わない値（perf-baseline.md）で、1 本の中でも 2 倍ほど揺れる。この差が変更によるものかは、この 1 本ずつでは分からない。マージ後のバッチの取り直しで、最長と回数を見る。

# 確かめていないこと

- ワープの前後は 1 本ずつで、交互ではない。部品の条件は 8 棟の場面の 12 組で見た。
- 影の質（PCF の縁など）の主観の見え方。画素は 8 棟の場面で一致を見ただけで、ゲームの街並みでは撮っていない。
- 本物のスマホ（低の画質は建物の影が無いので効かない）。
