---
type: Metric
title: 影材質のキャッシュ無効化を減らす
description: 夜雨の影描画でalphaTestの切り替えが共有材質のversionを増やし、ほぼ毎描画キャッシュキーを再計算していた。元材質ごとの影材質で再計算を抑え、変更と破棄を保持する。新地域の133〜150 msの停止は残る。
tags: [rendering, testing, logging]
status: draft
stale_after: 2027-04-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T21:59:41Z }
verified:
  - { by: process:952-tests-typecheck-lint-format-build, at: 2026-10-05T21:59:41Z }
  - { by: process:headless-chrome154-shadow-parity, at: 2026-10-05T21:53:00Z }
  - { by: process:headless-chrome154-streaming, at: 2026-10-05T21:56:00Z }
  - { by: process:vitest-shadow-lifecycle, at: 2026-10-05T21:43:22Z }
sources:
  - id: baseline
    resource: ../.qa/perf/2026-10-05T21-27-09-617Z-streaming/report.json
    title: マージ済みmain d72cd3fの夜雨計測（ローカル保存、Profilerあり）
  - id: profile
    resource: ../.qa/perf/2026-10-05T21-46-35-617Z-streaming/report.json
    title: 影修正後の計測とcoldWarp・latestWarp.cpuprofile（ローカル保存、Profilerあり）
  - id: final
    resource: ../.qa/perf/2026-10-05T21-54-31-598Z-streaming/report.json
    title: 通常更新・原点変更・新地域・連続ワープの実測（ローカル保存、Profilerなし）
  - id: audit
    resource: ../.qa/perf/shadow-diagnosis-before.json, ../.qa/perf/shadow-diagnosis.json
    title: RenderObjects.getのversion・動的キー・clipping照合（ローカル保存、診断の追加負荷あり）
  - id: parity
    resource: ../scripts/qa/shadow-parity.html, ../scripts/qa/shadow-parity.mjs, ../.qa/perf/shadow-parity/report.json
    title: WebGPU・WebGL2の影画像比較（各256×256 RGBA、各状態2描画後）
  - id: code
    resource: ../src/render/stableShadow.ts, ../tests/stableShadow.test.ts
    title: 元材質ごとの影材質、version伝播と二重解放を防ぐ回帰テスト
  - id: three
    resource: ../node_modules/three/src/nodes/lighting/ShadowBaseNode.js, ../node_modules/three/src/renderers/common/Renderer.js, ../node_modules/three/src/renderers/common/RenderObject.js, ../node_modules/three/src/core/EventDispatcher.js
    title: インストール済みThree 0.186.1の影描画・元材質の破棄監視・イベント通知
---

# 原因と変更

ThreeのShadowMaterialは光源ごとに共有される。Renderer.renderObjectは元材質のalphaTestを影材質へコピーし、Material.alphaTestのsetterは0と正の値をまたぐとversionを増やす。切り抜きと不透明の材質が交互に現れると、直前にキャッシュされた描画オブジェクトにもversionの差が出る。5秒の診断で影描画113,440回のうち113,424回がversion不一致、動的キー・clipping不一致は0だった。[^three] [^audit]

太陽の公開shadowNodeへStableShadowNodeを設定し、元材質ごとに影用NodeMaterialを再利用する。Three標準の影描画関数へ委譲するため、shadow side、切り抜き、position/depth node、displacement、VSMの受光物体、影描画コールバックの処理を引き継ぐ。元材質のversionが変わったときだけ対応する影材質を更新する。元材質の交換は別の影材質を使う。[^code]

変更後の別起動の診断では、影材質228個・164,080描画でversion・動的キー・clipping不一致はすべて0、例外0件だった。この診断は追加のMap照会と動的キー計算を行うので、描画回数からFPS改善率を計算しない。[^audit]

# 計測

M2 Max、Headless Chrome154、WebGPU、ultra、1280×800・DPR1、夜雨、seed20261006、東京駅でプレイ開始後30秒待つ。新地域は吾妻橋、連続ワープは新宿への依頼を東京駅で上書きする。反映完了後も10秒と終端2秒を観測し、プレイ状態・道路100本以上・同一session・最後の着地点を検査する。[^baseline] [^profile] [^final]

| 条件                         | 新地域の最長フレーム | 連続ワープの最長フレーム | 例外 |
| ---------------------------- | -------------------: | -----------------------: | ---: |
| main d72cd3f（Profilerあり） |             166.6 ms |                 200.0 ms |    0 |
| 影修正後（Profilerあり）     |             133.4 ms |                 166.7 ms |    0 |
| 影修正後（Profilerなし）     |             133.3 ms |                 150.0 ms |    0 |

CPUプロファイルのgetMaterialCacheKeyのself timeは、新地域2,103.6→7.9 ms、連続ワープ1,186.5→7.4 ms。customProgramCacheKeyも1,603.7→4.5 ms / 1,022.0→8.7 msになった。各起動の読み込み順・ホスト負荷・計測時間は異なるため、最長フレームの短縮率を保証値や厳密なA/Bと扱わない。[^baseline] [^profile]

Profilerなしの通常時は最長33.4 ms、道路更新33.5 ms、原点変更50.0 ms。道路更新のCPU219.7 ms・最大区間8.7 ms・要求から反映完了まで約3.8秒。新地域はp95 50.0 ms・最長133.3 ms、連続ワープはp95 50.0 ms・最長150.0 ms。**停止の完全解消は未達。** CPUプロファイルには道路nearestの全区間探索、GPUへの転送・描画、3Dタイルの展開が残る。この変更でそれらの上限は保証しない。[^profile] [^final]

# 描画と破棄の検証

WebGPUとWebGL2で、切り抜きと不透明の混在、alphaTest・positionNodeの変更、材質交換と古い材質の破棄を比較した。変更後のシーンは各状態から新規生成したThree標準の参照と全RGBA値が一致した。影を消すと1,860値以上、位置と切り抜きを変えると10,680値が変わるので、空画像同士の比較ではない。GPUの例外は0件。繰り返し実行した。[^parity]

初期の1描画だけの比較には差が出る起動があり、参照と変更中のシーンを各2描画後に比較するようにした。影の更新前後でThree標準の継続シーンと新規シーンにも1,230値の差があった。検査は変更後の期待状態を新規シーンから作る。最初の1描画の完全一致をこの結果から主張しない。[^parity]

最初の実装は元材質のdispose通知の中で影材質も同期disposeし、GPUQueue.writeBufferの例外を1件出した。ThreeのRenderObjectは元材質と影材質の両方のdisposeを監視する。EventDispatcherは通知の開始時にlistener配列をコピーするので、通知中にもう一方をdisposeすると同じRenderObjectを2回解放する。影材質のdisposeをmicrotaskへ送り、元材質の通知が終わってから残る資源を解放する。7回帰テストで、version維持・変更・材質交換・再利用・両材質からの解放1回・光源破棄・例外時のscene復元を検証した。[^three] [^code]

端末ログのsession 70e62736-1a66-4101-ac3a-d6365d67cfe6→beb677ae-7797-428d-862e-df2e3e695079の比較で、GPUQueue.writeBuffer例外1→0・goneを確認した。最終Profilerなしのsession d8777e7c-1531-4825-be52-cdd415726ba5は全5操作で例外・道路失敗・スキーマエラー0。実DEM Workerと同期参照のFloat32・NaNのビット一致も維持した。[^final] [^code]

再現はjust serve-devで配信後にnode scripts/qa/shadow-parity.mjs、性能はQA_MODES=baseline,update,recenter,coldWarp,latestWarp node scripts/qa/perf-road-streaming.mjs。計測中はHMR・ビルド・テストを実行しない。[^parity] [^final]

最終状態で90ファイル・952テスト、tsc --noEmit、oxlint、oxfmt --check、knowledge lint、本番vite buildが成功した。変更ファイルのlint警告は0件。リポジトリ全体の既存lint警告・大きなbundleのbuild警告は残る。[^code]

[^baseline]: マージ済みmainの夜雨の実測

[^profile]: 影修正後の実測とCPUプロファイル

[^final]: Profilerなしの全操作計測

[^audit]: 影のversionとキャッシュキーの診断

[^parity]: WebGPUとWebGL2のRGBA比較

[^code]: 実装と材質のライフサイクルの回帰テスト

[^three]: Three 0.186.1のインストール済みソース
