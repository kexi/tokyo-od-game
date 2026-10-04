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
"""Procedural textures for the player car's interior (scripts/blender/cockpit.py).

Dial faces, tell-tale symbols, the HVAC faceplate and the shift gate are drawn with Pillow;
fabric, plastic grain and speaker mesh are periodic noise fields (tileable by construction,
FFT-filtered white noise). Numerals and labels use only the pinned Noto Sans JP (SIL OFL 1.1)
through car_textures.get_noto_font. No brand marks or names anywhere.

Dial angle convention (shared with cockpit.py): clock angle from 12 o'clock, clockwise positive.
The speedometer runs 0 → 180 km/h from −120° to +120° (240°, 4/3° per km/h), the tachometer
0 → 8000 r/min over the same arc (0.03° per r/min). The fuel and temperature gauges run from
−45° (E / C) to +45° (F / H). The needle pivot is the image centre.

Usage:
    uv run scripts/textures/cockpit_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from car_textures import get_noto_font  # noqa: E402

SEED = 2575
OUTPUT_DIR = SCRIPTS_DIR.parent.parent / "assets" / "cockpit" / "textures"

# Gauge geometry (must match cockpit.py).
SPEED_MAX = 180
TACHO_MAX = 8000
DIAL_START = -120.0
DIAL_SWEEP = 240.0
SMALL_START = -45.0
SMALL_SWEEP = 90.0

# Tell-tale colours per UN R121 / ISO 2575 conventions.
GREEN = (60, 230, 90)
BLUE = (60, 130, 255)
RED = (240, 40, 30)
WHITE = (238, 240, 242)
FACE = (10, 11, 13)
SS = 4  # supersampling factor for the line art


def rng(offset: int = 0) -> np.random.Generator:
    return np.random.default_rng(SEED + offset)


def clock(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    """Point at clock angle `deg` (0 = 12 o'clock, clockwise) and radius r, image coordinates."""
    a = math.radians(deg)
    return cx + r * math.sin(a), cy - r * math.cos(a)


def text_center(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, font, fill) -> None:
    draw.text(xy, text, font=font, fill=fill, anchor="mm")


def downsample(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return img.resize(size, Image.Resampling.LANCZOS)


def periodic_noise(size: int, scale: float, offset: int, aniso: tuple[float, float] = (1.0, 1.0)) -> np.ndarray:
    """Tileable 0–1 noise: white noise low-passed in the frequency domain (periodic by FFT)."""
    white = rng(offset).standard_normal((size, size))
    fy = np.fft.fftfreq(size)[:, None] * aniso[1]
    fx = np.fft.fftfreq(size)[None, :] * aniso[0]
    f = np.sqrt(fx * fx + fy * fy)
    field = np.real(np.fft.ifft2(np.fft.fft2(white) * np.exp(-((f * size / scale) ** 2))))
    field -= field.min()
    return field / max(field.max(), 1e-9)


# ---------------------------------------------------------------------------- dials


def dial_base(size: int) -> tuple[Image.Image, ImageDraw.ImageDraw, float, float, float]:
    big = size * SS
    img = Image.new("RGB", (big, big), FACE)
    draw = ImageDraw.Draw(img)
    c = big / 2
    r = big * 0.47
    # Faint radial vignette ring so the black face reads as a recessed dial.
    for k in range(24):
        t = k / 23
        shade = int(14 + 10 * (1 - t))
        rr = r * (0.55 + 0.45 * t)
        draw.ellipse([c - rr, c - rr, c + rr, c + rr], outline=(shade, shade + 1, shade + 3), width=SS * 3)
    draw.ellipse([c - r, c - r, c + r, c + r], outline=(70, 74, 80), width=SS * 3)
    return img, draw, c, c, r


def ticks(draw, cx, cy, r, count, every_major, every_mid, start, sweep, color=WHITE, red_from=None):
    for i in range(count + 1):
        deg = start + sweep * i / count
        is_major = i % every_major == 0
        is_mid = every_mid and i % every_mid == 0
        length = r * (0.14 if is_major else 0.09 if is_mid else 0.055)
        width = SS * (7 if is_major else 4 if is_mid else 3)
        tick_color = RED if red_from is not None and i >= red_from else color
        outer = clock(cx, cy, r * 0.93, deg)
        inner = clock(cx, cy, r * 0.93 - length, deg)
        draw.line([inner, outer], fill=tick_color, width=width)


def gauge_speed(size: int = 512) -> Image.Image:
    img, draw, cx, cy, r = dial_base(size)
    # 0–180 km/h: major tick + numeral every 20, mid every 10, minor every 5.
    ticks(draw, cx, cy, r, 36, 4, 2, DIAL_START, DIAL_SWEEP)
    font = get_noto_font(int(r * 0.135), bold=True)
    for v in range(0, SPEED_MAX + 1, 20):
        deg = DIAL_START + DIAL_SWEEP * v / SPEED_MAX
        text_center(draw, clock(cx, cy, r * 0.62, deg), str(v), font, WHITE)
    text_center(draw, (cx, cy + r * 0.36), "km/h", get_noto_font(int(r * 0.11)), (200, 204, 210))
    return downsample(img, (size, size))


def gauge_tacho(size: int = 512) -> Image.Image:
    img, draw, cx, cy, r = dial_base(size)
    # Red zone band from 6500 r/min to the end of the scale.
    band = [cx - r * 0.93, cy - r * 0.93, cx + r * 0.93, cy + r * 0.93]
    a0 = DIAL_START + DIAL_SWEEP * 6500 / TACHO_MAX - 90  # PIL arcs: 0° = 3 o'clock, clockwise
    a1 = DIAL_START + DIAL_SWEEP - 90
    draw.arc(band, a0, a1, fill=(170, 20, 16), width=int(r * 0.07))
    # Major every 1000, minor every 500 (ticks from 6500 up drawn red).
    ticks(draw, cx, cy, r, 16, 2, 0, DIAL_START, DIAL_SWEEP, red_from=13)
    font = get_noto_font(int(r * 0.2), bold=True)
    for v in range(0, 9):
        deg = DIAL_START + DIAL_SWEEP * v / 8
        text_center(draw, clock(cx, cy, r * 0.63, deg), str(v), font, RED if v >= 7 else WHITE)
    text_center(draw, (cx, cy + r * 0.36), "×1000r/min", get_noto_font(int(r * 0.095)), (200, 204, 210))
    return downsample(img, (size, size))


def fuel_pump(draw, cx, cy, s, fill):
    """ISO 2575 fuel symbol: pump body with a hose to the right."""
    draw.rounded_rectangle([cx - s * 0.5, cy - s * 0.55, cx + s * 0.15, cy + s * 0.5], radius=s * 0.06, fill=fill)
    draw.rectangle([cx - s * 0.38, cy - s * 0.42, cx + s * 0.03, cy - s * 0.12], fill=FACE)
    draw.rectangle([cx - s * 0.62, cy + s * 0.42, cx + s * 0.27, cy + s * 0.56], fill=fill)
    w = max(SS * 2, int(s * 0.09))
    draw.line([(cx + s * 0.15, cy - s * 0.25), (cx + s * 0.38, cy - s * 0.05)], fill=fill, width=w)
    draw.line([(cx + s * 0.38, cy - s * 0.05), (cx + s * 0.38, cy + s * 0.3)], fill=fill, width=w)
    draw.line([(cx + s * 0.38, cy + s * 0.3), (cx + s * 0.5, cy + s * 0.3)], fill=fill, width=w)
    draw.line([(cx + s * 0.5, cy + s * 0.3), (cx + s * 0.5, cy - s * 0.35)], fill=fill, width=w)


def thermometer(draw, cx, cy, s, fill):
    """ISO 2575 engine coolant temperature: thermometer in two waves."""
    w = max(SS * 2, int(s * 0.1))
    draw.line([(cx, cy - s * 0.6), (cx, cy + s * 0.15)], fill=fill, width=w)
    for k in range(3):
        y = cy - s * (0.5 - 0.17 * k)
        draw.line([(cx, y), (cx + s * 0.22, y)], fill=fill, width=max(SS, w // 2))
    draw.ellipse([cx - s * 0.16, cy + s * 0.08, cx + s * 0.16, cy + s * 0.4], fill=fill)
    for dy in (0.42, 0.58):
        pts = []
        for i in range(25):
            t = i / 24
            x = cx - s * 0.6 + s * 1.2 * t
            pts.append((x, cy + s * dy + s * 0.05 * math.sin(t * 4 * math.pi)))
        draw.line(pts, fill=fill, width=max(SS, w // 2))


def small_gauge(size: int, low: str, high: str, symbol, warn_low: bool) -> Image.Image:
    img, draw, cx, cy, r = dial_base(size)
    # Scale arc over the top: 5 ticks from −45° to +45°.
    ticks(draw, cx, cy, r * 1.0, 4, 2, 0, SMALL_START, SMALL_SWEEP)
    if warn_low:  # reserve band near E
        band = [cx - r * 0.9, cy - r * 0.9, cx + r * 0.9, cy + r * 0.9]
        draw.arc(band, SMALL_START - 90, SMALL_START - 90 + 10, fill=RED, width=int(r * 0.09))
    else:  # overheat band near H
        band = [cx - r * 0.9, cy - r * 0.9, cx + r * 0.9, cy + r * 0.9]
        draw.arc(
            band, SMALL_START + SMALL_SWEEP - 90 - 12, SMALL_START + SMALL_SWEEP - 90, fill=RED, width=int(r * 0.09)
        )
    font = get_noto_font(int(r * 0.24), bold=True)
    text_center(draw, clock(cx, cy, r * 0.58, SMALL_START - 8), low, font, RED if warn_low else WHITE)
    text_center(draw, clock(cx, cy, r * 0.58, SMALL_START + SMALL_SWEEP + 8), high, font, WHITE if warn_low else RED)
    symbol(draw, cx, cy + r * 0.42, r * 0.3, (200, 204, 210))
    return downsample(img, (size, size))


def gauge_small(size: int = 256) -> Image.Image:
    """Left half: fuel (E–F); right half: coolant temperature (C–H)."""
    sheet = Image.new("RGB", (size * 2, size), FACE)
    sheet.paste(small_gauge(size, "E", "F", fuel_pump, True), (0, 0))
    sheet.paste(small_gauge(size, "C", "H", thermometer, False), (size, 0))
    return sheet


# ---------------------------------------------------------------------------- tell-tales

TELLTALES = ["TurnL", "TurnR", "HighBeam", "Parking"]  # atlas cells 0–3 (4 × 1 grid)


def arrow(draw, cx, cy, s, direction, fill):
    """Turn signal: solid arrow (ISO 2575)."""
    d = 1 if direction > 0 else -1
    head = [(cx + d * s * 0.62, cy), (cx + d * s * 0.02, cy - s * 0.5), (cx + d * s * 0.02, cy + s * 0.5)]
    draw.polygon(head, fill=fill)
    x0, x1 = sorted((cx - d * s * 0.6, cx + d * s * 0.05))
    draw.rectangle([x0, cy - s * 0.2, x1, cy + s * 0.2], fill=fill)


def headlamp(draw, cx, cy, s, fill, rays_down: bool, rays: int):
    """Lamp (flat lens on the left, round back on the right) with rays from the lens.

    Horizontal rays = main beam (ISO 2575, blue); rays sloping down = dipped beam.
    """
    w = max(SS * 2, int(s * 0.11))
    x0 = cx - s * 0.05
    box = [x0 - s * 0.55, cy - s * 0.45, x0 + s * 0.55, cy + s * 0.45]
    draw.chord(box, -90, 90, outline=fill, width=w)
    draw.line([(x0, cy - s * 0.45), (x0, cy + s * 0.45)], fill=fill, width=w)
    for i in range(rays):
        y = cy - s * 0.36 + s * 0.72 * i / (rays - 1)
        dy = s * 0.18 if rays_down else 0
        draw.line([(x0 - s * 0.14, y), (x0 - s * 0.72, y + dy)], fill=fill, width=w)


def parking_brake(draw, cx, cy, s, fill):
    """Parking brake: circled P between two arcs (ISO 2575)."""
    w = max(SS * 3, int(s * 0.1))
    r = s * 0.45
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=fill, width=w)
    rr = s * 0.68
    draw.arc([cx - rr, cy - rr, cx + rr, cy + rr], 130, 230, fill=fill, width=w)
    draw.arc([cx - rr, cy - rr, cx + rr, cy + rr], -50, 50, fill=fill, width=w)
    text_center(draw, (cx, cy + s * 0.02), "P", get_noto_font(int(s * 0.6 * 1.0), bold=True), fill)


def telltales(cell: int = 128) -> Image.Image:
    cols, rows = 4, 1
    big = cell * SS
    img = Image.new("RGB", (cols * big, rows * big), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = big * 0.42
    for i, name in enumerate(TELLTALES):
        cx = (i % cols + 0.5) * big
        cy = (i // cols + 0.5) * big
        if name == "TurnL":
            arrow(draw, cx, cy, s, -1, GREEN)
        elif name == "TurnR":
            arrow(draw, cx, cy, s, 1, GREEN)
        elif name == "HighBeam":
            headlamp(draw, cx + s * 0.05, cy, s, BLUE, rays_down=False, rays=5)
        elif name == "Parking":
            parking_brake(draw, cx, cy, s, RED)
    return downsample(img, (cols * cell, rows * cell))


# ---------------------------------------------------------------------------- panels


def fan_symbol(draw, cx, cy, s, fill):
    for k in range(3):
        a = math.radians(120 * k)
        pts = []
        for i in range(9):
            t = i / 8
            ang = a + t * 1.4
            rr = s * (0.12 + 0.38 * t)
            pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
        pts += [(cx + s * 0.12 * math.cos(a + 0.6), cy + s * 0.12 * math.sin(a + 0.6))]
        draw.polygon(pts, fill=fill)
    draw.ellipse([cx - s * 0.1, cy - s * 0.1, cx + s * 0.1, cy + s * 0.1], fill=fill)


def recirc_symbol(draw, cx, cy, s, fill):
    """Air recirculation: car outline with a looping arrow inside (ISO 2575)."""
    w = max(SS * 2, int(s * 0.08))
    body = [(cx - s * 0.7, cy + s * 0.35), (cx - s * 0.6, cy - s * 0.05), (cx - s * 0.25, cy - s * 0.4)]
    body += [(cx + s * 0.35, cy - s * 0.4), (cx + s * 0.7, cy + s * 0.05), (cx + s * 0.7, cy + s * 0.35)]
    draw.line(body + [body[0]], fill=fill, width=w, joint="curve")
    r = s * 0.22
    draw.arc([cx - r, cy - r * 0.6, cx + r, cy + r * 1.1], 200, 520, fill=fill, width=w)
    draw.polygon([(cx - r * 1.2, cy + r * 0.1), (cx - r * 0.7, cy + r * 0.5), (cx - r * 0.35, cy)], fill=fill)


def defrost_symbol(draw, cx, cy, s, fill, rear: bool):
    """Windscreen (curved) or rear window (rectangle) with three wavy arrows up."""
    w = max(SS * 2, int(s * 0.08))
    if rear:
        draw.rectangle([cx - s * 0.6, cy - s * 0.45, cx + s * 0.6, cy + s * 0.25], outline=fill, width=w)
    else:
        draw.arc([cx - s * 0.7, cy - s * 0.5, cx + s * 0.7, cy + s * 0.9], 200, 340, fill=fill, width=w)
        draw.line([(cx - s * 0.66, cy + s * 0.25), (cx + s * 0.66, cy + s * 0.25)], fill=fill, width=w)
    for k in (-1, 0, 1):
        x = cx + k * s * 0.3
        pts = [(x + s * 0.06 * math.sin(t * 2 * math.pi), cy + s * 0.15 - s * 0.55 * t) for t in np.linspace(0, 1, 12)]
        draw.line(pts, fill=fill, width=max(SS, w // 2))


def hvac_panel(width: int = 512, height: int = 256) -> Image.Image:
    """Faceplate for three rotary knobs (u = 0.2 / 0.5 / 0.8, v = 0.5) and four buttons (v = 0.15).

    Knob centres and button rectangles are geometry in cockpit.py; this draws only the scales
    and symbols around them. Hazard switch (red triangle) sits at the top centre.
    """
    W, H = width * SS, height * SS
    img = Image.new("RGB", (W, H), (22, 23, 26))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([SS * 4, SS * 4, W - SS * 4, H - SS * 4], radius=SS * 18, outline=(52, 55, 60), width=SS * 3)
    knob_v = 0.5
    knob_r = H * 0.12
    label = get_noto_font(int(H * 0.075), bold=True)
    small = get_noto_font(int(H * 0.06))
    grey = (190, 194, 200)
    for k, u in enumerate((0.2, 0.5, 0.8)):
        cx, cy = W * u, H * (1 - knob_v)
        if k == 0:  # temperature: blue → red arc
            for i in range(41):
                deg = -130 + 260 * i / 40
                t = i / 40
                col = (int(60 + 190 * t), int(120 - 70 * abs(t - 0.5) * 2), int(250 - 220 * t))
                draw.line([clock(cx, cy, knob_r * 1.3, deg), clock(cx, cy, knob_r * 1.6, deg)], fill=col, width=SS * 4)
        elif k == 1:  # fan speed: OFF 1 2 3 4
            for i, t in enumerate(["OFF", "1", "2", "3", "4"]):
                deg = -120 + 60 * i
                text_center(draw, clock(cx, cy, knob_r * 1.6, deg), t, small, grey)
            fan_symbol(draw, cx, cy + knob_r * 1.45, knob_r * 0.4, grey)
        else:  # mode: face / bi-level / foot / foot+defrost / defrost (dots + small defrost)
            for i in range(5):
                deg = -120 + 60 * i
                x, y = clock(cx, cy, knob_r * 1.4, deg)
                draw.ellipse([x - SS * 5, y - SS * 5, x + SS * 5, y + SS * 5], fill=grey)
            defrost_symbol(draw, *clock(cx, cy, knob_r * 1.85, 120), knob_r * 0.35, grey, rear=False)
    # Button row: A/C, recirculation, rear defogger, front defroster.
    bw, bh = W * 0.16, H * 0.18
    for i, kind in enumerate(["AC", "REC", "REAR", "FRONT"]):
        cx, cy = W * (0.2 + 0.2 * i), H * (1 - 0.15)
        draw.rounded_rectangle(
            [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], radius=SS * 8, outline=(70, 74, 80), width=SS * 3
        )
        if kind == "AC":
            text_center(draw, (cx, cy), "A/C", label, grey)
        elif kind == "REC":
            recirc_symbol(draw, cx, cy, bh * 0.45, grey)
        else:
            defrost_symbol(draw, cx, cy, bh * 0.4, (250, 170, 40) if kind == "REAR" else grey, rear=kind == "REAR")
    # Hazard switch symbol (two nested triangles, red).
    cx, cy, s = W * 0.5, H * 0.13, H * 0.065
    tri = [(cx, cy - s), (cx + s * 1.1, cy + s * 0.75), (cx - s * 1.1, cy + s * 0.75)]
    draw.polygon(tri, outline=RED, width=SS * 4)
    inner = [(cx, cy - s * 0.4), (cx + s * 0.55, cy + s * 0.45), (cx - s * 0.55, cy + s * 0.45)]
    draw.polygon(inner, outline=RED, width=SS * 3)
    return downsample(img, (width, height))


def shift_gate(size: int = 256) -> Image.Image:
    """Automatic transmission gate: slot with P R N D B down the left of the plate."""
    big = size * SS
    img = Image.new("RGB", (big, big), (16, 17, 19))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([big * 0.42, big * 0.06, big * 0.58, big * 0.94], radius=big * 0.07, fill=(4, 4, 5))
    font = get_noto_font(int(big * 0.12), bold=True)
    for i, ch in enumerate("PRNDB"):
        y = big * (0.14 + 0.18 * i)
        text_center(draw, (big * 0.25, y), ch, font, RED if ch == "P" else (220, 224, 230))
    return downsample(img, (size, size))


# ---------------------------------------------------------------------------- materials


def fabric_seat(size: int = 256) -> Image.Image:
    """Dark grey melange weave (tileable)."""
    coarse = periodic_noise(size, 10, 1)
    fine = periodic_noise(size, 90, 2)
    y, x = np.mgrid[0:size, 0:size]
    weave = 0.5 + 0.5 * np.sin(2 * np.pi * x / 4) * np.sin(2 * np.pi * y / 4)
    lum = 0.55 * coarse + 0.3 * fine + 0.15 * weave
    base = np.array([52, 54, 60], dtype=np.float64)
    rgb = base[None, None, :] * (0.72 + 0.56 * lum[..., None])
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def fabric_headliner(size: int = 128) -> Image.Image:
    """Light grey knit headliner (tileable)."""
    lum = 0.6 * periodic_noise(size, 60, 3) + 0.4 * periodic_noise(size, 14, 4)
    base = np.array([188, 186, 180], dtype=np.float64)
    rgb = base[None, None, :] * (0.9 + 0.16 * lum[..., None])
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def plastic_grain(size: int = 256) -> Image.Image:
    """Soft-touch dashboard plastic: fine leather-like grain on dark grey (tileable)."""
    cells = periodic_noise(size, 40, 5)
    pits = periodic_noise(size, 120, 6)
    lum = 0.7 * np.abs(cells - 0.5) * 2 + 0.3 * pits
    base = np.array([40, 42, 46], dtype=np.float64)
    rgb = base[None, None, :] * (0.85 + 0.3 * lum[..., None])
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def speaker_grille(size: int = 128) -> Image.Image:
    """Perforated speaker mesh, staggered holes (tileable at 16 px pitch)."""
    big = size * SS
    img = Image.new("RGB", (big, big), (34, 35, 38))
    draw = ImageDraw.Draw(img)
    pitch = 16 * SS
    r = 4.5 * SS
    for j in range(big // pitch + 1):
        for i in range(big // pitch + 2):
            x = i * pitch + (pitch / 2 if j % 2 else 0)
            y = j * pitch + pitch / 2
            for dx in (-big, 0, big):
                draw.ellipse([x + dx - r, y - r, x + dx + r, y + r], fill=(6, 6, 7))
    return downsample(img, (size, size)).filter(ImageFilter.SMOOTH)


GENERATORS = {
    "gauge_speed.png": gauge_speed,
    "gauge_tacho.png": gauge_tacho,
    "gauge_small.png": gauge_small,
    "telltales.png": telltales,
    "hvac_panel.png": hvac_panel,
    "shift_gate.png": shift_gate,
    "fabric_seat.png": fabric_seat,
    "fabric_headliner.png": fabric_headliner,
    "plastic_grain.png": plastic_grain,
    "speaker_grille.png": speaker_grille,
}


def contact_sheet(images: dict[str, Image.Image], path: Path) -> None:
    cell = 300
    cols = 4
    rows = math.ceil(len(images) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 24)), (60, 64, 70))
    draw = ImageDraw.Draw(sheet)
    font = get_noto_font(14)
    for k, (name, img) in enumerate(images.items()):
        scale = min((cell - 12) / img.width, (cell - 12) / img.height)
        thumb = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.Resampling.LANCZOS)
        x, y = (k % cols) * cell, (k // cols) * (cell + 24)
        sheet.paste(thumb, (x + 6, y + 6))
        draw.text((x + 6, y + cell), f"{name} {img.width}x{img.height}", font=font, fill=(235, 238, 240))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    images = {}
    for name, gen in GENERATORS.items():
        img = gen()
        img.save(OUTPUT_DIR / name, optimize=True)
        images[name] = img
        print(f"{name}: {img.width}x{img.height} {(OUTPUT_DIR / name).stat().st_size / 1024:.1f} KB")
    if len(sys.argv) > 1:
        contact_sheet(images, Path(sys.argv[1]))
        print(f"contact sheet: {sys.argv[1]}")


if __name__ == "__main__":
    main()
