# Mirror charms for TOKYO OPEN DRIVE: a small round plush bear and a traffic-safety お守り that hang
# on a cord from the player's rear-view mirror (src/game/mirrorCharm.ts, physics in
# src/physics/charmRig.ts).
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/mirror_charms.py -- public/models/mirror_charms.glb [preview-dir]
#
# Charm axes (exported with export_yup=False, so glTF gets them unchanged): the origin is the loop
# the cord is tied to, the charm hangs along −Y and faces +Z. Nodes:
#   Charm_Plush     a bear of our own design (round head, round ears, cream muzzle and belly, red
#                   scarf), 5.8 cm loop to feet, 3.6 cm wide. Fur: sheen (KHR_materials_sheen) and
#                   a tufted normal map. Its centre of mass and inertia are in charmRig.ts PLUSH.
#   Charm_Omamori   a brocade pouch 44 × 66 × 9 mm with a cord knot on top; the front carries
#                   「交通安全」 only (assets/charms/textures/omamori.png). No shrine or temple name or
#                   mark, no real character, no brand.
# Textures come from scripts/textures/charm_textures.py (run it first).
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "mirror_charms.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(ROOT, "assets", "charms", "textures")
MM = 0.001


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


def image(name, non_color=False):
    img = bpy.data.images.load(os.path.join(TEX, name))
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


FUR_NORMAL = None


def material(name, color, roughness=0.5, metallic=0.0, sheen=None, fur=False, texture=None):
    """Principled BSDF; `sheen` (tint, roughness) becomes KHR_materials_sheen, `fur` adds the tufts."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    if sheen:
        tint, sheen_roughness = sheen
        b.inputs["Sheen Weight"].default_value = 1.0
        b.inputs["Sheen Tint"].default_value = lin(tint)
        b.inputs["Sheen Roughness"].default_value = sheen_roughness
    if fur:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = FUR_NORMAL
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.8
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if texture:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = texture
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    MAT[name] = m
    return m


FUR_NORMAL = image("plush_fur_normal.png", non_color=True)
OMAMORI_TEX = image("omamori.png")
# Fur: a warm caramel plush with a paler sheen at grazing angles (the pile catching light).
material("CharmFur", 0xB9844F, roughness=0.92, sheen=(0xF0D2A8, 0.45), fur=True)
material("CharmFurLight", 0xEADAC0, roughness=0.95, sheen=(0xFFF4E2, 0.5), fur=True)
material("CharmBead", 0x14100E, roughness=0.12)  # eyes and nose: glossy black beads / stitching
material("CharmScarf", 0xB8322B, roughness=0.85, sheen=(0xF07060, 0.6))  # knitted red scarf
material("CharmLoop", 0x1A1A1C, roughness=0.6)  # the thread loop on the head
material("OmamoriBrocade", 0xFFFFFF, roughness=0.55, sheen=(0x8A6A9A, 0.35), texture=OMAMORI_TEX)
material("OmamoriCord", 0xC8352E, roughness=0.45, sheen=(0xFF8A70, 0.3))  # satin cord, knotted


class Part:
    """One object: a bmesh in charm coordinates and its material slots, joined at the end."""

    def __init__(self, name, mats):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = mats

    def ellipsoid(self, centre, radii, mat, segments=12, rings=8, rotate=None):
        """UV sphere scaled to `radii`, its UVs kept (the fur's tufts follow them)."""
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segments, v_segments=rings, radius=1.0, calc_uvs=True)
        verts = res["verts"]
        m = Matrix.Translation(Vector(centre))
        if rotate:
            m = m @ rotate
        m = m @ Matrix.Diagonal((*radii, 1.0))
        bmesh.ops.transform(self.bm, matrix=m, verts=verts)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = self.mats.index(mat)
            f.smooth = True
        return verts

    def torus(self, centre, major, minor, mat, axis="Z", segments=12, sides=6, arc=1.0):
        """A ring (or part of one) round `axis` through `centre`."""
        rings = []
        n = segments if arc >= 1.0 else segments + 1
        for i in range(n):
            a = 2 * math.pi * arc * i / segments
            ring = []
            for j in range(sides):
                b = 2 * math.pi * j / sides
                r = major + minor * math.cos(b)
                p = Vector((r * math.cos(a), r * math.sin(a), minor * math.sin(b)))
                if axis == "X":
                    p = Vector((p.z, p.y, p.x))
                elif axis == "Y":
                    p = Vector((p.x, p.z, p.y))
                ring.append(self.bm.verts.new(Vector(centre) + p))
            rings.append(ring)
        pairs = list(zip(rings, rings[1:] + ([rings[0]] if arc >= 1.0 else []), strict=False))
        for r0, r1 in pairs:
            for j in range(sides):
                f = self.bm.faces.new((r0[j], r1[j], r1[(j + 1) % sides], r0[(j + 1) % sides]))
                f.material_index = self.mats.index(mat)
                f.smooth = True

    def build(self):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        ob = bpy.data.objects.new(self.name, me)
        SCENE.collection.objects.link(ob)
        return ob


def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


# ---------------------------------------------------------------- plush bear
bear = Part("Charm_Plush", ["CharmFur", "CharmFurLight", "CharmBead", "CharmScarf", "CharmLoop"])
HEAD = (0.0, -19 * MM, 0.0)
bear.ellipsoid(HEAD, (17.5 * MM, 16 * MM, 15 * MM), "CharmFur", segments=18, rings=12)
for side in (-1, 1):
    ear = (side * 12 * MM, -6.5 * MM, -1 * MM)
    bear.ellipsoid(ear, (5.6 * MM, 5.6 * MM, 3.4 * MM), "CharmFur", segments=10, rings=6)
    bear.ellipsoid(
        (ear[0] * 0.98, ear[1] - 0.4 * MM, ear[2] + 2.2 * MM),
        (3.4 * MM, 3.4 * MM, 1.4 * MM),
        "CharmFurLight",
        segments=8,
        rings=5,
    )
    # Eyes: round black beads, a little apart, above the muzzle.
    bear.ellipsoid(
        (side * 6.4 * MM, -15.5 * MM, 13.4 * MM), (1.9 * MM, 1.9 * MM, 1.3 * MM), "CharmBead", segments=8, rings=5
    )
# Muzzle and nose.
bear.ellipsoid((0.0, -23.5 * MM, 12.2 * MM), (8.2 * MM, 6.2 * MM, 5.0 * MM), "CharmFurLight", segments=12, rings=7)
bear.ellipsoid((0.0, -20.8 * MM, 16.8 * MM), (2.6 * MM, 1.8 * MM, 1.5 * MM), "CharmBead", segments=8, rings=5)
# Body, belly patch, arms, legs and a stub tail.
BODY = (0.0, -41 * MM, 0.5 * MM)
bear.ellipsoid(BODY, (13.5 * MM, 14.5 * MM, 12 * MM), "CharmFur", segments=16, rings=10)
bear.ellipsoid((0.0, -42 * MM, 9.2 * MM), (8.5 * MM, 9.5 * MM, 3.6 * MM), "CharmFurLight", segments=10, rings=6)
for side in (-1, 1):
    bear.ellipsoid(
        (side * 12.5 * MM, -38 * MM, 4 * MM),
        (4.6 * MM, 7.6 * MM, 4.6 * MM),
        "CharmFur",
        segments=8,
        rings=6,
        rotate=rot_z(side * 28),
    )
    bear.ellipsoid(
        (side * 7.5 * MM, -53.5 * MM, 4.5 * MM), (5.6 * MM, 4.2 * MM, 6.6 * MM), "CharmFur", segments=8, rings=6
    )
bear.ellipsoid((0.0, -49 * MM, -11.5 * MM), (3.2 * MM, 3.2 * MM, 3.2 * MM), "CharmFur", segments=6, rings=4)
# A knitted scarf round the neck, and the thread loop the cord is tied to on the crown.
bear.torus((0.0, -31.5 * MM, 0.6 * MM), 11.6 * MM, 2.4 * MM, "CharmScarf", axis="Y", segments=16, sides=6)
bear.torus((0.0, -1.6 * MM, 0.0), 2.2 * MM, 0.6 * MM, "CharmLoop", axis="Z", segments=10, sides=4)
plush = bear.build()

# ---------------------------------------------------------------- お守り
W, TOP, BOTTOM = 44 * MM, -13 * MM, -79 * MM
SHOULDER = 7 * MM  # the top corners folded down at 45°
ARC = 3


def pouch_outline(inset=0.0):
    """Counter-clockwise outline (seen from +Z): a 44 × 66 mm card with folded top corners."""
    x0, x1 = -W / 2 + inset, W / 2 - inset
    y0, y1 = BOTTOM + inset, TOP - inset
    s = SHOULDER - inset * 0.4
    r = 3 * MM
    pts = []
    for k in range(ARC + 1):  # bottom-right corner
        a = math.radians(-90 + 90 * k / ARC)
        pts.append((x1 - r + r * math.cos(a), y0 + r + r * math.sin(a)))
    pts += [(x1, y1 - s), (x1 - s, y1), (x0 + s, y1), (x0, y1 - s)]
    for k in range(ARC + 1):  # bottom-left corner
        a = math.radians(180 + 90 * k / ARC)
        pts.append((x0 + r + r * math.cos(a), y0 + r + r * math.sin(a)))
    return pts


def face_uv(x, y, front):
    """Front on the left half of omamori.png, back on the right; panel rows 64–448 of 512."""
    u = (x + W / 2) / W if front else (W / 2 - x) / W
    row = 64 + (TOP - y) / (TOP - BOTTOM) * 384
    return (0.5 * u + (0.0 if front else 0.5), 1.0 - row / 512)


pouch = Part("Charm_Omamori", ["OmamoriBrocade", "OmamoriCord"])
bm = pouch.bm
rim = [bm.verts.new((x, y, 0.0)) for x, y in pouch_outline()]
caps = {}
for side in (1, -1):
    mid = [bm.verts.new((x, y, side * 3.4 * MM)) for x, y in pouch_outline(2.2 * MM)]
    top = [bm.verts.new((x, y, side * 4.5 * MM)) for x, y in pouch_outline(6.0 * MM)]
    for ring_a, ring_b in ((rim, mid), (mid, top)):
        n = len(ring_a)
        for i in range(n):
            quad = [ring_a[i], ring_a[(i + 1) % n], ring_b[(i + 1) % n], ring_b[i]]
            f = bm.faces.new(quad if side > 0 else list(reversed(quad)))
            f.smooth = True
    f = bm.faces.new(top if side > 0 else list(reversed(top)))
    f.smooth = True
    caps[side] = f
for f in bm.faces:
    front = f.calc_center_median().z > 0
    for loop in f.loops:
        loop[pouch.uv].uv = face_uv(loop.vert.co.x, loop.vert.co.y, front)
# The cord: a knot on the folded top, two loops either side (a simple 叶結び look), the hanging
# loop up to the origin, and two tails down into the pouch.
pouch.ellipsoid((0.0, -8.5 * MM, 0.8 * MM), (3.6 * MM, 3.0 * MM, 2.6 * MM), "OmamoriCord", segments=10, rings=6)
for side in (-1, 1):
    pouch.torus(
        (side * 5.6 * MM, -9.5 * MM, 0.8 * MM), 3.0 * MM, 1.0 * MM, "OmamoriCord", axis="Z", segments=10, sides=5
    )
    pouch.torus(
        (side * 2.6 * MM, -12.0 * MM, 0.8 * MM),
        2.2 * MM,
        0.9 * MM,
        "OmamoriCord",
        axis="Z",
        segments=8,
        sides=5,
        arc=0.5,
    )
pouch.torus((0.0, -3.4 * MM, 0.0), 3.2 * MM, 0.9 * MM, "OmamoriCord", axis="Z", segments=10, sides=5)
omamori = pouch.build()

# ---------------------------------------------------------------- export
INFO = {
    "plush": {"loopToFeetMm": 57.6, "widthMm": 44, "massG": 30},
    "omamori": {"sizeMm": [44, 66, 9], "massG": 6},
}
SCENE["mirrorCharms"] = INFO
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
    # JPEG inside the glb: 572 KB with the PNGs, the brocade's weave and the fur noise hide its blocks.
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_cameras=False,
    export_lights=False,
)
tris = {}
for o in SCENE.objects:
    if o.type == "MESH":
        tris[o.name] = sum(len(p.vertices) - 2 for p in o.data.polygons)
bounds = {}
for o in SCENE.objects:
    if o.type == "MESH":
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        bounds[o.name] = [
            [round(min(getattr(c, a) for c in cs) / MM, 1), round(max(getattr(c, a) for c in cs) / MM, 1)]
            for a in "xyz"
        ]
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris, total=sum(tris.values()), bounds_mm=bounds)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(-55), math.radians(30), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 100
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 24
    SCENE.render.resolution_x = 480
    SCENE.render.resolution_y = 480
    for ob in (plush, omamori):
        other = omamori if ob is plush else plush
        for view, eye in {
            "front": (0.06, -0.02, 0.32),
            "side": (0.32, -0.01, 0.05),
            "back": (-0.08, -0.02, -0.3),
        }.items():
            other.hide_render = True
            ob.hide_render = False
            target = Vector((0.0, -0.035 if ob is plush else -0.045, 0.0))
            cam.location = eye
            fwd = (target - Vector(eye)).normalized()
            right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
            up = right.cross(fwd)
            cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
            SCENE.render.filepath = os.path.join(PREVIEW, f"{ob.name}-{view}.png")
            bpy.ops.render.render(write_still=True)
            log("preview", object=ob.name, view=view)
