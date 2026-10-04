"""Standard plate faces of 別表第二: the outline, 縁 (rim), 縁線 (border line) and 地 (ground).

Thicknesses follow 備考一(五)8: 規制標識 縁 15 mm (縁線 15 mm for 一時停止・車両通行区分, 12 mm
for 一方通行), 警戒標識 縁 and 縁線 12 mm, 指示標識 縁 15 mm (横断歩道 etc. 縁 and 縁線 12 mm).
The red ring (枠) and slash (斜めの帯) widths of the 60 cm circle were measured on 国土交通省
「道路標識一覧」: ring ≈ 1/8 of the diameter, slash ≈ 1/10.
"""

from __future__ import annotations

import math

from .base import BLACK, BLUE, RED, RGBA, WHITE, YELLOW, Face, inset_poly, rounded_poly

CIRCLE_D = 600.0
RIM = 15.0  # 規制標識の縁
RING_W = 75.0  # red 枠 of the 60 cm circle
SLASH_W = 60.0
RING_IN = CIRCLE_D / 2 - RIM - RING_W  # radius of the white ground inside the ring


def circle_face(d: float = CIRCLE_D, out: tuple[int, int] = (512, 512)) -> Face:
    return Face(d, d, out)


def reg_ring(ground: RGBA = WHITE, d: float = CIRCLE_D) -> Face:
    """白縁 + 赤枠 + ground: 302, 304–310, 319–324 … (備考一(三)3(1))."""
    f = circle_face(d)
    c = d / 2
    k = d / CIRCLE_D
    f.circle(c, c, c, WHITE)
    f.circle(c, c, c - RIM * k, RED)
    f.circle(c, c, RING_IN * k, ground)
    return f


def blue_disc(d: float = CIRCLE_D) -> Face:
    """白縁 + 青地: 311, 325 …, 327の8, 327の10, 328 (備考一(三)3(3))."""
    f = circle_face(d)
    c = d / 2
    f.circle(c, c, c, WHITE)
    f.circle(c, c, c - RIM * d / CIRCLE_D, BLUE)
    return f


def slash(f: Face, width: float = SLASH_W, fill: RGBA = RED, d: float = CIRCLE_D, reverse: bool = False) -> None:
    """The red diagonal band from upper left to lower right, clipped to the ring's outer edge."""
    c = d / 2
    layer = f.blank()
    r = c - RIM * d / CIRCLE_D - 2
    a = math.radians(45 if not reverse else 135)
    dx, dy = math.cos(a) * r, math.sin(a) * r
    layer.stroke([(c - dx, c - dy), (c + dx, c + dy)], width, fill, round_cap=False)
    layer.clip(lambda m: m.circle(c, c, r, WHITE))
    f.composite(layer)


def cross(f: Face, width: float = SLASH_W, fill: RGBA = RED, d: float = CIRCLE_D) -> None:
    slash(f, width, fill, d)
    slash(f, width, fill, d, reverse=True)


# ----------------------------------------------------------------------
# 警戒標識: a 45 cm square stood on its corner, yellow with a black 縁線
# ----------------------------------------------------------------------
DIAMOND_SIDE = 450.0
DIAMOND_BOX = DIAMOND_SIDE * math.sqrt(2)


def diamond_outline(box: float = DIAMOND_BOX) -> list[tuple[float, float]]:
    c = box / 2
    return [(c, 0.0), (box, c), (c, box), (0.0, c)]


def warning_face() -> Face:
    """黄色の縁 12 mm, 黒の縁線 12 mm, 黄色の地 (備考一(三)2, (五)8(2))."""
    b = DIAMOND_BOX
    f = Face(b, b, (512, 512))
    outer = diamond_outline(b)
    f.poly(rounded_poly(outer, 22.0), YELLOW)
    f.poly(rounded_poly(inset_poly(outer, 12.0), 14.0), BLACK)
    f.poly(rounded_poly(inset_poly(outer, 24.0), 8.0), YELLOW)
    return f


# ----------------------------------------------------------------------
# Rectangles (規制 326/327 series, 指示, 補助)
# ----------------------------------------------------------------------
def rect_face(
    w: float,
    h: float,
    ground: RGBA,
    rim: float = RIM,
    rim_fill: RGBA = WHITE,
    line: float = 0.0,
    line_fill: RGBA = WHITE,
    r: float = 30.0,
    major: int | None = None,
) -> Face:
    """Rounded rectangle: 縁 (`rim`, `rim_fill`) at the edge, then an optional 縁線 (`line`), then the ground."""
    from .base import pow2_size

    out = pow2_size(w, h, major or (1024 if max(w, h) >= 900 else 512))
    f = Face(w, h, out)
    f.rect(0, 0, w, h, rim_fill, r)
    if line > 0:
        f.rect(rim, rim, w - rim, h - rim, line_fill, max(1.0, r - rim))
        f.rect(rim + line, rim + line, w - rim - line, h - rim - line, ground, max(1.0, r - rim - line))
    else:
        f.rect(rim, rim, w - rim, h - rim, ground, max(1.0, r - rim))
    return f


# ----------------------------------------------------------------------
# 一時停止・徐行: inverted triangle, 80 cm sides, corner R = 5 cm
# ----------------------------------------------------------------------
TRI_SIDE = 800.0
TRI_H = TRI_SIDE * math.sqrt(3) / 2


def tri_down_outline() -> list[tuple[float, float]]:
    return [(0.0, 0.0), (TRI_SIDE, 0.0), (TRI_SIDE / 2, TRI_H)]


def tri_down_face() -> Face:
    """512 × 512 over the triangle's 80 × 69.3 cm bounding box, like the first 一時停止・徐行
    textures (the plate's UV spans that box)."""
    return Face(TRI_SIDE, TRI_H, (512, 512))


# ----------------------------------------------------------------------
# 横断歩道 etc. (407 series): a pentagon, 60 cm wide — a 60 cm equilateral triangle on a
# 60 × 20 cm base (図示 R = 3.5 cm)
# ----------------------------------------------------------------------
PENTA_W = 600.0
PENTA_RECT_H = 200.0
PENTA_H = PENTA_W * math.sqrt(3) / 2 + PENTA_RECT_H


def pentagon_outline(inset: float = 0.0) -> list[tuple[float, float]]:
    pts = [
        (PENTA_W / 2, 0.0),
        (PENTA_W, PENTA_H - PENTA_RECT_H),
        (PENTA_W, PENTA_H),
        (0.0, PENTA_H),
        (0.0, PENTA_H - PENTA_RECT_H),
    ]
    return inset_poly(pts, inset) if inset else pts


def pentagon_face() -> Face:
    """青の縁 12 mm, 白の縁線 12 mm, 青の地 (備考一(三)4(2), (五)8(4))."""
    f = Face(PENTA_W, PENTA_H, (512, 512))
    f.poly(rounded_poly(pentagon_outline(), 35.0), BLUE)
    f.poly(rounded_poly(pentagon_outline(12.0), 26.0), WHITE)
    f.poly(rounded_poly(pentagon_outline(24.0), 18.0), BLUE)
    return f
