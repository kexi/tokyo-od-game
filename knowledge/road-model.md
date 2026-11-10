---
type: Reference
title: 道路モデル（区分の述語・断面・MarkingPlan・層つき検索、P2）
description: 道路再設計 P2 で、src 全体で GSI の高速道路の kind を名指ししていた 48 か所を意味ごとの述語（src/world/roadClass.ts）に置き換え、RoadLine に source / cls / structure / level / nodeIds / section / xid / limit を後方互換で足し、車線数と幅員の窓口を laneChange.ts の resolveSection・carriagewayWidth・sectionOf に寄せ、区画線を純関数 planMarkings（src/world/roadMarkings.ts）に切り出し、RoadGraph に層（地上だけの既定、端点 ID の節点、nearestOnSurface、surfaceY）を入れた。挙動は不変（丸の内・渋谷・芝公園の凍結データで、グラフ・規制・路面の頂点・経路・自動運転・交通 AI の車線をハッシュで一致）。性能は前後で同等。レビュー（2026-11-10）の指摘で、地上の定義の一本化、層をまたぐ接続、断面と OSM の制限速度を正とする扱い、直書き禁止テストの抜け道、不変テストの実効範囲を直した。
tags: [roads, testing, traffic-law]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-10T14:00:00Z }
verified:
  - { by: process:vitest, at: 2026-11-11T02:00:00Z }
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

- `resolveSection(width, isOneWay, evidence, unlisted)` だけが車線数を決める。優先は JARTIC の車両通行帯数 ＞ 既に決まった `Segment.lanes` ＞ OSM `lanes` ＞ 幅員推定（3.25 m）。根拠を `basis` に返す。
- 規制の適用（regulations.ts lanesPerDirection）と案内標識（guidePlan.lanesFor）は同じ関数を通るが、**何も載っていないときの方針が今は 2 つある**（描く車線は 1、案内標識は幅員から推定）。値を変えずに通すため `unlisted: "painted" | "byWidth"` で残した。P8 で 1 つにする。
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

令の範囲の外にある寸法は 0 件。未収録の 4 種は P8 で e-Gov の別表から確かめて roadStandards.ts に足す。位置の「外側線は 幅/2 − 0.4」は寸法ではなく路肩の扱いで、P8 で 第8条（第四種 0.5 m）に置き換える。

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

# 残課題

P8（一般道）:

- 車線数の 2 方針（painted／byWidth）と orbis.ts の lanesFor（2.5 m・OSM の車線）の一本化、OSM `lanes` の取り込み、`basis` の記録。
- `KERB_INSET` の各値を断面の路肩に置き換える（路面・車・矢印の位置が変わる）。`line.width` の直接の読み取り約 117 か所を `carriagewayWidth` へ移す。
- 中央線・停止線・横断歩道・◇の寸法を標識令 別表から確かめる。

P3・P6（高速道路をグラフへ）。2026-11-10 レビューの指摘で、P2 では直さず記録だけにしたもの:

- trafficControl の進入路を `hasRoadside` で判定しているので、ランプ端の信号の接近路が作られない。P6 で信号の述語を分ける。
- guidePlan の matchRouteSteps（路線番号の対応付け）は `isDrivable("navigation")` を使っているが、意味は案内標識の路線なので RouteUse に "guide" を足す。regulations.ts の exitDirections（矢印の向き）は `takesJarticRules` で出口を数えており、ランプへの出口を数えない。
- `isDrivable` は構造（tunnel・cut は P9 まで走れない）を見ていない。structure の軸を足す。
- policePatrol は出現・巡回の道路選びにも `allowsRoadsideStop` を使っている（寄せて止まる以外の意味も混ざる）。
- 起点探索（main.ts placeOnStreet、autoDriver の bestStart など）は `nearest` 経由で地上だけを見る。高架の上の車には `nearestOnSurface` が要る。
- planMarkings は断面の路肩・中央帯を見ない（外側線は 幅/2 − 0.4、中央線は 0）。デッキの区画線に使う前に断面から位置を出す。
- `nearestOnSurface` の地形の既定は 0（`graph.ground` を地形に結ぶまで）で、垂直ゲートは車道の幅を見ない（横に 30 m 離れた別の層の道路でも高さが合えば拾う）。
- `src/expressway/section.ts` の CrossSection（basis: statute / assumption、中央帯なし）・RoadClass（expressway | ramp）・carriagewayWidth と、laneChange.ts・roadClass.ts の同名の型・関数を 1 つにする。高速の区間は `line.section` を持たせる（区間の lanes と sectionOf がそれを読む）。

[^code]: 実装

[^tests]: 直書き禁止・述語・層つき検索・断面・MarkingPlan のテスト

[^invariance]: 変更前のコードで取ったスナップショットとの一致

[^perf]: perf-road-worker と perf-road-streaming の新・旧・新の交互計測
