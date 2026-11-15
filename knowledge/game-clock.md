---
type: Reference
title: ゲームの時計と壁時計（違反の判定と世界の時間を、車が進む時間にそろえる）
description: 1 フレームが MAX_FRAME_S（0.05 秒）を超えると世界は壁時計より遅く進むのに、違反の判定は壁時計で時間を測っていたため、重いページで合図の 6 秒の窓などが世界の時間より速く過ぎ、自動運転の走行（auto-shiodome-shibakoen）が負荷しだいで合図不履行を取られた。step の now をゲームの時計（dt の積み上げ）にし、世界の外（読み込みの待ち・ストリーミングと HUD の間引き・ログの所要時間）だけを壁時計 wall にした。時刻を読む所の分類の表、自分で performance.now() を読んでいたモジュール（警察・電話・追跡・ナビ）の直し方、テストと源の検査、CPU の絞りを付けた床版の走行の結果。
tags: [traffic-law, physics, testing]
status: draft
stale_after: 2027-05-15T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-15T10:00:00Z }
verified:
  - { by: process:check-deck-drive, at: 2026-11-15T14:09:00Z }
  - { by: process:vitest, at: 2026-11-15T09:34:00Z }
  - { by: process:tsc, at: 2026-11-15T09:34:00Z }
sources:
  - id: code
    resource: src/main.ts の step（3 千行台の法規の判定、now を受け取る呼び出しの全部）と step の外の performance.now() の 52 か所、src/game/frameClock.ts、policePatrol.ts、phone.ts、pursuitDirector.ts、navGuide.ts、emergency.ts、missions.ts、parkingPatrol.ts、src/world/orbis.ts・transit.ts・buildings.ts・streetLights.ts・signs.ts・guideSigns.ts・expresswaySigns.ts・water.ts を読んだ（2026-11-15）
    title: 時刻を読む所
    author: claude-opus-5-5
  - id: a1-record
    resource: A1 の作業ツリーの .qa/a1/sig-main1.jsonl・sig-a1.jsonl・drive-swap1〜3（ローカル・git 管理外。drive-swap3 の auto-shiodome-shibakoen が signalOmission「右折の合図を出さずに曲がった @35.65303,139.74665」で失敗、1・2 は合格）
    title: 原因を切り分けた記録（A1、2026-11-15）
  - id: drives
    resource: just check-deck-drive（scripts/qa/drive-deck.ts、--cpu-throttle 付き）を main（f54368e）と T1 で。結果の JSON は scratchpad/t1/runs/（ローカル・git 管理外）。2026-11-15T09:38〜14:09Z、M2 Max、他の担当の計測と並走した時間帯あり（負荷平均 最大 445）
    title: 床版の走行（main と T1、CPU の絞り 1 倍・4 倍）
    author: claude-opus-5-5
  - id: tests
    resource: tests/gameClock.test.ts（16 件）、tests/frameClock.test.ts、全体 174 files
    title: 振る舞いと源の検査
    author: claude-opus-5-5
---

# 何が起きていたか

`step`（src/main.ts）は、フレームの時刻 `now` に壁時計（rAF と `__game.advance` の時刻、ms）を使い、世界を進める量 `dt` には `min(MAX_FRAME_S, 壁時計の経過)` を使っていた（frameClock.ts の `clockStep`）。1 フレームが 50 ms を超えると、世界（車・交通・物理）は壁時計より遅く進む。[^code]

一方、違反の判定は `now` の差で時間を測っていた。合図（第53条）は「交差点を 25 m 過ぎた所で、その側の合図が直近 6,000 ms の内に出ていたか」。QA のヘッドレス Chrome では、ゲームの 0.25 秒に壁時計で 1.3〜2.5 秒かかっていて、世界は壁時計の約 1/6 の速さだった。6 秒の窓はゲームの時間で約 1 秒しか無く、自動運転が合図を消してから 25 m 走る間に過ぎた。[^a1-record]

これは QA だけの問題ではない。毎秒 20 コマを下回る端末では、遊ぶ人にも同じずれが起きる（世界は遅く進むのに、違反の時間だけが実時間で進む）。遅い端末で実際に起きているかは確かめていない。

# 2 つの時計

- **ゲームの時計**（ms）: `gameStep(game, dt)`（frameClock.ts）でフレームごとに `dt × 1000` を足す。ループが始まる時の壁時計の値から始める（0 からではない。`-Infinity` や 0 の初期値との比べ方を変えないため）。世界の中で起きたことの間隔は、すべてこれで測る。main.ts では `now` と `gameNow()`（フレームの間に走るハンドラー用。直前のフレームの値）。
- **壁時計**（ms）: `clockStep` の返す `last`。main.ts の `step` では `wall`。世界の外のことだけに使う。

1 フレームが 50 ms 以下なら、2 つは同じだけ進む（浮動小数の誤差を除く）。挙動は前と同じ。

既定をゲームの時計にして、壁時計の所を数える形にした。違反の所だけ `gameNow` に替える案は採らなかった。`now` を受け取る所が多く（main.ts の `now - ` だけで 31 か所、ほかに `update(…, now)` の呼び出しが十数）、替え漏れが出る。既定をゲームの時計にすれば、漏れは安全な側（世界の時間）に倒れる。

型でゲームの ms と壁の ms を分ける案は採らなかった。変更が大きくなる。源の検査（下）で足りなければ、次に考える。

# 時刻を読む所の分類

`step` から呼ばれる経路と、`step` の外で世界の時刻を置く所の全部。[^code]

| 所                                                                                                                                                                                                                             | 何                                                                                                                                  | 時計                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 法規の判定の継続時間（速度超過 3 s、右側通行 2 s、逆走 1.5 s、通行止め 1.5 s、徐行 1.5 s、通行帯 20 s）                                                                                                                        | `heldSince`・`hasHeldOver`（lawTimers.ts）                                                                                          | ゲーム                 |
| 法規の判定の間隔（`lastLawCheck` 200 ms）                                                                                                                                                                                      | 世界の中での見本の取り方（何 m ごとに見るか）                                                                                       | ゲーム                 |
| 合図（第53条）の記憶と 6 s の窓                                                                                                                                                                                                | `noteIndicators`・`isSignalOmitted`（signalOmission.ts）                                                                            | ゲーム                 |
| `book` / `law.commit` の時刻と再計上までの間隔（第 3 引数）                                                                                                                                                                    | 記録の `at`、traffic.ts の cooldown                                                                                                 | ゲーム                 |
| 転回の 20 s、一時停止の直前の停止 15 s、事故の直後（`lastCrashAt`）                                                                                                                                                            | 直前の記憶                                                                                                                          | ゲーム                 |
| 信号（`control.update(now / 1000)`）と信号無視の猶予（`signalCheck`）                                                                                                                                                          | 現示の周期。実時刻に合わせた物ではない（ページを開いてからの経過で回る）                                                            | ゲーム                 |
| オービス（`orbis.check`・`update`、発光）                                                                                                                                                                                      | 取締の冷却と発光の時間。`flash` の既定値 `performance.now()` は外した                                                               | ゲーム                 |
| 高速道路の法規（`expresswayWatch.check` の `now`・`sinceCrashS`）                                                                                                                                                              | 駐停車の 10 s など                                                                                                                  | ゲーム                 |
| 衝突の重複の抑え（歩行者・接触の 3 s）、救護（`emergency.start`・`update`）、事故の画面（`updateIncidentPanel`）                                                                                                               |                                                                                                                                     | ゲーム                 |
| 警察（`updatePolice`・`PolicePatrol`）: 出動の間隔、赤色灯の遅れ、呼びかけ、解放後の 8 s・20 s                                                                                                                                 | PolicePatrol は時計を受け取る（`gameNow`）                                                                                          | ゲーム                 |
| 追跡（`pursuitDirector.update`、host の `now()`、`leftSignalAgo`）                                                                                                                                                             | 事故・信号無視の時刻、テレビの 60 s                                                                                                 | ゲーム                 |
| 駐車監視員（`patrol.update`）                                                                                                                                                                                                  | 来るまでの 30〜90 s                                                                                                                 | ゲーム                 |
| 電話の使用中（`phone.isInUse`、触った時刻、通話の時間）                                                                                                                                                                        | Phone は時計を受け取る（`gameNow`）                                                                                                 | ゲーム                 |
| アイドリングの 20 s（`stoppedSince`）、川に落ちた 1.5 s（`adriftSince`）、床版の上の停止の記録 3 s（`noteDeckStall`）                                                                                                          |                                                                                                                                     | ゲーム                 |
| タクシー（`updateTaxi`）、ミッション（`missions.start*`・`check`・`remaining`）                                                                                                                                                | 制限時間                                                                                                                            | ゲーム                 |
| ナビ（`nav.update` の `now`、繰り返しの 10 s）                                                                                                                                                                                 | 経路外れの 1.5 s など。繰り返しの窓だけ `performance.now()` だったのを `now` に                                                     | ゲーム                 |
| 再現データ（`recorder.capture`、切り出しの `setInterval`、`chaseMoment` の `at`）                                                                                                                                              | 違反の前後 5 s                                                                                                                      | ゲーム                 |
| 目撃ポストの 2.5〜5.5 s（`postsDue`・`afterViolations`）                                                                                                                                                                       | 目撃者が撮って打つまで                                                                                                              | ゲーム                 |
| 道路の規制の時刻合わせ（`lastClockSync` 5 s）                                                                                                                                                                                  | 世界の時刻（env）を道路へ渡す間隔                                                                                                   | ゲーム                 |
| 車内の計器・ナビのテレビ・カーナビの画面（`cockpit.update`・`naviTv`・`carNavi`・`ribbon`）                                                                                                                                    | 表示の点滅と再描画の間隔。どちらでもよいので既定のまま                                                                              | ゲーム                 |
| 読み込みの待ち（`loadStart`・`waited`）、移動の待ち（`warping.since`・`finishWarp`）、歩道を待つ `streetSpawnSince`                                                                                                            | 読み込みは世界の外で進む                                                                                                            | 壁                     |
| ストリーミングの間引き（`buildings.update`・`signs.update`・`guideSigns.update`・`expresswaySigns.update`・`deckPlates.update`・`furniture.update`・`streetLights.update`・`water.renderReflection`・POI の `lastPoiRefresh`） | モジュールの中でも `performance.now()` を読む物がある（buildings の `createdAt`、streetLights の `lastSettle`）ので、同じ時計を渡す | 壁                     |
| 床版の判定の間隔（`lastDeckCheck` 100 ms）、位置の問い合わせ（`lastLocate` 500 ms）、HUD（`lastHud` 150 ms、`updateSocial` の間引き）、バスの取得（`transit.update`）                                                          | 通信と描画の間引き                                                                                                                  | 壁                     |
| 方向指示器の点滅とリレー音（`blink`）、パトカーの点滅（carModel・minimap）                                                                                                                                                     | 見た目と音だけ。判定は読まない                                                                                                      | 壁                     |
| 自動運転の計画の予算（autoDriver の `PLAN_MS`）、切り返しの探索の打ち切り（autoRecovery）、ログの `durationMs`・perf                                                                                                           | フレームの予算                                                                                                                      | 壁                     |
| 無免許の警告の 5 s（`unlicensedWarnedAt`）、追跡の場面のカメラ（pursuitScene の `shotStart`）、ナビ・車内の光の確かめ（cockpit 1 s）                                                                                           | 画面の上のこと                                                                                                                      | 壁                     |
| 電話の時計、記録の `savedAt` と id、画面の保存の名前、バスの位置（ODPT の実時刻）、environment の real モード                                                                                                                  | 実際の日時                                                                                                                          | 実時刻（`Date.now()`） |

「分からない」に入れた物は無い。迷った物: 車内の計器・カーナビの表示（どちらでもよく、既定のゲームのまま）、通話の時間の表示（Phone の時計に合わせてゲーム）。

# 自分で時計を読んでいたモジュール

置く所と比べる所が別の時計になっていた物。呼ぶ側（main.ts）からゲームの時計を渡す形にした。

- `PolicePatrol`: `lightsAt`・`lastCallout`・`releasedAt`・`leaveUntil` を `performance.now()` で置き、`update(…, now)` と main.ts の `now - u.releasedAt > 8000` で比べていた。コンストラクターで時計（`gameNow`）を受け取る。
- `Phone`: `touchedAt` を `performance.now()` で置き、`isInUse(now)` で比べていた。コンストラクターの最後で時計を受け取る（通話の時間も同じ時計）。
- `PursuitDirector`: 事故・信号無視・負傷の時刻と、ひき逃げの `book` を `performance.now()` で置き、`update(dt, now)` の `now` と比べていた。host に `now()` を足した。
- `NavGuide`: 他の間隔は `update` の `now` なのに、繰り返しの 10 s だけ `performance.now()` だった。
- `Orbis.flash` の `now = performance.now()` の既定値を外した（呼ぶのは `check` だけで、いつも `now` を渡していた）。
- main.ts の `step` の外で世界の時刻を置く所（事故の `onAccident`、ミッションの開始、駐車の `book`・`chargeOwner`、QA の `book` フック、`leftSignalAgo`、目撃ポスト、出動の初めの `policeDueAt`、再現データの切り出し）は `gameNow()`。

# 見張り（テスト）

tests/gameClock.test.ts（何を保証するか）:[^tests]

1. `gameStep`: 16.7 ms ごとの時刻では壁時計と同じだけ進む。300 ms ごとでは 1 フレーム 50 ms ずつ。時刻が戻るフレームでは進まない。
2. 合図: 合図を出して曲がり、合図が消えて 3 秒後（30 m 先）に判定の点に着く並びで、16.7 ms でも 300 ms でも違反にならない。同じ並びを壁時計で数えると、300 ms のときだけ違反になる（直す前の不具合を、テストの中で再現して確かめた）。
3. 合図を出さずに曲がる並びは、どちらの重さでも違反になる。
4. 逆走（1.5 s）: 12 m（1.2 s）は取らない、25 m（2.5 s）は取る。どちらの重さでも同じ。壁時計では 300 ms で 12 m も取っていた。
5. 再計上の間隔（15 s）: ゲームの 1 分で 4 回。どちらの重さでも同じ。
6. 源の検査: 世界の時間を持つファイル（法規・警察・電話・追跡・信号・交通 AI・歩行者・自動運転・オービスなど 24 本と src/signals/ の全部）が `performance.now()`・`Date.now()` を直に呼ばない。残す物は理由の表に書く（autoDriver の計画の予算、traffic.ts の記録の id と `savedAt`）。main.ts の `step` の中に `performance.now()` が無いこと、`book`・`commit`・`isInUse`・ミッションの開始に `performance.now()` を渡す所が無いこと。
7. 電話（触った時刻と `isInUse`）と警察（覆面の赤色灯の 6 s）が、渡された時計で置いて比べること（壁時計から大きく離した時計で確かめる）。

# 走行での確かめ

`just check-deck-drive`（自動運転の合否は到着と違反 0、床版の上の dy の絶対値 0.15 m 以下など。線は変えていない）。[^drives]

| 経路                    | 絞り | main（f54368e）                                                                                               | T1                                                                                      |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| auto-shiodome-shibakoen | 1 倍 | 5 回中 5 回 合図不履行（@35.65303,139.74666、A1 の記録と同じ所）。負荷が下がった後の 1 回（全経路の中）は合格 | 有効な 5 回とも合格（違反 0・到着）。ほかに Chrome が起動せず無効の 2 回                |
| auto-shiodome-shibakoen | 4 倍 | 2 回とも 合図不履行 ＋ 連結路での停止（xwStopping @35.66345,139.76307、出発の連結路の足）                     | 3 回とも合格                                                                            |
| auto-shibakoen-shiodome | 1 倍 | 5 回: 停止 3、xwStopping 2、dy の超過 2（45068170:0 で 1.295 m・0.326 m）、合格 1。全経路の中の 1 回は合格    | 5 回とも 24402125:2 で停止、うち 2 回 xwStopping（@35.66302,139.76237）                 |
| auto-shibakoen-shiodome | 4 倍 | 走らせていない                                                                                                | 1 回: 停止 ＋ xwStopping（同じ所）。ここで止める条件に当たり、残り 2 回は走らせていない |
| 一定速の 13 経路        | 1 倍 | 全部 合格（dy の絶対値 0.073〜0.116 m）                                                                       | 走らせていない（止める条件に当たったため）                                              |

- 合図不履行は、T1 では 1 倍・4 倍とも 0（有効 8 回）。main は負荷が高い間と 4 倍で毎回出た。
- auto-shibakoen-shiodome の 24402125:2（汐留出口交差点の手前、連結路の足）での停止は、main でも同じ所で起きる。T1 で消えなかったので、時計のずれではない。この停止が 10 秒を超えると xwStopping（第75条の8）が取られる。判定（expresswayLaw.ts の `standSince`・`elapsed`）は `x.now`、つまりゲームの時計を読む。替え漏れではなく、世界の中で 10 秒以上止まっていて、免除（`mustStop`・`queueAhead`・`waitingToMerge`）のどれにも当たっていない。何で止まっているか（連結路の足の信号待ちか）は確かめていない。
- main の auto-shiodome-shibakoen 4 倍の xwStopping（出発の連結路の足）は T1 の 4 倍では出ていない。drive-deck.ts のコメントにある「advance の間に連結路の足で立っていた車が xwStopping を取られた」のと同じ、壁時計の 10 秒だと思われる（確かめていない）。

QA の道具の不具合（直していない）: Chrome が 10 秒以内に起動しないと `launch` は「Chrome did not start」で失敗するが、遅れて起動した Chrome が残り、drive-deck.ts が結果を書いた後も終わらない。負荷が高いと、全経路の走行（`--route all`）が試すたびに Chrome を残し、機械の負荷をさらに上げた。

# 確かめていないこと

- 遅い端末で、このずれが実際に遊ぶ人に出ていたか（毎秒 20 コマを下回る端末での違反の記録は見ていない）。
- 一時停止中（設定の画面）と再現の再生中も、ゲームの時計は前と同じく進む（前の壁時計と同じ振る舞いにした）。止めるべきかは決めていない。
- タブが裏に回って rAF が止まった後、戻った最初のフレームでは、前は壁時計の分だけ一度に時間が過ぎていた（違反の継続時間も）。今は 50 ms だけ進む。遊ぶ人に見える違いは確かめていない。
