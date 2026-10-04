# 道路標識の板・支柱・取付金具 for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/signs.py -- public/models/signs.glb [preview-dir]
#
# Game coordinates (+Y up, +Z = the side the sign face looks at), exported with export_yup=False.
# Plates are centred on their own origin with the face toward +Z; the face primitive uses the
# material "SignFace" with UVs covering the artwork square (0–1), so the game can swap in any
# texture from assets/signs/textures. Real sizes (命令 別表第二 備考二 standard dimensions): circular
# 規制標識 60 cm, 一時停止・徐行 inverted triangle 80 cm per side, 指示標識 60 cm square, 一方通行
# (326-B) 30 × 60 cm; posts are 60.5 mm galvanised steel pipe.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "signs.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "signs", "textures")

THICK = 0.004  # aluminium plate with a rolled edge
RIM = 0.012  # rolled edge depth behind the face
POST_R = 0.03025
POST_H = 3.2


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


def material(name, color, metallic=0.0, roughness=0.5, image=None):
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
        rnd = m.node_tree.nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"  # glTF alphaMode MASK
        m.node_tree.links.new(tex.outputs["Alpha"], rnd.inputs[0])
        m.node_tree.links.new(rnd.outputs[0], b.inputs["Alpha"])
    MAT[name] = m
    return m


# The face texture is replaced per sign at runtime; speed_40 is only a placeholder for previews.
material("SignFace", 0xFFFFFF, roughness=0.45, image=os.path.join(TEX, "speed_40.png"))
material("SignBack", 0x9AA1A8, metallic=0.6, roughness=0.45)
material("Post", 0xA7ADB3, metallic=0.7, roughness=0.4)
material("Bracket", 0x6E747A, metallic=0.7, roughness=0.5)


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


def plate(name, outline, uv_box):
    """Flat plate from a 2D outline (counter-clockwise, metres): textured face, rolled edge, back."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    (u0x, u0y), (u1x, u1y) = uv_box  # outline coordinates that map to UV (0,0) and (1,1)
    front = [bm.verts.new((x, y, 0.0)) for x, y in outline]
    back = [bm.verts.new((x, y, -RIM)) for x, y in outline]
    inner = [bm.verts.new((x * 0.985, y * 0.985, -THICK)) for x, y in outline]
    face = bm.faces.new(front)
    face.material_index = 0
    for loop in face.loops:
        x, y = loop.vert.co.x, loop.vert.co.y
        loop[uvl].uv = ((x - u0x) / (u1x - u0x), (y - u0y) / (u1y - u0y))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[j], front[i], back[i], back[j])).material_index = 1  # rolled edge
        bm.faces.new((back[j], back[i], inner[i], inner[j])).material_index = 1  # lip
    bm.faces.new(list(reversed(inner))).material_index = 1  # back sheet
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if face.normal.z < 0:  # the artwork must face +Z
        for f in bm.faces:
            f.normal_flip()
    return new_object(name, bm, ["SignFace", "SignBack"])


def rounded(points, radius, steps=6):
    """Round the corners of a convex counter-clockwise polygon with arcs of `radius`."""
    out = []
    n = len(points)
    for i in range(n):
        p = Vector(points[i])
        a = (Vector(points[i - 1]) - p).normalized()
        b = (Vector(points[(i + 1) % n]) - p).normalized()
        half = math.acos(max(-1.0, min(1.0, a.dot(b)))) / 2
        dist = radius / math.tan(half)
        start = p + a * dist
        end = p + b * dist
        centre = p + (a + b).normalized() * (radius / math.sin(half))
        a0 = math.atan2(start.y - centre.y, start.x - centre.x)
        a1 = math.atan2(end.y - centre.y, end.x - centre.x)
        # The short way round, which on a convex counter-clockwise outline turns left (+).
        delta = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(steps + 1):
            t = a0 + delta * k / steps
            out.append((centre.x + radius * math.cos(t), centre.y + radius * math.sin(t)))
    return out


def circle(r, segments=48):
    return [
        (r * math.cos(2 * math.pi * i / segments), r * math.sin(2 * math.pi * i / segments)) for i in range(segments)
    ]


# Plates. UV boxes match the texture canvases: square artwork for circle/triangle/square, 1:2 for one-way.
plate("PlateCircle", circle(0.30), ((-0.30, -0.30), (0.30, 0.30)))
tri_h = 0.80 * math.sqrt(3) / 2
# Inverted triangle, counter-clockwise: top-left → bottom apex → top-right. The texture's top edge
# is the plate's top edge and its bottom-centre is the apex.
triangle = [(-0.40, tri_h / 2), (0.0, -tri_h / 2), (0.40, tri_h / 2)]
plate("PlateTriangle", rounded(triangle, 0.035), ((-0.40, -tri_h / 2), (0.40, tri_h / 2)))
plate(
    "PlateSquare",
    rounded([(-0.30, -0.30), (0.30, -0.30), (0.30, 0.30), (-0.30, 0.30)], 0.025),
    ((-0.30, -0.30), (0.30, 0.30)),
)
plate(
    "PlateRect",
    rounded([(-0.15, -0.30), (0.15, -0.30), (0.15, 0.30), (-0.15, 0.30)], 0.02),
    ((-0.15, -0.30), (0.15, 0.30)),
)


def post(name):
    """60.5 mm steel pipe from the ground (origin) up to POST_H, with a domed cap."""
    bm = bmesh.new()
    ring0, ring1 = [], []
    segs = 12
    for i in range(segs):
        a = 2 * math.pi * i / segs
        x, z = POST_R * math.cos(a), POST_R * math.sin(a)
        ring0.append(bm.verts.new((x, 0.0, z)))
        ring1.append(bm.verts.new((x, POST_H, z)))
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    tip = bm.verts.new((0.0, POST_H + 0.02, 0.0))
    for i in range(segs):
        bm.faces.new((ring1[i], ring1[(i + 1) % segs], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, ["Post"], smooth=True, sharp_angle=60)


def bracket(name):
    """Back rail and U-band clamp joining a plate (at z = 0) to a post behind it (axis at z = −0.05)."""
    bm = bmesh.new()

    def box(cx, cy, cz, sx, sy, sz):
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
            bm.faces.new([vs[i] for i in f])

    box(0.0, 0.0, -0.018, 0.40, 0.04, 0.012)  # horizontal rail riveted to the plate back
    box(0.0, 0.0, -0.035, 0.05, 0.05, 0.025)  # saddle
    # U-band around the post.
    segs = 10
    prev = None
    for i in range(segs + 1):
        a = math.pi * i / segs
        x, z = (POST_R + 0.006) * math.cos(a), -0.05 - (POST_R + 0.006) * math.sin(a)
        cur = [bm.verts.new((x, y, z)) for y in (-0.018, 0.018)]
        if prev:
            bm.faces.new((prev[0], cur[0], cur[1], prev[1]))
        prev = cur
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, ["Bracket"])


post("Post")
bracket("Bracket")

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
log("exported", file=OUT, bytes=os.path.getsize(OUT), objects=[o.name for o in SCENE.objects])

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    # A post with a stack of plates, as the game assembles them.
    shapes = ["PlateCircle", "PlateRect", "PlateTriangle", "PlateSquare"]
    for i, name in enumerate(shapes):
        src = bpy.data.objects[name]
        for x in (0.0,):
            p = src.copy()
            SCENE.collection.objects.link(p)
            p.location = (x + i * 1.2 - 1.8, 1.5, 0.05)
            pp = bpy.data.objects["Post"].copy()
            SCENE.collection.objects.link(pp)
            pp.location = (x + i * 1.2 - 1.8, 0.0, 0.0)
            b = bpy.data.objects["Bracket"].copy()
            SCENE.collection.objects.link(b)
            b.location = (x + i * 1.2 - 1.8, 1.5, 0.05)
    artwork = {
        "PlateCircle": "speed_40.png",
        "PlateRect": "one_way.png",
        "PlateTriangle": "stop.png",
        "PlateSquare": "crosswalk.png",
    }
    for ob in list(SCENE.objects):
        base = ob.name.split(".")[0]
        if ob.type != "MESH" or base not in artwork or ob.name == base:
            continue
        face = MAT["SignFace"].copy()
        face.node_tree.nodes["Image Texture"].image = bpy.data.images.load(os.path.join(TEX, artwork[base]))
        ob.data = ob.data.copy()
        ob.data.materials[0] = face
    for name in shapes + ["Post", "Bracket"]:
        bpy.data.objects[name].hide_render = True
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
    from mathutils import Matrix

    views = {"front": ((0.0, 1.6, 6.5), (0.0, 1.3, 0.0)), "back": ((-1.5, 1.9, -3.2), (0.0, 1.4, 0.0))}
    for view, (eye, target) in views.items():
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"signs-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
