---
type: Reference
title: アセット台帳（assets/manifest.yml）
description: ゲームのアセット 44 件を名前・用途・生成方法・出典・ライセンス付きで管理する YAML 台帳と、その検査（vitest）・アセット管理画面での使い方。台帳を作る過程で分かった未使用のアセット 8 件、作成者の記録が無いアスファルト、生成アセットのライセンスが README に無い点も記録する。
tags: [assets, licensing, testing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T16:50:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T16:45:00Z }
sources:
  - id: inventory
    resource: public/models・assets/**・public/（public/data を除く）の全 512 ファイルと justfile・scripts/blender・scripts/textures のヘッダを走査（2026-10-05 JST）
    title: アセットの棚卸し
    author: claude-opus-5-5/1m
  - id: usage-grep
    resource: src/ を glb 名・テクスチャ名・`import.meta.glob` のパターンで grep し、各ファイルを読み込むモジュールを特定（Blender スクリプトが glb に埋め込むテクスチャは scripts/blender/*.py を grep）
    title: 読み込み元の調査
    author: claude-opus-5-5/1m
  - id: test-run
    resource: pnpm exec vitest run tests/assetManifest.test.ts（7 件、約 0.3 秒）と、assets/ に台帳外の PNG を 1 枚置いて落ちることの確認
    title: 台帳テストの実行
    author: claude-opus-5-5/1m
  - id: page-check
    resource: 開発モードのビルドを vite preview（ポート 4186）で配り、ヘッドレス Chrome（scripts/qa/browser.mjs、1440×900 と 390×844）でモデル・標識の一覧・音声・絞り込みの画面を撮影
    title: アセット管理画面の目視
    author: claude-opus-5-5/1m
  - id: yomogi-meta
    resource: https://raw.githubusercontent.com/google/fonts/main/ofl/yomogi/METADATA.pb
    title: google/fonts の Yomogi メタデータ（designer Satsuyako、license "OFL"）
  - id: yaml-pkg
    resource: https://www.npmjs.com/package/yaml
    title: yaml 2.9.1（eemeli/yaml、2026-09-11 公開。pnpm の minimumReleaseAge 1440 分を満たす）
---

# 構成

- 台帳は `assets/manifest.yml`。1 件 = 1 アセット（モデル 1 つ、テクスチャ 1 セット、フォント 1 書体など）。
- スキーマは `src/data/assetManifest.ts`（zod）。読み込みと glob の展開は `scripts/assetManifest.ts`。
- 検査は `tests/assetManifest.test.ts`（`just check-assets`、`just run-tests` にも含まれる）。
- アセット管理画面（`just open-assets` → `assets.html`）は、台帳を種類ごとに並べる。
  - 各件の名前・用途・作成・生成レシピ・出典・ライセンス・読み込み元・材料・組み込み先・資料を出す。
  - 従来のプレビューとレビュー（OK／要修正、ピン、Claude への送信）はファイル単位のまま残した。

## フィールド

| フィールド                             | 必須       | 意味                                                                                               |
| -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `id`                                   | ○          | kebab-case。画面の URL（`#entry:<id>`）と `inputs` から参照する                                    |
| `name` / `purpose`                     | ○          | 日本語の表示名と、ゲームで何に使うかの 1 文                                                        |
| `kind`                                 | ○          | model / texture / image / data / font / audio                                                      |
| `files`                                | ○          | リポジトリ相対のパスか glob（`fs.globSync` の書式）。空はリポジトリに置かないもの（`remote` 必須） |
| `remote`                               |            | 取得元 URL と SHA-256（Noto Sans JP・Yomogi）                                                      |
| `generator`                            | 生成物は ○ | `script`（1 つかリスト）と `recipe`（justfile のレシピ名）                                         |
| `made_by`                              | ○          | blender-cli / procedural（Claude Code）/ agy / external / unknown。混在はリスト                    |
| `source` / `license`                   | ○          | 出典の説明と、先頭の `licenses` 表のキー（1 つかリスト）                                           |
| `used_by`                              | ○          | 実行時に読み込むソース。glb に埋め込むだけのテクスチャは空で、`inputs` 側から辿る                  |
| `inputs` / `docs` / `status` / `notes` |            | 材料にした台帳の id、資料、`unused`、備考                                                          |

## テストが保証すること

1. 全件がスキーマを満たし、`id` が重複しない。
2. `assets/` と `public/`（`public/data/` と台帳自身を除く）の**全ファイル**が、どれかの `files` か `docs` に載っている。
   - 指示は「モデル・テクスチャ・画像・フォント」だったが、拡張子で絞らず全ファイルにした。
   - TTS の重み（.bin）や README のような、拡張子では拾えないものも台帳に載せるため。
3. 1 つのファイルを 2 件が `files` に持たない。
4. `files` の各パターンが 1 つ以上のファイルに一致し、`docs` が存在する。
5. `generator.script` が存在し、`generator.recipe` が justfile のレシピである。
6. `used_by` が存在し、`inputs` が台帳の id、`license` が `licenses` 表のキーである。
7. `status: unused` が実態と合う。
   - unused でない件は、自分が読み込まれるか、使われている件の材料になっている。
   - unused の件には読み込み元が無い。

# 判断

- **YAML はビルド時に JSON にする**（`vite.config.ts` の `asset-manifest` プラグイン）。
  - YAML パーサを画面に同梱しない。`?raw` を自前の簡易パーサで読む方法も採らなかった。前者は一度読むだけの 1 ファイルのためにパーサを配ることになり、後者はテストが受け付ける YAML を黙って読み違えるおそれがある。
  - テストと同じ `resolveManifest` を通すので、画面とテストが同じデータを見る。台帳が壊れていればビルドが落ちる。
  - 画面のバンドルは型だけを import し、zod を含まない（ビルド成果物で確認）。
  - 開発サーバーでは `/assets/manifest.yml?import` が `text/javascript` で返る。
- パーサは `yaml`（eemeli/yaml）2.9.1 を devDependency にした。既存の依存に YAML パーサは無かった。pnpm の `minimumReleaseAge: 1440` を通した（`✓ Lockfile passes supply-chain policies`）。[^yaml-pkg]
- レビューの ID は従来どおり `models/<f>.glb` と `assets/<set>/textures/<f>` にした。下書き（localStorage）と `.review/` の形式は変えていない。
  - 開発サーバーの検査は `.jpg` のテクスチャも受け付けるようにした。ランドマークの外壁とアスファルトが .jpg のため。
  - `public/og.png` などの画像は、プレビューだけ出してレビューの対象外にした。asset-review スキルが直してよい出力先に入っていないため。

# 台帳を作って分かったこと

## 件数（2026-10-05）

| 種類       | 件数 | 内訳                                                     |
| ---------- | ---: | -------------------------------------------------------- |
| 3D モデル  |   21 | glb 24 本（ランドマーク 3 体は近景・遠景の 2 本ずつ）    |
| テクスチャ |   17 | 16 セット＋アスファルトの未使用分                        |
| 画像       |    1 | OGP 画像                                                 |
| データ     |    2 | 標識カタログ、ランドマークの配置                         |
| フォント   |    2 | Noto Sans JP、Yomogi（どちらもリポジトリに置いていない） |
| 音声       |    1 | sanoTTS-jp                                               |

台帳が持つファイルは 512 本（`public/data/landmarks.json` を含む）。[^inventory]

## 未使用（`status: unused`、8 件）

ゲームのどのソースも読み込んでいない。[^usage-grep]

- モデル: `police.glb`（制服警察官）、`stroller.glb`、`bicycle.glb`、`police_rider.glb`（白バイ隊員の立ち姿）。
  - `vehicleModels.ts` が読むのは白バイの乗車姿だけ。
- テクスチャ: 上のモデルにしか使われない警察官の制服・ベビーカー・自転車の 3 セット。
- アスファルト: PNG 原版（`asphalt_albedo.png`・`asphalt_normal.png`）と、轍・補修跡・排水性舗装の 3 種（PNG と JPEG）。
  - `roadSurface.ts` が読むのは `asphalt_albedo.jpg`・`asphalt_normal.jpg`・`asphalt_roughness.png` だけ。
  - それでもアセット管理画面の glob には入るので、本番ビルドにも出力される。

## 記録が無いもの

- **アスファルトのテクスチャの作成者**（`made_by: unknown`）。knowledge にも README にも記録が無い。
  - `scripts/textures/asphalt_textures.py` の確認用シートの既定の出力先に、委譲時のタスク記述から取ったとみられる scratchpad の絶対パスが残っている（コメントは "Default scratchpad path from task description"）。
  - 車のテクスチャを agy に委譲したときと同じ種類の問題（[Blender CLI でのモデリング](car-model-blender.md)）。直していない。
- **生成アセットのライセンス**。README の「ライセンス」節はソースコード（MIT）とデータ（各提供元）しか書いていない。
  - 台帳では `repo`（リポジトリの LICENSE）とし、その旨を `licenses.repo.notes` に書いた。
  - 明文化するかはユーザーの判断が要る。
- 出典・ライセンスが分からないアセットは無かった。
  - Yomogi は `style.css` のコメントに OFL とあった。google/fonts のメタデータでも OFL だった。[^yomogi-meta]

## そのほか

- ランドマークのモデルは PLATEAU LOD2 の実測と OSM の形から作っている。そのため `license` を `[repo, PDL-1.0, ODbL-1.0]` にした。
  - `public/data/landmarks.json` は OSM の足元の多角形を含む。帰属表示はエントリの `sources` にある。
- `scripts/build-tts.sh` には just のレシピが無い（台帳では `generator.recipe` を省いた）。
- `grille.png`（車）は cockpit とパトカーも、歩行者の顔・髪は警察官・白バイ隊員も使う。
  - 台帳ではそれぞれの `inputs` に書いた。画面はこれを「組み込み先」として逆向きにも出す。

# 落とし穴

1. `vite.config.ts` の `assetReview` が受け付けるテクスチャは `.png` だけだった。台帳から `.jpg` をレビューに出すと、送信が 400 で弾かれるところだった。
2. 新しいファイルを足しただけでは、開発サーバーの画面に出ない（台帳のモジュールが変わらないため）。台帳に書けばテストも画面も更新される。順番は台帳が先。
3. テストは台帳の `files` だけを見る。glb に埋め込まれたテクスチャが実際に Blender スクリプトから参照されているかまでは確かめない。参照の調査は grep で行った。[^usage-grep]

# 検証

- `tests/assetManifest.test.ts` の 7 件が通った。`assets/bicycle/` に台帳外の PNG を置くと、網羅のテストがそのパスを挙げて落ちた（確認後に削除）。[^test-run]
- 開発モードのビルドを配り、ヘッドレス Chrome で画面を確かめた。[^page-check]
  - モデル（car.glb・tokyo_tower.glb）、標識 345 枚のタイル一覧、テクスチャのピン、音声・フォントの概要、絞り込み、390 px 幅を見た。
  - コンソールのエラーは無かった。

[^inventory]: アセットの棚卸し

[^usage-grep]: 読み込み元の調査

[^test-run]: 台帳テストの実行

[^page-check]: アセット管理画面の目視

[^yomogi-meta]: google/fonts の Yomogi メタデータ

[^yaml-pkg]: yaml 2.9.1
