# Buildings around Tokyo Tower (within ~600 m), modelled at full size for TOKYO OPEN DRIVE:
# 増上寺 三解脱門 and 大殿 (with the halls around it), the two hotels on 芝公園 and the 1966 office
# hall north of the tower (both named generically in the game). A landmark module of
# scripts/blender/landmarks.py (LANDMARK_MODULES): landmarks.py builds, exports, writes the
# landmarks.json entry and renders the previews.
#
#   nix develop .#blender -c blender --background --factory-startup --python-exit-code 1 \
#     --python scripts/blender/landmarks.py -- public/models/<id>.glb [preview-dir]
#
# <id> is a key of BUILDERS. Previews: PREVIEW_VIEWS (front, side, oblique, pedestrian, Tokyo Tower's
# main deck, far) by day and in each night mode; LANDMARK_PREVIEW_MODES / _VIEWS narrow them.
#
# Sizes come from PLATEAU LOD2 (bldg:measuredHeight and the roof levels of the 2025 Minato-ku 3D
# Tiles), DEM5A and photographs on Wikimedia Commons measured against known heights; every number and
# how it was found is in knowledge/tokyo-tower-surroundings-blender.md. PLATEAU's shapes are lumpy
# (flat roof slabs, floating eaves), so they only set the envelope: roofs, eaves and walls are built
# here as smooth parametric surfaces.
#
# Coordinates: each building is laid out in the frame its PLATEAU survey was read in ("analysis
# frame": a along a bearing, b to its left, metres) and converted to the model frame (+Y up, +Z =
# heading, +X its left, origin on the ground) by `Site`. No facility, company or organisation names,
# logos or lettering reach the game (AGENTS.md): the hotels' rooftop sign boxes are blank panels.
import math

import landmarks as L  # the running landmarks.py (it registers this module), not a second copy
from mathutils import Vector

Builder, Palette, lin, regular = L.Builder, L.Palette, L.lin, L.regular
bpy = L.bpy
GEOID = 36.5  # m, ellipsoid − T.P. at 芝公園: PLATEAU's Tokyo Tower foot (55.0) − its T.P. 18.5 (DEM5A)
TOWER = (139.745450, 35.658592, 18.5)  # Tokyo Tower's centre and foot (landmarks.json)
TOWER_DECK_EYE = 150.0  # m above the tower's foot: the main deck's windows (floor ≈ 145–150 m)
SOURCES = {
    **L.SOURCES,
    "plateau": "出典：国土交通省 PLATEAU 3D都市モデル（2025 年度 港区 LOD1/LOD2）を加工して作成（PDL1.0）",
}


# ---------------------------------------------------------------------------------------------- frames
class Site:
    """Analysis frame (origin lon/lat, bearing of a) → model frame (heading, origin at (a0, b0))."""

    def __init__(self, lon, lat, frame_heading, a0, b0, heading=None):
        self.lon, self.lat, self.fh = lon, lat, frame_heading
        self.a0, self.b0 = a0, b0
        self.heading = frame_heading if heading is None else heading
        self.kx = 111320.0 * math.cos(math.radians(lat))
        self.ky = 110950.0

    def en(self, a, b):
        """Analysis (a, b) → east/north metres from the frame origin."""
        h = math.radians(self.fh)
        return a * math.sin(h) - b * math.cos(h), a * math.cos(h) + b * math.sin(h)

    def model(self, a, b):
        """Analysis (a, b) → model (x, z)."""
        e0, n0 = self.en(self.a0, self.b0)
        e, n = self.en(a, b)
        e, n = e - e0, n - n0
        h = math.radians(self.heading)
        return (-e * math.cos(h) + n * math.sin(h), e * math.sin(h) + n * math.cos(h))

    def outline(self, pts):
        """Analysis polygon (counter-clockwise in a-b) → model outline wound for a +Y-facing cap."""
        out = [self.model(a, b) for a, b in pts]
        if signed_area(out) > 0:  # the cap needs a clockwise (x, z) ring
            out.reverse()
        return out

    def rect(self, a0, a1, b0, b1):
        return self.outline([(a0, b0), (a1, b0), (a1, b1), (a0, b1)])

    def origin(self):
        e, n = self.en(self.a0, self.b0)
        return (self.lon + e / self.kx, self.lat + n / self.ky)

    def model_of_lonlat(self, lon, lat):
        o = self.origin()
        e, n = (lon - o[0]) * self.kx, (lat - o[1]) * self.ky
        h = math.radians(self.heading)
        return (-e * math.cos(h) + n * math.sin(h), e * math.sin(h) + n * math.cos(h))


def signed_area(pts):
    return 0.5 * sum(
        pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))
    )


def offset(outline, d):
    """Outline (x, z) moved outward by d (negative: inward) along the corner bisectors."""
    n = len(outline)
    sgn = -1.0 if signed_area(outline) < 0 else 1.0
    out = []
    for i in range(n):
        p0, p1, p2 = Vector((*outline[i - 1], 0)), Vector((*outline[i], 0)), Vector((*outline[(i + 1) % n], 0))
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1 = Vector((e1.y, -e1.x, 0)) * sgn  # outward normal of each edge
        n2 = Vector((e2.y, -e2.x, 0)) * sgn
        m = n1 + n2
        k = d / max(0.2, 1 + n1.dot(n2))
        out.append((p1.x - m.x * k, p1.y - m.y * k))
    return out


def lonlat_buffer(ring, metres):
    """A lon/lat footprint ring grown by `metres` (so the PLATEAU walls on its edge fall inside)."""
    lat0 = ring[0][1]
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110950.0
    xz = [((lon - ring[0][0]) * kx, (lat - lat0) * ky) for lon, lat in ring]
    grown = offset(xz, -metres if signed_area(xz) > 0 else metres)
    if abs(signed_area(grown)) < abs(signed_area(xz)):
        grown = offset(xz, metres if signed_area(xz) > 0 else -metres)
    return [[round(ring[0][0] + x / kx, 7), round(lat0 + z / ky, 7)] for x, z in grown]


# ---------------------------------------------------------------------------------------------- temple parts
def rect_ring(hx, hz, n):
    """Points around a rectangle (±hx, ±hz), n per side, starting at (−hx, +hz) and running +x on the +z
    side (outward-facing quads in Builder.grid with rows going up)."""
    pts = []
    corners = [(-1, 1), (1, 1), (1, -1), (-1, -1)]
    for k in range(4):
        (ax, az), (bx, bz) = corners[k], corners[(k + 1) % 4]
        for i in range(n):
            t = i / n
            pts.append(((ax + (bx - ax) * t) * hx, (az + (bz - az) * t) * hz))
    return pts


def roof(
    b,
    part,
    hx,
    hz,
    y_eave,
    y_top,
    kind="irimoya",
    ridge_hx=0.0,
    inner=None,
    gable_from=0.5,
    sori=1.0,
    curve=1.5,
    thick=0.6,
    wall=None,
    soffit=None,
    fascia=None,
    gable=None,
    n_side=10,
    n_up=8,
    center=(0.0, 0.0),
    tile=1.2,
):
    """A Japanese roof over a rectangle (ridge along x) as one smooth surface, with its fascia and soffit.

    kind: "irimoya" (hip below `gable_from`, vertical gables above, ridge ±ridge_hx), "hip" (寄棟, ridge
    ±ridge_hx), "gable" (切妻, ridge ±hx) or "pent" (裳階 / lower roof of a two-storey hall: rises from the
    eave rectangle to `inner` = (hx, hz) at y_top). The slope is concave (y ∝ s^curve: gentle at the eave,
    steep near the ridge) and the corners turn up by `sori` metres (軒反り). `wall` = (hx, hz, y) closes
    the underside from the fascia to the top of the wall (bracket band) with `soffit`.
    """
    cx, cz = center
    rows = []
    for i in range(n_up + 1):
        s = i / n_up
        if kind == "pent":
            ix, iz = inner
            sx, sz = hx + (ix - hx) * s, hz + (iz - hz) * s
        elif kind == "gable":
            sx, sz = hx, max(0.04, hz * (1 - s))
        elif kind == "hip":
            sx, sz = hx + (ridge_hx - hx) * s, max(0.04, hz * (1 - s))
        else:  # irimoya
            g = min(1.0, s / gable_from)
            sx, sz = hx + (ridge_hx - hx) * g, max(0.04, hz * (1 - s))
        y = y_eave + (y_top - y_eave) * s**curve
        ring = []
        for px, pz in rect_ring(sx, sz, n_side):
            ux, uz = abs(px) / sx, abs(pz) / sz
            is_gable_row = kind == "gable" or (kind == "irimoya" and s >= gable_from - 1e-6)
            c = 0.0 if is_gable_row else (ux**4) * (uz**4)  # vertical gables stay planar
            lift = sori * c * (1 - s) ** 2
            flare = 1 + 0.03 * c * (1 - s)
            ring.append((cx + px * flare, y + lift, cz + pz * flare))
        rows.append(ring)

    def uv_of(i, j):
        p = rows[i][j % len(rows[i])]
        return (round((p[0] + p[2]) / tile, 4), round(i / n_up * (y_top - y_eave + max(hz, 1.0)) / tile, 4))

    b.grid(rows, part, uv=uv_of, smooth=True, closed=True)
    eave = rows[0]
    low = [(x, y - thick, z) for x, y, z in eave]
    b.grid([low, eave], fascia or part, smooth=False, closed=True)
    if wall:
        wx, wz, wy = wall
        under = [(cx + px, wy, cz + pz) for px, pz in rect_ring(wx, wz, n_side)]
        b.grid([under, low], soffit or part, smooth=False, closed=True)
    if kind in ("irimoya", "gable") and gable:
        # gable walls (妻) just outside the vertical ends of the surface, and barge boards (破風)
        start = int(math.ceil(gable_from * n_up)) if kind == "irimoya" else 0
        for side in (1, -1):
            pts = []
            for i in range(start, n_up + 1):
                ring = rows[i]
                xs = [p for p in ring if abs(p[0] - cx - side * ring_half_x(ring, cx)) < 1e-3]
                pts += [min(xs, key=lambda p: p[2]), max(xs, key=lambda p: p[2])]
            left = sorted({p for p in pts if p[2] <= cz + 1e-3}, key=lambda p: p[1])
            right = sorted({p for p in pts if p[2] > cz + 1e-3}, key=lambda p: -p[1])
            poly = left + right
            xg = cx + side * (ring_half_x(rows[start], cx) + 0.06)
            poly = [(xg, y, z) for _, y, z in poly]
            if side < 0:
                poly.reverse()
            b.face(poly, gable)
            barge_w = 0.45 + 0.02 * hz
            for k in range(len(left) - 1):
                for edge in (left, right):
                    p0, p1 = Vector(edge[k]), Vector(edge[k + 1])
                    p0.x = p1.x = xg + side * 0.12
                    b.beam(
                        p0 + Vector((0, 0.15, 0)), p1 + Vector((0, 0.15, 0)), 0.28, barge_w, fascia or part, (1, 0, 0)
                    )
    return rows


def ring_half_x(ring, cx):
    return max(abs(p[0] - cx) for p in ring)


def ridge(b, part, half, y, w, h, center=(0.0, 0.0), ends=None, end_h=1.2):
    """Ridge (大棟) along x with ornaments at its ends (鬼瓦 / 鴟尾 as tapered blocks)."""
    cx, cz = center
    b.box((cx, y + h / 2, cz), (2 * half + w, h, w), part)
    if ends:
        for side in (1, -1):
            x = cx + side * (half + w * 0.1)
            top_x = x - side * 0.35 * w
            p = [
                (x - 0.55 * w, y + h * 0.6, cz - 0.4 * w),
                (x + 0.55 * w, y + h * 0.6, cz - 0.4 * w),
                (x + 0.55 * w, y + h * 0.6, cz + 0.4 * w),
                (x - 0.55 * w, y + h * 0.6, cz + 0.4 * w),
                (top_x - 0.3 * w, y + h + end_h, cz - 0.3 * w),
                (top_x + 0.3 * w, y + h + end_h, cz - 0.3 * w),
                (top_x + 0.3 * w, y + h + end_h, cz + 0.3 * w),
                (top_x - 0.3 * w, y + h + end_h, cz + 0.3 * w),
            ]
            for f in L.BOX_FACES:
                b.face([p[i] for i in f], ends)


def posts(b, part, xs, zs, y0, y1, r, perimeter_only=True):
    for x in xs:
        for z in zs:
            is_edge = x in (xs[0], xs[-1]) or z in (zs[0], zs[-1])
            if perimeter_only and not is_edge:
                continue
            b.prism([(x + px, z + pz) for px, pz in regular(8, r)], y0, y1, part, smooth=True)


def band(b, part, hx, hz, y0, y1, cap=None, center=(0.0, 0.0)):
    """A rectangular ring of wall / beams / brackets from y0 to y1."""
    cx, cz = center
    b.prism(L.rect(hx, hz, cx, cz), y0, y1, part, cap_top=cap, cap_bottom=cap)


def railing(b, part, hx, hz, y, h=1.0, n=None, center=(0.0, 0.0)):
    """高欄: top rail, mid rail and posts around a rectangle."""
    cx, cz = center
    corners = [(-hx, hz), (hx, hz), (hx, -hz), (-hx, -hz)]
    for k in range(4):
        (ax, az), (bx, bz) = corners[k], corners[(k + 1) % 4]
        p0, p1 = Vector((cx + ax, 0, cz + az)), Vector((cx + bx, 0, cz + bz))
        for yy, w in ((y + h, 0.16), (y + h * 0.45, 0.1)):
            p0.y = p1.y = yy
            b.beam(p0.copy(), p1.copy(), w, w, part, (0, 1, 0))
        seg = (p1 - p0).length
        m = n or max(2, int(seg / 2.2))
        for i in range(m + 1):
            q = p0.lerp(p1, i / m)
            b.box((q.x, y + h / 2, q.z), (0.18, h, 0.18), part)


def wall_panels(b, part, xs, z, y0, y1, inset=0.15, facing=1, skip=()):
    """Panels between consecutive posts on the line z (facing ±z)."""
    for k in range(len(xs) - 1):
        if k in skip:
            continue
        x0, x1 = xs[k] + 0.3, xs[k + 1] - 0.3
        zz = z - facing * inset
        pts = [(x0, y0, zz), (x1, y0, zz), (x1, y1, zz), (x0, y1, zz)]
        b.face(pts if facing > 0 else list(reversed(pts)), part, L.planar_uvs(pts, 2.0))


def wall_panels_x(b, part, zs, x, y0, y1, inset=0.15, facing=1, skip=()):
    """Panels between posts on the line x (facing ±x)."""
    for k in range(len(zs) - 1):
        if k in skip:
            continue
        z0, z1 = zs[k] + 0.3, zs[k + 1] - 0.3
        xx = x - facing * inset
        pts = [(xx, y0, z1), (xx, y0, z0), (xx, y1, z0), (xx, y1, z1)]
        b.face(pts if facing > 0 else list(reversed(pts)), part, L.planar_uvs(pts, 2.0))


def temple_palette(kind):
    """Day colours from photographs (sRGB medians, knowledge doc) and the faint night glow of the
    precinct's lamps on the walls (no regular floodlighting could be confirmed)."""
    pal = Palette(["nightGlow"])

    def glow(rgb, k=1.0):
        return {"nightGlow": {"emission": (rgb[0] * k, rgb[1] * k, rgb[2] * k, 1.0), "strength": 1.0}}

    if kind == "gate":
        pal.add("ZJ_Vermilion", glow((0.06, 0.016, 0.01)), color=0xB33A2C, roughness=0.65)
        pal.add("ZJ_Bracket", glow((0.07, 0.02, 0.012)), color=0x8E2E24, roughness=0.7)
        pal.add("ZJ_Soffit", glow((0.035, 0.01, 0.007)), color=0x62241C, roughness=0.8)
    else:
        pal.add("ZJ_Vermilion", glow((0.05, 0.02, 0.015)), color=0x5E2C25, roughness=0.6)
        pal.add("ZJ_Bracket", glow((0.04, 0.016, 0.012)), color=0x4E2620, roughness=0.65)
        pal.add("ZJ_Soffit", glow((0.035, 0.014, 0.01)), color=0x5A2C24, roughness=0.7)
    roof_col = 0x74777C if kind == "gate" else 0x64676C  # 2021 titanium tiles read darker
    pal.add("ZJ_Roof", glow((0.012, 0.013, 0.016)), color=roof_col, tex="ta_kawara.jpg", roughness=0.85)
    pal.add("ZJ_RoofEdge", glow((0.01, 0.01, 0.012)), color=0x45484D, roughness=0.5)
    pal.add("ZJ_Plaster", glow((0.07, 0.06, 0.048)), color=0xE6E1D5, roughness=0.85)
    pal.add("ZJ_Opening", glow((0.10, 0.06, 0.025)), color=0x1E1916, roughness=0.9)
    pal.add("ZJ_Lattice", glow((0.06, 0.035, 0.015)), color=0x3A2621, roughness=0.8)
    pal.add("ZJ_Stone", glow((0.04, 0.038, 0.036)), color=0x85827C, roughness=0.9)
    pal.add(
        "ZJ_Gold",
        {"nightGlow": {"emission": (0.35, 0.25, 0.08, 1.0), "strength": 1.0}},
        color=0xC9A24C,
        metallic=0.8,
        roughness=0.35,
    )
    return pal


# ============================================================================================== 三解脱門
# Frame: PLATEAU LOD2 bldg_9cd7634f… read with a = bearing 6.8° (the gate's long axis), origin at the
# lower roof's centre (a0, b0); the model faces east (heading 96.8°, +Z) toward 日比谷通り / 大門.
GATE = Site(139.7499507, 35.6572962, 6.8, -4.2, -3.9, heading=96.8)
GATE_BODY = (21.05, 9.72)  # 五間三戸, posts' centre lines (Columbia JAANUS "sangedatsumon")
GATE_RING = [
    [139.7498282, 35.6573736], [139.7498238, 35.6573429], [139.7499023, 35.6573348], [139.7498725, 35.6571302],
    [139.7499134, 35.6571257], [139.749899, 35.6570257], [139.749993, 35.6570167], [139.7500074, 35.6571158],
    [139.7500637, 35.6571095], [139.7501024, 35.6573799], [139.7500516, 35.6573853], [139.7500693, 35.6575088],
    [139.7499709, 35.6575178], [139.7499532, 35.6573961], [139.7499123, 35.6574006], [139.7499101, 35.6573898],
    [139.7498382, 35.657397], [139.749836, 35.6573817], [139.7499079, 35.6573745], [139.7499067, 35.6573664],
]  # fmt: skip


def bay_lines(total, bays):
    """Post centre lines for bay widths in proportion `bays`, centred on 0."""
    k = total / sum(bays)
    out = [-total / 2]
    for w in bays:
        out.append(out[-1] + w * k)
    return out


# Heights measured on Zojo-ji_sanmon.jpg (KENPEI, CC BY-SA 3.0) with the front posts as the scale
# (21.05 m = 810 px) and the planes in front of / behind them corrected for distance (knowledge doc).
GATE_H = {
    "post": 5.4,  # post tops / head beams
    "bracket": 6.4,  # lower bracket band top
    "eave1": 6.9,  # lower roof fascia top at mid-span
    "balcony": 9.1,
    "wall2": 12.4,  # upper walls' top
    "bracket2": 13.5,
    "eave2": 14.1,  # upper roof fascia top
    "ridge": 20.1,  # top of the roof surface; the ridge cap reaches 21.0 (official height)
}
GATE_BAYS = [3.25, 4.85, 4.85, 4.85, 3.25]  # end bays narrower (photo, 135/193/189/178/115 px)


def build_sangedatsumon():
    pal = temple_palette("gate")
    near = Builder("Sangedatsumon_Near")
    W, D = GATE_BODY
    H = GATE_H
    xs = bay_lines(W, GATE_BAYS)
    zs = [-D / 2 + D * k / 3 for k in range(4)]
    near.box((0, -0.8, 0), (W + 2.4, 2.2, D + 2.4), "ZJ_Stone")  # 基壇 (0.3 m above the ground)
    # ---- lower storey: posts, head beams, the three passages and the closed end bays
    posts(near, "ZJ_Vermilion", xs, zs, 0.3, H["post"], 0.36, perimeter_only=False)
    for z in (zs[0], zs[-1]):
        near.beam(
            (xs[0], H["post"] - 0.4, z), (xs[-1], H["post"] - 0.4, z), 0.4, 0.8, "ZJ_Vermilion", (0, 0, 1), caps=True
        )
    for x in (xs[0], xs[-1]):
        near.beam(
            (x, H["post"] - 0.4, zs[0]), (x, H["post"] - 0.4, zs[-1]), 0.4, 0.8, "ZJ_Vermilion", (1, 0, 0), caps=True
        )
    for z, f in ((zs[-1], 1), (zs[0], -1)):
        wall_panels(near, "ZJ_Vermilion", xs, z, 0.3, H["post"] - 0.8, facing=f, skip=(1, 2, 3))
        wall_panels(near, "ZJ_Opening", xs, z, 0.3, H["post"] - 0.8, inset=2.6, facing=f, skip=(0, 4))  # doors
    for x, f in ((xs[-1], 1), (xs[0], -1)):
        wall_panels_x(near, "ZJ_Vermilion", zs, x, 0.3, H["post"] - 0.8, facing=f)
    near.box((0, H["post"] - 0.1, 0), (W - 0.8, 0.2, D - 0.8), "ZJ_Soffit")  # ceiling of the passages
    band(near, "ZJ_Bracket", W / 2 + 0.7, D / 2 + 0.7, H["post"], H["bracket"], cap="ZJ_Soffit")  # 組物
    # ---- lower roof (下重), balcony, upper storey (same bays, set in by 0.3 m)
    ux, uz = W / 2 - 0.3, D / 2 - 0.3
    roof(
        near,
        "ZJ_Roof",
        15.0,
        8.5,
        H["eave1"],
        H["balcony"],
        kind="pent",
        inner=(ux + 0.6, uz + 0.6),
        sori=0.45,
        curve=1.3,
        thick=0.5,
        wall=(W / 2 + 0.7, D / 2 + 0.7, H["bracket"]),
        soffit="ZJ_Soffit",
        fascia="ZJ_RoofEdge",
        n_up=5,
    )
    near.prism(
        L.rect(ux + 1.2, uz + 1.2),
        H["balcony"],
        H["balcony"] + 0.25,
        "ZJ_Vermilion",
        cap_top="ZJ_Vermilion",
        cap_bottom="ZJ_Soffit",
    )
    railing(near, "ZJ_Vermilion", ux + 1.1, uz + 1.1, H["balcony"] + 0.25, 1.05)
    uxs = bay_lines(2 * ux, GATE_BAYS)
    uzs = [-uz + 2 * uz * k / 3 for k in range(4)]
    y2 = H["balcony"] + 0.25
    posts(near, "ZJ_Vermilion", uxs, uzs, y2, H["bracket2"], 0.3)
    for z, f in ((uzs[-1], 1), (uzs[0], -1)):
        wall_panels(near, "ZJ_Vermilion", uxs, z, y2, H["wall2"], facing=f)
        wall_panels(near, "ZJ_Opening", uxs, z, y2 + 0.2, H["wall2"] - 0.8, inset=0.1, facing=f, skip=(0, 4))  # 桟唐戸
    for x, f in ((uxs[-1], 1), (uxs[0], -1)):
        wall_panels_x(near, "ZJ_Vermilion", uzs, x, y2, H["wall2"], facing=f)
    for z, f in ((uzs[-1], 1), (uzs[0], -1)):  # 花頭窓 in the end bays (cusped windows)
        for k in (0, 4):
            xc = (uxs[k] + uxs[k + 1]) / 2
            zz = z + f * 0.02
            y0 = y2 + 0.5
            pts = [
                (xc - 0.8, y0, zz),
                (xc + 0.8, y0, zz),
                (xc + 0.8, y0 + 1.2, zz),
                (xc + 0.45, y0 + 1.75, zz),
                (xc, y0 + 1.95, zz),
                (xc - 0.45, y0 + 1.75, zz),
                (xc - 0.8, y0 + 1.2, zz),
            ]
            near.face(pts if f > 0 else list(reversed(pts)), "ZJ_Lattice")
    band(near, "ZJ_Vermilion", ux + 0.05, uz + 0.05, H["wall2"], H["wall2"] + 0.5)
    band(near, "ZJ_Bracket", ux + 0.8, uz + 0.8, H["wall2"] + 0.5, H["bracket2"], cap="ZJ_Soffit")
    # ---- upper roof (入母屋): 6 m from the eave to the ridge, ridge ≈ 21 m long (photo)
    roof(
        near,
        "ZJ_Roof",
        14.6,
        8.4,
        H["eave2"],
        H["ridge"],
        kind="irimoya",
        ridge_hx=10.5,
        gable_from=0.5,
        sori=0.6,
        curve=1.5,
        thick=0.6,
        wall=(ux + 0.8, uz + 0.8, H["bracket2"]),
        soffit="ZJ_Soffit",
        fascia="ZJ_RoofEdge",
        gable="ZJ_Vermilion",
    )
    ridge(near, "ZJ_RoofEdge", 10.5, H["ridge"] - 0.15, 0.9, 1.05, ends="ZJ_RoofEdge", end_h=0.8)
    # ---- 山廊 (stair halls) at both ends, from PLATEAU: north a −30…−19, south a 10.8…24.5
    for a_lo, a_hi in ((-30.3, -19.3), (10.9, 24.6)):
        (x0, z0), (x1, z1) = GATE.model(a_lo, -7.5), GATE.model(a_hi, 1.1)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        hx, hz = abs(x1 - x0) / 2, abs(z1 - z0) / 2
        near.prism(L.rect(hx - 0.9, hz - 0.9, cx, cz), 0.0, 3.6, "ZJ_Vermilion", cap_bottom="ZJ_Stone")
        near.prism(L.rect(hx - 1.2, hz - 1.2, cx, cz), 2.2, 3.5, "ZJ_Plaster")
        roof(
            near,
            "ZJ_Roof",
            hx,
            hz,
            3.9,
            6.6,
            kind="gable",
            sori=0.0,
            curve=1.2,
            thick=0.35,
            wall=(hx - 0.9, hz - 0.9, 3.6),
            soffit="ZJ_Soffit",
            fascia="ZJ_RoofEdge",
            gable="ZJ_Vermilion",
            center=(cx, cz),
            n_side=4,
            n_up=4,
        )
        ridge(near, "ZJ_RoofEdge", hx, 6.5, 0.45, 0.5, center=(cx, cz))

    root = bpy.data.objects.new("Sangedatsumon", None)
    L.SCENE.collection.objects.link(root)
    near_ob = near.finish(pal, root)

    pal.add("ZJ_Far", {"nightGlow": {"emission": (0.07, 0.02, 0.012, 1.0), "strength": 1.0}}, color=0xA8382B)
    pal.add("ZJ_FarRoof", color=0x55585D, roughness=0.9)
    far = Builder("Sangedatsumon_Far")
    far.prism(L.rect(W / 2, D / 2), -1.0, H["bracket2"], "ZJ_Far")
    roof(
        far,
        "ZJ_FarRoof",
        15.0,
        8.5,
        H["eave1"],
        H["balcony"],
        kind="pent",
        inner=(ux, uz),
        sori=0.4,
        n_side=2,
        n_up=1,
        thick=0.5,
    )
    roof(
        far, "ZJ_FarRoof", 14.6, 8.4, H["eave2"], 20.9, kind="hip", ridge_hx=10.5, sori=0.5, n_side=2, n_up=3, thick=0.6
    )
    for a_lo, a_hi in ((-30.3, -19.3), (10.9, 24.6)):
        (x0, z0), (x1, z1) = GATE.model(a_lo, -7.5), GATE.model(a_hi, 1.1)
        cx, cz, hx, hz = (x0 + x1) / 2, (z0 + z1) / 2, abs(x1 - x0) / 2, abs(z1 - z0) / 2
        far.prism(L.rect(hx - 0.9, hz - 0.9, cx, cz), -1.0, 3.9, "ZJ_Far")
        roof(far, "ZJ_FarRoof", hx, hz, 3.9, 6.6, kind="gable", sori=0.0, n_side=1, n_up=1, thick=0.3, center=(cx, cz))
    far_ob = far.finish(pal, root)
    meta = entry(
        "zojoji_sangedatsumon",
        "増上寺 三解脱門",
        GATE,
        base=3.3,
        height=21.0,
        far_distance=700,
        rings=[GATE_RING],
        plateau=[{"gmlId": "bldg_9cd7634f-6649-40a6-855c-07e5e53d7cc5", "hide": True}],
        modes=[{"id": "nightGlow", "name": "境内灯の照り返し（定時のライトアップは確認できず）"}],
        schedule={
            "source": "仮定（定時のライトアップの一次情報なし）",
            "on": "sunset",
            "off": "24:00",
            "after": "nightGlow",
        },
        note="2025-01〜2032-11（予定）は保存修理工事の覆いの中。模型は工事前の姿",
    )
    return root, near_ob, far_ob, pal, meta


# ============================================================================================== 大殿
# Frame: PLATEAU LOD2 bldg_e1565e4f… (the whole hall complex is one building) with a = bearing 96.9°
# (east, toward the gate), origin at the centre of the 大殿's lower roof (a0, b0). y = 0 is the yard in
# front of the hall (T.P. 7.3, DEM5A); the halls to the south stand on lower ground (T.P. ≈ 4.2).
DAIDEN = Site(139.7482301, 35.6570045, 96.9, -0.5, 46.8)
DAIDEN_RING = [
    [139.7480897, 35.6569013], [139.7480874, 35.6568824], [139.748041, 35.6568833], [139.7479691, 35.6569112],
    [139.747978, 35.657032], [139.7479028, 35.6570383], [139.7479083, 35.6570689], [139.7478177, 35.6570789],
    [139.7478144, 35.6570563], [139.7476507, 35.6570726], [139.7476574, 35.6571095], [139.7477779, 35.657096],
    [139.7477967, 35.6572141], [139.7475921, 35.6572366], [139.7475888, 35.6572195], [139.7475722, 35.6572213],
    [139.7475568, 35.6571293], [139.7475756, 35.6571266], [139.7475745, 35.6571176], [139.747612, 35.6571131],
    [139.7476065, 35.6570771], [139.7475557, 35.6570825], [139.747528, 35.6569175], [139.7476806, 35.6569013],
    [139.7477038, 35.6570401], [139.7477337, 35.6570374], [139.7477138, 35.6569004], [139.7479636, 35.656868],
    [139.7479658, 35.6568833], [139.7480366, 35.6568517], [139.748093, 35.6568463], [139.7480808, 35.6567643],
    [139.7481737, 35.6567553], [139.7481494, 35.6565976], [139.7483583, 35.6565768], [139.7483848, 35.6567499],
    [139.7484711, 35.6567409], [139.7484457, 35.6565678], [139.7486635, 35.6565453], [139.7486889, 35.6567183],
    [139.748763, 35.6567111], [139.7487364, 35.6565372], [139.7489586, 35.6565146], [139.7489929, 35.6567418],
    [139.7490294, 35.6567382], [139.7490394, 35.6568058], [139.7487851, 35.656831], [139.7487928, 35.656886],
    [139.7487143, 35.6568941], [139.7487066, 35.6568391], [139.7484191, 35.6568607], [139.7484202, 35.6568671],
    [139.7484003, 35.6568698], [139.7484047, 35.6569067], [139.748439, 35.656904], [139.7484445, 35.6569401],
    [139.7484866, 35.6569356], [139.748502, 35.6570446], [139.7484578, 35.6570491], [139.7484644, 35.6570906],
    [139.7484258, 35.6570942], [139.7484357, 35.657178], [139.7484932, 35.6571717], [139.7484943, 35.6571807],
    [139.7485429, 35.6571771], [139.7486071, 35.6575557], [139.7485938, 35.6575566], [139.7486015, 35.6576124],
    [139.7485584, 35.657616], [139.7485595, 35.6576296], [139.7480797, 35.6576773], [139.7480786, 35.6576647],
    [139.7480366, 35.6576692], [139.7480288, 35.657616], [139.7480145, 35.6576169], [139.7479669, 35.6572925],
    [139.7479769, 35.6572916], [139.7479691, 35.6572366], [139.7480134, 35.6572321], [139.7480123, 35.6572195],
    [139.7483672, 35.6571843], [139.7483561, 35.6571014], [139.7482234, 35.6571149], [139.7482256, 35.6571311],
    [139.748156, 35.6571374], [139.7481505, 35.6571014], [139.7481261, 35.6571032], [139.7481051, 35.6569464],
    [139.7481505, 35.6569428], [139.7481482, 35.6569301], [139.7483119, 35.6569157], [139.7483063, 35.6568797],
]  # fmt: skip
DAIDEN_YARD = 7.3  # T.P.
# The other halls of the complex as (a0, a1, b0, b1, eave T.P., ridge T.P. or None = flat, ridge along b?)
DAIDEN_ANNEX = [
    (-62.0, -46.0, 6.0, 18.0, 14.7, 17.7),
    (-62.0, -48.0, -17.0, 1.0, 16.7, None),
    (-44.0, -28.0, -17.0, 3.0, 14.7, None),
    (-10.0, 23.0, -8.0, 12.0, 17.4, 23.4),
    (-10.0, 17.0, -44.0, -14.0, 17.4, 21.0),
    (26.0, 46.0, -44.0, -15.0, 17.4, 21.0),
    (52.0, 72.0, -44.0, -15.0, 17.4, 21.0),
    (17.0, 26.0, -26.0, -15.0, 14.7, None),
    (46.0, 52.0, -26.0, -15.0, 14.7, None),
    (-28.0, -10.0, -20.0, -13.0, 14.0, None),
    (10.0, 16.0, 12.0, 21.0, 13.9, None),
]


# Heights above the yard (y = 0, T.P. 7.3): the ridge from PLATEAU LOD2 (T.P. 42.6), the eaves from LOD2's
# roof edges and Zojo-ji_Hondo_3.jpg (Zairon, CC BY-SA 4.0) with people on the stair as the scale.
DAIDEN_H = {
    "podium": 3.2,  # 基壇 / veranda floor (≈ 16 steps)
    "frieze": 7.9,  # top of the lattice doors, white 小壁 above
    "post": 10.0,
    "bracket": 11.9,
    "eave1": 12.6,  # lower roof (裳階) fascia top
    "balcony": 15.6,
    "wall2": 20.4,
    "bracket2": 22.0,
    "eave2": 22.6,  # upper roof fascia top
    "ridge": 34.0,  # roof surface; ridge cap to 35.3 (PLATEAU's top), gold 鴟尾 above
}


def build_daiden():
    pal = temple_palette("hall")
    near = Builder("Daiden_Near")
    H = DAIDEN_H
    # ---- 基壇 and the front stair (east, +Z)
    near.prism(L.rect(24.0, 22.5), -4.5, H["podium"], "ZJ_Stone", cap_top="ZJ_Stone")
    for k in range(8):
        y = H["podium"] - (k + 1) * 0.4
        near.box((0, y / 2 - 1.0, 22.5 + 0.45 * (k + 0.5)), (24.0, y + 2.0, 0.45), "ZJ_Stone")
    railing(near, "ZJ_Vermilion", 23.6, 22.1, H["podium"], 1.0)
    # ---- ground storey: dark posts, lattice doors below a white frieze (小壁)
    bx, bz = 20.0, 20.5
    xs = [-bx + 2 * bx * k / 9 for k in range(10)]
    zs = [-bz + 2 * bz * k / 9 for k in range(10)]
    y0 = H["podium"]
    posts(near, "ZJ_Vermilion", xs, zs, y0, H["bracket"], 0.42)
    for z, f in ((bz, 1), (-bz, -1)):
        wall_panels(near, "ZJ_Lattice", xs, z, y0, H["frieze"], facing=f)
        wall_panels(near, "ZJ_Plaster", xs, z, H["frieze"], H["post"] - 0.5, facing=f)
    for x, f in ((bx, 1), (-bx, -1)):
        wall_panels_x(near, "ZJ_Lattice", zs, x, y0, H["frieze"], facing=f)
        wall_panels_x(near, "ZJ_Plaster", zs, x, H["frieze"], H["post"] - 0.5, facing=f)
    band(near, "ZJ_Vermilion", bx + 0.05, bz + 0.05, H["post"] - 0.5, H["post"])
    band(near, "ZJ_Bracket", bx + 0.8, bz + 0.8, H["post"], H["bracket"], cap="ZJ_Soffit")
    # ---- lower roof (裳階) up to the upper storey
    ux, uz = 15.5, 16.0
    roof(
        near,
        "ZJ_Roof",
        25.5,
        27.0,
        H["eave1"],
        H["balcony"],
        kind="pent",
        inner=(ux + 0.6, uz + 0.6),
        sori=1.0,
        curve=1.25,
        thick=0.7,
        wall=(bx + 0.8, bz + 0.8, H["bracket"]),
        soffit="ZJ_Soffit",
        fascia="ZJ_RoofEdge",
        n_up=5,
        n_side=12,
    )
    y2 = H["balcony"] + 0.4
    near.prism(
        L.rect(ux + 1.6, uz + 1.6), H["balcony"], y2, "ZJ_Vermilion", cap_top="ZJ_Vermilion", cap_bottom="ZJ_Soffit"
    )
    railing(near, "ZJ_Vermilion", ux + 1.5, uz + 1.5, y2, 1.0)
    uxs = [-ux + 2 * ux * k / 7 for k in range(8)]
    uzs = [-uz + 2 * uz * k / 7 for k in range(8)]
    posts(near, "ZJ_Vermilion", uxs, uzs, y2, H["bracket2"], 0.36)
    for z, f in ((uz, 1), (-uz, -1)):
        wall_panels(near, "ZJ_Lattice", uxs, z, y2, H["wall2"] - 1.8, facing=f)
        wall_panels(near, "ZJ_Plaster", uxs, z, H["wall2"] - 1.8, H["wall2"], facing=f)
    for x, f in ((ux, 1), (-ux, -1)):
        wall_panels_x(near, "ZJ_Lattice", uzs, x, y2, H["wall2"] - 1.8, facing=f)
        wall_panels_x(near, "ZJ_Plaster", uzs, x, H["wall2"] - 1.8, H["wall2"], facing=f)
    band(near, "ZJ_Vermilion", ux + 0.05, uz + 0.05, H["wall2"], H["wall2"] + 0.4)
    band(near, "ZJ_Bracket", ux + 0.9, uz + 0.9, H["wall2"] + 0.4, H["bracket2"], cap="ZJ_Soffit")
    # ---- upper roof (入母屋, titanium tiles since 2021) with gold 鴟尾
    roof(
        near,
        "ZJ_Roof",
        23.0,
        18.8,
        H["eave2"],
        H["ridge"],
        kind="irimoya",
        ridge_hx=15.0,
        gable_from=0.52,
        sori=1.4,
        curve=1.3,
        thick=1.0,
        wall=(ux + 0.9, uz + 0.9, H["bracket2"]),
        soffit="ZJ_Soffit",
        fascia="ZJ_RoofEdge",
        gable="ZJ_Plaster",
        n_side=12,
        n_up=9,
    )
    ridge(near, "ZJ_RoofEdge", 15.0, H["ridge"] - 0.2, 1.4, 1.5, ends="ZJ_Gold", end_h=2.6)
    # ---- the other halls of the complex
    annex(near, DAIDEN, DAIDEN_ANNEX)

    root = bpy.data.objects.new("Daiden", None)
    L.SCENE.collection.objects.link(root)
    near_ob = near.finish(pal, root)

    pal.add("ZJ_Far", {"nightGlow": {"emission": (0.05, 0.03, 0.022, 1.0), "strength": 1.0}}, color=0x6B4A42)
    pal.add("ZJ_FarRoof", color=0x505357, roughness=0.9)
    far = Builder("Daiden_Far")
    far.prism(L.rect(21.0, 21.5), -4.5, H["bracket"], "ZJ_Far")
    far.prism(L.rect(ux, uz), H["bracket"], H["bracket2"], "ZJ_Far")
    roof(
        far,
        "ZJ_FarRoof",
        25.5,
        27.0,
        H["eave1"],
        H["balcony"],
        kind="pent",
        inner=(ux, uz),
        sori=0.9,
        n_side=2,
        n_up=1,
        thick=0.6,
    )
    roof(
        far,
        "ZJ_FarRoof",
        23.0,
        19.5,
        H["eave2"],
        35.3,
        kind="hip",
        ridge_hx=15.0,
        sori=1.2,
        n_side=2,
        n_up=3,
        thick=0.7,
    )
    annex(far, DAIDEN, DAIDEN_ANNEX, far=True)
    far_ob = far.finish(pal, root)
    meta = entry(
        "zojoji_daiden",
        "増上寺 大殿",
        DAIDEN,
        base=DAIDEN_YARD,
        height=37.0,
        far_distance=900,
        rings=[DAIDEN_RING],
        plateau=[{"gmlId": "bldg_e1565e4f-fbc8-48d5-80b3-a0cc4dbe9602", "hide": True}],
        modes=[{"id": "nightGlow", "name": "境内灯の照り返し（定時のライトアップは確認できず）"}],
        schedule={
            "source": "仮定（定時のライトアップの一次情報なし）",
            "on": "sunset",
            "off": "24:00",
            "after": "nightGlow",
        },
        note="PLATEAU では大殿と南の堂・会館が 1 棟（LOD1 は高さ 35.3 m の箱）なので、まとめて置き換える",
    )
    return root, near_ob, far_ob, pal, meta


def annex(b, site, blocks, far=False):
    """Halls around the 大殿: plaster walls under a hipped tiled roof, or flat-roofed blocks."""
    wall = "ZJ_Far" if far else "ZJ_Plaster"
    rf = "ZJ_FarRoof" if far else "ZJ_Roof"
    for a0, a1, b0, b1, eave_tp, ridge_tp in blocks:
        out = site.rect(a0, a1, b0, b1)
        y_eave = eave_tp - DAIDEN_YARD
        if ridge_tp is None:
            b.prism(out, -4.5, y_eave, wall, cap_top=rf if far else "ZJ_Stone")
            continue
        b.prism(out, -4.5, y_eave - 0.8, wall, cap_top=None)
        if not far:
            b.prism(offset(out, 0.25), y_eave - 2.2, y_eave - 0.8, "ZJ_Bracket")
        xs_ = [p[0] for p in out]
        zs_ = [p[1] for p in out]
        cx, cz = (min(xs_) + max(xs_)) / 2, (min(zs_) + max(zs_)) / 2
        hx, hz = (max(xs_) - min(xs_)) / 2, (max(zs_) - min(zs_)) / 2
        along_x = hx >= hz
        if not along_x:  # the roof helper puts its ridge along x: swap through a mirrored copy
            hx, hz = hz, hx
        ridge_half = max(0.5, hx - hz)
        b._placed = len(b.bm.verts)  # the roof is built about the origin, then moved into place
        roof(
            b,
            rf,
            hx + 1.6,
            hz + 1.6,
            y_eave - 0.4,
            ridge_tp - DAIDEN_YARD,
            kind="hip",
            ridge_hx=ridge_half,
            sori=0.0 if far else 0.6,
            curve=1.3,
            thick=0.4,
            wall=None if far else (hx, hz, y_eave - 0.8),
            soffit="ZJ_Soffit",
            fascia=None if far else "ZJ_RoofEdge",
            n_side=2 if far else 6,
            n_up=2 if far else 5,
            center=(0.0, 0.0),
        )
        place_last(b, cx, cz, not along_x)
        if not far:
            ridge(b, "ZJ_RoofEdge", ridge_half, ridge_tp - DAIDEN_YARD - 0.1, 0.6, 0.6)
            place_last(b, cx, cz, not along_x)


def place_last(b, cx, cz, rotate):
    """Translate (and turn 90° about Y) every vertex created since the previous call."""
    start = getattr(b, "_placed", 0)
    for v in list(b.bm.verts)[start:]:
        x, y, z = v.co
        if rotate:
            x, z = -z, x
        v.co = (x + cx, y, z + cz)
    b._placed = len(b.bm.verts)


# ============================================================================================== hotels / office
def facade_palette(prefix, tex, modes, emit=1.3, glass_metal=0.1, extra_night=0.0):
    """Facade (day map + one emissive night map per mode) for the window grids of scripts/textures/
    tower_area_textures.py; `modes` = [(mode, night texture)]."""
    pal = Palette([m for m, _ in modes])
    lights = {m: {"emission": (1.0, 1.0, 1.0, 1.0), "strength": emit, "emit_tex": t} for m, t in modes}
    pal.add(f"{prefix}_Facade", lights, color=0xFFFFFF, tex=tex, roughness=0.35, metallic=glass_metal)
    return pal


def lit(pal, rgb, k=1.0):
    return {m: {"emission": (rgb[0] * k, rgb[1] * k, rgb[2] * k, 1.0), "strength": 1.0} for m in pal.modes}


# Hotel tower south of Tokyo Tower (2005, 33 floors, 104.4 m): frame = PLATEAU bldg_1867a421… with a = bearing 98.0°.
HOTEL_S = Site(139.7470892, 35.6554757, 98.0, 0.5, -6.0)
HOTEL_S_PLAN = [
    (25.5, 2.5),
    (18.6, 16.5),
    (-17.8, 16.5),
    (-25.0, 2.5),
    (-11.4, -24.4),
    (-6.8, -28.3),
    (7.9, -28.3),
    (12.7, -23.9),
]
HOTEL_S_RING = [
    [139.7470396, 35.6556458], [139.7470341, 35.6556593], [139.7470164, 35.6556611], [139.7469887, 35.655653],
    [139.7469854, 35.6556323], [139.7469191, 35.6556395], [139.7468207, 35.6555349], [139.7468439, 35.6554872],
    [139.746824, 35.6554808], [139.7469268, 35.6552726], [139.7468306, 35.6552402], [139.7468395, 35.6552195],
    [139.7472607, 35.6551726], [139.747274, 35.6551897], [139.747191, 35.6552465], [139.7473547, 35.6554214],
    [139.7473414, 35.6554313], [139.747379, 35.6554709], [139.7473171, 35.6555953], [139.7472596, 35.6556016],
    [139.7472629, 35.6556178], [139.7472474, 35.6556196], [139.7472441, 35.6556323], [139.7472264, 35.6556377],
    [139.7471977, 35.6556269], [139.7471844, 35.6556431], [139.7471579, 35.6556323], [139.7471214, 35.6556503],
    [139.7471037, 35.6556386], [139.7470727, 35.6556557], [139.7470528, 35.655644],
]  # fmt: skip


def build_hotel_south():
    modes = [("evening", "ta_hotel_south_evening.jpg"), ("lateNight", "ta_hotel_south_late.jpg")]
    pal = facade_palette("HS", "ta_hotel_south_day.jpg", modes, emit=0.65, glass_metal=0.15)
    pal.add("HS_White", lit(pal, (0.05, 0.05, 0.05)), color=0xE4E8EA, roughness=0.45, metallic=0.2)
    pal.add("HS_Roof", color=0x8D9196, roughness=0.8)
    pal.add("HS_Lobby", lit(pal, (0.55, 0.42, 0.26)), color=0x39414A, roughness=0.2, metallic=0.3)
    pal.add("HS_Podium", lit(pal, (0.04, 0.04, 0.035)), color=0xC9CBC8, roughness=0.7)
    pal.add("HS_Green", color=0x5F8A5A, roughness=0.9)
    pal.add("HS_Lamp", {m: {"emission": (1.0, 0.03, 0.02, 1.0), "strength": 20.0} for m in pal.modes}, color=0x601010)
    near = Builder("ShibaParkHotelSouth_Near")
    out = HOTEL_S.outline(HOTEL_S_PLAN)
    top = 101.6
    near.prism(out, -6.0, 6.0, "HS_Lobby")
    near.prism(out, 6.0, top, "HS_Facade", uv_side=(28.8, 6.0, 25.2), cap_top="HS_Roof")
    for y in (6.0, 12.3):  # the double-height lobby's slab edges
        near.prism(offset(out, 0.25), y - 0.25, y + 0.25, "HS_White", cap_bottom="HS_White")
    near.prism(offset(out, 0.15), top, 104.2, "HS_White", cap_bottom=None)  # parapet / crown frame
    near.prism(list(reversed(offset(out, -0.5))), top, 104.2, "HS_White")  # its inner face
    near.prism(offset(out, -0.5), 104.0, 104.2, "HS_White", cap_top=None)
    near.prism(HOTEL_S.rect(-14.5, 15.7, -19.0, 7.4), top, 108.5, "HS_White", cap_top="HS_Roof")  # machine room
    near.prism([(x, z) for x, z in regular(24, 6.0)], top, top + 0.15, "HS_Green", cap_top="HS_Green")  # rooftop circle
    for x, z in HOTEL_S.outline([(25.5, 2.5), (-25.0, 2.5), (-6.8, -28.3), (7.9, -28.3), (18.6, 16.5), (-17.8, 16.5)]):
        near.box((x * 0.97, 104.6, z * 0.97), (0.6, 0.6, 0.6), "HS_Lamp")  # 航空障害灯
    # podium and the entrance canopy to the south
    near.prism(HOTEL_S.rect(-19.5, 21.0, -33.0, -24.0), -3.0, 5.5, "HS_Podium", cap_top="HS_Roof")
    near.prism(HOTEL_S.rect(-13.0, 14.0, -36.5, -30.0), 5.0, 5.6, "HS_White", cap_top="HS_White", cap_bottom="HS_White")

    root = bpy.data.objects.new("ShibaParkHotelSouth", None)
    L.SCENE.collection.objects.link(root)
    near_ob = near.finish(pal, root)
    pal.add("HS_Far", lit(pal, (0.10, 0.085, 0.06)), color=0x9AAEBD, roughness=0.6)
    far = Builder("ShibaParkHotelSouth_Far")
    far.prism(out, -6.0, 104.2, "HS_Far", cap_top="HS_Far")
    far.prism(HOTEL_S.rect(-14.5, 15.7, -19.0, 7.4), 104.2, 108.5, "HS_Far", cap_top="HS_Far")
    far_ob = far.finish(pal, root)
    meta = entry(
        "shiba_park_hotel_south",
        "芝公園の高層ホテル（タワーの南）",
        HOTEL_S,
        base=10.9,  # DEM5A all round the tower (PLATEAU's lowest point, T.P. 5.5, is a sunken court)
        height=108.5,
        far_distance=1500,
        rings=[HOTEL_S_RING],
        buffer=0.9,  # its ring has 1–2 m teeth whose walls a 0.5 m margin misses
        plateau=[{"gmlId": "bldg_1867a421-1d3e-4dfb-beb7-b918e3492ed8", "hide": True}],
        modes=[{"id": "evening", "name": "客室の明かり（宵）"}, {"id": "lateNight", "name": "客室の明かり（深夜）"}],
        schedule=late_schedule("仮定（客室の点灯割合）", "24:00", "lateNight"),
    )
    return root, near_ob, far_ob, pal, meta


# 1964 hotel: two offset slabs (11 floors, 38 m) on a podium, the core and its blank crown box, the
# banquet wing. Frame = PLATEAU bldg_67ae778f… / bldg_623f21fd… with a = bearing 10.6° (the slabs).
HOTEL_E = Site(139.7479865, 35.6589812, 10.6, 10.0, -5.0)
HOTEL_E_RINGS = [
    [
        [139.7479756, 35.6596494], [139.7479457, 35.6594646], [139.7477533, 35.6594854], [139.7476417, 35.6587904],
        [139.7480165, 35.6587499], [139.7480131, 35.6587283], [139.7480408, 35.6587256], [139.7479955, 35.658475],
        [139.7481005, 35.6584642], [139.7480972, 35.658484], [139.7482133, 35.6584714], [139.7482542, 35.6587228],
        [139.7484488, 35.6587021], [139.7484631, 35.658795], [139.7485516, 35.658785], [139.7486157, 35.6591861],
        [139.7485261, 35.6591951], [139.7485582, 35.6593979], [139.7481812, 35.6594385], [139.7482099, 35.6596233],
        [139.7481027, 35.6596548], [139.7479977, 35.6596656],
    ],
    [
        [139.747312, 35.6586751], [139.7472976, 35.6585868], [139.7473473, 35.6585813], [139.7473307, 35.6584723],
        [139.7475165, 35.6584525], [139.7475099, 35.6584074], [139.7477907, 35.6583785], [139.7477852, 35.6583434],
        [139.7479377, 35.6583272], [139.7480041, 35.6587472], [139.747637, 35.6587859], [139.7476458, 35.6588391],
        [139.747344, 35.6588707], [139.747333, 35.6588067], [139.7473108, 35.6588085], [139.7472943, 35.6586985],
        [139.7473274, 35.6586886], [139.7473263, 35.6586742],
    ],
]  # fmt: skip


def build_hotel_east():
    modes = [("evening", "ta_hotel_east_evening.jpg"), ("lateNight", "ta_hotel_east_late.jpg")]
    pal = facade_palette("HE", "ta_hotel_east_day.jpg", modes, emit=0.65, glass_metal=0.0)
    pal.add("HE_Cornice", lit(pal, (0.05, 0.048, 0.042)), color=0xE2DCCD, roughness=0.6)
    pal.add("HE_Panel", lit(pal, (0.045, 0.045, 0.042)), color=0xCAC7BF, roughness=0.6)
    pal.add("HE_Crown", lit(pal, (0.10, 0.10, 0.09)), color=0xE8E4D8, roughness=0.5)
    pal.add("HE_Glass", lit(pal, (0.6, 0.45, 0.28)), color=0x2F3840, roughness=0.15, metallic=0.3)
    pal.add("HE_Stone", color=0x4D4A47, roughness=0.8)
    pal.add("HE_Roof", color=0x8A8C8E, roughness=0.85)
    near = Builder("ShibaParkHotelEast_Near")
    for a0, a1, b0, b1 in ((-54.0, 28.0, -30.0, -11.5), (2.0, 73.0, -6.0, 11.0)):
        out = HOTEL_E.rect(a0, a1, b0, b1)
        near.prism(out, 9.0, 37.4, "HE_Facade", uv_side=(16.0, 9.0, 26.4))
        near.prism(offset(out, 0.7), 37.4, 38.6, "HE_Cornice", cap_top="HE_Roof", cap_bottom="HE_Cornice")
        near.prism(offset(out, -2.0), 38.6, 40.2, "HE_Panel", cap_top="HE_Roof")  # rooftop rooms
    core = HOTEL_E.rect(2.0, 23.0, -18.0, 2.5)
    near.prism(core, 9.0, 47.0, "HE_Panel", cap_top="HE_Roof")
    near.prism(HOTEL_E.rect(4.0, 21.0, -16.0, 0.5), 47.0, 50.6, "HE_Crown", cap_top="HE_Roof")  # blank sign box
    # podium: dark stone plinth, a glazed band, a light fascia
    pod = HOTEL_E.rect(-27.0, 55.0, -45.0, 29.0)
    near.prism(pod, -3.0, 1.2, "HE_Stone")
    near.prism(offset(pod, -0.6), 1.2, 5.0, "HE_Glass")
    near.prism(offset(pod, 0.4), 5.0, 9.0, "HE_Cornice", cap_top="HE_Roof", cap_bottom="HE_Cornice")
    hall = HOTEL_E.rect(-72.0, -27.0, -9.0, 52.0)
    near.prism(hall, -3.0, 2.0, "HE_Stone")
    near.prism(offset(hall, -0.5), 2.0, 5.5, "HE_Glass")
    near.prism(hall, 5.5, 10.0, "HE_Panel", cap_top="HE_Roof")
    near.prism(HOTEL_E.rect(-65.0, -27.0, -4.0, 48.0), 10.0, 16.5, "HE_Panel", cap_top="HE_Roof")

    root = bpy.data.objects.new("ShibaParkHotelEast", None)
    L.SCENE.collection.objects.link(root)
    near_ob = near.finish(pal, root)
    pal.add("HE_Far", lit(pal, (0.09, 0.075, 0.05)), color=0xB5AFA3, roughness=0.8)
    far = Builder("ShibaParkHotelEast_Far")
    for a0, a1, b0, b1 in ((-54.0, 28.0, -30.0, -11.5), (2.0, 73.0, -6.0, 11.0)):
        far.prism(HOTEL_E.rect(a0, a1, b0, b1), 9.0, 38.6, "HE_Far", cap_top="HE_Far")
    far.prism(core, 9.0, 50.6, "HE_Far", cap_top="HE_Far")
    far.prism(pod, -3.0, 9.0, "HE_Far", cap_top="HE_Far")
    far.prism(hall, -3.0, 16.5, "HE_Far", cap_top="HE_Far")
    far_ob = far.finish(pal, root)
    meta = entry(
        "shiba_park_hotel_east",
        "芝公園のホテル（タワーの東）",
        HOTEL_E,
        base=7.6,
        height=50.6,
        far_distance=1000,
        rings=HOTEL_E_RINGS,
        plateau=[
            {"gmlId": "bldg_67ae778f-7ec4-4b56-bbf0-9371b59a47a5", "hide": True},
            {"gmlId": "bldg_623f21fd-e17c-4e11-9c7e-90ee1e82c3ce", "hide": True},
        ],
        modes=[{"id": "evening", "name": "客室の明かり（宵）"}, {"id": "lateNight", "name": "客室の明かり（深夜）"}],
        schedule=late_schedule("仮定（客室の点灯割合）", "24:00", "lateNight"),
    )
    return root, near_ob, far_ob, pal, meta


# Office hall north of the tower (1966; 6 floors, 3-storey penthouse, 鉄骨鉄筋コンクリート): frame = PLATEAU
# bldg_002f53bc… with a = bearing 22.0°. Ribbon windows between beige precast spandrels.
HALL_N = Site(139.7453832, 35.6597267, 22.0, 0.0, 3.0)
HALL_N_PLAN = [
    (-36.9, -20.5),
    (39.0, -20.5),
    (39.0, 1.8),
    (22.5, 1.8),
    (22.5, 10.0),
    (9.5, 10.0),
    (9.5, 27.6),
    (-36.7, 27.7),
]
HALL_N_RING = [
    [139.7453748, 35.6598756], [139.7453549, 35.6598828], [139.7453306, 35.6598342], [139.7451393, 35.6598991],
    [139.7449469, 35.6595133], [139.7454401, 35.6593493], [139.7457552, 35.6599838], [139.7455263, 35.6600577],
    [139.7454577, 35.6599207], [139.7454412, 35.6599252], [139.7454036, 35.6598747],
]  # fmt: skip


def build_hall_north():
    modes = [("evening", "ta_hall_north_evening.jpg"), ("afterHours", "ta_hall_north_late.jpg")]
    pal = facade_palette("NH", "ta_hall_north_day.jpg", modes, emit=0.9, glass_metal=0.05)
    pal.add("NH_Concrete", lit(pal, (0.04, 0.038, 0.032)), color=0xC9C0A8, roughness=0.85)
    pal.add("NH_Pilotis", lit(pal, (0.45, 0.42, 0.36)), color=0x3C3E40, roughness=0.3, metallic=0.2)
    pal.add("NH_Roof", color=0x86888A, roughness=0.9)
    pal.add("NH_Mast", color=0xB8BCC0, metallic=0.6, roughness=0.4)
    pal.add("NH_Lamp", {m: {"emission": (1.0, 0.03, 0.02, 1.0), "strength": 12.0} for m in pal.modes}, color=0x601010)
    near = Builder("TowerNorthHall_Near")
    out = HALL_N.outline(HALL_N_PLAN)
    near.prism(offset(out, -1.6), -4.0, 4.0, "NH_Pilotis")  # the recessed ground floor
    near.prism(out, 4.0, 24.0, "NH_Facade", uv_side=(28.8, 4.0, 16.0), cap_bottom="NH_Concrete")
    near.prism(offset(out, 0.15), 24.0, 24.9, "NH_Concrete", cap_top="NH_Roof", cap_bottom="NH_Concrete")
    for a, b_ in ((-36.9, -20.5), (39.0, -20.5), (-36.7, 27.7), (9.5, 27.6), (39.0, 1.8)):  # corner piers
        x, z = HALL_N.model(a, b_)
        near.box((x, 0.0, z), (1.6, 8.0, 1.6), "NH_Concrete")
    tower = HALL_N.rect(-15.5, 9.0, -2.5, 9.5)
    near.prism(tower, 24.9, 34.6, "NH_Facade", uv_side=(28.8, 4.0, 16.0))
    near.prism(offset(tower, 0.15), 34.6, 35.4, "NH_Concrete", cap_top="NH_Roof", cap_bottom="NH_Concrete")
    near.prism(HALL_N.rect(9.5, 22.5, 1.8, 10.0), 24.9, 27.4, "NH_Concrete", cap_top="NH_Roof")
    mx, mz = HALL_N.model(5.0, -1.0)
    near.prism([(mx + x, mz + z) for x, z in regular(4, 0.9)], 35.4, 46.0, "NH_Mast", cap_top="NH_Mast")
    near.box((mx, 46.3, mz), (0.5, 0.5, 0.5), "NH_Lamp")

    root = bpy.data.objects.new("TowerNorthHall", None)
    L.SCENE.collection.objects.link(root)
    near_ob = near.finish(pal, root)
    pal.add("NH_Far", lit(pal, (0.07, 0.065, 0.055)), color=0x9F9886, roughness=0.9)
    far = Builder("TowerNorthHall_Far")
    far.prism(out, -4.0, 24.9, "NH_Far", cap_top="NH_Far")
    far.prism(tower, 24.9, 35.4, "NH_Far", cap_top="NH_Far")
    far_ob = far.finish(pal, root)
    meta = entry(
        "tower_north_hall",
        "東京タワー北の会館",
        HALL_N,
        base=21.1,
        height=46.0,
        far_distance=800,
        rings=[HALL_N_RING],
        plateau=[{"gmlId": "bldg_002f53bc-e692-49e3-84b4-3b416d3d23b8", "hide": True}],
        modes=[{"id": "evening", "name": "執務室の明かり"}, {"id": "afterHours", "name": "残業の明かり"}],
        schedule=late_schedule("仮定（事務所の点灯割合）", "21:00", "afterHours"),
    )
    return root, near_ob, far_ob, pal, meta


# ---------------------------------------------------------------------------------------------- schedules
def late_schedule(source, off, late):
    """Lit from sunset (lightModes[0]) until `off`, then `late` — also from 04:00 until it is light.

    Why the rule: lightMode() returns `after` only up to 04:00 and then falls back to the first mode,
    so without it the evening windows (half the rooms) would come back on before dawn.
    """
    return {
        "source": source,
        "on": "sunset",
        "off": off,
        "rules": [{"mode": late, "weekdays": [0, 1, 2, 3, 4, 5, 6], "from": "04:00", "to": "12:00"}],
        "after": late,
    }


# ---------------------------------------------------------------------------------------------- export
def entry(id_, name, site, base, height, far_distance, rings, plateau, modes, schedule, note=None, buffer=0.5):
    lon, lat = site.origin()
    # 0.5 m: the PLATEAU walls on the ring fall inside, the kiosks and canopies next to it mostly do not
    hide = [lonlat_buffer(r, buffer) for r in rings]
    e = {
        "id": id_,
        "name": name,
        "lon": round(lon, 7),
        "lat": round(lat, 7),
        "heading": site.heading,
        "baseHeight": base,
        "height": height,
        "farDistance": far_distance,
        "footprint": hide[0],
        "plateau": plateau,
        "sources": [SOURCES["plateau"]],  # footprints and envelopes are PLATEAU's; OSM only helped find them
        # Why not widened with distance as the towers are: these are low and broad, and a hall 40 m tall
        # stretched sideways at 15 km+ would stand out of the skyline.
        "widenFar": False,
        "lightModes": modes,
        "lightSchedule": schedule,
    }
    if len(hide) > 1:
        e["extraFootprints"] = hide[1:]
    if note:
        e["note"] = note
    return e


BUILDERS = {
    "zojoji_sangedatsumon": lambda _landmarks: build_sangedatsumon(),
    "zojoji_daiden": lambda _landmarks: build_daiden(),
    "shiba_park_hotel_south": lambda _landmarks: build_hotel_south(),
    "shiba_park_hotel_east": lambda _landmarks: build_hotel_east(),
    "tower_north_hall": lambda _landmarks: build_hall_north(),
}


def review_views(site, base, size, top, far_distance):
    """Review cameras in model coordinates: front (+Z), side (+X), oblique from above, a pedestrian at
    the corner, Tokyo Tower's main deck (150 m, stepped out past the lattice) and the far LOD from just
    beyond the distance it takes over. Night is each of these in the night modes (landmarks.py)."""
    s = max(size, 0.7 * top)  # tall buildings: back off until the whole height is in frame
    tx, tz = site.model_of_lonlat(TOWER[0], TOWER[1])
    deck = (tx, TOWER[2] + TOWER_DECK_EYE - base, tz)
    dist_deck = math.hypot(tx, tz)
    return {
        "front": ((0.0, 1.6, 2.2 * s), (0.0, top * 0.42, 0.0), 30, (1280, 853)),
        "side": ((2.2 * s, 1.6, 0.0), (0.0, top * 0.42, 0.0), 30, (1280, 853)),
        "oblique": ((1.5 * s, 0.9 * s + top * 0.6, 1.6 * s), (0.0, top * 0.45, 0.0), 32, (1280, 853)),
        "pedestrian": ((0.62 * s, 1.6, 0.75 * s), (0.0, top * 0.55, 0.0), 22, (1280, 853)),
        "deck": (deck, (0.0, top * 0.5, 0.0), max(24.0, min(240.0, 36.0 * dist_deck / (2.6 * s))), (1280, 853)),
        "far": (
            (-0.6 * far_distance, 40.0, 0.8 * far_distance),
            (0.0, top * 0.5, 0.0),
            36.0 * far_distance / (2.4 * max(s, 1.2 * top)),
            (960, 640),
        ),
    }


# id → (site, base T.P., plan size m, top m, far distance m) for the review cameras
PREVIEW_VIEWS = {
    "zojoji_sangedatsumon": review_views(GATE, 3.3, 22.0, 21.0, 700),
    "zojoji_daiden": review_views(DAIDEN, DAIDEN_YARD, 40.0, 37.0, 900),
    "shiba_park_hotel_south": review_views(HOTEL_S, 10.9, 60.0, 108.0, 1500),
    "shiba_park_hotel_east": review_views(HOTEL_E, 7.6, 85.0, 50.0, 1000),
    "tower_north_hall": review_views(HALL_N, 21.1, 55.0, 46.0, 800),
}
