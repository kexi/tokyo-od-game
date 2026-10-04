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
"""Procedural texture generator for Tokyo Open Drive traffic signs.

Generates 21 Japanese traffic sign textures following the official specifications
("道路標識、区画線及び道路標示に関する命令" 別表第二).
"""

from __future__ import annotations

import math
import os
import random
import sys
from pathlib import Path
from typing import Callable, Dict, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Set deterministic seed for reproducibility
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TEXTURES_DIR = PROJECT_ROOT / "assets" / "signs" / "textures"

# Color constants (spec目安: 赤 #D7262E, 青 #0B4EA2, 白 #FFFFFF, 黒 #1A1A1A)
COLOR_RED = (215, 38, 46, 255)
COLOR_BLUE = (11, 78, 162, 255)
COLOR_WHITE = (255, 255, 255, 255)
COLOR_BLACK = (26, 26, 26, 255)
COLOR_TRANSPARENT = (0, 0, 0, 0)

# Noto Sans JP (SIL OFL 1.1) pinned to a google/fonts commit and verified by SHA-256 hash.
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


def get_noto_font(size: int, bold: bool = False, weight: int | None = None) -> ImageFont.FreeTypeFont:
    """Noto Sans JP font with specified weight."""
    font = ImageFont.truetype(str(_font_file()), size)
    w = weight if weight is not None else (700 if bold else 400)
    try:
        font.set_variation_by_axes([w])
    except (OSError, ValueError):
        pass
    return font


# ----------------------------------------------------------------------
# Geometry helpers
# ----------------------------------------------------------------------
def draw_arrow_head(
    draw: ImageDraw.ImageDraw,
    tip: Tuple[float, float],
    angle_rad: float,
    length: float,
    half_width: float,
    fill: Tuple[int, int, int, int],
    barb_depth: float = 0.22,
) -> None:
    """Draw a sharp traffic-sign style arrowhead."""
    tx, ty = tip
    bx = tx - length * math.cos(angle_rad)
    by = ty - length * math.sin(angle_rad)

    nx = -math.sin(angle_rad)
    ny = math.cos(angle_rad)

    left_wing = (bx + half_width * nx, by + half_width * ny)
    right_wing = (bx - half_width * nx, by - half_width * ny)
    barb_indent = (bx + length * barb_depth * math.cos(angle_rad), by + length * barb_depth * math.sin(angle_rad))

    points = [tip, left_wing, barb_indent, right_wing]
    draw.polygon(points, fill=fill)


def draw_curved_band(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    radius: float,
    width: float,
    start_deg: float,
    end_deg: float,
    fill: Tuple[int, int, int, int],
    steps: int = 60,
) -> None:
    """Draw a thick circular arc band by polygon approximation."""
    r_inner = radius - width / 2.0
    r_outer = radius + width / 2.0

    outer_pts = []
    inner_pts = []

    for i in range(steps + 1):
        deg = start_deg + (end_deg - start_deg) * (i / steps)
        rad = math.radians(deg)
        cos_a = math.cos(rad)
        sin_a = math.sin(rad)
        outer_pts.append((cx + r_outer * cos_a, cy + r_outer * sin_a))
        inner_pts.append((cx + r_inner * cos_a, cy + r_inner * sin_a))

    poly = outer_pts + list(reversed(inner_pts))
    draw.polygon(poly, fill=fill)


# ----------------------------------------------------------------------
# 1. 最高速度 (323) Speed Limit: speed_20 .. speed_80
# ----------------------------------------------------------------------
def draw_speed_limit(speed: int, scale: int = 4) -> Image.Image:
    """Generate speed limit sign (512x512)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)

    center = dim / 2.0
    outer_r = dim / 2.0
    white_rim_r = outer_r - 20 * (scale / 4)
    red_ring_inner_r = outer_r - 280 * (scale / 4)

    # 1. White outer rim
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r], fill=COLOR_WHITE)
    # 2. Red ring
    draw.ellipse(
        [center - white_rim_r, center - white_rim_r, center + white_rim_r, center + white_rim_r], fill=COLOR_RED
    )
    # 3. White inner ground
    draw.ellipse(
        [center - red_ring_inner_r, center - red_ring_inner_r, center + red_ring_inner_r, center + red_ring_inner_r],
        fill=COLOR_WHITE,
    )

    # 4. Numerals (Blue, bold & condensed)
    text = str(speed)
    font_size = int(680 * (scale / 4))
    font = get_noto_font(font_size, weight=900)

    # Render numerals tightly
    temp = Image.new("RGBA", (int(dim * 0.95), int(dim * 0.95)), COLOR_TRANSPARENT)
    tdraw = ImageDraw.Draw(temp)
    bbox = tdraw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tdraw.text((-bbox[0], -bbox[1]), text, font=font, fill=COLOR_BLUE)
    cropped_text = temp.crop((0, 0, tw, th))

    # Scale vertically to reproduce Japanese traffic sign tall numerals
    target_th = int(720 * (scale / 4))
    target_tw = int(tw * (target_th / th) * 0.88)
    scaled_text = cropped_text.resize((target_tw, target_th), Image.Resampling.LANCZOS)

    px = int(center - target_tw / 2.0)
    py = int(center - target_th / 2.0)
    img.paste(scaled_text, (px, py), scaled_text)

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 2. 車両進入禁止 (303) No Entry
# ----------------------------------------------------------------------
def draw_no_entry(scale: int = 4) -> Image.Image:
    """Generate no entry sign (512x512)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)

    center = dim / 2.0
    outer_r = dim / 2.0
    red_r = outer_r - 24 * (scale / 4)

    # 1. Outer white rim
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r], fill=COLOR_WHITE)
    # 2. Red ground
    draw.ellipse([center - red_r, center - red_r, center + red_r, center + red_r], fill=COLOR_RED)

    # 3. White horizontal bar
    bar_w = 1640 * (scale / 4)
    bar_h = 360 * (scale / 4)
    draw.rectangle(
        [center - bar_w / 2.0, center - bar_h / 2.0, center + bar_w / 2.0, center + bar_h / 2.0], fill=COLOR_WHITE
    )

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


def draw_vehicles_closed(scale: int = 4) -> Image.Image:
    """車両通行止め (302): a red ring on a white ground with a white rim (命令 別表第二)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)
    center = dim / 2.0
    outer_r = dim / 2.0
    ring_r = outer_r - 24 * (scale / 4)
    inner_r = ring_r - 0.11 * dim  # ring about a tenth of the diameter
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r], fill=COLOR_WHITE)
    draw.ellipse([center - ring_r, center - ring_r, center + ring_r, center + ring_r], fill=COLOR_RED)
    draw.ellipse([center - inner_r, center - inner_r, center + inner_r, center + inner_r], fill=COLOR_WHITE)
    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 3. 駐車禁止 (316) & 駐停車禁止 (315) No Parking / No Stopping
# ----------------------------------------------------------------------
def draw_no_parking(no_stopping: bool = False, scale: int = 4) -> Image.Image:
    """Generate no parking / no stopping sign (512x512)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)

    center = dim / 2.0
    outer_r = dim / 2.0
    white_rim_r = outer_r - 20 * (scale / 4)
    red_ring_inner_r = outer_r - 280 * (scale / 4)

    # 1. White outer rim
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r], fill=COLOR_WHITE)
    # 2. Red ring
    draw.ellipse(
        [center - white_rim_r, center - white_rim_r, center + white_rim_r, center + white_rim_r], fill=COLOR_RED
    )
    # 3. Blue inner ground
    draw.ellipse(
        [center - red_ring_inner_r, center - red_ring_inner_r, center + red_ring_inner_r, center + red_ring_inner_r],
        fill=COLOR_BLUE,
    )

    # 4. Red diagonal slash(es)
    slash_w = 210 * (scale / 4)
    slash_layer = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    sdraw = ImageDraw.Draw(slash_layer)

    # Slash 1: Top-Left to Bottom-Right (45 deg)
    p1 = (center - dim, center - dim)
    p2 = (center + dim, center + dim)
    sdraw.line([p1, p2], fill=COLOR_RED, width=int(slash_w))

    if no_stopping:
        # Slash 2: Top-Right to Bottom-Left (135 deg)
        p3 = (center + dim, center - dim)
        p4 = (center - dim, center + dim)
        sdraw.line([p3, p4], fill=COLOR_RED, width=int(slash_w))

    # Mask slashes within red_ring outer edge
    mask = Image.new("L", (dim, dim), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.ellipse([center - white_rim_r, center - white_rim_r, center + white_rim_r, center + white_rim_r], fill=255)

    # Composite slashes over img using alpha blending
    masked_slash = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    masked_slash.paste(slash_layer, (0, 0), mask)
    img = Image.alpha_composite(img, masked_slash)

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 4. 転回禁止 (313) No U-Turn
# ----------------------------------------------------------------------
def draw_no_uturn(scale: int = 4) -> Image.Image:
    """Generate no U-turn sign (512x512)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)

    center = dim / 2.0
    outer_r = dim / 2.0
    white_rim_r = outer_r - 20 * (scale / 4)
    red_ring_inner_r = outer_r - 280 * (scale / 4)

    # 1. White outer rim
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r], fill=COLOR_WHITE)
    # 2. Red ring
    draw.ellipse(
        [center - white_rim_r, center - white_rim_r, center + white_rim_r, center + white_rim_r], fill=COLOR_RED
    )
    # 3. White inner ground
    draw.ellipse(
        [center - red_ring_inner_r, center - red_ring_inner_r, center + red_ring_inner_r, center + red_ring_inner_r],
        fill=COLOR_WHITE,
    )

    # 4. Blue U-turn arrow
    shaft_w = 140 * (scale / 4)
    rx = 1180 * (scale / 4)
    lx = 860 * (scale / 4)
    arc_cy = 880 * (scale / 4)
    arc_r = (rx - lx) / 2.0
    arc_cx = (rx + lx) / 2.0

    # Right vertical stem (drawing as thick rectangle polygon for solid joins)
    draw.polygon(
        [
            (rx - shaft_w / 2.0, 1540 * (scale / 4)),
            (rx + shaft_w / 2.0, 1540 * (scale / 4)),
            (rx + shaft_w / 2.0, arc_cy),
            (rx - shaft_w / 2.0, arc_cy),
        ],
        fill=COLOR_BLUE,
    )

    # Top arc
    draw_curved_band(draw, arc_cx, arc_cy, arc_r, shaft_w, 180, 360, COLOR_BLUE)

    # Left descending stem
    arrow_tip_y = 1540 * (scale / 4)
    head_len = 320 * (scale / 4)
    head_hw = 175 * (scale / 4)
    draw.polygon(
        [
            (lx - shaft_w / 2.0, arc_cy),
            (lx + shaft_w / 2.0, arc_cy),
            (lx + shaft_w / 2.0, arrow_tip_y - head_len * 0.7),
            (lx - shaft_w / 2.0, arrow_tip_y - head_len * 0.7),
        ],
        fill=COLOR_BLUE,
    )

    # Downward arrowhead
    draw_arrow_head(draw, (lx, arrow_tip_y), math.pi / 2.0, head_len, head_hw, COLOR_BLUE)

    # 5. Red diagonal slash (Top-Left to Bottom-Right)
    slash_w = 210 * (scale / 4)
    slash_layer = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    sdraw = ImageDraw.Draw(slash_layer)
    sdraw.line([(center - dim, center - dim), (center + dim, center + dim)], fill=COLOR_RED, width=int(slash_w))

    mask = Image.new("L", (dim, dim), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.ellipse([center - white_rim_r, center - white_rim_r, center + white_rim_r, center + white_rim_r], fill=255)

    masked_slash = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    masked_slash.paste(slash_layer, (0, 0), mask)
    img = Image.alpha_composite(img, masked_slash)

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 5. 指定方向外進行禁止 (311) Mandatory Direction: turn_1 .. turn_6
# ----------------------------------------------------------------------
def draw_turn_sign(pattern: int, scale: int = 4) -> Image.Image:
    """Generate turn direction sign (512x512).

    pattern bits: Left=1, Straight=2, Right=4.
    """
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)

    center = dim / 2.0
    outer_r = dim / 2.0
    blue_r = outer_r - 24 * (scale / 4)

    # 1. White outer rim
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r], fill=COLOR_WHITE)
    # 2. Blue ground
    draw.ellipse([center - blue_r, center - blue_r, center + blue_r, center + blue_r], fill=COLOR_BLUE)

    # 3. Arrows
    shaft_w = 140 * (scale / 4)
    head_len = 340 * (scale / 4)
    head_hw = 180 * (scale / 4)

    has_left = bool(pattern & 1)
    has_straight = bool(pattern & 2)
    has_right = bool(pattern & 4)

    stem_bottom_y = 1620 * (scale / 4)

    if has_straight and not (has_left or has_right):
        # Straight only (turn_2)
        tip_y = 440 * (scale / 4)
        draw.polygon(
            [
                (center - shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, tip_y + head_len * 0.75),
                (center - shaft_w / 2.0, tip_y + head_len * 0.75),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (center, tip_y), -math.pi / 2.0, head_len, head_hw, COLOR_WHITE)

    elif has_left and not (has_straight or has_right):
        # Left only (turn_1)
        tip_x = 440 * (scale / 4)
        corner_r = 280 * (scale / 4)
        curve_cx = center - corner_r
        curve_cy = center + corner_r

        # Vertical stem
        draw.polygon(
            [
                (center - shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, curve_cy),
                (center - shaft_w / 2.0, curve_cy),
            ],
            fill=COLOR_WHITE,
        )
        # 90 deg curve (from 0 to -90 deg / 270 deg)
        draw_curved_band(draw, curve_cx, curve_cy, corner_r, shaft_w, 270, 360, COLOR_WHITE)

        # Horizontal stem to left
        horiz_y = curve_cy - corner_r
        draw.polygon(
            [
                (tip_x + head_len * 0.75, horiz_y - shaft_w / 2.0),
                (curve_cx, horiz_y - shaft_w / 2.0),
                (curve_cx, horiz_y + shaft_w / 2.0),
                (tip_x + head_len * 0.75, horiz_y + shaft_w / 2.0),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (tip_x, horiz_y), math.pi, head_len, head_hw, COLOR_WHITE)

    elif has_right and not (has_straight or has_left):
        # Right only (turn_4)
        tip_x = dim - 440 * (scale / 4)
        corner_r = 280 * (scale / 4)
        curve_cx = center + corner_r
        curve_cy = center + corner_r

        # Vertical stem
        draw.polygon(
            [
                (center - shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, curve_cy),
                (center - shaft_w / 2.0, curve_cy),
            ],
            fill=COLOR_WHITE,
        )
        # 90 deg curve
        draw_curved_band(draw, curve_cx, curve_cy, corner_r, shaft_w, 180, 270, COLOR_WHITE)

        # Horizontal stem to right
        horiz_y = curve_cy - corner_r
        draw.polygon(
            [
                (curve_cx, horiz_y - shaft_w / 2.0),
                (tip_x - head_len * 0.75, horiz_y - shaft_w / 2.0),
                (tip_x - head_len * 0.75, horiz_y + shaft_w / 2.0),
                (curve_cx, horiz_y + shaft_w / 2.0),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (tip_x, horiz_y), 0, head_len, head_hw, COLOR_WHITE)

    elif has_straight and has_left and not has_right:
        # Straight + Left (turn_3)
        tip_y = 440 * (scale / 4)
        tip_x = 440 * (scale / 4)
        corner_r = 280 * (scale / 4)
        curve_cx = center - corner_r
        curve_cy = 1180 * (scale / 4)

        # Main vertical stem
        draw.polygon(
            [
                (center - shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, tip_y + head_len * 0.75),
                (center - shaft_w / 2.0, tip_y + head_len * 0.75),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (center, tip_y), -math.pi / 2.0, head_len, head_hw, COLOR_WHITE)

        # Curve branch to left
        draw_curved_band(draw, curve_cx, curve_cy, corner_r, shaft_w, 270, 360, COLOR_WHITE)
        horiz_y = curve_cy - corner_r
        draw.polygon(
            [
                (tip_x + head_len * 0.75, horiz_y - shaft_w / 2.0),
                (curve_cx, horiz_y - shaft_w / 2.0),
                (curve_cx, horiz_y + shaft_w / 2.0),
                (tip_x + head_len * 0.75, horiz_y + shaft_w / 2.0),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (tip_x, horiz_y), math.pi, head_len, head_hw, COLOR_WHITE)

    elif has_straight and has_right and not has_left:
        # Straight + Right (turn_6)
        tip_y = 440 * (scale / 4)
        tip_x = dim - 440 * (scale / 4)
        corner_r = 280 * (scale / 4)
        curve_cx = center + corner_r
        curve_cy = 1180 * (scale / 4)

        # Main vertical stem
        draw.polygon(
            [
                (center - shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, tip_y + head_len * 0.75),
                (center - shaft_w / 2.0, tip_y + head_len * 0.75),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (center, tip_y), -math.pi / 2.0, head_len, head_hw, COLOR_WHITE)

        # Curve branch to right
        draw_curved_band(draw, curve_cx, curve_cy, corner_r, shaft_w, 180, 270, COLOR_WHITE)
        horiz_y = curve_cy - corner_r
        draw.polygon(
            [
                (curve_cx, horiz_y - shaft_w / 2.0),
                (tip_x - head_len * 0.75, horiz_y - shaft_w / 2.0),
                (tip_x - head_len * 0.75, horiz_y + shaft_w / 2.0),
                (curve_cx, horiz_y + shaft_w / 2.0),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (tip_x, horiz_y), 0, head_len, head_hw, COLOR_WHITE)

    elif has_left and has_right and not has_straight:
        # Left + Right (turn_5)
        tip_lx = 440 * (scale / 4)
        tip_rx = dim - 440 * (scale / 4)
        corner_r = 280 * (scale / 4)
        curve_cy = 1180 * (scale / 4)

        # Lower trunk
        draw.polygon(
            [
                (center - shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, stem_bottom_y),
                (center + shaft_w / 2.0, curve_cy),
                (center - shaft_w / 2.0, curve_cy),
            ],
            fill=COLOR_WHITE,
        )

        # Left branch
        curve_lcx = center - corner_r
        draw_curved_band(draw, curve_lcx, curve_cy, corner_r, shaft_w, 270, 360, COLOR_WHITE)
        horiz_y = curve_cy - corner_r
        draw.polygon(
            [
                (tip_lx + head_len * 0.75, horiz_y - shaft_w / 2.0),
                (curve_lcx, horiz_y - shaft_w / 2.0),
                (curve_lcx, horiz_y + shaft_w / 2.0),
                (tip_lx + head_len * 0.75, horiz_y + shaft_w / 2.0),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (tip_lx, horiz_y), math.pi, head_len, head_hw, COLOR_WHITE)

        # Right branch
        curve_rcx = center + corner_r
        draw_curved_band(draw, curve_rcx, curve_cy, corner_r, shaft_w, 180, 270, COLOR_WHITE)
        draw.polygon(
            [
                (curve_rcx, horiz_y - shaft_w / 2.0),
                (tip_rx - head_len * 0.75, horiz_y - shaft_w / 2.0),
                (tip_rx - head_len * 0.75, horiz_y + shaft_w / 2.0),
                (curve_rcx, horiz_y + shaft_w / 2.0),
            ],
            fill=COLOR_WHITE,
        )
        draw_arrow_head(draw, (tip_rx, horiz_y), 0, head_len, head_hw, COLOR_WHITE)

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 6. 一方通行 (326-B) One Way
# ----------------------------------------------------------------------
def draw_one_way(scale: int = 4) -> Image.Image:
    """Generate one way sign (256x512)."""
    target_w = 256
    target_h = 512
    w = target_w * scale
    h = target_h * scale
    img = Image.new("RGBA", (w, h), COLOR_BLUE)
    draw = ImageDraw.Draw(img)

    # Outer white border line
    margin = 48 * (scale / 4)
    line_w = 24 * (scale / 4)
    radius = 48 * (scale / 4)
    draw.rounded_rectangle(
        [margin, margin, w - margin, h - margin], radius=radius, outline=COLOR_WHITE, width=int(line_w)
    )

    # Center upward arrow
    cx = w / 2.0
    shaft_w = 180 * (scale / 4)
    head_len = 480 * (scale / 4)
    head_hw = 280 * (scale / 4)
    tip_y = 380 * (scale / 4)
    stem_bottom_y = 1680 * (scale / 4)

    draw.polygon(
        [
            (cx - shaft_w / 2.0, stem_bottom_y),
            (cx + shaft_w / 2.0, stem_bottom_y),
            (cx + shaft_w / 2.0, tip_y + head_len * 0.75),
            (cx - shaft_w / 2.0, tip_y + head_len * 0.75),
        ],
        fill=COLOR_WHITE,
    )
    draw_arrow_head(draw, (cx, tip_y), -math.pi / 2.0, head_len, head_hw, COLOR_WHITE, barb_depth=0.22)

    return img.resize((target_w, target_h), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 7. 徐行 (329) Slow
# ----------------------------------------------------------------------
def draw_slow(scale: int = 4) -> Image.Image:
    """Generate slow sign (512x512, inverted triangle)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Inverted triangle vertices
    p_top_left = (0.0, 0.0)
    p_top_right = (float(dim), 0.0)
    p_bottom = (dim / 2.0, float(dim))

    # 1. Outer white triangle base
    draw.polygon([p_top_left, p_top_right, p_bottom], fill=COLOR_WHITE)

    # 2. Red inner band
    rim_inset = 24 * (scale / 4)
    p_tl_red = (rim_inset * 1.732, rim_inset)
    p_tr_red = (dim - rim_inset * 1.732, rim_inset)
    p_b_red = (dim / 2.0, dim - rim_inset * 2.0)
    draw.polygon([p_tl_red, p_tr_red, p_b_red], fill=COLOR_RED)

    # 3. White inner ground
    band_inset = 220 * (scale / 4)
    p_tl_white = (band_inset * 1.732, band_inset)
    p_tr_white = (dim - band_inset * 1.732, band_inset)
    p_b_white = (dim / 2.0, dim - band_inset * 2.0)
    draw.polygon([p_tl_white, p_tr_white, p_b_white], fill=COLOR_WHITE)

    # 4. Blue text
    font_kanji = get_noto_font(int(360 * (scale / 4)), weight=900)
    font_en = get_noto_font(int(220 * (scale / 4)), weight=800)

    # "徐行"
    text_kanji = "徐行"
    bbox_k = draw.textbbox((0, 0), text_kanji, font=font_kanji)
    kw = bbox_k[2] - bbox_k[0]
    draw.text(
        ((dim - kw) / 2.0 - bbox_k[0], 480 * (scale / 4) - bbox_k[1]), text_kanji, font=font_kanji, fill=COLOR_BLUE
    )

    # "SLOW"
    text_en = "SLOW"
    bbox_e = draw.textbbox((0, 0), text_en, font=font_en)
    ew = bbox_e[2] - bbox_e[0]
    draw.text(((dim - ew) / 2.0 - bbox_e[0], 920 * (scale / 4) - bbox_e[1]), text_en, font=font_en, fill=COLOR_BLUE)

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 8. 一時停止 (330) Stop
# ----------------------------------------------------------------------
def draw_stop(scale: int = 4) -> Image.Image:
    """Generate stop sign (512x512, inverted triangle)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Inverted triangle vertices
    p_top_left = (0.0, 0.0)
    p_top_right = (float(dim), 0.0)
    p_bottom = (dim / 2.0, float(dim))

    # 1. Red triangle base
    draw.polygon([p_top_left, p_top_right, p_bottom], fill=COLOR_RED)

    # 2. Inner white border line
    line_inset = 60 * (scale / 4)
    line_w = 24 * (scale / 4)
    p_tl_line = (line_inset * 1.732, line_inset)
    p_tr_line = (dim - line_inset * 1.732, line_inset)
    p_b_line = (dim / 2.0, dim - line_inset * 2.0)
    draw.polygon([p_tl_line, p_tr_line, p_b_line], outline=COLOR_WHITE, width=int(line_w))

    # 3. White text
    font_kanji = get_noto_font(int(320 * (scale / 4)), weight=900)
    font_en = get_noto_font(int(230 * (scale / 4)), weight=800)

    # "止まれ"
    text_kanji = "止まれ"
    bbox_k = draw.textbbox((0, 0), text_kanji, font=font_kanji)
    kw = bbox_k[2] - bbox_k[0]
    draw.text(
        ((dim - kw) / 2.0 - bbox_k[0], 480 * (scale / 4) - bbox_k[1]), text_kanji, font=font_kanji, fill=COLOR_WHITE
    )

    # "STOP"
    text_en = "STOP"
    bbox_e = draw.textbbox((0, 0), text_en, font=font_en)
    ew = bbox_e[2] - bbox_e[0]
    draw.text(((dim - ew) / 2.0 - bbox_e[0], 920 * (scale / 4) - bbox_e[1]), text_en, font=font_en, fill=COLOR_WHITE)

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# 9. 横断歩道 (407-A) Pedestrian Crossing
# ----------------------------------------------------------------------
def draw_crosswalk(scale: int = 4) -> Image.Image:
    """Generate crosswalk sign (512x512, square)."""
    target_size = 512
    dim = target_size * scale
    img = Image.new("RGBA", (dim, dim), COLOR_BLUE)
    draw = ImageDraw.Draw(img)

    # 1. Outer white border line
    margin = 48 * (scale / 4)
    line_w = 24 * (scale / 4)
    radius = 32 * (scale / 4)
    draw.rounded_rectangle(
        [margin, margin, dim - margin, dim - margin], radius=radius, outline=COLOR_WHITE, width=int(line_w)
    )

    # 2. White central equilateral triangle
    tri_top = (dim / 2.0, 240 * (scale / 4))
    tri_left = (220 * (scale / 4), 1780 * (scale / 4))
    tri_right = (dim - 220 * (scale / 4), 1780 * (scale / 4))
    draw.polygon([tri_top, tri_left, tri_right], fill=COLOR_WHITE)

    # 3. Black pictogram (pedestrian walking left on road markings)
    s_factor = scale / 4

    # Crosswalk stripes
    stripes = [
        (540, 1530, 670, 1530, 500, 1690, 650, 1690),
        (750, 1530, 880, 1530, 740, 1690, 890, 1690),
        (960, 1530, 1090, 1530, 980, 1690, 1130, 1690),
        (1170, 1530, 1300, 1530, 1220, 1690, 1370, 1690),
        (1380, 1530, 1510, 1530, 1460, 1690, 1610, 1690),
    ]
    for x1a, y1, x1b, _, x2a, y2, x2b, _ in stripes:
        draw.polygon(
            [
                (x1a * s_factor, y1 * s_factor),
                (x1b * s_factor, y1 * s_factor),
                (x2b * s_factor, y2 * s_factor),
                (x2a * s_factor, y2 * s_factor),
            ],
            fill=COLOR_BLACK,
        )

    # Pedestrian Silhouette (Classic 407-A walking person)
    # Head & Hat
    head_cx = 1040 * s_factor
    head_cy = 720 * s_factor
    head_r = 75 * s_factor
    draw.ellipse([head_cx - head_r, head_cy - head_r, head_cx + head_r, head_cy + head_r], fill=COLOR_BLACK)

    # Hat brim / crown
    draw.polygon(
        [
            ((head_cx - 95 * s_factor), (head_cy - 40 * s_factor)),
            ((head_cx + 80 * s_factor), (head_cy - 40 * s_factor)),
            ((head_cx + 70 * s_factor), (head_cy - 90 * s_factor)),
            ((head_cx - 85 * s_factor), (head_cy - 80 * s_factor)),
        ],
        fill=COLOR_BLACK,
    )
    draw.polygon(
        [
            ((head_cx - 140 * s_factor), (head_cy - 25 * s_factor)),
            ((head_cx - 60 * s_factor), (head_cy - 50 * s_factor)),
            ((head_cx + 30 * s_factor), (head_cy - 40 * s_factor)),
            ((head_cx - 80 * s_factor), (head_cy - 20 * s_factor)),
        ],
        fill=COLOR_BLACK,
    )

    # Torso
    torso_poly = [
        (970 * s_factor, 810 * s_factor),
        (1110 * s_factor, 810 * s_factor),
        (1160 * s_factor, 1200 * s_factor),
        (930 * s_factor, 1200 * s_factor),
    ]
    draw.polygon(torso_poly, fill=COLOR_BLACK)

    # Left arm
    draw.polygon(
        [
            (1020 * s_factor, 840 * s_factor),
            (980 * s_factor, 850 * s_factor),
            (840 * s_factor, 1020 * s_factor),
            (870 * s_factor, 1060 * s_factor),
        ],
        fill=COLOR_BLACK,
    )

    # Right arm
    draw.polygon(
        [
            (1100 * s_factor, 840 * s_factor),
            (1135 * s_factor, 850 * s_factor),
            (1215 * s_factor, 1020 * s_factor),
            (1190 * s_factor, 1055 * s_factor),
        ],
        fill=COLOR_BLACK,
    )

    # Left forward leg
    draw.polygon(
        [
            (940 * s_factor, 1180 * s_factor),
            (1040 * s_factor, 1180 * s_factor),
            (860 * s_factor, 1540 * s_factor),
            (760 * s_factor, 1540 * s_factor),
        ],
        fill=COLOR_BLACK,
    )
    # Left foot
    draw.polygon(
        [
            (760 * s_factor, 1515 * s_factor),
            (870 * s_factor, 1515 * s_factor),
            (850 * s_factor, 1560 * s_factor),
            (700 * s_factor, 1560 * s_factor),
        ],
        fill=COLOR_BLACK,
    )

    # Right trailing leg
    draw.polygon(
        [
            (1060 * s_factor, 1180 * s_factor),
            (1160 * s_factor, 1180 * s_factor),
            (1300 * s_factor, 1520 * s_factor),
            (1220 * s_factor, 1540 * s_factor),
        ],
        fill=COLOR_BLACK,
    )
    # Right foot
    draw.polygon(
        [
            (1210 * s_factor, 1515 * s_factor),
            (1310 * s_factor, 1495 * s_factor),
            (1340 * s_factor, 1535 * s_factor),
            (1240 * s_factor, 1560 * s_factor),
        ],
        fill=COLOR_BLACK,
    )

    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


# ----------------------------------------------------------------------
# Generator Registry
# ----------------------------------------------------------------------
SIGN_GENERATORS: Dict[str, Callable[[], Image.Image]] = {
    "speed_20.png": lambda: draw_speed_limit(20),
    "speed_30.png": lambda: draw_speed_limit(30),
    "speed_40.png": lambda: draw_speed_limit(40),
    "speed_50.png": lambda: draw_speed_limit(50),
    "speed_60.png": lambda: draw_speed_limit(60),
    "speed_70.png": lambda: draw_speed_limit(70),
    "speed_80.png": lambda: draw_speed_limit(80),
    "no_entry.png": draw_no_entry,
    "vehicles_closed.png": draw_vehicles_closed,
    "no_parking.png": lambda: draw_no_parking(no_stopping=False),
    "no_stopping.png": lambda: draw_no_parking(no_stopping=True),
    "no_uturn.png": draw_no_uturn,
    "turn_1.png": lambda: draw_turn_sign(1),
    "turn_2.png": lambda: draw_turn_sign(2),
    "turn_3.png": lambda: draw_turn_sign(3),
    "turn_4.png": lambda: draw_turn_sign(4),
    "turn_5.png": lambda: draw_turn_sign(5),
    "turn_6.png": lambda: draw_turn_sign(6),
    "one_way.png": draw_one_way,
    "slow.png": draw_slow,
    "stop.png": draw_stop,
    "crosswalk.png": draw_crosswalk,
}


def build_contact_sheet(images: Dict[str, Image.Image], cols: int = 6, thumb_size: int = 160) -> Image.Image:
    """Build a review contact sheet grid of all generated textures with dark checkerboard background."""
    keys = list(images.keys())
    rows = math.ceil(len(keys) / cols)
    cell_w = thumb_size + 32
    cell_h = thumb_size + 48
    sheet_w = cols * cell_w + 32
    sheet_h = rows * cell_h + 32

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (32, 34, 38, 255))
    sdraw = ImageDraw.Draw(sheet)
    label_font = get_noto_font(18, bold=True)

    for idx, name in enumerate(keys):
        img = images[name]
        r = idx // cols
        c = idx % cols
        x0 = 16 + c * cell_w
        y0 = 16 + r * cell_h

        # Checkerboard background inside cell thumbnail area to visualize alpha
        thumb_bg = Image.new("RGBA", (thumb_size, thumb_size), (48, 52, 60, 255))
        bdraw = ImageDraw.Draw(thumb_bg)
        sq = 16
        for bx in range(0, thumb_size, sq):
            for by in range(0, thumb_size, sq):
                if ((bx // sq) + (by // sq)) % 2 == 0:
                    bdraw.rectangle([bx, by, bx + sq, by + sq], fill=(64, 68, 78, 255))

        # Scale image keeping aspect ratio
        w, h = img.size
        ratio = min(thumb_size / w, thumb_size / h)
        tw = int(w * ratio)
        th = int(h * ratio)
        resized = img.resize((tw, th), Image.Resampling.LANCZOS)

        # Paste resized sign onto thumb_bg
        px = (thumb_size - tw) // 2
        py = (thumb_size - th) // 2
        thumb_bg.paste(resized, (px, py), resized)

        # Paste into sheet
        sheet.paste(thumb_bg, (x0 + 16, y0 + 8))

        # Label text
        bbox = sdraw.textbbox((0, 0), name, font=label_font)
        lw = bbox[2] - bbox[0]
        sdraw.text(
            (x0 + 16 + (thumb_size - lw) / 2.0, y0 + thumb_size + 14), name, font=label_font, fill=(220, 224, 230, 255)
        )

    return sheet


def main() -> None:
    print("Generating Japanese traffic sign textures for Tokyo Open Drive...")
    TEXTURES_DIR.mkdir(parents=True, exist_ok=True)

    generated_images: Dict[str, Image.Image] = {}

    for filename, generator_fn in SIGN_GENERATORS.items():
        print(f"Generating {filename}...")
        img = generator_fn()
        out_path = TEXTURES_DIR / filename
        img.save(out_path, "PNG", optimize=True)
        size_kb = out_path.stat().st_size / 1024
        print(f"  -> Saved {filename} ({img.size[0]}x{img.size[1]}, {img.mode}, {size_kb:.1f} KB)")
        generated_images[filename] = img

    # Check for contact sheet argument
    if len(sys.argv) > 1:
        contact_sheet_path = Path(sys.argv[1])
        print(f"Building contact sheet -> {contact_sheet_path}...")
        sheet = build_contact_sheet(generated_images)
        contact_sheet_path.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(contact_sheet_path, "PNG")
        sheet_kb = contact_sheet_path.stat().st_size / 1024
        print(f"  -> Contact sheet saved ({sheet.size[0]}x{sheet.size[1]}, {sheet_kb:.1f} KB)")

    print("\nAll traffic sign textures generated successfully!")


if __name__ == "__main__":
    main()
