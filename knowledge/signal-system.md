---
type: Reference
title: 信号灯器の宣言と施行令第3条の 3 層テスト（T1）、現示表と permits・右折矢印・保留つき信号無視（T2）、OSM 信号タグの集計と単路の押ボタン式（T3）、歩車分離・時差式・点滅・交差点の押ボタン（T4）
description: 信号灯器の型（横 3 灯・縦 3 灯・矢印段付き・歩行者 2 灯）と取付を src/signals に zod で宣言し、灯の位置を lampLayout(def) の 1 関数から出して Blender（assets/signals/heads.json 経由）とゲームで共用した記録。施行令第3条（横型は右から赤・黄・青、縦型は上から）を定義と実行時の配置（運転者のカメラへの投影）でテストし、glb が lampLayout と同期していること（レンズ位置のノードと heads.json の SHA-256）も検査する。矢印段の配置は第3条ではなく慣行で、一次情報は未確認。寸法の一次情報も未確認のため status は draft。多視点レンダーのレビューは 6 周で収束。T2（2026-11-10）で現示表（Step / SignalPlan、テンプレート twoPhase・twoPhaseWithRightArrow）を宣言し、twoPhase が旧 lightState・歩行者灯と全時刻で一致することをテストで固定、第3条第2項の順序と安全の性質を全テンプレートで検査、施行令第2条の読み方を permits(step, group, movement) の 1 か所にして信号無視・自動運転・交通 AI・歩行者・音響・HUD が通るようにした。右折矢印での転回は、第2条の表には無いが道路交通法施行規則 別表第一の二（右向きの矢印＝「右折し、又は転回することができることとなるもの」）で可と確かめ、permits を原文どおりにした（レビューで訂正、初版は「未確認」）。矢印のあとに黄を出すかは一次情報（警察庁 丁規発第50号）を読めず、保守側（自動運転は止まれる時だけ止まる、矢印消灯から 3 秒は記録しない）にした。信号無視は矢印が出ている間に停止線を越えたら保留し、交差点を出た腕で確定する。右折矢印は OSM turn:lanes の右折専用車線がある接近路の軸に出す仮の規則（23 区で該当 707 接近路、うち信号から 55 m 以内 684）。ヘッドレス Chrome の多視点撮影は 3 周（2・3 周目は新しい指摘なし）。T3（2026-11-10）で T2 の残り W4・W5（driverAction・crossingVerdict の網羅 switch、LightState の点滅・消灯、planForJunction の { plan, groupOf }、現示表の walkers 宣言、conflicts 必須、source を assign が渡す）を挙動不変で片付け、関東 pbf から 23 区の信号ノード 37,491 点のタグを集計した（button_operated 3,188・traffic_signals:sound 2,930・traffic_signals:direction 3,485 など）。信号タイルを [lon, lat] のまま後方互換で [lon, lat, flags, bearing] に拡張し、単路（OSM の車道の交差点節点から 25 m 超）の crossing=traffic_signals 428 点（うち button_operated=yes 37）を単路の横断歩道の信号として出す。押ボタン式は現示表 pushButton（onDemand、歩行者が押した時だけ 黄→全赤→歩行者青→点滅→全赤）、押ボタン箱は岐阜県警の工事共通仕様書（地上 900 mm 以上・高さ 200 mm）に拠り、幅などは仮定。歩行者 AI は箱へ寄って押し、縁石で待つ。音響式は traffic_signals:sound に従う（無ければ従来どおり鳴らす）。多視点（Blender と丸の内の実在の押ボタン式 1 か所のヘッドレス Chrome）は 4 周で収束。 T4（2026-11-11）で OSM の crossing:scramble・blinker（常時と conditional の窓）・夜間点滅式・note の点滅色と時差式の先に／後から・button_operated=yes/night をタイルに入れ、テンプレート scramble（全車両赤で全歩行者と斜め横断）・staggered（同じ道路の 2 方向で青の終わりをずらし、補助標識に当たる「時差式信号」板を灯器の下に）・nightFlash（主道路 黄・従道路 赤の点滅、歩行者灯消灯）・withWalkButtons（交差点の押ボタン、車両は定周期で歩行者の青だけ押した時）を足して全テンプレートに第3条第2項と安全の性質（歩車分離の全赤、時差式の右矢印と対向の衝突）を掛けた。施行令第2条の点滅を permits・driverAction（fullStop）・crossingVerdict で原文どおりにし、赤の点滅で一時停止しないのは 施行令 別表第六 備考 17 の 信号無視（点滅）（普通車 7,000 円、別表第二 2 点）と一次情報で確かめて記録する。自動運転・交通 AI は赤の点滅で一時停止してから進む。歩行者 AI の斜め横断、歩車分離の音響式は 1 種の鳥。多視点（渋谷・新橋・新宿一丁目南・秋葉原、昼夜 30 コマ）は、レビュー対応（夜への切り替えを変更できる時点と移行段に作り直した）のあと 3 周で収束（Critical・Warning 0、Info 1 は探りで確認して閉じた）。
tags: [assets, traffic-law, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-10T12:50:00Z }
verified:
  - { by: process:vitest, at: 2026-11-11T17:00:00Z }
  - { by: claude-opus-5-5, at: 2026-11-11T16:50:00Z }
  - { by: process:vitest, at: 2026-11-11T02:30:00Z }
  - { by: claude-opus-5-5, at: 2026-11-11T02:20:00Z }
  - { by: process:vitest, at: 2026-11-10T23:40:00Z }
  - { by: claude-opus-5-5, at: 2026-11-10T23:35:00Z }
  - { by: process:vitest, at: 2026-11-10T12:45:00Z }
  - { by: claude-opus-5-5, at: 2026-11-10T12:40:00Z }
  - { by: process:vitest, at: 2026-11-10T10:35:00Z }
  - { by: claude-opus-5-5, at: 2026-11-10T10:30:00Z }
sources:
  - id: law
    resource: https://laws.e-gov.go.jp/law/335CO0000000270
    title: 道路交通法施行令 第3条（信号機の灯火の配列等）。e-Gov から取得した本文で確認
    author: e-Gov 法令検索
  - id: heads-test
    resource: tests/signalHeads.test.ts（定義の第3条、矢印段の慣行、寸法の固定、heads.json と glb の鮮度・同期）
    title: 定義の第3条テストと glb の同期検査
    author: claude-opus-5-5
  - id: placement-test
    resource: tests/signalPlacement.test.ts（実際の TrafficControl で十字路を作り、1 周期の点灯を運転者のカメラに投影）
    title: 実行時の配置（運転者のカメラへの投影）の第3条テスト
    author: claude-opus-5-5
  - id: before-after
    resource: 変更前のコードで同じ十字路の全 InstancedMesh の行列を書き出し、変更後と比較（7 メッシュ 32 インスタンス、1e-6 で丸めた集合が一致。灯の並び順だけが 青黄赤→赤黄青 に変わった）。signals.glb は旧スクリプトの再生成が既存ファイルとバイト一致することを確かめてから、新スクリプトの出力と既存 6 メッシュの Draco 圧縮バイトを比較し一致
    title: 挙動不変の確認
    author: claude-opus-5-5
  - id: review
    resource: scripts/blender/signals.py の preview（just make-signal-model <dir>）で 5 型 × 正面・斜め 30°・60°・運転席 30 m を Cycles で描き、目視で 6 周
    title: 多視点レビュー
    author: claude-opus-5-5
  - id: kisoku
    resource: https://laws.e-gov.go.jp/law/335M50000002060 （e-Gov 法令 API v2 で 2026-09-01 施行版の本文を取得し、「矢印」「転回」で全文検索。第4条第2項と別表第一の二）
    title: 道路交通法施行規則 別表第一の二（灯火の矢印の種類及び形状）
    author: e-Gov 法令検索
  - id: npa-arrow
    resource: https://www.pref.kumamoto.jp/uploaded/attachment/270704.pdf （熊本県警 熊交規第225号、令和6年4月12日。警察庁丁規発第50号・令和6年3月26日を転達し、本文は警察庁のサイトを参照とするだけ。警察庁の本文は検索で見つからず未読）
    title: 右折矢印信号現示による制御に関する運用指針の制定について（通達）
    author: 熊本県警察
  - id: law-2
    resource: https://laws.e-gov.go.jp/law/335CO0000000270 （e-Gov から取得した施行令の本文、第2条の表と第3条第2項を原文で読んだ）
    title: 道路交通法施行令 第2条（信号の種類及び意味）・第3条第2項（表示の順序）
    author: e-Gov 法令検索
  - id: plan-tests
    resource: tests/signalPlans.test.ts（旧 lightState・歩行者灯の式を写した参照と 2 周期 × 5 オフセット × 0.05 秒刻み＋整数秒の前後で一致、全テンプレートの第3条第2項と安全の性質、違反する現示表を落とすこと、permits の表、movementOf、右折矢印の規則）・tests/signalPlacement.test.ts（実際の TrafficControl で、既定の十字路のオフセットが旧ハッシュと一致し 2 周期の主灯と歩行者灯が旧式と一致、右折専用車線のある十字路で矢印灯器が主道路の 2 流入だけに付き、矢印は 6 秒だけ点いて運転者の画面で赤の真下・右向き）
    title: 現示表と twoPhase 一致のテスト
    author: claude-opus-5-5
  - id: red-light-tests
    resource: tests/redLight.test.ts（赤で直進は停止線で即記録、青・黄は記録しない、右矢印で右折は記録しない、右矢印で直進・左折は出た時に記録、右矢印で転回は記録しない（施行規則で可）、permits が unconfirmed の移動は記録しない、交差点内で 60 秒止まっても越えた時の灯で決まる、停止線の後ろへ下がったら記録せず破棄、降車で破棄、次の停止線を越えたらその時の進む向きで確定）。tests/signalPlacement.test.ts の「信号無視 in the running junction」（実際の TrafficControl と game/signalViolations.ts で矢印中の右折は記録なし・直進と左折は記録、矢印消灯 1 秒後の右折は猶予で記録なし・黄のあとの赤は記録、幅 40 m の大通りでも全流入路で停止線が exitM の内、停止線 26.5 m の右折を出た腕で判定）と、自動運転・交通 AI の矢印での移動の読み取り
    title: 保留つき信号無視のテスト
    author: claude-opus-5-5
  - id: t2-shots
    resource: ヘッドレス Chrome（開発サーバー 5199 番、丸の内二丁目 35.68043, 139.76424 の右折専用車線のある交差点）で、信号の時計を固定して青・黄・赤＋右矢印・全赤・交差の青の各現示を、停止線から 10・30・60 m の運転席・右 9 m の斜め・灯器の 14 m 手前の望遠で、昼と夜に撮影（scratchpad の signals-t2/round1〜3、各コマの JSON に permits の値と矢印の点灯を記録）。3 周目は反対方向の流入路の灯器
    title: 多視点撮影（T2）
    author: claude-opus-5-5
  - id: t3-census
    resource: just count-signal-tags（scripts/signal-tags.ts。.cache/osm の Geofabrik 関東抽出、複製時刻 2026-10-03T20:20:50Z。23 区の外接矩形 35.48–35.84N・139.55–139.93E の highway=traffic_signals と crossing=traffic_signals / crossing:signals=yes の全ノード）
    title: OSM 信号タグの集計（T3）
    author: claude-opus-5-5
  - id: gifu-spec
    resource: https://www.pref.gifu.lg.jp/uploaded/attachment/357093.pdf （岐阜県警察本部「交通安全施設整備工事共通仕様書（信号機及び交通管制システム工事編）」第5節 押ボタン箱設置工事と「押ボタン箱標準設置姿図」。pdftotext で本文を読んだ）
    title: 押ボタン箱の取付（電柱抱込式、歩行者用は地上 900 mm 以上、姿図の 200 mm）
    author: 岐阜県警察本部
  - id: t3-tests
    resource: tests/signalCrossing.test.ts（実際の TrafficControl で単路の押ボタン式を作り、制御機・灯器・押ボタン箱の数、押すまで車両青で押すと 黄→全赤→歩行者青→点滅、おまちください灯、再構築をまたいで歩行が続くこと、信号無視・交通 AI・自動運転が permits で止まる、button=no は定周期、traffic_signals:sound=no で鳴らない、タグの無い古いタイルでは何も出ない、歩行者が箱へ寄って押し縁石で待って歩行者青で渡る）・tests/signalPlans.test.ts（pushButton・crossingFixed の第3条第2項と安全、driverAction・crossingVerdict の表、walkers・conflicts の必須、OnDemandRun）・tests/signalTags.test.ts（タイルの符号化と後方互換、コミットしたタイルの全件）・tests/signalHeads.test.ts（押ボタン箱の glb と寸法）
    title: T3 のテスト
    author: claude-opus-5-5
  - id: t3-shots
    resource: scripts/blender/signals.py の preview（just make-signal-model <dir>、押ボタン箱を柱に付けて正面・斜め 30°・60°・歩行者目線・柱全体・運転席 30 m）と、ヘッドレス Chrome（開発サーバー 5361 番、丸の内の単路の押ボタン式 35.67898, 139.765519、信号の時計を固定して 待機・押した直後・歩行者青・点滅 を 運転席 10/30/60 m・歩行者目線・箱の正面・真上、昼と夜）。scratchpad の t3/blender-r1・t3/shots/round1〜4
    title: 多視点レビュー（T3）
    author: claude-opus-5-5
  - id: t3-compare
    resource: ヘッドレス Chrome で 3 地点を読み込み、ページ内で道路網（computeRoadNetwork）を作り直して、TrafficControl をタグあり・T3 前の読み方の 2 通りで組み、交差点の制御機の数と節点を比べた（scratchpad の t3/compare.mjs）
    title: タグありとタグなしの信号交差点の比較
    author: claude-opus-5-5
  - id: arrow-count
    resource: public/data/turnlanes（OSM turn:lanes、1,099 接近路）を集計（scratchpad の t2/count.ts）。right だけの車線を持つ接近路 707、そのうち OSM の信号機から 55 m 以内 684、60 m 格子で数えた交差点の目安 451。丸の内周辺を読み込んだゲームでは信号の制御機 73 のうち 2 が twoPhaseWithRightArrow（road_network_built の rightArrows）
    title: 右折矢印の候補の件数
    author: claude-opus-5-5
  - id: t4-census
    resource: scratchpad の t4/census4.mts・census5.mts（T3 の集計ノード 37,484 点に src/signals/osmTags.ts の phaseOf を掛け、60 m 以内を 1 場所にまとめた）と、just rebuild-signal-tiles のログ osm_parsed（signalTags の scramble 6・buttonNight 4・flash 14・staggered 14、kept 22,639）
    title: OSM の T4 タグの集計
    author: claude-opus-5-5
  - id: t4-tests
    resource: tests/signalT4.test.ts（scramble・staggered・nightFlash の性質、WalkCalls、isInWindow、phaseOf と記録の往復、planForJunction の事実ごとの選択、信号無視（点滅））、tests/signalT4Junction.test.ts（実際の TrafficControl の十字路で歩車分離の歩行者灯と斜め、音響の鳥、歩行者 AI の斜め横断、時差式の群と板、点滅の permits と消灯、夜の切り替えの時点、信号無視（点滅）、交通 AI の一時停止、交差点の押ボタン）、tests/signalPlans.test.ts の全テンプレート表
    title: T4 のテスト
    author: claude-opus-5-5
  - id: law-6
    resource: https://laws.e-gov.go.jp/law/335CO0000000270 （e-Gov から取得した施行令本文。別表第二 の「信号無視」2 点の欄と備考 27、別表第六 十七 の 信号無視（点滅） 普通車 7,000 円と備考 16・17）
    title: 道路交通法施行令 別表第二・別表第六（信号無視（点滅）の点数と反則金）
    author: e-Gov 法令検索
  - id: t4-shots
    resource: just shoot-views signals-t4（開発サーバー 5247 番、視点表 scripts/qa/views/signals-t4.json、4 地点 × 昼・夜の 30 コマ、.qa/views/signals-t4/round-NN）と .qa/reviews/signals-t4/round-NN.jsonl、just check-convergence signals-t4。歩行者はページ内の探り（scratchpad の t4/probe2.mts・probe3.mts）
    title: 多視点レビュー（T4）
    author: claude-opus-5-5
---

# 構成

- `src/signals/heads.ts`: 灯器の型 `SignalHeadDefSchema`（zod）と 5 型（`vehicle-h3` `vehicle-v3` `vehicle-h3-right` `vehicle-h3-arrows` `ped-v2`）。`lamps` は**右（縦型は上）から**並べる。
  - `lampLayout(def)`: 各レンズの中心と矢印の回転。座標は灯器の正面から見て +X 右・+Y 上、レンズは +Z を向く（signals.glb の規約）。
  - `housingLayout(def)`: 本体と矢印段の箱。`headHang(def)`: アームから本体中心までの下がり。
- `src/signals/mounts.ts`: 取付（`arm` 5.2 m・1.3 倍、`pole` 2.75 m・柱から 0.3 m）。歩道橋添架・共架は種類だけ。`verified: false`。灯器の `mount` が `SIGNAL_MOUNTS` を名前で引く。
- 点灯色 `LAMP_COLOURS` とレンズの前出し `LENS_Z_M` も heads.ts に 1 か所。ゲームと Blender のレビュー描画（heads.json 経由）が共用する。
- ゲームが出す灯器は `VEHICLE_HEAD`・`PED_HEAD` だけで、`signalModels.ts` はその `node` で glb の本体を読む（どれを出すかの情報源は 1 つ）。
- `src/signals/registry.ts` → `scripts/signals.ts`（`just make-signal-layout`）→ `assets/signals/heads.json` → `scripts/blender/signals.py` が型ごとに本体ノードを作る。
- 二重定義を消した: `LAMP_GAP`（signals.py と signalModels.ts）、歩行者灯の位置（signals.py の `PED_Y` と signalModels.ts の `PED_LAMP_Y`）、signalModels.ts の定数 `HEAD_HANG` と signals.py の寸法定数。`trafficControl.ts` の `HEAD_HANG` は `headHang(VEHICLE_HEAD)` から出すローカル定数として残る。灯は `lampLayout` と取付の値で置く。
- glb のシーンの extras `signalHeadsSha256` に、作ったときの heads.json の SHA-256 を書く。
- glb には各レンズの中心を空のノード `<本体>_<灯>`（例 `SignalHead_red`）で本体の子に入れた。矢印のレンズは `SignalArrowLamp`（上向きの矢印の平面。`turn` で回す）。

# 施行令第3条のテストと glb の同期

1. **定義**: 全型で赤が最も右（上）、次に黄、青。`lamps` が `[赤,黄,青]` か `[赤,青]` 以外なら zod の検査で落ちる（逆順・欠け・重複の 5 例）。第3条が配列を定めるのはこの 2 組だけで、1 灯の点滅などを禁じてはいない。それ以外の組は「未対応」として落とす。
2. **glb が lampLayout と同期していること**（第3条そのものの検査ではない）: signals.glb の JSON チャンクから `<本体>_<灯>` の平行移動を読み、`lampLayout` と 1e-5 で一致し、赤の x（縦型は y）が最大。本体ノードに回転が無い（+Z を向く規約のまま）。加えて、シーンの extras の SHA-256 が今の heads.json と一致する（定義を変えて glb を作り直し忘れると落ちる）。形状（頂点）は見ていない。
3. **実行時の配置**: 実際の `TrafficControl` で十字路（信号 4 流入・横断歩道 1）を作り、各流入路の停止線 2 m 手前・目の高さ 1.2 m のカメラに、1 周期 0.5 秒刻みで点灯中の灯を投影する。赤の時の画面 x ＞ 黄 ＞ 青で、点灯色の色相がその時の現示と一致する。歩行者灯器は対岸から見て止まれが進めより上。描画した画素は見ていない（投影まで）。

矢印段の規則（車両用横型 3 灯の下段だけ、左・直進・右の順、各列の下）は第3条ではないので、テストも別の describe に分けた。

順序（第3条第2項）の性質テストは現示表を作る T2 に回した。

# 判断

- **なぜ heads.json を介すか**: Blender 同梱の Python は TS を読めない。値を Python に写すと二重定義に戻る。
- **なぜ glb に空ノードを足したか**: ジオメトリは Draco 圧縮で、テストから頂点を読むには復号器が要る。ノードの位置なら JSON チャンクだけで読める。名前の区切りに `.` `:` を使わないのは GLTFLoader が消すため。
- **矢印は形状で作った**: 矢印のテクスチャが無いので、レンズと同じ UV の矢印形の平面にした。ゲームのレンズ材質（LED の粒・アルファの円）とインスタンス色がそのまま使える。
- **矢印段の位置**: 左は青の下、直進は黄の下、右は赤の下（慣行。第3条には矢印の定めが無い）。本体との隙間 0.04 m は規格を見ていない仮定。
- **数値の丸め**: 0.28 + 0.2 が 0.48000000000000004 になり、アームの高さが従来値と最下位ビットでずれるので、配置値はマイクロメートルに丸める。

# レビュー周回（多視点）

| 周  | 指摘                                                                       | 直したこと                                           |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | 点灯色が白っぽく、赤・黄・青を見分けにくい（AgX が明るい発光を白へ寄せる） | 表示変換を Standard に                               |
| 2   | 青が水色、黄がレモン色                                                     | ゲームの点灯色（0xff2a1a・0xffc21a・0x19e6b4）を使う |
| 3   | 青が依然シアン（発光 2.0 で緑チャンネルが飽和）                            | 発光を 1.0 に                                        |
| 4   | 点灯レンズに庇の影と日差しが載る（ゲームのレンズは非照明）                 | 基本色を黒にし発光だけに                             |
| 5   | なし                                                                       | —                                                    |
| 6   | なし（`just make-signal-model` の最終出力で、残りの視点を見た）            | —                                                    |

配列（横型は右から赤、縦型は上から赤、矢印は各列の下）・庇・取付は 1 周目から破綻なし。指摘はすべてレビュー用レンダーの設定で、モデルの形状は直していない。

# 未確認・残り

- 灯器の径・取付高さの一次情報（道路交通法施行規則）。それまで寸法は従来値のまま。
- 矢印段の配置（どの灯の下に何の矢印か、並びの順、本体との隙間）。確認先は道路交通法施行規則と警察庁の灯器の仕様書（交通信号灯器の仕様）。今は慣行に合わせた仮定。
- 縦型はゲームに出していない。矢印段は T2 で `vehicle-h3-right` だけを出した（下の「現示表（T2）」）。
- 1 灯の点滅専用・押ボタン箱の型、歩道橋添架・共架の寸法。
- ヘッドレス Chrome での画面の重心の計測（設計 7 章）は未実施。T1 では実行時の配置行列の投影で代えた。

# 現示表（T2、2026-11-10）

## 構成

- `src/signals/plan.ts`: `StepSchema`（`s` 秒、`main` 群ごとの G/Y/R/FY/FR/off、`arrows` 群ごとの青矢印、`ped` 群ごとの go/flash/stop）と `SignalPlanSchema`（`template`・`steps`・`source`・`conflicts`）。`ped.a` は群 a と並んで歩く人（b の道路を渡る人）。
  - テンプレート: `twoPhase(timing)`（既定 青 20/黄 3/全赤 2/青 15/黄 3/全赤 2、歩行者は一緒に進む群の青の最後 5 秒が点滅）、`twoPhaseWithRightArrow(groups, timing, arrowS = 6)`。歩車分離・時差式・夜間点滅・押ボタンは `FY`・`FR` の型だけで、テンプレートは T4。
  - `orderIssues`（第3条第2項）はスキーマの検査にも入れたので、順序の狂った現示表は parse で落ちる。`safetyIssues`（交差する群が同時に進めない、歩行者の横を車が動かない、黄 ≥ 3 秒、矢印は赤・黄の上だけ、交差する群の間に全赤 ≥ 1 秒）は性質テストで全テンプレートに掛ける。
  - `permits(step, group, movement)` → `go` / `stopIfAble`（黄）/ `stop` / `stopFirst`（赤の点滅）/ `unconfirmed`。`movement` は `left` `through` `right` `uturn`。
- `src/signals/movement.ts` `movementOf(tIn, tOut)`: 左・直進・右は指定方向外進行禁止の `turnBit` と同じ 35°（sin 0.57）、150° を超えたら転回。90°〜150° に折れ返す動き（145°〜150° は横成分が 0.57 未満になる）は直進ではなく、その側の右左折（レビューで修正）。
- `src/signals/assign.ts`: 右折矢印の候補の規則 `hasRightTurnLane` と `planForJunction`（下の「右折矢印の出し方」）。
- `src/signals/redLight.ts` `RedLightJudge`: 保留つきの信号無視（下の「信号無視の判定」）。
- `src/game/signalViolations.ts` `SignalViolationCheck`・`signalCrossing`: main.ts から切り出した接着（越えた停止線 → 判定器 → 記録とログ、矢印消灯の猶予）。
- 現示表は `assign.ts` がコンパイル済みでキャッシュし、同じ種類の制御機は 1 つの `CompiledPlan` を共有する。制御機の `step` は `update()` が今の道路網の制御機だけを更新するキャッシュで、再構築の前の `Approach` を持ち続けると灯と `permits` が止まる（`streetLights.ts` は自分の再構築まで approach を持つ。型の doc に書いた）。
- `TrafficControl`: 制御機ごとに現示表（コンパイル済み）と今のステップを持ち、`update()` で制御機ごとに 1 回だけステップを引く。`permits(ap, movement)` が窓口。`state(ap)` は主灯の色を返す互換の殻（HUD の色・街灯の灯のにじみ用）。`pedLight`・`mayCross`・`forEachWalking`（歩行者と音響）はステップの `ped` を読む。`lightState(seconds, offset, axis)` も twoPhase を読む互換の関数として残した。

## 施行令第2条・第3条第2項（原文で確かめたこと）[^law-2]

- **青色の灯火の矢印**: 「車両は、黄色の灯火又は赤色の灯火の信号にかかわらず、矢印の方向に進行することができること。」（多通行帯道路等通行一般原動機付自転車・特定小型原動機付自転車・軽車両の右折は直進とみなす旨が続く）。`permits` は矢印の向きの移動だけを `go` にする。
- **黄色の灯火の矢印**: 「路面電車は、…矢印の方向に進行することができること。」ゲームに路面電車は無いので扱わない。
- **転回**: 第2条の表に「転回」の語は無い（青色の灯火も「直進し、左折し、又は右折することができる」）。初版はここで止めて **未確認**（`unconfirmed`）にしたが、レビューの指摘で道路交通法施行規則を取り直し、**別表第一の二**（第4条第2項、灯火の矢印の種類及び形状）に右向きの矢印の種類として「車両等（令第二条第一項の多通行帯道路等通行一般原動機付自転車、特定小型原動機付自転車及び軽車両を除く。）が右折し、又は転回することができることとなるもの」とあるのを確かめた[^kisoku]。`permits` は右矢印の間の転回を `go` にした（信号無視にしない、自動運転と交通 AI も進める）。除外される二段階右折の原付・特定小型・軽車両はゲームが運転させないので分けていない。改正の時期（平成 24 年頃という記憶がレビュアーにある）は確かめていない。青での転回は従来どおり `go`（原文の青色の灯火は転回を挙げていないが、挙動は変えていない）。`unconfirmed` は今は消灯（`off`）だけが返す。
- **第3条第2項**: 「青色の灯火、黄色の灯火及び赤色の灯火の信号を連続して表示する場合 青色の灯火、黄色の灯火及び赤色の灯火の信号の順」、人の形の灯火は「青色の灯火、…青色の灯火の点滅及び…赤色の灯火の信号の順」。
- **設計からの逸脱（矢印のあと）**: 設計 5.3 の `rightArrow` は「青→黄→赤＋右矢印→黄→赤」だったが、矢印 6 秒 → 全赤 2 秒 で消している。主灯が 赤→黄 になるのは第3条第2項の 青→黄→赤 に反する、というのは **こちらの読みで未確認**。運用を決めるのは警察庁「右折矢印信号現示による制御に関する運用指針の制定について（通達）」（令和 6 年 3 月 26 日 警察庁丁規発第50号）だが、本文は読めなかった（熊本県警の転達文書[^npa-arrow]が番号と日付を示すだけで、本文は警察庁のサイトを見よとある）。施行令第2条の表にも、施行規則の別表にも、矢印のあとの表示の順の定めは無い。
- **保守側の手当て（W3）**: 矢印は予告なしに `go` → `stop` になるので、(1) 自動運転を交通 AI と同じ「`go` 以外で、止まれる距離があれば止まる」に揃えた（赤で止まれない距離の車が交差点に取り残されないように）。(2) 信号無視は「越えた時の許可」と「3 秒前の許可」の OR にした（`ARROW_GRACE_S`）。猶予は 3 秒前が `go` だった移動だけで、黄（`stopIfAble`）のあとの赤は従来どおり停止線で記録する。

## twoPhase 一致の確かめ方[^plan-tests]

1. 旧 `lightState` と旧 `pedLight` の式をテストに写し（参照）、twoPhase の `stepAt` と、`-45〜90 秒 × オフセット 0・17・33・44・44.5` で 0.05 秒刻み、さらに整数秒の ±1e-9 で全部一致することを確かめた。主灯・歩行者灯（`flash` を含む）とも。
2. 実際の `TrafficControl` で十字路を作り、制御機のオフセットが旧ハッシュ（交差点の経緯度、`% 45`）と一致し、2 周期 0.25 秒刻みで `state(ap)` と `pedLight` が旧式と一致することを確かめた。オフセットは「節点ごとのハッシュを現示表の周期で割った余りの最小」に変えたが、twoPhase の周期は 45 秒なので値は同じ。
3. 段の境目の比較は旧式の `t - 25 < 15` と新式の `t < 40` で、どちらも整数の足し引きで丸めが出ない範囲（Sterbenz の条件）なので、浮動小数点でも同じ側に落ちる。

## permits を通る呼び出し

| 呼び出し                                                 | 前                                       | 後                                                                                                                                                                                |
| -------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 信号無視（main.ts）                                      | 停止線を越えた時に `state(ap) === "red"` | `game/signalViolations.ts` → `RedLightJudge`（全移動が `stop` なら即記録、一部だけなら保留、矢印消灯から 3 秒は猶予）                                                             |
| 自動運転（autoDriver.ts `blockAhead`・`isWaitingPoint`） | `state` が赤、または黄で止まれる         | `permits(ap, 経路の移動)`。経路の移動は節点の `exitM` 先の経路の向きと流入の向きで決め、経路がその前に終わるなら直進（保守側）。`go` 以外は止まれる時だけ止まる（交通 AI と同じ） |
| 交通 AI（traffic-ai.ts `stopGap`）                       | `state !== "green"` で止まれる           | `permits(ap, 次に選んだ道路への移動)`。大交差点の内側の短い区間だと本当の曲がりが 1 つ先になるが、直進と読んで止まる（保守側）                                                    |
| 歩行者・音響                                             | 旧 `pedLight` の式                       | ステップの `ped`（同じ値）                                                                                                                                                        |
| HUD                                                      | 主灯の色                                 | 主灯が赤で矢印の向きが `go` の間は「赤・右折矢印」（右だけ）か「赤・矢印」                                                                                                        |

## 信号無視の判定[^red-light-tests]

- 停止線を越えた瞬間に、4 つの移動それぞれの `permits` を写して判定器に渡す。全部 `stop`（赤で矢印なし）なら従来どおりその場で記録。`stop` が 1 つも無い（青・黄）なら何もしない。黄は従来どおり記録しない（安全に止まれない場合は第2条が認めており、ゲームはそれを見分けない）。
- 一部だけ `stop`（赤＋右矢印）なら **保留**（`signal_crossing_held`）。車が節点から `exitM`（制御機の節点群の広がり＋20 m、停止線までの距離＋10 m、最小 25 m）離れた時の進む向き（前回位置からの移動方向。止まっていれば車の向き）で移動を決め、越えた時の `permits` がその移動で `stop` なら記録（`signal_crossing_resolved` outcome=violation）、`unconfirmed`（転回）なら記録しない、それ以外は permitted。
- **交差点内で止まった**: 保留を続け、何秒待っても越えた時の灯で決める（第2条が禁じるのは停止位置を越えること）。
- **引き返した**: 停止線の 1 m 後ろへ、流入側（中心線の左）に戻ったら、移動が決まらないので記録せず破棄（reason=backedOut）。転回は中心線の右側を戻るので破棄にならず、exitM で判定する。
- **車を降りた・ワープ**: 記録せず破棄（reset）。
- **保留のまま次の停止線を越えた**: その交差点は出たので、その時の進む向きで確定する（初版は破棄していた）。
- **exitM の下限（レビューで修正）**: 初版は「節点群の広がり＋20 m、最小 25 m」だけで、停止線が節点から 25 m より遠い（停止線は交差道路の半幅＋1.5＋5 m、JARTIC ならさらに最大 15 m 奥）と、越えた瞬間に「直進」で確定していた（幅 40 m の大通りを渡る脇道で 26.5 m）。停止線までの距離＋10 m を下限に足し、全流入路で停止線が exitM の内にあることをテストにした。

## 右折矢印の出し方（仮の規則）

- `hasRightTurnLane`: OSM の `turn:lanes` に `right` だけの車線がある接近路。JARTIC から車線数で推定した進行方向別通行区分（`source: "assumed"`）は数えない（右折専用はゲームの推定であって調査ではない）。
- その接近路の軸（群）に twoPhaseWithRightArrow の矢印を出し、同じ群の両方向の流入路に `vehicle-h3-right`（T1 の矢印段付き灯器）を下げる。片側だけに矢印を出すのは時差式で T4。
- **仮定**: 右折専用車線のある交差点では右折矢印を出していることが多い、という一般論で、警視庁の設置一覧などの一次情報は見ていない。設計 5.3 の「対向が 2 車線以上」の条件も入れていない。T3 の OSM タグの集計のあと置き換える。
- 件数[^arrow-count]: OSM turn:lanes 1,099 接近路のうち、`right` だけの車線を持つもの 707、OSM の信号機から 55 m 以内 684（60 m 格子で約 451 交差点）。turn:lanes 自体が 23 区のごく一部にしか無い。丸の内周辺を読み込んだゲームでは制御機 73 のうち 2。
- 矢印段の下端は描画倍率 1.3 で地面から約 4.37 m（実寸なら 4.56 m）。主灯の中心 5.2 m を T1 の約束どおり変えていないため。

## 多視点の確認（ヘッドレス Chrome）[^t2-shots]

| 周  | 見たもの                                                        | 指摘                                                                                                                                                                      | 直したこと                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | 東行きの流入路の灯器、昼・夜、5 現示 × 10・30・60 m・斜め・望遠 | 配列（赤が右、矢印は赤の下で右向き）と点灯（赤＋右矢印は黄の直後の 6 秒だけ、全赤で消える）は正しい。HUD が赤＋右矢印の間も「赤」とだけ出し、右折する運転者に待てと読める | HUD に「赤・右折矢印」を足した（ja・en・zh） |
| 2   | 同じ視点を撮り直し                                              | なし                                                                                                                                                                      | —                                            |
| 3   | 反対（西行き）の流入路の灯器、昼・夜                            | なし                                                                                                                                                                      | —                                            |

- 消えている矢印は、夜は灯の消灯色で矢印の形がうっすら見える（実物の LED 灯器も消灯時に形が見えるので直していない）。
- 撮影の 10 m の画で、反対の流入路の柱が車道の上に立って見えた。柱の位置（`clearSpot`）は T1 以前からのもので、T2 では変えていない（残り）。

## 性能

- 毎フレームの `update`: 9×9 の格子（制御機 49・流入 196・灯 588）で 1 回 0.0136 ms。T1 の「灯ごとに lightState」の部分だけを同じ灯数で回すと 0.0124 ms（こちらは `setColorAt` を含まない）なので、増えていない。`permits` は 1 回 0.03 µs。tsx の使い捨てのベンチで測った（ブラウザではない）。
- 道路網の再構築の `stagesMs.control`（信号の構築）は丸の内の 9 回の読み込みで 16〜23 ms。同じ条件の T1 の値は測っていないので、比べられていない。`just measure-perf-fixed` はミラーの A/B を測るレシピで信号を切り替えないため、使わなかった。
- 矢印灯器と矢印の灯の InstancedMesh は、矢印のある制御機が読み込まれた時だけ作る（無い所で描画呼び出しを増やさない）。

## T2 の残り

- 矢印の秒数（6 秒は仮定）、矢印のあとの黄の有無（丁規発第50号の本文で確かめる）。
- **T4 に着手する前に**（レビューの W4・W5。**T3 で片付けた**、下の「T3」）:
  - `Permission` の解釈を `plan.ts` の `driverAction(permission, canStop)`（網羅の switch）に一本化する。今は autoDriver・traffic-ai・判定器がそれぞれ `mayProceed` や `"stop"` との比較で読んでいて、`stopFirst` を足すと読み違える。
  - `LightState` に点滅と消灯を足す（今は `FY`→黄・`FR`→赤・`off`→赤に丸めている）。
  - `planForJunction` が `{ plan, groupOf }` を返し、流入路の群を現示表が決める（今は軸 0/1 → a/b を trafficControl が決め打ち）。
  - 歩行者がどの群と一緒に進むかを現示表に宣言する（今は `walkersCrossing` が a↔b を決め打ち）。
  - `conflicts` を必須にする（今は既定が空で、書き忘れると安全の検査が素通りする）。
  - `source` を `assign.ts` が渡す（今はテンプレートが決め打ち）。
- 夜間点滅・歩車分離・時差式（T4。単路の押ボタン式は T3 で入れた）。赤の点滅を一時停止の判定に載せること（`stopFirst` は型だけで、今は誰も使わない）。
- 街灯の灯のにじみ（`streetLights.ts`）は主灯の色だけで、矢印は光らせていない。
- 交通 AI は大交差点で次の 1 区間しか見ないので、矢印の間に右折できる車が止まることがある（保守側）。

# T3（2026-11-10）: OSM の信号タグ、単路の押ボタン式

## T2 の残り W4・W5（挙動不変）

- `plan.ts` に網羅の switch を 2 つ置き、`Permission` の読み方をそこだけにした。`driverAction(permission, canStop)` → `go`/`stop`（自動運転・交通 AI・HUD・信号無視の猶予の「3 秒前は進めたか」）と `crossingVerdict(permission)` → `booked`/`allowed`/`unconfirmed`（`RedLightJudge`・`signalViolations.ts`）。`mayProceed` は消した。`Permission` を足すと switch の `never` で型検査が落ちる。表はテストで固定し、T2 と同じ値（`go` 以外は止まれる時だけ止まる、記録するのは `stop` だけ）。
- `LightState` は `green`/`yellow`/`red`/`flashingYellow`/`flashingRed`/`off`。灯の点灯・街灯のにじみ（点滅は色だけ、消灯は 0）・HUD（ja・en・zh の文言と CSS）がそれぞれ扱う。今のテンプレートは点滅・消灯を出さないので見た目は変わらない。
- `planForJunction(approaches: {axis, lanes}[])` → `{ plan, groupOf }`。流入路の群は現示表の選び手が決め、`trafficControl` は受け取るだけ。
- 現示表に `walkers`（歩行者の群ごとに `across`＝渡る道路の群、`alongside`＝並んで歩く群）を宣言した。`pedLight` は「その道路の群を渡る歩行者」を `walkers` から引く（`walkersCrossing` の a↔b 決め打ちを削除）。安全の検査も `walkers` を読み、歩行者の青の前後に `MIN_ALL_RED_S` の空きがあることを足した。
- `conflicts`・`walkers` は必須（既定値なし）。`source` はテンプレートの引数で、`assign.ts` が渡す（twoPhase は `default`、右折矢印は `inferred`、押ボタン式は `osm`）。
- 確かめ方: 既存の twoPhase 一致（旧式と全時刻）・配置・信号無視のテストが全部そのまま通る（1,168 → 1,215 件、増えた 47 件は T3 の新しいテスト）。

## OSM の信号タグの集計[^t3-census]

23 区の外接矩形で、`highway=traffic_signals` か `crossing=traffic_signals`（`crossing:signals=yes`）のノードは **37,491**。交差点節点は「車道（motorway〜living_street と _link。service は除く）の way の端か途中が 3 本以上集まるノード」。

| 種類 / 位置                                     | 交差点節点 | 25 m 以内 | 25 m 超 | 車道の上に無い |
| ----------------------------------------------- | ---------: | --------: | ------: | -------------: |
| `highway=traffic_signals`（crossing なし）      |     13,272 |     4,354 |     774 |            195 |
| `highway=traffic_signals` + `crossing=…signals` |        732 |       140 |      43 |              6 |
| 横断歩道のノードだけ（`highway=crossing` など） |        183 |    16,010 |     385 |          1,397 |

| タグ                        | 件数（値ごと）                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `traffic_signals`           | 6,218（signal 5,590・traffic_lights 410・on_demand 146・pedestrian_crossing 39・crossing 9・blinker 7・ほか） |
| `traffic_signals:direction` | 3,485（forward 2,521・backward 902・both 55・数値など 7）                                                     |
| `button_operated`           | 3,188（no 2,595・yes 588・night 4・optional 1）                                                               |
| `traffic_signals:sound`     | 2,930（no 1,954・yes 948・walk 18・locate 10）                                                                |
| `traffic_signals:vibration` | 2,055（no 1,850・yes 205）                                                                                    |
| `traffic_signals:countdown` | 88（yes 87・no 1）                                                                                            |
| `traffic_signals:turn`      | 14                                                                                                            |
| `crossing:signals`          | 2,830（yes）                                                                                                  |
| `crossing_ref`              | 705（zebra 672・tiger 19・pedestrian_scramble 6・pelican 5・toucan 3）                                        |
| `crossing:scramble`         | 6（yes）                                                                                                      |

- **単路の横断歩道の信号**（`crossing` の付いたノードで、車道の上にあり、交差点節点から 25 m 超）: **428**。`button_operated` は yes 37・no 31・無し 360、`traffic_signals:sound` は yes 20・no 33・無し 375、`traffic_signals:direction` は 5 だけ。
- 規則にしたもの: 単路（形）、`button_operated=yes/no`（押ボタン式か定周期か）、`traffic_signals:sound`（音響式）。件数が少なく規則にしなかったもの: `traffic_signals=blinker`（7、夜間点滅は T4）、`traffic_signals:turn`（14、右折矢印の規則は T2 のまま）、`crossing:scramble`（6、歩車分離は T4 の許可リストで）、`traffic_signals:countdown`（88、残り時間表示は灯器の型が無い）、`traffic_signals:vibration`（ゲームに振動の出し先が無い）。`traffic_signals:direction` は向き（方位）にしてタイルに入れたが、単路の 428 点では 5 点にしか無いので、両方向に灯器を出している（片側だけの信号は T4 の時差式と一緒に扱う）。
- 交差点の近くの横断歩道のノード 16,010 点はタイルに入れていない（交差点の信号ノードと重なるだけ）。`traffic_signals:sound` の付いたものだけは、横断歩道ごとの音響式のために入れた。

## タイルの形（後方互換）

- `public/data/signals/*.json` の 1 件は `[lon, lat]`（従来どおり。タグの無いもの 14,827 件）、`[lon, lat, flags]`（4,346 件）、`[lon, lat, flags, bearing]`（3,264 件）。合計 22,437 件で、うち 19,516 件は従来の `highway=traffic_signals` で位置と順序は T2 までと同じ（比べて確かめた）、2,921 件が横断歩道のノードだけのもの（単路か音響のタグ付き。`traffic_signals:sound=locate` だけのものはレビュー後に外した）。
- `flags` のビット（`src/signals/osmTags.ts` `SIGNAL_FLAG`）: 1 交差点節点から 25 m 超・2 crossing=traffic_signals・4 highway=traffic_signals が無い・8/16 button yes/no・32/64 sound yes/no。`bearing` は direction の forward/backward を way の向きから方位（度）にしたもの。
- `src/world/regulations.ts`（触らない約束）は `[lon, lat]` だけを読むので変えていない。タグは `roadNetworkData.ts` が同じ入力から `signalRecords`（`applied.signals` と同じ順）として作り、`TrafficControl.setNetwork(graph, regs, records)` に渡す。タグの無い呼び出し（テスト・古いタイル）は全部「交差点の信号」として従来どおり読む。
- 交差点の信号には、`highway=traffic_signals` だけを寄せる（従来どおり）。横断歩道だけのノードは寄せない。単路のまとまりのうち **制御機を作るもの** のレコードと、その 30 m 以内の「交差点から 25 m 超の信号ノード」（単路の横断歩道を「横断歩道のノード＋両側の信号ノード」で描く書き方）も寄せない。制御機を作らない単路（横断歩道が無いなど）の `highway=traffic_signals` は従来どおり寄せる（レビュー W2 で修正。初版は無条件に外し、従来あった交差点の信号が消えうる作りだった）。
- 再生成: `just rebuild-signal-tiles`（`REGS_USE_CACHE=1 pnpm exec tsx scripts/regulations.ts signals`）。`REGS_USE_CACHE=1` は 1 週間より古い `.cache/osm` もそのまま使う（新しい抽出を落とすと junctions・footbridges・turnlanes・police・places も全部動き、差分が埋もれるため）。タイルの中身がバイト一致の層はディレクトリごと書き換えない（`osm_layer_unchanged`。meta・LICENSE も）。`meta.json` の `extract` は抽出の複製時刻（2026-10-03T20:20:50Z）、`fetchedAt` はキャッシュを落とした時刻（ファイルの更新時刻、2026-10-04T11:10:41Z）。初版は実行時刻を `fetchedAt` に書き、データの時点を誤って示していた（レビュー W3 で修正）。

## 単路の横断歩道の信号

- `TrafficControl.buildCrossingSignals`: 単路のレコードを 30 m でまとめ、各まとまりに JARTIC の横断歩道（15 m 以内、区間ごとに最寄り 1 本。中央分離帯で区間が 2 本なら 2 本）を対応付け、渡る区間の両方向（一方通行は 1 方向）に流入路を作る。停止線は JARTIC の停止線が横断歩道の中心の 2.5〜12 m 手前にあればそれ、無ければ 4 m 手前（仮定）。流入路の `node` は横断歩道の中心、`exitM` は 25 m か停止線＋10 m。
- 作らない場合（ログ `signal_crossings_skipped`）: 道路網の外（タイルの方が広い）、横断歩道が無い、信号交差点の節点から 30 m 以内（その交差点の信号が受け持つ）、区間に停止線を置く余地が無い。丸の内周辺では単路のまとまり 19 のうち、作ったのは 2（うち押ボタン式 1）、横断歩道なし 10（道路網の外を含む。`outside` を分けたのはこのあと）、交差点の近く 7。
- 現示表: `pushButton`（`button_operated=yes`、`onDemand`）と `crossingFixed`（no または無し。同じ段の定周期）。段は 車両青（押ボタン式は最短 20 秒の待機）→ 黄 3 → 全赤 2 → 歩行者青 12 → 点滅 5 → 全赤 2、秒数はすべて仮定。群は車両 `v`・歩行者 `p`（`walkers: { p: { across: "v" } }`）。第3条第2項と安全の性質（歩行者の青の前後の空きを含む）は全テンプレートの表に入れてある。
- **押ボタン式の動き**（`OnDemandRun`）: 待機は段 0。押されると、待機が最短の秒数を過ぎていればその時から 1 回だけ走り、終わると待機に戻る。歩行が始まる前・青の間の押しは「もう応えている」として捨て、点滅・全赤の間の押しは次の回に回す。時計が戻った（リプレイ）ら走りを捨てる。制御機の状態は横断歩道の OSM ノードの経緯度のハッシュで覚え、道路網の再構築をまたいで歩行が途切れない。信号無視の猶予（3 秒前の段）は走りの記録から引く。
- **灯器**: 両方向とも横断歩道の 3.5 m 先の左に車両用 3 灯横型（交差点と同じアームと高さ）。歩行者用 2 灯は横断歩道の両端。両端の近く（7 m 以内）に車両用の柱があれば、歩行者用灯器と押ボタン箱はその柱に付け（共架）、柱を 2 本並べない（多視点の 1・2 周目の指摘）。
- **押ボタン箱**[^gifu-spec]: 歩行者用押ボタン箱は柱に電柱抱込式、地上 900 mm 以上（下端を 0.9 m にした）、姿図の 200 mm を箱の高さと読んだ。幅 0.13・奥行き 0.08 m、ボタン径 50 mm、おまちください灯 80 × 26 mm と色は仮定（`verified: false`）。岐阜県の工事仕様であって警視庁・警察庁のものではない。箱は横断歩道の方を向き、押されてから歩行者青までおまちください灯（赤）が点く。
- **歩行者 AI**（`sidewalks.ts`）: 単路の横断歩道を渡る人（従来どおり 3 割）は、押ボタン式なら先にその端の箱の前へ寄って押し、縁石で待つ。待っている間も押し直す（歩行の前に押した分は捨てられているので、押し直さないと赤のまま待ち続ける）。`TrafficControl.buttonStand`・`pressButton` が窓口で、押しが受け付けられたら `signal_button_pressed` を 1 行書く。
- **音響式**: 横断歩道から 15 m 以内で `traffic_signals:sound` の付いた最寄りのノードに従い、無ければ制御機のノードのタグ（yes が 1 つでもあれば鳴らす）、それも無ければ従来どおり鳴らす。`forEachWalking` は鳴らさない灯器を飛ばす。
- **違反・自動運転・交通 AI**[^t3-tests]: 単路の流入路も `permits` を通る（tests/signalCrossing.test.ts で、赤で停止線を越えたら記録、青・黄は記録なし、交通 AI と自動運転は赤で止まる）。下の「レビュー対応」も見ること。

## レビュー対応（2026-11-11、C1・W1〜W4）

- **C1: 「信号の停止線は区間の末端の手前」という暗黙の約束**を単路が破り、読む側の 3 か所が誤っていた。`Approach` に `site`（`junction` / `crossing`）・`toNodeM`（停止線から節点までの進行方向の距離）・`head` / `headBase`（灯器と柱を置く基点）を持たせ、読む側を直した。それぞれ先に再現テストを書いて落ちることを確かめてから直した（tests/signalCrossingSiting.test.ts）。
  - (a) 街灯のにじみ（`streetLights.ts`）は灯器の位置を区間の末端の節点から計算し直していて、単路の灯器のにじみが 155 m 先の交差点に出ていた。`ap.head` を読むようにし、計算の複製をやめた（交差点では従来の「末端の先 +2.5 m」から灯器の実際の位置「+1 m」に変わる）。
  - (b) `autoTraffic.ts` `junctionsAhead` が `nextStop` で手前の単路の停止線を拾い、信号交差点を無信号と読んでいた（第36条の譲りに入る）。交差点の停止線（`site === "junction"`）だけを引くようにした。非公開の `Controller` 型を読んでいた箇所（S2）も消えた。
  - (c) 自動運転（`blockAhead`）と交通 AI（`stopGap`）が今の区間の停止線しか見ず、区間に入って 1 m 先の単路の停止線を見つけた時には止まれない距離だった（10 m/s で 30 m 手前から `Infinity`）。経路（交通 AI は選んだ次の道路）の次の区間の信号の停止線まで先読みする。先読みした信号の移動は直進と読む（保守側）。
  - 自動運転の節点までの距離は `ap.toNodeM`（`stopToNode` は削除。停止線の中点と節点の直線距離だったので横ずれを含んでいた）。`controller?.kind === "crossing"` の散在は `ap.site` にまとめた。
- **W1**: 待っている歩行者は、箱へ寄ったかに関係なく毎回押す（押ボタン式でなければ何もしない）。単路の制御機の歩行者灯は自分の横断歩道（中心から 3 m 以内）だけを照らす。初版は 30 m 以内なら交差点の角の横断歩道まで単路の赤にしていた。
- **W2**: 距離の閾値を `src/signals/siting.ts` の 1 か所にまとめた（25 m の判定は OSM 側と GSI 側の 2 つに分けて名前を付けた）。横断歩道は「単路のレコードが 8 m 以内に載っている区間」のものだけを対応付け、15 m 以内の脇道の横断歩道を拾わない。`scripts/osm-signals.ts` の判定を純関数 `classifySignalNodes` に分け、フィクスチャのテストを足した（tests/osmSignals.test.ts）。
  - **タグありとタグなしの比較**[^t3-compare]: 同じ道路網で、タグあり（今）と「T3 前と同じ読み方」（`highway=traffic_signals` だけ、タグなし）の信号交差点の制御機を数えた。丸の内（35.67898, 139.765519）85 → 83（失ったもの 2、増えたもの 0、単路 2 うち押ボタン式 1）、新宿（35.6905, 139.7004）67 → 66（失 1・増 0、単路 3）、池袋（35.7295, 139.7109）55 → 55（単路 2）。失った交差点は、OSM では交差点から 25 m 超の単路の信号を、GSI の細い道との節点（25 m 以内）に寄せていたもの。単路の制御機ができた所だけで起きる。
- **W3**: 上の「再生成」のとおり。
- **W4**: 単路の横断歩道の対応付けの高速道路の除外は `isMotorwayOnly(seg)`（`trafficControl.ts` のローカルな述語）にした。P2（feat/road-predicates）のマージ時に `!hasRoadside(seg)` に置き換える（コメントに書いた）。既存の `kind === "highway"` は触っていない。
- **Info**: `letsDriverGo(permission)`（HUD と矢印消灯の猶予）。`signalCount()` は交差点の制御機だけを数える（`road_network_built` の `signals` は T3 前と同じ意味で、単路は `crossingSignals`）。`traffic_signals:sound=locate`（位置を知らせる音だけ、23 区で 10）は音響式の「青の間の誘導音」ではないので、タグ無しとして扱う。クレジットの抽出元を BBBike から Geofabrik の関東抽出に直した（LICENSE と一致）。`src/world/regulations.ts:30` の `signals` の型コメント（`[lon, lat]`）は、触らない約束のため直していない（P2 の担当範囲）。
- **確かめたこと（ヘッドレス Chrome、丸の内の押ボタン式、夜）**: にじみの光源は単路の灯器 2 つの位置と一致（ずれ 0 m、横断歩道の中心から 6.3 m）、隣の信号交差点（147 m 先）の光源 3 つも灯器の位置と一致。歩行者青の間 20 秒、交通 AI の車は停止線の手前で 1 台待ち、停止線と横断歩道の間を走る車は 0（scratchpad の t3/shots/c1）。自動運転はゲーム内では走らせておらず、単体テストで確かめた。

## 多視点レビュー（T3）[^t3-shots]

| 周  | 見たもの                                                                                                                | 指摘                                                                                           | 直したこと                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Blender: 押ボタン箱（正面・30°・60°・歩行者目線・柱全体・運転席 30 m）。ゲーム: 昼の各現示 × 10/30/60 m・歩行者目線・箱 | 箱・ボタン・灯の配置と点灯は正しい。こちら側の端で車両用の柱と歩行者用の柱が 0.6 m で 2 本並ぶ | 単路では車両用の柱に歩行者用灯器と箱を共架              |
| 2   | 同じ視点＋真上                                                                                                          | 向こう側の端はまだ柱が 2 本（歩行者用の位置が柱から 7 m 離れ、4.5 m の判定に入らない）         | 共架の判定を「横断歩道の端から 7 m 以内の車両用の柱」に |
| 3   | 昼と夜（各現示 × 10/30/60 m・歩行者目線・箱・真上）、Blender の出力                                                     | なし                                                                                           | —                                                       |
| 4   | 最終のコードで昼と夜をもう一度、Blender の preview をもう一度                                                           | なし                                                                                           | —                                                       |

- 撮影の 1 周目は撮影スクリプトの時計の順序の誤り（押す前の待機を後で撮って時計を戻した）で現示がずれた。ゲームの不具合ではないので周の指摘には数えず、撮り直した。撮影ではゲームの歩行者の押しを止めている。
- 確かめたこと: 待機は車両青・歩行者赤、押した直後は黄でおまちください灯が点き、全赤ののち歩行者青で灯が消え、点滅、車両青に戻る。60 m では灯器は数画素（T2 と同じ。寸法は変えない約束）。夜は箱の灯がはっきり見え、ボタンは暗い。`just show-errors` は 0 件。
- 残り: 押ボタン箱の「おしてください」の文字や案内板は描いていない。押している手の動きは無い（箱の前に寄って向きを変えるだけ）。

## T3 の残り

- 単路の横断歩道 428 点のうち JARTIC の横断歩道が 15 m 以内にあるのは 328（押ボタン式 37 のうち 25）。無いところは出していない。
- 交差点の押ボタン（横断歩道のノードの `button_operated=yes` は交差点の近くにも多い）、`button_operated=night`、夜間点滅、時差式、`traffic_signals:direction` の片側だけの信号は T4。
- 自分（徒歩のプレイヤー）は押ボタンを押せない。
- 押ボタン式の秒数（最短の待機 20 秒・歩行者青 12 秒など）と押ボタン箱の幅・奥行きの一次情報。
- 交差点の近くの横断歩道のノードを交差点の信号に足すか（今は `highway=traffic_signals` だけを寄せる。横断歩道のノードだけが付いた交差点は信号が無いまま）。

# T4（2026-11-11）: 歩車分離・時差式・点滅・交差点の押ボタン

## OSM の T4 タグ（集計と抽出）[^t4-census]

T3 の集計と同じ 23 区の信号ノード 37,484 点に `phaseOf`（`src/signals/osmTags.ts`）を掛けた件数と、60 m 以内をまとめた場所の数。

| 事実                                                                     |  ノード | 場所 | 規則にしたか                                        |
| ------------------------------------------------------------------------ | ------: | ---: | --------------------------------------------------- |
| `crossing:scramble=yes` / `crossing_ref=pedestrian_scramble`             |       6 |    1 | する（渋谷駅前の 1 か所だけ）                       |
| `traffic_signals=blinker`（常時の点滅）                                  |       7 |    6 | する                                                |
| `traffic_signals:conditional=blinker @ (22:00-06:00)`                    |       2 |    1 | する（窓の時間）                                    |
| 夜間点滅式（`traffic_signals` の値か、`note` の全文が「夜間点滅式」）    |       5 |    5 | する（時間が無いので仮定の夜 22:00–06:00）          |
| `note` の 赤点滅 / 黄色点滅・黄点滅（方向つき）                          | 11 / 15 |    — | 点滅する交差点でだけ、その方向の色に使う            |
| 時差式（`(traffic_signals:)designation=時差式` 9、`note` に「時差式」5） |      14 |    6 | する（`note` の 先に／後から で方向、無ければ仮定） |
| `button_operated=night`                                                  |       4 |    3 | する（仮定の夜だけ押ボタン）                        |
| `button_operated=yes`（交差点から 25 m 以内）                            |     561 |  395 | する（交差点の歩行者の青を押した時だけ）            |

- 自由記述（`note`）を読むのは、23 区では時差式の向きと点滅の色がそこにしか書かれていないため。読む語は見つかった言い回し（夜間点滅式・赤点滅・黄色点滅・時差式・先に・後から・遅れて）だけ。「夜間点滅式の…」のような文中の言及は拾わない（テスト）。
- タイル: `flags` に 128 歩車分離・256 夜間の押ボタン・512 点滅・1024 夜間点滅式・2048/4096 点滅の色・8192 時差式・16384/32768 先に／後から を足し、点滅の窓は `[lon, lat, flags, bearing(-1 は無し), 開始分, 終了分]` の 6 要素にした（2 件）。交差点の近くの横断歩道のノードも、押ボタン・T4 の事実があればタイルに入れる（22,437 → 22,639 件、`just rebuild-signal-tiles`、同じ抽出、他の OSM 層はバイト一致で書き換えなし）。
- 載せないもの: `traffic_signals=on_demand`（146）・`request_button`（5）は既存の規則のまま。`note` の「夜間押しボタン式」（`button_operated` の無いもの）は読まない。

## テンプレート（`src/signals/plan.ts`）

| テンプレート      | 現示（秒は仮定）                                                                                                                                  | 選ぶ条件（`assign.ts planForJunction`）                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `scramble`        | a 青 20 → 黄 3 → 全赤 2 → b 青 15 → 黄 3 → 全赤 2 → 全歩行者（a・b・斜め x）青 22 → 点滅 8 → 全赤 3（73 秒）。車両の青の間は全歩行者が赤          | 節点の 25 m 以内に歩車分離のノード（source osm）        |
| `staggered`       | a・c（同じ道路の 2 方向）青 20（沿う歩行者は最後 5 秒点滅）→ c 黄 3（a 青）→ c 赤・a 青 6（a の右折が対向赤で抜ける）→ a 黄 3 → 全赤 2 → b の現示 | 時差式のノード。両方向の流入路が無ければ既定に戻す      |
| `nightFlash`      | 1 段 60 秒。主道路（軸 0）黄の点滅・従道路 赤の点滅、歩行者灯は消灯（`off`）。昼の現示表の群・歩行者をそのまま持つ                                | blinker（常時）、窓・夜間点滅式（夜の現示表として）     |
| `withWalkButtons` | 元の現示表のまま、歩行者の青を「押されたものだけ」にする（`onCall`、実行時の `WalkCalls`）                                                        | `button_operated=yes`（常時）、`=night`（仮定の夜だけ） |

- 時差式の向き: ノードの `traffic_signals:direction` の方位に 45° 以内の流入路が、`note` の「先に」なら c（先に赤）、「後から」なら a。その流入路の軸が時差式の道路になる。方向が分からない（designation だけ）ときは、OSM の右折専用車線のある方向を a、無ければ主道路の最初の流入路を a とする仮定（source inferred）。
- 点滅の色: 既定は設計 5.3 の「主道路 黄・従道路 赤」（仮定）。`note` の色が方向つきであればその群に使い、交差する 2 道路が両方とも黄の点滅になるなら既定に戻す（誰にも一時停止を求めない形になるため）。
- 昼と夜の切り替え（`src/signals/run.ts` `ScheduledRun`、レビューで作り直した。下の「レビュー対応（T4）」）: ゲームの時刻（`setTimeOfDay`、main.ts で `env.displayHour`）が窓に入ったら、昼の現示表の**変更できる時点**（plan.ts `isChangeMoment`: 全群が赤・矢印なし・歩行者なしで、全赤が `MIN_ALL_RED_S` 続いた時点）で夜へ入る。点滅から出るときは移行段 `flashExit`（黄の点滅 → 黄 3 秒、赤の点滅 → 赤、全赤 2 秒）を通り、昼の現示表を最初の段から始める（オフセットをその時点に移す）。押ボタンだけ違う夜の現示表（`NightPlan.kind: "buttons"`）は変更できる時点で行き来する。ログ `signal_plan_switched`。
- 交差点の押ボタン: 車両は定周期のまま、歩行者の青だけ押した時に出す（押さなければその回は赤のまま）。歩行中に赤で見えている回への押しは次の回へ。押ボタン箱は governing の流入路の歩行者群を呼ぶ箱として、各横断歩道の両端に付ける。Why not 単路の `OnDemandRun`: 交差点では交差道路の車両に青が要り、車両感知器を持たないため。
- **逸脱（仮定）**: OSM の押ボタンのノードは交差点の 1〜2 本の横断歩道にあるが、JARTIC の横断歩道の端との対応を作っていないので、制御機の全歩行者群を押ボタンにした（`withWalkButtons` のコメント）。

## 第3条第2項と安全の性質（全テンプレート）[^t4-tests]

- `tests/signalPlans.test.ts` の全テンプレート表に scramble・staggered（各 2 タイミング）・nightFlash 4 通り・withWalkButtons 3 通りを足し、第3条第2項の順序と安全の性質（交差する群が同時に開かない、歩行者の横を車が動かない、黄 ≥ 3 秒、全赤、歩行者の青の前後の空き）を掛けた。点滅・消灯は第3条第2項の「連続して表示する」青・黄・赤の外なので順序検査の対象外。
- 安全の検査を 2 つ足した: 斜め横断の歩行者（`across` が複数）は、渡るどの道路が開いても違反。`opposing`（時差式の向かい合う群）で、一方に右矢印がある間に他方が開いていれば違反（第37条の右折が「通れる」と知らされた対向車とぶつかる形）。
- 歩車分離の全赤: 歩行の前後とも全車両赤、歩行中に車両の青を入れると検査が落ちる（テスト）。時差式: 遅れる方向 a の右折が `go` で対向 c が開いていない段では c の全移動が `stop`、c が青・黄の間 a に矢印は無い、c が a より長く開くことは無い（テスト）。

## 点滅の意味（施行令第2条）と違反判定[^law-2][^law-6]

- 原文（e-Gov の施行令本文）: 黄色の灯火の点滅「歩行者等及び車両等は、他の交通に注意して進行することができること。」赤色の灯火の点滅「一 歩行者等は、他の交通に注意して進行することができること。二 車両等は、停止位置において一時停止しなければならないこと。」
- `permits`: FY → `go`、FR → `stopFirst`（T2 から）。`driverAction`: `stopFirst` → 止まれるなら `fullStop`（停止位置で一時停止してから進む）、止まれなければ `go`。`crossingVerdict(permission, hasStopped)`: `stopFirst` は直前に止まっていれば `allowed`、止まらなければ `bookedFlashing`。黄の点滅は `allowed`。
- **違反名と点数（一次情報で確認）**: 施行令 別表第六 備考 17「『信号無視（点滅）』とは、法第七条の規定に違反する行為（16 に規定する行為を除く。）」（16 は赤色・黄色の灯火に係るもの）、同表 十七 の反則金 普通車 7,000 円。点数は 別表第二 の「信号無視」2 点（赤色等と同じ欄、備考 27「法第七条の規定の違反となるような行為」）。`VIOLATIONS.signalFlashing`（道路交通法 第7条・2 点・7,000 円）。設計 5.4 は「一時停止の判定（既存の kind: stop）に載せる」と書いたが、第43条（指定場所一時不停止等）は標識の一時停止の条文で、赤の点滅は第7条の信号無視（点滅）なので別の種類にした（設計からの逸脱）。
- 「止まった」の判定は「止まれ」と同じ（停止線の中点から 12 m 以内で 15 秒以内に 3 km/h 未満）。告知書は 信号無視 の行に入れ、点滅だけのときは行名を「信号無視（点滅）」にした（実物の告知書の書き方は未確認）。
- 自動運転（`autoDriver.blockAhead`）と交通 AI（`traffic-ai.stopGap`）は `fullStop` を「止まれ」と同じ served/waited の仕組みで扱う。自動運転は 1.5 秒止まり、`mustYield` で譲る相手がいなければ進む。交通 AI は 1.2 秒止まったあと、交差道路から 35 m 以内に交差点へ向かってくる車がいなければ進む（レビューで足した。赤の点滅の向こうは多くが黄の点滅で止まらないため）。テスト: 交通 AI が停止線で止まり、交差する車が来ていれば待ち、いなくなれば進む。

## 歩行者と音響式

- 歩行者 AI（`sidewalks.ts`）: 歩車分離の交差点（`TrafficControl.mayCrossDiagonal` が null でない、腕 4 本以上）の角で、一部（ハッシュで 2 割）が対角の角へ斜めに渡り、斜めの歩行者灯（群 x）の青を待つ。出てよいのは、残りの歩行時間（青と点滅、plan.ts `walkLeftS`）が「対角の長さ ÷ その人の歩く速さ」以上あるときだけ（レビュー W5。交通 AI は歩行者を見ないので、渡り切れない人を出さない）。青 22 秒＋点滅 8 秒を 1.3 m/s で歩くと 39 m（初版のコメントの「45 m」は誤りで、直した）。点滅で歩行者灯が消灯（`off`）している所では、信号の無い横断歩道と同じく車を見て渡る（`mayCross` が null）。
- 音響式: 歩車分離の交差点の歩行者灯は全横断歩道が同時に青になるので、方向で鳥を分けず「ピヨ」1 種で鳴き交わす（`PedHead.bird`、spatialAudio は `s.bird ?? birdFor(s.across)`）。一次情報は未確認（実際の歩車分離の擬音の運用を読んでいない）。

## 時差式の板

- 標識令 別表第一（`assets/signs/law-table.json`）に「時差式」の補助標識は無い。公安委員会が信号に添える表示板として、灯器の下に白地・黒縁・黒文字「時差式信号」（0.9 × 0.3 m、灯器と同じ 1.3 倍で描く）を Canvas で描いた。文言・色・寸法は未確認。標識のレジストリには入れていない（標識令の標識ではなく、信号の腕に付くため。交差点名板と同じ扱い）。

## 適用件数（ゲームで読み込んで確かめた所）

| 場所                                      | 結果                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 渋谷駅前（35.6594, 139.7006）             | 制御機 59 のうち scramble 1（5 本の腕の節点 1 つ）、twoPhase+button 2、右折矢印 2              |
| 新橋（35.6656, 139.7579）                 | nightFlash（常時）。南北の道路が赤の点滅で、OSM の note「赤点滅で進行」（南北向き）と一致      |
| 新宿一丁目南（35.68809, 139.70989）       | 夜間点滅式 → 12:00 は twoPhase、23:00 は nightFlash（isNight true）                            |
| 秋葉原（35.6991, 139.7681）               | staggered（note の 先に／後から で c・a が決まる、source osm）                                 |
| 飯田橋の conditional（35.7040, 139.7447） | 適用されなかった（OSM のノードが交差点節点から 35〜42 m で、制御機の節点 25 m 以内に入らない） |

23 区全体での件数はゲームの道路網（GSI）に寄せないと決まらないので数えていない。OSM 側の上限は上の表の「場所」。

## 多視点レビュー（T4）[^t4-shots]

視点表 `scripts/qa/views/signals-t4.json`（4 地点 × 昼・夜、30 コマ）。`state.signalStep` で現示を固定し、夜の現示表は新しい `state.signalClock`（信号が読む時刻、開発用フック `signals.clock`）で 12:00・23:00 にした。

| 周  | 見たもの                                                                                                                                                                              | 指摘                                                                                                                                                                      | 直したこと                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | 4 地点 × 昼夜 30 コマ（各現示・歩行者目線・真上）と各コマの JSON                                                                                                                      | Critical・Warning なし。Info 1: 渋谷の真上のコマに斜め横断中の歩行者が写っていない                                                                                        | —（探りで確認）                |
| 2   | レビュー（C1）後の 34 コマ（新宿一丁目南に「点滅に入った瞬間」「点滅から出る瞬間の黄」「昼に戻った青」を足した。初版の 2 周目の画像はこの撮影で上書きされたので、記録はこの周のもの） | 新しい指摘なし。Info は探りとテストを根拠に wontfix で閉じた。JSON: 出る瞬間は template flashExit・主道路 黄（permits stopIfAble）・従道路 赤、戻ったあとは twoPhase の青 | —（C1 の修正はコードとテスト） |
| 3   | 同じ 34 コマを撮り直し                                                                                                                                                                | 新しい指摘なし                                                                                                                                                            | —                              |

`just check-convergence signals-t4` は 3 周目で converged（「2 quiet rounds, nothing open」）。夜の現示表の時刻は `state.signalClock`、切り替わる瞬間は `state.signalClockToChange`（フック `signals.clock(minute, approachId)` がその制御機の現示表が変わったところで時計を止める）で撮った。

- 確かめたこと（画像と JSON）: 全コマで赤が右・青が左（第3条）。渋谷は車両の青・黄の間は全歩行者灯が赤、歩行ステップでは車両が赤で `ped` が a・b・x とも go。新橋は主道路が黄の点滅で `permits` 全移動 go・`verdicts` allowed、従道路が赤の点滅で `stopFirst`・止まらなければ `bookedFlashing`・止まれば `allowed`、歩行者灯は消灯。新宿一丁目南は 23:00 で黄の点滅。秋葉原は c が黄の間 a が青（`plan.steps[2].all`）、遅れの段で a の右折が go・c が赤、「時差式信号」の板が読める。
- 渋谷の斜め横断は、撮影の瞬間には写らなかった（Info）。ゲーム内の探りで 3 分間に斜めの脚を持つ歩行者が最大 2 人、90 秒以上止まったままの歩行者は 0。
- 灯器は 30 m で数画素（寸法・取付高さは変えない方針のまま）。

## レビュー対応（T4、2026-11-11）[^t4-tests]

- **C1（夜への切り替えが安全の性質を破る）**: 初版の `switchPlan` は「昼の周期の段 0 で夜へ、最後の段で昼へ」としていた。これだと、note の色が逆（主道路 赤・従道路 黄）の場合や時差式に点滅が重なる場合に、a の青の直後に b が赤 → 黄の点滅（go）になり、黄も全赤も挟まらなかった。昼へ戻る側も、窓が最後の段の途中で終わると全赤が 0〜2 秒になり、黄の点滅 → 赤にも黄が入らなかった。さらに再構築（300 m ごと）では窓から直接 isNight を決めていたので、任意の段で切り替わった。直し方:
  - 切り替えてよい時点を純関数 `isChangeMoment` にした。
  - 点滅から出るときは移行段 `flashExit` を通す。
  - `NightPlan.kind`（`flash` / `buttons`）が段数の比較（`isSameSteps`）に代わった。
  - 制御機の状態（`ScheduledRun` の区間の履歴、押ボタン式の `OnDemandRun`）を `TrafficControl.runs` に 1 か所でまとめ、交差点の節点ハッシュ（`j:`）と単路のキー（`x:`）で再構築をまたいで保持する。
  - 確かめ方:
    - tests/signalT4.test.ts: 全テンプレート（twoPhase・右折矢印・scramble・staggered・押ボタン）× 群ごとの点滅色（黄・赤の全組み合わせのうち nightFlash が受け付けるもの）× 変更できる全時点について、「昼の途中 → 点滅 → 移行段 → 昼の最初の段」を 1 周の現示表として `safetyIssues` に掛け、点滅の前後の steady な区間に第3条第2項を掛ける。
    - tests/signalT4Junction.test.ts: 実際の TrafficControl で、夜に入る時刻を周期の 6 か所に変え、色 3 通り（仮定・note で逆・両方赤）について 0.25 秒ごとの各流入路の灯を記録し、灯の列そのもので確かめる。見る性質は「交差する道路が同時に開かない」「開く前に 1 秒の全赤」「黄 ≥ 3 秒」「青・黄の点滅から直接赤にならない」。この検査器が初版の形（青の直後に交差道路が黄の点滅）を捕まえることもテストにした。
    - 再構築で移行段が続くこともテストした。
- **W1・W2**: `permitsBefore` は、切り替えの前に出していた現示表を区間の履歴から読む（点滅を出た直後の 3 秒前は移行段の黄）。リプレイは `update(t, true)` で、その時刻の区間を読むだけにし、切り替えも押ボタンの走りも起こさない。
- **W3**: `saysOfPlan` と `hasPhaseFacts` の二重定義をやめ、`junctionFacts` を assign.ts に移して `hasPhaseFacts` を使うようにした。色の note だけのノードも使われる（単体テスト）。今のデータで色の note が効く点滅の交差点は 1 か所（新橋。note は blinker のノード自身にある）で、色だけのノードが点滅の交差点の 40 m 以内にある例は 0（scratchpad t4/census6.mts）。
- **W4**: 制御機の欄を `run: OnDemandRun | ScheduledRun` の 1 つにした。どちらも plan.ts の `PlanRun`（`stepAt`・`stepBefore`・`call(group, t)`・`isWaiting(group, t)`）を満たし、`c.demand ? … : c.calls` の分岐は消えた。
- **W6**: 基本テンプレートを `BASE_TEMPLATES`（`key`・`applies`・`make`・`hasArrows`）の表にした。scramble と staggered が落とす右折矢印の群は `droppedArrows` で数え、`road_network_built` の `droppedRightArrows` に出す。
- Info: 告知書の行名、交通 AI の譲り、viewHooks の古い Why not（「T3 の担当」）を直した。

## T4 の残り

- 秒数（歩車分離の歩行 22 秒・点滅 8 秒、時差式の遅れ 6 秒、点滅の 1 段 60 秒）、点滅の周期（0.5 秒点灯・0.5 秒消灯は T3 から）、仮定の夜 22:00–06:00、主道路 黄・従道路 赤 の一次情報。
- 交差点の押ボタンを、押ボタンのノードがある横断歩道だけにする（JARTIC の横断歩道の端との対応付け）。
- 歩車分離の擬音、「時差式信号」の板の様式の一次情報。
- `traffic_signals:direction` の片側だけの信号（交差点の片方向だけに灯器）は扱っていない。時差式の向きを読むのに方位を使っただけ。
- 飯田橋の conditional のように、交差点節点から 25 m を超える信号ノードの事実は拾えない。
- 自分（徒歩のプレイヤー）は押ボタンを押せない（T3 から）。リプレイ（`control.update(r.t)`）は時刻を渡していないので、夜の現示表の切り替えは再現しない。

[^t4-census]: OSM の T4 タグの集計

[^t4-tests]: T4 のテスト

[^law-6]: 道路交通法施行令 別表第二・別表第六

[^t4-shots]: 多視点レビュー（T4）

[^t3-census]: OSM 信号タグの集計（T3）

[^gifu-spec]: 押ボタン箱の取付

[^t3-tests]: T3 のテスト

[^t3-compare]: タグありとタグなしの信号交差点の比較

[^t3-shots]: 多視点レビュー（T3）

[^law-2]: 道路交通法施行令 第2条・第3条第2項

[^kisoku]: 道路交通法施行規則 別表第一の二

[^npa-arrow]: 右折矢印信号現示による制御に関する運用指針

[^plan-tests]: 現示表と twoPhase 一致のテスト

[^red-light-tests]: 保留つき信号無視のテスト

[^t2-shots]: 多視点撮影（T2）

[^arrow-count]: 右折矢印の候補の件数
