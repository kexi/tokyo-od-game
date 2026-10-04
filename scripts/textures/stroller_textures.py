# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural textures for the A-type stroller (scripts/blender/stroller.py).

Two images, fixed seed, no fonts, no external pictures, no brand marks:

- stroller_fabric.png (512x512, single-channel greyscale on white): the game recolours the fabric through the
  material's baseColorFactor, so this only carries shading. Left half = the seat hammock
  (quilted diamonds; u across the seat from wall to wall, v from the footrest up to the top of the
  backrest), right half = the canopy (plain weave with a seam on each bow; u from the back bow to
  the front bow, v round the arch from the left hinge over the top to the right hinge).
- stroller_wheel.png (128x64, single-channel greyscale): left square = the hub face with five spokes
  (planar on the wheel side, so the game's wheel spin is visible), right square = the tyre tread
  (u round the circumference, v across the width).

Usage:
    uv run scripts/textures/stroller_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SEED = 42
RNG = np.random.default_rng(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "stroller" / "textures"


def weave(h: int, w: int, amplitude: float) -> np.ndarray:
    """Soft fabric mottling: low-frequency blurred noise (fine grain would only bloat the PNG and
    is lost at street distance anyway)."""
    noise = RNG.normal(0.0, 1.0, (h // 8, w // 8)).astype(np.float32)
    img = Image.fromarray(np.uint8(np.clip(128 + noise * 40, 0, 255)), "L")
    img = img.resize((w, h), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(4))
    return amplitude * (np.asarray(img, dtype=np.float32) - 128.0) / 40.0


def seat_half(h: int = 512, w: int = 256) -> np.ndarray:
    """Quilted seat: diamond cushions that puff up between stitched seams."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # About 9 cm diamonds: the seat is ~0.57 m across (u) and ~0.95 m long (v).
    pu, pv = 40.0, 48.0
    a = (xx / pu + yy / pv) % 1.0
    b = (xx / pu - yy / pv) % 1.0
    puff = (np.sin(math.pi * a) * np.sin(math.pi * b)) ** 0.5
    val = 196.0 + 54.0 * puff
    # Stitch dashes along the seams.
    seam = np.minimum(np.minimum(a, 1 - a), np.minimum(b, 1 - b))
    dash = (np.floor((xx + yy) / 3.0) % 2) == 0
    val = np.where((seam < 0.035) & dash, 150.0, val)
    # Piping-free edges: a soft darker band where the side walls meet the piping (u = 0 and u = 1).
    edge = np.clip(1.0 - np.minimum(xx, w - 1 - xx) / 10.0, 0.0, 1.0)
    val -= 30.0 * edge
    return val + weave(h, w, 2.5)


def canopy_half(h: int = 512, w: int = 256) -> np.ndarray:
    """Canopy: plain water-repellent weave, a stitched seam at each bow, darker inner rim."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    val = np.full((h, w), 238.0, dtype=np.float32)
    # Panels between the bows bulge slightly (shading across u), seams at the bows.
    bows = 3
    t = (xx / w) * bows % 1.0
    val -= 14.0 * (1.0 - np.sin(math.pi * t))
    for k in range(bows + 1):
        x = k * w / bows
        near = np.abs(xx - x) < 2.0
        dash = (np.floor(yy / 4.0) % 2) == 0
        val = np.where(near & dash, 168.0, val)
    # Edge hem along both hinges (v = 0, v = 1) and the back edge (u = 0).
    hem = np.clip(1.0 - np.minimum(yy, h - 1 - yy) / 14.0, 0.0, 1.0)
    val -= 26.0 * hem
    back = np.clip(1.0 - xx / 10.0, 0.0, 1.0)
    val -= 20.0 * back
    return val + weave(h, w, 2.0)


def generate_fabric() -> Image.Image:
    arr = np.concatenate([seat_half(), canopy_half()], axis=1)
    return Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "L")


def generate_wheel() -> Image.Image:
    """Hub face (left) and tyre tread (right), 4x supersampled for clean spokes."""
    s = 4
    img = Image.new("L", (128 * s, 64 * s), 0)
    d = ImageDraw.Draw(img)
    c, r = 32 * s, 31 * s
    # Hub: tyre sidewall ring, dark rim gap, light plastic hub with five spokes.
    d.ellipse([c - r, c - r, c + r, c + r], fill=46)
    rim = int(r * 0.80)
    d.ellipse([c - rim, c - rim, c + rim, c + rim], fill=150)
    inner = int(r * 0.70)
    d.ellipse([c - inner, c - inner, c + inner, c + inner], fill=34)
    for k in range(5):
        ang = 2 * math.pi * k / 5 + math.pi / 2
        half = math.radians(13)
        pts = [(c, c)]
        for da in (-half, half):
            pts.append((c + inner * math.cos(ang + da), c + inner * math.sin(ang + da)))
        d.polygon(pts, fill=176)
    cap = int(r * 0.26)
    d.ellipse([c - cap, c - cap, c + cap, c + cap], fill=205)
    axle = int(r * 0.08)
    d.ellipse([c - axle, c - axle, c + axle, c + axle], fill=90)
    # Tread: dark rubber with transverse grooves (u = circumference, 12 lugs per turn).
    x0 = 64 * s
    d.rectangle([x0, 0, 128 * s, 64 * s], fill=40)
    for k in range(12):
        x = x0 + int((k + 0.5) * 64 * s / 12)
        d.rectangle([x - s, 10 * s, x + s, 54 * s], fill=24)
    d.rectangle([x0, 0, 128 * s, 6 * s], fill=52)
    d.rectangle([x0, 58 * s, 128 * s, 64 * s], fill=52)
    return img.resize((128, 64), Image.Resampling.LANCZOS)


def contact_sheet(textures: dict[str, Image.Image], path: Path) -> None:
    sheet = Image.new("RGB", (1100, 560), (30, 32, 36))
    x = 20
    for img in textures.values():
        scale = 512 / max(img.size)
        im = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.NEAREST)
        sheet.paste(im, (x, 24))
        x += im.width + 30
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    print(f"[OK] contact sheet: {path}")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    textures = {"stroller_fabric.png": generate_fabric(), "stroller_wheel.png": generate_wheel()}
    for name, img in textures.items():
        out = OUTPUT_DIR / name
        img.save(out, "PNG", optimize=True)
        print(f"  -> {out.relative_to(PROJECT_ROOT)} ({img.width}x{img.height}, {out.stat().st_size / 1024:.1f} KB)")
    if len(sys.argv) > 1:
        contact_sheet(textures, Path(sys.argv[1]))


if __name__ == "__main__":
    main()
