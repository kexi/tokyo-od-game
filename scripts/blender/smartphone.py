# Generic slab smartphone in a case (147 × 71 × 8 mm) for TOKYO OPEN DRIVE: bystanders hold it up
# to film the player's car with the game's own social app (つぶやき) open on the screen.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/smartphone.py -- public/models/smartphone.glb [preview-dir]
#
# Phone axes (exported with export_yup=False, so glTF gets them unchanged): +X the right edge seen
# from the front, +Y the top, +Z out of the screen; the origin is the middle of the slab. Nodes:
#   Smartphone          case, front glass, camera island, lenses, flash, side buttons
#     SmartphoneScreen  the display alone, UV (0,0) bottom-left → (1,1) top-right in portrait,
#                       so the game can put a CanvasTexture on it
# The camera island sits at the back's top-left seen from behind (+X, +Y). Case colours are
# baseColorFactor of the untextured PhoneCase material; the game picks one of scene.extras
# .smartphone.caseColors per person. PhoneFlash is a separate material so the game can light it
# (video light at night). No brand marks, names or logos: the shape is the generic slab most
# phones share, and nothing is printed on it.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "smartphone.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None

MM = 0.001
W, H, D = 71 * MM, 147 * MM, 8 * MM  # width (X), height (Y), thickness (Z) with the case
CORNER = 9.5 * MM  # outline corner radius
BEZEL = 1.8 * MM  # glass border round the display
SCREEN_W, SCREEN_H = W - 2 * BEZEL, H - 2 * BEZEL
SCREEN_Z = D / 2 - 0.3 * MM  # the case lip stands 0.3 mm proud of the glass
ARC = 4  # segments per rounded corner (20-vertex outlines keep the phone a few hundred triangles)
# Camera island: a pill near the top-left corner of the back (seen from behind).
ISLAND_W, ISLAND_H, ISLAND_R = 16.5 * MM, 36 * MM, 7.5 * MM
ISLAND_C = (W / 2 - 5.5 * MM - ISLAND_W / 2, H / 2 - 5.5 * MM - ISLAND_H / 2)
ISLAND_PROUD = 1.5 * MM
LENSES = [(0.0, 9.0 * MM), (0.0, -3.5 * MM)]  # island-local centres
LENS_RING, LENS_GLASS = 5.8 * MM, 4.4 * MM
FLASH = ((0.0, -13.5 * MM), 2.2 * MM)
CASE_COLORS = [0x2E3138, 0xE9E6E0, 0x2C3E66, 0xE3A6B8, 0x9DB59C, 0xC8352E]  # graphite … red


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


material("PhoneCase", CASE_COLORS[0], roughness=0.55)  # matte silicone case (recoloured per person)
material("PhoneGlass", 0x0B0C0E, roughness=0.06)  # front glass border, top of the camera island
material("PhoneLens", 0x060912, roughness=0.04)
material("PhoneMetal", 0xB7BBC2, metallic=0.9, roughness=0.3)  # lens rings
material("PhoneFlash", 0xF2ECD6, roughness=0.35)
material("PhoneScreen", 0x050608, roughness=0.08)  # the game replaces it with the app's screen


def rounded_rect(cx, cy, w, h, r, arc=ARC):
    """Counter-clockwise outline (seen from +Z) of a w × h rectangle with corner radius r."""
    pts = []
    for qx, qy, a0 in ((1, 1, 0.0), (-1, 1, 90.0), (-1, -1, 180.0), (1, -1, 270.0)):
        ox, oy = cx + qx * (w / 2 - r), cy + qy * (h / 2 - r)
        for k in range(arc + 1):
            a = math.radians(a0 + 90.0 * k / arc)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def circle(cx, cy, r, segs):
    return [(cx + r * math.cos(2 * math.pi * k / segs), cy + r * math.sin(2 * math.pi * k / segs)) for k in range(segs)]


class Part:
    """One object being built: a bmesh in phone coordinates plus its material slots."""

    def __init__(self, name, mats, uv=False):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap") if uv else None
        self.mats = mats

    def ring(self, outline, z):
        return [self.bm.verts.new((x, y, z)) for x, y in outline]

    def face(self, verts, mat, smooth=False, uv_of=None):
        f = self.bm.faces.new(verts)
        f.material_index = self.mats.index(mat)
        f.smooth = smooth
        if uv_of:
            for loop in f.loops:
                loop[self.uv].uv = uv_of(loop.vert.co)
        return f

    def band(self, lower, upper, mat, smooth=True):
        """Quads joining two rings of equal length (both counter-clockwise seen from +Z). Each face
        normal is (along the ring) × (lower → upper): outward for a wall rising toward +Z, +Z for an
        annulus whose `upper` ring is the inner one. Winding is set here, never recalculated: the
        lens rings and the island are open shells, where recalc_face_normals guesses."""
        n = len(lower)
        return [self.face((lower[i], lower[(i + 1) % n], upper[(i + 1) % n], upper[i]), mat, smooth) for i in range(n)]

    def cap(self, ring, mat, facing_z, uv_of=None):
        """Flat face over a ring: facing +Z keeps the ring's (counter-clockwise) order."""
        return self.face(ring if facing_z > 0 else list(reversed(ring)), mat, uv_of=uv_of)

    def box(self, lo, hi, mat, skip=None):
        """Axis-aligned box; `skip` names the face left out (buried in the case)."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        v = {
            (i, j, k): self.bm.verts.new((x1 if i else x0, y1 if j else y0, z1 if k else z0))
            for i in (0, 1)
            for j in (0, 1)
            for k in (0, 1)
        }
        sides = {
            "-x": [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
            "+x": [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
            "-y": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
            "+y": [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
            "-z": [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
            "+z": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
        }
        for name, keys in sides.items():
            if name != skip:
                self.face([v[k] for k in keys], mat)

    def build(self, parent=None):
        # Sharp wherever a flat face meets another face: the rounded sides stay smooth, the glass,
        # the back and the island top stay crisp.
        for e in self.bm.edges:
            if any(not f.smooth for f in e.link_faces):
                e.smooth = False
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        ob = bpy.data.objects.new(self.name, me)
        SCENE.collection.objects.link(ob)
        if parent:
            ob.parent = parent
        return ob


# ---------------------------------------------------------------- body: case, glass, buttons
body = Part("Smartphone", ["PhoneCase", "PhoneGlass", "PhoneLens", "PhoneMetal", "PhoneFlash"])
# Side profile, back → front: rounded back edge, straight side, then the case lip round the glass.
PROFILE = [(1.2 * MM, -D / 2), (0.0, -D / 2 + 1.2 * MM), (0.0, D / 2 - 1.0 * MM), (0.6 * MM, D / 2)]
rings = [body.ring(rounded_rect(0, 0, W - 2 * inset, H - 2 * inset, CORNER - inset), z) for inset, z in PROFILE]
for lower, upper in zip(rings, rings[1:], strict=False):
    body.band(lower, upper, "PhoneCase")
body.cap(rings[0], "PhoneCase", -1)
# Glass border: from the lip down to the display's edge (same vertex count, so plain quads).
screen_outline = rounded_rect(0, 0, SCREEN_W, SCREEN_H, CORNER - BEZEL)
glass_edge = body.ring(screen_outline, SCREEN_Z)
body.band(rings[-1], glass_edge, "PhoneGlass", smooth=False)
# Buttons on the case: volume up/down on the left edge (−X), power on the right (+X).
PROUD = 0.7 * MM
for side, y, length in ((-1, 30 * MM, 11 * MM), (-1, 16 * MM, 11 * MM), (1, 22 * MM, 16 * MM)):
    x_in, x_out = side * (W / 2 - 0.3 * MM), side * (W / 2 + PROUD)
    body.box(
        (min(x_in, x_out), y - length / 2, -1.4 * MM),
        (max(x_in, x_out), y + length / 2, 1.4 * MM),
        "PhoneCase",
        skip="-x" if side > 0 else "+x",
    )

# ---------------------------------------------------------------- camera island, lenses, flash
ix, iy = ISLAND_C
base = body.ring(rounded_rect(ix, iy, ISLAND_W, ISLAND_H, ISLAND_R), -D / 2 + 0.1 * MM)
top_z = -D / 2 - ISLAND_PROUD
top = body.ring(rounded_rect(ix, iy, ISLAND_W - 0.8 * MM, ISLAND_H - 0.8 * MM, ISLAND_R - 0.4 * MM), top_z)
# Facing −Z the ring order flips: build the band from the top ring down so the normals face out.
body.band(top, base, "PhoneCase")
body.cap(top, "PhoneGlass", -1)
for lx, ly in LENSES:
    outer_lo = body.ring(circle(ix + lx, iy + ly, LENS_RING, 12), top_z + 0.05 * MM)
    outer_hi = body.ring(circle(ix + lx, iy + ly, LENS_RING, 12), top_z - 0.6 * MM)
    inner_hi = body.ring(circle(ix + lx, iy + ly, LENS_GLASS, 12), top_z - 0.6 * MM)
    body.band(outer_hi, outer_lo, "PhoneMetal")
    body.band(inner_hi, outer_hi, "PhoneMetal", smooth=False)  # flat annulus facing −Z
    body.cap(inner_hi, "PhoneLens", -1)
(fx, fy), fr = FLASH
body.cap(body.ring(circle(ix + fx, iy + fy, fr, 8), top_z - 0.2 * MM), "PhoneFlash", -1)
phone = body.build()

# ---------------------------------------------------------------- display (its own node for the game)
screen = Part("SmartphoneScreen", ["PhoneScreen"], uv=True)


def screen_uv(co):
    return ((co.x + SCREEN_W / 2) / SCREEN_W, (co.y + SCREEN_H / 2) / SCREEN_H)


screen.cap(screen.ring(screen_outline, SCREEN_Z), "PhoneScreen", 1, uv_of=screen_uv)
screen_ob = screen.build(parent=phone)

# What the game reads (scene.extras.smartphone): sizes in metres and the case colour choices.
INFO = {
    "size": [round(W, 4), round(H, 4), round(D, 4)],
    "screen": [round(SCREEN_W, 4), round(SCREEN_H, 4)],
    "caseColors": [f"#{c:06x}" for c in CASE_COLORS],
}
SCENE["smartphone"] = INFO

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
    export_cameras=False,
    export_lights=False,
)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SCENE.objects if o.type == "MESH"}
corners = [o.matrix_world @ Vector(c) for o in SCENE.objects if o.type == "MESH" for c in o.bound_box]
log(
    "exported",
    file=OUT,
    bytes=os.path.getsize(OUT),
    tris=tris,
    total=sum(tris.values()),
    bounds_mm=[
        [round(min(getattr(c, a) for c in corners) / MM, 2), round(max(getattr(c, a) for c in corners) / MM, 2)]
        for a in "xyz"
    ],
    **INFO,
)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    # The display shows its UV as colour (red = u, green = v): the top-right corner must be yellow.
    nt = MAT["PhoneScreen"].node_tree
    uvmap = nt.nodes.new("ShaderNodeUVMap")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    nt.links.new(uvmap.outputs["UV"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(-50), math.radians(25), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 80
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 32
    SCENE.render.resolution_x = 960
    SCENE.render.resolution_y = 720
    # The scene is in phone axes (+Y up): build the camera rotation from forward/right/up.
    for view, eye in {
        "front": (0.12, 0.08, 0.42),
        "back": (-0.14, 0.10, -0.40),
        "side": (0.55, 0.05, -0.10),
        "island": (-0.05, 0.10, -0.16),
    }.items():
        target = Vector((ISLAND_C[0], ISLAND_C[1], 0.0)) if view == "island" else Vector((0.0, 0.0, 0.0))
        cam.location = eye
        fwd = (target - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"smartphone-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)
