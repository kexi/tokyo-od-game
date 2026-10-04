# 大型路線バス（ノンステップ、都市型 前乗り中降り）for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/bus.py -- public/models/bus.glb [preview-dir]
#
# Game coordinates (+Y up, nose toward +Z, ground at y = 0, the bus's left = +X, the kerb side in
# Japan), exported with export_yup=False. 10.50 × 2.49 × 3.10 m, wheelbase 5.30 m (front axle
# z = +2.80, rear axle z = −2.50), 275/70R22.5 tyres; the figures sit inside the public data of
# Japanese 10.4–10.7 m low-floor city buses (see knowledge/large-vehicles-blender.md).
#
# Nodes under the root "Bus" (whose extras carry the dimensions and axle positions):
#   Body                      everything static, one mesh (one draw call per material)
#   WheelFL/FR/RL/RR          origin at the hub, axle along X (spin about local X); the rear ones
#                             are dual tyres. FL/RL are on the left (+X).
#   DoorFrontA/DoorFrontB     the two leaves of the front door (左側), origin on the hinge line;
#                             open = rotate about Y by extras.openAngle (folding inward)
#   DoorMiddle                the middle door leaf; open = translate by extras.openOffset (slides
#                             rearward behind the body side)
# Lamp materials keep car.glb's names (HeadLamp, TailLamp, IndicatorL/R, Reverse) plus MarkerLamp
# (amber side markers); Dest is the LED destination display (emissive texture).
# Textures: assets/bus/textures (scripts/textures/bus_textures.py).
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "bus.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "bus", "textures")

LENGTH, WIDTH, HEIGHT = 10.50, 2.49, 3.10
FRONT, REAR = LENGTH / 2, -LENGTH / 2
HW = WIDTH / 2
ROOF = 2.98  # body roof; the air-conditioner pod brings the total to HEIGHT
AXLE_F, AXLE_R = 2.80, -2.50
WHEEL_R = 0.478  # 275/70R22.5
TYRE_W = 0.275
RIM_R = 0.29
TRACK_F, TRACK_R = 2.06, 1.82
DUAL = 0.32  # centre-to-centre of the rear twin tyres
ARCH_R = 0.56
CORNER_R = 0.15  # plan radius of the four vertical corners
ROOF_R = 0.26
DOOR_F = (4.90, 3.95)  # front door opening, z from → to (left side)
DOOR_M = (0.55, -0.55)  # middle door opening
DOOR_BOTTOM, DOOR_HEAD = 0.30, 2.30
SILL, WIN_HEAD, RAIL = 1.28, 2.50, 2.74
SCREEN_BOTTOM = 1.10
WIN_REAR = -4.80  # last side window ends here

# Atlas boxes (pixels, top-left origin) shared with scripts/textures/bus_textures.py.
DEST_TEX = (1024, 256)
DEST = {"front": (0, 0, 1024, 160), "side": (0, 160, 512, 256), "rear": (512, 160, 896, 256)}
DECAL_TEX = (2048, 512)
DECALS = {
    "side": (0, 0, 2048, 320),
    "front": (0, 320, 768, 512),
    "rear": (768, 320, 1536, 512),
    "nonstep": (1536, 320, 2048, 384),
    "entry": (1536, 384, 1664, 448),
    "exit": (1664, 384, 1792, 448),
    "oneman": (1792, 384, 2048, 448),
    "louvre": (1536, 448, 2048, 512),
}
BAND_Y0, BAND_Y1 = 0.25, 1.25  # metres covered by the livery band (bottom → top of its box)


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
    """Principled material; emissive = hex colour, or True to glow with the texture."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    tex = None
    if image:
        path = os.path.join(TEX, image)
        if os.path.exists(path):
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.get(image) or bpy.data.images.load(path)
            nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
            if clip:
                rnd = nt.nodes.new("ShaderNodeMath")
                rnd.operation = "ROUND"  # glTF alphaMode MASK: crisp decal edges
                nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
                nt.links.new(rnd.outputs[0], b.inputs["Alpha"])
        else:
            log("texture_missing", file=image)
    if emissive is True and tex is not None:
        nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.0
    elif emissive is not None and emissive is not True:
        b.inputs["Emission Color"].default_value = lin(emissive)
        b.inputs["Emission Strength"].default_value = 1.0
    MAT[name] = m
    return m


material("Paint", 0xF1F0EA, metallic=0.1, roughness=0.35)  # ivory body; the livery is a decal
material("Trim", 0x1C1E21, roughness=0.6)  # black pillars, display surround, bumpers, underbody
material("Glass", 0x121A22, metallic=0.4, roughness=0.08)
material("Interior", 0x45484D, roughness=0.85)  # door wells
material("Decal", 0xFFFFFF, roughness=0.4, image="bus_decals.png", clip=True)
material("Dest", 0xFFFFFF, roughness=0.3, image="bus_dest.png", emissive=True)
material("Plate", 0xFFFFFF, roughness=0.45, image="bus_plate.png")
material("HeadLamp", 0xF4F6F8, roughness=0.1, emissive=0xFFF4DE)
material("TailLamp", 0x8A0A0A, roughness=0.15, emissive=0xFF2A1A)
material("IndicatorL", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("IndicatorR", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("Reverse", 0xDADDE0, roughness=0.1, emissive=0xFFFFFF)
material("MarkerLamp", 0xC96A00, roughness=0.2, emissive=0xFF8A00)
material("Wheel", 0xFFFFFF, roughness=0.7, image="bus_wheel.png")


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

    def beam(self, p0, p1, thickness, mat):
        """Square bar from p0 to p1."""
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        rot = axis.to_track_quat("Z", "Y").to_matrix()
        self.box((p0 + p1) / 2, (thickness, thickness, axis.length), mat, rot=rot)

    def obj(self, name, parent=None, origin=(0.0, 0.0, 0.0), smooth=False):
        bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=-Vector(origin))
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        for p in me.polygons:
            p.use_smooth = smooth
        ob = bpy.data.objects.new(name, me)
        ob.location = origin
        SCENE.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        return ob


def atlas_uv(box, tex, u0=0.0, v0=0.0, u1=1.0, v1=1.0):
    """UV of the fractional rectangle (u0..u1, v0..v1, v up) inside an atlas pixel box."""
    x0, y0, x1, y1 = box
    w, h = tex

    def at(u, v):
        return ((x0 + (x1 - x0) * u) / w, 1 - (y1 - (y1 - y0) * v) / h)

    return at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)


def side_quad(m, side, z0, z1, y0, y1, mat, uv, offset=0.004, x=None):
    """Quad on the body side (side = +1 left, −1 right) from z0 to z1 (any order), y0 → y1.
    uv = (bottom-left, bottom-right, top-right, top-left) as seen from outside."""
    x = side * (HW + offset) if x is None else x
    # Seen from outside, the left side runs front → rear left to right, the right side the reverse.
    za, zb = (max(z0, z1), min(z0, z1)) if side > 0 else (min(z0, z1), max(z0, z1))
    return m.face([(x, y0, za), (x, y0, zb), (x, y1, zb), (x, y1, za)], mat, uvs=uv, facing=(side, 0, 0))


# ---------------------------------------------------------------------------- body loft


def rake(y):
    """How far the front face leans back at height y (windscreen and destination display)."""
    return 0.0 if y <= SCREEN_BOTTOM else 0.17 * (y - SCREEN_BOTTOM) / (ROOF - SCREEN_BOTTOM)


def rake_weight(z):
    """1 on the front face and its rounded corners, ramping to 0 behind the A-pillar."""
    return min(1.0, max(0.0, (z - (FRONT - 0.30)) / 0.15))


def half_width_at(z):
    for end, sign in ((FRONT, 1), (REAR, -1)):
        d = (z - (end - sign * CORNER_R)) * sign
        if d > 0:
            return HW - CORNER_R + math.sqrt(max(CORNER_R**2 - d * d, 0.0))
    return HW


def top_at(z):
    r = 0.12
    for end, sign in ((FRONT, 1), (REAR, -1)):
        d = (z - (end - sign * r)) * sign
        if d > 0:
            return ROOF - r + math.sqrt(max(r * r - d * d, 0.0))
    return ROOF


def bottom_at(z):
    if z > AXLE_F + ARCH_R:
        y = 0.28 + 0.04 * (z - AXLE_F - ARCH_R) / (FRONT - AXLE_F - ARCH_R)
    elif z < AXLE_R - ARCH_R:
        y = 0.30 + 0.15 * ((AXLE_R - ARCH_R - z) / (AXLE_R - ARCH_R - REAR)) ** 2
    else:
        y = 0.24
    for axle in (AXLE_F, AXLE_R):
        dz = abs(z - axle)
        if dz < ARCH_R:
            y = max(y, WHEEL_R + math.sqrt(ARCH_R**2 - dz**2) * 0.98)
    return y


LEVELS = [DOOR_BOTTOM, SCREEN_BOTTOM, SILL, DOOR_HEAD, WIN_HEAD, RAIL]


def section(z):
    """Chains (right = +X, left = −X) from the bottom edge up to the roof centre, same length at
    every station so the stations loft together; levels that do not fit collapse together."""
    hw, top, bottom = half_width_at(z), top_at(z), bottom_at(z)
    r = min(ROOF_R, (top - bottom) * 0.3, hw * 0.9)
    lo, hi = bottom + 0.06, top - r - 0.01
    n = len(LEVELS)
    levels = [min(max(y, lo + 0.002 * k), hi - 0.002 * (n - k)) for k, y in enumerate(LEVELS)]
    chain = [(hw - 0.04, bottom), (hw, bottom + 0.05)] + [(hw, y) for y in levels]
    for k in range(5):
        a = math.radians(90 * k / 4)
        chain.append((hw - r + r * math.cos(a), top - r + r * math.sin(a)))
    return chain


stations = {FRONT, REAR, *DOOR_F, *DOOR_M, FRONT - 0.30, WIN_REAR, REAR + 0.30}
for end, sign in ((FRONT, 1), (REAR, -1)):
    for phi in (0, 35, 65, 85):
        stations.add(round(end - sign * CORNER_R * (1 - math.sin(math.radians(phi))), 4))
for axle in (AXLE_F, AXLE_R):
    for k in range(-3, 4):
        stations.add(round(axle + ARCH_R * 1.02 * k / 3, 4))
stations = sorted(stations, reverse=True)

BODY_MATS = [
    "Paint",
    "Trim",
    "Glass",
    "Interior",
    "Decal",
    "Dest",
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


def placed(x, y, z):
    return (x, y, z - rake(y) * rake_weight(z))


rings = []  # per station: (right chain verts, left chain verts)
for z in stations:
    chain = section(z)
    right = [bm.verts.new(placed(x, y, z)) for x, y in chain]
    left = [bm.verts.new(placed(-x, y, z)) for x, y in chain]
    rings.append((right, left))


def in_door(z):
    return DOOR_F[1] < z < DOOR_F[0] or DOOR_M[1] < z < DOOR_M[0]


def side_material(c, side):
    """Material of a side-wall face by its centre (window band, A-pillar, wrap-round screen)."""
    if c.z > FRONT - 0.155:  # rounded front corners: the windscreen wraps round them
        if SCREEN_BOTTOM < c.y < WIN_HEAD:
            return "Glass"
        return "Trim" if c.y > WIN_HEAD else "Paint"
    if c.z > FRONT - 0.31 and SCREEN_BOTTOM < c.y < RAIL:
        return "Trim"  # black A-pillar
    if side > 0 and in_door(c.z) and c.y > DOOR_HEAD - 0.01:
        return "Paint"  # header above a door
    if SILL < c.y < WIN_HEAD and WIN_REAR < c.z < FRONT - 0.30:
        return "Glass"
    return "Paint"


door_faces = []
for (za, (ra, la)), (zb, (rb, lb)) in zip(
    zip(stations, rings, strict=True), zip(stations[1:], rings[1:], strict=True), strict=False
):
    for chain_a, chain_b, side in ((ra, rb, 1), (la, lb, -1)):
        for i in range(len(chain_a) - 1):
            a0, a1, b0, b1 = chain_a[i], chain_a[i + 1], chain_b[i], chain_b[i + 1]
            if (a0.co - a1.co).length < 1e-4 and (b0.co - b1.co).length < 1e-4:
                continue  # collapsed level
            f = bm.faces.new((a0, b0, b1, a1) if side > 0 else (a0, a1, b1, b0))
            c = f.calc_center_median()
            c.z = (za + zb) / 2  # classify by the station, not the raked position
            f.material_index = BODY_MATS.index(side_material(c, side))
            is_door = side > 0 and in_door(c.z) and DOOR_BOTTOM < c.y < DOOR_HEAD and i >= 2
            if is_door:
                door_faces.append(f)
    # Underside between the two chains.
    f = bm.faces.new((ra[0], la[0], lb[0], rb[0]))
    f.material_index = BODY_MATS.index("Trim")
    # Roof centre strip.
    f = bm.faces.new((ra[-1], rb[-1], lb[-1], la[-1]))
    f.material_index = BODY_MATS.index("Paint")
bmesh.ops.delete(bm, geom=door_faces, context="FACES")


def cap(ring, facing):
    """Front / rear face as a strip of trapezoids between the right and left chains."""
    right, left = ring
    for i in range(len(right) - 1):
        if (right[i].co - right[i + 1].co).length < 1e-4:
            continue
        f = bm.faces.new((right[i], left[i], left[i + 1], right[i + 1]))
        f.normal_update()
        if f.normal.z * facing < 0:
            f.normal_flip()
        y = f.calc_center_median().y
        mat = "Paint"
        if facing > 0 and SCREEN_BOTTOM < y < WIN_HEAD:
            mat = "Glass"
        elif facing > 0 and y > WIN_HEAD:
            mat = "Trim"
        f.material_index = BODY_MATS.index(mat)


cap(rings[0], 1)
cap(rings[-1], -1)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
# The loft quads were wound outward by construction; make the whole shell consistent.
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def front_z(y):
    return FRONT - rake(y)


def front_quad(x0, x1, y0, y1, mat, uv, offset=0.005):
    """Quad on the raked front face. Seen from the front the bus's left (+X) is on the right, so
    x0 < x1 reads left to right."""
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return body.face([(x, y, front_z(y) + offset) for x, y in pts], mat, uvs=uv, facing=(0, 0, 1))


def rear_quad(x0, x1, y0, y1, mat, uv, offset=0.005):
    """Quad on the rear face. Seen from behind +X is on the left, so x0 > x1 reads left to right."""
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return body.face([(x, y, REAR - offset) for x, y in pts], mat, uvs=uv, facing=(0, 0, -1))


FULL = ((0, 0), (1, 0), (1, 1), (0, 1))

# ---- front: destination display, bumper, lamps, plate, wipers, ワンマン sign
fw = HW - CORNER_R - 0.05
front_quad(-0.875, 0.875, 2.555, 2.825, "Dest", atlas_uv(DEST["front"], DEST_TEX))
by0, by1 = bottom_at(FRONT), SCREEN_BOTTOM - 0.02
front_quad(
    -fw, fw, by0, by1, "Decal", atlas_uv(DECALS["front"], DECAL_TEX, 0, (by0 - BAND_Y0), 1, (by1 - BAND_Y0)), 0.003
)
body.box((0.0, 0.42, FRONT + 0.035), (2.36, 0.26, 0.09), "Trim")  # bumper
front_quad(-0.22, 0.22, 0.31, 0.53, "Plate", FULL, 0.085)
for s in (1, -1):
    for x in (0.66, 0.86):
        body.box((s * x, 0.64, FRONT + 0.005), (0.17, 0.12, 0.04), "HeadLamp")
    body.box((s * 1.02, 0.64, FRONT - 0.01), (0.10, 0.12, 0.04), "IndicatorL" if s > 0 else "IndicatorR")
    body.box((s * 0.76, 0.785, FRONT + 0.0), (0.38, 0.05, 0.03), "MarkerLamp")  # front position lamps
    body.box((s * 0.80, 2.90, front_z(2.90) + 0.01), (0.10, 0.04, 0.03), "HeadLamp")  # upper clearance lamps
# Wipers resting along the bottom of the windscreen.
body.beam((0.05, 1.17, front_z(1.17) + 0.03), (0.85, 1.20, front_z(1.20) + 0.03), 0.025, "Trim")
body.beam((-0.95, 1.17, front_z(1.17) + 0.03), (-0.15, 1.20, front_z(1.20) + 0.03), 0.025, "Trim")
front_quad(0.70, 0.95, 1.13, 1.255, "Decal", atlas_uv(DECALS["oneman"], DECAL_TEX), 0.006)
# Rabbit-ear mirrors: arms forward and down from the roof corners, heads ahead of the A-pillars.
for s in (1, -1):
    root_p = (s * 1.10, 2.78, FRONT - 0.30)
    elbow = (s * 1.36, 2.62, FRONT + 0.30)
    head = (s * 1.38, 2.10, FRONT + 0.36)
    body.beam(root_p, elbow, 0.04, "Trim")
    body.beam(elbow, head, 0.035, "Trim")
    body.box((s * 1.38, 2.05, FRONT + 0.36), (0.07, 0.40, 0.26), "Trim")
    body.box((s * 1.415, 2.05, FRONT + 0.36), (0.005, 0.36, 0.22), "Glass", rot=Matrix.Rotation(s * 0.5, 3, "Y"))
body.box((0.95, 2.60, FRONT + 0.10), (0.16, 0.10, 0.12), "Trim")  # under-mirror on the kerb side

# ---- rear: window with display, engine louvre, lamp clusters, bumper, plate
rw = HW - CORNER_R - 0.05
rear_quad(0.95, -0.95, 2.02, 2.58, "Glass", FULL, 0.004)
rear_quad(0.45, -0.45, 2.32, 2.54, "Dest", atlas_uv(DEST["rear"], DEST_TEX), 0.007)
ry0 = bottom_at(REAR)
rear_quad(rw, -rw, ry0, BAND_Y1, "Decal", atlas_uv(DECALS["rear"], DECAL_TEX, 0, (ry0 - BAND_Y0), 1, 1.0), 0.003)
rear_quad(0.80, -0.80, 1.30, 1.80, "Decal", atlas_uv(DECALS["louvre"], DECAL_TEX), 0.006)
body.box((0.0, 0.47, REAR - 0.03), (2.36, 0.22, 0.08), "Trim")  # bumper
rear_quad(0.22, -0.22, 0.62, 0.84, "Plate", FULL, 0.012)
body.box((0.0, 0.89, REAR - 0.012), (0.20, 0.04, 0.03), "HeadLamp")  # licence-plate lamp
body.box((0.0, 2.66, REAR - 0.01), (0.40, 0.05, 0.03), "TailLamp")  # high-mount stop lamp
for s in (1, -1):
    x = s * (HW - 0.17)
    body.box((x, 1.10, REAR - 0.01), (0.16, 0.13, 0.04), "IndicatorL" if s > 0 else "IndicatorR")
    body.box((x, 0.93, REAR - 0.01), (0.16, 0.19, 0.04), "TailLamp")
    body.box((x, 0.78, REAR - 0.01), (0.16, 0.10, 0.04), "Reverse")
    body.box((s * 0.80, 2.88, REAR - 0.01), (0.10, 0.04, 0.03), "TailLamp")  # upper clearance lamps

# ---- sides: livery band (split round the arches and doors), stickers, side display, lamps
band_stations = [z for z in stations if REAR + CORNER_R <= z <= FRONT - CORNER_R]
for side in (1, -1):
    for za, zb in zip(band_stations, band_stations[1:], strict=False):
        zm = (za + zb) / 2
        if side > 0 and in_door(zm):
            continue  # the door leaves carry their own piece of the band
        # The side wall starts 5 cm above the body's lower edge (the skirt chamfer).
        ya, yb = (max(BAND_Y0, bottom_at(z) + 0.05) for z in (za, zb))
        if min(ya, yb) >= BAND_Y1 - 0.01:
            continue
        ua, ub = (FRONT - za) / LENGTH, (FRONT - zb) / LENGTH
        x = side * (HW + 0.003)
        # u runs front → rear on both sides: the stripes sweep up toward the rear on each side.
        pts = [(x, ya, za), (x, yb, zb), (x, BAND_Y1, zb), (x, BAND_Y1, za)]
        uvs = []
        for (_, y, _z), u in zip(pts, (ua, ub, ub, ua), strict=True):
            uvs.append(atlas_uv(DECALS["side"], DECAL_TEX, u, (y - BAND_Y0) / (BAND_Y1 - BAND_Y0), u, 0)[0])
        body.face(pts, "Decal", uvs=uvs, facing=(side, 0, 0))
    side_quad(body, side, -0.75, -1.75, 1.02, 1.145, "Decal", atlas_uv(DECALS["nonstep"], DECAL_TEX), 0.005)
    for z in (1.55, -1.25, -3.75):
        body.box((side * (HW + 0.008), 0.40, z), (0.02, 0.05, 0.10), "MarkerLamp")
    body.box((side * (HW + 0.01), 0.88, 3.62), (0.03, 0.06, 0.14), "IndicatorL" if side > 0 else "IndicatorR")
# Wheel-arch baffles so the far side does not show through the arch tunnels.
for axle in (AXLE_F, AXLE_R):
    for s in (1, -1):
        body.face(
            [
                (0.0, 0.2, axle - ARCH_R),
                (0.0, 0.2, axle + ARCH_R),
                (0.0, 1.05, axle + ARCH_R),
                (0.0, 1.05, axle - ARCH_R),
            ],
            "Trim",
            facing=(s, 0, 0),
        )
side_quad(body, 1, 3.25, 2.05, 2.22, 2.44, "Dest", atlas_uv(DEST["side"], DEST_TEX), offset=0.005)
# Black window pillars, a few millimetres proud of the glass.
for side in (1, -1):
    pillars = [-2.05, -3.45] + ([2.25, 1.30] if side < 0 else [1.95, 0.62, -0.62])  # clear of the side display
    for z in pillars:
        body.box((side * (HW + 0.004), (SILL + WIN_HEAD) / 2, z), (0.008, WIN_HEAD - SILL, 0.07), "Trim")
    if side < 0:
        body.box((side * (HW + 0.004), (SILL + WIN_HEAD) / 2, 3.95), (0.008, WIN_HEAD - SILL, 0.07), "Trim")

# ---- door wells (seen through an open door)
for z0, z1, depth in ((DOOR_F[0], DOOR_F[1], 0.75), (DOOR_M[0], DOOR_M[1], 0.65)):
    xi, xo = HW - depth, HW - 0.02
    y0, y1 = 0.33, DOOR_HEAD
    body.face([(xo, y0, z0), (xo, y0, z1), (xi, y0, z1), (xi, y0, z0)], "Interior", facing=(0, 1, 0))  # step
    body.face([(xi, y0, z0), (xi, y0, z1), (xi, y1, z1), (xi, y1, z0)], "Interior", facing=(1, 0, 0))  # back
    body.face([(xo, y1, z0), (xi, y1, z0), (xi, y1, z1), (xo, y1, z1)], "Interior", facing=(0, -1, 0))
    body.face([(xo, y0, z0), (xi, y0, z0), (xi, y1, z0), (xo, y1, z0)], "Interior", facing=(0, 0, -1))
    body.face([(xo, y0, z1), (xi, y0, z1), (xi, y1, z1), (xo, y1, z1)], "Interior", facing=(0, 0, 1))

# ---- roof: air-conditioner pod and an escape hatch
body.box((0.0, ROOF + 0.05, 0.55), (2.02, 0.10, 2.70), "Paint")
body.box((0.0, ROOF + 0.11, 0.55), (1.80, 0.04, 2.50), "Paint")
body.box((0.0, ROOF + 0.02, -2.60), (0.70, 0.05, 0.70), "Trim")

bus = bpy.data.objects.new("Bus", None)
SCENE.collection.objects.link(bus)
body_ob = body.obj("Body", bus)


# ---------------------------------------------------------------------------- doors


def door_leaf(name, z_from, z_to, x_out, origin, sticker=None):
    """One leaf: kick panel with its piece of the livery, glass, top rail. Built in place, origin
    at `origin` (the hinge or reference point)."""
    m = Mesh(["Paint", "Glass", "Decal"])
    za, zb = max(z_from, z_to), min(z_from, z_to)
    zc, w, t = (za + zb) / 2, za - zb - 0.01, 0.03
    xc = x_out - t / 2
    glass0 = 0.86
    m.box((xc, (0.34 + glass0) / 2, zc), (t, glass0 - 0.34, w), "Paint")
    m.box((xc, (glass0 + 2.22) / 2, zc), (t * 0.6, 2.22 - glass0, w - 0.06), "Glass")
    m.box((xc, (2.22 + DOOR_HEAD - 0.01) / 2, zc), (t, DOOR_HEAD - 0.01 - 2.22, w), "Paint")
    for zz in (za - 0.03, zb + 0.03):  # vertical frames
        m.box((xc, (glass0 + 2.22) / 2, zz), (t, 2.22 - glass0, 0.05), "Paint")
    ua, ub = (FRONT - za) / LENGTH, (FRONT - zb) / LENGTH
    v1 = (glass0 - BAND_Y0) / (BAND_Y1 - BAND_Y0)
    v0 = (0.34 - BAND_Y0) / (BAND_Y1 - BAND_Y0)
    side_quad(m, 1, za, zb, 0.34, glass0, "Decal", atlas_uv(DECALS["side"], DECAL_TEX, ua, v0, ub, v1), x=x_out + 0.003)
    if sticker:
        sz = zc
        side_quad(
            m, 1, sz + 0.10, sz - 0.10, 1.45, 1.55, "Decal", atlas_uv(DECALS[sticker], DECAL_TEX), x=x_out + 0.002
        )
    return m.obj(name, bus, origin=origin)


mid_f = (DOOR_F[0] + DOOR_F[1]) / 2
leaf_a = door_leaf("DoorFrontA", DOOR_F[0], mid_f, HW - 0.004, (HW - 0.02, DOOR_BOTTOM, DOOR_F[0]))
leaf_b = door_leaf("DoorFrontB", mid_f, DOOR_F[1], HW - 0.004, (HW - 0.02, DOOR_BOTTOM, DOOR_F[1]), "entry")
leaf_m = door_leaf("DoorMiddle", DOOR_M[0], DOOR_M[1], HW - 0.035, (HW - 0.05, DOOR_BOTTOM, DOOR_M[0]), "exit")
# Opening: the front leaves fold inward about their hinges, the middle leaf slides rearward.
leaf_a["openAngle"] = 1.40
leaf_b["openAngle"] = -1.40
leaf_m["openOffset"] = [0.0, 0.0, -(DOOR_M[0] - DOOR_M[1]) - 0.02]


# ---------------------------------------------------------------------------- wheels


def wheel(name, x, z, side, dual):
    """Tyre lathe (one tyre or a twin pair) + flat steel-wheel face; axle along X, origin at the hub."""
    m = Mesh(["Wheel"])
    segs = 18
    w = TYRE_W + (DUAL if dual else 0.0)
    R, r = WHEEL_R, RIM_R
    prof = [(-w / 2 + 0.01, r), (-w / 2, R - 0.07), (-w / 2 + 0.04, R - 0.005)]
    if dual:
        prof += [(-0.03, R - 0.005), (0.0, R - 0.09), (0.03, R - 0.005)]
    prof += [(w / 2 - 0.04, R - 0.005), (w / 2, R - 0.07), (w / 2 - 0.01, r)]
    prof = [(side * dx, rr) for dx, rr in prof]  # outer face toward the outside of the bus
    grid = []
    for k in range(segs + 1):
        a = 2 * math.pi * k / segs
        grid.append([m.bm.verts.new((dx, rr * math.cos(a), rr * math.sin(a))) for dx, rr in prof])
    for k in range(segs):
        for i in range(len(prof) - 1):
            f = m.face([grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]], "Wheel")
            u0, u1 = 0.5 + 0.5 * i / (len(prof) - 1), 0.5 + 0.5 * (i + 1) / (len(prof) - 1)
            for loop, uv in zip(
                f.loops, [(u0, k / segs), (u1, k / segs), (u1, (k + 1) / segs), (u0, (k + 1) / segs)], strict=True
            ):
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
    ob = m.obj(name, bus)
    ob.location = (x, WHEEL_R, z)
    return ob


wheels = [
    wheel("WheelFL", TRACK_F / 2, AXLE_F, 1, False),
    wheel("WheelFR", -TRACK_F / 2, AXLE_F, -1, False),
    wheel("WheelRL", TRACK_R / 2, AXLE_R, 1, True),
    wheel("WheelRR", -TRACK_R / 2, AXLE_R, -1, True),
]

bus["length"] = LENGTH
bus["width"] = WIDTH
bus["height"] = HEIGHT
bus["wheelbase"] = round(AXLE_F - AXLE_R, 4)
bus["frontAxleZ"] = AXLE_F
bus["rearAxleZ"] = AXLE_R
bus["wheelRadius"] = WHEEL_R
bus["trackFront"] = TRACK_F
bus["trackRear"] = TRACK_R

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
    views = {
        "front-left": ((9.0, 3.0, 11.0), (0.0, 1.4, 1.5)),
        "rear-right": ((-9.0, 3.2, -11.0), (0.0, 1.4, -1.5)),
        "left": ((16.0, 1.6, 0.0), (0.0, 1.5, 0.0)),
        "right": ((-16.0, 1.6, 0.0), (0.0, 1.5, 0.0)),
        "front": ((0.0, 2.0, 12.0), (0.0, 1.6, 0.0)),
        "rear": ((0.0, 2.0, -12.0), (0.0, 1.6, 0.0)),
        "doors-open": ((7.0, 1.8, 3.5), (0.5, 1.2, 1.5)),
    }
    for view, (eye, target) in views.items():
        is_open = view == "doors-open"
        leaf_a.rotation_euler.y = leaf_a["openAngle"] if is_open else 0.0
        leaf_b.rotation_euler.y = leaf_b["openAngle"] if is_open else 0.0
        leaf_m.location.z = DOOR_M[0] + (leaf_m["openOffset"][2] if is_open else 0.0)
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"bus-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
