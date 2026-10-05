# A generic police helicopter (medium twin-engine, skids) for TOKYO OPEN DRIVE: it flies over a
# car that does not stop for the police and lights it with its searchlight at night.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/police_heli.py -- [public/models/police_heli.glb] [preview-dir]
#
# Game coordinates (+Y up, nose toward +Z, ground at y = 0, the aircraft's left = +X), exported with
# export_yup=False, as the police cars. The origin is on the ground under the rotor mast; the skids
# stand on y = 0. The size is that of a medium twin (about 13.6 m nose to tail fin, a 13.8 m main
# rotor, about 4.1 m high): a class many police air units fly, but no particular type is copied.
#
# Nodes under the root (PoliceHeli, extras = dimensions):
#   Body        fuselage, tail boom, fin, stabiliser, engine cowling, mast, skids, lamps: one mesh.
#   MainRotor   origin on the rotor hub; five blades; spins about its local +Y (rotation.y).
#   TailRotor   origin on the tail-rotor hub on the fin's left (+X) side; four blades in the YZ
#               plane; spins about its local X (rotation.x).
#   Searchlight origin at the lamp's gimbal under the nose (right side); the lens faces local +Z,
#               so Object3D.lookAt(target) points it.
# Lamps keep separate materials so the game can light and flash them: AntiCollision (red, on the
# cowling and the belly), NavRed (left = +X stabiliser tip), NavGreen (right = −X tip), Strobe
# (white, fin top and tail), SearchLens (the searchlight's lens).
# White with a dark-blue band; no lettering, emblem, organisation name or registration (AGENTS.md).
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import police_common as pc  # noqa: E402
from police_common import Mesh, empty, join_into, log, material  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(pc.ROOT, "public", "models", "police_heli.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None

ROTOR_R = 6.9  # main rotor radius (13.8 m disc)
ROTOR_BLADES = 5
HUB = Vector((0.0, 3.62, 0.0))
TAIL_R = 1.3
TAIL_BLADES = 4
TAIL_HUB = Vector((0.27, 2.75, -8.85))
LAMP = Vector((-0.62, 0.40, 2.90))  # searchlight gimbal, under the nose on the right
NOSE_Z, TAIL_Z = 4.42, -9.18

pc.reset()
SCENE = bpy.context.scene

# ---------------------------------------------------------------------------- materials

material("Paint", 0xF2F3F1, metallic=0.1, roughness=0.3, coat=0.7)
material("Band", 0x1C2F6B, metallic=0.2, roughness=0.3, coat=0.7)
material("Glass", 0x0F161E, metallic=0.4, roughness=0.08)  # opaque: no cabin inside
material("Trim", 0x17191C, roughness=0.6)
material("Rotor", 0x2A2C30, metallic=0.3, roughness=0.45)
material("Skid", 0x8C9096, metallic=0.8, roughness=0.35)
material("Sensor", 0x22262B, metallic=0.5, roughness=0.25)
material("AntiCollision", 0xC8141A, roughness=0.2, emissive=0xFF2020)
material("NavRed", 0xC8141A, roughness=0.2, emissive=0xFF2A1A)
material("NavGreen", 0x16A040, roughness=0.2, emissive=0x20FF60)
material("Strobe", 0xE8ECF0, roughness=0.15, emissive=0xFFFFFF)
material("SearchBody", 0x30343A, metallic=0.6, roughness=0.35)
material("SearchLens", 0xF4F6F8, roughness=0.05, emissive=0xFFFFFF)

# ---------------------------------------------------------------------------- fuselage loft

# Stations along the length: (z, half width, bottom y, top y). Cabin from the nose to the rear of
# the cabin (z −1.6), tapering into the tail boom, which ends at the fin.
STATIONS = [
    (4.36, 0.26, 0.98, 1.36),
    (4.22, 0.56, 0.76, 1.66),
    (3.95, 0.84, 0.64, 1.94),
    (3.45, 1.03, 0.57, 2.13),
    (2.75, 1.11, 0.55, 2.24),
    (2.55, 1.12, 0.55, 2.26),
    (1.35, 1.15, 0.55, 2.30),
    (1.25, 1.15, 0.55, 2.30),
    (0.0, 1.15, 0.55, 2.30),
    (-0.15, 1.15, 0.55, 2.30),
    (-1.0, 1.13, 0.57, 2.28),
    (-1.6, 1.04, 0.63, 2.24),
    (-2.4, 0.76, 0.94, 2.14),
    (-3.2, 0.42, 1.34, 2.05),
    (-5.0, 0.32, 1.45, 2.00),
    (-7.5, 0.22, 1.58, 1.95),
    (-8.75, 0.18, 1.62, 1.97),
]
# Rows of the cross-section, as heights normalised from −1 (keel) to +1 (roof): the band and the
# window line fall on rows, so their edges stay straight.
ROWS = [-1.0, -0.9, -0.65, -0.35, -0.1, 0.05, 0.18, 0.62, 0.8, 0.93, 1.0]
EXP = 2.6  # superellipse exponent of the sections


def half_x(w, v):
    return w * max(0.0, 1.0 - abs(v) ** EXP) ** (1.0 / EXP)


def body_material(row, z):
    """Glass for the side windows (cabin, with a door pillar at z 1.25–1.35) and the windscreen
    wrapping the nose; the band on two rows (lower on the boom); paint elsewhere."""
    is_cabin = 0.0 < z < 2.55
    is_pillar = 1.25 < z < 1.35 or -0.15 < z < 0.0
    if is_cabin and row in (6, 7) and not is_pillar:
        return "Glass"
    if z > 2.75 and row >= 6:
        return "Glass"
    if z > -2.4 and row == 3:
        return "Band"
    if z <= -2.4 and row in (2, 3):
        return "Band"
    return "Paint"


def build_fuselage():
    m = Mesh(["Paint", "Band", "Glass"])
    rings = []
    for z, w, y0, y1 in STATIONS:
        yc, h = (y0 + y1) / 2, (y1 - y0) / 2
        bottom = m.bm.verts.new((0.0, y0, z))
        top = m.bm.verts.new((0.0, y1, z))
        left = [m.bm.verts.new((half_x(w, v), yc + h * v, z)) for v in ROWS[1:-1]]
        right = [m.bm.verts.new((-half_x(w, v), yc + h * v, z)) for v in ROWS[1:-1]]
        # Ring order: keel, up the left (+X) side, roof, down the right side.
        rings.append([bottom, *left, top, *reversed(right)])
    n = len(rings[0])
    nrows = len(ROWS) - 1

    def row_of(k):
        return k if k < nrows else n - 1 - k

    for a, b, sa, sb in zip(rings, rings[1:], STATIONS, STATIONS[1:], strict=False):
        z_mid = (sa[0] + sb[0]) / 2
        for k in range(n):
            j = (k + 1) % n
            m.face([a[k], a[j], b[j], b[k]], body_material(row_of(k), z_mid))
    # Nose: a fan to the tip; tail: a flat cap behind the fin.
    tip = m.bm.verts.new((0.0, (STATIONS[0][2] + STATIONS[0][3]) / 2 + 0.05, NOSE_Z))
    first = rings[0]
    for k in range(n):
        j = (k + 1) % n
        m.face([first[j], first[k], tip], "Glass" if row_of(k) >= 6 else "Paint")
    m.face(list(reversed(rings[-1])), "Paint", facing=(0, 0, -1))
    ob = m.obj("Body", smooth=True)
    pc.mark_sharp(ob, 50)
    return ob


# ---------------------------------------------------------------------------- the rest of the body


def build_cowling():
    """Engine cowling on the cabin roof, the mast fairing, intakes and exhausts."""
    m = Mesh(["Paint", "Trim", "AntiCollision"])
    m.loft_z(
        [
            (0.85, 0.30, 2.18, 2.30),
            (0.55, 0.62, 2.20, 2.70),
            (0.0, 0.72, 2.22, 2.86),
            (-1.2, 0.72, 2.20, 2.86),
            (-2.0, 0.55, 2.10, 2.70),
            (-2.45, 0.25, 2.05, 2.45),
        ],
        "Paint",
        n=2.4,
        segs=16,
    )
    for x in (0.55, -0.55):
        m.box((x * 1.0, 2.55, 0.35), (0.08, 0.22, 0.42), "Trim")  # intakes
        m.tube((x * 0.9, 2.55, -1.85), (x * 1.05, 2.62, -2.35), 0.11, 0.12, "Trim", segs=10)  # exhausts
    m.tube((0.0, 2.80, 0.0), (0.0, 3.50, 0.0), 0.2, 0.15, "Trim", segs=12)  # mast
    m.ellipsoid((0.0, 2.90, -1.75), (0.06, 0.07, 0.06), "AntiCollision", segs=10, rows=5)
    m.ellipsoid((0.0, 0.53, -0.6), (0.06, 0.06, 0.06), "AntiCollision", segs=10, rows=5)
    return m.obj("Cowling", smooth=True)


def slab(m, outline, half_thickness, mat):
    """A thin plate in the YZ plane (fin) from its outline [(z, y)], both faces and edges."""
    left = [m.bm.verts.new((half_thickness, y, z)) for z, y in outline]
    right = [m.bm.verts.new((-half_thickness, y, z)) for z, y in outline]
    m.face(left, mat, facing=(1, 0, 0))
    m.face(list(reversed(right)), mat, facing=(-1, 0, 0))
    n = len(outline)
    for k in range(n):
        j = (k + 1) % n
        mid = Vector(((outline[k][0] + outline[j][0]) / 2, (outline[k][1] + outline[j][1]) / 2))
        centre = Vector((sum(z for z, _ in outline) / n, sum(y for _, y in outline) / n))
        out = (mid - centre).normalized()
        m.face([left[k], left[j], right[j], right[k]], mat, facing=(0, out.y, out.x))


def build_tail():
    m = Mesh(["Paint", "Band", "Skid", "NavRed", "NavGreen", "Strobe"])
    # Swept fin rising from the boom's end; the tail rotor turns on its left.
    slab(m, [(-7.85, 1.92), (-8.70, 3.95), (-9.18, 4.05), (-9.05, 1.70)], 0.06, "Paint")
    slab(m, [(-8.55, 1.64), (-8.95, 1.15), (-9.12, 1.15), (-9.0, 1.66)], 0.04, "Band")  # ventral fin
    # Horizontal stabiliser mid-boom, with end plates and the navigation lights at the tips.
    m.box((0.0, 1.86, -6.7), (2.6, 0.06, 0.55), "Paint")
    for sign, lamp in ((1, "NavRed"), (-1, "NavGreen")):
        m.box((sign * 1.30, 1.90, -6.75), (0.04, 0.42, 0.50), "Band")
        m.ellipsoid((sign * 1.34, 1.90, -6.55), (0.04, 0.04, 0.05), lamp, segs=8, rows=4)
    m.ellipsoid((0.0, 4.07, -9.10), (0.045, 0.045, 0.05), "Strobe", segs=8, rows=4)
    m.ellipsoid((0.0, 1.80, -8.82), (0.04, 0.04, 0.04), "Strobe", segs=8, rows=4)
    # Tail-rotor gearbox and shaft stub on the fin's left.
    m.tube((0.0, TAIL_HUB.y, TAIL_HUB.z), (TAIL_HUB.x - 0.04, TAIL_HUB.y, TAIL_HUB.z), 0.09, 0.07, "Skid", segs=10)
    return m.obj("Tail", smooth=False)


def build_skids():
    m = Mesh(["Skid", "Trim"])
    r = 0.045
    for x in (1.22, -1.22):
        m.tube((x, 0.05, -1.75), (x, 0.05, 1.90), r, r, "Skid", segs=8)
        m.tube((x, 0.05, 1.90), (x, 0.30, 2.28), r, r, "Skid", segs=8)  # upturned toe
        for z in (1.05, -1.05):
            m.tube((x, 0.05, z), (x * 0.78, 0.62, z), 0.04, 0.04, "Skid", segs=8)
    for z in (1.05, -1.05):
        m.tube((0.96, 0.60, z), (-0.96, 0.60, z), 0.04, 0.04, "Skid", segs=8)
    # Sensor turret under the nose (left) and the searchlight's yoke mount (right).
    m.tube((0.60, 0.55, 3.05), (0.60, 0.48, 3.05), 0.05, 0.05, "Trim", segs=8)
    m.ellipsoid((0.60, 0.36, 3.05), (0.17, 0.17, 0.17), "Trim", segs=12, rows=6)
    m.tube((LAMP.x, 0.56, LAMP.z), (LAMP.x, LAMP.y + 0.17, LAMP.z), 0.04, 0.04, "Trim", segs=8)
    m.box((LAMP.x, LAMP.y + 0.17, LAMP.z), (0.42, 0.03, 0.08), "Trim")
    for side in (1, -1):
        m.box((LAMP.x + side * 0.2, LAMP.y + 0.08, LAMP.z), (0.03, 0.18, 0.06), "Trim")
    return m.obj("Skids", smooth=False)


# ---------------------------------------------------------------------------- moving parts


def build_main_rotor(parent):
    """Five blades and the hub, built at the hub (world coordinates) and parented there."""
    m = Mesh(["Rotor", "Trim"])
    m.tube((HUB.x, HUB.y - 0.12, HUB.z), (HUB.x, HUB.y + 0.12, HUB.z), 0.30, 0.26, "Trim", segs=14)
    m.ellipsoid((HUB.x, HUB.y + 0.13, HUB.z), (0.22, 0.10, 0.22), "Trim", segs=12, rows=5)
    for i in range(ROTOR_BLADES):
        rot = Matrix.Rotation(2 * math.pi * i / ROTOR_BLADES, 3, "Y")
        # Grip, then the blade: chord 0.53 m at the root to 0.45 m at the tip, 50 mm thick.
        m.box(HUB + rot @ Vector((0.0, 0.0, 0.42)), (0.18, 0.08, 0.36), "Trim", rot=rot)
        inner, outer = 0.55, ROTOR_R
        verts = []
        for r, c in ((inner, 0.53), (outer, 0.45)):
            for dx, dy in ((-c / 2, -0.025), (c / 2, -0.025), (c / 2, 0.025), (-c / 2, 0.025)):
                verts.append(m.bm.verts.new(HUB + rot @ Vector((dx, dy, r))))
        a, b = verts[:4], verts[4:]
        for k in range(4):
            j = (k + 1) % 4
            m.face([a[k], a[j], b[j], b[k]], "Rotor")
        m.face(list(reversed(a)), "Rotor")
        m.face(b, "Rotor")
    return m.obj("MainRotor", parent, Matrix.Translation(HUB))


def build_tail_rotor(parent):
    """Four blades in the YZ plane on the fin's left, spinning about X."""
    m = Mesh(["Rotor", "Trim"])
    m.tube(TAIL_HUB + Vector((-0.06, 0, 0)), TAIL_HUB + Vector((0.08, 0, 0)), 0.11, 0.09, "Trim", segs=10)
    for i in range(TAIL_BLADES):
        rot = Matrix.Rotation(2 * math.pi * i / TAIL_BLADES, 3, "X")
        verts = []
        for r, c in ((0.12, 0.21), (TAIL_R, 0.18)):
            for dz, dx in ((-c / 2, -0.015), (c / 2, -0.015), (c / 2, 0.015), (-c / 2, 0.015)):
                verts.append(m.bm.verts.new(TAIL_HUB + rot @ Vector((dx, r, dz))))
        a, b = verts[:4], verts[4:]
        for k in range(4):
            j = (k + 1) % 4
            m.face([a[k], a[j], b[j], b[k]], "Rotor")
        m.face(list(reversed(a)), "Rotor")
        m.face(b, "Rotor")
    return m.obj("TailRotor", parent, Matrix.Translation(TAIL_HUB))


def build_searchlight(parent):
    """The lamp alone (the yoke is on the body): a drum along +Z with the lens on its front."""
    m = Mesh(["SearchBody", "SearchLens"])
    back, front = LAMP + Vector((0, 0, -0.20)), LAMP + Vector((0, 0, 0.14))
    m.tube(back, front, 0.13, 0.16, "SearchBody", segs=16, caps=False)
    m.tube(front, front + Vector((0, 0, 0.03)), 0.175, 0.175, "SearchBody", segs=16, caps=False)  # bezel
    segs = 16
    ring = [
        m.bm.verts.new(front + Vector((0.16 * math.cos(a), 0.16 * math.sin(a), 0.02)))
        for a in (2 * math.pi * k / segs for k in range(segs))
    ]
    m.face(ring, "SearchLens", facing=(0, 0, 1))
    back_ring = [
        m.bm.verts.new(back + Vector((0.13 * math.cos(a), 0.13 * math.sin(a), 0.0)))
        for a in (2 * math.pi * k / segs for k in range(segs))
    ]
    m.face(back_ring, "SearchBody", facing=(0, 0, -1))
    return m.obj("Searchlight", parent, Matrix.Translation(LAMP), smooth=True)


# ---------------------------------------------------------------------------- assemble

root = empty("PoliceHeli")
body = build_fuselage()
join_into(body, [build_cowling(), build_tail(), build_skids()])
body.parent = root
rotor = build_main_rotor(root)
tail_rotor = build_tail_rotor(root)
lamp = build_searchlight(root)

root["length"] = round(NOSE_Z - TAIL_Z, 3)
root["width"] = 2.6  # stabiliser span (the skids are 2.53 m apart outside)
root["height"] = 4.1
root["rotorRadius"] = ROTOR_R
root["rotorBlades"] = ROTOR_BLADES
root["rotorHubY"] = round(HUB.y, 3)
root["tailRotorRadius"] = TAIL_R
root["tailRotorBlades"] = TAIL_BLADES
root["searchlight"] = [round(LAMP.x, 3), round(LAMP.y, 3), round(LAMP.z, 3)]

pc.export_glb(OUT)
log(
    "exported",
    file=OUT,
    bytes=os.path.getsize(OUT),
    tris={o.name: pc.tris(o) for o in SCENE.objects if o.type == "MESH"},
    total=sum(pc.tris(o) for o in SCENE.objects if o.type == "MESH"),
)

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    cam = pc.preview_setup(lens=35, ground=14.0)
    rotor.rotation_euler.y = 0.3
    views = {
        "front-left": ((10.0, 4.0, 11.0), (0.0, 1.8, -1.5)),
        "rear-right": ((-10.0, 4.5, -12.0), (0.0, 1.8, -2.5)),
        "left": ((16.0, 2.2, -2.0), (0.0, 2.0, -2.0)),
        "top": ((0.5, 22.0, -1.0), (0.0, 0.0, -1.2)),
        "nose": ((-2.5, 0.6, 7.5), (-0.4, 0.8, 2.8)),
    }
    for view, (eye, target) in views.items():
        pc.render(cam, os.path.join(PREVIEW, f"police-heli-{view}.png"), eye, target)
    # Aimed: the lamp turned down and to the right, as the game aims it at a car.
    lamp.rotation_euler = (math.radians(50), math.radians(-30), 0.0)
    tail_rotor.rotation_euler.x = 0.5
    pc.render(cam, os.path.join(PREVIEW, "police-heli-aimed.png"), (-3.0, 0.7, 6.5), (-0.6, 0.4, 2.9))
