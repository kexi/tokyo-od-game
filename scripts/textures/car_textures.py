# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
#     "requests>=2.31.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural texture generator for Tokyo Open Drive car models.

Generates 9 vehicle textures with reproducible procedural techniques,
fixed random seeds, and open-source licensed fonts (Noto Sans JP, SIL OFL 1.1).
"""

from __future__ import annotations

import math
import os
import random
import sys
from pathlib import Path
from typing import Dict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Set deterministic seed for all procedural generation
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TEXTURES_DIR = PROJECT_ROOT / "assets" / "car" / "textures"
# Noto Sans JP (SIL OFL 1.1) pinned to a google/fonts commit and checked by hash, so every run
# draws the same glyphs. No system-font fallback: macOS fonts (Hiragino, Helvetica) are not
# licensed for redistribution, and a silent fallback would change the committed textures.
FONT_URL = (
    "https://raw.githubusercontent.com/google/fonts/295d98a7a0c17c68f1341eaeea354e7960ea70d3/"
    "ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
)
FONT_SHA256 = "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f"
FONT_CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "tokyo-od-game" / "fonts"


def _font_file() -> Path:
    import hashlib

    font_path = FONT_CACHE_DIR / "NotoSansJP-VariableFont_wght.ttf"
    if not font_path.exists():
        import requests

        FONT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        headers = {"User-Agent": "tokyo-od-game-asset-gen/1.0 (+https://github.com/kexi/tokyo-od-game)"}
        resp = requests.get(FONT_URL, headers=headers, timeout=60)
        resp.raise_for_status()
        font_path.write_bytes(resp.content)
    digest = hashlib.sha256(font_path.read_bytes()).hexdigest()
    if digest != FONT_SHA256:
        raise RuntimeError(f"unexpected font hash {digest} for {font_path}")
    return font_path


def get_noto_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Noto Sans JP at `size` px; the variable font's weight axis gives the bold variant."""
    font = ImageFont.truetype(str(_font_file()), size)
    try:
        font.set_variation_by_axes([700 if bold else 400])
    except (OSError, ValueError):
        pass  # FreeType without variation support: default (regular) instance
    return font


def get_latin_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Latin text uses the same OFL font (Noto Sans JP covers Latin)."""
    return get_noto_font(size, bold)


# ----------------------------------------------------------------------
# 1 & 2: License Plates
# ----------------------------------------------------------------------
def draw_license_plate(
    plate_type: str = "private",
    place_text: str = "品川",
    class_code: str = "330",
    hiragana: str = "さ",
    number_text: str = "12-34",
    width: int = 512,
    height: int = 256,
) -> Image.Image:
    """Generate a Japanese license plate (standard 330x165mm ratio, 2:1).

    plate_type: 'private' (white ground, green text) or 'commercial' (green ground, white text).
    """
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin_x = 16
    margin_y = 8
    pw = width - 2 * margin_x
    ph = height - 2 * margin_y
    rect = [margin_x, margin_y, margin_x + pw, margin_y + ph]
    radius = 12

    if plate_type == "private":
        text_color = (18, 96, 48, 255)
        border_color = (20, 102, 50, 255)
        emboss_shadow = (200, 208, 200, 255)
        emboss_high = (255, 255, 255, 255)
    else:  # commercial
        text_color = (248, 250, 248, 255)
        border_color = (235, 240, 235, 255)
        emboss_shadow = (8, 48, 26, 255)
        emboss_high = (60, 130, 80, 255)

    # Base plate background with subtle metallic/enamel gradient
    for y in range(margin_y, margin_y + ph):
        t = (y - margin_y) / ph
        if plate_type == "private":
            r = int(248 - 6 * t)
            g = int(250 - 6 * t)
            b = int(246 - 6 * t)
        else:
            r = int(12 + 4 * t)
            g = int(88 - 10 * t)
            b = int(46 - 6 * t)
        draw.line([(margin_x, y), (margin_x + pw, y)], fill=(r, g, b, 255))

    # Mask to rounded rectangle
    mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(rect, radius=radius, fill=255)

    # Border (stamped outer ridge)
    border_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(border_layer)
    bdraw.rounded_rectangle(
        [margin_x + 6, margin_y + 6, margin_x + pw - 6, margin_y + ph - 6],
        radius=radius - 4,
        outline=border_color,
        width=5,
    )

    # Text rendering on separate layer for crisp emboss effect
    text_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(text_layer)

    # Fonts
    font_top = get_noto_font(44, bold=True)
    font_hira = get_noto_font(60, bold=True)
    font_num = get_noto_font(110, bold=True)

    # Japanese license plate coordinates
    top_y = margin_y + 46
    pos_place = (margin_x + 190, top_y)
    pos_class = (margin_x + 310, top_y)

    bot_y = margin_y + 152
    pos_hira = (margin_x + 68, bot_y)
    pos_num = (margin_x + 295, bot_y)

    tdraw.text(pos_place, place_text, font=font_top, fill=text_color, anchor="mm")
    tdraw.text(pos_class, class_code, font=font_top, fill=text_color, anchor="mm")
    tdraw.text(pos_hira, hiragana, font=font_hira, fill=text_color, anchor="mm")
    tdraw.text(pos_num, number_text, font=font_num, fill=text_color, anchor="mm")

    # Emboss layer (slight displacement)
    shadow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow_layer)
    sdraw.text((pos_place[0] + 1, pos_place[1] + 2), place_text, font=font_top, fill=emboss_shadow, anchor="mm")
    sdraw.text((pos_class[0] + 1, pos_class[1] + 2), class_code, font=font_top, fill=emboss_shadow, anchor="mm")
    sdraw.text((pos_hira[0] + 1, pos_hira[1] + 2), hiragana, font=font_hira, fill=emboss_shadow, anchor="mm")
    sdraw.text((pos_num[0] + 2, pos_num[1] + 3), number_text, font=font_num, fill=emboss_shadow, anchor="mm")

    high_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(high_layer)
    hdraw.text((pos_place[0] - 1, pos_place[1] - 1), place_text, font=font_top, fill=emboss_high, anchor="mm")
    hdraw.text((pos_class[0] - 1, pos_class[1] - 1), class_code, font=font_top, fill=emboss_high, anchor="mm")
    hdraw.text((pos_hira[0] - 1, pos_hira[1] - 1), hiragana, font=font_hira, fill=emboss_high, anchor="mm")
    hdraw.text((pos_num[0] - 1, pos_num[1] - 2), number_text, font=font_num, fill=emboss_high, anchor="mm")

    # Bolts & Seal
    bolt_left_x = margin_x + 92
    bolt_y = margin_y + 45
    bolt_right_x = margin_x + pw - 92

    # Draw seal on left
    draw.ellipse(
        [bolt_left_x - 14, bolt_y - 14, bolt_left_x + 14, bolt_y + 14],
        fill=(175, 180, 185, 255),
        outline=(120, 125, 130, 255),
        width=2,
    )
    draw.ellipse([bolt_left_x - 9, bolt_y - 9, bolt_left_x + 9, bolt_y + 9], fill=(215, 220, 225, 255))
    font_seal = get_noto_font(12, bold=True)
    draw.text((bolt_left_x, bolt_y), "東", font=font_seal, fill=(110, 115, 120, 255), anchor="mm")

    # Draw regular bolt on right (hex/plus head)
    draw.ellipse(
        [bolt_right_x - 12, bolt_y - 12, bolt_right_x + 12, bolt_y + 12],
        fill=(180, 185, 190, 255),
        outline=(120, 125, 130, 255),
        width=2,
    )
    draw.ellipse([bolt_right_x - 8, bolt_y - 8, bolt_right_x + 8, bolt_y + 8], fill=(205, 210, 215, 255))
    draw.line([(bolt_right_x - 6, bolt_y), (bolt_right_x + 6, bolt_y)], fill=(110, 115, 120, 255), width=2)
    draw.line([(bolt_right_x, bolt_y - 6), (bolt_right_x, bolt_y + 6)], fill=(110, 115, 120, 255), width=2)

    # Composite all layers with mask
    plate_composite = Image.alpha_composite(img, border_layer)
    plate_composite = Image.alpha_composite(plate_composite, shadow_layer)
    plate_composite = Image.alpha_composite(plate_composite, high_layer)
    plate_composite = Image.alpha_composite(plate_composite, text_layer)

    final_img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    final_img.paste(plate_composite, (0, 0), mask=mask)
    return final_img


# ----------------------------------------------------------------------
# 3: Taxi Roof Sign (512x256)
# ----------------------------------------------------------------------
def generate_taxi_sign(width: int = 512, height: int = 256) -> Image.Image:
    """Generate illuminated taxi roof sign (Andon) texture with high emissive contrast."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    margin_x = 20
    margin_y = 16
    sw = width - 2 * margin_x
    sh = height - 2 * margin_y
    rect = [margin_x, margin_y, margin_x + sw, margin_y + sh]
    radius = 32

    # Housing / illuminated acrylic gradient
    cx, cy = width // 2, height // 2
    for y in range(height):
        for x in range(width):
            if margin_x <= x <= margin_x + sw and margin_y <= y <= margin_y + sh:
                dx = (x - cx) / (sw / 2)
                dy = (y - cy) / (sh / 2)
                d = math.sqrt(dx * dx * 0.7 + dy * dy * 1.1)
                intensity = max(0.0, min(1.0, 1.0 - 0.28 * d))
                r = int(255 * (0.93 + 0.07 * intensity))
                g = int(252 * (0.91 + 0.09 * intensity))
                b = int(225 * (0.86 + 0.14 * intensity))
                img.putpixel((x, y), (r, g, b, 255))

    # Mask to rounded sign shape
    mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(rect, radius=radius, fill=255)

    masked_base = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    masked_base.paste(img, (0, 0), mask=mask)

    # Outer bezel & neat decorative header/footer lines
    bdraw = ImageDraw.Draw(masked_base)
    bdraw.rounded_rectangle(rect, radius=radius, outline=(38, 40, 44, 255), width=6)
    bdraw.rounded_rectangle(
        [margin_x + 4, margin_y + 4, margin_x + sw - 4, margin_y + sh - 4],
        radius=radius - 3,
        outline=(170, 175, 180, 255),
        width=2,
    )

    # Accent navy lines
    bdraw.line([(margin_x + 36, margin_y + 36), (margin_x + sw - 36, margin_y + 36)], fill=(16, 38, 90, 255), width=4)
    bdraw.line(
        [(margin_x + 36, margin_y + sh - 36), (margin_x + sw - 36, margin_y + sh - 36)], fill=(16, 38, 90, 255), width=4
    )

    # Main text: "TAXI" bold & high contrast
    font_taxi = get_latin_font(98, bold=True)
    font_sub = get_noto_font(28, bold=True)

    text_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(text_layer)

    # "TAXI"
    tdraw.text((cx, cy - 12), "TAXI", font=font_taxi, fill=(15, 24, 48, 255), anchor="mm")
    # "個人"
    tdraw.text((cx, cy + 62), "個　人", font=font_sub, fill=(20, 30, 58, 255), anchor="mm")

    final = Image.alpha_composite(masked_base, text_layer)
    return final


# ----------------------------------------------------------------------
# 4: Vacancy Sign (256x64) - Crisp LED Matrix Display
# ----------------------------------------------------------------------
def generate_vacancy_sign(width: int = 256, height: int = 64) -> Image.Image:
    """Generate taxi dashboard vacancy (空車) crisp LED matrix display."""
    img = Image.new("RGBA", (width, height), (12, 14, 16, 255))
    draw = ImageDraw.Draw(img)

    # Outer bezel & frame
    draw.rectangle([0, 0, width - 1, height - 1], outline=(36, 38, 42, 255), width=2)
    draw.rectangle([2, 2, width - 3, height - 3], outline=(20, 22, 24, 255), width=1)

    # 64x16 dot matrix
    grid_cols = 64
    grid_rows = 16
    dot_spacing_x = (width - 16) / grid_cols
    dot_spacing_y = (height - 12) / grid_rows
    start_x = 8
    start_y = 6
    dot_radius = 1.3

    # High-resolution rasterization
    scale = 4
    hr_w = grid_cols * scale
    hr_h = grid_rows * scale
    hr_img = Image.new("L", (hr_w, hr_h), 0)
    hr_draw = ImageDraw.Draw(hr_img)
    font = get_noto_font(int(hr_h * 0.88), bold=False)  # bold glyphs merge into blobs on the LED grid
    hr_draw.text((hr_w // 2, hr_h // 2 - 1), "空 車", font=font, fill=255, anchor="mm")

    # Inactive LED background grid
    for r in range(grid_rows):
        for c in range(grid_cols):
            x = start_x + c * dot_spacing_x + dot_spacing_x / 2
            y = start_y + r * dot_spacing_y + dot_spacing_y / 2
            draw.ellipse([x - dot_radius, y - dot_radius, x + dot_radius, y + dot_radius], fill=(28, 14, 14, 255))

    # Active LED rendering with bloom
    glow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)

    for r in range(grid_rows):
        for c in range(grid_cols):
            block = hr_img.crop((c * scale, r * scale, (c + 1) * scale, (r + 1) * scale))
            avg_val = np.mean(np.array(block))
            if avg_val > 60:
                x = start_x + c * dot_spacing_x + dot_spacing_x / 2
                y = start_y + r * dot_spacing_y + dot_spacing_y / 2
                intensity = min(1.0, avg_val / 200.0)

                glow_draw.ellipse([x - 3.5, y - 3.5, x + 3.5, y + 3.5], fill=(255, 20, 20, int(90 * intensity)))
                draw.ellipse(
                    [x - dot_radius - 0.2, y - dot_radius - 0.2, x + dot_radius + 0.2, y + dot_radius + 0.2],
                    fill=(255, 35, 35, 255),
                )
                draw.ellipse(
                    [x - dot_radius * 0.45, y - dot_radius * 0.45, x + dot_radius * 0.45, y + dot_radius * 0.45],
                    fill=(255, 210, 190, 255),
                )

    glow_blurred = glow_layer.filter(ImageFilter.GaussianBlur(radius=1.8))
    result = Image.alpha_composite(img, glow_blurred)
    return result


# ----------------------------------------------------------------------
# 5: Tire Tread (512x128) - Horizontally Seamless
# ----------------------------------------------------------------------
def generate_tire_tread(width: int = 512, height: int = 128) -> Image.Image:
    """Generate horizontally seamless procedural tire tread texture."""
    arr = np.zeros((height, width), dtype=np.float32)
    arr.fill(0.85)

    # 4 deep longitudinal circumferential grooves
    groove_positions = [24, 48, 80, 104]
    groove_half_width = 4.0

    for gy in groove_positions:
        for y in range(height):
            dist = abs(y - gy)
            if dist < groove_half_width:
                depth_factor = 1.0 - (dist / groove_half_width) ** 2
                arr[y, :] -= depth_factor * 0.75

    # Lateral angled sipes & tread block pattern (periodic across X)
    num_blocks = 16
    period = width / num_blocks

    for x in range(width):
        phi = (x % period) / period
        for y in range(height):
            if 48 < y < 80:
                diag_y = (y - 48) / 32.0
                diag_dist = abs((phi - diag_y * 0.6) % 1.0 - 0.5)
                if diag_dist < 0.08:
                    arr[y, x] -= 0.4
            elif y < 24 or y > 104:
                sipe_dist = abs(phi - 0.5)
                if sipe_dist < 0.10:
                    arr[y, x] -= 0.5
            else:
                diag_y = (y - 24) / 24.0
                diag_dist = abs((phi + diag_y * 0.5) % 1.0 - 0.5)
                if diag_dist < 0.07:
                    arr[y, x] -= 0.35

    noise = np.random.uniform(-0.04, 0.04, (height, width)).astype(np.float32)
    arr = np.clip(arr + noise, 0.0, 1.0)

    grad_y, grad_x = np.gradient(arr)
    shade = 1.0 + 3.0 * grad_x - 2.5 * grad_y
    shade = np.clip(shade, 0.3, 1.8)

    r_chan = np.clip(arr * 40 * shade, 12, 85).astype(np.uint8)
    g_chan = np.clip(arr * 43 * shade, 14, 90).astype(np.uint8)
    b_chan = np.clip(arr * 48 * shade, 16, 95).astype(np.uint8)

    rgb = np.stack([r_chan, g_chan, b_chan], axis=-1)
    img = Image.fromarray(rgb, "RGB")
    return img


# ----------------------------------------------------------------------
# 6: Tire Sidewall (512x512) - Transparent Hub & Outer
# ----------------------------------------------------------------------
def generate_tire_sidewall(width: int = 512, height: int = 512) -> Image.Image:
    """Generate radial tire sidewall with embossed brand text and transparent center/outer."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    cx, cy = width // 2, height // 2
    r_inner = 135
    r_outer = 245

    # Base rubber donut
    for y in range(height):
        for x in range(width):
            dx = x - cx
            dy = y - cy
            r = math.sqrt(dx * dx + dy * dy)
            if r_inner <= r <= r_outer:
                rib = math.sin((r - r_inner) * 0.8) * 4.0
                angle = math.atan2(dy, dx)
                rad_noise = math.sin(angle * 120.0) * 2.0
                base = 32 + int(rib + rad_noise + random.uniform(-1, 1))
                base = max(18, min(55, base))
                img.putpixel((x, y), (base, base + 2, base + 4, 255))

    bdraw = ImageDraw.Draw(img)
    bdraw.ellipse(
        [cx - (r_inner + 8), cy - (r_inner + 8), cx + (r_inner + 8), cy + (r_inner + 8)],
        outline=(22, 24, 26, 255),
        width=2,
    )
    bdraw.ellipse(
        [cx - (r_outer - 8), cy - (r_outer - 8), cx + (r_outer - 8), cy + (r_outer - 8)],
        outline=(20, 22, 24, 255),
        width=3,
    )
    bdraw.ellipse(
        [cx - (r_outer - 14), cy - (r_outer - 14), cx + (r_outer - 14), cy + (r_outer - 14)],
        outline=(46, 48, 52, 255),
        width=1,
    )

    def draw_curved_text(
        text: str,
        radius: float,
        start_angle_deg: float,
        end_angle_deg: float,
        font: ImageFont.FreeTypeFont,
        is_upper: bool = True,
    ):
        n = len(text)
        if n == 0:
            return
        angles = np.linspace(start_angle_deg, end_angle_deg, n)
        for char, ang_deg in zip(text, angles, strict=True):
            ang_rad = math.radians(ang_deg)
            tx = cx + radius * math.cos(ang_rad)
            ty = cy + radius * math.sin(ang_rad)

            char_img = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
            cdraw = ImageDraw.Draw(char_img)
            cdraw.text((25, 25), char, font=font, fill=(18, 20, 22, 255), anchor="mm")
            cdraw.text((23, 23), char, font=font, fill=(65, 70, 75, 255), anchor="mm")
            cdraw.text((24, 24), char, font=font, fill=(40, 44, 48, 255), anchor="mm")

            rot_deg = -ang_deg - 90 if is_upper else -ang_deg + 90
            rotated = char_img.rotate(rot_deg, resample=Image.Resampling.BILINEAR)
            img.alpha_composite(rotated, (int(tx - 24), int(ty - 24)))

    font_brand = get_latin_font(20, bold=True)
    font_spec = get_latin_font(15, bold=True)

    draw_curved_text(
        "TOKYO OPEN DRIVE", radius=195, start_angle_deg=-145, end_angle_deg=-35, font=font_brand, is_upper=True
    )
    draw_curved_text(
        "185/65R15 88H  •  RADIAL", radius=192, start_angle_deg=145, end_angle_deg=35, font=font_spec, is_upper=False
    )

    return img


# ----------------------------------------------------------------------
# 7: Headlight (256x256) - Projector + Reflector + DRL Line
# ----------------------------------------------------------------------
def generate_headlight(width: int = 256, height: int = 256) -> Image.Image:
    """Generate LED headlight texture (Projector lens, multi-reflector, DRL strip)."""
    img = Image.new("RGBA", (width, height), (16, 18, 20, 255))
    draw = ImageDraw.Draw(img)

    # 1. Background dark chrome housing / multi-reflector facets
    for y in range(height):
        for x in range(width):
            facet_x = (x // 12) % 2
            facet_y = (y // 12) % 2
            shade = 24 + (16 if facet_x == facet_y else 0) + (x // 8)
            img.putpixel((x, y), (shade, shade + 2, shade + 6, 255))

    # Reflector horizontal chrome ribs
    for y in range(20, height - 20, 16):
        draw.line([(15, y), (width - 15, y)], fill=(80, 85, 95, 255), width=2)
        draw.line([(15, y + 2), (width - 15, y + 2)], fill=(20, 22, 25, 255), width=1)

    # 2. Main Projector Lens unit
    proj_x, proj_y = 100, 130
    proj_r = 58

    draw.ellipse(
        [proj_x - proj_r, proj_y - proj_r, proj_x + proj_r, proj_y + proj_r],
        fill=(45, 48, 54, 255),
        outline=(140, 145, 155, 255),
        width=4,
    )
    draw.ellipse(
        [proj_x - (proj_r - 6), proj_y - (proj_r - 6), proj_x + (proj_r - 6), proj_y + (proj_r - 6)],
        fill=(20, 22, 26, 255),
        outline=(80, 85, 95, 255),
        width=2,
    )

    for r in range(proj_r - 10, 0, -4):
        t = r / (proj_r - 10)
        cr = int(30 + 120 * (1.0 - t))
        cg = int(50 + 170 * (1.0 - t))
        cb = int(80 + 175 * (1.0 - t))
        draw.ellipse(
            [proj_x - r, proj_y - r, proj_x + r, proj_y + r],
            fill=(cr, cg, cb, 255),
            outline=(cr + 20, cg + 20, cb + 20, 255),
            width=1,
        )

    draw.ellipse([proj_x - 14, proj_y - 14, proj_x + 14, proj_y + 14], fill=(230, 245, 255, 255))
    draw.ellipse([proj_x - 7, proj_y - 7, proj_x + 7, proj_y + 7], fill=(255, 255, 255, 255))

    # 3. High-beam secondary reflector
    sec_x, sec_y = 195, 130
    draw.ellipse(
        [sec_x - 36, sec_y - 36, sec_x + 36, sec_y + 36], fill=(35, 38, 44, 255), outline=(110, 115, 125, 255), width=3
    )
    for deg in range(0, 360, 30):
        rad = math.radians(deg)
        x2 = sec_x + 32 * math.cos(rad)
        y2 = sec_y + 32 * math.sin(rad)
        draw.line([(sec_x, sec_y), (x2, y2)], fill=(75, 80, 90, 255), width=1)
    draw.ellipse(
        [sec_x - 12, sec_y - 12, sec_x + 12, sec_y + 12],
        fill=(220, 225, 235, 255),
        outline=(160, 165, 175, 255),
        width=2,
    )

    # 4. LED Daytime Running Light (DRL)
    ss = 4
    drl_layer = Image.new("RGBA", (width * ss, height * ss), (0, 0, 0, 0))
    drl_draw = ImageDraw.Draw(drl_layer)

    drl_pts = [
        (25 * ss, 38 * ss),
        (210 * ss, 38 * ss),
        (228 * ss, 56 * ss),
        (224 * ss, 185 * ss),
        (215 * ss, 220 * ss),
    ]
    drl_draw.line(drl_pts, fill=(255, 255, 255, 255), width=8 * ss, joint="curve")
    drl_draw.line(drl_pts, fill=(255, 255, 255, 255), width=5 * ss, joint="curve")

    drl_small = drl_layer.resize((width, height), resample=Image.Resampling.LANCZOS)
    drl_glow = drl_small.filter(ImageFilter.GaussianBlur(radius=3.5))

    composite = Image.alpha_composite(img, drl_glow)
    composite = Image.alpha_composite(composite, drl_small)

    fdraw = ImageDraw.Draw(composite)
    fdraw.rectangle([0, 0, width - 1, height - 1], outline=(30, 32, 36, 255), width=4)
    return composite


# ----------------------------------------------------------------------
# 8: Taillight (256x128) - LED Light Guide & Segmented Reflector
# ----------------------------------------------------------------------
def generate_taillight(width: int = 256, height: int = 128) -> Image.Image:
    """Generate rear taillight texture with sleek LED light-bar and ruby reflectors."""
    img = Image.new("RGBA", (width, height), (22, 12, 14, 255))
    draw = ImageDraw.Draw(img)

    # 1. Segmented optical reflector grid
    for y in range(height):
        for x in range(width):
            grid_x = (x // 8) % 2
            grid_y = (y // 8) % 2
            red_val = 55 + (22 if grid_x == grid_y else 0) + int(12 * math.sin(x * 0.1))
            img.putpixel((x, y), (red_val, 8, 12, 255))

    for y in range(12, height - 12, 10):
        draw.line([(10, y), (width - 10, y)], fill=(130, 18, 24, 255), width=2)
        draw.line([(10, y + 2), (width - 10, y + 2)], fill=(35, 6, 8, 255), width=1)

    # 2. Reverse / Turn Signal crystal clear lens insert
    clear_w = 64
    clear_x = width - clear_w - 12
    draw.rounded_rectangle(
        [clear_x, 16, clear_x + clear_w, height - 16],
        radius=6,
        fill=(35, 36, 40, 255),
        outline=(120, 125, 135, 255),
        width=2,
    )
    for ty in range(22, 54, 6):
        draw.line([(clear_x + 6, ty), (clear_x + clear_w - 6, ty)], fill=(180, 110, 25, 255), width=3)
    for ry in range(62, height - 20, 6):
        draw.line([(clear_x + 6, ry), (clear_x + clear_w - 6, ry)], fill=(190, 195, 205, 255), width=3)

    # 3. Signature C-shaped LED Light Guide Tube
    ss = 4
    tube_layer = Image.new("RGBA", (width * ss, height * ss), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(tube_layer)

    tube_pts = [
        (18 * ss, (height // 2) * ss),
        (35 * ss, 22 * ss),
        ((clear_x - 8) * ss, 22 * ss),
        ((clear_x - 4) * ss, 32 * ss),
        (50 * ss, 46 * ss),
        (50 * ss, (height - 46) * ss),
        ((clear_x - 4) * ss, (height - 32) * ss),
        ((clear_x - 8) * ss, (height - 22) * ss),
        (35 * ss, (height - 22) * ss),
        (18 * ss, (height // 2) * ss),
    ]
    tdraw.line(tube_pts, fill=(255, 30, 40, 255), width=7 * ss, joint="curve")
    tdraw.line(tube_pts, fill=(255, 190, 190, 255), width=3 * ss, joint="curve")

    tube_small = tube_layer.resize((width, height), resample=Image.Resampling.LANCZOS)
    tube_glow = tube_small.filter(ImageFilter.GaussianBlur(radius=3.0))

    composite = Image.alpha_composite(img, tube_glow)
    composite = Image.alpha_composite(composite, tube_small)

    bdraw = ImageDraw.Draw(composite)
    bdraw.rectangle([0, 0, width - 1, height - 1], outline=(35, 15, 18, 255), width=3)
    return composite


# ----------------------------------------------------------------------
# 9: Front Grille Mesh (256x256) - Seamless Honeycomb, RGBA (Holes transparent)
# ----------------------------------------------------------------------
def generate_grille(width: int = 256, height: int = 256) -> Image.Image:
    """Generate vertically and horizontally seamless hexagonal honeycomb mesh."""
    cols = 8
    rows = 8
    dx = width / cols  # 32.0
    dy = height / rows  # 32.0

    mesh_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(mesh_layer)

    wall_thick = 4.0

    # Draw hexagonal frame segments
    for r in range(-2, rows + 3):
        for c in range(-2, cols + 3):
            offset_x = (dx / 2.0) if (r % 2 != 0) else 0.0
            cx = c * dx + offset_x
            cy = r * dy

            rad = dx * 0.58
            points = []
            for i in range(6):
                ang = math.radians(60 * i + 30)
                px = cx + rad * math.cos(ang)
                py = cy + rad * math.sin(ang)
                points.append((px, py))

            draw.polygon(points, outline=(22, 23, 26, 255), width=int(wall_thick + 2))
            draw.polygon(points, outline=(42, 45, 50, 255), width=int(wall_thick))

    # Top-edge bevel highlight
    high_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(high_layer)
    for r in range(-2, rows + 3):
        for c in range(-2, cols + 3):
            offset_x = (dx / 2.0) if (r % 2 != 0) else 0.0
            cx = c * dx + offset_x
            cy = r * dy
            rad = dx * 0.58
            pts = [
                (cx + rad * math.cos(math.radians(150)), cy + rad * math.sin(math.radians(150))),
                (cx + rad * math.cos(math.radians(90)), cy + rad * math.sin(math.radians(90))),
                (cx + rad * math.cos(math.radians(30)), cy + rad * math.sin(math.radians(30))),
            ]
            hdraw.line(pts, fill=(95, 100, 110, 200), width=1)

    composite = Image.alpha_composite(mesh_layer, high_layer)
    return composite.crop((0, 0, width, height))


# ----------------------------------------------------------------------
# Contact Sheet Generator
# ----------------------------------------------------------------------
def generate_contact_sheet(textures: Dict[str, Image.Image], output_path: Path) -> None:
    """Generate a clean contact sheet previewing all 9 car textures."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    sheet_w = 1200
    sheet_h = 1050
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (28, 30, 34, 255))
    draw = ImageDraw.Draw(sheet)

    title_font = get_noto_font(28, bold=True)
    label_font = get_noto_font(16, bold=True)
    sub_font = get_noto_font(13, bold=False)

    # Title header
    draw.text(
        (sheet_w // 2, 35),
        "Tokyo Open Drive — Vehicle Texture Contact Sheet",
        font=title_font,
        fill=(240, 245, 250, 255),
        anchor="mm",
    )
    draw.line([(40, 60), (sheet_w - 40, 60)], fill=(65, 70, 80, 255), width=2)

    # Grid layouts: (name, img, x, y, max_display_w, max_display_h, caption)
    items = [
        (
            "plate_private.png",
            textures["plate_private.png"],
            50,
            80,
            320,
            160,
            "1. plate_private.png (512x256) - 自家用ナンバー",
        ),
        (
            "plate_commercial.png",
            textures["plate_commercial.png"],
            430,
            80,
            320,
            160,
            "2. plate_commercial.png (512x256) - 事業用ナンバー",
        ),
        ("taxi_sign.png", textures["taxi_sign.png"], 810, 80, 320, 160, "3. taxi_sign.png (512x256) - タクシー行灯"),
        (
            "vacancy_sign.png",
            textures["vacancy_sign.png"],
            50,
            310,
            320,
            80,
            "4. vacancy_sign.png (256x64) - 空車LED表示",
        ),
        (
            "tire_tread.png",
            textures["tire_tread.png"],
            430,
            310,
            320,
            80,
            "5. tire_tread.png (512x128) - トレッド(シームレス)",
        ),
        (
            "taillight.png",
            textures["taillight.png"],
            810,
            270,
            320,
            160,
            "8. taillight.png (256x128) - テールランプ/発光",
        ),
        (
            "tire_sidewall.png",
            textures["tire_sidewall.png"],
            50,
            520,
            320,
            320,
            "6. tire_sidewall.png (512x512) - サイドウォール",
        ),
        (
            "headlight.png",
            textures["headlight.png"],
            430,
            520,
            320,
            320,
            "7. headlight.png (256x256) - ヘッドライト/発光",
        ),
        (
            "grille.png",
            textures["grille.png"],
            810,
            520,
            320,
            320,
            "9. grille.png (256x256) - フロントグリル(透過/シームレス)",
        ),
    ]

    for _name, img_item, x, y, max_dw, max_dh, caption in items:
        checker = Image.new("RGBA", (max_dw, max_dh), (45, 48, 52, 255))
        cdraw = ImageDraw.Draw(checker)
        sq = 12
        for cy in range(0, max_dh, sq):
            for cx in range(0, max_dw, sq):
                if (cx // sq + cy // sq) % 2 == 0:
                    cdraw.rectangle([cx, cy, cx + sq - 1, cy + sq - 1], fill=(55, 58, 64, 255))

        iw, ih = img_item.size
        scale = min(max_dw / iw, max_dh / ih)
        target_w = int(iw * scale)
        target_h = int(ih * scale)
        resized = img_item.resize((target_w, target_h), resample=Image.Resampling.LANCZOS)

        paste_x = (max_dw - target_w) // 2
        paste_y = (max_dh - target_h) // 2
        checker.paste(resized, (paste_x, paste_y), mask=resized if resized.mode == "RGBA" else None)

        cdraw.rectangle([0, 0, max_dw - 1, max_dh - 1], outline=(75, 80, 92, 255), width=1)
        sheet.paste(checker, (x, y))

        draw.text((x, y + max_dh + 8), caption, font=label_font, fill=(220, 230, 240, 255))
        draw.text(
            (x, y + max_dh + 28),
            f"Original: {iw}x{ih} px  |  Format: {img_item.mode}",
            font=sub_font,
            fill=(150, 160, 175, 255),
        )

    sheet.save(str(output_path), "PNG", optimize=True)
    print(f"[OK] Saved contact sheet: {output_path}")


# ----------------------------------------------------------------------
# Main Execution Entry Point
# ----------------------------------------------------------------------
def main() -> None:
    TEXTURES_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating vehicle textures for Tokyo Open Drive...")

    generators = {
        "plate_private.png": lambda: draw_license_plate(
            plate_type="private", place_text="品川", class_code="330", hiragana="さ", number_text="12-34"
        ),
        "plate_commercial.png": lambda: draw_license_plate(
            plate_type="commercial", place_text="品川", class_code="500", hiragana="あ", number_text="56-78"
        ),
        "taxi_sign.png": generate_taxi_sign,
        "vacancy_sign.png": generate_vacancy_sign,
        "tire_tread.png": generate_tire_tread,
        "tire_sidewall.png": generate_tire_sidewall,
        "headlight.png": generate_headlight,
        "taillight.png": generate_taillight,
        "grille.png": generate_grille,
    }

    textures: Dict[str, Image.Image] = {}

    for filename, gen_fn in generators.items():
        print(f"Generating {filename}...")
        img = gen_fn()
        textures[filename] = img
        out_path = TEXTURES_DIR / filename
        # Save PNG with optimization (<200KB target)
        img.save(str(out_path), "PNG", optimize=True)
        file_size_kb = out_path.stat().st_size / 1024
        print(f"  -> Saved {out_path.name} ({img.width}x{img.height}, {img.mode}, {file_size_kb:.1f} KB)")

    # Optional contact sheet: `uv run scripts/textures/car_textures.py <preview.png>`
    if len(sys.argv) > 1:
        contact_sheet_path = Path(sys.argv[1])
        print(f"Generating contact sheet preview at {contact_sheet_path}...")
        generate_contact_sheet(textures, contact_sheet_path)

    print("\nAll car textures generated successfully!")


if __name__ == "__main__":
    main()
