"""法定外 signs often seen on Tokyo streets (not in the 命令's 別表第一). No ward, city or fire
service emblems are drawn; where a real plate carries one, the space is left plain.

* ゾーン30 entry/exit: the 区域規制標識 on a white backing plate (命令 別表第二 備考四(一)5),
  laid out as 警察庁「交通規制基準」 図例(3) 参考規格: backing 40 × 60 cm, 最高速度 30 at
  φ30 cm (half the standard, the smallest allowed), 「区域ここから」 plate 30.6 × 16.8 cm.
* ゾーン30プラス plate: 国土交通省 縮小タイプ 400 × 150 mm (white 15 mm rim, green 370 × 120 mm,
  R25/R35), white lettering; green sampled from that drawing (#009066).
* 消防水利: 消防法施行規則 別表第一の四 — φ60 cm, red 枠 8 cm, blue ground, white 「消防水利」
  14 cm high and about 35 cm wide.
* 消火栓: the red disc with 「消火栓」 and 「FIRE HYDRANT」 used in Tokyo (photos on Wikimedia
  Commons); no written size was found, the 60 cm diameter is an estimate.
* 通学路 / スクールゾーン: the green portrait plates of Tokyo wards (photos: 渋谷区, 北区 on Wikimedia
  Commons); no ward specification was found, so the size (30 × 50 cm) is an estimate and the
  ward name in the lower left is left out.
"""

from __future__ import annotations

from PIL import Image

from . import auxiliary, regulatory
from .base import BLACK, BLUE, RED, RGBA, WHITE, Face
from .plates import RIM

ZONE_GREEN: RGBA = (0, 144, 102, 255)
WARD_GREEN: RGBA = (38, 142, 45, 255)
HYDRANT_RED: RGBA = (200, 40, 50, 255)


def zone30(entry: bool = True, value: int = 30) -> Image.Image:
    """ゾーン30 entry (「区域ここから」, 505-C) or exit (「区域ここまで」, 507-D) on the backing plate."""
    f = Face(400, 600, (256, 512))
    f.rect(0, 0, 400, 600, BLACK, 30)
    f.rect(4, 4, 396, 596, WHITE, 26)
    sign = regulatory.speed_sign(value) if value != 30 else _speed30()
    disc = sign.resize((round(300 * f.k), round(300 * f.k)), Image.Resampling.LANCZOS)
    f.img.alpha_composite(disc, (round(50 * f.k), round(50 * f.k)))
    # The 60 × 32 cm two-line plate at half size (交通規制基準 図例(3): 30.6 × 16.8 cm).
    plate = auxiliary.text_plate(["区　域", "ここから" if entry else "ここまで"])
    plate = plate.resize((round(306 * f.k), round(168 * f.k)), Image.Resampling.LANCZOS)
    f.img.alpha_composite(plate, (round(47 * f.k), round(392 * f.k)))
    return f.finish()


def _speed30() -> Image.Image:
    # The game's own 最高速度 30 artwork, so the zone plate matches the street signs.
    from pathlib import Path

    p = Path(__file__).resolve().parents[3] / "assets" / "signs" / "textures" / "speed_30.png"
    return Image.open(p).convert("RGBA") if p.exists() else regulatory.speed_sign(30)


def zone30_plus() -> Image.Image:
    """ゾーン30プラス 縮小タイプ: 「ゾーン30プラス」 in white on green inside a white rim."""
    f = Face(400, 150, (512, 256))
    f.rect(0, 0, 400, 150, WHITE, 35)
    f.rect(15, 15, 385, 135, ZONE_GREEN, 25)
    f.text_ink(200, 75, "ゾーン30プラス", 82, WHITE, weight=700, max_w=345)
    return f.finish()


def fire_water() -> Image.Image:
    """消防水利 (消防法施行規則 別表第一の四): white rim, red ring 8 cm, blue ground, white lettering."""
    f = Face(600, 600, (512, 512))
    f.circle(300, 300, 300, WHITE)
    f.circle(300, 300, 300 - RIM, RED)
    f.circle(300, 300, 300 - RIM - 80, BLUE)
    f.text(300, 300, "消防水利", 140, WHITE, weight=700, squeeze=0.62, max_w=350)
    return f.finish()


def hydrant() -> Image.Image:
    """消火栓: red disc with a thin white rim, 「FIRE HYDRANT」 above a large 「消火栓」."""
    f = Face(600, 600, (512, 512))
    f.circle(300, 300, 300, WHITE)
    f.circle(300, 300, 300 - 18, HYDRANT_RED)
    f.text(300, 150, "FIRE HYDRANT", 50, WHITE, weight=500, squeeze=0.85, max_w=380)
    f.text(300, 325, "消火栓", 165, WHITE, weight=700, max_w=470)
    return f.finish()


def school_route(zone: bool = False, hours: str | None = None) -> Image.Image:
    """Ward 通学路 plate: 「通学路」 over a large 「文」 in white on green. `zone` writes
    「スクールゾーン」 instead (the wording of the green school-zone road marking), with `hours`."""
    f = Face(300, 500, (256, 512))
    f.rect(0, 0, 300, 500, WARD_GREEN, 28)
    if zone:
        f.text(150, 115, "文", 150, WHITE, weight=700)
        f.text_ink(150, 262, "スクール", 62, WHITE, weight=700, max_w=250)
        f.text_ink(150, 338, "ゾーン", 62, WHITE, weight=700, max_w=250)
        if hours:
            f.text(150, 432, hours, 50, WHITE, weight=700, max_w=250)
    else:
        f.text(150, 75, "通学路", 78, WHITE, weight=700, max_w=250)
        f.text(150, 275, "文", 230, WHITE, weight=700)
    return f.finish()
