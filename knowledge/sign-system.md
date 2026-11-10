---
type: Reference
title: 道路標識の定義とレジストリ（src/signs）
description: 道路標識の定義を src/signs/defs/*.ts（zod）の 1 か所にまとめ、assets/signs/registry.json と従来の catalog.json を scripts/signs.ts で書き出す仕組み（段階 G1a）。Pillow の図柄生成が registry.json の paint（描く関数と引数）と規則で導いた車線の版 141 件を読んで 345 枚をバイト一致で作り直すこと（G1b、Pillow 12.3.0 固定）。catalog.json からの機械変換の手順、バイト一致による無損失の確認、標識令 別表第一の番号表（law-table.json）を e-Gov から読む方法、定義・図柄・ゲームの対応・番号表の突き合わせテスト、未描画・未配置の一覧（just show-sign-coverage）、e-Gov と旧表で 125-B の図が食い違った件を記録する。
tags: [assets, traffic-law, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-10T10:30:00Z }
updated: { by: claude-opus-5-5, at: 2026-11-10T13:30:00Z }
verified:
  - { by: claude-opus-5-5, at: 2026-11-10T10:25:00Z }
  - { by: claude-opus-5-5, at: 2026-11-10T13:20:00Z }
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
  - id: painters-recorded
    resource: >-
      旧 catalog.py の textures() の各図柄（車線の版を除く 204 件）を、描画関数を記録用の関数に差し替えて呼び、
      どの関数がどの引数で描くかを集め、defs の paint に機械的に写した（scratchpad の一回限りのスクリプト）
    title: 描画関数と引数の写し
    author: claude-opus-5-5
---

# 何をどこに書くか

- **定義の正は `src/signs/defs/*.ts`**（群ごとに 1 ファイル、`lanes.ts` は車線の版を導く規則と、図示・専用優先の例示の一覧）。形は `src/signs/schema.ts`（zod）。
  - 板の表は `src/signs/plates.ts`（`signs.glb` のノード名 → 形・外接矩形 mm）。定義の `plate` はこのキーだけを取る。
  - 図柄は PNG のファイル名で参照する（`art: { by: "texture", file, paint, variants }`）。描かない番号は `art: { by: "none", reason }`。
  - `paint` はその PNG を描く Pillow の関数と引数（`{ fn: "regulatory.vehicle_closed", args: { name: "car_front", w: 290 } }`）。`fn` は `scripts/textures` の `module.function`（`sign_textures` か `signs/` の `warning`・`regulatory`・`instruction`・`auxiliary`・`nonstatutory`）、`args` はキーワード引数。
    - `over` は、同じ実行で先に描いた PNG の上に描く図柄（316 の上の「８―２０」）。生成器はその PNG をディスクから読み直して第 1 引数に渡す。
    - 車線の版（`327-7_*.png`）だけは `paint` を書かない（書くと拒む）。`lanes.lane_sign` がキーから描く。
  - 同じ標示板に補助標識を附置する番号（305の2・314の2 など 9 件、備考一(一)34）は `shares` で板と図柄を借り、`art` も `plate` も書かない（`plate` はレジストリで借り先から決まる。書くなら借り先と同じ板でなければ拒む）。
  - `game.kind` はゲームの標識種別（`src/world/regulations.ts` の `SIGN` のキー）。どの番号をどの種別で描くかの宣言で、実際の対応はまだ `src/world/signs.ts` の `BY_ID` と `design()` にある（G1c で移す）。
- **書き出し**: `just make-sign-registry`（`scripts/signs.ts`）が定義を検査し、次の 2 つを書く。
  - `assets/signs/registry.json`（version 2）: 検査済みの定義・板・車線の版・描画関数と、番号ごとの別表第二の図。図柄（Pillow）の入力。板（Blender）は G2 から読む。
  - `assets/signs/catalog.json`: 従来の形のまま。`src/world/signs.ts`・`tests/coverage.test.ts` が読む（アセット管理画面は読まない）。利用側がレジストリへ移ったら消す。
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
- `game.kind` が `SIGN` のキーだけを指し、`SIGN` のすべての種別に定義がある。
  - 実際にゲームが描く図柄とも突き合わせる。`design()`（`src/world/signs.ts`、テストのために export した）が種別ごとに選ぶ全ファイルが、その種別を名乗る定義の図柄になっていること。逆に、種別を名乗る定義のどれかの図柄を `design()` が選ぶこと。
- 壊れた定義は、番号と項目を添えてすべて並べて拒む。対象は、無い板、`art` も `shares` も無い、`shares` 以外で `plate` を省いた、法定外でない `x-`、根拠の無い法定外、描いていない番号への `shares`・車線の版、借り先と違う板、id の重複、別表第一に無い番号、同じ番号の中で変種の key の重複、車線の版の重複、方向の無い車線（`t--r`・`-t`・`~bus`）。
- `layoutJson` は、オブジェクトの undefined の値を飛ばし、配列の中の undefined・NaN・Infinity を拒む。Python と表記が分かれる float（1e16 以上、0 でない 1e-4 未満）も拒む。
- 番号表の読み取り（`tests/signLawTable.test.ts`）では、範囲（・と ～ U+FF5E）の展開、rowspan でまたがる種類、列の数の違い、ルビ、rowspan と colspan のずれた見出しと図の対応、件数の下限（200 行未満は表を読み損ねたとみなす）、図の上書きを検査する。

# 未描画・未配置の一覧（just show-sign-coverage）

2026-11-10 の結果は次のとおり。

- 定義は 244 件（別表第一 237 件と法定外 7 件）。
- 図柄があるのは 155 件。そのうちゲームが配置するのは 36 件で、図柄はあるが未配置なのは 119 件。
  - 内訳は、警戒 26、規制 43（324 最低速度・325 自動車専用・320〜322 の重量・高さ・幅制限など）、指示 14、補助 31、法定外 5。
- 未描画は 89 件で、すべて案内標識。
- 未配置の一覧は配置規則が増えるたびに減る数として見る。テストでは落とさない。

注意点が 2 つある。

- **補助標識**: ゲームは補助標識を PNG ではなく、板の下に吊る文字（`signs.ts` の `notes`）で描く。補助の 31 件が未配置に入るのはそのためである。G2 で描画済みの図柄に替える。
- **案内標識**: 方面及び方向の 108 系は、実行時に Canvas で描いている（knowledge/road-markings-and-signs.md「案内標識（方面及び方向 108 系）」）。それでも、ここでは catalog.json と同じく「描画対象外」と数える。G5 のレイアウタで定義へ入れる。

# 落とし穴・未解決

- **catalog.json の撤去（残課題）**: 利用側が残っている間は registry から同じバイトで書き続ける。読む側をレジストリ（G1c 以降は game.json）へ移したら、`src/signs/catalog.ts`・`scripts/signs.ts` の書き出し・台帳の sign-catalog・鮮度検査をまとめて消す。

- **125-B（路面電車停留場）の図**: e-Gov の別表第二の表では、行 59 の 3 番目の見出し「路面電車停留場（１２５―Ｂ）」の下の図が `S35F03102010003-087.jpg` である。どの番号も使っていない添付の連番に当たる。
  - 旧 law_table.py は null で、見出しと図の colspan のずれ（見出し 3・3・1、図 3・2・2）で取りこぼしたとみられる。
  - G1a ではバイト一致を守るため `FIGURE_OVERRIDES` で null を書かせていた。2026-11-10 に G1a の直後のコミットで上書きを外し、`just fetch-sign-law-table` と `just make-sign-registry` を流した。law-table.json・catalog.json・registry.json の 125-B の `figure` が 1 行ずつ -087.jpg に変わったことを `git diff --stat`（各 1 行）で確かめた。
- **別表第二の図の取り方**: 見出しの行（1 行とは限らない。305 と 305の2 は rowspan 2 の隣に 2 段の見出し）の下に図の行が来る。
  - 図は、その列の範囲で始まる見出しすべてに当てる。セルの順で対にすると、colspan の違いでずれる。
- **別表第一の列**: 列の数は表によって違う（規制・指示には「意味」の列がある）。種類が rowspan でまたがる行は番号から始まるので、先頭のセルに番号があるかで見分ける。
- **ルビ**: 勾＜こう＞配 の `Rt` は名前から除く（旧表と同じ）。
