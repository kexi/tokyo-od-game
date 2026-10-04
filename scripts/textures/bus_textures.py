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
"""Procedural textures for the large city route bus (大型路線バス, scripts/blender/bus.py).

Writes to assets/bus/textures/:
  bus_dest.png    1024x256  LED destination displays (front / side / rear) as one atlas
  bus_decals.png  2048x512  livery (side band, front and rear skirts), stickers, engine louvres
  bus_plate.png    512x256  緑ナンバー 大板 (440x220 mm, 事業用: green ground, white characters)
  bus_wheel.png    512x256  steel disc wheel face (left half) and tyre rubber (right half)

The atlas rectangles are pixel boxes (x0, y0, x1, y1) from the top-left; scripts/blender/bus.py
keeps an identical table. Generic livery only (no operator name, emblem or real route code), the
plate number is made up, fonts are the pinned Noto Sans JP from car_textures.py.

Usage:
    uv run scripts/textures/bus_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from car_textures import draw_license_plate, get_noto_font  # noqa: E402

PROJECT_ROOT = SCRIPTS_DIR.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "bus" / "textures"

# Atlas layout shared with scripts/blender/bus.py (pixels, origin top-left).
DEST = {"front": (0, 0, 1024, 160), "side": (0, 160, 512, 256), "rear": (512, 160, 896, 256)}
DECALS = {
    "side": (0, 0, 2048, 320),  # left edge = front of the bus, bottom edge = 0.25 m above ground
    "front": (0, 320, 768, 512),
    "rear": (768, 320, 1536, 512),
    "nonstep": (1536, 320, 2048, 384),
    "entry": (1536, 384, 1664, 448),
    "exit": (1664, 384, 1792, 448),
    "oneman": (1792, 384, 2048, 448),
    "louvre": (1536, 448, 2048, 512),
}
# Livery geometry in metres, shared with bus.py: the decal band covers y = 0.25 → 1.25 m.
BAND_Y0, BAND_Y1 = 0.25, 1.25
TEAL = (22, 124, 128, 255)
CORAL = (229, 96, 63, 255)
AMBER = (255, 150, 30)
WHITE_LED = (235, 240, 255)


def wave_top(t: float) -> float:
    """Height (m) of the teal skirt at fraction t of the length (0 = front, 1 = rear)."""
    return 0.62 + 0.30 * (0.5 - 0.5 * math.cos(math.pi * min(1.0, max(0.0, (t - 0.25) / 0.7))))


# ---------------------------------------------------------------------------- LED displays


def led_panel(size, pitch, items, off=(24, 18, 14)):
    """Dot-matrix panel. items: (text, x, y, height, colour, bold) in dots; text is rasterised at
    4x and each dot lights when its block is mostly covered (regular weight: bold merges)."""
    w, h = size
    cols, rows = w // pitch, h // pitch
    sx = 4
    mask_rgb = Image.new("RGB", (cols * sx, rows * sx), (0, 0, 0))
    md = ImageDraw.Draw(mask_rgb)
    for text, x, y, hd, colour, bold in items:
        font = get_noto_font(int(hd * sx * 1.12), bold=bold)
        md.text((x * sx, y * sx), text, font=font, fill=colour, anchor="lt")
    arr = np.asarray(mask_rgb).astype(np.float32)
    img = Image.new("RGB", (w, h), (8, 8, 10))
    draw = ImageDraw.Draw(img)
    glow = Image.new("RGB", (w, h), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = pitch * 0.34
    ox, oy = (w - cols * pitch) / 2, (h - rows * pitch) / 2
    for row in range(rows):
        for col in range(cols):
            block = arr[row * sx : (row + 1) * sx, col * sx : (col + 1) * sx]
            cov = block.max(axis=2).mean() / 255.0
            cx, cy = ox + (col + 0.5) * pitch, oy + (row + 0.5) * pitch
            if cov > 0.35:
                c = tuple(int(v) for v in block.reshape(-1, 3).max(axis=0))
                draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
                gd.ellipse([cx - r * 1.8, cy - r * 1.8, cx + r * 1.8, cy + r * 1.8], fill=tuple(v // 3 for v in c))
            else:
                draw.ellipse([cx - r * 0.8, cy - r * 0.8, cx + r * 0.8, cy + r * 0.8], fill=off)
    return _add(img, glow)


def _add(a: Image.Image, b: Image.Image) -> Image.Image:
    """Additive bloom: blurred glow on top of the dots."""
    s = np.asarray(a).astype(np.int32) + np.asarray(b.filter(ImageFilter.GaussianBlur(1.2))).astype(np.int32)
    return Image.fromarray(np.clip(s, 0, 255).astype(np.uint8))


def generate_dest() -> Image.Image:
    """Front: route number, 経由 line and destination; side: one line; rear: number + destination."""
    atlas = Image.new("RGB", (1024, 256), (8, 8, 10))
    x0, y0, x1, y1 = DEST["front"]
    front = led_panel(
        (x1 - x0, y1 - y0),
        4,
        [
            ("41", 7, 4, 31, AMBER, False),
            ("日比谷・虎ノ門 経由", 72, 1, 13, WHITE_LED, False),
            ("新橋駅前", 72, 15, 24, AMBER, False),
            ("行", 226, 24, 14, AMBER, False),
        ],
    )
    fd = ImageDraw.Draw(front)
    fd.rectangle([2, 2, 66 * 4 - 2, 157], outline=(120, 70, 20), width=2)  # route-number frame
    atlas.paste(front, (x0, y0))
    x0, y0, x1, y1 = DEST["side"]
    atlas.paste(
        led_panel((x1 - x0, y1 - y0), 4, [("41", 3, 3, 17, AMBER, False), ("新橋駅前 行", 30, 4, 15, AMBER, False)]),
        (x0, y0),
    )
    x0, y0, x1, y1 = DEST["rear"]
    atlas.paste(
        led_panel((x1 - x0, y1 - y0), 4, [("41", 4, 2, 19, AMBER, False), ("新橋駅前", 34, 6, 13, AMBER, False)]),
        (x0, y0),
    )
    return atlas


# ---------------------------------------------------------------------------- livery and stickers


def generate_decals() -> Image.Image:
    img = Image.new("RGBA", (2048, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def band(box, t0, t1):
        """Teal skirt + coral pin line for the stretch t0 → t1 of the length, across box."""
        x0, y0, x1, y1 = box
        h = y1 - y0
        for x in range(x0, x1):
            t = t0 + (t1 - t0) * (x - x0 + 0.5) / (x1 - x0)
            top = wave_top(t)
            to_px = lambda m: y1 - (m - BAND_Y0) / (BAND_Y1 - BAND_Y0) * h  # noqa: E731
            d.line([(x, to_px(top)), (x, y1 - 1)], fill=TEAL)
            d.line([(x, to_px(top + 0.10)), (x, to_px(top + 0.07))], fill=CORAL)

    band(DECALS["side"], 0.0, 1.0)
    # Front and rear skirts: the band at its front (t = 0) / rear (t = 1) height across the face.
    band(DECALS["front"], 0.0, 0.0)
    band(DECALS["rear"], 1.0, 1.0)

    def sticker(key, text, colour, size, bold=True):
        x0, y0, x1, y1 = DECALS[key]
        font = get_noto_font(size, bold=bold)
        d.text(((x0 + x1) / 2, (y0 + y1) / 2), text, font=font, fill=colour, anchor="mm")

    sticker("nonstep", "ノンステップバス", TEAL, 44)
    for key, text in (("entry", "入口"), ("exit", "出口")):
        x0, y0, x1, y1 = DECALS[key]
        d.rounded_rectangle([x0 + 6, y0 + 6, x1 - 6, y1 - 6], radius=8, fill=(250, 250, 248, 255))
        sticker(key, text, (30, 34, 40, 255), 40)
    sticker("oneman", "ワンマン", (30, 34, 40, 255), 40)
    x0, y0, x1, y1 = DECALS["louvre"]
    d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(40, 42, 46, 255))
    for x in range(x0 + 4, x1 - 4, 12):
        d.rectangle([x, y0 + 4, x + 6, y1 - 5], fill=(12, 13, 15, 255))
        d.line([(x + 7, y0 + 4), (x + 7, y1 - 5)], fill=(78, 82, 88, 255))
    return img


# ---------------------------------------------------------------------------- plate and wheel


def generate_plate() -> Image.Image:
    # 大型自動車の大板 (440x220 mm) has the same 2:1 layout as the 中板 drawn by car_textures.
    return draw_license_plate("commercial", "品川", "200", "か", "37-15")


def draw_wheel(face_colour=(214, 217, 220), holes=8, nuts=10, cap=(150, 154, 160)) -> Image.Image:
    """Left 256x256: steel disc wheel seen face-on (rim lip, hand holes, nut ring, hub cap).
    Right 256x256: tyre rubber with circumferential grooves (u across the tread)."""
    img = Image.new("RGBA", (512, 256), (24, 25, 28, 255))
    d = ImageDraw.Draw(img)
    c, R = 128, 127
    d.ellipse([c - R, c - R, c + R, c + R], fill=(150, 154, 158, 255))  # rim lip
    d.ellipse([c - R + 10, c - R + 10, c + R - 10, c + R - 10], fill=(96, 99, 104, 255))  # well shadow
    d.ellipse([c - R + 18, c - R + 18, c + R - 18, c + R - 18], fill=face_colour + (255,))
    for k in range(holes):
        a = 2 * math.pi * (k + 0.5) / holes
        hx, hy = c + 72 * math.cos(a), c + 72 * math.sin(a)
        d.ellipse([hx - 17, hy - 12, hx + 17, hy + 12], fill=(30, 31, 34, 255))
    d.ellipse([c - 52, c - 52, c + 52, c + 52], fill=tuple(int(v * 0.9) for v in face_colour) + (255,))
    for k in range(nuts):
        a = 2 * math.pi * k / nuts
        nx, ny = c + 40 * math.cos(a), c + 40 * math.sin(a)
        d.regular_polygon((nx, ny, 7), 6, fill=(120, 124, 128, 255), outline=(70, 72, 76, 255))
    d.ellipse([c - 26, c - 26, c + 26, c + 26], fill=cap + (255,), outline=(90, 94, 98, 255), width=3)
    d.ellipse([c - 10, c - 10, c + 10, c + 10], fill=tuple(int(v * 1.15) for v in cap) + (255,))
    # Tyre: dark rubber, four grooves running round the tyre (vertical in the atlas).
    for x in (300, 345, 423, 468):
        d.rectangle([x, 0, x + 7, 255], fill=(12, 12, 14, 255))
    d.rectangle([256, 0, 268, 255], fill=(30, 31, 34, 255))
    d.rectangle([500, 0, 511, 255], fill=(30, 31, 34, 255))
    return img


def generate_wheel() -> Image.Image:
    return draw_wheel()


# ---------------------------------------------------------------------------- contact sheet / main


def contact_sheet(textures: dict[str, Image.Image], path: Path, title: str = "route bus") -> None:
    sheet = Image.new("RGBA", (1300, 1080), (26, 28, 32, 255))
    d = ImageDraw.Draw(sheet)
    d.text((24, 16), f"Tokyo Open Drive - {title} textures", font=get_noto_font(24, bold=True), fill=(240, 240, 240))
    y = 60
    for name, img in textures.items():
        scale = min(1250 / img.width, 300 / img.height)
        im = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
        checker = Image.new("RGBA", im.size, (60, 64, 70, 255))
        cd = ImageDraw.Draw(checker)
        for cy in range(0, im.height, 12):
            for cx in range(0, im.width, 12):
                if (cx // 12 + cy // 12) % 2 == 0:
                    cd.rectangle([cx, cy, cx + 11, cy + 11], fill=(80, 84, 90, 255))
        checker.alpha_composite(im.convert("RGBA"))
        sheet.paste(checker, (24, y))
        d.text(
            (24, y + im.height + 4), f"{name} {img.width}x{img.height}", font=get_noto_font(14), fill=(210, 210, 210)
        )
        y += im.height + 30
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    textures = {
        "bus_dest.png": generate_dest(),
        "bus_decals.png": generate_decals(),
        "bus_plate.png": generate_plate(),
        "bus_wheel.png": generate_wheel(),
    }
    for name, img in textures.items():
        out = OUTPUT_DIR / name
        img.save(out, "PNG", optimize=True)
        print(f"{out.relative_to(PROJECT_ROOT)} {img.width}x{img.height} {out.stat().st_size // 1024} KB")
    if len(sys.argv) > 1:
        contact_sheet(textures, Path(sys.argv[1]))


if __name__ == "__main__":
    main()
