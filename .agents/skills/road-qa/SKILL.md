---
name: road-qa
description: >-
  東京の街を撮り、日本の道路交通法・道路標識令・設置基準に照らしておかしなところ（標識の向きや位置、
  区画線、信号、車線、速度、歩行者の動き、違反判定の誤り、高速道路の床版・橋脚、ランドマークの合い）を
  見つけて直すループ。撮り方は 2 つ: 自動運転で走らせて録る（record-drive）と、視点表で狙った物を毎周
  同じに撮る多視点レビュー（shoot-views、収束判定つき）。「AI で画面を判定して直す」「道路の見た目を
  法令どおりにチェック」「標識・信号・高速道路を多視点でレビュー」と頼まれたとき、または /loop で
  繰り返し実行するときに使う。
---

# 走行 QA ループ（撮る × 画面判定 × 修正）

1 回分の流れ。`/loop` で繰り返すときも、毎回この順で 1 周する。

## 1. 撮る

- 開発サーバーが動いていなければ `just serve-dev` を背景で起動する。
- どちらで撮るかを決める:
  - **狙った物を見る**（標識・信号・ランドマーク・高速道路・交差点の形、直した箇所の確かめ）→ 多視点レビュー（下の「1a」）。
  - **走りと違反判定を見る**（車線・速度・合図・誤検知）→ 走行の録画（下の「1b」）。

### 1a. 多視点レビュー（視点表）

詳細は `knowledge/review-loop.md`。

- 視点表 `scripts/qa/views/<name>.json`（既存: `signs`・`signals`・`landmarks`・`expressway`・`roads`）。足すときは同じ形で書く（スキーマ `scripts/qa/viewTable.ts`、綴りを誤ったキーは撮る前に落ちる）。
  - 視点の型: `driver`（運転席 1.2 m）・`pedestrian`（1.6 m）・`chase`（後方追従、自車を置く）・`overhead`（`altitudeM`・俯角 `pitchDeg`）・`free`（`eye` と `lookAt` を緯度・経度・高さで）。対象の前に立つ型は `distanceM`・`angleDeg`（対象の正面から時計回り）・`bearingDeg`（絶対の方位）・`lateralM`。
  - 対象: `landmark`・`sign`（番号、`note: true` で補助標識付き）・`signal`（`arrow: true` で右折矢印付き）・`expressway`（チャンク id）・`point`。道路・標識・信号はスタート地点から約 300 m 以内（道路網の範囲）。ランドマークは遠くてもよい（レインボーブリッジは約 700 m）。
  - 時刻・天気・季節: `defaults.moment`（必須、太陽と空を固定）、`time`・`weather`・`seed`。昼・夜・雨を並べるときは `looks`（ページの読み込み 1 回ずつ、コマは `<session>.<look>--<view>`）。信号の現示は視点の `state.signalStep`（番号、または `green`・`yellow`・`red`・`arrow`）で止める。動く車と歩行者は `hide: ["traffic", "pedestrians"]`。`?expressway` などは `params`。必ず報告させる数値は表の `metrics`。
- `just shoot-views signs`（名前は位置引数。2 周目以降は自動で次の周の番号、不完全な周は同じ番号で撮り直す）。各コマの前に、道路網と建物の読み込みが終わる（`debug.settled()`）まで待つ。出力は `.qa/views/<name>/round-NN/`: `<shot>.jpg` と、「画面にあるはずのもの」の `.json`（対象の id・位置・向き・facts、画面上の位置 `projection`（`offCentre` は狙い点の投影でほぼ 0。見えているかは `screenShare` と目で見る）、settled、時刻・天気、標識なら別表第二の寸法と図の URL、表の `expect`）、`contact-sheet.jpg`（中央を外れたコマと、画面の 0.05 % 未満しか占めないコマは赤枠）、`run.json`、`review-template.json`。
- 対象が見つからない・描かれていない・private なフィールドが改名された、のいずれかのコマは失敗になり、原因（`not-built`・`renamed`・`none-near`・`not-drawn`・`unknown-id`）を出す。失敗が 1 つでもあれば終了コード 1 で、その周は収束の判定に数えない。
- 標識の全描画済み番号の見本は `just render-sign-review`（Blender、`.qa/signs/sheet-<角度>.jpg`）。

### 1b. 走行の録画

- `just record-drive`（既定 3 分・6 秒ごと・昼）で走らせる。夜・別の場所は `node scripts/qa/drive.mjs --time night --start <lat>,<lon>`。
- 出力は `.qa/runs/<時刻>/`。`frame-NNN.jpg` と、同じ瞬間に「画面にあるはずのもの」を書いた `frame-NNN.json`（制限速度と種別、通りの幅・車線数・一方通行・黄色の線・規制、前方の標識と向き、前方の信号の色、ナビ表示、違反の記録）、まとめの `run.json`。

## 2. 判定する

各フレームを Read で見て、JSON と知識（`knowledge/road-markings-and-signs.md`、`traffic-regulations.md`、`road-traffic-law.md`）に照らす。見る観点:

- **標識**: 形・色・向き（規制標識は進行方向に直角〜斜め、一方通行 326-A だけは平行）、立つ場所（車道の中・横断歩道の上・建物の中は誤り）、補助標識。
- **区画線・道路標示**: 中央線の色と実線・破線、車線境界線、停止線と横断歩道の位置、交差点内に線が無いこと。
- **信号**: 各方向に灯器があるか、色と JSON の一致、歩行者用信号。
- **自車の走り**: 制限速度、車線（第20条：片側 2 車線は左の車線、3 車線以上は右端以外）、右左折前の寄り方（第34条）、合図（第53条）、一時停止・信号の停止位置。
- **人と車**: 歩行者が車道を横切っていないか（横断歩道以外）、他の車の向き。
- **違反判定**: `violations` に、法令どおりに走っているのに付いた違反（誤検知）や、逆に見逃しがないか。

多視点レビューでは、観点（様式・寸法・取付・可読性・夜と雨・信号の配列と順序・幾何・性能）ごとに別のレビュー担当を並列に回し、まずコンタクトシートで全体を、次に個々のコマと JSON を見る。

指摘ごとに「フレーム・何が・どの条文や基準に反するか・JSON の根拠」を 1 行で書く。確信が持てないもの（見た目の好みや、データが無くて判断できないもの）は分けて書き、直さない。

多視点レビューの記録は `.qa/reviews/<name>/round-NN.jsonl` に 1 行 1 件（形は `review-template.json` の `example…`）:

- 担当ごとに `{"type": "review", "round", "perspective", "views": [見たコマ]}` を必ず書く。空のファイルは「誰も見ていない周」で、エラーになる。全担当の `views` を合わせて全コマを覆わないと、その周は静穏と数えない。
- 指摘は `id`（`<shot>:<短い名前>`、周をまたいで同じ。同じ周で重複するとエラー）・`round`・`view`（コマの名前 `<session>--<view>`）・`severity`（Critical / Warning / Info）・`status`（open / fixed / wontfix）・`finding`・`perspective`・`basis`。
- 前の周で open の指摘は、書かなくても open のまま持ち越す。閉じるのは `fixed`、または理由を `fix` に書いた `wontfix` だけ。
- 数値の探りは `{"type": "metric", "name", "value", "min" か "max"}`。一度出した探りと表の `metrics` は毎周書く（欠けたら範囲外と数える）。

## 3. 直す

- 指摘を原因のコードごとにまとめる（例：車線位置は `src/game/autoDriver.ts` と `src/world/roads.ts` の `laneOffset`）。
- 法令の値は記憶に頼らず、一次情報（e-Gov の条文、警視庁・国交省の資料）で確かめる。確かめた結果は知識ドキュメントに残す（OKF、trust signal 付き）。
- 直したら単体テストを足し（何を保証するかを書く）、`pnpm exec vitest run`・`pnpm exec tsc --noEmit` を通す。
- 同じ場所・時刻で `scripts/qa/drive.mjs` をもう一度走らせ（多視点レビューなら `just shoot-views <name>` で次の周を撮り）、指摘が消えたことを画面で確かめる。

## 4. 残す

- コミットメッセージ案を示してからコミットする（Semantic Commit Messages、理由を書く）。
- ユーザーへの報告は、見つけたこと・直したこと・確かめ方・直さなかったもの（理由）を短く書く。
- 多視点レビューは周ごとに `just check-convergence <name>` を走らせ、`.qa/reviews/<name>/verdict.json` で止めどきを決める: `converged`（完全に撮れて全コマをレビューした周で Critical / Warning の新規 0 が 2 周続き、open の Critical / Warning が無く、数値の探りが範囲内）で止める。`escalate`（6 周で収束しない）は直すのをやめ、設計へ差し戻す（何が収束しないかを報告する）。結果は knowledge に OKF で残す。
- 走行の録画を `/loop` で回しているときは、指摘が 2 周続けて出なくなったら止める。
