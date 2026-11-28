---
type: Reference
title: "車内の連続描画で、シーンの行列更新を 1 回にする（性能 PR #7 の作り直し）"
description: 車内視点の 1 フレームは、ミラー・通常の視界・車外のレイヤ・車内のレイヤ（とガラス）を同じ姿勢で続けて描き、three の renderer.render が描くたびにシーン全体の updateMatrixWorld を呼んでいた（1 フレーム約 4.7 回）。withSceneMatrices で、続けて描く前に 1 回だけ更新し、その間 matrixWorldAutoUpdate を止める（finally で戻す）。main 48dc699 で測り直した値は、行列の CPU が 1 フレーム 1.31〜1.63 → 0.36〜0.42 ms（夜雨）、1.44〜1.48 → 0.39〜0.41 ms（昼晴れ）、全 8 組で同じ向き。WebGPU と WebGL2、昼夜で 4,096,000 の画素の値とシーン全体の world matrix が旧処理と一致。10 月の旧 PR #7 の数値は引き継がない。
tags: [rendering, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-23T19:30:00Z }
verified:
  - { by: process:vitest, at: 2026-11-23T19:30:00Z }
  - { by: process:headless-chrome, at: 2026-11-23T19:19:00Z }
sources:
  - id: runs
    resource: scripts/qa/perf-scene-matrices.mjs（just measure-scene-matrices）を、この枝の作業木（main 48dc699 + この変更、未コミット）の開発サーバーで。1 本目 WebGPU（夜雨・昼晴れ、各 8 秒 × A B B A B A A B、その後に画素と行列の一致）、2 本目 WebGL2（QA_BACKEND=webgl、一致だけ）。鍵あり、1 本ずつ（2026-11-23 19:04〜19:08Z、19:17〜19:19Z）。結果は作業木の .qa/perf/2026-11-23T19-04-08-565Z-matrices/・2026-11-23T19-17-56-161Z-matrices/
    title: 交互の計測と一致
    author: claude-opus-5-5/1m
  - id: tests
    resource: tests/sceneMatrices.test.ts（行列の所有権、次のフレームの姿勢、原点変更、同じタスクの後の撮影、入れ子、描画の例外で戻ること）
    title: 単体テスト
    author: claude-opus-5-5/1m
  - id: baseline
    resource: knowledge/perf-baseline.md（Phase 0、#134）。新地域の 50 ms 超のフレームで updateMatrixWorld が合計 1,088 ms（旧 PR の候補で 4 位）
    title: 帰属
    author: claude-opus-5-5/1m
---

# 何を変えたか

`Cockpit.render` は、車内視点の 1 フレームに、ミラー（`updateMirror`）・通常の視界（`composer.drawWorld`）・車外のレイヤと車内のレイヤ（`drawOver` 2 回）・雨のガラスを、同じ姿勢で続けて描く。three の `renderer.render` は、`scene.matrixWorldAutoUpdate` が真なら描くたびにシーン全体の `updateMatrixWorld` を呼ぶので、1 フレームに約 4.7 回、同じ行列を計算し直していた。[^runs]

`src/render/sceneMatrices.ts` の `withSceneMatrices(scene, draw)` が、続けて描く前に 1 回だけ更新し、描く間は `matrixWorldAutoUpdate` を止め、例外でも `finally` で元に戻す。`Cockpit.render` の車内の分をこれで包んだ。車内でないとき（車外の視点）は変えていない。[^tests]

採らなかった方法: フレーム全体で行列の更新を止める形。同じフレームの後で姿勢を変えて描く物（目撃者の撮影など）が、古い行列で描かれる。包む範囲を、同じ姿勢で続けて描く所だけにした。

# 計測（main 48dc699、ヘッドレス Chrome 157・M2 Max）

`perf-scene-matrices.mjs` は、旧処理（`Cockpit.render` の変更前の本文の写し。main の本文と同じことを確かめた）と新しい処理を、同じページの中で 8 秒ずつ A B B A B A A B と切り替えて測る。A が旧、B が新。1 フレームの値の平均。[^runs]

| 夜雨             | A1    | B1    | B2    | A2    | B3    | A3    | A4    | B4       |
| ---------------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | -------- |
| フレームの CPU   | 27.70 | 26.17 | 22.96 | 23.01 | 22.30 | 24.96 | 23.20 | 22.04 ms |
| 車内の描画       | 18.91 | 17.05 | 15.68 | 15.94 | 15.05 | 15.88 | 15.95 | 15.30 ms |
| 行列の CPU       | 1.63  | 0.42  | 0.37  | 1.33  | 0.36  | 1.31  | 1.33  | 0.37 ms  |
| 行列の更新の回数 | 4.67  | 1     | 1     | 4.67  | 1     | 4.67  | 4.67  | 1        |

| 昼晴れ         | A1    | B1    | B2    | A2    | B3    | A3    | A4    | B4       |
| -------------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | -------- |
| フレームの CPU | 24.66 | 23.13 | 23.03 | 23.77 | 22.48 | 23.34 | 24.05 | 23.16 ms |
| 車内の描画     | 17.54 | 16.46 | 16.72 | 17.48 | 16.39 | 17.14 | 17.69 | 16.98 ms |
| 行列の CPU     | 1.44  | 0.40  | 0.39  | 1.45  | 0.40  | 1.45  | 1.48  | 0.41 ms  |

- 狙った値（1 フレームの行列の CPU）: 夜雨 平均 1.40 → 0.38 ms（−1.02 ms、−73 %）、昼晴れ 1.46 → 0.40 ms（−1.06 ms、−73 %）。並んだ A と B の 4 組ずつ、計 8 組とも B が小さい。計画のマージ前の条件（20 % 以上、1 フレームで 0.5 ms 以上、全往復で同じ向き）を満たす。[^baseline]
- フレームの CPU も 8 組とも B が小さいが、差は 0.05〜2.66 ms で揺れる（行列の分のほかは、走りの揺れ）。
- 一致: WebGPU と WebGL2 の、夜雨・昼晴れのそれぞれで、4,096,000 の画素の値が旧処理と同じ（差 0）。車を 0.35 m 動かしワイパーを回した後も同じ。シーン全体の world matrix も同じ。描いた後に `matrixWorldAutoUpdate` が真に戻っていることも確かめた。
- ランタイムの失敗（uncaught_error・log_schema_invalid ほか）は 0。

# 確かめていないこと

- 最長フレームへの効き（この変更は毎フレームの CPU を減らす物で、最長の停止はシェーダーの組み立て。perf-baseline.md）。マージ後のバッチの取り直しで、悪化が無いことを見る。
- 本物のスマホ（低の画質ではミラーの描画が減るので、回数は 4.7 より少ないはず）。
