---
type: Reference
title: データ・ソフトウェアの利用条件
description: 提供元ごとの規約と、それを受けて変えた設計（ジオイド差し替え、標準地図の不使用、逆ジオコーダの廃止、TTS の利用規約）。
tags: [licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T16:40:00Z }
sources:
  - id: legal-review
    resource: 法務観点エージェントによる規約原文の確認（2026-10-04、取得物は scratchpad/raw と txt）
    title: 利用規約レビュー
    author: claude-opus-5-5/1m
  - id: gsi-ichiran
    resource: https://maps.gsi.go.jp/development/ichiran.html
    title: 地理院タイル一覧（リアルタイム読み込みは出典の明示のみで申請不要）
  - id: gsi-qa
    resource: https://www.gsi.go.jp/LAW/2930-qa.html
    title: 測量成果の承認申請 Q&A（Q2-4）
  - id: plateau-policy
    resource: https://www.mlit.go.jp/plateau/site-policy/
    title: PLATEAU サイトポリシー
  - id: odpt-faq
    resource: https://developer.odpt.org/ja/faq-info#cc-by-credit
    title: ODPT FAQ（CC BY の表記例）
  - id: jma-terms
    resource: https://www.jma.go.jp/jma/kishou/info/coment.html
    title: 気象庁ホームページ利用規約
  - id: sanotts-license
    resource: https://github.com/ayutaz/sanoTTS-jp/blob/v1.2.0/LICENSE-MODEL.md
    title: sanoTTS-jp Model License 1.0
  - id: tyc-corpus
    resource: https://tyc.rei-yumesaki.net/material/corpus/
    title: つくよみちゃんコーパス 利用規約
  - id: jartic-terms
    resource: https://www.jartic.or.jp/d/opendata/riyou_kiyaku.pdf
    title: JARTIC 交通規制情報 利用規約
  - id: gemma-license
    resource: https://ai.google.dev/gemma/docs/gemma_4_license
    title: Gemma 4 ライセンス（Apache 2.0）
---

# 提供元ごとの扱い

| 提供元                                          | 条件                                                                                                                                                                                                                   | ゲームでの対応                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 東京都・各区                                    | CC BY 4.0。改変時は「改変して利用」と書く。都・区が作ったように見せない                                                                                                                                                | 指定の書式で出典画面に列挙し、提供元の個別指定（防災マップ・台東区・水道局）も表示                                                                     |
| 東京都公式ホームページ（www.metro.tokyo.lg.jp） | CC BY ではない。著作権法上認められた場合を除き無断で複製・転用できない。RSS の新着情報の再配布・サイトの構築は事前の申請と審査が要る。リンクは原則自由（都のサイトへのリンクである旨を明記）                           | 使わない。Y に報道発表を流す機能は申請していないので作らなかった（[東京都公式ホームページの RSS](tokyo-gov-rss.md)）                                   |
| PLATEAU                                         | PDL1.0（CC BY 互換）。加工した旨を書く                                                                                                                                                                                 | 「出典：国土交通省 PLATEAUウェブサイト…を加工して作成」と書く[^plateau-policy]                                                                         |
| 地理院タイル                                    | リアルタイム読み込みは出典の明示だけで申請不要。表示中は出典を画面に出すのが原則                                                                                                                                       | 画面下に常時表示。タイルは同梱しない[^gsi-ichiran]                                                                                                     |
| ODPT（都営）                                    | CC BY 4.0。提供者名は「東京都交通局・公共交通オープンデータ協議会」                                                                                                                                                    | FAQ の改変時書式に加え、正確性非保証・問い合わせ先を表示[^odpt-faq]                                                                                    |
| 気象庁                                          | 公共データ利用規約 1.0。加工した旨と、編集責任が編集者にある旨を書く                                                                                                                                                   | 「予報・警報ではない」と明記。取得は 10 分に 1 回[^jma-terms]                                                                                          |
| e-Stat                                          | 政府標準利用規約 2.0                                                                                                                                                                                                   | 出典と加工した旨を書く                                                                                                                                 |
| JARTIC                                          | 交通規制情報 利用規約（CC BY 4.0 互換、商用・公衆送信可）。「出典：「交通規制情報」（公益財団法人日本道路交通情報センター）（URL）（○年○月○日に利用）」、加工時は「を加工して作成」。JARTIC や国が作ったように見せない | 出典画面に指定の書式と利用日（ビルド時の取得日）を表示。「実際の運転では現地の標識・標示に従う」と明記[^jartic-terms]                                  |
| 東京都水防災総合情報システム                    | 数値データは著作権の対象外で自由利用。出典の記載、加工した旨の記載、都が作成したように見せないことを求める                                                                                                             | ビルド時に水位観測所の典型水位を `public/data/water-levels.json` に焼き、出典画面に出典と加工した旨を表示（[川・運河・海の水面](rivers-and-water.md)） |
| 気象庁 潮位表                                   | 公共データ利用規約 1.0。出典と加工した旨                                                                                                                                                                               | 東京（TK）の推算潮位を実行時に読み、出典画面に「予測であり実際の潮位とは異なる」と明記                                                                 |
| OpenStreetMap                                   | ODbL 1.0。表示する作品には帰属表示、抽出したデータベースを公開するなら ODbL で提供                                                                                                                                     | 画面下と出典画面に © OpenStreetMap contributors。`public/data/signals/LICENSE.txt` に ODbL と抽出条件を記載                                            |
| sanoTTS-jp                                      | コードは MIT。重みは独自ライセンスで、(A) 表示と Apache-2.0 全文の同梱が義務。合成音声の禁止用途 4 項目を利用規約で課す義務がある                                                                                      | (A) を原文のまま掲載し、禁止事項を出典画面と README に記載。音声の保存機能は持たない[^sanotts-license] [^tyc-corpus]                                   |
| Gemma 4                                         | Apache 2.0、ゲートなし                                                                                                                                                                                                 | 各端末が Hugging Face から直接取得するので、再配布はしていない[^gemma-license]                                                                         |
| npm 依存                                        | MIT / Apache-2.0 / BSD                                                                                                                                                                                                 | ビルドで `THIRD_PARTY_LICENSES.txt` を生成（Draco も含む）                                                                                             |

**遊ぶ画面に常時出すのは 2 つだけ（2026-10-05）。** 地理院タイルは表示中に出典を画面に出すのが原則で、OpenStreetMap の帰属表示は地図とともに見える場所に置く慣行がある。そこで遊ぶ画面の下には「地理院タイル ｜ © OpenStreetMap contributors ｜ 出典・ライセンス」だけを出す。PLATEAU・国土地理院ベクトルタイル提供実験・JARTIC・東京都と各区・ODPT・気象庁・e-Stat・sanoTTS-jp の表示は、出典画面（タイトル画面と遊ぶ画面の「出典・ライセンス」から開く）にまとめた。これらの規約は表示の場所を作品に合わせて選べる（CC BY 4.0 は媒体に応じた合理的な方法、PDL1.0 は出典の記載）。画面下に全部を並べると運転の妨げになる、という利用者の指摘を受けて変えた。

# 規約を受けて変えた設計

1. **ジオイド**: 国土地理院のモデルの格子値を同梱すると、測量法第 29 条・第 30 条の承認が要る可能性が高い。そのためパブリックドメインの EGM2008 に替えた（[地形・ジオイド](terrain-and-geoid.md)）。[^legal-review]
2. **標準地図（std）**: 「電子地形図と DEM を重ねて立体的な地図を作る」場合は承認申請の対象になり得る（Q2-4）。地面の選択肢から外し、写真と PLATEAU オルソだけにした。[^gsi-qa]
3. **逆ジオコーダ**: 地理院地図向けの非公開機能で、継続提供は保証されない。プレイヤーごとに数秒おきに呼ぶのはやめて、e-Stat の境界で判定するようにした。
4. **NPC のセリフ**: 合成音声で話すため、システムプロンプトで政治・宗教・攻撃的な話題を禁じた。出力も正規表現で検査し、該当すれば定型文に置き換える。
5. **都の報道発表の RSS**: Y に見出しと Gemma の要約を流す依頼があった。RSS の再配布には事前の申請が要り、サイトの記事は CC BY でもないので作らなかった（2026-10-05、[東京都公式ホームページの RSS](tokyo-gov-rss.md)）。

# 報告事項

国土交通省 水文水質データベースは「ツール等によるデータ取得を禁止」としている。水位の調査（2026-10-05）で、エージェントが位況表をツールで取得していた。その値はゲームに使っていない（[川・運河・海の水面](rivers-and-water.md)）。外部サイトのアクセス制限をエージェントへの指示で先に確かめさせる。

道路データの調査で、エージェントが Overpass API（overpass-api.de）への試験リクエスト 1 回で、User-Agent に利用者のメールアドレスを入れて送っていた。以後は外している。外部への試験リクエストに個人情報を載せないよう、エージェントへの指示に明記する。

[^legal-review]: 利用規約レビュー

[^gsi-ichiran]: 地理院タイル一覧

[^gsi-qa]: 測量成果の承認申請 Q&A

[^plateau-policy]: PLATEAU サイトポリシー

[^odpt-faq]: ODPT FAQ

[^jma-terms]: 気象庁ホームページ利用規約

[^sanotts-license]: sanoTTS-jp Model License 1.0

[^tyc-corpus]: つくよみちゃんコーパス 利用規約

[^gemma-license]: Gemma 4 ライセンス

[^jartic-terms]: JARTIC 交通規制情報 利用規約
