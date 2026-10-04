---
type: Reference
title: 地形・ジオイド・浮動原点
description: 地理院 DEM と PLATEAU の高さを合わせる方法、ジオイドを EGM2008 に替えた理由、23 区の曲率に対する浮動原点。
tags: [terrain, licensing, rendering]
status: stable
stale_after: 2027-10-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T05:00:00Z }
verified:
  - { by: process:vitest, at: 2026-10-04T04:30:00Z }
  - { by: claude-opus-5-5/1m, at: 2026-10-04T03:41:00Z }
sources:
  - id: dem-tiles
    resource: https://maps.gsi.go.jp/development/demtile.html
    title: 地理院 標高タイルの仕様（DEM5A/DEM10B PNG）
  - id: geoid-procedure
    resource: https://www.gsi.go.jp/buturisokuchi/grageo_geoidprocedure.html
    title: ジオイド・モデルの利用手続（測量法第29条・第30条）
  - id: proj-egm
    resource: https://raw.githubusercontent.com/OSGeo/PROJ-data/master/us_nga/us_nga_README.txt
    title: "PROJ-data us_nga（EGM2008 2.5′ grid, License: Public Domain）"
  - id: base-measure
    resource: ヘッドレス Chrome・丸の内・LOD1 表示タイルの 6m セルごとの最低頂点と地形高の差（1,711 セル）
    title: 建物底面と地形の高さ差の実測
---

# 高さを合わせる

PLATEAU の 3D Tiles は WGS84 の楕円体高、地理院の DEM は標高（東京湾平均海面）。地面は DEM の標高に**ジオイド高 N**（東京で約 34〜40m）を足して置く。[^dem-tiles]

- DEM は z15 の DEM5A を使い、無い画素は z14 の DEM10B、それも無ければ 0（海面）にする。
- PNG は `createImageBitmap(..., { colorSpaceConversion: "none", premultiplyAlpha: "none" })` で読む。色変換が入ると、詰め込まれた標高のビットが壊れる。
- 実測で、LOD1 の建物底面と地形の差は中央値 −0.29m、10〜90 パーセンタイルで −1.10〜−0.10m だった。浮いてはおらず、わずかに埋まる程度。[^base-measure]

# ジオイド: 国土地理院 → EGM2008

|              | 国土地理院 ジオイド高計算 API                   | EGM2008（PROJ-data）                         |
| ------------ | ----------------------------------------------- | -------------------------------------------- |
| 都庁の値     | 37.099m                                         | 36.927m                                      |
| 35.6N 139.8E | 36.129m                                         | 35.948m                                      |
| 配布         | 格子値を同梱すると測量法の承認が必要な可能性    | パブリックドメイン                           |
| 取得         | CORS は `vldb.gsi.go.jp` のみ。混雑時に空の応答 | COG を HTTP Range で必要範囲だけ（14×15 点） |

差は約 0.17〜0.18m で、ゲームでは見分けがつかない。国土地理院のページは「不特定多数の者がジオイド・モデルを入手できる状態に置く場合」は申請が必要としていたため、EGM2008 に替えた。[^geoid-procedure] [^proj-egm]

# 浮動原点

23 区は端から端まで約 30km ある。1 枚の接平面に置くと、15km 先で 10m 以上沈む（テストで確認）。

- ローカル座標は x=東、y=上、−z=北。
- 車（または徒歩の自分）が原点から 1.5km 離れたら、その地点を新しい原点にする。
- そのとき、車・カメラ・歩行者・AI 車・事故現場を ECEF を経由する剛体変換で移す。地形と建物の衝突判定はその場で作り直す。1 フレームでも地面の判定が無いと車が落ちるため。
- 窓のシェーダーは模様の周期 288m（3.2m・3.6m・24m の公倍数）で原点のずれを吸収し、付け替えても模様がずれないようにしている。

[^dem-tiles]: 地理院 標高タイルの仕様

[^geoid-procedure]: ジオイド・モデルの利用手続

[^proj-egm]: PROJ-data us_nga

[^base-measure]: 建物底面と地形の高さ差の実測
