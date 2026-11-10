---
type: Reference
title: 信号灯器の宣言と施行令第3条の 3 層テスト（T1）
description: 信号灯器の型（横 3 灯・縦 3 灯・矢印段付き・歩行者 2 灯）と取付を src/signals に zod で宣言し、灯の位置を lampLayout(def) の 1 関数から出して Blender（assets/signals/heads.json 経由）とゲームで共用した記録。施行令第3条（横型は右から赤・黄・青、縦型は上から）を定義と実行時の配置（運転者のカメラへの投影）でテストし、glb が lampLayout と同期していること（レンズ位置のノードと heads.json の SHA-256）も検査する。矢印段の配置は第3条ではなく慣行で、一次情報は未確認。寸法の一次情報も未確認のため status は draft。ゲームが出す灯器と寸法・取付高さは変えていない（灯の行列が変更前と一致、既存メッシュの圧縮バイトも一致）。多視点レンダーのレビューは 6 周で収束。
tags: [assets, traffic-law, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-10T10:40:00Z }
verified:
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
- 縦型・矢印段はゲームに出していない。矢印を点けるのは T2（現示表と `permits`）。
- 1 灯の点滅専用・押ボタン箱の型、歩道橋添架・共架の寸法。
- ヘッドレス Chrome での画面の重心の計測（設計 7 章）は未実施。T1 では実行時の配置行列の投影で代えた。
