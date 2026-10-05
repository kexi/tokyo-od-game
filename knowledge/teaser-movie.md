---
type: Playbook
title: ティザー動画の撮り方（仮想時計でのコマ送り撮影・演出・落とし穴）
description: scripts/teaser の撮影パイプライン（ヘッドレス Chrome で開発ビルドを 1/30 秒ずつ進めて撮り、ffmpeg で切り貼りして合成音楽を付ける）の仕組みと、2026-10-05 の 3 本目（72 秒）を撮るときに踏んだ落とし穴。ゲームの advance(dt) では実時間の描画時間が dt に入ってしまうので、performance.now・rAF・タイマー・CSS アニメーションをページ内で仮想時計に差し替えたこと、ゲームが開始時に時刻と天気を乱数で決めること、信号無視・追跡・切符・Y・自動運転タクシーの段取り、レンズフレアの探りが太陽の中心に黒い四角を出すバグ（未修正）を記録する。2026-10-05 追記として、同じスクリプトの `--lang en` で撮る英語版の紹介動画（機能を 1 つずつ、115.5 秒、cuts.mjs のカット表）と、その段取り（一時停止とアイドリング、オービス、逃走、路肩での停止の会話、事故と 119・110、目的地の検索、歩行と会話、ゲームパッドの設定、夜の塔）、新しい落とし穴 15 件。切符の前に路肩の会話が入るようになり、待つだけでは切符が開かなくなっていたこと（日本語版の段取りの訂正）も記録する。同じ日の追記として、曲にゲームの音を重ねる仕組み（ゲーム自身の GameAudio・SpatialAudio・判子の音・テレビの音を OfflineAudioContext で区間ごとに鳴らす sound.mjs、場面の表 sounds.mjs、ダッキングと −16 LUFS）と、ゲームに無い音（オービスのシャッター・Y の通知・電話の発信音など）を足さなかったことも記録する。
tags: [testing, rendering]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T14:45:00Z }
sources:
  - id: teaser-sound
    resource: 2026-10-05 の音付け（HEAD 2ebc895 の開発ビルド、Google Chrome headless=new の CDP 9342 番）。区間ごとの書き出しのピークと、ffmpeg ebur128 での曲とゲームの音の区間ごとのラウドネス、スペクトログラムの目視、出力の ebur128（英語版 −16.0 LUFS・真のピーク −2.2 dBTP、日本語版 −16.1 LUFS・−2.9 dBTP）、映像ストリームの MD5（音を付ける前と同じ）
    title: ティザーの音付け（曲にゲームの音を重ねる）
    author: claude-opus-5-5/1m
  - id: teaser-en
    resource: 2026-10-05 の英語版の撮影（HEAD 53ef83b（違反の判子の英語の読み 5fadb8c を含む）を git archive した開発ビルドを vite preview の 4190 番で配信、Google Chrome headless=new の CDP 9342 番、MacBook Pro M2 Max、他のエージェントが並行で作業中）。全セッション 3 回と部分撮り直しのログ（scratchpad の run-all.log・run-rest.log）、区間ごとのコマの目視（6 コマの一覧）、out/teaser.en-sheet.jpg
    title: 英語版の紹介動画の撮影と試し撮り
    author: claude-opus-5-5/1m
  - id: teaser3
    resource: 2026-10-05 の撮影（HEAD 3702235 を git archive した開発ビルドを vite preview で配信、Google Chrome 154.0.8037.97 headless=new、MacBook Pro M2 Max、負荷平均 8〜9 = 他のエージェントが並行で作業中）。scratchpad の probe/p1〜p18.mjs と run1〜run6・final のログ
    title: ティザー 3 本目の撮影と試し撮り
    author: claude-opus-5-5/1m
  - id: teaser-v2
    resource: out/teaser-v2.mp4（同日朝の 2 本目、65 秒）
    title: 2 本目のティザー
    author: claude-opus-5-5/1m
---

# 何をしているか

`just make-teaser`（`node scripts/teaser/teaser.mjs --base <開発サーバーか開発ビルド>`）が、ヘッドレス Chrome でゲームを開き、ショットごとにカメラ・HUD・字幕を決めて 1 コマずつ進めながら撮り、ffmpeg で 1920×1080・30 fps の H.264（yuv420p、limited range）＋ AAC にする。[^teaser3]

| ファイル                     | 役割                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/teaser/teaser.mjs`  | 絵コンテ。セッション（読み込み 1 回）ごとにショットを撮り、`out/teaser-frames/<section>/` に JPEG を書く。最後に `EDIT` の順に並べて音楽と合わせる |
| `scripts/teaser/sounds.mjs`  | 区間ごとの音の場面（2026-10-05 追加）: 聞く位置、自車の速さとアクセル、雨、周りの車、サイレン、判子の音の時刻、ダッキング、音量                    |
| `scripts/teaser/sfxPage.mjs` | ページ内で場面を鳴らす（ゲームの GameAudio・SpatialAudio・Stamps・ナビのテレビの音を OfflineAudioContext で、1/30 秒ごとに更新）                   |
| `scripts/teaser/sound.mjs`   | 区間の音をカットに並べ、曲と混ぜ（mix.py）、−16 LUFS に合わせて映像はそのままで入れ直す。teaser.mjs が最後に呼ぶ（`sfx`）                          |
| `scripts/teaser/mix.py`      | 曲とゲームの音の混ぜ: ゲームの音のピークリミッター（−6 dBFS）、曲のダッキング（−6 dB）                                                             |
| `scripts/teaser/cuts.mjs`    | 言語ごとのカット表（2026-10-05 追加）: 区間の順・長さ・字幕・タイトルとエンドカードの文言・音楽の区切り。`--lang ja`（既定）と `--lang en`         |
| `scripts/teaser/clock.mjs`   | ページに最初に差し込む仮想時計（`window.__clock`）                                                                                                 |
| `scripts/teaser/page.mjs`    | ページ内の演出（`window.__tz`）: カメラ、運転席の目線、HUD の出し分け、字幕・タイトル・エンドカード、画面の寄り、定速走行、太陽の黒点隠し          |
| `scripts/teaser/music.py`    | 合成した BGM。`drop,break,break_end,outro` の秒数を渡すと区切りを小節に合わせる                                                                    |
| `scripts/qa/browser.mjs`     | CDP ドライバ。`preload`（`Page.addScriptToEvaluateOnNewDocument`）を足し、ポートが使用中なら起動を拒む                                             |

- `--only night,day` で一部のセッションだけ撮り直せる。撮っていない区間があれば編集は飛ばす。
- 撮影は他の作業で作業ツリーが変わっていても HEAD の絵になるよう、`git archive HEAD` を展開して `vite build --mode development` し、`vite preview` で配信したものを撮った（開発ビルドにだけ `window.__game` がある）。
- 描画方式は全セッションで WebGPU（`renderer.backend.isWebGPUBackend`）。ヘッドレスでも `--enable-gpu --use-angle=metal` で WebGPU が使えた。[^teaser3]

# 仮想時計でのコマ送り

ゲームの `advance(dt)` は `step(performance.now())` を回すだけで、`step` の dt は実時間（上限 50 ms）。しかもページ自身の rAF ループも動き続ける。混んだマシンでは 1 コマの描画に 50 ms 以上かかり、動画が早回しでガクつく（2 本目はこの方式だった）。[^teaser-v2]

`clock.mjs` は読み込みの間は実時間のまま、`__clock.start()` 以降は次を止め、`__clock.frame(ms)` でだけ進める。

- `performance.now` と `Date.now`
- `requestAnimationFrame`（溜めておき、frame で仮想時刻を渡して呼ぶ。start 前に頼まれた分も次の frame に回す）
- `setTimeout` / `setInterval`（start 後に作られたもの）
- CSS アニメーションとトランジション（`document.getAnimations()` を毎コマ pause して currentTime を進める。トーストの出入り・Y の吹き出しもコマどおり）

ゲームの `step` はちょうど 1/30 秒の dt で 1 回描く。物理は固定ステップで 2 回進む。ゲーム内の時計は dt から進むので、時計の早回しは `env.gameMs` に足して作る。

コスト（1920×1080、画質 最高）: 1 コマ約 47 ms、JPEG（品質 92）の撮影込みで約 92 ms。[^teaser3]

Why not CDP の仮想時間（`Emulation.setVirtualTimePolicy`）: new headless の rAF を止められず、ゲームの rAF ループと二重に進む。Why not `HeadlessExperimental.beginFrame`: 旧 headless 専用。

# 演出の決まりごと

- 時刻と天気は **`start()` の後に** HUD のボタンで設定する。ゲームは開始時に時刻と天気を乱数で決め直す（夜・雨を開始前に選んでも 17 時台・晴れで始まった）。雨の濡れは `env.wetness` と `overcast` を 1 にして最初から濡らす。
- 画質は `tod.graphics` に 最高 の各値を入れてから読み込む（`preset` キーだけでは効かない。各項目から一致するプリセットが決まる）。言語 `tod.lang=ja`、ミラーの飾り `tod.controls.charm=both`、一度きりのヒント `tod.charmTip` `tod.tvNotice` も先に入れる。
- 光の柱（`field.beams/gems`）と路面の矢印（`ribbon`）は雰囲気のショットでは消す。
- カメラを切り替えた直後のコマはブラー（画質 ブラー 弱）で流れる。各ショットは撮る前に 2 コマ回す。
- 運転席の目線を少し振るときは、ゲームが置いた目の位置を車体の座標で覚え、車に載せたまま回す（`__tz.seat(yaw, pitch, fov)`）。ミラーの飾りは (0.84, 0.10, 46°)、ナビの画面は (0.57, −0.25, 24°)。
- `設定` と切符は `showModal` のダイアログで top layer にある。body を拡大しても動かないので、開いているダイアログも同じ点を中心に拡大する。字幕の層は popover にし、ダイアログを開いた後で出し直して上に重ねる。
- 字幕やタイトルの箱に `translate` を付けると、それが絶対配置の子の包含ブロックになる。高さ 0 の箱に `bottom: 70px` の子を置くと画面の上に消えた。箱自体を `position: absolute; inset: 0` にする。
- Y の返信は実時間で 8 秒に 1 件。5.5 秒のショットでは時計を 6 倍にして、数と返信が増えていくのを見せた。

# 段取り（信号無視から切符、Y まで）

1. 既定のスタート地点の前方の信号（`control.ahead(pos, fwd, 200)`。HUD の「🚦 赤・12m」は 45 m 以内でしか出ない）を覚える。
2. 巡回のパトカーが出るまで待つ。覆面は 6 秒ライトを点けずに追尾するので、`kind === 'patrol'` を選ぶ。
3. 信号が黄になった瞬間に、自車を停止線の 44 m 手前に 40 km/h で、パトカーをその 20 m 後ろに置く。信号は決定的（周期 45 s、青 20/15 s、黄 3 s、全赤 2 s）なので、赤になって約 1 秒後に停止線を越え、`book(VIOLATIONS.signal)` → パトカーが見て追跡になる。
4. 自車を 26 km/h に落としてパトカーを近づけ、止まる。止まって 2.5 秒、22 m 以内にいると切符のダイアログが開く。信号で引っかかって来ないときはパトカーを 9 m 後ろに移す。
   - **2026-10-05 訂正**: 今のゲームでは、止まると警察官が窓まで歩いてきて会話（窓を開ける → 免許証 → 違反の説明 → 「その通りです」→ 処分）があり、その後で切符が開く（[追跡とその後](pursuit-and-aftermath.md)）。待つだけでは切符は開かない（英語版の 1 回目の撮影で 1,200 コマ待って `open: false`）。teaser.mjs の `answerStop` が会話の選択肢（`#stop-dialogue .stop-choices button[data-choice]` の openWindow・showLicence・seen・agree・next）を 1/3 秒ごとに押して切符まで進め、切符を受け取った後の「ありがとうございました」（thanks）も押す。日本語版も同じコードを通る。[^teaser-en]
5. 目撃者のポストが無ければ `social.maybePost(record, 12, now)` で作る（写真・動画は投稿者の位置から撮られる）。

# 自動運転タクシー

- 迎車は信号ごとに律儀に止まり、60 秒以上止まったままのこともあった。呼んだ後、経路の残り 80 m の点まで車を移した（`driver.hint` も合わせる）。
- 止めてある自車は経路上の障害物で、後ろに付くと動かない。呼ぶ場所は自車から離す。
- **東京駅前（35.6806, 139.7652 付近の一方通行 3 車線）で乗せると、そこからどこへも経路が作れず（`driver.plan` が false）、元の迎車経路の終点のまま「到着」して 1.8 秒で降ろされる。** 行幸通り（35.6812, 139.7645）では行き先まで 481 m の経路ができて走った。ゲーム側の不具合の可能性があり、原因は調べていない。（2026-10-05 追記: 原因はループの頂点に付いた行き先の無い指定方向外進行禁止と、25 m 以内に道が無いと計画しないことだった。修正と計測は [自動運転の復帰と他の交通](autopilot-recovery.md)。）
- 行き先は近い駅にする（ミッションの 6 km 先は試していないが、読み込み範囲の外は避けた）。

# 英語版の紹介動画（`--lang en`、2026-10-05）

`just make-teaser-en`（`node scripts/teaser/teaser.mjs --lang en`）が `out/teaser.en.mp4` を作る。コマは `out/teaser-frames-en/`。機能を 1 つずつ、英語の見出しと 1 行の説明で見せる 115.5 秒（3,465 コマ）。[^teaser-en]

## 仕組み

- 演出は日本語版と同じ teaser.mjs のセッションで撮る。区間の順・長さ（`seconds`、無ければショットの既定の長さ）・字幕（`captions`）・カードの文言（`cards`）・音楽の区切り（`music`）は `cuts.mjs` の言語ごとの表にあり、`s.film(id, …)` が表を引いて字幕を出す。表に無い区間は撮らない（`has(id)`）。英語版だけの区間（`orbis` などのセッション 2 つ、`tower`・`search` などのショット）は `has()` で囲み、日本語版の手順は変えていない。
- 字幕の `timing.out` が負なら区間の終わりからの秒。続く区間に字幕を持ち越す（`at: null`）のは `first`・`carried`・`last` の組で書く。
- タイトルとエンドカードの文言は `stage(cards)` に渡す。`badge`・`tag` を null にするとページのタイトル画面の `data-i18n="title.badge"`・`"title.tagline"` をそのまま使う（ゲームの英語の文言: LAW-ABIDING / Drive Tokyo's 23 wards by the letter of the law — built from Tokyo open data × PLATEAU 3D city models）。エンドカードに `credits`（データの出典の 1 行）、字幕の後ろに薄い影（`captionBand`）。
- 音楽は music.py のまま、区切りを英語版のカットに合わせる: ドロップをタイトル、ブレイク（パッドだけ）を事故と通報の間、2 回目のドロップ（アルペジオ入り）をナビから、アウトロをエンドカードに。
- UI は `tod.lang=en` を読み込み前に入れて英語にする。違反の判子は日本語のまま、その下に英語の読み（5fadb8c）。切符の様式は日本語のまま、上の英語の要約（`.ticket-summary`）を拡大して読ませる。

## カット（115.5 秒）

| 区間                            | 秒  | 見出し / 説明                                                                                                                       |
| ------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------- |
| cold                            | 6.0 | Tokyo Station on a rainy night / From the driver's seat — rain on the windscreen, the wipers on                                     |
| title                           | 4.0 | （タイトルカード: ゲームの英語のタイトルとタグライン）                                                                              |
| plateau・river・sign            | 6.0 | The real 23 wards of Tokyo / PLATEAU 3D buildings, rivers and guide signs                                                           |
| tower・skytree                  | 4.5 | Landmarks, lit up at night / Tokyo Tower and Tokyo Skytree, seen from across the city                                               |
| flare・lapse・rain              | 7.3 | Time of day and weather / Dusk turns to night and the city lights up — then the rain comes                                          |
| stopline・idle                  | 6.5 | Drive by the letter of the law / Stop lines, signals and limits from real regulation data — even idling cites its ordinance         |
| red                             | 4.5 | Break a rule, and it's stamped / Every violation is named the moment it happens                                                     |
| orbis・portable                 | 5.8 | Speed cameras / Fixed and portable — go too fast and the flash goes off                                                             |
| chase・flee                     | 6.5 | Run a red light, and they give chase / Patrol cars and police motorcycles — and fleeing is a crime of its own                       |
| stop・ticket                    | 8.1 | A ticket, on the spot / The fine and penalty points per the Road Traffic Act, summed up in English（stop は字幕なしで警察官の会話） |
| y・y-quotes                     | 8.0 | Witnesses post it on Y / The clip goes viral: views, reposts, replies and quote reposts pile up                                     |
| accident・call・radar           | 8.1 | An accident? Call 119 and 110 / From your phone — the ambulance and the patrol car on the radar, with distance and ETA              |
| navi・search                    | 6.8 | Navigation / Intersection names, lane guidance, and a destination search with landmarks                                             |
| autopilot                       | 2.7 | Autopilot / Press J and the car drives itself to the destination                                                                    |
| taxi-call・taxi-come・taxi-ride | 5.8 | Robotaxi / Call one from your phone, then ride it                                                                                   |
| walk・talk                      | 5.4 | On foot / Walk the streets, look up at the towers, talk with the people you meet                                                    |
| charm・tv・look                 | 7.2 | Cabin details / Swinging mirror charms, a navi TV that plays only when parked, a look around                                        |
| gfx・lang・pad                  | 7.7 | Settings / Graphics presets, three languages, gamepads with gyro steering and HD rumble                                             |
| end                             | 4.6 | （エンドカード: kexi.github.io/tokyo-od-game とデータの出典の 1 行）                                                                |

## 英語版の段取り

| 区間                  | 段取り                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stopline・idle        | 既定のスタート地点の近くの「止まれ」（`control.approaches` の `kind === 'stop'`、60 m 以上の区間）の 22 m 手前に 25 km/h で置き、停止線の 8 m 手前でブレーキ。止まってから 20 秒でゲームがエンジンを止め、トースト「Engine switched off (Tokyo Metropolitan Environmental Security Ordinance Art. 52: no idling)」が出る（`toast.idlingStop`）。19.3 秒待って撮り、トーストを 1.9 倍に寄せる |
| orbis                 | 第一京浜（品川区、`?start=35.5940,139.7363`）の門型オービス（制限 60 km/h・閾値 30 km/h）の 60 m 手前に、内側の車線で 98 km/h。道の中央・門の先から迎えて撮る                                                                                                                                                                                                                                |
| portable              | 同じ読み込みの可搬式オービス（その日の位置はゲームが決める。この日はこの読み込みに 30 km/h の生活道路の 2 台があり、近い方）の 37 m 手前に 55 km/h。三脚の横から                                                                                                                                                                                                                             |
| flee                  | `debug.pursuit.start('shirobai', 'signal')` で白バイに追わせ、`debug.pursuit.flee(30)` を 2 回で第 3 段階（緊急配備・ヘリ・検問の通知と警察無線）。その間は車を止めておき、撮る直前に門の先の直線に自車と白バイを置き直して 36 km/h で走らせる                                                                                                                                               |
| stop                  | 路肩の会話を「違反の説明」（offence）の手前まで進めて止め、警察官の「At 千代田区 丸の内二丁目: Running a red light (Road Traffic Act Art. 7).」を 1.2〜1.3 倍で撮る                                                                                                                                                                                                                          |
| ticket                | 英語の要約（違反名・条項・点数・反則金・合計・納め方）を 1.5 倍で 2.6 秒、その後ダイアログを 520 px 送って様式の上半分                                                                                                                                                                                                                                                                       |
| y・y-quotes           | 目撃者の信号無視の動画ポストを開き、時計を 24 倍（1 コマ 40 秒）にして表示回数・リポスト・引用の数が増え、返信が積もるのを見せる。続けて「View post engagements」で引用ポストの一覧。撮った後で時計を戻す（戻さないと後の昼のショットが夕方になった）                                                                                                                                        |
| accident・call・radar | 避けない歩行者（`profile.id % 5 === 0`）を車の 12 m 先に立たせ 20 km/h で当てる。判子 2 つ（安全運転義務違反・人身事故）を消してから 119 を拡大表示で撮り（クイック返信 2→1）、110 は撮らずに済ませる。最後に事故パネルの距離と到着までの時間とレーダーを寄せる                                                                                                                              |
| search                | N で目的地の検索を開き、1 文字ずつ「Tokyo Tower」と入れて（`input` イベント）結果を押す                                                                                                                                                                                                                                                                                                      |
| walk・talk            | Q で降りて W で歩きながら `walker.camPitch` を 0 → 1.05 にして塔を見上げる（太陽が入るのでこのショットだけレンズフレアを切る）。近くの歩行者の 1.6 m 手前に置いて E、会話 AI なしの定型の返答にクイック返信「Anything worth seeing around here?」                                                                                                                                            |
| look                  | TV のショットの後、`__tz.seat(-0.95, 0.02, 66, { yaw: 1.05 })` で運転席から右の窓から左の窓まで振る                                                                                                                                                                                                                                                                                          |
| pad                   | 汎用のゲームパッド（後述）を差し、設定 › コントローラーの 3 つの枠（Feel・Gyro steering・Rumble）から割り当ての表まで送り、Horn の割り当てを押して Y ボタンで割り当て直す                                                                                                                                                                                                                    |
| tower                 | 東京タワーの 1.5 km 北東・高さ 90 m から（車を近くの地面に移してから）                                                                                                                                                                                                                                                                                                                       |
| skytree               | 吾妻橋のそば、隅田川の上 20 m（35.711, 139.7992）から 1.1 km 先を、夜（「夜」ボタン = 21:30）に。浅草側の川岸の 14 m ではカメラが建物の中に入っていた                                                                                                                                                                                                                                        |

## 入れなかったもの

- 依頼の 16 項目はすべて入れた。会話 AI（Gemma）はヘッドレスで 2 GB を落とせないので、AI なしで出る定型の返答で見せた（字幕は「talk with the people you meet」で AI とは言っていない）。
- ジャイロ操舵と HD 振動の実際の動作は撮れない（WebHID の実機が要る）。設定画面の枠と見出しだけを見せた。WebHID の説明文には製品名が入るので、撮影中は隠した。
- 弱いところ: walk では歩行者がほとんど進まず（W を押したまま、車のそばから動かない）、見上げる動きだけが見える。taxi-come は 3 回のうち 1 回、迎車が手前で止まったまま「到着」にならず、撮影側で到着にした（止まっている画になる）。
- 日本語版（`--lang ja`）は同じ開発ビルドで撮り直して確かめた: 72.3 秒・2,169 コマで従来と同じ長さ、字幕・カードは日本語のまま。違うのは路肩の会話を進めるようになった点だけ。[^teaser-en]
- 首都高のオービス、パトカーの追跡でのヘリの姿（白バイの後ろからの画にヘリは入らなかった。通知と無線の文言で見せた）は入れていない。

# ゲームの音（曲に重ねる、2026-10-05）

`just make-teaser-en` は撮影の後に `sound.mjs` を呼び、曲の下と上にゲームの音を重ねた版を `out/teaser.en.mp4` に書く（カットの `sfx: true`、`--sfx on|off` で切り替え）。撮り直さずに音だけ作り直すのは `just mix-teaser-sound [lang]`。日本語版は `out/teaser.mp4` をそのまま残し、音付きを `out/teaser.sfx.mp4` に書く。[^teaser-sound]

## 作り方

- 撮影はコマ送りで AudioContext を進めていないので、コマを撮りながら録音はしていない。区間ごとの「何が鳴っていたか」を場面の表（`sounds.mjs`）に書き、ヘッドレス Chrome のゲームのページで **ゲーム自身の音のコード** に鳴らさせる。
  - 使うもの: `GameAudio`（`audio.ts`）、`SpatialAudio`（自車のエンジン・タイヤ・排気、雨の車外のシャー音と屋根の雨粒、周りの車のエンジンとタイヤ、サイレン、音響式信号機の「ピヨ」「カッコー」、車内の遮音とこもり、車内の短い残響、HRTF の定位、ドップラー、リミッター）、`Stamps.thud`（`stamp.ts`）、ナビのテレビの `TvSound`（番組の下の音）。
  - `OfflineAudioContext`（44.1 kHz ステレオ）に新しい `GameAudio` を作り、`spatial.init(ctx)` で同じバスを組む。`ctx.suspend(t)` で 1/30 秒ごとに止め、ゲームのループと同じ順で `spatial.update` と `audio.update(kmh, throttle, engineOff)` を呼ぶ。
  - 判子の音は `currentTime` を読む時刻に置くので、その時刻を返す Proxy の context で鳴らす（押してから 0.12 秒後に着く。stamp.ts と同じ）。
- 各区間は 1.5 秒前から鳴らす（雨やエンジンの立ち上がりを区間に入れない）。カットの境目は 40 ms で重ねて切り替える。
- Why not Python に移植: フィルター・HRTF のパンナー・畳み込み・コンプレッサーをすべて手で合わせることになる。ページで鳴らせば、ゲームの音が変われば動画の音もそれに付いてくる。教わるのは場面（位置・速さ）だけ。

## 場面の決め方と仮定

- 判子・フラッシュ・停止・はねた瞬間などの時刻は、撮ったコマから読んだ。
  - 英語版の信号無視 3.03 秒、オービス 2.2 秒、可搬式 2.37 秒、事故 2.2 秒（判子 2 つ）、一時停止は 1.2 秒からブレーキで 2.3 秒に停止、アイドリング停止のトースト 0.3 秒。
  - 日本語版の撮影（古いビルド）は信号無視で判子が出ていないので、その判子の音は英語版だけ。
- 仮定したもの（`sounds.mjs` に書いた）: 周りの車の位置と速さ、追跡で後ろから来るもう 1 台のパトカー（200 m 後ろ）、119 の後の救急車の距離（260 m から。パネルの「230 m・約 22 秒」と合う）、両国橋のバス、塔のショットに届く音は無いこと。
- 混ぜ方は動画のための決めごとで、ゲームの音量ではない。
  - 区間ごとの音量: 雨 +8 dB、可搬式 +5、オービス +4、アイドリング停止 +3、追跡と逃走のサイレン −4。
  - ゲームの音全体は +4 dB、曲は −2 dB。
  - ゲームの音のピークリミッターは −6 dBFS（判子の音はゲームではそのまま出力へ行き、2 つ同時で +4 dBFS になる）。
  - 曲のダッキングは判子・サイレン・雨・アイドリング停止の間に −6 dB。

## 入っていない音（ゲームに無い）

依頼の例のうち、次はゲームに音が無いので **足していない**（ゲームに無い音を紹介動画で鳴らすと、ゲームを偽ることになる）。

- オービスのフラッシュ・シャッター
- Y の通知と返信の音
- 切符
- 窓のノック
- 110・119 の発信音
- ワイパー
- 足音

声も入っていない。警察官の拡声器、110・119 のオペレーター、歩行者の声はいずれも sanoTTS-jp（日本語、ページで落とすモデル）、テレビの読み上げはブラウザの speechSynthesis で、どちらも書き出せなかった。ゲームにある音で入れていないのは、光の柱の点を取ったチャイム（そのショットが無い）と警音器。

## ラウドネス

- `mix.py` の出力（−1 dBFS 以下）を ffmpeg の EBU R128 で読み、−16 LUFS までの利得をかける。続けて 176.4 kHz で `alimiter`（−2.5 dBFS）をかけて 44.1 kHz に戻し、AAC 192 kb/s にする。
- 出来たファイルを読み直し、0.2 LU より外れていればもう一度かけ直す。
- 結果: 英語版 −16.0 LUFS・LRA 4・真のピーク −2.2 dBTP。日本語版 −16.1 LUFS・−2.9 dBTP。映像ストリームは `-c:v copy` で、音を付ける前と MD5 が同じ。[^teaser-sound]
- Why not ffmpeg の loudnorm: この曲とピークで −16 LUFS にすると線形モードを外れて動的モードになり、ダッキングや判子の音がならされた（LRA 5.6）。AAC の後の真のピークも、目標の −1.5 を越えて −0.9 dBTP になった。

# 落とし穴

| 症状                                                                         | 原因                                                                                                                                                                                                                                                                                         | 対処                                                                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 新しく起動したはずの Chrome でスマホが最初から拡大表示                       | 例外で落ちた前の実行の Chrome が同じポートに残り、新しい Chrome は起動に失敗、残った方のタブ（sessionStorage）に繋がっていた                                                                                                                                                                 | `launch()` はポートが使用中なら止まる。teaser.mjs はセッションを必ず閉じる                                               |
| 開始前に夜・雨にしたのに夕方・晴れ                                           | 開始時に時刻と天気を乱数で決め直す                                                                                                                                                                                                                                                           | `start()` の後に設定する                                                                                                 |
| 東京駅を目的地にできない                                                     | POI の駅は都営交通の駅だけで「東京駅」が無い                                                                                                                                                                                                                                                 | 自前の目的地（`missions.current` に POI 形のオブジェクト）を置く                                                         |
| 自動運転が「ルートが見つかりません」                                         | 目的地が道路から遠い（35.681, 139.7655 は不可、35.6806, 139.7652 は可）                                                                                                                                                                                                                      | 経路ができる点を試して選ぶ                                                                                               |
| 太陽の中心に 12×14 px の黒い四角（画質 レンズフレア あり、WebGPU）           | 大きさと位置がレンズフレアの探り（フレームのアルファに 0 を書く小円、角半径 0.0065 rad）と一致するので、その跡と推定（未確認）。ページの背景色をマゼンタにしても黒のままなので、透けているのではなくキャンバスの色が黒い                                                                     | ゲームのバグとして未修正。ティザーでは太陽の色の円を、フレアが測った見え方（`lensFlare.seen`）の強さで重ねて隠した       |
| JPEG のコマから作ると `yuvj420p`（full range）                               | JPEG はフル レンジ                                                                                                                                                                                                                                                                           | `scale=in_range=pc:out_range=tv,format=yuv420p`                                                                          |
| 止まっても切符が開かない（2026-10-05、英語版）                               | 切符の前に路肩の会話が入った（上の段取り 4 の訂正）                                                                                                                                                                                                                                          | `answerStop` で会話の選択肢を押して進める                                                                                |
| オービスを抜けても判子もストロボの記録も出ない                               | ふつうの速度超過の判定（制限を 3 秒超え）が先に 速度超過 を記録し、同じ違反の 20 秒のクールダウンでオービスの記録が捨てられた。98 km/h の車線変更（合図なし）・一時不停止も途中で記録された                                                                                                  | 3 秒以内の 60 m 手前から入る。`law.cooldown.get` を差し替え、速度超過以外は「まだ」と答えさせる                          |
| オービスの手前で車が前の車に詰まって速度が出ない                             | 流れる交通の車が同じ車線にいた                                                                                                                                                                                                                                                               | 撮る前にオービスから 110 m 以内の交通の車を消す（`traffic.remove` と `cars.splice`）                                     |
| ヘッドレスのページにゲームパッドがつながっている（`pad_connected`）          | Chrome はヘッドレスでもマシンにつないだコントローラーをページに渡す（試し撮りのページに Pro Controller が現れた）。触れば入力になり、HUD のキーの表示も変わる                                                                                                                                | 英語版は `navigator.getGamepads` を読み込み前に差し替え、ショットが差す偽のパッド（Vendor 1234、製品名なし）だけを見せる |
| 製品名の説明文を隠しても戻る                                                 | 設定のコントローラーの節は、パッドの状態が変わるたびに作り直される                                                                                                                                                                                                                           | 隠す処理を毎コマのフック（`brands`）にする                                                                               |
| 逃走を早送りしている間に交差点で歩行者をはねた                               | `pursuit.flee` の 30 秒分の早送りの間も車は走り続けた                                                                                                                                                                                                                                        | 早送りの間は車を止めておき、撮る直前に車と白バイを直線に置き直す（止まっていても `flee` から 12 秒は逃走のまま）         |
| Y のショットの後、昼のはずのショットが夕方になった                           | Y の時計の早回し（1 コマ 40 秒 × 約 240 コマ ≒ 2 時間 40 分）がそのまま残った                                                                                                                                                                                                                | Y の前の `env.gameMs` を覚えて戻す                                                                                       |
| 夕方の早回しの後のスカイツリーが写らない（夜に撮り直しても写らない）         | 3 つ重なっていた。(1) 塔のライトアップは `env.nightFactor > 0.35`（日没後）からで 17 時 40 分は消灯。(2) 車を両国から 2.1 km 動かすと浮動原点が付け替わる（`RECENTER_DISTANCE` 1,500 m）。その前に取ったローカル座標のカメラは別の場所を向いていた。(3) 浅草側の川岸の 14 m は建物の中だった | 「夜」ボタンを押す。遠くを撮るカメラは緯度経度から毎コマ置き直す（`geoCamera`）。隅田川の上 20 m から撮る                |
| 遠くの塔を撮るカメラの周りの街が無い                                         | 建物・地形・詳細なモデルの読み込みはカメラではなくプレイヤー（車か歩行者）の周りで決まる                                                                                                                                                                                                     | 撮る場所の近くの道（無ければ地面）に車を移してから数秒回す（`bringCar`）                                                 |
| 119 の画面に判子が重なった                                                   | 人身事故の判子 2 つ（安全運転義務違反・人身事故）は 3 秒残り、3 秒の事故のショットのすぐ後の電話に重なった                                                                                                                                                                                   | 電話のショットの前に `#stamps` の子を消す（判子は事故のショットで見せた）                                                |
| 画面の寄りでページの外の黒が写った                                           | 寄せる点が画面の端に近いと、拡大した body の外が見える                                                                                                                                                                                                                                       | `__tz.zoom(keys, { edges: true })` で寄せる点を画面の内側に押し戻す（日本語版は従来どおり）                              |
| 一時停止のショットで止まり切らない                                           | 25 km/h で停止線の 5 m 手前からのブレーキでは 3.5 秒で止まらず、停止線の上で止まりそうになった                                                                                                                                                                                               | 8 m 手前でブレーキ（止まるのは線の約 6 m 手前）                                                                          |
| 大きく動いたカメラの最初のコマが流れる                                       | 2 コマ空回しでは、遠くへの移動の後のブラーが残った                                                                                                                                                                                                                                           | 遠くに飛ぶショットの前は 4 コマ回す                                                                                      |
| 試し撮り中、ページで `await new Promise((r) => setTimeout(r, 0))` が返らない | 仮想時計の `setTimeout` は `__clock.frame` でしか進まない                                                                                                                                                                                                                                    | ページ側で待つのは `MessageChannel` にする（teaser.mjs は Node から 1 コマずつ回すので関係ない）                         |
| 走り出してすぐの信号が見つからず落ちた（`__ap` が null）                     | 道路の組み立てが終わる前に探した（3 回のうち 1 回）                                                                                                                                                                                                                                          | 見つかるまで 15 コマごとに探し直す                                                                                       |

[^teaser3]: ティザー 3 本目の撮影と試し撮り

[^teaser-v2]: 2 本目のティザー

[^teaser-en]: 英語版の紹介動画の撮影と試し撮り

[^teaser-sound]: ティザーの音付け（曲にゲームの音を重ねる）
