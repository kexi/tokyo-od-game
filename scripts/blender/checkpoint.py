# The props of a police 検問 (checkpoint) for TOKYO OPEN DRIVE: a road cone, a cone bar, a traffic
# baton, an A-frame board and a standing red warning lamp, each its own node so the game can place
# as many copies as a checkpoint needs.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/checkpoint.py -- [public/models/checkpoint.glb] [preview-dir]
#
# Game coordinates (+Y up, front toward +Z, ground at y = 0, the prop's left = +X), exported with
# export_yup=False. Each node's origin is where the game puts it; the nodes are laid out side by
# side in the file only so the asset page shows them apart (the game sets each copy's position):
#   Cone     パイロン, 0.70 m tall on a 0.38 m square base; red with two white retro-reflective
#            bands (ConeRed, ConeReflective, ConeBase). Origin on the ground.
#   ConeBar  コーンバー 1.8 m along local X, yellow and black (BarYellow, BarBlack); origin at its
#            centre: the game lifts it onto two cone tops 1.8 m apart.
#   Baton    誘導灯 0.55 m; origin at the grip's end, the light tube along +Y (BatonLight emissive red,
#            BatonGrip).
#   Sign     A-frame board 0.6 m wide, 0.9 m tall, front toward +Z. The front panel's outer face is
#            SignFace with UVs 0..1 on it (u to the right as seen from the front = +X, v up): the game
#            paints the words (「検問中」) with a CanvasTexture. Origin on the ground between the feet.
#   Lamp     a red warning lamp on a weighted stand, about 1.0 m (LampRed emissive, LampStand).
# No organisation's name or emblem anywhere.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import police_common as pc  # noqa: E402
from police_common import Mesh, log, material  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(pc.ROOT, "public", "models", "checkpoint.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None

# Where each node stands in the file (layout only).
LAYOUT = {
    "Cone": (1.4, 0.0, 0.0),
    "ConeBar": (0.0, 0.66, -0.9),
    "Baton": (0.65, 0.0, 0.0),
    "Sign": (-0.3, 0.0, 0.0),
    "Lamp": (-1.3, 0.0, 0.0),
}

pc.reset()
SCENE = bpy.context.scene

material("ConeRed", 0xD8261C, roughness=0.55)
material("ConeReflective", 0xF2F3F4, roughness=0.25, metallic=0.1)
material("ConeBase", 0x1A1B1D, roughness=0.85)
material("BarYellow", 0xF2C500, roughness=0.45)
material("BarBlack", 0x141516, roughness=0.5)
material("BatonLight", 0xC8141A, roughness=0.25, emissive=0xFF2020)
material("BatonGrip", 0x1A1B1D, roughness=0.7)
material("SignFace", 0xFFFFFF, roughness=0.6)
material("SignBack", 0xE9EAEB, roughness=0.6)
material("SignFrame", 0x2B2D31, metallic=0.4, roughness=0.45)
material("LampRed", 0xC8141A, roughness=0.2, emissive=0xFF2020)
material("LampStand", 0x1E2023, metallic=0.2, roughness=0.6)


def at(name):
    return Matrix.Translation(LAYOUT[name])


def shift(m, name):
    """Move a mesh built around the origin to its layout place (Mesh.obj takes world coordinates)."""
    bmesh.ops.translate(m.bm, verts=m.bm.verts, vec=Vector(LAYOUT[name]))


# ---------------------------------------------------------------------------- Cone

BANDS = ((0.28, 0.37), (0.45, 0.53))  # retro-reflective sleeves (m above the ground)


def cone_radius(y):
    return 0.135 - (y - 0.04) * (0.110 / 0.62)  # 0.135 m over the base to 0.025 m at the top


def build_cone():
    m = Mesh(["ConeRed", "ConeReflective", "ConeBase"])
    m.box((0.0, 0.02, 0.0), (0.38, 0.04, 0.38), "ConeBase")
    heights = [0.04, BANDS[0][0], BANDS[0][1], BANDS[1][0], BANDS[1][1], 0.66]
    reflective = {1, 3}  # ring intervals that are bands

    def mat_of(_theta, k):
        return "ConeReflective" if k in reflective else "ConeRed"

    spec = [(y, cone_radius(y), cone_radius(y), 0.0, 0.0) for y in heights]
    spec.append((0.70, 0.032, 0.032, 0.0, 0.0))  # rolled lip at the top
    m.loft(spec, 20, "ConeRed", mat_of=mat_of, cap_bottom=False, cap_top=True)
    shift(m, "Cone")
    return m.obj("Cone", None, at("Cone"), smooth=True)


# ---------------------------------------------------------------------------- ConeBar


def build_cone_bar():
    m = Mesh(["BarYellow", "BarBlack"])
    length, r, pieces = 1.8, 0.022, 12
    step = length / pieces
    for i in range(pieces):
        x0 = -length / 2 + i * step
        mat = "BarYellow" if i % 2 == 0 else "BarBlack"
        m.tube((x0, 0.0, 0.0), (x0 + step, 0.0, 0.0), r, r, mat, segs=10, caps=i in (0, pieces - 1))
    shift(m, "ConeBar")
    return m.obj("ConeBar", None, at("ConeBar"), smooth=True)


# ---------------------------------------------------------------------------- Baton


def build_baton():
    m = Mesh(["BatonGrip", "BatonLight"])
    m.tube((0.0, 0.0, 0.0), (0.0, 0.14, 0.0), 0.02, 0.021, "BatonGrip", segs=12)
    m.tube((0.0, 0.14, 0.0), (0.0, 0.16, 0.0), 0.024, 0.024, "BatonGrip", segs=12)  # collar
    m.tube((0.0, 0.16, 0.0), (0.0, 0.53, 0.0), 0.018, 0.018, "BatonLight", segs=12, caps=False)
    m.ellipsoid((0.0, 0.53, 0.0), (0.018, 0.02, 0.018), "BatonLight", segs=12, rows=4)
    shift(m, "Baton")
    return m.obj("Baton", None, at("Baton"), smooth=True)


# ---------------------------------------------------------------------------- Sign

SIGN_W, SIGN_H, FOOT_Z, TOP_Z, THICK = 0.60, 0.90, 0.18, 0.02, 0.018


def build_sign():
    """Two boards leaning on each other (the front one faces +Z), hinged at the top."""
    m = Mesh(["SignFace", "SignBack", "SignFrame"])
    slope = math.atan2(FOOT_Z - TOP_Z, SIGN_H)  # lean back from vertical
    height = SIGN_H * math.cos(slope)
    for side in (1, -1):
        normal = Vector((0.0, math.sin(slope), side * math.cos(slope)))
        bottom, top = Vector((0.0, 0.0, side * FOOT_Z)), Vector((0.0, height, side * TOP_Z))
        outer = [
            bottom + Vector((-SIGN_W / 2, 0, 0)),
            bottom + Vector((SIGN_W / 2, 0, 0)),
            top + Vector((SIGN_W / 2, 0, 0)),
            top + Vector((-SIGN_W / 2, 0, 0)),
        ]
        inner = [p - normal * THICK for p in outer]
        o = [m.bm.verts.new(p) for p in outer]
        i = [m.bm.verts.new(p) for p in inner]
        # Outer face: u along +X for the front board (as seen from its front), mirrored for the back.
        uvs = [(0, 0), (1, 0), (1, 1), (0, 1)] if side == 1 else [(1, 0), (0, 0), (0, 1), (1, 1)]
        m.face(o, "SignFace" if side == 1 else "SignBack", uvs=uvs, facing=normal)
        m.face(list(reversed(i)), "SignFrame", facing=-normal)
        for k in range(4):
            j = (k + 1) % 4
            mid = (outer[k] + outer[j]) / 2
            centre = sum(outer, Vector()) / 4
            m.face([o[k], o[j], i[j], i[k]], "SignFrame", facing=mid - centre)
    m.box((0.0, height + 0.005, 0.0), (SIGN_W + 0.02, 0.03, 0.06), "SignFrame")  # hinge rail
    shift(m, "Sign")
    return m.obj("Sign", None, at("Sign"), smooth=False)


# ---------------------------------------------------------------------------- Lamp


def build_lamp():
    m = Mesh(["LampStand", "LampRed"])
    m.loft([(0.0, 0.17, 0.17, 0.0, 0.0), (0.05, 0.16, 0.16, 0.0, 0.0)], 16, "LampStand")  # weighted base
    m.tube((0.0, 0.05, 0.0), (0.0, 0.88, 0.0), 0.016, 0.016, "LampStand", segs=10)
    m.tube((0.0, 0.88, 0.0), (0.0, 0.905, 0.0), 0.075, 0.075, "LampStand", segs=16)
    m.loft(
        [(0.905, 0.07, 0.07, 0.0, 0.0), (0.99, 0.068, 0.068, 0.0, 0.0), (1.02, 0.045, 0.045, 0.0, 0.0)],
        16,
        "LampRed",
        cap_bottom=False,
    )
    shift(m, "Lamp")
    return m.obj("Lamp", None, at("Lamp"), smooth=True)


nodes = [build_cone(), build_cone_bar(), build_baton(), build_sign(), build_lamp()]

pc.export_glb(OUT)
log(
    "exported",
    file=OUT,
    bytes=os.path.getsize(OUT),
    tris={o.name: pc.tris(o) for o in nodes},
    total=sum(pc.tris(o) for o in nodes),
)

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    cam = pc.preview_setup(lens=40, ground=4.0)
    pc.render(cam, os.path.join(PREVIEW, "checkpoint-front.png"), (0.3, 1.1, 3.6), (0.0, 0.45, -0.2))
    pc.render(cam, os.path.join(PREVIEW, "checkpoint-side.png"), (3.4, 1.0, 1.2), (0.0, 0.45, -0.2))
    pc.render(cam, os.path.join(PREVIEW, "checkpoint-back.png"), (-0.6, 1.3, -3.4), (0.0, 0.45, -0.2))
