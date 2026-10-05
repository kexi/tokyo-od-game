---
type: Reference
title: 違反の瞬間のカクつき（目撃ポスト・通行人の写真・画面の保存をフレームに散らす）
description: 違反した瞬間にゲームが止まる原因と、その後の仕事を後のフレームと別スレッドへ散らした方法。違反のフレームでしていたこと（目撃ポストの写真のための画面外の描画 9 回、写真の現像、画面の JPEG 化、初めて出るスマホの材質の組み立て、端末内 AI の書き換え）の見積もり、ポストを下書きと投稿に分けて 2.5〜5.5 秒後に上げる仕組み、1 フレームに画面外の描画 1 回までの関門（FrameGate）、車を単色で描く探り、暗室ワーカー（OffscreenCanvas）、読み込み中の事前コンパイル、測るための開発用フック window.__game.debug.perf。ブラウザでの計測はまだ（手順を記録）。
tags: [rendering, testing]
status: draft
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-05T03:20:00Z }
verified:
  - { by: process:vitest, at: 2026-10-05T03:15:00Z }
  - { by: process:tsc, at: 2026-10-05T03:15:00Z }
  - { by: process:vite-build, at: 2026-10-05T03:14:00Z }
sources:
  - id: code
    resource: src/main.ts（book・takeShots・afterViolations・Y の配線）、src/game/witnessShot.ts、src/game/witnessPhones.ts、src/game/social.ts、src/render/frame.ts を読んだ（2026-10-05）
    title: 違反のときに走るコード
    author: claude-opus-5-5/1m
  - id: three
    resource: node_modules/three/src/renderers/common/（RenderContexts.get の鍵、RenderObjects.get の鍵、Renderer.compileAsync、RenderObject.getMaterialCacheKey、WebGPUTextureUtils.copyTextureToBuffer、WebGLTextureUtils.copyTextureToBuffer。three 0.186.1）
    title: three r186 の描画の使い回しと事前コンパイルの仕組み
  - id: bench
    resource: developRows（src/game/photoDevelop.ts）を Node 24（V8、M2 Max）で 20 回ずつ。640×360（元 960×540）7.1 ms、640×480 9.2 ms、360×640 6.9 ms。probeSees（64×36）4 µs
    title: 現像のピクセル処理の実測
    author: claude-opus-5-5/1m
  - id: tests
    resource: tests/afterViolation.test.ts（vitest 15 件）と全体 57 ファイル 702 件
    title: 振る舞いのテスト
    author: claude-opus-5-5/1m
---

# 何が違反のフレームに積まれていたか

違反は `book()`（src/main.ts）を通る。2026-10-05 までは、その中で次をすべて同期で行っていた。[^code]費用は、ブラウザで測っていない見積もり（理由つき）と、Node で測った値に分けて書く。

| 何                                                                                                                                       | どこで                         | 費用                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 違反の記録・警察の判定・通知・判子                                                                                                       | book                           | 軽い（配列への追加と DOM 数個。判子は DOM と CSS アニメーションだけで、材質は無い）                                                                                                                                 |
| 目撃ポスト（`maybePost`）の文と投稿者                                                                                                    | book                           | 軽い（文の選択）                                                                                                                                                                                                    |
| 投稿者の写真（`witnessShot.shoot`）: 最初の 4 か所の探り（64×36 を車あり・なしで 2 回ずつ）と、いちばん良さそうな所からの写真（960×540） | book（＝違反のフレームの更新） | **画面外の描画 9 回**。WebGPU の描画の CPU 側の費用は解像度ではなく描く物の数で決まるので、64×36 の探りも街全体を描く 1 回と同じ重さに近い。違反のフレームのメインの描画が数回増えたのと同じ                        |
| 写真の現像（露出・粒子・傾き・たる型・刻印）と JPEG                                                                                      | 読み戻しの後の別のタスク       | ピクセル処理だけで 7〜9 ms（Node で実測[^bench]）、さらに toDataURL の JPEG 化。数フレーム後のどこかのフレームに乗る                                                                                                |
| 違反の記録の画面（480×270）                                                                                                              | 次のフレームの present の直後  | WebGPU のキャンバスを 2D キャンバスに drawImage して toDataURL。toDataURL は GPU がそのフレームを描き終えるのを待って読み戻し、メインスレッドで JPEG にする                                                         |
| 通行人がスマホを出す（`witnessPhones.react` → `makePhone`）                                                                              | book と次のフレームの描画      | ケースの色ごとの材質の複製・画面の材質・夜のライトの材質を、**初めて描くフレーム**で WebGPU が組み立てる（シェーダーの生成とパイプライン。1 材質で数〜数十 ms）。読み込み中の事前コンパイルの対象に入っていなかった |
| 端末内 AI（使うときだけ）の書き換え                                                                                                      | 投稿の直後から                 | LiteRT-LM が同じ GPU で数秒生成する。写真の描画・読み戻しと重なっていた                                                                                                                                             |
| 違反の記録の保存                                                                                                                         | 2 秒ごとの別のタスク           | 違反ごとの同期の保存ではない（`ViolationSync` の差分を IndexedDB へ）。1 件は JPEG と再現データで 50〜150 KB の構造化複製。変えていない（計測は `violations.save` の span）                                         |

three r186 は、描画先の形式（色の形式・型・サンプル数・深度）が同じなら別のカメラでも同じ RenderContext を使い、物と材質の組（RenderObject）も使い回す（`RenderContexts.get` の鍵にシーンとカメラが入っていない）。だから写真の描画が新しい描画オブジェクトを大量に作ることは無く、重さは描く物の数の分の CPU 側の処理だった。[^three]

# 何をどう変えたか

## 目撃ポストを下書きと投稿に分けた（social.ts・main.ts）

- `SocialFeed.draftPost()` は `maybePost` の判定と文だけを作り、タイムラインには入れない。`publish(post, gameNow)` がタイムラインに入れ、拡散を始め、写真を頼み（`camera`）、AI に書き換えを頼む（`writer`）。`maybePost` は両方を続けて呼ぶ（テストと他の呼び出しはそのまま）。
- main の `book()` は違反の瞬間に下書きし、通行人がスマホを出す（`react` に下書きを渡すので、撮っている人の画面にはその本文が打ち込まれていく）。写真もこの時に始める（下記）。
- 投稿は **2.5〜5.5 秒後**（実時間、一様乱数）に `DueQueue` から 1 フレームに 1 件まで出る。通知「Y に投稿された」と未読数もそのとき。並びは違反の順（後の違反の短い遅れが先の違反を追い越さない）。
- Why 2.5〜5.5 秒: 実際の人は撮ってから打つ。撮影は 3〜10 秒（witness-phones.md）、打つのは 1.2 秒後から毎秒 7 文字。長くすると「Y に上がった」が違反と結び付かなくなるので、撮影の短い方に合わせた。
- 投稿の時刻（postedAt）は投稿したときになる。ドラレコの刻印は下書きの時刻（違反の瞬間）を使う。言語を途中で切り替えたときのため、`publish` で本文とタグを今の言語で書き直す。
- 一時停止・リプレイ中は進まない（関門と投稿は、プレイ中のフレームの present の後に `afterViolations(now)` が進める）。

## 画面外の描画は 1 フレームに 1 回まで（frameSlices.ts の FrameGate）

- 写真の仕事は描画の前に必ず `gate.turn()` を待つ。main は毎フレームの present の後に `gate.tick()` を 1 回呼び、待っている先頭の 1 件だけを通す。通った仕事はそのタスクの microtask（＝同じフレームの後ろ）で 1 回描く。
- **頼んだフレームでは通さない**: tick の時点で 1 回以上 tick を待った仕事だけが通る。違反は更新の中（そのフレームの tick の前）で起きるので、写真の最初の描画は次のフレームから。
- 何件の投稿が同時に撮っても、1 フレームに画面外の描画は 1 回まで。[^tests]

## 探りを 1 か所ずつ、車を単色で、車のすぐ先で切る（witnessShot.ts）

- 1 件の写真の流れ: 次のフレームで立ち位置を決めて 1 か所目を探る → 読み戻しを待つ → 見えなければ次のフレームで 2 か所目 …（最大 4 か所）→ 見えた所（なければ 1 か所目）から写真を 1 回 → 読み戻し → 暗室ワーカーで現像。ほとんどは 1 か所目で見えるので、探り 1 回と写真 1 回。
- 探りは車の Mesh の材質を一時的に単色（`PROBE_SHOWN` = sRGB (220, 30, 210)）に替えて 1 回描き、その色の画素が 0.4 % 以上（64×36 で 10 画素）あれば見えたとする（`probeSees`）。色は `UntonemappedBasicMaterial`（霧なし）で、ACES と露出を逆算した放射輝度を出すので、時刻に関係なくこの色で読める。ACES が出せる色であることはテストで確かめた。
- 探りのカメラの far は「目から車まで + 8 m」。車より奥の物は車を隠せないので描かない。街の大半が視錐台から外れ、探りの描画が軽くなる。
- 探りの照準と写真の照準は、その時の車の位置（`follow`）。立ち位置は違反の次のフレームで決めたまま。
- Why not 以前の「車あり・なし」の 2 回を別のフレームに分ける: 2 回の間に他の車・歩行者・雨の粒が動いた画素も差になり、車が隠れていても「見えた」になる。単色なら 1 回で、動く物に惑わされない。
- Why not 車を隠す: ヘッドライトの光も消え、光の数が変わると全材質が組み直される（以前からの理由）。材質の差し替えは光を変えない。表示していない材質（visible が false の灯火の光など）は差し替えない。
- **写真を投稿のとき（数秒後）に、違反の瞬間の記録（車の姿勢・通行人の位置）から描き直す案は採らなかった**。写真はフレームの影の地図をそのまま使う（`holdShadows`）ので、車を元の位置へ戻して描くと、車の影は今の位置に落ち、戻した車の下には無い。信号の色、通行人（今はスマホを構えている）、ほかの車も数秒先へ進んでいる。違反の直後の数フレームで描けば、車は 1 m ほどしか動いておらず、街はその瞬間のまま。

## 現像と画面の JPEG は暗室ワーカーで（darkroom.ts・darkroom.worker.ts・photoDevelop.ts）

- 写真: 読み戻した画素（960×540 RGBA、約 2 MB）の ArrayBuffer をワーカーへ **転送**（複製しない）。ワーカーが OffscreenCanvas でピクセル処理・ぼかし・流し撮り・刻印をして `convertToBlob`（JPEG 0.8）。main は `URL.createObjectURL` の blob: URL を `post.photo` にする。Why blob: URL: ポストの写真はページの外へ残らず（Y は保存しない）、base64 の複製が要らない。three の読み戻しは毎回新しいバッファを返すので、転送しても three は困らない。[^three]
- 画面（違反の記録）: present と同じタスクで `createImageBitmap(canvas, { resizeWidth: 480, resizeHeight: 270 })` を呼ぶ（このときにフレームの写しが取られる）。ImageBitmap をワーカーへ転送し、JPEG にして `FileReaderSync` で data URL に。記録に入るのは少し後。Why data URL のまま: 記録は IndexedDB に残り、blob: URL はページを閉じると切れる。
- ピクセル処理は `photoDevelop.ts` の純粋な関数にし、ワーカーとフォールバック（Worker・OffscreenCanvas・createImageBitmap が無いとき、ワーカーが落ちたとき、計測の「前」）で共有する。行の範囲と乱数の状態を渡せば、分けて処理しても同じ画素になる（テスト）。ワーカーのバンドルは 2.4 KB（ゲームのモジュールを読まない）。
- createImageBitmap がキャンバスを拒んだら、その 1 枚は諦め、以後は旧来の drawImage + toDataURL に戻る。

## 読み込み中に組み立てておく（precompile）

- `witnessPhones.precompile`: ケースの色ごとに 1 台（偶数はライトと光の板つき）を、町の光で `compileAsync`（フレームのターゲットの形式で）。ここで作った色の材質を後の電話が使う。
  - 夜のライト（emissiveIntensity 3）をもう 1 台。three は材質の数値を「0 か 0 でないか」で鍵にするので、昼の 0 と夜の 3 は別の組み立てになる。[^three]
  - 光の板の材質は昼は visible が false。隠れた材質は compileAsync も集めないので、集める間だけ表示する（compileAsync は戻る前に集め終える）。[^three]
- `witnessShot.precompile`: 自車を探りの単色にして `compileAsync`（運転席の視点では外装の一部が隠れているので、撮影と同じ段取りで）、続けて探りを 1 回本当に描き、8 bit に変換するパスと読み戻しのバッファも作っておく。
- 暗室ワーカーも読み込み中に起動する（`darkroom.warm()`）。
- 開発ビルドで `?noprewarm` を付けると、これらを最初の違反まで残す（効果を比べるため）。
- 判子は DOM と CSS だけ、パトカー・覆面・白バイは以前から事前コンパイルの対象（webgpu-migration.md）。

## 端末内 AI は写真が済んでから

`social.writer` は `witnessShot.idle()`（描画・読み戻し・現像の途中の写真が無くなるまで）を待ってから生成を始める。投稿の書き換えは自分の写真の後、返信・引用の書き換えも、ほかのポストの写真を撮っている間は始めない。AI は使わない設定のときは何もしない（以前と同じ）。

# 測り方（開発ビルド、ユーザーの Chrome で）

ヘッドレスでは測らない（遅いので判断を誤る。[ヘッドレス Chrome での検証](headless-browser-testing.md)）。

- `perf`（src/game/perf.ts）: `book` の各段（`violation.commit` `violation.pursuit` `violation.police` `violation.witnesses` `violation.draft` `violation.phones` `violation.total`）、`post.publish`、`shot.plan` `shot.probe` `shot.photo`（メインスレッド）、`shot.probe.read` `shot.photo.read` `shot.develop` `screen.encode`（GPU やワーカーを待つ時間で、メインスレッドは空いている: `blocking: false`）、`screen.grab`、`social.update`、`clip.cut`、`violations.save`、`prewarm.phones` `prewarm.shot`。2 ms を超えた段は `{"event":"perf","phase":…,"ms":…,"blocking":…}` を出す。
- `await __game.debug.perf.violation("signal", "video", 7)`: 次のフレームで信号無視を 1 件記録し、必ず動画の目撃ポストを付ける。返り値は、直前 1 秒のフレーム（`before`）、その後 7 秒のフレーム（`after`: 最長の間隔と時刻、p50・p95、25 ms・50 ms を超えた数）、段ごとの合計と最大（`totals`）、時刻つきの段（`phases`、`at` は違反からの ms）、Chrome の long animation frame（50 ms 超）と長かったスクリプト（`long`）。
- `__game.debug.perf.spread(false)`: 投稿をその場で上げ、関門を開け（描画を待たせない）、現像と画面の JPEG をメインスレッドで同期に戻す。同じビルドで「前」を測るため。**探りの方式（4 か所 × 2 回を一度に）は戻らない**ので、「前」の違反のフレームは実際の旧版より軽く出る。
- 比べる数: `after.longest` と `after.over25`（違反の後のカクつき）を `before` と、`spread(true)` と `spread(false)` で。`totals["violation.total"].max`（違反のフレームのメインスレッドの仕事）、`shot.photo` の max（写真の 1 回の描画、今いちばん重い 1 フレーム）、`shot.develop.inline` と `shot.develop`（現像がメインスレッドから消えたか）、`screen.grab`。最初の違反は `?noprewarm` の有無で（スマホの材質の組み立て）。

ブラウザでの値はまだ無い（この文書を書いた時点では、ゲームを動かせる環境で測っていない）。

# 残っていること・見つけたこと

- **写真の 1 回の描画**は、通行人の目から街全体を描くので、メインの描画に近い CPU の費用が 1 フレームに乗る。望遠で視野が狭いぶん軽いはずだが、測っていない。far を霧の届く距離（晴れで 4.2 km）に縮める案は、遠くのランドマークが写らなくなるので採っていない。
- **事故で救急車とパトカー（emergency.ts）が出るとき**、その PointLight は `root.visible` で出し入れされる。光が増えると three は光を含む全材質の鍵が変わり、初めての組み合わせでは全部を組み立て直す。人をはねた違反のカクつきの大きな原因の候補（このタスクの範囲外で、未確認）。
- Y を開いたまま運転していると、新しい投稿者のプロフィール画像（歩行者の胸像）を別の WebGLRenderer で描く。これは 30 ms ごとに 2 枚までに既に間引かれている（socialAvatars.ts）。
- 違反の記録の保存（2 秒ごと）と再現データの切り出し（1 秒ごと）は違反のフレームとは別のタスク。測る段だけ足した。

# 落とし穴

1. **perf の段の名前が i18n のキーに見える**: tests/i18nGame.test.ts は main.ts の `"replay.…"` `"police.…"` などの文字列を i18n のキーとして探す。段の名前「replay.cut」で落ちたので「clip.cut」にした。段の名前に i18n の区域（toast・notify・hud・replay・police・camera …）を使わない。
2. **`import.meta.env` は Vite の外（tsx のスクリプト）では undefined**: perf.ts はモジュールの読み込み時に読むので、`import.meta.env?.DEV` にした。
3. tick の時点で頼んだばかりの仕事を通すと、違反のフレームの present の直後に探りが走り、違反のフレームが重くなる。「1 回以上 tick を待った仕事だけ」にした（テスト）。
4. 写真の後で投稿の時刻が変わるので、ドラレコの刻印は撮影を始めたときの postedAt（違反の瞬間）を先に取っておく。

[^code]: 違反のときに走るコード

[^three]: three r186 の描画の使い回しと事前コンパイルの仕組み

[^bench]: 現像のピクセル処理の実測

[^tests]: 振る舞いのテスト
