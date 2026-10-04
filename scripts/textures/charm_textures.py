# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
#     "requests>=2.31.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Textures for the mirror charms (scripts/blender/mirror_charms.py).

omamori.png  512 × 512: the お守り pouch's brocade, front on the left half and back on the right.
             Purple ground with a gold 七宝 (interlocking circles) weave, a generic pattern
             centuries old; the front carries 「交通安全」 down its middle as gold satin-stitch
             embroidery. No shrine or temple name, mark or crest anywhere.
plush_fur_normal.png  256 × 256: a tileable normal map of short tufts for the plush bear's fur,
             from wrapped random strokes (so it tiles by construction).

Text uses only the pinned Noto Sans JP (SIL OFL 1.1) through car_textures.get_noto_font.

Usage:
    uv run scripts/textures/charm_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from car_textures import get_noto_font  # noqa: E402

PROJECT_ROOT = SCRIPTS_DIR.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "charms" / "textures"

# The pouch is 44 × 66 mm (charmRig.ts OMAMORI): each face gets a 256 × 384 px panel (5.8 px/mm)
# in a 256 × 512 half, the panel's top at y 64 (the knot and the folded top sit above it).
HALF = 256
PANEL = (0, 64, 256, 448)
PURPLE = (74, 34, 92)
PURPLE_DARK = (46, 20, 60)
GOLD = (214, 172, 74)
GOLD_BRIGHT = (240, 204, 110)
GOLD_DARK = (92, 62, 18)
RNG = np.random.default_rng(20261005)


def weave(size: tuple[int, int]) -> np.ndarray:
    """Fine twill of the silk: a diagonal rib every 3 px plus thread noise, 0–1."""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    rib = 0.5 + 0.5 * np.sin((xx + yy) * (2 * math.pi / 3.0))
    noise = RNG.normal(0, 1, (h, w))
    return np.clip(0.75 + 0.12 * rib + 0.06 * noise, 0, 1)


def shippo(size: tuple[int, int], cell: int) -> Image.Image:
    """七宝: circles of radius `cell` on a square grid of pitch `cell`, overlapping into petals."""
    w, h = size
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    for gy in range(-1, h // cell + 2):
        for gx in range(-1, w // cell + 2):
            cx, cy = gx * cell, gy * cell
            d.ellipse((cx - cell, cy - cell, cx + cell, cy + cell), outline=255, width=3)
    # A small gold dot where four circles meet.
    for gy in range(-1, h // cell + 2):
        for gx in range(-1, w // cell + 2):
            cx, cy = gx * cell + cell // 2, gy * cell + cell // 2
            d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=255)
    return mask


def brocade(size: tuple[int, int]) -> Image.Image:
    """Purple silk with the gold pattern woven in (the gold threads catch a little more light)."""
    w, h = size
    base = np.array(weave(size))[..., None]
    ground = np.array(PURPLE, dtype=np.float64) * base
    gold = np.array(shippo(size, 32), dtype=np.float64)[..., None] / 255.0
    # Gold threads float over every other weft: a broken, slightly lighter line.
    yy, xx = np.mgrid[0:h, 0:w]
    float_ = (0.85 + 0.15 * ((xx // 2 + yy) % 2))[..., None]
    # Woven in at half strength: the pattern stays behind the embroidered words.
    rgb = ground * (1 - gold * 0.5) + np.array(GOLD) * float_ * gold * 0.5
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def embroidery(text: str, box: tuple[int, int, int, int]) -> tuple[Image.Image, Image.Image]:
    """Vertical text in satin stitch: (colour, mask). The stitches run across each stroke."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    step = h // len(text)
    font = get_noto_font(int(step * 0.86), bold=True)
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for i, ch in enumerate(text):
        left, top, right, bottom = font.getbbox(ch)
        cx = (w - (right - left)) // 2 - left
        cy = i * step + (step - (bottom - top)) // 2 - top
        d.text((cx, cy), ch, font=font, fill=255)
    # Satin stitch: thread highlights in short diagonal bands, darker where threads part.
    yy, xx = np.mgrid[0:h, 0:w]
    sheen = 0.88 + 0.12 * np.sin((xx * 0.9 - yy * 0.45) * 1.3)
    colour = np.array(GOLD_BRIGHT, dtype=np.float64) * sheen[..., None]
    # A dark outline stitch round each stroke.
    outline = np.array(mask.filter(ImageFilter.MaxFilter(5)), dtype=np.float64) / 255.0
    inner = np.array(mask, dtype=np.float64) / 255.0
    rgb = colour * inner[..., None] + np.array(GOLD_DARK, dtype=np.float64) * ((outline - inner)[..., None])
    alpha = np.clip(outline * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB"), Image.fromarray(alpha, "L")


def omamori() -> Image.Image:
    img = Image.new("RGB", (HALF * 2, 512), PURPLE_DARK)
    for side in (0, 1):
        x = side * HALF
        face = brocade((HALF, PANEL[3] - PANEL[1]))
        # Darker towards the seams: the pouch is a little padded, its edges turn away.
        edge = Image.new("L", face.size, 255)
        ImageDraw.Draw(edge).rounded_rectangle((0, 0, face.size[0] - 1, face.size[1] - 1), 18, outline=150, width=10)
        face = ImageChops.multiply(face, Image.merge("RGB", [edge.filter(ImageFilter.GaussianBlur(8))] * 3))
        img.paste(face, (x, PANEL[1]))
        # The folded top above the panel (the cord's knot sits on it): plain dark silk.
        top = brocade((HALF, PANEL[1]))
        img.paste(ImageChops.multiply(top, Image.new("RGB", top.size, (150, 150, 150))), (x, 0))
        img.paste(ImageChops.multiply(top, Image.new("RGB", top.size, (150, 150, 150))), (x, PANEL[3]))
    # A plain band down the front's middle, edged with a gold line, and 「交通安全」 on it as large as
    # the band allows.
    band = (70, PANEL[1] + 22, 186, PANEL[3] - 22)
    d = ImageDraw.Draw(img)
    d.rectangle(band, fill=PURPLE_DARK)
    d.rectangle(band, outline=GOLD, width=3)
    colour, mask = embroidery("交通安全", (band[0] + 8, band[1] + 12, band[2] - 8, band[3] - 12))
    img.paste(colour, (band[0] + 8, band[1] + 12), mask)
    return img


def fur_normal(size: int = 256) -> Image.Image:
    """Height field of short random tufts (wrapped at the edges), then its normals."""
    h = np.zeros((size, size))
    for _ in range(2600):
        x, y = RNG.uniform(0, size, 2)
        a = RNG.normal(-math.pi / 2, 0.6)  # tufts lie mostly one way, as brushed plush does
        length = RNG.uniform(5, 12)
        for t in np.linspace(0, 1, 10):
            px = int(x + math.cos(a) * length * t) % size
            py = int(y + math.sin(a) * length * t) % size
            h[py, px] += 1.0 - 0.6 * t
    # Wrapped blur (tile 3 × 3, blur, crop) keeps it seamless.
    tile = Image.fromarray(np.tile(h / h.max() * 255, (3, 3)).astype(np.uint8), "L")
    tile = tile.filter(ImageFilter.GaussianBlur(1.4))
    hh = np.array(tile, dtype=np.float64)[size : 2 * size, size : 2 * size] / 255.0
    dx = (np.roll(hh, -1, 1) - np.roll(hh, 1, 1)) * 2.2
    dy = (np.roll(hh, -1, 0) - np.roll(hh, 1, 0)) * 2.2
    n = np.dstack([-dx, dy, np.ones_like(hh)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8), "RGB")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet = []
    for name, img in (("omamori.png", omamori()), ("plush_fur_normal.png", fur_normal())):
        img.save(OUTPUT_DIR / name, optimize=True)
        sheet.append(img)
        print(f'{{"event": "texture", "file": "{name}", "size": [{img.width}, {img.height}]}}')
    if len(sys.argv) > 1:
        w = sum(i.width for i in sheet)
        contact = Image.new("RGB", (w, max(i.height for i in sheet)), (40, 40, 40))
        x = 0
        for i in sheet:
            contact.paste(i, (x, 0))
            x += i.width
        contact.save(sys.argv[1])


if __name__ == "__main__":
    main()
