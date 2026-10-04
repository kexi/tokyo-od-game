# Interior of the player's car (右ハンドル) for the driver's-seat camera of TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/cockpit.py -- public/models/cockpit.glb [preview-dir] [car.glb]
#
# Same frame as car.glb (+Y up, +Z forward, +X = the car's left, metres, origin at the physics
# body centre, ground at y −0.86), exported with export_yup=False, so "Cockpit" can be added to
# the car model's root as is. The cabin is fitted to the exterior by reading car.glb itself
# (default public/models/car.glb, so build the car first): the windscreen, side and hatch glass
# faces and the paint around them give the window openings, the trim surfaces (the body shell
# pushed inward) and the inner windshield, so pillars, roof and door lines meet the exterior.
#
# Hook nodes (see knowledge/cockpit-blender.md; the same numbers are written to each node's glTF
# extras, i.e. three.js userData):
#   SteeringWheel, Stalk_*, WiperArm_*   rest rotation is a pure rotation about X, local +Z points
#                                        away from the driver, so obj.rotation.z = angle turns it
#                                        clockwise as seen from the driver's seat. Needle_* have no
#                                        rest rotation of their own under Cluster (tilted that way).
#   Mirror_* / MirrorSurface_*           local +Z = mirror normal toward the driver; UVs run so a
#                                        camera at the mirror looking along the reflected ray maps
#                                        onto them unflipped.
#   Windshield                           inner glass with planar 0–1 UVs (u → driver's right,
#                                        v → up the glass) for the rain shader.
#   DriverEye                            empty whose −Z looks forward (a three.js camera child): the
#                                        50th-percentile Japanese man's eye; extras carry the
#                                        package (H-point, BOF, R point, V1/V2).
#   ClockAnchor                          empty under Cluster where the dash clock goes.
# Textures come from assets/cockpit/textures (scripts/textures/cockpit_textures.py).
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEX = os.path.join(ROOT, "assets", "cockpit", "textures")
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "cockpit.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 and ARGS[1] else None
CAR_GLB = os.path.abspath(ARGS[2]) if len(ARGS) > 2 else os.path.join(ROOT, "public", "models", "car.glb")

GROUND_Y = -0.86
DRIVER_X = -0.37  # right-hand drive: the driver sits on −X
# ---------------------------------------------------------------------------- driver package
# Laid out from the feet up, as SAE J1100 packages are (knowledge/cockpit-blender.md has the
# sources and the checks). Until 2026-10-05 the eye was put 0.64 m above and 0.17 m behind a seat
# set 0.75 m from the pedal with the wheel only 0.36 m from it: a 150 cm woman's seat with a 171 cm
# man's eye behind it, whose thighs met the rim.
FLOOR_Y = -0.575  # accelerator heel point (AHP): the carpet under the heel
H30 = 0.255  # seat height: H-point above the AHP
# Ball of foot on the undepressed accelerator (BOF): 0.105 m above the floor, in line with the
# driver's right hip.
BOF = Vector((DRIVER_X - 0.08, FLOOR_Y + 0.105, 0.84))
WHEEL_CENTER = Vector((DRIVER_X, 0.065, 0.30))  # 0.54 m behind the BOF (UMTRI's cars: 0.45–0.65)
SEAT_CUSHION_DEG = 12.0
# The design driver: AIST 1991-92 young men, 50th percentile (stature, sitting height and sitting
# eye height, m).
DESIGN_MAN = (1.713, 0.926, 0.800)


def leg_stature(stature, sitting_height):
    """Stature of a USAF-proportioned driver (sitting height 52.0% of stature, from the USAF column
    of the same AIST tables) with these legs: SAM was fitted to US drivers, seat position follows
    the legs, and young Japanese men sit 54.0% of their stature."""
    return (stature - sitting_height) / (1 - 0.520)


def sam_seat(stature, w=None):
    """H-point, m aft of the BOF, that drivers of this (leg) stature choose: SAE Seating
    Accommodation Model, Flannagan et al. 1998, Eq. 8, automatic transmission."""
    w = BOF.z - WHEEL_CENTER.z if w is None else w
    mm = 16.83 + 0.433 * stature * 1000 - 0.24 * H30 * 1000 - 2.19 * SEAT_CUSHION_DEG + 0.41 * w * 1000
    return mm / 1000


# The seat is where the 50th-percentile man puts it (SAM, in leg stature). His eye is the mean US eye of Manary et al.
# (1998, Table 4: 641 mm above the seat height, ~50 mm behind SAM's mean H-point) scaled by his
# sitting eye height against the US 50/50 mix: (800 − 90) / (768 − 90) mm.
H_POINT = Vector((DRIVER_X, FLOOR_Y + H30, BOF.z - sam_seat(leg_stature(*DESIGN_MAN[:2]))))
EYE_SCALE = (DESIGN_MAN[2] - 0.09) / (0.768 - 0.09)
EYE = H_POINT + Vector((0.0, 0.641 * EYE_SCALE, -0.050 * EYE_SCALE))
# UN R125 R point: SAM's 95th-percentile seat for a 50/50 Japanese population, which is the men's
# 90th percentile (Eq. 12): AIST men 1,714 ± 62.6 mm with a 926 mm sitting height, in leg stature.
_men = leg_stature(1.714, 0.926)
_sd = 0.0626 * _men / 1.714
R_POINT = Vector(
    (DRIVER_X, H_POINT.y, BOF.z - sam_seat(_men) - 1.2816 * math.sqrt(0.187 * (_sd * 1000) ** 2 + 885) / 1000)
)
# V1/V2 are 68 mm behind it and 665 / 589 mm above (Table I).
V1 = R_POINT + Vector((0.005, 0.665, -0.068))
V2 = R_POINT + Vector((0.005, 0.589, -0.068))
COLUMN_DEG = 24.0  # column axis above horizontal = wheel plane leaning 24° from vertical
WHEEL_R = 0.185  # 370 mm wheel
RIM_R = 0.0165
STEER_RATIO = 15.0
# The meters are read through the wheel's upper opening: from EYE the rim's inner top edge passes
# just above the cluster's top edge (2026-10-05: was y 0.112, for an eye 3 cm lower and 15 cm back).
CLUSTER_CENTER = Vector((DRIVER_X, 0.075, 0.62))
HOOD_TOP = 0.19  # cluster visor top at its rear lip (was 0.217): well under R125's 4° plane from V2
SHELL_INSET = 0.04  # trim surfaces sit this far inside the body skin
SPEED_MAX, TACHO_MAX = 180.0, 8000.0
DIAL_START, DIAL_SWEEP = -120.0, 240.0  # clock angle of zero, total sweep (cockpit_textures.py)
SMALL_START, SMALL_SWEEP = -45.0, 90.0
# Blender's glTF importer turns car.glb's +Y-up data into Blender's +Z-up: undo that.
TO_GAME = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


def r3(v):
    return [round(float(c), 4) for c in v]


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


# ---------------------------------------------------------------------------- the car body


def load_body():
    """car.glb's Body as a welded bmesh in game coordinates, plus its material names."""
    bpy.ops.import_scene.gltf(filepath=CAR_GLB)
    body = bpy.data.objects["Body"]
    names = [m.name for m in body.data.materials]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(TO_GAME)
    # Draco quantises each primitive (= material) on its own, so seams are ~0.3 mm apart.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0012)
    bm.normal_update()
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            coll.remove(d)
    return bm, names


BODY, BODY_MATS = load_body()
BODY.faces.ensure_lookup_table()


def mat_of(f):
    return BODY_MATS[f.material_index]


def flood(seed, ok):
    seen = {seed}
    stack = [seed]
    while stack:
        f = stack.pop()
        for e in f.edges:
            for g in e.link_faces:
                if g not in seen and ok(g):
                    seen.add(g)
                    stack.append(g)
    return seen


_glass = [f for f in BODY.faces if mat_of(f) == "Glass"]
SHELL = flood(max(_glass, key=lambda f: f.calc_area()), lambda f: True)  # the lofted skin
_ws_seed = min(
    (f for f in _glass if f in SHELL), key=lambda f: (f.calc_center_median() - Vector((0, 0.42, 0.5))).length
)
WINDSCREEN = flood(_ws_seed, lambda f: mat_of(f) == "Glass")
SIDE_GLASS = [f for f in _glass if f in SHELL and f not in WINDSCREEN and abs(f.normal.x) > 0.4]
GLASS = [f for f in _glass if f in SHELL]
MIRROR_GLASS = [f for f in BODY.faces if mat_of(f) == "Mirror"]


def bvh_of(faces):
    bm = bmesh.new()
    vmap = {}
    for f in faces:
        vs = []
        for v in f.verts:
            if v not in vmap:
                vmap[v] = bm.verts.new(v.co)
            vs.append(vmap[v])
        bm.faces.new(vs)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


BVH_OUTER = bvh_of(SHELL)
BVH_GLASS = bvh_of(GLASS)
BVH_WINDSCREEN = bvh_of(WINDSCREEN)


def band_table(faces, step=0.02):
    """Side-glass bottom (belt) and top edge heights per z, interpolated over the pillars."""
    lo, hi, count = {}, {}, {}
    for f in faces:
        for v in f.verts:
            k = round(v.co.z / step)
            lo[k] = min(lo.get(k, 9.0), v.co.y)
            hi[k] = max(hi.get(k, -9.0), v.co.y)
            count[k] = count.get(k, 0) + 1
    keys = sorted(k for k in lo if count[k] >= 6)  # a lone window corner is not a band

    def at(table, z):
        k = z / step
        below = [q for q in keys if q <= k]
        above = [q for q in keys if q >= k]
        if not below:
            return table[keys[0]]
        if not above:
            return table[keys[-1]]
        a, b = below[-1], above[0]
        if a == b:
            return table[a]
        t = (k - a) / (b - a)
        return table[a] * (1 - t) + table[b] * t

    return (lambda z: at(lo, z)), (lambda z: at(hi, z))


BELT, GLASS_TOP = band_table(SIDE_GLASS)


def windscreen_edges():
    """Bottom edge (x → z, y) of the windscreen glass, from its boundary vertices."""
    ws = set(WINDSCREEN)
    bottom = {}
    for f in WINDSCREEN:
        for e in f.edges:
            if sum(1 for g in e.link_faces if g in ws) == 1:
                for v in e.verts:
                    if v.co.z > 0.7:
                        bottom[v.index] = v.co.copy()
    pts = sorted(bottom.values(), key=lambda p: p.x)
    return pts


WS_BOTTOM = windscreen_edges()


def glass_base(x):
    """Windscreen bottom edge at x (clamped to the glass width)."""
    pts = WS_BOTTOM
    x = min(max(x, pts[0].x), pts[-1].x)
    for a, b in zip(pts, pts[1:], strict=False):
        if a.x <= x <= b.x:
            t = 0 if b.x == a.x else (x - a.x) / (b.x - a.x)
            return a.z + (b.z - a.z) * t, a.y + (b.y - a.y) * t
    return pts[-1].z, pts[-1].y


log(
    "body",
    faces=len(BODY.faces),
    shell=len(SHELL),
    windscreen=len(WINDSCREEN),
    side_glass=len(SIDE_GLASS),
    belt={z: round(BELT(z), 3) for z in (0.8, 0.4, 0.0, -0.36, -0.8, -1.4)},
    glass_top={z: round(GLASS_TOP(z), 3) for z in (0.8, 0.4, 0.0, -0.36, -0.8, -1.4)},
    ws_bottom=[r3(WS_BOTTOM[0]), r3(WS_BOTTOM[len(WS_BOTTOM) // 2]), r3(WS_BOTTOM[-1])],
)


# ---------------------------------------------------------------------------- materials


def lin(hex_color):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (ch((hex_color >> 16) & 255), ch((hex_color >> 8) & 255), ch(hex_color & 255), 1.0)


MAT = {}
IMAGES = {}
TILE = {}  # material → metres per texture repeat (box-projected UVs)


def image(name):
    path = os.path.join(TEX, name)
    if not os.path.exists(path):
        log("texture_missing", file=name)
        return None
    if name not in IMAGES:
        IMAGES[name] = bpy.data.images.load(path)
    return IMAGES[name]


def material(
    name, color=0xFFFFFF, metallic=0.0, roughness=0.6, tex=None, glow=None, glow_tex=False, alpha=1.0, cull=True
):
    """Principled material. `glow` = emission colour; `glow_tex` = texture drives emission."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = cull
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    img = image(tex) if tex else None
    if img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        if glow_tex != "only":
            nt.links.new(node.outputs["Color"], b.inputs["Base Color"])
        if glow_tex:
            nt.links.new(node.outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = 1.0
    if glow is not None:
        b.inputs["Emission Color"].default_value = lin(glow)
        b.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    MAT[name] = m
    return m


material("Dash", tex="plastic_grain.png", roughness=0.78)
TILE["Dash"] = 0.22
material("DashTrim", 0x3B3E44, roughness=0.55)
material("Gloss", 0x0A0B0D, roughness=0.12)
material("Satin", 0x9A9EA5, metallic=0.85, roughness=0.32)
material("Chrome", 0xC9CDD3, metallic=1.0, roughness=0.18)
material("Vent", 0x0C0D0F, roughness=0.85)
material("Seat", tex="fabric_seat.png", roughness=0.95)
TILE["Seat"] = 0.16
material("SeatTrim", 0x2B2D31, roughness=0.6)
material("Headliner", tex="fabric_headliner.png", roughness=0.95)
TILE["Headliner"] = 0.25
material("Pillar", 0xB5B2AA, roughness=0.62)
material("DoorTrim", 0x34363B, roughness=0.6)
material("DoorFabric", tex="fabric_seat.png", roughness=0.95)
TILE["DoorFabric"] = 0.16
material("Carpet", 0x232427, roughness=1.0)
material("Seal", 0x111214, roughness=0.7, cull=False)
material("Grip", 0x1A1B1D, roughness=0.55)
material("WiperMetal", 0x141518, metallic=0.3, roughness=0.5)
material("WiperRubber", 0x08090A, roughness=0.85)
material("ClusterBack", 0x060708, roughness=0.45)
material("Needle", 0xFF5A20, roughness=0.4, glow=0xFF4A12)
material("Gauge_Speed", tex="gauge_speed.png", roughness=0.4, glow_tex=True)
material("Gauge_Tacho", tex="gauge_tacho.png", roughness=0.4, glow_tex=True)
material("Gauge_Fuel", tex="gauge_small.png", roughness=0.4, glow_tex=True)
material("Gauge_Temp", tex="gauge_small.png", roughness=0.4, glow_tex=True)
# Tell-tales: black when off; the symbol is the emission map (game sets emissiveIntensity).
for lamp in ("Lamp_TurnL", "Lamp_TurnR", "Lamp_HighBeam", "Lamp_Parking"):
    material(lamp, 0x050506, roughness=0.3, tex="telltales.png", glow_tex="only")
material("Display_Center", 0x07080A, roughness=0.12)
material("HVACPanel", tex="hvac_panel.png", roughness=0.5)
material("ShiftGate", tex="shift_gate.png", roughness=0.4)
material("Speaker", tex="speaker_grille.png", roughness=0.8)
TILE["Speaker"] = 0.05
for name in ("MirrorSurface_Rear", "MirrorSurface_SideR", "MirrorSurface_SideL"):
    material(name, 0xA9B1B9, metallic=1.0, roughness=0.04)
material("Windshield", 0xFFFFFF, roughness=0.05, alpha=0.06)


# ---------------------------------------------------------------------------- mesh helpers


def frame(origin, x_axis, y_axis):
    """4×4 matrix with columns x, y, z = x × y (orthonormalised), translation `origin`."""
    x = Vector(x_axis).normalized()
    z = x.cross(Vector(y_axis)).normalized()
    y = z.cross(x)
    o = Vector(origin)
    return Matrix(((x.x, y.x, z.x, o.x), (x.y, y.y, z.y, o.y), (x.z, y.z, z.z, o.z), (0, 0, 0, 1)))


def facing(origin, normal, up=(0.0, 1.0, 0.0)):
    """Frame whose +Z is `normal`, +Y as close to `up` as possible, +X = Y × Z (viewer's right)."""
    z = Vector(normal).normalized()
    y = (Vector(up) - z * Vector(up).dot(z)).normalized()
    return frame(origin, y.cross(z), y)


def rot_x(deg, origin=(0, 0, 0)):
    return Matrix.Translation(Vector(origin)) @ Matrix.Rotation(math.radians(deg), 4, "X")


class Part:
    """One bmesh → one object; material slots appear in first-use order."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def poly(self, pts, mat, uvs=None, M=None):
        vs = [self.bm.verts.new((M @ Vector(p)) if M is not None else Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(mat)
        if uvs:
            for loop, uv in zip(f.loops, uvs, strict=True):
                loop[self.uv].uv = uv
        return f

    def grid(self, rows, mat, closed=False, flip=False, uv=None, M=None):
        """Quads between consecutive rows of points (all rows the same length)."""
        verts = [[self.bm.verts.new((M @ Vector(p)) if M is not None else Vector(p)) for p in row] for row in rows]
        n = len(rows[0])
        faces = []
        for i in range(len(rows) - 1):
            for j in range(n if closed else n - 1):
                j2 = (j + 1) % n
                idx = [(i, j), (i, j2), (i + 1, j2), (i + 1, j)]
                if flip:
                    idx.reverse()
                q = [verts[a][b] for a, b in idx]
                if len({id(v) for v in q}) < 4 or (q[0].co - q[2].co).length < 1e-7:
                    continue
                try:
                    f = self.bm.faces.new(q)
                except ValueError:
                    continue
                f.material_index = self.mi(mat)
                if uv:
                    for loop, (a, b) in zip(f.loops, idx, strict=True):
                        loop[self.uv].uv = uv(a, b)
                faces.append(f)
        return verts, faces

    def box(self, M, size, mat, bevel=0.0, segs=2, center=(0, 0, 0)):
        """Box of `size` centred at local `center`, transformed by M; bevelled edges optional."""
        sx, sy, sz = (s / 2 for s in size)
        c = Vector(center)
        corners = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
        vs = [self.bm.verts.new(M @ (c + Vector((dx * sx, dy * sy, dz * sz)))) for dx, dy, dz in corners]
        quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
        flip = M.to_3x3().determinant() < 0
        faces = []
        for q in quads:
            f = self.bm.faces.new([vs[i] for i in (reversed(q) if flip else q)])
            f.material_index = self.mi(mat)
            faces.append(f)
        if bevel > 0:
            edges = list({e for f in faces for e in f.edges})
            bmesh.ops.bevel(
                self.bm,
                geom=edges,
                offset=min(bevel, min(size) * 0.49),
                offset_type="OFFSET",
                segments=segs,
                profile=0.5,
                affect="EDGES",
                clamp_overlap=True,
            )
        return faces

    def lathe(self, M, profile, segs, mat, sx=1.0, sy=1.0, mats=None):
        """Revolve [(r, z)] about local Z (bottom → top); r = 0 ends close to a point."""
        rings = []
        for r, z in profile:
            if r < 1e-6:
                rings.append([Vector((0, 0, z))] * segs)
            else:
                rings.append(
                    [
                        Vector(
                            (r * sx * math.cos(2 * math.pi * k / segs), r * sy * math.sin(2 * math.pi * k / segs), z)
                        )
                        for k in range(segs)
                    ]
                )
        verts = []
        for ring in rings:
            if (ring[0] - ring[-1]).length < 1e-9 and ring[0].xy.length < 1e-6:
                v = self.bm.verts.new(M @ ring[0])
                verts.append([v] * segs)
            else:
                verts.append([self.bm.verts.new(M @ p) for p in ring])
        flip = M.to_3x3().determinant() < 0
        for i in range(len(rings) - 1):
            m = self.mi(mats[i] if mats else mat)
            for k in range(segs):
                k2 = (k + 1) % segs
                q = [verts[i][k], verts[i][k2], verts[i + 1][k2], verts[i + 1][k]]
                uniq = []
                for v in q:
                    if v not in uniq:
                        uniq.append(v)
                if len(uniq) < 3:
                    continue
                if flip:
                    uniq.reverse()
                try:
                    f = self.bm.faces.new(uniq)
                except ValueError:
                    continue
                f.material_index = m

    def cyl(self, M, r, z0, z1, segs, mat, cap_mat=None, r1=None):
        """Closed cylinder (or cone to r1) along local Z."""
        r1 = r if r1 is None else r1
        self.lathe(M, [(0, z0), (r, z0), (r1, z1), (0, z1)], segs, mat, mats=[mat, mat, cap_mat or mat])

    def tube(self, pts, radius, segs, mat, closed=False):
        """Circle swept along a polyline (parallel transport frames)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        tangents = []
        for i in range(n):
            a = pts[(i - 1) % n] if (closed or i > 0) else pts[i]
            b = pts[(i + 1) % n] if (closed or i < n - 1) else pts[i]
            tangents.append((b - a).normalized())
        ref = Vector((0, 1, 0)) if abs(tangents[0].y) < 0.9 else Vector((1, 0, 0))
        normal = (ref - tangents[0] * ref.dot(tangents[0])).normalized()
        rings = []
        for i in range(n):
            t = tangents[i]
            normal = (normal - t * normal.dot(t)).normalized()
            binormal = t.cross(normal)
            rings.append(
                [
                    pts[i]
                    + (normal * math.cos(2 * math.pi * k / segs) + binormal * math.sin(2 * math.pi * k / segs)) * radius
                    for k in range(segs)
                ]
            )
        if closed:
            rings.append(rings[0])
        verts, faces = self.grid(rings, mat, closed=True)
        if not closed:
            self.poly(list(reversed(rings[0])), mat)
            self.poly(rings[-1], mat)
        return faces

    def finish(self, name, parent=None, basis=None, sharp=50.0):
        bm = self.bm
        for f in bm.faces:
            scale = TILE.get(self.mats[f.material_index])
            if not scale:
                continue
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            a, b = [(2, 1), (0, 2), (0, 1)][ax]
            for loop in f.loops:
                co = loop.vert.co
                loop[self.uv].uv = (co[a] / scale, co[b] / scale)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp):
                e.smooth = False
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        for p in me.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new(name, me)
        SCENE.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        if basis is not None:
            ob.matrix_basis = basis
        return ob


def empty(name, parent=None, basis=None):
    ob = bpy.data.objects.new(name, None)
    SCENE.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    if basis is not None:
        ob.matrix_basis = basis
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == "MESH" else 0


ROOT_NODE = empty("Cockpit")
ROOT_NODE["frame"] = "car.glb chassis: +Y up, +Z forward, +X = car's left, metres"
ROOT_NODE["hide_in_car_glb"] = (
    "Body primitives with materials Interior and Seat (crude cabin) and Wiper (the parked wipers; "
    "WiperArm_* replace them)"
)


# ---------------------------------------------------------------------------- windshield


def plane_fit(points):
    a = np.array([tuple(p) for p in points])
    c = a.mean(axis=0)
    _, _, vt = np.linalg.svd(a - c)
    return Vector(c), Vector(vt[2])


def build_windshield():
    """Inner face of the windscreen: the body's glass faces 4 mm inward, planar 0–1 UVs."""
    p = Part()
    vmap = {}
    for f in WINDSCREEN:
        vs = []
        for v in f.verts:
            if v not in vmap:
                vmap[v] = p.bm.verts.new(v.co - v.normal * 0.004)
            vs.append(vmap[v])
        p.bm.faces.new(list(reversed(vs))).material_index = p.mi("Windshield")
    centre, n = plane_fit([v.co for v in vmap.values()])
    if n.y < 0:
        n = -n  # outward (up-forward)
    e_u = Vector((-1, 0, 0))  # driver's right
    e_u = (e_u - n * e_u.dot(n)).normalized()
    e_v = n.cross(e_u).normalized()  # up the glass
    if e_v.y < 0:
        e_v = -e_v
    us = [(v.co - centre).dot(e_u) for v in vmap.values()]
    vs_ = [(v.co - centre).dot(e_v) for v in vmap.values()]
    u0, u1, v0, v1 = min(us), max(us), min(vs_), max(vs_)
    for f in p.bm.faces:
        for loop in f.loops:
            d = loop.vert.co - centre
            loop[p.uv].uv = ((d.dot(e_u) - u0) / (u1 - u0), (d.dot(e_v) - v0) / (v1 - v0))
    ob = p.finish("Windshield", ROOT_NODE, sharp=80)
    origin = centre + e_u * u0 + e_v * v0  # car-frame point of uv (0, 0)
    info = {
        "uv_origin": r3(origin),
        "u_axis": r3(e_u),
        "v_axis": r3(e_v),
        "size_m": [round(u1 - u0, 4), round(v1 - v0, 4)],
        "normal_out": r3(n),
    }
    for k, v in info.items():
        ob[k] = v
    return ob, info


windshield, WS = build_windshield()
WS_ORIGIN = Vector(WS["uv_origin"])
WS_U, WS_V = Vector(WS["u_axis"]), Vector(WS["v_axis"])
WS_W, WS_H = WS["size_m"]


def to_ws_uv(p):
    d = Vector(p) - WS_ORIGIN
    return (d.dot(WS_U) / WS_W, d.dot(WS_V) / WS_H)


# ---------------------------------------------------------------------------- trim shell


def classify(c):
    """Trim class of a body face centre: door (below the belt), pillar or headliner."""
    if c.y < BELT(c.z) - 0.003:
        return "DoorTrim"
    if c.y <= GLASS_TOP(c.z) + 0.003:
        return "Pillar"  # window band between glasses: A/B/C/D pillars
    if c.z > 0.08 and abs(c.x) > 0.62:
        return "Pillar"  # A-pillar beside the windscreen
    if c.z < -1.36 and abs(c.x) > 0.66:
        return "Pillar"  # D-pillar beside the hatch glass
    return "Headliner"


def build_shell():
    """Body skin minus glass, un-subdivided, pushed SHELL_INSET inward, faces turned inward.

    Window openings follow the glass edges exactly; a reveal strip joins each trim edge to the
    glass so nothing shows through the gap.
    """
    bm = BODY.copy()
    bm.faces.ensure_lookup_table()
    keep = set()
    for f in SHELL:
        m = mat_of(f)
        c = f.calc_center_median()
        if m not in ("Paint", "Blackout") or c.z > 0.935 or c.y < -0.62:
            continue
        keep.add(f.index)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    before = len(bm.faces)
    # glTF stores triangles: rebuild the loft's quads, then undo one subdivision level.
    bmesh.ops.join_triangles(
        bm, faces=bm.faces, angle_face_threshold=math.radians(40), angle_shape_threshold=math.radians(60)
    )
    quads = len(bm.faces)
    bmesh.ops.unsubdivide(bm, verts=bm.verts, iterations=1)
    bm.normal_update()
    log("shell_unsubdivide", before=before, quads=quads, after=len(bm.faces))
    bm.verts.ensure_lookup_table()
    outer = [v.co.copy() for v in bm.verts]
    normals = [v.normal.copy() for v in bm.verts]
    cls = {}
    for f in bm.faces:
        cls[f.index] = classify(f.calc_center_median())
    glass_edges = []
    for e in bm.edges:
        if not e.is_boundary:
            continue
        mid = (e.verts[0].co + e.verts[1].co) / 2
        hit = BVH_GLASS.find_nearest(mid)
        if hit[0] is not None and hit[3] < 0.003:
            f = e.link_faces[0]
            glass_edges.append((e.verts[0].index, e.verts[1].index, f.calc_center_median(), cls[f.index]))
    for v in bm.verts:
        v.co = outer[v.index] - normals[v.index] * SHELL_INSET
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.normal_update()
    parts = {"DoorTrim": Part(), "Pillar": Part(), "Headliner": Part()}
    vmaps = {k: {} for k in parts}
    for f in bm.faces:
        k = cls[f.index]
        p, vmap = parts[k], vmaps[k]
        vs = []
        for v in f.verts:
            if v.index not in vmap:
                vmap[v.index] = p.bm.verts.new(v.co)
            vs.append(vmap[v.index])
        p.bm.faces.new(vs).material_index = p.mi(k)
    inner = [v.co.copy() for v in bm.verts]
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    # Reveals: trim edge → glass edge (2.5 mm inside the glass), facing into the opening.
    rev = parts["Pillar"]
    for a, b, fc, _k in glass_edges:
        oa = outer[a] - normals[a] * 0.0025
        ob_ = outer[b] - normals[b] * 0.0025
        f = rev.poly([inner[a], inner[b], ob_, oa], "Seal")
        f.normal_update()
        into = ((inner[a] + inner[b]) / 2 - fc).normalized()
        if f.normal.dot(into) < 0:
            f.normal_flip()
    return parts, tree


SHELL_PARTS, BVH_INNER = build_shell()


def wall(y, z, side, start=0.25):
    """Inner trim surface hit from the cabin toward side (±1): (point, inward normal) or None."""
    hit = BVH_INNER.ray_cast(Vector((side * start, y, z)), Vector((side, 0, 0)), 1.5)
    if hit[0] is None:
        return None
    n = hit[1] if hit[1].x * side < 0 else -hit[1]
    return hit[0], n


def outer_x(y, z, side):
    hit = BVH_OUTER.ray_cast(Vector((side * 0.2, y, z)), Vector((side, 0, 0)), 1.5)
    return abs(hit[0].x) if hit[0] is not None else 0.92


def wall_x(y, z, side, embed=0.012):
    """|x| for a part that should end just inside the trim but never poke out of the body."""
    w = wall(y, z, side)
    x = abs(w[0].x) + embed if w else outer_x(y, z, side) - 0.008
    return min(x, outer_x(y, z, side) - 0.006)


# ---------------------------------------------------------------------------- dashboard

dash = Part()


def dash_profile(x, driver_zone):
    zb, yb = glass_base(x)
    t = min(0.19, yb - 0.013)
    pts = [
        (zb + 0.07, yb - 0.03),
        (zb - 0.01, yb - 0.013),
        (0.78, t),
        (0.66, t - 0.005),
    ]
    if driver_zone:  # opening for the cluster under the hood
        pts += [(0.645, t - 0.007), (0.645, 0.10), (0.645, 0.05), (0.645, 0.0), (0.55, -0.002)]
    else:
        pts += [(0.565, t - 0.012), (0.53, t - 0.02), (0.505, t - 0.04), (0.495, t - 0.075), (0.495, 0.05)]
    pts += [
        (0.505, 0.015),
        (0.53, -0.04),
        (0.565, -0.15),
        (0.60, -0.25),
        (0.66, -0.31),
        (0.76, -0.34),
        (0.90, -0.35),
    ]
    return pts


OPEN_X = (-0.578, -0.162)  # cluster opening (car x), just inside the hood's skirts
HOOD_X = (-0.592, -0.148)


def dash_loft(xs, driver_zone):
    rows = []
    for x in xs:
        rows.append([Vector((x, y, z)) for z, y in dash_profile(x, driver_zone)])
    return rows


def clamp_end(row, side):
    out = []
    for p in row:
        x = max(0.845, wall_x(p.y, p.z, side))
        out.append(Vector((side * x, p.y, p.z)))
    return out


def dash_side_cap(x, a_zone, b_zone, toward):
    """Wall between two dash profiles at x (cluster opening sides); faces toward ±X."""
    a = dash_profile(x, a_zone)
    b = dash_profile(x, b_zone)
    for i in range(len(a) - 1):
        q = [(x, a[i][1], a[i][0]), (x, a[i + 1][1], a[i + 1][0]), (x, b[i + 1][1], b[i + 1][0]), (x, b[i][1], b[i][0])]
        uniq = []
        for v in q:
            if all((Vector(v) - Vector(u)).length > 1e-6 for u in uniq):
                uniq.append(v)
        if len(uniq) < 3:
            continue
        f = dash.poly(uniq, "Dash")
        f.normal_update()
        if f.normal.x * toward < 0:
            f.normal_flip()


def build_dash():
    left = [0.84, 0.78, 0.72, 0.62, 0.50, 0.38, 0.26, 0.14, 0.02, -0.10, OPEN_X[1]]
    mid = [OPEN_X[1], -0.26, -0.37, -0.48, OPEN_X[0]]
    right = [OPEN_X[0], -0.62, -0.72, -0.78, -0.84]
    # Profiles run cowl → floor and rows run +X → −X: unflipped quads then face the cabin.
    for xs, zone in ((left, False), (mid, True), (right, False)):
        rows = dash_loft(xs, zone)
        if xs[0] > 0.8:
            rows.insert(0, clamp_end(rows[0], 1))
        if xs[-1] < -0.8:
            rows.append(clamp_end(rows[-1], -1))
        dash.grid(rows, "Dash")
    dash_side_cap(OPEN_X[1], False, True, -1)
    dash_side_cap(OPEN_X[0], False, True, 1)
    # End caps (mostly buried in the door trims).
    for side in (1, -1):
        row = clamp_end(dash_loft([side * 0.84], False)[0], side)
        f = dash.poly(row, "Dash")
        f.normal_update()
        if f.normal.x * side > 0:  # face the cabin, not the door
            f.normal_flip()


build_dash()
DASH_TREE = BVHTree.FromBMesh(dash.bm)


def dash_hit(x, y, z, direction=(0, 0, 1)):
    hit = DASH_TREE.ray_cast(Vector((x, y, z)), Vector(direction), 1.0)
    return hit[0], hit[1]


def dash_top(x, z):
    hit = DASH_TREE.ray_cast(Vector((x, 0.5, z)), Vector((0, -1, 0)), 1.0)
    return hit[0].y if hit[0] is not None else 0.18


def build_hood():
    """Cluster visor: arched shell over the opening, skirts resting on the dash top."""
    zs = [0.74, 0.70, 0.65, 0.60, 0.555, 0.52, 0.505]
    nx = 22
    outer_rows, inner_rows = [], []
    for k, z in enumerate(zs):
        o, i = [], []
        lip = 0.004 * (k == len(zs) - 1)
        for j in range(nx + 1):
            t = j / nx
            x = HOOD_X[1] + (HOOD_X[0] - HOOD_X[1]) * t
            base = dash_top(x, z) - 0.008
            s = math.sin(math.pi * t) ** 0.5  # flat top, rounded shoulders
            top = HOOD_TOP - 0.004 * (z - 0.505) / 0.235
            y = base + (top - base) * s - lip
            o.append(Vector((x, y, z)))
            i.append(Vector((x, y - 0.012 * s - 0.0005, z)))
        outer_rows.append(o)
        inner_rows.append(i)
    dash.grid(outer_rows, "Dash", flip=True)
    dash.grid(inner_rows, "Dash", flip=False)
    dash.grid([outer_rows[-1], inner_rows[-1]], "Dash", flip=True)  # rolled lip


build_hood()


def vent(M, w, h, slats, depth=0.025):
    """Rectangular air vent in frame M (+Z toward the cabin): bezel ring, dark throat, slats."""
    dash.box(M, (w + 0.014, h + 0.014, 0.012), "Satin", bevel=0.004, center=(0, 0, -0.004))
    dash.box(M, (w, h, depth), "Vent", center=(0, 0, -depth / 2 + 0.0035))
    for k in range(slats):
        y = -h / 2 + h * (k + 0.5) / slats
        dash.box(M @ rot_x(-12), (w - 0.006, 0.0025, 0.016), "Gloss", center=(0, y, -0.004))


# Outer vents (dash ends) and centre vents in the upper dash face.
for vx in (0.715, -0.715):
    zf, nf = dash_hit(vx, 0.105, 0.3)
    if zf is not None:
        vent(facing(zf + nf * 0.002, nf), 0.105, 0.055, 4)
for vx in (0.055, -0.095):
    # Below the centre display, which stands in front of the dash face here (was y 0.095).
    zf, nf = dash_hit(vx, 0.075, 0.3)
    if zf is not None:
        vent(facing(zf + nf * 0.002, nf), 0.085, 0.045, 3)
# Satin accent strip across the passenger side of the upper dash face.
accent = []
for x in np.linspace(0.80, 0.14, 12):
    col = []
    for y in (0.068, 0.058):
        hit = DASH_TREE.ray_cast(Vector((x, y, 0.2)), Vector((0, 0, 1)), 1.0)
        col.append(hit[0] + hit[1] * 0.0025 if hit[0] is not None else Vector((x, y, 0.5)))
    accent.append(col)
dash.grid(accent, "Satin")
# Defroster grille along the windscreen base.
for gx in (-0.42, 0.0, 0.42):
    z = 0.84
    y = dash_top(gx, z)
    dash.box(Matrix.Translation((gx, y + 0.0005, z)), (0.30, 0.004, 0.025), "Vent", bevel=0.0015)

# Centre display on the dash top (Display_Center is a separate node with 0–1 UVs). Its top edge
# stays 6 mm under the plane through V2 declined 1° (R125 5.1.3.4 tolerates what lies between the
# 1° and 4° planes if it covers ≤ 20% of area S; display_visibility logs the share). Until
# 2026-10-05 its top was at y 0.30, above V2 itself, and stood in the view ahead-left. It stands
# on the dash's rear edge (z 0.495, where the upper dash face ends): lowered at z 0.585 it sank
# behind the dash top and the lowest ~15% of the screen was hidden from DriverEye.
DISPLAY_C = Vector((-0.02, 0.18, 0.495))
for _ in range(3):
    _n = (EYE + Vector((0.18, 0.0, 0.0)) - DISPLAY_C).normalized()
    _up = (Vector((0, 1, 0)) - _n * _n.y).normalized()
    _top = DISPLAY_C + _up * 0.07
    DISPLAY_C.y += V2.y - math.tan(math.radians(1.0)) * (_top.z - V2.z) - 0.006 - _top.y
DISPLAY_N = (EYE + Vector((0.18, 0.0, 0.0)) - DISPLAY_C).normalized()
DISPLAY_M = facing(DISPLAY_C, DISPLAY_N)
dash.box(DISPLAY_M, (0.228, 0.14, 0.022), "Gloss", bevel=0.006, center=(0, 0, -0.012))
_stand_z = DISPLAY_C.z + 0.06  # the foot behind the screen, on the dash top
dash.box(
    Matrix.Translation((DISPLAY_C.x, dash_top(DISPLAY_C.x, _stand_z) + 0.012, _stand_z)),
    (0.09, 0.03, 0.07),
    "Gloss",
    bevel=0.01,
)

# Centre stack: from the dash face down to the console, carrying the HVAC panel.
STACK_X = (-0.125, 0.105)
stack_rows = []
for y, z in ((0.035, 0.5), (-0.02, 0.495), (-0.12, 0.50), (-0.20, 0.53), (-0.27, 0.56)):
    x0, x1 = STACK_X
    stack_rows.append([Vector((x1, y, z + 0.04)), Vector((x1, y, z)), Vector((x0, y, z)), Vector((x0, y, z + 0.04))])
dash.grid(stack_rows, "DashTrim", flip=True)
HVAC_W, HVAC_H = 0.19, 0.095
hvac_c = Vector(((STACK_X[0] + STACK_X[1]) / 2, -0.07, 0.495))
hvac_n = Vector((0, math.sin(math.radians(8)), -math.cos(math.radians(8))))
HVAC_M = facing(hvac_c + hvac_n * 0.002, hvac_n)
hw, hh = HVAC_W / 2, HVAC_H / 2
dash.poly(
    [(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0)],
    "HVACPanel",
    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
    M=HVAC_M,
)
dash.box(HVAC_M, (HVAC_W + 0.012, HVAC_H + 0.012, 0.01), "Gloss", bevel=0.003, center=(0, 0, -0.0055))
for u in (0.2, 0.5, 0.8):  # knob centres match hvac_panel.png
    kc = Vector(((u - 0.5) * HVAC_W, 0.0, 0.0))
    dash.cyl(HVAC_M @ Matrix.Translation(kc), 0.12 * HVAC_H, 0.0, 0.014, 20, "Satin", cap_mat="Gloss")
for k in range(4):
    bc = Vector(((0.2 + 0.2 * k - 0.5) * HVAC_W, (0.15 - 0.5) * HVAC_H, 0.0))
    dash.box(
        HVAC_M @ Matrix.Translation(bc), (0.16 * HVAC_W * 0.9, 0.18 * HVAC_H * 0.85, 0.006), "DashTrim", bevel=0.002
    )

# Glovebox panel (passenger side, slightly proud of the lower dash).
glove = []
for x in (0.62, 0.50, 0.38, 0.26, 0.17):
    row = []
    for y in (0.0, -0.05, -0.10, -0.15):
        hit = DASH_TREE.ray_cast(Vector((x, y, 0.2)), Vector((0, 0, 1)), 1.0)
        row.append(hit[0] + hit[1] * 0.0035 if hit[0] is not None else Vector((x, y, 0.55)))
    glove.append(row)
dash.grid(glove, "DashTrim")

# Steering column shroud (static; the wheel turns in front of it).
COLUMN_M = rot_x(COLUMN_DEG, WHEEL_CENTER)  # +Z forward along the column, +Y wheel-up
dash.box(COLUMN_M, (0.13, 0.11, 0.26), "DashTrim", bevel=0.025, segs=3, center=(0, -0.012, 0.21))
dash.cyl(COLUMN_M, 0.032, 0.055, 0.09, 20, "SeatTrim")

# Pedals (driver's footwell): brake left of the accelerator (the driver's right is −X). The
# accelerator is an organ pedal hinged on the floor, its pad along the sole of a foot with the heel
# on the floor and the ball on BOF (34° for the 50th-percentile man); the brake hangs from the
# dash, 5.5 cm higher and 4 cm nearer. Until 2026-10-05 both pads leaned the wrong way (top toward
# the driver, so a sole met them edge-on) and sat 14 cm further back.
FOOT_DEG = 34.0
_u = Vector((0.0, math.sin(math.radians(FOOT_DEG)), math.cos(math.radians(FOOT_DEG))))  # heel → toe
_n = Vector((0.0, _u.z, -_u.y))  # pad face normal, toward the sole
acc_c = BOF - _u * 0.03 - _n * 0.006
dash.box(rot_x(90.0 - FOOT_DEG, acc_c), (0.055, 0.17, 0.012), "Gloss", bevel=0.004)
_hinge = acc_c - _u * 0.085
dash.box(
    Matrix.Translation((_hinge.x, (_hinge.y + FLOOR_Y) / 2, _hinge.z)),
    (0.045, _hinge.y - FLOOR_Y + 0.01, 0.03),
    "SeatTrim",
    bevel=0.004,
)
brake_c = Vector((DRIVER_X + 0.07, BOF.y + 0.055, BOF.z - 0.04))
dash.box(rot_x(40.0, brake_c), (0.075, 0.065, 0.012), "Satin", bevel=0.004)
_arm0 = brake_c + Vector((0.0, math.cos(math.radians(40.0)), math.sin(math.radians(40.0)))) * 0.03
_arm1 = Vector((brake_c.x, -0.22, 0.95))  # pivot inside the dash
_d = _arm1 - _arm0
dash.box(
    rot_x(math.degrees(math.atan2(_d.z, _d.y)), (_arm0 + _arm1) / 2),
    (0.02, _d.length, 0.015),
    "SeatTrim",
)

dashboard = dash.finish("Dashboard", ROOT_NODE)
dashboard["note"] = "static; contains the column shroud, pedals, HVAC panel and vents"

display = Part()
dw, dh = 0.2, 0.115
display.poly(
    [(-dw / 2, -dh / 2, 0), (dw / 2, -dh / 2, 0), (dw / 2, dh / 2, 0), (-dw / 2, dh / 2, 0)],
    "Display_Center",
    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
)
display_ob = display.finish("Display_Center", ROOT_NODE, basis=DISPLAY_M @ Matrix.Translation((0, 0, 0.0005)))
display_ob["uv"] = "u → viewer's right, v → up (render a map / UI texture into it)"


# ---------------------------------------------------------------------------- cluster

CLUSTER_TILT = math.degrees(math.atan2(EYE.y - CLUSTER_CENTER.y, CLUSTER_CENTER.z - EYE.z))
CLUSTER_M = rot_x(CLUSTER_TILT, CLUSTER_CENTER)  # +Z into the face, +X = car's left
SPEED_C, SPEED_S = Vector((-0.1035, 0.0, 0.0)), 0.118
TACHO_C, TACHO_S = Vector((0.1, 0.0, 0.0)), 0.108
TEMP_C, FUEL_C, SMALL_S = Vector((0.022, -0.032, 0.0)), Vector((-0.022, -0.032, 0.0)), 0.04
LAMPS = {
    "Lamp_TurnL": (Vector((0.031, 0.044, 0.0)), 0),
    "Lamp_HighBeam": (Vector((0.0, 0.044, 0.0)), 2),
    "Lamp_TurnR": (Vector((-0.031, 0.044, 0.0)), 1),
    "Lamp_Parking": (Vector((0.0, 0.014, 0.0)), 3),
}
LAMP_S = 0.017

cluster_part = Part()
cluster_part.box(Matrix.Identity(4), (0.335, 0.135, 0.01), "ClusterBack", bevel=0.012, center=(0, 0, 0.006))
for c, s in ((SPEED_C, SPEED_S), (TACHO_C, TACHO_S), (TEMP_C, SMALL_S), (FUEL_C, SMALL_S)):
    r = 0.47 * s
    cluster_part.lathe(
        Matrix.Translation(c), [(r, 0.0), (r, -0.0035), (r + 0.004, -0.0035), (r + 0.004, 0.001)], 48, "Satin"
    )
cluster = cluster_part.finish("Cluster", ROOT_NODE, basis=CLUSTER_M)


def dial_plane(name, centre, size, uv_rect=(0, 0, 1, 1)):
    """Square dial face in the cluster plane, seen from the driver (local −Z): u → driver's right."""
    p = Part()
    h = size / 2
    u0, v0, u1, v1 = uv_rect
    # Local +X is the driver's left, so u runs toward −X.
    pts = [(h, -h, 0), (-h, -h, 0), (-h, h, 0), (h, h, 0)]
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    f = p.poly(pts, name, uvs=uvs)
    f.normal_update()
    if f.normal.z > 0:  # must face the driver (−Z)
        f.normal_flip()
    return p.finish(name, cluster, basis=Matrix.Translation(centre))


gauge_speed = dial_plane("Gauge_Speed", SPEED_C, SPEED_S)
gauge_tacho = dial_plane("Gauge_Tacho", TACHO_C, TACHO_S)
gauge_fuel = dial_plane("Gauge_Fuel", FUEL_C, SMALL_S, (0, 0, 0.5, 1))
gauge_temp = dial_plane("Gauge_Temp", TEMP_C, SMALL_S, (0.5, 0, 1, 1))


def needle(name, centre, dial_radius, start_deg, deg_per_unit, unit, vmax, width):
    """Needle pointing at the zero mark at rest; local +Z into the dial, so rotation.z = +angle
    turns it clockwise as the driver sees it."""
    p = Part()
    a = math.radians(start_deg)
    d = Vector((-math.sin(a), math.cos(a), 0))  # clock angle → local (X = driver's left)
    side = Vector((-d.y, d.x, 0))
    L = dial_radius * 0.9
    tail = dial_radius * 0.12
    z = -0.004
    pts = [
        -d * tail + side * width * 0.8,
        -d * tail - side * width * 0.8,
        d * L - side * width * 0.25,
        d * L + side * width * 0.25,
    ]
    f = p.poly([Vector((q.x, q.y, z)) for q in pts], "Needle")
    f.normal_update()
    if f.normal.z > 0:
        f.normal_flip()
    p.cyl(Matrix.Translation((0, 0, -0.0085)), dial_radius * 0.13, 0.0, 0.0045, 20, "ClusterBack")
    ob = p.finish(name, cluster, basis=Matrix.Translation(centre))
    ob["axis"] = "local +Z (into the dial); rotation.z = +value*rad_per_unit, clockwise as seen by the driver"
    ob["rest"] = f"points at 0 {unit} (clock angle {start_deg:+.0f}°)"
    ob["deg_per_unit"] = deg_per_unit
    ob["rad_per_unit"] = math.radians(deg_per_unit)
    ob["unit"] = unit
    ob["max"] = vmax
    return ob


needle_speed = needle(
    "Needle_Speed", SPEED_C, 0.47 * SPEED_S, DIAL_START, DIAL_SWEEP / SPEED_MAX, "km/h", SPEED_MAX, 0.0028
)
needle_tacho = needle(
    "Needle_Tacho", TACHO_C, 0.47 * TACHO_S, DIAL_START, DIAL_SWEEP / TACHO_MAX, "rpm", TACHO_MAX, 0.0026
)
needle_fuel = needle(
    "Needle_Fuel", FUEL_C, 0.47 * SMALL_S, SMALL_START, SMALL_SWEEP, "fraction (0 = E, 1 = F)", 1.0, 0.0016
)
needle_temp = needle(
    "Needle_Temp", TEMP_C, 0.47 * SMALL_S, SMALL_START, SMALL_SWEEP, "fraction (0 = C, 1 = H)", 1.0, 0.0016
)

for name, (c, cell) in LAMPS.items():
    p = Part()
    h = LAMP_S / 2
    pts = [(h, -h, -0.0006), (-h, -h, -0.0006), (-h, h, -0.0006), (h, h, -0.0006)]
    uvs = [(cell / 4, 0), ((cell + 1) / 4, 0), ((cell + 1) / 4, 1), (cell / 4, 1)]
    f = p.poly(pts, name, uvs=uvs)
    f.normal_update()
    if f.normal.z > 0:
        f.normal_flip()
    ob = p.finish(name, cluster, basis=Matrix.Translation(c))
    ob["material"] = f"{name} (emissiveMap = symbol; emissiveIntensity 0 = off)"


# ---------------------------------------------------------------------------- steering wheel


def build_wheel():
    p = Part()
    ident = Matrix.Identity(4)
    # Rim: torus in the local XY plane, slightly oval grip section.
    nu, nv = 56, 12
    rows = []
    for i in range(nu + 1):
        a = 2 * math.pi * i / nu
        ring = []
        for k in range(nv):
            b = 2 * math.pi * k / nv
            rr = WHEEL_R + RIM_R * math.cos(b)
            ring.append(Vector((rr * math.cos(a), rr * math.sin(a), RIM_R * 1.12 * math.sin(b))))
        rows.append(ring)
    p.grid(rows, "Grip", closed=True, flip=True)
    # Hub / horn pad toward the driver (local −Z); plain, no badge.
    # Lathe faces point outward when the profile runs toward +Z, so list it front → back.
    pad = [(0.0, -0.064), (0.05, -0.062), (0.072, -0.052), (0.078, -0.03), (0.074, -0.002), (0.0, -0.002)]
    p.lathe(ident, pad, 32, "Grip", sx=1.12, sy=0.95)
    # Spokes at 3 and 9 o'clock with switch blocks, and a lower spoke at 6 o'clock.
    for s in (1, -1):
        p.box(ident, (0.10, 0.05, 0.016), "Grip", bevel=0.007, center=(s * 0.125, -0.012, -0.01))
        p.box(ident, (0.045, 0.034, 0.008), "Gloss", bevel=0.003, center=(s * 0.112, -0.004, -0.02))
        for k in range(3):
            p.box(ident, (0.01, 0.008, 0.004), "Satin", bevel=0.0015, center=(s * (0.098 + 0.012 * k), 0.003, -0.025))
    p.box(ident, (0.05, 0.12, 0.016), "Grip", bevel=0.007, center=(0, -0.115, -0.008))
    return p.finish("SteeringWheel", ROOT_NODE, basis=COLUMN_M)


steering = build_wheel()
steering["axis"] = "local +Z = column axis, pointing forward-down away from the driver"
steering["column_deg_above_horizontal"] = COLUMN_DEG
steering["ratio"] = STEER_RATIO
steering["rotation_z_per_steer_rad"] = -STEER_RATIO
steering["usage"] = "rotation.z = -steer * 15 (steer > 0 = left, as physics/vehicle.ts)"


def stalk(name, side, label):
    """Column stalk pivoting about an axis parallel to the column (local Z); side −1 = right."""
    pivot = Vector((side * 0.06, 0.018, 0.10))
    M = COLUMN_M @ Matrix.Translation(pivot)
    p = Part()
    pts = [Vector((side * 0.008 * k, -0.002 * k, 0.004 * k)) for k in range(0, 18)]
    p.tube(pts, 0.0085, 12, "SeatTrim")
    tip = pts[-1]
    tip_m = frame(tip, Vector((0, 0, 1)), Vector((0, 1, 0))) @ Matrix.Rotation(math.radians(90 * side), 4, "Y")
    p.cyl(tip_m, 0.0125, 0.0, 0.05, 16, "SeatTrim", cap_mat="Gloss")
    p.cyl(tip_m, 0.0128, 0.012, 0.016, 16, "Satin")
    ob = p.finish(name, ROOT_NODE, basis=M)
    ob["axis"] = "local +Z (parallel to the column)"
    ob["usage"] = label
    return ob


stalk(
    "Stalk_Indicator",
    -1,
    "right of the column (JIS); rotation.z = +0.2 rad (down) = right turn, -0.2 rad (up) = left turn",
)
stalk("Stalk_Wiper", 1, "left of the column; rotation.z = -0.15 per step down = INT / LO / HI, +0.15 = mist")


# ---------------------------------------------------------------------------- wipers

WIPERS = {
    # name: pivot x, blade inner/outer radius (m), extra lift (m), full sweep (deg)
    # The driver's blade ends parallel to the right A-pillar (which leans inward), ~7 cm from it.
    # Parked, it lies ~3 cm up the glass from the passenger arm, so 4 mm of lift clears it.
    "WiperArm_R": {"x": -0.665, "r": (0.145, 0.795), "lift": 0.004, "sweep": 82.0},  # driver, 650 mm blade
    "WiperArm_L": {"x": -0.01, "r": (0.19, 0.59), "lift": 0.0, "sweep": 84.0},  # passenger, 400 mm blade
}


def glass_height(Mw, x, y):
    """Signed height of the outer windscreen above the wiper plane at local (x, y)."""
    p = Mw @ Vector((x, y, 0.3))
    d = (Mw.to_3x3() @ Vector((0, 0, -1))).normalized()
    hit = BVH_WINDSCREEN.ray_cast(p, d, 1.0)
    if hit[0] is None:
        return None
    return 0.3 - (hit[0] - p).length


def build_wiper(name, spec):
    zb, yb = glass_base(spec["x"])
    n_out = Vector(WS["normal_out"])
    tilt = -math.degrees(math.atan2(n_out.y, n_out.z))  # rot_x(tilt) maps +Z to n_out (no x part)
    up = Vector((0, math.cos(math.radians(tilt)), math.sin(math.radians(tilt))))
    pivot = Vector((spec["x"], yb, zb)) - up * 0.03
    r0, r1 = spec["r"]
    sweep = spec["sweep"]
    for _ in range(2):  # refit the tilt to the glass under the swept area
        Mw = rot_x(tilt, pivot)
        samples = []
        for ai in range(0, 11):
            ang = math.radians(4 + (sweep - 4) * ai / 10)
            for ri in range(0, 6):
                r = r0 + (r1 - r0) * ri / 5
                x, y = r * math.cos(ang), r * math.sin(ang)
                h = glass_height(Mw, x, y)
                if h is not None:
                    samples.append((x, y, h))
        a = np.array(samples)
        coef, *_ = np.linalg.lstsq(np.c_[np.ones(len(a)), a[:, 1]], a[:, 2], rcond=None)
        # Glass rising toward local +Z along +Y (slope b) means turning the frame by +atan(b).
        tilt += math.degrees(math.atan(coef[1]))
        pivot = pivot + (Mw.to_3x3() @ Vector((0, 0, coef[0])))
    Mw = rot_x(tilt, pivot)
    heights = [h for h in (glass_height(Mw, x, y) for x, y, _ in samples) if h is not None]
    log(
        "wiper_fit",
        wiper=name,
        tilt=round(tilt, 2),
        glass_height_range_mm=[round(min(heights) * 1000, 1), round(max(heights) * 1000, 1)],
    )
    lift = max(heights) + 0.004 + spec["lift"]
    Mw = Mw @ Matrix.Translation((0, 0, lift))
    # Park angle: blade tip 15 mm above the visible glass bottom edge.
    tip_x = spec["x"] + r1
    zt, yt = glass_base(tip_x)
    base_local = Mw.inverted() @ Vector((tip_x, yt, zt))
    park = math.degrees(math.asin(max(-0.3, min(0.3, (base_local.y + 0.015) / r1))))
    p = Part()
    a = math.radians(park)
    d = Vector((math.cos(a), math.sin(a), 0))
    s = Vector((-d.y, d.x, 0))
    p.cyl(Matrix.Identity(4), 0.017, -0.014, 0.010, 16, "WiperMetal")  # pivot cap
    ra = (r0 + r1) / 2
    # Arm: flat bar from the pivot cap to the blade's centre clip, rising slightly.
    arm_pts = [d * 0.0 + Vector((0, 0, 0.018)), d * (ra * 0.5) + Vector((0, 0, 0.022)), d * ra + Vector((0, 0, 0.02))]
    for i in range(len(arm_pts) - 1):
        c = (arm_pts[i] + arm_pts[i + 1]) / 2
        seg = arm_pts[i + 1] - arm_pts[i]
        M = frame(c, seg, s)
        p.box(M, (seg.length + 0.004, 0.014, 0.007), "WiperMetal", bevel=0.002)
    # Blade: frame strip + rubber lip on the glass.
    bc = d * ra
    M = frame(bc, d, s)
    p.box(M, (r1 - r0, 0.016, 0.011), "WiperMetal", bevel=0.003, center=(0, 0, 0.0095))
    p.box(M, (r1 - r0 - 0.01, 0.004, 0.005), "WiperRubber", center=(0, 0, 0.0025))
    p.box(M, (0.05, 0.02, 0.014), "WiperMetal", bevel=0.003, center=(0, 0, 0.014))
    ob = p.finish(name, ROOT_NODE, basis=Mw)
    # Where the pivot and sweep land in the Windshield's UV space (for the rain shader).
    pivot_w = Mw.to_translation()
    ob["axis"] = "local +Z = outward glass normal; rotation.z = +theta sweeps clockwise as seen by the driver"
    ob["rest"] = "park position (rotation.z = 0)"
    ob["park_dir_deg"] = round(park, 2)
    ob["sweep_deg"] = sweep
    ob["blade_r_m"] = [r0, r1]
    ob["pivot"] = r3(pivot_w)
    pivot_uv = [round(c, 4) for c in to_ws_uv(pivot_w)]
    ob["pivot_uv"] = pivot_uv
    ob["tilt_deg"] = round(tilt, 2)
    info = {"pivot": r3(pivot_w), "pivot_uv": pivot_uv, "park_dir_deg": round(park, 2), "tilt_deg": round(tilt, 2)}
    return ob, info


wiper_info = {}
wipers = {}
for name, spec in WIPERS.items():
    wipers[name], wiper_info[name] = build_wiper(name, spec)


# ---------------------------------------------------------------------------- mirrors


def mirror_node(name, centre, normal, size, housing):
    M = facing(centre, normal)
    p = Part()
    housing(p)
    node = p.finish(f"Mirror_{name}", ROOT_NODE, basis=M)
    s = Part()
    w, h = size
    # +X local = the driver's right as they look into the mirror; u runs the other way so a
    # camera looking along the reflected ray maps on without flipping.
    pts = [(w / 2, -h / 2, 0.0008), (w / 2, h / 2, 0.0008), (-w / 2, h / 2, 0.0008), (-w / 2, -h / 2, 0.0008)]
    uvs = [(0, 0), (0, 1), (1, 1), (1, 0)]
    f = s.poly(pts, f"MirrorSurface_{name}", uvs=uvs)
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    surf = s.finish(f"MirrorSurface_{name}", node, sharp=80)
    for ob in (node, surf):
        ob["center"] = r3(centre)
        ob["normal"] = r3(normal)
        ob["size_m"] = [w, h]
    return node, M


def reflect_normal(centre, target_dir):
    to_eye = (EYE - centre).normalized()
    return (to_eye + Vector(target_dir).normalized()).normalized()


mirror_info = {}
# Rear-view mirror hanging from the windscreen top centre, aimed at the hatch glass.
_mount = None
for zt in [0.05 + 0.005 * k for k in range(60)]:  # first glass behind the roof header, + 3 cm
    hit = BVH_WINDSCREEN.ray_cast(Vector((0.0, 1.0, zt + 0.03)), Vector((0, -1, 0)), 2.0)
    if hit[0] is not None:
        _mount = hit[0]
        break
mount = _mount - Vector(WS["normal_out"]) * 0.006 + Vector((0, -0.02, -0.02))
rear_c = mount + Vector((-0.012, -0.072, -0.045))
rear_target = Vector((0.0, 0.40, -1.56))
rear_n = reflect_normal(rear_c, rear_target - rear_c)


def rear_housing(p):
    p.box(Matrix.Identity(4), (0.252, 0.072, 0.034), "SeatTrim", bevel=0.012, segs=3, center=(0, 0, -0.017))
    inv = facing(rear_c, rear_n).inverted()
    a = inv @ (rear_c + Vector((0, 0.02, 0.0)))
    b = inv @ mount
    p.tube([a, (a + b) / 2 + Vector((0, 0.004, 0)), b], 0.008, 10, "SeatTrim")
    m_n = inv.to_3x3() @ (-Vector(WS["normal_out"]))
    p.box(facing(b, m_n), (0.06, 0.045, 0.012), "SeatTrim", bevel=0.005)


mirror_node("Rear", rear_c, rear_n, (0.236, 0.058), rear_housing)
mirror_info["Mirror_Rear"] = {"center": r3(rear_c), "normal": r3(rear_n), "size_m": [0.236, 0.058]}

# Door mirrors: on the car's mirror glass (MirrorGlassL/R in car.glb), turned toward the eye.
for side, name, out_deg in ((-1, "SideR", 4.0), (1, "SideL", 7.0)):
    faces = [f for f in MIRROR_GLASS if f.calc_center_median().x * side > 0]
    xs = [v.co.x for f in faces for v in f.verts]
    ys = [v.co.y for f in faces for v in f.verts]
    zs = [v.co.z for f in faces for v in f.verts]
    car_c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    w, h = max(xs) - min(xs) - 0.006, max(ys) - min(ys) - 0.005
    a = math.radians(out_deg)
    target = Vector((side * math.sin(a), -math.sin(math.radians(2.5)), -math.cos(a)))
    n = reflect_normal(car_c, target)
    # Sit entirely behind the car's mirror glass so it shows from the driver's seat.
    yaw = math.atan2(abs(n.x), abs(n.z))
    pitch = math.atan2(abs(n.y), abs(n.z))
    c = car_c - Vector((0, 0, w / 2 * math.sin(yaw) + h / 2 * math.sin(pitch) + 0.003))
    n = reflect_normal(c, target)

    def side_housing(p, w=w, h=h):
        p.box(Matrix.Identity(4), (w + 0.01, h + 0.01, 0.026), "SeatTrim", bevel=0.008, center=(0, 0, -0.013))

    mirror_node(name, c, n, (w, h), side_housing)
    mirror_info[f"Mirror_{name}"] = {"center": r3(c), "normal": r3(n), "size_m": [round(w, 4), round(h, 4)]}


# ---------------------------------------------------------------------------- roof lining extras

roof = SHELL_PARTS["Headliner"]


def ceiling(x, z):
    hit = BVH_INNER.ray_cast(Vector((x, 0.2, z)), Vector((0, 1, 0)), 1.0)
    return (hit[0], hit[1]) if hit[0] is not None else (Vector((x, 0.55, z)), Vector((0, -1, 0)))


for vx in (DRIVER_X, -DRIVER_X):  # sun visors folded up against the headliner
    pts = []
    for z in (0.10, -0.06):
        pts.append(ceiling(vx, z)[0])
    c = (pts[0] + pts[1]) / 2
    nrm = ceiling(vx, 0.02)[1]
    M = frame(c + nrm * 0.016, Vector((1, 0, 0)), (pts[0] - pts[1]))
    roof.box(M, (0.34, 0.165, 0.022), "Headliner", bevel=0.009, segs=2)
    roof.box(
        frame(c + nrm * 0.016 + Vector((vx * -0.48, 0, 0.07)), Vector((1, 0, 0)), pts[0] - pts[1]),
        (0.03, 0.02, 0.02),
        "Pillar",
        bevel=0.005,
    )
# Overhead console with the room lamp.
oc, on = ceiling(0.0, 0.0)
roof.box(frame(oc + on * 0.012, Vector((1, 0, 0)), Vector((0, 0, 1))), (0.22, 0.13, 0.03), "Pillar", bevel=0.01)
roof.box(frame(oc + on * 0.028, Vector((1, 0, 0)), Vector((0, 0, 1))), (0.12, 0.06, 0.006), "Chrome", bevel=0.002)


# ---------------------------------------------------------------------------- door trims

doors = SHELL_PARTS["DoorTrim"]


def strip_on_wall(side, pts_yz, width, mat, offset=0.0015, part=doors):
    """Ribbon along the inner trim through (y, z) points (door shut lines)."""
    hits = [wall(y, z, side) for y, z in pts_yz]
    hits = [h for h in hits if h]
    if len(hits) < 2:
        return
    for i in range(len(hits) - 1):
        (p0, n0), (p1, n1) = hits[i], hits[i + 1]
        t = (p1 - p0).normalized()
        s0 = n0.cross(t).normalized() * width / 2
        s1 = n1.cross(t).normalized() * width / 2
        q0, q1 = p0 + n0 * offset, p1 + n1 * offset
        f = part.poly([q0 - s0, q0 + s0, q1 + s1, q1 - s1], mat)
        f.normal_update()
        if f.normal.dot(n0) < 0:
            f.normal_flip()


def on_wall(side, y, z, size, mat, proud=0.0, bevel=0.004, roll=0.0, part=doors):
    """Box sitting on the inner trim at (y, z): size = (along z, along y, out of the wall)."""
    w = wall(y, z, side)
    if not w:
        return None
    p, n = w
    up = Vector((0, 1, 0))
    along = n.cross(up).normalized()
    up = along.cross(n).normalized()
    if along.z < 0:
        along = -along
        up = -up if up.y < 0 else up
    M = frame(p + n * (size[2] / 2 - 0.004 + proud), along, up)
    if roll:
        M = M @ Matrix.Rotation(math.radians(roll), 4, "Z")
    part.box(M, size, mat, bevel=bevel)
    return M


for side in (1, -1):
    # Shut lines: front door (rear edge), B-pillar trim edges, rear door rear edge, door bottoms.
    for z in (-0.30, -0.42, -0.95):
        strip_on_wall(side, [(y, z) for y in np.linspace(BELT(z) - 0.03, -0.50, 14)], 0.006, "Seal")
    strip_on_wall(side, [(-0.50, z) for z in np.linspace(0.88, -0.95, 30)], 0.006, "Seal")
    # Window sill capping along the belt line.
    for z0, z1 in ((0.90, -0.30), (-0.42, -0.95)):
        pts = []
        for z in np.linspace(z0, z1, 16):
            w = wall(BELT(z) - 0.018, z, side)
            if w:
                pts.append(w[0] + w[1] * 0.006)
        if len(pts) > 2:
            doors.tube(pts, 0.016, 10, "DoorTrim")
    # Front door furniture.
    on_wall(side, -0.115, 0.17, (0.50, 0.05, 0.085), "DoorTrim", bevel=0.018)  # armrest
    on_wall(side, -0.02, 0.24, (0.60, 0.15, 0.012), "DoorFabric", bevel=0.005)  # fabric insert
    on_wall(side, -0.43, 0.30, (0.52, 0.11, 0.06), "DoorTrim", bevel=0.012)  # door pocket
    on_wall(side, 0.035, 0.56, (0.15, 0.05, 0.012), "Gloss", bevel=0.004)  # handle recess
    on_wall(side, 0.035, 0.56, (0.11, 0.022, 0.026), "Chrome", bevel=0.006)  # inner handle
    sp = wall(-0.30, 0.58, side)
    if sp:
        doors.lathe(
            facing(sp[0] + sp[1] * 0.002, sp[1]),
            [(0.08, -0.004), (0.074, 0.0), (0.068, 0.003), (0.0, 0.003)],  # rim → centre: faces +Z
            32,
            "Speaker",
            mats=["DoorTrim", "DoorTrim", "Speaker"],
        )
    if side < 0:  # driver's power-window switches on the armrest
        M = on_wall(side, -0.072, 0.37, (0.15, 0.02, 0.07), "Gloss", bevel=0.006)
        if M is not None:
            for k in range(4):
                doors.box(
                    M @ Matrix.Translation((-0.05 + 0.033 * k, 0.011, 0.0)),
                    (0.022, 0.008, 0.03),
                    "DashTrim",
                    bevel=0.003,
                )
    # Rear door furniture.
    on_wall(side, -0.10, -0.70, (0.34, 0.045, 0.07), "DoorTrim", bevel=0.016)
    on_wall(side, -0.02, -0.66, (0.40, 0.13, 0.012), "DoorFabric", bevel=0.005)
    on_wall(side, 0.03, -0.50, (0.10, 0.02, 0.024), "Chrome", bevel=0.005)


# ---------------------------------------------------------------------------- floor, seats, console

floor = Part()


def floor_x(y, z):
    return min(0.9, outer_x(y, z, 1) - 0.01, outer_x(y, z, -1) - 0.01)


fz = [0.80, 0.40, 0.10, -0.25, -0.62]
rows = []
for z in fz:
    xw = floor_x(FLOOR_Y + 0.01, z)
    rows.append([Vector((xw, FLOOR_Y, z)), Vector((-xw, FLOOR_Y, z))])
floor.grid(rows, "Carpet", flip=False)
# Toe board up to the firewall under the dash.
toe = []
for y, z in ((FLOOR_Y, 0.80), (-0.42, 0.93), (-0.30, 1.02)):  # 14 cm forward with the pedals
    xw = floor_x(y, z)
    toe.append([Vector((xw, y, z)), Vector((-xw, y, z))])
floor.grid(toe, "Carpet", flip=True)
floor.box(
    Matrix.Identity(4), (0.26, 0.17, 1.50), "Carpet", bevel=0.05, segs=3, center=(0, FLOOR_Y + 0.07, 0.05)
)  # tunnel
# Rear footwell and kick-up under the bench.
kick = []
for y, z in ((FLOOR_Y, -0.62), (-0.52, -0.66)):
    xw = floor_x(y, z)
    kick.append([Vector((xw, y, z)), Vector((-xw, y, z))])
floor.grid(kick, "Carpet", flip=False)
# Luggage floor and parcel shelf (hide the rear axle's boolean tunnel in car.glb).
for y, mat in ((-0.06, "Carpet"), (0.235, "DashTrim")):
    rows = []
    back = BVH_INNER.ray_cast(Vector((0.0, y, -1.0)), Vector((0, 0, -1)), 3.0)[0]  # tailgate trim
    z_end = back.z + 0.01 if back is not None else -2.0
    for z in np.linspace(-1.24, z_end, 9):
        xw = min(wall_x(y, z, 1, 0.01), wall_x(y, z, -1, 0.01))
        rows.append([Vector((xw, y, z)), Vector((-xw, y, z))])
    floor.grid(rows, mat, flip=True)
floor_ob = floor.finish("Floor", ROOT_NODE)

seats = Part()


def front_seat(x, outboard):
    H = Vector((x, H_POINT.y, H_POINT.z))
    cushion = rot_x(-12, H + Vector((0, -0.135, 0.13)))
    seats.box(cushion, (0.44, 0.11, 0.50), "Seat", bevel=0.035, segs=3)
    for s in (1, -1):
        seats.box(cushion, (0.075, 0.13, 0.47), "Seat", bevel=0.032, segs=3, center=(s * 0.225, 0.02, 0.0))
    seats.box(Matrix.Translation((x, FLOOR_Y + 0.06, H.z + 0.12)), (0.42, 0.12, 0.46), "SeatTrim", bevel=0.02)
    for s in (1, -1):
        seats.box(
            Matrix.Translation((x + s * 0.17, FLOOR_Y + 0.012, H.z + 0.12)), (0.025, 0.03, 0.66), "Satin", bevel=0.004
        )
    seats.box(cushion, (0.02, 0.10, 0.30), "SeatTrim", bevel=0.008, center=(outboard * 0.27, -0.06, -0.08))
    back = rot_x(-25, H + Vector((0, -0.10, -0.11)))
    seats.box(back, (0.44, 0.60, 0.11), "Seat", bevel=0.04, segs=3, center=(0, 0.31, -0.055))
    for s in (1, -1):
        seats.box(back, (0.08, 0.56, 0.15), "Seat", bevel=0.035, segs=3, center=(s * 0.225, 0.29, -0.04))
    for s in (1, -1):
        seats.cyl(
            back @ Matrix.Translation((s * 0.07, 0.6, -0.07)) @ Matrix.Rotation(math.radians(-90), 4, "X"),
            0.0065,
            0.0,
            0.08,
            10,
            "Satin",
        )
    seats.box(back, (0.25, 0.18, 0.10), "Seat", bevel=0.035, segs=4, center=(0, 0.74, -0.05))


front_seat(DRIVER_X, -1)
front_seat(-DRIVER_X, 1)
# Rear bench: solid from the kick-up to the cushion; back reclined 25°.
bench_w = min(wall_x(-0.25, -0.85, 1, 0.0), wall_x(-0.25, -0.85, -1, 0.0)) * 2
seats.box(rot_x(-6, (0, -0.33, -0.83)), (bench_w, 0.20, 0.44), "Seat", bevel=0.04, segs=3)
seats.box(Matrix.Translation((0, -0.47, -0.88)), (bench_w - 0.04, 0.14, 0.40), "SeatTrim", bevel=0.02)
rear_back = rot_x(-25, (0, -0.24, -1.02))
back_w = min(wall_x(0.15, -1.15, 1, 0.0), wall_x(0.15, -1.15, -1, 0.0)) * 2
seats.box(rear_back, (back_w, 0.60, 0.14), "Seat", bevel=0.045, segs=3, center=(0, 0.29, -0.07))
for hx in (-0.42, 0.0, 0.42):
    seats.box(rear_back, (0.22 if hx else 0.18, 0.13, 0.09), "Seat", bevel=0.03, segs=4, center=(hx, 0.66, -0.06))
seats_ob = seats.finish("Seats", ROOT_NODE)

console = Part()
# Console body between the front seats: rounded section lofted along z.
sections = []
for z, top in ((0.56, -0.12), (0.46, -0.17), (0.36, -0.205), (0.20, -0.225), (0.0, -0.235), (-0.32, -0.245)):
    ring = []
    for k in range(11):
        t = k / 10
        x = 0.12 * math.cos(math.pi * t)
        y = top - 0.035 * (abs(math.cos(math.pi * t)) ** 6)
        ring.append(Vector((x, y, z)))
    ring = [Vector((0.12, FLOOR_Y + 0.02, z))] + ring + [Vector((-0.12, FLOOR_Y + 0.02, z))]
    sections.append(ring)
console.grid(sections, "DashTrim", flip=True)
console.poly(list(reversed(sections[-1])), "DashTrim")
# Shift gate plate and lever (P at the front).
gate_c = Vector((0.0, -0.205 + 0.003, 0.30))
gate_m = frame(gate_c, Vector((-1, 0, 0)), Vector((0, 0.18, 1)))
gw, gh = 0.085, 0.15
console.poly(
    [(-gw / 2, -gh / 2, 0), (gw / 2, -gh / 2, 0), (gw / 2, gh / 2, 0), (-gw / 2, gh / 2, 0)],
    "ShiftGate",
    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
    M=gate_m,
)
console.box(gate_m, (gw + 0.016, gh + 0.016, 0.008), "Gloss", bevel=0.004, center=(0, 0, -0.0045))
lever_base = gate_m @ Vector((0, (0.86 - 0.5) * gh, 0))
console.cyl(Matrix.Translation(lever_base), 0.007, 0.0, 0.10, 12, "Satin")
console.lathe(
    Matrix.Translation(lever_base + Vector((0, 0.1, 0))) @ Matrix.Rotation(math.radians(-90), 4, "X"),
    [(0.0, -0.005), (0.016, 0.0), (0.021, 0.03), (0.02, 0.055), (0.012, 0.068), (0.0, 0.07)],
    16,
    "Grip",
)
for cz in (0.10, 0.015):  # cup holders
    console.lathe(
        Matrix.Translation((0, -0.236, cz)) @ Matrix.Rotation(math.radians(-90), 4, "X"),
        [(0.041, 0.002), (0.036, 0.0), (0.036, -0.07), (0.0, -0.07)],  # a hole: rim → floor faces in
        24,
        "Gloss",
    )
# Parking brake lever (hand type) behind the cup holders.
console.box(rot_x(10, (0.0, -0.215, -0.14)), (0.04, 0.035, 0.24), "Grip", bevel=0.012, segs=2)
console.cyl(
    rot_x(10, (0.0, -0.215, -0.14)) @ Matrix.Translation((0, 0.0, -0.12)) @ Matrix.Rotation(math.radians(180), 4, "X"),
    0.008,
    0.0,
    0.012,
    10,
    "Satin",
)
console_ob = console.finish("CenterConsole", ROOT_NODE)

# Static trim nodes from the body shell.
door_ob = SHELL_PARTS["DoorTrim"].finish("DoorTrims", ROOT_NODE)
pillar_ob = SHELL_PARTS["Pillar"].finish("Pillars", ROOT_NODE)
roof_ob = SHELL_PARTS["Headliner"].finish("RoofLining", ROOT_NODE)

eye = empty("DriverEye", ROOT_NODE, Matrix.Translation(EYE) @ Matrix.Rotation(math.pi, 4, "Y"))
eye["usage"] = "camera child looks forward (empty's −Z = car +Z)"
eye["height_above_ground_m"] = round(EYE.y - GROUND_Y, 3)
# The package the eye comes from (SAE J1100 names, car frame), for tools that seat other drivers.
eye["h_point"] = r3(H_POINT)
eye["ahp_y"] = FLOOR_Y
eye["bof"] = r3(BOF)
eye["h30_m"] = H30
eye["wheel_to_bof_m"] = round(BOF.z - WHEEL_CENTER.z, 3)
eye["design_driver_m"] = {
    "stature": DESIGN_MAN[0],
    "sitting_height": DESIGN_MAN[1],
    "sitting_eye_height": DESIGN_MAN[2],
}
eye["r125_r_point"] = r3(R_POINT)
eye["r125_v1"] = r3(V1)
eye["r125_v2"] = r3(V2)
# Where game/cockpit.ts draws the dash clock: the cluster's top centre, just proud of its face.
clock = empty("ClockAnchor", cluster, Matrix.Translation((-0.002, 0.053, -0.002)))
clock["usage"] = "top centre of the meter cluster, on its face (local axes = Cluster's)"

# ---------------------------------------------------------------------------- face orientation check


def orientation_report(viewpoints):
    """Faces seen from inside the cabin must face the viewer: materials cull back faces in glTF.

    Ray-casts every face centre from each viewpoint; a face hit first but pointing away is
    counted per object (Cycles previews would not show it, three.js would drop it).
    """
    bpy.context.view_layer.update()  # children's matrix_world is stale until the depsgraph runs
    bm = bmesh.new()
    owners = []
    for o in SCENE.objects:
        if o.type != "MESH":
            continue
        M = o.matrix_world
        vs = [bm.verts.new(M @ v.co) for v in o.data.vertices]
        for p in o.data.polygons:
            mat = o.data.materials[p.material_index] if o.data.materials else None
            try:
                bm.faces.new([vs[i] for i in p.vertices])
            except ValueError:
                continue
            owners.append((f"{o.name}/{mat.name if mat else '-'}", mat is not None and mat.use_backface_culling))
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    seen, wrong = {}, {}
    for vp in viewpoints:
        vp = Vector(vp)
        for f in bm.faces:
            c = f.calc_center_median()
            d = c - vp
            if d.length < 1e-4:
                continue
            hit = tree.ray_cast(vp, d.normalized(), d.length + 0.01)
            if hit[2] != f.index:
                continue
            name, culled = owners[f.index]
            seen[name] = seen.get(name, 0) + 1
            if culled and f.normal.dot(vp - c) < 0:
                wrong[name] = wrong.get(name, 0) + 1
    bm.free()
    return {k: f"{wrong.get(k, 0)}/{v}" for k, v in sorted(seen.items())}


def mirror_visibility():
    """Share of each mirror surface the driver can see past the body's pillars and the trim."""
    bpy.context.view_layer.update()
    opaque = bvh_of([f for f in SHELL if mat_of(f) != "Glass"])
    out = {}
    for name in ("Rear", "SideR", "SideL"):
        ob = bpy.data.objects[f"MirrorSurface_{name}"]
        w, h = ob["size_m"]
        M = ob.matrix_world
        total = seen = 0
        for i in range(9):
            for j in range(5):
                p = M @ Vector(((i / 8 - 0.5) * w * 0.96, (j / 4 - 0.5) * h * 0.92, 0.002))
                d = p - EYE
                total += 1
                blocked = any(
                    t.ray_cast(EYE, d.normalized(), d.length - 0.004)[0] is not None for t in (opaque, BVH_INNER)
                )
                seen += not blocked
        out[f"Mirror_{name}"] = round(seen / total, 2)
    return out


log("mirror_visibility", share_seen_from_eye=mirror_visibility())


def display_visibility():
    """Share of the centre display's screen (and of its lowest row) seen from DriverEye past the
    dash, the wheel and everything else in the cockpit; and its width in UN R125's area S (1,500 mm
    forward of V2, between the planes declined 1° and 4°, edges at ±45° where the 4° planes meet)."""
    bpy.context.view_layer.update()
    bm = bmesh.new()
    owners = []
    for o in SCENE.objects:
        if o.type != "MESH" or o.name in ("Display_Center", "Windshield"):
            continue
        M = o.matrix_world
        vs = [bm.verts.new(M @ v.co) for v in o.data.vertices]
        for p in o.data.polygons:
            try:
                bm.faces.new([vs[i] for i in p.vertices])
            except ValueError:
                continue
            owners.append(o.name)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    M = bpy.data.objects["Display_Center"].matrix_world
    rows = []
    blockers = {}
    for j in range(7):
        row = 0
        for i in range(11):
            p = M @ Vector(((i / 10 - 0.5) * dw * 0.98, (j / 6 - 0.5) * dh * 0.98, 0.0))
            d = p - EYE
            hit = tree.ray_cast(EYE, d.normalized(), d.length - 0.003)
            row += hit[0] is None
            if hit[0] is not None:
                blockers[owners[hit[2]]] = blockers.get(owners[hit[2]], 0) + 1
        rows.append(row / 11)
    corners = [M @ Vector((sx * dw / 2, dh / 2, 0)) for sx in (-1, 1)]
    yaws = [math.atan2(c.x - V2.x, c.z - V2.z) for c in corners]
    s_width = 1.5 * abs(math.tan(yaws[0]) - math.tan(yaws[1]))
    return {
        "screen_seen": round(sum(rows) / len(rows), 3),
        "bottom_row_seen": round(rows[0], 3),
        "top_deg_below_V2": round(math.degrees(math.atan2(V2.y - max(c.y for c in corners), corners[0].z - V2.z)), 2),
        "area_S_width_share": round(s_width / 3.0, 3),
        "blocked_by": blockers,
    }


log("display_visibility", **display_visibility())
VIEWPOINTS = [EYE, EYE + Vector((0.1, 0.05, 0.1)), Vector((-DRIVER_X, 0.32, -0.22)), Vector((0.0, 0.35, -0.9))]
log("orientation", wrong_of_visible=orientation_report(VIEWPOINTS))

# ---------------------------------------------------------------------------- export

for ob in list(SCENE.objects):
    ob.select_set(False)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=False,
    export_apply=True,
    export_extras=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
)

nodes = {o.name: tri_count(o) for o in SCENE.objects if o.type == "MESH"}
log(
    "exported",
    file=OUT,
    bytes=os.path.getsize(OUT),
    tris=sum(nodes.values()),
    nodes=nodes,
    materials=len(MAT),
)
log(
    "hooks",
    eye=r3(EYE),
    eye_height=round(EYE.y - GROUND_Y, 3),
    h_point=r3(H_POINT),
    bof=r3(BOF),
    r_point=r3(R_POINT),
    v2=r3(V2),
    clock=r3(clock.matrix_world.to_translation()),
    wheel_center=r3(WHEEL_CENTER),
    column_deg=COLUMN_DEG,
    cluster_center=r3(CLUSTER_CENTER),
    cluster_tilt_deg=round(CLUSTER_TILT, 2),
    needles={
        n: r3(cluster.matrix_world @ c)
        for n, c in (("speed", SPEED_C), ("tacho", TACHO_C), ("fuel", FUEL_C), ("temp", TEMP_C))
    },
    windshield=WS,
    wipers=wiper_info,
    mirrors=mirror_info,
)

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    # The exterior for context: car.glb's Body without its crude cabin, plus wheels.
    bpy.ops.import_scene.gltf(filepath=CAR_GLB)
    car_objects = [o for o in SCENE.objects if o.name not in nodes and o.name not in ("Cockpit", "DriverEye")]
    keep_names = {"Body", "Wheel"}
    body = None
    for o in list(car_objects):
        if o.type == "MESH" and o.name in keep_names:
            o.parent = None
            o.matrix_world = TO_GAME
            if o.name == "Body":
                body = o
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    names = [m.name for m in body.data.materials]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if names[f.material_index] in ("Interior", "Seat")], context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    wheel = bpy.data.objects.get("Wheel")
    if wheel:
        for x, z in ((-0.82, 1.35), (0.82, 1.35), (-0.82, -1.35), (0.82, -1.35)):
            c = wheel.copy()
            SCENE.collection.objects.link(c)
            c.matrix_world = Matrix.Translation((x, -0.5, z)) @ Matrix.Scale(-1 if x < 0 else 1, 4, (1, 0, 0)) @ TO_GAME
        bpy.data.objects.remove(wheel, do_unlink=True)
    for mname in ("MirrorSurface_Rear", "MirrorSurface_SideR", "MirrorSurface_SideL"):
        b = MAT[mname].node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (0.9, 0.9, 0.9, 1)
        b.inputs["Roughness"].default_value = 0.0
    gbm = bmesh.new()
    for p in [(-40, GROUND_Y, -40), (40, GROUND_Y, -40), (40, GROUND_Y, 40), (-40, GROUND_Y, 40)]:
        gbm.verts.new(p)
    gbm.faces.new(gbm.verts)
    gme = bpy.data.meshes.new("Ground")
    gbm.to_mesh(gme)
    gme.materials.append(material("Ground", 0x6C7076, roughness=0.9))
    ground = bpy.data.objects.new("Ground", gme)
    SCENE.collection.objects.link(ground)
    # Lane markings ahead so the mirrors and wipers have something to show.
    for k in range(-6, 12):
        lbm = bmesh.new()
        for dx, dz in ((-0.08, 0), (0.08, 0), (0.08, 3), (-0.08, 3)):
            lbm.verts.new((1.75 + dx, GROUND_Y + 0.005, k * 6 + dz))
        lbm.faces.new(lbm.verts)
        lme = bpy.data.meshes.new("Lane")
        lbm.to_mesh(lme)
        if "Lane" not in MAT:
            material("Lane", 0xF2F2F2, roughness=0.6)
        lme.materials.append(MAT["Lane"])
        SCENE.collection.objects.link(bpy.data.objects.new("Lane", lme))
    for z, x, col in ((-14, 0.3, 0xC02020), (-26, -3.2, 0x2050C0), (16, -0.5, 0xE0E0E0)):
        obm = bmesh.new()
        bmesh.ops.create_cube(obm, size=1.0)
        bmesh.ops.scale(obm, vec=(1.8, 1.4, 4.2), verts=obm.verts)
        bmesh.ops.translate(obm, vec=(x, GROUND_Y + 0.75, z), verts=obm.verts)
        ome = bpy.data.meshes.new("Other")
        obm.to_mesh(ome)
        ome.materials.append(material(f"Other{col:06x}", col, roughness=0.4))
        SCENE.collection.objects.link(bpy.data.objects.new("Other", ome))
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(-55), math.radians(-30), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = int(os.environ.get("PREVIEW_SAMPLES", "16"))
    SCENE.render.resolution_percentage = int(os.environ.get("PREVIEW_SCALE", "75"))
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 25.0
    fill.data.size = 1.0
    fill.location = (0.0, 0.45, -0.4)
    fill.rotation_euler = (math.radians(90), 0, 0)  # area lights shine along local −Z: down here
    SCENE.collection.objects.link(fill)
    SCENE.cycles.use_denoising = True
    SCENE.cycles.max_bounces = 6
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720

    def shoot(view, eye_pos, target, lens, hide=(), ortho=None, clip=0.02):
        cam.location = eye_pos
        cam.data.type = "ORTHO" if ortho else "PERSP"
        if ortho:
            cam.data.ortho_scale = ortho
        fwd = (Vector(target) - Vector(eye_pos)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        cam.data.lens = lens
        cam.data.clip_start = clip
        cam.data.clip_end = 200
        for o in hide:
            o.hide_render = True
        SCENE.render.filepath = os.path.join(PREVIEW, f"cockpit-{view}.png")
        bpy.ops.render.render(write_still=True)
        for o in hide:
            o.hide_render = False
        log("preview", view=view, file=SCENE.render.filepath)

    only = os.environ.get("PREVIEW_ONLY", "").split(",") if os.environ.get("PREVIEW_ONLY") else None
    views = {
        "eye": (EYE, EYE + Vector((0.05, -0.06, 1.0)), 15),
        "cluster": (EYE, CLUSTER_CENTER, 42),
        "mirror-rear": (EYE, Vector(mirror_info["Mirror_Rear"]["center"]), 45),
        "mirror-r": (EYE, Vector(mirror_info["Mirror_SideR"]["center"]), 45),
        "mirror-l": (EYE, Vector(mirror_info["Mirror_SideL"]["center"]), 45),
        "outside": (Vector((-3.4, 1.4, 4.2)), Vector((0, 0.1, 0.3)), 40),
        "eye-back": (EYE, Vector((0.25, 0.25, -1.8)), 16),
        "eye-right": (EYE, EYE + Vector((-1.0, -0.45, 0.25)), 16),
        "eye-left": (EYE, EYE + Vector((1.0, -0.35, 0.45)), 16),
        "hood": (Vector((-0.15, 0.42, 0.25)), Vector((-0.37, 0.17, 0.62)), 30),
        "column": (Vector((-0.05, 0.25, 0.0)), Vector((-0.37, 0.06, 0.42)), 28),
    }
    for view, (e, t, lens) in views.items():
        if only and view not in only:
            continue
        shoot(view, e, t, lens)
    # Sections: orthographic cameras whose near plane cuts the car.
    sections = {
        "section-driver": (Vector((5.0, 0.0, -0.35)), Vector((-5.0, 0.0, -0.35)), 4.6, 5.0 - DRIVER_X),
        "section-centre": (Vector((5.0, 0.0, -0.35)), Vector((-5.0, 0.0, -0.35)), 4.6, 5.0 - 0.02),
        "section-top": (Vector((0.0, 5.0, -0.401)), Vector((0.0, -5.0, -0.4)), 4.6, 5.0 - 0.42),
        "section-front": (Vector((0.0, 0.05, -5.0)), Vector((0.0, 0.05, 5.0)), 2.2, 5.0 - 0.15),
    }
    for view, (e, t, scale, clip) in sections.items():
        if only and view not in only:
            continue
        shoot(view, e, t, 50, ortho=scale, clip=clip)
    if not only or "windshield-uv" in only:
        # UV check: red = u (should grow to the driver's right), green = v (up the glass).
        m = MAT["Windshield"]
        nt = m.node_tree
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        emi = nt.nodes.new("ShaderNodeEmission")
        out = nt.nodes["Material Output"]
        nt.links.new(tc.outputs["UV"], sep.inputs[0])
        nt.links.new(sep.outputs[0], comb.inputs[0])
        nt.links.new(sep.outputs[1], comb.inputs[1])
        nt.links.new(comb.outputs[0], emi.inputs["Color"])
        nt.links.new(emi.outputs[0], out.inputs["Surface"])
        shoot("windshield-uv", EYE, EYE + Vector((0.05, -0.06, 1.0)), 15)
        nt.links.new(nt.nodes["Principled BSDF"].outputs[0], out.inputs["Surface"])

    def turn(ob, rest, theta):
        """What three.js obj.rotation.z = theta does to a node whose rest Euler is (tilt, 0, 0)."""
        ob.matrix_basis = rest @ Matrix.Rotation(theta, 4, "Z")

    if not only or "wipers" in only:
        rests = {name: ob.matrix_basis.copy() for name, ob in wipers.items()}
        for name, ob in wipers.items():
            turn(ob, rests[name], math.radians(WIPERS[name]["sweep"]))
        shoot("wipers", EYE, EYE + Vector((0.05, -0.06, 1.0)), 15)
        for name, ob in wipers.items():
            turn(ob, rests[name], math.radians(WIPERS[name]["sweep"] * 0.5))
        shoot("wipers-mid", Vector((0.0, 1.6, 3.4)), Vector((0, 0.3, 0.5)), 35)
        for name, ob in wipers.items():
            ob.matrix_basis = rests[name]
    if not only or "needles" in only:
        # 60 km/h, 3000 r/min, fuel 3/4, temperature middle, steering 0.05 rad to the left.
        for ob, value in ((needle_speed, 60), (needle_tacho, 3000), (needle_fuel, 0.75), (needle_temp, 0.5)):
            ob.rotation_euler.z = value * ob["rad_per_unit"]
        rest = steering.matrix_basis.copy()
        turn(steering, rest, -0.05 * STEER_RATIO)
        shoot("needles", EYE, CLUSTER_CENTER, 30)
        steering.matrix_basis = rest
