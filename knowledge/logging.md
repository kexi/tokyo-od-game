---
type: Reference
title: 構造化ログ（イベントの登録と Zod スキーマ・trace / span で追う・調べ方）
description: ゲームとビルドスクリプトのログを 1 行 1 イベントの JSON に揃え、AI エージェントがブラウザを開かずに端末から「失敗の span を見つける → 直す → 再現して確かめる」を回せるようにした仕組み。src/logEvents.ts のイベント 125 種の Zod スキーマ（名前と単位の規約）、log()/warn()/error() の型と実行時の検査（本番は各イベントの最初の 1 行、合わなければ log_schema_invalid）、全行の traceId と build（git の commit・未コミットの変更のハッシュ・版）、spanId / parentId（違反 → ポスト・撮影・通知・映像・追跡 → 停止 → 物語、移動）、開発・プレビューサーバーが受けて .qa/logs/<日付>/<traceId>.jsonl に書く仕組み（localhost だけ・上限つき）、uncaught_error（スタックと TypeScript の行・span・ゲームの状態・直前の行）、session_start / drive_started と ?seed= ?start= ?time= ?weather= での再現、just logs* の使い方と AI のデバッグループ、移行で直した食い違いと旧名の対応。ブラウザでの確認はまだ（開発サーバーと HTTP の受け口は Node から確かめた）。
tags: [logging, testing]
status: draft
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T04:20:00Z }
verified:
  - { by: process:vitest, at: 2026-10-05T04:44:00Z }
  - { by: process:tsc, at: 2026-10-05T04:44:00Z }
  - { by: process:vite-build, at: 2026-10-05T04:45:00Z }
  - { by: process:tsx+jq, at: 2026-10-05T04:18:00Z }
  - { by: process:vite-dev-server, at: 2026-10-05T04:35:00Z }
sources:
  - id: code
    resource: src/log.ts、src/logEvents.ts、src/game/traffic.ts（SESSION・violationSpan・cite / notice のログ）、src/game/social.ts（postSpan）、src/game/pursuitDirector.ts（追跡・停止・物語の span）、src/main.ts の呼び出し（2026-10-05）
    title: ロガーとイベントの登録
    author: claude-opus-5-5/1m
  - id: tests
    resource: tests/log.test.ts（14 件：全イベントの見本の検査、型の拒否を @ts-expect-error で、実行時の log_schema_invalid、本番の first モード、span の連鎖、リングの上限と絞り込み、src/・scripts/ の console.* と未登録イベントの走査）、tests/pursuitDirector.test.ts の span の 1 件、全体 60 ファイル 734 件
    title: 振る舞いのテスト
    author: claude-opus-5-5/1m
  - id: inventory
    resource: 移行前の src/ と scripts/ の log( / warn( / console.* の全呼び出し 121 か所（120 のイベント名）を括弧の対応で抜き出した表（scratchpad/inv.tsv、2026-10-05）
    title: 呼び出しの棚卸し
    author: claude-opus-5-5/1m
  - id: smoke
    resource: pnpm exec tsx でロガーと TrafficLaw を動かした JSON 行を jq で読み、下の「違反から辿る」の jq が違反 → ポスト → 撮影 → 追跡 → 停止 → 切符を返し、無関係の移動を返さないことを確かめた（2026-10-05）。本番ビルドの出力で検査が first モードになり、process.env が {} に置き換わることも読んだ
    title: tsx と本番ビルドでの確認
    author: claude-opus-5-5/1m
  - id: devserver
    resource: vite の createServer で開発サーバー（127.0.0.1:5199）を立て、Node の fetch で POST /tokyo-od-game/__log に uncaught_error の行と壊れた行を送った（written 1・rejected 1、別 origin は 403、GET __log/build は 200）。配信中の src/diagnostics.ts の 100 行目 2 列のフレームが original `src/diagnostics.ts:133:3`（元の行は 133）になり、latest.jsonl がそのセッションのファイルを指すことを確かめた（2026-10-05、scratchpad/devsink.mts）。本番ビルドに受け口のコード（appendFileSync・checkSinkRequest）が入らず、build のラベルが入ることも読んだ
    title: 開発サーバーの受け口の確認
    author: claude-opus-5-5/1m
  - id: loop-tests
    resource: tests/logSink.test.ts（10 件：受ける要求と断る要求、行と本文の上限、パス名にならない traceId、日付と traceId のファイルと latest、ファイルの上限、HTTP での書き込みと build、本文の上限、VLQ と oxc の実際の変換での元の行）、tests/diagnostics.test.ts（10 件：seed、?seed=、再現 URL、Chrome / Firefox のスタック、uncaught_error の形・状態の一部が読めないとき・5 秒内の同じ失敗、送信の束・上限・止まり方、build のラベル）、tests/logsCli.test.ts（9 件）。全体 66 ファイル 782 件
    title: デバッグループの部品のテスト
    author: claude-opus-5-5/1m
---

# 何をどこに書くか

- ログは `src/log.ts` の `log()`（info）・`warn()`（失敗したが続ける）・`error()`（続けられない）だけで書く。`console.*` を直接呼ぶのは `src/log.ts` の出力先だけ（`tests/log.test.ts` が src/ と scripts/ を走査して落とす）。[^tests]
- イベントは `src/logEvents.ts` の `LOG_EVENTS` に 1 名 1 スキーマ（Zod の strictObject）で登録する。`log("accident", { kind, speedKmh })` は登録されたフィールドしか型が通らず（余分・不足・型違い・レベル違いはコンパイルエラー）、実行時もスキーマで検査する。[^code]
- ビルドスクリプト（`scripts/*.ts`、tsx）も同じモジュールを `import { log } from "../src/log.ts"` で使う。Node では全レベルを標準出力の 1 本に出すので `pnpm data | jq` で全部読める。[^code]
- `scripts/qa/drive.mjs` と `scripts/teaser/teaser.mjs` は素の node で動くので `.ts` のロガーを読めない（AGENTS.md）。行の形（ts・level・event・traceId）だけ合わせ、スキーマの検査はしない。`scripts/teaser/clock.mjs` の `console.error` はページに注入するコードなので残す。

# 1 行の形

```json
{
  "ts": "2026-10-05T04:18:00.123Z",
  "level": "info",
  "event": "pursuit_stage",
  "traceId": "e42ed18d-…",
  "build": "3af1cae+1f8c3d@0.1.0",
  "spanId": "pursuit-2",
  "parentId": "vio-001791173933468-0001",
  "stage": 2
}
```

| キー       | 意味                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts`       | ISO 8601（UTC）                                                                                                                                                                                                                                                                                                                                                                          |
| `level`    | `info` / `warn` / `error`。イベントごとに決まっている（登録の `info()` / `warning()` / `failure()`）                                                                                                                                                                                                                                                                                     |
| `event`    | snake_case のイベント名                                                                                                                                                                                                                                                                                                                                                                  |
| `traceId`  | ページの読み込み 1 回（ゲーム）か、スクリプトの実行 1 回。ゲームでは `traffic.ts` の `SESSION` と同じ値で、保存された違反の記録の `session` に残るので、履歴の違反からその回のログに行ける                                                                                                                                                                                               |
| `build`    | 行を書いたコード：`<commit>@<版>`、未コミットの変更があれば `<commit>+<変更のハッシュ 6 桁>@<版>`（`src/buildLabel.ts`）。ビルドとテストは vite.config の define（`scripts/logSink.ts` が起動時の git で作る）、tsx のスクリプトはその場で git に聞く。開発ページは起動直後に `GET __log/build` で今の木のラベルを取り直す（サーバー起動後の編集が反映される）。同じ変更なら同じハッシュ |
| `spanId`   | その行が属する仕事の単位（下の表）                                                                                                                                                                                                                                                                                                                                                       |
| `parentId` | `spanId` の仕事を起こした span                                                                                                                                                                                                                                                                                                                                                           |
| 残り       | イベントのフィールド                                                                                                                                                                                                                                                                                                                                                                     |

ロガーは 基本キー（ts・level・event・traceId・build）をフィールドより後に書き直すので、フィールドで上書きできない（移行前は `log("police", { event: "ticket" })` の `event` が行のイベント名を、スクリプトの `stations` の `level` が行のレベルを上書きしていた）。[^inventory]

# 名前と単位の規約

- イベント名は `<対象>_<起きたこと>`（`pursuit_stage`、`road_tile_failed`、`violation_cited`）。1 つの名前は 1 つの形。中に `event` のような下位の種別を持たせず、名前を分ける。
- フィールドは camelCase。量には単位を接尾辞で付ける：`Ms` `S` `H`（時間）、`M` `Km`（距離）、`Kmh`（速さ）、`Km2`、`Deg`、`Mm`（焦点距離）、`Mb`、`Yen`、`Kg`（質量）、`Kj`（エネルギー）。数は複数形の名詞（`segments`、`lamps`）、id は `…Id` / `…Ids`、失敗の文は `error`（`String(error)`）。
- 6 つの基本キーはフィールド名に使わない（registry のテストが確かめる）。
- 種類（違反の種類・パトカーの種類…）は `z.enum` にせず `z.string()`。enum にするとスキーマが three.js や世界のモジュールを import することになり、boot.ts と Node のスクリプトが先に読むロガーが重くなる。名前の打ち間違い・消えたフィールドは strictObject で捕まる。[^code]

# span（仕事の単位）

| span                 | 作る所                                                                             | 親                                               | その span の行                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vio-<記録の id>`    | `traffic.ts` の `violationSpan(record)`（記録の id は `TrafficLaw.commit` が振る） | なし                                             | `violation_booked`、`violation_cited`（`via: spot` / `post`）、`violation_noticed`、`social_filmed`、`orbis_fired`、`replay_clip_saved`、`patrol_pursuit` |
| `post-<ポストの id>` | `social.ts` の `postSpan(post)`                                                    | そのポストの違反                                 | `social_post`、`witness_shot`、`witness_shot_failed`、`social_reported`、`social_video_played`                                                            |
| `pursuit-<n>`        | `PursuitDirector.begin`                                                            | 先頭のパトカーが最後に見た違反                   | `pursuit_begin` 〜 `pursuit_end`、逃げ切った後の `pursuit_identified`                                                                                     |
| `stop-<n>`           | `PursuitDirector.beginStop`                                                        | 追跡                                             | `stop_begin`、`stop_ticket`、`stop_end`、`social_stop_post`、停止中の `pursuit_criminal`                                                                  |
| `story-<n>`          | `PursuitDirector.storyFor`                                                         | 停止か追跡（ひき逃げの逮捕で追跡が無ければ違反） | `story_begin`                                                                                                                                             |
| `warp-<n>`           | main の `warpTo`                                                                   | なし                                             | `warp_start`、`warp_landed`（`durationMs` は読み込みを待った時間）                                                                                        |

- `<n>` は trace の中の通し番号（`newSpan`）。違反とポストは既にある id から作る（`spanOf`）ので、保存された記録・ポストの id でそのまま引ける。
- 複数の違反をまとめて扱う行（`pursuit_begin`、`pursuit_end`、`stop_begin`、`stop_ticket`、`patrol_ticket`、`patrol_lost`、`pursuit_criminal`）は `violationIds` に記録の id を並べる。親は 1 つしか持てないので、2 件目以降の違反との関係はこちらで追う。
- span は仕事をしている物に持たせる（`Chase.span`・`Stop.span`・`warping.span`）。毎フレームの行で新しく作らない。

違反から辿れるもの（`recentLogs.chain("vio-…")` と下の jq）:

```
vio-…  violation_booked ─┬─ post-7   social_post, witness_shot, social_reported
                         ├─ violation_cited / violation_noticed / replay_clip_saved（同じ span）
                         └─ pursuit-2 pursuit_begin … pursuit_end
                                └─ stop-3 stop_begin, stop_ticket, stop_end
                                       └─ story-4 story_begin
```

# 検査（Zod）

| 実行環境                             | 検査                                                                     | 理由                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 開発ビルド・vitest・tsx のスクリプト | 全行                                                                     | 数フィールドの safeParse は数 µs                                                                                                                      |
| 本番ビルド                           | 各イベント名の最初の 1 行（1 セッション約 120 回、毎フレームの分は無い） | 本番で形が崩れると、報告を受けても再現できない。乱数での抜き取りより、各呼び出し（ほぼ 1 つのオブジェクトリテラル）の形を必ず一度見るほうが漏れが無い |

- 合わない・未登録のときは元の行をそのまま書き、続けて `log_schema_invalid`（warn、`invalidEvent` と `issues: [{path, message}]`、元の行の span 付き）を書く。例外は投げない（ロガーがゲームを止めないため）。未知のフィールドは `path` にその名前が入る。
- `setLogValidation("all" | "first" | "off")` で切り替えられる（テスト用）。

# 直近の行（開発ビルド）

`src/log.ts` の `recentLogs`（直近 2,000 行のリング。1 行 ~200 B で ~0.4 MB）を、開発ビルドだけ `window.__game.debug.logs` に出している。[^code]

```js
const L = __game.debug.logs;
L.query({ event: /^pursuit_/ }); // 名前・名前の配列・正規表現
L.query({ level: "warn", limit: 20 }); // 失敗だけ、最新 20
L.query({ spanId: "warp-5" });
L.query({ since: "2026-10-05T04:00:00Z" });
L.chain("vio-001791173933468-0001"); // 違反と、そこから起きた span 全部
copy(L.jsonl()); // DevTools で JSON 行をクリップボードへ（ファイルにして jq）
```

ブラウザでこの API を動かしての確認はしていない（ヘッドレス Chrome を使わない作業だったため）。リングと chain は vitest で確かめた。[^tests]

テストでは出力先を黙らせている（違反を記録するテストが何百行も出すため）。行は `recentLogs` に残るので `recentLogs.clear()` してから `recentLogs.query({ event: "…" })` で確かめる。端末に出したいときは `LOG_STDOUT=1 pnpm test`。

# 調べ方（jq / grep）

ファイルは、ブラウザなら上の `copy(L.jsonl())` か DevTools のコンソールの保存、スクリプトなら `pnpm exec tsx scripts/regulations.ts > .logs/regs.jsonl` で作る。DevTools から保存した行に `main-….js:1` のような前置きが付いたら `grep -o '{.*}'` で JSON だけにする。

```sh
# 失敗だけ、イベントごとの件数
jq -r 'select(.level != "info") | .event' log.jsonl | sort | uniq -c | sort -rn
# スキーマに合わなかった行
jq -c 'select(.event == "log_schema_invalid") | {invalidEvent, issues}' log.jsonl
# 1 つの span（移動の読み込み時間など）
jq -c 'select(.spanId == "warp-5") | {ts, event, durationMs}' log.jsonl
# ある違反の id を含む行（violationIds の配列も）
grep -F '001791173933468-0001' log.jsonl
# 違反から起きたもの全部（子・孫の span をたどる）
jq -s -c --arg root "vio-001791173933468-0001" '
  def kids($s): [.[] | select(.parentId as $p | $s | index([$p])) | .spanId] | unique;
  . as $all
  | [$root] | until((. as $s | $all | kids($s)) - . | length == 0; . + ((. as $s | $all | kids($s)) - .)) as $spans
  | $all[] | select(.spanId as $id | $spans | index([$id])) | [.ts, .event, .spanId]' log.jsonl
# 複数のセッションが混ざったファイルは traceId で分ける
jq -r '.traceId' log.jsonl | sort | uniq -c
```

最後の jq は 2026-10-05 に tsx で書いた 11 行（違反・ポスト・撮影・移動・追跡・停止・切符）で、移動の 2 行を除いた 9 行を返すことを確かめた。[^smoke]

# イベントを足すとき

1. `src/logEvents.ts` の `LOG_EVENTS` に `name: info({ … })`（失敗なら `failedWith({ … })`）を足す。規約は上のとおり。
2. `tests/log.test.ts` の `SAMPLES` に 1 行足す（足さないと型エラーになる）。
3. 呼び出しで `log("name", { … }, span)`。続く仕事の一部なら、その仕事が持つ span を渡す。

# ページのログをディスクへ（開発・プレビュー）

`just dev`（と `vite preview`）で開いたページの行は、そのまま `.qa/logs/<日付>/<traceId>.jsonl` に溜まる（`.qa/` は git の対象外）。`.qa/logs/latest.jsonl` は最後に始まったセッションのファイルへのシンボリックリンク。[^devserver]

- ページ側（`src/diagnostics.ts` の `LogShipper`）: 書かれた行を全部キューに入れ、1 秒ごとに 200 行・256 KB までの束を `POST <base>__log`（text/plain の JSON 行）で送る。ページが隠れる・閉じるときは残りを `sendBeacon` で。キューは 2,000 行まで、溢れた分は古い順に捨てて `log_ship_dropped` で数を残す。ページの host が `localhost` / `127.0.0.1` / `[::1]` のときだけ送る。最初の束が断られたら（受け口の無いサーバー）送るのをやめる。
- サーバー側（`scripts/logSink.ts` の Vite プラグイン。`configureServer` / `configurePreviewServer` だけで、本番の成果物には入らない）: 接続元がループバック、Host が localhost 系、Origin・Sec-Fetch-Site が同じ origin、POST・text の型、本文 512 KB・1 束 1,000 行・1 行 64 KB、行が基本キーを持ちログの形であること、traceId が id の形（`[A-Za-z0-9-]{8,64}`）であることを全部満たす行だけを書く。1 セッションのファイルは 32 MB まで。外への送信は無く、行にはゲームのデータしか入らない（メールアドレスなどの個人の情報は載せない）。
- 開発サーバーでは `uncaught_error` のフレームを、Vite のモジュールグラフにある変換結果の source map（`scripts/sourceMap.ts` の VLQ の読み）で TypeScript の `file:line:column` に直して `original` に書き足す。

# 失敗の記録（uncaught_error）

`window` の `error`・`unhandledrejection`、WebGPU のデバイスの喪失（renderer.ts の `gpu_device_lost` を見て）、`main()` の失敗（`source: "fatal"`）を、1 行の `uncaught_error`（error）にする。[^loop-tests]

| フィールド                 | 中身                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source` `message` `stack` | どこから来たか、文、スタック（4,000 字まで）                                                                                                                                                      |
| `frames`                   | `{fn, file, line, column, original?}`（15 まで）。`file` は URL のパス（クエリなし）、`original` は開発サーバーが直した TypeScript の位置                                                         |
| `spans`                    | 直前 100 行に出た span（新しい順に 8 つ、`parentId` と最後のイベント）                                                                                                                            |
| `state`                    | main.ts が渡す読み取り（`setDiagnosticsState`）：mode・state・緯度経度・ゲーム内時刻・時刻と天気のモード・画質のプリセット・描画方式・進行中の span（追跡・停止・移動）。読めないものは抜けるだけ |
| `recent`                   | 直前 30 行の `{ts, level, event, spanId}`                                                                                                                                                         |
| `suppressed`               | 同じ source と文が 5 秒以内に繰り返した回数（毎フレームの失敗で 60 行/秒にしない）                                                                                                                |

# 再現（session_start・drive_started・?seed=）

- 最初のスクリプト（`index.html` の `src/diagnosticsBoot.ts`、boot.ts と main.ts より前）が `Math.random` を seed つきの mulberry32 に差し替える。seed は `?seed=` か、無ければその場で引いた値。どの読み込みも seed を持つので、一度見えた失敗をもう一度同じ乱数で読み込める。
- `session_start`: パス、URL のパラメータ、seed、`reproUrl`、ビルドのモード、言語、画面の大きさ。
- `drive_started`（スタートを押したとき）: その回の時刻と天気（乱数で決まる）、出発地、操作モード、画質、`reproUrl`（`?seed=&start=<緯度>,<経度>&time=<morning|day|evening|night>&weather=<rain|clear>`）。main.ts は `?time=` と `?weather=`（real / auto / clear / rain）があればそれで始める。
- 限り: 再現 URL の天気は始まったときの晴れ・雨を固定で渡す（おまかせの移り変わりは起きない）。読み込みの順や時間で呼ばれる回数が変わる乱数（交通の湧き方など）、フレームの時間、物理は同じにならない。seed より前に評価されるモジュールの最上位で `Math.random` を使うと seed が効かない（今は無い）。

# 端末から読む（just logs*）

`scripts/logs.ts`（tsx）が 1 イベント 1 行の短い形で出す：`04:18:00.123 W road_tile_failed key=14/1/2 error="…"`（時刻・レベル I/W/E・イベント・`span<parent`・`key=value`。長い値は 120 字で切る）。セッションはファイルのパスか traceId で指定し、省けば latest。

| レシピ                               | すること                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `just logs [n]`                      | 最新のセッションの末尾 n 行（既定 40）                                                                                                  |
| `just logs-follow`                   | 追いかけて出し続ける。再読み込みで新しいセッションに移る                                                                                |
| `just logs-errors [session]`         | warn・error だけ。`uncaught_error` は下に発生箇所（TypeScript の行）・span・状態・直前の行                                              |
| `just logs-trace <spanId> [session]` | その span と、そこから起きた span 全部                                                                                                  |
| `just logs-since [minutes]`          | 直近の全セッションの行を時刻順に                                                                                                        |
| `just logs-compare [before] [after]` | 2 つのセッションの warn・error の数（既定は 1 つ前と最新）。`gone` / `fewer` / `same` / `more` / `new` と最後に `uncaught_error 2 -> 0` |
| `just logs-repro [session]`          | そのセッションを同じように読み込む URL                                                                                                  |
| `just logs-files [n]`                | セッションの一覧（時刻・行数・warn・error・build）                                                                                      |

# AI のデバッグループ

1. `just dev` を動かしたまま、ゲームを開いて（人か、`scripts/qa/drive.mjs` が）問題を起こす。行は勝手に `.qa/logs/` に溜まる。
2. `just logs-errors` で失敗を見つける。`at=src/…:行` が投げた所、`spans` が何の途中だったか、`before` が直前の流れ。
3. `just logs-trace <spanId>`（例: `vio-…`、`pursuit-2`）でその仕事の始まりから全部を読む。`build` でどのコードの行かを確かめる（`+` 付きは未コミットの変更つき）。
4. コードを直す。
5. `just logs-repro` の URL を開き直す（同じ seed・出発地・時刻・天気）。新しいセッションのファイルができる。
6. `just logs-compare` で前のセッションと比べ、その `uncaught_error` が `gone` になり、新しい warn・error が増えていないことを確かめる。`just logs-files` の build が直した後のハッシュに変わっていることも見る。

# 移行で直したこと（旧名との対応）

2026-10-05 の移行前は、イベント名が 120、呼び出しが 121 か所あり、src/ は `log.ts` の 2 関数、scripts/ は 5 本がそれぞれ自前の `console.log`（traceId も level も無い）だった。[^inventory] 見つけた食い違いと直し方:

- 下位の種別を `event` フィールドで持っていた `police`・`social`・`pursuit`・`taxi` は、その `event` が行のイベント名を上書きしていた（`{"event":"ticket",…}` のように元の名前が消える）。名前を分けた。
- `water-levels.ts` の `stations` の `level`（水位観測所の数）が行の `level` を上書きしていた → `water_stations` の `levelStations`。
- `written` が 3 本のスクリプトで別の形 → `guide_signs_written`・`destinations_written`・`water_levels_written`。
- `closure_area_implausible` がゲーム（warn）とスクリプト（info、別の形）で同じ名前 → スクリプトは `jartic_closure_skipped`（warn、`reason` 付き）。
- 単位の書き方がばらばら（`metres`・`ms`・`kmh`・`km`・`seconds`・`limit`・`ageHours`・`rssMB`）→ 接尾辞の規約に統一。`frame_recentered` の緯度経度が文字列だった → 数。
- 失敗の文が `error`・`message` の 2 通り、ファイル名が `name` → `error`・`file`。

| 旧                                                                                                                             | 新                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `violation`                                                                                                                    | `violation_booked`（`total`→`totalPoints`、`kmh`→`speedKmh`、`limit`→`limitKmh`、`violationId` を追加）                                                                                                                             |
| `social` `{event:"filmed"/"post"/"reported"/"praise"/"video"/"stopPost"}`                                                      | `social_filmed` / `social_post` / `social_reported` / `social_praise` / `social_video_played` / `social_stop_post`（`post`→`postId`、`view`→`camera`）                                                                              |
| `police` `{event:"pursuit"/"ticket"/"lost"}`（main）                                                                           | `patrol_pursuit` / `patrol_ticket` / `patrol_lost`                                                                                                                                                                                  |
| `police` `{event:"ticket"}`（pursuitDirector）                                                                                 | `stop_ticket`                                                                                                                                                                                                                       |
| `pursuit` `{event:"begin"/"dangerousInjury"/"unitHit"/"overlap"/"fleeing"/"stage"/"checkpoint"/"end"/"criminal"/"identified"}` | `pursuit_begin` / `pursuit_dangerous_injury` / `pursuit_unit_hit` / `pursuit_overlap` / `pursuit_fleeing` / `pursuit_stage` / `pursuit_checkpoint`（`metres`→`aheadM`） / `pursuit_end` / `pursuit_criminal` / `pursuit_identified` |
| `pursuit` `{event:"stop"}`・`{event:"story"}`                                                                                  | `stop_begin`・`story_begin`                                                                                                                                                                                                         |
| `autopilot` `{on:true}`・`{on:false}`・`{gaveUp}`                                                                              | `autopilot_on`（`metres`→`routeM`）・`autopilot_off`・`autopilot_gave_up`（`why`）                                                                                                                                                  |
| `taxi` `{event:"no_route"}`・`taxi_ride`                                                                                       | `taxi_no_route`・`taxi_ride`（`fareYen`、`distanceM`、`slowS`）                                                                                                                                                                     |
| `warp`                                                                                                                         | `warp_start` + `warp_landed`（`ms`→`durationMs`）                                                                                                                                                                                   |
| `orbis`                                                                                                                        | `orbis_fired`（`id`→`siteId`、`violationId`）                                                                                                                                                                                       |
| `orbis_placed`                                                                                                                 | 同名（`id`→`siteId`、`limit`→`limitKmh`、`bearing`→`bearingDeg`）                                                                                                                                                                   |
| `lane_direction`                                                                                                               | `lane_turn_disallowed`                                                                                                                                                                                                              |
| `trip`・`destination`・`title`・`controls`・`renderer`・`road_network`・`pavements`・`guide_signs`・`street_lights`・`perf`    | `trip_started`・`destination_set`・`title_reload`・`controls_changed`・`renderer_ready`・`road_network_built`・`pavements_built`・`guide_signs_placed`・`street_lights_placed`・`perf_phase`                                        |
| `day_end`・`sanction`・`accident`・`poi_collected`・`pipelines_compiled`                                                       | 同名（`metres`→`distanceM`、`days`→`suspendedDays`、`kmh`→`speedKmh`、`id`→`poiId`、`ms`→`durationMs`）                                                                                                                             |
| `fatal`（warn）                                                                                                                | `uncaught_error`（error、`source: "fatal"`。スタックと文脈つき）                                                                                                                                                                    |
| `stations`・`written`（scripts）・`cache_hit`・`geoid_written`                                                                 | `water_stations`・上の 3 つ・`cache_hit`（`ageH`）・`geoid_written`（`minM`、`maxM`）                                                                                                                                               |

新しく足した行: `violation_cited`・`violation_noticed`（`TrafficLaw.cite` / `notice` / `deliverNotices`。検挙・通知の経路が 1 か所に集まる）、`replay_clip_saved`、`stop_end`、`warp_start`、`log_schema_invalid`、`session_start`、`drive_started`、`uncaught_error`、`log_ship_dropped`。

# 残り

- ブラウザでの確認（作業でブラウザを使わなかった）：ページからの送信・`sendBeacon`・`window` の `error` の捕捉・`__game.debug.logs`。受け口と source map は開発サーバーを Node から叩いて確かめた。[^devserver]
- `scripts/qa/drive.mjs` は開発サーバーのページを走らせるので、その回の行も `.qa/logs/` に溜まる。`.qa/runs/<時刻>/` の記録から traceId で結ぶ印はまだ付けていない。
- 自動運転（`autopilot_*`）とタクシー（`taxi_*`）には span を付けていない。続けて起きる行が 2〜3 本で、時刻順で足りると判断した。

[^code]: ロガーとイベントの登録

[^tests]: 振る舞いのテスト

[^inventory]: 呼び出しの棚卸し

[^smoke]: tsx と本番ビルドでの確認

[^devserver]: 開発サーバーの受け口の確認

[^loop-tests]: デバッグループの部品のテスト
