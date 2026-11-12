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
- データのフォルダは配信形式 v6（P2.7-4）: `meta.json` はタイルの索引、タイルにチャンク・その run の要約・入口、`report.json` にビルドの記録（診断・閉鎖・run の詳しい要約・block の `dataHash`）、`ledger.json` に許容の台帳。ゲームは `report.json`・`ledger.json` を読まない。テストと道具は `scripts/expresswayFiles.ts` だけで読む（`XW_DATA_DIR` で別のフォルダ）。
- 作り直しの手順: `just make-expressway-data` → `just update-expressway-ledger`（データから事例を数え直し、台帳に追加しかしない）→ `pnpm exec vitest run`。台帳に `new`（未判断）が出たら、その事例の `status`・`cap`（類型ごとの必須欄は `src/expressway/ledger.ts` の `CAP_FIELDS`）・`reason`・必要なら `qa` を `public/data/expressway/ledger.json` に書いて判断し、もう一度 `just update-expressway-ledger` を掛ける（`report.json` の診断の `allowed` を台帳から書き直す。作り直しは要らない）。許可の規則そのものは `src/expressway/allowlist.ts`（run の ID は書かない）。
  - `status` は `accepted`（受ける）・`wontfix`（理由つきで直さない）・`open`（直す予定の欠陥）。**`open` は継ぎ目の類型（`seam_step`・`seam_hole`・`merge_skipped`・`let_go`）だけに使う**: 診断から来る類型（重なり・`portal-open-cut`・`ramp-radius`・`layer-ambiguous`）を `open` にするとその診断が `allowed` にならず T10 が落ちる。
  - 件数が変わったら `budget` と見比べてから `just update-expressway-ledger public/data/expressway --write-budget` で締め直す。
- 全域・出荷範囲の計測は `just measure-expressway-area <label> [range] [below] [flags]`（既定 ship・pruned。`public/data` は触らず `.cache/expressway-area/<label>/` に生成し、スコアカードを `.qa/expressway/<label>.report.json` に書く）、前後の比較は `just compare-expressway-reports <a> <b>`。OSM の抽出は `src/expressway/extract.ts` の時刻・SHA-256 に固定し、`.cache/osm/kanto-<時刻>.osm.pbf` の写しを読む（`just fetch-regs` が更新する kanto-latest とは別。違えば flags に `--accept-extract`）。基準のスコアカード `tests/fixtures/expresswayScorecard.ship.json` は出荷範囲かコンパイラを変えたら `--baseline` で作り直す。
- 縦断の目的は既定で v2（P2.7-5、`compile.ts` の `OBJECTIVE_V2`）: DEM は凸凹なので路面を地表に追従させず、地表は床・天井と端点にだけ使い、目標は地表の上側包絡 + 標準桁下、勾配変化に L1。旧い目的 v1 は比較用で、`just measure-expressway-area <label> <range> pruned "--objective v1"` のように `--out` 付きでしか作れない（`public/data/expressway` には書けない）。前後の比較は `just compare-expressway-heights <a> <b>` と `just compare-expressway-reports <a> <b>`。
- 構造を高さから決める（P2.7-6 PR 1、`--structures height`、計測専用で `--out` 必須・既定 `tags` はデータ不変）: OSM で高架の run の区間を、解いた路面と測点の地表（中心線）から高架・盛土（`embankment`、橋脚なし・床版の縁から地表まで壁）・掘割（`cut`、P9 と同じ擁壁と地形の穴）に分け（`src/expressway/heightStructures.ts`、20 m 未満の出入りはならす）、境に `portals`、meta の `features` に `height-structures`。仮定の床（開けた地表の床・DEM に沈まない床）は最後の段（`assumedGive`）でだけ合否から外れる（それより前は今までどおり段を進める。高架でいられる所は高架のまま）。離隔が建築限界 + 桁高に 0.5 m 以内で足りない所は桁を薄くし（`GIRDER_MIN` 1.7 m、チャンクの `girder`、重なりの 1 段もその桁で判定）、盛土・掘割の下と地表端の近くで越えない道路は blocked。台帳の類型 `cut-stretch`・`embankment-stretch`・`thin-girder`（規則の上限は `assumptions.ts HEIGHT_STRUCTURES`）、検査 T13。例: `just measure-expressway-area <label> ship pruned "--structures height"`。
- 地平 run（P2.7-6 PR 2、`--ground compile`、`--structures height` が前提、計測専用で `--out` 必須・既定 `skip` はデータ不変）: 高架の run のある鎖の地平の区間も run にし（隣の高架・below run はそれを親とする seam）、設計地盤線の `mid` ±1.5 m の帯で解く（DEM は地表端だけ）。構造は区分（地表 + 0.3 m より低い所が掘割）、横切る道路は blocked。スコアカードの `ground` に本線の穴と地平の追従。例: `just measure-expressway-area <label> ship pruned "--structures height --ground compile"`。
- 床版の走行の確認は経路表 `scripts/qa/deckRoutes.ts`（run と run 距離で書くので、作り直しでチャンク ID が変わっても壊れない）を `just check-deck-drive <label> <route>` で走らせる（`just serve-dev` が要る。route を省くと `shibakoen-shiodome`、`all` で全経路）。経路: `shibakoen-shiodome`（P3 の一定速）、`auto-shibakoen-shiodome`・`auto-shiodome-shibakoen`（P6 の自動運転）、`rainbow-upper-east`・`-west`・`rainbow-lower-east`・`-west`（P7）、`daiba-exit`（台場出口）、`azabudai-tunnel`（P9）。合否は `scripts/qa/deckDriveVerdict.ts`（落下・停止・建物との交差・目標速度から 15 km/h 超の落ち込み・終点・床版の上の max |dy| 0.15 m、自動運転は到着と違反 0）。事故・検挙で invalid の回は数えず 3 回まで撮り直す。
- 事業者の実名（首都高など）は `public/data/expressway` とゲームの表示に入れない（ゲームでは架空名「都市高速」）。routes・junctions・police.json は実名を保持し表示時に置換する（`tests/roadNames.test.ts`）。
