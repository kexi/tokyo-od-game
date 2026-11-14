---
type: Playbook
title: ヘッドレス Chrome での検証
description: Chrome DevTools Protocol を Node 標準の WebSocket で直接操作してゲームを検証する手順と、背景タブ・HMR・合成イベントで検証が壊れる罠。
tags: [testing, rendering, mobile, audio]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T04:15:00Z }
sources:
  - id: gpu-check
    resource: 2026-10-05 の計測（scratchpad/t132.mjs・t133.mjs、scripts/qa/browser.mjs の既定フラグ、1600×900、丸の内のスタート地点、負荷平均 92 = エージェント 9 本が並行でビルドとヘッドレス Chrome を実行中）
    title: ヘッドレス Chrome の GPU と遅さの切り分け
    author: claude-opus-5-5/1m
  - id: mute-check
    resource: 2026-11-15 の計測（scripts/qa/browser.mjs、Chrome 157・macOS 26。`pmset -g assertions` を 1 秒ごとに読み、QA の Chrome の木に coreaudiod の audio-out と「Playing audio」があるかを見た。tests/qaQuietSpeech.test.ts）
    title: QA の Chrome の消音の確かめ
    author: claude-opus-5-5/1m
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

# 音を出さない

`scripts/qa/browser.mjs` の `launch()` は `--mute-audio` で起動し、ページには `quietSpeech()`（`Page.addScriptToEvaluateOnNewDocument`）を入れる。ゲームのコード（src/）は変えない。[^mute-check]

- `--autoplay-policy=no-user-gesture-required` は残す。外すと AudioContext が suspended のままになり、音の経路（spatialAudio のノードやタイマー）が遊ぶときと違う道を通る。
- `--mute-audio` で Web Audio は聞こえなくなる。ただし Chrome の音声サービス（Helper の utility）は coreaudiod に出力を開いたまま（`pmset -g assertions` の `Resources: audio-out` は残る）。違いは「Playing audio」の assertion で、消音なしの QA の Chrome には付き、消音ありの Chrome には付かない。スピーカーの波形そのものは測っていない。
- speechSynthesis は `--mute-audio` で止まらない。macOS の Chrome はブラウザ本体のプロセスが OS の音声合成で読み上げ、自分で出力を開く（消音ありでも本体の PID に audio-out と「Playing audio」が約 1.75 秒付いた）。そこで `quietSpeech()` が speak を音の出ない待ち行列に差し替え、`start` → 文字数に応じた時間の後に `end` を発火する。差し替え後は本体にも audio-out が付かなかった。
  - 長さは実機（rate 1.05）に合わせ、1 文字あたり日本語・中国語 240 ms、それ以外 75 ms（rate 1 のとき）。日本語は毎秒 4 文字ほどで、「およそ300メートル先、芝公園出口です。斜め左方向です。」（28 文字）は実機 6.8 秒。英語の「In 300 meters, turn right at Shibakoen exit.」（44 文字）は実機 3.2 秒。言語は utterance の `lang` で決め、`lang` が空のときだけ文字種（かな・漢字）で決める。最初の 125 ms/文字は日本語で実機の半分（3.3 秒）しかなく、navGuide の isSpeaking() が QA だけ早く空いていた。
  - Chrome と同じく、`end` のハンドラの中では次の行がもう current（後ろが無ければ `speaking` は false）。cancel() は読み上げ中の行にだけ `error: interrupted` を出し、後ろの行は何も発火せずに消える（後ろの行には `canceled` も出ない。本物では、始まる前に止めた行に `canceled` が出ることはあった）。`end` のハンドラの中で cancel() したときは、まだ始まっていない次の行に何も出さない。
  - 偽物との違い（未対応）: 本物の Chrome では、cancel() の直後に speak() した行が始まらないことがあった（headless で 6 回中 4 回、`start` が来ないまま 3 秒以上 `speaking` が true）。偽物は常に素直に進むので、QA ではこの揺れが見えない。src/game/navGuide.ts の読み上げ（cancel() の直後に speak()）が同じ形なので、ゲーム側は別件で調べる。
- 結果は変わらない: `just check-deck-drive` の shibakoen-shiodome は消音あり 合格・|dy| 0.092 m、消音なし（main の browser.mjs）合格・|dy| 0.093 m（走るたびに 0.089〜0.093 m で揺れる範囲）。撮影 `views.ts landmarks --only tower-street-zojoji` も合格。
- vitest は node 環境で動き、音を出す経路は無い（speechSynthesis を使うテストは `vi.stubGlobal` の偽物）。

# 罠

| 症状                                                                  | 原因                                                                                                                                                                                                                            | 対処                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 拡張機能経由で操作した Chrome でカメラが動かず、3D Tiles も読まれない | 利用者のウィンドウが背面にあり `document.hidden=true`。rAF も、3DTilesRenderer の読み込みキュー（内部で rAF を使う）も止まる                                                                                                    | ヘッドレス Chrome を別に起動する。利用者のブラウザは使わない                                                |
| 長い検証が途中で `window.__brain` 未定義になる                        | 検証中のソース編集で Vite の HMR がページを再読み込みした                                                                                                                                                                       | 長い検証の間は編集しない。または本番ビルドを preview で検証する                                             |
| 合成した `pointerdown` で例外                                         | 合成ポインタは `setPointerCapture` できない                                                                                                                                                                                     | `try/catch` で包む（実機の操作には影響しない）                                                              |
| 歩行者をはねる検証で事故が起きない                                    | 歩行者の 80% は迫る車をよける仕様                                                                                                                                                                                               | `profile.id % 5 === 0`（よけない人）を狙う                                                                  |
| スマホ用の CSS が効かない                                             | 後から追記した通常の規則が、前にあるメディアクエリを上書きしていた                                                                                                                                                              | スマホ用の上書き規則をファイル末尾にまとめる                                                                |
| 1〜2 fps しか出ず、時計や `dt` を使う検証が実時間とずれる             | GPU は使えている（`WEBGL_debug_renderer_info` が `ANGLE Metal Renderer: Apple M2 Max`、`gl.finish()` 込みの描画 1 回 3 ms）。並行ジョブで CPU が詰まり（負荷平均 92）、ゲームの更新 1 フレームが 45 ms かかっていた[^gpu-check] | fps や時間の計測は他のジョブが止まっているときにやる。描画の重さは `gl.finish()` を挟んで測り、更新と分ける |
| 範囲の計測値が過大                                                    | 傾いたメッシュの AABB を変換すると水増しされる                                                                                                                                                                                  | 法線や頂点ごとの値で確かめる（[PLATEAU](plateau-buildings.md)）                                             |

[^mute-check]: QA の Chrome の消音の確かめ

[^session]: 検証スクリプト群

[^gpu-check]: ヘッドレス Chrome の GPU と遅さの切り分け
