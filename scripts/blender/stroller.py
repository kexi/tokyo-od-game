# A形ベビーカー（SG基準 CPSA 0001 の A 形：生後 1 か月から、リクライニング付き）for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/stroller.py -- public/models/stroller.glb [preview-dir]
#
# Game coordinates (+Y up, travelling toward +Z, ground at y = 0, the stroller's left = +X),
# exported with export_yup=False. About 0.53 m wide, 0.88 m long and 1.0 m to the handle; pushed
# from behind (背面押し: the baby faces the direction of travel, the parent walks at −Z).
# The handle bar is placed where the existing pedestrian's hands are in a pushing pose (see
# PUSH_ARMS), so a human.glb person can push it without IK. Node tree (origins are the pivots):
#   Stroller                       frame, seat hammock, basket, grips (origin on the ground)
#     StrollerCanopy               幌; pivot on the hinge axis, rotation.x folds it back
#     StrollerCasterL / R          front swivel forks; pivot on the vertical swivel axis (rotation.y)
#       StrollerFrontWheelL / R    double wheels; origin on the axle, spin about X
#     StrollerRearWheelL / R       origin on the axle, spin about X
#     StrollerBaby                 a bundled baby under the canopy (the game may hide it)
# Positive rotation.x on a wheel rolls it toward +Z. Wheel radii, the caster trail and the pushing
# pose are also written to glTF extras (scene.extras.push, node extras). Fabric and frame colours
# are baseColorFactor on white-based materials, so the game can recolour with material.color.
# Textures come from assets/stroller/textures (scripts/textures/stroller_textures.py). No brand
# names or logos.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "stroller.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None
VIEWS = ARGS[2].split(",") if len(ARGS) > 2 else None  # optional subset of preview views
TEX = os.path.join(ROOT, "assets", "stroller", "textures")
HUMAN_GLB = os.path.join(ROOT, "public", "models", "human.glb")

# ---------------------------------------------------------------- pushing pose (human.py skeleton)
# Shoulder pivots at (±0.235, 1.40, 0); the elbow is 0.27 below the shoulder and the hand
# ellipsoid's centre 0.315 beyond the elbow along the forearm. human.ts bends joints about X only
# (negative = forward), so the hands stay in the planes x = ±0.235.
SHOULDER_Y = 1.40
HAND_X = 0.235
UPPER_ARM = 0.27
FOREARM = 0.315
PUSH_ARMS = {"UpperArm": -0.30, "Forearm": -0.80}


def hand_centre(upper, fore):
    """(y, z) of the hand centre relative to the person's root for the given joint angles."""
    ey = SHOULDER_Y - UPPER_ARM * math.cos(upper)
    ez = -UPPER_ARM * math.sin(upper)
    return ey - FOREARM * math.cos(upper + fore), ez - FOREARM * math.sin(upper + fore)


HAND_Y, HAND_DZ = hand_centre(PUSH_ARMS["UpperArm"], PUSH_ARMS["Forearm"])
HANDLE_Z = -0.44  # handle bar centre line (stroller-local z)
PERSON_Z = HANDLE_Z - HAND_DZ  # where the pushing person's root stands

# ---------------------------------------------------------------- frame layout
XS = 0.215  # side frames at the casters
XH = 0.25  # side tubes at the handle corners (slightly splayed so the bar spans the hands)
CORNER = 0.03  # handle corner bend
CY, CZ = 0.175, 0.34  # top of the front swivel axis
TRAIL = 0.04  # caster trail: the front axle sits this far behind the swivel axis
FRONT_R = 0.075
FRONT_GAP = 0.022  # each double wheel's two tyres at ±FRONT_GAP from the fork blade
REAR_R = 0.09
REAR_X, REAR_Z = 0.245, -0.24
REAR_LEG_X = 0.222
TUBE_R = 0.011
GRIP_R = 0.0165
HINGE_Y = 0.76  # canopy hinge height on the side tubes
CANOPY_H = 0.25
CANOPY_PHI = (math.radians(-15), math.radians(88))  # back bow → front bow, about the hinge axis
CANOPY_FOLDED = -1.15  # rotation.x that swings the open hood back behind the backrest


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


def material(name, color, metallic=0.0, roughness=0.5, image=None, double_sided=False):
    """Principled material; with an image the colour becomes glTF baseColorFactor (image × colour
    through a Mix MULTIPLY node), so white-based textures stay recolourable in the game."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(TEX, image))
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[7].default_value = lin(color)  # B (colour)
        nt.links.new(tex.outputs["Color"], mix.inputs[6])  # A (colour)
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    MAT[name] = m
    return m


material("StrollerFrame", 0xC9CDD3, metallic=0.75, roughness=0.32)  # anodised aluminium
material("StrollerPlastic", 0x1E2024, roughness=0.6)  # joints, caster forks, foam grips, basket
material("StrollerFabric", 0x2E3A57, roughness=0.85, image="stroller_fabric.png", double_sided=True)
material("StrollerTrim", 0xE4DED2, roughness=0.7)  # piping on the seat and the canopy's front edge
material("StrollerWheel", 0xFFFFFF, roughness=0.75, image="stroller_wheel.png")
material("StrollerBabySkin", 0xF0D0B8, roughness=0.6)
material("StrollerBlanket", 0xF3EFE7, roughness=0.9, double_sided=True)


# ---------------------------------------------------------------- mesh helpers
class Part:
    """One object being built: a bmesh in world coordinates plus its material slots."""

    def __init__(self, name, mats):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = mats

    def vert(self, p):
        return self.bm.verts.new(Vector(p))

    def face(self, verts, mat, uvs=None, smooth=True):
        f = self.bm.faces.new(verts)
        f.material_index = self.mats.index(mat)
        f.smooth = smooth
        if uvs:
            for loop, uv in zip(f.loops, uvs, strict=True):
                loop[self.uv].uv = uv
        return f

    def build(self, origin=(0.0, 0.0, 0.0), parent=None, extras=None):
        """Object whose origin (pivot) is `origin` (world); a parent must have no rotation."""
        origin = Vector(origin)
        bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=-origin)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        ob = bpy.data.objects.new(self.name, me)
        SCENE.collection.objects.link(ob)
        if parent:
            ob.parent = parent
            ob.location = origin - parent.matrix_world.translation
        else:
            ob.location = origin
        bpy.context.view_layer.update()
        for k, v in (extras or {}).items():
            ob[k] = v
        return ob


def frames(pts):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    n = len(pts)
    tangents = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    t0 = tangents[0]
    ref = Vector((1.0, 0.0, 0.0)) if abs(t0.x) < 0.9 else Vector((0.0, 1.0, 0.0))
    nrm = (ref - t0 * ref.dot(t0)).normalized()
    out = []
    for t in tangents:
        nrm = (nrm - t * nrm.dot(t)).normalized()
        out.append((t, nrm, t.cross(nrm)))
    return out


def tube(part, pts, r, mat, segs=8, caps=True, uv=None):
    """Swept circle along pts; uv(i, k) gives the UV at ring i, corner k (k = 0..segs)."""
    pts = [Vector(p) for p in pts]
    rings = []
    for p, (_t, nrm, bin_) in zip(pts, frames(pts), strict=True):
        rings.append(
            [
                part.vert(p + r * (math.cos(2 * math.pi * k / segs) * nrm + math.sin(2 * math.pi * k / segs) * bin_))
                for k in range(segs)
            ]
        )
    for i in range(len(rings) - 1):
        for k in range(segs):
            j = (k + 1) % segs
            uvs = [uv(i, k), uv(i, k + 1), uv(i + 1, k + 1), uv(i + 1, k)] if uv else None
            part.face([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]], mat, uvs)
    if caps:
        part.face(list(reversed(rings[0])), mat, smooth=False)
        part.face(rings[-1], mat, smooth=False)
    return rings


def cylinder_x(part, centre, r, length, mat, segs=10):
    """Short cylinder along X (hinge discs, axle pins)."""
    c = Vector(centre)
    tube(part, [c - Vector((length / 2, 0, 0)), c + Vector((length / 2, 0, 0))], r, mat, segs)


def cylinder_y(part, centre, r, height, mat, segs=10):
    c = Vector(centre)
    tube(part, [c - Vector((0, height / 2, 0)), c + Vector((0, height / 2, 0))], r, mat, segs)


def box(part, centre, size, mat, rot=None, double=False):
    """Box with optional rotation matrix; `double` adds inward faces (thin open shells)."""
    c = Vector(centre)
    rot = rot or Matrix.Identity(3)
    corners = [
        part.vert(c + rot @ Vector((dx * size[0] / 2, dy * size[1] / 2, dz * size[2] / 2)))
        for dx, dy, dz in [
            (-1, -1, -1),
            (1, -1, -1),
            (1, 1, -1),
            (-1, 1, -1),
            (-1, -1, 1),
            (1, -1, 1),
            (1, 1, 1),
            (-1, 1, 1),
        ]
    ]
    for q in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]:
        part.face([corners[i] for i in q], mat, smooth=False)


def box_between(part, a, b, width_x, depth, mat):
    """Bar of rectangular section from a to b (both in the y-z plane at the same x)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = Matrix.Rotation(math.atan2(d.z, d.y), 3, "X")  # local +Y along a → b
    box(part, (a + b) / 2, (width_x, d.length, depth), mat, rot)


def catmull(points, n):
    """Catmull-Rom spline through points, n samples per span."""
    pts = [Vector(p) for p in points]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2 = pts[max(i - 1, 0)], pts[i], pts[i + 1]
        p3 = pts[min(i + 2, len(pts) - 1)]
        for s in range(n):
            t = s / n
            out.append(
                0.5
                * (
                    2 * p1
                    + (-p0 + p2) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
                )
            )
    out.append(pts[-1])
    return out


def ellipsoid(part, centre, radii, mat, segs=10, rows=6, rot=None):
    c = Vector(centre)
    rot = rot or Matrix.Identity(3)
    top = part.vert(c + rot @ Vector((0, radii[1], 0)))
    bottom = part.vert(c + rot @ Vector((0, -radii[1], 0)))
    grid = []
    for r in range(1, rows):
        phi = math.pi * r / rows
        grid.append(
            [
                part.vert(
                    c
                    + rot
                    @ Vector(
                        (
                            radii[0] * math.sin(phi) * math.sin(2 * math.pi * i / segs),
                            radii[1] * math.cos(phi),
                            radii[2] * math.sin(phi) * math.cos(2 * math.pi * i / segs),
                        )
                    )
                )
                for i in range(segs)
            ]
        )
    for i in range(segs):
        j = (i + 1) % segs
        part.face([top, grid[0][j], grid[0][i]], mat)
        part.face([bottom, grid[-1][i], grid[-1][j]], mat)
        for k in range(len(grid) - 1):
            part.face([grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]], mat)


# ---------------------------------------------------------------- frame (Stroller)
SIDES = (1, -1)  # +1 = the stroller's left (+X)
C = {s: Vector((s * XS, CY, CZ)) for s in SIDES}
K = {s: Vector((s * XH, HAND_Y, HANDLE_Z)) for s in SIDES}  # side tube meets the bar line


def on_tube(s, y):
    """Point on side tube s at height y."""
    t = (y - CY) / (HAND_Y - CY)
    return C[s] + t * (K[s] - C[s])


def corner(s):
    """Handle corner: quadratic Bézier from the side tube into the bar (toward x = 0)."""
    d = (K[s] - C[s]).normalized()
    a, b = K[s] - CORNER * d, K[s] - Vector((s * CORNER, 0.0, 0.0))
    return [(1 - t) ** 2 * a + 2 * (1 - t) * t * K[s] + t * t * b for t in (k / 6 for k in range(7))]


frame = Part("Stroller", ["StrollerFrame", "StrollerPlastic", "StrollerFabric", "StrollerTrim"])
# Handle loop: left side tube → left corner → bar → right corner → right side tube.
loop = [C[1]] + corner(1) + list(reversed(corner(-1))) + [C[-1]]
tube(frame, loop, TUBE_R, "StrollerFrame")
# Foam grip over the bar and both corners.
tube(frame, corner(1) + list(reversed(corner(-1))), GRIP_R, "StrollerPlastic", segs=10)
for s in SIDES:
    joint = on_tube(s, 0.55)
    rear_foot = Vector((s * REAR_LEG_X, REAR_R, REAR_Z))
    tube(frame, [rear_foot, joint], 0.010, "StrollerFrame")  # rear leg
    d = (joint - rear_foot).normalized()
    box(frame, joint, (0.032, 0.07, 0.05), "StrollerPlastic", Matrix.Rotation(math.atan2(d.z, d.y), 3, "X"))
    box(frame, (s * 0.233, REAR_R, REAR_Z), (0.02, 0.05, 0.05), "StrollerPlastic")  # rear wheel mount
    cylinder_y(frame, (s * XS, CY + 0.015, CZ), 0.021, 0.04, "StrollerPlastic")  # caster socket
    # Armrest from the side tube forward to the bumper bar.
    a0 = on_tube(s, 0.63)
    a1 = Vector((s * (XS + 0.004), 0.645, 0.17))
    tube(frame, [a0, a1], 0.010, "StrollerFrame")
    box(frame, a0, (0.03, 0.045, 0.045), "StrollerPlastic")
    hinge = on_tube(s, HINGE_Y)
    cylinder_x(frame, (s * (abs(hinge.x) + 0.01), hinge.y, hinge.z), 0.024, 0.022, "StrollerPlastic", segs=12)
# Cross braces: footrest bar between the side tubes, a brace between the rear legs (raised so the
# pusher's toes clear it), and the brake pedal on the right rear mount.
tube(frame, [on_tube(1, 0.27), on_tube(-1, 0.27)], 0.009, "StrollerFrame")


def rear_leg_at(s, y):
    a, b = Vector((s * REAR_LEG_X, REAR_R, REAR_Z)), on_tube(s, 0.55)
    return a + (y - a.y) / (b.y - a.y) * (b - a)


tube(frame, [rear_leg_at(1, 0.20), rear_leg_at(-1, 0.20)], 0.009, "StrollerFrame")
box(frame, (-0.19, REAR_R + 0.03, REAR_Z - 0.045), (0.06, 0.016, 0.05), "StrollerPlastic")
# Padded bumper bar (安全ガード) in seat fabric.
bumper = catmull(
    [
        (XS + 0.004, 0.645, 0.17),
        (0.13, 0.655, 0.232),
        (0.0, 0.66, 0.248),
        (-0.13, 0.655, 0.232),
        (-(XS + 0.004), 0.645, 0.17),
    ],
    3,
)
tube(frame, bumper, 0.018, "StrollerFabric", segs=8, uv=lambda i, k: (0.05 + 0.02 * k / 8, 0.1 + 0.4 * i / 12))

# Under-seat basket: an open black shell.
bx, by0, by1, bz0, bz1 = 0.17, 0.14, 0.27, -0.15, 0.16
for centre, size in [
    ((0, by0, (bz0 + bz1) / 2), (2 * bx, 0.006, bz1 - bz0)),
    ((bx, (by0 + by1) / 2, (bz0 + bz1) / 2), (0.006, by1 - by0, bz1 - bz0)),
    ((-bx, (by0 + by1) / 2, (bz0 + bz1) / 2), (0.006, by1 - by0, bz1 - bz0)),
    ((0, (by0 + by1) / 2, bz0), (2 * bx, by1 - by0, 0.006)),
    ((0, (by0 + by1) / 2, bz1), (2 * bx, by1 - by0, 0.006)),
]:
    box(frame, centre, size, "StrollerPlastic")
tube(
    frame, [(bx, by1, bz0), (bx, by1, bz1), (-bx, by1, bz1), (-bx, by1, bz0), (bx, by1, bz0)], 0.006, "StrollerPlastic"
)

# Seat hammock: a U-shaped channel swept from the top of the backrest down to the foot rest.
# (y, z) of the path; the channel's walls rise toward the baby's side.
SEAT_PATH = [
    (0.835, -0.235),
    (0.64, -0.158),
    (0.455, -0.08),
    (0.43, 0.02),
    (0.45, 0.165),
    (0.37, 0.205),
    (0.30, 0.225),
]
seat_pts = catmull([(0.0, y, z) for y, z in SEAT_PATH], 3)
lengths = [0.0]
for a, b in zip(seat_pts, seat_pts[1:], strict=False):
    lengths.append(lengths[-1] + (b - a).length)
SEAT_W = 0.195


def seat_frame(i):
    """Tangent along the path and the inward normal (toward the baby) at sample i."""
    a, b = seat_pts[max(i - 1, 0)], seat_pts[min(i + 1, len(seat_pts) - 1)]
    t = (b - a).normalized()
    return t, Vector((0.0, t.z, -t.y))


SEAT_FRONT = min(range(len(seat_pts)), key=lambda i: (seat_pts[i] - Vector((0.0, 0.45, 0.165))).length)


def wall_height(i):
    """Side panels as high as the armrests along the backrest and seat, tapering over the foot rest."""
    if i <= SEAT_FRONT:
        return 0.15
    return 0.15 - 0.115 * (lengths[i] - lengths[SEAT_FRONT]) / (lengths[-1] - lengths[SEAT_FRONT])


def section(i):
    """Cross-section corners (x, offset along the inward normal) at sample i."""
    h = wall_height(i)
    return [
        (SEAT_W, h),
        (SEAT_W, 0.02),
        (SEAT_W - 0.03, -0.004),
        (0.0, -0.012),
        (-(SEAT_W - 0.03), -0.004),
        (-SEAT_W, 0.02),
        (-SEAT_W, h),
    ]


seat_rings = []
for i, p in enumerate(seat_pts):
    _t, nrm = seat_frame(i)
    seat_rings.append([frame.vert(p + Vector((x, 0, 0)) + nrm * off) for x, off in section(i)])
across = [0.0]
sec0 = section(len(seat_pts) // 2)
for (x0, o0), (x1, o1) in zip(sec0, sec0[1:], strict=False):
    across.append(across[-1] + math.hypot(x1 - x0, o1 - o0))
for i in range(len(seat_rings) - 1):
    v0, v1 = 1 - lengths[i] / lengths[-1], 1 - lengths[i + 1] / lengths[-1]
    for k in range(len(sec0) - 1):
        u0, u1 = 0.5 * across[k] / across[-1], 0.5 * across[k + 1] / across[-1]
        frame.face(
            [seat_rings[i][k], seat_rings[i][k + 1], seat_rings[i + 1][k + 1], seat_rings[i + 1][k]],
            "StrollerFabric",
            [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
        )
# Piping along both wall tops and across the top of the backrest.
for k in (0, -1):
    tube(frame, [ring[k].co.copy() for ring in seat_rings], 0.008, "StrollerTrim", segs=6)
tube(frame, [v.co.copy() for v in seat_rings[0]], 0.008, "StrollerTrim", segs=6)
stroller = frame.build()

# ---------------------------------------------------------------- canopy (幌)
hinge_l = on_tube(1, HINGE_Y)
HINGE = Vector((0.0, hinge_l.y, hinge_l.z))
CANOPY_W = abs(hinge_l.x) + 0.012
canopy = Part("StrollerCanopy", ["StrollerFabric", "StrollerTrim"])


def arch(phi, psi):
    """Point on the bow at angle phi (about the hinge axis) and psi (0 = left hinge … π = right)."""
    c, s = math.cos(psi), math.sin(psi)
    x = CANOPY_W * math.copysign(abs(c) ** 0.7, c)
    up = CANOPY_H * s**0.7
    return HINGE + Vector((x, up * math.cos(phi), up * math.sin(phi)))


NPHI, NPSI = 10, 14
phis = [CANOPY_PHI[0] + (CANOPY_PHI[1] - CANOPY_PHI[0]) * i / NPHI for i in range(NPHI + 1)]
psis = [math.pi * j / NPSI for j in range(NPSI + 1)]
ends = {0: canopy.vert(arch(0.0, 0.0)), NPSI: canopy.vert(arch(0.0, math.pi))}  # the bows meet at the hinges
grid = [[ends[j] if j in ends else canopy.vert(arch(phi, psi)) for j, psi in enumerate(psis)] for phi in phis]
for i in range(NPHI):
    for j in range(NPSI):
        uvs = [
            (0.5 + 0.5 * i / NPHI, j / NPSI),
            (0.5 + 0.5 * (i + 1) / NPHI, j / NPSI),
            (0.5 + 0.5 * (i + 1) / NPHI, (j + 1) / NPSI),
            (0.5 + 0.5 * i / NPHI, (j + 1) / NPSI),
        ]
        quad = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
        if j == 0:
            canopy.face([quad[0], quad[2], quad[3]], "StrollerFabric", [uvs[0], uvs[2], uvs[3]])
        elif j == NPSI - 1:
            canopy.face(quad[:3], "StrollerFabric", uvs[:3])
        else:
            canopy.face(quad, "StrollerFabric", uvs)
# Piping round the front edge.
tube(canopy, [arch(CANOPY_PHI[1], psi) for psi in psis], 0.009, "StrollerTrim", segs=6, caps=False)
canopy_ob = canopy.build(HINGE, stroller, {"openAngle": 0.0, "foldedAngle": CANOPY_FOLDED})

# ---------------------------------------------------------------- wheels
WHEEL_PROFILE = [(-0.5, 0.80), (-0.42, 0.95), (-0.18, 1.0), (0.18, 1.0), (0.42, 0.95), (0.5, 0.80)]


def wheel(part, cx, centre_yz, width, r, segs):
    """Tyre band (tread UV in the right half of stroller_wheel.png) plus hub faces on both sides
    (planar UV onto the five-spoke hub in the left half, so a spinning wheel is visible)."""
    cy_, cz_ = centre_yz
    rings = []
    for dx, rr in WHEEL_PROFILE:
        rings.append(
            [
                part.vert(
                    (
                        cx + dx * width,
                        cy_ + r * rr * math.cos(2 * math.pi * k / segs),
                        cz_ + r * rr * math.sin(2 * math.pi * k / segs),
                    )
                )
                for k in range(segs)
            ]
        )
    for a in range(len(rings) - 1):
        for k in range(segs):
            j = (k + 1) % segs
            u0, u1 = 0.5 + 0.5 * k / segs, 0.5 + 0.5 * (k + 1) / segs
            v0, v1 = a / (len(rings) - 1), (a + 1) / (len(rings) - 1)
            part.face(
                [rings[a][k], rings[a][j], rings[a + 1][j], rings[a + 1][k]],
                "StrollerWheel",
                [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
            )

    def hub_uv(v):
        rim = WHEEL_PROFILE[0][1] * r
        return (0.25 + 0.194 * (v.co.z - cz_) / rim, 0.5 + 0.3875 * (v.co.y - cy_) / rim)

    for ring in (rings[0], list(reversed(rings[-1]))):
        f = part.face(ring, "StrollerWheel", smooth=False)
        for loop in f.loops:
            loop[part.uv].uv = hub_uv(loop.vert)


casters = {}
for s, side in ((1, "L"), (-1, "R")):
    caster = Part(f"StrollerCaster{side}", ["StrollerPlastic"])
    swivel_bottom = Vector((s * XS, CY - 0.04, CZ))
    axle = Vector((s * XS, FRONT_R, CZ - TRAIL))
    cylinder_y(caster, (s * XS, CY - 0.02, CZ), 0.018, 0.04, "StrollerPlastic")
    box_between(caster, swivel_bottom, axle, 0.012, 0.03, "StrollerPlastic")  # fork blade
    cylinder_x(caster, axle, 0.007, 2 * FRONT_GAP + 0.02, "StrollerPlastic", segs=6)  # one draw call per fork
    caster_ob = caster.build((s * XS, CY, CZ), stroller, {"trail": TRAIL})
    casters[side] = caster_ob
    front = Part(f"StrollerFrontWheel{side}", ["StrollerWheel"])
    for dx in (-FRONT_GAP, FRONT_GAP):
        wheel(front, s * XS + dx, (FRONT_R, CZ - TRAIL), 0.02, FRONT_R, 12)
    bmesh.ops.recalc_face_normals(front.bm, faces=front.bm.faces)
    front.build(axle, caster_ob, {"radius": FRONT_R})
    rear = Part(f"StrollerRearWheel{side}", ["StrollerWheel"])
    wheel(rear, s * REAR_X, (REAR_R, REAR_Z), 0.032, REAR_R, 16)
    bmesh.ops.recalc_face_normals(rear.bm, faces=rear.bm.faces)
    rear.build((s * REAR_X, REAR_R, REAR_Z), stroller, {"radius": REAR_R})

# ---------------------------------------------------------------- baby (optional)
baby = Part("StrollerBaby", ["StrollerBabySkin", "StrollerBlanket"])
head_i = min(range(len(seat_pts)), key=lambda i: abs(seat_pts[i].y - 0.66))
t_head, n_head = seat_frame(head_i)
head = seat_pts[head_i] + n_head * 0.07
recline = Matrix.Rotation(math.atan2(-t_head.z, -t_head.y), 3, "X")  # the baby's up = along the backrest
ellipsoid(baby, head, (0.066, 0.072, 0.066), "StrollerBabySkin", segs=10, rows=6, rot=recline)
ellipsoid(baby, head + recline @ Vector((0, 0.024, -0.006)), (0.07, 0.058, 0.07), "StrollerBlanket", 10, 5, recline)
body_i = min(range(len(seat_pts)), key=lambda i: abs(lengths[i] - lengths[head_i] - 0.2))
t_body, n_body = seat_frame(body_i)
body_rot = Matrix.Rotation(math.atan2(-t_body.z, -t_body.y), 3, "X")
ellipsoid(baby, seat_pts[body_i] + n_body * 0.075, (0.112, 0.155, 0.06), "StrollerBlanket", 12, 6, body_rot)
baby.build(seat_pts[body_i], stroller)

PUSH = {
    "handleCentre": [0.0, round(HAND_Y, 4), HANDLE_Z],
    "handleStraightX": round(XH - CORNER, 4),
    "handsL": [HAND_X, round(HAND_Y, 4), HANDLE_Z],
    "handsR": [-HAND_X, round(HAND_Y, 4), HANDLE_Z],
    "personRoot": [0.0, 0.0, round(PERSON_Z, 4)],
    "upperArm": PUSH_ARMS["UpperArm"],
    "forearm": PUSH_ARMS["Forearm"],
    "frontWheelRadius": FRONT_R,
    "rearWheelRadius": REAR_R,
    "casterTrail": TRAIL,
    "canopyFolded": CANOPY_FOLDED,
}
SCENE["push"] = PUSH

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
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SCENE.objects if o.type == "MESH"}
log("exported", file=OUT, bytes=os.path.getsize(OUT), tris=tris, total=sum(tris.values()), push=PUSH)
corners = [o.matrix_world @ Vector(c) for o in SCENE.objects if o.type == "MESH" for c in o.bound_box]
log(
    "bounds",
    x=[round(min(c.x for c in corners), 3), round(max(c.x for c in corners), 3)],
    y=[round(min(c.y for c in corners), 3), round(max(c.y for c in corners), 3)],
    z=[round(min(c.z for c in corners), 3), round(max(c.z for c in corners), 3)],
)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    gbm = bmesh.new()
    for p in [(-6, 0, -6), (6, 0, -6), (6, 0, 6), (-6, 0, 6)]:
        gbm.verts.new(p)
    gbm.faces.new(gbm.verts)
    gme = bpy.data.meshes.new("Ground")
    gbm.to_mesh(gme)
    gme.materials.append(material("Ground", 0x8A8C8E, roughness=0.9))
    SCENE.collection.objects.link(bpy.data.objects.new("Ground", gme))
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(-55), math.radians(30), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 50
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = 32
    SCENE.render.resolution_x = 960
    SCENE.render.resolution_y = 540

    def shoot(view, eye, target, lens=50):
        if VIEWS and view not in VIEWS:
            return
        cam.data.lens = lens
        cam.location = eye
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"stroller-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view)

    for view, (eye, target) in {
        "front-left": ((1.7, 1.15, 2.0), (0.0, 0.52, -0.02)),
        "side": ((2.7, 0.62, -0.02), (0.0, 0.52, -0.02)),
        "front": ((0.0, 0.75, 2.6), (0.0, 0.52, 0.0)),
        "rear-right": ((-1.7, 1.35, -2.0), (0.0, 0.6, -0.1)),
    }.items():
        shoot(view, eye, target)

    # The existing pedestrian pushing it. human.glb is Y-up glTF; the importer turns it Z-up
    # (glTF (x, y, z) → Blender (x, −z, y)), so an Empty rotated −90° about X brings it back.
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=HUMAN_GLB)
    parts = {o.name: o for o in bpy.data.objects if o not in before}
    person = bpy.data.objects.new("Person", None)
    SCENE.collection.objects.link(person)
    person.rotation_euler.x = -math.pi / 2
    person.location = (0.0, 0.0, PERSON_Z)
    for o in parts.values():
        o.parent = person
    for lower, upper in (
        ("ForearmL", "UpperArmL"),
        ("ForearmR", "UpperArmR"),
        ("ShinL", "ThighL"),
        ("ShinR", "ThighR"),
    ):
        parts[lower].parent = parts[upper]
        parts[lower].matrix_parent_inverse = Matrix.Translation(-parts[upper].location)
    for name in ("HairLong", "HairBun"):
        parts[name].hide_render = True
    tints = {
        "Skin": (0.85, 0.66, 0.52, 1),
        "Shirt": (0.80, 0.42, 0.30, 1),
        "Pants": (0.20, 0.22, 0.28, 1),
        "Hair": (0.08, 0.06, 0.05, 1),
    }
    for m in {s.material for o in parts.values() if o.type == "MESH" for s in o.material_slots}:
        rgba = tints.get(m.name.split(".")[0])
        tex = next((n for n in m.node_tree.nodes if n.type == "TEX_IMAGE"), None)
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not (rgba and tex and bsdf):
            continue
        mix = m.node_tree.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[7].default_value = rgba
        m.node_tree.links.new(tex.outputs["Color"], mix.inputs[6])
        m.node_tree.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    for side in "LR":
        parts[f"UpperArm{side}"].rotation_mode = "XYZ"
        parts[f"Forearm{side}"].rotation_mode = "XYZ"
        parts[f"UpperArm{side}"].rotation_euler.x = PUSH_ARMS["UpperArm"]
        parts[f"Forearm{side}"].rotation_euler.x = PUSH_ARMS["Forearm"]
    for name in ("ThighL", "ThighR", "ShinL", "ShinR"):
        parts[name].rotation_mode = "XYZ"
    shoot("push-side", (3.6, 1.0, -0.35), (0.0, 0.82, -0.35), lens=40)
    shoot("push-rear", (-1.7, 1.7, -2.9), (0.0, 0.8, -0.45))
    shoot("push-hands", (0.75, 1.35, -0.05), (0.18, 1.0, -0.44), lens=60)
    # Walking (human.ts animateHuman at phase 1.0, 1.1 m/s), with the canopy folded back.
    hip_amp = 0.3 + 1.1 * 0.12
    for name, offset in (("R", 0.0), ("L", math.pi)):
        p = 1.0 + offset
        parts[f"Thigh{name}"].rotation_euler.x = -hip_amp * math.sin(p)
        parts[f"Shin{name}"].rotation_euler.x = 0.08 + max(0.0, math.cos(p)) ** 2 * 0.9
    canopy_ob.rotation_euler.x = CANOPY_FOLDED
    shoot("walk-folded", (3.6, 1.0, -0.35), (0.0, 0.82, -0.35), lens=40)
    shoot("walk-front-left", (1.9, 1.4, 1.6), (0.0, 0.75, -0.35))
