# Landmarks (東京タワー・東京スカイツリー・東京駅丸の内駅舎) with their night lighting, for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/landmarks.py -- public/models/<id>.glb [preview-dir]
#
# <id> picks the landmark: tokyo_tower, tokyo_skytree or tokyo_station. One run writes
# public/models/<id>.glb (detailed node <Name>_Near + far node <Name>_Far), public/models/<id>_far.glb
# (the far node alone, for the skyline before the detailed file is needed) and updates this
# landmark's entry in public/data/landmarks.json.
#
# Game coordinates (+Y up, metres, origin on the ground at the landmark's reference point, +Z =
# the landmark's heading, +X = its left), exported with export_yup=False like the vehicle models.
#
# Lighting: every mesh carries its daytime materials Day_<part>. Each night mode <mode> has
# materials Light_<mode>_<part> (same base colour and textures, plus the emissive colour/texture
# of that lighting) for the parts it lights; parts without one stay on Day_<part>. The modes are
# also exported as KHR_materials_variants (variant name = mode), so a viewer that supports
# variants can switch them, and the runtime can equally look the materials up by name.
#
# Lattices are a few beams (legs, chords, main diagonals as thin boxes) plus alpha-masked lacing
# textures (alphaMode MASK) from scripts/textures/landmark_textures.py; no cylinder forests.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "tokyo_tower.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
LANDMARK = os.path.splitext(os.path.basename(OUT))[0]
TEX = os.path.join(ROOT, "assets", "landmarks", "textures")
JSON_PATH = os.path.join(ROOT, "public", "data", "landmarks.json")


def log(event, **fields):
    print(json.dumps({"event": event, "landmark": LANDMARK, **fields}, ensure_ascii=False), flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def lin(hex_color):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (ch((hex_color >> 16) & 255), ch((hex_color >> 8) & 255), ch(hex_color & 255), 1.0)


def scale_rgb(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, 1.0)


# ---------------------------------------------------------------------------------------------- materials
IMAGES = {}


def image(name):
    if name not in IMAGES:
        IMAGES[name] = bpy.data.images.load(os.path.join(TEX, name))
    return IMAGES[name]


def material(
    name,
    color=0xFFFFFF,
    metallic=0.0,
    roughness=0.6,
    tex=None,
    clip=False,
    emission=None,
    strength=1.0,
    emit_tex=None,
    two_sided=None,
    normal_tex=None,
    rough_tex=None,
):
    """Principled material that the glTF exporter maps 1:1.

    color: sRGB hex (baseColorFactor, multiplied with tex when given). clip: tex alpha -> alphaMode
    MASK. emission: linear RGB tuple (emissiveFactor, multiplied with emit_tex when given);
    strength > 1 is written as KHR_materials_emissive_strength. normal_tex: tangent-space normal map
    (OpenGL, +Y up; normalTexture). rough_tex: glTF metallicRoughness packing (G = roughness,
    B = metallic, linear); the factors `roughness` / `metallic` then scale it.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    base = lin(color) if isinstance(color, int) else color
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(tex)
        t.interpolation = "Linear"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(t.outputs["Color"], mix.inputs["A"])
        mix.inputs["B"].default_value = base
        nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
        if clip:
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"  # glTF alphaMode MASK (cutoff 0.5)
            nt.links.new(t.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], b.inputs["Alpha"])
    else:
        b.inputs["Base Color"].default_value = base
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if normal_tex:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = image(normal_tex)
        tn.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if rough_tex:
        tr = nt.nodes.new("ShaderNodeTexImage")
        tr.image = image(rough_tex)
        tr.image.colorspace_settings.name = "Non-Color"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tr.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
    if emission is not None:
        if emit_tex:
            t2 = nt.nodes.new("ShaderNodeTexImage")
            t2.image = image(emit_tex)
            mix2 = nt.nodes.new("ShaderNodeMix")
            mix2.data_type = "RGBA"
            mix2.blend_type = "MULTIPLY"
            mix2.inputs["Factor"].default_value = 1.0
            nt.links.new(t2.outputs["Color"], mix2.inputs["A"])
            mix2.inputs["B"].default_value = emission
            nt.links.new(mix2.outputs["Result"], b.inputs["Emission Color"])
        else:
            b.inputs["Emission Color"].default_value = emission
        b.inputs["Emission Strength"].default_value = strength
    m.use_backface_culling = not (clip if two_sided is None else two_sided)
    return m


class Palette:
    """Day_<part> materials plus their Light_<mode>_<part> variants."""

    def __init__(self, modes):
        self.modes = modes
        self.day = {}
        self.parts = {}

    def add(self, part, lights=None, **day):
        """lights: {mode: dict(emission=..., strength=..., emit_tex=...)} on top of the day look."""
        self.parts[part] = day
        self.day[part] = material(f"Day_{part}", **day)
        for mode, extra in (lights or {}).items():
            assert mode in self.modes, mode
            material(f"Light_{mode}_{part}", **{**day, **extra})
        return part

    def light(self, mode, part):
        return bpy.data.materials.get(f"Light_{mode}_{part}")


# ---------------------------------------------------------------------------------------------- mesh builder
class Builder:
    """bmesh with named materials and one UV map ("UVMap"), Y-up game coordinates."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []
        self.smooth = []

    def mi(self, part):
        if part not in self.mats:
            self.mats.append(part)
        return self.mats.index(part)

    def face(self, pts, part, uvs=None, smooth=False):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = self.mi(part)
        if uvs:
            for loop, uv in zip(f.loops, uvs, strict=True):
                loop[self.uv].uv = uv
        f.smooth = smooth
        return f

    def grid(self, rows, part, uv=None, smooth=True, closed=False, flip=False):
        """Surface through rows of points (each row a ring/strip), sharing vertices for smooth normals.

        uv(i, j) -> (u, v) per vertex; closed rings duplicate the seam column so UVs can wrap.
        """
        n = len(rows[0])
        cols = n + 1 if closed else n
        verts = []
        for row in rows:
            verts.append([self.bm.verts.new(row[j % n]) for j in range(cols)])
        idx = self.mi(part)
        for i in range(len(rows) - 1):
            for j in range(cols - 1):
                quad = [verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j]]
                if flip:
                    quad.reverse()
                f = self.bm.faces.new(quad)
                f.material_index = idx
                f.smooth = smooth
                if uv:
                    ij = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
                    if flip:
                        ij.reverse()
                    for loop, (a, b) in zip(f.loops, ij, strict=True):
                        loop[self.uv].uv = uv(a, b)
        return verts

    def box(self, center, size, part, uv_scale=None):
        cx, cy, cz = center
        sx, sy, sz = (s / 2 for s in size)
        c = [(cx + dx * sx, cy + dy * sy, cz + dz * sz) for dx, dy, dz in BOX_CORNERS]
        for fi in BOX_FACES:
            pts = [c[i] for i in fi]
            uvs = None
            if uv_scale:
                uvs = planar_uvs(pts, uv_scale)
            self.face(pts, part, uvs)

    def beam(self, p0, p1, width, depth, part, normal=(0, 0, 1), caps=False):
        """Rectangular member from p0 to p1; width lies in the plane normal to `normal`."""
        a, b = Vector(p0), Vector(p1)
        t = (b - a).normalized()
        n = Vector(normal).normalized()
        side = n.cross(t)
        if side.length < 1e-6:
            side = t.orthogonal()
        side.normalize()
        up = t.cross(side).normalized()
        hw, hd = side * (width / 2), up * (depth / 2)
        ring = [lambda p: p - hw - hd, lambda p: p + hw - hd, lambda p: p + hw + hd, lambda p: p - hw + hd]
        ra = [f(a) for f in ring]
        rb = [f(b) for f in ring]
        for k in range(4):
            j = (k + 1) % 4
            self.face([ra[k], ra[j], rb[j], rb[k]], part)
        if caps:
            self.face(list(reversed(ra)), part)
            self.face(rb, part)

    def prism(self, outline, y0, y1, part, uv_side=None, cap_top=None, cap_bottom=None, smooth=False):
        """Vertical prism over an outline (x, z) wound like regular() (a +Y-facing cap), walls outward.

        uv_side = (metres per u, y0 for v=0, metres per v) maps the walls in world units.
        """
        n = len(outline)
        dist = 0.0
        for k in range(n):
            (x0, z0), (x1, z1) = outline[k], outline[(k + 1) % n]
            seg = math.hypot(x1 - x0, z1 - z0)
            pts = [(x0, y0, z0), (x1, y0, z1), (x1, y1, z1), (x0, y1, z0)]
            uvs = None
            if uv_side:
                mu, vy0, mv = uv_side
                u0, u1 = dist / mu, (dist + seg) / mu
                uvs = [(u0, (y0 - vy0) / mv), (u1, (y0 - vy0) / mv), (u1, (y1 - vy0) / mv), (u0, (y1 - vy0) / mv)]
            self.face(pts, part, uvs, smooth)
            dist += seg
        if cap_top:
            self.face([(x, y1, z) for x, z in outline], cap_top)
        if cap_bottom:
            self.face([(x, y0, z) for x, z in reversed(outline)], cap_bottom)

    def finish(self, palette, parent=None):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for part in self.mats:
            me.materials.append(palette.day[part])
        ob = bpy.data.objects.new(self.name, me)
        SCENE.collection.objects.link(ob)
        if parent:
            ob.parent = parent
        return ob


BOX_CORNERS = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]


def planar_uvs(pts, scale):
    """World-unit UVs for a planar face: u along its dominant horizontal axis, v = height."""
    p = [Vector(q) for q in pts]
    n = (p[1] - p[0]).cross(p[2] - p[0])
    if abs(n.y) > max(abs(n.x), abs(n.z)):  # horizontal face
        return [(q.x / scale, q.z / scale) for q in p]
    horiz = Vector((-n.z, 0.0, n.x)).normalized()
    return [(q.dot(horiz) / scale, q.y / scale) for q in p]


# Outlines in (x, z) are wound so that a face through them points +Y (angle decreasing in x-z).
SQUARE = ((1, -1), (-1, -1), (-1, 1), (1, 1))


def rect(hx, hz, cx=0.0, cz=0.0):
    return [(cx + dx * hx, cz + dz * hz) for dx, dz in SQUARE]


def regular(n, r, phase=0.0):
    """Regular polygon in (x, z), wound for a +Y-facing cap."""
    return [(r * math.cos(phase - 2 * math.pi * k / n), r * math.sin(phase - 2 * math.pi * k / n)) for k in range(n)]


def chamfered_square(half, cut):
    pts = [(half, -half + cut), (half, half - cut), (half - cut, half), (-half + cut, half)]
    pts += [(-half, half - cut), (-half, -half + cut), (-half + cut, -half), (half - cut, -half)]
    return list(reversed(pts))


def pchip(xs, ys):
    """Monotone cubic interpolation (Fritsch–Carlson) through (xs, ys)."""
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0] * (n - 2) + [d[-1]]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1])
            w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1])
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0] + m[0] * (x - xs[0])
        if x >= xs[-1]:
            return ys[-1] + m[-1] * (x - xs[-1])
        for i in range(n - 1):
            if xs[i] <= x <= xs[i + 1]:
                h = xs[i + 1] - xs[i]
                t = (x - xs[i]) / h
                h00 = 2 * t**3 - 3 * t**2 + 1
                h10 = t**3 - 2 * t**2 + t
                h01 = -2 * t**3 + 3 * t**2
                h11 = t**3 - t**2
                return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
        return ys[-1]

    return f


# ---------------------------------------------------------------------------------------------- geo helpers
M_LAT = 110_540.0


def m_lon(lat):
    return 111_320.0 * math.cos(math.radians(lat))


def offset_lonlat(lon, lat, east, north):
    return lon + east / m_lon(lat), lat + north / M_LAT


def model_to_lonlat(origin, heading_deg, x, z):
    """Model (x, z) -> lon/lat; +Z points to `heading_deg` (bearing), +X is 90° to its left."""
    h = math.radians(heading_deg)
    fwd = (math.sin(h), math.cos(h))  # (east, north)
    left = (-math.cos(h), math.sin(h))
    east = z * fwd[0] + x * left[0]
    north = z * fwd[1] + x * left[1]
    return offset_lonlat(origin[0], origin[1], east, north)


# Footprints from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0), fetched with Overpass on
# 2026-10-04 and simplified (Douglas–Peucker ≤ 0.5–1.2 m): convex hull of the four leg ways
# 1244967004–1244967007 (東京タワー), way 288269147 (東京スカイツリー), relation 4856156 (東京駅丸の内駅舎).
OSM_FOOTPRINT = {
    "tokyo_tower": [
        [139.7447743, 35.6584863],
        [139.7448307, 35.6584538],
        [139.7448353, 35.6584512],
        [139.7455787, 35.6580375],
        [139.7456191, 35.6580837],
        [139.7456223, 35.6580874],
        [139.7461575, 35.6587067],
        [139.7460964, 35.6587419],
        [139.7453075, 35.6591393],
        [139.7452672, 35.659093],
        [139.745264, 35.6590893],
    ],
    "tokyo_skytree": [
        [139.8106804, 35.7102983],
        [139.810763, 35.7102967],
        [139.8108039, 35.7102891],
        [139.81088, 35.7102612],
        [139.810914, 35.7102413],
        [139.8109706, 35.7101914],
        [139.8109923, 35.7101623],
        [139.811009, 35.7101311],
        [139.8110264, 35.7100648],
        [139.8110268, 35.7100308],
        [139.8110109, 35.7099641],
        [139.8109734, 35.7099028],
        [139.8109182, 35.7098525],
        [139.8108846, 35.7098321],
        [139.8108091, 35.7098031],
        [139.8107684, 35.709795],
        [139.8107268, 35.7097913],
        [139.8106436, 35.7097976],
        [139.8105654, 35.7098216],
        [139.81053, 35.7098397],
        [139.8104978, 35.7098615],
        [139.8104457, 35.7099143],
        [139.8104266, 35.7099445],
        [139.8104039, 35.7100098],
        [139.8104114, 35.710111],
        [139.8104435, 35.7101736],
        [139.810467, 35.7102018],
        [139.8104949, 35.7102272],
        [139.8105618, 35.7102677],
        [139.8106385, 35.7102923],
    ],
    "tokyo_station": [
        [139.7666045, 35.682479],
        [139.7665507, 35.6823372],
        [139.7665818, 35.6822824],
        [139.7666169, 35.6822771],
        [139.766547, 35.682084],
        [139.7665157, 35.6820945],
        [139.7664487, 35.6820681],
        [139.7659042, 35.6806317],
        [139.7659404, 35.6805775],
        [139.765974, 35.68057],
        [139.7659093, 35.6803879],
        [139.7658667, 35.6803917],
        [139.7658037, 35.6803666],
        [139.7657578, 35.6802455],
        [139.7659399, 35.6799597],
        [139.7659291, 35.6799378],
        [139.7659516, 35.6799003],
        [139.7659025, 35.679882],
        [139.7659289, 35.6798372],
        [139.7659158, 35.6797869],
        [139.7658886, 35.6797686],
        [139.7658192, 35.6797655],
        [139.765515, 35.6802104],
        [139.7654887, 35.6802144],
        [139.7654739, 35.6802407],
        [139.7654846, 35.6802682],
        [139.7655227, 35.6802765],
        [139.7655507, 35.6803522],
        [139.7655394, 35.6803632],
        [139.765424, 35.6803152],
        [139.7653085, 35.6804889],
        [139.7654075, 35.6807482],
        [139.7656221, 35.6808396],
        [139.7656855, 35.6807425],
        [139.7656975, 35.6807476],
        [139.7657885, 35.6809724],
        [139.7657604, 35.6809806],
        [139.7657939, 35.681068],
        [139.7658174, 35.6810617],
        [139.7659398, 35.681374],
        [139.7658522, 35.6813967],
        [139.7658751, 35.6814549],
        [139.7659625, 35.6814322],
        [139.7661944, 35.6820431],
        [139.7661763, 35.6820651],
        [139.7660678, 35.6820222],
        [139.7659565, 35.6821981],
        [139.7660568, 35.6824555],
        [139.7662677, 35.6825481],
        [139.7663422, 35.6824302],
        [139.7663801, 35.6825331],
        [139.7663526, 35.6825606],
        [139.766365, 35.6825894],
        [139.7663953, 35.6826015],
        [139.7664307, 35.6825938],
        [139.7664394, 35.6825532],
        [139.7665796, 35.6825181],
        [139.7666124, 35.6825424],
        [139.7666432, 35.6825361],
        [139.7666467, 35.6824886],
    ],
}
SOURCES = {
    "osm": "© OpenStreetMap contributors (ODbL 1.0)",
    "plateau": "出典：国土交通省 PLATEAU 3D都市モデル（LOD2）を加工して作成（PDL1.0）",
}


# ============================================================================================== 東京タワー
# Heights above ground (GL = T.P. 18.0 m). Sources: Wikipedia ja「東京タワー」(rev 111232845) for 333 m,
# leg spacing 88.0 m, decks at 125 m / 223.55 m above GL (the operator's "150 m / 250 m" are rounded
# heights above sea level), the 7 equal 昼間障害標識 bands above the main deck (11 until 1986), the
# 13 m x 11 m cylindrical digital antenna; PLATEAU LOD2 (bldg_7aff4a51…) for the envelope and the
# FootTown (47 x 76 x 23.5 m); OSM ways 1244967004–7 for the leg positions.
TT = {
    "height": 333.0,
    "deck": (117.0, 131.0),
    "band_base": 131.0,
    "bands": 7,
    "body_top": 252.65,
    "radome": (241.3, 252.4, 6.6),
    "top_deck": (223.55, 229.0),
}
TT_HALF = pchip(
    [0, 10, 20, 30, 40, 50, 60, 80, 100, 117, 131, 140, 160, 200, 220, 252.65],
    [44.0, 40.6, 35.9, 30.4, 25.1, 21.9, 19.3, 14.0, 11.2, 8.8, 8.5, 8.1, 6.7, 4.3, 3.1, 2.4],
)


def tt_leg_width(h):
    return 1.4 + 5.4 * math.exp(-h / 45.0)


def tt_band_white(h):
    if h < TT["band_base"]:
        return False
    k = int((h - TT["band_base"]) / ((TT["height"] - TT["band_base"]) / TT["bands"]))
    return min(k, TT["bands"] - 1) % 2 == 1


TT_BAND_EDGES = [TT["band_base"] + k * (TT["height"] - TT["band_base"]) / TT["bands"] for k in range(TT["bands"] + 1)]
TT_LOW_LEVELS = [40.0, 53.0, 65.0, 76.0, 87.0, 99.0, 105.0, 117.0]
TT_UP_LEVELS = [131.0 + k * (TT_BAND_EDGES[1] - TT_BAND_EDGES[0]) / 3 for k in range(13)] + [TT["body_top"]]
TT_TRUSS = {53.0, 65.0, 76.0, 87.0, 99.0}  # levels built as a pair of chords 4.5 m apart (photos)
TT_DIAMOND_TIERS = [40, 53, 65, 76, 87, 99, 110, 141, 158, 175, 192, 209, 226, 236, 246, 276, 304]

TT_MONTH_COLORS = [
    "#FFFF00",
    "#FF007E",
    "#FCC2E8",
    "#AAFF00",
    "#07FDF8",
    "#857EFF",
    "#0080FF",
    "#00FFB6",
    "#B100CB",
    "#FF7E00",
    "#FB0200",
    "#00FF00",
]
TT_DIAMOND_DEFAULT = lin(0x0080FF)  # 7月 Sea Blue; the runtime may set the month's colour


def build_tokyo_tower():
    modes = ["landmarkWinter", "landmarkSummer", "diamond", "lightsOut"]
    pal = Palette(modes)
    orange, white = 0xE9572B, 0xF2F2EC

    def flood(color, k, tex=None):
        return {"emission": scale_rgb(color, k), "strength": 1.0, "emit_tex": tex}

    def lattice_lights(base_hex, tex=None, k=1.0):
        # Perceived colour of floodlit paint (not albedo x lamp: sodium on the orange paint reads as
        # deep orange-gold, on the white bands as amber; metal halide keeps the bands apart).
        is_white = base_hex == white
        winter = (1.0, 0.60, 0.22, 1.0) if is_white else (1.0, 0.34, 0.06, 1.0)
        summer = (0.80, 0.86, 1.0, 1.0) if is_white else (1.0, 0.40, 0.20, 1.0)
        return {
            "landmarkWinter": flood(winter, 1.25 * k, tex),
            "landmarkSummer": flood(summer, 1.05 * k, tex),
            "diamond": flood(TT_DIAMOND_DEFAULT, 0.5 * k, tex),
        }

    pal.add("TT_Orange", lattice_lights(orange), color=orange, roughness=0.55)
    pal.add("TT_White", lattice_lights(white), color=white, roughness=0.55)
    pal.add("TT_OrangeLace", lattice_lights(orange, "tt_lacing.png", 0.8), color=orange, tex="tt_lacing.png", clip=True)
    pal.add("TT_WhiteLace", lattice_lights(white, "tt_lacing.png", 0.8), color=white, tex="tt_lacing.png", clip=True)
    pal.add("TT_OrangeLeg", lattice_lights(orange, "tt_leg.png", 1.1), color=orange, tex="tt_leg.png", clip=True)
    pal.add("TT_WhiteLeg", lattice_lights(white, "tt_leg.png", 1.1), color=white, tex="tt_leg.png", clip=True)
    deck_night = {"emission": (1.0, 1.0, 1.0, 1.0), "strength": 1.6, "emit_tex": "tt_deck_night.png"}
    pal.add(
        "TT_Deck",
        {"landmarkWinter": deck_night, "landmarkSummer": deck_night, "diamond": deck_night},
        color=0xFFFFFF,
        tex="tt_deck.png",
        roughness=0.35,
    )
    deck_wall = {
        "landmarkWinter": flood(lin(0xF2F2EC), 0.9),
        "landmarkSummer": flood(lin(0xF2F2EC), 0.9),
        "diamond": flood(lin(0xF2F2EC), 0.5),
    }
    pal.add("TT_DeckWall", deck_wall, color=0xEDEDE8, roughness=0.5)
    pal.add("TT_Roof", color=0x8C8F92, roughness=0.8)
    ft_night = {"emission": (1.0, 1.0, 1.0, 1.0), "strength": 1.2, "emit_tex": "tt_foottown_night.png"}
    pal.add(
        "TT_FootTown",
        {"landmarkWinter": ft_night, "landmarkSummer": ft_night, "diamond": ft_night},
        color=0xFFFFFF,
        tex="tt_foottown.png",
        roughness=0.6,
    )
    pal.add("TT_Core", color=0x6E7A84, metallic=0.3, roughness=0.3)
    pal.add(
        "TT_Fixture",
        {"diamond": {"emission": TT_DIAMOND_DEFAULT, "strength": 12.0}},
        color=0x50555A,
        roughness=0.4,
    )
    sparkle = {"emission": (1.0, 1.0, 1.0, 1.0), "strength": 4.0}
    pal.add("TT_Tiara", {"diamond": sparkle}, color=0xC8CCD0, metallic=0.6, roughness=0.3)
    lamp = {"emission": (1.0, 0.02, 0.01, 1.0), "strength": 20.0}
    pal.add("TT_AviationLamp", {m: lamp for m in modes}, color=0x601010, roughness=0.3)

    near = Builder("TokyoTower_Near")
    s = TT_HALF

    def lattice_part(kind, h):
        white_ = tt_band_white(h)
        return {
            "solid": "TT_White" if white_ else "TT_Orange",
            "lace": "TT_WhiteLace" if white_ else "TT_OrangeLace",
            "leg": "TT_WhiteLeg" if white_ else "TT_OrangeLeg",
        }[kind]

    # Faces: +Z, -X, -Z, +X; a face is spanned by its two corner legs. corner(face, side, h) gives the
    # leg centre-line point; side -1/+1 walks along the face.
    faces = [
        ((0, 0, 1), (1, 0, 0)),
        ((-1, 0, 0), (0, 0, 1)),
        ((0, 0, -1), (-1, 0, 0)),
        ((1, 0, 0), (0, 0, -1)),
    ]

    def corner(face, side, h):
        n, t = faces[face]
        a = s(h)
        return Vector((n[0] * a + side * t[0] * a, h, n[2] * a + side * t[2] * a))

    # ---- legs (corner chords), from the ground to the top of the body
    leg_levels = sorted(
        set(
            [0, 3, 6, 10, 14, 19, 24, 30, 35]
            + TT_LOW_LEVELS
            + TT_UP_LEVELS
            + [h for h in TT_BAND_EDGES if h < TT["body_top"]]
            + [118, 124, 131]
        )
    )
    for cx in (-1, 1):
        for cz in (-1, 1):
            rings = []
            for h in leg_levels:
                a = s(h)
                w = tt_leg_width(h) / 2
                c = (cx * a, h, cz * a)
                rings.append([(c[0] + dx * w, h, c[2] + dz * w) for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
            vacc = 0.0
            for i in range(len(rings) - 1):
                h0, h1 = leg_levels[i], leg_levels[i + 1]
                part = lattice_part("leg", (h0 + h1) / 2)
                lw = tt_leg_width((h0 + h1) / 2)
                dv = math.dist(rings[i][0], rings[i + 1][0]) / (2 * lw)
                for k in range(4):
                    j = (k + 1) % 4
                    quad = [rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]]
                    near.face(quad, part, [(0, vacc), (1, vacc), (1, vacc + dv), (0, vacc + dv)])
                vacc += dv

    # ---- horizontals, main diagonals and lacing panels per face
    def inner(face, side, h):
        """Point on the face between the legs, pulled in from the leg centre by half a leg width."""
        n, t = faces[face]
        p = corner(face, side, h)
        return p - Vector(t) * side * (tt_leg_width(h) * 0.45)

    panels = list(zip(TT_LOW_LEVELS[:-2], TT_LOW_LEVELS[1:-1], strict=True))
    panels += list(zip(TT_UP_LEVELS, TT_UP_LEVELS[1:], strict=False))
    for f, (n, t) in enumerate(faces):
        nv = Vector(n)
        for h in TT_LOW_LEVELS + TT_UP_LEVELS:
            if TT["deck"][0] < h < TT["deck"][1]:
                continue
            heavy = h <= TT["deck"][1]
            part = lattice_part("solid", h + 0.01)
            chords = [h, h - 4.5] if h in TT_TRUSS else [h]
            for hc in chords:
                near.beam(inner(f, -1, hc), inner(f, 1, hc), 0.9 if heavy else 0.55, 0.7, part, n)
        for lo, hi in panels:
            part = lattice_part("solid", (lo + hi) / 2)
            wdt = 1.0 if hi <= TT["deck"][1] else 0.6
            near.beam(inner(f, -1, lo), inner(f, 1, hi), wdt, 0.7, part, n)
            near.beam(inner(f, 1, lo), inner(f, -1, hi), wdt, 0.7, part, n)
            # lacing: a strip of quads just inside the face, world-unit UVs (4 m tiles)
            lace = lattice_part("lace", (lo + hi) / 2)
            cols = max(2, int(2 * s(lo) / 8) + 1)
            rows = [
                [inner(f, -1, hh).lerp(inner(f, 1, hh), c / cols) - nv * 0.2 for c in range(cols + 1)]
                for hh in (lo, hi)
            ]
            for c in range(cols):
                quad = [rows[0][c], rows[0][c + 1], rows[1][c + 1], rows[1][c]]
                uvs = [(q.dot(Vector(t)) / 4.0, q.y / 4.0) for q in quad]
                near.face(quad, lace, uvs)
        # ---- base arch (truss) from leg to leg under the 40 m level
        spring = 8.0
        steps = 18
        arch = []
        for k in range(steps + 1):
            u = -1 + 2 * k / steps
            hh = spring + (40.0 - 2.4 - spring) * math.sqrt(max(0.0, 1 - u * u))
            p0 = inner(f, -1, hh)
            p1 = inner(f, 1, hh)
            arch.append(p0.lerp(p1, (u + 1) / 2))
        top = []
        for k in range(steps + 1):
            u = -1 + 2 * k / steps
            hh = spring + 3.2 + (40.0 - 0.6 - spring - 3.2) * math.sqrt(max(0.0, 1 - u * u)) ** 0.7
            top.append(inner(f, -1, hh).lerp(inner(f, 1, hh), (u + 1) / 2))
        for k in range(steps):
            near.beam(arch[k], arch[k + 1], 1.3, 1.0, "TT_Orange", n)
            near.beam(top[k], top[k + 1], 0.8, 0.8, "TT_Orange", n)
            if k % 3 == 0:
                near.beam(arch[k], top[k + 1], 0.5, 0.5, "TT_Orange", n)
            # lacing between the arch's chords and up to the 40 m horizontal
            quad = [arch[k], arch[k + 1], top[k + 1], top[k]]
            near.face(
                [q - nv * 0.2 for q in quad], "TT_OrangeLace", [(q.dot(Vector(t)) / 4.0, q.y / 4.0) for q in quad]
            )
            h40 = [inner(f, -1, 40.0).lerp(inner(f, 1, 40.0), j / steps) for j in (k, k + 1)]
            quad = [top[k], top[k + 1], h40[1], h40[0]]
            if (h40[0].y - top[k].y) > 0.5:
                near.face(
                    [q - nv * 0.2 for q in quad], "TT_OrangeLace", [(q.dot(Vector(t)) / 4.0, q.y / 4.0) for q in quad]
                )

    # ---- main deck, rooms above/below it, cores
    d0, d1 = TT["deck"]
    deck = chamfered_square(14.7, 4.4)
    near.prism(deck, d0, d1, "TT_Deck", uv_side=(8.0, d0, d1 - d0), cap_top="TT_Roof", cap_bottom="TT_Roof")
    near.prism(chamfered_square(8.2, 1.5), d1, d1 + 8.0, "TT_DeckWall", cap_top="TT_Roof")
    near.prism(chamfered_square(8.6, 1.0), 105.0, d0, "TT_Orange", cap_bottom="TT_Roof")
    near.box((0.0, 64.0, 0.0), (6.0, 82.0, 4.5), "TT_Core")  # elevator shaft FootTown roof -> deck
    near.box((4.6, 70.0, 1.0), (2.4, 93.0, 2.4), "TT_Orange")  # stair tower
    near.box((0.0, 181.0, 0.0), (2.6, 85.0, 2.6), "TT_Core")  # lift to the top deck
    near.prism(regular(16, 15.2), d1 - 0.1, d1 + 0.5, "TT_Tiara")  # ダイヤモンド・チョーカー
    # ---- top deck, digital-antenna cylinder (radome), antenna mast and rod
    t0, t1 = TT["top_deck"]
    near.prism(
        regular(16, 6.2), t0, t1, "TT_Deck", uv_side=(8.0, t0 - 2.0, 14.0), cap_bottom="TT_Roof", cap_top="TT_Roof"
    )
    near.prism(regular(16, 6.9), t0 + 2.2, t0 + 2.6, "TT_White", cap_top="TT_White", cap_bottom="TT_White")
    near.prism(regular(16, 6.6), t1 + 0.2, t1 + 0.7, "TT_Tiara")
    r0, r1, rr = TT["radome"]
    ring_levels = [r0 + (r1 - r0) * k / 7 for k in range(8)]
    for k in range(7):
        a, b = ring_levels[k], ring_levels[k + 1]
        part = "TT_White" if tt_band_white((a + b) / 2) else "TT_Orange"
        near.prism(regular(24, rr), a + 0.25, b - 0.25, part, smooth=True)
        near.prism(regular(24, rr - 0.35), a - 0.25, a + 0.25, "TT_Roof")
    near.face([(x, r1, z) for x, z in regular(24, rr)], "TT_Orange")
    near.face([(x, r0 - 0.25, z) for x, z in reversed(regular(24, rr))], "TT_White")

    def mast(y0, y1, w0, w1):
        """Square lattice tube (leg texture) from y0 to y1, split at band edges."""
        cuts = sorted({y0, y1, *[e for e in TT_BAND_EDGES if y0 < e < y1]})
        v = 0.0
        for a, b in zip(cuts, cuts[1:], strict=False):
            wa = w0 + (w1 - w0) * (a - y0) / (y1 - y0)
            wb = w0 + (w1 - w0) * (b - y0) / (y1 - y0)
            part = "TT_WhiteLeg" if tt_band_white((a + b) / 2) else "TT_OrangeLeg"
            ra = [(dx * wa / 2, a, dz * wa / 2) for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            rb = [(dx * wb / 2, b, dz * wb / 2) for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            dv = (b - a) / (wa + wb)
            for k in range(4):
                j = (k + 1) % 4
                near.face([ra[k], ra[j], rb[j], rb[k]], part, [(0, v), (1, v), (1, v + dv), (0, v + dv)])
            v += dv

    mast(TT["body_top"], 258.0, 8.6, 5.4)
    mast(258.0, 304.14, 5.4, 4.4)
    mast(304.14, 314.0, 3.8, 3.2)
    for y in (258.0, 275.29, 290.0, 304.14, 314.0):  # platforms
        w = 5.8 if y < 304 else 4.0
        near.box((0.0, y, 0.0), (w, 0.4, w), "TT_White" if tt_band_white(y + 0.1) else "TT_Orange")
    near.prism(regular(8, 0.42), 314.0, TT["height"], "TT_Orange", cap_top="TT_Orange", smooth=True)

    # ---- FootTown (5 storeys) under the tower, long axis along Z
    near.prism(rect(23.5, 38.0), 0.0, 23.5, "TT_FootTown", uv_side=(8.0, 0.0, 23.5), cap_top="TT_Roof")
    near.prism(rect(22.5, 37.0), 23.5, 24.4, "TT_Roof")
    for x, z, w, d, hgt in ((-10, -20, 12, 10, 4.0), (8, 15, 16, 8, 3.0)):  # roof plant rooms
        near.box((x, 23.5 + hgt / 2, z), (w, hgt, d), "TT_Roof")

    # ---- Diamond Veil fixtures (17 tiers, 4 per face on the body) and aviation lamps
    for tier in TT_DIAMOND_TIERS:
        if tier <= TT["body_top"] and not (t0 - 1 < tier < t1 + 1) and not (r0 - 1 < tier < r1 + 1):
            for f, (n, _t) in enumerate(faces):
                for u in (-0.6, -0.2, 0.2, 0.6):
                    p = inner(f, -1, tier).lerp(inner(f, 1, tier), (u + 1) / 2) + Vector(n) * 0.75
                    near.box(tuple(p + Vector((0, 0.55, 0))), (0.7, 0.45, 0.7), "TT_Fixture")
        else:
            r = (rr if r0 - 1 < tier < r1 + 1 else 6.9 if tier < 240 else 3.0) + 0.4
            for x, z in regular(16, r):
                near.box((x, tier, z), (0.6, 0.45, 0.6), "TT_Fixture")
    for y, r in (
        (TT["height"], 0.0),
        (314.2, 2.0),
        (304.4, 2.6),
        (r1 + 0.3, rr - 0.3),
        (t1 + 0.9, 6.0),
        (d1 + 8.2, 8.0),
    ):
        pts = [(0.0, 0.0)] if r == 0 else [(r, 0.0), (-r, 0.0), (0.0, r), (0.0, -r)]
        for x, z in pts:
            near.box((x, y + 0.3, z), (0.6, 0.6, 0.6), "TT_AviationLamp")

    root = bpy.data.objects.new("TokyoTower", None)
    SCENE.collection.objects.link(root)
    near_ob = near.finish(pal, root)

    # ---------------------------------------------------------------- far LOD (one material, ~300 tris)
    far_lights = {
        "landmarkWinter": {"emission": (1.0, 1.0, 1.0, 1.0), "strength": 1.3, "emit_tex": "tt_far_winter.png"},
        "landmarkSummer": {"emission": (1.0, 1.0, 1.0, 1.0), "strength": 1.1, "emit_tex": "tt_far_summer.png"},
        "diamond": {"emission": scale_rgb(TT_DIAMOND_DEFAULT, 2.0), "strength": 1.0, "emit_tex": "tt_far_tiers.png"},
    }
    pal.add("TT_Far", far_lights, color=0xFFFFFF, tex="tt_far.png", clip=True, roughness=0.6)
    lamp_far = Builder("TokyoTower_Far")
    H = TT["height"]

    def vy(h):
        return h / H

    far_levels = [40, 60, 80, 100, 117]
    far_cuts = far_levels + [131, 160, 200, 230, TT["body_top"]]
    for f in range(len(faces)):  # body faces between the leg centre lines, from 40 m up
        for lo, hi in zip(far_cuts, far_cuts[1:], strict=False):
            if lo == 117:
                continue
            q = [corner(f, -1, lo), corner(f, 1, lo), corner(f, 1, hi), corner(f, -1, hi)]
            lamp_far.face(q, "TT_Far", [(0, vy(lo)), (1, vy(lo)), (1, vy(hi)), (0, vy(hi))])
    for cx in (-1, 1):  # legs below the arch, as tapered square posts
        for cz in (-1, 1):
            hs = [0, 15, 40]
            rings = [
                [(cx * s(h) + dx * tt_leg_width(h) / 2, h, cz * s(h) + dz * tt_leg_width(h) / 2) for dx, dz in SQUARE]
                for h in hs
            ]
            for i in range(2):
                for k in range(4):
                    j = (k + 1) % 4
                    q = [rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]]
                    lamp_far.face(
                        q,
                        "TT_Far",
                        [(0.02, vy(hs[i])), (0.05, vy(hs[i])), (0.05, vy(hs[i + 1])), (0.02, vy(hs[i + 1]))],
                    )
    lamp_far.prism(
        chamfered_square(14.7, 4.4), d0, d1, "TT_Far", uv_side=(29.4, 0.0, H), cap_top="TT_Far", cap_bottom="TT_Far"
    )
    lamp_far.prism(regular(8, 6.4), t0, t1, "TT_Far", uv_side=(10.0, 0.0, H))
    lamp_far.prism(regular(8, rr), r0, r1, "TT_Far", uv_side=(10.0, 0.0, H), cap_top="TT_Far")
    for a, b, wa, wb in ((TT["body_top"], 314.0, 5.4, 3.4), (314.0, H, 0.9, 0.5)):
        ra = [(dx * wa / 2, a, dz * wa / 2) for dx, dz in SQUARE]
        rb = [(dx * wb / 2, b, dz * wb / 2) for dx, dz in SQUARE]
        for k in range(4):
            j = (k + 1) % 4
            lamp_far.face(
                [ra[k], ra[j], rb[j], rb[k]], "TT_Far", [(0.3, vy(a)), (0.7, vy(a)), (0.7, vy(b)), (0.3, vy(b))]
            )
    lamp_far.prism(rect(23.5, 38.0), 0.0, 23.5, "TT_FootTownFar", cap_top="TT_FootTownFar")
    pal.add(
        "TT_FootTownFar", {m: {"emission": (0.9, 0.7, 0.45, 1.0), "strength": 0.25} for m in modes[:3]}, color=0x58402F
    )
    far_ob = lamp_far.finish(pal, root)

    origin = (139.745450, 35.658592)  # centre of the four legs (OSM leg ways), = PLATEAU LOD1 centroid ±2 m
    heading = 124.5  # +Z: normal of the face toward 増上寺 side (SE); faces at 34.5/124.5/214.5/304.5°
    meta = {
        "id": "tokyo_tower",
        "name": "東京タワー",
        "lon": origin[0],
        "lat": origin[1],
        "heading": heading,
        "baseHeight": 18.5,
        "height": TT["height"],
        "farDistance": 1500,
        "footprint": OSM_FOOTPRINT["tokyo_tower"],
        "plateau": [{"gmlId": "bldg_7aff4a51-be8b-405b-abe4-ac489697cbc8", "hide": True}],
        "sources": [SOURCES["osm"], SOURCES["plateau"]],
        "lightModes": [
            {"id": "landmarkWinter", "name": "ランドマークライト（冬・高圧ナトリウム）"},
            {"id": "landmarkSummer", "name": "ランドマークライト（夏・メタルハライド）"},
            {"id": "diamond", "name": "インフィニティ・ダイヤモンドヴェール", "colorByMonth": TT_MONTH_COLORS},
            {"id": "lightsOut", "name": "消灯（航空障害灯のみ）"},
        ],
        "lightSchedule": {
            "source": "https://www.tokyotower.co.jp/lightup/ (2026-10-04)",
            "on": "sunset",
            "off": "24:00",
            "rules": [
                {"mode": "landmarkSummer", "fromDate": "07-07", "toDate": "10-01"},
                {"mode": "landmarkWinter", "fromDate": "10-02", "toDate": "07-06"},
                {"mode": "diamond", "weekdays": [1, 4], "from": "20:00", "to": "22:00"},
            ],
            "after": "lightsOut",
        },
    }
    return root, near_ob, far_ob, pal, meta


# ============================================================================================== 東京スカイツリー
# Heights above ground. Sources: the operator's outline page (634 m, base 約 68 m, decks 350 / 450 m);
# Wikipedia ja「東京スカイツリー」(rev 110955133): triangle at the ground rounding to a circle at H320,
# 心柱 Ø 約 8 m to H375, gain tower Ø 約 6 m (antenna Ø 約 8 m) from H497, the colour スカイツリーホワイト;
# PLATEAU LOD2 (bldg_58ab8c46…) for the face line (inradius ≈ 18 m) and corner radii; the deck and
# Galleria profiles measured on Wikimedia Commons photos (see knowledge/landmarks-blender.md).
SK = {"height": 634.0, "circle": 320.0, "base_corner": 39.26, "base_face": 19.63, "shaft": 17.8}
SK_DECK = [
    (17.8, 330.0),
    (21.5, 336.0),
    (24.0, 342.0),
    (26.0, 348.0),
    (27.3, 354.0),
    (27.5, 358.0),
    (27.3, 366.0),
    (27.2, 371.0),
    (27.7, 371.5),
    (27.7, 373.0),
    (26.4, 374.6),
    (16.2, 375.5),
]
SK_GALLERIA = [
    (13.6, 435.5),
    (17.4, 438.0),
    (19.9, 441.0),
    (19.9, 446.0),
    (18.9, 446.6),
    (18.5, 458.8),
    (14.0, 459.2),
    (14.0, 462.7),
    (11.2, 463.2),
]
SK_BAYS = 24


def sk_face_radius(h):
    """Distance from the axis to the middle of a face (むくり: bulges slightly toward the base)."""
    if h >= SK["circle"]:
        return SK["shaft"]
    return SK["shaft"] + (SK["base_face"] - SK["shaft"]) * (1 - h / SK["circle"]) ** 0.8


def sk_corner_radius(h):
    """Distance to the three corners (鼎); concave toward the base (そり)."""
    if h >= SK["circle"]:
        return SK["shaft"]
    return SK["shaft"] + (SK["base_corner"] - SK["shaft"]) * (1 - h / SK["circle"]) ** 1.25


def sk_point(theta, h):
    """Section of the tower body: a triangle with corners at theta = 0°, 120°, 240° (theta from +Z
    toward +X) rounding into a circle, r = a / cos(phi)^k with phi measured from the face normal."""
    a, big = sk_face_radius(h), sk_corner_radius(h)
    k = max(0.0, math.log2(big / a))
    phi = ((math.degrees(theta) - 60.0) % 120.0) - 60.0
    r = a / math.cos(math.radians(phi)) ** k
    return (r * math.sin(theta), h, r * math.cos(theta))


def build_tokyo_skytree():
    modes = ["iki", "miyabi", "nobori", "lightsOut"]
    pal = Palette(modes)
    white = 0xE8EEF2
    iki_white = (1.0, 0.96, 0.88, 1.0)
    iki_blue = (0.30, 0.72, 1.0, 1.0)
    edo = (0.55, 0.22, 1.0, 1.0)
    gold = (1.0, 0.80, 0.50, 1.0)
    tachibana = (1.0, 0.45, 0.06, 1.0)

    def lit(color, k, tex=None):
        return {"emission": scale_rgb(color, k), "strength": 1.0, "emit_tex": tex}

    lat = "sk_lattice.png"
    pal.add(
        "SK_LatticeLow",
        {
            "iki": lit(iki_white, 0.9, lat),
            "miyabi": lit((1, 1, 1, 1), 1.5, "sk_lattice_miyabi.png"),
            "nobori": lit((1, 1, 1, 1), 1.6, "sk_lattice_nobori.png"),
        },
        color=white,
        tex=lat,
        clip=True,
        roughness=0.5,
    )
    pal.add(
        "SK_LatticeMid",
        {
            "iki": lit(iki_white, 1.0, lat),
            "miyabi": lit((1.0, 0.85, 0.8, 1.0), 1.3, "sk_lattice_miyabi.png"),
            "nobori": lit((1, 1, 1, 1), 1.5, "sk_lattice_nobori.png"),
        },
        color=white,
        tex=lat,
        clip=True,
        roughness=0.5,
    )
    pal.add(
        "SK_LatticeTop",
        {"iki": lit(iki_white, 1.3, lat), "miyabi": lit(gold, 1.4, lat), "nobori": lit(tachibana, 1.2, lat)},
        color=white,
        tex=lat,
        clip=True,
        roughness=0.5,
    )
    pal.add(
        "SK_Gain",
        {m: lit((1, 1, 1, 1), 1.1, lat) for m in modes[:3]},
        color=0xF4F6F8,
        tex=lat,
        clip=True,
        roughness=0.5,
    )
    pal.add(
        "SK_Core",
        {"iki": lit(iki_blue, 2.4), "miyabi": lit(edo, 0.15), "nobori": lit(tachibana, 0.2)},
        color=0xC2C8CD,
        roughness=0.7,
    )
    deck_night = {"emission": (1, 1, 1, 1), "strength": 1.4, "emit_tex": "sk_deck_night.png"}
    pal.add(
        "SK_Deck", {m: deck_night for m in modes[:3]}, color=0xFFFFFF, tex="sk_deck.png", metallic=0.15, roughness=0.35
    )
    gal_night = {"emission": (1, 1, 1, 1), "strength": 1.4, "emit_tex": "sk_galleria_night.png"}
    pal.add(
        "SK_Galleria",
        {m: gal_night for m in modes[:3]},
        color=0xFFFFFF,
        tex="sk_galleria.png",
        metallic=0.15,
        roughness=0.3,
    )
    pal.add(
        "SK_DeckRing",
        {"iki": lit(iki_blue, 5.0), "miyabi": lit(edo, 5.0), "nobori": lit(tachibana, 5.0)},
        color=0x3C4046,
        roughness=0.3,
    )
    pal.add(
        "SK_Mech", {m: lit((0.9, 0.92, 0.95, 1), 0.35) for m in modes[:3]}, color=0xC9CED3, metallic=0.2, roughness=0.45
    )
    pal.add(
        "SK_Antenna",
        {m: lit((1, 1, 1, 1), 0.8, "sk_antenna.png") for m in modes[:3]},
        color=0xFFFFFF,
        tex="sk_antenna.png",
        roughness=0.5,
    )
    pal.add("SK_Crown", {m: lit((1, 1, 1, 1), 4.0) for m in modes[:3]}, color=0xF6F8FA, metallic=0.3, roughness=0.3)
    lamp = {"emission": (1.0, 0.02, 0.01, 1.0), "strength": 20.0}
    pal.add("SK_AviationLamp", {m: lamp for m in modes}, color=0x601010, roughness=0.3)
    strobe = {"emission": (1.0, 1.0, 1.0, 1.0), "strength": 25.0}
    pal.add("SK_Strobe", {m: strobe for m in modes}, color=0xD0D4D8, roughness=0.3)

    near = Builder("TokyoSkytree_Near")
    n_around = SK_BAYS * 2
    thetas = [2 * math.pi * j / n_around for j in range(n_around)]

    def tube(levels, ring, part, bays=SK_BAYS, v_per=25.0):
        rows = [[ring(t, h) for t in thetas] for h in levels]
        near.grid(rows, part, uv=lambda i, j: (j * bays / n_around, levels[i] / v_per), closed=True, smooth=True)

    body = [k * 12.5 for k in range(27)] + [330.0]
    tube([h for h in body if h <= 150], sk_point, "SK_LatticeLow")
    tube([h for h in body if h >= 150], sk_point, "SK_LatticeMid")

    def circle(r):
        return lambda t, h: (r * math.sin(t), h, r * math.cos(t))

    def lathe(profile, part, v0, vlen, tiles, n=48):
        th = [2 * math.pi * j / n for j in range(n)]
        for (r0, h0), (r1, h1) in zip(profile, profile[1:], strict=False):
            rows = [[(r * math.sin(t), h, r * math.cos(t)) for t in th] for r, h in ((r0, h0), (r1, h1))]
            near.grid(
                rows,
                part,
                uv=lambda i, j, a=h0, b=h1: (j * tiles / n, ((a, b)[i] - v0) / vlen),
                closed=True,
                smooth=True,
            )

    def disc(r, h, part, n=32, up=True):
        pts = [(r * math.sin(2 * math.pi * j / n), h, r * math.cos(2 * math.pi * j / n)) for j in range(n)]
        near.face(pts if not up else list(reversed(pts)), part)

    # core: 心柱 and the lift shafts round it, seen through the truss
    lathe([(9.5, 0.0), (9.5, 330.0)], "SK_Core", 0.0, 25.0, 1, n=24)
    lathe(SK_DECK, "SK_Deck", 330.0, 45.0, 20)
    lathe([(27.85, 371.4), (27.85, 372.6)], "SK_DeckRing", 0, 1, 1, n=64)  # 時計光 / LED line at the rim
    lathe([(17.0, 330.6), (17.0, 331.4)], "SK_DeckRing", 0, 1, 1, n=48)
    disc(16.2, 375.5, "SK_Mech")
    lathe([(16.0, 375.5), (16.0, 383.5)], "SK_Mech", 0, 1, 1, n=32)
    disc(16.0, 383.5, "SK_Mech")
    shaft = [383.5 + k * 13.0 for k in range(5)]
    tube(shaft, circle(13.5), "SK_LatticeTop", bays=20)
    lathe([(9.0, 383.5), (9.0, 435.5)], "SK_Core", 0.0, 25.0, 1, n=24)
    for h in (392.0, 404.0, 416.0, 426.0):  # antenna platforms and dishes on the shaft
        lathe([(15.2, h - 0.3), (15.2, h + 0.3)], "SK_Mech", 0, 1, 1, n=32)
        for j in range(8):
            t = 2 * math.pi * (j + 0.5 * (h % 2)) / 8
            c = (15.8 * math.sin(t), h + 1.4, 15.8 * math.cos(t))
            near.box(c, (1.6, 1.8, 1.6), "SK_Mech")
    lathe(SK_GALLERIA, "SK_Galleria", 435.5, 27.5, 14)
    lathe([(20.05, 446.0), (20.05, 446.8)], "SK_DeckRing", 0, 1, 1, n=64)
    disc(11.2, 463.2, "SK_Mech")
    tube([463.0, 475.0, 487.0, 497.0], circle(11.0), "SK_LatticeTop", bays=16)
    lathe([(6.0, 463.0), (6.0, 497.0)], "SK_Core", 0.0, 25.0, 1, n=24)
    lathe([(11.6, 496.4), (11.6, 497.6)], "SK_Mech", 0, 1, 1, n=32)
    disc(11.6, 497.6, "SK_Mech")
    # ゲイン塔: hexagonal lattice with antenna drums, platforms and the crown
    hexa = [2 * math.pi * j / 6 for j in range(6)]
    rows = [[(3.2 * math.sin(t), h, 3.2 * math.cos(t)) for t in hexa] for h in (497.6, 540.0, 580.0, 627.0)]
    near.grid(
        rows, "SK_Gain", uv=lambda i, j: (j * 1.0, (497.6, 540.0, 580.0, 627.0)[i] / 8.0), closed=True, smooth=False
    )
    for r, a, b in ((4.5, 501.0, 530.0), (4.6, 543.0, 562.0), (4.4, 579.0, 620.0)):
        lathe([(r, a), (r, b)], "SK_Antenna", a, 8.0, 7, n=24)
    for h in (539.0, 541.5, 562.5, 572.0, 579.0, 589.0, 599.0, 609.0, 620.0):
        lathe([(5.3, h), (5.3, h + 0.5)], "SK_Mech", 0, 1, 1, n=24)
        disc(5.3, h + 0.5, "SK_Mech", n=24)
    lathe([(3.4, 627.0), (5.6, 631.5), (5.4, 633.2), (3.0, 634.0)], "SK_Crown", 0, 1, 1, n=24)
    disc(3.0, 634.0, "SK_Crown", n=24)
    for j in range(4):
        t = 2 * math.pi * j / 4
        near.box((5.0 * math.sin(t), 633.6, 5.0 * math.cos(t)), (0.7, 0.7, 0.7), "SK_Strobe")
        for h, r in ((562.8, 5.4), (497.9, 11.8), (463.5, 11.4), (375.8, 16.4)):
            near.box((r * math.sin(t + 0.4), h, r * math.cos(t + 0.4)), (0.7, 0.7, 0.7), "SK_AviationLamp")

    root = bpy.data.objects.new("TokyoSkytree", None)
    SCENE.collection.objects.link(root)
    near_ob = near.finish(pal, root)

    # ---------------------------------------------------------------- far LOD (~500 tris, one material)
    far_l = {m: {"emission": (1, 1, 1, 1), "strength": 1.2, "emit_tex": f"sk_far_{m}.png"} for m in modes[:3]}
    pal.add("SK_Far", far_l, color=0xFFFFFF, tex="sk_far.png", roughness=0.5)
    far = Builder("TokyoSkytree_Far")
    H = SK["height"]
    n12 = 12
    th12 = [2 * math.pi * j / n12 for j in range(n12)]

    def far_rows(pairs):
        for (fa, ha), (fb, hb) in zip(pairs, pairs[1:], strict=False):
            rows = [[fa(t, ha) for t in th12], [fb(t, hb) for t in th12]]
            far.grid(rows, "SK_Far", uv=lambda i, j, a=ha, b=hb: (j / n12, (a, b)[i] / H), closed=True, smooth=True)

    def c(r):
        return lambda t, h: (r * math.sin(t), h, r * math.cos(t))

    far_rows([(sk_point, h) for h in (0.0, 40.0, 100.0, 180.0, 260.0, 320.0, 330.0)])
    far_rows([(c(r), h) for r, h in (SK_DECK[0], SK_DECK[3], SK_DECK[5], SK_DECK[8], SK_DECK[10], SK_DECK[11])])
    far_rows([(c(16.0), 375.5), (c(16.0), 383.5), (c(13.5), 383.6), (c(13.5), 435.5)])
    far_rows(
        [
            (c(r), h)
            for r, h in (SK_GALLERIA[0], SK_GALLERIA[2], SK_GALLERIA[3], SK_GALLERIA[5], SK_GALLERIA[7], SK_GALLERIA[8])
        ]
    )
    far_rows([(c(11.0), 463.2), (c(11.0), 497.6)])
    far_rows([(c(3.4), 497.6), (c(3.4), 627.0), (c(4.8), 631.5), (c(1.0), 634.0)])
    far_ob = far.finish(pal, root)

    origin = (139.8107080, 35.7100392)  # axis of the circular shaft (PLATEAU LOD2 sections 330–460 m)
    heading = 353.8  # +Z: the 鼎 (corner) pointing NNW; the opposite face runs along the 北十間川
    meta = {
        "id": "tokyo_skytree",
        "name": "東京スカイツリー",
        "lon": origin[0],
        "lat": origin[1],
        "heading": heading,
        "baseHeight": 1.9,
        "height": SK["height"],
        "farDistance": 2500,
        "footprint": OSM_FOOTPRINT["tokyo_skytree"],
        "sources": [SOURCES["osm"], SOURCES["plateau"]],
        "plateau": [
            {
                "gmlId": "bldg_58ab8c46-8369-49c4-86cf-6912bbc4efe1",
                "hide": False,
                "note": (
                    "PLATEAU では東京スカイツリータウン全体（ソラマチ等、LOD1 で高さ約 28 m）が 1 棟。"
                    "塔の足元はその中に立つので隠さない"
                ),
            }
        ],
        "lightModes": [
            {"id": "iki", "name": "粋（隅田川の水色・心柱を照らす）"},
            {"id": "miyabi", "name": "雅（江戸紫と金箔のきらめき）"},
            {"id": "nobori", "name": "幟（橘色・縦のライン）"},
            {"id": "lightsOut", "name": "消灯（航空障害灯のみ）"},
        ],
        "lightSchedule": {
            "source": "https://www.tokyo-skytree.jp/enjoy/lighting/ (2026-10-04 時点の 10 月カレンダー)",
            "on": "sunset",
            "off": "24:00",
            "cycle": {"modes": ["miyabi", "nobori", "iki"], "epoch": "2026-10-04"},
            "note": (
                "基調ライティング 3 種を 1 日ごとに替える（2017-05-18 の「幟」追加以降）。"
                "特別ライティングの日は公式カレンダーで上書き"
            ),
            "after": "lightsOut",
        },
    }
    return root, near_ob, far_ob, pal, meta


# ============================================================================================== 東京駅丸の内駅舎
# Modelled from photographs and JR East's published drawings in scripts/blender/tokyo_station.py (bays,
# pilasters, granite bands, domes, vault and clock, pavilions, porte-cochère, dormers); this module only
# hands it the shared helpers and exports it like the other landmarks.
def build_tokyo_station():
    from types import SimpleNamespace

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import tokyo_station

    helpers = SimpleNamespace(
        bpy=bpy,
        SCENE=SCENE,
        TEX=TEX,
        Builder=Builder,
        Palette=Palette,
        material=material,
        OSM_FOOTPRINT=OSM_FOOTPRINT,
        SOURCES=SOURCES,
    )
    return tokyo_station.build(helpers)


# ---------------------------------------------------------------------------------------------- export
BUILDERS = {
    "tokyo_tower": build_tokyo_tower,
    "tokyo_skytree": build_tokyo_skytree,
    "tokyo_station": build_tokyo_station,
}


def setup_variants(objects, pal):
    prefs = bpy.context.preferences.addons["io_scene_gltf2"].preferences
    prefs.KHR_materials_variants_ui = True  # registers the variant property groups
    sc = bpy.data.scenes[0]
    sc.gltf2_KHR_materials_variants_variants.clear()
    for i, mode in enumerate(pal.modes):
        v = sc.gltf2_KHR_materials_variants_variants.add()
        v.variant_idx = i
        v.name = mode
    count = 0
    for ob in objects:
        me = ob.data
        me.gltf2_variant_mesh_data.clear()
        for slot, m in enumerate(me.materials):
            part = m.name[len("Day_") :]
            for i, mode in enumerate(pal.modes):
                lm = pal.light(mode, part)
                if not lm:
                    continue
                d = me.gltf2_variant_mesh_data.add()
                d.material_slot_index = slot
                d.material = lm
                d.variants.add().variant.variant_idx = i
                count += 1
    return count


def export(path, objects):
    for o in SCENE.objects:
        o.select_set(o in objects)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=False,
        export_apply=True,
        use_selection=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
    )


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def write_json(meta):
    try:
        with open(JSON_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        data = []
    data = [d for d in data if d.get("id") != meta["id"]]
    data.append(meta)
    order = list(BUILDERS)
    data.sort(key=lambda d: order.index(d["id"]) if d["id"] in order else len(order))
    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------------------------- previews
def look(cam, eye, target):
    cam.location = eye
    fwd = (Vector(target) - Vector(eye)).normalized()
    right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
    up = right.cross(fwd)
    cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()


def set_mode(objects, pal, mode):
    for ob in objects:
        for slot, m in enumerate(ob.data.materials):
            part = m.name.split("_", 2)[-1] if m.name.startswith("Light_") else m.name[len("Day_") :]
            target = pal.light(mode, part) if mode != "day" else None
            ob.data.materials[slot] = target or pal.day[part]


def previews(objects, pal, views, ground=4000.0):
    os.makedirs(PREVIEW, exist_ok=True)
    gm = material("PreviewGround", 0x5E6366, roughness=0.95)
    bm = bmesh.new()
    for p in [(-ground, 0, -ground), (ground, 0, -ground), (ground, 0, ground), (-ground, 0, ground)]:
        bm.verts.new(p)
    bm.faces.new(bm.verts)
    gme = bpy.data.meshes.new("PreviewGround")
    bm.to_mesh(gme)
    gme.materials.append(gm)
    g = bpy.data.objects.new("PreviewGround", gme)
    SCENE.collection.objects.link(g)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.rotation_euler = (math.radians(-50), math.radians(-35), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.clip_end = 20000
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 24
    SCENE.cycles.use_denoising = True
    SCENE.cycles.transparent_max_bounces = 64
    SCENE.cycles.max_bounces = 4
    try:
        SCENE.view_settings.view_transform = "Khronos PBR Neutral"
    except TypeError:
        SCENE.view_settings.view_transform = "Standard"
    near_ob, far_ob = objects
    only = os.environ.get("LANDMARK_PREVIEW_MODES")  # e.g. "day,iki" while iterating
    only_views = os.environ.get("LANDMARK_PREVIEW_VIEWS")  # e.g. "front,dome"
    for mode in ["day"] + [m for m in pal.modes]:
        if only and mode not in only.split(","):
            continue
        set_mode(objects, pal, mode)
        is_day = mode == "day"
        bg.inputs["Color"].default_value = (0.55, 0.66, 0.82, 1) if is_day else (0.004, 0.006, 0.014, 1)
        bg.inputs["Strength"].default_value = 0.8 if is_day else 1.0
        sun.data.energy = 4.0 if is_day else 0.02
        for view, (eye, target, lens, res, *shift) in views.items():
            if only_views and view not in only_views.split(","):
                continue
            cam.data.shift_y = shift[0] if shift else 0.0  # vertical lens shift (keeps verticals upright)
            is_far = view.startswith("far") and not view.endswith("detail")
            near_ob.hide_render = is_far  # the runtime shows one LOD at a time
            far_ob.hide_render = not is_far
            cam.data.lens = lens
            SCENE.render.resolution_x, SCENE.render.resolution_y = res
            look(cam, eye, target)
            SCENE.render.filepath = os.path.join(PREVIEW, f"{LANDMARK}-{mode}-{view}.png")
            bpy.ops.render.render(write_still=True)
            log("preview", mode=mode, view=view)
    set_mode(objects, pal, "day")


PREVIEW_VIEWS = {
    "tokyo_station": {
        # Cameras matched to reference photos (knowledge/landmarks-blender.md): "front" =
        # Tokyo-STA_Marunouchi-Entrance_2023.jpg (EXIF 25 mm equiv., 108 m from the façade on the 行幸通り
        # axis, level with a lens shift), "dome" = Tokyo_Station_Marunouchi_North_2012_09.jpg and "aerial" =
        # the 2016 view from the Marunouchi Building, both solved from known points (rms 14–20 px).
        "front": ((0.0, 1.6, 118.6), (0.0, 1.6, 0.0), 25, (1600, 1067), 0.143),
        "centre": ((0.0, 1.6, 62.0), (0.0, 15.5, 0.0), 30, (1600, 1000)),
        "dome": ((85.8, 1.4, 112.1), (-0.6, 12.1, 63.1), 122, (1600, 1067)),
        "aerial": ((59.0, 22.4, 159.0), (23.6, -1.7, 68.6), 20.8, (1600, 1067)),
        "south": ((150.0, 1.7, 110.0), (110.0, 14.0, 10.0), 28, (1600, 900)),
        "far": ((-500.0, 40.0, 900.0), (0.0, 15.0, 0.0), 60, (1600, 700)),
        "far-detail": ((-500.0, 40.0, 900.0), (0.0, 15.0, 0.0), 60, (1600, 700)),
    },
    "tokyo_skytree": {
        "near": ((-420.0, 2.0, -500.0), (0.0, 318.0, 0.0), 36, (900, 1200)),
        "base": ((-150.0, 1.7, -170.0), (0.0, 70.0, 0.0), 20, (1280, 800)),
        "decks": ((-260.0, 330.0, -300.0), (0.0, 420.0, 0.0), 40, (900, 1200)),
        "far": ((-3000.0, 60.0, -4000.0), (0.0, 320.0, 0.0), 240, (600, 900)),
        "far-detail": ((-3000.0, 60.0, -4000.0), (0.0, 320.0, 0.0), 240, (600, 900)),
    },
    "tokyo_tower": {
        "near": ((-260.0, 2.0, 300.0), (0.0, 166.0, 0.0), 30, (900, 1200)),
        "base": ((-95.0, 1.7, 120.0), (0.0, 45.0, 0.0), 20, (1280, 800)),
        "far": ((-1600.0, 60.0, 2600.0), (0.0, 166.0, 0.0), 220, (600, 900)),
        "far-detail": ((-1600.0, 60.0, 2600.0), (0.0, 166.0, 0.0), 220, (600, 900)),
    },
}


def main():
    root, near_ob, far_ob, pal, meta = BUILDERS[LANDMARK]()
    meshes = [near_ob, far_ob]
    nvar = setup_variants(meshes, pal)
    export(OUT, [root, *meshes])
    far_path = OUT[: -len(".glb")] + "_far.glb"
    export(far_path, [root, far_ob])
    rel = os.path.relpath(OUT, os.path.join(ROOT, "public")).replace(os.sep, "/")
    meta = {
        **{k: meta[k] for k in ("id", "name")},
        "model": rel,
        "farModel": os.path.relpath(far_path, os.path.join(ROOT, "public")).replace(os.sep, "/"),
        **{k: v for k, v in meta.items() if k not in ("id", "name")},
        "nodes": {"near": near_ob.name, "far": far_ob.name},
    }
    is_published = not rel.startswith("..")
    if is_published:
        write_json(meta)
    else:  # a trial build elsewhere must not point the game's landmarks.json at it
        log("json_skipped", reason="output outside public/", file=OUT)
    log(
        "exported",
        file=OUT,
        bytes=os.path.getsize(OUT),
        far_bytes=os.path.getsize(far_path),
        tris={near_ob.name: tri_count(near_ob), far_ob.name: tri_count(far_ob)},
        materials=len([m for m in bpy.data.materials if m.name.startswith(("Day_", "Light_"))]),
        variant_mappings=nvar,
    )
    if PREVIEW:
        previews(meshes, pal, PREVIEW_VIEWS[LANDMARK])


main()
