# 道路標識テクスチャ (Traffic Sign Textures)

Tokyo Open Drive の道路標識の図柄です。標識板は `public/models/signs.glb`（`scripts/blender/signs.py`）にあります。
すべて `scripts/textures/sign_textures.py` と `scripts/textures/signs/` が手続き生成します。
外部画像と AI 生成は使っていません。

どの番号がどのファイル・板・寸法に当たるかの一覧は `assets/signs/catalog.json` です。
別表第一の全番号を収めており、描いていない案内標識も `texture: null` と理由付きで載せています。

## 根拠

- 様式（形・色・寸法・記号）は「道路標識、区画線及び道路標示に関する命令」別表第二（e-Gov、2026-09-01 施行版）によります。
  - 図は e-Gov API の添付ファイルで確認しました。各エントリの `figure` に URL があります。
  - 色は備考一(三)、縁・縁線の太さは備考一(五)8 によります。
- 番号と種類は別表第一から取りました（`scripts/textures/signs/law_table.py`）。
- 補助標識の寸法は、別表第二の図が e-Gov では判読できないため、警察庁「交通規制基準」によります。
  - 横 60 cm です。
  - 縦は矢印 1 段で 18 cm、文字 1 段で 22 cm、2 段で 32 cm、3 段で 44 cm です。
- 法定外（ゾーン30、消防水利、消火栓、通学路）は、catalog.json の各エントリの `source` と `note` を参照してください。
- 区・市・消防の紋章やロゴは描いていません。

## テクスチャの約束

- **板の外接矩形を UV 0–1 で覆います。** 実寸の比で描いてから 2 の冪の大きさに縮めます（例: 60 × 35 cm → 512 × 256 px）。
  - そのため、画素の縦横比は板と一致しないことがあります。
  - 例外は逆三角形です（80 × 69.3 cm を 512 × 512 で覆う）。
- **板の形の外は透明です。** 円、菱形、逆三角形、五角形、角丸の四隅が該当します。
- **大きさ:** たいていは 512 px です。90 cm を超える板（327 系、進行方向別通行区分）は 1024 px です。
- **ファイル名:** 番号を小文字にし、「の」を「-」に変えます（`327の7-A` → `327-7a`）。
  - 図柄の違いは `_` の後に付けます（`202_left`、`316_8-20`）。
  - 最初の 24 枚は従来の名前のままです（`speed_40`、`no_entry`、`turn_3` など）。
  - 進行方向別通行区分は `327-7_<車線ごとの略号>.png` です（`327-7_lt-t-r` = 左折・直進｜直進｜右折）。

## 再生成

```bash
# 全テクスチャと catalog.json
uv run scripts/textures/sign_textures.py
# 確認用のコンタクトシート（群ごと、実寸比で表示）
uv run scripts/textures/sign_textures.py --sheet /tmp/signs
# 可変の標識を 1 枚だけ描く（assets は変えない）
uv run scripts/textures/sign_textures.py render 327の7-A --lanes "left+through,through,right" -o /tmp/a.png
uv run scripts/textures/sign_textures.py render 501 --text "この先/200m" -o /tmp/b.png
```

## フォント

- [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP)（Variable Font、SIL Open Font License 1.1）です。
  - `google/fonts` のコミット `295d98a7a0c17c68f1341eaeea354e7960ea70d3` に固定しています。
  - SHA-256 は `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f` で照合します。
- システムフォントへのフォールバックはしません。
