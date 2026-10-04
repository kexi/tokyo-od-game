---
type: Reference
title: 警察車両のモデリング（白黒パトカー・覆面パトカー・白バイ・白バイ隊員）
description: 白黒パトカー、反転式警光灯の覆面パトカー、白バイと交通機動隊員を bpy で作った手順、寸法と装備の根拠、実在の標章を避けた方法、agy に任せたテクスチャの確認結果、踏んだ落とし穴。
tags: [rendering, licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T14:30:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T14:25:00Z }
sources:
  - id: wp-patrol
    resource: https://ja.wikipedia.org/w/index.php?title=パトロールカー&oldid=111081888
    title: Wikipedia「パトロールカー」版 111081888（CC BY-SA 4.0。警察庁の指針、昇降機、反転式警光灯、前方集中式警光灯）
  - id: wp-crown
    resource: https://ja.wikipedia.org/w/index.php?title=トヨタ・クラウン&oldid=110951464
    title: Wikipedia「トヨタ・クラウン」版 110951464（15代目 S22#型の諸元）
  - id: wp-shirobai
    resource: https://ja.wikipedia.org/w/index.php?title=白バイ&oldid=107780268
    title: Wikipedia「白バイ」版 107780268（装備はサイドボックス、無線機箱、赤色回転灯、トランペットスピーカー）
  - id: wp-rider
    resource: https://ja.wikipedia.org/w/index.php?title=白バイ隊員&oldid=111039227
    title: Wikipedia「白バイ隊員」版 111039227（乗車服とヘルメット）
  - id: wp-cb1300
    resource: https://ja.wikipedia.org/w/index.php?title=ホンダ・CB1300スーパーフォア&oldid=109756985
    title: Wikipedia「ホンダ・CB1300スーパーフォア」版 109756985（CB1300P の相違点、SC54 の諸元）
  - id: commons-patrol
    resource: https://commons.wikimedia.org/wiki/File:Toyota_CROWN_2.0_TURBO_S_2WD_(3BA-ARS220)_used_as_a_patrol_car_of_Nara_Prefectural_Police.jpg
    title: Wikimedia Commons の現行パトカー写真 4 枚（同作者の正面・後面・S200 型を含む、いずれも CC BY-SA 4.0、User:Tokumeigakarinoaoshima）
  - id: commons-shirobai
    resource: https://commons.wikimedia.org/wiki/File:CB1300P_Kanagawa_pref_police.jpg
    title: Wikimedia Commons の白バイ写真（CB1300P_Kanagawa_pref_police.jpg と CB1300P_001.jpg は CC0、Hyogo-kenkei 白バイ PC011100a.jpg は CC BY-SA 3.0）
  - id: commons-crown
    resource: https://commons.wikimedia.org/wiki/File:Toyota_Crown_ARS220_Unmarked_car.jpg
    title: Wikimedia Commons の 15代目クラウン前後の写真（CC0、User:Ypy31）
  - id: agy-job
    resource: Antigravity（agy）への委譲ジョブ agy-1f84c7 と、Claude Code による再実行・目視確認
    title: テクスチャ制作の委譲
    author: claude-opus-5-5/1m
  - id: build-run
    resource: scripts/blender/police_{car,bike}.py を M2 Max・Blender 5.2.2 で実行し、Cycles のプレビューを目視、書き出した glb を Blender に読み戻して外形と三角形数を測った
    title: 生成とプレビューの実測
---

# 何を作ったか

| モデル               | スクリプト → 出力                                             | 外形（全長×全幅×全高）                                                    |                                            三角形 |    glb |
| :------------------- | :------------------------------------------------------------ | :------------------------------------------------------------------------ | ------------------------------------------------: | -----: |
| 白黒パトカー         | `police_car.py -- patrol` → `public/models/police_patrol.glb` | 4.94 × 1.94 × 1.77 m（車体 1.455 m、ミラー込みの幅、アンテナ先端 1.84 m） | 17,568（車体 14,272、ライトバー 400、車輪 724×4） | 218 KB |
| 覆面パトカー         | `police_car.py -- unmarked` → `police_unmarked.glb`           | 4.94 × 1.94 × 1.455 m（アンテナ先端 1.63 m）                              |                              16,380（反転灯 136） | 162 KB |
| 白バイ＋乗車した隊員 | `police_bike.py -- shirobai` → `police_shirobai.glb`          | 2.15 × 0.93 × 1.55 m（回転灯の頂部、長いアンテナ先端 1.90 m）             |                               6,379（隊員 2,325） | 388 KB |
| 立っている白バイ隊員 | `police_bike.py -- rider` → `police_rider.glb`                | 身長 1.84 m（ヘルメット頂部）                                             |                                             2,325 | 282 KB |

外形は glb を Blender に読み戻して測った値。[^build-run] 比較の目安は car.glb の自車 4.9 万三角形、救急車 2,880 三角形。共通の補助関数は `scripts/blender/police_common.py`（Mesh、レイキャストのデカール、書き出し、プレビュー）。テクスチャは `scripts/textures/police_vehicle_textures.py`（`uv run`）→ `assets/police/textures/` の 19 枚（`sedan_*` `patrol_*` `unmarked_*` `red_lens` `shirobai_*` `rider_*`）。同じディレクトリの `kit/trousers/uniform/vest.png` と `police.py` / `police_textures.py`（徒歩の警察官）は別担当のもので、名前が重ならないよう接頭辞を付けた。

# 規約（ゲーム側が引く名前）

- 座標は救急車・大型車と同じ: +Y 上、+Z 前、+X が車両の左、地面 y = 0、原点は全長の中点、`export_yup=False`。寸法・車軸はルートノード（`PolicePatrol` / `PoliceUnmarked` / `PoliceShirobai` / `ShirobaiRider`）の extras。
- 車輪は 1 輪 1 ノード、原点がハブ、車軸がローカル X、右側は形状を反転して作ったので全輪 `rotation.x` 正で前進。車は `WheelFL/FR/RL/RR`（x ±0.775、z +1.50 / −1.42、半径 0.334）、白バイは `WheelFront`（`Steer` の子）と `WheelRear`。`Steer` のローカル +Y が 25° 後傾した操舵軸。
- 赤色灯は救急車と同じ材質名 `BeaconL`（+X 側）/ `BeaconR`。パトカーはライトバーの左右・前バンパーの赤色灯・リアガラス上端の赤色灯、覆面はグリル内の 2 灯と反転灯のドームの左右半分、白バイは前の 2 灯（クラッシュバー上）と後部回転灯の左右半分。発光は emissive のテクスチャ × 係数 1 で、何もしないと常時点灯に見える。
- パトカーのライトバーは `LightBar` ノード（原点はルーフの昇降機ハウジングの上面）。**昇降式**: `LightBar.position.y += extras.lightBarLift`（1.2 m）。支柱は最初からバーの下に 1.2 m 伸びていて、下げている間はハウジングと車室（不透明のガラス）の中に隠れる。拡声器はバー中央の `Speaker` 材質、音源用の空ノード `Siren` はバーの子。
- 覆面の**反転式警光灯**は `HiddenBeacon` ノード: 原点はルーフ中央（z −0.50、ルーフ面の 4 mm 上）、回転軸はローカル X（車の左右方向）。`rotation.x = 0` で塗装面が上の蓋（警光灯は蓋の裏でルーフの中）、`π` で 180° 反転して流線形の赤色灯が屋根に出る（extras `hiddenBeaconAxis: "x"`, `hiddenBeaconRaised: π`）。音源用の `Siren` はグリルの裏。
- 白バイの `Siren` は右のトランペット（サイレン）の位置。左は拡声器。
- 隊員の部品名と関節位置は human.glb と同一（`UpperArmL/R` 肩、`ForearmL/R` 肘、`ThighL/R` 股関節、`ShinL/R` 膝。スクリプトが human.glb のノード位置と照合し、ずれていたら止まる）。立ち姿の `police_rider.glb` は human.glb と同じく平置き（`Torso` と `Head` の原点は足元）。白バイの `Rider` は motorbike.glb と同じ階層（`Torso` が腰、`Head` が首 y 1.50）で、乗車姿勢は手をグリップ、足首をステップに合わせた数値 IK で解き、角度を `Rider` の extras `pose`（X 回転、負が前）と `poseZ`（Z 回転、肩と股を外に開く）に残した。
- 材質名: 白黒は `PaintWhite` / `PaintBlack`、覆面は複製して塗り替えられる `Paint`（濃いガンメタ 0x2B2F36）。灯火は car.glb と同じ名前。隊員の肌は human.glb と同じ `Skin`（face.png × 肌色）、服は全色テクスチャの `Jacket` / `Breeches`。

# 寸法と装備の根拠

- **車体**: 現行パトカーの基になった 15 代目の 4 ドアセダンは 4,910 × 1,800 × 1,455 mm（後輪駆動）、ホイールベース 2,920 mm。[^wp-crown] 前オーバーハング 0.955 m、トレッド 1.55 m、215/55R17 は仮定（下記）。
- **塗り分け**: 警察庁の指針は「車体を白黒色に塗り上部及び前面に赤色警光灯と拡声器を備え、横部に都道府県名を表記する」。[^wp-patrol] 境目の線は Commons の現行車の写真で決めた: 前はヘッドランプの後端からフロントタイヤの上を通ってドア中央の高さまで下がり、後ろへ向かってリアタイヤの上を越えてリアバンパー上端まで上がる。ボンネット先端は弧状に黒、ルーフは白で上空向けの機番、リアバンパーは黒に白文字。[^commons-patrol] 境目は断面リングの頂点の 1 列にしたので、細分割しても直線のまま。
- **昇降機**: 2000 年頃から、赤色灯を地上約 3 m まで上げる昇降機がある。[^wp-patrol] バーの上端は通常 1.77 m なので 1.2 m 上げる。
- **覆面**: 交通取締用四輪車（反転警光灯）は赤色灯を車内の天井に収め、ルーフ中央が開いて小型の流線形警光灯が出る。かつて 180° 反転して収める構造だったので「反転式」と呼ぶ（現行品は格納スペースで横倒しになり、蓋に連動するリンクで出す）。前面はフロントグリル内の点滅式赤色警光灯（前方集中式警光灯）。[^wp-patrol] モデルは呼び名の由来である 180° 反転の方を採った。車体の外観は市販の同型車と同じにした。[^commons-crown]
- **白バイ**: 現行の大型白バイの基になった 1,300 cc 車（ハーフカウル付き SC54）は 2,220 × 790 × 1,215 mm、ホイールベース 1,515 mm、キャスター 25.0°、トレール 99 mm、120/70ZR17・180/55ZR17、シート高 790 mm。白バイ仕様はハンドルの上げ、ミラーのハンドルマウント、サイドボックスのための低いマフラーなどが異なる。[^wp-cb1300] 装備は、後部側面のサイドボックス、後部上面の無線機箱（長短 2 本のアンテナ、高い位置の赤色回転警光灯）、フロントのサイドバンパーパイプ左に拡声器・右にサイレンのトランペットスピーカー（近年は赤色灯と一体）。[^wp-shirobai] 配置と見た目は Commons の写真で確かめた（無線機箱の上面の大きな機番、クロームのリアクラッシュバー、前の赤色灯の位置）。[^commons-shirobai]
- **隊員**: 乗車服は胸の下まである側章入りの長ズボンとダブルボタンのライダースジャケットで、色は上下とも青、ヘルメットはオープンフェース、オートバイ用ブーツ。[^wp-rider] 淡い青灰色のベスト（白い反射材の縁取り）、白い帯革と手袋、黄色の側章は写真による。[^commons-shirobai]

# 実在の標章を避けた方法

- 旭日章・組織名（「警視庁」「○○県警察」）・本物の「POLICE」の書体は使わない。ドアと後面は Noto Sans JP Bold の「PATROL」、ボンネット先端とヘルメットの額は光芒も星も無い金色の盾形、機番は「27」「07」、サイドボックスは「PATROL 7」、ナンバーは架空の番号（品川 800 す 11-08、品川 300 た 37-64、小型二輪 品川 2 す 11-08）。メーカー名・ロゴ（CROWN、HONDA）も描いていない。
- 参照した写真は形と配色の確認だけに使い、アセットには含めていない。Wikipedia の本文も事実の確認に使っただけで、文章は写していない。

# テクスチャを agy に任せた結果

19 枚の仕様（サイズ、UV の向き、文字、禁止事項）を書いて agy に 1 回で依頼し、283 秒で返ってきた（companion の `task --write`、sandbox はリポジトリ内のみ書き込み可）。[^agy-job]

- フォントは car_textures.py のコミット固定・SHA-256 照合の Noto Sans JP だけ（`get_noto_font` と `draw_license_plate` を import）。システムフォントやフォント以外のネットワーク取得は無かった。`ImageFont` は型注釈にだけ出てくる。
- 自分で `uv run` し直して、19 枚の MD5 が agy の出力と一致した（シード固定で再現できる）。ruff check / format も通った。別担当の 4 枚と `police_textures.py` は更新時刻が変わっていなかった。
- 確認用シートを目視した。白バイのホイール（`shirobai_wheel.png`）のスポークは細い線で、キャストホイールというより針金のスポークに見えるが、ゲームの距離では目立たないのでそのままにした。

# 落とし穴

1. **レイキャストのデカールは、車体の外にはみ出した格子点が空中に残る**。ボンネット先端の黒い弧を全幅一定の x で作ったら、先端の細い所で光線が車体を外れ、ヘッドランプの横に黒いトゲが出た。リアバンパーの下端も同じ。格子の x をその z での車体の半幅に比例させ、下端は車体の底より上に収めた。`decal_missed_vertices` のログが出たら、プレビューにトゲがないか必ず見る。
2. **曲面に貼る文字のデカールは縦の分割が少ないと上下が車体に埋まる**。ドアの「PATROL」を縦 2 分割で貼ったら、肩のふくらみ（ベルトライン直下の張り出し）が板を突き抜けて文字の上半分が消えた。縦 6 分割にした。
3. **human.py の胴の UV は右脇の 1 面が貼り目をまたいで画像全体を逆向きに引き伸ばす**。角の θ だけで u を決めているため、θ = 3π/2 と 13π/8 の間の面が u 1.0 → 0.0625 になる（16 分割の 1 列）。隊員では面の中心の θ で分岐させて回避した（`Mesh.loft` の `uv_of` は面の中心角を受け取る）。human.py 本体は直していない。
4. **開いた筒（襟、首、兜の殻）を `recalc_face_normals` に任せると内外が揃わないことがある**。`Mesh.loft` は側面を軸から外向き、蓋を隣の輪から遠い向きに自分で向けた。ヘルメットの殻は外向き、内張りは内向きに 1 面ずつ揃えた。
5. **Blender の XYZ オイラーは X を先に回して最後に Z**（行列は Rz·Ry·Rx）。three.js の `Euler` の既定 'XYZ' は逆順なので、`pose` と `poseZ` から姿勢を作り直すときは `order = 'ZYX'` にする（glb のノードには四元数で入っているので、そのまま読めば正しい）。
6. 昇降式ライトバーの支柱と反転灯の警光灯は、車室のガラスが不透明（救急車と同じ）であることを前提に車内へ隠している。ガラスを透明にすると見える。

# 仮定（未確認のまま決めたこと）

- トレッド 1.55 m、前オーバーハング 0.955 m、タイヤ 215/55R17（半径 0.334 m）。パトカー仕様の実際のタイヤサイズは確かめていない。
- 昇降機ハウジングの大きさ（幅 1.16 m・長さ 0.58 m・高さ 0.17 m）とライトバーの寸法（1.35 m）は写真からの目分量。昇降の機構（パンタグラフか伸縮柱か）は確かめておらず、2 本の柱にした。
- 反転灯の位置（ルーフ中央）と回転軸（左右方向）。現行品はリンク機構で出すので、動きは実物と違う。
- 白バイの全幅 0.93 m（リアクラッシュバー外側）、サイドボックス・無線機箱・前の赤色灯の寸法は写真からの目分量。乗車服の色（#1F4FA0 前後）とベストの色も写真による。

[^wp-patrol]: Wikipedia「パトロールカー」版 111081888

[^wp-crown]: Wikipedia「トヨタ・クラウン」版 110951464

[^wp-shirobai]: Wikipedia「白バイ」版 107780268

[^wp-rider]: Wikipedia「白バイ隊員」版 111039227

[^wp-cb1300]: Wikipedia「ホンダ・CB1300スーパーフォア」版 109756985

[^commons-patrol]: Wikimedia Commons の現行パトカー写真

[^commons-shirobai]: Wikimedia Commons の白バイ写真

[^commons-crown]: Wikimedia Commons の 15代目クラウン前後の写真

[^agy-job]: テクスチャ制作の委譲

[^build-run]: 生成とプレビューの実測
