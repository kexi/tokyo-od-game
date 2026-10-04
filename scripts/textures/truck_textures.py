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
"""Procedural textures for the trucks built by scripts/blender/truck.py (10t-class 3-axle
aluminium wing van and 8t 増トン flatbed).

Writes to assets/truck/textures/:
  truck_box.png     256x512   aluminium wing-body side panel, 1 m wide, tiled along the body
  truck_decals.png  1024x512  最大積載量 lettering, 大型後部反射器, grilles (atlas, alpha = mask)
  truck_plates.png  512x512   緑ナンバー 大板 for each truck (top: 10t, bottom: 8t)
  truck_wheel.png   512x256   steel disc wheel face (left) and tyre rubber (right)

Atlas rectangles are pixel boxes (x0, y0, x1, y1) from the top-left; truck.py keeps the same
table. No maker badge, operator name or logo; plate numbers are made up.

Usage:
    uv run scripts/textures/truck_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from bus_textures import contact_sheet, draw_wheel  # noqa: E402
from car_textures import draw_license_plate, get_noto_font  # noqa: E402

PROJECT_ROOT = SCRIPTS_DIR.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "truck" / "textures"

DECALS = {
    "load10": (0, 0, 512, 96),  # 最大積載量 13,500kg (10t-class wing van)
    "load8": (0, 96, 512, 192),  # 最大積載量 8,200kg (8t flatbed)
    "reflector": (512, 0, 1024, 128),  # 大型後部反射器 (one plate)
    "grille10": (0, 192, 512, 352),
    "grille8": (512, 192, 1024, 352),
    "steps": (0, 352, 256, 512),  # tread plate for the cab steps
}
PLATES = {"10t": (0, 0, 512, 256), "8t": (0, 256, 512, 512)}
LOAD_TEXT = {"load10": "最大積載量 13,500kg", "load8": "最大積載量 8,200kg"}


def generate_box() -> Image.Image:
    """One metre of wing-body side: top rail, smooth aluminium sheet with a panel joint at the
    left edge, the drop-side (アオリ) line low down and the bottom rail."""
    w, h = 256, 512
    img = Image.new("RGB", (w, h), (196, 200, 204))
    d = ImageDraw.Draw(img)
    for y in range(h):  # faint vertical sheen
        shade = 196 + int(8 * (1 - abs(y - h * 0.45) / (h * 0.55)))
        d.line([(0, y), (w, y)], fill=(shade, shade + 3, shade + 7))
    for x in range(0, w, 4):  # brushed grain
        if (x // 4) % 3 == 0:
            d.line([(x, 0), (x, h)], fill=(193, 197, 202))
    d.rectangle([0, 0, w, 22], fill=(150, 154, 160))  # top rail
    d.line([(0, 22), (w, 22)], fill=(110, 114, 120), width=2)
    d.rectangle([0, h - 30, w, h], fill=(150, 154, 160))  # bottom rail
    d.line([(0, h - 30), (w, h - 30)], fill=(110, 114, 120), width=2)
    d.line([(0, h - 104), (w, h - 104)], fill=(120, 124, 130), width=3)  # drop-side joint
    d.rectangle([0, 22, 3, h - 30], fill=(140, 144, 150))  # panel joint
    for y in (60, 250, 440):  # wing-panel hinge brackets at the joint
        d.rectangle([0, y, 10, y + 18], fill=(120, 124, 130))
    return img


def generate_decals() -> Image.Image:
    img = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for key, text in LOAD_TEXT.items():
        x0, y0, x1, y1 = DECALS[key]
        size = 60
        while get_noto_font(size, bold=True).getlength(text) > (x1 - x0) - 24:
            size -= 2
        font = get_noto_font(size, bold=True)
        d.text(((x0 + x1) / 2, (y0 + y1) / 2), text, font=font, fill=(24, 26, 30, 255), anchor="mm")
    # 大型後部反射器: red fluorescent and yellow retro-reflective diagonal stripes, black border.
    x0, y0, x1, y1 = DECALS["reflector"]
    w, h = x1 - x0, y1 - y0
    plate = Image.new("RGBA", (w, h), (250, 200, 20, 255))
    pd = ImageDraw.Draw(plate)
    stripe = 64
    for k in range(-2, w // stripe + 2):
        sx = k * stripe * 2
        pd.polygon([(sx, h), (sx + stripe, h), (sx + stripe + h, 0), (sx + h, 0)], fill=(214, 30, 36, 255))
    pd.rectangle([0, 0, w - 1, h - 1], outline=(20, 20, 22, 255), width=6)
    img.paste(plate, (x0, y0))
    # Grilles: dark horizontal slats in a satin frame (no badge).
    for key, slats in (("grille10", 7), ("grille8", 5)):
        x0, y0, x1, y1 = DECALS[key]
        d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(150, 154, 160, 255))
        d.rectangle([x0 + 10, y0 + 10, x1 - 11, y1 - 11], fill=(26, 28, 31, 255))
        pitch = (y1 - y0 - 20) / slats
        for k in range(slats):
            yy = y0 + 10 + k * pitch + pitch * 0.55
            d.rectangle([x0 + 14, yy, x1 - 15, yy + pitch * 0.28], fill=(88, 92, 98, 255))
    x0, y0, x1, y1 = DECALS["steps"]
    d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(120, 124, 128, 255))
    for yy in range(y0 + 8, y1, 16):
        for xx in range(x0 + 8 + ((yy // 16) % 2) * 8, x1, 16):
            d.line([(xx - 4, yy + 3), (xx + 4, yy - 3)], fill=(170, 174, 178, 255), width=3)
    return img


def generate_plates() -> Image.Image:
    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    img.paste(draw_license_plate("commercial", "品川", "100", "か", "58-26"), PLATES["10t"][:2])
    img.paste(draw_license_plate("commercial", "練馬", "100", "う", "70-38"), PLATES["8t"][:2])
    return img


def generate_wheel() -> Image.Image:
    # Trucks run white-painted steel disc wheels: 8 hand holes, 10 nuts (ISO), bare hub.
    return draw_wheel(face_colour=(226, 228, 228), holes=8, nuts=10, cap=(120, 124, 128))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    textures = {
        "truck_box.png": generate_box(),
        "truck_decals.png": generate_decals(),
        "truck_plates.png": generate_plates(),
        "truck_wheel.png": generate_wheel(),
    }
    for name, img in textures.items():
        out = OUTPUT_DIR / name
        img.save(out, "PNG", optimize=True)
        print(f"{out.relative_to(PROJECT_ROOT)} {img.width}x{img.height} {out.stat().st_size // 1024} KB")
    if len(sys.argv) > 1:
        contact_sheet(textures, Path(sys.argv[1]), "trucks")


if __name__ == "__main__":
    main()
