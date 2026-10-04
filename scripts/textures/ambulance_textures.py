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
"""Procedural texture generator for Tokyo Open Drive ambulance model.

Generates 4 ambulance decal and lightbar textures with reproducible procedural
techniques, fixed random seeds, and open-source licensed font (Noto Sans JP, SIL OFL 1.1).

Usage:
    uv run scripts/textures/ambulance_textures.py
    uv run scripts/textures/ambulance_textures.py <contact_sheet_preview.png>
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Dict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Ensure sibling texture modules can be imported
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from car_textures import get_noto_font  # noqa: E402

# Deterministic seed for reproducible procedural generation
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "ambulance" / "textures"

# Emergency Red according to Japanese ambulance design specifications
EMERGENCY_RED = (215, 38, 46, 255)  # #D7262E


def draw_text_with_tracking(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font,
    fill,
    tracking_px: int = 0,
) -> int:
    """Draw text with horizontal tracking (letter spacing) and return total width."""
    x, y = xy
    orig_x = x
    for char in text:
        draw.text((x, y), char, font=font, fill=fill)
        bbox = font.getbbox(char)
        char_width = bbox[2] - bbox[0] if bbox else 0
        x += char_width + tracking_px
    return x - orig_x - (tracking_px if text else 0)


def measure_text_with_tracking(text: str, font, tracking_px: int = 0) -> int:
    """Measure total width of text rendered with tracking."""
    total = 0
    for char in text:
        bbox = font.getbbox(char)
        char_width = bbox[2] - bbox[0] if bbox else 0
        total += char_width + tracking_px
    return max(0, total - (tracking_px if text else 0))


# ----------------------------------------------------------------------
# 1: Ambulance Side Decal (1024x256) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_ambulance_side(width: int = 1024, height: int = 256) -> Image.Image:
    """Generate side body decal with red thick/thin stripes and '救急 / AMBULANCE'."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Red stripes across the entire side
    thick_y0 = 136
    thick_y1 = 180
    draw.rectangle([0, thick_y0, width, thick_y1], fill=EMERGENCY_RED)

    thin_y0 = 194
    thin_y1 = 206
    draw.rectangle([0, thin_y0, width, thin_y1], fill=EMERGENCY_RED)

    # Large "救急" text near the front (left side)
    kanji_font = get_noto_font(72, bold=True)
    kanji_x = 64
    kanji_y = 22
    draw_text_with_tracking(draw, (kanji_x, kanji_y), "救急", kanji_font, fill=EMERGENCY_RED, tracking_px=16)

    # English subtitle "AMBULANCE" below "救急"
    latin_font = get_noto_font(24, bold=True)
    latin_x = 66
    latin_y = 96
    draw_text_with_tracking(draw, (latin_x, latin_y), "AMBULANCE", latin_font, fill=EMERGENCY_RED, tracking_px=6)

    return img


# ----------------------------------------------------------------------
# 2: Ambulance Hood Decal (512x128) - Mirrored RGBA Transparent
# ----------------------------------------------------------------------
def generate_ambulance_hood(width: int = 512, height: int = 128) -> Image.Image:
    """Generate hood decal with horizontally mirrored '救急' text for rearview mirrors."""
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    kanji_font = get_noto_font(84, bold=True)
    text = "救急"
    tracking = 24
    text_w = measure_text_with_tracking(text, kanji_font, tracking_px=tracking)
    text_x = (width - text_w) // 2

    bbox = kanji_font.getbbox(text[0])
    glyph_h = (bbox[3] - bbox[1]) if bbox else 72
    text_y = (height - glyph_h) // 2 - 4

    draw_text_with_tracking(draw, (text_x, text_y), text, kanji_font, fill=EMERGENCY_RED, tracking_px=tracking)

    # Mirror horizontally so preceding drivers see normal text in rearview mirror
    return canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT)


# ----------------------------------------------------------------------
# 3: Ambulance Rear Decal (512x256) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_ambulance_rear(width: int = 512, height: int = 256) -> Image.Image:
    """Generate rear door decal with stripes and centered '救急 / AMBULANCE'."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Red stripes across rear doors
    thick_y0 = 138
    thick_y1 = 174
    draw.rectangle([0, thick_y0, width, thick_y1], fill=EMERGENCY_RED)

    thin_y0 = 188
    thin_y1 = 198
    draw.rectangle([0, thin_y0, width, thin_y1], fill=EMERGENCY_RED)

    # Centered "救急"
    kanji_font = get_noto_font(66, bold=True)
    text_kanji = "救急"
    tracking_kanji = 18
    kw = measure_text_with_tracking(text_kanji, kanji_font, tracking_px=tracking_kanji)
    kx = (width - kw) // 2
    ky = 26
    draw_text_with_tracking(draw, (kx, ky), text_kanji, kanji_font, fill=EMERGENCY_RED, tracking_px=tracking_kanji)

    # Centered "AMBULANCE"
    latin_font = get_noto_font(21, bold=True)
    text_latin = "AMBULANCE"
    tracking_latin = 6
    lw = measure_text_with_tracking(text_latin, latin_font, tracking_px=tracking_latin)
    lx = (width - lw) // 2
    ly = 98
    draw_text_with_tracking(draw, (lx, ly), text_latin, latin_font, fill=EMERGENCY_RED, tracking_px=tracking_latin)

    return img


# ----------------------------------------------------------------------
# 4: Ambulance Lightbar (256x64) - Opaque Fresnel LED Lens / Emissive
# ----------------------------------------------------------------------
def generate_ambulance_lightbar(width: int = 256, height: int = 64) -> Image.Image:
    """Generate rooftop emergency red lightbar lens texture with LED nodes and reflectors."""
    # 1. Base deep ruby-red polycarbonate lens background
    y_coords, x_coords = np.mgrid[0:height, 0:width].astype(np.float32)

    # Vertical gradient: darker at top and bottom housing rims
    v_factor = np.sin((y_coords / height) * np.pi)
    base_r = 130.0 + 75.0 * (v_factor**0.8)
    base_g = 6.0 + 10.0 * (v_factor**1.2)
    base_b = 8.0 + 12.0 * (v_factor**1.2)

    # Subtle Fresnel vertical fluting/ribs on the outer lens (period of 4 pixels)
    fresnel_ribs = np.cos((x_coords / 4.0) * (2.0 * np.pi)) * 14.0
    base_r = np.clip(base_r + fresnel_ribs, 0.0, 255.0)

    # Lens edge bezel (top and bottom border shadow)
    bezel_mask = np.ones((height, width), dtype=np.float32)
    bezel_mask[0:3, :] *= 0.35
    bezel_mask[-3:, :] *= 0.35
    base_r *= bezel_mask
    base_g *= bezel_mask
    base_b *= bezel_mask

    rgb_base = np.stack([base_r, base_g, base_b], axis=-1).astype(np.uint8)
    img = Image.fromarray(rgb_base, "RGB").convert("RGBA")

    # 2. Procedural LED nodes and multi-faceted parabolic reflectors
    # 8 LED light emitter modules arranged horizontally
    num_leds = 8
    led_margin = 16
    led_spacing = (width - 2 * led_margin) / (num_leds - 1)
    led_cy = height // 2

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)

    # Draw reflector cups behind each LED
    reflector_radius_x = int(led_spacing * 0.44)
    reflector_radius_y = 22

    for i in range(num_leds):
        cx = int(led_margin + i * led_spacing)

        # Chrome/silver faceted parabolic reflector cup
        for rx in range(reflector_radius_x, 0, -2):
            ry = int(reflector_radius_y * (rx / reflector_radius_x))
            ref_shade = int(80 + 140 * math.cos((rx / reflector_radius_x) * math.pi * 1.5) ** 2)
            odraw.ellipse(
                [cx - rx, led_cy - ry, cx + rx, led_cy + ry],
                fill=(min(255, ref_shade + 60), int(ref_shade * 0.3), int(ref_shade * 0.3), 110),
            )

        # Concentric stepped prism rings around LED
        for step_r in [12, 8, 5]:
            odraw.ellipse(
                [cx - step_r, led_cy - int(step_r * 0.8), cx + step_r, led_cy + int(step_r * 0.8)],
                outline=(255, 140, 100, 160),
                width=1,
            )

        # High-intensity LED emitter die (white-hot core + intense crimson glow)
        odraw.ellipse([cx - 7, led_cy - 6, cx + 7, led_cy + 6], fill=(255, 60, 40, 220))
        odraw.ellipse([cx - 4, led_cy - 4, cx + 4, led_cy + 4], fill=(255, 190, 120, 240))
        odraw.ellipse([cx - 2, led_cy - 2, cx + 2, led_cy + 2], fill=(255, 250, 235, 255))

    # Apply slight bloom to overlay
    blurred_glow = overlay.filter(ImageFilter.GaussianBlur(1.2))
    img = Image.alpha_composite(img, overlay)
    img = Image.alpha_composite(img, blurred_glow)

    # 3. Micro-grain diffusion texture across the lens
    noise = np.random.uniform(-4.0, 4.0, (height, width, 3)).astype(np.float32)
    img_arr = np.array(img, dtype=np.float32)
    img_arr[:, :, :3] = np.clip(img_arr[:, :, :3] + noise, 0, 255)
    return Image.fromarray(img_arr.astype(np.uint8), "RGBA")


# ----------------------------------------------------------------------
# Contact Sheet Generator
# ----------------------------------------------------------------------
def generate_contact_sheet(textures: Dict[str, Image.Image], output_path: Path) -> None:
    """Generate a clean contact sheet preview for inspection with checkerboard backgrounds."""
    sheet_w, sheet_h = 1200, 780
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (26, 28, 32, 255))
    draw = ImageDraw.Draw(sheet)

    title_font = get_noto_font(26, bold=True)
    label_font = get_noto_font(15, bold=True)
    sub_font = get_noto_font(12, bold=False)

    # Header
    draw.text((36, 20), "Tokyo Open Drive - Ambulance Texture Sheet", font=title_font, fill=(240, 244, 248, 255))
    draw.text(
        (36, 56),
        "High-Standard Ambulance (高規格救急車) Decals & Rooftop Lightbar",
        font=sub_font,
        fill=(160, 172, 184, 255),
    )

    items = [
        (
            "ambulance_side.png",
            textures["ambulance_side.png"],
            36,
            86,
            1128,
            180,
            "1. ambulance_side.png (1024x256) - 車体側面帯・救急/AMBULANCE（透過デカール）",
        ),
        (
            "ambulance_hood.png",
            textures["ambulance_hood.png"],
            36,
            316,
            540,
            135,
            "2. ambulance_hood.png (512x128) - ボンネット用 鏡文字「救急」（透過デカール）",
        ),
        (
            "ambulance_rear.png",
            textures["ambulance_rear.png"],
            624,
            316,
            540,
            240,
            "3. ambulance_rear.png (512x256) - 後面ドア帯・救急/AMBULANCE（透過デカール）",
        ),
        (
            "ambulance_lightbar.png",
            textures["ambulance_lightbar.png"],
            36,
            500,
            540,
            135,
            "4. ambulance_lightbar.png (256x64) - 屋根赤色警光灯レンズ/発光マップ（不透明）",
        ),
    ]

    for _name, img_item, x, y, max_dw, max_dh, caption in items:
        checker = Image.new("RGBA", (max_dw, max_dh), (42, 45, 50, 255))
        cdraw = ImageDraw.Draw(checker)
        sq = 12
        for cy in range(0, max_dh, sq):
            for cx in range(0, max_dw, sq):
                if (cx // sq + cy // sq) % 2 == 0:
                    cdraw.rectangle([cx, cy, cx + sq - 1, cy + sq - 1], fill=(54, 58, 65, 255))

        iw, ih = img_item.size
        scale = min(max_dw / iw, max_dh / ih)
        target_w = int(iw * scale)
        target_h = int(ih * scale)
        resized = img_item.resize((target_w, target_h), resample=Image.Resampling.LANCZOS)

        paste_x = (max_dw - target_w) // 2
        paste_y = (max_dh - target_h) // 2
        checker.paste(resized, (paste_x, paste_y), mask=resized if resized.mode == "RGBA" else None)

        cdraw.rectangle([0, 0, max_dw - 1, max_dh - 1], outline=(70, 76, 88, 255), width=1)
        sheet.paste(checker, (x, y))

        draw.text((x, y + max_dh + 6), caption, font=label_font, fill=(220, 230, 240, 255))
        draw.text(
            (x, y + max_dh + 26),
            f"Original: {iw}x{ih} px  |  Format: {img_item.mode}",
            font=sub_font,
            fill=(150, 160, 175, 255),
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(str(output_path), "PNG", optimize=True)
    print(f"[OK] Saved contact sheet: {output_path}")


# ----------------------------------------------------------------------
# Main Execution Entry Point
# ----------------------------------------------------------------------
def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating ambulance textures for Tokyo Open Drive...")

    generators = {
        "ambulance_side.png": generate_ambulance_side,
        "ambulance_hood.png": generate_ambulance_hood,
        "ambulance_rear.png": generate_ambulance_rear,
        "ambulance_lightbar.png": generate_ambulance_lightbar,
    }

    textures: Dict[str, Image.Image] = {}

    for filename, gen_fn in generators.items():
        print(f"Generating {filename}...")
        img = gen_fn()
        textures[filename] = img
        out_path = OUTPUT_DIR / filename
        img.save(str(out_path), "PNG", optimize=True)
        file_size_kb = out_path.stat().st_size / 1024
        print(f"  -> Saved {out_path.name} ({img.width}x{img.height}, {img.mode}, {file_size_kb:.1f} KB)")

    # Contact sheet output if argument provided
    if len(sys.argv) > 1:
        contact_sheet_path = Path(sys.argv[1])
        print(f"Generating contact sheet preview at {contact_sheet_path}...")
        generate_contact_sheet(textures, contact_sheet_path)

    print("\nAll ambulance textures generated successfully!")


if __name__ == "__main__":
    main()
