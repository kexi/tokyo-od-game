---
type: Reference
title: WebGPU への移行（WebGPURenderer・フレームの組み立て・残りの移植）
description: three.js r186 の WebGPURenderer へ移した段階 A の記録。描画方式（WebGPU / WebGL 2）の設定、逆転 float 深度を選んだ理由、1 枚の HDR ターゲットに街・ブラー・ワイパー・雨のガラス・車内を重ねて最後に 1 回だけトーンマップするフレームの組み立て、TSL に移したブラーと雨のガラス、非同期になった通行人の写真、仮の node material で走らせているモジュールと後続（段階 B・C）が守るべき接点（main の空・光・ブルームを取り込んだ後の一覧）、three の WebGPU で踏んだ落とし穴。段階 B（空・霧・ブルーム・レンズフレア・水面を TSL に。太陽が見えているかをフレームのアルファで測る方法、閾値を放射輝度にしたブルーム、逆転深度での水面の鏡）と段階 C（外壁・地形の切り抜き・濡れた路面・街灯の光を TSL の node material に）、ブラウザなしで WGSL を生成して naga で検証する方法。
tags: [rendering]
status: draft
stale_after: 2027-04-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T20:40:00Z }
verified:
  - { by: process:vitest, at: 2026-10-04T20:01:00Z }
  - { by: process:tsc, at: 2026-10-04T20:01:00Z }
  - { by: process:vitest, at: 2026-10-04T20:38:00Z }
  - { by: process:tsc, at: 2026-10-04T20:38:00Z }
  - { by: process:vitest, at: 2026-10-04T20:41:00Z }
  - { by: process:tsc, at: 2026-10-04T20:41:00Z }
  - { by: process:naga, at: 2026-10-04T20:40:00Z }
  - { by: process:vitest, at: 2026-10-04T20:50:00Z }
  - { by: process:tsc, at: 2026-10-04T20:50:00Z }
  - { by: process:naga, at: 2026-10-04T20:50:00Z }
  - { by: process:glslang, at: 2026-10-04T20:50:00Z }
sources:
  - id: three-renderer
    resource: node_modules/three/src/renderers/common/Renderer.js（three 0.186.1）
    title: Renderer の _getFrameBufferTarget・_renderOutput・clear・copyFramebufferToTexture・compileAsync・needsFrameBufferTarget
    author: team:threejs
  - id: three-webgpu-backend
    resource: node_modules/three/src/renderers/webgpu/WebGPUBackend.js と utils/WebGPUTextureUtils.js（three 0.186.1）
    title: copyFramebufferToTexture の転送元、copyTextureToBuffer の 256 バイト行揃え、深度フォーマットの選び方
    author: team:threejs
  - id: three-shadow-node
    resource: node_modules/three/src/nodes/lighting/ShadowNode.js（three 0.186.1）
    title: updateBefore がカメラごと・フレームごとに影を描き直す条件
    author: team:threejs
  - id: three-texture-node
    resource: node_modules/three/src/nodes/accessors/TextureNode.js と nodes/display/ScreenNode.js（three 0.186.1）
    title: レンダーターゲットのテクスチャの v の向きと screenUV の原点（両バックエンド）
    author: team:threejs
  - id: three-node-material
    resource: node_modules/three/src/materials/nodes/NodeMaterial.js と renderers/common/nodes/NodeLibrary.js（three 0.186.1）
    title: fragmentNode も setupOutput（霧・premultipliedAlpha）を通ること、fromMaterial が古典マテリアルの全プロパティを写すこと
    author: team:threejs
  - id: phase-a-checks
    resource: tsc --noEmit・oxlint・vitest run（33 ファイル 311 件）・vite build（webgpu ブランチ、2026-10-05 05:00 JST）
    title: 段階 A の機械的な検査
    author: claude-opus-5-5/1m
  - id: webgl-version
    resource: git show e9969cf（main から分けた時点の WebGL 版）
    title: 移行前の実装（GLSL のシェーダーと WebGLRenderer の組み立て）
  - id: phase-c-wgsl
    resource: three 0.186.1 の WGSLNodeBuilder を Node（vitest、scratchpad/wgsl の別設定）で動かし、偽のキャンバスで作った未初期化の WebGPURenderer（hasFeature・hasCompatibility を差し替え）、影付きの DirectionalLight、CubeUV の環境マップで、外壁 3 種・地形・路面 5 種 × 雨の路面 3 種の 38 本の WGSL を生成し、naga（nixpkgs wgpu-utils 29.0.1）で検証（2026-10-05 05:33〜05:40 JST）
    title: 段階 C の node material の WGSL 生成と検証（WebGL 2 の GLSL は glslang 16.4.0 で、05:46 JST）
    author: claude-opus-5-5/1m
  - id: three-lighting-model
    resource: node_modules/three/src/nodes/functions/PhysicalLightingModel.js・nodes/lighting/LightsNode.js・LightingContextNode.js・materials/nodes/NodeMaterial.js・renderers/common/RenderObject.js（three 0.186.1）
    title: 照明モデルの start / indirect / ambientOcclusion の順、reflectedLight、マテリアルのキャッシュキー
    author: team:threejs
  - id: phase-b-wgsl
    resource: 段階 C と同じ方法（scratchpad/phaseB-wgsl の別設定、偽のキャンバスの未初期化 WebGPURenderer の backend.createNodeBuilder、forceWebGL で GLSLNodeBuilder）で、空・霧（MeshStandardNodeMaterial + scene.fogNode）・ブルーム 4 パス・レンズフレア 3 パス・水面 2 種の 11 マテリアルの頂点・フラグメントを生成し、WGSL を naga（wgpu-utils 29.0.1）、GLSL ES 3.0 を glslangValidator（glslang 16.4.0）で検証（2026-10-05 05:33〜05:50 JST）
    title: 段階 B のマテリアルの WGSL / GLSL の生成と検証
    author: claude-opus-5-5/1m
  - id: three-uniform-hash
    resource: node_modules/three/src/nodes/accessors/TextureNode.js（getUniformHash）と nodes/core/UniformNode.js（getSharedNode）（three 0.186.1）
    title: 同じテクスチャを持つ TextureNode が 1 つの uniform（binding）を共有する仕組み
    author: team:threejs
  - id: three-msaa-depth
    resource: node_modules/three/src/renderers/webgpu/utils/WebGPUUtils.js（getTextureSampleData）・WebGPUTextureUtils.js・WebGPUBackend.js（copyFramebufferToTexture）、renderers/common/Renderer.js（_updateCamera）、math/Matrix4.js（makePerspective）（three 0.186.1）
    title: 深度テクスチャは MSAA のサンプル数のまま作られること、描画時のカメラの座標系と逆転深度の付け替え、深度の範囲の約束
    author: team:threejs
  - id: phase-b-checks
    resource: tsc --noEmit・oxlint（新しい警告なし）・vitest run（40 ファイル 411 件）・vite build（出力先を scratchpad に分けて）（webgpu ブランチ、2026-10-05 05:50 JST）
    title: 段階 B の機械的な検査
    author: claude-opus-5-5/1m
  - id: merge-checks
    resource: main（0b230f6）を webgpu へ統合した後の tsc --noEmit・oxlint・vitest run（38 ファイル 391 件）・vite build（2026-10-05 05:40 JST）
    title: 統合後の機械的な検査
    author: claude-opus-5-5/1m
---

# 段階 A でしたこと

- `src/render/renderer.ts`: `WebGPURenderer`（`three/webgpu`）を作って `await renderer.init()`。トーンマップ ACES・出力 sRGB・影 PCF・解像度・アンチエイリアスは 画質 のまま。
- `src/render/frame.ts`: フレームの組み立て（`FrameComposer`）、街だけにかけるパス（`StreetPass`）の差し込み口、シーン用ターゲットの作り方（`sceneTarget`）、主視点以外で影を描き直さない `holdShadows`。
- TSL に移した: ブラー（`src/world/motionBlur.ts`）、雨のガラスの描画（`src/game/rainGlass.ts`。粒の物理 `RainSim` は CPU のまま、テストもそのまま通る）。
- WebGL 専用 API を置き換えた: `WebGLRenderTarget` → `RenderTarget`、通行人の写真の読み戻し → `readRenderTargetPixelsAsync`（非同期に）、ミラー、`renderer.capabilities.getMaxAnisotropy()` → `renderer.getMaxAnisotropy()`、タイルの解像度設定。
- 段階 B・C のモジュールは仮の node material か「効果なし」で走らせ、`WEBGPU-TODO(phase B|C)` を付けた（下の表）。
- 起動時に `compileAsync` でパイプラインを先に作る（下の「読み込み」）。

# 描画方式（画質）

`GraphicsSettings.backend: "auto" | "webgl"`、行は「描画方式」、再読み込みで反映。

- `auto`: WebGPURenderer が選ぶ（`navigator.gpu` とアダプタがあれば WebGPU、無ければ WebGL 2 バックエンド）。
- `webgl`: `forceWebGL: true`（WebGPU で GPU やドライバが不具合を起こすときの逃げ道）。
- 品質の段階ではないので、プリセットは触らない（`inPreset: false`）。低 を選んでも WebGL 2 のまま、WebGL 2 にしてもプリセットは カスタム にならない（tests/graphics.test.ts）。
- 設定画面に「いまの描画方式: WebGPU」または「WebGL 2（設定で選択 / この端末・ブラウザに WebGPU が無いため）」を出す（`RenderInfo.label`）。

# 深度: 逆転 float 深度（reversedDepthBuffer）

世界は 0.5 m〜40 km。WebGL 版は通常の [0, 1] 深度で道路の白線と縁石がちらつき、対数深度（logarithmicDepthBuffer）にしていた。

| 方式                               | 4 km 先の分解能の目安              | 早期深度テスト                               |
| ---------------------------------- | ---------------------------------- | -------------------------------------------- |
| 通常深度 24 bit                    | 使えない（ちらついた）             | 効く                                         |
| 対数深度（24 bit に gl_FragDepth） | 約 2.5 mm（Δz ≈ z·ln(1+far)·2⁻²⁴） | **効かない**（フラグメントで深度を書くため） |
| 逆転 float 深度（depth32float）    | 約 0.25〜0.5 mm（Δz ≈ z·2⁻²⁴〜²³） | 効く                                         |

数値は式からの見積もりで、実測ではない。逆転深度を選んだ理由は精度より **早期深度テストが残ること**: 対数深度では建物の陰になる外壁・道路のフラグメントもすべて陰影計算される。

- WebGL 2 バックエンドで `EXT_clip_control` が無いと three が逆転深度を外す。そのときだけ `logarithmicDepthBuffer = true` に戻す（`renderer.init()` の後、マテリアルが組まれる前。NodeMaterial は組むときにこのフラグを読む）。
- **落とし穴**: レンダーターゲットの自動の深度バッファは `reversedDepthBuffer` でも depth24plus になる（Textures.js が `UnsignedIntType` で作る）。`sceneTarget()` は `DepthTexture(w, h, FloatType)` を付けて depth32float にしている。[^three-webgpu-backend]

# フレームの組み立て

```
（雨のとき）粒 → 粒テクスチャ（ガラス空間、HalfFloat）
world（主カメラ near 0.5 m、レイヤー 0）           ┐
→ 街のパス: ブルーム → レンズフレア → ブラー    │ 1 枚の HDR ターゲット
→ ワイパー（近接カメラ near 2 cm、OUTSIDE_LAYER = 2）│ （RGBA16F・MSAA・depth32float）
→ ガラス用のコピー（街 + ワイパー、ミップ付き）        │
→ 車内（近接カメラ、INTERIOR_LAYER = 1、深度クリア）  │
→ フロントガラス（車内の深度で隠れ、コピーを屈折）     ┘
→ フレームの読み取り（レンズフレアの太陽の探り、1×1 へ）
→ present: ACES（環境の露出）+ sRGB でキャンバスへ 1 回
```

守っている性質（WebGL 版と同じ）: 街だけがブラーで流れ、ワイパーと車内はシャープ、ガラスの水は街とワイパーを屈折させて車内は映さない、車内は近接カメラなので切れない。

## なぜこの形か

- **WebGPURenderer は render() のたびにキャンバスへ出力パスを走らせる。** トーンマップか sRGB 出力があると `needsFrameBufferTarget` が真になり、キャンバスへの render() と clear() は内部の HDR ターゲットに描いてから全画面の出力パス（`_renderOutput`）でキャンバスへ書く。autoClear を切って何度も描くと、内部ターゲットには正しく重なるが、出力パスが毎回（このフレームなら 5〜6 回）走る。[^three-renderer] 自前のターゲットへ描けば `isOutputTarget` が偽でトーンマップされず、最後の 1 回だけになる。
- **copyFramebufferToTexture は線形 HDR を読む**（内部ターゲット、または今のレンダーターゲットの解決済みテクスチャ）。表示用に変換された値ではない。コピー先の FramebufferTexture はフォーマットを合わせないと失敗する（`type = HalfFloatType`）。[^three-webgpu-backend]
- RenderPipeline と pass() を使わなかった理由: pass() は 1 つごとに全画面の色と深度のターゲットを持ち一から描く。ここは同じターゲットに重ね描きし、ガラスは車内の深度で隠れる必要がある。
- 重ね描きは `autoClearColor = false, autoClearDepth = true` で 1 パスにまとめた（`renderer.clearDepth()` は独立したパスになる）。

## 街のパス（ブルームとレンズフレアの差し込み口）

`composer.streetPasses` に順に並べる（main.ts で `push(bloom, lensFlare, blur)`）。`StreetPass` は `isActive()` と `build(street: TextureNode): Node<"vec4">`、段階 B で足した任意の `prepare(street: Texture)`（全画面のパスの前に自分の描画をする: ブルームの縮小と拡大の連鎖）。どれも動いていないフレームはコピーも描画も無い。動くときは街を 1 回コピーし、途中のパスは中間ターゲット（MSAA なし）、最後のパスはフレームへ書き戻す。

- `composer.frameReaders`（段階 B）: present() のトーンマップの直前に、出来上がったフレーム（車内・ガラス込み、線形 HDR）を読む。レンズフレアの太陽の探りが使う。
- three の `BloomNode`・`LensflareNode` は `updateBefore` が FRAME 単位で、ノードフレームは `renderer.init()` が始めるレンダラーのアニメーションループで進む（アプリの requestAnimationFrame は後から登録されるので、毎フレームその後に走る）。段階 B ではどちらも使わず、自前のパスにした（下）。
- 線形 HDR のまま流すので、ブラーで街灯は明るい筋になる（WebGL 版はトーンマップ後の値を流していた）。

# 移した部分の要点

## ブラー（motionBlur.ts）

10 タップを TSL でビルド時に展開。焦点（消失点）は screenUV（左上原点）で渡す。`apply()` は `update(view, w, h)` と街のパスになった（`isInside` は常に偽だったので削除）。読み込み画面と再生では `stop()`。

## 雨のガラス（rainGlass.ts）

- 粒はインスタンス化した四角形で、`vertexNode` にクリップ座標を直接書く。**ガラスの v の上をターゲットの上（行 0）に描く**（y を反転、裏返るので DoubleSide）。three はレンダーターゲットのテクスチャを両バックエンドとも v = 0 が上になるよう読む（GLSL ビルダーは RT と FramebufferTexture の v を反転する）。だからガラスはガラスの UV でそのまま引ける。[^three-texture-node]
- ガラスのシェーダーの画面座標は screenUV（両バックエンドで左上原点）に揃え、投影から求める点も `(x·0.5+0.5, 0.5−y·0.5)` に直した。
- 微分（dFdx・fwidth）とミップを暗黙に選ぶサンプルは分岐の外に置いた（WGSL は一様な制御フローを要求する）。フレームのコピーは `.level()` で明示。
- コピーが線形 HDR になったので、夜に明るい部分を押し上げていた補正（`seen += max(seen − 0.55, 0)·2.5·glow`）は外した。全体のにじみ（halo）は調整した範囲に収めるため `h/(1+h)` で圧縮。
- `premultipliedAlpha` のマテリアルは fragmentNode の出力も three が掛ける（setupOutput を通る）。粒は乗算前の色を返す。[^three-node-material]

## 通行人の写真（witnessShot.ts）

WebGPU に同期の読み戻しは無い。違反の瞬間に、最初の数か所の検査（車あり・なし）と、簡易判定でいちばんの場所からの写真を描き、読み戻しを待つ。

- その場所から車が見えていればその写真を使う。見えていなければ、見えた最初の場所から **少し後に** 撮り直す（そのときの車の位置へ向ける）。全候補の写真を一度に描かないのは、違反のフレームで 4 回の本描画が引っかかりになるから。
- `post.filmedFrom` と写真は読み戻しの後に入る。経緯度は `ShotWorld.filmed` で main.ts が付ける。同じ違反の 5 人目以降は先の 1 枚の現像を待って共有する。
- 写真のシーンも `sceneTarget`（フレームと同じフォーマット・MSAA）に描き、`composer.toDisplay()` で ACES + sRGB の 8 bit に変換して読む。WebGPU はトーンマップを別パスでするので、写真のために各マテリアルの別パイプラインはできない（WebGL 版は XR ターゲットの印でこれを避けていた）。
- `readRenderTargetPixelsAsync` は呼んだ時点でコピーを積む（await の前まで同期）。ターゲットはすぐ使い回せる。WebGPU は行が上から、各行 256 バイト揃え。`readPixels()`（renderer.ts）で詰めて下から並べ直し、現像は GL の順のまま。

## ミラー（cockpit.ts）

`sceneTarget` を最初の更新で作る（フレームとパイプラインを共有するため、レンダラーが要る）。描画は `holdShadows` の中。

## キャンバスの画像（F12/0 のスクリーンショット、違反の記録の画面）

present と同じタスクで `canvas.toBlob` / `drawImage`。WebGPU のキャンバスでも、提示前の現在のテクスチャが読める前提（実機で確認する項目）。

## socialAvatars.ts と assetsPage.ts の WebGLRenderer は残した

どちらも画面外の小さなキャンバスに描いて画像にするだけで、ゲームのレンダラーとターゲットを共有しない。WebGPU に移すと読み戻しが非同期になり、プロフィール画像の描き方（描いてすぐ drawImage）を作り直すことになる。同じマテリアルやテクスチャを両方のレンダラーが描いても、GPU 側の資源はそれぞれが別に持つ。`three` と `three/webgpu` はどちらも `three.core.js` を読むので、Mesh や Texture のクラスは同じもの。

# 段階 B でしたこと

空（skyShader.ts）・霧（atmosphere.ts）・ブルーム（bloom.ts）・レンズフレア（lensFlare.ts、新規）・水面（waterMaterial.ts・water.ts）を TSL に移した。式と数値は main の GLSL のまま（設計は [空・光・ブルーム](sky-light-and-bloom.md)、[深度フォグ](atmosphere-and-replay-data.md)、[川・運河・海の水面](rivers-and-water.md)）。`WEBGPU-TODO(phase B)` は残っていない。

## 空（skyShader.ts の `TokyoSky`）

- three の SkyMesh（Sky.js の TSL 版）を項ごとに写した自前の空に、main が Sky.js の GLSL に足した 5 か所を同じ位置で入れた: 雲の奥（オゾン・ゲイン・薄明・光害・星）、雲（雲底を照らす街の光）、雲の手前（雨の雲、環境マップ用の地面と街並み）、最後（地平の霞）。
- SkyMesh を継がなかった理由: ノイズ・fbm・varying がコンストラクタの中の局所変数で、星と光害を雲の合成の前に差し込めない。
- uniform の名前と型は SkyMesh と同じ（turbidity … showSunDisc。環境マップの空へ写す `SKY_COPIED` もそのまま）。追加の値は `look`（SkyLook、TSL の uniform で `.value` の型は main と同じ）。環境マップの空も同じクラスで、`syncEnvSky` が uGround.w = 1 にする。
- 追加はそれぞれの uniform の分岐（一様な分岐）の中。昼の晴れた空はオゾンとゲインの掛け算だけが増える。
- 地平の霞は線形で混ぜる（main はトーンマップ後の表示値に、トーンマップした霞を混ぜていた）。霧も node material では線形で混ざって最後に一緒にトーンマップされるので、地平で霞の色（霧の色 + 太陽の光芒）に溶ける性質は同じ（地平では両方とも霞の色そのもの、途中の混ざり方だけが線形になった）。
- 太陽の円盤（放射輝度 ~6·10⁴）は 60000 で抑える（フレームの半精度の上限 65504。Inf はブルームで NaN になる）。ゲインは円盤にも掛かるので、雲が円盤を隠す量もゲイン後の値にした（SkyMesh は円盤を雲で隠すが、GLSL の Sky.js は隠さない。SkyMesh に合わせた）。

## 霧（atmosphere.ts）

- `atmosphereFog(fog)` を `scene.fogNode` に置く（NodeManager は `scene.fogNode` を `scene.fog` より先に使う）。τ の積分、高さで薄まる霞、太陽まわりの散乱、線形の霧の下限は main の式。
- three の Fog は色（放射輝度）・near・far の入れ物として残した。霧のノードは `reference()` を render ごとに読み、水面は地平の色にこの色を使う。
- `ATMOSPHERE` の 3 つは Vector4 / Vector3 になり、`FOG_UNIFORMS`（renderGroup の uniform）が参照で読む。Environment.update が成分を書く形は main と同じ。空の霞も同じ uniform を読む。
- GLSL のチャンクの差し替え（`installAtmosphere`）は消した。WebGLRenderer に残った画面（アバター・アセット）は霧を使っていない。

## ブルーム（bloom.ts）

- 街のパス。`prepare()` で半分（低: 1/4）から 1/32 までの dual filter（Kawase）を描き、全画面のパスで街に足す。Karis 平均・4×4 の箱の前処理・段の数は main のまま。
- フレームが線形の半精度になったので、閾値は「露出を掛けた放射輝度」: 昼 9・夜 0.55、薄明は等比（絞りの段）で移す。膝は閾値の 0.35 倍、1 画素が持ち込める明るさは 40 まで（太陽の円盤 6·10⁴ が連鎖を塗りつぶさないように）。強さは昼 0.04・夜 0.30（雨の夜は 1.35 倍）。テストは tests/sky.test.ts。
- 根拠（露出後の値）: 昼の地平の空の最大チャンネル ~5.4（main の実測の表示値 252 を ACES と露出 1 で逆算）、日なたの白い壁 ~1.5、夜の光害 ~0.1、信号のレンズ ~0.8（MeshBasic、色 × 画像）、ロービーム 1.8 × 0.8、街灯の灯具 ×10 で ~8。main の表示値の閾値（昼 0.975・夜 0.79）を同じく逆算すると露出後で昼 ~3.6・夜 ~0.55。昼は空の青を拾うので 9 に上げ、夜は同じにした。強さは見た目で決める値（下の「確かめていないこと」）。
- three の BloomNode を使わなかった理由: 5 段の分離ガウス（11 パス・最大 22 タップ）で、Karis 平均が無く、updateBefore がノードフレームで走る。main と同じ dual filter の方が軽い。
- 画質 レンズフレア あり で、夜（nightFactor 0.3〜0.9 で入る）だけ街灯・ヘッドライトのゴーストを足す（ブルームの 1/8 の段を画面の中心で折り返し、中心へ向かって 4 つ。John Chapman の擬似レンズフレア）。昼の太陽のゴーストはレンズフレアのパスが描く。

## レンズフレア（lensFlare.ts、画質 レンズフレア）

- **見た目**: 太陽から画面の中心を通る線上のゴースト 7 つ（太陽側 0.62・0.3、中心の向こう −0.28 〜 −1.65。3 つは絞りの六角形、4 つは丸、縁が少し明るい円盤、コーティングの色）、太陽を中心とする細い輪（半径は画面の高さの 0.42、外が赤く内が青い）、絞り 6 枚の光条（6 本と、その間の細い筋）。どれも露出で割った値を足すので、目の順応（夜 0.8〜夕方 1.4）で見え方が変わらない。
- **太陽が見えているかは測る**:
  1. 探り（プローブ）: 太陽の方向 30 km 先に、太陽の円盤の芯（0.0065 rad）の大きさの四角を、空の直後（renderOrder −999）に描く。CustomBlending で色はそのまま、アルファだけを 0 にする。深度テストは街の深度に対してなので、建物・木・車・地形が前にあれば、それらが不透明の 1 で塗り直す（描く順に関係なく）。半透明の物（雨の線・ガラス）は割合だけ残る。主カメラで描く間だけ見せる（水の反射・ミラー・写真には描かれない）。
  2. 読み取り（フレームの読み取り）: 車内とガラスまで描いたフレームで、太陽の位置の 7 タップ（中心と 0.6 倍の輪）から「(1 − アルファ) × 円盤の明るさの割合（露出後 30〜300 で 0→1）」の平均を 1×1 の 8 bit に書き、非同期で読み戻す（1〜2 フレーム遅れ、0.08 s でならす）。
  - 雲が円盤の前に来ると空のシェーダーが円盤を消すので明るさで消え、地平の霞で円盤が暗くなる低い太陽も明るさで消える（試算: 仰角 3° で露出前 ~2,400、1° で ~45）。overcast 0.15〜0.6 でも消す（雨の雲の層には円盤が無い）。円盤が +2°〜−0.5° で沈むのにも合わせる。
- **運転席（判断）**: 屋根の線より上の太陽では出さない。読み取りが車内込みのフレームを見るので、屋根・ピラー・ミラーが太陽を隠せば自動で消え、フロントガラス越しの太陽（不透明度 0.08 のガラス）では出る。フレアは街のパスなので、ゴーストが車内やワイパーの上に描かれることは無い（ダッシュボードにかかる部分は車内で隠れる）。
- 深度を読まなかった理由: フレームの深度は MSAA の depth32float で、テクスチャもサンプル数のまま作られる（three の getTextureSampleData）。シェーダーからはサンプルごとにしか読めず、コピーは同じサンプル数どうししかできない。アルファは出力パスが不透明にするので空いていて、色と一緒に解決（resolve）される。[^three-msaa-depth] occlusion query を使わなかった理由: three は render の最中にしか結果を返さず（render context ごと）、別のパスで描く車内を含められない。
- three の LensflareNode（画面の明るい所を折り返す擬似フレア）を太陽に使わなかった理由: 太陽のゴーストが周りの空のぼけた写しになり、太陽と照り返しの区別もつかない。夜の灯りにはその方式を使う（上）。
- 費用: 太陽が画面に無い・隠れている（読み取りが 0）フレームは、探りも読み取りもフレアのパスも無い。見えているときは四角 1 枚、1×1 に 7 タップ、全画面のパス 1 枚（ゴースト 7・輪 3・光条）、1×1 の読み戻し。

## 水面（waterMaterial.ts・water.ts）

- 材質: main の GLSL を項ごとに TSL へ（うねり 4 本〔スマホ 2 本〕とバリューノイズ 4 オクターブの傾き、距離で穏やかに・雨で荒く、Fresnel、濁った本体の色、太陽の照り返し、潮位、霧）。ループはビルド時に展開し、オクターブごとの格子の回転は定数にした。ノイズの値はオクターブごとに変数にした（そのままだと各成分の式が 4 回ずつ展開され、WGSL の行が 1 万字近くになった）。uniform の名前と値の型は main のまま（uReflection は TextureNode で、`.value` にテクスチャ）。
- 反射の取得は分岐の外で level 0（GLSL は `if (onPlane > 0)` の中で取っていた。暗黙の LOD の取得は WGSL では一様な制御フローの中でなければならない）。
- 平面反射を再び描く: 鏡のカメラに、投影を作る前にレンダラーの座標系（`renderer.coordinateSystem`）と逆転深度を付ける。付けないと最初の描画で Renderer._updateCamera が投影を作り直し、斜めの近平面が消える（逆転深度のフラグには setter が無いので `Reflect.set(m, "_reversedDepth", …)`）。[^three-msaa-depth]
- 斜めの近平面（Lengyel）は WebGL の −1…1 用の式だったので、任意の深度範囲に一般化した（render/obliqueClip.ts。近平面 n・遠平面 f、s = sign(f − n) として行 3 を n·行 4 + s·a·C、a = |f − n|·(行 4·Q)/(C·Q)。WebGL では Lengyel の式そのもの）。tests/obliqueClip.test.ts が WebGL −1…1・WebGPU 0…1・逆転 1…0（両方の座標系）で、水面より上は範囲内・水面より下は近平面の外・水面上は近平面ちょうど・x と y の行は不変を確かめる。
- 反射のターゲットは `sceneTarget`（フレームと同じ形式・MSAA・depth32float の半分の大きさ）: 町のパイプラインがフレームと共有され、最初の反射で何も組み直さない。テクスチャ行列は v を反転（three はレンダーターゲットの行 0 を v = 0 で読む）。clear() を別に呼ばず autoClear で描く。
- 画質 空の映り込み なし（低）とスマホは、反射を描かず空だけを映す（main はスマホだけ）。

## ブラウザなしの検証

- 段階 C と同じ方法で、空・霧（標準マテリアル + scene.fogNode）・ブルーム 4 パス・レンズフレア 3 パス（探り・読み取り・フレア）・水面 2 種（うねり 2 本・4 本）の 11 マテリアルの頂点とフラグメント 22 本を、WGSL は naga、WebGL 2 の GLSL は glslang に通し、すべて通った。フラグメントの行数（WGSL）は空 470、水面 269、ブルームの前処理 129、フレア 100、霧の入った標準マテリアル 136。[^phase-b-wgsl]
- 機械的な検査: tsc・oxlint（新しい警告なし）・vitest 40 ファイル 411 件・vite build。[^phase-b-checks]
- 分かるのは「シェーダーとして正しく、一様性の規則を守っている」まで。見た目・閾値と強さの釣り合い・フレーム時間は実機の Chrome で見る（[検証](#検証)）。

# 段階 C でしたこと

外壁（facade.ts）、地形の水面の切り抜き（terrain.ts）、路面と歩道（roadSurface.ts・pavements.ts）の濡れと街灯の光（streetLights.ts）を、GLSL の onBeforeCompile から TSL の node material に移した。計算と数値は main の GLSL のまま（各モジュールの文書: [外壁](building-facade-shader.md)、[道路照明と濡れた路面](street-lighting-and-wet-roads.md)）。描画呼び出しは増えていない。

## 組み方

- **段ごとのノードと、段をまたぐ変数**: GLSL は 1 つのチャンクで求めた値（窓かどうか、点灯、濡れの膜と水たまり）を後のチャンクが読んでいた。TSL では `colorNode` の Fn の中で `property()`（シェーダー全体の変数）に代入し、`roughnessNode`・`metalnessNode`・`normalNode`・`emissiveNode` と照明モデルがそれを読む。NodeMaterial.setup が色 → 粗さ・金属 → 照明（法線はそこで初めて組まれる）→ 発光の順に組むので、代入は読む前に出る。生成した WGSL で順を確かめた。[^phase-c-wgsl]
- **照明モデルを継ぐ**: 外壁の地面際の暗がりは `PhysicalLightingModel.ambientOcclusion` を上書きして間接光にだけ掛ける（`aoNode` だと three の鏡面の遮蔽式になり、GLSL の `mix(1, ao, 0.6)` と違う）。街灯の光は `start()` で太陽と環境光の後に `reflectedLight.directDiffuse / directSpecular` へ足す（GLSL の `lights_fragment_end` の後と同じ位置）。[^three-lighting-model]
- **画質の切り替え**: 夜の窓（3 種）と雨の路面（3 種）は、設定ごとに別の node のグラフ。同じ設定・同じ種類のマテリアルは同じノードを共有するので、パイプラインも 1 つ。`GRAPHICS.onChange` でノードを差し替えて `needsUpdate`。街灯の数は uniform（`stState.x`）なので組み直しなし。
- **キャッシュキー**: RenderObject のキーは `customProgramCacheKey()`（ノードの構造の hash）とマテリアルの列挙できるプロパティ（数値は 0 か非 0 だけ）から作られる。照明モデルはノードではないので、種類と設定を `customProgramCacheKey()` に足した。[^three-lighting-model]
- **uniform**: 毎フレームの値（外壁の時刻・濡れ・点灯割合、街灯の配列）は `renderGroup` に置いた。共有の bind group で、render ごとに 1 回だけ転送される（既定の objectGroup だとタイルの描画ごと）。
- **アスファルトの UV**: 道路のジオメトリに uv が無いので、段階 A の仮と同じく main のワールド XZ（4 m で 1 枚）で 3 枚を引く。法線マップの接空間は main で three が UV の微分から作っていた向き（u = +x、v = +z）を、ビュー空間で幾何法線から直接組む。三面投影にしなかった理由: 路面はほぼ水平で、main の見た目がこの平面投影だから（縁石の側面は別マテリアルで uv を持つ）。
- **地形**: `maskNode`（偽なら捨てる）に「水のマスク > 0.5 でない」を、写真が載った時に入れる（main も写真の UV を読むので写真の後だけ）。チャンクの水のマスクは TextureNode の `.value` を差し替える。空のマスクも本物と同じ線形フィルターにした（ノードのサンプラーは差し替えで作り直されない前提にしないため）。

## GLSL 版との違い

- 外壁の地面際の暗がり・ガラス・部屋・濡れは同じ式。部屋（interior mapping）は面ごとの色を全部求めて当たった面を選ぶ形にした（GLSL は if/else の連鎖）。どちらも点灯した近くの窓の分岐の中だけで計算する。
- 波紋の分岐の条件を「雨」から「雨かつ水たまり」にした（GLSL も水たまりの係数を掛けて 0 にしていたので見た目は同じ、水たまりの外の計算が減る）。
- 外壁の窓の表（用途ごとの点灯の相関、色温度の平均、明るさ）は GLSL の const 配列から select の連鎖に（`byIndex`、render/shaderMath.ts）。
- 路面の `streetShading(material, kind, hasStreet)` は `new StreetMaterial(kind, { hasStreet, base, ...params })` に変わった（node material は別のクラスなので、既存のマテリアルに後から足す形にできない）。
- 灯具の発光（レンズ）は段階 A のまま MeshBasicMaterial の instanceColor ×10（線形 HDR のまま半精度のフレームに入り、ブルームは段階 B）。

## ブラウザなしの検証（WGSL の生成と naga）

ヘッドレス Chrome を使えないので、three の WGSLNodeBuilder を Node 上で動かして WGSL を作り、naga（wgpu のシェーダー検証器。一様性の解析もする）に通した。[^phase-c-wgsl]

- 作り方: `new WebGPURenderer({ canvas: 偽のオブジェクト })`（init しない）の `backend.createNodeBuilder(mesh, renderer)` に scene・camera・material・`lighting.getNode(scene)`（`setLights([sun])`）・`environmentNode` を入れて `build()`。`hasFeature`・`hasCompatibility` は init 前だと例外になるので差し替え、`shadowMap.enabled = true` で影の取得も入れる。`builder.vertexShader` / `fragmentShader` をファイルに書いて `naga <file>`。naga は nixpkgs の `wgpu-utils` に入っている（`nix build nixpkgs#wgpu-utils`、プロファイルには入れない）。
- 結果: 外壁 flat / lit / rooms、地形、アスファルト（ワールド XZ のマップ）・区画線・標示（map と alphaTest）・歩道・縁石 × 雨の路面 3 種の 38 本がすべて検証を通った。フラグメントの行数は外壁 1,153 / 1,833 / 2,006、アスファルト 1,101 / 1,121 / 1,342（なし / 濡れ / 水たまり）。
- テクスチャのフィルターが Nearest だと three は `textureLoad` を出す（`isUnfilterable`）。暗黙の LOD の取得を検証するには線形・ミップ付きのテクスチャで作ること。
- 描画方式 WebGL 2 の経路も同じように確かめた: `forceWebGL: true` の WebGPURenderer の `backend.createNodeBuilder` は GLSLNodeBuilder を返す。同じ 38 本の GLSL ES 3.0 を glslang（nixpkgs `glslang` 16.4.0 の glslangValidator、`-S vert|frag`）に通し、すべてエラーなし（わざと型を間違えた版ではエラーになることも確かめた）。[^phase-c-wgsl]
- これで分かるのは「WGSL / GLSL として正しく、微分とテクスチャ取得が一様な制御フローにある」まで。見た目とフレーム時間は実機の Chrome で見る。

# 残り（段階 B・C）と守る接点

main の 7 コミット（案内標識・車と運転席の寸法・空と光とブルーム・ミラーの飾り・交差点の曲がり方・東京駅）を取り込んだ後（2026-10-05）の一覧。段階の分け方は提案（B = 空・空気・水・光の後処理、C = 路面と建物の表面）。空・光・ブルームの WebGL 版の設計は [空・光・ブルーム](sky-light-and-bloom.md)。

## 統合で取ったもの・移したもの・残したもの

- **そのまま動く（CPU だけ）**: skyLight.ts の光の釣り合い（太陽・天空光・霧の色・露出・環境の強さ）、天気の移り変わり（`overcast` を 25 s で）、`wetness`、おまかせの天気、霞の減衰の追従。Environment.update は main のまま。
- **three/webgpu へ移した**: skyEnvMap.ts（空から作る環境マップ）。`PMREMGenerator`・`CubeRenderTarget` を three/webgpu の方に、空を SkyMesh にした（段階 B で `TokyoSky` に）。描き直しの間隔（`isEnvStale`、画質 空の映り込み 高 256 / 低 64 / なし = スタジオ）とターゲットの使い回し（`fromCubemap(…, target)` で `scene.environment` の同一性を保つ）は main のまま。
- **段階 B へ回した（統合の時点では GLSL のまま、WebGPU では動かなかった）**: skyShader.ts の空への追加、bloom.ts のブルーム、atmosphere.ts の霧の色のトーンマップ（WebGPU では不要。下の表）。段階 B で移した（上の「段階 B でしたこと」）。
- **雨のガラス**: TSL 版のまま、main の新しいガラスの寸法（1.4719 × 0.837 m、傾き 26.9°、`SIN_RAKE`・`COS_RAKE`）・ガラスの原点（0.7359, 0.1618, 0.9465）・ワイパーの軸と停止角を使う。
- **一時停止中の描画**: main は一時停止中も運転席を通して描くようになった（ミラーの飾りが揺れ止むまで）。合成でもブラーを止めて同じように描く。
- 案内標識（guideSigns.ts）・ミラーの飾り（mirrorCharm.ts、MeshPhysicalMaterial の sheen）・交差点の曲がり方（drivePath.ts）・東京駅のモデルは WebGL 専用の API を使っていない。

## モジュールごとの今と残り

| モジュール                       | 今（WebGPU）                                                                                                                     | 移すもの | 守る接点                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skyShader.ts（B）                | **段階 B で移植**: `TokyoSky`（SkyMesh を写した TSL の空に、光害・星・薄明・オゾン・雨の雲・地平の霞・環境マップの地面と街並み） | —        | `SkyLook`（TSL の uniform、`.value` は main の型）。Environment.update が skyLight.ts の値を書き、`syncEnvSky` が環境マップの空へ写す。uniform の名前は SkyMesh と同じ                                   |
| skyEnvMap.ts（B）                | **段階 B で移植**: 空は `TokyoSky`（uGround.w = 1 で地面と街並み）                                                               | —        | `SkyEnvMap(renderer, size)`・`update(state, nowMs, sync, step, gapMs)`・`texture`・`look`・`isEnvStale`（tests/sky.test.ts）                                                                             |
| environment.ts（B）              | **段階 B で移植**: `TokyoSky`、`scene.fogNode = atmosphereFog(fog)`                                                              | —        | `sun`・`nightFactor`・`sunElevation`・`wetness`・`overcast`・`envMap`、`toneMappingExposure` を環境が決める、画質 `reflections`                                                                          |
| atmosphere.ts（B）               | **段階 B で移植**: `atmosphereFog()`（scene.fogNode）、`FOG_UNIFORMS`、`hazeTint()`                                              | —        | `ATMOSPHERE.fogAtmo / fogSun / fogSunColor`（Vector4 / Vector3、Environment.update が成分を書く）、`extinctionFor`                                                                                       |
| bloom.ts（B）                    | **段階 B で移植**: 街のパス（`prepare` で dual filter、閾値は露出後の放射輝度）、夜の灯りのゴースト（`ghosts`）                  | —        | `bloomSettings(env.nightFactor, env.overcast)`・`bloomShare`（tests/sky.test.ts）、画質 `bloom`（high/low/off）、`StreetPass`                                                                            |
| water.ts / waterMaterial.ts（B） | **段階 B で移植**: TSL の水面、平面反射（sceneTarget、逆転深度の斜めの近平面）                                                   | —        | `material.uniforms` の名前と値の型、`renderReflection()`、メッシュごとの `onBeforeRender` で uReflectionOn、uSkyHorizon は霧の色。画質 `reflections` なしとスマホは空だけ                                |
| lensFlare.ts（B、新規）          | **段階 B で追加**: 街のパスとフレームの読み取り（太陽の探り）、画質 `lensFlare`                                                  | —        | `update(camera, sun)`（main.ts の `placeFlare`、フレームの前に）、`composer.frameReaders`                                                                                                                |
| facade.ts（C）                   | **段階 C で移植**: TSL の MeshStandardNodeMaterial（`facadeMaterial()`）。夜の窓 3 種は 3 つの node のグラフ                     | —        | `facade` 属性、`facadeUniforms`（uNight・uTime・uWet・uOrigin は TSL の uniform で `.value` のまま、uLitShare・uFacadeTex は `{ value }`）、`Buildings.setNightFactor`・`setFacadeClock`、画質 `windows` |
| terrain.ts（C）                  | **段階 C で移植**: MeshStandardNodeMaterial の `maskNode` で水面を捨てる（写真が載ってから）                                     | —        | `setWater`・チャンクの `water`（TextureNode、`.value` を差し替える）                                                                                                                                     |
| roadSurface.ts（C）              | **段階 C で移植**: `StreetMaterial`。アスファルトは 3 枚のマップをワールド XZ で（main と同じ平面投影）                          | —        | `aStreet` 属性、`new StreetMaterial(kind, { hasStreet, base, ...params })`（`streetShading()` は廃止）                                                                                                   |
| streetLights.ts（C）             | **段階 C で移植**: 濡れ・水たまり・波紋（色・粗さ・法線の段）、光だまり・筋・きらめき（照明モデル）                              | —        | `UNIFORMS`（TSL の uniformArray / uniform、StreetLights.update が書く）、`env.wetness`、画質 `wetRoads`・`streetLights`                                                                                  |

- 古典マテリアルの `onBeforeCompile`・`defines`・`customProgramCacheKey` は node material では無視され、エラーにもならない。ShaderMaterial / RawShaderMaterial は使えない（段階 B で bloom.ts も TSL になり、ゲームのレンダラーで ShaderMaterial を使う所は無くなった）。
- 古典マテリアルに `colorNode` などを足すと効く: `NodeLibrary.fromMaterial` は古典マテリアルの列挙できるプロパティをすべて node material に写す。[^three-node-material] 段階 C は MeshStandardNodeMaterial に置き換える方が型も素直。

# 読み込み（compileAsync）

町が読めたら「描画の準備中（シェーダーを作成）…」を出し、`compileAsync` を待ってから「準備完了！」。

- スタート地点の路上から 4 方向（視野 100°）、後から出てくる車種（バス・大型・8t・バイク・パトカー・覆面・白バイ・一般車）と歩行者（compileAsync が集める間だけシーンに入れる）、運転席（車内・ワイパー・ガラス・粒）、街のパス。
- **パイプラインは描き先のフォーマットとサンプル数ごと。** compileAsync は呼んだときのレンダーターゲットで作るので、フレームのターゲットを結んでから呼ぶ。ミラーと写真も同じ `sceneTarget` にして共有させた。
- ついでに直した: 準備完了の後も毎フレーム「読み込み中… 100%」に戻っていた表示。

# 落とし穴

- **`three` と `three/webgpu` の混在**: r186 では両方が `build/three.core.js` を import するので、コアのクラスは 1 つ（`three/addons` のローダーが `three` を読んでも問題ない）。ただし **同名で別物** がある: `PMREMGenerator`（`three` は WebGL 用）、`Sky`（GLSL）と `SkyMesh`（TSL）。レンダラー・node material・RenderTarget まわりは `three/webgpu`、TSL は `three/tsl` から。
- **影はカメラごとに描き直される**: ShadowNode は「このフレームでこのカメラに描いたか」で判定するので、近接カメラ・ミラー・写真・水の反射のたびに太陽の影を描き直す。[^three-shadow-node] `renderer.shadowMap.autoUpdate`（WebGL 版が使っていた）は WebGPURenderer に無い。`holdShadows()` が光ごとの `shadow.autoUpdate` を一時的に切る。
- **polygonOffset の向き**: three は係数をそのまま渡すので、逆転深度では負の値が面の奥へ押す。`towardEye()`（renderer.ts）で向きを合わせる（消火栓の路面表示）。対数深度では効かない（フラグメントが深度を書く）。
- **投影した z で前後を判定しない**: WebGPU の z は 0…1、さらに逆転。消失点の判定はカメラ空間の z < 0 に変えた。`Frustum.setFromProjectionMatrix` には `camera.coordinateSystem` と `camera.reversedDepth` を渡す（3d-tiles-renderer は自分で渡している）。
- **SkyMesh と逆転深度**: SkyMesh は z = w（遠方平面）で深度を書かない。逆転深度では 1 は近い側なので、空より先に描いたものは空で塗られる。中心がカメラなので距離の並べ替えも当てにならず、`renderOrder = −1000` で最初に描く。
- **WGSL の一様性**: 分岐（If・select の片側ではなく実際の if）の中で微分や暗黙ミップのサンプルを使うと検証エラー。
- **NodeMaterial.fragmentNode も setupOutput を通る**: `fog` と `premultipliedAlpha` が効く。自前のマテリアルは `fog = false`。
- **WebGPU のキャンバスへの出力**: `alpha: false`（WebGPURenderer の既定は true で、透明なマテリアルがキャンバスの透け穴になる）、出力ノードもアルファ 1。
- **読み戻し**: `readRenderTargetPixels` は無く `readRenderTargetPixelsAsync` だけ。WebGPU は行が上から・256 バイト揃え、WebGL 2 バックエンドは下から・詰め。
- **ノードフレーム**: FRAME 単位のノード（影の重複判定、BloomNode）はレンダラーのループで進む。`__game.advance()` は step() を直接呼ぶので、その間はフレームが進まない（影がそのフレームの主カメラ分しか描かれない）。
- **ライトの数が変わると全マテリアルが組み直し**: WebGL と同じ（救急車・駐車監視の PointLight が出入りする）。WebGPU のシェーダー作成は WebGL より重い可能性があり、段階 B・C で計る。
- **TSL の `select` は if 文になる**（ConditionalNode が一時変数への代入の if/else を出す）。`select` の枝に微分（`fwidth`）や暗黙の LOD のテクスチャ取得を置くと、WGSL では一様でない制御フローの中になる。段階 C では微分と取得を Fn の頭に置いた。
- **分岐の中で初めて組まれた共有の値**: `toVar` された値（three の `normalWorld`・`normalWorldGeometry`・`positionViewDirection` も）は、最初に組まれた場所に代入が出る。分岐の中で初めて使い、後で分岐の外でも使うと、分岐を通らなかった画素では 0 のまま。分岐の前で変数にしておく。
- **`materialColor` の型**: map があると色 × map で vec4、無いと vec3（型定義は vec3 だけ）。`vec4(materialColor)` はどちらも受ける（three の diffuse の段と同じ）。
- **node material は古典マテリアルの代わりに作る**: `MeshStandardMaterial` に `colorNode` などを足しても効くが（段階 A の仮）、照明モデル（`setupLightingModel`）を変えるにはクラスを継ぐ必要がある。
- **同じテクスチャを持つ TextureNode は binding を共有する**: シェーダーを組む時点で同じテクスチャ（uuid）を持つ texture() は 1 つの uniform になる（TextureNode.getUniformHash）。後で片方の `.value` を差し替えても、もう片方の binding を読み続ける。ブルームの「足し合わせ」と「ゴーストの段」が仮の同じテクスチャを持っていて 1 つにまとめられていた（生成した WGSL で気づいた）。後で差し替えるテクスチャノードには、それぞれ別の仮のテクスチャを持たせる。[^three-uniform-hash]
- **MSAA の深度はシェーダーで読めない**: `sceneTarget` の depth32float はサンプル数のまま作られる（解決されない）。太陽が隠れているかはアルファで測った（レンズフレア）。[^three-msaa-depth]
- **自分で投影を作るカメラ**: Renderer は描くときに、カメラの座標系か逆転深度のフラグがレンダラーと違えば `updateProjectionMatrix()` を呼ぶ。投影を手で変える前に両方を合わせておく（水面の鏡）。[^three-msaa-depth]
- **フレームの半精度の上限**: 65504 を超えた値は Inf になり、ブルームの縮小で NaN が広がる。空の円盤は 60000 で、ブルームへの持ち込みは露出後 40 で抑えた。
- **lefthook の pnpm exec**: このワークツリーは node_modules が本体へのシンボリックリンクで、`pnpm exec` が依存の確認から `pnpm install` を走らせようとして止まる（モジュールのディレクトリを消すのを拒否した）。typecheck・oxlint・oxfmt を node_modules/.bin で直接走らせ、`LEFTHOOK_EXCLUDE=typecheck,oxlint,oxfmt` でコミットした。

# 検証

- 機械的な検査: tsc・oxlint（新しい警告なし）・vitest 33 ファイル 311 件・vite build。[^phase-a-checks] main を取り込んだ後も同じ検査が通った（38 ファイル 391 件）。[^merge-checks]
- 段階 C: tsc・oxlint（新しい警告なし）・vitest 38 ファイル 400 件・vite build、node material 38 本の WGSL を naga で検証。[^phase-c-wgsl]
- 段階 B: tsc・oxlint・vitest 40 ファイル 411 件・vite build、11 マテリアル 22 本の WGSL を naga、GLSL を glslang で検証。[^phase-b-checks] [^phase-b-wgsl]
- 実機の Chrome での確認はまだ（ヘッドレスは使わない）。見る項目: 運転席の昼・夕方・夜・雨とワイパー、追従視点、Y の写真、再生、設定 › 画質 の切り替え、描画方式 WebGL 2、コンソールの WGSL / 検証エラー、F12 のスクリーンショット。
- 段階 B で見る項目: 夜空の灰橙の光害と雲底、晴れた夜の星（15° より上）、ブルーアワーの青、雨の雲のまだら、地平の霞と遠くの街が同じ色になるか、環境マップの映り込みの地面と街並み（車の塗装・ガラスの建物）。ブルーム: 夜の街灯・窓・信号・ヘッドライトがにじむか、昼は太陽と照り返しだけか（白い壁や空がにじまないか）、光のにじみ 高 / 低 / なし。レンズフレア: 太陽を見て、建物の陰に入ると消えるか、雲・雨で消えるか、運転席で屋根やピラーに隠れると消えるか、車内の上に描かれないか、レンズフレア あり / なし、夜のヘッドライトのゴースト。水面（両国 `?start=35.6935,139.7862`）: 波紋・照り返し・街の映り込み（上下が合っているか、水面下が映らないか）、空の映り込み なし で空だけ。すべてでコンソールに WGSL・検証のエラーが無いか、フレーム時間。

[^three-renderer]: node_modules/three/src/renderers/common/Renderer.js（three 0.186.1）

[^three-webgpu-backend]: node_modules/three/src/renderers/webgpu/WebGPUBackend.js と utils/WebGPUTextureUtils.js

[^three-shadow-node]: node_modules/three/src/nodes/lighting/ShadowNode.js

[^three-texture-node]: node_modules/three/src/nodes/accessors/TextureNode.js と nodes/display/ScreenNode.js

[^three-node-material]: node_modules/three/src/materials/nodes/NodeMaterial.js と renderers/common/nodes/NodeLibrary.js

[^phase-a-checks]: tsc --noEmit・oxlint・vitest run・vite build（webgpu ブランチ）

[^phase-b-wgsl]: 段階 B のマテリアルの WGSL / GLSL の生成と検証

[^three-uniform-hash]: node_modules/three/src/nodes/accessors/TextureNode.js（getUniformHash）と nodes/core/UniformNode.js

[^three-msaa-depth]: three の WebGPUUtils.getTextureSampleData・copyFramebufferToTexture・Renderer._updateCamera・Matrix4.makePerspective（three 0.186.1）

[^phase-b-checks]: 段階 B の tsc --noEmit・oxlint・vitest run・vite build

[^merge-checks]: main（0b230f6）統合後の tsc --noEmit・oxlint・vitest run・vite build

[^phase-c-wgsl]: 段階 C の node material の WGSL 生成と検証

[^three-lighting-model]: three の照明モデルとマテリアルのキャッシュキー（three 0.186.1）
