# Street police officer (地域・交通の制服警察官, ~1.7 m) for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/police.py -- public/models/police.glb [preview-dir]
#
# Same skeleton as scripts/blender/human.py, so src/world/human.ts can animate it: game
# coordinates (+Y up, facing +Z, feet at y = 0, the person's right = −X), exported with
# export_yup=False; UpperArmL/R pivot at the shoulder, ForearmL/R at the elbow, ThighL/R at the hip
# and ShinL/R at the knee (rotation about X bends each joint; rotation about Z lifts an arm
# sideways). The script checks those pivots against public/models/human.glb before exporting.
#
# Uniform per 警察官の服制に関する規則 (昭和31年国家公安委員会規則第4号) 別表: the default is the
# 合/冬活動服 (紺・濃紺) with white shirt and tie, 制帽 with black visor and chin strap, black 帯革
# with holster (right), handcuff case and baton (left rear), black shoes, 警笛 on a black cord.
# Variants are separate nodes the game shows or hides:
#   Vest      夜光チョッキ (fluorescent yellow-green with reflective bands) for 交通整理・取締り
#   CapCover  白色帽子覆い for traffic duty
#   Tie       white shirt + tie in the collar V (hide it for the open-collar 夏服)
#   UpperArmShortL/R + ForearmBareL/R  夏服の半袖 (instead of UpperArmL/R + ForearmL/R)
# Materials: Shirt / Pants are white-based images × baseColorFactor (紺 by default; 夏服 = 水色
# shirt and 藍色 trousers via material.color), Skin / Hair use the pedestrian textures and the same
# names as human.glb so human.ts can tint them, Hands is white (cotton gloves; tint it skin for bare
# hands), Kit is a full-colour atlas (leather, metal, insignia, cap), Vest and Reflective (bands,
# cap cover; the game may raise its emission under headlights).
# No real emblem or wordmark: the cap badge and sleeve patch are generic shapes.
# Pose angles for the 道路交通法施行令 第4条 hand signals are in the glTF scene extras (userData.police).
import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "police.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "police", "textures")
HUMAN_TEX = os.path.join(ROOT, "assets", "human", "textures")  # face and hair, shared with pedestrians
HUMAN_GLB = os.path.join(ROOT, "public", "models", "human.glb")

# Skeleton: must equal scripts/blender/human.py (checked against human.glb below).
SHOULDER = (0.235, 1.40)
HIP = (0.095, 0.86)
HEAD_C = 1.665
HEAD_R = (0.105, 0.125, 0.115)
ELBOW_DROP = 0.27
KNEE_DROP = 0.42
PIVOTS = {
    "UpperArmL": (SHOULDER[0], SHOULDER[1], 0.0),
    "UpperArmR": (-SHOULDER[0], SHOULDER[1], 0.0),
    "ForearmL": (SHOULDER[0], SHOULDER[1] - ELBOW_DROP, 0.0),
    "ForearmR": (-SHOULDER[0], SHOULDER[1] - ELBOW_DROP, 0.0),
    "ThighL": (HIP[0], HIP[1], 0.0),
    "ThighR": (-HIP[0], HIP[1], 0.0),
    "ShinL": (HIP[0], HIP[1] - KNEE_DROP, 0.012),
    "ShinR": (-HIP[0], HIP[1] - KNEE_DROP, 0.012),
}

# Uniform colours (sRGB) per the 服制 別表: 冬服・冬活動服 濃紺色, 合服 紺色, 夏服上衣 水色,
# 夏服ズボン 藍色.
COLORS = {
    "winterUniform": 0x1C2640,
    "midUniform": 0x222E4E,
    "summerShirt": 0x9CC2E8,
    "summerTrousers": 0x24375A,
    "skin": 0xE6C2A4,
    "hair": 0x1C1916,
    "gloves": 0xF4F4F0,
}


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


def check_skeleton():
    """Pivots must match the pedestrian model, or human.ts would bend the joints in the wrong place."""
    if not os.path.exists(HUMAN_GLB):
        log("skeleton_unchecked", reason="human.glb missing")
        return
    with open(HUMAN_GLB, "rb") as f:
        data = f.read()
    length = struct.unpack("<I", data[12:16])[0]
    nodes = {n.get("name"): n for n in json.loads(data[20 : 20 + length])["nodes"]}
    bad = {}
    for name, pivot in PIVOTS.items():
        t = nodes.get(name, {}).get("translation", [0, 0, 0])
        if any(abs(a - b) > 1e-4 for a, b in zip(t, pivot, strict=True)):
            bad[name] = {"human": t, "police": pivot}
    if bad:
        log("skeleton_mismatch", **bad)
        sys.exit(1)
    log("skeleton_ok", parts=len(PIVOTS))


check_skeleton()
bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def lin(hex_color):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (ch((hex_color >> 16) & 255), ch((hex_color >> 8) & 255), ch(hex_color & 255), 1.0)


MAT = {}


def material(
    name,
    color=0xFFFFFF,
    image=None,
    tex_dir=TEX,
    factor=None,
    roughness=0.8,
    metallic=0.0,
    emission=0.0,
    double_sided=False,
):
    """Principled material; with `factor`, image × colour (exported as baseColorFactor)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided  # the exporter writes doubleSided from this
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Base Color"].default_value = lin(color)
    color_out = None
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(tex_dir, image))
        color_out = tex.outputs["Color"]
        if factor is not None:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs[7].default_value = lin(factor)  # B (colour socket)
            nt.links.new(color_out, mix.inputs[6])  # A (colour socket)
            color_out = mix.outputs[2]
        nt.links.new(color_out, b.inputs["Base Color"])
    if emission:
        b.inputs["Emission Strength"].default_value = emission
        if color_out is not None:
            nt.links.new(color_out, b.inputs["Emission Color"])
        else:
            b.inputs["Emission Color"].default_value = lin(color)
    MAT[name] = m
    return m


material("Skin", image="face.png", tex_dir=HUMAN_TEX, factor=COLORS["skin"], roughness=0.6)
material("Hair", image="hair.png", tex_dir=HUMAN_TEX, factor=COLORS["hair"], roughness=0.5, double_sided=True)
material("Shirt", image="uniform.png", factor=COLORS["midUniform"], roughness=0.85)
material("Pants", image="trousers.png", factor=COLORS["midUniform"], roughness=0.85)
material("Hands", color=COLORS["gloves"], roughness=0.9)
material("Kit", image="kit.png", roughness=0.45)
material("Vest", image="vest.png", roughness=0.7, emission=0.12, double_sided=True)  # seen inside at the armholes
material("Reflective", color=0xE4E7EA, roughness=0.3, metallic=0.2)

SKIN_UV = (0.5, 0.92)  # forehead of face.png: plain skin for the neck and bare arms


def new_object(name, bm, mats, origin=(0.0, 0.0, 0.0)):
    """Object whose origin (pivot) is at `origin`; the mesh is given in world coordinates."""
    bmesh.ops.translate(bm, verts=bm.verts, vec=-Vector(origin))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = origin
    SCENE.collection.objects.link(ob)
    return ob


class Builder:
    """bmesh + UV layer + material slots for one object."""

    def __init__(self, mats):
        self.bm = bmesh.new()
        self.uvl = self.bm.loops.layers.uv.new("UVMap")
        self.mats = mats

    def face(self, verts, mat, uvs):
        f = self.bm.faces.new(verts)
        f.material_index = self.mats.index(mat)
        for loop, uv in zip(f.loops, uvs, strict=True):
            loop[self.uvl].uv = uv
        return f

    def finish(self, name, origin=(0.0, 0.0, 0.0)):
        return new_object(name, self.bm, self.mats, origin)

    def loft(self, rings, segs, mat, uv_of, theta0=0.0, cap_bottom=True, cap_top=True, skip=None):
        """Loft through rings [(y, rx, rz, cx, cz)]. theta0 is where the UV seam sits (θ = 0 front,
        +π/2 the person's left); uv_of(s, row) gets s ∈ [0, 1] unwrapped from the seam, so the
        seam quad does not wrap the whole image. skip(theta_mid, k) leaves a face out."""
        grid = []
        for y, rx, rz, cx, cz in rings:
            row = []
            for i in range(segs):
                th = theta0 + 2 * math.pi * i / segs
                row.append(self.bm.verts.new((cx + rx * math.sin(th), y, cz + rz * math.cos(th))))
            grid.append(row)
        faces = []
        for k in range(len(rings) - 1):
            for i in range(segs):
                j = (i + 1) % segs
                if skip and skip(theta0 + 2 * math.pi * (i + 0.5) / segs, k):
                    continue
                uvs = [
                    uv_of(i / segs, k),
                    uv_of((i + 1) / segs, k),
                    uv_of((i + 1) / segs, k + 1),
                    uv_of(i / segs, k + 1),
                ]
                faces.append(self.face((grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]), mat, uvs))
        for row, cap, r in ((grid[0], cap_bottom, 0), (grid[-1], cap_top, len(rings) - 1)):
            if cap:
                verts = row if r else list(reversed(row))
                faces.append(self.face(verts, mat, [uv_of(0.5, r)] * segs))
        return faces

    def ellipsoid(self, centre, radii, segs, rows, mat, uv_of):
        """UV sphere with outward winding; uv_of(vertex_local, face_centre_local) per corner."""
        cx, cy, cz = centre
        rx, ry, rz = radii
        top = self.bm.verts.new((cx, cy + ry, cz))
        bottom = self.bm.verts.new((cx, cy - ry, cz))
        grid = []
        for r in range(1, rows):
            phi = math.pi * r / rows
            grid.append(
                [
                    self.bm.verts.new(
                        (
                            cx + rx * math.sin(phi) * math.sin(2 * math.pi * i / segs),
                            cy + ry * math.cos(phi),
                            cz + rz * math.sin(phi) * math.cos(2 * math.pi * i / segs),
                        )
                    )
                    for i in range(segs)
                ]
            )
        quads = []
        for i in range(segs):
            j = (i + 1) % segs
            quads.append((top, grid[0][i], grid[0][j]))
            quads.append((bottom, grid[-1][j], grid[-1][i]))
            for k in range(len(grid) - 1):
                quads.append((grid[k][i], grid[k + 1][i], grid[k + 1][j], grid[k][j]))
        faces = []
        for q in quads:
            mid = sum((v.co for v in q), Vector()) / len(q) - Vector(centre)
            faces.append(self.face(q, mat, [uv_of(v.co - Vector(centre), mid) for v in q]))
        return faces

    def box(self, centre, size, axes, mat, uv_front, uv_side):
        """Box with half-extents along axes (h, v, n); the +n face shows the rect uv_front
        (u0, v0, u1, v1), the others the single point uv_side."""
        c = Vector(centre)
        h, v, n = (Vector(a).normalized() for a in axes)
        sx, sy, sz = (s / 2 for s in size)
        p = {(a, b, d): c + h * a * sx + v * b * sy + n * d * sz for a in (-1, 1) for b in (-1, 1) for d in (-1, 1)}
        vs = {k: self.bm.verts.new(q) for k, q in p.items()}
        u0, v0, u1, v1 = uv_front
        faces = [
            self.face(
                [vs[-1, -1, 1], vs[1, -1, 1], vs[1, 1, 1], vs[-1, 1, 1]], mat, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            )
        ]
        others = [
            [vs[-1, -1, -1], vs[-1, 1, -1], vs[1, 1, -1], vs[1, -1, -1]],
            [vs[-1, -1, -1], vs[1, -1, -1], vs[1, -1, 1], vs[-1, -1, 1]],
            [vs[-1, 1, -1], vs[-1, 1, 1], vs[1, 1, 1], vs[1, 1, -1]],
            [vs[1, -1, -1], vs[1, 1, -1], vs[1, 1, 1], vs[1, -1, 1]],
            [vs[-1, -1, -1], vs[-1, -1, 1], vs[-1, 1, 1], vs[-1, 1, -1]],
        ]
        faces += [self.face(q, mat, [uv_side] * 4) for q in others]
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)  # axes may be left-handed

    def tube(self, points, radius, sides, mat, uv):
        """Open tube along a polyline (cords); outward winding."""
        pts = [Vector(p) for p in points]
        rings = []
        for k, p in enumerate(pts):
            t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
            ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            a = t.cross(ref).normalized()
            b = t.cross(a)
            rings.append(
                [
                    self.bm.verts.new(p + radius * (a * math.cos(f) + b * math.sin(f)))
                    for f in [2 * math.pi * i / sides for i in range(sides)]
                ]
            )
        for k in range(len(rings) - 1):
            for i in range(sides):
                j = (i + 1) % sides
                self.face((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]), mat, [uv] * 4)

    def strip(self, points, normals, width, mat, uv_of):
        """Flat band through points, facing `normals`; uv_of(along ∈ [0,1], across ∈ {0,1})."""
        left, right = [], []
        pts = [Vector(p) for p in points]
        for k, (p, n) in enumerate(zip(pts, normals, strict=True)):
            t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
            side = t.cross(Vector(n)).normalized()
            left.append(self.bm.verts.new(p - side * width / 2))
            right.append(self.bm.verts.new(p + side * width / 2))
        last = len(pts) - 1
        for k in range(last):
            a0, a1 = k / last, (k + 1) / last
            self.face(
                (left[k], right[k], right[k + 1], left[k + 1]),
                mat,
                [uv_of(a0, 0), uv_of(a0, 1), uv_of(a1, 1), uv_of(a1, 0)],
            )


# ---------------------------------------------------------------- kit atlas (4 × 4 cells)
CELLS = {
    "leather": 0,
    "silver": 1,
    "gold": 2,
    "idbadge": 3,
    "capnavy": 4,
    "capband": 5,
    "glossblack": 6,
    "white": 7,
    "tie": 8,
    "capbadge": 9,
    "patch": 10,
    "rank": 11,
    "radio": 12,
    "sole": 13,
    "cord": 14,
}


def kit_rect(cell, inset=0.04):
    i = CELLS[cell]
    c, r = i % 4, i // 4
    return ((c + inset) / 4, 1 - (r + 1 - inset) / 4, (c + 1 - inset) / 4, 1 - (r + inset) / 4)


def kit_uv(cell, u=0.5, v=0.5):
    u0, v0, u1, v1 = kit_rect(cell)
    return (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v)


# ---------------------------------------------------------------- torso
# (y, half-width, half-depth, centre x, centre z): hips (trousers) → belt → 活動服 hem belt →
# chest → shoulders → neck. A few mm fuller than the pedestrian torso for the jacket.
TORSO = [
    (0.84, 0.168, 0.108, 0, 0.0),
    (0.885, 0.168, 0.108, 0, 0.0),
    (0.925, 0.167, 0.107, 0, 0.001),
    (0.968, 0.163, 0.104, 0, 0.003),
    (1.06, 0.160, 0.102, 0, 0.006),
    (1.18, 0.173, 0.112, 0, 0.012),
    (1.30, 0.191, 0.115, 0, 0.010),
    (1.40, 0.202, 0.100, 0, 0.0),
    (1.47, 0.110, 0.075, 0, 0.0),
]
T_LO, T_HI = 0.84, 1.47  # uniform.png v range (police_textures.py uses the same numbers)
SEAM = -math.pi / 2  # UV seam at the person's right side, as on the pedestrian shirt


def torso_at(y):
    for (y0, rx0, rz0, cx0, cz0), (y1, rx1, rz1, cx1, cz1) in zip(TORSO, TORSO[1:], strict=False):
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0)
            return (rx0 + (rx1 - rx0) * t, rz0 + (rz1 - rz0) * t, cx0 + (cx1 - cx0) * t, cz0 + (cz1 - cz0) * t)
    raise ValueError(y)


def on_torso(y, theta, lift=0.0, grow=(0.0, 0.0)):
    """Point on the torso surface at height y and angle θ (0 front, +π/2 left), pushed out by
    `lift` along the normal; grow adds to the radii. Returns (point, normal)."""
    rx, rz, cx, cz = torso_at(y)
    rx, rz = rx + grow[0], rz + grow[1]
    n = Vector((math.sin(theta) / rx, 0.0, math.cos(theta) / rz)).normalized()
    p = Vector((cx + rx * math.sin(theta), y, cz + rz * math.cos(theta))) + n * lift
    return p, n


def plate_axes(n):
    h = Vector((0, 1, 0)).cross(n).normalized()
    return h, n.cross(h), n


def torso_uv(s, row, rings=TORSO):
    return (s, 0.125 + 0.875 * (rings[row][0] - T_LO) / (T_HI - T_LO))


tb = Builder(["Shirt", "Pants", "Kit", "Skin"])
# Trousers below the duty belt, then the jacket from under the belt to the collar.
pants_rings = TORSO[0:2]
tb.loft(pants_rings, 16, "Pants", lambda s, row: (s, 0.93 + 0.07 * row), theta0=SEAM, cap_bottom=True, cap_top=False)
jacket = TORSO[1:]
tb.loft(jacket, 16, "Shirt", lambda s, row: torso_uv(s, row, jacket), theta0=SEAM, cap_bottom=False, cap_top=True)
# Neck (skin) out of the collar into the head.
tb.loft(
    [(1.44, 0.050, 0.047, 0, 0.0), (1.60, 0.046, 0.044, 0, 0.0)],
    10,
    "Skin",
    lambda s, row: SKIN_UV,
    cap_bottom=False,
    cap_top=False,
)
# Turn-down collar (折り襟) round the neck, open at the front V where the shirt and tie show.
collar = [(1.435, 0.094, 0.080, 0, 0.0), (1.468, 0.078, 0.068, 0, 0.0), (1.497, 0.066, 0.060, 0, 0.0)]
tb.loft(
    collar,
    16,
    "Shirt",
    lambda s, row: (0.62 + 0.2 * s, 0.97 + 0.01 * row),
    theta0=SEAM,
    cap_bottom=False,
    cap_top=False,
    skip=lambda th, k: abs(math.atan2(math.sin(th), math.cos(th))) < 0.42,
)
# Inner face of the collar so it does not vanish when seen through the V.
tb.loft(
    [(y, rx - 0.006, rz - 0.006, cx, cz) for y, rx, rz, cx, cz in reversed(collar)],
    16,
    "Shirt",
    lambda s, row: (0.62 + 0.2 * s, 0.97),
    theta0=SEAM,
    cap_bottom=False,
    cap_top=False,
    skip=lambda th, k: abs(math.atan2(math.sin(th), math.cos(th))) < 0.42,
)

# Shoulder straps (肩章) along the shoulder slope, with a dark button near the collar.
for side in (1, -1):
    x0, x1 = 0.112, 0.200
    y0 = 1.40 + (0.202 - x0) / 0.092 * 0.07
    y1 = 1.40 + (0.202 - x1) / 0.092 * 0.07
    mid = Vector((side * (x0 + x1) / 2, (y0 + y1) / 2, 0.0))
    along = Vector((side * (x1 - x0), y1 - y0, 0.0)).normalized()
    up = Vector((0, 0, 1)).cross(along).normalized() * (1 if side > 0 else -1)
    centre = mid + up * 0.006
    tb.box(
        centre,
        (0.006, 0.052, (Vector((x1 - x0, y1 - y0, 0))).length),
        (up, Vector((0, 0, 1)), along),
        "Shirt",
        (0.6, 0.9, 0.62, 0.92),
        (0.6, 0.9),
    )
    tb.box(
        mid + up * 0.011 - along * 0.035,
        (0.006, 0.014, 0.014),
        (up, Vector((0, 0, 1)), along),
        "Kit",
        kit_rect("gold"),
        kit_uv("gold"),
    )

# Duty belt (帯革): a leather band with a lip top and bottom, silver buckle at the front.
belt = []
for y, lift in ((0.874, 0.0), (0.874, 0.013), (0.930, 0.013), (0.930, 0.0)):
    rx, rz, cx, cz = torso_at(y)
    belt.append((y, rx + lift, rz + lift, cx, cz))
tb.loft(belt, 20, "Kit", lambda s, row: kit_uv("leather", s, row / 3), cap_bottom=False, cap_top=False)
p, n = on_torso(0.902, 0.0, lift=0.017)
tb.box(p, (0.058, 0.044, 0.008), plate_axes(n), "Kit", kit_rect("silver"), kit_uv("silver"))
# Holster (拳銃入れ) on the right hip, flap on top; handcuff case (手錠入れ) at the left rear;
# baton (警棒) in its holder at the left rear, behind the left arm.
p, n = on_torso(0.90, -math.pi / 2 - 0.12, lift=0.03)
h, v, nn = plate_axes(n)
tb.box(p + Vector((0, -0.07, 0)), (0.085, 0.165, 0.045), (h, v, nn), "Kit", kit_rect("leather"), kit_uv("leather"))
tb.box(
    p + Vector((0, 0.012, 0)) + nn * 0.004,
    (0.092, 0.04, 0.05),
    (h, v, nn),
    "Kit",
    kit_rect("leather"),
    kit_uv("leather"),
)
p, n = on_torso(0.89, math.pi - 0.62, lift=0.026)
tb.box(p, (0.080, 0.072, 0.040), plate_axes(n), "Kit", kit_rect("leather"), kit_uv("leather"))
tb.box(
    p + n * 0.021 + Vector((0, 0.018, 0)),
    (0.016, 0.012, 0.004),
    plate_axes(n),
    "Kit",
    kit_rect("silver"),
    kit_uv("silver"),
)
p, n = on_torso(0.90, math.pi / 2 + 0.62, lift=0.024)
tb.tube(
    [p + Vector((0, 0.03, 0)), p + Vector((0, -0.10, 0)), p + Vector((0, -0.22, 0))],
    0.017,
    8,
    "Kit",
    kit_uv("glossblack"),
)
tb.box(p + Vector((0, 0.0, 0)), (0.05, 0.05, 0.03), plate_axes(n), "Kit", kit_rect("leather"), kit_uv("leather"))

# Left chest: rank insignia (階級章) and ID badge (識別章), generic plates (備考十: 左胸部).
for y, w, hgt, cell in ((1.268, 0.056, 0.017, "rank"), (1.243, 0.036, 0.014, "idbadge")):
    p, n = on_torso(y, 0.565, lift=0.003)
    tb.box(p, (w, hgt, 0.004), plate_axes(n), "Kit", kit_rect(cell), kit_uv(cell))
# Radio speaker-mic on the right chest.
p, n = on_torso(1.33, -0.62, lift=0.012)
tb.box(p, (0.036, 0.06, 0.022), plate_axes(n), "Kit", kit_rect("radio"), kit_uv("radio"))
# 警笛 on a black cord (約60cm の黒ひも) from the left shoulder strap into the left breast pocket.
cord = []
for y, th in ((1.432, 1.08), (1.40, 0.99), (1.355, 0.90), (1.31, 0.84), (1.262, 0.79), (1.222, 0.76)):
    p, n = on_torso(y, th, lift=0.006)
    cord.append(p)
tb.tube(cord, 0.0035, 5, "Kit", kit_uv("cord"))
p, n = on_torso(1.214, 0.76, lift=0.008)
tb.box(p, (0.012, 0.022, 0.010), plate_axes(n), "Kit", kit_rect("silver"), kit_uv("silver"))
torso = tb.finish("Torso")

# ---------------------------------------------------------------- shirt and tie in the V
vb = Builder(["Kit"])
V_TOP, V_BOT, V_HALF = 1.47, 1.315, 0.50
apex = vb.bm.verts.new(on_torso(V_BOT, 0.0, lift=0.0035)[0])
rows_v = []
for r in range(1, 5):
    y = min(V_BOT + (V_TOP - V_BOT) * r / 4, 1.4699)
    half = V_HALF * r / 4
    rows_v.append(
        [
            (vb.bm.verts.new(on_torso(y, th, lift=0.0035)[0]), (0.5 + 0.5 * th / V_HALF, r / 4))
            for th in [-half + 2 * half * c / 4 for c in range(5)]
        ]
    )
for c in range(4):
    (b0, uv0), (b1, uv1) = rows_v[0][c], rows_v[0][c + 1]
    vb.face((apex, b1, b0), "Kit", [kit_uv("tie", 0.5, 0.0), kit_uv("tie", *uv1), kit_uv("tie", *uv0)])
for r in range(3):
    for c in range(4):
        q = [rows_v[r][c], rows_v[r][c + 1], rows_v[r + 1][c + 1], rows_v[r + 1][c]]
        vb.face([v for v, _ in q], "Kit", [kit_uv("tie", *uv) for _, uv in q])
# Shirt collar band round the front of the neck, inside the jacket collar.
vb.loft(
    [(1.452, 0.056, 0.053, 0, 0.0), (1.505, 0.053, 0.050, 0, 0.0)],
    12,
    "Kit",
    lambda s, row: kit_uv("white", s, row),
    cap_bottom=False,
    cap_top=False,
    skip=lambda th, k: abs(math.atan2(math.sin(th), math.cos(th))) > 1.3,
)
vb.finish("Tie")

# ---------------------------------------------------------------- head (pedestrian face)
hb = Builder(["Skin"])


def head_uv(local, mid):
    if mid.z < -0.01:
        return SKIN_UV
    return (0.5 + 0.5 * local.x / HEAD_R[0], 0.5 + 0.5 * local.y / HEAD_R[1])


hb.ellipsoid((0.0, HEAD_C, 0.0), HEAD_R, 16, 10, "Skin", head_uv)
nose = [
    hb.bm.verts.new(p)
    for p in [
        (-0.011, HEAD_C - 0.018, 0.108),
        (0.011, HEAD_C - 0.018, 0.108),
        (0.0, HEAD_C - 0.030, 0.121),
        (0.0, HEAD_C + 0.008, 0.113),
    ]
]
for tri in [(0, 2, 1), (1, 2, 3), (3, 2, 0)]:
    hb.face([nose[i] for i in tri], "Skin", [(0.5, 0.42)] * 3)
bmesh.ops.recalc_face_normals(hb.bm, faces=hb.bm.faces)
hb.finish("Head")

# Short hair (the cap hides the crown), as HairShort of the pedestrian.
hair_b = Builder(["Hair"])
segs, rows = 16, 7
coverage_front, coverage_side, coverage_back = 0.30 * math.pi, 0.50 * math.pi, 0.62 * math.pi
hgrid = []
for r in range(rows + 1):
    t = r / rows
    row = []
    for i in range(segs):
        th = 2 * math.pi * i / segs
        c = math.cos(th)
        cov = (
            coverage_side + (coverage_front - coverage_side) * c
            if c >= 0
            else coverage_side + (coverage_side - coverage_back) * c
        )
        phi = cov * t
        row.append(
            hair_b.bm.verts.new(
                (
                    HEAD_R[0] * 1.06 * math.sin(phi) * math.sin(th),
                    HEAD_C + HEAD_R[1] * 1.04 * math.cos(phi),
                    HEAD_R[2] * 1.06 * math.sin(phi) * math.cos(th),
                )
            )
        )
    hgrid.append(row)
for k in range(rows):
    for i in range(segs):
        j = (i + 1) % segs
        hair_b.face(
            (hgrid[k][i], hgrid[k + 1][i], hgrid[k + 1][j], hgrid[k][j]),
            "Hair",
            [
                (2 * i / segs, 2 * k / rows),
                (2 * i / segs, 2 * (k + 1) / rows),
                (2 * (i + 1) / segs, 2 * (k + 1) / rows),
                (2 * (i + 1) / segs, 2 * k / rows),
            ],
        )
bmesh.ops.remove_doubles(hair_b.bm, verts=hair_b.bm.verts, dist=1e-6)
hair_b.finish("HairShort")

# ---------------------------------------------------------------- cap (制帽)
CAP_B0 = HEAD_C + 0.045  # band bottom: just above the eyebrows
CAP_B1 = HEAD_C + 0.093  # band top
BAND_R = (0.117, 0.128)


def crown_rings(grow=0.0):
    return [
        (CAP_B1, BAND_R[0] + grow, BAND_R[1] + grow, 0, 0.0),
        (CAP_B1 + 0.026, 0.130 + grow, 0.143 + grow, 0, 0.004),
        (CAP_B1 + 0.046, 0.136 + grow, 0.150 + grow, 0, 0.006),
        (CAP_B1 + 0.054 + grow, 0.124 + grow, 0.137 + grow, 0, 0.006),
        (CAP_B1 + 0.058 + grow, 0.070 + grow, 0.078 + grow, 0, 0.004),
    ]


def front_lift(builder, faces_start, amount):
    """Raise the front of the crown (the saddle of a peaked cap)."""
    for v in {v for f in list(builder.bm.faces)[faces_start:] for v in f.verts}:
        if v.co.y > CAP_B1 + 0.005:
            c = max(0.0, v.co.z) / 0.155
            v.co.y += amount * c * c * min(1.0, (v.co.y - CAP_B1) / 0.03)


cb = Builder(["Kit"])
cb.loft(
    [(CAP_B0, BAND_R[0], BAND_R[1], 0, 0.0), (CAP_B1, BAND_R[0], BAND_R[1], 0, 0.0)],
    20,
    "Kit",
    lambda s, row: kit_uv("capband", s, row),
    cap_bottom=False,
    cap_top=False,
)
n0 = len(cb.bm.faces)
cb.loft(crown_rings(), 20, "Kit", lambda s, row: kit_uv("capnavy", s, row / 4), cap_bottom=False, cap_top=True)
front_lift(cb, n0, 0.014)
# Inside of the band (seen from below when the head tilts).
cb.loft(
    [(CAP_B1, BAND_R[0] - 0.004, BAND_R[1] - 0.004, 0, 0.0), (CAP_B0, BAND_R[0] - 0.004, BAND_R[1] - 0.004, 0, 0.0)],
    20,
    "Kit",
    lambda s, row: kit_uv("glossblack"),
    cap_bottom=False,
    cap_top=False,
)
# Visor (ひさし): a black plate from the band's front, sloping down.
VIS = 9
top_in, top_out, bot_in, bot_out = [], [], [], []
for i in range(VIS + 1):
    th = -1.22 + 2.44 * i / VIS
    reach = 0.060 * max(0.0, math.cos(th * 1.22)) ** 0.55
    x_in, z_in = (BAND_R[0] + 0.002) * math.sin(th), (BAND_R[1] + 0.002) * math.cos(th)
    out = Vector((math.sin(th) * BAND_R[1] / BAND_R[0], 0, math.cos(th))).normalized()
    x_out, z_out = x_in + out.x * reach, z_in + out.z * reach
    drop = 0.020 * reach / 0.060
    top_in.append(cb.bm.verts.new((x_in, CAP_B0 + 0.004, z_in)))
    top_out.append(cb.bm.verts.new((x_out, CAP_B0 + 0.004 - drop, z_out)))
    bot_in.append(cb.bm.verts.new((x_in, CAP_B0 - 0.001, z_in)))
    bot_out.append(cb.bm.verts.new((x_out, CAP_B0 - 0.001 - drop, z_out)))
vis_faces = []
g = kit_uv("glossblack")
for i in range(VIS):
    vis_faces.append(cb.face((top_in[i], top_in[i + 1], top_out[i + 1], top_out[i]), "Kit", [g] * 4))
    vis_faces.append(cb.face((bot_in[i], bot_out[i], bot_out[i + 1], bot_in[i + 1]), "Kit", [g] * 4))
    vis_faces.append(cb.face((top_out[i], top_out[i + 1], bot_out[i + 1], bot_out[i]), "Kit", [g] * 4))
vis_faces.append(cb.face((top_in[0], top_out[0], bot_out[0], bot_in[0]), "Kit", [g] * 4))
vis_faces.append(cb.face((top_in[-1], bot_in[-1], bot_out[-1], top_out[-1]), "Kit", [g] * 4))
bmesh.ops.recalc_face_normals(cb.bm, faces=vis_faces)
# Chin strap (あごひも) across the front of the band, ear buttons at both ends.
strap_pts, strap_n = [], []
for i in range(13):
    th = -1.42 + 2.84 * i / 12
    n = Vector((math.sin(th) / BAND_R[0], 0, math.cos(th) / BAND_R[1])).normalized()
    strap_pts.append(Vector((BAND_R[0] * math.sin(th), CAP_B0 + 0.014, BAND_R[1] * math.cos(th))) + n * 0.003)
    strap_n.append(n)
cb.strip(strap_pts, strap_n, 0.012, "Kit", lambda a, b: kit_uv("glossblack"))
for th in (-1.47, 1.47):
    n = Vector((math.sin(th) / BAND_R[0], 0, math.cos(th) / BAND_R[1])).normalized()
    p = Vector((BAND_R[0] * math.sin(th), CAP_B0 + 0.014, BAND_R[1] * math.cos(th))) + n * 0.005
    cb.box(p, (0.012, 0.012, 0.005), plate_axes(n), "Kit", kit_rect("gold"), kit_uv("gold"))
# Generic gold cap badge above the band, tilted back with the crown.
badge_n = Vector((0, 0.32, 1)).normalized()
badge_p = Vector((0, CAP_B1 + 0.024, 0.136 + 0.008))
cb.box(badge_p, (0.034, 0.040, 0.004), plate_axes(badge_n), "Kit", kit_rect("capbadge"), kit_uv("gold"))
cb.finish("Cap")

# White cap cover (白色帽子覆い) over the crown for traffic duty.
ccb = Builder(["Reflective"])
cover = crown_rings(grow=0.004)
cover[0] = (CAP_B1 - 0.003, BAND_R[0] + 0.005, BAND_R[1] + 0.005, 0, 0.0)
ccb.loft(cover, 20, "Reflective", lambda s, row: (s, row / 4), cap_bottom=False, cap_top=True)
front_lift(ccb, 0, 0.014)
ccb.finish("CapCover")


# ---------------------------------------------------------------- arms
def sleeve_v(y, top, wrist):
    # uniform.png's bottom band: v = 0 cuff (wrist) … 0.09 shoulder.
    return 0.09 * (y - wrist) / (top - wrist)


def arm(side, short=False):
    suffix = "L" if side > 0 else "R"
    x0, y0 = side * SHOULDER[0], SHOULDER[1]
    ye = y0 - ELBOW_DROP
    top, wrist = y0 + 0.02, y0 - 0.52

    def ring_uv(rings):
        return lambda s, row: (s, sleeve_v(rings[row][0], top, wrist))

    ub = Builder(["Shirt"] + (["Skin"] if short else []) + (["Kit"] if side < 0 else []))
    # Deltoid ball at the pivot: covers the joint when the arm is raised sideways (交通整理).
    ub.ellipsoid((x0, y0, 0.0), (0.058, 0.058, 0.055), 10, 6, "Shirt", lambda local, mid: (0.5, 0.09))
    if short:
        hem = y0 - 0.15
        sleeve = [(top, 0.053, 0.051, x0, 0.0), (hem, 0.056, 0.054, x0, 0.0)]
        ub.loft(sleeve, 10, "Shirt", ring_uv(sleeve), cap_bottom=False, cap_top=True)
        skin = [
            (hem + 0.02, 0.042, 0.041, x0, 0.0),
            (ye + 0.02, 0.040, 0.039, x0, 0.0),
            (ye - 0.02, 0.038, 0.037, x0, 0.0),
        ]
        ub.loft(skin, 8, "Skin", lambda s, row: SKIN_UV, cap_bottom=True, cap_top=True)
    else:
        upper = [(top, 0.053, 0.051, x0, 0.0), (ye + 0.02, 0.047, 0.046, x0, 0.0), (ye - 0.02, 0.044, 0.043, x0, 0.0)]
        ub.loft(upper, 10, "Shirt", ring_uv(upper), cap_bottom=True, cap_top=True)
    if side < 0:
        # Sleeve patch (エンブレムの位置、右袖上腕部) — a plain generic patch, no emblem or name.
        y_hi = y0 - 0.05 if short else y0 - 0.09
        pts, ns = [], []
        for k in range(5):
            th = -math.pi / 2 - 0.55 + 1.1 * k / 4
            n = Vector((math.sin(th), 0, math.cos(th)))
            pts.append(Vector((x0 + 0.059 * math.sin(th), y_hi - 0.035, 0.057 * math.cos(th))))
            ns.append(n)
        ub.strip(pts, ns, 0.07, "Kit", lambda a, b: kit_uv("patch", a, 1 - b))
    ub.finish(f"UpperArmShort{suffix}" if short else f"UpperArm{suffix}", origin=(x0, y0, 0.0))

    fb = Builder(["Skin", "Hands"] if short else ["Shirt", "Hands"])
    if short:
        # Down into the hand so no gap shows at the wrist; both ends closed.
        fore = [(ye + 0.01, 0.039, 0.038, x0, 0.0), (wrist - 0.012, 0.031, 0.030, x0, 0.0)]
        fb.loft(fore, 8, "Skin", lambda s, row: SKIN_UV)
        fb.ellipsoid((x0, ye, 0.0), (0.040, 0.040, 0.039), 8, 4, "Skin", lambda local, mid: SKIN_UV)
    else:
        fore = [
            (ye + 0.01, 0.045, 0.044, x0, 0.0),
            (wrist + 0.02, 0.040, 0.039, x0, 0.0),
            (wrist, 0.041, 0.040, x0, 0.0),
        ]
        fb.loft(fore, 10, "Shirt", ring_uv(fore), cap_bottom=True, cap_top=True)  # cuff closed round the glove
        fb.ellipsoid(
            (x0, ye, 0.0), (0.046, 0.046, 0.045), 8, 4, "Shirt", lambda local, mid: (0.5, sleeve_v(ye, top, wrist))
        )
    fb.ellipsoid((x0, y0 - 0.585, 0.0), (0.030, 0.062, 0.044), 8, 5, "Hands", lambda local, mid: (0.5, 0.5))
    fb.finish(f"ForearmBare{suffix}" if short else f"Forearm{suffix}", origin=(x0, ye, 0.0))


for s in (1, -1):
    arm(s)
    arm(s, short=True)


# ---------------------------------------------------------------- legs
def leg(side):
    suffix = "L" if side > 0 else "R"
    x0, y0 = side * HIP[0], HIP[1]
    yk = y0 - KNEE_DROP
    top, hem = y0 + 0.02, y0 - 0.78

    def pants_uv(rings):
        return lambda s, row: (s, (rings[row][0] - hem) / (top - hem))

    lb = Builder(["Pants"])
    thigh = [(top, 0.081, 0.086, x0, 0.0), (y0 - 0.30, 0.068, 0.070, x0, 0.005), (yk - 0.02, 0.058, 0.060, x0, 0.012)]
    lb.loft(thigh, 10, "Pants", pants_uv(thigh))
    lb.finish(f"Thigh{suffix}", origin=(x0, y0, 0.0))

    sb = Builder(["Pants", "Kit"])
    shin = [(yk + 0.01, 0.059, 0.061, x0, 0.012), (y0 - 0.70, 0.053, 0.055, x0, 0.0), (hem, 0.056, 0.058, x0, 0.0)]
    sb.loft(shin, 10, "Pants", pants_uv(shin), cap_bottom=False, cap_top=False)
    v_knee = (yk - hem) / (top - hem)
    sb.ellipsoid((x0, yk, 0.012), (0.060, 0.060, 0.062), 10, 4, "Pants", lambda local, mid: (0.5, v_knee))
    # Black leather shoes (黒色短靴) with a dark sole.
    shoe = [
        (0.0, 0.050, 0.062, x0, 0.022),
        (0.012, 0.051, 0.068, x0, 0.026),
        (0.040, 0.052, 0.108, x0, 0.040),
        (0.078, 0.046, 0.088, x0, 0.020),
    ]
    sb.loft(shoe, 10, "Kit", lambda s, row: kit_uv("sole" if row == 0 else "leather", s, row / 3))
    sb.finish(f"Shin{suffix}", origin=(x0, yk, 0.012))


leg(1)
leg(-1)

# ---------------------------------------------------------------- vest (夜光チョッキ)
vestb = Builder(["Vest", "Reflective"])
V_GROW = (0.011, 0.017)
vest_rings = []
for y in (0.945, 1.00, 1.06, 1.12, 1.18, 1.24, 1.30):
    rx, rz, cx, cz = torso_at(y)
    vest_rings.append((y, rx + V_GROW[0], rz + V_GROW[1], cx, cz))
vestb.loft(
    vest_rings,
    16,
    "Vest",
    lambda s, row: (s, (vest_rings[row][0] - 0.945) / (1.30 - 0.945)),
    theta0=SEAM,
    cap_bottom=False,
    cap_top=False,
)
for y0, y1 in ((1.015, 1.045), (1.115, 1.145)):
    band = []
    for y in (y0, y1):
        rx, rz, cx, cz = torso_at(y)
        band.append((y, rx + V_GROW[0] + 0.003, rz + V_GROW[1] + 0.003, cx, cz))
    vestb.loft(band, 16, "Reflective", lambda s, row: (s, row), theta0=SEAM, cap_bottom=False, cap_top=False)
# Shoulder straps front → over the shoulder → back, each with a reflective centre stripe.
for side in (1, -1):
    path = [(1.29, 0.66), (1.345, 0.80), (1.395, 1.00), (1.430, 1.25), (1.440, math.pi / 2)]
    path += [(y, math.pi - th) for y, th in reversed(path[:-1])]
    pts, ns, pts2 = [], [], []
    for y, th in path:
        p, n = on_torso(y, side * th, lift=0.016, grow=(0.0, 0.004))
        p.y += 0.016 * max(0.0, math.sin(th)) ** 6  # ride over the shoulder strap (肩章)
        pts.append(p)
        ns.append(n)
        pts2.append(p + n * 0.003)
    vestb.strip(pts, ns, 0.060, "Vest", lambda a, b: (b * 0.1, a))
    vestb.strip(pts2, ns, 0.024, "Reflective", lambda a, b: (b, a))
vestb.finish("Vest")

# ---------------------------------------------------------------- poses and variants (scene extras)
HALF_PI = math.pi / 2
POSES = {
    # Rotation (x, y, z) in radians of each pivot; parts not listed stay at 0. Arms lift sideways
    # about Z (left arm +, right arm −); rotation.x swings a limb forward (−) / back (+).
    "rest": {},
    # 施行令第4条「腕を横に水平にあげた状態」: traffic parallel to the arms = 青, traffic facing the
    # officer's front or back = 赤. Lowering the arms without turning keeps the same meaning.
    "signalHorizontal": {"UpperArmL": [0, 0, HALF_PI], "UpperArmR": [0, 0, -HALF_PI]},
    # 「腕を垂直にあげた状態」(and while raising or lowering between horizontal and vertical):
    # traffic parallel to the arms as they were horizontal = 黄, facing traffic = 赤.
    "signalVertical": {"UpperArmL": [0, 0, math.pi], "UpperArmR": [0, 0, -math.pi]},
    # Palm toward a right-turning vehicle: 停止の合図 (right arm forward).
    "stopRight": {"UpperArmR": [-1.50, 0, 0], "ForearmR": [-0.10, 0, 0]},
}
POLICE = {
    "skeleton": "human.glb (UpperArm/Forearm/Thigh/Shin pivots)",
    "poses": POSES,
    "variants": {
        "patrol": {"show": ["Cap", "Tie", "UpperArmL", "UpperArmR", "ForearmL", "ForearmR"], "handsColor": "skin"},
        "traffic": {
            "show": ["Cap", "CapCover", "Vest", "Tie", "UpperArmL", "UpperArmR", "ForearmL", "ForearmR"],
            "handsColor": "gloves",
        },
        "summer": {
            "show": ["Cap", "UpperArmShortL", "UpperArmShortR", "ForearmBareL", "ForearmBareR"],
            "shirtColor": "summerShirt",
            "pantsColor": "summerTrousers",
        },
    },
    "colors": {k: f"#{v:06x}" for k, v in COLORS.items()},
}
# Exported as a JSON object in the scene extras; GLTFLoader puts it on gltf.scene.userData.police.
SCENE["police"] = POLICE

for ob in list(SCENE.objects):
    ob.select_set(False)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=False,
    export_apply=True,
    export_extras=True,
    export_draco_mesh_compression_enable=True,
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SCENE.objects if o.type == "MESH"}
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris, total=sum(tris.values()))

if not PREVIEW:
    sys.exit(0)

# ---------------------------------------------------------------- previews
os.makedirs(PREVIEW, exist_ok=True)


def tinted(name, color_hex):
    m = MAT[name].copy()
    m.name = f"{name}_{color_hex:06x}"
    for node in m.node_tree.nodes:
        if node.type == "MIX":
            node.inputs[7].default_value = lin(color_hex)
            break
    else:
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = lin(color_hex)
    return m


SUMMER = {"Shirt": tinted("Shirt", COLORS["summerShirt"]), "Pants": tinted("Pants", COLORS["summerTrousers"])}
BARE = {"Hands": tinted("Hands", COLORS["skin"])}
LOWER = {"ForearmL": "UpperArmL", "ForearmR": "UpperArmR", "ShinL": "ThighL", "ShinR": "ThighR"}
LOWER.update({"ForearmBareL": "UpperArmShortL", "ForearmBareR": "UpperArmShortR"})
POSE_ALIAS = {"UpperArmShortL": "UpperArmL", "UpperArmShortR": "UpperArmR", "ForearmBareL": "ForearmL"}
POSE_ALIAS["ForearmBareR"] = "ForearmR"
templates = [o for o in SCENE.objects if o.type == "MESH"]
for o in templates:
    o.hide_render = True


def figure(x, parts, pose, swap=None, turn=0.0, z=0.0):
    """Copy of the officer at (x, z) turned `turn` about Y, posed like the game would."""
    root = bpy.data.objects.new("FigureRoot", None)
    SCENE.collection.objects.link(root)
    copies = {}
    for name in parts:
        c = bpy.data.objects[name].copy()
        if swap:
            c.data = c.data.copy()
            for i, m in enumerate(c.data.materials):
                base = m.name.split("_")[0]
                if base in swap:
                    c.data.materials[i] = swap[base]
        SCENE.collection.objects.link(c)
        c.hide_render = False
        copies[name] = c
    bpy.context.view_layer.update()
    for lower, upper in LOWER.items():
        if lower in copies and upper in copies:
            copies[lower].parent = copies[upper]
            copies[lower].matrix_parent_inverse = copies[upper].matrix_world.inverted()
    for c in copies.values():
        if c.parent is None:
            c.parent = root
    for name, c in copies.items():
        rot = pose.get(POSE_ALIAS.get(name, name)) or pose.get(name)
        if rot:
            c.rotation_mode = "XYZ"
            c.rotation_euler = rot
    root.location = (x, 0.0, z)
    root.rotation_euler.y = turn
    return root


BODY = ["Torso", "Head", "HairShort", "Cap", "ThighL", "ThighR", "ShinL", "ShinR"]
LONG = ["UpperArmL", "UpperArmR", "ForearmL", "ForearmR"]
SHORT = ["UpperArmShortL", "UpperArmShortR", "ForearmBareL", "ForearmBareR"]
WALK = {
    "ThighL": [0.40, 0, 0],
    "ShinL": [0.15, 0, 0],
    "ThighR": [-0.45, 0, 0],
    "ShinR": [0.9, 0, 0],
    "UpperArmL": [-0.35, 0, 0],
    "ForearmL": [-0.5, 0, 0],
    "UpperArmR": [0.35, 0, 0],
    "ForearmR": [-0.2, 0, 0],
}

gbm = bmesh.new()
for p in [(-6, 0, -6), (6, 0, -6), (6, 0, 6), (-6, 0, 6)]:
    gbm.verts.new(p)
gbm.faces.new(gbm.verts)
gme = bpy.data.meshes.new("Ground")
gbm.to_mesh(gme)
gme.materials.append(material("Ground", 0x8A8C8E, roughness=0.9))
SCENE.collection.objects.link(bpy.data.objects.new("Ground", gme))
world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
SCENE.world = world
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(-50), math.radians(25), 0)
SCENE.collection.objects.link(sun)
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
SCENE.collection.objects.link(cam)
SCENE.camera = cam
SCENE.render.engine = "CYCLES"
SCENE.cycles.device = "CPU"
SCENE.cycles.samples = 32
SCENE.render.resolution_x = 1280
SCENE.render.resolution_y = 720


def shoot(name, eye, target, lens=50):
    cam.data.lens = lens
    cam.location = eye
    fwd = (Vector(target) - Vector(eye)).normalized()
    right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
    up = right.cross(fwd)
    cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
    SCENE.render.filepath = os.path.join(PREVIEW, f"police-{name}.png")
    bpy.ops.render.render(write_still=True)
    log("preview", view=name)


def clear_figures():
    for o in list(SCENE.objects):
        if o.name.startswith("FigureRoot") or (o.type == "MESH" and not o.hide_render and o.name != "Ground"):
            bpy.data.objects.remove(o, do_unlink=True)


# 1. Line-up: patrol (合活動服, bare hands), traffic duty (vest, cap cover, gloves, arms out),
#    summer (夏服半袖, open collar) walking.
figure(-1.3, BODY + LONG + ["Tie"], {}, swap=BARE)
figure(0.0, BODY + LONG + ["Tie", "Vest", "CapCover"], POSES["signalHorizontal"])
figure(1.3, BODY + SHORT, WALK, swap={**SUMMER, **BARE})
shoot("lineup-front", (0.0, 1.25, 5.4), (0.0, 0.95, 0.0), lens=40)
shoot("lineup-34", (3.4, 1.7, 4.2), (0.0, 0.95, 0.0), lens=40)
shoot("lineup-back", (-1.2, 1.6, -5.0), (0.0, 1.0, 0.0), lens=40)
shoot("lineup-street", (5.0, 1.3, 11.0), (0.0, 1.0, 0.0), lens=50)  # a driver ~12 m away
clear_figures()
# 2. The two hand signals side by side, and the stop sign, seen from a driver's eye height.
figure(-0.85, BODY + LONG + ["Tie", "Vest", "CapCover"], POSES["signalHorizontal"])
figure(0.85, BODY + LONG + ["Tie", "Vest", "CapCover"], POSES["signalVertical"])
shoot("signals-front", (0.0, 1.3, 5.0), (0.0, 1.15, 0.0), lens=40)
clear_figures()
figure(0.0, BODY + LONG + ["Tie", "Vest", "CapCover"], POSES["stopRight"], turn=0.0)
shoot("stop-34", (2.2, 1.4, 2.6), (0.0, 1.1, 0.0), lens=45)
shoot("side", (3.2, 1.2, 0.0), (0.0, 0.95, 0.0), lens=45)
clear_figures()
figure(0.0, BODY + LONG + ["Tie"], {}, swap=BARE)
shoot("face", (0.25, 1.68, 0.85), (0.0, 1.62, 0.0), lens=60)
shoot("chest", (0.35, 1.25, 1.1), (0.0, 1.15, 0.0), lens=55)
shoot("belt-back", (-0.8, 1.0, -1.2), (0.0, 0.9, 0.0), lens=50)
