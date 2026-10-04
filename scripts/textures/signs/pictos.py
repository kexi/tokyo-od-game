"""Pictograms of 別表第二 (vehicles, people, warning symbols), drawn as flat silhouettes.

Each pictogram is laid out in its own design box (units noted per function, y down) and placed
on a Face with `place(face, name, x, y, w, fill, bg, mirror)`: (x, y) is the top-left of the box
in mm and `w` its width; the height follows the box's aspect. `bg` is the ground colour, used
for cut-outs (windows, spokes) so a silhouette reads like the drawings in the 命令.
"""

from __future__ import annotations

import math
from typing import Callable, Sequence

from .base import RGBA, Face, Pt, arc_pts, bezier


class Pen:
    def __init__(self, face: Face, x: float, y: float, scale: float, box_w: float, mirror: bool):
        self.f, self.x, self.y, self.s, self.bw, self.m = face, x, y, scale, box_w, mirror

    def t(self, u: float, v: float) -> Pt:
        if self.m:
            u = self.bw - u
        return (self.x + u * self.s, self.y + v * self.s)

    def ts(self, pts: Sequence[Pt]) -> list[Pt]:
        return [self.t(u, v) for u, v in pts]

    def poly(self, pts: Sequence[Pt], fill: RGBA) -> None:
        self.f.poly(self.ts(pts), fill)

    def circle(self, u: float, v: float, r: float, fill: RGBA) -> None:
        x, y = self.t(u, v)
        self.f.circle(x, y, r * self.s, fill)

    def ellipse(self, u: float, v: float, ru: float, rv: float, fill: RGBA) -> None:
        x, y = self.t(u, v)
        self.f.ellipse(x, y, ru * self.s, rv * self.s, fill)

    def ring(self, u: float, v: float, r: float, w: float, fill: RGBA) -> None:
        x, y = self.t(u, v)
        self.f.ring(x, y, r * self.s, w * self.s, fill)

    def rect(self, u0: float, v0: float, u1: float, v1: float, fill: RGBA, r: float = 0.0) -> None:
        a, b = self.t(u0, v0), self.t(u1, v1)
        self.f.rect(min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]), fill, r * self.s)

    def stroke(self, pts: Sequence[Pt], w: float, fill: RGBA, round_cap: bool = True) -> None:
        self.f.stroke(self.ts(pts), w * self.s, fill, round_cap)


# name -> (design width, design height, drawing function(pen, fill, bg))
PICTOS: dict[str, tuple[float, float, Callable[[Pen, RGBA, RGBA], None]]] = {}


def picto(name: str, w: float, h: float):
    def reg(fn):
        PICTOS[name] = (w, h, fn)
        return fn

    return reg


def place(face: Face, name: str, x: float, y: float, w: float, fill: RGBA, bg: RGBA, mirror: bool = False) -> float:
    """Draw pictogram `name` with its box's top-left at (x, y) mm, `w` mm wide; returns its height."""
    bw, bh, fn = PICTOS[name]
    s = w / bw
    fn(Pen(face, x, y, s, bw, mirror), fill, bg)
    return bh * s


def place_c(
    face: Face, name: str, cx: float, cy: float, w: float, fill: RGBA, bg: RGBA, mirror: bool = False
) -> tuple[float, float, float, float]:
    """`place` centred on (cx, cy); returns the box."""
    bw, bh, _ = PICTOS[name]
    h = bh * w / bw
    place(face, name, cx - w / 2, cy - h / 2, w, fill, bg, mirror)
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def size_of(name: str, w: float) -> float:
    bw, bh, _ = PICTOS[name]
    return bh * w / bw


# ----------------------------------------------------------------------
# Vehicles
# ----------------------------------------------------------------------
@picto("car_front", 100, 80)
def _car_front(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Sedan seen from the front (304, 310, 325): cabin with two windscreen panes, body with
    headlamps and grille, bumper, tyres."""
    p.poly([(24, 0), (76, 0), (86, 28), (14, 28)], c)
    p.rect(20, 0, 80, 6, c, r=4)
    p.poly([(26, 5), (48, 5), (48, 25), (19, 25)], bg)
    p.poly([(52, 5), (74, 5), (81, 25), (52, 25)], bg)
    p.rect(2, 24, 98, 60, c, r=9)
    p.circle(15, 38, 6.5, bg)
    p.circle(85, 38, 6.5, bg)
    p.rect(36, 33, 64, 52, bg, r=2)
    for u in (41, 47, 53, 59):
        p.rect(u, 35, u + 2.6, 50, c)
    p.rect(0, 55, 100, 66, c, r=3)
    p.rect(4, 59.5, 96, 61, bg)
    p.rect(6, 64, 22, 80, c, r=3)
    p.rect(78, 64, 94, 80, c, r=3)


@picto("truck_side", 100, 56)
def _truck_side(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Box truck facing right (305, 503-B/C, 327の2)."""
    p.rect(0, 0, 68, 40, c, r=1.5)
    p.poly([(70, 10), (88, 10), (94, 22), (99, 26), (99, 42), (70, 42)], c)
    p.poly([(78, 13), (87, 13), (92, 23), (78, 23)], bg)
    p.rect(70.5, 13, 72.5, 40, bg)
    p.rect(0, 40, 100, 46, c)
    for u in (17, 31, 86):
        p.circle(u, 47, 9, c)
        p.circle(u, 47, 3, bg)
    p.rect(0, 40, 100, 41, bg)


@picto("bus_side", 100, 40)
def _bus_side(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Bus facing right (306, 325の5-A, 327の4, 327の5): window row and two wheels."""
    p.rect(0, 0, 100, 31, c, r=6)
    p.rect(90, 0, 100, 20, c, r=8)
    for i in range(7):
        u = 6 + i * 12
        p.rect(u, 5, u + 9.5, 14, bg, r=1.5)
    p.rect(92, 5, 97, 18, bg, r=1.5)
    p.rect(0, 22, 100, 23.2, bg)
    for u in (20, 80):
        p.circle(u, 31, 9.5, bg)
        p.circle(u, 31, 7.5, c)
        p.circle(u, 31, 2.4, bg)


@picto("taxi_side", 100, 52)
def _taxi_side(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Taxi facing right with the roof sign (325の5-B, 325の6)."""
    p.rect(42, 0, 58, 9, c, r=1.5)
    p.poly([(26, 10), (70, 10), (82, 24), (16, 24)], c)
    p.poly([(30, 13), (47, 13), (47, 22), (24, 22)], bg)
    p.poly([(51, 13), (68, 13), (76, 22), (51, 22)], bg)
    p.rect(0, 22, 100, 42, c, r=7)
    p.rect(30, 26, 70, 36, bg, r=1)
    for u in (22, 78):
        p.circle(u, 42, 10.5, bg)
        p.circle(u, 42, 8.5, c)
        p.circle(u, 42, 3, bg)


@picto("truck_front", 100, 110)
def _truck_front(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Truck seen from the front with its box behind (325の5-C)."""
    p.rect(4, 0, 96, 40, c, r=2)
    p.rect(6, 38, 94, 100, c, r=6)
    p.rect(14, 46, 86, 68, bg, r=3)
    p.rect(14, 74, 86, 77, bg)
    p.circle(18, 86, 5, bg)
    p.circle(82, 86, 5, bg)
    p.rect(34, 82, 66, 90, bg, r=1.5)
    p.rect(2, 94, 98, 100, c, r=2)
    p.rect(10, 98, 26, 110, c, r=2)
    p.rect(74, 98, 90, 110, c, r=2)


@picto("trailer_side", 100, 34)
def _trailer_side(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Tractor and semi-trailer facing left (327の3, 327の6)."""
    p.rect(26, 0, 100, 22, c, r=1)
    p.poly([(2, 6), (18, 6), (22, 10), (22, 26), (0, 26), (0, 14)], c)
    p.poly([(4, 9), (14, 9), (14, 15), (2.5, 15)], bg)
    p.rect(0, 22, 100, 26, c)
    for u in (9, 34, 78, 92):
        p.circle(u, 27, 6.5, c)
        p.circle(u, 27, 2.2, bg)
    p.rect(22, 21.5, 26, 23, bg)


@picto("moped_rider", 100, 82)
def _moped_rider(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Rider on a small motorcycle facing right (307, 310)."""
    p.circle(40, 10, 8.5, c)
    p.poly([(31, 20), (47, 19), (55, 36), (45, 45), (30, 43)], c)
    p.stroke([(46, 24), (58, 32), (65, 26)], 6, c)
    p.stroke([(34, 40), (53, 44)], 9, c)
    p.stroke([(53, 44), (55, 58)], 7, c)
    p.stroke([(66, 26), (74, 44), (80, 64)], 5.5, c)
    p.stroke([(60, 24), (71, 24)], 4, c)
    p.poly([(4, 52), (12, 44), (42, 44), (50, 52), (64, 54), (71, 46), (77, 50), (70, 61), (36, 63), (8, 61)], c)
    p.rect(16, 38, 43, 45, c, r=2.5)
    for u in (20, 80):
        p.ring(u, 65, 16.5, 5.5, c)
        p.circle(u, 65, 4, c)


def _moped_rider(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Rider on a small motorcycle facing right (307, 310)."""
    # Rider: helmet, torso leaning forward, arm to the bars, leg on the step.
    p.circle(42, 9, 8, c)
    p.poly([(33, 6), (52, 4), (53, 9), (35, 12)], c)
    p.poly([(36, 18), (46, 17), (52, 36), (44, 46), (34, 44)], c)
    p.stroke([(44, 22), (58, 30), (66, 28)], 6, c)
    p.stroke([(40, 42), (54, 48), (52, 60)], 8, c)
    # Machine: front fork, body, seat, rear fender.
    p.stroke([(68, 26), (76, 44), (82, 64)], 5, c)
    p.rect(62, 24, 72, 28, c, r=1.5)
    p.poly([(20, 44), (46, 44), (60, 50), (76, 46), (78, 54), (60, 62), (30, 62), (16, 54)], c)
    p.rect(24, 40, 44, 46, c, r=2)
    p.poly([(4, 52), (20, 48), (24, 56), (8, 58)], c)
    for u in (18, 82):
        p.ring(u, 66, 15, 5, c)
        p.circle(u, 66, 3.5, c)


@picto("two_riders", 100, 80)
def _two_riders(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Two people on a motorcycle facing right (310の2)."""
    for du in (0, -21):
        p.circle(46 + du, 9, 8, c)
        p.poly([(38 + du, 18), (53 + du, 17), (59 + du, 36), (49 + du, 44), (36 + du, 42)], c)
        p.stroke([(40 + du, 39), (57 + du, 43)], 8.5, c)
        p.stroke([(57 + du, 43), (58 + du, 56)], 6.5, c)
    p.stroke([(52, 22), (63, 30), (70, 25)], 5.5, c)
    p.stroke([(31, 22), (44, 30)], 5, c)
    p.stroke([(71, 25), (78, 43), (83, 63)], 5.5, c)
    p.stroke([(64, 23), (75, 23)], 4, c)
    p.poly([(2, 50), (10, 43), (56, 43), (66, 51), (74, 45), (80, 50), (72, 60), (30, 62), (6, 60)], c)
    for u in (18, 83):
        p.ring(u, 64, 16, 5.5, c)
        p.circle(u, 64, 4, c)


def _two_riders(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Two people on a motorcycle facing right (310の2)."""
    for du in (0, -20):
        p.circle(44 + du, 8, 7.5, c)
        p.poly([(37 + du, 16), (50 + du, 15), (55 + du, 36), (46 + du, 46), (35 + du, 44)], c)
        p.stroke([(46 + du, 42), (56 + du, 48), (54 + du, 58)], 7.5, c)
    p.stroke([(48, 22), (62, 30), (70, 28)], 6, c)
    p.stroke([(28, 22), (42, 30)], 5.5, c)
    p.stroke([(72, 26), (78, 44), (83, 62)], 5, c)
    p.poly([(14, 44), (54, 44), (64, 50), (78, 46), (80, 54), (62, 62), (26, 62), (10, 54)], c)
    p.poly([(2, 50), (16, 46), (18, 56), (6, 56)], c)
    for u in (18, 83):
        p.ring(u, 65, 15, 5, c)
        p.circle(u, 65, 3.5, c)


@picto("bicycle", 100, 60)
def _bicycle(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Bicycle facing right (309, 325の2, 326の2, 327の4の2, 407の2)."""
    lw = 3.6
    p.ring(19, 41, 19, lw, c)
    p.ring(81, 41, 19, lw, c)
    # Frame: rear hub, crank, seat post, head tube, front hub.
    crank = (46, 41)
    seat = (39, 12)
    head = (74, 14)
    p.stroke([(19, 41), crank, (78, 18)], lw, c)
    p.stroke([(19, 41), (40, 16)], lw, c)
    p.stroke([crank, seat], lw, c)
    p.stroke([(40, 16), head], lw, c)
    p.stroke([head, (81, 41)], lw, c)
    p.stroke([(73, 12), (74, 4), (68, 3)], lw, c)
    p.rect(31, 7, 45, 11, c, r=2)
    p.ring(crank[0], crank[1], 5, lw * 0.8, c)
    p.circle(19, 41, 2.2, c)
    p.circle(81, 41, 2.2, c)


@picto("cart", 100, 62)
def _cart(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Two-wheeled hand cart (大八車) with its shafts (308)."""
    p.ring(26, 32, 26, 5, c)
    for k in range(12):
        a = math.pi * k / 6
        p.stroke([(26, 32), (26 + 23 * math.cos(a), 32 + 23 * math.sin(a))], 2.4, c)
    p.circle(26, 32, 6, c)
    p.stroke([(0, 50), (100, 12)], 5, c)
    p.stroke([(40, 30), (97, 8)], 4, c)
    p.rect(88, 2, 98, 10, c, r=1)


@picto("tyre_chain", 72, 100)
def _tyre_chain(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Tyre seen at an angle with a ladder chain on its tread (310の3), white lines on blue."""
    lw = 2.8
    p.ellipse(35, 50, 34, 49.5, c)
    p.ellipse(35, 50, 31, 46.5, bg)
    p.ellipse(47, 50, 22, 46, c)
    p.ellipse(47, 50, 19.2, 43.2, bg)
    p.ellipse(52, 50, 12, 25, c)
    p.ellipse(52, 50, 9.5, 22, bg)
    p.ellipse(53.5, 50, 5.5, 12, c)
    # Chain across the tread: a zigzag between the outer edge and the sidewall.
    pts = []
    for i in range(15):
        a = math.radians(-82 + i * 164 / 14)
        r_out = (35 - 32 * math.cos(a), 50 + 47.5 * math.sin(a))
        r_in = (47 - 20 * math.cos(a), 50 + 44 * math.sin(a))
        pts.append(r_out if i % 2 == 0 else r_in)
    p.stroke(pts, lw, c)
    # Chain links round the sidewall.
    for i in range(16):
        a = math.radians(-90 + i * 360 / 16)
        p.ring(47 + 16 * math.cos(a), 50 + 37 * math.sin(a), 3.4, 1.8, c)


def _tyre_chain(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Tyre seen at an angle with a ladder chain (310の3), drawn on blue in white."""
    p.ellipse(36, 50, 34, 49, c)
    p.ellipse(36, 50, 29, 44, bg)
    p.ellipse(52, 50, 14, 27, c)
    p.ellipse(52, 50, 10, 22, bg)
    p.ellipse(54, 50, 5, 9, c)
    lw = 2.6
    for i in range(10):
        a0 = -80 + i * 17
        pts = arc_pts(36, 50, 31, a0, a0 + 17, 4)
        q = [(36 + 16 * math.cos(math.radians(a0 + 8)), 50 + 46 * math.sin(math.radians(a0 + 8)) * 0.98)]
        p.stroke([pts[0], q[0], pts[-1]], lw, c)
    for i in range(14):
        a = math.radians(-90 + i * 26)
        p.circle(36 + 31.5 * math.cos(a) * 0.95, 50 + 46 * math.sin(a), 2.3, c)


@picto("disaster_truck", 100, 64)
def _disaster_truck(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Disaster-relief truck with a beacon and the cab window (325の7)."""
    p.rect(30, 6, 100, 44, c, r=1)
    p.poly([(4, 18), (26, 18), (28, 20), (28, 46), (0, 46), (0, 30)], c)
    p.rect(12, 12, 18, 18, c)
    p.poly([(5, 21), (20, 21), (20, 31), (2, 31)], bg)
    p.circle(12, 26, 3.5, c)
    p.rect(0, 44, 100, 48, c)
    p.rect(34, 46, 66, 50, c)
    for u in (16, 84):
        p.circle(u, 52, 10, c)
        p.circle(u, 52, 5, bg)
        p.circle(u, 52, 2.5, c)


# ----------------------------------------------------------------------
# People
# ----------------------------------------------------------------------
def _walker(p: Pen, c: RGBA, u: float, v: float, s: float, hat: bool = True) -> None:
    """A man walking right (hat, arms swinging, long stride), `s` = height, feet at (u, v)."""

    def q(x: float, y: float) -> Pt:
        return (u + x * s / 100, v - s + y * s / 100)

    k = s / 100
    hx, hy = q(34, 11.5)
    p.circle(hx, hy, 6.8 * k, c)
    if hat:
        p.poly([q(24, 7.5), q(45, 6), q(45, 8.5), q(24, 10)], c)
        p.poly([q(28, 7.5), q(29, 1), q(39, 0.5), q(41, 7)], c)
    p.poly([q(28, 19), q(39, 19), q(43, 25), q(41, 49), q(29, 50), q(26, 31)], c)
    p.stroke([q(39, 22), q(46, 34), q(52, 41)], 5.5 * k, c)
    p.stroke([q(29, 22), q(23, 34), q(20, 43)], 5.5 * k, c)
    p.stroke([q(37, 47), q(46, 69), q(54, 91)], 7.5 * k, c)
    p.stroke([q(31, 47), q(24, 70), q(12, 90)], 7.5 * k, c)
    p.poly([q(51, 88), q(62, 93), q(62, 97), q(51, 97)], c)
    p.poly([q(5, 90), q(14, 87), q(17, 96), q(5, 97)], c)


def _child(p: Pen, c: RGBA, u: float, v: float, s: float, girl: bool = False) -> None:
    """A child walking right, `s` = height, feet at (u, v)."""

    def q(x: float, y: float) -> Pt:
        return (u + x * s, v - s + y * s)

    hx, hy = q(0.5, 0.1)
    p.circle(hx, hy, 0.1 * s, c)
    if girl:
        p.circle(*q(0.4, 0.04), 0.045 * s, c)
        p.poly([q(0.4, 0.22), q(0.6, 0.22), q(0.72, 0.62), q(0.3, 0.62)], c)
    else:
        p.poly([q(0.4, 0.22), q(0.62, 0.22), q(0.64, 0.58), q(0.38, 0.58)], c)
    p.stroke([q(0.6, 0.27), q(0.74, 0.42), q(0.82, 0.5)], 0.07 * s, c)
    p.stroke([q(0.42, 0.27), q(0.3, 0.42)], 0.07 * s, c)
    p.stroke([q(0.55, 0.58), q(0.66, 0.78), q(0.72, 0.97)], 0.09 * s, c)
    p.stroke([q(0.46, 0.58), q(0.38, 0.78), q(0.28, 0.96)], 0.09 * s, c)


@picto("pedestrian", 64, 100)
def _pedestrian(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Man with a hat walking right (331, 332, 407-A)."""
    _walker(p, c, 0, 100, 100)


@picto("adult_child", 80, 100)
def _adult_child(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Adult holding a child's hand, both facing the viewer (325の3, 325の4)."""
    # Adult (front view).
    p.circle(28, 9, 8, c)
    p.poly([(23, 0), (33, 0), (37, 4), (19, 4)], c)
    p.poly([(17, 19), (39, 19), (42, 54), (35, 54), (34, 36), (22, 36), (21, 54), (14, 54)], c)
    p.rect(19, 50, 37, 60, c)
    p.stroke([(22, 58), (21, 97)], 7.5, c)
    p.stroke([(34, 58), (35, 97)], 7.5, c)
    p.stroke([(16, 22), (12, 54)], 6, c)
    p.stroke([(40, 22), (48, 48), (55, 54)], 6, c)
    # Child.
    p.circle(62, 45, 6.2, c)
    p.poly([(55, 53), (69, 53), (72, 76), (52, 76)], c)
    p.stroke([(57, 56), (53, 62)], 4.5, c)
    p.stroke([(68, 56), (72, 70)], 4.5, c)
    p.stroke([(58, 75), (56, 97)], 5.5, c)
    p.stroke([(66, 75), (68, 97)], 5.5, c)


@picto("school_children", 100, 100)
def _school_children(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Adult walking a child (208 学校、幼稚園、保育所等あり), on a ground line."""
    _walker(p, c, 4, 92, 88)
    _child(p, c, 50, 92, 62, girl=True)
    p.stroke([(42, 39), (60, 53)], 4, c)
    p.rect(0, 92, 100, 96, c)


@picto("children_crossing", 100, 100)
def _children_crossing(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Two children walking right, the elder with a school bag (407-B)."""
    _child(p, c, 2, 96, 96)
    p.rect(14, 26, 30, 50, c, r=3)
    _child(p, c, 52, 96, 74, girl=True)
    p.stroke([(76, 37), (60, 58)], 4, c)


@picto("two_cyclists", 100, 100)
def _two_cyclists(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Two cyclists side by side seen from the front (401 並進可)."""
    for u in (25, 75):
        p.circle(u, 9, 7.5, c)
        p.poly([(u - 12, 20), (u + 12, 20), (u + 10, 46), (u - 10, 46)], c)
        p.rect(u - 13, 19, u + 13, 27, c, r=4)
        p.stroke([(u - 12, 23), (u - 15, 37), (u - 12, 48)], 5, c)
        p.stroke([(u + 12, 23), (u + 15, 37), (u + 12, 48)], 5, c)
        p.rect(u - 16, 47, u + 16, 50, c, r=1.5)
        p.poly([(u - 9, 46), (u - 3, 46), (u - 4, 70), (u - 8, 66)], c)
        p.poly([(u + 3, 46), (u + 9, 46), (u + 8, 66), (u + 4, 70)], c)
        p.rect(u - 3.4, 52, u + 3.4, 98, c, r=3.4)
        p.rect(u - 1.1, 58, u + 1.1, 92, bg)


def _two_cyclists(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Two cyclists side by side seen from the front (401 並進可)."""
    for u in (24, 76):
        p.circle(u, 9, 7.5, c)
        p.poly([(u - 13, 19), (u + 13, 19), (u + 11, 46), (u - 11, 46)], c)
        p.stroke([(u - 13, 21), (u - 17, 40), (u - 12, 48)], 5, c)
        p.stroke([(u + 13, 21), (u + 17, 40), (u + 12, 48)], 5, c)
        p.rect(u - 15, 46, u + 15, 50, c, r=1.5)
        p.rect(u - 9, 50, u + 9, 64, c, r=3)
        p.rect(u - 3.2, 52, u + 3.2, 98, c, r=3)
        p.rect(u - 1.2, 66, u + 1.2, 92, bg)


@picto("car_on_tracks", 100, 100)
def _car_on_tracks(p: Pen, c: RGBA, bg: RGBA) -> None:
    """A car seen from behind driving on tram tracks (402 軌道敷内通行可)."""
    p.poly([(26, 0), (74, 0), (82, 22), (18, 22)], c)
    p.poly([(30, 4), (70, 4), (76, 19), (24, 19)], bg)
    p.rect(10, 18, 90, 50, c, r=8)
    p.rect(14, 26, 28, 34, bg, r=1.5)
    p.rect(72, 26, 86, 34, bg, r=1.5)
    p.rect(40, 34, 60, 42, bg, r=1)
    p.rect(14, 50, 28, 60, c, r=2)
    p.rect(72, 50, 86, 60, c, r=2)
    # Rails converging to the distance, sleepers across.
    p.poly([(36, 60), (40, 60), (14, 100), (6, 100)], c)
    p.poly([(60, 60), (64, 60), (94, 100), (86, 100)], c)
    for v, half in ((68, 30), (80, 38), (93, 48)):
        p.rect(50 - half, v, 50 + half, v + 3.5, c)


@picto("car_top", 50, 100)
def _car_top(p: Pen, c: RGBA, bg: RGBA) -> None:
    """A car seen from above, nose up (327の11–13 駐車の方法)."""
    p.rect(0, 0, 50, 100, c, r=10)
    p.poly([(8, 22), (42, 22), (38, 34), (12, 34)], bg)
    p.poly([(10, 72), (40, 72), (38, 82), (12, 82)], bg)
    p.poly([(4, 30), (9, 37), (9, 68), (4, 74)], bg)
    p.poly([(46, 30), (41, 37), (41, 68), (46, 74)], bg)
    p.rect(13, 38, 37, 68, c)


@picto("horn", 100, 90)
def _horn(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Horn with two zigzag sound waves spreading to the right (328 警笛鳴らせ)."""
    p.ellipse(9, 45, 9, 13, c)
    p.poly([(9, 34), (26, 41), (26, 49), (9, 56)], c)
    for flip in (1, -1):
        y = 45.0
        p.poly(
            [
                (30, y - 3 * flip),
                (66, y - 30 * flip),
                (62, y - 20 * flip),
                (98, y - 43 * flip),
                (72, y - 12 * flip),
                (76, y - 22 * flip),
                (32, y + 2 * flip),
            ],
            c,
        )


# ----------------------------------------------------------------------
# Warning symbols (black on yellow)
# ----------------------------------------------------------------------
@picto("steam_train", 100, 74)
def _steam_train(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Steam locomotive facing left with smoke (207-A)."""
    p.ellipse(22, 9, 12, 9, c)
    p.ellipse(36, 6, 9, 6, c)
    p.rect(18, 14, 28, 30, c)
    p.rect(8, 28, 72, 56, c, r=6)
    p.rect(70, 14, 100, 56, c, r=1)
    p.rect(76, 20, 92, 32, bg, r=1)
    p.rect(66, 10, 100, 15, c)
    for u in (16, 34, 52, 86):
        p.circle(u, 62, 10, c)
        p.circle(u, 62, 3, bg)
    p.poly([(0, 46), (8, 40), (8, 60), (2, 60)], c)


@picto("electric_train", 100, 64)
def _electric_train(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Electric railcar with pantograph on rails (207-B)."""
    p.poly([(42, 10), (50, 0), (58, 10)], c)
    p.stroke([(42, 10), (50, 2), (58, 10)], 2.5, c)
    p.rect(2, 12, 98, 48, c, r=5)
    for i in range(6):
        u = 10 + i * 14
        p.rect(u, 18, u + 9, 32, bg, r=1)
    p.rect(14, 48, 30, 54, c)
    p.rect(70, 48, 86, 54, c)
    p.circle(18, 55, 4, c)
    p.circle(28, 55, 4, c)
    p.circle(74, 55, 4, c)
    p.circle(84, 55, 4, c)
    p.rect(0, 58, 100, 62, c)


@picto("traffic_light", 100, 46)
def _traffic_light(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Horizontal signal head (208の2): black body; lamp colours are drawn by the caller."""
    p.rect(0, 0, 100, 46, c, r=23)


@picto("skid_car", 100, 100)
def _skid_car(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Car seen from behind, tilted, with wavy skid marks (209 すべりやすい)."""

    def rot(pts: list[Pt]) -> list[Pt]:
        a = math.radians(-14)
        ox, oy = 50, 30
        return [
            (ox + (u - ox) * math.cos(a) - (v - oy) * math.sin(a), oy + (u - ox) * math.sin(a) + (v - oy) * math.cos(a))
            for u, v in pts
        ]

    p.poly(rot([(32, 4), (68, 4), (76, 22), (24, 22)]), c)
    p.poly(rot([(35, 8), (65, 8), (71, 20), (29, 20)]), bg)
    body = [(18, 24), (24, 20), (76, 20), (82, 24), (84, 44), (80, 50), (20, 50), (16, 44)]
    p.poly(rot(body), c)
    p.poly(rot([(24, 32), (34, 32), (34, 37), (24, 37)]), bg)
    p.poly(rot([(66, 32), (76, 32), (76, 37), (66, 37)]), bg)
    p.poly(rot([(20, 48), (32, 48), (32, 60), (20, 60)]), c)
    p.poly(rot([(68, 48), (80, 48), (80, 60), (68, 60)]), c)
    p.stroke(bezier((30, 66), (10, 74), (36, 82), (14, 96), 24), 4, c)
    p.stroke(bezier((56, 64), (36, 74), (62, 84), (40, 98), 24), 4, c)


def _skid_car(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Car skidding with wavy tyre tracks behind it (209 すべりやすい)."""
    # Car seen from behind, tilted.
    body = [(18, 8), (62, 0), (80, 12), (84, 30), (30, 40), (14, 26)]
    p.poly(body, c)
    p.poly([(24, 10), (58, 4), (68, 14), (28, 20)], bg)
    p.stroke(bezier((34, 44), (22, 58), (48, 66), (30, 96), 24), 3.2, c)
    p.stroke(bezier((70, 38), (54, 56), (86, 68), (66, 98), 24), 3.2, c)


@picto("rockfall", 100, 76)
def _rockfall(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Cliff with rocks falling to the right (209の2)."""
    p.poly([(0, 76), (36, 0), (46, 0), (54, 76)], c)
    p.rect(0, 72, 100, 76, c)
    for u, v, r in ((56, 14, 6), (62, 32, 6.5), (72, 52, 7)):
        p.circle(u, v, r, c)


@picto("bumps", 100, 34)
def _bumps(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Uneven road surface (209の3)."""
    top = bezier((0, 14), (12, 0), (24, 2), (34, 12), 16)
    top += bezier((34, 12), (44, 22), (54, 20), (64, 8), 16)
    top += bezier((64, 8), (74, -2), (88, 2), (100, 14), 16)
    p.poly(top + [(100, 34), (0, 34)], c)


@picto("road_worker", 100, 100)
def _road_worker(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Worker digging with a shovel (213 道路工事中)."""
    p.circle(46, 12, 8, c)
    p.poly([(36, 8), (54, 4), (56, 10), (38, 13)], c)
    p.poly([(38, 20), (58, 22), (74, 48), (66, 54), (52, 40), (44, 56), (34, 54)], c)
    p.stroke([(44, 26), (32, 44), (24, 64)], 6, c)
    p.stroke([(56, 28), (40, 46)], 6, c)
    p.stroke([(46, 54), (60, 74), (64, 96)], 8, c)
    p.stroke([(40, 54), (30, 76), (24, 96)], 8, c)
    p.stroke([(36, 40), (12, 86)], 3.5, c)
    p.poly([(4, 84), (16, 80), (20, 92), (6, 94)], c)
    p.poly([(0, 96), (10, 86), (20, 96)], c)
    p.rect(0, 96, 100, 100, c)


@picto("windsock", 100, 90)
def _windsock(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Windsock on a pole, striped black and yellow (214 横風注意)."""
    p.rect(2, 0, 7, 90, c)
    top0, top1 = (7, 4), (96, 30)
    bot0, bot1 = (7, 36), (92, 46)

    def at(t: float, top: bool) -> Pt:
        a, b = (top0, top1) if top else (bot0, bot1)
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    p.poly([top0, top1, bot1, bot0], c)
    inset = [(9.5, 7.5), (93.5, 32), (90, 43.5), (9.5, 33)]
    p.poly(inset, bg)
    for t0, t1 in ((0.0, 0.12), (0.26, 0.4), (0.54, 0.68), (0.82, 0.95)):
        p.poly([at(t0, True), at(t1, True), at(t1, False), at(t0, False)], c)
    p.ellipse(94, 38, 3, 8.5, c)


def _windsock(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Windsock on a pole (214 横風注意)."""
    p.rect(0, 0, 4.5, 80, c)
    sock = [(4, 2), (96, 22), (94, 36), (4, 30)]
    p.poly(sock, c)
    inner = [(7, 5.5), (93, 24.5), (92, 33.5), (7, 26.5)]
    p.poly(inner, bg)
    for i in range(5):
        t0, t1 = 0.06 + i * 0.19, 0.06 + i * 0.19 + 0.1
        a = (7 + 86 * t0, 5.5 + 19 * t0)
        b = (7 + 86 * t1, 5.5 + 19 * t1)
        cc = (7 + 85 * t1, 26.5 + 7 * t1)
        d = (7 + 85 * t0, 26.5 + 7 * t0)
        p.poly([a, b, cc, d], c)


@picto("deer", 100, 96)
def _deer(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Leaping deer facing up and to the right (214の2 動物が飛び出すおそれあり)."""
    body = [(24, 66), (34, 54), (54, 44), (66, 38), (74, 40), (72, 52), (56, 62), (36, 72)]
    p.poly(body, c)
    p.poly([(62, 42), (68, 28), (73, 22), (78, 24), (76, 34), (74, 44)], c)
    p.poly([(70, 24), (76, 16), (86, 17), (90, 22), (84, 25), (77, 28)], c)
    p.poly([(72, 18), (70, 12), (75, 15)], c)
    for pts in ([(76, 17), (76, 8), (72, 2)], [(76, 10), (82, 5)], [(79, 17), (84, 9), (90, 6)], [(84, 10), (86, 3)]):
        p.stroke(pts, 2.4, c)
    p.stroke([(70, 50), (84, 56), (92, 50)], 4.5, c)
    p.stroke([(66, 54), (78, 64), (88, 62)], 4.5, c)
    p.stroke([(30, 66), (18, 78), (6, 90)], 5, c)
    p.stroke([(38, 70), (30, 82), (24, 94)], 5, c)
    p.poly([(24, 62), (17, 58), (20, 55), (28, 59)], c)


def _deer(p: Pen, c: RGBA, bg: RGBA) -> None:
    """Leaping deer facing right (214の2 動物が飛び出すおそれあり)."""
    body = [(14, 50), (30, 40), (58, 38), (70, 30), (76, 22), (84, 26), (80, 36), (70, 48), (54, 56), (30, 58)]
    p.poly(body, c)
    p.poly([(74, 24), (80, 10), (84, 12), (82, 26)], c)
    p.poly([(80, 14), (90, 16), (96, 22), (86, 24)], c)
    p.stroke([(80, 12), (78, 2), (72, 0)], 2.2, c)
    p.stroke([(79, 6), (86, 0)], 2.2, c)
    p.stroke([(68, 46), (88, 52), (98, 48)], 4, c)
    p.stroke([(62, 50), (78, 62), (90, 62)], 4, c)
    p.stroke([(22, 54), (8, 70), (2, 88)], 4.2, c)
    p.stroke([(30, 56), (22, 72), (16, 86)], 4.2, c)
    p.poly([(12, 50), (4, 44), (8, 42), (16, 46)], c)


@picto("exclamation", 40, 100)
def _exclamation(p: Pen, c: RGBA, bg: RGBA) -> None:
    """その他の危険 (215)."""
    p.poly([(6, 8), (34, 8), (24, 74), (16, 74)], c)
    p.ellipse(20, 8, 14, 8, c)
    p.circle(20, 90, 9, c)
