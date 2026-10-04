---
type: Reference
title: 地形・ジオイド・浮動原点
description: 地理院 DEM と PLATEAU の高さを合わせる方法、ジオイドを EGM2008 に替えた理由、23 区の曲率に対する浮動原点、DEM5A の凸凹をメディアンで均した経緯。
tags: [terrain, licensing, rendering]
status: stable
stale_after: 2027-10-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T11:00:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T11:00:00Z }
  - { by: process:vitest, at: 2026-10-04T11:00:00Z }
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
  - id: dem-roughness
    resource: 丸の内（スポーン地点）中心の 600m 四方を 4m 間隔で 150×150 点サンプルし、各点の高さから 44m 四方の平均を引いた偏差の分位点（ヘッドレス Chrome、z15 の dem5a_png）
    title: DEM の凸凹の計測
    author: claude-opus-5-5/1m
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

# 降りた車はキネマティックにする（2026-10-04 追記）

「車を降りたら自分の車がなくなった」という報告があった。降車中も車は動的剛体のままで、AI の車・都営バス・救急車（いずれもキネマティック剛体）に押されると吹き飛ばされる。地形の当たり判定はプレイヤーの周囲 3×3 チャンク（約 1km 四方）にしかないので、そこから外れると落下もする。降車中は車をキネマティックにして、乗車時に動的へ戻すようにした。100m 歩いて離れても車が元の位置に残ることを確認した。

# DEM5A の凸凹をメディアンで均す（2026-10-04 追記）

平らな丸の内の広場や歩道が、ゆるく波打って見えた。DEM5A の高さから 44m 四方の平均を引いた偏差は、中央の 80% が ±0.2m 以内だった。しかし 1% 点で −1.57m、99% 点で +1.24m あり、1〜1.5m の盛り上がりとくぼみが点在していた。[^dem-roughness] 建物を除いた航空レーザの地表点が建物際や高架下で少なくなり、その補間の跡と見ている（原因は確かめていない）。

タイルを読んだ直後に 5×5 のメディアン（z15 で約 20m）をかけ、3×3 の二項フィルタで段差を丸めた。偏差は 1% 点 −0.99m、99% 点 +0.90m、10〜90% 点は −0.12〜+0.17m になった。[^dem-roughness] メディアンにしたのは、ガウシアンでは盛り上がりが広がるだけで、堀の石垣や盛土の段差まで丸まるため。孤立した 1.5m の突起が消え、5m の段差が 1 画素以内に保たれることを単体テストで確かめている。

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

[^dem-roughness]: DEM の凸凹の計測
