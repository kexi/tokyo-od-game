# 標識の見本（多視点レビュー、knowledge/review-loop.md）: every sign the game has artwork for, one
# render each — its plate from public/models/signs.glb's own geometry with the face texture, the
# post, rail and band behind it as the game mounts it (resolveMount, via .qa/signs/mounts.json
# written by scripts/qa/signMounts.ts) — seen square on and turned 30° and 60°, so a reviewer
# checks the shape, the artwork's fit on the plate (UV), the size and the mounting apart from the game's
# shaders. Runs after signs.py in the same Blender session (it builds the plates; this one only
# copies them):
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/signs.py --python scripts/blender/sign_review.py -- .qa/signs/signs.glb
#
# (just render-sign-review). Output: .qa/signs/<angle>/<id>[~<variant>].png and .qa/signs/index.json
# (number, name, group, standard size, the 別表第二 figure, the plate) for scripts/qa/signSheet.ts.
# SIGN_REVIEW_ANGLES (default "0,30,60") and SIGN_REVIEW_OUT (default .qa/signs) change them.
#
# Why Workbench and not Cycles: 365 faces × 3 angles must take minutes, not an hour, and flat
# texture colour is what is reviewed here (the lit look is the in-game views' job).
# Why not one big grid render: per-sign files can be opened alone at full size, and the labels
# (Japanese names) are set by the sheet in Chrome, where the fonts are.
import json
import math
import os

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(os.environ.get("SIGN_REVIEW_OUT", os.path.join(ROOT, ".qa", "signs")))
ANGLES = [float(a) for a in os.environ.get("SIGN_REVIEW_ANGLES", "0,30,60").split(",")]
TEX = os.path.join(ROOT, "assets", "signs", "textures")
REGISTRY = os.path.join(ROOT, "assets", "signs", "registry.json")
SIZE_PX = 360


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


# How each plate is mounted (post, cap, rail, band from signs.glb's unit members), resolved by the
# game's resolveMount and written by scripts/qa/signMounts.ts relative to the plate's face centre.
# Read rather than copied, so the review shows what the game draws (missing: run it first).
MOUNTS_JSON = os.path.join(OUT, "mounts.json")
if not os.path.exists(MOUNTS_JSON):
    raise SystemExit(f"sign_review.py: {MOUNTS_JSON} is missing (pnpm exec tsx scripts/qa/signMounts.ts {OUT})")
MOUNTS = json.load(open(MOUNTS_JSON, encoding="utf-8"))

SCENE = bpy.context.scene
# Drawn: the faces with their textures, nothing else of signs.py's scene.
for ob in SCENE.objects:
    ob.hide_render = True

# Every face the registry has artwork for: a sign's own texture and its variants, the face of the
# sign it shares a plate with (317 → 316), and the lane renders of 327の7-A …
registry = json.load(open(REGISTRY, encoding="utf-8"))
by_id = {s["id"]: s for s in registry["signs"]}
figure_url = registry["law"]["figureUrl"]
entries = []
for sign in registry["signs"]:
    art = sign.get("art") or (by_id.get(sign.get("shares"), {}).get("art"))
    is_drawn = art is not None and art.get("by") == "texture"
    if not is_drawn:
        continue
    faces = [(None, art["file"])] + [(v["key"], v["file"]) for v in art.get("variants") or []]
    faces += [(f"lanes:{ln['lanes']}", ln["file"]) for ln in registry["lanes"] if ln["sign"] == sign["id"]]
    size = registry["plates"].get(sign["plate"], {}).get("sizeMm")
    figure = figure_url.format(sign["figure"]) if sign.get("figure") else None
    meta = {
        "id": sign["id"],
        "name": sign["name"],
        "group": sign["group"],
        "plate_node": sign["plate"],
        "size_mm": size,
        "figure": figure,
    }
    for key, texture in faces:
        entries.append({"sign": meta, "key": key, "texture": texture})

face_material = bpy.data.materials["SignFace"]

SCENE.render.engine = "BLENDER_WORKBENCH"
SCENE.display.shading.light = "STUDIO"
SCENE.display.shading.color_type = "TEXTURE"
SCENE.display.shading.show_object_outline = False
SCENE.display.shading.background_type = "VIEWPORT"
SCENE.display.shading.background_color = (0.58, 0.66, 0.76)
SCENE.render.resolution_x = SIZE_PX
SCENE.render.resolution_y = SIZE_PX
SCENE.render.film_transparent = False
SCENE.render.image_settings.file_format = "PNG"

cam = bpy.data.objects.new("ReviewCamera", bpy.data.cameras.new("ReviewCamera"))
SCENE.collection.objects.link(cam)
SCENE.camera = cam
cam.data.lens = 85

index = []
images = {}
for e in entries:
    sign, key, texture = e["sign"], e["key"], e["texture"]
    node = sign["plate_node"]
    src = bpy.data.objects.get(node)
    if src is None:
        log("sign_review_plate_missing", id=sign["id"], plate=node)
        continue
    plate = src.copy()
    plate.data = src.data.copy()
    SCENE.collection.objects.link(plate)
    mat = face_material.copy()
    path = os.path.join(TEX, texture)
    images[path] = images.get(path) or bpy.data.images.load(path)
    mat.node_tree.nodes["Image Texture"].image = images[path]
    plate.data.materials[0] = mat
    # The members the game puts behind this plate (signs.py modelled them in this session; game
    # coordinates are Blender's here, as signs.py builds in Y-up).
    parts = []
    for m in MOUNTS.get(node, {}).get("members", []):
        part = bpy.data.objects[m["node"]].copy()
        SCENE.collection.objects.link(part)
        part.location = tuple(m["at"])
        part.scale = tuple(m["scale"])
        parts.append(part)
    w, h = sign["size_mm"] or [600, 600]
    half = max(w, h) / 2000
    for ob in (plate, *parts):
        ob.hide_render = False
    name = sign["id"] + (f"~{key}" if key else "")
    for angle in ANGLES:
        # The eye turns round the plate's vertical axis (positive: from the plate's right).
        dist = max(2.4, half * 2 * 3.2)
        a = math.radians(angle)
        eye = Vector((dist * math.sin(a), 0.0, dist * math.cos(a)))
        fwd = (Vector((0.0, 0.0, 0.0)) - eye).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.location = eye
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        folder = os.path.join(OUT, f"{int(angle)}")
        os.makedirs(folder, exist_ok=True)
        file = os.path.join(folder, f"{name}.png")
        SCENE.render.filepath = file
        bpy.ops.render.render(write_still=True)
        index.append(
            {
                "id": sign["id"],
                "variant": key,
                "name": sign["name"],
                "group": sign["group"],
                "plate": node,
                "sizeMm": sign["size_mm"],
                "texture": texture,
                "figure": sign.get("figure"),
                "angleDeg": angle,
                "image": os.path.relpath(file, OUT),
            }
        )
    for ob in (plate, *parts):
        bpy.data.objects.remove(ob)

with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
    json.dump({"angles": ANGLES, "signs": len(entries), "renders": index}, f, ensure_ascii=False, indent=1)
log("sign_review_rendered", out=OUT, faces=len(entries), renders=len(index))
