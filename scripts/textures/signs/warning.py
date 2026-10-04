"""警戒標識 (200 番台): black symbols on the yellow 45 cm diamond (別表第二 図 093–119).

Coordinates are millimetres in the diamond's bounding box (636 × 636, centre 318). Stroke
widths follow the 図示 6 cm of 201-A and 202; symbols that the 備考一(一)1 calls 例示 (├/┤, the
bends, 落石, 合流, 車線数減少, 勾配, 動物) also come mirrored (`left=True`).
"""

from __future__ import annotations

from PIL import Image

from . import pictos
from .base import BLACK, GREEN, SIGNAL_AMBER, SIGNAL_RED, WHITE, YELLOW, Face, arc_pts, arrow_path, bezier
from .plates import DIAMOND_BOX, warning_face

C = DIAMOND_BOX / 2
W = 52.0  # stroke of road symbols (図示 6 cm on the 45 cm plate, a little thinner to keep the gaps)
HL, HW = 95.0, 120.0  # arrowheads


def _mirror(img: Image.Image) -> Image.Image:
    return img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)


def _finish(f: Face, left: bool = False) -> Image.Image:
    img = f.finish()
    return _mirror(img) if left else img


def crossroads() -> Image.Image:
    """201-A ┼形道路交差点あり."""
    f = warning_face()
    f.rect(C - W / 2, 150, C + W / 2, 486, BLACK)
    f.rect(150, C - 30 - W / 2, 486, C - 30 + W / 2, BLACK)
    return f.finish()


def side_road(left: bool = False) -> Image.Image:
    """201-B ├形 (a road joining from the right); `left` gives ┤形."""
    f = warning_face()
    f.rect(C - 40 - W / 2, 160, C - 40 + W / 2, 486, BLACK)
    f.rect(C - 40, C - 20 - W / 2, 470, C - 20 + W / 2, BLACK)
    return _finish(f, left)


def t_junction() -> Image.Image:
    """201-C Ｔ形道路交差点あり."""
    f = warning_face()
    f.rect(175, 215 - W / 2, 461, 215 + W / 2, BLACK)
    f.rect(C - W / 2, 215, C + W / 2, 486, BLACK)
    return f.finish()


def y_junction() -> Image.Image:
    """201-D Ｙ形道路交差点あり."""
    f = warning_face()
    f.stroke([(C, 486), (C, 330)], W, BLACK, round_cap=False)
    f.stroke([(C, 340), (200, 215)], W, BLACK, round_cap=False)
    f.stroke([(C, 340), (436, 215)], W, BLACK, round_cap=False)
    f.circle(C, 335, W / 2, BLACK)
    return f.finish()


def rotary() -> Image.Image:
    """201の2 ロータリーあり: three arrows going round clockwise."""
    f = warning_face()
    for k in range(3):
        a0 = -150 + k * 120
        arrow_path(f, arc_pts(C, C, 118, a0 + 14, a0 + 100, 24), 46, 70, 100, BLACK)
    return f.finish()


def bend(left: bool = False) -> Image.Image:
    """202 右方屈曲あり (`left`: 左方)."""
    f = warning_face()
    pts = [(268, 500)] + bezier((268, 420), (268, 260), (330, 215), (450, 215), 30)
    arrow_path(f, pts, W, HL, HW, BLACK)
    return _finish(f, left)


def sharp_bend(left: bool = False) -> Image.Image:
    """203 右方屈折あり."""
    f = warning_face()
    arrow_path(f, [(270, 480), (270, 250), (460, 250)], W, HL, HW, BLACK)
    return _finish(f, left)


def reverse_bend(left: bool = False) -> Image.Image:
    """204 右背向屈曲あり: right then left, ending up and to the right."""
    f = warning_face()
    pts = bezier((150, 420), (230, 330), (300, 420), (360, 330), 24)
    pts += bezier((360, 330), (390, 285), (410, 250), (440, 220), 12)[1:]
    arrow_path(f, pts, 46, HL, HW, BLACK)
    return _finish(f, left)


def reverse_sharp_bend(left: bool = False) -> Image.Image:
    """205 右背向屈折あり: a step to the right then up."""
    f = warning_face()
    arrow_path(f, [(210, 470), (210, 360), (390, 360), (390, 165)], 46, HL, HW, BLACK)
    return _finish(f, left)


def winding(left: bool = False) -> Image.Image:
    """206 右つづら折りあり: a snaking road (first bend to the right) ending in an arrow."""
    f = warning_face()
    pts = bezier((330, 500), (300, 430), (390, 400), (360, 330), 20)
    pts += bezier((360, 330), (330, 260), (250, 280), (290, 190), 20)[1:]
    pts += [(305, 150)]
    arrow_path(f, pts, 40, 85, 105, BLACK)
    return _finish(f, left)


def level_crossing(electric: bool = False) -> Image.Image:
    """207-A 踏切あり (steam locomotive) / 207-B (electric railcar)."""
    f = warning_face()
    if electric:
        pictos.place_c(f, "electric_train", C, C - 15, 300, BLACK, YELLOW)
    else:
        pictos.place_c(f, "steam_train", C, C, 300, BLACK, YELLOW)
    return f.finish()


def school() -> Image.Image:
    """208 学校、幼稚園、保育所等あり."""
    f = warning_face()
    pictos.place_c(f, "school_children", C, C, 290, BLACK, YELLOW)
    return f.finish()


def traffic_signal(vertical: bool = False) -> Image.Image:
    """208の2 信号機あり: black housing, lamps 赤・黄・青 from the right (13 cm), or from the top when
    `vertical` (備考一(一)31)."""
    f = warning_face()
    if not vertical:
        f.rect(C - 170, C - 62, C + 170, C + 62, BLACK, r=62)
        for dx, col in ((-110, GREEN), (0, SIGNAL_AMBER), (110, SIGNAL_RED)):
            f.circle(C + dx, C, 50, col)
    else:
        f.rect(C - 62, C - 170, C + 62, C + 170, BLACK, r=62)
        for dy, col in ((-110, SIGNAL_RED), (0, SIGNAL_AMBER), (110, GREEN)):
            f.circle(C, C + dy, 50, col)
    return f.finish()


def slippery() -> Image.Image:
    """209 すべりやすい."""
    f = warning_face()
    pictos.place_c(f, "skid_car", C + 10, C, 260, BLACK, YELLOW)
    return f.finish()


def rockfall(left: bool = False) -> Image.Image:
    """209の2 落石のおそれあり (35 × 24 cm)."""
    f = warning_face()
    pictos.place_c(f, "rockfall", C, C + 20, 300, BLACK, YELLOW)
    return _finish(f, left)


def bumpy() -> Image.Image:
    """209の3 路面凹凸あり (30 × 6.4 cm)."""
    f = warning_face()
    pictos.place_c(f, "bumps", C, C, 300, BLACK, YELLOW)
    return f.finish()


def merge(left: bool = False) -> Image.Image:
    """210 合流交通あり: a road joining the through road from the lower left (main road 4.5 cm,
    joining road 4 cm)."""
    f = warning_face()
    f.rect(C + 20 - 22, 140, C + 20 + 22, 500, BLACK)
    f.stroke([(170, 420), (C + 10, 315)], 42, BLACK, round_cap=False)
    return _finish(f, left)


def lanes_reduce(left: bool = False) -> Image.Image:
    """211 車線数減少: the left edge steps in across the dashed lane line (lines 3 cm)."""
    f = warning_face()
    f.stroke([(210, 470), (210, 330), (255, 270), (255, 160)], 34, BLACK, round_cap=False)
    for y in range(160, 470, 46):
        f.rect(C - 8, y, C + 8, y + 26, BLACK)
    f.rect(400 - 17, 160, 400 + 17, 470, BLACK)
    return _finish(f, left)


def road_narrows() -> Image.Image:
    """212 幅員減少: both edges step in (lines 4 cm)."""
    f = warning_face()
    f.stroke([(210, 470), (210, 340), (265, 280), (265, 165)], 40, BLACK, round_cap=False)
    f.stroke([(426, 470), (426, 340), (371, 280), (371, 165)], 40, BLACK, round_cap=False)
    return f.finish()


def two_way() -> Image.Image:
    """212の2 二方向交通: up arrow on the left, down arrow on the right (4 cm apart)."""
    f = warning_face()
    arrow_path(f, [(C - 52, 480), (C - 52, 160)], 40, 90, 100, BLACK)
    arrow_path(f, [(C + 52, 160), (C + 52, 480)], 40, 90, 100, BLACK)
    return f.finish()


def gradient(up: bool = True, percent: str = "10") -> Image.Image:
    """212の3 上り急勾配あり / 212の4 下り急勾配あり: a black slope with a white arrow along it and
    the gradient (図示の数字は勾配の値, 備考一(一)32)."""
    f = warning_face()
    if up:
        f.poly([(150, 420), (480, 420), (480, 300)], BLACK)
        arrow_path(f, [(230, 400), (430, 330)], 18, 42, 46, WHITE)
        f.text(250, 300, percent, 75, BLACK, weight=700, max_w=120)
        f.text(345, 260, "%", 70, BLACK, weight=700)
    else:
        f.poly([(156, 300), (156, 420), (486, 420)], BLACK)
        arrow_path(f, [(200, 335), (400, 405)], 18, 42, 46, WHITE)
        f.text(300, 255, percent, 75, BLACK, weight=700, max_w=120)
        f.text(400, 300, "%", 70, BLACK, weight=700)
    return f.finish()


def road_works() -> Image.Image:
    """213 道路工事中."""
    f = warning_face()
    pictos.place_c(f, "road_worker", C, C, 270, BLACK, YELLOW)
    return f.finish()


def crosswind() -> Image.Image:
    """214 横風注意."""
    f = warning_face()
    pictos.place_c(f, "windsock", C + 10, C, 300, BLACK, YELLOW)
    return f.finish()


def animals(left: bool = False) -> Image.Image:
    """214の2 動物が飛び出すおそれあり (a deer; the animal is 例示)."""
    f = warning_face()
    pictos.place_c(f, "deer", C, C, 280, BLACK, YELLOW)
    return _finish(f, left)


def danger() -> Image.Image:
    """215 その他の危険."""
    f = warning_face()
    pictos.place_c(f, "exclamation", C, C + 5, 100, BLACK, YELLOW)
    return f.finish()
