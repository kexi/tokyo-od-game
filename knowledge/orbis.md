---
type: Reference
title: オービス（速度違反自動取締装置）と予告看板
description: 都内のオービスの型（LH システム・H システム・ループコイル）と予告看板を公開資料で確かめた結果、OSM の 28 台から取締方向・車線・予告看板の位置を出す抽出、門型・柱型・看板の bpy モデル（788 三角形）、道路網への配置、取締方向・車線・閾値つきの判定とストロボ、踏んだ落とし穴（高架の除外、高さ込みの距離で一度も光らなかった、速度超過の記録の重複でオービスが記録できなかった、遠い看板が置かれなかった）。
tags: [traffic-law, roads, rendering, assets, licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T17:40:00Z }
verified:
  - { by: process:vitest, at: 2026-10-04T17:26:00Z }
  - { by: claude-opus-5-5/1m, at: 2026-10-04T17:30:00Z }
sources:
  - id: wp-orbis
    resource: https://ja.wikipedia.org/w/index.php?title=速度違反自動取締装置&oldid=110811451
    title: Wikipedia「速度違反自動取締装置」版 110811451（2026-08-28、CC BY-SA 4.0）
    last_modified: 2026-08-28T16:56:09Z
  - id: commons-rainbow
    resource: https://commons.wikimedia.org/wiki/File:Speed_camera_warning_sign_upon_exiting_the_Rainbow_Bridge.jpg
    title: Wikimedia Commons レインボーブリッジ出口の予告看板「スピード落せ 自動速度取締機設置路線」（2025-08-12、CC BY-SA 4.0、User:Benlisquare）
  - id: commons-lh
    resource: https://commons.wikimedia.org/wiki/File:Speed_camera_on_National_Route_51_southbound_near_Mawatashi.jpg
    title: Wikimedia Commons の門型・片持ち型の写真（国道 51 号 馬渡・坂戸、国道 16 号 若葉区 いずれも CC BY-SA 4.0 User:Benlisquare、名神 Orbis_at_Meishin.jpg CC BY-SA 3.0、岐阜県道 58 号 CC BY-SA 4.0 User:Alpsdake）
  - id: commons-other
    resource: https://commons.wikimedia.org/wiki/Category:Speed_cameras_in_Japan
    title: Wikimedia Commons Category:Speed cameras in Japan（H システム H-system.JPG と予告看板、路側の自立型 ORBIS(hokkaido).JPG、阪神高速の「速度自動監視機設置路線」、名神の「自動速度取締機設置区間」）
  - id: osm
    resource: https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf（.cache/osm の 2026-10-04 取得分）
    title: OpenStreetMap 関東の抽出（ODbL 1.0、© OpenStreetMap contributors）
  - id: osm-survey
    resource: 23 区の箱の highway=speed_camera 28 点、type=enforcement の関係 6 件、そのノードを含む way を scripts/orbis.ts と使い捨てのダンプで列挙（2026-10-05 JST）
    title: OSM の抽出結果
    author: claude-opus-5-5/1m
  - id: build-run
    resource: just orbis-model（Blender 5.2.2、M2 Max）で 2 回生成し、glb と PNG の MD5 が一致することと、Cycles のプレビュー 4 枚を目視
    title: モデルの生成
    author: claude-opus-5-5/1m
  - id: game-run
    resource: 開発ビルドを vite preview（ポート 4188）で配り、ヘッドレス Chrome で第二京浜（大田区 南馬込）・府中街道バイパス・第二京浜の 1.5 km 手前を昼と夜に撮影。第二京浜では規制 60 km/h の区間を 94 km/h で通過させ、記録が「出頭通知（オービス）」になることを確認
    title: ゲーム内での確認
    author: claude-opus-5-5/1m
  - id: unit-tests
    resource: tests/orbis.test.ts（12 件）
    title: 配置と判定の単体テスト
---

# 実物（公開資料で確かめたこと）

| 項目           | 内容                                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 撮影する超過   | 固定式は赤切符（非反則行為）の超過だけを対象にし、一般道路で 30 km/h 以上、高速道路で 40 km/h 以上（道路状況でさらに高い場合あり）。可搬式は 15 km/h 以上[^wp-orbis]                                                                                           |
| ストロボ       | 撮影の瞬間に、多くは赤色（白色のものもある）のストロボが光る。後日、所有者に出頭通知が届く[^wp-orbis]                                                                                                                                                          |
| ループコイル式 | オービスIII。路面下 5 cm に 6.9 m 間隔で 3 個のループコイルを埋め、2 回の測定が食い違えば撮影しない。撮影地点の白線、埋設跡の切り欠きや逆三角の金属板が目印[^wp-orbis]                                                                                         |
| LH システム    | 1994 年登場の柱上型オービスIII（Lk・Lx 型）。画像伝送式で、カメラとストロボの形が H システムに酷似するのでこう呼ばれる。レーダーは無い[^wp-orbis]                                                                                                              |
| H システム     | 三菱電機の RS-2000 などのレーダー式。白い四角のレドーム（「はんぺん」）。製造販売の撤退を受け、2017 年から撤去が進んでいる[^wp-orbis][^commons-other]                                                                                                          |
| 小型・可搬式   | Sensys SWSS は生活道路にも置け、予告看板は 1 枚だけ。可搬式・半可搬式は予告看板を出さない[^wp-orbis]                                                                                                                                                           |
| 予告看板       | 法令で義務付けられた標識ではない（法定外）。固定式の手前に少なくとも 2 か所、多いと 4〜5 か所。色は基本的に青だが都道府県で異なる[^wp-orbis]。都内（警視庁）の例は青地に黄の「スピード落せ」と白の「自動速度取締機設置路線」、下に組織名[^commons-rainbow]     |
| 見た目         | 門型（片持ちまたは 2 本柱）の亜鉛めっき鋼管に点検用の歩廊と手すり。車線ごとに白い箱のカメラ（前面に暗い窓と庇）と、その横に小さめのストロボの箱が来る車に向く。柱の根元に制御器の箱[^commons-lh]。北海道などには金網で囲った路側の自立型もある[^commons-other] |

確かめられなかったこと:

- 予告看板の距離。「1.5 km 手前と 200 m 手前」はこの作業の前提で、公開資料では確かめていない。Wikipedia にあるのは枚数だけ。
- 都内の設置台数と型の内訳。OSM の 28 台が全数かは分からない。
- 門型の寸法（柱の太さ・梁の高さ・箱の大きさ）。写真からの目分量である。

# データ（OSM からの抽出）

`node scripts/regulations.ts police` で `public/data/police.json` だけを作り直す（警察署・試験場は前回と同じ値になることを確かめた）。中身は `scripts/orbis.ts`。型は `src/world/orbisData.ts`。[^osm]

| 件数 | 内容                                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 28   | 23 区の箱の `highway=speed_camera`                                                                                                                                                                 |
| 22   | 道路の way 上のノード。うち 20 が一方通行の way（上下分離の片側）なので、way の向きがそのまま取締方向になる。way の外の 6 台のうち 4 台は、最寄りの way（40 m 以内）が一方通行                     |
| 3    | `type=enforcement` + `enforcement=maxspeed` の関係（`from` → `device` → `to`）。2 台は way の外にあり、関係だけが方向を持つ                                                                        |
| 12   | 首都高（`motorway` / `motorway_link`）。うち 6 台は `bridge` か `layer ≥ 1` の高架                                                                                                                 |
| 1    | `direction` の数値を持つノード（8041133763 の `direction=5`）。同じ装置の関係は南向き（183°）を示すので、数値は**カメラの向き**で、取締方向はその逆と読んだ（1 例だけ。OSM wiki は確かめていない） |
| 0    | `lanes` を持つ装置ノード（`maxspeed` は 6 台）。車線数は way の `lanes`（一方通行）か `lanes:forward/backward` から取る                                                                            |

`surveillance:type=ALPR` のノード（N システム、自動車ナンバー自動読取装置）は速度取締ではないので取り込まない。[^osm-survey]

1 台ごとの値（`OrbisEntry`）:

- `bearing`: 取締方向の方位（北から時計回り）。関係 > `direction=forward/backward` > 一方通行の way > `direction` の数値（＋180°）> 路側に立つ側（左側通行なので、装置は通る車の左）の順に決め、どれも無ければ `null`（両方向）。由来は `source`。
- `lanes`・`maxspeed`・`road`（way の `highway`）・`elevated`・`name`。
- `signs`: 予告看板の点 `[lon, lat, そこでの進行方位, 手前の距離, 装置での進行方位]`。装置から道路を逆向きにたどり、way の端では流れ込む way のうち曲がりの最も小さいもの（一方通行を守る、道路名が変わると 10° 相当の不利）を選ぶ。50° 以上曲がるか道が尽きたら止め、その先の看板は出さない。対象は `motorway`〜`unclassified` とその `_link`（`residential` は含めない）。28 台で 60 点。
- 実行は約 62 秒、最大 RSS 約 3.5 GB（関東全域の幹線の way とノード座標を読むため）。

# モデル（scripts/blender/orbis.py → public/models/orbis.glb）

ゲーム座標（+Y 上、カメラと看板の面は +Z＝来る車の方、+X は柱から車道の向こうへ）、`export_yup=False`。全 788 三角形、glb 67 KB（看板の図柄 1024 × 512 の PNG を含む）。2 回生成して MD5 が一致した。[^build-run]

| ノード        | 三角形 | 内容                                                                                                                                             |
| ------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GantryPole`  |    160 | 高さ 7.1 m の柱（根元 φ0.40 m）、ベースプレート、弦材の取付金具、電線管、根元の制御器の箱                                                        |
| `GantryBeam`  |    184 | **長さ 1**（x 0→1）の梁。下弦（φ165 mm、柱の y = `beamY` 5.6 m）、上弦、歩廊、手すり 2 段 × 前後、幅木。ゲームが車道の幅に伸ばす                 |
| `GantryPost`  |     80 | 1 組の縦材（弦の間のつなぎ、手すりの支柱、歩廊の受け）。伸ばすと太るので梁に含めず、ゲームが `postSpacing`（2 m）ごとに並べる                    |
| `LaneUnit`    |     98 | 1 車線分のカメラ（0.50 × 0.42 × 0.62 m、庇・暗い窓、撮影地点へ 12° 下向き）とストロボ（0.34 m 角）を台に載せたもの。原点は歩廊の上面、車線の中心 |
| `StrobeLens`  |      2 | ストロボの窓。`LaneUnit` と同じ座標で、同じ行列で置く。材質名 `Strobe`                                                                           |
| `PolePost`    |    144 | 狭い道の柱型（5.0 m の柱、腕 1.45 m、台、柱の制御器）。`LaneUnit` は extras `poleUnit` の位置に載せる                                            |
| `WarningSign` |    120 | 予告看板。柱（6.1 m）、腕（2.5 m）、1.8 × 0.9 m の板（面 `SignFace`、裏 `SignBack`）                                                             |

- 寸法の数値（`beamY`・`deckTop`・`postSpacing`・`poleUnit`・`board`・`boardCentre`・`cameraTilt`）はルート `Orbis` の extras。
- 看板の図柄は `scripts/textures/orbis_textures.py`（`car_textures.get_noto_font` のコミット固定・SHA-256 照合の Noto Sans JP）→ `assets/orbis/textures/warning_route.png`。都内の例にならい黄の「スピード落せ」と白の「自動速度取締機 / 設置路線」を描き、組織名（警視庁）・紋章は入れない。[^commons-rainbow]
- メーカー名・型番・警察の標章はどの部品にも描いていない。写真は形の確認だけに使い、アセットには含めていない。
- 柱型は特定の製品ではなく、門型と同じ箱を柱の腕に載せた汎用の形にした。

# ゲームでの配置（src/world/orbis.ts）

`OrbisDevices` が glb と police.json を自分で読み、`buildRoadNetwork`（再アンカー時も呼ばれる）のたびに `rebuild(graph, frame)` で置き直す。

1. **道路に合わせる**（`planSites`）: 原点から 1,300 m 以内の装置を、30 m 以内で方位の合う（|cos| ≥ 0.7）区間に寄せる。首都高の装置は `highway` の区間だけ、一般道の装置は一般道だけに合わせる。高架の装置は置かない。
2. **取締方向**: OSM の方位があればそれ。無ければ JARTIC の一方通行、さらに無ければ中心線から 2 m 以上離れた側（左側通行）、どれでもなければ両方向に 1 基ずつ。
3. **車線と型**: OSM の `lanes`、JARTIC の車両通行帯、幅員 ÷ 3.25 m の順に取り、1 車線 2.5 m 未満にはしない。その方向の車線が 2 以上なら門型、1 なら柱型。対面通行の区間は中心線から左の路端まで、一方通行は全幅を車線で割る。
4. **門型**: 左の路端 + 1 m に柱、最後の車線の 0.5 m 先まで梁を伸ばし、車線ごとに `LaneUnit` と `StrobeLens`。一方通行で梁が 12 m を超えるときは向こうの路端にも柱を立てる。柱が他の道路の車道に掛かる（交差点に登録された装置）ときは、区間に沿って ±3 m ずつ最大 30 m ずらす。柱には Rapier の円柱の当たりを付ける。
5. **予告看板**（`planWarnings`）: OSM の点を、方位の合う区間（25 m 以内）の左の路端 + 0.9 m に立てる。装置が置かれていれば、その取締方向の点だけを使う。点が無い装置は、道路網を 1,500 m と 200 m さかのぼって立てる（道路網が届かなければ立てない）。

# 判定（src/main.ts の交通法チェック）

- 200 ms ごとの交通法チェックで、前回位置 → 今の位置が装置の線（区間の中心線の点を通り進行方向に直交）を取締方向にまたいだら判定する（`crossing`）。
  - 逆向き、40 m 以上の飛び（再出現・移動）、進行方向から 45° 以上斜めの動きは数えない。
  - またいだ点の横位置から車線を求め、覆う車線（路端 −0.5 m 〜 最後の車線 +0.3 m）の外なら数えない。対面通行の対向側の半分は覆わない。
- 規制速度（JARTIC、無ければ法定速度）を、一般道で 30 km/h 以上、首都高（OSM の motorway、または地理院の高速の区間）で 40 km/h 以上超えていれば撮影する（`photographs`）。同じ装置は 15 秒に 1 回まで。
- 撮影すると、その車線の `StrobeLens` が白く光ってから赤に戻り（420 ms）、窓の前に加算合成のグローを出す。画面の赤い閃光と、後日の郵便による出頭通知（`law.notice(record, "orbis")`）は従来どおり。

# 落とし穴

1. **高さ込みの距離で、一度も光らなかった**。装置の線は y = 0、車は地形の高さ（数十 m）にあるので、`distanceTo(cur) > 60` が常に真だった。水平距離にした。
2. **速度超過の記録が先にあると、オービスが何も記録しなかった**（以前のコードから続く不具合）。通常の速度チェックは 3 秒続く超過で「速度超過」を 20 秒の間隔で 1 件だけ記録する。オービスの `law.commit` はその間隔に阻まれて `null` を返し、通知が付かなかった。手前から速度を出して近づけば必ずこうなる。阻まれたときは、30 秒以内の未検挙の速度超過を撮影した速度の区分に書き換えて通知する。第二京浜で 94 km/h（規制 60）で通過させ、「速度超過（32km/h超過）・出頭通知・オービス」になることを確かめた。[^game-run]
3. **1.5 km 手前の看板が置かれなかった**。最初は配置済みの装置からだけ看板を作っていた。道路網は周囲 3 × 3 の z16 タイル（約 1.5 km 四方）しかないので、1.5 km 手前を走るとき装置はたいてい網の外で、看板も出なかった。看板は装置ごとに、装置の配置と関係なく OSM の点から立てるようにした。
4. **高架の装置の下に門型が立つところだった**。首都高の 6 台は高架にあり、真下の一般道が 30 m 以内に入る。高架（`bridge` / `layer`）は置かず、首都高の装置は地理院の高速の区間にしか合わせない。
5. **スプライトがシェーダのコンパイルに失敗した**。ゲームの深度フォグ（`world/atmosphere.ts`）は頂点の位置 `transformed` を使うようにフォグのチャンクを書き換えているが、スプライトのシェーダにはそれが無い。グローの `SpriteMaterial` は `fog: false` にした。
6. **看板の文字が上下逆になった**（Blender のプレビュー）。glTF の v は下向きだと思って UV を書いたが、Blender の UV は v が上向きで、エクスポーターが反転する。Blender 側は v = 1 を板の上端にする。
7. 休止中のストロボの窓（照明を受けない材質）は、暗い赤（0x3a0c0c）でも夜は浮いて見えた。0x2a0909 に下げた。
8. 検証の撮影で、路端寄りに置いたカメラが白い箱（PLATEAU の建物が地理院の幅員の内側に入っている所）に入り、画面が白くなった。撮影位置を中央寄りの車線にして避けた（モデルの不具合ではない）。

# 仮定（未確認のまま決めたこと）

- 予告看板は 1.5 km と 200 m の 2 枚、板は 1.8 × 0.9 m、柱の腕で車道の上に張り出す形。距離・寸法・取付方法は確かめていない。看板は道路標識（`signs.ts` の 1.25 倍）と違い実寸で置いた（1.8 m の板は拡大しなくても読める）。
- 門型の寸法（柱 7.1 m、梁 5.6 m、箱の大きさ）と、撮影の線を門型の真下に置くこと。実物のループコイルは門型の手前にあり、撮影地点の白線も手前にある。
- 取締方向が分からない装置を両方向に置くこと（OSM の 2 台、府中街道バイパスと国道 131 号）。
- 判定に使う制限速度はゲームの規制速度（JARTIC）で、OSM の `maxspeed` は参考として残すだけにした。画面の速度標識と食い違わないようにするため。

[^wp-orbis]: Wikipedia「速度違反自動取締装置」版 110811451

[^commons-rainbow]: Wikimedia Commons レインボーブリッジ出口の予告看板

[^commons-lh]: Wikimedia Commons の門型・片持ち型の写真

[^commons-other]: Wikimedia Commons Category:Speed cameras in Japan

[^osm]: OpenStreetMap 関東の抽出

[^osm-survey]: OSM の抽出結果

[^build-run]: モデルの生成

[^game-run]: ゲーム内での確認

[^unit-tests]: 配置と判定の単体テスト
