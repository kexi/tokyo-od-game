# 自転車（普通自転車: 26 インチのママチャリと 700C のクロスバイク）for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/bicycle.py -- public/models/bicycle.glb [preview-dir]
#
# Game coordinates (+Y up, the bike faces +Z, ground at y = 0, the bike's left = +X), exported
# with export_yup=False. Two variants share the file, "CityBike" (ママチャリ) and "SportBike"
# (クロスバイク), each a node tree whose origins are the pivots:
#   <V>Bike             ground, midway between the axles (frame, saddle, fenders, carrier …)
#     <V>Steer          on the steering axis; its fixed rotation.x tilts local +Y onto the axis,
#                       so the game steers with steer.rotation.y (three.js Euler XYZ = Rx·Ry·Rz)
#       <V>FrontWheel   front axle, spins about X
#     <V>RearWheel      rear axle, spins about X
#     <V>Crank          bottom bracket; rotation.x 0 = right crank forward, + = pedalling forward
#       <V>PedalL/R     pedal spindles; the game sets rotation.x = −crank so they stay level
#     CityStand         両立スタンド about the rear axle, exported folded up
# Lamps and reflectors have their own materials (HeadLamp, Reflector, PedalReflector) so the game
# can switch their emission at night; frame paint (CityPaint / SportPaint) and the basket are
# recolourable through baseColorFactor. Each root node's extras ("bicycle") carry the wheel and
# drivetrain numbers and the rider pose for the jointed human of scripts/blender/human.py
# (solve_rider). Sizes stay inside 普通自転車 (道路交通法施行規則第9条の2の2: 長さ 190cm・幅 60cm).
# No brand names or logos anywhere.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "bicycle.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "bicycle", "textures")
HUMAN = os.path.join(ROOT, "public", "models", "human.glb")

# The jointed human (scripts/blender/human.py) in its body frame: joint positions and the
# rest-pose vectors (dy, dz) from each joint to the next. Its limbs only rotate about X.
SHOULDER = (0.235, 1.40)  # x, y of the arm pivots
HIP = (0.095, 0.86)  # x, y of the leg pivots
UPPER_ARM = (-0.27, 0.0)  # shoulder → elbow
FOREARM = (-0.315, 0.0)  # elbow → centre of the hand
THIGH = (-0.42, 0.012)  # hip → knee pivot
SHIN = (-0.44, 0.043)  # knee pivot → sole under the ball of the foot
PEDAL_TOP = 0.014  # pedal spindle → tread, where the sole rests

X = Vector((1.0, 0.0, 0.0))


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def lin(hex_color):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (ch((hex_color >> 16) & 255), ch((hex_color >> 8) & 255), ch(hex_color & 255), 1.0)


MAT = {}


def material(name, color, metallic=0.0, roughness=0.5, emission=0.0, image=None, double_sided=False):
    """Plain colour, or a white-based image multiplied by the colour (glTF baseColorFactor) whose
    alpha is rounded into a crisp cut-out (glTF alphaMode MASK)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emission:
        b.inputs["Emission Color"].default_value = lin(color)
        b.inputs["Emission Strength"].default_value = emission
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(TEX, image))
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[7].default_value = lin(color)
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"
        nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
        nt.links.new(rnd.outputs[0], b.inputs["Alpha"])
    MAT[name] = m
    return m


material("CityPaint", 0xE3E5E7, metallic=0.3, roughness=0.32)
material("SportPaint", 0x2B3546, metallic=0.35, roughness=0.38)
material("Metal", 0xC6CACF, metallic=0.85, roughness=0.26)
material("Rubber", 0x1B1C1E, roughness=0.85)
material("Basket", 0xC6CACF, metallic=0.6, roughness=0.35, image="basket.png", double_sided=True)
material("HeadLamp", 0xFFF2D0, roughness=0.15, emission=1.0)
material("Reflector", 0xC8101A, roughness=0.25)
material("PedalReflector", 0xF28C12, roughness=0.25)


# ---------------------------------------------------------------- mesh helpers
class Part:
    """One object's mesh under construction, in world (rest) coordinates."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uvl = self.bm.loops.layers.uv.new("UVMap")  # zero-filled; only the basket sets UVs
        self.mats = []

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)


def face_out(part, verts, mat, ref, smooth=False):
    """Face whose normal points away from `ref` (a point inside the solid)."""
    f = part.bm.faces.new(verts)
    f.material_index = part.mi(mat)
    f.smooth = smooth
    f.normal_update()
    if f.normal.dot(f.calc_center_median() - Vector(ref)) < 0:
        f.normal_flip()
    return f


def tube(part, pts, r, mat, segs=8, caps=(True, True), smooth=True, closed=False):
    """Swept circle through `pts` (parallel-transport frames); r is a radius or one per point.
    The ring order makes every side face point outward, so no normal recalculation is needed."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    radii = list(r) if isinstance(r, (list, tuple)) else [r] * n
    tangents = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[i - 1]
        elif i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tangents.append(t.normalized())
    ref = X if abs(tangents[0].x) < 0.9 else Vector((0.0, 1.0, 0.0))
    nrm = tangents[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        if i:
            nrm = tangents[i - 1].rotation_difference(tangents[i]) @ nrm
            nrm = (nrm - tangents[i] * nrm.dot(tangents[i])).normalized()
        b = tangents[i].cross(nrm)
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs + math.pi / segs
            ring.append(part.bm.verts.new(pts[i] + radii[i] * (nrm * math.cos(a) + b * math.sin(a))))
        rings.append(ring)
    idx = part.mi(mat)
    for i in range(n if closed else n - 1):
        ra, rb = rings[i], rings[(i + 1) % n]
        for k in range(segs):
            j = (k + 1) % segs
            f = part.bm.faces.new((ra[k], ra[j], rb[j], rb[k]))
            f.material_index = idx
            f.smooth = smooth
    if not closed:
        if caps[0]:
            part.bm.faces.new(list(reversed(rings[0]))).material_index = idx
        if caps[1]:
            part.bm.faces.new(rings[-1]).material_index = idx
    return rings


CORNERS = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]


def box(part, centre, size, mat, rot=None):
    m = Matrix.Translation(Vector(centre)) @ (rot.to_4x4() if rot is not None else Matrix.Identity(4))
    vs = [
        part.bm.verts.new(m @ Vector((dx * size[0] / 2, dy * size[1] / 2, dz * size[2] / 2))) for dx, dy, dz in CORNERS
    ]
    for fi in BOX_FACES:
        part.bm.faces.new([vs[i] for i in fi]).material_index = part.mi(mat)


def bez(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = (Vector(p) for p in (p0, p1, p2, p3))
    out = []
    for k in range(n + 1):
        t = k / n
        out.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3)
    return out


def sweep_arc(part, centre, radius, profile, a0, a1, segs, mat, smooth=True, caps=True):
    """Closed (dx, dr) profile swept round the X axis through `centre` at `radius`, from angle a0
    to a1 (angles from +Y toward +Z): rims, tyres-as-bands and fenders."""
    c = Vector(centre)
    cx = sum(p[0] for p in profile) / len(profile)
    cr = sum(p[1] for p in profile) / len(profile)
    full = abs(a1 - a0) >= 2 * math.pi - 1e-6
    count = segs if full else segs + 1
    stations = []
    for k in range(count):
        a = a0 + (a1 - a0) * k / segs
        e = Vector((0.0, math.cos(a), math.sin(a)))
        ring = [part.bm.verts.new(c + (radius + dr) * e + dx * X) for dx, dr in profile]
        stations.append((ring, c + (radius + cr) * e + cx * X))
    m = len(profile)
    for k in range(segs):
        (ra, ca), (rb, cb) = stations[k], stations[(k + 1) % count]
        mid = (ca + cb) / 2
        for i in range(m):
            j = (i + 1) % m
            face_out(part, (ra[i], ra[j], rb[j], rb[i]), mat, mid, smooth)
    if caps and not full:
        face_out(part, stations[0][0], mat, stations[1][1])
        face_out(part, stations[-1][0], mat, stations[-2][1])


def torus_x(part, centre, major, minor, mat, segs=28, csegs=6):
    """Tyre: torus round the X axis through `centre`."""
    profile = [
        (minor * math.sin(2 * math.pi * k / csegs), minor * math.cos(2 * math.pi * k / csegs)) for k in range(csegs)
    ]
    sweep_arc(part, centre, major, profile, 0.0, 2 * math.pi, segs, mat)


def disc_x(part, centre, r, x0, x1, mat, segs=12, smooth=False):
    tube(part, [Vector(centre) + x0 * X, Vector(centre) + x1 * X], r, mat, segs=segs, smooth=smooth)


def hull2d(points):
    """Convex hull (monotone chain) of (u, v) points, counter-clockwise."""
    pts = sorted(set(points))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def stadium(circles, n=14):
    """Outline (y, z) round two circles [(y, z, r), …]."""
    pts = []
    for y, z, r in circles:
        for k in range(n):
            a = 2 * math.pi * k / n
            pts.append((round(z + r * math.sin(a), 5), round(y + r * math.cos(a), 5)))
    return [(y, z) for z, y in hull2d(pts)]


def slab_x(part, outline, x0, x1, mat, bevel=0.0):
    """Extrude a (y, z) outline between x0 and x1; bevel insets the x1 face for a rounded edge."""
    cy = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    centre = Vector(((x0 + x1) / 2, cy, cz))

    def ring(x, inset):
        out = []
        for y, z in outline:
            d = Vector((0.0, y - cy, z - cz))
            k = max(0.0, 1 - inset / max(d.length, 1e-6))
            out.append(part.bm.verts.new((x, cy + d.y * k, cz + d.z * k)))
        return out

    xm = x1 - (x1 - x0) * 0.25 if bevel else x1
    rings = [ring(x0, 0.0), ring(xm, 0.0)]
    if bevel:
        rings.append(ring(x1, bevel))
    for ra, rb in zip(rings, rings[1:], strict=False):
        for i in range(len(outline)):
            j = (i + 1) % len(outline)
            face_out(part, (ra[i], ra[j], rb[j], rb[i]), mat, centre, smooth=False)
    face_out(part, rings[0], mat, centre)
    face_out(part, rings[-1], mat, centre)


def saddle(part, top, centre_z, stations, mat, segs=10):
    """Saddle loft along Z: stations [(dz, half-width, half-height)], top surface at y = top."""
    rings = []
    for dz, hw, hh in stations:
        c = Vector((0.0, top - hh, centre_z + dz))
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            # Flattened underside: the lower half is squashed.
            sy = math.cos(a) if math.cos(a) > 0 else 0.55 * math.cos(a)
            ring.append(part.bm.verts.new(c + Vector((hw * math.sin(a), hh * sy, 0.0))))
        rings.append((ring, c))
    for (ra, ca), (rb, cb) in zip(rings, rings[1:], strict=False):
        for i in range(segs):
            j = (i + 1) % segs
            face_out(part, (ra[i], ra[j], rb[j], rb[i]), mat, (ca + cb) / 2, smooth=True)
    face_out(part, rings[0][0], mat, rings[1][1])
    face_out(part, rings[-1][0], mat, rings[-2][1])


WORLD = {}


def make_object(name, part, frame, parent=None, extra=None, local=False):
    """Object whose origin/orientation is `frame`. The mesh was built in world rest coordinates
    (or, with local=True, already in the object's own frame); `extra` is a further local
    transform (e.g. the folded stand) applied after the geometry."""
    if not local:
        bmesh.ops.transform(part.bm, matrix=frame.inverted(), verts=part.bm.verts)
    me = bpy.data.meshes.new(name)
    part.bm.to_mesh(me)
    part.bm.free()
    for m in part.mats:
        me.materials.append(MAT[m])
    ob = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(ob)
    world = frame @ (extra if extra is not None else Matrix.Identity(4))
    if parent:
        ob.parent = bpy.data.objects[parent]
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = WORLD[parent].inverted() @ world
    else:
        ob.matrix_basis = world
    WORLD[name] = world
    return ob


def rot_x(a):
    return Matrix.Rotation(a, 4, "X")


def T(v):
    return Matrix.Translation(Vector(v))


class SteerAxis:
    """Steering axis through the front axle's fork offset; t = distance along it (upward)."""

    def __init__(self, front_axle, tilt, offset):
        self.tilt = tilt
        self.u = Vector((0.0, math.cos(tilt), -math.sin(tilt)))  # up the axis, top leaning back
        self.n = Vector((0.0, math.sin(tilt), math.cos(tilt)))  # forward, perpendicular to it
        self.p0 = Vector(front_axle) - offset * self.n

    def at(self, t):
        return self.p0 + t * self.u

    def t_at_y(self, y):
        return (y - self.p0.y) / self.u.y


# ---------------------------------------------------------------- shared assemblies
def wheel(part, radius, tyre, rim_depth, spokes, hub_w, extras=()):
    """Wheel at the local origin, axle along X: tyre torus, box-section rim, laced spokes, hub."""
    o = Vector((0.0, 0.0, 0.0))
    torus_x(part, o, radius - tyre, tyre, "Rubber", segs=28, csegs=6)
    rim_out = radius - 2 * tyre + 0.004
    rim = [(-0.011, 0.0), (0.011, 0.0), (0.008, -rim_depth), (-0.008, -rim_depth)]
    sweep_arc(part, o, rim_out, rim, 0.0, 2 * math.pi, 28, "Metal", smooth=False)
    flange_r, inner = 0.028, rim_out - rim_depth
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        side = 1 if i % 2 == 0 else -1
        lace = 0.42 if (i // 2) % 2 == 0 else -0.42  # tangential lacing, crossing pairs
        hub = Vector((side * hub_w / 2, flange_r * math.cos(a + lace), flange_r * math.sin(a + lace)))
        tip = Vector((side * 0.003, inner * math.cos(a), inner * math.sin(a)))
        tube(part, [hub, tip], 0.0012, "Metal", segs=3, caps=(False, False), smooth=False)
    hub_pts = [(-hub_w / 2 - 0.02, 0.008), (-hub_w / 2, 0.016), (-hub_w / 2, 0.032), (-hub_w / 2 + 0.006, 0.032)]
    hub_pts += [(-hub_w / 2 + 0.008, 0.016), (hub_w / 2 - 0.008, 0.016), (hub_w / 2 - 0.006, 0.032)]
    hub_pts += [(hub_w / 2, 0.032), (hub_w / 2, 0.016), (hub_w / 2 + 0.02, 0.008)]
    tube(part, [Vector((x, 0, 0)) for x, _ in hub_pts], [r for _, r in hub_pts], "Metal", segs=10, smooth=False)
    for x0, x1, r in extras:  # brake drum, sprockets
        disc_x(part, o, r, x0, x1, "Metal", segs=14)


def crank_assembly(prefix, bb, length, arm_x, ring=None):
    """<V>Crank at the bottom bracket (right arm forward at rest) with <V>PedalL/R."""
    part = Part()
    bbv = Vector(bb)
    tube(part, [bbv + Vector((-arm_x, 0, 0)), bbv + Vector((arm_x, 0, 0))], 0.011, "Metal", segs=8, smooth=False)
    for side, dz in ((-1, length), (1, -length)):  # right (−X) forward, left (+X) back
        p0 = bbv + Vector((side * arm_x, 0.0, 0.0))
        p1 = bbv + Vector((side * arm_x, 0.0, dz))
        tube(part, [p0, p1], [0.016, 0.011], "Metal", segs=6, smooth=False)
    if ring:  # exposed chainring on the right: a flat annulus with a four-arm spider
        r_out, x = ring
        rp = [(-0.002, 0.0), (0.002, 0.0), (0.002, -0.012), (-0.002, -0.012)]
        sweep_arc(part, bbv + Vector((x, 0, 0)), r_out, rp, 0.0, 2 * math.pi, 24, "Metal", smooth=False)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            d = Vector((0.0, math.cos(a), math.sin(a)))
            tube(part, [bbv + Vector((x, 0, 0)), bbv + Vector((x, 0, 0)) + (r_out - 0.01) * d], 0.005, "Metal", segs=4)
    make_object(f"{prefix}Crank", part, T(bbv), parent=f"{prefix}Bike")
    for name, side, dz in (("PedalR", -1, length), ("PedalL", 1, -length)):
        part = Part()
        spindle = bbv + Vector((side * arm_x, 0.0, dz))
        tube(part, [spindle, spindle + Vector((side * 0.012, 0, 0))], 0.006, "Metal", segs=6, smooth=False)
        body = spindle + Vector((side * 0.045, 0.0, 0.0))
        box(part, body, (0.07, 0.022, 0.062), "Rubber")
        for fz in (1, -1):  # amber reflectors front and back
            box(part, body + Vector((0, 0, fz * 0.032)), (0.045, 0.012, 0.004), "PedalReflector")
        make_object(f"{prefix}{name}", part, T(spindle), parent=f"{prefix}Crank")


# ---------------------------------------------------------------- rider (2-link IK)
def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def ik2(root, target, a0, b0, bend):
    """Joint angles (rotation.x of the upper and lower part) that put the end of b0 on target.
    root/target are (y, z) in the body frame; a0/b0 the rest vectors; bend = +1 knee, −1 elbow."""
    l1, l2 = math.hypot(*a0), math.hypot(*b0)
    dy, dz = target[0] - root[0], target[1] - root[1]
    d = math.hypot(dy, dz)
    c = max(-1.0, min(1.0, (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2)))
    gamma = bend * math.acos(c)  # angle from the upper part's direction to the lower part's
    t2 = gamma - (math.atan2(b0[1], b0[0]) - math.atan2(a0[1], a0[0]))
    wy = a0[0] + b0[0] * math.cos(t2) - b0[1] * math.sin(t2)
    wz = a0[1] + b0[0] * math.sin(t2) + b0[1] * math.cos(t2)
    t1 = wrap(math.atan2(dz, dy) - math.atan2(wz, wy))
    return t1, wrap(t2), d, math.degrees(math.acos(c))


def to_body(p, root, lean):
    """World (bike-local) (y, z) → the leaned body frame of a human whose root is at `root`."""
    y, z = p[0] - root[0], p[1] - root[1]
    c, s = math.cos(-lean), math.sin(-lean)
    return (y * c - z * s, y * s + z * c)


def solve_rider(v):
    """Human root offset, body lean, arm angles and the pedal-cycle leg angles for variant v."""
    lean, hip = v["lean"], v["hip"]
    root = (hip[0] - HIP[1] * math.cos(lean), hip[1] - HIP[1] * math.sin(lean))
    grip_b = to_body((v["grip"][1], v["grip"][2]), root, lean)
    ua, fa, arm_d, elbow = ik2((SHOULDER[1], 0.0), grip_b, UPPER_ARM, FOREARM, -1)
    bb, lc = v["bb"], v["crank"]

    def legs(phi):
        # Pedal treads (they stay level): right spindle = BB + Lc·(0, −sin φ, cos φ), left opposite.
        right = (bb[1] - lc * math.sin(phi) + PEDAL_TOP, bb[2] + lc * math.cos(phi))
        left = (bb[1] + lc * math.sin(phi) + PEDAL_TOP, bb[2] - lc * math.cos(phi))
        out = {}
        for key, p in (("L", left), ("R", right)):
            t1, t2, d, knee = ik2((HIP[1], 0.0), to_body(p, root, lean), THIGH, SHIN, 1)
            out[key] = (t1, t2, d, knee)
        return out

    table = {"crank": [], "ThighL": [], "ShinL": [], "ThighR": [], "ShinR": []}
    reach, knees = [], []
    for k in range(24):
        phi = 2 * math.pi * k / 24
        lg = legs(phi)
        table["crank"].append(round(phi, 5))
        for key in ("L", "R"):
            table[f"Thigh{key}"].append(round(lg[key][0], 5))
            table[f"Shin{key}"].append(round(lg[key][1], 5))
            reach.append(lg[key][2])
            knees.append(lg[key][3])
    rider = {
        "rootOffset": [0.0, round(root[0], 5), round(root[1], 5)],
        "bodyLean": lean,
        "UpperArm": round(ua, 5),
        "Forearm": round(fa, 5),
        "grip": [SHOULDER[0], v["grip"][1], v["grip"][2]],
        "hip": [0.0, hip[0], hip[1]],
        "pedalTreadAboveSpindle": PEDAL_TOP,
        "pedalCycle": table,
    }
    log(
        "rider",
        variant=v["prefix"],
        root=rider["rootOffset"],
        arm_reach=round(arm_d, 4),
        elbow_deg=round(elbow, 1),
        leg_reach=[round(min(reach), 4), round(max(reach), 4)],
        knee_deg=[round(min(knees), 1), round(max(knees), 1)],
        limit=round(math.hypot(*THIGH) + math.hypot(*SHIN), 4),
    )
    return rider, legs


# ---------------------------------------------------------------- ママチャリ (26 × 1-3/8)
def build_city():
    p = "City"
    R, TYRE = 0.332, 0.018  # 26 × 1-3/8 (37-590): outer diameter ≈ 0.664 m
    zr, zf = -0.55, 0.55  # wheelbase 1.10 m
    ar, af = Vector((0, R, zr)), Vector((0, R, zf))
    bb = Vector((0, 0.27, zr + 0.465))
    crank = 0.165
    ax = SteerAxis(af, math.radians(22.0), 0.06)  # head angle 68°
    t_crown, t_head = 0.41, 0.57
    hip = (0.899, bb.z - 0.21)  # rider's hip pivot (y, z): see solve_rider
    grip_a, grip_b = Vector((0.205, 1.03, 0.135)), Vector((0.262, 1.03, 0.045))
    gk = (SHOULDER[0] - grip_a.x) / (grip_b.x - grip_a.x)
    grip = grip_a.lerp(grip_b, gk)  # grip point at x = shoulder width

    # Frame, saddle, rear fender, carrier, chain case.
    part = Part()
    tube(part, [ax.at(t_crown - 0.01), ax.at(t_head)], 0.022, "CityPaint")  # head tube
    u0 = ax.at(0.47) + Vector((0, 0, -0.012))
    main = bez(u0, u0 + Vector((0, -0.24, -0.05)), Vector((0, 0.33, 0.10)), bb + Vector((0, 0.035, 0.03)), 12)
    tube(part, main, 0.024, "CityPaint")  # low step-through U tube
    saddle_top, saddle_z = hip[0] - 0.065, hip[1] - 0.01
    clamp = Vector((0, saddle_top - 0.135, saddle_z + 0.01))
    seat_dir = (clamp - bb).normalized()
    seat_top = bb + seat_dir * ((0.60 - bb.y) / seat_dir.y)
    tube(part, [bb, seat_top], 0.017, "CityPaint")  # seat tube
    tube(part, [seat_top - seat_dir * 0.02, clamp], 0.0125, "Metal")  # seat post
    box(part, clamp + Vector((0, 0.012, 0)), (0.03, 0.02, 0.05), "Metal")
    tube(part, [bb + Vector((-0.04, 0, 0)), bb + Vector((0.04, 0, 0))], 0.021, "CityPaint")  # BB shell
    stay_top = seat_top - seat_dir * 0.03
    for s in (1, -1):
        drop = ar + Vector((s * 0.066, 0, 0))
        tube(part, [bb + Vector((s * 0.03, 0, -0.01)), drop], 0.011, "CityPaint")  # chain stays
        tube(part, [stay_top + Vector((s * 0.02, 0, 0)), drop], 0.010, "CityPaint")  # seat stays
    saddle(
        part,
        saddle_top,
        saddle_z,
        [(-0.125, 0.085, 0.022), (-0.11, 0.115, 0.034), (-0.05, 0.112, 0.036), (0.02, 0.085, 0.032)]
        + [(0.08, 0.052, 0.028), (0.125, 0.032, 0.022), (0.14, 0.02, 0.016)],
        "Rubber",
    )
    for s in (1, -1):  # coil springs under the back of the saddle
        base = Vector((s * 0.06, saddle_top - 0.11, saddle_z - 0.085))
        tube(part, [base, base + Vector((0, 0.05, 0))], 0.014, "Metal", segs=8, smooth=False)
    tube(part, [clamp + Vector((0, 0, -0.08)), clamp + Vector((0, 0, 0.09))], 0.006, "Metal", segs=6)  # rail
    fender = [(-0.0275, -0.010), (-0.016, -0.002), (0.0, 0.0), (0.016, -0.002), (0.0275, -0.010)]
    fender += [(0.0275, -0.0125), (0.016, -0.0045), (0.0, -0.0025), (-0.016, -0.0045), (-0.0275, -0.0125)]
    sweep_arc(part, ar, R + 0.03, fender, math.radians(22), math.radians(-124), 22, "Metal")  # rear fender
    for a in (math.radians(-60), math.radians(-112)):  # fender stays to the dropouts
        e = Vector((0, math.cos(a), math.sin(a)))
        for s in (1, -1):
            tube(
                part,
                [ar + (R + 0.02) * e + Vector((s * 0.03, 0, 0)), ar + Vector((s * 0.06, 0, 0))],
                0.0035,
                "Metal",
                5,
            )
    # 荷台: flat rack over the rear wheel, struts to the dropouts, bracket to the seat tube.
    cy, cz0, cz1, cw = 0.775, -0.33, -0.80, 0.08
    rack = [Vector((-cw, cy, cz0)), Vector((-cw, cy, cz1 + 0.03)), Vector((-cw + 0.03, cy, cz1))]
    rack += [Vector((cw - 0.03, cy, cz1)), Vector((cw, cy, cz1 + 0.03)), Vector((cw, cy, cz0))]
    tube(part, rack, 0.0065, "Metal", segs=6)
    tube(part, [Vector((-cw, cy, cz0)), Vector((cw, cy, cz0))], 0.0065, "Metal", segs=6)
    for x in (-0.027, 0.027):
        tube(part, [Vector((x, cy, cz0)), Vector((x, cy, cz1))], 0.0045, "Metal", segs=5)
    for z in (-0.47, -0.62):
        tube(part, [Vector((-cw, cy, z)), Vector((cw, cy, z))], 0.004, "Metal", segs=5)
    for s in (1, -1):
        drop = ar + Vector((s * 0.072, 0, 0))
        tube(part, [Vector((s * cw, cy, cz1 + 0.02)), drop], 0.006, "Metal", segs=6)
        tube(part, [Vector((s * cw, cy, -0.60)), drop], 0.006, "Metal", segs=6)
    tube(part, [Vector((0, cy, cz0)), stay_top + Vector((0, 0.03, -0.012))], 0.006, "Metal", segs=6)
    # Rear 反射器材 (red, facing back) under the end of the rack.
    box(part, (0.0, cy - 0.026, cz1 - 0.004), (0.085, 0.036, 0.012), "Reflector")
    box(part, (0.0, cy - 0.008, cz1 + 0.004), (0.02, 0.02, 0.012), "Metal")
    # Full chain case on the right (−X) over the 33T chainring and the rear sprocket.
    case = stadium([(bb.y, bb.z, 0.098), (ar.y, ar.z, 0.052)])
    slab_x(part, case, -0.068, -0.032, "CityPaint", bevel=0.008)
    make_object(f"{p}Bike", part, Matrix.Identity(4))

    # Steering assembly: fork, stem, swept-back bar, basket, front fender, 前照灯.
    steer = T(ax.at(t_crown)) @ rot_x(-ax.tilt)
    part = Part()
    crown = ax.at(t_crown)
    stem_top = ax.at(ax.t_at_y(0.99))
    tube(part, [crown, stem_top + 0.02 * ax.u], 0.0125, "Metal")  # steerer + quill stem
    bar_c = stem_top + 0.035 * ax.n + Vector((0, 0.012, 0))
    tube(part, [stem_top, bar_c], 0.012, "Metal", segs=6)
    box(part, crown, (0.105, 0.03, 0.04), "CityPaint", rot=rot_x(-ax.tilt))  # fork crown
    for s in (1, -1):
        top = crown + Vector((s * 0.045, 0, 0))
        end = af + Vector((s * 0.052, 0, 0))
        tube(part, bez(top, top - 0.16 * ax.u, end + 0.10 * ax.u - 0.01 * ax.n, end, 8), 0.0115, "CityPaint")
    half = [grip_b, grip_a, Vector((0.16, 1.024, 0.21)), Vector((0.08, bar_c.y, bar_c.z + 0.008)), bar_c]
    bar = [Vector((-q.x, q.y, q.z)) for q in half] + [Vector((q.x, q.y, q.z)) for q in reversed(half[:-1])]
    tube(part, bar, 0.0115, "Metal", segs=8)
    for s in (1, -1):
        a, b = Vector((s * grip_a.x, grip_a.y, grip_a.z)), Vector((s * grip_b.x, grip_b.y, grip_b.z))
        tube(part, [a, b + (b - a).normalized() * 0.006], 0.0165, "Rubber", segs=8)  # grips
        lever = Vector((s * 0.2, 1.02, 0.17))
        tube(part, [lever, lever + Vector((s * 0.07, -0.012, 0.03))], 0.0055, "Metal", segs=5)  # brake levers
    bell = Vector((0.15, 1.042, 0.205))
    tube(part, [bell, bell + Vector((0, 0.016, 0))], [0.024, 0.006], "Metal", segs=10)  # bell (left)
    # Front fender round the front axle.
    sweep_arc(part, af, R + 0.028, fender, math.radians(-95), math.radians(98), 20, "Metal")
    for s in (1, -1):
        e = Vector((0, math.cos(math.radians(70)), math.sin(math.radians(70))))
        tube(part, [af + (R + 0.02) * e + Vector((s * 0.03, 0, 0)), af + Vector((s * 0.055, 0, 0))], 0.0035, "Metal", 5)
    # Wire basket above the front wheel (alpha-masked mesh, rims as tubes).
    bx, by0, by1, bz0, bz1 = 0.175, 0.745, 0.965, 0.315, 0.60
    corners = {
        (sx, sy, sz): Vector((sx * bx, by0 if sy < 0 else by1, bz0 if sz < 0 else bz1))
        for sx in (-1, 1)
        for sy in (-1, 1)
        for sz in (-1, 1)
    }
    centre = Vector((0.0, (by0 + by1) / 2, (bz0 + bz1) / 2))
    uv_scale = 1 / 0.2  # basket.png tiles every 0.2 m
    for keys, axes in (
        ([(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)], (0, 2)),  # bottom
        ([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], (0, 1)),  # front
        ([(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)], (0, 1)),  # back
        ([(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)], (2, 1)),  # left
        ([(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)], (2, 1)),  # right
    ):
        f = face_out(part, [part.bm.verts.new(corners[k]) for k in keys], "Basket", centre)
        for loop in f.loops:
            co = loop.vert.co
            loop[part.uvl].uv = (co[axes[0]] * uv_scale, co[axes[1]] * uv_scale)
    for sy in (-1, 1):
        y = by0 if sy < 0 else by1
        rim = [Vector((-bx, y, bz0)), Vector((bx, y, bz0)), Vector((bx, y, bz1)), Vector((-bx, y, bz1))]
        tube(part, rim, 0.005 if sy > 0 else 0.004, "Metal", segs=5, closed=True)
    for sx in (-1, 1):
        for sz in (-1, 1):
            c0 = corners[(sx, -1, sz)]
            tube(part, [c0, corners[(sx, 1, sz)]], 0.0035, "Metal", segs=4)
        tube(
            part,
            [corners[(sx, -1, 1)] + Vector((-sx * 0.05, 0, 0)), af + Vector((sx * 0.06, 0, 0))],
            0.0045,
            "Metal",
            5,
        )
    bracket_z = ax.at(ax.t_at_y(0.93)).z
    tube(part, [Vector((0, 0.93, bz0)), Vector((0, 0.93, bracket_z))], 0.007, "Metal", segs=6)
    # 前照灯 on the front of the fork crown: black housing, metal bezel, emissive lens.
    lamp = Vector((0.0, crown.y + 0.01, crown.z + 0.075))
    tube(
        part, [lamp - Vector((0, 0, 0.035)), lamp + Vector((0, 0, 0.03))], 0.028, "Rubber", segs=12, caps=(True, False)
    )
    tube(
        part, [lamp + Vector((0, 0, 0.026)), lamp + Vector((0, 0, 0.034))], 0.031, "Metal", segs=12, caps=(False, False)
    )
    lens = [
        part.bm.verts.new(lamp + Vector((0.026 * math.cos(a), 0.026 * math.sin(a), 0.031)))
        for a in (2 * math.pi * k / 12 for k in range(12))
    ]
    face_out(part, lens, "HeadLamp", lamp)
    tube(part, [lamp - Vector((0, 0, 0.03)), crown + Vector((0, 0, 0.02))], 0.008, "Metal", segs=5)
    make_object(f"{p}Steer", part, steer, parent=f"{p}Bike")

    part = Part()
    wheel(part, R, TYRE, 0.014, 32, 0.07)
    make_object(f"{p}FrontWheel", part, T(af) @ rot_x(-ax.tilt), parent=f"{p}Steer", local=True)
    part = Part()
    wheel(part, R, TYRE, 0.014, 32, 0.09, extras=[(0.03, 0.045, 0.048)])  # roller-brake drum on the left
    make_object(f"{p}RearWheel", part, T(ar), parent=f"{p}Bike", local=True)
    crank_assembly(p, bb, crank, 0.08)

    # 両立スタンド: built standing (down), exported folded up behind the wheel (rotation.x = up).
    part = Part()
    length = 0.385  # longer than the fender radius, so it folds round it; down, it lifts the rear wheel
    path = []
    for s in (1, -1):
        top = ar + Vector((s * 0.075, 0, 0))
        foot = ar + Vector((s * 0.115, -length + 0.012, 0.0))
        seg = bez(top, top + Vector((0, -0.12, 0)), foot + Vector((0, 0.08, 0)), foot, 5)
        path.append(seg)
    across = bez(
        path[0][-1], path[0][-1] + Vector((-0.03, -0.006, 0)), path[1][-1] + Vector((0.03, -0.006, 0)), path[1][-1], 4
    )
    u_path = path[0] + across[1:]
    u_path += list(reversed(path[1]))[1:]
    tube(part, u_path, 0.0075, "Metal", segs=6)
    for s in (1, -1):
        box(part, ar + Vector((s * 0.11, -length + 0.008, 0.0)), (0.05, 0.016, 0.03), "Rubber")
    stand_up = 1.62
    make_object(f"{p}Stand", part, T(ar), parent=f"{p}Bike", extra=rot_x(stand_up))

    return {
        "prefix": p,
        "R": R,
        "wheelbase": zf - zr,
        "bb": (0.0, bb.y, bb.z),
        "crank": crank,
        "teeth": (33, 14),
        "lean": 0.17,
        "hip": hip,
        "grip": (grip.x, grip.y, grip.z),
        "steer": ax,
        "stand_up": stand_up,
        "stand_down_lift": length - R,
        "front_contact": zf,
    }


# ---------------------------------------------------------------- クロスバイク (700 × 28C)
def build_sport():
    p = "Sport"
    R, TYRE = 0.339, 0.014  # 700 × 28C (28-622): outer diameter ≈ 0.678 m
    zr, zf = -0.52, 0.52  # wheelbase 1.04 m
    ar, af = Vector((0, R, zr)), Vector((0, R, zf))
    bb = Vector((0, 0.268, zr + 0.43))
    crank = 0.170
    ax = SteerAxis(af, math.radians(19.0), 0.045)  # head angle 71°
    t_crown, t_head = 0.385, 0.535
    hip = (0.928, bb.z - 0.17)
    grip_y, grip_z = 0.965, 0.30

    part = Part()
    head_top, head_bot = ax.at(t_head), ax.at(t_crown - 0.005)
    tube(part, [head_bot, head_top], 0.021, "SportPaint")
    saddle_top, saddle_z = hip[0] - 0.06, hip[1] - 0.005
    clamp = Vector((0, saddle_top - 0.075, saddle_z + 0.005))
    seat_dir = (clamp - bb).normalized()
    seat_top = bb + seat_dir * ((0.76 - bb.y) / seat_dir.y)
    tube(part, [bb, seat_top], 0.016, "SportPaint")
    tube(part, [seat_top - seat_dir * 0.02, clamp], 0.0135, "Metal")
    box(part, clamp, (0.03, 0.02, 0.05), "Metal")
    tube(part, [ax.at(t_head - 0.025), seat_top - seat_dir * 0.035], 0.017, "SportPaint")  # top tube
    tube(part, [ax.at(t_crown + 0.035), bb + Vector((0, 0.01, 0.015))], 0.021, "SportPaint")  # down tube
    tube(part, [bb + Vector((-0.036, 0, 0)), bb + Vector((0.036, 0, 0))], 0.02, "SportPaint")
    stay_top = seat_top - seat_dir * 0.045
    for s in (1, -1):
        drop = ar + Vector((s * 0.066, 0, 0))
        tube(part, [bb + Vector((s * 0.03, 0, -0.01)), drop], 0.0095, "SportPaint")
        tube(part, [stay_top + Vector((s * 0.018, 0, 0)), drop], 0.0085, "SportPaint")
    saddle(
        part,
        saddle_top,
        saddle_z,
        [(-0.12, 0.05, 0.016), (-0.1, 0.075, 0.026), (-0.04, 0.068, 0.028), (0.03, 0.04, 0.024)]
        + [(0.09, 0.024, 0.02), (0.135, 0.016, 0.016)],
        "Rubber",
    )
    tube(part, [clamp + Vector((0, 0.01, -0.07)), clamp + Vector((0, 0.01, 0.08))], 0.0045, "Metal", segs=6)
    # Rear 反射器材 on the seat post, facing back.
    rz = clamp.z + (0.74 - clamp.y) / seat_dir.y * seat_dir.z
    box(part, (0.0, 0.74, rz - 0.024), (0.05, 0.075, 0.012), "Reflector")
    box(part, (0.0, 0.74, rz - 0.012), (0.03, 0.03, 0.016), "Rubber")
    # Chain: static loop round the 38T ring and the 17T cog (both rotate under it).
    ring_r, cog_r, chain_x = 38 * 0.0127 / (2 * math.pi), 17 * 0.0127 / (2 * math.pi), -0.058
    loop = stadium([(bb.y, bb.z, ring_r + 0.003), (ar.y, ar.z, cog_r + 0.003)], n=18)
    tube(part, [Vector((chain_x, y, z)) for y, z in loop], 0.0035, "Rubber", segs=4, closed=True, smooth=False)
    # Rear derailleur and brake bosses (small blocks so the drive side does not read empty).
    box(part, ar + Vector((-0.06, -0.06, 0.015)), (0.018, 0.07, 0.03), "Metal")
    make_object(f"{p}Bike", part, Matrix.Identity(4))

    steer = T(ax.at(t_crown)) @ rot_x(-ax.tilt)
    part = Part()
    crown = ax.at(t_crown)
    steer_top = ax.at(t_head + 0.06)
    tube(part, [crown, steer_top], 0.0145, "Metal")  # steerer + spacers
    clamp_bar = Vector((0, grip_y - 0.012, grip_z))
    tube(part, [steer_top - 0.02 * ax.u, clamp_bar], 0.016, "Rubber", segs=8)  # rising stem
    box(part, crown, (0.095, 0.035, 0.045), "SportPaint", rot=rot_x(-ax.tilt))
    for s in (1, -1):
        top = crown + Vector((s * 0.042, 0, 0))
        end = af + Vector((s * 0.05, 0, 0))
        tube(
            part,
            bez(top, top - 0.18 * ax.u, end + 0.08 * ax.u - 0.004 * ax.n, end, 7),
            [0.014] * 3 + [0.011] * 5,
            "SportPaint",
        )
    bar = [
        Vector((x, grip_y - 0.012 + 0.012 * min(1.0, abs(x) / 0.12), grip_z))
        for x in (-0.29, -0.18, -0.07, 0.0, 0.07, 0.18, 0.29)
    ]
    tube(part, bar, 0.0112, "Metal", segs=8)  # flat bar with a little rise
    for s in (1, -1):
        tube(part, [Vector((s * 0.18, grip_y, grip_z)), Vector((s * 0.29, grip_y, grip_z))], 0.016, "Rubber", segs=8)
        lever = Vector((s * 0.165, grip_y + 0.005, grip_z + 0.01))
        tube(part, [lever, lever + Vector((s * 0.07, -0.01, 0.045))], 0.005, "Metal", segs=5)
        box(part, af + 0.3 * ax.u + Vector((s * 0.05, 0, -0.03)), (0.012, 0.06, 0.012), "Metal")  # V-brake arms
    # Battery 前照灯 on the bar, left of the stem.
    lamp = Vector((0.07, grip_y + 0.022, grip_z + 0.02))
    tube(
        part, [lamp - Vector((0, 0, 0.045)), lamp + Vector((0, 0, 0.04))], 0.017, "Rubber", segs=10, caps=(True, False)
    )
    lens = [
        part.bm.verts.new(lamp + Vector((0.015 * math.cos(a), 0.015 * math.sin(a), 0.041)))
        for a in (2 * math.pi * k / 10 for k in range(10))
    ]
    face_out(part, lens, "HeadLamp", lamp)
    make_object(f"{p}Steer", part, steer, parent=f"{p}Bike")

    part = Part()
    wheel(part, R, TYRE, 0.02, 32, 0.07)
    make_object(f"{p}FrontWheel", part, T(af) @ rot_x(-ax.tilt), parent=f"{p}Steer", local=True)
    part = Part()
    cassette = [(-0.024 - 0.0045 * k, -0.0215 - 0.0045 * k, 0.026 + 0.0045 * k) for k in range(6)]
    wheel(part, R, TYRE, 0.02, 32, 0.08, extras=cassette)
    make_object(f"{p}RearWheel", part, T(ar), parent=f"{p}Bike", local=True)
    crank_assembly(p, bb, crank, 0.08, ring=(ring_r + 0.004, chain_x))

    return {
        "prefix": p,
        "R": R,
        "wheelbase": zf - zr,
        "bb": (0.0, bb.y, bb.z),
        "crank": crank,
        "teeth": (38, 17),
        "lean": 0.45,
        "hip": hip,
        "grip": (SHOULDER[0], grip_y, grip_z),
        "steer": ax,
        "stand_up": None,
        "stand_down_lift": None,
    }


def tidy(value):
    """Round floats (mathutils works in single precision) so the glTF extras read cleanly."""
    if isinstance(value, dict):
        return {k: tidy(x) for k, x in value.items()}
    if isinstance(value, (list, tuple)):
        return [tidy(x) for x in value]
    return round(value, 5) if isinstance(value, float) else value


VARIANTS = [build_city(), build_sport()]
RIDERS = {}
for v in VARIANTS:
    rider, legs_fn = solve_rider(v)
    RIDERS[v["prefix"]] = (rider, legs_fn)
    ax = v["steer"]
    a, b = v["teeth"]
    info = {
        "wheelRadius": v["R"],
        "wheelbase": round(v["wheelbase"], 4),
        "crankLength": v["crank"],
        "chainring": a,
        "sprocket": b,
        "ratio": round(a / b, 5),
        "steerAxisTilt": round(ax.tilt, 5),
        "rider": rider,
    }
    if v["stand_up"] is not None:
        info["standUp"] = v["stand_up"]
        info["standDownLift"] = round(v["stand_down_lift"], 4)
        # Parked on the stand the bike pitches nose-down about the front tyre's contact point.
        info["standParkPitch"] = round(math.atan2(v["stand_down_lift"], v["wheelbase"]), 5)
        info["standParkPivot"] = [0.0, 0.0, v["front_contact"]]
    bpy.data.objects[f"{v['prefix']}Bike"]["bicycle"] = tidy(info)

for o in list(SCENE.objects):
    o.select_set(False)
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
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris)
bpy.context.view_layer.update()  # children's matrix_world is stale until the depsgraph runs
for v in VARIANTS:
    names = [n for n in tris if n.startswith(v["prefix"])]
    pts = []
    for n in names:
        ob = bpy.data.objects[n]
        pts += [ob.matrix_world @ vx.co for vx in ob.data.vertices]
    lo = Vector((min(q.x for q in pts), min(q.y for q in pts), min(q.z for q in pts)))
    hi = Vector((max(q.x for q in pts), max(q.y for q in pts), max(q.z for q in pts)))
    log(
        "bounds",
        variant=v["prefix"],
        tris=sum(tris[n] for n in names),
        width=round(hi.x - lo.x, 3),
        height=round(hi.y - lo.y, 3),
        length=round(hi.z - lo.z, 3),
        z=[round(lo.z, 3), round(hi.z, 3)],
    )

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    gbm = bmesh.new()
    for q in [(-8, 0, -8), (8, 0, -8), (8, 0, 8), (-8, 0, 8)]:
        gbm.verts.new(q)
    gbm.faces.new(gbm.verts)
    gme = bpy.data.meshes.new("Ground")
    gbm.to_mesh(gme)
    gme.materials.append(material("Ground", 0x7A7D80, roughness=0.9))
    SCENE.collection.objects.link(bpy.data.objects.new("Ground", gme))
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(-55), math.radians(30), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 50
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 24
    SCENE.render.resolution_x = 960
    SCENE.render.resolution_y = 540

    # The jointed human, imported from its glb (glTF Y-up → Blender Z-up, undone by HumanFix) and
    # rigged like src/world/human.ts: root → body (lean) → parts; forearms/shins under their
    # upper parts so rotation.x bends the joints exactly as in the game.
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=HUMAN)
    hp = {o.name: o for o in bpy.data.objects if o not in before}
    h_root = bpy.data.objects.new("HumanRoot", None)
    h_body = bpy.data.objects.new("HumanBody", None)
    h_fix = bpy.data.objects.new("HumanFix", None)
    for o in (h_root, h_body, h_fix):
        SCENE.collection.objects.link(o)
    h_body.parent = h_root
    h_fix.parent = h_body
    h_fix.rotation_euler.x = -math.pi / 2
    for o in hp.values():
        o.rotation_mode = "XYZ"
        o.parent = h_fix
        o.matrix_parent_inverse = Matrix.Identity(4)
    for lower, upper in (
        ("ForearmL", "UpperArmL"),
        ("ForearmR", "UpperArmR"),
        ("ShinL", "ThighL"),
        ("ShinR", "ThighR"),
    ):
        base = hp[upper].matrix_basis.copy()
        hp[lower].parent = hp[upper]
        hp[lower].matrix_parent_inverse = base.inverted()
    for o in ("HairLong", "HairBun"):
        hp[o].hide_render = True
    tints = {"Skin": 0xE8C4A8, "Shirt": 0x3E6FB5, "Pants": 0x23252E, "Hair": 0x1C1410}
    for m in bpy.data.materials:
        if m.name not in tints or not m.node_tree:
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if not tex:
            continue
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[7].default_value = lin(tints[m.name])
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])

    def show(prefix, rider_on):
        for o in SCENE.objects:
            if o.type != "MESH" or o.name == "Ground":
                continue
            if o.name in hp:
                o.hide_render = not rider_on or o.name in ("HairLong", "HairBun")
            elif o.name.startswith(("City", "Sport")):
                o.hide_render = not o.name.startswith(prefix)

    def pose(prefix, phi):
        rider, legs_fn = RIDERS[prefix]
        bpy.data.objects[f"{prefix}Crank"].rotation_euler.x = phi
        for s in ("L", "R"):
            bpy.data.objects[f"{prefix}Pedal{s}"].rotation_euler.x = -phi
        h_root.location = rider["rootOffset"]
        h_body.rotation_euler.x = rider["bodyLean"]
        lg = legs_fn(phi)
        for s in ("L", "R"):
            hp[f"UpperArm{s}"].rotation_euler.x = rider["UpperArm"]
            hp[f"Forearm{s}"].rotation_euler.x = rider["Forearm"]
            hp[f"Thigh{s}"].rotation_euler.x = lg[s][0]
            hp[f"Shin{s}"].rotation_euler.x = lg[s][1]

    def shot(name, eye, target, lens=50):
        cam.data.lens = lens
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"bicycle-{name}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=name)

    for prefix in ("City", "Sport"):
        low = prefix.lower()
        show(prefix, False)
        pose(prefix, 0.6)
        shot(f"{low}-side", (-3.6, 0.62, 0.0), (0.0, 0.55, 0.0))
        shot(f"{low}-front34", (2.3, 1.45, 2.6), (0.0, 0.55, 0.05))
        shot(f"{low}-rear34", (-2.0, 1.3, -2.6), (0.0, 0.5, -0.1))
        shot(f"{low}-front", (0.0, 0.95, 3.6), (0.0, 0.6, 0.0))
        show(prefix, True)
        for deg in (0, 90, 180):
            pose(prefix, math.radians(deg))
            shot(f"{low}-rider-side-{deg:03d}", (-4.6, 1.2, 0.0), (0.0, 0.95, 0.0), lens=45)
        pose(prefix, math.radians(45))
        shot(f"{low}-rider-front34", (3.0, 1.9, 3.4), (0.0, 0.95, 0.0), lens=45)
        show(prefix, False)
        # Steering 0.5 rad to the left the way the game does it: Rx(fixed tilt)·Ry(steer).
        st = bpy.data.objects[f"{prefix}Steer"]
        rest = st.matrix_basis.copy()
        loc, rot, _ = rest.decompose()
        st.matrix_basis = T(loc) @ rot.to_matrix().to_4x4() @ Matrix.Rotation(0.5, 4, "Y")
        shot(f"{low}-steer-left", (1.6, 2.6, 2.4), (0.0, 0.6, 0.2))
        st.matrix_basis = rest
    if "CityStand" in bpy.data.objects:  # parked: stand down (rotation.x = 0)
        show("City", False)
        info = bpy.data.objects["CityBike"]["bicycle"]
        pitch, pz = info["standParkPitch"], info["standParkPivot"][2]
        bpy.data.objects["CityStand"].rotation_euler.x = 0.0
        bike = bpy.data.objects["CityBike"]
        bike.rotation_euler.x = pitch
        bike.location = (0.0, pz * math.sin(pitch), pz - pz * math.cos(pitch))
        shot("city-parked", (-2.4, 1.1, -2.2), (0.0, 0.45, -0.2))
