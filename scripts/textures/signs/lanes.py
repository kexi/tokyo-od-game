"""進行方向別通行区分 (327の7) drawn from a lane list, with per-lane 専用 / 優先 marks
(327の4 専用通行帯, 327の4の2 普通自転車専用通行帯, 327の5 路線バス等優先通行帯).

Input: one entry per lane, left lane first. A lane is either
  * a direction string — OSM turn:lanes words joined by "+" or ";" ("left+through", "right"),
  * a list of words (["left", "through"]), or
  * a dict {"dirs": "left+through", "use": "bus" | "bus_priority" | "bicycle" | None}.
A whole OSM value ("left;through|through|right") is accepted too. Words: left, slight_left,
through, slight_right, right, reverse (U-turn). Unknown words are dropped and an empty lane
becomes "through" — the same reading as src/world/regulations.ts (LANE_DIRECTIONS).

Layout (別表第二 図 166–169): 40 cm per lane × 90 cm (120 × 90 cm for three lanes), white
dashed lane lines between lanes and at both edges; a single lane is the 90 × 90 cm 327の7-B/C/D
plate. 図示の記号は例示 (備考一(一)1), so any combination of arrows may be shown.
"""

from __future__ import annotations

from typing import Sequence, Union

from PIL import Image

from . import pictos
from .base import BLUE, WHITE, Face, arrow_path, bezier
from .plates import rect_face

DIRECTIONS = ("reverse", "left", "slight_left", "through", "slight_right", "right")
SLUG = {"reverse": "u", "left": "l", "slight_left": "hl", "through": "t", "slight_right": "hr", "right": "r"}
USES = {"bus": "bus", "bus_priority": "busp", "bicycle": "cyc"}
LANE_W = 400.0
LANE_H = 900.0

LaneSpec = Union[str, Sequence[str], dict]


def parse(lanes: Union[str, Sequence[LaneSpec]]) -> list[tuple[tuple[str, ...], str | None]]:
    """Normalise a lane list to [(directions in canonical order, use)]."""
    if isinstance(lanes, str):
        lanes = lanes.split("|")
    out = []
    for lane in lanes:
        use = None
        if isinstance(lane, dict):
            use = lane.get("use")
            lane = lane.get("dirs", "")
        words = lane.replace("+", ";").split(";") if isinstance(lane, str) else list(lane)
        dirs = tuple(d for d in DIRECTIONS if d in {w.strip() for w in words})
        if use is not None and use not in USES:
            raise ValueError(f"unknown lane use {use!r}")
        out.append((dirs or ("through",), use))
    return out


def slug(lanes: Union[str, Sequence[LaneSpec]]) -> str:
    """File-name key: lanes joined by "-", e.g. left+through|through|right → "lt-t-r"; a use is
    appended to its lane after "~" ("t~bus")."""
    parts = []
    for dirs, use in parse(lanes):
        s = "".join(SLUG[d] for d in dirs)
        parts.append(s + (f"~{USES[use]}" if use else ""))
    return "-".join(parts)


def file_name(lanes: Union[str, Sequence[LaneSpec]]) -> str:
    return f"327-7_{slug(lanes)}.png"


def plate_size(n: int) -> tuple[float, float]:
    return (LANE_H, LANE_H) if n == 1 else (LANE_W * n, LANE_H)


def plate_node(n: int) -> str:
    return "PlateSquare90" if n == 1 else f"PlateRect{n * 40}x90"


def _dashes(f: Face, x: float, top: float, bottom: float, w: float, solid: bool = False) -> None:
    if solid:
        f.rect(x - w / 2, top, x + w / 2, bottom, WHITE)
        return
    n = 5
    seg = (bottom - top) / (2 * n - 1)
    for i in range(n):
        y = top + i * 2 * seg
        f.rect(x - w / 2, y, x + w / 2, y + seg, WHITE)


def _arrows(f: Face, cx: float, top: float, bottom: float, half: float, dirs: tuple[str, ...], k: float) -> None:
    """The arrows of one lane between `top` and `bottom`; `half` is half the usable lane width.

    The trunk rises from the bottom; turning branches leave it and run out to the lane line
    (図 166: the 左折 branch of the left lane reaches the edge dashes). With turns to one side
    only, the trunk moves to the other side so the branch has room (図 167・168)."""
    shaft, hl, hw = 46 * k, 92 * k, 112 * k
    h = bottom - top
    lefts = [d for d in dirs if d in ("left", "slight_left", "reverse")]
    rights = [d for d in dirs if d in ("right", "slight_right")]
    thru = "through" in dirs
    shift = 0.0
    if lefts and not rights:
        shift = half * 0.32
    elif rights and not lefts:
        shift = -half * 0.32
    tx = cx + shift
    # Where turning branches leave the trunk: low when the trunk goes on, high when it does not.
    split = top + h * (0.55 if thru else 0.4)
    if thru:
        arrow_path(f, [(tx, bottom), (tx, top)], shaft, hl * 1.05, hw, WHITE)
    elif len(lefts) + len(rights) > 0:
        f.stroke([(tx, bottom), (tx, split + 5)], shaft, WHITE, round_cap=False)
    for d in lefts + rights:
        side = -1 if d in lefts else 1
        edge = cx + side * half  # the arrow tip stops at the lane line
        span = abs(edge - tx)
        if d in ("left", "right"):
            y_end = split - min(h * 0.16, span * 0.55)
            r = min(span * 0.45, split - y_end)
            pts = [(tx, split + 20 * k), (tx, y_end + r)]
            pts += bezier(
                (tx, y_end + r), (tx, y_end + r * 0.2), (tx + side * r * 0.2, y_end), (tx + side * r, y_end), 12
            )[1:]
            pts.append((edge, y_end))
        elif d in ("slight_left", "slight_right"):
            y_end = top + h * 0.1
            pts = [(tx, split + 20 * k)] + bezier(
                (tx, split + 20 * k),
                (tx, split - h * 0.1),
                (edge - side * span * 0.15, split - h * 0.16),
                (edge, y_end),
                14,
            )
        else:  # reverse: hook over to the left and come back down
            r = min(span / 2, 80 * k)
            y_top = split - h * 0.22
            pts = [(tx, split + 20 * k), (tx, y_top + r)]
            pts += bezier(
                (tx, y_top + r), (tx, y_top - r * 0.33), (tx - 2 * r, y_top - r * 0.33), (tx - 2 * r, y_top + r), 14
            )[1:]
            pts.append((tx - 2 * r, y_top + r + h * 0.26))
        arrow_path(f, pts, shaft * 0.95, hl, hw, WHITE)


def lane_sign(lanes: Union[str, Sequence[LaneSpec]]) -> Image.Image:
    """Draw 327の7 (and the per-lane 327の4 / 327の5 variants) for a lane list."""
    parsed = parse(lanes)
    n = len(parsed)
    w, h = plate_size(n)
    f = rect_face(w, h, BLUE, rim=15, rim_fill=WHITE, r=40, major=1024)
    top, bottom = 70.0, h - 70.0
    if n == 1:
        edges = [70.0, w - 70.0]
        k = 1.9
    else:
        edges = [60.0] + [LANE_W * i for i in range(1, n)] + [w - 60.0]
        k = 1.0
    for i, x in enumerate(edges):
        # 専用通行帯 is bounded by solid lines (図 162・163); everything else is dashed.
        left_use = parsed[i - 1][1] if i > 0 else None
        right_use = parsed[i][1] if i < n else None
        solid = left_use in ("bus", "bicycle") or right_use in ("bus", "bicycle")
        _dashes(f, x, top, bottom, 34.0 if n > 1 else 40.0, solid)
    for i, (dirs, use) in enumerate(parsed):
        x0, x1 = edges[i], edges[i + 1]
        cx = (x0 + x1) / 2
        half = (x1 - x0) / 2 - 30
        if use is None:
            _arrows(f, cx, top + 40, bottom - 20, half, dirs, k)
            continue
        # 専用 / 優先: the vehicle and the word above shortened arrows (図 162–164).
        sym_w = min(2 * half, 560.0)
        name = "bicycle" if use == "bicycle" else "bus_side"
        sym_h = pictos.size_of(name, sym_w)
        pictos.place_c(f, name, cx, top + 30 + sym_h / 2, sym_w, WHITE, BLUE)
        word = "優先" if use == "bus_priority" else "専用"
        th = min(120.0, sym_w * 0.32)
        ty = top + 60 + sym_h + th / 2
        f.text(cx, ty, word[0] + "　" + word[1] if n == 1 else word, th, WHITE, weight=700, max_w=2 * half)
        _arrows(f, cx, ty + th / 2 + 40, bottom - 20, half, dirs, k * 0.8)
    return f.finish()


def assumed_lanes(n: int, exits: set[str]) -> list[list[str]]:
    """Port of `assumedLanes` in src/world/regulations.ts: the usual Tokyo pattern for `n` lanes
    (左折・直進 | 直進 … | 右折; 2 lanes: 直進・右折), used to pre-render what the game may ask for."""
    lanes = []
    for i in range(n):
        is_left, is_right = i == 0, i == n - 1
        s = []
        if is_left and "left" in exits:
            s.append("left")
        is_through = (not is_right) or n == 2 or "right" not in exits
        if "through" in exits and is_through:
            s.append("through")
        if is_right and "right" in exits:
            s.append("right")
        lanes.append(s or ["through"])
    return lanes
