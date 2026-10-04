# Trucks for TOKYO OPEN DRIVE: a 10t-class 3-axle aluminium wing van (大型, 後2軸) and an 8t
# 増トン flatbed (平ボディ, 低床). One variant per run:
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/truck.py -- 10t public/models/truck10t.glb [preview-dir]
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/truck.py -- 8t public/models/truck8t.glb [preview-dir]
#
# Game coordinates (+Y up, nose toward +Z, ground at y = 0, the truck's left = +X), exported with
# export_yup=False; the origin is the middle of the overall length. Sizes follow public figures
# (knowledge/large-vehicles-blender.md): the 10t-class van is 11.98 × 2.49 × 3.79 m (within the
# 12 m / 2.5 m / 3.8 m limits) with 275/80R22.5 tyres; the 8t flatbed is 8.81 × 2.49 × 2.78 m with
# a 6.5 m deck 0.93 m off the ground and 225/80R17.5 tyres. Both carry green 事業用 plates,
# 最大積載量 on the cab doors and on the rear (保安基準 第18条第8項 requires the rear) and the
# 大型後部反射器 (第38条の2: freight vehicles of 7 t GVW or more).
#
# Nodes under the root ("Truck10t" / "Truck8t", extras = dimensions, axles, weights):
#   Body                       everything static, one mesh
#   WheelFL/FR                 steered front wheels, origin at the hub, axle along X
#   WheelR1L/R1R/R2L/R2R       (10t) twin tyres on the two rear axles
#   WheelRL/RR                 (8t) twin tyres on the rear axle
# Lamp materials keep car.glb's names (HeadLamp, TailLamp, IndicatorL/R, Reverse) plus MarkerLamp.
# Paint is the cab colour (clone it to recolour). Textures: assets/truck/textures.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
VARIANT = ARGS[0] if ARGS else "10t"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else os.path.join(ROOT, "public", "models", f"truck{VARIANT}.glb")
PREVIEW = os.path.abspath(ARGS[2]) if len(ARGS) > 2 else None
TEX = os.path.join(ROOT, "assets", "truck", "textures")

SPECS = {
    "10t": {
        "name": "Truck10t",
        "length": 11.98,
        "width": 2.49,
        "height": 3.79,
        "paint": 0xF2F2EF,
        "cab_len": 2.10,
        "cab_w": 2.49,
        "cab_bottom": 0.92,
        "screen_bottom": 1.86,
        "sill": 2.02,
        "head": 2.80,
        "rail": 2.92,
        "roof": 3.08,
        "front_overhang": 1.42,
        # Catalogue wheelbase 7,125 mm read as 5,815 (front → first rear) + 1,310 (rear pair).
        "rear_axles": [5.815, 7.125],
        "wheel_r": 0.506,  # 275/80R22.5
        "tyre_w": 0.276,
        "rim_r": 0.286,
        "track_f": 2.06,
        "track_r": 1.835,
        "dual": 0.33,
        "arch_r": 0.58,
        "door": (0.36, 1.46),  # behind the front face
        "body": "wing",
        "floor": 1.12,  # underside of the wing body
        "frame": (0.78, 1.02),
        "payload": 13500,
        "gvw": 24950,
        "load": "load10",
        "grille": "grille10",
        "plate": "10t",
        "bumper": (0.42, 0.90),
    },
    "8t": {
        "name": "Truck8t",
        "length": 8.81,
        "width": 2.49,
        "height": 2.78,
        "paint": 0xA9C4DC,
        "cab_len": 1.95,
        "cab_w": 2.30,
        "cab_bottom": 0.76,
        "screen_bottom": 1.55,
        "sill": 1.70,
        "head": 2.50,
        "rail": 2.62,
        "roof": 2.78,
        "front_overhang": 1.15,
        "rear_axles": [5.50],
        "wheel_r": 0.402,  # 225/80R17.5: the low deck (930 mm) leaves no room for 19.5-inch tyres
        "tyre_w": 0.226,
        "rim_r": 0.222,
        "track_f": 1.92,
        "track_r": 1.74,
        "dual": 0.29,
        "arch_r": 0.47,
        "door": (0.36, 1.32),
        "body": "flat",
        "deck": 0.93,  # deck surface (床面地上高)
        "gate_h": 0.45,
        "frame": (0.52, 0.78),
        "payload": 8200,
        "gvw": 14150,
        "load": "load8",
        "grille": "grille8",
        "plate": "8t",
        "bumper": (0.36, 0.76),
    },
}
SP = SPECS[VARIANT]
LENGTH, WIDTH, HEIGHT = SP["length"], SP["width"], SP["height"]
FRONT, REAR = LENGTH / 2, -LENGTH / 2
HW = WIDTH / 2
CAB_HW = SP["cab_w"] / 2
CAB_BACK = FRONT - SP["cab_len"]
AXLE_F = round(FRONT - SP["front_overhang"], 4)
REAR_AXLES = [round(AXLE_F - d, 4) for d in SP["rear_axles"]]
PIVOT_Z = round(sum(REAR_AXLES) / len(REAR_AXLES), 4)  # turning centre of a tandem: midway between the axles
WHEEL_R = SP["wheel_r"]
ARCH_R = SP["arch_r"]
CORNER_R = 0.20
ROOF_R = 0.20

DECAL_TEX = (1024, 512)
DECALS = {
    "load10": (0, 0, 512, 96),
    "load8": (0, 96, 512, 192),
    "reflector": (512, 0, 1024, 128),
    "grille10": (0, 192, 512, 352),
    "grille8": (512, 192, 1024, 352),
    "steps": (0, 352, 256, 512),
}
PLATE_TEX = (512, 512)
PLATES = {"10t": (0, 0, 512, 256), "8t": (0, 256, 512, 512)}


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


# ---------------------------------------------------------------------------- materials


def lin(hex_color):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (ch((hex_color >> 16) & 255), ch((hex_color >> 8) & 255), ch(hex_color & 255), 1.0)


MAT = {}


def material(name, color=0xFFFFFF, metallic=0.0, roughness=0.5, image=None, emissive=None, clip=False):
    """Principled material; emissive = hex colour."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if image:
        path = os.path.join(TEX, image)
        if os.path.exists(path):
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.get(image) or bpy.data.images.load(path)
            nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
            if clip:
                rnd = nt.nodes.new("ShaderNodeMath")
                rnd.operation = "ROUND"  # glTF alphaMode MASK
                nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
                nt.links.new(rnd.outputs[0], b.inputs["Alpha"])
        else:
            log("texture_missing", file=image)
    if emissive is not None:
        b.inputs["Emission Color"].default_value = lin(emissive)
        b.inputs["Emission Strength"].default_value = 1.0
    MAT[name] = m
    return m


material("Paint", SP["paint"], metallic=0.1, roughness=0.35)
material("Trim", 0x1C1E21, roughness=0.6)
material("Glass", 0x121A22, metallic=0.4, roughness=0.08)
material("Steel", 0xB8BDC3, metallic=0.8, roughness=0.3)
material("Box", 0xFFFFFF, metallic=0.3, roughness=0.45, image="truck_box.png")
material("Deck", 0x6E5E4E, roughness=0.8)
material("Aluminium", 0xC9CDD2, metallic=0.6, roughness=0.35)
material("Decal", 0xFFFFFF, roughness=0.4, image="truck_decals.png", clip=True)
material("Plate", 0xFFFFFF, roughness=0.45, image="truck_plates.png", clip=True)
material("HeadLamp", 0xF4F6F8, roughness=0.1, emissive=0xFFF4DE)
material("TailLamp", 0x8A0A0A, roughness=0.15, emissive=0xFF2A1A)
material("IndicatorL", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("IndicatorR", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("Reverse", 0xDADDE0, roughness=0.1, emissive=0xFFFFFF)
material("MarkerLamp", 0xC96A00, roughness=0.2, emissive=0xFF8A00)
material("Wheel", 0xFFFFFF, roughness=0.7, image="truck_wheel.png")


# ---------------------------------------------------------------------------- mesh helpers


class Mesh:
    """bmesh + UV layer whose material slots are addressed by name."""

    def __init__(self, mats):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = list(mats)

    def face(self, verts, mat, uvs=None, facing=None):
        vs = [v if isinstance(v, bmesh.types.BMVert) else self.bm.verts.new(v) for v in verts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mats.index(mat)
        if uvs:
            for loop, uv in zip(f.loops, uvs, strict=True):
                loop[self.uv].uv = uv
        if facing is not None:
            f.normal_update()
            if f.normal.dot(Vector(facing)) < 0:
                f.normal_flip()
        return f

    def box(self, center, size, mat, rot=None):
        cx, cy, cz = center
        sx, sy, sz = (s / 2 for s in size)
        vs = []
        for dx, dy, dz in [
            (-1, -1, -1),
            (1, -1, -1),
            (1, 1, -1),
            (-1, 1, -1),
            (-1, -1, 1),
            (1, -1, 1),
            (1, 1, 1),
            (-1, 1, 1),
        ]:
            p = Vector((dx * sx, dy * sy, dz * sz))
            if rot is not None:
                p = rot @ p
            vs.append(self.bm.verts.new(p + Vector((cx, cy, cz))))
        for quad in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]:
            self.face([vs[i] for i in quad], mat)

    def span(self, x0, x1, y0, y1, z0, z1, mat):
        """Axis-aligned box from corner to corner."""
        self.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), mat)

    def beam(self, p0, p1, thickness, mat):
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        rot = axis.to_track_quat("Z", "Y").to_matrix()
        self.box((p0 + p1) / 2, (thickness, thickness, axis.length), mat, rot=rot)

    def cylinder_z(self, center, radius, length, mat, segs=12):
        """Closed cylinder along Z (fuel tank, air tanks)."""
        cx, cy, cz = center
        rings = []
        for zz in (cz - length / 2, cz + length / 2):
            rings.append(
                [
                    self.bm.verts.new(
                        (
                            cx + radius * math.cos(2 * math.pi * k / segs),
                            cy + radius * math.sin(2 * math.pi * k / segs),
                            zz,
                        )
                    )
                    for k in range(segs)
                ]
            )
        for k in range(segs):
            j = (k + 1) % segs
            self.face([rings[0][k], rings[0][j], rings[1][j], rings[1][k]], mat)
        self.face(list(reversed(rings[0])), mat)
        self.face(rings[1], mat)

    def obj(self, name, parent=None, origin=(0.0, 0.0, 0.0), recalc=False):
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=-Vector(origin))
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        ob.location = origin
        SCENE.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        return ob


def atlas_uv(box, tex, u0=0.0, v0=0.0, u1=1.0, v1=1.0):
    """UV of the fractional rectangle (v up) inside an atlas pixel box."""
    x0, y0, x1, y1 = box
    w, h = tex

    def at(u, v):
        return ((x0 + (x1 - x0) * u) / w, 1 - (y1 - (y1 - y0) * v) / h)

    return at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)


def side_quad(m, x, side, z0, z1, y0, y1, mat, uv):
    """Quad facing ±X at x; uv = (BL, BR, TR, TL) as read from outside (left side: front → rear)."""
    za, zb = (max(z0, z1), min(z0, z1)) if side > 0 else (min(z0, z1), max(z0, z1))
    return m.face([(x, y0, za), (x, y0, zb), (x, y1, zb), (x, y1, za)], mat, uvs=uv, facing=(side, 0, 0))


def front_quad(m, x0, x1, y0, y1, z, mat, uv):
    """Quad facing +Z; seen from the front the truck's left (+X) is on the right: x0 < x1."""
    return m.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, uvs=uv, facing=(0, 0, 1))


def rear_quad(m, x0, x1, y0, y1, z, mat, uv):
    """Quad facing −Z; seen from behind +X is on the left: x0 > x1 reads left to right."""
    return m.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, uvs=uv, facing=(0, 0, -1))


FULL = ((0, 0), (1, 0), (1, 1), (0, 1))
BODY_MATS = [
    "Paint",
    "Trim",
    "Glass",
    "Steel",
    "Box",
    "Deck",
    "Aluminium",
    "Decal",
    "Plate",
    "HeadLamp",
    "TailLamp",
    "IndicatorL",
    "IndicatorR",
    "Reverse",
    "MarkerLamp",
]
body = Mesh(BODY_MATS)
bm = body.bm

# ---------------------------------------------------------------------------- cab (loft)

SB, SILL, HEAD, RAIL, ROOF = SP["screen_bottom"], SP["sill"], SP["head"], SP["rail"], SP["roof"]
DOOR_FRONT, DOOR_REAR = FRONT - SP["door"][0], FRONT - SP["door"][1]


def rake(y):
    return 0.0 if y <= SB else 0.22 * (y - SB) / (ROOF - SB)


def rake_weight(z):
    return min(1.0, max(0.0, (z - (FRONT - 0.36)) / 0.16))


def cab_half_width(z):
    d = z - (FRONT - CORNER_R)
    if d > 0:
        return CAB_HW - CORNER_R + math.sqrt(max(CORNER_R**2 - d * d, 0.0))
    if z < CAB_BACK + 0.05:
        return CAB_HW - 0.03
    return CAB_HW


def cab_top(z):
    r = 0.14
    d = z - (FRONT - r)
    if d > 0:
        return ROOF - r + math.sqrt(max(r * r - d * d, 0.0))
    return ROOF if z > CAB_BACK + 0.05 else ROOF - 0.03


def cab_bottom(z):
    y = SP["cab_bottom"]
    dz = abs(z - AXLE_F)
    if dz < ARCH_R:
        y = max(y, WHEEL_R + math.sqrt(ARCH_R**2 - dz**2) * 0.98)
    return y


CAB_LEVELS = [SB, SILL, HEAD, RAIL]


def cab_chain(z):
    hw, top, bottom = cab_half_width(z), cab_top(z), cab_bottom(z)
    r = min(ROOF_R, (top - bottom) * 0.3)
    lo, hi = bottom + 0.05, top - r - 0.01
    n = len(CAB_LEVELS)
    levels = [min(max(y, lo + 0.002 * k), hi - 0.002 * (n - k)) for k, y in enumerate(CAB_LEVELS)]
    chain = [(hw - 0.03, bottom), (hw, bottom + 0.04)] + [(hw, y) for y in levels]
    for k in range(5):
        a = math.radians(90 * k / 4)
        chain.append((hw - r + r * math.cos(a), top - r + r * math.sin(a)))
    return chain


def cab_material(zc, y):
    if zc > FRONT - CORNER_R - 0.001:  # rounded front corners: the windscreen wraps round
        if SB < y < HEAD:
            return "Glass"
        return "Paint"
    if zc > DOOR_FRONT and SILL < y < HEAD:
        return "Trim"  # A-pillar
    if DOOR_REAR + 0.05 < zc < DOOR_FRONT - 0.05 and SILL < y < HEAD:
        return "Glass"  # door window
    return "Paint"


cab_stations = {FRONT, DOOR_FRONT, DOOR_REAR, FRONT - 0.20, CAB_BACK, CAB_BACK + 0.05}
for phi in (35, 65, 85):
    cab_stations.add(round(FRONT - CORNER_R * (1 - math.sin(math.radians(phi))), 4))
for k in range(-3, 4):
    z = round(AXLE_F + ARCH_R * 1.02 * k / 3, 4)
    if CAB_BACK < z < FRONT:
        cab_stations.add(z)
cab_stations = sorted(cab_stations, reverse=True)


def placed(x, y, z):
    return (x, y, z - rake(y) * rake_weight(z))


cab_rings = []
for z in cab_stations:
    chain = cab_chain(z)
    cab_rings.append(
        ([bm.verts.new(placed(x, y, z)) for x, y in chain], [bm.verts.new(placed(-x, y, z)) for x, y in chain])
    )
cab_faces = []
for (za, (ra, la)), (zb, (rb, lb)) in zip(
    zip(cab_stations, cab_rings, strict=True), zip(cab_stations[1:], cab_rings[1:], strict=True), strict=False
):
    for ca, cb, side in ((ra, rb, 1), (la, lb, -1)):
        for i in range(len(ca) - 1):
            if (ca[i].co - ca[i + 1].co).length < 1e-4 and (cb[i].co - cb[i + 1].co).length < 1e-4:
                continue
            f = bm.faces.new((ca[i], cb[i], cb[i + 1], ca[i + 1]) if side > 0 else (ca[i], ca[i + 1], cb[i + 1], cb[i]))
            y = f.calc_center_median().y
            f.material_index = BODY_MATS.index(cab_material((za + zb) / 2, y))
            cab_faces.append(f)
    cab_faces.append(bm.faces.new((ra[0], la[0], lb[0], rb[0])))
    cab_faces[-1].material_index = BODY_MATS.index("Trim")
    cab_faces.append(bm.faces.new((ra[-1], rb[-1], lb[-1], la[-1])))
    cab_faces[-1].material_index = BODY_MATS.index("Paint")
for ring, facing in ((cab_rings[0], 1), (cab_rings[-1], -1)):
    right, left = ring
    for i in range(len(right) - 1):
        if (right[i].co - right[i + 1].co).length < 1e-4:
            continue
        f = bm.faces.new((right[i], left[i], left[i + 1], right[i + 1]))
        y = f.calc_center_median().y
        mat = (
            "Glass"
            if facing > 0 and SB < y < HEAD
            else ("Trim" if facing < 0 and y < SP["cab_bottom"] + 0.1 else "Paint")
        )
        f.material_index = BODY_MATS.index(mat)
        cab_faces.append(f)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.is_valid])


def front_z(y):
    return FRONT - rake(y)


# Grille, bumper, lamps, plate, steps, visor, wipers, mirrors, door seams and the 最大積載量 lettering.
gx = CAB_HW - 0.30
g0 = SP["cab_bottom"] + 0.20
front_quad(body, -gx, gx, g0, SB - 0.06, FRONT + 0.004, "Decal", atlas_uv(DECALS[SP["grille"]], DECAL_TEX))
b0, b1 = SP["bumper"]
body.span(-CAB_HW + 0.02, CAB_HW - 0.02, b0, b1, FRONT - 0.10, FRONT + 0.04, "Trim")
front_quad(body, -0.22, 0.22, b0 + 0.03, b0 + 0.25, FRONT + 0.045, "Plate", atlas_uv(PLATES[SP["plate"]], PLATE_TEX))
hy = (b0 + b1) / 2 + 0.06
for s in (1, -1):
    for x in (CAB_HW - 0.55, CAB_HW - 0.34):
        body.box((s * x, hy, FRONT + 0.04), (0.19, 0.13, 0.03), "HeadLamp")
    body.box((s * (CAB_HW - 0.14), hy, FRONT + 0.035), (0.14, 0.13, 0.03), "IndicatorL" if s > 0 else "IndicatorR")
    body.box(
        (s * (CAB_HW + 0.005), SP["cab_bottom"] + 0.45, FRONT - 0.55),
        (0.03, 0.06, 0.14),
        "IndicatorL" if s > 0 else "IndicatorR",
    )
    # Entry steps ahead of the front wheel, below the door.
    zs0, zs1 = AXLE_F + ARCH_R + 0.04, FRONT - 0.30
    for k, y in enumerate((b0 + 0.06, (b0 + SP["cab_bottom"]) / 2 + 0.06)):
        body.span(s * (CAB_HW - 0.30 + 0.06 * k), s * (CAB_HW - 0.02), y - 0.03, y, zs0, zs1, "Steel")
    # Door seams and handle.
    x = s * (CAB_HW + 0.004)
    for zz in (DOOR_FRONT, DOOR_REAR):
        body.span(
            x - 0.003,
            x + 0.003,
            max(cab_bottom(zz) + 0.06, SP["cab_bottom"] + 0.06),
            HEAD + 0.06,
            zz - 0.006,
            zz + 0.006,
            "Trim",
        )
    body.span(x - 0.003, x + 0.003, HEAD + 0.055, HEAD + 0.065, DOOR_REAR, DOOR_FRONT, "Trim")
    body.span(x - 0.012, x + 0.012, SILL - 0.10, SILL - 0.07, DOOR_REAR + 0.10, DOOR_REAR + 0.26, "Steel")
    # 最大積載量 on both doors (customary; the rear one is the one 保安基準 requires).
    lw = 0.62
    zc = (DOOR_FRONT + DOOR_REAR) / 2
    side_quad(
        body,
        s * (CAB_HW + 0.006),
        s,
        zc + lw / 2,
        zc - lw / 2,
        SILL - 0.42,
        SILL - 0.42 + lw * 96 / 512,
        "Decal",
        atlas_uv(DECALS[SP["load"]], DECAL_TEX),
    )
    # Big mirror on a stay from the A-pillar, and a wide-angle one under it.
    root_p = (s * (CAB_HW - 0.02), HEAD - 0.05, FRONT - 0.28)
    tip = (s * (CAB_HW + 0.26), HEAD - 0.12, FRONT - 0.20)
    body.beam(root_p, tip, 0.035, "Trim")
    body.box((s * (CAB_HW + 0.28), HEAD - 0.35, FRONT - 0.20), (0.07, 0.42, 0.24), "Trim")
    body.box((s * (CAB_HW + 0.28), HEAD - 0.72, FRONT - 0.20), (0.07, 0.20, 0.20), "Trim")
    body.beam(
        (s * (CAB_HW + 0.28), HEAD - 0.12, FRONT - 0.20),
        (s * (CAB_HW + 0.28), HEAD - 0.82, FRONT - 0.20),
        0.025,
        "Trim",
    )
# Sun visor with five marker lamps across the top of the windscreen.
vz = front_z(HEAD + 0.08)
body.span(-CAB_HW + 0.15, CAB_HW - 0.15, HEAD + 0.06, HEAD + 0.10, vz - 0.02, vz + 0.18, "Trim")
for k in range(5):
    body.box(((k - 2) * 0.32, HEAD + 0.12, vz + 0.12), (0.10, 0.04, 0.05), "MarkerLamp")
body.beam((0.05, SB + 0.08, front_z(SB + 0.08) + 0.03), (0.85, SB + 0.10, front_z(SB + 0.10) + 0.03), 0.025, "Trim")
body.beam((-0.95, SB + 0.08, front_z(SB + 0.08) + 0.03), (-0.15, SB + 0.10, front_z(SB + 0.10) + 0.03), 0.025, "Trim")
body.box((CAB_HW - 0.10, ROOF + 0.06, FRONT - 0.30), (0.14, 0.12, 0.14), "Trim")  # 直前直左確認鏡 on the kerb side

# ---------------------------------------------------------------------------- chassis

f0, f1 = SP["frame"]
for s in (1, -1):
    body.span(s * 0.38, s * 0.46, f0, f1, CAB_BACK + 0.6, REAR + 0.25, "Trim")  # frame rails
body.span(-0.46, 0.46, f0, f1 - 0.05, CAB_BACK + 0.1, CAB_BACK + 0.6, "Trim")  # under the cab back
front_rear_gap = (AXLE_F - ARCH_R - 0.10, REAR_AXLES[0] + WHEEL_R + 0.18)
# Fuel tank on the right (−X), battery box and air tanks on the left (+X).
tank_l = min(1.2, front_rear_gap[0] - front_rear_gap[1] - 0.6)
tz = front_rear_gap[0] - 0.25 - tank_l / 2
body.cylinder_z((-(HW - 0.40), f0 - 0.05, tz), 0.26, tank_l, "Steel")
body.span(HW - 0.70, HW - 0.12, f0 - 0.35, f0 + 0.10, tz + tank_l / 2, tz + tank_l / 2 - 0.55, "Trim")
body.cylinder_z((HW - 0.42, f0 - 0.05, tz - 0.55), 0.13, 0.75, "Steel", segs=10)
# 巻き込み防止装置 (side guards) between the front and rear wheels, both sides.
gz0, gz1 = front_rear_gap
for s in (1, -1):
    gx = s * (HW - 0.07)
    for y in (0.42, 0.66):
        body.span(gx - 0.02, gx + 0.02, y, y + 0.07, gz1, gz0, "Steel")
    for z in (gz0 - 0.05, (gz0 + gz1) / 2, gz1 + 0.05):
        body.span(gx - s * 0.03, gx - s * 0.25, 0.42, f0, z - 0.025, z + 0.025, "Trim")
# Mud flaps behind the last rear wheels.
for s in (1, -1):
    body.span(
        s * (SP["track_r"] / 2 - 0.25),
        s * (HW - 0.06),
        0.14,
        min(f1 - 0.05, 0.75),
        REAR_AXLES[-1] - WHEEL_R - 0.22,
        REAR_AXLES[-1] - WHEEL_R - 0.20,
        "Trim",
    )

# Rear under-run bar (突入防止装置), lamps, plate, 大型後部反射器.
bar_z = REAR + (0.18 if SP["body"] == "wing" else 0.12)
body.span(-HW + 0.10, HW - 0.10, 0.42, 0.56, bar_z, bar_z + 0.10, "Trim")
for s in (1, -1):
    body.span(s * 0.40, s * 0.46, 0.50, f0, bar_z + 0.02, bar_z + 0.08, "Trim")  # bar stays
    rear_quad(body, s * 0.95, s * 0.45, 0.43, 0.555, bar_z - 0.002, "Decal", atlas_uv(DECALS["reflector"], DECAL_TEX))
lamp_y = max(f0 + 0.02, 0.70)  # above the under-run bar so the reflectors stay visible
body.span(-HW + 0.12, HW - 0.12, lamp_y - 0.10, lamp_y + 0.10, bar_z + 0.02, bar_z + 0.10, "Trim")  # lamp bar
for s in (1, -1):
    for x, mat in (
        (HW - 0.30, "IndicatorL" if s > 0 else "IndicatorR"),
        (HW - 0.50, "TailLamp"),
        (HW - 0.70, "Reverse"),
    ):
        body.box((s * x, lamp_y, bar_z + 0.005), (0.17, 0.15, 0.03), mat)
rear_quad(
    body, 0.22, -0.22, lamp_y - 0.36, lamp_y - 0.14, bar_z - 0.006, "Plate", atlas_uv(PLATES[SP["plate"]], PLATE_TEX)
)
body.box((0.0, lamp_y - 0.115, bar_z - 0.01), (0.16, 0.03, 0.03), "HeadLamp")  # licence-plate lamp

# ---------------------------------------------------------------------------- load body

load_x = HW - 0.005
if SP["body"] == "wing":
    BOX_FRONT = CAB_BACK - 0.12
    y0, y1 = SP["floor"], HEIGHT
    zf, zr = BOX_FRONT, REAR
    corners = {}
    for x in (-HW, HW):
        for y in (y0, y1):
            for z in (zf, zr):
                corners[x, y, z] = bm.verts.new((x, y, z))

    def c(x, y, z):
        return corners[x, y, z]

    length_m = zf - zr
    # Sides: the 1 m panel texture tiles along the body (u in metres), v spans the full height.
    body.face(
        [c(HW, y0, zf), c(HW, y0, zr), c(HW, y1, zr), c(HW, y1, zf)],
        "Box",
        uvs=[(0, 0), (length_m, 0), (length_m, 1), (0, 1)],
    )
    body.face(
        [c(-HW, y0, zr), c(-HW, y0, zf), c(-HW, y1, zf), c(-HW, y1, zr)],
        "Box",
        uvs=[(0, 0), (length_m, 0), (length_m, 1), (0, 1)],
    )
    body.face(
        [c(-HW, y0, zf), c(HW, y0, zf), c(HW, y1, zf), c(-HW, y1, zf)],
        "Box",
        uvs=[(0, 0), (WIDTH, 0), (WIDTH, 1), (0, 1)],
    )
    body.face(
        [c(HW, y0, zr), c(-HW, y0, zr), c(-HW, y1, zr), c(HW, y1, zr)],
        "Box",
        uvs=[(-HW, 0), (HW, 0), (HW, 1), (-HW, 1)],
    )
    body.face([c(HW, y1, zf), c(HW, y1, zr), c(-HW, y1, zr), c(-HW, y1, zf)], "Box", uvs=[(0.5, 0.5)] * 4)
    body.face([c(HW, y0, zr), c(HW, y0, zf), c(-HW, y0, zf), c(-HW, y0, zr)], "Trim")
    # Sub-frame and cross-members under the floor.
    for s in (1, -1):
        body.span(s * 0.40, s * 0.50, f1, y0, zf - 0.1, zr + 0.1, "Trim")
        body.span(s * (HW - 0.06), s * HW, y0 - 0.10, y0, zf, zr, "Trim")  # side sill
    # Rear frame: corner posts, header, door seam, lock rods and hinges; 最大積載量 on the rear door.
    for s in (1, -1):
        body.span(s * (HW - 0.07), s * (HW + 0.004), y0, y1, zr - 0.012, zr + 0.06, "Steel")
        for k in range(2):
            x = s * (0.30 + 0.62 * k)
            body.span(x - 0.018, x + 0.018, y0 + 0.12, y1 - 0.14, zr - 0.04, zr - 0.006, "Steel")
            for y in (y0 + 0.10, y1 - 0.12):
                body.span(x - 0.04, x + 0.04, y - 0.04, y + 0.04, zr - 0.05, zr - 0.006, "Trim")
        for y in (y0 + 0.4, (y0 + y1) / 2, y1 - 0.4):
            body.span(s * (HW - 0.10), s * (HW - 0.02), y - 0.05, y + 0.05, zr - 0.025, zr, "Trim")  # hinges
    body.span(-HW, HW, y1 - 0.10, y1 + 0.004, zr - 0.012, zr + 0.06, "Steel")
    body.span(-0.006, 0.006, y0 + 0.02, y1 - 0.10, zr - 0.008, zr, "Trim")
    rear_quad(  # on the right-hand door, between its lock rods
        body,
        -0.345,
        -0.875,
        y0 + 0.32,
        y0 + 0.32 + 0.53 * 96 / 512,
        zr - 0.007,
        "Decal",
        atlas_uv(DECALS[SP["load"]], DECAL_TEX),
    )
    for s in (1, -1):
        body.box((s * (HW - 0.15), y1 - 0.05, zr - 0.01), (0.12, 0.05, 0.03), "TailLamp")  # 後部上側端灯
        body.box((s * (HW - 0.15), y1 - 0.05, zf + 0.01), (0.12, 0.05, 0.03), "HeadLamp")  # 前部上側端灯
        n = 6
        for k in range(n):  # 側方灯 along the bottom rail
            z = zf - 0.6 - (length_m - 1.2) * k / (n - 1)
            body.box((s * (HW + 0.006), y0 - 0.05, z), (0.02, 0.05, 0.12), "MarkerLamp")
    # Roof air deflector from the cab roof up to the body.
    w0, w1, yz0 = 1.70, SP["cab_w"] - 0.30, ROOF - 0.01
    za, zb = FRONT - 0.55, CAB_BACK + 0.05
    yt = HEIGHT - 0.08
    p = [
        (-w0 / 2, yz0, za),
        (w0 / 2, yz0, za),
        (w1 / 2, yt, zb),
        (-w1 / 2, yt, zb),
        (w1 / 2, yz0, zb),
        (-w1 / 2, yz0, zb),
    ]
    body.face([p[0], p[1], p[2], p[3]], "Paint", facing=(0, 1, 1))
    body.face([p[1], p[4], p[2]], "Paint", facing=(1, 0, 0))
    body.face([p[0], p[3], p[5]], "Paint", facing=(-1, 0, 0))
    body.face([p[5], p[4], p[2], p[3]], "Paint", facing=(0, 0, -1))
    # Rear tandem mudguard across both axles.
    for s in (1, -1):
        body.span(
            s * (SP["track_r"] / 2 - 0.28),
            s * (HW - 0.04),
            WHEEL_R * 2 + 0.04,
            WHEEL_R * 2 + 0.08,
            REAR_AXLES[0] + WHEEL_R + 0.12,
            REAR_AXLES[-1] - WHEEL_R - 0.12,
            "Trim",
        )
else:
    DECK_FRONT = CAB_BACK - 0.22
    dy = SP["deck"]
    gh = SP["gate_h"]
    zf, zr = DECK_FRONT, REAR
    body.span(-HW, HW, dy - 0.10, dy, zf, zr, "Steel")  # deck frame (side rails)
    body.face(
        [
            (HW - 0.05, dy + 0.002, zf),
            (-HW + 0.05, dy + 0.002, zf),
            (-HW + 0.05, dy + 0.002, zr),
            (HW - 0.05, dy + 0.002, zr),
        ],
        "Deck",
        facing=(0, 1, 0),
    )
    for s in (1, -1):
        body.span(s * 0.38, s * 0.52, f1, dy - 0.10, zf, zr + 0.05, "Trim")  # sub-frame
        # Side gates (アオリ) in three sections with posts between them.
        cuts = [zf, zf - (zf - zr) / 3, zf - 2 * (zf - zr) / 3, zr]
        for za, zb in zip(cuts, cuts[1:], strict=False):
            body.span(s * (HW - 0.05), s * HW, dy, dy + gh, za - 0.012, zb + 0.012, "Aluminium")
            for k in range(1, 3):  # aluminium-block ribs
                y = dy + gh * k / 3
                body.span(s * (HW - 0.001), s * (HW + 0.004), y - 0.006, y + 0.006, za - 0.02, zb + 0.02, "Trim")
        for z in cuts:
            body.span(s * (HW - 0.06), s * (HW + 0.01), dy - 0.10, dy + gh + 0.03, z - 0.03, z + 0.03, "Steel")
        for k in range(8):  # rope hooks under the deck edge
            z = zf - 0.3 - (zf - zr - 0.6) * k / 7
            body.span(s * (HW - 0.02), s * (HW + 0.03), dy - 0.16, dy - 0.10, z - 0.04, z + 0.04, "Steel")
        n = 4
        for k in range(n):  # 側方灯
            z = zf - 0.5 - (zf - zr - 1.0) * k / (n - 1)
            body.box((s * (HW + 0.006), dy - 0.06, z), (0.02, 0.05, 0.12), "MarkerLamp")
    # Rear gate with 最大積載量 (required on the rear), and the headboard (鳥居) behind the cab.
    body.span(-HW, HW, dy, dy + gh, zr + 0.05, zr, "Aluminium")
    for k in range(1, 3):
        y = dy + gh * k / 3
        body.span(-HW + 0.02, HW - 0.02, y - 0.006, y + 0.006, zr - 0.004, zr + 0.01, "Trim")
    rear_quad(
        body, 0.5, -0.5, dy + 0.14, dy + 0.14 + 96 / 512, zr - 0.006, "Decal", atlas_uv(DECALS[SP["load"]], DECAL_TEX)
    )
    hb_top = ROOF - 0.05
    for s in (1, -1):
        body.span(s * (HW - 0.10), s * (HW - 0.02), dy, hb_top, zf - 0.02, zf - 0.10, "Steel")
        body.box((s * (HW - 0.15), dy + gh - 0.05, zr - 0.01), (0.12, 0.05, 0.03), "TailLamp")
    body.span(-HW + 0.02, HW - 0.02, dy, dy + gh + 0.05, zf - 0.04, zf - 0.08, "Aluminium")
    for y in (hb_top - 0.04, hb_top - 0.42, dy + gh + 0.28):
        body.span(-HW + 0.10, HW - 0.10, y - 0.04, y + 0.04, zf - 0.04, zf - 0.09, "Steel")
    for x in (-0.6, 0.0, 0.6):
        body.span(x - 0.02, x + 0.02, dy + gh, hb_top, zf - 0.05, zf - 0.08, "Steel")

# Front-wheel arch baffle (see-through) under the cab.
for s in (1, -1):
    body.face(
        [
            (0.0, 0.2, AXLE_F - ARCH_R),
            (0.0, 0.2, AXLE_F + ARCH_R),
            (0.0, cab_bottom(AXLE_F), AXLE_F + ARCH_R),
            (0.0, cab_bottom(AXLE_F), AXLE_F - ARCH_R),
        ],
        "Trim",
        facing=(s, 0, 0),
    )

root = bpy.data.objects.new(SP["name"], None)
SCENE.collection.objects.link(root)
body_ob = body.obj("Body", root)


# ---------------------------------------------------------------------------- wheels


def wheel(name, x, z, side, dual):
    """Tyre lathe (one tyre or a twin pair) + flat steel-wheel face; axle along X, origin at the hub."""
    m = Mesh(["Wheel"])
    segs = 18
    w = SP["tyre_w"] + (SP["dual"] if dual else 0.0)
    R, r = WHEEL_R, SP["rim_r"]
    prof = [(-w / 2 + 0.01, r), (-w / 2, R - 0.07), (-w / 2 + 0.04, R - 0.005)]
    if dual:
        prof += [(-0.03, R - 0.005), (0.0, R - 0.09), (0.03, R - 0.005)]
    prof += [(w / 2 - 0.04, R - 0.005), (w / 2, R - 0.07), (w / 2 - 0.01, r)]
    prof = [(side * dx, rr) for dx, rr in prof]
    grid = []
    for k in range(segs + 1):
        a = 2 * math.pi * k / segs
        grid.append([m.bm.verts.new((dx, rr * math.cos(a), rr * math.sin(a))) for dx, rr in prof])
    for k in range(segs):
        for i in range(len(prof) - 1):
            f = m.face([grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]], "Wheel")
            u0, u1 = 0.5 + 0.5 * i / (len(prof) - 1), 0.5 + 0.5 * (i + 1) / (len(prof) - 1)
            v0, v1 = k / segs, (k + 1) / segs
            for loop, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], strict=True):
                loop[m.uv].uv = uv
    for col, outer in ((-1, True), (0, False)):
        pts, uvs = [], []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            pts.append(grid[k][col])
            uvs.append((0.25 + 0.248 * math.cos(a), 0.5 + 0.496 * math.sin(a)) if outer else (0.52, 0.5))
        m.face(pts, "Wheel", uvs=uvs)
    bmesh.ops.remove_doubles(m.bm, verts=m.bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(m.bm, faces=m.bm.faces)
    ob = m.obj(name, root)
    ob.location = (x, WHEEL_R, z)
    return ob


wheels = [
    wheel("WheelFL", SP["track_f"] / 2, AXLE_F, 1, False),
    wheel("WheelFR", -SP["track_f"] / 2, AXLE_F, -1, False),
]
for k, z in enumerate(REAR_AXLES):
    tag = "R" if len(REAR_AXLES) == 1 else f"R{k + 1}"
    wheels.append(wheel(f"Wheel{tag}L", SP["track_r"] / 2, z, 1, True))
    wheels.append(wheel(f"Wheel{tag}R", -SP["track_r"] / 2, z, -1, True))

root["length"] = LENGTH
root["width"] = WIDTH
root["height"] = HEIGHT
root["frontAxleZ"] = AXLE_F
root["rearAxlesZ"] = REAR_AXLES
root["rearAxleZ"] = PIVOT_Z  # the tandem turns about the point midway between its axles
root["wheelbase"] = round(AXLE_F - PIVOT_Z, 4)
root["wheelRadius"] = WHEEL_R
root["trackFront"] = SP["track_f"]
root["trackRear"] = SP["track_r"]
root["maxPayloadKg"] = SP["payload"]
root["grossWeightKg"] = SP["gvw"]

# ---------------------------------------------------------------------------- export

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
    export_draco_mesh_compression_level=6,
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SCENE.objects if o.type == "MESH"}
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris, total=sum(tris.values()))

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    material("Ground", 0x6A6D70, roughness=0.9)
    gm = Mesh(["Ground"])
    gm.face([(-30, 0, -30), (-30, 0, 30), (30, 0, 30), (30, 0, -30)], "Ground", facing=(0, 1, 0))
    gm.obj("Ground")
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.68, 0.8, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(-60), math.radians(35), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 35
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = int(os.environ.get("PREVIEW_SAMPLES", "32"))
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    k = LENGTH / 10.5
    views = {
        "front-left": ((8.0 * k, 3.2, 10.0 * k), (0.0, 1.5, 1.5 * k)),
        "rear-right": ((-8.0 * k, 3.4, -10.0 * k), (0.0, 1.5, -1.5 * k)),
        "left": ((16.0 * k, 1.8, 0.0), (0.0, 1.6, 0.0)),
        "right": ((-16.0 * k, 1.8, 0.0), (0.0, 1.6, 0.0)),
        "front": ((0.0, 2.2, FRONT + 7.0), (0.0, 1.6, 0.0)),
        "rear": ((0.0, 2.2, REAR - 7.0), (0.0, 1.6, 0.0)),
    }
    for view, (eye, target) in views.items():
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"truck{VARIANT}-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
