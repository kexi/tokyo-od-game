---
type: Playbook
title: 高速道路の生成（OSM → 道路構造令の線形 → デッキ、P1・縦断の一括解・P2.6 の全域向けの縦断・P3 の走行・P3.5 の床版の一体化・P7 の構造物上書き・G6 の標識・P9 のトンネルと掘割・P2.7-2 の固定点 block・P2.7-3a の 41009552・P2.7-3 の縦断の目的 v2・P2.7-4 の許容の台帳と配信形式 v6・P2.7-5 の v2 の有効化・P2.7-6 PR 1 の構造を高さから決める・PR 5 の継ぎ目の段）
description: 首都圏の都市高速を OSM の motorway / motorway_link からビルド時に道路構造令の平面・縦断線形へコンパイルし（src/expressway/、scripts/expressway.ts）、public/data/expressway の ≤300 m チャンクを実行時に床版・壁高欄・箱桁・橋脚へ押し出す（src/world/expresswayDeck.ts、?expressway で有効）。P3 でコライダー（床版と壁高欄の trimesh・橋脚の cuboid）・道路グラフへの統合（端点 ID・ランプ端の接続）・区画線を足し、入口ランプから本線に乗って出口から一般道へ戻る走行を確かめた（多視点レビュー 3 周で収束）。縦断は分合流・交差・床版の重なりでつながる run の連結成分ごとに 1 つの凸 QP（疎な内点法）で解き、高さは交差と重なりの拘束からだけ決める（layer を目標高に使う P1 の逸脱を解消）。設計速度は区間ごと、測点は勾配つきでエルミート補間。試験区間（浜崎橋JCT〜芝公園）は T1〜T7 違反 0、deck_overlap は 4 組・41 測点（理由つき許可）。全域の解けない run、データ量、性能と見た目の確認。P2.6 で縦断の解き方を全域向けに直した（終了判定 gapTol、短い連結路を親 2 本の 3 次エルミート `follow` に、短い run の地表端を帯に、仮定の床は最も低い V でも解けない run の最終段で W_FLOOR の弱い行に、V 下げは失敗位置の ±150 m、閉鎖した run を meta の `closed` に）。全域を計測（解けた run 357 → 702／763）したが出荷条件は満たさず、全域は出荷していない（本線の閉鎖 15、ランプの閉鎖 8.3 %、未許可の重なり 332 組）。試験区間は解き方の変更で高さが最大 1.86 m 動いた。P7 の構造物の固定（ProfilePin）とは main の取り込みで統合した（連結路の 3 次式は固定を持てないので構造物上の run は連結路にしない）。P7 で構造物上書き（structures.ts）。レインボーブリッジの deckLevels に上層・下層の平面（補剛桁の範囲）と縦断（sRange）を固定し、帯の断面・描画だけの apron・橋脚と桁の抑止、3 m 規則でビルド失敗、下層の臨港道路を street として同じコンパイラに（XW_VERSION 4、範囲 rainbow）。P9 でトンネル・掘割（below.ts）。tunnel / cut / layer<0 の区間を below run として地表より下へ解き（土被りの天井は坑口から第20条の勾配で届く所だけ）、高架とは seam で C¹ につなぎ、坑口の記録 portals をタイルに（meta の features に below）。実行時はトンネルの箱（監査路・側壁・天井・照明）と掘割の擁壁をコライダーつきで押し出し、地形（コライダーは穴でクリップ）・一般道・歩道・建物を穴で切り欠き、トンネル内は空と太陽を遮って照明に置き換える（範囲 azabudai・azabudai_exit、XW_VERSION 4 のまま）。 P6 で規制速度をチャンクごとの OSM maxspeed（XW_VERSION 5、グラフの limit は G6 の posted）、範囲 shiodome（汐留の出入口）、W6 の at-grade の辿り直し、自動運転・交通 AI・ナビの解除と走行の確認（芝公園入口→C1 内回り→汐留出口→一般道を走り切った）。P2.7-1 で出荷範囲（`--range ship` で事業者の本線 ∩ 23 区とランプ、scope.ts）と全域スコアカード（`--report`、report.ts で閉鎖の根と道連れ・重なりの類型・地表追従・サイズ・ソルバ・段の時間・抽出の SHA-256）、抽出の固定、`--below all`。ship/pruned 323 run・本線の閉鎖 10・未許可の重なり 175 組・gzip 1.04 MB、pruneBelow なしでも未収束 0（P9 の破綻の記述を訂正）。P2.7-2 で固定点 block（`--partition blocks`、blocks.ts、計測専用・既定は無効でデータ不変）。本線の静かな区間の固定点で片に切り、片の連結成分ごとに solveShedding、固定点の値は seam の組の路線解。ship の A/B で pruned は k=1・1.5 が一括解と同等だが、all ではどの k も本線の閉鎖 14 → 18（41009552 が根に戻る）で未達、k は 2 のまま。既定範囲の all は解く段 130.6 → 13.1 s。P2.7-3 で縦断の目的 v2（`--objective v2`、計測専用・既定は無効でデータ不変）。目標を地表の上側包絡（designGround.ts）+ 標準桁下、地下は下側包絡 − 深さにし、弧ごとの勾配変化に L1（重み 1.5）。ship の強制の無い区間で反転 1.68 → 0.77 回/km（目標 0.8 以下）は届き、短波長相関 0.553 → 0.228・σ 0.696 → 0.433 m（目標 0.15・0.4）は未達。blocks の A/B のやり直しは all で T2 +3 になり k は暫定 1.5 のまま未達。
tags: [roads, terrain, rendering, testing, licensing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-11T10:00:00+09:00 }
verified:
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

## 地区（暫定、`src/expressway/districts.ts`）

central（C1・Y・1・2・3・4・10・11・B）、east（5・6・7・9・S1、C2 の箱の外）、yamate（C2 のうち緯度 35.745 未満かつ経度 139.77 未満）、outside（表に無い ref）。本線はチャンクの最も長い ref と中央の点、ref の無い本線・ランプ・street は親をたどる（始点側から）、だめなら最寄りの本線。

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
| W7 既定範囲の東京港トンネル | 既定範囲を compile にすると東京港トンネル 4854085 ほか約 5.1 km（below run）を範囲に取り込む。9bbad5e（s6r）では既定範囲のビルドが 1,112 run・39,406 変数の成分で、解く段 204 s（tags は 4.9 s）。C1 の修正でトンネルが成分をつなぐのを許すので、pruned の「成分を混ぜない」は地平 run のあるビルドでは効かない。これを受け入れるか                                                                                                                                                                              |
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

# 未対応・既知の欠落

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
