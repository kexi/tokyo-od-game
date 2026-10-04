# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pillow>=10.0.0",
#     "requests>=2.31.0",
#     "fonttools>=4.47.0",
#     "brotli>=1.1.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Web fonts for the 案内標識 boards drawn at runtime (src/world/guideArt.ts).

The boards are drawn on canvases in the browser because their place names and arrows come from
the road network around the player. The fonts ship with the game, cut down to what the boards
can show:

- Japanese: Noto Sans JP (SIL OFL 1.1), the pinned google/fonts file the texture scripts use,
  instanced at weight 700 and subset to assets/signs/guide/charset.txt (every 表示地名, junction
  name, street name and OSM destination of the 23 wards, written by scripts/guide-signs.ts).
- Latin: Overpass (SIL OFL 1.1, The Overpass Project Authors), a sans modelled on the US
  "Highway Gothic" road-sign letters, pinned to the same google/fonts commit and checked by
  SHA-256; instanced at weight 700 and subset to printable ASCII plus the Hepburn macrons.

Why not Roboto Condensed: a condensed grotesque reads well but has nothing of the signage
letterforms; Overpass's open apertures and even stroke match the 別表第二 文字の形 (図 252) more
closely. Why not the system fonts: a board would look different on every device, and Android has
no Hiragino.

    uv run scripts/textures/guide_fonts.py
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
from pathlib import Path

import requests
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from signs.base import FONT_CACHE_DIR, font_file  # noqa: E402  (the pinned Noto Sans JP)

OUT = ROOT / "assets" / "signs" / "guide"
CHARSET = OUT / "charset.txt"
OVERPASS_URL = (
    "https://raw.githubusercontent.com/google/fonts/295d98a7a0c17c68f1341eaeea354e7960ea70d3/"
    "ofl/overpass/Overpass%5Bwght%5D.ttf"
)
OVERPASS_SHA256 = "970717df17a7f9911dee45f60695d05bfa9d745fa0a11fc5c348371fa21f0073"
USER_AGENT = "tokyo-od-game-assets/0.1 (+https://github.com/kexi/tokyo-od-game)"
WEIGHT = 700


def log(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


def overpass_file() -> Path:
    path = FONT_CACHE_DIR / "Overpass-VariableFont_wght.ttf"
    if not path.exists():
        FONT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        resp = requests.get(OVERPASS_URL, headers={"User-Agent": USER_AGENT}, timeout=60)
        resp.raise_for_status()
        path.write_bytes(resp.content)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != OVERPASS_SHA256:
        raise RuntimeError(f"unexpected font hash {digest} for {path}")
    return path


def build(src: Path, text: str, out: Path) -> None:
    font = TTFont(str(src))
    static = instancer.instantiateVariableFont(font, {"wght": WEIGHT})
    opts = subset.Options()
    opts.flavor = "woff2"
    # Keep every name record: the copyright and the OFL notice (IDs 0, 13, 14) travel with the font.
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.layout_features = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(static)
    buf = io.BytesIO()
    static.flavor = "woff2"
    static.save(buf)
    out.write_bytes(buf.getvalue())
    log("font_written", file=str(out.relative_to(ROOT)), bytes=len(buf.getvalue()), glyphs=len(static.getGlyphOrder()))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    chars = CHARSET.read_text(encoding="utf-8").strip()
    ascii_text = "".join(chr(c) for c in range(0x20, 0x7F))
    # Japanese boards also print digits (300m) and the full-width forms some names use.
    build(font_file(), chars + ascii_text + "（）・ー", OUT / "guide-jp.woff2")
    build(overpass_file(), ascii_text + "ĀāĒēĪīŌōŪū–—’", OUT / "guide-latin.woff2")


if __name__ == "__main__":
    main()
