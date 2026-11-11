---
type: Decision
title: 道路標識・信号機 作成システムの方針（ADR、G・T・Q の段階計画）
description: 標識の定義を TS（zod）の単一ソース src/signs/defs に寄せ JSON で Python・Blender へ橋渡しする（案 B）、案内標識のレイアウタ、支柱・取付、信号灯器の宣言と施行令第3条の 3 層テスト、現示表と違反判定の整合、夜間・性能、多視点レビュー、段階計画 G1a〜G4・T1〜T4・Q1 と Why not。2026-11-10 の設計書を取り込み、進捗を冒頭に追記した。
tags: [roads, traffic-law, assets, rendering, testing]
status: draft
stale_after: 2027-05-01T00:00:00Z
generated: { by: claude-fable/design, at: 2026-11-10T09:00:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-11-10T14:30:00Z }
sources:
  - id: original
    resource: 依頼元の scratchpad の sign-signal-system.md（2026-11-10 作成、この文書の本文はその写し。scratchpad はリポジトリ外で消えるため取り込んだ）
    title: 設計書の原本
  - id: progress
    resource: knowledge/sign-system.md（G1a〜G1c）、knowledge/signal-system.md（T1・T2）
    title: 実装の記録
---

# 状況（2026-11-10 追記）

本文は設計時点の写しで、訂正は各段の記録にある。[^progress]

- **完了**: G1a（defs と catalog.json のバイト一致）・G1b（Pillow が registry を読む、PNG 346 枚のバイト一致）・G1c（ゲームの対応をレジストリへ）は [標識システム](sign-system.md)、T1（灯器の宣言と第3条テスト）・T2（現示表・permits・右折矢印）は [信号システム](signal-system.md)。
- 都市高速の表示名は架空の「都市高速」（[道路再設計の方針](road-redesign-plan.md)）。
- 未着手: G2〜G4、Q1、T3・T4。

作成 2026-11-10。対象 `tokyo-od-game`。コードは書かない（実装は Opus が段階的に行う）。道路再設計（[道路再設計の方針](road-redesign-plan.md) 4.8・8 章 P5）と対で読む。

## 0. 委譲・モード・要確認

- **委譲**: 実装 = develop-expert（Opus）。視点別の回帰・負荷シナリオの具体化 = qa-expert。都市高速の路線記号の枠形・事業者表記の可否 = legal-expert。
- **モード**: リファクタリング（主: 単一ソース化）＋新規設計（支柱・都市高速の板・信号の現示）＋非機能策定（従）。
- **要確認（仮置きで先行）**
  1. 都市高速の路線記号（C1 等）の枠の形。別表第二の図（scratchpad `egov/img`）に描かれた形だけを使い、事業者独自の盾形は描かない前提。
  2. 信号機の構造（灯器の径・取付高さ）の一次情報。道路交通法施行規則の取得が空だった（scratchpad `egov/335M50000800070.json` は 60 バイト。法令 ID を法令名検索で取り直す）。確かめるまで現行値（φ300、5.2 m）を変えない。
  3. three r186 の WebGPU 側で配列テクスチャの層だけを更新できるか（5 章。PoC で決める）。

## 1. コンテキスト（確かめた現状）

- 標識の定義が 4 か所に割れている: `scripts/textures/signs/law_table.py`（番号・名称・図）、`signs/catalog.py`（`Meta`/`Tex`、板と寸法）→ `assets/signs/catalog.json`、`src/world/signs.ts:98-131` の `BY_ID` と `design()` の switch、`src/world/regulations.ts:63-94` の `SIGN`。
- 図柄は Pillow の手続き（`pictos.py` 697 行ほか）で、別表第二と目視照合済みの 346 枚。これは資産であり描き直さない。
- 板は `signs.glb` のノード名で引く。寸法は Python（図柄）と Blender（板）に二重にある。信号も `LAMP_GAP = 0.37` が `signals.py:31` と `signalModels.ts:18` に二重。
- 描画は WebGPURenderer（`src/render/renderer.ts`）。標識は図柄ごとに `MeshStandardMaterial`（`signs.ts:205-225`）で、材質数 = 図柄数。`RoadInstances` の注記どおり、node builder のキャッシュは InstancedMesh 単位なので、材質が増えるほどパイプラインの組み立てが増える。
- 信号は `lightState(seconds, offset, axis)` の 2 現示固定。信号無視は `main.ts:2828-2829` が「停止線を越えた時に `state(ap) === "red"`」で記録する。矢印を足すとこの式が誤りになる。
- `public/data/signals/*.json` は `[lon, lat]` だけで、OSM のタグを捨てている（`scripts/regulations.ts:416-418`）。
- `SCALE = 1.25` は規制・指示（2 倍〜1/2）では令の範囲内。警戒は 1.3・1.6・2 倍の段階指定（備考、e-Gov で確認）なので 1.25 は令の値でない。

## 2. 単一ソースの置き場所（案の比較）

| 観点                                                  | A Python を正   | B TS（zod）を正、JSON を橋渡し  | C YAML を正           | D 図柄も TS/SVG へ全面移行 |
| ----------------------------------------------------- | --------------- | ------------------------------- | --------------------- | -------------------------- |
| ゲームからの型付き参照                                | ×（生成物越し） | ◎（import するだけ）            | △（生成か実行時解析） | ◎                          |
| 既存 346 枚の保全                                     | ◎               | ◎（描画関数は名前で参照）       | ◎                     | ×（描き直しと再照合）      |
| 可変・派生の表現（速度の値、車線 166 通り、補助の組） | ○               | ◎（関数で展開、参照を型で検査） | △                     | ◎                          |
| Blender から読める                                    | ○               | ◎（標準 json）                  | ×（PyYAML が無い）    | ◎                          |
| 実装量                                                | ◎               | ○                               | ○                     | ×                          |
| 可逆性                                                | —               | Type 2                          | Type 2                | Type 1 に近い              |

**推奨: B。** `src/signs/defs/*.ts` を唯一の定義とし、`scripts/signs.ts`（tsx）が `assets/signs/registry.json` を書く。Pillow と Blender はそれを読むだけにする。

- A を棄却: 割れている原因が「TS が Python を import できない」ことなので、Python を正にしても `SIGN`・`BY_ID` は生成物越しになり、型で守れない。
- C を棄却: 速度の値や車線パターンの展開、補助標識の参照の検査にコードが要る。Blender 同梱の Python は YAML を読めない。
- D を棄却: 目視照合済みの図柄を捨てる。ブラウザの Canvas は字形の計測が環境で揺れ、決定的でない。

**宣言と手続きの境界**: 固定のピクトグラムは「描画関数の名前」で参照し、引数のあるもの（数値・文言・車線・補助標識の文字）だけを宣言的なブロックにする。全部を宣言にしない。

### 2.1 スキーマ案（`src/signs/schema.ts`、要点）

```ts
const Scale = z.union([
  z.object({ range: z.tuple([z.number(), z.number()]) }), // 規制・指示 0.5〜2
  z.object({ steps: z.array(z.number()) }),
]); // 警戒 1/1.3/1.6/2、高速 2・2.5
const Block = z.discriminatedUnion("t", [
  // 文字ブロック・記号
  z.object({ t: z.literal("symbol"), name: z.string(), color: Color }),
  z.object({ t: z.literal("text"), text: z.string(), h_mm: z.number(), color: Color }),
  z.object({ t: z.literal("arg"), arg: z.string(), h_mm: z.number(), color: Color }),
  z.object({ t: z.literal("arrow"), dir: Dir, color: Color }),
]);
const Art = z.discriminatedUnion("by", [
  z.object({ by: z.literal("painter"), fn: z.string(), args: z.record(z.string(), z.unknown()) }), // Pillow
  z.object({ by: z.literal("blocks"), face: FaceTemplate, blocks: z.array(Block) }), // Pillow
  z.object({ by: z.literal("board"), template: BoardTemplate }), // 実行時 Canvas
  z.object({ by: z.literal("none"), reason: z.string() }),
]);
const SignDef = z.object({
  id: z.string(), // 別表第一の番号。法定外は x-
  group: Group,
  name: z.string(),
  plate: z.string(), // plates 表のキー = signs.glb のノード名
  colors: z.object({ ground: Color, rim: Color, rimLine: Color.optional(), frame: Color.optional() }),
  scale: Scale,
  displayScale: z.number(), // 許容範囲と、ゲームが使う値
  args: z.record(z.string(), ArgSpec).default({}),
  art: Art,
  variants: z.array(z.object({ key: z.string(), args: z.unknown(), file: z.string() })), // 描画済みの組
  aux: z.array(z.object({ when: z.string(), ids: z.array(z.string()) })).default([]), // 補助標識の組
  shares: z.string().optional(), // 板を共有する番号（305の2 → 305 + 補助）
  mount: z.object({
    supports: z.array(SupportKind),
    facing: z.enum(["perpendicular", "parallel"]),
    bothFaces: z.boolean(),
  }),
  game: z.object({ kind: z.string(), check: z.string().optional() }).optional(),
  retro: z.enum(["sheet", "internal", "none"]),
  law: z.object({ figure: z.string(), notes: z.array(z.string()) }),
  legacy: z.array(z.string()).default([]),
}); // 旧ファイル名・旧キー
```

`plates`（ノード名・輪郭・外接矩形・角 R）と `palette`（色票）も同じレジストリに持つ。逆三角の外接矩形 80 × 69.3 cm、`flipY = false`、「UV 0–1 が外接矩形を覆う」の規約は `plates` の不変条件としてテストに書く。

### 2.2 生成物

| 生成物                        | 作る側                                | 備考                                                                            |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `assets/signs/law-table.json` | e-Gov から取得（版 ID つき）          | `law_table.py` を置換。レジストリの外にある「正解の番号表」                     |
| `assets/signs/registry.json`  | `scripts/signs.ts`                    | Pillow・Blender の入力。古ければテストで落ちる                                  |
| PNG とシート                  | `sign_textures.py`（registry を読む） | 描画関数は `@painter("regulatory.speed_sign")` で登録                           |
| `signs.glb` の板              | `signs.py`（`plates` を読む）         | 既存ノード名を固定                                                              |
| `assets/signs/catalog.json`   | `scripts/signs.ts`                    | 当面は同じ形で出し続け、利用側（`coverage.ts`、管理画面）を移してから消す       |
| ゲームの対応表                | レジストリの `game`                   | `BY_ID`・`design()` の switch を置換。`SIGN` は残し、全種が解決することをテスト |
| 台帳                          | 手で 1 件ずつ（glob のまま）          | `generator`・`used_by` を更新するだけ                                           |

**カバレッジテスト**（`tests/signRegistry.test.ts`）: 番号集合が law-table と一致／各定義が図柄か理由を持つ／描画済みの組に PNG とシートの升がある／`plate` が plates に、plates が glb にある／`aux`・`shares` の参照先が存在／`displayScale` が `scale` の内／`game.kind` が全 `SIGN` を覆う／`legacy` が一意。加えて「図柄あり・未配置」（324・325 など）を `just show-sign-coverage` で一覧にする（落とさない。配置規則が増えるたびに減る数として見る）。

### 2.3 互換と移行

1. **G1a**: `catalog.json` から定義を機械変換して `defs/` を作る。`scripts/signs.ts` が出す `catalog.json` が**バイト一致**することを受け入れ条件にする（無損失の証明）。
2. **G1b**: Pillow が registry を読む。`Meta`/`Tex`/`meta_for` を削除。受け入れ条件は PNG 346 枚がバイト一致（Pillow の版は PEP 723 で固定）。
3. **G1c**: `signs.ts` の対応をレジストリへ。311 は `311-A〜F` を正とし `turn_N` は `legacy` に残す。
4. 旧ファイル名（`speed_40.png` 等）は `variants[].file` にそのまま書くので改名は不要。シート化（5 章）の後は実行時がファイル名を見なくなるので、改名は 1 回の機械的な PR にできる（任意）。
5. `PlateCircle`・`PlateTriangle`・`PlateSquare`・`PlateWide`・`PlateRect`・`Post`・`Bracket` ほか既存ノード名は固定。拡大は新ノードを作らず、インスタンスの行列で行う。

## 3. 案内標識のレイアウタ

`guideArt.ts` を「内容 → 箱の木（cm）→ 描画」の 3 段に分け、`src/signs/board/` に置く（three.js・DOM 非依存は layout まで。Canvas は draw だけ）。

- **内容** `BoardContent`（zod）: 方面（日本字・英字）、矢印、路線（国道・都道・都市高速の路線記号）、距離、出口名・出口番号、車線。道路再設計のタイル（4.3 の「標識の設置点」）がこの型で書き、両側で同じスキーマを検査する。
- **テンプレート**

| テンプレート         | 番号                                | 構成                                                                                 |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `junction-diagram`   | 108-A/B、108の2-A/B、108の3、108の4 | 既存。矢印の図に地名・番号・通称名の箱                                               |
| `rows`               | 105-A〜C、106-A〜C                  | 行ごとに方面＋矢印（＋距離）                                                         |
| `lane-columns`       | 107-A/B、111-B                      | 車線ごとの下向き矢印の上に方面                                                       |
| `expressway-diagram` | 108の2-C〜E                         | 緑地の分岐図、路線記号                                                               |
| `exit`               | 110-B、112-B、113-A/B               | 方面＋出口名、出口番号の白地緑字の札、距離か矢印                                     |
| `entrance`           | 103-A/B、104                        | 上段 白地緑字（事業者の表示名・路線記号・入口名）、下段 緑地白字（方面・矢印・距離） |
| `point-name`         | 114の2（交差点名）                  | 信号のアームの板。`trafficControl.ts` から移す                                       |

116の4・116の6・117-B は定型の図柄なので Pillow 側（`art.by = "painter"`）に入れる。

- **規則**（値は `src/law/signStandards.ts` に出典つき。`roadStandards.ts` と同じ規約）
  - 文字高: 設計速度 70 以上 30 cm、40〜60 で 20 cm、30 以下 10 cm。拡大は 1.5・2・2.5・3 倍の段階だけ。ローマ字は 1/2。108の3・108の4 の矢印の中は 0.6 倍。
  - 横伸縮: 高速道路等の板は、最長の地名の幅＋余白から横寸法を決める（全体は図示の 3 倍まで）。一般道の 108 系は標準の板に収め、収まらなければ字を横 70 % まで詰める（現行どおり）。
  - 色: 一般道は青地白字。高速道路等は緑地白字、出口番号は白地緑字、ETC は紫。箱の中の色は備考のとおり。
  - 都市高速の文字高は「20 cm の 1.5 倍 = 30 cm」を仮置き（仮定、実物未確認）。
- **設置規則**（宣言。`{番号, 起点, 距離の範囲と候補, 位置, 支柱}`）: 110-B は出口の手前 100〜600 m、111-B は 100〜500 m で車線上方、112-B は 300 m 以内、113 は分岐のノーズ、108 系は現行（交差点 150 m 以内・予告 300 m 以内）、105 は交差点の手前 30 m 以内。103・104 は別表第一に距離の数値が無く、位置は「左側の路端」（103 は交差点の正面の路端も可）なので、路側式で立て、距離は仮定として持つ。都市高速の設置点は**ビルド時**に距離程から決め（road-redesign 4.3）、一般道は現行どおり実行時の `guidePlan.ts`。どちらも同じ `PlacedBoard` を出し、描画は 1 つにする。
- **予算の共有**: Canvas で描く面（一般道の案内・都市高速・交差点名・文字の補助標識）は 1 つの `BoardFacePool` を共有する。上限は現行と同じ「512 px 相当 32 面」。優先度は「見かけの大きさ × 正対の度合い」で、自車と層（`level`）の違う板は最後に回す。1 フレームの描画枚数は固定の 3 枚ではなく `FrameWork` の 4 ms で打ち切る。

## 4. 支柱・取付

`SupportKind` と寸法を宣言し、純粋関数 `resolveMount(placement, context) → 部材[]`（`src/signs/mount.ts`）が部材の配置を返す。

| 種別            | 用途                                     | 板の下端                           |
| --------------- | ---------------------------------------- | ---------------------------------- |
| `single-post`   | 規制・警戒・指示（最大 3 枚＋補助）      | 路側 1.8 m 標準、歩道上 2.5 m 以上 |
| `double-post`   | 路側式の案内・大きい板                   | 同上                               |
| `cantilever-f`  | 片持式（既存）                           | 5.0 m 標準、4.7 m 以上             |
| `gantry`        | 門型（多車線・都市高速の本線）           | 同上                               |
| `barrier-mount` | 壁高欄への添架（都市高速の規制・案内）   | 路肩上、建築限界 4.5 m の外        |
| `girder-mount`  | 桁・歩道橋・跨道橋への添架               | 桁下に収める                       |
| `signal-share`  | 信号柱・アームへの共架（交差点名、規制） | 灯器と重ならない                   |

- 検査（`tests/signMount.test.ts`）: 車道上の板の下端 ≥ 4.7 m、柱・脚が車道と路肩の内に無い、門型の脚が壁高欄の外、片持の傾き 3°、同じ柱の板どうしが重ならない。
- Blender: `scripts/blender/sign_supports.py` → `sign_supports.glb`。**単位長の部材**（柱、腕、門型の梁は 1 m のトラス 1 節、フランジ、添架金具、共架バンド）を出し、ゲームが伸ばすか並べる（`SignalPole` と同じ考え）。梁を伸ばすとトラスの斜材が歪むので、節を並べる。既存の `signs.glb` の `Post`・`Bracket` と `guide_signs.glb` は残し、後で寄せる。
- 部材の径・肉厚・トラスの寸法は仮定として `verified: false` で持つ（road-redesign 3.4 の `assumptions.ts` と同じ扱い）。
- `hasRoadside` が false の区間（都市高速）には `single-post` を立てない。

## 5. 信号機

### 5.1 灯器と取付の宣言（`src/signals/`）

- `SignalHeadDef`: 向き（横・縦）、灯の並び、レンズ径（300・250）、矢印灯（左・直進・右の組、主灯の下段）、庇。種類は 横 3 灯、縦 3 灯、歩行者 2 灯、1 灯の点滅専用、押ボタン箱。取付は アーム、柱直付け、歩道橋添架、`signal-share`。
- 灯の位置は `lampLayout(def)` の 1 関数から出し、registry.json 経由で Blender と実行時の両方が使う（`LAMP_GAP` の二重定義を消す）。既存ノード名（`SignalHead`・`SignalLamp`・`PedHead`・`PedLamp`・`SignalPole`・`SignalArm`）は固定し、縦型・矢印段・点滅灯・押ボタン箱を足す。
- 250 mm は二次情報なので型だけ用意し、既定では使わない。黄の矢印（路面電車用）は範囲外。

### 5.2 施行令第3条をテストで保証（3 層）

1. **定義**: 横型は対面して右から赤・黄・青、縦型は上から赤・黄・青。2 灯は右（上）が赤。スキーマの検査で落とす。
2. **モデル**: `signals.glb` の灯の位置を読み、灯器が +Z を向く規約で「赤の x が最大（縦は y が最大）」を検査する。
3. **画面**: 収束ループ（7 章）で、各現示の画面から点灯している灯の重心を取り、赤が右（上）にあることを確かめる。

- 順序（第3条第2項）: 現示表を 1 周たどり、青→黄→赤、歩行者は青→点滅→赤の順しか現れないことを性質テストにする。

### 5.3 現示表

```ts
const Step = z.object({
  s: z.number(),
  main: z.record(GroupId, z.enum(["G", "Y", "R", "FY", "FR", "off"])),
  arrows: z.record(GroupId, z.array(z.enum(["left", "through", "right"]))).default({}),
  ped: z.record(GroupId, z.enum(["go", "flash", "stop"])).default({}),
});
const SignalPlan = z.object({
  template: z.string(),
  steps: z.array(Step),
  source: z.enum(["osm", "inferred", "default"]),
});
```

- テンプレート（純粋関数）: `twoPhase`（現行と同じ秒数）、`rightArrow`（青→黄→赤＋右矢印→黄→赤）、`pedSeparated`（歩車分離・スクランブル）、`leadLag`（時差式）、`nightFlash`（主道路 黄点滅・従道路 赤点滅）、`pedButton`（単路の押ボタン式）。
- 安全の性質テスト: 交錯する流れが同時に進行可にならない、黄 ≥ 3 s、切り替えに全赤がある、矢印は主灯が赤か黄の間だけ、歩行者の青の前後で車両が交錯しない。
- `twoPhase` は現行の `lightState` と 1 周ぶん一致することをテストで固定してから差し替える（挙動不変）。

**データの決め方**（上から順に採用。根拠を `source` に残す）

| 段           | 根拠                                                                                                                                           | 決まること                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| OSM タグ     | `traffic_signals=*`、`traffic_signals:direction`、`button_operated`、`crossing=traffic_signals`、`traffic_signals:sound` など                  | 点滅・押ボタン・歩行者専用・音響式・向き |
| 形からの推定 | 右折専用車線（`public/data/turnlanes` の OSM 由来）があり対向が 2 車線以上 → 右折矢印。交差点から 25 m 以内に節点が無い信号 → 単路の歩行者用。 | 右折矢印、単路                           |
| 許可リスト   | 出典つきの手書き（著名なスクランブル交差点）                                                                                                   | 歩車分離                                 |
| 既定         | `twoPhase`                                                                                                                                     | 何も分からない所は今のまま               |

23 区でのタグの付き具合は未計測（`.cache/osm` が無く集計できなかった）。**T3 は集計から始め**、件数の少ないタグは規則にしない。夜間点滅は実態のデータが無いので既定で無効にする。

### 5.4 違反判定との整合

- 判定の窓口を 1 つにする: `permits(step, group, movement)`（施行令第2条の表の写し。movement = 左折・直進・右折）。自車の違反、自動運転、交通 AI、ナビ、HUD、歩行者がすべてここを通る。既存の `state(ap)` は「直進の可否」を返す互換の殻として残し、呼び出し側を順に移す。
- 信号無視: 赤で矢印が無ければ従来どおり停止線で記録する。矢印が出ている間に停止線を越えたら**保留**し、交差点を出た腕（`turn-paths` の左・直進・右の分類）が矢印に含まれなければ記録する。
- 赤の点滅は一時停止の判定（既存の `kind: "stop"`）に載せる。違反名と点数・反則金は e-Gov で確かめてから入れる（knowledge/road-traffic-law.md の方針）。右折矢印での転回の可否も未確認（取得済みの第2条の抜粋に記載が見つからない）。

## 6. 夜間・性能

- **材質を 1 つに**: `SignFaceMaterial`（TSL の node material）。図柄は配列テクスチャの層で持ち、インスタンス属性 `faceLayer` で選ぶ。板の形ごとに InstancedMesh 1 つ（描画呼び出しは図柄数ではなく板の形の数になる）。
  - 小さい板: 256 × 256 × 128 層（mip 込み約 45 MB）。配置された図柄だけを層に載せ、LRU で入れ替える。既存の「外接矩形を非等方に縮めて UV 0–1」の規約がそのまま層に乗る。
  - 大きい板と Canvas の面: 512 × 512 × 32 層（現行の案内標識の上限と同じ）。
  - 元画像はビルド時に 4096 px のシート数枚へ詰め、実行時は必要な升だけを層へ写す（1 フレーム 2 層まで）。
  - **アトラスにしない理由**: 升の境界で mip がにじみ、余白と UV の作り直しが要る。ただし属性の形（層か矩形か）は同じなので、3 の PoC が通らなければアトラスへ切り替えられる（Type 2）。
  - 256 で足りるかは 7 章の数値（10 m で文字が読める）で決め、足りなければ画質設定の「高」だけ 512 にする。
- **再帰反射の近似**: 反射シートは光源へ返す。自車の前照灯だけを光源にし、次の積を emissive に足す。
  - 配光（車の前方ベクトルとの角度、ロービーム・ハイビーム）× 距離の逆 2 乗（近距離で頭打ち）× 入射角（板の法線）× **観測角**（前照灯→板と板→カメラのなす角。小さいほど明るい）× 色ごとの係数 × 濡れによる低下。
  - 観測角を入れるので、通行人の写真やミラーのカメラでは自然に光らない。黒は図柄の色に掛けるので光らない。現行の一律 0.18 は、街灯の明るさに連動する小さな下駄へ置き換える。
  - 係数（色別、観測角の幅、濡れ 0.6）は仮定。`retro: "internal"`（内照式）は一定の発光。実ライトは足さない（knowledge/street-lighting-and-wet-roads.md と同じ理由）。
- **信号の灯**: レンズの図柄（丸・矢印・人形）も層で持ち、灯は 1 つの InstancedMesh にして色と層をインスタンスで切り替える。点滅は範囲内の制御機だけ更新する。
- **目標**（先に現状を `perf-fixed-scene` で測り、基準にする）

| 項目                     | 目標                                                  |
| ------------------------ | ----------------------------------------------------- |
| 標識・信号の描画呼び出し | 板の形の数＋支柱の部材数（図柄数に比例しない）        |
| 面のテクスチャ           | 合計 96 MB 以下                                       |
| 生成・層の更新・Canvas   | 1 スライス 4 ms 以下（`FrameWork`）                   |
| 最長フレーム             | 通常更新 50 ms 以下を維持、初出の図柄でのカクつき無し |

## 7. 多視点レビューの収束ループ

- **Blender の単体レンダ** `scripts/blender/sign_review.py`: 標識 1 種ごとに、板＋支柱＋図柄を 正面・斜め 30°・60°、運転席の高さ 1.2 m から 10・30・60 m で描き `.qa/signs/<番号>/` に置く。ゲームのシェーダーと切り離して「形・UV・寸法・取付」を見る。信号は灯器の種類 × 現示。
- **ヘッドレス Chrome**: 開発用の「標識の見本道路」（直線の試験道路に、レジストリの標識を標準の取付で並べる）と実地の視点表。road-redesign 7 章の `scripts/qa/views.mjs` と `window.__game.debug.camera` を共用し、視点表だけ `scripts/qa/sign-views.json` に分ける。昼／夜ロービーム／夜ハイビーム／雨の夜、信号は現示表の全ステップ。
- **各コマに添える JSON**: 番号、別表第二の図の URL、標準寸法と倍率、色、板の下端の高さ、距離、期待する点灯。図は `.cache` に置きコミットしない。
- **数値の探り**: 30・60 m での文字高の画素数、夜 30 m の板の平均輝度が範囲内で白飛びしない、地の色の色差、板の下端の高さ、点灯している灯の位置（5.2 の 3）、最長フレーム。
- **判定観点**: 様式（形・色・縁・縁線・記号・文字の配置を別表第二の図と照合）／寸法と倍率／取付（高さ・向き・一方通行の平行・補助標識の順）／可読性／夜と雨／信号の配列と順序／性能。観点ごとに別のレビュー担当を並列に回し、指摘は `.qa/reviews/signs/<周>.jsonl`。直したら回帰テストかチェック項目を足す。
- **収束**: Critical・Warning の新規指摘が **2 周続けて 0**、かつ数値の閾値を満たす。6 周で収束しなければ設計へ差し戻す。結果は knowledge に OKF で残す。`asset-review`・`road-qa` スキルに節を足す。

## 8. 段階計画（独立にマージできる PR）

| #   | 範囲                                                                                          | 見える価値               | 受け入れ条件                 | 依存            |
| --- | --------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------- | --------------- |
| G1a | スキーマ・`defs/`・law-table.json・`scripts/signs.ts`・カバレッジテスト・`show-sign-coverage` | 未配置・未描画の一覧     | catalog.json がバイト一致    | —               |
| G1b | Pillow が registry を読む                                                                     | —                        | PNG 346 枚がバイト一致       | G1a             |
| G1c | ゲームの対応をレジストリへ、311 の正式番号                                                    | —                        | 既存テスト、標識の本数が不変 | G1a             |
| Q1  | `sign_review.py`、見本道路、視点表                                                            | レビューが回る           | 全描画済み番号のコマが出る   | G1a             |
| G2  | 板を plates から生成、補助標識を描画済み図柄へ、警戒 1.3 倍                                   | 補助標識が本物の様式に   | ノード名の互換、収束ループ   | G1c             |
| G3  | `SignFaceMaterial`（層・再帰反射）                                                            | 夜の標識が前照灯で光る   | 6 章の目標、PoC              | G1c             |
| G4  | 支柱と `resolveMount`（複柱・門型・添架・共架）                                               | 門型・添架               | `signMount` テスト           | G1c             |
| G5  | レイアウタの一般化、105・106、`BoardFacePool`                                                 | 確認標識                 | 既存 5 地点の配置が不変      | G3              |
| G6  | 都市高速の板と設置（= road-redesign P5）                                                      | 入口・出口・JCT の緑の板 | 設置距離、禁止語             | G4・G5、道路 P1 |
| T1  | 灯器の宣言、縦型・矢印段、第3条テスト                                                         | —                        | 挙動不変                     | —               |
| T2  | 現示表、`permits`、右折矢印、保留つき信号無視                                                 | 右折矢印                 | `twoPhase` 一致、性質テスト  | T1              |
| T3  | OSM タグの集計と抽出、単路の歩行者用・押ボタン                                                | 押ボタン式               | 集計を knowledge に記録      | T2              |
| T4  | 歩車分離・時差式・夜間点滅                                                                    | スクランブル             | 性質テスト                   | T2              |

標識（G）と信号（T）は並行できる。最初の PR は G1a と T1。

**道路再設計 P5 との関係**: P5 の中身は G6 に当たる。分担は次のとおり。

- 道路側: 設置点と内容（`BoardContent`）をタイルに書く、名称層 `src/game/roadNames.ts`、禁止語のテスト、`level`・`hasRoadside`。
- 本システム: スキーマ、板の描画、支柱、取付の検査、規制 323・325 の図柄と倍率。板の文字は必ず名称層を通す（事業者名を直書きしない）。
- 一般道側の入口案内（103・104）は地上に立つので、道路 P1 のメタ（入口の位置）だけあれば G5 の直後に先行できる。本線上の板は道路 P3（デッキ）の後に見える。

## 9. Why not・未確認・リスク

- **なぜピクトグラムを宣言にしないか**: 目視照合済みの折れ線を写し替える利得が無く、誤りを入れる。宣言にするのは引数のある部分だけ。
- **なぜ標識ごとに Blender モデルを作らないか**: 板は 20 余りの形で足り、図柄は層で替えられる。
- **なぜ実際の周期（100〜140 s）にしないか**: ゲームの流れのため（現行の方針）。秒数はテンプレートの引数に残す。
- **なぜ信号の現示をタグだけで決めないか**: タグの網羅が未計測で、無い所の既定が要る。
- **なぜ `SCALE` を消さないか**: ゲームの視野では実寸だと読めない。令の範囲内の値として番号ごとに持つ。
- **未確認**: 灯器の径 250 mm と取付高さ、都市高速の入口信号・可変速度標識、路線記号の枠形、都市高速の実際の文字高、再帰反射の係数（JIS）、補助標識の拡大の規則、103・104 の実務上の設置距離、点滅の周期、夜間点滅の運用、右折矢印での転回、赤点滅の違反名と点数、OSM タグの網羅、配列テクスチャの層更新。
- **リスク**: 層の LRU が足りず図柄が抜ける（不足を記録するイベントを `logEvents.ts` に登録）、保留つき判定で記録が遅れる・漏れる（交差点内で止まった場合）、門型と PLATEAU 建物・高架の貫通（視点レビューで検出）、Pillow の版でバイト一致が崩れる（版固定）。

## 10. 帰結と判定

- 標識は「TS の定義 1 か所 → registry.json → 図柄・板・対応表・テスト」になり、追加は定義 1 件（＋固定の図柄なら描画関数 1 つ）で済む。信号は灯器と現示が宣言になり、配列と順序はテストで守られる。
- 後続: knowledge に `sign-system.md`・`signal-system.md` を追加（tag は `tags.yml` に登録）、`road-markings-and-signs.md`・`traffic-regulations.md` の該当節を訂正、AGENTS.md に「標識の追加手順」を追記、台帳と `credits.ts` を更新。
- **判定: 条件付き推奨。** 条件は (1) G1a・G1b のバイト一致が通ること、(2) G3 の PoC（層の更新と 6 章の目標）、(3) 信号機の構造の一次情報を取り直すまで灯器の寸法・高さを変えないこと。

[^progress]: 実装の記録
