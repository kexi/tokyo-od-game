---
type: Reference
title: ナビの目的地の一覧（23 区の駅・名所・注目の目的地）を OSM から作る
description: 目的地の検索で使う public/data/destinations.json（4,183 件、360 KB）を、OSM の関東抽出から scripts/destinations.ts で作る方法。駅は名前と場所ごとに 1 件へまとめ事業者を添え（490 駅）、名所は wikidata の付いた寺社・公園・博物館・競技場・橋・官公庁などを wikidata ごと・名前ごと・内側の部分ごとにまとめた。位置は面積重心で、湾や川の上に落ちた橋・海浜公園は自身の区内の点へ寄せ、区外の公園は落とす。注目の目的地 29 件を名前とタグで OSM の実物に結び付けた結果（全件解決）、入れなかったものとその理由、OSM の名前・wikidata の落とし穴（浅草寺のキリル文字、本殿に付いた明治神宮の id、橋の上の道路の id）。
tags: [roads, licensing]
status: draft
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T03:10:00Z }
verified:
  - { by: process:vitest, at: 2026-10-05T03:04:00Z }
  - { by: claude-opus-5-5/1m, at: 2026-10-05T03:08:00Z }
sources:
  - id: osm
    resource: https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf（.cache/osm の取得分。ヘッダの複製時刻 2026-10-03T20:20:50Z）
    title: OpenStreetMap 関東の抽出（ODbL 1.0、© OpenStreetMap contributors）
  - id: estat
    resource: public/data/areas.json（e-Stat 国勢調査 令和2年 小地域境界、東京都）
    title: 23 区の外形と区の判定に使った町丁境界
    author: 総務省統計局
  - id: survey
    resource: 23 区の箱の候補（wikidata・wikipedia・駅・tourism・place などのタグを持つ node 21,692・way 26,062・relation 5,334）を使い捨てのダンプ（scratchpad/dump.mts）に書き出し、区内の件数をタグごとに数え、注目の目的地の候補を名前で引いて全タグを目で確かめた（2026-10-05 JST）
    title: タグの実態調査
    author: claude-opus-5-5/1m
  - id: build-run
    resource: just destinations を 2 回実行（M2 Max。161 s・最大 RSS 1.33 GB と 141 s）し、2 回の出力のバイト一致を cmp で確認（SHA-256 f3e95f4f…6172）
    title: 生成と再現性
    author: claude-opus-5-5/1m
  - id: unit-tests
    resource: tests/destinations.test.ts（14 件）
    title: 出力の検査（全件が区内・注目の 29 件・重複なし・並び・大きさ・東京駅/国会議事堂/羽田空港/東京タワー/スカイツリーの位置）と抽出規則の単体テスト
---

# 何のためのデータか

ナビの「目的地」の検索（src/main.ts・src/game/missions.ts）が探す場所の一覧。それまでゲームが持っていた場所は、都のオープンデータの POI（駅は都営だけ、名所は品川・台東に偏る）、案内標識の表示地名 204 件、モデルのあるランドマーク 3 件だけで、国会議事堂・東京ドーム・JR やメトロや私鉄の駅が無かった。

- 生成: `just destinations`（`pnpm exec tsx scripts/destinations.ts`）。OSM は `just regs` がキャッシュした `.cache/osm/kanto-latest.osm.pbf` を読む（無ければ止まる。再ダウンロードはしない）
- 読み込み: `src/game/destinations.ts` の `loadDestinations()`（zod で検査、`import.meta.env.BASE_URL` 基準で fetch、失敗は `data_load_failed` を warn して null）と `expandDestinations()`

# ファイルの形

```json
{ "source": "© OpenStreetMap contributors（ODbL 1.0）。…", "generatedAt": "2026-10-03T20:20:50Z",
  "kinds": { "station": "駅", "airport": "空港", … },
  "items": [[kind, lat, lon, name, name_en|null, ward|null, featured(0|1), note|null], …] }
```

- `generatedAt` は実行時刻ではなく PBF ヘッダの `osmosis_replication_timestamp`（データの時点）。同じ抽出からは同じバイト列になる[^build-run]
- 並びは kinds の順 → 名前（UTF-16 の符号単位順）→ 緯度 → 経度。1 件 1 行で書く（JSON として有効なまま、作り直したときの差分が読める）
- 緯度経度は小数 6 桁
- `name`: 駅は「東京駅」のように「駅」を付ける（OSM の駅名は「東京」。施設の「国立競技場」と駅の「国立競技場駅」が別の名前になる）。名所は OSM の `name`。ただし `name` にキリル文字などの外国の文字が混じるとき、または日本語を含まず `name:ja` があるときは `name:ja`
- `name_en`: 駅は OSM の `name:en` のうちマクロンの無い綴りを優先（「Tōkyō」より「Tokyo」）、最多のものに「 Station」を付ける。名所は代表の `name:en`。無ければ null（4,183 件中 2,630 件にある）
- `note`: 駅は事業者の略称を「・」でつないだもの（「JR東日本・東京メトロ・東急・京王」。operator が無ければ network、どちらも無い 35 駅は null）。名所は他の呼び名（official_name・alt_name・name:ja など日本語のもの最大 3 つ、40 字まで）。注目の目的地で表示名を変えたものは元の OSM の名前がここに入る（羽田空港 → 「東京国際空港」）
- `ward` は e-Stat 町丁境界で引いた区。全件が区内なので実際には null は無い[^unit-tests]

# 種類と件数（2026-10-03 の抽出）

| kind       | 表示（ja）       | 件数  | 規則（名前必須）                                                                                                                       |
| ---------- | ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| station    | 駅               | 490   | `railway=station`、または `railway=halt` かつ `public_transport=station`。下の「入れなかったもの」を除く                               |
| airport    | 空港             | 1     | `aeroway=aerodrome`（東京国際空港）                                                                                                    |
| government | 官公庁           | 97    | wikidata あり、`government=*`・`office=government`・`amenity=townhall`・`amenity=courthouse`（区役所・省庁・裁判所・運転免許試験場）   |
| temple     | 寺院             | 1,405 | wikidata あり、`amenity=place_of_worship`（または `landuse=religious`）+ `religion=buddhist`                                           |
| shrine     | 神社             | 555   | 同 `religion=shinto`                                                                                                                   |
| church     | 教会             | 15    | 同 `religion=christian`                                                                                                                |
| worship    | 宗教施設         | 11    | 同 その他の宗教（モスクなど）                                                                                                          |
| zoo        | 動物園           | 6     | `tourism=zoo`（wikidata 不要）                                                                                                         |
| aquarium   | 水族館           | 9     | `tourism=aquarium`（同）                                                                                                               |
| theme_park | 遊園地           | 12    | `tourism=theme_park`（同）                                                                                                             |
| museum     | 博物館・美術館   | 373   | `tourism=museum`（wikidata 不要。無いものも刀剣博物館・凧の博物館など実在の館だった[^survey]）、`tourism=gallery` は wikidata ありだけ |
| theatre    | 劇場             | 63    | wikidata あり `amenity=theatre`                                                                                                        |
| hall       | ホール・展示場   | 14    | wikidata あり `amenity=arts_centre/exhibition_centre/conference_centre/events_venue/concert_hall`                                      |
| stadium    | 競技場・体育館   | 41    | wikidata あり `leisure=stadium/sports_centre/sports_hall` または `building=stadium`                                                    |
| tower      | タワー           | 5     | wikidata あり `man_made=tower/communications_tower`                                                                                    |
| bridge     | 橋               | 153   | wikidata あり `man_made=bridge`、または橋の上の道路で `bridge:wikidata` があるか、名前自体が橋（…橋・…ブリッジ）で wikidata があるもの |
| crossing   | 交差点           | 2     | 注目の目的地だけ（渋谷スクランブル交差点・銀座四丁目交差点）                                                                           |
| market     | 市場             | 7     | wikidata あり `amenity=marketplace`、または名前が「…市場」の landuse                                                                   |
| shopping   | 商業施設・商店街 | 98    | wikidata あり `shop=mall/department_store`、`landuse=retail/commercial`（amenity・office・healthcare の無いもの）、商店街の道路        |
| park       | 公園             | 280   | wikidata あり `leisure=park`                                                                                                           |
| garden     | 庭園             | 18    | wikidata あり `leisure=garden`                                                                                                         |
| historic   | 史跡             | 124   | wikidata か wikipedia のある `historic=*`                                                                                              |
| attraction | 名所             | 14    | wikidata あり `tourism=attraction`                                                                                                     |
| viewpoint  | 展望地点         | 2     | wikidata あり `tourism=viewpoint`                                                                                                      |
| area       | 地区             | 388   | wikidata あり `place=suburb/quarter/locality`、と「…丁目」でない `place=neighbourhood`（原宿・八重洲・秋葉原）                         |

合計 4,183 件、359,763 バイト[^build-run]。一つの物が複数の種類に当たるとき（浅草寺は place_of_worship と attraction）は表の上の種類を採る。

# 位置の決め方

- node はその点。閉じた way と multipolygon は外周（inner を除く）の面積重心。relation の外周は部材の way を端点でつないで輪にしてから計算する（`joinRings`）。閉じない way（橋の車道）は長さで重み付けした中点
- 駅は同じ名前の駅オブジェクトを 1 km の単連結でまとめ、駅の node の平均（node が無ければ面の重心）。浅草（4 社、640 m に散る）・早稲田（都電の停留場とメトロ、690 m）も 1 件。23 区内で同じ名前の別の駅が 1 km 以内にある例は無かった[^survey]
- **区外に落ちた重心**: e-Stat の町丁境界は海と大きな川の水面を含まないので、湾をまたぐ橋・境界の川の橋・海浜公園の重心は区外に出る。その物自身の点のうち区内のものの中で重心に最も近い点へ寄せる。橋は区内に足が一つでもあればよい。面は頂点の半分以上が区内のときだけ（水元公園・お台場海浜公園は残り、戸田公園・みさと公園・川崎市の地区は落ちる）。寄せたのは 36 件で、レインボーブリッジ 698 m（芝浦側）、東京ゲートブリッジ 957 m（若洲側）が大きい[^build-run]
- 羽田空港は空港の relation（D 滑走路の島を含む）の面積重心で、ちょうど第 1 ターミナル付近（35.5492, 139.7842）に落ちた。ターミナルを選ぶ規則は入れていない

# 同じ場所をまとめる規則

1. **wikidata ごと**: 同じ id の物を 1 件にする（皇居外苑の公園 way・境界 relation・place node）。代表は「日本語の名前」→「種類の順」→「名前が日本語版 Wikipedia の記事名と同じ」→「id がある」→ relation・way・node の順 → 古い id。位置と名前は代表から
2. **借り物の id**: 同じ id の物が 2.5 km より離れていれば、ブランドや道路の id とみなしてまとめず、id 抜きのタグで資格を判定し直す（今回は 1 件）
3. **同じ名前**: 種類を問わず 400 m 以内の同名は 1 件（博物館の node と、史跡として書かれた建物）。地区（area）が絡むときは 1.5 km（東大井の pin が 2 つ 1.3 km 離れていた）
4. **内側の部分**: wikidata の無い物が、同じ種類の場所の外周の内側にあれば、その場所に含める（上野動物園の東園・西園・子ども動物園）
5. **注目の目的地の改名の後**: 表示名を変えた注目の目的地と同名の近くの物は落とす（空港を「羽田空港」にしたので、町の「羽田空港」は 223 m で重なる）

# 注目の目的地（featured）

`FEATURED`（scripts/destinations.ts）に、表示名と「名前 + その場所であることを示すタグ」の条件で書いた。座標は書いていない。全 29 件が解決した[^build-run]。東京タワー・東京スカイツリー・東京駅は public/data/landmarks.json のモデルもある（UI がまとめる）。

| 表示名                 | 種類       | OSM（まとめたもの全部）                                            | メモ                                                                                                                       |
| ---------------------- | ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 東京駅                 | station    | n2149761647, n11329319854, n11329319855, n13731947846, n6193732167 | JR 東日本（京葉線ホームの node 含む）・JR 東海・メトロ。node の平均は丸の内駅舎の約 90 m 南西                              |
| 国会議事堂             | government | r3361370                                                           | `government=parliament`                                                                                                    |
| 皇居外苑               | park       | w675408602, r3551852, n2700294306                                  |                                                                                                                            |
| 東京都庁               | government | r11045959                                                          | `amenity=townhall` の敷地。第一・第二本庁舎は別の行                                                                        |
| 浅草寺                 | temple     | w173154847                                                         | `name` がキリル文字混じり、`name:ja` を使う                                                                                |
| 雷門                   | historic   | w173154849（+ 町名の n12578731071）                                | 浅草寺と両方を注目にした                                                                                                   |
| 明治神宮               | shrine     | w469908925（+ 本殿 r3603909）                                      | 本殿の relation に神宮の wikidata が付いている                                                                             |
| 東京ドーム             | stadium    | w20028328                                                          |                                                                                                                            |
| レインボーブリッジ     | bridge     | r18497742, w316305908                                              | 中央は海上。芝浦側の区内の点へ 698 m                                                                                       |
| 渋谷スクランブル交差点 | crossing   | n291758776                                                         | OSM の name は信号名「渋谷駅前」、alt_name と `crossing:scramble=yes` で特定                                               |
| 上野恩賜公園           | park       | r5413419, r18158889, n8373681407                                   | OSM の name は「上野公園」、official_name で特定。name:en が「Ueno Zoological Gardens」と誤っているので英語は「Ueno Park」 |
| 羽田空港               | airport    | r17864987                                                          | name は「東京国際空港」、alt_name で特定。英語「Haneda Airport」                                                           |
| 秋葉原                 | area       | r18158693, n4881037222                                             | 駅ではなく地区（wikipedia ja:秋葉原）。台東区秋葉原の町の重心で、秋葉原駅の約 400 m 北                                     |
| 六本木ヒルズ           | shopping   | w568436245（+ n4149454389）                                        | 同じ id の誤った node（「Roppongi hills - Kojipro?」office=government）を代表にしない                                      |
| 東京ビッグサイト       | hall       | r7743566                                                           | 敷地は landuse=commercial、node は community_centre。種類は hall を指定。同名の駅を除外                                    |
| お台場海浜公園         | park       | r13893938                                                          | 重心は海上、区内の点へ 117 m                                                                                               |
| 増上寺                 | temple     | w744348814                                                         |                                                                                                                            |
| 歌舞伎座               | theatre    | r4859313                                                           |                                                                                                                            |
| 日本武道館             | stadium    | w43896730                                                          |                                                                                                                            |
| 国立競技場             | stadium    | w499552719, r10071391                                              | OSM は建設時の名「新国立競技場」と命名権の「MUFGスタジアム」。英語「Japan National Stadium」                               |
| 両国国技館             | stadium    | w76187058                                                          |                                                                                                                            |
| 東京ゲートブリッジ     | bridge     | w150870020, w150870021                                             | 車道の way に wikidata が無く、橋の面も無い。名前で特定し、若洲側の区内の点へ 957 m                                        |
| 豊洲市場               | market     | r9113166                                                           | `type=site` の relation                                                                                                    |
| 新宿御苑               | park       | w15772074                                                          |                                                                                                                            |
| 迎賓館赤坂離宮         | historic   | r6109212                                                           | OSM の name は「迎賓館」、wikipedia ja:迎賓館赤坂離宮 で特定                                                               |
| 日本橋                 | bridge     | w550689172（+ 地区 n12598508810）                                  | `man_made=bridge`                                                                                                          |
| 銀座四丁目交差点       | crossing   | n6346639685                                                        | `tourism=attraction`（wikidata なし）                                                                                      |
| 東京タワー             | tower      | r4247312                                                           | landmarks.json のモデル位置から 150 m 以内（テストで照合）                                                                 |
| 東京スカイツリー       | tower      | w288269147                                                         | 同上                                                                                                                       |

政治的に争いのある場所は注目にしていない（靖国神社は注目にせず、wikidata のある神社の 1 件として検索には出る）。

# 入れなかったもの

| 何                                                                                                                     | 理由                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `usage=training` の駅（JR 東日本 蒲田トレーニングセンターの「大田」「志茂田」）                                        | 訓練用の模擬駅                                                                  |
| `station=funicular` の halt（飛鳥山公園のアスカルゴ「山頂駅」「公園入口駅」、台東区の「駐車場」「本堂」「寺務所」）    | 鉄道の駅ではない                                                                |
| 貨物駅（東京貨物ターミナル）、名前が「…改札口」「…出入口」の駅                                                         | 旅客の駅でない、駅の一部                                                        |
| `railway` の無い `public_transport=station`（44 件）                                                                   | 駅舎の建物・路線別の構内・出入口で、どれも駅の node と重複                      |
| wikidata の無い寺社・公園・劇場・競技場・名所など                                                                      | 入れると数と大きさが膨らむ。wikidata を「誰かが書いた場所」の目安にした         |
| `amenity=community_centre`                                                                                             | wikidata があっても町会会館・地区センターが多い（東京ビッグサイトは注目で救う） |
| 大使館（`office=diplomatic`・`amenity=embassy`）、成人向けの店と赤線地区（`amenity=brothel` 等、name:en に Red Light） | 目的地として出さない                                                            |
| 「…丁目」の `place=neighbourhood`                                                                                      | 町の下の区画で、地区名として探す単位ではない                                    |
| 頂点の半分以上が区外の面（戸田公園・みさと公園・川崎市中原区など）                                                     | 隣の市の場所                                                                    |
| 大学・病院・学校・ホテル・郵便局・警察署など                                                                           | 依頼の種類に無く、件数と大きさを抑えるため                                      |

# 出典表示

ODbL 1.0 の抽出データ。public/data/destinations.json 自体がゲームと一緒に配られる（派生データベースの提供）。`source` に「© OpenStreetMap contributors（ODbL 1.0）」と抽出元を書いた。ゲーム内の出典表示（src/game/credits.ts）は OSM を「信号機」「案内標識」の節でだけ挙げているので、目的地の一覧の行を足す必要がある（別の作業者の担当のため、ここでは書いていない）。

# 落とし穴

- **`name` が日本語とは限らない**: 浅草寺の way は `name=Храм Сенсодзи 金龍山 浅草寺`。`name:ja` を常に優先すると、今度は東京ビッグサイトが `name:ja=東京国際展示場` になる。外国の文字が混じるときと日本語を含まないときだけ `name:ja` にした
- **wikidata が別の物に付いている**: 明治神宮の id は本殿の relation にも、六本木ヒルズの id は誤った office=government の node にも付いていた。relation 優先の代表選びでは「本殿」「官公庁」になった。記事名と同じ名前・日本語の名前を優先して直した
- **橋の上の道路の wikidata は道路のもの**: `bridge:name=戸田橋` の way の wikidata は中山道、`bridge:name` の付いた有明通り・環二通りも同じ。最初の規則（`bridge:name` が橋の名前なら id を橋のものとみなす）では有明通り・環二通りなどの道路が橋として入った。名前自体が橋で `bridge:name` が違わないとき、または `bridge:wikidata` のときだけにした
- **featured の一致で駅を拾う**: 「東京ビッグサイト」はゆりかもめの駅名でもあり wikidata もある。施設の条件に `!t.railway` を入れ、施設の注目の目的地は駅の行に結び付けない
- **重心の区外判定を頂点で救うと、隣の市が入る**: 最寄りの区内頂点へ寄せるだけでは、境界に頂点が触れている戸田公園・川崎市の地区（中原区・宮内・二子）が区内の物として入った。面は頂点の半分以上が区内であることを条件にした
- **`readWays(file, () => true)` は 5 GB 使う**: relation の部材 way を引くのに全 way を読むと、調査用のダンプで最大 RSS 5.3 GB。id を先に読んで要らない way を飛ばす `readWaysById` を scripts/osm-pbf.ts に足し、1.33 GB になった[^build-run]

# 仮定・未確認

- ゲームの画面（目的地の一覧・検索・ナビの到着）では確かめていない
- OSM の名前・事業者の網羅は OSM 次第（新宿駅の 5 つの node のうち 1 つに operator が無く、注記に京王が出ない）
- 名所の「有名さ」は wikidata の有無だけで決めた。寺院 1,405 件が多いかどうかは遊んで判断する
- 重心の位置が道路から遠い場所（大きな公園・空港）での到着は、ナビ側でルートの終点を到着とする作り（src/main.ts）に任せている
