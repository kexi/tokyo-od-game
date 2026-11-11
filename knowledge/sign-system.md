---
type: Reference
title: 道路標識の定義とレジストリ（src/signs）
description: 道路標識の定義を src/signs/defs/*.ts（zod）の 1 か所にまとめ、assets/signs/registry.json と従来の catalog.json を scripts/signs.ts で書き出す仕組み（段階 G1a）。Pillow の図柄生成が registry.json の paint（描く関数と引数）と規則で導いた車線の版 141 件を読んで 345 枚をバイト一致で作り直すこと（G1b、Pillow 12.3.0 固定）。ゲームの標識種別の対応（旧 BY_ID・design() の switch）を定義の game へ移し、assets/signs/game.json で渡す仕組みと、配置が変わらないことを 3 地点のスナップショットで確かめた方法（G1c）。catalog.json からの機械変換の手順、バイト一致による無損失の確認、標識令 別表第一の番号表（law-table.json）を e-Gov から読む方法、定義・図柄・ゲームの対応・番号表の突き合わせテスト、未描画・未配置の一覧（just show-sign-coverage）、e-Gov と旧表で 125-B の図が食い違った件を記録する。 G2 で、板を src/signs/plates.ts の形ごとの寸法から作り（signs.glb はバイト一致）、表示の倍率を番号ごとの displayScale（警戒 1.3 倍、命令の範囲をテスト）にし、補助標識を Canvas の文字から 502 の図柄（public/data/regs の規制時間から導いた 388 枚、曜日群ごとに 1 枚）に替えた。 G4 で、取付 7 種（単柱・複柱・片持 F・門型・壁高欄添架・桁添架・信号柱共架）を src/signs/mount.ts に zod で宣言し、純関数 resolveMount が板の位置・高さと単位部材を決めるようにした（下端は交通規制基準 第2章 3 の歩道上 2.5 m・最低 1.8 m、片持・門型 5.0 m・最低 4.7 m。本板 3 枚の柱は 2 本に振り分け、信号柱の 6 m 以内の標識は共架）。 G3 で、面の材質を SignFaceMaterial 1 つにし（図柄は配列テクスチャの層をインスタンス属性で選ぶ、描画呼び出しは板の形の数、three r186 の WebGPU で層だけの更新と層ごとの mip を PoC で確認、面のテクスチャ 89 MB）、自車の前照灯の再帰反射（表2-2-29 の R_A、配光 × 距離 × 入射角 × 観測角 × 色 × 濡れ）を放射に足した。
tags: [assets, traffic-law, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-opus-5-5, at: 2026-11-10T10:30:00Z }
updated: { by: claude-opus-5-5, at: 2026-11-11T05:30:00Z }
verified:
  - { by: claude-opus-5-5, at: 2026-11-11T03:20:00Z }
  - { by: claude-opus-5-5, at: 2026-11-11T01:20:00Z }
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
  - id: kisei-kijun-height
    resource: https://www.npa.go.jp/bureau/traffic/seibi2/kisei/mokuteki/kiseikijun/260316kiseikijun.pdf
    title: >-
      警察庁 交通規制基準（令和8年3月16日）第2章 3「高さ」の表（路側方式: 歩道上 2.5 m・状況により 1.8 m、
      歩行者等横断禁止 1.2 m、その他 1.8 m（1.5〜2.5 m）、オーバーヘッド・オーバーハング 5 m・4.5 m まで、
      信号機等を利用する方式は準用・6 m まで）と 9「取付け方」（同一面に本板 2 段まで・4 枚以内、補助板は各本板の下、
      上下の本板の間 10〜15 cm、横断歩道は最下端または右側）。2026-11-11 に pdftotext で本文を読んで確認
    author: 警察庁
  - id: setti-2019-height
    resource: https://www.mlit.go.jp/road/sign/sign/douro/setiingbase.pdf
    title: >-
      道路標識設置基準（令和元年10月）3-1-2（路側式 1.80 m 標準・路上施設帯の無い狭い歩道で 2.5 m 以上、
      歩車道境界から 25 cm 以上、片持式・門型式 5.0 m 標準・4.7 m 以上、添架式は準ずる、信号機への添架は公安委員会と協議）
      と 3-1-5 標示板の併設。2026-11-11 に pdftotext で本文を読んで確認
    author: 国土交通省 都市局・道路局
  - id: kozorei-12
    resource: e-Gov 法令 API 道路構造令（昭和45年政令第320号）第12条（scratchpad の egov/345CO0000000320.txt）
    title: 建築限界 H（普通道路 4.5 m、重要物流道路 4.8 m）。歩道の第二図の値は図にだけあり本文では未確認
  - id: g4-snapshot
    resource: >-
      tests/signPlacement.test.ts の柱の表（3 地点 3,789 本）を G2 の配置（stackPlates、plates.ts の箱の高さ）で
      先に書き、resolveMount に替えてから -u で書き直し、scratchpad の g4/snapdiff.py で比較（2026-11-11）。
      足元・向き・面の図柄はすべて同じ、変わったのは高さと支柱だけ。最下端 1.8 m 未満 201 本 → 0 本、2 本柱 42 本
    title: 柱のスナップショットの意図した差分（G4）
    author: claude-opus-5-5
  - id: g4-glb-nodes
    resource: >-
      just make-sign-model・make-guide-sign-model の前後の glb を scratchpad の glb_compare.py（ノードごとの符号化済み
      プリミティブの SHA-256）で比べ、既存ノードはすべて SAME、増えたのは単位部材のノードだけ（2026-11-11）
    title: 既存ノードの互換（G4）
    author: claude-opus-5-5
  - id: g4-review
    resource: >-
      Blender の単体レンダ（scratchpad の g4/review.py。resolveMount の出力を JSON にして組み立てる）で、単位部材と
      組み立て例 7 種（3 枚→2 本柱、補助標識＋通学路、信号柱共架、門型、壁高欄、桁、片持）を正面・30°・60°・背面・
      運転席 30 m で撮影。ゲーム内はヘッドレス Chrome（vite 5397 番、面のインスタンス数が 2 秒変わらなくなるまで待つ）で
      丸の内 35.68075,139.76345・大手町 35.6858,139.7645・神田 35.6913,139.7670 の単柱・2 本柱・共架を同じ 4 視点で撮影
      （g4/shoot.mjs）。4 周、3・4 周目は新規指摘 0。ログの warn/error は tide_table_failed（通信）1 件だけ
    title: 多視点レビューの収束ループ（G4）
    author: claude-opus-5-5
  - id: g3-sheeting-ra
    resource: https://www.mlit.go.jp/tec/r08dobokukoujikyoutsuusiyousyo/honbun02_syo02_setsu12.html
    title: 国土交通省 土木工事共通仕様書（令和8年度）2-2-12-1 表2-2-28・2-2-29 反射シートの反射性能（試験は JIS Z 9117、2026-11-11 取得）
  - id: g3-poc
    resource: >-
      一時ページ（DataArrayTexture 256²×112・512²×33、InstancedMesh 4 枚に faceLayer）をヘッドレス Chrome の WebGPU で描き、
      addLayerUpdate(2) の前後で 4 枚の色を読んで層 2 だけ変わることを確認。更新 10 回の中央値で GPU 完了まで three の経路
      57.4 / 20.5 ms、copyExternalImageToTexture + LayerMipmapper 1.6 / 1.1 ms（scratchpad の g3/poc.mjs）
    title: 配列テクスチャの層更新の PoC（G3）
    author: claude-opus-5-5
  - id: g3-measure
    resource: >-
      scratchpad の g3/measure.mjs（丸の内 35.67363,139.764、seed 20261110、昼・夜、settled の後 8 s、30 フレームの描画呼び出しの
      増分、10 s の rAF 間隔、面のメッシュと面のテクスチャの数え上げ）を G3 前（e678b3b）と後で 1 回ずつ。負荷平均 6〜10
    title: 描画呼び出し・面のテクスチャ・フレーム時間の前後（G3）
    author: claude-opus-5-5
  - id: g3-review
    resource: >-
      just shoot-views signs（33 コマ、vite 5347 番）を 4 周、.qa/reviews/signs/round-01〜04.jsonl、just check-convergence signs が
      round 4 で converged。レビュー対応の後、後方追従の夜のコマを足した 36 コマで 4・5 周目（4 周目は撮り直し）が converged。昼の色差は scratchpad の g3/compare.py（CIE76、中央 120 px）で G3 前の同じ表（g3base）と比較
    title: 多視点レビューの収束ループ（G3）
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
- （G4 で置き換え。「支柱と取付（G4）」を見よ）柱の板の高さは純粋関数 `src/signs/stack.ts` の `stackPlates`（G4 の resolveMount の種）が決める。間隔 `STACK` は 1.0 m のまま。下の板は、上の板とその補助標識の下端から 6 cm 空けた位置より下へ押し下げる（大きな板どうしが重ならない）。下端が地面より下になる面は、その下の面ごと立てず、`sign_faces_below_ground`（警告）で数を出す。`tests/signStack.test.ts` が「重ならない・補助標識は自分の板の直下・下端 ≥ 0・補助標識の無い柱は従来の高さ」を、1〜3 枚の板と 0〜3 行の補助標識の組み合わせで検査する。

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

## 支柱と取付（G4）

### 取付の型と resolveMount

- `src/signs/mount.ts` が取付 7 種を zod で宣言する（`MOUNTS`・`MountPlacementSchema`）。純関数 `resolveMount(placement)` が、取付の座標系（足元が原点、+x は車道の方、+z は向かってくる車の方）で、面（板・補助標識）の位置と高さ、単位部材（役割・位置・伸ばす倍率）、足（当たり判定と建物の検査）を返す。収まらない面は `dropped` で数える。

| 種別                          | 使う所（G4）                                   | 規則                                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single-post` / `double-post` | 規制・警戒・指示の柱、路側式の案内（2 本）     | 列に分ける。1 列は本板 2 段・4 枚まで（交通規制基準 第2章 9 (2) ア）。2 列目は 1 列目の左（車道から遠い側）に 10 cm 空けて立てる。幅 1.2 m を超える板は単独の列で、板の下に 2 本の柱（板幅の ±28 %）。横断歩道（407）を含む列は車道側へ |
| `signal-share`                | 信号柱から 6 m 以内・同じ向きの柱              | 1 列だけ。腕の 30 cm 下・6 m 以下。歩行者用灯器が 1.5 m 以内にあれば、その筐体の上 10 cm より上。入らなければ自分の柱に戻す                                                                                                             |
| `cantilever-f`                | 案内標識の片持式（従来の配置をそのまま移した） | 下端 5.0 m、柱の面から 0.55 m、腕 2 本、3° 前傾                                                                                                                                                                                         |
| `gantry`                      | API・テスト・部材のみ（G6）                    | 脚は内法の外へ 0.5 m、梁は 1 m の節を並べる（伸ばさない）、梁は最も高い板の中央の高さ、脚を越える板は掛けない                                                                                                                           |
| `barrier-mount`               | 同上                                           | 壁高欄の天端に金具と 60.5 mm の柱。面は壁高欄の内面（x = 0）より外。下端は路側 1.8 m・壁高欄の上 10 cm 以上                                                                                                                             |
| `girder-mount`                | 同上                                           | 桁の前面に吊り金具 2 本。桁の高さに収まれば中央、無理なら上端を合わせ、下端 4.7 m 未満なら掛けない                                                                                                                                      |

- **高さの根拠**（下端 = 路面から最も低い面の下端）

| 場所                                                  | 標準              | 最低                                         | 一次情報                                         |
| ----------------------------------------------------- | ----------------- | -------------------------------------------- | ------------------------------------------------ |
| 歩道上（ゲームの柱はすべて車道端から 0.7 m の歩道上） | 2.5 m             | 1.8 m                                        | 交通規制基準 第2章 3 の表、設置基準 3-1-2 (2) 1) |
| 路側（路肩・植樹帯・壁高欄）                          | 1.8 m             | 1.5 m                                        | 交通規制基準 第2章 3 の表                        |
| 片持・門型                                            | 5.0 m             | 4.7 m（交通規制基準は 4.5 m まで。厳しい方） | 設置基準 3-1-2 (2) 2)                            |
| 建築限界                                              | 4.5 m（普通道路） | —                                            | 道路構造令 第12条                                |

- 単柱の上端は 4.0 m まで（`POST_MAX_TOP`、仮定）。列の上端をそろえ、「標準の下端＋最も高い列」と 4.0 m の低い方から吊る。60 cm の板 1 枚は下端 2.5 m（G2 は 2.225 m）、2 枚は上端 4.0 m から（下の板の下端 2.38 m）。
- 上下の本板の間は 12 cm（`PLATE_GAP`。交通規制基準 9 (2) ウ (ウ) の 10〜15 cm。こうすると下の本板だけに補助板があっても上の本板に同じ補助板を付けなくてよい）。補助標識はその本板の 6 cm 下。
- 面は車道端から 25 cm 以上離す（設置基準 3-1-2 (2) 1) II)）。足元が車道端から 0.7 m なので、1 列目の面は 0.45 m までしか車道側へ出ない。広い板はその分だけ歩道側へずらす。
- **仮定（verified: false）**: 部材の径（60.5・φ267.4・φ139.8・φ89.1・φ318.5 mm、梁 0.8 m 角）、単柱 4.0 m・2 本柱の板 5.5 m の上端、幅 1.2 m で 2 本柱、列の間 10 cm、共架の距離 6 m、腕の下 30 cm。
- 部材の径は `MEMBER_SIZES` に持ち、`tests/signMount.test.ts` が signs.py・guide_signs.py の定数と trafficControl.ts の `POLE_RADIUS` に照合する。

### 部材（Blender）

- signs.glb に単位部材を足した: `SignPostUnit`（1 m の管）、`SignPostCap`、`SignRail`（1 m のレール、板の幅の 8 割・最大 40 cm に伸ばす）、`SignBand`、`SignalBand`（φ260 の信号柱を巻くバンド）、`BarrierBracket`、`GirderHanger`（1 m、板の高さに伸ばす）。guide_signs.glb に `GantryLeg`・`GantryFoot`・`GantryTruss`（1 m の節。斜材が傾かないよう伸ばさずに並べる）。
- 既存のノード（板・`Post`・`Bracket`・`Guide*`）は符号化済みの頂点までバイト一致（sources の g4-glb-nodes）。ゲームは `Post`・`Bracket` を使わなくなったが互換のため残す。レールを板の幅に合わせたので、30 cm の通学路の板の左右に 40 cm のレールがはみ出す件（G2 の残課題）は解消した。

### ゲームへの適用

- `src/world/signs.ts` の `gatherPosts`（純粋、テスト用）が従来どおり 2 m 以内・同じ向きの板を 1 本（3 枚まで）にまとめ、`mountPost` が resolveMount で取付を決める。板の寸法は glb の境界箱ではなく plates.ts の箱（`plateBoxMm` × 倍率）にした（テストが glb なしで同じ値を出せる）。
- 信号柱は `TrafficControl.signalPoles`（車両用の柱の足元・向き・腕の高さ・車道端からの距離 1.2 m・歩行者用灯器の上端）。`sharedPoles` が最も近い柱を 1 本につき 1 本の柱に割り当てる。
- 案内標識（`src/world/guideSigns.ts`）の片持式と路側式も resolveMount を通す（片持式は従来と同じ値になることをテストで確認）。
- ログ: `sign_mounts_resolved`（柱の数・2 本柱・共架・面）と `sign_faces_unmounted`（警告、旧 `sign_faces_below_ground`）。丸の内の 1 回の再構築で 1,099 本（2 本柱 95・共架 31）、神田 2,080 本（175・64）、大手町 1,423 本（138・50）。収まらない面は 0。

### G4 のスナップショット

`tests/signPlacement.test.ts` に柱の表（足元・向き・取付の種別・足の位置・面ごとの図柄・横位置・下端）を足した。先に G2 の配置で書いてから resolveMount に替え、差分を確かめた（sources の g4-snapshot）。

- 3 地点 3,789 本。足元・向き・面の図柄はすべて同じ（標識の追加・削除・移動 0）。
- 最下端が 1.8 m 未満の柱 201 本 → 0 本。1 枚の柱は下端 2.23 → 2.50 m。
- 2 本柱 42 本: 本板 3 枚 15 本（うち 1 本は補助標識付き）、幅 1.2 m を超える 327の7 の板 27 本。
- 面 2 枚の柱 183 本・3 枚の柱 3 本は 1 本のまま。60 cm の本板 2 枚なら上の板の下端 3.25 m・下の板 2.38 m。
- 既存の表（placeSigns と design()）の行は 1 行も変わっていない。

### 多視点レビュー（G4、収束ループ）

- 1 周目の指摘: (1) 門型の梁が板の上端にあり、2.2 m の板が梁から 1.4 m 下に支えなく垂れる → 梁を最も高い板の中央へ。(2) 神田の交差点で、車両用の柱の隣の歩行者用灯器（2.75 m）が共架した下の板を隠す → 歩行者用灯器が 1.5 m 以内にある柱では、板をその筐体の上 10 cm より上に掛ける（`minBottomM`）。
- 2 周目の指摘: 門型の端の節で弦材の管の口が脚の外に見える → 弦材に蓋。
- 3・4 周目（ゲーム内は 2・3 番目に近い柱に替えて撮影）は新規 0 件で収束。
- 指摘にしなかったもの（Info）: 横断歩道の板だけの列は上端をそろえるので下端 3.1 m と高い。2 本柱の 2 列目は歩道の奥へ 0.85〜1.65 m 入る（建物に掛かれば柱ごと隠す）。

### レビュー（Fable）への対応（2026-11-11）

- **法令値と仮定を分けた**: 規格の値は `src/signs/mountStandards.ts`（`Statute<T>`、出典つき。建築限界は `src/law/roadStandards.ts` の `CLEARANCE_HEIGHT` を読み、重要物流道路の 4.8 m は `LOGISTICS_CLEARANCE_HEIGHT`）、ゲームの選んだ値は `src/signs/mountAssumptions.ts`（`Assumption<T>`、`verified: false` と理由。src/expressway/assumptions.ts と同じ形）。mount.ts に数値の直書きは無い。
  - 高さは誰が立てる標識かで切り替える（`authority`）。規制・指示は交通規制基準（歩道上 2.5 m・最低 1.8 m）、案内は設置基準（歩道上で路上施設帯が無い狭い所 2.5 m、路側 1.8 m）。
  - 片持・門型・桁添架の下端の最低は「4.7 m と建築限界の高い方」。建築限界は placement の `clearanceM`（既定 4.5 m）。
  - テストは自己参照をやめた: 規格の値はテストの中に出典の本文から書き直して照合し、仮定はすべて `verified: false` と理由を持つことを確かめる。
- **車道からの距離を 1 か所に**: `SIGN_KERB`（0.7 m、placeSigns・一時停止・横断歩道・消火栓など）、`SIGNAL_POLE_KERB`（1.2 m、信号柱）、`GUIDE_POLE_KERB`（0.9 m、案内標識）を mountAssumptions.ts に置き、regulations.ts・streetFurniture.ts・trafficControl.ts・guidePlan.ts・guideSigns.ts が読む。
- **定義側の属性**: 定義の `game` に `kerbSide`（2 列に分けたとき車道側の列へ。407-A）と `fixedPlace`（信号柱へ移さない。330-A 一時停止・407-A 横断歩道）を足した。game.json と `Design` に載る。`d.id.startsWith("407")` は消した。
- **部材の対応表**: `MEMBER_NODES` を全ロールの `{ glb, node }` にし、テストが両 glb にノードがあることを確かめる。TrafficSigns は signs.glb のロールだけ、GuideSigns は guide_signs.glb のロールだけを描き、対応の無いロールは `sign_member_unloaded`（警告、ロールごとに 1 回）。GuideSigns は部材の寸法を glb の extras ではなく `MEMBER_SIZES` から取る（上書きをやめた）。
- **2 本柱の隠し方（W1）**: 面・部材・足に `column` を持たせ、建物の中に入った足の列だけを隠す（一時停止を含む 1 列目は残る）。2 列目の足が車道（`carriagewaysAt`）に掛かる柱は、その列を最初から立てない（`withoutColumn`、`sign_faces_unmounted` に数える）。隠した列は `sign_columns_hidden`（単柱・2 本柱の 1 列目・2 列目・両方）で数える。
  - 実測（ヘッドレス Chrome、停車したまま 45 秒、車の 200 m 以内が検査の対象。scratchpad の g4/hidden.mjs）: 丸の内 35.68075,139.76345 は 1,099 本（2 本柱 95・共架 31）で隠したもの 0、渋谷 35.6595,139.7005 は 1,569 本（63・40）で単柱 8・2 本柱 0、芝公園 35.6570,139.7480 は 1,523 本（95・41）で単柱 2・2 本柱 0。
- **共架（W2）**: 共架した柱は足が無いので建物の判定から外した（信号柱は残るのに板だけ消えていた）。割り当ては、柱と信号柱の組を距離の近い順に決める（先に集めた遠い柱が勝っていた）。
- **列の分け方（I1）**: 板は入る最初の列へ（`[板, 幅広, 板]` の 3 枚目は 1 列目の下へ）。どの列にも高さが足りなければ、本板 2 段・4 枚の範囲で最も低い列に入れ、上端を上げる（板を落とさない）。共架だけは腕の下が上限なので、入らなければ自分の柱に戻す。
- **案内の路側式（I2・I5）**: 案内の板は上端の上限を持たず、下端は常に 2.5 m（従来は板が 3 m を超えると 2.5 m を切り、3.7 m を超えると面が空になって TypeError になり得た）。柱の位置・高さ・板の位置は G4 の前と同じ値（板の端は車道端から 25 cm、柱の上端は板の上端）。
- **門型（I4）**: 脚の基点 `legBaseM`（高架の床・壁高欄の上に立てる）を足した。どの板も梁の中央に合わせる（低い板が梁から外れていた）。
- **レビューの口**: `TrafficSigns.debugPlates()`（公開の読み取り口、`PostDebug`）を足し、src/debug/privateViews.ts は private の `posts` を読むのをやめた。`window.__game.signs` は外した（main は createViewHooks に signs を渡している）。`scripts/blender/sign_review.py` は消えた `PLATE_OFFSET` ではなく、`scripts/qa/signMounts.ts` が resolveMount で解いた `.qa/signs/mounts.json` の部材で組む（`just render-sign-review`、369 面・1,107 枚を確認）。`just shoot-views signs` は 3 コマ・失敗 0。
- **部材を既存の glb に足した理由（I7）**: 設計 4 章は `sign_supports.glb` を新しく作る案だった。規制標識の柱の部材は signs.glb、門型の部材は guide_signs.glb に足した。標識と案内標識はそれぞれ 1 つの glb を読み込んでいて、部材のためにもう 1 つ読み込む往復とノードの対応表を増やさないため。既存のノードはバイト一致のまま。

## SignFaceMaterial（G3）

### 方式: 配列テクスチャの層（PoC で決めた）

- 標識の面の材質は `SignFaceMaterial`（`src/world/signFaceMaterial.ts`、TSL の MeshStandardNodeMaterial）の 1 種類。図柄は配列テクスチャ（`DataArrayTexture`）の層で、インスタンス属性 `faceLayer` で選ぶ。InstancedMesh は**板の形ごとに 1 つ**（丸の内で 53 図柄・13 メッシュ。以前は図柄ごとに 1 つ）。
- 層の管理は `FaceLayerPool`（`src/world/signFaces.ts`）。層 0 は代役（規制標識は透明で面を捨てる、案内標識は遠景の青 #1d4f9c）。割り当ての規則は three にも fetch にも触れない `FaceLayerSlots`（`src/world/faceLayerSlots.ts`、`tests/faceLayerSlots.test.ts`）にある。
  - デコードするのは優先度（距離）の上位「容量」件だけで、デコード中・配置待ち・失敗のバックオフ中（2 s から倍々、最大 60 s）のものは始めない。足りないときは `sign_face_layers_short`（警告、欲しい数と容量、同じ数では 1 回）で、遠い面は層 0 のまま、デコードもしない。
  - 配置は空き → いちばん長く欲しがられていない層 → 優先度の低い層の順。追い出された面はその時点から層 0。
  - **訂正（レビュー C1）**: 最初の版は欠けた面をすべて毎フレームデコードし、配置で捨てていた。容量 2・要求 3 で 100 フレームにデコード 102 回・アップロード 2 回、読み込みに失敗した面は毎フレーム再試行して `sign_face_load_failed` が流れ続けた。いまは丸の内で plates 37・boards 16・guide 8 のデコード数とアップロード数が一致する（`__game.debug.signFaces().pools`）。
  - デコードは `createImageBitmap`（リサイズ込み、メインスレッドの外）、アップロードは 1 フレーム 2 層まで。図柄は PNG を 1 枚ずつ fetch する（設計の「4096 px のシートに詰めて升を写す」はしていない。Vite が 1 枚ずつハッシュ付きで配る）。
- 大きさ: 規制・警戒・指示・補助標識 256²×104 層（36.4 MB、mip 込み）、90 cm の板（327 系、PNG が 1024 px のもの、`LARGE_PLATE_MM = 900`）512²×17 層（23.8 MB）、案内標識 512×320×33 層（28.8 MB）。合計 **89.0 MB**（設計 6 章の目標 96 MB 以下）。設計の 256²×128 と 512²×32 から変えた理由: 丸の内の 1 回の再構築で大きい板が 16 種類あり 8 層では足りなかった（`sign_face_layers_short` が出た）。案内標識の板は横長なので 512×320 にして減らした。
- **PoC（three 0.186.1、WebGPU、ヘッドレス Chrome・M2 Max）**: `DataArrayTexture.addLayerUpdate(2)` で層 2 だけを書き換えると、その層だけが変わり他の層は元のまま（WebGPUTextureUtils.updateTexture が layerUpdates の層だけ writeTexture する）。ただし three は更新のたびに**全層の mip を作り直す**（WebGPUTexturePassUtils.generateMipmaps は mip 段 × 層数のパス）。256²×112 層で 1 回 GPU 完了まで 54〜57 ms、512²×33 層で 20 ms。そこで WebGPU では three を通さず、`copyExternalImageToTexture` でその層の mip 0 に写し、その層だけの mip を自前のパス（`src/render/layerMips.ts` `LayerMipmapper`、sRGB のビューで線形の平均）で作る。1 層 CPU 0.1 ms・GPU 完了まで 1.1〜1.6 ms（何もしないフレームは 0.6〜1.1 ms）。初回の全体アップロードの後は CPU 側の配列（29〜34 MB）を手放す。WebGL 2 のバックエンドでは three の addLayerUpdate を使う（全層の glGenerateMipmap）。
- three の内部に触る所は `src/render/layerUpload.ts` の 1 か所（`backend.isWebGPUBackend`・`backend.device`・`backend.get(texture).texture`、usage に COPY_DST・TEXTURE_BINDING・RENDER_ATTACHMENT があること、層の数と mip 段、image.data を空にしてよい条件）。どれかが合わなければ `three-fallback`（three の遅い経路、正しくは描ける）にして `sign_face_upload_fallback` を警告し、`sign_face_pool_ready` の backend にもそう書く（"webgl2" と誤って出さない）。**WebGL 2 のバックエンドは実機で確かめていない。**
- `faceLayer` は面のメッシュを作る（`RoadInstances.take` の `prepare`）ときに `attachFaceLayers`（signFaceMaterial.ts）が付ける。描かれる前に付いていないと、パイプラインが属性を 0 の定数で固める（レビュー 2 周目、three は「attribute not found」を 1 回警告するだけ）。
- アトラスにしなかった理由: PoC が通ったため（設計 9 章の切り替え条件に当たらない）。アトラスは升の境界で mip がにじみ、余白と UV の作り直しが要る。
- 案内標識（`src/world/guideSigns.ts`）も同じ材質に寄せた: 近い 24 枚の板ごとの Mesh と MeshStandardMaterial をやめ、全部の板を 1 つの InstancedMesh にして、近い板は描いた面の層、それ以外は層 0（遠景の青）にする。予算（近い 24 枚・保持 32 面・1 回 3 枚まで描く）は同じ。面の影はやめた（裏板の影が同じ形で落ちる）。

### 再帰反射

`src/signs/retroreflection.ts` の `retroWhite()` が式で、シェーダーは同じ式を TSL で写す（`tests/signRetro.test.ts`）。自車の前照灯 2 灯それぞれについて、白のシートの輝度 L = R_A(α, β) · I(h, v) / max(d, 3 m)² を足す。

- R_A は国土交通省 土木工事共通仕様書（令和8年度）表2-2-29 カプセルレンズ型反射シートの反射性能（試験は JIS Z 9117）を一次情報として使った（JIS Z 9117 の本体の表は有料で読めていない）。白 250（観測角 0.2°・入射角 5°）を 1 とし、観測角は exp(−2.2 (α − 0.2°))（0.33° で 0.72、2° で 0.02 に合う）、入射角は (cos β / cos 5°)^3.3（30° 0.60・40° 0.44 に合う）。表の 9 行すべてに 1.35 倍以内（テスト）。2° を超える観測角・40° を超える入射角は表に無く、同じ形で延ばした仮定。
- 色係数: 図柄の線形の明度がそのまま表の色/白の比に合う（赤 0.160 対 0.18、青 0.081 対 0.08、黄 0.688 対 0.68、緑 0.196 対 0.18、案内の青 0.083 対 0.08。12 % 以内、テスト）ので、放射に図柄の色を掛けるだけにした。
- 配光 I（仮定、`LAMP`）: すれ違い用は対向側で水平の 0.6° 下にカットオフ、左へ 15° で水平の 1° 上まで上がる（左側通行の上向き）、下 15,000 cd・上 400 cd。走行用は中心 30,000 cd。保安基準 第32条は確認距離（40 m・100 m）しか定めないので、形は ECE R112 を借りた目安。
- 放射 = 図柄の色 × (下駄 + 0.3 · L/(L + 5) × 点灯 × 暗さ × 濡れ)。上限 0.3（`RETRO_MAX`）は、夜の下駄 0.05 と露出 0.8 を合わせて露出後 0.28 で、ブルームの膝（0.55 × 0.65 = 0.36）より下に置いた値。濡れは env.wetness で 1 → 0.6（設計の仮定）。暗さは env.nightFactor（P9 のトンネルはここに暗さを渡せばよい）。
- 下駄（以前の一律の emissive 0.18）は昼は 0.18 のまま（昼の見えを変えない）、夜は 0.28 倍（0.05）に下げた。前照灯の外の標識は暗くなる。
- **観測点（決定 2026-11-11）**: ゲームの主カメラは、運転席視点でも後方追従でも**運転者の目**（cockpit.glb の DriverEye、無ければ `DRIVER_EYE` の仮定）から測る。通行人の写真・ミラーなど別のカメラ、歩いているとき、レビューで置いた後方追従以外のカメラは、そのカメラの位置から測る（光らない）。仕組み: uniform `observer` を描画ごと（`onRenderUpdate`）にそのカメラから決める（`setSignObserver`）。
  - Why not 描画カメラ（物理的にはこちら）: 後方追従のカメラは 6 m 後ろ・2.6 m 上で、板は前照灯の軸から 3〜5° 外れ、ロービーム 30 m で 0.001 になる（レビューの計算）。夜の標識が G3 前より暗く遊びにくい。追従カメラは運転者の目の代わり。
  - 後方追従の夜のコマ（chase-lamps-low-30）で放射 0.214、前照灯の外の標識（一方通行）も下駄 0.05 で読めることを確かめた。
- **前照灯の鏡面を外した**: 前照灯の SpotLight が目のすぐ下にあると、粗さ 0.45 の GGX の山が目に向き、板が白く飛んだ（レビュー 2 周目）。面の照明モデル `SignFaceLightingModel` は**自車の前照灯だけ**（`markPlayerHeadlamps` が建物より前に印を付ける）を拡散だけで受ける（戻りは放射が描く）。ほかの SpotLight（パトカーの探照灯）と太陽の鏡面はそのまま。
- 値（いずれも式の値、乾いた路面）:
  - テストの場面（板は車の左 3.5 m・高さ 2.9 m、目は車の中）: ロービーム 30 m で白 7.75 cd/m²・放射 0.182。
  - 視点表の場面（丸の内の 325の4、目は車の前照灯の 2 m 後ろ）: ロービーム 30 m で 4.22・0.137、60 m で 11.9・0.211、ハイビーム 30 m で 82・0.283、斜め 60° で 0.024、前照灯の外（45° 振る）0.003、目が前照灯から 12 m・45° 離れると 0.003、後方追従（運転者の目）30 m で 12.4・0.214。
- 仮定は `src/signs/retroAssumptions.ts`（`Assumption`、`verified: false` と理由。暗さ `DARK_ADAPT`、下駄 `BASE_GLOW`・`NIGHT_BASE`、運転者の目 `DRIVER_EYE` も）、表は `src/signs/retroStandards.ts`（`Specification`: 法令ではなく仕様書なので `Statute` と呼ばない）。`RA_PEAK` は表の 0.2°・5° の行から導く。上限 0.3 がブルームの膝より下であることは、skyLight の夜の露出と bloom の閾値・膝から計算するテストで守る。
- **表2-2-29 の数値は WebFetch の要約で読んだもので、PDF・JIS Z 9117 本体と 1 行ずつ照合していない**（同じ表の 2.0° の行が封入レンズ型と同じ値なのも未確認）。
- 設計との違い: `retro: "internal"`（内照式の一定発光）は未実装（ゲームに内照式の標識が無い）。下駄は設計の「街灯の明るさに連動」ではなく nightFactor 連動（街灯の光は路面の uniform だけで、板に届いていないため）。

### 計測（2026-11-11、丸の内 35.67363,139.764、1280×720、ヘッドレス Chrome、負荷平均 6〜10）

計測の手順（スクリプトはリポジトリに入れていない。同じことをするには）: 開発サーバーを空いたポートで立て、`?seed=20261110&start=35.67363,139.764&time=day|night&weather=clear` を browser.mjs で開き、`__game.start()`、`__game.debug.settled()` が 2 回続けて真になってから 8 s 待つ。シーンを辿って面のメッシュ（G3 後は `material.isSignFace`、G3 前は `userData.key` と案内標識の CanvasTexture の Mesh・遠景の青の InstancedMesh）を数え、テクスチャの幅 × 高さ × 4 × 4/3 を足す（G3 後は `__game.debug.signFaces().pools[].bytes`）。描画呼び出しは 30 フレームの `renderer.info.render.drawCalls` の増分の中央値、フレーム時間は 10 s の rAF 間隔。

| 項目                                       | G3 前                                           | G3 後                                           |
| ------------------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| 面のメッシュ（描画呼び出し、1 パスあたり） | 62（規制 53・案内の近い板 8・遠景 1）           | 14（規制 13・案内 1）                           |
| 面のテクスチャ（mip 込み）                 | 124.2 MB（読み込んだ図柄 53 と案内の面）        | 89.0 MB（固定）                                 |
| フレーム全体の描画呼び出し（中央値）       | 昼 1,689・夜 1,522                              | 昼 1,609・夜 1,456                              |
| フレーム時間 中央値 / p95 / 最大           | 昼 28.8 / 33.2 / 41.8、夜 28.3 / 35.3 / 46.9 ms | 昼 26.2 / 29.6 / 41.9、夜 24.5 / 28.4 / 35.3 ms |

- フレーム時間は混んだマシン（他のエージェントの作業）で 1 回ずつ測った値で、差は繰り返しのばらつきと同じくらい。悪くはなっていない、までしか言えない。renderer.info の texturesSize（全体）は建物の読み込みの進み方で 100 MB 動き、比べられなかった。
- 層 1 枚の更新は上の PoC の値（CPU 0.1 ms）。1 フレーム 2 層まで。

### 昼の見えの不変

色差の求め方: 2 つの周の同名の JPEG を sRGB → CIE Lab（D65）に直し、画素ごとの ΔE*ab（CIE76）の、画面の中央 120 px 四方（対象の板）の平均をとる（Pillow と numpy の数行、scratchpad の g3/compare.py）。

前照灯を点けない昼のコマ（note-front-8・note-oblique-30deg・note-driver-30）を G3 の前（`.qa/views/g3base/round-01`）と後で撮り、中央 120 px 四方（対象の板）の CIE76 色差の平均は 0.57〜1.35、同じ G3 後どうし（3 周目と 4 周目）は 0.27〜0.49（JPEG とシーンの揺れ）。256 px の層への縮小の分が 1 ほど増えた。8 m の正面の切り出しを並べて目で見ても違いは分からない。

### 多視点レビュー（G3、収束ループ）

視点表 `scripts/qa/views/signs.json` に昼・夜・雨の夜の looks と、運転席 10・30・60 m、ハイビーム 30 m、斜め 30°・60°、前照灯の外、前照灯から目が離れた視点（通行人の写真・ミラーの代わり）を足した（11 視点 × 3 = 33 コマ）。視点表の `state.headlamps`（`beam`・`distanceM`・`angleDeg`・`lateralM`・`turnDeg`）で自車を置いて灯を点け、車体は隠す。各コマの JSON の `scene.retroAtTarget` に、対象の板での放射（`retroWhite` で計算）を書く。数値の探り 4 つ（昼の色差・夜のロービーム 30 m・観測角の大きい目・前照灯の外）。

- 1 周目: ハイビームが効かない（かんたん操作が毎フレーム戻す）→ 撮影側で assist を real に。
- 2 周目: ハイビームで板が白く飛ぶ → SpotLight の鏡面を外した。周の合間の撮り直しで、面がすべて代役（白い板の本体）になる Critical を見つけた: 面のメッシュをシーンに入れてから `faceLayer` を付けていたため、その間に組まれたパイプラインが属性を 0 の定数で固めた（three は「attribute not found」を 1 回警告するだけ）。同じ同期の区間で属性を書くようにした。読み込みの最初のコマが前照灯の視点だと車がスタート地点に戻される（開始 15 s の placeOnStreet）→ 撮影側で 16 s 待つ。
- 3・4 周目: 新規 0、`just check-convergence signs` が converged。残した Info: 観測角の大きい目でも、30 m 先のハイビームの拡散光だけで板が運転席の見えに近い明るさになる（carModel.ts の SpotLight 160 cd・decay 1.1 は 30 m で照度 3.8 と太陽 2.8 より強い。材質の外）。
- **数値の探りの読み方**: `retro-*` は**式の値**（各コマの JSON の `scene.retroAtTarget`、`retroWhite` で計算。シェーダーは同じ式を写しているが、画素は見ていない）。画素から測るのは `plate-luminance-ratio-night`: 夜のロービーム 30 m と前照灯の外の、板の中心 5×5 px の相対輝度（JPEG をページで復号、`projection.plateLuminance`）の比。
- レビュー（Fable、Changes Requested）への対応の後、後方追従の夜のコマを足して（12 視点 × 3 = 36 コマ）回し直した。視点表が変わったので、撮影は最後の完全な周（3 周目）の次として 4 周目を撮り直した（以前の 4 周目の画像は消え、記録 round-04.jsonl は書き直した）。4・5 周目は新規 0 で converged。5 周目の値: 昼の色差 1.38、retro-low-30 0.137、観測角の大きい目 0.003、前照灯の外 0.003、**板の輝度比 22.8（0.581 / 0.0255）**、後方追従 0.214。

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
  - **板の下端の高さ（2026-11-11、G4 で解消）**: 下端の基準と、収まらない柱を 2 本に分ける規則を resolveMount に入れた（「支柱と取付（G4）」）。以下は G2 時点の記録。道路標識設置基準の下端は路側 1.8 m 標準・歩道上 2.5 m 以上だが、`stackPlates` は高さを従来どおり（上の板の中心 2.6 m から 1.0 m 間隔）にしただけで、この基準を検査していない。2 枚目以降の板は 1.8 m を切る（60 cm の板の 2 枚目で下端 1.225 m、3 枚目で 0.225 m）。歩行者専用＋補助標識 3 行＋通学路の柱では最下端が約 0.93 m、一時停止＋補助標識付きの通行禁止＋通学路のように地面を下回る構成では、下の面を立てない（`sign_faces_below_ground`）。G4 の resolveMount で、板の下端の基準と、収まらない柱を 2 本に分ける規則を決める。
  - ~~区の通学路の板（30 cm 幅）の裏の取付金具（40 cm 幅のレール）が、板の左右にはみ出して見える。G2 の前からあり、G4 の部材で直す。~~ G4 でレールを板の幅の 8 割に伸ばす単位部材にして解消（Blender の背面のコマで確認）。
- **支柱と取付の残課題（G4）**
  - 歩行者等横断禁止（332）の標準 1.2 m（交通規制基準 第2章 3）は入れていない。ほかの板と同じ柱にまとめるため、歩道上の 2.5 m に合わせている。
  - 本板の配列順位（交通規制基準 9 (2) イ の表と配置図）は PDF の図で、本文から読めない。並びは gatherPosts の順（一時停止 → 規制 → 横断歩道）のまま、横断歩道だけ車道側の列にしている。2 列のどちらを先にするかも仮定。
  - 共架は信号柱の足元を変えない。T 系の配置で信号柱が交差点の隅切りの舗装の上に立つ所があり、共架した板もそこに掛かる（神田・丸の内で目視）。
  - 柱が歩道の上か路肩かはゲームが知らないので、すべて歩道上（2.5 m）として扱う。`roadside` は API とテストだけ。
  - 門型・壁高欄添架・桁添架は G6（都市高速）で初めて使う。壁高欄の幅・高さ、桁の高さは G6 のデータで決める。
- **ファイル名に `aux` を使わない**: 補助標識の規則のモジュールを `src/signs/aux.ts` にしかけたが、`AUX` は Windows の予約デバイス名で、拡張子が付いても作れない。`auxPlates.ts` にした。

- **catalog.json の撤去（残課題）**: 利用側が残っている間は registry から同じバイトで書き続ける。読む側をレジストリ（G1c 以降は game.json）へ移したら、`src/signs/catalog.ts`・`scripts/signs.ts` の書き出し・台帳の sign-catalog・鮮度検査をまとめて消す。

- **125-B（路面電車停留場）の図**: e-Gov の別表第二の表では、行 59 の 3 番目の見出し「路面電車停留場（１２５―Ｂ）」の下の図が `S35F03102010003-087.jpg` である。どの番号も使っていない添付の連番に当たる。
  - 旧 law_table.py は null で、見出しと図の colspan のずれ（見出し 3・3・1、図 3・2・2）で取りこぼしたとみられる。
  - G1a ではバイト一致を守るため `FIGURE_OVERRIDES` で null を書かせていた。2026-11-10 に G1a の直後のコミットで上書きを外し、`just fetch-sign-law-table` と `just make-sign-registry` を流した。law-table.json・catalog.json・registry.json の 125-B の `figure` が 1 行ずつ -087.jpg に変わったことを `git diff --stat`（各 1 行）で確かめた。
- **別表第二の図の取り方**: 見出しの行（1 行とは限らない。305 と 305の2 は rowspan 2 の隣に 2 段の見出し）の下に図の行が来る。
  - 図は、その列の範囲で始まる見出しすべてに当てる。セルの順で対にすると、colspan の違いでずれる。
- **別表第一の列**: 列の数は表によって違う（規制・指示には「意味」の列がある）。種類が rowspan でまたがる行は番号から始まるので、先頭のセルに番号があるかで見分ける。
- **ルビ**: 勾＜こう＞配 の `Rt` は名前から除く（旧表と同じ）。
