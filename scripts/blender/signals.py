# 信号機（車両用灯器・歩行者用灯器・信号柱）for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/signals.py -- public/models/signals.glb [preview-dir]
#
# Game coordinates (+Y up, lamp faces toward +Z), exported with export_yup=False. Parts:
# - One housing per head type in assets/signals/heads.json (written from src/signals/heads.ts by
#   `just make-signal-layout`): SignalHead (車両用 LED 薄型 3 灯横型 1.15 × 0.40 m, 300 mm lamps
#   0.37 m apart), SignalHeadVertical (3 灯縦型), SignalHeadRightArrow / SignalHeadArrows (横型 with
#   the arrow row under it), PedHead (歩行者用 2 灯縦型 0.36 × 0.72 m, 250 mm square lenses, upper =
#   止まれ). Each has a visor (庇) per lamp and a hanger on top (or a bracket behind for PedHead);
#   origin at the main housing's centre, front face z = 0. An empty `<node>_<lamp>` marks each lens
#   centre (tests/signalHeads.test.ts checks 施行令第3条 against them).
# - SignalLamp: one 300 mm lens disc (UV 0–1 over the disc) for the game to tint and light;
#   SignalArrowLamp: an arrow pointing up (直進) on the same UV square, turned for left/right;
#   PedLamp: one 250 mm square lens.
# - PushButtonBox (歩行者用押ボタン箱, assets/signals/heads.json `buttons`): the box banded to a
#   pole, its round button and the おまちください window; origin at the box's centre, face z = 0,
#   the band toward −Z. Empties PushButtonBox_button / PushButtonBox_wait mark the button and lamp.
#   PushButtonLamp: a 1 × 1 m window (UV 0–1) the game scales to the lamp's size and tints.
# - SignalPole: tapered steel pole of unit height (the game stretches it along Y);
#   SignalArm: overhang arm of unit length along +Y (the game turns +Y toward the head).
# Lens artwork comes from assets/signals/textures (agy); the game swaps textures and colours.
# With a preview dir, every head is also rendered lit, mounted as the game mounts it, from the
# front, 30° and 60° off its axis, and from a driver's seat 30 m away (<preview>/<id>-<view>.png).
import hashlib
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

# Head types, lamp positions and mounts come from src/signals (via scripts/signals.ts), the same
# definitions the game places lamps by. Why not constants here: the lamp spacing was once written
# both here and in the game, and two copies drift.
with open(os.path.join(ROOT, "assets", "signals", "heads.json"), "rb") as f:
    REG_BYTES = f.read()
REG = json.loads(REG_BYTES)
# Written into the glb's scene extras: tests/signalHeads.test.ts compares it with heads.json to
# catch a glb not rebuilt after the definitions changed.
REG_SHA256 = hashlib.sha256(REG_BYTES).hexdigest()


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
# 押ボタン箱: light grey body (as the common boxes), a dark face panel, a pale yellow button.
# Colours are assumed (no specification of them was read).
material("ButtonBody", 0xC9CCCF, metallic=0.1, roughness=0.6)
material("ButtonFace", 0x2A2D31, roughness=0.7)
material("ButtonKey", 0xF2E3A0, roughness=0.4)
material("WaitLens", 0xFFFFFF, roughness=0.3)


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


def lens_radius(head):
    return head["lens"]["sizeMm"] / 2000


def rounded_box(bm, box_, corner, depth, mat):
    outline = [(box_["x"] + x, box_["y"] + y) for x, y in rounded_rect(box_["wM"], box_["hM"], corner)]
    prism(bm, outline, -depth, 0.0, mat)


def build_head(head):
    """One housing node from its registry entry: boxes, a bezel and a visor per lens, the fitting."""
    bm = bmesh.new()
    hs = head["housing"]
    for box_ in head["housings"]:
        rounded_box(bm, box_, hs["cornerM"], hs["dM"], 0)
    r = lens_radius(head)
    bezel = head["lens"]["bezelM"]
    visor_def = head["visor"]
    # Top row first, left to right: the order the hand-written heads were built in, so the two
    # shown heads come out vertex for vertex as before.
    for p in sorted(head["layout"], key=lambda p: (-p["y"], p["x"])):
        x, y = p["x"], p["y"]
        if head["lens"]["shape"] == "round":
            disc(bm, x, y, 0.001, r + bezel, 1)
        else:
            s = r + bezel
            outline = [(x - s, y - s), (x + s, y - s), (x + s, y + s), (x - s, y + s)]
            bm.faces.new([bm.verts.new((xx, yy, 0.001)) for xx, yy in outline]).material_index = 1
        if visor_def:
            visor(bm, x, y, r + visor_def["gapM"], visor_def["depthM"], 1, sweep=visor_def["sweepDeg"])
    top = hs["hM"] / 2
    if head["fitting"] == "hanger":
        # A short pipe up to the arm, with a clamp plate.
        tube(bm, (0.0, top, -hs["dM"] / 2), (0.0, top + REG["hangerM"], -hs["dM"] / 2), 0.03, 0)
        box(bm, 0.0, top + 0.02, -hs["dM"] / 2, 0.22, 0.04, 0.09, 0)
    else:
        # Bracket back to the pole (the game stands the head beside its pole).
        box(bm, 0.0, 0.0, -hs["dM"] - 0.09, 0.08, 0.30, 0.18, 0)
    # The arrow row hangs from the main housing on two straps behind it.
    for row in head["housings"][1:]:
        gap_top = -hs["hM"] / 2
        gap_bottom = row["y"] + row["hM"] / 2
        for side in (-1, 1):
            sx = row["x"] + side * (row["wM"] / 2 - 0.06)
            box(bm, sx, (gap_top + gap_bottom) / 2, -hs["dM"] / 2, 0.05, gap_top - gap_bottom + 0.06, 0.06, 0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(head["node"], bm, ["SignalBody", "SignalInner"])
    # Each lens centre as an empty under the housing (`<node>_<lamp>`): tests/signalHeads.test.ts
    # reads them from the glb to check 施行令第3条 on the model itself. Why not a "." or ":" in the
    # name: GLTFLoader strips those from node names.
    for p in head["layout"]:
        e = bpy.data.objects.new(f"{head['node']}_{p['lamp']}", None)
        e.location = (p["x"], p["y"], 0.0)
        e.parent = ob
        SCENE.collection.objects.link(e)
    return ob


def lens_object(name, outline, size, mat):
    """A flat lens at z = 0 whose UV 0–1 covers a size × size square round its centre."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    f = bm.faces.new([bm.verts.new((x, y, 0.0)) for x, y in outline])
    for loop in f.loops:
        loop[uvl].uv = (0.5 + loop.vert.co.x / size, 0.5 + loop.vert.co.y / size)
    return new_object(name, bm, [mat])


# ---------------------------------------------------------------- 灯器（assets/signals/heads.json）
HEADS = {h["id"]: h for h in REG["heads"]}
for h in REG["heads"]:
    build_head(h)

LAMP_R = lens_radius(HEADS["vehicle-h3"])
segs = 32
lens_object(
    "SignalLamp",
    [(LAMP_R * math.cos(2 * math.pi * i / segs), LAMP_R * math.sin(2 * math.pi * i / segs)) for i in range(segs)],
    2 * LAMP_R,
    "Lens",
)

PED_LAMP = HEADS["ped-v2"]["lens"]["sizeMm"] / 1000
h = PED_LAMP / 2
lens_object("PedLamp", ((-h, -h), (h, -h), (h, h), (-h, h)), PED_LAMP, "PedLens")


def arrow_outline(r):
    """An arrow pointing up (+Y, 直進) inside a lens of radius r; the game turns it for left/right."""
    shaft, head_w, tip, neck, tail = 0.26 * r, 0.78 * r, 0.74 * r, 0.12 * r, -0.70 * r
    return [
        (-shaft / 2, tail),
        (shaft / 2, tail),
        (shaft / 2, neck),
        (head_w / 2, neck),
        (0.0, tip),
        (-head_w / 2, neck),
        (-shaft / 2, neck),
    ]


# Concave outline: one n-gon renders, but triangulate so every importer agrees on the fill.
arrow = lens_object("SignalArrowLamp", arrow_outline(LAMP_R), 2 * LAMP_R, "Lens")
bm = bmesh.new()
bm.from_mesh(arrow.data)
bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="EAR_CLIP")
bm.to_mesh(arrow.data)
bm.free()


# ---------------------------------------------------------------- 押ボタン箱（heads.json の buttons）
def build_button_box(b):
    """The box: a rounded body, a dark face panel, the round button, the lamp's bezel, the band."""
    bm = bmesh.new()
    hs = b["housing"]
    prism(bm, rounded_rect(hs["wM"], hs["hM"], hs["cornerM"]), -hs["dM"], 0.0, 0)
    inset = 0.012
    face = [(x, y) for x, y in rounded_rect(hs["wM"] - 2 * inset, hs["hM"] - 2 * inset, hs["cornerM"] / 2)]
    bm.faces.new([bm.verts.new((x, y, 0.001)) for x, y in face]).material_index = 1
    r = b["button"]["diameterM"] / 2
    # The button stands 8 mm proud of the face (a short cylinder, capped).
    tube(bm, (0.0, b["button"]["y"], 0.0), (0.0, b["button"]["y"], 0.008), r, 2, segments=20)
    lw, lh, ly = b["waitLamp"]["wM"], b["waitLamp"]["hM"], b["waitLamp"]["y"]
    bezel = [
        (-lw / 2 - 0.006, ly - lh / 2 - 0.006),
        (lw / 2 + 0.006, ly - lh / 2 - 0.006),
        (lw / 2 + 0.006, ly + lh / 2 + 0.006),
        (-lw / 2 - 0.006, ly + lh / 2 + 0.006),
    ]
    bm.faces.new([bm.verts.new((x, y, 0.002)) for x, y in bezel]).material_index = 1
    # The band round the pole (電柱抱込式) behind the box, reaching back to the pole's axis.
    reach = b["offsetM"] - hs["dM"]
    box(bm, 0.0, 0.0, -hs["dM"] - reach / 2, hs["wM"] * 0.5, 0.03, reach, 0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(b["node"], bm, ["ButtonBody", "ButtonFace", "ButtonKey"])
    for name, y, z in (("button", b["button"]["y"], 0.008), ("wait", ly, 0.0)):
        e = bpy.data.objects.new(f"{b['node']}_{name}", None)
        e.location = (0.0, y, z)
        e.parent = ob
        SCENE.collection.objects.link(e)
    return ob


BUTTONS = REG.get("buttons", [])
for b in BUTTONS:
    build_button_box(b)
lens_object("PushButtonLamp", ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)), 1.0, "WaitLens")

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
SCENE["signalHeadsSha256"] = REG_SHA256
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=False,
    export_apply=True,
    export_draco_mesh_compression_enable=True,
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
    export_extras=True,
)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SCENE.objects if o.type == "MESH"}
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris)

# ---------------------------------------------------------------- 多視点レビュー
# The game's lit colours (LAMP_COLOURS in src/signals/heads.ts), so the review shows its hues.
LIT = {
    use: {name: lin(hex_color)[:3] for name, hex_color in colours.items()}
    for use, colours in REG["lampColours"].items()
    if use != "off"
}


def lit_material(name, rgb, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    # Black base: the game draws lit lenses unlit, so neither the sun nor a visor's shadow shows
    # on them; only the emission does.
    b.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1)
    b.inputs["Emission Color"].default_value = (*rgb, 1)
    # 1.0: any stronger clips the green channel and 青 (0x19e6b4) reads as cyan.
    b.inputs["Emission Strength"].default_value = 1.0
    if image and os.path.exists(image):
        # The pictogram mask (white figure on a dark plate) times the lamp colour, as in the game.
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        mix = m.node_tree.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["B"].default_value = (*rgb, 1)
        m.node_tree.links.new(tex.outputs["Color"], mix.inputs["A"])
        m.node_tree.links.new(mix.outputs["Result"], b.inputs["Emission Color"])
    return m


def lamp_colour(lamp):
    return "green" if lamp.startswith("arrow-") else lamp


def place(src, name, matrix, mat):
    ob = bpy.data.objects.new(name, src.data.copy())
    ob.data.materials[0] = mat
    ob.matrix_world = matrix
    SCENE.collection.objects.link(ob)
    return ob


def assemble(head):
    """The head as the game mounts it, every lens lit in its own colour; returns the head's centre."""
    objs = {o.name: o for o in SCENE.objects}
    is_vehicle = head["use"] == "vehicle"
    mount = REG["mounts"][head["mount"]]
    scale = mount["drawScale"]
    centre = Vector((0.0, mount["centreHeightM"], 0.0))
    housing = objs[head["node"]]
    housing.hide_render = False
    housing.matrix_world = Matrix.Translation(centre) @ Matrix.Scale(scale, 4)
    shown = [housing]
    for p in head["layout"]:
        colour = lamp_colour(p["lamp"])
        if p["lamp"].startswith("arrow-"):
            src, image = objs["SignalArrowLamp"], None
        elif is_vehicle:
            src, image = objs["SignalLamp"], None
        else:
            src = objs["PedLamp"]
            image = os.path.join(TEX, "ped_stop.png" if p["lamp"] == "red" else "ped_go.png")
        local = Matrix.Translation((p["x"], p["y"], REG["lensZM"])) @ Matrix.Rotation(p["turn"], 4, "Z")
        mat = lit_material(f"Lit-{head['id']}-{p['lamp']}", LIT[head["use"]][colour], image)
        shown.append(place(src, f"Review-{p['lamp']}", housing.matrix_world @ local, mat))
    if is_vehicle:
        # Arm from a pole on the driver's left (−X) to the hanger's top.
        arm_y = centre.y + head["hangM"] * scale
        pole = place(
            objs["SignalPole"],
            "Review-pole",
            Matrix.Translation((-3.4, 0, -0.07)) @ Matrix.Diagonal((1, arm_y + 0.25, 1, 1)),
            MAT["Pole"],
        )
        arm = place(
            objs["SignalArm"],
            "Review-arm",
            Matrix.Translation((-3.4, arm_y, -0.07))
            @ Matrix.Rotation(math.radians(-90), 4, "Z")
            @ Matrix.Diagonal((1, 3.4, 1, 1)),
            MAT["Pole"],
        )
        shown += [pole, arm]
    else:
        pole = place(
            objs["SignalPole"],
            "Review-pole",
            Matrix.Translation((0, 0, -mount["offsetM"])) @ Matrix.Diagonal((1, mount["centreHeightM"] + 0.55, 1, 1)),
            MAT["Pole"],
        )
        shown.append(pole)
    return centre, shown


def look(cam, eye, target):
    cam.location = eye
    fwd = (Vector(target) - Vector(eye)).normalized()
    right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
    up = right.cross(fwd)
    cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()


if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    for o in SCENE.objects:
        o.hide_render = True
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.65, 0.78, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(-55), math.radians(30), 0)
    SCENE.collection.objects.link(sun)
    ground = bpy.data.objects.new("Ground", bpy.data.meshes.new("Ground"))
    gbm = bmesh.new()
    gbm.faces.new([gbm.verts.new((x, 0.0, z)) for x, z in ((-80, 80), (80, 80), (80, -80), (-80, -80))])
    gbm.to_mesh(ground.data)
    gbm.free()
    ground.data.materials.append(material("Asphalt", 0x55585C, roughness=0.9))
    SCENE.collection.objects.link(ground)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 50
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 32
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    # Standard, not the default AgX: AgX desaturates bright emission toward white, and the review
    # has to tell 赤・黄・青 apart.
    SCENE.view_settings.view_transform = "Standard"
    for head in REG["heads"]:
        centre, shown = assemble(head)
        scale = REG["mounts"][head["mount"]]["drawScale"]
        top = max(b["y"] + b["hM"] / 2 for b in head["housings"])
        bottom = min(b["y"] - b["hM"] / 2 for b in head["housings"])
        width = max(b["wM"] for b in head["housings"])
        # Fit the housing (and the hanger above it) with a margin: 50 mm lens, 16:9.
        near = max(1.95 * width * scale, 3.5 * ((top - bottom) * scale + 0.4))
        focus = centre + Vector((0.0, (top + bottom) / 2 * scale, 0.0))
        views = {}
        for deg in (0, 30, 60):
            a = math.radians(deg)
            views[f"oblique{deg:02d}" if deg else "front"] = (
                (focus.x + near * math.sin(a), focus.y, focus.z + near * math.cos(a)),
                focus,
            )
        # A driver 30 m short of the head, eyes 1.2 m up, sitting 1.5 m right of the head's line.
        views["driver30m"] = ((1.5, 1.2, 30.0), focus)
        for view, (eye, target) in views.items():
            look(cam, eye, target)
            SCENE.render.filepath = os.path.join(PREVIEW, f"{head['id']}-{view}.png")
            bpy.ops.render.render(write_still=True)
            log("preview", head=head["id"], view=view)
        for o in shown:
            o.hide_render = True
    # 押ボタン箱 on its pole, under the pedestrian head as on a 単路 crossing, its lamp lit; views
    # as for the heads, plus a walker's eye 1.5 m in front of it.
    objs = {o.name: o for o in SCENE.objects}
    ped = HEADS["ped-v2"]
    ped_mount = REG["mounts"][ped["mount"]]
    for b in BUTTONS:
        centre, shown = assemble(ped)
        box_obj = objs[b["node"]]
        box_obj.hide_render = False
        box_centre = Vector((0.0, b["bottomM"] + b["housing"]["hM"] / 2, -ped_mount["offsetM"] + b["offsetM"]))
        box_obj.matrix_world = Matrix.Translation(box_centre)
        lw, lh, ly = b["waitLamp"]["wM"], b["waitLamp"]["hM"], b["waitLamp"]["y"]
        lamp = place(
            objs["PushButtonLamp"],
            "Review-wait",
            Matrix.Translation(box_centre + Vector((0.0, ly, REG["lensZM"]))) @ Matrix.Diagonal((lw, lh, 1, 1)),
            lit_material("Lit-wait", lin(b["waitColour"])[:3]),
        )
        shown += [box_obj, lamp]
        focus = box_centre
        views = {}
        for deg in (0, 30, 60):
            a = math.radians(deg)
            views[f"oblique{deg:02d}" if deg else "front"] = (
                (focus.x + 0.9 * math.sin(a), focus.y + 0.1, focus.z + 0.9 * math.cos(a)),
                focus,
            )
        views["walker"] = ((0.3, 1.6, focus.z + 1.5), focus)
        views["pole"] = ((1.2, 1.5, 4.5), Vector((0.0, 1.8, 0.0)))
        views["driver30m"] = ((3.0, 1.2, 30.0), Vector((0.0, 1.8, 0.0)))
        for view, (eye, target) in views.items():
            look(cam, eye, target)
            SCENE.render.filepath = os.path.join(PREVIEW, f"{b['id']}-{view}.png")
            bpy.ops.render.render(write_still=True)
            log("preview", head=b["id"], view=view)
        for o in shown:
            o.hide_render = True
