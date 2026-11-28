---
type: Reference
title: "地形の水域マスクのシェーダーをチャンクの間で共有する（性能 PR #11 の作り直し）"
description: "地形のチャンクは、写真が載るたびに、自分の水域マスクのテクスチャを持つ TextureNode を maskNode に入れていた。そのため同じシェーダーなのに three のプログラムのキーがチャンクごとに違い、チャンクの数だけ同期でシェーダーを作っていた。マスクの式を 1 つにし、各チャンクのテクスチャは材質の参照（materialReference の terrainWaterMap）で渡す。main で測り直した値は、8 チャンクの場面でシェーダーの作成が 8 → 1 回（後から 0）、組み立ての CPU 22〜40 → 2.9〜4.3 ms。WebGPU・WebGL2 の昼夜で 20 画像の 409,600 値ずつが旧処理と一致（マスクの差し替え・交換の後も）。10 月の旧 PR #11 の数値は引き継がない。"
tags: [rendering, terrain, water, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-28T15:00:00Z }
verified:
  - { by: process:vitest, at: 2026-11-28T15:00:00Z }
  - { by: process:headless-chrome, at: 2026-11-28T13:59:00Z }
sources:
  - id: parity
    resource: "scripts/qa/terrain-mask-parity.mjs（just measure-terrain-mask）を、この枝の作業木（main 9a69baf + この変更、未コミット）の開発サーバーで 1 本（2026-11-28 13:59Z、鍵あり）。8 チャンクの固定の場面を、旧処理（チャンクごとの TextureNode）と新しい処理で描き、最初・マスクの交換・差し替え・乾いた・濡れた の 5 枚ずつを比べ、シェーダーの作成の数と組み立ての CPU を数えた。結果は作業木の .qa/perf/2026-11-28T13-59-35-057Z-terrain-mask/report.json"
    title: 一致と作成の回数
    author: claude-opus-5-5/1m
  - id: tests
    resource: tests/terrainMaterial.test.ts（大きさの違う 3 枚のマスクで three の customProgramCacheKey が同じになり、マスクを差し替えても変わらないこと。旧の作り方では 3 通りになること）
    title: プログラムのキーのテスト
    author: claude-opus-5-5/1m
---

# 何を変えたか

`src/world/terrain.ts` は、写真が載ったチャンクの `maskNode` に、そのチャンクの水域マスク（`chunk.water`、チャンクごとの TextureNode）を読む式を入れていた。three はノードの組み立てでプログラムのキーを作るので、式が同じでも TextureNode が違えばキーが違い、チャンクの数だけシェーダーを同期で作っていた。

`src/world/terrainMaterial.ts` の `bindTerrainMask` は、全チャンクで同じ式（`materialReference("terrainWaterMap", "texture")` を `context` の `getUV` で南北を返して読む）を `maskNode` に入れ、チャンクのテクスチャを材質のプロパティ `terrainWaterMap` に置く。マスクを差し替えたとき（`applyWater`）も、写真が載った後なら（`hasMaskShader`）置き直す。[^tests]

採らなかった方法: チャンクごとの TextureNode のまま `value` だけ替える形。最初の組み立てでキーが分かれるので、チャンクの数だけ作る。CPU 側のマスク（`waterMask`、掘割・トンネルの穴やコライダーが読む）はこの変更と無関係で、変えていない。

# 計測（1 本、8 チャンクの場面）

[^parity]

| 描画方式 | 時刻 | シェーダーの作成 旧 → 新 | 後からの作成 | 組み立ての CPU 旧 → 新 |
| -------- | ---- | ------------------------ | ------------ | ---------------------- |
| WebGPU   | 昼   | 8 → 1                    | 0 → 0        | 40.2 → 4.3 ms          |
| WebGPU   | 夜   | 8 → 1                    | 0 → 0        | 23.4 → 2.9 ms          |
| WebGL2   | 昼   | 8 → 1                    | 0 → 0        | 28.0 → 3.2 ms          |
| WebGL2   | 夜   | 8 → 1                    | 0 → 0        | 22.3 → 3.2 ms          |

- 計画のマージ前の条件（回数で見る物: 同期のシェーダー生成が 1 回または 0 回になる）を満たす。
- 一致: 4 条件 × 5 枚（最初・マスクの交換・差し替え・乾いた・濡れた）の 20 組で、409,600 の値が全部同じ（差 0）。水の有無・交換・差し替えで画素が変わることも確かめた（33,025〜78,579 値）。
- この走りは、同じ機械で型検査とテストを回していた時間と重なった（ロードアベレージ 約 28）。CPU の ms はその分ずれうるが、条件は回数で見る。

# 確かめていないこと

- 実際のワープでの作成の回数（旧 PR は perf-road-streaming.mjs に足した数え方で見ていたが、その道具は触らない決まりなので入れていない）。帰属の道具では、ノードの組み立ての中の地形の分を分けていない。
- 写真の到着でシェーダーを作り直さないこと（#20 の主題。この変更の上で書き直す）。
