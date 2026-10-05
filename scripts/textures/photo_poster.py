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
"""The photos of the game (scripts/teaser/photos.mjs, features.mjs) laid out like the cover
(cover_image.py), in English, so each says what it shows even on a phone:

    uv run scripts/textures/photo_poster.py out/photos

Every <name>-raw.png named in CAPTIONS gets <name>.png beside it: one side darkened, the game's
title small at the top (the LAW-ABIDING plate and TOKYO OPEN DRIVE, OPEN in yellow), a headline
and a line under it large enough to read with the picture a phone's width (≈ 1/6 of 2560 px:
the headline ≈ 19 px there), the URL at the foot. Why not the small title alone, as before: the
game's own panels (the Y post, the ticket, the toast citing the law) are too small to read on a
phone, so what the picture shows was lost there. Text uses the pinned Noto Sans JP
(car_textures.py).
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
SOFT = (225, 232, 242)

# name: (headline, the line under it, the side the words go on). Right for the ticket, whose
# dialog fills the left and the middle (its words narrower, kept right of the dialog's edge).
CAPTIONS: dict[str, tuple[str, str, str]] = {
    "y-viral": ("Run a red light, and Y piles on", "A witness films it. Replies and reposts flood in.", "left"),
    "ticket": ("Pulled over: a ticket by the book", "Fines and penalty points per the Road Traffic Act", "right"),
    "law-abiding": (
        "Keep the law. The game cites it.",
        "Engine off at the light: Tokyo's anti-idling ordinance, Art. 52",
        "left",
    ),
    "tokyo-station": (
        "The real Tokyo, built from open data",
        "Tokyo Station on a rainy night, from the driver's seat",
        "left",
    ),
    "tokyo-skytree": ("Drive all 23 wards of Tokyo", "Every building from PLATEAU 3D city models", "left"),
    "tokyo-skytree-close": (
        "Rain on the glass, wipers at work",
        "The Skytree through the windscreen of a rainy night",
        "left",
    ),
    "tokyo-tower-east": ("Landmarks lit on their real schedule", "Tokyo Tower in its night illumination", "left"),
    "tokyo-tower-south": (
        "Signals and limits from real data",
        "Traffic regulations from open data, at every crossing",
        "left",
    ),
    "tokyo-tower-close": ("Tokyo's weather, live", "Rain from the city's own observations, wet roads and all", "left"),
}


# How wide the words may run (px at 2560 wide; default 1000): short of the landmark in the middle
# (≈ 40–48 % across), and right of the ticket's dialog (it ends ≈ 1660 px in).
COLUMNS = {"y-viral": 860, "ticket": 720}


def wrap(draw: ImageDraw.ImageDraw, text: str, font, width: float) -> list[str]:
    """`text` broken at spaces into lines no wider than `width`."""
    lines: list[str] = []
    for word in text.split():
        trial = f"{lines[-1]} {word}" if lines else word
        if lines and draw.textlength(trial, font=font) <= width:
            lines[-1] = trial
        else:
            lines.append(word)
    return lines


def poster(photo: Image.Image, name: str, headline: str, sub: str, side: str) -> Image.Image:
    """The photo with the title, the headline and its line (sizes for 2560 px wide, scaled)."""
    out = photo.convert("RGB")
    w, h = out.size
    k = w / 2560
    is_left = side == "left"
    column = COLUMNS.get(name, 1000) * k
    margin = 120 * k

    # Darken the words' side, fading out before the middle where the landmark stands.
    shade = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(shade)
    for x in range(w):
        reach = x if is_left else w - x
        strength = max(0.0, 1 - reach / (1350 * k))
        sd.line([(x, 0), (x, h)], fill=int(190 * strength**1.4))
    shade = shade.filter(ImageFilter.GaussianBlur(40 * k))
    out = Image.composite(Image.new("RGB", (w, h), (8, 14, 28)), out, shade)
    draw = ImageDraw.Draw(out)

    def shadowed(pos: tuple[float, float], text: str, font, fill) -> None:
        draw.text((pos[0] + 4 * k, pos[1] + 5 * k), text, font=font, fill=(0, 0, 0))
        draw.text(pos, text, font=font, fill=fill)

    def x_of(text_w: float) -> float:
        return margin if is_left else w - margin - text_w

    # The title, small at the top.
    badge_font = get_noto_font(round(40 * k), bold=True)
    brand_font = get_noto_font(round(72 * k), bold=True)
    badge = "LAW-ABIDING"
    badge_w = draw.textlength(badge, font=badge_font) + 56 * k
    brand_w = draw.textlength("TOKYO OPEN DRIVE", font=brand_font)
    by = 90 * k
    bx = x_of(max(badge_w, brand_w))
    draw.rounded_rectangle(
        [bx, by, bx + badge_w, by + 74 * k],
        radius=round(14 * k),
        fill=WHITE,
        outline=RED,
        width=max(2, round(7 * k)),
    )
    draw.text((bx + 28 * k, by + 10 * k), badge, font=badge_font, fill=BLUE)
    tx, ty = bx, by + 96 * k
    for word, colour in (("TOKYO ", WHITE), ("OPEN ", YELLOW), ("DRIVE", WHITE)):
        shadowed((tx, ty), word, brand_font, colour)
        tx += draw.textlength(word, font=brand_font)

    # The headline and its line, low in the column, sized for a phone.
    head_font = get_noto_font(round(112 * k), bold=True)
    sub_font = get_noto_font(round(58 * k), bold=True)
    head = wrap(draw, headline, head_font, column)
    subs = wrap(draw, sub, sub_font, column)
    head_lh, sub_lh = 132 * k, 76 * k
    block_h = len(head) * head_lh + 34 * k + len(subs) * sub_lh
    y = h - 250 * k - block_h
    for line in head:
        shadowed((x_of(draw.textlength(line, font=head_font)), y), line, head_font, WHITE)
        y += head_lh
    # A yellow rule between the headline and its line, on the words' side.
    y += 10 * k
    rule_w = 160 * k
    rx = margin if is_left else w - margin - rule_w
    draw.rectangle([rx, y, rx + rule_w, y + 8 * k], fill=YELLOW)
    y += 24 * k
    for line in subs:
        shadowed((x_of(draw.textlength(line, font=sub_font)), y), line, sub_font, SOFT)
        y += sub_lh

    url_font = get_noto_font(round(40 * k), bold=True)
    url = "kexi.github.io/tokyo-od-game"
    shadowed((x_of(draw.textlength(url, font=url_font)), h - 150 * k), url, url_font, SOFT)
    return out


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: photo_poster.py <folder of *-raw.png>")
    folder = Path(sys.argv[1])
    for name, (headline, sub, side) in CAPTIONS.items():
        raw = folder / f"{name}-raw.png"
        if not raw.exists():
            print(f"skipped {name}: no {raw.name}")
            continue
        out = folder / f"{name}.png"
        poster(Image.open(raw), name, headline, sub, side).save(out, "PNG", optimize=True)
        print(f"saved {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
