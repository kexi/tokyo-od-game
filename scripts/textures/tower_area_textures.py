# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural textures for the buildings around Tokyo Tower (scripts/blender/tower_area.py).

Drawn from geometry and fixed seeds only: no photos, fonts, logos or lettering. Each facade map is
one repeating tile of a whole number of window bays by floors (sizes in metres are in TILES and are
the UV units of scripts/blender/tower_area.py). The *_night maps are emissive textures: the lit
rooms (warm, a little cooler for the office) on black, so a Light_<mode>_<part> material multiplies
them by its emission colour. Two night maps per hotel (evening / late night) light different
fractions of the same rooms, so windows go dark rather than move.

Usage:
    uv run scripts/textures/tower_area_textures.py               # write assets/landmarks/textures/ta_*
    uv run scripts/textures/tower_area_textures.py sheet.png     # also save a contact sheet
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SEED = 20261110
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "landmarks" / "textures"

# name: (pixels w, h, metres w, h). Bays x floors per tile, chosen so the repeat is not obvious on
# a facade: the hotel tower 16 bays x 8 floors, the 1964 hotel 8 x 8, the 1966 office 16 x 4.
TILES = {
    "hotel_south": (1024, 1024, 28.8, 25.2),  # bay 1.8 m, floor 3.15 m (102 m / 33 floors, ground floors aside)
    "hotel_east": (512, 1024, 16.0, 26.4),  # bay 2.0 m, floor 3.3 m
    "hall_north": (1024, 1024, 28.8, 16.0),  # bay 1.8 m, floor 4.0 m
    "kawara": (256, 256, 1.2, 1.2),  # 4 rows of round tiles (丸瓦) 0.3 m apart
}


def rng(salt: int) -> np.random.Generator:
    return np.random.default_rng(SEED + salt)


def noise(w: int, h: int, cells: int, salt: int) -> np.ndarray:
    """Tileable value noise in 0..1 (bilinear over a periodic grid of cells x cells)."""
    g = rng(salt).random((cells, cells))
    y, x = np.mgrid[0:h, 0:w]
    fx, fy = x / w * cells, y / h * cells
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = g[y0 % cells, x0 % cells]
    b = g[y0 % cells, (x0 + 1) % cells]
    c = g[(y0 + 1) % cells, x0 % cells]
    d = g[(y0 + 1) % cells, (x0 + 1) % cells]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def img(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def rooms(n_bays: int, n_floors: int, per_room: int, salt: int) -> np.ndarray:
    """A random rank 0..1 per room (bays grouped by per_room); a room is lit when rank < fraction."""
    r = rng(salt).random((n_floors, math.ceil(n_bays / per_room)))
    return np.repeat(r, per_room, axis=1)[:, :n_bays]


def lit_colour(salt: int, n: tuple[int, int], warm=(255, 214, 160), cool=(236, 236, 226)) -> np.ndarray:
    """Per-room lamp colour: mostly warm, some cooler (different lamps and curtains)."""
    t = rng(salt).random(n)[..., None]
    return np.array(warm) * (1 - t * 0.6) + np.array(cool) * (t * 0.6)


# ----------------------------------------------------------------------------- hotel tower (1)
def hotel_south(kind: str) -> Image.Image:
    """Curtain wall of the 2005 hotel tower: white aluminium mullions every bay, a light floor band,
    blue-grey glass with a vertical sky gradient (photos: Commons 2010–2014)."""
    w, h, _, _ = TILES["hotel_south"]
    bays, floors = 16, 8
    bw, fh = w // bays, h // floors
    y, x = np.mgrid[0:h, 0:w]
    bx, fy = x % bw, y % fh
    mullion = (bx < 4) | (bx >= bw - 2) | (((x // bw) % 2 == 0) & (bx < 12))  # wide fin every room
    band = fy >= fh - 22  # spandrel at the floor slab (bottom of each floor in image rows)
    rank = rooms(bays, floors, 2, 1)
    fi, bi = y // fh, x // bw
    if kind == "day":
        sky = 0.55 + 0.45 * (1 - fy / fh)
        n = noise(w, h, 16, 2)
        glass = np.stack([92 + 40 * sky + 20 * n, 122 + 44 * sky + 18 * n, 150 + 48 * sky + 14 * n], -1)
        curtain = rank[fi, bi] < 0.3  # half-drawn sheers, lighter
        glass = np.where(curtain[..., None] & (fy < fh * 0.75)[..., None], glass * 0.6 + 200 * 0.4, glass)
        out = np.where(band[..., None], np.array([196, 204, 210]), glass)
        out = np.where(mullion[..., None], np.array([232, 236, 238]), out)
        return img(out)
    frac = 0.48 if kind == "evening" else 0.2
    on = (rank[fi, bi] < frac) & ~mullion & ~band & (fy > 6)
    col = lit_colour(3, (floors, bays))[fi, bi]
    shade = 0.75 + 0.25 * noise(w, h, 32, 4)[..., None]  # curtains and lamps inside the room
    return img(np.where(on[..., None], col * shade, 0))


# ----------------------------------------------------------------------------- hotel (2), 1964
def hotel_east(kind: str) -> Image.Image:
    """Punched windows of the 1964 hotel slab: warm white precast frame, a deep vertical fin between
    rooms, dark glass with curtains (photos: Commons 2023–2026)."""
    w, h, _, _ = TILES["hotel_east"]
    bays, floors = 8, 8
    bw, fh = w // bays, h // floors
    y, x = np.mgrid[0:h, 0:w]
    bx, fy = x % bw, y % fh
    win = (bx > 9) & (bx < bw - 9) & (fy > 26) & (fy < fh - 22)
    fin = bx < 5
    rank = rooms(bays, floors, 1, 11)
    fi, bi = y // fh, x // bw
    if kind == "day":
        n = noise(w, h, 12, 12)
        wall = np.stack([212 + 14 * n, 205 + 13 * n, 190 + 12 * n], -1)
        wall = np.where(fin[..., None], wall * 0.86, wall)
        curtain = (rank[fi, bi] < 0.3)[..., None]
        glass = np.where(curtain, np.array([132, 128, 120]), np.array([58, 66, 76]))
        sill = (fy >= fh - 22) & (fy < fh - 17) & (bx > 6) & (bx < bw - 6)
        out = np.where(win[..., None], glass, wall)
        out = np.where(sill[..., None], wall * 0.7, out)
        return img(out)
    frac = 0.45 if kind == "evening" else 0.18
    on = (rank[fi, bi] < frac) & win
    col = lit_colour(13, (floors, bays))[fi, bi]
    return img(np.where(on[..., None], col, 0))


# ----------------------------------------------------------------------------- office, 1966
def hall_north(kind: str) -> Image.Image:
    """Ribbon windows between precast concrete spandrels of the 1966 office (beige, photos: Commons
    2012–2022): spandrel 1.6 m, window 2.4 m with a mullion every 1.8 m."""
    w, h, _, _ = TILES["hall_north"]
    bays, floors = 16, 4
    bw, fh = w // bays, h // floors
    y, x = np.mgrid[0:h, 0:w]
    bx, fy = x % bw, y % fh
    spandrel = fy >= int(fh * 0.5)  # lower half of the floor (image rows grow downwards)
    mullion = (bx < 3) | (((x // bw) % 2 == 0) & (bx < 10))  # thin mullions, a precast pier every 2 bays
    rank = rooms(bays, floors, 2, 21)
    fi, bi = y // fh, x // bw
    if kind == "day":
        n = noise(w, h, 24, 22)
        concrete = np.stack([200 + 16 * n, 191 + 15 * n, 168 + 14 * n], -1)
        lip = (fy >= int(fh * 0.5)) & (fy < int(fh * 0.5) + 6)
        sky = 0.5 + 0.5 * (1 - fy / (fh * 0.5))
        glass = np.stack([62 + 34 * sky, 60 + 32 * sky, 54 + 30 * sky], -1)
        out = np.where(spandrel[..., None], concrete, glass)
        out = np.where((mullion & ~spandrel)[..., None], concrete * 0.92, out)
        out = np.where(lip[..., None], concrete * 0.72, out)
        return img(out)
    frac = 0.5 if kind == "evening" else 0.1
    on = (rank[fi, bi] < frac) & ~spandrel & ~mullion & (fy > 4)
    col = lit_colour(23, (floors, bays), warm=(240, 236, 220), cool=(220, 232, 240))[fi, bi]
    return img(np.where(on[..., None], col, 0))


# ----------------------------------------------------------------------------- 本瓦葺 roof tiles
def kawara() -> Image.Image:
    """Hongawara: round tiles (丸瓦) running down the slope every 0.3 m over flat tiles (平瓦), with
    the courses' lower edges every 0.3 m. u along the eave, v up the slope. Grey, lit from above."""
    w, h, mw, _ = TILES["kawara"]
    y, x = np.mgrid[0:h, 0:w]
    pitch = w / (mw / 0.3)
    u = (x % pitch) / pitch  # 0..1 across one round tile
    ridge = np.clip(1 - ((u - 0.5) / 0.28) ** 2, 0, 1)  # the round tile's profile
    shade = np.where(ridge > 0, 0.82 + 0.38 * np.sqrt(ridge) * (1 - u), 0.62 + 0.1 * np.sin(u * math.pi))
    course = (y % (h / 4)) / (h / 4)
    shade = shade * (0.88 + 0.12 * course)  # each course a little darker at its lower edge
    n = noise(w, h, 16, 31)
    g = 40 + 110 * shade + 10 * n
    return img(np.stack([g * 0.98, g, g * 1.04], -1))


TEXTURES = {
    "ta_hotel_south_day.jpg": lambda: hotel_south("day"),
    "ta_hotel_south_evening.jpg": lambda: hotel_south("evening"),
    "ta_hotel_south_late.jpg": lambda: hotel_south("late"),
    "ta_hotel_east_day.jpg": lambda: hotel_east("day"),
    "ta_hotel_east_evening.jpg": lambda: hotel_east("evening"),
    "ta_hotel_east_late.jpg": lambda: hotel_east("late"),
    "ta_hall_north_day.jpg": lambda: hall_north("day"),
    "ta_hall_north_evening.jpg": lambda: hall_north("evening"),
    "ta_hall_north_late.jpg": lambda: hall_north("late"),
    "ta_kawara.jpg": kawara,
}


def contact_sheet(images: dict[str, Image.Image], path: Path) -> None:
    cell = 320
    cols = 4
    rows = math.ceil(len(images) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 16)), (40, 44, 52))
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(images.items()):
        thumb = im.copy()
        thumb.thumbnail((cell - 8, cell - 8))
        x, y = (i % cols) * cell, (i // cols) * (cell + 16)
        sheet.paste(thumb, (x + 4, y + 4))
        d.text((x + 4, y + cell), name, fill=(230, 230, 230))
    sheet.save(path)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    made = {}
    for name, fn in TEXTURES.items():
        im = fn()
        path = OUTPUT_DIR / name
        im.save(path, quality=86, optimize=True)
        made[name] = im
        print(f"{name}: {im.size[0]}x{im.size[1]} {path.stat().st_size} bytes")
    if len(sys.argv) > 1:
        contact_sheet(made, Path(sys.argv[1]))


if __name__ == "__main__":
    main()
