# Directory Update Log

## 2026-10-05

- **Update**: [多言語対応（日本語・English・中文）](i18n.md) にフェーズ 2（ゲーム画面）を追記。906 キー（計 1,067）で、ナビのパネルと音声（言語ごとの文の型、ja-JP / en-US / zh-CN の声、声が無いときは話さない）、交差点名（英語は OSM の name:en を案内標識の書き方で、中国語は「…路口」）、HUD・時計（Intl）・通知・ダイアログ・操作の一覧、違反名と条項（`lawRef` の組み立て）、切符の要約の枠、テレビ、出典（必須の原文 + 訳）、歩行者との会話（声は日本語のまま字幕を訳す、会話 AI に返答の言語を指示）、119・110 を訳した。記録は日本語のまま保存して表示のときに訳し直す仕組み（reverse.ts）、日本語が変わった 4 か所（古い鍵の名前）、残り（Y、地名、画面での確認）を記録。「フェーズ 2 で訳すもの」の表を「訳したもの」に置き換え、落とし穴の古い 2 項目を更新。
- **Update**: [ゲーム内 SNS「Y」](social-app.md) に「言語（日本語・English・中文）」を追加（ポストは選んだ言語で見せ、観光客の英語・中国語はそのままと決定、開いたポストの「日本語から翻訳 · 原文を表示」、phrase を持って setLang で書き直す仕組み、スロットの語を文の言語で埋める表、件数・相対時刻の書き方、訳 1 言語 1,025 文と画面の文言 130 キー、訳していないもの）。「表は今は空」を訂正。落とし穴 1 件。[多言語対応](i18n.md) に Y の節を追加。
- **Update**: [WebGPU への移行](webgpu-migration.md) に main の 2 回目の統合（ナビの案内パネル・多言語対応・Y のポスト・ゲーム時計 60 倍・ガラスの UV の向き）を追記。描画方式・レンズフレアの行と描画方式の表示・シェーダー作成中の読み込み表示を i18n のキーに。
- **Update**: [WebGPU への移行](webgpu-migration.md) に「色をそのまま見せるマテリアル（信号のレンズ・オービス）」を追加（ACES の逆算の手順、TSL と GLSL の ACES の係数の違い、ACES が出せない緑と黄の扱い、オービスの加算の光、ブルームでの値、検証）。落とし穴 2 件を追加。段階 B のブルームの根拠の「信号のレンズ ~0.8」を訂正し、[空・光・ブルーム・レンズフレア](sky-light-and-bloom.md) の同じ記述も訂正（実際は LED の点で 0.63〜0.8、遠くの平均で 0.25〜0.31。逆算の後は LED の点で ~1.0〜1.8）。
- **Update**: [WebGPU への移行](webgpu-migration.md) に段階 B（空・霧・ブルーム・レンズフレア・水面を TSL に、街のパスの `prepare` とフレームの読み取り、ブラウザなしの WGSL / GLSL の検証、落とし穴 4 件）を追加。[空・光・ブルーム](sky-light-and-bloom.md) を「空・光・ブルーム・レンズフレア」にし、HDR のブルームの閾値の決め方とレンズフレアの設計を追加。[川・運河・海の水面](rivers-and-water.md) に webgpu ブランチの反射を追加し、スマホでノイズも 2 オクターブにするという記述を訂正（コードはうねりだけ 2 本、ノイズは 4 オクターブのまま）。[深度フォグ](atmosphere-and-replay-data.md) に `scene.fogNode` 版を追記。
- **Update**: [WebGPU への移行](webgpu-migration.md) に段階 C（外壁・地形の水面の切り抜き・濡れた路面と街灯の光を TSL の node material に）と、ブラウザなしで WGSL を作って naga で検証する方法、TSL の落とし穴（`select` は if 文、分岐の中で初めて組まれた共有の値）を追加。[建物外壁のシェーダー](building-facade-shader.md) と [道路照明と濡れた路面](street-lighting-and-wet-roads.md) に webgpu ブランチでの入れ先・画質の切り替え・検証を追記。
- **Update**: [WebGPU への移行](webgpu-migration.md) を main（案内標識・ミラーの飾り・交差点の曲がり方・空と光とブルーム・東京駅）との統合に合わせて更新（空の環境マップを three/webgpu へ移植、光の釣り合い・天気の移り変わり・濡れは main のまま、空のシェーダーの追加・ブルーム・霧のトーンマップは段階 B へ、モジュールごとの仮の実装の一覧）。
- **Creation**: [WebGPU への移行](webgpu-migration.md) を追加（段階 A: 描画方式の設定、逆転 float 深度、1 枚の HDR ターゲットでのフレームの組み立てと街のパスの差し込み口、TSL のブラーと雨のガラス、非同期の写真、段階 B・C の残りと接点、落とし穴）。
- **Update**: [ゲーム内 SNS「Y」](social-app.md) にポストの文言と選び方を追記（文言を socialTexts.ts に分け、訳は日本語の原文をキーにした表で足す構成。日常のポスト 28 → 320 テンプレートと 25 の人物像、区・時刻・曜日・季節・明るさ・天気・気温・ランドマーク・公園・川・案内標識・バス・渋滞・近くの出来事のスロットと条件、30 件以内に繰り返さない選び方、目撃ポストの書き出し 25 → 180 文（全 26 種）と文字だけ・写真・動画、返信 22 → 157・引用 6 → 46 と種類ごとの文、日常ポストの返信、運転をほめるポスト、時計 60 倍に合わせて実時間の秒で決めた速さ、13 種の新しい絵、落とし穴 6 件）。画面はブラウザで確かめていない。
- **Creation**: [ナビの案内パネル](nav-panel.md) を追加（どの状態でも同じ大きさの 5 段、直進案内の規則と実データ 240 経路での頻度、道路名・交差点名の出どころ、速度取締機・規制速度・通学路・一時停止の通知と読み上げの間引き、現在地表示、瀬田の環八が終日通行止めになっている問題、目で確かめる場所）。
- **Update**: [交通規制と信号機](traffic-regulations.md) に、ナビが `junction=yes` の交差点名も使うようになったことと、瀬田の環八の通行止めを追記。
- **Creation**: [多言語対応（日本語・English・中文）](i18n.md) を追加（言語の決め方と保存、t() の代替の連鎖、data-i18n と bindText、boot.ts を先に読む理由、タイトル画面の言語ピッカーと 設定 ボタン、キーの足し方、訳の方針、フェーズ 1 の 147 キーとフェーズ 2 の範囲。切符は様式を日本語のまま要約を訳すと決定）。tag `i18n` を tags.yml に追加。
- **Creation**: [交差点の曲がり方（ナビと自動運転の走行軌跡と道路交通法 第34条）](turn-paths.md) を追加（第34条第1・2・4項、第35条、第35条の2 の原文と「内側」の解釈、標示「右左折の方法」の意味、`drivePath.ts` の作り方、実データ 3 地点 858 経路と自動運転 427 走行の計測、落とし穴 8 件）。
- **Creation**: [東京駅丸の内駅舎を写真と公開図面から作る](tokyo-station-blender.md) を追加（近景 7.2 万三角形への作り直し、寸法の求め方、色の計測、agy へのテクスチャ依頼書）。
- **Update**: [ランドマークのモデリングとライトアップ](landmarks-blender.md) の東京駅の高さを訂正（最高 46.1 m はフィニアル込み・除くと 34.8 m・軒高 16.7 m、PLATEAU の 18.2 m は高欄の上端）。
- **Creation**: [ミラーの飾り（ぬいぐるみ・お守り）の物理と法令](mirror-charms.md) を追加。tag `physics` を tags.yml に追加。
- **Creation**: [空・光・ブルーム](sky-light-and-bloom.md) を追加。[深度フォグ](atmosphere-and-replay-data.md) の霧の色を放射輝度として扱うように変えた点もここに記録。
- **Update**: [区画線・道路標示・道路標識](road-markings-and-signs.md) に案内標識（方面及び方向 108 系）を追加し、「案内標識は描いていない」を訂正。OSM・PLATEAU frn の網羅状況、表示地名（国土交通省一覧）、英語表記の告示、文字の大きさと設置位置、交差点名が `junction=yes` にある落とし穴を記録。
- **Update**: [交通規制と信号機](traffic-regulations.md) に、大交差点の名前が信号 node ではなく `junction=yes` の node にあることを追記。
- **Creation**: [道路照明と濡れた路面](street-lighting-and-wet-roads.md) を追加（街灯の配置規則と配置数、配光と照度の計算値、濡れ・水たまり・波紋・乾き方、雨の夜の筋、画質「雨の路面」「街灯の光」との対応、計測できなかったフレーム時間、未確認の数値）。
- **Creation**: [ナビのテレビ（走行中映像制限と道路交通法 第71条第5号の5）](navi-tv.md) を追加（第71条第5号の5・第118条第1項第4号・第117条の4第1項第2号、警察庁の「2 秒」、自工会ガイドライン 3.0 の走行中映像禁止、架空の 3 チャンネル、車内スピーカーの位置と読み上げ。パーキングブレーキ信号線の仕組みは未確認）。
- **Creation**: [建物外壁のシェーダー](building-facade-shader.md) を追加（夜の窓の点灯割合・色温度・interior mapping・ガラス・接地・雨筋、画質「夜の窓」との対応、計測できなかった負荷）。
- **Update**: [Blender CLI での車内（運転席）モデリング](cockpit-blender.md) の寸法の根拠を訂正（目が席の 0.17 m 後ろ・ハンドルがペダルから 0.36 m で、人の寸法に合っていなかった）。SAM・UMTRI の実測重心・UN R125・AIST 1991-92 で席・ペダル・ハンドル・DriverEye を置き直し、5/50/95 パーセンタイルの人を座らせた結果を追記。[Blender CLI でのモデリング](car-model-blender.md) に実車の諸元との比較と、カウル・ドアミラー・ワイパー材質の修正を追記。中央の画面の下 15% がダッシュに隠れた誤りを訂正（z 0.585 → 0.495）。
- **Creation**: [川・運河・海の水面](rivers-and-water.md) を追加。tag `water` を tags.yml に追加。[データ・ソフトウェアの利用条件](licensing-decisions.md) に東京都水防災総合情報システム・気象庁潮位表と水文水質データベースを使わなかった理由、[地形・ジオイド・浮動原点](terrain-and-geoid.md) に水面での地形の扱い、[地理院ベクトルタイルの道路](gsi-vector-roads.md) に橋の判定とタイルの共有を追記。

- **Creation**: [交通切符の様式と実物デザイン再現](ticket-forms.md) を追加。
- **Creation**: [オービス（速度違反自動取締装置）と予告看板](orbis.md) を追加。
- **Creation**: [空間音響（音源の位置・車内の遮音・ドップラー効果）](spatial-audio.md) を追加。tag `audio` を tags.yml に追加。
- **Creation**: [アセット台帳（assets/manifest.yml）](asset-manifest.md) を追加。tag `assets` を tags.yml に追加。
- **Creation**: [深度フォグ（大気の減衰）と違反の再現データ](atmosphere-and-replay-data.md) を追加。
- **Creation**: [違反を撮影する通行人とスマートフォン](witness-phones.md) を追加。

## 2026-10-04

- **Creation**: [警察車両のモデリング](police-vehicles-blender.md) を追加。
- **Creation**: [大型車・二輪のモデリング](large-vehicles-blender.md) を追加。
- **Creation**: [Blender CLI での路上キャラクター](street-characters-blender.md) を追加。
- **Creation**: [Blender CLI での車内（運転席）モデリング](cockpit-blender.md) を追加。
- **Creation**: [ランドマークのモデリングとライトアップ](landmarks-blender.md) を追加。
- **Update**: [道路交通法の点数・反則金](road-traffic-law.md) に検挙のモデル（現認・オービス・事故、行政処分は後日の出頭、停止命令違反と第119条第1項第13号、ながら運転）を追記。
- **Update**: [交通規制と信号機](traffic-regulations.md) の通行禁止の読み方を訂正（コード 1 は歩行者用道路、通行止めはコード 4、首都高の自動車専用は捨てる）。
- **Update**: [交通規制と信号機](traffic-regulations.md) に進行方向別通行区分を追記（JARTIC 58 には車線ごとの方向が無い、OSM turn:lanes の件数、仮定のパターン）。
- **Update**: [交通規制と信号機](traffic-regulations.md) に、規制の時間・曜日・除外と通行禁止の取り込み漏れの訂正を追記。
- **Creation**: [歩道と歩道橋のデータ](sidewalks-and-footbridges.md) を追加。
- **Update**: [地理院ベクトルタイルの道路](gsi-vector-roads.md) の ftCode 2221 の誤り（道路縁 庭園路を道路構成線としていた）を訂正。
- **Update**: [区画線・道路標示・道路標識](road-markings-and-signs.md) に交差点内の標識・車線の落とし穴、[地形・ジオイド・浮動原点](terrain-and-geoid.md) に DEM の凸凹の計測とメディアン処理を追記。
- **Update**: [道路交通法の点数・反則金](road-traffic-law.md) に放置駐車の取り締まりと 4 種の違反、[交通規制と信号機](traffic-regulations.md) に区間規制の時間帯と違反判定を追記。
- **Creation**: [区画線・道路標示・道路標識](road-markings-and-signs.md) を追加。
- **Update**: [Blender CLI でのモデリング](car-model-blender.md) に標識・歩行者と 2 回目の agy 委譲、[PLATEAU 建物](plateau-buildings.md) に外壁テクスチャ、[地形・ジオイド・浮動原点](terrain-and-geoid.md) に降車中の車、[交通規制と信号機](traffic-regulations.md) に追加の種別を追記。
- **Creation**: [Blender CLI での車のモデリング](car-model-blender.md) を追加。
- **Creation**: [交通規制（JARTIC）と信号機（OSM）](traffic-regulations.md) を追加。
- **Update**: [地理院ベクトルタイルの道路](gsi-vector-roads.md) に JARTIC 取り込み済みの追記、[道路交通法の点数・反則金](road-traffic-law.md) に一時不停止・通行禁止違反、[データ・ソフトウェアの利用条件](licensing-decisions.md) に JARTIC・OSM を追加。
- **Creation**: 初版。開発初日の調査・実装で得た知見を 9 文書にまとめた。
