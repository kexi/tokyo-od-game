---
type: Reference
title: PLATEAU 建物の配信と LOD 選定
description: 3D Tiles を直接ストリーミングする構成と、LOD2 を捨てて LOD1 にした理由（キャッシュ枯渇・浮いた壁・網羅率）、建物 ID を使った外壁テクスチャ。AABB で向きを誤診した訂正を含む。
resource: https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/13-bldg-lod1-latest/tileset.json
tags: [plateau, rendering]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T04:55:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T03:45:00Z }
sources:
  - id: headless-lru
    resource: ヘッドレス Chrome（M2 Max・丸の内スポーン・起動 15 秒後）で tiles.lruCache を計測
    title: LRU キャッシュ計測
  - id: chiyoda-tileset
    resource: https://assets.cms.plateau.reearth.io/assets/28/07d0a1-b6be-46ef-bd87-4f0683b5ef6e/13101_chiyoda-ku_pref_2025_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2/tileset.json
    title: 千代田区 LOD2 tileset（3D Tiles 1.0、b3dm、REPLACE、深さ 0〜5）
  - id: site-policy
    resource: https://www.mlit.go.jp/plateau/site-policy/
    title: PLATEAU サイトポリシー
  - id: streaming-check
    resource: 調査ワークフローのストリーミング賛否検証（2 エージェント）
    title: 3D Tiles ストリーミング検証
    author: claude-opus-5-5/1m
---

# 構成

- 都全域の集約 tileset（`13-bldg-lod1-latest`）を 3DTilesRendererJS 0.5.3 で読む。配信元は CORS `*`。中身は 3D Tiles 1.0 の b3dm で、Draco 圧縮と CESIUM_RTC を使っている。
- `LoadRegionPlugin` で読み込み範囲を絞る。
  - プレイヤーを中心とする半径 2.8km（スマホは 1.6km）の SphereRegion をマスクにする。
  - 半径 250m は全方向を最高詳細度で読む。車の背後にも衝突判定を作るため。
- 衝突判定は、見えているタイルのメッシュから Rapier の trimesh を作る。作るのは 100ms ごとに 1 個まで。
- LOD1 には色が無いため、窓・ブロックごとの色・夜の点灯はシェーダーで描く（`src/world/facade.ts`）。

# 遠くの街並み（2026-10-05 追加）

- 同じ集約 tileset をもう 1 つの TilesRenderer で、粗い階層（区ごとの大きい建物 20〜80 棟）だけ 14〜26 km まで読む。子を preprocessNode で刈るプラグイン（`pruneToCoarse`）で、細かい階層と、最初の中身がもう全詳細の台東区を読まない。簡略版の外壁、衝突判定・影なし、近景と重なる所は 0.1 % 奥に描く。
- 上位の階層の中身（港区の根は 20 棟・411 三角形・141 KB のうち batch table 108 KB）、区ごとの最初の geometricError（165〜1,003 m、台東区は 32〜64 m の葉）、プリセットごとのタイル数と通信量は [遠景](far-skyline.md)。

# なぜ LOD2 ではないのか

| 観点                            | LOD2（テクスチャ）                               | LOD1                |
| ------------------------------- | ------------------------------------------------ | ------------------- |
| 収録自治体（集約 tileset の子） | 45                                               | 62                  |
| 丸の内でのキャッシュ使用量      | 1,718MB で満杯、表示タイル 5                     | 88MB、表示タイル 68 |
| 中間階層                        | 簡略化された壁の断片が宙に浮く[^chiyoda-tileset] | 問題なし            |

`13-bldg-lod2-latest` と `13-bldg-lod2-texture-latest` は同じ子 tileset を指していて、テクスチャ無しの LOD2 は存在しなかった。[^headless-lru]

# 効かなかったこと

1. **LRU を 0.4GB → 1.0GB に上げる**: 期待したのは近くの詳細タイルが読めるようになること。実際は 104 タイル・1,081MB で満杯のまま、表示は 5 タイルだった。テクスチャ付き LOD2 は 1 タイルあたり約 10MB あった。
2. **LOD2 を `errorTarget: 2`・半径 1.1km・LRU 1.6GB にする**: 1,718MB で再び満杯になり、表示は 5 タイルのままだった。
3. 当初の真因は「都全域の tileset が遠くの区の粗いタイルまで読み、0.4GB の LRU を埋めていた」ことだった。マスク領域で範囲を絞り、LOD1 に替えて解決した。

## 浮いた板の原因 — **最初の診断は誤りだった（2026-10-04 追記）**

> **訂正**: 「メッシュのワールド座標の範囲が ±1.8km に広がっているので、Y-up→Z-up の変換が誤り、建物が倒れている」と考えたが、間違いだった。傾いた面の**軸平行の外接箱（AABB）を変換した 8 頂点の範囲**を測っていたため、範囲が水増しされていた。法線（屋根で ECEF の上方向を向く）を確かめて、向きは正しいと分かった。
>
> 本当の原因は LOD2 の中間階層（深さ 2〜4、geometricError 約 415）に入っている簡略化メッシュで、キャッシュ枯渇で最下層まで詳細化できず、それが表示され続けていた。

# 外壁テクスチャ（2026-10-04 追加）

- LOD1 のタイルのメッシュは複数の建物をまとめたもので、建物 ID の頂点属性を持つ。丸の内では 68 メッシュ中 63 が `_batchid`、5 が `_feature_id_0`（EXT_mesh_features 形式）だった。
- `load-model` の時点ではタイルはまだグループに入っておらず、`updateMatrixWorld` すると頂点が ECEF で得られる。タイル中心の放射方向を「上」として建物ごとの高さを求め、高さで外壁の種類を選ぶ。12m 以下はアパート・雑居ビル・倉庫・レンガ、30m 以下はマンション・雑居ビル・タイル張り、60m 以下はコンクリート・タイルのオフィスとマンション、それより高いとガラスかコンクリートのオフィス。階は建物ごとの基部から数える（頂点属性 `facade`）。
- 外壁 8 種類（agy が手続き生成、1 枚 = 幅 12.8m × 高さ 14m）を、色を RGB・窓マスクを A にまとめて 1 枚のテクスチャ配列にした。スマホは半分の解像度（2.3MB）。
- 浮動原点の付け替えで模様がずれないよう、水平方向の周期 PERIOD を 12.8m の倍数（576m）にした。

# 注意

- 配信は「試験運用・SLA なし」で、スキーマは予告なく変わり得る。`-latest` は年度更新で自動的に切り替わる。[^streaming-check]
- 出典は「出典：国土交通省 PLATEAUウェブサイト」。加工した旨も書く。[^site-policy]

[^headless-lru]: LRU キャッシュ計測

[^chiyoda-tileset]: 千代田区 LOD2 tileset

[^site-policy]: PLATEAU サイトポリシー

[^streaming-check]: 3D Tiles ストリーミング検証
