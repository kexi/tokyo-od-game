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
"""Social-share card (OGP, 1200×630): the Blender render from scripts/blender/og.py plus the title.

    uv run scripts/textures/og_image.py <scene.png> public/og.jpg

Text uses the pinned Noto Sans JP from car_textures.py (SIL OFL 1.1), drawn in the same style as
the start screen: white title with OPEN in yellow, and 法令厳守 on a white plate with a red border
and blue lettering like a 規制標識.
"""

from __future__ import annotations

import sys
from pathlib import Path

from car_textures import get_noto_font
from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 630
YELLOW = (255, 216, 77)
RED = (215, 38, 46)
BLUE = (27, 63, 149)


def main() -> None:
    scene_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    card = Image.open(scene_path).convert("RGB").resize((W, H), Image.LANCZOS)

    # Darken the upper left so the title reads over the sky.
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    for x in range(W):
        for_strength = max(0.0, 1 - x / 760)
        sd.line([(x, 0), (x, H)], fill=int(150 * for_strength**1.6))
    shade = shade.filter(ImageFilter.GaussianBlur(30))
    card = Image.composite(Image.new("RGB", (W, H), (8, 14, 28)), card, shade)

    draw = ImageDraw.Draw(card)
    title = get_noto_font(84, bold=True)
    x, y = 64, 58

    def shadowed(pos, text, font, fill):
        draw.text((pos[0] + 3, pos[1] + 4), text, font=font, fill=(0, 0, 0))
        draw.text(pos, text, font=font, fill=fill)

    for word, colour in (("TOKYO ", (255, 255, 255)), ("OPEN ", YELLOW)):
        shadowed((x, y), word, title, colour)
        x += draw.textlength(word, font=title)
    shadowed((64, y + 96), "DRIVE", title, (255, 255, 255))

    # 法令厳守 plate.
    badge = get_noto_font(46, bold=True)
    text = "法 令 厳 守"
    tw = draw.textlength(text, font=badge)
    bx, by = 64, 270
    draw.rounded_rectangle([bx, by, bx + tw + 64, by + 78], radius=16, fill=(255, 255, 255), outline=RED, width=8)
    draw.text((bx + 32, by + 10), text, font=badge, fill=BLUE)

    sub = get_noto_font(26, bold=True)
    shadowed((64, 384), "道路交通法と東京都の条例を守って", sub, (235, 240, 248))
    shadowed((64, 422), "23 区をドライブする 3D ゲーム", sub, (235, 240, 248))
    small = get_noto_font(19)
    shadowed((64, 560), "東京都オープンデータ・PLATEAU・JARTIC 交通規制情報", small, (210, 218, 230))
    shadowed((64, 588), "kexi.github.io/tokyo-od-game", small, (210, 218, 230))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    card.save(out_path, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"saved {out_path} ({out_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
