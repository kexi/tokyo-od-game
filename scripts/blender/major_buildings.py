# Four major Tokyo buildings at their real size, for TOKYO OPEN DRIVE: 東京都庁第一本庁舎, 国会議事堂,
# 東京国際展示場 会議棟 and 国立競技場. Registered in scripts/blender/landmarks.py LANDMARK_MODULES, which
# calls build(L) with itself as L (Builder / Palette / export / previews) and picks the building by the
# output file's basename:
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/landmarks.py -- public/models/<id>.glb [preview-dir]
#
# Dimensions, their sources and how each was measured are in knowledge/major-buildings-blender.md.
# In short: plan shapes from OpenStreetMap (ODbL), heights from the owners' published figures
# (東京都財務局, 衆議院・参議院, JSC / JIA), tier heights and plan steps measured on PLATEAU LOD2
# sections (PDL 1.0) and Wikimedia Commons photographs. PLATEAU is only a reference: its walls are
# stepped and partly floating, so every surface here is drawn afresh as clean prisms and lofts.
#
# Coordinates follow the other landmarks: +Y up, metres, origin on the ground at the reference point,
# +Z = the entry's heading, +X = its left. Night: Day_<part> plus Light_<mode>_<part> per mode.
import json
import math
import os

from mathutils import Vector
from mathutils.geometry import tessellate_polygon

# Footprint of 国会議事堂 (the only one not cut out of PLATEAU, see PLATEAU_DATA below): the outer ring
# of OpenStreetMap relation 3361370 (© OpenStreetMap contributors, ODbL 1.0), Overpass 2026-11-10,
# simplified with Douglas–Peucker ≤ 0.3 m.
FOOTPRINT = {
    "national_diet": [
        [139.7454339, 35.6753993],
        [139.7455253, 35.6754161],
        [139.7455758, 35.6752352],
        [139.7454844, 35.6752184],
        [139.7454881, 35.6752053],
        [139.7454763, 35.6752032],
        [139.7454817, 35.6751837],
        [139.7454143, 35.6751713],
        [139.7454382, 35.6750859],
        [139.7453444, 35.6750686],
        [139.7453554, 35.6750291],
        [139.7448269, 35.6749318],
        [139.7448127, 35.6749827],
        [139.7447300, 35.6749675],
        [139.7447100, 35.6750389],
        [139.7446268, 35.6750236],
        [139.7446209, 35.6750447],
        [139.7446110, 35.6750429],
        [139.7445553, 35.6752423],
        [139.7445665, 35.6752444],
        [139.7445611, 35.6752640],
        [139.7446380, 35.6752781],
        [139.7445285, 35.6756705],
        [139.7444416, 35.6756545],
        [139.7444250, 35.6757129],
        [139.7443661, 35.6757036],
        [139.7443136, 35.6758917],
        [139.7443738, 35.6759028],
        [139.7443574, 35.6759613],
        [139.7444430, 35.6759770],
        [139.7443340, 35.6763676],
        [139.7442556, 35.6763532],
        [139.7442500, 35.6763733],
        [139.7442295, 35.6763696],
        [139.7441737, 35.6765693],
        [139.7441892, 35.6765721],
        [139.7441843, 35.6765894],
        [139.7442639, 35.6766041],
        [139.7442436, 35.6766770],
        [139.7443333, 35.6766935],
        [139.7443185, 35.6767467],
        [139.7448393, 35.6768426],
        [139.7448539, 35.6767902],
        [139.7449476, 35.6768074],
        [139.7449670, 35.6767379],
        [139.7450452, 35.6767523],
        [139.7450479, 35.6767426],
        [139.7450611, 35.6767450],
        [139.7450665, 35.6767254],
        [139.7451444, 35.6767397],
        [139.7451950, 35.6765585],
        [139.7451171, 35.6765441],
        [139.7451232, 35.6765224],
        [139.7451100, 35.6765200],
        [139.7451139, 35.6765062],
        [139.7450409, 35.6764928],
        [139.7451362, 35.6761512],
        [139.7452177, 35.6761660],
        [139.7452347, 35.6761031],
        [139.7452693, 35.6761095],
        [139.7452753, 35.6760878],
        [139.7454065, 35.6761119],
        [139.7454690, 35.6758879],
        [139.7453437, 35.6758649],
        [139.7453494, 35.6758442],
        [139.7453041, 35.6758359],
        [139.7453210, 35.6757751],
        [139.7452456, 35.6757612],
        [139.7453421, 35.6754153],
        [139.7454098, 35.6754278],
        [139.7454159, 35.6754058],
        [139.7454313, 35.6754087],
    ],
}


# Where the game hides the PLATEAU copy (src/world/buildings.ts cutFootprints collapses every
# triangle whose centroid lies inside a landmark's footprint). data/plateau_lod1_major_buildings.json
# holds, per site, `hideRings`: the PLATEAU LOD1 outline(s) of the replaced building, unioned and
# pushed 0.5 m outward (shapely, mitred), with narrow slots carved round the wall centroids of the
# neighbours that touch it; and `buildings`: the LOD1 triangle centroids round the site, so the cut
# can be counted here and in tests/majorBuildings.test.ts. Made from the 2025 LOD1 tiles by the
# scratchpad scripts recorded in knowledge/major-buildings-blender.md.
# Why not OSM's outline (+3 m, as first): PLATEAU's walls run outside it in places, and 28 of the
# stadium's 1,720 LOD1 triangles stayed standing round the model while neighbours were half cut.
PLATEAU_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "plateau_lod1_major_buildings.json")
with open(PLATEAU_DATA, encoding="utf-8") as _f:
    PLATEAU = json.load(_f)["sites"]


def point_in_ring(ring, x, y):
    """Even–odd test, the same as cutFootprints in src/world/buildings.ts."""
    is_in = False
    j = len(ring) - 1
    for i in range(len(ring)):
        a, b = ring[i], ring[j]
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            is_in = not is_in
        j = i
    return is_in


def plateau_cut(site, footprint):
    """Triangles of the replaced building left standing, and neighbours partly cut by `footprint`."""
    data = PLATEAU[site]
    left, partial = 0, {}
    for gml_id, centroids in data["buildings"].items():
        cut = sum(1 for x, y in centroids if point_in_ring(footprint, x, y))
        is_replaced = gml_id in data["hide"]
        if is_replaced:
            left += len(centroids) - cut
        elif cut:
            partial[gml_id] = cut
    return {"replacedLeft": left, "neighboursCut": partial}


def log_cut(site, footprint):
    """Print the cut counts as a log line (one JSON event) and pass the footprint through."""
    print(json.dumps({"event": "plateau_cut", "landmark": site, **plateau_cut(site, footprint)}), flush=True)
    return footprint


def hide_footprint(site):
    ring = PLATEAU[site]["hideRings"][0]
    assert len(PLATEAU[site]["hideRings"]) == 1, site  # one ring per entry (footprint is a single ring)
    return ring


def lonlat_to_model(origin, heading_deg, lon, lat, m_lat):
    """lon/lat -> model (x, z): +Z toward `heading_deg`, +X 90° to its left (as landmarks.py)."""
    east = (lon - origin[0]) * 111_320.0 * math.cos(math.radians(origin[1]))
    north = (lat - origin[1]) * m_lat
    h = math.radians(heading_deg)
    z = east * math.sin(h) + north * math.cos(h)
    x = -east * math.cos(h) + north * math.sin(h)
    return (x, z)


def wind_up(outline):
    """Order an (x, z) outline so that a face through it points +Y (Builder.prism's convention)."""
    s = sum(
        outline[i][0] * outline[(i + 1) % len(outline)][1] - outline[(i + 1) % len(outline)][0] * outline[i][1]
        for i in range(len(outline))
    )
    return list(outline) if s < 0 else list(reversed(outline))


def dedupe(outline, eps=0.05):
    out = []
    for p in outline:
        if not out or math.dist(p, out[-1]) > eps:
            out.append(p)
    if len(out) > 2 and math.dist(out[0], out[-1]) <= eps:
        out.pop()
    return out


def superellipse(a, b, n=2.4, segs=96, cx=0.0, cz=0.0):
    """Rounded-rectangle ring in (x, z): semi-axes a along z (the long axis) and b along x."""
    pts = []
    for k in range(segs):
        t = 2 * math.pi * k / segs
        c, s = math.cos(t), math.sin(t)
        z = a * math.copysign(abs(c) ** (2 / n), c)
        x = b * math.copysign(abs(s) ** (2 / n), s)
        pts.append((cx + x, cz + z))
    return wind_up(pts)


def rot_square(r, notch=0.0, cx=0.0, cz=0.0):
    """Square turned 45° (corners on the axes, half-diagonal r), each corner cut by a V-notch."""
    pts = []
    for k in range(4):
        ax, az = math.cos(k * math.pi / 2), math.sin(k * math.pi / 2)
        px, pz = -az, ax  # along the face, perpendicular to the corner axis
        if notch:
            pts += [
                (cx + ax * r - px * notch, cz + az * r - pz * notch),
                (cx + ax * (r - notch), cz + az * (r - notch)),
                (cx + ax * r + px * notch, cz + az * r + pz * notch),
            ]
        else:
            pts.append((cx + ax * r, cz + az * r))
    return wind_up(pts)


def stepped(steps, cx=0.0, cz=0.0, swap=False):
    """Symmetric stepped plan: steps = [(along, half_width), ...] from the centre outward, i.e. the
    outline reaches half_width across for |along| up to that step's `along`. swap: along = z."""
    q = []  # quadrant (+along, +w), from the w axis toward the along axis
    for i, (along, w) in enumerate(steps):
        if i:
            q.append((steps[i - 1][0], w))
        q.append((along, w))
    ring = q + [(a, -w) for a, w in reversed(q)] + [(-a, -w) for a, w in q] + [(-a, w) for a, w in reversed(q)]
    pts = [(cx + w, cz + a) if swap else (cx + a, cz + w) for a, w in ring]
    return wind_up(dedupe(pts))


class Shapes:
    """Extra mesh helpers on top of landmarks.py's Builder."""

    def __init__(self, b):
        self.b = b

    def walls(self, outline, y0, y1, part, mu, mv, v0=0.0, smooth=False):
        """Outward walls over an (x, z) outline, world-unit UVs (u along the walls, v = height)."""
        self.b.prism(wind_up(outline), y0, y1, part, uv_side=(mu, v0, mv), smooth=smooth)

    def cap(self, outline, y, part, up=True, scale=8.0):
        o = wind_up(outline)
        pts = [(x, y, z) for x, z in (o if up else list(reversed(o)))]
        self.b.face(pts, part, [(p[0] / scale, p[2] / scale) for p in pts])

    def block(self, outline, y0, y1, wall, top, mu=8.0, mv=8.0, bottom=None, v0=0.0):
        self.walls(outline, y0, y1, wall, mu, mv, v0)
        self.cap(outline, y1, top)
        if bottom:
            self.cap(outline, y0, bottom, up=False)

    def box(self, cx, cz, hx, hz, y0, y1, wall, top=None, mu=8.0, mv=8.0, bottom=None):
        o = [(cx + hx, cz - hz), (cx - hx, cz - hz), (cx - hx, cz + hz), (cx + hx, cz + hz)]
        self.block(o, y0, y1, wall, top or wall, mu, mv, bottom)

    def loft(self, rings, part, mu, mv, facing, smooth=True, centre=(0.0, 0.0)):
        """Surface through closed rings of (x, y, z) points with equal counts.

        facing: "out" / "in" (away from / toward the vertical axis through `centre`), "up" or
        "down"; each quad is flipped to face that way. UVs: u = arc length along the ring / mu,
        v = distance up the column / mv.
        """
        n = len(rings[0])
        vacc = [[0.0] * n]
        for i in range(1, len(rings)):
            vacc.append([vacc[-1][j] + math.dist(rings[i][j], rings[i - 1][j]) for j in range(n)])
        uacc = []
        for r in rings:
            acc = [0.0]
            for j in range(n):
                acc.append(acc[-1] + math.dist(r[j], r[(j + 1) % n]))
            uacc.append(acc)
        for i in range(len(rings) - 1):
            for j in range(n):
                k = (j + 1) % n
                q = [rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]]
                uv = [
                    (uacc[i][j] / mu, vacc[i][j] / mv),
                    (uacc[i][j + 1] / mu, vacc[i][k] / mv),
                    (uacc[i + 1][j + 1] / mu, vacc[i + 1][k] / mv),
                    (uacc[i + 1][j] / mu, vacc[i + 1][j] / mv),
                ]
                a, b2, c = Vector(q[0]), Vector(q[1]), Vector(q[3])
                nrm = (b2 - a).cross(c - a)
                if nrm.length < 1e-9:
                    nrm = (Vector(q[2]) - Vector(q[1])).cross(Vector(q[0]) - Vector(q[1]))
                mid = sum((Vector(p) for p in q), Vector()) / 4
                radial = Vector((mid.x - centre[0], 0.0, mid.z - centre[1]))
                want = {"out": radial, "in": -radial, "up": Vector((0, 1, 0)), "down": Vector((0, -1, 0))}[facing]
                if nrm.dot(want) < 0:
                    q.reverse()
                    uv.reverse()
                self.b.face(q, part, uv, smooth)

    def face_toward(self, pts, part, want, uvs=None):
        """One planar face, flipped if needed so that its normal points along `want`."""
        nrm = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[-1]) - Vector(pts[0]))
        if nrm.dot(Vector(want)) < 0:
            pts = list(reversed(pts))
            uvs = list(reversed(uvs)) if uvs else None
        self.b.face(pts, part, uvs)

    def ring_band(self, outer, inner, y, part, up=True, scale=4.0):
        """Flat annulus between two rings (same point count) at height y."""
        n = len(outer)
        for j in range(n):
            k = (j + 1) % n
            q = [
                (outer[j][0], y, outer[j][1]),
                (outer[k][0], y, outer[k][1]),
                (inner[k][0], y, inner[k][1]),
                (inner[j][0], y, inner[j][1]),
            ]
            nrm = (Vector(q[1]) - Vector(q[0])).cross(Vector(q[3]) - Vector(q[0]))
            if (nrm.y > 0) != up:
                q.reverse()
            self.b.face(q, part, [(p[0] / scale, p[2] / scale) for p in q])

    def holed_cap(self, outer, holes, y, part, scale=8.0):
        """Up-facing roof over `outer` with `holes` left open (triangulated)."""
        loops = [[Vector((x, z, 0)) for x, z in wind_up(outer)]] + [
            [Vector((x, z, 0)) for x, z in wind_up(h)] for h in holes
        ]
        flat = [p for loop in loops for p in loop]
        for tri in tessellate_polygon(loops):
            pts = [(flat[i].x, y, flat[i].y) for i in tri]
            nrm = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[2]) - Vector(pts[0]))
            if nrm.y < 0:
                pts.reverse()
            self.b.face(pts, part, [(p[0] / scale, p[2] / scale) for p in pts])


def ring3(outline, y):
    return [(x, y, z) for x, z in outline]


def lit(color, k=1.0, tex=None):
    return {"emission": (color[0] * k, color[1] * k, color[2] * k, 1.0), "strength": 1.0, "emit_tex": tex}


def finish(L, name, near, far, pal):
    root = L.bpy.data.objects.new(name, None)
    L.SCENE.collection.objects.link(root)
    return root, near.finish(pal, root), far.finish(pal, root)


# ============================================================================================== 東京都庁第一本庁舎
# 地上 48 階、最高部 243.4 m・軒高 241.87 m（東京都財務局）。Plan (OSM way 89877471): 109.6 x 46.5 m, long
# axis on bearing 349.2°. Twin towers 63.2 m apart (centres of the OSM building:part rings), each a
# stepped cross 46 x 46 m; the 34 m-wide link between them rises to 144.5 m (PLATEAU roof level, the
# 33rd floor where the building splits). PLATEAU sections: stepped cross to 192 m, square turned 45°
# with V-cut corners 192–216 m (half-diagonal 24 m) and 216–237 m (23 m), plain 237–242 m (21.5 m),
# roof 242 m; the north tower's radio mast reaches 260.7 m. +Z faces east (bearing 79.2°).
TC_TOWER_X = 31.6  # tower centres on ±x (x = north)
TC_BASE_STEPS = [(10.5, 23.0), (14.5, 16.5), (21.0, 11.0), (23.0, 6.5)]
TC_LINK = (21.1, 17.0, 144.5)  # half-length along x, half-width, top
TC_TIERS = (192.0, 216.0, 237.0, 242.0)
TC_FACADE = (12.8, 16.0)  # mb_tocho_facade.jpg tile (u, v) in metres


def build_tokyo_tocho(L):
    modes = ["lightup", "lightsOut"]
    pal = L.Palette(modes)
    night = {
        "lightup": {"emission": (1, 1, 1, 1), "strength": 1.0, "emit_tex": "mb_tocho_night.png"},
        "lightsOut": {"emission": (0.55, 0.55, 0.55, 1), "strength": 1.0, "emit_tex": "mb_tocho_night.png"},
    }
    pal.add("TC_Facade", night, color=0xFFFFFF, tex="mb_tocho_facade.jpg", roughness=0.55)
    pal.add("TC_Roof", color=0x8E8B86, roughness=0.85)
    # The crown (the recessed top floors) is floodlit in the colour of the day's campaign; white here.
    pal.add("TC_Crown", {"lightup": lit((0.35, 0.6, 1.0), 0.6)}, color=0x7D8790, metallic=0.3, roughness=0.3)
    pal.add("TC_Mast", {m: lit((0.25, 0.08, 0.06)) for m in modes}, color=0xB8332A, metallic=0.4, roughness=0.5)
    lamp = {"emission": (1.0, 0.02, 0.01, 1.0), "strength": 20.0}
    pal.add("TC_AviationLamp", {m: lamp for m in modes}, color=0x601010, roughness=0.3)

    near = L.Builder("TokyoTocho_Near")
    s = Shapes(near)
    mu, mv = TC_FACADE
    t0, t1, t2, t3 = TC_TIERS
    for side in (-1, 1):
        cx = side * TC_TOWER_X
        base = stepped(TC_BASE_STEPS, cx=cx)
        s.walls(base, -1.0, t0, "TC_Facade", mu, mv)
        s.cap(base, t0, "TC_Roof")
        star1 = rot_square(24.0, 3.0, cx=cx)
        s.walls(star1, t0, t1, "TC_Facade", mu, mv)
        s.cap(star1, t1, "TC_Roof")
        star2 = rot_square(23.0, 2.5, cx=cx)
        # the top tiers are mostly dark glass round the recessed crown (photos), lit at night
        s.walls(star2, t1, t2, "TC_Crown", 6.0, 6.0)
        s.cap(star2, t2, "TC_Roof")
        top = rot_square(21.5, cx=cx)
        s.walls(top, t2, t3, "TC_Crown", 6.0, 6.0)
        s.cap(top, t3, "TC_Roof")
        s.box(cx, 0.0, 6.0, 6.0, t3, t3 + 3.0, "TC_Roof")  # roof plant
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            near.box((cx + dx * 20.5, t3 + 0.4, dz * 20.5), (0.6, 0.6, 0.6), "TC_AviationLamp")
    hx, hz, top_link = TC_LINK
    link = [(hx, -hz), (-hx, -hz), (-hx, hz), (hx, hz)]
    s.walls(link, -1.0, top_link, "TC_Facade", mu, mv)
    s.cap(link, top_link, "TC_Roof")
    # north tower: the radio mast and the ring of dishes on the roof (PLATEAU 242–260.7 m)
    mx = TC_TOWER_X + 4.0
    s.walls(rot_square(0.6, cx=mx), t3 + 3.0, 260.7, "TC_Mast", 2.0, 2.0)
    s.cap(rot_square(0.6, cx=mx), 260.7, "TC_Mast")
    for k in range(16):  # the red ring of the antenna frame (photo: a wheel ~8 m across)
        a0, a1 = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
        p0 = Vector((mx + 4.0 * math.cos(a0), 252.0 + 4.0 * math.sin(a0), 0.0))
        p1 = Vector((mx + 4.0 * math.cos(a1), 252.0 + 4.0 * math.sin(a1), 0.0))
        near.beam(p0, p1, 0.5, 0.5, "TC_Mast", normal=(0, 0, 1))
        if k % 4 == 0:
            near.beam(Vector((mx, 252.0, 0.0)), p0, 0.3, 0.3, "TC_Mast", normal=(0, 0, 1))
    near.box((mx, 261.0, 0.0), (0.6, 0.6, 0.6), "TC_AviationLamp")

    far_l = {"lightup": lit((0.13, 0.115, 0.09)), "lightsOut": lit((0.08, 0.07, 0.055))}
    pal.add("TC_Far", far_l, color=0x8C8883, roughness=0.6)
    pal.add("TC_FarCrown", {"lightup": lit((0.35, 0.6, 1.0), 0.7)}, color=0x7D8790, roughness=0.4)
    far = L.Builder("TokyoTocho_Far")
    sf = Shapes(far)
    for side in (-1, 1):
        cx = side * TC_TOWER_X
        sf.block([(cx + 23, -23), (cx - 23, -23), (cx - 23, 23), (cx + 23, 23)], -1.0, t0, "TC_Far", "TC_Far")
        sf.block(rot_square(24.0, cx=cx), t0, t2 - 6.0, "TC_Far", "TC_Far")
        sf.block(rot_square(23.0, cx=cx), t2 - 6.0, t3, "TC_FarCrown", "TC_Far")
    sf.block(link, -1.0, top_link, "TC_Far", "TC_Far")
    root, near_ob, far_ob = finish(L, "TokyoTocho", near, far, pal)

    origin = (139.691716, 35.689497)  # midpoint between the towers (PLATEAU LOD2 sections)
    heading = 79.2
    meta = {
        "id": "tokyo_tocho",
        "name": "東京都庁第一本庁舎",
        "lon": origin[0],
        "lat": origin[1],
        "heading": heading,
        "baseHeight": 34.6,
        "height": 243.4,
        "farDistance": 1500,
        "footprint": log_cut("tokyo_tocho", hide_footprint("tokyo_tocho")),
        "plateau": [{"gmlId": "bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7", "hide": True}],
        "sources": [L.SOURCES["osm"], L.SOURCES["plateau"]],
        "lightModes": [
            {"id": "lightup", "name": "ライトアップ（塔頂部の投光と執務室の明かり）"},
            {"id": "lightsOut", "name": "ライトアップ終了後（執務室の明かりのみ）"},
        ],
        "lightSchedule": {
            "source": (
                "東京都の報道発表（2025–2026 年の啓発ライトアップは 18:00〜22:30 の間の告知ごとの時間）。"
                "常設の点灯時刻は一次情報で確かめられず、日没〜22:00 は仮定"
            ),
            "on": "sunset",
            "off": "22:00",
            "after": "lightsOut",
        },
    }
    return root, near_ob, far_ob, pal, meta


# ============================================================================================== 国会議事堂
# 幅 206.36 m（南北）・奥行 88.63 m（東西）・両翼の屋上 20.91 m・中央塔 65.45 m（衆議院・参議院の公表値）。
# Plan: OSM relation 3361370 (205.8 x 101.8 m with the steps; 88.6 m from the back wall to the porch),
# front (east) on bearing 77.3°, 衆議院 on the left (south) seen from the front. PLATEAU (2025) has no
# building inside the Diet's grounds, so nothing is hidden there and the footprint only gives the
# collision walls. Central block and tower stages measured on the frontal photograph
# "Diet of Japan Kokkai 2009.jpg" (scale from the 65.45 m tower top and the 20.91 m wing roof).
DT_WING_H = 20.91
DT_TOWER = (-1.1, 17.6)  # (x, z) of the tower axis
DT_PORCH = (39.4, 51.6, -14.0, 11.3)  # z0, z1, x0, x1 (x = -v)


def build_national_diet(L):
    modes = ["evening", "lateNight"]
    pal = L.Palette(modes)
    wing_night = {
        "evening": {"emission": (1, 1, 1, 1), "strength": 1.0, "emit_tex": "mb_diet_wing_night.png"},
        "lateNight": {"emission": (0.35, 0.35, 0.35, 1), "strength": 1.0, "emit_tex": "mb_diet_wing_night.png"},
    }
    # Street and garden lamps light the granite a little; no floodlighting is published.
    glow = {"evening": lit((0.035, 0.03, 0.025)), "lateNight": lit((0.022, 0.02, 0.017))}
    pal.add("DT_Wing", wing_night, color=0xFFFFFF, tex="mb_diet_wing.jpg", roughness=0.7)
    pal.add("DT_Stone", glow, color=0xFFFFFF, tex="mb_diet_stone.jpg", roughness=0.7)
    pal.add("DT_Pyramid", glow, color=0xE6CFC2, tex="mb_diet_stone.jpg", roughness=0.6)
    pal.add("DT_Roof", color=0x86827C, roughness=0.9)
    pal.add("DT_Recess", {"evening": lit((0.20, 0.16, 0.10))}, color=0x2E302E, roughness=0.6)
    pal.add("DT_Column", glow, color=0xE8DED2, roughness=0.6)
    lamp = {"emission": (1.0, 0.02, 0.01, 1.0), "strength": 20.0}
    pal.add("DT_AviationLamp", {m: lamp for m in modes}, color=0x601010, roughness=0.3)

    origin = (139.7448784, 35.6759093)  # centre of the OSM ring
    heading = 77.3
    fp = [lonlat_to_model(origin, heading, lon, lat, L.M_LAT) for lon, lat in FOOTPRINT["national_diet"]]
    z0, z1, x0, x1 = DT_PORCH
    body = dedupe([(x, min(z, z0)) for x, z in fp])  # the porch is built open, below

    near = L.Builder("NationalDiet_Near")
    s = Shapes(near)
    s.walls(body, -0.5, DT_WING_H, "DT_Wing", 4.6, DT_WING_H, v0=0.0)
    courts = [  # two courtyards and two light wells (OSM inner rings), in (u, v) -> (x, z) = (-v, u)
        [(-23.6, 23.2), (16.5, 23.2), (16.5, 49.9), (-23.6, 49.9)],
        [(-24.1, -47.2), (15.4, -47.2), (15.4, -21.0), (-24.1, -21.0)],
        [(-22.1, -9.5), (2.3, -9.5), (2.3, -2.2), (-22.1, -2.2)],
        [(-21.9, 5.0), (2.3, 5.0), (2.3, 12.5), (-21.9, 12.5)],
    ]
    holes = [[(-v, u) for u, v in c] for c in courts]
    s.holed_cap(body, holes, DT_WING_H, "DT_Roof")
    for h in holes:  # courtyard walls face inward, floor 1 m down
        near.prism(list(reversed(wind_up(h))), 0.0, DT_WING_H, "DT_Wing", uv_side=(4.6, 0.0, DT_WING_H))
        s.cap(h, 0.0, "DT_Roof")
    # central block (4 storeys) over the wings, a T in plan (wider at the front), kept 0.2 m inside
    # the wing walls so its faces never share a plane with them
    central = [
        (20.7, 35.9),
        (-23.1, 35.9),
        (-23.1, 20.1),
        (-15.8, 20.1),
        (-15.8, -44.5),
        (18.6, -44.5),
        (18.6, 20.1),
        (20.7, 20.1),
    ]
    s.block(central, 20.0, 26.0, "DT_Stone", "DT_Roof", 4.0, 4.0)
    # porch: roof slab, four columns between two piers, steps
    pz = (z0 + z1) / 2
    s.box(
        (x0 + x1) / 2, pz, (x1 - x0) / 2, (z1 - z0) / 2, 18.4, 21.6, "DT_Stone", "DT_Roof", 4.0, 4.0, bottom="DT_Stone"
    )
    for xc in (x0 + 1.6, x1 - 1.6):
        s.box(xc, pz, 1.6, (z1 - z0) / 2, 0.0, 18.4, "DT_Stone", None, 4.0, 4.0)
    for k in range(4):
        xc = x0 + 4.6 + k * (x1 - x0 - 9.2) / 3
        near.prism(L_regular(16, 0.95, xc, z1 - 1.6), 1.6, 18.4, "DT_Column", smooth=True)
    for k in range(4):  # front steps, 0.4 m risers
        zf = z1 + 6.0 - 1.5 * k
        s.box(
            (x0 + x1) / 2,
            (z1 - 0.1 + zf) / 2,
            (x1 - x0) / 2 + 2.0,
            (zf - z1 + 0.1) / 2,
            -0.5,
            0.4 * (k + 1),
            "DT_Stone",
            None,
            4.0,
            4.0,
        )
    # the tower: base stage, colonnade stage (recess with six piers per face), frieze, attic, the stepped
    # pyramid and the lantern
    tx, tz = DT_TOWER
    s.box(tx, tz, 17.25, 17.25, 20.5, 30.5, "DT_Stone", "DT_Roof", 4.0, 4.0)
    for dx in (-1, 1):
        for dz in (-1, 1):
            s.box(tx + dx * 15.6, tz + dz * 15.6, 1.1, 1.1, 30.5, 33.2, "DT_Stone", None, 4.0, 4.0)
    h = 15.0
    s.box(tx, tz, h, h, 30.5, 33.5, "DT_Stone", None, 4.0, 4.0)
    rec_half, depth = 8.4, 1.2
    ring = []
    for k in range(4):  # cross-shaped plan: each face recessed by `depth` over ±rec_half
        c, si = math.cos(k * math.pi / 2), math.sin(k * math.pi / 2)

        def p(a, b, c=c, si=si):
            return (tx + a * c - b * si, tz + a * si + b * c)

        ring += [p(h, -h), p(h, -rec_half), p(h - depth, -rec_half), p(h - depth, rec_half), p(h, rec_half)]
    s.walls(ring, 33.5, 42.0, "DT_Stone", 4.0, 4.0)
    for k in range(4):
        c, si = math.cos(k * math.pi / 2), math.sin(k * math.pi / 2)
        a = h - depth + 0.05  # the dark window wall at the back of the recess
        s.face_toward(
            [
                (tx + a * c + rec_half * si, 33.5, tz + a * si - rec_half * c),
                (tx + a * c - rec_half * si, 33.5, tz + a * si + rec_half * c),
                (tx + a * c - rec_half * si, 42.0, tz + a * si + rec_half * c),
                (tx + a * c + rec_half * si, 42.0, tz + a * si - rec_half * c),
            ],
            "DT_Recess",
            (c, 0.0, si),
        )
        for j in range(6):
            b = -rec_half + 1.2 + j * (2 * rec_half - 2.4) / 5
            cxp, czp = tx + (h - depth * 0.5) * c - b * si, tz + (h - depth * 0.5) * si + b * c
            s.box(cxp, czp, 0.5, 0.5, 33.5, 42.0, "DT_Column", None, 4.0, 4.0)
    s.box(tx, tz, h, h, 42.0, 44.0, "DT_Stone", "DT_Roof", 4.0, 4.0)
    s.box(tx, tz, 12.5, 12.5, 44.0, 48.5, "DT_Stone", "DT_Roof", 4.0, 4.0)
    s.box(tx, tz, 11.0, 11.0, 48.5, 53.5, "DT_Stone", None, 4.0, 4.0)
    steps = 9
    for k in range(steps):  # stepped pyramid 53.5 -> 62.5 m, 22 m -> 5.5 m
        y0 = 53.5 + k * 1.0
        half = 11.0 - k * (11.0 - 2.75) / (steps - 1)
        s.box(tx, tz, half, half, y0, y0 + 1.0, "DT_Pyramid", "DT_Pyramid", 4.0, 4.0)
    s.box(tx, tz, 2.6, 2.6, 62.5, 64.4, "DT_Stone", "DT_Roof", 4.0, 4.0)
    s.walls(
        [(tx + 1.4, tz - 1.4), (tx - 1.4, tz - 1.4), (tx - 1.4, tz + 1.4), (tx + 1.4, tz + 1.4)],
        64.4,
        65.45,
        "DT_Stone",
        4.0,
        4.0,
    )
    s.cap([(tx + 1.4, tz - 1.4), (tx - 1.4, tz - 1.4), (tx - 1.4, tz + 1.4), (tx + 1.4, tz + 1.4)], 65.45, "DT_Stone")
    near.box((tx, 65.75, tz), (0.5, 0.5, 0.5), "DT_AviationLamp")

    far_l = {"evening": lit((0.04, 0.035, 0.028)), "lateNight": lit((0.025, 0.022, 0.018))}
    pal.add("DT_Far", far_l, color=0xD8CEC2, roughness=0.7)
    pal.add("DT_FarRoof", color=0x9C948C, roughness=0.8)
    far = L.Builder("NationalDiet_Far")
    sf = Shapes(far)
    sf.block(body, -0.5, DT_WING_H, "DT_Far", "DT_FarRoof")
    sf.block(central, 20.0, 26.0, "DT_Far", "DT_FarRoof")
    sf.box(tx, tz, 15.0, 15.0, 20.5, 48.5, "DT_Far", "DT_FarRoof")
    tip = (tx, 65.45, tz)
    base = [(tx + 11, 48.5, tz - 11), (tx - 11, 48.5, tz - 11), (tx - 11, 48.5, tz + 11), (tx + 11, 48.5, tz + 11)]
    for k in range(4):
        b0, b1 = base[k], base[(k + 1) % 4]
        out = ((b0[0] + b1[0]) / 2 - tx, 0.3, (b0[2] + b1[2]) / 2 - tz)
        sf.face_toward([b0, b1, tip], "DT_Far", out)
    root, near_ob, far_ob = finish(L, "NationalDiet", near, far, pal)
    meta = {
        "id": "national_diet",
        "name": "国会議事堂",
        "lon": origin[0],
        "lat": origin[1],
        "heading": heading,
        "baseHeight": 25.3,
        "height": 65.45,
        "farDistance": 1000,
        "widenFar": False,
        "footprint": FOOTPRINT["national_diet"],
        "solid": True,
        "plateau": [],
        "plateauNote": (
            "PLATEAU 2025 千代田区（LOD1・LOD2）には国会議事堂の構内に建物が無い。"
            "隠す建物は無く、足元は衝突の壁にだけ使う"
        ),
        "sources": [L.SOURCES["osm"]],
        "lightModes": [
            {"id": "evening", "name": "夜（残業の窓と外灯の照り返し）"},
            {"id": "lateNight", "name": "深夜（窓の明かりがわずか）"},
        ],
        "lightSchedule": {
            "source": "仮定（国会議事堂の定例の投光・点灯時刻は一次情報で見つからない）",
            "on": "sunset",
            "off": "22:00",
            "after": "lateNight",
        },
    }
    return root, near_ob, far_ob, pal, meta


def L_regular(n, r, cx, cz):
    """Regular n-gon in (x, z) around (cx, cz), wound for Builder.prism."""
    return wind_up([(cx + r * math.cos(2 * math.pi * k / n), cz + r * math.sin(2 * math.pi * k / n)) for k in range(n)])


def square(cx, cz, half):
    return [(cx + half, cz - half), (cx - half, cz - half), (cx - half, cz + half), (cx + half, cz + half)]


# ============================================================================================== 東京国際展示場 会議棟
# 高さ 58 m・地上 8 階（3〜5 階なし）、4 つの逆ピラミッド（観光公式・Wikipedia）。Plan: OSM way 154080988, a
# 98 m square with sides on bearings 56.6° / 146.6°. OSM building:part rings (Conference Tower Inverted
# Pyramid L2–L8, Columns): four inverted pyramids on a 49.2 m grid, 15.8 m across at 25–29 m widening
# to 49 m at 49–53 m, each carried on a 9.8 m core rising to 58 m. The entrance plaza deck is 6.5 m
# up (PLATEAU roof level). Titanium panels in a triangular grid, glass atrium between the pyramids.
BS_GRID = 24.6
BS_PYR = (25.0, 53.0, 8.0, 24.5)  # y0, y1, half-width at y0, half-width at y1


def build_tokyo_intl_exhibition(L):
    modes = ["lightup", "lightsOut"]
    pal = L.Palette(modes)
    pal.add(
        "BS_Titanium",
        {"lightup": lit((0.10, 0.09, 0.075))},
        color=0xFFFFFF,
        tex="mb_big_titanium.jpg",
        metallic=0.55,
        roughness=0.4,
    )
    gl = {
        "lightup": {"emission": (0.26, 0.26, 0.26, 1), "strength": 1.0, "emit_tex": "mb_big_glass_night.png"},
        "lightsOut": {"emission": (0.12, 0.12, 0.12, 1), "strength": 1.0, "emit_tex": "mb_big_glass_night.png"},
    }
    pal.add("BS_Glass", gl, color=0xFFFFFF, tex="mb_big_glass.jpg", metallic=0.2, roughness=0.2)
    pal.add("BS_Soffit", {"lightup": lit((0.22, 0.21, 0.18))}, color=0xC8C4BA, roughness=0.6)
    pal.add("BS_Concrete", {m: lit((0.05, 0.05, 0.045)) for m in modes}, color=0xB4B2AC, roughness=0.85)
    pal.add("BS_Roof", color=0x9A9892, roughness=0.8)
    lamp = {"emission": (1.0, 0.02, 0.01, 1.0), "strength": 20.0}
    pal.add("BS_AviationLamp", {m: lamp for m in modes}, color=0x601010, roughness=0.3)

    near = L.Builder("TokyoIntlExhibition_Near")
    s = Shapes(near)
    origin = (139.794072, 35.629785)  # centre of the OSM 会議棟 square
    heading = 326.6
    # The plaza deck (6.5 m, PLATEAU roof level) over the whole PLATEAU block it replaces: that block
    # (bldg_8794832f, 180 x 190 m) is hidden entire, since only 33 of its 354 LOD1 triangles had their
    # centroid inside the 98 m tower square and its 15 m slab ran through the pyramids.
    deck = dedupe(
        [lonlat_to_model(origin, heading, lon, lat, L.M_LAT) for lon, lat in hide_footprint("tokyo_intl_exhibition")]
    )
    s.block(deck, -1.0, 6.5, "BS_Glass", "BS_Concrete", 6.0, 4.0)
    y0, y1, h0, h1 = BS_PYR
    cores = [(sx * BS_GRID, sz * BS_GRID) for sx in (-1, 1) for sz in (-1, 1)]
    for cx, cz in cores:
        s.box(cx, cz, 4.9, 4.9, -1.0, 58.0, "BS_Glass", "BS_Roof", 6.0, 4.0)
        rings = []
        for k in range(8):
            y = y0 + (y1 - y0) * k / 7
            hw = h0 + (h1 - h0) * k / 7
            rings.append(
                ring3(wind_up([(cx + hw, cz - hw), (cx - hw, cz - hw), (cx - hw, cz + hw), (cx + hw, cz + hw)]), y)
            )
        s.loft(rings, "BS_Titanium", 6.0, 4.0, "out", smooth=False, centre=(cx, cz))
        s.cap(
            [(cx + h0, cz - h0), (cx - h0, cz - h0), (cx - h0, cz + h0), (cx + h0, cz + h0)], y0, "BS_Soffit", up=False
        )
        near.box((cx, 58.3, cz), (0.6, 0.6, 0.6), "BS_AviationLamp")
    # glass atrium between the pyramids (32–53 m), soffit underneath
    g = BS_GRID
    s.walls(square(0.0, 0.0, g), 31.0, y1, "BS_Glass", 6.0, 4.0)  # its top is the roof cap below
    s.cap(square(0.0, 0.0, g), 31.0, "BS_Soffit", up=False)
    # roof over the pyramids at 53 m and the plant storey 53–57 m
    s.cap([(h1 + g, -h1 - g), (-h1 - g, -h1 - g), (-h1 - g, h1 + g), (h1 + g, h1 + g)], y1, "BS_Roof")
    s.box(0.0, 0.0, 20.0, 20.0, y1, 57.0, "BS_Titanium", "BS_Roof", 6.0, 4.0)

    pal.add("BS_Far", {"lightup": lit((0.08, 0.072, 0.06))}, color=0xB4AC98, metallic=0.4, roughness=0.5)
    pal.add(
        "BS_FarGlass",
        {"lightup": lit((0.2, 0.19, 0.16)), "lightsOut": lit((0.07, 0.07, 0.06))},
        color=0x5E7480,
        roughness=0.3,
    )
    far = L.Builder("TokyoIntlExhibition_Far")
    sf = Shapes(far)
    sf.block(deck, -1.0, 6.5, "BS_FarGlass", "BS_Far")
    for cx, cz in cores:
        sf.box(cx, cz, 4.9, 4.9, -1.0, 58.0, "BS_FarGlass", "BS_Far")
        rings = [
            ring3(wind_up([(cx + hw, cz - hw), (cx - hw, cz - hw), (cx - hw, cz + hw), (cx + hw, cz + hw)]), y)
            for y, hw in ((y0, h0), (y1, h1))
        ]
        sf.loft(rings, "BS_Far", 50.0, 50.0, "out", smooth=False, centre=(cx, cz))
        sf.cap(square(cx, cz, h0), y0, "BS_Far", up=False)
    sf.cap(square(0.0, 0.0, h1 + g), y1, "BS_Far")
    sf.walls(square(0.0, 0.0, g), 31.0, y1, "BS_FarGlass", 50.0, 50.0)
    root, near_ob, far_ob = finish(L, "TokyoIntlExhibition", near, far, pal)

    meta = {
        "id": "tokyo_intl_exhibition",
        "name": "東京国際展示場 会議棟",
        "lon": origin[0],
        "lat": origin[1],
        "heading": heading,
        "baseHeight": 6.9,
        "height": 58.0,
        "farDistance": 1000,
        "widenFar": False,
        "footprint": log_cut("tokyo_intl_exhibition", hide_footprint("tokyo_intl_exhibition")),
        "plateau": [{"gmlId": "bldg_8794832f-3815-445c-85de-dcb96f5ca6ea", "hide": True}],
        "sources": [L.SOURCES["osm"], L.SOURCES["plateau"]],
        "lightModes": [
            {"id": "lightup", "name": "ライトアップ（逆三角形の照り返しとアトリウム）"},
            {"id": "lightsOut", "name": "消灯後（アトリウムの常夜灯のみ）"},
        ],
        "lightSchedule": {
            "source": "仮定（会議棟の点灯時刻は一次情報で見つからない）",
            "on": "sunset",
            "off": "22:00",
            "after": "lightsOut",
        },
    }
    return root, near_ob, far_ob, pal, meta


# ============================================================================================== 国立競技場
# 最高高さ 47.35 m・軒高 41.46 m（地盤面 TP+25.09 m から、JIA 建築賞）、外形 南北約 350 m・東西約 260 m（JSC）。
# PLATEAU LOD2 sections (long axis on bearing 23.2°): outer wall ±160 x ±124 m, 軒庇 (eaves) tops at
# 14.5 / 25.0 / 31.5 m, roof outer edge ±154 x ±119 m, roof opening 175 x 106 m (= the OSM inner
# ring 177 x 108 m), bowl edge at the field ±94 x ±62 m. Rings are superellipses (exponent 2.4)
# through those semi-axes; +Z runs along the long axis (NNE).
ST_N = 2.4
ST_SEGS = 96
ST_EAVES = [(14.5, 161.0, 126.0), (25.0, 160.0, 125.0), (31.5, 158.0, 123.0)]  # top y, a, b
ST_WALL = (150.0, 116.0)  # the glazed concourse wall behind the eaves, inside the roof edge
ST_ROOF_EDGE = (41.46, 154.0, 119.0)
ST_ROOF_TOP = (47.35, 88.0, 54.0)
ST_FIELD = (96.0, 64.0)


def st_ring(a, b, segs=ST_SEGS):
    return superellipse(a, b, ST_N, segs)


def build_national_stadium(L):
    modes = ["lightup", "lightsOut"]
    pal = L.Palette(modes)
    wood = {"lightup": {"emission": (0.32, 0.22, 0.13, 1), "strength": 1.0, "emit_tex": "mb_stadium_louver.jpg"}}
    pal.add("ST_Louver", wood, color=0xFFFFFF, tex="mb_stadium_louver.jpg", roughness=0.75)
    pal.add("ST_Soffit", {"lightup": lit((0.38, 0.26, 0.15))}, color=0xB98B5E, roughness=0.8)
    pal.add("ST_Green", color=0x4C6E3A, roughness=0.9)
    pal.add(
        "ST_Wall",
        {"lightup": lit((0.09, 0.075, 0.055)), "lightsOut": lit((0.04, 0.035, 0.028))},
        color=0x3E3C38,
        roughness=0.6,
    )
    pal.add("ST_Base", {m: lit((0.05, 0.045, 0.04)) for m in modes}, color=0x9C9890, roughness=0.85)
    pal.add("ST_RoofTop", color=0xBFC2C0, metallic=0.3, roughness=0.5)
    pal.add(
        "ST_RoofUnder", {"lightup": lit((0.35, 0.24, 0.14))}, color=0xC79A6A, tex="mb_stadium_louver.jpg", roughness=0.8
    )
    pal.add("ST_Seats", {"lightup": lit((0.12, 0.12, 0.11))}, color=0xFFFFFF, tex="mb_stadium_seats.jpg", roughness=0.7)
    pal.add("ST_Field", {"lightup": lit((0.04, 0.05, 0.03))}, color=0xFFFFFF, tex="mb_stadium_field.jpg", roughness=0.9)
    pal.add("ST_Concrete", color=0x8E8A84, roughness=0.9)
    lamp = {"emission": (1.0, 0.02, 0.01, 1.0), "strength": 20.0}
    pal.add("ST_AviationLamp", {m: lamp for m in modes}, color=0x601010, roughness=0.3)

    near = L.Builder("NationalStadium_Near")
    s = Shapes(near)
    wa, wb = ST_WALL
    base = st_ring(wa + 4.0, wb + 4.0)
    s.walls(base, -6.0, 4.0, "ST_Base", 6.0, 4.0)
    s.ring_band(base, st_ring(wa, wb), 4.0, "ST_Concrete")
    wall = st_ring(wa, wb)
    s.walls(wall, 4.0, ST_ROOF_EDGE[0], "ST_Wall", 6.0, 4.0)
    for k, (top, a, b) in enumerate(ST_EAVES):
        outer = st_ring(a, b)
        inner = st_ring(wa, wb)
        depth = 2.6 if k < 2 else 3.2
        s.walls(outer, top - depth, top, "ST_Louver", 2.0, 1.0)
        s.ring_band(outer, inner, top, "ST_Green" if k == 2 else "ST_Concrete", up=True)
        s.ring_band(outer, inner, top - depth, "ST_Soffit", up=False)
    # roof: fascia, the sloping top up to the opening, its wooden underside, the inner fascia
    ry, ra, rb = ST_ROOF_EDGE
    ty, ta, tb = ST_ROOF_TOP
    edge_out = st_ring(ra, rb)
    s.walls(edge_out, ry - 1.2, ry + 1.6, "ST_Louver", 2.0, 1.0)
    rings_top = []
    rings_under = []
    for k in range(5):
        f = k / 4
        a = ra + (ta - ra) * f
        b = rb + (tb - rb) * f
        rings_top.append(ring3(st_ring(a, b), ry + 1.6 + (ty - ry - 1.6) * (1 - (1 - f) ** 2)))
        rings_under.append(ring3(st_ring(a, b), ry - 1.2 + (ty - 2.4 - ry + 1.2) * f))
    s.loft(rings_top, "ST_RoofTop", 8.0, 8.0, "up")
    s.loft(rings_under, "ST_RoofUnder", 2.0, 1.0, "down")
    inner_edge = st_ring(ta, tb)
    near.prism(list(reversed(wind_up(inner_edge))), ty - 2.4, ty, "ST_Louver", uv_side=(2.0, 0.0, 1.0))
    # bowl: three tiers of seats from the field to the back wall under the roof
    fa, fb = ST_FIELD
    tiers = [
        ((fa, fb), 1.0, (112.0, 80.0), 9.0),
        ((112.0, 80.0), 11.0, (126.0, 93.0), 21.0),
        ((126.0, 93.0), 23.5, (140.0, 106.0), 36.0),
    ]
    prev_top = None
    for (a0, b0), y0, (a1, b1), y1 in tiers:
        r0 = ring3(st_ring(a0, b0), y0)
        r1 = ring3(st_ring(a1, b1), y1)
        if prev_top:  # the riser (balcony front) between tiers
            s.loft([prev_top, r0], "ST_Concrete", 4.0, 4.0, "in", smooth=False)
        s.loft([r0, r1], "ST_Seats", 8.0, 8.0, "up")
        prev_top = r1
    s.loft([prev_top, ring3(st_ring(146.0, 112.0), ry - 0.3)], "ST_Wall", 6.0, 4.0, "in", smooth=False)
    s.loft([ring3(st_ring(fa, fb), 0.0), ring3(st_ring(fa, fb), 1.0)], "ST_Concrete", 4.0, 4.0, "in", smooth=False)
    field = st_ring(fa, fb)
    pts = [(x, 0.0, z) for x, z in field]
    near.face(pts, "ST_Field", [((z + 100.0) / 200.0, (x + 65.0) / 130.0) for x, _, z in pts])
    for k in range(8):
        t = 2 * math.pi * k / 8
        near.box((rb * math.sin(t) * 0.99, ry + 2.0, ra * math.cos(t) * 0.99), (0.6, 0.6, 0.6), "ST_AviationLamp")

    pal.add("ST_FarWood", {"lightup": lit((0.22, 0.15, 0.085))}, color=0xA87C52, roughness=0.8)
    pal.add("ST_FarRoof", color=0xBFC2C0, roughness=0.6)
    pal.add(
        "ST_FarWall",
        {"lightup": lit((0.1, 0.085, 0.06)), "lightsOut": lit((0.04, 0.035, 0.028))},
        color=0x4A4642,
        roughness=0.7,
    )
    far = L.Builder("NationalStadium_Far")
    sf = Shapes(far)
    seg = 32
    sf.walls(superellipse(wa + 4, wb + 4, ST_N, seg), -6.0, 4.0, "ST_FarWall", 50.0, 50.0)
    sf.walls(superellipse(wa, wb, ST_N, seg), 4.0, ry, "ST_FarWall", 50.0, 50.0)
    for top, a, b in ST_EAVES:
        o = superellipse(a, b, ST_N, seg)
        sf.walls(o, top - 3.0, top, "ST_FarWood", 50.0, 50.0)
        sf.ring_band(o, superellipse(wa, wb, ST_N, seg), top, "ST_FarWood")
    sf.walls(superellipse(ra, rb, ST_N, seg), ry - 1.2, ry + 1.6, "ST_FarWood", 50.0, 50.0)
    sf.loft(
        [ring3(superellipse(ra, rb, ST_N, seg), ry + 1.6), ring3(superellipse(ta, tb, ST_N, seg), ty)],
        "ST_FarRoof",
        50.0,
        50.0,
        "up",
    )
    sf.loft(
        [ring3(superellipse(ta, tb, ST_N, seg), ty), ring3(superellipse(fa, fb, ST_N, seg), 1.0)],
        "ST_FarWall",
        50.0,
        50.0,
        "in",
    )
    root, near_ob, far_ob = finish(L, "NationalStadium", near, far, pal)

    origin = (139.714577, 35.677813)  # centre of the PLATEAU outline (= OSM ring centre ±1.2 m)
    meta = {
        "id": "national_stadium",
        "name": "国立競技場",
        "lon": origin[0],
        "lat": origin[1],
        "heading": 23.2,
        "baseHeight": 25.1,
        "height": 47.35,
        "farDistance": 1200,
        "widenFar": False,
        "footprint": log_cut("national_stadium", hide_footprint("national_stadium")),
        "plateau": [{"gmlId": "bldg_d840231c-8174-4086-9ca6-6417886b0fda", "hide": True}],
        "sources": [L.SOURCES["osm"], L.SOURCES["plateau"]],
        "lightModes": [
            {"id": "lightup", "name": "ライトアップ（軒庇の木の照り返しと外周の明かり）"},
            {"id": "lightsOut", "name": "消灯後（外周の常夜灯のみ）"},
        ],
        "lightSchedule": {
            "source": "仮定（定例の点灯時刻は一次情報で見つからない。催しの日の照明は表していない）",
            "on": "sunset",
            "off": "22:00",
            "after": "lightsOut",
        },
    }
    return root, near_ob, far_ob, pal, meta


BUILDERS = {
    "tokyo_tocho": build_tokyo_tocho,
    "national_diet": build_national_diet,
    "tokyo_intl_exhibition": build_tokyo_intl_exhibition,
    "national_stadium": build_national_stadium,
}

# Five review views per building (eye, target, lens mm, resolution): front, side, oblique from
# above, a pedestrian's eye level, and far away (the far LOD).
PREVIEW_VIEWS = {
    "tokyo_tocho": {
        "front": ((0.0, 1.6, 420.0), (0.0, 120.0, 0.0), 30, (900, 1200)),
        "side": ((420.0, 1.6, 0.0), (0.0, 120.0, 0.0), 30, (900, 1200)),
        "oblique": ((260.0, 320.0, 260.0), (0.0, 120.0, 0.0), 30, (1200, 900)),
        "street": ((40.0, 1.6, 75.0), (0.0, 150.0, 0.0), 18, (900, 1200)),
        "far": ((-1500.0, 40.0, 1700.0), (0.0, 120.0, 0.0), 120, (600, 900)),
    },
    "national_diet": {
        "front": ((0.0, 1.6, 300.0), (0.0, 25.0, 0.0), 35, (1600, 900)),
        "side": ((330.0, 1.6, 20.0), (0.0, 25.0, 20.0), 35, (1600, 900)),
        "oblique": ((180.0, 140.0, 220.0), (0.0, 15.0, 0.0), 30, (1600, 1000)),
        "street": ((-12.0, 1.6, 95.0), (0.0, 25.0, 20.0), 22, (1600, 1000)),
        "far": ((-900.0, 30.0, 1100.0), (0.0, 25.0, 0.0), 90, (1200, 700)),
    },
    "tokyo_intl_exhibition": {
        "front": ((0.0, 1.6, 230.0), (0.0, 28.0, 0.0), 35, (1600, 1000)),
        "side": ((230.0, 1.6, 0.0), (0.0, 28.0, 0.0), 35, (1600, 1000)),
        "oblique": ((150.0, 120.0, 150.0), (0.0, 25.0, 0.0), 30, (1600, 1000)),
        "street": ((10.0, 8.1, 75.0), (0.0, 35.0, 0.0), 20, (1600, 1000)),
        "far": ((-700.0, 30.0, 900.0), (0.0, 28.0, 0.0), 90, (1200, 700)),
    },
    "national_stadium": {
        "front": ((0.0, 1.6, 420.0), (0.0, 20.0, 0.0), 35, (1600, 900)),
        "side": ((380.0, 1.6, 0.0), (0.0, 20.0, 0.0), 35, (1600, 900)),
        "oblique": ((260.0, 260.0, 330.0), (0.0, 10.0, 0.0), 30, (1600, 1000)),
        "street": ((30.0, 1.6, 205.0), (0.0, 20.0, 150.0), 20, (1600, 1000)),
        "far": ((-1000.0, 40.0, 1400.0), (0.0, 20.0, 0.0), 80, (1200, 700)),
    },
}
