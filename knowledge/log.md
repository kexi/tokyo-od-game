# Directory Update Log

## 2026-10-05

- **Creation**: [WebGPU への移行](webgpu-migration.md) を追加（段階 A: 描画方式の設定、逆転 float 深度、1 枚の HDR ターゲットでのフレームの組み立てと街のパスの差し込み口、TSL のブラーと雨のガラス、非同期の写真、段階 B・C の残りと接点、落とし穴）。

- **Creation**: [道路照明と濡れた路面](street-lighting-and-wet-roads.md) を追加（街灯の配置規則と配置数、配光と照度の計算値、濡れ・水たまり・波紋・乾き方、雨の夜の筋、画質「雨の路面」「街灯の光」との対応、計測できなかったフレーム時間、未確認の数値）。
- **Creation**: [ナビのテレビ（走行中映像制限と道路交通法 第71条第5号の5）](navi-tv.md) を追加（第71条第5号の5・第118条第1項第4号・第117条の4第1項第2号、警察庁の「2 秒」、自工会ガイドライン 3.0 の走行中映像禁止、架空の 3 チャンネル、車内スピーカーの位置と読み上げ。パーキングブレーキ信号線の仕組みは未確認）。
- **Creation**: [建物外壁のシェーダー](building-facade-shader.md) を追加（夜の窓の点灯割合・色温度・interior mapping・ガラス・接地・雨筋、画質「夜の窓」との対応、計測できなかった負荷）。
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
