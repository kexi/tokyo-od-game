# 白バイ (交通取締用自動二輪車, a large police motorcycle) and its 交通機動隊 rider for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/police_bike.py -- shirobai [public/models/police_shirobai.glb] [preview-dir]
#   ... --python scripts/blender/police_bike.py -- rider [public/models/police_rider.glb] [preview-dir]
#
# Game coordinates (+Y up, nose toward +Z, ground at y = 0, the rider's left = +X), exported with
# export_yup=False. "shirobai" is the motorcycle with the seated rider, "rider" the same officer
# standing (for a stop on foot), laid out exactly like human.glb.
#
# Motorcycle (root "PoliceShirobai", extras = dimensions, axles, steering axis), after the public
# figures of the 1,300 cc base model of the current 白バイ (2.22 m long, 1.515 m wheelbase, 25° caster,
# 99 mm trail, 120/70ZR17 and 180/55ZR17, seat 790 mm) plus the police fittings visible on Commons
# photos: half fairing and screen, front crash bars carrying the two red lamps with the siren and
# megaphone trumpets (left = megaphone, right = siren), white side boxes inside rear crash bars,
# the radio top box with its number on top, two antennas and the tall rear rotating beacon.
#   Body         frame-mounted parts, one mesh (fairing, screen and headlight are frame-mounted)
#   Steer        fork, handlebar, mirrors, front fender; its local +Y is the steering axis (25°
#                back), so steering = rotation about local Y
#     WheelFront origin at the front axle, axle along X (spin about local X, + = forward)
#   WheelRear    origin at the rear axle
#   Siren        empty at the right-hand trumpet (positional siren audio)
#   Rider        the officer, jointed like motorbike.glb's rider: Torso (pivot at the hips) → Head
#                (neck), UpperArmL/R (shoulders) → ForearmL/R (elbows); ThighL/R (hips) → ShinL/R
#                (knees). The parts are human.glb's skeleton (same lengths and pivots) posed on the
#                bike by node rotations; the angles are in Rider's extras (pose: about X, negative =
#                forward; poseZ: about Z, + = toward the rider's left).
# Beacon materials as ambulance.glb: BeaconL (+X lamp, left half of the rear dome) and BeaconR.
# Lamp materials keep car.glb's names. No real emblem or wordmark (generic gold shield, PATROL,
# made-up numbers; textures by agy, scripts/textures/police_vehicle_textures.py).
import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import police_common as pc  # noqa: E402
from police_common import Mesh, empty, log, material  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
VARIANT = ARGS[0] if ARGS else "shirobai"
if VARIANT not in ("shirobai", "rider"):
    raise SystemExit(f"unknown variant {VARIANT!r} (shirobai | rider)")
OUT = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else os.path.join(pc.ROOT, "public", "models", f"police_{VARIANT}.glb")
PREVIEW = os.path.abspath(ARGS[2]) if len(ARGS) > 2 else None
HUMAN_GLB = os.path.join(pc.ROOT, "public", "models", "human.glb")

# ---------------------------------------------------------------------------- skeleton (human.py)

SHOULDER = (0.235, 1.40)
HIP = (0.095, 0.86)
HEAD_C = 1.665
HEAD_R = (0.105, 0.125, 0.115)
ELBOW_DROP = 0.27
KNEE_DROP = 0.42
NECK_Y = 1.50  # Head pivot on the bike (human.glb's Head has its origin at the feet)
HAND = 0.315  # elbow → palm centre
ANKLE = (0.08, 0.02)  # (y, z) of the ankle when standing
PIVOTS = {
    "UpperArmL": (SHOULDER[0], SHOULDER[1], 0.0),
    "UpperArmR": (-SHOULDER[0], SHOULDER[1], 0.0),
    "ForearmL": (SHOULDER[0], SHOULDER[1] - ELBOW_DROP, 0.0),
    "ForearmR": (-SHOULDER[0], SHOULDER[1] - ELBOW_DROP, 0.0),
    "ThighL": (HIP[0], HIP[1], 0.0),
    "ThighR": (-HIP[0], HIP[1], 0.0),
    "ShinL": (HIP[0], HIP[1] - KNEE_DROP, 0.012),
    "ShinR": (-HIP[0], HIP[1] - KNEE_DROP, 0.012),
}


def check_skeleton():
    """The pivots must match the pedestrian model, or human.ts would bend the joints elsewhere."""
    if not os.path.exists(HUMAN_GLB):
        log("skeleton_unchecked", reason="human.glb missing")
        return
    with open(HUMAN_GLB, "rb") as f:
        data = f.read()
    length = struct.unpack("<I", data[12:16])[0]
    nodes = {n.get("name"): n for n in json.loads(data[20 : 20 + length])["nodes"]}
    bad = {}
    for name, pivot in PIVOTS.items():
        t = nodes.get(name, {}).get("translation", [0, 0, 0])
        if any(abs(a - b) > 1e-4 for a, b in zip(t, pivot, strict=True)):
            bad[name] = {"human": t, "rider": pivot}
    if bad:
        log("skeleton_mismatch", **bad)
        sys.exit(1)
    log("skeleton_ok", parts=len(PIVOTS))


check_skeleton()
pc.reset()
SCENE = bpy.context.scene

# ---------------------------------------------------------------------------- materials

# Rider (乗車服: blue riding jacket and breeches with the yellow side stripe, pale vest with
# reflective edging and a white belt in the jacket texture, white gloves, black boots, white
# open-face helmet with a raised shield).
material("Skin", tex="face.png", tex_dir=pc.HUMAN_TEX, tint=0xE6C2A4, roughness=0.6)
material("Jacket", 0x1F4FA0, tex="rider_jacket.png", roughness=0.8)
material("Breeches", 0x1F4FA0, tex="rider_breeches.png", roughness=0.8)
material("Gloves", 0xF4F4F0, roughness=0.7)
material("Boots", 0x0C0C0E, roughness=0.22, coat=0.6)
material("Helmet", 0xF3F3F1, roughness=0.18, coat=1.0)
material("HelmetLiner", 0x1A1B1E, roughness=0.9)
material("Shield", 0x5A6876, metallic=0.2, roughness=0.05, alpha=0.55)
material("Badge", 0xC9A23A, tex="patrol_badge.png", metallic=0.8, roughness=0.3, clip=True)
if VARIANT == "shirobai":
    material("PaintWhite", 0xF2F3F1, metallic=0.1, roughness=0.28, coat=0.8)
    material("Frame", 0x1E2024, metallic=0.5, roughness=0.4)
    material("Engine", 0x3A3D42, metallic=0.7, roughness=0.4)
    material("Steel", 0xC3C7CC, metallic=1.0, roughness=0.25)
    material("Chrome", 0xDDE1E6, metallic=1.0, roughness=0.12)
    material("Trim", 0x141518, roughness=0.6)
    material("Seat", 0x1A1B1E, roughness=0.8)
    material("Screen", 0x56636F, metallic=0.2, roughness=0.05, alpha=0.45)
    material("Plate", 0xFFFFFF, tex="shirobai_plate.png", roughness=0.45, clip=True)
    material("BoxSide", 0x111111, tex="shirobai_box_side.png", roughness=0.35, clip=True)
    material("BoxTop", 0x111111, tex="shirobai_box_top.png", roughness=0.35, clip=True)
    material("HeadLamp", 0xF4F6F8, roughness=0.1, emissive=0xFFF4DE)
    material("TailLamp", 0x8A0A0A, roughness=0.15, emissive=0xFF2A1A)
    material("IndicatorL", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
    material("IndicatorR", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
    for name in ("BeaconL", "BeaconR"):
        material(name, 0xD8141C, tex="red_lens.png", roughness=0.25, emissive=True)
    material("Tire", 0x18191B, roughness=0.9)
    material("WheelFace", 0xFFFFFF, tex="shirobai_wheel.png", metallic=0.5, roughness=0.4, clip=True)


# ---------------------------------------------------------------------------- rider meshes
# Built standing, in human.py's coordinates; each part is (mesh builder, pivot).


def torso_uv(theta, row, mid):
    # rider_jacket.png: front centre u = 0.25, the left side 0.5, back 0.75, the seam on the
    # right side (θ = 3π/2); faces past the seam take θ − 2π so no face wraps the texture.
    t = theta - 2 * math.pi if mid > 1.5 * math.pi else theta
    return (0.25 + t / (2 * math.pi), 0.125 + 0.875 * (TORSO[row][0] - TORSO[0][0]) / (TORSO[-1][0] - TORSO[0][0]))


SKIN_UV = (0.5, 0.92)
TORSO = [
    (0.84, 0.172, 0.112, 0, 0.0),
    (0.96, 0.168, 0.108, 0, 0.0),
    (1.06, 0.160, 0.104, 0, 0.006),
    (1.18, 0.178, 0.118, 0, 0.014),
    (1.30, 0.198, 0.122, 0, 0.012),
    (1.40, 0.208, 0.106, 0, 0.0),
    (1.47, 0.118, 0.082, 0, 0.0),
]


def build_torso():
    m = Mesh(["Jacket", "Skin"])
    m.loft(TORSO, 16, "Jacket", uv_of=torso_uv)
    m.loft(
        [(1.44, 0.074, 0.068, 0, 0.0), (1.50, 0.070, 0.064, 0, 0.0)],
        12,
        "Jacket",
        uv_of=lambda t, r, mid: (0.25 + 0.04 * math.sin(t), 0.99),
        cap_bottom=False,
        cap_top=False,
    )  # stand-up collar
    m.loft(
        [(1.44, 0.050, 0.047, 0, 0.0), (1.60, 0.046, 0.044, 0, 0.0)],
        10,
        "Skin",
        uv_of=lambda t, r, mid: SKIN_UV,
        cap_bottom=False,
        cap_top=False,
    )
    return m


def build_head():
    m = Mesh(["Skin", "Helmet", "HelmetLiner", "Shield", "Badge"])

    def head_uv(local, mid):
        if mid.z < -0.01:
            return SKIN_UV
        return (0.5 + 0.5 * local.x / HEAD_R[0], 0.5 + 0.5 * local.y / HEAD_R[1])

    m.ellipsoid((0.0, HEAD_C, 0.0), HEAD_R, "Skin", segs=16, rows=10, uv_of=head_uv)
    nose = [(-0.011, HEAD_C - 0.018, 0.108), (0.011, HEAD_C - 0.018, 0.108), (0.0, HEAD_C - 0.030, 0.121)]
    nose = [m.bm.verts.new(p) for p in [*nose, (0.0, HEAD_C + 0.008, 0.113)]]
    for tri in ((0, 1, 2), (1, 3, 2), (3, 0, 2)):
        m.face([nose[i] for i in tri], "Skin", uvs=[(0.5, 0.42)] * 3)
    # Open-face helmet: a shell round the skull, open from the brow down at the front and from the
    # jaw down at the sides; a dark liner shows inside the opening.
    hc = Vector((0.0, HEAD_C + 0.025, -0.008))
    hr = (0.138, 0.150, 0.152)

    def is_open(p):
        rel = p - hc
        is_face = rel.z > 0.02 and rel.y < 0.035
        is_neck = rel.y < -0.085 - 0.04 * max(0.0, -rel.z / hr[2])
        return is_face or is_neck

    for mat, scale, flip in (("Helmet", 1.0, False), ("HelmetLiner", 0.965, True)):
        faces = m.ellipsoid(tuple(hc), tuple(r * scale for r in hr), mat, segs=18, rows=10)
        for f in faces:
            if is_open(f.calc_center_median()):
                m.bm.faces.remove(f)
                continue
            # An open shell: orient every face by hand (outward, the liner inward).
            f.normal_update()
            is_outward = f.normal.dot(f.calc_center_median() - hc) > 0
            if is_outward == flip:
                f.normal_flip()
            f.tag = True
    for v in [v for v in m.bm.verts if not v.link_faces]:
        m.bm.verts.remove(v)
    # Raised shield over the brow, the badge above it, a chin strap.
    rows = []
    for y in (0.035, 0.075, 0.105):
        row = []
        for k in range(9):
            a = math.radians(-62 + 124 * k / 8)
            t = y / hr[1]
            sc = math.sqrt(max(0.0, 1 - t * t)) + 0.06
            row.append(m.bm.verts.new(tuple(hc + Vector((hr[0] * sc * math.sin(a), y, hr[2] * sc * math.cos(a))))))
        rows.append(row)
    for lo, hi in zip(rows, rows[1:], strict=False):
        for k in range(8):
            m.face([lo[k], lo[k + 1], hi[k + 1], hi[k]], "Shield", facing=(0, 0.3, 1))
    by = 0.118
    bz = hc.z + hr[2] * math.sqrt(1 - (by / hr[1]) ** 2) + 0.012
    s = 0.024
    m.face(
        [
            (-s, hc.y + by - s, bz),
            (s, hc.y + by - s, bz),
            (s, hc.y + by + s, bz - 0.012),
            (-s, hc.y + by + s, bz - 0.012),
        ],
        "Badge",
        uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
        facing=(0, 0.4, 1),
    )
    for sx in (1, -1):
        m.beam((sx * 0.112, HEAD_C - 0.045, 0.0), (sx * 0.05, HEAD_C - 0.115, 0.055), 0.012, "HelmetLiner")
    m.beam((0.05, HEAD_C - 0.115, 0.055), (-0.05, HEAD_C - 0.115, 0.055), 0.012, "HelmetLiner")
    return m


def build_arm(side):
    x0, y0 = side * SHOULDER[0], SHOULDER[1]
    ye = y0 - ELBOW_DROP
    top, wrist = y0 + 0.02, y0 - 0.52

    def ring_uv(rings):
        # rider_jacket.png's bottom band: plain fabric with the cuff at v = 0 (wrist).
        return lambda theta, row, mid: (theta / (2 * math.pi), 0.09 * (rings[row][0] - wrist) / (top - wrist))

    up = Mesh(["Jacket"])
    upper = [(top, 0.058, 0.056, x0, 0.0), (ye + 0.02, 0.050, 0.049, x0, 0.0), (ye - 0.02, 0.047, 0.046, x0, 0.0)]
    up.loft(upper, 10, "Jacket", uv_of=ring_uv(upper))
    up.ellipsoid(
        (x0 - side * 0.004, y0 - 0.005, 0.0),
        (0.062, 0.058, 0.060),
        "Jacket",
        segs=10,
        rows=5,
        uv_of=lambda p, mid: (0.5, 0.085),
    )
    lo = Mesh(["Jacket", "Gloves"])
    fore = [(ye + 0.01, 0.048, 0.047, x0, 0.0), (wrist + 0.03, 0.041, 0.040, x0, 0.0)]
    lo.loft(fore, 10, "Jacket", uv_of=ring_uv(fore), cap_top=False)
    lo.ellipsoid((x0, ye, 0.0), (0.049, 0.049, 0.048), "Jacket", segs=10, rows=4, uv_of=lambda p, mid: (0.5, 0.05))
    # White riding glove: flared gauntlet over the cuff, then the hand.
    lo.loft([(wrist + 0.05, 0.050, 0.049, x0, 0.0), (wrist - 0.03, 0.040, 0.044, x0, 0.0)], 10, "Gloves")
    lo.ellipsoid((x0, y0 - 0.585, 0.0), (0.032, 0.065, 0.046), "Gloves", segs=10, rows=5)
    return up, lo


def build_leg(side):
    x0, y0 = side * HIP[0], HIP[1]
    yk = y0 - KNEE_DROP
    top, hem = y0 + 0.02, y0 - 0.78

    def pants_uv(rings):
        # rider_breeches.png: u = 0.25 is the outer side (the stripe); mirrored on the right leg.
        def uv(theta, row, mid):
            u = theta / (2 * math.pi)
            return (u if side > 0 else 1.0 - u, (rings[row][0] - hem) / (top - hem))

        return uv

    th = Mesh(["Breeches"])
    thigh = [
        (top, 0.084, 0.090, x0, 0.0),
        (y0 - 0.16, 0.084, 0.088, x0 + side * 0.006, 0.006),  # riding breeches: full at the thigh
        (y0 - 0.30, 0.070, 0.072, x0, 0.008),
        (yk - 0.02, 0.058, 0.060, x0, 0.012),
    ]
    th.loft(thigh, 12, "Breeches", uv_of=pants_uv(thigh))
    sh = Mesh(["Breeches", "Boots"])
    v_knee = (yk - hem) / (top - hem)
    sh.ellipsoid(
        (x0, yk, 0.012), (0.060, 0.060, 0.062), "Breeches", segs=12, rows=4, uv_of=lambda p, mid: (0.6, v_knee)
    )
    # Long black riding boot from just under the knee to the foot.
    boot = [
        (yk - 0.03, 0.064, 0.068, x0, 0.016),
        (yk - 0.12, 0.060, 0.064, x0, 0.012),
        (y0 - 0.68, 0.050, 0.054, x0, 0.004),
        (0.10, 0.050, 0.056, x0, 0.004),
    ]
    sh.loft(boot, 12, "Boots", cap_bottom=False)
    sh.loft(
        [(0.0, 0.052, 0.066, x0, 0.03), (0.04, 0.055, 0.118, x0, 0.05), (0.085, 0.050, 0.095, x0, 0.025)],
        12,
        "Boots",
    )
    return th, sh


RIDER_PARTS = {}  # name -> (Mesh, standing pivot)
RIDER_PARTS["Torso"] = (build_torso(), (0.0, 0.0, 0.0))
RIDER_PARTS["Head"] = (build_head(), (0.0, 0.0, 0.0))
for s, tag in ((1, "L"), (-1, "R")):
    up_m, lo_m = build_arm(s)
    RIDER_PARTS[f"UpperArm{tag}"] = (up_m, PIVOTS[f"UpperArm{tag}"])
    RIDER_PARTS[f"Forearm{tag}"] = (lo_m, PIVOTS[f"Forearm{tag}"])
    th_m, sh_m = build_leg(s)
    RIDER_PARTS[f"Thigh{tag}"] = (th_m, PIVOTS[f"Thigh{tag}"])
    RIDER_PARTS[f"Shin{tag}"] = (sh_m, PIVOTS[f"Shin{tag}"])


def part_object(name, pivot, parent=None, location=None, rotation=(0.0, 0.0, 0.0)):
    """Object for a rider part with its origin at `pivot` (standing coordinates)."""
    m, _ = RIDER_PARTS[name]
    bmesh.ops.translate(m.bm, verts=m.bm.verts, vec=-Vector(pivot))
    ob = m.obj(name, smooth=True)
    if parent is not None:
        ob.parent = parent
    ob.location = location if location is not None else pivot
    ob.rotation_euler = rotation
    return ob


def solve(fk, target, guess, limits):
    """Damped least squares on the joint angles so that fk(angles) reaches target."""
    q = list(guess)
    target = Vector(target)
    for _ in range(80):
        err = target - fk(q)
        if err.length < 1e-5:
            break
        jac = []
        for i in range(len(q)):
            dq = list(q)
            dq[i] += 1e-4
            jac.append((fk(dq) - fk(q)) / 1e-4)
        # J is 3 × n; solve (JᵀJ + λI) Δ = Jᵀ e.
        n = len(q)
        jtj = [
            [sum(jac[i][k] * jac[j][k] for k in range(3)) + (0.002 if i == j else 0.0) for j in range(n)]
            for i in range(n)
        ]
        jte = [sum(jac[i][k] * err[k] for k in range(3)) for i in range(n)]
        delta = Matrix(jtj).inverted() @ Vector(jte)
        q = [min(max(q[i] + delta[i], limits[i][0]), limits[i][1]) for i in range(n)]
    return q, (target - fk(q)).length


# ---------------------------------------------------------------------------- variant: standing rider

if VARIANT == "rider":
    root = empty("ShirobaiRider")
    for name, (_, pivot) in list(RIDER_PARTS.items()):
        part_object(name, pivot, parent=root)
    root["height"] = round(HEAD_C + 0.175, 3)
    root["skeleton"] = "human.glb"  # same part names and pivots as the pedestrians
    pc.export_glb(OUT)
    log(
        "exported",
        file=OUT,
        bytes=os.path.getsize(OUT),
        tris={o.name: pc.tris(o) for o in SCENE.objects if o.type == "MESH"},
        total=sum(pc.tris(o) for o in SCENE.objects if o.type == "MESH"),
    )
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        cam = pc.preview_setup(lens=60, ground=5.0)
        for view, (eye, target) in {
            "front": ((1.0, 1.3, 3.6), (0.0, 0.95, 0.0)),
            "back": ((-1.2, 1.4, -3.4), (0.0, 1.0, 0.0)),
            "side": ((3.6, 1.1, 0.3), (0.0, 0.95, 0.0)),
            "face": ((0.25, 1.70, 0.85), (0.0, 1.66, 0.0)),
        }.items():
            pc.render(cam, os.path.join(PREVIEW, f"police-rider-{view}.png"), eye, target)
    raise SystemExit(0)

# ---------------------------------------------------------------------------- motorcycle

WIDTH = 0.93  # outside the rear crash bars
AXLE_F, AXLE_R = 0.805, -0.71  # 1.515 m wheelbase
R_F, W_F = 0.300, 0.120  # 120/70ZR17
R_R, W_R = 0.315, 0.180  # 180/55ZR17
RIM_R = 0.216
RAKE = math.radians(25)
TRAIL = 0.099
SEAT_Y = 0.79


def axis_z(y):
    """z of the steering axis at height y (it meets the ground TRAIL ahead of the contact patch)."""
    return AXLE_F + TRAIL - y * math.tan(RAKE)


root = empty("PoliceShirobai")
body = Mesh(
    [
        "PaintWhite",
        "Frame",
        "Engine",
        "Steel",
        "Chrome",
        "Trim",
        "Seat",
        "Screen",
        "Plate",
        "BoxSide",
        "BoxTop",
        "HeadLamp",
        "TailLamp",
        "IndicatorL",
        "IndicatorR",
        "BeaconL",
        "BeaconR",
    ]
)
# Frame: head tube, twin spars, cradle round the engine, seat rails, swingarm, twin shocks.
head_lo, head_hi = 0.70, 0.93
body.tube((0, head_lo, axis_z(head_lo)), (0, head_hi, axis_z(head_hi)), 0.045, 0.045, "Frame", segs=8)
PIVOT_Y, PIVOT_Z = 0.46, -0.24
for s in (1, -1):
    body.beam((s * 0.07, 0.90, axis_z(0.90) - 0.03), (s * 0.13, 0.80, 0.05), 0.05, "Frame")
    body.beam((s * 0.13, 0.80, 0.05), (s * 0.13, PIVOT_Y + 0.04, PIVOT_Z), 0.05, "Frame")
    body.beam((s * 0.06, 0.72, axis_z(0.72)), (s * 0.11, 0.20, 0.30), 0.04, "Frame")  # down tubes
    body.beam((s * 0.11, 0.20, 0.30), (s * 0.12, 0.17, -0.14), 0.04, "Frame")
    body.beam((s * 0.12, 0.17, -0.14), (s * 0.13, PIVOT_Y, PIVOT_Z), 0.04, "Frame")
    body.beam((s * 0.11, 0.78, -0.05), (s * 0.09, 0.84, -0.66), 0.03, "Frame")  # seat rails
    body.beam((s * 0.13, PIVOT_Y, PIVOT_Z), (s * 0.13, R_R, AXLE_R), 0.055, "Frame")  # swingarm
    body.tube((s * 0.13, R_R + 0.06, AXLE_R + 0.12), (s * 0.11, 0.80, -0.46), 0.03, 0.03, "Steel", segs=8)
    body.beam((s * 0.10, 0.33, -0.05), (s * 0.22, 0.33, -0.05), 0.03, "Trim")  # rider footpegs
# Engine: air/water-cooled inline four.
body.box((0.0, 0.31, 0.05), (0.46, 0.22, 0.42), "Engine")
body.box((0.0, 0.52, 0.17), (0.42, 0.24, 0.20), "Engine", rot=Matrix.Rotation(0.26, 3, "X"))
for k in range(4):
    body.box((0.0, 0.47 + 0.045 * k, 0.16 + 0.012 * k), (0.44, 0.012, 0.21), "Steel", rot=Matrix.Rotation(0.26, 3, "X"))
body.box((0.0, 0.67, 0.21), (0.40, 0.08, 0.19), "Steel", rot=Matrix.Rotation(0.26, 3, "X"))  # cylinder head
body.tube((0.23, 0.30, 0.02), (0.26, 0.30, 0.02), 0.11, 0.10, "Chrome", segs=14)  # side covers
body.tube((-0.23, 0.32, 0.08), (-0.26, 0.32, 0.08), 0.10, 0.09, "Chrome", segs=14)
body.box((0.0, 0.62, 0.40), (0.42, 0.30, 0.04), "Trim", rot=Matrix.Rotation(-0.15, 3, "X"))  # radiator
# Exhaust: four headers into one, a low muffler on the right (−X) under the side box.
for x in (0.15, 0.05, -0.05, -0.15):
    body.tube((x, 0.50, 0.29), (x, 0.24, 0.33), 0.022, 0.022, "Chrome", segs=6, caps=False)
    body.tube((x, 0.24, 0.33), (x * 0.4, 0.12, 0.10), 0.022, 0.024, "Chrome", segs=6, caps=False)
body.tube((0.0, 0.12, 0.10), (-0.16, 0.20, -0.22), 0.04, 0.04, "Chrome", segs=8, caps=False)
body.tube((-0.17, 0.21, -0.24), (-0.20, 0.33, -0.80), 0.065, 0.06, "Chrome", segs=12)
# Tank (white, black knee pads), seat, side covers, tail cowl, rear fender. The rounded shells are a
# separate smooth-shaded mesh joined into Body at the end.
shell = Mesh(["PaintWhite", "Seat", "HeadLamp"])
shell.loft_z(
    [
        (0.54, 0.10, 0.90, 1.00),
        (0.46, 0.17, 0.86, 1.08),
        (0.32, 0.205, 0.84, 1.12),
        (0.16, 0.195, 0.84, 1.10),
        (0.05, 0.15, 0.85, 1.02),
        (0.00, 0.10, 0.86, 0.95),
    ],
    "PaintWhite",
    segs=18,
)
for s in (1, -1):
    body.box((s * 0.185, 0.95, 0.20), (0.03, 0.10, 0.22), "Trim", rot=Matrix.Rotation(s * 0.25, 3, "Z"))
    body.box((s * 0.13, 0.70, -0.24), (0.04, 0.14, 0.30), "PaintWhite")  # side covers
shell.loft_z(
    [
        (0.05, 0.10, 0.80, 0.86),
        (-0.06, 0.155, 0.77, SEAT_Y + 0.005),
        (-0.26, 0.165, 0.77, SEAT_Y),
        (-0.42, 0.15, 0.79, 0.835),
        (-0.56, 0.13, 0.81, 0.875),
        (-0.64, 0.10, 0.83, 0.885),
        (-0.67, 0.06, 0.85, 0.875),
    ],
    "Seat",
    segs=18,
)
shell.loft_z(
    [(-0.40, 0.14, 0.68, 0.81), (-0.62, 0.12, 0.72, 0.85), (-0.80, 0.08, 0.76, 0.85), (-0.86, 0.04, 0.78, 0.83)],
    "PaintWhite",
    segs=18,
)
for k in range(5):  # rear fender strip over the tyre, inside the swingarm
    a0, a1 = math.radians(62 + 17 * k), math.radians(62 + 17 * (k + 1))
    rr = R_R + 0.04
    (z0, y0), (z1, y1) = [(AXLE_R + rr * math.cos(a), R_R + rr * math.sin(a)) for a in (a0, a1)]
    body.face(
        [(0.075, y0, z0), (-0.075, y0, z0), (-0.075, y1, z1), (0.075, y1, z1)],
        "PaintWhite",
        facing=(0, math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2)),
    )
# Half fairing (frame-mounted) with the headlight, front indicators, screen and meter.
shell.loft_z(
    [
        (0.845, 0.06, 0.90, 0.96),
        (0.825, 0.15, 0.85, 1.02),
        (0.77, 0.24, 0.80, 1.09),
        (0.67, 0.30, 0.78, 1.12),
        (0.58, 0.30, 0.80, 1.12),
        (0.53, 0.22, 0.86, 1.08),
    ],
    "PaintWhite",
    n=2.0,
    segs=22,
)
shell.loft_z([(0.79, 0.095, 0.885, 0.975), (0.858, 0.088, 0.89, 0.97)], "HeadLamp", n=2.6, segs=14)
for s, mat in ((1, "IndicatorL"), (-1, "IndicatorR")):
    body.box((s * 0.33, 0.86, 0.62), (0.03, 0.03, 0.07), mat)
screen = [(-0.21, 1.10, 0.72), (0.21, 1.10, 0.72), (0.18, 1.33, 0.60), (-0.18, 1.33, 0.60)]
body.face(screen, "Screen", facing=(0, 0.5, 1))
body.face(list(reversed(screen)), "Screen", facing=(0, -0.5, -1))  # seen from the saddle too
body.box((0.0, 1.10, 0.57), (0.26, 0.08, 0.08), "Trim", rot=Matrix.Rotation(0.6, 3, "X"))  # speed meter
# Front crash bars carrying the red lamps; the trumpets are the speaker housings (left megaphone,
# right siren).
for s, mat in ((1, "BeaconL"), (-1, "BeaconR")):
    pts = [(s * 0.10, 0.72, 0.36), (s * 0.36, 0.64, 0.40), (s * 0.39, 0.34, 0.33), (s * 0.13, 0.20, 0.12)]
    for p0, p1 in zip(pts, pts[1:], strict=False):
        body.tube(p0, p1, 0.016, 0.016, "Chrome", segs=8)
    c = Vector((s * 0.385, 0.66, 0.43))
    body.tube(c - Vector((0, 0, 0.09)), c, 0.05, 0.068, "PaintWhite", segs=14)  # trumpet
    body.tube(c, c + Vector((0, 0, 0.004)), 0.064, 0.064, "Trim", segs=14)
    body.ellipsoid(
        tuple(c + Vector((0, 0, 0.006))),
        (0.062, 0.062, 0.05),
        mat,
        segs=14,
        rows=6,
        uv_of=lambda p, mid: (0.5 + 0.42 * p.x / 0.062, 0.5 + 0.42 * p.y / 0.062),
    )
# Side boxes inside the rear crash bars, the radio top box with its number, two antennas and the
# tall rotating beacon (BeaconL / BeaconR halves).
BOX_X, BOX_Y, BOX_Z = (0.225, 0.43), (0.46, 0.82), (-0.88, -0.42)
for s in (1, -1):
    xc = s * (BOX_X[0] + BOX_X[1]) / 2
    body.box(
        (xc, sum(BOX_Y) / 2, sum(BOX_Z) / 2),
        (BOX_X[1] - BOX_X[0], BOX_Y[1] - BOX_Y[0], BOX_Z[1] - BOX_Z[0]),
        "PaintWhite",
    )
    body.box((xc, 0.765, sum(BOX_Z) / 2), (BOX_X[1] - BOX_X[0] + 0.012, 0.012, BOX_Z[1] - BOX_Z[0] + 0.012), "Chrome")
    xo = s * (BOX_X[1] + 0.003)
    z0, z1, y0, y1 = BOX_Z[1] - 0.04, BOX_Z[0] + 0.04, 0.50, 0.74
    if s > 0:  # seen from the left, u runs front → rear
        quad = [(xo, y0, z0), (xo, y0, z1), (xo, y1, z1), (xo, y1, z0)]
    else:  # seen from the right, rear → front
        quad = [(xo, y0, z1), (xo, y0, z0), (xo, y1, z0), (xo, y1, z1)]
    body.face(quad, "BoxSide", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], facing=(s, 0, 0))
    bar = [(s * 0.13, 0.80, -0.36), (s * 0.45, 0.80, -0.38), (s * 0.45, 0.43, -0.38), (s * 0.45, 0.43, -0.86)]
    bar += [(s * 0.24, 0.43, -0.90)]
    for p0, p1 in zip(bar, bar[1:], strict=False):
        body.tube(p0, p1, 0.014, 0.014, "Chrome", segs=8)
    body.tube((s * 0.45, 0.43, -0.38), (s * 0.13, 0.48, -0.30), 0.014, 0.014, "Chrome", segs=8)
body.box((0.0, 0.885, -0.76), (0.34, 0.02, 0.40), "Trim")  # carrier
TOP_Y = (0.895, 1.095)
TOP_Z = (-0.95, -0.60)
body.box((0.0, sum(TOP_Y) / 2, sum(TOP_Z) / 2), (0.36, TOP_Y[1] - TOP_Y[0], TOP_Z[1] - TOP_Z[0]), "PaintWhite")
yt = TOP_Y[1] + 0.003
# Readable from the left: image right → rear (−Z), image up → the bike's right (−X).
body.face(
    [(0.15, yt, -0.62), (0.15, yt, -0.93), (-0.15, yt, -0.93), (-0.15, yt, -0.62)],
    "BoxTop",
    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
    facing=(0, 1, 0),
)
body.tube((-0.15, yt, -0.93), (-0.16, yt + 0.80, -0.99), 0.006, 0.003, "Trim", segs=6)  # long antenna
body.tube((0.15, yt, -0.93), (0.15, yt + 0.30, -0.95), 0.006, 0.004, "Trim", segs=6)  # short antenna
pole_top = 1.40
body.tube((0.0, yt, -0.93), (0.0, pole_top, -0.93), 0.016, 0.014, "Steel", segs=8)
body.tube((0.0, pole_top, -0.93), (0.0, pole_top + 0.035, -0.93), 0.07, 0.07, "PaintWhite", segs=16)
dome = body.ellipsoid(
    (0.0, pole_top + 0.035, -0.93),
    (0.072, 0.11, 0.072),
    "BeaconL",
    segs=16,
    rows=8,
    uv_of=lambda p, mid: (0.5 + 0.42 * p.z / 0.072, 0.5 + 0.42 * p.y / 0.11),
)
for f in dome:
    if f.calc_center_median().y < pole_top + 0.035:
        body.bm.faces.remove(f)
    elif f.calc_center_median().x < 0:
        f.material_index = body.mat("BeaconR")
for v in [v for v in body.bm.verts if not v.link_faces]:
    body.bm.verts.remove(v)
# Tail lamp, rear indicators, plate (小型二輪, rear only) on a hugger.
body.box((0.0, 0.80, -0.865), (0.14, 0.05, 0.03), "TailLamp")
for s, mat in ((1, "IndicatorL"), (-1, "IndicatorR")):
    body.beam((s * 0.04, 0.72, -0.84), (s * 0.15, 0.72, -0.86), 0.015, "Trim")
    body.box((s * 0.16, 0.72, -0.865), (0.05, 0.035, 0.05), mat)
body.beam((0.0, 0.76, -0.80), (0.0, 0.62, -0.95), 0.05, "Trim")
tilt = math.radians(12)
plate_c = Vector((0.0, 0.58, -0.965))
pr = Matrix.Rotation(tilt, 3, "X")
pw, ph = 0.23, 0.125
corners = [
    plate_c + pr @ Vector((x, y, 0.0))
    for x, y in ((pw / 2, -ph / 2), (-pw / 2, -ph / 2), (-pw / 2, ph / 2), (pw / 2, ph / 2))
]
body.face(corners, "Plate", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], facing=(0, 0.2, -1))
body.box(tuple(plate_c + pr @ Vector((0, 0, 0.012))), (pw + 0.01, ph + 0.01, 0.012), "Trim", rot=pr)
body_ob = body.obj("Body", root)
shell_ob = shell.obj("Shell", root, smooth=True)
pc.mark_sharp(shell_ob, 55)
pc.join_into(body_ob, [shell_ob])
body_ob.name = "Body"
siren = empty("Siren", root, location=(-0.385, 0.66, 0.44))


# ---------------------------------------------------------------------------- wheels


def wheel(name, radius, width, disc_r, disc_sides, parent, location):
    """Rounded tyre, two cast-wheel faces (spokes are alpha) and brake discs; axle along X."""
    m = Mesh(["Tire", "WheelFace"])
    segs = 20
    hw = width / 2
    prof = [
        (-0.9 * hw, RIM_R),
        (-hw, RIM_R + 0.035),
        (-0.8 * hw, radius - 0.03),
        (0.0, radius),
        (0.8 * hw, radius - 0.03),
        (hw, RIM_R + 0.035),
        (0.9 * hw, RIM_R),
    ]
    grid = [
        [
            m.bm.verts.new((dx, rr * math.cos(2 * math.pi * k / segs), rr * math.sin(2 * math.pi * k / segs)))
            for dx, rr in prof
        ]
        for k in range(segs)
    ]
    for k in range(segs):
        j = (k + 1) % segs
        for i in range(len(prof) - 1):
            m.face([grid[k][i], grid[k][i + 1], grid[j][i + 1], grid[j][i]], "Tire")
        m.face([grid[k][-1], grid[k][0], grid[j][0], grid[j][-1]], "Tire")  # rim barrel
    bmesh.ops.recalc_face_normals(m.bm, faces=m.bm.faces)
    for f in m.bm.faces:
        f.tag = True

    def disc(x, r, u0, facing):
        pts, uvs = [], []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            pts.append((x, r * math.cos(a), r * math.sin(a)))
            uvs.append((u0 + 0.25 + 0.248 * math.sin(a) * -facing, 0.5 + 0.496 * math.cos(a)))
        m.face(pts, "WheelFace", uvs=uvs, facing=(facing, 0, 0))

    for sgn in (1, -1):  # spokes, seen from both sides
        disc(sgn * 0.012, RIM_R, 0.0, sgn)
        for ds in disc_sides:
            disc(ds * 0.06 + sgn * 0.002, disc_r, 0.5, sgn)
    bmesh.ops.translate(m.bm, verts=m.bm.verts, vec=location)  # obj() takes world coordinates
    return m.obj(name, parent, Matrix.Translation(location))


# ---------------------------------------------------------------------------- steering

STEER_C = Vector((0.0, 0.82, axis_z(0.82)))
STEER_M = Matrix.Translation(STEER_C) @ Matrix.Rotation(-RAKE, 4, "X")
steer = Mesh(["PaintWhite", "Steel", "Trim", "Frame", "Chrome"])
up = Vector((0.0, math.cos(RAKE), -math.sin(RAKE)))  # along the steering axis
axle_f = Vector((0.0, R_F, AXLE_F))
leg_top = axle_f + up * ((0.93 - R_F) / up.y)
for s in (1, -1):
    off = Vector((s * 0.10, 0, 0))
    steer.tube(axle_f + off + up * 0.02, axle_f + off + up * 0.32, 0.036, 0.036, "Trim", segs=8)  # lowers
    steer.tube(axle_f + off + up * 0.30, leg_top + off, 0.025, 0.025, "Steel", segs=8)  # stanchions
    steer.box((s * 0.085, R_F + 0.06, AXLE_F - 0.12), (0.035, 0.09, 0.08), "Trim")  # twin calipers
steer.box(tuple(leg_top), (0.28, 0.04, 0.09), "Frame", rot=Matrix.Rotation(-RAKE, 3, "X"))  # top clamp
steer.box(tuple(leg_top - up * 0.17), (0.26, 0.035, 0.08), "Frame", rot=Matrix.Rotation(-RAKE, 3, "X"))
bar_c = Vector((0.0, 1.03, leg_top.z - 0.03))
GRIP = Vector((0.355, 1.045, bar_c.z - 0.09))
for s in (1, -1):
    steer.beam(leg_top + Vector((s * 0.04, 0.0, 0.0)), bar_c + Vector((s * 0.05, -0.02, 0.0)), 0.03, "Trim")
    steer.beam(bar_c + Vector((s * 0.04, 0, 0)), Vector((s * 0.30, GRIP.y, GRIP.z + 0.01)), 0.024, "Trim")
    steer.tube((s * 0.29, GRIP.y, GRIP.z + 0.008), (s * 0.40, GRIP.y, GRIP.z - 0.002), 0.019, 0.019, "Trim", segs=6)
    steer.beam((s * 0.26, GRIP.y + 0.01, GRIP.z + 0.03), (s * 0.36, GRIP.y + 0.01, GRIP.z + 0.07), 0.012, "Steel")
    steer.beam((s * 0.24, GRIP.y, GRIP.z + 0.01), (s * 0.30, GRIP.y + 0.16, GRIP.z + 0.02), 0.012, "Trim")
    steer.box((s * 0.31, GRIP.y + 0.18, GRIP.z + 0.02), (0.12, 0.07, 0.025), "Trim")  # mirrors
for k in range(6):  # front fender
    a0, a1 = math.radians(20 + 22 * k), math.radians(20 + 22 * (k + 1))
    rr = R_F + 0.035
    (z0, y0), (z1, y1) = [(AXLE_F + rr * math.cos(a), R_F + rr * math.sin(a)) for a in (a0, a1)]
    steer.face(
        [(0.07, y0, z0), (-0.07, y0, z0), (-0.07, y1, z1), (0.07, y1, z1)],
        "PaintWhite",
        facing=(0, math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2)),
    )
steer_ob = steer.obj("Steer", root, STEER_M)
front = wheel("WheelFront", R_F, W_F, 0.155, (1, -1), steer_ob, axle_f)
rear = wheel("WheelRear", R_R, W_R, 0.12, (-1,), root, Vector((0.0, R_R, AXLE_R)))

# ---------------------------------------------------------------------------- rider on the bike

rider = empty("Rider", root)
HIP_C = Vector((0.0, 0.875, -0.17))  # hips on the saddle (seat 0.79 m)
LEAN = math.radians(18)  # upright touring posture
PEG = Vector((0.21, 0.33, -0.05))
torso_rot = Matrix.Rotation(LEAN, 3, "X")
torso = part_object("Torso", (0.0, HIP[1], 0.0), rider, tuple(HIP_C), (LEAN, 0.0, 0.0))
head = part_object("Head", (0.0, NECK_Y, 0.0), torso, (0.0, NECK_Y - HIP[1], 0.0), (-LEAN + math.radians(6), 0, 0))
pose, pose_z, misses = {}, {}, {}
for s, tag in ((1, "L"), (-1, "R")):
    # Arms in the torso frame: shoulder → elbow → palm on the grip.
    sh = Vector((s * SHOULDER[0], SHOULDER[1] - HIP[1], 0.0))
    grip_t = torso_rot.inverted() @ (Vector((s * GRIP.x, GRIP.y, GRIP.z)) - HIP_C)

    def hand(q, sh=sh):
        ru = Euler((q[0], 0.0, q[1])).to_matrix()
        rf = Euler((q[2], 0.0, 0.0)).to_matrix()
        return sh + ru @ Vector((0, -ELBOW_DROP, 0)) + ru @ rf @ Vector((0, -HAND, 0))

    lim = [(-2.5, 0.5), (0.0, 1.0) if s > 0 else (-1.0, 0.0), (-2.2, 0.0)]  # elbows bend forward only
    q, miss = solve(hand, grip_t, (-0.9, s * 0.2, -0.6), lim)
    ua = part_object(f"UpperArm{tag}", PIVOTS[f"UpperArm{tag}"], torso, tuple(sh), (q[0], 0.0, q[1]))
    part_object(f"Forearm{tag}", PIVOTS[f"Forearm{tag}"], ua, (0.0, -ELBOW_DROP, 0.0), (q[2], 0.0, 0.0))
    pose[f"UpperArm{tag}"], pose_z[f"UpperArm{tag}"], pose[f"Forearm{tag}"] = q
    misses[f"Arm{tag}"] = round(miss, 4)
    # Legs in the rider frame: hip → knee → ankle above the footpeg, knees out round the tank.
    hp = Vector((s * HIP[0], HIP_C.y, HIP_C.z))
    ankle_t = Vector((s * PEG.x, PEG.y + 0.075, PEG.z - 0.035))

    def ankle(q, hp=hp):
        rt = Euler((q[0], 0.0, q[1])).to_matrix()
        rs = Euler((q[2], 0.0, 0.0)).to_matrix()
        knee = Vector((0, -KNEE_DROP, 0.012))
        return hp + rt @ knee + rt @ rs @ Vector((0, ANKLE[0] - (HIP[1] - KNEE_DROP), ANKLE[1] - 0.012))

    lim = [(-2.0, 0.3), (0.0, 0.6) if s > 0 else (-0.6, 0.0), (0.0, 2.6)]
    q, miss = solve(ankle, ankle_t, (-1.3, s * 0.2, 1.6), lim)
    th = part_object(f"Thigh{tag}", PIVOTS[f"Thigh{tag}"], rider, tuple(hp), (q[0], 0.0, q[1]))
    part_object(f"Shin{tag}", PIVOTS[f"Shin{tag}"], th, (0.0, -KNEE_DROP, 0.012), (q[2], 0.0, 0.0))
    pose[f"Thigh{tag}"], pose_z[f"Thigh{tag}"], pose[f"Shin{tag}"] = q
    misses[f"Leg{tag}"] = round(miss, 4)
pose["Torso"] = LEAN
pose["Head"] = -LEAN + math.radians(6)
rider["pose"] = json.dumps({k: round(v, 4) for k, v in pose.items()})
rider["poseZ"] = json.dumps({k: round(v, 4) for k, v in pose_z.items()})
rider["poseEuler"] = "XYZ (Blender) = ZYX in three.js"  # the X bend is applied before the Z splay
log("rider_ik", miss_m=misses)

# Origin at the middle of the overall length (tyre front to the rear hugger), as motorbike.glb.
bpy.context.view_layer.update()
zs = [
    (o.matrix_world @ v.co).z
    for o in root.children_recursive
    if o.type == "MESH" and not o.name.startswith(("Torso", "Head", "UpperArm", "Forearm", "Thigh", "Shin"))
    for v in o.data.vertices
]
SHIFT = (max(zs) + min(zs)) / 2
for o in root.children:
    o.location.z -= SHIFT
root["length"] = round(max(zs) - min(zs), 3)
root["width"] = WIDTH
root["height"] = round(pole_top + 0.035 + 0.11, 3)  # top of the rear beacon (antennas excluded)
root["wheelbase"] = round(AXLE_F - AXLE_R, 4)
root["frontAxleZ"] = round(AXLE_F - SHIFT, 4)
root["rearAxleZ"] = round(AXLE_R - SHIFT, 4)
root["wheelRadiusFront"] = R_F
root["wheelRadiusRear"] = R_R
root["steerAxisTilt"] = round(RAKE, 6)  # Steer's local +Y leans back by this much from vertical
root["seatHeight"] = SEAT_Y

pc.export_glb(OUT)
log(
    "exported",
    file=OUT,
    bytes=os.path.getsize(OUT),
    tris={o.name: pc.tris(o) for o in SCENE.objects if o.type == "MESH"},
    total=sum(pc.tris(o) for o in SCENE.objects if o.type == "MESH"),
    pose={k: round(v, 3) for k, v in pose.items()},
)

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    cam = pc.preview_setup(lens=50, ground=6.0)
    rider_parts = [rider, *rider.children_recursive]
    views = {
        "front-left": ((3.4, 1.7, 3.9), (0.0, 0.85, 0.1), True),
        "rear-right": ((-3.4, 1.8, -3.9), (0.0, 0.9, -0.1), True),
        "left": ((5.4, 1.0, 0.0), (0.0, 0.85, 0.0), True),
        "right": ((-5.4, 1.0, 0.0), (0.0, 0.85, 0.0), True),
        "front": ((0.0, 1.1, 5.2), (0.0, 0.85, 0.0), True),
        "rear": ((0.0, 1.2, -5.2), (0.0, 0.85, 0.0), True),
        "bike-left": ((3.6, 1.2, 0.4), (0.0, 0.7, 0.0), False),
        "top": ((1.8, 3.8, -1.6), (0.0, 0.9, -0.3), False),
    }
    for view, (eye, target, with_rider) in views.items():
        for o in rider_parts:
            o.hide_render = not with_rider
        pc.render(cam, os.path.join(PREVIEW, f"police-shirobai-{view}.png"), eye, target)
