---
type: Reference
title: Blender CLI での路上キャラクター（警察官・ベビーカー・自転車）
description: 歩行者と同じ骨格で動く制服警察官、ベビーカー、自転車（ママチャリとクロスバイク）を bpy で作った手順。服制・手信号・自転車の法令の読み方、押す人と乗る人の姿勢の求め方、glb を軽くする工夫と、Blender CLI で踏んだ落とし穴をまとめる。
tags: [rendering, traffic-law, licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T13:45:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T13:40:00Z }
sources:
  - id: fukusei
    resource: https://laws.e-gov.go.jp/api/2/law_data/331M50400000004 （令和7年4月1日施行の改正を反映した版）
    title: 警察官の服制に関する規則（昭和31年国家公安委員会規則第4号）第3〜5条・別表
  - id: seirei
    resource: https://laws.e-gov.go.jp/api/1/articles;lawId=335CO0000000270;article=4 （article=5・18 も同様に取得）
    title: 道路交通法施行令 第4条（手信号の意味）・第5条（灯火による信号の意味）・第18条
  - id: fukushima
    resource: https://www.police.pref.fukushima.jp/06.koutuu/-teshingo/teshingo.pdf
    title: 福島県警察「警察官による手信号について」（両腕を水平・両腕を垂直に上げた図）
  - id: okinawa
    resource: https://www.police.pref.okinawa.jp/docs/2015030700200/file_contents/24.pdf
    title: 沖縄県警察の服装に関する訓令（交通整理時の白色帽子覆い・警笛つりひも・夜光チョッキ）
  - id: kumamoto
    resource: https://www.pref.kumamoto.jp/uploaded/attachment/194177.pdf
    title: 熊本県警察の服制に関する訓令（帯革附属品の着装位置、警笛の約60cmの黒ひも）
  - id: kisoku
    resource: https://laws.e-gov.go.jp/api/1/articles;lawId=335M50000002060;article=9_2_2 （article=9_4 も同様に取得）
    title: 道路交通法施行規則 第9条の2の2（普通自転車の大きさ等）・第9条の4（反射器材）
  - id: keishicho-bicycle
    resource: https://www.keishicho.metro.tokyo.lg.jp/kotsu/jikoboshi/bicycle/rule.html
    title: 警視庁「自転車の交通ルール」（前照灯は白色又は淡黄色、前方10m）
  - id: sg
    resource: https://www.sg-mark.org/wp-content/uploads/2025/06/S0001-06公開版.pdf
    title: ベビーカーの SG 基準 CPSA 0001（2025-06-01 改正、A 形・B 形の定義）
  - id: photos
    resource: Wikimedia Commons の "Two police officers near Shibuya.jpg"（CC BY-SA 4.0）、"Police in covid masks - Akihabara - Aug 12 2021 05-55PM.jpeg"（CC BY 4.0）、"Tokyo Metropolitan Police patrolling around Okubo Park.jpg"（CC BY-SA 4.0）、"Stroller&baby,japan.JPG"（CC BY 3.0）、"BabyCarriage 20210711 130332.jpg"・"BabyCarriage 20210711 130548.jpg"（CC BY-SA 4.0）
    title: 形の参考にした写真（見るだけで、モデルにもテクスチャにも取り込んでいない）
  - id: build-run
    resource: scripts/blender/{police,stroller,bicycle}.py を M2 Max で実行し、出力 glb のバイト数・三角形数・glTF JSON（ノード・材質・extras）を照合。プレビュー（Cycles CPU 32 サンプル）を目視で確認
    title: 生成と出力の実測
    author: claude-opus-5-5/1m
---

# 構成

| モデル             | スクリプト                                                              | glb       | 三角形                                                               | 主なノード                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 制服警察官         | `scripts/blender/police.py` + `scripts/textures/police_textures.py`     | 175,984 B | 計 3,947（一度に表示するのは地域 2,817・交通整理 3,315・夏服 2,757） | human.glb と同名の Torso / Head / HairShort / UpperArm・Forearm・Thigh・Shin（L/R）、Cap、変種 CapCover / Vest / Tie / UpperArmShort・ForearmBare（L/R） |
| ベビーカー（A 形） | `scripts/blender/stroller.py` + `scripts/textures/stroller_textures.py` | 100,228 B | 3,824                                                                | Stroller → StrollerCanopy・StrollerCasterL/R（→ FrontWheelL/R）・RearWheelL/R・StrollerBaby                                                              |
| 自転車             | `scripts/blender/bicycle.py` + `scripts/textures/bicycle_textures.py`   | 89,920 B  | ママチャリ 5,194・クロスバイク 3,824                                 | `<V>Bike` → `<V>Steer`（→ FrontWheel）・RearWheel・Crank（→ PedalL/R）・CityStand（V = City / Sport）                                                    |

- ゲーム座標（+Y 上、+Z 前、+X がモデルの左）で組み、`export_yup=False` で書き出す。救急車や歩行者と同じ。[^build-run]
- 3 本とも同じ入力から同じバイト数の glb になることを確かめた（再生成で 175,984 / 100,228 / 89,920 B）。書き出しだけなら 1 本 20〜35 秒。
- 押す人・乗る人・手信号の角度は glTF の extras に入れた。GLTFLoader は scene の extras を `gltf.scene.userData`、ノードの extras を各 Object3D の `userData` に入れる。
  - 警察官: `userData.police`（scene）。姿勢・変種・色。
  - ベビーカー: `userData.push`（scene）。ハンドル・手・人の原点・腕の角度・車輪半径。
  - 自転車: `CityBike` / `SportBike` ノードの `userData.bicycle`。車輪半径・ギア比・乗車姿勢・ペダル 1 周 24 点の脚の角度。

# 警察官

## 服装（服制規則の別表から）

- 着用期間（第3条）: 冬服・冬活動服 12/1〜3/31、合服・合活動服 4/1〜5/31 と 10/1〜11/30、夏服 6/1〜9/30。警察本部長が変えられる。[^fukusei]
- 色（別表）: 冬服上衣 濃紺色、合服上衣 紺色、活動服は各上衣と同色、夏服上衣 水色、夏服ズボン 藍色、ネクタイ 藍ねず色、ベルト・帯革・警棒・手錠・靴は黒色、手袋は白色。
- 活動服（第5条で制服上衣に代えて着られる）: 前立てに桜葉ボタン 4 個、両胸にひだ・蓋付きポケット、前裾ベルトと伸縮性の後裾ベルト。モデルの既定はこの合活動服（紺）で、白いワイシャツとネクタイが襟の V に見える。
- 帯革の附属品: 拳銃入れは右腰、手錠入れと警棒つりは左後部（「左手を垂直に垂れたとき、警棒が左腕の後方になる」）。警笛には約 60cm の黒ひもを付ける。[^kumamoto]
- 交通整理・取締りの服装: 制服・制帽に、白色（夜光）帽子覆い・警笛つりひも・白色警笛を着装し、必要なら夜光チョッキ。[^okinawa]
- 階級章と識別章は左胸部（別表 備考十）。形は汎用の板にした。

## モデルの作り

- 骨格は human.py と同じ（肩 (±0.235, 1.40)、肘はその 0.27 下、股関節 (±0.095, 0.86)、膝はその 0.42 下で z +0.012）。スクリプトは書き出し前に human.glb のノード位置と照合し、ずれていれば止まる。
- 材質名 Skin / Shirt / Pants / Hair は human.glb と同じにした。src/world/human.ts の色付け（名前で `material.color` を差し替える）がそのまま効く。
  - Shirt / Pants は白基調の画像に baseColorFactor（既定は紺 #222E4E）を掛ける。夏服は Shirt を水色 #9CC2E8、Pants を藍色 #24375A に変えるだけでよい。
  - Hands は白（白手袋）。素手にするなら肌の色を入れる。
  - Kit は帯革・金具・徽章・制帽をまとめた 4×4 のアトラス（256px）。Vest と Reflective（反射帯と帽子覆い）は夜に emissive を上げる想定で分けた。
- 変種は別ノードにして、表示を切り替える。glTF にはノードの表示・非表示を書けないので、ゲーム側で必ず隠す。
  - 地域（既定）: Cap・Tie・長袖の UpperArm/Forearm。
  - 交通整理: さらに Vest（夜光チョッキ）と CapCover（白色帽子覆い）。
  - 夏服: Tie を隠し、長袖の腕の代わりに UpperArmShort（半袖）と ForearmBare（素肌）を出す。
- 肩の関節に球（三角筋）を付けた。腕を横に 90°・180° 上げても肩に隙間が出ない。
- 旭日章・組織名・「POLICE」の文字は描かない。帽章は金色の楕円、右袖のエンブレム位置は金枠の無地パッチにした。
- 形とプロポーションは Wikimedia Commons の写真を見て合わせた。写真そのものはどこにも取り込んでいない。[^photos]

## 手信号の姿勢（施行令第4条）

| extras の名前      | 腕の回転                                         | 第4条の意味                                                                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `signalHorizontal` | UpperArmL `rotation.z = +π/2`、UpperArmR `−π/2`  | 腕を横に水平にあげた状態。腕に平行する交通は青、腕に対面する交通（警察官の正面・背面）は赤 |
| `signalVertical`   | UpperArmL `+π`、UpperArmR `−π`                   | 腕を垂直にあげた状態。垂直にあげる前に水平だった腕に平行する交通は黄、対面する交通は赤     |
| `rest`             | すべて 0                                         | 水平の後に腕をおろし、身体の向きを変えていなければ、水平と同じ意味                         |
| `stopRight`        | UpperArmR `rotation.x = −1.50`、ForearmR `−0.10` | 右折車への停止の合図（法令の表ではなく、福島県警の資料の図）                               |

- 図では両腕をそろえて上げている。[^fukushima]
- 水平から垂直へ上げる途中と、垂直から水平へ戻す途中も「垂直」に含まれる（黄）。現示を切り替えるときは、身体を 90° 回してから水平に戻す。
- 黄・赤の手信号の停止位置は、停止線などが無い交差点では「警察官等の 1 メートル手前」。[^seirei]
- 灯火による信号（第5条）では「横に振る」が青、「頭上にあげる」が黄にあたる。今回は灯火（誘導灯）を作っていない。
- 回転は Z 軸か X 軸のどちらか一方だけにした。three.js（XYZ 順）と Blender のオイラー角の掛け順の違いが効かない。

# ベビーカー

- SG 基準の A 形は、生後 1 か月から最長 48 か月まで使える形で、B 形はおすわりができる 6〜7 か月から。公開版ではリクライニング角度が伏せ字になっていて読めない。[^sg]
- 寸法: 幅 0.532m、長さ 0.83m、幌の頂点で高さ 1.016m。ブランド名・ロゴは描かない。
- ハンドルの中心線は、歩行者の腕を UpperArm `rotation.x = −0.30`、Forearm `−0.80` にしたときの手の中心（人の原点から y 0.9992、z +0.3605）から計算して置いた。両手は (±0.235, 0.9992, −0.44) を握り、人の原点はベビーカーの (0, 0, −0.8005)。
- 脚は animateHuman のまま歩かせ、腕だけその後で上書きする（傘と同じやり方）。
- 車輪は `rotation.x += 距離 / 半径` で前へ転がる。前は半径 0.075 の双輪、後ろは半径 0.09。キャスターは `rotation.y` で旋回し、トレールは 0.04m。幌は `rotation.x` が 0 で開き、−1.15 で畳んだ形になる。

# 自転車

## 法令

- 普通自転車は長さ 190cm・幅 60cm を超えない（施行規則第9条の2の2）。2 台ともこの中に収めた（ママチャリ 1.845 × 0.556m、クロスバイク 1.716 × 0.580m）。[^kisoku]
- 反射器材は「夜間、後方百メートルの距離から…前照灯で照射したときに、その反射光を照射位置から容易に確認できる」もので、色は「橙色又は赤色」（施行規則第9条の4）。夜間に反射器材の無い自転車は運転できない（法第63条の9第2項、尾灯を点けていれば除く）。
- 前照灯は法第52条第1項と施行令第18条第1項第5号で「公安委員会が定める灯火」とされる。東京では「白色又は淡黄色で、夜間前方10メートルの距離にある交通上の障害物を確認することができる光度」。東京都道路交通規則の原文は今回読めていない。[^keishicho-bicycle]

## モデルとアニメーション

- 材質: HeadLamp（淡黄白、emissive）、Reflector（後部の赤）、PedalReflector（ペダルの橙）を独立させ、夜だけ光らせる。CityPaint / SportPaint と Basket（金網、alphaMode MASK）は色を変えられる。
- 車輪: `rotation.x = +距離 / R`（R はママチャリ 0.332、クロスバイク 0.339）。
- クランク: 車輪の角度をギア比（33T×14T = 2.357、38T×17T = 2.235）で割る。0 は右クランク（−X）が前に水平の状態。ペダルは `rotation.x = −crank` で水平を保つ。
- ハンドル: Steer の `rotation.x`（キャスター角）は固定のまま、`rotation.y` に切れ角を入れる。three.js の Euler XYZ は Rx·Ry·Rz なので、ステアリング軸のまわりに回る。かご・前の泥除け・前照灯・前輪が一緒に回る。
- 両立スタンド: `rotation.x = 1.62` が畳んだ状態、0 が下ろした状態。下ろすと後輪が 0.053m 浮くので、前輪の接地点まわりに車体を 0.048 rad 傾ける。
- 乗る人: 人の原点を `rootOffset` に置き、`body.rotation.x = bodyLean`（ママチャリ 0.17、クロスバイク 0.45）とする。腕は左右同じ角度で、脚は extras の 24 点の表を補間するか、矢状面の 2 リンク IK をその場で解く。膝が常に曲がる範囲（ママチャリで 38〜112°）にサドルを置いた。身長倍率は 1 が前提。

# 落とし穴

1. **human.py の胴の UV は、右脇の 1 列で画像を丸ごと逆向きに貼っている**。`torso_uv` が θ = 1.5π の頂点を常に u = 1.0 にするので、その次の面は u が 1.0 から 0.0625 へ戻る。取り込んだ human.glb で、u の幅が 0.5 を超える Shirt の三角形が 12 枚あった（police.glb では 0 枚）。police.py のロフトは、継ぎ目から面ごとに u を展開して避けた。human.py は担当外なので直していない。
2. **human.py の前腕は袖口が開いたまま**。腕を前に出すと、筒の中が手首から見える（ベビーカーのプレビューで確認）。police.py では袖口とむき出しの前腕の端を閉じ、手の中まで伸ばした。
3. **Blender 5.2 の glTF 書き出しは、`use_backface_culling` が False（新規材質の既定値）だと `doubleSided: true` を書く**。歩行者と同じく、片面の材質では明示的に True にする。
4. 画像 → Mix（MULTIPLY、もう一方は定数色）→ Base Color とつなぐと、baseColorFactor と baseColorTexture の両方が書き出される（Blender 5.2 で JSON を見て確認）。白基調の画像のまま、既定色を glb に持たせられる。
5. シーンやオブジェクトのカスタムプロパティは、`export_extras=True` で glTF の extras になる。入れ子の dict・数値のリスト・文字列のリストは、そのまま JSON のオブジェクトと配列になる（5.2 で確認）。mathutils は単精度なので、数値は丸めてから入れる。
6. glTF の取り込みは Y 上 → Z 上に変換する（glTF の (x, y, z) が Blender の (x, −z, y) になる）。部品は単位回転のまま関節の位置に来る。プレビューで歩行者を使うときは、−90°X の Empty の子にすれば元の座標に戻る。X 軸まわりの関節の回転はこの変換と可換なので、ゲームと同じ角度がそのまま使える。取り込んだ直後は rotation_mode が QUATERNION なので、XYZ に変えてから角度を入れる。
7. Blender の XYZ オイラーは、行列にすると Rz·Ry·Rx で、three.js（Rx·Ry·Rz）と掛け順が逆。2 軸以上を回すプレビュー（ハンドルを切った自転車）は行列を直接組んだ。
8. 書き出しは元の PNG のバイト列をそのまま埋め込む。白基調のテクスチャを単チャンネル（mode L）で保存し、細かいノイズを量子化したら、警察官の glb が 393KB から 176KB になった。ベビーカーの布も、細かい粒のノイズで 154KB、低周波だけにして 64KB。
9. 金網のかごは、遠くでミップマップの平均アルファが 0.5（MASK の閾値）を下回ると消える。8px 周期・線幅 3px にした。
10. 子オブジェクトの `matrix_world` は、親子を付けた直後は古い。寸法を測る前に `view_layer.update()` を呼ぶ。
11. 委譲するときの指示に、自転車の条番号を誤って書いた（第9条の2・第9条の17）。正しくは第9条の2の2（普通自転車の大きさ）と第9条の4（反射器材）で、第9条の17 は夜間用停止表示器材。条番号は e-Gov の API で本文を引いてから書く。

[^fukusei]: 警察官の服制に関する規則

[^seirei]: 道路交通法施行令

[^fukushima]: 福島県警察「警察官による手信号について」

[^okinawa]: 沖縄県警察の服装に関する訓令

[^kumamoto]: 熊本県警察の服制に関する訓令

[^kisoku]: 道路交通法施行規則

[^keishicho-bicycle]: 警視庁「自転車の交通ルール」

[^sg]: ベビーカーの SG 基準

[^photos]: 形の参考にした写真

[^build-run]: 生成と出力の実測
