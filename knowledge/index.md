---
okf_version: "0.2"
---

# ナレッジ索引

- [東京都オープンデータカタログ](tokyo-opendata-catalog.md) - カタログ全 9,702 件の構成・API・CORS とゲームで使った 10 データセット
- [POI 座標の品質と検証](poi-coordinate-quality.md) - 元データの座標誤りと e-Stat 町丁境界による除外ルール
- [PLATEAU 建物の配信と LOD 選定](plateau-buildings.md) - LOD2 を捨てて LOD1 にした経緯（キャッシュ枯渇・浮いた壁・網羅率）
- [地形・ジオイド・浮動原点](terrain-and-geoid.md) - DEM と PLATEAU の高さ合わせ、ジオイド差し替えの理由、曲率対策
- [地理院ベクトルタイルの道路](gsi-vector-roads.md) - road レイヤの属性、交差点分割、制限速度の推定
- [交通規制（JARTIC）と信号機（OSM）](traffic-regulations.md) - JARTIC CSV の読み方（一方通行の座標は禁止方向向き）、OSM 信号機、道路への対応付けと検証
- [区画線・道路標示・道路標識（法令と JARTIC）](road-markings-and-signs.md) - 命令で確かめた色と設置条件、JARTIC コードの読み方、線が埋もれた・標識が上下逆になった落とし穴
- [道路交通法の点数・反則金](road-traffic-law.md) - 一次情報で確認した値と 2026-09-01 の法定速度改正
- [データ・ソフトウェアの利用条件](licensing-decisions.md) - 提供元ごとの規約と、それを受けて変えた設計
- [端末内 AI（Gemma 4・sanoTTS-jp）](on-device-ai.md) - LiteRT-LM と WASM TTS の実測と落とし穴
- [Blender CLI でのモデリング（車・道路標識・歩行者）](car-model-blender.md) - bpy で手続き生成して glb にする手順、Cycles・join・UV・フォント・角丸めの落とし穴、agy 委譲の確認結果
- [ヘッドレス Chrome での検証](headless-browser-testing.md) - CDP 直叩きの手順と、背景タブ・HMR で検証が壊れる罠
