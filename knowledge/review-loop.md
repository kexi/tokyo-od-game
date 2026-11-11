---
type: Playbook
title: 多視点レビューの収束ループ（視点表・カメラのフック・コンタクトシート・収束判定）
description: 標識・信号・ランドマーク・高速道路・一般道を、宣言した視点の表からヘッドレス Chrome で撮り、観点ごとのレビュー担当が指摘を JSONL に書き、前の周と比べて止めどきを決める仕組み（段階 Q1、レビュー後の修正を含む）。視点の型と look の行列・信号の現示の固定、開発ビルドの window.__game.debug.camera / .targets / .signals / .settled、対象の向きを描いた物から読むことで G1c の「カメラが標識を向かない」を直した方法、対象が読めないときの原因別の失敗、各コマの JSON（狙い点の投影と対象の箱の画面の割合）、コンタクトシート、全描画済み番号の標識を Blender で並べる見本、fail-closed な収束判定（持ち越し・review 行・完全な周だけ・metric の欠落）、5 表の撮影の確認を記録する。
tags: [testing, rendering, assets]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-10T14:10:00Z }
updated: { by: claude-opus-5-5, at: 2026-11-10T14:45:00Z }
verified:
  - { by: claude-opus-5-5, at: 2026-11-10T14:00:00Z }
  - { by: claude-opus-5-5, at: 2026-11-10T14:35:00Z }
sources:
  - id: q1-shots
    resource: >-
      2026-11-10 14:30 の撮影（worktree feat/review-views、開発サーバー vite 5231 番、Google Chrome 157 headless=new、
      MacBook Pro M2 Max、他のエージェントが並行作業中）。just shoot-views <名前> "" http://localhost:5231/tokyo-od-game/ で
      signals（昼・夜の 2 look × 3 視点、右折矢印の現示を固定）・signs・landmarks・expressway・roads の 5 表 21 コマを撮り、
      全表で失敗 0・run.json complete。各コマの JSON（offCentre 0〜0.029、screenShare 0〜0.51）とコンタクトシートを目視（Read）
    title: 5 つの視点表の撮影と目視
    author: claude-opus-5-5
  - id: q1-sign-review
    resource: >-
      just render-sign-review と同じ手順（nix develop .#blender の Blender 5.2.2 LTS、signs.py の後に sign_review.py）。
      catalog.json から描いた最初の版は 365 面 × 0°・30°・60° = 1,095 枚、registry.json から読む版は 369 面
      （共用の板 317 → 316 などを含む）を 0° で描いて数を確認
    title: 標識の見本の描画
    author: claude-opus-5-5
  - id: q1-tests
    resource: >-
      tests/viewTable.test.ts（視点表のスキーマ・look・視点の幾何）、tests/reviewLoop.test.ts（記録の検査・持ち越し・
      収束判定・run.json と周の番号）、tests/viewHooks.test.ts（private なフィールドの読み取りと改名の検出・板の選び方・
      箱の画面の割合）。レビューの抜け道 A〜K（scratchpad/q1-maint-review/loopholes.ts）はすべて reviewLoop.test.ts に取り込んだ
    title: 視点表・収束判定・フックの単体テスト
    author: claude-opus-5-5
  - id: design
    resource: 設計書 sign-signal-system 7 章（多視点レビューの収束ループ）・8 章 Q1、road-redesign 7 章（views と収束の規則）
    title: 標識・信号と道路再設計の設計書
    author: claude-opus-5-5
---

# 何をするか

「画面を撮って AI が法令と照らす」ループを、走行の録画（`just record-drive`、[road-qa スキル](../.agents/skills/road-qa/SKILL.md)）とは別に、**狙った物を狙った角度から毎周同じに撮る**形にしたもの。[^design]

1. 視点表 `scripts/qa/views/<name>.json` に、session（スタート地点・URL パラメータ）ごとに視点を並べる。look（昼・夜・雨…）を並べると、session × look の数だけページを読み込む。
2. `just shoot-views signs`（名前は位置引数。`just shoot-views signs "" http://localhost:5231/tokyo-od-game/ 9400` で周・base・CDP ポート。ポートを空にすると空きポートを探す）が撮る。`.qa/views/<name>/round-NN/` に `<shot>.jpg` と同名の `.json`、`contact-sheet.jpg`、`run.json`、`review-template.json` を書く。失敗したコマが 1 つでもあれば終了コード 1。
3. 観点ごとのレビュー担当（様式・寸法・取付・可読性・夜と雨・配列・幾何・性能…）を並列に回し、`.qa/reviews/<name>/round-NN.jsonl` に書く。
4. 直したら回帰テストかチェック項目を足し、次の周を撮る。
5. `just check-convergence signs` が各周の run.json と合わせて前の周と比べる。`diff-NN.json`（新規・閉じた・持ち越し・書き直された指摘、metric の問題、レビューされていないコマ）と `verdict.json` を書き、ログ `review_round_checked` に判定を出す。

| ファイル                                            | 役割                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `scripts/qa/viewTable.ts`                           | 視点表の zod スキーマ（厳格: 綴りを誤ったキー、2 種類の対象を混ぜた target は撮る前に落ちる）、look の展開とコマの名前、URL |
| `scripts/qa/viewGeometry.ts`                        | 視点の型から目の位置と注視点を出す純粋な計算                                                                                |
| `scripts/qa/views.ts`                               | 撮影の本体（tsx。browser.mjs の型は browser.d.mts）                                                                         |
| `scripts/qa/runRecord.ts`                           | run.json の形、完全な周かの判定、次の周の番号                                                                               |
| `scripts/qa/contactSheet.ts` / `signSheet.ts`       | コンタクトシート（HTML をヘッドレス Chrome で撮る）と標識の見本のシート                                                     |
| `scripts/qa/reviewLoop.ts` / `check-convergence.ts` | レビューの記録の形、周の比較、収束判定                                                                                      |
| `scripts/blender/sign_review.py`                    | 標識の見本（registry.json の全描画済み番号）                                                                                |
| `src/debug/viewHooks.ts` / `privateViews.ts`        | 開発ビルドだけの `window.__game.debug.camera` / `.targets` / `.signals` / `.settled` と、private なリストの読み取り         |

# 視点表

座標は `[緯度, 経度]`。方位（`bearingDeg`）は対象から目への方角（北 0°・東 90°）。向きのある対象（標識の板・信号の灯器・高速道路の床版）は `angleDeg` で正面から回す（上から見て時計回り、0° が真正面）。向きの無い対象（ランドマーク・地点）で方位を書かないと、目は対象から自車（スタート地点）の側に立つ。[^design]

どこまで遠くを狙えるか: 道路網（と標識・信号）はスタート地点から約 300 m の範囲で組み立てられるので、それらの対象はその中に置く。ランドマークは遠くても描かれ、`landmarks.json` の視点ではレインボーブリッジの中心をスタートから約 700 m 先で撮っている（初版に書いた「400 m 以内」は誤り）。

| `camera`                   | 目の位置                                                               | 主な項目                                                                                    |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `driver`（運転席）         | 対象の正面 `distanceM`（既定 30 m）、地面から 1.2 m                    | `angleDeg`・`bearingDeg`・`lateralM`。対象なしなら `at: {lat, lon, headingDeg, lookAheadM}` |
| `pedestrian`（歩行者目線） | 同じく既定 12 m、1.6 m                                                 | 同上                                                                                        |
| `chase`（後方追従）        | 自車を `distanceM` に置き、その `backM`（7 m）後ろ・`heightM`（2.8 m） | `showCar`（既定 true）                                                                      |
| `overhead`（俯瞰）         | 対象の `altitudeM` 上から俯角 `pitchDeg`（90 で真下、北が画面の上）    | `angleDeg`・`bearingDeg`                                                                    |
| `free`（自由カメラ）       | `eye` と `lookAt` を緯度・経度・高さで直に                             | 高さの基準 `ref`: `ground`・`tp`（T.P.）・`ellipsoid`                                       |

- 対象（`target`）: `{ landmark, heightShare }`、`{ sign: 番号 | "*", note, near, index }`、`{ signal: { near, arrow, index } }`、`{ expressway: チャンク id, share }`、`{ point }`。床版を対象にした運転席・後方追従は、目を中心線に沿って戻した床版の上に置く（勾配で浮かない）。
- 視点の id は表全体で一意（指摘がコマを名前で指すため）。コマの名前は `<session>--<view>`、look があれば `<session>.<look>--<view>`。
- look: `defaults.moment`（必須。ISO 8601 の日時で太陽と空を固定 = 季節と時刻）・`time`・`weather`・`seed`。`looks: [{id, time, weather, moment, seed}]` を `defaults` か session に書くと行列になる。`moment` は太陽・空・雨だけを固定し、ゲームの時計（時間帯の規制、ランドマークのライトアップの予定表）は `time` から進む。
- 状態: `state.signalStep`（信号が対象の視点だけ）で現示を止める。番号か、その接近路の群で `green`・`yellow`・`red` になる最初のステップ、`arrow` は矢印が点く最初のステップ。T4（歩車分離・時差式）の現示表の全ステップを撮るときの足場。`state.signalClock: "HH:MM"`（T4）は信号が読む時刻（夜の現示表: 夜間点滅・夜間の押ボタン）を空とは別に止める（フック `signals.clock(minute, approachId?)` が時刻を固定し、制御機が変更できる時点で切り替わるまで信号の時計だけを進める。`state.signalClockToChange: true` なら対象の制御機の現示表が変わった瞬間で止め、その時点の段を撮る）。
- `hide: ["traffic", "pedestrians"]`（defaults・session・視点）で、動く車と歩行者をその間だけ隠す（駐車車両は残る）。
- `metrics: [{name, min, max}]`: 毎周の報告を必須にする数値の探り。

# 開発用フック（`window.__game.debug`）

本番ビルドには入らない。main.ts の `import.meta.env.DEV` の中で `await import("./debug/viewHooks")` する。

- `camera.place({ eye: {x, z, above | y}, target, fov, hide })` は局所座標で置く。`above` は目の位置の地面（橋ならその床版）からの高さ。置いた点は緯度・経度で持ち、毎フレーム局所座標に直すので、原点の付け替えで動かない。置いている間はモーションブラーを切り（ブラーは車の速さで掛かり、カットを流す）、ナビの矢印（毎フレーム表示し直される）と `hide` の物を毎フレーム隠す。
- そのほか `camera.placeGeo`・`release`・`look`・`project(point)`・`projectBox(box)`（箱の画面の割合）・`moment(iso, raining)`。
- `targets.find(spec, start)` は視点表の target をそのまま受け取り、`{ok: true, target}` か、`{ok: false, reason, detail}` を返す。reason は `unknown-id`・`not-built`・`renamed`・`none-near`・`not-drawn`。対象の種類の扱いはここに集め、ランナーは spec を渡すだけ。描かれていない対象（`isDrawn` false、ランドマークのモデル未読み込み、高速道路のチャンク未構築）は `not-drawn` で、そのコマは失敗になる。
- `targets.health()` は標識の支柱・信号の灯器が読めるか（数・原因）を返す。ランナーは session の初めにこれを呼び、要る種類が読めなければその session の全コマを原因つきで失敗にする。
- `signals.hold(approachId, step)` / `signals.release()`: TrafficControl の `update` を差し替え、時計をそのステップの中ほどに止める（開発時だけ）。
- `settled()`: 道路網の構築中でない・道路網がある・建物のタイルの読み込みが 99.9 % 以上なら `isSettled`。ランナーは、session の初めと各コマを撮る前に、これが 2 回続けて真になってから 3 フレーム待つ。壁時計の待ちはやめた。結果は各コマの JSON の `settled` に残す。

## カメラが標識を向かなかった問題（G1c）の直し方

以前の撮影スクリプトは支柱の `travel`（標識が向ける交通の進行方向）から目を置いていた。一方通行 326-A は板が道に平行（車道の側を向く）で、横断歩道 407 は背中合わせに 2 枚あるので、`travel` の逆に立っても板の正面にならない。フックは**描いた板そのもの**から向きを読む: インスタンスの行列の局所 +Z が板の正面。支柱ごとに、その面の図柄のインスタンスのうち足元から 1.5 m 以内で、`travel` の逆に最も近い向きのものを選ぶ。信号は灯の中心（その接近路の灯のインスタンスの平均）と、接近路の逆向き。[^q1-tests]

## private なフィールドの読み方（暫定）

TrafficSigns の `posts`（Post の `pos`・`travel`・`plates`・`auxOf`・`hidden`、板の `id`・`file`・`scale`、補助標識の `sign`・`lines`。G2（#45）で `notes` の文字列から `auxOf` の描画済みの板に変わり、改名の検査がそれを捕まえた）と TrafficControl の `lamps`・`lampOwners`・`arrowLamps`・`arrowOwners` は private。並行して作り替えている（G2・T3）ため、公開の口は足していない。`src/debug/privateViews.ts` が形を一つずつ確かめて読み、合わなければ `renamed`、空なら `not-built` を返す。TypeError が「対象が見つからない」に紛れることはない。読むフィールドの名前は `READ_FIELDS` に集め、`tests/viewHooks.test.ts` が signs.ts・trafficControl.ts・signs/game.ts の宣言にまだあることを確かめる。

# 各コマの JSON

`drive.mjs` の frame-NNN.json と同じ考え（画面にあるはずのもの）。中身は次のとおり。

- `shot`・`view`（表の行そのまま）・`look`。
- `target`（種類・id・位置・向き・箱・`facts`）。標識なら `target.catalog` に名前・群・別表第二の標準寸法・図の URL。
- `projection`
- `scene`（カメラ・時刻の型・天気・雨・夜の度合い・太陽高度・ゲームの時刻）
- `settled`
- `expect`（表に書いた「見えるべきもの」）

`facts` は種類ごとに次のとおり。

- 標識: 同じ支柱の板・補助標識の文言・板の高さ・平行か
- 信号: 灯の状態・右折と直進の可否・止めたステップ・現示表・灯器の高さ
- 高速道路: 車線数・幅・設計速度・構造・根拠

`projection` の読み方:

- `offCentre`（狙い点の画面中央からの距離）: カメラはその点そのものを見るので、ほぼ自明に 0 になる。カメラが姿勢を取れなかったこと（地面が未読み込み、lookAt の失敗）を捕まえるためのもので、「写っている」証拠ではない。
- `screenShare`（対象の箱が画面に占める割合）・`insideShare`（箱のうち画面内の割合）・`behind`: 小さすぎる対象を見つける。コンタクトシートは中央を外れたコマと `screenShare` < 0.0005 のコマを赤枠にする（例: 60 m の後方追従の信号灯器は 0 で赤枠）。
- 手前の建物に隠れているかは見ていない（目視に頼る）。

# 標識の見本

設計書の「標識の見本道路」は、ゲームの中に並べる開発用の道路ではなく、Blender の単体レンダにした（軽い方）。

`just render-sign-review` は `signs.py`（板・支柱・金具を作る）と同じ Blender の中で `sign_review.py` を続けて走らせる。registry.json の図柄のある全番号を描く。描く面は次のとおり。

- 自身の図柄とその変種
- 板を共用する番号（317 → 316）の図柄
- 327の7-A の車線の版

それぞれの板のノードに図柄を貼り、支柱と金具を付けて正面・30°・60° で描く（Workbench）。板の寸法は registry.json の `plates`、図の URL は `law.figureUrl` から取る。板と支柱の前後のずれは src/world/signs.ts の `PLATE_OFFSET` を読む。複写しないので、ゲームの値が変われば見本も変わる（無ければ止まる）。

出力は `.qa/signs/<角度>/<番号>[~<変種>].png`、`index.json`、`sheet-<角度>.jpg`（番号・名前・寸法の見出し付き）。369 面 × 3 角度が数分で描ける。[^q1-sign-review]

Why not ゲーム内の見本道路: 板と図柄の組み立ては world/signs.ts の非公開の kit にあり、G2 が作り替えている最中。ゲームのシェーダーでの見え（夜・雨・前照灯）は実地の視点表（`signs.json`）で見る。

# レビューの記録と収束判定（fail-closed）

`round-NN.jsonl` の 1 行 1 件:

- `{"type": "review", "round": N, "perspective": "様式", "reviewer": "...", "views": ["<shot>", ...]}`: 担当ごとに必須。review 行の無いファイル（空を含む）はエラーになる。全担当の `views` を合わせて表の全コマを覆わない周は、静穏と数えない。
- `{"id": "<shot>:<slug>", "round": N, "view": "<shot>", "severity": "Critical|Warning|Info", "status": "open|fixed|wontfix", "finding": "...", "perspective": "...", "basis": "...", "fix": "..."}`。`type` と `status` は省略可。`wontfix` は理由（`fix`）が必須。同じ周で同じ id はエラー。表に無いコマを指すとエラー。
- `{"type": "metric", "name": "head-px-30m", "round": N, "value": 22, "min": 16, "max": ..., "unit": "px"}`: `min` か `max` が必須。
- 壊れた JSON は行番号つきでエラーになる。

周をまたぐ扱い:

- **持ち越し**: 前の周で open の指摘は、今の周に書かれていなくても open のまま。閉じるのは `fixed` か `wontfix`（理由つき）の明示だけ。
- **新規** = 今の周で open で前の周で open でなかったもの（直した後に戻った指摘 = 退行を含む）と、同じ id で Info から Critical / Warning に上がったもの。
- **metric**: 一度出た名前と表の `metrics` は以後の周で必須。欠けたら `missing`、範囲外は `outside`。
- **完全な周だけ**: check-convergence は `.qa/views/<name>/round-NN/run.json` を読む。complete（全コマ撮影・失敗 0・`--only` でない）でない周は静穏と数えない。
- **静穏な周**: 完全に撮れていて、全コマがレビューされ、Critical / Warning の新規が 0。
- **converged**: 静穏な周が 2 周続き、最後の周の後に open の Critical / Warning が無く、metric の問題が無い。
- **escalate**: 6 周目を終えて収束していなければ設計へ差し戻す。その後に静穏な周が続いても escalate のまま。
- それ以外は continue。

Why open の Warning も見る: 新規だけを数えると、直していない指摘を毎周書き直す（または書かずに落とす）だけで「新規 0」が続き、収束してしまう。設計書は「新規 0 が 2 周」とだけ書くので、この条件を足した。Warning を残して止めるときは、理由つきの `wontfix` で明示する。[^q1-tests]

周の番号: `just shoot-views` は最後の完全な周の次の番号で撮る。最後の周が不完全（失敗・`--only`・run.json が無い）なら、同じ番号で中身を消して撮り直す。開発サーバーに届かないときは、ディレクトリを作る前に止まる。

# 確認した結果（2026-11-10、修正後）

| 表         | 対象                                                                                                                    | 視点                                                                   | screenShare            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------- |
| landmarks  | 東京タワー                                                                                                              | 歩行者目線（増上寺側 330 m）・運転席（東 450 m）・俯瞰（420 m・38°）   | 0.12〜0.24             |
| landmarks  | レインボーブリッジ                                                                                                      | 自由カメラ（芝浦の岸壁から）・水面の高さから 800 m・俯瞰（450 m・35°） | 0.22〜0.51             |
| signals    | 丸の内の右折矢印の交差点（35.68043, 139.76424 に最も近い矢印付き灯器）、昼・夜 × 右折矢印のステップで固定、動く車を隠す | 運転席 30 m・歩行者 14 m 斜め 35°・後方追従 60 m                       | 0.002・0.02・0（赤枠） |
| signs      | 有楽町寄りの丸の内（35.67363, 139.764）の 325の4＋通学路＋補助標識「土・日・休日 12-17」                                | 歩行者 8 m 正面・10 m 斜め 30°・運転席 30 m                            | 0.028・0.018・0.001    |
| expressway | ?expressway の試験区間（浜崎橋、チャンク 24402611:14）                                                                  | 運転席（床版上 40 m）・俯瞰（220 m・75°）・高架下から見上げ            | 0.001〜0.022           |
| roads      | 丸の内の交差点                                                                                                          | 地点と向きで運転席・後方追従、真上 90 m                                | —                      |

夜の信号のコマでは、JSON が `lampState: red`・`right: go`・`step: 3`（twoPhaseWithRightArrow）を示し、画像の矢印も点いていた。`just check-convergence signals` に 1 周目の記録（review 1 行、Warning 1 件）を与えると `continue`（「0 quiet round(s) of 2; 1 new Critical/Warning; 1 Warning open」）になった。[^q1-shots]

# 落とし穴

| 症状                                                                    | 原因                                                                                                 | 対処                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 最初の運転席のコマが横に流れる                                          | モーションブラーは自車の速さと向きの変化で掛かる                                                     | 置いている間はブラーを切り、車はその場で止めて隠す                                    |
| 緑の矢印が画面に残る                                                    | ナビの矢印は毎フレーム表示し直される                                                                 | フックが置いている間、毎フレーム隠す                                                  |
| 補助標識付きの標識が見つからない                                        | 35.68043, 139.76424 の周りの標識には補助標識が無い（補助標識は時間帯の通行止めの入口に付く）         | 時間帯の通行止め（regs の closures で時間が 0–1440 でないもの）の近くをスタートにする |
| 2 つ目の読み込みで「port already in use」                               | 固定のポートで、別の撮影（他の worktree）や閉じきらない Chrome と衝突した                            | 読み込みごとに空きポートを OS から取る（`--port` を渡したときだけ固定）               |
| 2 つ目の読み込みの途中でプロセスが「unsettled top-level await」で終わる | Node の WebSocket はイベントループを保持しない。ページが重く返事が遅いと、待つ物が無くなって終了する | 撮影の間はタイマーで保持し、各 evaluate に 60 s の期限を付ける                        |
| レインボーブリッジの俯瞰が線に見える                                    | 方位を書かないと、目は自車（橋の西詰め）の側、つまり橋の軸の延長に立つ                               | 橋の軸（約 111°）に直角な方位（200°）を書く                                           |

# 残課題

- G2・T3 のマージ後、private なリストの読み取りを、公開の読み取り口 `TrafficSigns.debugPlates()` / `TrafficControl.debugHeads()` に置き換える。`signals.hold` の `update` の差し替えも、TrafficControl に時計を止める開発用の口を設けて置き換える。
- 遮蔽の判定（手前の建物に隠れていないか）が無い。
- レインボーブリッジの「歩行者目線」は水面の高さに立っている（岸に置き直す）。
- 夜・雨の look と現示表の全ステップを使う視点表、数値の探り（文字の画素数・輝度）の自動計測は、P4・G3・T4 で足す。 2026-11-11: P4 で輝度の自動計測（視点の `probes` と表の `metrics.from`、`scripts/qa/pixelProbes.ts`、`round-NN/metrics.jsonl`）と昼・夕・夜・雨の夜の look を expressway・roads に足した（[路面と高架のテクスチャ](road-textures.md)）。床版の後方追従の自車を床版の高さに置くようにした（`Placement.car.surfaceY`）。
