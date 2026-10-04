# Background render for the social-share card (OGP), built only from this game's own assets:
# the car and sign models (public/models) and the sign artwork (assets/signs/textures), so the
# card carries no third-party map or 3D-city imagery that would need attribution on SNS.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/og.py -- assets/og/scene.png
#
# The glTF importer converts the models' +Y-up to Blender's +Z-up, so this scene is Z-up:
# the car's nose points to −Y and the ground lies at z = −0.86 (car origin = body centre).
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "assets", "og", "scene.png")
SIGN_TEX = os.path.join(ROOT, "assets", "signs", "textures")
GROUND = -0.86


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def import_glb(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "public", "models", name))
    return {o.name: o for o in set(bpy.data.objects) - before}


def flat(name, color, roughness=0.8, emission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = roughness
    if emission:
        b.inputs["Emission Color"].default_value = color
        b.inputs["Emission Strength"].default_value = emission
    return m


def quad(name, corners, mat, z=GROUND + 0.002):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z)) for x, y in corners]
    bm.faces.new(vs)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- car
car = import_glb("car.glb")
for name, ob in car.items():
    base = name.split(".")[0]
    # The private-car variant only; the LOD and the taxi parts stay out of the shot.
    if base in ("CarLow", "BodyLow", "TaxiLow", "TaxiSignLow", "Taxi", "TaxiSign", "Vacancy") or "Taxi" in base:
        ob.hide_render = True
wheel = next(o for n, o in car.items() if n.split(".")[0] == "Wheel")
caliper = next(o for n, o in car.items() if n.split(".")[0] == "Caliper")
wheel.hide_render = caliper.hide_render = True
# Game frame (x, y-up, z-forward) → Blender (x, −z, y): wheels at x ±0.82, forward ±1.35, hub −0.5.
for x, fwd in ((0.82, 1.35), (-0.82, 1.35), (0.82, -1.35), (-0.82, -1.35)):
    for src in (wheel, caliper):
        c = src.copy()
        SCENE.collection.objects.link(c)
        c.hide_render = False
        c.location = (x, -fwd, -0.5)
        c.scale = (1 if x > 0 else -1, 1, 1)
# Paint: a deep blue metallic, like the game's default.
paint = bpy.data.materials.get("Paint")
if paint:
    paint.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.02, 0.09, 0.32, 1)
# Headlamps on for the dusk shot.
for lamp in ("HeadLamp", "TailLamp"):
    m = bpy.data.materials.get(lamp)
    if m:
        m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 2.5

# ---------------------------------------------------------------- signs
signs = import_glb("signs.glb")
plates = {n.split(".")[0]: o for n, o in signs.items()}
for o in signs.values():
    o.hide_render = True


def sign_post(shape, artwork, x, y, yaw, height=2.6):
    """A post with one plate, facing the camera side (yaw about Z)."""
    post = plates["Post"].copy()
    SCENE.collection.objects.link(post)
    post.hide_render = False
    post.location = (x, y, GROUND)
    post.scale = (1, 1, (height + 0.45) / 3.2)
    plate = plates[shape].copy()
    plate.data = plate.data.copy()
    SCENE.collection.objects.link(plate)
    plate.hide_render = False
    face = plate.data.materials[0].copy()
    tex = next(n for n in face.node_tree.nodes if n.type == "TEX_IMAGE")
    tex.image = bpy.data.images.load(os.path.join(SIGN_TEX, artwork))
    plate.data.materials[0] = face
    # Plates face +Z in the game frame = −Y here; turn them toward the camera.
    plate.rotation_euler = (0, 0, yaw)
    offset = Vector((0, -0.05, 0))
    offset.rotate(plate.rotation_euler)
    plate.location = Vector((x, y, GROUND + height)) + offset
    plate.scale = (1.25, 1.25, 1.25)


# On the right-hand pavement, clear of the title on the left of the card.
sign_post("PlateCircle", "speed_40.png", 7.3, 0.5, math.radians(-30))
sign_post("PlateTriangle", "stop.png", 8.6, 8.0, math.radians(-30), height=2.4)

# ---------------------------------------------------------------- road
asphalt = flat("Asphalt", (0.035, 0.037, 0.042, 1), roughness=0.92)
white = flat("Line", (0.85, 0.85, 0.82, 1), roughness=0.7)
yellow = flat("Yellow", (0.85, 0.52, 0.02, 1), roughness=0.7)
pavement = flat("Pavement", (0.18, 0.18, 0.19, 1), roughness=0.9)
quad("Pavement", [(-60, -80), (60, -80), (60, 80), (-60, 80)], pavement, z=GROUND - 0.12)
quad("Road", [(-6.5, -80), (6.5, -80), (6.5, 80), (-6.5, 80)], asphalt, z=GROUND)
for x in (-6.1, 6.1):
    quad(f"Edge{x}", [(x - 0.08, -80), (x + 0.08, -80), (x + 0.08, 80), (x - 0.08, 80)], white)
# はみ出し禁止: yellow centre line (規制標示 102); the car keeps left (−X when facing −Y? no: +X).
quad("Centre", [(-0.08, -80), (0.08, -80), (0.08, 80), (-0.08, 80)], yellow)
# 横断歩道 ahead of the car.
for i in range(14):
    x = -6.0 + 0.45 + i * 0.9
    quad(f"Zebra{i}", [(x - 0.225, -9.5), (x + 0.225, -9.5), (x + 0.225, -5.5), (x - 0.225, -5.5)], white)
# 最高速度 numerals are skipped: the sign carries the limit.

# The game drives on the left: car in the left lane relative to its heading (−Y), i.e. +X side.
for o in SCENE.objects:
    if o.parent is None and not o.hide_render and o.name.split(".")[0] in ("CarHi", "Wheel", "Caliper"):
        o.location.x += 3.2

# ---------------------------------------------------------------- light, sky, camera
world = bpy.data.worlds.new("World")
world.use_nodes = True
nt = world.node_tree
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = (
    "NISHITA"
    if hasattr(sky, "sky_type") and "NISHITA" in [i.identifier for i in sky.bl_rna.properties["sky_type"].enum_items]
    else sky.sky_type
)
if hasattr(sky, "sun_elevation"):
    sky.sun_elevation = math.radians(6)
    sky.sun_rotation = math.radians(250)
nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
nt.nodes["Background"].inputs["Strength"].default_value = 0.35
SCENE.world = world
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 2.2
sun.data.color = (1.0, 0.78, 0.55)
sun.rotation_euler = (math.radians(80), 0, math.radians(250))
SCENE.collection.objects.link(sun)
fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
fill.data.energy = 600
fill.data.size = 8
fill.location = (-6, -8, 6)
fill.rotation_euler = (math.radians(55), 0, math.radians(-40))
SCENE.collection.objects.link(fill)

cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
cam.data.lens = 40
SCENE.collection.objects.link(cam)
SCENE.camera = cam
cam.location = (-2.6, -9.6, 0.4)
# Aim left of the car so it sits in the right half, leaving the left for the title.
target = Vector((0.9, 0.6, -0.15))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

SCENE.render.engine = "CYCLES"
SCENE.cycles.device = "CPU"
SCENE.cycles.samples = int(os.environ.get("OG_SAMPLES", "128"))
SCENE.cycles.use_denoising = True
SCENE.render.resolution_x = 1200
SCENE.render.resolution_y = 630
SCENE.render.image_settings.file_format = "PNG"
SCENE.view_settings.view_transform = (
    "AgX"
    if "AgX" in [i.identifier for i in SCENE.view_settings.bl_rna.properties["view_transform"].enum_items]
    else "Filmic"
)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
SCENE.render.filepath = OUT
bpy.ops.render.render(write_still=True)
log("rendered", file=OUT)
