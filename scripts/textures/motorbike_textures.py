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
"""Procedural textures for the 250 cc motorcycle (軽二輪) built by scripts/blender/motorbike.py.

Writes to assets/motorbike/textures/:
  motorbike_plate.png  460x250  rear number plate, 230x125 mm at 2 px/mm (道路運送車両法施行規則
                                第14号様式 軽二輪: 自家用 = white ground, green characters, no frame;
                                top row 分類番号・地名・ひらがな, bottom row the four-digit number)
  motorbike_wheel.png  512x256  left: 10-spoke cast wheel face (alpha = gaps between spokes),
                                right: drilled brake disc (alpha = holes and the open centre)

The plate number is made up. Font: the pinned Noto Sans JP from car_textures.py.

Usage:
    uv run scripts/textures/motorbike_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from bus_textures import contact_sheet  # noqa: E402
from car_textures import get_noto_font  # noqa: E402

PROJECT_ROOT = SCRIPTS_DIR.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "motorbike" / "textures"
GREEN = (18, 96, 48, 255)


def glyph(ch: str, box_mm: tuple[float, float, float, float], k: int) -> tuple[Image.Image, tuple[int, int]]:
    """One character rendered large, cropped to its ink and fitted to box_mm (x0, y0, x1, y1);
    plate characters are condensed to fixed cells, so the glyph is stretched to the cell."""
    font = get_noto_font(200, bold=True)
    canvas = Image.new("L", (260, 260), 0)
    ImageDraw.Draw(canvas).text((130, 130), ch, font=font, fill=255, anchor="mm")
    ink = canvas.crop(canvas.getbbox())
    x0, y0, x1, y1 = (round(v * k) for v in box_mm)
    return ink.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS), (x0, y0)


def generate_plate() -> Image.Image:
    """軽二輪 plate after 第14号様式 (その一): 230 x 125 mm, rows 13-43 mm and 53-113 mm."""
    k = 2
    img = Image.new("RGBA", (230 * k, 125 * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, 230 * k - 1, 125 * k - 1], radius=8 * k, fill=(248, 250, 246, 255))
    ink = Image.new("RGBA", img.size, GREEN)
    cells = [
        ("1", (55, 13, 77, 43)),  # 分類番号
        ("品", (78, 13, 102, 43)),
        ("川", (103, 13, 127, 43)),
        ("さ", (150, 13, 175, 43)),  # ひらがな (自家用)
        ("4", (16.5, 53, 51.5, 113)),
        ("7", (62.5, 53, 97.5, 113)),
        ("1", (132.5, 53, 167.5, 113)),
        ("9", (178.5, 53, 213.5, 113)),
    ]
    for ch, box in cells:
        mask, pos = glyph(ch, box, k)
        img.paste(ink.crop((0, 0) + mask.size), pos, mask)
    d.rectangle([107.5 * k, 79 * k, 122.5 * k, 87 * k], fill=GREEN)  # hyphen
    for x in (40, 138.5):  # bolt holes in the top row
        cy = 28 * k
        d.ellipse([(x - 6) * k, cy - 6 * k, (x + 6) * k, cy + 6 * k], fill=(200, 204, 206, 255))
        d.ellipse([(x - 3) * k, cy - 3 * k, (x + 3) * k, cy + 3 * k], fill=(150, 154, 158, 255))
    return img


def generate_wheel() -> Image.Image:
    img = Image.new("RGBA", (512, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, R = 128, 127
    rim = (34, 36, 40, 255)
    # Rim band (outer 10 %), ten straight spokes, hub.
    d.ellipse([c - R, c - R, c + R, c + R], fill=rim)
    d.ellipse([c - R + 14, c - R + 14, c + R - 14, c + R - 14], fill=(0, 0, 0, 0))
    for kk in range(10):
        a = 2 * math.pi * kk / 10 + (0.08 if kk % 2 else -0.08)
        x1, y1 = c + (R - 10) * math.cos(a), c + (R - 10) * math.sin(a)
        d.line([(c, c), (x1, y1)], fill=rim, width=11)
    d.ellipse([c - 30, c - 30, c + 30, c + 30], fill=(60, 62, 66, 255))
    d.ellipse([c - 12, c - 12, c + 12, c + 12], fill=(150, 154, 158, 255))
    # Brake disc: steel ring with drilled holes, open centre with a carrier.
    c2 = 384
    d.ellipse([c2 - R, c - R, c2 + R, c + R], fill=(178, 182, 186, 255))
    d.ellipse([c2 - 78, c - 78, c2 + 78, c + 78], fill=(0, 0, 0, 0))
    for kk in range(24):
        a = 2 * math.pi * kk / 24
        rr = 100 + (8 if kk % 2 else -6)
        hx, hy = c2 + rr * math.cos(a), c + rr * math.sin(a)
        d.ellipse([hx - 5, hy - 5, hx + 5, hy + 5], fill=(0, 0, 0, 0))
    for kk in range(6):
        a = 2 * math.pi * kk / 6
        d.line([(c2, c), (c2 + 82 * math.cos(a), c + 82 * math.sin(a))], fill=(60, 62, 66, 255), width=12)
    d.ellipse([c2 - 34, c - 34, c2 + 34, c + 34], fill=(60, 62, 66, 255))
    return img


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    textures = {"motorbike_plate.png": generate_plate(), "motorbike_wheel.png": generate_wheel()}
    for name, img in textures.items():
        out = OUTPUT_DIR / name
        img.save(out, "PNG", optimize=True)
        print(f"{out.relative_to(PROJECT_ROOT)} {img.width}x{img.height} {out.stat().st_size // 1024} KB")
    if len(sys.argv) > 1:
        contact_sheet(textures, Path(sys.argv[1]), "motorbike")


if __name__ == "__main__":
    main()
