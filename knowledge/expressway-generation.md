---
type: Playbook
title: 高速道路の生成（OSM → 道路構造令の線形 → デッキ、P1・縦断の一括解・P2.6 の全域向けの縦断・P3 の走行・P3.5 の床版の一体化・P7 の構造物上書き・G6 の標識・P9 のトンネルと掘割・P2.7-2 の固定点 block・P2.7-3a の 41009552・P2.7-3 の縦断の目的 v2・P2.7-4 の許容の台帳と配信形式 v6・P2.7-5 の v2 の有効化・P2.7-6 PR 1 の構造を高さから決める・PR 2 の地平 run・PR 3 の高さの組・PR 4 の並走ランプの分離・PR 5 の継ぎ目の段・PR 6 の分合流で本線が譲らない・PR 7a の地平 run の目標線と構造の規則・PR 7b の地表近くの構造の実行時・PR 7a2 の低い径間・PR 7c0 の地下・掘割の分合流は S7・PR 7c2 のランプの足を街路の縁で切る）
description: 首都圏の都市高速を OSM の motorway / motorway_link からビルド時に道路構造令の平面・縦断線形へコンパイルし（src/expressway/、scripts/expressway.ts）、public/data/expressway の ≤300 m チャンクを実行時に床版・壁高欄・箱桁・橋脚へ押し出す（src/world/expresswayDeck.ts、?expressway で有効）。P3 でコライダー（床版と壁高欄の trimesh・橋脚の cuboid）・道路グラフへの統合（端点 ID・ランプ端の接続）・区画線を足し、入口ランプから本線に乗って出口から一般道へ戻る走行を確かめた（多視点レビュー 3 周で収束）。縦断は分合流・交差・床版の重なりでつながる run の連結成分ごとに 1 つの凸 QP（疎な内点法）で解き、高さは交差と重なりの拘束からだけ決める（layer を目標高に使う P1 の逸脱を解消）。設計速度は区間ごと、測点は勾配つきでエルミート補間。試験区間（浜崎橋JCT〜芝公園）は T1〜T7 違反 0、deck_overlap は 4 組・41 測点（理由つき許可）。全域の解けない run、データ量、性能と見た目の確認。P2.6 で縦断の解き方を全域向けに直した（終了判定 gapTol、短い連結路を親 2 本の 3 次エルミート `follow` に、短い run の地表端を帯に、仮定の床は最も低い V でも解けない run の最終段で W_FLOOR の弱い行に、V 下げは失敗位置の ±150 m、閉鎖した run を meta の `closed` に）。全域を計測（解けた run 357 → 702／763）したが出荷条件は満たさず、全域は出荷していない（本線の閉鎖 15、ランプの閉鎖 8.3 %、未許可の重なり 332 組）。試験区間は解き方の変更で高さが最大 1.86 m 動いた。P7 の構造物の固定（ProfilePin）とは main の取り込みで統合した（連結路の 3 次式は固定を持てないので構造物上の run は連結路にしない）。P7 で構造物上書き（structures.ts）。レインボーブリッジの deckLevels に上層・下層の平面（補剛桁の範囲）と縦断（sRange）を固定し、帯の断面・描画だけの apron・橋脚と桁の抑止、3 m 規則でビルド失敗、下層の臨港道路を street として同じコンパイラに（XW_VERSION 4、範囲 rainbow）。P9 でトンネル・掘割（below.ts）。tunnel / cut / layer<0 の区間を below run として地表より下へ解き（土被りの天井は坑口から第20条の勾配で届く所だけ）、高架とは seam で C¹ につなぎ、坑口の記録 portals をタイルに（meta の features に below）。実行時はトンネルの箱（監査路・側壁・天井・照明）と掘割の擁壁をコライダーつきで押し出し、地形（コライダーは穴でクリップ）・一般道・歩道・建物を穴で切り欠き、トンネル内は空と太陽を遮って照明に置き換える（範囲 azabudai・azabudai_exit、XW_VERSION 4 のまま）。 P6 で規制速度をチャンクごとの OSM maxspeed（XW_VERSION 5、グラフの limit は G6 の posted）、範囲 shiodome（汐留の出入口）、W6 の at-grade の辿り直し、自動運転・交通 AI・ナビの解除と走行の確認（芝公園入口→C1 内回り→汐留出口→一般道を走り切った）。P2.7-1 で出荷範囲（`--range ship` で事業者の本線 ∩ 23 区とランプ、scope.ts）と全域スコアカード（`--report`、report.ts で閉鎖の根と道連れ・重なりの類型・地表追従・サイズ・ソルバ・段の時間・抽出の SHA-256）、抽出の固定、`--below all`。ship/pruned 323 run・本線の閉鎖 10・未許可の重なり 175 組・gzip 1.04 MB、pruneBelow なしでも未収束 0（P9 の破綻の記述を訂正）。P2.7-2 で固定点 block（`--partition blocks`、blocks.ts、計測専用・既定は無効でデータ不変）。本線の静かな区間の固定点で片に切り、片の連結成分ごとに solveShedding、固定点の値は seam の組の路線解。ship の A/B で pruned は k=1・1.5 が一括解と同等だが、all ではどの k も本線の閉鎖 14 → 18（41009552 が根に戻る）で未達、k は 2 のまま。既定範囲の all は解く段 130.6 → 13.1 s。P2.7-3 で縦断の目的 v2（`--objective v2`、計測専用・既定は無効でデータ不変）。目標を地表の上側包絡（designGround.ts）+ 標準桁下、地下は下側包絡 − 深さにし、弧ごとの勾配変化に L1（重み 1.5）。ship の強制の無い区間で反転 1.68 → 0.77 回/km（目標 0.8 以下）は届き、短波長相関 0.553 → 0.228・σ 0.696 → 0.433 m（目標 0.15・0.4）は未達。blocks の A/B のやり直しは all で T2 +3 になり k は暫定 1.5 のまま未達。
tags: [roads, terrain, rendering, testing, licensing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-11T10:00:00+09:00 }
verified:
  - { by: process:check-convergence-expressway-tunnels-s7-4b, at: 2026-11-22T14:38:00Z }
  - { by: process:vitest-s7-4b, at: 2026-11-22T13:40:00Z }
  - { by: process:check-expressway-terrain-s7-4b, at: 2026-11-22T13:44:00Z }
  - { by: process:measure-expressway-area-s7-3-c2d2700, at: 2026-11-21T22:24:00Z }
  - { by: process:make-expressway-data-s7-3-c2d2700, at: 2026-11-18T02:50:00Z }
  - { by: process:vitest-s7-3-review2, at: 2026-11-22T06:12:00Z }
  - { by: process:vitest-s7-3, at: 2026-11-18T01:48:00Z }
  - { by: process:measure-street-bands-r1-2a, at: 2026-11-18T02:30:00Z }
  - { by: process:vitest-street-bands-network-r1-2a, at: 2026-11-18T02:30:00Z }
  - { by: process:measure-street-bands-r1-2-0, at: 2026-11-18T00:30:00Z }
  - { by: process:check-expressway-lanes-r1-2-0, at: 2026-11-18T00:30:00Z }
  - { by: process:measure-expressway-area-r1-1a-review1, at: 2026-11-17T21:00:00Z }
  - { by: process:vitest-r1-1a-review1, at: 2026-11-17T20:20:00Z }
  - { by: process:measure-expressway-area-r1-1a, at: 2026-11-17T17:10:00Z }
  - { by: process:vitest-r1-1a, at: 2026-11-17T16:55:00Z }
  - { by: process:measure-expressway-area-s7-1-review1-25c4e6e, at: 2026-11-17T17:36:00Z }
  - { by: process:vitest-s7-1-review1, at: 2026-11-17T17:45:00Z }
  - { by: process:measure-expressway-area-s7-1, at: 2026-11-17T09:40:00Z }
  - { by: process:make-expressway-data-s7-1, at: 2026-11-17T09:15:20Z }
  - { by: process:vitest-s7-1, at: 2026-11-17T09:45:00Z }
  - { by: process:check-deck-drive-a1-r4, at: 2026-11-17T08:00:00Z }
  - { by: process:check-convergence-a1-r4, at: 2026-11-17T09:00:00Z }
  - { by: process:check-deck-drive-a1-r3, at: 2026-11-17T00:00:00Z }
  - { by: process:check-deck-drive-a1-edge-foot, at: 2026-11-15T06:10:00Z }
  - { by: process:seam-probes-a1-edge-foot, at: 2026-11-15T04:20:00Z }
  - { by: process:update-expressway-ledger-a1, at: 2026-11-15T04:26:28Z }
  - { by: process:vitest-a1-edge-foot, at: 2026-11-15T04:30:00Z }
  - { by: process:vitest-a0, at: 2026-11-15T02:30:00Z }
  - { by: process:seam-probes-a0, at: 2026-11-15T02:20:00Z }
  - { by: process:check-deck-drive-a1, at: 2026-11-15T00:00:00Z }
  - { by: process:vitest-a1, at: 2026-11-15T00:00:00Z }
  - { by: process:vitest-a2, at: 2026-11-14T21:45:00Z }
  - { by: process:make-expressway-data-a2, at: 2026-11-14T21:38:00Z }
  - { by: process:check-expressway-lanes-a2, at: 2026-11-14T21:38:57Z }
  - { by: process:update-expressway-ledger-a2, at: 2026-11-14T21:39:25Z }
  - { by: process:vitest-pr85-review, at: 2026-11-14T00:00:00Z }
  - { by: process:check-expressway-lanes, at: 2026-11-14T00:00:00Z }
  - { by: process:measure-expressway-area-7c, at: 2026-11-13T10:30:00Z }
  - { by: process:check-expressway-terrain, at: 2026-11-13T10:36:34Z }
  - { by: process:check-deck-drive, at: 2026-11-14T00:00:00Z }
  - { by: process:measure-expressway-area-7c2-merged, at: 2026-11-13T01:40:00Z }
  - { by: process:measure-expressway-area-7c2, at: 2026-11-13T00:55:00Z }
  - { by: process:vitest, at: 2026-11-13T00:47:00Z }
  - { by: process:check-deck-drive, at: 2026-11-13T04:00:00Z }
  - { by: process:check-expressway-feet, at: 2026-11-13T01:00:00Z }
  - { by: process:vitest, at: 2026-11-13T04:10:00Z }
  - { by: process:measure-expressway-area-7c0-review, at: 2026-11-12T20:23:18Z }
  - { by: process:measure-expressway-area-7c0, at: 2026-11-12T19:50:51Z }
  - { by: process:check-expressway-terrain, at: 2026-11-12T19:53:30Z }
  - { by: process:vitest, at: 2026-11-12T19:56:16Z }
  - { by: process:measure-expressway-area-7a2, at: 2026-11-13T02:00:00Z }
  - { by: process:check-deck-drive, at: 2026-11-12T18:14:00Z }
  - { by: process:check-expressway-terrain, at: 2026-11-12T17:40:51Z }
  - { by: process:check-deck-drive, at: 2026-11-12T17:21:00Z }
  - { by: process:check-expressway-terrain, at: 2026-11-12T16:52:05Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T16:50:47Z }
  - { by: process:check-expressway-terrain, at: 2026-11-12T15:52:52Z }
  - { by: process:check-deck-drive, at: 2026-11-12T16:24:00Z }
  - { by: process:check-expressway-terrain, at: 2026-11-12T14:59:09Z }
  - { by: process:check-deck-drive, at: 2026-11-12T15:28:00Z }
  - { by: process:check-deck-drive, at: 2026-11-12T14:14:00Z }
  - { by: process:check-expressway-terrain, at: 2026-11-12T13:48:20Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T14:00:00Z }
  - { by: process:vitest, at: 2026-11-12T14:05:00Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T12:36:00Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T12:09:00Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T11:13:00Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T10:33:00Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T09:47:27Z }
  - { by: process:update-expressway-ledger-byte-equal, at: 2026-11-12T09:49:00Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T06:47:00Z }
  - { by: process:check-deck-drive, at: 2026-11-12T06:41:10Z }
  - { by: process:vitest, at: 2026-11-12T06:08:56Z }
  - { by: process:update-expressway-ledger-twice-byte-equal, at: 2026-11-12T06:08:10Z }
  - { by: claude-fable/review-p276-5-round-02, at: 2026-11-12T06:00:00Z }
  - { by: process:check-deck-drive, at: 2026-11-12T05:52:43Z }
  - { by: process:shoot-views, at: 2026-11-12T05:58:20Z }
  - { by: process:vitest, at: 2026-11-12T05:21:28Z }
  - { by: process:update-expressway-ledger-twice-byte-equal, at: 2026-11-12T05:16:53Z }
  - { by: claude-fable/review-p276-5-round-01, at: 2026-11-12T05:00:00Z }
  - { by: process:vitest, at: 2026-11-12T04:49:33Z }
  - { by: process:check-deck-drive, at: 2026-11-12T04:42:52Z }
  - { by: process:shoot-views, at: 2026-11-12T04:48:13Z }
  - { by: process:update-expressway-ledger-twice-byte-equal, at: 2026-11-12T04:11:34Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T03:32:37Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T04:59:08Z }
  - { by: claude-fable/review-p276-pr1, at: 2026-11-12T04:30:00Z }
  - { by: process:vitest, at: 2026-11-12T04:16:26Z }
  - { by: process:measure-expressway-area, at: 2026-11-12T04:13:09Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-12T04:13:09Z }
  - { by: process:check-deck-drive, at: 2026-11-11T21:42:00Z }
  - { by: process:vitest, at: 2026-11-11T21:25:00Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-11T18:48:38Z }
  - { by: process:update-expressway-ledger-twice-byte-equal, at: 2026-11-11T18:50:00Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T17:11:01Z }
  - { by: process:check-deck-drive, at: 2026-11-11T17:20:00Z }
  - { by: process:shoot-views, at: 2026-11-11T19:10:00Z }
  - { by: claude-fable/review-p275-round-01, at: 2026-11-11T18:00:00Z }
  - { by: process:compare-expressway-chunks, at: 2026-11-11T15:43:58Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-11T15:43:57Z }
  - { by: process:update-expressway-ledger-twice-byte-equal, at: 2026-11-11T15:06:33Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T14:59:42Z }
  - { by: process:check-deck-drive, at: 2026-11-11T14:28:19Z }
  - { by: process:vitest, at: 2026-11-11T14:27:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T12:41:38Z }
  - { by: process:vitest, at: 2026-11-11T12:42:29Z }
  - { by: claude-fable/review-p273, at: 2026-11-11T13:43:24Z }
  - { by: process:mutation-tests, at: 2026-11-11T13:55:59Z }
  - { by: process:qp-weight-scan, at: 2026-11-11T14:01:50Z }
  - { by: process:make-expressway-data, at: 2026-11-11T14:01:31Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T14:02:59Z }
  - { by: process:vitest, at: 2026-11-11T14:04:13Z }
  - { by: process:make-expressway-data, at: 2026-11-11T13:13:28Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T13:14:46Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T13:08:37Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T12:57:25Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T12:50:20Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T12:24:44Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-11T12:24:29Z }
  - { by: process:vitest, at: 2026-11-11T11:18:01Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-11T11:15:32Z }
  - { by: process:measure-expressway-area, at: 2026-11-11T11:05:22Z }
  - { by: process:make-expressway-data, at: 2026-11-11T09:54:56Z }
  - { by: process:vitest, at: 2026-11-11T09:55:50Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-11T09:07:51Z }
  - { by: process:vitest, at: 2026-11-11T09:12:42Z }
  - { by: process:vitest, at: 2026-11-11T07:34:15Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-11T07:26:31Z }
  - { by: process:make-expressway-data, at: 2026-11-11T07:24:51Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T06:26:00Z }
  - { by: process:vitest, at: 2026-11-11T06:26:00Z }
  - { by: process:vitest, at: 2026-11-11T05:39:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T05:39:00Z }
  - { by: process:vitest, at: 2026-11-11T09:00:00+09:00 }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T08:45:00+09:00 }
  - { by: process:shoot-views, at: 2026-11-11T08:53:00+09:00 }
  - { by: process:vitest, at: 2026-11-11T03:30:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T03:40:00Z }
  - { by: process:expressway-build-twice-byte-equal, at: 2026-11-11T03:15:00Z }
  - { by: process:vitest, at: 2026-11-11T10:00:00+09:00 }
  - { by: process:make-expressway-data, at: 2026-11-11T09:50:00+09:00 }
  - { by: process:vitest, at: 2026-11-11T08:30:00+09:00 }
  - { by: process:vitest, at: 2026-11-11T06:10:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T05:55:00Z }
  - { by: process:shoot-views, at: 2026-11-11T06:20:00Z }
  - { by: process:vitest, at: 2026-11-11T04:00:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T03:57:00Z }
  - { by: process:shoot-views, at: 2026-11-11T04:02:00Z }
  - { by: process:vitest, at: 2026-11-11T02:10:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-11T01:48:00Z }
  - { by: process:shoot-views, at: 2026-11-11T01:54:00Z }
  - { by: process:perf-road-streaming, at: 2026-11-11T02:10:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-10T16:55:00Z }
  - { by: process:vitest, at: 2026-11-10T17:00:00Z }
  - { by: process:tsc, at: 2026-11-10T17:00:00Z }
  - { by: process:expressway-range-all, at: 2026-11-10T16:45:00Z }
  - { by: process:vitest, at: 2026-11-11T02:00:00Z }
  - { by: claude-fable/review-p25, at: 2026-11-11T00:00:00Z }
  - { by: process:vitest, at: 2026-11-10T16:00:00Z }
  - { by: process:tsc, at: 2026-11-10T16:00:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-11-10T15:00:00Z }
  - { by: process:expressway-range-all, at: 2026-11-10T15:40:00Z }
  - { by: process:vitest, at: 2026-11-10T11:30:00Z }
  - { by: process:perf-road-streaming, at: 2026-11-10T11:20:00Z }
sources:
  - id: deckdrive-lamp
    resource: src/world/deckOverhead.ts、src/world/streetLights.ts（LampSite.overhead・isUnderDeck・place・reanchor）、src/world/trafficControl.ts・orbis.ts（柱の当たり判定）、tests/streetLightsUnderDeck.test.ts、PR #70 のレビュー（Fable、依頼元 scratchpad の review70/）、走行の samples と計装のログ（依頼元 scratchpad の stall/samples-a1〜b3.json・f1〜f6.log・g1〜g3.log・h1〜h6.log・perf.py、.qa/logs/2026-11-12/、ローカル・git 管理外。2026-11-11T20:32〜20:58Z、vite 5737、ヘッドレス Chrome）
    title: 床版の走行検査の瞬間停止（高架下の街路灯の柱）の調査と修正
    author: claude-opus-5-5/1m
  - id: deckdrive-traffic
    resource: src/game/frameClock.ts・src/main.ts の step・tests/frameClock.test.ts、.qa/drive-deck-repro2.json・fix*.json と .qa/probe-deck.ts・probe2〜6.json（ローカル・git 管理外。2026-11-11、vite 5391、ヘッドレス Chrome、traffic.update を包んだ距離と speed·dt の比・自車の近くの AI の位置）
    title: 床版の走行検査の invalid（交通 AI の時間のずれ）の調査と修正
  - id: p273
    resource: src/expressway/designGround.ts（envelope）、compile.ts（Objective・setupRun・setupBelow の v2 の目標、RunSetup の重み）、vertical.ts（RunInput.gradeChange・targetScale、W_GRADE_CHANGE）、report.ts（版 4、forcingOf・free・height・below）、assumptions.ts（DESIGN_GROUND_REACH）、scripts/expressway.ts（--objective）、tests/expresswayDesignGround.test.ts・tests/expresswayObjective.test.ts・tests/expresswayBlocks.test.ts・tests/expresswayReport.test.ts・tests/expresswayFallbacks.test.ts（tests/fixtures/expresswayQpObjectiveV2.json）、計測は .qa/expressway/s3-*（s3-runs.jsonl、s3-heights-*.json、ローカル・git 管理外）、設計の指示と試作は依頼元 scratchpad の p27/s3-objective.md・p27/v2/
    title: P2.7-3 の縦断の目的 v2
  - id: p273a
    resource: src/expressway/compile.ts（solveComponent・solveShedding の窓の引き継ぎ、markSharedTouchdowns・untiedPairs・couplingsOf）、vertical.ts（PinMismatchError）、assumptions.ts（SHARED_TOUCHDOWN）、tests/expresswayTouchdown.test.ts・tests/expresswayFallbacks.test.ts・tests/expresswayBlocks.test.ts、計測は .qa/expressway/（m-・a-・ab- の ship-pruned・ship-all・default、ab-ship-all-k1.5、heights-*.json、ローカル・git 管理外）、設計の指示と試作は依頼元 scratchpad の p27/s3a-41009552.md・p27/x41/
    title: P2.7-3a の実装と計測
  - id: p271
    resource: src/expressway/scope.ts（出荷範囲）・report.ts（スコアカード）・overlapClass.ts（重なりの類型）・extract.ts（抽出の固定）、scripts/expressway.ts（--range ship・--below・--report・--accept-extract）、scripts/compareExpresswayReports.ts、tests/expresswayScope.test.ts・expresswayReport.test.ts。計測は .qa/expressway/{ship-pruned-1,ship-pruned-2,ship-all-1,ship-all-2,all-pruned}.report.json と logs/、生成物は .cache/expressway-area/（ローカル・git 管理外、2026-11-11）。設計時の探査は依頼元 scratchpad の p27/（universe.mts・probe.log・u2-pruned.json・u3-allbelow.json）、レビューの探査は review-p271/（scope.mts・scope2.mts・scope3.mts・scope.json）。基準のスコアカードは tests/fixtures/expresswayScorecard.ship.json
    title: P2.7-1 の出荷範囲とスコアカード
  - id: p9
    resource: src/expressway/below.ts（深さ・坑口からの届き・below run の可否・portals）、compile.ts（setupBelow・pruneBelow・belowPortals・endPlan の seam・blocked の解き直し後の判定）、network.ts（Run.below）、checks.ts（checkCover = T12）、src/world/expresswayBore.ts（断面・坑門・照明・地形の穴）、groundCuts.ts（地形のマスク・建物・歩道）、terrainCut.ts（地形のコライダーの切り抜き）、buildings.ts（addHiddenRings）、expresswayDeck.ts（tunnelExtras・tunnelAt・tunnelPoint・isSupportedMeta の features）、environment.ts（setShelter）、main.ts（groundY・遮蔽率・敷き直し）、tests/expresswayBelow.test.ts・expresswayBore.test.ts・terrainCut.test.ts
    title: トンネルと掘割（P9）
  - id: p9drive
    resource: .qa/drives/p9/tunnel-50.json・tunnel-60.json（ローカル・git 管理外。2026-11-11、vite 5353 番、ヘッドレス Chrome、advance() のゲーム時間、.cache/p9/drive.mjs）
    title: P9 の走行の記録
  - id: views-p9
    resource: .qa/views/expressway-tunnels/round-01〜05 と .qa/reviews/expressway-tunnels/round-01〜05.jsonl（ローカル、git 管理外。8 視点 × 昼・夜 = 16 コマ）
    title: P9 の多視点レビュー
  - id: p9review
    resource: 依頼元 scratchpad の p9review/（Fable のレビューの検証スクリプト gap.mjs・gap2.mts・plan.mts・an*.mjs、e-Gov の条文 XML）
    title: P9 のレビュー（Changes Requested、2026-11-11）
  - id: egov34
    resource: https://laws.e-gov.go.jp/api/1/lawdata/345CO0000000320（道路構造令の本文 XML、2026-11-11 取得）
    title: 道路構造令 第12条（建築限界 H 4.5 m）・第34条（トンネルの換気・照明・非常用施設）・第8条第5項（トンネルの路肩の縮小）
  - id: p7
    resource: src/expressway/structures.ts（構造物上書き）、compile.ts（chainPin・runOver・profilePins・structureCheck・majorityClass）、horizontal.ts（pin）、vertical.ts（ProfilePin・reconstruct）、scripts/expressway.ts（landmarks.json の読み込み・臨港道路の way）、src/world/expresswayDeck.ts（apronTriangles）、expresswayRoads.ts（street の線と地表端）、tests/expresswayStructures.test.ts
    title: 構造物上書き（P7）
  - id: p7drive
    resource: .qa/drives/p7/drives-r3.json（レビュー後の現データ）と drives-r2.json（4 段テーパーの版）・drive.mjs（ローカル・git 管理外、2026-11-11、vite 5347 番、ヘッドレス Chrome、advance() のゲーム時間）
    title: P7 の走行の記録
  - id: views-p7
    resource: .qa/views/expressway/round-01〜03 と .qa/reviews/expressway/round-01〜03.jsonl（ローカル、git 管理外。試験区間 10 視点＋レインボーブリッジ 7 視点 × 昼・夜 = 34 コマ）
    title: P7 の多視点レビュー
  - id: design
    resource: knowledge/road-redesign-plan.md（道路再設計の方針、2026-11-10）4.1〜4.5・4.7・8 章 P1・9 章
    title: 設計書
  - id: code
    resource: src/expressway/（network・horizontal・vertical・qp・sparse・profile・overlap・superelevation・section・compile・checks・format・ranges・allowlist）、scripts/expressway.ts、src/world/expresswayDeck.ts、src/main.ts（?expressway）
    title: 実装
  - id: p3
    resource: src/world/expresswayDeck.ts（コライダー・出し入れ）、src/world/expresswayRoads.ts（グラフの線・ランプ端）、src/world/expresswayMarkings.ts（壁高欄の要否・区画線）、src/debug/expresswayDrive.ts（一定速の走行フック）、tests/expresswayDrive.test.ts
    title: P3 の実行時（走れる高速道路）
  - id: drive
    resource: 依頼元 scratchpad の qa/drives-r1.json（2026-11-11、vite 5317 番、ヘッドレス Chrome、?expressway&start=35.6534,139.7500、ログ expressway_drive_checked）
    title: 自車を一定速で走らせた記録
  - id: p35
    resource: src/world/expresswayMerge.ts（一体化の幾何）、src/world/expresswayMarkings.ts（DeckIndex を decks から、区画線の切り方）、src/world/expresswayDeck.ts（断面・継ぎ目のリング）、tests/expresswayDrive.test.ts（合成の分流・逆向きの並走・生成済みデータの継ぎ目）
    title: P3.5 の床版の一体化
  - id: drive35
    resource: .qa/drives/p35/drives-p35.json（一体化の初版）と drives-p35d.json（レビュー対応後）、ローカル・git 管理外（2026-11-11、vite 5391 番、P3 と同じ drives-all.mjs・advance() のゲーム時間。元は依頼元 scratchpad の qa/、消えるので .qa へ写した）
    title: P3.5 の走行の記録
  - id: views-p35
    resource: .qa/views/expressway/round-01〜02 と .qa/reviews/expressway/round-01〜02.jsonl（ローカル、git 管理外、10 視点 × 昼・夜）
    title: P3.5 の多視点レビュー
  - id: views-p3
    resource: P3 の worktree（agent-a7d26aad1b07d35a3）の .qa/views/expressway/round-01〜03 と .qa/reviews/expressway/round-01〜03.jsonl（ローカル、git 管理外。P3.5 の worktree の同名の周は P3.5 のもので、P3 の周ではない）
    title: P3 の多視点レビュー（9 視点 × 昼・夜、3 周で収束）
  - id: tests
    resource: tests/expresswayAlignment.test.ts、tests/expresswayData.test.ts、tests/expresswayDeck.test.ts、tests/expresswayDrive.test.ts
    title: T1〜T10 と合成テスト（一括解・同一面と 1 段離し・区間ごとの V・エルミート補間・ノーズ）、生成済みタイル全件、デッキの幾何
  - id: osm
    resource: https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf
    title: Geofabrik 関東抽出（replication 2026-10-03T20:20:50Z の版で生成）
  - id: shots
    resource: 依頼元 scratchpad の p25/round1・round2（below・side・aerial・c1-parallel・nose・jct・trans-c1・exit-dive・jct-trans）、修正前の p25/r3。ヘッドレス Chrome・昼晴れ・1280×800。P1 の p1/*.png
    title: 多視点の撮影
  - id: all
    resource: 依頼元 scratchpad の p25/all.log・all2.log（--range all を --out で一時フォルダへ）、p25/encode.mts（データ量の試算）
    title: 全域の生成
  - id: review
    resource: 依頼元 scratchpad の review-p25/（driver.mts・checkdump.mts・ends.mts・unsolved.mjs、all-run2.log・qp-all.json・dump-all.json）
    title: P2.5 のレビュー（Fable、全域出力への checks の適用と未解決の内訳）
  - id: p26
    resource: 依頼元 scratchpad の p26/（driver.mts・checkdump.mts・unsolved.mts・overlaps.mts・ship.mjs、base〜r8 の .log・.check・.json、badqp-*.json、qptrace.ts）
    title: P2.6 の全域計測（r8 が現行コード、base が P2.5 のコード）
  - id: egov
    resource: 道路構造令（e-Gov 法令 API v2、345CO0000000320、依頼元 scratchpad の egov/）第3条第2項・第12条・第13条・第15条・第18条・第20条・第22条・第25条・第28条第4項
    title: 法令本文
  - id: perf
    resource: ../.qa/perf/*-streaming/report.json（2026-11-10、芝公園で ?expressway の有無を交互に各 2 回、ローカル保存）
    title: perf-road-streaming の A/B（P1）
---

# 構成

| 段               | 置き場                              | 内容                                                                                                                                                                                                                |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 法令値           | `src/law/roadStandards.ts`          | 条文つきの定数（[道路構造令・標識令の値](road-standards.md)）                                                                                                                                                       |
| 仮定             | `src/expressway/assumptions.ts`     | 桁高 2.2 m・標準桁下高 6.5 m・橋脚間隔 35 m・壁高欄 1.1 m・f 0.15 など。全部 `verified: false`                                                                                                                      |
| 正規化・チェーン | `network.ts`                        | motorway / motorway_link を way 単位で正規化。layer タグの無い bridge は OSM の慣例どおり layer 1（`layerOf`）。チェーンにつなぎ、構造（高架かそれ以外か）で run に切る                                             |
| 平面線形         | `horizontal.ts`                     | 1 m 標本、三階差分の二乗和＋OSM への引き戻し（ずれ ε=1.5 m 以内）。他のチェーンと共有する節点は固定                                                                                                                 |
| 設計速度         | `compile.ts`（`speedZones`）        | 標本ごとに way のタグの速度から、その場の R が第15条の値を下回る間だけ下げ（本線 40・ランプ 20 まで）、下げた所は第18条の長さだけ前後に広げ、120 m 未満の速い島は遅い側に合わせる。チャンクは速度の変わり目でも切る |
| 縦断線形         | `vertical.ts`・`qp.ts`・`sparse.ts` | 下の節                                                                                                                                                                                                              |
| 床版の重なり     | `overlap.ts`                        | `planOverlaps`（計画線どうし、拘束を作る）と `deckOverlaps`（タイルだけから再計算、`deck_overlap` 診断とデータテスト）                                                                                              |
| 補間             | `profile.ts`                        | 測点の標高と勾配の三次エルミート（`hermite`・`surfaceAt`）。デッキと P3 の surfaceY が同じ関数を使う                                                                                                                |
| 片勾配           | `superelevation.ts`                 | e = clamp(V²/127R − f, 0, 10 %) を区間の V で。分合流の端は親の値、同一面の相手の値を `pins` で固定し、変化率を前後のパスで保証                                                                                     |
| まとめ           | `compile.ts`                        | 範囲に触れる run の連結成分（全域で決める）を丸ごと解き、測点・橋脚・交差・blocked を ≤300 m のチャンク `<run>:<k>` に切る                                                                                          |
| 出力             | `scripts/expressway.ts`             | v6（P2.7-4）: z14 タイル（チャンク・run の要約・入口）、索引の `meta.json`、記録の `report.json`、`LICENSE.txt`。`ledger.json` は取っておいて戻す。`--out` で別のフォルダへ（全域の試算用）                         |
| 許容             | `allowlist.ts`・`ledger.ts`         | 類型の規則（run の ID 無し）と、データのフォルダごとの台帳 `ledger.json`（`scripts/expresswayLedger.ts`、P2.7-4）                                                                                                   |
| 描画             | `src/world/expresswayDeck.ts`       | チャンクごとに 1 回押し出してキャッシュ。測点間はエルミート面から外れる量が 1 cm 以下になるまで断面を足す（最大 8 分割）                                                                                            |

# 縦断線形の解き方（連結成分の一括 QP）

各 run の縦断は P1 と同じ「節点間隔 h の等長放物線区間の列」（h は run の最高速度の第22条の最小縦断曲線長以上）。変わったのは解き方と拘束の出どころ。[^code]

- **連結成分**: 分合流（`endPlan` の親）・交差（`findCrossings`、OSM layer が違うもの）・床版の重なり（`planOverlaps` の測点の組）でつながる run を union-find でまとめ、成分ごとに 1 つの QP にする。成分は全域（UNIVERSE）で決めるので、範囲を変えても同じ run は同じ問題で解かれる（T8）。試験区間の 7 run は 54 run・約 70 km の成分に入る（変数 3,890、行 約 3.2 万）。全域で最大の成分は 268 run（変数 25,228）。
- **拘束**: 節点の勾配（行ごとに、前後 1 区間にかかる区間の V の第20条（特例は段階で）と第25条の小さい方）・区間の縦断曲線半径（かかる区間の最高 V の第22条）だけが硬い拘束。自分の測点の桁下（地表・地上道路・鉄道）、交差の桁下、端（地表・坑口）、分合流（子の端 = 親の標高・勾配）、床版の重なり（同一面 |Δz| ≤ 5 cm／1 段 ≥ 4.5 m + 桁高）は L1 の厳密罰金（軟らかい行）。重みは 重なり 5 < 桁下・交差 200 < 端・分合流 2000（1 m あたり）で、矛盾があれば重なりから譲る。行ごとの重みなので厳密な優先順位ではなく、多数の重なり行がまとめて 1 つの桁下行に勝つことはありうる（当初の「各段 10 倍」という書き方は誤りで訂正した: 桁下は重なりの 40 倍、端は桁下の 10 倍）。
- **目的**: 地表 + 標準桁下高 + 桁高（±60 m 平均）への近さと勾配の滑らかさだけ。**OSM layer は目標高に使わない**（P1 の逸脱を解消）。layer は交差と重なりの上下の向きにだけ使う。
- **解法**: 疎な主双対内点法（Mehrotra 予測子・修正子）。縮約した準定値行列 [P + AᵢᵀDAᵢ, Aₑᵀ; Aₑ, −δ] を最小次数順の疎 LDLᵀ で毎反復 1 回分解する。試験区間の成分は 40〜60 反復、1 回 1〜3 秒。ADMM（OSQP 方式）を先に試したが、この成分で 4 万反復でも収束しなかった（ほぼ LP で目的が弱い）。**訂正（2026-11-11 レビュー）**: 当初「条件数によらず収束する」と書いたが誤り。全域では 640 回中 13 回（6 成分・375 run）が数値的に破綻し（非有限の step）、直前の反復を黙って返していた。今は `solveQp` が `status`（converged / max_iter / broken）を返し、未収束は診断 `solver_not_converged`・ログ `expressway_solved.unconverged`・`meta.solver.unconverged` に残し、未収束の解では段を進めない。符号の違うピボットは正則化して数え、解くたびに元の行列に対して反復改良を 2 回かける。D の s/λ が 0/0 にならないよう下限を置いた。試験区間は全成分が収束している（データテストで確認）。**原因（P2.6、訂正）**: 13 回はどれも主残差 4e-11 以下・双対残差 1e-6 以下を満たし、平均の相補性 λs が 2.5e-9〜1e-7 で当時の絶対 1e-9 に届かないだけだった。そのまま反復すると D = λ/s が 2e-13〜2e16（29 桁）に広がり、倍精度で縮約行列の準定値の符号が崩れて（最後の分解で 34〜261 個のピボットを正則化）次の step が NaN になる。~~内点法の数値的破綻~~ は条件数そのものより終了判定の過剰な要求が引き金。`gapTol` を 1 対あたり 1e-7（最大の成分でも目的関数で 0.03 未満、最も弱い重なりの行で mm）にすると 13 件とも 19〜73 反復で正則化 0 のまま収束する（再現の QP を tests/fixtures/expresswayQpStall.json に保存、1e-9 では今も `broken` になることもテスト）。D の切り詰めや正則化の増量は、解の近くで Newton 方向を変えて止まる場所を動かすだけなので採らない。加えて ±δ の静的正則化を行列ではなく分解だけに入れ、反復改良で δ なしの系へ戻すようにした（行列に入れていると等式が δ·|y| までしか満たせず、試作の「親を固定した仕上げの解」で主残差 6e-8 に止まった）。全域 r8 は 471 回すべて収束。[^p26]
- **仕上げと判定**: 親から子の順に、端（親の値・地表）をちょうどに合わせ、残りの誤差は内部の勾配へ配る。そのうえで余裕なしの元の拘束（勾配・半径・測点の桁下・端・交差の桁下）を run ごとに判定する。
- **解けないとき**: 失敗した run だけを設計書 4.3 の 3 の段階（特例勾配 → V を下げる → 交差の桁下のみ）へ 1 段進め、成分を解き直す。「交差のみ」まで進んだ run は地表の床を外すので T4 を満たさない。診断は `vertical_crossings_only` として `vertical_fallback` と分け、許可リストの `*` には含めない。重なりを守れないランプ（ノーズから地表へ降り切れない出口など）も「交差のみ」の手前まで速度を下げてよく、下げても改善しなければ一番ましな段へ戻す。本線は重なりだけでは速度を下げない。

## 床版の重なりの決め方

`planOverlaps` は 5 m ごとの計画線の点が相手の車線域（車線＋路肩。壁高欄は含めない）に 0.5 m の余裕で入る組を両方向に列挙する。組の関係は (1) 交差点の近く → 交差の上下（layer）、(2) 二つの run が共有する節点（ノーズ）から重なりが続く間 → 同一面、(3) それ以外 → 同じ layer なら同一面、違えば上が 1 段上。同じ layer の交差（`crossing_layer_ambiguous`、全域 2 件）の近くは拘束しない。同一面の組は片勾配も揃える（同じ向きは同値、逆向きは符号反転 = 一枚の床版の横断勾配）。

**定義の変更（訂正）**: P1 の `deck_overlap` は壁高欄を含む床版の帯で数えた（8 組・177 測点、片方向）。設計書 4.2 の文言（車線域が重ならない）に合わせて車線域に変えた。比較のため同じスクリプト（両方向・線形補間）で数えると、P1 のデータは床版の帯で 360 測点・車線域で 316 測点、新しいデータは 68 / 44 測点。

# 地表・地上道路との関係

- 桁下の床は、5 m の拘束点ごとに前後 2.5 m の地表の最高値で取る（平滑化した DEM にも数 m で 0.5 m の起伏が残り、拘束点の間で 6.67 m に下がった。T4 が検出）。
- 地表端の近くで標準勾配では越えられない「地上」の道路は、P1 と同じく拘束にせず `crossing_over_or_at_grade` とし、**チャンクの `blocked`（s・道路の天端・床版の高さ）に記録する**（P3 で通行止め・迂回を決める）。到達可能かの判定は端の地形勾配からの立ち上がりで、0.1 m の余裕を見る。
- **坑口と擦り付けの区別（W10）**: run の外へ続く way がトンネル・掘割なら端は `portal`（`into: tunnel|cut`）で、標高だけ地表に合わせ勾配は自由（下り続ける）。地平へ続くなら `ground` で地形の勾配にも合わせる。T5 は portal では標高だけを見る。**訂正（P2.6）**: 端の `ground` には DEM ではなく床版自身の標高を書いていたので、T5 の「端と ground」は自己参照だった。今は端の DEM を書き、T5 はそれと測点の地表の両方に対して ±5 cm を見る。試験区間では外回り 45021976 と羽田線への分岐 4848762 の終点が掘割の坑口。

# 試験区間の結果

`just make-expressway-data`（`hamazakibashi`）。run 7・チャンク 81・測点 1,548・橋脚 323・交差の記録 60、タイル 6 枚 127,343 B（P2.6 の再生成で測点 1,549・127,378 B。チャンクに重なりの区間 `decks` を足した後。データ形式は `meta.version` 2）（P1: 61 / 1,372 / 86,185 B）。連結成分 54 run はすべて解け、未解決 0。計算は 8 回の QP（段の進めと戻し）で約 7〜20 秒（並行負荷で変動）、生成全体 約 2 分（pbf と地上道路の読み込みが大半）。[^code]

| run       | 区分       |    長さ | V（タグ → 区間） | 縦断                   | 地表からの高さ 中央値／最大（P1） |
| --------- | ---------- | ------: | ---------------- | ---------------------- | --------------------------------- |
| 24402611  | C1 内回り  | 5,043 m | 60 → 60・50・40  | 標準                   | 9.3 / 17.8 m（16.5 / 24.5）       |
| 45021976  | C1 外回り  | 3,532 m | 60 → 60・50・40  | 標準、終点は掘割の坑口 | 8.5 / 17.6 m（15.4 / 22.5）       |
| 4848762   | 羽田線へ   | 4,889 m | 60 → 60・50・40  | 標準、終点は掘割の坑口 | 9.1 / 18.7 m（27.8 / 30.2）       |
| 813455519 | 羽田線→C1  |   317 m | 40               | 標準                   | 10.0 / 11.9 m                     |
| 4853798   | 芝公園出口 |   272 m | 40 → 20          | 特例勾配・V20          | 7.7 / 7.9 m                       |
| 4853799   | 芝公園出口 |   237 m | 40 → 40・30      | 標準                   | 5.3 / 8.7 m                       |
| 207111988 | 芝公園入口 |   278 m | 40 → 40・30・20  | 標準                   | 5.7 / 9.5 m                       |

生成済みタイル全件で T1〜T7 は違反 0。加えて、測点の間のエルミート面を 1 m ごとに見る `checkSurface`（勾配と 10 m の曲率）も違反 0。これは最初、節点（放物線のつなぎ目）をまたぐ測点区間で三次式が勾配を 5.02 %（上限 5 %）、曲率を 1.05e-3（上限 1/1000）まで行き過ぎて検出したので、曲率が変わる節点には必ず測点を置くようにした（測点は 1,402 → 1,548）。**訂正（2026-11-11 レビュー）**: 最初の実装は節点を測点へ寄せる判定を添字で行っており、先に節点を足すとチャンクの終端 b が節点へ動いた（全域で継ぎ目の隙間 60 か所・最大 2.49 m、段差 54 か所・最大 6 cm）。また、端から 2.5 m 以内の節点が測点にならず、32404414:6 で勾配が 9.01 % になった。今は端を値で判定して動かさず、節点は必ず置く（`stationPositions`、再現テストあり）。[^tests]

T10 の内訳は `vertical_fallback` 29・`crossing_over_or_at_grade` 32・`deck_overlap` 4・`ramp_radius` 1（成分の連結路 203873831、R 13.4 m）。P2.6 の再生成では成分の他の run に `deck_below_ground` 1（0.05 m、最終段の run）が加わり、`vertical_fallback` は 35。~~試験区間の 7 run の高さと 4 組の重なりは変わらない~~ **訂正（P2.6 レビュー）**: 高さは動いている。HEAD（P2.5）との差（p26-review-cmp2.mjs、同じ測点の s で比較）: 24402611 は最大 −1.29 m（706〜987 m）・+0.80 m（1,179〜1,563 m）・−1.09 m（4,629〜4,907 m）、45021976 は −1.03 m（140〜420 m）、4848762 は −1.85 m（3,831〜4,036 m）ほか 6 区間、813455519 は 0.06 m 以内、出口・入口の 3 run は 1 cm 以内。地表からの高さの中央値は 9.32 / 8.37 / 9.04 m（P2.5: 9.32 / 8.54 / 9.11）。原因の切り分け（試験区間の成分を 1 つずつ戻して解き直し）: 仮定の床の緩和を最終段に限っても変わらず、「V を下げる」を窓でなく run 全体に戻すと 24402611 以外は 0.7 m 以下、低い親からの分岐の登りを外すと 0.9 m 以下、P2.6 の変更を全部戻すと 0.10 m 以内（残りは終了判定と段の比較）。つまり成分の中の別の run が V を局所に下げ、登りの区間が変わったことで、連結した C1 が動いた。重なり 4 組は上限内（24402611×45021976 の 6.56 m、45021976×4848762 の 6.42 m は上限ちょうど）。多視点（expressway 表 3 コマ、2 周）で折れ・段差・地面への貫通は見えず、`just check-convergence expressway` は converged。許可は `allowlist.ts` だけが決める。`deck_overlap` は全体の許可（P1 の `*`）をやめ、組ごとに理由と上限（測点数・|Δz|）を書いた。上限を超えたら新しい指摘として落ちる。データテストは overlap.ts を使わず、総当たりで重なりを数え直して照合する（以前はコンパイラと同じ関数で数えて比べており、自己参照になっていた）。残る 4 組・41 測点は、C1 内回り・外回りが二層から並列へ移る区間（OSM の中心線間隔 6–8.6 m < 車線域の幅の和 8.5 m）と浜崎橋 JCT の三者（4848762 のノーズ・内回り・外回り）で、どこへ移り変わりを置いても重なりに入る。芝公園出口 4853798 の「本線の側面に潜る」重なり（P1 の 18 測点）は、ランプの段を V20 まで下げて解消した。

# 全域（`--range all`）

763 run、181 成分。T8 のため成分ごとに解くので試験区間の出力とは別フォルダに書いた（リポジトリには入れていない）。[^all]

- 1 回目（測点の節点追加・地表の最高値の前）: 出力 481 run・チャンク 2,322・測点 37,919・**3,091,953 B**。未解決 282 run（`vertical_unsolved` 88、その子で親が無いため外した `parent_unsolved` 194）。P1 の見通し（平坦地で 598 run を解いて 165 未解決）より多いが、P1 は地上道路と DEM を入れない平坦地の試算で、比べられない。未解決の理由（最後の段）は、端の標高の食い違い 38（短い run の両端が分合流や地表で決まり、勾配の上限で届かない）、桁下の不足 53、第22条の最小縦断曲線長に満たない短い run 22、勾配・半径 30（重複あり）。解く時間は 952 秒（QP は 123 秒だけで、残りは全 run × 地上道路 8.7 万本の交差判定。外接矩形で先に間引くよう直した）。
- 2 回目（現行のコード）: 出力 481 run・チャンク 2,321・測点 45,580（節点の測点を足して +20 %）・**3,494,712 B**。未解決は同じ 282（88 + 194）。解く時間 80 秒（QP 61 秒、181 成分・640 回）、生成全体 181 秒、ピークメモリ 約 4 GB。設計速度の区間は計画段階で V60 が 355 km（run ごとに最も遅い区間を取った P1 相当なら 87 km）。ただし縦断の段の「V を下げる」は run 全体に掛かるので、32404414（K1、17.8 km、計画では 120 m だけ V50）は特例勾配でも解けず run 全体が V50 になった（下げる範囲を失敗した場所の周りに限るのが残課題）。

- 3 回目（レビュー後の修正を入れたコード、2026-11-11）: 継ぎ目の隙間・段差は 0（C1 の修正を確認）。未収束は 619 回中 13 回（7 成分）で、今は `solver_not_converged` として 7 件出る。未収束の成分では段を進めないので、未解決は 406（`vertical_unsolved` 228 + `parent_unsolved` 178）に増えた。2 回目は、壊れた反復のまま段を進めて解けたように見えていた run を含んでいた。出力は 357 run・2,373,032 B、`vertical_crossings_only` 17、`deck_overlap` 156 組。解く時間 36 秒。収束の改善（破綻する成分の原因の特定）は P2.6 の最初の仕事。
- **全域の検査（2026-11-11 レビュー、訂正）**: 2 回目の全域出力にデータテストと同じ checks を掛けると、T1〜T4・T6 で違反が出る。T1・T3 は上の節点スナップの不具合（C1）、T4 は「交差のみ」の run を `vertical_fallback` の `*` で許可していたこと（W3）、T6 は V80 本線の検査（W9）。全域の出力は出荷できる状態ではない。
- **未解決 282 の内訳（レビュー）**: 連鎖で外れた `parent_unsolved` 194 は、根をたどると 14 run に集まる。うち上位 2 本が 16〜29 cm 足りないだけで 141 run が外れている。根の `vertical_unsolved` 88 の約半分は、両端が地表の 100 m 未満の短い橋。地上を走る way 1,077 本は run として生成していない（P9）。
- **重なり 232 組の内訳**: ランプ×ランプ 109、本線×ランプ 96、本線×本線 27（計 1,516 測点）。最大 |Δz| は 0.5 m 未満が 114 組（ノーズで同一面を少し外す）、0.5〜3 m が 28、3 m 以上が 90（移り変わり・二層の矛盾）。
  `deck_overlap` は全域で 232 組（2 回目、未許可）。`ramp_radius` 6 件（R 10.7〜14.5 m）は OSM の線形のままの半径で、平面を ε 以上動かさない決まりから広げず、run ごとに理由つきで許可した（15 m は仮定で法令の下限ではない）。

## データ量

**v6（P2.7-4）**: meta.json は索引だけ（既定 1,035 B・ship 1,993 B）、run の要約と入口はタイル、診断などは report.json（ゲームは読まない）。下の P2.7-4「大きさ」。以下は v2 の頃の試算。

全域 3.09 MB は目安 1 MB の 3 倍。測点 1 個あたり 76 B（7 値の JSON）。`encode.mts` で試算（試験区間、117,520 B）:

| 形式                                                        |      生 |   gzip | brotli |
| ----------------------------------------------------------- | ------: | -----: | -----: |
| 現行（JSON 配列）                                           | 117,520 | 35,722 | 26,073 |
| 量子化した差分（s cm・経緯度 1e-7°・z mm…、前の測点との差） |  78,084 | 26,027 | 21,550 |
| 同上で地表の標高を落とし、経緯度をチャンク内の cm に        |  72,398 | 23,624 | 19,507 |

全域（3,494,712 B）では量子化差分で 2,366,876 B、地表を落とし局所座標にして 2,192,948 B（生で 37 % 減）、それに gzip で 714,006 B・brotli で 594,751 B。生のままでは 1 MB に届かず、配信時の圧縮と合わせて目安を満たす。形式は変えていない（デコードの置き場とキャッシュの扱いを決めてから）。

# P2.6: 全域に向けたモデルの変更

設計速度・縦断の段・判定を次のように変えた。どれも src/expressway/ の中だけで、データ形式は version 2 のまま（チャンクの `vform`、meta の `closed` を任意のフィールドとして足した）。[^code][^p26]

| 項目                        | 変更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 根拠・結果（全域）                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 短い run の地表端（方針 b） | 3 本の第22条の曲線長（2 区間）に満たない run は、地表端を DEM ±4 cm の帯で受け、勾配は第20条の内で自由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 端を標高・勾配とも固定すると 0〜1 自由度しか残らない。長い run は従来どおり地形の勾配に合わせる（P9 で地平の道路へつながるため） |
| 短い連結路（方針 b）        | 両端が親につながる短いランプは変数を持たず、親 2 本の（標高・勾配）からの 3 次エルミート（`vform: "cubic"`）。勾配と曲率は面の上で判定し、第22条の最小長は第28条第4項で適用しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 全域 r8 で 13 run。C¹ は構成で成り立つ                                                                                           |
| V 下げは局所（方針 c）      | 「V を下げる」段は失敗位置（構造化した `RunProblem.s`）の ±150 m だけ（`capZones` の窓）。節点間隔は一様のまま                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 32404414（K1、17.8 km）は V50 が 17.8 km → 119 m                                                                                 |
| 最良状態の保持（W1）        | 段を進めるたびに（本線の未解決数、ランプの未解決数、重なりの不足量）で比べ、最良の状態を残す。段の残っていない run が分合流の端・交差で失敗したら相手の run を 1 段進める                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 未解決の診断の最後に「kept: …」として採用した状態の失敗を書く                                                                    |
| 法令と仮定の区別（W2）      | 失敗を law（第12・20・22条）／assumed（開けた地表の床、DEM − 0.25 m）／coupling（端・分合流）に分ける。仮定の床は最も低い V でも解けない run だけの最終段（`assumedGive`）で、別の弱い行（重み 50 < 交差 200）にし、上限つきで解けたことにして量と位置を診断に出す（`below_open_ground_floor` ≤ 0.5 m、`deck_below_ground` ≤ 0.75 m）。床と上限はどれも `assumptions.ts` の仮定（`OPEN_GROUND_FLOOR`・`OPEN_FLOOR_GIVE`・`DEM_SINK_FLOOR`・`DEM_SINK_GIVE`・`GROUND_END_BAND`、verified: false）で、0.5 m は第12条ただし書（第三種第五級の H 4 m）から値を借りただけ（23 区の高架の下にその級の道路がある根拠ではない）。~~桁下 4.0 m は第12条が第三種第五級にやむを得ない場合に認める H~~（訂正: 当初は法令の根拠のように書いた。床は第12条の 4.5 m を地表全体に当てはめた仮定）。T4 はこの量までを差し引いて判定 | 41009552 の「11 m で 0.16 m」の型は解けるようになったが、同じ run は今は交差の 0.20 m 不足（法令）で失敗している                 |
| 低い親からの分岐            | 親がまだ地表から登っている区間で分かれる run は、その端も「低い端」として登りの区間を床の外にする（`isLowEnd`、検査は `climbingEnds`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 「交差のみ」まで落ちていた 9 ランプが解ける                                                                                      |
| 「交差のみ」の段            | 一括解の段から外した。標準桁下を毎回判定するので、床を外しても通らない run と隣を沈めるだけだった                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `vertical_crossings_only` は出なくなった                                                                                         |
| 本線を巻き込まない          | 本線が失敗している成分では、失敗したランプ（とそこから下がる run）を外して解き直す（`solveShedding`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P2.5 の 2 本の本線が 141 run を道連れにした型                                                                                    |
| V80（W9）                   | 第13条 第二種第一級（80、下欄 60）と第3条第2項ただし書の 1 級下げ（第二種第二級 60・50・40）を検査に入れた。ランプ（第28条第4項で第13条の適用外）も 80 まで                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 下の表                                                                                                                           |

**方針 (e)（ノーズの従属）は採れなかった**: ノーズの同一面を分合流と同じ重み（2000）にすると、全域の親子の重なりは 39 → 7 組に減ったが、未解決が約 50 run 増え、試験区間では都心環状線外回り 45021976 が出口を逃がすために標準桁下を 2.57 m 割って未解決になった（18 run が道連れ）。枝だけが前回の解の親の面に従う一方向の形も試したが、解き直すたびに親が数 cm 動くので重なりは 39 → 126 組に増えた。ノーズは P2.5 と同じ重み 5 に戻した。重なりを類型ごとの上限つき規則で許可する作業もしていない（下の 295 組は全部未許可のまま）。

V80 の法令値（e-Gov で確認、`src/law/roadStandards.ts`）:[^egov]

| 条     | 内容                   | V80 の値                     |
| ------ | ---------------------- | ---------------------------- |
| 第13条 | 第二種第一級の設計速度 | 80（やむを得ない場合 60）    |
| 第15条 | 曲線半径               | 280 m（特例 230 m）          |
| 第18条 | 緩和区間長             | 70 m                         |
| 第20条 | 縦断勾配               | 4 %（特例 7 %）              |
| 第22条 | 縦断曲線半径・長さ     | 凸 3,000 m・凹 2,000 m・70 m |
| 第25条 | 合成勾配               | 10.5 %                       |

## 全域の 4 回目（P2.6、r9）と出荷条件

`driver.mts`（scripts/expressway.ts と同じ入力をキャッシュしたもの）で全域を解き、`checkdump.mts` でデータテストと同じ checks を掛けた。763 run・181 成分、解く時間 99 秒（QP 64 秒、495 回）、ピークメモリ 1.3 GB。出力 702 run・3,636 チャンク・68,003 測点・**5,624,983 B**（gzip 1,612,842 B、brotli 1,128,171 B）。r8（レビュー前）は 655 run・5,173,381 B。[^p26]

| 出荷条件                                | 結果                                                                                                                                                                                                                                                                                                                                                                                                                     | 判定   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| T1〜T7 違反 0                           | T1・T2・T4・T5・T7 は 0。T1/T2 の面の上の勾配 3 件（24636451・45248411 で 5.01 %、81816418 で 8.04 %）、T3 のチャンク端の向き 1 件（201771589:37）、T6 は許可済みの 203059413 だけ（データテストは許可の半径で判定）。~~節点を挟む測点区間のエルミートの行き過ぎ~~ **訂正（レビュー）**: 原因は測点が 0.59〜3.3 m と近すぎること（45248411:23 は 2.14 m）で、z 1 mm・s 1 cm・経緯度 1e-7° の丸めが区間の勾配と向きに効く | 未達   |
| 本線の未解決 0                          | 本線 211 のうち閉鎖 15（すべて vertical_unsolved）                                                                                                                                                                                                                                                                                                                                                                       | 未達   |
| ランプは理由つきで 5 % 以下・閉鎖の記録 | 552 のうち閉鎖 46（8.3 %）。閉鎖は meta の `closed`（run・chain・cls・理由の kind）に記録                                                                                                                                                                                                                                                                                                                                | 未達   |
| 最終解が全成分で収束                    | 181 成分の最終解はすべて収束（495 回中 1 回、外したランプを戻す仕上げの解が未収束で、その解は使っていない）                                                                                                                                                                                                                                                                                                              | 達成   |
| 未許可の deck_overlap 0                 | 332 組・2,843 測点。親子 本線×ランプ 131・ランプ×ランプ 50・本線×本線 15、その他 120、兄弟 20。最大 \|Δz\| 0.3 m 未満 102 組・0.3〜6.7 m 193 組・41 組はほぼ 1 段                                                                                                                                                                                                                                                        | 未達   |
| 転送量・性能 A/B                        | 出荷しないので測っていない（生 5.62 MB は P2.5 の 3.49 MB より多い。解けた run が 2 倍）                                                                                                                                                                                                                                                                                                                                 | 未計測 |

未解決 41 の採用状態の理由（重複あり）: DEM に 0.75 m より深く沈む 25、開けた地表の床の不足 0.5 m 超 6、端の標高の食い違い 12、交差の桁下（法令）12。連鎖の parent_unsolved 20 の根は 989799207 が 7。41009552 は外したランプを戻す段で解けた。

経過（同じスクリプト、未解決 = vertical_unsolved + parent_unsolved）: base（P2.5 のコード）357 run・未解決 406・重なり 156・未収束 13 → 終了判定の修正後 322・441・35・0（「交差のみ」が隣を沈めた）→「交差のみ」を外す 295・468 → 本線を巻き込まない＋仮定の床の行を分ける 405・358・183 → 仮定の床の上限 425・338・70（ノーズを強くしていた）→ r8（ノーズを 5 に戻す）655・108・295 → r9（レビュー後: 緩和を最終段だけに、外すのは失敗した本線につながるランプだけ・パス間の最良・本線が解けた後の再投入）702・61・332。

# 見た目（多視点）

地上から見上げ・横（建物を隠す）・斜め上空・C1 の並走部・芝公園出口のノーズ、加えて浜崎橋 JCT と、残る重なり 3 か所の近景を撮った。修正前（r3）は芝公園出口が外回りの床版の脇へ斜めに潜り込んで見えた（exit-dive）→ ランプの段を下げられるようにして解消。その後の 2 周（round1・round2）で新しい指摘は無かった。床版は節点でも折れず、段差・凸凹・地面への貫通は見えない。残るのは許可した 2 か所の移り変わり（trans-c1・jct-trans で、片方の床版がもう一方へ斜めに降りて交わる）。PLATEAU の建物との貫通は見ていない（P4）。[^shots]

# 性能

デッキの組み立て（`expressway_decks_built`、芝公園の開始地点、同じ撮影条件）: P1 は 39 チャンクで CPU 16.9 ms・最大スライス 2.6 ms。今回は 64 チャンクで CPU 22.7〜26.1 ms・最大スライス 1.6〜2.4 ms（4 ms 予算内）。チャンク 1 個あたりの CPU は 0.43 → 0.35〜0.41 ms で、エルミートの分割で断面が増えた分は、V の変わり目で切ってチャンクが短くなった分と相殺している。フレーム時間の A/B（perf-road-streaming）は測り直していない（P3 で）。

**P3（2026-11-11）**: 区画線・壁の判定・コライダーの配列を足したデッキの組み立ては 62 チャンクで CPU 40〜62 ms（P2.5 の 1.7〜2.4 倍）、最大スライスは 2.6〜11 ms で、**4 ms 予算を超える回がある**（1 チャンクの組み立ての中の区画線の塗りと、body の作成を 1 ステップで測っている。壁の判定は 24 リングごとに譲るようにした）。`just measure-road-streaming` を芝公園（35.6537, 139.7508）で ?expressway の無し・有りを交互に 3 回ずつ（M2 Max、開発サーバー、他のエージェントが並行。.qa/perf/2026-11-10T16-54-52〜17-07-47-streaming）: 最長フレーム（ms、16.7 ms 刻み）は、通常 50.1〜66.7 / 50.1、更新 50.1〜83.3 / 50〜83.3、原点変更 66.6〜66.8 / 50.1〜66.7、ワープ cold 150〜200 / 150〜183.3、ワープ latest 116.7〜150 / 133.3〜150.1（無し / 有り）。1 フレームの刻みで上下し、差は読み取れない（悪化とも改善とも言えない）。

# 実行時（P3: 走れる高速道路、?expressway）

データ（meta.version 2）は変えていない（v6 で meta は索引になり、run の要約と入口はタイルから読む: P2.7-4）。契約は profile.ts に `surfaceSamples`（面を折れ線で切る位置: 測点と、エルミート面から 1 cm 以内になるまでの分割）を足しただけ。床版・コライダー・グラフの区間がすべてこの位置で切れる。[^p3]

- **コライダー**: チャンクごとの fixed body。床版の上面と壁高欄（内面・天端）の trimesh は描画と同じ頂点、橋脚は cuboid。プレイヤーから 400 m 以内で作り 550 m で外す（refresh は 120 m 動くごと、FrameWork のステップで）。原点移動は `reanchorBody`、古い原点で作ったメッシュから後で body を作るときはその原点からの変換を最初に掛ける。近く（60 m）に body の無いチャンクがあれば車を止め（地形と同じ）、ワープの着地は最後の refresh が着地点で終わるまで待つ（12 s で諦める）。
- **T11**: 合成の試験区間（`tests/expresswayDrive.test.ts`）で、中心線 0.5 m ごとのコライダーの高さと `surfaceY` の差 ≤ 1 cm、0.5 m 格子のレイに穴なし、チャンク継ぎ目の段差 ≤ 1 mm、原点を移した body でも同じ点に当たる。実データでは入口・出口ランプの中心線で最大 9 mm（曲率の大きいランプで、隣り合う 2 枚の三角形がねじれる分）。**落とし穴**: レイがちょうど三角形の共有辺（リングの位置）を通ると Rapier の trimesh は外すことがある。テストは辺から 1.3 cm ずらして撃つ。**例外（P3.5、2026-11-11 レビュー W4）**: 本線の縁で切られたランプは、中心が本線の面の上か継ぎ目から `MERGE_RAMP` 1 m 以内にある間、`surfaceY`（ランプ自身の高さ）とコライダー（本線の面、または継ぎ目から自分の面へ上る 1 m）が最大 `MERGE_MAX_DZ` 0.15 m 違う（コンパイラの狙いは ≤ 5 cm）。roads.ts の surfaceY の説明にも書いた。
- **グラフ**: ページ側で各チャンクを 1 本の RoadLine にする（`expresswayRoadInput`）。点はリング、点ごとに楕円体高 `heights` を持ち、Worker がその原点の `frame.toLocal` で `Segment.elev` にする（デッキのリングと同じ式なので T11 が成り立つ）。節点 ID は継ぎ目 `xw:<a>|<b>`、run の端 `xw:<run>:start|end`、内部は一意の ID（二層の C1 で平面の点が重なっても結ばない）。分合流は子の端の ID を親の線の parentS に点として挿入（端の位置は親の中心線と 0 mm で一致することを確かめた）。level 1・structure viaduct・section（中央帯 0）・limit は run の tagV（**規制速度ではなく、run の中で最も高い設計速度に丸めた OSM maxspeed の上限値**。W5、下の逸脱）。チャンクの線は frame に依らないので世代をまたいでも同じ（古い要求の結果は RoadNetworkBuilder が捨てる）。
- **ランプ端**: Worker の `joinExpressway` が、チャンクから 40 m 以内の GSI 高速道路の線を落とし、ランプの地表端から 15 m 以内の GSI の高速道路の地平部（GSI が lvOrder 0 で持つランプの続き）をたどって一般道の頂点まで（250 m 以内）の地上の接続線を作る。無ければ 15 m 以内の一般道へ射影して頂点を挿入。どちらも無ければ `ramp_unattached`。**設計書からの逸脱**: 設計書は「OSM で一般道と共有する節点を射影」だが、データにその節点が無い（地平部の way は run にしていない）。試験区間では 207111988（入口、接続線 31 m）と 4853798（出口、16 m）がつながり、4853799 の地表端は最寄りの GSI 高速道路の線まで 26.6 m で `ramp_unattached`。
- **壁高欄と区画線**（`expresswayMarkings.ts`）: ~~各リングの左右の壁の位置が他の run の床版（高さ差 1.5 m 以内）の上に載るなら壁を作らない。同じ向きの 2 枚（分合流）は両方の壁を消し、逆向き（C1 の並走）は名前順で先の run の壁を 1 本残す（分離壁）。~~ **P3.5 で置き換え**（下の「床版の一体化」）。区画線は外側線（白実線 0.20 m、路肩の内側）、車線境界線（白破線 8／12 m、`laneLeftEdge − k·laneWidth`）、分合流部の太い破線（0.45 m・3／3 m、親の側の外側線を置き換え）、導流帯（子の床版で、車線どうしが離れている帯に外枠と 45° の斜線）。子の車線が親の車線の内側に入る区間は子は何も塗らない。寸法は令の範囲内（テストで検査）、分合流と導流帯の実務値は未確認（assumptions.ts の BRANCH_LINE・ZEBRA）。
- **PLATEAU の建物**: 入口ランプ 207111988 の s 16〜35 m を建物が横切っていた（床版が建物を貫く）。床版の上にいる車（グラフで判定、10 回／秒）は建物の衝突形状を無視する（`Vehicle.setOnDeck`、groups.ts の BUILDINGS）。見た目の貫通は残る（P4）。

## 走行の確認

開発用フック `window.__game.debug.expressway.cruise({ kmh, prefer })` で、グラフの区間の車線中心を純追跡し、先のカーブの半径で横加速度 2.5 m/s² 以下に落として走らせ、`stop()` が `expressway_drive_checked` を書く（dy は車体中心の路面からの高さ − 0.86 m、立ち上がり 1.5 s を除く）。[^drive]

| 走行           | 経路                                                                                |    距離 | max \|dy\| | max \|vy\| |    RMS ay | 落下 |
| -------------- | ----------------------------------------------------------------------------------- | ------: | ---------: | ---------: | --------: | ---- |
| 入口           | 一般道 → 接続線 → 207111988（芝公園入口）→ C1 内回り 24402611:19〜29 → 汐留の地表端 | 1,985 m |    0.076 m |   1.13 m/s | 0.98 m/s² | なし |
| 出口（外回り） | 45021976:12 → 4853798（芝公園出口）→ 地上                                           |   563 m |    0.451 m |   1.53 m/s | 1.57 m/s² | なし |
| 出口（内回り） | 24402611:15 → 4853799 → 地表端 → 地上                                               |   512 m |    0.111 m |   0.98 m/s | 1.10 m/s² | なし |

途中で見つけて直したもの: (1) 床版が川（古川）の上にあると「水に落ちた」判定で車が岸へ戻された（床版の上は対象外にした）。(2) 分流の始まりで、相手の中心がある側の壁だけを消していたので反対側の壁の切れ端が本線の車線に立ち、車が当たった。(3) 入口ランプを横切る建物で車が止まった（上記）。(4) 速度一定 47 km/h で V20 の出口ランプに入ると横転した（フックの側の問題、カーブで落とすようにした）。外回り出口の max dy 0.45 m は地表端の手前でランプが地面に擦り付く所と急カーブでの車体の傾きを含み、跳ねた記録（vy の急変）は無い。

## 多視点レビュー

`scripts/qa/views/expressway.json` に合流（運転席・俯瞰）、外回り出口の分流、内回り出口の分流（俯瞰）、C1 の並走部、入口ランプの地表端を足し、昼・夜の 2 look にした（9 視点 × 2 = 18 コマ）。round 1 で Critical 1（分流の壁の切れ端）・Warning 3、round 2 で修正を確認し新規 0、round 3 も新規 0 で `converged`。分流部の区画線のちらつき（同一面の 2 枚の床版が 5 cm 以内で交互に上に出る）は床版の一体化が要るので wontfix（理由つき）→ P3.5 で解消（下）。夜は高架の上に照明が無く暗い（照明は範囲外）。[^views-p3]

## P3 レビュー（Fable、2026-11-11）の指摘と対応

- **分合流での区間の取り違え（必須）**: 合流・分流の数十 m はランプの床版が本線の床版に重なり、本線の車線 0 の中心の車がランプ（limit 40）に判定されていた（実データ 4 か所で 18〜30 m、左寄りで最大 54〜58 m。60 km/h で 3.5 s は速度違反の閾値 3 s を超え、HUD の制限速度も 60→40→60 と揺れた）。訂正: 車道幅のゲートを通る床版が複数あれば、本線（cls expressway）→ 規制速度の高い方 → 中心線の近い方の順に選ぶ（roads.ts `deckRank`）。合成区間の両車線と、生成済みデータの全区間・全車線の中心を 2 m ごとに総当たりし、自分の区間より低い制限速度の区間に判定される点が 0 であることをテストした（修正前 55 点）。ランプの車が重なりの区間で本線と判定されるのは寛容な側の誤りで、許容した。
- **降車と R の復帰**: 降りた人を床版の上に置く（groundY に車の高さを nearY で渡す）。R の復帰は、床版の上ならテレポートの前に床版の左車線へ戻す。surfaceBelow（groundY の nearY の答え）はライフサイクルのテストで確かめた。降車と R そのものはブラウザで確かめていない。
- **毎フレームの全区間走査**: 駐車の判定が毎フレーム locate を呼んでいた（?expressway が無くても走査が 2 回）。10 Hz の床版判定の結果 `carOnDeck` を使い、違反判定も床版の上のときだけ locate、それ以外は従来の nearest にした。
- **止まったままの車**: refresh の中の 1 チャンクの例外で残りが作られず、そのチャンクの近くで車が止まり続けることがあった。チャンク単位で捕まえて以後は除外（`expressway_chunk_failed` を 1 回）、isReadyNear は 5 s（HOLD_MAX_MS）で手放す（`expressway_hold_expired`）。isSettledAt が meta の読み込み前に「データ無し」と答えていた不具合も直した（ワープが早く着地しえた）。
- **スライス超過**: 区画線の塗りを線ごとのステップにし、リングの探索を二分探索にした（線形探索と全リングの filter で 1 チャンクの塗りが 5〜12 ms の 1 スライスだった）。publish と body の作成の前に、そのスライスで 4 ms を使っていれば譲る。FrameWork が各スライスの長さを持ち、`expressway_decks_built` に中央値・p90・最大と、body 1 個の最長（trimesh の生成は分割できない）を出す。
- **建物の衝突（暫定、P4 まで）**: 床版を離れても車体が建物と交差している間は無視を続け、交差していなければ戻す（`Vehicle.overlapsBuilding`）。床版の上で建物と交差した所を `expressway_building_crossed` に出す（約 20 m ごとに 1 回、P4 の切り抜きリスト）。 2026-11-11 追記: P4 で床版を貫く建物を桁下まで切り下げ（`Buildings.cutAboveDecks`）、この無視（`Vehicle.setOnDeck`・`ON_DECK_GROUPS`）は外した。同じ経路で交差 0（[路面と高架のテクスチャ](road-textures.md)）。
- **レビュー後の再走行（drives-r3、同じ 3 経路）**: 入口 1,995 m（max |dy| 0.076 m・max |vy| 1.12 m/s・RMS ay 1.09 m/s²）、外回り出口 563 m（0.454 m・1.59・1.63）、内回り出口 512 m（0.111 m・0.90・0.97）、落下なし。デッキの組み立ては 23 回の refresh で最大スライス 2.2 ms（別の回は 3.6 ms）、各回の中央値の最大 1.1 ms・p90 の最大 1.2〜2.7 ms、body 1 個（trimesh）の最長 0.3 ms（分割の要る例外は無し）。建物の交差は 3 か所（207111988:0 の 35.65350, 139.75022、24402611:19 の 35.65335, 139.75312、24402611:24 の 35.65585, 139.76008）。合流のたびに合図不履行（signalOmission）が記録される（走行フックが合図を出さないため。合流は進路変更なので合図が要る）。警察の自動運転が AutoDriver.pathAt で例外を出した回があった（経路の点が 1 個、road-model.md に既知、P3 の変更では触っていない）。
- **その他**: 床版判定の検索距離 8 m → 15 m（幅のゲートが決める）、壁高欄の外面もコライダーに、地上の接続線をスポーン候補から外した、RIDE_HEIGHT を vehicle.ts から読む、区画線の幅を 0.20・0.15 の数値でテスト、T11 に解析値 z(s) との比較、衝突グループの組み合わせのテスト。

**逸脱と残課題として記録（P6 の前に）**:

- **W5 limit は規制速度ではない**: チャンクの区間の limit は run の tagV（run の中で最も高い、設計速度の表に丸めた OSM maxspeed）で、P3 では「上限値」として扱う。区間ごとの規制速度は、コンパイラがチャンクごとに maxspeed の生の値を出すデータ形式（XW_VERSION 3）で直す。
- **W6 ランプ接続が読み込みの中心に依存**: 道路網の読み込み範囲（GSI の 3×3 タイル）の端にあるランプ端はつながらない（レビューの掃引で 51 回中 12 回 rampEndsJoined 0）。対応: 読み込んだ一般道の範囲（外接矩形から 60 m 内側）の外の端は接続も報告もしない（次の範囲でつながる）。範囲の中でつながらないものだけを `ramp_unattached` とする。
- ~~**W7 DeckIndex は chunk.decks を使っていない**~~（P3.5 で解消: 相手と関係は decks だけから引く）: 壁と区画線のための重なりを実行時に再計算している（format.ts の契約「P3 は重なりを再計算しない」からの逸脱）。decks は区間と関係（same / above / below）だけで、壁の位置ごとの判定（相手の床版に載るか）には足りないため。P3.5 の床版の一体化でデータ側に寄せる。

# 床版の一体化（P3.5、2026-11-11）

P3 レビュー（Fable）の判断「decks の same 区間で子の床版を親の床版の縁で切り、面を 1 枚にする。W7 もここで解消する」を実装した。データ形式（meta.version 2）とコンパイラは変えていない（契約を足す必要が無かった。下の逸脱）。[^p35]

- **組の決め方（W7 の解消）**: `DeckIndex.partnersAt` はチャンクと同じ run の隣のチャンクの `decks` から relation `same` の相手だけを返す（隣を読むのは、コンパイラが区間をチャンクの端で切るため）。区間の端から `MERGE_PAD_M` 20 m までは延ばす（車線域が離れても床版はまだ重なる）が、同じ相手と above / below の区間の中には延ばさない。P3 の `NEIGHBOUR_DZ` 1.5 m による全デッキの総当たりはやめた。位置は相手のリング（デッキのメッシュと同じ頂点、`chunkRings`）から取る。
- **高さの番人**: リングで相手との差が `MERGE_MAX_DZ` 0.15 m を超えるところは一体にしない（コンパイラの同一面は軟らかい拘束で、許可リストは浜崎橋 JCT で 0.14 m、C1 の移り変わりで数 m を許す）。~~生成済みデータでは 4853798 の s 198 m 付近でランプが本線から 0.15 m 下がり、そこで一体化が切れて壁高欄が戻る。~~ **訂正（レビュー W1）**: 切れ目は 3 か所（下の「P3.5 レビューの指摘と対応」）で、初版は継ぎ目を本線の面に合わせたまま切れたので、切れ目に進行方向を向いた最大 0.15 m の段差が立ち、4853798 では戻った本線の壁の端がランプの路肩の中に立っていた。
- **同じ向き（分合流）**: 相手の端に終わる側（`roleOf` の child、どちらでもなければ本線→id の順で下の方）を、相手（master）の床版の縁で切る。路面の端（`seam`）は master の縁の頂点の折れ線の上の点で、高さもその折れ線（= master の面）の値。端から `MERGE_RAMP` 1 m で自分の面の高さへ戻る。master の縁の頂点ごとに子のリングを足し（相手とリングの間隔が違うので、そのままでは継ぎ目に曲線で最大約 6 cm の隙間・重なりができる）、路面の幅が 0 になる位置と壁高欄の始終点にもリングを足す（二分法、区間の 1/4096）。足したリングは元のリングの間の弦の上なので、面とグラフの surfaceY は変わらない。master は子の床版が自分の縁の外へ出る所で壁高欄を外し、路面を床版の縁まで延ばす。子の路面が全部 master の下に入るリングは角を 3 cm 下に寄せる（`MERGE_TUCK`）。
- **逆向き（C1 の並走）**: 床版の重なりが壁 1 枚分（0.5 m）以上のところで、重なりの中央で切り、名前順で先の run がそこに分離壁を 1 本立てる。もう一方は壁の中心まで路面を延ばす（`water.ts` の otherDeckAt と同じ「片方だけが持つ」）。重なりが 0.5 m 未満なら両方の壁を元の位置に残す（中央へ動かすと 0.25 m 跳ぶ）。
- **区画線**: 線は自分の路面の上にある間だけ塗る（切られた子の線は master の縁で止まる。master の線が面の上の線）。導流帯は子が自分の車線端から master の車線端まで、継ぎ目を越えて master の面の上に塗る。親の外側線は子の車線が接する範囲で分合流部の太い破線になる（P3 と同じ）。
- **ちらつき**: 重なる部分は master の面 1 枚になったので、2 枚が 5 cm 以内で交互に出ることは無い。

## 継ぎ目の測定（trust signal）

- 合成の分流（`tests/expresswayDrive.test.ts`、半径 400 m の本線・縦断 R 3000 m・測点 12 m、0.12 の割合で離れる 1 車線のランプ・測点 10 m・本線より 3 cm 高い）: 継ぎ目の両側 5 mm の段差 ≤ 1 mm、子の継ぎ目の高さは master の `surfaceHeight`（エルミート）から ≤ 1 cm、子のコライダーは master の車線域の上に面を持たない、0.5 m 格子の穴なし、T11（本線の中心、子は中心が継ぎ目から 1 m 以上離れた所）≤ 1 cm。
- ~~生成済みデータ全 81 チャンクを一体化して 1 つの world に置き、継ぎ目のあるリング（壁の始終点の 2 リングを除く）の両側 5 mm を総当たり: 段差 > 1 mm は 0 か所（テスト）。継ぎ目のある側は 187、継ぎ目での自分の面との差は最大 0.150 m（番人の上限）。~~ **訂正（レビュー W2）**: この検査は実装の sides から探る位置を取り、壁の始終点（= 番人の切れ目）を除き、穴（null）と 0.2 m 以上の差を黙って飛ばし、件数を固定していなかった（自己除外）。今の検査は下の「P3.5 レビューの指摘と対応」。
- 逆向きの合成（中心間隔 8 m）: 横断でちょうど 1 本、中央（4.0 m）に幅 0.5 m の壁。
- 一体化しない対照: decks に載っていない並走の床版は両方の壁を残す、0.2 m 離した組は一体にしない（テスト）。

## 走行（P3 と同じ 3 経路・同じ drives-all.mjs）

| 走行           |    距離 | max \|dy\|（P3 r3） | max \|vy\|（P3 r3） | RMS ay（P3 r3）  | 落下 |
| -------------- | ------: | ------------------: | ------------------: | ---------------- | ---- |
| 入口           | 1,977 m |     0.082 m (0.076) |     1.11 m/s (1.12) | 1.07 m/s² (1.09) | なし |
| 出口（外回り） |   563 m |     0.110 m (0.454) |     1.51 m/s (1.59) | 1.05 m/s² (1.63) | なし |
| 出口（内回り） |   512 m |     0.113 m (0.111) |     0.99 m/s (0.90) | 1.05 m/s² (0.97) | なし |

外回り出口の max |dy| が 0.45 → 0.11 m に下がった。dy は車体中心の高さ − 走っている区間の surfaceY − 0.86 m で、子の中心が master の下にある間は master の面（≤ 0.15 m 違う）に乗るので、残る 0.08〜0.11 m はこの差と車体の傾きを含む。[^drive35]

## 多視点レビュー

外回りの分流の俯瞰（`diverge-outer-overhead`）を足して 10 視点 × 昼・夜。round 1・2 とも Critical / Warning の新規 0 で `converged`（Info 1: 70 m の俯瞰では導流帯の斜線が梯子状に見える、wontfix）。分流・合流の俯瞰と運転席で床版は 1 枚につながり、継ぎ目の隙間・二重の壁・ちらつきは見えない。C1 の並走部は中央に壁 1 本。[^views-p35]

## 性能

芝公園の開始地点で 62 チャンクの最初の組み立て: CPU 49.2 ms・最大スライス 3.4 ms・p50 0.6・p90 1.6 ms・body 最長 0.3 ms（4 ms 予算内。P3 は CPU 40〜62 ms・最大 2.2〜3.6 ms）。走行中の 24 回の refresh は最大スライス 0.1〜2.4 ms。Node で全 81 チャンクを一体化つきで組むと、生成器の 1 ステップは p50 0.04 ms・p90 0.30 ms・最大 4.8 ms（最初のチャンク、JIT 前）。

## 逸脱と残課題

- **データ形式・コンパイラは変えていない**: 設計の段階では「decks に親の縁の位置などを足す」案があったが、相手のリングから縁を取れば継ぎ目は頂点単位で一致し、契約を足す理由が無かった。XW_VERSION 2 のまま（P6 / W5 の版 3 と衝突しない）。
- **高さの番人は高さの比較**: W7 の「幾何で再計算」をやめた上で、組は decks、ただしリングごとに 0.15 m を超える差は一体にしない。~~番人の境では一体化が急に切れ、子の壁高欄が戻る（4853798 の s 198 m）。~~（レビュー W1 で連続にした。下）根本はコンパイラが車線域の重なりだけを同一面に拘束していること。**追跡先: P2.6 / P2.7**（床版が重なる間は同一面に拘束する）。入れば `MERGE_PAD_M` を 0 にし、番人に掛かる箇所の一覧（tests/expresswayData.test.ts）が減る。
- **子の中心が master の下にある間の surfaceY**: グラフは子の高さのまま（≤ 0.15 m、通常 ≤ 5 cm）。コライダーは master の面。
- **片勾配（?expressway=bank）**: master の縁の高さは片勾配込みで取るが、合成テストは片勾配なしだけ。
- 子の路面の中心付近の継ぎ目では、レイが路面の 2 面の共有辺に沿うと Rapier が外すことがある（P3 と同じ落とし穴。中心の角は継ぎ目のあるリングだけに置く）。

## P3.5 レビュー（Fable、2026-11-11、Conditional LGTM）の指摘と対応

- **W1 番人の切れ目の段差**: 継ぎ目の高さを `seamY = ownY + (masterY − ownY)·w`、w は |Δz| が `MERGE_FULL_DZ` 0.05 m → `MERGE_MAX_DZ` 0.15 m で 1 → 0（`seamWeight`）にした。w が 1 を外れる位置にリングを 1 本足す（二分法）ので、0.05 m 以内の区間の継ぎ目は今も master の面に一致する。番人で離れた後、master の壁高欄は相手の車道（床版から両端の壁高欄の幅を除いた範囲）に掛からない所でだけ戻り、掛かる間は路面を床版の縁まで延ばす（`letGo`）。切れ目の進行方向の段差（車道の上、master の縁から 0.3 m、4 cm の間の高さの変化から勾配の分を引いた値）:

| 切れ目              | 相手     |     s | 前（初版） | 後（実測） |
| ------------------- | -------- | ----: | ---------- | ---------- |
| 207111988:2（入口） | 24402611 | 157.5 | 約 0.15 m  | 0.03 mm    |
| 4853798:0（外回り） | 45021976 | 198.5 | 約 0.15 m  | 0.27 mm    |
| 4853799:0（内回り） | 24402611 |  82.3 | 約 0.15 m  | 0.04 mm    |

前の値は、番人の境では |Δz| = 0.15 m のまま継ぎ目が master の面にあったこと（初版の設計）から出した値で、レビューの analyze.mts が 3 か所とも同じ（最大 0.15 m）と報告した。初版のコードで同じ測り方をした値ではない。

- **W2 自己除外の検査**: 探る位置は実装に依らず、チャンクの測点とエルミート面だけから取る（`tests/expresswayPairs.ts`。ゲームの LocalFrame で平面に写す: 等距円筒の平面は 0.3 % ずれ、床版の縁 4.75 m で 1.4 cm になり、継ぎ目の ±2 mm の位置が決まらなかった）。ランプの "same" 区間で、車道が master の縁の外へ出て番人以内の 0.5 m ごとの 1,066 点を固定件数にし、穴（null）は失敗、|Δz| ≤ 0.05 m では段差 ≤ 1 mm（同じ world・同じ原点の値。I5）、0.05〜0.15 m では ≤ 0.151 m、内側は master のエルミート面から ≤ 1 cm（実測最大 8.8 mm）。切れ目の一覧（上の 3 か所）と進行方向の段差 ≤ 1 mm は別の expect で固定した。
- **W3 番人に掛かる箇所**: 延長しない same 区間で |Δz| > MERGE_MAX_DZ の 12 組（C1 の移り変わり 7、浜崎橋 JCT 3、出口ランプの終わり 2）を理由つきで tests/expresswayData.test.ts に固定した。実行時はチャンクと相手ごとに 1 行の `expressway_merge_skipped`（理由 level_apart・s の範囲・最大 |Δz|）を出す（logEvents.ts）。`MERGE_MAX_DZ` は許可リストの `SAME_SURFACE_ALLOWED_DZ_M`（0.14 m、浜崎橋 JCT）+ 1 cm として allowlist.ts から導く。
- **W4 T11 の例外**: 上の T11 と roads.ts の surfaceY に書いた。W1 の連続化で番人の近く（0.05〜0.15 m）は継ぎ目がランプ自身の高さへ寄るので差は縮むが、master の面の上の中心では今も最大 0.15 m。
- **W5 3 枚の重なりの順番依存**: 同じ向きの相手を先に、逆向きを後に処理し、同じ向きの master の継ぎ目がある側は逆向きの分離壁で上書きしない。master 自身が切られている（分離壁がその側にある、または自分の master で切られている）ときは、名目の縁ではなく master の路面の端（その壁の下）で切る（`masterShortfall`）。合成の 3 枚（本線 M・左へ離れるランプ C・M の左 8 m を逆向きに走る B）で、decks の順を逆にしても結果が同じこと、C の継ぎ目が M の中心から 4.0 m（M と B の重なりの中央）に来ることをテストした。
- **I1 片勾配**: 高さの比較を、相手の面を自分の中心の位置で評価する形にした（相手の中心 + 相手の片勾配 × 自分の中心の横位置）。片勾配 4 % の合成の分流で、番人に掛からず継ぎ目の段差 ≤ 1 mm をテストした。
- **I2 タイルの読み込み失敗**: 周りの 3×3 に失敗したタイルがあれば、そのチャンクは今回組まずに次の refresh へ回す。
- **I3 スライス**: `refineRings` を生成器にし、6 区間ごとに譲る。リングごとの sides は 8 リングごと（master の確認で 1 リングの費用が 2 倍になるため）。
- **再走行（drives-p35d、同じ 3 経路）**: 入口 1,996 m（max |dy| 0.082 m・max |vy| 1.15 m/s・RMS ay 1.04 m/s²）、外回り出口 563 m（0.110・1.47・1.11）、内回り出口 512 m（0.114・0.93・1.04）、落下なし。デッキの組み立ては最初の 62 チャンクで CPU 59.5 ms・最大スライス 4.2 ms（p50 0.6・p90 2.1 ms）で、**4 ms を 0.2 ms 超えた**（初版は 3.4 ms）。Node で温まった後の生成器の 1 ステップは最大 0.6 ms なので、超過はページを開いた直後の最初の組み立て（JIT 前・初回の転送）に出る。走行中の 22 回の refresh は最大 1.8 ms。
- **I6 出典**: 走行の記録を .qa/drives/p35/ に写し、P3 の多視点の周がどの worktree のものかを書いた。

# 構造物上書き（P7、2026-11-11）

レインボーブリッジのモデルは構造物だけ（[レインボーブリッジ](rainbow-bridge-blender.md)）で、上層・下層の床版はこのシステムが landmarks.json の `deckLevels` から作る（設計書 4.6）。仕組みは汎用の `structureOverrides`（`src/expressway/structures.ts`、`STRUCTURE_SPECS` に landmark と下層の一般道の way を書く）。[^p7]

| 項目         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依存         | landmarks.json → `scripts/expressway.ts`（`deckLevelsOf` で zod 検証）。無い・壊れていれば `expressway_structure_missing` を出して通常の高架として生成する。`--no-structures` で比較用に外せる                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 平面         | 帯の osmWays を含むチェーンの標本を、補剛桁の範囲（`girderRange` ±396.5 m）で「軸 + 帯の中心」（壁高欄の内面間の中心: 上層 ±7.15 m、下層 ±8.15 m）へ等式で固定（`horizontal.ts` の `pin`、アンカーと同じ重み）。桁端から 80 m（`TAPER_M`）で OSM の線へ smoothstep で戻す。固定した標本の OSM からのずれは ε（1.5 m）の検査から外し、`pinnedShiftM` に分けて持つ                                                                                                                                                                                                                                                                        |
| 軸の座標     | WGS84 の曲率半径の接平面（`tangentPlaneAt`）。ゲームがモデルを置く局所座標と同じ真のメートル。チェーンの平面（geo.ts の球）との 0.2 % の差は、桁の上の距離の写像 a = slope·s + base の傾きで吸収する                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 縦断         | `sRange`（±463 m、アンカレイジまで）を `ProfilePin` に。桁の上は a(s) が s の一次式なので式は s の放物線になり、節点の標高と勾配を QP の**硬い等式**にする（台形則が放物線で厳密なので弧の行と矛盾しない）。アンカレイジの上（上層は芝浦側で曲がる）は 5 m ごとの重い二乗（W_PIN 1e5）で式に寄せる。全節点に標高を硬く置かない理由: 曲がった所では式が s の放物線でなく、等式が矛盾して解が無くなる                                                                                                                                                                                                                                     |
| 断面         | 桁の上のチャンクは帯から（`deckSection`）: 上層 3.5 m × 2、左路肩 4.8（路肩 2.5 + 余裕幅 2.3）、右 1.5（路肩 1.0 + 中央分離帯の半分 − 壁高欄 0.5、壁は分離帯の中心で背中合わせ）。下層 3.25 m × 2、路肩 0.5 / 0.5、壁は柵の帯の内面から。テーパーは 8 段のチャンクで取付けの断面へ（4 段では壁高欄が段に見えた、多視点 round 1）。道路の断面と帯が同じ所（下層: 第四種と帯が一致）はチャンクを切らない                                                                                                                                                                                                                                  |
| 橋脚・桁     | `pierFreeRange` で橋脚を置かない。`sRange` のチャンクは `girder: 0`（床版だけ、桁はトラス・アンカレイジ）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 走れない帯   | チャンクの `over.apronL/R`: 壁高欄の外の床版（下層の軌道の半分 3.9 m、遊歩道 1.4 m）。描画だけで、コライダーに入れない（`expresswayDeck.ts apronTriangles`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 下層の一般道 | 臨港道路を `STRUCTURE_SPECS.streets` で指名（forward 45177681→4848879→316305911→4848754→333682057→23681347、backward 45177678→4848887→316305913→4848895、芝浦のループから台場の地上まで）。`normalizeStreetWay` で cls `street`（第四種第1級: 3.25 m、路肩 0.5、片勾配 6 % まで、V は maxspeed、無ければ 40）。台場出口（4848889）は OSM のとおり臨港道路の台場側の取付けに合流し、その run は junction で `street` の親につながる。実行時は kind `local`・level 1・viaduct の線で、地表端は最寄りの GSI 一般道へ（at-grade の GSI 高速道路の線はたどらない）。歩行者・路端設備・JARTIC の規制は無し（`takesJarticRules` を地上だけに） |
| 検査         | 3 m 規則（桁の上の OSM の線と「軸 + 帯の中心」）を `planNetwork` で、超えれば `StructureMismatchError` でビルドが止まる。生成後に桁の上の中心線と帯の線の差・sRange の z と式の差を `structureCheck` で測り、許容（3 m / 1.5 m）を超えれば止める。結果は `meta.runs[].structure` と `expressway_structure_built`                                                                                                                                                                                                                                                                                                                        |
| データ形式   | `XW_VERSION` 4（`street` のチャンクと run、チャンクの `over`、meta の `ranges`・`structures`）。3 は P6（チャンクごとの maxspeed）が使うので飛ばした。両方を合わせたら 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 結果（trust signal）

`just make-expressway-data`（既定 `hamazakibashi,rainbow`）: run 15・チャンク 245・測点 4,228・**358,553 B**（試験区間だけの 127,343 B の 2.8 倍、目安 1 MB の内）。成分 1 つ（56 run）が収束、未解決 0。生成 約 110 秒。

| 床                        | run      | OSM のずれ（3 m 規則） | 桁の上の中心線のずれ | z と式の差（sRange） |
| ------------------------- | -------- | ---------------------: | -------------------: | -------------------: |
| 上層 forward（芝浦→台場） | 4848762  |                1.169 m |                 6 mm |               2.8 mm |
| 上層 backward             | 45019020 |                1.117 m |                 6 mm |               3.3 mm |
| 下層 forward              | 45177681 |                1.456 m |                 6 mm |               0.7 mm |
| 下層 backward             | 45177678 |                2.254 m |                 6 mm |               0.5 mm |

中心線の 6 mm は経緯度の丸め（1e-7°）。z は丸め（1 mm）とエルミート補間を含む。deckLevels の各測点の s で各床版を切った高さは式と 1 cm 以内（`tests/expresswayStructures.test.ts`、上層の芝浦側のアンカレイジの上で最大）。T1〜T7 は違反 0。T10 は `deck_overlap` が 11 組（新しく許可したのは 7 組: 芝浦 JCT の 11 号・1 号の二層の移り変わり 4 組は `--no-structures` でも同じ組で出る、ノーズ 3 組）。**訂正（レビュー）**: 当初「8 組」と書いたが、許可リストに足した 4848762 × 4848889 はどの診断にも当たっていなかった（削除し、許可リストの全エントリが当たることをテストした）。

**途中で見つけて直したこと**: (1) 11 号台場線の上りの run（45019020）が最初の way（台場入口のリンク）でランプと分類され、橋の上を含む 4.3 km が V20 まで下げられていた（P1 からの不具合、`--no-structures` でも同じ）→ run の分類を長さの多数決に（`majorityClass`、単体テストあり）。**訂正（レビュー）**: 当初「試験区間では 813455519 が expressway になる」と書いたが誤り。813455519 は HEAD（P3.5）でも expressway で、この変更で分類が変わった試験区間の run は無い。(2) 3 m 規則を sRange 全体で測ると芝浦側のアンカレイジで上層が 18 m 外れる（OSM の線が桁端で曲がる）→ 規則と平面の固定は補剛桁の範囲に（rainbowBridge.test.ts の規則と同じ）。(3) 球の平面で軸を測ると端で 1 m、高さで 1.5 cm ずれた → 真のメートルの接平面と傾きの写像に。(4) アンカレイジの上で節点の標高だけを硬く置くと勾配が節点ごとに振れて 1 cm を超えた → 重い二乗に。

## 走行（一定速の走行フック、ゲーム時間 advance）

`.cache/p7/drive.mjs`（記録は `.qa/drives/p7/drives-r3.json`、ローカル・git 管理外）: ヘッドレス Chrome、vite 5347 番、`?expressway&start=35.6391198,139.7560316`、`place` で取付けの手前に置き `cruise({ kmh, prefer: [run] })`。走行フックに、目標速度に達した後の速度の落ち込み（`maxShortfallKmh`、壁高欄に当たれば大きく落ちる）、車線中心からのずれ（`maxLaneOffM`）、それぞれの最大が出たチャンク（`maxDyAt` など）を足した。現データ（8 段テーパー、下層はテーパーで切らない）で走り直した（drives-r3）。[^p7drive]

| 走行                 | 区間             |    距離 | max \|dy\|（位置）          | max \|vy\| |    RMS ay | 落ち込み（位置） | 車線のずれ（位置） | 落下 |
| -------------------- | ---------------- | ------: | --------------------------- | ---------: | --------: | ---------------- | ------------------ | ---- |
| 上層 芝浦→台場（60） | 4848762:8 → :34  | 1,145 m | 0.074 m（:33 台場の取付け） |   1.17 m/s | 0.94 m/s² | 7.3 km/h（:14）  | 0.76 m（:17）      | なし |
| 上層 台場→芝浦（60） | 45019020:8 → :34 | 1,380 m | 0.073 m（:32）              |   1.17 m/s | 1.44 m/s² | 5.8 km/h（:8）   | 0.71 m（:28）      | なし |
| 下層 芝浦→台場（40） | 45177681:4 → :10 | 1,198 m | 0.076 m（:4 芝浦のループ）  |   1.33 m/s | 1.17 m/s² | 4.0 km/h（:4）   | 0.05 m             | なし |
| 下層 台場→芝浦（40） | 45177678:3 → :9  | 1,221 m | 0.076 m（:3 台場の取付け）  |   1.52 m/s | 1.34 m/s² | 4.0 km/h（:3）   | 0.04 m             | なし |

壁高欄への衝突（落ち込み）は無い。上層の車線のずれの最大は、どちらも芝浦のアンカレイジの上のテーパーの段（4848762:17 は s −418〜−407 m、45019020:28 は −438〜−448 m）で、断面が段ごとに変わり車線中心が跳ぶ所を純追跡が追う分（テーパー起因）。落ち込みの最大はアンカレイジの上のカーブで目標速度に追いつく所。主塔・トラスの部材は車線に入らない（数値は [レインボーブリッジ](rainbow-bridge-blender.md)、テスト `the decks inside the bridge model`）。最初の走行（drives-r1）は到着判定を 1 秒ごとの最後の区間で見ていたため上層の台場→芝浦が到着を見逃し、1 号羽田線へ入って建物の前で止まった（橋とは無関係、判定を「通った区間」に直した）。下層は地表からではなく芝浦・台場の取付けの途中から走らせた。

## 多視点レビュー

`scripts/qa/views/expressway.json` にセッション `rainbow`（芝浦のなぎさ通りから開始）を足した: 上層の運転席（芝浦→台場、主塔の脚の間）・下層の運転席・芝浦側の地上から・台場の浜から・真横の水面上・トラス越しに下層・芝浦のアンカレイジの上、それぞれ昼・夜（試験区間の 10 視点と合わせて 34 コマ）。[^views-p7]

| 周  | 指摘                                                                                                                                                                                               | 対応                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Warning: 台場の浜の視点が建物の中 / Warning: 芝浦側のテーパー（4 段）で壁高欄が 0.3〜0.6 m ずつ段 / Warning: 芝浦のアンカレイジで上層の床版がケーブル室を貫く / Info: 真横では床版がトラスに隠れる | 視点を浜の水際へ / テーパーを 8 段に / ケーブル室は wontfix（OSM の線とモデルの食い違い、ランドマーク側へ申し送り）/ 真横は縦断の形を見る視点として残す |
| 2   | 新規なし（上層の運転席で主塔の脚とハンガーが壁高欄の外に立つ、下層の運転席でトラスの斜材が壁の外・上層の床版が頭上、トラス越しに床版の縁が主構の内側）                                             | —                                                                                                                                                       |
| 3   | 新規なし                                                                                                                                                                                           | `just check-convergence expressway` が `converged`                                                                                                      |

床版とトラスの合い（浮き・めり込み）は rb-truss-close と rb-lower-driver で見て、床桁の上に床版が載り隙間は見えなかった。夜は橋の照明（モデル）だけで床版は暗い（道路照明は範囲外）。

## 逸脱と残課題

- **芝浦のアンカレイジの上で上層がケーブル室を通る**: OSM の上層は桁端の先で北へ曲がり、s = −463 m で上りが軸から 22 m。床版（T.P.+56.7〜57.5 m）がケーブル室（offset 15.5〜22.7 m、上面 58 m）に入る。モデルか OSM のどちらかが実物と違う（ランドマーク側への申し送り、[レインボーブリッジ](rainbow-bridge-blender.md)）。
- deckLevels の測点の経緯度は平面近似で真の軸から端で 1〜1.9 m ずれる。道路は軸に従う（同上）。
- 取付けのテーパーは断面を 8 段で変えるので壁高欄が段になる。**訂正（レビュー）**: 当初「0.15〜0.3 m ずつ」と書いたが、実データの最大は **0.447 m**（45019020:14→15・4848762 の同じ位置。smoothstep の中ほどの段）。v5 でチャンクの両端に断面を持たせて連続にする（下の起票）。
- 下層の遊歩道の外側の柵（モデルにも無い）と、軌道の床版の上のゆりかもめは描かない。ゆりかもめの高架（軌道の取付け）は道路側の範囲外。
- 下層の 400830346（333682057 からのもう一つの枝、台場の地上へ）は指名していない（GSI に任せる）。
- **訂正（レビュー C1）**: 当初、P3.5 の継ぎ目の検査（`tests/expresswaySeams.ts`）と同一面の外れの列挙を試験区間の run に絞っていた。世界と DeckIndex をその run だけで作ったため、1 号羽田線（45554540・45021972）が初めてファイルに入って試験区間の run の親・隣になったことによる不合格が隠れていた（全チャンクで継ぎ目 1,066→3,422、手放し 3→6、813455519:0 の s 4.6〜6.6 m に穴 5 点）。今は世界と DeckIndex を常に全チャンクで作り（浮動小数のため最寄りの 3 フレームで撃つ）、穴 0 を全域で求め、絞るのは理由つきの例外リストだけ。
- **穴の原因と修正**: 45554540 は浜崎橋で 4 車線（hw 7.5 m）から 2 車線（4.25 m）に変わり、その継ぎ目で縁の折れ線が広い縁から狭い縁へ 1 区間かけて斜めにつながっていた。813455519 はその斜めの縁で切られ、狭い縁との間の細い帯が誰にも覆われなかった。断面の変わる継ぎ目ではリングを両方の縁で 2 回持ち、縁が直角に段になるようにした（`expresswayMerge.ts linesNear`）。マスター自身が閉じている所では切らない（`isMasterClosed`）も足した。
- **例外として列挙したもの**（`tests/expresswayDrive.test.ts SEAM_EXCEPTIONS`、全 3,423 点のうち）: 45019020:40（芝浦 JCT、|Δz| 3.7〜4.8 cm の継ぎ目で 2.4・3.1 mm の段）、4848889:0（台場出口のノーズ、1.2〜4.1 mm）、813455519:0（継ぎ目の内側の面が中心の高さから最大 5.5 cm、原因未特定）、45019020:39（手放しの点の上の 1 点で 0.148 m）。同一面の外れ（MERGE_MAX_DZ 超）は全域で 32 か所を理由つきで列挙（`tests/expresswayData.test.ts`、新しい 20 か所は芝浦・台場の二層の移り変わりとノーズ）。
- 台場出口（4848889）は V30、台場入口（4848755）は V20 まで下がる（ノーズでの同一面の外れでランプの段を進める既存の規則）。

## P7 レビュー（Fable、2026-11-11、Changes Requested）の対応

- **C1**（上記「訂正」）: 全チャンクでの継ぎ目検査、浜崎橋の穴の修正、例外の列挙。
- **W2**: `outranks` を 3 クラスの全順序（expressway → street → ramp → id）にした。以前は street と ramp がお互いを親と見た（45177678 × 4848755）。反対称のテストを足した。
- **W5**: 未使用だった許可リストのエントリを削除し、ファイルにある run の全エントリが当たるテストを足した。`horizontal.ts` の pin の未使用の引数（vertex・pieceOf）を消した（位置で決める）。
- **W8（決定）**: 高架上の street（下層の臨港道路）は P6 で開けるまで navigation・autopilot・traffic に閉じた（`roadClass.ts DECK_STREET_OPEN`。プレイヤーの走行・cruise・spawn・map は可）。理由: 台場出口（ランプ）と床版の上でつながり、経路がまだ開けていない床版へ入ってしまう。
- **W7（自己参照のテスト）**: 恒真式だった床桁のテストを、`expresswayDeck.ts SLAB` と spec の `FLOOR_BEAM_GAP`（rainbow_bridge.py が使う同じ定数に切り出した）を読む形に。isFinite だけだった 2 か所を、エルミート面の測点間と式の差・橋脚の位置の検査に。apron がコライダーに入らないこと、`--range` の解釈（`ranges.ts parseRanges`）、`toAxis` と LocalFrame の一致（463 m で 2 cm 以内）、`majorityClass` の単体テストを足した。
- **S2（一部）**: `structureCheck` の許容を 5 cm（設計書 4.6）に、網にある deck を運ぶ run が無ければビルドを止める検査を足した。

## 起票（v5 の合流まで、knowledge の残課題）

- **W1** `majorityClass` は応急処置。全域では分類の変わる run が 9 本あり、僅差の例もある。地表端の接続は、端の way のクラスで XwEnd に持たせるべき。
- **W3** テーパーは v5 でチャンクの両端に断面を持たせて連続にする（今は最大 0.447 m の段）。
- **W4** `deckLevels.ts` に「帯の平面は girderRange だけ有効」の規約を書く。芝浦のアンカレイジでの貫通を、現状値で固定するテストか許可リストにする。
- **W6** 既定の範囲が 1 号羽田線 8.1 km × 2 を丸ごと出している（11 号と同じ成分で、run 単位で出すため）。
- **S1** P6 との合流時は手でマージせずデータを再生成する。run の `structure` を改名する（`deck` などへ）。
- **S3** `TAPER_*` を assumptions.ts へ移す。justfile と `DEFAULT_RANGES` の既定の二重を解消する。`isOnStructure` の docstring と `assertOsmMatches` の文言を直す。

# P2.6 と main（P3・P3.5・P7）の統合（2026-11-11）

P2.6（#52）は P3・P3.5・P7 より前に分かれたので、main を取り込んで（rebase ではなく merge）縦断の解き方を一つにした。データは手でマージせず、統合したコンパイラで `just make-expressway-data`（`hamazakibashi,rainbow`）を 2 回生成してバイト一致を確かめた。[^code]

- **構造物の固定（ProfilePin）と P2.6 の行の組み立て**: P7 は端の行を `solveJoint` のループの中で足していたが、P2.6 は端の行（帯つき）を `addArcRows` へ移している。統合では端の行を二重にせず、構造物の固定（節点の標高・勾配の等式と、`exact` の外の 5 m ごとの W_PIN の二乗）も `addArcRows` に置いた（`merge(zRow(...))` で同じ変数の項をまとめる）。前の解に固定した run（`pinned`、外したランプを戻す段）は、その解がすでに構造物を満たしているので固定の行を足さない。
- **3 次の連結路は構造物を持てない**: 連結路は自分の変数を持たない（親 2 本の端からの 3 次エルミート）ので、構造物の上の run（`rp.over`）は `connectorsOf` で連結路にしない。`solveJoint` は pins のある連結路を受け取ったら例外にする。
- **仕上げ（`arcProfile`）**: P7 の `reconstruct`（固定した節点の間ごとに誤差を自由な勾配へ配る）を P2.6 の `arcProfile`（端の帯、自由な端の勾配に ½ の重み、配るのは 0.1 m まで）に合わせて書き直した。固定した節点が無い run は P2.6 と同じ計算になる。固定から外れた量は `RunProblem` の `what: "structure"`（basis `coupling`）として判定する。
- **道路に降りるランプ（`isOnStreet`）**: P7 は「street の run に分合流する端」を地表端と同じに扱って床を外していた。P2.6 の `isLowEnd`（低い親からの分岐）に同じ規則を入れ、T4 の `climbingEnds` も同じ規則で計算する。
- **形式**: P2.6 の任意フィールド（チャンクの `vform`、meta の `closed`）は読む側が要らないので `XW_VERSION` は 4 のまま。`XwClosed.cls` は street も取りうる。データテストは `meta.range` から `meta.ranges` に合わせた。

結果（trust signal、2026-11-11）: run 15・チャンク 247・測点 4,237・タイル 9 枚 359,968 B、未解決 0・閉鎖 0、最終解は全部収束。レインボーブリッジの 4 枚の床版はビルドの検査を通った（`expressway_structure_built` の zM 0.5〜3.3 mm、planM 6 mm）。T10 は crossing_over_or_at_grade 34・deck_below_ground 1・deck_overlap 13・ramp_radius 1・vertical_fallback 37（P2.6 の 32/1/4/1/35 と P7 の 34/0/11/1/31 を合わせたものに近い）。P2.6 の解き方で連結した成分が数 cm 動いたので、重なりの許可を 3 件変えた: 45021972×4848762 を 15 測点・6.33 m → 16 測点・6.46 m に広げ、芝浦の入口ランプ 4848755 のノーズ（45019020 と 45177678、どちらも 2 測点・≤ 0.06 m）を NOSE_REASON の類型として足した。床版の一体化を外れる所（MERGE_MAX_DZ 超）は 5 件増え（どれもノーズで 0.33 m 以下）、芝浦の 4 件の上限を 0.06〜0.08 m、C1 の 45021976:10 とノーズの 45019020:38 を 0.01 m 広げた。継ぎ目の数は 3,423 → 3,409、手放す所は 6 か所のまま（4848755 と 4848889 の位置が数 m 動いた）。

# 標識（G6 = P5、2026-11-11）

設置点と内容はコンパイラの後段 `src/expressway/signPlan.ts`（`planSigns`）がビルド時に決め、各チャンクの `signs`（`XwSign`: 番号・s・路面の z・level・側・取付・BoardContent か規制の板・桁・何のための標識か）と `meta.json` の `entrances`（入口ランプの地表端・名前・路線）に書く。規則・件数・取付は [標識システム](sign-system.md)「都市高速の板と設置（G6）」。

- **データ形式**: 欄の追加だけ（すべて任意の欄）。作った時点では XW_VERSION 2 のまま、P7（版 4）・P2.6（版 4 のまま）と合わせた後も 4 のまま（古い読み手は欄を無視し、ゲームは欄があるときだけ読む）。版 5 は P6（版 3）と P7 を合わせるときに取っておく（format.ts の注記）。データは統合したコンパイラで再生成した。
- **compile.ts の追加**: `CompileResult.features`（run ごとの OSM の節点と way を run の距離で。ファイルには書かない）。出口名と出口番号は motorway_junction の節点、最高速度は way の maxspeed（`XwWay.maxspeedTag`、タグが無ければ null）から読む。
- **network.ts の変化**: 事業者名を含む名前を捨てるのをやめ、名称層 `routeName` で前置きを外す（`name`・新しい `nameEn`）。試験区間のチャンクの `name` が null から「都心環状線」「1号羽田線」に変わった。測点・橋脚・交差・decks はすべて同じ（81 チャンクを比べて差 0）。
- **scripts/expressway.ts**: `emergency=phone` と非常駐車帯（`highway=emergency_bay` / `emergency=emergency_bay`）の節点を読む。ログ `expressway_signs_planned`・`expressway_sign_unplaced`。LICENSE.txt に節点の取り込みを追記した。
- **掲示速度 `XwChunk.posted`**（G6 レビュー W4）: チャンクごとの最高速度（km/h）。323 の板と道路グラフの limit が同じ値を読む（`expresswayRoads.ts` は `chunk.posted ?? run.tagV`）。規則は [標識システム](sign-system.md) の「G6 レビューへの対応」。P6（法規）と合流するときに P6 の規則へ一本化する。
- 試験区間の結果: 31 枚、unplaced 2（116の4 が他の標識と 20 m 以内）。
- **P7・P2.6 との統合（2026-11-11）**: 範囲が `hamazakibashi,rainbow` になり 69 枚（323 10・325 2・116の4 42・108の2-C 3・110-B〜113-B 各 3、unplaced 11）。台場出口（4848762）の 110-B〜112-B が加わった。構造物の street（臨港道路）は都市高速ではないので標識を置かず（323・116の4・116の6 とも）、`posted` はコンパイラの tagV（OSM の maxspeed、無ければ street の既定）のまま。統合前の計画は法定 60 を当てて道路グラフの limit を 40 から 60 に変えていた（tests/expresswayStructures.test.ts が検出）。測点・橋脚・交差・decks は main のデータと差 0（247 チャンクを比べ、違うのは signs・posted・name だけ）。2 回の生成でバイト一致。テストは、橋の上の左路肩 4.8 m で左車線の中心が床版の中心線から 0.1 m になる 111-B と、親と同じ掲示速度で分岐する本線（45021972、323 不要）に合わせた。

# トンネルと掘割（P9、2026-11-11）

設計書 8 章の P9（「terrain 切り抜き、deck」「坑口の穴・落下」「地形との干渉」）。OSM の `tunnel=*`・`covered=yes`・`cutting=yes`・`layer<0` の way（`network.ts structureOf`）を、高架とも地平とも別の **below run** にして同じコンパイラで解き、実行時は床版と同じ押し出しでトンネルの箱と掘割の擁壁を作る。Fable のレビュー（Changes Requested、Critical 2・Warning 8）の後に直した版の記録で、訂正した所は本文に「訂正」と書いた。[^p9]

## 法令と仮定

e-Gov の本文（XML）で確かめた: 第12条の建築限界の高さ H は普通道路 4.5 m（重要物流道路 4.8 m）。図の「歩道等を有しないトンネル」は路肩側の a・e の取り方が違うだけで H は同じ。第34条はトンネルに「必要がある場合」換気施設・照明施設（設計速度等を勘案）・非常用施設（通報・警報・消火）を求めるだけで、寸法・輝度・間隔は令に無い。縦断勾配はトンネルでも第20条のまま（トンネル固有の規定は無い）。**訂正（レビュー W5）**: 第8条第5項（トンネルの路肩の縮小）は第一種・第三種の道路が対象で、**第二種（都市高速）には適用が無い**。当初「第一種第三・四級で 0.75 m まで」とだけ書き、首都高に効くように読めた。[^egov34]

令に無い値は `assumptions.ts` に `verified: false` で置いた: 設備の余裕 `TUNNEL_EQUIPMENT_ROOM` 0.8 m（内空高 = 第12条の H + これ = 5.3 m を `below.ts TUNNEL_INNER_HEIGHT_M` で導く。レビュー S5）、頂版と最小の土被り `TUNNEL_ROOF` 0.8 / 0.5 m（`TUNNEL_DEPTH_M` = 6.6 m）、監査路 `TUNNEL_WALKWAY` 幅 0.75・縁石 0.25 m、擁壁 `CUT_WALL`（地表から 0.4 m 上まで、厚さ 0.5 m）、照明 `TUNNEL_LAMPS`（6 m ごと 1.5 m）。非常用施設（非常電話・消火栓・避難口）は描いていない。

## コンパイラ

| 項目           | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| run            | `splitRuns` が高架・below（トンネルと掘割は 1 本の run、坑口はチャンクの切れ目）・地平で切る。below run は `isBelowCompiled`: 両端が鎖の中（高架へ seam、または地平へ）か、他の鎖の来ない鎖の端。地下の分合流（トンネルのランプ、有明 JCT の湾岸線の掘割）・ユニバースの外・ループの継ぎ目は見送る（`belowDeferred`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 成分を混ぜない | `pruneBelow`: below run がつなぐ相手（seam の高架、交差・重なりの相手、合流する子）が、below run 抜きの網で 1 つの成分に収まらなければ見送る。**理由**: 制限なしでは全域の 107 本が試験区間の 56 run の成分を 381 run（変数 33,276）にまとめ、内点法が非有限の step で破綻し、試験区間の床版が最大 0.9 m 動いた。全域で決めるので範囲によらない（T8）。**訂正（レビュー W5）**: 当初「全域で 57 本を解き」と書いたが、57 本は**計画に残した数**で、解いた（成分が必要とされた）のは範囲に入る 737538573 の 1 本だけ。他の 56 本は範囲の外で未求解 。**訂正（P2.7-1）**: 「内点法が破綻した」は現 HEAD では再現しない。pruneBelow を外した全域（設計時の探査、493 回）と、この段の ship（2 回）・既定範囲（1 回）の実測で未収束 0（最大成分 382 run・29,694 変数）。破綻は P2.6 の gapTol の取り込み前の観測と推定。床版が動くのは事実で、既定範囲では最大 3.20 m（4848755）動く。pruneBelow は今は収束のためでなく、既定の床版を動かさないために残す（「P2.7-1」） |
| 端             | 高架 → below は高架の端が従来どおり `portal`（地表に標高だけ固定）、below の始端はその高架への `seam`（標高・勾配が一致、C¹）。地平へ出る端は `ground`。below の短いランプは P2.6 の連結路（親 2 本の 3 次式）にしない（天井を持てないため）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 縦断           | `setupBelow`: 床も地上の道路・鉄道との交差も無し。天井は `below.ts ceilingAt`（前後 2.5 m の地表の最低 − 深さ。トンネル 6.6 m、掘割 −0.1 m）を、**両方の坑口から下りて届く所だけ**に置く。届きは `descentWithin`: 坑口を第20条の標準勾配の半分で**上り**ながら出る最悪の場合から、凸の縦断曲線（第22条）で標準勾配まで（レビュー S3: 当初は水平から。上りで出る坑口では天井が解けなくなりうる）。凹はいらない（天井より深くてよい。反対の坑口への上りはその坑口の届きを逆に読む）。T12 の検査も同じ関数（レビュー S2）。目標は run がトンネルを含めばトンネルの深さ、掘割だけなら地上の道路を渡す橋の桁下（4.5 m + 桁高。レビュー S4）。届かないトンネルの測点は `tunnel_cover_short` に（許可リストで run ごとに理由）                                                                                                                                                                                                                                            |
| チャンク       | トンネルと掘割の境で切り、`structure` を `tunnel` / `cut`、`girder` 0、橋脚・交差・blocked 無し。坑口は `portals`（`{s, from, to}`）で、境界上の坑口は**トンネル側のチャンク**に（坑門を描く側。**訂正（レビュー W4）**: 当初は境界の後ろのチャンクで、トンネル → 掘割の坑門がトンネル側に作られなかった。全域で 7 本）。高架のチャンクには付けない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 橋脚           | **訂正（レビュー C2）**: below run が床版の重なり（plan.pairs）に入り、上を渡る高架の橋脚を「下の床版の上」として抑止していた（内回り 24402611 の s 700〜1800 で 15 本 → 0 本）。今は下が掘割か、地形を切り欠くトンネルの測点（`below.ts isHoleAt`、坑口の近く）のときだけ抑止し、埋まったトンネルの上には地上と同じに立てる（10 本。残る 5 本は坑口の穴の上）。データテストが本数と橋脚の無い区間の長さを縛る                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 重なり         | 同じ鎖の run どうし（高架とその先の掘割）は床版の重なりにしない（`classifyPairs`・`deckOverlaps`・データテストの総当たりとも）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| blocked の判定 | 解いた後、blocked（地表端の近くで越えられないとみなした地上の道路）を床版が**道路の幅の範囲（窓）の最低点で**越えていれば交差に移し、その診断（オブジェクトの同一性で）を外す（レビュー S1: 当初は交差の中心だけで判定し、診断は文字列の正規表現で消していた）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 検査           | T12 `checkCover`、T4 の地表の床は below では見ない。T5 は ground 端だけ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| データ形式     | XW_VERSION 4 のまま（5 は P6 との合流用）。**レビュー W6**: `structure` の値域を足し `seam` 端も使うので、旧 v4 の読み手とは非互換。meta に `features: ["below"]` を書き、読み手（`isSupportedMeta`）は知らない feature を拒否する（テストあり）。P7 の読み手は features を見ないので、P7 のゲームが P9 のデータを読む組み合わせは features では守れない（同じブランチで出すので起きない）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 対象と結果（trust signal）

試験区間（浜崎橋〜芝公園、レインボーブリッジ）の中にはトンネル・掘割が無い（P1 からの坑口は外回り 45021976 の終点と 11 号台場線 4848762 の終点で、どちらも範囲の外）。近傍の **都心環状線外回りの麻布台**（飯倉〜谷町、OSM way 737538573 掘割 109 m + 737538574 トンネル 488 m、layer −2）を範囲 `azabudai`（掘割と南の坑口だけ）と `azabudai_exit`（北の坑口の先の高架 895902565）として既定に足した。範囲を広げると上を渡る飯倉入口（24402018、V20 で重なり未許可）を拾うので、2 つの小さい箱にした。

- main（P2.6・P4・G6 を含む）を取り込んだコンパイラで `just make-expressway-data` を 2 回実行し、**バイト一致**を確かめた: run 17・チャンク 256・測点 4,374・**393,654 B**（main の 380,134 B から +3.6 %）。成分 57 run・8 回の QP すべて収束、未解決 0・閉鎖 0、生成 118 秒。G6 の標識は掘割に 1 枚（擁壁に取り付け）、トンネルの中には置かれない。
- run 737538573（597 m、V50 標準）: 南の坑口（高架の portal、T.P. 20.24 m）から掘割を最大 −4.5 % で下り、坑門（s 108.8 m）で地表から 7.3 m、トンネル内は最深 10.6 m 下（内空 5.3 m と頂版 0.8 m の上の土被り 4.5 m）、北の坑口へ最大 +3.6 % で上がり斜面の地表（T.P. 25.12 m）へ。北の坑口の手前 107 m（23 測点、s 490〜596）は地表が下がり、上りで出る最悪の場合からは箱と土被りの深さまで届かないので `tunnel_cover_short`（許可リスト、頂版が地表に出る開削部として扱う）。
- main のデータへの影響（P2.6・P4 の取り込み時点で測った）: 247 チャンクのうち 65 で z が変わり、最大は外回りの坑口手前 45021976:21 の 18.4 cm（seam で勾配がつながったため）。T10 は `crossing_over_or_at_grade` 34 → 30（blocked の判定）、`deck_overlap` 13 → 14（新しい高架 895902565 と内回りの谷町手前の移り変わり、理由つきで許可）、`tunnel_cover_short` +1、`vertical_fallback` 37 → 38、同一面の外れの一覧に谷町の 4 か所。
- テスト: `tests/expresswayBelow.test.ts`（深さ・届き・splitRuns・見送り・合成の丘で掘割 → トンネル → 地平、C¹、T1・T2・T12、portals、トンネル → 掘割の坑門の側、形の違う 4 つの丘で below run が解けなくならないこと、成分をまたぐトンネルの見送り）、`tests/expresswayBore.test.ts`（断面の表、床 ≤ 1 cm・天井・壁・縁石・屋根のレイ、坑門のレイ、擁壁の天端、地形の穴とマスク、トンネル内の判定と線分への射影）、`tests/terrainCut.test.ts`（水の三角形の扱い、穴に触れる三角形の分割、坑口の穴の脇でレイが地表に当たること）、データテストに T12・features・麻布台の run・内回りの橋脚。

## 実行時

- **断面**（`expresswayBore.ts`）: 床版と同じリングに沿って押し出す（グラフの surfaceY と床が同じ面: T11）。トンネルは路面・縁石・監査路・側壁・天井（コライダー）と外殻（外壁と屋根の上面もコライダー: 坑口の穴を横切る道がその上を通る）、掘割は路面と擁壁（内面・天端がコライダー、天端は地表 + 0.4 m）。坑口（`portals` で一方だけがトンネル）に坑門（枠、地表 + 0.6 m まで、コライダー）。面の種別は頂点色で、P4 の `deckSurface.ts` が最も近いパレットの材質（路面はアスファルト、内装板・擁壁・坑門はコンクリート、天井・監査路は床版下面のコンクリート）を当てる。トンネルの内装板の専用の材質は無い（設計書 6 章の tunnel-lining は未着手）。
- **地表の切り欠き**（`groundCuts.ts`）: 掘割の全長と、地表が頂版 + 0.6 m より低いトンネルの測点（坑口の近く）に、壁の外 0.3 m までの穴の多角形を作る。地形の描画は水と同じ z15 のマスクに重ねる（fragment の discard）。**訂正（レビュー C1）**: コライダーは当初、穴に触れる三角形をまるごと落とし、掘割の脇だけ地表の高さのエプロン（16 m）で補っていた。北の坑口の脇（トンネルの穴の周り）にはエプロンが無く、一般道（way 23648785・23581721・206524230・265049223）の上で車が地面を抜けて落下と復帰を繰り返した。今は穴に触れる三角形をその平面のまま 16² に分け、穴に当たらない小片を残す（`terrainCut.ts`、~1 m まで地表のコライダーが残る）。エプロンはやめた（地形の平面と段差になる）。穴を横切って残るのは 206524230 の 16 m（s 528〜534 の坑口の穴の上）で、ここはトンネルの屋根の上面（コライダー）を通る。
- **一般道・歩道・建物**: 一般道の路面は三角形の中心が穴の中なら描かず、PLATEAU の歩道は穴にかかる多角形ごと外す（縁石と trimesh が掘割に蓋をして車が当たった）。穴が後から届いたら、敷設済みの範囲（道路の読み込み中心から 1.5 km）にかかるときだけ敷き直す（道路の読み込み中は次の install に任せ、歩行者の経路も更新、`ground_cuts_relaid` / `ground_cuts_relay_failed` を記録。レビュー W7）。PLATEAU の建物は穴の中の三角形を潰す。**訂正（レビュー W3）**: 当初は `hideFootprints` を呼び直すだけで、読み込み済みの建物は切り直されず、チャンクごとにランドマークの壁のコライダーも作り直していた。今は `Buildings.addHiddenRings` が読み込み済みのモデルも切り、タイルの読み込みごとに 1 回にまとめる。P4 の `deckCuts`（床版の下の建物を桁下まで切り下げる）は below のチャンクには掛けない（トンネルの上の建物が地下まで切り下げられるため）。
- **照明と空**: 天井の両端に 6 m ごとの灯具（MeshBasicMaterial、昼夜とも光る）。カメラがトンネルの中（`tunnelAt`: 壁の間・天井の下）にいる間、坑口から 40 m で 0→1 になる遮蔽率で太陽・天空光・環境マップを 92 % 落とし、暖色の環境光（灯具の光）に置き換え、雨を止める（`Environment.setShelter`）。**訂正（レビュー W1）**: 当初は最寄りの測点の s を使い、測点の間隔（直線で最大 21 m）ごとに遮蔽率が段になった（s 563 で太陽 8 → 45 %）。今は中心線への射影で s と路面高を補間し、遮蔽率は時定数 0.35 s で追う。坑口の一覧は run ごとにキャッシュ（毎フレームの配列の確保をやめた。S6）。**Why not 灯具ごとの点光源**: 1 本で数十灯、forward 描画では重い。
- **徒歩**: `groundY` は nearY を渡すと「nearY + 0.5 m 以下で最も近い面」を返す（トンネル・掘割の中は床。当初は地表を返し、降車位置が地上になった）。徒歩の落下判定も同じ面で見る（レビュー W2）。「地表から 6 m 下に落ちたら戻す」は床版・トンネルの上では働かない。
- **グラフ**: below のチャンクは `structure` tunnel / cut・level −1 の線。`isDrivable` は OSM のトンネル・掘割を高架と同じに開く（GSI のトンネルは閉じたまま）。seam 端は junction と同じく親のチャンク端の ID に寄せる。

## 走行（一定速の走行フック、ゲーム時間 advance）

`?expressway&start=35.6577,139.7365`、45021976:19 に置き `cruise({ prefer: [45021976, 737538573, 895902565] })`。トンネルは外回りの一方向なので、同じ向きを 50・60 km/h で 2 回（内回りはこの区間で高架）。[^p9drive]

| 走行                     | 経路                                        |    距離 |     max \|dy\|（位置） | max \|vy\| |    RMS ay | 落ち込み（位置）           | 落下 |
| ------------------------ | ------------------------------------------- | ------: | ---------------------: | ---------: | --------: | -------------------------- | ---- |
| 50 km/h                  | 45021976:19 → 掘割 → トンネル → 895902565:1 | 1,057 m | 0.089 m（895902565:0） |   0.74 m/s | 0.99 m/s² | 4.7 km/h（:19 立ち上がり） | なし |
| 60 km/h（V50 区間は 50） | 同 → 895902565:2                            | 1,085 m | 0.087 m（895902565:0） |   0.70 m/s | 0.91 m/s² | 4.9 km/h（:19 立ち上がり） | なし |

レビュー修正と main（P2.6・P4・G6）取り込み後の値（レビュー前は 0.074 / 0.075 m。max |dy| の位置は坑口の先の高架で、P2.6 の解き方でその高架の縦断が変わった分を含む）。|dy| > 0.1 m のサンプルは 0（`BUMPS` 空）。

途中で見つけて直したこと（初版）: (1) **坑門の手前で車が止まり続けた**: main.ts の「地表から 6 m 下に落ちたら戻す」がトンネルの中で毎フレーム働いていた。(2) 60 km/h で掘割の入口で止まった: 穴が届く前に敷いた PLATEAU の歩道の縁石 → 穴が届いたら敷き直す。(3) 走行フックが seam の先 3〜5 m まで前の run の端（クランプされた点）で dy を測り、0.2〜0.33 m の偽の段差を出した（逆順の prefer で符号が逆になることで確認）→ 区間の内側に当たる候補を優先。

## 多視点レビュー

`scripts/qa/views/expressway-tunnels.json`（8 視点 × 昼・夜）。[^views-p9]

| 周   | 指摘                                                                                                                                                                                    | 対応                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1    | Critical: 掘割に一般道の路面と歩道が蓋 / Warning: 外からの視点 2 つが建物の中・坑口が見えない                                                                                           | 路面の三角形と歩道を穴で外す / 俯瞰に                                              |
| 2    | 蓋は解消。北の坑口は内回りの高架（layer 3）の真下で外から見えない（wontfix、中から確かめる）。Warning: 南の運転席の目が淡色の面の中                                                     | 目標のチャンクの始点より手前に戻すと目が内回りの桁の高さに置かれる（視点の置き方） |
| 3    | 掘割の運転席（新設）で擁壁・坑門・頭上の高架を確認。夜の掘割は暗い（照明は範囲外、wontfix）                                                                                             | 南の運転席を掘割のチャンクの中へ                                                   |
| 4・5 | 新規なし                                                                                                                                                                                | `converged`（round 5）                                                             |
| 6〜8 | レビュー修正と main（P2.6・P4 の材質・G6 の標識）の取り込み後に撮り直し、新規なし。P4 の材質が頂点色から当たり、内装板は型枠コンクリート（tunnel-lining の材質は未着手、Info・wontfix） | `just check-convergence expressway-tunnels` が `converged`（round 8）              |

## 性能（レビュー W8）

麻布台の開始地点（35.6592, 139.7366）で、ページを開いた直後の最初の組み立て（`expressway_decks_built`）を 5 回ずつ測った（M2 Max、開発サーバー、`.cache/p9/slices.mjs`）: ベース（origin/feat/expressway-structures 021e03e、34 チャンク）は最大スライス 4.3〜7.1 ms（p90 3.2〜4.0 ms）、P9（43 チャンク、トンネル・掘割を含む）は 3.8〜5.7 ms（p90 2.1〜3.5 ms）。4 ms を超える回はベースにもあり、**P9 によるものではない**（JIT 前・初回の転送を含む最初の組み立て）。トンネルの坑門・灯具は 1 ステップだが、灯具の位置はリングの二分探索にした。地形のコライダーの切り抜きは、穴の外接矩形で三角形を先に間引く。

## 逸脱と残課題（P9）

- **地下の分合流は見送り**（全域で 88 本）: 試験区間の 2 つの坑口のうち、11 号台場線 4848762 の終点（有明 JCT で湾岸線の掘割へ合流）はこれ（外回り 45021976 の終点は麻布台の run として解いた）。トンネル内の分合流は、親が below の junction・分合流部の断面（壁の切れ目）が要る。
- **成分を混ぜるトンネルは見送り**（pruneBelow）: 山手トンネル（C2、18 km）など長い地下区間は、成分が大きくなり内点法が破綻するので、全域の収束（P2.6 の後）の後。
- 掘割の上を渡る一般道は路面を描かず、橋（床版とコライダー）が無い: 横切る道で車が掘割に落ちうる（麻布台の掘割は内回りの高架の下で、地上の道は並走だけ）。坑口の穴は屋根の上面で渡る。
- 坑口付近の頂版が地表に出る区間（tunnel_cover_short）は外殻を描くだけで、土留め・覆土の形は無い。
- 入口照明（明るさの順応）と、外から見たトンネルの中の暗さは無い（中の照明は環境光の置き換え）。夜の掘割の照明も無い。
- 非常用施設（第34条第3項）・換気（第1項）・トンネルの標識は無い。
- 一般道・歩道の切り欠きは三角形の中心と多角形ごとの判定で、縁で数 m 余計に消える。地形のコライダーは穴の縁から最大 ~1 m（小片 1 つ）手前で切れる。
- 走行フックはトンネル内の照明・遮蔽率を数値で記録していない（多視点の昼夜の見た目だけ）。
- 見送ったレビューの提案: なし（S1〜S6・S8・S9 は対応。S7 は依頼に無い）。

# P6: 法規・経路・自動運転・交通 AI（2026-11-11）

- **W5 規制速度（XW_VERSION 5）**: コンパイラがチャンクごとに OSM の `maxspeed` の生の値（`XwChunk.maxspeed`、無ければ null）を出し、way の境目で値が変わればチャンクを切る。グラフの limit は G6 の `posted`（signPlan.ts postedOf: 同じタグに、無い way は前の値を引き継ぐ・run の始まりは法定 60 の規則）で、`posted` の無いファイルだけ `maxspeed`、どちらも無ければ法定 60（limitKind "statutory"）。設計速度 `V` とは分けた。P6 単独では版 3、P7（版 4）との統合で 5（v2〜v4 は読み込みで拒否、テストあり）。P7 の street（臨港道路）は postedOf が自分の値を返すので、法定 60 も高速の判定もかからない（`isExpressway` が false）。
- **範囲 `shiodome`**: 一般道 → 芝公園入口 → C1 内回り → 出口 → 一般道を走れるよう、汐留入口（45068172）・汐留出口（24402125）の箱を既定の範囲に足した（P9 と合わせて `hamazakibashi,rainbow,azabudai,azabudai_exit,shiodome`）。hamazakibashi の箱を広げなかったのは、汐留まで届く箱が浜崎橋から出る 1 号羽田線の 2 run（4.1 km・5.6 km）も取り込むため。汐留の 2 本は本線が築地川の掘割の坑口へ下る区間で、OSM の中心線が本線から 0 m（ノーズ）〜最大 8.4 m しか離れずに並走し（二つの車線域の幅の半分の和、壁高欄まで約 9 m に届かない。**訂正**: 初版と allowlist.ts の理由文は「1.1–1.7 m」と書いていたが、データの station から測ると 24402125:0 の s 20 m で 1.7 m、s 60 m で 4.8 m、s 140〜156 m で 8.4 m）、車線域が重なったまま高さが離れる（最大 6.6 m）。allowlist に理由つきで許可した（SHIODOME_REASON）。本線のその先は坑口で行き止まりで、経路と交通 AI は入らない（laneLinks.ts `reachesStreets`）。見た目の貫通は P9（掘割）と床版の一体化の課題として残る。チャンクの切り方が変わったので、芝浦の 45021972 × 45554540 の重なりの測点数が 16 → 20（|Δz| は同じ）になり、上限を直した。
- 生成は 2 回でバイト一致（P9 との統合後: 9 タイル・19 run・268 チャンク・4,459 測点・409,595 B、未解決 0、`features: ["below"]` を残して版 5）。汐留の先（築地川の掘割）はこの範囲のデータに無く、内回りは地表端で終わる（P9 が通したのは麻布台のトンネル）。経路と交通 AI はそこへ入らない。
- **レビュー（2026-11-11、Changes Requested）の後の修正**:
  - 合流の判定は、車線番号が本線の車線に入った瞬間に行う（road-traffic-law.md）。分流は枝に 30 m とどまってから判定する。
  - 本線の車は、本線のポリラインに沿った距離・横ずれ・路面の高さで拾う（laneLinks.ts `onTrunk`。自動運転・交通 AI・法規の判定で共通）。
  - テーパー（ランプの車線が本線の車線の隣に来る所）は合流ごとに測る（`taperOf`。芝公園入口 56 m・汐留入口は 40〜95 m の範囲、テストで固定）。床版の重なりはノードの 72〜83 m 手前から始まる。
  - 止まった本線の車を待たない（待ち合いで動けなくなるため）。
  - 交通 AI は隣の車線の後ろ 35 m・前 8 m が空いてから車線を移る。
  - 4 車線 ↔ 2+2 の分合流では内側の車線も対応付ける。
  - ナビは分岐の後に本線へ戻るかで出口と JCT を呼び分け、本線を走っている間は経路の床版を優先して現在地を取る。
  - 合流・分流の索引は `branchLink` / `mergeFrom` に持たせた。
- **W6 ランプ接続**: 地表端から一般道への at-grade の道筋を、置き換えた GSI 高速道路の線だけでなく全部の GSI 高速道路の線でたどる（置き換えの判定から外れた 2 本目の線で切れていた）。再現テスト（tests/expresswayTraffic.test.ts）は修正前の式で ramp_unattached になることを確かめた。読み込み範囲の端の扱い（範囲外は接続も報告もしない）は P3 のまま。

## 走行の確認（P6）

開発用フック `debug.expressway.route({ lat, lon })` はゲームの自動運転（ナビの経路・合流・法規の判定がプレイヤーと同じ）で走らせ、`stop(label)` が `expressway_route_driven` を書く（runs・links・ナビの呼びかけ・記録された違反とその位置・yieldedS）。ナビの声は `nav_spoken` に残る。`debug.expressway.trafficAt` / `TrafficAI.placeCar` で、合流に合わせて本線の車を 1 台置ける（負の位置はその run の手前のチャンクへさかのぼる、`backAlongRun`）。`AutoDriver.ignoresMergeTraffic`（QA 専用）で、本線を見ずに合流させられる。ヘッドレス Chrome・vite 5361・M2 Max、依頼元 scratchpad の p6/route.mjs（1 s ごとに自動運転の状態 dbg・周りの車・歩行者の高さの差を記録）。[^p6-drive]

最終（routes-e2・e3、818a6ac の再レビューの修正を入れた後）:

| 走行                                                         | 経路（run の順）                                                        | 距離・時間     | 床版の上 max \|dy\| | 落下 | 到着 | 記録された違反 | yieldedS |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------- | ------------------- | ---- | ---- | -------------- | -------- |
| 芝公園入口（接続線から）→ 内回り → 汐留出口 → 一般道         | 接続線 → 207111988 → 24402611:20〜30 → 24402125 → 地上                  | 2,161 m・201 s | 0.096 m             | なし | する | 0              | 2.0 s    |
| 汐留入口 → 外回り → 芝公園出口 → 一般道                      | 接続線 → 45068172 → 45021976:0〜14（45021972:0 を通る）→ 4853798 → 地上 | 2,523 m・205 s | 0.131 m             | なし | する | 0              | 0 s      |
| 芝公園入口（入口前の一般道から）→ 内回り → 汐留出口 → 一般道 | 一般道 1124 → 接続線 → 207111988 → 24402611 → 24402125 → 地上           | 2,180 m・218 s | 0.096 m             | なし | する | 0              | 1.9 s    |

- 本線の車を合流に合わせて置き、自動運転が合流の手前で譲った（d4〜d7・e2・e3 で 1.9〜3.4 s。80 m 後ろの車を待って後ろに入る）。外回りの e2 で 0 s なのは、置いた車がランプの車より先に合流点を過ぎて、待つ必要が無かったため。置く時刻は、ランプで速度に乗ってから（ノードまで 230 m 以内）にした（加速中の速度から計算すると 500〜800 m 後ろに置いてしまい、e1 では出会わなかった）。
- **譲らない場合（`ignoresMergeTraffic`、本線の車を合流車の 3 m 後ろに置く）**: d10・e2 で `xwMergeObstruct`（35.65346, 139.75261）が記録された。d11・d12 では記録されなかった（4 回に 2 回）。d11 では交通 AI がランプの車を見て 12.6→10.4 m/s に下げ（約 2 m/s²、判定の 3 m/s² 未満）、車線に入るときには 15 m 後ろにいたため。AI が譲るので、ゲーム内で妨害が起きるかは AI の速度と位置しだい。記録の文言は、反応距離の内側に入ったとき「急ブレーキ（∞ m/s²）」になっていたので、車間を書く `violationDetail.xwMergeCutIn` に分けた（tests/expresswayLaw.test.ts）。e2 では「本線の車のすぐ前（車間 0 m）に入った」と出た（並んだまま入った）。車間は反応距離の内側にいた後続のものを使う（818a6ac では全部の後続の最小を使っていた）。
- 到着の判定（`ARRIVED_M`）が、出発時のローカル座標の目的地と比べていたため、走行中に原点が移る（frame の recentre）と、着いていても `arrived: false` になっていた → 止まった時点の frame で目的地を引き直す。
- 出発直後の切り返し（`lostWhy: pavement`、接続線から出発する走行で毎回 1 回）は、route.mjs が車を接続線の始まりに置き、そこに PLATEAU の歩道の多角形（橋の袂の歩道が接続線の口を横切る所）が掛かっているため。入口の前の一般道（1124）から出発した e3 では切り返しは 0 回で、接続線を走って通る間にも起きなかった（818a6ac の再レビューの確認事項）。走行フックの置き方による現象で、ゲームの出発では起きない。

- ナビは 1 本目で「およそ700メートル先、汐留出口です。斜め左方向です。」から「まもなく、斜め左方向、汐留出口です。」まで 700/300/100 m と直前で案内し、2 本目で「まもなく、汐留入口から高速道路に入ります。」を言った。r5 で 2 本目の入口の案内が出なかったのは、接続線（OSM の高速道路の線）の上から始めたので「一般道から入口へ」の切れ目が経路に無かったため。
- 交通 AI: 1 本目の終わりに床版の上 7 台（うちランプ 7）。ページを読み込んでからの合流 6・分流 21（`expressway_traffic_seen`）。
- 途中で見つけて直したもの（r8 まで）:
  - (1) 合流の判定が、locate が床版の重なりで本線を答えた時点で行われていた（レビュー C1・C2、road-traffic-law.md）。
  - (2) 道路網の作り直しで、保留中の合流・分流が古い区間 id を引いて例外になった（`uncaught_error`、網が変わったら保留を捨てる）。
  - (3) 床版の上の信号無視（上記）。
  - (4) 入口の名前に、その先の出口の名前を付けていた。
  - (5) 自動運転が合流で自分自身を本線の車と数えていた。
  - (6) 合流の合図（70 m 手前から）。
  - (7) 交通 AI が床版に出なかった（4 回に 1 回を高速道路の区間に）。

**残課題の原因と修正**（2026-11-11、r8 の未収束 → d1〜d7）:

- **(A) 24402611:24（浜崎橋 JCT の手前）で中心線へ寄って止まり、切り返す・合図不履行**: 原因は PLATEAU の歩道の判定が平面（x, z）だけだったこと。床版の下の一般道の歩道に、床版の上の車線が重なる所で、(1) 車線が「歩道の上」と判定されて右の車線へ移され（中心から 1.38 → 1.02 m、短く右の合図）、(2) 車の位置が歩道の上と判定され（offLane の isOnPavement）、整列の切り返しに入った。合図不履行は (1) の短い車線の移動。r8 の要約で疑った「4↔2+2 の内側車線」と LaneLink の through の対応は原因ではなかった（経路の線は車線 0・1.38 m のまま正しかった）。歩行者（高さの差 −10〜−20 m）の判定（isSameLevel）も無関係だった（dbg の people）。→ `pavementUnder(seg, isPavement)`: 床版（地上でない区間）の上では歩道を見ない（PLATEAU の歩道は地面に描かれた平面で高さが無い。床版の縁は自分の幅の中の高欄）。再現テスト（tests/expresswayTraffic.test.ts）: (2) は「drives on along the deck over the street's pavements below」（合流の先の本線の下を全部歩道にする。修正前は t 37.9 s で切り返しに入る）、(1) は「keeps the deck's left lane over a pavement below it」（車線 0 の下と左に歩道。steerFor 側だけ元に戻すとこのテストが失敗する。818a6ac の再レビュー W2 で、(1) を縛るテストが無いと指摘された）。
- **(B) 外回りの合図不履行（35.65468, 139.76024、45021976:6〜7）**: 浜崎橋 JCT で 1 号羽田線の床版（45021972:0）が外回りの床版に重なる区間で、車の下の道路を locate が 45021972:0 と答え、法規の「車線の変更」をその区間の中心線から数えていた。二つの中心線が寄っていくので、車は車線 0 のまま（1.38 m）でも数えた車線が変わった（d4 で再現、車の dbg は合図なし・横位置一定）。→ `laneCountedIn`（laneLinks.ts）: 床版の上では、直前に数えていた run の床版の幅の中にいる間はその run で数える（幅の外へ出たら locate の答えに戻る。テストあり）。合流帯を判定から外すことはしない（合流帯でも本当の車線変更には合図が要る）。再現テスト: tests/expresswayWatch.test.ts（同じ区間を経路どおりに走らせ、run を優先しないと 45021972:0 で車線が変わったと数え、優先すると数えない）。
- **(B2) 合流と分流のまわりの数え方（818a6ac の再レビュー W4）**: 実データの全合流・分流 15 か所を自動運転で前後 350 m 走らせ、main.ts と同じ判定を 5 Hz で掛けた（tests/expresswaySignals.test.ts、レビューの再現スクリプト sim.ts を元にした）。818a6ac では 6 件が記録された。(1) 右から合流する本線の終端（45554540:33 → 24402611:26）で、連結路の枠のまま数えた本線への移動を「連結路の中の車線変更」と読んでいた → 合流する道路（合流の trunk か先の道路）を locate が答えたら、そちらで数える。(2) 車線の外（分流の枝のテーパー、枝の中心線が車から離れていく所）から車線へ入る動きを車線変更と数えていた → 車線どうしの移動だけを数える（`laneChangeSide`。進路変更禁止の判定と同じ定義。合流・分流そのものは第75条の6・7 と合流の合図が扱う）。(3) 下の (C) の数え方の不足。修正後は 0 件。
- **(C) 経路が計画した車線変更に合図が出ない**: 自動運転の合図は「目標の横位置と今の横位置の差 > 0.3 m」で出していたが、目標は経路の滑らかにした横位置で、車はそれに追いつくので差が開かず、計画どおりの車線変更（分流の車線へ、合流の後に左へ戻る、右折の車線へ）に合図が出なかった。(B) を調べる途中で見つけた別の欠落で、(B) の原因ではない（(C) を直した後の d4 でも (B) は残った）。→ `plannedLaneChange`: 35 m 手前・今・3 s 先（最低 30 m）の経路の点を、今の区間の車線で数え（`laneOfOffset`、main.ts と同じ数え方。別の区間の点はその区間の中心線からの横位置を今の区間の車線で読む）、違えばその側へ合図（施行令 第21条: 進路変更が終わるまで）。**訂正（818a6ac の再レビュー C1）**: 初版は計画の車線番号を比べ、曲がり角より優先していた。そのため右折・右分岐で逆側の合図が出た（2 車線どうしの右折で曲がる直前 0.8 s と直後 1.6 s に左、浜崎橋 JCT の右分岐 24402611:22 → 4848762:0 で 311〜383 m に左が出て、右は一度も出なかった）。また 4 → 2 車線（45554540:31 → :32）のように、番号が変わらずに車線を移る変更を拾えなかった。今は曲がり角・30 m 前の右左折を先にし、窓の中に曲がり角か右左折があれば null にし、合流・分流のノードで窓を切る。ノードを過ぎてからの合流の合図は、車線を移る動き（gap か計画）があればそちらを出す（2 → 4 車線の合流 45019020:41 → 45554540:31 では、ノードのすぐ先で左へ移る）。再現テスト: tests/laneChangeBan.test.ts「has the right indicator on for 3 s before …」（修正前は線を越えるとき 0 s）・「shows only the right indicator through a right turn …」（818a6ac では失敗）、tests/expresswaySignals.test.ts「signals right, never left, before the right-hand branch」（818a6ac では失敗）。
- **(D) 入口の合流ノードで 15 km/h まで落ちる（車がいなくても）**: 合流のノードを一般道の交差点として扱い、本線を「優先道路」とみなして徐行していた（junctions の第36条）。→ 全部の道路が床版のノードは交差点にしない（`isDeckOnlyNode`。junctions のほか、追い越しの判断・待つ場所・一時停止の後の確認も同じ述語を使う。818a6ac の再レビュー W3。床版の端が一般道に直結するノードは交差点のまま、テストあり）。再現テスト: tests/expresswayTraffic.test.ts「keeps its pace through the merge node」（修正前 12 km/h）。これで譲る場面の時刻合わせが合うようになった。
- **(E) 汐留出口の地上の端で、赤信号の停止線を切り返しで越えて信号無視**: 原因は、ランプの地上の接続線（expresswayRoads.ts の connector、OSM の ramp）が `carriagewaysAt` の索引に入っていないこと（索引は usesGroundSurface ＝一般道だけ）。接続線の上では全長にわたって「道路の外」になり、遅いと整列の切り返しに入る。汐留出口では赤で停止線の手前に止まったときに入り、前へ 2 m 出て停止線を越えた（d6 の `lostWhy: offRoad`）。**訂正（818a6ac の再レビュー W1）**: 初版は「接続線と一般道の線の端が数 m 離れていて、どちらも答えない」と書き、経路の線から 1.5 m 以内（`ON_PATH`）なら道路の外とみなさないという対症療法にしていた。今は、経路の今の区間と前後 2 区間のうち地上の道路（接続線を含む）の幅＋1 m の中を道路として数える（`isOnRouteRoad`。offLane と切り返しの探索範囲 area() の両方）。carriagewaysAt に接続線を入れなかったのは、その呼び出し元（歩行者・縁石・交通 AI の配置）が「一般道」の意味で読んでいるから。再現テスト: tests/autoDriver.test.ts「counts the connector the route runs along as road, up to 1 m past its half width」（2.9 m は道路、818a6ac では失敗）・「still aligns a slow car standing off every road beside its path」（3.1 m は整列に入る）。**残課題**: 切り返し（ManoeuvreRunner）は停止線と信号を見ない。今回は切り返しに入らないようにしただけで、切り返し中の信号は扱っていない。
- **(F) 合流に合わせて置いた本線の車が出ない**: `placeCar` は区間の中の位置だけを取り、本線の区間の長さで頭打ちになっていた → 負の位置は同じ run の手前のチャンクへさかのぼる（`backAlongRun`、単体テストあり）。もう一つ、置き先の内回りが「一般道へ抜けない run」（読み込み済みのチャンクの中で汐留出口の先がまだ無い）として、出現の時点で捨てられていた → 置いた車は行き止まりの判定をしない。

**床版の欠陥（P3.5 の別件、この PR では直さない）**: 走行では落下していないが、継ぎ目の検査（tests/expresswayDrive.test.ts）に理由つきで残している。(1) 汐留出口が内回りから分かれる 24402125:0 の s 39〜81 m で、同一面の帯の中なのにマスターの面にレイが当たらない（`OPEN_HOLES`、原因は未特定）。(2) 芝浦 JCT の 45019020:40（s 4079〜4083、11 号台場線の上りが 1 号羽田線に重なる区間の手放しの先）の継ぎ目に 18 mm の段（`SEAM_EXCEPTIONS`、P6 で maxspeed の変わる所でチャンクを切り直して出た。切り直す前は 3.5 mm）。どちらも床版の組み立て（P3.5）で直す。

## 多視点レビュー（P6）

`scripts/qa/views/expressway.json` の汐留のセッション（合流の運転席・俯瞰、分流の運転席・俯瞰）を含む全 87 コマ（昼・夕・夜・雨の夜）を 2 周撮った（.qa/views/expressway/round-01・02、vite 5361）。round 1 の指摘は Warning 1 件で、汐留入口の合流で本線の床版の壁高欄が斜めに切れた段（くさび形）が見える。許可した重なり（SHIODOME_REASON）で平面を動かせないので wontfix とし、床版の一体化と掘割で直す。round 2 は新規 0。`just check-convergence expressway` は `converged`（2 quiet rounds, nothing open）。レビューは P6 の実装担当が自分で行った（観点は幾何と走行面だけ）。

## 性能（P6）

`traffic.update` を包んで時間を測った（芝公園、昼、ヘッドレス Chrome、30 s、?expressway の有り・無しを各 1 回、依頼元 scratchpad の p6/trafficperf.mjs）。台数は上限の 34 台で同じ。traffic.update の中央値 0.3 ms・p95 0.4 ms・最大 1.1 ms（有り、床版の上 1〜3 台）、0.2 / 0.3 / 1.1 ms（無し）。フレームの中央値はどちらも 50 ms（ヘッドレスの描画が律速）、p95 は 66.7 / 50.1 ms、最長 83.4 / 66.8 ms。各 1 回で、フレームの差は 1 フレームの刻み以内で読めない。`just measure-perf-fixed` は鏡の A/B 用の固定シーンで交通を止めるため使っていない。台数の上限（QUALITY.maxAiCars）は変えていない。

[^p6-drive]: 依頼元 scratchpad の p6/route.mjs と routes-r4〜r8.json・routes-d1〜d12.json・routes-e1〜e3.json（2026-11-11、ヘッドレス Chrome、?expressway）

## 床版の走行検査が交通 AI の車と事故で invalid（P6 の後、2026-11-11 修正）

**症状**: P6（#63）の後、`just check-deck-drive` が毎回 `invalid: "accident during the drive"` になった（`accident` の kind `vehicle`・自車 47 km/h・相手 1,481 kg、crossed 0）。origin/main（d00bf35）の既定データでも再現した（repro2、2026-11-11T12:16〜12:21Z）。

**経緯（ログと交通 AI の観測から）**: 事故の相手は、自車の**後ろ**から同じ車線 0 を来た床版の上の交通 AI の車だった。AI の `speed` は 40 km/h（自車 47 km/h より遅い）なのに、実際には約 51 km/h で進み、後ろ 25 m から 3 m まで詰めて追突した（24402611:28〜29、35.659 N・139.759 E 付近）。`traffic.update` を包んで測ると、床版の上の AI の全台で「動いた距離 / Σ speed·dt」が 1.26 だった（probe3、21 台以上）。AI は `gapAhead` で自車を避けるが、自車の速さが AI の速さ +2 m/s を超えると「離れていく」とみなして避けない（`isPlayerFleeing`）ので、ぶつかるまで減速しなかった。

**根本原因**: フレームを進める呼び出しが 2 つある。requestAnimationFrame の `tick(now)` と、QA の `__game.advance` が呼ぶ `step(performance.now())`。rAF の `now` はフレームの開始時刻（コールバックが走る前）なので、advance の直後の rAF フレームは前のフレームより前の時刻を持ち、`dt = Math.min(0.05, (now - last) / 1000)` が**負**になった（ヘッドレスで advance 中も rAF は動き続ける。観測では −0.006〜−0.022 s）。物理は accumulator に負の dt を足して時間を返すので合計は壁時計どおりだが、交通 AI は dt ≤ 0 のフレームで車を動かさない（`drive` が早期リターン）ので、正の半分だけを積み、AI の時間が約 1.26 倍で進んだ。

- P6 の前は床版の上に AI の車が出なかったので、検査の車と同じ車線を走る AI がおらず、この時間のずれは表に出なかった（P6 で「出現の 4 回に 1 回を高速道路の区間に」した）。
- 実際のプレイ（rAF だけ）では `now` は単調なので起きない。`__game.advance` を呼ぶのは `scripts/qa/drive.mjs`（79・83・89 行）と `scripts/qa/drive-deck.ts` だけで、影響を受けたのはこの 2 本。P6 の route.mjs（`b.sleep` で待つだけ）と多視点レビューの `scripts/qa/views.ts` は advance を呼ばないので影響を受けていない（**訂正**: 初版は「advance を使う QA の走行（drive-deck・route.mjs・多視点レビュー）」と書いていた）。

**修正**: `src/game/frameClock.ts` の `clockStep(stamp, last)` に切り出し、前の時刻より前のフレームは dt 0 で、時計を戻さない。`main.ts` の `step` は rAF・advance の時刻を `stamp` で受け、そのフレームの時刻 `now` には `clockStep` の返す `last` を使う（後段の `control.update(now / 1000)`・法規のタイマー・各種のクールダウンにも古い時刻が渡らない。レビュー S1）。名前は `charmRig.ts` の `frameStep` と衝突しないよう `clockStep` にした（S2）。tests/frameClock.test.ts は main.ts の配線もソースで検査する（S3）。**Why not** 検査中は交通 AI を止める・検査経路から外す: AI が床版の上を走るのは P6 の仕様で、検査はその状態の床版を測るべき。原因は検査の設計ではなく時間の基準のずれで、止めればこのずれ（advance を使う QA に効く）が隠れる。事故判定（`isAccident`）と drive-deck の invalid の扱いは変えていない。

**確かめたこと（trust signal）**:

- 修正後、床版の上の AI の「動いた距離 / Σ speed·dt」は 0.99〜1.00（probe5、2026-11-11T12:39〜12:41Z、38 台）。
- `just check-deck-drive`（vite 5391、ヘッドレス Chrome、M2 Max。他のエージェントの重いビルドと並走）: fix1（12:42〜12:48Z）`invalid: null`・accident 0・crossed 0・落下なし・1,804 m。2 本目以降は下の表（fix2 の 1 本目は終盤にヘッドレス Chrome の接続が切れて結果が出なかった。ページのログに事故は無い）。
- 回帰テスト: `tests/frameClock.test.ts`（rAF と advance が交互に呼ぶ時刻の列で、dt が負にならず、全フレームの dt の和と dt > 0 のフレームの和が壁時計に一致する。修正前の式では負の dt が出て 2 つの和が食い違う）。

| 走行                                         | invalid  | 事故 | crossed | 落下 | 距離    | max \|dy\|（位置）     |
| -------------------------------------------- | -------- | ---- | ------- | ---- | ------- | ---------------------- |
| repro2（修正前）                             | accident | 4 回 | 0       | なし | 1,803 m | 0.230 m（24402611:31） |
| fix1                                         | null     | 0    | 0       | なし | 1,804 m | 0.226 m（24402611:31） |
| fix2b（13:18〜13:23Z）                       | null     | 0    | 0       | なし | 1,804 m | 0.219 m（24402611:31） |
| fix3（13:26〜13:31Z）                        | null     | 0    | 0       | なし | 1,804 m | 0.230 m（24402611:31） |
| merged1（#66 を取り込んだ後、13:46〜13:51Z） | null     | 0    | 0       | なし | 1,803 m | 0.227 m（24402611:31） |
| merged2（同、13:53〜13:58Z）                 | null     | 0    | 0       | なし | 1,803 m | 0.227 m（24402611:31） |

修正後の同じ経路の samples（probe6、12:55〜13:12Z。probe7、13:34〜13:40Z は drive-deck と同じ advance(10) 刻み）では、止まるまでの |dy| > 0.09 m は出発直後の 1 サンプル（0.098〜0.099 m、207111988:0）だけで、0.1 m を超えるのは下の別件の衝突の直後（0.16〜0.23 m、0.2 s）だけだった。

未解明（追っていない）: fix2b と fix3 の `maxShortfallAt` が 24402611:27 だった。shortfall は 52.0〜52.4 km/h で target は 50 km/h 以下なので、そのサンプルの `forwardSpeed` は約 −2 km/h、つまり自車が一瞬**後退**していた（**訂正**: 初版は「ほぼ 0 km/h」と書いていた）。事故・接触のログは無く、probe7 では再現せず（shortfall は :31 の衝突だけ）、当時の drive-deck の結果は samples を残さないので原因は特定していない。**2026-11-12 訂正**: 高架の下の街路灯の柱と推定した（:29 は計装で確定、:27 は根拠つきの推定。下の「床版の走行検査が 24402611:27 で一瞬止まる」）。

**24402611:31 の s ≈ 33 m で止まる件（レビュー W2 の後の結論）: 床版の既知の制約で、検査の経路を直した**。修正前の走行は毎回、内回りの 24402611:31 の s ≈ 33 m（35.66075 N・139.76057 E）で 48 km/h から一瞬で 0 km/h になっていた（`expressway_car_stalled`）。その縦揺れが max |dy| 0.22〜0.23 m で、0.1 m の目安を超えたのはこのサンプル列だけだった。当たっていたのは汐留出口のランプ 24402125:0 のコライダー（`expressway.built` の body から特定、止まった直後の鼻先 0.05 m）。

- 原因は床版の組み立ての仕様。汐留出口が内回りから分かれた後、二つの床版は |Δz| が `MERGE_MAX_DZ`（0.15 m）を超える s 31〜33 m で手放される。そこから先は `expresswayMerge.ts` 450〜456 行の `level_apart` の扱いで、子＝汐留出口のランプが自分の壁高欄を立てる。その右の壁が、本線の車線 0 の中 +1.7〜+2.2 m に入る（手放しの s と壁の位置はレビューの計測）。中心線の間隔は最大 8.4 m で、二つの車線域の幅の半分の和（約 9 m）に届かない。
- この区間は SHIODOME_REASON（`allowlist.ts` 47〜48 行、許可の行は 209〜216 行）と上の「範囲 `shiodome`」の項（本線のこの先は経路と交通 AI が入らない）で許可済みの重なり。本線の先は築地川の掘割の坑口へ下る地表端で、このデータの範囲には無い。
- P6 の前のデータは 24402611:29 で終わっていたので、検査の車はここまで届かなかった。床版の衝突は `hitKind` が `ground` と読むので accident にはならず、drive-deck は停止を `stalled` に書くだけで成功（終了 0）にしていた（レビュー S5）。
- **検査経路の修正**: drive-deck の cruise の `prefer` を `207111988 → 24402125 → 24402611` にし、分流で汐留出口へ降りて、ランプの地表端で一般道（接続線）に出た所で走行を終える。P6 の自動運転で落下なし・max |dy| 0.096 m だった経路。**Why not** cruise を 24402611:30 の手前で終える: 本線の車線 0 のまま止めるだけで、汐留出口の分流・高さが離れる区間（`level_apart` の手放し）・ランプの地表端を測らなくなる。
- **失敗の条件（S5）**: `scripts/qa/deckDriveVerdict.ts` で、次のどれかを失敗（終了 1）にする。建物の貫通、`expressway_car_stalled`、落下、cruise の目標速度からの落ち込み 15 km/h 超（`MAX_SHORTFALL_KMH`）、終点（ランプの地表端）に届かない。テストは tests/deckDriveVerdict.test.ts。
- **残る課題（床版側）**: プレイヤーが手動で内回りの車線 0 を直進すると、同じ壁に当たる。掘割のデータ（築地川）を入れて本線を先へつなぐことと、床版の一体化（分流の後も同じ面の間は壁を立てない）の課題として残す。

修正後の経路での走行（vite 5391、ヘッドレス Chrome、M2 Max）:

| 走行                 | invalid | failures | 事故 | crossed | stalled | 落下 | 距離    | max \|dy\|（位置）     | max shortfall（位置）   | 終点 |
| -------------------- | ------- | -------- | ---- | ------- | ------- | ---- | ------- | ---------------------- | ----------------------- | ---- |
| v2a（14:17〜14:21Z） | null    | なし     | 0    | 0       | 0       | なし | 2,116 m | 0.082 m（207111988:2） | 4.8 km/h（207111988:0） | 到達 |
| v2b（14:21〜14:25Z） | null    | なし     | 0    | 0       | 0       | なし | 2,115 m | 0.082 m（207111988:2） | 4.8 km/h（207111988:0） | 到達 |
| v2c（14:25〜14:28Z） | null    | なし     | 0    | 0       | 0       | なし | 2,107 m | 0.082 m（207111988:2） | 4.7 km/h（207111988:0） | 到達 |

3 本とも max |dy| は 0.1 m の目安の内側。走ったチャンクは 207111988:0〜2 → 24402611:21〜29 → 24402125:0〜2 で、:29 の後は汐留出口へ分かれて 24402611:30・31 を通らない。

## 床版の走行検査が 24402611:27 で一瞬止まる（街路灯の柱、2026-11-12 修正）

**症状**: `just check-deck-drive` の 3 回に 2 回ほど、24402611:27（局所 y 約 7.2 m、車線中心から 0.01〜0.03 m）で 1 サンプルの間に 47 → −2 km/h に落ちた（`maxShortfallKmh` 52）。dy は変わらない。上の「未解明」の件と同じもの。再現（a1、2026-11-11T20:32〜20:36Z、origin/main 8cb296a、vite 5737）では samples の t 104.79 → 104.88 s の 0.09 s で 47.2 → −2.0 km/h。その後 t 105.56 s まで ±2 km/h の内に止まり、105.65 s から同じ車線（off 0.01〜0.02 m）のまま普通に加速して同じ所を直進した。[^deckdrive-lamp]

**特定**: 自車の車体の `drainCollisionEvents` に、相手のコライダーの形・位置・群・親の剛体を出す一時的な計装を入れて 3 本走らせた（b1〜b3、20:40〜20:45Z）。b1 が 24402611:29 で 47.5 → 25.7 km/h に落ち、その時の相手は**半高 4.85 m・半径 0.11 m の円柱（PROP_GROUPS、1,422 個のコライダーを持つ固定の剛体＝街路灯）**だった。中心 y 2.60 m（足元 −2.25 m、頂 7.45 m）に対し、車体の中心は y 6.19 m。高架の下の一般道の街路灯（高さ 10〜12 m、`streetLights.ts`）の柱が床版を突き抜けていた。

- **:29 は確定**（計装の記録がある）。
- **:27 は推定**: :27 で止まった a1 は計装を入れる前の走行で、相手のコライダーの記録は無い。柱だと推す根拠は、(1) 当たって止まった障害物が約 0.75 s 後（t 104.88 → 105.65 s）に消え、車が同じ車線・同じ向きのまま同じ所を直進して通り抜けたこと。動かない壁や床版の段なら消えないが、街路灯は 2 s ごとの `settle` で隠されて当たり判定ごと消える（下の根本原因）。(2) dy が変わらない（段ではない）。(3) 速さが一瞬負になる（細い固定物の反発）のが :29 の柱と同じ。(4) 修正後の 15 本で :27 でも止まらない。

**根本原因**: 街路灯は道路網から置き、建物の中に立った柱を 2 秒ごとの `settle` で隠す。その判定 `isOpen` は上から下へのレイがコライダーに当たる高さを見るので、高架の下の柱は**床版のコライダーが既にあるときだけ**隠れていた。床版のコライダーは自車の近くにだけ作られ（`expressway_decks_built` の collidersBuilt / collidersDropped）、`settle` は壁時計の 2 s ごと・カメラから 220 m 以内なので、床版の上の自車が柱に届く前に「床版のコライダーができた後の settle」が走ったかどうかで、柱が残るかが決まった。時刻がほぼ同じに見えたのは、一定速の cruise で同じ場所に同じ時刻に着くから。柱は細いので衝突の後は `touching()` に何も残らない（S5 の記録が 0 だった理由）。`hitKind` は `pole` と読むが、事故判定は衝突後の速さ（2 km/h）を見るので accident にならなかった（既知の欠陥、直していない）。

**修正**:

- `src/world/deckOverhead.ts`（新）: 道路グラフの床版の区間（`isOnGround` でなく `elev` を持つもの。トンネル・掘割も含む）ごとに、点列 ± (幅の半分 + `MAX_MARGIN` = `DECK_REACH` + 0.5 m) の外接矩形を一度作り、点 (x, z) の上を通る**すべての**面の高さを返す（`surfacesOver`）。矩形の外の区間は `nearestOn` の前に弾く。
- `src/world/streetLights.ts`: 灯ごとに柱の足元（余白 `DECK_REACH` + 0.5 m）と灯具（アームの先、余白 `DECK_REACH`）の上の面を `overhead` に記録し、`isUnderDeck` が真なら描かず、当たり判定も光も作らない。足元の上に床版があれば**高さによらず**外す（高架の下は桁に付けた照明で照らすもので、床版の下で止まる柱は灯具が箱桁の中かすぐ下に来る）。柱が床版の横で、灯具だけが床版の下なら、床版が柱の頂 + 桁高（`GIRDER_DEPTH` 2.2 m、未確認の仮定）より低いときに外す。足元より 0.5 m 以上下の面（トンネル・掘割）は数えないので、高架と地下が重なる所でも高架の側で外れる。数は `street_lights_placed` の `underDeck`（地面の高さが分かった灯だけ）。
- 信号柱（`trafficControl.ts`）とオービスの柱（`orbis.ts`）: 頂が上の床版の路面に届く柱（`poleReachesDeck`）には当たり判定を作らない。柱そのものは残す（信号は交差点の制御、オービスは取締りの記録の一部で、消すと別の挙動が変わる）。実例があるかは調べていない（検査経路の上では起きていない）。標識（`signs.ts`・`guideSigns.ts`）は自前の隠す処理があり、今回は手を入れていない。
- **Why not** `isOpen` を待つ・settle を速くする: 床版のコライダーは自車の近くでしか作られないので、どの間隔でも「柱が先に見つかる」順は残る。道路グラフの床版の高さは道路網と同じ時点にあり、ストリーミングの順に依らない。**Why not** 柱を床版の下まで短くする: 12 m の柱の途中で切った灯は実在しない形になる。**Why not** 全灯 × 全床版の総当たり（この PR の初版）: 下の表のとおり街路灯の作り直しが約 13 倍遅くなり、その間（`rebuildSteps` の `clear(true)` の後）は柱も光も無い。

**街路灯の作り直しの時間（ログの `road_network_built.stagesMs.streetLights`・`street_lights_placed.durationMs`、検査の走行のセッション全部）**:

| コード                                       | stagesMs.streetLights               | street_lights_placed.durationMs        |
| -------------------------------------------- | ----------------------------------- | -------------------------------------- |
| origin/main（a1・a2・b1〜b3）                | 中央値 12.2 ms（8.4〜19.0、36 回）  | 中央値 230 ms（128〜369、38 回）       |
| 初版の総当たり（f1〜f6・g1〜g3）             | 中央値 228.6 ms（131〜361、63 回）  | 中央値 3,073 ms（1,819〜6,551、63 回） |
| 外接矩形（h1〜h6、2026-11-11T21:32〜21:42Z） | 中央値 15.0 ms（10.4〜25.4、42 回） | 中央値 344 ms（215〜451、43 回）       |

**確かめたこと（trust signal）**:

- 修正前（origin/main 8cb296a）: a1・a2（20:32〜20:36Z）・b1〜b3（20:40〜20:45Z、計装つき）の 5 本中 2 本で止まった（a1 が :27 で 52 km/h、b1 が :29 で 24.3 km/h の shortfall）。
- 初版の修正: `just check-deck-drive` f1〜f6（20:46〜20:58Z、計装つき）・g1〜g3（21:01〜21:05Z）の 9 本とも `invalid: null`・`failures: []`。計装のログ（`.qa/logs/2026-11-12/`）では、修正後の 6 本に床版の高さ（y > 1 m）での接触は 1 件も無く、修正前の b1 の柱の 1 件だけだった。
- レビュー（#70）後の修正: h1〜h6（2026-11-11T21:32〜21:42Z、vite 5737、ヘッドレス Chrome 3 本並走、M2 Max）の 6 本とも `invalid: null`・`failures: []`、max shortfall 4.7〜4.8 km/h（207111988:0 の出発直後）。`underDeck` は 各セッションの最初の構築で 14 本、地面が揃った後は最大 47 本（地面が分かった灯だけを数えるようにした。初版は地面未読込の灯を高さ 0 として数え、最初の構築が 6〜7 本と少なく出ていた）。
- 回帰テスト `tests/streetLightsUnderDeck.test.ts`（9 件）: `isUnderDeck` の境界（足元の −0.5 m、灯具の頂 + 桁高、トンネルだけ・高架とトンネルの両方）。高架の下を沿う通り（柱は床版の横、灯具が下）と直角に横切る通り（足元が床版の車線の中）の灯の `overhead`、トンネルが重なる所で両方の面を持つこと、外接矩形と総当たりの答えが同じこと。床版のコライダーが無い（`isOpen` が常に真）ままでも、床版の上の車の高さに柱のコライダーも光る灯も無く、外の通りと床版の外の横切る通りでは残ること。原点の移動（`reanchor`）の後も床版の高さが一緒に動いて灯が外れたままであること。足元の判定を消す・桁高を 0 / 15 m・足元や灯具の下限を +3 m・`reanchor` の変換を消す・`live` を戻す・矩形を狭める・最も低い面だけ返す、の 10 通りの改変でどれもテストが落ちることを確かめた（2026-11-11T21:25Z）。

**見つけた別件（直していない）**:

- `StreetLights.settle` が原点の移動の後に作り直す柱のコライダーは、移動した剛体の座標で作られる（`place` が世界座標を剛体の局所座標として渡す）。原点の移動のすぐ後に道路網ごと作り直すので普段は表に出ないが、その間に地面が変わった柱はずれた所に当たり判定を持つ。テストは光（`live`）で確かめている。
- 高架の下の通りは街路灯を外した分だけ暗い。桁に付けた照明（高架下照明）は無い。後続の課題。
- 信号柱・オービスの柱が箱桁の中に描かれうる見た目の件は、当たり判定だけ外した（上）。

# P2.7-1: 出荷範囲と全域スコアカード（2026-11-11）

P2.7「都市高速を全域に広げる」の第 1 段階。データと解は 1 バイトも変えず、後段（S2〜S7・R1〜R3）の合否を機械で判定する土台を作った。Fable のレビュー（Changes Requested）の C1・W1〜W6 と提案の一部を反映した版。[^p271]

## 作ったもの

| 項目           | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 事業者の way   | `XwWay.operated`。`normalizeWay` が OSM の name・operator に `hasOperatorWord`（roadNames.ts）を掛ける。street は false。ファイルには出さない。抽出（2026-10-03）の motorway・motorway_link 13,478 本のうち name か operator で事業者を名乗るのは 1,115 本、network だけで名乗るものは 0 本なので network は見ない                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 出荷範囲       | `src/expressway/scope.ts shipRuns(plan, inWards)`（純粋）。本線 = 事業者の way を 1 本でも含み 23 区に掛かる expressway の run。ランプ = endPlan の junction / seam を**ランプだけ**たどって事業者の本線に届き、23 区に掛かる ramp の run（つながりは両向き。他社の本線を経由しては届かない）。構造物の street（P7 のレインボーブリッジ下層の臨港道路 45177678・45177681）で 23 区に掛かるものも入れる（設計判断。台場出口 4848889 は 45177678 にぶら下がるので、入れないと親の無いランプになる）。23 区は public/data/areas.json の e-Stat 町丁ポリゴン（`AreaIndex.lookup`）で、節点そのものか周り 8 方向 30 m（`WARD_REACH_M`）のどれかがポリゴンに入れば掛かるとする（`nearWards`）。計画は範囲によらず全 run を持つので、集合は範囲によらない（テストで確認）                             |
| `--range ship` | `parseRanges` が `{ names: [], boxes: null, scope: "ship" }` を返し、`planNetwork(…, { wanted })` の `wanted`（計画全体から run の集合を選ぶ）に shipRuns を渡す。meta に任意欄 `scope: "ship"`（XW_VERSION 5 のまま、既定のビルドには出ない）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--below all`  | `planNetwork` の `pruneBelow: false`。計測専用（既定 `pruned`）で、`--out` が無いと止まる（既定の出力先には書かない）。`isBelowCompiled` の見送り（地下の分合流・ユニバースの端）はそのまま残る                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| スコアカード   | `src/expressway/report.ts`（純粋、zod の `ReportSchema`、版 2）と `--report <path>`（`--label`）。範囲の run（計画・出力・閉鎖を本線・ランプ・street 別に本数と km）、範囲の run の一覧と区内・区外・事業者・他社の km（`scopeExtent`、OSM の線で）、区外だけのランプ、親が書かれていない run（`dangling`）と構造物の床版の食い違い（`deckMismatch`）、閉鎖の根と道連れ（根ごと、クラス別）、診断（kind × allowed）、重なりの類型ごとの数と組の一覧（類型・分合流でつながるか・最小と最大の \|Δz\|）、検査 T1〜T7・T12 の違反数と最初の 5 件（`violations.ts`、データテストと同じ呼び方）、地表追従、サイズ、ソルバ、抽出の時刻と SHA-256。時間は `timings`（qpMs と段ごと）にまとめ、`--baseline <path>` はそれを除いて書く（基準 `tests/fixtures/expresswayScorecard.ship.json` をコミット） |
| 重なりの類型   | `overlapClass.ts`: **nose** = 分合流でつながる 2 本（一方が他方の親か、同じ親を持つ。XwRunSummary の端の parent から判定）で最大 \|Δz\| ≤ 0.5 m。**parallel-ramp** = 本線×ランプで 0.5 m 超。**changeover** = 本線×本線で 0.5 m 超（二層 ⇔ 並列）。**other** = 残り（ランプ×ランプ、street、つながらない 0.5 m 以下）                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 地表追従       | 高架の本線（expressway、全チャンクが viaduct で構造物の床版でない、800 m 以上）を 10 m で再標本（z と勾配はエルミート、地表は線形）、両端 300 m を除き: `correlation`（run ごとに平均を引いてプールした z と地表の相関）と `slope`（その回帰の傾き）、`shortWaveCorrelation`（両方から 500 m 移動平均を引いた残りの相関）、`shortWaveStdM`（z − 500 m 移動平均の RMS）、`reversalsPerKm`（勾配の符号反転、ヒステリシス 0.2 %）                                                                                                                                                                                                                                                                                                                                                                 |
| 抽出の固定     | `src/expressway/extract.ts`: 期待時刻 2026-10-03T20:20:50Z と SHA-256 `777236f6…`。ビルドは `.cache/osm/kanto-20261003T202050Z.osm.pbf` を読み、無ければ kanto-latest.osm.pbf が時刻と SHA の両方で一致するときだけ写す（`expressway_extract_pinned`）。`just fetch-regs` は kanto-latest を 7 日で同じパスへ取り直す（scripts/regulations.ts）ので、固定の写しは別の名前にした。kanto-latest は消さない（worktree が symlink で共有）。食い違えば復旧手順つきで止まり、`--accept-extract`（`just make-expressway-data <range> --accept-extract`、`measure-expressway-area` も flags に）で通す。固定の名前が SHA でなく時刻なのは、時刻が OSM の状態そのもの（meta・LICENSE に書く値）で、同じ状態でも取り直すとブロックの圧縮が違い SHA が変わりうるため                                     |
| just           | `measure-expressway-area label range="ship" below="pruned" flags=""`（`.cache/expressway-area/<label>/` に生成、`.qa/expressway/<label>.report.json`）、`compare-expressway-reports a b flags=""`（時間以外が違う項目と片側だけの項目〔追加・削除〕、範囲の run の増減。range・below・抽出が違えば `expressway_reports_unlike` で警告。`--check` で違えば終了コード 1）                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ログ           | `expressway_extract_checked`・`expressway_extract_pinned`・`expressway_scope_chosen`・`expressway_report_written`・`expressway_reports_compared`・`expressway_reports_unlike` を logEvents.ts に登録                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 計測（trust signal、2026-11-11 UTC、M2 Max、2〜3 本並列で実行したので時間は単独より長い）

- **既定データの不変**: レビュー対応後のコードで `just make-expressway-data`（07:24Z 終了）の後、`git status public/data/expressway` は差分なし。
- **ship/pruned を 2 回**（07:26Z 終了）: タイル・meta・LICENSE がバイト一致（`diff -r`）。時間を除いた基準（`--baseline`）はラベルの 1 行だけが違い、`just compare-expressway-reports ship-pruned-1 ship-pruned-2 --check` は終了コード 0。
- **pruneBelow なしの収束**: レビュー前のコードで ship/all を 2 回（06:52Z、タイルのバイト一致）、レビュー後の ship/all を 1 回（07:31Z）、既定範囲の `--below all` を 1 回（06:45Z）。いずれも未収束 0（最大成分 382 run・29,694 変数）。再現用 QP の保存は不要だった。既定範囲では床版が既定データから最大 **3.20 m**（4848755）・2.61 m（4848889）動き、1.27・1.21・1.06・0.93・0.83・0.79 m と続く（同じ s でエルミート面を比べた）。診断は 87 → 407。
- **all/pruned を 1 回**（07:31Z）。

| 項目                                                      |                                                                                 ship/pruned |                                   ship/all |                                             all/pruned |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------: | -----------------------------------------: | -----------------------------------------------------: |
| 計画の run（本線 / ランプ / street）                      |                                                                         323（84 / 237 / 2） |                       343（103 / 238 / 2） |                                   822（254 / 566 / 2） |
| 計画の km（本線 / ランプ）                                |                                                                                415.1 / 97.0 |                               458.8 / 97.3 |                                          655.8 / 220.2 |
| 本線の区内 / 区外 km                                      |                                                                                315.9 / 99.2 |                               359.2 / 99.6 |                                          333.7 / 322.2 |
| 本線の事業者 / 他社の way km                              |                                                                                403.7 / 11.4 |                               447.4 / 11.4 |                                          473.6 / 182.2 |
| 区外だけで落としたランプ                                  |                                                                             140 本・70.9 km |                            140 本・70.9 km |                                                      — |
| 出力の run                                                |                                                                                         267 |                                        299 |                                                    716 |
| 閉鎖 本線（km）                                           |                                                                                  10（39.3） |                                 14（58.6） |                                             24（49.8） |
| 閉鎖 ランプ（率）                                         |                                                                                46（19.4 %） |                               30（12.6 %） |                                           82（14.5 %） |
| 閉鎖の根 / 道連れ                                         |                                                  15 / 41 run・47.7 km（本線 5 本・35.0 km） | 17 / 27 run・59.7 km（本線 7 本・51.3 km） |             45 / 61 run・55.4 km（本線 7 本・36.5 km） |
| 最大の根                                                  |                                                             41009552（C1、39 run・47.3 km） |   28127113（本線 4.6 km、23 run・55.9 km） |                            41009552（39 run・47.3 km） |
| 親が書かれていない run / 床版の食い違い                   |                                                                                       0 / 0 |                                      0 / 0 |                                                  0 / 0 |
| 未許可の重なり（組・測点）                                |                                                                                  175・1,919 |                                 182・1,733 |                                             291・2,422 |
| 　nose / parallel-ramp / changeover / other（未許可の組） |                                                                           41 / 88 / 21 / 25 |                          37 / 93 / 24 / 28 |                                     81 / 132 / 25 / 53 |
| 検査の違反（T1〜T7・T12）                                 |                        T2 2（面の勾配 5.01 %: 45248411:23、24636451:0）、T12 1（5213545:0） |                                T2 2、T12 1 |                                            T2 3、T12 4 |
| 未許可の診断（重なり以外）                                | vertical_unsolved 15、parent_unsolved 41、tunnel_cover_short 13、crossing_layer_ambiguous 2 |                              17、27、32、2 |                                          45、61、42、2 |
| 追従 correlation（傾き）/ shortWave / 短波長 σ / 反転     |                                0.881（0.94）/ 0.390 / 1.01 m / 2.30 回/km（46 run・316 km） |       0.865（0.93）/ 0.393 / 1.00 m / 2.34 | 0.867（0.93）/ 0.372 / 0.93 m / 2.12（82 run・454 km） |
| タイル（数、生 / gzip 合計）                              |                                                                      115、3.63 MB / 1.04 MB |                     119、3.87 MB / 1.11 MB |                                 211、6.24 MB / 1.78 MB |
| タイル gzip 中央値・p90・最大                             |                                                                          7.2・19.6・34.8 KB |                         7.0・19.6・57.9 KB |                                     5.9・19.9・43.3 KB |
| meta 生 / gzip                                            |                                                 258 / 35 KB（runs 133、diagnostics 105 KB） |                                279 / 37 KB |                                            575 / 77 KB |
| 成分・最大 run・最大変数                                  |                                                                             20・271・17,744 |                            18・382・29,694 |                                       210・271・17,744 |
| 解いた回数・未収束                                        |                                                                                      106・0 |                                      83・0 |                                                 549・0 |
| 生成全体                                                  |                                                                                    約 220 s |                                   約 270 s |                                               約 270 s |

- **区外へ伸びる量**: 出荷範囲は横浜（南端 35.456°）から浦和（北端 35.885°）まで届く。run を丸ごと出荷するので、区外の上位 8 run（K1 32404414 の 15.8 km、1 号 45661183 の 15.8 km、S5・5 号・E6・S1・6 号・E4）だけで区外が約 83 km（レビューの探査 review-p271/scope.json）。他社の way は、事業者の way を含む run が他社の区間へ続いた分（京葉道路 920238368、中央道へ続く 4 号 28368866 など）で 11.4 km。逆に 23 区内の他社の本線（C3 16.9 km、E1 6.8 km、E17 7 km、E20 5 km、E83 4 km）とそこだけにぶら下がるランプは出荷しない。
- **区外だけで落としたランプ**: 事業者の本線から（区外の本線を含め）ランプでたどれるが、どの節点も区内に掛からないランプ。レビューの探査の「区外のランプ 100 本・49 km」は出荷した本線から届くものだけを数えた値で、この 140 本・70.9 km は区外の事業者の本線（神奈川の K 線など）から届くものも含む。
- **データテストとの関係**: `XW_DATA_DIR=.cache/expressway-area/ship-pruned-1` でデータテストを掛けると 11 件落ちる（T1・T2、T12、許可リストの未使用・T10、deck_overlap とその再計算 3 件、MERGE_MAX_DZ、blocked、本線の閉鎖、ランプの閉鎖 5 % 以下）。スコアカードの `violations` は checks.ts の性質（T1〜T7・T12）だけで、残りは閉鎖・重なり・診断の欄が受け持つ。

## 参考値（設計時の探査、scratchpad の p27/）との差

- **ship の計画 349 run（below 全部で 400）→ 323（343）**: 23 区の判定の差。探査は町丁 bbox を 0.005° の格子に塗った粗い判定で、ポリゴンだけの判定より 23 run・19 km 多かった。うち 2 本（汐留入口 45068172 の 9 節点すべてと、川口境の 1453841098）はポリゴンの隙間に乗っていて、30 m の近傍で拾うようにした（レビュー C1）。残りは区の外側の格子に掛かったランプ。さらに構造物の street 2 本を足した。残り約 20 run の差は探査用のパッチ版 compile と格子判定によると推定（未確認）。400 との差は「below 全部」の定義: 探査は `isBelowCompiled` の見送りも外していたが、`--below all` は pruneBelow だけを外す（ship/all の計画は 878 run・見送り 32）。
- **全域 pruned 822 run・210 成分・最大 17,744 変数・6.24 MB・閉鎖 24/82**: すべて一致。
- **pruneBelow なしの最大 382 run・29,694 変数・未収束 0**: 一致。
- **追従 相関 0.38・反転 2.1 回/km**: 設計の「相関」は、式が示されていないが、500 m 移動平均を引いた残りどうしの相関（`shortWaveCorrelation`）と**推定**する。同じ all/pruned で 0.372・2.12 回/km になる。移動平均を引かない相関は 0.867（傾き 0.93）と高く、長い波では地表に沿っている。
- **本線の閉鎖 10 本・41009552 が約 35 km を道連れ**: 一致。道連れは本線 5 本で 35.0 km、ランプを含めると 39 run・47.3 km。
- **ランプ閉鎖 17.5 %・未許可の重なり 206 組**: 母数（ランプ 237、run 323）が違うので 19.4 %・175 組。
- **既定範囲の床版は 0.79〜1.21 m 動く**: 実測では最大 3.20 m（0.79 m 以上は 8 run）。

## 後段の計画と予算（設計 Fable、要点）

- **S2 固定点 block**: 本線の静かな区間（分合流・交差から離れた所）に固定点を置き、大きい成分を block に割る。設計時の探査（p27/probe.log）の「固定点 88 点、固定点での高さの差は中央値 3 mm・p90 0.16 m・最大 1.40 m（1.5 倍で 123 点・最大 2.52 m）」は run を単独で（seam の端も自由に）解いた値との差で、実装の比べ方とは別物。**訂正（P2.7-2 の実測）**: ship/pruned で k = 1・1.5・2 の固定点は 101・78・55 点、固定点での路線解と一括解の差は p50 2〜5 cm・p90 0.16〜0.40 m・最大 2.58 m、全測点の高さの差は p99 1.1〜1.2 m・最大 3.5〜5.2 m（「P2.7-2」の節）。
- **S3 縦断目的 v2**: 地表の長い波に沿わせ、DEM の凸凹（短い波）は追わない。判定は `correlation`・`slope` を上げ、`shortWaveStdM`・`reversalsPerKm` を下げること。**更新（P2.7-3 の実測）**: 全体の値は二層の移り変わりや床版をまたぐ区間（原理的に 1 段を上り下りする）を含むので、判定は「強制の無い区間」（スコアカード版 4 の `tracking.free`）の反転 0.8 回/km・短波長相関 0.15・短波長 σ 0.4 m 以下とし、全体は下がることを報告する形にした。`correlation`・`slope` は v2 で下がる（0.884 → 0.837、傾き 0.94 → 0.89）。v2 は反転だけ届き、相関・σ は未達（下の「P2.7-3」）。
- **S4 台帳と配信形式 v6**: 許可の台帳と XW_VERSION 6（サイズの予算は配信時 gzip で 1 MB 目安。ship/pruned で 1.04 MB）。
- **S5 有効化**、**S6 網をつなぐ**（地平区間を run として通し本線の穴を埋める）、**S7 地下全面**（地下の分合流の見送りをなくす）、**R1〜R3 地区公開**。
- **合否はスコアカードで**: 本線の閉鎖 0、未収束 0、未許可の重なり 0（類型ごとに減らす）、`violations` 0、`dangling`・`deckMismatch` 0、gzip の予算。各段は `just measure-expressway-area` と `just compare-expressway-reports … --check` で前後を比べ、基準の fixture を更新する。各段の予算の細目はこの節に未記載（設計側で確定する）。

## 気づいた欠陥（直していない）

- ship/all では C1 ではなく 28127113（本線 4.6 km）が根になり 23 run・55.9 km を道連れにする。地下を足すと閉鎖の根が入れ替わる。
- ship/all の最大タイルは gzip 57.9 KB（pruned の 1.7 倍）。原因は未調査。
- 重なりの nose のうち許可済みは ship/pruned で 47 組中 6 組だけ。allowlist の NOSE の項目は組（with）ごとなので、試験区間の外のノーズには効かない。
- 未許可の `tunnel_cover_short` が ship/all で 32（pruned 13）。`crossing_layer_ambiguous` 2 件はどの構成でも未許可のまま残る。

# P2.7-2: 固定点 block（既定は無効、2026-11-11）

P2.7 の第 2 段階（S2）。run を本線の静かな区間の固定点で「片」に切り、片の連結成分（block）ごとに今の solveShedding を回す `--partition blocks` を計測専用で足した。既定（`components`）ではデータと解は 1 バイトも変えない。S1 のスコアカードで一括解（joint）と k = 1・1.5・2 を比べた結果、**pruned と all の両方で同等性を満たす k は無く、未達**（all で本線の閉鎖 14 → 18）。`BLOCK_QUIET_FACTOR` はレビュー（Fable、Changes Requested 小）の推奨で暫定 1.5（理由は「採った k と理由」）。[^p272]

## 作ったもの

| 項目              | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 固定点の位置      | `src/expressway/blocks.ts anchorsOf`（純粋、pruneBelow 後の計画だけ。DEM・地上道路・範囲を使わない）。cls が expressway の run（below 含む）にだけ置く。騒がしい点（run の両端、他 run が分合流・seam で取り付く点、plan.crossings・plan.pairs の自分の測点、構造物の p0〜p1 の範囲全体、below run の中の坑口、zones の境）の間が 2Q 以上なら、両側 Q を除いた区間の中央、それが `BLOCK_ANCHOR_SPACING` を超えるなら超えない等分点に置き、最寄りの平面線形の標本へ寄せる。Q = max(`BLOCK_QUIET_MIN`, k × approachLength(planV))、k < 1 は止める                                                                                                                                                                                                                                                         |
| 片の計画          | `partitionOf`: 計画を片の計画（`Plan` の runs が片）に写す。片の RunPlan は親の切り出し（align 共有、i0・i1 が部分範囲、zones は切って平行移動、wayAt などは subarray、over は p0〜p1 を含む片だけ距離をずらす）。固定点の無い run は元の RunPlan そのもの（固定点 0 なら片の計画 = 元の計画）。片 ID は `<run>#<k>`。片の端は元の endPlan から写して `Plan.ends` に持たせ（親は取付き点を含む片に、固定点の端は新しい種類 `anchor`）、endPlan は ends があればそれを返す。crossings・pairs は run 距離から片と片内距離へ写す（findCrossings・classifyPairs はやり直さない）。block は片の計画に groupComponents を掛けたもの。`plan.needed` は「必要な block に片を持つ run」と「その中の固定点つき run の seam の組（路線解に要る run）」の和                                                         |
| 路線解            | `compile.ts solveRoute`: 固定点つき run と seam でつながる run の組の片を、seam と「後の片の始点が前の片の終点に従う硬い junction」だけでつないで solveJoint に 1 回（段は standard、自分の床・法令の交差・地表端・構造物の固定は入れ、他 run との分合流・交差・重なりは入れない）。固定点の値は finish 後の前の片の終点の (z, 勾配)、倍精度のまま。片勾配は 2 回の banksOf（1 回目で前の片の終点の値を取り、2 回目は block と同じく両側をその値に固定）。未収束なら `RouteUnsolvedError` で止める                                                                                                                                                                                                                                                                                                      |
| block の解        | `solveBlocks`: run ごとに setupRun を 1 回（診断は 1 回・id 順。路線解だけに要る run の診断は出さない）、片の setup はそれを切り出す（片の中の測点を平行移動し、固定点の端に測点を 1 つ足す。目標は補間、床と天井の行は無し）。固定点の端は z を硬い等式、勾配を W_PIN の重い二乗で引き（下の落とし穴 1）、finish が両側を同じ値に置く。必要な block を ID 昇順に既存の solveShedding（`setupsOf`・`anchorBanks` を足しただけ）で解く。最初の QP の変数が `BLOCK_MAX_VARIABLES` 20,000 を超えたら `BlockTooLargeError`（block ID と run）                                                                                                                                                                                                                                                               |
| 閉鎖・縫い合わせ  | 閉鎖は run 単位: 片が 1 つでも解けなければ vertical_unsolved 1 件（各片の試行の前に `[a–b m]`）、片が親を失えば parent_unsolved、子は solvePlan 末尾の連鎖。全片が解けた run は `stitch`（縦断は片の並び `Solved.pieces`、zones は同じ V なら 1 つに、片勾配は固定点の標本を 1 つだけ残して連結、段は最も進んだ片のもの、端は片の端から親の run と run 距離へ戻す）。evalProfile を直接呼んでいた所は `evalRun`（片が 1 つなら今と同じ浮動小数の計算）。chunkRun は固定点で切らない（両側で特例か否かが違うときだけ切る）、固定点に測点を置く、vh は掛かる片の最小                                                                                                                                                                                                                                      |
| 他 run の高さ     | 子の連鎖は run 単位（どこかで閉鎖なら null）、交差の記録と橋脚の床版判定は **その点を含む片がその block で解けたか**だけで引く（`blockHeightAt`）。run 単位で引いた版は実データの T8 で 2 チャンクの `cross` が範囲で違った（下の落とし穴 3）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| block ハッシュ    | `CompileResult.partition.blocks` に block ごとの片・run・最初の QP の変数・正準な文字列（片 ID 昇順に範囲・節点間隔・z と勾配の JSON・段、解けなかった片はその旨）。SHA-256 は scripts 側。components でも成分 = block として出す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CLI・スコアカード | `scripts/expressway.ts --partition components\|blocks`（既定 components）と `--quiet-factor <k>`。blocks は `--out` が無ければ止まる。report 版 3 に `partition`（モード、k、Q の下限、固定点の数と一覧〔run・距離・Q・z・勾配・両側の block〕、片、必要な block、最大 block、路線解の回数、路線解の問題が Q 以内の固定点、固定点の段差 `joins`、block の一覧とハッシュ）。版 2 の report も読める。`compareExpresswayReports.ts` は固定点を `run@s`、block を id で並べ、ハッシュを「変わった block の数と ID」の 1 行に（`flattenReport`・`blockChanges` は report.ts に移した）。`scripts/compareExpresswayHeights.ts`（`just compare-expressway-heights a b`）は b の測点を a のエルミート面と比べ、\|Δz\| の分布を固定点 ±Q とそれ以外に分けて 1 行の JSON ログ（`expressway_heights_compared`）に |
| ログ              | `expressway_blocks_planned`・`expressway_heights_compared` を logEvents.ts に登録。`expressway_reports_compared` に blocksChanged・Added・Removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 仮定              | `BLOCK_QUIET_FACTOR`（k、暫定 1.5）・`BLOCK_QUIET_MIN`（300 m）・`BLOCK_ANCHOR_SPACING`（3,000 m）を assumptions.ts に（verified: false）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 不変条件とテスト

`tests/expresswayBlocks.test.ts`（合成網）: 位置（騒がしい点から Q、2Q 未満には置かない、長い区間は 3 km 以下、構造物の固定範囲・坑口から Q、ランプ・短い run には無し、k を上げると減る、k < 1 は止める、範囲と入力の順序に依らない）、I1（固定点 0 の blocks が components とバイト一致）、I2（結合の無い 8 km の 1 本を 3 片に切った解が路線解と z 1 mm・勾配 1e-5・片勾配 1e-4 以内。タイルの丸めの半分を足して比べる）、I3（固定点の段差が z 1e-9・勾配 1e-12・片勾配 0、固定点に測点、チャンク ID と境界が一括解と同じ）、I4（片方の JCT のランプの下だけに道路を足すと、その block のハッシュだけが変わり、もう一方の block とそのランプのチャンクは同値。**限界**: 固定点つき本線の入力（本線の下の道路）を変えると路線解が変わり、固定点の値が 1e-12 m 動くだけで全 block の正準文字列が変わる。チャンクのバイトが変わるのは近くの 2 個だけ〔レビューの probe A・E〕。I4 は固定点つき本線の入力には成り立たない）、I5（範囲を変えて共有チャンクが同値）、I6、I7（上限 50 でエラー、block と run が文面に）、閉鎖（中央の片が 300 m の地表の突起で解けない本線は vertical_unsolved 1 件、子は parent_unsolved、交差する高架は解けたまま）、漏れ（チャンク・run の要約・閉鎖・診断に `#` の ID が無い。閉鎖のテストと、交差の桁下が足りない片の試行の文面にも掛け、試行の「at N m」が run 距離であることも）。レビュー対応で足したもの: 曲線の本線（R = 300 m の S 字、片勾配が 0 でない所で固定点の両側の片勾配が一致し、路線解と 1e-4 以内。anchorBanks を外すと落ちる）、block をまたぐ閉鎖（最後の片が解けない本線の先頭の片にぶら下がるランプが parent_unsolved。failed.add を外すと落ちる）、交差の記録（閉鎖された本線の解けた片の上の高架は、どの範囲でも同じ cross。blockHeightAt を heightAt にすると落ちる）、seam の組の路線解（トンネルを固定点で切り、片側の高架だけの範囲でも反対側の高架が必要 run に入り、チャンクが全体と同値、その高架の setup の診断は出さない）、段は最も進んだ片から、速度の区間の境から Q、長いランプに固定点無し。変異テスト（レビューの mutate.py）で縛れていないもの: 固定点の z を硬い等式でなく W_END にする・路線解の硬い junction を軟らかくする（finish が端を固定点の値に置くので出力に出ない）、固定点の節点の上限の行を戻す、vh を最初の片から取る（片で節点間隔が違う合成網を作っていない）、追加の測点の目標を補間しない。`tests/expresswayReport.test.ts` に版 3 と版 2 の比較・ハッシュの要約。

## 計測（trust signal、2026-11-11 UTC、M2 Max。4〜5 本並列で実行したので時間は単独より長い）

- **I1（無効時の不変）**: 最終のコードで `just make-expressway-data` の後 `git status public/data/expressway` は差分なし（09:11Z）。`--out` つきの既定範囲 components（default-pruned-joint、08:50Z）も既定データと全測点で \|Δz\| 0。ship/pruned の components（ship-pruned-joint 08:17Z、作り直した基準 ship-pruned-baseline 09:08Z）を作り直す前の基準 fixture と `compare-expressway-reports` で比べ、changed 0・removed 0・added 71（すべて `partition.*`）、範囲の run の増減 0。
- **I6**: ship/all・k = 1.5 を 2 回（ship-all-k1.5 08:58Z、ship-all-k1.5b 09:07Z）。タイル・meta・LICENSE が `diff -r` で一致、report は `--check` で終了コード 0（時間とラベル以外一致、block ハッシュ 0 changed）。
- **実データの T8**: 既定範囲の blocks（all・k=2）の 268 チャンクが ship/all・k=2 の同じ run のチャンクとすべて同値（pruned も 269 チャンク同値、サインと posted を除いて比較）。レビュー対応後の k=1.5（09:50Z）でも all・pruned とも 268 チャンク同値。片 ID の漏れは ship blocks 6 構成の meta.json で 0（最初の版は `clearance over 45661183#2` のように試行の文面に出ていた、レビュー W1）。レビュー対応後に ship/pruned の components を作り直し、基準 fixture と `--check` で一致（09:47Z）。
- **A/B（ship、8 本 + 2 回目 1 本）**: 同じ below の joint と比べた。joint は 08:17Z（pruned）・08:31Z（all）、blocks は落とし穴 3 の修正後に 08:56〜09:07Z に作り直した。

| 項目                                              |         pruned joint |        pruned k=1 |      pruned k=1.5 |         pruned k=2 |            all joint |                          all k=1 |          all k=1.5 |            all k=2 |
| ------------------------------------------------- | -------------------: | ----------------: | ----------------: | -----------------: | -------------------: | -------------------------------: | -----------------: | -----------------: |
| 固定点 / 必要な block / 片                        |         0 / 20 / 491 |    101 / 58 / 547 |     78 / 49 / 539 |      55 / 40 / 519 |         0 / 18 / 546 |                   117 / 59 / 588 |      96 / 50 / 583 |      69 / 41 / 561 |
| 必要 run（plan.needed）                           |                  491 |               472 |               478 |                479 |                  546 |                              506 |                512 |                513 |
| 最大 block（run / 片 / 変数）                     |   271 / 271 / 17,744 | 117 / 121 / 7,280 | 135 / 140 / 8,198 | 236 / 246 / 15,134 |   382 / 382 / 29,694 |                140 / 147 / 8,586 | 185 / 193 / 11,144 | 244 / 254 / 15,560 |
| 解いた回数・未収束・路線解（問題が Q 以内）       |            106・0・— |   223・0・40（0） |   200・0・37（0） |    154・0・28（3） |             83・0・— |                  217・0・43（0） |    193・0・41（0） |    152・0・32（3） |
| 閉鎖 本線（km）/ ランプ                           |       10（39.3）/ 46 |           10 / 46 |           10 / 46 |            10 / 46 |       14（58.6）/ 30 |               **18（87.6）/ 55** |        **18 / 55** |        **18 / 55** |
| 根 / 道連れ                                       | 15 / 41 run・47.7 km |         同じ根 15 |         同じ根 15 |          同じ根 15 | 17 / 27 run・59.7 km | 18（+41009552）/ 55 run・94.4 km |               同左 |               同左 |
| 未許可の重なり（組・測点）                        |           175・1,919 |        175・1,919 |        176・1,914 |         176・1,916 |           182・1,733 |                       168・1,587 |         169・1,582 |         168・1,586 |
| 　nose / parallel-ramp / changeover / other（組） |    41 / 88 / 21 / 25 | 40 / 88 / 22 / 25 | 41 / 88 / 22 / 25 |  41 / 88 / 22 / 25 |    37 / 93 / 24 / 28 |                42 / 79 / 21 / 26 |  43 / 79 / 21 / 26 |  43 / 79 / 21 / 25 |
| violations                                        |          T2 2・T12 1 |                同 |                同 |    **T2 3**・T12 1 |          T2 2・T12 1 |                               同 |                 同 |    **T2 3**・T12 1 |
| dangling / deckMismatch                           |                0 / 0 |             0 / 0 |             0 / 0 |              0 / 0 |                0 / 0 |                            0 / 0 |              0 / 0 |              0 / 0 |
| vertical_fallback                                 |                  185 |               184 |               184 |                184 |                  199 |                              177 |                177 |                177 |
| 反転（回/km）/ 短波長 σ（m）                      |      2.2965 / 1.0067 |   2.3249 / 1.0001 |   2.3186 / 0.9948 |    2.2648 / 0.9929 |      2.3382 / 1.0001 |                  2.3526 / 1.0011 |    2.3458 / 0.9954 |    2.2877 / 0.9932 |
| qpMs / 解く段（s、並列）                          |              63 / 87 |           59 / 91 |           64 / 97 |           81 / 110 |            108 / 143 |                         66 / 104 |           72 / 102 |            68 / 95 |

固定点の段差（`joins`）は全構成で z ≤ 5e-14 m・勾配 ≤ 1e-16・片勾配 0（I3）。

**同等性の判定**（同じ below の joint に対して、閾値は指示のまま）:

| 項目                                            | pruned k=1            | k=1.5                 | k=2             | all k=1               | k=1.5                 | k=2             |
| ----------------------------------------------- | --------------------- | --------------------- | --------------- | --------------------- | --------------------- | --------------- |
| 未収束 0・路線解の未収束 0・最大 block ≤ 20,000 | 可                    | 可                    | 可              | 可                    | 可                    | 可              |
| 本線の閉鎖が増えない                            | 可                    | 可                    | 可              | **否（14 → 18）**     | **否**                | **否**          |
| ランプの閉鎖 +2 以内                            | 可（±0）              | 可                    | 可              | **否（+25）**         | **否**                | **否**          |
| 根 +2 以内                                      | 可（同一）            | 可                    | 可              | 可（+1: 41009552）    | 可                    | 可              |
| 未許可の重なり 組・測点 ×1.05 以内              | 可                    | 可                    | 可              | 可（減）              | 可                    | 可              |
| violations が増えない、dangling・deckMismatch 0 | 可                    | 可                    | **否（T2 +1）** | 可                    | 可                    | **否（T2 +1）** |
| vertical_fallback ×1.05 以内                    | 可                    | 可                    | 可              | 可                    | 可                    | 可              |
| 反転 +0.05・短波長 σ +0.02 m 以内               | 可（+0.028 / −0.007） | 可（+0.022 / −0.012） | 可              | 可（+0.014 / +0.001） | 可（+0.008 / −0.005） | 可              |

- **all の閉鎖が増える理由**（レビュー W3 で訂正）: 41009552（C1 内回り）が根に戻る。41009552 は s 0〜415 m で 668292569 の下を通る。ship/all の joint では 668292569 が全 14 チャンク V40 になり、その setup の「road 43898326 at 98 m cannot be cleared」が消え、41009552 は specialGrade>lowerSpeed>assumedGive・V40 で解ける。ship/pruned の joint と ship/all の blocks（k=2 で確認）では 668292569 が V60/V50/V40 の区間に分かれ、その診断が残り、41009552 は 0.16 m 足りない。どちらにも固定点は無い。譲ったのは直上の床版の V 下げの窓で、~~382 run の成分でだけ 668292569 の窓が全域 V40 まで進んだ引き金は未特定~~ **訂正（P2.7-3a の実測）**: 引き金は solveShedding の 2 回目のパスが段だけを引き継ぎ窓を引き継がないこと（382 run の成分は run を 3 本外して 2 回目のパスを走らせ、41009552・668292569 とも lowerSpeed の段のまま窓が空で始まって全線 V40・節点間隔 35 m になった。271 run の成分は 1 回で終わるので起きない）。下の「P2.7-3a」。試行が ship/pruned の joint と 1 文字違わないのは k=2 だけで、k=1・1.5 は試行が 9 回から 8 回になる。最初の版で書いた「離れた run の譲り合いが固定点で切れた」は計測と合わないので撤回する。道連れ 28 run（本線 4 本）が増える。~~候補（未検証）: solveComponent の partnersOf は交差の相手の床版を返すが、41009552 の不足は自分の下の道路（setup の床）なので上の床版（668292569）の段を下げる経路が無い。上の床版も段を下げる相手に入れるのが 41009552 の直し方の候補。~~ **訂正（P2.7-3a）**: 上の床版だけを全線 V40 にしても 41009552 は 0.20 m 足りず、この候補では解けない。原因は同じ場所へ降りる 2 本に求めた 1 段離しの軟らかい行で、その行を外して解いた（下の「P2.7-3a」）。
- **k=2 の T2 +1**: 780870438:7 の面の勾配 −5.03 %（固定点の無い run、段は standard のまま）。既存の 5.01 % 2 件と同じ、測点間のエルミートの行き過ぎ。block で解が変わった副作用。
- **高さの差**（`just compare-expressway-heights <joint> <blocks>`、\|Δz\| p50 / p90 / p99 / 最大、m）:

| 構成         | 全測点                        | 固定点 ±Q                     | それ以外                      |
| ------------ | ----------------------------- | ----------------------------- | ----------------------------- |
| pruned k=1   | 0.007 / 0.295 / 1.241 / 5.197 | 0.040 / 0.409 / 1.300 / 3.247 | 0.005 / 0.281 / 1.234 / 5.197 |
| pruned k=1.5 | 0.005 / 0.248 / 1.243 / 5.197 | 0.024 / 0.377 / 1.342 / 3.247 | 0.004 / 0.236 / 1.233 / 5.197 |
| pruned k=2   | 0.001 / 0.102 / 1.117 / 3.509 | 0.013 / 0.265 / 0.974 / 1.358 | 0.000 / 0.093 / 1.126 / 3.509 |
| all k=1      | 0.034 / 0.630 / 2.268 / 5.303 | 0.043 / 0.414 / 1.317 / 3.815 | 0.033 / 0.652 / 2.282 / 5.303 |
| all k=1.5    | 0.028 / 0.597 / 2.250 / 5.303 | 0.027 / 0.379 / 1.601 / 3.815 | 0.028 / 0.616 / 2.262 / 5.303 |
| all k=2      | 0.014 / 0.548 / 2.182 / 5.359 | 0.015 / 0.280 / 1.077 / 1.512 | 0.014 / 0.569 / 2.232 / 5.359 |

どの構成も p99 1 m 超・最大 2 m 超。上位 10 run の原因（`.qa/expressway/why.py` で段と V、固定点を突き合わせ）: (a) **段の違い**: 1467911980（最大 5.20 m）・45661183・888066413 などは一括解では lowerSpeed の窓が run 全体（V40）に広がり、blocks では片ごとの窓で他の片が V60/80 のまま。ランプ 79449031・687744436・4854235・26956960 なども親の V が変わって動く。(b) **路線解と一括解の差**: 固定点での路線解の値と一括解の高さの差は p50 2〜5 cm・p90 0.16〜0.40 m・最大 2.58 m（45021972@5776、k=2 では最大 0.52 m）。45021972（3.25 m、固定点の脇）と 888066413（2.05 m）がこれ。(c) **block の切り方**: 28368866・27155261（段は両方 standard、固定点から 1.3〜2.6 km 離れた所で 3.5 m）は、一括解で同じ成分の他の run から伝わっていた譲り合いが block で切れたもの。k を上げると固定点の近くは小さくなる（±Q の最大 3.25 → 1.36 m）が、それ以外の最大は減らない。

- **既定範囲**（`--out`、4 本並列。joint 08:50〜08:52Z、blocks k=2 09:06Z、レビュー対応後の k=1.5 09:50Z）:

| 項目                                          |      pruned joint |                   pruned k=1.5 |                     pruned k=2 |                     all joint |                      all k=1.5 |                        all k=2 |
| --------------------------------------------- | ----------------: | -----------------------------: | -----------------------------: | ----------------------------: | -----------------------------: | -----------------------------: |
| 必要 run                                      |                57 |                             57 |                             57 |                           382 |                             66 |                             66 |
| 解いた回数（block）/ 最大 run・変数           | 8（1）/ 57・3,658 |             17（3）/ 48・3,040 |             13（2）/ 48・3,040 |          11（1）/ 382・29,694 |             12（2）/ 61・3,868 |              8（1）/ 65・4,158 |
| 固定点 / 路線解                               |             0 / 0 |                          4 / 2 |                          2 / 2 |                         0 / 0 |                         14 / 4 |                         12 / 4 |
| qpMs / 解く段（s）                            |       10.4 / 11.5 |                      7.7 / 8.6 |                    10.0 / 11.2 |                 106.7 / 130.6 |                      7.7 / 9.4 |                    10.8 / 13.1 |
| 既定データからの \|Δz\| p90 / p99 / 最大（m） |         0 / 0 / 0 | 0.28 / 1.74 / 3.25（45021972） | 0.27 / 1.67 / 3.17（45021972） | 0.27 / 1.27 / 3.20（4848755） | 0.30 / 1.80 / 3.25（45021972） | 0.32 / 1.71 / 3.20（45021972） |

all の解く段は blocks で約 1/10〜1/14（130.6 → 9.4〜13.1 s）、必要 run は 382 → 66。all の 4848755 の 3.20 m は blocks ではほぼ消える（上位 10 に無く 0.002 m 以下、k=2 で確認）。代わりに pruned でも blocks だけで既定の床版が最大 3.17 m（45021972）・2.02 m（4848762）動く（固定点の路線解の値と、閉鎖のない既定範囲の一括解との差）。

## 採った k と理由

pruned では k = 1・1.5 がすべての項目を満たし（k = 2 は T2 +1 で否）、all ではどの k も本線・ランプの閉鎖で否（41009552 による、k によらず同じ）。両方を満たす k は無いので **未達**。外れ: all で本線の閉鎖 +4（58.6 → 87.6 km）、ランプ +25、k=2 は T2 +1（pruned・all とも）。最初の版は指示どおり 2 にしたが、レビューの推奨で **暫定 1.5** にした: pruned で全項目可、all の否は k によらない、k=2 は両方で T2 +1・最大 block がほとんど割れない（15,134〜15,560 変数）・qpMs が悪い、k=1 は Q が下限 300 m に張り付き余裕が無い。**最終決定は 41009552 を直し S3 を入れた後の A/B で**。**更新（P2.7-3 の実測）**: v2 で A/B をやり直すと pruned は k = 1・1.5・2 とも全項目可、all は 3 つの k とも T2 0 → 3（28127108 の 1 か所、5.01 %）で否。両方を満たす k は無く、暫定 1.5 のまま未達（下の「P2.7-3」の「blocks の A/B のやり直し」）。

**次の手の順序**: (1) 41009552 を先に直す（**完了、P2.7-3a**。直し方は上の候補ではなく窓の引き継ぎと 1 段離しの行の除外）→ (2) S3（縦断目的 v2）→ (3) A/B を 1 回やり直して k を決める。隣接 2 block を一緒に解いて固定点の値を取り直す 2 段解は今はやらない。S2 の利得が出るのは `--below all` の既定範囲（必要 run 382 → 66、解く段 130.6 → 13.1 s）で、S5（有効化）・S7（地下全面）以降。

## 落とし穴

1. **固定点の端を z・勾配とも硬い等式にすると内点法が壊れる**: 1 回目の実装では ship/pruned で 23 run が vertical_unsolved・parent_unsolved（レインボーブリッジの 45019020 が親を失いビルドが止まった）。原因は block の最初の QP の NaN（「solve 1 broken after 35 iterations」）。(a) 路線解の値は finish 後の値なので GRADE_MARGIN（0.995）を僅かに超えることがあり、勾配の上限の硬い行と矛盾する → 固定点の節点の上限の行を外した。(b) それでも 195 回中 1 回（26 run の block、特例の段）が NaN。QP を保存して試すと、勾配の硬い行を L1 の重い行（1e5）にしても壊れ、二乗（W_PIN）なら 31 回で収束、z だけ硬い等式でも収束。勾配は W_PIN の二乗にし、finish が節点の勾配を固定点の値に置くので C¹ は保たれる（I3 の勾配の段差 ≤ 1e-16）。
2. 片の端の親を endPlan に探させない（chainRuns を `from <= idx <= to` で引くので片を取り違える）。`Plan.ends` に写して持たせた。
3. **他 run の高さを run 単位で引くと T8 が崩れる**: 交差の記録を「run が閉鎖でなければ片から」で引くと、別の block（他の範囲では解かない）の片が解けずに閉鎖になった下の run について、既定範囲では記録し、ship では記録しない（実データの T8 で 45021972:17・45554540:16 の `cross` が違った）。交差・橋脚は片の block だけで引くようにした。子の連鎖は run 単位のまま（下の欠陥 1）。
4. setupRun は run で 1 回にして片はそれを切り出す（低い端の床・登り区間・±60 m の目標平均は run のもの）。piece ごとに setup を作ると固定点が低い端に見える。

## 4.4 の但し書きに当たる事象

block の解が路線解の端条件に対して実行不可能になったのは落とし穴 1 の NaN（硬い等式どうしの矛盾）で、勾配を二乗にした後は 0。路線解の未収束 0。最終の全構成で block の未収束 0、`solver_not_converged` 0。路線解の問題が固定点の Q 以内にあるのは k=2 の 3 点（pruned・all）で、外していない。

## 気づいた欠陥（直していない）

1. **子の閉鎖と交差の記録が範囲で変わる（レビュー W2、S5 の前提）**: 子の parent_unsolved は run 単位の閉鎖で決まる。親が範囲外の run で、その別の片（その範囲では解かない block）が解けないとき、その範囲では子が残り、親を含む範囲では閉鎖される（合成網のテスト「known limit」が今の振る舞いを示す。一括解ではどちらでも閉鎖）。また `blockHeightAt` は閉鎖された run の解けた片の上にも cross を記録する。今回の実データでは起きていない（実データの T8 は一致）。計測専用なので直していない。有効化（S5）の前に、親の連鎖と交差の下の run は全片を必要 block に含める（案）。
2. **I4 は固定点つき本線の入力に成り立たない（レビュー W4）**: 路線解の入力（本線の下の道路など）が変わると固定点の値が 1e-12 m 単位で動き、その run の全 block の正準文字列（倍精度の JSON）が変わる。チャンクのバイトで変わるのは近くの数個だけ。S5 までに、固定点の値を丸めて持つか、ハッシュを丸めた値から作るかを決める。
3. ship は run を丸ごと出すので、必要 run は 491 → 472〜479（pruned）にしか減らない。区外で block を切っても run が丸ごと要るため。既定範囲の all（382 → 66）のような効果は ship には無い。
4. ~~joint の lowerSpeed の窓が run 全体に広がる（1467911980 は V40 一色）のは blocks の方が局所的で、高さの差の最大の原因はこちら。どちらが正しいかは別途。~~ **訂正（P2.7-3a）**: 一括解の側の不具合だった（2 回目以降のパスと戻す解が窓を引き継がない）。窓を引き継ぐと 1467911980 は V40 が 480 m・V60 が 8,710 m になる（P2.6 の方針 (c) のとおり局所）。

# P2.7-3a: 41009552 の閉鎖を解く（2026-11-11）

P2.7-2 で ship/all の本線の閉鎖が 14 → 18 になった根 41009552（都心環状線、2.88 km、道連れ 39 run・47.3 km）を、偶然ではなく原因から解いた。引き金と原因は設計（Fable）の試作で特定され、本実装で測り直した。レビュー（Fable、Changes Requested）の C1（実際の立体交差の足元の行まで外していた）を直した版の数値。[^p273a]

## 引き金: 2 回目以降のパスが V 下げの窓を引き継がない

- `solveComponent` は段（level）と V を下げる範囲の窓（`windows`）を持つが、`solveShedding` は次のパスと「外したランプを戻す」解に段だけを渡していた。窓が空のまま lowerSpeed の段にいる run は `capZones(zones, cap, undefined)` で **run 全体**が下げた速度になり、最高速度が変わるので節点間隔も変わる。P2.6 の方針 (c)「V 下げは失敗位置の ±150 m だけ」は、複数パスになる成分では守られていなかった。
- 設計の試作のパスの記録（ship/all、382 run の成分）: 1 回目のパスで 41009552 は窓 [0, 160]・節点間隔 40.56 m で「130 m で桁下 0.16 m 不足」。run を 3 本外した 2 回目のパスは段 3（specialGrade>lowerSpeed>assumedGive）のまま窓が空で始まり、全線 V40・節点間隔 35.12 m になって解けた（668292569 も 50.55 → 35.14 m）。ship/pruned の 271 run の成分は 1 回のパスで終わるので起きない。P2.7-2 の「all で一括解と blocks が食い違う」はこの偶然による。
- 直し方: `ComponentResult.windows`（採用した状態の窓、段と同じ扱い）を足し、`solveShedding` は次のパスと戻す解に段と窓を一緒に渡す（`solveBlocks` も同じ solveShedding を通る）。同じ区間の窓は 1 回だけ積む（`capZones` の結果は変わらない。テストあり）。戻す解で前の解に固定する run は、節点数が合わないと今までは黙って普通に解き直されていた（vertical.ts の `isPinnable`）。今は `PinMismatchError` でビルドを止める。**修正前のコードにこの検査だけを足して既定範囲と ship/all を生成したところ（10:57Z・11:01Z）、一度も鳴らなかった**（黙って外れていた run は無い）。

## 原因: 同じ場所へ降りる 2 本に「1 段離し」を求めていた

- 41009552（下、layer の低い側）と 668292569（上）は都心環状線の上下線で、どちらも 2.88 km、両端が地表端。低い側の端（地表 T.P. 3.4〜3.6 m）では 41009552 の始点と 668292569 の終点が同じ場所で地表に降りる（端の標高 3.56 m と 3.59 m）。OSM の layer が違うので s 0〜415 m の重なりは「1 段（6.7 m）離す」組になるが、上の床版は終点へ −10 % 近くで降りており、端の近くで 1 段離すことは幾何学的にできない。
- その軟らかい行（約 29 測点分）が束になって下の床版を端の近くで押さえ（s 15 m で DEM より 0.37 m 低い）、s 138 m の地上道路（天端 3.4 m、必要 10.13 m）を越える登りが足りなくなっていた。全線 V40・節点間隔 35 m では 0.29 m の余裕で越え、窓 [0, 160]・40.56 m では 0.16 m 足りない。紙一重だった。
- 直し方（`markSharedTouchdowns`、計画だけで決める。DEM・範囲・解を使わないので T8 を保つ）: 床版の重なりの測点の組で、(1) 関係が above / below、(2) 2 本とも cls が expressway、(3) その 2 本の順序のある交差（`plan.crossings`）の足元ではない（`classifyPairs` が交差の順序を当てる窓 `crossingReach` = min(60, 車線域の半幅の和 / max(sin, 0.2)) + 10 m の外）、(4) 2 本とも、その測点から自分の run に沿って `approachLength(planV)` 以内に自分の地表端（endPlan の kind が ground で、坑口 `into` でも below run 自身の端でもないもの）がある、(5) その 2 つの地表端どうしが `SHARED_TOUCHDOWN`（60 m、assumptions.ts、verified: false）以内、をすべて満たすものに `untied` の印を付け、`couplingsOf` はその組の行を作らない。組と関係は残す（チャンクの `decks`、`deck_overlap` の診断、実行時は不変）。blocks.ts の `mapPair` は印を片の組へそのまま写す。同一面にもしない（端より手前では実際に高さが離れていく）。
- **訂正（レビュー C1）**: 最初の版には (3) が無く、同じ場所へ降りる本線どうしが端から登坂長の内側で本当に立体交差する所の行まで外していた。668292569 の始点と 955398790 の終点は 6.9 m で条件を満たし、端から約 143 m 先で実際に交差する（668292569 が上、sUpper 143.4・sLower 626.2、sinAngle 0.40）。最初の版では 955398790 の s 630〜647 m で離隔 5.16〜6.41 m（桁下 2.96〜4.21 m）、668292569 側の s 125・135 m で 5.31・6.05 m と建築限界を割っていた（計 6 測点）。955398790 が 1.94 m 動いたのは、行が外れて上の床版に**近づいた**ためで、最初に書いた「上下が離れた」は逆だった。(3) を足した版で足元の離隔は 7.03〜9.45 m（レビューの ov.mts で確認）。
- **設計からの逸脱 1 点**: 印は指示の `classifyPairs` の中ではなく、`pruneBelow` の直後に付ける。`endPlan` は `chainRuns` を読み、pruneBelow が見送った below run の先の端は ground に変わるので、解が見る端で判定するため（合成網のテストで、順序を逆にすると落ちることを確かめた）。
- 外した組の数は `expressway_planned` の `untiedStations`（計画全体の測点の組）・`untiedStationsNeeded`（必要な run の中）と、スコアカードの `plan.untied`（測点の組の数と、run の組・成分ごとの内訳。任意の欄で版は上げない）に出す。

## 計測（trust signal、2026-11-11 UTC、M2 Max）

ラベルは `.qa/expressway/` と `.cache/expressway-area/`。M（origin/main d00bf35 のまま）は 2 本並列で 10:55〜10:56Z、A（4.1 の窓の引き継ぎだけ、scratchpad の複製で印を付けない版）は 6 本並列で 11:02〜11:05Z、AB（4.1 + 4.2、レビュー C1 の修正後、`ab2-*`）は 5 本並列で 12:22〜12:24Z に終了。M の ship/pruned は基準 fixture と `compare-expressway-reports` で changed 0。

| 項目                                                 |                    M pruned |              A pruned |                 AB pruned |                       M all |                 A all |                AB all |
| ---------------------------------------------------- | --------------------------: | --------------------: | ------------------------: | --------------------------: | --------------------: | --------------------: |
| 閉鎖 本線（km）/ ランプ                              |              10（39.3）/ 46 |        10（39.3）/ 46 |          **4（1.4）/ 12** |              14（58.6）/ 30 |    **18（87.6）/ 55** |    **14（58.6）/ 30** |
| 根 / 道連れ                                          |        15 / 41 run・47.7 km |         15 / 41・47.7 |   **14 / 2 run・0.42 km** |               17 / 27・59.7 |         18 / 55・94.4 |         17 / 27・59.7 |
| 最大の根                                             | 41009552（39 run・47.3 km） |              41009552 | 27536961（ランプ、1 run） | 28127113（23 run・55.9 km） |              41009552 |              28127113 |
| 41009552                                             |                          根 |                    根 |        **出力・根でない** |     出力（全線 V40 の偶然） |                    根 |    **出力・根でない** |
| 出力の run（本線 / ランプ）                          |                    74 / 191 |              74 / 191 |                  80 / 225 |                    89 / 208 |              85 / 183 |              89 / 208 |
| 未許可の重なり 全体（組・測点）                      |                  175・1,919 |            178・1,925 |                213・2,203 |                  182・1,733 |            169・1,594 |            195・1,821 |
| 　nose / parallel-ramp / changeover / other          |           41 / 88 / 21 / 25 |     43 / 88 / 21 / 26 |        50 / 107 / 25 / 31 |           37 / 93 / 24 / 28 |     44 / 79 / 20 / 26 |     48 / 94 / 22 / 31 |
| 未許可の重なり A と AB の両方で出力された run どうし |                           — |            178・1,925 |                177・1,923 |                           — |            169・1,594 |            168・1,592 |
| violations（全体、両方で出力の run も同じ）          |                 T2 2・T12 1 |                    同 |                        同 |                 T2 2・T12 1 |                    同 |                    同 |
| vertical_fallback（全体 / 両方で出力の run）         |                   272 / 185 |             272 / 185 |                 302 / 185 |                   296 / 199 |             275 / 178 |             296 / 178 |
| 追従 correlation / 短波長 σ / 反転                   |       0.881 / 1.007 / 2.297 | 0.877 / 1.003 / 2.243 |     0.884 / 0.998 / 2.242 |       0.865 / 1.000 / 2.338 | 0.868 / 1.003 / 2.264 | 0.858 / 0.993 / 2.257 |
| 未収束 / dangling / deckMismatch                     |                   0 / 0 / 0 |             0 / 0 / 0 |                 0 / 0 / 0 |                   0 / 0 / 0 |             0 / 0 / 0 |             0 / 0 / 0 |
| 解いた回数・qpMs / 解く段（s）                       |           106・72.7 / 100.7 |     106・82.9 / 115.6 |          106・64.1 / 89.4 |           83・124.9 / 165.7 |     85・134.1 / 174.6 |     85・101.8 / 136.4 |
| 外した測点の組（`plan.untied`）                      |                           — |                     0 |                       131 |                           — |                     0 |                   131 |

- **A（窓の引き継ぎ）**: 既定範囲（`--out`）は既定データと全ファイルがバイト一致（`diff -r`）。ship/all は試作の見込みどおり 41009552 が 2 回目のパスでも解けず、閉鎖 18 / 55・根 18 になった（P2.7-2 の blocks と同じ値）。M に対して速度区間が変わった run は pruned 6 本・all 85 本で、ほとんどが「M で run 全体が最低速度（ランプ V20、本線 V40）だったものが窓の中だけになった」もの（1467911980: V40 9,190 m → V40 480 m・V60 8,710 m、45661183: V40 17,714 m → V40 300・V50 130・V60 17,285 m、203832852、668292569（all）: V40 2,881 m → V40 689・V50 1,582・V60 610 m、888066413（all）: V60 → V60 185・V80 4,986 m ほか all のランプ 70 本余り）。例外は短い連結路 4857053（3 次エルミート、V30 → V20）。高さの差（`compare-expressway-heights` M → A、両方で出力の測点）は pruned で p50 0・p90 0.012・p99 0.77・最大 5.61 m（45661183）、all で p50 0.009・p90 0.51・p99 2.28・最大 5.61 m（45661183、888066413 5.36、4854235 5.32、26956960 4.78、1467911980 4.71 m）。重なりは両方で出力の run どうしで pruned +3 組（1467911980|203832852 other 6 測点 0.06 m、203832852|78334075 nose、687744436|79449031 nose、どれも 0.2 m 以下）、all +18 / −5 組（増えたのは最大 |Δz| 0.2 m 以下の nose 14 組、other 3 組〔4857053|906610083 は 12 測点・0.75 m、他は 0.08 m 以下〕、parallel-ramp 1051967540|44803854 1 測点。減ったのは changeover 24402611|895902565 39 測点・最大 5.48 m など）。vertical_fallback と violations は両方で出力の run について増減 0。
- **AB（+ 1 段離しの除外）**: 41009552 は pruned・all とも出力され、閉鎖の根に無い。pruned で 40 run が新しく出力される（41009552 を含む本線 6 本・ランプ 34 本、すべて 41009552 の道連れだったもの）。外した測点の組は 131（成分 1023819782 の中で 41009552|668292569 60・1545539825|668292569 46・668292569|955398790 22、既定範囲の成分で 24402611|45021976 1、1068230495 の成分で 1304769699|45554543 2）。C1 の修正前は 149（668292569|955398790 が 40）で、設計の参考値（271 run の成分で 146）はその版の値。A と AB の両方で出力された run どうしの未許可の重なりは pruned 178 → 177 組（測点 1,925 → 1,923）、all 169 → 168 組（1,594 → 1,592）で、消えたのは 41520089|668292569 のノーズ。violations・vertical_fallback（両方で出力の run）は増減 0。高さの差（A → AB、両方で出力の測点）は p99 0.013〜0.014 m、最大 1.41 m（955398790）、0.59 m（41520089）、0.51 m（668292569）。
- **完了条件**: A に対して AB は閉鎖（本線 10 → 4・18 → 14、ランプ 46 → 12・55 → 30）と根（15 → 14・18 → 17）が減り、両方で出力の run どうしの重なりは組・測点とも ×1.05 以内、violations は増えず、未収束・dangling・deckMismatch 0。M に対しても pruned 本線 4 ≤ 10・ランプ 12 ≤ 46、all 14 ≤ 14・30 ≤ 30。M から増えた重なり・fallback の内訳: 両方で出力の run どうしの重なりは pruned +3 組がすべて A の側（窓）で、AB の側は −1 組。全体の増分の残り（pruned 177 → 213 組、fallback 272 → 302）は新しく出力された 40 run のもの。all は M と AB で出力の run が同じ 299 本で +20 / −7 組（差 +13）。うち M → A の両方で出力の run どうしが +18 / −5、A → AB が −1 で、残り（28188273|378275643 parallel-ramp・44803854|44804643 nose の追加、41009552|44804643 nose などの削除）は A で閉鎖されていた run の組。
- **origin/main の all の一括解との差**: AB の all は閉鎖・根が M と同じ（14 / 30・17）が、重なりは 182 → 195 組。これは窓の修正の側の変化で、M の値は全線 V40 の偶然を含んでいる。

## 残る端の重なり（レビュー W1）

行を外した組の重なりは、高さの規則では減らないので未許可のまま残る（AB の ship/pruned）。

- 41009552|668292569: changeover 25 測点・最大 |Δz| 4.06 m。行を外した s 0〜145 m の区間の縁で、外していない側の 1 段離しへ移る所に食い込む重なり。
- 1545539825|668292569: changeover 14 測点・最大 2.06 m。同じ場所へ降りる本線どうしで、端の近くで高さが揃っていく妥当な形。
- 668292569|955398790: other 2 測点・最大 0.49 m（端から約 20 m の所、車線域の重なり 0.08 m）。交差の足元は行が残り 7.03〜9.45 m 離れる。

同じ場所へ降りる本線どうしの端の重なりを、許可（類型ごとの上限）とするか同一面として扱うかは、S4（許可の台帳）・S5（有効化）で判断が要る。

## 既定データ

AB の既定範囲（`--out`）と public/data/expressway（origin/main）を比べると、チャンク 268・測点 4,459・診断 87 件・meta（`bytes` 以外）は同じ。チャンク ID・測点数・各 run の段も同じで、高さの差は全 4,210 測点（両方で比べた測点）で p99・最大とも 1 mm（ファイルの丸めの単位、`compare-expressway-heights`）。外れた組は既定の成分で 1 測点（24402611|45021976、都心環状線の内回り・外回り）。268 チャンク中 68 チャンクのバイトが変わり、変わった欄は測点の z・端の勾配 `g0`/`g1`・交差の記録 `cross`・標識の `z` の 1 mm・1e-6 単位の丸めだけ（設計の見込みは 48 チャンク）。指示 7 節の 4 の「2 mm 以下で形が同じ」場合なので、作り直して確かめた。多視点の周回はしない（丸めの単位の差で、形・段・診断が同じため）。C1 の修正の前後で既定データはバイト一致（既定の範囲に交差の足元の組は無い）。

- 既定の範囲で `scripts/expressway.ts` を 2 回（C1 の修正後、12:22Z・12:24Z 終了）: 2 回の出力は `diff -r` でバイト一致し、AB の `--out` の既定範囲・C1 の修正前の作り直し（11:15Z）とも一致。
- 全テスト（`pnpm exec vitest run`）。データテストの 1 件が境界で落ちた: MERGE_MAX_DZ（0.15 m）を超える同一面の一覧から 45554540:32 × 813455519（ノーズ 1 点）が外れた（|Δz| 0.1502 → 0.1499 m、1 mm の丸めの差で一枚の床版に描かれる側へ移った）。期待の一覧からその 1 行を理由つきで外した。許可リスト・継ぎ目の `SEAM_COUNT`・標識・スコアカードのテストはそのまま通る。
- `just check-deck-drive`（vite 5461 番、11:23Z・11:30Z の 2 回）: どちらも `invalid`（走行中に交通 AI の車と事故、47 km/h・Δv 26 km/h、`violation_cited`）で成功に数えられない。建物の貫通 `crossed` は 0、`stalled` 1・`holds` 2。origin/main の既定データへ一時的に戻して同じ検査を走らせても（11:46Z）、同じ時速・同じ相手の質量（1,481 kg）で同じ事故になり、結果も同じ（crossed 0・stalled 1・holds 2）。レビュー側でも 3 回とも main のデータで invalid。1 mm の差ではなく、今の main の交通の再現性の問題で、別件（fix/deck-drive-traffic）で追う。

## blocks の確認（1 本）

AB で ship/all・`--partition blocks`・k = 1.5（C1 の修正後、12:23Z 終了）: 閉鎖 本線 14・ランプ 30・根 17・道連れ 27 run・59.7 km で、AB の一括解（components）と一致。41009552 は閉鎖に無い。未収束 0。P2.7-2 の「all で blocks が一括解より本線 4 本多く閉じる」食い違いは消えた（A/B の本番は S3 の後）。

## 基準 fixture

`tests/fixtures/expresswayScorecard.ship.json` を AB の ship/pruned・components（`--baseline`、C1 の修正後 12:22Z）で作り直した。作り直した fixture と AB の ship-pruned の report は `compare-expressway-reports` で changed 0。M（旧 fixture と一致）に対して changed 91・added 123・removed 6 で、変わった欄は `plan`（`untied` の追加）・`runs`（出力・閉鎖の本数と km）・`closures`（根・道連れ）・`overlaps` と `overlapPairs`（新しく出力された run の組が大半）・`diagnostics`（7 種の件数）・`tracking`・`size`・`solver`（反復数）・`partition`（block のハッシュ 5 個: 1022519232・1023819782・1068230495・1125559318・1467911980）。範囲の run の増減 0。

## 採らなかった候補（設計の試作の数値）

- **partnersOf で上の床版の段を進める**: 上の床版だけ全線 V40 にしても 0.20 m 足りない（不足は自分の下の道路で、上の床版の速度は効かない）。下の床版だけ全線 V40 でも 0.12 m 足りない。
- **窓の拡張**（失敗位置を窓に足す）: 足しても 0.10 m 足りない。
- **低い端の近くの 1 段離しを全部外す**（同じ場所かを見ない）: 解けるが既定範囲の 155 / 268 チャンクが動く。
- **桁高を局所的に薄くする段**: 0.16 m なら受けられるが、原因（できない 1 段離し）を残したまま数値を合わせることになる。S6 の項目。
- **全クラスに広げた場合の試算**（同じ規則をランプ・street にも、交差の足元の条件を足す前の版）: ship の閉鎖は pruned 4 / 10・根 13、all 14 / 28・根 16 とさらに減るが、既定範囲のレインボーブリッジのランプ（台場出口 4848889 が最大 10.5 m、芝浦入口 4848755 が 1.09 m、他は 0.3 m 以下）が動く。段が specialGrade>lowerSpeed から standard に戻り、既定範囲の vertical_fallback は 38 → 27 に減るので悪い変化とは限らないが、P7 の走行・多視点・継ぎ目の例外をやり直す規模になる。3a では本線どうしに限り、ランプ・street は既定範囲を再確認する S5 / S6 に回す。

## 気づいた欠陥（直していない）

1. **窓の拡張の穴**: 窓は段を進めるときにしか増えないので、最後の段で窓の外に出た失敗（41009552 の 1 回目のパスの 130 m）は窓 [0, 160] に入らない。P2.6 の局所化の穴。
2. **残る端の重なり**（上の「残る端の重なり」）: S4 / S5 で許可か同一面扱いかを決める。
3. **955398790 は A → AB で 1.41 m 動く**（668292569 と同じ場所へ降りる本線で、端の近くの行が外れたため。交差の足元は 7 m 以上離れたまま）。走行は見ていない（出荷範囲は計測専用）。
4. **床版の走行検査が今の main でも毎回 invalid**（交通 AI との事故、別件）。
5. P2.7-2 の all の blocks と一括解の食い違いは、引き金（窓）の修正で一括解の側が blocks に揃う形で説明がついた（A の all が blocks と同じ 18 / 55）。

# P2.7-3: 縦断の目的 v2（既定は無効、2026-11-11）

P2.7 の第 3 段階（S3）。縦断の目的関数を「地表の短い波をなぞらない」形（v2）にする `--objective v2` を計測専用で足した。既定（v1）ではデータと解は 1 バイトも変えない。DEM は凸凹なので路面を地表に追従させず、地表は片側の拘束（床・天井）と端点にだけ使う。ship/pruned で掃引して勾配変化の重み 1.5・高架の reach 150 m を採ったが、**強制の無い区間の 3 指標のうち反転だけが届き、短波長相関と短波長 σ は未達**（閾値は緩めていない）。S2 の A/B をやり直したが all で T2 +3 になり、`BLOCK_QUIET_FACTOR` は **暫定 1.5 のまま未達**。[^p273]

## 作ったもの

| 項目                             | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 切り替え                         | `scripts/expressway.ts --objective v1\|v2`（既定 v1）。v2 は `--out` が無ければ止まる（`--below all`・`--partition blocks` と同じ）。掃引用に `--grade-change <w>`・`--reach <m>`・`--reach-below <m>`・`--target-scale <k>`（v1 に付けると止まる）。コンパイラへは `solvePlan(…, { objective })`（`compile.ts Objective`、環境変数では切り替えない）で渡し、`setupRun`・`setupBelow` が目標を作り、重みは `RunSetup` に載せて `solveAt`・`solveRoute` と `pieceSetup`（片の切り出し）が同じ値を `RunInput` に渡す。v1 では `RunInput` に新しい欄が付かない。ログ `expressway_objective_chosen` |
| 設計地盤線                       | `src/expressway/designGround.ts envelope(values, reach, kind, step = 5)`（純粋）。upper = ±reach の最大（単調 deque）→ ±reach の平均、lower = 最小 → 平均、mid = 両者の平均。窓は列の端で切り詰める。平均は窓ごとに足し直し（長い前置和の差で定数が定数でなくなるのを避けた）、upper は元の値以上・lower は以下に丸めの最後の 1 ulp を戻す。mid は S6（地平 run）の中心線用で、コンパイラはまだ使わない                                                                                                                                                                                         |
| 高架の目標                       | `upper(groundPeak, reach 高架) + STANDARD_UNDERCLEARANCE + GIRDER`（v1 は ±60 m 平均の地表 + 同じ値）。upper ≥ groundPeak なので開けた地表の床（groundPeak + 6.7 m）が目標を押し上げない。run 全体の測点で作り、片はそれを切り出す                                                                                                                                                                                                                                                                                                                                                              |
| 地下の目標                       | `lower(groundLow, reach 地下) − targetDepth`。天井・届き（below.ts）・T12 は不変                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 勾配変化の L1                    | `RunInput.gradeChange`: `addArcRows` の各弧の `diff`（隣の節点の勾配の差 × 節点間隔）に区間 [0, 0]・重み w の軟らかい行（既存の厳密 L1）。`W_SMOOTH` の二乗・硬い勾配と曲率の行・段は不変。掛けない: 短い run（曲率 0）、3 次の連結路（addArcRows を通らない）、前の解に固定した run（早期 return）、両端の節点を構造物が固定する弧。`RunInput.targetScale`（W_TARGET × k、掃引用）                                                                                                                                                                                                             |
| 仮定・重み                       | `assumptions.DESIGN_GROUND_REACH`（高架 150 m・地下 300 m、verified: false）、`vertical.W_GRADE_CHANGE` 1.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| スコアカード版 4                 | `objective`（kind と v2 の重み・reach・targetScale、v1 は null）。`tracking` に `free`（強制なしの km・短波長相関・短波長 σ・反転）、`forcedKm`、`height`（追跡した測点の路面 − 地表の中央値と p95）、`below`（800 m 以上で全チャンクが tunnel / cut の本線の短波長 σ と反転）。既存の欄は不変、版 2・3 の report も読める。`compareExpresswayReports.ts` は objective（重みまで）が違うと `expressway_reports_unlike` で警告                                                                                                                                                                   |
| スコアカード版 5（レビュー対応） | `tracking.junction`（強制なしの区間のうち、他の run が分合流で取り付く点から `TRACK_JUNCTION_M` 300 m 以内。`free` にも残る別枠）、`free`・`junction` に短波長の回帰の傾き `shortWaveSlope`（地表の 1 m あたりの路面の m）、`height.over15Km`・`over20Km`（書いた全 run の高架チャンクで路面が地表から 15・20 m を超える km）。版 2〜4 も読める。objective の違いの警告のラベルは `report.ts objectiveLabel`・`buildsUnlike` に移して単体テストした                                                                                                                                             |
| 強制の定義                       | `report.ts forcingOf`（タイルだけから決める、run 距離）: run の両端、チャンクの `decks` のうち関係が above / below の区間（same は入れない）、`cross` のうち天端がその位置の地表（測点の地表を線形補間）より `TRACK_FORCING_RISE_M` 2 m 以上高いもの。これらから `TRACK_FREE_M` 300 m 以内が強制あり。再標本・両端の除外・移動平均・ヒステリシスは `TRACK_*` のまま、反転は連続した強制なしの区間ごと                                                                                                                                                                                           |

## 不変条件とテスト

- **I1（v1 は不変）**: `tests/expresswayObjective.test.ts`「I1」は、ランプ・床版の重なり・凸凹の地表・地上道路を持つ合成網の v1 のチャンク・run・診断・閉鎖の SHA-256 を、origin/main 19968b3 のソースで同じ網を作って得た値（`623eae63…`）に固定し、**レビュー W3 で**トンネルの網（高架・丘の下の 2 km のトンネル・地平、`50b330ff…`）と 8 km の本線を固定点で 3 片に切る blocks の網（`63f84f6b…`）も足した（setupBelow の v1 の平均窓を 12 → 13 にする変異で落ちる）。objective を渡す・渡さないで同じことも見る。ハッシュは scratchpad の i1hash.mts で origin/main の `git archive` と作業木の両方から作り一致を確かめた。`vertical.ts` は targetScale が無ければ `W_TARGET` そのもの（積を取らない）、gradeChange が無ければ行を足さない。
- `tests/expresswayDesignGround.test.ts`: upper ≥ 元・lower ≤ 元（端も）、定数は定数、平行移動で不変、波長 2 × reach 以下（200 m・300 m）の起伏を落とし 1.5 km の波は高さの 3/4 以上残す、端の窓の切り詰め、mid、格子の間隔の扱い。
- 合成の縦断（`tests/expresswayObjective.test.ts`）: 波長 200 m・振幅 1 m の地表の上の 3 km の本線で v2 は v1 より反転が少なく、両端から 800 m を除いた短波長 σ が v1 の半分未満で、T1・T2・T4 を守り、登りの間の 2.4 km で反転 0。波長 1.5 km・振幅 5 m で correlation 0.9 超・傾き 0.4 超（沿う。w 1.5 で傾き 0.48）。7 m の段の上の地上道路で桁下と勾配・縦断曲線が法令内。起伏のある丘の下の 2 km のトンネルで v2 の反転が v1 以下（6 → 4）、T12。分合流つきで C¹（T3）・ランプが解ける。L1 の行を掛けない所: 短い run と固定した run の解が w の有無で同値、長い run では動く。
- blocks（`tests/expresswayBlocks.test.ts`）: v2 で I2（3 片に切った解が v2 の路線解と z 1 mm・勾配 3e-5・片勾配 1e-4。勾配の許容は v1 の 1.5e-5 から広げた: L1 で縦断が少ない折れの直線に近くなり、折れの位置を目的がほとんど決めないので、QP の精度の範囲で 2 つの解の折れがずれる。w 1・1.5・2 で 0.8e-5・2.0e-5・0.9e-5、固定点から 250 m の所）と I3、v2 の路線解が v1 と違う（目的が路線解まで届く）。
- **v2 の中身（レビュー W4）**: `compile.ts runTargets`（テスト用に目標だけを返す）で、高架の目標が上側包絡（±150 m）+ 8.7 m、地下の目標が下側包絡（±300 m）− トンネルの深さであることを 2 cm 以内で見る（v1・upper の地下・lower の高架はどれも 0.5〜1 m 以上外れる）。blocks の網に 200 m・1 m の波を足すと、内側の床版は波の頂から平均 8.4〜9.3 m（v1 は 8.3 m 未満）で、勾配変化の重みを 0 にした blocks と解が違う（片の setup まで L1 が届く）。弧の行の数（構造物が固定する弧を除く）、targetScale が効くこと、shedding で外したランプを戻す解も v2 で通ること。`objective` は setupRun・solveComponent・solveShedding・solveComponents で既定値の無い引数にした（渡し忘れは型と実行時の両方で落ちる）。変異 14 本（v2 の高架・地下の目標を v1 / 逆の包絡に、片・路線解が重みを落とす、isFixedArc・isShort の除外を外す、戻す解・2 回目以降のパス・blocks の setup に objective を渡さない、targetScale を無視、v1 の地下の平均窓、v1 に L1 が漏れる）はすべて落ちる（scratchpad の s3/mutate.py、2026-11-11T13:55:59Z 終了）。
- `tests/expresswayReport.test.ts`: 版 5（junction・傾き・15 / 20 m 超の km、版 4 も読める、objective の違いの警告）・版 4・objective、`forcingOf`（above の区間・地表から 6 m の cross・両端が強制、same と地表の道路は強制でない）と `free` の km・反転、`below`、版 3 との比較で増えるのが新しい欄だけ。
- 未収束の再現（`tests/expresswayFallbacks.test.ts`、`tests/fixtures/expresswayQpObjectiveV2.json`）: 下の「未収束」。

## 計測（trust signal、2026-11-11 UTC、M2 Max）

ラベルは `.qa/expressway/s3-*`（実行の記録は `s3-runs.jsonl`）、出力は `.cache/expressway-area/s3-*`。掃引 1 は 8 本並列で 12:43:52〜12:50:20Z、掃引 2 は 6 本並列で 12:52:22〜12:57:25Z、採った値の ship/all・blocks・既定範囲は 10 本並列で 13:00:44〜13:08:37Z に終了。時間は並列度で伸びるので v1 比は目安。

- **無効時の不変**: v1 の ship/pruned（s3-v1-pruned）を作り直す前の基準 fixture（#66 の後）と `compare-expressway-reports` で比べ changed 0・removed 0・added 11（すべて `tracking.free.*`・`forcedKm`・`height.*`・`below.*`）、範囲の run の増減 0。v1 の既定範囲（`--out`、s3-default-v1）は public/data/expressway と `diff -r` で一致。`just make-expressway-data` の後 `git status public/data/expressway` は差分なし（13:13:28Z 終了）。基準 fixture は v1・components（`--baseline`、13:14:46Z 終了）で作り直し、作り直す前と changed 0・removed 0・added 11。
- **レビュー対応の後**（objective を必須引数に、`runTargets`、版 5。3 本並列で 13:59:26〜14:02:59Z）: v2 の ship/pruned（s3r-v2-pruned）はレビュー前の s3-v2-pruned と `diff -r` で一致。`just make-expressway-data` の後 `git status public/data/expressway` は差分なし（14:01:31Z 終了）。基準 fixture を版 5 で作り直し（s3r-v1-baseline）、版 4 の fixture と changed 0・removed 0・added 8（`free.shortWaveSlope`・`junction.*`・`height.over15Km`・`over20Km`）。版 5 の欄はレビュー前の出力にも `trackingOf` を掛けて求めた（.qa/expressway/s3-track5.jsonl）。
- **採った値の決定性**: 掃引の w 1.5・reach 150（フラグで指定）と既定の v2（フラグなし）は、タイル・meta が `diff -r` で一致し report は changed 0。
- **強制の定義の照合**: 設計の探査（#66 の前、46 run・316 km）の強制なし 212.8 km・相関 0.576・σ 0.700 m・反転 1.77 回/km に対し、#66 の後の v1 は 51 run・350.5 km のうち強制なし 235.1 km・相関 0.553・σ 0.696 m・反転 1.68 回/km。設計の free2.py を同じ出力に掛けると 233.6 km・0.550・0.684 m・1.67 回/km で、差は地表の取り方（free2.py は直前の測点の地表、report.ts は線形補間）と相関の中心化（free2.py は平均を引かない）。#66 で出力された 5 本（41009552 の道連れだった本線）が km の差。

### 掃引（ship/pruned・components）

全体は追跡した高架の本線全部、強制なしは上の定義。閉鎖・未収束・重なり・violations・fallback は範囲の run のスコアカード（`vertical_fallback` は `diagnostics` の件数）。

| 項目                                        |                   v1 |            w0.5 r150 |              w1 r150 |            **w1.5 r150** |              w2 r150 |            w0.5 r250 |              w1 r250 |              w2 r250 |
| ------------------------------------------- | -------------------: | -------------------: | -------------------: | -----------------------: | -------------------: | -------------------: | -------------------: | -------------------: |
| 全体 相関 / σ（m）/ 反転（回/km）           | 0.373 / 0.998 / 2.24 | 0.183 / 0.835 / 1.46 | 0.171 / 0.787 / 1.34 |     0.163 / 0.753 / 1.24 | 0.160 / 0.727 / 1.15 | 0.143 / 0.825 / 1.43 | 0.143 / 0.778 / 1.34 | 0.138 / 0.721 / 1.13 |
| 強制なし（235.1 km）相関 / σ / 反転         | 0.553 / 0.696 / 1.68 | 0.260 / 0.496 / 0.91 | 0.240 / 0.458 / 0.83 | **0.228 / 0.433 / 0.77** | 0.230 / 0.412 / 0.69 | 0.191 / 0.483 / 0.89 | 0.197 / 0.448 / 0.83 | 0.201 / 0.405 / 0.70 |
| correlation（傾き）                         |        0.884（0.94） |        0.852（0.90） |        0.844（0.89） |            0.837（0.89） |        0.832（0.88） |        0.830（0.88） |        0.825（0.87） |        0.813（0.87） |
| 高さ 中央値 / p95（m）                      |         8.77 / 14.53 |         9.56 / 15.71 |         9.57 / 15.88 |             9.57 / 16.05 |         9.58 / 16.22 |     **9.83** / 16.40 |     **9.84** / 16.48 |     **9.85** / 16.80 |
| 地下本線 σ / 反転（6 run・9.6 km）          |         0.800 / 1.24 |         0.465 / 0.62 |         0.438 / 0.62 |             0.421 / 0.62 |         0.410 / 0.52 |         0.465 / 0.62 |         0.438 / 0.62 |         0.410 / 0.52 |
| 閉鎖 本線 / ランプ / 根                     |          4 / 12 / 14 |                   同 |                   同 |                       同 |                   同 |                   同 |                   同 |                   同 |
| 未収束                                      |                    0 |                    0 |                    0 |                        0 |                **1** |                    0 |                    0 |                **1** |
| 未許可の重なり（組・測点）                  |           213・2,203 |           216・2,233 |           220・2,245 |               222・2,179 |           222・2,195 |           213・2,230 |           220・2,242 |           224・2,229 |
| 　nose / parallel-ramp / changeover / other |   50 / 107 / 25 / 31 |   52 / 105 / 30 / 29 |   54 / 104 / 33 / 29 |       54 / 104 / 34 / 30 |   54 / 104 / 34 / 30 |   49 / 105 / 30 / 29 |   54 / 105 / 33 / 28 |   55 / 105 / 33 / 31 |
| violations                                  |          T2 2・T12 1 |          T2 1・T12 1 |          T2 2・T12 1 |                    T12 1 |          T2 2・T12 1 |      **T2 3**・T12 1 |          T2 1・T12 1 |      **T2 4**・T12 1 |
| vertical_fallback                           |                  215 |                  204 |                  203 |                      205 |                  207 |                  203 |                  205 |                  193 |
| qpMs / 解く段（s）                          |             91 / 125 |            100 / 139 |             98 / 135 |                 77 / 103 |             95 / 127 |             96 / 134 |             99 / 134 |             85 / 123 |

`W_TARGET` 相当を半分にした組と reach 200 m（掃引 2）:

| 項目                     |                    w1 r150 t×0.5 |                  w0.5 r150 t×0.5 |              w1 r200 |        w1 r200 t×0.5 |
| ------------------------ | -------------------------------: | -------------------------------: | -------------------: | -------------------: |
| 強制なし 相関 / σ / 反転 | 0.206 / 0.448 / 0.81（139.3 km） | 0.252 / 0.545 / 0.96（103.6 km） | 0.216 / 0.454 / 0.80 | 0.202 / 0.431 / 0.75 |
| 高さ 中央値 / p95        |                     9.67 / 16.76 |                     9.61 / 16.50 |         9.70 / 16.22 |         9.79 / 16.87 |
| 閉鎖 本線 / ランプ / 根  |                **25 / 125 / 27** |                **31 / 151 / 51** |      **5 / 13 / 16** |          4 / 12 / 14 |
| 未収束                   |                           **13** |                            **2** |                **3** |                    0 |
| violations               |                  **T2 5**・T12 1 |                      T2 1・T12 1 |                T12 1 |      **T2 5**・T12 1 |

目標の重みを半分にすると未収束が出て、それで段を進められなかった成分の run が閉じる（強制なしの km が減るのはその分）。目標が弱いと縦断が床と拘束の行だけで決まり、内点法の最後が不安定になる（下の「未収束」と同じ型と推定、QP は保存していない）。

### 採った値と合否

合否をすべて満たす組は無い。未収束 0 で他の項目（高さ・violations・閉鎖）を満たす組のうち強制なしの 3 指標に最も近い **w 1.5・reach 150 m（地下 300 m）・target ×1** を採った（`W_GRADE_CHANGE`・`DESIGN_GROUND_REACH`）。reach 250 m は相関を 0.04 下げるが高さの中央値 +1.06〜1.08 m で否、w 2 は未収束、reach 200 m は w 1 で未収束 3。

| 項目（同じ below の v1・components に対して）                                  | ship/pruned                                     | ship/all                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| 強制なし 反転 ≤ 0.8 回/km                                                      | 可（1.68 → **0.77**）                           | 可（1.68 → **0.78**、210.0 km）                 |
| 強制なし 短波長相関 ≤ 0.15                                                     | **否（0.553 → 0.228）**                         | **否（0.549 → 0.226）**                         |
| 強制なし 短波長 σ ≤ 0.4 m                                                      | **否（0.696 → 0.433）**                         | **否（0.683 → 0.433）**                         |
| 全体の 3 指標が下がる                                                          | 可（0.373 → 0.163、0.998 → 0.753、2.24 → 1.24） | 可（0.365 → 0.155、0.993 → 0.754、2.26 → 1.26） |
| 未収束 0                                                                       | 可                                              | 可                                              |
| 本線・ランプの閉鎖が増えない、根の差                                           | 可（4 / 12、根 14 本が同じ一覧）                | 可（14 / 30、根 17 本が同じ一覧）               |
| violations の各性質が増えない、dangling・deckMismatch 0                        | 可（T2 2 → 0、T12 1 → 1）                       | 可（T2 2 → 0、T12 1 → 1）                       |
| 未許可の重なり 組・測点 ×1.05 以内                                             | 可（213・2,203 → 222・2,179、×1.042・×0.989）   | 可（195・1,821 → 204・1,824、×1.046・×1.002）   |
| 　類型（nose / parallel-ramp / changeover / other）                            | 50 → 54 / 107 → 104 / **25 → 34** / 31 → 30     | 48 → 51 / 94 → 92 / **22 → 31** / 31 → 30       |
| vertical_fallback ×1.05 以内                                                   | 可（215 → 205）                                 | 可（199 → 203、×1.020）                         |
| 高さ 中央値 +1.0 m・p95 +2.0 m 以内                                            | 可（+0.80・+1.52）                              | 可（+0.79・+1.47）                              |
| 地下本線の σ・反転が増えない                                                   | 可（0.800 → 0.421、1.24 → 0.62）                | 可（0.879 → 0.415、1.73 → 0.59）                |
| （参考）強制なしの短波長の回帰の傾き（版 5）                                   | 0.397 → 0.102                                   | 0.396 → 0.103                                   |
| （参考）分合流 ±300 m（`tracking.junction`、62.0 km / 57.0 km）σ / 相関 / 反転 | 0.872 / 0.540 / 2.11 → **0.579** / 0.235 / 1.08 | 0.854 / 0.543 / 2.17 → **0.579** / 0.230 / 1.12 |
| （参考）地表から 15 m 超 / 20 m 超の高架（全 run、km）                         | 34.7 / 12.9 → **50.4** / 14.8                   | 33.5 / 12.7 → **47.6** / 14.4                   |
| qpMs / 解く段（v1 比）                                                         | 91 → 112 s（×1.23）/ 125 → 147 s（×1.18）       | 131 → 152 s（×1.16）/ 172 → 196 s（×1.14）      |

時間は v1 が 8 本並列、v2 が 10 本並列の値（2 倍は超えない）。掃引 2 の 6 本並列の同じ組は 77 / 103 s で v1 より速く、差は並列度の範囲。

**未達の見立て**（設計の 1 節の区分、`where.py` を s3-v2-pruned に掛けた値。km は区分の測点数 × 10 m）:

| 区分                          |    km |   v1 σ / 相関 |       v2 σ / 相関 |
| ----------------------------- | ----: | ------------: | ----------------: |
| 強制あり                      | 116.2 | 1.435 / 0.254 |     1.163 / 0.159 |
| ランプの分合流から 200 m 以内 |  39.2 | 0.813 / 0.479 | **0.526** / 0.137 |
| 地上道路の交差から 60 m 以内  |  67.2 | 0.675 / 0.618 | 0.415 / **0.221** |
| どれからも遠い                | 128.5 | 0.645 / 0.546 | 0.390 / **0.242** |

- **σ**: 遠い所では 0.39 m で届いている。外しているのは分合流の近く（0.53 m）で、ランプの取付きの C¹ と nose の重なりの行が本線を曲げる分（強制の定義には入らない）。
- **相関**: 遠い所でも 0.24 残る。目標の上側包絡（±150 m）は 300 m より長い波を残し、500 m の移動平均を引いた残り（指標の短波長）には 300〜1,000 m の波が入るので、目標そのものが地表と相関する。reach を延ばすと相関は下がるが（250 m で 0.20）包絡が上がり高さの合否を外れる。相関 0.15 には目標の作り方（包絡の上の平滑化、目標の重み）を変える必要があり、目標の重みを下げると未収束になる。**レビュー（Fable）の reach の掃引**（w 1.5、ship/pruned、13:43Z 終了、依頼元 scratchpad の review-s3/）: 高架 reach 150・400・600 m で強制なしの相関 0.228・0.168・0.127、σ 0.433・0.419・0.432 m、反転 0.77・0.72・0.72 回/km、高さの中央値 v1 比 +0.81・+1.34・+1.62 m（p95 +1.52・+2.83・+3.84 m）、T2 0・5・4。**相関の未達は高さとのトレードオフ**で、0.15 を割るのは 600 m（高さの中央値の合否 +1.0 m を外れる）。コーディネーターの判断で S3 ではこれ以上追わず、閾値も緩めない。短波長の回帰の傾き（版 5）は 0.397 → 0.102 で、路面が地表の短い波に乗る量は 1/4 になっている（相関が残るのは地表の振幅に比べ小さい残りが同じ向きに揃うため）。

**高さの差**（`just compare-expressway-heights` v1 → v2、両方で出力の run の全測点の \|Δz\| p50 / p90 / p99 / 最大、m）:

| 範囲        | run | p50 / p90 / p99 / 最大         | 上位                                                                                                                                                         |
| ----------- | --: | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ship/pruned | 307 | 0.519 / 2.349 / 5.546 / 12.281 | 203832852 12.28、1467911980 12.27、4848889 10.55、316360292 9.16、22694126 9.00、24039713 8.19、45248411 8.12、678761500 7.87、5170834 7.85、45332351 7.47   |
| ship/all    | 299 | 0.517 / 2.376 / 5.981 / 12.281 | 203832852 12.28、1467911980 12.27、28127108 9.47、316360292 9.16、24039713 8.19、45248411 8.12、678761500 7.87、5170834 7.85、45332351 7.47、1328383029 7.45 |
| 既定範囲    |  19 | 0.295 / 1.825 / 5.018 / 10.548 | 4848889 10.55、45021976 5.07、4848755 4.87、45021972 4.29、45177681 3.76、45177678 3.74、24402611 3.37、45554540 2.66、737538573 2.38、4848740 2.24          |

上位の大半は段も V も同じで、v2 が谷を一定勾配で渡る形（203832852 は s 200〜900 m の幅 600 m・深さ 18 m の谷を v1 は 4 % で下りて上り、v2 は 1.19 % の直線で渡り、s 500 m で地表から 23.8 m）。4848889（台場出口）は段が specialGrade>lowerSpeed から standard に戻った。**既定範囲の床版は最大 10.5 m 動き、未許可の重なりが 0 → 8 組・38 測点（nose 3・changeover 4・other 1）出る**ので、S5 で有効化するときは既定範囲の許可リスト・多視点・走行・継ぎ目の例外をやり直す規模になる（S5 の見積もり）。

### blocks の A/B のやり直し（v2、k = 1・1.5・2）

| 項目                                        |              pruned joint |                       k=1 |                     k=1.5 |                       k=2 |                 all joint |                       k=1 |                     k=1.5 |                       k=2 |
| ------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| 固定点 / 必要な block / 片                  |              0 / 20 / 491 |            101 / 58 / 547 |             78 / 49 / 539 |             55 / 40 / 519 |              0 / 18 / 546 |            117 / 59 / 588 |             96 / 50 / 583 |             69 / 41 / 561 |
| 最大 block（run / 片 / 変数）               |        271 / 271 / 17,852 |         117 / 121 / 7,362 |         135 / 140 / 8,286 |        236 / 246 / 15,208 |        382 / 382 / 26,380 |         140 / 147 / 8,668 |        185 / 193 / 11,232 |        244 / 254 / 15,634 |
| 解いた回数・未収束・路線解（問題が Q 以内） |                 107・0・— |           220・0・40（0） |           198・0・37（0） |           155・0・28（3） |                  83・0・— |           216・0・43（0） |           193・0・41（0） |           151・0・32（3） |
| 閉鎖 本線 / ランプ / 根                     |               4 / 12 / 14 |        同（根も同じ一覧） |                        同 |                        同 |              14 / 30 / 17 |                        同 |                        同 |                        同 |
| 未許可の重なり（組・測点）                  |                222・2,179 |                219・2,187 |                221・2,172 |                220・2,171 |                204・1,824 |                202・1,841 |                204・1,826 |                204・1,848 |
| violations                                  |                     T12 1 |                     T12 1 |                     T12 1 |                     T12 1 |                     T12 1 |           **T2 3**・T12 1 |           **T2 3**・T12 1 |           **T2 3**・T12 1 |
| vertical_fallback                           |                       205 |                       202 |                       202 |                       204 |                       203 |                       199 |                       199 |                       203 |
| 反転 / 短波長 σ                             |              1.24 / 0.753 |              1.27 / 0.749 |              1.26 / 0.744 |              1.24 / 0.749 |              1.26 / 0.754 |              1.28 / 0.750 |              1.27 / 0.744 |              1.25 / 0.750 |
| 強制なし 相関 / σ / 反転（レビュー W2）     | 0.228 / 0.433 / **0.766** | 0.228 / 0.434 / **0.821** | 0.230 / 0.429 / **0.817** | 0.229 / 0.434 / **0.779** | 0.226 / 0.433 / **0.776** | 0.226 / 0.435 / **0.834** | 0.228 / 0.429 / **0.829** | 0.226 / 0.434 / **0.791** |
| qpMs / 解く段（s、10 本並列）               |                 112 / 147 |                  71 / 105 |                  83 / 119 |                  89 / 117 |                 152 / 196 |                  86 / 124 |                  82 / 115 |                  99 / 133 |

固定点の段差（`joins`）は全構成で z ≤ 5e-14 m・勾配 ≤ 1e-16（I3）。同等性（S2 と同じ閾値）: pruned は k = 1・1.5・2 とも全項目可（反転 +0.00〜+0.03、σ −0.01〜−0.00、重なり ×1.00、閉鎖・根は同一）。all は 3 つの k とも閉鎖・根・重なり・fallback は可で、**violations が T2 0 → 3 で否**（T2 は掃引・blocks の 13 構成中 9 で 1〜5 件出ており、採った値の一括解の 0 件は偶然に近い。測点間のエルミートの行き過ぎは S5 の前に直す）。3 件は 1 か所（28127108:37 の s 9,972〜9,974 m、面の勾配 −5.00〜−5.01 %、標準 5 % の測点間のエルミートの行き過ぎ、v1 の T2 2 件と同じ型）で、最寄りの固定点（7,607 m・12,233 m）から 2.4 km 離れ、k によらない。S2 の all の否（41009552）は 3a で消えたが、**両方の below で満たす k は無いので `BLOCK_QUIET_FACTOR` は暫定 1.5 のまま未達**。**訂正（レビュー W2）**: 強制なしの反転は k = 1・1.5 で 0.82〜0.83 回/km と 0.8 を超え、**blocks（暫定の k = 1.5）と v2 を組み合わせると強制なしの 3 指標がすべて否**になる（一括解の v2 は反転だけ可）。固定点の脇で片の端の勾配が W_PIN で引かれ、片の中の折れが 1 つ増える分と推定（未確認）。S5 で blocks と v2 を一緒に有効にする前の前提。

高さの差（joint → blocks、\|Δz\| p50 / p90 / p99 / 最大、m）と固定点での路線解の値と一括解の差:

| 構成         | 全測点                        | 固定点 ±Q                     | それ以外                      | 固定点の路線解 − 一括解 p50 / p90 / 最大 |
| ------------ | ----------------------------- | ----------------------------- | ----------------------------- | ---------------------------------------- |
| pruned k=1   | 0.014 / 0.324 / 1.173 / 3.725 | 0.199 / 0.864 / 2.687 / 3.725 | 0.010 / 0.272 / 0.985 / 3.387 | 0.234 / 0.950 / 3.441（888066413@2419）  |
| pruned k=1.5 | 0.012 / 0.286 / 1.018 / 3.726 | 0.166 / 0.815 / 2.842 / 3.726 | 0.009 / 0.243 / 0.901 / 3.387 | 0.200 / 0.901 / 3.441                    |
| pruned k=2   | 0.002 / 0.165 / 0.778 / 2.579 | 0.105 / 0.506 / 1.012 / 1.384 | 0.001 / 0.134 / 0.755 / 2.579 | 0.135 / 0.620 / 0.950（44804029@1375）   |
| all k=1      | 0.014 / 0.337 / 1.193 / 3.725 | 0.185 / 0.876 / 2.687 / 3.725 | 0.011 / 0.286 / 0.999 / 3.387 | 0.234 / 0.950 / 3.441                    |
| all k=1.5    | 0.012 / 0.297 / 1.036 / 3.726 | 0.145 / 0.819 / 2.842 / 3.726 | 0.010 / 0.257 / 0.908 / 3.387 | 0.200 / 0.907 / 3.441                    |
| all k=2      | 0.002 / 0.173 / 0.806 / 2.579 | 0.089 / 0.529 / 1.012 / 1.384 | 0.001 / 0.147 / 0.782 / 2.579 | 0.094 / 0.656 / 0.950                    |

S2（v1）と比べ、固定点の ±Q の p90 は 0.38〜0.41 → 0.82〜0.88 m（k=1・1.5）、固定点の路線解と一括解の差の p50 は 2〜5 cm → 20〜23 cm に広がった。設計の見込みどおり剛い目的では路線解（他 run の拘束なし）と一括解の差が広がる。それ以外の測点は S2 と同じ程度（p99 0.9〜1.0 m）。

### 未収束

w 2・reach 150 m で 1 回（掃引 1）、同じ構成を QP を保存する scratchpad の複製（designGround の 1 ulp の丸めを戻した後のコード）で作り直すと 3 回、いずれも 11 run の成分（トンネル 5213545 の周り、542 変数・4,457 行）の `broken`（37 反復、ピボットの正則化 23〜32）。1 本を `tests/fixtures/expresswayQpObjectiveV2.json`（P2.6 の expresswayQpStall.json と同じ形）に保存して再現テストにした。

- **重みの桁ではない（訂正、レビュー W1）**: 最初の版は「×0.5〜×4 の 6 点で 2 だけ破綻」と書いたが、点が粗かった。レビューで保存した QP の重みを 1〜3 で 500 点振ると **13 点（約 2〜3 %）が破綻**し（1.356、1.828〜1.996 に 9 点、2.0、2.385 など）、**1 ulp で入れ替わる**（2 と 2 − 1 ulp は破綻、2 + 1 ulp は収束）。1.4〜1.6 の 100 点は 0 件。どの重みでも起こりうる散らばった破綻で、1.5 で起きないことは別の成分では保証されない（作業側でも同じスクリプトで再現、2026-11-11T14:01:50Z 終了、.qa/expressway/s3-qpscan.txt）。
- **行の重複そのものではない**: 260 行はどれも同じ係数の硬い曲率の行と並ぶが、同じ罰金を係数 ×2・重み 1 の行で書くと収束する。
- **終了判定**: 反復ごとの残差（scratchpad の qp.ts の複製で記録）は、31 反復目で主残差 1.6e-12・双対残差 1.6e-7・平均 λs 3.1e-7、32 反復目で λs 2.0e-8（gapTol 1e-7 を満たす）なのに双対残差が 1.34e-6 と dualTol 1e-6 をわずかに超え、そのまま押すと D の幅が 6e-15〜1e17 に広がって 36 反復目に 32 ピボットを正則化し 37 反復目が NaN。dualTol 1.5e-6 なら 32 反復目で収束する。P2.6 の 13 件（gap が届かない）と同じ「止まるべき所を過ぎて破綻する」型で、今回は双対の側。
- **対処**: S3 では qp.ts は変えない。w 2 を採らないことで避けた（採った w 1.5 は ship/pruned・ship/all・blocks 6 構成・既定範囲の全 10 本で未収束 0）。**訂正（レビュー W1）**: 最初の版の「dualTol を緩めると I1 が崩れる」は不正確。solveQp は options を取るので、**収束しなかった solve だけを緩めた dualTol で解き直せば収束済みの解（v1 を含む）は 1 ビットも変わらない**。上の 13 点は dualTol 1e-5 の解き直しで全部収束する（`tests/expresswayFallbacks.test.ts` に再現）。この「非収束時だけの解き直し」を S5（有効化）の前提にする。

## 落とし穴

1. 目標の重みを半分（target ×0.5）にすると未収束 13・閉鎖が本線 25 本に増えた。v2 の剛さは L1 の重みで上げ、目標の重みは下げない。
2. reach を延ばすと相関は下がるが包絡が上がる（250 m で高さの中央値 +1.07 m）。合否の高さの項目が reach の上限を決める。
3. 試作（main-src2）の環境変数の切り替えは取り込まず、目的は `solvePlan` のオプションから `RunSetup` に載せた。片の setup は run の setup を切り出すので、片だけ目的が違うことは起きない（I2 の v2 版のテスト）。
4. 掃引 1 は designGround の丸めの 1 ulp を戻す前のコードで作った（w 2 の未収束が 1 回と 3 回で違うのはこのため）。採った w 1.5 の数値は掃引 2 と最終の 10 本（戻した後のコード）で、両者はバイト一致。

## 気づいた欠陥（直していない）

1. **谷を高く渡る**: v2 は幅数百 m の谷を一定勾配で渡り、地表から 20 m を超える床版ができる（203832852 で 23.8 m、高さの p95 +1.5 m）。**判断（コーディネーター）**: 地表からの一律の天井にはしない（渋谷の谷の 203832852・1467911980 は v2 の方が実物に近い）。スコアカード版 5 に地表から 15・20 m 超の km を出し（ship/pruned で 15 m 超 34.7 → 50.4 km、20 m 超 12.9 → 14.8 km、レビューの数え方では 20 m 超が新たに 27 run・2.08 km）、予算は S5 の前に決める。
2. **changeover の重なりが増える**（pruned 25 → 34 組、all 22 → 31 組）。剛い縦断は二層 ⇔ 並列の移り変わりで譲りにくい。重なり全体は ×1.05 以内。
3. **分合流の近くで本線が曲がる**（σ 0.53 m）。強制の定義に分合流が入っていないので強制なしの σ を押し上げる。**判断（コーディネーター）**: 判定区間は今のまま（分合流は強制に入れない、閾値も変えない）。版 5 で `tracking.junction`（分合流 ±300 m、v2 で σ 0.579 m）を別枠に出し、σ の未達は「本線がランプに譲る」問題として S5 / S6 に残す。
4. **既定範囲の動き**: 床版が最大 10.5 m 動き、未許可の重なりが 8 組出る（許可リストは v1 の高さで書いてある）。
5. **blocks の all で T2 +3**（28127108、5.01 %）。測点間のエルミートの行き過ぎで、v1 の T2 2 件と同じ。GRADE_MARGIN の余裕が測点の間で足りない型で、S2 の k=2 の T2 +1 と同じ。掃引・blocks の 13 構成中 9 で 1〜5 件出ており、S5 の前に測点間の余裕を直す。
6. **blocks × v2 で強制なしの反転が 0.8 を超える**（k = 1.5 で 0.817・0.829）。S5 で両方を有効にするなら固定点の脇の扱いを見直す。
7. **固定点の路線解と一括解の差が広がる**（p50 0.2 m・最大 3.4 m）。S5 で blocks を使うなら、路線解に分合流の取付きの拘束を入れるか、2 段解を検討する。

# P2.7-4: 許容の台帳と配信形式 v6（2026-11-11）

S4。チャンクの幾何・解・目的には触れず、データのフォルダの入れ物（v6）と、許可・例外の置き場（規則 + 台帳）を作った。中身を埋めたのは既定データだけで、ship と v2 は「台帳を作り直せる」ことを件数で示した（判断はしていない）。[^p274]

## 配信形式 v6

| ファイル       | 読み手                           | 中身                                                                                                                                                                            |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.json`    | ゲーム（起動時）・テスト         | 索引だけ: version 6・features・zoom・tiles・ranges・scope・structures・extract・counts・bytes                                                                                   |
| `<x>-<y>.json` | ゲーム・テスト                   | `chunks`（v5 と同じ内容・同じ順）、`runs`（そのタイルにチャンクを持つ run の `{id, cls, start, end}`、run の ID 順）、`entrances`（地表端がこのタイルにある入口。無ければ省く） |
| `report.json`  | テスト・道具（ゲームは読まない） | `XwBuildRecord`: run の詳しい要約・diagnostics・closed・solver・`untied`（`plan.untied` の組）・`blocks`（block の run と `dataHash`）。スコアカード（`--report`）とは別物      |
| `ledger.json`  | テスト・道具・ビルドの `allowed` | 下の「台帳」                                                                                                                                                                    |

- **理由**: ship の meta は 279.5 KB（gzip 38.1 KB、予算 30 KB）で、ゲームが読むのはタイルの一覧と run の両端・クラス・入口だけだった。run の要約を**そのチャンクを持つタイルすべて**に入れるのは、どのタイルから読んでも `roleOf`（床版の一体化の親子）が同じになるように。
- 実行時（`ExpresswayDecks`）は meta を索引として読み、タイルを読むたびに run の要約と入口を足す（違う要約が来たら `expressway_tile_run_mismatch` で最初のを保つ）。入口は `onEntrances` で案内標識へ渡し直す（main.ts の起動時 1 回の配線をやめた）。`expresswayRoadInput` には読み込み済みのタイルの run を渡す。z14 の 3 × 3 は点から 1.98 km 以上あり、GRAPH_RADIUS 1.3 km + チャンク 300 m の子の run は必ずその中にあるので、v5 の「全 run を一度に渡す」と同じ結果になる（tests/expresswayFormat.test.ts で既定範囲の中心とタイルの角 23 点、往復の順で確かめた）。
- テストと道具は `scripts/expresswayFiles.ts`（`XW_DATA_DIR` を読むのはここだけ）と純粋な組み立て `src/expressway/files.ts` で読む。書き出しは `packTiles`。`scripts/expressway.ts` は出力先を消す前に `ledger.json` を読んで取っておき、書き出しの後に戻す。
- `XW_VERSION` 6、`XW_FEATURES` は不変。ゲームは 5 以下を拒否する。

## 台帳

- **規則**（`src/expressway/allowlist.ts`、run の ID 無し）: `*` の 4 種（vertical_fallback・below_open_ground_floor・deck_below_ground・crossing_over_or_at_grade、上限は今のまま）、類型の規則（nose ≤ 0.5 m、portal-open-cut ≤ 150 m、let_go の段差 ≤ 1 mm）、余裕 `CASE_MARGIN`（測点 +2、|Δz|・段差・内側の面 +5 cm、区間の端 ±5 m、半径 −0.5 m、長さ +5 m）。`SAME_SURFACE_ALLOWED_DZ_M` 0.14 は値を変えずに残した。
- **台帳**（`src/expressway/ledger.ts`、道具 `scripts/expresswayLedger.ts`、`just update-expressway-ledger dir flags`）: 1 件ずつ `key`・`kind`・`run`・`with`・`chunk`・`district`・`block`・`blockHash`・`measured`（生成）、`cap`・`status`・`by`・`reason`・`qa`（判断）、`previous`（判断が外れたときの直前の判断）。先頭に `data`（範囲・scope・目的・抽出の時刻）、`summary`（生成）、`budget`（判断）。時刻は書かない。
- **類型**: nose（auto）・changeover・parallel-ramp・touchdown（`untied` の組。分類より先に見る）・other・portal-open-cut（auto、坑口から不足区間の遠い端まで）・ramp-radius・layer-ambiguous・seam_step・seam_hole・merge_skipped・let_go（auto）。スコアカードの `overlaps` は P2.7-1 の 4 類型のまま（前の版と比べられるように）。
- **作り直しの規則**: 追加しかしない（無くなった事例は `gone`、`--prune` で消す）／`blockHash` と実測値が同じなら触らない／変わったら実測値を更新し、`cap` + 余裕の内なら判断を保ち、超えたら `new` に戻して `previous` に残す／auto は条件を満たす間 `accepted`・`by: rule`／`--seed` は別の台帳の判断を key で引き継ぐ（同じ余裕の規則）／`--write-budget` で budget を今の件数に書き換える。2 回続けて実行して差が出ない、入力の順序に依らない（テスト・既定データ・ship で確かめた）。
- **ラチェット**: `budget` に地区 × 類型の件数、`open` の数、`qa` の無い changeover・parallel-ramp の数、継ぎ目の検査点の数、`*` の 4 種の件数。テストは `budgetOf(summary)` が `budget` と一致することを求める（増えても減っても落ちる）。
- **ビルドの `allowed`**: 規則か、その台帳で `accepted`・`wontfix` かつ `cap` + 余裕の内（`ledgerVerdict`）。台帳は出力先のもの（取っておいたもの）か `--ledger <path>`。T6 の半径の下限は台帳の ramp-radius の `cap` − 0.5 m（`rampFloorOf`）。
- **`dataHash`**（S5 の前提「ハッシュを丸めた値から作る」の答え）: block の run（ID 昇順）の書き出したチャンク（k 昇順）の JSON の SHA-256。ファイルの丸めた値から作るので solver の 1e-12 m の揺れでは変わらない。スコアカードの `partition.blocks[].hash`（解のハッシュ）はそのまま残した。既定範囲は 1 成分（1125559318）なので全事例が同じ block。

## 地区（`src/expressway/districts.ts`。R1-1a で確定、下の「P2.7 R1-1a」）

central（C1・Y・1・2・3・4・10・11・B）、east（5・6・7・9・S1、C2 の箱の外。箱をまたぐ C2 の run も east）、yamate（C2 のうち緯度 35.745 未満かつ経度 139.77 未満）、outside（表に無い ref: K1・S5 など。E 系の ref は `--run-borders cut` で切れて残らない）。本線は run の最初の way の ref（チャンクが持つ ref）と長さの中点、ref の無い本線・ランプ・street は親をたどる（始点側から）、だめなら最寄りの本線（線への距離）。計画から決める関数（`scope.ts planDistrictRuns`）とチャンクから決める関数は、書き出した run で同じ答えを返す。以下の 3 項目は P2.7-4 の時点の記録。

- 既定データの run と事例は全部 central。台帳の `ramp-radius:203873831` は必要な成分の run でタイルに書かれていない（点も親も無い）ので、事例の地区は run → 相手 → 同じ block の書き出した run（ID の最初）の順に決める（レビュー S6 の後。初版では outside だった）。
- ship/pruned・v1（出力 307 run）: central 164 run・229.1 km、east 96・168.4 km、outside 47・116.4 km（ref E1・S5・K1・E4・E6・`E14;14`）、yamate 0（`--below pruned` では山手トンネルの C2 本線が出ない）。スコアカードの planned / closed は central 174 / 10、east 98 / 2、outside 51 / 4。
- C2 の箱の境にかかる run: 156344609、28127113（どちらも east）。箱は変えていない（yamate の本線が ship に無く、確かめる材料が `--below all` の後になる）。

## 計測（trust signal、2026-11-11 UTC、M2 Max）

### 1. チャンクのバイト一致

`just compare-expressway-chunks <origin/main の public/data/expressway の写し> public/data/expressway`（`scripts/compareExpresswayChunks.ts`、v5・v6 のタイルの `chunks` だけを JSON で比べる）: **268 チャンク中 268 が同じ、違い 0・片方だけ 0**（A の作り直し 14:31Z、B の作り直し、#67 を取り込んだ後の最終の作り直し 15:43Z とも）。

### 2. 決定性

`just make-expressway-data` を 2 回（A の 14:31Z と 14:37Z）: 全ファイル `diff -r` で一致（間で書き換えた LICENSE.txt の説明を除く）。#67 を取り込んだ後の最終のコードでも 2 回（レビュー後、15:43Z 終了）、全ファイル一致。台帳の道具を同じフォルダに 2 回: 既定データでバイト一致（`unchanged` 73/73）、ship/pruned・v1（1,250 件）でもバイト一致。

### 3. 大きさ

|                                    | meta 生 / gzip   | タイル gzip 合計 / 中央値 / 最大 | タイル生 最大 | report.json 生 / gzip | ledger.json 生 / gzip                             |
| ---------------------------------- | ---------------- | -------------------------------- | ------------- | --------------------- | ------------------------------------------------- |
| 既定 v5（origin/main）             | 24,186 / 4,241   | 111,440 / 8,723 / 29,015         | 104,834       | —                     | —                                                 |
| 既定 v6                            | **1,035 / 458**  | 113,904 / 8,867 / 29,687         | 107,758       | 23,458 / 3,891        | 55,981 / 6,883（レビュー後。初版 54,928 / 6,722） |
| ship/pruned・v1 v5（基準 fixture） | 279,519 / 38,125 | 1,162,883 / 7,961 / 59,084       | 223,377       | —                     | —                                                 |
| ship/pruned・v1 v6                 | **1,993 / 605**  | 1,199,391 / 8,126 / **60,527**   | **230,582**   | 270,282 / 37,590      | 664,751 / 46,807                                  |
| ship/pruned・v2 v6                 | 1,993 / 604      | 1,092,618 / 7,212 / 56,991       | 225,451       | 270,000 / 37,587      | 653,528 / 46,195                                  |

- 予算超過（直していない）: ship v1 のタイル **14553-6451** が gzip 60,527 B（予算 60 KB を 527 B 超）・生 230,582 B（200 KB 超）。run の要約は 6,648 B で、超えの主因はもともとのチャンク（v5 で 59,084 / 223,377 B、生は v5 から超過）。v2 では gzip 56,991 B で収まり、生 225,451 B は超える。meta は既定・ship とも 30 KB の予算内。

### 4. 移行の対応表（既定データ、判断はそのまま）

| 移行前                                       | 移行後                                                                                                                                                                                                                                                                                                                          | 根拠                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| allowlist.ts の `*` 4 規則                   | allowlist.ts `RULES`（同じ上限）、台帳 `summary.rules` の件数                                                                                                                                                                                                                                                                   | 文言・上限の移動だけ                 |
| allowlist.ts の deck_overlap 16 組           | nose 6（by rule: 24402611\|4848762、45019020\|4848740、45019020\|4848755、45021972\|45021976、45021976\|45068172、45554540\|813455519）、changeover 7・parallel-ramp 1・other 1（45177678\|4848755、分合流でつながらない 0.06 m）・touchdown 1（24402611\|45021976）を accepted、`cap` は今の maxStations・maxDzM、理由は今の文 | 16 組とも前後で allowed              |
| allowlist.ts の ramp_radius 6                | ramp-radius:203873831（cap 13.4 m、既定データにある 1 件）。残り 5 件（203059412 R 11.7 m・203059413 10.7・24039815 14.5・5213291 13.5・761796514 11.6、ship の台帳で判断する分）の run は消し、理由の文は `RAMP_RADIUS_REASON`                                                                                                 |                                      |
| allowlist.ts の tunnel_cover_short 737538573 | portal-open-cut（auto、坑口から 106.5 m ≤ 150 m）                                                                                                                                                                                                                                                                               |                                      |
| T10 のインラインの件数 6 種                  | `budget.rules`（vertical_fallback 38・deck_below_ground 1・crossing 30・below_open 0）と `budget.cases`（重なり 16、ramp-radius 1、portal-open-cut 1）                                                                                                                                                                          |                                      |
| MERGE_MAX_DZ 超の一覧 45 件                  | merge_skipped 45 件 accepted（cap は今の区間・最大 \|Δz\|、理由は今の why）                                                                                                                                                                                                                                                     | 45 件とも key が一致                 |
| `SEAM_COUNT` 3,646                           | `budget.seamProbes` 3,646                                                                                                                                                                                                                                                                                                       | 下の 5                               |
| `SEAM_EXCEPTIONS` 3 件・`OPEN_HOLES` 1 件    | seam_step 2 件 open（45019020:40、45068172:1）。4848889:0・813455519:0 の例外と 24402125:0 の穴は事例として出ない                                                                                                                                                                                                               | 下の 5（検査点の置き方の誤りの訂正） |
| 手放しの点 8 か所                            | let_go 8 件（auto、段差 ≤ 0.3 mm）                                                                                                                                                                                                                                                                                              | 位置が 8 か所とも同じ                |
| 「台帳に無い組・未使用の項目」のテスト       | 台帳のテスト（new・gone が無い、数え直しと一致、cap + 余裕の内、規則だけで黙って通るものが無い）                                                                                                                                                                                                                                |                                      |

- 判定が変わらない根拠: 既定データの report.json は、旧 allowlist で `allowed` を決めた作り直し（A）と台帳で決めた作り直し（B）でバイト一致（87 件すべて allowed）。旧テストが見ていた条件（組ごとの上限、45 件の区間と \|Δz\|、8 か所の手放し）は台帳のテストがすべて見る。上限は余裕の分だけ広がった（下の逸脱）。
- 移行前のコード（origin/main eae6f3d）で既定データの全テスト 1,973 件が通ることを確かめてから移した（14:20Z）。

### 5. 継ぎ目のフレームの変更

手書きの 3 地点をやめ、チャンクのあるタイルの中心（既定 9 点）にした。**検査点は 3,646 のまま**、手放しの点 8 か所も同じ。ただし手書きの 3 地点の時の例外と穴はフレームに依っていた。原因は検査点の投影: 平面の位置を高さ 0 で `LocalFrame.toLocal` に掛けていたので、原点から d 離れた点は床版の頂点（楕円体高 h）に対して h·d/R だけずれる（h 60 m・d 1.5 km で 1.4 cm。検査は床版の縁の ±2 mm）。**投影を各点の高さで行うように直した**（`scripts/expresswayPairs.ts` の `Project` に z、パッドで区間の外へ出た点はチャンクの端の高さ）。直した後は手書きの 3 地点とタイルの格子で例外・穴・手放しの点が同じになり、段差の差は 1 mm 前後（float32 と原点の差）。

| 事例                                         | 手書きの 3 地点・高さ 0 の投影（移行前） | タイルの格子・高さつき（移行後）                                                                                                                   |
| -------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24402125:0 s 39–81（OPEN_HOLES、原因未特定） | 13 点で面に当たらない                    | **面に当たる**（内側の差 ≤ 6 mm）。穴は投影の誤りだった（縁の −2 mm の検査点が 2 枚の床版の共有辺に乗っていた。±1 mm なら面に当たり段なく続く）    |
| 4848889:0（段 4.5 mm）                       | 例外                                     | 規則の内                                                                                                                                           |
| 813455519:0（内側の面 5.5 cm、原因未特定）   | 例外                                     | 規則の内                                                                                                                                           |
| 45019020:40（18 mm の段）                    | 例外                                     | seam_step open（段 17.9 mm・内側 15.3 cm）                                                                                                         |
| 45068172:1 s 298.9                           | 規則の内                                 | **seam_step open**（段 4.7 mm、\|Δz\| ≤ 5 cm で 1 mm 規則）。s 297.85・298.35・298.85・299.35 で 36・20.5・4.6・0 mm の段（1 mm の規則に掛かるのは | Δz  | 5 cm 以内の s 298.9 だけ）。手放し s 295.5 の約 3 m 先で、45019020:40 と同じ型（手放しの先の継ぎ目の段）。旧フレームから 1.19 km で、高さ 0 の投影では検査点が半径方向に 8 mm・縁に直角に約 3 mm ずれていた |

### 6. 作り直せることの確認（判断はしない）

既定の台帳で `--seed`（ship の 2 本は `--ledger public/data/expressway/ledger.json` でビルド）。件数は地区 × 類型の全件（括弧内が `new`）。

| 類型            | ship v1 central  | east       | outside  | ship v2 central  | east       | outside  |
| --------------- | ---------------- | ---------- | -------- | ---------------- | ---------- | -------- |
| nose（rule）    | 27               | 25         | 4        | 35               | 21         | 3        |
| changeover      | 14（7）          | 15（15）   | 1（1）   | 14（8）          | 18（18）   | 2（2）   |
| parallel-ramp   | 45（44）         | 43（43）   | 20（20） | 45（44）         | 41（41）   | 19（19） |
| touchdown       | 3（2）           | 1（1）     | —        | 3（2）           | 1（1）     | —        |
| other           | 15（14）         | 12（12）   | 4（4）   | 14（13）         | 11（11）   | 5（5）   |
| portal-open-cut | 11（9）          | 1          | 3（3）   | 11（9）          | 1          | 3（3）   |
| ramp-radius     | 2（1）           | —          | —        | 2（1）           | —          | —        |
| layer-ambiguous | —                | 1（1）     | —        | —                | 1（1）     | —        |
| seam_step       | 82（80、open 2） | 84（84）   | 37（37） | 82（81、open 1） | 75（75）   | 44（44） |
| seam_hole       | 9（9）           | 2（2）     | 2（2）   | 8（8）           | 4（4）     | 2（2）   |
| merge_skipped   | 244（199）       | 192（192） | 92（92） | 249（219）       | 184（184） | 95（95） |
| let_go          | 104（10）        | 104（10）  | 51（3）  | 97（8）          | 92（7）    | 49（2）  |

- ship v1: 1,250 件、`new` 897（S5 以降の作業量の見積もり）、規則で通る 295（nose 56・portal-open-cut 3・let_go 236）、seed の判断が保たれた 58 件（既定の 58 件すべて）。検査点 64,372。portal-open-cut 15 件の坑口からの長さ: 13・106.5・122.7・230・254.5・341・345・770・1,511.8・1,515・2,185・2,194.9 m と坑口の無い 3 件（150 m 超 9 + 坑口なし 3 = 12 件が listed）。
- ship v2: 1,231 件、`new` 907、規則 283、seed の判断が保たれた 41・`new` に戻った 11。v1 との差（全件）: nose +3、changeover +4、parallel-ramp −3、other −1、seam_step −2、seam_hole +1、let_go −21、他は同じ。
- 既定範囲・v2（`--out`）: 79 件、seed の判断が保たれた 54（規則の 19 を含む）、`new` に戻った 11、新しく出た 14（うち `new` 8、規則 6）、無くなった 8（let_go 2・merge_skipped 5・seam_step 1）。`new` の計 19（changeover 1・seam_step 3・merge_skipped 15）が S5 の既定範囲の再 QA の見積もり。`*` の vertical_fallback 38 → 29。

### 7. 基準 fixture（スコアカード版 6）

`tests/fixtures/expresswayScorecard.ship.json` を ship/pruned・v1・components・`--ledger public/data/expressway/ledger.json` で作り直した。旧 fixture（版 5）に対して changed 18・added 43・removed 5。変わった欄は `diagnostics`（deck_overlap・ramp_radius・tunnel_cover_short の allowed / notAllowed）、`overlaps.nose`、`size`（タイル・meta、`byField` の runs・diagnostics・entrances・closed・solver が消え `record` が足された）、足されたのは `districts`・`ledger`。`runs`・`closures`・`violations`・`tracking`・`partition` は同じ（幾何が変わらないため）。

| 「未許可」                                  | 旧い数え方（版 5 の fixture） | 新しい数え方（版 6）                              |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| 重なりの組 / 測点                           | 213 / 2,203                   | **163 / 2,097**                                   |
| 　nose / parallel-ramp / changeover / other | 50 / 107 / 25 / 31            | 0 / 107 / 25 / 31                                 |
| ramp_radius allowed / notAllowed            | 2 / 0                         | 1 / 1（旧 allowlist の全域用の 1 件が台帳に無い） |
| tunnel_cover_short allowed / notAllowed     | 1 / 13                        | 3 / 11（坑口から 150 m 以内の 2 件が規則で通る）  |

## 逸脱

1. **継ぎ目の検査点の投影を直した**（上の 5）。指示は「フレームを替えても同じになることを確かめる」だったが、高さ 0 の投影のままではフレームの位置で結果が動く（例外・穴が出たり消えたりする）ので、検査そのものの誤りとして直した。これで移行前の例外 2 件と穴 1 件が消え、段 1 件（45068172:1）が新しく出た。新しい段は判断の余地が無いので `open`（直す予定の欠陥）で載せた。
2. **touchdown の 24402611\|45021976 は `open` でなく `accepted`**: 指示 5.2 は既定データの touchdown を `open` としていたが、`open` は `allowed` にならないので移行で判定が変わる（9 節の条件に反する）。C1 の移り変わりの許可（cap 29 測点・6.57 m）のまま、理由に「P2.7-3a で 1 測点だけ行を外した組、許可か同一面かは S5」と足して移した。
3. **余裕で上限が広がった**: 判定（`allowed`・テスト）は `cap` + 余裕で見るので、旧 allowlist の上限ちょうどより緩い（例: 測点 +2、\|Δz\| +5 cm、半径 −0.5 m）。既定データの判定は変わらない。
4. **ledger の `by` は `new` で null**（`rule`・`review` のどちらでもない）。`gone` は判断を `previous` に移し `cap` を空にする。
5. **道具は tsx + `scripts/assetUrlHooks.mjs`**: 継ぎ目の検査は床版の組み立て（`src/world/expresswayDeck.ts`）を使い、それが Vite の `?url` の画像を import するので、tsx に Node のモジュールフックを足して画像を文字列にした。
6. **スコアカードの `ledger`** はそのビルドが `allowed` に使った台帳の summary（作り直す前のもの、計測用フォルダは `--ledger` の台帳）で、そのビルドの事例の数ではない。ship の事例の数は計測用フォルダの台帳（道具を掛けた後）にある。
7. **isTestSection の分岐**は `isDefaultBuild`（既定の範囲で作ったデータ）に置き換えた。既定範囲の run 構成と 1 MB の目安の 2 件だけが残る。T1〜T7・T12 などチャンクの検査は地区で `describe.each`（`XW_DISTRICT` で 1 地区）。

8. **nose:24402611|4848762 が規則に移った**: 浜崎橋 JCT の組で、旧 allowlist では固有の理由（HAMAZAKIBASHI_REASON「浜崎橋 JCT で 1 号羽田線への分岐（4848762）のノーズが内回りと同一面、外回りの 1 段上（OSM layer）を同時に求められ、内回りと外回りの移り変わりと重なる。三者の OSM の線が 1.3–8 m に集まり、全部は満たせない」）と上限 6 測点・0.14 m（`SAME_SURFACE_ALLOWED_DZ_M` の根拠）を持っていた。分合流でつながり 0.13 m なので nose の規則（≤ 0.5 m、測点数は縛らない）で通る。`NOSE_REASON` から「1〜2 測点」を外した（ship v1 で規則が通す nose 56 組のうち 14 組が 3〜7 測点、レビュー W3）。`SAME_SURFACE_ALLOWED_DZ_M` 0.14 は値と意味（既定データで受けた同一面の最大）を変えずに残した。
9. **レビュー（Fable、Approve）の後の修正**: 台帳の道具が report.json の `allowed` を台帳から書き直す（`reallowRecord`、判断の後に作り直しは要らない。`open` は継ぎ目の類型だけ: 診断由来の類型を `open` にすると T10 が落ちる）／実行時の等価のテストを点ごとに新しい `ExpresswayDecks` で読み、`GRAPH_RADIUS_M` 1,300 + 300 + 150 m < z14 タイル（北端 35.87° で約 1,982 m）を定数で縛る／類型ごとの `cap` の必須欄（`CAP_FIELDS`）をテストで求める／ビルドは台帳を出力先を消した直後に戻す（途中で落ちても消えない）／`expressway_ledger_read` の件数を needed の run に絞る／未知の `XW_DISTRICT` は落とす／runs の無いタイルは読み込み失敗として警告する。

## 落とし穴

- 台帳の事例の `measured` は診断の文字列（|Δz| 2 桁）から作る。総当たりの再計算（テスト）とは 1 cm 以内でずれる。
- 既定範囲は 1 成分なので、どこか 1 か所の変化で全事例の `blockHash` が変わる（規則 2 で触らずに済む事例が無い）。block を細かくするのは S5 の blocks。
- 道具は事例の key に類型を含む。nose が 0.5 m を超えると key が変わり、旧い key は `gone`・新しい key は `new` になる（判断は引き継がない）。

## 気づいた欠陥（直していない）

1. ship v1 のタイル 14553-6451 が gzip 60 KB・生 200 KB の予算を超える（上の 3）。
2. （レビュー S6 で直した）台帳の事例の run がタイルに無いと地区が outside になっていた。今は相手か同じ block の run の地区。
3. 45068172:1 s 298.9 の 4.7 mm の段（新しく見えた、原因未調査）。45019020:40 の 18 mm の段は前から。
4. 表に無い ref が outside に入る: `E14;14`（複数 ref のタグ）、S5、K 線・E 線。14 号線を表に足すかは地区を確定する時（S6・S7）に。
5. ship の seam_hole 13 件（v1）・seam_step 200 件余り: 継ぎ目の検査を全域に掛けたのは初めてで、多くは未判断。
6. スコアカードの `size.ledger` はビルド時に取っておいた台帳の大きさで、道具を掛けた後の大きさではない。

[^p274]: 指示は scratchpad の p27/s4-ledger-v6.md（設計 Fable）。計測のフォルダは .cache/expressway-area/s4-ship-v1・s4-ship-v2・s4-default-v2、スコアカードは .qa/expressway/ の同名。

# P2.7-5: 縦断の目的 v2 の有効化と既定範囲の再生成（2026-11-12）

S5。縦断の目的 v2 を既定にし、既定データを作り直した。ユーザーの注意「PLATEAU（DEM）は凸凹なので地表に追従させない」を出荷データに反映する最初の段。[^p275]

## 範囲の見直しと線引き

- **S5 で既定にしたのは v2 だけ**。blocks と pruneBelow の廃止は、地下を全面的に扱う S7 で対にする。理由（S2〜S4 の実測）: blocks × v2 は強制なしの反転が 0.82〜0.83 回/km で 0.8 を超える、子の閉鎖と交差の記録が範囲で変わる前提が残る、blocks の利得は `--below all` のときだけ、pruneBelow を外すと未レビューの地下 run の解が既定範囲の高さに入る。
- S5 で片付けた前提: 非収束時の解き直し、測点間の T2、高さの予算、台帳の `new`、既定範囲の再 QA、走行の経路表。S6 へ: 分合流で本線が譲る件（`tracking.junction` σ 0.579 m）、継ぎ目の段の原因、同じ場所へ降りる組の全クラス化・並走ランプ・地平 run、**並走する上下線の高さ**（下）。S7 へ: blocks × v2、pruneBelow の廃止、地下の分合流。

## 作ったもの

| 項目                   | 内容                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 非収束時だけの解き直し | `vertical.ts solveRetrying`: 1 回目が収束しなければその QP だけ `RETRY_DUAL_TOL` 1e-5 で解き直す（収束した解は 1 ビットも変えない）。回数は report.json の `solver.retried`（0 なら欄を出さない）、スコアカード `solver.retried`、ログ `expressway_solved.retried`                                                         |
| 測点の書き方           | 必須の測点（チャンクの両端・節点）から `MIN_STATION_GAP_M` 3 m 以内の測点を落とし、短くて上限に近い区間だけ（`stationDigitsFor`）z と勾配を「書いた s（1 cm）」で取り z を 0.1 mm で書く（`STATION_DIGITS`）。s は 1 cm のまま                                                                                             |
| 高さの予算             | 一律の天井は置かない。台帳の類型 `high-deck`（`highDeck.ts`: 高架・構造物の床版でない・強制の無い区間で地表から 20 m 超が 50 m 以上、cap は `heightM`・`spanM`、余裕 +0.5 m・+20 m）と、台帳の `budget.heightKm`（地区ごとの 15・20 m 超の km、0.5 km 単位に切り上げた上限。テストは上限以下）                             |
| 既定の目的             | `scripts/expressway.ts --objective` の既定を v2 に。v1 は比較用で `--out` が無ければ止まる。`--below`・`--partition` の既定は不変、`XW_VERSION` 6 のまま                                                                                                                                                                   |
| 走行の経路表           | `scripts/qa/deckRoutes.ts`（run と run 距離で書く 9 経路）、`just check-deck-drive <label> <route\|all>`。合否に床版の上の max \|dy\| 0.15 m、自動運転は到着と違反 0（`deckDriveVerdict.ts`）。走行フックは 1 サンプルで 15 km/h 超落ちた瞬間を `drops()` に残す（触れた物・近くの交通・道路網と床版コライダーの入れ替え） |
| 視点表                 | expressway に台場側（`daiba`）・1 号羽田線（`haneda`）のセッション、大きく動く run の運転席と側面、台帳の事例（changeover・other・seam・merge_skipped）の俯瞰。運転席・側面の expect に v2 の狙いを 1 行                                                                                                                   |

## T2（面の勾配 5.01 %）の原因

上限 × GRADE_MARGIN（4.975 %）の直線勾配で測点の間隔が 2〜4 m の区間。z の 1 mm と s の 1 cm の丸めで書き出した区間の勾配が 5.000 % になり、エルミート面は区間内で「1.5 × 区間勾配 − 0.5 × 端の勾配」まで振れて 5.0125 %。丸めない z なら 4.975 %。事例: 45248411:23（5505.6–5507.74、2.14 m、チャンク端と節点の間）、24636451:0（150.78–153.58、2.8 m）、28127108:37（9970.45–9974.63、4.18 m）、780870438:7（2257.89–2260.21、2.32 m、端から 0.5 m 以内の節点をまたぐ）。同じ型が 45019020:4・4848762:5・888066403:48 にも（S3 の計測フォルダに `.cache/s5/t2diag.ts` を掛けた）。28188273:39 は残っている出力に無かった。

- 採らなかったもの: `GRADE_MARGIN` を下げる（全 run の解が動き、登りが紙一重の run を閉じうる）、チャンクの境界を節点へ寄せる（どの節点で曲率が変わるかは解が決めるので、blocks の I3 が落ちた）、s を細かく書く（parentS の 1 cm と 1 mm で突き合わせる `expresswayRoads.ts` で 4848762:33 → 4848889 の diverge と 4848755 の merge が切れた。signals のテストで検出）。

## 計測（trust signal、2026-11-11 UTC 16:05〜19:00、M2 Max）

ラベルは `.qa/expressway/s5{a,b,c,d,e}-*`（実行の記録は `s5-runs.jsonl`、6〜8 本並列）。s5a = 4.1 の後、s5e = 4.2 の最終版。

| 項目             | 結果                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 の後の v1    | `just make-expressway-data` の後、既定データは差分なし（16:05Z）。ship/pruned・v1 と基準 fixture の差は `solver.retried` の追加だけ（と、S4 の fixture の後の ramp-radius の地区の修正分）                                           |
| 解き直し         | ship/pruned・v2・`--grade-change 2`: 解き直し 2・未収束 0。v2 の pruned・all・blocks k=1.5 の 2 本・既定範囲: 解き直し 0・未収束 0                                                                                                   |
| 4.2 の前後（v1） | 面の高さの差 最大 1 mm（ship/pruned・既定範囲）。T2: ship/pruned 2 → 0。T1・T3 は 0 のまま。測点 44,917 → 44,135（既定 4,459 → 4,378）、0.1 mm で書いた測点 2.8 %。タイル生の最大 230,582 → 230,047 B、gzip の最大 60,527 → 60,289 B |
| 4.2 の後の T2    | v2 の ship/pruned・ship/all・blocks k=1.5 の pruned・all、gc2: すべて 0                                                                                                                                                              |

v2 の確定値（v1 は同じ below、s5e）:

| 項目                                   | ship/pruned                                                                | ship/all                        |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| 強制なしの反転（≤ 0.8）                | 1.674 → **0.766**                                                          | 1.669 → **0.776**               |
| 強制なしの短波長相関 / σ（未達、記録） | 0.554 → 0.228 / 0.696 → 0.433 m                                            | 0.550 → 0.226 / 0.683 → 0.433 m |
| 閉鎖 本線 / ランプ、根                 | 4 / 12、14 本が同じ一覧                                                    | 14 / 30、17 本が同じ一覧        |
| violations                             | T12 1（v1 と同じ）                                                         | T12 1                           |
| 未許可の重なり 組（×1.05）             | 163 → 164                                                                  | 147 → 149                       |
| 高さ 中央値 / p95                      | +0.81 / +1.53 m                                                            | +0.80 / +1.47 m                 |
| 15 / 20 m 超の km                      | 34.7 / 12.9 → 50.4 / 14.8                                                  | —                               |
| high-deck                              | 0 → 2（203832852 central 216 m・24.0 m、1467911980 outside 209 m・24.0 m） | 2                               |

既定データ（v1 → v2）: 2 回生成してバイト一致（16:56〜17:00Z、17:05〜17:11Z、round-01 の後 18:44〜18:48Z）。全 4,215 測点の |Δz| p50 0.278・p90 1.82・p99 4.984・最大 10.548 m。run ごとの最大は 4848889 +10.55（s 496）、45021976 +5.07（671）、4848755 +4.87（439）、45021972 +4.29（0）、45177681 +3.76、45177678 +3.74、24402611 +3.37（1846）、45554540 +2.66、737538573 −2.38、4848740 +2.24、45019020 +2.22、45068172 −2.02、4848762 +1.67、895902565 +1.17、残りは 0.6 m 以内。1 m 超の区間 42（`.qa/expressway/s5-height-diff.json`）。段: 4848889・4848740 が specialGrade>lowerSpeed → standard、4848755 が → specialGrade。チャンク 4848755:4・4848889:4 が無くなった。診断 vertical_fallback 38 → 29、deck_overlap 16 → 18。violations・閉鎖・dangling・deckMismatch 0。T8: ship/pruned・v2 と高さは全部同じ（違いは `signs` の 16 チャンクで、v1 でも同じ、範囲による）。15 / 20 m 超 central 12.66 / 9.23 → 13.34 / 9.37 km（上限 13.5 / 9.5、大半はレインボーブリッジ）。

床版の組み立て（`expressway_decks_built` の最大スライス、芝公園・麻布台・芝浦 × 3 回、参考）: v1 4.1〜5.8 ms、v2 4.1〜5.1 ms。どちらも 9 回中 9 回が 4 ms を超え、増えていない。

## 台帳の判断（round-01 の Fable レビュー）

判断が保たれた 59、`new` 19（changeover 1・merge_skipped 15・seam_step 3）、`gone` 8（let_go 2・merge_skipped 5・seam_step 1、`--prune`）。レビューの結論: changeover 1 と merge_skipped 15 を accepted（cap は実測値、qa は視点）、seam_step 4（24402125:0・45019020:40・:41・4848889:0、段 0〜3.5 mm）を open（45019020:40 は cap を 3.5 mm・内側 0.4 cm に締めた）。merge_skipped のうち 3 件は判断案が v1 の別の事例と照合していたので理由を書き直した（照合を run の組だけでなく s の区間でも見るよう直した）。`budget.heightKm` は central 13.5 / 9.5 km。seam_step:24402125:0 は段 0 mm だが内側の面が 15.8 cm ずれる（汐留出口の分流、open）。

## 多視点レビューで直したもの

- **門型が白い板を突き抜けた**（crossing-c1-24、24402611:26 の 110-B）: 板は PLATEAU の建物の屋根（路面から +6.77 m、建物は地表から）で、**遠景（far skyline）のタイル**のもの。床版の切り下げ（`Buildings.cutAboveDecks`）は近景のタイルだけに掛かっており、近景が読み込まれていない所で遠景の屋根が床版の上に残っていた（v1 では床版が 1.5 m 低く、門型が屋根の下に収まっていた）。遠景のタイルにも切り下げを掛け（準備時と、後から来た床版に対して）、`localMatrix` が遠景のグループの下も見るようにした。縦断の天井に入れる案は採らない（PLATEAU は凸凹で路面に使わない、コンパイラは PLATEAU を読まない）。
- **門型の中央側の脚が相手の車道に立つ**（G6 から、6 基）: 内外回りが 1 枚の床版の区間では、P3.5 の分離壁（外面どうしの重なりの中央）の上に中央側の脚を立てる（`XwSign.divider`、`signPlan.dividerAt`、`deckMount`）。テストは脚が重なりの中央にあることを独立に数え直して見る。
- **トンネルの箱の中の街路灯**: `StreetLights` が地形の穴（`GroundCuts`）の内側の街路灯（collider も）を隠す。
- **掘割の擁壁の天端と右の路面の間の抜け**: 擁壁の天端を、中心線の地表 1 点ではなく左右それぞれ壁の位置（内面・外面・その 1 m 先）の地形の高さの最大 + 0.4 m に取る（低い方は中心線の高さを保つ）。`ExpresswayDecks` に DEM の地表（`dem.heightAt`）を渡した。
- 視点: 側面の 5 視点を床版の横 70〜80 m・床版の高さの free カメラに、seam-24402125-0 を低い横から、expect の数値を確定データに、seam-4848755-3 を外し、トンネル表に外回り 895902565 の運転席と低い斜め俯瞰、標識表に 108の2-C の門型を正面から低く見る視点、110-B の 300 m を 200 m に。

## 走行

| 経路                                        | v1（前）                                                    | v2（round-01）                        |
| ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| shibakoen-shiodome                          | 落ち込み 52.4 km/h @24402611:27（不合格、撮り直しでは合格） | 52.2 @24402611:27（不合格）           |
| auto-shibakoen-shiodome                     | 到着・違反 0・\|dy\| 0.096                                  | 到着・違反 0・0.097                   |
| auto-shiodome-shibakoen                     | 到着・違反 0・\|dy\| 0.149 @45021976:10                     | \|dy\| 0.164 @45021976:10、xwStopping |
| rainbow 4 経路・daiba-exit・azabudai-tunnel | \|dy\| 0.072〜0.118                                         | 0.072〜0.116                          |

- **24402611:27・:29 の落ち込み（原因は 2 つ、どちらも実行時の側）**: (a) :29 の 47 → 28 km/h は、一般道の**路上駐車の車が床版の上に置かれていた**ため（S5 で修正）。`TrafficAI.parkedSteps` は幅 4〜13 m の線から選ぶが首都高のチャンク（片側 2 車線で 9.5 m）もそれに入り、橋の床版を地表とする所では床版の高さで内回りの第 1 車線に駐車した（`.cache/s5/step.ts` で床版の上を格子で下向きに撃って見つけた）。チャンク（`xid` のある線）には駐車しない（`tests/trafficStreaming.test.ts`）。(b) :27 の 47 → −2 km/h（s 31.3、35.657115, 139.760083、毎回同じ所・毎回ではない）は、**高架の下を通る一般道の街路灯の柱（10〜12 m）が床版を突き抜けて残り、床版の上の車がその柱のコライダーに当たっていた**ため（別の担当の PR #70、main 51cc365 で修正: 足元の上に床版がある街路灯は描画も当たり判定も作らない、信号柱・オービスの柱は頂が床版に届けば当たり判定を作らない）。走行フックの記録で車体が触れた物が 0 だったのは、当たった瞬間の後のサンプルでしか見ていなかったから。S5 はこの修正を取り込んだ。
- xwStopping は走行スクリプトの競合（入口の取付けに置いてから `advance(3)` で実時間 10〜13 s、`XW_LAW.standS` 10 s を超えた）。置いてすぐ発進するようにした。

## round-03 の走行（PR #70 を取り込んだ後、2026-11-12）

9 経路と、P3 の経路・自動運転 2 経路を 3 回ずつ: すべて合格・invalid 0・急減速（drops）0。P3 の経路は落ち込み 4.9〜5.0 km/h（24402611:27 の停止は消えた）。自動運転は到着・違反 0（6 回）。max \|dy\| は auto-shiodome-shibakoen で 0.108〜0.113 m（45068172:1 の s 135 のサグで vy −0.88 → +0.67 m/s、懸架が縮む分。区間の端の取り違えではない）、他は 0.072〜0.116 m。

## round-02 で直したもの

- **収束判定が外した視点で止まる**: `check-convergence` は各周をその周の run.json のコマで検査する（`runRecord.roundShots`、外した視点 seam-4848755-3 のある round-01 も読める）。round-01.jsonl は書き換えない。
- **(2a) \|dy\| 0.16 m は検査側の取り違え（4.4 からの逸脱）**: 自動運転の走行（`route()`）は `cruise({})` を優先する run なしで呼び、`graph.locate` は規制の遅い区間を勝たせるので、境 45021976:10→:11（s 1264.19）を越えても 4.8〜5.2 m の間 :10 の終点（z 15.410）に張り付いた（面の差 0.19〜0.21 m）。直す前の記録（`.qa/drives/s5-pre2a`）で +0.131 のサンプルは `at` = 区間長 175.78、vy は 0.83 → 0.64 で跳ねなし。走行フックのサンプラは、区間の端に張り付く hit のときは同じ run の別の区間の内側の hit で測る（`insideHit`、`tests/expresswayDriveHit.test.ts`）。床版・上限 0.15 m・ゲームの locate は変えない。
- **箱の中の淡い帯（slab-in-bore）**: ~~箱の中に残るのは遠景の地面（FarGround）~~ **訂正（round-03 のレビューと round-04 の特定）**: 遠景の地面ではなかった（round-03 のコマは近景の正方形が揃い遠景の待ちも 0 で、帯が残っていた）。正体は下の「round-03 の後に直したもの」。`settled()`（`isWorldSettled`）に近景の正方形が全部揃うこと（`Terrain.isSquareComplete`）と遠景の建物の準備待ちが 0 であることを足したのは、撮影の待ちとしてはそのまま残す。
- **箱の中の街路灯**: 組み立てるときと、穴が後から来たとき（`expressway.onBore`）に、距離と周期に依らず穴の内側の街路灯を隠す（`StreetLights.hideInCuts`）。
- **擁壁を貫く一般道の路面のくさび**: 路面の三角形を、重心だけでなく頂点が 1 つでも穴の内側なら落とす（`groundCuts.dropCut`）。
- 遠景の切り下げに単体テスト（`prepareFarTile` が `cutDecks` を呼ぶ）、視点の対象を今そこにあるチャンクへ付け替え（浜崎橋の deck-* はスタートに近い 24402611:20）、台場の俯瞰を 150 m に、expect の v2 の行を本線とランプで書き分け。

## round-03 の後に直したもの（2026-11-12）

round-04（2026-11-12 08:58〜09:55 JST）: 撮影は 3 表 205 コマで失敗 0。走行は 9 経路を 1 回と、P3 の経路・自動運転 2 経路をさらに 3 回ずつ（`.qa/drives/s5-r04-*`）。すべて合格で、invalid・停止・急減速（drops）・置き直しは 0、自動運転は到着・違反 0。max \|dy\| は auto-shibakoen-shiodome 0.097、auto-shiodome-shibakoen 0.107〜0.113（45068172:1）、P3 の経路 0.089、他は 0.072〜0.116 m。

推測で直さず、先に正体を特定した。視点の撮影に `--pick x,y[;x,y…]`（`scripts/qa/views.ts`）を足し、各コマのカメラから画面の座標へレイを飛ばして当たった物（名前・親・頂点色・インスタンス）をコマの JSON の `scene.picks` に書く。見分けのため PLATEAU の歩道のメッシュを `pavements`、一般道の路面を `road-surface` と名付けた。

- **箱の中の淡い帯（north-exit-driver、画面 (200,330)）の正体は PLATEAU の歩道（`pavements`）**: 直す前の動作で撮り直すと、4 回のうち 1 回、(200,330) の最初の当たりが `pavements`（4.47 m、頂点色なし）になり帯が写る（他の回は箱の壁 `expressway-737538573:2` の 9.34 m）。原因は穴の後からの敷き直しの取りこぼし: 道路の読み込み中（`roadsLoading`）に来た穴は「道路自身の組み立てが穴を切る」として敷き直しを飛ばしていたが、歩道は道路と別に読み込まれ、その読み込みの分はもう穴なしで組み上がっていることがある。飛ばした穴は二度と敷き直されず、箱の中に歩道の縁石が残った。読み込み中に来た穴は持っておき、読み込みが終わったら敷き直す（`groundCuts.CutRelay`）。実データのテスト: 737538573:2 の掘割（s 515〜596、s 490〜513 は屋根の上に地表があり穴が無い）の路面の上を 2 m × 1 m で下向きに数え、穴が道路の前・読み込み中・後のどれに来ても歩道と路面の面が 0（`tests/expresswayBore.test.ts`）。修正後の撮り直しでは昼夜とも帯が無い。
- **トンネルの中の「街路灯」（tunnel-toward-exit、画面 (620,312)）は街路灯ではない**: ~~坑口に立つ制限速度 50 の標識~~ **訂正（round-04 のレビューと round-05 の特定）**: 50 の標識は画面 (614,351) の直径約 4 px の円板として別に写っていた（895902565:0 の s 5 の標識を投影すると (615,355)）。柱・腕に見えた物（x 610〜624・y 308〜350）は帯の出たコマにだけ写る。CutRelay を一時的に外して帯が出る状態で撮り直し、x 606〜626・y 304〜352 を 1 px 刻みで --pick すると、当たりは `pavements`（61〜94 m、38 点）だった。当たった点は港区 PLATEAU LOD2 の交通島（AuxiliaryTrafficArea の「島」、29 頂点、35.66381〜35.66480・139.738466〜139.738702）で、737538573:2 の s 537〜571 m・中心線の左 1.6〜3.3 m、38 点中 35 点が島の輪の内側（レビューの計算。こちらの粗い計算では s 530〜575・2〜10 m・15 点だったが、カメラの向きの近似が粗かった）。路面からの高さは 5.3 → 2.6 m で、同じ測点の地表 5.47 → 2.44 m と一致する。つまり、土被りの足りない坑口手前で地表の面（そこに敷かれた島）が箱の内空に入っていた。帯（slab-in-bore）と同じ歩道のメッシュで、原因も同じ（読み込み中の穴の取りこぼし）。CutRelay で敷き直すと、この島は穴に触れて外される（`pavementsOffCuts`）。テストは実際の島 2 つの輪で、穴の前は箱の中にあり、穴が読み込み中に来ても敷き直した後は 0 であることを見る（`tests/expresswayBore.test.ts`）。街路灯の灯具を全部投影しても、そこに来るものは無い（これは正しかった）。
- **street-sliver-through-wall（south-portal-driver、画面 (800,285)）**: 最初の当たりは地形の正方形 `terrain-29103-12905`（12.84 m）で、その奥に箱の壁 `expressway-737538573:0`（13.55 m）。擁壁の天端の外の地形が見えているもので、一般道の路面ではない（round-02 の `dropCut` の後、路面の当たりは無い）。
- **撮影の読み込みで車が地下へ落ちる（標識表 shibakoen-entrance、car_respawned underground）**: 読み込み後 5.25 s、道路ができた時の `placeOnStreet` で車がスタートから 45 m の 35.653072, 139.749609（高架 45021976:14・4853798:0 の下の一般道、穴ではない）に地表 +0.8 m で置かれ、そこに床のコライダーがまだ無く 1 s で −5.9 m まで落ちて置き直される（12 m 先に着地して止まる）。全部読み込んだ後に同じ所へ置き直すと落ちずに立つ（地表 0.28 m の上 1.04 m）。床（路面・地形）のコライダーができる前に置く、読み込み直後だけの順序の問題。走行の記録に落下は無く S5 の合否に効かないので直さない。
- 視点: deck-driver-40 の路面の探りを車線境界線の破線の通る 0.38–0.52 × 0.52–0.68 へ、deck-below の桁を 0.3–0.6 × 0.55–0.62、deck-side の壁高欄を 0.3–0.7 × 0.47–0.53 へ、crossing-c1-19 の目を古川の床版の軸の 70 m 手前・T.P. 45 m に置いて床版に沿って見下ろす、rb-shibaura-ground の対象を注視点に合う 4848762:21（0.24）へ、changeover-c1-895902565-oblique を高度 100 m・俯角 48°・angleDeg 90 に。

round-05（2026-11-12 10:45〜11:10 JST、tunnels だけ）: 修正後の確認撮影（`--out .cache/s5/vt-r5-fixed`、周番号に入れない）で、トンネルの中の 6 視点（昼夜）は --pick の当たりに `pavements`・`road-surface` が 0。外から見る視点の当たりは、掘割の上を渡る街路（箱の屋根の上）と穴の外の街路。round-05 は 22 コマで失敗 0、azabudai-tunnel の走行は合格（max \|dy\| 0.088、drops 0）。

## PR #71 のコードレビューで直したもの（2026-11-12）

- **W1 遠景のタイルの行列の二重変換**: 遠景のタイルの準備（`prepareFarTiles`）は、読み込み後のフレームでまとめて行う。3d-tiles-renderer は update の中で `setTileActive` がタイルを遠景のグループの下に付け、その後に準備が走るので、その周に active になったタイルは準備の時点で既にグループの下にあり、ワールド行列はローカルになっている。それを ECEF として `ecefToLocal` をもう一度掛けていた（レビューの実測で準備 38 枚中 12 枚、cutMesh 39 回中 12 回が平行移動 1e6 m 超で、切り下げが効かない）。準備はメッシュ自体を host に渡し、`localMatrix`（グループの下かどうかを見る）でローカル行列を、その逆で ECEF 行列を取る（`FarTileHost.toEcef`・`cutDecks(geometry, o)`）。同じ前提だった遠景のファサードの高さ（`addFacadeAttribute`）とランドマークの穴（`cutFootprints`）もこの ECEF 行列を使う（PR より前からの同じ型）。近景のタイルは load-model の中で準備し、そのときはまだグループに付いていないので影響しない。テストは、切り離した状態とグループの下の両方で、床版の上の屋根の頂点が下がることを見る（`tests/farMemory.test.ts`。直す前のコードではグループの下の方が落ちる）。
- **W2 穴の並び**: `GroundCuts.ringsLonLat()` は z15 のキーの順に並べていたので、既に穴のある z15 の中に後から来た穴が列の途中に入り、`CutRelay` の「末尾が新しい穴」という前提が崩れて敷き直しが飛んだ（:0 → 遠い穴 → :2 の順）。穴を届いた順に持つ（`arrivals`）。
- **W3 掃引の重みで出荷データを上書きできた**: v2 の重みのフラグ（`--grade-change`・`--reach`・`--reach-below`・`--target-scale`）は、`--out` なしでは止める。`--below all`・blocks・v1 と合わせて `scripts/expresswayGuards.ts` の `shippedFolderRefusal` にまとめた。
- **W4 撮っていない視点があっても収束と判定した**: 収束判定の「撮影が揃っている」は、その周の run.json ではなく今の視点表の全コマで見る（`runRecord.roundRead`）。外した視点の許容は、読む対象のコマ（`roundShots`）だけに使う。
- 他: high-deck の cap に s0・s1 を入れた。`settled()` は遠景の読み込みの進み（`farProgress`）も待つ。R キーと retrained の置き直しは info の `car_put_back` に分けた（`car_respawned` は地下・漂流の warning だけ）。コメントの置き違い 3 か所と、テストの題・it の外の expect を直した。
- **残るテストの穴**: `tests/expresswayBore.test.ts` は `CutRelay` そのものを検査するが、main.ts の配線（道路の読み込みの `.finally` で保留があれば `relayCuts` を呼ぶ）は縛っていない。配線を外すと帯が戻るが、テストは通る。

## 記録だけ（S6 へ）

- **外回り 895902565 の坑口の先の起伏**（round-04 のレビュー）: s 72 のクレスト 26.23 m → s 419 のサグ 18.40 m → s 566 のクレスト 22.33 m（146 m で +3.9 m、最大 +4.7 %）→ s 913 のサグ 9.65 m。v1 も同じ測点・ほぼ同じ高さで、内回りと同じ面に並ぶ s 485〜565 の拘束による。
- **外回り 45021976 の 110-B の手前の起伏**（同）: s 1182 のサグ 11.44 m → s 1304 のクレスト 16.50 m（122 m で +5.1 m、最大 +5.55 %）。round-01〜03 と同じ形。この run の勾配の符号の反転は v1 の 18 か所から 10 か所。
- **歩道が後から届くと路面を敷き直さない**（標識表 shibakoen-entrance の夜、round-04 のレビュー）: 歩道の多角形が車道に掛かり、届く順番によって車道の上に敷石と縁石が載る。S5 より前からある読み込み順の問題で、S5 の範囲外。
- **撮影時の遠景の待ち**: `settled()` が isSettled のまま farPending 1〜4 のコマが round-03・04 とも 4 つ（shibakoen-exit20 の 150 m の視点など）。写っている判定対象は近景で、判定には効いていない。
- **芝公園入口 207111988 の足元の沈み**（自動運転 4 回とも同じ値）: 一般道から床版への接続路の終わり（s 22.6〜27.1）で dy −0.118 → −0.155 m、床版の始まり（207111988:0 の s 0）で −0.135 m、s 2.5 で −0.078 m に戻る。走っている面がグラフの面より約 8 cm 低く、床版の始まりで 4 m かけて上がる。速度は 25 km/h のまま。合否には掛からず（床版の上は 0.15 m 以内かつ助走の除外の中）、round-03 にもあった。
- **south-portal-driver の擁壁の内側に入る地形**（round-04 のレビュー、任意の Info、直していない）: 地形が擁壁の内面より掘割側へ約 0.7 m 入って見える（擁壁が低いのではない）。案は、地形の穴を壁の内面まで届かせ、区画線も `dropCut` に通すこと。round-05 は lamp-in-bore を閉じる周で、新しい Warning を出す危険を避けて見送った。
- **cut-driver の昼のコマの 2 px のずれ**（round-05 のレビュー、記録のみ）: round-05 の昼の cut-driver だけ、画面全体が他の周より右へ 1 px・上へ 2 px 一様にずれる（コマの JSON のカメラは round-04 と同一、夜はずれていない）。判定には効かない。
- **羽田線 45554540 の縦断の起伏**（round-03 のレビュー、`.cache/s5/swings.ts` で 2026-11-12 08:53 JST に測り直し）: s 995〜2140 で 5 回の上り下り（−2.65・+1.81・−1.78・+2.53・−1.37 m）、s 7451〜7981 で 4 回（−5.03・+3.83・−4.60・+3.33 m、3.3〜5.0 m）。v1 も同じ所で同じ程度（s 995〜2140 は ±2.7〜3.2 m、s 7451〜7981 は −6.9・+4.6・−4.7・+3.7 m）で、v2 で増えたものではない。交差と JCT の拘束の間で短い区間に上り下りする。拘束を緩めるかは S6 で決める。

- **汐留出口 24402125 の s 0〜140 m の谷**（v1 と 3 cm 以内）: 本線と s 82.6 まで同じ面に縛られ、地表の端へ下りる。ランプの縦断は本線の面と地表の端で決まり、短い区間で上り下りする。
- **外回り 45021976 の s 1090〜1300 m の V 字**: 813455519 の取付き（s 1264）と内回りとの移り変わりの間。

- **並走する上下線の高さ**: 外回り 45021976 が s 250 から一定 +1.57 % で上り、並走する内回り 24402611 との高さの差が s 300〜700 で 0.6 → 4.7 m に開く（v1 は ±0.25 m）。v2 は run ごとに長い一定勾配を選ぶので、並走する組を同じ高さに保つ拘束が無い。「並走する上下線を同じ高さに保つか」を S6 の判断材料にする。

## 落とし穴

- `.cache` の走行中に `src/` を書き換えると開発サーバーの HMR でページが読み直され、走行が `__game is not defined` で落ちる（round-01 の後の調査で 2 本）。
- 遠景のタイルは近景と別のグループの下にあり、`localMatrix` は近景のグループしか見ていなかった（遠景のメッシュに ECEF の変換をもう一度掛けて地球の半径だけずれる）。

## 気づいた欠陥（直していない）

1. 既定範囲と ship で `signs` の欄が違う（標識の計画が範囲で変わる、v1 から）。
2. 事故の判定（main.ts の接触）は接触の後の速度で `kmh > 5` を見るので、47 km/h で止められても `accident` にならない（走行の invalid にも数えられない）。
3. 基準 fixture の ramp-radius の地区が S4 の後の修正の前のまま（作り直しで直る）。

# P2.7-6 PR 1: 構造を高さから決める（既定は無効、2026-11-12）

S6「網をつなぐ」の 1 本目。`--structures tags|height`（既定 tags、height は `--out` 必須: `expresswayGuards.ts`）。OSM の bridge タグは目標で、書き出す構造は解いた路面と地表から決める（`src/expressway/heightStructures.ts`）。[^p276]

## 作ったもの

| 項目         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 区分         | 高架タグの run（タグの below run と構造物の run を除く）を 1 m ごとに、測点の中心線の地表に対し、路面が地表より 0.25 m（不感帯 `HEIGHT_DEAD_BAND_M` = `DEM_SINK_FLOOR`）を超えて下 → `cut`、地表 + 6.7 m − 0.25 m 未満 → `embankment`、それ以上 → `viaduct`。`decks` が above（他の床版の上）の区間は高さによらず高架、same（同一面）の区間は掘割にせず盛土（**地下の盛土が残る: 下の R1**）。20 m 未満の区間は長い隣へならすが、掘割はならさず隣も取り込まない。最低が地表 + 3 m 以上で run の端に接しない盛土は高架のまま（台帳の `low-viaduct`）。チャンクは区分の境で切り、境の後のチャンクに `portals`。format の構造に `embankment`、`XW_FEATURES` に `height-structures`（height のときだけ meta に書く）、height の run の要約にタグの `below`。**逸脱（採用）**: 指示の「地表の最高点」でなく中心線の地表（T13 がタイルだけから同じ規則で判定するため） |
| 合否         | 仮定の床（`floor`・`sunk`）と、桁で受ける交差（`give: girder`）・地表端の近くの道路（`give: near`）の不足は、**最後の段（assumedGive）でだけ**合否から外す（`isFailing`）。それより前は今までどおり段を進める。`deck_below_ground`・`below_open_ground_floor` の診断は出さない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 桁高         | 交差・床版の上で 1.7 m（`GIRDER_MIN`）以上 2.2 m 未満の余裕なら、チャンクの `girder` を余裕まで薄くする（cm に切り捨て）。交差の `cross` の必要離隔もその分下げて書く（T4）。重なりの 1 段は上の床版のチャンクの `girder`（`levelApartOver`、overlap.ts とデータテストの総当たり）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| blocked      | 盛土・掘割が道路の窓（`crossInfo.halfWindow`）に少しでもかかる道路・鉄道と、窓の最低点で 1.7 m の桁でも離隔が足りない道路を blocked（`crossing_over_or_at_grade`）に移す。推定の登りは QP の行を置くかだけ（**窓にかかるだけで blocked になる退行: 下の R3**）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 窓の拡張     | 最後の lowerSpeed の段で窓の外で失敗したら ±150 m を足して解き直す（run ごとに 3 回まで、`windowsToWiden`。P2.7-3a の欠陥 1）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 浅い短い地下 | 天井が届くトンネルの測点が第22条の縦断曲線長に満たない範囲にしか無いなら、トンネルの天井を置かない（`isCoverStretchTooShort`、T12 も同じ規則）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T12          | (a) 天井の届く境目が 5 m の拘束点の間にあると、その間の測点がファイルでは届く・QP では行が無い（5213545:0 の s 113.75: 110 は届かず 115 は届く、路面 −6.096 は天井 −6.12 の 2.4 cm 上）。**原因は丸めでも余裕でもなく拘束点の間隔**。height では境目（0.25 m 刻みで最初に届く点）に、その点の地表の天井の行を足す。(b) トンネル → 掘割の坑口の測点（トンネル側のチャンクの最後）は掘割として見る（24402540:3 の s 1114.46、堀の縁で地表が急に落ちる。検査側の修正で全ビルド共通、tags の値は変わらない）                                                                                                                                                                                                                                                                                                                                                         |
| T13          | タイルだけから: 区分が測点の高さと合う（20 m 未満の食い違いは許す、丸め 2 cm）、盛土・掘割に橋脚と交差なし、掘割に桁なし、区分の境に portals（`checkHeightStructures`、height のビルドだけ）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 台帳         | `cut-stretch`（規則: 深さ 3 m・長さ 150 m 以内）・`embankment-stretch`（500 m 以内）・`thin-girder`（1.7 m 以上）。測定に `depthM`・`girderM`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 実行時       | `embankment` は桁の下端を床版の幅にし、壁の下端は左右それぞれ床版の縁の外 0〜0.5 m の地形の最低 − 0.3 m、両端に端面（描画のみ）、橋脚なし、壁にコライダーなし、建物は地表まで切る（deckCuts）、グラフでは viaduct と同じ level 1。高い側の擁壁は無い。下の判定は `isBore`（tunnel・cut）。高架タグの run の `cut` チャンクは below run の掘割と同じ断面・穴                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 計測（trust signal、2026-11-12 UTC、M2 Max、3〜5 本並列）

ラベルは `.qa/expressway/s6*`。s6a = origin/main 873177f（03:29〜03:30Z）、s6e = 最終版（04:13Z 終了）。

| 項目                                                | tags（= main） pruned |                                                               height pruned |              tags all |                 height all |
| --------------------------------------------------- | --------------------: | --------------------------------------------------------------------------: | --------------------: | -------------------------: |
| 閉鎖 本線 / ランプ                                  |                4 / 12 |                                                                   **0 / 6** |               14 / 30 |                  **1 / 6** |
| 根                                                  |                    14 |                                                     6（加平 3・大橋 JCT 3） |                    17 |             7（+28127324） |
| violations                                          |                 T12 1 |                                                              **0**（T13 0） |                 T12 1 |                      **0** |
| 未許可の重なり（両方で出力の run どうし、組・測点） |            173・2,129 |                                                                  158・1,931 |            158・1,782 |                 146・1,665 |
| 「1 段にあと少し」（最小 \|Δz\| 6.2 m 以上）        |                    22 |                                                                      7 残る |                    18 |                     6 残る |
| 強制なしの反転 / σ / 相関                           | 0.766 / 0.433 / 0.228 |                                                       0.766 / 0.433 / 0.228 | 0.776 / 0.433 / 0.226 |      0.764 / 0.426 / 0.220 |
| 分合流 σ / 高さ 中央値・p95                         |   0.579 / 9.57・16.05 |                                                         0.579 / 9.57・16.08 |                 0.579 |                      0.579 |
| 盛土 / 掘割                                         |                     — | 285 区間 31.8 km（最長 264 m）/ 35 区間 1.36 km（最長 66.5 m、最深 2.75 m） |                     — | 285・32.3 km / 35・1.38 km |
| thin-girder                                         |                     — |                                                       158 チャンク・36.5 km |                     — |                        158 |
| 未収束 / dangling / deckMismatch                    |                     0 |                                                                           0 |                     0 |                          0 |
| 解く段（s）・solves                                 |             77.5・107 |                                                                    78.3・96 |             125.9・83 |                  121.4・69 |

- 根の前後: 代官町 24372960・27536429・133037880・27155734、護国寺 156280228、新宿出口 27536961、湾岸 42751503・42751507 が解けた。all の 28127113・24402095 も根でない。盛土・掘割はすべて規則の上限内（listed 0）。
- **tags の不変**: ship/pruned の生成フォルダは main と `diff -rq` で全ファイル一致（s6b・s6c・s6d・s6e の 4 回）、スコアカードの差は `violations.T13` の追加だけ。既定範囲の `--out --ledger public/data/expressway/ledger.json` は public/data/expressway と ledger.json 以外一致。
- **既定範囲を height にしたとき（PR 7 の見積もり、s6e-height-default）**: 高さの差は全 3,974 測点で最大 1 mm（丸め）、段の変化なし。チャンク 266 → 279、ID が変わる run 9 本（207111988・24402125・24402611・45021976・45068172・4848755・4853798・4853799・895902565）、盛土 16 区間 2.06 km、thin-girder 9、~~診断は `deck_below_ground:24039713` と `crossing_over_or_at_grade:172358461` が消える~~ **訂正（レビュー C1）**: 172358461 の道路 172358474 は交差の中心だけで余裕を測った誤りで消えていた（窓の中で桁下 4.17 m）。直した版（s6g）は下の「レビューの対応」。
- 合否の外し方の A/B: 最初は全段で外した（s6b〜s6c）。ship の閉鎖は同じく解けたが、段を進めて高架に保てた run も標準の段に残り、合成の台地では台地の縁を掘割で切り、既定範囲では臨港道路 45177681 が特例 → 標準になって最大 9.8 m 動いた。最後の段でだけ外す版（s6d〜）で既定範囲は 1 mm 以内になった。

## PR 1 レビュー（Fable、Changes Requested）の対応

逸脱 (1) 区分の地表は中心線、(2) 合否から外すのは最後の段だけ、(3) 窓の拡張・T12 の修正・浅い地下は height だけ、は採られた（(1) は W1・W4 の手当てが条件）。

| 指摘                            | 対応                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 交差の余裕を中心だけで測った | `thinGirder` の余裕も、通す判定（`structuresByHeight`）も、道路の窓（`crossInfo.halfWindow`）の最低点で測る。1.7 m の桁でも足りない交差は blocked。172358461 × 道路 172358474（中心 7.04 m・9 m 先 6.37 m・桁下 4.17 m）は blocked になった                                                                                                                                                                                                                                                                                                                                        |
| C2 同一面の相手のある掘割に擁壁 | 掘割の閾値に不感帯 0.25 m（`HEIGHT_DEAD_BAND_M` = `DEM_SINK_FLOOR`、T13 も同じ）。`decks` が same の区間は掘割にしない（床版のまま盛土）。掘割はならしで消さず、隣も取り込まない。高さ由来の掘割は 35 区間・1.36 km → 11 区間・0.09 km（最長 16 m・最深 0.99 m）。~~掘割 最深 0.99 m~~ **訂正（再レビュー）**: same の区間を盛土にしたので、地表より深い所は盛土として残る（ship/pruned で中心線の地表より 0.26 m 超下の盛土の測点 22。24372960:6 は s 359〜397 で最大 2.77 m 下、133037880:0・27536429:0 は 2.04 m 下、27155734:2 は 0.99 m、27514398:0 は 0.54 m）。未解決（R1） |
| W1 交差の窓にかかる盛土         | 窓に盛土・掘割が少しでもかかる道路は blocked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| W2 他の床版の上の盛土           | `decks` が above の区間は高さによらず高架                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| W3 空中の盛土                   | 高架の閾値にも不感帯（6.7 − 0.25 m）。盛土の塊の最低が地表 + 3 m（`EMBANKMENT_REACH_M`）以上で run の端に接しないものは高架のまま、台帳の `low-viaduct`（listed）とスコアカードの `structures.lowViaduct` に記録（ship/pruned 5 区間 0.32 km）                                                                                                                                                                                                                                                                                                                                     |
| W4 盛土の壁の下端               | 左右それぞれ床版の縁の外 0〜0.5 m の地形の最低 − 0.3 m。高い側の擁壁（地形が路面より高い所）は描いていない（PR 7 の多視点で）                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| W5 全部掘割になった高架の run   | height のビルドの run の要約に `below: true`（タグの below run だけ）。T13・台帳・スコアカードはこれで見分ける                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| W6 構造物の run                 | 区分しない run（rp.over）は合否・診断・T4 を tags のまま                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| W7 テスト                       | 交差の窓（合成網、C1）、T13 が違反を見つける側、T12 の坑口、give: near、区分の文脈（above・same・空中・掘割を消さない）、盛土の端面と左右の壁の下端。**残り**: 窓が広がって解ける合成網、thresholdStations・withStations の単体（ship の T12 0 で確かめた）                                                                                                                                                                                                                                                                                                                        |
| W8 既存の本線が動く量           | 下の節                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| W9 盛土の端面                   | 盛土のチャンクの両端を断面の扇で閉じる（描画のみ、両向き）。見た目は PR 7 の多視点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| W10 擁壁の内側に入る地形        | PR 7 か別件へ回す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**再計測（s6g、2026-11-12 04:59Z 終了、5 本並列）**:

| 項目                                    |           tags pruned |                    height pruned |              tags all |                      height all |
| --------------------------------------- | --------------------: | -------------------------------: | --------------------: | ------------------------------: |
| 閉鎖 本線 / ランプ、根                  |            4 / 12、14 |                         0 / 6、6 |           14 / 30、17 |                        1 / 6、7 |
| violations（T1〜T13）                   |                 T12 1 |                                0 |                 T12 1 |                               0 |
| 未許可の重なり（生の数、組・測点）      |            173・2,129 |                       163・1,972 |            158・1,782 |                      174・2,097 |
| 同（両方で出力の run どうし）           |            173・2,129 |                       157・1,927 |            158・1,782 |                      147・1,662 |
| 「1 段にあと少し」22 組（all 18）の残り |                     — |                                7 |                     — |                               7 |
| 強制なしの反転 / σ / 相関               | 0.766 / 0.433 / 0.228 |            0.766 / 0.433 / 0.228 | 0.776 / 0.433 / 0.226 |           0.764 / 0.426 / 0.220 |
| 盛土 / 掘割 / thin-girder               |                     — | 274・30.3 km / 11・0.09 km / 178 |                     — | 273・30.7 km / 8・0.08 km / 180 |

all の生の数が増えるのは、height で新しく出力される run（本線 +13・ランプ +24、tags では閉鎖か道連れ）の組。両方で出力された run どうしでは減る。残る 7 組は上下の床版の点が組（`plan.pairs`）にならない所か、上が盛土の所（未調査）。tags の不変: ship/pruned のフォルダは main と全ファイル一致、既定範囲は public/data/expressway と ledger.json 以外一致。既定範囲を height にした場合（s6g-height-default）: 高さは全 3,973 測点で最大 1 mm、チャンク 266 → 279、ID が変わる run 9 本、診断は `deck_below_ground:24039713` が消え `crossing_over_or_at_grade` が 45021976（s 3399.9、窓に盛土）と 24336502 に足される。

**既存の本線が動く量（W8、tags → height、ship/pruned）**: レビューの数え直しでは共通 34,830 測点のうち 0.1 m 超 223・1 m 超 71、最大は 45661183 の s 16.75〜17.0 km の +9.67 m、32404414 の +4.62 m。こちらの `compare-expressway-heights s6a-main-pruned s6e-height-pruned`（39,578 測点、p99 0.066 m・最大 9.669 m）も同じ 2 本が上位。原因はレビューの切り分けで、同じ成分の 247838154 が tags では未解決（段を下げても仮定の床で失敗）、height では最後の段で解けて成分の解き方（段・shedding）が変わり、隣の本線が動く。合否を最後の段でだけ外しても、解けるようになった run の成分の他の run は動く。

**新しく blocked になる道路（再レビュー、R3）**: 既定範囲で 4 件（24336502 × 24402643 の s 28、45021976 × 666610859 の s 3400、45248411 × 1386535811 の s 5891、895902565 × 24402643 の s 100）、ship/pruned で 7 件増える。どれも ±12 m の全幅で路面が 6.67〜6.81 m あり、盛土が交差の中心から 5.6〜7.1 m 先で始まって窓にかかるだけで、PR 7 でこのまま有効にすると退行になる。

**PR 7 の前提（再レビュー、Approve の条件）**:

| いつ        | 項目                                               | 内容                                                                                                                                                           |
| ----------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 2 の最初 | R2 掘割の閾値（**PR 2 で済み**: 0.5 m・最短 10 m） | 閾値が DEM_SINK_FLOOR と同じで余裕 0。高さ由来の掘割 11 区間中 9 区間が深さ 0.22〜0.27 m・長さ 1〜16 m。閾値を床より下（例 0.5 m）にし、掘割に最短の長さを置く |
| PR 2 の最初 | R1 の台帳での可視化（**PR 2 で済み**）             | `embankment-stretch` に `depthM`（中心線の地表より下の深さ）を持たせ、不感帯より深ければ listed                                                                |
| PR 7 まで   | R1 地下の盛土                                      | same の区間で地表より下になる盛土（上の訂正）の実行時の修正                                                                                                    |
| PR 7 まで   | R3 窓にかかる盛土                                  | 窓の最低点が離隔を満たす交差は窓の中を高架に固定し、盛土を窓の端から始める                                                                                     |
| PR 7 まで   | R4 空中の盛土                                      | 3 個（24402125:0・45068172:3・24336502:0）。run の端に接するかでなく、端の種類（ground・portal）で見る                                                         |
| PR 7 まで   | W4 の残り                                          | 盛土の高い側の擁壁（地形が路面より高い所）                                                                                                                     |
| PR 3・4     | R5                                                 | same の組で実際は離れている所の盛土                                                                                                                            |
| PR 7 まで   | テスト                                             | 窓が広がって解ける合成網、thresholdStations・withStations の単体、chunkRun の桁高の統合テスト                                                                  |
| PR 7 まで   | データテスト                                       | T13・`below`・`low-viaduct`・盛土の T4 除外・blocked の規則を既定データの検査に                                                                                |
| PR 7 まで   | 画面                                               | 盛土・掘割の多視点での確認（端面・地形との合い）                                                                                                               |
| PR 7 まで   | コライダー                                         | 盛土の壁にコライダーが無い                                                                                                                                     |
| PR 7 まで   | T13 の独立性                                       | T13 がコンパイラの `heightStretches` を呼んでいる（同じ規則の再計算で、独立な検査ではない）                                                                    |
| 検討        | 段の戻し                                           | give の後に盛土・掘割になった run だけ上の段へ戻して解き直す案（最後の段の低い設計速度を避ける）                                                               |
| 検討        | 名前                                               | 条件の名前（閾値の定数、`isClassified`）と、このページのタイトルに P2.7-6 を足す                                                                               |
| PR 7 まで   | R6 (a) T13 の独立性                                | T13 がコンパイラの `heightStretches` を呼んでいる（同じ規則の再計算で、独立な検査ではない）                                                                    |
| PR 7 まで   | R6 (b) 盛土の壁                                    | 盛土の壁にコライダーが無い                                                                                                                                     |
| PR 7 まで   | R6 (c) 薄い桁の範囲                                | 桁を薄くするのは交差の中心があるチャンクだけ（compile.ts `thinGirder` の `isHere`）。交差の窓が隣のチャンクにかかっても、そちらは標準の桁のまま                |
| PR 7 まで   | R6 (d) T4 の見る点                                 | T4（checks.ts `checkClearance`）は記録した交差の 1 点の z − top だけを見て、窓の中の最低点を見ない                                                             |
| PR 7 まで   | R6 (e) 交差の窓のテスト                            | tests/expresswayHeightStructures.test.ts の交差の窓のテストが `cross` と blocked の両方を数えるので、交差として解けても blocked でも通る                       |
| 済み        | R6 (f) 「作ったもの」の表                          | 古い規則のままだった件は PR 1 の追いコミット 204f4ef で直し済み                                                                                                |

## 加平の 3 本（60942183・250488077・250488078、止めて報告）

- OSM: 60942183（motorway_link、bridge、layer 1）と 250488077（layer 2）はほぼ同じ点（35.7772, 139.8258、約 8 m）から出て、250488077 が s 117 m で 60942183 の上を渡る。250488078 は 40 m の連結路。
- 失敗: 250488077 の交差の離隔 0.43〜1.12 m（6.7 m 要る）と s 175 m の道路の離隔不足 0.92 m（地表端の近くではない）、250488078 の端の標高 0.98 m。height の最後の段で床が弱い行になっても、同じ低い点から 117 m で上下に 6.7 m 離すことができない（標準勾配 + 縦断曲線の長さ）。
- 直すには、交差の下の run を交差の近くで地表より下へ下げる（交差に引かれた掘割）か、上の run の端の条件を変える新しい規則が要り、1〜9 に無いので入れていない。

## 落とし穴

- `thinGirder` は組の両向き（自分の点が相手の帯に入る組と、相手の点が自分の帯に入る組）を見る。片向きだけでは並走の細い重なり（41009552 over 176046420）で桁が薄くならなかった。
- 区分の境が 0.5 m 以内でチャンクの境に吸われると、橋脚の判定を 1 m の区分で見ると盛土のチャンクに橋脚が立つ（5171105:11、T13 が検出）。橋脚はチャンクの中央の区分で見る。
- 境目の天井の行に ±2.5 m の最低地表を使うと、坑口脇の急な土手（5204786 の s 12 m）で届いた天井より 1 m 低い行になり本線が 3 本閉じた。点そのものの地表を使う。

## 気づいた欠陥（直していない）

1. 「1 段にあと少し」の 7 組（176046420|41009552 6.65 m など）が残る。上の床版が盛土の区間か、組の点がチャンクの外にある。
2. 擁壁の内側に入るくさび（south-portal-driver、S5 の Info）は視点での確認ができず直していない（レビュー W10: PR 7 か別件へ回す）。round-05 の記録では区画線の切れ端が写っており、`roadSurface.ts` は路面と区画線に `dropCut` を掛けているので、交差点の面など別の面の可能性がある（`--pick` で確かめる）。
3. 区分の境がチャンクの境に吸われると、道路の blocked 判定（1 m の区分）とチャンクの構造が食い違いうる（T13 が交差の有無で検出する）。
4. 構造物（レインボーブリッジ）の run は区分しない。取付けの地表近くは高架のまま。
5. blocks（`--partition blocks`）の片の設定は `lawNear` を持たない（height × blocks は測っていない）。

# P2.7-6 PR 2: 地平 run（既定は無効、2026-11-12）

`--ground skip|compile`（既定 skip、compile は `--structures height` が前提で `--out` 必須）。[^p276]

## 最初に（PR 1 の再レビューの R2・R1）

- **R2**: 高架タグの run の掘割は中心線の地表より 0.5 m（`HEIGHT_STRUCTURES.cut.fromM`）を超えて下から。10 m（`cut.minLengthM`）未満の掘割はならす。ship/pruned・height・skip の高さ由来の掘割は 11 区間・0.09 km → 0。
- **R1**: `embankment-stretch` に `depthM`（中心線の地表より下の深さ）。0.25 m（不感帯）を超えれば listed（`isOpenGroundRuled`、CAP_FIELDS にも）。

## 作ったもの

| 項目         | 内容                                                                                                                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run          | `splitRuns` の地平の区間を、高架の run のある鎖では compile のとき run にする（`RunPlan.ground`、run の要約の `ground`）。ID は今と同じ規則                                                                                                                                                                                       |
| 端           | 地平 run の隣の高架・below run の端は、地平 run を親とする seam（C¹）。地平 run のその端は `open`（隣が取る）。鎖の端は今の地表端。地平 run を親とする端は低い端（`isLowEnd`・`climbingEnds`）                                                                                                                                    |
| 縦断         | 床・天井の行なし。目標は中心線の地表の移動中央値（`movingMedian`、±150 m。最初は設計地盤線の `mid` だったがレビュー W2 で変えた）、その ±1.5 m（`HEIGHT_STRUCTURES.ground.bandM`）を W_FLOOR の軟らかい行（`RunInput.bandLo`・`bandHi`、合否に使わない）。DEM は地表端だけ。勾配変化の L1 は v2 のまま。連結路の 3 次式にはしない |
| 構造         | PR 1 の区分に、地表 + 0.3 m（`ground.cutBelowM`）より低い所を掘割にする閾値（T13 も同じ）                                                                                                                                                                                                                                         |
| 交差する道路 | 地平 run を横切る OSM の地上の道路は全部 blocked（`crossing_over_or_at_grade`、「crosses the road at grade」）。数はスコアカードの `ground.crossingsBlocked`                                                                                                                                                                      |
| 範囲         | 範囲の run が親（seam・分合流）とする地平 run と、その親を範囲に足す（足さないと子が宙に浮いた: dangling）                                                                                                                                                                                                                        |
| スコアカード | `ground`（height のビルドで skip でも）: 地平 run の本数・km、本線の穴（`mainLineHoles`: 本線を出力した鎖の、出力されない地平の区間を、範囲外・出力されない below run の隣・鎖の端・それ以外に分ける）、blocked の数、地平の本線（800 m 以上）の追従                                                                              |
| 検査         | height のビルドでは地平 run の掘割は T12 でなく T13（高架タグの run の掘割は T12 も見る。レビュー W10）                                                                                                                                                                                                                           |
| 実行時       | 変更なし（地平 run のチャンクも掘割・盛土・高架で、P9 と PR 1 の描き方。地理院の高速道路の線は今の 40 m の規則で落ちる。`expresswayDeck.ts` は触っていない）                                                                                                                                                                      |

## 計測（trust signal、2026-11-12 UTC 05:3x〜05:41Z、M2 Max、3〜5 本並列）

ラベルは `.qa/expressway/s6h-*`（skip）・`s6i-*`（compile）。

| 項目                             |             skip pruned |                          compile pruned |               skip all |              compile all |
| -------------------------------- | ----------------------: | --------------------------------------: | ---------------------: | -----------------------: |
| 出力の run（本線 / ランプ）      |                84 / 231 |                               137 / 404 |                      — |                168 / 417 |
| 地平 run（本・km）               |                       0 |                               227・53.8 |                      0 |                236・55.8 |
| 本線の穴 それ以外（数・km）      |                83・64.7 |                                   **0** |              102・67.1 |                    **0** |
| 　below の隣 / 鎖の端 / 範囲外   | 38・11.8 / 18・13.7 / — |                  2・0.07 / 0 / 70・53.6 | 19・9.3 / 18・13.7 / — |         0 / 0 / 68・52.5 |
| 閉鎖 本線 / ランプ               |                   0 / 6 |                    **2（0.07 km）** / 6 |                      — |                    1 / 6 |
| violations                       |                       0 |                T3 10・T6 1・T7 5・T12 1 |                      0 | T3 8・T6 3・T7 5・T12 21 |
| 地平の本線の反転 / 短波長 σ      |                       — | 0.125 回/km / 0.112 m（12 本・16.0 km） |                      — |            0.125 / 0.113 |
| 高架の強制なしの反転 / σ         |           0.766 / 0.433 |                           0.426 / 0.326 |          0.764 / 0.426 |            0.422 / 0.309 |
| blocked（地平 run を横切る道路） |                       0 |                                     101 |                      0 |                      104 |
| 最大の成分（run・変数）/ 解く段  |   271・17,852 / 100.9 s |                   633・26,574 / 183.2 s |            — / 145.1 s |  1,418・48,756 / 237.2 s |
| タイル gzip 合計 / 最大          |       1.11 MB / 57.2 kB |                       1.24 MB / 61.0 kB |                1.19 MB |        1.33 MB / 61.0 kB |
| 未収束 / dangling                |                   0 / 0 |                                   0 / 0 |                  0 / 0 |                    0 / 0 |

- 地平の目標（反転 0.8 以下・σ 0.4 m 以下）は届いた。本線の穴は範囲の端（`outsideRange`、ship の区外の鎖）と below の隣を除いて 0。
- **完了条件に届かないもの**:
  - 本線の閉鎖 2（816254799・816254802、0.07 km、「end elevation off」3.6・0.92 m）。地平 run に挟まれた短い高架で、両端が地平 run の seam。原因は未特定。
  - T3: 地平 run を親とする seam の端の片勾配（junction bank 0 / −0.0014、1023819782:8 ほか）と start heading（169674665:3）。
  - T7: 地平の短いランプの片勾配の擦り付け（1256882296:2 ほか）と合成勾配 11.63 %（24039815:1）。
  - T6: OSM の半径（157812961 R 12.4 m、169674665 R 10.2 m）。台帳の `ramp-radius` で判断する事例。
  - T12: pruned 1（405795844:11、3.2 cm）・all 21（23594607 ほか）。地平 run に seam するようになった below run で、コンパイラの届きは坑口の地表から、T12 は端の路面（地平 run の帯の中で地表から最大 1.5 m 離れる）から測るので食い違う。
- 高さの差（skip → compile、ship/pruned）: 共通 39,144 測点で p50 0.10・p90 1.30・p99 4.70・最大 9.55 m（4848889、43992332、67152889 …）。地表端が seam になって、成分の解き方（端の地形の勾配、`markSharedTouchdowns` の対象: compile では外す組が 131 → 0 測点）が変わる。
- **既定範囲を compile にした場合（PR 7 の見積もり）**: 地平 run 13 本（45554541 1.39 km、5213324 1.39 km、4848757 333 m ほか）、掘割 5 区間 2.86 km。最初の版（s6i）は run 19 → 32 で dangling 1（4848757 が範囲の外の below run 4854085 にぶら下がった。レビューで訂正: 高架ではない）。地平 run が足した run の親も足すよう直した版（s6j、05:45Z）は run 19 → 35・dangling 0・violations T3 2（203873824:1 の start heading、4853799:2 の junction bank）・T7 1（23705286:0）。

## 完了条件に向けた手直し（コーディネーターの指示、2026-11-12）

| 項目                                               | 原因（数値）                                                                                                                                                                                                                                                                             | 直し方                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 本線の閉鎖 816254799・816254802（赤坂、4号新宿線） | 35 m の地平の way が 2 本の below run（24636426・816254800、と逆向きの組）に挟まれ、地平 run になると帯（地表の `mid` ± 1.5 m）で地表の高さに寄せられ、両側の below run の深さと合わない（end elevation off 3.6 m・0.92 m を全段で）                                                     | below run に挟まれた地平の区間は地平 run にしない（トンネルの開いた所。skip と同じく below run がそこで地表端、S7 で扱う）                                                                                                                       |
| T3 の片勾配（junction bank 0 / −0.0014）           | 測点の片勾配を `sampleAt`（測点の前の標本）で取っていた。run の最後の測点は最後から 2 番目の標本になり、地平の短いランプの急な擦り付けでは親の値との差が 0.001 を超えた                                                                                                                  | runs at grade のビルドでは測点の片勾配を標本の線形補間で取り、子の端を親の同じ s の値に（`bankAt`）                                                                                                                                              |
| T3 の方位（920238368:1）                           | 区分の境が節点の 0.84 m 手前に来て、チャンクの最初の弦が 1 m 未満（ファイルの 1 cm で方位が立たない）                                                                                                                                                                                    | 区分の境を 3 m 以内の節点へ寄せる（height のビルド）                                                                                                                                                                                             |
| T7（擦り付け 2.90‰/m、合成勾配 11.63 %）           | (a) 測点の片勾配が前の標本の値で、標本の間隔だけ擦り付けが急に読めた。(b) 同一面の相手の片勾配の固定（pins）が第25条の余裕を超え、余裕の切り詰めの後に擦り付けをやり直していなかった。(c) 短い地平のランプの地表端の片勾配を 0 に固定して、第18条の長さが取れなかった（157812961、23 m） | (a) 補間（上と同じ）。(b) `superelevation` の `strict`: 固定値も余裕で切り、擦り付けと切り詰めを動かなくなるまで繰り返す（端の固定は保つ）。(c) 地平 run の地表端の片勾配を固定しない。どれも runs at grade のビルドだけ（検査の閾値は変えない） |
| T12（pruned 1・all 21）                            | below run の天井の届きを、コンパイラは端の地表から、T12 は端の路面から測っていた。地平 run に seam すると端の路面が地表から帯の分離れる                                                                                                                                                  | height のビルドでは T12 も端の測点の地表から測る（コンパイラの `portalZ` と同じ基準）                                                                                                                                                            |
| T6（OSM の半径）                                   | 地平のランプの端の R 7.8〜12.4 m。既存の ramp_radius は台帳で判断した半径（−0.5 m）で T6 を判定する                                                                                                                                                                                      | height のビルドでは ramp_radius の診断が出た run は台帳の事例（`new`）として、その半径 − 0.5 m で T6・T3 の方位を判定（数えるのは台帳で一度）                                                                                                    |

**手直し後の再計測**（ship は s6o、06:28〜06:38Z、既定範囲は s6n、06:20〜06:27Z、4〜7 本並列）。上の最初の表を置き換える値:

| 項目                            |             skip pruned |                          compile pruned |                skip all |             compile all |
| ------------------------------- | ----------------------: | --------------------------------------: | ----------------------: | ----------------------: |
| 出力 本線 / ランプ              |                84 / 231 |                               135 / 398 |               102 / 232 |               157 / 412 |
| 閉鎖 本線 / ランプ              |                   0 / 6 |                               **0** / 6 |                   1 / 6 |                   1 / 6 |
| violations                      |                       0 |                  **T3 1**（60942193:1） |                       0 |            T3 1（同じ） |
| 地平 run（本・km）              |                       0 |                               216・47.1 |                       0 |               222・48.4 |
| 本線の穴 それ以外（数・km）     |                70・52.8 |                                   **0** |                70・52.8 |                   **0** |
| 　below の隣 / 鎖の端 / 範囲外  | 51・23.7 / 18・13.7 / — |                  11・6.4 / 0 / 68・52.5 | 51・23.7 / 18・13.7 / — |  11・6.4 / 0 / 68・52.5 |
| 地平の本線の反転 / σ            |                       — | 0.145 回/km / 0.120 m（10 本・13.8 km） |                       — |                      同 |
| 高架の強制なしの反転 / σ        |           0.766 / 0.433 |                           0.427 / 0.326 |           0.764 / 0.426 |           0.423 / 0.309 |
| 未許可の重なり（組・測点）      |              164・1,957 |                              232・2,002 |              175・2,085 |              244・2,081 |
| blocked（横切る道路）           |                       0 |                                     101 |                       0 |                     104 |
| 最大の成分（run・変数）/ 解く段 |    271・17,852 / 90.8 s |                   634・26,624 / 174.7 s |   382・26,380 / 135.6 s | 1,395・48,428 / 231.3 s |
| タイル gzip 合計 / 最大         |       1.11 MB / 57.2 kB |                       1.23 MB / 61.0 kB |       1.19 MB / 57.2 kB |       1.32 MB / 61.0 kB |
| 未収束 / dangling               |                   0 / 0 |                                   0 / 0 |                   0 / 0 |                   0 / 0 |

- 既定範囲（compile）: run 35（地平 15・6.4 km）、violations 0・dangling 0・閉鎖 0。tags の ship/pruned（s6k・s6l・s6m・s6n）は main と全ファイル一致、既定範囲は ledger.json 以外一致。
- **T3 1 の直し方（コーディネーター判断、2026-11-12）**: 閾値は緩めず、区分の境が急な曲線（半径が床の 1.25 倍未満: 本線は第15条の特例、ランプは `RAMP_MIN_RADIUS`）の中に来たら、曲線の外の最寄りの節点へ、無ければ曲線の近い方の端へ、20 m 以内で寄せる（`offTightCurve`、runs at grade のビルドだけ）。再計測の値は下の「最終の再計測」。
- ~~残る T3 1~~（直した。以下は原因の記録）: 60942193:1（加平の地平のランプ、`minRadiusM` 15.1 m）の盛土 → 掘割の境 s 49.5 で、チャンクの方位（±3 m の標本の中心差）と次の測点（5 m 先）への弦の差が 0.194 rad、許容 0.175 rad（5 m / (2 × 15 m) + 0.5°）。測点から読む曲率は R ≈ 13 m 相当で、T6（曲率に 5 % と 2e-4 の余裕）は通るが T3 は床の半径そのもので見る。区分の境が急な曲線の中に来た所の型。T3 を T6 と同じ余裕に揃えるか、区分の境を曲線の外へ寄せるかは判断を仰ぐ（閾値は緩めていない）。
- 未許可の重なりは新しく出力された run（本線 +51・ランプ +167）の組で増える。
- **最終の再計測**（s6p、2026-11-12 06:37〜06:47Z、5 本並列）: compile の ship/pruned は閉鎖 本線 0 / ランプ 6・**violations 0**・本線の穴 0（below の隣 11 か所・6.4 km、範囲外 68）・未収束 0・dangling 0。ship/all は閉鎖 1 / 6（28127324、skip と同じ）・violations 0。既定範囲（compile）は violations 0。tags の ship/pruned は main と全ファイル一致、既定範囲は ledger.json 以外一致。他の値は上の表と同じ（重なり pruned 232 組・2,001 測点）。

## PR #74 のレビュー（Fable、Changes Requested）の手直し（2026-11-12）

**s6p までの結論の訂正**: 「compile の ship/pruned は本線の穴 0・violations 0」は正しいが、**skip が出力していた本線のトンネル 4 本・3.13 km（35266568 C1 770 m、5170834 B 1,674 m、5213545・5213546 1号）を compile は出力していなかった**（閉鎖にも穴にも数えていなかった）。地平 run が below run の seam の親になると、`pruneBelow` がその seam を相手に数え、両側の地平 run が別の成分だと「成分をつなぐ below run」として見送っていた。また s6p の「高架の強制なしの反転 0.766 → 0.427」は数える区間が 235 → 195 km に縮んだ分で、同じ区間では 0.7658 → 0.7573 だった（レビューの計測）。

| 項目             | 直し方                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 トンネル      | `pruneBelow` は地平 run との seam を相手に数えない（地平 run は skip の地表端に当たる、道の続き）。スコアカード `ground.belowUnwritten`（本線を出力した鎖の、出力されない below run の数・km）                                                                    |
| W1 seam の方位   | runs at grade のビルドでは、チャンクの端の方位を run の端で切らず鎖の標本で取り、run の終端は最後の標本で取る（seam の両側が同じ標本）。T3 に seam の方位（`checkSeamHeading`、1e-3 rad、runs at grade のビルドだけ）                                             |
| W2 孤立した凸凹  | 目標を設計地盤線の `mid`（上下の包絡の平均。孤立した 3 m・40 m の盛り上がりで路面 +1.20 m）から、中心線の地表の移動中央値（`movingMedian`、±150 m）に。合成網で 3 m・40 m の凸・凹が平らな地表の場合との差 0.2 m 以内（`mid` では 1.19 m で落ちることを確かめた） |
| W4 トンネルの間  | below run に挟まれた地平の区間を外すのは、指定速度の縦断曲線長（第22条、60 km/h で 50 m）未満だけ。外したものはスコアカード `ground.betweenTunnels`                                                                                                               |
| W6 台帳          | 地平 run は `cut-stretch`・`embankment-stretch`（高架タグの規則）ではなく `ground-stretch` 1 件（run ごと、`heightM` = 測点の路面と地表の差の絶対値の最大）。帯（1.5 m）以内なら規則で通す（`GROUND_STRETCH_REASON`）、超えたら listed                            |
| W8 追従          | `trackingOf` の高架の集計から地平 run を除く（`kind`）。同じ区間の値を下に                                                                                                                                                                                        |
| W9 T3 の床       | `checkChunkJoin` の床（ramp_radius）は height のビルドだけ。tags の T3 は前のまま                                                                                                                                                                                 |
| W10 T12          | height のビルドで T12 から外すのは地平 run（`r.ground`）だけ。高架タグの run の掘割は T12 も見る                                                                                                                                                                  |
| W11 要約の片勾配 | 地平 run の地表端の要約に実際の片勾配（`bankAt`、前は 0 と書いて 157812961 は 9.47 %）。seam・分合流の端の親の値も runs at grade のビルドでは `bankAt`                                                                                                            |
| W3 帯からの離れ  | スコアカード `ground.offGround`（測点の路面と地表の差の絶対値の p95・最大、3 m を超える run の数）                                                                                                                                                                |
| 交差する道路     | `ground.crossingsBlockedMiddle`: run の端の節点（多くはランプの端で一般道に接する所）から 1 m を超えて離れた交差                                                                                                                                                  |
| T13 の測点       | 地平 run は、測点の間の地表の直線が 1 m ごとの DEM から不感帯（0.25 m）を超えて外れる所に測点を足す（knot と同じく間引かない）。4853045:0（B、トンネルの口: s 0 だけ DEM が 2.5 m 高く s 3 で落ちる）を T13 が 18 m の掘割と読んだ                                |

**再計測**（s6q・s6r、2026-11-12 07:30〜08:10Z、4 本並列、M2 Max）。skip（s6q）は s6o と全ファイル一致、tags の ship/pruned（s6q）は main（s6a）と全ファイル一致、tags の既定範囲（s6r）は `public/data/expressway` とタイル全部一致（ledger.json は出力しない）。

| 項目                                   |          skip pruned |                                                                compile pruned（s6p → s6r） |      compile all（s6r） |
| -------------------------------------- | -------------------: | -----------------------------------------------------------------------------------------: | ----------------------: |
| 出力 本線 / ランプ                     |             84 / 231 |                                                                  135 / 398 → **147 / 413** |               165 / 417 |
| 閉鎖 本線 / ランプ                     |                0 / 6 |                                                                              0 / 6 → 0 / 6 |       1 / 6（28127324） |
| violations                             |                    0 |                                                                                  0 → **0** |                       0 |
| skip が出力して compile が出さない run |                    — |                                                                      トンネル 4 本 → **0** |                       — |
| 出力されない below run（数・km）       |             42・59.7 |                                                                **42・59.7**（skip と同じ） |                24・17.0 |
| 地平 run（本・km）                     |                    0 |                                                                      216・47.1 → 232・55.6 |               233・55.7 |
| 本線の穴 それ以外 / below の隣         |              70 / 51 |                                                              0 / 11 → 0 / **3（0.11 km）** |                   0 / 3 |
| トンネルの間で外した地平の区間         |                    — | 8（1132724782、166675172、166675182、372483361、55081186、55081194、816254799、816254802） |                    同じ |
| 帯からの離れ p95 / 最大 / 3 m 超       |                    — |                                                                      2.06 / 7.78 m / 40 本 |        1.93 / 7.78 / 38 |
| blocked（うち run の途中）             |                    0 |                                                                                  104（21） |               104（21） |
| 地平の本線の反転 / 短波長 σ            |                    — |                                    0.145 / 0.120 → 0.251 回/km / 0.158 m（12 本・16.0 km） |                    同じ |
| 最大の成分（run・変数）/ 解く段        | 271・17,852 / 82.8 s |                                                      634・26,624 → 1,112・39,406 / 215.8 s | 1,414・48,682 / 215.2 s |
| タイル gzip 合計 / 最大                |    1.11 MB / 57.2 kB |                                                                   1.23 → 1.26 MB / 61.0 kB |       1.34 MB / 61.0 kB |
| 未収束 / dangling                      |                0 / 0 |                                                                                      0 / 0 |                   0 / 0 |

- W4 で前は外していた長い地平の区間（678697941 1,723 m、878618790 1,690 m、42751508 780 m、301016678 749 m、5204789 536 m、5204787 530 m ほか）は地平 run として出力される。外すのは上の 8 本（どれも縦断曲線長未満）。
- **高架の強制なしの追従を同じ区間で**（レビューの track2 と同じ手順、高架タグの 51 本・350.5 km）: skip の強制なしの区間（235.1 km）で反転 0.7658 → **0.7487** 回/km・短波長 σ 0.433 → 0.423 m。compile の強制なしの区間（195.2 km）で 0.4868 → 0.4509。all は 231.8 km で 0.7636 → 0.7463。
- 地平の本線の反転は 0.145 → 0.251 回/km（目標 0.8 以下は満たす）。目標が中央値になり、地表の長い波に少し沿う分。
- 台帳（`--seed public/data/expressway/ledger.json`）: `ground-stretch` は ship/pruned で new 133・規則で通る 99、既定範囲で new 10・5。高架タグの規則での listed（レビューの 97）はなくなった。最大の離れは seam の手前で高架へ登る所と、トンネルの口（below run の深さ）。帯の判定を最大でするか p95 でするかは PR 7 で決める。
- 既定範囲（compile、s6r）: run 35（地平 15・6.4 km）、violations 0・閉鎖 0・dangling 0、帯からの離れ p95 1.72・最大 4.24 m、blocked 3（途中 1）。

### PR 7 の前提に残すもの（レビューの W5・W7・W12、再レビューの N1〜N3 ほか）

| 項目                        | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W5 地下の盛土               | 地平 run の盛土で中心線の地表より下にあるもの約 3.3 km（既定範囲では 45068169:0・45068170:0）。PR 7 の前に地形のレイ（車から地面が路面より上に見えないか）で確かめる                                                                                                                                                                                                                                                                                                                                             |
| W7 既定範囲の東京港トンネル | 既定範囲を compile にすると東京港トンネル 4854085 ほか約 5.1 km（below run）を範囲に取り込む。9bbad5e（s6r）では既定範囲のビルドが 1,112 run・39,406 変数の成分で、解く段 204 s（tags は 4.9 s）。C1 の修正でトンネルが成分をつなぐのを許すので、pruned の「成分を混ぜない」は地平 run のあるビルドでは効かない。これを受け入れるか。**→ 7c0 で取り下げ**: 4854085 にはランプ 4848757 が分合流で付いていた。地平 run と分合流でつながる below run は S7 まで出力しない（「P2.7-6 PR 7c0」）                      |
| W12 blocks × compile        | `--partition blocks` と compile の組み合わせで、最初は最大のブロックが 20,600 変数になり、本線 43992332・67152889 を閉じた。9bbad5e では ship/all × blocks（k = 1.5）× compile が `BlockTooLargeError`（block 1022523258、21,538 変数 > 20,000）で止まる（S7 で扱う）                                                                                                                                                                                                                                            |
| 途中で横切る道路            | 地平 run の途中を横切る道路 21 本（ship/pruned）。ゲーム側でどう渡すか（跨道橋・アンダーパス）を決める                                                                                                                                                                                                                                                                                                                                                                                                           |
| seam の向こうへの沈み込み   | seam の子（高架・below run）が、親の地平 run の高さを取ったあと地表より下へ沈む所がありうる。seam の向こう側の数を数える                                                                                                                                                                                                                                                                                                                                                                                         |
| N1 端の片側の窓             | 移動中央値は run の端で窓が片側だけになり、坂では目標が地表からずれる（designGround.ts `movingMedian`、compile.ts の `setupGround`）。再レビューの 3 % の坂の合成: 下り側の seam が地表 +3.75 m、上り側は seam の 100 m 手前で −1.68 m、地表端で終わる鎖でも −1.02 m。直し方の案: 地表の標本を鎖に沿って run の端の先まで取るか、端で窓を左右対称に縮める。坂の合成テストを足す                                                                                                                                  |
| N2 帯の内側のずれ           | 路面が帯の内側で地表に留まらず、km 単位で 1 m 前後ずれる（vertical.ts の W_TARGET 0.004、assumptions.ts の `ground.bandM` 1.5）。再レビューの計測では、内側 25 km の 36 本のうち 18 本でずれの中央値が 0.75 m を超え、ほぼ全部が下側。既定範囲の 5213324・45554541 は 1.1〜1.2 m 下で、約 1.1 km が掘割になる。直し方の案: 地平 run だけ目標の重みを上げるか、帯を ±0.5 m 程度に狭める掃引。指標は内側のずれの中央値                                                                                             |
| N3 段丘のような段（記録）   | 段では中央値が段のまま通って行き過ぎる（+4 m の段で、手前 −1.3 m・先 +1.35 m・反転 3）                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ground-stretch` の判定     | p95 だけでは足りない。再レビューの案: 測点の地表の移動中央値の線から測る。seam と地表端から約 100 m は取付けとして別扱いにする。内側は p95 とずれの中央値の両方で見る（近似で listed 133 → 13 本）。N1・N2 の後に決める                                                                                                                                                                                                                                                                                          |
| 小さい点                    | (a) `crossingsBlockedMiddle` の説明（report.ts、「run の climb より離れた」）と実装（端から 1 m）が食い違う。(b) `offGround` の `p95M`・`maxM` のスキーマが km と同じ型（値は m）。(c) scripts/expresswayCases.ts の地平 run の `continue` で、地平 run の thin-girder・low-viaduct の事例が出ない。(d) テストが無いもの: `isAutoAccepted` の ground-stretch、`groundKnots`、`checkSeamHeading` の違反側、`trackingOf` の `kind`。(e) 基準 fixture を作り直すときは `tracking.free` を同じ区間の値で並べる（W8） |

成分が大きくなる（最初の版の ship/all で 1 成分・1,418 run・48,756 変数、解く段 +60〜90 %）。`markSharedTouchdowns` は地表端を見るので、地平 run が入ると外す組が 131 → 0 測点になり、41009552 の型（同じ場所へ降りる本線の上下線の 1 段離し）が戻りうる。PR 3 で数える。

## 落とし穴

- 地平 run を親とする seam の側（高架・below run）は子で、地平 run の端は `open`。
- `markSharedTouchdowns` は地表端を見るので、地平 run が入ると対象が消える（41009552 の型が戻りうる。PR 3 で数える）。
- 地平 run は鎖をつなぐので成分が大きくなる（all で 1 成分・1,395 run・48,428 変数（s6o）。レビュー後の s6r は 1,414 run・48,682 変数）。

[^p276]: 指示は scratchpad の p27/s6-network.md（設計 Fable）。計測は .cache/expressway-area/s6*・.qa/expressway/s6*（ローカル、git 管理外）、合成網のテストは tests/expresswayHeightStructures.test.ts。

[^p275]: 指示は scratchpad の p27/s5-enable.md（設計 Fable）。計測は .cache/expressway-area/s5*・.qa/expressway/s5*、走行は .qa/drives/s5-before・.qa/views/expressway/round-NN/drives、視点とレビューは .qa/views/<表>/round-NN・.qa/reviews/<表>/round-NN.jsonl（ローカル、git 管理外）。

# P2.7-6 PR 3: 高さの組（既定は無効、2026-11-12）

`--touchdown mains|all`（既定 mains）と `--companions off|on` + `--companion-weight <w>`（既定 off、重み 1）。どちらも計測専用（`--out` 必須、`shippedFolderRefusal`）。台帳の merge_skipped の従属はフラグなし（既定データでは判定も ledger.json も変わらない）。[^p276]

## 作ったもの

| 項目         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全クラス化   | `--touchdown all`: `markSharedTouchdowns` の「2 本とも本線」を外す（`Plan.touchdown`）。交差の足元を除く条件はそのまま。地平 run への seam の端も地表端と同じく「降りる所」に数える（`touchdownsNear`。PR 2 で地表端が seam になり、41009552・668292569 の外す組が 60 → 0 になったため）。地平 run と高架の組は、高架の測点が自分の降りる所（地表端か地平 run への seam）の climb の内なら外す（端どうし 60 m の条件は使わない。レビュー W1: 地平 run の近い端は open か坑口で当たらなかった）。mains は前と同じ                                                                                                                                                                                                                                                                                                                   |
| 並走         | `findCompanions`: 本線（below run を除く）どうしで、車線域が離れ（planOverlaps の余裕 0.5 m 以上）その間が 4 m 以内、OSM の layer が同じ、順序のある交差の足元（`crossingReach`）でない所を、id の小さい run に沿って 25 m ごとに取り、続けて 200 m 以上並ぶものを組にする。区間が「高さが離れて」終わる端（次の測点が layer の違う組になる、片方がそこで降りる）からだけ climb の内は行にしない（`held: false`、片側で区間の 1/3 まで、区間を丸ごと消さない。再レビュー N1）（`COMPANIONS`、`verified: false`、`ASSUMPTIONS` に登録）。同じ鎖の run どうしは除く。QP には \|Δz\| ≤ 0.3 m の軟らかい行（`Coupling.within` の `weight`・`companion`）。組は成分をつなぐ（`groupComponents`・`couplingGraph`）。行の外れはランプの段下げの「床版の外れ」に数えない。チャンクの `decks` には書かない。blocks とは併用しない（エラー） |
| 台帳         | `followPairs`（ledger.ts）: レビューの判断の無い merge_skipped は、同じ 2 本の重なりの事例（changeover・parallel-ramp・other・touchdown）が accepted / wontfix で、区間がその重なりの区間（`deckOverlaps` の `spans`: 測点が 25 m を超えて離れたら切った区間のリスト、±5 m）のどれかの内にあり、\|Δz\| が組の cap の maxDzM + 0.05 m 以内なら accepted、`by` にその事例の key。毎回決め直し、外れれば `new` に戻す。レビューの判断のある merge_skipped と、その上限を外れて `new` になったもの（previous が review）は触らない                                                                                                                                                                                                                                                                                                     |
| スコアカード | `companions`（重み、組・測点・km、\|Δz\| の p50・p90・最大・0.3 m 超。測点の組は `<report>.companions.json`）、`ground.openEnds`（地平 run の open な端の、帯の中心〔端から 150 m の内の地表の中央値〕からの離れが帯を超える数と最大）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 届き         | 地平 run への seam の端も、地表端と同じく「端の地表から越えられない道路は行にしない」（`setupRun` の `seamTerrain`: 地表端と同じ `terrainAt` の高さと勾配。再レビュー N2: 端の測点の DEM で勾配 0 だと地表端より悲観的だった）。前は W_BOUND の行を持ち、帯の行（W_FLOOR）より重くて地平 run の端ごと持ち上げた（41009552 の始点の道路 179260411・163198815、17・29 m）                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 片勾配       | `superelevation` の `strict` は、余裕（room）の内なら 0 から離れる向きにも隣の擦り付けに合わせる（親に固定した端の脇の pin が残り、895902565:7 で 2.13‰/m になったため）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 計測（trust signal、2026-11-12 09:35〜09:48Z、M2 Max、5〜8 本並列、ラベル s9-*）

すべて ship、PR 1・2 のフラグを有効（`--structures height --ground compile`）。

**不変**: tags の ship/pruned（s9-tags-pruned）は main（s6a）と全ファイル一致。tags の既定範囲（s9-tags-default）は `public/data/expressway` とタイル全部一致。`public/data/expressway` のコピーに台帳ツールをかけた ledger.json は元とバイト一致（76 件すべて accepted のまま）。

| 項目                                 | 基準 pruned        | touchdown all   | 重み 1                 | 基準 all           | touchdown all  | 重み 1             |
| ------------------------------------ | ------------------ | --------------- | ---------------------- | ------------------ | -------------- | ------------------ |
| 閉鎖 本線 / ランプ                   | 0 / 6              | 0 / 6           | 0 / 6                  | 1 / 6              | 1 / 6          | 1 / 6              |
| violations / 未収束                  | 0 / 0              | 0 / 0           | 0 / 0                  | 0 / 0              | 0 / 0          | 0 / 0              |
| 未許可の重なり（組）                 | 241                | **229**         | 241                    | 251                | **239**        | 251                |
| 　parallel-ramp / changeover / other | 148 / 42 / 51      | 138 / 36 / 53   | 同                     | 149 / 48 / 54      | 139 / 42 / 57  | 同                 |
| 外す組（測点 / 組）                  | 0 / 0              | **1,098 / 126** | 0 / 0                  | 0 / 0              | 1,154 / 143    | 0 / 0              |
| 並走 \|Δz\| p50 / p90 / 最大（m）    | 0.15 / 1.58 / 6.86 | —               | 0.09 / **0.29** / 1.75 | 0.15 / 1.58 / 6.86 | —              | 0.09 / 0.29 / 1.75 |
| 　0.3 m 超の測点（752 のうち）       | 276                | —               | 35                     | 272                | —              | 35                 |
| 強制なしの反転 / 短波長 σ            | 0.471 / 0.335      | 0.477 / 0.337   | 0.471 / 0.343          | 0.463 / 0.319      | 0.469 / 0.320  | 0.463 / 0.327      |
| 分合流 ±300 m の σ                   | 0.476              | 0.477           | 0.469                  | 0.473              | 0.473          | 0.465              |
| open な端 帯超え / 最大              | 115 / 3.62 m       | 118 / 3.62 m    | 117 / 3.62 m           | 122 / 5.11 m       | 125 / 5.11 m   | 123 / 5.11 m       |
| 最大の成分（変数）/ 解く段           | 39,490 / 250 s     | 39,360 / 252 s  | 39,494 / 232 s         | 48,768 / 267 s     | 48,634 / 270 s | 48,772 / 265 s     |

- 並走の組: 24 組・18.8 km（端の先細りの前は 34 組・46.7 km）。前の \|Δz\| は重み 1 の測点の組を基準のビルドの路面で測った値（`.qa/p3an.mts dz`）。重み 2・5 の掃引（s7、先細りの前）も条件を満たし、0.3 m 超は減るが強制なしの反転が増えた（0.456 → 0.471）ので、最小の 1 のまま。
- 基準が PR 2（s6r・s7）から動いた分は、届きと片勾配の直しによる（反転 0.451 → 0.471、帯超え 125 → 115・最大 5.27 → 3.62 m、895902565 の終点 +3.49 → +0.42 m で standard に）。
- **採否（6.3 の条件）**: 全クラス化は閉鎖が増えず、未許可の重なりが減る（×1.05 以内）ので**採る**。並走は重み 1 で p90 ≤ 0.5 m・反転 ≤ 0.8・閉鎖が増えない・未収束 0 を満たし、**重み 1 を採る**。
- **41009552 の型**（コーディネーターの指示）: touchdown all で、41009552 の始点 +5.27 → +1.28 m、668292569 の終点 +5.05 → +1.36 m、地平 run 378284483・378284472 の端も同じ（帯の内）。基準では +0.37・+2.54 m。
- **open な端の帯超え**（`.qa/openends.cjs`、基準 pruned 115、s9）: 99 は子の高架が seam から 150 m の内に地表から 5 m 以上へ登る所（見かけの分け方。取付けと確定してはいない: PR 7 で原因ごとに数え直す）で、地平 run の端が取付けの盛土として持ち上がる（最大 24636427 の終点 +3.62 m、子 27514398）。残り 16 はどれも帯の外れ 0.41 m 以内: 坑口へ下りる所 4（4853042 −1.67、405795846 −1.59、301016678 −1.51、878618790 −1.51 m）と坑口の上 1（45180400 +1.62）、子の高架が低いもの 7（372483373 +1.91、44351598 +1.66、709826346 +1.65、756785283 −1.64、4848757 +1.63、165913325 +1.53、1304769698 +1.52 m）、seam の子が出力されていないもの 4（46913090・46876435・5204789 +1.55 前後、1095393546 −1.50）。all の最大 5.11 m は 24636427 の始点（子は below run 372483362、坑口の上側）。帯を超える端を 0 にするには、seam から取付けの長さを帯の外として扱う（ground-stretch の判定の案と同じ）のが要る。
- **既定範囲**（compile、s9-base-default → touchdown all）: ランプ 24402125 は最高 13.32 → 10.21 m・最急 −11.44 → −5.34 %、45068172 は 13.81 → 10.99 m・11.44 → 3.80 %（レビュー W1 の形が消えた）。4848889・4848755 はほぼ動かない。外す組 915 測点・101 組、未許可の重なり 6 → 4、open な端の帯超え 7 → 5（最大 2.04 → 1.77 m）。ship/pruned の 44129625 は最急 3.98 → −2.70 %。
- **既定範囲の並走**（重み 1）: 3 組・2.25 km、\|Δz\| p90 0.74・最大 1.31 m（45021972|45554540）。外れは並走の区間の始め（45021972 の s 900〜975、45554540 の s 7250〜7175）で、45554540 がそこで 5.7 % で上下する所。45021972 には 4848762（11 号台場線）との重なり 15 測点・最大 5.89 m もあり、床版の重なりの行（W_PAIR 5、20 m ごと）が並走の行（重み 1、25 m ごと）より重い。端の先細りで s 800〜875 が行から外れ、レビュー時の 2.01 m は 1.31 m になった。
- **S5 の記録の 4 か所の起伏**（s7 の計測。今回の直しでは並走の組から外れる所で変わらない）:

| 場所                                  | 今の既定データ（tags）             | PR 1+2（基準）             | 重み 1                            |
| ------------------------------------- | ---------------------------------- | -------------------------- | --------------------------------- |
| 895902565 s 0〜1000                   | −7.82・+3.89・−12.60（幅 16.58 m） | −7.07・+4.73（幅 12.64 m） | 同じ                              |
| 45021976 s 1150〜1350（110-B の手前） | +5.09（s 1175 → 1315）             | +4.04                      | +4.06                             |
| 45021976 s 1090〜1300（V 字）         | サグ s 1175 のみ、幅 5.11 m        | サグ s 1185、幅 4.09 m     | 幅 4.12 m                         |
| 45554540 s 995〜2140                  | +1.77・−1.72・+2.49                | +3.70・−4.23・+2.12        | 同じ                              |
| 45554540 s 7451〜7981                 | +3.79・−4.60                       | +3.93・−4.80               | −4.72・+3.81・−4.90（1 つ増える） |

見立て（並走の拘束で起伏が減る）は外れた。4 か所は交差・JCT の拘束の間の短い区間で決まっている。

- **台帳の merge_skipped**（s7-base-pruned、`--seed public/data/expressway/ledger.json`、`.qa/fold.mts`、区間のリスト化の前）: merge_skipped 650 件（new 624）。いま従うのは 7 件。同じ 2 本の重なりの区間の内にあるものは 258 件で、その組の事例 244 件が決まれば従う。

### 再レビュー（N1・N2）の手直しと計測（s10、2026-11-12 10:15〜10:33Z、7〜8 本並列）

**s9 の結論の訂正**: s9 の「並走の重み 1 で p90 0.29 m」は行の残った 752 測点だけの値だった。先細りが両端から climb を無条件に落とし、約 390 m 未満の区間は行が 0 本（10 組で行が全く無い、24402611|45021976 は 275 m で行 0 本・最大 4.95 m のまま）。対象の全 1,867 測点では p90 0.55 m で 6.3 の条件を満たしていなかった（再レビューの計測）。

- **N1**: 先細りは区間が高さで離れて終わる端だけ（上の「並走」の行）。スコアカードの `companions` は対象の全測点（`stations`・`dz`）と行のある測点（`held`）を別々に出す。
- **N2**: seam の届きは地表端と同じ `terrainAt` の高さと勾配（上の「届き」の行）。

**不変**: tags の ship/pruned（s10-tags-pruned）は main と全ファイル一致、tags の既定範囲（s10-tags-default）は `public/data/expressway` とタイル全部一致、台帳ツールの ledger.json はバイト一致（76 件 accepted）。

| 項目（ship）                             | 基準 pruned        | touchdown all | 重み 1                 | 重み 2             | 重み 5             | 基準 all           | touchdown all | 重み 1             |
| ---------------------------------------- | ------------------ | ------------- | ---------------------- | ------------------ | ------------------ | ------------------ | ------------- | ------------------ |
| 閉鎖 本線 / ランプ                       | 0 / 6              | 0 / 6         | 0 / 6                  | 0 / 6              | 0 / 6              | 1 / 6              | 1 / 6         | 1 / 6              |
| violations / 未収束                      | 0 / 0              | 0 / 0         | 0 / 0                  | 0 / 0              | 0 / 0              | 0 / 0              | 0 / 0         | 0 / 0              |
| 未許可の重なり（組）                     | 242                | 229           | 242                    | 242                | 242                | 252                | 239           | 252                |
| 外す組（測点 / 組）                      | 0 / 0              | 1,098 / 126   | 0 / 0                  | 0 / 0              | 0 / 0              | 0 / 0              | 1,154 / 143   | 0 / 0              |
| 並走 全 1,867 測点 p50 / p90 / 最大      | 0.15 / 1.15 / 7.04 | —             | 0.08 / **0.29** / 6.31 | 0.08 / 0.29 / 6.27 | 0.09 / 0.29 / 6.27 | 0.15 / 1.15 / 7.04 | —             | 0.08 / 0.29 / 6.31 |
| 　0.3 m 超（全測点）／行のある測点の p90 | 615 / —            | —             | 135 / 0.28             | 99 / 0.28          | 78 / 0.27          | 607 / —            | —             | 136 / 0.28         |
| 強制なしの反転 / 短波長 σ                | 0.471 / 0.336      | 0.477 / 0.337 | 0.477 / 0.345          | 0.497 / 0.347      | 0.487 / 0.348      | 0.463 / 0.319      | 0.469 / 0.320 | 0.469 / 0.329      |
| open な端 帯超え / 最大                  | 115 / 3.62 m       | 118           | 116                    | 116                | 116                | 123 / 5.11 m       | 126           | 123                |

- 並走は 34 組・46.7 km（1,867 測点、行のあるもの 1,777）。重み 1・2・5 のどれも全測点の p90 ≤ 0.5 m・反転 ≤ 0.8・閉鎖が増えない・未収束 0 を満たし、最小の **重み 1 を採る**（反転も 3 つで最少）。24402611|45021976 は 11 測点のうち 7 に行が戻り、行のある測点の最大 0.17 m（先細りの測点で最大 3.17 m）。全測点の最大 6.31 m は 44129625|46876436（46876436 の run の終わり、先細りの内）。
- **N2 の確かめ**（`.qa/cross.cjs`・`cross3.cjs`）: 41009552 の s 138 の道路 97671455 は、基準では「端から越えられない」でなくなり行を持つが、668292569 との 1 段離しの行が残って床版が届かず blocked（盛土の下）。touchdown all では越える（blocked にならない）。PR 2 のビルド（s6r）から出力済みの run で新たに blocked になった交差は ship/pruned で基準 43・touchdown all 44、そのうち tags（地表端）でも同じく blocked なものが 38・40、tags に無い run が 1・2、残り 3（46876436 の 777680434・878626252、45248411 の 1386535811。tags では同じ節点の地表端で越えている。原因は未確認、端の速度の区間の違いを疑う）。鉄道 6 件（37793430・5219577 × 24302600・259518635、464736088 × 182342437・182342441）は 6 件とも tags でも「端から越えられない」: PR 2 のビルドで越えていたのは seam の端に届きの規則が無く地平 run の端ごと持ち上がっていたため。既定範囲は 6 件で 6 件とも tags でも blocked。all は 41 件で 36 が tags でも、残り 3 は同じ。
- 合成網のテスト（地平 run への seam の端の届きは地表端より悲観的でない）は、この網では端の勾配の違いが判定の境に当たらず、直す前の版との差は捉えない（性質の確かめとして残す）。
- **既定範囲**（s10）: 24402125 は最高 13.32 → 10.21 m・最急 −11.44 → −5.34 %、45068172 は 13.81 → 10.99 m・11.44 → 3.80 %（touchdown all）。並走（重み 1）: 4 組・181 測点、全測点の p90 0.45 m・最大 3.17 m（24402611|45021976 の先細りの内）、45021972|45554540 は区間の始めに行が戻り最大 1.54 m。
- **外す組の危険**（`.qa/untierisk.cjs`、基準 → touchdown all）: 未許可の重なりは ship/pruned で 242 → 229 組（増えたもの 22、うち外す組 14、減ったか消えたもの 37）、all で 252 → 239（増 17、うち外す組 12）。既定範囲で禁止域が増えたのは 2 組で、どちらも外す組の parallel-ramp: 24402125|45068170（11 → 19 測点、最大 6.03 m）、45068169|45068172（7 → 14 測点、6.06 m）。並走するランプが同じ面から離れる所で、PR 4（平面の分離）の対象かを視点で確かめる。ship で外す組の禁止域が増えたのは 1023900994|800275736（新 7 測点 4.86 m）、1483413151|25603803（4 → 9）、1545539825|668292569（5 → 16、最大 2.45 m に下がる）、157249376|378275643（7 → 18）、53541951|780869432（5 → 15）ほか。

### 訂正（レビュー W6）

- s7 の「残る大きな外れ 44129625|46876436・43992332|67152889 は、片方が交差・分合流を越えるため」は誤り。どちらも並走の区間の端で行が形の上で満たせない所だった（44129625|46876436 は 46876436 の run の終わり、43992332|67152889 は layer の違う below の組への取付け）。端の先細りで両方とも行から外れた。
- s7 の既定範囲の「未許可の重なり 7 → 6」は全クラス化の効果ではない。24402611|45021976 が 1 測点外れて類型が touchdown に戻り、既定の台帳の accepted が当たっただけ。

### PR 7 の前提に残すもの（PR 3 のレビューと再レビュー）

| 項目                        | 内容                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. open な端の帯超え        | ship/pruned で 115（s10 で 115・116）。「99 は高架への取付け」は子の高架の高さで分けた見かけで、確定ではない。PR 7 で原因ごとに数え直し、計画だけで決まる規則（seam からの取付けの長さ）と上限を置く |
| 2. 外す組の危険             | 外す組 1,098 / 126（ship/pruned）。禁止域が増えた外す組 14（ship）。既定範囲の 24402125\|45068170・45068169\|45068172（parallel-ramp）は PR 4 の平面の分離の対象かを視点で確かめる                   |
| 3. 並走の先細りの内         | 全測点の 0.3 m 超 135（ship/pruned、重み 1）、最大 6.31 m（44129625\|46876436、先細りの内）。先細りの長さ（climb）と、行の無い端で床版の段が見えないかを視点で                                       |
| 4. 並走の重み               | 重み 1 は最小で条件を満たす値。重み 2・5 で 0.3 m 超は減る（135 → 99 → 78）が反転が増える                                                                                                            |
| 5. 届きで越えられない交差   | PR 2 のビルドから新たに blocked 43〜44（ship/pruned）、うち 38〜40 は tags でも同じ。残り 3（46876436 の 777680434・878626252、45248411 の 1386535811）は原因が未確認                                |
| 6. 41009552 の s 138        | 基準（mains）では 668292569 との 1 段離しの行が残って blocked。touchdown all では越える。PR 7 で touchdown all を既定にするかと一緒に                                                                |
| 7. 片勾配の strict          | 0 から離れる向きにも合わせるようにした。pin が擦り付けのために動く所が増える（T3・T7 は再計測で 0）                                                                                                  |
| 8. 台帳の従属               | 組の事例 244 件の判断が merge_skipped 約 258 件を畳む（s7 の数）。組の判断を先に、地区ごとに                                                                                                         |
| 9. 既定範囲の東京港トンネル | W7 と同じ（成分 1,112 run・39,490 変数、解く段 210〜260 s）                                                                                                                                          |

# P2.7-6 PR 4: 並走ランプの分離（既定は無効、2026-11-12）

`--ramp-shift <m>`（案 A）と `--nose-surface nose|overlap`（案 B、既定 nose）。どちらも計測専用（`--out` 必須、`shippedFolderRefusal`）。**レビュー（Changes Requested、Critical 2）を直した版で、採る条件を満たす案が無かった（下の表）。採らずに止めて報告した。**[^p276]

## 作ったもの

| 項目         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 案 A の流れ  | `solveWithRampShift`（compile.ts）: 成分全体（needed の全 run を出力）で 1 回解き、ずらす量を決め（`rampShiftOffsets`）、計画からやり直して成分全体でもう 1 回解き、ずらしたランプが悪化した鎖（ずらす対象の測点が増えた、新しい未許可の相手ができた、本線が段を下げた）は offset を捨て、最後の計画で範囲を解く（3 回解く）。範囲でなく成分全体で決めるので、範囲に依らない（レビュー C1、T8）                                                                                                                                                                            |
| ずらす対象   | `shiftTargets`: 分合流でつながる（`overlapClass.isJoined`）本線とランプの組の測点のうち、未許可の重なり（\|Δz\| が同一面〔0.05 m〕を超え 1 段に満たない、ただし nose 規則〔つながる組で 0.5 m 以内〕で許される組は除く）と、実行時が一体化を手放す \|Δz\|（MERGE_MAX_DZ と同じ 0.15 m）を超える測点（merge_skipped、汐留入口の merge-wedge）。nose 規則だけの理由ではずらさない（レビュー W3）                                                                                                                                                                             |
| ずらす量     | 区間（測点の間 25 m 以内）ごとに、車線域 2 本と 0.5 m から中心線の距離を引いた最大、上限 S（`RAMP_SHIFT.maxM` 3 m が既定、仮定）、ずらす側の空き（1 段離れていない他の床版、地表の道路・鉄道、それぞれ両方の半幅と 0.5 m）で頭打ち（W1）。両端と節点（分合流・run の端）から `RAMP_SHIFT.taperM` 40 m の内は余弦で 0 へ。区間の内で届く重みが `minReach` 0.5 未満の区間、区間の内で本線が左右両方にある（交差する）区間、同じ鎖への逆向きの要求が重なる区間はずらさない（W2・C2、`composeShiftRequests`）                                                                  |
| 平面         | horizontal.ts `PlanInput.offset`: 平滑化の目標を OSM の左法線へずらし、平滑化が戻した分を目標に足し直して 2 回合わせ直す（ε を足すのをやめた: 0.06 m の要求で約 1.5 m 動いた、W3）。pinned の標本はずらさない。ずらした標本は OSM から 1.5 m の検査から外し、run の要約に `rampShiftM` と上限 `rampShiftCapM`、T6 で `rampShiftM ≤ rampShiftCapM + ε`（W5）                                                                                                                                                                                                                |
| 案 B         | 分合流でつながる組（節点を共有する）は、車線域が重なる間ずっと同一面（`classifyPairs`、`Plan.noseSurface`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 区分の数え方 | `just count-overlap-shapes <label> [<基準>]`（scripts/expresswayOverlapShapes.ts、1 行の JSON ログ）: 未許可の重なりの組を、最小 \|Δz\| ≥ 5.7 m（1 段にあと少し）を先に、つながる（`overlapPairs` の `joined`）か否か、禁止域の測点の 25 m の内に \|Δz\| ≤ 0.2 m の測点があれば「同一面から」、無ければ「途中」で分ける。基準を渡すと、基準の parallel-ramp「つながる・同一面から」の組を追ってまだ未許可の数（`tracked`）と、つながる組の測点（`joinedStations`）。main（s6a）の parallel-ramp は 60 / 12 / 8 / 8 / 17（0.3 節は 52 / 19 / 8 / 8 / 17、境の取り方の違い） |

## 計測（trust signal、2026-11-12）

基準は PR 1〜3 のフラグを有効（`--structures height --ground compile --touchdown all --companions on --companion-weight 1`、p4-base-*）。

**不変**: tags の ship/pruned（q-tags-pruned）は main（s6a）と全ファイル一致、tags の既定範囲（q-tags-default）は `public/data/expressway` とタイル全部一致、台帳ツールの ledger.json はバイト一致（76 件 accepted）。

**C1（範囲に依らないか）**（`.qa/common.cjs`、`signs` を除く）: 直す前（p4-a3）は既定範囲と ship/pruned の共通 344 チャンク中 207 が違った（最大 |Δz| 3.51 m、1059139534:6）。直した後（q-a3、q-a5）は共通 345 中 2 だけが違い、|Δz| は 0（24402125:0 の緯度 1 つが 1e-7 度、45068171:1 の blocked が 1 本）。残る 2 つの原因の見立ては、空きを測る地表の道路の一覧が範囲で変わる（範囲の run の周りのセルから読む）こと（未確認）。ずらしの無い基準どうし（p4-base）は共通 346 チャンクが全部一致。**フラグ有りの T8 は完全ではない**（再レビュー）: 残る 2 チャンクを無くすには、空きを測る相手（他の床版・地表の道路）を同じ成分のものに限る案がある（未実装）。

### 直す前（レビューの版、p4-*、10:45〜11:13Z）

| ビルド            | つながる・同一面から | 追跡でまだ未許可（基準の 56） | つながる組の測点 | 未許可の重なり | 動かした run / 最大 | 新しい未許可の組             |
| ----------------- | -------------------- | ----------------------------- | ---------------- | -------------- | ------------------- | ---------------------------- |
| 基準 pruned       | 56                   | —                             | 757              | 229            | 0                   | —                            |
| A S 3 pruned      | 15                   | 25                            | 223              | 187            | 94 / 4.37 m         | 13（うち 10 がずらした run） |
| A S 5・S 8 pruned | 10・8                | —                             | —                | 180・181       | 94 / 6.27・9.44 m   | —                            |
| B pruned          | 63                   | —                             | —                | 256            | 0                   | —                            |

案 B・C（S 3 + B、S 5 + B）は悪化（T3 1〜2、重なり増）。区分の数だけでは S 3 で 56 → 15 だったが、追跡では 25 組がまだ未許可で、測点では 757 → 223。本線の高さの差（基準 → A S 3、ship/pruned）は最大 11.33 m（22694126）、1 m 超 1,398 測点。

### 直した後（q-*、2026-11-12 11:52〜12:09Z、8 本並列）

| ビルド       | 追跡でまだ未許可（基準の 56 / 55） | つながる・同一面から | つながる組の測点 | 未許可の重なり | 動かした run / 最大 / 3 m 超 | 捨てた鎖 | 新しい未許可の組 / 新しい交差 | ランプの閉鎖 | 強制なしの反転 / 分合流 σ | 解く段 |
| ------------ | ---------------------------------- | -------------------- | ---------------- | -------------- | ---------------------------- | -------- | ----------------------------- | ------------ | ------------------------- | ------ |
| 基準 pruned  | —                                  | 56                   | 757              | 229            | 0                            | —        | —                             | 6            | 0.482 / 0.467             | 299 s  |
| A S 3 pruned | **44**                             | 42                   | 545              | 210            | 38 / 3.76 m / 6              | 15       | 2 / 0                         | 6            | 0.466 / 0.454             | 846 s  |
| A S 5 pruned | **43**                             | 41                   | 534              | 209            | 38 / 6.50 m / 7              | 15       | 2 / 0                         | 6            | 0.463 / 0.452             | 836 s  |
| 基準 all     | —                                  | 55                   | 740              | 239            | 0                            | —        | —                             | 6            | 0.474 / 0.463             | 306 s  |
| A S 3 all    | **44**                             | —                    | 546              | 222            | 36 / 3.76 m / 6              | —        | 2 / 0                         | 6            | 0.458 / 0.449             | 881 s  |
| A S 5 all    | **43**                             | —                    | 535              | 221            | 36 / 6.35 m / 7              | —        | 2 / 0                         | 6            | 0.455 / 0.447             | 891 s  |

- violations 0、未収束 0、本線の閉鎖は全条件で基準と同じ（pruned 0、all 1: 28127324）。新しい未許可の 2 組（1051967540|44803854、156280206|23681223、どちらも 1 測点）はずらした run と関係のない組（同じ成分の高さが動いた分）。新しい交差 0（ずらした run の交差の数で数えた、`.qa/p4new.cjs`）。これはずらした run だけの数で、ずらした鎖の地平 run には新しい交差が 4 件ある（再レビュー）。
- **採る条件**（コーディネーター: 追跡で未許可が基準の 3 割以下〔17 組以下〕、ランプの閉鎖が増えない、新しい未許可の重なりと地表の新しい交差が 0、の最小の S）: **満たす S が無い**（44・43 組）。新しい未許可の重なりも 0 でない（2 組、ずらした run とは関係なし）。閾値は緩めず、採らずに止めた。
- 追跡の内訳（S 3 pruned、基準の parallel-ramp のつながる組 70 のうち、`.qa/why.cjs`）: ずらして直った 14、ずらしても残る 22、悪化で捨てた鎖の 11、要求が出なかった 23（W2・W3・C2 の除外: 端の重みが足りない、交差する、nose 規則だけ、逆向きの要求）。直す前の版では直った 35・残る 35。直した規則はどれも、レビューの指摘（範囲で変わる、本線の向こう側へ押す、第三の床版へ押す、効かない所で同一面を膨らませる）を止めたが、効き目もそれだけ落ちた。
- 本線の高さの差（基準 → A S 3、ship/pruned、`.qa/maindz.mts`）: 直す前は最大 11.33 m（22694126）・1 m 超 1,398 測点、直した後は最大 5.80 m（1467911980、41520088 4.80、44803854 3.10、28188273 3.06、920238368 3.04 m）・1 m 超 454 測点（34,487 測点中）。案 A が動かすのはランプの平面だけで、本線は**平面だけ**が動かない（高さは成分の解き直しで動く）。
- **動かした量 3 m 超の run**（S 3、直した後、pruned）: 6 本（上限 3 m に平滑化の補正が乗る、最大 3.76 m）。一覧はスコアカード（`rampShiftM`）から。
- **既定範囲**（q-a3-default）: 動いたのは 24402125（2.26 m）と 45068172（0.73 m）の 2 本、捨てた鎖 15。汐留入口の merge-wedge（`merge_skipped:45068172:1|45021976`）は 0.89 m・s 267〜282 → 0.50 m・s 277〜286 に縮んだが残る（直す前の版では消えていた: そのときのずらしは nose 規則で許される組も対象だった）。PR 3 で増えた 2 組（24402125|45068170、45068169|45068172）はつながらない組で、案 A の対象の外のまま。

## 落とし穴

- 案 A は解の後でしか決まらない（どこで高さが離れるか）。範囲だけの解から決めると範囲で変わる（C1: 既定範囲と ship で共通 207 チャンクが違った）。成分全体を解いて決める。
- 1 本のランプのずらしの要求は、他の本線・床版・地表の道路を見ないと逆側へ押し出す（C2: 31090753 が 67152889 の中心線を越え、最小半径 114.7 → 68.7 m、67152889 が specialGrade + lowerSpeed に）、第三の床版や道路へ押し出す（W1: 新しい未許可 13 組、新しい交差 6）。逆向きの要求は両方とも捨て、ずらす側の空きで頭打ちにし、2 回目の解で悪化した鎖を捨てる。
- 平滑化は目標から ε まで戻すので、目標を戻された分だけ足し直す（ε を足すと小さい要求でも約 1.5 m 動く）。
- 区分の数（つながる・同一面から）だけでは効き目を見誤る: ずらした組が「途中」や「1 段にあと少し」に移るだけのことがある。基準の組を追い、つながる組の測点で見る。

### PR 7 の前提に残すもの（PR 4）

| 項目                   | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 採否                   | **採らない**（コーディネーター判断、2026-11-12: 7.2 の「満たす案が無ければ数値を報告」に従い計測用のフラグとして残す。PR 7 で `--ramp-shift`・`--nose-surface` を既定にしない。汐留型の 56 組は R1〜R3 の台帳の判断〔事例ごと〕へ）。案 A は今の規則では条件に届かない（追跡で 44 / 56 が未許可）。続けるなら、要求が出ない 23 組（端の重み・交差・逆向き）と、悪化で捨てた鎖の 11 組を 1 組ずつ見て規則を足すか、平面の分離をやめて「重なる間は同一面に保つ」別の方法（B の重みでなく、ランプの縦断を本線に沿わせる）を探す |
| 汐留入口の merge-wedge | 0.50 m・9 m で残る。PR 5（実行時）の側で受けるか                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3 回解く時間           | 解く段 約 2.8 倍（300 → 840 s）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 本線の高さ             | 成分の解き直しで最大 5.80 m 動く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

# P2.7-6 PR 6: 分合流で本線が譲らない（既定は無効・採らない、2026-11-12）

`--hold-mains off|on`（既定 off、計測専用で `--out` 必須、blocks とは併用しない）。**採る条件に届かず、採らない。「本線が譲る件」は R 以降の課題として閉じる。**[^p276]

## 作ったもの

| 項目           | 内容                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本線の基準の線 | `solveComponent` の `mainLinesOf`: 成分の本線の run を、他の run の行（分合流・交差・床版の組）なしで、それぞれ最初の段で単独に解いた線（成分ごとに 1 回、最初に要る解で）。指示の S2 `solveRoute` は blocks の片を解くもので、成分の解には片が無いので、同じ考え方（他 run の拘束なしの解）を run ごとの単独の解にした                                           |
| 外れの数え方   | 各解の後（`solveAt`）、ランプの分合流の取付き（junction の親の s）から ±`HOLD_MAINS.reachM` 300 m を 20 m ごとに見て、本線が基準の線から `slackM` 5 cm を超えて外れた分を、そのランプの「軟らかい外れ」（`soft`、取付きの端の s）に足す。本線に新しい行は足さない。今の「重なりを守れないランプは段を進め、改善しなければ一番ましな段へ戻す」仕組みにそのまま載る |
| 値             | `HOLD_MAINS`（`verified: false`、`ASSUMPTIONS` に登録）。注: `mainLinesOf` の単独の解は `stats.solves`・`qpMs` に数えていない。基準の線は成分で最初に要った解の時点で固定され、その後の段の変化（ランプの段）では作り直さない                                                                                                                                     |

## 計測（trust signal、2026-11-12 12:22〜12:36Z、M2 Max、8 本並列、ラベル h-*）

基準は PR 1〜3 で採ったフラグ（`--structures height --ground compile --touchdown all --companions on --companion-weight 1`、`--ramp-shift` なし）。

**不変**: tags の ship/pruned（h-tags-pruned）は main（s6a）と全ファイル一致、tags の既定範囲（h-tags-default）は `public/data/expressway` とタイル全部一致、台帳ツールの ledger.json はバイト一致（76 件 accepted）。

| 項目                                                          | 基準 pruned        | hold on pruned         | 基準 all           | hold on all       | 基準 既定範囲 | hold on 既定範囲 |
| ------------------------------------------------------------- | ------------------ | ---------------------- | ------------------ | ----------------- | ------------- | ---------------- |
| 分合流 ±300 m の σ                                            | 0.467              | 0.465                  | 0.463              | 0.461             | 0.526         | 0.522            |
| 分合流の反転                                                  | 0.583              | 0.563                  | —                  | —                 | —             | —                |
| 強制なしの反転 / σ                                            | 0.482 / 0.346      | 0.477 / 0.345          | 0.474 / 0.330      | 0.469 / 0.329     | 0.452 / 0.296 | 0.565 / 0.297    |
| ランプの段 standard / specialGrade / lowerSpeed / assumedGive | 157 / 14 / 241 / 1 | **110 / 10 / 292 / 1** | 155 / 14 / 246 / 2 | 111 / 9 / 295 / 2 | 7 / 0 / 8 / 0 | 5 / 0 / 10 / 0   |
| 閉鎖 本線 / ランプ                                            | 0 / 6              | 0 / 6                  | 1 / 6              | 1 / 6             | 0 / 0         | 0 / 0            |
| 未許可の重なり                                                | 229                | 227                    | 239                | 238               | 4             | 4                |
| violations / 未収束                                           | 0 / 0              | 0 / 0                  | 0 / 0              | 0 / 0             | 0 / 0         | 0 / 0            |
| 解く段                                                        | 254 s              | 226 s                  | 267 s              | 221 s             | 247 s         | 210 s            |

- **採る条件**（9 節: 分合流の σ が 0.1 m 以上下がる、ランプの閉鎖が増えない、強制なしの反転 0.8 以下、未収束 0）: σ は −0.002 m（pruned・all とも）で**届かない**。閉鎖は増えず、反転・未収束も条件の内。採らない。
- 見立て（「ランプが標準の段で届かないと、段を進める前に QP が本線を曲げて合わせる」）は合成網では合った（tests/expresswayHoldMains.test.ts: 取付く 120・160 m のランプで本線の外れが減る、80 m では最後の段でも届かず今と同じ）。ship では約 50 本のランプが段を進めた（standard → lowerSpeed）が、分合流の σ はほとんど動かない: 本線の分合流 ±300 m の短波長は、ランプの段ではなく交差・床版の組・構造物の固定で決まっている所が多いと見る（未確認）。ランプの段が進むのは、速度の区間（V の低い窓）が増えるだけの悪化。
- **S5 の記録の 4 か所の起伏**（既定範囲、基準 → on、`.qa/swings.sh`）: 895902565 −7.18・+4.92 → −7.26・+4.98、45021976（110-B の手前）+4.96 → +4.96、同（V 字）幅 4.99 → 5.00 m、45554540 s 995〜2140 +3.06・−4.00・+2.75 → +3.10・−4.14・+2.74、s 7451〜7981 −2.84・+2.97・−5.61 → −2.84・+2.98・−5.59。どれも変わらない。
- **PR 3 の並走の残り**（既定範囲、重み 1 の測点の組）: 45021972|45554540 最大 1.54 → 1.54 m、45019020|4848762 2.60 → 2.12 m、24402611|45021976 3.18 → 3.18 m。全測点の p90 0.453 → 0.453 m。

## 閉じる課題

「分合流で本線が譲る件」は、ランプの段を先に進めても分合流の σ が下がらない（−0.002 m）ので S6 では閉じる。R 以降で、本線の分合流 ±300 m の短波長が何で決まっているか（交差・床版の組・構造物）を 1 か所ずつ見てから決める。

## PR 7 の前提の一覧（S6 の全 PR、2026-11-12）

PR 7（有効化と既定データの作り直し）の作業指示のための索引。中身は各節の表にある。

| PR   | どこに                                                                                               | 項目                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 1 | 「P2.7-6 PR 1」の **PR 7 の前提（再レビュー、Approve の条件）** の表                                 | R1 地下の盛土、R2 掘割の閾値（PR 2 で済み）、R1 の台帳での可視化（PR 2 で済み）、R3 窓にかかる盛土、R4 空中の盛土、R5 same の組で実際は離れている所の盛土、W4 の残り（盛土の高い側の擁壁）、テスト、データテスト、画面、コライダー、T13 の独立性、段の戻し、名前、R6 そのほか（(a) T13 の独立性、(b) 盛土の壁のコライダー、(c) 薄い桁は交差の中心のチャンクだけ、(d) T4 は窓の最低点を見ない、(e) 交差の窓のテストが cross と blocked の両方で通る、(f) 「作ったもの」の表は 204f4ef で直し済み） |
| PR 2 | 「P2.7-6 PR 2」の **PR 7 の前提に残すもの（レビューの W5・W7・W12、再レビューの N1〜N3 ほか）** の表 | W5 地下の盛土、W7 既定範囲の東京港トンネル、W12 blocks × compile、途中で横切る道路、seam の向こうへの沈み込み、N1 端の片側の窓、N2 帯の内側のずれ、N3 段丘のような段、ground-stretch の判定、小さい点（a〜e）                                                                                                                                                                                                                                                                                     |
| PR 3 | 「P2.7-6 PR 3」の **PR 7 の前提に残すもの（PR 3 のレビューと再レビュー）** の表                      | 1. open な端の帯超え、2. 外す組の危険、3. 並走の先細りの内、4. 並走の重み、5. 届きで越えられない交差、6. 41009552 の s 138、7. 片勾配の strict、8. 台帳の従属、9. 既定範囲の東京港トンネル                                                                                                                                                                                                                                                                                                        |
| PR 4 | 「P2.7-6 PR 4」の **PR 7 の前提に残すもの（PR 4）** の表                                             | 採否（採らない、`--ramp-shift`・`--nose-surface` は既定にしない、汐留型の 56 組は R1〜R3 の台帳の判断へ、次の候補）、汐留入口の merge-wedge、3 回解く時間、本線の高さ。ほかに「フラグ有りの T8 は完全ではない」「新しい交差 0 はずらした run だけの数」の補足                                                                                                                                                                                                                                     |
| PR 5 | 「P2.7-6 PR 5」の節                                                                                  | (A2) 段 0・内側の面 149〜158 mm の 4 件（手放しの切り口を本線の縁に沿わせる）、(B) 3 枚以上の床版が重なる所の 21 件、(A) 手放しの帯の 13 件と規則の案（滑る帯の上限 = MERGE_MAX_DZ + 弦の許容 × 2）、2 → 4 車線の継ぎ目、汐留入口の merge-wedge（PR 4 の後も 0.50 m・9 m で残る）                                                                                                                                                                                                                 |
| PR 6 | この節                                                                                               | 採らない（`--hold-mains` は既定にしない）。「分合流で本線が譲る件」は R 以降へ                                                                                                                                                                                                                                                                                                                                                                                                                    |

PR 7 で既定にする候補は PR 1〜3 で採ったフラグ（`--structures height`、`--ground compile`、`--touchdown all`、`--companions on` 重み 1）。PR 4・6 のフラグは既定にしない。

# P2.7-6 PR 7a: コンパイラ・検査・台帳の前提の修正（フラグのまま、2026-11-12）

PR 7 の前提の一覧のうち、コンパイラ・検査・台帳の側を直した（S6 PR 7a）。直したのは地平 run の目標線（N1・N2）、ground-stretch・open な端の規則、R3〜R6、ground-crossing の台帳、データテスト。既定のフラグでは、既定データと ship/pruned がバイト一致する（下の「不変」）。基準は PR 1〜3 で採ったフラグ `--structures height --ground compile --touchdown all --companions on --companion-weight 1`。

- 計測は `.qa/expressway/` の `p7a-base-*`（基準）と `p7j-*`（再レビューの C2 の後の 7a。掃引は `p7j-k*`）。`p7h-*` は C1 の後・C2 の前。
- 初版の値（`p7b-*`・`p7f-*`・`p7g-*`）は、レビュー C1・再レビュー C2 の目標線の直しで取り直した。この節の値はすべて C2 の後のもの。

## 0.1 節の再現

0683f14 の基準は `diff -rq` で一致した。比べた組は h-base-default ↔ p7a-base-default、h-base-pruned ↔ p7a-base-pruned、h-base-all ↔ p7a-base-all。

## N1: 目標線（初版の誤りとレビュー C1・W1 の訂正）

- **今の形**（`designGround.ts groundTarget`・`repeatedMedianLine`、`compile.ts groundTargetOf`）: 地平 run 自身の地表だけを 5 m の格子で取る。各測点で ±reach（150 m）の窓（run の端で切る）に Siegel の repeated median の直線を当て、その測点での値を目標にする。直線の値は、窓の頑健な傾きを引いた残差の中央値。
  - 平らな内側では移動中央値と同じになる。坂では遅れない。
  - 端では窓が片側（reach の長さ）になるだけで、規則の切り替えが無い。25 m や reach の所に境の不連続は無い。
- **地表端の勾配も目標線から**（`setupGround`）: 地平 run の地表端の固定勾配を、目標線の端 20 m の傾き（第20条の標準の半分で頭打ち）にした。高さは DEM の端の値のまま（T5）。それまでの `terrainAt` は DEM の ±40 m の 2 点を使っていた。そのため端から 5〜45 m の 3 m の凸で勾配が 2.5 % 傾き、路面が 0.6 m 動いた。
- **訂正 1（W1）**: 初版は「鎖の先がコンパイルする地平 run なら reach まで延ばす」と書いて実装したが、その分岐には到達しない。`splitRuns` は構造が変わる所でしか run を切らないので、地平 run の隣は必ず高架か below run か鎖の端になる。延長のコードと引数は消した。実態は「すべての端で、自分の地表だけで推定する」で、コーディネータの判断の案 1 と同じ結果になる。
  - 920238350・920238351 は、4.1 の通り「高架の側へ延ばす」と隣の高架の下の地表に引かれ、自分の地表より約 6 m 低くなった。そのせいで T3:1 が出ていたが、案 1 で消えた。範囲外の run の地表は使わないので、目標線は範囲に依らない（T8）。
- **訂正 2（C1、ユーザーの注意「DEM の凸凹に追従させない」に直接反していた）**: 初版の端の扱いは、端から 25 m の内を 50 m の最小二乗の直線、その外を縮めた中央値（半幅 = 端までの距離）にしていた。これが DEM の凸凹を拾った。
  - 3 m × 40 m の凸・凹を端から 25・40 m に置くと、路面が最大 1.5 m（地表端）・2.28 m（seam）動いた。seam では 60 m に置いても 0.82 m 動いた。
  - 最小二乗は外れ値に弱い。縮めた中央値は半幅 25〜40 m なので、40 m 幅の凸がそのまま通る。
  - 地平 run は長さの p50 が 97 m で、300 m 未満が 191 本、100 m 未満が 124 本ある。大半は ±150 m の中央値がどこにも掛からず、50 m 未満の run は全体が DEM の最小二乗の直線になっていた。
- テスト（tests/expresswayGroundTarget.test.ts、v2 の目的で解く）:
  - 3 % の坂で、seam・seam の 100 m 先・地表端のいずれも |目標 − 地表| ≤ 0.3 m（移動中央値は > 1 m）。下り坂で seam へ入る形も同じ。
  - 3 m × 40 m の凸・凹を地表端と seam の両方の端から 25・40・60・100 m に置いても、平らな場合との路面の差は 0.2 m 以内。直した後は 16 通りすべてで 0.00 m だった。
  - 窓の 4 分の 1 が 3 m 外れても、repeated median は 0.05 m 以内。最小二乗は 0.5 m を超えてずれる。
  - 5 m ごとの段差は 0.2 m 以内。±0.4 m・44 m 周期の波に 2 % の坂を重ねた場合、移動中央値だけでは 0.38 m の段が出た。
  - 9.7 m の盛り上がりの 100 m の地平 run の先が、2 m の地表の上の高架でも、|目標 − 地表| ≤ 0.3 m。

## C2: 同一面の 2 本の地平 run と短い run の目標線（再レビュー）

- **原因**: 150 m 未満の短い地平 run では、窓が run 全体になる。そのため目標線の傾きが粗い DEM の 20 点前後で決まり、同一面の 2 枚で目標線が食い違った。
  - 汐留の 24039751 と 24402609（中心線の間隔 8.3〜9.2 m、同一面 107 m）では、傾きが −3.55 % と −0.58 % で、端で 1.6〜2.0 m 違った。合わせて当てると −1.22 %。
  - 路面の |Δz| は、同一面の前半 30 m で 0.13〜0.19 m（一体化をやめる 0.15 m を超える）、坑口の端で 3.88 m。24039751 は盛土と掘割が交互の 6 チャンクに刻まれた。
  - ship の同一面の地平 run の組 38 のうち、目標線の食い違いが 0.5 m 超は 16 組、1 m 超は 11 組。
  - 目標線が窓の DEM の範囲の外に出る測点が 276 あった（0.3 m 超 33 本、最大 2.17 m、372483373）。
- **直し方**:
  - (1) 同一面の相手が地平 run のとき、相手自身の測点の地表（計画の same の組の、相手側から見つけた組 `a` を `sb` で自分の軸に置く）を自分の窓に合わせて、1 本の repeated median の直線を当てる（`groundTargetOf`・`groundTarget` の `partner`）。こうすると 2 本の窓は両方の run 自身の測点の同じ集合になり、2 本の目標線が一致する。ただし一致するのは、長さの揃った 2 本の組だけ（下の「残り」）。相手は同じ成分にあるので、範囲に依らない（T8）。
  - (2) 目標線を窓の DEM の最小〜最大に収める。
  - (3) 窓の中で 2.5 m 未満しか離れない 2 点からは傾きを取らない（`SLOPE_MIN_DX_M`）。相手の測点が自分の測点の µm 隣にあると ±10⁵ の傾きが全部同じ符号で入り、線が傾いた（同じ点で 0.0016 と 0.0029）。
  - (4) 格子の最後の重複した測点は 1 点に数える。
  - 重みを下げる案は採っていない。
- テスト:
  - 8 m 隣の 2 本に別々の凸凹（±0.6 m の波と 1 m の段）を載せた合成で、2 本の目標線の差は 0.15 m 以内（直した後は 0.00〜0.01 m）。
  - 60 m・4 % の坂で、端が 1.5 m 外れても、目標線は窓の地表の範囲に収まる。
- **結果**:
  - 24039751 のチャンクは 6 → 2（盛土 0〜106 m、掘割 106〜118 m。基準は盛土 1 本）。
  - 既定範囲の未許可の 3 組は残った（組は 7 のまま。目標の基準 4 組には届いていない）。ただし |Δz| は 0.07〜0.20 → 0.07〜0.13 m に下がった。
    - 24039751 × 24402609（12 測点）、24039751 × 24402611（2 測点、0.07 m）、24402609 × 895902565（2 測点、0.07 m）。
    - 24039751 × 24402609 の路面の差は、24039751 の s 0〜35（24402609 の open な端の側、子 24402611 が高架へ登る取付け）で +0.07〜+0.13 m。そこから 24402609 の坑口へ向けて開き、同一面の区間の中では坑口側で −1.69 m、24039751 の終端では 2.54 m になる（坑口の高さが DEM に固定されている。W10、S7 へ）。
  - ship の同一面の地平 run の組の路面の |Δz| の最大は、p50 0.07・p90 0.67 m（基準 0.06・0.83 m）。
- **残り（3 回目のレビュー W11）**: 3 本以上が同一面でつながる集まりや長さの違う組では、2 本の窓が同じ集合にならず、目標線が食い違ったまま残る。
  - ship/pruned で目標線の食い違いが 0.15 m 超は 15 組、0.5 m 超は 8 組。最大は 203832847 × 756785283 の 2.06 m。
  - 44778905 × 44779770 は 0.12 → 0.87 m に広がった。
  - 路面は組の結合（W_PAIR）で保たれている。既定範囲には該当する組が無い。
  - 直すなら R で、同一面でつながる集まり全体を 1 つの集合にして 1 本の線を当てる。
- **窓の地表の範囲に相手の地表が入る件（W12）**: (2) で目標線を収める範囲に相手の地表も入るので、坑口で 2 本の地表が 5 m 違う組では、自分の地表から外れた所に収まる。45420940 は自分の地表の範囲から 2.83 m 外にあり、24636427 は目標線が 7.11 m 動く。路面は坑口の高さの固定で変わらない。S7 で W10 と一緒に見る。

## N2: 帯の内側のずれ

- フラグ `--ground-target-scale k`・`--ground-band m`（計測用）。スコアカードに `ground.inner` を足した。両端から 100 m を除いた内側が 100 m 以上ある地平 run について、run ごとの（路面 − 目標線）の中央値を出す。照合用に `vsGround` も出す。採った値はスコアカードの `ground.settings` と report.json の `ground` に残る。
- 掃引（ship/pruned、帯 1.5 m、C2 の後のコード、地平 run 41 本・29.2 km）:

| k                                       | 1                    | 10                   | **30**                   | 100                     |
| --------------------------------------- | -------------------- | -------------------- | ------------------------ | ----------------------- |
| \|中央値\| 0.75 m 超                    | 19                   | 5                    | **0**                    | 0                       |
| \|中央値\| 0.3 m 超                     | 29                   | 13                   | **5**                    | 0                       |
| p5 / p50 / p95（m）                     | −1.38 / −0.19 / 1.26 | −0.79 / −0.07 / 0.62 | **−0.36 / −0.03 / 0.31** | −0.16 / −0.01 / 0.15    |
| 地平の反転（回/km）                     | 0.313                | 0.376                | **0.626**                | 0.751                   |
| 地平の短波長 σ（m）                     | 0.145                | 0.200                | **0.230**                | 0.256                   |
| 高架の強制なしの反転                    | 0.4714               | 0.4714               | **0.4766**               | 0.4612                  |
| 閉鎖（本線/ランプ）・violations・未収束 | 0/6・0・0            | 0/6・0・0            | **0/6・0・0**            | 0/6・**T3:1・T13:1**・0 |

- 条件を満たす最小の k は **30**（C2 の後に確かめ直した）。k = 10 は 0.3 m 超が 13/41 = 32 %、k = 100 は violations が出る（C1 の後の掃引では反転 0.81）。
- `HEIGHT_STRUCTURES.ground.targetScale = 30`（verified: false、根拠に掃引の表）に置き、帯は 1.5 m のまま。
- 掃引の初版では T13:1〜2 が出ていた。原因は独立した T13 の欠陥で、別の deck の上の測点を宙の盛土の塊の切れ目に数えていなかった（780870438:0・331922700:0）。直した。
- Fable レビューの帯域の分解: 路面は短い凸凹に乗っていない。反転の増加は E4 の 2 本の実際の 1.5 km 級の起伏で、追うべきもの。短波長の相関が 0.530 → 0.748（ship）・0.502 → 0.729（既定範囲）に上がったのも、目標線に合った分（レビュー時の値は初版の 0.814・0.820）。
- テスト:
  - (1) 1.5 km の地平 run で、両端の 100 m が 1.2 m 低くても、内側の中央値は 0.3 m 以内。k = 1 では 0.3 m を超える。
  - (2) ±0.5 m の乱数（5 m 刻み、種 7）を足しても、短波長 σ ≤ 0.1 m・反転 ≤ 0.8 回/km。端を含む全長で、平らな場合との差 ≤ 0.15 m（レビュー W8: trackingOf は端 300 m を除いていた）。
  - (3) N3（+4 m の段、合否にはしない）: 段の 150 m 手前で 2.42 m、段で 4.76 m、150 m 先で 7.77 m、反転 2.22 回/km。テストはこの値と結びつけた（`N3_RECORDED`）。

## 4.3 ground-stretch と open な端

- 目標線から測る（`compile.ts groundFitOf`、run の要約の `groundFit`）。
  - 取付けの長さは計画から決める（`groundApproaches`: 自分の端の endPlan と、鎖の隣の run の種類）。隣が高架か自分が seam の子なら 150 m、坑口・地表端・分合流は 100 m、鎖の open な端は 0。残りが内側。
  - 初版は「書かれた run」に子がいるかで決めていた。そのため範囲に依り、既定範囲と ship に共通の地平 run 15 本中 6 本で値が違った（405795846 は既定範囲だけ listed になった。レビュー W4）。今は 15 本とも一致する。
- 規則（`ledger.ts isAutoAccepted`）: 内側の |路面 − 目標線| の p95 ≤ 帯 1.5 m、内側の中央値 ≤ `GROUND_INNER_MEDIAN_M` 0.5 m、取付けの最大 ≤ `HEIGHT_STRUCTURES.ground.approachMaxM`。
- `approachMaxM` は 2.0 m のまま（R で決める）。ship/pruned の 232 本の取付けの最大は p50 1.50・p80 1.67・p90 2.05・p95 2.64・最大 6.20 m。2.0 m は 1.95〜2.10 m に固まった 9 本（2.0 m を少し超える 8 本）の中にあり、2.1 m にすると listed は 8 本減る。
- **listed: ship/pruned 28 本（目安 25 を超えた。規則は緩めず R へ）、既定範囲 1 本（24402609、取付け 4.17 m）**。内訳:

| 外れ方                          | 本数 | 例                                                                                     |
| ------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| 取付け: 坑口（トンネルの口）    | 15   | 165913328（6.20 m）・27155730（4.28 m）・586976823・24402609・1226415720（3.61 m）ほか |
| 取付け: ランプの地表端          | 11   | 199311816（2.64 m）・227383685・250490203、2.02〜2.07 m が 6 本                        |
| 取付け: open な端どうしのランプ | 1    | 37793434（2.06 m）                                                                     |
| 内側の中央値 0.5 m 超           | 1    | 680568024（−0.64、地表端）                                                             |

- `ground.openEnds` に `overApproach`（取付けの上限を超える端）と `byCause` を足した。ship/pruned は 16 本で、すべて「子が高架へ登る」。ship/all は 13 本で、これもすべて登る。既定範囲は 0。帯 1.5 m を超える端は 118 → 88。

## 4.4 R3: 交差の窓にかかる盛土

- `structuresByHeight`: 窓の最低点が 1.7 m の桁で離隔を満たす交差（`clearsOnThinGirder`）は、窓を高架に固定する（`forceViaduct`）。盛土・掘割は窓の端から始める。
- その後でならしと宙の盛土の規則を掛け直す（`afterSpanning`、レビュー W2）。窓と高架に挟まれた smoothM 未満の盛土の切れ端と、地表に届かない（最低 3 m 以上で地表の端に接しない）切れ端を高架にする。例: 32404414:71 の 9.48 m・地表から 6.13〜6.46 m の切れ端。
- **blocked の行き先（ship/pruned、地平 run を除く。レビュー W5）**:
  - 基準で tags より増えた「盛土・掘割の下」「解いた床版が越えない」の 27 組は、25 組が交差になった。残る 2 組（404300205 × 145236549、44822420 × 169228348）は「地表端から越えられない」で blocked のまま。
  - 再レビューの 4 件と ship の +7 件は、すべて交差になった。
  - 別に 4 組が「地表端から越えられない」で新しく blocked になった（34284114・34284117 × 27997218、397724497 × 148420105、44421527 × 1009196149）。
  - 基準からある 184293856 × 174022681（150 m、地表端から越えられない）も残る。
  - 高架タグの run の blocked の合計は 321 → 285（tags は 153）。
  - 窓を高架にした交差（`structures.rules.spanned`）: ship/pruned 34・ship/all 39・既定範囲 34。
- PR 3 の 5:
  - 45248411 × 1386535811 は R3 で直った。
  - 46876436 × 878626252 は、初版では N1 の退行で blocked だった（端の seam が 6.64 → 5.01 m に下がった）。C1 の後は 7.24 m で blocked でない。
  - 46876436 × 777680434 は基準から blocked で、height + compile の届きの判定による（tags では specialGrade > lowerSpeed で越えていた）。

## 4.5 R4・R5

- R4: 地表 + 3 m 以上の盛土の塊を盛土のまま残すのは、地表端・坑口・地平 run への seam に接するものだけにした（`StretchContext.groundEnds`。数は `structures.rules.unanchored`: ship/pruned 6・ship/all 5・既定範囲 5）。24336502:0 は、盛土 5.2〜6.4 m（分合流の端）から高架に変わった。24402125:0 と 45068172 は前後とも高架（45068172 は 2 チャンクで :3 は無い）。
- R5: same の区間でも、相手との |Δz| が `MERGE_GIVEN_UP_DZ_M` を超える測点は same として扱わない（`sameKept`）。該当した組の測点は ship/pruned 4,284・ship/all 4,596・既定範囲 3,810。
- T13 は R4 を縛る（レビュー W3）: 盛土のチャンクの塊で、最低が 3 m 以上で、地表に接する端（run の要約の端の種類から、`violations.ts groundEndsOf`）に接しないものを違反にする。データテストも同じ `groundEndsOf` を渡す（再レビュー W9）。

## 4.6 薄い桁・T4・T13

- R6 (c): `thinGirder` は、窓にかかるチャンク全部で薄くする（`isWindowOver`）。
- R6 (d): `checkClearanceWindows`。窓の内を 1 m ごとに、その s のチャンクの桁で見る。窓の中の盛土・掘割は違反にする（窓の中は全部高架。レビュー W6）。チャンクに `crossWindows` を書くのは高さで決める生成だけ（省略できる項目で、XW_VERSION 6 のまま）。ship/pruned・ship/all・既定範囲とも 0。
- R6 (a): T13 は `heightStretches` を呼ばない。窓の許しは一律 ±40 m ではなく、チャンクの `crossWindows` から取る（W6）。same の区間では、タイルから相手の |Δz| を読めないので、掘割も許す（R5）。
- R6 (e): 交差の窓のテストで、cross と blocked を別々に数える。
- 単体テスト:
  - heightStretches の `groundEnds`、`sameKept`、`afterSpanning`、`clearsOnThinGirder`、`isWindowOver`。
  - T13 の宙の盛土、T4 の窓の中の盛土、`checkSeamHeading` の違反側、`trackingOf` の kind、`groundFitOf`。
  - `isAutoAccepted` の ground-stretch・ground-crossing、structureCases の ground-crossing。
- **未着手**: `thresholdStations`・`withStations`・`chunkRun`・`groundKnots` の単体（export されていない）、窓が広がって解ける合成網、R3 の合成網（解の deck が地表に寄るため、窓の中の盛土の形を作れなかった。単体の形で確かめた）。

## 4.7 台帳・データテスト・小さい点

- 類型 `ground-crossing`（ship/pruned: 規則 83・new 21）。診断の文面は `allowlist.ts atGradeCrossingDetail`・`parseAtGradeCrossing` の 1 か所にまとめた（レビュー W8）。`crossingsBlockedMiddle` の説明も直した。
- expresswayCases.ts: 地平 run にも thin-girder を数える（高架のチャンクを持つ地平 run が 2 本ある。Why を訂正した）。
- tests/expresswayData.test.ts:
  - `height-structures` のときだけ効く 5 件（T13、`below`、盛土・掘割の橋脚と cross、blocked と窓の T4、地平の本線の端）。
  - 既存の検査を violationsOf に揃えた（W7）:
    - T3: 高さで決める生成ではランプの床（`reportedRampFloors`）と seam の向きで見る。
    - T12: 坑口の地表から下り、地平 run の掘割は T13 に任せる。
    - P9 の高架の portals: 盛土・掘割からのものを許す。
    - blocked: 盛土・掘割の下は高さを問わない。診断の s は整数なので ±1 m で照らす。
  - `XW_DATA_DIR=.cache/expressway-area/p7j-pruned-ledger` で残る失敗は 6 件。台帳が ship の未判断の case を持たないことによる 3 件、meta の features、それと基準（p7a-base-pruned）でも落ちる 2 件。後者は 24402611 の 700〜1800 m の橋脚が 9 本で、薄い桁の 867〜1099 m に 1050 の橋脚が無い（PR 1 から）。もう 1 件は 1068219936@177.33 の decks の取りこぼし。どちらも 7c で見る。
- `offGround` の型を m に。JSDoc の位置（setupGround・structuresByHeight）、ledger の注釈の順、格子の重複（`gridStations`）、heightStretches の 2 回呼びを直した。

## A/B（基準 → 7a）

| 項目                                      | ship/pruned                                   | ship/all                                      | 既定範囲                              |
| ----------------------------------------- | --------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| 閉鎖 本線/ランプ                          | 0/6 → 0/6                                     | 1/6 → 1/6（28127324、前から）                 | 0/0 → 0/0                             |
| violations / 未収束 / dangling / 本線の穴 | 0 のまま                                      | 0 のまま                                      | 0 のまま                              |
| 未許可の重なり                            | 229 → 230                                     | 239 → 232                                     | **4 → 7**                             |
| ground.inner 0.3 / 0.75 m 超（41 本）     | → 5 / 0                                       | → 5 / 0                                       | → 0 / 0（4 本）                       |
| 地平の反転・σ                             | 0.188・0.157 → 0.626・0.230                   | 同じ                                          | 0.307・0.230 → 0.307・0.312           |
| 地平の短波長の相関                        | 0.530 → 0.748                                 | 0.530 → 0.748                                 | 0.502 → 0.729                         |
| 高架の強制なしの反転                      | 0.4817 → 0.4766                               | 0.4739 → 0.4687                               | 0.452 → 0.452                         |
| offGround p95・最大・3 m 超の run         | 1.86・7.78・24 → 1.62・7.39・31               | 1.72・7.78・26 → 1.56・7.39・30               | 1.50・3.07・1 → 1.48・2.68・0         |
| openEnds 帯超え・最大                     | 118・3.62 → 88・3.62                          | 124・5.11 → 90・3.22                          | 5・1.77 → 5・1.74                     |
| ground-stretch listed                     | → 28                                          | —                                             | → 1                                   |
| 高さ由来の blocked（tags より）           | 27 → 2                                        | —                                             | —                                     |
| T4（窓の新しい見方）                      | 0                                             | 0                                             | 0                                     |
| チャンク                                  | 3,259 → 3,270                                 | —                                             | —                                     |
| thin-girder                               | 183 → 191                                     | 186 → 193                                     | 10 → 10                               |
| 盛土 区間・km / 掘割 区間・km             | 549・49.8 / 193・32.6 → 551・44.7 / 198・36.8 | 550・49.7 / 194・32.5 → 553・44.5 / 200・36.8 | 33・4.2 / 11・3.3 → 38・3.3 / 16・4.2 |
| gzip 合計・最大                           | 1,259,880・60,993 → 1,270,530・61,249         | 1,334,466・61,001 → 1,345,493・61,250         | 124,453・29,234 → 126,354・29,494     |

- offGround の 3 m 超の run が増えた（24 → 31）。路面が DEM の凸凹（擁壁・盛土の段）を追わなくなった分で、k に依らない（k = 1 でも 31）。
- 既定範囲の新しい未許可 3 組は、どれも地平 run 24402609（坑口から上がる 113 m、取付けの最大 4.17 m）に絡む。値と原因は上の「C2」節。
- 解く段の時間は、8 本を並べて計ったので比べられない（ship/pruned 242 → 284 s）。
- T8: 採ったフラグで、既定範囲と ship/pruned の共通チャンク 358 は `signs` を除いて全部一致した。

### 既定範囲の未許可の組（7a の後）

| 組                         | 類型          | 測点 | \|Δz\|       | 中心線の間隔 | 外す組 |
| -------------------------- | ------------- | ---- | ------------ | ------------ | ------ |
| 24402125 × 45068170        | parallel-ramp | 20   | 0.16〜6.19 m | 0.9 m        | はい   |
| 24402611 × 45068169        | other         | 2    | 0.06 m       | 7.8 m        | はい   |
| 45068169 × 45068170        | other         | 4    | 0.06〜0.22 m | 7.6 m        | いいえ |
| 45068169 × 45068172        | parallel-ramp | 15   | 2.27〜6.05 m | 1.3 m        | はい   |
| 24039751 × 24402609（新）  | other         | 12   | 0.07〜0.13 m | 8.3〜9.2 m   | いいえ |
| 24039751 × 24402611（新）  | other         | 2    | 0.07 m       | —            | —      |
| 24402609 × 895902565（新） | other         | 2    | 0.07 m       | —            | —      |

## 不変（既定のフラグ、最終のツリーで作り直して確認）

- ship/pruned: `diff -rq .cache/expressway-area/s6a-main-pruned .cache/expressway-area/p7i-tags-pruned` が空。
- 既定範囲: `public/data/expressway` との違いは ledger.json の有無だけ。
- 台帳: public を写して流した ledger.json が `cmp` で一致。

## 7c の前提: トンネルの口の取付け（W10、S7 へ回す）

- 坑口の端の高さは DEM（トンネルの上の地表）に固定されていて、地平 run の目標線と 3〜10 m 離れることがある。直すと T5（地表端は DEM に合う）と P9 の坑口の規則に触れるので、7a では触らず **S7 で直す**（コーディネータの判断、案 (i)）。
- 7c で受ける条件: 見送ったトンネルの口の取付けは、台帳で「見送ったトンネルの口、S7 で直す」として受け、視点で見た目を確かめる。対象は ship/pruned の ground-stretch の坑口の 15 本（24402609 の取付け 4.17 m、165913328 の 6.20 m、27155730 の 4.28 m など）。
- C2 の後に残る坑口の割れ: 24039751 × 24402609 の路面の差は、同一面の区間の中で坑口側 1.69 m、24039751 の終端で 2.54 m。同一面の地平 run の組で路面の |Δz| が 1 m を超えるのは 3 組で、最大 2.26 m（165913328 × 165913330、どちらも坑口）。

## 7c に入る前に登録する 3 つ（3 回目のレビュー）

1. 視点表に既知の項目として「汐留の坑口側の割れ（24039751 × 24402609）」を入れ、1 周目から wontfix にする。理由: 見送ったトンネルの口、S7 で直す。
2. 台帳で 24402609 の ground-stretch（取付け 4.17 m）を理由つきで受ける。理由は同じ。
3. 未許可の 3 組（24039751 × 24402609、24039751 × 24402611、24402609 × 895902565、|Δz| 0.07〜0.13 m）を上限 0.14 m で受ける。理由: 実行時に 1 枚で描かれる範囲で、45068169 × 45068170 と同じ型。

R に回すもの: W11（同一面の集まり全体の目標線）、W12（相手の地表が入る収める範囲、W10 と一緒に S7 で見る）、ground-stretch の listed 28（approachMaxM 2.0 m の決め方）。

## 7c（有効化）の視点に足すもの

- 1059139534 の s 500〜700 の山（既定範囲の地平の σ 0.312 の大半）。
- 24039751:0 の盛土（C2 の後は 0〜106 m の 1 本。地表から −1.7〜2.5 m）。
- 深さ 0 付近の掘割の区分（掘割 32.6 → 36.8 km、ship/pruned）。
- 高架のチャンクを持つ地平 run 2 本。
- 1226415720 の坑口手前（取付け 3.61 m）。
- 24402609 の周りの新しい未許可 3 組。
- 見送ったトンネルの口（上の節）。

## 前回から残したもの

- 0.3 の「seam の向こうへの沈み込みを数える」スコアカードの項目と、名前の整理（定数・`isClassified`）は今回も入れていない。R で扱う。

# P2.7-6 PR 5: 継ぎ目の段（実行時、2026-11-12）

S6「網をつなぐ」の PR 5。既定データの seam_step open 4 件（24402125:0・45019020:40・:41・4848889:0、どれも一体化を手放した点の先の継ぎ目）の原因を数値で特定してから直した。データ・コンパイラ・台帳の規則は変えていない（実行時の expresswayMerge.ts・expresswayDeck.ts だけ）。[^p276-5]

## 原因（4 件、手放しの点から先のリングごとに追った値）

調べ方: 台帳と同じ探り方（scripts/expresswaySeams.ts の世界・レイ・`pairPoints`）で 0.25 m ごとに、本線の縁の内 2 mm・外 2 mm の面、子の床版のリングごとの `sides`（reach・継ぎ目の高さ・`seamWeight`・壁高欄）、リングでの「床版の |Δz|」と「データの |Δz|」（両方の Hermite）を出した（.cache/p5/trace.mts、ローカル）。

| 事例                                               | 段の出方（前）                                                                                           | 原因                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 45019020:40（s 4083.4〜4083.9、45554540 への合流） | データの \|Δz\| が 5 cm 以内になる s 4082.95 から先、継ぎ目が本線の面より 0.7〜4.4 mm 上（4084.16 まで） | (1) 継ぎ目は壁高欄の端（s 4080.38、w = 0）で区間の途中から始まり、区間の両端（4077.68 は継ぎ目なし、4084.34 は w = 1）がどちらも「面に一致」なので、w が 1 に届く所にリングを置く二分法が走らなかった。(2) w を床版の弦の高さ（子のリングの中心・本線のリングの折れ線）で測っていた。4084.34 で床版の \|Δz\| 17.8 mm に対しデータは 12.5 mm（本線の弦が 5.3 mm 下） |
| 45019020:41（s 4110.7）                            | 3 mm                                                                                                     | (2)。床版の w = 1 のリングが s 4111.23（床版 \|Δz\| 50 mm、データ 45.9 mm）で、データの w = 1（s 4110.7）より 0.5 m 先。その間は w 0.75 → 1 の直線                                                                                                                                                                                                                  |
| 4848889:0（s 156.1、4848762 から台場出口）         | 2.8 mm                                                                                                   | (2) の逆向き。床版の w が 1 を外れるリングが s 155.65（床版 \|Δz\| 50 mm、子の弦が約 5 mm 上）で、データ（s 156.3）より 0.65 m 手前から滑り始めた                                                                                                                                                                                                                   |
| 24402125:0（s 82.6、汐留出口）                     | 段 0、内側の面 15.8 cm                                                                                   | (2)。床版の \|Δz\| が s 82.35 で 0.15 m を超えて手放したが、データの \|Δz\| は s 82.63 で 148.9 mm（まだ一体）。手放した先は子の床版が全幅に戻り（壁高欄は自分の位置、本線の壁は `letGo` で外れたまま）、本線の縁の上に 15.8 cm 上の子の面が出る                                                                                                                    |

共通の原因は「継ぎ目の重み w と手放しを、データの面ではなく床版の弦で測っていた」こと（弦は Hermite から最大 1 cm、2 枚で 1〜16 mm 違う）。45019020:40 だけは、区間の途中で始まる継ぎ目の w = 1 の点を探していなかったことが重なる。

## 直し方

| 項目                         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| \|Δz\| をデータから          | `expresswayMerge.ts partnerAt`: 自分の中心の高さと相手の足の高さを、それぞれのチャンクの Hermite（`surfaceAt`、足の s は相手のリングの s の補間、チャンクの継ぎ目では s を含む方）で取る。片勾配の分は従来どおり                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| w = 1 の点を区間の中でも探す | `expresswayDeck.ts refineRings`: 壁高欄の端・相手の縁の頂点・閉じる点のリングを足した後、隣り合う 2 つのどの間でも「面に一致」が変わる所を二分法で探す。継ぎ目が滑っている区間は `SLIDE_PROBE_M` 1 m ごとにも調べる（子が本線の高さを横切ると、両端が滑っていて中だけ一致する。ship の 205725085:0 s 87.6〜90.1 で 21 mm）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 細い路面の上り               | `deckCorners`: 見える路面が `MERGE_RAMP` 1 m より狭い所（子が本線の下へ入る・閉じる所の、壁高欄ぎわの帯）では、その先に壁高欄が立つ側だけ、継ぎ目から自分の面への上りを 1 m の傾きのまま途中で止め、路面の端を壁高欄のスカートの下に入れる。前は数 cm で自分の面まで上り、継ぎ目の外 2 mm に最大 50 mm の段（ship の 4854234:29、438474207:0 で 2 mm）。**訂正（Fable レビュー C1）**: 初版は「細い」を上りの割合 `share < 1` で決め、`share` が丸めで 0.9999… になる幅 1 m 以上のリング（片側だけ継ぎ目のあるリングの約 5.6 %）でも路面の端を上りの終点へ移したため、残りの車道が面 2/14（コンクリート色、コライダー無し）になった（車道の当たらない点が既定 0 → 145、ship 606 → 2,686、撮影でコンクリートの三角形 5 視点）。幅 `hi − lo < MERGE_RAMP − 1e-9` で決め、`share` を 1 で頭打ちにした（既定 0、ship 566。ship の 566 は main の 606 にもある 3 枚の重なりの穴） |
| 手放しの点の滑らかさ         | `seamWeight` を線形から smoothstep に（両端で傾き 0）。手放しの点の滑る側（継ぎ目の側ごと）に 0.02・0.05・0.1・0.2・0.3・0.5 m のリング（`LET_GO_RINGS_M`、区間の端で止まる）。線形のままでは、データの手放しに合わせた所で ship の let_go 6 か所が進行方向 4 cm に 1.1〜2.8 mm 上った（規則 1 mm）。0.1 m のリングを滑る所すべてに置くと既定データの一体化つきの組み立てが 208 → 604 ms（Node）になったので手放しの点の脇だけにした（233 ms、生成器の 1 ステップの最大 0.75 → 0.65 ms。1 m ごとの調べの後に 1 回譲る）                                                                                                                                                                                                                                                                                                                                                      |
| 本線のチャンクの選び方       | **Fable レビュー W1**: `isMasterClosed`・`masterShortfall` は相手のチャンクを足の τ（< 0.5）で選んでいたので、チャンクの継ぎ目でその s を持たないチャンクを引き、データの高さ（`compiledZ` は s をチャンクの端に丸める）が最大 0.29 m（ship 0.48 m）誤った。足の s を測点に持つ方（`ownerHolding`、`chunkHolding` と同じ規則）にした                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 2 → 4 車線の継ぎ目と汐留入口の merge-wedge（別の原因、記録）

- **2 → 4 車線（45554540:30 → :31、s 7510.91）**: 45019020:41（2 車線）が 45554540 に合流し、45554540 のチャンクが :31 で 2 車線から 4 車線に一段で変わる（データの lanes が測点で切り替わる。テーパーが無い）。台帳の探りではこの継ぎ目に seam_step・seam_hole が無く（既定・ship とも前後で 0 件）、手放しの点の先の継ぎ目とは別。断面の変わり方はコンパイラ（データ）の側で、PR 5 の範囲（データを変えない）の外。
- **汐留入口の merge-wedge（45068172:1 × 45021976、s 267〜296）**: 台帳では `merge_skipped:45068172:1|45021976`（\|Δz\| 最大 2.97 m）で、平面で重なったまま高さが 3 m 離れている区間（手放しの点 s 296.2 より手前、一体化していない所）の壁高欄の形。継ぎ目の重みや手放しの位置の問題ではなく、平面の分離（PR 4）の側と見ている（未検証。撮った視点 shiodome-merge-driver で形が前と同じかはレビューで見る）。

## 台帳の前後

|                                                                                                  | 前                               | 後                                                                                  |
| ------------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------- |
| 既定データの seam_step                                                                           | open 4                           | accepted 1（24402125:0、Fable の判断）、open 0                                      |
| 既定の seam_hole / seamProbes / let_go                                                           | 0 / 3,641 / 10（すべて規則の内） | 0 / 3,641 / 10（すべて規則の内）                                                    |
| ship（`--out` の計測フォルダ p5-ship、同じデータに前後のコードで台帳を一から数えた）の seam_step | 203                              | 44（レビュー対応の後に数え直し）                                                    |
| ship の let_go の規則外（`new`）                                                                 | 17                               | 17（205725085:0 が 0.1 → 1.2 mm で規則外に、37793432:0 が 1.7 → 0.6 mm で規則内に） |
| ship の seam_hole / merge_skipped / seamProbes                                                   | 15 / 528 / 64,635                | 15 / 528 / 64,635                                                                   |
| ship の全件                                                                                      | 1,234                            | 1,075                                                                               |

**残った既定の 1 件（24402125:0、段 160.4 mm・内側 3.3 mm、accepted by review）**: 手放しの点の 3 cm 手前の 1 測点で、データの \|Δz\| 148.9 mm（`MERGE_MAX_DZ` 0.15 m の 1.1 mm 内）。継ぎ目は自分の面にあり（w ≈ 0）、床版は弦の上にある（汐留出口はデータの面の 8.1 mm 上、内回りは 3.3 mm 下）ので、面どうしの差 160.4 mm がそのまま段になり、規則の 151 mm を 9.4 mm 超える。手放しの点で継ぎ目が自分の面に戻ること（let_go の 1 mm）と、この帯で段を 151 mm 以下にすることは、床版がデータの面から最大 1 cm 離れる限り両立しない。Fable の判断で accepted（cap = 実測値）。**案（PR 5 の範囲外、R1〜R3 か後続へ）**: 規則の側で、滑る帯（`MERGE_FULL_DZ` < \|Δz\| ≤ `MERGE_MAX_DZ`）の段の上限を `MERGE_MAX_DZ` + 1 mm から `MERGE_MAX_DZ` + 弦の許容 × 2（profile.ts の 1 cm × 2）にする。ship の同類 13 件（下の A）はこれで規則の内になる。

**ship に残った 44 件の内訳**（レビュー対応の後）:

- (A) 手放しの点の帯の 1 測点で段 151.3〜160.4 mm・内側 0.2〜7 mm: 13 件（24402125:0 と同じ理由。387256795:0 は「短い上りは壁高欄が立つ側だけ」の直しで、本線 316240492 の壁高欄の無い側の縁で子の路面の端が自分の面へ戻って出た。同じ測点 s 32.13 で、round-01 では段 150.7 mm で規則の 0.3 mm 内に隠れていた。データの |Δz| 146.6 mm・w 0.003 で、24402125:0 と同じ類。Fable の再レビューの訂正）。上の規則の案で消える。
- (A2) 段 0・内側の面 149〜158 mm の 1〜2 測点: 4 件（1051967540:0、22694126:0、26957083:0、44804206:2）。24402125:0 とは**別の原因**（Fable のレビューの見立て、実装側では未計測）: 手放しの切り口（壁高欄の端の 2 リング）が子の進行方向に直角で、本線の縁に沿っていないため、切り口の斜めの分だけ子の全幅の床版が本線の縁の内側に入る。手放しの切り口を本線の縁に沿わせるのは S6 の後続（PR 7 の前に実行時で、または R の地区で判断）。
- (B) 3 枚以上の床版が重なる所の面のずれ: 21 件（1483413151・1483413152、813455521、906610080、4857053、62004313:3|0、44804208、4847519|4848762 など。本線自身が別の床版に切られている `masterShortfall` の所を含む。内側 12〜488 mm）。初版の (B) にあった 62004313:3|44179919|1（段 349.6 mm）は C1 の不具合で出たもので、直して消えた。157249374:1|1051967540|0 は段 0.2 → 167.8 mm になったが、継ぎ目の位置が 1 測点ずれただけで内側の面 178.5 mm は前と同じ。3 枚の重なりは平面の分離（PR 4）と同一面の組（PR 3）で発生源が減るかを PR 7 の再 QA で測り、残りは R1〜R3 の地区の判断へ。
- (C) 5 cm 以内の段: 6 件（1023900994:0 52 mm・29 測点は本線が別の床版に切られて路面が縁の 4 m 手前で止まる所、4847519:0|45021972 11 mm は 2 枚の本線に挟まれた子、他は 1〜2 測点 1.2〜28 mm）。(B) と同じく 3 枚の組み合わせで、扱いも (B) と同じ。

## テスト

- `tests/expresswayDrive.test.ts`「a seam sliding off the master's face inside one ring interval」: 合成の分流で C が s 30 から 1.8 cm/m で M の高さを離れ（s 35 で M の高さを横切り、s 43.3 で手放す。C の測点は 10 m おきで、面に一致する区間・両側の滑り・手放しの点が測点の間に入る）、台帳と同じ探り方で seam_step・seam_hole が 0、手放しの点が 1 つで進行方向の段が `LET_GO_MAX_STEP_M` 以内。修正前のコードでは 1 つ目が `seam_step:C:0|M|0`（段 23.9 mm、10 測点）で落ちることを確かめた。
- 同じファイル「the visible road of a merged deck has a collider face everywhere」（Fable レビュー W2）: (1) 合成の分流 2 つ（3 cm と上の高さを離れる C）で、隣り合うリングの間の見える路面（−right.reach〜left.reach、τ ¼ ½ ¾、0.25 m ごと）のどの点もその床版のコライダーの三角形に当たる、(2) 既定データの一体化するチャンクすべてで同じ、(3) 4.5 cm 上の C が本線の縁から出てくる所の 1 m より細い帯で、路面の端（端から 1 cm）が自分の面より「1 m の上りの残りの半分」以上低く、壁高欄のスカート（`MERGE_SKIRT`）より上。(1)(2) はレビュー前のコード（C1 の不具合）で落ち（合成の分流 1 点、既定データ 8 チャンク）、(3) は main のコードで落ちる（s 24.32、幅 0.544 m で端が自分の面にある）ことを確かめた。
- 生成済みデータの継ぎ目の検査（検査点 3,641・手放しの点 10 件と、台帳との一致）はそのまま通る。`budget` は seam_step 4 → 1・open 4 → 0 に書き換えた。台帳の道具を 2 回掛けてバイト一致。

## 走行と撮影

- `just check-deck-drive p5-seams all`（2026-11-12 04:42 UTC に終了）: 9 経路とも合格・invalid なし・1 回目で通過。max |dy| は shibakoen-shiodome 0.089 m、auto-shibakoen-shiodome 0.097 m（到着・違反 0）、auto-shiodome-shibakoen 0.110 m（45068172:1、到着・違反 0）、rainbow 4 経路 0.072〜0.078 m、daiba-exit 0.115 m（4848889:3）、azabudai-tunnel 0.085 m。落下・停止・交差・速度の落ち込み 0。
- 視点は expressway 表の継ぎ目の俯瞰（seam-*、merge/diverge の overhead、shiodome の overhead、changeover-1-4848762）と分合流の運転席（merge-driver・diverge-outer・shiodome-merge-driver・shiodome-diverge-driver）だけを `--only --out .qa/views/p5-seams` で 1 周（34 コマ、失敗 0、04:48 UTC）。round-01 の Fable のレビューは Changes Requested（C1 のコンクリート色の三角形 5 視点、seam-24402125-0 の対象が画面外）。直した後、seam-24402125-0 を高さ 25 m・65° の俯瞰に作り直し、同じ 34 コマを撮り直した（下）。

- レビュー対応の後: `just check-deck-drive p5-seams-r2 all`（2026-11-12T05:52:43Z に終了）9 経路とも合格・invalid なし・1 回目で通過（max |dy| 0.073〜0.116 m、最大は daiba-exit の 4848889:3、自動運転 2 経路は到着・違反 0）。同じ 34 コマを `--out .qa/views/p5-seams-r2` で撮り直した（失敗 0、seam-24402125-0 は 4 つの look とも対象が画面内）。Fable の再レビューは Approve（round-01 の Critical 5 件は画素一致で fixed、seam-24402125-0 も fixed）。
- #72（PR 1）を取り込んだ後: 台帳の道具を 2 回でバイト一致（取り込み前と同じ台帳、06:08 UTC）、全テスト 161 files / 2,124 passed、`just check-deck-drive p5-seams-merge all`（06:41 UTC に終了）9 経路とも合格・1 回目で通過（max |dy| 0.073〜0.115 m、自動運転 2 経路は到着・違反 0）。
- **記録だけ（原因未確認）**: 再レビューの Info `geometry.day--diverge-outer-overhead` で、地上の案内標識の板が消えて写った。この PR は標識を触っていない。

[^p276-5]: 指示は scratchpad の p27/s6-network.md の 8 節（設計 Fable）。追跡のスクリプトは .cache/p5/trace.mts・perf.mts、ship の台帳は .cache/expressway-area/p5-ship-before・p5-ship の ledger.json（ローカル、git 管理外）。

# A0: 親の幅の段で、子が段の場所にリングを 2 本置く（実行時、既定データ不変、2026-11-15）

A1 の ship の計測で見つかった main の作り（seam_hole 157249373:0|44804029、s 212.55 の 1 測点）。データ・コンパイラ・台帳の規則は変えていない（実行時の expresswayMerge.ts・expresswayDeck.ts だけ）。[^a0]

## 仕組み（追跡の値）

- 親の断面がチャンクの継ぎ目で変わる所（44804029:4 → :5、s 618.41 で床版の縁 4.5 → 4.75 m）では、`linesNear` がそのリングを 2 回残し、縁の折れ線は同じ場所に頂点を 2 つ持つ（前の縁の頂点と後の縁の頂点、PR 5 より前からの作り）。
- 子 157249373:0 は `refineRings` で親の縁の頂点ごとにリングを置く。段の 2 頂点は子に沿ってほぼ同じ位置にあり（後の頂点が 2.5 mm 手前、s 212.7305 と 212.7330）、どちらのリングの断面の線も「前の縁・段の辺・後の縁」のうち 2 本以上に当たる。`crossEdge` は子の中心に近い交点（ここでは外側の後の縁）を取るので、**2 本とも 4.75 m の縁に seam を置いた**。seam は手前のリング（s 212.05、4.5 m の縁の上）から段のリングへ斜めに引かれ、その間に最大 0.25 m の面の無い帯が残った。
- **訂正（A1 の担当の読み）**: 「重複を除く所で 1 本落ちる」ではなかった。2 本ともリングは残っていて、どちらも同じ縁を読んでいた。直す場所（頂点のリングを足す所）は同じ。
- 一般に、後の頂点が子に沿って前の頂点より手前に来る（段の辺が子の向きに対して後ろへ傾く）と、外側の縁への切り替えがリングの間の斜めの seam になる。前の頂点が手前なら、段の辺そのものが seam になって穴は出ない（合成の網で C を +0.1 傾けたテストで、レイの外れ 0 を確かめた。PR #90 のレビュー）。

## 直し方

| 項目             | 内容                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 段を返す         | `DeckMerge.edgeSteps(run, own)`: 相手の線で、別のチャンクのリングが同じ場所に並ぶ所（`EdgeStep`、リング k と k + 1）を返す                                                                                                                                                                                          |
| 段の片側だけ読む | `sides(own, ring, depth, at)` の `at`（`StepSide`）: その相手の縁を、段の前（リング k まで）か後（k + 1 から）の線分だけで交わらせる（`crossEdge`）。段に接する線分は段の先へ延ばして交わらせる（線がわずかに外れても相手を失わない）                                                                               |
| 段の場所に 2 本  | `refineRings`: 段の 2 頂点がどちらも区間の内にあれば、子に沿って先に来る方の頂点を通るリングを 1 本置き、同じリングに sides を 2 つ（前の縁で読む・後の縁で読む）並べる。前の頂点が先なら、後の sides は後の頂点を通るリングで読む（どちらの seam も頂点の上）。分離壁の始まり・終わりの「同じ場所に 2 本」と同じ形 |

- **Why not 前の頂点に常に置く**（初版）: ship の 32898373:0（44351599 のノーズ、後の頂点が 0.15 m 手前）で seam が後の縁から前の頂点へ戻って折り返し、seam_hole 1 点が seam_step（段 2.6 mm・内側 0.17 m）に変わった。止める条件（ship の seam_step が増える）に当たったので、先に来る方へ置くように直した。
- 残る形（直していない、設計に回す材料）: 後の頂点が子に沿って先に来る段では、2 頂点の間（子に沿った距離 d）で seam が 1 本の縁にしか乗れず、段の幅 × d の三角の穴が残る。157249373:0 では 0.25 m × 2.5 mm（探りには当たらない）。合成の網（C を −0.1 傾け、d 約 2.5 cm）では、Fable のレビューの細かい格子（0.005 m × 0.01 m）で A0 の外れが 60 本（x 99.977〜99.997）、main は 11,746 本。**ship の seam_hole 32898373:0\|44351599（s 0.13、44351599 のノーズ、d 0.15 m）はこの形で、A0 でも main と同じに残っている**。
  - 選べる形は 2 つ: (a) 今の形（三角の穴が残る。段の幅 × d）、(b) 初版の形（リングを前の頂点に置き、seam を前の頂点から後の頂点へ折り返して重ねる。32898373:0 では穴が消える代わりに seam_step 段 2.6 mm・内側 0.17 m が出た）。どちらを採るか、d が大きい段（ノーズ）を別に扱うかは設計の判断に回す。
  - 子の測点・面の標本点が段から 1 cm 以内にある所（`refineRings` の頂点の対象外）は、前のとおり 1 本のリングで外側の縁を読む。

## 計測（trust signal、2026-11-15、M2 Max）

台帳の道具と同じ探り（`probeGenerated`・`seamCases`、.qa/a0/seams.mts）を main（4b89b9a）と A0 のコードで同じフォルダに掛けた。

|                                                                                             | main                              | A0                                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| 既定: seamProbes / seam_hole / seam_step / let_go / merge_skipped                           | 3,683 / 0 / 2 / 9 / 46            | 3,683 / 0 / 2 / 9 / 46（measured が 1 mm を超えて動いた事例 0） |
| ship（p7c9-pruned）: seamProbes / 穴の測点 / seam_hole / seam_step / let_go / merge_skipped | 70,602 / 78 / 24 / 67 / 235 / 613 | 70,602 / 77 / 23 / 65 / 235 / 613                               |

- ship で消えた穴: 157249373:0\|44804029 s 212.55（1 測点）。増えた穴: 0。
- ship で消えた seam_step: 41520088:0\|41009552（8 測点、段 1.0 mm、s 11.1〜14.6）、44804643:0\|41009552（29 測点、段 1.0 mm、s 78.1〜92.1）。増えた seam_step: 0。ほかの事例の measured は 1 mm を超えて動いていない。
- 既定範囲で段の上を子の seam が通る所: リングが変わったチャンクは 2 つ（全リングの s・reach・seam を main と A0 で書き出して比べた）。813455519:0（s 0.5〜0.9、45554540 の 4 → 2 車線）と 45019020:41（s 4306.3〜4306.6、45554540 の幅の段）。どちらも子の路面が閉じている（親の下に入っている）区間。継ぎ目の測りは上の表のとおり動いていない。
- 絵（俯瞰 1 視点ずつ、高さ 35 m、同じ開発サーバーで main と A0 のコードを差し替えて撮った）: A0 を 2 回撮った差は fuzz 6 % で 0 画素。main との差は 45019020:41 で 288 画素、813455519:0 で 21 画素。45019020:41 では、main で 45554540 の幅の段の線に沿って路面を横切っていた明るい灰色のくさび（閉じた子の床版の縁が段の外側へ斜めに引かれて親の面の上に出ていた、と読んでいる。面ごとには確かめていない）が A0 で消えた。813455519:0 は壁高欄の端の脇の数画素の明暗。どちらも直しの向きの変化で、新しく出たものは無い（.qa/a0/crop-both.png・crop813-both.png）。
- 走行（汐留と浜崎橋を通る 4 経路、既定範囲の継ぎ目が動かないので 4 本）: shibakoen-shiodome（max \|dy\| 0.092 m）、auto-shiodome-shibakoen（0.108 m、到着・違反 0）、haneda-up-seam（0.074 m）は 1 回目で合格。auto-shibakoen-shiodome は 1 回目に汐留出口の連結路（35.66302, 139.76237、24402125）で 1 回停止して違反を記録し、撮り直しで合格（0.097 m、到着・違反 0）。A0 でリングが変わったチャンクはこの経路に無い。

## テスト

`tests/expresswayDrive.test.ts`「a cut deck at its master's width step」（合成の網 `alongside`: 東へ 2 チャンクの M、x = 100 から縁が 0.25 m 外へ、C は x = 100 で 5.5 m 北、傾き slope で 3 cm 上、段の近くで M の縁で切られる）:

1. 段の前後 10 m で、M の縁の内 0.075 m から外 0.3 m まで 0.05 m ごとに上から打ったレイが、どれも M の高さ ± 5 cm の面に当たる。
2. 段の場所に C のリングが 2 本（同じリング）並び、1 本目の seam が M の前の縁の頂点、2 本目が後の縁の頂点に 1 mm 以内で乗る。
3. slope +0.1（前の頂点が先）: レイの外れが 0、段のリング 2 本の seam が前後の頂点に 1 mm 以内。
4. slope −0.1（後の頂点が先、157249373:0 の向き）: 段のリングの線が後の頂点を通り、2 本目の seam は後の頂点に 1 mm 以内、1 本目の seam は前の縁の上で前の頂点の手前 d（± 2 mm）、段の近くの seam は M に沿って戻らない、レイの外れは x 100 − d 〜 100 の内だけ。
5. 幅の変わらない M（slope 0）では、C のリングは C の測点と M の縁の頂点ごとに 1 本ずつで、2 本並ぶ所が無い（main でも同じ並び）。

直す前のコード（main 4b89b9a）では 1 が 380 点（x 93.4〜100、M の縁の外 0.025 m）で、2 が「段の場所のリングが 1 本」で落ち、5 は通ることを確かめた。初版（リングを常に前の頂点に置く）のコードでは 4 が落ちる（段のリングの線が後の頂点から 24.8 mm 離れる）ことを確かめた。平行な 1・2・5 だけでは初版も通っていた（PR #90 のレビュー）。

[^a0]: 指示は scratchpad の p27/s7r/a1-answer4.md の 1 節（設計 Fable）。追跡は A1 の .qa/a1/trace-hole.mts を写した .qa/a0/trace-hole.mts、リングの書き出しは .qa/a0/rings.mts・dump-rings.mts、継ぎ目の探りは .qa/a0/seams.mts・diff.mts（ローカル、git 管理外）。

# P2.7-6 PR 7b: 地表近くの構造の実行時（盛土の地形・擁壁・コライダー、既定データ不変、2026-11-12）

指示は scratchpad の p27/s6-pr7.md の 5 節（設計 Fable）。データと形式は変えず、実行時の描き方だけを直した。いまの既定データに盛土は無いので、合成のチャンクのテストと、採ったフラグ（`--structures height --ground compile --touchdown all --companions on --companion-weight 1`）の計測フォルダへの探りで確かめた。探りの数は 7a（#78）の後のコンパイラ（main 22167c1 に rebase した版）で作り直した p7b-main-default（既定範囲）・p7b-main-pruned（ship/pruned）のもの（7a の前の p7b-default・p7b-pruned はチャンクが設計側の h-base-* と全部一致していた）。画面での確定は 7c。Fable レビュー（C1・W1〜W6）・再レビュー（W-A・W-B・S-1・S-2）・3 回目のレビュー（Approve、条件 W-C と S-a〜S-c）と 7b2（開いた側の判定を 2 つに分けた）の手直しを含む。[^p276-7b]

## 描き方の規則

| 項目                 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盛土の地形           | 盛土のチャンクも全測点で地形を切る（`expresswayBore.ts` の `cutsGround`・`boreHoles`、穴の半幅は床版の縁 = 車道の半幅 + 壁高欄の幅）。掘割の余裕 0.3 m を足さないのは、低い側の壁の足元の外に下の空洞が見えるため。`ExpresswayDecks.onBore` は盛土も知らせる（建物・街路灯・一般道と歩道の敷き直しが掘割と同じに扱う）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 盛土の側壁           | 左右それぞれ、床版の縁の外 0・0.5 m（`EMBANKMENT_SIDE_REACH`）の地形を、リングと、隣のリングまで 4 m（`EMBANKMENT_SAMPLE_M`）ごとに読み、最低と最高を取る（`embankmentBounds`、探りと共通）。下端は最低 − 0.3 m（`EMBANKMENT_FOOT_M`）、天端は `cutWallHeight`（掘割と同じ: 最高 + `CUT_WALL.above` 0.4 m と壁高欄 1.1 m の高い方）。地形が路面より低ければ壁高欄のまま、高ければ掘割と同じ高さの擁壁（R1・W4 の残り・W5）。擁壁に上げるか・地面の帯を敷くかは 2 つの判定（`otherDecksAt`、7b2）。擁壁: 壁が自分の床版の縁に立ち、縁の外 0・0.5 m の地形のどこかが描かれている（ほかの run が、その場所で地面を切る = 盛土・掘割・坑口のトンネル、で覆っていない）側。土被りのあるトンネルや高架の下は地形が描かれているので閉じない（3 回目のレビュー S-a。最初の「路面の差 3 m 未満の床版は脇に数える」は 4848757:0 s 38〜42 を土被りのあるトンネルの脇として閉じ、壁高欄 1.10 m に対し脇の地形 + 1.32〜1.34 m を残した）。帯: それに加えて縁の外 0・0.5・1.5 m のどれもほかの床版の穴の内でなく、ほかの床版の路面が描かれた地形 + 1 m（`APRON_ROAD_CLEAR_M`）より上にある所だけ（ship の 3 m の除外の漏れ 4 組・37 点: 1453508542:11 → 4847507:4 ほか）。run の端では相手の床版は四角く終わる（W-C: 1059139534:17 s 2304.1 で丸めた版は壁を 1.10 m に落とし、脇の地形 +3.60・+2.63 m）。相手の床版の上に立つ内側の壁は壁高欄のまま（S-1）。地形を読めないときは測点の地表を両側に使う（地下の盛土なら両側が擁壁）。断面の面の並び（一体化・区画線・コライダーの番号）は高架と同じ。 |
| 読む地形             | 盛土の壁は**描かれる地形**（15.5 m の格子の三角形、`terrainSurface.ts` の `meshOf` で DEM の標本から作る `terrainAt`）を読む。掘割（P9 の `sideGround`）は不変の対象なので今まで通り DEM（`groundAt`）。レビュー W3: DEM のままではメッシュが擁壁の天端を最大 1.56 m（既定範囲）・2.69 m（ship）越え、足元の下に 0.47 m・2.48 m 出ていた。リングだけで読むと ship で足元の上に最大 2.7 m の地形の凹みが残ったので、リングの間も読む。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 同一面の相手のある側 | 今の一体化の規則のまま壁を立てない。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 端面                 | 盛土のチャンクの両端は、床版の下面から壁の足元まで（断面の角 6〜11）だけを扇で閉じ、両面・**solid**（`embankmentCap`）。レビュー W1: 断面全体の扇は中心が擁壁の天端に引かれて車道の上に立った（p7b-default の端 90 のうち 42、24039751:0 s 118 で 0.40 m）。W2: 盛土 → 高架の継ぎ目で、高架の下を走る車が端面を抜けて盛土の中へ落ちた。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| コライダー           | 盛土は面 7・9（床版の下から足元までの壁）と端面が solid。擁壁と同じ条件の開いた側に、縁から 1.5 m（`EMBANKMENT_APRON_M`）まで描かない地面のコライダーの帯（`embankmentAprons`、高さはリングの間も 4 m ごとに描かれる地形を読む）。レビュー W4: 地形のコライダーは穴に触れる ~1 m の片ごと落ちるので（terrainCut.ts）、縁の外 0.25 m の 81.8 %・0.5 m の 48.0 % に地面のコライダーが無かった。再レビュー W-A: 最初の帯は隣の床版の車道の中にも出て（p7b-default 11 組・734 点、ship 144 組・8,062 点、最大で相手の路面 + 2.83 m）、リングの間の直線は描かれる地形から最大 3.37 m 離れていた。直した後、レビューの overroad の検証で 24039751:0 ↔ 24402609:0・45068169:0 ↔ 45068170:0 の当たりは main と同じ数になった。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 地形の穴の継ぎ目     | `GroundCuts.cutAt` は穴ごとの覆いを大きい方でなく足し合わせる（上限 255）。チャンクの境の測点で 2 つの穴が辺で接し、境の画素が半分ずつで地形が残っていた（直す前の既定範囲 293 点はすべてチャンクの端の輪）。チャンクの始まりの穴は、前のチャンクもその測点で地形を切るとき（自分の portal の `from`、無ければ自分の構造が掘割・盛土、またはトンネルで `isHoleAt`）だけ 1 m（`HOLE_SEAM_M`）さかのぼる（15° の曲がりのくさびが閉じる）。チャンクの終わりの穴は、路面が地表 + 1 m（`SEAM_AT_GROUND_M`）未満で、そこでトンネルの屋根が土に覆われていないときだけ 1 m 先へ延ばす（次のチャンクが狭いと、さかのぼりは自分の壁で止まり、広い方の端の角に地形が残った: 1059139534:15｜:16、0.92 m）。**レビュー C1**: 最初の版は同じ run の次があれば常に 1 m 延ばし、既定データの麻布台の掘割 737538573:0 の穴が坑門の裏の土被りのあるトンネルの上（幅 40 m の道、天端は地表の 0.73 m 下）を約 9.9 m² 切っていた。今は既定データの穴の多角形と z15 の覆いが main と一致する（テスト）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 一般道               | 盛土・掘割（`XwSite`）の中心線を横切る GSI の一般道は、`siteCrossings` が分けて、`cut` だけを床版の縁 + 1 m の外まで取り除く（路面もグラフも、`street_cut_at_expressway` を warn）。残すのは: run の地表端・坑口・open な端から 15 m の内（`end`、ランプがつながる道）と 30° 未満（`along`、中央分離帯のランプに沿う道）。`under`（路面 − 地表が建築限界 4.5 m + 標準の桁を、7a の R3 と同じ `clearsOnThinGirder`（桁を `GIRDER_MIN` 1.7 m まで薄くして）で満たす = コンパイラが高架にすべきだった交差、3 回目のレビュー S-b）も実行時は取り除く（壁が車を止めるので、グラフに残すとナビ・自動運転が壁へ案内し、交通 AI が壁を抜ける。再レビュー W-B）。`under` は探りの分類として残す。最初の版の「路面 − 地表 ≥ 3 m は残す」は、最下級の道だけの第12条ただし書を使い、しかも路面で測っていた（既定範囲の 7 件の下面 − 地表は 0.81〜4.08 m で 4.5 m に届かない）。GSI の ftCode 2704（トンネルの道）は交差に `tunnel` と出す。サイトの区間は 50 m の格子で引く（W6: 総当たりで joinExpressway が 28 → 約 500 ms だった）。                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 地形の高さの関数     | `meshHeightAt` を `src/world/terrainSurface.ts` に移した（terrain.ts は Vite の glob を読むので tsx から読めない。terrain.ts は再 export）。一般道の持ち上げ 0.1 m も `STREET_LIFT_M` としてそこに置き、roadSurface.ts が使う。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 地形の探り（`just check-expressway-terrain <dir>`）

`scripts/expresswayTerrainProbe.ts`（判定は `src/world/terrainProbe.ts`）。

- 車道: 盛土・掘割のチャンクと地平 run のチャンクの車道の上を進行方向 1 m・横 0.5 m ごとに、ゲームと同じ地形の高さ（`meshHeightAt`、DEM は `BuildDem`）を取り、地形の穴を描画（z15 の覆いを texel 中心で双線形、0.5 超で切れる）とコライダー（厳密な多角形の判定を点と ±0.48 m で）の両方で反映し、路面 − 0.02 m より高い点を数える。一般道は GSI の地上の中心線（`roadTiles.ts` の `roadLinesOfTile`、`.cache/gsi-vector`）の幅の内で、穴の外にあり、地形 + 0.1 m が路面 − 0.02 m より高い点。
- 端: トンネルの坑口と run の地表端・坑口・open な端から 2 m（`END_M`、覆いの画素 1 個）の内の点は `end*` として別に数える（地表端では地形の 15 m の三角形が端を合わせた DEM から離れ、穴で取ると端の先の一般道まで切れる）。レビューで、既定範囲でこの除外が問題を隠していないことは確認済み。
- 壁: 盛土の壁の外 0・0.25・0.5 m の描かれる地形を、デッキと同じ規則（`embankmentBounds`、開いた側だけ擁壁）の天端・足元と比べ、天端より上・足元より下の点を数える（`probeWalls`、閉じた側も読む。穴の中の点だけ数えない）。
- 一般道の交差: `siteCrossings` の種類ごとの数、取り除く道（`streetCuts`、幅の広い順）、床版が越えている道（`streetsUnder`）、幅 13 m 以上の取り除き（`wideCuts`）。
- 1 行の JSON（`expressway_terrain_probed`）。端を除く点か壁の点が 1 つでもあれば終了コード 1。

| フォルダ（2026-11-12 17:41Z、7a の後、7b2） | チャンク / 点   | 地形が車道に出る | 一般道が出る | 壁（天端 / 足元） | 端の内                                    | 交差（cut / under / end / along）                |
| ------------------------------------------- | --------------- | ---------------- | ------------ | ----------------- | ----------------------------------------- | ------------------------------------------------ |
| p7b-main-default（既定範囲）                | 90 / 181,934    | **0**            | **0**        | **0 / 0**         | 103                                       | 14 / 0 / 1 / 4（幅 13 m 以上 3、トンネルの道 1） |
| p7b-main-pruned（ship/pruned）              | 942 / 1,529,360 | 9                | 0            | 0 / 0             | 1,612                                     | 127 / 8 / 46 / 25（幅 13 m 以上 27）             |
| public/data/expressway（今の既定データ）    | 1 / 1,980       | 0                | 0            | 0 / 0             | 15（麻布台の北の坑口の輪、main と同じ穴） | along 2 だけ（取り除く道 0）                     |

- 既定範囲の探りの終了コードは 0（7b2 の前は 4848757:0 s 41.8 の壁の 4 点・0.09 m で 1）。端のリングで壁が地形より低い所も、途中のリングも 0（レビューの open の検証の LOWWALL: 既定範囲 674 リング・ship 10,062 リングで 0）。
- ship の車道の 9 点: 28368866:2 s 100（8 点、0.21 m、チャンクの境）、333682063:1 s 99.5（0.56 m、車道の縁 u = ±hw、覆いの 2 m の画素の揺れ）。
- 既定範囲の取り除く道（cut 14 件、under 0）: 24402611:0 s 86.8 と 895902565:7 s 853.3（霞が関、**幅 30 m**、路面 − 地表 5.70・5.81 m）、405795846:0 s 145.6（**幅 16 m**、−0.09 m、**GSI のトンネルの道**）、24402611:0 s 29.5（9 m）、895902565:7 s 911.1（9 m）、幅 4.3 m 以下の 9 件（203832842:0 s 23.6・:1 s 40.8、24402611:0 s 30.2、45021972:32 s 8096.7 ×2、45554540:0 s 44.4、895902565:0 s 23.9、895902565:7 s 908.8、45021976:23 s 3445.5）。
- 7a の前（p7b-default、15:52Z）は既定範囲の地形 0・壁 0・cut 14、ship（p7b-pruned）の地形 7・cut 134。
- 405795846:0 s 145.6 の幅 16 m の道は実在はアンダーパス（GSI 2704、OSM の tertiary 45019173・820360608 が tunnel=yes・layer=-1）。7b では cut のまま。

## 途中で横切る道路（既定範囲の 3 本、OSM の id）

| OSM の道路 × run                                                                         | GSI（ゲームの一般道）                                                                                  | 扱い                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 759287234 × 23705286（汐留のランプ 56 m、s 0 = 地表端）                                  | 車道を横切る GSI の一般道は無い（GSI の 高速道路 の線 2 本が 6〜7° で沿うだけで、40 m の規則で落ちる） | 変更なし                                                                                                                                                                                                                                      |
| 1352273266（s 0）・1352273264（s 9.2、途中）× 861095931（31.6 m のランプ、s 0 = 地表端） | 1 本の 25 m の都道府県道の中心線が s 2.2 を 87° で横切る                                               | 地表端から 15 m の内（ランプがつながる道）なので切らない（`end`）。路面は盛土の穴で落ちて車道に出ない。**ランプの足元 s 0〜約 15 の壁高欄が 25 m の道の中に立ち、道の中心線がそれを横切る**（一般車は壁を抜け、自車は壁に当たる。下の欠陥 1） |

## 負荷

- 床版の組み立て: Node（vitest、M2 Max）で計測フォルダの全チャンクを一体化つきで 2 回組み、2 回目の生成器の 1 ステップ。地形は T.P. 12 m ± 3 m の起伏（擁壁の多い側）で、盛土の壁は `meshOf` を通す。隣の床版の判定（`otherDeckTest`）の入った版で、p7b-default（346 チャンク）最大 0.77 ms・p99 0.29 ms、p7b-pruned（3,259 チャンクを 1 つの索引に）最大 0.90 ms・p99 0.33 ms（索引の全チャンクを毎回なめた版は最大 10.5 ms で、チャンクごとの測点の箱の保持と盛土の側ごとのステップで下げた）。今の既定データはステップ数も変わらない（2,986）。4 ms 以内。 7b2 の後（ほかの計測と並べて負荷平均 13 の中）: p7b-main-default 最大 3.1〜3.5 ms（3 回）、p7b-main-pruned 最大 3.17 ms、今の既定データは 2.81 ms でステップ数 2,986 のまま。4 ms 以内。これは負荷の中の値で、7b と交互に測ると差はない（7b2 の 1 ステップ最大 0.60〜1.50 ms、Fable のレビュー）。
- `joinExpressway`（レビューの streets-time.mts、既定範囲の盛土・掘割の周りの GSI 12,345 本）: サイト無し 27 ms、サイトあり 49 ms（初回）・31 ms（2 回目）。

## 不変

- 既定データ・台帳は触っていない（`public/data/expressway` の差分なし）。
- 高架・トンネル・掘割の組み立て: 合成のチャンク 5 例で頂点数・コライダーの三角形数・位置の checksum が origin/main 0683f14 と一致（tests/expresswayGradeStructures.test.ts）。今の既定データの全 266 チャンクの頂点数・三角形数も一致（高架 396,687 / 63,496、掘割 1,092 / 170、トンネル 3,558 / 826）。
- 地形の穴: 今の既定データの穴の多角形（80 点）と z15 の覆いの checksum が main と一致（同テスト）。穴が同じなので、地形のコライダー・一般道の路面（`dropCut`）・歩道（`touchesLonLat`）・建物の落とし方も同じ。既定データで取り除かれる一般道は 0 件。
- 走行: `just check-deck-drive p7b5 all`（今の既定データ、7b2 の後、2026-11-12 18:14Z）で 9 経路とも 1 回目で合格、落下・停止・交差 0。max |dy| 0.072〜0.115 m（shibakoen-shiodome 0.089・auto 2 本 0.097 / 0.111・rainbow 4 本 0.072〜0.078・daiba-exit 0.115・azabudai-tunnel 0.090）。

## 7c の前提に残すもの

| 項目                   | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **止める条件**         | 既定範囲で `streetsUnder` > 0、または例外に載っていない `wideCuts` > 0 なら 7c の入口で止めて報告。例外: 405795846:0 s 145.6（GSI のトンネルの道 = 描けないアンダーパス）は台帳の `ground-crossing` で判断する（迂回の経路が残るかを確かめる。直すなら R の「一般道のアンダーパスを描く」）。**今の採ったフラグの計測（7a の後）では、霞が関の幅 30 m の 2 件（24402611:0 s 86.8・895902565:7 s 853.3）が例外に無い wideCuts で、このままでは止める条件に当たる。** **→ 7a2（低い径間）で直した。既定範囲の wideCuts は 405795846 だけになった。** **→ 7c0 で 405795846 は出力されなくなり（地下・掘割の分合流は S7）、7c の既定データで wideCuts は 0、例外は無い。** これは 7a の R3 では直らない（R3 は薄い桁の下面が 4.5 m を満たす窓だけを高架にする。ここは路面 − 地表 5.70・5.81 m、下面 3.28〜4.36 m で届かず、交差は blocked のまま）。7c の前にコンパイラ側の小さい PR で区分を直す（設計で決める）。405795846 の例外はユーザーの判断も仰ぐ。                                                                                                                                                 |
| 探りの終了コード       | 7b2 の後、既定範囲（採ったフラグ、7a の後のコンパイラ）で 0、今の既定データで 0。ship は車道の 9 点（28368866:2 の境 8 点・333682063:1 の縁 1 点）で 1。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3 m の除外の漏れ       | 7b2 で 3 m の規則をやめ、帯は相手の路面が描かれた地形 + 1 m より上の所だけにした。レビューの extra の検証で既定範囲の「7b で新しい当たり」0、ship の 4 組・37 点（1453508542:11 → 4847507:4、331922701:3 → 1059139534:10、331692344:4 → 806097479:0、42751326:2 → 678697941:4）は消えた。**残り: ship の 4 組・21 点**（1328383029:0 ⇄ 45332351:11 の 13 点・相手の路面 + 1.08〜1.6 m、165913323:0 ⇄ 24040126:0・:4 の 8 点・+0.2〜0.51 m）。原因は擁壁の立ち上げ（7b で入り、7b2 で変わらない。一体化は関係しない）: run が坑口で終わる・始まる端のリングで、2 本の run が同じ線で並んで終わるため、`SQUARE_END_M`（端の 0.5 m を床版の外とする W-C の直し）で組の間の壁が開いた側になり擁壁に上がる（45332351:11 s 2886.9 左 1.10 → 1.58・右 1.82 m、1328383029:0 s 0 左 2.08・右 1.40 m、24040126:0 右 1.40 m、165913323:0 右 1.22 m。Fable のレビューで特定）。当たるレイの数は 0683f14・7b・7b2 で同じで、相手の車道の内に立つ壁は 7b 以前からの ship の欠陥。R の前に調べる。直すなら端の 0.5 m の除外を自分の run の続き（seam・junction の親子）に限る。7c では既定範囲に出ないことを確かめる。 |
| 開いていない判定の残り | 壁際の地面のコライダーが無い割合（レビューの open の検証の BARE、縁の外 0.25 / 0.5 / 0.75 m）: 既定範囲 4.2 / 2.5 / 0.9 % → 7b2 で 0.48 / 0.33 / 0.09 %（4,569 点中 22 / 15 / 4、45021976:23・45554540:0・4848757:0）、ship 0.95 / 0.53 / 0.22 %（62,068 点中 587 / 332 / 135）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 既定データの穴のテスト | tests/expresswayGradeStructures.test.ts の「麻布台の穴が main と同じ」は今の既定データの checksum（80 点・覆い）を持つので、7c で既定データを作り直したら期待値を更新する（再レビュー S-2）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 敷き直しの負荷         | 盛土が既定になると `onBore` がほぼ全タイルで発火し、一般道の路面と歩道の敷き直し（main.ts の CutRelay）、建物の頂点の同期走査（`addHiddenRings`）、地形の覆いとコライダーの作り直しが増える。`ground_cuts_relaid` の回数とフレームの停止を既定範囲の走行で測る。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 歩道の落ち方           | 盛土の穴に触れる歩道の多角形は丸ごと落ちる（`touchesLonLat`）。壁際の歩道が消えすぎないかを視点で見る。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 走行に足す確認         | 麻布台の北の坑門の上の道、盛土の壁際（地面のコライダーの帯）、盛土 → 高架の継ぎ目の高架の下（端面）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 視点                   | 並走する 2 本の穴の間の細い地面（2 m の覆いで消える、レビュー S1）、中央分離帯のランプに沿う 30° 未満の道、盛土と掘割の境（地形の読み幅が縁 + 0.5 m と壁の外 + 1.5 m で違う、S5）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 探りの対象             | 低い高架（桁下が地表に近い）にも広げる余地（S2）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 気づいた欠陥（直していない）

1. ランプの足元が広い一般道の中にある所（861095931）では、壁高欄が地表端まで立ち、一般道の中心線がそれを横切る（高架の足元でも同じ）。地表端の近くで壁を止めるか、交差点として作るかは R。
2. 霞が関の坑口の手前（24402611:0 s 86.8・895902565:7 s 853.3）は、**路面が地表より 5.70・5.81 m 上の盛土**（7a の後。7a の前は 6.2〜6.3 m）で、その下を幅 30 m の道が通る（交差は blocked のまま）。壁が道を塞ぐので 7b は道を取り除く（行き止まり）。7a の R3 では高架にならない（薄い桁の下面 3.28〜4.36 m で 4.5 m に届かない）ので、7c の前にコンパイラ側の小さい PR で区分を直す（設計で決める）。**→ 7a2 で、窓の最低の下面が 2.5 m 以上の 6 本を高架の径間にして直した。**
3. 端の内の地形（地表端の輪で地形の 15 m の三角形が路面より数十 cm 上、坑口で地形が覆い）は探りでは別に数えるだけ。地表端の段差として走行で効くかは 7c で見る。
4. ship の車道の 9 点（28368866:2 の境の 8 点、333682063:1 の縁の 1 点）と、坑口の端で並んで終わる組の擁壁が相手の車道の内に立つ 4 組・21 点（上の表、7b 以前からの欠陥）。

[^p276-7b]: 計測は .cache/expressway-area/p7b-main-default・p7b-main-pruned（7a の後）と p7b-default・p7b-pruned（7a の前）、.qa/expressway/p7b-*.report.json（ローカル、git 管理外）。GSI のベクトルタイルは .cache/gsi-vector。レビューの検証スクリプトは scratchpad の review7b/。

# P2.7-6 PR 7a2: 低い径間（blocked の道路を高架でまたぐ区分、フラグのまま、2026-11-13）

S6 の PR 7a2。高さで決める生成（`--structures height`）で、高架タグの run が 4.5 m で越えられない道路に盛土を載せていた所を、下面が下限以上なら高架の径間にする。解いた高さは動かさず、区分だけを変える。道は blocked のままで、建築限界までの不足は台帳 `low-clearance` に載せて R に回す。計測は `.qa/expressway/` の `p7a2-main-*`（main fb5f423 の基準）と `p7a2b-*`（7a2）、掃引は `p7a2-s*`。

## 規則

- **対象**: 高架タグの run の `blocked` のうち道路（鉄道は対象外）。地平 run・構造物の run・below run は対象外。R3 と afterSpanning の後に見る（`compile.ts spanLow`）。
- **条件**（全部）: (a) 窓の最低の路面 − `GIRDER_MIN` − 道の地表 ≥ `LOW_SPAN_SOFFIT_MIN`（2.5 m）、(b) 窓が盛土にかかる、(c) 窓に掘割がかからない（`heightStructures.ts isLowSpanWindow`）。
- **径間のまとめ方**:
  - 条件を満たす窓を高架に固定し、5 m 以内の窓は 1 つの径間にまとめ、afterSpanning でもう一度ならす。
  - 径間の端が分合流の節点から `MIN_STATION_GAP_M` 以内なら、外へ節点か 3 m 離れた所まで動かす。初回の計測で、888066405 の径間の端が節点 s 123.77 の 0.52 m 手前に来て、子の分合流の測点を持てないチャンクができた（T3、40971846:2）。
- **径間の中**: チャンクの桁は `GIRDER_MIN`、窓 ± 1 m に橋脚を置かない。
- **記録**:
  - 診断の文に「; spanned low (soffit x.xx m)」を足す。
  - チャンクに省略可の欄 `blockedWindows`（blocked ごとの半窓、径間でなければ 0）を、低い径間のあるチャンクだけに書く。XW_VERSION は 6 のまま。
  - スコアカードの `structures.rules.lowSpans` に、解いた run 全体の本数・区間・下面の最小を出す。
- **掃引用のフラグ**: `--low-span-soffit <m>`（`--structures height` と `--out` が要る）。99 で規則が無効になる。
- **検査**:
  - T13 は低い径間の窓を高架と読み、宙の盛土の塊は窓で切る。
  - `checkLowSpans`: 窓の中は全部高架で桁が GIRDER_MIN、下面が下限以上、橋脚なし。
  - T4・R3・7b の `under` は変えていない。

## 下限の根拠と測り方

- `LOW_SPAN_SOFFIT_MIN` 2.5 m（verified: false）。根拠はゲームで、乗用車級（パトカー 1.77 m）が余裕を持って抜けられる下限。
- 8 t トラック 2.78 m・バス 3.10 m・10 t トラック 3.79 m は、下面がそれ未満の所で桁を抜ける。合格ではなく、`low-clearance` で R へ回す不足として扱う。
- 構造令第12条ただし書（低い級の道路・大型車ごく少数・迂回路あり）の 3 m・4 m は流用しない。2.5 m は歩道・自転車道の高さと同じ数だが、適合の根拠にはしない。
- **測るのは窓の最低点**（PR 1 の C1 の測り方）で、交差の中心ではない。霞が関の 6 本は、中心では 3.28〜4.36 m だが、窓の最低では 2.61〜3.81 m。

## 掃引（採ったフラグ）

| 下限      | 既定範囲（タイル） | ship/pruned（タイル） | ship/pruned のタイルで窓の下面 < 2.78 / < 3.10 / < 3.79 m | 解いた run 全体（スコアカードの集計） |
| --------- | ------------------ | --------------------- | --------------------------------------------------------- | ------------------------------------- |
| **2.5 m** | **6**              | **37**                | 8 / 15 / 27（最小 2.52・2.53 m、383231003）               | 82（67 区間）                         |
| 3.0 m     | 2                  | 24                    | 0 / 2 / 14                                                | 60                                    |
| 3.2 m     | 2                  | 21                    | 0 / 0 / 11                                                | 55                                    |
| 3.8 m     | 1                  | 10                    | 0 / 0 / 0                                                 | 27                                    |

- 3.0 m にすると、霞が関の低い側の 4 本（窓の下面 2.61〜2.91 m）が径間にならず、幅 30 m の街路が盛土の壁で切られたまま残る（wideCuts）。
- **指示の目安 60 本について**:
  - 指示の止める条件「ship/pruned の低い径間が 60 本を超える」には、タイルに書かれる 37 本で当たっていない。
  - 実装の報告で一度「82 本で超えた」としたのは、スコアカードの集計（解いた run 全体、範囲の外の成分を含む）を ship/pruned の本数と読んだ誤り。
  - 60 本は、設計が中心の下面で数えた 41 本からの見込みだった。窓の最低点（決めた測り方）で数え直したのが上の表。
  - 規則や下限を本数に合わせて動かすと閾値を合わせに行くことになるので、どちらにしても動かさない（コーディネータの判断）。幅で絞る、地表端から越えられない blocked を除く、といった絞り方も採らない。除いた道は盛土の壁で行き止まりに戻るため。
- 幅 13 m 以上の街路で窓の下面 2.78 m 未満の径間は、ship/pruned で 2 か所（霞が関の 891166417・891166420）。上限は 10 か所。幅は、基準で切られていて 7a2 で切られなくなった街路を、径間の窓 + 5 m の内で照らした値。

## 橋脚の除外帯の調べ（指示 2.1）

- 7a2 の前の chunkRun は、run を横切る道路・鉄道の全部（blocked と cross を区別しない）の周りに、幅 (GROUND_ROAD_HALF_WIDTH + 1) / sin の除外帯を置き、橋脚をその外へずらしていた。
- この幅は、cross の窓 (rp.halfWidth + GROUND_ROAD_HALF_WIDTH) / sin より run 自身の半幅の分だけ狭い。つまり **blocked の窓の全幅は除外されていなかった**。
- 7a2 では、低い径間の窓（まとめた区間）± 1 m を除外帯に足した。

## 計測（採ったフラグ、main → 7a2）

- **不変**:
  - tags は ship/pruned・既定範囲とも main と全ファイル一致し、既定範囲は public/data/expressway とも一致した。台帳の道具の ledger.json も一致。
  - 採ったフラグ + `--low-span-soffit 99` は、main の採ったフラグのビルドと全ファイル一致した（ship/pruned・既定範囲）。
- **高さが動かない**: `just compare-expressway-heights` で、既定範囲 4,608・ship/pruned 44,740・ship/all 47,932 測点とも p99 0、最大 0.001 m。0.001 m の原因は 2 つ: 区分の境が変わって新しくできた測点の Hermite 補間の差（最大 1.14 mm）と、隣の区間長が変わって STATION_DIGITS の桁が変わった丸め（0.2〜0.4 mm）。段・閉鎖・未収束も同じ。
- **既定範囲**:
  - 霞が関の 6 本が径間になった（24402611 は盛土 0〜101 m が 0〜60 m に縮み、その先が 1 本の高架。895902565 も 1 区間）。
  - 探り: wideCuts 3 → 1（405795846 だけ）、streetsUnder 0、streetCuts 14 → 12。terrainOut・streetOut は 0 のまま。
  - violations 0、thin-girder 10 → 12。
  - `low-clearance` は 8 件（霞が関の 6 本、45177681・45177678 × 1030669187）。下面は診断と同じ値になる（891166417 は 2.61 m）。
- **ship/pruned**:
  - violations 0、閉鎖 0/6。
  - タイルの低い径間 37 本、thin-girder 191 → 216。
  - 探り: wideCuts 27 → 20、streetCuts 127 → 108、streetsUnder 8 → 5。切られなくなった街路の幅は 30 m が 5、32.5 m が 1、16 m が 1、9 m が 4、4.3 m が 4、2.5 m が 4。
  - `low-clearance` は 44 件（低い径間 37 と、もとから高架のチャンクの下にある blocked）。地区別に中央 32・東 8・外 4。
- **ship/all**: violations 0、閉鎖 1/6（基準から）、タイルの低い径間 33 本（< 2.78 m は 5 本）。
  - ship/pruned より少ないのは、ship/all では霞が関トンネルの run も解くため。端が地表端でなくなり、891166416〜424 の 6 本が `cross` になる。代わりに 102655997・254333759 × 2 が低い径間になり、27155261 × 717866762 は径間にならない（37 − 7 + 3 = 33）。

## R へ回すもの

- 取付けを上げて 4.5 m にする案。`low-clearance` の `shortM` の大きい順、幅の広い道から。既定範囲では霞が関の 891166417（窓の下面 2.61 m、幅 30 m）が最も低い。ship/pruned の最小は 383231003 の 2.52・2.53 m。
- 8 t トラック・バス・10 t トラックが桁を抜ける径間（ship/pruned のタイルで窓の下面 2.78 m 未満 8・3.10 m 未満 15・3.79 m 未満 27、うち幅 13 m 以上で 2.78 m 未満は 2 か所）。
- W2（レビュー）: ship の 46876172 の幅 30 m の街路は OSM で 2 本に分かれ、片側の 680701145 だけが盛土の下に残り、12.5 m が地形の穴にかかる。探りは中心線で見るので見落とす。探りを幅 13 m 以上の街路は帯で当てる形にするのは 7c の前か R（既定範囲は帯で見ても 0 m）。
- S2（レビュー）: 橋脚の無い長い径間（最大 105 m）。
- S1（レビュー）: 節点が 4 m 間隔で 2 つある所で径間の端が 0.99 m のチャンクを残す件は、`clearOfNodes` で動かなくなるまで繰り返して直した（節点 121・125・窓 [124, 160] → [121, 160]）。
- 持ち越す仮定: 下限 2.5 m（verified: false）。窓の幅は GROUND_ROAD_HALF_WIDTH 6 m で決まり、GSI の街路の幅は見ていない。
- 台帳: 径間でない blocked（半窓 0）の `soffitM` は、道の中心での値。key に道の s を入れた（同じ道が run を 2 回横切る 27155261 × 717866762）。

## 7c の前提（7a2 から）

- **入口の条件**: 既定データの生成（`--below pruned`）で、低い径間が次の 6 本と同じであること。違えば止めて報告。
  - 24402611: 891166420 2.75 m、891166417 2.61 m、891166416 3.65 m。
  - 895902565: 891166418 3.81 m、891166421 2.91 m、891166424 2.83 m。
  - あわせて wideCuts は 405795846 だけ、streetsUnder 0、violations 0。
- **視点**:
  - 盛土の端面の 6.1 m のずれと、895902565 の内側の壁。
  - 橋脚の無い 50.6 m・41.6 m の径間。
  - 桁 1.7 m → 2.2 m の段。
  - 街路の縁と橋脚の間（約 2.8 m・3.8 m）。
- **台帳**: `low-clearance` 8 件。45177678・45177681 × 1030669187 は桁 2.2 m のままで、薄くするかは R が決める。

# P2.7-6 PR 7c0: 地下・掘割の分合流は S7 まで出力しない（2026-11-13）

7c（採ったフラグを既定にする）で既定範囲を作り直すと、seam_hole `4848757:0|4854085|0`（s 45.1〜122.1）が出た。子 4848757:0 は地平のランプ（盛土、路面 −4.14 → −1.78 m、地表 −2.72 → −1.84 m の地下の盛土）、親 4854085:9・:10 は東京港トンネルの below run の掘割（3 車線）で、その間は same の組。地下・掘割の分合流は P9 以来 S7 の範囲だが、PR 2 の C1（`pruneBelow` は地平 run との seam を相手に数えない）で、地平 run が below run に**分合流**で付く形も通るようになっていた。ユーザーの判断で、この形は S7 まで出力しない（東京港トンネルとそこから分かれるランプ、湾岸線の一部が既定範囲から外れる）。[^p276-7c0]

## 穴の直接の仕組み（調査、直していない）

PR 5 と同じ探り方（台帳の世界・レイ・`pairPoints`）で、7c の計測フォルダ p7c-gen1 の 4848757:0 の s 0〜125 を 1 m ごとに、選ばれた親のチャンク・子の役割・リングの継ぎ目の側の reach・レイの当たり（どのチャンクのコライダーか）を出した（.cache/p7c0/trace.mts、ローカル）。

- 子の役割は `child`、親はどの測点でも 4854085:10（cut、bore の描き方）。データの |Δz| は 0〜44 mm で、全区間 w = 1（一体）。
- 親の縁（`pairPoints` の `otherEdge`）は 6.38 m = 車道の半幅 5.88 m + 掘割の壁の厚さ 0.5 m（`slabHalf`）。子の床版はその 6.38 m で切られる（リングの継ぎ目の側の reach が親の縁まで、壁高欄なし）。
- 親の掘割の断面（`expresswayBore.ts boreLoop`）は一体化を持たない（`expresswayDeck.ts` の「no merging (no deck shares a surface with one in the data)」）。路面は ±5.88 m で終わり、その外 5.88〜6.38 m に**擁壁が分合流の側にも立ったまま**（天端は路面 + 1.10 m、壁高欄の高さ。外 5 m から下ろしたレイが u 5.9〜6.36 m で +1,100〜1,245 mm に当たる）。擁壁の底面（shell）は solid でない。
- 台帳の探りは親の路面 + 0.5 m から下ろすので、縁の内 2 mm のレイは擁壁の中から出て、solid でない底を抜けて何にも当たらない（10 m 下ろしても null）。縁の外 2 mm は子の路面に 0 mm で当たる。穴の始まり s 45.1 は、子の車道が親の縁の外へ出始める所（`hasRoadOutside`）で、終わりは子のチャンクの端。
- つまり**穴は「探りが bore の床を面と見ない」のではなく、親の掘割の擁壁（幅 0.5 m・高さ 1.10 m 以上）が分合流の継ぎ目の上に立っている**こと。ゲームではランプへ掘割から出られない（壁に当たる）。S7 で地下の分合流を作るときは、掘割・トンネルの断面に分合流の側の開口（DeckMerge の側）を持たせる必要がある。

## 規則（`compile.ts dropBelowJunctions`、`pruneBelow` の最初）

- `--ground compile` のビルドで、below run と地平 run が分合流（`endPlan` の junction、どちらが親でも）でつながっていれば、その below run と地平 run を計画から外す。外した後にもう一度探し、残らなくなるまで繰り返す（レビュー S1: run を外すとその節点は鎖の次の run のものになり、外した地平 run にぶら下がっていた地平の子が次は below run にぶら下がりうる）。below run は `belowDeferred` に足す（S7）。地平 run は `--ground skip` と同じく run にしない: 隣の高架・below run はそこで地表端（坑口の側は portal）。
- **境の節点**（below run の最初・最後の節点で、鎖が次の run へ続く所）で分かれる地平の子も数える。`endPlan` は境の節点で鎖の先にある run（上流側）を親にするので、掘割が終わる節点で分かれるランプは掘割の子になる。境の節点を地平 run の分合流として扱い直すには `endPlan` の親の選び方を変えることになるので、7c の前に規則を広げない（コーディネーターの判断 W1。ship だけに効き、既定範囲と 7c には効かない）。S7 で境の節点の扱いを決めて戻す。（S7-3 で決めた: `--below-junctions compile` では、分流は節点から始まる run、合流は節点で終わる run が親。フラグなしは今のまま上流側）
- 地平 run との **seam** は今までどおり相手に数えない（C1 のトンネル 4 本はそのまま）。seam だけでつながる below run と地平 run は今までどおり出力される。
- `pruneBelow` の相手に数えるだけ（成分をまたぐかの判定）にしなかったのは、ランプが掘割と同じ成分なら分合流がそのまま書かれるため。below run だけを落とさなかったのは、地平のランプの端が掘割の床の上で地表端になり、どこからともなく出る道になるため。
- 計画だけで決まり（DEM・範囲・解に依らない）、範囲で変わらない（テスト: 外す run も、範囲つきと範囲なしの両方で書く run の高さと端の種類も同じ）。`--below all`（pruneBelow なし）と tags・skip のビルドには掛からない。
- スコアカードの `ground.belowJunctions`（レビュー S3）: 組ごとに、run にしなかった地平の区間と落とした below run（id・km）、節点が親の内（`inside`）か境（`end`）か、範囲が届くか（`inRange`: どちらかの鎖に範囲の run がある）。組は範囲に依らず計画全体。

## 計測（trust signal、2026-11-12 19:35〜19:56Z、M2 Max、3〜4 本並列）

採ったフラグ（`--structures height --ground compile --touchdown all --companions on --companion-weight 1`）で、main d82d434（`p7c0-base-*`）と 7c0（`p7c0-*`）。既定範囲は `hamazakibashi,rainbow,azabudai,azabudai_exit,shiodome`。

| 項目                               | 既定範囲（main → 7c0）                                                                                                             | ship/pruned（main → 7c0）                                                                        | ship/all（main → 7c0）                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 出力の run                         | 35 → **31**（本線 18 → 15、ランプ 15 → 14）                                                                                        | 562 → **558**（本線 147 → 145、ランプ 413 → 411）                                                | 584 → 584（スコアカードは時間以外すべて一致）                    |
| 消えた run                         | 4854085（本線、below 2.60 km）、1059139534（本線、地平 2.30 km）、405795846（本線、地平 0.17 km）、4848757（ランプ、地平 0.33 km） | 4854085、5170834（本線 B、below 1.67 km）、5170992（ランプ、地平 0.39 km）、4848757              | なし                                                             |
| `ground.belowJunctions`            | 4848757 → 4854085（inside、範囲内）、5170992 → 5170834（end、範囲外）、5213288（0.57 km）→ 5213283（9.60 km、end、範囲外）         | 同じ組（5170992 → 5170834 だけ範囲内）                                                           | なし（pruneBelow を掛けない）                                    |
| 出力に残る below run への分合流    | 1（4848757 → 4854085）→ **0**                                                                                                      | 2（4848757 → 4854085、5170992 → 5170834）→ **0**                                                 | 3 → 3（28127318 → 867182415 を含む。`--below all` は全部を解く） |
| 閉鎖 本線 / ランプ                 | 0 / 0 → 0 / 0                                                                                                                      | 0 / 6 → 0 / 6                                                                                    | 1 / 6 → 1 / 6                                                    |
| 本線の穴 それ以外 / below の隣     | 0 / 0 → 0 / 0                                                                                                                      | 0 / 3（0.11 km）→ 0 / 3（増分 0）                                                                | 0 / 3 → 0 / 3                                                    |
| 出力されない below run（本線の鎖） | 18・18.0 km → 14・11.8 km                                                                                                          | 42・59.7 km → 44・63.9 km                                                                        | 24・17.0 → 同じ                                                  |
| violations / 未収束 / dangling     | 0 / 0 / 0 → 0 / 0 / 0                                                                                                              | 0 / 0 / 0 → 0 / 0 / 0                                                                            | 0 / 0 / 0 → 同じ                                                 |
| 最大の成分（run・変数）/ 解く段    | 1,112・39,398 / 282 s → 1,106・38,920 / 278 s                                                                                      | 1,112・39,398 / 288 s → 1,106・38,920 / 292 s                                                    | 1,414・48,672 / 253 s → 同じ / 263 s                             |
| 高さの差（共通の測点）             | 4,263 測点で p99 0.044・最大 1.42 m（1 m 超は 45019020 s 40 だけ）                                                                 | 44,426 測点で p99 0.026・最大 1.64 m（1 m 超は 1059139534 s 2304.1 の坑口側の端・45019020 s 40） | 47,932 測点で 0                                                  |
| 低い径間（タイル）                 | 6 → 6（24402611 × 891166416 3.65・891166417 2.61・891166420 2.75、895902565 × 891166418 3.81・891166421 2.91・891166424 2.83 m）   | 37 → 37                                                                                          | —                                                                |

- 既定範囲の地形の探り（`just check-expressway-terrain`）: 7c0 は 57 チャンク・83,003 点で地形 0・一般道 0・壁 0、**wideCuts 1 → 0**（405795846 が消えたので、7b の例外は不要）、streetsUnder 0、終了コード 0。
- 既定範囲の台帳を一から数えた版（`--seed public/data/expressway/ledger.json`）で seam_hole 0。
- 消えた本線の 1059139534・405795846 は規則で落ちたのではない。既定範囲では、4848757 の親 4854085 の seam の親として範囲の閉包に足されていた地平 run で、4854085 が外れて要らなくなった（ship では範囲の run なので残る。Fable のレビューで確認）。
- ship で消える本線 5170834（B、1.67 km）は C1 で戻したトンネルの 1 本。ランプ 5170992 は**掘割 5170834 の終端の節点（s 1673.86 / 1674）で分かれ**、地平 run 678697941 の脇 4〜11 m を走る。7c の ship の台帳にこの組の seam_hole は無い（nose が accepted・let_go が new だけ）。`endPlan` が境の節点で上流側の run（5170834）を親にするので規則に掛かる。S7 で境の節点の扱いを決めて戻す。
- 計画全体で below run が絡む junction は 4 件: 親の内 1（4848757 → 4854085）、終端の節点 3（5170992 → 5170834、5213288 → 5213283、28127318 → 867182415）。28127318 は高架なので規則の対象外（`--below all` の ship/all に出る 3 件のうちの 1 つ）。
- 45019020 s 40 の 1.42 m は、始点が seam から地表端に戻った結果で、今の既定データと同じ値（Fable のレビューで確認）。
- **S7 の入力（原因未確認、レビュー S4）**: ship/pruned で 878618792（多摩川トンネル）の s 1680〜2332 が最大 0.99 m 下がった。外した run の隣ではない（同じ成分の解き直しの結果と見ているが、確かめていない）。
- **R の材料（レビュー S5）**: 1059139534 の 4854085 側の端は open から portal（坑口）になり、端の高さが 1.64 m 動く。ship だけで、坑口の端の形（盛土・掘割の終わり方）は確かめていない。
- 最大の成分が 1,106 run のままなのは、既定範囲が地平 run と C1 のトンネルで大きい成分に届くため（W7 の成分の大きさは 7c0 では変わらない）。

## 不変

- tags のビルドは main（`git archive origin/main` の木）と全ファイル一致（ship/pruned 119 ファイル・既定範囲 12 ファイル）。tags の既定範囲に今の台帳を入れて `just update-expressway-ledger` を掛けると `public/data/expressway` と全ファイル（ledger.json を含む）バイト一致。
- 既定データ・台帳は触っていない。全テスト 168 files / 2,257 passed（レビュー後）。
- レビュー後（S1 の繰り返し・S3 の組の配列）に既定範囲・ship/pruned を作り直し（`p7c0b-*`、2026-11-12 20:16〜20:23Z）、出力のフォルダは直す前の `p7c0-*` と全ファイル一致（実データでは繰り返しは 1 回で終わる）。スコアカードは `belowJunctions` の形だけが変わる。

## 7c の前提（7c0 から）

- 既定範囲の junction の端で、below run または bore のチャンク（tunnel・cut）を親にするものが 0 件であることを、7c で既定データの検査として足す。
- 7c0 の後に rebase して作り直すと、台帳は 36 件が消えるだけ（Fable のレビューの見積もり）。
- 7b の `405795846` の wideCuts の例外を外す（405795846 は既定範囲に出ない）。
- 走行の経路 (1)（湾岸線 → 東京港トンネル → 4848757）と東京港トンネルの視点を外す。

## S7 で戻すもの

- 東京港トンネル 4854085 とランプ 4848757（親の内の分合流。掘割の断面に分合流の側の開口が要る）。
- 湾岸線 B の 5170834 とランプ 5170992、5213283 と 5213288（境の節点の分合流。境の節点の親の選び方を決める）。

## テスト

`tests/expresswayGroundRuns.test.ts`「地下・掘割の分合流（PR 7c0）」: 高架 → 地平 → 掘割 800 m → 地平 → 高架の本線の掘割の途中から、地平のランプ → 高架のランプが分かれる合成網で、掘割と地平のランプが出力されず、ランプの高架は地表端、掘割の両側の地平 run は坑口（portal）で終わり、dangling 0。範囲を変えても外す run が同じ。ランプの無い同じ網では掘割と両側の地平 run が今までどおり出力される。規則を外したコードで 1 つ目と 3 つ目が落ちることを確かめた。レビュー後に足したもの: (W1) 掘割の終端の節点で地平のランプが分かれる網で、掘割とランプが出力されず `node: "end"`。(S1) ランプ R（地平 → 掘割 → 高架）が本線の掘割から分かれ、ランプ X が R の地平と掘割の境の節点で分かれる網で、1 回目に R の地平と本線の掘割、2 回目に X と R の掘割が外れ、書かれる run に below への分合流が残らない（繰り返しを 1 回で止めたコードでは落ちる）。(S2) 範囲つきと範囲なしで、両方が書く run の端の種類と測点が一致する。

[^p276-7c0]: 指示は scratchpad の p27/s6-pr7c-stop.md の 1 節（設計 Fable）。計測は `.cache/expressway-area/p7c0-*`・`.qa/expressway/p7c0-*`（ローカル、git 管理外）、7c の計測フォルダ p7c-gen1 は 7c の作業ツリーのもの（読み取りのみ）。追跡のスクリプトは .cache/p7c0/trace.mts・runs.mts・lowspans.mts。

# P2.7-6 PR 7c2: ランプの足を街路の縁で切る・入口の路線（2026-11-13）

設計メモ（scratchpad の p27/s6-pr7c-feet.md の 8 節）の 7c2 は T（3.2 節、足を街路の車道の外へ）と S1（4.1 節、入口の路線）。1 版目は「残り 10 m 未満の足は run にしない」で止まり、設計の回答（p27/s6-pr7c2-answer.md、設計 Fable）で「隣の高架に含めて切る」に直した。2 版目は回答 5 節の止める条件のうち 2 つ（前に無かった lowerSpeed が 1 本で増える、本線 1 m 超に「どちらでもない」が 1 本）に当たって止めたが、2 回目の回答（p27/s6-pr7c2-answer2.md）で、どちらも切った足から上下の関係を伝わった結果（緩みの 2 次・3 次）で既定範囲には出ないとされ、PR に進めてよいと判定された。[^p276-7c2]

## 置き場所（T、1 時間の内に決めた）

- **計画で切る**。`compile.ts planNetwork` が鎖ごとに run を作ったあと、`cutFeet` が鎖の最初と最後の run の外側の端を見る。ランプ（`cls` が ramp、構造物の上でない、below でない）の地表端なら、標本（約 1 m）の番号で `i0` / `i1` を切った run を作り直す（`runPlan` の `cut`、`RunPlan.footTrim`）。run の距離の原点は切った所になるので、対・交差・seam の `parentS`・分合流は全部、切った run から決まる。
- 切る長さは `feet.ts footCut` で決める。端から 1 標本ずつ見て、床版の断面（車道の半幅 + `PARAPET_WIDTH`）が次の道路の中心線から `GROUND_ROAD_HALF_WIDTH`（6 m）より離れる最初の標本で切る。
  - 端の節点を通る道路（中心線が 1 m 内）。
  - 端から 30 m 内で run の中心線を横切る道路。
- 30 m（`RAMP_FOOT.maxM`）の内で離れなければ切らない。このときは診断 `ramp_foot_along_street` と台帳の `foot-along-street` に出す（規則では通さない）。
- 道路は解く段の `CrossObject` を使う。計画の後でしか読まないので、`scripts/expressway.ts` は 1 回目の計画で道路を読み、`PlanOptions.feet` を付けて計画し直す。`--ground compile` のときだけ。
- 足の内（切る長さ + `MIN_STATION_GAP_M` の内）に**コンパイルされる**別の鎖の節点がある足は切らない（`kept`）。地平だけのランプ（203873824 の節点 16 の c944138315）は数えない。
- 高架に含めるのは、すぐ隣の（節点でつながる）高架で、それ自身も足の候補（ランプ、構造物の上でない）のときだけ。含めた run の反対側の端は、先に決めた切り・`footTrim`・`footMerged` を引き継ぐ（コードレビューの必須 1: 地平 13 m → 高架 300 m → 地平 13 m で始点の切りが落ちて `blocked` が出ていた。テストあり）。含めた後に高架の足が切られなかったときは、その結果（along・kept）を `into` つきで記録する。
- Why not 出力で切る（全長で解き、s ∈ [0, d] を地表に保つ）: 距離の原点が 0 でない run を許すことになり、`heightStretches` の `isAnchored` ほか、原点を前提にした所を全部洗う必要がある。

## 残り 10 m 未満の足: 隣の高架に含めて切る（設計の回答 2.1）

- 1 版目は「run にしない」だった。こうすると、隣の高架（長い run）の端が橋のタグの終わりで「高さ固定 + 地形の勾配」に変わった。足の短い地平 run だったときは「帯 ± `GROUND_END_BAND`・勾配自由」だった。さらに、切る必要の無かった残り 0〜8.9 m も一緒に失った。結果は 176046420 が仮定の床を譲る最終段（assumedGive）まで落ち、26957083 は下りの端に地形の +3.5 % を付けられ、本線の 1 m 超 10 本のうち 7 本がこの型の足の周りに出た（設計の回答 1.1 の表）。
- 2 版目: `mergedRunPlan` がその地平 run を隣の高架の run に含める。`network.ts GAP_FILL_M` と同じ考え方で、地平 run の way は `filledWays` になり、id は高架のまま。含めた run の地表端を同じ規則で切る（スコアカードの `feet` では `merged`、`into` と `mergedM` を持つ）。
- 含めた側の端は足の扱いを引き継ぐ（`RunPlan.footMerged`）。`setupRun` で `{ z, band: GROUND_END_BAND }` とし、勾配は自由。端の種類は変えず、T が動かすのは足の位置だけになる。
- Why not 帯を広げる、または含めた端に地形の勾配を付ける: 閾値を緩める直しになるか、1 版目の退行の元そのものになる。`GROUND_END_BAND` は動かしていない。

## S1（入口の路線）

`signPlan.ts entranceJoin` が、入口の run の端が分合流でなければ、seam の親か、自分を seam の親に持つ run へ進む（4 hop まで、輪を検出したら止める）。分合流の親を路線にする。含めた run が入口になる形では 0 hop で決まる（テストで確認）。tags のビルドでは入口の端は全部分合流なので、結果は変わらない。

## 並走（foot-along-street）

**30 m の内で床版が街路（半幅 6 m）の車道を出ない足はすべて**この類型になる。中央帯のランプや浅い合流だけではない。ship の 170 件のうち 33 件は角度 17° 以上（最大 89.9°）で、交差する道路が端の近くに重なる形もここに入る。類型のまま、規則は足していない。case の `measured` には次を持たせる（ship で規則を作るときの材料）。

- `s`: 端の位置。
- `angleDeg`: 端での最寄りの街路との角度。
- `streetM`: 床版が半幅 6 m の内にある長さ（30 m で打ち切り）。
- `coverM`: 床版の縁が街路の中心線を覆う長さ。
- `offGroundM`: その区間の |路面 − 地表| の最大。解いた後のチャンクから `ledger.ts caseContextOf` が出す。

既定範囲の書く鎖の 1 件は 203832842:end で、角度 12.1°、`streetM` 29.9 m、`coverM` 13 m、`offGroundM` 0.315 m。ship の 170 件では角度が p50 9.9°、最大 89.9°。

- **30 m に届かない run（訂正）**: run の全長が 30 m に満たず、全長が街路の内にある足は、2 版目までは「30 m 並走」と記録していた（ship の書く鎖で 8 本。438481856 11.6 m、45977417 24.4 m など）。今は `footCut` が `inside` を返し、`cutFeet` は切らずに `kept`（`cutM` 0）とする。診断と台帳の `foot-along-street` には実際の長さ（`for 11.6 m` など）を書く。ship では kept 7、`streetM` 29 m 未満の case 11。
  - Why not 隣の高架に含めて切る（レビューの提案、試した）: ship/pruned で本線 44506762 が s 7268 で −1.79 m 動いた。どの変わった足の関係でも説明できなかった（緩みでも分合流の引きでもない、最寄りの足 960810627 は分合流の差 0.05 m）。さらに 438481856 を含めた 1023900994 が 8.78 → 11.44 %（+2.67 ポイント）になり、2 回目の回答の止める条件に当たった。そこで挙動は戻し、記録の誤りだけを直した。
- 設計メモ 3.2 のデータテスト（既定データの全足で、端の節点を通る地上道路の車道の内に床版が無い）は 7c へ送る。7c2 では既定データ（tags）を作り直さないので、今のデータでは検査にならない。

## 計測（trust signal、2026-11-13 01:21〜01:40Z、M2 Max、2 本並列）

採ったフラグは `--structures height --ground compile --touchdown all --companions on --companion-weight 1`。比べたのは main 45d8d13（`t2-base-*`）と 2 版目（`t2c-*`）。既定範囲は `hamazakibashi,rainbow,azabudai,azabudai_exit,shiodome`、ship は `--below pruned`、抽出は kanto-20261003T202050Z。1 版目（`t2b-*`）の値は括弧内に書いた。

| 項目                               | 既定範囲（main → 7c2）                                                                                         | ship/pruned（main → 7c2）                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 出力の run                         | 31 → 29（含めた足 2: 45068171 → 24402125、203873824 → 4853798）                                                | 558 → 545（含めた足 13 だけが消える）                                                                                                                                                |
| 足（書く鎖）                       | 切る 3・含める 2・並走 1                                                                                       | 切る 36・含める 13・並走 100                                                                                                                                                         |
| 閉鎖・violations・未収束・dangling | 0・0・0・0 → 同じ                                                                                              | 閉鎖 6（前から）・0・0・0 → 同じ                                                                                                                                                     |
| ground の blocked（うち途中）      | 3（1）→ 0（0）                                                                                                 | 104（21）→ 75（15）                                                                                                                                                                  |
| 本線の高さの差                     | p99 1.38・最大 1.89 m（1 版目 2.87）、1 m 超 2 本                                                              | p99 0.66・最大 2.54 m、1 m 超 8 本（1 版目 10）                                                                                                                                      |
| 1 m 超の分類（回答 3.4）           | 2 本とも ship の分類と同じ run（足が範囲の外で、既定のスコアカードに無いため道具では「どちらでもない」と出る） | 緩み 5・緩みの 2 次 1・分合流の引き 2・どちらでもない 0・上がる 0（23681223 は設計の判断。道具の出力は下）                                                                           |
| 前に無かった段                     | なし                                                                                                           | **1125559318 に specialGrade と lowerSpeed**。specialGrade の新規は 5 本（1125559318・165913328（本線）・176046420・92243922・960810623）、外れたものが 2 本（780870437・902298628） |
| ランプの最急勾配 +2 ポイント以上   | 4853798 9.35 → 11.35 %                                                                                         | 202903719 2.92 → 5.32、4853798 → 11.35、960810623 8.96 → 11.44                                                                                                                       |
| 入口の `route` が null（S1）       | 3 本中 2 → 0（23705286 汐留・861095931 芝公園が C1・都心環状線に）                                             | 81 本中 74 → 11（1 版目）                                                                                                                                                            |
| 低い径間・地形の探り               | 78・64・2.52 m → 同じ。地形・一般道 0、wideCuts 0（1 版目）                                                    | 82・67・2.52 m → 同じ                                                                                                                                                                |

- 本線の 1 m 超の分類は、差が最大の測点の ± 200 m について、前のビルドの上下の関係（`forcingOf` の above / below）を前後で並べて分けた（scratchpad の t2/classify.mts）。緩みの run の**上**を通り、前後とも上下の差が 4.5 m + 桁高から 0.05 m 以内の run は「緩みの 2 次」（何次でも、たどった鎖を出す）。上下の差は重なりの測点ごとに下の床版の路面（横断勾配込み）から測り、その最小で見た（斜めの交差では中心線の上の差は最も近い所より大きい）。コードレビューの条件で次の 2 つも足した。
  - 最小の測点が、差が最大の測点の ± 200 m の内にあること。
  - その測点で上と下の Δz が 0.1 m 以内で一致すること。
  - 緩み: 1421966435（182465957 を切る、分合流 −0.19 m）、165913328・165913330（26957088 を含める）、45021972（207659102 を含める、分合流 −0.47 m）、45554540（同）。
  - 分合流の引き: 28127113（182465953 を含める、−0.54 m）、41520089（202903719 を 27.04 m 切る、−0.75 m）。
  - 緩みの 2 次（設計の判断。道具は窓の条件で「どちらでもない」のまま）: 23681223（s 271 で −1.07 m）。1421966435（緩み）の上を通る本線で、上の床版は下の床版に載ったまま一緒に下がった。測った値は次のとおり。
    - 全測点（下の中心線から横 3 m の内）での上下の差の最小: 前 0.044・後 0.046 m（4.5 m + 桁 2.19 m からの差）。中心線での外れの最大: 前 0.052・後 0.112 m。
    - その最小の測点（s 50・19）での Δz: 上 −0.692・下 −0.684 m で一致。ただし差が最大の s 271 から 221〜252 m 離れていて、± 200 m の窓の条件は満たさない。
    - s 271（下の中心線が横 7.5 m）: 上下の差 6.702 → 6.689 m、Δz は上 −1.066・下 −1.053 m。1421966435 が下がったのは、前はランプ 182465957 の足（s 8073.18〜8108.36 の above）をまたぐ山があり、足を 26.84 m 切って関係が s 8073.18〜8078.18 に縮み、山が消えたため（設計の回答 2）。
- **lowerSpeed（緩みの 3 次、止めない）**: 1125559318（本線 45554540 へ s 470.97 から同一面で合流するランプ、自分の足は切っていない）。鎖は、207659102 を 5219302 に含めて切る → 5219302 が低くなる → その上の 45554540 が下がる（緩み、s 540〜700 で −1.89〜−1.39 m）→ 合流する面が 12.12 → 10.30 m に下がる → 合流の 34 m 手前にある自分の交差の窓（s 405.3、要る高さ 11.156 m）の端で床に着く（設計の回答 2 で確認）。解く段が進んだ理由（デバッグの出力で確認、30 分の内）: どの段でも**検査の失敗は 0**（`isFailing` が偽、`problems` 空）で、軟らかい行の外れ（`soft` 0.053 → 0.048 → 0.049 m）が s 473.47〜473.58（合流の始まりの節点）に残り、ランプの軟らかい外れで段を進める規則（`solveComponent` の `isRamp && isSoft && hasSoftStep`）で standard → specialGrade → lowerSpeed と進んだ。段を進めても外れは減っていない。端のチャンク（s 323.58〜）の V 40 → 20 は lowerSpeed の窓（外れの位置 ± 150 m）。ランプの最高点が 12.67 → 14.03 m に上がった理由は読めていない。R1 へ: 「合流の手前に交差の窓があるランプで本線が下がりすぎないようにする」（PR 6 の本線が譲らない規則の見直し）と、軟らかい外れが段で減らないときに段を進めない規則、スコアカードに「前に無かった段が付いた run と、その run が合流する本線の高さの差」を出すこと。
- 分合流の引き 2 本（28127113: 182465953 を含めて −0.54 m、41520089: 202903719 を 27.04 m 切って −0.75 m）は ship の計測の記録として残し、R1 へ回す。**41520089 は本線の勾配が 2.5 → 4.25 % になっているので、R1 の地区の判断で最初に見る**。
- 1 版目からの改善: 176046420 の assumedGive は消えた（specialGrade だけ）。26957083・128005859 の +2 ポイントも消えた。本線の最大の差は 2.87 → 2.54 m。
- 既定範囲の足ごとの GSI の街路の内の長さ（scratchpad の t2/feetprobe.mts）は、切った足・含めた足で 0 m のまま。23705286・203873821・861095931・4853798・24402125 の端。
- 台帳の前後（それぞれ public の台帳で seed して数え直した版）:
  - 既定範囲 new 144: `foot-along-street` 142・ramp-radius 1（4853798、OSM の足の R 13 m を含んだため）・thin-girder 1。
  - 既定範囲 gone 11: ground-crossing 3（`ground-crossing:861095931` の 2 件を含む）・ground-stretch 2・ramp-radius 3・seam_step 2・merge_skipped 1。seam_hole 0 → 0。
  - ship new 195: `foot-along-street` 170・merge_skipped 7・seam_step 6・thin-girder 3・let_go 2・other 2・changeover・nose・parallel-ramp・ramp-radius・seam_hole 各 1。
  - ship gone 67: ground-crossing 29・ground-stretch 13・seam_step 8・parallel-ramp 4・let_go 3・merge_skipped 3・ramp-radius 3・other 2・nose・thin-girder 各 1。
  - 既定範囲の `foot-along-street` 142 件のうち、書く run の鎖のものは 1 件（203832842）。残りは成分を解くためだけに解いた run の診断で、7c の「台帳の case は範囲の run だけ」が入れば case にならない見込み。

## 7c（既定データを作り直すとき）に確かめること

T で既定範囲の足の端の勾配が変わっている（設計の回答 2 の 3.2）。走行と視点で確かめる。

| 足                                        | 端の勾配（前 → 後）                       | 最急勾配                             | 確かめ                                                                       |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| 4853798（芝公園出口、203873824 を含める） | −8.96 %（節点で）→ −11.35 %（街路の縁で） | 9.35 → 11.35 %                       | auto-shiodome-shibakoen で足の前後 10 m の \|dy\| ≤ 0.15 m・停止 0、足の俯瞰 |
| 24402125（汐留出口、45068171 を含める）   | −2.69 % → −5.92 %                         | 5.10 → 5.92 %、最高点 9.96 → 10.78 m | shibakoen-shiodome で同じ、`low-viaduct-24402125` の視点                     |
| 861095931・23705286・203873821（切る）    | —                                         | —                                    | 足の探り（7c1）と `ground-crossing-861095931` の視点                         |

- 4853798 は勾配 11.35 % の床版から平らな街路へ折れ目なしで移る（車の進入角 31°、折れ 6.5°）。\|dy\| が 0.15 m を超える・止まるなら、閾値を動かさずに止めて設計へ戻す（足の端に縦断曲線を入れる規則が要るかを決める）。
- 台帳は 7c2 では触らない。7c の作り直しで出る入れ替わりは今の規則で受ける（`foot-along-street:203832842` は視点つきで判断、規則で通さない）。高さの差・最急勾配・解く段は台帳の類型ではないので knowledge とスコアカードに残す。

## seam_hole 154971210:2 | 28188273（ship、回答 4.2 の調べ）

- PR 5 の追い方（.cache/p5/trace.mts、0.25 m ごと）で s 264〜270 を見た。
- 穴は s 266.71〜267.46 の探り（4 点）にあり、子の中心から u 4.5〜4.75 m（子の縁 4.50 m・親の縁 4.75 m の間）。車線の内（u 0〜4.0 m）は全部面がある。
- same の区間の始まり（s 266.58）から 0.13〜0.88 m で、**始まりの 1 m 以内、車線の外**。回答の判断どおり 7c2 を止めない。
- 原因は、切ったランプの測点の格子が run の始点から数え直されて same の区間の始まりが 2.95 m 動いたことと見ている（設計の回答）。直接の仕組みは確かめていない。

## 不変

- tags のビルドは main と全ファイル一致。
  - 既定範囲: public の台帳を入れて `public/data/expressway` とバイト一致。`just update-expressway-ledger` 相当を掛けた ledger.json も一致。
  - ship/pruned: main のビルドと 119 ファイル一致（2 版目の最終コードで作り直して確認）。
- 既定データ・台帳は触っていない。全テスト 169 files / 2,278 passed。

## テスト

`tests/expresswayFeet.test.ts` が保証すること:

- `footCut` の合成の線: 直角・30°・並走（角度 0°・`streetM`・`coverM` 30 m）・街路なし・角で続く 2 本目の街路で、切る長さが式どおり。
- 合成網: 切った端が地表にあり `blocked` が無い。T1〜T3・T5・T13 と dangling は 0。範囲に依らない。道路を渡さなければ今までどおり。
- 並走は `foot-along-street`（規則で通さない、`offGroundM` は解いた後に出る）。
- 13 m の足は高架に含まれて切られる。端は帯の内、上りの地形でも下りの勾配のまま（地形の勾配に固定したコードでは落ちることを確かめた）。最急勾配は長さの比の分まで、解く段は増えない。足の内で地平だけのランプが分かれても含める。
- 含めた run が入口になり、`route` は C1。地平の入口ランプ → seam → 高架 → 本線の網でも `route` が C1。
- コードレビューの後に足したもの:
  - 両端に短い地平 run がある高架: 両端とも含めて切られ、`footTrim` が両方あり、両端の `blocked` が空。反対側の引き継ぎを外したコードでは落ちることを確かめた。
  - 始点を切った地平 run の後ろの高架: `start.parentS` が切った後の長さに一致し、seam で z が続く。
  - 高架の地表端を直接切る形。
  - 足の内に鎖の節点がある足は `kept`。
  - 全長が街路の内の短い run は `kept`、診断には実際の長さ。
  - `entranceJoin`（純関数にした）の輪と hop の上限。

[^p276-7c2]: コードレビュー（Fable、要修正）の後に作り直した `t2e-*` のタイルは `t2c-*` と全ファイル一致（report.json の診断の文面だけが違う）なので、上の数値はそのまま。計測は `.cache/expressway-area/t2-*`・`t2b-*`・`t2c-*`・`t2d-*`（含める版の試し）・`t2e-*` と `.qa/expressway/t2*`（ローカル、git 管理外）。道具は scratchpad の t2/（compare.mts: run・本線の高さ・勾配・段、classify.mts: 本線の差の分類、feetprobe.mts: GSI の街路の内の長さ、ledgerdiff.mjs: 台帳の前後）と p27/feet/（ab.mjs・prof.mjs、設計 Fable の道具）。

# P2.7-6 PR 7c1: ランプの足の接続・経路の目標・地表端と掘割の帯・seam の測り方・幅の段・板の下端（実行時、既定データ不変、2026-11-13）

指示は scratchpad の p27/s6-pr7c-feet.md の 8 節「7c1」（設計 Fable）、Fable のレビュー（要修正: 中 3・小 1）と 250488080:end の設計判断（p27/review7c1/turns-back.md）。データと形式・台帳は変えず、実行時と走行の道具だけを直した。確かめは既定データ（main のまま）と、7c2（#83）の後のコンパイラで採ったフラグ（`--structures height --ground compile --touchdown all --companions on --companion-weight 1`）で作った計測フォルダ f71-gen2（既定範囲、29 run・316 チャンク）・f71-pruned（ship/pruned、545 run）。[^p276-7c1]

## 直したもの

| #    | 置き場所                                                             | 規則                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | `expresswayRoads.ts joinExpressway`・`nearestAhead`                  | 足（ランプ・構造物の街路の地表端）の接続路は、足の向きに `LEAD_M` 5 m 真っすぐ出て（先行点）、端面より後ろでは車道の半幅の内にしか入らない（規則 1・2）。結ぶ順序: (a) 先行点から車道の半幅以内の GSI 高速道路の線（同じランプの地平部）を先の側だけ歩く → (b) 先行（足 → 先行点）が中心線を横切る街路の交点（足が街路の車道の中にある形） → (b) 先行点より前（out ≥ `LEAD_M`）・車道の縁が先行点から `RAMP_REACH_M` 15 m 内の街路の点のうち脚が 45° 以内の最寄り → (c) 足の内側（端から 15 m 内）で run の線を横切る街路の交点（接続路なし） → (b・最後) 同じ候補の最寄り（脚 45° 超〜90°） → (d) `ramp_unattached`。街路に置いた頂点が足から 1 m 未満なら、その頂点が足の ID を持つ。`XwGroundEnd` に `dir`（足の向き）と `halfWidth` |
| F2   | `navigation.ts planRoute`・`autoDriver.ts bestStart`                 | 今までどおりの目標（最寄り全体 + 30 m）に経路が無いときだけ、目標を出発から届く区間（使える区間・車は一方通行を守って 1 回たどる）の最寄り + 30 m に取り直す（`aimInReach`）。ただし目的地が地図の内（元の最寄り < `REACHED_TARGET_M` 40 m）で届く最寄りが 40 m 以上なら取り直さず null（7c1 の前と同じ。到達しない経路を返すと AutoDriver が終わらず、robotaxi.board() の契約も破る）。`AutoDriver.bestStart` は全部の出発点を今までの目標で試してから届く区間で試す（失敗したときは 2 回計画する）                                                                                                                                                                                                                                    |
| F3   | `expresswayDeck.ts`                                                  | 盛土・掘割のチャンクが run の `ground` 端で終わるとき、端面から 1.5 m（`EMBANKMENT_APRON_M`）・壁の外面の幅で、描かれる地形の高さのコライダーだけの帯（横 4 m・縦 0.5 m の格子、他の床版の穴・車道の所は出さない）。掘割の壁の外にも盛土と同じ側面の帯（壁の外面 = 半幅 + 擁壁 0.5 m から 1.5 m、7b の開いた側の判定 `otherDecksAt` をそのまま）                                                                                                                                                                                                                                                                                                                                                                                        |
| F4   | `expresswayDrive.ts insideHit`                                       | 区間の端に止まった hit は、同じ run の区間に加えて、止まった端の節点でつながる床版の区間（run が違ってよい）の内側の hit に替える                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A    | `expresswayDrive.ts rideHit`                                         | 走行の標本の hit: cruise の prefer の run → 自動運転の今の経路の区間の床版（navGuide.ts locateCar と同じ引き方、経路が変わったときだけ集合を作り直す） → `graph.locate`、そして insideHit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A1   | `expresswayDeck.ts closeWidthStep`                                   | 同じ run の隣のチャンクの床版の縁が `PARAPET_WIDTH` を超えて内にある継ぎ目で、広い側の端のリングに、狭い床版の縁から広い床版の縁まで・厚さ 0.5 m・床版の下面から壁高欄の天端までの壁（描く・solid）。その側の壁が自分の縁に立っていない（同一面の相手が続く）ときは閉じない。トンネルの隣は対象外                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| H    | `expresswaySigns.ts placeBoard`                                      | 板（門型・桁添架・壁付け）の `bottomM` = 板の中心 − 高さ/2 − その測点の中心線の路面（`guideSigns.ts` の測り方と同じ）。NaN に固定しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 探り | `scripts/expresswayFeetProbe.ts`・`just check-expressway-feet <dir>` | 全ランプ・構造物の街路の足を、足の周りの 3 × 3 の z16 タイルと 1,300 m 内のチャンクでゲームと同じに結び、規則 1（端面より後ろで車道の半幅の外）・規則 2（最初の 5 m が足の向きから 1 m を超えてずれる）・折り返し（`turns-back`、街路への脚が 90° 超）を破る足を数え、脚が 45° を超える足を `steepFeet` に出す。`expressway_feet_probed`、破る足が 1 本でもあれば終了コード 1                                                                                                                                                                                                                                                                                                                                                           |

設計からの逸脱（2 つ、Fable のレビューで妥当と判定）:

- F1 (b): 「脚が 45° を超えるときは結ぶ点を街路に沿って先へ送る」は、足が街路の車道の内にあると届かなかった（汐留入口 23705286:start・芝公園出口 203873824:end は、街路の中心線が足と先行点のあいだで足の軸を横切り、送っても 45° に入る点が無い。送らない最寄りは先行点より手前で脚が後ろへ戻った）。先行が横切る街路をまず結び、それ以外は 45° の内の最寄りを候補の全点から選ぶ形にした。
- F2: 「目標の最寄りを届く区間で取る」を常にすると、既定データ（main）の auto-shiodome-shibakoen が浜崎橋で止まった: 地図の作り直しで車が同じ床版に載る 45021972 に locate され、その run の遠い端へ向かう経路が null でなくなったので、bestStart が隣の 45021976 を試さなくなり、車がその経路で 45021972:2 の端に止まった（xwStopping）。経路を 1 秒ごとに追い、main の navigation.ts に戻すと t = 26 s の作り直しで 45021976 のままになることで確かめた。取り直しは今までの目標に経路が無いときだけにした。

レビューで直したもの: (b) の「無ければ最寄り」が (c) より先に効いて、足の内側を斜めに横切る街路で接続路が折り返した（70° で約 128°、50° で約 139°）→ 順序を上の表のとおりに。F2 で地図の内の目的地に届かない経路を返した → null に。走行の標本が locate（本線優先）だった → A。足の 1 m 判定を挿入した頂点の実座標で。

## 横にしか街路が無い足（250488080:end の設計判断）

レビュー後の f71-pruned で 250488080:end（盛土の出口）だけが `turns-back`（108°）になった: 幅 9 m の街路が床版の右 7〜8 m を並走して足の横で 45° に離れていき、45° の内にも足の内側にも結ぶ点が無く、最寄りは端面の前 0.08 m・15 m 右だった。設計の決定は「(b) の最後の段の候補を先行点より前（out ≥ `LEAD_M`）に限る」: 脚は定義から 90° 以下（T 字）、そこにも届く点が無ければ `ramp_unattached`。新しい閾値は足さない。Why not unattached: 壁を横切らない道があるのに出口が使えなくなる。Why not 先行を伸ばす: 街路は 45° で離れていくので 45° には入らない。

f71-pruned の脚が 45° を超える足（4 本）:

| 足             | 角度 | 脚の長さ（先行点から） | 形                                                                                                       |
| -------------- | ---- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 250488080:end  | 90°  | 17.98 m                | 並走して足の横で離れる幅 9 m の街路                                                                      |
| 55555911:start | 89°  | 13.13 m                | 足と平行に left −13.2 m を走る幅 4.3 m の街路（45° の内の点は到達距離の外）                              |
| 46876171:end   | 87°  | 13.75 m                | 左 14〜16 m の国道（GSI の高速道路の線が足の軸を out 約 35 m で横切るが、先行点では 10 m 横で (a) の外） |
| 1176489869:end | 45°  | 7.93 m                 | 45° の境                                                                                                 |

## 確かめ（trust signal、2026-11-13、M2 Max、vite :5297）

- テスト: `pnpm exec vitest run` 170 files / 2,304 passed（8 skipped）、`tsc --noEmit`・`oxlint`（警告のみ、既存）・`oxfmt --check`・`bin/lint-justfile.sh`・`bin/lint-knowledge.sh` 通過。
- 足の探り（`just check-expressway-feet <dir> --cache-only`）: 既定データ（main）10 足・違反 0・steep 0（(a) 3・(b) 6・unattached 1 = 4853799:end、main の前から同じ）。f71-gen2 11 足・違反 0・steep 0（(a) 3・(b) 8・unattached 0）。f71-pruned 168 足（タイル無し 3）・違反 0・turns-back 0・steep 4（上の表）・unattached 1（383231007:end、7c1 の前の数え方で 2）。
- 既定データ（main）の走行 9 本（`just check-deck-drive f71-main all`）: 全部合格（停止 0）。|dy| は shibakoen-shiodome 0.090、auto-shibakoen-shiodome 0.088、auto-shiodome-shibakoen 0.111（2,524 m）、rainbow 4 本 0.072〜0.078、daiba-exit 0.116、azabudai-tunnel 0.090 m。
- f71-gen2 の 3 本（走行のあいだだけ public/data/expressway に置き、7c の deckRoutes で、済んでから両方を main に戻した）: 全部合格・停止 0。shibakoen-shiodome |dy| 0.093 m、auto-shibakoen-shiodome |dy| 0.097 m・到着（A の前は 1.601 m at 45068170:0: 車は 24402125:2 のランプを一定に降りていて、`nearestOnSurface` が `SURFACE_GATE` 2.5 m の内の 2.46 m 下にある本線 45068170:0 を `deckRank` で選んでいた。maxShortfallAt も 45068170:0 から 24402611:31 へ）、auto-shiodome-shibakoen |dy| 0.108 m・2,524 m・到着。
- 街路の走行（f71-gen2）: 23705286:0 の掘割の壁際の両側は落下 0・到着・`expressway_car_stalled` 0。7c の 13 か所は 7c の記録と同じ（azabudai-north-portal-over と kasumi-24402611-75 が到着しないのも 7c と同じ）。足の掘割 203832842:1 の右で車が描かれる地形より 5 m 下・stalled 2 件だったのは、7c1・7c2 由来ではなく、道具が車を幅 40 m の街路の中心線に置いて P9 の掘割 737538573:0 の穴に落ちたもの（道具の「到着」判定が効いていない。道具の修正は 7c で）。

## p7c2-gen1（7c2 の前のデータ）で止めたこと（記録）

7c2 の前のデータでは auto-shiodome-shibakoen が入口の足 23705286:start で止まった（0.2 秒ごとの追跡で、車体の底の後ろが足の外 2.5〜3.0 m・足の路面より 0.6 m 高い地面に載る。足が街路の車道の中にあり、接続路が 3.02 m と短かった）。7c2 で足が街路の縁で切られ、f71-gen2 では起きない。

## 7c・R へ回すもの

- 7c（台帳）: 脚が 45° を超える足を新しい類型 `foot-side-join` に 1 件ずつ（measured: 角度・脚の長さ・街路の幅）。規則では通さず、ship の視点つきレビューで判断する。既定範囲は 0 件。
- R1: `roads.ts deckRank` の見直し（ランプが下の本線の `SURFACE_GATE` の内を通る所で、locate が本線を答える。7c1 は測りだけ経路の区間で引き直し、ゲームの locate は触っていない）。足の先の地上部を OSM から取る（コンパイラが足の先の地上の連結路・つながる街路の点を出力し、実行時はそこへ結ぶ。GSI と OSM の街路が 13〜15 m ずれる上の 3 本はこれで直る）。(a) の拡張（足の軸を先で横切る GSI 高速道路の線を地平部として拾う、46876171:end）。

[^p276-7c1]: 指示は scratchpad の p27/s6-pr7c-feet.md の 8・9 節、p27/review7c1/（レビューの境界の再現 f1-edge.mts、turns-back.md、near-foot.mts）（設計 Fable）。計測のスクリプトと出力は scratchpad の p27/feet7c1/（feetscan.mts・route-trace.mts・foot-trace.mts・foot-contacts.mts・street-drive.mts・drive3.sh と各 .jsonl・.txt）、計測フォルダは .cache/expressway-area/f71-gen2・f71-pruned、走行の記録は .qa/drive-deck-f71-*.json（ローカル、git 管理外）。新しいデータでの走行はデータを一時的に public/data/expressway に置き 7c の deckRoutes.ts で走らせ、済んでから両方を main に戻した（git status で差分なし）。

# P2.7-6 PR 7c: 網をつなぐ（既定の切り替え、2026-11-13〜14）

既定の生成を高さの構造・地平 run・touchdown all・companions に切り替えた。7c0（地下・掘割の分合流は S7）・7c1（ランプの足の実行時）・7c2（足を街路の縁で切る）を main に入れた後で rebase し、既定範囲を作り直した。前半の節は rebase 前の記録で、「rebase 後（7c1・7c2 の上）」から後が今のデータの記録。[^p276-7c]

## 既定の切り替え（scripts/expressway.ts・expresswayGuards.ts）

- 既定は `--structures height`・`--ground compile`・`--touchdown all`・`--companions on`（重み 1）。
- 逆の値（tags・skip・mains・off）と `--companion-weight` は `--out` 必須。
- `--ground`・`--touchdown`・`--companions` の既定は `--structures` に従う。`--structures tags`（+ `--out`）だけで 7c の前の生成になる。理由は、height 以外で `--ground compile` だとエラーで止まるのと、旧データと全ファイルで比べられるようにするため。
- 入口の条件は満たした（p7c-gen1、2 回の生成がバイト一致、7a2 の採ったフラグの生成と全ファイル一致）:
  - 低い径間 6 本、wideCuts は 405795846 だけ、streetsUnder 0、violations 0、探りは 0。
  - 405795846:0 s 145.6 の街路（幅 16 m、GSI でトンネル）は、両側が道路網でつながっていて迂回は 2.37 km（.qa/detour.mts、GSI の道路網を半径 1.5 km で読んだ）。7c0 でこの run が消える見込み。

## seam_step の滑る帯の規則（ユーザーの承認、PR 5 の (A)）

- **規則**（allowlist.ts `SEAM_SLIDE_*`、ledger.ts `isSlidingSeamStep`）: 1〜2 測点（0.5 m 以内）で、データの |Δz| が MERGE_FULL_DZ 0.05 m 超 MERGE_MAX_DZ 0.15 m 以下、段 ≤ 0.17 m（MERGE_MAX_DZ + 弦の許容 0.01 m × 2）、内側の面 ≤ 0.01 m なら規則で通す。
- 判定に要るので、seam_step の measured にデータの |Δz| の範囲（minDzM・maxDzM）を足した。足す前に測った case は規則で通らない。
- 止める条件「20 mm 超」は、その帯の規則が許す段からの超過で読む。一体の継ぎ目は今までどおり絶対値で読む。「open 2 件まで」は、規則で通らない seam_step で数える。
- **数**（ship/pruned、p7c-pruned の同じタイルで旧コードと新コードを比べた）:
  - seam_step は new 69 → new 44・規則 25。設計の見込み 13 件前後は、PR 5 の (A) を数えた時点の数え方。
  - 規則に移った 25 件は、どれも 1 測点で、|Δz| 0.1416〜0.149 m、段 0.1512〜0.161 m、内側 0〜8.5 mm。規則は本数に合わせて狭めない（コーディネータの判断）。
  - 残る 44 件は (A2)（段 0・内側 0.15 m 前後）、長い区間（4847519・906610080・1483413151 など）、一体の継ぎ目の段。
  - 既定範囲では、7c の生成で止めた 4 件（24402125:0|24402611、45019020:40|45554540、45554540:34|24402611、4853798:1|45021976）がすべて規則の内。
- **台帳の道具**: 規則が review の判断を引き継ぐときは、元の判断を `previous` に残す（ledger.ts updateLedger）。public の台帳の seam_step:24402125:0|24402611|0 は by rule になり、元の review の理由（手放しの点の 3 cm 手前の 1 測点、段 160.4 mm）と cap は `previous` に、qa は `expressway/seam-24402125-0` のまま残る。

## データテストの P9 の橋脚（設計の判断: 9 本で正しい）

- 既定データでは、24402611 の s 700〜1800 の橋脚が 10 本 → 9 本になった。s 430 の次が 1050 → 1085 で、s 1085〜1404 の 9 本は前と同じ位置。新しいデータには、24402611 が 24402014 の上に立つ区間（above、s 1007.68〜1047.71）が足された。24402014 は既定範囲では出力されない run（ship では出力される）。
- 下に別の床版がある所に橋脚を立てないのは今の規則どおりで、範囲に依らない（T8）。
- テストは理由から導く形にした: s 1085〜1405 に 9 本・最大の間隔 90 m 以下。s 1050 に橋脚が無いのは、その ±5 m に 737538573 以外の run との above の区間があるときだけ。
- タイルで見た s 1050: above の区間は 737538573（932.63〜1098.73）だけで、24402014 の区間は 1047.71 で終わる（1050 から 2.3 m）。cross・blocked の道路は ±20 m に無い。「道路から移した先が 24402014 の床版に当たる」は、移す元の道路がタイルに残らない（OSM の物体の除外帯は書かれない）ので、タイルだけでは確かめられない。候補位置ごとの表は .qa/p7c2-piers.jsonl。
- R へ: 道路から移すとき近い側だけを試して諦める点（もう片側を試さない）。s 430〜1085 の 655 m に橋脚が無い点（出荷データでも 620 m）。

## 作り直す前の走行（p7c-before）

- 9 経路すべて合格（落下・停止・交差 0）。max |dy| は 0.073〜0.115 m（daiba-exit が最大）。
- 1 回目の `all` は 8 経路目（daiba-exit）で `__game is not defined` で止まった。単独で走らせ直すと再現しない。そのころ同じ worktree の src/expressway を編集していて、開発サーバー（vite）が読み直したのが原因と見ている（確かめてはいない）。

## 作り直した後の走行（p7c2・p7c2b、2026-11-13）

経路 (2)（1 号羽田線の地平 run の seam）と (3)（汐留の取付け）を足した（`haneda-up-seam`・`haneda-down-seam`・`shiodome-approach-in`・`shiodome-approach-out`）。経路 (1) は足さない（7c0 で東京港トンネルを出さない）。自動運転の 2 経路は、入口の足が地平 run になったので `entrance` を 207111988 → 861095931、45068172 → 23705286 に替えた（前の値のままでは足の街路の接続が見つからない）。

| 経路                                       | 前（p7c-before） | 後                                                             | max \|dy\|（後） |
| ------------------------------------------ | ---------------- | -------------------------------------------------------------- | ---------------- |
| shibakoen-shiodome                         | 合格             | **停止 1・\|dy\| 0.163 m・24.6 km/h の落ち込み（45068171:1）** | 0.163            |
| auto-shibakoen-shiodome                    | 合格             | **到着しない（no route）**                                     | —                |
| auto-shiodome-shibakoen                    | 合格             | **停止 1・\|dy\| 0.213 m（203873824:0）**、到着はする          | 0.213            |
| rainbow-upper-east・west、lower-east・west | 合格             | 合格                                                           | 0.072〜0.079     |
| daiba-exit                                 | 合格             | 合格                                                           | 0.117            |
| azabudai-tunnel                            | 合格             | 合格                                                           | 0.073            |
| haneda-up-seam・down-seam                  | —                | 合格                                                           | 0.074・0.073     |
| shiodome-approach-in・out                  | —                | 合格                                                           | 0.074・0.074     |

- 落ちた 3 本は、どれもランプの足（地平 run の地表端）で起きた:
  - 汐留出口: 24402125 → seam → 地平 run 45068171（25 m）の終わりの 45068171:1 で、地表端の 2 m 手前で 1 km/h まで落ちて止まる（`expressway_car_stalled`、touching other 1）。45068171:1 は路面が地表より 3.2 cm 低いだけで「掘割」に分けられている。
  - 自動運転の汐留入口の 1 回目（entrance が 45068172 のまま）は、足の街路 s 48.7 m（35.663237, 139.762874）で 30 → 0 km/h（`drops`）。そこは 23705286:0（路面が地表より 3.1 cm 低い掘割）の始まりから 5 m。
  - 芝公園出口: 4853798 → 地平 run 203873824（16 m、盛土）の 203873824:1 で止まる。
  - auto-shibakoen-shiodome の no route は、目的地（汐留出口の足の街路）への経路が引けないこと。汐留出口の足（45068171 の地表端）が街路とつながっていない疑い（確かめていない）。
  - 地平 run の地表端のチャンクで深さ 0 付近が掘割になっているのは 45068171:1・23705286:0・203832842:1 の 3 本。
- 街路の走行（`.qa/street-drive.mts`、自動運転で街路を 40 m 手前から 40 m 先まで）: 麻布台の北の坑門の上の道 2 本、盛土の壁際 5 本、霞が関の低い径間の下 6 本。落下 0、建物との交差 0、停止 0。到着しなかったのは 2 本（坑門の上の幅 40 m の道、24402611 s 75 の幅 50 m の道で respawn 1）で、どちらも動き出さないか経路を引けなかったもので、原因は見ていない。24402611 の始まりの盛土の壁際では、他の車との事故が 1 回あった。

## 撮影のラウンド 1（2026-11-13）

- expressway 315 コマ（失敗 0）、expressway-tunnels 22 コマ（失敗 0）、expressway-signs 52 コマのうち 4 コマ失敗（その周は数えない）。
- 足した視点: kasumigaseki（霞が関の低い径間）、shiodome-approach（汐留の取付け・低い高架）、haneda-ground（1 号羽田線の地平 run）、overlap-pairs（重なりの組 7 つ・low-clearance 2・ramp-radius 1）、main-embankments（本線・ランプの盛土の端面・薄い桁・並走の先細り・ground-crossing）。描かれる距離に収めるため、目標が 600 m より離れる視点は別のセッションに分けた（`.qa/newviews.cjs`）。
- 既存の視点のチャンク ID は run 距離で付け直した（`.qa/remap.cjs`）。標識の 325 は入口の足の地平 run 861095931 に移った。
- **標識の失敗 4 コマ（103・104、芝公園入口）**: 入口が地平 run（23705286・861095931）になり、タイルの入口から路線（`route`・`routeName`）が消えた（前は C1・都心環状線）。103・104 が芝公園の入口の前に立たない。入口の路線を seam の先までたどらない疑い（確かめていない）。

## 台帳の case は範囲の run だけ（設計の判断）

- 台帳の case にするのは、そのフォルダの範囲の run（出力された run と、範囲の内で閉鎖された run）の診断だけ。成分を解くためだけに解いた run の診断は case にしない。その run の判断は、それを出力するフォルダ（ship・R1〜R3 の地区）の台帳でする。
- record（report.json）には全部残し、範囲の外の run の診断に `outside: true` を付ける（format.ts `XwDiagnostic`）。スコアカードに範囲の外の診断の件数を類型ごとに出す（report.ts `diagnosticsOutside`）。
- case を作る所（expresswayCases.ts `countCases`）と、「規則で通るものも全部 case」のテスト・T10・deck_overlap のテストは同じ絞りで読む。
- 確かめ（既定範囲。public のフォルダの写しに同じ印を後から付けて台帳を更新した、.cache/expressway-area/p7c3-narrow）:
  - new 94 → 53（出力される run の分）。gone は 29 → 71。
  - 新たに消えた 42 件はすべて出力されない run の key: new 41（portal-open-cut 32・ramp-radius 8・layer-ambiguous 1）と accepted 1（ramp-radius:203873831、出力されない連結路）。出力される run の key は 1 件も消えていない。
  - report.json の診断 842 件のうち 791 件が範囲の外。
- ship/pruned（p7c2-pruned の写し、public の台帳を seed）: 2,171 件（new 1,058）→ 2,148 件（new 1,035）。消えた 23 件（portal-open-cut 18・ramp-radius 5）はすべて範囲の外の run。閉鎖された run（6 本）の診断は残る。

## 「36 件が消える」見込みとの突き合わせ

- 7c0 のレビューの 36 件の一覧は手元に無い。数が合うのは、7c0 の前の既定の台帳（p7c-gen1-ledger）の portal-open-cut 35 件と seam_hole 1 件の合計なので、これを 36 件と読んだ（確かめてはいない）。
- 7c0 の前後で実際に消えた 7 件: ground-stretch 3（1059139534・405795846・4848757）、portal-open-cut 3（4854085・5170834・5213283）、seam_hole:4848757:0|4854085|0。
- 36 件のうち消えたのは 4 件（portal-open-cut 3・seam_hole 1）、残ったのは 32 件（portal-open-cut）。32 件はすべて、出力されない run の 41 件の内にある。41 件の残り 9 件は ramp-radius 8 と layer-ambiguous 1（成分のほかの場所）。
- 出力される run の key は、残った方に 1 件も無い。

## rebase 後（7c1・7c2 の上）

- main 5890914（7c1 #84・7c2 #83）に rebase し、既定範囲を新しい既定で作り直した。2 回の生成はバイト一致。run 29 → 28（下の 203832842 を外した後）。
- 足の探り（`just check-expressway-feet`）: violations 0、45° を超える脚 0（foot-side-join は既定範囲で 0 件）。

### 所見 1: 内回りの車線 0 で止まる（汐留出口の壁高欄）

- 走行 shiodome-approach-out の車線 0 の車は 24402611:33 の s 22.3（run s 4948.8）で 47.6 → 2.8 km/h に落ちて止まる（3 回とも）。接触の相手は 24402125:0 のコライダーで、車体の左前の角（局所 0.92, ±0.38, 2.15）、法線は水平（`.qa/trace-stop.mts`、world.contactPair）。
- 汐留出口は内回りの左を中心間隔 6.77 m で並走し、手放しの点（run s 約 4951）から先で、出口の右の壁高欄の外面が内回りの中心線から左へ 2.27 m に立つ。車線 0 の車の左側面は 2.53 m で、約 0.25 m 掛かる。車線 1 は掛からない。台帳の parallel-ramp:24402125|24402611（7c の前から accepted）の重なりそのもの。7c の前のデータで止まらなかったのは、手放しの点が数十 cm 動いたため（推定）。
- 7c で本線が 45068170 へ続き坑口で行き止まりになったので、台帳の理由「本線は地表端で終わる」は成り立たない。parallel-ramp と merge_skipped 2 件を、理由を今の事実に直して new に戻し、視点（shiodome-lane0-driver・-overhead）で撮影のレビューに出した。
- 交通 AI と経路はこの区間に入らない: `reachesStreets` に 24402611 の分岐（run s 4857）より先と 45068170 が入らないことを、既定データで確かめるテスト（tests/expresswayTraffic.test.ts）。
- 走行の確認は車線 1 にした（deckRoutes.ts の cruise に `lane` の欄を足した）。

### 所見 2: 中央帯の掘割の穴に街路の車線が掛かる（203832842 は決定で外す、737538573 は R1）

- 7c の街路の走行で、車が中央帯の掘割の穴に落ちた（respawn）。GSI の街路をゲームと同じに組み、車線の中心（laneCentreOffset）が穴の縁 + 1 m に入る長さを測った（`scripts/expresswayHoleLanes.ts`、`just check-hole-lanes`）:
  - 203832842（飯倉出口の足の掘割、穴の半幅 2.875 m）: 幅 4.3 m の街路の 1 車線が両向き 9 m（最短 0.15 m）。
  - 737538573（P9 の掘割、半幅 4.75 m）: 幅 40 m の街路（片側 1 車線で組まれ、車線の中心が中心線の近く）が 65〜68 m（最短 0.01 m）、ほか 5〜21 m の区間が 6 つ。GSI の高速道路の線は除く（地平の高速道路そのもの）。
- 区間の一部の車線だけを走れなくする既存の仕組みは無い（Segment の車線数・断面は区間全体で一定、closures は区間ごとの通行止め、route_lane_blocked は黄線、駐車車は動的）。
- **ユーザーの決定**: 203832842 の地平 run（足）を R1 まで出さない。737538573 は R1（台帳の street-lane-over-cut に記録）。
- **一般の規則を試して取り消した**: 「並走（along）の足の地平 run を全部出さない」を cutFeet に入れると、網全体で 129 本が消え（along 141 → 12）、既定範囲の本線が 24402611 で最大 −1.89 m（s 1100〜1300）、45554540 で −1.46 m（s 5901）動き、45021972 が上がった。ユーザーの 1 件の決定を超える網全体の別の設計になるので取り消した。
- **決定の表**（`src/expressway/footDeferrals.ts` `FOOT_DEFERRALS`、設計の判断 A）: run・end・until・数値つきの reason・decidedBy user・decidedAt・release を持つ。行を足すのはユーザーの決定があるときだけ（表の冒頭に明記、3 行を超えたら R1 を前倒しする合図）。cutFeet は表にある along の地平 run を出さず（outcome `deferred`、隣の run はそこで地表端）、表の行が along でない足を指す・run が計画に残るならビルドを止める。スコアカードと report.json の `ground.deferred` に範囲の内の deferred を出す。
- 扱いが揃っていないのは決定による: 既定範囲の 1 件（203832842）だけを表で外し、ship の along の足は台帳の foot-along-street のまま R1 で扱う。
- 表から作った出力は、id で外した計測（p7c6-only）とタイル・meta がバイト一致。0.05 m を超えて動いた run は 3 本: 737538573 −0.343 m（s 78.9）、45021976 −0.296 m（s 3475.8）、24402611 +0.100 m（s 1846）。最急勾配がきつくなった run は無い。閉鎖・違反・未収束 0。地形の探り 0、wideCuts・streetsUnder 0。tags のビルドは main とタイル・meta が全一致（report.json は 7c の `outside` の印だけ違う）。橋脚は 737538573 の上の run も含めて前後で全く同じ位置。
- 737538573 が 0.34 m 動く理由: 203832842 と 737538573 は s 0〜32.5 で同一面の組だった（チャンクの decks の `same`、台帳の merge_skipped:203832842:1|737538573 と :0|203832842）。組が消え、737538573 の始まりが地平 run の帯に引かれなくなった。北側（:1 の s 108〜155）で路面が最大 0.23 m 下がり、南の坑口側（:2）では +0.03〜+0.17 m 上がった。
- 台帳: foot-along-street:203832842|end・ground-stretch:203832842・merge_skipped 2 件は gone（run が出ないため。理由は report.json の `ground.deferred`）。

### ship/pruned の 23273634（+2.33 ポイント、受けた）

- 表が 1 行の ship/pruned（p7c7-pruned）と空の版（p7c7-pruned-empty）: 本線の差が 1 m を超える run は 0（最大 737538573 0.343 m、23273634 0.32 m、45021976 0.296 m）、閉鎖 6 → 6、未収束 0。
- 203832842 の隣の高架 23273634（盛土 1 チャンク、s 0〜120.2、1 車線、上限 11.5 %）の端が seam（親 203832842、z 20.21、−0.59 %）から地表端（z 20.29、+3.50 %）に変わり、最急勾配が 1.17 → 3.50 % になった。止める条件（+2 ポイント）に当たったが、設計の判断で受けた: 上限 11.5 % の内、地形どおりの勾配（足の先の地表は登っている）、つながり全体では 203832842 の端の 9.85 % が無くなる。main の ship（tags、p7a2-main-tags-pruned）でも 23273634 の端は地表端・z 20.29・+3.50 % で、同じ形に戻っただけ。

  | s           | 表が空 z | 路面 − 地表 | 表が 1 行 z | 路面 − 地表 |
  | ----------- | -------- | ----------- | ----------- | ----------- |
  | 80.1        | 20.365   | 2.41        | 20.099      | 2.14        |
  | 100.1       | 20.312   | 1.19        | 20.039      | 0.92        |
  | 120.2（端） | 20.210   | −0.08       | 20.290      | 0.00        |

- 足の探り（p7c7-pruned、--cache-only）: 168 本・違反 0、23273634:end は結ばれる、unattached は 383231007:end の 1 本（表が空の版も同じ）、45° を超える脚は 3 本。ship の台帳の new は 1,089 → 1,086、増えた deck_overlap 2 件（nose:23273634|45021976・|737538573）は規則で accepted。

### 街路で車が 0.65 m 沈む件（24039751 の脇、前からの地形のずれ → R1）

- 7c の街路の走行（最初の置き方、中心線から幅 ÷ 4）で、24039751 の s 106 の左 11 m の幅 9 m の街路で、車の y 6.843・描かれる地形 6.925・街路の路面 6.737・真下の ray 5.99（車は路面より約 0.65 m 低いコライダーの上を普通の車高で走る）。
- 24039751 の s 105.5 の軸から左へ 0〜25 m を 1 m ごとに、main のデータ（vite の 2 本目）と 7c のデータで測った（`.qa/section.mts`）: 6〜25 m は ray の高さ・当たるコライダー（地形）・groundY・路面がすべて同じ。街路の上（9〜11 m）で、地形のコライダーは路面より 0.80〜1.28 m 低い（ray −1.417〜−0.955、路面 −0.133〜−0.135、local y）。違うのは 0〜5 m（7c の 24039751 の床版）だけ。前からある、急な地形で地形のコライダーと描かれる地形・街路の路面がずれる形（5.F と同じ）で、R1 に回す。街路の上でコライダーが路面より高い所は無い。

### 盛土に掛かる街路の車線（ユーザーの選択 A: 高い所は高架に戻し、低い所は台帳）

- 街路の走行で盛土の脇の車線が見つかり、GSI の街路をゲームと同じに切った後の車線の中心が、盛土の床版の縁の内を通る所を数えた（`scripts/expresswayLanesProbe.ts`、`just check-expressway-lanes`）。main（tags）ではこれらはどれも高架だった。
- 振り分けの物差し: main の桁下 − 地表（路面 − 桁高 − 地表、`.qa/soffit12.mts`）。区間の全長で 2 m 以上なら「main では車線が下を通れた」所として決定の表で高架に戻し、1.5 m 未満を含むなら「main でも通れなかった」所として台帳で受ける。

  | 所                                                  | 街路の幅  | main の桁下 − 地表 | 7c の路面 − 地表 | 扱い         |
  | --------------------------------------------------- | --------- | ------------------ | ---------------- | ------------ |
  | 895902565:0 区間 815（s 57.6〜71.9）                | 40 m      | 2.09〜2.99         | 4.27〜5.17       | 高架に戻す   |
  | 895902565:1 区間 771・813・815（s 71.9〜89.2）      | 16・40 m  | 3.00〜4.00         | 5.19〜6.18       | 高架に戻す   |
  | 45021976:22 区間 650（s 3410.6〜3411.8）            | 40 m      | 3.87〜3.93         | 6.21〜6.27       | 高架に戻す   |
  | 45021976:23 区間 658・659・661・662                 | 4.3・40 m | −2.18〜1.97        | 0.03〜4.45       | lane-in-site |
  | 895902565:0 区間 817（s 22〜57）                    | 40 m      | −0.61〜2.07        | 1.58〜4.25       | lane-in-site |
  | 4848755:0 区間 188・212・215                        | 4.3・9 m  | −2.20〜2.02        | 0〜4.22          | lane-in-site |
  | 24402611:0（幅 50 m、s 32〜58／幅 4.3 m、s 27〜28） | 50・4.3 m | −1.33〜−0.01       | 2.47〜4.13       | lane-in-site |
  | 895902565:7（s 877〜910）                           | 50 m      | −0.83〜0.38        | 2.42〜4.48       | lane-in-site |

- 最初の数え（`.qa/emblanes.mts`）は、いちばん近い交差が cut（敷地の縁で切られる）の車線を除いていたので、下の 3 行（24402611:0 の 2 本と 895902565:7）を漏らした。実際には切られた街路の残りが盛土の脇を並走していた。今の探りは交差の種類で除かない。
- **構造の決定の表**（`src/expressway/structureDecisions.ts` `STRUCTURE_DECISIONS`、2 行: 895902565 s 57.6〜89.16、45021976 s 3410.6〜3414）。行を足すのはユーザーの決定があるときだけ、4 行を超えたら R1 を前倒しする合図。コンパイラは表の区間の盛土だけを高架にし（`decideViaduct`、ならしの後、掘割は替えない）、表の区間が高さから盛土でなければビルドを止める。T13 は表を読む。スコアカードの `structures.decided`。Why not OSM の地上道路で窓を作る規則（設計の 1 案）: 試算で、OSM の窓は 13 か所のうち 1 か所の一部（15 m / 42 m）しか覆わず、高架が OSM の道路に沿う所（24402611 s 0〜730 など）に広く出た。Why not 低い所も高架に: 床版は低いまま（main でも桁が地面に埋まっていた）で、車線は通れない。
- 結果（既定範囲）: 測点の z の差は最大 0.001 m。895902565:1（s 57.6〜71.9）と 45021976:22（s 3411.76〜3414）が高架になり、高い 5 区間の車線は探りから消えた。残る 9 か所はすべて lane-in-site（探りの上限 9）。地形の探り 0、足の探り 違反 0。
- 橋脚: 高架にした 895902565 の s 70 に 1 本。区間 815 の下り車線の中心から 0.8 m。main の既定データにも同じ s 70 に立つ（5.B と同じ型: 並走する街路の中央帯に立つ橋脚）ので受けた（low-viaduct:895902565|0 の理由、視点 decided-895902565-pier）。窓の内に橋脚を置かないと径間が 35 m を超えるので、それはしない。
- 走行 13 本はすべて合格（max |dy| 0.073〜0.117 m、停止 0）。高架に戻した 2 区間の下の街路（895902565 s 80・45021976 s 3412）の街路の走行で、落下・沈み 0（車の高さ 0.69〜0.89 m）。視点は main・前・後の 3 枚ずつ（`.qa/views-decided/{main,before,after}`）。
- ship/pruned（p7c9-pruned、表が 2 行）: 表の前（p7c7-pruned）との z の差は最大 0.001 m、盛土の総延長 43.163 → 43.128 km、閉鎖・違反・未収束は増えない。tags のビルドは main とタイルが全一致。
- 台帳: lane-in-site 9 件（new、撮影で決める）、low-viaduct:895902565|0（高架に戻した区間、new）。前の low-viaduct:895902565|0（低い径間の窓）は番号が |1 になり、値が同じなので判断を持ち越した。

### 台帳の締め直し（撮影ラウンド 2・3 の判定の後）

- new 15 件は Fable の判定（ユーザーの選択）で、14 件を撮影ラウンド 2、low-viaduct:895902565|0 をラウンド 3 で受けた（判定の写し: scratchpad の p27/review7c1/7c-ledger-r2.json・7c-round3.json）。gone 4 件（203832842 の 4 件）は --prune で落とした。
- budget の差分（--write-budget の前、すべて 7c で説明がつく）: foot-along-street 1 → 0、ground-stretch 10 → 9、merge_skipped 48 → 46（どれも 203832842 を決定で外したため）、low-viaduct 4 → 5（決定で高架に戻した 895902565 の区間）、lane-in-site 0 → 9（新しい類型、低い 8 区間 + 3）、street-lane-over-cut 0 → 1（737538573、R1）、規則の vertical_fallback 9 → 8（203832842 の分）。
- 締めた後、台帳 140 件（accepted 136・wontfix 4）、全テスト通過、tsc 0。

### 霞が関の respawn 1 回

- 2026-11-14 の街路の走行で、kasumi-24402611-75（24402611 s 75 の幅 50 m の街路から）の車が目的地から 237 m 外れた所へ走り、どこかで respawn した（場所は分からない）。同じ場所から走らせ直すと沈みは無かった（最小 0.785 m）。2 回目が出たら報告する。

### 麻布台の穴の形（737538573:2、+284 m²）

- 穴の規則（below.ts isHoleAt）は「地表 − 路面 < 内空高 5.3 + 頂版 0.8 + 0.6 = 6.7 m」。閾値をまたいだ測点は 2 つ:

  | s      | チャンク    | 地表 − 路面（前 → 今） | 穴（前 → 今）                                      |
  | ------ | ----------- | ---------------------- | -------------------------------------------------- |
  | 134.47 | 737538573:1 | 6.698 → 6.821          | 内 → 外（孤立した 1 測点で、多角形は前後とも無い） |
  | 472.67 | 737538573:2 | 7.281 → 7.197          | 外 → 外                                            |
  | 492.67 | 737538573:2 | 6.721 → 6.650          | 外 → 内                                            |
  | 512.67 | 737538573:2 | 6.170 → 6.113          | 内 → 内                                            |

- チャンクごとの穴: :0 は 28 頂点・1,099 m² で同じ、:1 は前後とも無し、:2 は 12 頂点・1,189 m² → 14 頂点・1,473 m²（測点 1 間隔 20 m 延びた）。boreHoles は続く 2 測点以上で多角形を作る（孤立した 1 測点は空、テスト）。
- 延びた 20 m の上（`.qa/holecheck.mts`・`.qa/bldg20.mts`、前のデータと今を同じ地点で起動）: `street_cut_at_expressway` に新しい行は無い（203832842 の 2 行が消えただけ）。帯（±9 m）に建物の頂点は前後とも 0。40 m 内の歩道の多角形は 14 件・1,448 m² で同じ。俯瞰の視点で覆いに段・隙間は見えない（`.qa/views-hole/{head,new}`）。
- テスト: 3 つの数字を今の値に直し、穴の多角形が isHoleAt の続く 2 測点以上の集合と一致する検査を足した。
- R1・S7 へ: 穴の縁は測点（20 m）の上にしか置けないので、路面が 7 cm 動くと縁が 20 m 跳ぶ。閾値をまたぐ点を測点の間で補間して縁を置く形に直す（main からも穴の形が変わるので 7c では触らない）。

### 台帳

- (a) ground-stretch の cap は CAP_FIELDS の 3 項目のまま、cap にはその事例が測った項目だけを入れる（24402609 は approachMaxM だけ）。判定に「cap に無い CAP_FIELDS の項目を今は測っている → 外れ」を足した（withinCap の kind、テスト 3 本）。
- (b) merge_skipped:45554540:33|45021972（companions on で 3.28 → 3.50 m）は new に戻し、視点を付けて撮影でレビューする。
- (c) foot-side-join（脚が 45° を超える足、cap は angleDeg +2°・legM、規則で通さない）を採った。探りの `--cases` と台帳の道具の `--feet` で載せる（既定範囲 0 件）。
- street-lane-over-cut（新しい類型、cap は lengthM、規則で通さない）: 737538573 を new で記録した（`just check-hole-lanes --cases` と台帳の道具の `--lanes`）。
- 5.B（895902565 の窓の手前の橋脚の実寸）・5.C（45068169|45068170 の上限）・24402125|45068170 の locate は理由に書いた。

### 5.E・5.F・S2

- 5.E: 45021976:0 から 30 m 内の歩道の多角形は、7c の前のデータでも今のデータでも 10 件・5,982 m²。`pavementsOffCuts` が歩道を消している疑いは当たらない（`.qa/pave5e.mts`）。
- 5.F: 24039751・24402609 の周りの地形の破片は、7c の前のデータ（vite の 2 本目で `.cache/expressway-area/p7c-before` を配った）でも同じ位置に出る。7c 由来ではない → R1。
- S2: 横切る街路では、左折で入る向きの左の路端に 103-A（矢印 = ランプの角度、左折で +90）と 104 を立てる（entranceBoards.ts `entranceArrowDeg`）。

### 走行の道具が止まった件（7c の変更とは関係ない）

- 2026-11-13 夜、走行が 80 分ずつ 2 回止まった。止まった時刻に、ページで PLATEAU の建物の 3D タイルのルートの tileset の取得が `TypeError: Failed to fetch`（buildings.ts の loadRootTileset）。同じ日に外の API の ENOTFOUND もあり、外のネットワークが途切れ途切れだった。vite は応答していた。
- 道具を直した: DevTools の呼び出しに上限（`CALL_TIMEOUT_MS` 180 s、scripts/qa/browser.mjs）、投げた試行は invalid（理由つき）で撮り直す（drive-deck.ts）、プロセスが終わる・SIGINT/SIGTERM/SIGHUP を受けると起動した Chrome を閉じる（10〜12 時間前の headless Chrome が 3 つ残っていた）。合否の判定は変えていない。

# A2: PR #85 のレビューで R1 に回した整備（テストと道具、2026-11-15）

既定のタイルは変えていない。絵も変わらないので、撮影はしていない。`ledger.json` で変わるのは lane-in-site 9 件のキーだけ。

## 直したもの

1. **標識のテストの「地表より下」**（`tests/expresswaySigns.test.ts`）: 掘割の標識と、`decks` の `same` の区間の内にある盛土の標識は、地表と比べない。それ以外（高架と、`same` の外の盛土）は `sign.z ≥ 地表 − 0.01 m` を求める。前の版は、盛土を「地表 − 帯（1.5 m）」で見ていた。
   - 理由: `same` の組の掘割は 2 枚で 1 枚の床版なので、盛土として描く（`heightStretches` の規則）。盛土が地表より下にあるのはその区間だけ。24039751:0 は `same` の内で地表の 1.70 m 下にあり、1.5 m の帯も超えている。前の版のテストが通っていたのは、標識がたまたま浅い測点に立っていたから。
   - 前提を押さえるテストを足した。盛土の測点で地表 − 0.01 m より低いものは、`same` の内にあるか、T5 が見る端の測点（run の最初か最後の測点で、端が `ground` か `portal`）のどちらか。端の測点は地表に合わせる点で、その許容は T5（`checkGroundEnd`）が持つ。そこでこのテストは端の測点を数えず、代わりに `checkGroundEnd` を掛けて違反が無いことを確かめる。
   - 端の測点に当たるのは、今は 24402609:0 の s 0 だけ。坑口の端が地表の 0.030 m 下にあり、`GROUND_END_BAND` 0.04 m の内、T5 の 0.05 m の内にある。
   - Why not 端から n m を除く: 端の測点より内側は T5 の対象でなく、地表にも合わせていない（24402609 は 12 m 先で地表の 1.67 m 上）。
   - S7-2 で坑口の端が地下 run への seam に変われば、この端は `portal` でなくなる。テストは端の種類で対象を決めているので、直しは要らない見込み。
   - 残る懸念（直していない）: 標識が T5 の端の測点の真上に立つと、標識のテストが落ちうる。今の既定データに該当は無い。
2. **lane-in-site のキー**: `lane-in-site:<run>|w<街路の幅>|<n>`。n は、その run の同じ幅の場所を `s0` の順に 1 から数えた番号（`scripts/expresswaySiteLanes.ts sitePlaceKeys`、`expresswayCases.ts laneInSiteCases`）。前のキーは `<チャンク>|<丸めた s0>-<丸めた s1>` で、作り直しでチャンクの番号や区間が 1 m ずれるたびに gone + new になっていた。
   - Why not 街路の ID: GSI の `RoadLine` に安定した ID が無い。
   - Why not 緯度経度の丸め: 場所の広がりは床版の位置で動くので、丸めた点が境をまたいで変わる。
   - 限界: キーは場所を名指ししない。同じ run・同じ幅で場所が増えたり減ったりすると後ろの番号がずれ、ずれた場所が、別の場所のために判定したキーを引き継ぐ。
     - 訂正（PR #88 のレビュー）: 前は「ずれた分は gone + new になる」と書いていたが、誤り（設計の見込み違い）。cap が `lengthM` だけだったので、`updateLedger` は、キーが同じで長さが cap + 5 m に収まれば、別の場所にも accepted を引き継いでいた。
     - 例: 24402611 の幅 4.3 m の場所が消えて s 900〜906 に出ても、accepted のまま残った。4848755 の幅 9 m の 1 つ目が消えると、2 つ目が 1 番になって 1 つ目の判定を引き継いだ。
     - 直し: `CAP_FIELDS["lane-in-site"]` を `["lengthM", "s0", "s1"]` にした。9 件の cap に measured の s0・s1 を足した（レビュー Fable の判定）。区間が cap から外れれば（始まり −5 m・終わり +5 m の余裕の外）、new に戻る。上の 2 つの筋書きは `tests/expresswayLedger.test.ts` で new に戻ることを確かめた。
   - 探りのまとめ方も、チャンクごとから run ごとに直した。同じ run・同じ幅で、`s0 ≤ 前の s1 + 1 m` なら 1 つにまとめ、`chunk` の欄には `s0` を含むチャンクを残す。チャンクの境をまたぐ場所が 2 件に割れることは、もう無い。
3. **探りの判定を純粋な関数に**（`scripts/expresswaySiteLanes.ts` の `laneOverSite`・`mergeSitePlaces`、`tests/expresswaySiteLanes.test.ts`）。判定は「車線の中心が床版の縁の内（`dist ≤ edge`）を 3 m 以上通り、床版の最初と最後の測点から 0.5 m の内は数えない」。
   - `scripts/expresswayHoleLanes.ts` の判定は形が違うので、共通にしていない。穴は端面を除かず、最短の距離を縁の外の点からも取り、`half + SITE_MARGIN_M` で見る。
4. **`perf-deck.ts`** は、車を置く場所を run と距離で書く（`{ run: "24402611", s: 2177.46 }`）。値は 652515b の 24402611:15 の最初の測点 2164.88 m に、長さ 20.97 m の 0.6 を足したもの。経路表と同じ `chunkAt` で、配るデータからチャンクと割合を引く。
5. **`withinCap` の `kind` を必須に**: 省くと「その類型の `CAP_FIELDS` にあって、今は測っているが cap に無い項目は外れ」の検査が掛からなかった。高い床版のテストの cap には、`CAP_FIELDS` の `s0`・`s1` を足した。
6. **構造の決定が盛土の端に残す切れ端の検証**（`heightStructures.ts` の `snapDecisionWindows`・`shortLeftovers`、`compile.ts structuresByHeight`）:
   - 行の端は cm で書いてあり、高さから決まる盛土の端とは `DECISION_END_TOLERANCE_M`（0.5 m、`structureDecisions.ts`）の内で合うものとして読む。この 0.5 m は、行が古くなっていないかの確かめ（行の両端から 0.5 m 内側を見る）がもともと使っていた値に、名前をつけたもの。
   - 行の端が盛土の内側 0.5 m 以内にあれば、窓をその盛土の端に合わせてから `decideViaduct` を掛ける。掘割や高架の境へは動かさず、窓を縮めることもしない。スコアカード（`structures.decided`）には、行の値をそのまま書く。
   - それより内側で、窓の端に接して残る盛土が `HEIGHT_STRUCTURES.smoothM`（20 m、ならしの長さ）に満たなければ、ビルドを止める。文言には run・行・残った区間と長さが入る。
   - 見つけたこと: 895902565 の行（s1 89.16）の盛土の終わりは 89.164 で、4.2 mm の盛土が 2 つの高架の間に残っていた。タイルには出ていなかった（チャンクの境は近くの節点へ寄せられる）。窓を合わせて、この切れ端を無くした。
   - 訂正: 指示書は最小の長さに `cut.minLengthM`（10 m）を読むとしていたが、誤り。10 m は、掘割がならしで消えないための長さ。この検証は「ならしの後に決定を掛けるので、残った短い区間を誰も均さない」ことの番人なので、ならしと同じ `smoothM` を読む。
   - Why not 0.5 m を超えて自動で延ばす: 行はユーザーの決定の写しで、行の精度を超えて延ばすと、決定と出力が食い違う。
   - 同じ 10 m が `cut.minLengthM` と `RAMP_FOOT.minRunM` に別々に書かれている。まとめていない、という記録だけ残す。

## 確かめたこと（trust signal、2026-11-15、M2 Max）

- `just make-expressway-data`（窓を合わせた版）の後、`git status public/data/expressway` は空だった。タイル・`meta.json`・`report.json`・`ledger.json` が main とバイト一致。合わせる前（切れ端を列挙するだけで止めない一時の版）もバイト一致で、列挙された切れ端は 895902565 の 4.2 mm の 1 件だけだった。
- 探り（既定データ）: `check-expressway-lanes` は 9 か所。`--cases` の JSON は、判定を切り出す前・切り出した後・まとめ方を run ごとに直した後で、`cmp` でバイト一致。`check-hole-lanes` は 14 本・最長 68 m、`check-expressway-feet` は違反 0、`check-expressway-terrain` は車道の上の地形 0。
- `just update-expressway-ledger`（探り 3 本の一覧つき）: 旧キーの lane-in-site 9 件が gone、新キーの 9 件が new になった。測った値 4 つ（s0・s1・lengthM・streetM）は、9 件とも旧キーと同じ。`budget` は true のまま（lane-in-site 9）。
- 新キーの判定（レビュー Fable、2026-11-15）: 9 件とも accepted（by review）。旧キーと新キーが同じ事例であること（測った値・run・chunk・district・block・blockHash が同じで、タイルと実行時のコードも同じ）を確かめ、撮影ラウンド 2 の判定を引き継いだ。担当はそれを写すだけにし、旧の判定は `previous` に残した。そのあと `--prune` で gone の 9 件を落とした。結果は 140 件（accepted 136・wontfix 4、new 0・gone 0）で、`budget` も変わっていない。
- `endTerrainOut`（`check-expressway-terrain` が別に数えるだけの、地表端の輪の内の地形）: 既定範囲で 68（2026-11-15）。A2 はこの探りの入力を変えていない（タイルはバイト一致で、`scripts/expresswayTerrainProbe.ts` と `src/world` にも変更が無い）ので、main でも同じ値のはず。ただし main では測っていない。次に既定データを作り直す PR（S7-6）で、前後を比べる基準にする。68 か所の中身は調べていない（R1-4a の材料）。
- vitest 全体: 他の作業が並行する中（load average 13〜19）では、5,000 ms の時間切れが回ごとに別のテストで出た。A2 が触っていない expresswayLevelPairs・facade・expresswayGroundTarget・expresswaySignals で、単独なら通る。単独でいちばん遅いテストは、それぞれ 2.0・2.4・2.1・14.1 s（signals は自前の時間を持つテスト）。A2 が足したテストに 1 秒を超えるものは無い（最長は expresswayHeightStructures の 0.1 s）。判定を写した後の全体の実行は、172 ファイルとも通った。
- `perf-deck.ts` の置き方を前後で 1 回ずつ再現し（同じ URL と手順で、置いた車の緯度経度を出す使い捨てのスクリプト）、位置の差は約 2 mm だった。直した版の `just measure-perf-deck` も、最後まで走ることを確かめた。

# P2.7-7 A1: 汐留の重なりを段違いの分離壁で解く（実行時、既定のタイル不変、2026-11-15）

同じ向きの 2 本の床版が一体化を手放した後（|Δz| > `MERGE_MAX_DZ`）も、床版が重なったまま並走する所の断面を、実行時の規則で決め直した（`expresswayMerge.ts dividerOf`）。既定のタイル・meta・report.json は 1 バイトも動かしていない。動いたのは ledger.json だけ。[^p277-a1]

## 何が起きていたか（main）

- 手放した後、子の床版（ランプ）は何もせず、壁高欄が自分の縁に立った。親（本線）は `letGo` で、その側の壁高欄を外していた。
- 汐留出口 24402125（2 車線、車道 8.0 m）は、内回り 24402611 の左を中心間隔 6.0〜8.4 m で並走する。
  - 出口の右の壁高欄の外面は、内回りの中心から左 `d − 4.5` m に立つ。手放しの点（d = 6.77 m）で 2.27 m。
  - 内回りの左の車線の縁は 3.0 m なので、壁が車線 0 に入っていた。
  - 7c の走行で、車線 0 の車が 24402611:33 の s 22.3 で止まったのはこれ。
- 同じ形（子の壁が親の車線の内に立つ）は、既定データのほかの組にもある。
  - main で次の経路を 1 回ずつ走らせた。下の床版の側の車線で、すべて止まった。
    - 内回りの車線 0（shiodome-approach-out-lane0）: |dy| 0.171 m。
    - 45021972 の車線 0（haneda-down-nose-step）: |dy| 0.20 m、s 約 642。
    - 45554540 の車線 0（haneda-up-thin-divider-lower）: |dy| 0.308 m。
  - 上の床版の側の 2 経路（45019020・4848762 の右の車線）は、main でも止まらない。

## 規則（3 つの枝）

同じ向きの組が手放したリングで、その側に別の seam が無く、相手も自分も掘割・トンネルでないとき、車線の縁の間隔 `g`（自分の車線の縁から、相手の近い側の車線の縁まで）で分ける。

| g                                                                                 | 形                                                                                                                                                                                                                                                                                                            | 台帳                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `g < 0`（車線が重なる、合流のくさび）                                             | 今のまま（子は何もしない、親は `letGo`）                                                                                                                                                                                                                                                                      | 今のまま（merge_skipped）                                                                                      |
| 床版の重なりが `PARAPET`（0.5 m）未満                                             | 今のまま（それぞれの壁が自分の場所に立つ。2 本の壁がもう重なっていて、動かすと跳ぶ）                                                                                                                                                                                                                          | 今のまま                                                                                                       |
| `0 ≤ g < DIVIDER_MIN`（0.25 m、`assumptions.ts DIVIDER_MIN_WIDTH`、未確認の仮定） | **車線の縁の間をちょうど埋める壁**（内面は上の床版の車線の縁、外面は下の床版の車線の縁。幅 g、g = 0 なら厚みの無い板）。高さは上の路面から `clamp(\|Δz\| − MERGE_MAX_DZ, 0, PARAPET_HEIGHT)`（落差に連続、新しい閾値なし）。外面は下の面の `MERGE_SKIRT` 下まで。下の路面は外面の下へ `STEP_TUCK` 5 cm 延びる | 壁が壁高欄の高さに満たない区間は `nose-step`、届いて幅 0.5 m 未満なら `thin-divider`（どちらも規則で通さない） |
| `g ≥ DIVIDER_MIN`                                                                 | **分離壁 1 本**（幅 `min(PARAPET, g)`）。中心は床版の重なりの真ん中で、両面が両方の車線の縁の外に収まるよう寄せる。壁は上の床版が持つ。外面は下の面の `MERGE_SKIRT` 下まで下ろし、床版の下面・桁・盛土の側壁はその外面で止める。下の床版は、路面を壁の中心まで延ばす                                          | 幅 0.5 m 未満の区間は `thin-divider`（規則で通さない）                                                         |

- 壁の面は、作りの上で車線の縁の外にある（`DeckSide.clearTo` ≥ 車線の縁、データの全リングでテスト 20）。
- 壁の無い落差が無いことは、デッキの sides ではなくチャンク（pairPoints）から測る: 手放した組で車線が離れ、床版が壁の幅以上重なる点ごとに、上の床版の車線の内 0.3 m から相手へ、上の路面から `min(|Δz| − MERGE_MAX_DZ, PARAPET_HEIGHT) / 2` の高さで水平に打ったレイが壁に当たる（`scripts/expresswaySeams.ts` の `bare`、テスト 22）。上下 2 段に決めた区間（above / below）は除く。
- 同じ側に別の相手がいて、その相手のために `letGo`・`isPast`・壁の除去が掛かっても、分離壁は残す（ship の 44804029:4 s 511〜617 で、別の相手の `letGo` が分離壁を消し、0.6〜1.6 m の落差に壁が無かった）。
- 区画線: 分離壁・段の側の外側線は、車線の縁が見えている間は落とさない。路肩が 0 なら外側の半分は壁の根元に隠れる。
- 手放しの点と壁の始まり・終わりの扱い（`refineRings`）:
  - 分離壁の側になる・やめる所には、同じ場所にリングを 2 本置く。分離壁のある区間では、壁の有無が変わる所もすべて同じ扱い。
  - そこで路面の端も動くなら（seam ↔ 壁まで）、間に壁なしのリングを 1 本足して 3 本にし、壁の端面を壁の場所で閉じる。
  - 分離壁の 2 本は、近くの縁の頂点のリングより優先する。
- **向かい合う両側が「縁」のときだけ**壁を立てる（a1-answer5）。縁 = その側に、同じ側で一体（joined）の別の床版が無い。子は自分の側と、親の側（親から自分を除いた相手で見る、`partnerIsEdge`）の両方を見る。親は自分の側を見て、子の側は子に問う。
- 親（相手が切られる側の床版）は、相手もそこで手放しているときだけ壁に入る（`partnerSeesDivider`）。子は自分の判断だけで入る。子が親の路面の端を読む深さ 1 の sides でも、親は同じく相手に問う（深さ 2 で打ち切る）。
  - **相手に問う位置**（a1-answer6）: 親のリングの中心ではなく、その側の**床版の縁の点**（継ぎ目が乗る所）から子の線へ下ろした足。子の断面は子の線に直角なので、縁の点を通る子の断面の答えが、その継ぎ目で効く答え。子のどちら側を読むかは、今までどおり親の中心で決める。
- 下の床版が親のときは、壁の側でも、路面を自分の床版の縁まで残す（`dividerOf` の `keep`）。ship の let-go の窓の seam_step 2 件（28188269:1\|44351599、60867241:1\|44803854）が、これで消えた。
- リングの順（`refineRings`）: 分離壁の 2 本のリングは、滑る帯・`LET_GO`・`isExact` のリングを置く前と後の 2 回で置く（`dividerPass`）。後から置くと、前の段で置いたリングが壁の面のリングを落とし、壁の端面が欠けた（ship の小さな段 15 件、a1-answer5 3）。
- 変えないもの: `MERGE_*`・`SEAM_SLIDE_*` の値、一体の区間、対向の組の枝、コンパイラ、既定のタイル。

### 採らなかった案と理由

- **ランプの平面をずらす**（`--ramp-shift`）: 汐留では 2.26 m 動かす必要があり、`MAX_LATERAL_SHIFT` 1.5 m を超える。成分を解き直すと本線も動く（PR 4）。
- **同一面を延ばす**（`--nose-surface overlap`）: 網全体の高さが動き、PR 4 の案 B では T3 と重なりが悪化した。先端だけ同一面を保つ版は R1-4b の項目にした。
- **`g < DIVIDER_MIN` でも最小幅（0.25 m）の壁を立てる**: 45021972:3 の s 642〜650 で、幅 0.25 m の壁が単独で 8 m 立ち、両方の車線に最大 0.11 m 入った。
  - 最初の実装はこの形だった。止める条件に当たり、Fable が判断した。
- **`g < DIVIDER_MIN` は壁なしの段（路面を縁の間の真ん中で切る）**: 2 番目の実装。既定範囲の 2 件（0.16・0.22 m）は先端だったが、ship の 40 件のうち 27 件は落差 1.68〜6.75 m で、壁の無い崖になった（main では子の壁高欄が親の車線の内に立っていた所）。
- **「段が x を超えたら壁」**: x が新しい閾値になる。高さを落差の連続な関数にした。
- **今のまま（skip / letGo）に戻す**: 子の壁が親の車線の内に約 1 m 立つ欠陥が、先端に残る。
- **両方の床版が同時に手放してから立てる**（子も相手に問う）: 子が自分の壁高欄を、親の車線 0 に立てたままになる区間ができた（汐留の s 93.8〜93.9）。
- **自分の側が縁かどうかだけで決める**（相手の側を見ない）: 親が、横に一体の床版（C）を持つ側で、その床版の継ぎ目の下に、自分の車線と相手（D）の間の壁を立てた（ship の 4854234:29 on 44803854。seam の測点 85 点が最大 7.7 cm ずれた）。
- **相手に問う位置を親のリングの中心から取る**（a1-answer5 までの形）: 縁の点との差は、進行方向に「4.75 m × 2 本のなす角」。ship の 28127732:1 \| 44351599 の s 303.7（なす角 0.1°、子の勾配が親より 5 % 急）で、親が壁に入ったのに子はまだ一体で、継ぎ目の内側の面が 0.15 m になった（main に無い seam_step 1 件）。
- **相手の点のうち、子から見た足が親のリングに来る点で問う**（patch49、中心からの足を逆にたどる）: 28127732:1 は消えたが、既定範囲の 24402611:25 \| 45554540 の s 4099.1 に壁の無い落差（dz 0.24 m）が出て、テスト 22 が落ちた。縁の点に合っていない（親の中心が基準のまま）ため、と Fable は読む（確かめていない）。
- **どちらも相手に問わない**: 親が先に手放すと、親は路面を壁の下まで引き下げる。まだ切られている子は、その路面の端まで延びて、親の車線 0 の上 0.16 m に路面を出した（汐留の s 4951。データテスト 13 で落ちることを確かめた）。

## 計測（実行時のリング、既定データ）

### 分離壁と段（上の床版のチャンクごと）

`.qa/a1/dividers.mts`（`probeGenerated` の `dividers`・`steps`）で数えた。

| 上の床版 \| 相手               | 壁の s         | 最小の幅 | 最大の drop | 細い区間                 | 段の s（最大の段、最小の g）         |
| ------------------------------ | -------------- | -------- | ----------- | ------------------------ | ------------------------------------ |
| 24402125:0 \| 24402611（汐留） | 93.8〜186.3    | 0.268 m  | 5.65 m      | 93.8〜95.6（1.8 m）      | —                                    |
| 45019020:40 \| 45554540        | 4044.3〜4080.8 | 0.25 m   | 3.17 m      | 4044.3〜4080.8（36.5 m） | 4080.8〜4082.8（0.223 m、g 0.233 m） |
| 4848762:2 \| 45021972          | 486.2〜522.4   | 0.319 m  | 2.16 m      | 504.2〜522.4（18.3 m）   | —                                    |
| 45021972:3 \| 4848762          | —              | —        | —           | —                        | 642.2〜650.2（0.160 m、g 0.029 m）   |
| 24402611:25 \| 45554540        | 4098.9〜4101.2 | 0.5 m    | 0.44 m      | —                        | —                                    |
| 45019020:8 \| 4848755          | 1820.1〜1822.4 | 0.5 m    | 0.40 m      | —                        | —                                    |
| 45068172:1 \| 45021976         | 266.1〜284.3   | 0.5 m    | 1.32 m      | —                        | —                                    |
| 4848762:34 \| 4848889          | 2993.0〜2996.9 | 0.5 m    | 0.47 m      | —                        | —                                    |

- 汐留の手放しの点の g は 0.268 m（計画の概算は 0.27 m）。手放しの点から先で、出口の壁高欄が内回りの車線に入る所は無くなった。
- 細い壁（thin-divider）と段（nose-step）は、どちらも 3 組（24402125\|24402611・45019020\|45554540・45021972\|4848762）の内にだけ出る（テスト 14）。
- 段は、どちらの端も一体の区間に接する。
  - 45021972:3 は、s 639.9 と 653.1 のリングで joined。
  - 45019020:40 は、s 4082.8 から joined。
- 45019020:40 の壁が s 4044.3（`same` の区間の始まり）から立つ。
  - 前の版では、子も相手に問う `partnerSeesDivider` のために s 4048.7 からだった。

### 継ぎ目の測り（main → A1、同じ測り方）

- seam の測点: 3683 → 3683。新しい seam_hole は 0。
- let_go 9 件: 1 mm 以内。動いた最大は 4848755:4 で 0.02 → 0.06 mm（台帳の丸めで 0 → 0.0001）。
- seam_step 2 件: どちらも滑る帯の規則の内。
  - 45019020:40 の s 4082.9 は、段 0.157 → 0.154 m。
- merge_skipped 46 件: 動かない。
- 滑る帯（|Δz| 0.10〜0.148 m）の測点で、段が 1 mm を超えて動いたのは 8 点。
  - 最大は 45554540:34 の s 7986.1 で 6.3 mm（0.1508 → 0.1445 m）。動いた後の段は最大 0.157 m、内側の面は最大 5.7 mm で、規則の内。
  - 原因は、足したリングではない。足したリングを外した版でも、同じ 8 点が同じだけ動いた。外した版では、加えて seam_hole が 2 か所（24402125:0 の s 89.6〜90.1、45019020:40 の s 4086.9〜4087.4）出た。
  - 2 本の床版は手放しの点を自分の中心で決めるので、その位置が数 cm ずれる。そこで相手の床版の縁の近くの形が変わったことによる（読み、確かめてはいない）。

### 台帳（`just update-expressway-ledger`）

**今の値（2026-11-15、縁の点で問う版）**: 148 件。new 7・accepted 137・wontfix 4。seamProbes 3683。

- ラウンド 1 のレビュー（Fable の a1-ledger.json）で決まった 4 件を写した: parallel-ramp:24402125\|24402611、merge_skipped 2 件、thin-divider:24402125:0\|24402611\|0（accepted）。
- new 7 件（判定はレビュー）: divider-jog 3 件、thin-divider 2 件（45019020:40\|45554540、4848762:2\|45021972）、nose-step 2 件（45019020:40\|45554540、45021972:3\|4848762）。
- 縁の点で問うようにして、既定範囲の測りが 2 か所動いた（上の合否の数には入っていない値）。
  - divider-jog:24402125:0\|24402611\|end の lowerJogM 1.358 → 1.375 m。
  - nose-step:45021972:3\|4848762\|0 の s 642.2〜650.2 → 642.3〜650.3（丸める前 642.224〜650.232 → 642.278〜650.285。両端が同じ向きに 5.4 cm、長さ 8.007 m・落差 0.1598 m は同じ）。
  - a1-answer6 §4 の止める条件（既定範囲の測りが動く）には当たらない、と Fable が判断した（a1-round2）。条件は 2.4 に並べた既定範囲の測り（下の「動いていないもの」）を指すと読む。動いた 2 つは、どちらも親が子の手放しに合わせる位置そのもので、2.1 が変えると決めた量（5.4 cm は 4.75 m × なす角 0.65° に当たる）。一体の区間の測りは動いていない。2 件はラウンド 2 の絵（直した後のコード）で判定した。
  - 動いていないもの: seam の測点 3683、seam_step 2 件、seam_hole 0、let_go 9 件（1 mm 以内）、壁の無い落差 0、thin-divider 3・nose-step 2、タイル（`public/data/expressway` で変わったのは ledger.json だけ）。

以下はラウンド 1 の前の記録。

- 追加 5 件、すべて new。
  - thin-divider 3 件: 24402125:0\|24402611 1.8 m・最小 0.268 m、45019020:40\|45554540 36.5 m・0.25 m、4848762:2\|45021972 18.3 m・0.319 m。
  - nose-step 2 件: 45019020:40\|45554540 2.0 m・0.223 m、45021972:3\|4848762 8.0 m・0.160 m。
- 汐留の 3 件は、理由を今の事実に書き直して new に戻した（前の判断は `previous`）。
  - parallel-ramp:24402125\|24402611、merge_skipped:24402125:0\|24402611、merge_skipped:24402611:33\|24402125。
- seamProbes 3683 は変わらない。
- **判定はレビュー（Fable）**。それまで ledger のテスト 4 本と、データテストの T10・deck_overlap が落ちる（new が残る、budget、parallel-ramp の allowed）。

### ship での広がり（R1 の量の見積もり。seam_hole とテスト 22 は合否）

**A0 の後の main（44d5d80）との比べ（2026-11-15、縁の点で問う版）**: `.qa/a1/shipcmp.py`。

| 測り                     | main     | A1                               |
| ------------------------ | -------- | -------------------------------- |
| seam の測点              | 70,602   | 70,602                           |
| seam_hole の測点（事例） | 77（23） | 77（23）。新しい穴・広がった穴 0 |
| seam_step の事例         | 65       | 65。main に無いもの 0            |
| let_go                   | 235      | 235                              |
| 壁の無い落差（`bare`）   | 4,255 点 | 6 点・5 組。main に無い点 0      |

- 途中の版の値: 縁の規則の前は seam_step 68（let-go の窓の単発 3 件）。keep で 66、縁の点で問うて 65。
- `bare` の探りは、下へのレイ（`p.edge + 0.05` の所）が `MERGE_MAX_DZ` 以内に同じ高さの面を見る所を数えない（a1-answer5 2。その先も同じ高さの路面が続いていて、落差ではない）。前の 12 点 → 6 点。
- main にもある「段 0・内側の面 約 0.15 m」の seam_step（手放しの点の単発）: 1 測点の事例 4 件（133037880:0\|24372960、157249384:0\|1051967534、22694126:0\|28127113、44804206:2\|44804029）、2 測点 1 件（1051967540:0\|1051967534）。
  - 合成網で、2 本の線が 2° 寄る形では、直す前も後も内側の面 0.15 m の点が出た。子の手放しの位置（子の断面）と、探りの dz（子の中心）が違う点を読むことによる。直していない（main と同じ種類）。

以下は前の版の記録。

p7c9-pruned（7c9 の ship/pruned の生成。別の worktree の `.cache`）を、A1 と main の実行時で数えた。壁を立てる規則（a1-answer2）の後の値。

| 区分                                            | 数                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| 分離壁（壁高欄の高さ）                          | 163 チャンク × 相手、3,916 m                                                         |
| thin-divider（幅 0.5 m 未満の壁高欄の高さの壁） | 45 件、計 495 m、最長 49.2 m。幅 0.05 m 未満（板）23・0.05〜0.25 m 4・0.25〜0.5 m 18 |
| 板の区間の落差                                  | 2.02〜6.76 m（23 件、中央値 3.6 m）                                                  |
| nose-step（壁が壁高欄に満たない）               | 16 件、計 49 m、落差の中央値 0.52 m、最大 1.25 m                                     |

- チャンクから数えた、手放した組の車線の縁の間隔（`.qa/a1/levels.mts`、上下 2 段に決めた区間を除く）。
  - g < 0（車線が重なったまま高さが違う、合流のくさびと上を越える手前）: 157 区間・3,557 m。落差の中央値 0.59 m、最大 12.72 m。0.3 m 超 118・1 m 超 55・3 m 超 30。既定範囲は 9 区間・148 m・最大 1.3 m。
  - 0 ≤ g < 0.05 m（車線の縁どうしが接している）: 47 区間・39 m。落差の中央値 2.24 m、最大 8.69 m。1 m 超 33・3 m 超 21。既定範囲は 1 区間・3 m・0.16 m。
- seam の測点: 70,602（main と同じ）。let_go 235 点で、1 mm を超えて動いたものは無い。
- **seam_hole の測点: main 78 → A1 79（止める条件に当たる）**。157249373:0 \| 44804029 の既存の穴（main は s 212.55 の 1 点）が、s 212.05 にも出る。
  - リングごとに追った（`.qa/a1/trace-hole.mts`）。子 157249373:0 は s 211.55 で、下の床版の壁の側（壁の下へ路面を延ばす）から、親の縁への seam に変わる。次の子のリングは s 212.73。
  - 親 44804029 は、s 618.41 で :4（床版の縁 4.5 m）から :5（4.75 m）へ幅が変わる。縁の頂点が同じ所に 2 つあり、子はそのうち 4.75 m の頂点にだけリングを置く（もう一方は `refineRings` の重複の除き方で落ちる）。
  - 子の seam は、s 211.55 の 4.5 m の縁から、s 212.73 の 4.75 m の頂点まで斜めに引かれる。親の縁（4.5 m）との間に、最大 0.25 m の面の無い隙間ができる。親の側の sides はその区間ずっと、joined・路面は縁まで（深さ 0・1 とも）で、`partnerSeesDivider` は掛かっていない。
  - main でも同じ仕組みで穴が出る（s 212.55）。A1 で子の seam の始まりが s 211.55 に動き、斜めの区間が長くなったため 1 点増えた、と読む。親の幅の段で縁の頂点が 2 つあるときに子が両方へリングを置く直しは main の作り（継ぎ目の頂点のリング）に掛かるので、A1 では直していない。
- **テスト 22（壁の無い落差）: 既定範囲 0、ship 43 点・28 組（止める条件に当たる）**。
  - 直しの途中で、同じ側の別の相手の `letGo`・`isPast` が分離壁を消していた（ship の 44804029:4 s 511〜617 など 201 点）。分離壁を残すように直して 358 → 43 点。
  - 残る 43 点は、ほとんどが 1 組 1〜2 点の区間の端。最多は 44803854:13 \| 157249384 の s 1585〜1590（11 点、落差 6.9 m、g 0.03〜0.28 m）。
    - そこでは親 44803854:13 のその側が、別の子と joined（親の側）で、157249384 への壁はリング s 1590.77 から始まる。三つ以上の床版が絡む所。原因は特定していない。

### 壁の無い落差を main と分けた（a1-answer4）

- `bare` の探りを、それだけで動く形にした（`.qa/a1/bare.mts`、中身は `scripts/expresswaySeams.ts` の探りと同じ）。main の作りにもそのまま掛け、点ごとに比べた。
  - 既定範囲は A1・main とも 0 点。
  - ship は A1 43 点（28 組）、main 4,432 点。A1 の 43 点はすべて main にもあり、A1 で新しく出た点は 0。main にあって A1 で消えた点は 4,368（main では、親が手放すときの `letGo` が壁高欄を外す）。
- main にもある点は、台帳の類型 `bare-drop` に出す（1 件 = 上の床版のチャンクと相手の組ごとの、点の続く区間。規則では通さない。既定範囲は 0 件）。
- `just count-bare-drops <dir> [against] [out]`（`scripts/expresswayBareDrops.ts`）: 点を JSONL に書き、別の一覧（main で書いたものなど）と比べて、新しい点・消えた点を 1 行の JSON ログに出す。新しい点があれば終了コード 1。
  - 同じ点とみなすのは、同じチャンク・同じ相手で s の差が 0.25 m 未満（探りの刻み 0.5 m の半分未満）。PR #103 のレビュー W1 の前は 0.5 m 以下で、隣の点も同じ点になり、区間が端で 1 点伸びても新しい点に数えなかった。直した後の比べ直し（2026-11-17）: 既定範囲 0 点、ship（p7c9-pruned）6 点・5 組で、main（4,255 点）に無い点 0。
- 深さ 1 でも親が相手に問う（深さ 2 で打ち切り）。テストを 2 本足した: 分離壁のある組の全リングで、深さ 0 と深さ 1 の答えが一致すること。`sides()` の深さが最大 2 であること。
- 同じ側に別の相手がいても分離壁を残すことは、床版 3 本の合成網のテストで確かめた。

### 分離壁の始まり・終わりの跳び（divider-jog、a1-answer3）

- `dividerJogs`（`expresswayMerge.ts`）で、分離壁の側になる・やめる所ごとに、車線の脇の面が横へ動く量を数える。
  - 上の床版: 自分の壁高欄の内面から、分離壁の内面まで。
  - 下の床版: 壁高欄か路面の端から、分離壁の面まで。
  - 一体（seam）の側から始まる・終わる所は、跳びにしない（壁の端面だけになる）。
- 台帳の類型 `divider-jog`: 上の床版の動きが `PARAPET / 2`（0.25 m、テスト 11 と同じ線）を超える所。measured は `s`・`jogM`・`lowerJogM`（同じ組・同じ端の下の床版）・`dzM`。規則では通さず、直すのは R1-4b のすりつけ。
- 既定範囲は 3 件で、どれも 3 組の内:

  | 事例                                       | 上     | 下                                  | 落差   |
  | ------------------------------------------ | ------ | ----------------------------------- | ------ |
  | 24402125:0\|24402611 の終わり（s 186.3）   | 0.5 m  | 1.375 m（縁の点で問う前は 1.358 m） | 5.45 m |
  | 45019020:40\|45554540 の始まり（s 4044.2） | 0.75 m | 1.25 m                              | 3.52 m |
  | 4848762:1\|45021972 の始まり（s 482.4）    | 0.75 m | 1.183 m                             | 2.25 m |
  - ほかの幅 0.5 m の壁 4 本は、跳び 0。

- 端面: 上の床版の跳びの帯の内を、路面から 0.5 m の高さで、進行方向に 0.1 m ごとに打ったレイが、3 件すべてで端面に当たる（データテスト）。
  - 分離壁の 2 本のリングの間の面は、両側から見える・当たるようにした。終わりの端面は進行方向の後ろを向き、片側だけだと後ろから見えなかった。
- 下の床版の側は確かめていない。上の床版の床版より下では、分離壁は外面 1 枚の板で、その裏は上の床版の下の空間（main の二層の区間と同じ）。閉じる端面が無い。

### 高い壁の暗いくさび（a1-answer3 3）

- 面の一覧（`.qa/a1/wedge.mts`）: 汐留の s 160〜186 で、分離壁の外面の 0.05 m 以内にあったのは、24402125:0 のコンクリートの面だけ。
  - ただし 1 つの四角形ごとに 2 層あった。外面（壁の天端から外面の下端まで）と、床版の下面の帯（外面の下端から床版の下面まで戻る）が、同じ平面にあった（(a) 面の重なり）。
  - ねじれ（四角形の 2 枚の三角形の法線のなす角）は 0°。
- 直し: 上の床版の下面・桁・盛土の側壁を、外面ではなく、外面から床版の厚み（`SLAB`）だけ内側で止めた。床版の下面は、外面の下端から斜めに外面の裏へ上がる。
  - 直した後、外面の平面にある面は 1 層だけ（汐留の 8 枚・103 m²）。合成網のテストで、外面の平面の面積が壁 1 枚ぶんになることを確かめた。古い作りでは 1.46 倍になり、テストが落ちた。
- 描き分けの絵 3 通りは撮っていない（1 の一覧で原因が決まったため）。直した後の 4 コマは、ラウンド 2 で撮り直す。
- 4848762 の桁の下の細い三角: 4848762:1・:2 で、路面の色の三角が分離壁の外面より相手の側へ出ていないことを確かめた（出ていたのは、壁の終わりの先の一体の区間の区画線だけ）。立っている路面の色の三角も 0。
  - 絵の青い細い三角は、壁の桁の縁の隙間（空）と読むが、確かめていない。床版の下面を止める位置を変えたので、ラウンド 2 の絵で見る。

### 負荷（A1 と main）

| 測り                                                            | A1                    | main                  |
| --------------------------------------------------------------- | --------------------- | --------------------- |
| 汐留の床版 19 チャンクを組む時間（7 回の中央値、Node）          | 16.6〜18.5 ms         | 19.3 ms               |
| 同、`sides()` の呼び出し                                        | 1,177 回              | 1,044 回（+13 %）     |
| 浜崎橋の 18 チャンク                                            | 19.9〜23.7 ms、894 回 | 22.3 ms、894 回       |
| `just measure-perf-deck`（フレーム間隔の p50 / p95 / 最大、昼） | 50 / 66.7 / 83.3 ms   | 50 / 66.7 / 66.8 ms   |
| 同、雨の夜                                                      | 50 / 66.7 / 83.3 ms   | 66.6 / 66.7 / 83.4 ms |

- 差は測りのばらつきの内と読む。
- perf-deck は 12 秒ずつ 1 回で、vite :5311（A1）・:5312（main）。

## 走行（`just check-deck-drive`、A1 の版 :5311、main :5312）

**マージする版（fe21e45、PR #103 のレビュー W1・W2 の直しと main 2f2f8cc の取り込みの後、2026-11-17、`.qa/a1/drive-r4/`、ログ `.qa/a1/drive-r4.log`）**: 19 経路すべて合格。

- 一定速の 17 経路: すべて 1 回目で合格。shiodome-exit-right の |dy| は 0.14 m。
- 自動運転の 2 経路: `--pre-wait` 0・20・40 秒で 1 回ずつ（計 6 回）、6 回とも到着・違反 0。signalOmission は出ていない。auto-shibakoen-shiodome の待ち 0 と 40 の回に停止が 1 回ずつあるが、判定で理由と組まれ、失敗にならない。

**その前の版（main f7b9113 の上、2026-11-17、`.qa/a1/drive-r3/`、ログ `.qa/a1/drive-r3.log`）**: 19 経路すべて合格。

- 一定速の 17 経路: 1 回ずつ、全部合格。最大の |dy| は shiodome-exit-right の 0.141 m（24402125:0、閾値 0.15 m）。shiodome-exit-right は 3 回目で合格（前の 2 回は交通の車との事故で invalid）。
- 自動運転の 2 経路: `--pre-wait` 0・20・40 秒で 1 回ずつ（経路ごとに 3 回、計 6 回）。6 回とも到着・違反 0。
  - auto-shibakoen-shiodome（24402125:2 の足の先で、main でも止まっていた件）は、D1（#97）の後で合格。待ち 0 と 40 の回に停止が 2 回ずつあるが、#100 の判定で理由（赤信号）と組まれ、失敗にならない。
  - auto-shiodome-shibakoen の「右折の合図を出さずに曲がった」（下の旧版）は、3 回とも出なかった。
- 鍵は 1 経路ずつ取って返した（`qa-take.sh` / `qa-give.sh`、`.qa/a1/drive-batch.sh`）。

**auto-shiodome-shibakoen の違反の切り分け（2026-11-15、a1-round2 の判断 2）**

- 分かったこと:
  - 床版のコード 4 ファイル（expresswayDeck・expresswayMarkings・expresswayMerge・assumptions）だけを main（44d5d80）の版にした A1 のツリーで 3 回走らせ、2 回合格・1 回違反（同じ芝三丁目）。床版のコードが無くても違反は出る。
  - main（44d5d80）にも出た。0.25 秒ごとに車の位置・合図・壁時計を記録した走り（`.qa/a1/signal-trace.mts`）で、main は違反、A1 は違反なし（`.qa/a1/sig-main1.jsonl`・`sig-a1.jsonl`）。
  - 当時の合図の判定（`main.ts`）は、交差点を 25 m 過ぎた所で「壁時計で 6 秒以内に合図が出ていたか」を見ていた。車が動く時間は 1 フレーム `min(0.05 s, 壁時計)` で、ページが 1 フレーム約 100 ms かかると、ゲームの時間は壁時計の半分ほどしか進まない。記録の走りでは 0.25 秒ぶんの advance に壁時計 1.4〜1.5 秒かかり、最後の右合図が消えてから判定までの壁時計が 6 秒の境目の上にあった。合否はページの重さで変わる。
  - その後、#92（違反の時間をゲームの時計で測る）が main に入り、今の版では 3 回とも違反が出ない。
- 分からないこと:
  - 違反が消えたのが #92 によるのか、D1（#97）や負荷の違いによるのかは、切り分けていない（#92 だけを入れた版で走らせていない）。
  - A1 の床版のコードが、ページの重さを通して違反の出やすさに効いていたか（A1 で 5/5 落ちた時期と、main で 3/3 通った時期の負荷の差を測っていない）。
  - 652515b + A1 で 2/2 合格だった理由（負荷の差と読むが、確かめていない）。

以下は前の版の記録。

| 経路                                                                                                                                                  | A1                                                                                                      | main                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 既存の 13 本（shibakoen-shiodome・auto-shiodome-shibakoen・rainbow 4 本・daiba-exit・azabudai-tunnel・haneda-up/down-seam・shiodome-approach-in/out） | 12 本合格。auto-shibakoen-shiodome は下                                                                 | （前の記録どおり）                                                                              |
| auto-shibakoen-shiodome                                                                                                                               | 連結路で 1 回停止（xwStopping @35.66302,139.76237、24402125:2 の足の先）。分離壁から 300 m 以上離れた所 | 同じ所で同じく停止。A1 と関係なく、main にある                                                  |
| shiodome-approach-out-lane0（内回りの車線 0、s 4850 → 45068170）                                                                                      | 合格（1 回目は invalid）                                                                                | 停止、\|dy\| 0.171 m（24402611:33）                                                             |
| shiodome-exit-right（出口の右の車線 s 20 → 24402125:1）                                                                                               | 合格                                                                                                    | s 91.7 で停止（終点を一般道にした版でも同じ）。手放しの点で、出口の右の車線を横切る面に当たった |
| haneda-down-nose-step（45021972 の車線 0、s 560 → 700）                                                                                               | 合格                                                                                                    | 停止、\|dy\| 0.20 m                                                                             |
| haneda-up-thin-divider-lower（45554540 の車線 0、s 7200 → 7320）                                                                                      | 合格                                                                                                    | 停止、\|dy\| 0.308 m                                                                            |
| thin-divider-45019020-upper（45019020 の右の車線、s 4020 → 4110）                                                                                     | 合格                                                                                                    | 合格                                                                                            |
| thin-divider-4848762-upper（4848762 の右の車線、s 470 → 780）                                                                                         | 合格                                                                                                    | 合格                                                                                            |

- 途中の版で thin-divider-4848762-upper が s 520.4 で止まった。壁が終わって 1 枚の床版に戻る所（4848762:2 s 522.4）で、2 本のリングの間の面が、壁の天端から seam まで右の車線を斜めに横切っていた。
  - 間に壁なしのリングを足して直した（データテスト「closes 4848762's wall」）。
  - 同じ直しで、shiodome-exit-right も手放しの点を抜けた。
- shiodome-exit-right の終点は、一般道の足の手前（24402125:1）にした。足の先の交通との事故で、3 回とも invalid になったため。

## 撮影（expressway の表、多視点レビュー）

- 4 周で収束した（`just check-convergence expressway` が `converged`、「2 quiet rounds, nothing open」、2026-11-17）。
  - ラウンド 1: Warning 4（くさび・桁の下の視点・対象を外した視点・壁の始まりの跳び）。
  - ラウンド 2: 新しい Critical・Warning 0。ラウンド 1 の Warning は fixed 3・wontfix 1（跳びは台帳の divider-jog で受け、R1-4b で直す）。
  - ラウンド 3: 新しい Critical・Warning 0。4848762:1 の壁の始まりへ寄る運転席の視点を 2 つ足した（台帳の divider-jog:4848762:1 の弱い所を埋めるため）。足した時点でラウンド 2 は今の表に対して不完全と読まれ、静かな周に数えられなかったので、収束が 1 周延びた。
  - ラウンド 4（fe21e45、555 コマ、失敗 0）: 新しい Critical・Warning 0。視点は足しても外してもいない。分離壁の計測の出力（`.qa/a1/dividers.mts`）はラウンド 2・3 とバイト一致。
- 開いている指摘は Info だけ（手放しの蹴上げ、壁の始まりの折れ目、俯瞰の方位、夕・夜の窓の明かり）。
- tunnels・signs は main（f7b9113）との画素比較で形が同じ（差は歩行者だけ）。W1・W2 と取り込みの後は撮り直していない（床版の形が変わっていないため）。

## R1 へ回す

- 分離壁が入らない先端（`g < DIVIDER_MIN`）で、コンパイラが同一面を保つ（フラグを付け、ship で A/B）。入れば `nose-step` が消える（R1-4b）。
- `g < 0` の段違い（合流のくさび）は、A1 では今のまま。
- 分離壁の無い区間で、壁の始まり・終わりが路面の端の移動と同じ所に来る形（2 本のリングの間の面が車線を横切る）。A1 は分離壁のある区間だけを直した（ほかの継ぎ目の測りを動かさないため）。
  - 7c の auto-shibakoen-shiodome の停止（24402125:2 の足の先）は、main でも同じ所で出る。原因は見ていない。

# P2.7 R1-1a: 出荷範囲 v2・run の境・地区の確定（コンパイラと計測、2026-11-17）

ユーザーの決定 U2（23 区外も出す）・U10（他社の区間は事業者の区間が終わる節点で切る）・U11（範囲は今のまま）を、出荷範囲（`--range ship`）と地区に入れた。既定のタイル・meta・report.json・ledger.json は 1 バイトも動かしていない（フラグなし）。端の壁（実行時）は R1-1b。スコアカードの欄と基準 fixture は S7-1 のマージの後に載せる。[^r1-1a]

## 規則

| 項目                            | 規則                                                                                                                                                                                                                                                                                                     | どこ                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 範囲 v2 のランプ                | 出荷する本線にランプだけをたどって届くランプを、23 区に掛かるかによらず候補にする。候補のうち、端の親（endPlan の junction・seam の相手で計画に run として在るもの）が出荷する本線・street・候補のどれでもないものを外し、外れる物が無くなるまで繰り返す（規則 A）。親の無いランプは作りから 0           | `scope.ts shipRuns`・`pruneHangingRamps`                        |
| `rampsOutside`                  | 出荷しない本線にだけ届くランプ（v1 は「区に掛からないランプ」）。規則 A で外れたものは別の `rampsDropped`（外れた回と親）                                                                                                                                                                                | 同                                                              |
| 本線                            | 事業者の way を含む本線の run のうち、ref の境でつながる run をまとめた単位（`refLineOf`）が 23 区に掛かるもの。まとめるのは、ref の境で分けた S5（全部が区外）が範囲から落ちないため                                                                                                                    | 同                                                              |
| 他社の境（`--run-borders cut`） | 本線の鎖で、最初の事業者の way より前と最後の事業者の way より後を、その節点で別の run に分ける。端は open（壁は R1-1b）。事業者の way に挟まれた印の無い way（OSM の名前の抜け）、ランプの way が続く所、輪では分けない。境の節点に付くランプの親は事業者の側の run（ほかの節点の親の選び方は変えない） | `network.ts operatorCuts`・`compile.ts endPlan`                 |
| ref の地区の境（同じフラグ）    | way ごとに ref から地区を決め（ref の無い way は隣を継ぐ）、本線の way どうしで地区が替わる節点で分ける。先に公開する地区の側が seam の親（その端は free）、後の側が seam（高さと勾配が続く）。C2 の箱では分けない                                                                                       | `network.ts refBorders`                                         |
| 地区                            | 表は今のまま（E 系は足さない）。`;` の ref は表にある最初の値（`E14;14` は outside、`E14;7` は east）。C2 の箱をまたぐ run は east。C2 の位置は run の長さの中点（チャンクの測点と計画の標本で同じ所になる）                                                                                             | `districts.ts`                                                  |
| 計画から決める地区              | 本線の ref は run の最初の way の ref（チャンクが持つ ref と同じ）、親は endPlan、点は約 50 m ごと                                                                                                                                                                                                       | `scope.ts planDistrictRuns`                                     |
| `--districts central,…`         | `--range ship` と組むときだけ。書く run をその地区に絞る（成分は計画全体で決まるので、書かれる run の中身は ship と同じ、T8）。meta に `districts`                                                                                                                                                       | `scripts/expressway.ts`・`expresswayGuards.ts districtsRefusal` |

- `--run-borders cut` は `--out` 無しでは止まる（既定範囲の成分が変わる。既定にするのは S7-6）。`keep` では run の切り方も親も今までどおり。
- `keep` の間は、地区が混ざる run は最初の way の ref のまま。「先に公開する地区」にはしない（チャンクは run の ref を 1 つしか持たず、変えるとタイルのバイトが動く）。`cut` では地区が混ざる本線は C2 の箱の 2 本（156344609・28127113、east）だけ。 （レビュー 1 で、本線の地区は way の ref から決め、cut で地区の混ざる本線があれば生成を止める形にした。）

## 他社の境（12 節点、ship/pruned）

| 実物の境                                                      | 前後の ref | 切って外れる km           |
| ------------------------------------------------------------- | ---------- | ------------------------- |
| 川口JCT                                                       | S1｜E4     | 3.97・4.62                |
| 三郷JCT                                                       | 6｜E6      | 2.04・2.04                |
| 東京IC 付近                                                   | 3｜E1      | 1.05・1.04                |
| 高井戸（節点 13990210274・13990210275、35.6773°N 139.6146°E） | 4｜E20     | 1.17・1.18                |
| 京葉道路の境（35.7024°N 139.9006°E）                          | 7｜E14;14  | 1.20・1.20                |
| 高谷JCT                                                       | B｜E51     | 0（前から出荷していない） |

- 外れる km の合計 19.49 km（`scope.extent.main.otherKm` 19.82 km との差 0.33 km は挟まれた印の無い way 3 本）。外れる側に事業者の路線の ref は 0、事業者の側が 100 m 未満で残る所は 0。
- 高井戸: 中央道の上りの高井戸出口（ランプ 24895040 と足 24895048、分合流の節点の名前「高井戸IC」・ref「1」= 中央道の IC 番号）は、境から約 1 km 中央道の側の run 27155261（6 本の way が全部「中央自動車道」）にだけ付くので、他社の側として外れる（設計の判断、r1a-answer2）。採らなかった形: 境を IC の先へずらす（中央道の本線約 1 km を都市高速として出すことになる）、決定の表に行を足す（表は「後の段まで出さない物」の置き場）。都市高速の高井戸の出入口は 4 号の側に残る（出口 424475191 → 足 28126646、入口 333682063 → 424475194、境から 350〜550 m）。
- 境から 1.5 km 以内で `keep` は出荷し `cut` で外れるランプは、高井戸の 2 run のほかに三郷JCT の 491625692（E6 の側の run 67152889 に付く連絡路、地上の足なし。v1 には無く範囲 v2 で入ったもの）だけ。
- R4-2 の撮影の視点に「高架どうしの run の境（1｜K1、5｜S5）」を足す（今は描かれない境）。

## ref の地区の境（4 節点）

| 節点                          | 親（free）              | 子（seam）               |
| ----------------------------- | ----------------------- | ------------------------ |
| 1｜K1（35.5456°N 139.7434°E） | 5213544（1、1.79 km）   | 32404414（K1、15.97 km） |
| 1｜K1（35.5456°N 139.7435°E） | 45661183（1、1.78 km）  | 38093215（K1、15.94 km） |
| 5｜S5（35.8229°N 139.6415°E） | 22694126（5、12.53 km） | 22694543（S5、7.38 km）  |
| 5｜S5（35.8230°N 139.6416°E） | 44293728（5、8.42 km）  | 316360292（S5、7.37 km） |

- 「E4 の 39.6 km が北緯 35.647 から始まる」件（plan 10.1）は ref の付き方: チャンクの ref は run の最初の way の ref で、run 44351599 は川口の E4 の way から始まり S1・C2 を約 31.8 km 含む。way 単位の E4 は 8.6 km（全部 35.85〜35.89°N）。`cut` で E4 の側が切れて無くなる。

## 計測（trust signal、2026-11-17 UTC、M2 Max、生成は計測の鍵を 1 本ずつ取って）

- **既定データの不変**: フラグなしで既定範囲を作り直し（`scripts/expressway.ts` の既定の 5 つの箱）、`git status public/data/expressway` は差分なし（タイル・meta・report.json・ledger.json）。
- **`--run-borders cut` の既定範囲**（`--out`）: 計画の成分が 1,106 → 1,117 run になり、11 枚のタイルのバイトが変わる。高さの差は `compare-expressway-heights` で全 4,243 測点の最大 0.001 m（207111988・24402611・45021972・45554540・4848762 の丸めの 1 桁）。run の集合と ID は同じ。
- 生成は ship の 4 本（`--below pruned|all` × `--run-borders keep|cut`）。1 本 372〜391 s。どれも未収束 0、違反（T1〜T7・T12・T13）0、dangling 0、deckMismatch 0。閉鎖は keep と cut で同じ（pruned: ランプ 7、all: 本線 1〔28127324〕+ ランプ 7）。v1（基準 fixture）からの閉鎖の +1（224864763）は、v1 で範囲の外として解いていた未収束のランプが範囲 v2 で範囲に入ったもの（`diagnosticsOutside.vertical_unsolved` 8 → 7）。
- 計画から決めた地区とチャンクから決めた地区は、4 本の書き出した run の全部（639〜672 run）で一致（`expressway_districts_compared`）。最初の実装では ship/all の親の無いランプ 16 本が食い違った（最寄りの本線を「最も近い点」で選んでいたため。本線の線への距離に直した）。 **訂正（レビュー 1）**: 一致は両方が run の最初の way の ref を読むためで、888066403（C2 の 13 km）を central にする誤りを通していた。今は計画の地区が正（下の「レビュー 1」の節）。
- **T8 は未達（止める条件、設計へ）**: `--range ship --below pruned --run-borders cut --districts central` は 1,634 チャンクを書き、ship/pruned・cut の同じチャンクと比べて **6 チャンクが違う**。違うのは `signs` だけで、測点・橋脚・構造などの床版は全部一致。(1) 分岐の方面の標識 108の2-C が 3 枚出ない（41009552:11 の 5 号、668292569:10 の 6 号、888066405:1 の 9 号: 行き先の路線が east で書かれないため）。(2) 888066403 の 3 枚（110-B・112-B）で `divider` の欄が無い（隣の run が書かれないため）。標識の計画（`signPlan.ts planSigns`）が書き出した run から作られるので、書く run を絞ると変わる。ほかに、central の run がぶら下がる地平 run 2 本（4857842・806097479、計画の地区は central 以外）が wanted の取り込みで書かれる。 **レビュー 1 で直した**: `--districts` は ship 全体を解き標識を計画してから書く run を絞る。直した後の差は 0（下の節）。
- 生成のあとで計測の道具を足した（`scripts/expresswayDistrictSizes.ts`・`scripts/expresswayOutsideGround.ts`）。どちらも書き出したフォルダを読むだけ。

### 地区ごと（ship/pruned と ship/all、`cut`。gzip は書き出した run のチャンクだけでタイルを詰め直した値、`scripts/expresswayDistrictSizes.ts`）

| 地区              | run（本線） |    km | 区内 / 区外 km | 閉鎖 | gzip 合計 |        1 タイルの最大 |
| ----------------- | ----------: | ----: | -------------- | ---: | --------: | --------------------: |
| central（pruned） |  321（107） | 260.5 | 232.9 / 27.6   |    2 |    604 KB | 32.1 KB（14552-6453） |
| east（pruned）    |   251（26） | 251.3 | 211.1 / 40.2   |    2 |    582 KB | 41.0 KB（14553-6451） |
| yamate（pruned）  |      5（2） |   2.3 | 2.3 / 0        |    0 |      7 KB |                6.1 KB |
| outside（pruned） |     62（6） |  61.5 | 0.5 / 61.1     |    3 |    135 KB | 17.7 KB（14551-6459） |
| central（all）    |  342（124） | 271.5 | 242.9 / 28.6   |    — |    628 KB | 32.6 KB（14553-6454） |
| east（all）       |   252（27） | 252.0 | 211.8 / 40.2   |    — |    584 KB |               41.0 KB |
| yamate（all）     |      9（4） |  39.0 | 38.6 / 0.5     |    — |     68 KB |               12.0 KB |
| outside（all）    |     62（6） |  61.5 | 0.5 / 61.1     |    — |    135 KB |               17.6 KB |

公開の段ごと（U3 の材料、gzip 合計 / 1 タイルの最大）: **（レビュー 1 の前の地区の決め方の値。下の節の表が正）**

| 段              | pruned・keep      | pruned・cut       | all・keep         | all・cut          |
| --------------- | ----------------- | ----------------- | ----------------- | ----------------- |
| R1（central）   | 0.63 MB / 32.1 KB | 0.60 MB / 32.1 KB | 0.66 MB / 32.6 KB | 0.63 MB / 32.6 KB |
| R2（+ east）    | 1.06 MB / 60.7 KB | 1.18 MB / 61.7 KB | 1.09 MB / 60.7 KB | 1.20 MB / 61.7 KB |
| R3（+ yamate）  | 1.07 MB / 60.7 KB | 1.19 MB / 61.7 KB | 1.15 MB / 60.7 KB | 1.27 MB / 61.7 KB |
| R4（+ outside） | 1.36 MB / 61.8 KB | 1.32 MB / 61.7 KB | 1.45 MB / 61.8 KB | 1.40 MB / 61.7 KB |

- 1 タイルの最大は R2 から 14553-6451（east の C2・6 号のあたり）の約 61.7 KB。central だけでは 32.6 KB。
- `cut` で R2 が増え R4 が減るのは、E 系の ref で始まっていた run（44351599 など）が S1・6・7 から始まるようになり、outside から east へ移るため。
- 生成の gzip 合計（`size.gzip.total`）は詰め直しより 1.5 % 小さい（ship/pruned・keep 1.342 MB と 1.363 MB）。原因は見ていない。

### 範囲 v2 で増えたランプ

- ship/pruned・keep で、基準 fixture（v1）から ランプ 403 → 506 run（+103 run・+26.7 km）、書き出しは +102 run・+26.4 km、タイルの gzip 合計 +82 KB（1.260 → 1.342 MB）。`scope.extent.ramp.outKm` 3.5 → 30.4 km、`rampsOutside` 279 run・103.4 km → 131 run・48.6 km。
- 地区ごと（計画、`cut`）: central +5 run・1.7 km、east +40 run・9.4 km、outside +57 run・14.2 km。
- 規則 A で外れたのは 44 run・29.2 km（`cut`、地上の足 0）: 1 回目は親が出荷しない run（外環の美女木・川口・三郷 JCT、K2・K5・K7 の生麦・金港 JCT、境の先の E4・E6 の連絡路）、2 回目より後はそれにぶら下がる短い run。 **訂正（レビュー 1）**: 「地上の足 0」は誤り（足が別の run の形を数えていなかった）。届き直しで足 8 run も外れ、cut で 52 run・30.7 km（下の節）。

### `cut` で動く量（ship、keep → cut）

- 本線 145 → 141 run（447.4 → 427.9 km、他社の 19.5 km）、ランプ 506 → 503 run、タイル 127 → 121 枚。
- 共通の run の高さ（`compare-expressway-heights`、ship/pruned 38,591 測点）: p90 0.14 m、p99 0.81 m、最大 6.98 m（44420765 の s 724）。0.5 m を超えるのは 44420765・44506762（4.45 m、京葉の境）・438372559（4.23 m）・22694126（2.27 m、5｜S5）・28368866（1.98 m、高井戸）・28127733・44179919（川口）・1023900994・28973646・106629687。境で端が free（他社）か seam（ref）になった run と、その成分。

### 区外の地形と建物（ship・cut、`scripts/expresswayOutsideGround.ts`）

| 項目                                                 | pruned |   all |
| ---------------------------------------------------- | -----: | ----: |
| 区外（町丁から 30 m より外）の測点の km              |  128.9 | 130.3 |
| DEM5A がある                                         |  107.2 | 107.2 |
| DEM10B に落ちる                                      |   21.6 |  23.1 |
| PLATEAU 埼玉県の門の内                               |   57.6 |  57.6 |
| PLATEAU 神奈川県の門の内                             |   48.1 |  48.1 |
| 千葉県（浦安・市川、PLATEAU が無い。旧江戸川より東） |    7.4 |   7.4 |
| どの門の外でもない（東京都の水面・河川）             |   15.8 |  17.3 |

- DEM10B に落ちる km のほとんどは水面の上（レインボーブリッジ 4848762・45019020・45177678・45177681 で各約 2 km、京浜運河の 45021972 で 1.5 km、多摩川トンネルの 878618792・5204786 で各 1.4 km、横浜の K1 の終わり 32404414・38093215 で 1.1・0.8 km）。陸の上で DEM5A が欠ける所は見つかっていない（一覧は出力の `dem10bByRun`）。
- 「区外」には町丁のポリゴンが無い水面が入る（上の「どの門の外でもない」15.8 km の多くは都の水面）。

## 落とし穴

- ref の境で分けると、区に掛からない側（S5）が「区に掛かる本線」の判定から落ちる。範囲の判定は ref の境でつながる run をまとめて行う（`refLineOf`）。
- 「区外」（`nearWards` の外）には、東京湾・運河・河川の上（レインボーブリッジ、京浜運河、多摩川トンネルなど）が入る。町丁のポリゴンが水面に無いため。DEM10B に落ちる km のほとんどはこれ（水面で DEM5A に値が無い）。
- v1 にあって範囲 v2 で消えるランプは、`keep` で 0、`cut` で高井戸の 2 run だけ（`scripts/expresswayScopeProbe.ts` の `lost`）。
- 親の無いランプの地区（最寄りの本線）は、本線の点ではなく線への距離で決める。点で選ぶと、チャンクの測点と計画の標本の間隔の違いで別の本線に寄る。

## レビュー 1（Fable、2026-11-18、直してからマージ）で直したこと

レビュー（scratchpad の p27/s7r/r1a-review1.md）の 5 節の 14 項目。上の節の規則の表は、この節で置き換わった所がある（下の表が正）。[^r1-1a-review1]

| 項目                             | 直した後の規則                                                                                                                                                                                                                                                                                             | どこ                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 規則 A の後の届き直し（B1）      | 規則 A で外した後、出荷する本線から残ったランプだけをたどって届かないランプも外す。「ぶら下がる」と「届く」を、外れる物が無くなるまで繰り返す（`rampsDropped` の `reason` が `parent`／`unreached`）                                                                                                       | `districts.ts scopeRamps`（`scope.ts shipRuns` と地区の段が同じ 1 つの関数を使う） |
| 他社の境（B5）                   | ref の境と同じ「1 本の縦断」: 事業者の側が親（端は free）、他社の側がその seam の子。他社の側は範囲に入らず書かれない。境の節点に付くランプの親は事業者の側のまま                                                                                                                                          | `network.ts`（`operator-open`／`operator-seam`）・`compile.ts endPlan`             |
| ref の境と構造の境（W2）         | ref の境が構造の境（高架｜地平・坑口）に重なったら、計画の段で止める                                                                                                                                                                                                                                       | `network.ts splitRuns`                                                             |
| 本線の地区（B2）                 | run の way の ref から（最初に ref を持つ way、ref の無い way は隣を継ぐ）。cut で 1 run の way が C2 の箱以外で 2 つの地区に掛かったら生成を止める。チャンクの `ref` は今のまま（run の最初の way）                                                                                                       | `districts.ts districtsOf`                                                         |
| ランプの地区（B3）               | 段ごと（central、+ east、+ yamate、+ outside）に、その段までの地区の本線と street を出荷する本線とみなした範囲 v2（`scopeRamps`）に入るランプの集合を作り、初めて入る段の地区にする。どの段でも dangling 0・届かないランプ 0。ref の無い本線と street は親の最も後の段、無ければ最寄りの本線（線への距離） | 同                                                                                 |
| 地区の正                         | 計画。ship の生成はフォルダに `districts.json`（書いた run ごとの地区）を書き、フォルダを読む道具とテストは `scripts/expresswayFiles.ts districtsOfFiles` でそれを読む（無ければチャンクからの関数。既定のフォルダには書かない）                                                                           | `scripts/expressway.ts`・`expresswayFiles.ts`                                      |
| `planDistrictRuns` の点（W1）    | run の最後の点も入れる                                                                                                                                                                                                                                                                                     | `scope.ts`                                                                         |
| `--districts`（B4）              | ship 全体を解き、標識を計画した後で、書く直前に run・チャンク・run の要約・entrances を絞る（`districts.ts pickWritten`）。受けるのは段（`central`／`central,east`／`central,east,yamate`／4 つ全部）だけで、`--run-borders cut` と組むときだけ                                                            | `scripts/expressway.ts`・`expresswayGuards.ts districtsRefusal`                    |
| スコアカード（版 8）             | `size.gzipEnv`（gzip した node と zlib）、`budget`（U3）、ship の生成は `stages`（段ごと）・`borders`（境で切った run と他社の側の km）・`ends`（本線の端と口）                                                                                                                                            | `report.ts`・`scripts/expresswayShipScore.ts`                                      |
| 比べ方                           | `compareExpresswayReports` は、gzip の差を node と zlib が同じ 2 つの間でだけ数える。違うか片方に無いときは `gzip-env` の行として出し、`--check` に数えず、`expressway_reports_gzip_unlike` を 1 行出す。b が U3 を超えたら `--check` を落とす（`expressway_budget_over`）                                 | `scripts/compareExpresswayReports.ts`・`report.ts isGzipComparable`                |
| U3（ユーザーの決定、2026-11-18） | gzip で合計 1.6 MB・1 タイル 72 KB。範囲は削らない。超えたら公開を止めて報告する                                                                                                                                                                                                                           | `src/expressway/budget.ts`、スコアカード `budget`                                  |
| 計測と fixture の環境            | 生成と基準 fixture は devshell（`just` のレシピ）で作る。gzip は zlib の版で揺れるため（同じタイルで 117,542 と 115,707 バイト）                                                                                                                                                                           | justfile                                                                           |
| 道具のレシピ（W5）               | `just probe-expressway-scope`・`just measure-district-sizes`・`just measure-outside-ground`                                                                                                                                                                                                                | justfile                                                                           |

### 訂正（上の節の記述）

- **「規則 A で外れたのは 44 run・29.2 km（地上の足 0）」は誤り。** 下調べの `withFoot` は外れた run 自身の端だけを見ていて、足が別の run（地平のランプ）になっている形を数えなかった。足を seam でたどると、規則 A の後に残っていた島（足だけの run）が 8 run・1.46 km あり（下の表）、届き直しで外れる。外れたのは cut で 52 run・30.7 km、そのうち足を持つ（seam でたどって地上の端がある）のは 14 run。
- **「計画から決めた地区とチャンクから決めた地区は一致」は、両方が run の最初の way の ref を読むので一致していただけ**で、誤り（888066403 の 13 km の C2 を central にしていた）を通した。今は計画の地区が正で、書き出したフォルダは `districts.json` を持つ。
- **central の生成のスコアカードの `scope.dangling` は 5 だった**（R1-1a の最初の版の PR 本文の「dangling 0」は ship の 4 本だけの値）。段ごとの地区で 0 になる（下の計測）。

### 規則 A の後に残っていた島（cut、届き直しで外れた足）

| 足（run） |  長さ | 場所   | 節点の名前・ref                      | 外れた連絡路                               |
| --------- | ----: | ------ | ------------------------------------ | ------------------------------------------ |
| 141340876 | 121 m | 三郷   | —                                    | 374052257 → 491625691（C3 から 6 号上り）  |
| 395056073 | 388 m | 三郷   | 外環三郷西IC・74                     | 395056074 → 43992532（親が C3）            |
| 629923894 | 355 m | 三郷   | 三郷中央IC・81                       | 629923895（親が C3）                       |
| 763341649 | 197 m | 三郷   | 三郷IC・1;661                        | 763341650 → 439262440（親が C3）           |
| 763350967 | 132 m | 三郷   | 上の分かれ目が「三郷IC東出口」1;661  | 138706378 → 43992534 → 629923895           |
| 763353050 | 173 m | 三郷   | 上の分かれ目が「三郷IC西出口」1;661W | 491625692（親が E6）と 43992145 → 43992532 |
| 763353049 |  14 m | 三郷   | —                                    | 763353050 に付く                           |
| 762093191 |  77 m | 美女木 | —                                    | 762093192 → 44420764（5 号下りから C3）    |

- これらは ship のタイルに、路線の無い entrance（141340876・395056073・629923894・763341649・762093191）として書かれていた。
- **三郷の出入口（事実、決定ではない）**: 6 号三郷線の終点の三郷の出入口は、外環・常磐道へ行く連絡路の途中から分かれていて、規則 A で出ない（v1 にも無かったので、減ったのではない）。分かれ目の節点の ref「1;661」「1;661W」の 661 は、ship のタイルの 6 号の出口の番号（加平 651/653、八潮南 655/656、OSM の junction の ref）と同じ並びで、都市高速の 6 号の番号の付け方に合う（「1」は常磐道の IC 番号）。ゲームの側（`src/game/`）に出入口の番号の一覧は無く、番号はどれも OSM の ref から読んだもの。入れるかは R2-1 の前にユーザーに聞く（入れても計画と成分は変わらず、公開済みの run は動かない）。

### そのほか

- W3: 取り込みの地平の本線 6 本（B の浦安 46876435・46913090、多摩川の先 5204787・5204789、K1 の終わり 586976823・1226415720）は、規則 A の「出荷する run」に入っていない（取り込みは計画の wanted の成長で、範囲の決め方の後）。今はそこにぶら下がる候補のランプが無いので害は無い。
- W4: `--run-borders cut` で、他社の側が先に来る本線 5 本の run の ID が変わる（run の ID は最初の way）。既定範囲は変わらない。

| keep の ID | cut の ID（事業者の側） | 路線           |
| ---------- | ----------------------- | -------------- |
| 44351599   | 44351425                | S1（川口）     |
| 1467911980 | 1535564384              | 3 号（東京IC） |
| 27155261   | 1535567270              | 4 号（高井戸） |
| 920238368  | 156796455               | 7 号（京葉）   |
| 67152889   | 24336407                | 6 号（三郷）   |

### 計測（trust signal、2026-11-17 UTC 19:00〜21:30、M2 Max、生成は `just measure-expressway-area`〔devshell の node v24.21.0・zlib 1.3.2〕で計測の鍵を 1 本ずつ取って）

- **既定データの不変**: 直した後のコードで `just make-expressway-data`、`git status public/data/expressway` は差分なし。`--run-borders cut` で既定範囲を作ると（`--out`）、高さの差は全 4,243 測点の最大 0.001 m（207111988・24402611・45021972・45177681・45554540・4848762）で、直す前と同じ。
- **基準 fixture**（ship/pruned と ship/all、keep、版 8）を作り直した。v1 の前の fixture（s72-pruned）からの差は、ランプだけが増えた（計画のランプ 403 → 500 run、+97 run・+25.5 km、本線と street は同じ）、閉鎖 6 → 7（224864763、v1 で範囲の外として解いていた未収束のランプ）、`rampsOutside` 279 → 131 run、gzip は env の違いで `gzip-env`（前の fixture は env を持たない）。keep の届き直しで外れたのは 6 run（ship/pruned の書き出し 646 → 640）。
- **閉鎖・違反・未収束・dangling・deckMismatch**: keep と cut で同じ（pruned: ランプ 7、all: 本線 1〔28127324〕+ ランプ 7、ほかは 0）。止める条件には当たらない。
- **地区**（計画の下調べ、cut）: pruned は central 313 run・240.0 km、east 267・271.8、yamate 7・3.1、outside 65・62.2。all は 336・251.2、269・273.6、9・39.7、65・62.2。レビューの見込みと一致。ship の生成では、計画の地区とチャンクからの地区の食い違いは keep で 21 run（`expressway_districts_compared`、知らせるだけ。地区の正は計画）。

段ごと（スコアカード `stages`、cut）:

| 段             | pruned: run・km・閉鎖 | 区内 / 区外 km | gzip / 1 タイルの最大 | all: gzip / 1 タイルの最大 |
| -------------- | --------------------- | -------------- | --------------------- | -------------------------- |
| R1（central）  | 301・238.6・3         | 211.1 / 27.4   | 0.557 MB / 32.1 KB    | 0.582 MB / 32.6 KB         |
| R2（+ east）   | 560・509.2・6         | 443.1 / 66.1   | 1.170 MB / 61.8 KB    | 1.196 MB / 61.7 KB         |
| R3（+ yamate） | 567・512.3・6         | 446.2 / 66.1   | 1.180 MB / 61.8 KB    | 1.264 MB / 61.7 KB         |
| R4（全部）     | 631・574.1・7         | 446.7 / 127.4  | 1.314 MB / 61.8 KB    | 1.399 MB / 61.7 KB         |

- **U3**: ship/all・cut の 1.40 MB・61.7 KB（タイル 14553-6451）は予算（1.6 MB・72 KB）の内（`budget.ok`）。keep の ship/all は 1.44 MB・61.8 KB。
- **他社の境の端**（cut と keep の同じ地点、ship/pruned）: 端の高さの差は −0.35〜+0.12 m（直す前は京葉で +4.45 m）。

| 境             | run（cut）      | z keep → cut  | 地面からの高さ keep → cut | 勾配 keep → cut |
| -------------- | --------------- | ------------- | ------------------------- | --------------- |
| 東京IC（3 号） | 1535564384 始点 | 46.24 → 45.89 | 9.24 → 8.91               | −1.99 → −2.01 % |
| 東京IC（3 号） | 203832852 終点  | 46.23 → 45.92 | 9.23 → 8.91               | 1.99 → 1.98 %   |
| 高井戸（4 号） | 1535567270 始点 | 55.36 → 55.48 | 8.99 → 9.10               | −0.15 → −0.13 % |
| 高井戸（4 号） | 28368866 終点   | 54.75 → 54.66 | 8.39 → 8.31               | 0.43 → 0.41 %   |
| 京葉（7 号）   | 156796455 始点  | 10.66 → 10.62 | 9.04 → 9.00               | −0.08 → −0.07 % |
| 京葉（7 号）   | 44506762 終点   | 10.62 → 10.66 | 8.98 → 9.02               | 0.08 → 0.07 %   |
| 三郷（6 号）   | 24336407 始点   | 15.82 → 15.76 | 13.45 → 13.39             | 0.10 → 0.06 %   |
| 三郷（6 号）   | 43992332 終点   | 15.82 → 15.75 | 13.52 → 13.38             | −0.04 → 0.07 %  |
| 川口（S1）     | 44179919 終点   | 22.32 → 22.05 | 7.00 → 6.73               | −0.60 → −0.12 % |
| 川口（S1）     | 44351425 始点   | 22.37 → 22.07 | 7.04 → 6.74               | 0.62 → 0.18 %   |

- 並んだ上下線の端の差（cut）: 高井戸 0.82 m（keep 0.61 m、直す前の cut 1.53 m）、東京IC 0.03 m、京葉 0.04 m、三郷 0.01 m、川口 0.02 m。
- **cut で動く量**（ship/pruned、keep → cut の共通の run、38,478 測点）: p90 0.13 m、p99 0.79 m、最大 6.98 m（44420765 の s 724、美女木）。0.5 m を超える上位は 44420765・438372559（4.23 m）・22694126（2.27 m、5｜S5）・28368866（1.98 m）・28127733・44179919・1023900994・28973646・106629687・28127732。京葉の 44506762（直す前 4.45 m）は上位から消えた。残るのは ref の境（美女木・1｜K1）の分で、R2・R4 の撮影の視点に入れる。
- **区外の地形と建物**（cut）: 区外 127.4 km（pruned）・128.9 km（all）のうち DEM5A 105.8 km、DEM10B 21.6・23.1 km（ほとんど水面）。PLATEAU は埼玉 56.2 km、神奈川 48.1 km、千葉の浦安・市川（PLATEAU 無し）7.4 km、どの門の外でもない東京都の水面と河川 15.8 km（pruned）。

- **T8**: `--range ship --below pruned --run-borders cut --districts central` は 1,510 チャンク・301 run を書き、ship/pruned・cut の同じチャンク（`signs` を含む）・run の要約・entrances と**全部一致（差 0）**。ship の central の run との過不足も 0、`scope.dangling` 0（直す前の central の生成は 5）、閉鎖 3、gzip 0.557 MB・最大 32.1 KB。
- 路線の無い entrance（`route` が null）は ship/pruned・cut で 17 → 12（B1 の 5 件が消えた。残る 12 件は前からのもので、島ではない）。

### 端と口（R1-1b の材料、スコアカード `ends`）

- 本線の端 = 書かれた本線の端で、その先に書かれた run が無い所（seam で続く run・ぶら下がる親・同じ鎖の run のどれも無い）。理由は `operator`（他社の道が続く）・`ref`（ref の境の先の後の地区）・`district`（範囲の run だが後の段）・`scope`（範囲がそこで終わる。S7 まで出ない地下・坑口の先、コンパイルしない地平の続きを含む）。口 = 書かれた run に、書かれない run がぶら下がる所（`district`・`ruleA`・`closed`・`outside`）。どちらも run・距離・場所をスコアカードに持つ（`.qa/expressway/r1b-pruned-cut*.report.json`）。
- ship/pruned・cut（R4、全部）: 本線の端 68（`operator` 10・`scope` 58）、口 30（`ruleA` 17・`closed` 7・`outside` 6）。`operator` の 10 は上の境の端の表と同じ。
- R1（`--districts central`）: 本線の端 51（`operator` 4〔東京IC 2・高井戸 2〕・`ref` 2〔1｜K1 の 5213544 の始点・45661183 の終点〕・`scope` 45）、口 26（`district` 19・`closed` 3・`outside` 4）。central と east をつなぐ JCT の連絡路は R1 で 1 本も出ず（後の段のランプは口として残る: 箱崎・江戸橋の 44804643、辰巳の 888066410、葛西の 888066403・906610080・4857053、大井の 331692345・331692346 など）、壁で閉じる形は本線の口と、書かれない連絡路が分かれる口の 2 種類になる。
- 既定範囲の今の端（45554540 の始まりなど）は、ship の `scope` の端に当たる（S7 まで出ない地下の先）。

# S7-1 地下のスコアカード（スコアカード版 7、コンパイラの出力は不変、2026-11-17〜18）

S7（地下全面）の合否を数で決めるための土台。スコアカードを版 7 にし、`underground` を足した（`src/expressway/belowScore.ts`）。コンパイラの出力（タイル・`meta.json`・データの `report.json`）は 1 バイトも変えていない。[^p27s71]

## 作ったもの

- **見送りの理由**（`below.ts belowDeferralOf`、`BELOW_DEFER_REASONS`）: 1 本の run に理由を 1 つ、次の順で先に当たったもの。
  - `loop-seam`: 輪（`chain.closed`）の端。
  - `universe-edge`: ユニバースの端（`outsideNodes`）。
  - `junction`: 鎖の端の節点に別の鎖がある（地下で分合流して終わる）。
  - `ground-junction`: 地平 run と分合流（`compile.ts dropBelowJunctions`）。
  - `bridging`: 成分をまたぐ（`compile.ts pruneBelow`）。
  - 訂正（S7-3）: この 5 つに入らない地下の鎖がある。高架の run の無い鎖は計画が丸ごと飛ばすので、見送りにも数えられていない（`underground.unplanned`、S7-3b）。
  - `isBelowCompiled` は `belowDeferralOf(...) === null` にした。答えは変えていない（`tests/expresswayBelow.test.ts` は期待を変えずに通る）。前の作りは端ごとに理由を見ていた。理由を両端まとめて順に見るようにしたのは、鎖の向きで理由が変わらないようにするため。真偽の答えはどちらの作りでも同じ。
  - `Plan.belowDeferrals` は `belowDeferred` と同じ並び（id）で、理由・クラス・ref・長さ・範囲に入るかを持つ。
  - `dropBelowJunctions` は、1 本の below run に地平のランプが 2 本掛かると、その id を `belowDeferred` に 2 回入れる（main からの挙動）。`underground.deferred` も同じく 2 回数える。今のデータでは 0 件。
  - ref は、その run の way で長さの合計が最も長い ref（無ければ null）。`RunPlan.ref`（最初の way の ref）にしなかったのは、ランプの先の短い way の ref で地区を取り違えないため。
  - 長さは、計画に載った後で落とした run（`ground-junction`・`bridging`）は計画の長さ（`belowJunctions` の km と同じ）、`isBelowCompiled` で見送った run は way の OSM の長さ。
  - 範囲に入るか: 箱の範囲では run 自身の線が箱を通るか（節点の間を `RANGE_LINE_STEP_M` 20 m 以下で補間、`compile.ts isLineInBoxes`。`wanted` が約 20 m ごとの標本で判定するのと同じ考え方）。`--range ship` では、その鎖に範囲の run があるか（`BelowJunction.inRange` と同じ規則）。`--range all` は全部。
    - 箱で鎖の規則にしなかったのは、長い本線の鎖が遠くで箱に掛かるため。
    - 節点だけにしなかったのは、OSM のトンネルは節点の間が長く、小さい箱（汐留は約 270 m × 380 m）を節点の間で横切ると外になるため（レビュー 1 の 3）。今のデータでは、節点だけの判定と線の判定で、既定範囲の内の見送りは同じ 2 本だった。
    - ship の鎖の規則は広めに出る（ユニバースの端の K1 の 2 本も内）。R1-1a が計画から地区を決める関数を作ったら置き換える。
  - このため、既定範囲の 4854085（東京港トンネル）は `ground.belowJunctions` では `inRange: true`（鎖の規則）、`underground.deferred` では `false`（線そのものは箱の外。範囲の閉包で入っていた）になる。
- **`underground.deferred`**: 理由ごと（main・ramp・street）、ref ごと（ref の無いものは `-`）、範囲の内、id の一覧。地区ごとには出さない。見送った run は書き出されず、今の地区の関数は書き出したチャンクから決めるため。計画から地区を決める関数は R1-1a が作る。
- **`underground.portals`**: 書き出した below run の最初と最後の測点のうち、先が below run でない端。次を出す。
  - 路面・地表とその差。
  - その端が seam でつながる地平 run と、坑口から 300 m の内で（路面 − 地表）が 0 から最も離れる値。地平 run のどちらの端かは鎖の向きで決める（below run の始点は前の run の終点、終点は次の run の始点）。
  - トンネルに入る端では `TUNNEL_DEPTH_M`（6.6 m）− その測点の深さ（足りていれば 0）。掘割に入る端では null。
  - 「最初の測点」は坑口そのものの測点と読んだ。今は坑口の端が帯の内にある（W10）ので、トンネルの端はほぼ全部が不足になる。S7-2 はこれを 0 へ下げる。
- **`underground.overApproach`**: 取付けの区間の上を、1 段に満たない高さで通る床版の組。
  - 取付け（`compile.ts portalApproachEnds`、計画から）: 地平 run の端で、鎖の上でその先の way が tunnel か cut のもの。先の below run が書き出されているか、見送りか、範囲の外かは問わない。
    - 端の種類（seam・`portal`）でなく計画で決めるのは、先の below run がコンパイル済みで範囲の外のとき、地平 run の端が `open` になり取付けが黙って消えるため（レビュー 1 の 2）。例: 24402609 の始点は ship/pruned では `portal`、ship/all では `open`（先は 24402540）。
    - 輪（`chain.closed`）の端では、最後の way の先を最初の way として見る（都心環状線の継ぎ目の隣も、先がトンネルなら取付け）。輪でない鎖の端は取付けにしない。
    - 区間は端からちょうど 300 m（run が短ければ run 全体）。S7-2 も同じ関数で下げる地平 run を決められる。
    - スコアカードの `overApproach.approaches` に、書き出した取付けの数と `<run>:<end>`・s0・s1 を出す（「0 組」が「取付けが無い」のか「組が無い」のかを読めるように）。
  - 測り方: `overlap.ts pairStations`（中心線の距離 < 両方の車線域の半幅の和、相手はエルミートの面）。高さの差が `SAME_SURFACE_M`（0.05 m、deckOverlaps と同じ）より大きく、上の床版の桁での 1 段（`levelApartOver`、4.5 m + 桁高）に満たない所を数える。
  - 組ごとに、最小と最大の高さの差・測点の数を出す。横に並ぶ組（最大 1.9 m 以下）と上を通る組（最大 3.9〜6.2 m）を、閾値でなく値で見分けるため。
  - 初版の下限 `SAME_SURFACE_ALLOWED_DZ_M`（0.14 m）はやめた（レビュー 1 の 1）。台帳が分合流でつながる組を受ける上限で、つながらない組には検査より緩く、S7 で 5〜8 cm になった組が数から消える（203832849｜203832847 は pruned 0.28〜0.40 m、all 0.05〜0.08 m）。初版の説明「45068169｜45068170 を数えない」も誤りで、その組は 0.14 m でも出ていた。
- `scripts/compareExpresswayReports.ts`: `underground` の数は今までどおり 1 行ずつ出る（一覧は id・`run:end`・`lower|upper` で引く）。そのほか 1 行に、数に出ない言葉の差を出す: 片方にしか無い見送り・端・取付け・組、理由か範囲の変わった見送り、中の構造か取付けの run の変わった端。片方が版 6 なら「only in …」と出す。`--check` はこれらも差に数える。

## 計測（trust signal、M2 Max）

- 前: main e1aff47 の木を `git archive` で写したもの（build タグ `e1aff47`。ship の 2 本は写しの中で動かしたので `nogit`）。2026-11-17 08:42〜09:46Z。ラベル `s71-*-before`。
- 後: レビュー 1 の直しを commit した後の、きれいな木（build タグ `25c4e6e@0.1.0`、`+` なし）。2026-11-17 16:57〜17:36Z。3 本とも計測の鍵を取って 1 本ずつ作り、ほかの生成とは重ねていない。ラベル `s72-default`・`s72-pruned`・`s72-all`。基準 fixture 2 本は、その生成の `--baseline` をそのまま写したもの。
- 初版の「後」（`s71-*-after`）は commit 前の作業木で作っていた（build タグに `+` 付き）。表の値はすべて `s72-*` のもの。

| 数えるもの                                   | 既定範囲（pruned）                    | ship/pruned     | ship/all                   | 7c の頃の値                   |
| -------------------------------------------- | ------------------------------------- | --------------- | -------------------------- | ----------------------------- |
| 見送り（`plan.belowDeferred` = 理由の合計）  | 91                                    | 91              | 32                         | all 32                        |
| loop-seam                                    | 本線 4・4.74 km                       | 同じ            | 同じ                       | —                             |
| universe-edge                                | 本線 2・1.29 km                       | 同じ            | 同じ（32404418・34621719） | —                             |
| junction                                     | 本線 3・1.29 km、ランプ 23・7.44 km   | 同じ            | 同じ                       | —                             |
| ground-junction                              | 本線 3・13.87 km                      | 同じ            | 0                          | 3 組                          |
| bridging                                     | 本線 44・80.69 km、ランプ 12・0.48 km | 同じ            | 0                          | —                             |
| 見送りの本線の計                             | 56・101.88 km                         | 同じ            | 9・7.32 km                 | all: 本線 24 run・17.0 km     |
| 範囲の内の見送り                             | 2・1.49 km（4848883・4848906）        | 44・61.46 km    | 17・11.11 km               | —                             |
| `ground.belowUnwritten`                      | —                                     | 44・63.94 km    | —                          | 44・63.9 km                   |
| 坑口の端・土被りが足りない端・不足の最大     | 2・1・6.595 m                         | 36・28・7.869 m | 78・64・7.869 m            | 未計測                        |
| 取付け（書き出したもの）                     | 4                                     | 62              | 63                         | —                             |
| 取付けの上を低く通る組                       | 6                                     | 24              | 18                         | 既定範囲に 45068170｜24402125 |
| tunnel_cover_short の未許可                  | 0                                     | 10              | 22                         | pruned 10・all 22             |
| 本線の閉鎖                                   | 0                                     | 0               | 1（28127324、1.03 km）     | all 1                         |
| 解く段の最大の成分                           | 1,093 run・38,792 変数                | 同じ            | 1,400 run・48,528 変数     | 1,414 run・48,672 変数        |
| 解く段（`solve`）・QP                        | 210 s・155 s                          | 225 s・154 s    | 227 s・162 s               | 解く段 231 s                  |
| 生成の全体・最大メモリ（`/usr/bin/time -l`） | 372 s・5.5 GB                         | 384 s・6.5 GB   | 393 s・6.6 GB              | —                             |

- 表の注:
  - 「見送りの本線の計」の 7c の頃の値「24 run・17.0 km」は、出力されない below run のうち本線の鎖のもの（`ground.belowUnwritten` の数え方）で、この表の行とは数え方が違う。
  - 既定範囲の見送りの数は、範囲によらず計画全体の値。範囲の内かどうかは「範囲の内の見送り」の行で見る。
  - 既定範囲の 4854085（東京港トンネル）は範囲の閉包で入る run で、箱の規則では外。S7-6 の「範囲の内の地下の見送り 0」は、`deferred.inRange` と併せて `ground.belowJunctions` 0 と理由の一覧で見る。
- **45068170｜24402125（既定範囲、ship の両方）**: 出た。45068170 の s 0〜181.4、17 測点、高さの差 0.289〜6.154 m。S7-2・S7-6 の条件は id `45068170|24402125` で指す（45068169｜45068170 も一覧に出る）。
  - 最小の 0.289 m（横のずれ 6.44 m）は、24402125 の測点が 45068170 の終点より先にあり、その終点に寄せて測った値（`planOverlaps` は線の端で止める。deckOverlaps と同じ）。
  - 終点の真上の組では 0.66 m（横のずれ 1.27 m）。s 140〜181 では高さの差 3.80 → 0.66 m、横のずれ 2.57 → 1.27 m で、plan 0 節の 4 の概算と合う。S7-2 では測点ごとの値で比べる。
  - s 0〜11 にも高さの差 5.46〜6.43 m（横のずれ 7.4〜6.7 m）で、1 段の 6.24 m に届かない所がある。
  - 既定範囲のほかの 5 組:
    - 45068169｜45068172（汐留入口が取付けの上、2.06〜5.96 m、s 0〜86）。
    - 45068169｜45068170（坑口で並ぶ 2 本、0.061〜0.222 m）。
    - 45068169｜24402611（0.061 m）。
    - 24402609｜24039751（0.067〜0.13 m、12 測点。既定データの deck_overlap にある組）。
    - 24402609｜895902565（0.068 m）。
- **ship/pruned の 24 組**: 多くは坑口の近くで横に並ぶ組で、最大の高さの差 1.9 m 以下、横のずれ 4.6〜8.5 m。上を通る組は最大 3.9〜6.2 m の 5 組: 372483373｜28368866、806097479｜331692344・331922700、45068169｜45068172、45068170｜24402125。どれも視点では見ていない。
- 取付けの 24402609:start は 3 範囲とも出る（初版の拾い方でも出ていた）。計画から決めて増えた取付けは、既定範囲の 24039751:end（先の 35266568 はコンパイル済みで箱の外）と、ship の 1095393545:end・1095393546:start・1563020414:start・850330236:end（どれも端は `open` で、seam でつながる書き出し済みの地下 run が無い）。
- 地区の規模（`--below all` の `districts.planned`）: central 313 run・275.0 km、east 145・174.6、yamate 9・39.0、outside 110・133.4。
  - plan 1.2 節の値（central 323・275.4、east 149・174.8、outside 110・133.5）は 7c0 の前のもので、run の数が違う。km はほぼ同じ。
  - pruned では central 302・265.6、east 143・172.8、yamate 5・2.3、outside 100・131.9。7c の fixture と同じ。
- **不変**（前 `s71-*-before` と後 `s72-*`）:
  - 既定範囲（14 ファイル、314 チャンク）、ship/pruned（129 ファイル、3,225 チャンク）、ship/all（133 ファイル、3,437 チャンク）は、データの `report.json` を含めて全ファイル一致（`diff -r`、`just compare-expressway-chunks` は differ 0）。
  - `just make-expressway-data` で作り直した `public/data/expressway` は、`git status` で変更なし（`report.json` も同じバイト。初版の作業木で確かめた。コンパイラの側はその後も変えていない）。
  - スコアカードの前後（`just compare-expressway-reports`）: removed 0。added はすべて `underground.*`（既定範囲 217・ship/pruned 595・ship/all 671）。
  - changed は 6 欄で、すべて gzip の大きさ（`size.gzip.*`・`size.meta.gzip`・`size.record.gzip`）。前を作った node 24.22.2 と後の node 24.21.0 で zlib が違い、同じバイトのファイルの gzip が変わる（既定範囲の合計 115,707 → 117,542）。raw は同じ。レビュー 1 の再生成でも同じ値だった。

## S7-3 へ渡すもの（`junction`・`loop-seam`・`ground-junction`、範囲の内か）

- loop-seam（C1 の輪の継ぎ目、本線）: 4848883（1.23 km）と 4848906（0.25 km）は既定範囲の内。4848875（2.11 km）と 4848940（1.14 km）は ship の内。
- ground-junction（pruned だけ）:
  - 4854085（B、2.60 km、親の内、既定範囲の閉包）と 5170834（B、1.67 km）は ship の内。
  - 5213283（CA;409、9.60 km）は範囲の外。
- junction（既定範囲の内は 0）:
  - ship の内: 本線 1563006214（5）・24402503（4）・24636595（4）、ランプ 28127106・331922702・593535941・760596455（C2）、45019019（11）、381972984・381974071・593674931。
  - ship の外: 1132724786・165913317・190617371・406000909・46151743・4849055・4853044・5203881・5204847・5204891・5212959・761796508・884343942・98440859・98848277。

## テスト

`tests/expresswayBelowScore.test.ts` で、次を確かめる。

- 合成網で 5 つの理由がそれぞれ 1 本ずつ数えられる。理由の id が `belowDeferred` と同じ並びになる。
- 1 本に理由は 1 つ（輪の継ぎ目が端の分合流より先）。理由が付くのは `isBelowCompiled` が偽の所だけ。
- 箱の範囲では run の線で範囲を判定する（節点が箱の両側にあり、線だけが箱を通るトンネルも内）。`--range ship` は鎖の規則。
- 高架 → 地平 → トンネル → 地平の網で、坑口の端・取付けの run・不足が出る。掘割の端の不足は null で、below run どうしの端は数えない。
- 取付けの区間は端からちょうど 300 m。先のトンネルが書き出されていても、見送りでも、コンパイル済みで箱の外でも、同じ区間になる。
- 取付けの上に 2 m の床版があれば 1 組（最大の高さの差と測点の数つき）。1 段以上の高さか、300 m より遠ければ 0 組。6 cm なら 1 組、5 cm 以下なら 0 組。
- 版 7 の fixture 2 本で、理由の合計が `plan.belowDeferred` と同じ。版 6 は読めて、版 7 との差は `underground.*` の追加だけ。
- `undergroundChanges`。
- 基準 fixture（ship/pruned）に、取付け 45068170:end と組 45068170｜24402125 が出る。

[^p27s71]: 指示は scratchpad の p27/s7r/s7-1-instructions.md（設計 Fable、2026-11-17）。レビュー 1 は p27/s7r/s7-1-review1.md（Fable、2026-11-18）。計測は `.cache/expressway-area/s71-*-before`・`s72-*`、`.qa/expressway/s7[12]-*.report.json`、`.qa/s71/`（build.sh・生成のログ・比較の出力 cmp-*.txt、ローカル、git 管理外）。

# S7-3 地下の分合流（コンパイラ、`--below-junctions compile`、既定は defer、2026-11-18〜22）

地下 run の見送りのうち `junction`（26 本）と `loop-seam`（4 本）をコンパイルするフラグ。フラグなしの出力は 1 バイトも変えない（既定にするのは S7-6）。実行時の開口の断面は S7-4、坑口を下げるのは S7-2。[^p27s73]

## 規則

- **フラグと番人**（`scripts/expressway.ts`・`expresswayGuards.ts`）
  - `--below-junctions defer|compile`。既定は defer。
  - compile は `--out` が無ければ止める。`--structures height --ground compile --partition components` のときだけ受ける。
- **見送りの理由**（`below.ts belowDeferralOf` の `joins: "compile"`）
  - compile では、`loop-seam` と `junction` は理由にならない。`universe-edge` は残る。
  - `dropBelowJunctions` は掛けない（`ground-junction` は 0）。
- **境の節点の親**（`compile.ts endPlan` の `belowJoinSide`）
  - 親の鎖がその節点で run を替え、その run の一方が地下 run のときだけ当てる。
  - 分流（子の始点がその節点）なら、その節点から始まる run が親。合流（子の終点）なら、その節点で終わる run が親。輪の継ぎ目の節点でも同じで、分流は最初の run、合流は最後の run。
  - 他社の境の規則（R1-1a）が先。両方が当たる節点は 0（`.qa/s73/probe4.mts`）。
  - 地下 run の無い節点は変えない。
- **地下で続く端**（`below.ts isEndUnder`・`portalReaches`・`ceilingFrom`）
  - 地下で続く端とは、junction か seam の親が地下 run である端、または自分が `open` で地下 run が seam でつながっている端（輪の最初の run の始点）。
  - 地下で続く端は坑口ではない。天井の下りは、つながった地下区間の本当の坑口から、道のりで測る。速度は道筋の planV の最大。輪は 1 周で止める。
  - たどるとき、飛ばすのは来た run へ戻る端だけ（seam で入った端）。junction で親の端の節点に付いたとき（境の節点の規則で、合流の子はその節点で終わる run、分流の子はその節点から始まる run に付く）は、その端も見る。坑口なら道のりはそこまで（子の端に付いたなら 0 m）、地下で続くなら来た run でない限り先へたどる。
    - 訂正（S7-3 の判定 2）: c2d2700 までは、入った端をいつも飛ばしていた。親の端の坑口が落ち、子の天井が地表にある自分の端のすぐ手前まで置かれて解けなかった（判定 2 の合成網で、ランプのトンネルが `vertical_unsolved` で閉鎖）。実データでこの形は 165913317 の 1 本で、全部の測点で天井が外れているため表に出ていなかった。輪の継ぎ目の節点から分かれる子も同じ形（S7-3b の c4848935）。
  - コンパイラ（`setupBelow`・`thresholdStations`）と T12（`violationsOf`・`checkCover`）は同じ関数を使う。
  - 坑口の地表を読むのは、必要な地下 run の端だけ。読まない坑口は NaN で、`ceilingFrom` は NaN の坑口に当たると投げる。
  - 地下で続く端の外の `portals` には、相手の構造（tunnel か cut）を書く。`underground.portals` はその端を坑口に数えない。
- **輪の継ぎ目**（`compile.ts loopSeamEnd`、`classifyPairs`、`horizontal.ts alignLoop`、`headingAt`）
  - 片側だけが地下 run の継ぎ目は、鎖の途中の境と同じ端にする。地平 run が master。高架なら高架の端が坑口。
  - 輪の最初と最後の run も、床版の組では隣どうしと見る。
  - compile のときだけ、閉じた鎖を輪としてならす。前後に `LOOP_LEAD_M`（20 × SMOOTH_SCALE_M = 500 m、鎖の半分まで）の助走を足して `alignPlan` に掛け、助走を切り落とす。
  - `headingAt` は、継ぎ目では標本を回して取る。
  - 採らなかった案:
    - 開いた線のまま: 両端の向きが OSM の最後の線分に寄り、C1 の継ぎ目で 0.068・0.118 rad 折れた。
    - `headingAt` だけ直す: 線の折れが残る。
    - 周期の帯行列: 解き方を替える必要がある。
- **範囲の閉包**
  - 範囲の run の junction・seam の親が地下 run なら、その親も範囲に入れる。
  - 範囲の地下 run に地下 run が seam でつながっていれば、それも入れる。
- **屋根のあるトンネルの上の cross**（フラグの外）
  - 床版どうしの交差で、下が屋根の下のトンネル（`isHoleAt` が偽）で、上がその点で盛土か掘割なら、cross を書かない（`overDeck` と同じ考え方）。
  - defer のデータに、当てはまるチャンクは 0 枚（バイト一致で確かめた）。
- **開口**（`XwChunk.openings`）
  - junction の 2 本の同一面の区間（`decks` の same）のうち、節点を含むか STRETCH_GAP_M の内のもの。
  - 書くのは tunnel と cut のチャンクだけ。側は、区間の中ほどの相手の中心線で決める。
  - compile の `meta.json` だけが `features` に `below-junctions` を名乗る。ゲームが読む一覧 `XW_READER_FEATURES` には入れないので、今のゲームはそのファイルを断る（S7-4 が入れる）。
- **スコアカード版 9**（`belowScore.ts`）
  - `underground.joins`: 地下の junction と、地下 run どうしの seam。親の開口の有無を持つ。
  - `underground.unplanned`: 高架の run の無い、地下の way を持つ鎖。計画が一度もコンパイルせず、見送りの理由のどれにも入らない（S7-3b）。

## 計測（trust signal、M2 Max、devshell、node v24.21.0・zlib 1.3.2）

生成は 1 本ずつ計測の鍵を取って作った。

| ラベル               | 木（build タグ） | 範囲・below・フラグ               | 全体・最大メモリ |
| -------------------- | ---------------- | --------------------------------- | ---------------- |
| s73-pruned-main      | 5d0b7a2@0.1.0    | ship・pruned                      | 383 s・5.7 GB    |
| s73-all-main         | 5d0b7a2@0.1.0    | ship・all                         | 390 s・5.0 GB    |
| s73-pruned-off       | c2d2700@0.1.0    | ship・pruned                      | 398 s・3.5 GB    |
| s73-all-off          | c2d2700@0.1.0    | ship・all                         | 384 s・6.7 GB    |
| s73-all-on           | c2d2700@0.1.0    | ship・all・compile                | 395 s・5.0 GB    |
| s73-default-on       | c2d2700@0.1.0    | 既定の 5 箱・all・compile         | 369 s・4.0 GB    |
| s73-default-off      | c2d2700@0.1.0    | 既定の 5 箱・all（T8 の切り分け） | —                |
| make-expressway-data | c2d2700@0.1.0    | 既定                              | 350 s・3.1 GB    |

- **不変**
  - `s73-*-main` と `s73-*-off` は、データの `report.json` を含めて全ファイル一致（pruned 131・all 135 ファイル、`compare-expressway-chunks` は differ 0）。
  - スコアカードの差は、版と `underground.joins`・`underground.unplanned` の追加だけ（changed 0、removed 0）。
  - c2d2700 の `--baseline` は、基準 fixture 2 本とバイト一致。
  - `make-expressway-data` の後の `public/data/expressway` は変更なし。
  - 比べた相手は 5d0b7a2（この PR の base）。その後の main（bd7d931・5bb0db7）が動かしたのは、ledger.json・knowledge・街路の探りのスクリプト・実行時の交通と建物で、この PR が触るパスと、`REPORT_VERSION`（8 のまま）は変わっていない。
  - 判定 2 の直し（`portalReaches`）の後は `s73-all-on` だけを作り直して比べた（下）。`defer` の run は地下で続く端を持たず `ceilingFrom` を通らないので、`off` の 2 本と `make-expressway-data` は作り直していない。
  - `s73-all-on`（c2d2700 + 判定 2 の直し、2026-11-22 06:54〜07:08Z、3.6 GB）と c2d2700 の `s73-all-on` は、`compare-expressway-chunks` で 3,830 枚とも一致（differ 0・片側だけ 0）。

| 数えるもの（ship/all）                        | defer                            | compile                                              |
| --------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| 計画の run・地下 run・見送り                  | 1,466・113・32                   | 1,496・143・2（universe-edge の 32404418・34621719） |
| 書いた run（本線・ランプ）                    | 165・499                         | 172・544                                             |
| 閉鎖（本線・ランプ）                          | 1（28127324）・7                 | 1（28127324）・9                                     |
| 違反（T1〜T13）・未収束・ぶら下がり           | 0・0・0                          | 0・0・0                                              |
| tunnel_cover_short（許可・未許可）            | 16・22                           | 26・28                                               |
| deck_overlap（許可・未許可）                  | 65・263                          | 69・273                                              |
| vertical_unsolved                             | 8                                | 9                                                    |
| 坑口の端・土被りが足りない端                  | 80・64                           | 112・79                                              |
| 取付け・取付けの上を低く通る組                | 65・18                           | 75・15                                               |
| 最大の成分                                    | 1,400 run・48,528 変数           | 1,441 run・49,466 変数                               |
| 解く段・QP                                    | 219 s・154 s                     | 234 s・167 s（1.07 倍）                              |
| tracking.free（反転・短波長 σ・短波長相関）   | 0.4954・0.348・0.2488            | 0.4921・0.3431・0.2341                               |
| gzip の合計・1 タイルの最大                   | 1,443,538・61,770                | 1,492,468・65,502（14553-6451、budget.ok は真）      |
| underground.joins（junction・seam・開口なし） | 3・0・3                          | 22・2・0                                             |
| underground.unplanned（全部・範囲に届くもの） | 78 鎖・36.24 km・48 鎖・22.32 km | 同じ・52 鎖・23.84 km                                |

- **新しく書いた run は 52 本**（本線 7・ランプ 45、地下 27・地平 14・高架 11）。
  - 30 本のうち書かれたのは 25 本。書かれなかったのは 331922702（閉鎖）、593674931（親 78334077 が閉鎖）、761796508・5204847・5212959（出荷範囲の外）。
  - 残り 27 本は、範囲 v2 が、地下 run の見送りで本線から切れていたランプに届くようになったもの。
- **線 9**: defer でも書かれていた 666 本で、tunnel_cover_short の有無・文・許可の違いは 0。
- **全部の測点で天井が外れた新しい地下 run**: 1132724783・1563006214（短い掘割）、165913317・28127106・381972984・381974071・5204850（自分の出口の坑口が近い）。
  - 28127106 は、出口の地表が分合流の上の地表より 11 m 高く、392 m では V60 の下りが足りない。
- **端が変わった共通の run（9）**
  - 親が変わった分合流（2）: 28127318（867182415 → 44209387）、5170992（5170834 → 678697941）。
  - 端が portal → open になった地平 run（7）: 24334770・378284472・378284483・45068169・45068170・78334078・80581134。
- **輪の継ぎ目**
  - `h1` と `h0` は 2 本とも一致（差 0）。
  - 継ぎ目をまたぐ弦の、長さあたりの曲がり（rad/m）:
    - 内回り: 前後 5.6・5.6 → 継ぎ目 5.1 → 5.0・4.6（×1e-3）。
    - 外回り: −3.6・−3.7 → −3.6 → −3.2・−2.5（×1e-3）。
    - 直す前は、内回りが継ぎ目で 10.1（前後 5.2・2.8）、外回りが −10.0（前後 −2.1・−0.1）の折れだった。
  - `plan_shift_clamped` は 0。
- **A で平面位置が動いた所**
  - 輪の run 4 本（4848875・4848883・4848906・4848940）は継ぎ目の近くで動いた。長さは +0.04〜+0.09 m。
  - 継ぎ目から 500 m より遠い測点の経緯度の差は、最後の桁で最大 1。
  - 輪の外の鎖は、28127108:35 で縦断の節点の測点が 1 つ増減した（`curvatureKnots` の境目、高さの差は 1 mm 以内）ほかは同じ。
- **高さ（共通の測点）**
  - p99 1.06 m、最大 8.96 m（331922709。`.qa/s73/final.json` は 1.059・8.964）。
  - 多摩川トンネル 878618792 の s 1680〜2332 は最大 0.23 m。
- **開口**: 95 件（掘割 50・トンネル 45）。
  - 相手の run がそのフォルダに無い開口: ship/all は 7 件（28127108｜331922702 と 593535941｜593674931 は相手が閉鎖、5204789｜5212959 は相手が範囲の外、1563020414｜775163548 と 850330236｜775163549 は開口の区間がチャンクの境を 5〜11 cm またいだ切れ端）。既定の 5 箱は 13 件のうち 11 件（4854085｜4853044、4848940｜4849055・46151743、1059139534｜331922703。どれも箱の外のランプ）。データは範囲で変えない（T8）。
- **トンネルのチャンクの標識**（defer → compile、ship/all）: 門型の案内 5 → 14、壁高欄の案内 0 → 4、規制の標識 31 → 40（合計 36 → 58、barrier-mount 44・gantry 14）。規則は足していない（U7）。
- **チャンクの番号が変わった共通の run**: 4 本。
- **既定の 5 箱（s73-default-on）**
  - 違反 0、閉鎖 0、ぶら下がり 0。
  - 範囲の閉包で入った run: 4848875（2.11 km）・4848883（1.23）・4848906（0.25）・4848940（1.14）・378284472・378284483（各 0.12）。
- **T8**（箱と ship の T8 は `signs` を除いて判定する。上の「サインと posted を除いて比較」「`signs` を除く」「`signs` を除いて全部一致」と同じ読み方。標識は書いた run から計画するので範囲で変わる。R1-1a の `--districts` は同じ ship の計画から書く run を絞るので、`signs` も一致させる別の件）
  - 既定の 5 箱と ship（どちらも all・compile）で、共通のチャンク 406 枚のうち 24 枚が違う。違いは 24 枚とも `signs` だけで、測点・高さ・端・構造・`decks`・`openings` と run の要約は同じ。
  - 19 枚は、defer の `--below all` でも同じように違う（共通 351 枚のうち。前からの違い）。
  - compile で増えた 5 枚:
    - 出口の案内（3 枚）: 4848940:0 は京橋出口の 110-B・111-B・112-B（門型）が ship にだけあり、323（速度）が 5 箱にだけある（出口のランプ 4849055 が ship でだけ書かれる。始点が 4848940 の s 360.91 に付く分流で、案内の位置 s 10.91・110.91・240.91 は出口の 350・250・120 m 手前。46151743 は終点が s 1042.66 に付く入口）。4854085:3・:4 は臨海副都心出口の 110-B・111-B・112-B が ship にだけある（出口のランプ 4853044 が ship でだけ書かれる）。
    - 非常電話の案内（2 枚）: 5 箱では 3 つが本線に付く（節点 5658513189 の 116の6 と 5658513190 の 116の4 が 4848875:20、5658513191 の 116の4 が 4848940:3）。116の4 の 2 つは、ship ではランプ 4849055 のチャンクに付く（5658513191 が 4849055:0、5658513190 が 4849055:2）。116の6 の 1 つは ship に無い（理由は未確認）。
    - 訂正（S7-3 の判定 2 の追記）: 前は、出口のランプを 46151743 とし、非常電話の案内を 2 つとも ship で 4849055 に付くとしていた。判定 2 の誤りを写したもの。T8 の判定（`signs` を除く）は変わらない。

### 動いた共通の run の型（defer → compile、28 本。`.qa/s73/moved.mts`）

| 型  | 中身                                                                         | run（路面の最大の動き）                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | 新しく書いた地下 run の、坑口から 300 m の内で土被りが足りない区間の上を通る | 165913330（1.41 m）・23705286（1.57）・24402125（2.98）・26956960（1.24）・45068169（2.65）・45068170（2.86）・45068172（3.22）・5204787（1.73）・760596454（1.31）・78334078（3.63）・80581134（3.68）                        |
| B   | 新しい地下の分合流の親                                                       | 165913327（1.39）・24402540（1.82）・28127108（4.59）・331922709（8.96）・405795844（1.09）・4854085（1.28）・5204786（3.08）・906266864（1.10）                                                                               |
| B'  | 境の節点の規則で新しい子の親になった地平 run                                 | 301016678（0.46）・42751508（0.41）・878618790（0.30）                                                                                                                                                                         |
| C   | 隣の地下 run が書かれ、端が portal から open になった地平 run                | 378284472（1.02）・378284483（1.16）                                                                                                                                                                                           |
| E   | A〜C の run の親・seam の子・同一面の相手                                    | 165913328（1.39、165913330 と同一面）・165913329（1.37、165913328 の seam の子）・24402611（1.01、24402125 の親）・78334075（0、段だけ。新しい 593535941 の seam の親、計画された 331922702 との組。追記 2 で E として受けた） |

- 型 A と B の大きさは、坑口が地表にあること（W10）から来る。331922709 の 8.96 m は、子 760596455 との同一面の区間が 366 m あり、子の坑口が地表にあるため。
- 23705286 は、新しい輪の地下 run 4848883・4848906 の上を通るようになり、1 段の離れのために上がった。構造が掘割・盛土の 2 チャンクから高架の 1 チャンクになった。続きの 45068172 も上がった。

## 渡すもの

- **S7-2 へ**
  - 型 A・B・C の一覧（上の表）。S7-2 の計測で、型 A が地平に戻ることと、型 B の最大（今 8.96 m）がどう変わるかを見る。
  - 3.4 で地表にある坑口として扱った端（坑口を下げると、子の天井の起点も動く）。
- **S7-4 へ**
  - 開口の一覧（`.qa/s73/final.json` の openings、95 件）。
  - 同一面の区間（開口）の長い組がある。760596455｜331922709 は 366 m。開口が数百 m 続く形を、断面の設計の前提にする。
  - 端の `portals` は、地下で続く端の外を tunnel か cut と書く。`features` の名前は `below-junctions`。
  - **相手のチャンクが無い開口は開けない**（判定 2 の N1）。`openings` の相手の run がフォルダに無いことがある（既定の 5 箱は 13 件のうち 11 件、ship/all は 95 件のうち 7 件。上の「開口」）。R1-1b の口（書かれない run がぶら下がる所）と同じ扱い。数える欄を足すかは S7-4 で決める。
  - 開口は、チャンクごとでなく run の区間として読む。開口の区間がチャンクの境を少しまたぐと、隣のチャンクに 5〜11 cm の切れ端が残る。
- **S7-5 へ**: 閉鎖のランプ 9 本と原因。大橋の 331922702・593674931・78334077・80581128・84619191 はひとまとまり。
- **S7-6 へ**: 既定範囲に入る型 A・B・C の run（24402611・24402125・45068169・45068170・45068172・23705286）を、走行と撮影の視点に入れる。

## テスト

- `tests/expresswayUnderJunctions.test.ts` が、次を保証する。
  - 見送りの理由。
  - 7c0 の網（親の内、境の節点、繰り返し）。
  - トンネルの中で分かれるランプ（分流・合流・坑口の近く・子の子、T3・T12・portals）。
  - 輪（地下｜地下、地平｜トンネルの取付け、継ぎ目の節点のランプの親、継ぎ目の向きと弦、alignLoop）。
  - 高架だけの分合流は不変。範囲の閉包と T8。書式と features。番人。pruned との組。屋根のあるトンネルの上の cross。
- `tests/expresswayBelowScore.test.ts`: 版 9（unplanned・joins、版 8 との差）。
- `tests/expresswayBelow.test.ts`: 格子の間の崖で T12 が拾う（下の既知の欠落）。

[^p27s73]: 指示は scratchpad の p27/s7r/s7-3-instructions.md。判定は s7-3-review0.md・s7-3-review1.md（追記 1・2）・s7-3-review2.md（設計 Fable、2026-11-18〜22）。計測は `.cache/expressway-area/s73-*`・`.qa/expressway/s73-*.report.json`・`.qa/s73/`（probe*.mts・moved.mts・stopcheck2.mts・final.mts・seamchords.mts・t8keys.mts・生成のログ、ローカル、git 管理外）。

# S7-4b 穴の縁の補間（実行時、既定のタイル不変、2026-11-22）

トンネルの口の近くで、地形の穴（`expresswayBore.ts boreHoles`）の縁を、測点の上でなく測点の間に置く。前は縁が測点の上に乗り、直線のトンネルでは最大約 21 m おきだったので、路面が 7 cm 動くと縁が 20 m 跳んだ（P2.7-6 PR 7c の麻布台、737538573:2 の s 492.67）。[^p27s74b]

## 規則

- `isHoleAt` が切り替わる 2 つの測点の間で、`ground − z`（地表 − 路面）を測点の間で線形に取り、しきい値（`TUNNEL_INNER_HEIGHT_M + 頂版 + HEAD_OVER_GROUND_M` = 6.7 m）をまたぐ点に縁を置く（`holeShare`）。縁はその区間に直角、幅は今までどおり。
- 掘割と盛土は全長が穴なので変わらない。深いトンネル（どの測点も穴でない）も変わらない。
- 1 つだけしきい値を下回る測点は、前は穴を作らなかった（多角形が 2 点で面積 0）。今は、前後の 2 つのまたぐ点の間が穴になる（規則に測点の数が無いため）。
- 継ぎ目の補正（`HOLE_SEAM_M`・`SEAM_AT_GROUND_M`）は今のまま。チャンクの端の測点は補間しない（隣のチャンクの最初の測点と同じ点）。
- 採らなかった案:
  - エルミートの路面で補間する: 地表は測点の値だけで、測点の間は線形しか無い。
  - 縁を測点の上のまま、しきい値に余裕を持たせる: 新しい閾値になり、跳びは残る。

## 計測（trust signal、2026-11-22、M2 Max、既定データ adc7f7c）

- **麻布台 737538573 の穴**（`.qa/s74/azabudai.ts`）
  - :2 の穴の始まりが s 492.67 → **490.84**（472.67〜492.67 の 0.909、地表 − 路面 7.197 → 6.650 m）。片側 1 頂点ずつ増えた（14 → 16）。面積は 1,473 → 1,499 m²。
  - :0（掘割）は変わらない（28 頂点、1,099.1 m²）。:1 は穴が無いまま（s 134.47 の 6.821 m はしきい値より上）。
  - テストの期待値は `[84, 922761830, 573913335]` → `[88, 215627151, 812888198]`（頂点の値の数・頂点のハッシュ・地形のマスクのハッシュ）。
- **街路**（`.qa/s74/streetcuts.ts`、地理院の z16 の写し、0.05 m おきに穴の内の長さを測った）
  - トンネルの穴に掛かる線は前後とも同じ 7 本（タイルと番号 16/58206/25810 の #66・#75・#76・#77・#80・#81・#84）。新しく切られる線は無い（地理院の線は id を持たないので、タイルと番号と始点で名指した）。
  - 長くなったのは #80（prefectural、幅 40）と #81（highway、幅 4.3）の 2 本だけで、どちらも 17.48 → 19.33 m・17.50 → 19.35 m（+1.85 m）。2 本はトンネルに沿って走る線で、縁が s 492.67 → 490.84 へ 1.83 m 動いた分と合う。ほかの 5 本は 0.00 m。
  - 穴から外れる長さは 0。
- **地形の探り**（`just check-expressway-terrain`）: 前後で同じ（49 チャンク・80,576 点、terrainOut・drawnOut・colliderOut・streetOut 0、endTerrainOut 68、endStreetOut 0）。この探りは盛土と掘割だけを見て、トンネルの穴は見ない。
- **建物・水**: 穴の多角形の中の建物は隠される（main.ts `addHiddenRings`）。建物の写しが手元に無いので数では見ていない。撮影で見た。
- **撮影**（鍵を 1 本ずつ取って、vite :5347）
  - `expressway` の `azabudai-hole-overhead`・`azabudai-hole-ground` を前後で（s74b-before 13:52〜13:54Z、s74b-after 14:24〜14:25Z、昼・夕・夜・雨の夜で 8 コマずつ、失敗 0）。前後で違うのは歩行者だけで、建物・街路・歩道・地形・水は同じ。
  - `expressway-tunnels` の 2 周（round-01・02、14:26〜14:37Z、22 コマずつ、失敗 0）。指摘 0 が 2 周で `check-convergence` は converged。

## テスト

`tests/expresswayGradeStructures.test.ts`「掘割と土被りのあるトンネルの継ぎ目、既定データの穴」が、次を保証する。

- 縁が、測点の間でしきい値をまたぐ点に来る（s 40〜50 の 1/4 で s 42.5。その点の地表 − 路面がしきい値）。
- 路面を 7.1 cm 動かして、測点 1 つがしきい値をまたいでも、縁の動きは補間から出る量で、1.2 m 未満（麻布台の形）。
- 1 つだけしきい値を下回る測点の穴は、前後のまたぐ点の間（s 45〜55）。どの測点も上なら穴は無い。
- 掘割の穴は測点の上のまま（11 測点・22 頂点）。
- 既定データの麻布台の穴は、しきい値を下回る測点の並びごとに 1 つで、頂点は測点とまたぐ点の 2 倍（継ぎ目の 2 を足す）。
- 直した後のコードを origin/main の `expresswayBore.ts` に戻すと、この 5 つが落ちる（確かめた）。

[^p27s74b]: 指示は scratchpad の p27/s7r/s7-4-instructions.md の 4 節。判定は s7-4-review0.md（b を先に出してよい）。探りのスクリプトと出力は `.qa/s74/`（azabudai.ts・streets.ts・streetcuts.ts・streetcuts.txt・terrain-before.txt・terrain-after.txt、撮影の views-before・views-after、ローカル、git 管理外）。

# P2.7 R1-2-0 探りをゲームと同じ網で（2026-11-18）

**誤り（訂正）**: `check-expressway-lanes`・`check-hole-lanes` は、規制を当てずに道路網を組んでいた（どの街路も 1 車線）。掘割の探りは、高速道路を結ぶこと（`joinExpressway`）もしていなかった。そのため、ゲームが切る街路や、ゲームが描かない車線まで数えていた。R1-2 の最初の設計（片側 1 車線の前提）は、この数字から作られて誤った。

**直したこと**: 3 つの道具（探り 2 本と `scripts/measureStreetBands.ts`）が、`scripts/gameStreets.ts` だけで網を組む。高速道路を結び、`public/data` の規制（JARTIC・OSM）を Worker と同じに当てる。一方通行は、断面を決めたときの向き（`onewayRule`）で走る（時刻つきの規則を対面として割らない）。探りは 1 つの時刻でしか数えられないので、規則が効いている時刻にそろえた。ゲームは規則の時間外に、同じ車道を対面として割って描き、走らせる（`main.ts` の `setClock` → `roads.ts` の `setClock`）。時刻つきの一方通行が当たった区間は、敷地のチャンクから 60 m 以内には既定範囲・表を外した版・central とも 0（PR #115 のレビューで確かめた）。規制のデータが無ければ、今までどおり幅員だけで組む（`tests/gameStreets.test.ts`）。

**数字**（`just measure-street-bands`、`just check-expressway-lanes`、`just check-hole-lanes`。Node、M2 Max）:

|                                                 | 既定範囲         | 表を外した版     | central（`r1b-pruned-cut-central`）               |
| ----------------------------------------------- | ---------------- | ---------------- | ------------------------------------------------- |
| 敷地が幅員に掛かる区間                          | 18・512 m        | 22・551 m        | 237・5,977 m                                      |
| clear（車線の中心が帯に入らない）               | 2                | 2                | 55                                                |
| A（中央帯）／A'（部屋の上限だけ）               | 8 ／ 0           | 9 ／ 0           | 11・244 m ／ 5・230 m                             |
| B1 ／ B2（片寄せで 1 車線以上置ける）／ B3 ／ C | 5 ／ 0 ／ 0 ／ 3 | 6 ／ 1 ／ 0 ／ 4 | 50 ／ 11 ／ 6・117 m ／ 99                        |
| lane-in-site の探り                             | 9 か所           | 13 か所          | 76 か所（タイルの無いチャンク 2）                 |
| street-lane-over-cut の探り                     | 1 run・22 車線   | 2 run・26 車線   | 51 run・275 車線・最長 92 m（タイルの無い run 1） |

- **central の探りの件数は、これが最初の記録。**
- **帯は区間ごとに 1 つにまとめない（訂正）**。最初の道具は、区間の中の帯を全部 1 つに合わせ（`left` は最大、`right` は最小）、1 つの標本で 2 つの盛土に当たれば、その幅も 1 つに合わせていた。街路の両側に別々の盛土がある区間（central の区間 1176、帯 [7.87, 15.74] と [−15.73, −7.81]）では、帯が街路の全幅を覆い、C と数えた。今は `scripts/streetBands.ts mergeBands` が、重なる幅と、間に 1 車線（2.75 m）が入らない幅だけを 1 つにする（`tests/streetBands.test.ts`）。区間 1176 は clear に戻った。標本ごとにも分けたので、central では両側の盛土の間の 5 区間（@35.6595,139.7198〜139.7209 の 817・833・837 と @35.6361,139.7181〜35.6358,139.7185 の 1167・1185。区間の番号はその群の網のもの）が C から A'（部屋の上限、車線は 4 → 1〜2）に移った。設計メモの数え直し（A 13・A' 4・C 104）は、まとめていた版の一覧から出したもので、この 5 区間の分だけ違っていた。レビュー（2 回目）でメモの数をこちらに合わせ、A は中央帯を当てた区間、A' は部屋の上限だけを当てた区間と数える。
- **B3（レビュー 2 回目で足した規則、メモ 3.3 の 5）**: 中央帯か部屋の上限で収まっても、どちらも部屋まで使ったときの片側の車線数が、線をずらして帯の外に置ける数（道具の `offCentre`）より少なければ、当てずに B3 として R1-2b に回す。対称の断面は、敷地の無い側の車線まで同じだけ減らすため（central の区間 1563: 帯が右側だけなのに両方向が 4 → 1 車線、ずらせば 3 車線）。central の B3 は 6 区間（918・1560・1563・1043、840 が run 202809278 と 24402014 で 2 つ）、既定範囲は 0。
- **B1・B2 は「片寄せで全部の車線が入る」ではない**: 道具の判定は `offCentre >= 1`（片側に 1 車線でも置ければ B1・B2）。central の B1 50 のうち 30、B2 11 の全部、B3 6 のうち 5 は、線をずらしても車線が減る（`offCentre` が今の車線数より少ない）。R1-2b の計測（手順 0b）で減る数を出す。
- central の `measure-street-bands` は、地理院タイルの無い敷地のチャンク 4 を数えていない（`skippedChunksForMissingTiles` 4）。道具は、飛ばしても終了コード 0（探り 2 本は 1）。
- **台帳の判定（Fable のレビュー、2026-11-18）**: 新しい網で lane-in-site の値が動いた。`4848755|w9|1`・`|w9|2` は 2 本目の車線が間の 1.8 m を埋めて 1 か所に合わさり（後ろの方は `--prune` で落とした）、`895902565|w50|1` は s 882.8〜884 の 1.2 m で 2 か所に分かれた（後ろ側が `|w50|2`）。どちらも前に視点つきで受けた範囲の内で、タイルと実行時のコードは不変（撮影ラウンド 2 の判定を持ち越す）。new の 2 件を accepted（by review）にし、lane-in-site の cap を新しい測り値に付け直した（前の cap のままだと、7 m になった `|w50|1` が s 910 まで許し、`|w50|2` と重なる）。`street-lane-over-cut:737538573` は値が同じで、理由の文に新しい網の 22 車線を足した。budget と `report.json` は動いていない（`reallowed` 0）。
- `895902565|w50|2`（s 884〜909.9）は、街路の帯の一覧では、`24402611|w50|1` と同じ区間（既定範囲の網で区間 821、27 m、類 A）の行に入っている。区間 821 は、24402611:0 と 895902565:7 の 2 本の盛土の脇を通る。行の chunk は、帯の標本の多い 24402611:0 になっている。台帳の理由の最後は、レビュー（2 回目）で「区間 821 に入っていて、R1-2a で直る見込み」に置き換えた。R1-2a を取り下げた後（下の節）、台帳で R1-2a に触れた文は全部「R1-2b（街路の線を動かす）で扱う。時期は central の公開と並べて、R2 の前」（沿う区間でない幅 4.3 m の 2 か所は「R1-2b の計測で形を見る」）に書き直した（status・cap は不変、new 0・gone 0）。
- **落とし穴**: `measure-street-bands` の 1 行（区間）が複数のチャンクの盛土・掘割にまたがるときは、`chunk`（帯の標本の多い 1 つ）ではなく `chunks` の欄を読む。`chunk` だけで探りの事例と突き合わせると、別のチャンクの事例が「一覧に無い」ように見える（`895902565|w50|2` で起きた）。
- 一覧（JSON）は `.qa/r1-2/m-*.json`・`sl-*.json`・`hl-*.json`（作業の worktree。commit しない）。

# P2.7 R1-2a 街路に中央帯を入れる形（試して取り下げた、2026-11-18）

**結論**: 敷地が沿う街路に、区間ごとに中央帯（A）か車道の部屋の上限（A'）を入れる形は、main に入れない。A・A'・B3 は B1・B2・C と一緒に R1-2b（街路の線そのものを敷地の外へ動かす）で扱う。時期は central の公開と並べて、R2 の前（ユーザーの決定）。作ったものは枝 `wip/r1-2a-street-median`（d9924e6、PR にしない）に残した。R1-2b で使えるのは、敷地の幅を街路の横の軸に直す所（`stripsAt`・`SiteIndex`・`mergeBands`）、類の判定、島の升と PLATEAU と重ねない規則、小さい網の自動運転のテストの道具（`drive`）。

**試した形**:

1. 区間ごとの帯（敷地の幅 + 1 m を街路の横の軸に直したもの）を `LaneEvidence.bands` で `resolveSection` に渡し、帯なしの断面で車線の中心が帯に入れば、中央帯（帯が中心線をまたぐ）か部屋の上限（片側）を当てる。Worker の中で、網を組んだ後・規制の前に当て、規制が断面を出し直すときも同じ帯を渡す。線は変えない。
2. 中央帯のうち敷地の外を、縁石つきの島（U8）にして PLATEAU の舗装と一緒に敷く。
3. 鎖とすりつけ: 帯を当てた区間のうち直進でつながるものを鎖にして帯を共通にし、鎖の端から直進で続く区間へ帯を写す。写すのは、端の節点から最初の敷地までの距離が「車線の跳びの全車線の最大 ÷ `LANE_SLOPE` + `BAN_LEAD`」以上になるまで（区間の単位）。写せない端（一方通行、街路でない、車線が入らない、別の鎖）がある鎖は当てない。

**止めた理由（数値）**:

- 自動運転の線は、節点で車線の位置が変わると、節点の**先で**横 1 m につき 10 m かけて寄せる（`drivePath.ts` の `LANE_SLOPE` 0.1）。小さい網（片側 4 → 1 車線、車線 0 が 8.7 m 動く）では、11.4 → 2.6 m の寄せに約 100 m かかり、敷地の始まり（交差点の 10 m 先）から約 45 m、車が帯の内（壁の所）を走った。到着し、`lostWhy` も立たない（止める条件の「外れる・止まる」には当たらないが、直しの目的に反する）。
- 寄せを敷地の前に終えるには、手前に「跳び ÷ 0.1 + 10 m」の同じ断面の区間が要る。既定範囲の鎖の端では、跳びが 13.9〜16.0 m（全車線の最大）で、要る長さは 149〜170 m。
- 既定範囲の鎖は 3 本。麻布台（区間 637・638・639・657）と霞が関（817・818）は、端の先が JARTIC の一方通行で、帯を写せない（伸ばせない端）。残る霞が関（821・823、中央帯 21.0 m）は、伸ばした 3 区間（52 m）で車道が 21.6 → 35.0 m に広がり、外側線が 3 区間とも PLATEAU の歩道に乗る。伸ばした区間で車道を広げない決まりにすると、この鎖も当たらない。**A は 8 → 2 → 0 区間**。
- central（`r1b-pruned-cut-central`）でも、鎖と伸ばす規則の下で当てられるのは A 2・A' 2。伸ばした 6 区間（171 m）のうち 4 区間で外側線が歩道に乗る。鎖の端は、当てられた 2・行き止まり 3・伸ばせない 4（一方通行 2・別の鎖 2）。
- 2 本の端の一方通行が、鎖へ入る向きか出る向きかは、道具で出していない（確かめていない）。設計は、敷地が真ん中を通る大通りは JARTIC では上下に分かれた街路で、対面のままの短い区間は一方通行の票が入らなかっただけ、と読んでいる（JARTIC の線とは突き合わせていない。R1-2b の手順 0b で見る）。

**交通の車**は寄せ遅れない。街路の交通の車は、区間ごとに「その向きの車線の幅の真ん中」（`laneCentreOffset(seg, 0, 1)`）に置かれ、節点で横に瞬時に動く（`traffic-ai.ts`）。帯のある区間では必ず帯の外にいるが、節点で横に飛ぶ。これは今の網でも、車線数の変わる節点で起きている。

**前の設計の誤り（訂正）**:

- 「中央帯で大半が直る」: 誤り。規制を当てた網で数え直すと、central で車線が敷地に掛かる 182 区間のうち、中央帯か部屋の上限で直るのは 17 区間（8 %）だった（R1-2-0 の数え直し）。鎖とすりつけを入れると、さらに A 2・A' 2 になる。
- 「節点の跳びは 4 m まで」: 誤り。今の網でも、車線数の変わる節点で車線 0 が最大 9.5 m 跳んでいる（既定範囲、`measure-street-bands` の `jumps`）。
- 「対称の断面で足りる」: 誤り。帯が片側に寄った区間では、対称の断面は敷地の無い側の車線まで同じだけ減らす（central の区間 1563: 片側 4 → 1 車線、線をずらせば 3 車線）。この区間は B3 として当てない規則を足したが、R1-2a 全体を取り下げた。

**trust signal**: 小さい網のテスト（枝の `tests/streetBandsNetwork.test.ts`、vitest、2026-11-18）。`just measure-street-bands`（枝の道具。既定範囲と central、2026-11-18）。一覧は作業の worktree の `.qa/r1-2/b-expressway.json`・`b-central.json`（`chainEnds`・`extended`・`bandLogs`、commit しない）。設計の判断は scratchpad の `r1-2a-review0.md`（消える）。

# 未対応・既知の欠落

- S7-3c（S7-3 の判定 0 から）: 格子の測点の間で地表が半ステップの内に大きく下がると、T12 が出る。コンパイラは 5 m の格子の測点でだけ、3 点の最低の地表で天井を守り、検査はファイルの測点ごとに、その測点の地表で見るため。
  - 合成網で、崖では天井を 0.10〜0.12 m、100 m で 27 m の斜面では 0.18〜0.19 m 超えた（main 4dd7dc3）。
  - 実データでは出ていない（fixture の T12 は 0）。
  - `thresholdStations` を広げて直す。直したら、`tests/expresswayBelow.test.ts` の崖のテストの期待を 0 に替える。
- S7-3b（S7-3 から、ユーザーの決定で S7 の内に入れる）: 高架の run の無い、地下の way を持つ鎖（`underground.unplanned`、78 鎖・36.24 km、範囲に届くもの 48 鎖・22.32 km）は、計画が一度もコンパイルしない。

- ~~S7（7c から）: 坑口をつなぐ前に、汐留出口 24402125 の壁高欄が内回りの車線 0 に約 0.25 m 掛かる重なりを解く。~~ → A1 で分離壁 1 本にした（上の「P2.7-7 A1」、台帳の 3 件はレビュー待ちの new）。
- S7-2（A1 から）: 汐留の取付け 45068170 の上を出口ランプ 24402125 が通る（touchdown:24402125|45068170、45068170 の s 140〜181 で高さの差 3.8 → 0.66 m、横のずれ 1.3〜3 m）。坑口をつなぐと本線の車がこの下を走るので、取付けを掘割として下げて解く。
- R1-4b（A1 から、a1-answer3・4）: 分離壁の始まり・終わりのすりつけ（台帳の divider-jog、二層の作りと分離壁の作りの境で、壁が路肩の幅ぶん直角に動く）、壁の無い落差で main にもあるもの（台帳の bare-drop、ship 43 点・28 組）、車線の縁どうしが接して高さが違う所（ship 47 区間）、g < 0 の段違い（ship 157 区間）。
- A0（A1 の前、別の PR）: 親の幅の段（縁の頂点が同じ所に 2 つ）で、子が両方の頂点にリングを置く。ship の seam_hole 157249373:0|44804029（main 78 点 → A1 79 点）の元の作り。A0 の後に A1 を載せ直して測り直す。
- R1-4b（A1 から）: 分離壁が入らない先端（g < DIVIDER_MIN）でコンパイラが同一面を保つ（フラグ、ship の A/B）。入れば nose-step が消える。g < 0 の段違い（合流のくさび）は A1 では今のまま。
- R1（7c から）: 並走ランプの分離と断面（汐留出口と内回りの中心間隔 6.77 m）。footDeferrals.ts の 203832842 を戻すと、ship の 23273634 の端は地表端から seam に戻る（最急勾配 3.50 → 1.17 %）。急な地形で地形のコライダーが街路の路面より最大 1.28 m 低い所（24039751 の脇、main からある）。並走する街路の中央帯の規則が入ったら、structureDecisions.ts の 2 行を消し、lane-in-site 9 件を直す。895902565 s 70 の橋脚（区間 815 の下り車線の中心から 0.8 m、main と同じ）も中央帯の規則で扱う。汐留の分離壁の先端（内回り 24402611 の s 約 4951）から細い針状の面が約 2 m 延びて見える（撮影ラウンド 4 の nose-24402125-close、壁か路面かは未確定）。汐留の重なり（S7 の前に解く件）と同じ場所なので一緒に見る。並走する街路の中央帯の規則（中央帯を街路の断面に入れ、掘割の敷地に掛かる車線を車線にしない）と、それに合わせた足の扱い（footDeferrals.ts の 203832842 を戻す、737538573 の street-lane-over-cut）。穴の縁を測点の間で補間する。歩道の多角形・地形の破片（5.F）。
- PR #85 のレビュー（Fable、REQUEST_CHANGES）で直したもの: 探りで数える 3 類型（foot-side-join・street-lane-over-cut・lane-in-site）を、探りの一覧なしの `just update-expressway-ledger` で、run の block（dataHash）が台帳と違えば `new` に戻す（前の判断は `previous`、`ledger.ts keptProbeCases`・`reopenCases`）。7c のデータで試すと、22a06ab の前に数えた street-lane-over-cut:737538573 が block の違いで `new` に戻り、探り 3 本（穴の車線 14 本・最長 68 m、敷地の 9 か所、足の違反 0）を掛けて一覧を渡すと accepted 136・new 0 に戻った（計測と判断は変わらず、block の値だけ今のデータへ）。構造の決定の表をデータと突き合わせるテスト（表の run が既定データにあり、区間が viaduct）と、表の行数の上限（足 3・構造 4）のテスト。`check-expressway-lanes` の上限は定数 9 をやめ、フォルダの台帳の lane-in-site の件数（`--max` で上書き、台帳が無ければ数えるだけ）。探り 2 本はタイルが無くて飛ばしたチャンクがあれば終了コード 1。~~標識の「地表より下に無い」は、盛土で丸ごと外すのをやめ、地表 − 帯（`HEIGHT_STRUCTURES.ground.bandM` 1.5 m）で見る（24039751:0 の盛土の標識が地表の 0.26 m 下。`DEM_SINK_FLOOR` 0.25 m では落ちる: 地平 run は設計地盤線の帯で解くので、その帯が限度）。~~ → A2 で、`same` の区間の内の盛土と掘割は比べず、ほかは地表 − 0.01 m で見る形に直した（24039751:0 は `same` の内で 1.70 m 下にあり、帯も超えていた）。
- ~~R1（PR #85 のレビューから）: lane-in-site のキー（チャンク ID と丸めた区間）を run と街路で引く形へ（今は番号ずれで gone + new）。探りの判定（車線の中心が縁の内、3 m 以上）の単体テスト。`perf-deck.ts` のチャンク ID の直書きを run と距離へ。`withinCap` の kind を必須に（データテスト 2 本は渡すようにした）。決定で盛土の端に 10 m 未満の切れ端が残る場合の検証（今の 2 行では起きない）。~~ → 上の「A2」で済み。切れ端の最小は `smoothM`（20 m）に訂正した。行の端が 0.5 m の内なら盛土の端に合わせる。895902565 の行には 4.2 mm の切れ端があった。
- R1（7c1 から）: `roads.ts deckRank` の見直し（ランプが下の本線の `SURFACE_GATE` 2.5 m の内を通る所で locate が本線を答える、24402125:2 と 45068170:0）。ランプの足の先の地上部を OSM から取る（GSI と OSM の街路が 13〜15 m ずれる足）。F1 (a) の拡張（足の軸を先で横切る GSI 高速道路の線）。敷地が中央帯を並走する街路の断面に中央帯を入れ、車線を穴の外へ寄せる（この街路の内側の車線が実際に穴に掛かるかは未確認）。上の「P2.7-6 PR 7c1」。
- 標識（P5）、ナビ・自動運転・交通 AI の解除と合流（P6）、トンネル・掘割の地下の分合流と長い地下区間（P9 の残り、上の「逸脱と残課題（P9）」）。
- ~~同一面の床版の一体化（設計書 4.2）。P3 は相手の床版に載る壁を消すだけで、2 枚の床版は 5 cm 以内で重なったまま（描画のちらつき、車が移るときの最大 5 cm の段差）。~~ → P3.5 で一体化。
- PLATEAU の建物の切り抜き（入口ランプを横切る建物）。
- 4853799 の地表端は一般道とつながらない（ramp_unattached）。地平部が GSI に無いか、15 m より遠い。
- blocked（地表端の近くで床版が塞ぐ地上道路）の通行止め・迂回は未対応。
- 片勾配を有効にした描画（`?expressway=bank`）では、同一面の 2 本の中心の高さを揃えているだけなので、横断勾配 × 中心間隔（2.5 % × 3 m で 7 cm 程度）の差が残る。
- 二層の上の床版は、下の床版の上に来る橋脚を置かない（車線を貫かないため）。門形の橋脚は P3・P4。
- 鉄道の上の桁下 6.0 m、桁高、標準桁下高は未確認の仮定。

# 未解決の課題（2026-11-10 レビューからの更新）

- ~~**設計速度は run 単位**~~ → 区間ごとにした（`speedZones`）。チャンクの `V`・`gmax` は区間の値、`run.V` はその最高値。
- ~~**測点の間は線形補間**~~ → 測点に勾配を持たせ、エルミート補間（`profile.ts`）。曲率の変わる節点に測点を置き、面の上の勾配・曲率も検査（`checkSurface`）。デッキは面から 1 cm 以内まで断面を足す。
- ~~**レイヤを目標高に使う逸脱**~~ → 連結成分の一括 QP にして解消。路面は大きく下がった（上の表）。
- ~~**地表近くの床版が道路を塞ぐ箇所**~~ → `blocked` に記録した。扱いは P3。
- ~~**トンネル・掘割の区別**~~ → 端の `portal` で区別した（本体は P9）。
- ~~**ランプの半径**~~ → 6 件を run ごとに理由つきで許可。
- ~~**未収束の黙殺**~~ → `status` と `solver_not_converged`（上の「解法」）。
- ~~**重なりの記録**~~ → チャンクの `decks`（相手・関係・[s0, s1]）に記録した。P3 は実行時に重なりを再計算しない。
- ~~**面の契約**~~ → `profile.ts` の `frameAt`（平面と片勾配・地表は線形、標高はエルミート）と `surfaceHeight`（中心から u の高さ）。three に依存しない関数で、デッキはこれで床版を組み、P3 も同じものを使う。デッキのテストは頂点が曲線上（1 mm）にあることと、辺の中点が 1 cm 以内にあることを見る。
- ~~**許容の判定**~~ → 桁下（T4）と交差の判定は要求値以上をそのまま求める（−2 mm・−2 cm の甘さを撤去）。QP が 3 cm（地表）・1 cm（交差）内側を狙うので、ファイルの丸め（z 1 mm・地表 1 cm）より余裕がある。

## P2.6 に回すもの（全域の出荷に向けて）

**P2.6 の結果（2026-11-11）**: W1・W2・W9・(b)・(c) と未収束の原因究明は上の「P2.6」の節。(e) は試して採れなかった。全域の出荷条件は 6 項目中 1 項目（収束）だけ達成で、全域は出荷していない（public/data/expressway は試験区間のまま）。数字は r9 に更新した（本線の閉鎖 15、ランプ 8.3 %、重なり 332）。

**P2.7（次の PR）の範囲**: (1) `blocked` を推定（標準勾配の登り）でなく解で決める（41009552 のように最終解が越えている道路を blocked と書いており、全域のデータテストの blocked の項目が落ちる）。(2) 登りの区間を `climbLimit` で求め、T4 の除外にも同じ式を使う。(3) 測点の間隔: チャンクの境界を 3 m 以内の節点へ寄せ、必須の測点から 3 m 以内の測点を落とす（compile.ts の `stationPositions` と chunkRun の測点、面の勾配 3 件と T3 の 1 件の原因）。(4) 出荷範囲を定義し、第一種（E1・E17・E20・E83・16・C3 などの高速自動車国道）を外す。(5) 法令の床が交点 ±40 m だけに掛かっていること。(6) `deck_below_ground` をデータテストで独立に検査する。全域の出荷は P9（地上・掘割・トンネル）の後。

- **W1**: 段の反復で最良の状態を保つことと、段を進めた run の隣の run を検査すること。
- **W2**: 法令の拘束（第20・22・25条）と仮定の床（標準桁下・地表の 6.7 m）を、判定でも区別する。
- **W9**: V80 本線の平面の検査（T6）。
- **方針 (b)**: 分合流の C¹（標高・勾配の一致）は保つ。短い run の地表端は標高を帯（±数 cm）で受ける。短い連結路は親のエルミート面に従わせる。
- **方針 (c)**: 「V を下げる」段を、失敗した場所の周りだけに掛ける（32404414 は 120 m の V50 区間のために全体が V50 になった）。
- **方針 (d)**: 量子化差分は採らない。全域を出荷するかの判定で再評価する。
- **方針 (e)**: 232 組を手で許可しない。ノーズの従属と類型ごとの規則で減らす。
- **全域の出荷条件**: T1〜T7 違反 0、本線の未解決 0、全成分収束（`meta.solver.unconverged` 0）、未許可の deck_overlap 0、転送量（配信時圧縮込みで 1 MB 目安）と性能 A/B（perf-road-streaming を静かな機械で 5 回以上）。
- **橋脚の回避は地上道路の交差だけ**、**性能の測り直し**、**地表の標高の同梱**: P1 のまま。

[^p26]: P2.6 の全域計測

[^egov]: 法令本文

[^code]: 実装

[^tests]: テスト

[^shots]: 多視点の撮影

[^all]: 全域の生成

[^p3]: P3 の実行時（走れる高速道路）

[^drive]: 自車を一定速で走らせた記録

[^views-p3]: P3 の多視点レビュー

[^p7]: 構造物上書き（P7）

[^p9]: トンネルと掘割（P9）

[^p271]: P2.7-1 の出荷範囲とスコアカード

[^p273]: P2.7-3 の縦断の目的 v2

[^p273a]: P2.7-3a の実装と計測

[^p272]: 指示 scratchpad の p27/s2-instructions.md（設計 Fable）、計測は .qa/expressway/（ab-batch1.md、heights-*.json、i1-fixture-diff.txt、i6-ship-all-k1.5.txt）

[^p9drive]: P9 の走行の記録

[^views-p9]: P9 の多視点レビュー

[^egov34]: 道路構造令 第12条・第34条・第8条第5項

[^views-p7]: P7 の多視点レビュー

[^p7drive]: P7 の走行の記录

[^p35]: P3.5 の床版の一体化

[^drive35]: P3.5 の走行の記録

[^views-p35]: P3.5 の多視点レビュー

[^p276-7c]: 指示は scratchpad の p27/s6-pr7.md・s6-pr7c-stop.md・s6-pr7c-ledger.md・s6-pr7c-feet.md・review7c1/7c-stop-answer.md・7c-defer-answer.md・7c-hole-answer.md（設計 Fable）とユーザーの決定（203832842 を R1 まで出さない）。計測は `.cache/expressway-area/p7c*`・`.qa/expressway/p7c*`・`.qa/*.mts`（ローカル、git 管理外）。

[^p277-a1]: 指示は scratchpad の p27/s7r/plan.md 8 節と a1-answer.md（設計 Fable、2026-11-14〜15）。計測は `.qa/a1/`（dividers.mts・sides.mts・cmp.py・before.txt・after.txt、ローカル、git 管理外）。main は同じ commit の一時 worktree と vite :5312、A1 は :5311。

[^r1-1a]: 指示は scratchpad の p27/s7r/r1-1a-instructions.md・r1a-answer1.md・r1a-answer2.md（設計 Fable、2026-11-17）と、ユーザーの決定 U2・U10・U11。計測は `scripts/expresswayScopeProbe.ts`（計画を読むだけ）・`scripts/expresswayDistrictSizes.ts`・`scripts/expresswayOutsideGround.ts` と、`.cache/expressway-area/r1-*`・`.qa/expressway/r1-*`・`scope-probe-*`・`border-ramps-cut.json`（ローカル、git 管理外）。

[^r1-1a-review1]: レビューは scratchpad の p27/s7r/r1a-review1.md（Fable、2026-11-18）と s7-notes.md、ユーザーの決定 U3（2026-11-18）。計測は `.cache/expressway-area/r1-*`・`r1b-*`、`.qa/expressway/r1*`（ローカル、git 管理外）。生成は devshell の node（`just measure-expressway-area`）。
