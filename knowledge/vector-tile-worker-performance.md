---
type: Metric
title: 地図のPBFとMVTを同じWorkerで解析する
description: 保存した実80タイルの1745904値が旧同期・実Worker・復旧処理で一致。反復比較のメインCPU145.6→54.1ms、総CPUと待ちは増える。夜雨のワープ50.1msと返答読み出し10msの一例は残る
tags: [roads, water, plateau, rendering, testing, logging]
status: draft
generated: { by: codex, at: 2026-10-06T11:44:00Z }
verified:
  - {
      by: process:1150-tests-types-lint-format-just-actions-knowledge-and-production-build,
      at: 2026-10-06T11:46:10Z,
    }
  - {
      by: process:42-vector-tile-lifetime-cache-water-streaming-and-log-tests-and-types,
      at: 2026-10-06T11:34:05Z,
    }
  - {
      by: process:chrome154-80-captured-tiles-three-backends-1745904-comparisons-and-15-source-hashes,
      at: 2026-10-06T11:37:58Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-53-runtime-hashes-logs-and-image,
      at: 2026-10-06T11:41:06Z,
    }
  - { by: process:chrome154-clock-mapped-two-warps-cpu-53-runtime-hashes-and-logs, at: 2026-10-06T11:43:20Z }
sources:
  - id: code
    resource: ../src/world/vectorTileData.ts, ../src/world/vectorTileCompute.ts, ../src/world/vectorTile.worker.ts, ../src/world/vectorTilePolygons.ts, ../src/world/gsiVectorTiles.ts, ../src/world/roadTiles.ts, ../src/world/pavements.ts, ../src/world/water.ts
    title: 共有デコーダー、転送バッファ、分割復元と元の入力を使うフォールバック
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/a9daf5991c5b61343f2e8c04b33ad858f01b5b20
    title: 前段PR30の同期PBF/MVT処理
  - id: input
    resource: ../.qa/perf/2026-10-06T11-17-39-308Z-streaming/report.json, ../scripts/qa/perf-road-streaming.mjs
    title: 変更前の実ワープから保存した80入力バッファと個別feature/geometry実測（ローカル保存）
  - id: comparison
    resource: ../scripts/qa/perf-vector-tiles.mjs, ../.qa/perf/2026-10-06T11-36-42-980Z-vector-tiles/report.json
    title: 同じ実入力を交互に旧同期・実Worker・分割フォールバック各4回で比較したJSON（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T11-38-21-350Z-streaming/report.json, ../.qa/perf/2026-10-06T11-38-21-350Z-streaming/night-rain.png
    title: 診断ラッパーなし8場面と目視した夜雨・車内・Yの証拠画像（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T11-41-27-454Z-streaming/report.json, ../.qa/perf/2026-10-06T11-41-27-454Z-streaming/frame-stacks.json
    title: 時計対応付きCPUプロファイルとLoAF（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/001c4f4b-647b-4a11-bf0e-4a0e6b81c3af.jsonl, ../.qa/logs/2026-10-06/dece6671-1f7a-4a5d-ba9e-b2ef19eec4ad.jsonl, ../.qa/logs/2026-10-06/17bb4053-9fc4-4ee1-bb91-54564ac2a086.jsonl
    title: 計測trace限定の端末JSONL（ローカル保存）
  - id: tests
    resource: ../tests/vectorTileData.test.ts, ../tests/vectorTileCompute.test.ts, ../tests/vectorTileFixture.ts, ../tests/gsiVectorTiles.test.ts, ../tests/waterStreaming.test.ts, ../tests/log.test.ts
    title: 実MVTバイトの合成、座標・転送・失敗復旧・タイムアウト・破棄・共有予算・HTTPキャッシュの検証
  - id: previous
    resource: road-reply-frame-performance.md
    title: PBFの大きなサンプリング区間を見つけた前段
---

# 解析と一時オブジェクトをページから移す

GSIのroadとwaterarea、PLATEAUのTrafficAreaとAuxiliaryTrafficAreaを1つの遅延起動Workerで処理する。PBFヘッダー・属性・geometryの読み出し、タイル境界のクリップ、座標変換をWorkerへ移す。Float64座標とUint32境界、歩道種別を転送し、ページでは最終の道路・水域・歩道配列を復元する。道路の選別・幅員・種別・橋、穴とring順序、経緯度とglobal tile座標の演算順は維持した。描画・物理・表示距離は変更していない。[^code]

GSIは従来の共有LRU64と404・他HTTP失敗の契約を維持し、PBF readerや未使用レイヤーを保持せず、道路と水域の最終結果だけを保持する。水域だけ使うタイルでも両レイヤーを準備するため、旧ゲームでは不要だった道路の計算・復元が生じる場合はある。歩道の区ごとのURL、403/404の空結果、同時取得の契約は維持する。[^code]

入力を一度コピーして転送し、Worker失敗時のため元のバイトを保持する。起動・送信・実行・messageerror・不一致・応答30秒タイムアウトの失敗はWorkerを止め、未受信依頼を元の入力から処理する。不正なPBFはその依頼だけ失敗し、次のWorker依頼を妨げない。受信後は応答タイマーを止め、重複を無視し、描画待ちをタイムアウトとしない。破棄は待機・分割復元の途中でも結果を公開しない。[^code] [^tests]

復元とフォールバックは同じSerialWork・FrameWorkを共有し、個々のタイルで4msの予算をリセットしない。復元は256座標・各ring・128最終要素、道路の座標変換は128点・各featureで確認する。公開ライブラリのPBFヘッダー、単一geometryとpolygonクリップ、転送前の入力コピー、event.dataの読み出しは分割していない。GCを含む全処理に4ms上限を保証するものではない。maxSliceMsはこの共有予算内のCPU累積であり、1タイルの復元時間やその場のrAF間隔ではない。[^code]

# 前段のPBFサンプルを関数の実時間と扱わない

前段のプロファイルにはreadSVarint→loadGeometry→water.fetchTileのself約15.527msがあった。変更前の実ChromeでfeatureとloadGeometryを直接囲って測り、80タイル・15442150バイト（GSI50、歩道30）を保存した。単一geometryの最大は0.2ms、featureは0.1msだった。ヘッダー・クリップ・変換はこの個別ラッパーの測定外で、読み込み完了後に取り付けたため初期の呼び出しも含まない。15.527msはサンプリング間隔からの推定であり、単一PBF関数が15ms同期実行した証拠としては使わない。[^input] [^previous]

一時的なNode/tsx探索でもヘッダーからクリップ・変換まで計測したが、実ブラウザの速度と同一ではなく、旧選別の書き直しを含んだため最終の比較に使わない。以下のNative測定では固定コミットから旧関数本文を切り出し、古いclip・waterPolygonsを独立に使った。[^comparison]

# 実80タイルの反復比較

M2 Max、Native Chrome154、ANGLE Metal / WebGPU、ultra・rooms、1280×800 DPR1、seed20261006、夜雨のゲームを30秒温めて実行した。各入力を保存バイトから読み、旧同期・実Worker・分割フォールバックを同一セッションで順序を逆転しながら各4回実行。各タイルの処理後に1フレーム待つので、同時着信の負荷試験ではない。GSIの比較は両レイヤーを毎回取り出す制御された比較であり、実ゲーム全体のCPU削減率には換算しない。[^comparison]

| 4反復の入力       | 旧同期メインCPU合計 | Worker版メインCPU合計 | Worker内解析・pack | 分割フォールバックCPU |
| ----------------- | ------------------: | --------------------: | -----------------: | --------------------: |
| GSI50（200処理）  |              41.9ms |                40.0ms |             74.3ms |                72.1ms |
| 歩道30（120処理） |             103.7ms |                14.1ms |            118.6ms |               111.1ms |
| 合計              |             145.6ms |                54.1ms |            192.9ms |               183.2ms |

メインCPUは入力コピー・送信・返答読み出し・FrameWorkで測った復元の合計（制御やログの全コストを含むCPUプロファイルではない）。この比較では約63%減だが、主に歩道の移動であり、GSIだけは約5%減に留まる。Worker内CPU＋ページCPUは247.0msと旧145.6msより多く、総計算の高速化ではない。[^comparison]

旧の単一タイル最大はGSI0.4ms・歩道2.7ms。WorkerのメインCPU合計の単一依頼最大は1.1ms・0.4ms（復元最大1.0ms・0.2ms、読み出し最大0.2ms・0.1ms）。平均返答待ちはGSI16.09ms・歩道17.01ms、最大36.2ms・25.9ms。フォールバックの平均待ちは2.50ms・5.36msでCPUは増えた。元の全80入力のバイト長は保持された。[^comparison]

全1745904数値比較（各方式581968）がObject.isで一致し、道路属性・配列順・穴も一致した。12期間のrAF最大33.5ms、50ms超0回、LoAF0件。旧処理も50ms超0回であり、この部品測定だけで実ゲームの停止を解決したとは言えない。15ソースhashすべて計測中不変、trace001c4f4b…の端末ログ2339行はすべてinfo、errors配列は空。[^comparison] [^logs]

# 夜雨の実ゲームには残る停止がある

診断ラッパーなし8場面のrAF最大は33.5 / 33.4 / 33.4 / 33.4 / 49.9 / 33.4 / **50.1** / **50.0ms**。coldWarpの50ms超は1回、他は0回、LoAFは全0件、errors配列は全空。coldWarpの道路反映8.438秒・CPU291.2ms・最大区間6.6ms、latestWarpは3.057秒・CPU218.1ms・最大8.4ms。80タイルすべて実Workerで準備し、通常返答の復元は最大0.3msだったが、GSI16/58219/25802のevent.data読み出しに**10.0ms**の一例がある。その原因はこの診断なし起動では確定できない。[^normal] [^logs]

別起動のCPU診断付き2ワープはrAF50.0 / 49.9ms、50ms超0回・LoAF0件、errors空。ここも80タイルすべてWorkerで、読み出し最大0.2ms、復元0.2ms、メインCPU合計最大0.4ms、Worker計算2.6msだった。CDP時計のmapped37477.301msはpage.before37476.8〜after37496.9ms内にあり、対応を確認済み。診断なし起動の10msの読み出しはこの再起動では再現しなかった。[^profile] [^logs]

両起動で53実行ソースのhashが一致。通常trace dece6671…3612行はinfo3610＋外部Amedas・潮位取得のwarn2、診断trace17bb4053…3430行はinfo3429＋外部潮位warn1だった。夜の濡れた車内画面と自然なYの動画証拠を目視した。[^normal] [^profile] [^logs]

前段の50.1msやLoAF59.3msとの別起動差はネットワーク・GC・描画の重なりも変わるため、Workerだけの因果的効果としない。実ワープに50.1msが残るため、停止の完全修正は未達である。プロファイルの大きなsample deltaを単一関数の実CPUと扱わず、GPUバッファ更新・影描画・GCと反映の重なりを次に直接測る。[^normal] [^profile] [^previous]

[^code]: メインCPUの処理段階と失敗復旧を構造化ログで記録する。

[^reference]: 比較対象はPR30の固定HEAD。旧パーサー本文と新パーサーを共通化して比較しない。

[^input]: 個別feature/geometryの計測は全解析の計測ではない。

[^comparison]: 保存入力・SHA-256・旧ソース・実行ソース・生の320×3行とrAFをローカルJSONへ保存する。

[^normal]: QA_TIMING_ONLY=1で実画面の通常走行・再反映・原点変更・両ワープを計測する。

[^profile]: QA_PROFILE=1 QA_MODES=coldWarp,latestWarp。診断の負荷を含む別起動。

[^logs]: ブラウザコンソールではなくtrace限定の端末JSONLを読み取る。

[^tests]: 合成MVTを公開Pbf writerで書き、実際のparserを使う。モックだけを実Workerの成功の証拠にしない。

[^previous]: 古い15.527msはsamplingの推定値として記録し、直接計測と区別する。
