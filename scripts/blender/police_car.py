# Japanese police cars for TOKYO OPEN DRIVE: the 白黒パトカー (無線警ら車) and the 覆面パトカー
# (交通取締用四輪車, unmarked with a hidden 反転式 beacon), on one mid-size RWD sedan body.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/police_car.py -- patrol [public/models/police_patrol.glb] [preview-dir]
#   ... --python scripts/blender/police_car.py -- unmarked [public/models/police_unmarked.glb] [preview-dir]
#
# Game coordinates (+Y up, nose toward +Z, ground at y = 0, the car's left = +X), exported with
# export_yup=False; the origin is the middle of the overall length (as ambulance.glb). The body is
# 4.91 × 1.80 × 1.455 m on a 2.92 m wheelbase with 215/55R17 tyres: the published size of the
# current patrol-car base sedan (knowledge/police-vehicles-blender.md); the light bar adds ~0.2 m.
#
# Nodes under the root (PolicePatrol / PoliceUnmarked, extras = dimensions and axles):
#   Body        everything fixed, one mesh. Patrol livery per the 警察庁 guideline (白黒, red lamps
#               and loudspeaker on the roof and the front): PaintWhite above a line that runs from
#               the headlamps down to mid-door and up to the rear bumper, PaintBlack below it, a
#               black nose on the bonnet, PATROL lettering, roof number. Unmarked: one Paint.
#   WheelFL/FR/RL/RR  origin at the hub, axle along local X, right wheels mirrored in the mesh
#               (no negative scale), so every wheel spins forward with +rotation.x.
#   LightBar    (patrol) red light bar with the loudspeaker in its centre; origin on the roof pod.
#               昇降式: translate it +Y by extras.lightBarLift (its mast is modelled below it and
#               hides inside the pod and the cabin while lowered). Child empty "Siren".
#   HiddenBeacon  (unmarked) 反転式 red beacon: a roof lid whose underside carries the beacon.
#               Origin on the roof; rotation.x = 0 hides it (inside the roof), π raises it.
#   Siren       (unmarked) empty behind the grille, for positional siren audio.
# Beacon materials follow ambulance.glb: BeaconL (+X half) and BeaconR (−X half) flash alternately;
# on the patrol car they cover the light bar, the front lamps in the bumper and the rear-window
# lamps, on the unmarked car the grille lamps (前方集中式警光灯) and the halves of the hidden dome.
# Lamp materials keep car.glb's names (HeadLamp, TailLamp, IndicatorL/R, Reverse).
# No real emblem or wordmark: generic gold shield, "PATROL", made-up numbers (textures by agy,
# scripts/textures/police_vehicle_textures.py → assets/police_vehicles/textures).
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import police_common as pc  # noqa: E402
from police_common import Mesh, Surface, decal, empty, join_into, log, material, new_object  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
VARIANT = ARGS[0] if ARGS else "patrol"
if VARIANT not in ("patrol", "unmarked"):
    raise SystemExit(f"unknown variant {VARIANT!r} (patrol | unmarked)")
IS_PATROL = VARIANT == "patrol"
OUT = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else os.path.join(pc.ROOT, "public", "models", f"police_{VARIANT}.glb")
PREVIEW = os.path.abspath(ARGS[2]) if len(ARGS) > 2 else None

LENGTH, WIDTH, HEIGHT = 4.91, 1.80, 1.455
FRONT, REAR = LENGTH / 2, -LENGTH / 2
AXLE_F, AXLE_R = 1.50, -1.42  # 0.955 m front overhang, 2.92 m wheelbase
TRACK = 0.775  # wheel centre from the centreline
WHEEL_R, TIRE_W, RIM_R = 0.334, 0.215, 0.216  # 215/55R17
ARCH_R = 0.405
LIFT = 1.20  # 昇降式: the bar rises from ~1.8 m to ~3 m above the road
POD_Z = (-0.04, -0.62)  # lift housing on the roof
BAR_Z = -0.30
FLIP_Z = -0.50  # hidden beacon lid centre

pc.reset()
SCENE = bpy.context.scene

# ---------------------------------------------------------------------------- materials

if IS_PATROL:
    material("PaintWhite", 0xF3F4F2, metallic=0.1, roughness=0.3, coat=0.8)
    material("PaintBlack", 0x0E0F12, metallic=0.35, roughness=0.25, coat=0.8)
    WHITE, BLACK = "PaintWhite", "PaintBlack"
else:
    material("Paint", 0x2B2F36, metallic=0.55, roughness=0.3, coat=0.8)  # dark gunmetal; cloneable
    WHITE = BLACK = "Paint"
material("Trim", 0x16181B, roughness=0.62)
material("Blackout", 0x0B0C0E, roughness=0.12, coat=1.0)
material("Glass", 0x10171F, metallic=0.4, roughness=0.08)  # opaque, as ambulance.glb (no cabin)
material("Gap", 0x07080A, roughness=0.8)
material("Chrome", 0xD9DDE2, metallic=1.0, roughness=0.15)
material("HeadLamp", 0xF4F6F8, tex="sedan_headlamp.png", roughness=0.08, emissive=True)
material("TailLamp", 0x8A0A0A, tex="sedan_taillamp.png", roughness=0.1, emissive=True)
material("IndicatorL", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("IndicatorR", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("Reverse", 0xDADDE0, roughness=0.1, emissive=0xFFFFFF)
material("Grille", 0x15171A, tex="sedan_grille.png", metallic=0.3, roughness=0.35)
material("Plate", 0xFFFFFF, tex="patrol_plate.png" if IS_PATROL else "unmarked_plate.png", roughness=0.45, clip=True)
material("Tire", 0x18191B, roughness=0.9)
material("WheelFace", 0xC4C9D0, tex="sedan_wheel.png", metallic=0.6, roughness=0.35)
if IS_PATROL:
    for name in ("BeaconL", "BeaconR"):
        material(name, 0xD8141C, tex="patrol_lightbar.png", roughness=0.3, emissive=True)
    material("LightBarBody", 0x2A2C30, metallic=0.5, roughness=0.4)
    material("Speaker", 0x202226, tex="patrol_speaker.png", roughness=0.6)
    material("DecalDoor", 0x111111, tex="patrol_door.png", roughness=0.35, clip=True)
    material("DecalRear", 0xF4F4F0, tex="patrol_rear.png", roughness=0.35, clip=True)
    material("DecalRoof", 0x111111, tex="patrol_roof.png", roughness=0.35, clip=True)
    material("Badge", 0xC9A23A, tex="patrol_badge.png", metallic=0.8, roughness=0.3, clip=True)
else:
    for name in ("BeaconL", "BeaconR"):
        material(name, 0xD8141C, tex="red_lens.png", roughness=0.25, emissive=True)


# ---------------------------------------------------------------------------- body loft

HALF_WIDTH = [
    (2.455, 0.64),
    (2.43, 0.76),
    (2.38, 0.83),
    (2.30, 0.862),
    (2.20, 0.878),
    (2.05, 0.886),
    (-2.0, 0.886),
    (-2.25, 0.878),
    (-2.35, 0.86),
    (-2.42, 0.82),
    (-2.455, 0.72),
]
BOTTOM = [
    (2.455, 0.26),
    (2.43, 0.22),
    (2.38, 0.20),
    (2.25, 0.185),
    (2.0, 0.175),
    (1.6, 0.165),
    (-1.6, 0.165),
    (-2.0, 0.19),
    (-2.25, 0.22),
    (-2.38, 0.26),
    (-2.43, 0.30),
    (-2.455, 0.34),
]
SHOULDER = [  # beltline: bonnet edge → window sills → boot lid edge
    (2.455, 0.68),
    (2.43, 0.72),
    (2.38, 0.755),
    (2.30, 0.785),
    (2.20, 0.81),
    (2.05, 0.835),
    (1.85, 0.86),
    (1.60, 0.885),
    (1.35, 0.905),
    (1.10, 0.925),
    (0.86, 0.945),
    (0.5, 0.955),
    (0.0, 0.965),
    (-0.5, 0.975),
    (-1.0, 0.99),
    (-1.5, 1.0),
    (-1.8, 1.005),
    (-2.10, 1.0),
    (-2.30, 0.99),
    (-2.42, 0.96),
    (-2.455, 0.93),
]
TOP = [  # centreline: bonnet → windscreen (0.86 → −0.06) → roof → rear screen (−1.14 → −1.80) → boot
    (2.455, 0.72),
    (2.43, 0.765),
    (2.38, 0.80),
    (2.30, 0.83),
    (2.20, 0.85),
    (2.05, 0.87),
    (1.85, 0.895),
    (1.60, 0.915),
    (1.35, 0.935),
    (1.10, 0.95),
    (0.86, 0.965),
    (0.80, 0.99),
    (0.70, 1.04),
    (0.55, 1.12),
    (0.40, 1.20),
    (0.25, 1.27),
    (0.10, 1.34),
    (-0.06, 1.405),
    (-0.20, 1.44),
    (-0.30, 1.452),
    (-0.60, 1.455),
    (-0.80, 1.452),
    (-1.00, 1.44),
    (-1.14, 1.415),
    (-1.22, 1.385),
    (-1.32, 1.335),
    (-1.45, 1.26),
    (-1.60, 1.17),
    (-1.80, 1.065),
    (-1.95, 1.045),
    (-2.10, 1.04),
    (-2.25, 1.035),
    (-2.35, 1.025),
    (-2.42, 1.0),
    (-2.455, 0.97),
]
# White/black split: from the headlamps down over the front wheel to mid-door, then rising over
# the rear wheel to the top of the rear bumper (Commons photos of current patrol cars).
LIVERY = [(2.455, 0.70), (2.20, 0.72), (1.85, 0.71), (0.80, 0.60), (-0.40, 0.635), (-1.40, 0.70), (-1.90, 0.72)]
LIVERY += [(-2.455, 0.70)]
NOSE_Z = 2.40  # the fascia ahead of this is black
# The end caps bulge 24 mm past the last stations, so those sit inside the overall length.
STATIONS = [2.431, 2.42, 2.38, 2.30, 2.20, 2.05, 1.85, 1.60, 1.35, 1.10, 0.86, 0.80, 0.70, 0.55, 0.40, 0.25, 0.10]
STATIONS += [-0.06, -0.20, -0.30, -0.42, -0.60, -0.80, -1.00, -1.14, -1.22, -1.32, -1.45, -1.60, -1.80, -1.95]
STATIONS += [-2.10, -2.25, -2.35, -2.42, -2.431]
# Half cross-section parts (segments each): underbody, rocker, lower side (black), upper side,
# shoulder, window, roof rail, top. The livery line is the vertex between parts 2 and 3.
SEG = [3, 2, 2, 2, 2, 2, 1, 4]
PART = [p for p, n in enumerate(SEG) for _ in range(n)]
NSEG = len(PART)
BELT_J = sum(SEG[:5])


def interp(table, z):
    pts = sorted(table)
    if z <= pts[0][0]:
        return pts[0][1]
    if z >= pts[-1][0]:
        return pts[-1][1]
    for (z0, v0), (z1, v1) in zip(pts, pts[1:], strict=False):
        if z0 <= z <= z1:
            return v0 + (v1 - v0) * (z - z0) / (z1 - z0)
    return pts[-1][1]


def section(z):
    """Right half (x ≥ 0) of the cross-section at z: NSEG+1 points, bottom centre → top centre."""
    w, yb, ys, yt = interp(HALF_WIDTH, z), interp(BOTTOM, z), interp(SHOULDER, z), interp(TOP, z)
    g = min(1.0, max(0.0, yt - ys) / 0.4)  # 0 on bonnet/boot, 1 under the full-height roof
    x5 = w - 0.05 - 0.17 * g  # tumblehome
    livery = min(max(interp(LIVERY, z), yb + 0.15), ys - 0.13)
    key = [
        (0.0, yb),
        (w - 0.12, yb),
        (w, yb + 0.12),
        (w + 0.008, livery),
        (w + 0.012, ys - 0.10),
        (w - 0.035, ys),
        (x5, max(ys + 0.012, yt - 0.065)),
        (x5 - 0.035 - 0.08 * (1 - g), max(ys + 0.022, yt - 0.025)),
        (0.0, yt),
    ]
    pts = []
    for k, n in enumerate(SEG):
        (xa, ya), (xb, yb2) = key[k], key[k + 1]
        for i in range(n):
            t = i / n
            pts.append((xa + (xb - xa) * t, ya + (yb2 - ya) * t))
    pts.append(key[-1])
    return pts


def face_material(part, z_mid, h_mid):
    if part == 0:
        return "Trim"  # underbody
    if z_mid > NOSE_Z or part in (1, 2):
        return BLACK
    if part == 5 and h_mid > 0.06:  # side glass band
        if -0.42 < z_mid < -0.30:
            return "Blackout"  # B-pillar
        if -0.30 < z_mid < 0.80 or -1.22 < z_mid < -0.42:
            return "Glass"
    if part == 7:
        if -0.06 < z_mid < 0.86 and h_mid > 0.03:
            return "Glass"  # windscreen
        if -1.80 < z_mid < -1.14:
            return "Glass"  # rear screen
    return WHITE


BODY_MATS = list(dict.fromkeys([WHITE, BLACK, "Trim", "Glass", "Blackout"]))


def build_body():
    bm = bmesh.new()
    crease = bm.edges.layers.float.new("crease_edge")
    rings, heights = [], []
    for z in STATIONS:
        pts = section(z)
        ring = [bm.verts.new((0.0, pts[0][1], z))]
        ring += [bm.verts.new((pts[j][0], pts[j][1], z)) for j in range(1, NSEG + 1)]
        ring += [bm.verts.new((-pts[j][0], pts[j][1], z)) for j in range(NSEG - 1, 0, -1)]
        rings.append(ring)
        heights.append(max(0.0, interp(TOP, z) - interp(SHOULDER, z)))
    n = 2 * NSEG
    for k in range(len(rings) - 1):
        z_mid = (STATIONS[k] + STATIONS[k + 1]) / 2
        h_mid = (heights[k] + heights[k + 1]) / 2
        for r in range(n):
            seg = r if r < NSEG else n - r - 1
            f = bm.faces.new((rings[k][r], rings[k][(r + 1) % n], rings[k + 1][(r + 1) % n], rings[k + 1][r]))
            f.material_index = BODY_MATS.index(face_material(PART[seg], z_mid, h_mid))
    for k in range(len(rings) - 1):  # crisp beltline after subdivision
        for r in (BELT_J, n - BELT_J):
            e = bm.edges.get((rings[k][r], rings[k + 1][r]))
            if e:
                e[crease] = 0.6
    # Ends: shrinking rings and a small fan. Front fascia black; the rear face white above the
    # bumper (the bumper itself is a black decal, so its top edge stays straight).
    for ring, z, sign in ((rings[0], STATIONS[0], 1), (rings[-1], STATIONS[-1], -1)):
        cy = sum(v.co.y for v in ring) / len(ring)
        prev = ring
        for scale, dz in ((0.72, 0.012), (0.42, 0.02)):
            nxt = [bm.verts.new((v.co.x * scale, cy + (v.co.y - cy) * scale, z + sign * dz)) for v in ring]
            for r in range(n):
                seg = r if r < NSEG else n - r - 1
                part = PART[seg]
                mat = "Trim" if part == 0 else BLACK if (sign > 0 or part in (1, 2)) else WHITE
                f = bm.faces.new((prev[r], prev[(r + 1) % n], nxt[(r + 1) % n], nxt[r]))
                f.material_index = BODY_MATS.index(mat)
            prev = nxt
        tip = bm.verts.new((0.0, cy, z + sign * 0.024))
        for r in range(n):
            f = bm.faces.new((prev[r], prev[(r + 1) % n], tip))
            f.material_index = BODY_MATS.index(BLACK if sign > 0 else WHITE)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object("Body", bm, BODY_MATS, smooth=True)
    sub = ob.modifiers.new("subdivide", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    pc.apply_modifiers(ob)
    # Wheel arches: one cylinder through the car per axle; the cut faces become black liners.
    for zc in AXLES:
        cbm = bmesh.new()
        ring0, ring1 = [], []
        for i in range(40):
            a = 2 * math.pi * i / 40
            y, zz = WHEEL_R + ARCH_R * math.cos(a), zc + ARCH_R * math.sin(a)
            ring0.append(cbm.verts.new((-1.3, y, zz)))
            ring1.append(cbm.verts.new((1.3, y, zz)))
        for i in range(40):
            j = (i + 1) % 40
            cbm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
        cbm.faces.new(list(reversed(ring0)))
        cbm.faces.new(ring1)
        bmesh.ops.recalc_face_normals(cbm, faces=cbm.faces)
        cutter = new_object("ArchCutter", cbm, ["Trim"], smooth=True)
        mod = ob.modifiers.new("arch", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.material_mode = "TRANSFER"
        mod.object = cutter
        pc.apply_modifiers(ob)
        bpy.data.objects.remove(cutter)
    pc.mark_sharp(ob, 50)
    return ob


AXLES = (AXLE_F, AXLE_R)
root = empty("PolicePatrol" if IS_PATROL else "PoliceUnmarked")
body = build_body()
body.parent = root
surf = Surface(body)
parts = []  # fixed parts joined into Body at the end


def roof_y(z, x=0.0):
    h = surf.hit((x, 3.0, z), (0, -1, 0))
    return h[0].y if h else interp(TOP, z)


def stroke(name, rays, width, mat, offset=0.0025):
    """Thin ribbon along the surface hits of `rays` [(origin, direction)] (panel gaps)."""
    hits = [h for h in (surf.hit(o, d) for o, d in rays) if h]
    if len(hits) < 2:
        log("stroke_skipped", stroke=name)
        return
    bm = bmesh.new()
    left, right = [], []
    for i, (p, nrm) in enumerate(hits):
        t = (hits[min(i + 1, len(hits) - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
        side = nrm.cross(t).normalized() * (width / 2)
        q = p + nrm * offset
        left.append(bm.verts.new(q + side))
        right.append(bm.verts.new(q - side))
    for i in range(len(hits) - 1):
        f = bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
        f.normal_update()
        if f.normal.dot(hits[i][1]) < 0:
            f.normal_flip()
    parts.append(new_object(name, bm, [mat]))


def flat_plate(name, y, sign):
    """Flat 330 × 165 mm plate on the bumper face (front sign = 1, rear −1) with a black backing."""
    h = surf.hit((0.0, y, sign * 3.0), (0.0, 0.0, -sign))
    z = (h[0].z if h else sign * FRONT) + sign * 0.014
    m = Mesh(["Plate", "Trim"])
    w, ht = 0.33, 0.165
    # Seen from outside, +u runs toward +X at the front and −X at the rear.
    corners = [(-w / 2, -ht / 2), (w / 2, -ht / 2), (w / 2, ht / 2), (-w / 2, ht / 2)]
    m.face(
        [(sign * a, y + b, z) for a, b in corners],
        "Plate",
        uvs=[(a / w + 0.5, b / ht + 0.5) for a, b in corners],
        facing=(0, 0, sign),
    )
    m.box((0.0, y, z - sign * 0.008), (w + 0.03, ht + 0.03, 0.012), "Trim")
    parts.append(m.obj(name))


# ---------------------------------------------------------------------------- lamps & details

FRONT_YAW = math.radians(35)
for side in (1, -1):
    tag = "L" if side > 0 else "R"
    parts.append(
        decal(
            f"HeadLamp{tag}",
            surf,
            (side * 0.66, 0.665, 2.37),
            side * FRONT_YAW,
            math.radians(8),
            0.42,
            0.085,
            "HeadLamp",
            segs=(10, 2),
            flip_u=side > 0,  # u = 0 at the outer end
            shape=lambda a, b, s, t, side=side: (a, b + 0.02 * (s if side > 0 else 1 - s)),
        )
    )
    parts.append(
        decal(
            f"FrontIndicator{tag}",
            surf,
            (side * 0.70, 0.60, 2.38),
            side * math.radians(38),
            0.0,
            0.16,
            0.018,
            f"Indicator{tag}",
            segs=(5, 1),
        )
    )
    parts.append(
        decal(
            f"TailLamp{tag}",
            surf,
            (side * 0.66, 0.90, -2.42),
            math.pi - side * math.radians(28),
            0.0,
            0.50,
            0.095,
            "TailLamp",
            segs=(10, 2),
            flip_u=side < 0,
        )
    )
    parts.append(
        decal(f"Reverse{tag}", surf, (side * 0.36, 0.84, -2.47), math.pi, 0.0, 0.10, 0.03, "Reverse", segs=(3, 1))
    )
    parts.append(
        decal(f"Fog{tag}", surf, (side * 0.70, 0.32, 2.40), side * 0.35, 0.0, 0.07, 0.07, "Chrome", segs=(3, 3))
    )
    # Side repeater on the front fender.
    parts.append(
        decal(
            f"SideRepeater{tag}", surf, (side * 0.9, 0.78, 1.95), side * math.pi / 2, 0.0, 0.07, 0.02, f"Indicator{tag}"
        )
    )
parts.append(
    decal(
        "Grille",
        surf,
        (0.0, 0.52, FRONT),
        0.0,
        0.0,
        0.90,
        0.30,
        "Grille",
        segs=(16, 3),
        offset=0.005,
        shape=lambda a, b, s, t: (a * (1.0 - 0.18 * t), b),
    )
)
parts.append(decal("Intake", surf, (0.0, 0.29, FRONT), 0.0, 0.0, 1.20, 0.06, "Trim", segs=(16, 1), offset=0.003))
parts.append(decal("Diffuser", surf, (0.0, 0.40, REAR), math.pi, 0.0, 1.30, 0.07, "Trim", segs=(16, 1), offset=0.006))
parts.append(
    decal(
        "BrakeLampHigh",
        surf,
        (0.0, interp(TOP, -2.40), -2.40),
        math.pi,
        math.radians(35),
        0.40,
        0.025,
        "TailLamp",
        segs=(6, 1),
        uv=(0.3, 0.45, 0.7, 0.55),
    )
)
flat_plate("PlateFront", 0.43, 1)
flat_plate("PlateRear", 0.79, -1)

# Panel gaps, sills, wipers.
for side in (1, -1):
    for z in (0.80, -0.36, -1.20):
        stroke(
            f"Gap{z:+.2f}{side}",
            [
                ((side * 1.4, y, z), (-side, 0, 0))
                for y in [0.30 + 0.03 * i for i in range(24)]
                if y < interp(SHOULDER, z)
            ],
            0.006,
            "Gap",
        )
    stroke(
        f"BonnetGap{side}",
        [((side * (interp(HALF_WIDTH, z) - 0.09), 2.0, z), (0, -1, 0)) for z in [0.90 + 0.07 * i for i in range(20)]],
        0.006,
        "Gap",
    )
    stroke(
        f"Sill{side}",
        [((side * 1.4, 0.30, z), (-side, 0, 0)) for z in [1.05 - 0.06 * i for i in range(35)] if z > -1.0],
        0.05,
        "Trim",
        offset=0.002,
    )
    stroke(
        f"Wiper{side}",
        [((side * (0.06 + 0.06 * i), 2.0, 0.83 - 0.004 * i), (0, -1, 0)) for i in range(10)],
        0.016,
        "Trim",
        offset=0.012,
    )
stroke("TrunkGap", [((x, 1.2, -3.0), (0, -0.3, 1)) for x in [-0.80 + 0.05 * i for i in range(33)]], 0.006, "Gap")

# Mirrors and handles.
mm = Mesh(["Trim"])
for side in (1, -1):
    h = surf.hit((side * 1.5, 1.0, 0.68), (-side, 0, 0))
    root_x = abs(h[0].x) if h else 0.86
    mm.box((side * (root_x + 0.12), 1.05, 0.64), (0.20, 0.12, 0.10), "Trim")
    mm.box((side * (root_x + 0.03), 1.02, 0.66), (0.08, 0.04, 0.06), "Trim")
mirrors = mm.obj("MirrorShells")
sub = mirrors.modifiers.new("soften", "SUBSURF")
sub.levels = 2
pc.apply_modifiers(mirrors)
for p in mirrors.data.polygons:
    p.use_smooth = True
parts.append(mirrors)
m = Mesh(["Chrome"])
for side in (1, -1):
    for z in (0.10, -0.80):
        hh = surf.hit((side * 1.4, 0.905, z), (-side, 0, 0))
        x = hh[0].x + side * 0.012 if hh else side * 0.89
        m.box((x, 0.905, z), (0.025, 0.026, 0.15), "Chrome")
# Twin exhaust tips under the rear bumper.
for side in (1, -1):
    for dx in (0.0, 0.085):
        m.tube((side * (0.42 + dx), 0.27, -2.30), (side * (0.42 + dx), 0.27, -2.47), 0.035, 0.035, "Chrome", segs=10)
parts.append(m.obj("Mirrors"))

# ---------------------------------------------------------------------------- variant fittings

if IS_PATROL:
    # Livery decals: black nose on the bonnet (an arc from the headlamps back to ~0.33 m behind
    # the bonnet's front edge at the centre), PATROL on the doors and on the rear bumper, the roof
    # number for helicopters, a generic gold badge on the black nose.
    bm = bmesh.new()
    nx, ny = 18, 3
    grid = {}
    for i in range(nx + 1):
        f = -1.0 + 2.0 * i / nx  # fraction of the local half width (rays must hit the bonnet)
        z_arc = 2.12 + 0.26 * f * f
        for j in range(ny + 1):
            z = NOSE_Z + 0.01 + (z_arc - NOSE_Z - 0.01) * j / ny
            x = f * (interp(HALF_WIDTH, z) - 0.04)
            h = surf.hit((x, 2.5, z), (0, -1, 0))
            grid[i, j] = bm.verts.new(h[0] + h[1] * 0.003 if h else (x, interp(TOP, z), z))
    for i in range(nx):
        for j in range(ny):
            bm.faces.new([grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]])
    bm.normal_update()
    for f in bm.faces:
        if f.normal.y < 0:
            f.normal_flip()
    parts.append(new_object("BlackNose", bm, [BLACK]))
    parts.append(
        decal(
            "Badge",
            surf,
            (0.0, interp(TOP, 2.30), 2.30),
            0.0,
            math.radians(72),
            0.09,
            0.09,
            "Badge",
            segs=(2, 2),
            offset=0.006,
        )
    )
    for side in (1, -1):
        parts.append(
            decal(
                f"Lettering{'L' if side > 0 else 'R'}",
                surf,
                (side * 0.95, 0.755, -0.25),
                side * math.pi / 2,
                0.0,
                1.60,
                0.21,
                "DecalDoor",
                segs=(18, 6),
            )
        )
    parts.append(decal("RearBumper", surf, (0.0, 0.53, REAR), math.pi, 0.0, 1.70, 0.34, BLACK, segs=(18, 4)))
    parts.append(
        decal(
            "RearLettering", surf, (0.0, 0.52, REAR), math.pi, 0.0, 0.80, 0.20, "DecalRear", segs=(8, 1), offset=0.008
        )
    )
    parts.append(
        decal("RoofNumber", surf, (0.0, 1.6, -0.85), math.pi, math.pi / 2, 0.76, 0.38, "DecalRoof", segs=(6, 3))
    )
    # Front red lamps in the lower bumper and rear red lamps at the top of the rear window.
    for side, mat in ((1, "BeaconL"), (-1, "BeaconR")):
        tag = mat[-1]
        parts.append(
            decal(
                f"FrontBeacon{tag}",
                surf,
                (side * 0.48, 0.355, 2.44),
                side * 0.2,
                0.0,
                0.13,
                0.04,
                mat,
                segs=(4, 1),
                uv=(0.06, 0.2, 0.24, 0.8),
                offset=0.006,
            )
        )
        parts.append(
            decal(
                f"RearBeacon{tag}",
                surf,
                (side * 0.42, interp(TOP, -1.24) - 0.02, -1.24),
                math.pi,
                math.radians(30),
                0.22,
                0.045,
                mat,
                segs=(4, 1),
                uv=(0.06, 0.2, 0.40, 0.8),
            )
        )
    # Lift housing (white pod) on the roof.
    m = Mesh([WHITE])
    pod = []
    for z, w, top in ((POD_Z[0], 0.48, 0.05), (-0.10, 0.56, 0.15), (-0.20, 0.58, 0.17), (-0.54, 0.58, 0.17)):
        pod.append((z, w, roof_y(z) - 0.03, roof_y(z) + top))
    pod.append((POD_Z[1], 0.52, roof_y(POD_Z[1]) - 0.03, roof_y(POD_Z[1]) + 0.10))
    m.loft_z(pod, WHITE, n=5.0, segs=20)
    pod_ob = m.obj("Pod", smooth=True)
    pc.mark_sharp(pod_ob, 40)
    parts.append(pod_ob)
    bar_y = roof_y(BAR_Z) + 0.17
    # Antenna at the back of the roof.
    m = Mesh(["Trim"])
    m.tube((0.0, roof_y(-1.10), -1.10), (0.0, roof_y(-1.10) + 0.42, -1.16), 0.005, 0.003, "Trim", segs=6)
    m.box((0.0, roof_y(-1.10) + 0.01, -1.10), (0.04, 0.02, 0.06), "Trim")
    parts.append(m.obj("Antenna"))
else:
    # 前方集中式警光灯: two red lamps behind the grille mesh.
    for side, mat in ((1, "BeaconL"), (-1, "BeaconR")):
        parts.append(
            decal(
                f"GrilleBeacon{mat[-1]}",
                surf,
                (side * 0.24, 0.585, FRONT),
                0.0,
                0.0,
                0.11,
                0.04,
                mat,
                segs=(3, 1),
                offset=0.007,
            )
        )
    # Lid outline of the hidden beacon and the roof antenna.
    m = Mesh(["Gap", "Blackout"])
    ry = roof_y(FLIP_Z)
    for dx, dz, sx, sz in (
        (0, 0.16, 0.50, 0.008),
        (0, -0.16, 0.50, 0.008),
        (0.25, 0, 0.008, 0.32),
        (-0.25, 0, 0.008, 0.32),
    ):
        m.box((dx, ry + 0.001, FLIP_Z + dz), (sx, 0.004, sz), "Gap")
    m.tube((0.0, roof_y(-1.05), -1.05), (0.0, roof_y(-1.05) + 0.20, -1.08), 0.006, 0.004, "Blackout", segs=6)
    parts.append(m.obj("RoofDetail"))

join_into(body, parts)
body.name = "Body"

# ---------------------------------------------------------------------------- moving parts

if IS_PATROL:
    bar_origin = Vector((0.0, bar_y, BAR_Z))
    m = Mesh(["LightBarBody", "BeaconL", "BeaconR", "Speaker", "Trim"])
    m.box((0.0, bar_y + 0.015, BAR_Z), (1.32, 0.03, 0.30), "LightBarBody")  # base rail
    for side, mat in ((1, "BeaconL"), (-1, "BeaconR")):
        # Lens: rounded (superellipse) rings along X from the centre unit to the rounded end.
        segs = 16
        stations = [(0.10, 0.14, 0.13), (0.40, 0.14, 0.13), (0.58, 0.136, 0.125), (0.64, 0.118, 0.108)]
        stations += [(0.665, 0.085, 0.08), (0.675, 0.035, 0.035)]
        rings = []
        for x, hd, hh in stations:
            ring = []
            for k in range(segs):
                t = 2 * math.pi * k / segs
                c, s = math.cos(t), math.sin(t)
                yy = bar_y + 0.03 + hh * (1 + math.copysign(abs(s) ** 0.55, s)) / 2 * 1.0
                zz = BAR_Z + hd * math.copysign(abs(c) ** 0.55, c)
                ring.append((m.bm.verts.new((side * x, yy, zz)), (yy - bar_y - 0.03) / (hh + 1e-6)))
            rings.append((x, ring))
        for (xa, ra), (xb, rb) in zip(rings, rings[1:], strict=False):
            for k in range(segs):
                j = (k + 1) % segs
                ua, ub = (xa - 0.10) / 0.575, (xb - 0.10) / 0.575
                f = m.face(
                    [ra[k][0], ra[j][0], rb[j][0], rb[k][0]],
                    mat,
                    uvs=[(ua, ra[k][1]), (ua, ra[j][1]), (ub, rb[j][1]), (ub, rb[k][1])],
                )
        m.face([v for v, _ in rings[-1][1]], mat, uvs=[(1.0, 0.5)] * segs)
    # Centre unit: loudspeaker facing front and back, under a smoked cap.
    m.box((0.0, bar_y + 0.095, BAR_Z), (0.20, 0.13, 0.28), "LightBarBody")
    for sign in (1, -1):
        zf = BAR_Z + sign * 0.1405
        corners = [(-0.085, bar_y + 0.045), (0.085, bar_y + 0.045), (0.085, bar_y + 0.145), (-0.085, bar_y + 0.145)]
        m.face(
            [(sign * x, y, zf) for x, y in corners],
            "Speaker",
            uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
            facing=(0, 0, sign),
        )
    # Lift mast: hidden inside the pod and the cabin while the bar is down.
    for x in (0.22, -0.22):
        m.box((x, bar_y - LIFT / 2, BAR_Z), (0.04, LIFT, 0.04), "Trim")
    bar = m.obj("LightBar", root, Matrix.Translation(bar_origin))
    siren = empty("Siren", bar, location=(0.0, 0.095, 0.14))
else:
    # 反転式: the lid (paint up) carries the beacon on its underside; rotation.x = π raises it.
    ry = roof_y(FLIP_Z)
    pivot = Vector((0.0, ry + 0.004, FLIP_Z))
    m = Mesh(["Paint", "Trim", "BeaconL", "BeaconR"])
    m.box((0.0, ry - 0.002, FLIP_Z), (0.48, 0.012, 0.30), "Paint")
    m.box((0.0, ry - 0.018, FLIP_Z), (0.40, 0.02, 0.22), "Trim")  # beacon base

    def dome_uv(local, mid):
        return (0.5 + 0.42 * local.x / 0.17, 0.5 + 0.42 * local.z / 0.10)  # stay inside the lens disc

    # Streamlined dome hanging below the lid (pointing up once flipped): halves by x.
    faces = m.ellipsoid((0.0, ry - 0.028, FLIP_Z), (0.17, 0.09, 0.10), "BeaconL", segs=16, rows=8, uv_of=dome_uv)
    for f in faces:
        is_lower = f.calc_center_median().y < ry - 0.028
        if not is_lower:
            m.bm.faces.remove(f)
            continue
        if f.calc_center_median().x < 0:
            f.material_index = m.mat("BeaconR")
    m.bm.verts.ensure_lookup_table()
    for v in [v for v in m.bm.verts if not v.link_faces]:
        m.bm.verts.remove(v)
    beacon = m.obj("HiddenBeacon", root, Matrix.Translation(pivot))
    siren = empty("Siren", root, location=(0.0, 0.55, FRONT - 0.15))

# ---------------------------------------------------------------------------- wheels


def build_wheel(name, side, location):
    """Tyre lathe and a textured wheel face; the outer face points to +X (left) or −X (right)."""
    m = Mesh(["Tire", "WheelFace", "Chrome", "Trim"])
    segs = 28
    prof = [
        (-0.100, RIM_R),
        (-0.106, 0.25),
        (-0.1075, 0.29),
        (-0.102, 0.318),
        (-0.088, 0.330),
        (-0.05, WHEEL_R),
        (0.05, WHEEL_R),
        (0.088, 0.330),
        (0.102, 0.318),
        (0.1075, 0.29),
        (0.106, 0.25),
        (0.100, RIM_R),
    ]
    grid = [
        [
            m.bm.verts.new((side * dx, r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs)))
            for dx, r in prof
        ]
        for k in range(segs)
    ]
    for k in range(segs):
        j = (k + 1) % segs
        for i in range(len(prof) - 1):
            m.face([grid[k][i], grid[k][i + 1], grid[j][i + 1], grid[j][i]], "Tire")
    bmesh.ops.recalc_face_normals(m.bm, faces=m.bm.faces)
    for f in m.bm.faces:
        f.tag = True
    # Wheel face, a little recessed, seen from outside: u toward the rear (−Z), v up.
    pts, uvs = [], []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        y, z = RIM_R * math.cos(a), RIM_R * math.sin(a)
        pts.append((side * 0.085, y, z))
        uvs.append((0.5 - 0.5 * side * z / RIM_R, 0.5 + 0.5 * y / RIM_R))
    m.face(pts, "WheelFace", uvs=uvs, facing=(side, 0, 0))
    m.tube((side * 0.085, 0, 0), (side * 0.100, 0, 0), RIM_R + 0.006, RIM_R + 0.006, "Chrome", segs=segs, caps=False)
    m.face(
        [
            (side * -0.09, RIM_R * math.cos(2 * math.pi * k / segs), RIM_R * math.sin(2 * math.pi * k / segs))
            for k in range(segs)
        ],
        "Trim",
        facing=(-side, 0, 0),
    )
    bmesh.ops.translate(m.bm, verts=m.bm.verts, vec=location)
    return m.obj(name, root, Matrix.Translation(location), smooth=True)


wheels = {}
for tag, x, z in (("FL", TRACK, AXLE_F), ("FR", -TRACK, AXLE_F), ("RL", TRACK, AXLE_R), ("RR", -TRACK, AXLE_R)):
    wheels[tag] = build_wheel(f"Wheel{tag}", 1 if x > 0 else -1, Vector((x, WHEEL_R, z)))

# ---------------------------------------------------------------------------- extras & export

root["variant"] = VARIANT
root["length"] = LENGTH
root["width"] = WIDTH
root["height"] = round(HEIGHT + (0.17 + 0.145 if IS_PATROL else 0.0), 3)
root["bodyHeight"] = HEIGHT
root["wheelbase"] = round(AXLE_F - AXLE_R, 3)
root["frontAxleZ"] = AXLE_F
root["rearAxleZ"] = AXLE_R
root["track"] = round(2 * TRACK, 3)
root["wheelRadius"] = WHEEL_R
if IS_PATROL:
    root["lightBarLift"] = LIFT  # LightBar.position.y += lift when raised (昇降式)
else:
    root["hiddenBeaconAxis"] = "x"
    root["hiddenBeaconRaised"] = round(math.pi, 6)  # HiddenBeacon.rotation.x: 0 hidden, π raised

pc.export_glb(OUT)
log(
    "exported",
    file=OUT,
    bytes=os.path.getsize(OUT),
    tris={o.name: pc.tris(o) for o in SCENE.objects if o.type == "MESH"},
    total=sum(pc.tris(o) for o in SCENE.objects if o.type == "MESH"),
    materials=len(body.data.materials),
)

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    cam = pc.preview_setup(lens=45)
    name = f"police-{VARIANT}"
    views = {
        "front-left": ((6.2, 2.2, 6.6), (0.0, 0.75, 0.2)),
        "rear-right": ((-6.0, 2.4, -6.6), (0.0, 0.8, -0.2)),
        "left": ((9.0, 0.9, 0.0), (0.0, 0.75, 0.0)),
        "right": ((-9.0, 0.9, 0.0), (0.0, 0.75, 0.0)),
        "front": ((0.0, 1.2, 8.0), (0.0, 0.75, 0.0)),
        "rear": ((0.0, 1.4, -8.0), (0.0, 0.8, 0.0)),
        "top": ((3.5, 7.5, -2.5), (0.0, 1.0, -0.4)),
        "wheel": ((2.6, 0.6, 3.0), (0.78, 0.4, 1.5)),
    }
    for view, (eye, target) in views.items():
        pc.render(cam, os.path.join(PREVIEW, f"{name}-{view}.png"), eye, target)
    if IS_PATROL:
        bar.location.y += LIFT
        pc.render(cam, os.path.join(PREVIEW, f"{name}-lifted.png"), (6.5, 3.0, 7.0), (0.0, 1.5, 0.0))
    else:
        beacon.rotation_euler.x = math.pi
        pc.render(cam, os.path.join(PREVIEW, f"{name}-raised.png"), (3.5, 2.6, 3.5), (0.0, 1.3, -0.4))
        beacon.rotation_euler.x = math.pi / 2
        pc.render(cam, os.path.join(PREVIEW, f"{name}-flipping.png"), (3.5, 2.6, 3.5), (0.0, 1.3, -0.4))
