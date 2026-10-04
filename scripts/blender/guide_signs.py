# 案内標識 (方面及び方向 108 系) の支柱・腕・標示板 for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/guide_signs.py -- public/models/guide_signs.glb [preview-dir]
#
# Game coordinates (+Y up, +Z = the side the board face looks at), exported with export_yup=False,
# like scripts/blender/signs.py. The game (src/world/guideSigns.ts) instances every part and
# scales the unit ones to each sign:
#
#   GuidePole   片持式（F 形）の支柱: 鋼管 φ267.4 mm, 7.6 m, base plate and anchor-nut covers at y = 0,
#               cap on top. Scaled in Y only by small amounts (7.0–8.2 m).
#   GuideArm    腕: 鋼管 φ139.8 mm from x = 0 (the pole axis) to x = 1, scaled in X to its length;
#               the flange that bolts it to the pole is a separate part (GuideFlange).
#   GuideFlange the arm's two-piece band around the pole, centred on the pole axis.
#   GuideBoard  標示板: 1 × 1 m aluminium plate (face at z = 0 toward +Z, material GuideFace with
#               UV 0–1 over the face) on two vertical channel rails behind it (z < 0); scaled in
#               X and Y to the board. The face texture is drawn per sign at runtime.
#   GuidePost   路側式の支柱: 鋼管 φ89.1 mm from y = 0 to 1 with a cap, scaled in Y.
#
# Sizes: 道路標識設置基準 (片持式・門型式 の標示板の設置高さ 5.0 m 標準, 4.7 m 以上) and the usual
# F-pole steel (φ267.4 / φ139.8 mm, STK400 galvanised). Board 2.8 × 2.2 m at 30 cm letters
# (国土交通省「案内標識の文字の大きさ」Q&A: 交差点案内標識 220 × 280 cm, 予告 240 × 280 cm).
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "guide_signs.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None

POLE_R = 0.2674 / 2
POLE_H = 7.6
ARM_R = 0.1398 / 2
POST_R = 0.0891 / 2
BOARD_T = 0.003  # aluminium sheet
RAIL_W = 0.075  # channel rails behind the board
RAIL_D = 0.04


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


def material(name, color, metallic=0.0, roughness=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    MAT[name] = m
    return m


# Galvanised steel weathers to a matte grey; the face colour is a placeholder (the game draws it).
material("GuideSteel", 0x9EA4A9, metallic=0.65, roughness=0.5)
material("GuideBolt", 0x6B7075, metallic=0.7, roughness=0.45)
material("GuideFace", 0x1D4F9C, roughness=0.45)
material("GuideBack", 0x8E959B, metallic=0.55, roughness=0.5)


def new_object(name, bm, mats, smooth=False, sharp_angle=40):
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp_angle):
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(ob)
    return ob


def box(bm, cx, cy, cz, sx, sy, sz, mat=0):
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
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]:
        bm.faces.new([vs[i] for i in f]).material_index = mat


def tube(bm, axis, r, a0, a1, segs=16, cap0=False, cap1=True, mat=0, centre=(0.0, 0.0, 0.0)):
    """A pipe of radius r along `axis` ("x" or "y") from a0 to a1, through `centre`."""
    cx, cy, cz = centre
    rings = []
    for a in (a0, a1):
        ring = []
        for i in range(segs):
            t = 2 * math.pi * i / segs
            u, v = r * math.cos(t), r * math.sin(t)
            co = (a, cy + u, cz + v) if axis == "x" else (cx + u, a, cz + v)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i])).material_index = mat
    if cap0:
        bm.faces.new(list(reversed(rings[0]))).material_index = mat
    if cap1:
        bm.faces.new(rings[1]).material_index = mat


def finish(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


# ---------------------------------------------------------------- pole (片持式 F 形)
bm = bmesh.new()
tube(bm, "y", POLE_R, 0.0, POLE_H, segs=20, cap0=False, cap1=False)
# Domed cap.
top = POLE_H
ring = [
    bm.verts.new((POLE_R * math.cos(2 * math.pi * i / 20), top, POLE_R * math.sin(2 * math.pi * i / 20)))
    for i in range(20)
]
tip = bm.verts.new((0.0, top + 0.06, 0.0))
for i in range(20):
    bm.faces.new((ring[i], ring[(i + 1) % 20], tip))
# Base plate on its footing, with four anchor nuts under covers.
box(bm, 0.0, 0.015, 0.0, 0.62, 0.03, 0.62, mat=1)
for sx in (-1, 1):
    for sz in (-1, 1):
        tube(bm, "y", 0.035, 0.03, 0.11, segs=8, cap1=True, mat=1, centre=(sx * 0.23, 0.0, sz * 0.23))
# Ribs welded between the plate and the pipe.
for ang in range(0, 360, 90):
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    rx, rz = (POLE_R + 0.06) * c, (POLE_R + 0.06) * s
    is_along_x = abs(s) < 0.5
    box(bm, rx, 0.17, rz, 0.12 if is_along_x else 0.012, 0.28, 0.012 if is_along_x else 0.12)
finish(bm)
new_object("GuidePole", bm, ["GuideSteel", "GuideBolt"], smooth=True, sharp_angle=50)

# ---------------------------------------------------------------- arm
bm = bmesh.new()
tube(bm, "x", ARM_R, 0.0, 1.0, segs=14, cap0=False, cap1=True)
finish(bm)
new_object("GuideArm", bm, ["GuideSteel"], smooth=True, sharp_angle=50)

# ---------------------------------------------------------------- flange (band around the pole)
bm = bmesh.new()
tube(bm, "y", POLE_R + 0.012, -0.11, 0.11, segs=20, cap0=True, cap1=True)
box(bm, POLE_R + 0.05, 0.0, 0.0, 0.08, 0.26, 0.24, mat=1)  # bolted plate the arm is welded to
finish(bm)
new_object("GuideFlange", bm, ["GuideSteel", "GuideBolt"], smooth=True, sharp_angle=50)

# ---------------------------------------------------------------- board (unit 1 × 1 m)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
corners = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
front = [bm.verts.new((x, y, 0.0)) for x, y in corners]
back = [bm.verts.new((x, y, -BOARD_T)) for x, y in corners]
face = bm.faces.new(front)
face.material_index = 0
for loop in face.loops:
    # Blender UVs run up the image (the glTF exporter flips v): the board's top edge is v = 1.
    loop[uvl].uv = (loop.vert.co.x + 0.5, loop.vert.co.y + 0.5)
for i in range(4):
    j = (i + 1) % 4
    bm.faces.new((front[j], front[i], back[i], back[j])).material_index = 1
bm.faces.new(list(reversed(back))).material_index = 1
# Two vertical channel rails, a quarter of the width in from each edge, that the arms clamp to.
for x in (-0.25, 0.25):
    box(bm, x, 0.0, -BOARD_T - RAIL_D / 2, RAIL_W, 0.96, RAIL_D, mat=1)
finish(bm)
if face.normal.z < 0:
    for f in bm.faces:
        f.normal_flip()
new_object("GuideBoard", bm, ["GuideFace", "GuideBack"])

# ---------------------------------------------------------------- post (路側式)
bm = bmesh.new()
tube(bm, "y", POST_R, 0.0, 1.0, segs=12, cap0=False, cap1=True)
finish(bm)
new_object("GuidePost", bm, ["GuideSteel"], smooth=True, sharp_angle=60)

# The game reads the dimensions it lays the parts out with from the root's extras.
root = bpy.data.objects.new("GuideSigns", None)
SCENE.collection.objects.link(root)
for ob in list(SCENE.objects):
    if ob is not root:
        ob.parent = root
root["poleHeight"] = POLE_H
root["poleRadius"] = POLE_R
root["armRadius"] = ARM_R
root["postRadius"] = POST_R
root["railOffset"] = BOARD_T + RAIL_D

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
    export_cameras=False,
    export_lights=False,
)
tris = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in SCENE.objects if ob.type == "MESH"}
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)

    # One F-pole as the game assembles it: board 2.8 × 2.2 m, bottom at 5.0 m, 0.6 m from the pole.
    def place(name, loc, scale=(1, 1, 1)):
        ob = bpy.data.objects[name].copy()
        ob.parent = None
        SCENE.collection.objects.link(ob)
        ob.location = loc
        ob.scale = scale
        return ob

    w, h, bottom = 2.8, 2.2, 5.0
    place("GuidePole", (0.0, 0.0, 0.0))
    cx = POLE_R + 0.6 + w / 2
    z = -(POLE_R + 0.02)
    for y in (bottom + h * 0.25, bottom + h * 0.75):
        place("GuideArm", (0.0, y, z - ARM_R), (cx + w / 2 - 0.2, 1, 1))
        place("GuideFlange", (0.0, y, 0.0))
    place("GuideBoard", (cx, bottom + h / 2, z + BOARD_T + RAIL_D), (w, h, 1))
    for x in (-0.3, 0.3):
        place("GuidePost", (6.0 + x, 0.0, 0.0), (1, 3.4, 1))
    place("GuideBoard", (6.0, 2.5 + 0.75, 0.06), (1.9, 1.5, 1))
    for ob in list(SCENE.objects):
        if ob.parent is root:
            ob.hide_render = True
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(-55), math.radians(25), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 32
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    views = {"front": ((2.5, 3.0, 16.0), (2.5, 3.6, 0.0)), "back": ((-3.0, 4.0, -9.0), (1.5, 4.5, 0.0))}
    for view, (eye, target) in views.items():
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"guide-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
