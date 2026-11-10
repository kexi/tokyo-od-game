---
type: Reference
title: 道路標識の定義とレジストリ（src/signs）
description: 道路標識の定義を src/signs/defs/*.ts（zod）の 1 か所にまとめ、assets/signs/registry.json と従来の catalog.json を scripts/signs.ts で書き出す仕組み（段階 G1a）。catalog.json からの機械変換の手順、バイト一致による無損失の確認、標識令 別表第一の番号表（law-table.json）を e-Gov から読む方法、定義・図柄・ゲームの対応・番号表の突き合わせテスト、未描画・未配置の一覧（just show-sign-coverage）、e-Gov と旧表で 125-B の図が食い違った件を記録する。
tags: [assets, traffic-law, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-10T10:30:00Z }
verified:
  - { by: claude-opus-5-5, at: 2026-11-10T10:25:00Z }
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
---

# 何をどこに書くか

- **定義の正は `src/signs/defs/*.ts`**（群ごとに 1 ファイル、`lanes.ts` は車線の版の一覧）。形は `src/signs/schema.ts`（zod）。
  - 板の表は `src/signs/plates.ts`（`signs.glb` のノード名 → 形・外接矩形 mm）。定義の `plate` はこのキーだけを取る。
  - 図柄は PNG のファイル名で参照する（`art: { by: "texture", file, variants }`）。描かない番号は `art: { by: "none", reason }`。
  - 同じ標示板に補助標識を附置する番号（305の2・314の2 など 9 件、備考一(一)34）は `shares` で板と図柄を借り、`art` も `plate` も書かない（`plate` はレジストリで借り先から決まる。書くなら借り先と同じ板でなければ拒む）。
  - `game.kind` はゲームの標識種別（`src/world/regulations.ts` の `SIGN` のキー）。どの番号をどの種別で描くかの宣言で、実際の対応はまだ `src/world/signs.ts` の `BY_ID` と `design()` にある（G1c で移す）。
- **書き出し**: `just make-sign-registry`（`scripts/signs.ts`）が定義を検査し、次の 2 つを書く。
  - `assets/signs/registry.json`: 検査済みの定義・板・車線の版と、番号ごとの別表第二の図。G1b から図柄（Pillow）と板（Blender）の入力にする。今は誰も読まない（台帳では `status: unused`）。
  - `assets/signs/catalog.json`: 従来の形のまま。`src/world/signs.ts`・`tests/coverage.test.ts`・アセット管理画面が読む。利用側がレジストリへ移ったら消す。
- **番号表**: `assets/signs/law-table.json`。`just fetch-sign-law-table`（`scripts/sign-law-table.ts`）が e-Gov 法令 API v2 から版を固定して書く。表の読み取りは `src/signs/lawTable.ts` の純粋関数（`tests/signLawTable.test.ts` が小さな合成表で検査）。`scripts/textures/signs/law_table.py` もこの JSON を読むので、TypeScript と Python が同じ表で検査する。
  - law-table.json は生成器の出力そのものにする。手で直さない（直したい値は `FIGURE_OVERRIDES` に理由つきで書く）。

## 移行期の二重定義（G1b まで）

catalog.json を書くのは `scripts/signs.ts` だけである。`scripts/textures/sign_textures.py` は図柄を描いたあと、自分の表（`catalog.py`）から作った catalog.json を、コミット済みのものと比べるだけにした。食い違えば `SystemExit` で止まる（2026-11-10 のレビューで書き手を 1 つにした）。

- 書き手を 2 つにしなかった理由: `catalog.py` の変更が defs を通らずに catalog.json に入り、正が 2 つになるため。
- 図柄を足すときは `catalog.py`（描く関数）と `defs/`（定義）の両方に書き、`just make-sign-registry` のあとで `just make-sign-textures` を流す。
- G1b で Pillow が registry.json を読むようになれば `Meta`・`Tex`・`meta_for` は消え、二重定義もなくなる。

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
5. `shares` の 9 件は catalog.py の `shared` の表から取った。注記 `note` は catalog.json の文言をそのまま写した。
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

- **125-B（路面電車停留場）の図**: e-Gov の別表第二の表では、行 59 の 3 番目の見出し「路面電車停留場（１２５―Ｂ）」の下の図が `S35F03102010003-087.jpg` である。どの番号も使っていない添付の連番に当たる。
  - 旧 law_table.py は null で、見出しと図の colspan のずれ（見出し 3・3・1、図 3・2・2）で取りこぼしたとみられる。
  - G1a ではバイト一致を守るため、`scripts/sign-law-table.ts` の `FIGURE_OVERRIDES` に `{ "125-B": null }` を置き、旧表どおり null を書かせている（law-table.json は生成器の出力のまま）。
  - 撤去条件: G1a の直後の別コミットでこの 1 件を消し、`just fetch-sign-law-table` と `just make-sign-registry` を流す。law-table.json と catalog.json の 125-B の `figure` が 1 行ずつ -087.jpg に変わる。
- **別表第二の図の取り方**: 見出しの行（1 行とは限らない。305 と 305の2 は rowspan 2 の隣に 2 段の見出し）の下に図の行が来る。
  - 図は、その列の範囲で始まる見出しすべてに当てる。セルの順で対にすると、colspan の違いでずれる。
- **別表第一の列**: 列の数は表によって違う（規制・指示には「意味」の列がある）。種類が rowspan でまたがる行は番号から始まるので、先頭のセルに番号があるかで見分ける。
- **ルビ**: 勾＜こう＞配 の `Rt` は名前から除く（旧表と同じ）。
