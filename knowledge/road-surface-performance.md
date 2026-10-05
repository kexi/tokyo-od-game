---
type: Metric
title: 道路更新の地形照会と描画資源の再利用
description: 夜雨の実ゲームで路面生成の中央値868→162 ms、更新時の最長フレーム間隔の中央値1783→500 ms。地形三角形を直接照会し、道路・信号・標識・オービスの描画資源を再利用する。停止は短縮したが解消していない。
tags: [roads, terrain, rendering, testing]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T18:16:00Z }
verified:
  - { by: process:vitest, at: 2026-10-05T18:11:12Z }
  - { by: process:tsc, at: 2026-10-05T18:11:50Z }
  - { by: process:vite-build, at: 2026-10-05T18:12:00Z }
  - { by: process:headless-chrome-cdp, at: 2026-10-05T18:13:40Z }
  - { by: process:production-chrome-cdp, at: 2026-10-05T18:16:44Z }
sources:
  - id: baseline
    resource: road-network-worker.md, ../.qa/perf/2026-10-05T17-48-07-064Z-roads/report.json
    title: 道路Worker導入直後の夜雨計測（ローカルJSON・git管理外）
  - id: profile
    resource: ../.qa/perf/surface-profile/before.cpuprofile
    title: 改善前の道路更新のChrome CPUプロファイル（ローカル保存）
  - id: final
    resource: ../scripts/qa/perf-road-worker.mjs, ../.qa/perf/2026-10-05T18-12-21-897Z-roads/report.json
    title: 最終版の夜雨計測と地形・橋・原点変更・メッシュ再利用の検証（ローカルJSON）
  - id: intermediate
    resource: ../.qa/perf/2026-10-05T18-04-57-014Z-roads/report.json, ../.qa/perf/2026-10-05T18-08-13-916Z-roads/report.json
    title: 中間版2回の計測（ローカルJSON）
  - id: production
    resource: ../.qa/perf/surface-production/report.json, ../.qa/perf/surface-production/night-rain.png
    title: 本番ビルドで夜雨の開始後30秒を確認（ローカル保存）
  - id: implementation
    resource: ../src/world/terrainHeight.ts, ../src/world/terrain.ts, ../src/world/roadGeometry.ts, ../src/world/roadInstances.ts, ../src/world/roadSurface.ts, ../src/main.ts
    title: 三角形の高さ照会、原点変更時の破棄、描画資源の更新
  - id: tests
    resource: ../tests/terrainHeight.test.ts, ../tests/roadGeometry.test.ts, ../tests/roadInstances.test.ts
    title: 8つの追加テスト（全910テスト）
  - id: attributes
    resource: https://threejs.org/docs/pages/BufferAttribute.html
    title: Three.js BufferAttributeのneedsUpdateと更新範囲
  - id: render-cache
    resource: ../node_modules/three/src/renderers/common/RenderObject.js
    title: Three.js 0.186.1のInstancedMeshのUUIDを含むキャッシュキー
---

# 原因と変更

Worker導入後も、`RoadSurface.rebuild` でメインスレッドに約840〜925 ms残っていた。CPUプロファイルでは各頂点の高さを求める地理座標変換・DEM照会・Rapierのレイ判定が重かった。さらに、反映後の描画でノードの組み立てが約690 ms記録された（プロファイラーを有効にした別の1回であり、下の通常計測と混ぜない）。[^baseline] [^profile]

- 描画している地形の頂点をコライダーと同じFloat32のローカル座標へ変換し、三角形を32 m格子に登録する。高さは垂直線と三角形の交点を重心座標から直接求める。粗い高さ格子への補間・丸めは行わない。
- 地形の照会範囲をチャンクの境界で絞り、直前のチャンクを先に調べる。索引は必要なチャンクだけ遅延構築し、原点変更で無効にする。非表示・破棄時には直前チャンクのキャッシュも無効にする。
- 道路の高さは橋の床版→表示中の地形→従来のDEMの順。建物を「道路の地面」として拾わない。物理ワールドのコライダー自体は変更しない。[^implementation]
- 路面のMesh・BufferGeometry・属性バッファを容量内で更新する。容量不足時だけ再確保し、2の累乗の容量を取る。余分な頂点は描画せず、境界球・境界箱は使用中の頂点から計算し直す。属性の更新範囲と `needsUpdate` を設定する。[^implementation] [^attributes]
- 信号・規制標識・オービスはgeometryとmaterialが一致するInstancedMeshを再利用する。Three.jsのキャッシュキーにはInstancedMeshのUUIDが入るため、同じモデルでも毎回作り直すと組み立てを繰り返す。個数・行列・色・境界を更新し、不要になったインスタンスのGPU資源は破棄する。共有geometry/materialは破棄しない。[^render-cache] [^tests]

# 実測（2026-10-06 JST）

M2 Max / Headless Chrome 154 / WebGPU reversed depth / ultra、1280×800・DPR 1、夜・雨。seed `20261006`、東京駅付近、開始後30秒待機。元の道路線1,053本・1,189区間・入力762,658 bytes。`just measure-road-worker` で同期/Workerを交互に各3回、準備だけと道路反映込みを分けて測った。下の比較は**両方ともWorker有効・反映込みの3回**。別のブラウザ起動で比較したため、ライブ描画・天候・交通や機械の負荷による揺れはある。[^baseline] [^final]

| 指標                     | 改善前（3回）               | 最終版（3回）            | 中央値の短縮 |
| ------------------------ | --------------------------- | ------------------------ | ------------ |
| 路面生成CPU              | 856.9 / 867.6 / 925.3 ms    | 148.5 / 162.0 / 171.5 ms | 約81%        |
| 道路反映全体CPU          | 946.0 / 951.0 / 1004.6 ms   | 244.1 / 276.2 / 285.1 ms | 約71%        |
| 更新時の最長フレーム間隔 | 1750.0 / 1783.2 / 1833.2 ms | 400.0 / 500.0 / 533.3 ms | 約72%        |
| 要求から反映完了まで     | 1110.8 / 1075.8 / 1155.1 ms | 424.3 / 447.5 / 462.4 ms | 約60%        |

中間版では最長フレーム383〜500 ms、路面122〜174 msだった。最も良かった回だけを最終値として使わない。最終版は比較中にHMR・テスト・ビルドを実行していない。[^intermediate] [^final]

**停止は短縮したが、まだ約0.4〜0.53秒のフレーム間隔が残る。** 60 fpsの予算を満たすとは言えない。初回読み込みはキャッシュ作成も含み、最終版の初回道路反映CPUは529.4 ms（路面281.1 ms）。比較表はキャッシュが温まった繰り返し更新であり、初回・新しい地域・バッファ容量が増える更新へそのまま一般化できない。次に調べる範囲は路面の形状生成、水面・橋・標識の反映、反映後の描画。[^final]

# 正しさの検証

- 全910テスト、型チェック、lint、整形、production buildを通過。追加8テストは、地形三角形とレイ交点の一致（傾斜・境界・原点変更・領域外・縮退）、再利用時の属性・行列・色・描画個数・境界の更新、容量拡張と不要資源の解放を検証した。[^tests]
- 実ゲームの道路中心1,183点で、地形照会とRapier地形コライダーの高さの最大差は約0.0000229 m（0.023 mm）。原点変更後も同じ精度。橋12点は床版の高さと完全一致した。[^final]
- 同じ道路データを反映する6回とも、検査対象の路面・信号・オービスの29 Meshをすべて再利用した。規制標識は共通プールの単体テストと描画経路で検証しているが、この29個の集計には含めていない。[^final]
- Workerと同期の道路・規制データの一致、原点切り替えまで旧座標を保持すること、連続ワープで最後の行き先だけに着地することを再確認。例外・Worker失敗・道路失敗・ログスキーマエラーは0件。[^final]
- 本番ビルドを `vite preview` で配信し、夜雨で開始後30秒まで確認。Workerで1,189区間を準備・反映でき、例外とエラーログは0件だった。これは初回起動の動作確認で、上の反復計測とは別条件。[^production]

[^baseline]: 道路Worker導入直後の夜雨計測

[^profile]: 改善前のChrome CPUプロファイル

[^final]: 最終版の夜雨計測と正しさの検証

[^intermediate]: 中間版2回の計測

[^production]: 本番ビルドでのWorker起動と夜雨の描画

[^implementation]: 三角形の高さ照会と描画資源の更新

[^tests]: 高さ・再利用・資源解放のテスト

[^attributes]: Three.js BufferAttribute

[^render-cache]: Three.js RenderObjectのキャッシュキー
