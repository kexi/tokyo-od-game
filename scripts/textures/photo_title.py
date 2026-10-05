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
"""The game's title over the landmark photos (scripts/teaser/photos.mjs), in English.

    uv run scripts/textures/photo_title.py out/photos [--place y-viral=hud,ticket=corner]

Every <name>-raw.png in the folder gets a titled <name>.png beside it, in the top left unless
--place says otherwise for the photos that keep the game's panels (features.mjs): `hud`, smaller
and right of the location and navi panels in the top left; `corner`, smaller in the bottom right
over the dashboard, where a toast at the top centre or the ticket's dialog leaves no room above.
The top left is over the roof lining that frames the windscreen from the driver's seat, so the
title covers none of the view. It is the LAW-ABIDING plate (the start screen's 法令厳守 plate
in English: white with a red border and blue lettering like a 規制標識) above TOKYO OPEN DRIVE
with OPEN in yellow, as the share card has it (og_image.py). Sizes follow the photo's width.
Text uses the pinned Noto Sans JP (car_textures.py).
"""

from __future__ import annotations

import sys
from pathlib import Path

from car_textures import get_noto_font
from PIL import Image, ImageDraw, ImageFilter

YELLOW = (255, 216, 77)
RED = (215, 38, 46)
BLUE = (27, 63, 149)
WHITE = (255, 255, 255)


def title(photo: Image.Image, place: str = "top") -> Image.Image:
    """The photo with the title drawn on it (sizes for a 2560 px wide photo, scaled to its width)."""
    out = photo.convert("RGB")
    k0 = out.width / 2560
    k = k0 if place == "top" else k0 * 0.7

    badge_font = get_noto_font(round(40 * k), bold=True)
    title_font = get_noto_font(round(84 * k), bold=True)
    badge = "LAW-ABIDING"
    measure = ImageDraw.Draw(out)
    pad_x, pad_y, border = round(24 * k), round(8 * k), max(2, round(6 * k))
    badge_w = measure.textlength(badge, font=badge_font) + 2 * pad_x
    badge_h = round(40 * k * 1.25) + 2 * pad_y
    title_w = measure.textlength("TOKYO OPEN DRIVE", font=title_font)
    block_h = badge_h + round(14 * k) + round(84 * k * 1.2)
    if place == "hud":
        # The game's top-left panels end ≈ 300 px in (at 2560 wide).
        x, y = round(330 * k0), round(44 * k0)
    elif place == "corner":
        x = round(out.width - 72 * k0 - title_w)
        y = round(out.height - 64 * k0 - block_h)
    else:
        x, y = round(72 * k0), round(56 * k0)
    title_y = y + badge_h + round(14 * k)

    # A soft shadow under the words, so they read over the roof lining and the sky alike.
    shadow = Image.new("L", out.size, 0)
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([x, y, x + badge_w, y + badge_h], radius=round(12 * k), fill=150)
    tx = x
    for word in ("TOKYO ", "OPEN ", "DRIVE"):
        sd.text((tx + 3 * k, title_y + 4 * k), word, font=title_font, fill=200)
        tx += measure.textlength(word, font=title_font)
    shadow = shadow.filter(ImageFilter.GaussianBlur(10 * k))
    out = Image.composite(Image.new("RGB", out.size, (0, 0, 0)), out, shadow)

    draw = ImageDraw.Draw(out)
    draw.rounded_rectangle(
        [x, y, x + badge_w, y + badge_h], radius=round(12 * k), fill=WHITE, outline=RED, width=border
    )
    draw.text((x + pad_x, y + pad_y), badge, font=badge_font, fill=BLUE)
    tx = x
    for word, colour in (("TOKYO ", WHITE), ("OPEN ", YELLOW), ("DRIVE", WHITE)):
        draw.text((tx, title_y), word, font=title_font, fill=colour)
        tx += draw.textlength(word, font=title_font)
    return out


def main() -> None:
    args = sys.argv[1:]
    places: dict[str, str] = {}
    if "--place" in args:
        at = args.index("--place")
        places = dict(item.split("=", 1) for item in args[at + 1].split(","))
        del args[at : at + 2]
    if len(args) != 1:
        sys.exit("usage: photo_title.py <folder of *-raw.png> [--place name=hud|corner,...]")
    for raw in sorted(Path(args[0]).glob("*-raw.png")):
        name = raw.name.removesuffix("-raw.png")
        titled = raw.with_name(name + ".png")
        title(Image.open(raw), places.get(name, "top")).save(titled, "PNG", optimize=True)
        print(f"saved {titled} ({titled.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
