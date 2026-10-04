"""補助標識 (500 番台): white plates with black lettering and red arrows (別表第二 図 199–228).

地を白色、矢印を赤色又は黒色、文字及び記号を黒色 (備考二(三)1); 503-D is pale yellow and 507-C
has a blue band and ring. 別表第二's 「補助標識板及び柱の規格」 figure is too coarse to read on
e-Gov, so the sizes follow 警察庁「交通規制基準」(令和8年3月16日) 第2章 (6)(8): plates 60 cm
wide, 18 cm high with one row of arrows, 22 cm with one line of lettering (12 cm letters,
5 cm margins), 32 cm with two lines and 44 cm with three (10 cm letters); 503-B 60 × 25 cm
for a bus or truck (symbol 40 × 15 cm). The black edge of the plate is drawn as in its figures.

Everything that varies (distances, hours, vehicle classes, reasons, place names) is an argument,
so any value can be rendered: `text_plate(["この先100m"])`, `text_plate(["自転車を除く", "8-20"])`.
"""

from __future__ import annotations

from typing import Sequence

from PIL import Image

from . import pictos
from .base import BLACK, BLUE, PALE_YELLOW, RED, RGBA, WHITE, Face, arrow_path, pow2_size

PLATE_W = 600.0
EDGE = 9.0  # black edge of the plate
RADIUS = 30.0
HEIGHTS = {"arrow": 180.0, 1: 220.0, 2: 320.0, 3: 440.0}
SIZE_SOURCE = "https://www.npa.go.jp/bureau/traffic/seibi2/kisei/mokuteki/kiseikijun/260316kiseikijun.pdf"


def plate_height(lines: int) -> float:
    return HEIGHTS.get(lines, 100.0 + 120.0 * lines)


def aux_face(w: float, h: float, ground: RGBA = WHITE, edge: RGBA | None = BLACK) -> Face:
    f = Face(w, h, pow2_size(w, h, 512))
    if edge is not None:
        f.rect(0, 0, w, h, edge, RADIUS)
        f.rect(EDGE, EDGE, w - EDGE, h - EDGE, ground, RADIUS - EDGE)
    else:
        f.rect(0, 0, w, h, ground, RADIUS)
    return f


def text_plate(
    lines: Sequence[str],
    w: float = PLATE_W,
    h: float | None = None,
    fill: RGBA = BLACK,
    ground: RGBA = WHITE,
    edge: RGBA | None = BLACK,
    spread: bool = False,
) -> Image.Image:
    """Lines of black lettering (12 cm for one line, 10 cm for two or three) on a white plate.
    `spread` spaces the characters across the plate (「区　域」, 「始　　　点」)."""
    n = max(1, len(lines))
    hh = h if h is not None else plate_height(n)
    f = aux_face(w, hh, ground, edge)
    lh = 120.0 if n == 1 else 100.0
    if h is not None:
        lh = min(lh, (hh - 100.0) / n)
    gap = (hh - 100.0 - lh * n) / max(1, n - 1) if n > 1 else 0.0
    for i, s in enumerate(lines):
        cy = 50.0 + lh / 2 + i * (lh + gap) if n > 1 else hh / 2
        if spread and len(s) > 1:
            span = w - 2 * 75.0 - lh
            step = span / (len(s) - 1)
            for k, ch in enumerate(s):
                f.text(75.0 + lh / 2 + k * step, cy, ch, lh * 0.92, fill, weight=500)
        else:
            f.text_ink(w / 2, cy, s, lh, fill, weight=500, max_w=w - 100)
    return f.finish()


def arrow_plate(kind: str, fill: RGBA = RED) -> Image.Image:
    """505-A 始まり (→), 506 区間内 (↔), 507-A 終わり (←): a red arrow 9 cm high on a 60 × 18 cm
    plate (shaft 38 cm + head 8 cm, 7 cm margins)."""
    f = aux_face(PLATE_W, HEIGHTS["arrow"])
    y = 90.0
    if kind == "right":
        arrow_path(f, [(70, y), (530, y)], 50, 80, 92, fill)
    elif kind == "left":
        arrow_path(f, [(530, y), (70, y)], 50, 80, 92, fill)
    else:
        arrow_path(f, [(300, y), (530, y)], 50, 80, 92, fill)
        arrow_path(f, [(300, y), (70, y)], 50, 80, 92, fill)
    return f.finish()


def direction_plate(angle: str = "up_right", fill: RGBA = RED) -> Image.Image:
    """511 方向: an arrow pointing to the route, place or facility (図 225: up and to the right)."""
    f = aux_face(PLATE_W, HEIGHTS[3])
    ends = {
        "up_right": ((170, 370), (440, 80)),
        "up_left": ((430, 370), (160, 80)),
        "right": ((90, 220), (510, 220)),
        "left": ((510, 220), (90, 220)),
        "up": ((300, 390), (300, 60)),
    }[angle]
    arrow_path(f, list(ends), 48, 120, 130, fill)
    return f.finish()


def vehicle_plate(names: Sequence[str] = ("truck_side",)) -> Image.Image:
    """503-B 車両の種類: black vehicle silhouettes (40 cm wide; 60 × 25 cm for one bus or truck,
    60 × 51 cm for two)."""
    h = 250.0 if len(names) == 1 else 510.0
    f = aux_face(PLATE_W, h)
    if len(names) == 1:
        pictos.place_c(f, names[0], 300, 125, 400 if names[0] != "car_front" else 220, BLACK, WHITE)
    else:
        for i, n in enumerate(names):
            pictos.place_c(f, n, 300, 135 + i * 240, 380, BLACK, WHITE)
    return f.finish()


def load_plate(load: str = "3") -> Image.Image:
    """503-C 車両の種類: a truck over 「積　３　ｔ」 (the maximum load in tonnes, 備考二(一)5)."""
    f = aux_face(PLATE_W, 380.0)
    pictos.place_c(f, "truck_side", 300, 130, 380, BLACK, WHITE)
    f.text(190, 300, "積", 90, BLACK, weight=500)
    f.text(305, 300, load, 100, BLACK, weight=500, max_w=150)
    f.text(410, 306, "t", 80, BLACK, weight=500)
    return f.finish()


def badge_only() -> Image.Image:
    """503-D 車両の種類: 「標章車専用」 in black on pale yellow, no edge (備考二(三)1 ただし書)."""
    return text_plate(["標章車専用"], ground=PALE_YELLOW, edge=None)


def end_of_restriction() -> Image.Image:
    """507-C 終わり: a white 40 cm disc with a thin blue ring and an 8 cm blue band (図 214)."""
    f = Face(400, 400, (512, 512))
    f.circle(200, 200, 200, WHITE)
    f.ring(200, 200, 194, 9, BLUE)
    layer = f.blank()
    layer.stroke([(320, 40), (80, 360)], 80, BLUE, round_cap=False)
    layer.clip(lambda m: m.circle(200, 200, 186, WHITE))
    f.composite(layer)
    return f.finish()


def safe_speed(value: str = "30") -> Image.Image:
    """510 注意事項 (the 30 × 30 cm example of 図 223): 「安全速度」 over a large number."""
    f = aux_face(300.0, 300.0)
    f.text(150, 68, "安全速度", 46, BLACK, weight=500, max_w=230)
    f.text(150, 185, value, 150, BLACK, weight=500, squeeze=0.85, max_w=230)
    return f.finish()


def parking_time(meter: bool = True) -> Image.Image:
    """504の2 駐車時間制限: 「パーキング・メーター（チケット）」「表示時刻まで」."""
    first = "パーキング・メーター" if meter else "パーキング・チケット"
    return text_plate([first, "表示時刻まで"])
