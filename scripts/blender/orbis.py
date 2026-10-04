# 速度違反自動取締装置 (オービス) and its 予告看板 for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/orbis.py -- public/models/orbis.glb [preview-dir]
#
# Modelled on the ループコイル式 units Tokyo's arterials carry (柱上型オービスIII, called the
# LH システム): a galvanised gantry from a kerb pole over the lanes of one direction, a walkway with
# handrails on the lower chord, and per lane a camera housing with a strobe beside it, both
# facing the oncoming traffic. Narrow roads get a single pole with the same unit on a short arm.
# No maker's name or police emblem is drawn on any part.
#
# Game coordinates: +Y up, the cameras and the sign face look toward +Z (at the traffic coming),
# +X runs from the kerb pole across the carriageway (the driver's right as they approach), ground
# at y = 0. Exported with export_yup=False. Nodes under the root `Orbis` (extras = dimensions):
# - GantryPole: 7.1 m kerb pole with base plate, chord clamps and the control cabinet at its foot
#   (origin: ground at the pole axis).
# - GantryBeam: the span, UNIT LENGTH along +X (x 0 → 1; the game stretches it across the road):
#   lower chord, upper chord, walkway deck and handrails. Origin: lower-chord axis at the pole.
#   Place it at y = extras.beamY on the pole.
# - GantryPost: one vertical frame (chord tie, handrail posts, deck cross-bar) at x = 0 in beam
#   coordinates; the game repeats it every extras.postSpacing and at the end, unstretched.
# - LaneUnit: the camera housing (with sun hood and dark window, tilted 12° down to the photo
#   point) and the strobe housing beside it, on a stand. Origin: deck top at the lane centre.
#   One per lane at y = extras.beamY + extras.deckTop.
# - StrobeLens: the strobe's flash window, in LaneUnit's local coordinates (same matrix); material
#   `Strobe`. The game lights it per lane with its own unlit material when the camera fires.
# - PolePost: narrow-road pole (5.0 m) with an arm toward +X and a platform for one LaneUnit at
#   extras.poleUnit [x, y, z], and a small cabinet on the pole.
# - WarningSign: pole, arm toward +X and the 1.8 × 0.9 m blue board (face `SignFace`, artwork
#   assets/orbis/textures/warning_route.png by scripts/textures/orbis_textures.py).
import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import police_common as pc  # noqa: E402
from police_common import Mesh, empty, log, material  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(pc.ROOT, "public", "models", "orbis.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
TEX = os.path.join(pc.ROOT, "assets", "orbis", "textures")

# Gantry (sizes judged from photographs of 柱上型オービスIII on Commons; see knowledge/orbis.md).
POLE_H = 7.1
POLE_R0, POLE_R1 = 0.2, 0.16  # base and top radius
BEAM_Y = 5.6  # lower chord axis above the ground (4.5 m 建築限界 + the units' underside margin)
CHORD_GAP = 0.95  # lower → upper chord
CHORD_R = 0.0825  # 165 mm pipe
UPPER_R = 0.07
DECK_W = 0.7  # walkway width (z)
DECK_T = 0.03
DECK_TOP = CHORD_R + DECK_T  # deck top above the lower chord axis
RAIL_H = 1.1  # handrail above the deck
POST_SPACING = 2.0

# Camera and strobe housings.
CAM_W, CAM_H, CAM_D = 0.50, 0.42, 0.62
STROBE_W, STROBE_H, STROBE_D = 0.34, 0.34, 0.40
STAND_H = 0.22
TILT = math.radians(12)

# Narrow-road pole.
PPOLE_H = 5.0
PPOLE_R = 0.095
P_ARM_Y = 4.72
P_ARM_L = 1.45

# 予告看板.
BOARD_W, BOARD_H = 1.8, 0.9
SIGN_POLE_H = 6.1
SIGN_ARM_Y = 5.95
SIGN_ARM_L = 2.5
BOARD_X = 1.6  # board centre from the pole
BOARD_Y = SIGN_ARM_Y - 0.1 - BOARD_H / 2

pc.reset()
material("Galvanized", 0xA9AFB4, metallic=0.55, roughness=0.42)
material("Grating", 0x737980, metallic=0.5, roughness=0.7)
material("Housing", 0xDDDBD3, roughness=0.45)
material("HousingDark", 0x2B2F34, roughness=0.6)
material("CameraGlass", 0x0D1115, metallic=0.2, roughness=0.08)
# Resting strobe window: dark red behind clear glass. The game swaps in a lit material.
material("Strobe", 0x5C1A1A, roughness=0.25)
material("SignFace", 0x164AA0, roughness=0.4, tex="warning_route.png", tex_dir=TEX)
material("SignBack", 0x8C9196, metallic=0.4, roughness=0.5)

root = empty("Orbis")


def finish(m, name, smooth=False):
    ob = m.obj(name, smooth=smooth)
    ob.parent = root
    pc.mark_sharp(ob, 40)
    return ob


def rx(angle):
    return Matrix.Rotation(angle, 3, "X")


# ---------------------------------------------------------------------------- gantry pole
m = Mesh(["Galvanized"])
m.tube((0, 0, 0), (0, POLE_H, 0), POLE_R0, POLE_R1, "Galvanized", segs=16)
m.box((0, 0.015, 0), (0.62, 0.03, 0.62), "Galvanized")  # base plate on the foundation
for y in (BEAM_Y, BEAM_Y + CHORD_GAP):
    # Flange clamp where each chord meets the pole.
    m.box((0.12, y, 0), (0.24, 0.32, 0.36), "Galvanized")
# Cable conduit down the back of the pole to the cabinet.
m.tube((-0.19, 0.4, 0), (-0.19, BEAM_Y, 0), 0.03, 0.03, "Galvanized", segs=8)
# Control cabinet (制御器) at the foot, on the pavement side.
m.box((-0.62, 0.15, 0), (0.62, 0.3, 0.5), "Galvanized")
m.box((-0.62, 0.3 + 0.65, 0), (0.56, 1.3, 0.44), "Housing")
m.box((-0.62, 1.63, 0), (0.62, 0.06, 0.5), "Housing")  # rain cap
finish(m, "GantryPole", smooth=False)

# ---------------------------------------------------------------------------- gantry beam (unit length)
m = Mesh(["Galvanized", "Grating"])
m.tube((0, 0, 0), (1, 0, 0), CHORD_R, CHORD_R, "Galvanized", segs=12)
m.tube((0, CHORD_GAP, -0.18), (1, CHORD_GAP, -0.18), UPPER_R, UPPER_R, "Galvanized", segs=10)
# Walkway grating on the lower chord.
m.box((0.5, CHORD_R + DECK_T / 2, 0), (1.0, DECK_T, DECK_W), "Grating")
# Handrails (top and knee) front and back, and a toe board along the front edge.
for z in (DECK_W / 2 - 0.02, -(DECK_W / 2 - 0.02)):
    for y in (DECK_TOP + RAIL_H, DECK_TOP + 0.5):
        m.tube((0, y, z), (1, y, z), 0.024, 0.024, "Galvanized", segs=6)
m.box((0.5, DECK_TOP + 0.05, DECK_W / 2 - 0.01), (1.0, 0.1, 0.008), "Galvanized")
finish(m, "GantryBeam", smooth=True)

# ---------------------------------------------------------------------------- gantry post (repeated)
m = Mesh(["Galvanized"])
# Tie between the chords, at the back.
m.tube((0, 0, -0.1), (0, CHORD_GAP, -0.18), 0.045, 0.045, "Galvanized", segs=8)
# Handrail posts, front and back.
for z in (DECK_W / 2 - 0.02, -(DECK_W / 2 - 0.02)):
    m.tube((0, DECK_TOP, z), (0, DECK_TOP + RAIL_H + 0.02, z), 0.025, 0.025, "Galvanized", segs=6)
# Cross-bar under the deck.
m.box((0, CHORD_R - 0.02, 0), (0.08, 0.06, DECK_W + 0.04), "Galvanized")
finish(m, "GantryPost", smooth=True)


# ---------------------------------------------------------------------------- lane unit
def lane_unit(m, strobe_lens):
    """Camera (x −0.27) and strobe (x +0.30) on a stand; strobe_lens gets the flash window."""
    cx, sx = -0.27, 0.30
    # Stand: a plate on the deck and two legs.
    m.box((0.0, 0.015, 0.0), (1.05, 0.03, 0.5), "Galvanized")
    for x in (cx, sx):
        m.box((x, STAND_H / 2, 0.0), (0.12, STAND_H, 0.12), "Galvanized")
    # Camera housing, tilted toward the photo point up the road.
    pivot = Vector((cx, STAND_H + CAM_H / 2, 0.0))
    r = rx(TILT)

    def at(p):
        return pivot + r @ Vector(p)

    m.box(pivot, (CAM_W, CAM_H, CAM_D), "Housing", rot=r)
    # Sun hood over the front, open below.
    hood = [
        ((-CAM_W / 2 - 0.02, CAM_H / 2 + 0.02, CAM_D / 2), (CAM_W / 2 + 0.02, CAM_H / 2 + 0.02, CAM_D / 2 + 0.16)),
    ]
    for (x0, y0, z0), (x1, _, z1) in hood:
        m.face(
            [at((x0, y0, z0)), at((x1, y0, z0)), at((x1, y0, z1)), at((x0, y0, z1))],
            "Housing",
            facing=r @ Vector((0, 1, 0)),
        )
        m.face(
            [at((x0, y0, z0)), at((x0, y0, z1)), at((x1, y0, z1)), at((x1, y0, z0))],
            "HousingDark",
            facing=r @ Vector((0, -1, 0)),
        )
        for x in (x0, x1):
            side = [at((x, y0, z0)), at((x, y0, z1)), at((x, y0 - 0.2, z1)), at((x, y0 - 0.32, z0))]
            m.face(side, "Housing", facing=r @ Vector((math.copysign(1, x), 0, 0)))
            m.face(list(reversed(side)), "HousingDark", facing=r @ Vector((-math.copysign(1, x), 0, 0)))
    # Dark window with a bezel.
    zf = CAM_D / 2 + 0.003
    m.face(
        [at((-0.17, -0.12, zf)), at((0.17, -0.12, zf)), at((0.17, 0.14, zf)), at((-0.17, 0.14, zf))],
        "CameraGlass",
        facing=r @ Vector((0, 0, 1)),
    )
    # Strobe housing (level), and its window as a separate mesh in the same frame.
    sy = STAND_H + STROBE_H / 2
    m.box((sx, sy, -0.03), (STROBE_W, STROBE_H, STROBE_D), "Housing")
    m.box((sx, sy + STROBE_H / 2 + 0.015, 0.02), (STROBE_W + 0.04, 0.03, STROBE_D + 0.1), "Housing")  # rain cap
    zs = -0.03 + STROBE_D / 2
    m.box((sx, sy, zs + 0.01), (STROBE_W - 0.02, STROBE_H - 0.02, 0.02), "HousingDark")  # bezel
    strobe_lens.face(
        [
            (sx - 0.13, sy - 0.13, zs + 0.022),
            (sx + 0.13, sy - 0.13, zs + 0.022),
            (sx + 0.13, sy + 0.13, zs + 0.022),
            (sx - 0.13, sy + 0.13, zs + 0.022),
        ],
        "Strobe",
        uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
        facing=(0, 0, 1),
    )


m = Mesh(["Housing", "HousingDark", "CameraGlass", "Galvanized"])
lens = Mesh(["Strobe"])
lane_unit(m, lens)
finish(m, "LaneUnit")
lens_ob = lens.obj("StrobeLens")
lens_ob.parent = root

# ---------------------------------------------------------------------------- narrow-road pole
POLE_UNIT = (P_ARM_L - 0.3, P_ARM_Y + 0.06, 0.0)
m = Mesh(["Galvanized", "Housing"])
m.tube((0, 0, 0), (0, PPOLE_H, 0), PPOLE_R, PPOLE_R * 0.85, "Galvanized", segs=14)
m.box((0, 0.012, 0), (0.42, 0.024, 0.42), "Galvanized")
m.tube((0, P_ARM_Y, 0), (P_ARM_L, P_ARM_Y, 0), 0.06, 0.06, "Galvanized", segs=10)
m.tube((0, P_ARM_Y - 0.55, 0), (0.7, P_ARM_Y - 0.02, 0), 0.03, 0.03, "Galvanized", segs=6)  # brace
m.box((P_ARM_L - 0.3, P_ARM_Y + 0.045, 0), (1.15, 0.03, 0.55), "Galvanized")  # platform for the unit
m.box((-0.2, 1.35, 0), (0.24, 0.6, 0.4), "Housing")  # control box on the pole
finish(m, "PolePost", smooth=True)

# ---------------------------------------------------------------------------- 予告看板
m = Mesh(["Galvanized", "SignBack", "SignFace"])
m.tube((0, 0, 0), (0, SIGN_POLE_H, 0), 0.08, 0.07, "Galvanized", segs=12)
m.box((0, 0.012, 0), (0.36, 0.024, 0.36), "Galvanized")
m.tube((0, SIGN_ARM_Y, -0.06), (SIGN_ARM_L, SIGN_ARM_Y, -0.06), 0.045, 0.045, "Galvanized", segs=8)
for x in (BOARD_X - 0.6, BOARD_X + 0.6):
    m.box((x, SIGN_ARM_Y - 0.06, -0.04), (0.08, 0.2, 0.06), "Galvanized")  # clamps
# Board: aluminium plate with the face on +Z and the grey back on −Z.
x0, x1 = BOARD_X - BOARD_W / 2, BOARD_X + BOARD_W / 2
y0, y1 = BOARD_Y - BOARD_H / 2, BOARD_Y + BOARD_H / 2
zf, zb = 0.012, -0.012
# Blender UVs run up the image (the glTF exporter flips v), so the board's top edge is v = 1.
m.face(
    [(x0, y0, zf), (x1, y0, zf), (x1, y1, zf), (x0, y1, zf)],
    "SignFace",
    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
    facing=(0, 0, 1),
)
m.face([(x0, y0, zb), (x0, y1, zb), (x1, y1, zb), (x1, y0, zb)], "SignBack", facing=(0, 0, -1))
for a, b, n in (
    ((x0, y0), (x1, y0), (0, -1, 0)),
    ((x1, y0), (x1, y1), (1, 0, 0)),
    ((x1, y1), (x0, y1), (0, 1, 0)),
    ((x0, y1), (x0, y0), (-1, 0, 0)),
):
    m.face([(a[0], a[1], zb), (b[0], b[1], zb), (b[0], b[1], zf), (a[0], a[1], zf)], "SignBack", facing=n)
finish(m, "WarningSign")

# ---------------------------------------------------------------------------- extras & export
root["beamY"] = BEAM_Y
root["deckTop"] = round(DECK_TOP, 4)
root["chordGap"] = CHORD_GAP
root["poleHeight"] = POLE_H
root["postSpacing"] = POST_SPACING
root["poleUnit"] = [round(v, 4) for v in POLE_UNIT]
root["board"] = [BOARD_W, BOARD_H]
root["boardCentre"] = [BOARD_X, round(BOARD_Y, 4), 0.012]
root["cameraTilt"] = round(math.degrees(TILT), 1)

tris = {o.name: pc.tris(o) for o in pc.scene().objects if o.type == "MESH"}
pc.export_glb(OUT)
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris, total=sum(tris.values()))

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    cam = pc.preview_setup(lens=40, ground=30.0)
    objs = {o.name: o for o in pc.scene().objects}

    def copy(name, matrix):
        src = objs[name]
        c = src.copy()
        c.data = src.data
        c.parent = None
        pc.scene().collection.objects.link(c)
        c.matrix_world = matrix
        return c

    # A three-lane gantry: pole at x 0, lanes centred 1.6 + 3.25 k across, posts every 2 m.
    span = 11.0
    beam = objs["GantryBeam"]
    beam.parent = None
    beam.matrix_world = Matrix.Translation((0, BEAM_Y, 0)) @ Matrix.Diagonal((span, 1, 1, 1))
    objs["GantryPole"].parent = None
    posts = [0.25 + POST_SPACING * k for k in range(int(span / POST_SPACING) + 1)] + [span - 0.02]
    for x in posts:
        copy("GantryPost", Matrix.Translation((x, BEAM_Y, 0)))
    lit = material("StrobeLit", 0xFF4A3A, emissive=0xFF5A44)
    lit.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 40.0
    for k in range(3):
        x = 2.4 + 3.25 * k
        copy("LaneUnit", Matrix.Translation((x, BEAM_Y + DECK_TOP, 0)))
        lens_copy = copy("StrobeLens", Matrix.Translation((x, BEAM_Y + DECK_TOP, 0)))
        if k == 1:
            lens_copy.data = lens_copy.data.copy()
            lens_copy.data.materials[0] = lit
    # The narrow-road pole and a sign further along.
    objs["PolePost"].parent = None
    objs["PolePost"].matrix_world = Matrix.Translation((-6.0, 0, -9.0))
    copy("LaneUnit", Matrix.Translation((-6.0 + POLE_UNIT[0], POLE_UNIT[1], -9.0)))
    copy("StrobeLens", Matrix.Translation((-6.0 + POLE_UNIT[0], POLE_UNIT[1], -9.0)))
    # The originals stay at the origin; copies made before this keep rendering.
    objs["LaneUnit"].hide_render = True
    objs["StrobeLens"].hide_render = True
    objs["GantryPost"].hide_render = True
    objs["WarningSign"].parent = None
    objs["WarningSign"].matrix_world = Matrix.Translation((-14.0, 0, -4.0))
    for view, (eye, target) in {
        "gantry": ((9.0, 3.0, 22.0), (5.0, 5.4, 0.0)),
        "units": ((5.5, 5.9, 4.5), (5.5, 5.8, 0.0)),
        "pole": ((-3.0, 2.5, 2.0), (-5.0, 3.6, -9.0)),
        "sign": ((-12.5, 3.0, 8.0), (-12.4, 5.2, -4.0)),
    }.items():
        pc.render(cam, os.path.join(PREVIEW, f"orbis-{view}.png"), eye, target)
