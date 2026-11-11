---
type: Reference
title: 道路モデル（区分の述語・断面・MarkingPlan・層つき検索 P2、一般道の車線一本化・幅員補正・路肩 P8）
description: 道路再設計 P8（2026-11-11）で一般道の車線数を JARTIC ＞ OSM lanes（新設の public/data/roadlanes を相互最近傍で対応付け）＞ 1 車線 の 1 方針にし（レビュー W1 で幅員推定をやめ、全ての台数を幅員の「部屋」で検める）、車道の幅（車線 × 3.25 m ＋ 路肩 0.5 m ＋ 中央帯、幅員で頭打ち）と路肩を断面に入れ、外側線・車線境界線・停止線・車線の位置・違反判定・オービスを同じ断面に載せた（KERB_INSET を廃止、line.width の読み取りを分類）。挙動の変化の内訳、実データ 519 経路・261 走行の再計測、OSM の網羅と JARTIC との一致率、性能、多視点レビュー 3 周。以下は P2。src 全体で GSI の高速道路の kind を名指ししていた 48 か所を意味ごとの述語（src/world/roadClass.ts）に置き換え、RoadLine に source / cls / structure / level / nodeIds / section / xid / limit を後方互換で足し、車線数と幅員の窓口を laneChange.ts の resolveSection・carriagewayWidth・sectionOf に寄せ、区画線を純関数 planMarkings（src/world/roadMarkings.ts）に切り出し、RoadGraph に層（地上だけの既定、端点 ID の節点、nearestOnSurface、surfaceY）を入れた。挙動は不変（丸の内・渋谷・芝公園の凍結データで、グラフ・規制・路面の頂点・経路・自動運転・交通 AI の車線をハッシュで一致）。性能は前後で同等。レビュー（2026-11-10）の指摘で、地上の定義の一本化、層をまたぐ接続、断面と OSM の制限速度を正とする扱い、直書き禁止テストの抜け道、不変テストの実効範囲を直した。
tags: [roads, testing, traffic-law]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-10T14:00:00Z }
verified:
  - { by: process:vitest, at: 2026-11-11T03:00:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T03:10:00Z }
  - { by: process:perf-road-worker, at: 2026-11-11T01:00:00Z }
  - { by: process:perf-road-streaming, at: 2026-11-11T01:05:00Z }
  - { by: process:vitest, at: 2026-11-11T02:00:00Z }
  - { by: process:vitest, at: 2026-11-11T02:10:00Z }
  - { by: process:vitest, at: 2026-11-11T00:30:00Z }
  - { by: process:vitest, at: 2026-11-10T14:40:00Z }
  - { by: process:tsc, at: 2026-11-10T14:40:00Z }
  - { by: claude-fable/review, at: 2026-11-10T14:20:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-10T13:38:00Z }
  - { by: process:perf-road-worker, at: 2026-11-10T13:50:00Z }
  - { by: process:perf-road-streaming, at: 2026-11-10T13:55:00Z }
sources:
  - id: design
    resource: knowledge/road-redesign-plan.md（道路再設計の方針、2026-11-10）3.1〜3.4・5・8 章 P2・9 章
    title: 道路再設計の方針
  - id: code
    resource: src/world/roadClass.ts、src/world/laneChange.ts、src/world/roadMarkings.ts、src/world/roads.ts、src/world/roadSurface.ts、src/world/regulations.ts
    title: 実装
  - id: invariance
    resource: tests/roadModelInvariance.test.ts（入力は tests/fixtures/sign-placement の凍結タイル、指紋は tests/fixtures/road-model）
    title: 変更前のコードで取ったスナップショットとの一致
  - id: tests
    resource: tests/roadClass.test.ts、tests/roadModel.test.ts、tests/roadMarkings.test.ts、tests/sourceCode.ts
    title: 直書き禁止・述語・層つき検索・断面・MarkingPlan のテスト
  - id: p8-code
    resource: src/world/laneChange.ts（resolveSection・streetSection・carriagewayWidth・shoulderOf）、src/world/regulations.ts（osmLaneMatcher）、src/world/roadMarkings.ts、src/law/roadStandards.ts、scripts/roadLanes.ts、scripts/regulations.ts（roadlanes）
    title: P8 の実装
  - id: p8-tests
    resource: tests/roadSection.test.ts、tests/roadModel.test.ts、tests/roadMarkings.test.ts、tests/roadModelInvariance.test.ts（P8 で更新）、tests/fixtures/sign-placement/roadlanes-*.json
    title: P8 のテスト
  - id: p8-osm
    resource: public/data/roadlanes（Geofabrik kanto-latest.osm.pbf、2026-10-04 の抽出から 2026-11-11 に生成）
    title: OSM の車線の抽出
  - id: p8-probe
    resource: 依頼元の scratchpad p8/zzProbe.test.ts と p8/probe/{old,new,onlyosm}（地理院タイルを 2026-11-11 に取得、git 管理外）
    title: 実データの再計測
  - id: p8-perf
    resource: ../.qa/perf/2026-11-10T15-49-58-538Z-roads・15-52-39-338Z-roads・15-57-14-809Z-roads、15-54-40-863Z-streaming・15-59-31-212Z-streaming・16-02-48-572Z-streaming（ローカル保存、git 管理外）
    title: P8 の性能計測（新・旧・新）
  - id: perf
    resource: ../.qa/perf/2026-11-10T13-39-31-702Z-roads・13-44-47-917Z-roads・13-49-50-429Z-roads、13-41-51-217Z-streaming・13-47-02-123Z-streaming・13-51-43-800Z-streaming（ローカル保存、git 管理外）
    title: perf-road-worker と perf-road-streaming の新・旧・新の交互計測
---

# 高速道路の kind の分岐の分類

GSI の rdCtg=3 / motorway=1（`kind` の値 `highway`）を名指ししていた 48 か所を、意味で分けた。47 か所は `kind === …` の比較、48 か所目は carNavi.ts の描画順の表のキー（`{ …, highway: 4 }[kind]`、2026-11-10 レビューで指摘、当初の数え漏れ）。[^code] [^tests]

| 述語                      | 意味                                                           | 件数 | 置き換えた箇所                                                                                                                                                                                                              | 解除           |
| ------------------------- | -------------------------------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `RoadKind`・`kindFromGsi` | 型とデータの読み取り                                           |    2 | roads.ts の型、roadTiles.ts の kindOf                                                                                                                                                                                       | —              |
| `isExpressway`・`mapRank` | 区分そのもの（地図の色と描画順、オービスの対応、法定 60 km/h） |    5 | roads.ts estimatedLimit、orbis.ts ×2、carNavi.ts ×2                                                                                                                                                                         | —              |
| `usesGroundSurface`       | 地形の上に路面を張り、地上の車が立つ                           |    6 | roads.ts carriagewaysAt の索引、roadSurface.ts ×2、water.ts ×2、main.ts isSurfaceStreet                                                                                                                                     | 恒久（デッキ） |
| `takesJarticRules`        | JARTIC の規制を対応付ける                                      |    5 | regulations.ts ×5                                                                                                                                                                                                           | 恒久           |
| `allowsPedestrians`       | 歩行者が歩く（歩道・徒歩の経路）                               |    3 | sidewalks.ts、navigation.ts、navGuide.ts                                                                                                                                                                                    | 恒久           |
| `hasRoadside`             | 路端設備（信号・街灯・消火栓標識・可搬オービス・案内標識の柱） |    6 | trafficControl.ts ×2、guidePlan.ts（柱）、streetFurniture.ts、streetLights.ts、portableOrbis.ts                                                                                                                             | 恒久           |
| `isDrivable(line, use)`   | 経路に入れる                                                   |   17 | navigation 9（navigation・navGuide・navAhead・navStraight ×2・guidePlan ×4）、autopilot 3（autoDriver・robotaxi・main cruiseTarget）、traffic 1（traffic-ai）、spawn 2（main placeOnStreet）、map 2（navMap・junctionView） | P6 で use ごと |
| `allowsRoadsideStop`      | 路肩に寄せて止まる（第75条の8）                                |    4 | policePatrol.ts ×2、pursuitDirector.ts ×2                                                                                                                                                                                   | 当面           |

- `isDrivable` の解除は roadClass.ts の表 `EXPRESSWAY_OPEN`（use ごとの真偽）を書き換えるだけにした。ナビはランプを経路にできても、交通 AI は合流ができるまで入れられない、という段階を表すため。
- 「地上」の定義は `isOnGround`（level 0 かつ structure が ground、方針 3.2）の 1 つだけ。`allowsPedestrians`・`hasRoadside`・`usesGroundSurface` と `RoadGraph.nearest` の既定がこれを読む。下層の臨港道路（高架の一般道、方針 4.6）は歩行者・路端設備なしになる。
- 述語は RoadLine 全体を取る。当初は `{ kind }` だけでも通る型にして streetLights.lampSpecFor が kind だけを渡し、`cls`・`level` を捨てていた（レビューで指摘、line を渡すように訂正）。
- GSI の線はどれも地上で `cls` を持たないので、すべての述語が旧来の kind の判定と同じ値を返す（テストで全 kind を確かめた）。

検査（`tests/roadClass.test.ts`）:

- `\bhighway\b` が許可リスト（roadClass.ts、credits.ts の OSM タグ `highway=traffic_signals` の出典表記、src/expressway の OSM タグの読み取り）以外の src に現れない。引用符の有無を問わないので、オブジェクトのキーやプロパティも見つかる（carNavi.ts の色の鍵 `highway` は `expressway` に改名した）。
- `line.cls`・`line.structure`・`line.level` を直接読むのは roadClass.ts と src/expressway だけ（`l.level` のように別名で読むものは見つけられない）。
- コメントの除去は `tests/sourceCode.ts` の走査で行う。当初の正規表現 `/\/\*[\s\S]*?\*\//` は文字列の中の glob（`"assets/**/*.png"`）から次のコメントの終わりまでを飲み込み、間のコードを検査から落としていた（src/assetsPage.ts・src/world/signs.ts・src/world/signalModels.ts。tests/log.test.ts の console 検査も同じ式だったので同じ関数に替えた）。

# データモデル（RoadLine・Segment）

`RoadLine` に `source`・`cls`・`structure`・`level`・`nodeIds`・`section`・`xid`・`ref`・`limit` を**省略可能**で足した。省略時の既定（gsi・kind からの区分・ground・0・ID なし・断面なし・制限速度なし）で今の挙動になる。省略可能にしたのは、テストや Worker の入力が書く RoadLine リテラルをそのまま通すためと、省略したキーが構造化クローンにも JSON にも現れず、Worker の返信が以前とバイト単位で同じになるため（`tests/roadModel.test.ts`）。`Segment.elev`（点ごとの路面高）も同じ理由で省略可能。Worker の pack/restore（roadNetworkData.ts）はスナップショットの区間を展開して運ぶので、新しいキーは型も値もそのまま通る（テストで確認）。

- `level` と `structure` が食い違う線（ground なのに level ≠ 0、viaduct なのに level ≤ 0）は RoadGraph の構築時に `road_level_mismatch` で記録し、与えられたまま作る。Worker では診断として返し、ページが記録する。
- 断面と制限速度は線の値を正にした: 区間の `lanes` は `line.section.lanes`、`limit` は `line.limit`（OSM maxspeed、limitKind "sign"）から始め、規制の適用（applyRegulations）は JARTIC の対象の区間だけを戻して上書きする。断面を持つ線は JARTIC の車両通行帯でも車線数を変えない。当初は全区間を lanes 1・limit null に戻してから JARTIC の対象外を飛ばしていた（レビューで指摘）。GSI の線は断面も制限速度も持たないので値は変わらない。

# 断面の窓口（laneChange.ts）

> **訂正（P8、2026-11-11）**: この節は P2 時点の記述。`unlisted` の 2 方針・`KERB_INSET`・`carriagewayWidth(line)` が幅員を返すだけ、の 3 点は P8 で変えた（下の「P8」の節）。

- `resolveSection(width, isOneWay, evidence, unlisted)` だけが車線数を決める。優先は JARTIC の車両通行帯数 ＞ 既に決まった `Segment.lanes` ＞ OSM `lanes` ＞ 幅員推定（3.25 m）。根拠を `basis` に返す。
- ~~規制の適用（regulations.ts lanesPerDirection）と案内標識（guidePlan.lanesFor）は同じ関数を通るが、**何も載っていないときの方針が今は 2 つある**~~（P8 で 1 つにした）（描く車線は 1、案内標識は幅員から推定）。値を変えずに通すため `unlisted: "painted" | "byWidth"` で残した。P8 で 1 つにする。
- `sectionOf(seg, n)`・`laneLeftEdge`・`laneCentreOffset` が車線幅と車線の位置を返す。線が断面を持ち、その車線数で問われたら断面をそのまま返す。GSI の線は路肩・中央帯 0 なので、旧来の「幅/2 を車線数で割る」と浮動小数点まで同じ値になる（w/2 − 0 と、2 の冪の倍の積は丸めが起きない）。GSI の線の `basis` は記録ではなく推定（2 車線以上なら jartic。JARTIC の車線数が空欄で幅員から補った区間も jartic と出る）。区間に記録すると Worker の返信が変わるので P8 で OSM の車線と一緒に記録する。
- `carriagewayWidth(line)` は今は `line.width` を返すだけ。歩道込みの幅員への場当たりの補正は `KERB_INSET`（keepLeft 2・laneCentre 1.6・centreLine 0.8・edgeLine 0.4 m）に集め、laneOffset・drivePath.laneCentre・区画線がそこを読む。ただし src にはまだ `line.width` を直接読む所が約 117 ある（標識・歩道・交差点の箱・衝突など）。幅員の補正（車線×幅＋路肩で頭打ち、外側線を 幅/2 − 路肩）は、それらをこの関数へ移してからでないと一度には効かない（P8）。
- 交通 AI の `LANE_FRACTION = 0.25` は `laneCentreOffset(seg, 0, 1)`（1 車線の左の車線の中心 = 幅/4、一方通行は 0）に置き換えた。

# MarkingPlan（roadMarkings.ts）

`planMarkings(graph, seg, applied)` が区間ごとの線（種別・位置・区間・色・幅・破線の長さと間隔）と、測量の無い地域で交差点の端に合成する横断歩道・停止線を返す。`planCrosswalk`・`planStopLine` は JARTIC の位置の横断歩道・停止線にも使う。roadSurface.ts はこれを地形に沿わせて描くだけ。◇（210）・最高速度の数字・進行方向別通行区分の矢印は標示で、まだ計画に入れていない（roadSurface が描く）。[^code]

違反判定と同じ定義を共有する: 車線境界線の色は `isLaneChangeBanned` で決め、位置は `sectionOf` の車線幅から出す。`tests/roadMarkings.test.ts` が、黄色の実線がちょうど進路変更禁止の区間に引かれること、各車線境界線が `laneOfOffset` の数える境界の上にあり、各車線の `laneBand` が線の間に収まることを確かめる（tests/laneChangeBan.test.ts の方針）。

寸法と令の範囲（[道路構造令・標識令の値](road-standards.md)）:

| 線                | 現在の値                      | 標識令 別表第四の範囲               | 判定                   |
| ----------------- | ----------------------------- | ----------------------------------- | ---------------------- |
| 車線境界線（102） | 幅 0.15・破線 5 m／間隔 5 m   | 幅 0.10〜0.15、ℓ1 3〜10、ℓ2 1〜2 ℓ1 | 範囲内（テストで検査） |
| 車道外側線（103） | 幅 0.15・実線                 | 幅 0.15〜0.20                       | 範囲内（下限）         |
| 中央線            | 幅 0.15・破線 5／5 または実線 | 未収録                              | 令の値を未確認         |
| 停止線            | 奥行き 0.45                   | 未収録                              | 令の値を未確認         |
| 横断歩道（201）   | 縞 0.45・間隔 0.45・奥行き 4  | 未収録                              | 令の値を未確認         |
| ◇（210）          | 3 × 1.5 m・線 0.15            | 未収録                              | 令の値を未確認         |

令の範囲の外にある寸法は 0 件。~~未収録の 4 種は P8 で e-Gov の別表から確かめて roadStandards.ts に足す。~~ → P8 で別表第四・第六から確かめた（◇ の線だけ範囲外で直した、[道路構造令・標識令の値](road-standards.md)）。位置の「外側線は 幅/2 − 0.4」は寸法ではなく路肩の扱いで、P8 で 第8条（第四種 0.5 m）に置き換える。

# 層と空間検索（roads.ts）

- 節点のキーは、点に ID（`nodeIds`、OSM のノード ID）があればその ID、無ければ従来の座標丸め＋level（level 0 は従来どおり）。ID は level をまたいで線をつなぐので、ランプは上端で高架の本線に、下端で地上の道路につながる（地上の道路の途中の点でも、そこで区間を割る）。ID の無い高架の端が地上の交差点の点と重なっても節点は共有しない。`splitAtJunctions` も同じキーで、`nodeIds` は `coords` と一緒に切る。当初は level だけをキーに入れ、層をまたぐ接続を表せなかった（レビューで指摘）。節点キーはスナップショットに出ないので、今のうちに替えた。
- `nearest`・`carriagewaysAt` の既定は地上（`isOnGround`、carriagewaysAt は `usesGroundSurface`）だけ。旧来の呼び出しは結果が変わらない。`nearestOn(seg, p)` は区間を名指しするので層を選ばない（2D の射影のまま）。
- `nearestOnSurface(p, range, accept)`: 各区間の水平に最も近い点で `|p.y − surfaceY(seg, s)| ≤ 2.5 m` の区間のうち最も近いもの。`surfaceY(seg, s)` は `Segment.elev` があればその線形補間、無ければ `graph.ground(x, z)`（地形。関数は構造化クローンを通らないので復元後にゲームが設定する。P2 では未設定で 0）。今の main には高架の区間がグラフに無いので、合成データ（地上の道路の真上 8 m の高架、高架からランプで地上へ降りる接続）でテストした。呼び出し側の移行は P3。

# 不変の確かめ方

変更前のコード（origin/main 1305f52）で `tests/roadModelInvariance.test.ts` のスナップショットを取り、変更のたびに一致を確かめた（テストを直したときは src を変更前に戻して 2 回取り直し、一致を確かめてから新しいコードで照合した）。入力は `tests/fixtures/sign-placement` の凍結した規制・右左折車線タイル（丸の内・渋谷・芝公園）で、道路はそのタイルの規制の線から作り、番号で幅員区分・kind（17 本に 1 本は高速道路）・一方通行・橋を振って高速道路の分岐と全幅員区分を通した。[^invariance]

比べたもの: Worker の返信全体（グラフのスナップショット・詰めた規制・診断）、車線の計算（laneCentre・laneOffset・laneBand・laneOfOffset・lanesFor・規制速度）、40 m 格子での nearest と carriagewaysAt、RoadSurface の全メッシュの頂点・aStreet・uv・索引（測量あり／なし）、24 本の経路（徒歩 4 本）、自動運転、交通 AI の車線位置。

**訂正（2026-11-10 レビュー）**: 当初「自動運転 6 走行」と書いたが、3 地点 18 走行のうち実際に走ったのは 7 で、9 は経路の点が 1 個（車が目標の上）で AutoDriver.pathAt が例外を出し、2 は経路が立たなかった。起点を順に試し、走れない起点を飛ばして各地点 6 走行を実際に 40 秒走らせる形に直した。uv 属性はハッシュに入っていなかったので足した。

**訂正（2026-11-11、CI の Linux で失敗）**: macOS で通ったハッシュが GitHub Actions（Linux x64）で wire・search・surface・routes だけ食い違った。手元で入力の全座標を 1 ulp 動かして再現し、原因を 4 つに分けた。

1. Worker の返信を生の double のまま JSON にしていた（wire）。整数と 1e-15 の違い（停止線の `at` が 0 か微小値か）も型の違いとして出た。
2. 規制タイルの線をそのまま道路にしたので、同じ道路の別の記録（上下線・重なる区間）が重なる区間になり、等距離の 2 区間のどちらを取るか（nearest、横断歩道の割り当て）が最下位ビットで決まっていた（wire・search）。
3. 経路と自動運転の起点・目標を区間の中点に置いたので、起点と目標が同じ区間で一致する場合に、進むか転回するかが同点になった（routes）。
4. 区間の頂点にちょうど乗った標本（`graph.sample` の `cum[i] < d`）がどちらの辺の向きを取るかが最下位ビットで決まり、そこで描く帯と計画する車線位置が変わる（surface・routes の車線）。これはゲームのコード自体の性質で、P2 の前後で同じ。

対処: 1 は数値を刻みの整数にした（m は 1e-3、単位ベクトルと比は 1e-6、経緯度は 1e-9°、-0 は 0）。2 は他の線に 1.5 m 以内で沿う線を入力から除いた（道路は約 1,100 → 330〜410 区間）。3 は起点を区間の 1/4、目標を 3/4 に置いた（走れない起点は 0 になった）。4 は丸めでは消えないので、路面の頂点・aStreet・uv と経路の点・車線位置は和・絶対値の和・二乗和の「指紋」（`tests/fixtures/road-model/fingerprints.json`）にして、絶対 0.5＋相対 1e-9 の許容で比べる。頂点の数・索引・経路の区間列・車線番号は今まで通りハッシュで比べる。最後のテストが入力の全座標を 1 ulp 動かして、ハッシュも指紋も変わらないことを確かめる（指紋の差は相対 1e-9 以内に収まった）。

基準は origin/main 1305f52 の src に戻して 2 回取り（一致）、P2 のコードで照合して一致した（指紋もビット単位で同じ）。

**訂正（2026-11-11、CI の Linux で 2 度目の失敗）**: 上の対処のあとも、丸の内・渋谷のハッシュと 1 ulp のテスト自体が Linux で落ちた。Linux x64 の Math 関数は macOS arm64 と 1 ulp を超えて違い、丸めた値のハッシュも指紋の許容も越える。丸めや許容を広げると本物の変化も見逃すので、比べ方をプラットフォームで分けた。

- **挙動不変の証明は macOS で行った**: 浮動小数点に依存するハッシュと指紋（Worker の返信の数値、路面の頂点、経路の点と車線位置、格子の nearest の距離、交通 AI の車線位置）は、基準を取った darwin でだけ比べる（`it.runIf(process.platform === "darwin")`）。基準は P2 の前のコードから取った: 1305f52 と、main が進んだあとの cbfaa73（P2 を含まない origin/main。指紋・離散値とも 1305f52 の基準と同一）。P2 のコードはどちらとも一致した。
- **CI の Linux では離散部分だけを比べる**: 区間の端と節点の接続、一方通行・車線数・規制速度・規制のコード・通行止め、適用した規制の区間、車線数と固定オフセットの車線番号（幅員の四則演算だけ）、格子点の最寄り区間の番号、材質ごとのメッシュ、経路の区間列・出会う車線数・曲がり方、自動運転が走れた起点。基準は `tests/fixtures/road-model/discrete.json`（darwin で P2 の前のコードから取り、P2 のコードの値とバイト単位で同一）。
- 離散部分が他のプラットフォームでも変わらないことは、Math 関数の結果を全部 1e-12（約 5,000 ulp）ずつ交互に揺らしても同じになるテストで示した（3 地点）。頂点数・索引の数は帯の 2.5 m 刻みの数（長さの切り上げ）を数えるので揺れで変わり、各点の車線番号は車線を移る位置が動くので、離散部分から外して darwin の比較に残した。
- 揺らすと 1 行だけ変わる所がある: 渋谷の 1 区間の通行止めで、合成した道路が JARTIC の線の上にあり、重なる 2 つの記録のどちらが票を取るかが最下位ビットで決まる（1e-12 でも 1e-9 でも変わった）。そのため離散部分は観点ごとに 1 行まで違ってよいことにした（`DISCRETE_SLACK`）。1e-9（地球半径の数値で 6 mm）は、プラットフォーム差ではなくデータの境界を試すことになるので使わなかった。
- Linux での実行は手元では確かめていない（Docker のデーモンが起動できなかった）。CI の結果がそれにあたる。

カバーしない領域: 信号の制御機と歩行者灯（trafficControl.ts のうち路面が読む接近路以外）、案内標識（guidePlan.ts）、歩道（sidewalks.ts）、街灯（streetLights.ts）、水面と橋（water.ts）、オービス・可搬オービス（orbis.ts・portableOrbis.ts）、パトロールと追跡（policePatrol.ts・pursuitDirector.ts）。これらはそれぞれのテスト（signalPlacement・guideSigns・sidewalks・streetLights・water・orbis・pursuit など）が固定している。

スナップショットを更新してよいのは、道路モデルの出力を変えるつもりの変更（P8 の車線と幅員の補正など）と、行の作り方の変更（上の丸め）だけ。理由をコミットに書き、前後の行を比べる。行の作り方を変えたときは基準を変更前のコードから取り直す（`vitest -u` と `ROAD_MODEL_UPDATE=1`）。不一致のときは行を `.qa/road-model/<地点>/<観点>.txt` に書き出す（git 管理外）。

落とし穴: 自動運転は操作の探索を壁時計で 4 ms に打ち切る（PLAN_MS）ので、同じコードでも走行のハッシュが回ごとに変わった。テストでは `performance.now` を呼ぶたびに 0.05 ms 進む時計に差し替えて決定的にした（変更前のコードで 2 回取って一致を確認）。

# 性能

M2 Max、ヘッドレス Chrome、夜雨、負荷平均 6〜7（他のエージェントが並行）。新・旧・新の順に測った（レビュー後の修正の前の版。修正は区間の初期化と節点キーの組み立てだけで、走査の回数は変えていない）。[^perf]

| 計測                                   | 旧（main）    | 新（1 回目／2 回目） |
| -------------------------------------- | ------------- | -------------------- |
| Worker の計算（install・中央値）       | 145.8 ms      | 135.1／126.7 ms      |
| Worker 使用時の最長フレーム（install） | 50.1 ms       | 50.1／50.1 ms        |
| 路面の段（install・中央値）            | 95.9 ms       | 98.8／94.2 ms        |
| streaming 通常・更新の最長             | 50.1〜66.7 ms | 50.1 ms              |
| streaming 原点変更の最長               | 50.1 ms       | 100.1／66.7 ms       |
| streaming ワープ cold の最長           | 166.7 ms      | 150／133.4 ms        |
| streaming ワープ latest の最長         | 183.2 ms      | 166.6／266.7 ms      |

通常・更新・Worker の計算は同等か良い。原点変更とワープの最長は 1 回ごとに 1 フレーム単位で上下し（新の 2 回でも 100.1→66.7、166.6→266.7）、旧も 1 回だけなので、悪化とも改善とも言えない（各 1〜2 回、負荷あり）。最大スライスは前後とも 4 ms を超える回があり（新 5〜15 ms、旧 6〜15 ms）、P2 の差ではない。

# P8: 一般道の車線一本化・幅員補正・路肩（2026-11-11）

一般道の断面を 1 つの方針で決め、車道の幅と路肩を断面に入れ、区画線・車線の位置・違反判定・経路・自動運転・交通 AI・オービスが同じ断面を読むようにした。挙動は意図して変えた（車線数・車線の位置・区画線の位置）。[^p8-code] [^p8-tests]

## OSM の車線（public/data/roadlanes）

- `scripts/regulations.ts roadlanes`（`just fetch-road-lanes`、`OSM_FILE=<pbf>` で手元の抽出を年齢に関係なく使う）が Geofabrik 関東の抽出から、一般道（trunk〜living_street と _link）の way のうち `lanes`・`lanes:forward`・`lanes:backward`・`width` のどれかを持つものを z14 タイルに書く。行は `[forward, backward, oneway, width dm, …座標]`（`scripts/roadLanes.ts` の `wayLanes`。oneway=-1 は座標を逆に、対面で `lanes` だけなら半分ずつ切り捨て・最低 1、奇数の残りは右折車線とみなす）。ODbL の表記は他の OSM フォルダと同じ LICENSE.txt と出典画面（credits.roadlanes.extract）。[^p8-osm]
- 23 区（2026-10-04 の抽出）で 22,312 way、342 タイル、5.1 MB。`lanes` の付く割合（延長比）は trunk 90 %・primary 76 %・secondary 69 %・tertiary 50 %・unclassified 4 %・residential 2 %。`width` は 515 way だけ。
- 実行時の対応付け（`regulations.ts` の osmLaneMatcher）は JARTIC の規制と同じ流儀（区間の 20/50/80 % の 3 点で投票、25° 以内の平行、過半数）に、平行道路の誤対応を防ぐ 2 つの関門を足した: OSM の way の点から見て最も近い平行な地理院の中心線がその区間であること（相互最近傍）、OSM の車線数が地理院の幅員に 2.75 m／車線で収まること。上下線が別々の一方通行の way（中央分離帯のある道）は、区間と同じ向きの way を上り、逆向きの way を下りの車線にし、2 本の間隔を中央帯の推定に使う。

## 断面（resolveSection）

- **1 つの方針**: JARTIC の車両通行帯 ＞ OSM lanes ＞ ~~幅員推定~~ 1 車線（レビュー W1）。~~何も載っていないときの方針が今は 2 つある（描く車線は 1、案内標識は幅員から推定）~~ → P8 で 1 つにした（`unlisted` の引数は削除）。案内標識（guidePlan.lanesFor）とオービス（orbis.lanesFor）は区間の `lanes` をそのまま使う。オービスの OSM の車線数（OrbisEntry.lanes）は配置に使わなくなった（区間の断面がもう OSM の車線を取り込んでいるため。二重に数えると門型の車線の箱が描いた線をまたいだ）。
- ~~幅員推定: 構造令 第四種第一級の車線 3.25 m（第5条第4項）と路肩 0.5 m（第8条）。幅員 13 m 以上（地理院の rnkWidth 3 以上）で OSM の width が無いときは両側に歩道 3.5 m（第11条第3項）があるとみなして差し引く（**仮定**: 幅員は道路縁から道路縁で、第四種の道路は各側に歩道を設ける、という読み）。推定の上限は片側 4 車線。~~ → レビュー W1 でやめた（下の「レビュー後の修正」）。
- JARTIC の台数が「片側か両側の合計か」の判定に OSM を使う: 対面の区間で OSM の合計に近ければ合計とみなす。幅員だけの判定（1 方向に 3 m で収まらなければ合計）は地理院の幅員が歩道込みのとき合計を片側と読む（丸の内の日比谷通りで JARTIC 5 を片側 5 と読んでいた）。
- 車道の幅 = 車線 × 3.25 m ＋ 路肩 0.5 m × 2 ＋ 中央帯 を、地理院の幅員（OSM の width があればそれ）で頭打ちにする。幅員が狭ければ車線を詰める（最低 2.75 m）。中央帯は OSM の上下線の間隔から片側の車線と路肩を引いた値（上限 8 m、幅員の残りまで）。
- 方向別の車線数は `forward`・`backward` として断面に残すが、描く車線と判定は両方向で同じ数（大きい方）。方向ごとに変えるには `Segment.lanes` の利用者（main.ts の判定、drivePath、自動運転）が向きを渡す必要がある（残課題）。
- 断面は区間に記録する（`Segment.section`、根拠 `basis` 付き）。グラフの構築時は幅員から、規制の適用で JARTIC と OSM から。手で書いた Segment（テスト）は `streetSection` が `lanes` と幅員から出す。

## レビュー後の修正（2026-11-11、Fable レビュー Conditional LGTM・Warning 8）

上の節のうち、次の記述はレビューの指摘で変えた（元の記述は打ち消し、ここが正）。

- **W1 幅員推定をやめた**: ~~幅員推定: 第四種第一級の車線 3.25 m と路肩 0.5 m … 推定の上限は片側 4 車線~~ → 何も載っていない区間は一方通行でも 1 車線。2 車線以上は JARTIC か OSM がある場合だけ。幅員推定は一方通行で単調でなく（12.9 m → 3 車線、13 m → 1、16 m → 2）、根拠の無い 9 m の一方通行 277 区間が 2 車線になっていた。
  - 「部屋」（`streetRoom`: OSM の width、無ければ幅員 13 m 以上は歩道 3.5 m × 2 を引いた値）を 1 つにし、JARTIC の台数の頭打ち（2.75 m／車線で収まる数）、JARTIC の合計判定、OSM の matcher の収まり判定、車道の幅の上限が全部同じ部屋を見る。前は歩道の仮定が幅員推定にしか効かず、25 m に JARTIC 4 を片側 4 車線（車線 3.0 m・歩道 0）と読んだ区間が 66 あった。
  - 手で決めた車線数（テスト、`LaneEvidence.lanes`）は根拠 "assumption" で、歩道を引かずに幅員全体に置く（~~2 以上なら "jartic"~~）。
- **W2 matcher**: 両方向の way は JARTIC と同じ 6 m（MATCH_DIST）以内、一方通行の way（中央分離帯のある道の片側）だけ 幅員/2 ＋ 3 m（LineGrid の 25 m で頭打ち）。ビルド時に tunnel と layer < 0 を除き、layer を列に持つ（layer > 0 の way は地理院の橋にだけ対応付ける）。行の列は `src/world/roadLanesData.ts`（ROAD_LANES_COLUMN）が唯一の定義で、meta.json に schema 2 と列名を書く。
- **W3**: JARTIC の台数空欄（2〜4 と仮定）も部屋に収まる数で頭打ち（~~4.3 m の対面で車線 0.82 m~~）。
- **W4 狭い道は中央走行に戻した**: 車道 5.5 m 未満（中央線なし）の対面の道では `laneOffset` は 0。一方通行の右左折前の寄せ（drivePath の edgeHug）も P2 の式（幅員/4、縁から 2 m）に戻した。tests/drivePath.test.ts の該当の書き換えも戻した。
- **W5**: 停車位置の縁石までの隙間（main.ts stopSite の kerbGap）は「PLATEAU の歩道」と「車道の端（carriagewayWidth）」の近い方。
- **W7**: OSM の一方通行が座標と逆向き（oneway=-1 の区間）なら forward/backward は 0/n。断面を記録した区間で車線数だけ書き換えても中央帯を保つ（`LaneEvidence.median`）。
- **W8**: ◇ は一重・線 0.2 m に戻した（図の同心の線は外形線とみる）。◇ の線と長さ・横断歩道の奥行き・PAVED_FROM・MEDIAN_MOST・一方通行の reach・2.75 m の下限・JARTIC の合計判定の 3 m・空欄の上限 4 は、`src/world/streetAssumptions.ts`（`verified: false` と理由、src/expressway/assumptions.ts と同じ形）に移し、法令値の台帳（roadStandards.ts）から外した。
- **S4**: AutoDriver.pathAt に 1 点の経路のガード（実データの再計測で出た例外 2 件が 0 に）。
- **ログ**: `road_sections`（区間の根拠ごとの数と、OSM の上下の車線数が違う区間の数）と `pavement_over_lanes`（PLATEAU の歩道が外側線の 0.3 m 内側にかかる区間の数）。方向別の車線は P8 では通さず P6 で（判断 a）。
- **性能（S1）**: データが無ければ OSM の格子を作らない、道路の索引を規制の点の対応付けと共有、地図の範囲外の OSM の way を経緯度のまま捨てる、way の格子を 1 つにして 1 標本 1 問い合わせ、相互最近傍を way ごとに 1 回、標本点を規制の投票と共有。

## 再集計（レビュー修正後）

**挙動の変化**（不変テスト、P2 の ac0f603 との比較。スナップショットと darwin の基準はここで 1 回取り直した）:

| 地点   | 区間 | 車線数が変わった区間（内訳）                                   | 経路の軌跡が変わった | 道筋が変わった | 自動運転が変わった | 交通 AI の車線点が動いた区間 |
| ------ | ---: | -------------------------------------------------------------- | -------------------: | -------------: | -----------------: | ---------------------------: |
| 丸の内 |  333 | 68（2→1: 31、3→2: 25、6→5: 4、4→1: 3、3→1: 2、5→2: 2、1→2: 1） |               6 / 24 |              0 |              3 / 6 |                          188 |
| 渋谷   |  410 | 44（2→1: 26、3→2: 12、4→2: 2、4→1: 2、3→1: 1、1→2: 1）         |               5 / 24 |              0 |              4 / 6 |                          200 |
| 芝公園 |  333 | 58（2→1: 33、3→2: 12、4→2: 8、4→1: 2、5→2: 2、3→1: 1）         |               3 / 24 |              0 |              3 / 6 |                          190 |

不変テストの道路は JARTIC の線に番号で幅員を振った合成なので、JARTIC の台数が部屋に収まらない・合計と読める区間で車線が減る向きの変化が多い。交通 AI の点は車線の中心が路肩の内側に入ったため。

**実データの再計測**（6 地点、P2 → P8 修正後）: 右左折 519 → 520 経路（渋谷で 1 本増）、右折で中心の内側 256 → 257、曲線にならない右左折 13 → 11、地理院の幅員の帯から外れる点のある経路 31 → 18（前回の 81 は W4 の左寄せが原因で、戻して解消）、直線部で外側線の外に出た経路 1 → 5（最大 5.0 → 1.1 m）、自動運転 261 走行の右側通行 4 → 5、例外 0 → 0。

**OSM**: 根拠は JARTIC 1,715・OSM 1,489・1 車線（width）8,300（11,504 区間）。JARTIC と OSM の両方が付く 1,348 区間で一致 845（63 %）・1 本違い 476（35 %）・2 本以上違い 27（2 %）。逆向きの検査（幅員 20 m 以上に OSM の 1 車線）は 21 区間（新宿 13・芝公園 5・丸の内 2・上野 1）で、前回のレビューの数と同じ。中身は見ていない（OSM の lanes=2 の対面の way を 1/1 と読むため、広い道の側道や交差点の取付けが拾われている可能性）。OSM の上下の車線数が違う区間は 7（新宿）。

**性能**: 旧（ac0f603 を別ポートの vite で配信）と新を交互に各 5 回（`perf-road-worker`・`perf-road-streaming`、負荷平均 6〜8 で無負荷にはできなかった）。判定の基準は「新が旧の 1.10 倍以下」。[^p8-perf]

| 計測（中央値、5 回 × 各回 3 標本）     | 旧              | 新              | 比   |
| -------------------------------------- | --------------- | --------------- | ---- |
| Worker の計算（install）               | 140.4 ms        | 145.9 ms        | 1.04 |
| inline の計算（install）               | 101.8 ms        | 109.4 ms        | 1.07 |
| Worker 使用時の最長フレーム（install） | 50.0 ms         | 50.0 ms         | 1.00 |
| 路面の段（install）                    | 96.2 ms         | 87.5 ms         | 0.91 |
| streaming 通常・更新の最長             | 50.1 ms         | 50.0 ms         | 1.00 |
| streaming 原点変更の最長               | 66.7 ms         | 66.7 ms         | 1.00 |
| streaming ワープ cold／latest の最長   | 133.4／183.3 ms | 133.3／183.3 ms | 1.00 |

- S1 を当てる前の 5 回では Worker の計算が 1.18 倍（129.2 → 152.3 ms）で基準を超えた。効いたのは、規制の適用で区間の `section` を `delete` していたのをやめたこと（V8 がオブジェクトを辞書モードに落とし、以降の区間の読み取りが全部遅くなる）と、OSM の格子・問い合わせを減らしたこと。
- Node（同じ入力の丸の内、30 回の中央値、旧・OSM なしの新・新を交互に 4 回）でも新は旧の 1.00〜1.07 倍、OSM なしの新は旧と同じ。
- 路面の段が速くなったのは、根拠の無い道の車線境界線が減ったため。inline（Worker が使えないときの代替）の最長フレームは 1.12 倍だが、ゲームの既定は Worker。

## 判断の記録

- 方向別の車線（forward ≠ backward）は P8 では描かず、`road_sections` の asymmetric で数を出す。P6 で Segment.lanes の利用者に向きを通す。
- PLATEAU の歩道が車道にかかる区間は `pavement_over_lanes` で数える（ゲーム内でだけ取れる。歩道の仮定の検証用）。丸の内（perf の起点、2026-11-11）で 722 区間中 65（9 %）。中身はまだ見ていない。
- 多視点の 4 周目（レビュー修正後、15 コマ）: ◇ は一重。~~新しい指摘として、内堀通り（幅員 30 m）が JARTIC も OSM も対応付かず 1 車線 + 破線の中央線になった~~ → **訂正（2026-11-11 調査）**: 視点表で「内堀通り」と名付けた地点（35.680952, 139.760311、地理院の幅員 30 m・kind local）は内堀通りではなく皇居外苑の園路だった。OSM では highway=service（way 409582698）で、車線数の付く OSM の way は最も近くても 122 m 先（本物の内堀通り）。1 車線は方針どおりで正しい。同じく「日比谷通り」の地点は本物の日比谷通り（OSM の trunk 2 本が 6.4 m・8.4 m）、「桜田通り」の地点は祝田通り（OSM の primary 2 本が 5.6 m・6.4 m）だった。
- 調べた仮説（レビューの指示）: (1) 上下線が別 way で reach が効かない、(2) tunnel・layer で除外、(3) 相互最近傍で別の道に取られた、(4) lanes:forward/backward だけ — いずれも該当しなかった（地点の取り違え）。丸の内周辺の主要幹線（OSM の名前つき trunk・primary・secondary・tertiary に沿う幅員 20 m 以上の地理院の区間）で 1 車線になったのは、内堀通り 44 区間中 0、日比谷通り 33 中 0、永代通り 14 中 0、丸の内室町線 17 中 0、外堀通り 18 中 0、晴海通り 9 中 0、桜田通り 9 中 0、祝田通り 4 中 0、鍛冶橋通り 23 中 2（皇居外苑の広場の幅員 70 m の交差点の取付け 2 区間で、幹線から 37 m 離れた園路）。丸の内周辺で JARTIC も OSM も付かず 1 車線の幅員 20 m 以上の区間 53 は、すべて皇居外苑の園路（OSM は service・pedestrian）と広場の交差点の取付けだった。コードは変えていない。
- 本物の内堀通り（和田倉・二重橋前）と日比谷通りを多視点で撮り直し、多車線・黄色の進路変更禁止の線・停止線・横断歩道を確かめた（12 コマ、依頼元の scratchpad p8/shots2）。

## 幅員の補正と line.width の読み取りの分類

`carriagewayWidth(seg)` が車道の幅を返す。`line.width`（地理院の幅員、歩道込みのことがある）の直接の読み取りは P2 時点の 107 から 100 になった。残りは意味が違うので残した:

| 分類                               | 意味                                                               | 主な箇所                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 車道の幅・車線の算術（**移した**） | 車線の位置、車線番号、車道の端                                     | main.ts の車線変更の合図・通行帯違反・停車の車線・停留所の車線、orbis・portableOrbis、robotaxi・policePatrol の出現位置、pursuitDirector の検問帯、autoTraffic の追越しの幅、drivePath の edgeHug・laneCentre、roads.ts laneOffset、roadMarkings（外側線・停止線・横断歩道）、roadSurface の ◇ |
| 物理的な道路の縁                   | 縁石・柱・歩道・照明・標識の位置、路面の端、路上の判定、交差点の箱 | trafficControl、sidewalks、signs、streetLights、streetFurniture、water の床版、regulations の標識の柱と照合の幅、roads.ts carriagewaysAt、autoDriver の縁石・交差点、drivePath の角の縁石半径・交差点の大きさ、roadSurface の舗装の帯、roadMarkings の junctionClearance                       |
| 幅員区分のしきい値                 | 地理院の幅員区分で決める分類                                       | 法定速度（5.5 m）、出現・巡回・経路の対象（3・4・5.5 m）、駐車車両の通り（4〜13 m）、案内標識の幹線（7・9 m）、可搬オービスの道（3.5〜13 m）、歩道の狭い道                                                                                                                                     |
| 地図の描画                         | 道路の太さ・描画順                                                 | navMap、carNavi、junctionView、guidePlan の並べ替え                                                                                                                                                                                                                                            |

路面のアスファルトは地理院の幅員まで張る（PLATEAU の歩道が上に載る）。車線と区画線はその中の車道に寄る。~~KERB_INSET（keepLeft 2・laneCentre 1.6・centreLine 0.8・edgeLine 0.4 m）~~ は削除し、路肩（断面の shoulderL・shoulderR）に置き換えた。

## 路肩と区画線（W6）

- 外側線は 車道の幅/2 − 路肩（`laneLeftEdge`）。車線境界線は `laneLeftEdge − k·laneWidth`。中央帯のある道は中央線を引かず、中央帯の両側（±中央帯/2）に外側線。停止線は中央線（中央帯の縁）から外側線まで。横断歩道は車道の幅だけ。
- 違反判定（laneOfOffset・laneBand）と区画線が同じ定義であることを `tests/roadMarkings.test.ts`（外側線のすぐ内側が車線 0、すぐ外側が −1、車線境界線が laneOfOffset の境界の上）と `tests/roadSection.test.ts`（中央帯のある道で内側の車線の帯が中央帯にかからない）が確かめる。
- laneOfOffset は線の上の点を右の車線に数える（1e-9 車線幅の余裕）。3.25 m・0.5 m で線が 2 進の端数のちょうどに乗り、中心線の上に置いた車（自動運転の起点）や曲線の補間点が線の上に来て、入力の 1 ulp で自動運転の走行全体が変わった（不変テストの 1 ulp ずらしの検査で発見）。drivePath の曲線の中点の点も同じ理由で出口側に寄せた。
- 寸法は標識令 別表第四・第六で確かめた（[道路構造令・標識令の値](road-standards.md)）。範囲外は ◇ の線（0.15 → 0.20、~~二重~~ 一重、レビュー W8）だけ。

## 挙動の変化（不変テストの更新）

> レビュー前の計測。レビュー後の値は「再集計（レビュー修正後）」の節が正。

`tests/roadModelInvariance.test.ts` のスナップショットと darwin の基準（tests/fixtures/road-model）を P8 のコードで取り直した。理由はテスト冒頭とコミットに書いた。P2 の行（ac0f603）との比較:[^invariance]

| 地点   | 区間 | 車線数が変わった区間（内訳）                    | 経路の軌跡が変わった | 道筋（区間と右左折）が変わった | 自動運転の走行が変わった | 交通 AI の車線点が動いた区間 |
| ------ | ---: | ----------------------------------------------- | -------------------: | -----------------------------: | -----------------------: | ---------------------------: |
| 丸の内 |  333 | 62（1→2: 51、1→4: 7、3→2: 3、1→3: 1）           |               4 / 24 |                              0 |                    5 / 6 |                          188 |
| 渋谷   |  410 | 104（1→2: 76、1→4: 21、3→2: 5、4→2: 1、1→3: 1） |               6 / 24 |                              0 |                    4 / 6 |                          200 |
| 芝公園 |  333 | 80（1→2: 60、3→2: 9、1→4: 9、4→2: 2）           |               9 / 24 |                              0 |                    4 / 6 |                          190 |

走れる起点（自動運転が経路を立てられた起点）は 3 地点とも前と同じ。車線の分布は `tests/roadSection.test.ts` がスナップショットで固定する。

## 実データでの再計測（右左折の軌跡）

> レビュー前の計測。レビュー後の値は「再集計（レビュー修正後）」の節が正。

[曲がり方](turn-paths.md) の計測（858 経路・427 走行）と同じ形で、地理院のタイルを実際に取得し、public/data の JARTIC・OSM を当てた 6 地点（丸の内・新宿・上野・渋谷・芝公園・中野の住宅地、各 3×3 z16）を P2（ac0f603）と P8 で測った。半径 700 m 内の 3 叉以上の節点で「流入 60 m 手前 → 流出 40 m 先」の右左折 519 経路、その半数 261 本を自動運転（運動学の自転車モデル、信号・他車なし）で走らせた（使い捨てのテスト、依頼元の scratchpad p8/zzProbe.test.ts）。[^p8-probe]

| 項目（6 地点の合計、P2 → P8）                                  |              P2 |              P8 |
| -------------------------------------------------------------- | --------------: | --------------: |
| 右左折の経路（右折）                                           |      519（265） |      519（265） |
| 右折で中心の 0.5 m 以上内側を通った                            |             256 |             258 |
| 曲線にならなかった右左折                                       |              13 |              10 |
| 直線部（交差点から 15 m 以上）で車の中心が外側線の外に出た経路 | 1（最大 5.0 m） | 3（最大 1.1 m） |
| どの車道の帯（地理院の幅員）からも外れる点のある経路           |              31 |              81 |
| 自動運転 261 走行の右側通行（2 秒以上）                        |               4 |               3 |
| 自動運転の例外（AutoDriver.pathAt、既知の不具合）              |               0 |               2 |

- 帯から外れる経路の増加は、幅 4.3 m の細い道で車が中央（旧 KERB_INSET.keepLeft 2 m で幅 4.3 m なら 0.15 m）から左寄り（0.82 m、第18条）に移ったため。細い道どうしの最小半径 6 m の曲線が、角の丸みの無い帯の外に 0.03〜0.4 m 出る（渋谷で 24 本を目で確かめた。最大は 1.5 m で、前の 3.2 m より小さい）。
- 自動運転の軌跡からの離れの中央値は 0.02〜0.05 m で前と同じ。95 % 値は丸の内・新宿・上野で 30〜47 m と大きいが前も同じ（目的地を過ぎても経路の端を追う間の値を含む、計測側の問題で P8 の差ではない）。
- AutoDriver.pathAt の例外（経路の点が 1 個のとき、P2 で既知）が P8 で丸の内・新宿の 1 走行ずつに出た（車線が変わり同じ起点の経路が変わったため）。

## OSM の網羅と対応付けの精度（実データ 6 地点、11,504 区間）

> レビュー前の計測。レビュー後の値は「再集計（レビュー修正後）」の節が正。

- 区間の根拠（P8）: JARTIC 1,715、OSM 1,904、幅員推定 7,885（6 地点の 11,504 区間。住宅地の細い道が大半）。OSM だけを当てた試行では 3,267 区間に OSM の車線が付いた。
- JARTIC と OSM の両方が付く 1,469 区間で車線数が一致 883（60 %）、1 本違い 544（37 %）、2 本以上違い 42（3 %）。1 本違いの多くは JARTIC の台数が片側か合計か曖昧なもの（幅 35 m・JARTIC 4・OSM 3 など）と奇数の合計（右折車線）。合計とみなす判定を OSM で補う前は一致 29 %・2 本以上違い 39 % だった（丸の内の 35 m の道で JARTIC 5 を片側 5 と読んでいた）。
- 平行道路の誤対応の検査: 幅員 5.5 m 以下の区間に OSM の 2 車線以上が付いたものは 0（幅に収まる関門）。合成データで、幹線の上下線の 5 m 横を通る 4.3 m の道に幹線の 3 車線が付かないことをテストした。
- 確かめていないこと: OSM が正しいかどうか（現地・航空写真との照合はしていない）、OSM の `lanes` の無い区間（unclassified・residential の 96〜98 %）の車線数。

## 性能

> レビュー前の計測。レビュー後の値は「再集計（レビュー修正後）」の節が正。

M2 Max、ヘッドレス Chrome、夜雨、他のエージェントが並行（負荷あり）。新・旧（ac0f603 を別ポートの vite で配信）・新の順。[^p8-perf]

| 計測                                   | 旧            | 新（1 回目／2 回目）        |
| -------------------------------------- | ------------- | --------------------------- |
| Worker の計算（install・中央値）       | 143.0 ms      | 210.5／307.4 ms             |
| inline の計算（install・中央値）       | 104.1 ms      | 121.2／158.6 ms             |
| Worker 使用時の最長フレーム（install） | 50.1 ms       | 50.1／66.7 ms               |
| 路面の段（install・中央値）            | 102.6 ms      | 98.7／120.4 ms              |
| streaming 通常・更新の最長             | 66.7 ms       | 50.1〜66.7／50.1 ms         |
| streaming 原点変更の最長               | 100 ms        | 83.3／83.4 ms               |
| streaming ワープ cold／latest の最長   | 200／199.9 ms | 133.4／183.2、183.4／200 ms |

- 新の 2 回目は p50 が 49.9 ms に落ちるほど負荷が高く、新同士で 1.5 倍ぶれる。Node で同じ丸の内の道路網を 8 回ずつ計算した最小値は、OSM の車線なし 182〜194 ms・ありで 193〜204 ms で、OSM の対応付けの追加は約 10 ms（5 %）。Worker の計算が旧より遅い側に出たのは確かだが、どこまでが P8 かは負荷のため言えない（要再計測）。
- streaming の 1 回目（新）は計測中の src の編集で HMR が走り失敗したので、編集を止めて測り直した（表の新 2 回目）。

## 多視点レビュー

依頼の Q1 基盤（`scripts/qa/views.ts`、ac0f603 で取り込み済み）に、依頼元の scratchpad の視点表 p8/road-sections.json を渡して撮った（日比谷通り・内堀通り・明治通り・桜田通り・中野の住宅地 × 運転席・真上 40 m・斜め上空 60 m／40°、15 コマ、ヘッドレス Chrome、vite は 5291 番）。

| 周  | 指摘（新規）                                                                                                                    | 対応                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | 日比谷通り・桜田通りで PLATEAU の中央分離帯が内側の車線にかぶる（断面に中央帯が無い）。視点の座標が濠・高架の下（視点表の誤り） | OSM の上下線の間隔から中央帯を推定し、中央帯の両側に外側線（中央線なし）。視点表を GSI の区間の中点に直した |
| 2   | 新規なし（日比谷通りの中央帯は解消。~~桜田通り~~ 祝田通りの芝公園付近は OSM の上下線が対応付かず残る＝持ち越し、データのずれ）  | —                                                                                                           |
| 3   | 新規なし                                                                                                                        | —                                                                                                           |

2 周続けて新規の指摘なしで収束とした。照合した法令: 外側線と路肩（第8条 0.5 m）、車線境界線の色（白破線、進路変更禁止は黄実線）、中央線の有無（車道 5.5 m 以上）、停止線（中央線から外側線、奥行き 0.45）、横断歩道（車道の幅だけ、縞 0.45／間 0.45）、◇（~~二重の輪郭~~ レビュー W8 で一重に戻した）。`just show-errors` は 0 件（警告は sign_faces_below_ground と data_load_failed・tide_table_failed のみ、P8 と無関係）。

持ち越し（直していない）: 地理院の中心線が実際の道路の中心からずれている区間で、外側線が PLATEAU の歩道の下に隠れる（~~桜田通り~~ 祝田通り）。PLATEAU の歩道の無い区間では、外側線の外の路側帯の舗装が広く見える（~~内堀通り~~ 皇居外苑の園路の濠側、幅員 30 m に車道 20.5 m）。

[^p8-code]: P8 の実装

[^p8-tests]: P8 のテスト

[^p8-osm]: OSM の車線の抽出

[^p8-probe]: 実データの再計測

[^p8-perf]: P8 の性能計測

# 残課題

P8（一般道）: ~~車線数の 2 方針の一本化、OSM `lanes` の取り込み、`basis` の記録、`KERB_INSET` の路肩への置き換え、`line.width` の移行、中央線・停止線・横断歩道・◇の寸法~~ → P8 で実施（上の節）。P8 の後に残したもの:

- 方向別の車線数（forward／backward が違う道）を描く・判定する（P6）。Segment.lanes の利用者が向きを渡す必要がある。`road_sections` の asymmetric が数を出す。
- 縁の窓口: 物理的な縁（地理院の幅員）と車道の端を `roadEdge(seg)`・`carriagewayEdge(seg)` のような関数に寄せ、`line.width` の直読みをテストで禁じる（W5、後続）。
- 「車道端」の定義を G4（feat/sign-mounts、PR #50）と合わせる。標識の柱の位置を車道端に寄せるかは G4 側で決める（W6）。
- 断面の単一化: 記録した断面（Segment.section）と `Segment.lanes` の二重の持ち方をやめ、断面だけを正にする（W7）。今は lanes を書き換えると `streetSection` が中央帯を保って作り直す。
- 時間帯の一方通行: 断面は規制の向き（一方通行）で作るので、規制時間外に対面になった区間では sectionOf が一方通行の車道を半分に割る（レビューの検証スクリプトで確認、未対応）。
- 歩道込みかどうかを PLATEAU の歩道の多角形から決める（今は幅員 13 m 以上で 3.5 m × 2 を引く仮定、`pavement_over_lanes` で検証する）。第四種第二級・第三級（3.0 m）の車線幅。
- 逆向きの検査で見つかった、幅員 20 m 以上に OSM の 1 車線が付く 21 区間の中身。
- 路面の濡れの轍（roadSurface の aStreet の laneOrigin）は中央帯のある道で反対車線の轍が線とずれる。
- 中央線の「片側 6 m 以上で実線」は車道の半分で判定するので、車線 1 の道では実質働かない（中央線の実線・破線は令の図で 4 車線以上が実線）。
- ~~src/signs/defs/lanes.ts のコメントが消えた関数 lanesPerDirection を指している~~ → コメントを resolveLaneUse に直した。進行方向別通行区分の想定パターンは 5 車線で頭打ち（regulations.ts）。

P3・P6（高速道路をグラフへ）。2026-11-10 レビューの指摘で、P2 では直さず記録だけにしたもの（2026-11-11、P3 で直したものに印）:

- ~~trafficControl の進入路を `hasRoadside` で判定~~ → 進入路は `isEnterable`（地上の一般道と OSM の高速道路。出口ランプの端は信号の接近路になり、路端設備は立たない）。箱の内部リンクは `hasRoadside` のまま。GSI の線では `hasRoadside` と同じ値（テスト）。
- ~~guidePlan の matchRouteSteps が `isDrivable("navigation")`~~ → RouteUse に "guide" を足し、guidePlan の 4 か所を置き換えた（P6 でナビを開けても案内標識の路線番号はランプに移らない）。~~exitDirections が `takesJarticRules` で出口を数える~~ → `isEnterable`（入口ランプも出口の向きに数える）。
- ~~`isDrivable` は構造を見ていない~~ → tunnel・cut は全用途で false（P9 まで）。GSI の高速道路の線はどの用途でも false のまま（OSM のチャンクに置き換わる）。`EXPRESSWAY_OPEN` は map・spawn を開けた（OSM の線だけ）。
- policePatrol は出現・巡回の道路選びにも `allowsRoadsideStop` を使っている（未対応、P6）。
- ~~起点探索は `nearest` 経由で地上だけ~~ → `RoadGraph.locate`（床版の上にいれば nearestOnSurface の床版、そうでなければ nearest と同じ答え。地上の検索と同点の扱いをビット単位で保つため、全部を nearestOnSurface にはしていない）を main の違反判定・駐車の判定・autoDriver の bestStart で使う。placeOnStreet は床版の上の車を床版の左車線へ戻す。navGuide の locate は P6。
- ~~planMarkings は断面の路肩・中央帯を見ない~~ → 断面を持つ線は外側線を車線域の端（`laneLeftEdge`、右は 幅/2 − 右路肩）に、車線境界線を `laneLeftEdge − (lanes − k)·laneWidth` に、中央帯があれば中央線を中央帯の両端に引く。GSI の線（断面なし）は外側線 幅/2 − 0.4 のまま（不変テストの指紋は一致）。
- ~~`nearestOnSurface` の地形の既定は 0、垂直ゲートは車道の幅を見ない~~ → `graph.ground` の既定は null（不明）で、main が地形（橋は床版）に結ぶ。高さ不明の地上の道路は、高さの分かる道路が無いときだけ答えにして `unknownGroundHits` を数え、網を入れ替えるとき `road_surface_unknown` で記録する。床版（地上でない線）は車道の半幅 + 1 m（DECK_REACH）の内側だけ。`surfaceY` は number | null。 **訂正（2026-11-11 レビュー）**: 床版どうしは最も近い中心線で選んでいたので、分合流で本線の車がランプ（limit 40）に判定された。ゲートを通る床版が複数なら本線 → 規制速度の高い方 → 近い方（`deckRank`）。床版と地上の道路が両方通るときは近い方。
- ~~CrossSection・RoadClass・carriagewayWidth の二重~~ → CrossSection は laneChange.ts の 1 つ（src/expressway/section.ts は再輸出し、`XwSection` で basis を statute / assumption に絞る）。expressway の RoadClass は `Exclude<RoadClass, "street">`、幅は laneChange.ts の `sectionWidth`（section.ts の carriagewayWidth はその別名）。高速の区間は `line.section` を持つ。
- 残る: `Segment.bank`（片勾配）は持たせていない（描画も既定は平ら）。

[^code]: 実装

[^tests]: 直書き禁止・述語・層つき検索・断面・MarkingPlan のテスト

[^invariance]: 変更前のコードで取ったスナップショットとの一致

[^perf]: perf-road-worker と perf-road-streaming の新・旧・新の交互計測
