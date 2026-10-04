# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural asphalt road texture generator for Tokyo Open Drive.

Generates tileable asphalt textures for Japanese city streets:
1. asphalt_albedo.png: Standard Japanese dense-graded asphalt (密粒度アスファルト, ~#3a3d42).
2. asphalt_roughness.png: PBR roughness map (greyscale).
3. asphalt_normal.png: Tangent-space normal map (OpenGL format, +Y up).
4. asphalt_worn_albedo.png: Worn lane with wheel-path tracks (slightly darker & smoother).
5. asphalt_patch_albedo.png: Road with rectangular maintenance patches and crack sealant lines.
6. asphalt_porous_albedo.png: Arterial porous drainage asphalt (排水性舗装, lighter & coarser).

Resolution: 1024x1024 px.
Texel scale: 1024 px = 4.0 m (approx. 3.9 mm/px).
All textures are seamlessly tileable in both X (U) and Y (V) directions.
Lane direction runs vertically (along Y/V axis, road length).

Usage:
    uv run scripts/textures/asphalt_textures.py
    uv run scripts/textures/asphalt_textures.py <contact_sheet_preview.png>
"""

from __future__ import annotations

import random
import sys
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw

# Deterministic seed for reproducible procedural generation
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "road" / "textures"

TEXTURE_SIZE = 1024


# -----------------------------------------------------------------------------
# Seamless Toroidal Procedural Noise Utilities
# -----------------------------------------------------------------------------
def seamless_fft_noise(
    size: int,
    alpha: float = 1.5,
    high_cutoff: float | None = None,
    seed: int = 42,
) -> np.ndarray:
    """Generate 2D seamless (toroidal) spectral noise using FFT (1/f^alpha)."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((size, size))
    f_white = np.fft.fft2(white)

    kx = np.fft.fftfreq(size) * size
    ky = np.fft.fftfreq(size) * size
    kx_grid, ky_grid = np.meshgrid(kx, ky)
    freq = np.sqrt(kx_grid**2 + ky_grid**2)
    freq[0, 0] = 1.0  # avoid division by zero

    filter_h = 1.0 / (freq**alpha)
    filter_h[0, 0] = 0.0

    if high_cutoff is not None:
        filter_h[freq > high_cutoff] = 0.0

    filtered = f_white * filter_h
    noise = np.real(np.fft.ifft2(filtered))
    n_min, n_max = noise.min(), noise.max()
    if n_max > n_min:
        return (noise - n_min) / (n_max - n_min)
    return np.zeros_like(noise)


def generate_seamless_aggregate_layer(
    size: int,
    num_particles: int,
    radius: int,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized aggregate particle splatting with periodic boundary wrapping."""
    rng = np.random.default_rng(seed)
    height_map = np.zeros((size, size), dtype=np.float32)
    color_map = np.zeros((size, size), dtype=np.float32)

    xs = rng.integers(0, size, size=num_particles)
    ys = rng.integers(0, size, size=num_particles)
    heights = rng.uniform(0.6, 1.0, size=num_particles).astype(np.float32)
    colors = rng.uniform(0.65, 1.35, size=num_particles).astype(np.float32)

    # Kernel for this radius
    d = np.arange(-radius, radius + 1)
    dx_grid, dy_grid = np.meshgrid(d, d)
    dist_sq = (dx_grid / max(1, radius)) ** 2 + (dy_grid / max(1, radius)) ** 2
    mask = dist_sq <= 1.0
    dx_pts = dx_grid[mask]
    dy_pts = dy_grid[mask]
    kernel_profile = ((1.0 - dist_sq[mask]) ** 0.5).astype(np.float32)

    # Iterate over kernel offsets (only ~9 to 25 steps total!)
    for k in range(len(dx_pts)):
        k_dx = int(dx_pts[k])
        k_dy = int(dy_pts[k])
        k_prof = kernel_profile[k]

        px = (xs + k_dx) % size
        py = (ys + k_dy) % size
        h_vals = heights * k_prof

        # Splat into height_map using maximum
        np.maximum.at(height_map, (py, px), h_vals)
        # Update color where aggregate is placed
        color_map[py, px] = colors

    return height_map, color_map


def compute_periodic_normal_map(
    heightmap: np.ndarray,
    strength: float = 3.0,
) -> Image.Image:
    """Compute tangent space normal map (OpenGL format: R=X+, G=Y+, B=Z+) with periodic wrap."""
    size = heightmap.shape[0]
    # Periodic central differences
    dx = (np.roll(heightmap, -1, axis=1) - np.roll(heightmap, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(heightmap, -1, axis=0) - np.roll(heightmap, 1, axis=0)) * 0.5 * strength

    # Normal vector (-dx, -dy, 1) in tangent space (OpenGL: +Y is upward)
    nx = -dx
    ny = -dy
    nz = np.ones((size, size), dtype=np.float32)

    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= length
    ny /= length
    nz /= length

    # Map [-1, 1] to [0, 255]
    r = np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    g = np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    b = np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)

    normal_rgb = np.stack([r, g, b], axis=-1)
    return Image.fromarray(normal_rgb, mode="RGB")


# -----------------------------------------------------------------------------
# Base Asphalt Model & Texture Generators
# -----------------------------------------------------------------------------
def generate_base_asphalt_layers(
    size: int = TEXTURE_SIZE,
    is_porous: bool = False,
    seed: int = 42,
) -> dict[str, np.ndarray]:
    """Procedurally synthesize the base Japanese asphalt layers."""
    # 1. Macro and Meso color & tone variation
    macro_noise = seamless_fft_noise(size, alpha=2.2, seed=seed + 1)
    meso_noise = seamless_fft_noise(size, alpha=1.5, seed=seed + 2)
    micro_noise = seamless_fft_noise(size, alpha=0.9, seed=seed + 3)

    # 2. Aggregates (fine gravel 2-8mm -> ~1 to 4 px radius for 1024px=4m)
    # Fast vectorized placement
    if not is_porous:
        # Dense graded: many small stones (1-2 px) and medium stones (2-3 px)
        h_med, c_med = generate_seamless_aggregate_layer(size, num_particles=12000, radius=2, seed=seed + 10)
        h_large, c_large = generate_seamless_aggregate_layer(size, num_particles=3000, radius=3, seed=seed + 11)
        h_small, c_small = generate_seamless_aggregate_layer(size, num_particles=30000, radius=1, seed=seed + 12)

        h_agg = np.maximum(np.maximum(h_med, h_large), h_small)
        c_agg = np.where(h_large >= h_med, c_large, c_med)
        c_agg = np.where(h_small >= h_agg, c_small, c_agg)
        void_depth = 0.15
    else:
        # Porous asphalt (排水性舗装): larger stone skeleton (3-5 px) with distinct voids
        h_large, c_large = generate_seamless_aggregate_layer(size, num_particles=6000, radius=4, seed=seed + 20)
        h_med, c_med = generate_seamless_aggregate_layer(size, num_particles=12000, radius=3, seed=seed + 21)
        h_small, c_small = generate_seamless_aggregate_layer(size, num_particles=15000, radius=2, seed=seed + 22)

        h_agg = np.maximum(np.maximum(h_large, h_med), h_small)
        c_agg = np.where(h_large >= h_med, c_large, c_med)
        c_agg = np.where(h_small >= h_agg, c_small, c_agg)
        void_depth = 0.45

    # 3. Bitumen / Mastic binder matrix
    binder_height = (macro_noise * 0.15 + meso_noise * 0.2 + micro_noise * 0.1) * (1.0 - void_depth)
    total_height = np.maximum(h_agg * 0.85 + micro_noise * 0.15, binder_height)

    # 4. Occasional oil/grime stains
    stain_noise1 = seamless_fft_noise(size, alpha=2.5, seed=seed + 101)
    stain_noise2 = seamless_fft_noise(size, alpha=1.8, seed=seed + 102)
    stain_mask = np.clip((stain_noise1 * 0.7 + stain_noise2 * 0.3 - 0.65) * 4.0, 0.0, 1.0)

    return {
        "macro": macro_noise,
        "meso": meso_noise,
        "micro": micro_noise,
        "height": total_height,
        "agg_height": h_agg,
        "agg_color": c_agg,
        "stains": stain_mask,
    }


def generate_asphalt_standard(size: int = TEXTURE_SIZE) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Generate dense-graded asphalt: (albedo, roughness, normal).

    Target look: Japanese 密粒度アスファルト (sRGB average ~#3a3d42 / (58, 61, 66)).
    """
    layers = generate_base_asphalt_layers(size=size, is_porous=False, seed=SEED)

    # Base bitumen color (RGB float [0, 255])
    # Bitumen matrix: dark grey with subtle cool tint (52, 55, 59)
    # Exposed aggregates: lighter grey speckles (75, 78, 83) modulated by c_agg
    base_r = 52.0 + (layers["macro"] - 0.5) * 10.0 + (layers["meso"] - 0.5) * 8.0
    base_g = 55.0 + (layers["macro"] - 0.5) * 10.0 + (layers["meso"] - 0.5) * 8.0
    base_b = 60.0 + (layers["macro"] - 0.5) * 11.0 + (layers["meso"] - 0.5) * 9.0

    # Aggregate blending
    agg_mask = layers["agg_height"] > 0.08
    agg_brightness = np.clip(layers["agg_color"] * (layers["agg_height"] ** 0.5), 0.0, 1.5)

    r = np.where(agg_mask, base_r + agg_brightness * 32.0, base_r)
    g = np.where(agg_mask, base_g + agg_brightness * 33.0, base_g)
    b = np.where(agg_mask, base_b + agg_brightness * 34.0, base_b)

    # Add fine surface grit
    r += (layers["micro"] - 0.5) * 10.0
    g += (layers["micro"] - 0.5) * 10.0
    b += (layers["micro"] - 0.5) * 10.0

    # Subtle oil stain darkening
    stain = layers["stains"]
    r *= 1.0 - stain * 0.18
    g *= 1.0 - stain * 0.18
    b *= 1.0 - stain * 0.18

    # Albedo image
    albedo_arr = np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8)
    albedo_img = Image.fromarray(albedo_arr, mode="RGB")

    # Roughness map: Asphalt is generally rough (~0.85-0.95), aggregate tips ~0.75, oil stains smoother (~0.4-0.6)
    roughness = 0.90 - layers["agg_height"] * 0.12 + (layers["meso"] - 0.5) * 0.08 - layers["stains"] * 0.35
    roughness = np.clip(roughness * 255.0, 0, 255).astype(np.uint8)
    roughness_img = Image.fromarray(roughness, mode="L")

    # Normal map
    normal_img = compute_periodic_normal_map(layers["height"], strength=3.2)

    return albedo_img, roughness_img, normal_img


def generate_asphalt_worn(size: int = TEXTURE_SIZE) -> Image.Image:
    """Generate worn asphalt variant (asphalt_worn_albedo.png).

    Tyre-polished wheel paths run along the V axis (lengthwise / road direction).
    Standard Japanese lane: wheel paths positioned symmetrically across center.
    Center X = 0.5. Left wheel path at ~0.26, Right wheel path at ~0.74.
    """
    layers = generate_base_asphalt_layers(size=size, is_porous=False, seed=SEED + 50)

    # Base albedo calculation
    base_r = 52.0 + (layers["macro"] - 0.5) * 10.0 + (layers["meso"] - 0.5) * 8.0
    base_g = 55.0 + (layers["macro"] - 0.5) * 10.0 + (layers["meso"] - 0.5) * 8.0
    base_b = 60.0 + (layers["macro"] - 0.5) * 11.0 + (layers["meso"] - 0.5) * 9.0

    agg_mask = layers["agg_height"] > 0.08
    agg_brightness = np.clip(layers["agg_color"] * (layers["agg_height"] ** 0.5), 0.0, 1.5)

    r = np.where(agg_mask, base_r + agg_brightness * 30.0, base_r)
    g = np.where(agg_mask, base_g + agg_brightness * 31.0, base_g)
    b = np.where(agg_mask, base_b + agg_brightness * 32.0, base_b)
    r += (layers["micro"] - 0.5) * 8.0
    g += (layers["micro"] - 0.5) * 8.0
    b += (layers["micro"] - 0.5) * 8.0

    # Lengthwise wheel paths (along V axis = constant in Y, varies across X)
    # Band 1 center: x = 0.26 (approx 1.04m from edge)
    # Band 2 center: x = 0.74 (approx 2.96m from edge)
    # Width of each band ~ 0.20 (approx 0.8m wide tyre track)
    x_coords = np.linspace(0.0, 1.0, size, endpoint=False)[None, :]
    band1 = np.exp(-0.5 * ((x_coords - 0.26) / 0.09) ** 2)
    band2 = np.exp(-0.5 * ((x_coords - 0.74) / 0.09) ** 2)
    wheel_track_intensity = np.clip(band1 + band2, 0.0, 1.0)

    # Modulate tracks slightly with longitudinal noise for realism
    longitudinal_variation = seamless_fft_noise(size, alpha=1.8, seed=SEED + 52)
    wheel_tracks = wheel_track_intensity * (0.85 + 0.3 * longitudinal_variation)

    # Tyre-polished tracks: darker (rubber deposit / polished aggregate) & reduced contrast
    darkening = 1.0 - wheel_tracks * 0.14
    r *= darkening
    g *= darkening
    b *= darkening

    # Central lane area (between tracks) has slightly accumulated dust/grey
    center_dust = np.exp(-0.5 * ((x_coords - 0.50) / 0.12) ** 2) * 0.06
    r += center_dust * 18.0
    g += center_dust * 18.0
    b += center_dust * 18.0

    albedo_arr = np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8)
    return Image.fromarray(albedo_arr, mode="RGB")


def generate_asphalt_patch(size: int = TEXTURE_SIZE) -> Image.Image:
    """Generate patch / repair asphalt variant (asphalt_patch_albedo.png).

    Features:
    - Darker rectangular maintenance patches (補修箇所) with freshly paved fine texture.
    - Black bituminous crack-sealant lines (クラック補修・注入目地).
    """
    # Base asphalt layer
    layers = generate_base_asphalt_layers(size=size, is_porous=False, seed=SEED + 100)

    base_r = 54.0 + (layers["macro"] - 0.5) * 10.0 + (layers["meso"] - 0.5) * 8.0
    base_g = 57.0 + (layers["macro"] - 0.5) * 10.0 + (layers["meso"] - 0.5) * 8.0
    base_b = 62.0 + (layers["macro"] - 0.5) * 11.0 + (layers["meso"] - 0.5) * 9.0

    agg_mask = layers["agg_height"] > 0.08
    agg_brightness = np.clip(layers["agg_color"] * (layers["agg_height"] ** 0.5), 0.0, 1.5)

    r = np.where(agg_mask, base_r + agg_brightness * 32.0, base_r)
    g = np.where(agg_mask, base_g + agg_brightness * 33.0, base_g)
    b = np.where(agg_mask, base_b + agg_brightness * 34.0, base_b)
    r += (layers["micro"] - 0.5) * 10.0
    g += (layers["micro"] - 0.5) * 10.0
    b += (layers["micro"] - 0.5) * 10.0

    # 1. Rectangular utility patches (補修パッチ - fresh dark asphalt)
    # We place 2 distinct seamless patches that do not touch texture borders
    patch_mask = np.zeros((size, size), dtype=np.float32)

    # Patch 1: Top-right quadrant [x: 580..920, y: 120..380] (1.3m x 1.0m)
    p1_x0, p1_x1 = 580, 920
    p1_y0, p1_y1 = 120, 380
    patch_mask[p1_y0:p1_y1, p1_x0:p1_x1] = 1.0

    # Patch 2: Bottom-left quadrant [x: 100..420, y: 600..880] (1.25m x 1.1m)
    p2_x0, p2_x1 = 100, 420
    p2_y0, p2_y1 = 600, 880
    patch_mask[p2_y0:p2_y1, p2_x0:p2_x1] = 1.0

    # Fresh patch asphalt: darker, finer aggregate, rich black-grey (#2b2d30 -> 43, 45, 48)
    patch_noise = seamless_fft_noise(size, alpha=1.4, seed=SEED + 105)
    patch_r = 41.0 + (patch_noise - 0.5) * 12.0
    patch_g = 43.0 + (patch_noise - 0.5) * 12.0
    patch_b = 46.0 + (patch_noise - 0.5) * 13.0

    # Blend patch into road
    r = np.where(patch_mask > 0.5, patch_r, r)
    g = np.where(patch_mask > 0.5, patch_g, g)
    b = np.where(patch_mask > 0.5, patch_b, b)

    # 2. Patch joints and crack sealant lines (注入目地 / シール工法)
    # Pitch black sealant around patch perimeters and organic meandering cracks
    sealant_img = Image.new("L", (size, size), color=0)
    draw_sealant = ImageDraw.Draw(sealant_img)

    # Patch 1 seam border
    draw_sealant.rectangle([p1_x0, p1_y0, p1_x1, p1_y1], outline=255, width=3)
    # Patch 2 seam border
    draw_sealant.rectangle([p2_x0, p2_y0, p2_x1, p2_y1], outline=255, width=3)

    # Meandering crack lines sealed with tar (toroidal/seamlessly contained inside canvas)
    crack_pts1 = [
        (180, 200),
        (220, 240),
        (260, 230),
        (310, 270),
        (340, 320),
        (400, 350),
        (450, 340),
    ]
    draw_sealant.line(crack_pts1, fill=255, width=4, joint="curve")

    crack_pts2 = [
        (650, 680),
        (710, 720),
        (760, 710),
        (820, 770),
        (880, 790),
    ]
    draw_sealant.line(crack_pts2, fill=255, width=4, joint="curve")

    # Convert sealant mask to numpy array
    sealant_mask = np.array(sealant_img, dtype=np.float32) / 255.0

    # Tar sealant is deep glossy black (#1a1a1c -> 26, 26, 28)
    tar_r, tar_g, tar_b = 26.0, 26.0, 28.0
    r = r * (1.0 - sealant_mask) + tar_r * sealant_mask
    g = g * (1.0 - sealant_mask) + tar_g * sealant_mask
    b = b * (1.0 - sealant_mask) + tar_b * sealant_mask

    albedo_arr = np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8)
    return Image.fromarray(albedo_arr, mode="RGB")


def generate_asphalt_porous(size: int = TEXTURE_SIZE) -> Image.Image:
    """Generate porous asphalt variant (asphalt_porous_albedo.png).

    Look: Japanese 高機能舗装 / 排水性舗装 (Porous Asphalt).
    Characteristics:
    - Slightly lighter average tone (higher stone ratio, ~#45484e / (69, 72, 78)).
    - Coarser aggregate structure with visible interconnected air voids (空隙).
    """
    layers = generate_base_asphalt_layers(size=size, is_porous=True, seed=SEED + 200)

    # Base stone/binder tone
    base_r = 63.0 + (layers["macro"] - 0.5) * 12.0 + (layers["meso"] - 0.5) * 10.0
    base_g = 66.0 + (layers["macro"] - 0.5) * 12.0 + (layers["meso"] - 0.5) * 10.0
    base_b = 72.0 + (layers["macro"] - 0.5) * 13.0 + (layers["meso"] - 0.5) * 11.0

    agg_mask = layers["agg_height"] > 0.05
    agg_brightness = np.clip(layers["agg_color"] * (layers["agg_height"] ** 0.6), 0.0, 1.6)

    # Exposed coarse aggregates are lighter grey
    r = np.where(agg_mask, base_r + agg_brightness * 36.0, base_r)
    g = np.where(agg_mask, base_g + agg_brightness * 37.0, base_g)
    b = np.where(agg_mask, base_b + agg_brightness * 38.0, base_b)

    # Porous voids: deep crevices between stones are very dark
    void_mask = (layers["agg_height"] < 0.20) & (layers["micro"] < 0.40)
    void_darkening = np.clip((0.40 - layers["micro"]) * 2.5, 0.0, 1.0)
    r = np.where(void_mask, r * (1.0 - void_darkening * 0.55), r)
    g = np.where(void_mask, g * (1.0 - void_darkening * 0.55), g)
    b = np.where(void_mask, b * (1.0 - void_darkening * 0.55), b)

    r += (layers["micro"] - 0.5) * 12.0
    g += (layers["micro"] - 0.5) * 12.0
    b += (layers["micro"] - 0.5) * 12.0

    albedo_arr = np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8)
    return Image.fromarray(albedo_arr, mode="RGB")


# -----------------------------------------------------------------------------
# Contact Sheet & Verification Preview
# -----------------------------------------------------------------------------
def create_contact_sheet(
    textures: dict[str, Image.Image],
    output_path: Path,
) -> None:
    """Generate a comprehensive contact sheet with map preview and 2x2 seamless tiling checks."""
    preview_size = 256
    tile_size = 384  # 2x2 preview scaled
    margin = 20
    header_h = 50

    # Layout:
    # Col 1: Single texture preview (256x256)
    # Col 2: 2x2 Tiled verification preview (384x384)
    items = list(textures.items())
    num_rows = len(items)
    row_h = tile_size + margin

    sheet_w = preview_size + tile_size + margin * 3
    sheet_h = header_h + row_h * num_rows + margin

    sheet = Image.new("RGB", (sheet_w, sheet_h), color=(26, 28, 32))
    draw = ImageDraw.Draw(sheet)

    draw.text(
        (margin, 16),
        "Tokyo Open Drive - Asphalt Road Textures & 2x2 Seamless Tiling Check (1024px = 4m)",
        fill=(240, 240, 240),
    )

    for i, (name, img) in enumerate(items):
        y = header_h + i * row_h

        draw.text((margin, y - 16), f"{i + 1}. {name}", fill=(230, 220, 160))

        # 1. Base Map (256x256)
        if img.mode != "RGB":
            base_rgb = img.convert("RGB")
        else:
            base_rgb = img
        thumb = base_rgb.resize((preview_size, preview_size), Image.Resampling.LANCZOS)
        # Center vertically in row
        thumb_y = y + (tile_size - preview_size) // 2
        sheet.paste(thumb, (margin, thumb_y))
        draw.rectangle(
            [margin, thumb_y, margin + preview_size, thumb_y + preview_size],
            outline=(70, 75, 85),
            width=1,
        )

        # 2. 2x2 Tiled Verification (384x384)
        tiled_2x2 = Image.new("RGB", (TEXTURE_SIZE * 2, TEXTURE_SIZE * 2))
        for ty in range(2):
            for tx in range(2):
                tiled_2x2.paste(base_rgb, (tx * TEXTURE_SIZE, ty * TEXTURE_SIZE))
        tiled_thumb = tiled_2x2.resize((tile_size, tile_size), Image.Resampling.LANCZOS)
        tile_x = margin * 2 + preview_size
        sheet.paste(tiled_thumb, (tile_x, y))
        draw.rectangle(
            [tile_x, y, tile_x + tile_size, y + tile_size],
            outline=(90, 95, 110),
            width=1,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="PNG", optimize=True)
    print(f"Saved contact sheet preview to {output_path}")


# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------
GENERATORS: list[tuple[str, Callable[[], Image.Image]]] = []


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating Japanese asphalt textures (1024x1024, 4m per tile)...")

    # 1. Standard asphalt maps
    albedo_std, roughness_std, normal_std = generate_asphalt_standard(TEXTURE_SIZE)

    # 2. Variants
    worn_std = generate_asphalt_worn(TEXTURE_SIZE)
    patch_std = generate_asphalt_patch(TEXTURE_SIZE)
    porous_std = generate_asphalt_porous(TEXTURE_SIZE)

    texture_map: dict[str, Image.Image] = {
        "asphalt_albedo.png": albedo_std,
        "asphalt_roughness.png": roughness_std,
        "asphalt_normal.png": normal_std,
        "asphalt_worn_albedo.png": worn_std,
        "asphalt_patch_albedo.png": patch_std,
        "asphalt_porous_albedo.png": porous_std,
    }

    # Save PNGs and JPG alternatives
    for filename, img in texture_map.items():
        out_path = OUTPUT_DIR / filename
        # Save optimized PNG (quantize normal map to 256 colors to stay well under 1.5MB)
        if filename == "asphalt_normal.png":
            save_img = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        else:
            save_img = img

        save_img.save(out_path, format="PNG", optimize=True)
        size_kb = out_path.stat().st_size / 1024
        print(f"  - {filename:26s}: {size_kb:7.1f} KB")

        # Also save high quality JPG alternative if RGB
        if img.mode == "RGB":
            jpg_filename = filename.replace(".png", ".jpg")
            jpg_path = OUTPUT_DIR / jpg_filename
            img.save(jpg_path, format="JPEG", quality=92, optimize=True)
            jpg_size_kb = jpg_path.stat().st_size / 1024
            print(f"    (alt: {jpg_filename:20s}: {jpg_size_kb:7.1f} KB)")

    # Generate contact sheet if specified or default scratchpad path
    contact_sheet_target = None
    if len(sys.argv) > 1:
        contact_sheet_target = Path(sys.argv[1]).resolve()
    else:
        # Default scratchpad path from task description
        scratchpad_dir = Path(
            "/private/tmp/claude-501/-Users-kei-tmp-tokyo-od-game/056ebd68-d5c5-4652-8d55-550dca8ed173/scratchpad/asphalt"
        )
        if scratchpad_dir.exists():
            contact_sheet_target = scratchpad_dir / "asphalt_contact_sheet.png"

    if contact_sheet_target:
        create_contact_sheet(texture_map, contact_sheet_target)


if __name__ == "__main__":
    main()
