# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural texture generator for Tokyo Open Drive traffic signal lamps.

Generates 3 traffic signal lamp textures (lens_led.png, ped_stop.png, ped_go.png)
with reproducible procedural techniques, fixed random seeds, and greyscale/alpha masks
suitable for real-time tinting and emissive lighting in Three.js.

Usage:
    uv run scripts/textures/signal_textures.py
    uv run scripts/textures/signal_textures.py <contact_sheet_preview.png>
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Callable, Dict

import numpy as np
from PIL import Image, ImageDraw

# Ensure sibling texture modules can be imported if needed
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Deterministic seed for reproducible procedural generation
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "signals" / "textures"


# ----------------------------------------------------------------------
# 1. Round LED Signal Lens (lens_led.png)
# ----------------------------------------------------------------------
def generate_lens_led(size: int = 256) -> Image.Image:
    """Generate round LED traffic signal lens face (256x256 RGBA).

    A filled circle (antialiased, full canvas) made of a dense hexagonal grid of
    small bright LED dots on a slightly darker diffuser, with subtle radial falloff
    and a thin darker rim. Greyscale (white = brightest); alpha = 1 inside the circle,
    0 outside.
    """
    scale = 4
    canvas_size = size * scale
    radius = canvas_size / 2.0
    cx, cy = radius, radius

    # Coordinate grid
    y_idx, x_idx = np.ogrid[:canvas_size, :canvas_size]
    dist = np.sqrt((x_idx - cx) ** 2 + (y_idx - cy) ** 2)
    normalized_dist = np.clip(dist / radius, 0.0, 1.0)

    # Base diffuser luminance with subtle radial falloff: center ~ 110, near edge ~ 75
    diffuser = 110.0 - 35.0 * (normalized_dist**1.8)

    # Subtle grain
    diffuser_noise = np.sin(x_idx * 0.25) * np.cos(y_idx * 0.25) * 4.0 + np.cos(x_idx * 0.12 - y_idx * 0.15) * 3.0
    diffuser = np.clip(diffuser + diffuser_noise, 40.0, 160.0)

    # Hexagonal grid of LED dots
    spacing = 10.0 * scale  # LED dot pitch
    row_h = spacing * math.sin(math.pi / 3.0)
    led_radius = 3.6 * scale

    led_layer = Image.new("F", (canvas_size, canvas_size), 0.0)
    led_draw = ImageDraw.Draw(led_layer)

    num_rows = int(canvas_size / row_h) + 4
    num_cols = int(canvas_size / spacing) + 4

    for r in range(-2, num_rows):
        y_pos = r * row_h
        x_offset = (r % 2) * (spacing / 2.0)
        for c in range(-2, num_cols):
            x_pos = c * spacing + x_offset
            d_center = math.hypot(x_pos - cx, y_pos - cy)
            if d_center < radius - (6.0 * scale):
                falloff = 1.0 - 0.22 * (d_center / radius) ** 2.0
                dot_brightness = 255.0 * falloff
                led_draw.ellipse(
                    [
                        x_pos - led_radius,
                        y_pos - led_radius,
                        x_pos + led_radius,
                        y_pos + led_radius,
                    ],
                    fill=float(dot_brightness),
                )

    led_array = np.array(led_layer, dtype=np.float32)

    # Blend diffuser background and LED dots
    combined = np.maximum(diffuser, led_array)

    # Thin darker rim near boundary (dist from 0.90 to 0.99)
    rim_mask = np.clip((normalized_dist - 0.90) / 0.09, 0.0, 1.0)
    rim_darkening = 1.0 - 0.65 * rim_mask
    combined = combined * rim_darkening

    # Antialiased circle alpha mask
    edge_width = 1.5 * scale
    alpha = np.clip((radius - dist) / edge_width, 0.0, 1.0) * 255.0

    luminance = np.clip(combined, 0.0, 255.0).astype(np.uint8)
    alpha_u8 = np.clip(alpha, 0.0, 255.0).astype(np.uint8)

    rgba = np.stack([luminance, luminance, luminance, alpha_u8], axis=-1)
    high_res_img = Image.fromarray(rgba, mode="RGBA")

    return high_res_img.resize((size, size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 2. Pedestrian Signal Stop Face (ped_stop.png)
# ----------------------------------------------------------------------
def generate_ped_stop(size: int = 256) -> Image.Image:
    """Generate pedestrian stop signal 「止まれ」 face (256x256 RGBA).

    Japanese 歩行者用灯器 red pictogram of a person standing still (front view,
    arms down, feet together), as a bright LED-dot-textured white figure on
    dark square diffuser background, centered, figure ~80% of height.
    Outside rounded square: alpha 0.
    """
    scale = 4
    canvas_size = size * scale  # 1024
    cx = canvas_size / 2.0

    # 1. Background diffuser plate (rounded square)
    plate_margin = 8 * scale
    corner_radius = 24 * scale

    plate_mask = Image.new("L", (canvas_size, canvas_size), 0)
    plate_draw = ImageDraw.Draw(plate_mask)
    plate_draw.rounded_rectangle(
        [
            plate_margin,
            plate_margin,
            canvas_size - plate_margin,
            canvas_size - plate_margin,
        ],
        radius=corner_radius,
        fill=255,
    )
    plate_mask_np = np.array(plate_mask, dtype=np.float32) / 255.0

    # Dark diffuser luminance ~ 30 with subtle texture
    y_idx, x_idx = np.ogrid[:canvas_size, :canvas_size]
    diffuser_base = 30.0 + 3.0 * np.sin(x_idx * 0.15) * np.cos(y_idx * 0.15)

    # 2. Vector shape for the Standing Person silhouette
    # Total figure spans y=26 to y=230 in 256 space (height ~204px, 80% of canvas)
    figure_mask = Image.new("L", (canvas_size, canvas_size), 0)
    fdraw = ImageDraw.Draw(figure_mask)

    # Head (circle centered at y=46, r=18)
    head_cy = 46.0 * scale
    head_rad = 18.0 * scale
    fdraw.ellipse(
        [cx - head_rad, head_cy - head_rad, cx + head_rad, head_cy + head_rad],
        fill=255,
    )

    # Torso (y=70 to y=146)
    t_top = 70.0 * scale
    t_bot = 146.0 * scale
    s_half = 27.0 * scale
    w_half = 23.0 * scale
    fdraw.polygon(
        [
            (cx - s_half, t_top),
            (cx + s_half, t_top),
            (cx + w_half, t_bot),
            (cx - w_half, t_bot),
        ],
        fill=255,
    )
    # Rounded shoulder tops
    fdraw.ellipse(
        [
            cx - s_half - 6 * scale,
            t_top - 5 * scale,
            cx - s_half + 8 * scale,
            t_top + 9 * scale,
        ],
        fill=255,
    )
    fdraw.ellipse(
        [
            cx + s_half - 8 * scale,
            t_top - 5 * scale,
            cx + s_half + 6 * scale,
            t_top + 9 * scale,
        ],
        fill=255,
    )

    # Arms (straight down, rounded tips)
    arm_top = 72.0 * scale
    arm_bot = 148.0 * scale
    arm_w = 14.0 * scale
    # Left arm
    arm_l_x = cx - 35.0 * scale
    fdraw.rounded_rectangle(
        [arm_l_x - arm_w / 2, arm_top, arm_l_x + arm_w / 2, arm_bot],
        radius=arm_w / 2,
        fill=255,
    )
    # Right arm
    arm_r_x = cx + 35.0 * scale
    fdraw.rounded_rectangle(
        [arm_r_x - arm_w / 2, arm_top, arm_r_x + arm_w / 2, arm_bot],
        radius=arm_w / 2,
        fill=255,
    )

    # Legs (straight down, together with a small gap)
    leg_top = 142.0 * scale
    leg_bot = 230.0 * scale
    leg_w = 18.0 * scale
    leg_gap = 6.0 * scale

    # Left leg
    leg_l_x = cx - leg_gap / 2.0 - leg_w / 2.0
    fdraw.rounded_rectangle(
        [leg_l_x - leg_w / 2, leg_top, leg_l_x + leg_w / 2, leg_bot],
        radius=6.0 * scale,
        fill=255,
    )
    # Right leg
    leg_r_x = cx + leg_gap / 2.0 + leg_w / 2.0
    fdraw.rounded_rectangle(
        [leg_r_x - leg_w / 2, leg_top, leg_r_x + leg_w / 2, leg_bot],
        radius=6.0 * scale,
        fill=255,
    )

    figure_mask_np = np.array(figure_mask, dtype=np.float32) / 255.0

    # 3. Dense hexagonal LED dot overlay across the figure
    spacing = 7.5 * scale
    row_h = spacing * math.sin(math.pi / 3.0)
    led_radius = 2.6 * scale

    led_layer = Image.new("F", (canvas_size, canvas_size), 0.0)
    led_draw = ImageDraw.Draw(led_layer)

    num_rows = int(canvas_size / row_h) + 4
    num_cols = int(canvas_size / spacing) + 4

    for r in range(-2, num_rows):
        y_pos = r * row_h
        x_offset = (r % 2) * (spacing / 2.0)
        for c in range(-2, num_cols):
            x_pos = c * spacing + x_offset
            ix = int(np.clip(x_pos, 0, canvas_size - 1))
            iy = int(np.clip(y_pos, 0, canvas_size - 1))
            if figure_mask_np[iy, ix] > 0.35:
                led_draw.ellipse(
                    [
                        x_pos - led_radius,
                        y_pos - led_radius,
                        x_pos + led_radius,
                        y_pos + led_radius,
                    ],
                    fill=255.0,
                )

    led_dots = np.array(led_layer, dtype=np.float32)

    # Figure texture: solid bright fill (~225) + LED hot spots (~255)
    figure_surface = (220.0 + 35.0 * (led_dots / 255.0)) * figure_mask_np

    # Combine diffuser and figure
    composite_luminance = diffuser_base * (1.0 - figure_mask_np) + figure_surface * figure_mask_np

    # Alpha: 1 inside rounded square plate, 0 outside
    alpha_channel = plate_mask_np * 255.0

    lum_u8 = np.clip(composite_luminance, 0.0, 255.0).astype(np.uint8)
    alpha_u8 = np.clip(alpha_channel, 0.0, 255.0).astype(np.uint8)

    rgba = np.stack([lum_u8, lum_u8, lum_u8, alpha_u8], axis=-1)
    high_res_img = Image.fromarray(rgba, mode="RGBA")

    return high_res_img.resize((size, size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 3. Pedestrian Signal Go Face (ped_go.png)
# ----------------------------------------------------------------------
def generate_ped_go(size: int = 256) -> Image.Image:
    """Generate pedestrian go signal 「進め」 face (256x256 RGBA).

    Japanese 歩行者用灯器 green pictogram of a person walking in side view
    (mid-stride, one arm forward), facing left as in Japanese pedestrian signals.
    Bright LED-dot-textured white figure on dark square diffuser background,
    centered, figure ~80% height. Outside rounded square: alpha 0.
    """
    scale = 4
    canvas_size = size * scale  # 1024
    cx = canvas_size / 2.0

    # 1. Background diffuser plate (rounded square)
    plate_margin = 8 * scale
    corner_radius = 24 * scale

    plate_mask = Image.new("L", (canvas_size, canvas_size), 0)
    plate_draw = ImageDraw.Draw(plate_mask)
    plate_draw.rounded_rectangle(
        [
            plate_margin,
            plate_margin,
            canvas_size - plate_margin,
            canvas_size - plate_margin,
        ],
        radius=corner_radius,
        fill=255,
    )
    plate_mask_np = np.array(plate_mask, dtype=np.float32) / 255.0

    # Dark diffuser luminance ~ 30 with subtle texture
    y_idx, x_idx = np.ogrid[:canvas_size, :canvas_size]
    diffuser_base = 30.0 + 3.0 * np.sin(x_idx * 0.15) * np.cos(y_idx * 0.15)

    # 2. Vector shape for the Walking Person silhouette facing LEFT (256 coordinates)
    # Figure spans y=26 to y=230 (height ~ 204px, 80% height)
    figure_mask = Image.new("L", (canvas_size, canvas_size), 0)
    fdraw = ImageDraw.Draw(figure_mask)

    # Head (centered at cx+2, cy=46, r=18)
    head_cx = cx + 2.0 * scale
    head_cy = 46.0 * scale
    head_r = 18.0 * scale
    fdraw.ellipse(
        [head_cx - head_r, head_cy - head_r, head_cx + head_r, head_cy + head_r],
        fill=255,
    )

    # Torso: leaning forward to the left (y=70 to y=146)
    fdraw.polygon(
        [
            (cx - 10.0 * scale, 70.0 * scale),
            (cx + 20.0 * scale, 70.0 * scale),
            (cx + 12.0 * scale, 146.0 * scale),
            (cx - 18.0 * scale, 146.0 * scale),
        ],
        fill=255,
    )

    # Forward arm (swinging left / forward)
    arm_w = 14.0 * scale
    fdraw.polygon(
        [
            (cx - 8.0 * scale, 74.0 * scale),
            (cx - 38.0 * scale, 116.0 * scale),
            (cx - 30.0 * scale, 122.0 * scale),
            (cx + 1.0 * scale, 80.0 * scale),
        ],
        fill=255,
    )
    fdraw.ellipse(
        [
            cx - 41.0 * scale - arm_w / 2,
            119.0 * scale - arm_w / 2,
            cx - 41.0 * scale + arm_w / 2,
            119.0 * scale + arm_w / 2,
        ],
        fill=255,
    )

    # Rear arm (swinging right / back)
    fdraw.polygon(
        [
            (cx + 12.0 * scale, 74.0 * scale),
            (cx + 38.0 * scale, 118.0 * scale),
            (cx + 30.0 * scale, 124.0 * scale),
            (cx + 4.0 * scale, 80.0 * scale),
        ],
        fill=255,
    )
    fdraw.ellipse(
        [
            cx + 35.0 * scale - arm_w / 2,
            121.0 * scale - arm_w / 2,
            cx + 35.0 * scale + arm_w / 2,
            121.0 * scale + arm_w / 2,
        ],
        fill=255,
    )

    # Forward leg (stepping left / forward)
    fdraw.polygon(
        [
            (cx - 16.0 * scale, 142.0 * scale),
            (cx - 2.0 * scale, 142.0 * scale),
            (cx - 32.0 * scale, 226.0 * scale),
            (cx - 46.0 * scale, 226.0 * scale),
        ],
        fill=255,
    )
    # Forward foot (pointing left)
    fdraw.polygon(
        [
            (cx - 46.0 * scale, 220.0 * scale),
            (cx - 28.0 * scale, 220.0 * scale),
            (cx - 30.0 * scale, 230.0 * scale),
            (cx - 52.0 * scale, 230.0 * scale),
        ],
        fill=255,
    )

    # Rear leg (stepping right / back)
    fdraw.polygon(
        [
            (cx - 2.0 * scale, 142.0 * scale),
            (cx + 12.0 * scale, 142.0 * scale),
            (cx + 46.0 * scale, 225.0 * scale),
            (cx + 32.0 * scale, 225.0 * scale),
        ],
        fill=255,
    )
    # Rear foot
    fdraw.polygon(
        [
            (cx + 30.0 * scale, 218.0 * scale),
            (cx + 48.0 * scale, 216.0 * scale),
            (cx + 52.0 * scale, 226.0 * scale),
            (cx + 34.0 * scale, 229.0 * scale),
        ],
        fill=255,
    )

    figure_mask_np = np.array(figure_mask, dtype=np.float32) / 255.0

    # 3. Dense hexagonal LED dot overlay across the figure
    spacing = 7.5 * scale
    row_h = spacing * math.sin(math.pi / 3.0)
    led_radius = 2.6 * scale

    led_layer = Image.new("F", (canvas_size, canvas_size), 0.0)
    led_draw = ImageDraw.Draw(led_layer)

    num_rows = int(canvas_size / row_h) + 4
    num_cols = int(canvas_size / spacing) + 4

    for r in range(-2, num_rows):
        y_pos = r * row_h
        x_offset = (r % 2) * (spacing / 2.0)
        for c in range(-2, num_cols):
            x_pos = c * spacing + x_offset
            ix = int(np.clip(x_pos, 0, canvas_size - 1))
            iy = int(np.clip(y_pos, 0, canvas_size - 1))
            if figure_mask_np[iy, ix] > 0.35:
                led_draw.ellipse(
                    [
                        x_pos - led_radius,
                        y_pos - led_radius,
                        x_pos + led_radius,
                        y_pos + led_radius,
                    ],
                    fill=255.0,
                )

    led_dots = np.array(led_layer, dtype=np.float32)

    # Figure texture: solid bright fill (~220) + LED hot spots (~255)
    figure_surface = (220.0 + 35.0 * (led_dots / 255.0)) * figure_mask_np

    # Combine diffuser and figure
    composite_luminance = diffuser_base * (1.0 - figure_mask_np) + figure_surface * figure_mask_np

    # Alpha: 1 inside rounded square plate, 0 outside
    alpha_channel = plate_mask_np * 255.0

    lum_u8 = np.clip(composite_luminance, 0.0, 255.0).astype(np.uint8)
    alpha_u8 = np.clip(alpha_channel, 0.0, 255.0).astype(np.uint8)

    rgba = np.stack([lum_u8, lum_u8, lum_u8, alpha_u8], axis=-1)
    high_res_img = Image.fromarray(rgba, mode="RGBA")

    return high_res_img.resize((size, size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 4. Contact Sheet Generator
# ----------------------------------------------------------------------
def tint_greyscale_texture(img: Image.Image, tint_color: tuple[int, int, int]) -> Image.Image:
    """Tint greyscale RGB channels by multiplying with RGB color (0-255)."""
    rgba = np.array(img, dtype=np.float32)
    # Normalize greyscale lum (0..1)
    lum = rgba[:, :, 0] / 255.0
    r = np.clip(lum * tint_color[0], 0, 255).astype(np.uint8)
    g = np.clip(lum * tint_color[1], 0, 255).astype(np.uint8)
    b = np.clip(lum * tint_color[2], 0, 255).astype(np.uint8)
    a = rgba[:, :, 3].astype(np.uint8)
    return Image.fromarray(np.stack([r, g, b, a], axis=-1), mode="RGBA")


def generate_contact_sheet(textures: Dict[str, Image.Image], output_path: Path) -> None:
    """Generate preview contact sheet with original masks and tinted versions."""
    from car_textures import get_noto_font

    # Standard Japanese traffic signal light colors
    RED = (255, 30, 30)
    YELLOW = (255, 200, 20)
    GREEN = (20, 235, 140)  # Japanese blue-green (青信号)

    lens_img = textures["lens_led.png"]
    ped_stop_img = textures["ped_stop.png"]
    ped_go_img = textures["ped_go.png"]

    # Preview items: (Title, Subtitle, RGBA Image)
    preview_items = [
        # Original Greyscale / Alpha Masks
        ("lens_led.png (Mask)", "256x256 Greyscale/Alpha", lens_img),
        ("ped_stop.png (Mask)", "256x256 Greyscale/Alpha", ped_stop_img),
        ("ped_go.png (Mask)", "256x256 Greyscale/Alpha", ped_go_img),
        # Tinted In-Game Simulation
        ("Lens - Red Light", "Tinted: #FF1E1E", tint_greyscale_texture(lens_img, RED)),
        (
            "Lens - Yellow Light",
            "Tinted: #FFC814",
            tint_greyscale_texture(lens_img, YELLOW),
        ),
        (
            "Lens - Green Light",
            "Tinted: #14EB8C (青)",
            tint_greyscale_texture(lens_img, GREEN),
        ),
        (
            "Pedestrian - Stop (赤)",
            "Tinted: #FF1E1E",
            tint_greyscale_texture(ped_stop_img, RED),
        ),
        (
            "Pedestrian - Go (青)",
            "Tinted: #14EB8C",
            tint_greyscale_texture(ped_go_img, GREEN),
        ),
    ]

    thumb_size = 200
    cols = 4
    rows = (len(preview_items) + cols - 1) // cols

    cell_w = thumb_size + 40
    cell_h = thumb_size + 80
    margin = 30

    sheet_w = cols * cell_w + margin * 2
    sheet_h = rows * cell_h + margin * 2

    # Main dark canvas
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (24, 26, 30, 255))
    draw = ImageDraw.Draw(sheet)

    title_font = get_noto_font(20, bold=True)
    caption_font = get_noto_font(14, bold=True)
    sub_font = get_noto_font(12, bold=False)

    # Title header
    draw.text(
        (margin, margin - 15),
        "Tokyo Open Drive - Traffic Signal Textures Preview",
        font=title_font,
        fill=(240, 245, 250, 255),
    )

    for idx, (title, subtitle, img_item) in enumerate(preview_items):
        col = idx % cols
        row = idx // cols

        x = margin + col * cell_w
        y = margin + 30 + row * cell_h

        # Checkerboard background inside cell thumbnail area to visualize alpha
        checker = Image.new("RGBA", (thumb_size, thumb_size), (40, 44, 52, 255))
        cdraw = ImageDraw.Draw(checker)
        sq = 16
        for cy in range(0, thumb_size, sq):
            for cx in range(0, thumb_size, sq):
                if (cx // sq + cy // sq) % 2 == 0:
                    cdraw.rectangle(
                        [cx, cy, cx + sq - 1, cy + sq - 1],
                        fill=(54, 58, 68, 255),
                    )

        # Scale image keeping aspect ratio
        iw, ih = img_item.size
        scale_ratio = min(thumb_size / iw, thumb_size / ih)
        tw = int(iw * scale_ratio)
        th = int(ih * scale_ratio)
        resized = img_item.resize((tw, th), resample=Image.Resampling.LANCZOS)

        paste_x = (thumb_size - tw) // 2
        paste_y = (thumb_size - th) // 2
        checker.paste(resized, (paste_x, paste_y), mask=resized)

        # Cell border
        cdraw.rectangle(
            [0, 0, thumb_size - 1, thumb_size - 1],
            outline=(70, 78, 92, 255),
            width=1,
        )
        sheet.paste(checker, (x, y))

        # Captions
        draw.text(
            (x, y + thumb_size + 8),
            title,
            font=caption_font,
            fill=(225, 235, 245, 255),
        )
        draw.text(
            (x, y + thumb_size + 30),
            subtitle,
            font=sub_font,
            fill=(150, 160, 175, 255),
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(str(output_path), "PNG", optimize=True)
    print(f"[OK] Saved contact sheet: {output_path}")


# ----------------------------------------------------------------------
# Main Execution Entry Point
# ----------------------------------------------------------------------
SIGNAL_GENERATORS: Dict[str, Callable[[], Image.Image]] = {
    "lens_led.png": generate_lens_led,
    "ped_stop.png": generate_ped_stop,
    "ped_go.png": generate_ped_go,
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating traffic signal textures for Tokyo Open Drive...")

    textures: Dict[str, Image.Image] = {}

    for filename, gen_fn in SIGNAL_GENERATORS.items():
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

    print("\nAll traffic signal textures generated successfully!")


if __name__ == "__main__":
    main()
