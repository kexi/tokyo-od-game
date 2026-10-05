---
type: Reference
title: 違反を撮影する通行人とスマートフォン（Blender CLI・ゲーム内 SNS「Y」の画面・撮影の姿勢）
description: 違反を目撃した通行人がスマホを横向きに構えて車を撮る演出の作り方。bpy で作った汎用スマホ（147×71×8mm・406 三角形）、ゲーム内 SNS「Y」（旧称「つぶやき」）の画面を CanvasTexture で描く向きの決め方、歩行者の腕を 2 関節 IK で電話に合わせる方法、誰が何秒撮るかの決め方と、その検証で踏んだ落とし穴。
tags: [rendering, testing, licensing]
status: stable
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T15:55:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T15:50:00Z }
sources:
  - id: build-run
    resource: scripts/blender/smartphone.py を nix の blender 5.2.2 で 2 回実行し、glb がバイト単位で同じ（8,228 B）ことと、glTF JSON（ノード・材質・extras）、Cycles CPU 32 サンプルのプレビュー 4 枚（表・裏・側面・カメラ部、画面は UV を色で表示）を確認
    title: 生成と出力の実測
    author: claude-opus-5-5/1m
  - id: unit
    resource: tests/witnessPhones.test.ts（vitest 16 件。planFilming の人数・秒数、witnessesOf の距離と見通し、Pedestrians.update を回したときの停止・向き・手の位置・歩き出し・回避・会話）
    title: 振る舞いのテスト
    author: claude-opus-5-5/1m
  - id: browser
    resource: 開発ビルドを vite preview（:4183）で配信し、scripts/qa/browser.mjs で丸の内に歩行者 4 人を置いて信号無視を演出。昼・夜の正面・肩越し・画面の接写と俯瞰を撮って目視し、25 秒後に全員が歩行に戻ることを状態で確認
    title: ヘッドレス Chrome での確認
    author: claude-opus-5-5/1m
---

# 構成

- `just smartphone-model` → `scripts/blender/smartphone.py` → `public/models/smartphone.glb`（8,228 B、Draco）。[^build-run]
- 本体はケース込みで 147 × 71 × 8 mm、角の半径 9.5 mm。外形は角 1 か所 4 分割の 20 頂点で、背面の丸め・側面・前面のリップの 4 段を帯でつないだ。カメラ部は背面の左上（背面から見て）に 16.5 × 36 mm の島、レンズ 2 個（12 角形）とフラッシュ。音量キーは左側面、電源キーは右側面に付けた。
- 三角形は 406（本体 388、画面 18）。歩行者 1 人（約 1,100）の半分以下で、何人が持っても負担にならない。
- ノードは 2 つ。
  - `Smartphone`: 材質 PhoneCase / PhoneGlass / PhoneLens / PhoneMetal / PhoneFlash の 5 プリミティブ。GLTFLoader では子 Mesh を持つ Group になる。
  - `SmartphoneScreen`（`Smartphone` の子）: 材質 PhoneScreen。UV は縦持ちで左下 (0,0)・右上 (1,1)。
- ケースの色は PhoneCase の baseColorFactor で、ゲームが `scene.extras.smartphone.caseColors`（6 色）から人ごとに選んで差し替える。PhoneFlash を別の材質にしたのは、夜に半数の人がビデオライトを点けるため。
- 実在の製品に寄せない。外形は多くの機種に共通する板状で、刻印・ロゴは無い。画面の SNS もゲーム内の「Y」（`SOCIAL_APP_NAME`）で、ロゴ・名前・配色は `src/game/socialTheme.ts` の自前のものを使う。

# 画面（Y の撮影・ポスト画面）

- `src/game/witnessPhones.ts` が 320 × 680 の canvas に横持ちの画面を描く。左がカメラのファインダー（投稿者がその場から撮った写真 `post.photo`（witnessShot.ts）、無ければ運転者の画面の静止画を、手ぶれ風にゆっくり動かす。● REC と経過時間、フォーカス枠）、右が投稿欄（投稿者・ハンドル、毎秒 7 文字で打ち込まれる本文とハッシュタグ、残り文字数）、上にアプリのロゴと名前と「投稿する」ボタン。
- テクスチャは全員で 1 枚を共有し、誰かが撮っている間だけ 0.2 秒ごとに描き直す。材質は黒の地に emissiveMap なので、夜でも読める。
- 本文は SocialFeed.draftPost が違反の瞬間に作った下書きの本文とタグ（タイムラインに上がるのは 2.5〜5.5 秒後: [違反の瞬間のカクつき](violation-hitch.md)）。オンデバイス LLM が後から本文を書き換えると、次の描き直しで画面にも反映される。投稿が無いときは「目の前で〈違反名〉の車…」を打つ。
- 夜は偶数 id の人の電話でフラッシュを光らせ、背面向きの加算合成の板（30 cm、色は白の 2.4 倍）を重ねる。フラッシュ自体は直径 4.4 mm で、10 m 先では 1 ピクセルに満たないため。PointLight にしなかったのは、灯りの数が変わるたびに全材質のシェーダーが作り直されるため。

## 向きの決め方

- 電話は「上端を持つ人の左」に向けて横に倒す。電話の +X（縦持ちの右）が上、+Y（上端）が人の左（体の +X）、画面が顔（体の −Z）を向く。体から見た回転は Rz(−90°)·Ry(180°)。
- canvas には横長の座標で描き、`setTransform(0, 1, −1, 0, 320, 0)` で縦長の canvas に写す（横の x が canvas の下向き、横の y が canvas の左向き）。

# 撮影の姿勢

- `src/world/human.ts` の `poseFilming`。電話を体の座標で顔の前（y 1.52、z 0.32、頭の中心は 1.665）に置き、両手を電話の両端のすぐ外（±0.085、少し下、カメラ側に 1 cm）に置く。
- 腕は肩と肘の 2 関節 IK を体の座標で解く。上腕 0.27、肘から手の中心 0.315（human.py）。肘は「下・少し外・少し前」へ逃がす（極ベクトル (±0.35, −1, 0.3)）。腕は Group なので任意の回転を入れられる。
- 構えるのに 0.6 秒、しまうのに 0.5 秒。その間は歩きの姿勢から四元数の slerp で混ぜ、電話は胸の前から顔の前へ動かす。
- 向きは車へ毎秒 2.6 rad まで振り向いて追う。電話の縦の傾きは車の高さとの差から。
- `animateHuman` は腕の回転を x だけでなく (x, 0, 0) で毎フレーム入れ直すようにした。IK が入れた y・z の回転が、歩き出した後に残るため。

# 誰が何秒撮るか

- `Pedestrians.witnessesOf(点, 60m)`: 歩いている人（と撮影中の人）のうち、間に建物が無い人を近い順に返す。見通しは歩行者が使う「開けた地面か」の判定を 2.5 m ごとにかけ、2 回続けて塞がれていたら建物とみなす（1 回なら駐車車両やバス停として通す）。
- `planFilming`: 撮る割合は 0.85 × 深刻度^1.5（深刻度は social.ts の `severityOf`。ひき逃げ 1 → 85%、信号無視 0.6 → 約 40%、10km/h 超過 0.1 → 約 3%）。人数は確率的に丸め、投稿されたなら少なくとも 1 人（投稿者）、上限 8 人。
- 秒数は 3 + 5 × 深刻度 + 0〜2 秒。深刻度 0.7 以上なら 1 人おきに 2.5 倍撮り続ける。車が 120 m より遠ざかったら下ろす。
- 撮る人は投稿の目撃者数（80 m 以内の歩行者・車＋人口密度の補正）に含まれる歩行者の部分集合なので、目撃者より多くはならない。
- 撮影中に車が向かってきたら電話をしまって避ける。話しかけられたら電話をしまう。

# 落とし穴

1. **CanvasTexture を glTF の UV に貼ると上下が逆になる**。Blender の書き出しは v を反転して書く（glTF は画像の上が v = 0）。GLTFLoader は自分のテクスチャを `flipY = false` で作るが、CanvasTexture の既定は true なので、画面の文字が鏡文字になった。`texture.flipY = false` にした。[^browser]
2. **接写の検証でカメラの near（0.5 m）より近づくと、頭の内側が写る**。肩越しの画面の撮影では debug camera の中で near を 0.02 にし、終わったら 0.5 に戻した。
3. 手の中心を電話の裏（持つ人の側）に置くと、大きな手の楕円体が画面を隠した。電話の両端の外、カメラ側に寄せた。
4. Group を clone した電話の子 Mesh で `visible` を切り替えても、clone 元を切り替えたことにはならない。夜のライトの表示は共有している材質の `visible` で切り替える。
5. 歩行者を消すと `disposeHuman` が子孫の geometry を捨てる。手に持たせた電話の Mesh には `userData.shared = true` を付けて、雛形の geometry を守った。
6. `Pedestrians.update` は焦点から 70 m 以内の人に Rapier の剛体を作るので、テストでは焦点を 150 m 離して物理なしで回した。[^unit]
7. ヘッドレス Chrome では `advance(秒)` のゲーム時間が指定より進むことがあり、接写を撮り終える前に撮影が終わった。検証では撮影中の人の `filmFor` を伸ばして撮り、最後に戻して歩行に戻るのを確かめた。
8. 光る板を正面から撮ったつもりが、手前の別の撮影者に隠れていた（見えないのを不具合と取り違えかけた）。光の確認は、その人の電話の世界座標と板の有無を状態で出してから、近くで撮った。

[^build-run]: 生成と出力の実測

[^unit]: 振る舞いのテスト

[^browser]: ヘッドレス Chrome での確認
