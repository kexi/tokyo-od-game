# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural building facade texture generator for Tokyo Open Drive.

Generates 8 building facade textures and window masks for Tokyo Plateau LOD1 buildings.
All textures are 512x560 px (1px = 2.5cm, 12.8m width x 14.0m height) and tile seamlessly
in both X and Y directions.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TEXTURES_DIR = PROJECT_ROOT / "assets" / "buildings" / "textures"

WIDTH = 512
HEIGHT = 560
SPANS = 4
FLOORS = 4
SPAN_WIDTH = WIDTH // SPANS  # 128px (3.2m)
FLOOR_HEIGHT = HEIGHT // FLOORS  # 140px (3.5m)


# -----------------------------------------------------------------------------
# Math & Procedural Utilities
# -----------------------------------------------------------------------------


def seamless_fractal_noise(
    width: int,
    height: int,
    scale: float = 32.0,
    octaves: int = 4,
    seed: int = 42,
) -> np.ndarray:
    """Generate 2D seamless (toroidal) fractal noise using FFT."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((height, width))
    f_white = np.fft.fft2(white)

    kx = np.fft.fftfreq(width) * width
    ky = np.fft.fftfreq(height) * height
    kx_grid, ky_grid = np.meshgrid(kx, ky)
    freq = np.sqrt(kx_grid**2 + ky_grid**2)
    freq[0, 0] = 1.0  # avoid division by zero

    alpha = 1.5
    filter_h = 1.0 / (freq**alpha)
    filter_h[0, 0] = 0.0

    filtered = f_white * filter_h
    noise = np.real(np.fft.ifft2(filtered))
    noise_min = noise.min()
    noise_max = noise.max()
    if noise_max > noise_min:
        noise = (noise - noise_min) / (noise_max - noise_min)
    else:
        noise = np.zeros_like(noise)
    return noise


def compute_normal_shading(
    heightmap: np.ndarray,
    light_dir: tuple[float, float, float] = (-0.5, -0.6, 0.6),
    strength: float = 1.5,
    ambient: float = 0.6,
) -> np.ndarray:
    """Compute diffuse shading from a heightmap using periodic Sobel gradient."""
    lx, ly, lz = light_dir
    len_l = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / len_l, ly / len_l, lz / len_l

    dx = (np.roll(heightmap, -1, axis=1) - np.roll(heightmap, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(heightmap, -1, axis=0) - np.roll(heightmap, 1, axis=0)) * 0.5 * strength

    norm = np.sqrt(dx * dx + dy * dy + 1.0)
    nx = -dx / norm
    ny = -dy / norm
    nz = 1.0 / norm

    dot = nx * lx + ny * ly + nz * lz
    dot = np.clip(dot, 0.0, 1.0)
    shading = ambient + (1.0 - ambient) * dot
    return np.clip(shading, 0.0, 1.3)


# -----------------------------------------------------------------------------
# 1. Office Glass (Modern Curtain Wall)
# -----------------------------------------------------------------------------


def generate_office_glass() -> tuple[Image.Image, Image.Image]:
    """1. office_glass: Glass curtain wall with thin mullions and blue-gray reflection."""
    rng = np.random.default_rng(SEED + 1)
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    y_coords = np.tile(np.linspace(0.0, 1.0, HEIGHT)[:, None], (1, WIDTH))
    sky_grad = np.sin(y_coords * math.pi * 0.8 + 0.2)
    noise = seamless_fractal_noise(WIDTH, HEIGHT, scale=64.0, octaves=3, seed=101)

    sub_spans = 4
    sub_width = SPAN_WIDTH // sub_spans  # 32px

    for f in range(FLOORS):
        y0 = f * FLOOR_HEIGHT
        y1 = y0 + FLOOR_HEIGHT
        vision_top = 32
        vision_bot = 132

        for s in range(SPANS * sub_spans):
            x0 = s * sub_width
            x1 = x0 + sub_width

            pane_seed = rng.uniform(-0.04, 0.04)
            blind_state = rng.choice([0, 1, 2], p=[0.4, 0.35, 0.25])

            for y in range(y0, y1):
                fy = y - y0
                is_spandrel = fy < vision_top or fy >= vision_bot
                is_vision = not is_spandrel

                if is_spandrel:
                    r = 0.16 + pane_seed * 0.3
                    g = 0.20 + pane_seed * 0.3
                    b = 0.25 + pane_seed * 0.3
                else:
                    refl = sky_grad[y, 0] * 0.35 + noise[y, x0] * 0.1
                    r = 0.22 + refl * 0.5 + pane_seed
                    g = 0.32 + refl * 0.7 + pane_seed
                    b = 0.42 + refl * 0.9 + pane_seed

                    if blind_state == 1 and (fy - vision_top) < 50:
                        blind_stripe = (y % 4 < 2) * 0.08
                        r += 0.22 + blind_stripe
                        g += 0.22 + blind_stripe
                        b += 0.20 + blind_stripe
                    elif blind_state == 2:
                        blind_stripe = (y % 4 < 2) * 0.06
                        r += 0.25 + blind_stripe
                        g += 0.24 + blind_stripe
                        b += 0.22 + blind_stripe

                color_arr[y, x0:x1] = [r, g, b]

                if is_vision:
                    mask_arr[y, x0:x1] = 255
                else:
                    mask_arr[y, x0:x1] = 48

    for f in range(FLOORS):
        y_slab = f * FLOOR_HEIGHT
        y_spandrel_joint = y_slab + 32
        y_spandrel_bot = y_slab + 132

        heightmap[max(0, y_slab - 2) : min(HEIGHT, y_slab + 3), :] = 0.6
        heightmap[max(0, y_spandrel_joint - 1) : min(HEIGHT, y_spandrel_joint + 2), :] = 0.4
        heightmap[max(0, y_spandrel_bot - 1) : min(HEIGHT, y_spandrel_bot + 2), :] = 0.4

        for yw in range(y_slab - 2, y_slab + 3):
            yw_mod = yw % HEIGHT
            color_arr[yw_mod, :] = [0.12, 0.14, 0.16]
            mask_arr[yw_mod, :] = 0

        for yw in [y_spandrel_joint, y_spandrel_bot]:
            yw_mod = yw % HEIGHT
            color_arr[yw_mod, :] = [0.15, 0.17, 0.19]
            mask_arr[yw_mod, :] = 0

    for s in range(SPANS * sub_spans):
        x_mullion = s * sub_width
        is_major = (s % sub_spans) == 0
        w = 2 if is_major else 1
        heightmap[:, max(0, x_mullion - w) : min(WIDTH, x_mullion + w + 1)] = 0.8 if is_major else 0.5

        for xw in range(x_mullion - w, x_mullion + w + 1):
            xw_mod = xw % WIDTH
            col = [0.10, 0.12, 0.14] if is_major else [0.18, 0.20, 0.22]
            color_arr[:, xw_mod] = col
            mask_arr[:, xw_mod] = 0

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.0)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# 2. Office Concrete (Ribbon Windows & Precast Spandrel)
# -----------------------------------------------------------------------------


def generate_office_concrete() -> tuple[Image.Image, Image.Image]:
    """2. office_concrete: Ribbon-window concrete office building."""
    rng = np.random.default_rng(SEED + 2)
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    fine_noise = seamless_fractal_noise(WIDTH, HEIGHT, scale=16.0, octaves=4, seed=201)
    mottle_noise = seamless_fractal_noise(WIDTH, HEIGHT, scale=64.0, octaves=2, seed=202)

    base_gray = 0.68 + (fine_noise - 0.5) * 0.10 + (mottle_noise - 0.5) * 0.12
    for c in range(3):
        color_arr[:, :, c] = base_gray

    for f in range(FLOORS):
        y0 = f * FLOOR_HEIGHT
        w_top = y0 + 54
        w_bot = y0 + 124

        heightmap[y0 + 48 : y0 + 54, :] = 0.6
        heightmap[w_top:w_bot, :] = -0.5
        heightmap[y0 + 124 : y0 + 132, :] = 0.4

        yj = (y0 + 24) % HEIGHT
        heightmap[yj : yj + 2, :] = -0.3
        color_arr[yj : yj + 2, :] *= 0.75

        for s in range(SPANS):
            x_center = s * SPAN_WIDTH + SPAN_WIDTH // 2
            for px in [x_center - 40, x_center + 40]:
                for py in [y0 + 16, y0 + 36]:
                    py_mod = py % HEIGHT
                    px_mod = px % WIDTH
                    heightmap[py_mod - 2 : py_mod + 3, px_mod - 2 : px_mod + 3] = -0.4
                    color_arr[py_mod - 2 : py_mod + 3, px_mod - 2 : px_mod + 3] *= 0.6

        panes_per_span = 4
        pane_w = SPAN_WIDTH // panes_per_span

        for p in range(SPANS * panes_per_span):
            px0 = p * pane_w
            px1 = px0 + pane_w
            g_refl = rng.uniform(0.18, 0.28)
            blind_y = rng.choice([0, 20, 40, 70])

            for y in range(w_top + 3, w_bot - 3):
                fy = y - w_top
                for x in range(px0 + 2, px1 - 2):
                    if fy < blind_y:
                        slat = 0.05 * ((y % 3) == 0)
                        color_arr[y, x] = [0.55 + slat, 0.53 + slat, 0.48 + slat]
                    else:
                        color_arr[y, x] = [g_refl * 0.7, g_refl * 0.9, g_refl * 1.1]
                    mask_arr[y, x] = 255

            heightmap[w_top:w_bot, px0 : px0 + 3] = 0.1
            color_arr[w_top:w_bot, px0 : px0 + 3] = [0.20, 0.18, 0.16]
            mask_arr[w_top:w_bot, px0 : px0 + 3] = 0

        heightmap[w_top : w_top + 3, :] = 0.1
        color_arr[w_top : w_top + 3, :] = [0.20, 0.18, 0.16]
        mask_arr[w_top : w_top + 3, :] = 0

        heightmap[w_bot - 3 : w_bot, :] = 0.1
        color_arr[w_bot - 3 : w_bot, :] = [0.20, 0.18, 0.16]
        mask_arr[w_bot - 3 : w_bot, :] = 0

    for s in range(SPANS):
        col_x = s * SPAN_WIDTH
        heightmap[:, col_x : col_x + 2] = -0.3
        color_arr[:, col_x : col_x + 2] *= 0.8

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.2)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# 3. Office Tile (1970s-90s Brown/Beige Tiled Office)
# -----------------------------------------------------------------------------


def generate_office_tile() -> tuple[Image.Image, Image.Image]:
    """3. office_tile: 1970-90s brown-beige porcelain tiled office building."""
    rng = np.random.default_rng(SEED + 3)
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    tile_w = 16
    tile_h = 8
    num_tiles_x = WIDTH // tile_w
    num_tiles_y = HEIGHT // tile_h

    tile_base_r = 0.62
    tile_base_g = 0.46
    tile_base_b = 0.35

    tile_noise = rng.uniform(-0.08, 0.08, (num_tiles_y, num_tiles_x))

    for ty in range(num_tiles_y):
        y0 = ty * tile_h
        x_shift = (tile_w // 2) if (ty % 2 == 1) else 0

        for tx in range(num_tiles_x):
            x0 = (tx * tile_w + x_shift) % WIDTH
            t_rand = tile_noise[ty, tx]
            r = np.clip(tile_base_r + t_rand * 1.0, 0.0, 1.0)
            g = np.clip(tile_base_g + t_rand * 0.9, 0.0, 1.0)
            b = np.clip(tile_base_b + t_rand * 0.8, 0.0, 1.0)

            for dy in range(tile_h):
                y = y0 + dy
                for dx in range(tile_w):
                    x = (x0 + dx) % WIDTH
                    is_joint = (dy == 0) or (dx == 0)
                    if is_joint:
                        color_arr[y, x] = [0.45, 0.43, 0.41]
                        heightmap[y, x] = -0.2
                    else:
                        color_arr[y, x] = [r, g, b]
                        heightmap[y, x] = 0.0

    for s in range(SPANS):
        px0 = s * SPAN_WIDTH - 12
        px1 = s * SPAN_WIDTH + 12
        for x in range(px0, px1):
            xm = x % WIDTH
            heightmap[:, xm] += 0.4
            color_arr[:, xm] *= 1.05

    for f in range(FLOORS):
        y0 = f * FLOOR_HEIGHT
        win_y0 = y0 + 26
        win_y1 = y0 + 114

        heightmap[y0 : y0 + 16, :] += 0.2
        heightmap[y0 + 124 : y0 + 140, :] += 0.2

        for s in range(SPANS):
            span_x0 = s * SPAN_WIDTH
            for wx_center in [span_x0 + 36, span_x0 + 92]:
                wx0 = wx_center - 18
                wx1 = wx_center + 18

                heightmap[win_y0:win_y1, wx0:wx1] = -0.8
                heightmap[win_y1 : win_y1 + 6, wx0 - 2 : wx1 + 2] = 0.3
                color_arr[win_y1 : win_y1 + 6, wx0 - 2 : wx1 + 2] = [0.35, 0.33, 0.30]

                color_arr[win_y0:win_y1, wx0:wx1] = [0.18, 0.15, 0.12]
                mask_arr[win_y0:win_y1, wx0:wx1] = 0

                gx0 = wx0 + 3
                gx1 = wx1 - 3
                gy0 = win_y0 + 3
                gy1 = win_y1 - 3

                g_refl = rng.uniform(0.20, 0.35)
                for gy in range(gy0, gy1):
                    for gx in range(gx0, gx1):
                        color_arr[gy, gx] = [g_refl * 0.6, g_refl * 0.8, g_refl * 1.0]
                        mask_arr[gy, gx] = 255

                mx = wx_center
                color_arr[gy0:gy1, mx - 1 : mx + 2] = [0.22, 0.18, 0.15]
                mask_arr[gy0:gy1, mx - 1 : mx + 2] = 0

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.0)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# 4. Apartment Balcony (Mansion / Condominium with Balconies)
# -----------------------------------------------------------------------------


def generate_apartment_balcony() -> tuple[Image.Image, Image.Image]:
    """4. apartment_balcony: Residential condominium with deep balconies and railings."""
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    tile_noise = seamless_fractal_noise(WIDTH, HEIGHT, scale=12.0, octaves=3, seed=401)
    base_color = np.array([0.82, 0.80, 0.76], dtype=np.float32)
    for c in range(3):
        color_arr[:, :, c] = base_color[c] + (tile_noise - 0.5) * 0.08

    for f in range(FLOORS):
        y0 = f * FLOOR_HEIGHT
        balcony_wall_y0 = y0 + 16
        balcony_wall_y1 = y0 + 136
        railing_y0 = y0 + 84
        railing_y1 = y0 + 136

        heightmap[y0 : y0 + 16, :] = 0.8
        color_arr[y0 : y0 + 16, :] = [0.88, 0.86, 0.82]

        heightmap[balcony_wall_y0:balcony_wall_y1, :] = -0.6

        for s in range(SPANS):
            span_x0 = s * SPAN_WIDTH
            span_x1 = span_x0 + SPAN_WIDTH

            part_x = span_x0
            heightmap[balcony_wall_y0:balcony_wall_y1, part_x - 3 : part_x + 4] = 0.2
            color_arr[balcony_wall_y0 + 20 : balcony_wall_y1 - 10, part_x - 2 : part_x + 3] = [0.65, 0.70, 0.68]

            for y in range(balcony_wall_y0, railing_y0):
                shadow_fact = 0.45 + 0.55 * ((y - balcony_wall_y0) / (railing_y0 - balcony_wall_y0))
                color_arr[y, span_x0 + 4 : span_x1 - 4] *= shadow_fact

            wx0 = span_x0 + 20
            wx1 = span_x0 + 108
            wy0 = balcony_wall_y0 + 10
            wy1 = wy0 + 96

            color_arr[wy0:wy1, wx0:wx1] = [0.25, 0.25, 0.25]
            mask_arr[wy0:wy1, wx0:wx1] = 0

            mid_x = (wx0 + wx1) // 2
            for px0, px1 in [(wx0 + 3, mid_x - 1), (mid_x + 1, wx1 - 3)]:
                curtain_fold = np.sin(np.linspace(0, 8 * math.pi, px1 - px0))[None, :] * 0.15
                for gy in range(wy0 + 3, wy1 - 3):
                    for gx_idx, gx in enumerate(range(px0, px1)):
                        c_val = 0.45 + curtain_fold[0, gx_idx]
                        color_arr[gy, gx] = [c_val * 0.8, c_val * 0.85, c_val * 0.95]
                        mask_arr[gy, gx] = 255

            heightmap[railing_y0 : railing_y0 + 4, span_x0 + 4 : span_x1 - 4] = 0.9
            color_arr[railing_y0 : railing_y0 + 4, span_x0 + 4 : span_x1 - 4] = [0.75, 0.78, 0.80]
            mask_arr[railing_y0 : railing_y0 + 4, span_x0 + 4 : span_x1 - 4] = 0

            for bx in range(span_x0 + 6, span_x1 - 6, 8):
                heightmap[railing_y0:railing_y1, bx : bx + 2] = 0.7
                color_arr[railing_y0:railing_y1, bx : bx + 2] = [0.70, 0.73, 0.75]
                mask_arr[railing_y0:railing_y1, bx : bx + 2] = 0

            f_top = railing_y0 + 12
            f_bot = railing_y1 - 4
            heightmap[f_top:f_bot, span_x0 + 6 : span_x1 - 6] = 0.5
            for gy in range(f_top, f_bot):
                for gx in range(span_x0 + 6, span_x1 - 6):
                    if (gx - span_x0 - 6) % 8 not in [0, 1]:
                        color_arr[gy, gx] = [0.55, 0.65, 0.70]
                        mask_arr[gy, gx] = 40

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.2)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# 5. Apartment Small (Compact Studio / Rental Siding & AC Units)
# -----------------------------------------------------------------------------


def generate_apartment_small() -> tuple[Image.Image, Image.Image]:
    """5. apartment_small: Small rental apartment with siding, sash windows, AC units."""
    rng = np.random.default_rng(SEED + 5)
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    siding_h = 14
    siding_noise = seamless_fractal_noise(WIDTH, HEIGHT, scale=20.0, octaves=3, seed=501)
    base_siding = np.array([0.90, 0.88, 0.84], dtype=np.float32)

    for y in range(HEIGHT):
        sy = y % siding_h
        lap_profile = (sy / siding_h) * 0.15
        s_val = base_siding + (siding_noise[y, :] - 0.5)[:, None] * 0.05 + lap_profile
        color_arr[y, :] = s_val
        heightmap[y, :] = (sy / siding_h) * 0.3
        if sy == 0:
            heightmap[y, :] = -0.3
            color_arr[y, :] *= 0.8

    for f in range(FLOORS):
        y0 = f * FLOOR_HEIGHT
        win_y0 = y0 + 30
        win_y1 = y0 + 98

        for s in range(SPANS):
            span_x0 = s * SPAN_WIDTH
            wx0 = span_x0 + 16
            wx1 = span_x0 + 72

            heightmap[win_y0:win_y1, wx0:wx1] = -0.6
            heightmap[win_y1 : win_y1 + 4, wx0 - 2 : wx1 + 2] = 0.4
            color_arr[win_y0:win_y1, wx0:wx1] = [0.85, 0.85, 0.88]
            mask_arr[win_y0:win_y1, wx0:wx1] = 0

            mid_wx = (wx0 + wx1) // 2
            for gx0, gx1 in [(wx0 + 3, mid_wx), (mid_wx, wx1 - 3)]:
                curtain_y = rng.choice([win_y1 - 3, win_y0 + 30, win_y0 + 50])
                for gy in range(win_y0 + 3, win_y1 - 3):
                    for gx in range(gx0, gx1):
                        if gy < curtain_y:
                            color_arr[gy, gx] = [0.78, 0.76, 0.72]
                        else:
                            color_arr[gy, gx] = [0.20, 0.25, 0.30]
                        mask_arr[gy, gx] = 255

            ac_x0 = span_x0 + 82
            ac_x1 = span_x0 + 118
            ac_y0 = y0 + 72
            ac_y1 = y0 + 102

            heightmap[ac_y0:ac_y1, ac_x0:ac_x1] = 0.7
            color_arr[ac_y0:ac_y1, ac_x0:ac_x1] = [0.80, 0.80, 0.78]
            mask_arr[ac_y0:ac_y1, ac_x0:ac_x1] = 0

            fan_cx = (ac_x0 + ac_x1) // 2 - 4
            fan_cy = (ac_y0 + ac_y1) // 2
            for ay in range(ac_y0, ac_y1):
                for ax in range(ac_x0, ac_x1):
                    dist = math.hypot(ax - fan_cx, ay - fan_cy)
                    if 4.0 < dist < 10.0:
                        if (ay + ax) % 3 == 0:
                            color_arr[ay, ax] = [0.35, 0.35, 0.35]
                            heightmap[ay, ax] = 0.5
                    if ax > ac_x1 - 8 and (ay % 3 == 0):
                        color_arr[ay, ax] = [0.30, 0.30, 0.30]
                        heightmap[ay, ax] = 0.4

            pipe_x = ac_x1 - 6
            heightmap[win_y0:ac_y0, pipe_x : pipe_x + 4] = 0.4
            color_arr[win_y0:ac_y0, pipe_x : pipe_x + 4] = [0.82, 0.82, 0.80]

            vent_cx = span_x0 + 100
            vent_cy = y0 + 26
            for vy in range(vent_cy - 7, vent_cy + 8):
                for vx in range(vent_cx - 7, vent_cx + 8):
                    dist = math.hypot(vx - vent_cx, vy - vent_cy)
                    if dist <= 6.0:
                        heightmap[vy, vx] = 0.8 - (dist / 6.0) * 0.4
                        color_arr[vy, vx] = [0.72, 0.74, 0.76]
                        mask_arr[vy, vx] = 0

    for s in range(SPANS):
        col_x = s * SPAN_WIDTH
        heightmap[:, col_x : col_x + 2] = -0.3
        color_arr[:, col_x : col_x + 2] *= 0.85

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.2)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# 6. Mixed Use (Tokyo Commercial / Tenant Mixed Building with Weathering)
# -----------------------------------------------------------------------------


def generate_mixed_use() -> tuple[Image.Image, Image.Image]:
    """6. mixed_use: Mixed tenant commercial building with irregular windows and rain stains."""
    rng = np.random.default_rng(SEED + 6)
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    tile_noise = seamless_fractal_noise(WIDTH, HEIGHT, scale=16.0, octaves=4, seed=601)
    weather_noise = seamless_fractal_noise(WIDTH, HEIGHT, scale=48.0, octaves=3, seed=602)

    base_col = np.array([0.72, 0.70, 0.65], dtype=np.float32)
    for c in range(3):
        color_arr[:, :, c] = base_col[c] + (tile_noise - 0.5) * 0.08 - (weather_noise * 0.12)

    for y in range(HEIGHT):
        if y % 8 == 0:
            color_arr[y, :] *= 0.85
            heightmap[y, :] = -0.15
    for x in range(WIDTH):
        if x % 8 == 0:
            color_arr[:, x] *= 0.85
            heightmap[:, x] = -0.15

    window_layouts = [
        [
            ("punch", 24, 60),
            ("louver", 84, 120),
            ("punch", 152, 188),
            ("punch", 216, 252),
            ("punch", 280, 316),
            ("louver", 340, 376),
            ("punch", 408, 444),
            ("punch", 472, 508),
        ],
        [("wide", 16, 112), ("wide", 144, 240), ("wide", 272, 368), ("wide", 400, 496)],
        [("pair", 12, 116), ("pair", 140, 244), ("pair", 268, 372), ("pair", 396, 500)],
        [("large", 16, 112), ("large", 144, 240), ("large", 272, 368), ("large", 400, 496)],
    ]

    for f in range(FLOORS):
        y0 = f * FLOOR_HEIGHT
        f_layout = window_layouts[f]

        heightmap[y0 : y0 + 10, :] = 0.3
        color_arr[y0 : y0 + 10, :] *= 1.05

        for wtype, wx0, wx1 in f_layout:
            if wtype == "punch":
                wy0 = y0 + 36
                wy1 = y0 + 104
                heightmap[wy0:wy1, wx0:wx1] = -0.7
                heightmap[wy1 : wy1 + 4, wx0 - 2 : wx1 + 2] = 0.4
                color_arr[wy0:wy1, wx0:wx1] = [0.15, 0.15, 0.15]
                mask_arr[wy0:wy1, wx0:wx1] = 0
                for gy in range(wy0 + 3, wy1 - 3):
                    for gx in range(wx0 + 3, wx1 - 3):
                        color_arr[gy, gx] = [0.20, 0.28, 0.35]
                        mask_arr[gy, gx] = 255

            elif wtype == "louver":
                wy0 = y0 + 40
                wy1 = y0 + 100
                heightmap[wy0:wy1, wx0:wx1] = -0.3
                color_arr[wy0:wy1, wx0:wx1] = [0.25, 0.25, 0.28]
                for ly in range(wy0, wy1, 4):
                    color_arr[ly : ly + 2, wx0:wx1] = [0.10, 0.10, 0.12]
                    heightmap[ly : ly + 2, wx0:wx1] = -0.5
                mask_arr[wy0:wy1, wx0:wx1] = 0

            elif wtype == "wide":
                wy0 = y0 + 30
                wy1 = y0 + 110
                heightmap[wy0:wy1, wx0:wx1] = -0.6
                heightmap[wy1 : wy1 + 5, wx0 - 2 : wx1 + 2] = 0.4
                color_arr[wy0:wy1, wx0:wx1] = [0.20, 0.18, 0.16]
                mask_arr[wy0:wy1, wx0:wx1] = 0
                step = (wx1 - wx0) // 3
                for p in range(3):
                    px0 = wx0 + p * step + 2
                    px1 = wx0 + (p + 1) * step - 2
                    for gy in range(wy0 + 3, wy1 - 3):
                        for gx in range(px0, px1):
                            color_arr[gy, gx] = [0.22, 0.30, 0.38]
                            mask_arr[gy, gx] = 255

            elif wtype == "pair":
                wy0 = y0 + 26
                wy1 = y0 + 114
                heightmap[wy0:wy1, wx0:wx1] = -0.6
                heightmap[wy1 : wy1 + 5, wx0 - 2 : wx1 + 2] = 0.4
                color_arr[wy0:wy1, wx0:wx1] = [0.18, 0.18, 0.20]
                mask_arr[wy0:wy1, wx0:wx1] = 0
                mid_x = (wx0 + wx1) // 2
                for px0, px1 in [(wx0 + 3, mid_x - 3), (mid_x + 3, wx1 - 3)]:
                    for gy in range(wy0 + 3, wy1 - 3):
                        for gx in range(px0, px1):
                            color_arr[gy, gx] = [0.25, 0.32, 0.40]
                            mask_arr[gy, gx] = 255

            elif wtype == "large":
                wy0 = y0 + 20
                wy1 = y0 + 126
                heightmap[wy0:wy1, wx0:wx1] = -0.8
                heightmap[wy1 : wy1 + 4, wx0 - 2 : wx1 + 2] = 0.3
                color_arr[wy0:wy1, wx0:wx1] = [0.12, 0.12, 0.14]
                mask_arr[wy0:wy1, wx0:wx1] = 0
                for gy in range(wy0 + 3, wy1 - 3):
                    for gx in range(wx0 + 3, wx1 - 3):
                        color_arr[gy, gx] = [0.18, 0.24, 0.32]
                        mask_arr[gy, gx] = 255

            for sx in [wx0, wx1]:
                streak_len = rng.integers(15, 35)
                for dy in range(streak_len):
                    sy = (wy1 + dy) % HEIGHT
                    for sx_off in range(-1, 2):
                        sxm = (sx + sx_off) % WIDTH
                        dirt = 0.75 + 0.25 * (dy / streak_len)
                        color_arr[sy, sxm] *= dirt

    for px in [126, 382]:
        heightmap[:, px : px + 4] = 0.6
        color_arr[:, px : px + 4] = [0.30, 0.30, 0.32]
        for by in range(0, HEIGHT, 35):
            heightmap[by : by + 3, px - 2 : px + 6] = 0.8
            color_arr[by : by + 3, px - 2 : px + 6] = [0.20, 0.20, 0.22]

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.2)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# 7. Metal Panel (Industrial Warehouse & ALC Cladding)
# -----------------------------------------------------------------------------


def generate_metal_panel() -> tuple[Image.Image, Image.Image]:
    """7. metal_panel: Industrial metal cladding / corrugated ALC warehouse with few windows."""
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    rib_w = 16
    fine_metal = seamless_fractal_noise(WIDTH, HEIGHT, scale=16.0, octaves=3, seed=701)

    base_slate = np.array([0.38, 0.42, 0.46], dtype=np.float32)

    for x in range(WIDTH):
        rx = x % rib_w
        if rx < 4:
            rib_h = (rx / 4.0) * 0.6
        elif rx < 10:
            rib_h = 0.6
        elif rx < 14:
            rib_h = (1.0 - (rx - 10) / 4.0) * 0.6
        else:
            rib_h = 0.0

        heightmap[:, x] = rib_h
        color_arr[:, x] = base_slate + (fine_metal[:, x] - 0.5)[:, None] * 0.04

    for y in range(0, HEIGHT, 70):
        heightmap[y : y + 2, :] -= 0.3
        color_arr[y : y + 2, :] = [0.15, 0.16, 0.18]

        for bx in range(0, WIDTH, 32):
            heightmap[max(0, y - 4) : min(HEIGHT, y + 6), bx - 2 : bx + 3] += 0.4
            color_arr[max(0, y - 4) : min(HEIGHT, y + 6), bx - 2 : bx + 3] = [0.60, 0.65, 0.70]

    for f in [0, 2]:
        y0 = f * FLOOR_HEIGHT
        wy0 = y0 + 36
        wy1 = y0 + 68

        for s in range(SPANS):
            span_x0 = s * SPAN_WIDTH
            wx0 = span_x0 + 16
            wx1 = span_x0 + 112

            heightmap[wy0:wy1, wx0:wx1] = -0.5
            heightmap[wy1 : wy1 + 4, wx0 - 2 : wx1 + 2] = 0.4
            color_arr[wy0:wy1, wx0:wx1] = [0.18, 0.20, 0.22]
            mask_arr[wy0:wy1, wx0:wx1] = 0

            pane_w = (wx1 - wx0) // 3
            for p in range(3):
                px0 = wx0 + p * pane_w + 2
                px1 = wx0 + (p + 1) * pane_w - 2
                for gy in range(wy0 + 3, wy1 - 3):
                    for gx in range(px0, px1):
                        wire = ((gy % 6 == 0) or (gx % 6 == 0)) * 0.08
                        color_arr[gy, gx] = [0.25 + wire, 0.32 + wire, 0.38 + wire]
                        mask_arr[gy, gx] = 255

    door_y0 = 3 * FLOOR_HEIGHT + 20
    door_y1 = 4 * FLOOR_HEIGHT
    for s in [1, 2]:
        dx0 = s * SPAN_WIDTH + 10
        dx1 = (s + 1) * SPAN_WIDTH - 10
        heightmap[door_y0:door_y1, dx0:dx1] = -0.4
        color_arr[door_y0:door_y1, dx0:dx1] = [0.32, 0.34, 0.36]
        for sy in range(door_y0 + 4, door_y1, 4):
            heightmap[sy : sy + 2, dx0:dx1] = -0.2
            color_arr[sy : sy + 2, dx0:dx1] = [0.22, 0.24, 0.26]

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.5)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# 8. Brick (Historic Marunouchi Style Classical Red Brick)
# -----------------------------------------------------------------------------


def generate_brick() -> tuple[Image.Image, Image.Image]:
    """8. brick: Historic red brick low-rise facade with white stone keystones and mouldings."""
    rng = np.random.default_rng(SEED + 8)
    color_arr = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    mask_arr = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    heightmap = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    brick_w = 16
    brick_h = 8
    num_bx = WIDTH // brick_w
    num_by = HEIGHT // brick_h

    brick_noise = rng.uniform(-0.12, 0.12, (num_by, num_bx))

    base_brick_r = 0.58
    base_brick_g = 0.22
    base_brick_b = 0.16

    for by in range(num_by):
        y0 = by * brick_h
        x_shift = (brick_w // 2) if (by % 2 == 1) else 0

        for bx in range(num_bx):
            x0 = (bx * brick_w + x_shift) % WIDTH
            b_rand = brick_noise[by, bx]
            r = np.clip(base_brick_r + b_rand * 0.9, 0.15, 0.85)
            g = np.clip(base_brick_g + b_rand * 0.5, 0.08, 0.50)
            b = np.clip(base_brick_b + b_rand * 0.4, 0.05, 0.40)

            for dy in range(brick_h):
                y = y0 + dy
                for dx in range(brick_w):
                    x = (x0 + dx) % WIDTH
                    is_joint = (dy == 0) or (dx == 0)
                    if is_joint:
                        color_arr[y, x] = [0.82, 0.80, 0.76]
                        heightmap[y, x] = -0.25
                    else:
                        color_arr[y, x] = [r, g, b]
                        heightmap[y, x] = 0.0

    for f in range(FLOORS):
        y0 = f * FLOOR_HEIGHT
        heightmap[y0 : y0 + 14, :] = 0.7
        color_arr[y0 : y0 + 14, :] = [0.88, 0.87, 0.84]
        heightmap[y0 + 14 : y0 + 16, :] = -0.3
        color_arr[y0 + 14 : y0 + 16, :] = [0.45, 0.44, 0.42]

        win_y0 = y0 + 34
        win_y1 = y0 + 116

        for s in range(SPANS):
            span_x0 = s * SPAN_WIDTH
            for wx_center in [span_x0 + 36, span_x0 + 92]:
                wx0 = wx_center - 18
                wx1 = wx_center + 18

                lintel_y0 = win_y0 - 12
                heightmap[lintel_y0:win_y0, wx0 - 4 : wx1 + 4] = 0.6
                color_arr[lintel_y0:win_y0, wx0 - 4 : wx1 + 4] = [0.90, 0.89, 0.86]

                heightmap[lintel_y0 - 2 : win_y0, wx_center - 3 : wx_center + 4] = 0.9
                color_arr[lintel_y0 - 2 : win_y0, wx_center - 3 : wx_center + 4] = [0.94, 0.93, 0.90]

                heightmap[win_y1 : win_y1 + 8, wx0 - 4 : wx1 + 4] = 0.7
                color_arr[win_y1 : win_y1 + 8, wx0 - 4 : wx1 + 4] = [0.90, 0.89, 0.86]

                heightmap[win_y0:win_y1, wx0:wx1] = -0.7
                color_arr[win_y0:win_y1, wx0:wx1] = [0.92, 0.92, 0.90]
                mask_arr[win_y0:win_y1, wx0:wx1] = 0

                mid_x = wx_center
                row_h = (win_y1 - win_y0) // 3
                for row in range(3):
                    ry0 = win_y0 + row * row_h + 3
                    ry1 = win_y0 + (row + 1) * row_h - 2
                    for rx0, rx1 in [(wx0 + 3, mid_x - 1), (mid_x + 2, wx1 - 3)]:
                        for gy in range(ry0, ry1):
                            for gx in range(rx0, rx1):
                                color_arr[gy, gx] = [0.18, 0.26, 0.34]
                                mask_arr[gy, gx] = 255

    for s in range(SPANS):
        qx = s * SPAN_WIDTH
        for f in range(FLOORS):
            y0 = f * FLOOR_HEIGHT
            for qi, qy in enumerate(range(y0 + 16, y0 + 138, 20)):
                qw = 14 if (qi % 2 == 0) else 8
                heightmap[qy : qy + 16, qx - qw : qx + qw] = 0.4
                color_arr[qy : qy + 16, qx - qw : qx + qw] = [0.86, 0.85, 0.82]

    shading = compute_normal_shading(heightmap, light_dir=(-0.5, -0.6, 0.6), strength=2.2)
    for c in range(3):
        color_arr[:, :, c] = np.clip(color_arr[:, :, c] * shading, 0.0, 1.0)

    rgb_img = Image.fromarray((color_arr * 255).astype(np.uint8), mode="RGB")
    mask_img = Image.fromarray(mask_arr, mode="L")
    return rgb_img, mask_img


# -----------------------------------------------------------------------------
# Registry & Contact Sheet
# -----------------------------------------------------------------------------

GENERATORS: list[tuple[str, Callable[[], tuple[Image.Image, Image.Image]]]] = [
    ("office_glass", generate_office_glass),
    ("office_concrete", generate_office_concrete),
    ("office_tile", generate_office_tile),
    ("apartment_balcony", generate_apartment_balcony),
    ("apartment_small", generate_apartment_small),
    ("mixed_use", generate_mixed_use),
    ("metal_panel", generate_metal_panel),
    ("brick", generate_brick),
]


def create_contact_sheet(textures: dict[str, tuple[Image.Image, Image.Image]], output_path: Path) -> None:
    """Create a contact sheet showing all 8 styles, their masks, and 3x3 tiled seamless views."""
    thumb_w, thumb_h = 256, 280
    tile_w, tile_h = 384, 420
    margin = 20
    header_h = 40
    row_h = tile_h + margin

    sheet_w = thumb_w * 2 + tile_w + margin * 4
    sheet_h = header_h + row_h * len(GENERATORS) + margin

    sheet = Image.new("RGB", (sheet_w, sheet_h), color=(30, 32, 36))
    draw = ImageDraw.Draw(sheet)

    draw.text(
        (margin, 12),
        "Tokyo Open Drive - Building Facade Textures & 3x3 Seamless Tile Verification",
        fill=(240, 240, 240),
    )

    for i, (name, _) in enumerate(GENERATORS):
        rgb_img, mask_img = textures[name]
        y = header_h + i * row_h

        draw.text((margin, y - 14), f"Style {i + 1}: {name}", fill=(220, 220, 160))

        # Col 1: Base RGB
        rgb_thumb = rgb_img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(rgb_thumb, (margin, y))

        # Col 2: Mask
        mask_rgb = mask_img.convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(mask_rgb, (margin * 2 + thumb_w, y))

        # Col 3: 3x3 Tiled RGB
        tiled_3x3 = Image.new("RGB", (WIDTH * 3, HEIGHT * 3))
        for ty in range(3):
            for tx in range(3):
                tiled_3x3.paste(rgb_img, (tx * WIDTH, ty * HEIGHT))
        tiled_thumb = tiled_3x3.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        sheet.paste(tiled_thumb, (margin * 3 + thumb_w * 2, y))

        draw.rectangle(
            [margin * 3 + thumb_w * 2, y, margin * 3 + thumb_w * 2 + tile_w, y + tile_h],
            outline=(80, 85, 95),
            width=1,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="PNG", optimize=True)
    print(f"Saved contact sheet to {output_path}")


def main() -> None:
    TEXTURES_DIR.mkdir(parents=True, exist_ok=True)

    generated_textures: dict[str, tuple[Image.Image, Image.Image]] = {}

    print(f"Generating {len(GENERATORS)} facade texture styles...")
    for name, gen_fn in GENERATORS:
        rgb_img, mask_img = gen_fn()
        generated_textures[name] = (rgb_img, mask_img)

        rgb_path = TEXTURES_DIR / f"facade_{name}.png"
        mask_path = TEXTURES_DIR / f"facade_{name}_mask.png"

        rgb_img.save(rgb_path, format="PNG", optimize=True)
        mask_img.save(mask_path, format="PNG", optimize=True)

        rgb_size_kb = rgb_path.stat().st_size / 1024
        mask_size_kb = mask_path.stat().st_size / 1024
        print(f"  - {name:20s}: facade={rgb_size_kb:6.1f} KB, mask={mask_size_kb:6.1f} KB")

    if len(sys.argv) > 1:
        contact_sheet_path = Path(sys.argv[1]).resolve()
        create_contact_sheet(generated_textures, contact_sheet_path)


if __name__ == "__main__":
    main()
