# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural tiling textures for Tokyo Station Marunouchi Building (2012 restoration).

Generates tileable PBR textures for the near-LOD model of Tokyo Station:
1. TS_BrickRed (ts_brick_basecolor.jpg, ts_brick_normal.png, ts_brick_rough.png):
   Fukurin-meji (覆輪目地) cosmetic brick facade. Tile 1.10 x 1.12 m (5 stretchers x 16 courses).
   Stretcher face 210 x 60 mm, joint 10 mm, half-brick offset (110 mm) per course.
   Joints are raised half-round mortar (sRGB ~#B8B0A4). Brick average sRGB ~#7E3D31, total avg ~#843F32.
2. TS_GraniteWhite (ts_granite_basecolor.jpg, ts_granite_normal.png, ts_granite_rough.png):
   Inada granite (白御影 / 稲田石). Tile 1.0 x 1.0 m. Average sRGB #C6C4BC with biotite, quartz, feldspar.
3. TS_SlateRoof (ts_slate_basecolor.jpg, ts_slate_normal.png, ts_slate_rough.png):
   Ogatsu natural slate ichimonji-buki (雄勝の天然スレート一文字葺き). Tile 1.0 x 1.05 m (7 courses).
   Average sRGB #46484E with ~5mm step down.
4. TS_CopperRoof (ts_copper_roof_basecolor.jpg, ts_copper_roof_normal.png, ts_copper_roof_rough.png):
   Weathered copper standing seam (縦はぜ葺き). Tile 0.9 x 0.9 m (2 seams running along V axis).
   Average sRGB #5A524E.
5. TS_CopperTrim (ts_copper_trim_basecolor.jpg, ts_copper_trim_rough.png):
   Copper-clad cornices and trims. Tile 1.0 x 1.0 m. Average sRGB #4A3C36.
6. TS_WindowFrame (ts_frame_basecolor.jpg):
   Ivory painted sash (sRGB #DAD6CC). Tile 1.0 x 1.0 m.
7. TS_Glass / TS_GlassLit (ts_glass_basecolor.jpg, ts_glass_night.jpg):
   Window glazing (256 x 512, UV 0-1 per window opening). Day: room, sky gradient, lace curtains, transom shadow.
   Night: warm lit interior with curtain and shade silhouettes.
8. TS_ClockFace (ts_clock_basecolor.png, ts_clock_night.png):
   Enamel clock dial (512 x 512, UV 0-1). White enamel #EDEBE4, Roman numerals I-XII (line drawn, no fonts),
   minute ticks, hands at 10:08. Night: illuminated dial with dark silhouettes.
9. TS_RoofGlass (ts_roofglass_basecolor.jpg):
   Central track-side roof glazing (512 x 512, Tile 1.5 x 1.5 m).
   Steel frame grid (#3A3E42), dark blue-grey glass (#5E6E76).

All textures are procedurally synthesized using NumPy and Pillow with a fixed seed. No external images,
photos, web assets, or font files are used.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SEED = 20261005
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "landmarks" / "textures"


# -----------------------------------------------------------------------------
# Toroidal / Seamless Noise Utilities
# -----------------------------------------------------------------------------
def seamless_fft_noise(
    width: int,
    height: int,
    alpha: float = 1.8,
    seed: int = 42,
    anisotropy: float = 1.0,
) -> np.ndarray:
    """Generate 2D seamless (toroidal) spectral noise using FFT (1/f^alpha).

    anisotropy > 1.0 stretches features along the Y (V) axis (useful for rain streaks / vertical weathering).
    """
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((height, width))
    f_white = np.fft.fft2(white)

    kx = np.fft.fftfreq(width)[None, :] * width
    ky = np.fft.fftfreq(height)[:, None] * height * (1.0 / anisotropy)
    freq = np.sqrt(kx**2 + ky**2)
    freq[0, 0] = 1.0

    filter_h = 1.0 / (freq**alpha)
    filter_h[0, 0] = 0.0

    filtered = f_white * filter_h
    res = np.real(np.fft.ifft2(filtered))
    n_min, n_max = res.min(), res.max()
    if n_max > n_min:
        return (res - n_min) / (n_max - n_min)
    return np.zeros_like(res)


def compute_periodic_normal_map(
    heightmap: np.ndarray,
    strength: float = 1.0,
) -> Image.Image:
    """Compute tangent space normal map (OpenGL format: R=X+, G=Y+, B=Z+) with periodic wrapping."""
    h, w = heightmap.shape
    # Periodic central differences: +X is right, +Y is up (which corresponds to -row direction in image array)
    dx = (np.roll(heightmap, -1, axis=1) - np.roll(heightmap, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(heightmap, 1, axis=0) - np.roll(heightmap, -1, axis=0)) * 0.5 * strength

    nx = -dx
    ny = -dy
    nz = np.ones((h, w), dtype=np.float32)

    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= length
    ny /= length
    nz /= length

    r = np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    g = np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    b = np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)

    normal_rgb = np.stack([r, g, b], axis=-1)
    return Image.fromarray(normal_rgb, mode="RGB")


def make_glTF_roughness_metallic(
    roughness: np.ndarray,
    metallic: np.ndarray | float = 0.0,
) -> Image.Image:
    """glTF metallicRoughness packing: R=unused (0), G=roughness (0..255), B=metallic (0..255)."""
    h, w = roughness.shape
    r = np.zeros((h, w), dtype=np.uint8)
    g = np.clip(roughness * 255.0 if roughness.max() <= 1.0 else roughness, 0, 255).astype(np.uint8)
    if isinstance(metallic, np.ndarray):
        b = np.clip(metallic * 255.0 if metallic.max() <= 1.0 else metallic, 0, 255).astype(np.uint8)
    else:
        b = np.full((h, w), int(metallic * 255.0), dtype=np.uint8)
    packed = np.stack([r, g, b], axis=-1)
    return Image.fromarray(packed, mode="RGB")


# -----------------------------------------------------------------------------
# 1. TS_BrickRed (1024x1024 / 512x512)
# -----------------------------------------------------------------------------
def generate_brick() -> tuple[Image.Image, Image.Image, Image.Image]:
    """Generate TS_BrickRed textures.

    1 tile = 1.10 m (u) x 1.12 m (v).
    5 bricks horizontally (pitch 0.22 m: 0.21 m brick + 0.01 m joint).
    16 courses vertically (pitch 0.07 m: 0.06 m brick + 0.01 m joint).
    Courses alternate offset by half brick (110 mm).
    Joint: Fukurin-meji (覆輪目地), 10mm wide, raised half-round ~2mm high, mortar sRGB ~#B8B0A4 (184, 176, 164).
    Brick base: sRGB ~#7E3D31 (126, 61, 49).
    Overall average with joints: sRGB ~#843F32 (132, 63, 50).
    Brick roughness 0.82..0.90, joint roughness 0.90, metallic 0.0.
    """
    size_bc = 1024
    size_nr = 512

    course_h = size_bc / 16.0  # 64.0 px
    brick_pitch = size_bc / 5.0  # 204.8 px
    joint_w = brick_pitch * (10.0 / 220.0)  # ~9.309 px
    joint_h = course_h * (10.0 / 70.0)  # ~9.143 px

    y_idx = np.arange(size_bc)[:, None]
    x_idx = np.arange(size_bc)[None, :]

    course_idx = (y_idx / course_h).astype(int) % 16
    y_in_course = (y_idx % course_h) - course_h / 2.0

    x_shift = (course_idx % 2) * (brick_pitch / 2.0)
    x_shifted = (x_idx - x_shift) % size_bc
    brick_col_idx = (x_shifted / brick_pitch).astype(int) % 5
    x_in_brick = (x_shifted % brick_pitch) - brick_pitch / 2.0

    brick_id = course_idx * 5 + brick_col_idx

    dist_h_joint = np.abs(np.abs(y_in_course) - course_h / 2.0)
    dist_v_joint = np.abs(np.abs(x_in_brick) - brick_pitch / 2.0)

    u_h = dist_h_joint / (joint_h / 2.0)
    u_v = dist_v_joint / (joint_w / 2.0)

    mask_h_joint = u_h < 1.0
    mask_v_joint = u_v < 1.0
    mask_joint = mask_h_joint | mask_v_joint

    profile_h = np.where(mask_h_joint, np.sqrt(np.maximum(0.0, 1.0 - u_h**2)), 0.0)
    profile_v = np.where(mask_v_joint, np.sqrt(np.maximum(0.0, 1.0 - u_v**2)), 0.0)
    joint_profile = np.maximum(profile_h, profile_v)

    brick_bevel_x = np.clip((np.abs(x_in_brick) - (brick_pitch / 2.0 - joint_w / 2.0 - 4.0)) / 4.0, 0.0, 1.0)
    brick_bevel_y = np.clip((np.abs(y_in_course) - (course_h / 2.0 - joint_h / 2.0 - 3.0)) / 3.0, 0.0, 1.0)
    brick_edge_falloff = np.maximum(brick_bevel_x, brick_bevel_y)
    brick_height = 0.82 - 0.12 * (brick_edge_falloff**2)

    n_brick_fine = seamless_fft_noise(size_bc, size_bc, alpha=1.2, seed=SEED + 101)
    n_brick_coarse = seamless_fft_noise(size_bc, size_bc, alpha=1.8, seed=SEED + 102)
    brick_height += (n_brick_fine - 0.5) * 0.05 + (n_brick_coarse - 0.5) * 0.04

    mortar_height = 0.65 + joint_profile * 0.25 + (n_brick_fine - 0.5) * 0.03
    total_height = np.where(mask_joint, mortar_height, brick_height)

    rng = np.random.default_rng(SEED + 100)
    num_bricks = 80
    b_light = rng.uniform(-0.08, 0.08, size=num_bricks)
    b_hue = rng.uniform(-0.04, 0.04, size=num_bricks)
    b_type = rng.random(size=num_bricks)
    is_purple = b_type < 0.05
    is_orange = (b_type >= 0.05) & (b_type < 0.08)

    brick_r_lut = np.full(num_bricks, 126.0)
    brick_g_lut = np.full(num_bricks, 61.0)
    brick_b_lut = np.full(num_bricks, 49.0)

    for b in range(num_bricks):
        if is_purple[b]:
            brick_r_lut[b] = 94.0 * rng.uniform(0.95, 1.05)
            brick_g_lut[b] = 48.0 * rng.uniform(0.95, 1.05)
            brick_b_lut[b] = 40.0 * rng.uniform(0.95, 1.05)
        elif is_orange[b]:
            brick_r_lut[b] = 154.0 * rng.uniform(0.95, 1.05)
            brick_g_lut[b] = 82.0 * rng.uniform(0.95, 1.05)
            brick_b_lut[b] = 56.0 * rng.uniform(0.95, 1.05)
        else:
            k = 1.0 + b_light[b]
            h = b_hue[b]
            brick_r_lut[b] = np.clip(126.0 * k + h * 30.0, 80, 180)
            brick_g_lut[b] = np.clip(61.0 * k, 35, 100)
            brick_b_lut[b] = np.clip(49.0 * k - h * 20.0, 30, 85)

    brick_r = brick_r_lut[brick_id]
    brick_g = brick_g_lut[brick_id]
    brick_b = brick_b_lut[brick_id]

    macro_n = seamless_fft_noise(size_bc, size_bc, alpha=2.2, seed=SEED + 103)
    brick_r += (n_brick_fine - 0.5) * 14.0 + (macro_n - 0.5) * 8.0
    brick_g += (n_brick_fine - 0.5) * 10.0 + (macro_n - 0.5) * 6.0
    brick_b += (n_brick_fine - 0.5) * 8.0 + (macro_n - 0.5) * 5.0

    mortar_r = 184.0 + joint_profile * 18.0 + (n_brick_fine - 0.5) * 10.0
    mortar_g = 176.0 + joint_profile * 16.0 + (n_brick_fine - 0.5) * 10.0
    mortar_b = 164.0 + joint_profile * 14.0 + (n_brick_fine - 0.5) * 10.0

    blend = np.clip((1.0 - np.minimum(u_h, u_v)) * 3.0, 0.0, 1.0)[:, :, None]
    mortar_rgb = np.stack([mortar_r, mortar_g, mortar_b], axis=-1)
    brick_rgb = np.stack([brick_r, brick_g, brick_b], axis=-1)
    col_rgb = brick_rgb * (1.0 - blend) + mortar_rgb * blend

    cur_avg = col_rgb.mean(axis=(0, 1))
    target_avg = np.array([132.0, 63.0, 50.0])
    col_rgb += target_avg - cur_avg

    col_img = Image.fromarray(np.clip(col_rgb, 0, 255).astype(np.uint8), mode="RGB")

    height_512 = (
        np.array(
            Image.fromarray((total_height * 255.0).astype(np.uint8)).resize(
                (size_nr, size_nr), Image.Resampling.LANCZOS
            ),
            dtype=np.float32,
        )
        / 255.0
    )
    normal_img = compute_periodic_normal_map(height_512, strength=3.5)

    n_rough = seamless_fft_noise(size_nr, size_nr, alpha=1.5, seed=SEED + 104)
    blend_512 = (
        np.array(
            Image.fromarray((blend[:, :, 0] * 255.0).astype(np.uint8)).resize(
                (size_nr, size_nr), Image.Resampling.BILINEAR
            ),
            dtype=np.float32,
        )
        / 255.0
    )
    rough_val = (0.84 + n_rough * 0.05) * (1.0 - blend_512) + 0.90 * blend_512
    rough_img = make_glTF_roughness_metallic(rough_val, metallic=0.0)

    return col_img, normal_img, rough_img


# -----------------------------------------------------------------------------
# 2. TS_GraniteWhite (1024x1024 / 512x512)
# -----------------------------------------------------------------------------
def generate_granite() -> tuple[Image.Image, Image.Image, Image.Image]:
    """Generate TS_GraniteWhite textures (Inada granite / 稲田石).

    1 tile = 1.0 x 1.0 m.
    Matrix: white to light grey (average sRGB #C6C4BC = 198, 196, 188).
    Biotite (黒雲母): 1-3 mm grains, #2A2A2A (42, 42, 42), area 2-4%.
    Quartz (石英): grey glassy grains, 2-5 mm.
    Feldspar (長石): warm white / slightly cream grains, 2-5 mm.
    No mortar joints (目地は描かない).
    Roughness: 0.6..0.7, normal: fine mineral grain micro-relief.
    """
    size_bc = 1024
    size_nr = 512

    n_macro = seamless_fft_noise(size_bc, size_bc, alpha=2.2, seed=SEED + 201)
    n_meso = seamless_fft_noise(size_bc, size_bc, alpha=1.5, seed=SEED + 202)
    n_micro = seamless_fft_noise(size_bc, size_bc, alpha=0.9, seed=SEED + 203)

    base_r = 203.0 + (n_macro - 0.5) * 12.0 + (n_meso - 0.5) * 10.0 + (n_micro - 0.5) * 8.0
    base_g = 201.0 + (n_macro - 0.5) * 12.0 + (n_meso - 0.5) * 10.0 + (n_micro - 0.5) * 8.0
    base_b = 194.0 + (n_macro - 0.5) * 14.0 + (n_meso - 0.5) * 11.0 + (n_micro - 0.5) * 8.0

    n_quartz = seamless_fft_noise(size_bc, size_bc, alpha=1.2, seed=SEED + 204)
    mask_quartz = n_quartz > 0.72
    q_darkening = (n_quartz - 0.72) * 2.5
    base_r = np.where(mask_quartz, base_r - q_darkening * 35.0, base_r)
    base_g = np.where(mask_quartz, base_g - q_darkening * 30.0, base_g)
    base_b = np.where(mask_quartz, base_b - q_darkening * 22.0, base_b)

    # Biotite (黒雲母) using seamless toroidal noise thresholding for 100% seamless edges
    n_biotite = seamless_fft_noise(size_bc, size_bc, alpha=0.7, seed=SEED + 206)
    n_biotite_clump = seamless_fft_noise(size_bc, size_bc, alpha=1.4, seed=SEED + 207)
    biotite_metric = n_biotite * 0.7 + n_biotite_clump * 0.3
    # Top 3% area for biotite
    biotite_thresh = float(np.percentile(biotite_metric, 97.0))
    biotite_mask = np.clip((biotite_metric - biotite_thresh) * 30.0, 0.0, 1.0)

    # Composite biotite #2A2A2A (42, 42, 42)
    b_val = 42.0
    base_r = base_r * (1.0 - biotite_mask) + b_val * biotite_mask
    base_g = base_g * (1.0 - biotite_mask) + b_val * biotite_mask
    base_b = base_b * (1.0 - biotite_mask) + (b_val + 2.0) * biotite_mask

    col_rgb = np.stack([base_r, base_g, base_b], axis=-1)

    cur_avg = col_rgb.mean(axis=(0, 1))
    target_avg = np.array([198.0, 196.0, 188.0])
    col_rgb += target_avg - cur_avg

    col_img = Image.fromarray(np.clip(col_rgb, 0, 255).astype(np.uint8), mode="RGB")

    granite_height = 0.5 + (n_micro - 0.5) * 0.2 + (mask_quartz.astype(np.float32) * 0.1) - (biotite_mask * 0.18)
    h_512 = (
        np.array(
            Image.fromarray((np.clip(granite_height, 0, 1) * 255.0).astype(np.uint8)).resize(
                (size_nr, size_nr), Image.Resampling.LANCZOS
            ),
            dtype=np.float32,
        )
        / 255.0
    )
    normal_img = compute_periodic_normal_map(h_512, strength=2.2)

    b_512 = (
        np.array(
            Image.fromarray((biotite_mask * 255.0).astype(np.uint8)).resize(
                (size_nr, size_nr), Image.Resampling.BILINEAR
            ),
            dtype=np.float32,
        )
        / 255.0
    )
    n_r512 = seamless_fft_noise(size_nr, size_nr, alpha=1.2, seed=SEED + 205)
    rough_val = 0.65 + (n_r512 - 0.5) * 0.08 - b_512 * 0.08
    rough_img = make_glTF_roughness_metallic(rough_val, metallic=0.0)

    return col_img, normal_img, rough_img


# -----------------------------------------------------------------------------
# 3. TS_SlateRoof (1024x1024 / 512x512)
# -----------------------------------------------------------------------------
def generate_slate() -> tuple[Image.Image, Image.Image, Image.Image]:
    """Generate TS_SlateRoof textures (Ogatsu natural slate / 雄勝の天然スレート一文字葺き).

    1 tile = 1.0 m (u: eaves direction) x 1.05 m (v: slope direction).
    7 courses of rectangular shingles (width 0.25 m = 4 shingles per row in 1.0 m,
    exposure 0.15 m = 7 courses in 1.05 m).
    Each course is offset by half shingle (0.125 m = 128 px in 1024).
    Colour: deep charcoal (average sRGB #46484E = 70, 72, 78, faintly bluish-green).
    Shingle variation: brightness +-10%, occasional brownish-grey slate (#554E48).
    Step down: ~5mm step at lower edge of each course with slight irregular chipping.
    Roughness: 0.45..0.60 (slight sheen).
    """
    size_bc = 1024
    size_nr = 512

    course_h = size_bc / 7.0
    shingle_w = size_bc / 4.0

    y_idx = np.arange(size_bc)[:, None]
    x_idx = np.arange(size_bc)[None, :]

    course_idx = (y_idx / course_h).astype(int) % 7
    y_in_course = y_idx % course_h

    x_shift = (course_idx % 2) * (shingle_w / 2.0)
    x_shifted = (x_idx - x_shift) % size_bc
    shingle_col_idx = (x_shifted / shingle_w).astype(int) % 4

    shingle_id = course_idx * 4 + shingle_col_idx

    rng = np.random.default_rng(SEED + 300)
    num_shingles = 28
    s_light = rng.uniform(-0.10, 0.10, size=num_shingles)
    s_is_brown = rng.random(size=num_shingles) < 0.15

    shingle_r_lut = np.full(num_shingles, 70.0)
    shingle_g_lut = np.full(num_shingles, 72.0)
    shingle_b_lut = np.full(num_shingles, 78.0)

    for s in range(num_shingles):
        if s_is_brown[s]:
            shingle_r_lut[s] = 85.0 * rng.uniform(0.95, 1.05)
            shingle_g_lut[s] = 78.0 * rng.uniform(0.95, 1.05)
            shingle_b_lut[s] = 72.0 * rng.uniform(0.95, 1.05)
        else:
            k = 1.0 + s_light[s]
            shingle_r_lut[s] = np.clip(70.0 * k, 45, 95)
            shingle_g_lut[s] = np.clip(72.0 * k, 48, 98)
            shingle_b_lut[s] = np.clip(78.0 * k, 52, 105)

    base_r = shingle_r_lut[shingle_id]
    base_g = shingle_g_lut[shingle_id]
    base_b = shingle_b_lut[shingle_id]

    n_slate = seamless_fft_noise(size_bc, size_bc, alpha=1.6, seed=SEED + 301, anisotropy=0.3)
    n_macro = seamless_fft_noise(size_bc, size_bc, alpha=2.2, seed=SEED + 302)
    base_r += (n_slate - 0.5) * 8.0 + (n_macro - 0.5) * 5.0
    base_g += (n_slate - 0.5) * 8.0 + (n_macro - 0.5) * 5.0
    base_b += (n_slate - 0.5) * 9.0 + (n_macro - 0.5) * 5.0

    # Toroidal edge noise for slate lap
    edge_noise = seamless_fft_noise(size_bc, size_bc, alpha=1.2, seed=SEED + 303) * 6.0
    dist_to_lap = (y_in_course + edge_noise) % course_h
    is_lap_shadow = (dist_to_lap < 5.0) & (y_in_course < 15.0)
    base_r = np.where(is_lap_shadow, base_r * 0.65, base_r)
    base_g = np.where(is_lap_shadow, base_g * 0.65, base_g)
    base_b = np.where(is_lap_shadow, base_b * 0.65, base_b)

    dist_to_v_slit = np.minimum(x_shifted % shingle_w, shingle_w - (x_shifted % shingle_w))
    is_v_slit = dist_to_v_slit < 1.5
    base_r = np.where(is_v_slit, base_r * 0.7, base_r)
    base_g = np.where(is_v_slit, base_g * 0.7, base_g)
    base_b = np.where(is_v_slit, base_b * 0.7, base_b)

    col_rgb = np.stack([base_r, base_g, base_b], axis=-1)

    cur_avg = col_rgb.mean(axis=(0, 1))
    target_avg = np.array([70.0, 72.0, 78.0])
    col_rgb += target_avg - cur_avg

    col_img = Image.fromarray(np.clip(col_rgb, 0, 255).astype(np.uint8), mode="RGB")

    shingle_wedge = (y_in_course / course_h) * 0.35
    slate_height = shingle_wedge + (n_slate - 0.5) * 0.05
    slate_height -= np.clip((2.5 - dist_to_v_slit) / 2.5, 0.0, 1.0) * 0.08

    h_512 = (
        np.array(
            Image.fromarray((np.clip(slate_height, 0, 1) * 255.0).astype(np.uint8)).resize(
                (size_nr, size_nr), Image.Resampling.LANCZOS
            ),
            dtype=np.float32,
        )
        / 255.0
    )
    normal_img = compute_periodic_normal_map(h_512, strength=3.0)

    n_r = seamless_fft_noise(size_nr, size_nr, alpha=1.4, seed=SEED + 304)
    rough_val = 0.52 + (n_r - 0.5) * 0.12
    rough_img = make_glTF_roughness_metallic(rough_val, metallic=0.0)

    return col_img, normal_img, rough_img


# -----------------------------------------------------------------------------
# 4. TS_CopperRoof (512x512)
# -----------------------------------------------------------------------------
def generate_copper_roof() -> tuple[Image.Image, Image.Image, Image.Image]:
    """Generate TS_CopperRoof textures (weathered copper standing seam / 銅板の縦はぜ葺き).

    1 tile = 0.9 x 0.9 m.
    Standing seams (幅 15 mm, 高さ約 25 mm) run along V (vertical), spaced 0.45 m in U (2 seams per tile).
    In 512x512: 2 seams at x = 0 (and 512 wrapped) and x = 256. Width 15mm = ~8.5 px.
    Colour: weathered dark brown to greyish-brown (average sRGB #5A524E = 90, 82, 78).
    Vertical rain streaks (雨筋の縦の濃淡), seam ridges slightly highlighted.
    Metallic 0.5, Roughness 0.45..0.55.
    """
    size = 512
    x_idx = np.arange(size)[None, :]

    dist_seam0 = np.minimum(x_idx, size - x_idx)
    dist_seam1 = np.abs(x_idx - (size / 2.0))
    dist_seam = np.minimum(dist_seam0, dist_seam1)

    seam_half_w = 4.5
    mask_seam = dist_seam <= seam_half_w
    seam_profile = np.where(mask_seam, np.sqrt(np.maximum(0.0, 1.0 - (dist_seam / seam_half_w) ** 2)), 0.0)

    n_streaks = seamless_fft_noise(size, size, alpha=2.0, seed=SEED + 401, anisotropy=8.0)
    n_micro = seamless_fft_noise(size, size, alpha=1.2, seed=SEED + 402)

    base_r = 90.0 + (n_streaks - 0.5) * 16.0 + (n_micro - 0.5) * 8.0
    base_g = 82.0 + (n_streaks - 0.5) * 14.0 + (n_micro - 0.5) * 7.0
    base_b = 78.0 + (n_streaks - 0.5) * 13.0 + (n_micro - 0.5) * 7.0

    base_r += seam_profile * 14.0
    base_g += seam_profile * 13.0
    base_b += seam_profile * 12.0

    col_rgb = np.stack([base_r, base_g, base_b], axis=-1)

    cur_avg = col_rgb.mean(axis=(0, 1))
    target_avg = np.array([90.0, 82.0, 78.0])
    col_rgb += target_avg - cur_avg

    col_img = Image.fromarray(np.clip(col_rgb, 0, 255).astype(np.uint8), mode="RGB")

    heightmap = seam_profile * 0.7 + (n_micro - 0.5) * 0.05
    normal_img = compute_periodic_normal_map(heightmap, strength=4.5)

    rough_val = 0.50 + (n_streaks - 0.5) * 0.08
    rough_img = make_glTF_roughness_metallic(rough_val, metallic=0.5)

    return col_img, normal_img, rough_img


# -----------------------------------------------------------------------------
# 5. TS_CopperTrim (512x512)
# -----------------------------------------------------------------------------
def generate_copper_trim() -> tuple[Image.Image, Image.Image]:
    """Generate TS_CopperTrim textures (cornices, balustrades, decorations).

    1 tile = 1.0 x 1.0 m.
    Average sRGB #4A3C36 = (74, 60, 54).
    Dark reddish-brown with vertical rain streaks and rare dark greenish spots (<3% area).
    Metallic 0.45, Roughness 0.50..0.60. No normal map required.
    """
    size = 512

    n_streaks = seamless_fft_noise(size, size, alpha=2.2, seed=SEED + 501, anisotropy=6.0)
    n_fine = seamless_fft_noise(size, size, alpha=1.3, seed=SEED + 502)

    base_r = 74.0 + (n_streaks - 0.5) * 15.0 + (n_fine - 0.5) * 8.0
    base_g = 60.0 + (n_streaks - 0.5) * 13.0 + (n_fine - 0.5) * 6.0
    base_b = 54.0 + (n_streaks - 0.5) * 11.0 + (n_fine - 0.5) * 5.0

    n_patina = seamless_fft_noise(size, size, alpha=1.5, seed=SEED + 503)
    mask_patina = n_patina > 0.82
    p_weight = (n_patina - 0.82) * 5.0

    base_r = np.where(mask_patina, base_r * (1.0 - p_weight) + 64.0 * p_weight, base_r)
    base_g = np.where(mask_patina, base_g * (1.0 - p_weight) + 72.0 * p_weight, base_g)
    base_b = np.where(mask_patina, base_b * (1.0 - p_weight) + 60.0 * p_weight, base_b)

    col_rgb = np.stack([base_r, base_g, base_b], axis=-1)

    cur_avg = col_rgb.mean(axis=(0, 1))
    target_avg = np.array([74.0, 60.0, 54.0])
    col_rgb += target_avg - cur_avg

    col_img = Image.fromarray(np.clip(col_rgb, 0, 255).astype(np.uint8), mode="RGB")

    rough_val = 0.55 + (n_streaks - 0.5) * 0.08
    rough_img = make_glTF_roughness_metallic(rough_val, metallic=0.45)

    return col_img, rough_img


# -----------------------------------------------------------------------------
# 6. TS_WindowFrame (256x256)
# -----------------------------------------------------------------------------
def generate_window_frame() -> Image.Image:
    """Generate TS_WindowFrame basecolor.

    1 tile = 1.0 x 1.0 m.
    Ivory paint (average sRGB #DAD6CC = 218, 214, 204), very subtle paint stroke / roller texture.
    """
    size = 256
    n_macro = seamless_fft_noise(size, size, alpha=2.0, seed=SEED + 601)
    n_fine = seamless_fft_noise(size, size, alpha=1.2, seed=SEED + 602)

    base_r = 218.0 + (n_macro - 0.5) * 6.0 + (n_fine - 0.5) * 4.0
    base_g = 214.0 + (n_macro - 0.5) * 6.0 + (n_fine - 0.5) * 4.0
    base_b = 204.0 + (n_macro - 0.5) * 6.0 + (n_fine - 0.5) * 4.0

    col_rgb = np.stack([base_r, base_g, base_b], axis=-1)

    cur_avg = col_rgb.mean(axis=(0, 1))
    target_avg = np.array([218.0, 214.0, 204.0])
    col_rgb += target_avg - cur_avg

    return Image.fromarray(np.clip(col_rgb, 0, 255).astype(np.uint8), mode="RGB")


# -----------------------------------------------------------------------------
# 7. TS_Glass & TS_GlassLit (256x512)
# -----------------------------------------------------------------------------
def generate_glass() -> tuple[Image.Image, Image.Image]:
    """Generate TS_Glass (day) and TS_GlassLit (night) textures.

    Resolution: 256 x 512 (aspect 1:2, UV 0..1 per window opening, v=1 top, v=0 bottom).
    Day: Dark interior (#2C3238 = 44, 50, 56), pale vertical sky reflection gradient in upper half,
         white lace curtains pulled halfway from both left and right (asymmetrical to avoid repetition),
         transom horizontal bar shadow at top 24% (y=0.24 from top -> v=0.76).
    Night: Warm interior illumination (white to pale cream), curtain silhouettes, shade bottom edge.
    """
    w, h = 256, 512
    y_idx = np.arange(h)[:, None]
    x_idx = np.arange(w)[None, :]

    day_r = np.full((h, w), 44.0)
    day_g = np.full((h, w), 50.0)
    day_b = np.full((h, w), 56.0)

    sky_grad = np.clip(1.0 - (y_idx / (h * 0.55)), 0.0, 1.0)
    day_r += sky_grad * 45.0
    day_g += sky_grad * 58.0
    day_b += sky_grad * 75.0

    n_curtain = seamless_fft_noise(w, h, alpha=1.6, seed=SEED + 701, anisotropy=4.0)
    left_fold = np.sin(x_idx * 0.15) * 0.15 + (n_curtain - 0.5) * 0.2
    right_fold = np.sin(x_idx * 0.18 + 1.2) * 0.15 + (n_curtain - 0.5) * 0.2

    left_curtain = np.clip((0.42 + left_fold - (x_idx / w)) * 4.0, 0.0, 1.0)
    right_curtain = np.clip(((x_idx / w) - (0.65 - right_fold)) * 4.0, 0.0, 1.0)
    curtain_mask = np.maximum(left_curtain, right_curtain)

    day_r = day_r * (1.0 - curtain_mask * 0.65) + 216.0 * (curtain_mask * 0.65)
    day_g = day_g * (1.0 - curtain_mask * 0.65) + 214.0 * (curtain_mask * 0.65)
    day_b = day_b * (1.0 - curtain_mask * 0.65) + 206.0 * (curtain_mask * 0.65)

    transom_y = int(h * 0.24)
    shadow_band = np.exp(-0.5 * ((y_idx - transom_y) / 6.0) ** 2) * 0.6
    day_r *= 1.0 - shadow_band
    day_g *= 1.0 - shadow_band
    day_b *= 1.0 - shadow_band

    day_rgb = np.stack([day_r, day_g, day_b], axis=-1)
    day_img = Image.fromarray(np.clip(day_rgb, 0, 255).astype(np.uint8), mode="RGB")

    night_r = 250.0 - (y_idx / h) * 30.0
    night_g = 242.0 - (y_idx / h) * 40.0
    night_b = 220.0 - (y_idx / h) * 55.0

    shade_y = 135.0 + (x_idx / w) * 15.0
    is_shade = y_idx < shade_y
    shade_darkness = 0.45
    night_r = np.where(is_shade, night_r * shade_darkness, night_r)
    night_g = np.where(is_shade, night_g * shade_darkness, night_g)
    night_b = np.where(is_shade, night_b * shade_darkness, night_b)

    is_shade_hem = np.abs(y_idx - shade_y) < 3.0
    night_r = np.where(is_shade_hem, night_r * 0.6, night_r)
    night_g = np.where(is_shade_hem, night_g * 0.6, night_g)
    night_b = np.where(is_shade_hem, night_b * 0.6, night_b)

    night_r = np.where(~is_shade, night_r * (1.0 - curtain_mask * 0.4), night_r)
    night_g = np.where(~is_shade, night_g * (1.0 - curtain_mask * 0.4), night_g)
    night_b = np.where(~is_shade, night_b * (1.0 - curtain_mask * 0.4), night_b)

    night_r *= 1.0 - shadow_band * 0.7
    night_g *= 1.0 - shadow_band * 0.7
    night_b *= 1.0 - shadow_band * 0.7

    night_rgb = np.stack([night_r, night_g, night_b], axis=-1)
    night_img = Image.fromarray(np.clip(night_rgb, 0, 255).astype(np.uint8), mode="RGB")

    return day_img, night_img


# -----------------------------------------------------------------------------
# 8. TS_ClockFace (512x512)
# -----------------------------------------------------------------------------
def generate_clock() -> tuple[Image.Image, Image.Image]:
    """Generate TS_ClockFace basecolor and night emissive mask.

    Resolution: 512 x 512.
    Dial: White enamel (#EDEBE4 = 237, 235, 228).
    Outer black ring and 60-minute tick marks.
    Roman numerals I through XII drawn using geometric lines (NO FONTS).
    Hands positioned at 10:08 (hour hand at 10.133, minute hand at 8.0 min).
    Outside circular dial is painted same enamel color.
    Night: Dial glows brightly, markings / numerals / hands are dark silhouettes.
    """
    size = 512
    ss = 2
    w_ss = size * ss
    h_ss = size * ss
    cx, cy = w_ss / 2.0, h_ss / 2.0
    r_dial = w_ss * 0.46

    im_day = Image.new("RGB", (w_ss, h_ss), (237, 235, 228))
    im_night = Image.new("RGB", (w_ss, h_ss), (255, 250, 235))
    draw_day = ImageDraw.Draw(im_day)
    draw_night = ImageDraw.Draw(im_night)

    black = (24, 24, 26)
    night_black = (12, 12, 14)

    for r_offset, line_w in ((0.0, 4 * ss), (-12 * ss, 2 * ss)):
        r = r_dial + r_offset
        bbox = [cx - r, cy - r, cx + r, cy + r]
        draw_day.ellipse(bbox, outline=black, width=line_w)
        draw_night.ellipse(bbox, outline=night_black, width=line_w)

    for m in range(60):
        angle_rad = math.radians(m * 6.0 - 90.0)
        cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
        is_hour = m % 5 == 0
        r_outer = r_dial - 13 * ss
        r_inner = r_dial - (30 * ss if is_hour else 20 * ss)
        width_m = (4 if is_hour else 2) * ss

        p0 = (cx + r_inner * cos_a, cy + r_inner * sin_a)
        p1 = (cx + r_outer * cos_a, cy + r_outer * sin_a)
        draw_day.line([p0, p1], fill=black, width=width_m)
        draw_night.line([p0, p1], fill=night_black, width=width_m)

    r_num = r_dial * 0.68

    def draw_roman_glyph(char: str, px: float, py: float, scale: float, angle_rad: float):
        lines = []
        if char == "I":
            lines.append([(-0.15, -0.5), (0.15, -0.5)])
            lines.append([(0.0, -0.5), (0.0, 0.5)])
            lines.append([(-0.15, 0.5), (0.15, 0.5)])
        elif char == "V":
            lines.append([(-0.4, -0.5), (0.0, 0.5)])
            lines.append([(0.4, -0.5), (0.0, 0.5)])
            lines.append([(-0.5, -0.5), (-0.3, -0.5)])
            lines.append([(0.3, -0.5), (0.5, -0.5)])
        elif char == "X":
            lines.append([(-0.4, -0.5), (0.4, 0.5)])
            lines.append([(0.4, -0.5), (-0.4, 0.5)])
            lines.append([(-0.5, -0.5), (-0.3, -0.5)])
            lines.append([(0.3, -0.5), (0.5, -0.5)])
            lines.append([(-0.5, 0.5), (-0.3, 0.5)])
            lines.append([(0.3, 0.5), (0.5, 0.5)])

        for p_start, p_end in lines:
            x0 = px + p_start[0] * scale
            y0 = py + p_start[1] * scale
            x1 = px + p_end[0] * scale
            y1 = py + p_end[1] * scale
            draw_day.line([(x0, y0), (x1, y1)], fill=black, width=max(1, int(2.5 * ss)))
            draw_night.line([(x0, y0), (x1, y1)], fill=night_black, width=max(1, int(2.5 * ss)))

    numerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
    glyph_scale = 26.0 * ss

    for idx, num_str in enumerate(numerals):
        hour_val = idx
        ang = math.radians(hour_val * 30.0 - 90.0)
        nx = cx + r_num * math.cos(ang)
        ny = cy + r_num * math.sin(ang)

        n_chars = len(num_str)
        char_spacing = glyph_scale * 0.75
        start_x = nx - ((n_chars - 1) * char_spacing) / 2.0

        for c_i, ch in enumerate(num_str):
            draw_roman_glyph(ch, start_x + c_i * char_spacing, ny, glyph_scale, ang)

    hour_ang = math.radians(10.1333 * 30.0 - 90.0)
    min_ang = math.radians(8.0 * 6.0 - 90.0)

    h_len = r_dial * 0.52
    h_tail = r_dial * 0.12
    hx0 = cx - h_tail * math.cos(hour_ang)
    hy0 = cy - h_tail * math.sin(hour_ang)
    hx1 = cx + h_len * math.cos(hour_ang)
    hy1 = cy + h_len * math.sin(hour_ang)
    draw_day.line([(hx0, hy0), (hx1, hy1)], fill=black, width=7 * ss)
    draw_night.line([(hx0, hy0), (hx1, hy1)], fill=night_black, width=7 * ss)

    diam_c = (cx + h_len * 0.72 * math.cos(hour_ang), cy + h_len * 0.72 * math.sin(hour_ang))
    d_perp = (-math.sin(hour_ang) * 9 * ss, math.cos(hour_ang) * 9 * ss)
    d_fwd = (math.cos(hour_ang) * 12 * ss, math.sin(hour_ang) * 12 * ss)
    diamond_poly = [
        (diam_c[0] - d_fwd[0], diam_c[1] - d_fwd[1]),
        (diam_c[0] + d_perp[0], diam_c[1] + d_perp[1]),
        (diam_c[0] + d_fwd[0], diam_c[1] + d_fwd[1]),
        (diam_c[0] - d_perp[0], diam_c[1] - d_perp[1]),
    ]
    draw_day.polygon(diamond_poly, fill=black)
    draw_night.polygon(diamond_poly, fill=night_black)

    m_len = r_dial * 0.78
    m_tail = r_dial * 0.15
    mx0 = cx - m_tail * math.cos(min_ang)
    my0 = cy - m_tail * math.sin(min_ang)
    mx1 = cx + m_len * math.cos(min_ang)
    my1 = cy + m_len * math.sin(min_ang)
    draw_day.line([(mx0, my0), (mx1, my1)], fill=black, width=5 * ss)
    draw_night.line([(mx0, my0), (mx1, my1)], fill=night_black, width=5 * ss)

    draw_day.ellipse([cx - 8 * ss, cy - 8 * ss, cx + 8 * ss, cy + 8 * ss], fill=black)
    draw_night.ellipse([cx - 8 * ss, cy - 8 * ss, cx + 8 * ss, cy + 8 * ss], fill=night_black)

    day_img = im_day.resize((size, size), Image.Resampling.LANCZOS)
    night_img = im_night.resize((size, size), Image.Resampling.LANCZOS)

    return day_img, night_img


# -----------------------------------------------------------------------------
# 9. TS_RoofGlass (512x512)
# -----------------------------------------------------------------------------
def generate_roof_glass() -> Image.Image:
    """Generate TS_RoofGlass basecolor.

    1 tile = 1.5 x 1.5 m.
    Grid with thin dark steel mullions (#3A3E42 = 58, 62, 66) around 1.5m pane.
    Dark blue-grey structural glass pane (#5E6E76 = 94, 110, 118) with subtle sky reflection gradient.
    """
    size = 512
    x_idx = np.arange(size)[None, :]
    y_idx = np.arange(size)[:, None]

    n_sky = seamless_fft_noise(size, size, alpha=1.8, seed=SEED + 901)
    base_r = 94.0 + (n_sky - 0.5) * 12.0
    base_g = 110.0 + (n_sky - 0.5) * 14.0
    base_b = 118.0 + (n_sky - 0.5) * 16.0

    frame_w = 9.0
    dist_x = np.minimum(x_idx, size - x_idx)
    dist_y = np.minimum(y_idx, size - y_idx)
    dist_border = np.minimum(dist_x, dist_y)

    mask_frame = dist_border <= frame_w
    frame_bevel = np.clip((frame_w - dist_border) / frame_w, 0.0, 1.0)

    frame_r = 58.0 + frame_bevel * 12.0
    frame_g = 62.0 + frame_bevel * 12.0
    frame_b = 66.0 + frame_bevel * 14.0

    col_r = np.where(mask_frame, frame_r, base_r)
    col_g = np.where(mask_frame, frame_g, base_g)
    col_b = np.where(mask_frame, frame_b, base_b)

    col_rgb = np.stack([col_r, col_g, col_b], axis=-1)
    return Image.fromarray(np.clip(col_rgb, 0, 255).astype(np.uint8), mode="RGB")


# -----------------------------------------------------------------------------
# Contact Sheet & Verification Utilities
# -----------------------------------------------------------------------------
def verify_seamless_edges(name: str, img: Image.Image) -> float:
    """Check max absolute pixel difference across opposite tile edges."""
    arr = np.array(img, dtype=np.float32)
    diff_h = np.abs(arr[:, 0] - arr[:, -1]).max()
    diff_v = np.abs(arr[0, :] - arr[-1, :]).max()
    max_diff = max(float(diff_h), float(diff_v))
    return max_diff


def create_contact_sheet(
    textures: dict[str, Image.Image],
    output_path: Path,
) -> None:
    """Generate a high quality contact sheet with 1x preview and 2x2 seamless tiling checks."""
    preview_size = 256
    tile_size = 256
    margin = 20
    header_h = 50
    items = list(textures.items())
    num_rows = len(items)
    row_h = tile_size + margin

    sheet_w = preview_size + tile_size + margin * 3
    sheet_h = header_h + row_h * num_rows + margin

    sheet = Image.new("RGB", (sheet_w, sheet_h), color=(30, 32, 38))
    draw = ImageDraw.Draw(sheet)

    draw.text(
        (margin, 16),
        "Tokyo Open Drive - Tokyo Station Procedural Textures & 2x2 Seamless Verification",
        fill=(245, 245, 245),
    )

    for i, (name, img) in enumerate(items):
        y = header_h + i * row_h
        draw.text((margin, y - 16), f"{i + 1}. {name} ({img.size[0]}x{img.size[1]})", fill=(235, 220, 160))

        base_rgb = img.convert("RGB") if img.mode != "RGB" else img
        thumb = base_rgb.resize((preview_size, preview_size), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (margin, y))
        draw.rectangle([margin, y, margin + preview_size, y + preview_size], outline=(80, 85, 95), width=1)

        tiled_2x2 = Image.new("RGB", (img.size[0] * 2, img.size[1] * 2))
        for ty in range(2):
            for tx in range(2):
                tiled_2x2.paste(base_rgb, (tx * img.size[0], ty * img.size[1]))
        tiled_thumb = tiled_2x2.resize((tile_size, tile_size), Image.Resampling.LANCZOS)
        tile_x = margin * 2 + preview_size
        sheet.paste(tiled_thumb, (tile_x, y))
        draw.rectangle([tile_x, y, tile_x + tile_size, y + tile_size], outline=(100, 105, 120), width=1)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="PNG", optimize=True)
    print(f"Saved contact sheet to {output_path}")


# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------
def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Generating Tokyo Station procedural textures...")

    brick_bc, brick_nm, brick_ro = generate_brick()
    granite_bc, granite_nm, granite_ro = generate_granite()
    slate_bc, slate_nm, slate_ro = generate_slate()
    copper_roof_bc, copper_roof_nm, copper_roof_ro = generate_copper_roof()
    copper_trim_bc, copper_trim_ro = generate_copper_trim()
    frame_bc = generate_window_frame()
    glass_bc, glass_night = generate_glass()
    clock_bc, clock_night = generate_clock()
    roofglass_bc = generate_roof_glass()

    textures: dict[str, Image.Image] = {
        "ts_brick_basecolor.jpg": brick_bc,
        "ts_brick_normal.png": brick_nm,
        "ts_brick_rough.png": brick_ro,
        "ts_granite_basecolor.jpg": granite_bc,
        "ts_granite_normal.png": granite_nm,
        "ts_granite_rough.png": granite_ro,
        "ts_slate_basecolor.jpg": slate_bc,
        "ts_slate_normal.png": slate_nm,
        "ts_slate_rough.png": slate_ro,
        "ts_copper_roof_basecolor.jpg": copper_roof_bc,
        "ts_copper_roof_normal.png": copper_roof_nm,
        "ts_copper_roof_rough.png": copper_roof_ro,
        "ts_copper_trim_basecolor.jpg": copper_trim_bc,
        "ts_copper_trim_rough.png": copper_trim_ro,
        "ts_frame_basecolor.jpg": frame_bc,
        "ts_glass_basecolor.jpg": glass_bc,
        "ts_glass_night.jpg": glass_night,
        "ts_clock_basecolor.png": clock_bc,
        "ts_clock_night.png": clock_night,
        "ts_roofglass_basecolor.jpg": roofglass_bc,
    }

    total_bytes = 0
    print("\n--- Generated Texture Files & Stats ---")
    for filename, img in textures.items():
        out_path = OUTPUT_DIR / filename
        if filename.endswith(".jpg"):
            img.save(out_path, format="JPEG", quality=85, optimize=True)
        else:
            img.save(out_path, format="PNG", optimize=True)

        size_bytes = out_path.stat().st_size
        total_bytes += size_bytes

        mean_str = ""
        if "basecolor" in filename:
            arr = np.array(img.convert("RGB"), dtype=np.float32)
            m_r, m_g, m_b = arr.mean(axis=(0, 1))
            mean_str = f", avg sRGB=({m_r:.1f}, {m_g:.1f}, {m_b:.1f}) #{int(m_r):02X}{int(m_g):02X}{int(m_b):02X}"

        edge_diff = verify_seamless_edges(filename, img)

        print(
            f"  {filename:28s}: {img.size[0]:4d}x{img.size[1]:4d} {img.mode:4s}, "
            f"{size_bytes:7d} B ({size_bytes / 1024:5.1f} KB), edge_diff={edge_diff:.1f}{mean_str}"
        )

    print(f"\nTotal Texture Size: {total_bytes} bytes ({total_bytes / (1024 * 1024):.2f} MB / Budget 3.00 MB)")

    sheet_dest = Path(
        "/private/tmp/claude-501/-Users-kei-tmp-tokyo-od-game/056ebd68-d5c5-4652-8d55-550dca8ed173/scratchpad/agy-ts/sheet.png"
    )
    if len(sys.argv) > 1:
        sheet_dest = Path(sys.argv[1]).resolve()
    create_contact_sheet(textures, sheet_dest)


if __name__ == "__main__":
    main()
