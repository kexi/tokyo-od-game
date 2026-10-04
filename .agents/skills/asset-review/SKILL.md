---
name: asset-review
description: >-
  アセット管理画面（assets.html）から送られたレビュー（.review/pending/*.json）に対応する。
  3D モデルやテクスチャへの「要修正」の指示とピン（画像の位置・モデルの部品と座標）を読み、
  各アセットの生成スクリプト（scripts/blender/*.py, scripts/textures/*.py）を直して作り直し、
  プレビューで確かめてから結果を返す。レビューが届いたというシステムメッセージを受けたとき、
  またはユーザーがアセットのレビュー対応を頼んだときに使う。
---

# アセットレビューへの対応

アセット管理画面（開発サーバーの `/tokyo-od-game/assets.html`）で、ユーザーはアセットごとに OK／要修正を付け、指示を書き、ピンを置いて「レビューを Claude に送る」を押す。開発サーバーがレビューを `.review/pending/` に書き出し、`.claude/hooks/asset-review-watch.sh` がセッションを起こす。

## 1. 読む

- `.review/pending/` の古いものから処理する。`<時刻>.md` が要約、`<時刻>.json` が全データ。
- 各項目は `asset`（`models/*.glb` は `public/` 配下、テクスチャは `assets/<分類>/textures/*.png`）、`verdict`（`ok` / `changes`）、`comment`、`pins`、`generators`（生成スクリプト）を持つ。
- ピンの意味:
  - テクスチャ: `u`, `v` は画像左上が原点の 0〜1。
  - モデル: `object` は glTF のノード名（材質ごとに分かれた子は `名前_1` のようになる）、`point` はゲーム座標（+Y 上、+Z 前、メートル）。
- `snapshot` があれば、そのモデルを見た画面の画像なので Read で見る。

## 2. 直す

- `verdict: ok` の項目は直さない。承認として結果に書く。
- テクスチャ: `generators` の `scripts/textures/*.py` を直し、`uv run <script>` で作り直す。
  - 確認用シートが出せるスクリプトは、引数に出力先（スクラッチパッド）を渡して書き出し、見て確かめる。
  - 絵柄の大きな作り直しは agy に任せてよい（agy:agy-rescue）。その場合も、固定した Noto Sans JP 以外のフォントや外部画像を使っていないか、確認用シートが保存されているかを確かめる。
- モデル: `scripts/blender/*.py` を直し、`just <recipe>`（car-model, sign-model, human-model, signal-model, ambulance-model）か `nix develop .#blender -c blender --background --factory-startup --python <script> -- public/models/<name>.glb <preview-dir>` で作り直す。プレビュー画像を見て、ピンの場所が直ったことを確かめる。
- 生成物は決定的なので、関係ないファイルが変わっていないか `git status` で確かめる。
- ゲームの中での見え方が大事な場合は、ヘッドレス Chrome（knowledge/headless-browser-testing.md）で確かめる。
- 法令に関わる見た目（標識・信号・区画線）は、knowledge/road-markings-and-signs.md と一次情報（命令・設置基準）に合っているかを確かめる。

## 3. 返す

- `.review/done/<時刻>.response.json` に `[{ "asset": "...", "at": "<ISO 時刻>", "summary": "何をどう直したか（日本語 1〜2 文）" }]` を書く。アセット管理画面がこれを表示する。
- `.review/pending/<時刻>.json`・`.md`・同名のフォルダを `.review/done/` に移す。
- 検査（`pnpm exec vitest run`、`pnpm exec tsc --noEmit`、ruff）を通し、コミットメッセージ案を示してからコミットする（Semantic Commit Messages、理由を書く）。
- ユーザーへの報告は、直したアセット、確かめ方、承認だけのもの、直せなかったもの（理由付き）を短く書く。
