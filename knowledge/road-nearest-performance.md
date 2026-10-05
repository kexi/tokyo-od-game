---
type: Metric
title: 道路の近傍検索を空間インデックスで絞る
description: 道路nearestの全区間探索を32 mセルの候補に絞り、空間インデックスをWorkerで準備する。実道路4,776照会が旧処理と一致し、検索CPU時間262.7→84.4 ms。夜雨の新地域116.6 ms・連続ワープ150 msは残る。
tags: [roads, rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T22:29:06Z }
verified:
  - { by: process:vitest-45-road-regressions, at: 2026-10-05T22:23:52Z }
  - { by: process:headless-chrome154-nearest-parity, at: 2026-10-05T22:26:39Z }
  - { by: process:headless-chrome154-streaming, at: 2026-10-05T22:25:46Z }
  - { by: process:959-tests-typecheck-lint-format-build, at: 2026-10-05T22:29:00Z }
sources:
  - id: code
    resource: ../src/world/roads.ts, ../src/world/roadNetworkData.ts, ../tests/roadNearest.test.ts, ../tests/roadNetworkWorker.test.ts
    title: 候補の抽出、Workerでのインデックス準備、旧探索との回帰比較
  - id: query
    resource: ../scripts/qa/perf-road-nearest.mjs, ../.qa/perf/2026-10-05T22-25-58-276Z-nearest/report.json
    title: 最終版の実道路4,776照会の交互比較（JSONはローカル保存・git管理外）
  - id: profile-before
    resource: ../.qa/perf/2026-10-05T21-46-35-617Z-streaming/report.json
    title: 親PRの影修正後のcoldWarp・latestWarp CPUプロファイル（ローカル保存）
  - id: profile-after
    resource: ../.qa/perf/2026-10-05T22-13-42-210Z-streaming/report.json
    title: 道路候補を絞った後のcoldWarp・latestWarp CPUプロファイル（極端座標ガード追加前、ローカル保存）
  - id: gameplay
    resource: ../scripts/qa/perf-road-streaming.mjs, ../.qa/perf/2026-10-05T22-24-01-306Z-streaming/report.json
    title: 最終版の通常更新・原点変更・新地域・連続ワープ（Profilerなし、ローカル保存）
  - id: previous
    resource: shadow-cache-performance.md, road-network-worker.md
    title: 影材質の修正と、空間インデックスのWorker準備についての訂正前の記録
---

# 原因と変更

影材質のキャッシュ無効化を減らした後も、道路の`nearest`が各フレームで全道路の全折れ線片を調べていた。路線バスの道路への補正、ナビ、交通・違反の判定が同じ探索を使う。広い道路網を保持していると、近くに道路がない照会にも全区間の距離計算が走る。[^code] [^profile-before]

既存の`carriagewaysAt`用32 mセルを共用し、照会半径の矩形に重なるセルから区間IDを集める。ID順に並べ、旧処理の射影・距離・厳密な半径判定は変更しない。同距離の区間の勝者、`s`・横方向の距離・方向ベクトル・区間オブジェクトへの参照を維持する。候補に対する通行止め等のフィルターは照会のたびに評価する。[^code]

高速道路もインデックスへ入れる。一般道路の車道判定は引き続き高速道路を除く。半径や座標が非有限、セル座標が安全な整数の範囲外、または照会するセル数がインデックス全体以上の場合は従来の全区間探索に戻す。広い半径のために大量の空セルを走査することと、極端な座標でループ変数を増やせなくなることを避ける。[^code]

`snapshot()`でセルを準備し、道路Workerの結果に含める。`restore()`は受信したMapをそのまま使う。インデックスがnullの旧形式は初回に作れる。Workerとメインで同じスキーマを使い、永続化した旧バージョンの非nullインデックスは対象としていない。Workerの同期フォールバックではインデックス生成もメインスレッドに戻る。[^code]

# 実道路の比較

M2 Max、Headless Chrome154、WebGPU、ultra、1280×800・DPR1、夜雨、seed20261006、東京駅付近で開始後30秒待つ。親コミットd9afba9と未コミットの道路変更を使い、Workerで復元した1,189区間・1,991セルの同一道路網を照会した。各区間の中点付近、横方向-12/0/12 m、半径3/15/40/250 m、高速道路を含む/除くフィルターを組み合わせた。旧全探索を凍結した参照と、新探索を24照会ごとに交互の順序で計時し、結果を厳密比較した。[^query]

| 処理               | 4,776照会の合計CPU時間 | 1照会あたりの平均 | 24照会のp95 |
| ------------------ | ---------------------: | ----------------: | ----------: |
| 旧全区間探索       |               262.7 ms |         0.0550 ms |      1.5 ms |
| セルから候補を抽出 |                84.4 ms |         0.0177 ms |      0.6 ms |

4,776件すべてで区間参照・位置・横方向の距離・方向が一致。CPU時間は約68%減った。この数値は道路照会のCPUであり、ゲームのFPS改善率には換算しない。照会バッチの間には実時間rAFを挟み、同一session・同一道路網・プレイ継続を検査した。インデックスが照会前から存在し、実際の`road_network_prepared.backend`がworkerであることも検査した。Worker計算147.2 ms、復元0.8 ms、送信1.6 ms、要求から復元完了177.2 ms。例外・道路失敗・ログスキーマ不一致0件。[^query]

# ゲーム全体と残る停止

Profilerなしの別起動で、交通・雨・時計を動かしたまま測った。通常更新と原点変更では描画オブジェクトと駐車車両の再利用を検査し、DEMの実Workerと同期参照のビット一致、古いワープの不採用も維持した。[^gameplay]

| 操作                               | 最長フレーム間隔 |     p95 | 50 ms超の間隔数 |
| ---------------------------------- | ---------------: | ------: | --------------: |
| 通常時                             |          33.4 ms | 33.4 ms |               0 |
| 道路更新                           |          49.9 ms | 33.4 ms |               0 |
| 原点変更                           |          50.0 ms | 33.4 ms |               0 |
| 新地域（吾妻橋）                   |         116.6 ms | 33.5 ms |              30 |
| 連続ワープ（新宿を東京駅で上書き） |         150.0 ms | 50.0 ms |              28 |

sessionは1f38222e-f635-414d-b269-f75bd52db972、buildはd9afba9+ca01ea。全操作で例外・道路/Worker失敗・スキーマエラー0件。新地域の道路反映CPU276.8 ms・最大区間21.9 ms、連続ワープ210.1 ms・最大区間5.7 ms。**100 ms以上のフレームが残り、停止の完全解消は未達。** 読み込み順、交通、ホスト負荷が起動間で違うので、親PRとの最長フレーム差を厳密なA/Bや保証値にしない。[^gameplay] [^previous]

CPUプロファイルの`src/world/roads.ts`に属するnearest/nearestCandidatesのself time合計は、新地域3,624.1→258.4 ms、連続ワープ1,909.5→217.2 ms。プロファイルの記録時間に対する比率は11.91→1.09%、8.05→0.94%。記録時間は新地域30.4→23.7秒、連続ワープ23.7→23.2秒で、全期間が同一長の比較ではない。一方、sceneの`updateMatrixWorld`、描画コマンド、GPU転送、初回の材質構築が残る。Profilerありの新地域は最長116.7 ms、連続ワープ166.7 msだった。Profilerを付けた観測と外した観測は区別する。[^profile-before] [^profile-after]

# 回帰検証と再実行

300本の合成折れ線・負のセル・半径・フィルターの4,320組を旧全探索と比較し、同距離、厳密な半径境界、長い道路片、重複点、高速道路、通行規制の変更、structured clone、空/極端な照会も検査した。関連5ファイル45テストが成功。Worker計算のsnapshotに非空のMapが入ることも検査している。[^code]

最終状態で全91ファイル959テスト、型チェック、lint、整形、knowledge lint、justfile lint、production buildが成功した。変更ファイルのlint警告0件。既存ファイルのlint警告とbuildのbundleサイズ等の警告は残る。[^code]

`just serve-dev`で配信し、`just measure-road-nearest`。ゲーム全体は`QA_MODES=baseline,update,recenter,coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjs`。`QA_PROFILE=1`でcoldWarp/latestWarpのCPUプロファイルを保存できる。計測中はHMR、編集、ビルド、テストを動かさない。[^query] [^gameplay]

[^code]: 道路の候補抽出・Worker復元と回帰比較

[^query]: 実道路4,776照会の旧処理との比較

[^profile-before]: 影修正後・道路検索変更前のCPUプロファイル

[^profile-after]: 道路検索変更後のCPUプロファイル

[^gameplay]: 最終版のProfilerなしの全操作計測

[^previous]: 先行する影修正と道路Workerの記録
