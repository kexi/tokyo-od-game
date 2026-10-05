# 可搬式速度違反自動取締装置 (可搬式オービス) for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/portable_orbis.py -- public/models/portable_orbis.glb [preview-dir]
#
# A generic portable speed camera of the kind set up by the kerb of residential streets and
# school routes: a measuring head (camera window, sun hood, the flat face the radar looks through)
# on a surveying-style tripod, a strobe housing on top of the head, and a battery / control case on
# the ground with its cable up a leg. Its shape follows only the general layout seen in photographs
# (a tripod head with a separate flash and ground cases); it copies no product, and no maker's
# name, model number, police emblem or organisation name is drawn on any part.
#
# Game coordinates: +Y up, the head looks toward +Z (at the traffic coming), +X points from the
# kerb into the road (the approaching driver's right), ground at y = 0. Exported with
# export_yup=False. Nodes under the root `PortableOrbis` (extras = dimensions):
# - PortableUnit: tripod, head, strobe housing, ground case and cable. Origin: ground under the
#   tripod's centre. The head is turned HEAD_YAW toward +X so it looks across the lane ahead.
# - PortableLens: the strobe's window, in PortableUnit's coordinates (same matrix); material
#   `Strobe`. The game lights it with its own unlit material when the camera fires.
import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import police_common as pc  # noqa: E402
from police_common import Mesh, empty, log, material  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(pc.ROOT, "public", "models", "portable_orbis.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None

# Tripod (a surveying tripod's proportions: hub a little above 1 m, feet ~0.45 m out).
HUB_Y = 1.06
FOOT_R = 0.44
LEG_R = 0.017
COLUMN_TOP = 1.16
# Head: measuring housing, turned toward the road.
HEAD_W, HEAD_H, HEAD_D = 0.46, 0.30, 0.34
HEAD_Y = COLUMN_TOP + 0.05 + HEAD_H / 2  # centre, above the pan plate
HEAD_YAW = math.radians(10)
# Strobe housing on top of the head.
STROBE_W, STROBE_H, STROBE_D = 0.28, 0.16, 0.2
STROBE_Y = HEAD_Y + HEAD_H / 2 + 0.03 + STROBE_H / 2
# Battery / control case on the ground, behind the tripod on the kerb side.
CASE = (0.44, 0.32, 0.3)
CASE_AT = (-0.34, CASE[1] / 2, -0.42)

pc.reset()
material("Housing", 0xDDDBD3, roughness=0.45)
material("HousingDark", 0x2B2F34, roughness=0.6)
material("CameraGlass", 0x0D1115, metallic=0.2, roughness=0.08)
material("RadarFace", 0xBFC4C8, roughness=0.65)
material("TripodMetal", 0x3C4045, metallic=0.5, roughness=0.5)
material("CaseAlu", 0xB4B9BD, metallic=0.7, roughness=0.35)
material("Rubber", 0x1B1C1E, roughness=0.9)
# Resting strobe window: dark red behind clear glass. The game swaps in a lit material.
material("Strobe", 0x5C1A1A, roughness=0.25)

root = empty("PortableOrbis")


def finish(m, name, smooth=False):
    ob = m.obj(name, smooth=smooth)
    ob.parent = root
    pc.mark_sharp(ob, 40)
    return ob


yaw = Matrix.Rotation(HEAD_YAW, 3, "Y")  # +Z toward +X


def head(p):
    """A point given in the head's frame (centre at the origin, front +Z) in model coordinates."""
    return Vector((0.0, HEAD_Y, 0.0)) + yaw @ Vector(p)


m = Mesh(["TripodMetal", "Rubber", "Housing", "HousingDark", "CameraGlass", "RadarFace", "CaseAlu"])

# ---------------------------------------------------------------------------- tripod
for k in range(3):
    # One leg toward the traffic, two behind (as a tripod is set facing its work).
    a = math.radians(90 + 120 * k)
    foot = Vector((FOOT_R * math.cos(a), 0.03, FOOT_R * math.sin(a)))
    top = Vector((0.05 * math.cos(a), HUB_Y, 0.05 * math.sin(a)))
    m.tube(foot, top, LEG_R, LEG_R * 1.25, "TripodMetal", segs=6)
    m.tube(foot - Vector((0, 0.03, 0)), foot + Vector((0, 0.03, 0)), 0.026, 0.024, "Rubber", segs=6)
m.tube((0, HUB_Y - 0.04, 0), (0, HUB_Y + 0.03, 0), 0.075, 0.075, "TripodMetal", segs=10)  # hub casting
m.tube((0, HUB_Y - 0.32, 0), (0, COLUMN_TOP, 0), 0.022, 0.022, "TripodMetal", segs=8)  # centre column
m.box((0, COLUMN_TOP + 0.025, 0), (0.16, 0.05, 0.14), "TripodMetal")  # pan plate

# ---------------------------------------------------------------------------- head
m.box((0, HEAD_Y, 0), (HEAD_W, HEAD_H, HEAD_D), "Housing", rot=yaw)
zf = HEAD_D / 2 + 0.004
# Camera window (left of the front, kerb side) with a dark bezel, under a sun hood.
m.box(head((-0.11, 0.02, HEAD_D / 2)), (0.2, 0.17, 0.012), "HousingDark", rot=yaw)
m.face(
    [
        head((-0.2, -0.055, zf + 0.004)),
        head((-0.02, -0.055, zf + 0.004)),
        head((-0.02, 0.095, zf + 0.004)),
        head((-0.2, 0.095, zf + 0.004)),
    ],
    "CameraGlass",
    facing=yaw @ Vector((0, 0, 1)),
)
m.box(head((-0.11, 0.125, HEAD_D / 2 + 0.06)), (0.24, 0.012, 0.13), "Housing", rot=yaw)  # sun hood
# The radar's flat face (right of the front, road side).
m.box(head((0.12, -0.005, HEAD_D / 2 + 0.006)), (0.18, 0.2, 0.012), "RadarFace", rot=yaw)
# Carry handles on the sides.
for x in (-HEAD_W / 2 - 0.02, HEAD_W / 2 + 0.02):
    m.box(head((x, 0.0, 0.0)), (0.025, 0.05, 0.2), "HousingDark", rot=yaw)

# ---------------------------------------------------------------------------- strobe housing
m.box((0, HEAD_Y + HEAD_H / 2 + 0.015, 0), (0.12, 0.03, 0.12), "TripodMetal", rot=yaw)  # mount
m.box(head((0.04, STROBE_Y - HEAD_Y, -0.01)), (STROBE_W, STROBE_H, STROBE_D), "Housing", rot=yaw)
zs = -0.01 + STROBE_D / 2
m.box(head((0.04, STROBE_Y - HEAD_Y, zs + 0.006)), (STROBE_W - 0.02, STROBE_H - 0.02, 0.012), "HousingDark", rot=yaw)
lens = Mesh(["Strobe"])
lw, lh = STROBE_W / 2 - 0.025, STROBE_H / 2 - 0.022
ly = STROBE_Y - HEAD_Y
lens.face(
    [
        head((0.04 - lw, ly - lh, zs + 0.014)),
        head((0.04 + lw, ly - lh, zs + 0.014)),
        head((0.04 + lw, ly + lh, zs + 0.014)),
        head((0.04 - lw, ly + lh, zs + 0.014)),
    ],
    "Strobe",
    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
    facing=yaw @ Vector((0, 0, 1)),
)

# ---------------------------------------------------------------------------- ground case and cable
cx, cy, cz = CASE_AT
m.box(CASE_AT, CASE, "CaseAlu")
for dx in (-1, 1):
    for dz in (-1, 1):
        # Corner guards.
        m.box(
            (cx + dx * (CASE[0] / 2 - 0.012), cy, cz + dz * (CASE[2] / 2 - 0.012)),
            (0.03, CASE[1] + 0.006, 0.03),
            "TripodMetal",
        )
m.box((cx, CASE[1] + 0.03, cz), (0.16, 0.025, 0.03), "Rubber")  # handle
m.box((cx, CASE[1] - 0.04, cz + CASE[2] / 2 + 0.004), (CASE[0] - 0.06, 0.012, 0.008), "TripodMetal")  # lid seam
# Cable: from the case's top up the back leg to the head's underside.
back = math.radians(90 + 120 * 2)
pts = [
    Vector((cx + 0.1, CASE[1] + 0.01, cz + 0.05)),
    Vector((cx + 0.2, 0.2, cz + 0.2)),
    Vector((0.32 * math.cos(back), 0.4, 0.32 * math.sin(back))),
    Vector((0.08 * math.cos(back), 0.95, 0.08 * math.sin(back))),
    Vector((0.0, HEAD_Y - HEAD_H / 2 - 0.01, -0.08)),
]
for a, b in zip(pts, pts[1:], strict=False):
    m.tube(a, b, 0.008, 0.008, "Rubber", segs=5)

finish(m, "PortableUnit")
lens_ob = lens.obj("PortableLens")
lens_ob.parent = root

# ---------------------------------------------------------------------------- extras & export
root["headYaw"] = round(math.degrees(HEAD_YAW), 1)
root["height"] = round(STROBE_Y + STROBE_H / 2, 3)
root["footRadius"] = FOOT_R
lens_centre = head((0.04, ly, zs + 0.014))
root["lensCentre"] = [round(v, 4) for v in lens_centre]

tris = {o.name: pc.tris(o) for o in pc.scene().objects if o.type == "MESH"}
pc.export_glb(OUT)
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris, total=sum(tris.values()))

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    cam = pc.preview_setup(lens=40, ground=6.0)
    lit = material("StrobeLit", 0xFF4A3A, emissive=0xFF5A44)
    lit.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 40.0
    objs = {o.name: o for o in pc.scene().objects}
    # A second unit beside the first with its strobe lit, as the game shows it when it fires.
    for name in ("PortableUnit", "PortableLens"):
        src = objs[name]
        c = src.copy()
        c.data = src.data.copy() if name == "PortableLens" else src.data
        c.parent = None
        pc.scene().collection.objects.link(c)
        c.matrix_world = Matrix.Translation((2.2, 0, -1.5))
        if name == "PortableLens":
            c.data.materials[0] = lit
    for view, (eye, target) in {
        "front": ((0.9, 1.3, 3.2), (0.0, 1.0, 0.0)),
        "side": ((3.4, 1.6, 0.6), (0.6, 0.9, -0.6)),
        "driver": ((2.6, 1.2, 9.0), (0.8, 1.0, -0.5)),
    }.items():
        pc.render(cam, os.path.join(PREVIEW, f"portable-{view}.png"), eye, target)
