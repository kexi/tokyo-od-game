# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural textures of the elevated expressway (src/world/deckSurface.ts), by Claude Code (P4).

Writes to assets/expressway/textures/:
1. porous_asphalt_albedo.jpg + porous_asphalt_nrm.png: the deck's surface course, porous asphalt
   (排水性舗装, 13 mm open grading: a stone skeleton with ~20 % voids). 1024 px = 4 m.
2. concrete_albedo.jpg + concrete_nrm.png: cast-in-place concrete of the 壁高欄, the slab's edge,
   the box girder and the piers: 0.9 × 1.8 m formwork panels (型枠) with their joints and the
   form-tie holes (セパ穴), mottling, and in the alpha channel the rain streaks (雨だれ) the shader
   hangs from each face's top edge. 1024 px = 3.6 m (two panels across, four up).

The `_nrm` textures pack the normal's x/y (R/G), roughness (B) and a mask (A) into one fetch
(texture_noise.packed_image). Colours from the PLATEAU reading in knowledge/road-textures.md; no
PLATEAU pixels are used. A generic design: no operator's colours, emblems or lettering.

Usage:
    uv run scripts/textures/expressway_textures.py
    uv run scripts/textures/expressway_textures.py <contact_sheet_preview.png>
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from texture_noise import check_seamless, fft_noise, packed_image, rgb_image, stones

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "expressway" / "textures"
SIZE = 1024

# Mean sRGB of each surface (knowledge/road-textures.md「読み取った値」).
POROUS_RGB = (68.0, 68.0, 67.0)
CONCRETE_RGB = (132.0, 130.0, 124.0)
SEED = 2611


def porous_asphalt() -> tuple[Image.Image, Image.Image]:
    """Porous asphalt: coarse stones touching each other, open voids between them.

    How: two stone sizes dense enough to cover ~80 % (5–13 mm at 3.9 mm/px), the rest voids that
    are dark and deep in the height (the normal map shows the open texture at a few metres). Darker
    and more even in tone than the dense-graded surface, as the binder coats every stone.
    """
    big_h, big_t = stones(SIZE, 30000, 2.6, SEED)
    mid_h, mid_t = stones(SIZE, 50000, 1.7, SEED + 1)
    stone_h = np.maximum(big_h, mid_h * 0.9)
    tone = np.where(big_h >= mid_h * 0.9, big_t, mid_t)
    meso = fft_noise(SIZE, 1.7, SEED + 2)
    micro = fft_noise(SIZE, 0.8, SEED + 3)
    isVoid = stone_h < 0.08
    height = np.where(isVoid, 0.0, 0.35 + stone_h * 0.65)
    shade = (1.0 + (meso - 0.5) * 0.08 + (micro - 0.5) * 0.10) * np.where(
        isVoid, 0.72, 1.0 + (tone - 1.0) * 0.12 + np.sqrt(stone_h) * 0.06
    )
    shade = shade / shade.mean()
    albedo = rgb_image(*(shade * c for c in POROUS_RGB))
    rough = np.clip(np.where(isVoid, 1.0, 0.9 - stone_h * 0.08), 0, 1)
    return albedo, packed_image(height, 1.6, rough)


def concrete() -> tuple[Image.Image, Image.Image]:
    """Formed concrete: panels, joints, tie holes, mottling; rain streaks in the alpha.

    The image's v is up the face (the shader projects it on world y), u along it. Panels are 0.9 m
    tall and 1.8 m wide, laid in courses offset by half a panel as formwork usually is; joints are
    a 3 mm fin of grout (light) with a dark line beside it.
    """
    px_per_m = SIZE / 3.6
    macro = fft_noise(SIZE, 2.3, SEED + 10)
    meso = fft_noise(SIZE, 1.5, SEED + 11)
    pores = fft_noise(SIZE, 0.6, SEED + 12)
    joints = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(joints)
    panel_h = 0.9 * px_per_m
    panel_w = 1.8 * px_per_m
    holes = Image.new("L", (SIZE, SIZE), 0)
    hole_draw = ImageDraw.Draw(holes)
    for course in range(4):
        y = round(course * panel_h)
        draw.line([(0, y), (SIZE, y)], fill=255, width=2)
        offset = (course % 2) * panel_w / 2
        for k in range(3):
            x = round((offset + k * panel_w) % SIZE)
            draw.line([(x, y), (x, round(y + panel_h))], fill=255, width=2)
        # Two rows of tie holes per panel course, every 0.45 m along (25 mm cones).
        for row in (0.25, 0.75):
            hy = y + row * panel_h
            for k in range(8):
                hx = (offset + 0.225 * px_per_m + k * 0.45 * px_per_m) % SIZE
                hole_draw.ellipse([hx - 3.5, hy - 3.5, hx + 3.5, hy + 3.5], fill=255)
    # The pattern repeats exactly in the tile (4 courses, 2 panels); rolled by a quarter panel so no
    # joint lies on the border, where the seam check would take the joint for a seam.
    shift = (int(panel_h / 4), int(panel_w / 4))
    joint = np.roll(np.asarray(joints, dtype=np.float32) / 255.0, shift, axis=(0, 1))
    hole = np.roll(np.asarray(holes, dtype=np.float32) / 255.0, shift, axis=(0, 1))
    # Each panel a little different in tone (pours and form oil), constant within it.
    rng = np.random.default_rng(SEED + 13)
    panel_tone = np.zeros((SIZE, SIZE), dtype=np.float32)
    for course in range(4):
        y0 = int(round(course * panel_h))
        y1 = int(round((course + 1) * panel_h))
        offset = (course % 2) * panel_w / 2
        for k in range(3):
            tone = rng.uniform(-0.04, 0.04)
            x0 = offset + k * panel_w
            cols = (np.arange(SIZE) - x0) % SIZE < panel_w
            panel_tone[y0:y1, cols] = tone
    panel_tone = np.roll(panel_tone, shift, axis=(0, 1))
    streak_cols = fft_noise(SIZE, 1.1, SEED + 14, aspect=(1.0, 14.0))
    streak_len = fft_noise(SIZE, 2.0, SEED + 15, aspect=(1.0, 3.0))
    streaks = np.clip((streak_cols - 0.52) * 3.2, 0, 1) * (0.55 + 0.45 * streak_len)
    shade = (
        1.0
        + (macro - 0.5) * 0.10
        + (meso - 0.5) * 0.06
        + (pores - 0.5) * 0.08
        + panel_tone
        - joint * 0.10
        - hole * 0.35
    )
    shade = shade / shade.mean()
    albedo = rgb_image(*(shade * c for c in CONCRETE_RGB))
    height = (meso - 0.5) * 0.15 + (pores - 0.5) * 0.25 - joint * 0.6 - hole * 1.0
    rough = np.clip(0.88 + (pores - 0.5) * 0.08 - joint * 0.1, 0, 1)
    return albedo, packed_image(height, 2.5, rough, extra=streaks)


def contact_sheet(textures: dict[str, Image.Image], out: Path) -> None:
    """Each map beside its 2 × 2 tiling (the seams would show in the middle of the right one)."""
    thumb, tiled, margin = 256, 384, 16
    sheet = Image.new("RGB", (thumb + tiled + margin * 3, (tiled + margin * 2) * len(textures)), (26, 28, 32))
    draw = ImageDraw.Draw(sheet)
    for i, (name, img) in enumerate(textures.items()):
        y = i * (tiled + margin * 2) + margin
        rgb = img.convert("RGB")
        draw.text((margin, y - 12), name, fill=(230, 220, 160))
        sheet.paste(rgb.resize((thumb, thumb), Image.Resampling.LANCZOS), (margin, y + 64))
        grid = Image.new("RGB", (SIZE * 2, SIZE * 2))
        for ty in range(2):
            for tx in range(2):
                grid.paste(rgb, (tx * SIZE, ty * SIZE))
        sheet.paste(grid.resize((tiled, tiled), Image.Resampling.LANCZOS), (margin * 2 + thumb, y))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"Saved contact sheet to {out}")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    porous_albedo, porous_nrm = porous_asphalt()
    concrete_albedo, concrete_nrm = concrete()
    textures = {
        "porous_asphalt_albedo.jpg": porous_albedo,
        "porous_asphalt_nrm.png": porous_nrm,
        "concrete_albedo.jpg": concrete_albedo,
        "concrete_nrm.png": concrete_nrm,
    }
    for name, img in textures.items():
        check_seamless(name, img)
    for name, img in textures.items():
        path = OUTPUT_DIR / name
        isJpeg = name.endswith(".jpg")
        if isJpeg:
            img.save(path, format="JPEG", quality=90, optimize=True)
        else:
            img.save(path, format="PNG", optimize=True)
        print(f"  - {name:28s}: {path.stat().st_size / 1024:7.1f} KB")
    if len(sys.argv) > 1:
        contact_sheet(textures, Path(sys.argv[1]).resolve())


if __name__ == "__main__":
    main()
