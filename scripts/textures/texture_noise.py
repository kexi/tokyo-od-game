"""Seamless (toroidal) noise, stone splatting, normal packing and the seam check the road and
expressway textures share (asphalt_textures.py, expressway_textures.py).

Not a script of its own: the two generators import it from their directory (uv puts the script's
directory first on sys.path). Every function wraps at the borders, so a tile laid in world
coordinates (src/world/roadSurface.ts, src/world/deckSurface.ts) shows no seam.
"""

from __future__ import annotations

import numpy as np
from PIL import Image


def fft_noise(size: int, alpha: float, seed: int, aspect: tuple[float, float] = (1.0, 1.0)) -> np.ndarray:
    """1/f^alpha noise in [0, 1] that wraps in both axes.

    How: white noise filtered in the frequency domain (periodic by construction). `aspect` stretches
    the spectrum: (1, 8) keeps vertical features 8 times longer than wide (rain streaks).
    """
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((size, size))
    k = np.fft.fftfreq(size) * size
    kx, ky = np.meshgrid(k * aspect[0], k * aspect[1])
    freq = np.sqrt(kx**2 + ky**2)
    freq[0, 0] = 1.0
    gain = 1.0 / freq**alpha
    gain[0, 0] = 0.0
    noise = np.real(np.fft.ifft2(np.fft.fft2(white) * gain))
    lo, hi = noise.min(), noise.max()
    return (noise - lo) / (hi - lo) if hi > lo else np.zeros_like(noise)


def stones(size: int, count: int, radius: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Height (dome profile) and tone (0.65–1.35) of `count` stones of about `radius` px, wrapped.

    How: one pass per kernel offset with np.maximum.at, so the cost is the kernel's area, not the
    number of stones. Radii vary ±35 % per stone (a single size reads as a regular grid at a distance).
    """
    rng = np.random.default_rng(seed)
    height = np.zeros((size, size), dtype=np.float32)
    tone = np.ones((size, size), dtype=np.float32)
    xs = rng.integers(0, size, count)
    ys = rng.integers(0, size, count)
    rs = rng.uniform(0.65, 1.35, count) * radius
    hs = rng.uniform(0.6, 1.0, count).astype(np.float32)
    cs = rng.uniform(0.65, 1.35, count).astype(np.float32)
    reach = int(np.ceil(rs.max()))
    for dy in range(-reach, reach + 1):
        for dx in range(-reach, reach + 1):
            d2 = (dx * dx + dy * dy) / np.maximum(rs, 0.5) ** 2
            isInside = d2 <= 1.0
            if not isInside.any():
                continue
            px = (xs[isInside] + dx) % size
            py = (ys[isInside] + dy) % size
            h = hs[isInside] * np.sqrt(1.0 - d2[isInside]).astype(np.float32)
            np.maximum.at(height, (py, px), h)
            tone[py, px] = cs[isInside]
    return height, tone


def normal_xy(height: np.ndarray, strength: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Tangent-space normal (OpenGL convention) of a height field, with wrapped central differences.

    How: three loads images flipped, so the texture's v grows up the image, i.e. towards row − 1 of
    the array; +Y of the normal is that direction.
    """
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, 1, axis=0) - np.roll(height, -1, axis=0)) * 0.5 * strength
    n = np.sqrt(dx * dx + dy * dy + 1.0)
    return -dx / n, -dy / n, 1.0 / n


def to_byte(x: np.ndarray) -> np.ndarray:
    return np.clip(np.round(x), 0, 255).astype(np.uint8)


def rgb_image(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> Image.Image:
    return Image.fromarray(np.stack([to_byte(r), to_byte(g), to_byte(b)], axis=-1), mode="RGB")


def packed_image(
    height: np.ndarray, strength: float, roughness: np.ndarray, extra: np.ndarray | None = None
) -> Image.Image:
    """Normal x/y in R/G (z rebuilt in the shader), roughness in B and an optional mask in A.

    Why not a normal map and a roughness map apart (as asphalt_*.jpg/png): one texture fetch fewer
    per projection, which counts three times over on the deck's triplanar concrete.
    """
    nx, ny, _ = normal_xy(height, strength)
    channels = [to_byte((nx * 0.5 + 0.5) * 255), to_byte((ny * 0.5 + 0.5) * 255), to_byte(roughness * 255)]
    if extra is not None:
        channels.append(to_byte(extra * 255))
    mode = "RGBA" if extra is not None else "RGB"
    return Image.fromarray(np.stack(channels, axis=-1), mode=mode)


def seam_ratio(img: Image.Image) -> float:
    """How much stronger the step across the wrap is than an ordinary step between neighbours.

    About 1 for a seamless tile; a visible seam is several times the interior's. The generators
    refuse to write a tile above SEAM_LIMIT.
    """
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    inner_x = np.abs(np.diff(a, axis=1)).mean()
    inner_y = np.abs(np.diff(a, axis=0)).mean()
    wrap_x = np.abs(a[:, 0] - a[:, -1]).mean()
    wrap_y = np.abs(a[0] - a[-1]).mean()
    return float(max(wrap_x / max(inner_x, 1e-6), wrap_y / max(inner_y, 1e-6)))


SEAM_LIMIT = 1.6


def check_seamless(name: str, img: Image.Image) -> None:
    ratio = seam_ratio(img)
    if ratio > SEAM_LIMIT:
        raise SystemExit(f"{name}: the step across the wrap is {ratio:.2f}× the interior's (> {SEAM_LIMIT})")
