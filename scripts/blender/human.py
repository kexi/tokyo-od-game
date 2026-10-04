# Low-poly pedestrian (~1.7 m, ~1,000 triangles) for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/human.py -- public/models/human.glb [preview-dir]
#
# Game coordinates (+Y up, facing +Z, feet at y = 0, the person's right = −X), exported with
# export_yup=False. Parts are separate objects so the game can pose them: UpperArmL/R pivot at the
# shoulder, ForearmL/R at the elbow, ThighL/R at the hip and ShinL/R at the knee (rotation about X
# bends each joint). Textures come from
# assets/human/textures (white-based greyscale: the game tints Skin/Shirt/Pants/Hair per person).
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "human.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "human", "textures")

SHOULDER = (0.235, 1.40)  # x, y of the arm pivots
HIP = (0.095, 0.86)  # x, y of the leg pivots
HEAD_C = 1.665
HEAD_R = (0.105, 0.125, 0.115)  # radii x, y, z


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene
MAT = {}


def material(name, image, roughness=0.8, double_sided=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = roughness
    path = os.path.join(TEX, image)
    if os.path.exists(path):
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(path)
        m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    else:
        log("texture_missing", file=image)
    MAT[name] = m


material("Skin", "face.png", roughness=0.6)
material("Shirt", "shirt.png")
material("Pants", "pants.png")
material("Shoes", "shoes.png", roughness=0.7)
material("Hair", "hair.png", roughness=0.5, double_sided=True)


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


def loft(bm, uvl, rings, segs, mat, uv_of, cap_bottom=True, cap_top=True):
    """Closed loft through horizontal rings [(y, rx, rz, cx, cz)]; uv_of(theta, ring_index) per corner."""
    grid = []
    for y, rx, rz, cx, cz in rings:
        row = []
        for i in range(segs):
            th = 2 * math.pi * i / segs  # 0 = front (+Z), +π/2 = +X
            row.append(bm.verts.new((cx + rx * math.sin(th), y, cz + rz * math.cos(th))))
        grid.append(row)
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new((grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]))
            f.material_index = mat
            for loop, (col, row) in zip(f.loops, [(i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1)], strict=True):
                loop[uvl].uv = uv_of(2 * math.pi * col / segs, row)
    for row, cap in ((grid[0], cap_bottom), (grid[-1], cap_top)):
        if not cap:
            continue
        f = bm.faces.new(row if row is grid[-1] else list(reversed(row)))
        f.material_index = mat
        for loop in f.loops:
            loop[uvl].uv = uv_of(0.0, 0 if row is grid[0] else len(rings) - 1)
    return grid


def ellipsoid(bm, uvl, centre, radii, segs, rows, mat, uv_of):
    """UV sphere; uv_of(vertex_local, face_centre_local) per corner (positions, not normals:
    face winding is only made consistent afterwards)."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    top = bm.verts.new((cx, cy + ry, cz))
    bottom = bm.verts.new((cx, cy - ry, cz))
    grid = []
    for r in range(1, rows):
        phi = math.pi * r / rows
        grid.append(
            [
                bm.verts.new(
                    (
                        cx + rx * math.sin(phi) * math.sin(2 * math.pi * i / segs),
                        cy + ry * math.cos(phi),
                        cz + rz * math.sin(phi) * math.cos(2 * math.pi * i / segs),
                    )
                )
                for i in range(segs)
            ]
        )
    faces = []
    for i in range(segs):
        j = (i + 1) % segs
        faces.append(bm.faces.new((top, grid[0][j], grid[0][i])))
        faces.append(bm.faces.new((bottom, grid[-1][i], grid[-1][j])))
        for k in range(len(grid) - 1):
            faces.append(bm.faces.new((grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i])))
    for f in faces:
        f.material_index = mat
        mid = f.calc_center_median() - Vector(centre)
        for loop in f.loops:
            loop[uvl].uv = uv_of(loop.vert.co - Vector(centre), mid)
    return faces


SKIN_UV = (0.5, 0.92)  # forehead of face.png: plain skin for hands and the back of the head

# ---------------------------------------------------------------- torso (shirt)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
# (y, half-width, half-depth, centre x, centre z): hips → waist → chest → shoulders → neck.
TORSO = [
    (0.84, 0.165, 0.105, 0, 0.0),
    (0.96, 0.160, 0.100, 0, 0.0),
    (1.06, 0.150, 0.095, 0, 0.005),
    (1.18, 0.168, 0.108, 0, 0.012),
    (1.30, 0.188, 0.112, 0, 0.010),
    (1.40, 0.200, 0.098, 0, 0.0),
    (1.47, 0.110, 0.075, 0, 0.0),
]
t_lo, t_hi = TORSO[0][0], TORSO[-1][0]


def torso_uv(theta, row):
    # shirt.png: front on the left half (centre u = 0.25), back on the right; the seam is at the
    # person's right side. v: 1/8 (hem) → 1 (collar); the bottom 1/8 is kept for the sleeves.
    th = theta if theta <= 1.5 * math.pi else theta - 2 * math.pi
    u = 0.25 + th / (2 * math.pi)
    v = 0.125 + 0.875 * (TORSO[row][0] - t_lo) / (t_hi - t_lo)
    return (u % 1.0 if u != 1.0 else 1.0, v)


loft(bm, uvl, TORSO, 16, 0, torso_uv)
# Neck (skin) rising out of the collar into the head.
NECK = [(1.44, 0.050, 0.047, 0, 0.0), (1.60, 0.046, 0.044, 0, 0.0)]
loft(bm, uvl, NECK, 10, 1, lambda theta, row: SKIN_UV, cap_bottom=False, cap_top=False)
torso = new_object("Torso", bm, ["Shirt", "Skin"])

# ---------------------------------------------------------------- head (skin, face texture)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")


def head_uv(local, mid):
    # face.png is the front of the head projected straight on; the back gets plain forehead skin.
    if mid.z < -0.01:
        return SKIN_UV
    return (0.5 + 0.5 * local.x / HEAD_R[0], 0.5 + 0.5 * local.y / HEAD_R[1])


ellipsoid(bm, uvl, (0.0, HEAD_C, 0.0), HEAD_R, 16, 10, 0, head_uv)
# Nose: a small wedge (skin).
nose = [
    bm.verts.new(p)
    for p in [
        (-0.011, HEAD_C - 0.018, 0.108),
        (0.011, HEAD_C - 0.018, 0.108),
        (0.0, HEAD_C - 0.030, 0.121),
        (0.0, HEAD_C + 0.008, 0.113),
    ]
]
for tri in [(0, 1, 2), (1, 3, 2), (3, 0, 2)]:
    f = bm.faces.new([nose[i] for i in tri])
    for loop in f.loops:
        loop[uvl].uv = (0.5, 0.42)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
head = new_object("Head", bm, ["Skin"])

# ---------------------------------------------------------------- hair variants


def hair(name, coverage, swell=0.0, bun=False):
    """Cap over the skull; coverage(theta) = polar angle (from the crown) where the hair ends."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    segs, rows = 16, 7
    grid = []
    for r in range(rows + 1):
        t = r / rows
        row = []
        for i in range(segs):
            th = 2 * math.pi * i / segs
            phi = coverage(th) * t
            grow = 1.06 + swell * t * t
            row.append(
                bm.verts.new(
                    (
                        HEAD_R[0] * grow * math.sin(phi) * math.sin(th),
                        HEAD_C + HEAD_R[1] * 1.04 * math.cos(phi) - swell * 0.35 * t * t,
                        HEAD_R[2] * grow * math.sin(phi) * math.cos(th),
                    )
                )
            )
        grid.append(row)
    for k in range(rows):
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new((grid[k][i], grid[k + 1][i], grid[k + 1][j], grid[k][j]))
            for loop, (col, rr) in zip(f.loops, [(i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k)], strict=True):
                loop[uvl].uv = (2 * col / segs, 2 * rr / rows)
    if bun:

        def bun_uv(local, mid):
            return (0.5 + local.x * 4, 0.5 + local.y * 4)

        ellipsoid(bm, uvl, (0.0, HEAD_C + 0.07, -0.11), (0.055, 0.05, 0.05), 10, 6, 0, bun_uv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, ["Hair"])


def front_back(front, side, back):
    """Polar extent that eases from the forehead (front) round the ears (side) to the nape (back)."""

    def f(th):
        c = math.cos(th)  # 1 front, −1 back
        return (side + (front - side) * c) if c >= 0 else (side + (side - back) * c)

    return f


hair("HairShort", front_back(0.30 * math.pi, 0.50 * math.pi, 0.62 * math.pi))
hair("HairLong", front_back(0.30 * math.pi, 0.68 * math.pi, 0.86 * math.pi), swell=0.06)
hair("HairBun", front_back(0.28 * math.pi, 0.48 * math.pi, 0.58 * math.pi), bun=True)

# ---------------------------------------------------------------- arms (sleeve + hand)
# Each limb is two parts so the game can bend elbows and knees: the upper part's origin is the
# shoulder / hip, the lower part's origin is the elbow / knee. Both overlap a little at the joint
# and the lower part carries a rounded cap there, so a bent joint shows no gap.
ELBOW_DROP = 0.27  # shoulder → elbow
KNEE_DROP = 0.42  # hip → knee


def arm(side):
    suffix = "L" if side > 0 else "R"
    x0, y0 = side * SHOULDER[0], SHOULDER[1]
    ye = y0 - ELBOW_DROP
    top, wrist = y0 + 0.02, y0 - 0.52

    def sleeve_uv_at(y):
        # shirt.png's bottom band: plain fabric with the cuff at v = 0 (wrist); stop short of the
        # shirt hem stitched at v = 1/8 so it does not reappear at the shoulder.
        return 0.09 * (y - wrist) / (top - wrist)

    def ring_uv(rings):
        return lambda theta, row: (theta / (2 * math.pi), sleeve_uv_at(rings[row][0]))

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    upper = [(top, 0.052, 0.050, x0, 0.0), (ye + 0.02, 0.046, 0.045, x0, 0.0), (ye - 0.02, 0.043, 0.042, x0, 0.0)]
    loft(bm, uvl, upper, 8, 0, ring_uv(upper), cap_bottom=True, cap_top=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    new_object(f"UpperArm{suffix}", bm, ["Shirt"], origin=(x0, y0, 0.0))

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    fore = [(ye + 0.01, 0.044, 0.043, x0, 0.0), (wrist, 0.038, 0.037, x0, 0.0)]
    loft(bm, uvl, fore, 8, 0, ring_uv(fore), cap_bottom=True, cap_top=False)
    ellipsoid(bm, uvl, (x0, ye, 0.0), (0.045, 0.045, 0.044), 8, 4, 0, lambda local, mid: (0.5, sleeve_uv_at(ye)))
    ellipsoid(bm, uvl, (x0, y0 - 0.585, 0.0), (0.028, 0.06, 0.042), 8, 5, 1, lambda local, mid: SKIN_UV)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    new_object(f"Forearm{suffix}", bm, ["Shirt", "Skin"], origin=(x0, ye, 0.0))


arm(1)  # the person's left is +X
arm(-1)

# ---------------------------------------------------------------- legs (trousers + shoe)


def leg(side):
    suffix = "L" if side > 0 else "R"
    x0, y0 = side * HIP[0], HIP[1]
    yk = y0 - KNEE_DROP
    top, hem = y0 + 0.02, y0 - 0.78

    def pants_uv(rings):
        # pants.png wraps once round the leg; v = 0 hem → 1 waistband, continuous across the knee.
        return lambda theta, row: (theta / (2 * math.pi), (rings[row][0] - hem) / (top - hem))

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    thigh = [(top, 0.080, 0.085, x0, 0.0), (y0 - 0.30, 0.066, 0.068, x0, 0.005), (yk - 0.02, 0.056, 0.058, x0, 0.012)]
    loft(bm, uvl, thigh, 10, 0, pants_uv(thigh), cap_bottom=True, cap_top=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    new_object(f"Thigh{suffix}", bm, ["Pants"], origin=(x0, y0, 0.0))

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    shin = [(yk + 0.01, 0.057, 0.059, x0, 0.012), (y0 - 0.70, 0.050, 0.052, x0, 0.0), (hem, 0.052, 0.054, x0, 0.0)]
    loft(bm, uvl, shin, 10, 0, pants_uv(shin), cap_bottom=False, cap_top=False)
    v_knee = (yk - hem) / (top - hem)
    ellipsoid(bm, uvl, (x0, yk, 0.012), (0.058, 0.058, 0.06), 10, 4, 0, lambda local, mid: (0.5, v_knee))
    # Shoe: a rounded block under the trouser hem, longer toward the toes (+Z).
    shoe = [(0.0, 0.050, 0.060, x0, 0.02), (0.035, 0.052, 0.110, x0, 0.04), (0.075, 0.046, 0.090, x0, 0.02)]
    loft(bm, uvl, shoe, 10, 1, lambda theta, row: (theta / (2 * math.pi), row / (len(shoe) - 1)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    new_object(f"Shin{suffix}", bm, ["Pants", "Shoes"], origin=(x0, yk, 0.012))


leg(1)
leg(-1)

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
    tints = {
        "Skin": (0.93, 0.78, 0.66, 1),
        "Shirt": (0.25, 0.45, 0.80, 1),
        "Pants": (0.12, 0.13, 0.18, 1),
        "Hair": (0.10, 0.07, 0.05, 1),
    }
    for name, rgba in tints.items():
        nodes = MAT[name].node_tree.nodes
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 1.0
        mix.inputs["Color2"].default_value = rgba
        tex = nodes.get("Image Texture")
        if tex:
            MAT[name].node_tree.links.new(tex.outputs["Color"], mix.inputs["Color1"])
            MAT[name].node_tree.links.new(mix.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    for ob in SCENE.objects:
        if ob.name in ("HairLong", "HairBun"):
            ob.hide_render = True
    # A second figure with long hair, mid-stride.
    pose = {
        "ThighL": 0.40,
        "ShinL": 0.15,
        "ThighR": -0.45,
        "ShinR": 0.9,
        "UpperArmL": -0.35,
        "ForearmL": -0.5,
        "UpperArmR": 0.35,
        "ForearmR": -0.2,
    }
    copies = {}
    for src in ["Torso", "Head", "HairLong", *pose]:
        c = bpy.data.objects[src].copy()
        SCENE.collection.objects.link(c)
        c.hide_render = False
        c.location.x += 0.8
        copies[src] = c
    bpy.context.view_layer.update()
    for lower, upper in (
        ("ShinL", "ThighL"),
        ("ShinR", "ThighR"),
        ("ForearmL", "UpperArmL"),
        ("ForearmR", "UpperArmR"),
    ):
        copies[lower].parent = copies[upper]
        copies[lower].matrix_parent_inverse = copies[upper].matrix_world.inverted()
    # The scene is built in game axes (Y up, facing +Z), so rotation about X bends a joint the
    # same way it does in the game.
    for name, angle in pose.items():
        copies[name].rotation_euler.x = angle
    gbm = bmesh.new()
    for p in [(-5, 0, -5), (5, 0, -5), (5, 0, 5), (-5, 0, 5)]:
        gbm.verts.new(p)
    gbm.faces.new(gbm.verts)
    gm = bpy.data.materials.new("Ground")
    gme = bpy.data.meshes.new("Ground")
    gbm.to_mesh(gme)
    gme.materials.append(gm)
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
    cam.data.lens = 60
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 32
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    for view, (eye, target) in {
        "front": ((0.9, 1.2, 3.6), (0.4, 0.95, 0.0)),
        "back": ((-0.6, 1.4, -3.2), (0.4, 1.0, 0.0)),
        "face": ((0.0, 1.66, 0.75), (0.0, 1.62, 0.0)),
    }.items():
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"human-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
