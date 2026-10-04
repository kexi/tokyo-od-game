---
type: Playbook
title: ヘッドレス Chrome での検証
description: Chrome DevTools Protocol を Node 標準の WebSocket で直接操作してゲームを検証する手順と、背景タブ・HMR・合成イベントで検証が壊れる罠。
tags: [testing, rendering, mobile]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T05:00:00Z }
sources:
  - id: session
    resource: 2026-10-04 の開発セッション（scratchpad/cdp.mjs と t1〜t26.mjs）
    title: 検証スクリプト群
    author: claude-opus-5-5/1m
---

# 手順

開発初日の検証で使った手順。[^session]

1. Chrome を `--headless=new --remote-debugging-port=9333 --enable-gpu --use-angle=metal` で起動する。
2. `http://127.0.0.1:9333/json` からページの WebSocket URL を取り、Node の組み込み `WebSocket` で CDP を送る。
3. `Runtime.evaluate`（`awaitPromise: true`）で状態を読み、`Input.dispatchKeyEvent` でキーを押し、`Page.captureScreenshot` で撮る。
4. 開発ビルドだけ、`window.__game` に内部オブジェクトと `setDebugCamera`（任意の角度から撮る）を公開している。本番ビルドには入らない。
5. Android の確認には `Emulation.setDeviceMetricsOverride`（915×412・DPR 2.6・landscape）、`setTouchEmulationEnabled`、Android の UA を使う。
6. 永続的なキャッシュが要る検証（2GB のモデル）では、`--user-data-dir` を固定ディレクトリにする。

# 罠

| 症状                                                                  | 原因                                                                                                                         | 対処                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 拡張機能経由で操作した Chrome でカメラが動かず、3D Tiles も読まれない | 利用者のウィンドウが背面にあり `document.hidden=true`。rAF も、3DTilesRenderer の読み込みキュー（内部で rAF を使う）も止まる | ヘッドレス Chrome を別に起動する。利用者のブラウザは使わない    |
| 長い検証が途中で `window.__brain` 未定義になる                        | 検証中のソース編集で Vite の HMR がページを再読み込みした                                                                    | 長い検証の間は編集しない。または本番ビルドを preview で検証する |
| 合成した `pointerdown` で例外                                         | 合成ポインタは `setPointerCapture` できない                                                                                  | `try/catch` で包む（実機の操作には影響しない）                  |
| 歩行者をはねる検証で事故が起きない                                    | 歩行者の 80% は迫る車をよける仕様                                                                                            | `profile.id % 5 === 0`（よけない人）を狙う                      |
| スマホ用の CSS が効かない                                             | 後から追記した通常の規則が、前にあるメディアクエリを上書きしていた                                                           | スマホ用の上書き規則をファイル末尾にまとめる                    |
| 範囲の計測値が過大                                                    | 傾いたメッシュの AABB を変換すると水増しされる                                                                               | 法線や頂点ごとの値で確かめる（[PLATEAU](plateau-buildings.md)） |

[^session]: 検証スクリプト群
