# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.26.0",
# ]
# [tool.uv]
# exclude-newer = "2026-10-03T00:00:00Z"
# ///
"""Procedural textures for the street police officer (scripts/blender/police.py).

    uv run scripts/textures/police_textures.py [contact-sheet.png]

Writes assets/police/textures/:
  uniform.png   512x512 white-based greyscale: 活動服 (jacket) on the torso loft, same layout as
                human shirt.png (front left half, back right half, bottom 1/8 = sleeves). The model
                multiplies it by the uniform colour (baseColorFactor), so 冬/合 (紺) and 夏服 (水色)
                share one image.
  trousers.png  512x256 white-based greyscale: one loop round the leg (crease at the front).
  kit.png       256x256 full colour atlas of 4x4 cells: leather, metal, insignia, cap parts, the
                shirt-and-tie panel, a generic cap badge and sleeve patch.
  vest.png      256x128 full colour: fluorescent yellow-green mesh of the 夜光チョッキ.

No emblem, wordmark or lettering: the cap badge and sleeve patch are plain generic shapes, so the
figure reads as a Japanese police officer without reproducing the 旭日章 or any organisation name.
No external images or fonts; fixed seed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SEED = 7
RNG = np.random.default_rng(SEED)
OUT = Path(__file__).resolve().parent.parent.parent / "assets" / "police" / "textures"

# Torso loft heights (scripts/blender/police.py): v = 0.125 + 0.875 (y - Y_LO) / (Y_HI - Y_LO).
Y_LO, Y_HI = 0.84, 1.47


def row_of(y: float, h: int = 512) -> float:
    v = 0.125 + 0.875 * (y - Y_LO) / (Y_HI - Y_LO)
    return (1.0 - v) * h


def weave(h: int, w: int, base: float = 246.0, amp: float = 6.0) -> np.ndarray:
    """Fine twill: diagonal ribs plus grain noise, seamless across x when w is a power of two."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    ribs = np.sin((x + y) * (2 * np.pi / 4.0)) * amp * 0.35
    noise = RNG.normal(0.0, amp * 0.12, (h, w))
    # Quantised: the image is multiplied by a dark uniform colour, so finer steps are invisible
    # and only cost PNG size.
    return np.round(np.clip(base + ribs + noise, 0, 255) / 3.0) * 3.0


def to_img(a: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L").convert("RGB")


def seam(draw: ImageDraw.ImageDraw, p0, p1, fill=150, width=2, stitch=True):
    draw.line([p0, p1], fill=(fill,) * 3, width=width)
    if not stitch:
        return
    (x0, y0), (x1, y1) = p0, p1
    length = max(1.0, float(np.hypot(x1 - x0, y1 - y0)))
    nx, ny = -(y1 - y0) / length * 3, (x1 - x0) / length * 3
    t = 0.0
    while t < length:
        a = t / length
        b = min(1.0, (t + 3) / length)
        draw.line(
            [(x0 + (x1 - x0) * a + nx, y0 + (y1 - y0) * a + ny), (x0 + (x1 - x0) * b + nx, y0 + (y1 - y0) * b + ny)],
            fill=(fill + 30,) * 3,
            width=1,
        )
        t += 6


def button(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float = 4.5, shade: int = 70):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(shade,) * 3, outline=(shade - 30,) * 3)
    draw.ellipse([cx - r * 0.45 - 1, cy - r * 0.45 - 1, cx - r * 0.45 + 1, cy - r * 0.45 + 1], fill=(shade + 60,) * 3)


# ---------------------------------------------------------------- uniform.png
def generate_uniform() -> Image.Image:
    w = h = 512
    img = to_img(weave(h, w))
    d = ImageDraw.Draw(img)
    r_hem_lo, r_hem_hi = row_of(0.925), row_of(0.968)  # 前裾ベルト / 伸縮性後裾ベルト
    r_pocket_top, r_pocket_bot = row_of(1.225), row_of(1.105)
    r_flap = row_of(1.195)
    r_v = row_of(1.315)  # bottom of the V opening (the Tie object covers it)
    r_yoke = row_of(1.365)
    fc, bc = 128, 384  # front and back centre columns

    # Hem belt: a band with a seam above, front buttons at the sides, gathers at the back.
    d.rectangle([0, r_hem_hi, w, r_hem_lo], fill=(226, 226, 226))
    seam(d, (0, r_hem_hi), (w, r_hem_hi), fill=150)
    seam(d, (0, r_hem_lo - 2), (w, r_hem_lo - 2), fill=165, stitch=False)
    for x in range(260, 508, 7):  # elastic gathers across the back
        d.line([(x, r_hem_hi + 3), (x + 2, r_hem_lo - 4)], fill=(200, 200, 200), width=1)
    for x in (300, 316, 452, 468):
        button(d, x, (r_hem_hi + r_hem_lo) / 2, r=3.5, shade=95)

    # Front placket with four buttons (前立てに桜葉ボタン四個) from the hem belt up to the V.
    d.rectangle([fc - 7, r_v, fc + 7, r_hem_hi], fill=(238, 238, 238))
    seam(d, (fc - 7, r_v), (fc - 7, r_hem_hi), fill=140, stitch=False)
    seam(d, (fc + 7, r_v), (fc + 7, r_hem_hi), fill=165)
    for k in range(4):
        y = r_v + 14 + k * (r_hem_hi - r_v - 30) / 3
        button(d, fc, y, r=5, shade=80)

    # Turn-down collar edges either side of the V (折り襟式).
    for s in (-1, 1):
        d.line([(fc + s * 6, r_v), (fc + s * 46, 0)], fill=(120, 120, 120), width=3)
        d.line([(fc + s * 12, r_v + 4), (fc + s * 58, 18)], fill=(175, 175, 175), width=1)

    # Chest pockets with flap, pleat (ひだ一条) and button, both sides.
    for cx in (fc - 46, fc + 46):
        x0, x1 = cx - 24, cx + 24
        d.rectangle([x0, r_pocket_top, x1, r_pocket_bot], fill=(236, 236, 236))
        seam(d, (x0, r_pocket_top), (x0, r_pocket_bot), fill=150)
        seam(d, (x1, r_pocket_top), (x1, r_pocket_bot), fill=150)
        seam(d, (x0, r_pocket_bot), (x1, r_pocket_bot), fill=150)
        d.line([(cx, r_flap), (cx, r_pocket_bot - 3)], fill=(185, 185, 185), width=2)  # pleat
        d.polygon(
            [(x0 - 2, r_pocket_top - 2), (x1 + 2, r_pocket_top - 2), (x1 + 2, r_flap), (x0 - 2, r_flap)],
            fill=(222, 222, 222),
        )
        d.line([(x0 - 2, r_flap), (x1 + 2, r_flap)], fill=(120, 120, 120), width=2)
        d.line([(x0 - 2, r_pocket_top - 2), (x1 + 2, r_pocket_top - 2)], fill=(150, 150, 150), width=1)
        button(d, cx, (r_pocket_top + r_flap) / 2 + 1, r=4.5, shade=80)

    # Side seams and back yoke / centre seam.
    for x in (1, 255, 257, 511):
        d.line([(x, 0), (x, r_hem_hi)], fill=(190, 190, 190), width=1)
    seam(d, (256, r_yoke), (512, r_yoke), fill=165)
    d.line([(bc, r_yoke), (bc, r_hem_hi)], fill=(205, 205, 205), width=1)

    # Soft shading: a little darker under the arms and toward the hem.
    a = np.asarray(img).astype(np.float32)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    side = np.minimum(np.abs(x - 0), np.minimum(np.abs(x - 256), np.abs(x - 512))) / 128.0
    shade = 0.93 + 0.07 * np.clip(side, 0, 1)
    a *= shade[..., None]

    # Sleeve band (bottom 1/8): v = 0.09 (y - wrist) / (top - wrist); cuff at the wrist (row 512).
    a[448:, :, :] = np.repeat(weave(64, w)[..., None], 3, axis=2)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    cuff = 512 - 0.09 * 0.075 / 0.54 * 512  # cuff 7.5 cm of the 54 cm sleeve
    seam(d, (0, cuff), (w, cuff), fill=150)
    for x in (384,):  # cuff button at the back of the wrist (カフス式、紺色樹脂ボタン一個)
        button(d, x, (cuff + 512) / 2, r=3, shade=90)
    elbow_row = 512 - 0.09 * (0.52 - 0.27) / 0.54 * 512
    for k in range(5):  # a few elbow creases
        x0 = 330 + k * 22
        d.arc([x0, elbow_row - 6, x0 + 30, elbow_row + 6], 200, 340, fill=(215, 215, 215), width=1)
    return img


# ---------------------------------------------------------------- trousers.png
def generate_trousers() -> Image.Image:
    w, h = 512, 256
    img = to_img(weave(h, w, base=244, amp=5))
    d = ImageDraw.Draw(img)
    # Pressed front crease at u = 0 (front of the leg) and a softer back crease at u = 0.5.
    for x, shade, width in ((0, 205, 3), (511, 205, 3), (256, 225, 2)):
        d.line([(x, 0), (x, h)], fill=(shade,) * 3, width=width)
    # Out/inseams at the sides (u = 0.25 and 0.75), stitched.
    for x in (128, 384):
        seam(d, (x, 0), (x, h), fill=175)
    # Hem fold.
    d.line([(0, h - 6), (w, h - 6)], fill=(190,) * 3, width=2)
    # Knee wrinkles (shin/thigh meet around v = 0.47).
    for k, x0 in enumerate(range(20, 500, 64)):
        y0 = 132 + (k % 2) * 4
        d.arc([x0, y0 - 5, x0 + 40, y0 + 5], 190, 350, fill=(218,) * 3, width=1)
    # Side pocket opening near the top of the outseam.
    for x in (128, 384):
        d.line([(x - 10, 6), (x + 2, 44)], fill=(165,) * 3, width=2)
    return img


# ---------------------------------------------------------------- kit.png (4x4 atlas)
CELL = 64
KIT_CELLS = [
    "leather",  # 0 帯革・拳銃入れ・手錠入れ・短靴
    "silver",  # 1 バックル・警笛
    "gold",  # 2 階級章の板、耳ボタン
    "idbadge",  # 3 識別章（銀色）
    "capnavy",  # 4 制帽の生地（濃紺）
    "capband",  # 5 帯章（黒色の地紋織布）
    "glossblack",  # 6 ひさし・あごひも
    "white",  # 7 警笛つりひも（白）など
    "tie",  # 8 ワイシャツとネクタイの V（Tie オブジェクト）
    "capbadge",  # 9 帽章の代わりの汎用の金色バッジ
    "patch",  # 10 右袖エンブレムの代わりの無地パッチ
    "rank",  # 11 階級章（汎用）
    "radio",  # 12 無線機
    "sole",  # 13 靴底・ゴム
    "cord",  # 14 黒ひも
    "skinshadow",  # 15 予備（濃い影）
]


def cell_box(i: int) -> tuple[int, int, int, int]:
    c, r = i % 4, i // 4
    return c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL


def noise_fill(img: Image.Image, i: int, rgb, amp: float = 6.0):
    x0, y0, x1, y1 = cell_box(i)
    n = np.round(RNG.normal(0, amp * 0.4, (CELL, CELL, 1)))  # faint grain; keeps the PNG small
    a = np.clip(np.array(rgb, dtype=np.float32)[None, None, :] + n, 0, 255).astype(np.uint8)
    img.paste(Image.fromarray(a, "RGB"), (x0, y0))


def generate_kit() -> Image.Image:
    img = Image.new("RGB", (4 * CELL, 4 * CELL), (128, 128, 128))
    noise_fill(img, 0, (24, 23, 22), 4)
    # Brushed silver gradient.
    x0, y0, _, _ = cell_box(1)
    g = np.round(np.linspace(150, 235, CELL)[None, :, None] + RNG.normal(0, 1.5, (CELL, CELL, 1)))
    img.paste(Image.fromarray(np.clip(np.repeat(g, 3, axis=2), 0, 255).astype(np.uint8), "RGB"), (x0, y0))
    noise_fill(img, 2, (205, 160, 55), 6)
    noise_fill(img, 3, (196, 200, 205), 4)
    noise_fill(img, 4, (30, 38, 62), 3)
    # Woven black band with fine horizontal lines.
    x0, y0, _, _ = cell_box(5)
    band = Image.new("RGB", (CELL, CELL), (20, 20, 22))
    bd = ImageDraw.Draw(band)
    for y in range(0, CELL, 4):
        bd.line([(0, y), (CELL, y)], fill=(38, 38, 42))
    img.paste(band, (x0, y0))
    noise_fill(img, 6, (12, 12, 14), 2)
    noise_fill(img, 7, (240, 240, 236), 3)

    # Shirt-and-tie V panel: white shirt, 藍ねず色 tie with a knot; v runs up the panel.
    x0, y0, _, _ = cell_box(8)
    p = Image.new("RGB", (CELL, CELL), (242, 243, 245))
    pd = ImageDraw.Draw(p)
    tie = (70, 84, 104)
    pd.polygon([(28, 9), (36, 9), (39, 52), (32, 63), (25, 52)], fill=tie)
    pd.polygon([(27, 2), (37, 2), (35, 10), (29, 10)], fill=(62, 75, 94))  # knot
    pd.line([(4, 0), (27, 8)], fill=(200, 202, 206), width=2)  # collar edges
    pd.line([(60, 0), (37, 8)], fill=(200, 202, 206), width=2)
    for k in range(4):
        pd.line([(28, 20 + k * 9), (37, 16 + k * 9)], fill=(80, 95, 116), width=1)  # faint stripes
    img.paste(p, (x0, y0))

    # Generic cap badge: gold oval ring with a raised centre on black felt — deliberately not the
    # 旭日章 (no rays, no wreath).
    x0, y0, _, _ = cell_box(9)
    b = Image.new("RGB", (CELL, CELL), (16, 16, 18))
    bd = ImageDraw.Draw(b)
    bd.ellipse([10, 6, 54, 58], fill=(196, 150, 48), outline=(120, 88, 24), width=2)
    bd.ellipse([18, 14, 46, 50], fill=(150, 110, 34))
    bd.ellipse([24, 21, 40, 43], fill=(228, 190, 92))
    bd.ellipse([27, 24, 32, 30], fill=(255, 236, 170))
    img.paste(b.filter(ImageFilter.SMOOTH), (x0, y0))

    # Sleeve patch: navy field with a gold frame and a plain divider; no emblem or name.
    x0, y0, _, _ = cell_box(10)
    pt = Image.new("RGB", (CELL, CELL), (22, 30, 52))
    ptd = ImageDraw.Draw(pt)
    ptd.rounded_rectangle([3, 3, 60, 60], radius=10, outline=(200, 160, 60), width=3)
    ptd.line([(8, 24), (56, 24)], fill=(200, 160, 60), width=2)
    img.paste(pt, (x0, y0))

    # Rank insignia: brushed plate with a darker centre bar (generic).
    x0, y0, _, _ = cell_box(11)
    rk = Image.new("RGB", (CELL, CELL), (190, 192, 196))
    rd = ImageDraw.Draw(rk)
    rd.rectangle([0, 22, 63, 42], fill=(40, 50, 80))
    rd.rectangle([26, 14, 38, 50], fill=(205, 165, 60))
    img.paste(rk, (x0, y0))

    # Radio: black plastic with a speaker grille.
    x0, y0, _, _ = cell_box(12)
    rr = Image.new("RGB", (CELL, CELL), (30, 31, 33))
    rrd = ImageDraw.Draw(rr)
    for yy in range(10, 40, 5):
        rrd.line([(12, yy), (52, yy)], fill=(12, 12, 12), width=2)
    rrd.rectangle([20, 46, 44, 56], fill=(60, 62, 66))
    img.paste(rr, (x0, y0))
    noise_fill(img, 13, (40, 40, 42), 3)
    noise_fill(img, 14, (18, 18, 20), 2)
    noise_fill(img, 15, (60, 50, 45), 2)
    return img


# ---------------------------------------------------------------- vest.png
def generate_vest() -> Image.Image:
    """Fluorescent yellow-green mesh; front zip at u = 0.25 (torso layout), side seams."""
    w, h = 256, 128
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    mesh = (np.sin(x * np.pi / 2.0) * np.sin(y * np.pi / 2.0) > 0.6).astype(np.float32)
    base = np.array([196, 236, 30], dtype=np.float32)
    a = base[None, None, :] * (1.0 - 0.10 * mesh[..., None])
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    d.line([(64, 0), (64, h)], fill=(120, 140, 30), width=2)  # zip
    d.line([(66, 0), (66, h)], fill=(225, 245, 120), width=1)
    for xx in (0, 127, 128, 255):
        d.line([(xx, 0), (xx, h)], fill=(160, 195, 25), width=1)
    d.line([(0, h - 3), (w, h - 3)], fill=(150, 180, 25), width=3)  # binding at the hem
    d.line([(0, 1), (w, 1)], fill=(150, 180, 25), width=3)
    return img


def contact_sheet(textures: dict[str, Image.Image], path: Path) -> None:
    pad = 16
    width = sum(min(256, t.width) for t in textures.values()) + pad * (len(textures) + 1)
    sheet = Image.new("RGB", (width, 256 + 2 * pad), (40, 42, 46))
    x = pad
    for t in textures.values():
        s = 256 / max(t.width, t.height)
        im = t.resize((int(t.width * s), int(t.height * s)), Image.Resampling.NEAREST)
        sheet.paste(im, (x, pad))
        x += im.width + pad
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    print(f"contact sheet: {path}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    textures = {
        # Greyscale PNGs (mode L): a third of the RGB size, and the glTF exporter embeds the file as is.
        "uniform.png": generate_uniform().convert("L"),
        "trousers.png": generate_trousers().convert("L"),
        "kit.png": generate_kit(),
        "vest.png": generate_vest(),
    }
    for name, img in textures.items():
        path = OUT / name
        img.save(path, optimize=True)
        print(f"{name}: {img.width}x{img.height} {path.stat().st_size / 1024:.1f} KB")
    if len(sys.argv) > 1:
        contact_sheet(textures, Path(sys.argv[1]))


if __name__ == "__main__":
    main()
