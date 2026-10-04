---
type: Reference
title: WebGPU への移行（WebGPURenderer・フレームの組み立て・残りの移植）
description: three.js r186 の WebGPURenderer へ移した段階 A の記録。描画方式（WebGPU / WebGL 2）の設定、逆転 float 深度を選んだ理由、1 枚の HDR ターゲットに街・ブラー・ワイパー・雨のガラス・車内を重ねて最後に 1 回だけトーンマップするフレームの組み立て、TSL に移したブラーと雨のガラス、非同期になった通行人の写真、仮の node material で走らせているモジュールと後続（段階 B・C）が守るべき接点（main の空・光・ブルームを取り込んだ後の一覧）、three の WebGPU で踏んだ落とし穴。段階 C（外壁・地形の切り抜き・濡れた路面・街灯の光を TSL の node material に）と、ブラウザなしで WGSL を生成して naga で検証する方法。
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
→ 街のパス: [ブルーム・レンズフレア（段階 B）] → ブラー │ 1 枚の HDR ターゲット
→ ワイパー（近接カメラ near 2 cm、OUTSIDE_LAYER = 2）│ （RGBA16F・MSAA・depth32float）
→ ガラス用のコピー（街 + ワイパー、ミップ付き）        │
→ 車内（近接カメラ、INTERIOR_LAYER = 1、深度クリア）  │
→ フロントガラス（車内の深度で隠れ、コピーを屈折）     ┘
→ present: ACES（環境の露出）+ sRGB でキャンバスへ 1 回
```

守っている性質（WebGL 版と同じ）: 街だけがブラーで流れ、ワイパーと車内はシャープ、ガラスの水は街とワイパーを屈折させて車内は映さない、車内は近接カメラなので切れない。

## なぜこの形か

- **WebGPURenderer は render() のたびにキャンバスへ出力パスを走らせる。** トーンマップか sRGB 出力があると `needsFrameBufferTarget` が真になり、キャンバスへの render() と clear() は内部の HDR ターゲットに描いてから全画面の出力パス（`_renderOutput`）でキャンバスへ書く。autoClear を切って何度も描くと、内部ターゲットには正しく重なるが、出力パスが毎回（このフレームなら 5〜6 回）走る。[^three-renderer] 自前のターゲットへ描けば `isOutputTarget` が偽でトーンマップされず、最後の 1 回だけになる。
- **copyFramebufferToTexture は線形 HDR を読む**（内部ターゲット、または今のレンダーターゲットの解決済みテクスチャ）。表示用に変換された値ではない。コピー先の FramebufferTexture はフォーマットを合わせないと失敗する（`type = HalfFloatType`）。[^three-webgpu-backend]
- RenderPipeline と pass() を使わなかった理由: pass() は 1 つごとに全画面の色と深度のターゲットを持ち一から描く。ここは同じターゲットに重ね描きし、ガラスは車内の深度で隠れる必要がある。
- 重ね描きは `autoClearColor = false, autoClearDepth = true` で 1 パスにまとめた（`renderer.clearDepth()` は独立したパスになる）。

## 街のパス（ブルームとレンズフレアの差し込み口）

`composer.streetPasses` に順に並べる（main.ts で `push(blur)`、その前に段階 B がブルームとレンズフレアを入れる）。`StreetPass` は `isActive()` と `build(street: TextureNode): Node<"vec4">`。どれも動いていないフレームはコピーも描画も無い。動くときは街を 1 回コピーし、途中のパスは中間ターゲット（MSAA なし）、最後のパスはフレームへ書き戻す。

- three の `BloomNode`・`LensflareNode` は `updateBefore` が FRAME 単位で、ノードフレームは `renderer.init()` が始めるレンダラーのアニメーションループで進む（アプリの requestAnimationFrame は後から登録されるので、毎フレームその後に走る）。
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
- **three/webgpu へ移した**: skyEnvMap.ts（空から作る環境マップ）。`PMREMGenerator`・`CubeRenderTarget` を three/webgpu の方に、空を SkyMesh にした。描き直しの間隔（`isEnvStale`、画質 空の映り込み 高 256 / 低 64 / なし = スタジオ）とターゲットの使い回し（`fromCubemap(…, target)` で `scene.environment` の同一性を保つ）は main のまま。
- **段階 B へ回した（GLSL のまま、WebGPU では動かない）**: skyShader.ts の空への追加、bloom.ts のブルーム、atmosphere.ts の霧の色のトーンマップ（WebGPU では不要。下の表）。
- **雨のガラス**: TSL 版のまま、main の新しいガラスの寸法（1.4719 × 0.837 m、傾き 26.9°、`SIN_RAKE`・`COS_RAKE`）・ガラスの原点（0.7359, 0.1618, 0.9465）・ワイパーの軸と停止角を使う。
- **一時停止中の描画**: main は一時停止中も運転席を通して描くようになった（ミラーの飾りが揺れ止むまで）。合成でもブラーを止めて同じように描く。
- 案内標識（guideSigns.ts）・ミラーの飾り（mirrorCharm.ts、MeshPhysicalMaterial の sheen）・交差点の曲がり方（drivePath.ts）・東京駅のモデルは WebGL 専用の API を使っていない。

## モジュールごとの今と残り

| モジュール                       | 今（WebGPU）                                                                                                                                  | 移すもの                                                                                                                                                      | 守る接点                                                                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| skyShader.ts（B）                | 使われていない。空は SkyMesh（three の Sky の TSL 版、同じ Preetham と雲）で、夜は Preetham の黒、雨の雲の層・星・光害・地平の霞は無い        | 追加分を TSL で SkyMesh の色に（または自前の空に）                                                                                                            | `SkyLook`（uSkyGain, uOzone, uGlow, uStars, uTwilight, uDeck, uGround, uHaze）。Environment.update が skyLight.ts の値を書き、`syncEnvSky` が環境マップの空へ写す。今は `Environment.look` と `SkyEnvMap.look` が null                           |
| skyEnvMap.ts（B）                | three/webgpu で動く。空の下に地面と街並みが無い（skyShader の uGround）                                                                       | 地面と街並み（skyShader の移植で入る）                                                                                                                        | `SkyEnvMap(renderer, size)`・`update(state, nowMs, sync, step, gapMs)`・`texture`・`isEnvStale`（tests/sky.test.ts）                                                                                                                             |
| environment.ts（B）              | main の版に SkyMesh、three/webgpu の PMREMGenerator、renderOrder −1000                                                                        | 空の追加の値を SkyMesh へ                                                                                                                                     | `sun`・`nightFactor`・`sunElevation`・`wetness`・`overcast`・`envMap`、`toneMappingExposure` を環境が決める、画質 `reflections`                                                                                                                  |
| atmosphere.ts（B）               | three の線形 Fog だけ（色は skyLight の放射輝度）。チャンクの差し替えは WebGLRenderer（アバター・アセット画面）にしか効かない                 | `scene.fogNode` として τ の積分・高さで薄まる霞・太陽まわりの散乱                                                                                             | `ATMOSPHERE.fogAtmo / fogSun / fogSunColor`（Environment.update が毎フレーム書く）、`extinctionFor`。霧の色のトーンマップ（main が GLSL に足した）は WebGPU では要らない: node material は線形のまま霧を混ぜ、出力パスでまとめてトーンマップする |
| bloom.ts（B）                    | 動かしていない（ブルームなし）                                                                                                                | 街のパス（`composer.streetPasses` のブラーの前、main.ts に印）。フレームが線形 HDR なので、表示値を擬似 HDR に戻す前処理は要らない。three の BloomNode も候補 | `bloomSettings(env.nightFactor, env.overcast)`（tests/sky.test.ts）、画質 `bloom`（high/low/off）、`StreetPass`                                                                                                                                  |
| water.ts / waterMaterial.ts（B） | 仮の MeshBasicNodeMaterial: 空の 2 色のフレネル・本体色・太陽のきらめき・潮位での上下。平面反射は止めている（`IS_REFLECTION_PORTED = false`） | 波紋・平面反射（斜めの近平面は WebGL のクリップ空間 z −1…1 用。WebGPU は 0…1 で逆転深度）・霧                                                                 | `material.uniforms` の名前と値の型（uTime, uTide, uSun*, uSky*, uAmbient, uRough, uReflection*, uPlaneY）、`renderReflection()`、メッシュごとの `onBeforeRender` で uReflectionOn。uSkyHorizon は霧の色（放射輝度）を受ける                      |
| facade.ts（C）                   | **段階 C で移植**: TSL の MeshStandardNodeMaterial（`facadeMaterial()`）。夜の窓 3 種は 3 つの node のグラフ                                  | —                                                                                                                                                             | `facade` 属性、`facadeUniforms`（uNight・uTime・uWet・uOrigin は TSL の uniform で `.value` のまま、uLitShare・uFacadeTex は `{ value }`）、`Buildings.setNightFactor`・`setFacadeClock`、画質 `windows`                                         |
| terrain.ts（C）                  | **段階 C で移植**: MeshStandardNodeMaterial の `maskNode` で水面を捨てる（写真が載ってから）                                                  | —                                                                                                                                                             | `setWater`・チャンクの `water`（TextureNode、`.value` を差し替える）                                                                                                                                                                             |
| roadSurface.ts（C）              | **段階 C で移植**: `StreetMaterial`。アスファルトは 3 枚のマップをワールド XZ で（main と同じ平面投影）                                       | —                                                                                                                                                             | `aStreet` 属性、`new StreetMaterial(kind, { hasStreet, base, ...params })`（`streetShading()` は廃止）                                                                                                                                           |
| streetLights.ts（C）             | **段階 C で移植**: 濡れ・水たまり・波紋（色・粗さ・法線の段）、光だまり・筋・きらめき（照明モデル）                                           | —                                                                                                                                                             | `UNIFORMS`（TSL の uniformArray / uniform、StreetLights.update が書く）、`env.wetness`、画質 `wetRoads`・`streetLights`                                                                                                                          |

- 古典マテリアルの `onBeforeCompile`・`defines`・`customProgramCacheKey` は node material では無視され、エラーにもならない。ShaderMaterial / RawShaderMaterial は使えない（bloom.ts は ShaderMaterial のまま残っているが、WebGPU では呼んでいない）。
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
- **lefthook の pnpm exec**: このワークツリーは node_modules が本体へのシンボリックリンクで、`pnpm exec` が依存の確認から `pnpm install` を走らせようとして止まる（モジュールのディレクトリを消すのを拒否した）。typecheck・oxlint・oxfmt を node_modules/.bin で直接走らせ、`LEFTHOOK_EXCLUDE=typecheck,oxlint,oxfmt` でコミットした。

# 検証

- 機械的な検査: tsc・oxlint（新しい警告なし）・vitest 33 ファイル 311 件・vite build。[^phase-a-checks] main を取り込んだ後も同じ検査が通った（38 ファイル 391 件）。[^merge-checks]
- 段階 C: tsc・oxlint（新しい警告なし）・vitest 38 ファイル 400 件・vite build、node material 38 本の WGSL を naga で検証。[^phase-c-wgsl]
- 実機の Chrome での確認はまだ（ヘッドレスは使わない）。見る項目: 運転席の昼・夕方・夜・雨とワイパー、追従視点、Y の写真、再生、設定 › 画質 の切り替え、描画方式 WebGL 2、コンソールの WGSL / 検証エラー、F12 のスクリーンショット。

[^three-renderer]: node_modules/three/src/renderers/common/Renderer.js（three 0.186.1）

[^three-webgpu-backend]: node_modules/three/src/renderers/webgpu/WebGPUBackend.js と utils/WebGPUTextureUtils.js

[^three-shadow-node]: node_modules/three/src/nodes/lighting/ShadowNode.js

[^three-texture-node]: node_modules/three/src/nodes/accessors/TextureNode.js と nodes/display/ScreenNode.js

[^three-node-material]: node_modules/three/src/materials/nodes/NodeMaterial.js と renderers/common/nodes/NodeLibrary.js

[^phase-a-checks]: tsc --noEmit・oxlint・vitest run・vite build（webgpu ブランチ）

[^merge-checks]: main（0b230f6）統合後の tsc --noEmit・oxlint・vitest run・vite build

[^phase-c-wgsl]: 段階 C の node material の WGSL 生成と検証

[^three-lighting-model]: three の照明モデルとマテリアルのキャッシュキー（three 0.186.1）
