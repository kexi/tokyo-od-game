---
type: Reference
title: 道路標識の定義とレジストリ（src/signs）
description: 道路標識の定義を src/signs/defs/*.ts（zod）の 1 か所にまとめ、assets/signs/registry.json と従来の catalog.json を scripts/signs.ts で書き出す仕組み（段階 G1a）。Pillow の図柄生成が registry.json の paint（描く関数と引数）と規則で導いた車線の版 141 件を読んで 345 枚をバイト一致で作り直すこと（G1b、Pillow 12.3.0 固定）。ゲームの標識種別の対応（旧 BY_ID・design() の switch）を定義の game へ移し、assets/signs/game.json で渡す仕組みと、配置が変わらないことを 3 地点のスナップショットで確かめた方法（G1c）。catalog.json からの機械変換の手順、バイト一致による無損失の確認、標識令 別表第一の番号表（law-table.json）を e-Gov から読む方法、定義・図柄・ゲームの対応・番号表の突き合わせテスト、未描画・未配置の一覧（just show-sign-coverage）、e-Gov と旧表で 125-B の図が食い違った件を記録する。 G2 で、板を src/signs/plates.ts の形ごとの寸法から作り（signs.glb はバイト一致）、表示の倍率を番号ごとの displayScale（警戒 1.3 倍、命令の範囲をテスト）にし、補助標識を Canvas の文字から 502 の図柄（public/data/regs の規制時間から導いた 388 枚、曜日群ごとに 1 枚）に替えた。
tags: [assets, traffic-law, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-10T10:30:00Z }
updated: { by: claude-opus-5-5, at: 2026-11-10T15:30:00Z }
verified:
  - { by: claude-opus-5-5, at: 2026-11-10T10:25:00Z }
  - { by: claude-opus-5-5, at: 2026-11-10T13:20:00Z }
  - { by: claude-opus-5-5, at: 2026-11-10T15:20:00Z }
sources:
  - id: byte-match
    resource: >-
      変換前の assets/signs/catalog.json（sha256 22042dd5992a7ee88239e7fb2543b424ecde5b6ae370ba11ec0b545c8c7e0a01、
      183,848 バイト）を退避し、pnpm exec tsx scripts/signs.ts で書き直してから cmp で比較して一致。
      同じ比較を tests/signRegistry.test.ts の「byte for byte」が毎回行う
    title: catalog.json のバイト一致
    author: claude-opus-5-5
  - id: python-unchanged
    resource: >-
      law_table.py を law-table.json を読む形に替えたあと、scripts/textures/signs/catalog.py の build() と dumps() を
      描画なしで（textures() の全ファイルを書いた扱いで）呼び、出力が assets/signs/catalog.json と一致することを確認
    title: Pillow 側の表の出力が変わらないことの確認
    author: claude-opus-5-5
  - id: egov-law-data
    resource: https://laws.e-gov.go.jp/api/2/law_data/335M50004002003_20260901_508M60000802003?law_full_text_format=json
    title: e-Gov 法令 API v2 道路標識、区画線及び道路標示に関する命令（2026-09-01 施行版、2026-11-10 取得）
  - id: egov-compare
    resource: >-
      scripts/sign-law-table.ts --from（上の law_data）の出力を旧 scripts/textures/signs/law_table.py の SIGNS と
      行ごとに比較。番号 237 件・順序・種類・群は全一致、図は 125-B だけが異なる（旧表 null、e-Gov の表 -087）。
      別に、本文テキストの別表第一から（番号）を抜き出した 237 件とも順序まで一致
    title: 番号表の照合
    author: claude-opus-5-5
  - id: tests
    resource: pnpm exec vitest run tests/signRegistry.test.ts tests/signLawTable.test.ts（30 件と 8 件）
    title: レジストリのテスト
    author: claude-opus-5-5
  - id: png-byte-match
    resource: >-
      G1b の sign_textures.py（registry.json を読む版）を uv run で流し、assets/signs/textures の 345 枚すべてを
      書き直した（find -newer で 345 件）あとに git status が空（コミット済みとバイト一致）。uv が解決した版は
      pillow 12.3.0・numpy 2.5.3・requests 2.34.2（exclude-newer 2026-10-03）、Python 3.13.9、macOS 27.2 arm64
      （Apple M2 Max）。同じ確認を変更前の版でも行い一致。Linux・x86_64 では未確認
    title: 図柄 345 枚のバイト一致
    author: claude-opus-5-5
  - id: lanes-derived
    resource: >-
      defs/lanes.ts の laneRenders（assumedLanes と public/data/turnlanes から導く）の出力を、置き換える前の
      手書きの LANE_RENDERS 141 件と JSON で比較し、順序・番号まで一致（scratchpad の比較スクリプト、2026-11-10）
    title: 車線の版の導出と旧一覧の一致
    author: claude-opus-5-5
  - id: placement-snapshot
    resource: >-
      tests/signPlacement.test.ts を G1c の変更前のコード（7fd65b9 + G1b）で書いてスナップショットを作り（4 件書き込み）、
      変更後に同じテストが一致で通ることを確認。丸の内 14552-6451・渋谷 14549-6452・芝公園 14552-6453 の placeSigns の
      全標識（種別・値・車線・図柄・板・位置・向き・補助の文字）と、全 30 種別 × 値 20 通り × 車線 6 通りの design()
    title: 配置と図柄の不変（G1c）
    author: claude-opus-5-5
  - id: bundle-check
    resource: >-
      G1c の後に vite build し、出力の JS 11 本から定義の注記（「帯の無い旧テクスチャ」）・別表第二の図名（S35F03102010003）・
      未描画の理由（「描画対象外」）を grep。ゲーム本体（main）と共有チャンクには 0 件、図名 1 件がアセット管理画面の
      チャンクだけにある（台帳の文面）。変更前は src/world/signs.ts が catalog.json（183,848 バイト、注記つき）を import していた
    title: バンドルに定義の文字列が入らないことの確認
    author: claude-opus-5-5
  - id: headless-run
    resource: >-
      G1c の後に vite を 5293 番で起動し、ヘッドレス Chrome（scripts/qa/browser.mjs）で丸の内から開始。配置後のシーンの
      標識の InstancedMesh から図柄を集め、41 種（speed_20〜50、turn_1・3〜6、no_entry、one_way_right/left、407a、
      327-7_* の車線 13 種ほか）が描かれていることと、just show-errors が 0 件であることを確認
    title: ゲームでの表示の確認
    author: claude-opus-5-5
  - id: glb-byte-match
    resource: >-
      G2 の前に、変更前の scripts/blender/signs.py で signs.glb を書き直してコミット済みのものと cmp で一致（生成は決定的）。
      registry.json の plates を読む signs.py に替えた後の出力も cmp でバイト一致（131,652 バイト、ノード 29 個の名前と順序も同じ）。
      Blender は nix develop .#blender（2026-11-10）
    title: 板を宣言から作った後の signs.glb のバイト一致（G2）
    author: claude-opus-5-5
  - id: g2-snapshot
    resource: >-
      tests/signPlacement.test.ts を G2 の変更後に vitest -u で書き直し、git diff でスナップショットの差分が 30 行
      （補助標識 4 行、school の scale=1.3 が 26 行）だけで、位置・向きの列が不変なことを確認（2026-11-10）
    title: 配置スナップショットの意図した差分（G2）
    author: claude-opus-5-5
  - id: g2-aux-wording
    resource: >-
      tests/signAux.test.ts が public/data/regs の全通行禁止（1,000 件超）について、auxPlatesFor の行を「・」で連結したものが
      timeNote の空でない行を「・」で連結したものと一致することを検査（空行の除去と「・」での折り返し以外は文言が変わらない）
    title: 補助標識の文言が従来の notePlate と同じことの検査
    author: claude-opus-5-5
  - id: g2-review
    resource: >-
      scratchpad の g2/review.py（Blender CLI、Cycles 24 spp）で代表 12 種 × 6 視点（正面・30°・60°・10/30/60 m）を 3 周撮り、
      Read で別表第二の様式と照合。1 周目の Warning 2 件（長い行の横詰め、ゲーム内で補助標識が通学路の板の下）を直し、
      2・3 周目は新規 0 件。レビュー（Fable）の後の 4 周目で、曜日群で 2 枚に分けた 301 の柱と、標識の構築完了を待った 10 m のコマを撮り直した。ゲーム内は g2/shoot.mjs（ヘッドレス Chrome、vite 5297 番、神田 35.6913,139.7670）で
      歩行者専用＋502（3 行）＋通学路の柱を撮影し、ログの error・sign_aux_undrawn は 0 件
    title: 多視点レビューの収束ループ（G2）
    author: claude-opus-5-5
  - id: painters-recorded
    resource: >-
      旧 catalog.py の textures() の各図柄（車線の版を除く 204 件）を、描画関数を記録用の関数に差し替えて呼び、
      どの関数がどの引数で描くかを集め、defs の paint に機械的に写した（scratchpad の一回限りのスクリプト）
    title: 描画関数と引数の写し
    author: claude-opus-5-5
---

# 何をどこに書くか

- **定義の正は `src/signs/defs/*.ts`**（群ごとに 1 ファイル、`lanes.ts` は車線の版を導く規則と、図示・専用優先の例示の一覧）。形は `src/signs/schema.ts`（zod）。
  - 板の表は `src/signs/plates.ts`（`signs.glb` のノード名 → 形ごとの寸法 mm。G2 から signs.py がこれで板を作る）。定義の `plate` はこのキーだけを取る。
  - 図柄は PNG のファイル名で参照する（`art: { by: "texture", file, paint, variants }`）。描かない番号は `art: { by: "none", reason }`。
  - `paint` はその PNG を描く Pillow の関数と引数（`{ fn: "regulatory.vehicle_closed", args: { name: "car_front", w: 290 } }`）。`fn` は `scripts/textures` の `module.function`（`sign_textures` か `signs/` の `warning`・`regulatory`・`instruction`・`auxiliary`・`nonstatutory`）、`args` はキーワード引数。
    - `over` は、同じ実行で先に描いた PNG の上に描く図柄（316 の上の「８―２０」）。生成器はその PNG をディスクから読み直して第 1 引数に渡す。
    - 車線の版（`327-7_*.png`）だけは `paint` を書かない（書くと拒む）。`lanes.lane_sign` がキーから描く。
  - 同じ標示板に補助標識を附置する番号（305の2・314の2 など 9 件、備考一(一)34）は `shares` で板と図柄を借り、`art` も `plate` も書かない（`plate` はレジストリで借り先から決まる。書くなら借り先と同じ板でなければ拒む）。
  - `game` はゲームの標識種別（`src/signs/game.ts` の `SIGN` のキー）と、その表示のしかた（G1c）。
    - `pick`: 既定の図柄（省略時）、`value`（図柄の `gameValue` が配置の値と同じもの。速度の値、指定方向外進行禁止の許す向き 1 左折・2 直進・4 右折の和）、`lanes`（配置の車線の版）。
    - `mount: "parallel"` と `back`（変種の key）は道路に平行に立て裏に別の図柄を出す一方通行 326-A、`bothFaces` は背中合わせの横断歩道 407-A。
    - `legacy` は面の旧名（311-A の `turn_3`・`turn_6` など）。ファイル名は変えていないが、ゲームは 311 を正式番号で扱う（`design()` が返す `id`）。
- **書き出し**: `just make-sign-registry`（`scripts/signs.ts`）が定義を検査し、次の 3 つを書く（game.json は G1c から、下の「ゲームへの対応表」）。
  - `assets/signs/registry.json`（version 3）: 検査済みの定義・板（輪郭と `boxMm`）・車線の版・補助標識の文言（`aux`）・描画関数・表示の倍率と、番号ごとの別表第二の図。図柄（Pillow）と板（Blender）の入力。
  - `assets/signs/catalog.json`: 従来の形のまま。G1c からゲームは読まず、`tests/coverage.test.ts` だけが読む（アセット管理画面も読まない）。撤去は「落とし穴・未解決」の残課題。
- **番号表**: `assets/signs/law-table.json`。`just fetch-sign-law-table`（`scripts/sign-law-table.ts`）が e-Gov 法令 API v2 から版を固定して書く。表の読み取りは `src/signs/lawTable.ts` の純粋関数（`tests/signLawTable.test.ts` が小さな合成表で検査）。G1b までは `scripts/textures/signs/law_table.py` もこれを読んでいたが、Python が registry.json だけを読むようになって削除した。
  - law-table.json は生成器の出力そのものにする。手で直さない（直したい値は `FIGURE_OVERRIDES` に理由つきで書く）。

## 図柄の生成（G1b）

`scripts/textures/sign_textures.py` は registry.json だけを見て描く。Python 側に番号・寸法・変種の一覧は無い（`catalog.py` の `Meta`・`Tex`・`meta_for`・`textures()`、`law_table.py`、ファイル名から関数を引く `SIGN_GENERATORS`、lanes.py の `assumed_lanes`・`file_name`・`plate_node` を消した）。

- 描く順: 各番号の図柄（`shares` の番号は持たない）、次に車線の版。`over` のある図柄は最後に回す（土台の PNG が先にディスクにある）。
- 関数は `module.function` の名前を `getattr` で引く。モジュールは registry.json の `painterModules`（`src/signs/schema.ts` の `PAINTER_MODULES` の 1 か所）に限り、`_` で始まる名前と、戻り値が `Image.Image` と宣言されていない関数（`generate`・`render`・`main` など）は拒む。TS 側のテストも同じ条件（`def <名前>(…) -> Image.Image:`）をソースで確かめる。生成器の内部の画像を返す関数は `_draw_job`・`_paint_with`・`_build_contact_sheet` と `_` 付きにした。
  - 設計（`@painter("regulatory.speed_sign")` のデコレーター登録）からの変更。描画関数 120 余りに手を入れずに済み、名前は `def` の名前そのものなので、TS 側のテストが `scripts/textures` の `def <名前>(` を探して実在を確かめられる。
- 車線の版はキー（`lt~bus-t-r`）を `lanes.spec_of` で車線の並びに戻して描く。`slug(spec_of(k)) == k` でなければ止まる。
- 書いた PNG の一覧に無い `assets/signs/textures/*.png` は `stray` としてログに出す。既定では消さず（定義を書いている途中の図柄かもしれない）、テストが落とす。`--prune` を付けると消す。
- `just fetch-regs` のあとは `just rebuild-sign-assets`（`make-sign-registry` → 図柄の生成 → `--prune`）。turn:lanes の値が変わると車線の版が増減するため。
- `render`（`just render-sign`）は、その番号（`shares` なら借り先）の図柄のうち、値や文言を取る関数（`TEXT_ARGS` の表、関数名で引く）の最初の 1 つを `--text` で描く。番号の一覧は持たない。
  - 旧版は「5 で始まる番号は文字の補助標識」として 503-B（車両の絵）にも文字を描いていた。今は値を取る関数の無い番号は断る。
- **Pillow の版の固定**: PEP 723 で `pillow==12.3.0`・`numpy==2.5.3`・`requests==2.34.2`（`exclude-newer` は据え置き）。PNG のバイト列は Pillow と同梱の zlib の版で変わるため。上げるときは全図柄を作り直し、差分を目で確かめてからコミットする。`requires-python` は numpy 2.5.3 に合わせて 3.12 以上。
  - バイト一致を確かめたのは macOS arm64・Python 3.13.9 だけ（sources の png-byte-match）。
  - 後続の課題: CI（Linux）で図柄を作り直して `git diff --exit-code` で検査する。Linux で一致しなければ、バイトではなく画素の比較（デコードした RGBA の一致）に切り替える。

### 車線の版は規則で導く

`src/signs/defs/lanes.ts` の `laneRenders` が、初出順に次を並べる（G1a までは同じ 141 件を手書きの `LANE_RENDERS` で持っていた。レビュー W5 の続き）。

1. 別表第二 図 166–169 の図示 4 件。
2. ゲームの `assumedLanes`（`src/world/regulations.ts`）の 1〜6 車線 × 出口 7 通り。関数は `scripts/signInputs.ts` が渡す（`src/signs` から `src/world` を import しないため）。
3. `public/data/turnlanes` の z14 タイルの turn:lanes の値（ファイル名順、行順）。
4. 専用・優先の例示 5 件。

- キーと番号の規則は `src/signs/lanes.ts`（lanes.py の `parse`・`slug` と同じ読み方。番号は 1 車線なら 327の7-D/C/B、複数なら -A、専用・優先の車線があれば 327の4 / 327の5）。
- 置き換えの前に、導いた 141 件が手書きの一覧と順序・番号まで一致することを確かめた（sources の lanes-derived）。以後は registry.json の鮮度検査が守る。
- `just fetch-regs` で turn:lanes の新しい値が入ると registry.json が古くなり、テストが落ちる。`just make-sign-registry` のあと `just make-sign-textures` で図柄を足す。

### 図柄の枚数（345 と 346）

設計書の「346 枚」は `assets/signs/textures` の項目数で、`README.md` を含む。PNG は 345 枚で、README・台帳・catalog.json の数（204 図柄＋車線の版 141 件）と一致する（2026-11-10 に `ls | grep -c png` と catalog.json のファイル集合で確認）。

## ゲームへの対応表（G1c）

- `just make-sign-registry` が定義から `assets/signs/game.json` も書く（`src/signs/gameTable.ts`）。種別ごとに選び方・図柄（番号・ファイル・板・値）・車線の版・裏の図柄だけを持つ（約 25 KB）。
- `src/world/signs.ts` の `design()` は `src/signs/game.ts` の `designFor` でこの表を引くだけになった。`BY_ID`・switch・`catalog.json` の import を消した。
  - registry.json や defs を import しなかった理由: 名前・注記・図名・理由がバンドルに入る（レビュー I9）。game.json はファイル名・板・番号だけ。
- `SIGN`（種別のコード）は `src/signs/game.ts` へ移し、`src/world/regulations.ts` が再 export する。コードは数値のまま固定（標識の配置は数値で受け渡すので、定義が増えてもずれてはならない）。スキーマは `game.kind` をこのキーに限る。
- 定義の検査（`buildRegistry`）は、種別ごとに図柄が 1 つに決まることを確かめる。既定の図柄で出す種別に定義が 2 つ、値で選ぶのに値が無い・重複、値で選ばない種別の `gameValue`、車線の版の無い `lanes`、変種に無い `back`、重複した `legacy` や番号と同じ `legacy` を拒む。
- 車線の版の引き方: 方向の無い車線（知らない語だけの車線を含む）は直進として引く（`[[], ["right"]]` → `327-7_t-r`）。turn:lanes を読むほかの場所と同じ。旧 `laneDesign` は空の文字列にして版が見つからず、何も立てなかった（レビューで design() の新旧 9,835 入力を比べ、差はこの 4 行だけ）。ゲームの車線は空にならないので、配置は変わらない。
- 描いていない車線の版（6 車線を超える、registry より新しい turn:lanes）は標識を立てず、`sign_lanes_unrendered`（警告、版ごとに 1 回）をログに出す。
- `game.mount` は板の向き（平行）だけを表す。支柱と高さ（設計 4 章、G4 の `mount`）は別の項目になり、そのときにまとめる。同じ種別の定義どうしで `mount`・`back`・`bothFaces` が食い違えば拒む（game.json は種別に 1 つしか持たない）。
- 移した結果わかったこと: 323 は 10・100・110・120 km/h の図柄も持つが、ゲームは 20〜80 しか出さない（旧 switch の配列）。挙動を変えないため `gameValue` は 20〜80 にだけ付けた。

### 不変の確かめ方（tests/signPlacement.test.ts）

- 変更前のコードでスナップショットを作り、変更後に一致することを確かめた（sources の placement-snapshot）。
- 入力の 3 タイル（regs と turnlanes）は `tests/fixtures/sign-placement/` に凍結した（出典と ODbL の表記は同じ場所の LICENSE.txt）。`just fetch-regs` でスナップショットが書き換わらないようにするため。
- 道路は実行時に地理院ベクトルタイルから読むためリポジトリに無い。そこで regs タイルの規制の線（速度・一方通行・区間規制・通行禁止・車線など）を重複なく道路の中心線とみなして道路網を作り、`applyRegulations` の `placeSigns` を流す。位置はゲームの実際の位置ではない。
  - この道路では届かない分岐がある: すべて幅 9 m の対面通行の local なので、highway の分岐と道路自身の一方通行（`line.oneway ≠ 0`）は通らず、`lanesPerDirection` は常に 2。closed・noVehicleCrossing・horn・busPriority・hydrant・school の 6 種別は 3 地点に出ない。crosswalk・stop は placeSigns ではなく TrafficSigns が置く。
  - これらは 2 つ目の表（全種別 × 値 × 車線の `design()`）が補う。
  - 地理院タイルをテスト用に置かなかった理由: 実時間の利用として提供されている（src/world/gsiVectorTiles.ts の注記）。
- 3 地点で 1 行 1 標識（種別・値・車線・図柄と板・裏・平行・背中合わせ・位置・向き・補助の文字）、ほかに全種別 × 値 × 車線の `design()` の表。

## 板・拡大率・補助標識（G2）

### 板は plates.ts の宣言から作る

- `src/signs/plates.ts` が板の唯一の定義になった。ノード名ごとに、別表第二が図示する寸法で輪郭を書く（mm）。
  - 円は直径（`diameterMm`）、逆三角形と菱形は一辺（`sideMm`）、長方形・正方形は横 × 縦（`widthMm`・`heightMm`）、407 の五角形は横と台の高さ（`widthMm`・`baseMm`）。円以外は角の半径（`cornerMm`）も持つ。
  - G1a の `sizeMm` は、菱形だけが一辺で、ほかは外接矩形だった（レビュー I3）。形ごとに項目を分けて、1 つの項目が形で意味を変えないようにした（`src/signs/schema.ts` の `PlateOutlineSchema`）。
  - 図柄が覆う外接矩形（UV 0–1）は `plateBoxMm` が輪郭から出し、registry.json の各板に `boxMm` として書く。宣言には書かない（二重に持たない）。逆三角形は 800 × 692.8、菱形は対角線の 636.4 角、五角形は 600 × 719.6。
- `scripts/blender/signs.py` は registry.json の `plates` を順に読んで板を作るだけになった（寸法の直書きを消した）。UV は角を丸める前の輪郭の外接矩形に張る（従来と同じ）。`just make-sign-model` は先に `make-sign-registry` を流す。
- **互換の確かめ**: 移す前の signs.py で作り直した signs.glb がコミット済みのものとバイト一致すること（生成は決定的）を先に確かめ、移した後の signs.py の出力も `cmp` でバイト一致した（sources の glb-byte-match）。ノード名・順序・頂点・UV は変わっていない。そのため `public/models/signs.glb` はこの段階で書き直していない。
  - 一致させるため、`PLATES` の並びは signs.py が作っていた順にしてある（円・逆三角・正方形・326-A・326-B・菱形・五角形・327 系 …）。
- 旧 catalog.json の `size_mm` は従来どおり菱形だけ一辺で書く（`catalog.ts` の `catalogSizeMm`）。catalog.json はバイト一致のまま。
- Pillow のコンタクトシートの実寸比は `boxMm` を読む（菱形を √2 倍する分岐を消した）。

### 拡大率（displayScale）

ゲームは板を実寸で作り、表示するときだけ拡大する。従来は `src/world/signs.ts` の `SCALE = 1.25` を全部の板に掛けていた。G2 で番号ごとの `displayScale` にして定義側に持たせ、`design()` が返す `scale` で板ごとに掛ける。

| 群         | displayScale（既定）     | 命令が許す範囲（高速道路等以外） | 根拠                 |
| ---------- | ------------------------ | -------------------------------- | -------------------- |
| 規制・指示 | 1.25                     | 1/2〜2 倍                        | 別表第二 備考一(二)9 |
| 警戒       | **1.3**（従来 1.25）     | 1.3・1.6・2 倍だけ               | 別表第二 備考一(二)6 |
| 補助       | なし（吊る先の板の倍率） | 本標識板と同じ比率               | 別表第二 備考二(二)2 |
| 法定外     | 1.25                     | 命令の外（規制と同じ範囲で検査） | —                    |
| 案内       | 1                        | 番号ごと（G5）                   | 備考一(二)3〜8       |

- **訂正（2026-11-10、G2 レビュー W1）**: 補助標識の拡大を ~~規定なし（設計 9 章の未確認）~~ としていたのは誤りだった。別表第二 備考二(二)2 に「補助標識は、その附置される本標識板の拡大率又は縮小率と同じ比率で拡大し、又は縮小することができる」とある（e-Gov 2026-09-01 施行版の本文、scratchpad の egov/335M50004002003.txt 239 行で確認）。ゲームの挙動（吊る先の板の倍率で描く）はこの規定どおりで、変えていない。
- 群の既定は `src/signs/schema.ts` の `DISPLAY_SCALE`、許す範囲は `ENLARGEMENT`（高速道路等の規定は `enlargementFor` に型と値だけ用意した。警戒は設計速度 60 以上で 2 倍まで・100 以上で 2.5 倍までの範囲、案内は 3 倍まで。G6 で使う）。定義は `displayScale` で番号ごとに上書きできる。registry.json の各番号に解決後の値が載り、game.json の各面に `scale` が載る。
- `buildRegistry` は範囲の外を拒む（警戒の 1.25、規制の 2.5 など）。`tests/signRegistry.test.ts` は命令の範囲をテストの中に別に書いて全番号を照らす。
- 警戒の 1.25 は令の値ではなかった（段階指定）。ゲームが置く警戒は 208 学校あり（`school`）だけで、45 cm の菱形が 56.3 cm → 58.5 cm の一辺になる。
- 柱の板の高さは純粋関数 `src/signs/stack.ts` の `stackPlates`（G4 の resolveMount の種）が決める。間隔 `STACK` は 1.0 m のまま。下の板は、上の板とその補助標識の下端から 6 cm 空けた位置より下へ押し下げる（大きな板どうしが重ならない）。下端が地面より下になる面は、その下の面ごと立てず、`sign_faces_below_ground`（警告）で数を出す。`tests/signStack.test.ts` が「重ならない・補助標識は自分の板の直下・下端 ≥ 0・補助標識の無い柱は従来の高さ」を、1〜3 枚の板と 0〜3 行の補助標識の組み合わせで検査する。

### 補助標識は 502 の図柄で吊る

- 従来は、通行禁止（歩行者専用・通行止め・車両通行止め・二輪の自動車以外の自動車通行止め）の時間帯を、板の下に Canvas の文字（`notePlate`）で描いていた。G2 で 502 日・時間 の図柄（Pillow の `auxiliary.text_plate`）に替え、`notePlate` を消した。
- **どの規制にどの補助標識が付くか**は `src/signs/auxPlates.ts` の `auxPlatesFor` の 1 か所で決める。
  - placeSigns（`src/world/regulations.ts`）は配置した標識の `aux` にこれを入れる。`src/signs/defs/auxiliary.ts` の `auxRenders` は public/data/regs の全通行禁止にこれを当て、描いておく文言を集める。
  - 文言は `ruleTime.ts`（G2 で `src/time/ruleTime.ts` へ移した。`src/world/ruleTime.ts` は再 export だけ）の `timeNote`（曜日、時間、「…を除く」の行）と同じにした。ナビ・HUD と板が食い違わないようにするため。違いは次の 3 つだけである。
    - 曜日群（曜日コード 1〜6。0 と語の無いコードは毎日）の違う時間帯が混じる規制は、群ごとに 1 枚にする。timeNote は曜日を 1 行・時間を次の行にまとめ、「日・休日／7:30-9・13-16・8-11／土・日・休日を除く」のように全部の時間帯が日・休日のように読めた（G2 レビュー I5）。「…を除く」は毎日の群に付ける（毎日の群が無ければ各群に）。
    - 空の行は落とす。曜日コード 99 など timeNote に語の無いコードで生じる。
    - 12 字を超える行は「・」の位置で折り返す。3 行に収まらなければ折り返さず、Pillow の横詰めに任せる。曜日群で分けた後は該当 0 件。
  - タイルは除外の車種を持たない（JARTIC の 除外車種 を書き出していない）。そのため、今の補助標識は 502 だけである。
- 描いておく文言は public/data/regs から規則で導く（車線の版と同じ考え）。2026-11-10 のデータで 388 件、1 行 139・2 行 200・3 行 49 件。並びはキー（`auxKey`）の符号単位順で、取得のたびに増減した文言の行だけが動く（初出順だと後ろが全部ずれる。レビュー I7）。
  - 行は `src/world/closures.ts` の `readClosureRow` で読む（ゲームの regulations.ts と同じ読み方。レビュー I2）。
  - registry.json の `aux` に、番号・行・ファイル・板・描き方が並ぶ。板は行数で `plates.ts` の `AUX_TEXT_PLATES`（`PlateAux60x22/32/44`）から選び、描き方はその番号の `paint` の `lines` を差し替え、板の高さを `h` として渡したもの。`auxiliary.py` の `HEIGHTS` 表とこの板の高さが同じことを `tests/signRegistry.test.ts` が検査する（`h` を渡しても描画は同じで、作り直した 373 枚はバイト一致）。
  - ファイル名は `502_h<行の FNV-1a 8 桁>.png`。文字列に「:」「・」と日本語が混じり、読める名前にすると独自のエスケープ規則が要るため、ハッシュにした。重なりは `buildRegistry` が拒む。
  - 白黒だけなので、16 色のパレット PNG で保存する（`colors: 16`）。RGBA で描くと約 40 KB のところ、パレットで 2.3〜15.5 KB、388 枚で計 2.55 MB（2,552,761 バイト、2026-11-10 実測）。従来の 345 枚は RGBA のままでバイト一致を保つ。
- game.json の `aux` が文言 → 図柄の表である（キーは `auxKey`、`502:7:30-9/土・日・休日を除く`）。ゲームは `auxDesignFor` で引き、吊る先の板の倍率で描く。
  - 表に無い文言は、補助標識を付けずに板だけを立て、`sign_aux_undrawn`（警告）を文言ごとに 1 回ログに出す。registry より新しい regs で起きるもので、`tests/signAux.test.ts` が落ちる。
  - ゲームの `import.meta.glob` は `?url&no-inline` で読む（アセット管理画面も）。`?url` だけだと Vite の assetsInlineLimit（4 KB）未満の PNG が base64 で起動チャンクに入り、vite build で起動時のチャンクの PNG data URI が 89 個（うち 502 が 81 個）あった。`no-inline` の後は 8 個（標識以外の既存の画像）で、起動時の JS（main と共有チャンク）は 7.94 MB → 7.56 MB（G2 レビュー W2）。
  - Canvas で描き残さなかった理由: 字形の計測がブラウザで揺れ、別表第二の図柄（Pillow）と様式が分かれる（設計 2 章の案 D の棄却理由）。
- 補助標識は、その標識の板のすぐ下に吊る（`TrafficSigns.layOut` → `stackPlates`）。従来は柱の一番下の板の下だった。そのため、歩行者専用＋通学路（区の板）の柱では、時間の板が通学路の板の補助に見えていた（ゲーム内の多視点レビュー 1 周目で発見）。
- `just fetch-regs` で規制時間が変わると registry.json が古くなり、テストが落ちる。その場合は `just rebuild-sign-assets` を流す（registry → 図柄 → どの定義にも無い図柄の削除）。

### G2 のスナップショット更新

`tests/signPlacement.test.ts` のスナップショットは、意図した変化だけを確かめてから書き直した（`vitest -u` の後に `git diff`）。差分は 30 行で、内訳は次のとおり。

- 補助標識 4 行（3 地点の歩行者専用）。従来の文字 `| 7:45-8:30/土・日・休日を除く` が `| 502 7:45-8:30/土・日・休日を除く@PlateAux60x32` になった（番号と板が付いた）。
  - 文言が変わったのは 1 行だけで、`8-9:30・11:30-13:30・17-19:30` が 3 行に折り返された。
- design() の表 26 行。`school`（208）の値・車線の全組に ` scale=1.3` が付いた。表には 1.25 以外の倍率だけを書く。そのため、ほかの行は変わらない。
- 標識の追加・削除・移動は 0 件（位置・向きの列は不変）。

### 多視点レビュー（G2、収束ループ）

- Blender の単体レンダで、板と補助標識の代表 12 種を撮った（scratchpad の `g2/review.py`）。
  - 12 種は、警戒 208・201-A、補助付きの 325の4・302・301・310（1〜3 行、長い行）、323（40）、326-A、330-A、407-A、327の7-A。
  - 視点は、正面、斜め 30°、斜め 60° と、運転席の高さ 1.2 m・路端から 3.5 m・ゲームの視野 62° で 10・30・60 m の 6 視点。
  - signs.glb を読み込み、ゲームと同じ組み方（上の板の中心 2.6 m、倍率、補助標識は 6 cm 下）にした。
- ゲーム内は、ヘッドレス Chrome（vite は 5297 番）で神田の歩行者専用（時間つき）の柱を、カメラを柱へ向けて撮った（10・20 m と望遠）。
  - 初回の 10 m のコマに標識が写らなかったのは、標識の分割構築（main.ts の `signs.rebuildAsync`）の途中で撮ったため。シーンの標識の面のインスタンス数が 0 でなくなり 2 秒変わらなくなるまで待って撮り直し（3,252 面）、10 m でも写ることを確かめた（4 周目、レビュー I1）。
- 1 周目の指摘（Warning 2 件）は次のとおり。
  - 長い 1 行（`8-9:30・11:30-13:30・17-19:30`）が横に半分まで詰められ、読みにくい。→「・」で折り返すようにした。
  - ゲーム内で、時間の補助標識が通学路の板の下に吊られていた。→ 自分の板の直下に吊るようにした。
- 2 周目・3 周目は新しい指摘 0 件で、収束した。
  - 3 行に収まらない 16 件の横詰めは、レビュー I5 の後に曜日群で分けて 0 件になった。
- 様式の照合結果は次のとおり。
  - 補助標識は、白地・黒縁・黒文字、横 60 cm × 縦 22/32/44 cm で、主標識と同じ幅（いずれも 1.25 倍で 75 cm）。色は備考二(三)1（地白・文字黒）どおり。
  - **黒縁 9 mm は令の値ではない**（レビュー I9）。備考二(三)1 は色だけを定め、縁の有無・太さは書いていない。別表第二の補助標識の図（e-Gov の添付画像）は判読できず、交通規制基準（第2章 (6)(8)）も板の寸法と文字の大きさだけを示す。9 mm は `auxiliary.py` の `EDGE` の仮定値で、図の見た目に合わせたもの（未確認、2026-11-10 に egov/335M50004002003.txt の備考二と交通規制基準 p.36 を読んで確認）。
  - 警戒は、黄地・黒の縁と記号の菱形で、1.3 倍。
  - 逆三角・五角形・横長の 326-A・327 系の形と UV は従来と同じ（板がバイト一致のため）。

# catalog.json からの変換（G1a、1 回だけ）

変換は使い捨ての Python スクリプトで行い、リポジトリには残していない。変換後は defs/ が正になるため、catalog.json から defs/ を作り直す道具を残すと、正がどちらか分からなくなる。手順と規則は次のとおり。

1. catalog.json の `signs` を 1 件ずつ、群ごとのファイルへ書いた。`plate_node` は `plate`、`texture` は `art.file` にした。
2. `variants` のうち `lanes:` で始まるものは書かない（`defs/lanes.ts` から作る）。それ以外は `{ key, file, plate? }` にした。
   - 変種の `size_mm` は板から決まる。そのため `plate_node` の無い `size_mm` が無いことを確かめた（0 件）。
3. `lanes.rendered` の 141 件は `{ lanes, sign }` だけにした。`sign` は、その PNG を既定か変種に持つ番号である。
   - 141 件の由来は、catalog.py `_lane_variants` が集めた順に初出で数えると、図示 4、`assumedLanes`（`src/world/regulations.ts`）の 1〜6 車線 × 出口 7 通りで新たに 32、`public/data/turnlanes` の OSM の turn:lanes で新たに 100、専用・優先の例示 5 である（scratchpad の集計スクリプトで再現し、141 件と集合が一致）。
   - `assumedLanes` の全パターンと turnlanes の全値が `LANE_RENDERS` にあることをテストする。`just fetch-regs` で新しい値が入ると落ちるので、定義と図柄を足す。
   - catalog.py は `public/data/turnlanes/meta.json`（タイルの一覧）も turn:lanes として読んでいたが、キー名の 4 文字目が方向語にならず、すべて直進 `t` になるだけで、版は増えていない。テストは z14 のタイルだけを読む。
   - ファイル名 `327-7_<key>.png` と板（1 車線は `PlateSquare90`、n 車線は `PlateRect{40n}x90`）は、キーから決まる（`laneFile`・`lanePlate`、lanes.py と同じ規則）。
4. 板の表は、各番号の板（catalog.py の `meta_for`）から形と寸法を取った。
   - 同じノードで寸法・形が食い違う組は 0 件だった。
   - 車線の版と補助標識の変種にだけ出るノード（`PlateRect80x90` など）は名前から形を決めた（`PlateAux30x30` は正方形）。
5. `shares` の 9 件は catalog.py（G1b で削除）の `shared` の表から取った。注記 `note` は catalog.json の文言をそのまま写した。
6. `game.kind` は `src/world/signs.ts` の `BY_ID` と `design()` の switch から取った。
   - 36 番号が該当する。311-A〜D は `turn`、327の7-A〜D は `laneArrows`。

## バイト一致にするための約束

- **Python の float と int**: catalog.json の大きさは、別表第一の番号と車線の版では float（`600.0`）、法定外では int（`600`）だった。JS の数には区別が無い。そのため `src/signs/catalog.ts` は `PyFloat` で包み、`.0` を付けて書く。
- **配置**: `src/signs/jsonLayout.ts` は `catalog.py` の `dumps` の移植である。配置は oxfmt（printWidth 110）が整形したあとの形と同じで、オブジェクトは 1 行 1 キー、スカラーの配列は収まれば 1 行に書く。
  - 幅は符号位置で数える。Python の `len` に合わせるためで、JS の `length` は UTF-16 の単位で数えてしまう。
  - registry.json と law-table.json も同じ関数で書く。生成直後から `just check-format` を通る。
- **変種の板と寸法**: `plate_node`・`size_mm` は、その番号の板と違うときだけ書く。catalog.py は `meta_for` の板と比べていたが、既定の図柄が板を上書きする番号は 0 件だった（変換時に確認）。そのため、番号の板と比べても同じ結果になる。

# 検査（tests/signRegistry.test.ts）

- registry.json と catalog.json が、定義から作ったものとバイト一致する。これは鮮度検査である（defs を直して書き出し忘れた、生成物を手で直した、で落ちる）。変換が無損失だったことの証明は、変換前の catalog.json（sha256 は上の sources の byte-match）との比較で 1 回行った。
- 別表第一の番号が、順序・種類・群まで law-table.json と一致する。`x-` は法定外だけで、別表第一の後ろに並ぶ。id は一意。
- 定義が指す PNG がすべて存在し、`assets/signs/textures/*.png` のすべてがどれかの定義の図柄である。PNG の持ち主は 1 つ（`shares` で借りる番号を除く）。
- 描かない番号には理由がある。`shares` と車線の版は、描いてある番号だけを指す。
- 各図柄の `paint.fn` が `scripts/textures` に `def` として実在する（Python を起動せずソースを読む）。`paint` の無い図柄、車線の版に書いた `paint`、自分では描かれない PNG を指す `over` を拒む。
- 車線の版の読み方（`+` と `;`、知らない語を捨てる、空の車線は直進）と番号の規則、並びの先頭（図示）と末尾（専用・優先の例示）。
- 板がすべて `public/models/signs.glb` のノードにある（glb の JSON チャンクを読む）。名前の寸法（`120x90`）が `sizeMm` と合い、逆三角形は外接矩形 80 × 69.3 cm を覆う。
- `game.kind` が `SIGN` のキーだけを指し、`SIGN` のすべての種別に定義がある。game.json が定義から作ったものとバイト一致する。
- 311 の面は `design()` が正式番号（311-A〜D）で返し、`legacy` の `turn_<値>` がその番号を指す。速度は 20〜80 だけを出す。
  - 実際にゲームが描く図柄とも突き合わせる。`design()`（`src/world/signs.ts`、テストのために export した）が種別ごとに選ぶ全ファイルが、その種別を名乗る定義の図柄になっていること。逆に、種別を名乗る定義のどれかの図柄を `design()` が選ぶこと。
- 壊れた定義は、番号と項目を添えてすべて並べて拒む。対象は、無い板、`art` も `shares` も無い、`shares` 以外で `plate` を省いた、法定外でない `x-`、根拠の無い法定外、描いていない番号への `shares`・車線の版、借り先と違う板、id の重複、別表第一に無い番号、同じ番号の中で変種の key の重複、車線の版の重複、方向の無い車線（`t--r`・`-t`・`~bus`）。
- `layoutJson` は、オブジェクトの undefined の値を飛ばし、配列の中の undefined・NaN・Infinity を拒む。Python と表記が分かれる float（1e16 以上、0 でない 1e-4 未満）も拒む。
- 番号表の読み取り（`tests/signLawTable.test.ts`）では、範囲（・と ～ U+FF5E）の展開、rowspan でまたがる種類、列の数の違い、ルビ、rowspan と colspan のずれた見出しと図の対応、件数の下限（200 行未満は表を読み損ねたとみなす）、図の上書きを検査する。

# 未描画・未配置の一覧（just show-sign-coverage）

2026-11-10 の結果は次のとおり。

- 定義は 244 件（別表第一 237 件と法定外 7 件）。
- 図柄があるのは 155 件。そのうちゲームが配置するのは 37 件（G2 で 502 日・時間 が加わった）で、図柄はあるが未配置なのは 118 件。
  - 内訳は、警戒 26、規制 43（324 最低速度・325 自動車専用・320〜322 の重量・高さ・幅制限など）、指示 14、補助 30、法定外 5。
- 未描画は 89 件で、すべて案内標識。
- 未配置の一覧は配置規則が増えるたびに減る数として見る。テストでは落とさない。

注意点が 2 つある。

- **補助標識**: G2 からゲームは 502 日・時間 を図柄で吊る（registry の `aux`、上の「補助標識は 502 の図柄で吊る」）。ほかの補助 30 件は、まだどの規制にも付けていない（JARTIC のタイルに区間・車種などの情報が無い）。
- **案内標識**: 方面及び方向の 108 系は、実行時に Canvas で描いている（knowledge/road-markings-and-signs.md「案内標識（方面及び方向 108 系）」）。それでも、ここでは catalog.json と同じく「描画対象外」と数える。G5 のレイアウタで定義へ入れる。

# 落とし穴・未解決

- **補助標識の残課題（G2）**
  - ナビ・HUD の文言（timeNote）は、曜日群の混じる規制をまだ 1 行にまとめる（板は曜日群ごとに分けた）。timeNote も分けるなら、ナビの表示の変更として別に行う。
  - 車種（503）・区間（501）の補助標識は、タイルに情報が無く付けていない。scripts/regulations.ts で JARTIC の除外車種を書き出せば、`auxPlatesFor` に足すだけで付く。
  - **板の下端の高さ（G4 で直す）**: 道路標識設置基準の下端は路側 1.8 m 標準・歩道上 2.5 m 以上だが、`stackPlates` は高さを従来どおり（上の板の中心 2.6 m から 1.0 m 間隔）にしただけで、この基準を検査していない。2 枚目以降の板は 1.8 m を切る（60 cm の板の 2 枚目で下端 1.225 m、3 枚目で 0.225 m）。歩行者専用＋補助標識 3 行＋通学路の柱では最下端が約 0.93 m、一時停止＋補助標識付きの通行禁止＋通学路のように地面を下回る構成では、下の面を立てない（`sign_faces_below_ground`）。G4 の resolveMount で、板の下端の基準と、収まらない柱を 2 本に分ける規則を決める。
  - 区の通学路の板（30 cm 幅）の裏の取付金具（40 cm 幅のレール）が、板の左右にはみ出して見える。G2 の前からあり、G4 の部材で直す。
- **ファイル名に `aux` を使わない**: 補助標識の規則のモジュールを `src/signs/aux.ts` にしかけたが、`AUX` は Windows の予約デバイス名で、拡張子が付いても作れない。`auxPlates.ts` にした。

- **catalog.json の撤去（残課題）**: 利用側が残っている間は registry から同じバイトで書き続ける。読む側をレジストリ（G1c 以降は game.json）へ移したら、`src/signs/catalog.ts`・`scripts/signs.ts` の書き出し・台帳の sign-catalog・鮮度検査をまとめて消す。

- **125-B（路面電車停留場）の図**: e-Gov の別表第二の表では、行 59 の 3 番目の見出し「路面電車停留場（１２５―Ｂ）」の下の図が `S35F03102010003-087.jpg` である。どの番号も使っていない添付の連番に当たる。
  - 旧 law_table.py は null で、見出しと図の colspan のずれ（見出し 3・3・1、図 3・2・2）で取りこぼしたとみられる。
  - G1a ではバイト一致を守るため `FIGURE_OVERRIDES` で null を書かせていた。2026-11-10 に G1a の直後のコミットで上書きを外し、`just fetch-sign-law-table` と `just make-sign-registry` を流した。law-table.json・catalog.json・registry.json の 125-B の `figure` が 1 行ずつ -087.jpg に変わったことを `git diff --stat`（各 1 行）で確かめた。
- **別表第二の図の取り方**: 見出しの行（1 行とは限らない。305 と 305の2 は rowspan 2 の隣に 2 段の見出し）の下に図の行が来る。
  - 図は、その列の範囲で始まる見出しすべてに当てる。セルの順で対にすると、colspan の違いでずれる。
- **別表第一の列**: 列の数は表によって違う（規制・指示には「意味」の列がある）。種類が rowspan でまたがる行は番号から始まるので、先頭のセルに番号があるかで見分ける。
- **ルビ**: 勾＜こう＞配 の `Rt` は名前から除く（旧表と同じ）。
