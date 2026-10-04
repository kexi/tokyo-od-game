# 250 cc motorcycle (軽二輪, ridden on a 普通自動二輪免許) with its rider, for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/motorbike.py -- public/models/motorbike.glb [preview-dir]
#
# Game coordinates (+Y up, nose toward +Z, ground at y = 0, the rider's left = +X), exported with
# export_yup=False; the origin is the middle of the overall length. 2.05 × 0.78 × 1.06 m,
# wheelbase 1.38 m, 110/70-17 and 140/70-17 tyres, 25° rake, seat 0.79 m: inside the public
# figures of Japanese 250 cc road bikes (knowledge/large-vehicles-blender.md).
#
# Nodes under the root "Motorbike" (extras = dimensions, axles, steering axis):
#   Body          frame, tank, seat, engine, exhaust, swingarm, lamps, rear plate (rear only)
#   Steer         fork, handlebar, headlight, front indicators and fender; its local +Y is the
#                 steering axis (tilted 25° back), so steering = rotation about local Y
#     WheelFront  origin at the front axle, axle along X (spin about local X)
#   WheelRear     origin at the rear axle
#   Rider         the rider, jointed like human.glb: Torso (pivot at the hips) → Head (neck),
#                 UpperArmL/R (shoulders) → ForearmL/R (elbows); ThighL/R (hips) → ShinL/R
#                 (knees). Limbs are modelled hanging down and posed by node rotations (about X,
#                 negative = forward, as in src/world/human.ts), so the game can re-pose them.
# Lamp materials keep car.glb's names (HeadLamp, TailLamp, IndicatorL/R). Paint is the tank and
# bodywork colour, Helmet the helmet shell. Textures: assets/motorbike/textures.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "motorbike.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "motorbike", "textures")

LENGTH, WIDTH, HEIGHT = 2.05, 0.78, 1.06
AXLE_F, AXLE_R = 0.695, -0.685
R_F, W_F = 0.293, 0.110  # 110/70-17
R_R, W_R = 0.314, 0.140  # 140/70-17
RIM_R = 0.216  # 17-inch rim
RAKE = math.radians(25)
TRAIL = 0.095
SEAT_Y = 0.79


def axis_z(y):
    """z of the steering axis at height y (it meets the ground TRAIL ahead of the contact patch)."""
    return AXLE_F + TRAIL - y * math.tan(RAKE)


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


material("Paint", 0x1F4E8C, metallic=0.4, roughness=0.3)  # tank, cowls, fender
material("Frame", 0x2A2C30, metallic=0.6, roughness=0.4)
material("Engine", 0x45484D, metallic=0.7, roughness=0.45)
material("Steel", 0xC3C7CC, metallic=1.0, roughness=0.25)
material("Trim", 0x141518, roughness=0.6)  # black plastic, rubber, bars
material("Seat", 0x1A1B1E, roughness=0.8)
material("Plate", 0xFFFFFF, roughness=0.45, image="motorbike_plate.png", clip=True)
material("HeadLamp", 0xF4F6F8, roughness=0.1, emissive=0xFFF4DE)
material("TailLamp", 0x8A0A0A, roughness=0.15, emissive=0xFF2A1A)
material("IndicatorL", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("IndicatorR", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("Tire", 0x18191B, roughness=0.9)
material("WheelFace", 0xFFFFFF, metallic=0.5, roughness=0.4, image="motorbike_wheel.png", clip=True)
material("RiderJacket", 0x2B3440, roughness=0.8)
material("RiderPants", 0x2E3542, roughness=0.85)
material("RiderGear", 0x111214, roughness=0.6)  # gloves and boots
material("Helmet", 0xE8E8E6, metallic=0.2, roughness=0.25)
material("Visor", 0x0E1216, metallic=0.3, roughness=0.18)


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
            f.tag = True  # oriented here: obj() leaves it alone when it recalculates normals
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
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        self.box((p0 + p1) / 2, (thickness, thickness, axis.length), mat, rot=axis.to_track_quat("Z", "Y").to_matrix())

    def tube(self, p0, p1, r0, r1, mat, segs=8, caps=True):
        """Tapered closed tube from p0 (radius r0) to p1 (radius r1)."""
        p0, p1 = Vector(p0), Vector(p1)
        rot = (p1 - p0).to_track_quat("Z", "Y").to_matrix()
        rings = []
        for p, r in ((p0, r0), (p1, r1)):
            rings.append(
                [
                    self.bm.verts.new(
                        p
                        + rot @ Vector((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), 0))
                    )
                    for k in range(segs)
                ]
            )
        for k in range(segs):
            j = (k + 1) % segs
            f = self.face([rings[0][k], rings[0][j], rings[1][j], rings[1][k]], mat)
            f.tag = not caps  # an open tube is wound outward already and has no inside to test
        if caps:
            self.face(list(reversed(rings[0])), mat)
            self.face(rings[1], mat)

    def ellipsoid(self, centre, radii, mat, segs=10, rows=6):
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
        for i in range(segs):
            j = (i + 1) % segs
            self.face([top, grid[0][j], grid[0][i]], mat)
            self.face([bottom, grid[-1][i], grid[-1][j]], mat)
            for k in range(len(grid) - 1):
                self.face([grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]], mat)

    def loft_z(self, stations, mat, n=2.6, segs=14):
        """Rounded body through rings at z: stations = [(z, half_width, bottom, top)], superellipse
        cross-sections (exponent n), closed at both ends."""
        rings = []
        for z, w, y0, y1 in stations:
            yc, h = (y0 + y1) / 2, (y1 - y0) / 2
            ring = []
            for k in range(segs):
                t = 2 * math.pi * k / segs
                c, s = math.cos(t), math.sin(t)
                ring.append(
                    self.bm.verts.new(
                        (w * math.copysign(abs(c) ** (2 / n), c), yc + h * math.copysign(abs(s) ** (2 / n), s), z)
                    )
                )
            rings.append(ring)
        for a, b in zip(rings, rings[1:], strict=False):
            for k in range(segs):
                j = (k + 1) % segs
                self.face([a[k], a[j], b[j], b[k]], mat)
        self.face(rings[0], mat)
        self.face(list(reversed(rings[-1])), mat)

    def obj(self, name, parent=None, matrix=None):
        """Object whose transform is `matrix` (the mesh is given in world coordinates)."""
        matrix = matrix or Matrix.Identity(4)
        bmesh.ops.recalc_face_normals(self.bm, faces=[f for f in self.bm.faces if not f.tag])
        bmesh.ops.transform(self.bm, matrix=matrix.inverted(), verts=self.bm.verts)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        SCENE.collection.objects.link(ob)
        ob.matrix_world = matrix
        if parent is not None:
            ob.parent = parent
            ob.matrix_parent_inverse = parent.matrix_world.inverted()
        return ob


root = bpy.data.objects.new("Motorbike", None)
SCENE.collection.objects.link(root)

# ---------------------------------------------------------------------------- body (static)

body = Mesh(
    ["Paint", "Frame", "Engine", "Steel", "Trim", "Seat", "Plate", "HeadLamp", "TailLamp", "IndicatorL", "IndicatorR"]
)
head_lo, head_hi = 0.70, 0.90
head_c = Vector((0.0, 0.80, axis_z(0.80)))
body.tube((0, head_lo, axis_z(head_lo)), (0, head_hi, axis_z(head_hi)), 0.04, 0.04, "Frame", segs=8)  # head tube
PIVOT = Vector((0.0, 0.44, -0.22))  # swingarm pivot
for s in (1, -1):
    # Twin spars from the head tube round the engine to the pivot, and the seat rails.
    body.beam((s * 0.06, 0.82, axis_z(0.82) - 0.03), (s * 0.13, 0.68, 0.05), 0.05, "Frame")
    body.beam((s * 0.13, 0.68, 0.05), (s * 0.12, PIVOT.y + 0.04, PIVOT.z), 0.05, "Frame")
    body.beam((s * 0.10, 0.70, -0.08), (s * 0.08, 0.76, -0.70), 0.03, "Frame")
    body.beam((s * 0.12, 0.48, -0.20), (s * 0.08, 0.74, -0.50), 0.025, "Frame")
    # Swingarm to the rear axle, chain on the left.
    body.beam((s * 0.11, PIVOT.y, PIVOT.z), (s * 0.11, R_R, AXLE_R), 0.045, "Frame")
    # Footpegs (rider and pillion).
    body.beam((s * 0.10, 0.34, -0.16), (s * 0.20, 0.34, -0.16), 0.025, "Trim")
    body.beam((s * 0.10, 0.42, -0.46), (s * 0.18, 0.42, -0.46), 0.022, "Trim")
body.beam((0.14, 0.42, -0.12), (0.14, R_R + 0.09, AXLE_R), 0.012, "Trim")
body.beam((0.14, 0.36, -0.12), (0.14, R_R - 0.09, AXLE_R), 0.012, "Trim")
body.beam((0.0, 0.40, -0.38), (0.0, 0.70, -0.24), 0.05, "Steel")  # rear shock
# Fuel tank, seat, tail cowl.
body.loft_z(
    [
        (0.43, 0.10, 0.80, 0.93),
        (0.36, 0.16, 0.76, 0.99),
        (0.22, 0.18, 0.75, 1.01),
        (0.08, 0.17, 0.76, 0.98),
        (-0.04, 0.13, 0.77, 0.89),
        (-0.09, 0.08, 0.78, 0.83),
    ],
    "Paint",
)
body.loft_z(
    [
        (-0.03, 0.10, 0.74, 0.80),
        (-0.10, 0.145, 0.73, SEAT_Y + 0.01),
        (-0.30, 0.15, 0.73, SEAT_Y),
        (-0.42, 0.12, 0.75, 0.82),
        (-0.50, 0.10, 0.78, 0.86),
        (-0.66, 0.08, 0.80, 0.865),
        (-0.70, 0.05, 0.82, 0.85),
    ],
    "Seat",
)
body.loft_z(
    [(-0.40, 0.12, 0.66, 0.79), (-0.60, 0.10, 0.70, 0.83), (-0.82, 0.07, 0.75, 0.84), (-0.90, 0.04, 0.78, 0.82)],
    "Paint",
)
for s in (1, -1):  # shrouds either side of the radiator
    body.box((s * 0.165, 0.70, 0.31), (0.025, 0.15, 0.17), "Paint", rot=Matrix.Rotation(-0.5, 3, "X"))
body.box((0.0, 0.66, 0.36), (0.30, 0.24, 0.04), "Trim", rot=Matrix.Rotation(-0.25, 3, "X"))  # radiator
# Engine: crankcase, forward-leaning cylinder block, side covers.
body.box((0.0, 0.40, 0.07), (0.27, 0.20, 0.38), "Engine")
body.box((0.0, 0.57, 0.20), (0.25, 0.20, 0.17), "Engine", rot=Matrix.Rotation(-0.35, 3, "X"))
for k in range(3):  # cooling fins on the cylinder block
    body.box(
        (0.0, 0.53 + 0.04 * k, 0.215 + 0.014 * k), (0.27, 0.012, 0.19), "Engine", rot=Matrix.Rotation(-0.35, 3, "X")
    )
body.tube((0.15, 0.38, 0.02), (0.19, 0.38, 0.02), 0.09, 0.08, "Engine", segs=10)
body.tube((-0.15, 0.38, 0.12), (-0.19, 0.38, 0.12), 0.08, 0.07, "Engine", segs=10)
# Exhaust: headers under the engine to a short muffler on the right (−X).
for x in (0.05, -0.05):
    body.tube((x, 0.55, 0.33), (x, 0.24, 0.30), 0.022, 0.022, "Steel", segs=6, caps=False)
    body.tube((x, 0.24, 0.30), (x * 0.5, 0.17, 0.05), 0.022, 0.024, "Steel", segs=6, caps=False)
body.tube((0.0, 0.17, 0.05), (-0.13, 0.22, -0.20), 0.03, 0.03, "Steel", segs=6, caps=False)
body.tube((-0.14, 0.23, -0.22), (-0.17, 0.36, -0.55), 0.07, 0.06, "Engine", segs=10)
body.tube((-0.17, 0.36, -0.55), (-0.172, 0.365, -0.57), 0.04, 0.035, "Steel", segs=8)
# Tail lamp, rear indicators, plate bracket, number plate (rear only), plate lamp, reflector.
body.box((0.0, 0.81, -0.905), (0.12, 0.04, 0.03), "TailLamp")
for s, mat in ((1, "IndicatorL"), (-1, "IndicatorR")):
    body.beam((s * 0.04, 0.74, -0.86), (s * 0.15, 0.74, -0.88), 0.015, "Trim")
    body.box((s * 0.16, 0.74, -0.885), (0.05, 0.035, 0.05), mat)
body.beam((0.0, 0.76, -0.80), (0.0, 0.64, -0.96), 0.05, "Trim")
tilt = math.radians(12)  # plate leans back, its face toward the rear and a little upward
pc = Vector((0.0, 0.565, -0.985))
pr = Matrix.Rotation(tilt, 3, "X")
pw, ph = 0.23, 0.125
corners = [
    pc + pr @ Vector((x, y, 0.0))
    for x, y in ((pw / 2, -ph / 2), (-pw / 2, -ph / 2), (-pw / 2, ph / 2), (pw / 2, ph / 2))
]
body.face(corners, "Plate", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], facing=(0, 0.2, -1))
body.box(tuple(pc + pr @ Vector((0, 0, 0.012))), (pw + 0.01, ph + 0.01, 0.012), "Trim", rot=pr)
body.box((0.0, 0.645, -0.975), (0.08, 0.02, 0.03), "HeadLamp")
body.box((0.0, 0.48, -0.965), (0.07, 0.04, 0.012), "TailLamp")  # 後部反射器
body_ob = body.obj("Body", root)


# ---------------------------------------------------------------------------- wheels


def wheel(name, radius, width, disc_r, disc_side, parent, location):
    """Rounded tyre, two cast-wheel faces (spokes are alpha) and a brake disc; axle along X."""
    m = Mesh(["Tire", "WheelFace"])
    segs = 18
    hw = width / 2
    prof = [
        (-0.9 * hw, RIM_R),
        (-hw, RIM_R + 0.035),
        (-0.8 * hw, radius - 0.03),
        (0.0, radius),
        (0.8 * hw, radius - 0.03),
        (hw, RIM_R + 0.035),
        (0.9 * hw, RIM_R),
    ]
    grid = [
        [
            m.bm.verts.new((dx, rr * math.cos(2 * math.pi * k / segs), rr * math.sin(2 * math.pi * k / segs)))
            for dx, rr in prof
        ]
        for k in range(segs)
    ]
    for k in range(segs):
        j = (k + 1) % segs
        for i in range(len(prof) - 1):
            m.face([grid[k][i], grid[k][i + 1], grid[j][i + 1], grid[j][i]], "Tire")
        m.face([grid[k][-1], grid[k][0], grid[j][0], grid[j][-1]], "Tire")  # rim barrel
    bmesh.ops.recalc_face_normals(m.bm, faces=m.bm.faces)
    for f in m.bm.faces:
        f.tag = True  # closed tyre: keep its normals; the faces below are oriented explicitly

    def disc(x, r, u0, facing):
        pts, uvs = [], []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            pts.append((x, r * math.cos(a), r * math.sin(a)))
            uvs.append((u0 + 0.25 + 0.248 * math.cos(a), 0.5 + 0.496 * math.sin(a)))
        f = m.face(pts, "WheelFace", uvs=uvs, facing=(facing, 0, 0))
        f.tag = True

    for sgn in (1, -1):  # spokes, seen from both sides
        disc(sgn * 0.012, RIM_R, 0.0, sgn)
        disc(disc_side * 0.055 + sgn * 0.002, disc_r, 0.5, sgn)
    bmesh.ops.translate(m.bm, verts=m.bm.verts, vec=location)  # obj() takes world coordinates
    return m.obj(name, parent, Matrix.Translation(location))


# ---------------------------------------------------------------------------- steering (fork etc.)

STEER_M = Matrix.Translation(head_c) @ Matrix.Rotation(-RAKE, 4, "X")
steer = Mesh(["Paint", "Steel", "Trim", "Frame", "HeadLamp", "IndicatorL", "IndicatorR"])
up = Vector((0.0, math.cos(RAKE), -math.sin(RAKE)))  # along the steering axis
axle_f = Vector((0.0, R_F, AXLE_F))
top_y = 0.90
leg_top = axle_f + up * ((top_y - R_F) / up.y)
for s in (1, -1):
    off = Vector((s * 0.095, 0, 0))
    steer.tube(axle_f + off + up * 0.02, axle_f + off + up * 0.30, 0.032, 0.032, "Trim", segs=8)  # sliders
    steer.tube(axle_f + off + up * 0.28, leg_top + off, 0.022, 0.022, "Steel", segs=8)  # stanchions
steer.box(tuple(leg_top + up * 0.0), (0.26, 0.04, 0.08), "Frame", rot=Matrix.Rotation(-RAKE, 3, "X"))  # top clamp
steer.box(tuple(leg_top - up * 0.16), (0.24, 0.035, 0.07), "Frame", rot=Matrix.Rotation(-RAKE, 3, "X"))
bar_c = Vector((0.0, 0.97, leg_top.z - 0.02))
for s in (1, -1):
    steer.beam(leg_top + Vector((s * 0.04, 0.0, 0.0)), bar_c + Vector((s * 0.05, 0.0, 0.0)), 0.03, "Trim")
    steer.beam(bar_c + Vector((s * 0.04, 0, 0)), Vector((s * 0.33, 0.985, bar_c.z - 0.04)), 0.024, "Trim")
    steer.tube((s * 0.27, 0.985, bar_c.z - 0.035), (s * 0.36, 0.985, bar_c.z - 0.045), 0.018, 0.018, "Trim", segs=6)
    steer.beam((s * 0.24, 0.99, bar_c.z - 0.02), (s * 0.32, 0.99, bar_c.z + 0.04), 0.012, "Steel")  # levers
    steer.beam((s * 0.22, 0.99, bar_c.z - 0.03), (s * 0.27, 1.025, bar_c.z - 0.02), 0.012, "Trim")  # mirror stalks
    steer.box((s * 0.29, 1.03, bar_c.z - 0.02), (0.11, 0.06, 0.02), "Trim")
# Headlight with its shell, front indicators, meter, front fender.
hl = Vector((0.0, 0.82, axis_z(0.82) + 0.15))
steer.tube(hl - Vector((0, 0, 0.09)), hl, 0.075, 0.085, "Trim", segs=12)
steer.tube(hl, hl + Vector((0, 0, 0.004)), 0.072, 0.072, "HeadLamp", segs=12)
for s, mat in ((1, "IndicatorL"), (-1, "IndicatorR")):
    steer.beam(hl + Vector((s * 0.06, 0.0, -0.05)), hl + Vector((s * 0.15, -0.01, -0.05)), 0.015, "Trim")
    steer.box(tuple(hl + Vector((s * 0.16, -0.01, -0.045))), (0.05, 0.035, 0.05), mat)
steer.box((0.0, 0.94, axis_z(0.94) + 0.07), (0.17, 0.08, 0.05), "Trim", rot=Matrix.Rotation(0.6, 3, "X"))  # meter
for k in range(6):  # fender: a curved strip over the front tyre, from ahead of the axle to behind it
    a0, a1 = math.radians(15 + 22 * k), math.radians(15 + 22 * (k + 1))
    rr = R_F + 0.035
    pts = []
    for a in (a0, a1):
        pts.append((AXLE_F + rr * math.cos(a), R_F + rr * math.sin(a)))
    (z0, y0), (z1, y1) = pts
    steer.face(
        [(0.065, y0, z0), (-0.065, y0, z0), (-0.065, y1, z1), (0.065, y1, z1)],
        "Paint",
        facing=(0, math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2)),
    )
steer.box((-0.075, R_F + 0.06, AXLE_F - 0.11), (0.035, 0.08, 0.07), "Trim")  # brake caliper (right)
steer_ob = steer.obj("Steer", root, STEER_M)
steer_ob.parent = root
steer_ob.matrix_parent_inverse = Matrix.Identity(4)
steer_ob.matrix_world = STEER_M

front = wheel("WheelFront", R_F, W_F, 0.145, -1, steer_ob, axle_f)
rear = wheel("WheelRear", R_R, W_R, 0.11, -1, root, Vector((0.0, R_R, AXLE_R)))


# ---------------------------------------------------------------------------- rider

rider = bpy.data.objects.new("Rider", None)
SCENE.collection.objects.link(rider)
rider.parent = root

HIP_C = Vector((0.0, 0.86, -0.17))  # torso pivot, centre of the hips
LEAN = math.radians(26)
SHOULDER = (0.20, 0.52)  # (x, y) in the torso frame
NECK_Y = 0.60
UPPER_ARM, FOREARM = 0.27, 0.31  # shoulder → elbow, elbow → middle of the grip
THIGH, SHIN = 0.42, 0.37  # hip → knee, knee → ankle
HIP_X = 0.10
GRIP = Vector((0.31, 0.985, bar_c.z - 0.04))
ANKLE = Vector((0.165, 0.42, -0.21))  # boots on the pegs (y 0.34)


def part(name, parent, mats, build, location, angle_x=0.0):
    """Jointed part: mesh built in its own frame around the pivot, placed by local location and
    rotation about X (like human.glb's limbs, hanging toward −Y at rest)."""
    m = Mesh(mats)
    build(m)
    ob = m.obj(name)
    ob.parent = parent
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.location = location
    ob.rotation_euler = (angle_x, 0.0, 0.0)
    return ob


def two_bone(p0, target, a, b, bend):
    """Planar (y-z) two-bone IK: angles from straight down (positive = toward +Z) of the upper
    and the lower bone so that p0 → target; bend = +1 puts the joint toward +Z (knee), −1 toward
    −Z (elbow)."""
    dy, dz = target[0] - p0[0], target[1] - p0[1]
    d = min(math.hypot(dy, dz), a + b - 1e-4)
    base = math.atan2(dz, -dy)
    alpha = math.acos(max(-1.0, min(1.0, (a * a + d * d - b * b) / (2 * a * d))))
    upper = base + bend * alpha
    jy, jz = p0[0] - a * math.cos(upper), p0[1] + a * math.sin(upper)
    lower = math.atan2(target[1] - jz, -(target[0] - jy))
    return upper, lower


def torso_build(m):
    rings = [
        (-0.08, 0.15, 0.12),
        (0.0, 0.16, 0.115),
        (0.14, 0.155, 0.105),
        (0.28, 0.17, 0.11),
        (0.42, 0.195, 0.12),
        (0.52, 0.205, 0.11),
        (0.58, 0.12, 0.08),
        (0.63, 0.06, 0.055),
    ]
    segs = 12
    grid = [
        [
            m.bm.verts.new((w * math.sin(2 * math.pi * k / segs), y, d * math.cos(2 * math.pi * k / segs)))
            for k in range(segs)
        ]
        for y, w, d in rings
    ]
    for a, b in zip(grid, grid[1:], strict=False):
        for k in range(segs):
            j = (k + 1) % segs
            m.face([a[k], a[j], b[j], b[k]], "RiderJacket")
    m.face(list(reversed(grid[0])), "RiderJacket")
    m.face(grid[-1], "RiderJacket")


def head_build(m):
    m.ellipsoid((0.0, 0.17, 0.01), (0.135, 0.15, 0.158), "Helmet", segs=12, rows=8)
    # Visor: a strip round the front of the shell. Three rows, so that its flat faces stay outside
    # the shell's widest row (y = 0.17); with two rows the shell's vertices poked through.
    rows = [[], [], []]
    for k in range(7):
        a = math.radians(-55 + 110 * k / 6)
        for y, store in zip((0.12, 0.17, 0.215), rows, strict=True):
            t = (y - 0.17) / 0.15
            sc = math.sqrt(max(0.0, 1 - t * t)) + 0.03
            store.append(m.bm.verts.new((0.135 * sc * math.sin(a), y, 0.01 + 0.158 * sc * math.cos(a))))
    for lo, hi in zip(rows, rows[1:], strict=False):
        for k in range(6):
            f = m.face([lo[k], lo[k + 1], hi[k + 1], hi[k]], "Visor", facing=(0, 0, 1))
            f.tag = True


def limb_build(length, r0, r1, dx, mat, end=None):
    """Tube hanging from the pivot to (dx, −length, 0); `end` adds a glove or a boot."""

    def build(m):
        m.ellipsoid((0.0, 0.0, 0.0), (r0, r0, r0), mat, segs=8, rows=4)
        m.tube((0.0, 0.0, 0.0), (dx, -length, 0.0), r0, r1, mat, segs=8)
        if end == "glove":
            m.ellipsoid((dx * 1.1, -length - 0.05, 0.0), (0.04, 0.06, 0.045), "RiderGear", segs=8, rows=4)
        elif end == "boot":
            foot = math.radians(40)  # toes forward and a little up at rest, down on the peg when riding
            toe = Vector((dx, -length - 0.04, 0.0)) + Vector((0.0, math.sin(foot), math.cos(foot))) * 0.20
            m.tube((dx, -length + 0.06, 0.0), (dx, -length - 0.05, 0.0), 0.06, 0.055, "RiderGear", segs=8)
            m.tube((dx, -length - 0.05, -0.04), toe, 0.05, 0.035, "RiderGear", segs=8)

    return build


torso = part("Torso", rider, ["RiderJacket"], torso_build, HIP_C, LEAN)
head = part("Head", torso, ["Helmet", "Visor"], head_build, (0.0, NECK_Y, 0.0), -LEAN + math.radians(5))
pose = {}
# Arms: solve in the torso frame (it leans forward by LEAN about the hip pivot).
to_torso = Matrix.Rotation(-LEAN, 3, "X")
grip_t = to_torso @ (GRIP - HIP_C)
for s, tag in ((1, "L"), (-1, "R")):
    sh = (SHOULDER[1], 0.0)
    splay_u, splay_f = 0.06, 0.05
    a_eff = math.sqrt(UPPER_ARM**2 - splay_u**2)
    b_eff = math.sqrt(FOREARM**2 - splay_f**2)
    up_a, lo_a = two_bone(sh, (grip_t.y, grip_t.z), a_eff, b_eff, -1)
    ua = part(
        f"UpperArm{tag}",
        torso,
        ["RiderJacket"],
        limb_build(a_eff, 0.055, 0.047, s * splay_u, "RiderJacket"),
        (s * SHOULDER[0], SHOULDER[1], 0.0),
        -up_a,
    )
    part(
        f"Forearm{tag}",
        ua,
        ["RiderJacket", "RiderGear"],
        limb_build(b_eff - 0.06, 0.046, 0.040, s * splay_f, "RiderJacket", "glove"),
        (s * splay_u, -a_eff, 0.0),
        -(lo_a - up_a),
    )
    pose[f"UpperArm{tag}"] = -up_a
    pose[f"Forearm{tag}"] = -(lo_a - up_a)
# Legs hang from the hips (not from the leaning torso).
for s, tag in ((1, "L"), (-1, "R")):
    hip = (HIP_C.y, HIP_C.z)
    splay_t = ANKLE.x - HIP_X
    a_eff = math.sqrt(THIGH**2 - splay_t**2)
    up_a, lo_a = two_bone(hip, (ANKLE.y, ANKLE.z), a_eff, SHIN, 1)
    th = part(
        f"Thigh{tag}",
        rider,
        ["RiderPants"],
        limb_build(a_eff, 0.085, 0.062, s * splay_t, "RiderPants"),
        (s * HIP_X, HIP_C.y, HIP_C.z),
        -up_a,
    )
    part(
        f"Shin{tag}",
        th,
        ["RiderPants", "RiderGear"],
        limb_build(SHIN, 0.058, 0.05, 0.0, "RiderPants", "boot"),
        (s * splay_t, -a_eff, 0.0),
        -(lo_a - up_a),
    )
    pose[f"Thigh{tag}"] = -up_a
    pose[f"Shin{tag}"] = -(lo_a - up_a)
rider["pose"] = json.dumps({k: round(v, 4) for k, v in pose.items()})

root["length"] = LENGTH
root["width"] = WIDTH
root["height"] = HEIGHT
root["wheelbase"] = round(AXLE_F - AXLE_R, 4)
root["frontAxleZ"] = AXLE_F
root["rearAxleZ"] = AXLE_R
root["wheelRadiusFront"] = R_F
root["wheelRadiusRear"] = R_R
root["steerAxisTilt"] = RAKE  # Steer's local +Y leans back by this much from vertical
root["seatHeight"] = SEAT_Y

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
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris, total=sum(tris.values()), pose=pose)

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    material("Ground", 0x6A6D70, roughness=0.9)
    gm = Mesh(["Ground"])
    gm.face([(-10, 0, -10), (-10, 0, 10), (10, 0, 10), (10, 0, -10)], "Ground", facing=(0, 1, 0))
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
    cam.data.lens = 50
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = int(os.environ.get("PREVIEW_SAMPLES", "32"))
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    views = {
        "front-left": ((3.3, 1.6, 3.8), (0.0, 0.85, 0.1), True),
        "rear-right": ((-3.3, 1.7, -3.8), (0.0, 0.85, -0.1), True),
        "left": ((5.2, 0.9, 0.0), (0.0, 0.85, 0.0), True),
        "right": ((-5.2, 0.9, 0.0), (0.0, 0.85, 0.0), True),
        "front": ((0.0, 1.0, 5.0), (0.0, 0.85, 0.0), True),
        "rear": ((0.0, 1.0, -5.0), (0.0, 0.8, 0.0), True),
        "bike-left": ((3.4, 0.9, 0.3), (0.0, 0.55, 0.0), False),
        "steered": ((2.4, 1.6, 2.6), (0.0, 0.6, 0.2), False),
    }
    rider_parts = [rider, *rider.children_recursive]
    for view, (eye, target, with_rider) in views.items():
        for o in rider_parts:
            o.hide_render = not with_rider
        steer_ob.matrix_world = STEER_M @ Matrix.Rotation(0.45 if view == "steered" else 0.0, 4, "Y")
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        upv = right.cross(fwd)
        cam.rotation_euler = Matrix((right, upv, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"motorbike-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
