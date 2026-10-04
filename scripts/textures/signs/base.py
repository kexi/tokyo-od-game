"""Shared drawing kit for the 道路標識 textures: colours, the pinned font, and a real-size canvas.

Every sign is drawn on a `Face` whose coordinates are millimetres measured from the top-left
corner of the plate's bounding box (the dimensions of 命令 別表第二 are in centimetres; ×10).
The face is rendered supersampled and isotropic, then resampled to a power-of-two texture that
covers the bounding box exactly, so the plate mesh can map UV (0,0)–(1,1) onto that box even
when the texture's pixel aspect differs from the plate's (60 × 35 cm → 512 × 256).
"""

from __future__ import annotations

import hashlib
import math
import os
from pathlib import Path
from typing import Callable, Iterable, Sequence

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

RGBA = tuple[int, int, int, int]
Pt = tuple[float, float]

# Colours (別表第二 備考一(三)). Red/blue/white/black are the values the first textures used; the
# yellow and the pale yellow of 503-D were sampled from 国土交通省「道路標識一覧」.
RED: RGBA = (215, 38, 46, 255)
BLUE: RGBA = (11, 78, 162, 255)
WHITE: RGBA = (255, 255, 255, 255)
BLACK: RGBA = (26, 26, 26, 255)
YELLOW: RGBA = (252, 214, 0, 255)
PALE_YELLOW: RGBA = (232, 196, 88, 255)
GREEN: RGBA = (0, 140, 96, 255)  # 信号機あり: the 青 lamp
SIGNAL_RED: RGBA = (225, 30, 36, 255)
SIGNAL_AMBER: RGBA = (255, 170, 0, 255)
CLEAR: RGBA = (0, 0, 0, 0)

# Noto Sans JP (SIL OFL 1.1) pinned to a google/fonts commit and verified by SHA-256 hash.
FONT_URL = (
    "https://raw.githubusercontent.com/google/fonts/295d98a7a0c17c68f1341eaeea354e7960ea70d3/"
    "ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
)
FONT_SHA256 = "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f"
FONT_CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "tokyo-od-game" / "fonts"
_FONT_PATH: Path | None = None
_FONTS: dict[tuple[int, int], ImageFont.FreeTypeFont] = {}


def font_file() -> Path:
    global _FONT_PATH
    if _FONT_PATH is not None:
        return _FONT_PATH
    font_path = FONT_CACHE_DIR / "NotoSansJP-VariableFont_wght.ttf"
    if not font_path.exists():
        import requests

        FONT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        headers = {"User-Agent": "tokyo-od-game-asset-gen/1.0 (+https://github.com/kexi/tokyo-od-game)"}
        resp = requests.get(FONT_URL, headers=headers, timeout=60)
        resp.raise_for_status()
        font_path.write_bytes(resp.content)
    digest = hashlib.sha256(font_path.read_bytes()).hexdigest()
    if digest != FONT_SHA256:
        raise RuntimeError(f"unexpected font hash {digest} for {font_path}")
    _FONT_PATH = font_path
    return font_path


def get_noto_font(size: int, bold: bool = False, weight: int | None = None) -> ImageFont.FreeTypeFont:
    """Noto Sans JP at `size` px with the given weight (cached per size and weight)."""
    w = weight if weight is not None else (700 if bold else 400)
    key = (size, w)
    if key not in _FONTS:
        font = ImageFont.truetype(str(font_file()), size)
        try:
            font.set_variation_by_axes([w])
        except (OSError, ValueError):
            pass
        _FONTS[key] = font
    return _FONTS[key]


def pow2_size(w_mm: float, h_mm: float, major: int = 512) -> tuple[int, int]:
    """Power-of-two texture size: the longer side gets `major` px, the shorter the nearest power of two."""
    if w_mm >= h_mm:
        minor = 2 ** round(math.log2(major * h_mm / w_mm))
        return major, max(64, min(major, minor))
    minor = 2 ** round(math.log2(major * w_mm / h_mm))
    return max(64, min(major, minor)), major


# ----------------------------------------------------------------------
# Geometry helpers (all in millimetres)
# ----------------------------------------------------------------------
def arc_pts(cx: float, cy: float, r: float, a0: float, a1: float, n: int = 48) -> list[Pt]:
    """Points on a circle, angles in degrees (0 = +x, 90 = +y, i.e. clockwise on screen)."""
    return [
        (
            cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
            cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n)),
        )
        for i in range(n + 1)
    ]


def bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: int = 40) -> list[Pt]:
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return out


def rounded_poly(points: Sequence[Pt], radius: float, steps: int = 8) -> list[Pt]:
    """Round the corners of a convex polygon (any winding) with arcs of `radius`."""
    out: list[Pt] = []
    n = len(points)
    for i in range(n):
        px, py = points[i]
        ax, ay = points[i - 1][0] - px, points[i - 1][1] - py
        bx, by = points[(i + 1) % n][0] - px, points[(i + 1) % n][1] - py
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        ax, ay, bx, by = ax / la, ay / la, bx / lb, by / lb
        half = math.acos(max(-1.0, min(1.0, ax * bx + ay * by))) / 2
        dist = radius / math.tan(half)
        sx, sy = px + ax * dist, py + ay * dist
        ex, ey = px + bx * dist, py + by * dist
        mx, my = ax + bx, ay + by
        ml = math.hypot(mx, my)
        cx, cy = px + mx / ml * radius / math.sin(half), py + my / ml * radius / math.sin(half)
        a0 = math.atan2(sy - cy, sx - cx)
        a1 = math.atan2(ey - cy, ex - cx)
        delta = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(steps + 1):
            t = a0 + delta * k / steps
            out.append((cx + radius * math.cos(t), cy + radius * math.sin(t)))
    return out


def inset_poly(points: Sequence[Pt], d: float) -> list[Pt]:
    """Offset a convex polygon inward by `d` (positive = smaller), keeping its winding."""
    n = len(points)
    area = sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n))
    sign = 1.0 if area > 0 else -1.0
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = points[i], points[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln * sign, dx / ln * sign  # inward normal (y down)
        lines.append(((x0 + nx * d, y0 + ny * d), (dx, dy)))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        den = r[0] * s[1] - r[1] * s[0]
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
        out.append((p[0] + r[0] * t, p[1] + r[1] * t))
    return out


# ----------------------------------------------------------------------
# Face: a real-size, supersampled drawing surface
# ----------------------------------------------------------------------
class Face:
    """A sign face `w_mm` × `h_mm` rendered to an `out` px texture (see the module docstring)."""

    def __init__(self, w_mm: float, h_mm: float, out: tuple[int, int] | None = None, ss: float = 4.0):
        self.w, self.h = float(w_mm), float(h_mm)
        self.out = out or pow2_size(w_mm, h_mm)
        base = max(self.out[0] / self.w, self.out[1] / self.h)
        # Keep the supersampled canvas under ~4k px on its long side.
        ss = min(ss, 4096 / (max(self.w, self.h) * base))
        self.k = base * ss
        self.size = (max(1, round(self.w * self.k)), max(1, round(self.h * self.k)))
        self.img = Image.new("RGBA", self.size, CLEAR)
        self.d = ImageDraw.Draw(self.img)

    # -- coordinate helpers
    def p(self, x: float, y: float) -> Pt:
        return (x * self.k, y * self.k)

    def ps(self, pts: Iterable[Pt]) -> list[Pt]:
        return [self.p(x, y) for x, y in pts]

    def blank(self) -> "Face":
        """An empty layer of the same size, for masking and compositing."""
        f = Face.__new__(Face)
        f.w, f.h, f.out, f.k, f.size = self.w, self.h, self.out, self.k, self.size
        f.img = Image.new("RGBA", self.size, CLEAR)
        f.d = ImageDraw.Draw(f.img)
        return f

    # -- primitives
    def poly(self, pts: Sequence[Pt], fill: RGBA) -> None:
        self.d.polygon(self.ps(pts), fill=fill)

    def circle(self, cx: float, cy: float, r: float, fill: RGBA) -> None:
        self.d.ellipse([(cx - r) * self.k, (cy - r) * self.k, (cx + r) * self.k, (cy + r) * self.k], fill=fill)

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, fill: RGBA) -> None:
        self.d.ellipse([(cx - rx) * self.k, (cy - ry) * self.k, (cx + rx) * self.k, (cy + ry) * self.k], fill=fill)

    def ring(self, cx: float, cy: float, r: float, width: float, fill: RGBA) -> None:
        """A ring whose outer radius is `r`."""
        self.d.ellipse(
            [(cx - r) * self.k, (cy - r) * self.k, (cx + r) * self.k, (cy + r) * self.k],
            outline=fill,
            width=max(1, round(width * self.k)),
        )

    def rect(self, x0: float, y0: float, x1: float, y1: float, fill: RGBA, r: float = 0.0) -> None:
        box = [x0 * self.k, y0 * self.k, x1 * self.k, y1 * self.k]
        if r > 0:
            self.d.rounded_rectangle(box, radius=r * self.k, fill=fill)
        else:
            self.d.rectangle(box, fill=fill)

    def rect_line(self, x0: float, y0: float, x1: float, y1: float, width: float, fill: RGBA, r: float = 0.0) -> None:
        """A rectangular border line whose outer edge is the given box."""
        box = [x0 * self.k, y0 * self.k, x1 * self.k, y1 * self.k]
        self.d.rounded_rectangle(box, radius=max(0.0, r) * self.k, outline=fill, width=max(1, round(width * self.k)))

    def stroke(self, pts: Sequence[Pt], width: float, fill: RGBA, round_cap: bool = True) -> None:
        """A thick polyline made of quads, with round joins (and caps when `round_cap`)."""
        hw = width / 2
        for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
            dx, dy = x1 - x0, y1 - y0
            ln = math.hypot(dx, dy)
            if ln == 0:
                continue
            nx, ny = -dy / ln * hw, dx / ln * hw
            self.poly([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill)
        joints = pts if round_cap else pts[1:-1]
        for x, y in joints:
            self.circle(x, y, hw, fill)

    def text(
        self,
        cx: float,
        cy: float,
        s: str,
        height: float,
        fill: RGBA,
        weight: int = 700,
        max_w: float | None = None,
        squeeze: float = 1.0,
        anchor: str = "c",
    ) -> tuple[float, float, float, float]:
        """Draw `s` so its ink is `height` mm tall (kanji height), centred on (cx, cy).

        `squeeze` narrows the glyphs (sign lettering is condensed); `max_w` narrows them further
        when the line would be wider. `anchor` "l"/"r" aligns the ink's left/right edge to cx.
        Returns the ink box in mm.
        """
        px = max(8, round(height * self.k / 0.86))
        font = get_noto_font(px, weight=weight)
        x0b, y0b, x1b, y1b = font.getbbox(s)
        tmp = Image.new("L", (x1b - x0b + 4, y1b - y0b + 4), 0)
        ImageDraw.Draw(tmp).text((2 - x0b, 2 - y0b), s, font=font, fill=255)
        bb = tmp.getbbox()
        if bb is None:
            return (cx, cy, cx, cy)
        tmp = tmp.crop(bb)
        # Scale so the ink height is exactly `height` (CJK and Latin ink heights differ).
        target_h = height * self.k
        sx = squeeze * target_h / tmp.height
        tw = tmp.width * sx
        if max_w is not None and tw > max_w * self.k:
            tw = max_w * self.k
        tmp = tmp.resize((max(1, round(tw)), max(1, round(target_h))), Image.Resampling.LANCZOS)
        w_mm, h_mm = tmp.width / self.k, tmp.height / self.k
        x0 = cx - w_mm / 2 if anchor == "c" else cx if anchor == "l" else cx - w_mm
        y0 = cy - h_mm / 2
        colour = Image.new("RGBA", tmp.size, fill)
        self.img.paste(colour, (round(x0 * self.k), round(y0 * self.k)), tmp)
        return (x0, y0, x0 + w_mm, y0 + h_mm)

    def text_ink(
        self, cx: float, cy: float, s: str, height: float, fill: RGBA, weight: int = 700, max_w: float | None = None
    ) -> None:
        """Like `text` but keeps the font's own proportions between characters of one line
        (for mixed kana/kanji lines whose ink heights differ): the line's em box is scaled so
        that a kanji would be `height` tall."""
        px = max(8, round(height * self.k / 0.86))
        font = get_noto_font(px, weight=weight)
        x0b, y0b, x1b, y1b = font.getbbox(s)
        _, em_t, _, em_b = font.getbbox("国")
        tmp = Image.new("L", (x1b - x0b + 4, max(y1b, em_b) - min(y0b, em_t) + 4), 0)
        ImageDraw.Draw(tmp).text((2 - x0b, 2 - min(y0b, em_t)), s, font=font, fill=255)
        w = tmp.width
        if max_w is not None and w > max_w * self.k:
            tmp = tmp.resize((round(max_w * self.k), tmp.height), Image.Resampling.LANCZOS)
            w = tmp.width
        # Centre on the kanji ink box.
        kanji_mid = (em_t + em_b) / 2 - min(y0b, em_t) + 2
        x0 = cx * self.k - w / 2
        y0 = cy * self.k - kanji_mid
        colour = Image.new("RGBA", tmp.size, fill)
        self.img.paste(colour, (round(x0), round(y0)), tmp)

    def composite(self, layer: "Face", mask: Image.Image | None = None) -> None:
        if mask is not None:
            masked = Image.new("RGBA", self.size, CLEAR)
            masked.paste(layer.img, (0, 0), mask)
            self.img = Image.alpha_composite(self.img, masked)
        else:
            self.img = Image.alpha_composite(self.img, layer.img)
        self.d = ImageDraw.Draw(self.img)

    def with_halo(
        self,
        draw_fn: Callable[["Face"], None],
        halo: float,
        halo_fill: RGBA,
        clip: Callable[["Face"], None] | None = None,
    ) -> None:
        """Draw a symbol with a `halo` mm outline of `halo_fill` under it (the slash of 304–310
        passes behind the vehicle with a gap); `clip` limits the halo to a shape (the ground
        inside the red ring) so it never bites into the ring."""
        layer = self.blank()
        draw_fn(layer)
        alpha = layer.img.getchannel("A")
        # Dilate on a quarter-size copy: a large MaxFilter at full size would be slow.
        q = 4
        small = alpha.resize((max(1, self.size[0] // q), max(1, self.size[1] // q)), Image.Resampling.BOX)
        rad = max(1, round(halo * self.k / q))
        small = small.point(lambda v: 255 if v > 8 else 0).filter(ImageFilter.MaxFilter(2 * rad + 1))
        halo_mask = small.resize(self.size, Image.Resampling.BILINEAR).point(lambda v: 255 if v > 127 else 0)
        halo_mask = halo_mask.filter(ImageFilter.GaussianBlur(self.k * 0.6))
        if clip is not None:
            m = self.blank()
            clip(m)
            halo_mask = ImageChops.multiply(halo_mask, m.img.getchannel("A"))
        solid = Image.new("RGBA", self.size, halo_fill)
        self.composite(Face._wrap(self, solid), halo_mask)
        self.composite(layer)

    @staticmethod
    def _wrap(like: "Face", img: Image.Image) -> "Face":
        f = like.blank()
        f.img = img
        f.d = ImageDraw.Draw(img)
        return f

    def clip(self, mask_fn: Callable[["Face"], None]) -> None:
        """Keep only what lies inside the shape drawn by `mask_fn` (alpha intersect)."""
        m = self.blank()
        mask_fn(m)
        a = ImageChops.multiply(self.img.getchannel("A"), m.img.getchannel("A"))
        self.img.putalpha(a)
        self.d = ImageDraw.Draw(self.img)

    def finish(self) -> Image.Image:
        return self.img.resize(self.out, Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# Arrows
# ----------------------------------------------------------------------
def arrow_head(face: Face, tip: Pt, direction: Pt, length: float, width: float, fill: RGBA, notch: float = 0.0) -> Pt:
    """A triangular arrowhead pointing along `direction` with its tip at `tip`.

    Returns the centre of its back edge (where the shaft should end). `notch` > 0 cuts a
    swallow-tail into the back edge as a fraction of `length`.
    """
    dx, dy = direction
    ln = math.hypot(dx, dy)
    dx, dy = dx / ln, dy / ln
    nx, ny = -dy, dx
    bx, by = tip[0] - dx * length, tip[1] - dy * length
    pts = [tip, (bx + nx * width / 2, by + ny * width / 2)]
    if notch > 0:
        pts.append((bx + dx * length * notch, by + dy * length * notch))
    pts.append((bx - nx * width / 2, by - ny * width / 2))
    face.poly(pts, fill)
    return (bx + dx * length * 0.15, by + dy * length * 0.15)


def trim_end(pts: Sequence[Pt], dist: float) -> list[Pt]:
    """Remove `dist` mm of length from the end of a polyline."""
    out = list(pts)
    while len(out) >= 2 and dist > 0:
        (x0, y0), (x1, y1) = out[-2], out[-1]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg > dist:
            t = (seg - dist) / seg
            out[-1] = (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
            return out
        dist -= seg
        out.pop()
    return out


def arrow_path(
    face: Face,
    pts: Sequence[Pt],
    shaft: float,
    head_len: float,
    head_w: float,
    fill: RGBA,
    notch: float = 0.0,
) -> None:
    """A thick path (square tail, round joins) ending in an arrowhead at its last point; the head
    points from the path's position `head_len` before the tip toward the tip."""
    tip = pts[-1]
    back = trim_end(pts, head_len)
    bx, by = back[-1] if len(back) else pts[0]
    direction = (tip[0] - bx, tip[1] - by)
    body = trim_end(pts, head_len * 0.8)
    if len(body) >= 2:
        face.stroke(body, shaft, fill, round_cap=False)
    arrow_head(face, tip, direction, head_len, head_w, fill, notch)
