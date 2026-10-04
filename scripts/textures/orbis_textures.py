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
"""予告看板 (warning sign) face for the オービス model (scripts/blender/orbis.py).

Draws the blue board Tokyo puts up before a 速度違反自動取締装置: 「スピード落せ」 in yellow over
「自動速度取締機 / 設置路線」 in white, with a white edge line. The sign is 法定外 (no law fixes its
design); the wording and colours follow the one on the Rainbow Bridge exit (Wikimedia Commons, CC BY-SA
4.0). The police force's name under it is left off, as the repo draws no real organisation's name.

Usage:
    uv run scripts/textures/orbis_textures.py [contact-sheet.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# car_textures imports numpy at module level, hence the dependency above.
from car_textures import get_noto_font  # noqa: E402

PROJECT_ROOT = SCRIPTS_DIR.parent.parent
OUTPUT_DIR = PROJECT_ROOT / "assets" / "orbis" / "textures"

# The board is 1.8 × 0.9 m (scripts/blender/orbis.py BOARD_W/BOARD_H): 2:1, so 1024 × 512 px.
SIZE = (1024, 512)
BLUE = (22, 74, 160)  # 案内標識 blue, as in the sign photographs
WHITE = (246, 246, 242)
YELLOW = (250, 212, 0)


def fit_font(text: str, max_width: int, size: int, bold: bool = True):
    """Largest Noto Sans JP size ≤ size whose rendering of text fits max_width."""
    while size > 12:
        font = get_noto_font(size, bold=bold)
        left, _, right, _ = font.getbbox(text)
        if right - left <= max_width:
            return font
        size -= 2
    return get_noto_font(size, bold=bold)


def centred(draw: ImageDraw.ImageDraw, text: str, y: int, font, fill) -> None:
    left, top, right, bottom = font.getbbox(text)
    x = (SIZE[0] - (right - left)) // 2 - left
    draw.text((x, y - (bottom + top) // 2), text, font=font, fill=fill)


def warning_route() -> Image.Image:
    """「スピード落せ / 自動速度取締機 / 設置路線」 on blue with a white edge line."""
    img = Image.new("RGB", SIZE, BLUE)
    draw = ImageDraw.Draw(img)
    # White edge line 14 px in from the edge (~2.5 cm on the 1.8 m board), rounded corners.
    draw.rounded_rectangle((14, 14, SIZE[0] - 15, SIZE[1] - 15), radius=26, outline=WHITE, width=10)
    width = SIZE[0] - 120
    centred(draw, "スピード落せ", 120, fit_font("スピード落せ", width, 108), YELLOW)
    centred(draw, "自動速度取締機", 262, fit_font("自動速度取締機", width, 102), WHITE)
    centred(draw, "設置路線", 392, fit_font("設置路線", width, 102), WHITE)
    return img


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    textures = {"warning_route": warning_route()}
    for name, img in textures.items():
        path = OUTPUT_DIR / f"{name}.png"
        img.save(path, optimize=True)
        print(f"wrote {path} {img.size[0]}x{img.size[1]}")
    if len(sys.argv) > 1:
        sheet = Path(sys.argv[1])
        sheet.parent.mkdir(parents=True, exist_ok=True)
        # The board at its real 2:1 proportion on a grey ground.
        canvas = Image.new("RGB", (1104, 592), (128, 132, 136))
        canvas.paste(textures["warning_route"], (40, 40))
        canvas.save(sheet)
        print(f"wrote {sheet}")


if __name__ == "__main__":
    main()
