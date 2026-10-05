---
type: Reference
title: ゲームパッドと Nintendo Switch Pro コントローラー（Gamepad API の割り当て・WebHID のジャイロと HD 振動）
description: ゲームパッドの対応（Gamepad API）と、Switch Pro コントローラーを WebHID で開いてジャイロのハンドル操作と HD 振動を使う仕組み。Chrome が Pro コントローラーを W3C の標準配置に並べ替えて渡すこと（Chromium nintendo_controller.cc）、既定の配置と理由、設定 › コントローラーの割り当て（取り込み・重なりの入れ替え/解除・コントローラーごとの保存）、スティックの曲線とデジタルの ZL/ZR の踏み込み、WebHID で使ったレポート・サブコマンド・USB と Bluetooth の見分け方・ボタンとスティックと IMU のバイト、Chrome 自身のドライバが IMU を切る落とし穴、相補フィルタでの傾き、HD 振動の周波数と振幅の符号化。実機では一度も試しておらず、テストはすべて資料から作ったバイト列であること。
tags: [input, testing]
status: draft
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T15:00:00+09:00 }
verified:
  - { by: process:vitest, at: 2026-10-05T14:55:00+09:00 }
  - { by: claude-opus-5-5/1m, at: 2026-10-05T14:30:00+09:00 }
sources:
  - id: tests
    resource: tests/gamepad.test.ts（32 件）・tests/procon.test.ts（29 件）
    title: 割り当て・保存・曲線・PadInput の入力、レポートの解析・出力レポート・振動の符号化・傾き・振動の混ぜ方
  - id: w3c
    resource: https://w3c.github.io/gamepad/#remapping
    title: W3C Gamepad（Editor's Draft、2026-10-05 取得）Remapping の Standard Gamepad の表、dual-rumble
  - id: chromium-nintendo
    resource: https://github.com/chromium/chromium/blob/cb7fa52e2e767e4f672b9620bd26f5311f3adb2f/device/gamepad/nintendo_controller.cc
    title: Chromium device/gamepad/nintendo_controller.cc（この版で最後に変わったのが commit cb7fa52e、2026-10-03。main を 2026-10-05 に取得）
    author: The Chromium Authors
  - id: chromium-fetchers
    resource: https://github.com/chromium/chromium/blob/eef334adabf1e96b203a3b2df52807ee758d6334/device/gamepad/gamepad_platform_data_fetcher.h
    title: Chromium の gamepad_platform_data_fetcher.h・gamepad_platform_data_fetcher_mac.mm・game_controller_data_fetcher_mac.mm・gamepad_standard_mappings*.{h,cc,mm}・gamepad_data_fetcher.cc・BUILD.gn（main、commit eef334ad 時点）
  - id: chromium-hid-blocklist
    resource: https://github.com/chromium/chromium/blob/eef334adabf1e96b203a3b2df52807ee758d6334/services/device/public/cpp/hid/hid_blocklist.cc
    title: WebHID のブロックリスト（Nintendo の項目は無い）
  - id: deku
    resource: https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering/tree/b354f21ae81f7b0d1d060b2b61e66ad0d9bc1756
    title: dekuNukem/Nintendo_Switch_Reverse_Engineering（commit b354f21a、2026-08-21）bluetooth_hid_notes.md・bluetooth_hid_subcommands_notes.md・imu_sensor_notes.md・rumble_data_table.md・USB-HID-Notes.md
    author: dekuNukem ほか（コミュニティの解析。任天堂の公式資料ではない）
  - id: sdl
    resource: https://github.com/libsdl-org/SDL/blob/0ce29152334db1eae84c8059e0066ea8a1a845dd/src/joystick/hidapi/SDL_hidapi_switch.c
    title: SDL の Switch ドライバ（SendSensorUpdate の軸の並べ替えから Pro コントローラーの IMU の軸の向きを読んだ）
---

# 構成

- `src/game/gamepad.ts` — `PadInput`。`requestAnimationFrame` で `navigator.getGamepads()` を自前で読む（ゲームのループとは別。一時停止中や 設定 を開いている間もボタンの取り込みと + で閉じるが効く）。最後に使ったパッドが操作する。ボタン名（グリフ）、スティックの曲線、トリガーの踏み込み、振動の出口（WebHID か Gamepad API の dual-rumble）。
- `src/game/padProfile.ts` — 割り当てと設定の型・既定・zod の検証・保存（`localStorage` の `tod.pad`、版 1、コントローラーごと）。DOM を触らない。
- `src/game/procon.ts` — Pro コントローラーの WebHID。レポートの解析、出力レポートの組み立て、HD 振動の符号化（純関数）と、接続・初期化・再接続の `ProConHid`。
- `src/game/tilt.ts` — 加速度計とジャイロの相補フィルタでハンドルの角度を出す `TiltEstimator`。
- `src/game/rumble.ts` — 振動の効果（縁石・衝突・違反のスタンプ・アイドリング・試す）と混ぜ方。
- `src/game/padSettings.ts` — 設定 › 操作 › コントローラーの画面。
- `src/game/input.ts` — キーボード・タッチと合わせる。`Input.read()` / `readWalk()` / `look()` がパッドの値を取り込み、`Input.label()` がヒントとツールバーの表示（パッドが最後の入力ならそのボタン名、割り当てが無ければキー）を返す。
- `src/main.ts` の変更は配線だけ: ヒント・ヘルプ・ツールバーの表示を `showControls()` にまとめてパッドの変化でも呼ぶ、`mountPadSettings`、クラクション（`input.horn()`）と後ろを見る（`input.padLookBack()`）、振動の 4 か所（衝突のイベント・歩行者への衝突・`book()` の違反のスタンプ・毎フレームの `carFrame`）。

# Chrome での Pro コントローラーの見え方

Chrome（Windows・macOS・Linux・ChromeOS）は Pro コントローラーを HID で自分で開き（`NintendoDataFetcher`、Android・iOS・Fuchsia 以外でビルドされる）、USB でも Bluetooth でも `mapping: "standard"` の W3C 標準配置に並べ替えて渡す。[^chromium-nintendo][^chromium-fetchers] macOS の汎用 HID の取り込みと GameController.framework の取り込みは、Nintendo の機器を明示的に Nintendo 用に回している（`kIsNintendoGamepad`）。

|    index | W3C 標準の位置 [^w3c]                | Pro コン     | 備考                                                     |
| -------: | ------------------------------------ | ------------ | -------------------------------------------------------- |
|        0 | 右の 4 つの下                        | B            |                                                          |
|        1 | 右の 4 つの右                        | A            |                                                          |
|        2 | 右の 4 つの左                        | Y            |                                                          |
|        3 | 右の 4 つの上                        | X            |                                                          |
|    4 / 5 | 上の左 / 右の前面                    | L / R        |                                                          |
|    6 / 7 | 下の左 / 右の前面                    | ZL / ZR      | value は 0 か 1 だけ（デジタル）                         |
|    8 / 9 | 中央の左 / 右                        | − / +        |                                                          |
|  10 / 11 | 左 / 右スティック押し込み            | LS / RS      |                                                          |
|    12–15 | 左の 4 つ ↑ ↓ ← →                    | 十字ボタン   |                                                          |
|       16 | 中央                                 | HOME         |                                                          |
|       17 | （標準の外）                         | キャプチャー | `SWITCH_PRO_BUTTON_CAPTURE = BUTTON_INDEX_COUNT`         |
| axes 0–3 | 左 X・左 Y・右 X・右 Y（上・左が負） |              | Chrome が SPI の校正値で正規化し、円形の遊びを付けてある |

- `id` は `"Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"` の形（`GamepadDataFetcher::UpdateGamepadStrings` の `"%s (%sVendor: %04x Product: %04x)"`）。Firefox は `"57e-2009-Pro Controller"` の形なので両方から vendor・product を読み、保存の鍵を `057e-2009` にした。
- `vibrationActuator` は `dual-rumble`。Chrome は strong を 141 Hz・振幅 ×0.9、weak を 182 Hz・×0.1 の HD 振動に置き換え、1 回 100 ms ずつ送る。
- Chrome のドライバは初期化の途中で IMU を切る（`RequestEnableImu(false)`）。ジャイロは Gamepad API からは取れない。

WebUSB を使わなかったのは、Chrome が HID クラスのインターフェースを WebUSB から開かせないため（依頼の前提。今回この点のソースは読んでいない）。WebHID のブロックリストに Nintendo の項目は無い（FIDO の usage page と FIDO 機器だけ）。[^chromium-hid-blocklist]

# 既定の配置

標準配置の index で持つので、Xbox や DualSense でも同じ位置のボタンが同じことをする（表示名だけ機種ごと: `GLYPHS`）。

| ボタン（Pro コン / Xbox） | 車                                 | 徒歩                 |
| ------------------------- | ---------------------------------- | -------------------- |
| ZR / RT                   | アクセル                           | —                    |
| ZL / LT                   | ブレーキ（停止中はバック）         | —                    |
| L スティック              | ハンドル                           | 歩く                 |
| R スティック              | 左右を見る（離すと前に戻る）       | カメラを回す         |
| B / A                     | サイドブレーキ                     | ジャンプ             |
| A / B                     | 降りる                             | 乗る                 |
| Y / X                     | エンジン（話す・始動）             | 話す                 |
| X / Y                     | スマホ                             | スマホ               |
| L / LB                    | 左の合図                           | —                    |
| R / RB                    | 右の合図                           | 走る（押している間） |
| LS（押し込み）            | クラクション（押している間）       | —                    |
| RS（押し込み）            | 後ろを見る（押している間）         | —                    |
| ↑ / ↓ / ←                 | ライト / ワイパー / ハザード       | —                    |
| →                         | 視点の切り替え                     | 視点の切り替え       |
| − / View                  | 目的地                             | 目的地               |
| + / Menu                  | 閉じる（何も開いていなければ設定） | 同じ                 |
| キャプチャー              | スクリーンショット                 | 同じ                 |
| HOME                      | なし                               | なし                 |

- 下のボタンをサイドブレーキ、トリガーをペダルにしたのは、同じパッドで遊ぶ運転ゲーム（Forza・グランツーリスモ・マリオカートの ZR/ZL）と同じ位置にするため。
- HOME は空けた。macOS・Windows のゲーム用オーバーレイがページより先に取ることがある（確かめていない）。
- 割り当ての無い操作（自動運転・タクシー・時間帯など）は 設定 で好きなボタンに割り当てる。
- ダイアログ（設定・ヘルプ・目的地…）が開いている間、パッドは運転も歩行もしない（キーボードと同じ）。ボタンは「閉じる」だけが効き、`dialog.requestClose()`（無ければ `close()`）で閉じる。Esc と同じく、ダイアログ自身の cancel の扱いが優先される。

# 割り当ての規則（padProfile.ts）

- 操作ごとに効く場面がある: 車だけ（ペダル・サイドブレーキ・クラクション・後ろを見る・合図・ライト・ワイパー・ベルト・テレビ・自動運転）、徒歩だけ（ジャンプ・走る）、どちらでも（それ以外）。場面が重ならなければ同じボタンでよい（B = サイドブレーキと ジャンプ、R = 右の合図と 走る）。
- 押した瞬間だけ動く（押しっぱなしの繰り返しは無視）。押している間のもの（ペダル・サイドブレーキ・クラクション・後ろを見る・ジャンプ・走る）は毎フレーム読む。サイドブレーキ・走る・後ろを見るは「押すたびに切り替え」にもできる。
- 取り込み: 設定で操作のボタン名を押すと次に新しく押されたボタンを割り当てる。取り込みを始めたときに押していたボタンは、一度離すまで数えない（A でクリックした場合など）。Esc（ダイアログの cancel を止める）か 8 秒で取り消し。取り込み中はほかの操作は動かない。
- 重なり: 同じ場面に同じボタンの操作があれば、「入れ替える」（相手に元のボタンを渡す）か「前の割り当てを外す」。入れ替えた結果、相手が別の操作とまた重なるなら外す。どの手順の後も、同じ場面で 1 つのボタンに 2 つの操作は残らない（テストで全操作を確かめる）。
- 保存: `tod.pad` に `{ version: 1, profiles: { "057e-2009": {...} } }`。割り当ては既定と違うものだけを持つ（既定を変えれば、変えていない人にも届く）。読み込みは zod で、項目ごとに `.catch` で既定に戻す（壊れた 1 項目のために全部を捨てない）。数値は範囲に丸め、知らない操作名は捨てる。版が違えば既定から（移行はまだ無い）。`localStorage` が使えないとき（プライベートウィンドウなど）は例外を出さずに既定。

# スティックとトリガー

- ハンドル: `sign(v) · min(1, ((|v| − 遊び) / (1 − 遊び − 0.04))^曲線 · 感度)`。遊びの縁で 0 から始まり（跳ばない）、端の 4 % は全開。既定は遊び 0.10・感度 1.0・曲線 1.5（中央が細かい）。車速による舵角の制限は車の側（`steerLimit`）にある。キーボードのハンドルは緩やかに追う（3.5〜6 /s）が、スティックとジャイロはすでにアナログなので速く追う（14 /s）。
- 歩く: 左スティックに円形の遊び 0.15。カメラ・車内の視線: 右スティックの X、遊び 0.15。車内は位置の指定（倒した分だけ最大 2.6 rad 向く）で、離すと止まっていても前に戻る（マウスの視線は動き出すまでその場）。
- ZL/ZR: Pro コンは 0/1 しか返さないので、押している間 `踏み込み時間`（既定 0.45 s、ブレーキはその半分）で 0 → 1 に上げ、離すと 0.08 s で 0 に戻す。値が 0.02〜0.98 の間を一度でも返したボタンはアナログとみなし、そのまま使う（Xbox の RT など）。

# WebHID（procon.ts）

接続は 設定 の「プロコンを接続（ジャイロ・振動）」（`requestDevice` はユーザーの操作が要る）。フィルタは VID 0x057E・PID 0x2009。一度許可すると、次からは読み込み時の `navigator.hid.getDevices()` と、電源・抜き差しで来る `connect` イベントで自動で開く。`disconnect` で切れたことにする。

## Gamepad API と二重にしない

同じコントローラーを Chrome の Gamepad API と WebHID の両方から読める。ボタンとスティックは Gamepad API（Chrome が校正値で正規化した値）から取り、WebHID からはジャイロと振動だけを使う。Gamepad API に Pro コンが無いとき（Chrome のドライバが取れないとき）だけ、WebHID のレポートを仮想のパッド（`source: "hid"`）にする。このときスティックは校正値を読まずに Chromium の既定（中心 2050・±1500・遊び 160 カウント）で正規化する。HD 振動は Pro コンが使用中のパッドのときだけ送る。

## レポート（WebHID は report ID を data から外して渡すので、資料のバイト番号から 1 を引く）[^deku]

| 出力 ID | 用途                | data                                                                                               |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| 0x01    | サブコマンド + 振動 | [0] カウンタ (0–F)、[1–8] 振動（左 4・右 4、無振動は `00 01 40 40`）、[9] サブコマンド、[10–] 引数 |
| 0x10    | 振動だけ            | [0] カウンタ、[1–8] 振動                                                                           |
| 0x80    | USB の命令          | 0x02 ハンドシェイク、0x03 3 Mbps、0x04 USB のみ・タイムアウトなし                                  |

| 入力 ID | 内容                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| 0x30    | 標準のフルモード。60 Hz（Pro コンは 120 Hz と資料）。ボタン・スティック・IMU 3 回分                        |
| 0x21    | サブコマンドの返事（ボタン・スティック付き。data[12] の最上位ビットが ACK、data[13] が答えたサブコマンド） |
| 0x3F    | 簡易 HID モード（起動直後。押したときだけ）                                                                |

0x30 / 0x21 の data:

| data       | 内容                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 0          | タイマー                                                                                      |
| 1          | 上位 4 ビット: 電池（8 満・6 中・4 低・2 危険・0 空）と充電中 (0x10)、下位 4 ビット: 接続情報 |
| 2          | 右: Y 0x01・X 0x02・B 0x04・A 0x08・SR 0x10・SL 0x20・R 0x40・ZR 0x80                         |
| 3          | 共通: − 0x01・+ 0x02・RS 0x04・LS 0x08・HOME 0x10・キャプチャー 0x20                          |
| 4          | 左: ↓ 0x01・↑ 0x02・→ 0x04・← 0x08・SR 0x10・SL 0x20・L 0x40・ZL 0x80                         |
| 5–7 / 8–10 | 左 / 右スティック 12 ビット: `x = d0 \| (d1 & 0x0F) << 8`、`y = d1 >> 4 \| d2 << 4`（校正前） |
| 11         | 振動の状態                                                                                    |
| 12–47      | IMU: 12 バイト × 3（加速度 x y z・ジャイロ x y z、int16 LE、約 5 ms 間隔）                    |

- IMU の換算（imu_sensor_notes.md の既定、0x40 01 の後の ±8 g・±2000 °/s）: 加速度 0.000244 g/カウント、ジャイロ 0.06103 °/s/カウント。SPI の工場校正は読んでいない。3 回分は平均し、Δt はレポートの到着間隔にした（3 回分の時刻の順を SDL は逆に扱っており、資料と合わせられなかったため、並べて積分しない）。
- 軸（SDL の `SendSensorUpdate` が PlayStation の軸に並べ替える式から逆に読んだ）: +X 前（トリガーの方）、+Y 左、+Z 面の外（上）。平らに置くと加速度は +Z に +1 g。[^sdl]

## 初期化

1. 開いて 0.6 s 待つ。USB（出力レポートが 63 バイト）なのに何も届かなければ、Chrome のドライバが開いていないので USB の手順（0x80 の 02 → 03 → 02 → 04）を送る。USB か Bluetooth かは、Chromium と同じく出力レポートの大きさ（USB 63・Bluetooth 48 バイト）で見分ける（記述子の `outputReports` の items から計算）。
2. サブコマンド 0x03 `30`（フルモード）、0x40 `01`（IMU オン）、0x48 `01`（振動オン）。自前で USB の手順を踏んだときだけ 0x30 `01`（プレイヤーランプ 1）。
3. 見張り: フルモードなのに IMU が 1 s 以上ゼロなら 0x40 `01` を送り直す（2 s に 1 回まで）。Chrome のドライバは初期化で IMU を切る（上）ので、ページが Gamepad API を読み始めたとき・再接続のときにジャイロが止まるのを防ぐ。0x3F（簡易モード）が届いたらフルモードに戻す。SDL にも「誰かが IMU を切った」ときの同じ対処がある。
4. 送信は 1 つずつ（Promise をつなぐ）。振動は送っている間に来た最新の 1 つだけを次に送る。同じ振動は 90 ms 以内には送り直さない。

## ジャイロのハンドル（tilt.ts）

- 中央を合わせたときの重力 g0 とパッドの左右の軸 L から、回す軸 A = L × g0 を決める。平らに持てば前の軸、立てて持てば（Joy-Con のハンドルのように）面に垂直な軸になるので、持ち方を選ばない。右手を下げる向きが正。
- 相補フィルタ: ジャイロの A 回りの角速度で角度を進め、重力から出した角度へ時定数 0.6 s で寄せる。寄せる強さは加速度の大きさが 1 g から離れるほど弱め、±0.35 g で 0（手が振っている間は重力を信じない）。ジャイロのずれ（バイアス）は、静止中（0.1 rad/s 未満・加速度の変化 0.02 g 未満）に 2 s の平均で学ぶ。
- ハンドル: 1.5° の遊びの後、`フルに切る傾き`（既定 60°）で全開。L スティックを倒している間はスティックが優先。設定で オン/オフ・反転・中央を合わせる・いまの角度の表示。中央は保存しない（持ち方はその都度違う）。接続した直後の最初の値も中央にする。

## HD 振動（rumble_data_table.md）

- 周波数: `f = round(log2(Hz / 10) · 32)`。高い帯 `HF = (f − 0x60) · 4`（0x0004–0x01FC、81.75–1252.57 Hz）、低い帯 `LF = f − 0x40`（0x01–0x7F、40.88–626.28 Hz）。帯の外は帯の端に丸める。
- 振幅: 符号 a（0–100）。a < 16 は表の値、16–31 は `2^(a/16) / 17`、32–100 は `2^(a/32) / 8.7`。一番近い a を選び、表の安全な上限 a = 100（1.0、HA 0xC8・LA 0x0072）を超えない。資料は上限より上を「アクチュエーターを傷める」としている。`HA = a · 2`、`LA = 0x40 + a/2`（a が奇数なら 0x8000 を足す）。
- 4 バイト: `HF の下位`、`HA + HF の上位`、`LF + LA の上位`、`LA の下位`。資料の例（HF 0x01A8・HA 0x88・LF 0x63・LA 0x804D → `A8 89 E3 4D`）と、Chromium の表の 141 Hz（HF 0x0068・LF 0x3A）・182 Hz（0x0098・0x46）をテストで再現した。左右の振動子には同じものを送る。
- Gamepad API のパッドには、低い帯の振幅を strong、高い帯を weak として `dual-rumble` を 80 ms ごとに 100 ms ずつ送り、止めるときは `reset()`。

| 効果           | いつ                                                                                                                    | 中身                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 縁石（bump）   | 車の縦の速さが 1 フレームで 0.45 m/s 以上変わったとき（2.5 m/s で最大、120 ms に 1 回まで）と、地面のコライダーとの接触 | 50–110 ms、90 Hz の低い帯が減衰、220 Hz を少し                             |
| 衝突（impact） | 自車の接触（建物・柱・車は自車の Δv、8 m/s で最大）、歩行者                                                             | 150–500 ms、70 Hz と 160 Hz が指数で減衰                                   |
| 違反のスタンプ | `book()` の「違反」の印                                                                                                 | はんこの 2 拍: 0–60 ms 強く、130–210 ms 弱く                               |
| アイドリング   | エンジンがかかって 3 km/h 未満（既定オフ）                                                                              | 42 Hz・0.07–0.12、毎フレーム与えないと 150 ms で止まる（一時停止で止まる） |
| 試す           | 設定のボタン                                                                                                            | 400 ms で両帯を上げていく                                                  |

同時の効果は振幅を足して 1 で頭打ち、周波数は一番大きいものの値。全体に「振動の強さ」（既定 0.7）を掛ける。

# 確かめたこと・確かめていないこと

確かめた（ブラウザも実機も使わない）:

- W3C の標準配置の表、Chromium が Pro コンを標準配置で出す並べ方・ZL/ZR が 0/1・`id` の書式・dual-rumble の変換・初期化で IMU を切ること・USB/Bluetooth の出力レポートの大きさ、を一次のソースで読んだ。[^w3c][^chromium-nintendo][^chromium-fetchers]
- レポートの解析は、資料の表から書いたバイト列（資料の例のボタン `41 00 82` を含む）で、全ボタンのビット・スティックの 12 ビット・電池・IMU 3 回分・IMU オフの判定・0x21 の ACK を確かめた。振動の符号化は資料の計算例と Chromium の表の値に一致した。[^tests]
- 割り当て（既定に重なりが無い・入れ替え・解除・入れ替えが重なるときの解除・初期化・差分だけの保存）、保存（往復・版違い・壊れた項目・ストレージの例外）、曲線・遊び・踏み込み、PadInput（押した瞬間だけ・場面・最後に使ったパッド・同じ機種 2 台・取り込みと取り消しとタイムアウト・切り替え・右スティック・WebHID の仮想パッドと二重にしないこと）、相補フィルタ（静止・速い回転・バイアス・揺さぶり・中央合わせ）、振動の混ぜ方をテストした。[^tests]

確かめていない（実機が無い。ユーザーの Chrome と Pro コンで確かめる）:

- 実機のバイト列。とくに IMU の軸の向きと符号（SDL の式からの推定）、0x30 の 3 回分の順、ジャイロの換算の正しさ。ジャイロの左右が逆なら設定の「傾きの向きを反転」で直るが、軸自体が違えば直らない。
- Chrome の Gamepad API が開いている Pro コンを WebHID でも開けるか（macOS の IOHID・Windows の HID は共有で開くはずだが、確かめていない）。開けたとしても、Chrome のドライバの初期化と取り合いにならないか（見張りで IMU を戻す前提）。
- Windows で Pro コンが二重に見えないか（WGI・RawInput の取り込みとの関係を読んでいない）。2 台に見えても状態は別々に持つが、操作するのは最後に使った 1 台。
- Bluetooth と USB のどちらでも 0x30 が届くか、自前の USB の手順が要る場面があるか、振動が送り直し無しでどれだけ続くか、HD 振動の感じ（強さ・周波数の選び）。
- HOME とキャプチャーを OS が先に取るか（macOS のゲームオーバーレイなど）。
- 設定の画面・ツールバー・ヘルプの見た目（ブラウザで開いていない）。

# 実機で確かめる手順

1. USB で Pro コンをつなぎ、ゲームでボタンを押す。設定 › 操作 › コントローラーに「使用中: Pro Controller（057e-2009）」が出る。ZR でじわっと加速、ZL でブレーキ、停止中の ZL でバック、L スティックで曲がる。R スティックで左右を見て、離すと前に戻る。ツールバーの記号が ZR・A などになり、キーを押すとキーに戻る。
2. B（サイドブレーキ）、A（降りる → 歩いて A で乗る）、徒歩の B ジャンプ・R 走る、LS クラクション、RS 後ろを見る、− 目的地、+ で設定を開いて + で閉じる、キャプチャーでスクリーンショット。
3. 設定で「自動運転」のボタン名を押し、HOME 以外の空いたボタン（なければ十字の ↑ など）を押して割り当てる。重なったときに「入れ替えました」が出る。Esc で取り消し、8 秒待っても取り消し。「初期の配置に戻す」。再読み込みしても残っている。
4. 「プロコンを接続（ジャイロ・振動）」→ 一覧から Pro Controller を選ぶ。「WebHID で接続中（USB）」と、ジャイロの「いまの傾き」が動く。ハンドルのように右に傾けて角度が正になるか、平らに持っても立てて持っても「中央を合わせる」の後に左右が合うか。ジャイロをオンにして走る。
5. 振動の「試す」、縁石に乗る、壁にぶつかる（強さが速さで変わる）、信号無視などでスタンプ、アイドリングをオンにして停車。
6. Bluetooth でつなぎ直して 1〜5（表示が「Bluetooth」になる）。抜き差し・電源の入れ直しで自動でつながり直すか。ページを再読み込みしてもボタンを押さずに WebHID がつながるか（許可の記憶）。
7. 問題があれば `just show-logs` で `pad_connected`・`procon_hid_connected`（`usb`・`reportBytes`）・`procon_hid_failed`（`step`）を見る。

# 落とし穴

- Chrome のドライバは IMU を切る。WebHID で一度オンにしても、ページが Gamepad API を読み始めた（あるいは再接続で初期化し直した）後に切られるので、IMU がゼロのままのレポートを見張って入れ直す。
- WebHID の `inputreport` の `data` には report ID が入っていない。資料のバイト番号から 1 を引く。`sendReport(id, data)` も同じ。
- Chrome は Pro コンを押すまで `getGamepads()` に出さない（指紋採取対策の「ボタンを押すまで見せない」）。設定には「ボタンを押すと認識」と書いた。
- 振動の振幅の上限は表の 1.0（a = 100）。それより上の値は資料が危険としているので、符号化で超えない。

[^tests]: tests/gamepad.test.ts・tests/procon.test.ts（資料から書いたバイト列。実機の読み取りは無い）

[^w3c]: W3C Gamepad の Standard Gamepad の表

[^chromium-nintendo]: Chromium nintendo_controller.cc（ボタンの並べ方・初期化の手順・dual-rumble の変換）

[^chromium-fetchers]: Chromium のデータの取り込み（どの OS で Nintendo 用の取り込みが動くか、id の書式、標準配置の写像）

[^chromium-hid-blocklist]: Chromium の WebHID ブロックリスト

[^deku]: dekuNukem の解析資料（レポート・サブコマンド・IMU・振動の表・USB）

[^sdl]: SDL の Switch ドライバ（IMU の軸）
