---
type: Reference
title: 走るとヒープが増え続ける件（M1）と、建物 1 棟ぶんのメモリ（M2）の調べ
description: M1（ワープで走ると GC 後のヒープが約 0.5〜0.6 MB/秒で増える）と M2（近景の LRU の 1 MB に対し、配列の実体とヒープで約 6 MB）の調査の記録。2026-11-15 の 1 回目：公開の版（vite build）には QA の読み口 window.__game が無く、メモリの道具（just measure-buildings-memory）が動かないため、指示の 1.3 の止める条件で止め、設計の判断で計測の基準を DEV のまま束ねた版（just build-qa-bundle・serve-qa-bundle、チャンクの分け方だけ公開の版と違う）にした。代わりに、DEV のまま束ねた版（NODE_ENV=development vite build を vite preview で配る）と開発サーバーを並べ、傾きと比が同じ（開発サーバーの束ねていないモジュール・HMR・配り方のせいではない）ことまでを確かめた。原因は未調査。
tags: [rendering, testing]
status: draft
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-11-15T10:30:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-11-15T10:30:00Z }
sources:
  - id: m11-bundle
    resource: vite build（本番）の dist/assets/*.js に `__game` が 0 件。vite preview で配り、scripts/qa/memory-buildings.ts を視界 far・30 秒で掛けると、180 秒待っても `__game.getState()` が "ready" にならず、memory-buildings.ts 150 行目の WATCH が ReferenceError で止まる（main f54368e、2026-11-15）。dist/ と dist-qa/ の assets/*.js の大きさを並べて、チャンクの分け方を見た
    title: 公開の版で道具が動かないこと
    author: claude-opus-5-5/1m
  - id: m11-runs
    resource: just measure-buildings-memory 相当（--view far、ワープの輪 wards、300 m・10 秒、--seconds 1200）を、開発サーバー（vite、5291）と、DEV のまま束ねた版（NODE_ENV=development vite build --mode development --outDir .qa/dist-devmode を vite preview で 5292）に同時に 1 本ずつ。ヘッドレス Chrome・M2 Max・--mute-audio。main f54368e。傾きは 10 秒ごとの点の最小二乗（2026-11-15）
    title: 開発サーバーと、束ねた DEV の版の 20 分
    author: claude-opus-5-5/1m
---

# 公開の版では、今の道具で測れない

- `window.__game`（`scene`・`buildings`・`debug.roads.warp` ほか）は `src/main.ts` の `if (import.meta.env.DEV)` の中で作られ、本番のビルドからは消える。`vite build` の出力に `__game` は 1 件も無い。[^m11-bundle]
- そのため `scripts/qa/memory-buildings.ts`（と `perf-buildings.ts` ほか `__game` を読む QA の道具）は、`vite preview` で配った公開の版では動かない（ゲームの準備待ちが 180 秒で切れ、近景の LRU を読む所で `ReferenceError`）。[^m11-bundle]
- `vite build --mode development` だけでは DEV にならない（出力に `__game` が無いまま）。`NODE_ENV=development` を付けると、DEV のまま束ねた版になる（`__game` あり）。[^m11-bundle]
- 公開の版に QA の読み口は足さない（設計の判断、2026-11-15。`__game` は車を置く・ワープする・内部を読む口で、遊ぶ人のコンソールからも呼べるようになるため）。計測の基準は、次の「DEV のまま束ねた版」にする。

## DEV のまま束ねた版（計測の基準）

- `just build-qa-bundle` で `dist-qa/` に束ね（`NODE_ENV=development vite build --mode development`）、`just serve-qa-bundle [port]` で `vite preview` で配る。
- 公開の版との違いは `import.meta.env.DEV` が真であることだけ。それで動くのは、`src/main.ts` の `__game` の塊（5590 行から）と `?inlineRoads`・`?noprewarm`、`src/i18n/index.ts` の検査、`src/assetsPage.ts` の分岐、ログの毎行の検査（`src/log.ts`）、`perf` の記録（`src/game/perf.ts`）。
- 束ねる設定（圧縮・target・入口）は同じ。ただし **チャンクの分け方は違う**: DEV の塊にある `import("./debug/viewHooks")`・`import("./debug/expresswayDrive")` のため、公開の版の 2 つ（main 6.7 MB・x-zone30plus 1.1 MB）が、DEV の版では main 2.3 MB・vehicle 4.4 MB・three.core 0.39 MB・x-zone30plus 0.68 MB などに分かれる（JS の合計はほぼ同じ）。どちらも圧縮されている。[^m11-bundle]

# 開発サーバーと、DEV のまま束ねた版は同じ

視界 far、ワープの輪 20 分（main f54368e、X0 の後）。[^m11-runs]

| 配り方                             | GC 後のヒープ（始め → 20 分） | ヒープの傾き 5〜20 分 / 10〜20 分 | 配列の実体（始め → 20 分） | 配列の実体の傾き 5〜20 分 / 10〜20 分 | 15〜20 分の近景の持っている量 | 配列の実体 ÷ 近景 |
| ---------------------------------- | ----------------------------- | --------------------------------- | -------------------------- | ------------------------------------- | ----------------------------- | ----------------- |
| 開発サーバー（vite）               | 541 → 1,494 MB                | 0.64 / 0.49 MB/秒                 | 1,150 → 2,334 MB           | 0.47 / 0.53 MB/秒                     | 383 MB                        | 5.9               |
| DEV のまま束ねた版（vite preview） | 455 → 1,410 MB                | 0.55 / 0.52 MB/秒                 | 1,029 → 2,479 MB           | 0.61 / 0.94 MB/秒                     | 383 MB                        | 5.9               |

- ヒープの傾きは、2 本とも X0 の計測（far 0.53〜0.60 MB/秒）と同じ程度。**M1 は、開発サーバーの束ねていないモジュール・HMR・配り方の物ではない。**
- M2 の比（配列の実体 ÷ 近景の持っている量）も 2 本で同じ 5.9（固定の分を含んだ比。X0 の「4.4 倍 + 0.45 GB」と矛盾しない）。
- 1 回ずつの計測で、配列の実体の傾きは揺れが大きい（10〜20 分で 0.53 と 0.94）。この 2 本は同時に走らせ、同じ機械で別の作業の `memory-buildings.ts` も走っていた（重なった時間は確かめていない）。数字の細かい差は読まない。
- 残る差は、本番で消える DEV だけのコード（`__game` の参照、`perf` の記録〔最大 400 件〕、ログの検査を毎行するか最初の 1 行だけか）。どれも上限があるか、ごみを作るだけで溜めない作りに読めるが、本番の版で測ってはいない。
- ページのログを送る仕組み（`LogShipper`、待ちは最大 2,000 行）と `recentLogs`（2,000 行の輪）は、開発サーバーにも preview にもあり、2 本の違いではない。

# まだ調べていないこと

- 公開の版（本番のビルド）での傾き。
- 指示の 1.2（ワープのせいか: 歩幅を変える、往復）、2 節（スナップショットの差・部分を切る）、3 節（1 棟ぶんの内訳）。
