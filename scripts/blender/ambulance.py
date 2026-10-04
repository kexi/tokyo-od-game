# 高規格救急車（ハイルーフのセミボンネット型）for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/ambulance.py -- public/models/ambulance.glb [preview-dir]
#
# Game coordinates (+Y up, nose toward +Z, ground at y = 0, the vehicle's left = +X), exported
# with export_yup=False. About 5.6 m long, 1.9 m wide, 2.5 m high. One object "Ambulance" for
# the body, glazing, lamps and decals, and one "AmbulanceWheels" for the four wheels. Materials
# BeaconL / BeaconR are the two halves of the red light bar (and the rear and side beacons on
# that side) so the game can flash them alternately. Decal artwork comes from
# assets/ambulance/textures (agy): side band with 救急 / AMBULANCE, the mirrored 救急 on the hood
# for drivers ahead to read in their mirrors, and the rear band. No red cross or other emblem.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "ambulance.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "ambulance", "textures")

HW = 0.94  # half width of the body
FRONT, REAR = 2.80, -2.80
AXLES = (1.80, -1.70)
WHEEL_R = 0.36
ARCH_R = 0.44
TRACK = 0.80  # wheel centre from the centreline


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


def material(name, color, metallic=0.0, roughness=0.5, image=None, emission=0.0, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emission:
        b.inputs["Emission Color"].default_value = lin(color)
        b.inputs["Emission Strength"].default_value = emission
    if image:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(TEX, image))
        m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        if emission:
            m.node_tree.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
        if alpha:
            rnd = m.node_tree.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"  # glTF alphaMode MASK: crisp decal edges
            m.node_tree.links.new(tex.outputs["Alpha"], rnd.inputs[0])
            m.node_tree.links.new(rnd.outputs[0], b.inputs["Alpha"])
    MAT[name] = m
    return m


material("Body", 0xF4F4F0, metallic=0.15, roughness=0.35)
material("Glass", 0x10171F, metallic=0.4, roughness=0.08)
material("Frosted", 0xD8DCDE, roughness=0.25)  # 患者室の曇りガラス
material("Trim", 0x2A2D31, roughness=0.6)
material("HeadLamp", 0xFFF6E0, emission=1.5)
material("TailLamp", 0xB0141A, emission=0.6)
material("BeaconL", 0xD8141C, roughness=0.3, image="ambulance_lightbar.png", emission=0.5)
material("BeaconR", 0xD8141C, roughness=0.3, image="ambulance_lightbar.png", emission=0.5)
material("DecalSide", 0xFFFFFF, roughness=0.35, image="ambulance_side.png", alpha=True)
material("DecalRear", 0xFFFFFF, roughness=0.35, image="ambulance_rear.png", alpha=True)
material("DecalHood", 0xFFFFFF, roughness=0.35, image="ambulance_hood.png", alpha=True)
material("Tire", 0x16171A, roughness=0.9)
material("Hub", 0xB9BEC4, metallic=0.7, roughness=0.35)
ORDER = [
    "Body",
    "Glass",
    "Frosted",
    "Trim",
    "HeadLamp",
    "TailLamp",
    "BeaconL",
    "BeaconR",
    "DecalSide",
    "DecalRear",
    "DecalHood",
]
IDX = {n: i for i, n in enumerate(ORDER)}


# ---------------------------------------------------------------- body loft
def top_at(z):
    """Roof line: bumper → bonnet → windscreen → high roof (overhanging the cab) → rear."""
    pts = [
        (FRONT, 0.92),
        (2.68, 1.05),
        (2.25, 1.14),
        (1.95, 1.20),
        (1.22, 1.96),
        (1.05, 2.46),
        (REAR + 0.08, 2.46),
        (REAR, 2.40),
    ]
    for (z0, y0), (z1, y1) in zip(pts, pts[1:], strict=False):
        if z1 <= z <= z0:
            return y0 + (y1 - y0) * (z0 - z) / (z0 - z1)
    return pts[-1][1]


def bottom_at(z):
    """Underside with wheel arches round each axle."""
    y = 0.38
    for axle in AXLES:
        dz = abs(z - axle)
        if dz < ARCH_R:
            y = max(y, WHEEL_R + math.sqrt(ARCH_R**2 - dz**2) - 0.02)
    return y


def half_width_at(z):
    if z > 2.6:
        return HW - 0.06 * (z - 2.6) / 0.2  # rounded nose
    if z < REAR + 0.1:
        return HW - 0.03
    return HW


SIDE_LEVELS = [0.95, 1.18, 1.86, 2.08]  # belt line, window sill, window head, roof rail


def section(z):
    """Ring (x, y) at station z; always the same number of points so stations loft together."""
    hw, top, bottom = half_width_at(z), top_at(z), bottom_at(z)
    r = min(0.16, (top - bottom) * 0.3)
    lo, hi = bottom + 0.01, top - r - 0.01
    levels = []
    for k, y in enumerate(SIDE_LEVELS):
        # Clamp into the side wall; levels that do not fit collapse onto its ends.
        levels.append(min(max(y, lo + 0.002 * k), hi - 0.002 * (len(SIDE_LEVELS) - k)))
    ring = [(-hw, bottom), (hw, bottom)]
    ring += [(hw, y) for y in levels]
    for k in range(5):  # right roof corner
        a = math.radians(90 * k / 4)
        ring.append((hw - r + r * math.cos(a), top - r + r * math.sin(a)))
    for k in range(5):  # left roof corner
        a = math.radians(90 + 90 * k / 4)
        ring.append((-hw + r + r * math.cos(a), top - r + r * math.sin(a)))
    ring += [(-hw, y) for y in reversed(levels)]
    return ring


# Stations: dense under the windscreen (the cab door glass follows its slope), round the arches
# and at every window break.
stations = {FRONT, 2.74, 2.68, 2.5, 2.25, 1.95, 1.85, 1.75, 1.65, 1.55, 1.45, 1.35, 1.22, 1.12, 1.05, 0.95}
stations |= {0.4, -0.2, -0.9, -1.2, -2.3, -2.55, REAR + 0.08, REAR}
for axle in AXLES:
    for k in range(-6, 7):
        stations.add(round(axle + ARCH_R * 1.02 * k / 6, 4))
stations = sorted(stations, reverse=True)


def body_material(c, n):
    """Glazing, sills and paint by where a face sits."""
    if abs(n.x) > 0.7:
        is_window_band = 1.18 < c.y < 1.86
        if is_window_band and 1.06 < c.z < 1.9:
            return "Glass"  # cab doors
        if is_window_band and -2.3 < c.z < -0.2 and abs(c.z + 0.55) > 0.3:
            return "Frosted"  # patient compartment windows either side of the pillar
        if c.y < 0.5:
            return "Trim"  # sills
        return "Body"
    if n.y < -0.7:
        return "Trim"  # underbody
    if 1.22 < c.z < 1.95 and c.y > 1.2:
        return "Glass"  # windscreen
    return "Body"


bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
rings = [[bm.verts.new((x, y, z)) for x, y in section(z)] for z in stations]
for a, b in zip(rings, rings[1:], strict=False):
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        if (a[i].co - a[j].co).length < 1e-4 and (b[i].co - b[j].co).length < 1e-4:
            continue  # collapsed side level: no face
        bm.faces.new((a[i], a[j], b[j], b[i]))
bm.faces.new(rings[0])
bm.faces.new(list(reversed(rings[-1])))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.material_index = IDX[body_material(f.calc_center_median(), f.normal)]


def box(cx, cy, cz, sx, sy, sz, mat, uv=False):
    vs = [
        bm.verts.new((cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2))
        for dx, dy, dz in [
            (-1, -1, -1),
            (1, -1, -1),
            (1, 1, -1),
            (-1, 1, -1),
            (-1, -1, 1),
            (1, -1, 1),
            (1, 1, 1),
            (-1, 1, 1),
        ]
    ]
    for face in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]:
        f = bm.faces.new([vs[i] for i in face])
        f.material_index = IDX[mat]
        if uv:
            for loop, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)], strict=True):
                loop[uvl].uv = (u, v)


def quad(corners, uvs, mat):
    f = bm.faces.new([bm.verts.new(c) for c in corners])
    f.material_index = IDX[mat]
    for loop, uv in zip(f.loops, uvs, strict=True):
        loop[uvl].uv = uv
    return f


# Bumpers, grille, lamps, mirrors.
box(0.0, 0.48, FRONT + 0.03, 1.80, 0.22, 0.10, "Trim")
box(0.0, 0.48, REAR - 0.03, 1.80, 0.22, 0.10, "Trim")
box(0.0, 0.78, FRONT + 0.005, 0.90, 0.16, 0.02, "Trim")  # grille
for x in (-0.66, 0.66):
    box(x, 0.86, FRONT - 0.02, 0.30, 0.13, 0.08, "HeadLamp")
    box(math.copysign(HW - 0.09, x), 0.98, REAR - 0.012, 0.13, 0.36, 0.04, "TailLamp")  # rear corners
    box(math.copysign(HW + 0.08, x), 1.58, 1.88, 0.06, 0.22, 0.14, "Trim")  # door mirrors
# Red light bar across the roof front, rear beacons, each split left (+X) / right (−X).
for side, mat in ((1, "BeaconL"), (-1, "BeaconR")):
    box(side * 0.41, 2.53, 1.08, 0.80, 0.14, 0.20, mat, uv=True)
    box(side * 0.72, 2.51, REAR + 0.12, 0.22, 0.10, 0.16, mat, uv=True)
    box(side * (HW + 0.012), 2.30, 0.9, 0.03, 0.10, 0.22, mat, uv=True)  # side flashers

# Decals just proud of the paint. Seen from outside, the left side runs front → rear left to
# right, so the band's lettering sits behind the cab; on the right side it reads the other way
# round (rear → front) and the lettering lands toward the rear, as on real vehicles.
D = 0.004
z0, z1, y0, y1 = 2.0, -2.6, 0.70, 1.85
quad(
    [(HW + D, y0, z0), (HW + D, y0, z1), (HW + D, y1, z1), (HW + D, y1, z0)],
    [(0, 0), (1, 0), (1, 1), (0, 1)],
    "DecalSide",
)
quad(
    [(-HW - D, y0, z1), (-HW - D, y0, z0), (-HW - D, y1, z0), (-HW - D, y1, z1)],
    [(0, 0), (1, 0), (1, 1), (0, 1)],
    "DecalSide",
)
rx = HW - 0.10
quad(
    [(rx, 0.95, REAR - D), (-rx, 0.95, REAR - D), (-rx, 1.80, REAR - D), (rx, 1.80, REAR - D)],
    [(0, 0), (1, 0), (1, 1), (0, 1)],
    "DecalRear",
)
# Mirrored 救急 on the bonnet, upright to someone standing in front.
hz0, hz1 = 2.62, 2.27
quad(
    [
        (-0.70, top_at(hz0) + 0.01, hz0),
        (0.70, top_at(hz0) + 0.01, hz0),
        (0.70, top_at(hz1) + 0.01, hz1),
        (-0.70, top_at(hz1) + 0.01, hz1),
    ],
    [(0, 0), (1, 0), (1, 1), (0, 1)],
    "DecalHood",
)

me = bpy.data.meshes.new("Ambulance")
bm.to_mesh(me)
bm.free()
for name in ORDER:
    me.materials.append(MAT[name])
ob = bpy.data.objects.new("Ambulance", me)
SCENE.collection.objects.link(ob)
# Decal and lamp quads face outward; make sure the loft's normals are outward too.
for p in me.polygons:
    p.use_smooth = False

# ---------------------------------------------------------------- wheels
bm = bmesh.new()
segs = 20
for z in AXLES:
    for side in (1, -1):
        x0 = side * TRACK
        rings_w = []
        for dx, r in ((-0.11, WHEEL_R * 0.92), (-0.11, WHEEL_R), (0.11, WHEEL_R), (0.11, WHEEL_R * 0.92)):
            rings_w.append(
                [
                    bm.verts.new(
                        (
                            x0 + side * dx,
                            WHEEL_R + r * math.cos(2 * math.pi * k / segs),
                            z + r * math.sin(2 * math.pi * k / segs),
                        )
                    )
                    for k in range(segs)
                ]
            )
        for a, b in zip(rings_w, rings_w[1:], strict=False):
            for k in range(segs):
                j = (k + 1) % segs
                bm.faces.new((a[k], a[j], b[j], b[k])).material_index = 0
        hub = [
            bm.verts.new(
                (
                    x0 + side * 0.112,
                    WHEEL_R + 0.2 * math.cos(2 * math.pi * k / segs),
                    z + 0.2 * math.sin(2 * math.pi * k / segs),
                )
            )
            for k in range(segs)
        ]
        bm.faces.new(hub).material_index = 1
        bm.faces.new(list(reversed(rings_w[-1]))).material_index = 0
        bm.faces.new(rings_w[0]).material_index = 0
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
wm = bpy.data.meshes.new("AmbulanceWheels")
bm.to_mesh(wm)
bm.free()
wm.materials.append(MAT["Tire"])
wm.materials.append(MAT["Hub"])
for p in wm.polygons:
    p.use_smooth = True
wheels = bpy.data.objects.new("AmbulanceWheels", wm)
SCENE.collection.objects.link(wheels)

for o in list(SCENE.objects):
    o.select_set(False)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=False,
    export_apply=True,
    export_draco_mesh_compression_enable=True,
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SCENE.objects if o.type == "MESH"}
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    gbm = bmesh.new()
    for p in [(-8, 0, -8), (8, 0, -8), (8, 0, 8), (-8, 0, 8)]:
        gbm.verts.new(p)
    gbm.faces.new(gbm.verts)
    gme = bpy.data.meshes.new("Ground")
    gbm.to_mesh(gme)
    gme.materials.append(material("Ground", 0x6A6D70, roughness=0.9))
    SCENE.collection.objects.link(bpy.data.objects.new("Ground", gme))
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.68, 0.8, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(-60), math.radians(35), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 40
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 32
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    views = {
        "front-left": ((6.5, 2.4, 6.5), (0.0, 1.2, 0.3)),
        "rear-right": ((-6.0, 2.6, -6.5), (0.0, 1.3, -0.3)),
        "front": ((0.0, 2.6, 7.5), (0.0, 1.2, 0.0)),
    }
    for view, (eye, target) in views.items():
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"ambulance-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
