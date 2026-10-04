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
"""Procedural texture generator for Tokyo Open Drive police vehicle models.

Generates 19 police vehicle, motorcycle, and rider textures with reproducible procedural
techniques, fixed random seeds, and open-source licensed font (Noto Sans JP, SIL OFL 1.1).

Usage:
    uv run scripts/textures/police_vehicle_textures.py
    uv run scripts/textures/police_vehicle_textures.py <contact_sheet_preview.png>
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Dict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Ensure sibling texture modules can be imported
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from car_textures import draw_license_plate, get_noto_font  # noqa: E402

# Deterministic seed for reproducible procedural generation
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "police_vehicles" / "textures"

# Color constants
ROYAL_BLUE = (31, 79, 160)
ROYAL_BLUE_DARK = (22, 56, 112)
VEST_BLUE_GRAY = (157, 178, 199)
STRIPE_YELLOW = (226, 180, 42)
GREEN_PLATE = (18, 96, 48, 255)


def draw_text_with_tracking(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, ...] | str,
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


def measure_text_with_tracking(text: str, font: ImageFont.FreeTypeFont, tracking_px: int = 0) -> int:
    """Measure total width of text rendered with tracking."""
    total = 0
    for char in text:
        bbox = font.getbbox(char)
        char_width = bbox[2] - bbox[0] if bbox else 0
        total += char_width + tracking_px
    return max(0, total - (tracking_px if text else 0))


def find_font_for_height(
    sample_text: str, target_height_px: float, bold: bool = True, initial_guess: int = 50
) -> tuple[ImageFont.FreeTypeFont, int]:
    """Find the font size that renders glyphs with visual height closest to target_height_px."""
    low = 10
    high = 400
    best_size = initial_guess
    best_diff = 9999.0
    for size in range(low, high, 2):
        f = get_noto_font(size, bold=bold)
        bbox = f.getbbox(sample_text)
        h = bbox[3] - bbox[1] if bbox else size
        diff = abs(h - target_height_px)
        if diff < best_diff:
            best_diff = diff
            best_size = size
        if h > target_height_px + 5:
            break
    return get_noto_font(best_size, bold=bold), best_size


# ----------------------------------------------------------------------
# 1: Sedan Headlamp (512x128) - Opaque RGB
# ----------------------------------------------------------------------
def generate_sedan_headlamp(width: int = 512, height: int = 128) -> Image.Image:
    """Generate sleek LED headlamp: dark chrome housing, top DRL strip, 3 square projectors.

    u=0 is outer (fender side), u=1 is inner (grille side).
    """
    img = Image.new("RGBA", (width, height), (16, 18, 22, 255))
    draw = ImageDraw.Draw(img)

    # Dark chrome housing background with subtle horizontal reflector facets
    for y in range(height):
        for x in range(width):
            # Subtle gradient: slightly darker towards fender (outer, x=0) and bottom
            grad_x = 0.85 + 0.3 * (x / width)
            grad_y = 0.8 + 0.4 * math.sin((y / height) * math.pi)
            rib = 1.0 + 0.08 * math.sin(y * 0.45)
            shade = int(22 * grad_x * grad_y * rib)
            img.putpixel((x, y), (shade, shade + 2, shade + 6, 255))

    # Reflector horizontal chrome ribs behind projector area
    for y in range(24, height - 20, 8):
        draw.line([(15, y), (width - 15, y)], fill=(48, 54, 64, 255), width=2)
        draw.line([(15, y + 1), (width - 15, y + 1)], fill=(12, 14, 18, 255), width=1)

    # 3 Projector units (square crystal LED projectors)
    # Positions distributed horizontally across u=0.25 to u=0.75
    proj_centers_x = [140, 256, 372]
    proj_cy = 72
    pw, ph = 64, 48

    for cx in proj_centers_x:
        # Outer metal mounting bezel
        draw.rounded_rectangle(
            [cx - pw // 2 - 4, proj_cy - ph // 2 - 4, cx + pw // 2 + 4, proj_cy + ph // 2 + 4],
            radius=6,
            fill=(38, 42, 50, 255),
            outline=(120, 130, 145, 255),
            width=2,
        )
        # Inner dark chamber
        draw.rounded_rectangle(
            [cx - pw // 2, proj_cy - ph // 2, cx + pw // 2, proj_cy + ph // 2],
            radius=4,
            fill=(14, 16, 20, 255),
            outline=(60, 68, 80, 255),
            width=1,
        )
        # Concentric glass lens shading
        for r_step in range(16, 2, -2):
            t = r_step / 16.0
            cr = int(35 + 110 * (1.0 - t))
            cg = int(55 + 150 * (1.0 - t))
            cb = int(95 + 160 * (1.0 - t))
            draw.rounded_rectangle(
                [cx - r_step * 1.5, proj_cy - r_step * 1.1, cx + r_step * 1.5, proj_cy + r_step * 1.1],
                radius=3,
                fill=(cr, cg, cb, 255),
            )
        # White-hot LED core highlight
        draw.rounded_rectangle(
            [cx - 8, proj_cy - 5, cx + 8, proj_cy + 5],
            radius=2,
            fill=(240, 250, 255, 255),
        )

    # White LED Daytime Running Light (DRL) strip along the top edge
    # Outer (x=20) to Inner (x=495) with a sharp modern kink at the outer corner
    ss = 4
    drl_layer = Image.new("RGBA", (width * ss, height * ss), (0, 0, 0, 0))
    ddraw = ImageDraw.Draw(drl_layer)

    drl_pts = [
        (22 * ss, 70 * ss),
        (35 * ss, 24 * ss),
        (488 * ss, 22 * ss),
    ]
    ddraw.line(drl_pts, fill=(255, 255, 255, 255), width=7 * ss, joint="curve")
    ddraw.line(drl_pts, fill=(255, 255, 255, 255), width=4 * ss, joint="curve")

    drl_small = drl_layer.resize((width, height), resample=Image.Resampling.LANCZOS)
    drl_glow = drl_small.filter(ImageFilter.GaussianBlur(radius=3.0))

    img = Image.alpha_composite(img, drl_glow)
    img = Image.alpha_composite(img, drl_small)

    # Dark outer border
    fdraw = ImageDraw.Draw(img)
    fdraw.rectangle([0, 0, width - 1, height - 1], outline=(25, 28, 32, 255), width=3)

    return img.convert("RGB")


# ----------------------------------------------------------------------
# 2: Sedan Taillamp (512x128) - Opaque RGB
# ----------------------------------------------------------------------
def generate_sedan_taillamp(width: int = 512, height: int = 128) -> Image.Image:
    """Generate sleek horizontal LED taillamp: ruby red lens, 2-3 LED light guides, smoked inner.

    u=0 is outer (fender side), u=1 is inner (trunk/grille side).
    """
    img = Image.new("RGBA", (width, height), (40, 8, 12, 255))

    # Base red reflector background with horizontal prism fluting and inner smoke gradient
    for y in range(height):
        for x in range(width):
            # u=0 outer is vivid ruby red, u=1 inner becomes smoked dark red
            smoke_factor = 1.0 - 0.45 * max(0.0, (x / width - 0.4) / 0.6)
            grid_x = (x // 6) % 2
            grid_y = (y // 6) % 2
            flute = 18 if grid_x == grid_y else 0
            vert_curve = math.sin((y / height) * math.pi) ** 0.8
            r_val = int(min(255, (85 + flute + int(40 * vert_curve)) * smoke_factor))
            g_val = int(min(255, (10 + flute * 0.15) * smoke_factor))
            b_val = int(min(255, (14 + flute * 0.2) * smoke_factor))
            img.putpixel((x, y), (r_val, g_val, b_val, 255))

    draw = ImageDraw.Draw(img)
    # Reflector grid lines
    for y in range(10, height - 10, 8):
        draw.line([(10, y), (width - 10, y)], fill=(120, 16, 22, 180), width=1)

    # 3 Horizontal LED light guides (neon tube style)
    ss = 4
    tube_layer = Image.new("RGBA", (width * ss, height * ss), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(tube_layer)

    guide_ys = [34, 64, 94]
    for gy in guide_ys:
        pts = [
            (24 * ss, gy * ss),
            (488 * ss, gy * ss),
        ]
        # Main intense red light
        tdraw.line(pts, fill=(255, 36, 48, 255), width=6 * ss)
        # Hot central core
        tdraw.line(pts, fill=(255, 180, 180, 255), width=2 * ss)

    # Side return at outer edge (u=0 fender wrap)
    c_pts = [
        (36 * ss, 34 * ss),
        (20 * ss, 64 * ss),
        (36 * ss, 94 * ss),
    ]
    tdraw.line(c_pts, fill=(255, 40, 50, 255), width=6 * ss, joint="curve")
    tdraw.line(c_pts, fill=(255, 190, 190, 255), width=2 * ss, joint="curve")

    tube_small = tube_layer.resize((width, height), resample=Image.Resampling.LANCZOS)
    tube_glow = tube_small.filter(ImageFilter.GaussianBlur(radius=3.2))

    img = Image.alpha_composite(img, tube_glow)
    img = Image.alpha_composite(img, tube_small)

    # Outer border
    fdraw = ImageDraw.Draw(img)
    fdraw.rectangle([0, 0, width - 1, height - 1], outline=(30, 8, 12, 255), width=3)

    return img.convert("RGB")


# ----------------------------------------------------------------------
# 3: Sedan Grille (256x128) - Opaque RGB
# ----------------------------------------------------------------------
def generate_sedan_grille(width: int = 256, height: int = 128) -> Image.Image:
    """Generate glossy black hexagonal honeycomb mesh with 4px chrome outer border."""
    img = Image.new("RGBA", (width, height), (16, 18, 20, 255))
    draw = ImageDraw.Draw(img)

    # Hexagonal honeycomb pattern
    hex_r = 10.0
    dx = hex_r * math.sqrt(3)
    dy = hex_r * 1.5
    cols = int(width / dx) + 3
    rows = int(height / dy) + 3

    for r in range(-1, rows):
        for c in range(-1, cols):
            offset_x = (dx / 2.0) if (r % 2 != 0) else 0.0
            cx = c * dx + offset_x
            cy = r * dy

            pts = []
            for i in range(6):
                ang = math.radians(60 * i + 30)
                px = cx + hex_r * math.cos(ang)
                py = cy + hex_r * math.sin(ang)
                pts.append((px, py))

            # Dark cell interior
            draw.polygon(pts, fill=(10, 11, 13, 255), outline=(28, 30, 34, 255), width=2)
            # Top-edge glossy highlights
            high_pts = [pts[3], pts[4], pts[5]]
            draw.line(high_pts, fill=(68, 74, 84, 255), width=1)

    # 4px Chrome border
    chrome_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(chrome_layer)

    # Outer chrome frame
    cdraw.rectangle([0, 0, width - 1, height - 1], outline=(140, 146, 156, 255), width=4)
    # Bright inner bevel
    cdraw.rectangle([1, 1, width - 2, height - 2], outline=(210, 216, 226, 255), width=1)
    cdraw.rectangle([3, 3, width - 4, height - 4], outline=(80, 85, 95, 255), width=1)

    img = Image.alpha_composite(img, chrome_layer)
    return img.convert("RGB")


# ----------------------------------------------------------------------
# 4: Sedan Wheel (256x256) - Opaque RGB
# ----------------------------------------------------------------------
def generate_sedan_wheel(width: int = 256, height: int = 256) -> Image.Image:
    """Generate 10-spoke silver alloy wheel: dark grey background, silver center cap, 5 lug nuts."""
    img = Image.new("RGBA", (width, height), (24, 26, 30, 255))
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2
    r_outer = width // 2 - 1  # 127 px (incircle rim outer)
    r_rim_inner = 112

    # Dark background behind spokes (brake disc / shadow)
    for y in range(height):
        for x in range(width):
            dist = math.hypot(x - cx, y - cy)
            if dist <= r_outer:
                # Radial brushed metal effect for dark brake rotor area
                shade = int(28 + 6 * math.sin(dist * 0.8) + random.uniform(-2, 2))
                img.putpixel((x, y), (shade, shade + 2, shade + 4, 255))

    # Outer silver rim band
    for r in range(r_rim_inner, r_outer):
        t = (r - r_rim_inner) / float(r_outer - r_rim_inner)
        shade = int(140 + 80 * t)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(shade, shade + 3, shade + 8, 255), width=1)

    # 10 Spokes (silver alloy)
    num_spokes = 10
    spoke_w = 9.0

    spoke_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(spoke_layer)

    for i in range(num_spokes):
        ang_rad = 2 * math.pi * i / num_spokes
        cos_a = math.cos(ang_rad)
        sin_a = math.sin(ang_rad)
        norm_x = -sin_a
        norm_y = cos_a

        p_hub1 = (cx + norm_x * (spoke_w * 0.7), cy + norm_y * (spoke_w * 0.7))
        p_hub2 = (cx - norm_x * (spoke_w * 0.7), cy - norm_y * (spoke_w * 0.7))
        p_rim1 = (
            cx + cos_a * r_rim_inner + norm_x * (spoke_w * 1.1),
            cy + sin_a * r_rim_inner + norm_y * (spoke_w * 1.1),
        )
        p_rim2 = (
            cx + cos_a * r_rim_inner - norm_x * (spoke_w * 1.1),
            cy + sin_a * r_rim_inner - norm_y * (spoke_w * 1.1),
        )

        sdraw.polygon([p_hub1, p_rim1, p_rim2, p_hub2], fill=(185, 190, 198, 255))
        # Spoke center highlight ridge
        sdraw.line(
            [(cx + cos_a * 36, cy + sin_a * 36), (cx + cos_a * r_rim_inner, cy + sin_a * r_rim_inner)],
            fill=(225, 230, 238, 255),
            width=2,
        )
        # Spoke shadow edge
        sdraw.line([p_hub2, p_rim2], fill=(110, 115, 124, 255), width=1)

    img = Image.alpha_composite(img, spoke_layer)
    draw = ImageDraw.Draw(img)

    # Center Hub
    hub_r = 38
    draw.ellipse(
        [cx - hub_r, cy - hub_r, cx + hub_r, cy + hub_r],
        fill=(160, 165, 172, 255),
        outline=(100, 105, 112, 255),
        width=2,
    )

    # 5 Lug Nuts
    num_nuts = 5
    nut_dist = 24
    for i in range(num_nuts):
        ang = 2 * math.pi * i / num_nuts - math.pi / 2
        nx = cx + nut_dist * math.cos(ang)
        ny = cy + nut_dist * math.sin(ang)
        # Hex lug nut recess
        draw.ellipse([nx - 6, ny - 6, nx + 6, ny + 6], fill=(45, 48, 54, 255))
        draw.ellipse(
            [nx - 4, ny - 4, nx + 4, ny + 4],
            fill=(195, 200, 208, 255),
            outline=(130, 135, 142, 255),
            width=1,
        )
        draw.point([(nx - 1, ny - 1), (nx, ny - 1)], fill=(240, 245, 255, 255))

    # Center Cap (Plain silver, no logo)
    cap_r = 16
    draw.ellipse(
        [cx - cap_r, cy - cap_r, cx + cap_r, cy + cap_r],
        fill=(190, 195, 202, 255),
        outline=(120, 125, 132, 255),
        width=2,
    )
    draw.ellipse(
        [cx - (cap_r - 2), cy - (cap_r - 2), cx + (cap_r - 2), cy + (cap_r - 2)],
        outline=(220, 225, 235, 255),
        width=1,
    )

    return img.convert("RGB")


# ----------------------------------------------------------------------
# 5: Patrol Door Decal (1024x256) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_patrol_door(width: int = 1024, height: int = 256) -> Image.Image:
    """Generate 'PATROL' side door decal in black (#111111), height ~60%, centered, wide tracking."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    target_h = height * 0.60  # ~154px
    font, _ = find_font_for_height("PATROL", target_h, bold=True, initial_guess=200)

    text = "PATROL"
    tracking = 40
    tw = measure_text_with_tracking(text, font, tracking_px=tracking)
    bbox = font.getbbox("PATROL")
    bh = bbox[3] - bbox[1]

    tx = (width - tw) // 2
    ty = (height - bh) // 2 - bbox[1]

    draw_text_with_tracking(draw, (tx, ty), text, font, fill=(17, 17, 17, 255), tracking_px=tracking)
    return img


# ----------------------------------------------------------------------
# 6: Patrol Rear Decal (512x128) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_patrol_rear(width: int = 512, height: int = 128) -> Image.Image:
    """Generate 'PATROL' rear bumper decal in white (#F4F4F0), height ~65%, centered."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    target_h = height * 0.65  # ~83px
    font, _ = find_font_for_height("PATROL", target_h, bold=True, initial_guess=100)

    text = "PATROL"
    tracking = 16
    tw = measure_text_with_tracking(text, font, tracking_px=tracking)
    bbox = font.getbbox("PATROL")
    bh = bbox[3] - bbox[1]

    tx = (width - tw) // 2
    ty = (height - bh) // 2 - bbox[1]

    draw_text_with_tracking(draw, (tx, ty), text, font, fill=(244, 244, 240, 255), tracking_px=tracking)
    return img


# ----------------------------------------------------------------------
# 7: Patrol Roof Decal (512x256) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_patrol_roof(width: int = 512, height: int = 256) -> Image.Image:
    """Generate rooftop patrol number '27' in black (#111111), height ~85%, centered."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    target_h = height * 0.85  # ~218px
    font, _ = find_font_for_height("27", target_h, bold=True, initial_guess=280)

    text = "27"
    tracking = 10
    tw = measure_text_with_tracking(text, font, tracking_px=tracking)
    bbox = font.getbbox("27")
    bh = bbox[3] - bbox[1]

    tx = (width - tw) // 2
    ty = (height - bh) // 2 - bbox[1]

    draw_text_with_tracking(draw, (tx, ty), text, font, fill=(17, 17, 17, 255), tracking_px=tracking)
    return img


# ----------------------------------------------------------------------
# 8: Patrol Badge (128x128) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_patrol_badge(width: int = 128, height: int = 128) -> Image.Image:
    """Generate generic gold shield badge: flat top, pointed bottom, gold bevel, recessed blank center circle."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Classic pointed shield geometry
    shield_pts = [
        (22, 18),  # top-left
        (106, 18),  # top-right
        (106, 68),  # right-waist
        (64, 114),  # bottom-tip
        (22, 68),  # left-waist
    ]

    # Gold gradient fill
    shield_mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(shield_mask).polygon(shield_pts, fill=255)

    gold_grad = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for y in range(height):
        t = y / float(height)
        # Rich gold gradient: light champagne gold at top -> deep amber gold at bottom
        r = int(248 * (1.0 - 0.3 * t))
        g = int(218 * (1.0 - 0.38 * t))
        b = int(90 * (1.0 - 0.65 * t))
        for x in range(width):
            gold_grad.putpixel((x, y), (r, g, b, 255))

    img.paste(gold_grad, (0, 0), mask=shield_mask)

    # Shield beveled outer border
    draw.polygon(shield_pts, outline=(130, 95, 15, 255), width=2)
    # Bright highlight on top and left edges
    draw.line([(22, 18), (106, 18)], fill=(255, 245, 180, 255), width=2)
    draw.line([(22, 18), (22, 68), (64, 114)], fill=(255, 235, 150, 255), width=2)
    # Dark shadow on right edge
    draw.line([(106, 18), (106, 68), (64, 114)], fill=(110, 75, 10, 255), width=2)

    # Inner recessed blank circle
    cx, cy = 64, 60
    cr = 22
    # Recessed shadow ring (dark top, light bottom)
    draw.ellipse(
        [cx - cr, cy - cr, cx + cr, cy + cr],
        fill=(195, 155, 45, 255),
        outline=(110, 75, 10, 255),
        width=2,
    )
    # Inner circle base
    draw.ellipse(
        [cx - (cr - 2), cy - (cr - 2), cx + (cr - 2), cy + (cr - 2)],
        fill=(215, 175, 55, 255),
    )
    # Subtle inner bevel
    draw.arc(
        [cx - (cr - 2), cy - (cr - 2), cx + (cr - 2), cy + (cr - 2)],
        start=180,
        end=360,
        fill=(120, 85, 15, 255),
        width=2,
    )
    draw.arc(
        [cx - (cr - 2), cy - (cr - 2), cx + (cr - 2), cy + (cr - 2)],
        start=0,
        end=180,
        fill=(255, 240, 160, 255),
        width=1,
    )

    return img


# ----------------------------------------------------------------------
# 9: Patrol Lightbar (512x128) - Opaque RGB
# ----------------------------------------------------------------------
def generate_patrol_lightbar(width: int = 512, height: int = 128) -> Image.Image:
    """Generate red emergency lightbar lens (half unit): 6 LED reflector modules, clear-red ends."""
    img = Image.new("RGBA", (width, height), (60, 8, 12, 255))

    # Base polycarbonate red lens background
    for y in range(height):
        for x in range(width):
            # u=0 and u=1 ends (outer 6% ~ 31px) are clearer brighter red
            u = x / float(width)
            edge_dist = min(u, 1.0 - u)
            end_boost = 1.0 + 0.35 * max(0.0, (0.06 - edge_dist) / 0.06)

            v_factor = math.sin((y / float(height)) * math.pi)
            rib = math.cos((x / 4.0) * (2.0 * math.pi)) * 10.0

            r_val = int(np.clip((140.0 + 75.0 * (v_factor**0.8) + rib) * end_boost, 0, 255))
            g_val = int(np.clip((8.0 + 12.0 * (v_factor**1.2)) * end_boost, 0, 255))
            b_val = int(np.clip((10.0 + 14.0 * (v_factor**1.2)) * end_boost, 0, 255))
            img.putpixel((x, y), (r_val, g_val, b_val, 255))

    # 6 LED reflector modules horizontally equidistant
    num_modules = 6
    margin_x = 48
    spacing = (width - 2 * margin_x) / (num_modules - 1)
    cy = height // 2

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)

    rx_max = int(spacing * 0.42)
    ry_max = 38

    for i in range(num_modules):
        mx = int(margin_x + i * spacing)

        # Chrome reflector cup
        for rx in range(rx_max, 0, -2):
            ry = int(ry_max * (rx / float(rx_max)))
            ref_shade = int(90 + 140 * math.cos((rx / float(rx_max)) * math.pi * 1.5) ** 2)
            odraw.ellipse(
                [mx - rx, cy - ry, mx + rx, cy + ry],
                fill=(min(255, ref_shade + 60), int(ref_shade * 0.25), int(ref_shade * 0.25), 110),
            )

        # Stepped Fresnel rings
        for step_r in [22, 14, 8]:
            odraw.ellipse(
                [mx - step_r, cy - int(step_r * 0.8), mx + step_r, cy + int(step_r * 0.8)],
                outline=(255, 160, 120, 180),
                width=1,
            )

        # High-power LED emitter die
        odraw.ellipse([mx - 9, cy - 8, mx + 9, cy + 8], fill=(255, 70, 50, 230))
        odraw.ellipse([mx - 5, cy - 5, mx + 5, cy + 5], fill=(255, 200, 140, 245))
        odraw.ellipse([mx - 2, cy - 2, mx + 2, cy + 2], fill=(255, 255, 245, 255))

    blurred_glow = overlay.filter(ImageFilter.GaussianBlur(1.5))
    img = Image.alpha_composite(img, overlay)
    img = Image.alpha_composite(img, blurred_glow)

    # Top and bottom housing shadow/bezel
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width - 1, 3], fill=(30, 4, 6, 200))
    draw.rectangle([0, height - 4, width - 1, height - 1], fill=(30, 4, 6, 200))

    return img.convert("RGB")


# ----------------------------------------------------------------------
# 10: Patrol Speaker (256x128) - Opaque RGB
# ----------------------------------------------------------------------
def generate_patrol_speaker(width: int = 256, height: int = 128) -> Image.Image:
    """Generate siren speaker front: dark grey housing, perforated grille mesh, 4 corner bolts."""
    img = Image.new("RGBA", (width, height), (42, 45, 50, 255))
    draw = ImageDraw.Draw(img)

    # Inner recessed grille chamber
    gw = width - 24
    gh = height - 24
    gx0, gy0 = 12, 12
    gx1, gy1 = gx0 + gw, gy0 + gh

    draw.rounded_rectangle([gx0, gy0, gx1, gy1], radius=8, fill=(18, 20, 24, 255), outline=(24, 26, 30, 255), width=2)

    # Perforated circular hole mesh (staggered honeycomb grid)
    hole_r = 2.4
    dx = 8.0
    dy = 7.0
    cols = int(gw / dx) + 1
    rows = int(gh / dy) + 1

    for r in range(rows):
        for c in range(cols):
            offset_x = (dx / 2.0) if (r % 2 != 0) else 0.0
            hx = gx0 + 8 + c * dx + offset_x
            hy = gy0 + 8 + r * dy
            if gx0 + 6 < hx < gx1 - 6 and gy0 + 6 < hy < gy1 - 6:
                # Hole depth shadow
                draw.ellipse(
                    [hx - hole_r, hy - hole_r, hx + hole_r, hy + hole_r],
                    fill=(8, 9, 11, 255),
                    outline=(38, 42, 48, 255),
                    width=1,
                )

    # 4 Corner mounting hex bolts
    bolt_coords = [(10, 10), (width - 10, 10), (10, height - 10), (width - 10, height - 10)]
    for bx, by in bolt_coords:
        draw.ellipse([bx - 5, by - 5, bx + 5, by + 5], fill=(30, 32, 36, 255))
        draw.ellipse(
            [bx - 3, by - 3, bx + 3, by + 3],
            fill=(180, 185, 192, 255),
            outline=(100, 105, 112, 255),
            width=1,
        )
        draw.point([(bx - 1, by - 1)], fill=(240, 245, 255, 255))

    return img.convert("RGB")


# ----------------------------------------------------------------------
# 11: Patrol License Plate (512x256) - RGBA
# ----------------------------------------------------------------------
def generate_patrol_plate(width: int = 512, height: int = 256) -> Image.Image:
    """Generate 8-number police patrol car private plate: 品川 800 す 11-08."""
    return draw_license_plate(
        plate_type="private",
        place_text="品川",
        class_code="800",
        hiragana="す",
        number_text="11-08",
        width=width,
        height=height,
    )


# ----------------------------------------------------------------------
# 12: Red Beacon Lens (128x128) - Opaque RGB
# ----------------------------------------------------------------------
def generate_red_lens(width: int = 128, height: int = 128) -> Image.Image:
    """Generate circular emergency red beacon lens: concentric Fresnel rings, bright incandescent core."""
    img = Image.new("RGBA", (width, height), (22, 24, 28, 255))
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2
    r_max = width // 2 - 4

    for y in range(height):
        for x in range(width):
            dist = math.hypot(x - cx, y - cy)
            if dist <= r_max:
                t = dist / float(r_max)
                # Concentric Fresnel prism steps
                fresnel = 18.0 * math.cos(dist * (2.0 * math.pi / 6.0))
                # Falloff from bright center to darker ruby rim
                r_val = int(np.clip((230.0 * (1.0 - 0.65 * t) + fresnel), 20, 255))
                g_val = int(np.clip((35.0 * (1.0 - 0.8 * t) + fresnel * 0.1), 4, 255))
                b_val = int(np.clip((40.0 * (1.0 - 0.8 * t) + fresnel * 0.15), 6, 255))
                img.putpixel((x, y), (r_val, g_val, b_val, 255))

    # Bright incandescent bulb reflection core
    core_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(core_layer)
    cdraw.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=(255, 140, 80, 200))
    cdraw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(255, 240, 200, 255))
    cdraw.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=(255, 255, 255, 255))

    core_glow = core_layer.filter(ImageFilter.GaussianBlur(1.5))
    img = Image.alpha_composite(img, core_layer)
    img = Image.alpha_composite(img, core_glow)

    # Outer chrome bezel ring
    draw = ImageDraw.Draw(img)
    draw.ellipse(
        [cx - r_max, cy - r_max, cx + r_max, cy + r_max],
        outline=(140, 145, 155, 255),
        width=3,
    )

    return img.convert("RGB")


# ----------------------------------------------------------------------
# 13: Unmarked Plate (512x256) - RGBA
# ----------------------------------------------------------------------
def generate_unmarked_plate(width: int = 512, height: int = 256) -> Image.Image:
    """Generate unmarked patrol car private plate: 品川 300 た 37-64."""
    return draw_license_plate(
        plate_type="private",
        place_text="品川",
        class_code="300",
        hiragana="た",
        number_text="37-64",
        width=width,
        height=height,
    )


# ----------------------------------------------------------------------
# 14: Shirobai Motorcycle Plate (460x250) - RGBA
# ----------------------------------------------------------------------
def _glyph_to_cell(ch: str, box_mm: tuple[float, float, float, float], k: int) -> tuple[Image.Image, tuple[int, int]]:
    """Render character large, crop to ink, and stretch to fit exact box_mm cell (x0, y0, x1, y1)."""
    font = get_noto_font(200, bold=True)
    canvas = Image.new("L", (260, 260), 0)
    ImageDraw.Draw(canvas).text((130, 130), ch, font=font, fill=255, anchor="mm")
    ink = canvas.crop(canvas.getbbox())
    x0, y0, x1, y1 = (round(v * k) for v in box_mm)
    return ink.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS), (x0, y0)


def generate_shirobai_plate(width: int = 460, height: int = 250) -> Image.Image:
    """Generate small motorcycle (>250cc) rear plate: 230x125mm with green outer border.

    品川 2 す 11-08 (架空).
    """
    k = 2  # 2 px / mm -> 460 x 250 px
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Base white plate
    d.rounded_rectangle([0, 0, width - 1, height - 1], radius=8 * k, fill=(248, 250, 246, 255))

    # Outer green border (distinctive requirement for 小型二輪 >= 251cc)
    border_inset = 3 * k
    d.rounded_rectangle(
        [border_inset, border_inset, width - 1 - border_inset, height - 1 - border_inset],
        radius=5 * k,
        outline=GREEN_PLATE,
        width=2 * k,
    )

    ink = Image.new("RGBA", img.size, GREEN_PLATE)
    cells = [
        ("2", (55, 13, 77, 43)),  # 分類番号 (小型二輪)
        ("品", (78, 13, 102, 43)),
        ("川", (103, 13, 127, 43)),
        ("す", (150, 13, 175, 43)),  # ひらがな
        ("1", (16.5, 53, 51.5, 113)),
        ("1", (62.5, 53, 97.5, 113)),
        ("0", (132.5, 53, 167.5, 113)),
        ("8", (178.5, 53, 213.5, 113)),
    ]

    for ch, box in cells:
        mask, pos = _glyph_to_cell(ch, box, k)
        img.paste(ink.crop((0, 0) + mask.size), pos, mask)

    # Center hyphen
    d.rectangle([107.5 * k, 79 * k, 122.5 * k, 87 * k], fill=GREEN_PLATE)

    # Bolt holes
    for x in (40, 138.5):
        cy = 28 * k
        d.ellipse([(x - 6) * k, cy - 6 * k, (x + 6) * k, cy + 6 * k], fill=(200, 204, 206, 255))
        d.ellipse([(x - 3) * k, cy - 3 * k, (x + 3) * k, cy + 3 * k], fill=(150, 154, 158, 255))

    return img


# # ----------------------------------------------------------------------
# 15: Shirobai Side Box Decal (512x256) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_shirobai_box_side(width: int = 512, height: int = 256) -> Image.Image:
    """Generate motorcycle side box decal: Top 'PATROL' (height ~30%), Bottom '7' (height ~45%), centered."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Top 'PATROL'
    target_h_patrol = height * 0.30  # ~77px
    font_patrol, _ = find_font_for_height("PATROL", target_h_patrol, bold=True, initial_guess=90)
    tracking_patrol = 20
    tw_p = measure_text_with_tracking("PATROL", font_patrol, tracking_px=tracking_patrol)
    bbox_p = font_patrol.getbbox("PATROL")
    tx_p = (width - tw_p) // 2
    ty_p = int(height * 0.12) - bbox_p[1]
    draw_text_with_tracking(
        draw, (tx_p, ty_p), "PATROL", font_patrol, fill=(17, 17, 17, 255), tracking_px=tracking_patrol
    )

    # Bottom '7'
    target_h_num = height * 0.45  # ~115px
    font_num, _ = find_font_for_height("7", target_h_num, bold=True, initial_guess=140)
    bbox_n = font_num.getbbox("7")
    tw_n = bbox_n[2] - bbox_n[0]
    bh_n = bbox_n[3] - bbox_n[1]
    tx_n = (width - tw_n) // 2 - bbox_n[0]
    ty_n = int(height * 0.50) + (int(height * 0.45) - bh_n) // 2 - bbox_n[1]
    draw.text((tx_n, ty_n), "7", font=font_num, fill=(17, 17, 17, 255))

    return img


# ----------------------------------------------------------------------
# 16: Shirobai Top Box Decal (256x256) - RGBA Transparent
# ----------------------------------------------------------------------
def generate_shirobai_box_top(width: int = 256, height: int = 256) -> Image.Image:
    """Generate top box machine number '07' in black, height ~70%, centered."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    target_h = height * 0.70  # ~179px
    font, _ = find_font_for_height("07", target_h, bold=True, initial_guess=220)

    text = "07"
    tracking = 8
    tw = measure_text_with_tracking(text, font, tracking_px=tracking)
    bbox = font.getbbox("07")
    bh = bbox[3] - bbox[1]

    tx = (width - tw) // 2
    ty = (height - bh) // 2 - bbox[1]

    draw_text_with_tracking(draw, (tx, ty), text, font, fill=(17, 17, 17, 255), tracking_px=tracking)
    return img


# ----------------------------------------------------------------------
# 17: Shirobai Wheel (512x256) - RGBA
# ----------------------------------------------------------------------
def generate_shirobai_wheel(width: int = 512, height: int = 256) -> Image.Image:
    """Generate motorcycle wheel: Left 6-spoke dark cast wheel, Right drilled brake disc."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    c, R = 128, 127
    rim_dark = (32, 34, 38, 255)

    # 1. Left half (u=0.25, v=0.5): 6-spoke cast wheel
    # Rim band
    d.ellipse([c - R, c - R, c + R, c + R], fill=rim_dark)
    # Outer silver lip accent line
    d.ellipse([c - R + 2, c - R + 2, c + R - 2, c + R - 2], outline=(175, 180, 188, 255), width=2)
    # Transparent open gaps
    d.ellipse([c - R + 14, c - R + 14, c + R - 14, c + R - 14], fill=(0, 0, 0, 0))

    # 6 Cast spokes
    num_spokes = 6
    for k in range(num_spokes):
        a = 2 * math.pi * k / num_spokes
        x1 = c + (R - 12) * math.cos(a)
        y1 = c + (R - 12) * math.sin(a)
        d.line([(c, c), (x1, y1)], fill=rim_dark, width=14)
        # Subtle spoke bevel highlight
        d.line([(c, c), (x1, y1)], fill=(75, 80, 88, 255), width=2)

    # Center hub
    d.ellipse([c - 32, c - 32, c + 32, c + 32], fill=(55, 58, 64, 255))
    d.ellipse([c - 14, c - 14, c + 14, c + 14], fill=(160, 165, 172, 255))

    # 2. Right half (u=0.75, v=0.5): Drilled steel brake disc
    c2 = 384
    # Steel disc friction ring
    d.ellipse([c2 - R, c - R, c2 + R, c + R], fill=(182, 186, 192, 255))
    # Inner open cut
    d.ellipse([c2 - 76, c - 76, c2 + 76, c + 76], fill=(0, 0, 0, 0))

    # Drilled holes pattern
    for k in range(24):
        a = 2 * math.pi * k / 24
        rr = 100 + (8 if k % 2 else -6)
        hx = c2 + rr * math.cos(a)
        hy = c + rr * math.sin(a)
        d.ellipse([hx - 4.5, hy - 4.5, hx + 4.5, hy + 4.5], fill=(0, 0, 0, 0))

    # Inner dark carrier floating bobbins & arms
    for k in range(6):
        a = 2 * math.pi * k / 6
        d.line([(c2, c), (c2 + 80 * math.cos(a), c + 80 * math.sin(a))], fill=(50, 52, 58, 255), width=14)
        # Floating bobbin pins
        bx = c2 + 76 * math.cos(a)
        by = c + 76 * math.sin(a)
        d.ellipse([bx - 6, by - 6, bx + 6, by + 6], fill=(130, 135, 142, 255))

    d.ellipse([c2 - 32, c - 32, c2 + 32, c + 32], fill=(50, 52, 58, 255))
    d.ellipse([c2 - 16, c - 16, c2 + 16, c + 16], fill=(0, 0, 0, 0))

    return img


# ----------------------------------------------------------------------
# 18: Rider Jacket (512x512) - Opaque RGB
# ----------------------------------------------------------------------
def _generate_twill_fabric(
    width: int, height: int, base_rgb: tuple[int, int, int], twill_amp: float = 6.0
) -> Image.Image:
    """Generate fine twill weave fabric texture with seamless tileable diagonal ribs and grain."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    ribs = np.sin((xx + yy) * (2.0 * np.pi / 4.0)) * (twill_amp * 0.5)
    noise = np.random.normal(0.0, twill_amp * 0.25, (height, width))
    mod = ribs + noise

    r = np.clip(base_rgb[0] + mod, 0, 255).astype(np.uint8)
    g = np.clip(base_rgb[1] + mod, 0, 255).astype(np.uint8)
    b = np.clip(base_rgb[2] + mod, 0, 255).astype(np.uint8)

    rgb = np.stack([r, g, b], axis=-1)
    return Image.fromarray(rgb, "RGB")


def generate_rider_jacket(width: int = 512, height: int = 512) -> Image.Image:
    """Generate traffic police motorcycle rider jacket on human torso UV layout.

    - Royal blue twill fabric base
    - Double-breasted silver buttons (2 rows x 3)
    - Pale blue-grey high-visibility tactical vest over v 0.30..0.96 with 6px white reflective piping
    - White duty belt at v 0.13..0.18 with center silver buckle
    - Silver badge plate on left chest
    - Bottom 1/8 band (v 0..0.125) reserved for plain sleeves/cuffs.
    """
    # 1. Base royal blue twill jacket
    img = _generate_twill_fabric(width, height, ROYAL_BLUE, twill_amp=8.0)
    draw = ImageDraw.Draw(img)

    # Torso UV parameters
    # v=0.125 hem -> y = (1 - 0.125) * 512 = 448
    # v=1.0 neck -> y = 0
    cuff_y = 448

    # Sleeve cuffs in bottom 1/8 band (y: 448..512)
    # Plain royal blue fabric with seam line
    draw.line([(0, cuff_y), (width, cuff_y)], fill=(18, 45, 95), width=2)
    draw.line([(0, 500), (width, 500)], fill=(25, 60, 120), width=1)  # cuff seam

    # 2. High-visibility Tactical Vest (Pale Blue-Grey #9DB2C7)
    # Covers v 0.30..0.96 -> y from (1-0.96)*512 = 20 to (1-0.30)*512 = 358
    vest_top_y = int((1.0 - 0.96) * height)  # 20
    vest_bot_y = int((1.0 - 0.30) * height)  # 358

    # Vest front panel: centered around u=0.25 (x=128), armhole cutouts near u=0.0 and u=0.5
    # Vest back panel: centered around u=0.75 (x=384), armhole cutouts near u=0.5 and u=1.0
    vest_mask = Image.new("L", (width, height), 0)
    vdraw = ImageDraw.Draw(vest_mask)

    # Front vest polygon (x: 28 to 228)
    front_vest_pts = [
        (48, vest_top_y),
        (208, vest_top_y),
        (228, vest_top_y + 40),
        (224, vest_bot_y),
        (32, vest_bot_y),
        (28, vest_top_y + 40),
    ]
    vdraw.polygon(front_vest_pts, fill=255)

    # Back vest polygon (x: 284 to 484)
    back_vest_pts = [
        (304, vest_top_y),
        (464, vest_top_y),
        (484, vest_top_y + 40),
        (480, vest_bot_y),
        (288, vest_bot_y),
        (284, vest_top_y + 40),
    ]
    vdraw.polygon(back_vest_pts, fill=255)

    # Vest twill fabric
    vest_fabric = _generate_twill_fabric(width, height, VEST_BLUE_GRAY, twill_amp=5.0)
    img.paste(vest_fabric, (0, 0), mask=vest_mask)

    # 3. White reflective piping (6px width) on vest borders
    piping_color = (248, 252, 255)
    # Front piping
    draw.line(front_vest_pts + [front_vest_pts[0]], fill=piping_color, width=6, joint="curve")
    # Back piping
    draw.line(back_vest_pts + [back_vest_pts[0]], fill=piping_color, width=6, joint="curve")

    # Front center zipper line (u=0.25 -> x=128)
    front_cx = 128
    draw.line([(front_cx, vest_top_y), (front_cx, vest_bot_y)], fill=(50, 55, 65), width=2)
    draw.line([(front_cx - 1, vest_top_y), (front_cx - 1, vest_bot_y)], fill=(120, 130, 140), width=1)

    # 4. Folded Collar at neck (y: 0..50)
    collar_pts = [
        (front_cx - 55, 0),
        (front_cx - 20, 52),
        (front_cx, 38),
        (front_cx + 20, 52),
        (front_cx + 55, 0),
    ]
    draw.polygon(collar_pts, fill=ROYAL_BLUE_DARK)
    draw.line(collar_pts, fill=(15, 38, 80), width=2)

    # 5. Double-breasted Silver Buttons (2 rows x 3 buttons)
    # u = 0.25 +- 0.05 -> x = 128 - 26 = 102, x = 128 + 26 = 154
    # v 0.45..0.80 -> y from 102 to 282
    btn_xs = [102, 154]
    btn_ys = [120, 195, 270]

    for by in btn_ys:
        for bx in btn_xs:
            # Silver metal dome button
            draw.ellipse([bx - 6, by - 6, bx + 6, by + 6], fill=(40, 45, 52))
            draw.ellipse([bx - 5, by - 5, bx + 5, by + 5], fill=(210, 215, 224), outline=(130, 135, 145), width=1)
            draw.ellipse([bx - 2, by - 3, bx + 2, by + 1], fill=(255, 255, 255))

    # 6. Left Chest Silver Identification Badge (u~0.34 -> x=174, v~0.78 -> y=112)
    # Small blank rectangular silver plate
    badge_x, badge_y = 174, 112
    bw, bh = 22, 12
    draw.rectangle(
        [badge_x - bw // 2, badge_y - bh // 2, badge_x + bw // 2, badge_y + bh // 2],
        fill=(215, 220, 228),
        outline=(110, 115, 125),
        width=1,
    )
    draw.line(
        [
            (badge_x - bw // 2 + 1, badge_y - bh // 2 + 1),
            (badge_x + bw // 2 - 1, badge_y - bh // 2 + 1),
        ],
        fill=(255, 255, 255),
        width=1,
    )

    # 7. White Duty Belt at Waist (v 0.13..0.18 -> y from 420 to 445)
    belt_top_y = int((1.0 - 0.18) * height)  # 420
    belt_bot_y = int((1.0 - 0.13) * height)  # 445
    draw.rectangle([0, belt_top_y, width, belt_bot_y], fill=(242, 244, 246))
    # Belt edge stitching
    draw.line([(0, belt_top_y + 2), (width, belt_top_y + 2)], fill=(185, 190, 195), width=1)
    draw.line([(0, belt_bot_y - 2), (width, belt_bot_y - 2)], fill=(185, 190, 195), width=1)

    # Front Center Silver Belt Buckle
    buckle_w, buckle_h = 28, 20
    buckle_cy = (belt_top_y + belt_bot_y) // 2
    draw.rectangle(
        [
            front_cx - buckle_w // 2,
            buckle_cy - buckle_h // 2,
            front_cx + buckle_w // 2,
            buckle_cy + buckle_h // 2,
        ],
        fill=(195, 200, 208),
        outline=(110, 115, 122),
        width=2,
    )
    # Inner buckle frame & prong
    draw.rectangle(
        [
            front_cx - buckle_w // 2 + 5,
            buckle_cy - buckle_h // 2 + 4,
            front_cx + buckle_w // 2 - 5,
            buckle_cy + buckle_h // 2 - 4,
        ],
        fill=(242, 244, 246),
        outline=(130, 135, 142),
        width=1,
    )
    draw.line([(front_cx, buckle_cy - 6), (front_cx, buckle_cy + 6)], fill=(90, 95, 102), width=2)

    return img


# ----------------------------------------------------------------------
# 19: Rider Breeches (256x512) - Opaque RGB
# ----------------------------------------------------------------------
def generate_rider_breeches(width: int = 256, height: int = 512) -> Image.Image:
    """Generate traffic police motorcycle rider breeches / trousers.

    - Royal blue twill fabric base
    - Yellow vertical stripe (side stripe / 側章) centered at u=0.25 (x=64), width 14px
    - Darker waistband at v 0.96..1.0 (y: 0..20)
    - Subtle knee crease shadow at v ~ 0.47 (y ~ 271).
    """
    # 1. Base royal blue fabric
    img = _generate_twill_fabric(width, height, ROYAL_BLUE, twill_amp=8.0)
    draw = ImageDraw.Draw(img)

    # 2. Yellow side stripe (側章) centered at u=0.25 -> x = 64
    stripe_cx = 64
    stripe_w = 14
    sx0 = stripe_cx - stripe_w // 2  # 57
    sx1 = stripe_cx + stripe_w // 2  # 71

    # Yellow stripe fill with fine stitch borders
    draw.rectangle([sx0, 0, sx1, height], fill=STRIPE_YELLOW)
    # Edge seams / stitching
    draw.line([(sx0, 0), (sx0, height)], fill=(160, 120, 20), width=1)
    draw.line([(sx1, 0), (sx1, height)], fill=(160, 120, 20), width=1)
    draw.line([(sx0 + 2, 0), (sx0 + 2, height)], fill=(245, 210, 80), width=1)

    # 3. Waistband at top (v 0.96..1.0 -> y from 0 to 20)
    wb_h = int((1.0 - 0.96) * height)  # ~20
    draw.rectangle([0, 0, width, wb_h], fill=ROYAL_BLUE_DARK)
    draw.line([(0, wb_h), (width, wb_h)], fill=(12, 32, 68), width=2)

    # 4. Subtle knee crease shadow at v ~ 0.47 -> y ~ 271
    knee_y = int((1.0 - 0.47) * height)
    # Soft horizontal crease lines across the leg
    for dy, alpha_shade in [(-3, 15), (-1, 30), (0, 40), (1, 25), (3, 10)]:
        y_pos = knee_y + dy
        # Slight wrinkle curve
        pts = [(0, y_pos), (width // 2, y_pos + 2), (width, y_pos)]
        crease_col = (
            max(0, ROYAL_BLUE[0] - alpha_shade),
            max(0, ROYAL_BLUE[1] - alpha_shade),
            max(0, ROYAL_BLUE[2] - alpha_shade),
        )
        draw.line(pts, fill=crease_col, width=1)

    return img


# ----------------------------------------------------------------------
# Contact Sheet Generator
# ----------------------------------------------------------------------
def generate_contact_sheet(textures: Dict[str, Image.Image], output_path: Path) -> None:
    """Generate a clean contact sheet preview for all 19 police vehicle textures."""
    sheet_w, sheet_h = 1600, 1700
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (24, 26, 30, 255))
    draw = ImageDraw.Draw(sheet)

    title_font = get_noto_font(30, bold=True)
    section_font = get_noto_font(18, bold=True)
    label_font = get_noto_font(13, bold=True)
    sub_font = get_noto_font(11, bold=False)

    # Header
    draw.text(
        (40, 24),
        "TOKYO OPEN DRIVE — Police Vehicle & Rider Texture Sheet",
        font=title_font,
        fill=(240, 245, 252, 255),
    )
    draw.text(
        (40, 64),
        "Procedural textures for Patrol Car, Unmarked Cruiser, Shirobai Motorcycle & Rider",
        font=sub_font,
        fill=(155, 168, 182, 255),
    )
    draw.line([(40, 88), (sheet_w - 40, 88)], fill=(55, 60, 70, 255), width=2)

    # Section Headers
    draw.text((40, 100), "A. Sedan (Patrol & Unmarked Common)", font=section_font, fill=(180, 210, 245, 255))
    draw.text((40, 310), "B. Patrol Car (Decals & Equipment)", font=section_font, fill=(180, 210, 245, 255))
    draw.text((40, 750), "C. Unmarked Cruiser & Beacon", font=section_font, fill=(180, 210, 245, 255))
    draw.text((40, 960), "D. Shirobai Motorcycle & Rider", font=section_font, fill=(180, 210, 245, 255))

    # Layout entries: (filename, x, y, max_w, max_h, title)
    items = [
        # Sedan (Common)
        ("sedan_headlamp.png", 40, 130, 360, 90, "1. sedan_headlamp.png (512x128)"),
        ("sedan_taillamp.png", 430, 130, 360, 90, "2. sedan_taillamp.png (512x128)"),
        ("sedan_grille.png", 820, 130, 220, 110, "3. sedan_grille.png (256x128)"),
        ("sedan_wheel.png", 1070, 100, 180, 180, "4. sedan_wheel.png (256x256)"),
        # Patrol Car
        ("patrol_door.png", 40, 340, 600, 150, "5. patrol_door.png (1024x256)"),
        ("patrol_rear.png", 670, 340, 300, 75, "6. patrol_rear.png (512x128)"),
        ("patrol_roof.png", 1000, 340, 260, 130, "7. patrol_roof.png (512x256)"),
        ("patrol_badge.png", 1290, 340, 110, 110, "8. patrol_badge.png (128x128)"),
        ("patrol_lightbar.png", 40, 550, 480, 120, "9. patrol_lightbar.png (512x128)"),
        ("patrol_speaker.png", 550, 550, 220, 110, "10. patrol_speaker.png (256x128)"),
        ("patrol_plate.png", 800, 550, 240, 120, "11. patrol_plate.png (512x256)"),
        ("red_lens.png", 1070, 550, 110, 110, "12. red_lens.png (128x128)"),
        # Unmarked Cruiser
        ("unmarked_plate.png", 40, 780, 260, 130, "13. unmarked_plate.png (512x256)"),
        # Shirobai & Rider
        ("shirobai_plate.png", 40, 990, 250, 135, "14. shirobai_plate.png (460x250)"),
        ("shirobai_box_side.png", 320, 990, 260, 130, "15. shirobai_box_side.png (512x256)"),
        ("shirobai_box_top.png", 610, 990, 130, 130, "16. shirobai_box_top.png (256x256)"),
        ("shirobai_wheel.png", 770, 990, 280, 140, "17. shirobai_wheel.png (512x256)"),
        ("rider_jacket.png", 1080, 990, 260, 260, "18. rider_jacket.png (512x512)"),
        ("rider_breeches.png", 1370, 990, 140, 280, "19. rider_breeches.png (256x512)"),
    ]

    for name, x, y, max_dw, max_dh, caption in items:
        if name not in textures:
            continue
        img_item = textures[name]

        # Checkerboard background for transparent textures
        checker = Image.new("RGBA", (max_dw, max_dh), (36, 38, 44, 255))
        cdraw = ImageDraw.Draw(checker)
        sq = 12
        for cy in range(0, max_dh, sq):
            for cx in range(0, max_dw, sq):
                if (cx // sq + cy // sq) % 2 == 0:
                    cdraw.rectangle([cx, cy, cx + sq - 1, cy + sq - 1], fill=(48, 52, 60, 255))

        iw, ih = img_item.size
        scale = min(max_dw / iw, max_dh / ih)
        target_w = max(1, int(iw * scale))
        target_h = max(1, int(ih * scale))
        resized = img_item.resize((target_w, target_h), resample=Image.Resampling.LANCZOS)

        paste_x = (max_dw - target_w) // 2
        paste_y = (max_dh - target_h) // 2
        checker.paste(resized, (paste_x, paste_y), mask=resized if resized.mode == "RGBA" else None)
        cdraw.rectangle([0, 0, max_dw - 1, max_dh - 1], outline=(65, 72, 84, 255), width=1)

        sheet.paste(checker, (x, y))
        draw.text((x, y + max_dh + 4), caption, font=label_font, fill=(225, 235, 245, 255))
        draw.text(
            (x, y + max_dh + 20),
            f"{iw}x{ih} px | {img_item.mode}",
            font=sub_font,
            fill=(145, 155, 170, 255),
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(str(output_path), "PNG", optimize=True)
    print(f"[OK] Saved contact sheet: {output_path}")


# ----------------------------------------------------------------------
# Main Execution Entry Point
# ----------------------------------------------------------------------
def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating police vehicle & rider textures for Tokyo Open Drive...")

    generators = {
        # Sedan (Common)
        "sedan_headlamp.png": generate_sedan_headlamp,
        "sedan_taillamp.png": generate_sedan_taillamp,
        "sedan_grille.png": generate_sedan_grille,
        "sedan_wheel.png": generate_sedan_wheel,
        # Patrol Car
        "patrol_door.png": generate_patrol_door,
        "patrol_rear.png": generate_patrol_rear,
        "patrol_roof.png": generate_patrol_roof,
        "patrol_badge.png": generate_patrol_badge,
        "patrol_lightbar.png": generate_patrol_lightbar,
        "patrol_speaker.png": generate_patrol_speaker,
        "patrol_plate.png": generate_patrol_plate,
        "red_lens.png": generate_red_lens,
        # Unmarked Cruiser
        "unmarked_plate.png": generate_unmarked_plate,
        # Shirobai
        "shirobai_plate.png": generate_shirobai_plate,
        "shirobai_box_side.png": generate_shirobai_box_side,
        "shirobai_box_top.png": generate_shirobai_box_top,
        "shirobai_wheel.png": generate_shirobai_wheel,
        # Rider
        "rider_jacket.png": generate_rider_jacket,
        "rider_breeches.png": generate_rider_breeches,
    }

    textures: Dict[str, Image.Image] = {}

    for filename, gen_fn in generators.items():
        img = gen_fn()
        textures[filename] = img
        out_path = OUTPUT_DIR / filename
        img.save(str(out_path), "PNG", optimize=True)
        file_size_kb = out_path.stat().st_size / 1024
        print(f"  -> Saved {out_path.name} ({img.width}x{img.height}, {img.mode}, {file_size_kb:.1f} KB)")

    if len(sys.argv) > 1:
        contact_sheet_path = Path(sys.argv[1])
        print(f"\nGenerating contact sheet preview at {contact_sheet_path}...")
        generate_contact_sheet(textures, contact_sheet_path)

    print("\nAll 19 police vehicle textures generated successfully!")


if __name__ == "__main__":
    main()
