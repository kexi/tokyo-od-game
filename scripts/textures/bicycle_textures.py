# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural textures for the Tokyo Open Drive bicycles (scripts/blender/bicycle.py).

basket.png: the wire mesh of the ママチャリ front basket, white-based (the model multiplies it by
the material colour) with the gaps transparent; the model uses it as a glTF alpha MASK. It tiles:
8 cells of 8 px, and bicycle.py maps 0.2 m of basket onto one texture width (2.5 cm cells).

Usage:
    uv run scripts/textures/bicycle_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "bicycle" / "textures"

SIZE = 64
PITCH = 8  # px per mesh cell
WIRE = 3  # px wire thickness: wide enough that the averaged alpha of a far mip stays above the 0.5 cut


def generate_basket() -> Image.Image:
    """Square wire grid; the wires are slightly rounded (bright core, darker edges)."""
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    # Distance from the nearest wire centre line, horizontally and vertically.
    dx = np.abs(((x + 0.5) % PITCH) - PITCH / 2)
    dy = np.abs(((y + 0.5) % PITCH) - PITCH / 2)
    half = WIRE / 2
    on_v = dx <= half
    on_h = dy <= half
    alpha = (on_v | on_h).astype(np.float32)
    # Shade across each wire: 1 at the centre line, 0.72 at the edge; crossings stay bright.
    shade_v = 1.0 - 0.28 * (dx / half) ** 2
    shade_h = 1.0 - 0.28 * (dy / half) ** 2
    shade = np.where(on_v & on_h, np.maximum(shade_v, shade_h), np.where(on_v, shade_v, shade_h))
    grey = np.clip(shade * 245.0, 0, 255).astype(np.uint8)
    rgba = np.dstack([grey, grey, grey, (alpha * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def contact_sheet(img: Image.Image, path: Path) -> None:
    sheet = Image.new("RGBA", (SIZE * 4, SIZE * 4), (40, 44, 52, 255))
    big = img.resize((SIZE * 4, SIZE * 4), Image.Resampling.NEAREST)
    sheet.alpha_composite(big)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    print(f"[OK] contact sheet: {path}")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    img = generate_basket()
    out = OUTPUT_DIR / "basket.png"
    img.save(out, "PNG", optimize=True)
    print(f"[OK] {out.name} {img.width}x{img.height} {out.stat().st_size / 1024:.1f} KB")
    if len(sys.argv) > 1:
        contact_sheet(img, Path(sys.argv[1]))


if __name__ == "__main__":
    main()
