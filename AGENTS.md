# AGENTS.md

このリポジトリで作業する AI エージェント（Claude Code / Codex / Antigravity など）への指示。

## モデリング

- 3D モデリングは Blender CLI を使用する（`blender --background --python scripts/blender/<name>.py`）。
  手作業の .blend ではなくスクリプトを `scripts/blender/` に置き、いつでも同じものを再生成できるようにする。
- 出力は glb で `public/models/` に置き、`assets/manifest.yml` に名前と用途を登録する（`tests/assetManifest.test.ts` が検証する）。

## アセットの管理

詳細は [knowledge/asset-manifest.md](knowledge/asset-manifest.md)。

- `assets/` と `public/`（`public/data` のオープンデータを除く）に置くファイルは、すべて台帳 `assets/manifest.yml` に 1 件ずつ登録する。
  - 必須: `id`・`name`・`purpose`・`kind`・`files`・`made_by`・`source`・`license`・`used_by`。生成物は `generator`（スクリプトと justfile のレシピ）も書く。
  - 台帳に無いファイル、ファイルの無い台帳の行は `tests/assetManifest.test.ts`（`just check-assets`）で落ちる。
- アセットは生成スクリプトから作る（モデルは `scripts/blender/`、テクスチャは `scripts/textures/`）。再生成のレシピを justfile に置き、手作業の一点物を作らない。
- 外部から取り込むフォントなどは、取得元 URL を commit 固定にして SHA-256 を台帳の `remote` に記録する。
- 出典とライセンスは台帳に書き、ゲーム内の出典表示（`src/game/credits.ts`）にも載せる。
- 実在の団体・企業・人物のロゴ、紋章、名称、Google のストリートビュー・地図の画像は使わない。
  - 例外（都市高速、G6）: 出入口・JCT の名前、路線名（「都心環状線」「1号羽田線」）と路線記号（標識令 118の3 の枠の形。事業者独自の盾形は描かない）は実在のものを使う。事業者名は架空の「都市高速」（i18n キー `guide.operator`、ロゴなし）。
  - 都市高速の名前はすべて名称層 `src/game/roadNames.ts` を通す。実在の事業者名を綴ってよいのはこのファイルだけで、`tests/roadNames.test.ts` が src と `public/data` を検査する。`public/data/expressway` には事業者名を入れない。`public/data` の routes・junctions・police.json は OSM・警察のデータの実名を保持し、表示時に名称層の `displayPlace` で「都市高速」へ置き換える（テストの許可リストに理由つきで載せる）。
- 一覧は `just open-assets`（アセット管理画面 `assets.html`）で確認できる。

## 道路標識の追加

詳細は [knowledge/sign-system.md](knowledge/sign-system.md)。標識の定義は `src/signs/defs/*.ts` の 1 か所だけに書く（Python・ゲーム側に番号の一覧を書かない）。

1. 定義を 1 件足す（群のファイルへ。番号・名前は別表第一の表 `assets/signs/law-table.json` と一致させる）。図柄は `art: { by: "texture", file, paint }`。
   - 固定の図柄なら、描画関数を 1 つ `scripts/textures/signs/<群>.py` に足し、`paint: { fn: "<群>.<関数>", args }` で指す。数値や文言だけが違うなら既存の関数を引数で呼ぶ。
   - ゲームが配置するなら `game: { kind }`（必要なら `pick`・`gameValue`）を書く。
2. `just make-sign-registry`（registry.json・game.json・catalog.json を書き直す）。
3. `just make-sign-textures`（図柄を registry.json から描く。既存の PNG がバイト一致のまま変わらないことも `git status` で見る）。
4. `pnpm exec vitest run tests/signRegistry.test.ts tests/signPlacement.test.ts` と `just check-assets`。

`just fetch-regs` で turn:lanes や通行禁止の規制時間（補助標識の文言）が変わったら `just rebuild-sign-assets`（レジストリ → 図柄 → どの定義にも無い図柄の削除）。

## スクリプト

- `scripts/*.ts` は tsx で実行する（`pnpm exec tsx scripts/<name>.ts`、またはそれを呼ぶ just レシピ）。`node scripts/<name>.ts`（Node の型除去）は enum・パラメータプロパティなど型除去で消せない構文や、拡張子なしの import で止まるため使わない。

## ログ

- ログは `src/log.ts` の `log()` / `warn()` / `error()` だけで書き、イベントは `src/logEvents.ts` に Zod スキーマを登録してから使う（`console.*` を直接呼ばない。テストが検査する）。詳細と jq での調べ方は [knowledge/logging.md](knowledge/logging.md)。
- 不具合を直すときは、ブラウザのコンソールではなく端末でログを読む：`just serve-dev` のページの行は `.qa/logs/` に溜まる。`just show-errors` で失敗の場所（TypeScript の行）と span を見つけ、`just trace-span <spanId>` で流れを読み、直したら `just print-repro-url` の URL で読み込み直して `just compare-logs` でその `uncaught_error` が `gone` になったことを確かめる（knowledge/logging.md「AI のデバッグループ」）。

## 多視点レビュー

詳細は [knowledge/review-loop.md](knowledge/review-loop.md)、手順は `.agents/skills/road-qa/SKILL.md`。

- 標識・信号・ランドマーク・高速道路・一般道の見た目は、視点表 `scripts/qa/views/<name>.json` で狙った物を毎周同じに撮って確かめる。`just serve-dev` を起動し、`just shoot-views signs`（名前は位置引数。base・port も位置引数で `just shoot-views signs "" http://localhost:5231/tokyo-od-game/`）で `.qa/views/<name>/round-NN/` に画像・各コマの JSON・コンタクトシート・run.json を書く。失敗したコマがあれば終了コード 1 で、その周は数えない（同じ番号で撮り直す）。
- 指摘は `.qa/reviews/<name>/round-NN.jsonl` に書く。毎周、観点と見たコマを書いた `review` 行が要る。指摘は Critical / Warning / Info で、id は周をまたいで同じものを使う。閉じるのは `fixed`、または理由を `fix` に書いた `wontfix` だけ。`just check-convergence signs` で判定する。完全に撮れた周で Critical / Warning の新規 0 が 2 周続き、open の Critical / Warning が無く、数値の探りが範囲内なら止める。6 周で収束しなければ設計へ差し戻す。
- 標識の全描画済み番号の見本は `just render-sign-review`（Blender、`.qa/signs/`）。
- カメラと対象の位置は開発ビルドの `window.__game.debug.camera` / `.targets` / `.signals` / `.settled`（`src/debug/viewHooks.ts`）で扱う。撮影スクリプトで private なフィールドを直接触らない。

## 高速道路データ

- 高架の高速道路は `just make-expressway-data`（`scripts/expressway.ts`）で OSM から道路構造令の線形にコンパイルし、`public/data/expressway` に書く。法令値は `src/law/roadStandards.ts`（条文つき）、法令に無い仮定は `src/expressway/assumptions.ts`（未確認と明記）に分け、混ぜない。生成後は `pnpm exec vitest run tests/expresswayData.test.ts` で T1〜T10 を確かめる。詳細は [knowledge/expressway-generation.md](knowledge/expressway-generation.md)。
- 事業者の実名（首都高など）は `public/data/expressway` とゲームの表示に入れない（ゲームでは架空名「都市高速」）。routes・junctions・police.json は実名を保持し表示時に置換する（`tests/roadNames.test.ts`）。
