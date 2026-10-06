---
type: Metric
title: 道路Workerの受領と復元を別フレームへ分ける
description: 実道路2地域の17658912数値比較が一致。受け取りの最長CPU区間5.7→3.8ms・7.3→6.2ms、総CPU削減なし、平均待機約18〜20ms増。夜雨8場面の両ワープ50.1ms、診断付きLoAF59.3msが残る。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-06T11:06:04Z }
verified:
  - {
      by: process:1132-tests-types-lint-format-just-actions-knowledge-and-production-build,
      at: 2026-10-06T11:06:04Z,
    }
  - { by: process:38-road-worker-lifetime-and-violation-tests-and-types, at: 2026-10-06T10:51:52Z }
  - {
      by: process:chrome154-96-native-worker-results-17658912-comparisons-seven-runtime-hashes-and-logs,
      at: 2026-10-06T11:02:44Z,
    }
  - {
      by: process:chrome154-eight-night-rain-scenes-47-runtime-hashes-logs-and-image,
      at: 2026-10-06T11:02:44Z,
    }
  - { by: process:clock-mapped-two-warps-cpu-47-runtime-hashes-and-logs, at: 2026-10-06T11:02:44Z }
sources:
  - id: code
    resource: ../src/world/roadNetworkBuilder.ts, ../src/world/roadNetworkPacket.ts, ../src/world/roadNetworkData.ts, ../src/world/roads.ts, ../src/game/frameWork.ts, ../src/logEvents.ts
    title: 受領後の描画待ちと中断可能な復元、CPU区間の構造化ログ
  - id: reference
    resource: https://github.com/kexi/tokyo-od-game/tree/19af0de1d593f4d0b37860a4c2e1a42cef521b72
    title: 前段PR29の同期復元
  - id: component
    resource: ../scripts/qa/perf-road-reply-slices.mjs, ../.qa/perf/2026-10-06T10-53-31-578Z-road-reply-slices/report.json
    title: 同一セッションで交互に各方式24返答・実2地域を比較したJSON（ローカル保存）
  - id: normal
    resource: ../.qa/perf/2026-10-06T10-56-20-545Z-streaming/report.json, ../.qa/perf/2026-10-06T10-56-20-545Z-streaming/night-rain.png
    title: 診断ラッパーなし8場面、目視した夜雨・車内・Yの証拠画像（ローカル保存）
  - id: profile
    resource: ../.qa/perf/2026-10-06T11-00-01-152Z-streaming/report.json, ../.qa/perf/2026-10-06T11-00-01-152Z-streaming/frame-stacks.json
    title: 時計対応付きCPUと返答復元・撮影の実時間（ローカル保存）
  - id: photo
    resource: ../scripts/qa/perf-witness-photos.mjs, ../.qa/perf/2026-10-06T10-41-33-701Z-witness/report.json, ../.qa/perf/2026-10-06T10-43-39-574Z-streaming/report.json
    title: 修正前の強制4撮影と自然なワープ中撮影の内訳（ローカル保存）
  - id: logs
    resource: ../.qa/logs/2026-10-06/d073e333-0095-43a9-9322-84b6ef4f287a.jsonl, ../.qa/logs/2026-10-06/04239cba-381e-41fe-b930-081d2255d242.jsonl, ../.qa/logs/2026-10-06/9395bedd-48e0-428a-b355-ac25797c5d9d.jsonl
    title: 各計測のtrace限定端末JSONL（ローカル保存）
  - id: tests
    resource: ../tests/roadNetworkWorker.test.ts, ../tests/afterViolation.test.ts, ../tests/log.test.ts, ../justfile
    title: 待機・復元途中の取消、重複、タイムアウト、数値と共有参照の検証
  - id: previous
    resource: shared-world-work-performance.md, road-worker-reply-performance.md, violation-hitch.md
    title: 道路返答の残る受領負荷と撮影の既存Worker
---

# 受領後に描画へ譲る

前段の別起動の連続ワープではtick29.6msと道路Workerのmessage処理11.2msが同じLoAF50.7msに重なった。道路Workerは計算とバッファ転送を既に行うが、event.dataの読み出し、空間索引のMap・Vector3・規制参照の復元はページの1タスクで行っていた。[^photo] [^previous]

返答を読み出した後に既存FrameWorkで1回描画を待ち、索引のペア・セル、道路頂点・区間・接続ノード、規制の配列を128件ごとのcheckpointで進める。巨大な1セルや1区間、歩道橋の頂点内にもcheckpointを置く。unpackとrestoreは同じ4msの予算を持ち越す。同期APIは同じgeneratorを描画待ちなしで最後まで進め、既存のWorkerなしのフォールバックを維持する。[^code]

受信済みジョブは応答タイマーを止め、描画待ちをWorkerのタイムアウトと誤判定しない。重複返答を受けず、待機後・各checkpoint・公開直前に無効化を確認する。古い部分結果は公開しない。新しい地域は旧返答の片付け後に準備を開始し、従来の「最新の1依頼だけを待たせる」契約を保つ。[^code] [^tests]

event.dataの構造化クローンの読み出しとpostMessageの入力コピーは分割していない。全main-thread処理の予算でもなく、GCや単一checkpointが4msを超える余地はある。全ゲームの停止やWorkerなしの同期計算に4ms上限を保証しない。[^code]

# 実Workerの交互比較

M2 Max、Native Chrome154.0.8037.98 / Metal WebGPU、ultra・rooms、1280×800・DPR1、夜雨・seed20261006。東京駅と吾妻橋で読み込んだ同じ道路・規制・原点を固定し、前段19af0deと現行の実Workerを各4ラウンド×6返答、順序を反転して計測した。計96結果。旧5モジュールを固定し、ログのimportは拡張子.tsへ統一、旧ログに新しい診断フィールドだけを補った。旧の受領・復元計算は変えない。[^reference] [^component]

| 地域   | 区間 / 頂点 | 索引セル / ペア | 各方式の数値比較 |
| ------ | ----------: | --------------: | ---------------: |
| 東京駅 | 1189 / 2929 |     1991 / 8665 |          3256056 |
| 吾妻橋 | 2373 / 5318 |    2138 / 11143 |          5573400 |

全17658912数値比較がObject.isで一致し、Mapの順番・型名・全オブジェクトのフィールドも比較した。参照版と現行のRoadGraphは別モジュールなのでconstructorは名前で照合する。ライブの道路網を置換しないことも検査した。実入力をJSONに、旧ソース5本と計測時の現行ソース9本を保存した。現行7本の本番コードとbrowser driverのハッシュが一致する。QA自身は終了後に失敗結果保存のcatchと整形だけ追加したため、保存ハッシュとは異なる。[^component]

| 地域   | 24返答の受領＋復元CPU 旧→新 | 最長CPU区間 旧→新 | 平均完了待ち 旧→新 |
| ------ | --------------------------: | ----------------: | -----------------: |
| 東京駅 |                 87.7→89.0ms |         5.7→3.8ms |      114.8→133.0ms |
| 吾妻橋 |               148.3→149.2ms |         7.3→6.2ms |      232.5→252.4ms |

旧の最長区間はreadMs＋unpackMs＋restoreMs、新はreadMsとFrameWork.maxSliceMsの最大。待機・検証・結果保存をCPUに入れない。総CPU削減は主張しない。新の読み出し最大は3.8/6.2ms、復元の最大区間2.2/2.6ms。全48新返答は最初の描画待ち1回だけで、4ms予算を使い切って追加の描画待ちをした実返答は無かった。大きなセルの途中で待ち・取消できることはテストで保証する。[^component] [^tests]

部品の全16観測区間にrAF50ms超・LoAFは0回。吾妻橋の旧・新とも表示上50.0msの区間があり、丸め前で50ms超を数える。初回10:52のQAは拡張子なしの参照ログが別モジュールになり、準備ログを取得できず失敗した。拡張子を統一した10:53の起動だけを成功した比較結果として使う。[^component]

# 全ゲームと残った停止

診断ラッパー・Profilerなしの別起動。保存47本の本番ソースのハッシュが一致し、原点変更中の旧表示保持、道路125・駐車16件の再利用、最新ワープの着地が通過。夜雨・車内・Yに投稿済みの動画証拠を目視した。全画素比較や、すべてのネットワーク到着順の同じ姿勢の保証ではない。[^normal]

| 場面                  |          最長rAF間隔 |      50ms超 |
| --------------------- | -------------------: | ----------: |
| 通常1 / 通常2         |        33.4 / 33.5ms |     0 / 0回 |
| 更新1 / 更新2 / 更新3 | 33.4 / 33.4 / 33.4ms | 0 / 0 / 0回 |
| 原点変更              |               33.5ms |         0回 |
| 未読込地域            |               50.1ms |         2回 |
| 連続ワープ            |               50.1ms |         1回 |

この起動のLoAFは全8場面0件。未読込地域の観測完了25.063秒・道路反映8.683秒、連続16.611秒・3.117秒。前段の別起動から全ゲームの最長フレームの改善・回帰は断定しない。[^normal]

診断付きは両ワープ50.1ms、50ms超2/1回。LoAFは未読込地域50.6ms（tick33.7ms）、連続59.3ms（tick34.7ms）。before35599.100 ≤ mapped35599.627 ≤ after35617.500msで時計を照合し、47ソースが一致した。復元の最大区間は3.5ms、読み出しは最大6.4ms。実1撮影のprobe4.3ms・photo4.0ms、色変換・読み戻し要求は小さいままだった。[^profile]

CPUサンプルの推定では、未読込地域に影inclusive9.617ms、toGeodetic self5.009ms、連続にGC self10.709msが残る。別の丸め表示50.0ms区間にはPBFのreadSVarint self15.527msとliveObjects self8.279msがある。サンプルの間隔に依存する推定で、個々の関数の実測上限ではない。inclusiveとselfを加算して内訳を作らない。[^profile]

ログは部品2343行すべてinfo、8場面5114行（warn1はtide_table_failedの外部fetch失敗）、診断3234行（warn2はamedas_fetch_failedの外部fetch失敗）。対象の未捕捉例外・道路・水域・Worker・スキーマ失敗は0件。[^logs]

# 撮影に関する前段の推定を訂正する

最終の全109ファイル1132テスト、型・lint・整形・justfile・Actions・knowledgeが通過し、本番ビルドは1.46秒。HTTPログ検査を含むcheck-allにはlocalhost待受権限を付けた。既存のlint警告（Worker.postMessageにWindowのtargetOriginを要求するものを含む）とbundleサイズの警告は残る。[^tests]

前段のphoto self43.421msは、1サンプルの前に57.807msの間隔があり、その一部をrAF区間に割り当てた推定だった。同じtraceのperf_phaseはshot.photo29.9msで、43.421msを撮影の実測CPU時間と断定できない。[^previous]

修正前の東京駅の強制4撮影はshot.photo9.2/6.1/6.5/6.9msで、全4件のphoto/video証拠が完成し、rAF最長33.4〜33.5ms・50ms超0回・LoAF0件。読み戻し45.2〜55.7msとWorker現像16.2〜22.9msは非同期の待ち。修正前の自然なワープ中写真はdraw4.3ms、シーン行列0.9ms、色変換・読み戻し要求は0〜0.1msだった。写真・カメラ・JPEG・解像度は変更していない。この条件では長い撮影は再現せず、写真のGPU資源事前準備を直したと主張しない。[^photo]

停止の完全解消は未達。ブラウザの返答読み出し、独立した反映、描画・影・GC・PBF解析の負荷を残す。再実行はjust measure-road-reply-slices、QA_TIMING_ONLY=1 just measure-road-streaming、QA_PROFILE=1 QA_MODES=coldWarp,latestWarp just measure-road-streaming、QA_PROFILE=1 just measure-witness-photos。実GPU計測は直列で行い、編集中・テスト中・ビルド中には計測しない。[^code] [^component] [^normal] [^profile] [^photo]

[^code]: 描画へ譲る復元と寿命の管理。

[^reference]: 前段の同期復元を固定したソース。

[^component]: 実Workerの交互比較とCPU・待機時間。

[^normal]: 診断なし8場面と目視した画像。

[^profile]: 時計を照合したCPU・復元・撮影の内訳。

[^photo]: 修正前の実撮影とワープの再計測。

[^logs]: 各traceの端末ログ。

[^tests]: 取消・重複・タイムアウト・共有参照の検証。

[^previous]: 既存の負荷と、撮影の粗い推定値。
