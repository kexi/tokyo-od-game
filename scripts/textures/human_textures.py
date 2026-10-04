# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural texture generator for Tokyo Open Drive pedestrian models.

Generates 5 character component textures (face, shirt, pants, hair, shoes) with
reproducible procedural techniques, fixed random seeds, and no external images or fonts.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Dict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Deterministic seed for all procedural generation
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TEXTURES_DIR = PROJECT_ROOT / "assets" / "human" / "textures"


def _draw_dashed_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    dash_len: float = 4.0,
    gap_len: float = 3.0,
    fill: int | tuple[int, ...] = 140,
    width: int = 1,
) -> None:
    """Draw a straight dashed line to represent stitches/seams."""
    x0, y0 = start
    x1, y1 = end
    dx = x1 - x0
    dy = y1 - y0
    dist = math.hypot(dx, dy)
    if dist <= 0:
        return

    ux = dx / dist
    uy = dy / dist
    curr = 0.0
    while curr < dist:
        seg_end = min(curr + dash_len, dist)
        sx = x0 + ux * curr
        sy = y0 + uy * curr
        ex = x0 + ux * seg_end
        ey = y0 + uy * seg_end
        draw.line([(sx, sy), (ex, ey)], fill=fill, width=width)
        curr += dash_len + gap_len


def generate_face() -> Image.Image:
    """1. face.png (512x512, Grayscale RGB):

    Orthographic projection of the front half of the head.
    - Image center is the center of the face (u=0.5, v=0.5).
    - Image boundaries are the head contour.
    - Eyes at v=0.55 (y = 512 * (1 - 0.55) = 230.4).
    - Mouth at v=0.30 (y = 512 * (1 - 0.30) = 358.4).
    - Base is white (#FFFFFF, 255).
    - Eyebrows, eyes (pupils/iris only, no whites), subtle nose shading, mouth in dark/medium gray.
    - Calm, clean, non-anime restrained aesthetic.
    """
    w, h = 512, 512
    # Base array with pure white
    arr = np.full((h, w), 255, dtype=np.float32)

    # Subtle soft contour / ambient occlusion towards the outer circular contour
    # Head radius = 256 px
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2.0, h / 2.0
    r = np.hypot(xx - cx, yy - cy)
    # Vignette / subtle contour shading near outer rim (r > 200)
    rim_mask = np.clip((r - 180.0) / 76.0, 0.0, 1.0)
    arr -= rim_mask * 15.0  # gentle 6% falloff at extreme boundary

    # Subtle nose bridge and tip shading
    # Nose bridge: x=256, y from ~210 to ~300
    nose_dx = (xx - cx) / 14.0
    nose_dy = (yy - 275.0) / 35.0
    nose_dist = np.hypot(nose_dx, nose_dy)
    # Soft nose shadow on one side (e.g. right/bottom of nose tip)
    nose_tip_dx = (xx - (cx + 6.0)) / 16.0
    nose_tip_dy = (yy - 295.0) / 12.0
    nose_tip_dist = np.hypot(nose_tip_dx, nose_tip_dy)

    nose_shade = np.exp(-(nose_tip_dist**2)) * 30.0 + np.exp(-(nose_dist**2)) * 10.0
    arr -= nose_shade

    # Cheek blush/soft tone (very subtle)
    for cheek_x in [cx - 95.0, cx + 95.0]:
        chk_dist = np.hypot((xx - cheek_x) / 35.0, (yy - 265.0) / 20.0)
        arr -= np.exp(-(chk_dist**2)) * 8.0

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, mode="L")
    draw = ImageDraw.Draw(img)

    # Eye parameters (v = 0.55 -> y = 230)
    eye_y = 230.4
    eye_spacing = 76.0
    eye_left_x = cx - eye_spacing
    eye_right_x = cx + eye_spacing

    # Eyebrows (v ~ 0.63 -> y ~ 190)
    # Calm, natural arched lines
    eyebrow_y = 190.0
    # Left eyebrow
    left_brow = [
        (eye_left_x - 38.0, eyebrow_y + 4.0),
        (eye_left_x - 10.0, eyebrow_y - 4.0),
        (eye_left_x + 30.0, eyebrow_y + 2.0),
    ]
    # Right eyebrow
    right_brow = [
        (eye_right_x - 30.0, eyebrow_y + 2.0),
        (eye_right_x + 10.0, eyebrow_y - 4.0),
        (eye_right_x + 38.0, eyebrow_y + 4.0),
    ]

    # Draw smooth eyebrows with antialiasing via thickness
    for pts in [left_brow, right_brow]:
        for i in range(len(pts) - 1):
            draw.line([pts[i], pts[i + 1]], fill=60, width=4)

    # Eyes: Dark gray pupils/irises only, no white sclera (stylized low-poly pedestrian)
    # Slender, calm oval / soft rounded eyes
    pupil_rx = 11.0
    pupil_ry = 13.0
    for ex in [eye_left_x, eye_right_x]:
        # Iris / dark center
        draw.ellipse(
            [ex - pupil_rx, eye_y - pupil_ry, ex + pupil_rx, eye_y + pupil_ry],
            fill=45,
        )
        # Subtle upper eyelid line
        draw.arc(
            [ex - pupil_rx - 8.0, eye_y - pupil_ry - 4.0, ex + pupil_rx + 8.0, eye_y + pupil_ry],
            start=190,
            end=350,
            fill=40,
            width=3,
        )

    # Nose nostrils / subtle bottom curve (v ~ 0.42 -> y ~ 298)
    nose_base_y = 298.0
    draw.arc(
        [cx - 12.0, nose_base_y - 6.0, cx + 12.0, nose_base_y + 6.0],
        start=30,
        end=150,
        fill=100,
        width=2,
    )
    # Small soft nostril shadows
    draw.ellipse([cx - 10.0, nose_base_y - 1.0, cx - 6.0, nose_base_y + 2.0], fill=120)
    draw.ellipse([cx + 6.0, nose_base_y - 1.0, cx + 10.0, nose_base_y + 2.0], fill=120)

    # Mouth: v = 0.30 -> y = 358.4
    mouth_y = 358.4
    mouth_w = 34.0
    # Gentle, calm closed mouth line with slight curve
    mouth_pts = [
        (cx - mouth_w, mouth_y),
        (cx - mouth_w * 0.4, mouth_y + 1.5),
        (cx + mouth_w * 0.4, mouth_y + 1.5),
        (cx + mouth_w, mouth_y),
    ]
    for i in range(len(mouth_pts) - 1):
        draw.line([mouth_pts[i], mouth_pts[i + 1]], fill=60, width=3)
    # Subtle lower lip shadow
    draw.arc(
        [cx - mouth_w * 0.45, mouth_y + 5.0, cx + mouth_w * 0.45, mouth_y + 13.0],
        start=30,
        end=150,
        fill=160,
        width=2,
    )

    # Convert to RGB (Grayscale RGB mode)
    return img.convert("RGB")


def generate_shirt() -> Image.Image:
    """2. shirt.png (512x512, Grayscale):

    - Left half (u 0..0.5, x 0..256): Torso Front.
      - Neckline / collar (top, v=1 -> y=0).
      - Button placket down the center of front (x=128).
      - Chest pocket (e.g. left chest around x=185, y=170..230).
    - Right half (u 0.5..1.0, x 256..512): Torso Back.
      - Back neckline.
      - Vertical center seam (x=384).
      - Shoulder yoke seam.
    - Bottom 1/8 band (y: 448..512, v 0..0.125): Sleeve cuffs (plain + cuff seam stitching).
    - v=0 is hem (bottom, y=512), v=1 is neck (top, y=0).
    - Fine fabric weave texture throughout.
    """
    w, h = 512, 512
    # Fabric weave background using sinusoidal / high frequency pattern
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # Fine cotton / oxford cloth weave: alternating orthogonal threads
    weave_x = np.cos(xx * (2.0 * np.pi / 4.0))
    weave_y = np.cos(yy * (2.0 * np.pi / 4.0))
    weave = (weave_x * weave_y) * 4.0  # subtle +-4 modulation around 250
    # Fine perlin-like noise
    noise = (np.sin(xx * 0.15) * np.cos(yy * 0.15) + np.sin(xx * 0.37 + yy * 0.23)) * 2.0

    arr = np.full((h, w), 252.0, dtype=np.float32) + weave + noise

    # Cuff zone: bottom 1/8 (y from 448 to 512)
    # Sleeve cuffs are plain fabric with top seam
    cuff_y = 448
    arr[cuff_y:h, :] = 252.0 + (weave_x[cuff_y:h, :] * weave_y[cuff_y:h, :]) * 3.0

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, mode="L")
    draw = ImageDraw.Draw(img)

    # -------------------------------------------------------------
    # FRONT HALF (x: 0 to 256, center x = 128)
    # -------------------------------------------------------------
    front_cx = 128.0

    # Front collar / neckline (v=1 is top, y=0)
    # Crew/V neck collar band
    collar_y_max = 85.0
    collar_w = 75.0
    # Draw collar ribbing / neckline band
    collar_outer = [
        (front_cx - collar_w, 0.0),
        (front_cx - collar_w * 0.6, collar_y_max * 0.6),
        (front_cx, collar_y_max),
        (front_cx + collar_w * 0.6, collar_y_max * 0.6),
        (front_cx + collar_w, 0.0),
    ]
    for i in range(len(collar_outer) - 1):
        draw.line([collar_outer[i], collar_outer[i + 1]], fill=170, width=4)
        draw.line([collar_outer[i], collar_outer[i + 1]], fill=100, width=1)

    # Inner collar fold line
    collar_inner = [
        (front_cx - collar_w + 12.0, 0.0),
        (front_cx - collar_w * 0.5, collar_y_max * 0.5 - 6.0),
        (front_cx, collar_y_max - 12.0),
        (front_cx + collar_w * 0.5, collar_y_max * 0.5 - 6.0),
        (front_cx + collar_w - 12.0, 0.0),
    ]
    for i in range(len(collar_inner) - 1):
        draw.line([collar_inner[i], collar_inner[i + 1]], fill=150, width=2)

    # Button placket down the front center from collar to cuff line (y: collar_y_max to 440)
    placket_w = 14.0
    placket_left = front_cx - placket_w / 2.0
    placket_right = front_cx + placket_w / 2.0
    draw.rectangle([placket_left, collar_y_max, placket_right, cuff_y - 8.0], fill=246, outline=180, width=1)
    _draw_dashed_line(
        draw, (placket_left + 2, collar_y_max), (placket_left + 2, cuff_y - 8.0), dash_len=3, gap_len=2, fill=160
    )
    _draw_dashed_line(
        draw, (placket_right - 2, collar_y_max), (placket_right - 2, cuff_y - 8.0), dash_len=3, gap_len=2, fill=160
    )

    # Buttons along placket
    button_ys = [115, 175, 235, 295, 355, 415]
    for by in button_ys:
        # Button shadow + disc
        draw.ellipse([front_cx - 5, by - 5, front_cx + 5, by + 5], fill=220, outline=120, width=1)
        draw.ellipse([front_cx - 3, by - 3, front_cx + 3, by + 3], fill=245)
        # 4 button holes/thread
        draw.point(
            [(front_cx - 1, by - 1), (front_cx + 1, by - 1), (front_cx - 1, by + 1), (front_cx + 1, by + 1)], fill=80
        )
        draw.line([(front_cx - 1, by - 1), (front_cx + 1, by + 1)], fill=100, width=1)
        draw.line([(front_cx - 1, by + 1), (front_cx + 1, by - 1)], fill=100, width=1)

    # Chest pocket on left chest (viewer's right, x ~ 175..230, y ~ 160..230)
    p_left, p_right = 175.0, 230.0
    p_top, p_bot = 160.0, 230.0
    p_pts = [
        (p_left, p_top),
        (p_right, p_top),
        (p_right, p_bot - 10.0),
        ((p_left + p_right) / 2.0, p_bot),
        (p_left, p_bot - 10.0),
        (p_left, p_top),
    ]
    # Pocket background + outline
    draw.polygon(p_pts, fill=248, outline=160)
    # Pocket top hem
    draw.line([(p_left, p_top + 10.0), (p_right, p_top + 10.0)], fill=180, width=1)
    _draw_dashed_line(draw, (p_left + 2, p_top + 2), (p_right - 2, p_top + 2), dash_len=3, gap_len=2, fill=140)
    # Pocket edge stitching
    for i in range(1, len(p_pts) - 1):
        _draw_dashed_line(draw, p_pts[i], p_pts[i + 1], dash_len=3, gap_len=2, fill=150)

    # -------------------------------------------------------------
    # BACK HALF (x: 256 to 512, center x = 384)
    # -------------------------------------------------------------
    back_cx = 384.0

    # Back neckline (shallower curve)
    back_neck_y = 35.0
    back_neck_w = 70.0
    back_collar = [
        (back_cx - back_neck_w, 0.0),
        (back_cx - back_neck_w * 0.5, back_neck_y * 0.6),
        (back_cx, back_neck_y),
        (back_cx + back_neck_w * 0.5, back_neck_y * 0.6),
        (back_cx + back_neck_w, 0.0),
    ]
    for i in range(len(back_collar) - 1):
        draw.line([back_collar[i], back_collar[i + 1]], fill=170, width=4)
        draw.line([back_collar[i], back_collar[i + 1]], fill=110, width=1)

    # Shoulder yoke seam across back (y ~ 95)
    yoke_y = 95.0
    draw.line([(256.0, yoke_y), (512.0, yoke_y)], fill=175, width=2)
    _draw_dashed_line(draw, (256.0, yoke_y + 3.0), (512.0, yoke_y + 3.0), dash_len=4, gap_len=3, fill=150)

    # Center vertical back seam (x = 384)
    draw.line([(back_cx, yoke_y), (back_cx, cuff_y - 8.0)], fill=180, width=2)
    _draw_dashed_line(draw, (back_cx - 2, yoke_y), (back_cx - 2, cuff_y - 8.0), dash_len=4, gap_len=3, fill=155)
    _draw_dashed_line(draw, (back_cx + 2, yoke_y), (back_cx + 2, cuff_y - 8.0), dash_len=4, gap_len=3, fill=155)

    # Boundary separator between front and back side seam (x = 256)
    draw.line([(256, 0), (256, cuff_y)], fill=190, width=1)
    _draw_dashed_line(draw, (254, 0), (254, cuff_y), dash_len=4, gap_len=3, fill=165)

    # -------------------------------------------------------------
    # SLEEVE CUFF BAND (y: 448 to 512, bottom 1/8)
    # -------------------------------------------------------------
    # Top seam of cuff band
    draw.line([(0, cuff_y), (512, cuff_y)], fill=150, width=2)
    _draw_dashed_line(draw, (0, cuff_y + 4), (512, cuff_y + 4), dash_len=4, gap_len=2, fill=130)
    _draw_dashed_line(draw, (0, cuff_y + 8), (512, cuff_y + 8), dash_len=4, gap_len=2, fill=140)

    # Cuff hem at very bottom (y = 508)
    draw.line([(0, 508), (512, 508)], fill=170, width=1)
    _draw_dashed_line(draw, (0, 504), (512, 504), dash_len=4, gap_len=2, fill=140)

    # Front hem seam above cuff (y = 438)
    draw.line([(0, 438), (512, 438)], fill=180, width=1)
    _draw_dashed_line(draw, (0, 434), (512, 434), dash_len=4, gap_len=3, fill=160)

    return img.convert("RGB")


def generate_pants() -> Image.Image:
    """3. pants.png (512x256, Grayscale):

    - Cylindrical leg unwrapping: u (width 512) is 1 loop around leg, SEAMLESS at u=0 and u=1 (x=0 & x=512).
    - v=0 is hem (bottom, y=256), v=1 is waist (top, y=0).
    - Seams (side seams, inseams).
    - Knee wrinkles (around v=0.5 -> y=128).
    - Waistband at top (v: 0.85..1.0 -> y: 0..38) with belt loops spaced periodically.
    """
    w, h = 512, 256
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    # Twill / denim diagonal weave pattern: periodic in x
    # To be seamless across x (0..512), wave frequency must be integer multiple of 2*pi
    # 512 / (2 * pi / freq) = integer -> freq = k * 2*pi / 512
    # e.g., diagonal twill lines: (xx + yy) or (xx - yy)
    twill_k = 64  # 64 cycles across width
    twill_freq = twill_k * 2.0 * np.pi / 512.0
    twill = np.sin(xx * twill_freq + yy * twill_freq * 1.5) * 3.5

    # Denim slub / horizontal micro-texture
    denim_slub = np.sin(yy * 1.8) * np.cos(xx * twill_freq * 0.5) * 2.0

    arr = np.full((h, w), 250.0, dtype=np.float32) + twill + denim_slub

    # Knee wrinkles: around y = 128 (v=0.5)
    # Natural fabric creases: horizontally periodic waves fading in y
    knee_y = 128.0
    knee_mask = np.exp(-((yy - knee_y) ** 2) / (32.0**2))
    # Periodic crease wave (seamless in x: k=3 cycles around leg)
    crease_freq1 = 3.0 * 2.0 * np.pi / 512.0
    crease_freq2 = 5.0 * 2.0 * np.pi / 512.0
    creases = (
        np.sin(xx * crease_freq1 + np.sin(xx * crease_freq2) * 0.5) * 14.0 + np.cos(xx * crease_freq2 * 2.0) * 6.0
    ) * knee_mask

    # Additional secondary wrinkle bands above/below knee
    creases += np.sin(xx * crease_freq1 * 2.0) * 8.0 * np.exp(-((yy - (knee_y - 25.0)) ** 2) / (16.0**2))
    creases += np.cos(xx * crease_freq1 * 2.0) * 7.0 * np.exp(-((yy - (knee_y + 25.0)) ** 2) / (16.0**2))

    arr -= np.maximum(creases, -5.0)  # shadow depth for wrinkles

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, mode="L")
    draw = ImageDraw.Draw(img)

    # -------------------------------------------------------------
    # WAISTBAND & BELT LOOPS (y: 0 to 38)
    # -------------------------------------------------------------
    waist_h = 38
    # Waistband bottom seam
    draw.line([(0, waist_h), (w, waist_h)], fill=160, width=2)
    _draw_dashed_line(draw, (0, waist_h - 4), (w, waist_h - 4), dash_len=4, gap_len=2, fill=140)
    _draw_dashed_line(draw, (0, 4), (w, 4), dash_len=4, gap_len=2, fill=140)

    # Belt loops: 4 evenly spaced belt loops around the cylinder circumference
    # To keep seamlessness, loops are placed symmetrically (e.g. at x = 0/512 (split), 128, 256, 384)
    loop_xs = [0.0, 128.0, 256.0, 384.0, 512.0]
    loop_w = 14.0
    for lx in loop_xs:
        # Left and right bounds
        x_min = lx - loop_w / 2.0
        x_max = lx + loop_w / 2.0
        # Draw on canvas, handling wraparound at 0 and 512
        for offset in [0.0, -512.0, 512.0]:
            ox_min = x_min + offset
            ox_max = x_max + offset
            if ox_max < 0 or ox_min > w:
                continue
            # Belt loop rect
            draw.rectangle([ox_min, 2, ox_max, waist_h - 2], fill=242, outline=150, width=1)
            # Top/bottom bartack reinforcement stitch
            _draw_dashed_line(draw, (ox_min + 2, 4), (ox_max - 2, 4), dash_len=2, gap_len=1, fill=110, width=2)
            _draw_dashed_line(
                draw, (ox_min + 2, waist_h - 4), (ox_max - 2, waist_h - 4), dash_len=2, gap_len=1, fill=110, width=2
            )

    # -------------------------------------------------------------
    # SEAMS (Outseam and Inseam)
    # -------------------------------------------------------------
    # Outseam at x = 0 / 512 (split seamless seam)
    # Double flat-felled seam down the outer side of leg
    for seam_x in [0.0, 512.0]:
        for offset in [0.0, -512.0, 512.0]:
            sx = seam_x + offset
            # Main seam
            draw.line([(sx, waist_h), (sx, h)], fill=160, width=2)
            # Double parallel stitch
            _draw_dashed_line(draw, (sx - 4, waist_h), (sx - 4, h), dash_len=4, gap_len=2, fill=140)
            _draw_dashed_line(draw, (sx + 4, waist_h), (sx + 4, h), dash_len=4, gap_len=2, fill=140)

    # Inseam at center x = 256
    inseam_x = 256.0
    draw.line([(inseam_x, waist_h), (inseam_x, h)], fill=170, width=2)
    _draw_dashed_line(draw, (inseam_x - 3, waist_h), (inseam_x - 3, h), dash_len=4, gap_len=2, fill=145)
    _draw_dashed_line(draw, (inseam_x + 3, waist_h), (inseam_x + 3, h), dash_len=4, gap_len=2, fill=145)

    # -------------------------------------------------------------
    # HEM AT BOTTOM (v=0 -> y: 240..256)
    # -------------------------------------------------------------
    hem_top_y = 240
    draw.line([(0, hem_top_y), (w, hem_top_y)], fill=165, width=2)
    _draw_dashed_line(draw, (0, hem_top_y + 4), (w, hem_top_y + 4), dash_len=4, gap_len=2, fill=135)
    _draw_dashed_line(draw, (0, 252), (w, 252), dash_len=4, gap_len=2, fill=145)

    return img.convert("RGB")


def generate_hair() -> Image.Image:
    """4. hair.png (256x256, Grayscale):

    - Hair strand flow texture.
    - Seamlessly tileable in BOTH horizontal and vertical directions (torus topology).
    - Base is clean white (#FFFFFF) with gray strand highlights and depth striations.
    """
    w, h = 256, 256

    # Generate seamless 2D periodic noise / hair flow
    # In order to make hair flow tileable on [0..W) x [0..H), we map 2D coordinates (x, y)
    # to a 4D torus: (cos(2pi*x/W), sin(2pi*x/W), cos(2pi*y/H), sin(2pi*y/H))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    # Torus angles
    u_ang = xx * (2.0 * np.pi / w)
    v_ang = yy * (2.0 * np.pi / h)

    # Hair flow primarily follows longitudinal strands with subtle wavy curl
    # Multiple harmonious Fourier modes for natural fibrous hair look
    strands = np.zeros((h, w), dtype=np.float32)

    # High frequency strand waves (k = 8, 16, 32, 64 cycles horizontally)
    freqs = [
        (4, 1, 14.0, 0.3),
        (8, 2, 10.0, 0.7),
        (16, 3, 8.0, 1.2),
        (32, 4, 6.0, 2.0),
        (64, 6, 4.0, 3.5),
        (128, 8, 3.0, 4.2),
    ]

    for ku, kv, amp, phase in freqs:
        # Periodic wave with diagonal shear simulating hair flow direction
        wave = np.sin(ku * u_ang + kv * np.sin(v_ang + phase))
        wave += np.cos(ku * u_ang * 1.5 + kv * np.cos(v_ang)) * 0.5
        strands += wave * amp

    # Layered hair strand clumps (specular sheen band across middle of hair tile)
    # Highlight band along v (soft sine in v)
    sheen = np.sin(v_ang - 0.5) ** 4 * 10.0

    # Composite onto white base (255)
    # Base around 250, with subtle strand shadows dipping to ~180..200
    base = 248.0 - (strands - np.min(strands)) / (np.max(strands) - np.min(strands)) * 55.0
    base += sheen

    arr = np.clip(base, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, mode="L")

    # Gentle directional blur along hair flow (vertical) to smooth microfibers
    # Apply periodic blur by padding before filter
    pad = 32
    padded = Image.new("L", (w + pad * 2, h + pad * 2))
    # Tile 3x3 into padded image
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            padded.paste(img, (pad + dx * w, pad + dy * h))

    # Blur slightly along flow
    blurred = padded.filter(ImageFilter.GaussianBlur(radius=0.8))
    # Crop back central tile
    cropped = blurred.crop((pad, pad, pad + w, pad + h))

    return cropped.convert("RGB")


def generate_shoes() -> Image.Image:
    """5. shoes.png (256x128, Color):

    - Sneaker side unwrapped (u is 1 loop around shoe, seamless at left/right).
    - Dark upper (navy/charcoal/black) + White sole (rubber outsole + midsole).
    - Sneaker panels: toe cap, side accent stripe, heel counter, stitching, eyelets/laces zone.
    """
    w, h = 256, 128
    # Create RGBA image
    img = Image.new("RGBA", (w, h), (30, 32, 38, 255))
    draw = ImageDraw.Draw(img)

    # Upper body background texture
    # Fine canvas / mesh texture on upper (seamless in x)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u_ang = xx * (2.0 * np.pi / w)
    mesh_tex = np.sin(u_ang * 32) * np.sin(yy * 1.5) * 4.0

    # Sole dimensions: bottom 38% of shoe (y: 80 to 128)
    sole_top_y = 80.0
    outsole_h = 12.0

    # Upper panel base (dark charcoal navy)
    upper_base = np.zeros((h, w, 4), dtype=np.float32)
    upper_base[:, :, 0] = 38.0 + mesh_tex  # R
    upper_base[:, :, 1] = 42.0 + mesh_tex  # G
    upper_base[:, :, 2] = 52.0 + mesh_tex  # B
    upper_base[:, :, 3] = 255.0

    # Sole: White midsole + gum/light gray tread outsole
    sole_mask = yy >= sole_top_y
    # Midsole: White (#F5F5F7)
    upper_base[sole_mask, 0] = 245.0
    upper_base[sole_mask, 1] = 246.0
    upper_base[sole_mask, 2] = 248.0

    # Outsole (bottom tread: y >= 116)
    outsole_mask = yy >= (h - outsole_h)
    upper_base[outsole_mask, 0] = 220.0
    upper_base[outsole_mask, 1] = 222.0
    upper_base[outsole_mask, 2] = 226.0

    # Convert back to PIL for detailed vector drawing
    arr = np.clip(upper_base, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, mode="RGBA")
    draw = ImageDraw.Draw(img)

    # -------------------------------------------------------------
    # UPPER PANELS & SPORTY ACCENT STRIPE (Seamless cylindrical wrap)
    # -------------------------------------------------------------
    # Shoe mapping:
    # x=0/256: Heel back seam
    # x=64: Lateral side (outer)
    # x=128: Toe box / front cap
    # x=192: Medial side (inner)

    # Toe cap panel (around x = 128, y: 35..80)
    toe_cx = 128.0
    toe_w = 42.0
    draw.arc(
        [toe_cx - toe_w, 20.0, toe_cx + toe_w, sole_top_y + 10.0], start=180, end=360, fill=(28, 30, 36, 255), width=4
    )
    _draw_dashed_line(
        draw,
        (toe_cx - toe_w + 3, sole_top_y),
        (toe_cx - toe_w * 0.7, 40),
        dash_len=3,
        gap_len=2,
        fill=(160, 165, 175, 255),
    )
    _draw_dashed_line(
        draw, (toe_cx - toe_w * 0.7, 40), (toe_cx + toe_w * 0.7, 40), dash_len=3, gap_len=2, fill=(160, 165, 175, 255)
    )
    _draw_dashed_line(
        draw,
        (toe_cx + toe_w * 0.7, 40),
        (toe_cx + toe_w - 3, sole_top_y),
        dash_len=3,
        gap_len=2,
        fill=(160, 165, 175, 255),
    )

    # Sporty dynamic side wave stripe on both lateral (x=64) and medial (x=192) sides
    # Crisp clean white/silver curved accent line
    for side_cx in [64.0, 192.0]:
        stripe_pts = [
            (side_cx - 45.0, 72.0),
            (side_cx - 20.0, 48.0),
            (side_cx + 15.0, 42.0),
            (side_cx + 45.0, 68.0),
        ]
        # Draw double swoop stripe
        for i in range(len(stripe_pts) - 1):
            draw.line([stripe_pts[i], stripe_pts[i + 1]], fill=(235, 238, 245, 255), width=3)
            # Accent second colored piping (subtle teal/cyan hue for modern sneaker flair)
            p0 = (stripe_pts[i][0], stripe_pts[i][1] - 4.0)
            p1 = (stripe_pts[i + 1][0], stripe_pts[i + 1][1] - 4.0)
            draw.line([p0, p1], fill=(80, 180, 200, 255), width=2)

    # Heel counter panel at x = 0 and x = 256 (split seamless heel wrap)
    for hx in [0.0, 256.0]:
        for offset in [0.0, -256.0, 256.0]:
            cx = hx + offset
            draw.line([(cx - 22, sole_top_y), (cx - 15, 15)], fill=(22, 24, 28, 255), width=2)
            draw.line([(cx + 22, sole_top_y), (cx + 15, 15)], fill=(22, 24, 28, 255), width=2)
            _draw_dashed_line(
                draw, (cx - 18, sole_top_y), (cx - 12, 18), dash_len=3, gap_len=2, fill=(150, 155, 165, 255)
            )
            _draw_dashed_line(
                draw, (cx + 18, sole_top_y), (cx + 12, 18), dash_len=3, gap_len=2, fill=(150, 155, 165, 255)
            )
            # Heel vertical back seam
            draw.line([(cx, 10), (cx, sole_top_y)], fill=(18, 20, 24, 255), width=2)
            _draw_dashed_line(
                draw, (cx - 2, 10), (cx - 2, sole_top_y), dash_len=3, gap_len=2, fill=(140, 145, 155, 255)
            )

    # Upper collar rim line (top of shoe opening)
    draw.line([(0, 12), (w, 12)], fill=(25, 27, 32, 255), width=2)
    _draw_dashed_line(draw, (0, 16), (w, 16), dash_len=4, gap_len=2, fill=(130, 135, 145, 255))

    # -------------------------------------------------------------
    # SOLE DETAILING (Midsole groove + Tread grooves)
    # -------------------------------------------------------------
    # Midsole top rim shadow line (where upper meets sole)
    draw.line([(0, sole_top_y), (w, sole_top_y)], fill=(180, 182, 188, 255), width=2)
    draw.line([(0, sole_top_y + 2), (w, sole_top_y + 2)], fill=(255, 255, 255, 255), width=1)

    # Midsole texture: horizontal accent groove
    mid_groove_y = sole_top_y + 16.0
    draw.line([(0, mid_groove_y), (w, mid_groove_y)], fill=(215, 218, 224, 255), width=2)
    draw.line([(0, mid_groove_y + 2), (w, mid_groove_y + 2)], fill=(255, 255, 255, 255), width=1)

    # Vertical flex grooves on outsole (periodic every 16 px across 256 -> 16 grooves, perfectly seamless)
    for gx in range(0, w, 16):
        draw.line([(gx, h - outsole_h), (gx, h)], fill=(180, 182, 188, 255), width=2)

    # Bottom edge shadow
    draw.line([(0, h - 1), (w, h - 1)], fill=(150, 152, 158, 255), width=1)

    return img.convert("RGB")


# ----------------------------------------------------------------------
# Contact Sheet Generator
# ----------------------------------------------------------------------
def generate_contact_sheet(textures: Dict[str, Image.Image], output_path: Path) -> None:
    """Generates an organized inspection contact sheet of all textures."""
    sheet_w, sheet_h = 1200, 900
    sheet = Image.new("RGB", (sheet_w, sheet_h), (24, 26, 32))
    draw = ImageDraw.Draw(sheet)

    # Title header
    draw.rectangle([0, 0, sheet_w, 60], fill=(16, 18, 22))
    draw.text((24, 18), "Tokyo Open Drive - Pedestrian Textures Overview", fill=(240, 245, 255))

    # Grid layout for 5 textures
    # 1: face (512x512) -> left col
    # 2: shirt (512x512) -> mid col
    # 3: pants (512x256), 4: hair (256x256), 5: shoes (256x128) -> right col
    slots = [
        ("face.png", (40, 90, 360, 360)),
        ("shirt.png", (430, 90, 360, 360)),
        ("pants.png", (820, 90, 340, 170)),
        ("hair.png", (820, 310, 180, 180)),
        ("shoes.png", (820, 540, 280, 140)),
    ]

    for filename, (x, y, max_dw, max_dh) in slots:
        if filename not in textures:
            continue
        img_item = textures[filename]
        iw, ih = img_item.size

        # Checkerboard background for inspection
        checker = Image.new("RGB", (max_dw, max_dh), (45, 48, 56))
        cdraw = ImageDraw.Draw(checker)
        cs = 16
        for cy in range(0, max_dh, cs):
            for cx in range(0, max_dw, cs):
                if (cx // cs + cy // cs) % 2 == 1:
                    cdraw.rectangle([cx, cy, min(cx + cs, max_dw), min(cy + cs, max_dh)], fill=(55, 58, 68))

        scale = min(max_dw / iw, max_dh / ih)
        target_w = int(iw * scale)
        target_h = int(ih * scale)
        resized = img_item.resize((target_w, target_h), resample=Image.Resampling.LANCZOS)

        paste_x = (max_dw - target_w) // 2
        paste_y = (max_dh - target_h) // 2
        checker.paste(resized, (paste_x, paste_y))
        cdraw.rectangle([0, 0, max_dw - 1, max_dh - 1], outline=(90, 95, 110), width=1)
        sheet.paste(checker, (x, y))

        draw.text((x, y + max_dh + 8), f"{filename} ({iw}x{ih})", fill=(220, 230, 245))

    sheet.save(str(output_path), "PNG", optimize=True)
    print(f"[OK] Saved contact sheet: {output_path}")


# ----------------------------------------------------------------------
# Main Execution Entry Point
# ----------------------------------------------------------------------
def main() -> None:
    TEXTURES_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating pedestrian textures for Tokyo Open Drive...")

    generators = {
        "face.png": generate_face,
        "shirt.png": generate_shirt,
        "pants.png": generate_pants,
        "hair.png": generate_hair,
        "shoes.png": generate_shoes,
    }

    textures: Dict[str, Image.Image] = {}

    for filename, gen_fn in generators.items():
        print(f"Generating {filename}...")
        img = gen_fn()
        textures[filename] = img
        out_path = TEXTURES_DIR / filename
        # Save PNG with optimization (<150KB target)
        img.save(str(out_path), "PNG", optimize=True)
        file_size_kb = out_path.stat().st_size / 1024
        print(f"  -> Saved {out_path.name} ({img.width}x{img.height}, {img.mode}, {file_size_kb:.1f} KB)")

    # Optional contact sheet: `uv run scripts/textures/human_textures.py <preview.png>`
    if len(sys.argv) > 1:
        contact_sheet_path = Path(sys.argv[1])
        print(f"Generating contact sheet preview at {contact_sheet_path}...")
        generate_contact_sheet(textures, contact_sheet_path)

    print("\nAll pedestrian textures generated successfully!")


if __name__ == "__main__":
    main()
