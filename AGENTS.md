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
  - 台帳に無いファイル、ファイルの無い台帳の行は `tests/assetManifest.test.ts`（`just assets-check`）で落ちる。
- アセットは生成スクリプトから作る（モデルは `scripts/blender/`、テクスチャは `scripts/textures/`）。再生成のレシピを justfile に置き、手作業の一点物を作らない。
- 外部から取り込むフォントなどは、取得元 URL を commit 固定にして SHA-256 を台帳の `remote` に記録する。
- 出典とライセンスは台帳に書き、ゲーム内の出典表示（`src/game/credits.ts`）にも載せる。
- 実在の団体・企業・人物のロゴ、紋章、名称、Google のストリートビュー・地図の画像は使わない。
- 一覧は `just assets`（アセット管理画面 `assets.html`）で確認できる。
