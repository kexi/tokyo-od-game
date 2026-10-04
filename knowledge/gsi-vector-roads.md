---
type: Reference
title: 地理院ベクトルタイルの道路
description: experimental_bvmap の road レイヤの属性、交差点での分割、規制データが無いことと制限速度の推定（規制は後に JARTIC で補った）。ftCode 2221 を道路構成線としていた誤りを訂正済み。
resource: https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf
tags: [roads, licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T12:00:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T12:00:00Z }
  - { by: process:vitest, at: 2026-10-04T04:40:00Z }
sources:
  - id: attr-spec
    resource: https://maps.gsi.go.jp/help/pdf/vector/attribute.pdf
    title: 地理院地図Vector 属性仕様
  - id: experiment
    resource: https://github.com/gsi-cyberjapan/gsimaps-vector-experiment
    title: 国土地理院ベクトルタイル提供実験
  - id: ftcodes
    resource: https://maps.gsi.go.jp/help/pdf/vector/optbv_featurecodes.pdf
    title: 地理院 最適化ベクトルタイル 地物コード表
  - id: probe-z16
    resource: 丸の内 z16/58211/25806 を @mapbox/vector-tile でデコード（2026-10-04）
    title: z16 タイルの実測
  - id: roads-agent
    resource: 道路データ調査エージェント（新宿 z14 の接続解析、JARTIC・OSM・PLATEAU tran の比較）
    title: 道路ソース比較
    author: claude-opus-5-5/1m
---

# 配信

- z4〜16（z17 以上は 404）。CORS は `*`。出典は「国土地理院ベクトルタイル提供実験」。[^experiment]
- 丸の内の z16 タイルは 19KB（全レイヤ込み）。ゲームは周囲 3×3 タイル（約 1.8km 四方）を読み、300m 動くたびにグラフを作り直す。[^probe-z16]

# `road` レイヤ

| 属性       | 意味                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ftCode`   | 27xx が道路中心線（2701 通常部、2703 橋・高架、2704 トンネル、2711・2713 庭園路）。2201 は道路縁（通常部）、2221 は道路縁（庭園路）、2411 は道路構成線（分離帯）。歩道の線は無い（2026-10-04 訂正: 初版は 2221 を道路構成線としていた）[^ftcodes] |
| `rdCtg`    | 0 国道、1 都道府県道、2 市区町村道、3 高速自動車国道等                                                                                                                                                                                            |
| `rnkWidth` | 0: 3m 未満、1: 3〜5.5m、2: 5.5〜13m、3: 13〜19.5m、4: 19.5m 以上                                                                                                                                                                                  |
| `Width`    | 実幅員（m）。`rnkWidth`=4 のときだけ入る                                                                                                                                                                                                          |
| `lvOrder`  | 0 が地上。1 以上は高架で、ゲームでは除外                                                                                                                                                                                                          |
| `motorway` | 0 一般、1 高速、9 不明                                                                                                                                                                                                                            |

一方通行・信号・横断歩道・車線数・規制速度は入っていない。[^attr-spec]

# 橋とタイルの共有（2026-10-05 追記）

- ftCode 2703（橋・高架）で `lvOrder` 0 の線は地上の橋。`RoadLine.bridge` に持たせ、水を渡る区間に床版を作る（[川・運河・海の水面](rivers-and-water.md)）。道路中心線と水涯線の交差 66 件はすべて 2703 だった。
- 同じ z16 タイルの `waterarea` を水面に使う。タイルは `gsiVectorTiles.ts` が 1 回だけ取得・デコードして道路と水で共有する（直近 64 枚）。

# 交差点

- 調査では、z14 の新宿タイルは交差点ごとに線が分割されていた（途中の頂点が他線の端点と重なる箇所は 0 件）。[^roads-agent]
- それでも `splitAtJunctions` で、共有頂点（約 1m に丸めて照合）ごとに分割している。テストの丁字路で、分割しないと行き止まり扱いになり AI 車が U ターンする不具合が実際に出たため。タイル境界で切れた線も、同じ丸めでつながる。

# 制限速度の推定

> **追記（2026-10-04）**: 下の「JARTIC を対応付ける必要がある」は実施した。規制速度・一方通行・横断歩道・停止線・一時停止は JARTIC、信号機は OSM から取り込んでいる（[交通規制と信号機](traffic-regulations.md)）。幅員からの推定は、規制速度が対応付かない区間の法定速度としてだけ残っている。

規制速度のデータが無いので、法定速度（施行令第 11 条、2026-09-01 改正）を幅員で近似する。

- 幅員 5.5m 以上: 60km/h（中央線ありとみなす）
- 幅員 5.5m 未満: 30km/h

中央線の有無そのものは推測で、画面にも「幅員からの推定」と表示している。正確にするには、JARTIC の交通規制情報（一方通行 15,704 本・速度区間 9,742 本・横断歩道 73,419 か所）をビルド時に道路区間へ対応付ける必要がある。JARTIC のデータには CORS が無く、東京都の信号機の座標はダミーが多い。[^roads-agent]

[^attr-spec]: 地理院地図Vector 属性仕様

[^experiment]: 国土地理院ベクトルタイル提供実験

[^probe-z16]: z16 タイルの実測

[^roads-agent]: 道路ソース比較

[^ftcodes]: 地理院 最適化ベクトルタイル 地物コード表
