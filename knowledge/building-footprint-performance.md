---
type: Metric
title: ランドマークから離れた建物の三角形走査を省く
description: 実2地域の近景・遠景48メッシュの最終173842944比較が一致。4回の除外CPU合計77.6→57.8ms、約26%減。別起動でも約29%減。夜雨の両ワープ66.7・66.6ms、実処理の8.8msの外れ値は残る。
tags: [plateau, terrain, rendering, physics, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T09:45:07Z }
verified:
  - {
      by: process:chrome154-final-48-real-meshes-173842944-values-four-source-and-528-binary-hashes-terminal-logs,
      at: 2026-10-06T09:45:07Z,
    }
  - { by: process:1119-tests-types-lint-format-build-just-actions-and-knowledge, at: 2026-10-06T09:14:29Z }
  - {
      by: process:chrome154-48-real-meshes-204228684-values-source-and-528-binary-hashes-terminal-logs,
      at: 2026-10-06T09:28:39Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-source-hashes-image-and-terminal-logs,
      at: 2026-10-06T09:31:08Z,
    }
  - {
      by: process:clock-mapped-two-warp-profiler-footprint-cpu-source-hashes-and-terminal-logs,
      at: 2026-10-06T09:34:45Z,
    }
  - { by: process:pending-cdp-close-rejection-and-owned-chrome-cleanup, at: 2026-10-06T09:25:54Z }
sources:
  - id: code
    resource: ../src/world/buildingFootprints.ts, ../src/world/buildings.ts, ../src/world/water.ts, ../src/main.ts
    title: 原点変更で輪郭範囲を更新し、Float32の範囲で三角形候補を絞る
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/88e0281ccc3b04b0fe65281423c950ebb595110b
    title: 各メッシュで輪郭範囲を作り、全三角形を走査する前段
  - id: component
    resource: ../scripts/qa/perf-building-footprints.mjs, ../.qa/perf/2026-10-06T09-42-18-688Z-building-footprints/report.json, ../.qa/perf/2026-10-06T09-25-53-123Z-building-footprints/report.json
    title: 実メッシュの数値照合と4回ずつ交互の除外CPU（ローカル保存）
  - id: inputs
    resource: ../.qa/perf/2026-10-06T09-42-18-688Z-building-footprints/, ../.qa/perf/2026-10-06T09-25-53-123Z-building-footprints/
    title: 実ECEF・元の全描画属性とindex・旧結果の528個のf64ファイル、全SHA-256を再検査（ローカル保存）
  - id: initial
    resource: ../.qa/perf/2026-10-06T09-14-42-411Z-building-footprints/, ../scripts/qa/browser.mjs
    title: 初回は巨大な一括応答でCDP接続を失い、待機だけ残ったため結果は不採用。分割保存と切断検出へ修正
  - id: normal
    resource: ../.qa/perf/2026-10-06T09-28-39-050Z-streaming/report.json, ../.qa/perf/2026-10-06T09-28-39-050Z-streaming/night-rain.png
    title: 診断ラッパーとProfilerなしの8場面と目視した夜雨の画面（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T09-30-55-607Z-streaming/report.json, ../.qa/perf/2026-10-06T09-30-55-607Z-streaming/frame-stacks.json
    title: 時計対応付きCPU、建物除外の実呼び出し時間と歩道CPU（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/ebe50282-8745-42c2-9f48-16688b24a60a.jsonl, ../.qa/logs/2026-10-06/f8f26978-cedc-462c-9abe-16f74a3c0e6a.jsonl, ../.qa/logs/2026-10-06/aa32a9bb-50fd-4648-a427-b55908cea34f.jsonl, ../.qa/logs/2026-10-06/656423d5-cc62-49ad-970b-1026c968e4f2.jsonl
    title: 数値2起動と8場面・CPU診断のtraceに限定した端末JSONL（ローカル保存）
  - id: tests
    resource: ../tests/buildingFootprints.test.ts, ../tests/buildingColliders.test.ts, ../tests/farMemory.test.ts
    title: indexedと非indexed・凹輪郭・境界・原点・入力・非対象の走査省略と既存の物理・遠景
  - id: previous
    resource: pavement-height-slice-performance.md, ground-height-query-performance.md
    title: 建物除外があった66.6ms区間と、歩道・地形照会の残り
---

# 全タイルを走査していた除外

前段の未読込地域66.6ms区間にcutFootprints self3.807msがあった。東京駅などのランドマークとPLATEAUの建物が重ならないよう、三角形の中心が輪郭内ならindexまたは位置を縮退させる処理。輪郭から離れたタイルでも各頂点を変換し、全三角形を走査し、三角形ごとの一時配列とメッシュごとの輪郭範囲を作っていた。[^previous] [^reference]

BuildingFootprintsは輪郭の範囲をsetRingsで準備し、hideFootprintsと原点変更で更新する。同期のFloat32作業配列2本を所有し、必要な最大頂点数まで伸ばして再利用する。頂点変換時にFloat32に丸めた値の範囲も求め、重ならない輪郭を候補から除き、候補0なら三角形を読まない。中心判定の式と演算順、凹輪郭、indexの縮退と非indexed位置の縮退、GPU更新を維持する。近景と遠景の両経路で同じ処理を使う。[^code]

未丸めの座標による範囲判定だと、元のFloat32座標が輪郭の辺へ丸められた点を除外できなくなる。範囲には従来の中心判定と同じFloat32値を使い、左右の境界で早期除外しすぎない。NaNを含む未使用頂点があっても、有限の三角形の除外は保つ。[^code] [^tests]

ECEFを走査・変換する同期ループは残る。作業配列を伸ばす割当やGCも中断できず、全メッシュを4ms以内に保証する変更ではない。heap割当量を実測したわけではない。[^code]

# 実タイルの数値とCPU

M2 Max、Native Chrome154.0.8037.98 / revision b859317bf11f6be47f9b7799ec690a0a42a1fb33、Metal WebGPU、ultra・rooms、1280×800・DPR1、夜雨・seed20261006。東京駅と実ワープ後の吾妻橋で、読み込み済みの大きい近景16・遠景8メッシュを選ぶ。48メッシュには本番ですでに除外済みの形状も含まれるので、未加工の全PLATEAUを照合したとはしない。[^component]

旧Buildingsを88e0281から保存して、旧cutFootprintsを固定する。実メッシュの元の型・interleaved構成を保ったcloneに実ECEFと原点行列を渡す。実際の2輪郭での出力と、各メッシュの非縮退indexの三角形中心を囲む追加の輪郭での出力を比較する。追加ケースでも全48メッシュに除外が起きることを確認する。全描画属性、index、元の描画データ・ECEFの不変、GPU更新version、繰り返しの出力など、**最終173842944項目がObject.isで一致**した。描画や物理が使う位置とindexを維持する。[^reference] [^component]

各4回で旧→新と新→旧を交互にし、メッシュごとに実フレームを挟む。geometryのclone、比較、待機、cleanup、結果保存は除外CPUに含めない。輪郭と作業領域は本番と同じく地域ごとに再利用する。計測中は編集・テスト・ビルドをしない。4ソースの保存ハッシュが最終版と一致した。[^component]

| 各4回の除外CPU合計 |     旧 | 変更後 |
| ------------------ | -----: | -----: |
| 東京駅・近景16     | 29.4ms | 22.5ms |
| 東京駅・遠景8      |  1.9ms |  1.4ms |
| 吾妻橋・近景16     | 43.4ms | 32.6ms |
| 吾妻橋・遠景8      |  2.9ms |  1.3ms |
| 全48メッシュ       | 77.6ms | 57.8ms |

合計約26%減、全計測の単一メッシュ最大は1.8→1.4ms。東京駅の近景で23%、吾妻橋の近景で25%減るが、遠景の小さい値は時間分解能とばらつきの影響がある。東京駅近景の単一最大は1.1→1.2msで増えた。全ゲームの速度向上へ読み替えない。最終端末2317行は全てinfo、対象失敗0件。[^component] [^logs]

計測用のmode条件にも名前を付けた後、最終QAを再起動して上の値を得た。本番のBuildings・BuildingFootprints・QAドライバーは変えていない。前の成功起動も204228684比較が一致し、91.3→64.6ms（約29%減）・最大2.5→1.7ms、端末2323行で全てinfoだった。読み込み済みのタイル集合は起動間で変わり、吾妻橋の選択最大頂点数は128424→72600へ変わった。同じメッシュの起動間CPU差とは扱わず、各起動内の固定メッシュの旧・新の組だけを比較する。[^component] [^logs]

最終の実ECEF、元の描画属性とindex、旧結果をFloat64数値のバイナリ列として528ファイル・280153632byte保存した。前の成功起動も528ファイル・329077584byteを残す。両方の各列の個数・byte長・全SHA-256を端末で再検査した。元の属性型、itemSize、normalized、stride、offset、行列、更新versionはreportに保存する。[^inputs]

# 一括応答の失敗を残す

初回は比較データを巨大なJSON応答で一括取得した。CDPのTCP接続が無くなり、Nodeの待機だけが残ったことをlsof、計測プロセスのID、別の読み取りCDP接続への応答で確認した。大きな応答が原因と推測するが、切断コードは旧ドライバーが記録していないので断定しない。初回の数値・時間は採用しない。自分のNodeとChromeだけを停止し、終了とポート解放を確認し、特定した使い捨てプロファイルだけを削除した。[^initial]

QAドライバーは切断・接続エラーで保留中の依頼をrejectし、開いていない接続へのsendもrejectする。Chromeがすでに終了していればcleanupでexitを再度待たない。応答しないevaluateを保留した自分のChromeをBrowser.closeで閉じる検証では、エラーが返ってcleanup completedまで終了した。数値は32768項目ずつの小さいバイナリ応答で取得し、再計測は正常終了した。本番処理はこのQA修正の間は変えていない。[^initial] [^component]

# 全ゲームは未解決

診断ラッパーとProfilerを外した8場面。rAF・LoAF・構造化ログは残る。41ソースの保存ハッシュを確認した。[^normal]

| 場面       | 最長rAF間隔 | 50ms超 |
| ---------- | ----------: | -----: |
| 通常1      |      33.4ms |    0回 |
| 更新1      |      33.5ms |    0回 |
| 通常2      |      33.5ms |    0回 |
| 更新2      |      33.5ms |    0回 |
| 更新3      |      50.0ms |    0回 |
| 原点変更   |      33.4ms |    0回 |
| 未読込地域 |      66.7ms |    4回 |
| 連続ワープ |      66.6ms |    1回 |

50ms超は表示を丸める前のrAF間隔への厳密な比較。通常更新の道路125・駐車16件の再利用、原点変更での旧データ保持を維持した。端末3615行は全てinfo、対象失敗0件。最終画像を目視して夜雨の建物・歩道・車内を確認したが、画像には交通との接触・違反・Yの表示もある。全ワープの画像一致を保証するものではない。[^normal] [^logs]

別起動のCPU診断は未読込地域50.1ms・2回、連続ワープ50.1ms・1回。建物除外の実呼び出しは195回・合計28.4ms・p95 0.7ms・最大2.4ms、314回・合計59.3ms・p95 0.7ms・**最大8.8ms**。固定比較での最大1.7msを本番の上限とは言えない。外れ値の原因はこの記録だけでは特定していない。41ソースの保存ハッシュと時計対応を確認した。外壁FacadeMaterialの同期・非同期生成は両ワープ0件。[^profile]

未読込地域の50.1ms区間にはWASM self6.268ms、水際のshoreRingStepsからのsurveyedAt self2.430ms、影inclusive7.529ms、GC self1.623msがある。別の50.1ms区間には道路Worker返答self5.026msとbuildSignals self4.076ms。連続ワープ50.1msには水際からのisWater self2.525ms、歩道からのtoGeodetic self1.994ms、影inclusive5.030ms、GC self2.499msがある。inclusiveとselfを足して全体のCPU内訳にしない。水際の独自FrameWorkは道路・歩道の直列キューとは別で、照会が同じフレームに重なる余地が残る。[^profile] [^code]

診断の端末3182行はinfo3181・warn1。warnは既存のtide_table_failed（外部fetch失敗）で、対象のruntime・道路・建物・スキーマ失敗は0。停止の完全修正は未達。[^logs] [^profile]

6個の追加テストはindexedと非indexed、凹輪郭、非対象のindexを読まないこと、Float32の境界、原点変更・小さい次メッシュ・輪郭の解除、NaNの未使用頂点を確認する。既存の物理・遠景も含む109ファイル1119テスト、型・lint・整形・justfile・Actions・knowledgeが通過し、ビルド1.32秒。初回全検査はテスト側のversionの型参照を修正し、次のHTTPテスト2件の失敗はsandboxのlocalhost待受EPERMだった。同じ検査をローカル通信権限付きで再実行して全通過した。[^tests]

[^code]: 本番の輪郭範囲とFloat32作業領域。

[^reference]: 固定した前段のBuildings。

[^component]: 最終の48メッシュ・実輪郭と追加除外の比較と交互CPU。

[^inputs]: 528バイナリ列の個数とbyte長・ハッシュ。

[^initial]: 接続を失った初回と、QA切断・分割保存の修正。

[^normal]: 診断ラッパーなしの8場面。

[^profile]: 時計対応付きCPUと実除外の外れ値。

[^logs]: 3起動のtrace限定JSONL。

[^tests]: 追加6ケースと既存の物理・遠景を含む全検査。

[^previous]: 前段で観測した建物除外と残った歩道照会。
