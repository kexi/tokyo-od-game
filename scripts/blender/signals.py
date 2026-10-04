# 信号機（車両用灯器・歩行者用灯器・信号柱）for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/signals.py -- public/models/signals.glb [preview-dir]
#
# Game coordinates (+Y up, lamp faces toward +Z), exported with export_yup=False. Parts:
# - SignalHead: 車両用 LED 薄型 3 灯横型 housing (1.15 × 0.40 m, 300 mm lamps 0.37 m apart) with
#   a visor (庇) over each lamp and a hanger on top; origin at the housing centre, front face z = 0.
# - SignalLamp: one 300 mm lens disc (UV 0–1 over the disc) for the game to tint and light.
# - PedHead: 歩行者用 2 灯縦型 housing (0.36 × 0.72 m) with a bracket behind; PedLamp: one 250 mm
#   square lens. Upper lamp = 止まれ, lower = 進め.
# - SignalPole: tapered steel pole of unit height (the game stretches it along Y);
#   SignalArm: overhang arm of unit length along +Y (the game turns +Y toward the head).
# Lens artwork comes from assets/signals/textures (agy); the game swaps textures and colours.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "signals.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "signals", "textures")

LAMP_R = 0.15  # 300 mm lens
LAMP_GAP = 0.37  # centre to centre
HEAD_W, HEAD_H, HEAD_D = 1.15, 0.40, 0.11
PED_W, PED_H, PED_D = 0.36, 0.72, 0.10
PED_LAMP = 0.25
PED_Y = 0.175  # lamp centres at ±PED_Y


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


def material(name, color, metallic=0.0, roughness=0.5, image=None, emission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if image and os.path.exists(image):
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        if emission:
            m.node_tree.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = emission
    MAT[name] = m
    return m


material("SignalBody", 0xB4B8BC, metallic=0.3, roughness=0.55)  # ねずみ色 painted aluminium
material("SignalInner", 0x15181B, roughness=0.8)  # visor insides and lamp bezels
# The game lights the lenses with its own materials (assets/signals/textures), so the export
# carries no images for them.
material("Lens", 0xFFFFFF, roughness=0.3)
material("PedLens", 0xFFFFFF, roughness=0.3)
material("Pole", 0xA9AEB3, metallic=0.6, roughness=0.45)


def new_object(name, bm, mats, smooth=False, sharp_angle=35):
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


def rounded_rect(w, h, r, steps=5):
    """Counter-clockwise outline of a w × h rectangle with corner radius r (x right, y up)."""
    out = []
    for cx, cy, a0 in ((w / 2 - r, -h / 2 + r, -90), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90)):
        for k in range(steps + 1):
            a = math.radians(a0 + 90 * k / steps)
            out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    cx, cy = -w / 2 + r, -h / 2 + r
    for k in range(steps + 1):
        a = math.radians(180 + 90 * k / steps)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def prism(bm, outline, z0, z1, mat):
    """Extrude a counter-clockwise outline (x, y) from z0 (back) to z1 (front)."""
    back = [bm.verts.new((x, y, z0)) for x, y in outline]
    front = [bm.verts.new((x, y, z1)) for x, y in outline]
    bm.faces.new(front).material_index = mat
    bm.faces.new(list(reversed(back))).material_index = mat
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((back[i], back[j], front[j], front[i])).material_index = mat


def disc(bm, cx, cy, z, r, mat, segments=28):
    vs = [
        bm.verts.new((cx + r * math.cos(2 * math.pi * i / segments), cy + r * math.sin(2 * math.pi * i / segments), z))
        for i in range(segments)
    ]
    bm.faces.new(vs).material_index = mat


def visor(bm, cx, cy, r, depth, mat, sweep=200, segments=14):
    """Hood over a lamp: a thin curved sheet round the top, open below, sticking out toward +Z."""
    a0 = math.radians(90 - sweep / 2)
    a1 = math.radians(90 + sweep / 2)
    rings = []
    for z, rr in ((0.0, r), (depth, r * 1.08)):
        ring = []
        for k in range(segments + 1):
            a = a0 + (a1 - a0) * k / segments
            ring.append(bm.verts.new((cx + rr * math.cos(a), cy + rr * math.sin(a), z)))
        rings.append(ring)
    for k in range(segments):
        bm.faces.new((rings[0][k], rings[0][k + 1], rings[1][k + 1], rings[1][k])).material_index = mat


def box(bm, cx, cy, cz, sx, sy, sz, mat):
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


def tube(bm, p0, p1, r, mat, segments=12, cap=True):
    """Cylinder between two points."""
    axis = (Vector(p1) - Vector(p0)).normalized()
    side = axis.orthogonal().normalized()
    other = axis.cross(side)
    rings = []
    for p in (p0, p1):
        rings.append(
            [
                bm.verts.new(
                    Vector(p)
                    + (side * math.cos(2 * math.pi * k / segments) + other * math.sin(2 * math.pi * k / segments)) * r
                )
                for k in range(segments)
            ]
        )
    for k in range(segments):
        j = (k + 1) % segments
        bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k])).material_index = mat
    if cap:
        bm.faces.new(list(reversed(rings[0]))).material_index = mat
        bm.faces.new(rings[1]).material_index = mat


# ---------------------------------------------------------------- 車両用灯器
bm = bmesh.new()
prism(bm, rounded_rect(HEAD_W, HEAD_H, 0.07), -HEAD_D, 0.0, 0)
for k in (-1, 0, 1):
    x = k * LAMP_GAP
    disc(bm, x, 0.0, 0.001, LAMP_R + 0.018, 1)  # black bezel round the lens
    visor(bm, x, 0.0, LAMP_R + 0.02, 0.14, 1)
# Hanger: a short pipe up to the arm, with a clamp plate.
tube(bm, (0.0, HEAD_H / 2, -HEAD_D / 2), (0.0, HEAD_H / 2 + 0.28, -HEAD_D / 2), 0.03, 0)
box(bm, 0.0, HEAD_H / 2 + 0.02, -HEAD_D / 2, 0.22, 0.04, 0.09, 0)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
new_object("SignalHead", bm, ["SignalBody", "SignalInner"])

bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
segs = 32
vs = [
    bm.verts.new((LAMP_R * math.cos(2 * math.pi * i / segs), LAMP_R * math.sin(2 * math.pi * i / segs), 0.0))
    for i in range(segs)
]
f = bm.faces.new(vs)
for loop in f.loops:
    loop[uvl].uv = (0.5 + loop.vert.co.x / (2 * LAMP_R), 0.5 + loop.vert.co.y / (2 * LAMP_R))
new_object("SignalLamp", bm, ["Lens"])

# ---------------------------------------------------------------- 歩行者用灯器
bm = bmesh.new()
prism(bm, rounded_rect(PED_W, PED_H, 0.05), -PED_D, 0.0, 0)
for y in (PED_Y, -PED_Y):
    s = PED_LAMP / 2 + 0.015
    outline = [(-s, y - s), (s, y - s), (s, y + s), (-s, y + s)]
    bm.faces.new([bm.verts.new((x, yy, 0.001)) for x, yy in outline]).material_index = 1
    visor(bm, 0.0, y, PED_LAMP / 2 + 0.03, 0.10, 1, sweep=160)
# Bracket back to the pole (the game stands the head beside its pole, facing across the road).
box(bm, 0.0, 0.0, -PED_D - 0.09, 0.08, 0.30, 0.18, 0)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
new_object("PedHead", bm, ["SignalBody", "SignalInner"])

bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
h = PED_LAMP / 2
f = bm.faces.new([bm.verts.new((x, y, 0.0)) for x, y in ((-h, -h), (h, -h), (h, h), (-h, h))])
for loop in f.loops:
    loop[uvl].uv = (0.5 + loop.vert.co.x / PED_LAMP, 0.5 + loop.vert.co.y / PED_LAMP)
new_object("PedLamp", bm, ["PedLens"])

# ---------------------------------------------------------------- 信号柱・アーム
bm = bmesh.new()
segs = 16
bottom = [
    bm.verts.new((0.135 * math.cos(2 * math.pi * i / segs), 0.0, 0.135 * math.sin(2 * math.pi * i / segs)))
    for i in range(segs)
]
top = [
    bm.verts.new((0.10 * math.cos(2 * math.pi * i / segs), 1.0, 0.10 * math.sin(2 * math.pi * i / segs)))
    for i in range(segs)
]
for i in range(segs):
    j = (i + 1) % segs
    bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
bm.faces.new(top)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
new_object("SignalPole", bm, ["Pole"], smooth=True, sharp_angle=60)

bm = bmesh.new()
tube(bm, (0.0, 0.0, 0.0), (0.0, 1.0, 0.0), 0.075, 0, segments=12)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
new_object("SignalArm", bm, ["Pole"], smooth=True, sharp_angle=60)

for ob in list(SCENE.objects):
    ob.select_set(False)
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
    # Assemble one corner: pole, arm, vehicle head with lit red lamp, pedestrian head with lit go lamp.
    objs = {o.name: o for o in SCENE.objects}
    pole = objs["SignalPole"]
    pole.scale = (1, 5.6, 1)
    arm = objs["SignalArm"]
    arm.location = (0.0, 5.45, 0.0)
    arm.rotation_euler = (0, 0, math.radians(-90))  # +Y → +X
    arm.scale = (1, 3.2, 1)
    head = objs["SignalHead"]
    head.location = (2.6, 5.45 - 0.48, 0.07)
    lamps = []
    for k in (-1, 0, 1):
        c = objs["SignalLamp"].copy()
        c.data = objs["SignalLamp"].data
        SCENE.collection.objects.link(c)
        c.location = (2.6 + k * LAMP_GAP, 5.45 - 0.48, 0.072)
        lamps.append(c)
    objs["SignalLamp"].hide_render = True
    red = bpy.data.materials.new("LitRed")
    red.use_nodes = True
    rb = red.node_tree.nodes["Principled BSDF"]
    rb.inputs["Base Color"].default_value = (1.0, 0.05, 0.02, 1)
    rb.inputs["Emission Color"].default_value = (1.0, 0.05, 0.02, 1)
    rb.inputs["Emission Strength"].default_value = 6.0
    lamps[2].data = lamps[2].data.copy()
    lamps[2].data.materials[0] = red
    ped = objs["PedHead"]
    ped.location = (0.0, 2.75, 0.32)
    for y, name in ((PED_Y, "stop"), (-PED_Y, "go")):
        c = objs["PedLamp"].copy()
        c.data = objs["PedLamp"].data.copy()
        SCENE.collection.objects.link(c)
        c.location = (0.0, 2.75 + y, 0.322)
        if name == "go":
            green = bpy.data.materials.new("LitGreen")
            green.use_nodes = True
            gb = green.node_tree.nodes["Principled BSDF"]
            tex = green.node_tree.nodes.new("ShaderNodeTexImage")
            path = os.path.join(TEX, "ped_go.png")
            if os.path.exists(path):
                tex.image = bpy.data.images.load(path)
                green.node_tree.links.new(tex.outputs["Color"], gb.inputs["Emission Color"])
            gb.inputs["Base Color"].default_value = (0.05, 0.9, 0.6, 1)
            gb.inputs["Emission Strength"].default_value = 4.0
            c.data.materials[0] = green
    objs["PedLamp"].hide_render = True

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.65, 0.78, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(-55), math.radians(30), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 50
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 32
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    for view, (eye, target) in {
        "corner": ((5.5, 3.2, 9.0), (1.4, 3.8, 0.0)),
        "head": ((3.4, 5.0, 2.4), (2.6, 4.97, 0.0)),
    }.items():
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"signals-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
