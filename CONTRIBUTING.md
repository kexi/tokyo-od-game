# 開発に参加する

**日本語** | [English](CONTRIBUTING.en.md) | [中文](CONTRIBUTING.zh.md)

法令厳守 TOKYO OPEN DRIVE の開発環境の作り方と、日々の作業の流れです。ゲームの説明とデータの出典は [README.md](README.md)、AI エージェント向けの決まりごとは [AGENTS.md](AGENTS.md) にあります。

## 必要なもの

| もの                                                  | 用途                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Nix](https://nixos.org/download/)（flakes を有効に） | 開発に使うツールをまとめて揃える。ほかのツールを個別に入れる必要はありません |
| [direnv](https://direnv.net/)（任意）                 | リポジトリに入ると開発シェルに自動で入る（`.envrc` が `use flake`）          |
| Google Chrome（または Chromium 系）                   | 遊んで確かめる。WebGPU が使えるとより速く描画します（使えなければ WebGL 2）  |
| macOS（Apple Silicon）または Linux                    | Blender のシェル（`.#blender`）は x86_64 の macOS では使えません             |

## セットアップ

```sh
git clone https://github.com/kexi/tokyo-od-game.git
cd tokyo-od-game

# 開発シェルに入る（direnv なら `direnv allow` で以後自動）
nix develop

# 依存パッケージを入れる
just install-deps

# 開発サーバーを起動する
just serve-dev
```

ブラウザで <http://localhost:5173/tokyo-od-game/> を開くとタイトル画面が出ます。

- **開発シェル**（`nix develop`）には次が揃います: Node.js 24、pnpm、just、lefthook、uv、yq、ffmpeg、gitleaks、pinact、actionlint、shellcheck、ruff。
- **git hook** は、開発シェルに入ると `lefthook install` で自動的に設置されます。
- **パッケージは公開から 1 日以上たったものだけ**を入れます（`pnpm-workspace.yaml` の `minimumReleaseAge: 1440`）。サプライチェーン攻撃への備えなので、新しいパッケージを足すときも緩めないでください。インストール時のスクリプトも動かしません（`allowBuilds`）。
- **地図・建物・データ**: `public/data/` のオープンデータはリポジトリに入っているので、取得し直さなくても動きます。PLATEAU の 3D 都市モデル・地理院タイルなどは、遊んでいる間にブラウザが配信元から読み込みます。

## 日々の作業

レシピは `just` で一覧できます。名前は「動詞-名詞」です（`default` だけ例外）。

```sh
just serve-dev     # 開発サーバー
just check-all     # 型・lint・整形・テスト・justfile・Actions・ナレッジの検査（CI と同じ）
just run-tests     # ユニットテスト（vitest）だけ
just format-code   # 整形（oxfmt）
just build-app     # 本番ビルドを dist/ に
just preview-app   # 本番ビルドをローカルで配信して確かめる
```

- **コミットの前**には lefthook が、変更したファイルに CI と同じ検査（gitleaks・tsc・oxlint・oxfmt・justfile・pinact・actionlint・ruff・ナレッジ）をかけます。
- **コミットメッセージ**は [Semantic Commit Messages](https://www.conventionalcommits.org/)（`feat(input): …`、`fix(accidents): …`）で書き、本文には「なぜ変えたか」を書きます。
- **デプロイ**: `main` に push すると GitHub Actions が CI のあと GitHub Pages に出します。
- **スクリプト**: `scripts/*.ts` は tsx で動かします（`pnpm exec tsx scripts/<name>.ts` か、それを呼ぶレシピ）。`node scripts/<name>.ts` では動きません。

### ログを読んで直す

ゲームのログは 1 行 1 イベントの JSON で、開発サーバー（`just serve-dev`）で遊ぶと `.qa/logs/` に溜まります。ブラウザのコンソールを開かなくても、端末から追えます。

```sh
just show-logs           # 最新のセッションの末尾
just show-errors         # warn・error と、uncaught_error の発生箇所（TypeScript の行）
just trace-span <spanId> # その仕事の始まりから終わりまで
just print-repro-url     # 同じ seed・場所・時刻・天気で読み込み直す URL
just compare-logs        # 直す前と後のセッションのエラー件数を比べる
```

ログは `src/log.ts` の `log()` / `warn()` / `error()` だけで書き、イベントは `src/logEvents.ts` に Zod スキーマを登録してから使います。詳しくは [knowledge/logging.md](knowledge/logging.md)。

## アセット（3D モデル・テクスチャ）

アセットはすべてスクリプトから作ります。手作業の一点物は置きません。

- **3D モデル**: `scripts/blender/` の Blender CLI（bpy）スクリプトから作ります。Blender は約 1.6 GB あるので既定のシェルには入れず、別のシェル（`nix develop .#blender`）にしています。各レシピがこのシェルを使います（例: `just make-car-model`）。
- **テクスチャ**: `scripts/textures/` の Python スクリプト（PEP 723、uv で実行）から作ります（例: `just make-textures`）。
- **台帳**: `assets/` と `public/`（`public/data` を除く）のファイルは、すべて `assets/manifest.yml` に 1 件ずつ登録します。台帳に無いファイルがあると `just check-assets`（`just run-tests` にも含まれる）が落ちます。
- **見た目の確認**: `just open-assets` でアセット管理画面を開けます。決まりの詳細は [knowledge/asset-manifest.md](knowledge/asset-manifest.md)。

## データの取り直し（必要なときだけ）

```sh
just fetch-data   # 東京都オープンデータなど（ライセンスが CC BY 4.0 でなければ止まる）
just fetch-regs   # JARTIC 交通規制情報（約 400 MB）と OSM の信号機
```

どちらもネットワークから大きなファイルを取ってきます。取ったものは `.cache/`（git の管理外）に 1 週間置き、`public/data/` を書き直します。`just make-guide-data` と `just make-destinations` は、`fetch-regs` が置いた OSM のキャッシュを使います。

## 撮影（ティザー動画・SNS 共有カード）

```sh
just make-teaser      # out/teaser.mp4
just make-og-image    # public/og.jpg（雨の夜の東京駅を車内から撮り、題字を重ねる）
```

- **開発サーバーが要る**: どちらも開発サーバーで動いているゲームを、ヘッドレスの Chrome でコマ送りに撮ります。既定の場所は `/Applications/Google Chrome.app` で、別の場所にあるときは環境変数 `CHROME` で指定します。
- **ティザーは ffmpeg で編集する**: 開発シェルに入っています。

## 守ってほしいこと

- **実在の団体・企業・人物**: ロゴ・紋章・名称は使いません。Google のストリートビュー・地図の画像も使いません。
- **出典**: 外から取り込むもの（データ・フォントなど）は、出典とライセンスを台帳とゲーム内の出典画面（`src/game/credits.ts`）の両方に書きます。
- **GitHub Actions**: アクションはコミットの SHA で固定します（`pinact run --check` が検査します）。
- **just のレシピ**: 名前は「動詞-名詞」にし、直前の行に説明のコメントを書きます（`bin/lint-justfile.sh` が検査します）。
- **ナレッジ**: 調べて分かったこと・測ったことは `knowledge/` に OKF（Markdown と YAML frontmatter）で残します。tag は `knowledge/tags.yml` にあるものだけ使います。目次は [knowledge/index.md](knowledge/index.md)。

## ライセンス

コードは [MIT License](LICENSE) です。データ・3D 都市モデル・フォント・音声合成モデルには、それぞれの提供元の利用条件があります（README の「データ出典」と、ゲーム内の「出典・ライセンス」）。
