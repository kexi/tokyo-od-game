# AGENTS.md

このリポジトリで作業する AI エージェント（Claude Code / Codex / Antigravity など）への指示。

## モデリング

- 3D モデリングは Blender CLI を使用する（`blender --background --python scripts/blender/<name>.py`）。
  手作業の .blend ではなくスクリプトを `scripts/blender/` に置き、いつでも同じものを再生成できるようにする。
- 出力は glb で `public/models/` に置き、`assets/manifest.yml` に名前と用途を登録する（`tests/assetManifest.test.ts` が検証する）。
