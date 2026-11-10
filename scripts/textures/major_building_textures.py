# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural textures for the four major buildings (東京都庁第一本庁舎, 国会議事堂, 東京国際展示場
会議棟, 国立競技場) built by scripts/blender/major_buildings.py.

Everything is drawn from rectangles, fixed seeds and smooth noise: no photos, fonts, logos or
lettering. Each texture is a world-unit tile; TILES below says how many metres one tile covers
(scripts/blender/major_buildings.py maps UVs in the same units). *_night maps are the emissive
textures of the night materials (Light_<mode>_<part>): lit windows on black.

Image rows run top to bottom while UV v runs bottom to top, so every layout below is written in
metres from the bottom of the tile and flipped by `rows()`.

Usage:
    uv run scripts/textures/major_building_textures.py              # write assets/landmarks/textures/mb_*
    uv run scripts/textures/major_building_textures.py sheet.png    # also save a contact sheet
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

SEED = 20261110
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "landmarks" / "textures"

# Metres covered by one tile (u, v); scripts/blender/major_buildings.py uses the same numbers.
TILES = {
    "mb_tocho_facade.jpg": (12.8, 16.0),
    "mb_tocho_night.png": (12.8, 16.0),
    "mb_diet_wing.jpg": (4.6, 20.9),
    "mb_diet_wing_night.png": (4.6, 20.9),
    "mb_diet_stone.jpg": (4.0, 4.0),
    "mb_big_titanium.jpg": (6.0, 4.0),
    "mb_big_glass.jpg": (6.0, 4.0),
    "mb_big_glass_night.png": (6.0, 4.0),
    "mb_stadium_louver.jpg": (2.0, 1.0),
    "mb_stadium_seats.jpg": (8.0, 8.0),
    "mb_stadium_field.jpg": (200.0, 130.0),
}


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


class Tile:
    """An RGB float canvas addressed in metres from the tile's bottom-left corner."""

    def __init__(self, px_w: int, px_h: int, metres: tuple[float, float], fill):
        self.w, self.h = px_w, px_h
        self.mu, self.mv = metres
        self.a = np.empty((px_h, px_w, 3), np.float32)
        self.a[:] = fill

    def cols(self, u0: float, u1: float) -> slice:
        return slice(
            int(round(u0 / self.mu * self.w)),
            max(int(round(u0 / self.mu * self.w)) + 1, int(round(u1 / self.mu * self.w))),
        )

    def rows(self, v0: float, v1: float) -> slice:
        top = self.h - int(round(v1 / self.mv * self.h))
        bot = self.h - int(round(v0 / self.mv * self.h))
        return slice(max(0, top), max(top + 1, bot))

    def rect(self, u0, v0, u1, v1, color) -> None:
        self.a[self.rows(v0, v1), self.cols(u0, u1)] = color

    def shade(self, k: np.ndarray) -> None:
        self.a *= k[..., None]

    def image(self) -> Image.Image:
        return Image.fromarray(np.clip(self.a, 0, 255).astype(np.uint8))


def grain(t: Tile, seed: int, amount: float = 0.08, scale: float = 40.0) -> None:
    n = noise(t.w, t.h, scale, seed) * 0.6 + noise(t.w, t.h, scale * 6, seed + 1) * 0.4
    t.shade(1.0 - amount + 2 * amount * n)


# ----------------------------------------------------------------------------- 東京都庁第一本庁舎
# One tile: 4 bays of 3.2 m x 4 floors of 4.0 m. Each floor: granite spandrel to 1.4 m, a band of
# two windows per bay (1.15 m wide, 1.4–3.2 m), granite above; each bay edged by a darker grey
# pier with the fine vertical lines (縦繁の組子) of the cladding. Every second bay carries a darker
# panel column, the "integrated circuit" rhythm of the real facade.
TOCHO_GRANITE = (176, 170, 162)
TOCHO_DARK = (118, 116, 114)
TOCHO_GLASS = (64, 76, 88)


def tocho_windows():
    for floor in range(4):
        for bay in range(4):
            for pane in range(2):
                u0 = bay * 3.2 + 0.6 + pane * 1.1
                yield floor, bay, pane, (u0, floor * 4.0 + 1.5, u0 + 0.9, floor * 4.0 + 3.1)


def tocho_facade() -> Image.Image:
    t = Tile(1024, 1280, TILES["mb_tocho_facade.jpg"], TOCHO_GRANITE)
    for bay in range(4):
        u = bay * 3.2
        t.rect(u, 0, u + 0.3, 16, TOCHO_DARK)
        for k in range(3):  # fine vertical lines on the pier
            t.rect(u + 0.05 + k * 0.1, 0, u + 0.08 + k * 0.1, 16, (96, 95, 94))
        if bay % 2 == 1:
            t.rect(u + 0.3, 0, u + 3.2, 16, (150, 146, 140))
    for floor in range(4):
        t.rect(0, floor * 4.0, 12.8, floor * 4.0 + 0.12, (134, 130, 125))  # floor joint
    for _, _, _, (u0, v0, u1, v1) in tocho_windows():
        t.rect(u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, (88, 88, 90))
        t.rect(u0, v0, u1, v1, TOCHO_GLASS)
        t.rect(u0, v1 - 0.6, u1, v1, (92, 108, 124))  # sky reflection in the upper glass
        t.rect(u0 + 0.43, v0, u0 + 0.47, v1, (70, 72, 76))  # mullion
    grain(t, SEED + 1, 0.06)
    return t.image()


def tocho_night() -> Image.Image:
    t = Tile(512, 640, TILES["mb_tocho_night.png"], (0, 0, 0))
    rng = np.random.default_rng(SEED + 2)
    for _floor, _bay, _pane, (u0, v0, u1, v1) in tocho_windows():
        is_lit = rng.random() < 0.62
        if not is_lit:
            continue
        warm = rng.uniform(0.75, 1.0)
        t.rect(u0, v0, u1, v1, (255 * warm, 236 * warm, 196 * warm))
        t.rect(u0, v1 - 0.25, u1, v1, (120 * warm, 112 * warm, 96 * warm))  # blind edge
    return t.image()


# ----------------------------------------------------------------------------- 国会議事堂
# One tile = one 4.6 m bay of a wing, the full 20.91 m height: rusticated base (horizontal joints
# every 0.62 m) with a small arched window, tall windows on the 2nd and 3rd floors between
# pilasters, an attic window, the cornice and the parapet.
DIET_STONE = (220, 210, 198)
DIET_GLASS = (52, 62, 60)


def diet_windows():
    yield (1.85, 1.3, 2.75, 3.1)  # ground floor (arched top drawn separately)
    yield (1.6, 6.2, 3.0, 10.0)  # 2F
    yield (1.6, 11.2, 3.0, 14.6)  # 3F
    yield (1.85, 15.8, 2.75, 17.2)  # attic


def diet_wing() -> Image.Image:
    t = Tile(256, 1164, TILES["mb_diet_wing.jpg"], DIET_STONE)
    for k in range(9):  # rustication joints
        t.rect(0, k * 0.62, 4.6, k * 0.62 + 0.05, (170, 160, 150))
    t.rect(0, 5.3, 4.6, 5.7, (232, 224, 214))  # string course
    t.rect(0, 5.7, 0.55, 18.2, (230, 221, 210))  # pilasters
    t.rect(4.05, 5.7, 4.6, 18.2, (230, 221, 210))
    t.rect(0.55, 5.7, 0.6, 18.2, (186, 176, 165))
    t.rect(4.0, 5.7, 4.05, 18.2, (186, 176, 165))
    t.rect(0, 18.2, 4.6, 19.1, (236, 228, 218))  # cornice
    t.rect(0, 18.1, 4.6, 18.25, (150, 140, 130))
    t.rect(0, 20.6, 4.6, 20.9, (236, 228, 218))  # parapet coping
    for u0, v0, u1, v1 in diet_windows():
        t.rect(u0 - 0.12, v0 - 0.15, u1 + 0.12, v1 + 0.12, (200, 190, 178))
        t.rect(u0, v0, u1, v1, DIET_GLASS)
        t.rect((u0 + u1) / 2 - 0.03, v0, (u0 + u1) / 2 + 0.03, v1, (40, 46, 44))
        for k in range(1, 4):
            v = v0 + (v1 - v0) * k / 4
            t.rect(u0, v - 0.03, u1, v + 0.03, (40, 46, 44))
    for k in range(6):  # arch over the ground-floor window
        r = 0.45 - k * 0.07
        t.rect(2.3 - r, 3.1 + k * 0.07, 2.3 + r, 3.17 + k * 0.07, DIET_GLASS)
    grain(t, SEED + 3, 0.07)
    return t.image()


def diet_wing_night() -> Image.Image:
    t = Tile(128, 582, TILES["mb_diet_wing_night.png"], (0, 0, 0))
    lit = [(0.75, 0.62, 0.42), (0.0, 0.0, 0.0), (0.55, 0.48, 0.35), (0.0, 0.0, 0.0)]  # few rooms lit
    for (u0, v0, u1, v1), c in zip(diet_windows(), lit, strict=True):
        t.rect(u0, v0, u1, v1, tuple(255 * x for x in c))
    return t.image()


def diet_stone() -> Image.Image:
    t = Tile(512, 512, TILES["mb_diet_stone.jpg"], DIET_STONE)
    rng = np.random.default_rng(SEED + 4)
    for row in range(7):  # ashlar: 0.57 m courses, 1.0 m blocks, half-bond
        v0 = row * 4.0 / 7
        off = 0.5 if row % 2 else 0.0
        for k in range(5):
            u0 = (k + off) % 4.0
            tone = rng.uniform(0.95, 1.04)
            t.rect(u0, v0, min(4.0, u0 + 1.0), v0 + 4.0 / 7, tuple(c * tone for c in DIET_STONE))
            t.rect(u0, v0, u0 + 0.025, v0 + 4.0 / 7, (176, 166, 156))
        t.rect(0, v0, 4.0, v0 + 0.025, (176, 166, 156))
    grain(t, SEED + 5, 0.06)
    return t.image()


# ----------------------------------------------------------------------------- 東京国際展示場 会議棟
# Titanium: triangular panels (2 m rows, 1.5 m bases) in champagne grey; no windows on the pyramids.
# Glass: a 1.5 m x 2.0 m curtain-wall grid with a spandrel at each floor.
TITANIUM = (184, 174, 150)  # champagne titanium (photos: warm grey-beige)


def titanium() -> Image.Image:
    t = Tile(512, 341, TILES["mb_big_titanium.jpg"], TITANIUM)
    # Triangular panels: rows 2 m high cut by the diagonals u ± 0.75 v = k * 1.5 (period 1.5 m in u,
    # so the 4 m tile shifts by exactly two periods and tiles seamlessly).
    u = (np.arange(t.w) + 0.5) / t.w * t.mu
    v = (np.arange(t.h)[::-1] + 0.5) / t.h * t.mv
    U, V = np.meshgrid(u, v)
    d1 = (U - 0.75 * V) / 1.5
    d2 = (U + 0.75 * V) / 1.5
    row = np.floor(V / 2.0)
    cell = (np.floor(d1) * 7 + np.floor(d2) * 13 + row * 5) % 16
    rng = np.random.default_rng(SEED + 6)
    tones = rng.uniform(0.93, 1.06, 16)
    t.shade(tones[cell.astype(int)].astype(np.float32))
    seam = (
        (np.abs(d1 - np.round(d1)) < 0.012)
        | (np.abs(d2 - np.round(d2)) < 0.012)
        | (np.abs(V / 2.0 - np.round(V / 2.0)) < 0.008)
    )
    t.a[seam] = (118, 112, 100)
    grain(t, SEED + 7, 0.04, 80)
    return t.image()


def glass() -> Image.Image:
    t = Tile(512, 341, TILES["mb_big_glass.jpg"], (70, 92, 104))
    t.rect(0, 2.0, 6.0, 4.0, (88, 112, 126))
    for i in range(4):
        t.rect(i * 1.5, 0, i * 1.5 + 0.08, 4.0, (150, 156, 160))
    t.rect(0, 0, 6.0, 0.5, (130, 136, 140))  # floor spandrel
    t.rect(0, 2.0, 6.0, 2.06, (150, 156, 160))
    grain(t, SEED + 8, 0.05, 60)
    return t.image()


def glass_night() -> Image.Image:
    t = Tile(256, 171, TILES["mb_big_glass_night.png"], (0, 0, 0))
    t.rect(0, 0.5, 6.0, 4.0, (220, 214, 196))
    for i in range(4):
        t.rect(i * 1.5, 0, i * 1.5 + 0.08, 4.0, (0, 0, 0))
    return t.image()


# ----------------------------------------------------------------------------- 国立競技場
# 軒庇: cedar louvers 105 mm wide with 50 mm gaps, each slat its own tone (the real ones come from
# all 47 prefectures). Seats: a 0.5 m mosaic of the five colours (濃茶・深緑・グレー・黄緑・白).
# Field: the grass pitch (107 x 71 m, mowing stripes) inside a 400 m track (straights 84.39 m,
# inner radius 36.5 m, 9 lanes of 1.22 m) on a 200 x 130 m tile centred on the field.
def louver() -> Image.Image:
    t = Tile(512, 256, TILES["mb_stadium_louver.jpg"], (48, 34, 24))
    rng = np.random.default_rng(SEED + 9)
    u = 0.0
    while u < 2.0 - 1e-6:
        tone = rng.uniform(0.82, 1.12)
        t.rect(u, 0, u + 0.105, 1.0, (182 * tone, 132 * tone, 86 * tone))
        t.rect(u + 0.085, 0, u + 0.105, 1.0, (130 * tone, 92 * tone, 58 * tone))  # shaded side
        u += 2.0 / 13
    grain(t, SEED + 10, 0.05, 30)
    return t.image()


def seats() -> Image.Image:
    palette = [(78, 52, 38), (38, 72, 48), (128, 128, 124), (150, 176, 70), (226, 226, 220)]
    weights = [0.3, 0.28, 0.18, 0.16, 0.08]
    t = Tile(256, 256, TILES["mb_stadium_seats.jpg"], (60, 60, 60))
    rng = np.random.default_rng(SEED + 11)
    n = 16
    for j in range(n):
        for i in range(n):
            c = palette[rng.choice(len(palette), p=weights)]
            t.rect(i * 0.5, j * 0.5, i * 0.5 + 0.44, j * 0.5 + 0.42, c)
    return t.image()


def field() -> Image.Image:
    w, h = 1024, 666
    mu, mv = TILES["mb_stadium_field.jpg"]
    x = (np.arange(w) + 0.5) / w * mu - mu / 2
    y = (np.arange(h)[::-1] + 0.5) / h * mv - mv / 2
    X, Y = np.meshgrid(x, y)
    a = np.empty((h, w, 3), np.float32)
    a[:] = (120, 52, 42)  # apron
    half = 84.39 / 2
    # distance from the track's inner kerb line (a stadium shape: straights + semicircles)
    dx = np.maximum(np.abs(X) - half, 0)
    r = np.hypot(dx, Y)
    track = (r >= 36.5) & (r <= 36.5 + 9 * 1.22)
    a[track] = (168, 64, 50)
    for k in range(10):
        line = np.abs(r - (36.5 + k * 1.22)) < 0.06
        a[line] = (236, 236, 230)
    grass = r < 36.5
    stripes = (np.floor((X + 200) / 5.35) % 2) == 0
    a[grass] = (58, 120, 52)
    a[grass & stripes] = (66, 134, 58)
    pitch = (np.abs(X) <= 53.5) & (np.abs(Y) <= 35.5)
    edge = pitch & ((np.abs(np.abs(X) - 53.5) < 0.08) | (np.abs(np.abs(Y) - 35.5) < 0.08) | (np.abs(X) < 0.06))
    a[edge] = (236, 236, 230)
    circle = np.abs(np.hypot(X, Y) - 9.15) < 0.08
    a[circle] = (236, 236, 230)
    n = noise(w, h, 60, SEED + 12)
    a *= (0.94 + 0.12 * n)[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


TEXTURES = {
    "mb_tocho_facade.jpg": tocho_facade,
    "mb_tocho_night.png": tocho_night,
    "mb_diet_wing.jpg": diet_wing,
    "mb_diet_wing_night.png": diet_wing_night,
    "mb_diet_stone.jpg": diet_stone,
    "mb_big_titanium.jpg": titanium,
    "mb_big_glass.jpg": glass,
    "mb_big_glass_night.png": glass_night,
    "mb_stadium_louver.jpg": louver,
    "mb_stadium_seats.jpg": seats,
    "mb_stadium_field.jpg": field,
}


def contact_sheet(made: dict[str, Image.Image], path: Path) -> None:
    thumbs = [im.copy() for im in made.values()]
    for im in thumbs:
        im.thumbnail((320, 320))
    sheet = Image.new("RGB", (4 * 330, ((len(thumbs) + 3) // 4) * 330), (40, 40, 40))
    for k, im in enumerate(thumbs):
        sheet.paste(im.convert("RGB"), ((k % 4) * 330 + 5, (k // 4) * 330 + 5))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    made = {}
    for name, fn in TEXTURES.items():
        im = fn()
        path = OUTPUT_DIR / name
        if name.endswith(".jpg"):
            im.convert("RGB").save(path, quality=85, optimize=True)
        else:
            im.save(path, optimize=True)
        made[name] = im
        print(f"{name}: {im.size[0]}x{im.size[1]} {path.stat().st_size} bytes")
    if len(sys.argv) > 1:
        contact_sheet(made, Path(sys.argv[1]))


if __name__ == "__main__":
    main()
