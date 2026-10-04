---
type: Reference
title: 東京都オープンデータカタログ
description: カタログ全 9,702 件の構成・API・CORS の実測と、ゲームで使った 10 データセットの選定理由。
resource: https://catalog.data.metro.tokyo.lg.jp/
tags: [opendata, licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T05:00:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T04:01:00Z }
sources:
  - id: ckan-facets
    resource: https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_search?rows=0&facet.field=["groups","organization","res_format","license_id"]&facet.limit=-1
    title: CKAN package_search facet 集計（curl -g で取得）
    last_modified: 2026-10-04T02:57:00Z
  - id: api-list
    resource: https://data.storage.data.metro.tokyo.lg.jp/digitalservice/130001_tokyo_opendata_api_list.csv
    title: 東京都オープンデータ API 一覧（t000029d0000000021）
  - id: tokyo-terms
    resource: https://portal.data.metro.tokyo.lg.jp/terms/
    title: 東京都オープンデータ利用規約
  - id: sweep-workflow
    resource: 34 エージェントの網羅走査（カテゴリ 15・地理形式・23 区ポータル、上位 36 候補を反証実測）
    title: 調査ワークフロー wf_0b82721d-932
    author: claude-opus-5-5/1m
---

# 全体像（2026-10-04 実測）

| 項目                       | 値                                             |
| -------------------------- | ---------------------------------------------- |
| データセット               | 9,702（CKAN 2.11.4）                           |
| 組織                       | 98（都の局 32・23 区すべて・多摩 26 市・町村） |
| カテゴリ（group）          | 15（行財政 3,886 が最多、交通 78 が最少）      |
| リソース                   | 83,969（CSV 66,249 が大半）                    |
| 地理形式を含むデータセット | 49（GeoJSON は港・品川・目黒の 3 区に偏る）    |
| ライセンス                 | CC BY 4.0 が 9,699 件                          |

位置は多くが CSV の緯度・経度列で持たれ、メタデータ検索の「緯度」ではほぼヒットしない（14 件）。[^ckan-facets]

# アクセス方法と CORS

| 配信元                                                | CORS                            | 使い方                     |
| ----------------------------------------------------- | ------------------------------- | -------------------------- |
| CKAN API (`/api/3/action`)                            | なし（JSONP は可）              | ビルド時に取得             |
| `opendata.metro.tokyo.lg.jp` / `data.storage…` の CSV | なし                            | ビルド時に取得             |
| 都 API `service.api.metro.tokyo.lg.jp/api/{id}/json`  | `*`（プリフライト可、登録不要） | ブラウザから直接 POST も可 |

都 API は 71,451 本・5,611 データセット分ある。`limit` はクエリ文字列に付ける（ボディに入れると 400）。[^api-list]

# ゲームで使ったデータ

CSV は文字コードが混在する（UTF-8 BOM・Shift_JIS・UTF-16）。ヘッダが 2 行目にあるもの、引用符内で改行するヘッダ（`区市町村\nコード`）もある。そのため自前の RFC 4180 パーサと、UTF-8 strict を試してから Shift_JIS に落とす判定で読んでいる（`scripts/csv.ts`）。

| データセット（ID）                                  | 提供                | 件数（23 区） |
| --------------------------------------------------- | ------------------- | ------------- |
| 文化財一覧 t000021d0000000017                       | 東京都教育庁        | 106           |
| 観光情報（しながわ百景）t131091d0000000005          | 品川区              | 98            |
| 名所・史跡 t131067d0000000251                       | 台東区              | 45            |
| 映える夜景スポット t131083d0000000045               | 江東区              | 8             |
| 公共施設一覧 t000029d0000000030                     | デジタルサービス局  | 91            |
| 都立スポーツ施設一覧 t000056d0000000002             | スポーツ推進本部    | 52            |
| Tokyowater Drinking Station 一覧 t000019d0000000003 | 水道局              | 575           |
| 給水拠点一覧 t000019d0000000001                     | 水道局              | 105           |
| 防災マップ 避難場所 t000003d0000000093              | 総務局              | 968           |
| 都営交通 駅情報（ODPT）                             | 交通局・ODPT 協議会 | 148           |

件数は座標検証後の値（[POI 座標の品質と検証](poi-coordinate-quality.md)）。

# 効かなかったこと

- **防災マップの避難所 CSV（`130001_evacuation_center.csv`）**: 13MB・約 104 万行で構造が崩れていたため使わず、避難場所の CSV だけを使った。
- **公衆トイレや AED の区別データ**: 区ごとに列構成も文字コードも違い、座標が入っているのは一部の区だけだったので、今回は見送った。[^sweep-workflow]

[^ckan-facets]: CKAN package_search facet 集計

[^api-list]: 東京都オープンデータ API 一覧

[^sweep-workflow]: 調査ワークフロー wf_0b82721d-932
