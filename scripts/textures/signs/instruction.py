"""指示標識 (400 番台): white on blue 60 cm squares, the 407 pentagons and 409 規制予告
(別表第二 図 184–197)."""

from __future__ import annotations

from typing import Callable

from PIL import Image

from . import pictos
from .base import BLACK, BLUE, RED, WHITE, Face, arrow_head, arrow_path
from .plates import PENTA_H, PENTA_W, pentagon_face, rect_face


def _square() -> Face:
    """文字、記号及び縁を白色、地を青色 (備考一(三)4(1)); 縁 15 mm."""
    return rect_face(600, 600, BLUE, rim=15, rim_fill=WHITE, r=30)


def side_by_side() -> Image.Image:
    """401 並進可: two cyclists (42 cm high, 16 cm wide, 6 cm apart)."""
    f = _square()
    pictos.place_c(f, "two_cyclists", 300, 300, 400, WHITE, BLUE)
    return f.finish()


def tram_tracks() -> Image.Image:
    """402 軌道敷内通行可: a car on the tracks (30 cm wide)."""
    f = _square()
    pictos.place_c(f, "car_on_tracks", 300, 305, 360, WHITE, BLUE)
    return f.finish()


def parking_ok() -> Image.Image:
    """403 駐車可 (and 402の2 高齢運転者等標章自動車駐車可): 「P」 31 × 45 cm, stem 7 cm."""
    f = _square()
    f.text(305, 300, "P", 450, WHITE, weight=700, squeeze=1.0, max_w=320)
    return f.finish()


def stopping_ok() -> Image.Image:
    """404 停車可 (and 403の2): 「停」 37 cm."""
    f = _square()
    f.text(300, 305, "停", 370, WHITE, weight=500)
    return f.finish()


def priority_road() -> Image.Image:
    """405 優先道路: the priority road (22 cm wide, pointed at the top and notched at the
    bottom) over a narrower crossing road."""
    f = _square()
    f.rect(70, 255, 530, 325, WHITE)
    f.poly([(190, 160), (300, 70), (410, 160), (410, 530), (300, 450), (190, 530)], WHITE)
    return f.finish()


def centre_line() -> Image.Image:
    """406 中央線: 「中央線」 over a down arrow."""
    f = _square()
    f.text(300, 140, "中 央 線", 100, WHITE, weight=700, max_w=420)
    f.poly([(250, 240), (350, 240), (350, 330), (470, 330), (300, 520), (130, 330), (250, 330)], WHITE)
    return f.finish()


def stop_line() -> Image.Image:
    """406の2 停止線: a white bar over 「停止線」."""
    f = _square()
    f.rect(70, 110, 530, 210, WHITE)
    f.text(300, 400, "停止線", 160, WHITE, weight=700, max_w=460)
    return f.finish()


def _zebra(f: Face, long_bar: bool = True) -> None:
    """The crossing marks of 407: two short stripes beside the figure and a long bar (4 cm)."""
    y = PENTA_H - 170
    f.rect(110, y, 190, y + 38, WHITE)
    f.rect(410, y, 490, y + 38, WHITE)
    if long_bar:
        f.rect(95, PENTA_H - 95, 505, PENTA_H - 57, WHITE)


def crosswalk(children: bool = False) -> Image.Image:
    """407-A 横断歩道 (a walker 47 cm high) / 407-B (two children, 37 cm) on the blue pentagon."""
    f = pentagon_face()
    _zebra(f)
    if children:
        pictos.place(f, "children_crossing", 130, 300, 340, WHITE, BLUE)
    else:
        pictos.place(f, "pedestrian", 178, 150, 262, WHITE, BLUE)
    return f.finish()


def cycle_crossing() -> Image.Image:
    """407の2 自転車横断帯: a bicycle (40 cm) over the crossing marks."""
    f = pentagon_face()
    _zebra(f)
    pictos.place_c(f, "bicycle", PENTA_W / 2, PENTA_H - 250, 390, WHITE, BLUE)
    return f.finish()


def crosswalk_and_cycle() -> Image.Image:
    """407の3 横断歩道・自転車横断帯: a walker pushing past a bicycle."""
    f = pentagon_face()
    _zebra(f)
    pictos.place(f, "pedestrian", 150, 185, 200, WHITE, BLUE)
    f.with_halo(lambda lay: pictos.place_c(lay, "bicycle", 360, PENTA_H - 255, 300, WHITE, BLUE), 10.0, BLUE)
    return f.finish()


def safety_zone() -> Image.Image:
    """408 安全地帯: a white chevron (90°, 9 cm wide)."""
    f = _square()
    f.stroke([(130, 220), (300, 390), (470, 220)], 92, WHITE, round_cap=False)
    return f.finish()


def advance_notice(inner: Callable[[], Image.Image] | None = None, lines: tuple[str, ...] | None = None) -> Image.Image:
    """409-A 規制予告: a 規制標識 (40 cm) over blue text on a white plate with a blue 縁線
    (12 mm), 60 × 90 cm (図 196: 302 over 「自転車を除く」「日曜・休日を除く」「８―２０」「この先100m」)."""
    from . import regulatory

    f = rect_face(600, 900, WHITE, rim=12, rim_fill=WHITE, line=12, line_fill=BLUE, r=30)
    sign = (inner or regulatory.vehicles_closed)()
    big = sign.resize((round(400 * f.k), round(400 * f.k)), Image.Resampling.LANCZOS)
    f.img.alpha_composite(big, (round(100 * f.k), round(60 * f.k)))
    rows = lines if lines is not None else ("自転車を除く", "日曜・休日を除く", "8 − 20", "この先100m")
    sizes = [58.0] * (len(rows) - 1) + [88.0]
    gap = 22.0
    y = 500.0 + (340.0 - sum(sizes) - gap * (len(rows) - 1)) / 2
    for row, h in zip(rows, sizes, strict=True):
        f.text_ink(300, y + h / 2, row, h, BLUE, weight=700, max_w=500)
        y += h + gap
    return f.finish()


def detour_notice(label: str = "小田原") -> Image.Image:
    """409-B 規制予告: a map of the streets ahead (white on blue) with the detour route as a black
    arrow, the closed street marked by a 規制標識, and the destination (図 197)."""
    f = rect_face(900, 600, BLUE, rim=9, rim_fill=WHITE, line=0, r=25)
    # Streets (white).
    f.rect(40, 170, 860, 215, WHITE)
    f.rect(40, 380, 860, 425, WHITE)
    f.rect(320, 170, 365, 560, WHITE)
    f.rect(560, 40, 605, 560, WHITE)
    # Detour (black): up from the bottom, along the left block, back to the main street.
    arrow_path(f, [(583, 540), (583, 470), (342, 470), (342, 120), (583, 120), (583, 50)], 22, 50, 58, BLACK)
    # The closed street ahead.
    f.circle(583, 300, 62, WHITE)
    f.circle(583, 300, 56, RED)
    f.circle(583, 300, 40, WHITE)
    f.stroke([(555, 272), (611, 328)], 14, RED, round_cap=False)
    f.rect(640, 45, 850, 140, WHITE, r=6)
    f.text(745, 93, label, 70, BLUE, weight=700, max_w=190)
    arrow_head(f, (583, 30), (0, -1), 30, 50, BLACK)
    return f.finish()
