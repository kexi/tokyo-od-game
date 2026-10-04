# Shared helpers for the police vehicle scripts (police_car.py, police_bike.py).
#
# Imported by those scripts after they put scripts/blender on sys.path; not run on its own.
# Everything is modelled in game coordinates (+Y up, nose toward +Z, ground at y = 0, the
# vehicle's left = +X) and exported with export_yup=False, as in ambulance.py and motorbike.py.
# The mesh, decal and wheel helpers are the same techniques as car.py / motorbike.py (see
# knowledge/car-model-blender.md for the pitfalls they avoid: UV maps before join, zeroed new UV
# layers, camera basis built by hand).
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEX = os.path.join(ROOT, "assets", "police", "textures")
HUMAN_TEX = os.path.join(ROOT, "assets", "human", "textures")


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def scene():
    return bpy.context.scene


# ---------------------------------------------------------------------------- materials


def lin(hex_color):
    """sRGB 0xRRGGBB → linear RGBA (Principled BSDF inputs are linear)."""

    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (ch((hex_color >> 16) & 255), ch((hex_color >> 8) & 255), ch(hex_color & 255), 1.0)


MAT = {}
_IMAGES = {}


def image(name, tex_dir=TEX):
    path = os.path.join(tex_dir, name)
    if not os.path.exists(path):
        log("texture_missing", file=name)
        return None
    if path not in _IMAGES:
        _IMAGES[path] = bpy.data.images.load(path)
    return _IMAGES[path]


def material(
    name,
    color=0xFFFFFF,
    metallic=0.0,
    roughness=0.5,
    coat=0.0,
    tex=None,
    tex_dir=TEX,
    emissive=None,
    clip=False,
    tint=None,
    double_sided=False,
    alpha=1.0,
):
    """Principled material. `emissive` = hex colour, or True to light it with the texture.
    `tint` multiplies the texture (glTF baseColorFactor), e.g. the face texture's skin tone.
    Without its texture (not generated yet) the material falls back to the plain colour."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.04
    node = None
    img = image(tex, tex_dir) if tex else None
    if img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        color_out = node.outputs["Color"]
        if tint is not None:
            # Image × constant is how the glTF exporter writes baseColorFactor.
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            nt.links.new(color_out, mix.inputs[6])
            mix.inputs[7].default_value = lin(tint)
            color_out = mix.outputs[2]
        nt.links.new(color_out, b.inputs["Base Color"])
        if clip:
            # Round(alpha) is how the glTF exporter recognises alphaMode MASK (cutoff 0.5).
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            nt.links.new(node.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], b.inputs["Alpha"])
    elif tint is not None:
        b.inputs["Base Color"].default_value = lin(tint)
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"  # glTF alphaMode BLEND
    if emissive is not None:
        if emissive is True and node is not None:
            nt.links.new(node.outputs["Color"], b.inputs["Emission Color"])
        else:
            b.inputs["Emission Color"].default_value = lin(color if emissive is True else emissive)
        b.inputs["Emission Strength"].default_value = 1.0
    MAT[name] = m
    return m


# ---------------------------------------------------------------------------- objects


def new_object(name, bm, mats, parent=None, smooth=False, origin=(0.0, 0.0, 0.0)):
    """Object whose origin is `origin`; the mesh is given in world coordinates."""
    if any(origin):
        bmesh.ops.translate(bm, verts=bm.verts, vec=-Vector(origin))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    scene().collection.objects.link(ob)
    ob.location = origin
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob


def empty(name, parent=None, location=(0.0, 0.0, 0.0)):
    ob = bpy.data.objects.new(name, None)
    scene().collection.objects.link(ob)
    ob.location = location
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


def ensure_uv(ob):
    if "UVMap" not in ob.data.uv_layers:
        # A new map starts as a per-face 0–1 unwrap, which would split every vertex on export.
        layer = ob.data.uv_layers.new(name="UVMap")
        for d in layer.data:
            d.uv = (0.0, 0.0)


def join_into(target, objects):
    """Merge meshes into `target` (one glTF mesh → one draw call per material)."""
    objects = [o for o in objects if o is not target and o.type == "MESH"]
    if not objects:
        return target
    bpy.context.view_layer.update()
    for o in [target, *objects]:
        ensure_uv(o)  # join drops UVs when the target has no map of the same name
    for o in objects:
        o.data.transform(target.matrix_world.inverted() @ o.matrix_world)
        o.parent = None
        o.matrix_world = target.matrix_world
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


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == "MESH" else 0


# ---------------------------------------------------------------------------- bmesh builder


class Mesh:
    """bmesh + UV layer whose material slots are addressed by name (as in motorbike.py)."""

    def __init__(self, mats):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = list(mats)

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def face(self, verts, mat, uvs=None, facing=None):
        vs = [v if isinstance(v, bmesh.types.BMVert) else self.bm.verts.new(v) for v in verts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mat(mat)
        if uvs:
            for loop, uv in zip(f.loops, uvs, strict=True):
                loop[self.uv].uv = uv
        if facing is not None:
            f.normal_update()
            if f.normal.dot(Vector(facing)) < 0:
                f.normal_flip()
            f.tag = True  # oriented here: obj() leaves it alone when it recalculates normals
        return f

    def box(self, center, size, mat, rot=None, uv_box=None):
        """Box; uv_box = (u0, v0, u1, v1) maps every face onto that rectangle."""
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
            vs.append(self.bm.verts.new(p + Vector((cx, cy, cz))))
        faces = []
        for quad in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]:
            uvs = None
            if uv_box:
                u0, v0, u1, v1 = uv_box
                uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            faces.append(self.face([vs[i] for i in quad], mat, uvs=uvs))
        return faces

    def beam(self, p0, p1, thickness, mat):
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        self.box((p0 + p1) / 2, (thickness, thickness, axis.length), mat, rot=axis.to_track_quat("Z", "Y").to_matrix())

    def tube(self, p0, p1, r0, r1, mat, segs=8, caps=True, uv_disc=None):
        """Tapered tube from p0 (radius r0) to p1 (radius r1); uv_disc = (cu, cv, ru, rv) maps
        the p1 cap as a disc (e.g. a lamp lens)."""
        p0, p1 = Vector(p0), Vector(p1)
        rot = (p1 - p0).to_track_quat("Z", "Y").to_matrix()
        rings = []
        for p, r in ((p0, r0), (p1, r1)):
            rings.append(
                [
                    self.bm.verts.new(
                        p
                        + rot @ Vector((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), 0))
                    )
                    for k in range(segs)
                ]
            )
        for k in range(segs):
            j = (k + 1) % segs
            f = self.face([rings[0][k], rings[0][j], rings[1][j], rings[1][k]], mat)
            f.tag = not caps
        if caps:
            self.face(list(reversed(rings[0])), mat)
            uvs = None
            if uv_disc:
                cu, cv, ru, rv = uv_disc
                uvs = [
                    (cu + ru * math.cos(2 * math.pi * k / segs), cv + rv * math.sin(2 * math.pi * k / segs))
                    for k in range(segs)
                ]
            self.face(rings[1], mat, uvs=uvs)
        return rings

    def ellipsoid(self, centre, radii, mat, segs=10, rows=6, uv_of=None, rot=None):
        """UV sphere; uv_of(local_vertex, local_face_centre) gives each corner's UV."""
        c = Vector(centre)
        rx, ry, rz = radii

        def at(p):
            p = Vector(p)
            return c + (rot @ p if rot is not None else p)

        top = self.bm.verts.new(at((0, ry, 0)))
        bottom = self.bm.verts.new(at((0, -ry, 0)))
        local = {top: Vector((0, ry, 0)), bottom: Vector((0, -ry, 0))}
        grid = []
        for r in range(1, rows):
            phi = math.pi * r / rows
            row = []
            for i in range(segs):
                p = Vector(
                    (
                        rx * math.sin(phi) * math.sin(2 * math.pi * i / segs),
                        ry * math.cos(phi),
                        rz * math.sin(phi) * math.cos(2 * math.pi * i / segs),
                    )
                )
                v = self.bm.verts.new(at(p))
                local[v] = p
                row.append(v)
            grid.append(row)
        faces = []
        for i in range(segs):
            j = (i + 1) % segs
            faces.append(self.face([top, grid[0][j], grid[0][i]], mat))
            faces.append(self.face([bottom, grid[-1][i], grid[-1][j]], mat))
            for k in range(len(grid) - 1):
                faces.append(self.face([grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]], mat))
        if uv_of:
            for f in faces:
                mid = sum((local[lp.vert] for lp in f.loops), Vector()) / len(f.loops)
                for lp in f.loops:
                    lp[self.uv].uv = uv_of(local[lp.vert], mid)
        return faces

    def loft(self, rings_spec, segs, mat, uv_of=None, cap_bottom=True, cap_top=True, mat_of=None):
        """Loft through horizontal rings [(y, rx, rz, cx, cz)] (θ = 0 at +Z, +π/2 at +X);
        uv_of(theta, ring_index, face_mid_theta) per corner (the face's θ lets a texture seam
        fall between faces), mat_of(theta, ring_index) per face."""
        grid = []
        for y, rx, rz, cx, cz in rings_spec:
            grid.append(
                [
                    self.bm.verts.new(
                        (cx + rx * math.sin(2 * math.pi * i / segs), y, cz + rz * math.cos(2 * math.pi * i / segs))
                    )
                    for i in range(segs)
                ]
            )
        for k in range(len(grid) - 1):
            for i in range(segs):
                j = (i + 1) % segs
                mid = 2 * math.pi * (i + 0.5) / segs
                m = mat_of(mid, k) if mat_of else mat
                f = self.face([grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]], m)
                if uv_of:
                    for loop, (col, row) in zip(f.loops, [(i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1)], strict=True):
                        loop[self.uv].uv = uv_of(2 * math.pi * col / segs, row, mid)
        # Orient by hand (open lofts confuse recalc_face_normals): sides away from the ring axis,
        # caps away from the neighbouring ring.
        for k in range(len(grid) - 1):
            for i in range(segs):
                f = self.bm.faces.get(
                    [grid[k][i], grid[k][(i + 1) % segs], grid[k + 1][(i + 1) % segs], grid[k + 1][i]]
                )
                if f is None:
                    continue
                c = f.calc_center_median()
                y0, y1 = rings_spec[k][0], rings_spec[k + 1][0]
                t = 0.5 if abs(y1 - y0) < 1e-9 else min(1.0, max(0.0, (c.y - y0) / (y1 - y0)))
                ax = Vector(rings_spec[k][3:5]).lerp(Vector(rings_spec[k + 1][3:5]), t)
                radial = Vector((c.x - ax.x, 0.0, c.z - ax.y))
                f.normal_update()
                if f.normal.dot(radial) < 0:
                    f.normal_flip()
                f.tag = True
        for row, cap, idx, nb in ((grid[0], cap_bottom, 0, 1), (grid[-1], cap_top, len(grid) - 1, len(grid) - 2)):
            if not cap:
                continue
            away = rings_spec[idx][0] - rings_spec[nb][0]
            f = self.face(row, mat, facing=(0.0, away, 0.0))
            if uv_of:
                for loop in f.loops:
                    loop[self.uv].uv = uv_of(0.0, idx, 0.0)
        return grid

    def loft_z(self, stations, mat, n=2.6, segs=14):
        """Rounded body through rings at z: stations = [(z, half_width, bottom, top)], superellipse
        cross-sections (exponent n), closed at both ends."""
        rings = []
        for z, w, y0, y1 in stations:
            yc, h = (y0 + y1) / 2, (y1 - y0) / 2
            ring = []
            for k in range(segs):
                t = 2 * math.pi * k / segs
                c, s = math.cos(t), math.sin(t)
                ring.append(
                    self.bm.verts.new(
                        (w * math.copysign(abs(c) ** (2 / n), c), yc + h * math.copysign(abs(s) ** (2 / n), s), z)
                    )
                )
            rings.append(ring)
        for a, b in zip(rings, rings[1:], strict=False):
            for k in range(segs):
                j = (k + 1) % segs
                self.face([a[k], a[j], b[j], b[k]], mat)
        self.face(rings[0], mat)
        self.face(list(reversed(rings[-1])), mat)

    def obj(self, name, parent=None, matrix=None, smooth=False):
        """Object whose transform is `matrix` (the mesh is given in world coordinates)."""
        matrix = matrix or Matrix.Identity(4)
        bmesh.ops.recalc_face_normals(self.bm, faces=[f for f in self.bm.faces if not f.tag])
        bmesh.ops.transform(self.bm, matrix=matrix.inverted(), verts=self.bm.verts)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MAT[m])
        for p in me.polygons:
            p.use_smooth = smooth
        ob = bpy.data.objects.new(name, me)
        scene().collection.objects.link(ob)
        ob.matrix_world = matrix
        if parent is not None:
            ob.parent = parent
            ob.matrix_parent_inverse = parent.matrix_world.inverted()
        return ob


# ---------------------------------------------------------------------------- surface decals


class Surface:
    """Ray casts against a finished body, for decals that hug its curvature."""

    def __init__(self, ob):
        self.ob = ob

    def hit(self, origin, direction, distance=4.0):
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
    segs=(12, 4),
    uv=(0, 0, 1, 1),
    flip_u=False,
    offset=0.004,
    shape=None,
):
    """Grid projected onto the body along −normal (car.py's decal); UVs span (u0, v0, u1, v1).
    yaw/pitch give the outward normal: yaw 0 = +Z (front), π/2 = +X (left side)."""
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
            start = c + n * 0.6 + right * a + up * b
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
    return new_object(name, bm, [mat])


# ---------------------------------------------------------------------------- export & preview


def export_glb(path):
    for ob in list(scene().objects):
        ob.select_set(False)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
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


def look(cam, eye, target):
    """Camera looks along local −Z with local +Y up; the world's up here is +Y, not Blender's +Z."""
    cam.location = eye
    fwd = (Vector(target) - Vector(eye)).normalized()
    right = fwd.cross(Vector((0.0, 1.0, 0.0))).normalized()
    up = right.cross(fwd)
    cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()


def preview_setup(lens=45, ground=8.0):
    sc = scene()
    material("PreviewGround", 0x6A6D70, roughness=0.9)
    gm = Mesh(["PreviewGround"])
    gm.face([(-ground, 0, -ground), (-ground, 0, ground), (ground, 0, ground), (ground, 0, -ground)], "PreviewGround")
    gm.obj("PreviewGround")
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.68, 0.8, 1)
    sc.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(-60), math.radians(35), 0)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = lens
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = int(os.environ.get("PREVIEW_SAMPLES", "32"))
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 720
    return cam


def render(cam, path, eye, target):
    look(cam, eye, target)
    scene().render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("preview", file=path)
