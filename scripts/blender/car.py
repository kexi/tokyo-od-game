# Procedural compact hatchback (+ taxi variant and a low-poly LOD) for TOKYO OPEN DRIVE.
#
#   nix develop .#blender -c blender --background --factory-startup \
#     --python scripts/blender/car.py -- public/models/car.glb [preview-dir]
#
# Everything is modelled directly in game coordinates (+Y up, +Z forward, +X = the car's left)
# and exported with export_yup=False, so the glTF needs no axis conversion. Dimensions follow
# src/physics/vehicle.ts: 4.30 × 1.84 × 1.45 m, wheels at x ±0.82, z ±1.35, hub y −0.50,
# tyre radius 0.36, ground at y −0.86. Textures come from assets/car/textures (see README there).
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEX = os.path.join(ROOT, "assets", "car", "textures")
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(ROOT, "public", "models", "car.glb")
PREVIEW = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else None

WHEEL_Z = 1.35
HUB_Y = -0.50
ARCH_R = 0.41


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


# ---------------------------------------------------------------------------- materials


def lin(hex_color):
    """sRGB 0xRRGGBB → linear RGBA (Principled BSDF inputs are linear)."""

    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (ch((hex_color >> 16) & 255), ch((hex_color >> 8) & 255), ch(hex_color & 255), 1.0)


MAT = {}
IMAGES = {}


def image(name):
    path = os.path.join(TEX, name)
    if not os.path.exists(path):
        log("texture_missing", file=name)
        return None
    if name not in IMAGES:
        IMAGES[name] = bpy.data.images.load(path)
    return IMAGES[name]


def material(
    name, color=0xFFFFFF, metallic=0.0, roughness=0.5, coat=0.0, alpha=1.0, tex=None, emissive=None, clip=False
):
    """Principled material; `emissive` = hex colour (or True to reuse the texture)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.04
    node = None
    img = image(tex) if tex else None
    if img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.links.new(node.outputs["Color"], b.inputs["Base Color"])
        if clip:
            # Round(alpha) is how the glTF exporter recognises alphaMode MASK (cutoff 0.5).
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            nt.links.new(node.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], b.inputs["Alpha"])
    if emissive is not None:
        if emissive is True and node is not None:
            nt.links.new(node.outputs["Color"], b.inputs["Emission Color"])
        else:
            b.inputs["Emission Color"].default_value = lin(color if emissive is True else emissive)
        b.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    MAT[name] = m
    return m


# Paint and lamp materials are cloned per car at runtime (colour, lamp state).
material("Paint", 0x1F5FBF, metallic=0.55, roughness=0.32, coat=1.0)
material("Trim", 0x16181B, roughness=0.62)  # unpainted black plastic, wheel-well liners
material("Blackout", 0x0B0C0E, roughness=0.12, coat=1.0)  # gloss-black B-pillar
material("Glass", 0x10161C, roughness=0.04, alpha=0.42)
material("GlassLow", 0x1C242C, metallic=0.4, roughness=0.12)  # opaque for the LOD
material("Gap", 0x07080A, roughness=0.8)  # panel shut lines
material("Chrome", 0xD9DDE2, metallic=1.0, roughness=0.12)
material("Mirror", 0xB8C2CC, metallic=1.0, roughness=0.03)
material("Interior", 0x2A2C31, roughness=0.85)
material("Seat", 0x3A3D44, roughness=0.9)
material("HeadLamp", tex="headlight.png", roughness=0.08, emissive=True)
material("TailLamp", 0x8A0A0A, tex="taillight.png", roughness=0.1, emissive=True)
material("IndicatorL", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("IndicatorR", 0xC96A00, roughness=0.15, emissive=0xFF8A00)
material("Reverse", 0xDADDE0, roughness=0.1, emissive=0xFFFFFF)
material("Reflector", 0x7A0505, roughness=0.3)
material("Grille", 0x1A1C1F, tex="grille.png", metallic=0.3, roughness=0.45, clip=True)
material("PlatePrivate", tex="plate_private.png", roughness=0.45)
material("PlateCommercial", tex="plate_commercial.png", roughness=0.45)
material("TaxiSign", 0xF6EFC8, tex="taxi_sign.png", roughness=0.35, emissive=True)
material("TaxiSignBody", 0xF2F2EE, roughness=0.4)
material("Vacancy", tex="vacancy_sign.png", roughness=0.3, emissive=True)
material("TireTread", 0x1B1C1E, tex="tire_tread.png", roughness=0.92)
material("TireSidewall", 0x1F2023, tex="tire_sidewall.png", roughness=0.85)
material("Rim", 0xC4C9D0, metallic=1.0, roughness=0.26)
material("Disc", 0x55585C, metallic=1.0, roughness=0.45)
material("Caliper", 0xB3261E, roughness=0.35, coat=0.6)
material("LampLowFront", 0xEDEFF2, roughness=0.1, emissive=0xFFF4DE)
material("LampLowRear", 0x8A0A0A, roughness=0.1, emissive=0xFF2A1A)


# ---------------------------------------------------------------------------- mesh helpers


def new_object(name, bm, mats, parent=None, smooth=True, sharp_angle=None):
    if sharp_angle is not None:
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp_angle):
                e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, parent=None):
    ob = bpy.data.objects.new(name, None)
    SCENE.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)


def join_into(target, objects):
    """Merge meshes into `target` (one object, one glTF mesh → one draw call per material)."""
    objects = [o for o in objects if o is not target and o.type == "MESH"]
    if not objects:
        return target
    # Join merges UV maps by name and drops them when the target has none: give everyone one.
    for o in [target, *objects]:
        if "UVMap" not in o.data.uv_layers:
            # A new map starts as a per-face 0–1 unwrap, which would split every vertex on export.
            layer = o.data.uv_layers.new(name="UVMap")
            for d in layer.data:
                d.uv = (0.0, 0.0)
    for o in objects:  # parents are identity empties here, but bake their transforms anyway
        o.data.transform(o.matrix_world)
        o.matrix_world = target.matrix_world.inverted()
    with bpy.context.temp_override(
        active_object=target, selected_editable_objects=[target, *objects], selected_objects=[target, *objects]
    ):
        bpy.ops.object.join()
    return target


def mark_sharp(ob, angle):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(angle):
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


def box(bm, center, size, mat=0, rot=None):
    """Axis-aligned (then optionally rotated) box added to `bm`; returns its faces."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    vs = []
    for dx, dy, dz in [
        (-1, -1, -1),
        (1, -1, -1),
        (1, 1, -1),
        (-1, 1, -1),
        (-1, -1, 1),
        (1, -1, 1),
        (1, 1, 1),
        (-1, 1, 1),
    ]:
        p = Vector((dx * sx, dy * sy, dz * sz))
        if rot is not None:
            p = rot @ p
        vs.append(bm.verts.new(p + Vector((cx, cy, cz))))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    out = []
    for f in faces:
        face = bm.faces.new([vs[i] for i in f])
        face.material_index = mat
        out.append(face)
    return out


def cylinder_x(bm, x0, x1, radius, segments, mat_side=0, mat_cap=None, center=(0.0, 0.0)):
    """Closed cylinder along X from x0 to x1 (cap at x1 gets `mat_cap`)."""
    cy, cz = center
    ring0, ring1 = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        y, z = cy + radius * math.cos(a), cz + radius * math.sin(a)
        ring0.append(bm.verts.new((x0, y, z)))
        ring1.append(bm.verts.new((x1, y, z)))
    for i in range(segments):
        j = (i + 1) % segments
        f = bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
        f.material_index = mat_side
    f0 = bm.faces.new(list(reversed(ring0)))
    f1 = bm.faces.new(ring1)
    f0.material_index = mat_side
    f1.material_index = mat_side if mat_cap is None else mat_cap


# ---------------------------------------------------------------------------- body loft

# Piecewise-linear profiles along z (front +2.15 → rear −2.15); subdivision smooths them.
HALF_WIDTH = [
    (2.15, 0.64),
    (2.12, 0.80),
    (2.05, 0.875),
    (1.92, 0.905),
    (1.75, 0.915),
    (1.4, 0.92),
    (-1.6, 0.92),
    (-1.9, 0.905),
    (-2.02, 0.88),
    (-2.10, 0.82),
    (-2.15, 0.66),
]
BOTTOM = [
    (2.15, -0.46),
    (2.12, -0.56),
    (2.05, -0.62),
    (1.9, -0.655),
    (1.6, -0.675),
    (-1.6, -0.675),
    (-1.9, -0.645),
    (-2.05, -0.60),
    (-2.12, -0.54),
    (-2.15, -0.46),
]
SHOULDER = [
    (2.15, -0.12),
    (2.12, -0.04),
    (2.05, 0.015),
    (1.92, 0.055),
    (1.6, 0.10),
    (1.2, 0.14),
    (0.93, 0.162),
    (0.5, 0.178),
    (0.0, 0.192),
    (-0.5, 0.206),
    (-1.0, 0.222),
    (-1.5, 0.238),
    (-1.76, 0.245),
    (-1.9, 0.236),
    (-2.02, 0.19),
    (-2.10, 0.08),
    (-2.15, -0.05),
]
TOP = [
    (2.15, -0.07),
    (2.12, 0.0),
    (2.05, 0.055),
    (1.92, 0.10),
    (1.6, 0.145),
    (1.2, 0.175),
    (0.93, 0.198),
    (0.80, 0.27),
    (0.65, 0.345),
    (0.50, 0.415),
    (0.35, 0.485),
    (0.20, 0.548),
    (0.05, 0.585),
    (-0.12, 0.600),
    (-0.6, 0.606),
    (-0.95, 0.600),
    (-1.20, 0.585),
    (-1.36, 0.555),
    (-1.52, 0.48),
    (-1.64, 0.405),
    (-1.76, 0.31),
    (-1.90, 0.262),
    (-2.02, 0.205),
    (-2.10, 0.095),
    (-2.15, -0.03),
]
# Station z values: window and pillar edges fall on stations so material borders follow them.
STATIONS = [
    2.15,
    2.12,
    2.05,
    1.92,
    1.75,
    1.55,
    1.35,
    1.15,
    0.93,
    0.80,
    0.65,
    0.50,
    0.35,
    0.20,
    0.05,
    -0.12,
    -0.30,
    -0.42,
    -0.60,
    -0.80,
    -0.95,
    -1.10,
    -1.20,
    -1.36,
    -1.52,
    -1.64,
    -1.76,
    -1.90,
    -2.02,
    -2.10,
    -2.15,
]
# Half cross-section parts (segments each): underbody, rocker, side, shoulder, window, roof rail, top.
SEG = [3, 2, 3, 2, 2, 1, 4]
PART = [p for p, n in enumerate(SEG) for _ in range(n)]
NSEG = len(PART)
BELT_J = sum(SEG[:4])  # vertex index of the beltline (crisp shoulder crease)


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
    x5 = w - 0.05 - 0.13 * g  # tumblehome
    key = [
        (0.0, yb),
        (w - 0.12, yb),
        (w, yb + 0.12),
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
    """Material slot for a loft face (see BODY_MATS)."""
    if part == 0:
        return 1  # Trim (underbody)
    if part == 4 and h_mid > 0.06:  # side glass band
        if -0.42 < z_mid < -0.30:
            return 3  # Blackout B-pillar
        if -0.30 < z_mid < 0.93 or -1.10 < z_mid < -0.42 or -1.52 < z_mid < -1.20:
            return 2  # Glass
    if part == 6:
        if 0.20 < z_mid < 0.93 and h_mid > 0.03:
            return 2  # windscreen
        if -1.76 < z_mid < -1.36:
            return 2  # hatch glass
    return 0  # Paint


BODY_MATS = ["Paint", "Trim", "Glass", "Blackout"]


def build_body(name, levels, parent):
    bm = bmesh.new()
    crease = bm.edges.layers.float.new("crease_edge")
    rings = []
    heights = []
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
            f.material_index = face_material(PART[seg], z_mid, h_mid)
    # Beltline crease on both sides keeps the shoulder line crisp after subdivision.
    for k in range(len(rings) - 1):
        for r in (BELT_J, n - BELT_J):
            e = bm.edges.get((rings[k][r], rings[k + 1][r]))
            if e:
                e[crease] = 0.55
    # Close the ends with shrinking rings and a small fan (keeps quads across the fascia).
    for ring, z, sign in ((rings[0], STATIONS[0], 1), (rings[-1], STATIONS[-1], -1)):
        cy = sum(v.co.y for v in ring) / len(ring)
        prev = ring
        for scale, dz in ((0.72, 0.012), (0.42, 0.02)):
            nxt = [bm.verts.new((v.co.x * scale, cy + (v.co.y - cy) * scale, z + sign * dz)) for v in ring]
            for r in range(n):
                seg = r if r < NSEG else n - r - 1
                f = bm.faces.new((prev[r], prev[(r + 1) % n], nxt[(r + 1) % n], nxt[r]))
                f.material_index = 1 if PART[seg] == 0 else 0
            prev = nxt
        tip = bm.verts.new((0.0, cy, z + sign * 0.024))
        for r in range(n):
            bm.faces.new((prev[r], prev[(r + 1) % n], tip)).material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(name, bm, BODY_MATS, parent)
    if levels:
        sub = ob.modifiers.new("subdivide", "SUBSURF")
        sub.levels = levels
        sub.render_levels = levels
        apply_modifiers(ob)
    # Wheel arches: one cylinder through the car per axle; the cut faces become black liners.
    for zc in (WHEEL_Z, -WHEEL_Z):
        cbm = bmesh.new()
        cylinder_x(cbm, -1.3, 1.3, ARCH_R, 48, center=(HUB_Y, zc))
        cutter = new_object(f"{name}_arch", cbm, ["Trim"], smooth=True)
        mod = ob.modifiers.new("arch", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.material_mode = "TRANSFER"
        mod.object = cutter
        apply_modifiers(ob)
        bpy.data.objects.remove(cutter)
    mark_sharp(ob, 50)
    return ob


# ---------------------------------------------------------------------------- surface tools


class Surface:
    """Ray casts against the finished body, for decals that hug its curvature."""

    def __init__(self, ob):
        self.ob = ob

    def hit(self, origin, direction, distance=3.0):
        ok, loc, nor, _ = self.ob.ray_cast(Vector(origin), Vector(direction).normalized(), distance=distance)
        return (loc, nor) if ok else None


def decal(
    name,
    surf,
    center,
    yaw,
    pitch,
    width,
    height,
    mat,
    parent,
    segs=(12, 4),
    uv=(0, 0, 1, 1),
    flip_u=False,
    offset=0.004,
    shape=None,
):
    """Grid projected onto the body along −normal; UVs span `uv` = (u0, v0, u1, v1)."""
    n = Vector((math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)))
    right = Vector((math.cos(yaw), 0.0, -math.sin(yaw)))
    up = n.cross(right).normalized()
    nx, ny = segs
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    grid = {}
    texcoord = {}
    c = Vector(center)
    missed = 0
    for i in range(nx + 1):
        for j in range(ny + 1):
            s, t = i / nx, j / ny
            a, b = (s - 0.5) * width, (t - 0.5) * height
            if shape:
                a, b = shape(a, b, s, t)
            start = c + n * 0.5 + right * a + up * b
            h = surf.hit(start, -n)
            if h is None:
                missed += 1
                p = c + right * a + up * b
            else:
                p = h[0] + h[1] * offset
            grid[i, j] = bm.verts.new(p)
            u0, v0, u1, v1 = uv
            texcoord[i, j] = (u0 + (u1 - u0) * ((1 - s) if flip_u else s), v0 + (v1 - v0) * t)
    for i in range(nx):
        for j in range(ny):
            corners = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            f = bm.faces.new([grid[k] for k in corners])
            for loop, k in zip(f.loops, corners, strict=True):
                loop[uvl].uv = texcoord[k]
    bm.normal_update()
    for f in bm.faces:
        if f.normal.dot(n) < 0:
            f.normal_flip()
    if missed:
        log("decal_missed_vertices", decal=name, missed=missed)
    return new_object(name, bm, [mat], parent)


def stroke(name, surf, rays, width, mat, parent, offset=0.0025):
    """Thin ribbon along the surface hits of `rays` [(origin, direction)], e.g. panel gaps."""
    hits = [h for h in (surf.hit(o, d) for o, d in rays) if h]
    if len(hits) < 2:
        log("stroke_skipped", stroke=name)
        return None
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
    return new_object(name, bm, [mat], parent)


def flat_plate(name, surf, y, sign, mat, parent):
    """Flat 330×165 mm number plate on the bumper face (front sign=1, rear −1), with a black backing."""
    h = surf.hit((0.0, y, sign * 3.0), (0.0, 0.0, -sign))
    z = (h[0].z if h else sign * 2.12) + sign * 0.012
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    w, ht = 0.33, 0.165
    # Seen from outside, +u runs toward +X at the front and −X at the rear.
    corners = [(-w / 2, -ht / 2), (w / 2, -ht / 2), (w / 2, ht / 2), (-w / 2, ht / 2)]
    vs = [bm.verts.new((sign * a, y + b, z)) for a, b in corners]
    f = bm.faces.new(vs)
    for loop, (a, b) in zip(f.loops, corners, strict=True):
        loop[uvl].uv = (a / w + 0.5, b / ht + 0.5)
    f.normal_update()
    if f.normal.z * sign < 0:
        f.normal_flip()
    plate = new_object(name, bm, [mat], parent, smooth=False)
    bbm = bmesh.new()
    box(bbm, (0.0, y, z - sign * 0.008), (w + 0.03, ht + 0.03, 0.012))
    new_object(name + "Frame", bbm, ["Trim"], parent, smooth=False)
    return plate


# ---------------------------------------------------------------------------- wheel


def ring_radii(img):
    """Inner/outer radius (fraction of the image width) of the opaque ring in tire_sidewall.png."""
    if img is None:
        return 0.27, 0.5
    w, h = img.size
    px = img.pixels[:]
    row = h // 2
    opaque = [px[(row * w + x) * 4 + 3] > 0.5 for x in range(w // 2, w)]
    inner = next((i for i, o in enumerate(opaque) if o), 0)
    outer = len(opaque) - next((i for i, o in enumerate(reversed(opaque)) if o), 0)
    return inner / w, outer / w


TIRE = [
    (-0.098, 0.238),
    (-0.108, 0.262),
    (-0.1125, 0.29),
    (-0.1125, 0.318),
    (-0.108, 0.338),
    (-0.098, 0.350),
    (-0.080, 0.355),
    (-0.04, 0.356),
    (0.0, 0.356),
    (0.04, 0.356),
    (0.080, 0.355),
    (0.098, 0.350),
    (0.108, 0.338),
    (0.1125, 0.318),
    (0.1125, 0.29),
    (0.108, 0.262),
    (0.098, 0.238),
]
RIM = [
    (-0.100, 0.205),
    (-0.102, 0.232),
    (-0.096, 0.237),
    (0.090, 0.237),
    (0.098, 0.243),
    (0.107, 0.241),
    (0.105, 0.226),
    (0.094, 0.217),
    (0.080, 0.212),
    (-0.100, 0.205),
]


def build_wheel(name, parent=None):
    """Tyre, 5 twin-spoke rim, disc and hub; axle along X, outer face +X, origin at the hub."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    N = 72
    r_in, r_out = ring_radii(IMAGES.get("tire_sidewall.png") or image("tire_sidewall.png"))
    side_min, side_max = TIRE[0][1], 0.352

    def lathe(profile, mat_of, uv_of):
        cols = []
        for i in range(N):
            a = 2 * math.pi * i / N
            cols.append([bm.verts.new((x, r * math.cos(a), r * math.sin(a))) for x, r in profile])
        for i in range(N):
            i2 = (i + 1) % N
            for k in range(len(profile) - 1):
                f = bm.faces.new((cols[i][k], cols[i][k + 1], cols[i2][k + 1], cols[i2][k]))
                f.material_index = mat_of(k)
                for loop, (col, kk) in zip(f.loops, [(i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k)], strict=True):
                    loop[uvl].uv = uv_of(col, kk, profile)

    def tire_mat(k):
        return 0 if TIRE[k][1] >= 0.349 and TIRE[k + 1][1] >= 0.349 else 1

    def tire_uv(col, k, profile):
        x, r = profile[k]
        a = 2 * math.pi * col / N
        if r >= 0.349:  # tread: 3 repeats around, across the tread width
            return (3 * col / N, (x + 0.1) / 0.2)
        rho = r_in + (r - side_min) / (side_max - side_min) * (r_out - r_in)
        # Outer face is seen from +X (image right = −Z), inner face from −X (image right = +Z).
        s = -1 if x > 0 else 1
        return (0.5 + s * rho * math.sin(a), 0.5 + rho * math.cos(a))

    lathe(TIRE, tire_mat, tire_uv)
    lathe(RIM, lambda k: 2, lambda col, k, p: (0.0, 0.0))
    # Five twin spokes, slightly dished toward the hub.
    for i in range(5):
        for off in (-0.075, 0.075):
            a = 2 * math.pi * i / 5 + off
            rot = Matrix.Rotation(a, 3, "X")
            vs = []
            for r, half, x_front in ((0.065, 0.013, 0.094), (0.215, 0.019, 0.086)):
                for dx in (x_front, x_front - 0.032):
                    for dz in (-half, half):
                        vs.append(bm.verts.new(rot @ Vector((dx, r, dz))))
            # vs: hub front −/+, hub back −/+, rim front −/+, rim back −/+ (± = either side of the spoke)
            quads = [(0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5), (4, 5, 7, 6), (0, 2, 3, 1)]
            for q in quads:
                f = bm.faces.new([vs[j] for j in q])
                f.material_index = 2
    cylinder_x(bm, 0.055, 0.098, 0.072, 24, mat_side=2)  # hub
    cylinder_x(bm, 0.098, 0.104, 0.032, 16, mat_side=2, mat_cap=4)  # centre cap
    for i in range(5):
        a = 2 * math.pi * i / 5 + math.pi / 5
        cylinder_x(bm, 0.090, 0.104, 0.011, 8, mat_side=4, center=(0.048 * math.cos(a), 0.048 * math.sin(a)))
    cylinder_x(bm, -0.030, -0.002, 0.172, 40, mat_side=3)  # brake disc
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(name, bm, ["TireTread", "TireSidewall", "Rim", "Disc", "Chrome"], parent)
    mark_sharp(ob, 45)
    return ob


def build_caliper(name, parent=None):
    bm = bmesh.new()
    rot = Matrix.Rotation(math.radians(-45), 3, "X")  # top-rear quadrant (rear = −Z)
    box(bm, (0.012, 0.112, -0.112), (0.05, 0.06, 0.13), rot=rot)
    ob = new_object(name, bm, ["Caliper"], parent, smooth=False)
    return ob


def build_wheel_low(name):
    bm = bmesh.new()
    cylinder_x(bm, -0.1, 0.1, 0.355, 14, mat_side=0)
    cylinder_x(bm, 0.095, 0.104, 0.235, 14, mat_side=1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, ["Trim", "Rim"], smooth=False)


# ---------------------------------------------------------------------------- assemble: hi

car = empty("CarHi")
body = build_body("Body", 2, car)
surf = Surface(body)

# Cabin lining: the body shell pushed 2.5 cm inward with flipped faces, minus the glass, so the
# roof, pillars and door cards are visible from outside through the windows.
lbm = bmesh.new()
lbm.from_mesh(body.data)
bmesh.ops.delete(lbm, geom=[f for f in lbm.faces if f.material_index == BODY_MATS.index("Glass")], context="FACES")
for v in lbm.verts:
    v.co -= v.normal * 0.025
bmesh.ops.reverse_faces(lbm, faces=lbm.faces)
for f in lbm.faces:
    f.material_index = 0
lining = new_object("Lining", lbm, ["Interior"], car)
dec = lining.modifiers.new("decimate", "DECIMATE")
dec.ratio = 0.3
apply_modifiers(lining)

# Interior: dashboard, right-hand-drive steering wheel (driver on −X), seats, floor.
ibm = bmesh.new()
box(ibm, (0.0, 0.08, 0.70), (1.58, 0.22, 0.42), mat=0)
box(ibm, (0.0, -0.44, -0.30), (1.62, 0.04, 2.2), mat=0)
for x in (-0.38, 0.38):
    box(ibm, (x, -0.30, -0.12), (0.50, 0.12, 0.50), mat=1)
    box(ibm, (x, 0.02, -0.40), (0.48, 0.58, 0.12), mat=1, rot=Matrix.Rotation(math.radians(-14), 3, "X"))
    box(ibm, (x, 0.38, -0.47), (0.26, 0.16, 0.10), mat=1)
box(ibm, (0.0, -0.30, -0.98), (1.40, 0.12, 0.48), mat=1)
box(ibm, (0.0, 0.0, -1.22), (1.40, 0.56, 0.12), mat=1, rot=Matrix.Rotation(math.radians(-10), 3, "X"))
wheel_tilt = Matrix.Rotation(math.radians(-62), 3, "X")
for i in range(16):  # steering wheel rim as 16 small segments
    a0, a1 = 2 * math.pi * i / 16, 2 * math.pi * (i + 1) / 16
    mid = (a0 + a1) / 2
    p = wheel_tilt @ Vector((0.18 * math.cos(mid), 0.0, 0.18 * math.sin(mid)))
    rot = wheel_tilt @ Matrix.Rotation(-mid, 3, "Y")
    box(ibm, (-0.37 + p.x, 0.14 + p.y, 0.40 + p.z), (0.03, 0.03, 0.075), mat=0, rot=rot)
interior = new_object("Interior", ibm, ["Interior", "Seat"], car)
sub = interior.modifiers.new("soften", "SUBSURF")
sub.levels = 1
apply_modifiers(interior)

# Lamps and front/rear detail, all hugging the body surface.
FRONT_YAW = math.radians(22)
REAR_YAW = math.radians(20)
lamp_shape = lambda a, b, s, t: (a, b + (0.018 * (1 - s) if b > 0 else -0.006 * s))  # noqa: E731
for side in (1, -1):
    tag = "L" if side > 0 else "R"
    decal(
        f"HeadLamp{tag}",
        surf,
        (side * 0.60, -0.035, 2.05),
        side * FRONT_YAW,
        0.0,
        0.40,
        0.165,
        "HeadLamp",
        car,
        uv=(0.02, 0.18, 0.98, 0.86),
        flip_u=side < 0,
        shape=lambda a, b, s, t, side=side: (a, b * (0.75 + 0.25 * (s if side > 0 else 1 - s))),
    )
    decal(
        f"TailLamp{tag}",
        surf,
        (side * 0.64, 0.10, -2.05),
        math.pi - side * REAR_YAW,
        0.0,
        0.38,
        0.13,
        "TailLamp",
        car,
        uv=(0.0, 0.08, 1.0, 0.92),
        flip_u=side < 0,
    )
    decal(
        f"FrontIndicator{tag}",
        surf,
        (side * 0.74, -0.15, 2.03),
        side * math.radians(30),
        0.0,
        0.16,
        0.025,
        f"Indicator{tag}",
        car,
        segs=(6, 1),
    )
    decal(
        f"SideRepeater{tag}",
        surf,
        (side * 0.93, 0.02, 1.62),
        side * math.pi / 2,
        0.0,
        0.07,
        0.022,
        f"Indicator{tag}",
        car,
        segs=(3, 1),
    )
    decal(f"Reverse{tag}", surf, (side * 0.48, -0.40, -2.12), math.pi, 0.0, 0.10, 0.035, "Reverse", car, segs=(4, 1))
    decal(
        f"Reflector{tag}",
        surf,
        (side * 0.72, -0.44, -2.08),
        math.pi - side * 0.3,
        0.0,
        0.14,
        0.03,
        "Reflector",
        car,
        segs=(4, 1),
    )
    decal(f"Fog{tag}", surf, (side * 0.70, -0.42, 2.10), side * 0.25, 0.0, 0.12, 0.05, "Chrome", car, segs=(4, 2))
decal("Intake", surf, (0.0, -0.36, 2.14), 0.0, 0.0, 1.10, 0.13, "Trim", car, segs=(16, 2), offset=0.003)
decal("GrilleBack", surf, (0.0, -0.16, 2.14), 0.0, 0.0, 0.92, 0.17, "Trim", car, segs=(16, 3), offset=0.003)
decal(
    "Grille",
    surf,
    (0.0, -0.16, 2.14),
    0.0,
    0.0,
    0.92,
    0.17,
    "Grille",
    car,
    segs=(16, 3),
    offset=0.007,
    uv=(0, 0, 6.0, 1.1),
)
decal("Diffuser", surf, (0.0, -0.53, -2.13), math.pi, 0.0, 1.30, 0.10, "Trim", car, segs=(16, 2), offset=0.003)
decal(
    "BrakeLampHigh",
    surf,
    (0.0, 0.565, -1.38),
    math.pi,
    math.radians(40),
    0.36,
    0.025,
    "TailLamp",
    car,
    segs=(6, 1),
    uv=(0.3, 0.45, 0.7, 0.55),
)

# Panel shut lines and wipers.
for side in (1, -1):
    for z in (0.93, -0.36, -0.95):
        stroke(
            f"Gap{z:+.2f}{side}",
            surf,
            [
                ((side * 1.4, y, z), (-side, 0, 0))
                for y in [-0.60 + 0.04 * i for i in range(21)]
                if y < interp(SHOULDER, z) - 0.005
            ],
            0.006,
            "Gap",
            car,
        )
    stroke(
        f"BonnetGap{side}",
        surf,
        [((side * (interp(HALF_WIDTH, z) - 0.10), 1.5, z), (0, -1, 0)) for z in [0.95 + 0.06 * i for i in range(18)]],
        0.006,
        "Gap",
        car,
    )
    stroke(
        f"Wiper{side}",
        surf,
        [((side * (0.05 + 0.055 * i), 1.5, 0.90 - 0.004 * i), (0, -1, 0)) for i in range(11)],
        0.016,
        "Trim",
        car,
        offset=0.012,
    )
    stroke(
        f"Sill{side}",
        surf,
        [((side * 1.4, -0.60, z), (-side, 0, 0)) for z in [0.90 - 0.06 * i for i in range(31)] if z > -0.92],
        0.05,
        "Trim",
        car,
        offset=0.002,
    )
stroke(
    "TailgateGap",
    surf,
    [((x, 0.28, -2.6), (0, 0, 1)) for x in [-0.78 + 0.06 * i for i in range(27)]],
    0.006,
    "Gap",
    car,
)

# Mirrors, handles, spoiler, antenna, exhaust.
mbm = bmesh.new()
MIRROR_Z = 0.78
mirror_x = {}
for side in (1, -1):
    h = surf.hit((side * 1.5, 0.23, MIRROR_Z), (-side, 0, 0))
    root_x = abs(h[0].x) if h else 0.88
    mirror_x[side] = root_x
    box(mbm, (side * (root_x + 0.12), 0.27, MIRROR_Z), (0.20, 0.11, 0.08), mat=0)
    box(mbm, (side * (root_x + 0.01), 0.24, MIRROR_Z + 0.01), (0.07, 0.035, 0.055), mat=1)  # stalk
mirrors = new_object("Mirrors", mbm, ["Paint", "Trim"], car)
sub = mirrors.modifiers.new("soften", "SUBSURF")
sub.levels = 2
apply_modifiers(mirrors)
for side in (1, -1):
    tag = "L" if side > 0 else "R"
    gbm = bmesh.new()
    box(gbm, (side * (mirror_x[side] + 0.125), 0.27, MIRROR_Z - 0.043), (0.17, 0.085, 0.004))
    new_object(f"MirrorGlass{tag}", gbm, ["Mirror"], car, smooth=False)
    decal(
        f"MirrorRepeater{tag}",
        Surface(mirrors),
        (side * (mirror_x[side] + 0.16), 0.25, MIRROR_Z + 0.04),
        side * 0.9,
        -0.3,
        0.07,
        0.015,
        f"Indicator{tag}",
        car,
        segs=(3, 1),
    )
hbm = bmesh.new()
for side in (1, -1):
    for z in (0.12, -0.80):
        h = surf.hit((side * 1.4, 0.08, z), (-side, 0, 0))
        x = h[0].x + side * 0.012 if h else side * 0.93
        box(hbm, (x, 0.08, z), (0.025, 0.03, 0.15))
handles = new_object("Handles", hbm, ["Chrome"], car)
sub = handles.modifiers.new("soften", "SUBSURF")
sub.levels = 2
apply_modifiers(handles)
sbm = bmesh.new()
# Roof spoiler resting on the roof's trailing edge (ray-cast so it never floats).
roof_hit = surf.hit((0.0, 2.0, -1.36), (0, -1, 0))
top = roof_hit[0].y if roof_hit else interp(TOP, -1.36)
box(sbm, (0.0, top + 0.012, -1.40), (1.10, 0.04, 0.20), rot=Matrix.Rotation(math.radians(-6), 3, "X"))
bmesh.ops.recalc_face_normals(sbm, faces=sbm.faces)
spoiler = new_object("Spoiler", sbm, ["Paint"], car)
sub = spoiler.modifiers.new("soften", "SUBSURF")
sub.levels = 2
apply_modifiers(spoiler)
abm = bmesh.new()
box(abm, (0.0, interp(TOP, -1.05) + 0.03, -1.05), (0.06, 0.06, 0.16), rot=Matrix.Rotation(math.radians(-12), 3, "X"))
fin = new_object("Antenna", abm, ["Blackout"], car)
sub = fin.modifiers.new("soften", "SUBSURF")
sub.levels = 2
apply_modifiers(fin)
ebm = bmesh.new()
cylinder_x(ebm, -0.12, 0.12, 0.035, 16)
bmesh.ops.rotate(ebm, verts=ebm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
bmesh.ops.translate(ebm, verts=ebm.verts, vec=(0.42, -0.58, -2.12))
new_object("Exhaust", ebm, ["Chrome"], car)

# Number plates: private by default; the taxi set is toggled by the game.
private = empty("Private", car)
flat_plate("PlateFront", surf, -0.36, 1, "PlatePrivate", private)
flat_plate("PlateRear", surf, -0.14, -1, "PlatePrivate", private)
taxi = empty("Taxi", car)
flat_plate("PlateFrontTaxi", surf, -0.36, 1, "PlateCommercial", taxi)
flat_plate("PlateRearTaxi", surf, -0.14, -1, "PlateCommercial", taxi)


def taxi_sign(name, parent, z=-0.20):
    """屋根上表示灯: tapered box, sign artwork on the front and back faces."""
    roof = interp(TOP, z)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    w0, w1, h, d = 0.29, 0.25, 0.16, 0.075
    y0, y1 = roof + 0.005, roof + 0.005 + h
    v = {}
    for zs in (1, -1):
        v[zs, 0, -1] = bm.verts.new((-w0, y0, z + zs * d))
        v[zs, 0, 1] = bm.verts.new((w0, y0, z + zs * d))
        v[zs, 1, 1] = bm.verts.new((w1, y1, z + zs * d * 0.8))
        v[zs, 1, -1] = bm.verts.new((-w1, y1, z + zs * d * 0.8))
    for zs in (1, -1):
        quad = [v[zs, 0, -1], v[zs, 0, 1], v[zs, 1, 1], v[zs, 1, -1]]
        f = bm.faces.new(quad if zs > 0 else list(reversed(quad)))
        f.material_index = 0
        for loop in f.loops:
            x, y = loop.vert.co.x, loop.vert.co.y
            u = (x / w0 + 1) / 2
            loop[uvl].uv = (u if zs > 0 else 1 - u, (y - y0) / h)
    for a, b, c, dd in [
        ((1, 0, 1), (-1, 0, 1), (-1, 1, 1), (1, 1, 1)),
        ((1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)),
        ((1, 0, -1), (1, 1, -1), (-1, 1, -1), (-1, 0, -1)),
        ((1, 0, -1), (-1, 0, -1), (-1, 0, 1), (1, 0, 1)),
    ]:
        f = bm.faces.new([v[k] for k in (a, b, c, dd)])
        f.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, ["TaxiSign", "TaxiSignBody"], parent, smooth=False)


taxi_sign("TaxiSign", taxi)
vbm = bmesh.new()
vuv = vbm.loops.layers.uv.new("UVMap")
# 空車表示 on the passenger (left, +X) side of the dashboard, facing out through the windscreen.
quad = [(0.36, 0.215, 0.885), (0.58, 0.215, 0.885), (0.58, 0.27, 0.872), (0.36, 0.27, 0.872)]
f = vbm.faces.new([vbm.verts.new(p) for p in quad])
for loop, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)], strict=True):
    loop[vuv].uv = uv
f.normal_update()
if f.normal.z < 0:
    f.normal_flip()
new_object("Vacancy", vbm, ["Vacancy"], taxi, smooth=False)

wheel = build_wheel("Wheel")
caliper = build_caliper("Caliper")

# ---------------------------------------------------------------------------- assemble: low LOD

low = empty("CarLow")
body_low = build_body("BodyLow", 0, low)
body_low.data.materials[BODY_MATS.index("Glass")] = MAT["GlassLow"]
low_surf = Surface(body_low)
for side in (1, -1):
    tag = "L" if side > 0 else "R"
    decal(
        f"HeadLow{tag}",
        low_surf,
        (side * 0.60, -0.035, 2.1),
        side * FRONT_YAW,
        0.0,
        0.38,
        0.14,
        "LampLowFront",
        low,
        segs=(8, 3),
        offset=0.006,
    )
    decal(
        f"TailLow{tag}",
        low_surf,
        (side * 0.64, 0.10, -2.1),
        math.pi - side * REAR_YAW,
        0.0,
        0.36,
        0.12,
        "LampLowRear",
        low,
        segs=(8, 3),
        offset=0.006,
    )
taxi_low = empty("TaxiLow", low)
taxi_sign("TaxiSignLow", taxi_low)
wheel_low = build_wheel_low("WheelLow")
low_wheels = []
for x, z in ((0.82, WHEEL_Z), (-0.82, WHEEL_Z), (0.82, -WHEEL_Z), (-0.82, -WHEEL_Z)):
    w = wheel_low.copy()
    w.data = wheel_low.data.copy()
    SCENE.collection.objects.link(w)
    w.location = (x, HUB_Y, z)
    w.rotation_euler = (0.0, math.pi if x < 0 else 0.0, 0.0)  # rim face outward
    bpy.context.view_layer.update()
    low_wheels.append(w)
join_into(body_low, [c for c in low.children if c.type == "MESH"] + low_wheels)
bpy.data.objects.remove(wheel_low)

# Hi: everything that is always shown becomes one mesh; the Private/Taxi variants stay separate.
bpy.context.view_layer.update()
join_into(body, [c for c in car.children if c.type == "MESH"])

# ---------------------------------------------------------------------------- export

for ob in list(SCENE.objects):
    ob.select_set(False)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=False,
    export_apply=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == "MESH" else 0


def subtree(root):
    return [root] + [c for c in root.children_recursive]


log(
    "exported",
    file=OUT,
    bytes=os.path.getsize(OUT),
    tris={
        "CarHi": sum(tris(o) for o in subtree(car)),
        "Wheel": tris(wheel),
        "CarLow": sum(tris(o) for o in subtree(low)),
    },
    materials={"Body": len(body.data.materials), "BodyLow": len(body_low.data.materials)},
)

# ---------------------------------------------------------------------------- previews (not exported)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    for z, x in ((WHEEL_Z, 0.82), (WHEEL_Z, -0.82), (-WHEEL_Z, 0.82), (-WHEEL_Z, -0.82)):
        for src, mirror in ((wheel, x < 0), (caliper, x < 0)):
            c = src.copy()
            SCENE.collection.objects.link(c)
            c.location = (x, HUB_Y, z)
            c.scale = (-1 if mirror else 1, 1, 1)
    low.location = (3.2, 0, 0)
    taxi_parts = subtree(taxi) + subtree(taxi_low)

    def show_taxi(on):
        for o in taxi_parts:
            o.hide_render = not on
        for o in subtree(private):
            o.hide_render = on

    gbm = bmesh.new()
    for p in [(-30, -0.86, -30), (30, -0.86, -30), (30, -0.86, 30), (-30, -0.86, 30)]:
        gbm.verts.new(p)
    gbm.faces.new(gbm.verts)
    material("Ground", 0x6C7076, roughness=0.9)
    new_object("Ground", gbm, ["Ground"], smooth=False)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    SCENE.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(4)
    # Lights shine along local −Z; aim it down (−Y) from the front-left.
    sun.rotation_euler = (math.radians(-62), math.radians(32), 0)
    SCENE.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 50
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    SCENE.render.engine = "CYCLES"
    SCENE.cycles.device = "CPU"
    SCENE.cycles.samples = int(os.environ.get("PREVIEW_SAMPLES", "64"))
    SCENE.cycles.use_denoising = True
    SCENE.render.resolution_x = 1280
    SCENE.render.resolution_y = 720
    views = {
        "front34": ((-5.0, 1.2, 6.2), (-0.2, -0.1, 0.0), False),
        "rear34": ((-5.2, 1.5, -6.0), (-0.2, -0.1, 0.0), False),
        "side": ((-8.0, 0.1, 0.0), (0.0, -0.15, 0.0), False),
        "front": ((0.0, 0.1, 7.2), (0.0, -0.2, 0.0), False),
        "wheel": ((-2.3, -0.35, 2.4), (-0.82, -0.5, 1.35), False),
        "taxi": ((-5.6, 2.0, 5.2), (0.0, -0.1, 0.0), True),
        "low": ((9.5, 1.6, 6.4), (3.2, -0.2, 0.0), False),
    }
    for view, (eye, target, is_taxi) in views.items():
        show_taxi(is_taxi)
        cam.location = eye
        # Camera looks along local −Z with local +Y up; the world's up here is +Y, not Blender's +Z.
        fwd = (Vector(target) - Vector(eye)).normalized()
        right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
        up = right.cross(fwd)
        cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
        SCENE.render.filepath = os.path.join(PREVIEW, f"car-{view}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", view=view, file=SCENE.render.filepath)
