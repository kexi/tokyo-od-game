---
type: Reference
title: ランドマークのモデリングとライトアップ（東京タワー・東京スカイツリー・東京駅丸の内駅舎）
description: Blender CLI で 3 つのランドマークを実寸で手続き生成し、夜間ライトアップを Light_<mode>_<part> の発光マテリアル（KHR_materials_variants 兼用）と遠景 LOD にした手順。寸法の出典と、依頼時の前提（帯 11 本・展望台 150/250 m・ダイヤモンドヴェール 7 段・粋/雅の 2 交互）を一次情報で訂正した記録を含む。東京駅の高さ（軒・ドーム・最高 46.1 m の意味）は 2026-10-05 に訂正し、駅舎の詳細は別文書に移した。
tags: [rendering, plateau, licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T05:00:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T15:30:00Z }
sources:
  - id: tt-wiki
    resource: https://ja.wikipedia.org/wiki/東京タワー
    title: Wikipedia「東京タワー」（版 111232845）
  - id: tt-lightup
    resource: https://www.tokyotower.co.jp/lightup/
    title: 東京タワー公式 ライトアップ（2026-10-04 取得）
    author: team:日本電波塔
  - id: sk-wiki
    resource: https://ja.wikipedia.org/wiki/東京スカイツリー
    title: Wikipedia「東京スカイツリー」（版 110955133）
  - id: sk-official
    resource: https://www.tokyo-skytree.jp/about/outline/ ・ /about/design/ ・ /about/design/color/ ・ /about/design/lighting/
    title: 東京スカイツリー公式（高さ・足元 約 68 m・デザイン・ライティングの説明）
    author: team:東武タワースカイツリー
  - id: sk-calendar
    resource: https://www.tokyo-skytree.jp/enjoy/lighting/
    title: 東京スカイツリー公式「本日のライティング」2026 年 10 月分（2026-10-04 取得）
    author: team:東武タワースカイツリー
  - id: ts-wiki
    resource: https://ja.wikipedia.org/wiki/東京駅
    title: Wikipedia「東京駅」丸の内駅舎・復原の節
  - id: ts-jr
    resource: https://www.jreast.co.jp/es/press/2001_2/20020208/data.html
    title: JR 東日本 2002-02-08 発表資料（正面長さ 335.0 m・最高高さ 46.1 m・ドーム部 37.6 m・奥行 22.0 m、検索結果の抜粋で確認。本文は 403 で未取得）
  - id: ts-lightup-hours
    resource: 旅行情報サイト（tabi-mag.jp ほか）の「日没から 21 時まで」という記述
    title: 東京駅ライトアップ時間（二次情報）
  - id: plateau-lod2
    resource: PLATEAU 13101/13103/13107 bldg LOD2 3D Tiles（data446/data248/data131.b3dm）を DracoPy で復号し、gml_id ごとに断面・平面を切った
    title: PLATEAU LOD2 の実測
    author: claude-opus-5-5/1m
  - id: osm
    resource: Overpass API（2026-10-04）relation 4247312・ways 1244967004–7（東京タワー）、way 288269147 ほか building:part（スカイツリー）、relation 4856156（丸の内駅舎）
    title: OpenStreetMap（ODbL 1.0）
  - id: dem
    resource: 地理院 DEM5A（z15）を各ランドマークの基準点で読んだ値
    title: 地盤高
  - id: commons
    resource: Wikimedia Commons の写真 21 枚（見た目の参考と寸法比の計測のみ。成果物には含めない。一覧は本文末）
    title: 参考写真
  - id: previews
    resource: scripts/blender/landmarks.py の Cycles プレビュー（各ランドマーク × 昼・各モード × 近景・遠景、M2 Max で 1 体 4〜6 分）
    title: プレビュー確認
    author: claude-opus-5-5/1m
---

# 構成

- `scripts/blender/landmarks.py` 1 本で 3 体を作る。出力ファイル名の basename（`tokyo_tower` / `tokyo_skytree` / `tokyo_station`）で対象を選ぶ。1 回の実行で `public/models/<id>.glb`（近景 `<Name>_Near` と遠景 `<Name>_Far` の 2 ノード）、`public/models/<id>_far.glb`（遠景ノードだけ）を書き、`public/data/landmarks.json` の該当エントリを差し替える（他のエントリは保持）。
- テクスチャは `scripts/textures/landmark_textures.py`（PIL、シード固定、文字・ロゴなし）が `assets/landmarks/textures/` に書く。トラスは「白の部材＋透明」のマスク（alphaMode MASK）で、色はマテリアルの baseColorFactor で付ける。
- 座標は車のモデルと同じ規約（+Y 上、+Z が heading の向き、+X がその左、メートル、原点は基準点の地面）。ゲームでは `rotation.y = π − heading·π/180` で置く（+Z を方位 heading に向ける式）。
- 遠景 LOD は 220〜552 三角形の 1〜3 マテリアル。近景は 2,405〜9,880 三角形。いずれも 1 MB 未満（後述の表）。

## 夜間照明の仕組み

- 昼のマテリアルは `Day_<part>`。夜のモード `<mode>` ごとに、照らされる部品だけ `Light_<mode>_<part>` を用意した（昼と同じ色・テクスチャに、発光色・発光テクスチャ・強さを足したもの）。用意の無い部品は昼のまま（夜は暗く写る）。`<part>` には `TT_` / `SK_` / `TS_` の接頭辞を付け、ファイルをまたいでも名前がぶつからないようにした。
- 同じ対応を KHR_materials_variants（バリアント名 = モード）でも書き出した。three.js の GLTFLoader は拡張を解釈しないが、プリミティブの `mesh.userData.gltfExtensions.KHR_materials_variants.mappings` に残り、`parser.getDependency("material", index)` で引ける。名前で引くなら `parser.getDependencies("material")` で全マテリアルを読める。
- Blender の glTF 出力で variants を出すには、アドオン設定 `KHR_materials_variants_ui` を True にして（プロパティ群が登録される）、`scene.gltf2_KHR_materials_variants_variants` と `mesh.gltf2_variant_mesh_data[].variants[].variant.variant_idx` を埋める。対応はマテリアルスロット単位。
- 発光の強さが 1 以下だと emissiveFactor に掛け込まれ、1 を超えると KHR_materials_emissive_strength になる。

# 寸法（実物と模型）

## 東京タワー

| 項目                 | 実物（出典）                                                                                                | 模型                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 高さ                 | 333 m（GL＝標高 18.000 m 基準）[^tt-wiki]                                                                   | 333 m                                       |
| 塔脚の間隔           | 88.0 m（脚の中心）[^tt-wiki]                                                                                | 88 m（脚幅 6.8 m は OSM の脚 way）          |
| メインデッキ         | 地上 120 m より上の 2 階、床 約 125 m（公式の「150 m」は海抜の丸め）[^tt-wiki]                              | 117–131 m の箱（PLATEAU LOD2 で 118–130 m） |
| トップデッキ         | 地上 223.55 m（公式「250 m」）[^tt-wiki]                                                                    | 223.55–229 m                                |
| デジタルアンテナの筒 | 直径 13 m・高さ 11 m[^tt-wiki]                                                                              | 直径 13.2 m・241.3–252.4 m                  |
| 塔体の上端           | H.27 = 252.65 m[^tt-wiki]                                                                                   | 252.65 m                                    |
| 昼間障害標識         | メインデッキ上端から上を 7 等分（1986 年まで 11 等分）、下は黄赤一色、デッキ側面は白（1998 年〜）[^tt-wiki] | 131 m から上を 28.86 m × 7 本、両端が黄赤   |
| フットタウン         | 地上 5 階建て[^tt-wiki]、47 × 76 × 23.5 m[^plateau-lod2]                                                    | 同寸、焦茶の外壁                            |

脚の線は PLATEAU LOD2 の外形（高さ 0–252 m の 16 断面）から脚幅の半分を引いて単調三次補間した。メインデッキより下は強い反り（地上 88 m → 117 m で 18.8 m）、上はほぼ直線で細くなる。[^plateau-lod2]

## 東京スカイツリー

| 項目       | 実物（出典）                                                | 模型                                                                                                                  |
| ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 高さ       | 634 m[^sk-official]                                         | 634 m                                                                                                                 |
| 足元       | 一辺 約 68 m の正三角形、H320 で円[^sk-official] [^sk-wiki] | 外接半径 39.26 m の三角形 → H320 で半径 17.8 m の円                                                                   |
| 断面の変化 | 「そり」「むくり」[^sk-official]                            | 角の半径を 39.3 → 17.8 m（指数 1.25 で凹＝そり）、面の中央を 19.6 → 17.8 m（指数 0.8 で凸＝むくり）、r = a / cos(φ)^k |
| 天望デッキ | フロア 350（340/345/350）[^sk-official]                     | 330–375 m のドラム、最大径 55 m                                                                                       |
| 天望回廊   | フロア 445/450[^sk-official]                                | 435.5–463 m、縁 径 39.8 m                                                                                             |
| 心柱       | RC、直径 約 8 m、H375[^sk-wiki]                             | 見える芯は径 19 m（エレベーター・階段の束として）                                                                     |
| ゲイン塔   | H497 から、外周 約 6 m・アンテナ外周 約 8 m[^sk-wiki]       | 6.4 m の六角トラス、アンテナ筒 9 m                                                                                    |
| 向き       | 東西に向く一辺が北十間川にほぼ平行[^sk-wiki]                | 角の 1 つが方位 353.8°（PLATEAU 断面で 3 頂点が 353.3°/233.1°/115.1°）                                                |

天望デッキ・回廊の径は PLATEAU LOD2 が粗い（デッキを 355–375 m の円錐台、径 52 m）ため、Commons の望遠写真（Tokyo Skytree 20241019.jpg）でも測った。縦の尺度はマスト頂部 634 m とゲイン塔根元 497 m の 2 点で決め（0.1109 m/px）、天望回廊（450 m）と天望デッキの窓（350 m）が予測位置に来ることを確かめた。この尺度ではデッキ最大径 60 m、カメラとの距離差と見上げ角を補正して 56 m、PLATEAU の 52 m との間を取って 55 m にした。[^commons] [^plateau-lod2]

## 東京駅丸の内駅舎

| 項目           | 実物（出典）                                    | 模型                                                                            |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| 正面長さ       | 335.0 m[^ts-jr]（Wikipedia は 330 m[^ts-wiki]） | 南北ドーム中心間 198.2 m、北端〜南の折れた翼の端まで 約 340 m（PLATEAU どおり） |
| 階数・構造     | 3 階建て、鉄骨煉瓦造[^ts-jr] [^ts-wiki]         | 3 層の窓、軒 18 m                                                               |
| 奥行（一般部） | 22.0 m[^ts-jr]                                  | 21.3 m（PLATEAU LOD2）                                                          |
| ドーム部       | 37.6 m、最高 46.1 m[^ts-jr]                     | ドーム頂 34.75 m、ランタン・頂華 38.4 m（PLATEAU の最高点）                     |
| 中央部         | —                                               | 寄棟屋根 28.5 m、アーチの破風と丸窓、御車寄せ                                   |

最高高さ 46.1 m は PLATEAU に無い（LOD2 の最高点は 38.4 m）。頂華や避雷針を含む値と考えているが、確かめていない。

> **訂正（2026-10-05）**: 駅舎は写真と JR の復原後立面図から作り直し、[東京駅丸の内駅舎を写真と公開図面から作る](tokyo-station-blender.md) に移した。上の表の「軒 18 m」「ドーム頂 34.75 m」は PLATEAU の外形をそのまま読んだ値だった。JR 東日本 2007-05-08 資料では**最高 46.1 m はフィニアル（頂部飾り）を含む高さで、フィニアルを除くと 34.8 m、軒高は 16.7 m**。写真の計測ではコーニス 16.3–17.0 m、高欄の上端 18.0 m（PLATEAU の 18.2 m は高欄の上端）、中央のコーニスは翼より 2.6 m 高い 18.9–19.7 m。「ドーム部 37.6 m」が何の寸法かは分からないまま。下の落とし穴 7 と出力表の駅の行は旧版の記録として残す。

# 夜のモードと点灯スケジュール

| ランドマーク | モード                 | 内容                                                             | 規則（出典）                                                                                                                                                                             |
| ------------ | ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 東京タワー   | landmarkWinter         | 高圧ナトリウムの橙                                               | 10 月初旬の夜〜7 月 6 日[^tt-lightup]                                                                                                                                                    |
|              | landmarkSummer         | メタルハライドの白                                               | 7 月 7 日の夜〜10 月初旬[^tt-lightup]                                                                                                                                                    |
|              | diamond                | インフィニティ・ダイヤモンドヴェール（17 段・268 台の LED）      | 毎週月・木 20:00–22:00、月ごとの色（1 月 #FFFF00 … 12 月 #00FF00）[^tt-lightup]                                                                                                          |
|              | lightsOut              | 航空障害灯のみ                                                   | 日没〜24:00 以外                                                                                                                                                                         |
| スカイツリー | iki / miyabi / nobori  | 粋（淡い水色・心柱）/ 雅（江戸紫と金箔）/ 幟（橘色・縦のライン） | 3 種を 1 日ごとに替える。2026 年 10 月の公式カレンダーでは 雅 → 幟 → 粋 の 3 日周期で、10-04 が雅。特別ライティングの日はその日だけ置き換わり、周期は進み続ける[^sk-calendar] [^sk-wiki] |
|              | lightsOut              | 航空障害灯のみ                                                   | 24:00 以降                                                                                                                                                                               |
| 東京駅       | floodlight / lightsOut | 投光＋客室 / 客室の窓だけ                                        | 日没〜21 時頃（二次情報のみ）[^ts-lightup-hours]                                                                                                                                         |

ダイヤモンドヴェールの色は 7 月の Sea Blue（#0080FF）を焼き込み、`landmarks.json` の `colorByMonth` で実行時に差し替えられるようにした。スカイツリーの周期は `lightSchedule.cycle`（`epoch` の日が `modes[0]`）に書いた。

# 依頼時の前提を訂正したもの

1. **東京タワーの帯は 11 本ではなく 7 本**。1986 年の航空法改正で 11 等分から 7 等分になった。しかも帯はメインデッキの上端から上だけで、下は黄赤一色。[^tt-wiki]
2. **展望台の「150 m」「250 m」は地上高ではない**。地上 125 m（2 階建て、120 m より上）と 223.55 m で、公式の数字は海抜の丸め。模型は地上高で作った。[^tt-wiki]
3. **フットタウンは 4 階ではなく 5 階建て**。[^tt-wiki]
4. **ダイヤモンドヴェールは 7 段ではなく 17 段**。2008 年の初代は「17 段の各階層が 7 色に発色」、2019 年 10 月からの現行（インフィニティ・ダイヤモンドヴェール）は 17 段 268 台で、定例点灯は月ごとの単色。[^tt-wiki] [^tt-lightup]
5. **スカイツリーは粋・雅の 2 交互ではない**。2017-05-18 に「幟」が加わり、3 種を 1 日ごとに替えている。[^sk-wiki] [^sk-calendar]

# 落とし穴

1. **プレビューで近景と遠景のノードを同時に描くと、遠景の不透明な面が近景を覆う**。フットタウンと展望台が真っ黒、トラスが半透明の膜に写り、マテリアルの不具合と誤認した。ゲームと同じく片方ずつ描くようにした。
2. **アルベド × ランプ色で発光色を作ると、トーンマッピング後にピンクに写った**（橙の塗装 × ナトリウム = (1.8, 0.08, 0.006) が飽和）。見た目の色（橙の帯は (1.0, 0.34, 0.06)、白の帯は (1.0, 0.60, 0.22)）を直接与えた。
3. **遠景の透過トラスはミップマップで消えうる**。透明部の RGB を部材と同じ色にし、部材の被覆率を 5 割超にした。遠くでは alpha が平均され、不透明なシルエットとして残る。
4. **PLATEAU の b3dm を Blender で読むには前処理が要る**。`extensionsRequired` の CESIUM_RTC と EXT_texture_webp で読み込みが止まるので外す。墨田区・港区の LOD2 では、テクスチャ付きプリミティブの `_BATCHID` が Blender の取り込みで消えたため、DracoPy で直接復号した。
5. **OSM の形は塔の形そのものではない**。スカイツリーの way 288269147 は直径 56 m の円で三角形の足元ではなく、building:part の「天望デッキ」は直径 35 m（胴の太さ）。東京タワーの relation 4247312 はフットタウンの外形。位置と向きは OSM と PLATEAU を突き合わせて決めた（タワーの中心は 4 本の脚 way の平均で、PLATEAU LOD1 の重心と 2 m 以内）。
6. **PLATEAU のスカイツリーは東京スカイツリータウン全体（ソラマチ等、LOD1 で高さ 約 28 m）で 1 棟**。隠すと 400 m の基壇ごと消えるので、`landmarks.json` では `hide: false` にした。東京タワー（LOD1 は脚の範囲に高さ 42 m の箱）と駅舎は `hide: true`。
7. 東京駅の facade テクスチャは 4 m（一般部の 1 柱間）と 6 m（塔屋）の繰り返しで、窓の位置は実物の柱間と一致しない。近くで見ると塔屋の脇で窓が切れる。（2026-10-05 の作り直しで外壁の絵は廃止し、窓・柱間を形で作った。[東京駅](tokyo-station-blender.md)）

# 出力（2026-10-04 時点）

| ファイル                                 | 近景三角形 | 遠景三角形 | glb    | 遠景 glb |
| ---------------------------------------- | ---------- | ---------- | ------ | -------- |
| tokyo_tower.glb                          | 9,880      | 220        | 271 KB | 116 KB   |
| tokyo_skytree.glb                        | 7,688      | 552        | 382 KB | 291 KB   |
| tokyo_station.glb                        | 2,405      | 266        | 918 KB | 9 KB     |
| tokyo_station.glb（2026-10-05 作り直し） | 71,954     | 819        | 523 KB | 13 KB    |

[^previews]

# 参考写真（Wikimedia Commons、見た目と比率の参照のみ）

- 東京タワー: Tokyo Tower 2023.jpg（Akonnchiroll, CC BY-SA 4.0）、Tokyo Tower seen from Shiba Park.jpg / Tokyo Tower lower part seen from Tokyo Tower-dori street.jpg（Ymblanter, CC BY-SA 4.0）、Minato City, Tokyo, Japan (Night).jpg（David Kernan, CC BY 4.0）、Azabudai Hills and Tokyo Tower seen from Tokyo Midtown.jpg / Tokyo Tower light up for Rare Disease Day 2023.jpg（Syced, CC0）
- スカイツリー: Tokyo Skytree 20241019.jpg（Supanut Arunoprayote, CC BY 4.0）、Tokyo Skytree at night (Iki).jpg / (Miyabi).jpg（Kakidai, CC BY-SA 3.0）、Tokyo Skytree from afar.jpg（Terabita34, CC BY-SA 4.0）
- 東京駅: Marunouchi Central Plaza with blue sky, …from JP Tower.jpg（Basile Morin, CC BY-SA 4.0）、Views of the Tokyo Station Marunouchi Building from the Marunouchi Building 2016-06-08.jpg（Dick Thomas Johnson, CC BY 2.0）、Tokyo Station Marunouchi Building at night 20191201.jpg（掬茶, CC BY-SA 4.0）、Tokyo Station (Marunouchi Building).jpg（Alexandr3126, CC BY-SA 4.0）、2024 Tokyo Station Marunouchi Building at night ().jpg（Kakidai, CC BY-SA 4.0）、Tokyo-STA Marunouchi-Entrance 2023.jpg（MaedaAkihiko, CC BY-SA 4.0）、Tokyo Station Marunouchi Building - DSC09668.JPG（Daderot, Public domain）

写真の画素はテクスチャにもモデルにも使っていない。運営会社のサイトの画像（ライティングの見本）も参照していない（高さ・スケジュール・色の値だけを使った）。

[^tt-wiki]: Wikipedia「東京タワー」

[^tt-lightup]: 東京タワー公式 ライトアップ

[^sk-wiki]: Wikipedia「東京スカイツリー」

[^sk-official]: 東京スカイツリー公式

[^sk-calendar]: 東京スカイツリー公式「本日のライティング」

[^ts-wiki]: Wikipedia「東京駅」

[^ts-jr]: JR 東日本 2002-02-08 発表資料

[^ts-lightup-hours]: 東京駅ライトアップ時間（二次情報）

[^plateau-lod2]: PLATEAU LOD2 の実測

[^commons]: 参考写真

[^previews]: プレビュー確認
