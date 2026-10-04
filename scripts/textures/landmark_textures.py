# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural textures for the landmark models (東京タワー, 東京スカイツリー, 東京駅丸の内駅舎).

Everything is drawn from geometry and fixed seeds: no photos, fonts, logos or lettering. Lattice
textures are white-on-transparent masks (the glTF material's baseColorFactor tints them and the
runtime uses alphaMode MASK), facade textures are albedo maps, and the *_night / *_glow maps are
the emissive textures of the night-lighting materials (Light_<mode>_<part>). Sizes and what one
tile represents in metres are listed in TEXTURES below; scripts/blender/landmarks.py maps UVs in
the same units.

Usage:
    uv run scripts/textures/landmark_textures.py                 # write assets/landmarks/textures
    uv run scripts/textures/landmark_textures.py sheet.png       # also save a contact sheet
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw

SEED = 20261004
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "landmarks" / "textures"
SS = 3  # supersampling factor for antialiased edges

# Tokyo Tower bands (heights in metres, see scripts/blender/landmarks.py): 7 equal 昼間障害標識
# bands from the main deck roof (131 m) to the tip (333 m); orange below the deck.
TT_HEIGHT = 333.0
TT_DECK = (117.0, 131.0)
TT_BAND_BASE = 131.0
TT_BANDS = 7
TT_ORANGE = (233, 87, 43)
TT_WHITE = (242, 242, 236)


def tt_band_is_white(h: float) -> bool:
    if h < TT_BAND_BASE:
        return False
    k = min(TT_BANDS - 1, int((h - TT_BAND_BASE) / ((TT_HEIGHT - TT_BAND_BASE) / TT_BANDS)))
    return k % 2 == 1


# ----------------------------------------------------------------------------- helpers
def canvas(w: int, h: int, mode: str = "RGBA", fill=(0, 0, 0, 0)) -> Image.Image:
    return Image.new(mode, (w * SS, h * SS), fill)


def shrink(im: Image.Image, w: int, h: int) -> Image.Image:
    return im.resize((w, h), Image.LANCZOS)


def member(draw: ImageDraw.ImageDraw, p0, p1, width: float, shade=(214, 214, 210), light=(246, 246, 242)):
    """A steel member seen face-on: a mid-grey bar with a lighter upper flange (reads as an angle)."""
    (x0, y0), (x1, y1) = p0, p1
    w = width * SS
    draw.line([(x0 * SS, y0 * SS), (x1 * SS, y1 * SS)], fill=shade + (255,), width=max(1, int(w)))
    dx, dy = x1 - x0, y1 - y0
    n = math.hypot(dx, dy) or 1.0
    ox, oy = -dy / n * width * 0.18, dx / n * width * 0.18
    if oy > 0:  # keep the highlight on the upper side
        ox, oy = -ox, -oy
    draw.line(
        [((x0 + ox) * SS, (y0 + oy) * SS), ((x1 + ox) * SS, (y1 + oy) * SS)],
        fill=light + (255,),
        width=max(1, int(w * 0.45)),
    )


def wrapped(fn: Callable, w: int, h: int, *args):
    """Call a drawing function at the 9 tile offsets so members crossing an edge tile seamlessly."""
    for ox in (-w, 0, w):
        for oy in (-h, 0, h):
            fn(ox, oy, *args)


def rivets(draw: ImageDraw.ImageDraw, pts, r: float = 1.2, fill=(170, 170, 166, 255)):
    for x, y in pts:
        draw.ellipse([(x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS], fill=fill)


def noise(w: int, h: int, scale: float, seed: int) -> np.ndarray:
    """Tileable smooth noise in [0, 1] (low-pass filtered white noise via FFT)."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((h, w)))
    ky = np.fft.fftfreq(h)[:, None] * h
    kx = np.fft.fftfreq(w)[None, :] * w
    k = np.sqrt(kx**2 + ky**2)
    k[0, 0] = 1
    f *= np.exp(-((k / scale) ** 2))
    f[0, 0] = 0
    n = np.real(np.fft.ifft2(f))
    return (n - n.min()) / (n.max() - n.min() + 1e-9)


def to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ----------------------------------------------------------------------------- 東京タワー
def tt_lacing() -> Image.Image:
    """Secondary lacing between the main members: one tile = 4 m x 4 m of a tower face.

    Diagonals in both directions (continuous across tiles), a light strut at mid height and
    gusset plates where they cross. White on transparent; tinted orange/white by the material.
    """
    w = h = 256
    im = canvas(w, h)
    d = ImageDraw.Draw(im)

    def draw(ox, oy):
        member(d, (ox, oy), (ox + w, oy + h), 9)
        member(d, (ox + w, oy), (ox, oy + h), 9)
        member(d, (ox, oy + h / 2), (ox + w, oy + h / 2), 5)

    wrapped(draw, w, h)
    for cx, cy in ((w / 2, h / 2), (0, 0), (w, 0), (0, h), (w, h)):
        s = 13
        d.polygon(
            [((cx - s) * SS, cy * SS), (cx * SS, (cy - s) * SS), ((cx + s) * SS, cy * SS), (cx * SS, (cy + s) * SS)],
            fill=(225, 225, 220, 255),
        )
        rivets(d, [(cx - 6, cy), (cx + 6, cy), (cx, cy - 6), (cx, cy + 6)])
    return shrink(im, w, h)


def tt_leg() -> Image.Image:
    """Face of a built-up leg (lattice column): one tile = leg width (u) x 2 leg widths (v).

    Heavy angle chords along both edges, battens at each half tile and zigzag lacing between.
    """
    w, h = 128, 256
    im = canvas(w, h)
    d = ImageDraw.Draw(im)
    chord = 22
    for x0 in (0, w - chord):
        d.rectangle([x0 * SS, 0, (x0 + chord) * SS, h * SS], fill=(214, 214, 210, 255))
        d.rectangle([(x0 + 4) * SS, 0, (x0 + chord - 6) * SS, h * SS], fill=(240, 240, 236, 255))
        rivets(d, [(x0 + chord / 2, y) for y in range(6, h, 12)])

    def draw(ox, oy):
        for y in (0, h / 2):
            member(d, (ox, oy + y), (ox + w, oy + y), 9)
        member(d, (ox + chord, oy), (ox + w - chord, oy + h / 2), 8)
        member(d, (ox + w - chord, oy + h / 2), (ox + chord, oy + h), 8)

    wrapped(draw, 0, h)
    return shrink(im, w, h)


def window_band(arr: np.ndarray, x0: int, x1: int, y0: int, y1: int, rng: random.Random, night: bool, mullion: int):
    """Glazing with mullions; daytime glass reflects a sky gradient, at night rooms glow warm."""
    for x in range(x0, x1, mullion):
        xe = min(x1, x + mullion)
        if night:
            lit = rng.random() < 0.85
            base = np.array([255, 226, 170]) * (rng.uniform(0.75, 1.0) if lit else 0.15)
            arr[y0:y1, x + 3 : xe - 3] = base
        else:
            g = np.linspace(0, 1, y1 - y0)[:, None]
            col = np.array([96, 118, 138]) * (1 - g) + np.array([58, 72, 88]) * g
            arr[y0:y1, x + 3 : xe - 3] = col[:, None, :] * rng.uniform(0.9, 1.1)


def tt_deck(night: bool = False) -> Image.Image:
    """Main deck (メインデッキ) facade: one tile = 8 m wide x 14 m (117–131 m), two window rows."""
    w, h = 512, 448  # 64 px/m horizontally, 32 px/m vertically
    rng = random.Random(SEED + 11)
    arr = np.zeros((h, w, 3), np.float32)
    arr[:] = (20, 18, 16) if night else (236, 237, 234)

    def py(m: float) -> int:  # metres above the deck bottom -> pixel row (0 = top)
        return int(round(h - m * 32))

    arr[py(1.2) : py(0.0), :] = (12, 12, 12) if night else (58, 62, 66)  # dark skirt
    for lo, hi in ((2.0, 6.4), (8.0, 12.4)):
        window_band(arr, 0, w, py(hi), py(lo), rng, night, 102)
        arr[py(lo + 0.35) : py(lo + 0.2), :] = (40, 36, 30) if night else (205, 208, 206)
    arr[py(14.0) : py(13.6), :] = (30, 28, 24) if night else (250, 250, 248)
    for x in range(0, w, 34):  # parapet ribs
        arr[py(13.6) : py(12.6), x : x + 4] = (26, 24, 20) if night else (214, 216, 214)
    return to_image(arr)


def tt_foottown(night: bool = False) -> Image.Image:
    """FootTown facade (dark brown cladding, 5 floors): one tile = 8 m wide x 23.5 m."""
    w, h = 256, 752  # 32 px/m
    rng = random.Random(SEED + 12 + int(night))
    arr = np.zeros((h, w, 3), np.float32)
    n = noise(w, h, 40, SEED + 3)[:, :, None]
    arr[:] = (16, 12, 10) if night else (116, 78, 58)
    arr *= 0.92 + 0.16 * n

    def py(m: float) -> int:
        return int(round(h - m * 32))

    for floor in range(5):
        base = floor * 4.7
        if floor == 0:
            window_band(arr, 0, w, py(3.6), py(0.3), rng, night, 64)  # ground-floor glazing
            continue
        window_band(arr, 0, w, py(base + 3.2), py(base + 1.4), rng, night, 64)
        arr[py(base + 0.15) : py(base), :] = (10, 8, 6) if night else (60, 44, 36)
    arr[py(23.5) : py(22.9), :] = (20, 16, 12) if night else (120, 96, 80)
    return to_image(arr)


TT_FAR_LEVELS = [
    40,
    53,
    65,
    76,
    87,
    99,
    105,
    117,
    131,
    140.6,
    150.2,
    159.9,
    169.5,
    179.1,
    188.7,
    198.3,
    208.0,
    217.6,
    227.2,
    236.8,
    246.4,
    252.65,
]


TT_LIT = {  # perceived colour of the floodlit paint (orange band, white band)
    "winter": ((255, 150, 60), (255, 200, 120)),
    "summer": ((255, 160, 115), (220, 232, 255)),
}


def tt_far(kind: str = "day") -> Image.Image:
    """Far-LOD skin of the whole tower: u across one face, v = height 0..333 m (bottom = 0).

    kind = "day" (RGBA albedo: band colours, alpha = lattice members so the body stays see-through
    at middle distances; the gaps keep the band colour so mipmaps fade to a solid silhouette),
    "winter" / "summer" (emissive: the Landmark Light colour on the members) or "tiers" (Diamond
    Veil emissive: 17 LED tiers on a dim lattice, greyscale — the material colour sets the month's
    colour).
    """
    w, h = 128, 1024
    px_m = h / TT_HEIGHT
    rgb = Image.new("RGB", (w * SS, h * SS), (0, 0, 0))
    mask = Image.new("L", (w * SS, h * SS), 0)
    d, dm = ImageDraw.Draw(rgb), ImageDraw.Draw(mask)

    def y(m):
        return (h - m * px_m) * SS

    def colour(m: float, member: bool):
        white = tt_band_is_white(m)
        if kind == "day":
            c = TT_WHITE if white else TT_ORANGE
            return c if member else tuple(int(v * 0.9) for v in c)
        if kind == "tiers":
            return (70, 70, 70) if member else (10, 10, 10)
        c = TT_LIT[kind][1 if white else 0]
        return c if member else tuple(int(v * 0.15) for v in c)

    for i in range(h):
        m = (h - i - 0.5) / px_m
        d.line([(0, i * SS), (w * SS, i * SS)], fill=colour(m, False), width=SS)

    def line(p0, p1, m, width):
        d.line([p0, p1], fill=colour(m, True), width=width * SS)
        dm.line([p0, p1], fill=255, width=width * SS)

    for lo, hi in zip(TT_FAR_LEVELS, TT_FAR_LEVELS[1:], strict=False):  # an X and a horizontal per panel
        if TT_DECK[0] <= lo < TT_DECK[1]:
            continue
        mid = (lo + hi) / 2
        line((0, y(lo)), (w * SS, y(hi)), mid, 10)
        line((w * SS, y(lo)), (0, y(hi)), mid, 10)
        line((0, y(lo)), (w * SS, y(lo)), lo + 0.1, 7)
    for lo in range(0, int(TT_HEIGHT), 2):  # corner chords
        for x in (0, w * SS):
            line((x, y(lo)), (x, y(lo + 2)), lo + 1, 28)
    # main deck and everything from the top of the body up (radome, antenna) are opaque
    for lo, hi in ((TT_DECK[0], TT_DECK[1]), (241.0, TT_HEIGHT)):
        for i in range(int(h - hi * px_m), int(h - lo * px_m) + 1):
            m = (h - i - 0.5) / px_m
            c = (236, 237, 234) if lo == TT_DECK[0] else colour(m, True)
            if kind == "tiers":
                c = (40, 40, 40)
            elif lo == TT_DECK[0] and kind != "day":
                c = (90, 70, 50)
            d.line([(0, i * SS), (w * SS, i * SS)], fill=c, width=SS)
            dm.line([(0, i * SS), (w * SS, i * SS)], fill=255, width=SS)
    for lo, hi in ((119.0, 123.4), (125.0, 129.4)):  # deck window rows
        tone = {"day": (80, 98, 116), "tiers": (60, 60, 60)}.get(kind, (255, 226, 170))
        d.rectangle([0, y(hi), w * SS, y(lo)], fill=tone)
    if kind == "tiers":
        for t in TT_DIAMOND_TIERS:
            d.line([(0, y(t)), (w * SS, y(t))], fill=(255, 255, 255), width=4 * SS)
            for k in range(4):
                cx = (k + 0.5) * w / 4 * SS
                d.ellipse([cx - 9 * SS, y(t) - 6 * SS, cx + 9 * SS, y(t) + 6 * SS], fill=(255, 255, 255))
    out = shrink(rgb, w, h)
    if kind == "day":
        out.putalpha(shrink(mask, w, h))
    return out


# 17 LED tiers of the (Infinity) Diamond Veil; the tower carries 268 fixtures on them.
TT_DIAMOND_TIERS = [40, 53, 65, 76, 87, 99, 110, 141, 158, 175, 192, 209, 226, 236, 246, 276, 304]


# ----------------------------------------------------------------------------- 東京スカイツリー
SK_HEIGHT = 634.0
SK_WHITE = (232, 238, 242)  # スカイツリーホワイト: 藍白-based, faintly blue
SK_EDO_MURASAKI = (150, 80, 210)
SK_GOLD = (255, 205, 110)
SK_TACHIBANA = (255, 150, 40)  # 橘色 of 幟


def pipe_v(d: ImageDraw.ImageDraw, x0: float, x1: float, y0: float, y1: float, col=SK_WHITE):
    """Vertical steel tube seen from outside: bright centre, darker edges."""
    n = max(1, int((x1 - x0) * SS))
    for i in range(n):
        t = (i + 0.5) / n
        k = 0.78 + 0.22 * math.sin(math.pi * t)
        d.line([(x0 * SS + i, y0 * SS), (x0 * SS + i, y1 * SS)], fill=tuple(int(c * k) for c in col) + (255,))


def sk_lattice(kind: str = "day") -> Image.Image:
    """Outer truss of the tower: one tile = one bay between two 外周柱 (u) x two 12.5 m levels (v).

    day: white-on-transparent albedo (alpha = members). miyabi / nobori: emissive maps of the
    lit lattice (Edo purple with gold-leaf glints at the nodes; 橘色 with the columns emphasised).
    """
    w, h = 256, 512
    im = canvas(w, h, "RGBA" if kind == "day" else "RGB", (0, 0, 0, 0) if kind == "day" else (0, 0, 0))
    d = ImageDraw.Draw(im)
    col = {"day": SK_WHITE, "miyabi": SK_EDO_MURASAKI, "nobori": SK_TACHIBANA}[kind]
    diag = col if kind != "nobori" else tuple(int(c * 0.35) for c in col)

    def draw(ox, oy):
        member(d, (ox, oy), (ox + w, oy + h), 19, shade=diag, light=tuple(min(255, int(c * 1.08)) for c in diag))
        member(d, (ox + w, oy), (ox, oy + h), 19, shade=diag, light=tuple(min(255, int(c * 1.08)) for c in diag))
        for y in (0, h / 2):
            member(d, (ox, oy + y), (ox + w, oy + y), 18, shade=diag, light=diag)
        for y in (h / 4, 3 * h / 4):
            member(d, (ox, oy + y), (ox + w, oy + y), 7, shade=diag, light=diag)

    wrapped(draw, w, h)
    cw = 30
    pipe_v(d, -cw, cw, 0, h, col)  # half of each column sits on either tile edge
    pipe_v(d, w - cw, w + cw, 0, h, col)
    if kind == "miyabi":  # 金箔のようなきらめき: glints at the nodes
        for x, y in ((0, 0), (w, 0), (0, h / 2), (w, h / 2), (w / 2, h / 4), (w / 2, 3 * h / 4), (0, h), (w, h)):
            d.ellipse([(x - 11) * SS, (y - 11) * SS, (x + 11) * SS, (y + 11) * SS], fill=SK_GOLD)
    return shrink(im, w, h)


def sk_band(arr, y0, y1, col):
    arr[int(y0) : int(y1), :] = col


def sk_deck(night: bool = False) -> Image.Image:
    """天望デッキ drum: one tile = 8 m around (u) x 330–375 m (v)."""
    w, h = 256, 1024
    pm = h / 45.0

    def py(m):  # height in metres -> row
        return h - (m - 330.0) * pm

    rng = random.Random(SEED + 21)
    arr = np.zeros((h, w, 3), np.float32)
    panel = (24, 26, 30) if night else (214, 220, 226)
    arr[:] = panel
    fins = (14, 15, 17) if night else (168, 176, 184)
    for x in range(0, w, 16):  # vertical fins all round the drum
        arr[:, x : x + 3] = fins
    for lo, hi in ((336.0, 337.2), (341.0, 344.0), (347.5, 351.5)):
        for x in range(0, w, 32):
            if night:
                lit = np.array([255, 228, 180]) * rng.uniform(0.7, 1.0)
            else:
                lit = np.array([70, 88, 108]) * rng.uniform(0.9, 1.1)
            arr[int(py(hi)) : int(py(lo)), x + 2 : x + 30] = lit
    sk_band(arr, py(356.0), py(351.5), (30, 32, 36) if night else (236, 240, 244))
    sk_band(arr, py(373.0), py(371.0), (40, 42, 46) if night else (244, 246, 248))
    sk_band(arr, py(375.0), py(373.0), (20, 20, 22) if night else (150, 156, 162))
    return to_image(arr)


def sk_galleria(night: bool = False) -> Image.Image:
    """天望回廊: one tile = 8 m around x 435.5–463 m; the glass tube carries a spiral steel frame."""
    w, h = 256, 512
    pm = h / 27.5

    def py(m):
        return h - (m - 435.5) * pm

    arr = np.zeros((h, w, 3), np.float32)
    arr[:] = (26, 28, 30) if night else (218, 224, 230)
    glass = (150, 132, 104) if night else (64, 82, 102)
    sk_band(arr, py(458.8), py(446.6), glass)
    sk_band(arr, py(462.7), py(458.8), (30, 32, 34) if night else (232, 236, 240))
    for x in range(8, w, 28):  # small windows of the top ring
        arr[int(py(461.6)) : int(py(459.8)), x : x + 14] = (200, 180, 140) if night else (90, 104, 120)
    im = to_image(arr)
    d = ImageDraw.Draw(im)
    frame = (20, 20, 22) if night else (226, 230, 234)
    for x in range(-w, 2 * w, 64):  # spiral frame (slope of the 110 m ramp, exaggerated)
        d.line([(x, py(446.6)), (x + 90, py(458.8))], fill=frame, width=4)
    d.line([(0, py(452.7)), (w, py(452.7))], fill=frame, width=3)
    return im


def sk_antenna() -> Image.Image:
    """ゲイン塔 antenna drums: vertical slats (radome panels); one tile = 4 m around x 8 m."""
    w, h = 128, 256
    arr = np.zeros((h, w, 3), np.float32)
    for x in range(w):
        k = 0.82 + 0.18 * math.sin(math.pi * (x % 16) / 16)
        arr[:, x] = np.array(SK_WHITE) * k
    for y in range(0, h, 64):
        arr[y : y + 4, :] = (150, 156, 162)
    return to_image(arr)


SK_FAR_LEVELS = {"deck": (330.0, 375.0), "galleria": (435.5, 463.0), "gain": 497.0}


def sk_far(kind: str = "day") -> Image.Image:
    """Far-LOD skin: u once around the tower (12 bays), v = height 0..634 m.

    kind: day (albedo), iki (cool white lattice, light-blue core glow between the members), miyabi
    (Edo purple below with gold glints, warm white above 330 m) or nobori (橘色, vertical columns).
    """
    w, h = 256, 1024
    pm = h / SK_HEIGHT
    im = Image.new("RGB", (w * SS, h * SS), (0, 0, 0))
    d = ImageDraw.Draw(im)

    def y(m):
        return (h - m * pm) * SS

    def look(m: float):
        """(member colour, gap colour) at height m."""
        if kind == "day":
            return SK_WHITE, (150, 158, 166)
        if kind == "iki":
            return (232, 240, 252), (40, 120, 215) if m < 330 else (25, 50, 80)
        if kind == "miyabi":
            if m < 330:
                t = max(0.0, (m - 200) / 130)
                c = tuple(int(a * (1 - t) + b * t) for a, b in zip(SK_EDO_MURASAKI, (255, 220, 160), strict=True))
                return c, tuple(int(v * 0.25) for v in c)
            return (255, 225, 170), (60, 45, 30)
        return SK_TACHIBANA, (90, 45, 10)

    for i in range(h):
        m = (h - i - 0.5) / pm
        d.line([(0, i * SS), (w * SS, i * SS)], fill=look(m)[1], width=SS)
    bays = 12
    bw = w / bays
    for lo in np.arange(0, SK_FAR_LEVELS["gain"], 25.0):
        hi = lo + 25.0
        if (
            SK_FAR_LEVELS["deck"][0] <= lo + 1 < SK_FAR_LEVELS["deck"][1]
            or SK_FAR_LEVELS["galleria"][0] <= lo + 1 < SK_FAR_LEVELS["galleria"][1]
        ):
            continue
        mem = look(lo + 12)[0]
        for b in range(bays + 1):
            x0 = b * bw
            if kind != "nobori":
                d.line([(x0 * SS, y(lo)), ((x0 + bw) * SS, y(hi))], fill=mem, width=2 * SS)
                d.line([((x0 + bw) * SS, y(lo)), (x0 * SS, y(hi))], fill=mem, width=2 * SS)
            d.line([(x0 * SS, y(lo)), (x0 * SS, y(hi))], fill=mem, width=(5 if kind == "nobori" else 3) * SS)
        d.line([(0, y(lo)), (w * SS, y(lo))], fill=mem, width=2 * SS)
        if kind == "miyabi" and lo < 330:
            for b in range(bays):
                d.ellipse([(b * bw - 3) * SS, y(lo) - 3 * SS, (b * bw + 3) * SS, y(lo) + 3 * SS], fill=SK_GOLD)
    night = kind != "day"
    ring = {"iki": (60, 170, 255), "miyabi": SK_EDO_MURASAKI, "nobori": SK_TACHIBANA}.get(kind, (200, 206, 212))
    for (lo, hi), base in ((SK_FAR_LEVELS["deck"], 330.0), (SK_FAR_LEVELS["galleria"], 435.5)):
        d.rectangle([0, y(hi), w * SS, y(lo)], fill=(40, 42, 46) if night else (218, 224, 230))
        windows = ((336, 337.2), (341, 344), (347.5, 351.5)) if base == 330.0 else ((446.6, 458.8),)
        for a, b in windows:
            d.rectangle([0, y(b), w * SS, y(a)], fill=(255, 225, 175) if night else (70, 88, 108))
        rim = 371.5 if base == 330.0 else 446.0
        d.rectangle([0, y(rim + 1.2), w * SS, y(rim)], fill=ring)
    g = SK_FAR_LEVELS["gain"]
    d.rectangle([0, y(SK_HEIGHT), w * SS, y(g)], fill=(120, 126, 132) if night else (200, 206, 212))
    for m in np.arange(g, SK_HEIGHT, 11.0):
        d.rectangle([0, y(m + 1.0), w * SS, y(m)], fill=(255, 255, 255) if night else (150, 156, 162))
    d.rectangle([0, y(SK_HEIGHT), w * SS, y(SK_HEIGHT - 6)], fill=(255, 255, 255) if night else (236, 240, 244))
    return shrink(im, w, h)


# ----------------------------------------------------------------------------- 東京駅丸の内駅舎
TS_BRICK = (150, 66, 48)  # 化粧煉瓦 (dark red)
TS_MORTAR = (196, 184, 168)
TS_STONE = (226, 220, 206)  # 稲田石 granite bands and dressings
TS_TRIM = (88, 58, 44)  # dark brown cornice, frames
TS_PX_M = 96  # facade textures: 96 px per metre


class Facade:
    """Facade tile painted in metres (origin bottom-left) with day / night / window-only looks."""

    def __init__(self, w_m: float, h_m: float, kind: str, seed: int):
        self.w, self.h = int(round(w_m * TS_PX_M)), int(round(h_m * TS_PX_M))
        self.kind = kind  # day | night (floodlit + rooms) | windows (rooms only)
        self.rng = random.Random(seed)
        self.arr = np.zeros((self.h, self.w, 3), np.float32)
        self.h_m = h_m

    def rows(self, y0: float, y1: float):
        return max(0, int(round(self.h - y1 * TS_PX_M))), min(self.h, int(round(self.h - y0 * TS_PX_M)))

    def cols(self, x0: float, x1: float):
        return int(round(x0 * TS_PX_M)), int(round(x1 * TS_PX_M))

    def light(self, y_mid: float) -> float:
        """Floodlights at the foot of the walls: brightest low down, still lit under the cornice."""
        if self.kind == "windows":
            return 0.0
        if self.kind == "day":
            return 1.0
        return 0.55 + 0.45 * math.exp(-y_mid / 7.0)

    def tone(self, col, y_mid: float):
        if self.kind == "day":
            return np.array(col, np.float32)
        warm = np.array([1.0, 0.78, 0.52])
        return np.array(col, np.float32) * warm * self.light(y_mid) * 0.95

    def brick(self, x0, x1, y0, y1):
        r0, r1 = self.rows(y0, y1)
        c0, c1 = self.cols(x0, x1)
        bh, bw = 7, 22  # course 7 px (~7.3 cm), brick 22 px
        for r in range(r0, r1):
            course = (self.h - r) // bh
            y_m = (self.h - r) / TS_PX_M
            base = self.tone(TS_BRICK, y_m)
            mortar = self.tone(TS_MORTAR, y_m)
            is_joint = (self.h - r) % bh == 0
            row = self.arr[r, c0:c1]
            if is_joint:
                row[:] = mortar
                continue
            off = (course % 2) * (bw // 2)
            for c in range(c0, c1):
                if (c + off) % bw == 0:
                    row[c - c0] = mortar
                else:
                    k = 0.9 + 0.2 * ((hash((course, (c + off) // bw, 7)) % 1000) / 1000.0)
                    row[c - c0] = base * k
        return self

    def fill(self, x0, x1, y0, y1, col):
        r0, r1 = self.rows(y0, y1)
        c0, c1 = self.cols(x0, x1)
        self.arr[r0:r1, c0:c1] = self.tone(col, (y0 + y1) / 2)

    def stone(self, x0, x1, y0, y1, col=TS_STONE):
        self.fill(x0, x1, y0, y1, col)
        r0, r1 = self.rows(y0, y1)
        c0, c1 = self.cols(x0, x1)
        self.arr[r0 : r0 + 1, c0:c1] *= 1.06  # lit top edge
        self.arr[r1 - 2 : r1, c0:c1] *= 0.78  # shadow under the band

    def window(self, x0, x1, y0, y1, bars=(2, 3), arch=False):
        """Dark-framed sash window with glazing bars; rooms behind light up at night."""
        frame = 0.07
        self.fill(x0, x1, y0, y1, TS_TRIM)
        lit = self.kind != "day" and self.rng.random() < 0.8
        gx0, gx1, gy0, gy1 = x0 + frame, x1 - frame, y0 + frame, y1 - frame
        r0, r1 = self.rows(gy0, gy1)
        c0, c1 = self.cols(gx0, gx1)
        if self.kind == "day":
            g = np.linspace(0, 1, r1 - r0)[:, None, None]
            glass = np.array([92, 108, 122]) * (1 - g) + np.array([46, 54, 64]) * g
            self.arr[r0:r1, c0:c1] = glass * self.rng.uniform(0.9, 1.1)
        else:
            self.arr[r0:r1, c0:c1] = np.array([255, 214, 150]) * (self.rng.uniform(0.75, 1.0) if lit else 0.06)
        bar = (232, 228, 218) if self.kind == "day" else ((60, 45, 30) if lit else (10, 8, 6))
        nx, ny = bars
        for k in range(1, nx):
            x = gx0 + (gx1 - gx0) * k / nx
            cc0, cc1 = self.cols(x - 0.03, x + 0.03)
            self.arr[r0:r1, cc0:cc1] = bar
        for k in range(1, ny):
            y = gy0 + (gy1 - gy0) * k / ny
            rr0, rr1 = self.rows(y - 0.03, y + 0.03)
            self.arr[rr0:rr1, c0:c1] = bar
        if arch:  # round head: stone voussoirs over the opening
            self.stone(x0 - 0.15, x1 + 0.15, y1, y1 + 0.35)

    def surround(self, x0, x1, y0, y1, pediment=False):
        """White stone architrave round a window (drawn before the window)."""
        self.stone(x0 - 0.18, x1 + 0.18, y0 - 0.25, y1 + 0.18)
        if pediment:
            self.stone(x0 - 0.35, x1 + 0.35, y1 + 0.18, y1 + 0.55)
            self.stone(x0 + 0.2, x1 - 0.2, y1 + 0.55, y1 + 0.75)

    def image(self) -> Image.Image:
        return to_image(self.arr)


TS_WING_H = 18.0
TS_PAVILION_H = 21.0


def ts_wing(kind: str) -> Image.Image:
    """General wing bay (both floors' windows of one bay): one tile = 4.0 m wide x 0–18 m.

    1F banded brick (辰野式の白い帯) over a granite plinth, stone belt, 2F windows with pediments and
    3F windows between giant white pilasters, frieze and the brown cornice under the balustrade.
    """
    f = Facade(4.0, TS_WING_H, kind, SEED + 31)
    f.brick(0, 4.0, 0, TS_WING_H)
    f.stone(0, 4.0, 0, 0.8, (196, 192, 184))
    for y in np.arange(1.3, 6.0, 0.62):  # banded rustication of the ground floor
        f.stone(0, 4.0, y, y + 0.17)
    f.stone(0, 4.0, 6.0, 6.6)
    f.stone(0, 4.0, 11.6, 11.85)
    for x0, x1 in ((-0.32, 0.32), (3.68, 4.32)):  # giant pilasters (half on each tile edge)
        f.stone(max(0, x0), min(4.0, x1), 6.6, 15.6)
        f.stone(max(0, x0 - 0.12), min(4.0, x1 + 0.12), 15.3, 16.0)
    f.stone(0, 4.0, 16.0, 16.9)
    f.fill(0, 4.0, 16.9, 18.0, TS_TRIM)
    f.fill(0, 4.0, 17.6, 18.0, (110, 76, 58))
    f.surround(1.25, 2.75, 1.4, 5.1)
    f.window(1.25, 2.75, 1.4, 5.1, bars=(2, 4))
    f.surround(1.3, 2.7, 7.3, 10.1, pediment=True)
    f.window(1.3, 2.7, 7.3, 10.1, bars=(2, 3))
    f.surround(1.35, 2.65, 12.4, 14.7)
    f.window(1.35, 2.65, 12.4, 14.7, bars=(2, 3))
    return f.image()


def ts_pavilion(kind: str) -> Image.Image:
    """Tower / pavilion / dome-hall face: one tile = 6.0 m wide x 0–21 m.

    Brick with white stone bands all the way up (the 辰野式 stripes) and stone quoins at the tile
    edges, a window per floor in a stone surround, and the white stone top storey.
    """
    f = Facade(6.0, TS_PAVILION_H, kind, SEED + 41)
    f.brick(0, 6.0, 0, TS_PAVILION_H)
    f.stone(0, 6.0, 0, 0.8, (196, 192, 184))
    for y in np.arange(1.3, 16.0, 0.62):
        f.stone(0, 6.0, y, y + 0.16)
    for k, y in enumerate(np.arange(0.8, 16.0, 0.62)):  # quoins: alternating long / short blocks
        wq = 0.9 if k % 2 == 0 else 0.55
        f.stone(0, wq, y, y + 0.46)
        f.stone(6.0 - wq, 6.0, y, y + 0.46)
    f.stone(0, 6.0, 6.0, 6.5)
    f.stone(0, 6.0, 11.5, 11.8)
    f.stone(0, 6.0, 16.0, TS_PAVILION_H)
    f.fill(0, 6.0, 20.2, TS_PAVILION_H, TS_TRIM)
    for y0, y1 in ((1.6, 5.2), (7.2, 10.4), (12.4, 15.0)):
        f.surround(2.2, 3.8, y0, y1, pediment=y0 > 7)
        f.window(2.2, 3.8, y0, y1, bars=(2, 3), arch=y0 < 2)
    for x in (1.0, 2.6, 4.2):  # small windows of the stone storey
        f.surround(x, x + 0.8, 17.4, 19.0)
        f.window(x, x + 0.8, 17.4, 19.0, bars=(1, 2))
    return f.image()


def ts_drum(kind: str) -> Image.Image:
    """Drum under each dome (octagon face): one tile = 8.6 m wide x 24.5–29.5 m (5 m)."""
    f = Facade(8.6, 5.0, kind, SEED + 51)
    f.brick(0, 8.6, 0, 5.0)
    for y in (0.0, 1.6, 3.2):
        f.stone(0, 8.6, y, y + 0.22)
    f.stone(0, 0.7, 0, 5.0)
    f.stone(7.9, 8.6, 0, 5.0)
    f.stone(0, 8.6, 4.3, 5.0)
    for x in (2.2, 5.4):
        f.surround(x, x + 1.0, 1.2, 3.6)
        f.window(x, x + 1.0, 1.2, 3.6, bars=(1, 2), arch=True)
    return f.image()


def ts_roof(kind: str = "slate") -> Image.Image:
    """Roofing, one tile = 2 m x 2 m: 天然スレート (dark grey, staggered) or 銅板 (dark bronze, seams)."""
    w = h = 192
    rng = np.random.default_rng(SEED + (61 if kind == "slate" else 62))
    arr = np.zeros((h, w, 3), np.float32)
    n = noise(w, h, 24, SEED + 63)[:, :, None]
    if kind == "slate":
        base = np.array([78, 82, 88])
        arr[:] = base * (0.92 + 0.12 * n)
        for r in range(0, h, 12):  # courses of slates with staggered joints
            arr[r : r + 1, :] *= 0.6
            off = 8 if (r // 12) % 2 else 0
            for c in range(off, w, 16):
                arr[r : r + 12, c : c + 1] *= 0.7
                arr[r + 1 : r + 12, c + 1 : c + 15] *= rng.uniform(0.92, 1.08)
    else:
        base = np.array([96, 70, 52])
        green = np.array([92, 120, 104])
        arr[:] = base * (0.85 + 0.25 * n) + (green - base) * (n**4) * 0.5
        for c in range(0, w, 24):  # standing seams
            arr[:, c : c + 2] = base * 1.25
    return to_image(arr)


def ts_balustrade() -> Image.Image:
    """Copper-brown balustrade on the cornice: one tile = 2 m x 1.1 m, alpha = rails and balusters."""
    w, h = 192, 106
    im = canvas(w, h)
    d = ImageDraw.Draw(im)
    col = (104, 72, 56, 255)
    d.rectangle([0, 0, w * SS, 14 * SS], fill=col)
    d.rectangle([0, (h - 12) * SS, w * SS, h * SS], fill=col)
    for k in range(8):
        cx = (k + 0.5) * w / 8
        d.ellipse([(cx - 7) * SS, 30 * SS, (cx + 7) * SS, 58 * SS], fill=col)
        d.rectangle([(cx - 4) * SS, 14 * SS, (cx + 4) * SS, (h - 12) * SS], fill=col)
        d.rectangle([(cx - 6) * SS, (h - 26) * SS, (cx + 6) * SS, (h - 12) * SS], fill=col)
    for x in (0, w / 2, w):  # posts
        d.rectangle([(x - 7) * SS, 0, (x + 7) * SS, h * SS], fill=(116, 82, 64, 255))
    return shrink(im, w, h)


def ts_far(kind: str) -> Image.Image:
    """Far-LOD wall skin: one tile = 16 m x 0–20 m (four wing bays, coarse)."""
    w, h = 128, 160
    arr = np.zeros((h, w, 3), np.float32)
    night = kind != "day"
    k = 0.75 if night else 1.0
    arr[:] = np.array(TS_BRICK) * (np.array([1.0, 0.8, 0.55]) * k if night else 1.0)
    for y in (8, 52, 92, 128, 135):  # stone bands
        arr[h - y - 4 : h - y, :] = np.array(TS_STONE) * (np.array([1.0, 0.82, 0.6]) if night else 1.0)
    for b in range(4):
        x = b * 32 + 12
        for y0, y1 in ((12, 40), (60, 82), (98, 118)):
            glass = (255, 214, 150) if night else (60, 72, 84)
            arr[h - y1 : h - y0, x : x + 9] = glass
        arr[h - 128 : h - 52, b * 32 : b * 32 + 4] = np.array(TS_STONE) * (0.8 if night else 1.0)
    arr[0 : h - 135, :] = np.array(TS_TRIM) * (0.5 if night else 1.0)
    return to_image(arr)


# ----------------------------------------------------------------------------- registry
TEXTURES: dict[str, Callable[[], Image.Image]] = {
    "tt_lacing.png": tt_lacing,
    "tt_leg.png": tt_leg,
    "tt_deck.png": lambda: tt_deck(False),
    "tt_deck_night.png": lambda: tt_deck(True),
    "tt_foottown.png": lambda: tt_foottown(False),
    "tt_foottown_night.png": lambda: tt_foottown(True),
    "tt_far.png": lambda: tt_far("day"),
    "tt_far_winter.png": lambda: tt_far("winter"),
    "tt_far_summer.png": lambda: tt_far("summer"),
    "tt_far_tiers.png": lambda: tt_far("tiers"),
    "sk_lattice.png": lambda: sk_lattice("day"),
    "sk_lattice_miyabi.png": lambda: sk_lattice("miyabi"),
    "sk_lattice_nobori.png": lambda: sk_lattice("nobori"),
    "sk_deck.png": lambda: sk_deck(False),
    "sk_deck_night.png": lambda: sk_deck(True),
    "sk_galleria.png": lambda: sk_galleria(False),
    "sk_galleria_night.png": lambda: sk_galleria(True),
    "sk_antenna.png": sk_antenna,
    "sk_far.png": lambda: sk_far("day"),
    "sk_far_iki.png": lambda: sk_far("iki"),
    "sk_far_miyabi.png": lambda: sk_far("miyabi"),
    "sk_far_nobori.png": lambda: sk_far("nobori"),
    "ts_wing.jpg": lambda: ts_wing("day"),
    "ts_wing_night.jpg": lambda: ts_wing("night"),
    "ts_wing_windows.jpg": lambda: ts_wing("windows"),
    "ts_pavilion.jpg": lambda: ts_pavilion("day"),
    "ts_pavilion_night.jpg": lambda: ts_pavilion("night"),
    "ts_pavilion_windows.jpg": lambda: ts_pavilion("windows"),
    "ts_drum.jpg": lambda: ts_drum("day"),
    "ts_drum_night.jpg": lambda: ts_drum("night"),
    "ts_drum_windows.jpg": lambda: ts_drum("windows"),
    "ts_slate.jpg": lambda: ts_roof("slate"),
    "ts_copper.jpg": lambda: ts_roof("copper"),
    "ts_balustrade.png": ts_balustrade,
    "ts_far.png": lambda: ts_far("day"),
    "ts_far_night.png": lambda: ts_far("night"),
}


def contact_sheet(images: dict[str, Image.Image], path: Path) -> None:
    cell = 256
    cols = 6
    rows = math.ceil(len(images) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 16)), (40, 44, 52))
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(images.items()):
        thumb = im.copy()
        thumb.thumbnail((cell - 8, cell - 8))
        bg = Image.new("RGB", thumb.size, (90, 140, 200))
        if thumb.mode == "RGBA":
            bg.paste(thumb, mask=thumb.split()[3])
        else:
            bg = thumb.convert("RGB")
        x, y = (i % cols) * cell, (i // cols) * (cell + 16)
        sheet.paste(bg, (x + 4, y + 4))
        d.text((x + 4, y + cell), name, fill=(230, 230, 230))
    sheet.save(path)


def main() -> None:
    random.seed(SEED)
    np.random.seed(SEED)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    made = {}
    for name, fn in TEXTURES.items():
        im = fn()
        path = OUTPUT_DIR / name
        if name.endswith(".jpg"):
            im.convert("RGB").save(path, quality=88, optimize=True)
        else:
            im.save(path, optimize=True)
        made[name] = im
        print(f"{name}: {im.size[0]}x{im.size[1]} {im.mode} {path.stat().st_size} bytes")
    if len(sys.argv) > 1:
        contact_sheet(made, Path(sys.argv[1]))


if __name__ == "__main__":
    main()
