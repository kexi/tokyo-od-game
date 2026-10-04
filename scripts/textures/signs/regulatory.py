"""規制標識 (300 番台) of 別表第二 that the first generator did not draw.

Coordinates are millimetres on the real plate (60 cm circles: centre 300, 300). Symbol sizes
follow the dimensions printed in the 別表第二 figures (e.g. 304 car 29 × 23 cm, 309 bicycle
37.5 × 21 cm, 327の10 symbol 420 mm, band 60 mm).
"""

from __future__ import annotations

from PIL import Image

from . import pictos
from .base import BLUE, RED, WHITE, Face, arc_pts, arrow_head, arrow_path, bezier, rounded_poly
from .plates import CIRCLE_D, RIM, RING_IN, blue_disc, cross, rect_face, reg_ring, slash, tri_down_face

C = CIRCLE_D / 2
HALO = 14.0  # white gap between a symbol and the slash behind it


def _inner_clip(m: Face) -> None:
    m.circle(C, C, RING_IN, WHITE)


def _symbol(f: Face, name: str, w: float, cy: float = C, cx: float = C, mirror: bool = False, fill=BLUE) -> None:
    f.with_halo(lambda layer: pictos.place_c(layer, name, cx, cy, w, fill, WHITE, mirror), HALO, WHITE, _inner_clip)


# ----------------------------------------------------------------------
# 通行止め・車両通行止め・車種別の通行止め
# ----------------------------------------------------------------------
def road_closed() -> Image.Image:
    """301 通行止め: red X, 「通行止」 in blue 7 cm high under the crossing."""
    f = reg_ring()
    cross(f)

    def label(layer: Face) -> None:
        layer.text(C, 430, "通行止", 70, BLUE, weight=800, squeeze=0.95)

    f.with_halo(label, 12.0, WHITE, _inner_clip)
    return f.finish()


def vehicles_closed() -> Image.Image:
    """302 車両通行止め: the red ring with the red slash and nothing else (図 S35F03102010003-122)."""
    f = reg_ring()
    slash(f)
    return f.finish()


def vehicle_closed(name: str, w: float, mirror: bool = False) -> Image.Image:
    """304–309: one vehicle pictogram in blue behind the slash."""
    f = reg_ring()
    slash(f)
    _symbol(f, name, w, mirror=mirror)
    return f.finish()


def combination_closed(names: tuple[str, ...] = ("car_front", "moped_rider")) -> Image.Image:
    """310 車両（組合せ）通行止め: the pictograms of 304–309 stacked (備考一(一)33); the 図示 pair is
    a car (20 cm wide) over a moped rider (18.5 cm)."""
    widths = {
        "car_front": 200.0,
        "moped_rider": 185.0,
        "truck_side": 230.0,
        "bus_side": 250.0,
        "bicycle": 230.0,
        "cart": 220.0,
    }
    f = reg_ring()
    slash(f)
    heights = [pictos.size_of(n, widths[n]) for n in names]
    gap = 22.0
    total = sum(heights) + gap * (len(names) - 1)
    y = C - total / 2
    for n, h in zip(names, heights, strict=True):
        _symbol(f, n, widths[n], cy=y + h / 2)
        y += h + gap
    return f.finish()


def two_up_closed() -> Image.Image:
    """310の2 大型自動二輪車及び普通自動二輪車二人乗り通行禁止 (two riders, 34 cm wide)."""
    return vehicle_closed("two_riders", 340)


def tyre_chain() -> Image.Image:
    """310の3 タイヤチェーンを取り付けていない車両通行止め: white tyre with chain on blue (30 × 42 cm)."""
    f = blue_disc()
    pictos.place_c(f, "tyre_chain", C, C, 300, WHITE, BLUE)
    return f.finish()


# ----------------------------------------------------------------------
# 指定方向外進行禁止 311-E / 311-F
# ----------------------------------------------------------------------
SHAFT = 60.0
HEAD_L = 110.0
HEAD_W = 140.0


def turn_all() -> Image.Image:
    """311-E: 直進・左折・右折 from one trunk (図 137, with its short diagonal stub)."""
    f = blue_disc()
    trunk_y = 520.0
    branch_y = 330.0
    arrow_path(f, [(C, trunk_y), (C, 70)], SHAFT, HEAD_L, HEAD_W, WHITE)
    left = [(C, branch_y + 50)] + bezier(
        (C, branch_y + 50), (C, branch_y - 10), (C - 60, branch_y - 10), (C - 110, branch_y - 10), 16
    )
    left.append((70, branch_y - 10))
    arrow_path(f, left, SHAFT * 0.92, HEAD_L, HEAD_W, WHITE)
    right = [(C, branch_y + 50)] + bezier(
        (C, branch_y + 50), (C, branch_y - 10), (C + 60, branch_y - 10), (C + 110, branch_y - 10), 16
    )
    right.append((530, branch_y - 10))
    arrow_path(f, right, SHAFT * 0.92, HEAD_L, HEAD_W, WHITE)
    # The diagonal stub of the figure, cut square at its end.
    f.stroke([(C - 5, branch_y - 45), (C - 62, branch_y - 102)], SHAFT * 0.8, WHITE, round_cap=False)
    return f.finish()


def turn_diagonal(right: bool = False) -> Image.Image:
    """311-F: one diagonal arrow to the lower left (図 138); `right` mirrors it (図示の記号は例示)."""
    f = blue_disc()
    a, b = (440, 160), (150, 450)
    if right:
        a, b = (600 - a[0], a[1]), (600 - b[0], b[1])
    arrow_path(f, [a, b], 68, 150, 190, WHITE)
    return f.finish()


# ----------------------------------------------------------------------
# 車両横断禁止・はみ出し禁止
# ----------------------------------------------------------------------
def no_crossing() -> Image.Image:
    """312 車両横断禁止: a right turn into the roadside (23.5 × 33 cm, shaft 4.5 cm) behind the slash."""
    f = reg_ring()
    slash(f)

    def arrow(layer: Face) -> None:
        pts = [(205, 420)] + arc_pts(285, 290, 80, 180, 270, 12) + [(410, 210)]
        arrow_path(layer, pts, 50, 95, 125, BLUE)

    f.with_halo(arrow, HALO, WHITE, _inner_clip)
    return f.finish()


def no_overtaking() -> Image.Image:
    """314 追越しのための右側部分はみ出し通行禁止 (and 314の2 追越し禁止): a car's path swinging out
    to the right past a shorter straight arrow, behind the slash (図 141)."""
    f = reg_ring()
    slash(f)

    def arrows(layer: Face) -> None:
        arrow_path(layer, [(235, 440), (235, 300)], 26, 62, 66, BLUE)
        s = (
            bezier((330, 470), (330, 380), (390, 360), (370, 290), 20)
            + bezier((370, 290), (350, 230), (320, 200), (330, 110), 20)[1:]
        )
        arrow_path(layer, s, 30, 75, 78, BLUE)

    f.with_halo(arrows, HALO, WHITE, _inner_clip)
    return f.finish()


# ----------------------------------------------------------------------
# 駐車・停車
# ----------------------------------------------------------------------
def overlay_ring_text(img: Image.Image, text: str, ring_mid: float = 300 - 15 - 37.5) -> Image.Image:
    """Hours in white on the red ring above the ground (315・316・317 with 「８―２０」, 備考一(一)35)."""
    f = Face(CIRCLE_D, CIRCLE_D, img.size)
    base = img.resize(f.size, Image.Resampling.LANCZOS)
    f.img = base
    from PIL import ImageDraw

    f.d = ImageDraw.Draw(f.img)
    f.text(C, C - ring_mid, text, 46, WHITE, weight=800, max_w=230, squeeze=0.9)
    return f.finish()


def time_limited_parking(minutes: str = "60", hours: str | None = "8-20") -> Image.Image:
    """318 時間制限駐車区間: white P (34.5 cm, stem 4 cm), minutes (15 cm) and 「分」 (9 cm), hours
    (6 cm) on blue (図 144)."""
    f = blue_disc()
    f.text(222, 322, "P", 345, WHITE, weight=600, squeeze=0.92)
    f.text(395, 420, minutes, 150, WHITE, weight=700, squeeze=0.78, max_w=170)
    f.text(470, 300, "分", 80, WHITE, weight=700)
    if hours:
        f.text(C, 92, hours, 58, WHITE, weight=700, max_w=250, squeeze=0.9)
    return f.finish()


# ----------------------------------------------------------------------
# 危険物・重量・高さ・最大幅・最高速度・最低速度
# ----------------------------------------------------------------------
def dangerous_goods() -> Image.Image:
    """319 危険物積載車両通行止め: 「危険物」 15 cm high behind the slash."""
    f = reg_ring()
    slash(f)
    f.with_halo(
        lambda layer: layer.text(C, C, "危険物", 150, BLUE, weight=800, max_w=380, squeeze=0.8),
        HALO,
        WHITE,
        _inner_clip,
    )
    return f.finish()


def _decimal(f: Face, value: str, cx: float, cy: float, big: float, small: float, max_w: float) -> tuple[float, float]:
    """Numerals with a small decimal part sitting on the baseline (「５.５」); returns the ink's right/top."""
    if "." in value:
        ip, dp = value.split(".", 1)
    else:
        ip, dp = value, ""
    wi = 0.55 * big * len(ip) * 0.8
    wd = 0.55 * small * len(dp) * 0.8 if dp else 0
    dot = 0.3 * small if dp else 0
    scale = min(1.0, max_w / (wi + dot + wd))
    wi, wd, dot = wi * scale, wd * scale, dot * scale
    left = cx - (wi + dot + wd) / 2
    base = cy + big / 2
    f.text(left + wi / 2, cy, ip, big, BLUE, weight=700, max_w=wi)
    if dp:
        f.circle(left + wi + dot / 2, base - small * 0.07, small * 0.09, BLUE)
        f.text(left + wi + dot + wd / 2, base - small / 2, dp, small, BLUE, weight=700, max_w=wd)
    return left + wi + dot + wd, base - big


def weight_limit(value: str = "5.5") -> Image.Image:
    """320 重量制限: tonnes in blue (24 cm numerals, 16 cm decimal) with 「t」 (12 cm) above right."""
    f = reg_ring()
    right, top = _decimal(f, value, C - 10, C + 15, 210, 150, 300)
    f.text(right + 5, top + 45, "t", 100, BLUE, weight=700, anchor="l")
    return f.finish()


def height_limit(value: str = "3.3") -> Image.Image:
    """321 高さ制限: metres between two blue triangles pointing in from top and bottom (図 147)."""
    f = reg_ring()
    for y0, y1 in ((C - RING_IN - 5, C - 150), (C + RING_IN + 5, C + 150)):
        f.poly([(C - 115, y0), (C + 115, y0), (C, y1)], BLUE)
    f.clip(lambda m: m.circle(C, C, C, WHITE))
    _redraw_ring(f)
    right, _ = _decimal(f, value, C - 30, C, 200, 140, 290)
    f.text(right + 6, C + 100 - 34, "m", 66, BLUE, weight=700, anchor="l")
    return f.finish()


def width_limit(value: str = "2.2") -> Image.Image:
    """322 最大幅: metres between two blue triangles pointing in from left and right (図 148)."""
    f = reg_ring()
    for x0, x1 in ((C - RING_IN - 5, C - 165), (C + RING_IN + 5, C + 165)):
        f.poly([(x0, C - 105), (x0, C + 105), (x1, C)], BLUE)
    _redraw_ring(f)
    right, top = _decimal(f, value, C - 12, C + 12, 190, 140, 250)
    f.text(right - 4, top + 26, "m", 52, BLUE, weight=700, anchor="l")
    return f.finish()


def _redraw_ring(f: Face) -> None:
    """Restore the red ring and white rim over anything that spilled outside the ground."""
    layer = f.blank()
    layer.circle(C, C, C, WHITE)
    layer.circle(C, C, C - RIM, RED)
    hole = layer.blank()
    hole.circle(C, C, RING_IN, WHITE)
    from PIL import ImageChops

    a = ImageChops.subtract(layer.img.getchannel("A"), hole.img.getchannel("A"))
    layer.img.putalpha(a)
    f.composite(layer)


def speed_sign(value: int, minimum: bool = False) -> Image.Image:
    """323 最高速度 for values the first generator did not draw (3-digit ones condensed), and 324
    最低速度: the same numerals with a blue bar 2.5 cm thick under them (図 150)."""
    f = reg_ring()
    s = str(value)
    h = 240.0 if not minimum else 220.0
    cy = C if not minimum else C - 18
    f.text(C, cy, s, h, BLUE, weight=800, squeeze=0.72 if len(s) < 3 else 0.6, max_w=370)
    if minimum:
        f.rect(C - 170, cy + h / 2 + 22, C + 170, cy + h / 2 + 47, BLUE)
    return f.finish()


# ----------------------------------------------------------------------
# 専用 (325 series): white symbols on blue
# ----------------------------------------------------------------------
def motor_only() -> Image.Image:
    """325 自動車専用: white car 38 × 38 cm."""
    f = blue_disc()
    pictos.place_c(f, "car_front", C, C + 5, 380, WHITE, BLUE)
    return f.finish()


def cycle_only() -> Image.Image:
    """325の2 特定小型原動機付自転車・自転車専用: white bicycle 48 cm wide."""
    f = blue_disc()
    pictos.place_c(f, "bicycle", C, C, 440, WHITE, BLUE)
    return f.finish()


def cycle_pedestrian_only(mirror: bool = False) -> Image.Image:
    """325の3 普通自転車等及び歩行者等専用: adult and child (25 cm) above a bicycle (28 cm wide);
    the mirror image is allowed (備考一(一)37)."""
    f = blue_disc()
    px = C - 80 if not mirror else C + 80
    bx = C + 60 if not mirror else C - 60
    pictos.place_c(f, "adult_child", px, 185, 210, WHITE, BLUE, mirror)
    pictos.place_c(f, "bicycle", bx, 420, 300, WHITE, BLUE, mirror)
    return f.finish()


def pedestrian_only() -> Image.Image:
    """325の4 歩行者等専用: adult and child, 46 cm high."""
    f = blue_disc()
    pictos.place_c(f, "adult_child", C, C + 5, 370, WHITE, BLUE)
    return f.finish()


def permitted_only(names: tuple[str, ...], widths: tuple[float, ...]) -> Image.Image:
    """325の5-A/B/C, 325の6 許可車両専用: vehicle(s) over 「許可車両専用」 (7 cm)."""
    f = blue_disc()
    heights = [pictos.size_of(n, w) for n, w in zip(names, widths, strict=True)]
    gap = 22.0
    total = sum(heights) + gap * (len(names) - 1)
    y = 255 - total / 2
    for n, w, h in zip(names, widths, heights, strict=True):
        pictos.place_c(f, n, C, y + h / 2, w, WHITE, BLUE)
        y += h + gap
    f.text(C, 470, "許可車両専用", 66, WHITE, weight=700, max_w=430)
    return f.finish()


def disaster_only() -> Image.Image:
    """325の7 広域災害応急対策車両専用: 「災害対策」, a relief truck (47 cm), 「Disaster Management」."""
    f = blue_disc()
    f.text(C, 95, "災害対策", 80, WHITE, weight=700, max_w=300)
    pictos.place_c(f, "disaster_truck", C, 290, 450, WHITE, BLUE)
    f.text(C, 440, "Disaster", 56, WHITE, weight=700, max_w=300, squeeze=0.8)
    f.text(C, 510, "Management", 56, WHITE, weight=700, max_w=400, squeeze=0.8)
    return f.finish()


# ----------------------------------------------------------------------
# 一方通行 326-B and 326の2
# ----------------------------------------------------------------------
def _one_way_plate(w: float, h: float) -> Face:
    """記号及び縁線を白色、縁及び地を青色 (備考一(三)3(4)); 縁 15 mm, 縁線 12 mm."""
    return rect_face(w, h, BLUE, rim=15, rim_fill=BLUE, line=12, line_fill=WHITE, r=30, major=512)


def one_way_tall() -> Image.Image:
    """326-B 一方通行: 35 × 60 cm, a white arrow (shaft 8 cm) pointing up."""
    f = _one_way_plate(350, 600)
    arrow_path(f, [(175, 545), (175, 55)], 80, 200, 230, WHITE)
    return f.finish()


def cycle_one_way(tall: bool = False, pointing_right: bool = False) -> Image.Image:
    """326の2-A (60 × 35 cm: arrow then bicycle) and 326の2-B (35 × 60 cm: arrow over bicycle)."""
    # The bicycle rides the way the arrow points (図 2JH00000215390・215391).
    if tall:
        f = _one_way_plate(350, 600)
        arrow_path(f, [(175, 300), (175, 50)], 80, 120, 230, WHITE)
        pictos.place_c(f, "bicycle", 175, 440, 250, WHITE, BLUE, mirror=True)
        return f.finish()
    f = _one_way_plate(600, 350)
    if pointing_right:
        arrow_path(f, [(300, 175), (560, 175)], 80, 120, 230, WHITE)
        pictos.place_c(f, "bicycle", 165, 180, 250, WHITE, BLUE)
    else:
        arrow_path(f, [(300, 175), (40, 175)], 80, 120, 230, WHITE)
        pictos.place_c(f, "bicycle", 435, 180, 250, WHITE, BLUE, mirror=True)
    return f.finish()


# ----------------------------------------------------------------------
# 327 series
# ----------------------------------------------------------------------
def vehicle_class_division(left: str = "軽車両", right: str = "二輪") -> Image.Image:
    """327 車両通行区分: blue lettering on white with a blue 縁線 15 mm, 120 × 90 cm; each column
    is written top to bottom (図 159: 「軽車両」 | 「二輪」)."""
    f = rect_face(1200, 900, WHITE, rim=15, rim_fill=WHITE, line=15, line_fill=BLUE, r=40)
    for cx, word in ((320, left), (880, right)):
        n = len(word)
        h = min(200.0, 620.0 / max(n, 1))
        pitch = 640.0 / n if n > 1 else 0
        y0 = 450 - pitch * (n - 1) / 2
        for i, ch in enumerate(word):
            f.text(cx, y0 + i * pitch, ch, h, BLUE, weight=500)
    return f.finish()


def _lane_dashes(f: Face, x: float, top: float, bottom: float, w: float = 30.0, n: int = 4) -> None:
    span = bottom - top
    seg = span / (2 * n - 1)
    for i in range(n):
        y = top + i * 2 * seg
        f.rect(x - w / 2, y, x + w / 2, y + seg, WHITE)


def vehicle_type_lane(trailer: bool = False) -> Image.Image:
    """327の2 特定の種類の車両の通行区分 (120 × 90 cm: a truck in the left lane, arrow over it) and
    327の3 牽引自動車の高速自動車国道通行区分 (90 × 90 cm: tractor-trailer in the right lane)."""
    if not trailer:
        f = rect_face(1200, 900, BLUE)
        for x in (60, 400, 750, 1110):
            _lane_dashes(f, x, 70, 830)
        arrow_path(f, [(230, 560), (230, 110)], 70, 160, 180, WHITE)
        f.with_halo(lambda lay: pictos.place_c(lay, "truck_side", 290, 700, 440, WHITE, BLUE), 18.0, BLUE)
        return f.finish()
    f = rect_face(900, 900, BLUE)
    for x in (60, 300, 560, 840):
        _lane_dashes(f, x, 70, 830)
    arrow_path(f, [(700, 560), (700, 110)], 70, 160, 180, WHITE)
    f.with_halo(lambda lay: pictos.place_c(lay, "trailer_side", 610, 720, 440, WHITE, BLUE, mirror=True), 18.0, BLUE)
    return f.finish()


def exclusive_lane_bus(label: str | None = None) -> Image.Image:
    """327の4 専用通行帯: bus (52 cm), 「専用」 (16 cm) and a down arrow between two solid white
    bars (9 cm) on blue, 90 × 90 cm (図 162). `label` writes words instead of the bus
    (備考一(一)39, e.g. 「路線バス等」)."""
    f = rect_face(900, 900, BLUE)
    f.rect(70, 70, 160, 830, WHITE)
    f.rect(740, 70, 830, 830, WHITE)
    if label:
        f.text(450, 190, label, 120, WHITE, weight=700, max_w=520)
    else:
        pictos.place_c(f, "bus_side", 450, 200, 520, WHITE, BLUE)
    f.text(450, 445, "専　用", 150, WHITE, weight=700, max_w=520)
    f.poly([(300, 620), (380, 620), (380, 560), (520, 560), (520, 620), (600, 620), (450, 790)], WHITE)
    return f.finish()


def cycle_lane() -> Image.Image:
    """327の4の2 普通自転車専用通行帯: 60 × 60 cm; the bicycle lane between solid bars on the left,
    an up arrow, a bicycle and 「専用」, dashed lane line on the right (図 163)."""
    f = rect_face(600, 600, BLUE)
    f.rect(50, 50, 90, 550, WHITE)
    f.rect(275, 50, 315, 550, WHITE)
    for i in range(4):
        y = 55 + i * 135
        f.rect(500, y, 535, y + 75, WHITE)
    arrow_head(f, (182, 70), (0, -1), 80, 170, WHITE)
    f.rect(162, 145, 202, 215, WHITE)
    pictos.place_c(f, "bicycle", 182, 330, 190, WHITE, BLUE)
    f.text(182, 470, "専用", 85, WHITE, weight=700, max_w=170)
    return f.finish()


def bus_priority_lane() -> Image.Image:
    """327の5 路線バス等優先通行帯: bus (52 cm), 「優先」 and a down arrow between dashed lane
    lines (5 cm wide, 10 cm dashes) on blue, 90 × 90 cm (図 164)."""
    f = rect_face(900, 900, BLUE)
    for x in (110, 790):
        for i in range(6):
            y = 75 + i * 128
            f.rect(x - 25, y, x + 25, y + 100, WHITE)
    pictos.place_c(f, "bus_side", 450, 210, 520, WHITE, BLUE)
    f.text(450, 440, "優　先", 150, WHITE, weight=700, max_w=500)
    f.poly([(310, 640), (390, 640), (390, 580), (510, 580), (510, 640), (590, 640), (450, 790)], WHITE)
    return f.finish()


def trailer_first_lane() -> Image.Image:
    """327の6 牽引自動車の自動車専用道路第一通行帯通行指定区間: 90 × 90 cm, an up arrow over a
    tractor-trailer (73 cm) between dashed lines (図 165)."""
    f = rect_face(900, 900, BLUE)
    for x in (90, 810):
        _lane_dashes(f, x, 70, 830, w=30, n=5)
    arrow_path(f, [(450, 560), (450, 90)], 110, 210, 250, WHITE)
    f.with_halo(lambda lay: pictos.place_c(lay, "trailer_side", 450, 730, 620, WHITE, BLUE, mirror=True), 18.0, BLUE)
    return f.finish()


def moped_two_step(small_turn: bool = False) -> Image.Image:
    """327の8 一般原動機付自転車の右折方法（二段階）: white up arrow, right arrow and 「原付」 on blue;
    327の9（小回り）: the same in blue on white with the red ring and slash."""
    if not small_turn:
        f = blue_disc()
        fill = WHITE
    else:
        f = reg_ring()
        slash(f)
        fill = BLUE
    k = 1.0 if not small_turn else 0.74

    def draw(layer: Face) -> None:
        arrow_path(layer, [(C - 160 * k, C + 190 * k), (C - 160 * k, C - 120 * k)], 45 * k, 105 * k, 115 * k, fill)
        arrow_path(layer, [(C - 80 * k, C - 160 * k), (C + 190 * k, C - 160 * k)], 45 * k, 105 * k, 115 * k, fill)
        layer.text(C + 40 * k, C + 90 * k, "原付", 150 * k, fill, weight=700, max_w=330 * k)

    if small_turn:
        f.with_halo(draw, HALO, WHITE, _inner_clip)
    else:
        draw(f)
    return f.finish()


def roundabout() -> Image.Image:
    """327の10 環状の交差点における右回り通行: three white arrows going round clockwise
    (symbol 420 mm, band 60 mm) on blue."""
    f = blue_disc()
    r = 168.0  # band centre: the 420 mm symbol less half the 60 mm band, and room for the heads
    for k in range(3):
        a0 = -150 + k * 120
        pts = arc_pts(C, C, r, a0 + 10, a0 + 102, 24)
        arrow_path(f, pts, 60, 105, 150, WHITE)
    return f.finish()


def parking_method(kind: str) -> Image.Image:
    """327の11 平行駐車・327の12 直角駐車・327の13 斜め駐車: kerb line (5 cm), a car seen from above
    (18 × 35 cm) and the words (10 cm) in white on blue, 60 × 60 cm (図 173–175)."""
    f = rect_face(600, 600, BLUE)
    f.rect(110, 70, 160, 450, WHITE)
    label = {"parallel": "平行駐車", "perpendicular": "直角駐車", "angle": "斜め駐車"}[kind]
    if kind == "parallel":
        pictos.place_c(f, "car_top", 340, 260, 180, WHITE, BLUE)
    else:
        layer = f.blank()
        pictos.place_c(layer, "car_top", 300, 300, 180, WHITE, BLUE)
        angle = 90 if kind == "perpendicular" else 45
        rot = layer.img.rotate(angle, resample=Image.Resampling.BICUBIC, center=layer.p(300, 300))
        shifted = Image.new("RGBA", f.size, (0, 0, 0, 0))
        dx, dy = (360 - 300, 255 - 300) if kind == "perpendicular" else (340 - 300, 240 - 300)
        shifted.paste(rot, (round(dx * f.k), round(dy * f.k)))
        f.img = Image.alpha_composite(f.img, shifted)
        from PIL import ImageDraw

        f.d = ImageDraw.Draw(f.img)
    f.text(300, 515, "　".join(label), 88, WHITE, weight=700, max_w=500)
    return f.finish()


def horn() -> Image.Image:
    """328 警笛鳴らせ (and 328の2 警笛区間): a white horn with sound waves on blue (図 176)."""
    f = blue_disc()
    pictos.place_c(f, "horn", C + 10, C, 420, WHITE, BLUE)
    return f.finish()


# ----------------------------------------------------------------------
# 徐行 329-B, 一時停止 330-B (the -A versions are the existing slow.png / stop.png)
# ----------------------------------------------------------------------
def _triangle_frame(ground) -> Face:
    from .base import inset_poly
    from .plates import tri_down_outline

    f = tri_down_face()
    outer = tri_down_outline()
    f.poly(rounded_poly(outer, 50.0), WHITE)
    if ground == "slow":
        f.poly(rounded_poly(inset_poly(outer, 15.0), 38.0), RED)
        f.poly(rounded_poly(inset_poly(outer, 95.0), 12.0), WHITE)
    else:
        f.poly(rounded_poly(inset_poly(outer, 15.0), 38.0), RED)
        f.poly(rounded_poly(inset_poly(outer, 45.0), 25.0), WHITE)
        f.poly(rounded_poly(inset_poly(outer, 60.0), 18.0), RED)
    return f


def slow_jp_only() -> Image.Image:
    """329-B 徐行 (and 329の2-B 前方優先道路): 「徐行」 13 cm in blue, no English."""
    f = _triangle_frame("slow")
    f.text(400, 200, "徐行", 128, BLUE, weight=800)
    return f.finish()


def stop_jp_only() -> Image.Image:
    """330-B 一時停止: 「止まれ」 13 cm in white on red, no English."""
    f = _triangle_frame("stop")
    f.text(400, 192, "止まれ", 122, WHITE, weight=900, max_w=380)
    return f.finish()


# ----------------------------------------------------------------------
# 歩行者等通行止め・横断禁止 (square, red frame 8 cm)
# ----------------------------------------------------------------------
def pedestrians(no_crossing_walk: bool = False, wording: str | None = None) -> Image.Image:
    """331 歩行者等通行止め: walker (29 cm) over 「通行止」 (7 cm); 332 歩行者等横断禁止: walker between
    two crossing lines over 「横断禁止」 (or 「わたるな」, 備考一(一)40). Blue on white, red frame
    and slash, 60 × 60 cm (図 181・182)."""
    f = rect_face(600, 600, WHITE, rim=15, rim_fill=WHITE, line=80, line_fill=RED, r=30)
    inner = (95.0, 95.0, 505.0, 505.0)
    layer = f.blank()
    layer.stroke([(inner[0], inner[1]), (inner[2], inner[3])], 55, RED, round_cap=False)
    layer.clip(lambda m: m.rect(*inner, WHITE))
    f.composite(layer)

    def draw(lay: Face) -> None:
        pictos.place_c(lay, "pedestrian", 310, 260, 175, BLUE, WHITE)
        if no_crossing_walk:
            lay.stroke([(150, 330), (450, 160)], 18, BLUE)
            lay.stroke([(220, 410), (470, 270)], 18, BLUE)

    f.with_halo(draw, 12.0, WHITE, lambda m: m.rect(*inner, WHITE))
    text = wording or ("横断禁止" if no_crossing_walk else "通行止")
    f.with_halo(
        lambda lay: lay.text(270, 455, text, 62, BLUE, weight=800, max_w=300),
        10.0,
        WHITE,
        lambda m: m.rect(*inner, WHITE),
    )
    return f.finish()
