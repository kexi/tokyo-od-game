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
"""The game's cover image (16:9, PNG, English): a photo of the game (scripts/teaser/photos.mjs)
with the title, the tagline and the credit for what the picture shows.

    uv run scripts/textures/cover_image.py out/photos/tokyo-tower-raw.png out/cover.png

Laid out like the share card (og_image.py) at the photo's own size (2560×1440 from photos.mjs): the
left darkened for the LAW-ABIDING plate and TOKYO OPEN / DRIVE (OPEN in yellow), the game's
English tagline (src/i18n/en.ts title.tagline) under it, the URL and the credit in the lower left.
The credit is on the image itself: it shows PLATEAU's buildings (PDL 1.0 asks for "processed"),
OpenStreetMap's roads (© OpenStreetMap contributors) and GSI tiles, in the game's English wording.
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
SOFT = (225, 232, 242)
DIM = (190, 198, 212)


def cover(photo: Image.Image) -> Image.Image:
    """The photo (cropped to 16:9 if it is not) with the cover's words (sizes for 2560 px wide)."""
    out = photo.convert("RGB")
    target_h = round(out.width * 9 / 16)
    if out.height != target_h:
        top = max(0, (out.height - target_h) // 2)
        out = out.crop((0, top, out.width, top + target_h))
    w, h = out.size
    k = w / 2560

    # Darken the left for the words, fading out before the middle where the landmark stands.
    shade = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(shade)
    for x in range(w):
        strength = max(0.0, 1 - x / (1300 * k))
        sd.line([(x, 0), (x, h)], fill=int(175 * strength**1.5))
    # And the lower left harder, under the URL and the credit: the dashboard's navi screen is
    # there in the in-car photos, its bright map lines behind the small words.
    band_top = h - 360 * k
    for y in range(int(band_top), h):
        rise = (y - band_top) / (360 * k)
        for x0, x1, level in ((0, 900 * k, 1.0), (900 * k, 1250 * k, 0.5)):
            sd.line([(x0, y), (x1, y)], fill=int(235 * rise**0.7 * level))
    shade = shade.filter(ImageFilter.GaussianBlur(40 * k))
    out = Image.composite(Image.new("RGB", (w, h), (8, 14, 28)), out, shade)
    draw = ImageDraw.Draw(out)

    def shadowed(pos: tuple[float, float], text: str, font, fill) -> None:
        draw.text((pos[0] + 4 * k, pos[1] + 5 * k), text, font=font, fill=(0, 0, 0))
        draw.text(pos, text, font=font, fill=fill)

    left = 140 * k
    # The LAW-ABIDING plate leads the title, as 法令厳守 does on the start screen.
    # Sized to end before the middle of the picture, where the photos put the landmark.
    badge_font = get_noto_font(round(52 * k), bold=True)
    badge = "LAW-ABIDING"
    bw = draw.textlength(badge, font=badge_font)
    by = 250 * k
    draw.rounded_rectangle(
        [left, by, left + bw + 72 * k, by + 96 * k],
        radius=round(22 * k),
        fill=WHITE,
        outline=RED,
        width=max(3, round(11 * k)),
    )
    draw.text((left + 36 * k, by + 12 * k), badge, font=badge_font, fill=BLUE)

    title_font = get_noto_font(round(150 * k), bold=True)
    x, y = left, 380 * k
    for word, colour in (("TOKYO ", WHITE), ("OPEN", YELLOW)):
        shadowed((x, y), word, title_font, colour)
        x += draw.textlength(word, font=title_font)
    shadowed((left, y + 170 * k), "DRIVE", title_font, WHITE)

    # The game's tagline (en.ts title.tagline), split at its dash.
    tag_font = get_noto_font(round(52 * k), bold=True)
    shadowed((left, 790 * k), "Drive Tokyo's 23 wards", tag_font, SOFT)
    shadowed((left, 865 * k), "by the letter of the law", tag_font, SOFT)
    sub_font = get_noto_font(round(34 * k))
    shadowed((left, 960 * k), "Built from Tokyo open data × PLATEAU 3D city models", sub_font, DIM)

    url_font = get_noto_font(round(36 * k), bold=True)
    shadowed((left, 1200 * k), "kexi.github.io/tokyo-od-game", url_font, SOFT)
    # Two short lines, kept left of the dashboard's gauges (from x ≈ 900 in the in-car photos).
    credit_font = get_noto_font(round(22 * k))
    shadowed((left, 1272 * k), "Source: MLIT, “3D City Models (Project PLATEAU) Tokyo”, processed", credit_font, DIM)
    shadowed((left, 1306 * k), "© OpenStreetMap contributors · GSI Tiles", credit_font, DIM)
    return out


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("usage: cover_image.py <photo.png> <cover.png>")
    photo_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cover(Image.open(photo_path)).save(out_path, "PNG", optimize=True)
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"saved {out_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
