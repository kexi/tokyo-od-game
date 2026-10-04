# 東京駅丸の内駅舎 (Tokyo Station Marunouchi Building, as restored in 2012) for TOKYO OPEN DRIVE.
#
# Imported by scripts/blender/landmarks.py (build_tokyo_station), which passes its helpers in `L`
# (Builder, Palette, material, SCENE, ...) and exports the result as public/models/tokyo_station.glb
# (+ _far.glb) like the other landmarks.
#
# Sources (all recorded in knowledge/landmarks-blender.md with how each number was derived):
#   - JR East press release 2007-05-08 「東京駅丸の内駅舎保存・復原工事の着工について」: maximum height
#     about 46.1 m with the finials (34.8 m without), eaves about 16.7 m, 3 storeys, and its published
#     restored front elevation (別紙1) and floor plans (別紙3), measured for the bay rhythm and heights.
#   - PLATEAU LOD2 (bldg_6af58cef…, LiDAR-derived) for the plan: dome centres ±99.1 m, the dome halls'
#     outline, the drums (apothem ≈10.6 m), the pavilions (north +49.35 m, south −45.35 m: the façade
#     is NOT symmetric about the centre), the bent south wing, the round towers at the north end.
#   - Wikimedia Commons photographs (Daderot CC0, MaedaAkihiko / Nesnad / RuinDig CC BY(-SA) …) for
#     the details (windows, pilasters, bands, balustrades, domes, ornaments) and the colours. No pixel
#     of any photograph is used in the model.
#
# Plan coordinates: a = metres along the building toward its north end (bearing 17.05°), c = metres
# across toward the tracks, from the centre of symmetry of the two domes; model x = −a, z = −c, so +Z
# faces the Marunouchi plaza (行幸通り). Heights from the ground at the façade.
#
# Materials are named after what they are (Day_TS_BrickRed, Day_TS_GraniteWhite, …) and carry
# world-scale UVs in units of one texture tile (TILE below), so the textures agy will make can be
# swapped in without touching the geometry. Glass and the clock dials are mapped 0–1 per opening.
import math
import os

import bmesh
from mathutils import Vector

UP = Vector((0.0, 1.0, 0.0))

# Texture tile per material in metres (u, v): UV 1.0 = one tile. Seamless repeats of the real pattern:
# brick 210 × 60 mm faces with 10 mm joints (pitch 220 × 70 mm): 5 stretchers × 16 courses.
TILE = {
    "TS_BrickRed": (1.10, 1.12),
    "TS_GraniteWhite": (1.0, 1.0),
    "TS_SlateRoof": (1.0, 1.05),
    "TS_CopperRoof": (0.9, 0.9),
    "TS_CopperTrim": (1.0, 1.0),
    "TS_WindowFrame": (1.0, 1.0),
    "TS_Ironwork": (1.0, 1.0),
    "TS_CanopySteel": (2.0, 2.0),
    "TS_RoofGlass": (1.5, 1.5),
    "TS_FarRoof": (8.0, 8.0),
    "TS_FarCopper": (8.0, 8.0),
}

# ---------------------------------------------------------------------------------------------- heights
# Floor lines of the 丸の内 façade in metres above the plaza, measured on Tokyo-STA_Marunouchi-Entrance_2023.jpg
# (25 mm equivalent, camera 108 m from the façade: 24.6 px/m on the 3840 px copy, checked against the 4.07 m
# pilaster pitch and the pavilions 94.7 m apart) and cross-checked with JR's 軒高 約16.7 m and the PLATEAU
# wall top of 18.2 m (the balustrade).
PLINTH = 0.7  # granite 腰石
F1 = (1.0, 4.95)  # ground-floor windows
BAND1 = (5.95, 6.25)  # 1F/2F string course
SILL2 = (7.2, 7.45)  # 2F sill course
F2 = (7.55, 11.0)
BAND2 = (12.55, 12.85)
F3 = (13.1, 15.15)
ARCHI = (15.35, 16.3)  # granite frieze above the 3F windows
CORNICE = (16.3, 17.0)
BAL = (17.0, 18.0)  # balustrade: plinth, balusters, rail
RIDGE = 22.7  # PLATEAU: 22.1–22.9 m
ARC1 = (0.78, 0.26, 3.55)  # 1F round arches: inner radius, ring, springing (crown 4.6 m)
WEST, EAST = -10.6, 10.8  # façade planes (c)
BAY = 4.0
DOME_A = 99.1
DRUM_R = 10.6  # apothem
DOME_TOP = 34.8  # JR: 34.8 m without the finial
FINIAL_TOP = 46.1  # JR: 46.1 m with it
NORTH_PAV, SOUTH_PAV = 49.35, -45.35
PAV_HALF = 4.75
DORMER_BASE = 18.3


def M(a, y, c):
    """Plan (a, c) + height -> model coordinates."""
    return (-a, y, -c)


def mv(va, vc, vy=0.0):
    """Plan direction -> model vector."""
    return Vector((-va, vy, -vc))


class Frame:
    """A wall plane: origin (a, c), unit `along` and outward `out` in plan. Local (s, y, d)."""

    def __init__(self, a, c, along, out):
        self.a, self.c = a, c
        self.ua, self.uc = along
        self.na, self.nc = out
        self.U = mv(*along)
        self.N = mv(*out)

    @staticmethod
    def between(p0, p1, outward_sign=1):
        """Frame on the segment p0 -> p1 (plan points); s = 0 at p0. out = along rotated by -90° * sign."""
        da, dc = p1[0] - p0[0], p1[1] - p0[1]
        n = math.hypot(da, dc)
        ua, uc = da / n, dc / n
        out = (uc * outward_sign, -ua * outward_sign)
        return Frame(p0[0], p0[1], (ua, uc), out), n

    def p(self, s, y, d=0.0):
        return M(self.a + s * self.ua + d * self.na, y, self.c + s * self.uc + d * self.nc)


class Station:
    def __init__(self, L, name, pal):
        self.L = L
        self.b = L.Builder(name)
        self.pal = pal
        self.lit_toggle = 0

    # ------------------------------------------------------------------ faces
    def face(self, pts, mat, normal=None, uvs=None, smooth=False):
        p = [Vector(q) for q in pts]
        n = Vector((0, 0, 0))
        for i in range(len(p)):  # Newell normal (works for any planar polygon)
            q0, q1 = p[i], p[(i + 1) % len(p)]
            n += Vector(((q0.y - q1.y) * (q0.z + q1.z), (q0.z - q1.z) * (q0.x + q1.x), (q0.x - q1.x) * (q0.y + q1.y)))
        if n.length < 1e-9:
            return None
        if normal is not None and n.dot(Vector(normal)) < 0:
            pts = list(reversed(pts))
            uvs = list(reversed(uvs)) if uvs else None
            n = -n
        if uvs is None:
            uvs = self.auto_uv(pts, n, mat)
        return self.b.face(pts, mat, uvs, smooth)

    @staticmethod
    def auto_uv(pts, n, mat):
        tu, tv = TILE.get(mat, (1.0, 1.0))
        n = Vector(n).normalized()
        if abs(n.y) > 0.97:
            t, bt = Vector((1, 0, 0)), Vector((0, 0, -1))
        else:
            t = UP.cross(n).normalized()
            bt = n.cross(t)
        return [(Vector(q).dot(t) / tu, Vector(q).dot(bt) / tv) for q in pts]

    def quad_frame(self, F, s0, s1, y0, y1, d, mat, sign=1, uvs=None):
        """Rectangle on the plane d of frame F, facing outward (sign=-1: inward)."""
        return self.face([F.p(s0, y0, d), F.p(s1, y0, d), F.p(s1, y1, d), F.p(s0, y1, d)], mat, F.N * sign, uvs)

    def box(self, F, s0, s1, y0, y1, d0, d1, mat, skip=("back",)):
        """Box in frame F; skip any of front/back/left/right/top/bottom."""
        c = {
            "front": ([(s0, y0, d1), (s1, y0, d1), (s1, y1, d1), (s0, y1, d1)], F.N),
            "back": ([(s0, y0, d0), (s1, y0, d0), (s1, y1, d0), (s0, y1, d0)], -F.N),
            "left": ([(s0, y0, d0), (s0, y0, d1), (s0, y1, d1), (s0, y1, d0)], -F.U),
            "right": ([(s1, y0, d0), (s1, y0, d1), (s1, y1, d1), (s1, y1, d0)], F.U),
            "top": ([(s0, y1, d0), (s1, y1, d0), (s1, y1, d1), (s0, y1, d1)], UP),
            "bottom": ([(s0, y0, d0), (s1, y0, d0), (s1, y0, d1), (s0, y0, d1)], -UP),
        }
        for k, (pts, n) in c.items():
            if k not in skip:
                self.face([F.p(*q) for q in pts], mat, n)

    def extrude(self, F, s0, s1, profile, mat, caps=True):
        """Profile [(d, y), …] counter-clockwise in the (d, y) plane, swept along s from s0 to s1."""
        n = len(profile)
        for i in range(n - 1):
            (d0, y0), (d1, y1) = profile[i], profile[i + 1]
            nrm = F.N * (y1 - y0) + UP * (-(d1 - d0))
            self.face([F.p(s0, y0, d0), F.p(s1, y0, d0), F.p(s1, y1, d1), F.p(s0, y1, d1)], mat, nrm)
        if caps:
            self.face([F.p(s0, y, d) for d, y in profile], mat, -F.U)
            self.face([F.p(s1, y, d) for d, y in profile], mat, F.U)

    def prism(self, outline, y0, y1, mat, top=None, bottom=None, smooth=False, uv_wrap=None):
        """Vertical prism over a plan outline [(a, c), …]; walls face away from the outline's centroid side
        (outline is made counter-clockwise in plan first). uv_wrap: tile (u, v) for arc-length UVs."""
        pts = ccw(outline)
        k = len(pts)
        dist = 0.0
        for i in range(k):
            (a0, c0), (a1, c1) = pts[i], pts[(i + 1) % k]
            seg = math.hypot(a1 - a0, c1 - c0)
            nrm = mv(c1 - c0, -(a1 - a0))  # outward for a ccw (a, c) polygon
            uvs = None
            if uv_wrap:
                tu, tv = uv_wrap
                uvs = [
                    (dist / tu, y0 / tv),
                    ((dist + seg) / tu, y0 / tv),
                    ((dist + seg) / tu, y1 / tv),
                    (dist / tu, y1 / tv),
                ]
            self.face([M(a0, y0, c0), M(a1, y0, c1), M(a1, y1, c1), M(a0, y1, c0)], mat, nrm, uvs, smooth)
            dist += seg
        if top:
            self.face([M(a, y1, c) for a, c in pts], top, UP)
        if bottom:
            self.face([M(a, y0, c) for a, c in pts], bottom, -UP)

    def lathe(self, ca, cc, profile, sides, mat, phase=0.0, smooth=True, cap=True, tile=None):
        """Surface of revolution about the vertical axis at (ca, cc): profile [(r, y), …] bottom to top.
        Arc-length UVs (u around, v along the profile) in tiles of `tile` metres."""
        tu, tv = tile or TILE.get(mat, (1.0, 1.0))
        rmax = max(r for r, _ in profile)
        vacc = [0.0]
        for (r0, y0), (r1, y1) in zip(profile, profile[1:], strict=False):
            vacc.append(vacc[-1] + math.hypot(r1 - r0, y1 - y0))

        def pt(r, y, k):
            t = phase + 2 * math.pi * k / sides
            return M(ca + r * math.cos(t), y, cc + r * math.sin(t))

        for i in range(len(profile) - 1):
            (r0, y0), (r1, y1) = profile[i], profile[i + 1]
            for k in range(sides):
                u0 = 2 * math.pi * rmax * k / sides / tu
                u1 = 2 * math.pi * rmax * (k + 1) / sides / tu
                v0, v1 = vacc[i] / tv, vacc[i + 1] / tv
                ring = [pt(r0, y0, k), pt(r0, y0, k + 1), pt(r1, y1, k + 1), pt(r1, y1, k)]
                uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
                mid = 2 * math.pi * (k + 0.5) / sides + phase
                out = mv(math.cos(mid), math.sin(mid)) * (y1 - y0) + UP * (r0 - r1)
                if r1 < 1e-6:
                    self.face(ring[:3], mat, out, uvs[:3], smooth)
                elif r0 < 1e-6:
                    self.face([ring[0], ring[2], ring[3]], mat, out, [uvs[0], uvs[2], uvs[3]], smooth)
                else:
                    self.face(ring, mat, out, uvs, smooth)
        if cap and profile[-1][0] > 1e-6:
            r, y = profile[-1]
            self.face([pt(r, y, k) for k in range(sides)], mat, UP)

    def spike(self, a, c, y0, y1, r0, r1=None, sides=6, mat="TS_CopperTrim"):
        self.lathe(
            a, c, [(r0, y0), (r1 if r1 is not None else r0 * 0.4, y1), (0.0, y1 + 0.01)], sides, mat, smooth=True
        )

    # ------------------------------------------------------------------ walls with openings
    def wall(self, F, s0, s1, y0, y1, feats, base="TS_BrickRed", d=0.0):
        """Coplanar wall pieces: feats [(s0, s1, y0, y1, mat|None)] in rising priority; None = hole.
        Rows are cut at every feature edge and runs of one material merged into single quads."""
        fs = [(max(a0, s0), min(a1, s1), max(b0, y0), min(b1, y1), m) for a0, a1, b0, b1, m in feats]
        fs = [f for f in fs if f[1] - f[0] > 1e-4 and f[3] - f[2] > 1e-4]
        xs = sorted({s0, s1, *(f[0] for f in fs), *(f[1] for f in fs)})
        ys = sorted({y0, y1, *(f[2] for f in fs), *(f[3] for f in fs)})
        for j in range(len(ys) - 1):
            ya, yb = ys[j], ys[j + 1]
            ym = (ya + yb) / 2
            row = [f for f in fs if f[2] <= ym <= f[3]]
            runs = []
            for i in range(len(xs) - 1):
                xm = (xs[i] + xs[i + 1]) / 2
                m = base
                for f in row:
                    if f[0] <= xm <= f[1]:
                        m = f[4]
                if runs and runs[-1][2] == m:
                    runs[-1][1] = xs[i + 1]
                else:
                    runs.append([xs[i], xs[i + 1], m])
            for xa, xb, m in runs:
                if m:
                    self.quad_frame(F, xa, xb, ya, yb, d, m)

    def glass_mat(self):
        """Alternate lit (hotel rooms in use) and dark windows in a fixed pseudo-random pattern."""
        self.lit_toggle = (self.lit_toggle * 1103515245 + 12345) & 0x7FFFFFFF
        return "TS_GlassLit" if (self.lit_toggle >> 16) % 5 < 3 else "TS_Glass"

    def window(self, F, s, w, y0, y1, depth=0.28, bars=True, glass=None, reveal="TS_GraniteWhite"):
        """Rectangular opening detail: reveals, frame, glass (UV 0–1), mullion, transom."""
        s0, s1 = s - w / 2, s + w / 2
        g = glass or self.glass_mat()
        dd = -depth
        self.face([F.p(s0, y0, 0), F.p(s0, y0, dd), F.p(s0, y1, dd), F.p(s0, y1, 0)], reveal, F.U)
        self.face([F.p(s1, y0, 0), F.p(s1, y0, dd), F.p(s1, y1, dd), F.p(s1, y1, 0)], reveal, -F.U)
        self.face([F.p(s0, y1, 0), F.p(s1, y1, 0), F.p(s1, y1, dd), F.p(s0, y1, dd)], reveal, -UP)
        self.face([F.p(s0, y0, 0), F.p(s1, y0, 0), F.p(s1, y0, dd), F.p(s0, y0, dd)], reveal, UP)
        fw = min(0.08, w * 0.08)
        fr = "TS_WindowFrame"
        self.quad_frame(F, s0, s1, y0, y0 + fw, dd, fr)
        self.quad_frame(F, s0, s1, y1 - fw, y1, dd, fr)
        self.quad_frame(F, s0, s0 + fw, y0 + fw, y1 - fw, dd, fr)
        self.quad_frame(F, s1 - fw, s1, y0 + fw, y1 - fw, dd, fr)
        self.quad_frame(F, s0 + fw, s1 - fw, y0 + fw, y1 - fw, dd, g, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        if bars:
            df = dd + 0.03
            yt = y0 + (y1 - y0) * 0.76
            self.quad_frame(F, s - 0.035, s + 0.035, y0 + fw, yt, df, fr)
            self.quad_frame(F, s0 + fw, s1 - fw, yt - 0.04, yt + 0.04, df, fr)
            for yb in (y0 + (yt - y0) / 3, y0 + 2 * (yt - y0) / 3):
                self.quad_frame(F, s0 + fw, s1 - fw, yb - 0.015, yb + 0.015, df, fr)

    def arch_window(self, F, s, r_in, ring, y0, ys, depth=0.3, glass=None, key=True, seg=8, frame=True):
        """Round-arched opening: jambs and voussoir ring in granite, brick spandrels up to the bounding
        rectangle [s - r_out, s + r_out] x [y0, ys + r_out], reveals, glass, frame. The wall must leave
        that rectangle as a hole."""
        r_out = r_in + ring
        g = glass or self.glass_mat()
        st, br, fr = "TS_GraniteWhite", "TS_BrickRed", "TS_WindowFrame"
        dd = -depth
        # jambs (granite) below the springing
        self.quad_frame(F, s - r_out, s - r_in, y0, ys, 0, st)
        self.quad_frame(F, s + r_in, s + r_out, y0, ys, 0, st)

        def arc(r, k):
            t = math.pi * k / seg
            return s - r * math.cos(t), ys + r * math.sin(t)

        top = ys + r_out
        for k in range(seg):
            (xa, ya), (xb, yb) = arc(r_in, k), arc(r_in, k + 1)
            (xc, yc), (xd, yd) = arc(r_out, k + 1), arc(r_out, k)
            self.face([F.p(xa, ya), F.p(xb, yb), F.p(xc, yc), F.p(xd, yd)], st, F.N)
            # spandrel: a vertical strip from the outer arc up to the bounding rectangle's top
            self.face([F.p(xd, yd), F.p(xc, yc), F.p(xc, top), F.p(xd, top)], br, F.N)
            # reveal along the arch, facing the arch centre
            tm = math.pi * (k + 0.5) / seg
            self.face(
                [F.p(xa, ya, 0), F.p(xb, yb, 0), F.p(xb, yb, dd), F.p(xa, ya, dd)],
                st,
                F.U * math.cos(tm) - UP * math.sin(tm),
            )
        if key:  # keystone proud of the ring
            self.box(F, s - 0.22, s + 0.22, ys + r_in - 0.05, top + 0.05, 0, 0.08, st)
        # straight reveals
        self.face([F.p(s - r_in, y0, 0), F.p(s - r_in, y0, dd), F.p(s - r_in, ys, dd), F.p(s - r_in, ys, 0)], st, F.U)
        self.face([F.p(s + r_in, y0, 0), F.p(s + r_in, y0, dd), F.p(s + r_in, ys, dd), F.p(s + r_in, ys, 0)], st, -F.U)
        self.face([F.p(s - r_in, y0, 0), F.p(s + r_in, y0, 0), F.p(s + r_in, y0, dd), F.p(s - r_in, y0, dd)], st, UP)
        # glass: rectangle + fan, one 0–1 UV box over the whole opening
        h = ys + r_in - y0

        def uv(x, y):
            return ((x - (s - r_in)) / (2 * r_in), (y - y0) / h)

        fw = 0.07 if frame else 0.0
        rg = r_in - fw
        if not frame:  # a gate: one closed leaf (roll shutter) in the arch
            rect = [(s - r_in, y0), (s + r_in, y0), (s + r_in, ys), (s - r_in, ys)]
            self.face([F.p(x, y, dd) for x, y in rect], g, F.N, [uv(x, y) for x, y in rect])
            for k in range(seg):
                (xa, ya), (xb, yb) = arc(r_in, k), arc(r_in, k + 1)
                self.face(
                    [F.p(s, ys, dd), F.p(xa, ya, dd), F.p(xb, yb, dd)], g, F.N, [uv(s, ys), uv(xa, ya), uv(xb, yb)]
                )
            return
        self.quad_frame(F, s - r_in, s - rg, y0, ys, dd, fr)
        self.quad_frame(F, s + rg, s + r_in, y0, ys, dd, fr)
        self.quad_frame(F, s - rg, s + rg, y0, y0 + fw, dd, fr)
        rect = [(s - rg, y0 + fw), (s + rg, y0 + fw), (s + rg, ys), (s - rg, ys)]
        self.face([F.p(x, y, dd) for x, y in rect], g, F.N, [uv(x, y) for x, y in rect])
        for k in range(seg):
            (xa, ya), (xb, yb) = arc(rg, k), arc(rg, k + 1)
            (xc, yc), (xd, yd) = arc(r_in, k + 1), arc(r_in, k)
            self.face([F.p(xa, ya, dd), F.p(xb, yb, dd), F.p(xc, yc, dd), F.p(xd, yd, dd)], fr, F.N)
            self.face([F.p(s, ys, dd), F.p(xa, ya, dd), F.p(xb, yb, dd)], g, F.N, [uv(s, ys), uv(xa, ya), uv(xb, yb)])
        self.quad_frame(F, s - 0.03, s + 0.03, y0 + fw, ys + rg, dd + 0.03, fr)
        self.quad_frame(F, s - rg, s + rg, ys - 0.04, ys + 0.04, dd + 0.03, fr)

    # ------------------------------------------------------------------ ornaments
    def sill(self, F, s, w, y, proj=0.12, h=0.14):
        self.box(F, s - w / 2 - 0.12, s + w / 2 + 0.12, y - h, y, 0, proj, "TS_GraniteWhite")

    def pediment(self, F, s, w, y, kind="tri"):
        """Window head: a small cornice and a triangular or segmental pediment above it."""
        st = "TS_GraniteWhite"
        hw = w / 2 + 0.28
        self.box(F, s - hw, s + hw, y, y + 0.2, 0, 0.16, st)
        y1 = y + 0.2
        if kind == "tri":
            rise = 0.45
            apex = (s, y1 + rise)
            self.face([F.p(s - hw, y1, 0.14), F.p(s + hw, y1, 0.14), F.p(*apex, 0.14)], st, F.N)
            self.face([F.p(s - hw, y1, 0.14), F.p(*apex, 0.14), F.p(*apex, 0), F.p(s - hw, y1, 0)], st, UP - F.U)
            self.face([F.p(s + hw, y1, 0.14), F.p(*apex, 0.14), F.p(*apex, 0), F.p(s + hw, y1, 0)], st, UP + F.U)
        else:  # segmental hood with a scrolled crest (photos: 2F windows of the wings)
            self.box(F, s - 0.18, s + 0.18, y1, y1 + 0.42, 0, 0.12, st)
            self.box(F, s - hw + 0.05, s + hw - 0.05, y1, y1 + 0.16, 0, 0.12, st)

    def lintel(self, F, s, w, y, h=0.22, proj=0.06):
        self.box(F, s - w / 2 - 0.18, s + w / 2 + 0.18, y, y + h, 0, proj, "TS_GraniteWhite")
        self.box(F, s - 0.16, s + 0.16, y - 0.05, y + h + 0.06, 0, proj + 0.04, "TS_GraniteWhite")

    def pilaster(self, F, s, y0, y1, w=0.7, proj=0.16, ionic=True):
        st = "TS_GraniteWhite"
        self.box(F, s - w / 2 - 0.08, s + w / 2 + 0.08, y0, y0 + 0.45, 0, proj + 0.06, st)
        self.box(F, s - w / 2, s + w / 2, y0 + 0.45, y1 - 0.5, 0, proj, st, skip=("back", "bottom"))
        if ionic:  # capital: echinus with the volutes as a wider block, abacus on top
            self.box(F, s - w / 2 - 0.12, s + w / 2 + 0.12, y1 - 0.5, y1 - 0.18, 0, proj + 0.1, st)
            self.box(F, s - w / 2 - 0.06, s + w / 2 + 0.06, y1 - 0.18, y1, 0, proj + 0.06, st)

    def cornice(self, F, s0, s1, y0=CORNICE[0], y1=CORNICE[1], proj=0.62, caps=True):
        """Copper-clad cornice with a granite architrave line under it (photos: brown cornice)."""
        h = y1 - y0
        prof = [(0.0, y0), (0.12, y0), (0.12, y0 + 0.2 * h), (proj * 0.7, y0 + 0.55 * h)]
        prof += [(proj, y0 + 0.7 * h), (proj, y1), (-0.6, y1)]  # top runs in to the roof's eave
        self.extrude(F, s0, s1, prof, "TS_CopperTrim", caps)

    def balustrade(self, F, s0, s1, posts=(), y0=BAL[0], y1=BAL[1], d=0.08, pitch=0.34):
        """Copper balustrade (高欄) on the cornice: plinth, turned balusters as 4-sided prisms, rail, posts."""
        cu = "TS_CopperTrim"
        self.box(F, s0, s1, y0, y0 + 0.2, d - 0.18, d + 0.12, cu, skip=("back", "bottom"))
        self.box(F, s0, s1, y1 - 0.15, y1, d - 0.18, d + 0.14, cu, skip=("back",))
        bottom, top = y0 + 0.2, y1 - 0.15
        pts = sorted(set(posts) | {s0, s1})
        for pa, pb in zip(pts, pts[1:], strict=False):
            n = max(1, int((pb - pa - 0.4) / pitch))
            for k in range(n):
                x = pa + 0.2 + (k + 0.5) * (pb - pa - 0.4) / n
                r = 0.075
                diamond = [(x - r, 0), (x, r), (x + r, 0), (x, -r)]
                for i in range(4):
                    (xa, da), (xb, db) = diamond[i], diamond[(i + 1) % 4]
                    nrm = F.U * (db - da) * -1 + F.N * (xb - xa)
                    self.face(
                        [F.p(xa, bottom, d + da), F.p(xb, bottom, d + db), F.p(xb, top, d + db), F.p(xa, top, d + da)],
                        cu,
                        nrm,
                    )
        for x in pts:
            self.box(F, x - 0.2, x + 0.2, bottom, top, d - 0.16, d + 0.16, cu, skip=("back", "top", "bottom"))

    def quoins(self, F, s, y0, y1, side, long=0.95, short=0.55, h=0.35):
        """Alternating granite corner blocks at s (side = +1: they run toward +s from the corner)."""
        out = []
        y = y0
        k = 0
        while y < y1 - 0.05:
            yb = min(y1, y + h)
            ln = long if k % 2 == 0 else short
            a, b = (s, s + ln) if side > 0 else (s - ln, s)
            out.append((a, b, y, yb, "TS_GraniteWhite"))
            y = yb + h
            k += 1
        return out

    def rustication(self, s0, s1, y0=PLINTH, y1=BAND1[0], brick=0.75, stone=0.18):
        """1F banding: brick alternating with granite bands (2023 photo: bands at 1.5, 2.45, 3.45, 4.35 m)."""
        out = []
        y = y0 + brick
        while y < y1 - 0.05:
            out.append((s0, s1, y, min(y1, y + stone), "TS_GraniteWhite"))
            y += brick + stone
        return out


def ccw(outline):
    """Make a plan outline counter-clockwise in (a, c)."""
    area = sum(a0 * c1 - a1 * c0 for (a0, c0), (a1, c1) in zip(outline, outline[1:] + outline[:1], strict=True))
    return list(outline) if area > 0 else list(reversed(outline))


def offset(poly, dist):
    """Offset a ccw plan polygon inward by dist (mitred corners)."""
    pts = ccw(poly)
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e0, e1 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n0, n1 = Vector((-e0.y, e0.x)), Vector((-e1.y, e1.x))  # inward normals of a ccw polygon
        bis = (n0 + n1).normalized()
        k = dist / max(0.2, bis.dot(n1))
        q = p1 + bis * k
        out.append((q.x, q.y))
    return out


def bay_centres(s0, s1, n, bay=BAY):
    m = (s1 - s0 - (n - 1) * bay) / 2
    return [s0 + m + k * bay for k in range(n)]


GR, BR, CT, CR, SL = "TS_GraniteWhite", "TS_BrickRed", "TS_CopperTrim", "TS_CopperRoof", "TS_SlateRoof"


def bands(s0, s1, upper=True, band2=True):
    out = [(s0, s1, 0.0, PLINTH, GR), (s0, s1, *BAND1, GR), (s0, s1, *SILL2, GR)]
    if band2:
        out.append((s0, s1, *BAND2, GR))
    if upper:
        out.append((s0, s1, *ARCHI, GR))
    return out


def arch1_hole(x):
    r_in, ring, ys = ARC1
    return (x - r_in - ring, x + r_in + ring, F1[0], ys + r_in + ring, None)


def arch1(ts, F, x):
    ts.arch_window(F, x, ARC1[0], ARC1[1], F1[0], ARC1[2])


# ============================================================================================== wings
def wing_west(ts, s0, s1, n, arcade=False, pilasters=True, top=True):
    """Wing between pavilions (west, 丸の内 side): 4.07 m bays; 1F banded (rustication) with tall windows
    under a granite hood (or round arches next to the centre), 2F windows with pediments, 3F windows,
    colossal granite pilasters with Ionic capitals through 2F–3F on pedestals, a granite frieze, the
    copper cornice and balustrade (2023 frontal photo: glass 1.55 m wide on 2F, 1.42 m on 3F)."""
    F = Frame(0.0, WEST, (1.0, 0.0), (0.0, -1.0))
    xs = bay_centres(s0, s1, n, 2.45 if arcade else BAY)
    w2, w3 = (1.2, 1.15) if arcade else (1.55, 1.42)
    feats = bands(s0, s1, band2=arcade) + ts.rustication(s0, s1)
    for x in xs:
        if arcade:
            feats.append(arch1_hole(x))
        else:
            feats += [(x - 0.95, x + 0.95, F1[0] - 0.1, F1[1] + 0.12, GR), (x - 0.72, x + 0.72, *F1, None)]
        feats += [
            (x - w2 / 2 - 0.36, x + w2 / 2 + 0.36, F2[0] - 0.1, F2[1] + 0.12, GR),
            (x - w2 / 2, x + w2 / 2, *F2, None),
        ]
        feats += [
            (x - w3 / 2 - 0.34, x + w3 / 2 + 0.34, F3[0] - 0.1, F3[1] + 0.12, GR),
            (x - w3 / 2, x + w3 / 2, *F3, None),
        ]
    ts.wall(F, s0, s1, 0.0, CORNICE[0], feats)
    for x in xs:
        if arcade:
            arch1(ts, F, x)
        else:
            ts.window(F, x, 1.44, *F1)
            ts.sill(F, x, 1.44, F1[0])
            ts.pediment(F, x, 1.44, F1[1] + 0.12, "tri")
        ts.window(F, x, w2, *F2)
        ts.sill(F, x, w2, F2[0])
        if arcade:
            ts.lintel(F, x, w2, F2[1] + 0.12)
        else:
            ts.pediment(F, x, w2, F2[1] + 0.12, "seg")
        ts.window(F, x, w3, *F3)
        ts.sill(F, x, w3, F3[0])
    posts = [x + (xs[1] - xs[0]) / 2 for x in xs[:-1]] if len(xs) > 1 else []
    if pilasters and not arcade:
        for x in posts:
            ts.box(F, x - 0.5, x + 0.5, BAND1[1], SILL2[0], 0, 0.1, GR)  # pedestal
            ts.pilaster(F, x, SILL2[1], ARCHI[0], w=0.8)
    if top:
        ts.cornice(F, s0, s1)
        ts.balustrade(F, s0, s1, posts)
    return xs


def wing_east(ts, s0, s1, n, c=EAST):
    """Track-side wing: same floor lines, simpler windows (seen across the tracks and from above)."""
    F = Frame(0.0, c, (1.0, 0.0), (0.0, 1.0))
    xs = bay_centres(s0, s1, n)
    feats = bands(s0, s1)
    for x in xs:
        for (y0, y1), w in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            feats += [(x - w / 2 - 0.16, x + w / 2 + 0.16, y0, y1 + 0.16, GR), (x - w / 2, x + w / 2, y0, y1, None)]
    ts.wall(F, s0, s1, 0.0, CORNICE[0], feats)
    for x in xs:
        for (y0, y1), w in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            ts.window(F, x, w, y0, y1, depth=0.22, bars=False)
            ts.sill(F, x, w, y0, proj=0.08, h=0.12)
    ts.cornice(F, s0, s1, proj=0.45)
    parapet(ts, F, s0, s1)


def parapet(ts, F, s0, s1, y0=CORNICE[1], y1=CORNICE[1] + 0.65):
    ts.box(F, s0, s1, y0, y1, -0.6, -0.25, BR, skip=("back", "bottom"))
    ts.box(F, s0 - 0.02, s1 + 0.02, y1, y1 + 0.1, -0.66, -0.19, CT, skip=("back",))


# ============================================================================================== pavilions
def side_walls(ts, ac, half, front, back_to=WEST, y1=CORNICE[0], upper=True):
    """The short side walls of a block projecting from the west façade (front c -> the wing face)."""
    for sgn in (-1, 1):
        F = Frame(ac + sgn * half, front, (0.0, 1.0), (sgn, 0.0))
        ln = back_to - front
        if ln <= 0.05:
            continue
        feats = bands(0, ln, upper) + ts.rustication(0, ln) + ts.quoins(F, 0.0, BAND1[1], y1, +1)
        ts.wall(F, 0.0, ln, 0.0, y1, feats)


def ring_cornice(ts, outline, y0, y1, proj, mat=CT):
    """A cornice around a ccw plan outline, one extrusion per side (corners overlap by the projection)."""
    pts = ccw(outline)
    for i in range(len(pts)):
        p0, p1 = pts[i], pts[(i + 1) % len(pts)]
        F, ln = Frame.between(p0, p1, +1)
        F = Frame(F.a, F.c, (F.ua, F.uc), (F.uc, -F.ua))  # outward of a ccw polygon
        h = y1 - y0
        prof = [(0.0, y0), (proj * 0.5, y0 + 0.3 * h), (proj, y0 + 0.6 * h), (proj, y1), (0.0, y1)]
        ts.extrude(F, -proj, ln + proj, prof, mat, caps=True)


def white_storey(ts, ac, cc, hx, hz, y0, y1, front_windows, side_windows, consoles=False, win=None):
    """Granite top storey of the towers and pavilions (photos: white with pilasters and small windows)."""
    wy0, wy1 = win or (y0 + 0.75, y1 - 0.9)
    outline = [(ac - hx, cc - hz), (ac + hx, cc - hz), (ac + hx, cc + hz), (ac - hx, cc + hz)]
    pts = ccw(outline)
    for i in range(4):
        p0, p1 = pts[i], pts[(i + 1) % 4]
        F0, ln = Frame.between(p0, p1, +1)
        F = Frame(F0.a, F0.c, (F0.ua, F0.uc), (F0.uc, -F0.ua))
        facing_front = F.nc < -0.5
        wins = front_windows if facing_front else (side_windows if abs(F.na) > 0.5 else [])
        feats = []
        for sx, w in wins:
            x = ln / 2 + sx
            feats.append((x - w / 2, x + w / 2, wy0, wy1, None))
        ts.wall(F, 0.0, ln, y0, y1, feats, base=GR)
        for sx, w in wins:
            x = ln / 2 + sx
            ts.window(F, x, w, wy0, wy1, depth=0.25)
        if facing_front:
            gaps = sorted({ln / 2 + sx for sx, _ in wins})
            for k in range(len(gaps) - 1):
                x = (gaps[k] + gaps[k + 1]) / 2
                ts.box(F, x - 0.2, x + 0.2, y0, y1 - 0.2, 0, 0.12, GR, skip=("back", "bottom"))
                if consoles:
                    ts.box(F, x - 0.24, x + 0.24, 17.6, 18.5, 0, 0.3, GR)
            for x in (0.25, ln - 0.25):
                ts.box(F, x - 0.25, x + 0.25, y0, y1 - 0.2, 0, 0.14, GR, skip=("back", "bottom"))
                if consoles:
                    ts.box(F, x - 0.28, x + 0.28, 17.6, 18.5, 0, 0.32, GR)


def hip_stack(ts, ac, cc, hx, hz, levels, mat=SL):
    """Four-sided roof through rectangles levels [(scale, y)], scale applied to (hx, hz)."""
    rings = [
        (
            [
                (ac - hx * k, cc - hz * k),
                (ac + hx * k, cc - hz * k),
                (ac + hx * k, cc + hz * k),
                (ac - hx * k, cc + hz * k),
            ],
            y,
        )
        for k, y in levels
    ]
    for (r0, y0), (r1, y1) in zip(rings, rings[1:], strict=False):
        for i in range(4):
            j = (i + 1) % 4
            mid = ((r0[i][0] + r0[j][0]) / 2 - ac, (r0[i][1] + r0[j][1]) / 2 - cc)
            out = mv(mid[0], mid[1]).normalized() + UP
            pts = [
                M(r0[i][0], y0, r0[i][1]),
                M(r0[j][0], y0, r0[j][1]),
                M(r1[j][0], y1, r1[j][1]),
                M(r1[i][0], y1, r1[i][1]),
            ]
            ts.face(pts, mat, out)
    last, yt = rings[-1]
    if levels[-1][0] > 1e-3:
        ts.face([M(a, yt, c) for a, c in last], mat, UP)


def pyramid_pavilion(ts, ac, front=-12.6, back=-4.2, half=PAV_HALF):
    """Pavilion with a baggage arch (荷物口), white top storey, bell-cast slate pyramid and copper lantern.
    North at +49.35 m, south at −45.35 m (PLATEAU LOD2 peaks; JR elevation: 7 bays north, 6 south)."""
    F = Frame(ac, front, (1.0, 0.0), (0.0, -1.0))
    feats = bands(-half, half, upper=False) + ts.rustication(-half, half)
    feats += ts.quoins(F, -half, BAND1[1], CORNICE[0], +1) + ts.quoins(F, half, BAND1[1], CORNICE[0], -1)
    feats.append((-2.35, 2.35, 0.0, 2.2 + 2.35, None))  # 2023 photo: arch crown 4.0 m inside, 4.6 m outside
    for x in (-2.05, 2.05):
        feats += [(x - 0.95, x + 0.95, F2[0] - 0.1, F2[1] + 0.12, GR), (x - 0.7, x + 0.7, *F2, None)]
        feats += [(x - 0.93, x + 0.93, F3[0] - 0.1, F3[1] + 0.12, GR), (x - 0.7, x + 0.7, *F3, None)]
    ts.wall(F, -half, half, 0.0, CORNICE[0], feats)
    ts.arch_window(F, 0.0, 1.8, 0.55, 0.0, 2.2, depth=0.55, glass="TS_Ironwork", frame=False)
    for x in (-2.05, 2.05):
        ts.window(F, x, 1.4, *F2)
        ts.sill(F, x, 1.4, F2[0])
        ts.pediment(F, x, 1.4, F2[1] + 0.12, "seg")
        ts.window(F, x, 1.4, *F3)
        ts.sill(F, x, 1.4, F3[0])
    side_walls(ts, ac, half, front, upper=False)
    cc = (front + back) / 2
    hz = (back - front) / 2
    # white granite top storey 16.3–20.3 m with three small windows at 18.3–19.4 m (2023 photo)
    white_storey(
        ts,
        ac,
        cc,
        half,
        hz,
        CORNICE[0],
        20.3,
        [(-2.3, 0.85), (0.0, 0.85), (2.3, 0.85)],
        [(0.0, 0.85)],
        win=(18.3, 19.4),
    )
    ring_cornice(
        ts, [(ac - half, cc - hz), (ac + half, cc - hz), (ac + half, cc + hz), (ac - half, cc + hz)], 20.3, 20.7, 0.45
    )
    # curved (segmental) parapet on the front above the cornice (photos: 2012 north, DSC09855)
    Fp = Frame(ac, front, (1.0, 0.0), (0.0, -1.0))
    seg = 8
    for k in range(seg):
        t0, t1 = math.pi * k / seg, math.pi * (k + 1) / seg
        x0, x1 = -3.2 * math.cos(t0), -3.2 * math.cos(t1)
        y0_, y1_ = 20.7 + 0.6 * math.sin(t0), 20.7 + 0.6 * math.sin(t1)
        ts.face([Fp.p(x0, 20.7, -0.05), Fp.p(x1, 20.7, -0.05), Fp.p(x1, y1_, -0.05), Fp.p(x0, y0_, -0.05)], GR, Fp.N)
        ts.face(
            [Fp.p(x0, y0_, -0.05), Fp.p(x1, y1_, -0.05), Fp.p(x1, y1_ + 0.12, 0.05), Fp.p(x0, y0_ + 0.12, 0.05)],
            CT,
            UP + Fp.N,
        )
    # flared slate pyramid to 23.6 m carrying a big copper lantern: an octagonal 'tent' 4.6 m wide at its
    # foot, a small cornice, a ribbed dome and the finial (2023 photo, corrected for the 4 m setback)
    hip_stack(ts, ac, cc, half + 0.45, hz + 0.45, [(1.0, 20.7), (0.9, 20.95), (0.76, 21.5), (0.62, 22.5), (0.5, 23.6)])
    ts.lathe(ac, cc, [(2.45, 23.6), (2.2, 24.1), (1.85, 25.3)], 8, CR, phase=math.pi / 8)
    ts.lathe(ac, cc, [(2.0, 25.3), (2.05, 25.45), (1.9, 25.6)], 8, CT, phase=math.pi / 8)
    ts.lathe(ac, cc, [(1.1, 25.6), (1.08, 25.9), (0.92, 26.4), (0.55, 26.85), (0.0, 27.0)], 8, CR, phase=math.pi / 8)
    ts.lathe(ac, cc, [(0.14, 26.95), (0.2, 27.1), (0.12, 27.3), (0.0, 27.35)], 6, CT)
    ts.spike(ac, cc, 27.3, 29.8, 0.06)


def lantern(ts, a, c, y0, r, tip):
    """Copper lantern: octagonal drum with small openings, a small dome and a finial spike."""
    ts.prism([(a + x, c + z) for x, z in _regular(8, r)], y0, y0 + 0.9, CR, top=CR)
    for k in range(0, 8, 2):
        t = 2 * math.pi * k / 8
        ap = r * math.cos(math.pi / 8) + 0.01
        F = Frame(a + ap * math.cos(t), c + ap * math.sin(t), (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
        ts.quad_frame(F, -0.15, 0.15, y0 + 0.2, y0 + 0.7, 0.0, "TS_Ironwork")
    ts.lathe(
        a,
        c,
        [(r * 1.2, y0 + 0.9), (r * 1.1, y0 + 1.05), (r * 0.85, y0 + 1.35), (r * 0.45, y0 + 1.6), (0.0, y0 + 1.7)],
        8,
        CR,
    )
    ts.lathe(a, c, [(0.14, y0 + 1.65), (0.2, y0 + 1.8), (0.14, y0 + 1.95), (0.0, y0 + 2.0)], 6, CT)
    ts.spike(a, c, y0 + 1.95, tip, 0.06)


def _regular(n, r, phase=None):
    phase = math.pi / n if phase is None else phase
    return [(r * math.cos(phase + 2 * math.pi * k / n), r * math.sin(phase + 2 * math.pi * k / n)) for k in range(n)]


def flank_tower(ts, ac, front=-11.8, back=-6.4, half=2.7):
    """Towers flanking the central pavilion (2023 photo, metre grid): quoined brick to 16.3 m with a tall
    1F opening, a pedimented 2F window and a taller 3F window (13.3–15.9 m); a white granite top with
    consoles at 17.6–18.5 m and three small windows at 19.4–20.6 m; flared copper cornice at 21.0 m, a
    ribbed copper dome to 23.2 m and the finial to 26.1 m."""
    F = Frame(ac, front, (1.0, 0.0), (0.0, -1.0))
    feats = bands(-half, half, upper=False, band2=False) + ts.rustication(-half, half)
    feats += ts.quoins(F, -half, BAND1[1], CORNICE[0], +1) + ts.quoins(F, half, BAND1[1], CORNICE[0], -1)
    wins = (((1.2, 5.1), 1.3), (F2, 1.3), ((13.3, 15.9), 1.25))
    for (y0, y1), w in wins:
        feats += [(-w / 2 - 0.22, w / 2 + 0.22, y0 - 0.15, y1 + 0.15, GR), (-w / 2, w / 2, y0, y1, None)]
    ts.wall(F, -half, half, 0.0, CORNICE[0], feats)
    for (y0, y1), w in wins:
        ts.window(F, 0.0, w, y0, y1)
        ts.sill(F, 0.0, w, y0)
    ts.pediment(F, 0.0, 1.3, F2[1] + 0.15, "tri")
    side_walls(ts, ac, half, front, upper=False)
    cc, hz = (front + back) / 2, (back - front) / 2
    white_storey(
        ts,
        ac,
        cc,
        half,
        hz,
        CORNICE[0],
        21.0,
        [(-1.3, 0.55), (0.0, 0.55), (1.3, 0.55)],
        [(0.0, 0.55)],
        consoles=True,
        win=(19.4, 20.6),
    )
    ring_cornice(
        ts, [(ac - half, cc - hz), (ac + half, cc - hz), (ac + half, cc + hz), (ac - half, cc + hz)], 21.0, 21.45, 0.6
    )
    ts.prism([(ac + x, cc + z) for x, z in _regular(8, 1.75)], 21.45, 21.7, CT, top=None)
    prof = [(1.65, 21.7), (1.62, 21.95), (1.5, 22.3), (1.25, 22.7), (0.85, 23.0), (0.35, 23.18), (0.0, 23.2)]
    ts.lathe(ac, cc, prof, 12, CR)
    ts.lathe(ac, cc, [(0.16, 23.15), (0.22, 23.35), (0.12, 23.55), (0.0, 23.6)], 6, CT)
    ts.spike(ac, cc, 23.55, 26.1, 0.06)


# ============================================================================================== centre
CEN_HALF = 12.9  # the central pavilion runs between the flanking towers
CEN_BAY = 5.6  # half-width of the central bay (granite-strip piers)
CEN_EAVE = 18.9  # underside of the central cornice (2023 photo: cornice 18.9–19.7 m, the wings' 16.3–17.0 m)


def central_pavilion(ts):
    """皇室用中央口: 3 side bays each side with arched 1F windows, the central bay with its tall recessed
    arch (inner crown 17.0 m), the arched copper-framed gable with an oculus and crown ornament, the
    hipped slate roof (≈47°) with a flat top and cresting (glazed at the back, JR: 線路側の中央部の屋根は
    ガラス化), and the granite porte-cochère (御車寄せ). Dimensions from the 2023 frontal photo."""
    F = Frame(0.0, WEST, (1.0, 0.0), (0.0, -1.0))
    for sgn in (-1, 1):
        s0, s1 = sorted((sgn * CEN_BAY, sgn * CEN_HALF))
        wing_west(ts, s0, s1, 3, arcade=True, top=False)
    # central bay: piers + recess
    r_in, ring, ys = 2.3, 0.45, 14.7
    feats = bands(-CEN_BAY, CEN_BAY, upper=False, band2=False)
    feats += ts.rustication(-CEN_BAY, CEN_BAY)
    feats.append((-r_in - ring, r_in + ring, BAND1[1], ys + r_in + ring, None))
    feats.append((-3.4, 3.4, 0.0, 4.8, None))  # the entrance behind the porte-cochère
    for sgn in (-1, 1):
        feats.append(tuple(sorted((sgn * 3.75, sgn * 4.85))) + (11.9, CORNICE[0], GR))
    ts.wall(F, -CEN_BAY, CEN_BAY, 0.0, CORNICE[0], feats)
    # arch ring and spandrels of the recess
    seg = 12
    top = ys + r_in + ring
    for k in range(seg):
        t0, t1 = math.pi * k / seg, math.pi * (k + 1) / seg
        a0, a1 = (-r_in * math.cos(t0), ys + r_in * math.sin(t0)), (-r_in * math.cos(t1), ys + r_in * math.sin(t1))
        b0 = (-(r_in + ring) * math.cos(t0), ys + (r_in + ring) * math.sin(t0))
        b1 = (-(r_in + ring) * math.cos(t1), ys + (r_in + ring) * math.sin(t1))
        ts.face([F.p(*a0), F.p(*a1), F.p(*b1), F.p(*b0)], GR, F.N)
        ts.face([F.p(*b0), F.p(*b1), F.p(b1[0], top), F.p(b0[0], top)], BR, F.N)
        tm = (t0 + t1) / 2
        ts.face([F.p(*a0, 0), F.p(*a1, 0), F.p(*a1, -1.2), F.p(*a0, -1.2)], GR, F.U * math.cos(tm) - UP * math.sin(tm))
    ts.box(F, -0.35, 0.35, ys + r_in - 0.1, top + 0.15, 0, 0.12, GR)
    for sgn in (-1, 1):
        x0, x1 = sorted((sgn * r_in, sgn * (r_in + ring)))
        jamb = ts.quoins(F, sgn * (r_in + ring), BAND1[1], ys, -sgn, long=0.45, short=0.45, h=0.3)
        ts.wall(F, x0, x1, BAND1[1], ys, jamb)  # brick jambs with granite blocks (photo)
        ts.face(
            [
                F.p(sgn * r_in, BAND1[1], 0),
                F.p(sgn * r_in, BAND1[1], -1.2),
                F.p(sgn * r_in, ys, -1.2),
                F.p(sgn * r_in, ys, 0),
            ],
            BR,
            -F.U * sgn,
        )
        # pendant ends of the granite strips (shield-like bottoms in the photos)
        xa, xb = sorted((sgn * 3.75, sgn * 4.85))
        ts.box(F, xa + 0.1, xb - 0.1, 11.5, 11.9, 0, 0.1, GR)
        ts.box(F, xa, xb, 11.9, CEN_EAVE, 0, 0.08, GR, skip=("back", "bottom"))
        # urn on the pylon above the cornice (dark copper)
        ua, uc = sgn * 4.3, WEST - 0.25
        ts.lathe(
            ua, uc, [(0.45, CEN_EAVE + 0.8), (0.5, 20.1), (0.32, 20.5), (0.42, 20.9), (0.2, 21.2), (0.0, 21.3)], 8, CT
        )
    ts.face(
        [F.p(-r_in, BAND1[1], 0), F.p(r_in, BAND1[1], 0), F.p(r_in, BAND1[1], -1.2), F.p(-r_in, BAND1[1], -1.2)], GR, UP
    )
    # back wall of the recess with the 2F and 3F windows
    Fb = Frame(0.0, WEST + 1.2, (1.0, 0.0), (0.0, -1.0))
    bfe = [(-1.15, 1.15, 7.8, 10.6, GR), (-1.1, 1.1, 12.7, 15.3, GR), (-r_in, r_in, 11.9, 12.2, GR)]
    bfe += [(-0.95, 0.95, 7.9, 10.4, None), (-0.9, 0.9, 12.9, 15.1, None)]
    ts.wall(Fb, -r_in, r_in, BAND1[1], ys + r_in, bfe)
    ts.window(Fb, 0.0, 1.9, 7.9, 10.4)
    ts.pediment(Fb, 0.0, 1.9, 10.6, "seg")
    ts.window(Fb, 0.0, 1.8, 12.9, 15.1)
    ts.box(Fb, -1.4, 1.4, 7.15, 7.4, 0, 0.45, GR)  # balcony slab
    railing(ts, Fb, -1.35, 1.35, 7.4, 0.42)
    # entrance doors (dark) behind the porte-cochère
    Fd = Frame(0.0, WEST + 0.45, (1.0, 0.0), (0.0, -1.0))
    ts.quad_frame(Fd, -3.4, 3.4, 0.0, 4.8, 0.0, "TS_Ironwork")
    for sgn in (-1, 1):
        ts.face(
            [F.p(sgn * 3.4, 0, 0), F.p(sgn * 3.4, 0, -0.45), F.p(sgn * 3.4, 4.8, -0.45), F.p(sgn * 3.4, 4.8, 0)],
            GR,
            -F.U * sgn,
        )
    ts.face([F.p(-3.4, 4.8, 0), F.p(3.4, 4.8, 0), F.p(3.4, 4.8, -0.45), F.p(-3.4, 4.8, -0.45)], GR, -UP)
    # attic between the wings' cornice line and the higher central cornice: brick with two granite bands
    attic = [(-CEN_HALF, CEN_HALF, CORNICE[0], CORNICE[0] + 0.2, GR), (-CEN_HALF, CEN_HALF, 17.0, 17.4, GR)]
    ts.wall(F, -CEN_HALF, -CEN_BAY, CORNICE[0], CEN_EAVE, attic)
    ts.wall(F, CEN_BAY, CEN_HALF, CORNICE[0], CEN_EAVE, attic)
    mid = [f for f in attic] + [(-r_in - ring, r_in + ring, CORNICE[0], top, None)]
    for sgn in (-1, 1):
        mid.append(tuple(sorted((sgn * 3.75, sgn * 4.85))) + (CORNICE[0], CEN_EAVE, None))
    ts.wall(F, -CEN_BAY, CEN_BAY, CORNICE[0], CEN_EAVE, mid)
    ts.cornice(F, -CEN_HALF, -3.4, CEN_EAVE, CEN_EAVE + 0.8, proj=0.75)
    ts.cornice(F, 3.4, CEN_HALF, CEN_EAVE, CEN_EAVE + 0.8, proj=0.75)
    arched_gable(ts, F)
    central_roof(ts)
    porte_cochere(ts)


def railing(ts, F, s0, s1, y, d, h=0.95):
    """Wrought-iron balcony railing: rails and bars as thin boxes (TS_Ironwork)."""
    ir = "TS_Ironwork"
    ts.box(F, s0, s1, y + h - 0.05, y + h, d - 0.04, d, ir, skip=("back",))
    ts.box(F, s0, s1, y + 0.08, y + 0.12, d - 0.03, d, ir, skip=("back",))
    n = max(2, int((s1 - s0) / 0.18))
    for k in range(n + 1):
        x = s0 + (s1 - s0) * k / n
        ts.box(F, x - 0.012, x + 0.012, y, y + h - 0.05, d - 0.03, d - 0.01, ir, skip=("back", "top", "bottom"))


def arched_gable(ts, F):
    """Central gable: brick tympanum framed by a copper-clad semicircular arch, granite voussoirs
    radiating round an oculus, crown ornament on top (2023 photo: arch 6.8 m wide, crown 23.3 m)."""
    r, yc, thick = 3.4, 19.9, 0.8
    seg = 12
    base = CEN_EAVE  # the tympanum drops through the cornice (photo)
    pts = [(r, base)] + [
        (r * math.cos(math.pi * k / seg), yc + r * math.sin(math.pi * k / seg)) for k in range(seg + 1)
    ]
    pts += [(-r, base)]
    ts.face([F.p(x, y, 0.02) for x, y in pts], BR, F.N)
    ts.face([F.p(x, y, -thick) for x, y in pts], BR, -F.N)
    for (xa, ya), (xb, yb) in zip(pts, pts[1:], strict=False):
        nrm = F.U * (yb - ya) * -1 + UP * (xb - xa)
        ts.face([F.p(xa, ya, 0.02), F.p(xb, yb, 0.02), F.p(xb, yb, -thick), F.p(xa, ya, -thick)], CT, -nrm)
    # copper frame on the arch
    for k in range(seg):
        t0, t1 = math.pi * k / seg, math.pi * (k + 1) / seg
        q = [(r * math.cos(t0), yc + r * math.sin(t0)), (r * math.cos(t1), yc + r * math.sin(t1))]
        q += [
            ((r - 0.45) * math.cos(t1), yc + (r - 0.45) * math.sin(t1)),
            ((r - 0.45) * math.cos(t0), yc + (r - 0.45) * math.sin(t0)),
        ]
        ts.face([F.p(x, y, 0.22) for x, y in q], CT, F.N)
        tm = (t0 + t1) / 2
        rim = [
            F.p(q[0][0], q[0][1], 0.02),
            F.p(q[1][0], q[1][1], 0.02),
            F.p(q[1][0], q[1][1], 0.22),
            F.p(q[0][0], q[0][1], 0.22),
        ]
        ts.face(rim, CT, F.U * math.cos(tm) + UP * math.sin(tm))
    for sgn in (-1, 1):
        ts.box(F, *sorted((sgn * (r - 0.45), sgn * r)), base, yc, 0.02, 0.22, CT)
    # voussoirs: alternate granite blocks under the copper arch, short radial blocks round the oculus
    oc = 0.9
    vs = 12
    for k in range(0, vs, 2):
        t0, t1 = math.pi * k / vs, math.pi * (k + 1) / vs
        q = [
            ((r - 0.45) * math.cos(t0), yc + (r - 0.45) * math.sin(t0)),
            ((r - 0.45) * math.cos(t1), yc + (r - 0.45) * math.sin(t1)),
        ]
        q += [
            ((r - 1.15) * math.cos(t1), yc + (r - 1.15) * math.sin(t1)),
            ((r - 1.15) * math.cos(t0), yc + (r - 1.15) * math.sin(t0)),
        ]
        ts.face([F.p(x, y, 0.06) for x, y in q], GR, F.N)
    for k in range(8):
        t = 2 * math.pi * k / 8 + math.pi / 8
        c0, s0 = math.cos(t), math.sin(t)
        p0 = (oc * 1.3 * c0, yc + 0.25 + oc * 1.3 * s0)
        p1 = (oc * 1.95 * c0, yc + 0.25 + oc * 1.95 * s0)
        w = 0.16
        q = [
            (p0[0] - w * s0, p0[1] + w * c0),
            (p0[0] + w * s0, p0[1] - w * c0),
            (p1[0] + w * s0, p1[1] - w * c0),
            (p1[0] - w * s0, p1[1] + w * c0),
        ]
        if p1[1] > CEN_EAVE + 1.0:
            ts.face([F.p(x, y, 0.06) for x, y in q], GR, F.N)
    ring = [(oc * math.cos(2 * math.pi * k / 16), yc + 0.25 + oc * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    outer = [
        (1.35 * oc * math.cos(2 * math.pi * k / 16), yc + 0.25 + 1.35 * oc * math.sin(2 * math.pi * k / 16))
        for k in range(16)
    ]
    for k in range(16):
        j = (k + 1) % 16
        ts.face([F.p(*ring[k], 0.08), F.p(*ring[j], 0.08), F.p(*outer[j], 0.08), F.p(*outer[k], 0.08)], GR, F.N)
    ts.face(
        [F.p(x, y, -0.15) for x, y in ring],
        ts.glass_mat(),
        F.N,
        [((x + oc) / (2 * oc), (y - yc - 0.35 + oc) / (2 * oc)) for x, y in ring],
    )
    ts.box(F, -0.05, 0.05, yc + 0.25 - oc, yc + 0.25 + oc, -0.15, -0.1, "TS_Ironwork")
    ts.box(F, -oc, oc, yc + 0.3, yc + 0.4, -0.15, -0.1, "TS_Ironwork")
    # crown ornament (copper)
    a0, c0 = 0.0, WEST - 0.1
    ts.lathe(
        a0,
        c0,
        [
            (0.55, yc + r),
            (0.6, yc + r + 0.25),
            (0.4, yc + r + 0.5),
            (0.5, yc + r + 0.85),
            (0.3, yc + r + 1.25),
            (0.0, yc + r + 1.45),
        ],
        8,
        CT,
    )


def central_roof(ts):
    """Hipped slate roof from the cornice (19.7 m) at ≈47° to a flat top at 27.3 m with the cresting to
    28.4 m (PLATEAU LOD2 maximum), glazed in the middle of its back slope; two dormers and two spikes."""
    ye, yt = CEN_EAVE + 0.8, 27.3
    fe, be, he = WEST + 0.6, EAST - 0.4, CEN_HALF - 0.2  # eave lines
    ft, bt, ht = -3.0, 1.5, 4.0  # flat top

    def P(a, c, y):
        return M(a, y, c)

    ts.face([P(-he, fe, ye), P(he, fe, ye), P(ht, ft, yt), P(-ht, ft, yt)], SL, mv(0, -1) + UP)
    ts.face([P(he, fe, ye), P(he, be, ye), P(ht, bt, yt), P(ht, ft, yt)], SL, mv(1, 0) + UP)
    ts.face([P(-he, be, ye), P(-he, fe, ye), P(-ht, ft, yt), P(-ht, bt, yt)], SL, mv(-1, 0) + UP)
    back = mv(0, 1) + UP
    ts.face([P(he, be, ye), P(ht, be, ye), P(ht, bt, yt)], SL, back)
    ts.face([P(-ht, be, ye), P(-he, be, ye), P(-ht, bt, yt)], SL, back)
    ts.face([P(ht, be, ye), P(-ht, be, ye), P(-ht, bt, yt), P(ht, bt, yt)], "TS_RoofGlass", back)
    ts.face([P(-ht, ft, yt), P(ht, ft, yt), P(ht, bt, yt), P(-ht, bt, yt)], CR, UP)
    T = [(-ht, ft), (ht, ft), (ht, bt), (-ht, bt)]
    # cresting on the flat top: posts and rails (photos: dark copper band with arched openings)
    for p0, p1 in ((T[0], T[1]), (T[3], T[0]), (T[1], T[2])):
        Fc, ln = Frame.between(p0, p1, +1)
        ts.box(Fc, 0.0, ln, yt, yt + 0.25, -0.1, 0.1, CT, skip=("back", "bottom"))
        ts.box(Fc, 0.0, ln, yt + 0.85, yt + 1.1, -0.12, 0.12, CT, skip=("back",))
        n = max(2, int(ln / 0.6))
        for i in range(n + 1):
            x = ln * i / n
            ts.box(Fc, x - 0.09, x + 0.09, yt + 0.25, yt + 0.85, -0.08, 0.08, CT, skip=("top", "bottom"))
    for sgn in (-1, 1):
        ts.spike(sgn * ht, ft, yt + 1.1, 30.8, 0.07)
        dormer(ts, Frame(sgn * 3.8, -7.3, (1.0, 0.0), (0.0, -1.0)), 0.0, 22.6, big=True, back=3.0, scale=1.3)
    # copper vault behind the arched gable, running back into the roof
    r, yc = 3.4, 19.9
    seg = 12
    for k in range(seg):
        t0, t1 = math.pi * k / seg, math.pi * (k + 1) / seg
        q = [
            M(r * math.cos(t0), yc + r * math.sin(t0), WEST + 0.8),
            M(r * math.cos(t1), yc + r * math.sin(t1), WEST + 0.8),
        ]
        q += [
            M(r * math.cos(t1), yc + r * math.sin(t1), WEST + 4.6),
            M(r * math.cos(t0), yc + r * math.sin(t0), WEST + 4.6),
        ]
        tm = (t0 + t1) / 2
        ts.face(q, CR, Vector((-math.cos(tm), math.sin(tm), 0.0)), smooth=True)  # model x = -a


def porte_cochere(ts):
    """御車寄せ: granite portico in front of the central entrance, two columns between corner piers, a
    low pediment and two small stone domes on the front corners (photo 2023: about 8.4 m wide)."""
    hw, c0, c1 = 4.2, WEST, WEST - 7.4
    Fl = Frame(0.0, c1, (1.0, 0.0), (0.0, -1.0))
    ts.box(
        Frame(0.0, WEST, (1.0, 0.0), (0.0, -1.0)),
        -hw - 0.6,
        hw + 0.6,
        0.0,
        0.35,
        0.0,
        7.4 + 1.2,
        GR,
        skip=("back", "bottom"),
    )
    for sgn in (-1, 1):
        for cc in (c1 + 0.55, c0 - 0.55):
            Fp = Frame(sgn * (hw - 0.55), cc, (1.0, 0.0), (0.0, -1.0))
            ts.box(Fp, -0.5, 0.5, 0.35, 5.1, -0.5, 0.5, GR, skip=("bottom",))
        ts.lathe(
            sgn * 1.45,
            c1 + 0.45,
            [(0.38, 0.35), (0.38, 0.6), (0.3, 0.7), (0.28, 4.7), (0.4, 4.85), (0.42, 5.1)],
            10,
            GR,
            cap=False,
        )
    # entablature, parapet, pediment
    outline = [(-hw, c1), (hw, c1), (hw, c0), (-hw, c0)]
    ts.prism(outline, 5.1, 6.0, GR, top=None, bottom=GR)
    ring_cornice(ts, outline, 5.85, 6.25, 0.28, mat=GR)
    ts.prism(offset(outline, 0.1), 6.25, 6.85, GR, top=GR)
    ts.face([Fl.p(-2.6, 6.85, 0.1), Fl.p(2.6, 6.85, 0.1), Fl.p(0.0, 7.55, 0.1)], GR, Fl.N)
    ts.face([Fl.p(-2.6, 6.85, 0.1), Fl.p(0.0, 7.55, 0.1), Fl.p(0.0, 7.55, -1.0), Fl.p(-2.6, 6.85, -1.0)], GR, UP - Fl.U)
    ts.face([Fl.p(2.6, 6.85, 0.1), Fl.p(0.0, 7.55, 0.1), Fl.p(0.0, 7.55, -1.0), Fl.p(2.6, 6.85, -1.0)], GR, UP + Fl.U)
    for sgn in (-1, 1):
        a, c = sgn * (hw - 0.55), c1 + 0.55
        ts.prism([(a + x, c + z) for x, z in _regular(10, 0.62)], 6.85, 7.2, GR, top=None)
        ts.lathe(a, c, [(0.66, 7.2), (0.62, 7.5), (0.5, 7.85), (0.3, 8.05), (0.0, 8.12)], 10, GR)
        ts.lathe(a, c, [(0.1, 8.1), (0.14, 8.25), (0.0, 8.35)], 6, GR)


def dormer(ts, F, s, base, big=True, back=2.5, scale=1.0):
    """Roof dormer facing out of frame F at s: copper cheeks and front, a window, and a gabled (big) or
    segmental (small, 'eyebrow') copper roof running back into the main roof (photos: B s s s B rhythm)."""
    if big:
        hw, h, wy0, wy1 = 0.8 * scale, 2.0 * scale, base + 0.45 * scale, base + 1.6 * scale
    else:
        hw, h, wy0, wy1 = 0.6, 0.95, base + 0.2, base + 0.75
    ts.wall(F, s - hw, s + hw, base, base + h, [(s - hw * 0.55, s + hw * 0.55, wy0, wy1, None)], base=CT)
    ts.window(F, s, hw * 1.1, wy0, wy1, depth=0.12, bars=big, glass="TS_Glass", reveal=CT)
    for sx, nrm in ((s - hw, -F.U), (s + hw, F.U)):
        ts.face([F.p(sx, base, 0), F.p(sx, base, -back), F.p(sx, base + h, -back), F.p(sx, base + h, 0)], CT, nrm)
    yt = base + h
    if big:  # gable: pediment front and two slopes
        apex = yt + 0.65 * scale
        ts.face([F.p(s - hw - 0.12, yt, 0.12), F.p(s + hw + 0.12, yt, 0.12), F.p(s, apex, 0.12)], CT, F.N)
        for sx, sn in ((s - hw - 0.12, -1), (s + hw + 0.12, 1)):
            q = [F.p(sx, yt, 0.12), F.p(s, apex, 0.12), F.p(s, apex, -back), F.p(sx, yt, -back)]
            ts.face(q, CR, UP + F.U * sn)
    else:  # segmental hood
        k = 4
        prev = None
        for i in range(k + 1):
            t = math.pi * i / k
            x = s - (hw + 0.1) * math.cos(t)
            y = yt + 0.35 * math.sin(t)
            if prev:
                q = [F.p(prev[0], prev[1], 0.12), F.p(x, y, 0.12), F.p(x, y, -back), F.p(prev[0], prev[1], -back)]
                tm = math.pi * (i - 0.5) / k
                ts.face(q, CR, UP * math.sin(tm) - F.U * math.cos(tm))
            prev = (x, y)
        pts = [
            F.p(s - (hw + 0.1) * math.cos(math.pi * i / k), yt + 0.35 * math.sin(math.pi * i / k), 0.12)
            for i in range(k + 1)
        ]
        ts.face(pts, CT, F.N)


# ============================================================================================== domes
def hall_outline(a0):
    """Plan outline of a dome hall (PLATEAU LOD2): half-octagon to the plaza, rectangle to the tracks."""
    w = [(a0 + 22.5, WEST), (a0 + 10.0, -23.7), (a0 - 10.0, -23.7), (a0 - 22.5, WEST)]
    e = [(a0 - 22.5, EAST), (a0 - 15.6, EAST), (a0 - 11.0, 15.3), (a0 - 11.0, 19.3)]
    e += [(a0 + 11.0, 19.3), (a0 + 11.0, 15.3), (a0 + 15.6, EAST), (a0 + 22.5, EAST)]
    return w + e


def triple_arch(ts, F, s, y0, ys, balcony=True):
    """Three round-arched windows with paired granite columns between (2F/3F of the dome halls)."""
    for x in (-1.75, 0.0, 1.75):
        ts.arch_window(F, s + x, 0.62, 0.18, y0, ys, key=True)
    for x in (-0.875, 0.875):
        for dx in (-0.12, 0.12):
            ts.lathe(*_frame_ac(F, s + x + dx, 0.16), [(0.12, y0), (0.11, ys - 0.15), (0.16, ys)], 8, GR, cap=False)
    if balcony:
        ts.box(F, s - 2.8, s + 2.8, y0 - 0.25, y0, 0.0, 0.55, GR)
        railing(ts, F, s - 2.75, s + 2.75, y0, 0.5)


def _frame_ac(F, s, d):
    return F.a + s * F.ua + d * F.na, F.c + s * F.uc + d * F.nc


def hall_face(ts, F, ln, front=False):
    """One plaza-side face of a dome hall: single windows either side of a triple arch on 2F and 3F,
    banded 1F with three openings (doors on the front face), quoins at the corners."""
    mid = ln / 2
    feats = bands(0, ln) + ts.rustication(0, ln)
    feats += ts.quoins(F, 0.0, BAND1[1], CORNICE[0], +1) + ts.quoins(F, ln, BAND1[1], CORNICE[0], -1)
    singles = (mid - 5.6, mid + 5.6)
    for x in singles:
        feats += [(x - 1.0, x + 1.0, F2[0] - 0.1, F2[1] + 0.12, GR), (x - 0.75, x + 0.75, *F2, None)]
        feats += [(x - 0.98, x + 0.98, F3[0] - 0.1, F3[1] + 0.12, GR), (x - 0.75, x + 0.75, *F3, None)]
    feats.append((mid - 2.6, mid + 2.6, F2[0], 10.0 + 0.8, None))
    feats.append((mid - 2.6, mid + 2.6, F3[0] - 0.2, 14.3 + 0.8, None))
    ones = (mid - 4.2, mid, mid + 4.2) if front else (mid - 3.5, mid + 3.5)
    for x in ones:
        feats.append((x - 1.25, x + 1.25, 0.0, 3.9, None) if front else arch1_hole(x))
    if front:  # the attic under the vault's arch
        feats.append((mid - 4.9, mid + 4.9, ARCHI[1], CORNICE[0], BR))
    ts.wall(F, 0.0, ln, 0.0, CORNICE[0], feats)
    for x in singles:
        ts.window(F, x, 1.5, *F2)
        ts.sill(F, x, 1.5, F2[0])
        ts.pediment(F, x, 1.5, F2[1] + 0.12, "tri")
        ts.window(F, x, 1.5, *F3)
        ts.sill(F, x, 1.5, F3[0])
    triple_arch(ts, F, mid, F2[0], 10.0)
    triple_arch(ts, F, mid, F3[0] - 0.2, 14.3)
    for x in ones:
        if front:
            ts.window(F, x, 2.5, 0.0, 3.9, depth=0.4, glass="TS_GlassLit")
        else:
            arch1(ts, F, x)


def dome_pavilion(ts, a0):
    w = hall_outline(a0)[:4]
    faces = []
    for i in range(3):
        F, ln = Frame.between(w[i], w[i + 1], -1)
        faces.append((F, ln))
        hall_face(ts, F, ln, front=(i == 1))
    # cornice + balustrade (not across the vault's arch on the front face)
    for i, (F, ln) in enumerate(faces):
        if i == 1:
            ts.cornice(F, -0.5, ln / 2 - 4.85)
            ts.cornice(F, ln / 2 + 4.85, ln + 0.5)
        else:
            ts.cornice(F, -0.5, ln + 0.5)
        if i == 1:
            ts.balustrade(F, 0.0, ln / 2 - 5.0, [])
            ts.balustrade(F, ln / 2 + 5.0, ln, [])
        else:
            ts.balustrade(F, 0.0, ln, [ln / 2])
    # white granite turrets at the front corners (corbelled from the 2F floor, copper caps)
    for ta in (a0 + 10.0, a0 - 10.0):
        tc = -23.7
        prof = [(0.15, 5.2), (0.7, 5.45), (1.05, 5.85), (1.25, 6.4), (1.25, 18.6), (1.42, 18.8)]
        ts.lathe(ta, tc, prof, 12, GR, cap=False)
        ts.lathe(
            ta, tc, [(1.42, 18.8), (1.36, 19.15), (1.15, 19.6), (0.75, 19.95), (0.25, 20.12), (0.0, 20.15)], 12, CR
        )
        ts.lathe(ta, tc, [(0.12, 20.1), (0.18, 20.25), (0.1, 20.45), (0.0, 20.5)], 6, CT)
        ts.spike(ta, tc, 20.45, 22.0, 0.05)
    vault_and_clock(ts, a0)
    # back (track side) projection
    e = hall_outline(a0)[4:]
    for i in range(1, len(e) - 2):
        F, ln = Frame.between(e[i], e[i + 1], -1)
        rear_face(ts, F, ln)
    hall_roof(ts, a0)
    drum_and_dome(ts, a0)


def rear_face(ts, F, ln):
    xs = bay_centres(0.0, ln, max(1, int(ln / BAY)))
    feats = bands(0, ln) + ts.quoins(F, 0.0, BAND1[1], CORNICE[0], +1) + ts.quoins(F, ln, BAND1[1], CORNICE[0], -1)
    for x in xs:
        for (y0, y1), w_ in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            feats += [(x - w_ / 2 - 0.16, x + w_ / 2 + 0.16, y0, y1 + 0.16, GR), (x - w_ / 2, x + w_ / 2, y0, y1, None)]
    ts.wall(F, 0.0, ln, 0.0, CORNICE[0], feats)
    for x in xs:
        for (y0, y1), w_ in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            ts.window(F, x, w_, y0, y1, depth=0.22, bars=False)
    ts.cornice(F, -0.45, ln + 0.45, proj=0.45)
    parapet(ts, F, 0.0, ln)


def vault_and_clock(ts, a0):
    """Copper barrel vault from the drum to the front, ending in a semicircular copper arch frame round
    a brick tympanum with granite voussoirs and the clock (JR elevation: crown ≈22.2 m)."""
    r, ys = 4.3, 18.0  # JR elevation: outer crown ≈22.7 m, clock at ≈18.5 m
    c_front, c_back = -23.7, -11.2
    seg = 12
    F = Frame(a0, c_front, (-1.0, 0.0), (0.0, -1.0))  # s = a0 - a (mirrored doesn't matter: symmetric)
    # vault surface: u along the axis, v around the arc (standing seams run over the curve)
    tu, tv = TILE[CR]
    for k in range(seg):
        t0, t1 = math.pi * k / seg, math.pi * (k + 1) / seg
        pts, uvs = [], []
        for t, cc in ((t0, c_back), (t1, c_back), (t1, c_front - 0.2), (t0, c_front - 0.2)):
            pts.append(M(a0 - (r + 0.12) * math.cos(t), ys + (r + 0.12) * math.sin(t), cc))
            uvs.append(((cc - c_front) / tu, (r * t) / tv))
        tm = (t0 + t1) / 2
        ts.face(pts, CR, Vector((math.cos(tm), math.sin(tm), 0.0)), uvs, smooth=True)
    # arch frame (copper) and its legs down to the cornice
    for k in range(seg):
        t0, t1 = math.pi * k / seg, math.pi * (k + 1) / seg
        q = [(r * math.cos(t0), ys + r * math.sin(t0)), (r * math.cos(t1), ys + r * math.sin(t1))]
        q += [
            ((r + 0.55) * math.cos(t1), ys + (r + 0.55) * math.sin(t1)),
            ((r + 0.55) * math.cos(t0), ys + (r + 0.55) * math.sin(t0)),
        ]
        ts.face([F.p(x, y, 0.35) for x, y in q], CT, F.N)
        tm = (t0 + t1) / 2
        ts.face(
            [
                F.p(q[3][0], q[3][1], -0.2),
                F.p(q[2][0], q[2][1], -0.2),
                F.p(q[2][0], q[2][1], 0.35),
                F.p(q[3][0], q[3][1], 0.35),
            ],
            CT,
            F.U * math.cos(tm) + UP * math.sin(tm),
        )
        ts.face(
            [
                F.p(q[0][0], q[0][1], 0.0),
                F.p(q[1][0], q[1][1], 0.0),
                F.p(q[1][0], q[1][1], 0.35),
                F.p(q[0][0], q[0][1], 0.35),
            ],
            CT,
            -(F.U * math.cos(tm) + UP * math.sin(tm)),
        )
    for sgn in (-1, 1):
        x0, x1 = sorted((sgn * r, sgn * (r + 0.55)))
        ts.box(F, x0, x1, CORNICE[0], ys, 0.0, 0.35, CT)
    # tympanum: brick fan with granite radial blocks and the clock
    base = CORNICE[0]
    pts = [(r, base), (r, ys)] + [
        (r * math.cos(math.pi * k / seg), ys + r * math.sin(math.pi * k / seg)) for k in range(1, seg)
    ]
    pts += [(-r, ys), (-r, base)]
    ts.face([F.p(x, y, 0.0) for x, y in pts], BR, F.N)
    yc, rc = 18.55, 1.0
    vs = 14
    for k in range(0, vs, 2):  # alternate granite voussoirs along the intrados (Takuro 2013 photo)
        t0, t1 = math.pi * k / vs, math.pi * (k + 1) / vs
        q = [(r * math.cos(t0), ys + r * math.sin(t0)), (r * math.cos(t1), ys + r * math.sin(t1))]
        q += [
            ((r - 0.75) * math.cos(t1), ys + (r - 0.75) * math.sin(t1)),
            ((r - 0.75) * math.cos(t0), ys + (r - 0.75) * math.sin(t0)),
        ]
        ts.face([F.p(x, y, 0.04) for x, y in q], GR, F.N)
    for k in range(10):
        t = math.pi * (-20 + 220 * k / 9) / 180
        c0, s0 = math.cos(t), math.sin(t)
        p0, p1 = (1.3 * c0, yc + 1.3 * s0), (2.05 * c0, yc + 2.05 * s0)
        w_ = 0.17
        q = [
            (p0[0] - w_ * s0, p0[1] + w_ * c0),
            (p0[0] + w_ * s0, p0[1] - w_ * c0),
            (p1[0] + w_ * s0, p1[1] - w_ * c0),
            (p1[0] - w_ * s0, p1[1] + w_ * c0),
        ]
        ts.face([F.p(x, y, 0.05) for x, y in q], GR, F.N)
    clock(ts, F, 0.0, yc, rc)


def clock(ts, F, s, yc, r):
    """Clock dial (ClockFace, UV 0–1 over the disc) in a copper rim."""
    n = 20
    rim = [
        (s + r * 1.18 * math.cos(2 * math.pi * k / n), yc + r * 1.18 * math.sin(2 * math.pi * k / n)) for k in range(n)
    ]
    dial = [(s + r * math.cos(2 * math.pi * k / n), yc + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
    for k in range(n):
        j = (k + 1) % n
        ts.face([F.p(*dial[k], 0.12), F.p(*dial[j], 0.12), F.p(*rim[j], 0.16), F.p(*rim[k], 0.16)], CT, F.N)
        tm = 2 * math.pi * (k + 0.5) / n
        ts.face(
            [F.p(*rim[k], 0.16), F.p(*rim[j], 0.16), F.p(*rim[j], 0.0), F.p(*rim[k], 0.0)],
            CT,
            F.U * math.cos(tm) + UP * math.sin(tm),
        )
    ts.face(
        [F.p(x, y, 0.12) for x, y in dial],
        "TS_ClockFace",
        F.N,
        [((x - s) / (2 * r) + 0.5, (y - yc) / (2 * r) + 0.5) for x, y in dial],
    )


def hall_roof(ts, a0):
    """Slate hip roof of a dome hall: from the eave inside the parapet up to a deck round the drum."""
    outer = offset(hall_outline(a0), 0.6)
    centre = Vector((a0, -1.5))
    inner = [tuple(centre + (Vector(p) - centre) * 0.5) for p in outer]
    y0, y1 = CORNICE[1], 23.6  # PLATEAU: the drum's walls start at 23.8 m (north) / 22.8 m (south)
    n = len(outer)
    for i in range(n):
        j = (i + 1) % n
        (oa, oc), (pa, pc) = outer[i], outer[j]
        (ia, ic), (ja, jc) = inner[i], inner[j]
        mid = Vector(((oa + pa) / 2, (oc + pc) / 2)) - centre
        ts.face([M(oa, y0, oc), M(pa, y0, pc), M(ja, y1, jc), M(ia, y1, ic)], SL, mv(mid.x, mid.y).normalized() + UP)
    ts.face([M(a, y1, c) for a, c in ccw(inner)], CR, UP)
    # one big dormer on the roof of each diagonal face and on the back
    for p0, p1 in ((hall_outline(a0)[0], hall_outline(a0)[1]), (hall_outline(a0)[2], hall_outline(a0)[3])):
        F, ln = Frame.between(p0, p1, -1)
        Fd = Frame(*_frame_ac(F, ln / 2, -2.6), (F.ua, F.uc), (F.na, F.nc))
        dormer(ts, Fd, 0.0, DORMER_BASE - 0.3, big=True, back=2.5)


DOME_PROFILE = [  # apothem of the octagonal dome (m) vs height; JR elevation measured at 16.3 px/m
    (10.35, 28.9),
    (10.3, 29.3),
    (10.05, 30.2),
    (9.6, 31.1),
    (8.85, 32.0),
    (7.8, 32.9),
    (6.4, 33.7),
    (4.7, 34.3),
    (2.4, DOME_TOP),
]


def drum_and_dome(ts, a0):
    """Octagonal brick drum (3 tall windows per face), copper cornice, octagonal slate dome with copper
    ribs, eight round copper-framed dormers (oculi), corner pinnacles, lantern and the finial to 46.1 m."""
    y0, y1 = 23.0, 28.3
    face_w = 2 * DRUM_R * math.tan(math.pi / 8)
    for k in range(8):
        t = 2 * math.pi * k / 8  # face normal angle in plan (a, c) about (a0, 0)
        na, nc = math.cos(t), math.sin(t)
        F = Frame(a0 + DRUM_R * na, DRUM_R * nc, (-nc, na), (na, nc))
        hw = face_w / 2
        feats = [(-hw, hw, y0, y0 + 0.45, GR), (-hw, hw, 27.3, 27.6, GR)]  # brick drum, granite bands
        for x in (-1.45, 0.0, 1.45):
            feats += [(x - 0.55, x + 0.55, 24.15, 27.05, GR), (x - 0.38, x + 0.38, 24.3, 26.9, None)]
        ts.wall(F, -hw, hw, y0, y1, feats)
        for x in (-1.45, 0.0, 1.45):
            ts.window(F, x, 0.76, 24.3, 26.9, depth=0.25)
        ts.box(F, -hw - 0.05, hw + 0.05, y1, y1 + 0.6, 0.0, 0.45, CT, skip=("back",))
    # dome: 8 curved slate facets (UV: u across the facet, v up the profile, in slate tiles)
    tu, tv = TILE[SL]
    vacc = [0.0]
    for (r0, y0_), (r1, y1_) in zip(DOME_PROFILE, DOME_PROFILE[1:], strict=False):
        vacc.append(vacc[-1] + math.hypot(r1 - r0, y1_ - y0_))
    tan8 = math.tan(math.pi / 8)
    for k in range(8):
        t = 2 * math.pi * k / 8
        na, nc = math.cos(t), math.sin(t)
        ta, tc = -nc, na
        for i in range(len(DOME_PROFILE) - 1):
            (r0, y0_), (r1, y1_) = DOME_PROFILE[i], DOME_PROFILE[i + 1]
            w0, w1 = r0 * tan8 * 0.96, r1 * tan8 * 0.96  # leave the corners to the copper ribs
            pts = [
                M(a0 + r0 * na - w0 * ta, y0_, r0 * nc - w0 * tc),
                M(a0 + r0 * na + w0 * ta, y0_, r0 * nc + w0 * tc),
                M(a0 + r1 * na + w1 * ta, y1_, r1 * nc + w1 * tc),
                M(a0 + r1 * na - w1 * ta, y1_, r1 * nc - w1 * tc),
            ]
            uvs = [
                (-w0 / tu, vacc[i] / tv),
                (w0 / tu, vacc[i] / tv),
                (w1 / tu, vacc[i + 1] / tv),
                (-w1 / tu, vacc[i + 1] / tv),
            ]
            ts.face(pts, SL, mv(na, nc) * (y1_ - y0_) + UP * (r0 - r1), uvs, smooth=True)
        # copper rib on the corner between facet k and k+1: a rounded strip
        tcn = t + math.pi / 8
        ca, cc_ = math.cos(tcn), math.sin(tcn)
        ra, rc = -cc_, ca
        for i in range(len(DOME_PROFILE) - 1):
            (r0, y0_), (r1, y1_) = DOME_PROFILE[i], DOME_PROFILE[i + 1]
            R0, R1 = r0 / math.cos(math.pi / 8), r1 / math.cos(math.pi / 8)
            for side in (-1, 1):
                ws = 0.22
                q = [
                    M(a0 + R0 * ca, y0_ + 0.12, R0 * cc_),
                    M(a0 + R1 * ca, y1_ + 0.12, R1 * cc_),
                    M(a0 + (R1 - 0.1) * ca + side * ws * ra, y1_, (R1 - 0.1) * cc_ + side * ws * rc),
                    M(a0 + (R0 - 0.1) * ca + side * ws * ra, y0_, (R0 - 0.1) * cc_ + side * ws * rc),
                ]
                ts.face(q, CT, mv(ca + side * ra * 0.6, cc_ + side * rc * 0.6) + UP * 0.4, smooth=True)
        # corner pinnacle at the dome's foot
        pa, pc = a0 + (DRUM_R + 0.15) / math.cos(math.pi / 8) * ca, (DRUM_R + 0.15) / math.cos(math.pi / 8) * cc_
        ts.prism([(pa + x, pc + z) for x, z in _regular(4, 0.32, math.pi / 4)], 28.9, 29.7, CT, top=None)
        ts.lathe(pa, pc, [(0.28, 29.7), (0.22, 30.1), (0.1, 30.5), (0.0, 30.7)], 6, CT)
        # oculus dormer on the facet (round window in an ornamental copper frame, eight knobs)
        oculus(ts, a0, t)
    # lantern and finial (JR: 34.8 m without, 46.1 m with the finial; PLATEAU lantern top 38.4 m)
    ts.prism([(a0 + x, z) for x, z in _regular(8, 2.45)], DOME_TOP - 0.1, DOME_TOP + 0.15, CT, top=CT)
    ts.prism([(a0 + x, z) for x, z in _regular(8, 1.5)], DOME_TOP + 0.15, 35.9, CR, top=None)
    for k in range(4):
        t = math.pi / 2 * k
        Fo = Frame(a0 + 1.39 * math.cos(t), 1.39 * math.sin(t), (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
        ts.quad_frame(Fo, -0.3, 0.3, 35.0, 35.6, 0.02, "TS_Ironwork")
    bell = [(1.75, 35.9), (1.7, 36.15), (1.35, 36.4), (1.0, 36.8), (0.62, 37.4), (0.42, 37.9), (0.35, 38.4)]
    ts.lathe(a0, 0.0, bell, 8, CR, phase=math.pi / 8)
    ts.lathe(a0, 0.0, [(0.35, 38.4), (0.5, 38.6), (0.45, 38.85), (0.22, 39.0), (0.0, 39.05)], 8, CT)
    ts.spike(a0, 0.0, 39.0, FINIAL_TOP - 0.3, 0.13, 0.07, sides=8)
    ts.lathe(a0, 0.0, [(0.0, FINIAL_TOP - 0.45), (0.16, FINIAL_TOP - 0.25), (0.0, FINIAL_TOP)], 8, CT)


def oculus(ts, a0, t):
    """Round dormer on a dome facet: upright copper ring with knobs round a small round window."""
    na, nc = math.cos(t), math.sin(t)
    yc = 31.15
    r_dome = 9.45  # apothem at yc (DOME_PROFILE)
    F = Frame(a0 + (r_dome + 0.25) * na, (r_dome + 0.25) * nc, (-nc, na), (na, nc))
    n = 12
    ro, ri = 0.95, 0.55
    outer = [(ro * math.cos(2 * math.pi * k / n), yc + ro * math.sin(2 * math.pi * k / n)) for k in range(n)]
    inner = [(ri * math.cos(2 * math.pi * k / n), yc + ri * math.sin(2 * math.pi * k / n)) for k in range(n)]
    for k in range(n):
        j = (k + 1) % n
        ts.face([F.p(*inner[k], 0.0), F.p(*inner[j], 0.0), F.p(*outer[j], 0.0), F.p(*outer[k], 0.0)], CT, F.N)
        tm = 2 * math.pi * (k + 0.5) / n
        ts.face(
            [F.p(*outer[k], 0.0), F.p(*outer[j], 0.0), F.p(*outer[j], -1.0), F.p(*outer[k], -1.0)],
            CT,
            F.U * math.cos(tm) + UP * math.sin(tm),
        )
    ts.face(
        [F.p(x, y, -0.12) for x, y in inner],
        "TS_Glass",
        F.N,
        [((x / ri) * 0.5 + 0.5, ((y - yc) / ri) * 0.5 + 0.5) for x, y in inner],
    )
    for k in range(8):
        tk = 2 * math.pi * k / 8
        x, y = 1.08 * math.cos(tk), yc + 1.08 * math.sin(tk)
        ts.box(F, x - 0.1, x + 0.1, y - 0.1, y + 0.1, -0.1, 0.12, CT)
    ts.box(F, -0.22, 0.22, yc + ro - 0.05, yc + ro + 0.32, -0.15, 0.1, CT)


# ============================================================================================== ends
def round_tower(ts, ac, cc, r, sides, faces_out, cap_tip, cap="slate"):
    """Polygonal (near-round) corner tower: banded brick, windows on the facets facing `faces_out`
    (plan unit vectors), copper cornice, and a slate bell dome (north end) or copper cupola (south)."""
    fw = 2 * r * math.tan(math.pi / sides)
    for k in range(sides):
        t = 2 * math.pi * k / sides
        na, nc = math.cos(t), math.sin(t)
        F = Frame(ac + r * na, cc + r * nc, (-nc, na), (na, nc))
        hw = fw / 2
        feats = bands(-hw, hw) + ts.rustication(-hw, hw)
        wants = any(na * fa + nc * fc > 0.8 for fa, fc in faces_out)
        w = min(0.95, fw - 0.45)
        if wants:
            for y0, y1 in (F1, F2, F3):
                feats += [(-w / 2 - 0.12, w / 2 + 0.12, y0, y1 + 0.15, GR), (-w / 2, w / 2, y0, y1, None)]
        ts.wall(F, -hw, hw, 0.0, CORNICE[0], feats)
        if wants:
            for y0, y1 in (F1, F2, F3):
                ts.window(F, 0.0, w, y0, y1, depth=0.25)
                ts.sill(F, 0.0, w, y0, proj=0.08, h=0.12)
    # facets are centred on the k angles: the polygon's vertices sit half a step off
    poly = [
        (
            ac + r / math.cos(math.pi / sides) * math.cos(2 * math.pi * (k + 0.5) / sides),
            cc + r / math.cos(math.pi / sides) * math.sin(2 * math.pi * (k + 0.5) / sides),
        )
        for k in range(sides)
    ]
    ring_cornice(ts, poly, CORNICE[0], CORNICE[1], 0.5)
    if cap == "slate":
        y0 = CORNICE[1] + 0.65
        ts.prism(offset(poly, 0.25), CORNICE[1], y0, BR, top=None)
        prof = [
            (r + 0.05, y0),
            (r * 0.98, y0 + 0.65),
            (r * 0.88, y0 + 1.65),
            (r * 0.7, y0 + 2.75),
            (r * 0.48, y0 + 3.75),
            (r * 0.27, y0 + 4.65),
            (0.55, y0 + 5.25),
        ]
        ts.lathe(ac, cc, prof, sides, SL, phase=math.pi / sides)
        lantern(ts, ac, cc, y0 + 5.25, 0.55, cap_tip)
    else:
        ts.prism([(ac + x, cc + z) for x, z in _regular(sides, r * 0.78)], CORNICE[1], CORNICE[1] + 0.35, BR, top=None)
        y0 = CORNICE[1] + 0.35
        prof = [
            (r * 0.86, y0),
            (r * 0.84, y0 + 0.4),
            (r * 0.74, y0 + 1.1),
            (r * 0.55, y0 + 1.8),
            (r * 0.3, y0 + 2.3),
            (0.45, y0 + 2.5),
        ]
        ts.lathe(ac, cc, prof, sides, CR)
        lantern(ts, ac, cc, y0 + 2.5, 0.45, cap_tip)


BEND_M0 = (-133.0, 0.95)  # axis of the bent south wing (PLATEAU outline): origin, direction, half-width
BEND_D = (-0.7111, 0.7031)
BEND_N = (0.7031, 0.7111)  # toward the north-east (tracks) side
BEND_HW = 10.45
BEND_PAV = 33.0  # the street face steps out 0.8 m for the end pavilion (PLATEAU: from t ≈ 31.6)
BEND_NE_END = 40.0  # the track-side face stops short; the end is a half-round apse (JR 1F plan, PLATEAU)
APSE_T, APSE_CL, APSE_R = 47.2, -3.9, 7.35


def bend_point(t, cl):
    return (BEND_M0[0] + t * BEND_D[0] + cl * BEND_N[0], BEND_M0[1] + t * BEND_D[1] + cl * BEND_N[1])


def north_end(ts):
    """North end: two round towers (Ø 7.4 m in PLATEAU) with slate bell domes (JR rendering), the end wall
    between them, and the short wing stubs on both sides."""
    round_tower(ts, 134.8, -9.8, 3.7, 16, [(0.0, -1.0), (0.7, -0.7), (1.0, 0.0)], 26.6)
    round_tower(ts, 134.8, 10.1, 3.7, 16, [(1.0, 0.0), (0.7, 0.7), (0.0, 1.0)], 26.6)
    F = Frame(135.0, -6.1, (0.0, 1.0), (1.0, 0.0))
    ln = 12.5
    xs = bay_centres(0.0, ln, 2)
    feats = bands(0.0, ln)
    for x in xs:
        for (y0, y1), w in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            feats += [(x - w / 2 - 0.16, x + w / 2 + 0.16, y0, y1 + 0.16, GR), (x - w / 2, x + w / 2, y0, y1, None)]
    ts.wall(F, 0.0, ln, 0.0, CORNICE[0], feats)
    for x in xs:
        for (y0, y1), w in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            ts.window(F, x, w, y0, y1, depth=0.22)
    ts.cornice(F, 0.0, ln, proj=0.5)
    parapet(ts, F, 0.0, ln)


def south_end(ts):
    """South end: the corner turret with a copper cupola where the façade turns, the wing bent 45° toward
    the tracks (PLATEAU/OSM: 21 m deep like the main wing), its end pavilion stepped 0.8 m out on the
    street side and closed by a half-round apse with a slate dome and lantern (PLATEAU: 25.0 m)."""
    round_tower(ts, -134.6, -10.9, 2.7, 12, [(0.0, -1.0), (-0.7, -0.7)], 23.2, cap="copper")
    w0 = bend_point(0.0, -BEND_HW)
    Fsw = Frame(w0[0], w0[1], BEND_D, (-BEND_N[0], -BEND_N[1]))
    wing_frame(ts, Fsw, -3.9, BEND_PAV, 9)  # OSM: the face starts at (−137.7, −9.5), tangent to the turret
    p0 = bend_point(0.0, -BEND_HW - 0.8)
    Fp = Frame(p0[0], p0[1], BEND_D, (-BEND_N[0], -BEND_N[1]))
    pavilion_face(ts, Fp, BEND_PAV, APSE_T)
    side_frame = Frame(*bend_point(BEND_PAV, -BEND_HW), (-BEND_N[0], -BEND_N[1]), (-BEND_D[0], -BEND_D[1]))
    ts.wall(side_frame, 0.0, 0.8, 0.0, CORNICE[0], bands(0.0, 0.8))
    # track side, the short end wall and the apse's flank
    e0 = bend_point(0.0, BEND_HW)
    east_frame(ts, Frame(e0[0], e0[1], BEND_D, BEND_N), 2.9, BEND_NE_END, 9)
    q0 = bend_point(BEND_NE_END, BEND_HW)
    east_frame(ts, Frame(q0[0], q0[1], (-BEND_N[0], -BEND_N[1]), BEND_D), 0.0, BEND_HW - (APSE_CL + APSE_R), 1)
    q1 = bend_point(BEND_NE_END, APSE_CL + APSE_R)
    east_frame(ts, Frame(q1[0], q1[1], BEND_D, BEND_N), 0.0, APSE_T - BEND_NE_END, 2)
    # apse: half a 16-gon round (APSE_T, APSE_CL)
    n = 8
    pts = []
    for k in range(n + 1):
        th = math.pi / 2 - math.pi * k / n
        pts.append(bend_point(APSE_T + APSE_R * math.cos(th), APSE_CL + APSE_R * math.sin(th)))
    for k in range(n):
        F, ln = Frame.between(pts[k], pts[k + 1], +1)  # (t, cl) is mirrored to (a, c): this run is ccw in plan
        feats = bands(0.0, ln) + ts.rustication(0.0, ln)
        x = ln / 2
        for y0, y1 in (F2, F3):
            feats += [(x - 0.85, x + 0.85, y0, y1 + 0.18, GR), (x - 0.65, x + 0.65, y0, y1, None)]
        feats.append(arch1_hole(x))
        ts.wall(F, 0.0, ln, 0.0, CORNICE[0], feats)
        arch1(ts, F, x)
        for y0, y1 in (F2, F3):
            ts.window(F, x, 1.3, y0, y1)
            ts.sill(F, x, 1.3, y0)
        ts.cornice(F, -0.3, ln + 0.3)
        parapet(ts, F, 0.0, ln)
    ca, cc = bend_point(APSE_T, APSE_CL)
    prof = [
        (APSE_R - 0.4, CORNICE[1]),
        (APSE_R - 0.6, 17.6),
        (APSE_R * 0.78, 19.2),
        (APSE_R * 0.55, 20.9),
        (APSE_R * 0.32, 22.2),
        (1.0, 23.0),
    ]
    ts.lathe(ca, cc, prof, 16, SL, phase=math.atan2(BEND_N[1], BEND_N[0]))
    lantern(ts, ca, cc, 23.0, 0.95, 26.0)
    # roofs: the bent wing (overlapping the main wing's end) and the end pavilion block

    def P(t, cl, y):
        a, c = bend_point(t, cl)
        return M(a, y, c)

    def N(dt, dc, dy=0.0):
        return mv(dt * BEND_D[0] + dc * BEND_N[0], dt * BEND_D[1] + dc * BEND_N[1], dy)

    gambrel(ts, P, N, -8.0, BEND_NE_END, -BEND_HW, BEND_HW, hip0=True, hip1=True)
    gambrel(ts, P, N, BEND_PAV, APSE_T, -BEND_HW - 0.8, APSE_CL + APSE_R, ridge=23.4, hip0=True, hip1=True)
    for k in range(4):
        t = 5.0 + 8.0 * k
        for cl, front in ((-BEND_HW, True), (BEND_HW, False)):
            sgn = -1 if front else 1
            a, c = bend_point(t, cl - sgn * 1.7)
            out = (sgn * BEND_N[0], sgn * BEND_N[1])
            big = front and k in (0, 3)
            dormer(ts, Frame(a, c, (-out[1], out[0]), out), 0.0, DORMER_BASE, big=big, back=5.6 if big else 2.7)


def wing_frame(ts, F, s0, s1, n):
    """West-style wing bays on an arbitrary frame (used for the bent wing's street face)."""
    xs = bay_centres(s0, s1, n)
    feats = bands(s0, s1) + ts.rustication(s0, s1)
    for x in xs:
        feats += [(x - 1.03, x + 1.03, F1[0], F1[1] + 0.26, GR), (x - 0.75, x + 0.75, *F1, None)]
        feats += [(x - 0.9, x + 0.9, F2[0], F2[1] + 0.2, GR), (x - 0.7, x + 0.7, *F2, None)]
        feats += [(x - 0.86, x + 0.86, F3[0], F3[1] + 0.18, GR), (x - 0.68, x + 0.68, *F3, None)]
    ts.wall(F, s0, s1, 0.0, CORNICE[0], feats)
    for x in xs:
        ts.window(F, x, 1.5, *F1)
        ts.sill(F, x, 1.5, F1[0] + 0.02)
        ts.window(F, x, 1.4, *F2)
        ts.sill(F, x, 1.4, F2[0])
        ts.pediment(F, x, 1.4, F2[1] + 0.2, "tri")
        ts.window(F, x, 1.36, *F3)
        ts.sill(F, x, 1.36, F3[0])
    posts = [x + BAY / 2 for x in xs[:-1]]
    for x in posts:
        ts.pilaster(F, x, BAND1[1], ARCHI[0])
    ts.cornice(F, s0, s1)
    ts.balustrade(F, s0, s1, posts)


def pavilion_face(ts, F, s0, s1):
    xs = bay_centres(s0, s1, 3, 3.6)
    feats = bands(s0, s1) + ts.rustication(s0, s1)
    feats += ts.quoins(F, s0, BAND1[1], CORNICE[0], +1) + ts.quoins(F, s1, BAND1[1], CORNICE[0], -1)
    for x in xs:
        feats += [(x - 0.85, x + 0.85, F2[0], F2[1] + 0.2, GR), (x - 0.65, x + 0.65, *F2, None)]
        feats += [(x - 0.83, x + 0.83, F3[0], F3[1] + 0.18, GR), (x - 0.65, x + 0.65, *F3, None)]
        feats.append(arch1_hole(x))
    ts.wall(F, s0, s1, 0.0, CORNICE[0], feats)
    for x in xs:
        arch1(ts, F, x)
        ts.window(F, x, 1.3, *F2)
        ts.sill(F, x, 1.3, F2[0])
        ts.pediment(F, x, 1.3, F2[1] + 0.2, "seg")
        ts.window(F, x, 1.3, *F3)
        ts.sill(F, x, 1.3, F3[0])
    ts.cornice(F, s0 - 0.6, s1 + 0.6)
    parapet(ts, F, s0, s1)


def east_frame(ts, F, s0, s1, n):
    xs = bay_centres(s0, s1, n)
    feats = bands(s0, s1)
    for x in xs:
        for (y0, y1), w in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            feats += [(x - w / 2 - 0.16, x + w / 2 + 0.16, y0, y1 + 0.16, GR), (x - w / 2, x + w / 2, y0, y1, None)]
    ts.wall(F, s0, s1, 0.0, CORNICE[0], feats)
    for x in xs:
        for (y0, y1), w in ((F1, 1.4), (F2, 1.3), (F3, 1.3)):
            ts.window(F, x, w, y0, y1, depth=0.22, bars=False)
    ts.cornice(F, s0, s1, proj=0.45)
    parapet(ts, F, s0, s1)


# ============================================================================================== roofs
def gambrel(ts, P, N, t0, t1, cw, ce, hip0=False, hip1=False, ridge=RIDGE, gable=True, mat=SL):
    """Wing roof: a steep slate skirt hidden behind the balustrade, then ≈26° to the ridge (PLATEAU
    sections: 18.2 m at the façade line, 22.1–22.9 m ridge). Hips make a planar end polygon."""
    cm = (cw + ce) / 2
    prof = [(cw + 0.6, CORNICE[1]), (cw + 1.2, BAL[1]), (cm, ridge), (ce - 1.2, BAL[1]), (ce - 0.6, CORNICE[1])]
    e0 = [t0 + ((y - CORNICE[1]) if hip0 else 0.0) for _, y in prof]
    e1 = [t1 - ((y - CORNICE[1]) if hip1 else 0.0) for _, y in prof]
    for i in range(len(prof) - 1):
        (ca, ya), (cb, yb) = prof[i], prof[i + 1]
        out = N(0.0, -(yb - ya)) + UP * (cb - ca)
        q = [P(e0[i], ca, ya), P(e1[i], ca, ya), P(e1[i + 1], cb, yb), P(e0[i + 1], cb, yb)]
        ts.face(q, mat, out)
    for hip, ends, sgn in ((hip0, e0, -1), (hip1, e1, 1)):
        pts = [P(ends[i], c, y) for i, (c, y) in enumerate(prof)]
        if hip:
            ts.face(pts, mat, N(sgn, 0.0) + UP)
        elif gable:
            ts.face(pts, BR, N(sgn, 0.0))


def roofs(ts):
    def P(t, c, y):
        return M(t, y, c)

    def N(dt, dc, dy=0.0):
        return mv(dt, dc, dy)

    # the wing roofs run on into the taller central roof and into the dome halls' roofs, so that only
    # their real intersection lines show (ends hidden inside the central roof and the drums)
    gambrel(ts, P, N, -136.0, -DOME_A - 10.4, WEST, EAST, hip0=True)
    gambrel(ts, P, N, -DOME_A + 10.4, -7.6, WEST, EAST)
    gambrel(ts, P, N, 7.6, DOME_A - 10.4, WEST, EAST)
    gambrel(ts, P, N, DOME_A + 10.4, 134.4, WEST, EAST, hip1=True)
    # dormers on the west slope: B s s s B on 7-bay runs, B s s B on 6-bay runs (photos, JR elevation)
    for s0, s1, n in (
        (54.1, 76.6, 6),
        (18.3, 44.6, 7),
        (-40.6, -18.3, 6),
        (-76.6, -50.1, 7),
        (121.6, 131.1, 2),
        (-131.0, -121.6, 2),
    ):
        xs = bay_centres(s0, s1, n)
        inner = xs[1:-1] if n > 2 else xs
        for k, x in enumerate(inner):
            big = n > 2 and k in (0, len(inner) - 1)
            dormer(
                ts, Frame(x, WEST + 1.7, (1.0, 0.0), (0.0, -1.0)), 0.0, DORMER_BASE, big=big, back=5.6 if big else 2.7
            )
    # dormers on the track side: small ones every other bay
    for s0, s1 in ((-121.6, -76.6), (-76.6, -12.9), (12.9, 76.6), (76.6, 121.6)):
        n = int((s1 - s0) / (2 * BAY))
        for x in bay_centres(s0 + 4.0, s1 - 4.0, max(1, n - 1), 2 * BAY):
            if any(abs(x - a0) < 23 for a0 in (DOME_A, -DOME_A)):
                continue
            dormer(ts, Frame(x, EAST - 1.7, (-1.0, 0.0), (0.0, 1.0)), 0.0, DORMER_BASE, big=False, back=2.7)


def canopies(ts):
    """Modern steel canopies in front of the north and south domes (outline: OSM relation 4856156)."""
    outlines = {
        "north": [(75.8, -12.45), (68.4, -20.4), (84.1, -35.8), (113.9, -35.4), (129.3, -20.2), (118.8, -9.9)],
        "south": [(-120.9, -12.35), (-129.1, -20.8), (-113.8, -36.4), (-83.7, -36.2), (-68.4, -20.6), (-77.0, -12.0)],
    }
    for outline in outlines.values():
        poly = ccw(outline)
        ts.prism(poly, 4.6, 4.95, "TS_CanopySteel", top="TS_CanopySteel", bottom="TS_CanopySteel")
        inner = offset(poly, 1.8)
        for i, (a, c) in enumerate(inner):
            if c > -21.0 and abs(a) < 120 and i not in (1, 2, 3):
                continue
            ts.lathe(a, c, [(0.2, 0.0), (0.2, 3.4), (0.55, 4.25), (0.8, 4.6)], 8, "TS_CanopySteel", cap=False)


# ============================================================================================== far LOD
def far_model(ts):
    """Silhouette for 1–20 km: the same plan and heights as the near model in a few hundred faces."""
    W, R, C = "TS_FarWall", "TS_FarRoof", "TS_FarCopper"
    uvw = (16.0, 20.0)
    # inset 5 cm so that no projecting block shares a plane with it (coplanar faces render black in Cycles
    # and z-fight in three.js)
    ts.prism(
        [(-132.4, WEST + 0.05), (131.1, WEST + 0.05), (131.1, EAST - 0.05), (-127.9, EAST - 0.05)],
        0.0,
        CORNICE[1],
        W,
        uv_wrap=uvw,
    )

    def P(t, c, y):
        return M(t, y, c)

    def N(dt, dc, dy=0.0):
        return mv(dt, dc, dy)

    gambrel(ts, P, N, -136.0, 134.4, WEST, EAST, hip1=True, gable=False, mat=R)
    for ac, front, back, half, top in (
        (NORTH_PAV, -12.6, -4.2, PAV_HALF, 20.7),
        (SOUTH_PAV, -12.6, -4.2, PAV_HALF, 20.7),
    ):
        cc = (front + back) / 2
        ts.prism(
            [(ac - half, front), (ac + half, front), (ac + half, back), (ac - half, back)], 0.0, top, W, uv_wrap=uvw
        )
        hip_stack(ts, ac, cc, half + 0.45, (back - front) / 2 + 0.45, [(1.0, top), (0.5, 23.6)], R)
        ts.lathe(ac, cc, [(2.45, 23.6), (1.85, 25.3), (1.1, 25.6), (0.0, 27.0)], 6, C)
        ts.spike(ac, cc, 26.9, 29.8, 0.25, 0.04, sides=4, mat=C)
    for ac in (15.6, -15.6):
        ts.prism([(ac - 2.7, -11.8), (ac + 2.7, -11.8), (ac + 2.7, -6.4), (ac - 2.7, -6.4)], 0.0, 21.45, W, uv_wrap=uvw)
        ts.lathe(ac, -9.1, [(1.7, 21.45), (1.3, 22.7), (0.0, 23.2)], 6, C)
    ts.prism(
        [(-CEN_HALF, WEST - 0.1), (CEN_HALF, WEST - 0.1), (CEN_HALF, EAST + 0.1), (-CEN_HALF, EAST + 0.1)],
        0.0,
        CEN_EAVE + 0.8,
        W,
        uv_wrap=uvw,
    )
    hip_stack(ts, 0.0, (WEST + EAST) / 2, CEN_HALF, (EAST - WEST) / 2, [(1.0, CEN_EAVE + 0.8), (0.31, 27.3)], R)
    ts.prism(
        [(-3.4, WEST - 0.1), (3.4, WEST - 0.1), (3.4, WEST + 0.7), (-3.4, WEST + 0.7)], CEN_EAVE, 23.3, W, uv_wrap=uvw
    )
    ts.prism([(-4.2, WEST - 7.4), (4.2, WEST - 7.4), (4.2, WEST), (-4.2, WEST)], 0.0, 6.9, W, uv_wrap=uvw)
    for a0 in (DOME_A, -DOME_A):
        hall = hall_outline(a0)
        ts.prism(hall, 0.0, CORNICE[1], W, uv_wrap=uvw)
        centre = Vector((a0, -1.5))
        outer = ccw(hall)
        inner = [tuple(centre + (Vector(p) - centre) * 0.5) for p in outer]
        for i in range(len(outer)):
            j = (i + 1) % len(outer)
            mid = Vector(((outer[i][0] + outer[j][0]) / 2, (outer[i][1] + outer[j][1]) / 2)) - centre
            ts.face(
                [
                    M(outer[i][0], CORNICE[1], outer[i][1]),
                    M(outer[j][0], CORNICE[1], outer[j][1]),
                    M(inner[j][0], 23.0, inner[j][1]),
                    M(inner[i][0], 23.0, inner[i][1]),
                ],
                R,
                mv(mid.x, mid.y) + UP,
            )
        ts.prism([(a0 + x, z) for x, z in _regular(8, DRUM_R / math.cos(math.pi / 8))], 23.0, 28.9, W, uv_wrap=uvw)
        prof = [
            (DRUM_R / math.cos(math.pi / 8), 28.9),
            (9.4 / math.cos(math.pi / 8), 31.3),
            (6.6 / math.cos(math.pi / 8), 33.6),
            (2.4, DOME_TOP),
        ]
        ts.lathe(a0, 0.0, prof, 8, R, phase=math.pi / 8)
        ts.lathe(a0, 0.0, [(1.6, DOME_TOP), (1.4, 36.2), (0.4, 38.4)], 8, C, phase=math.pi / 8, cap=True)
        ts.spike(a0, 0.0, 38.4, FINIAL_TOP, 0.35, 0.06, sides=4, mat=C)
        arc = [(4.4 * math.cos(math.pi * k / 4), 18.0 + 4.4 * math.sin(math.pi * k / 4)) for k in range(5)]
        for (xa, ya), (xb, yb) in zip(arc, arc[1:], strict=False):
            q = [M(a0 - xa, ya, -11.2), M(a0 - xb, yb, -11.2), M(a0 - xb, yb, -23.9), M(a0 - xa, ya, -23.9)]
            ts.face(q, C, Vector(((xa + xb) / 2, (ya + yb) / 2 - 18.0, 0.0)))
        ts.face([M(a0 - x, y, -23.9) for x, y in arc], W, Vector((0, 0, 1)))
    for ac, cc, r, top in ((134.8, -9.8, 3.7, 26.6), (134.8, 10.1, 3.7, 26.6), (-134.6, -10.9, 2.7, 23.2)):
        y0 = CORNICE[1] + 0.65
        ts.prism([(ac + x, cc + z) for x, z in _regular(8, r / math.cos(math.pi / 8))], 0.0, y0, W, uv_wrap=uvw)
        ts.lathe(ac, cc, [(r, y0), (r * 0.7, y0 + 2.75), (0.3, top - 3.0), (0.0, top)], 8, R, phase=math.pi / 8)
    bent = [bend_point(-3.2, -BEND_HW), bend_point(BEND_PAV, -BEND_HW - 0.8)]
    bent += [
        bend_point(APSE_T + APSE_R * math.cos(th), APSE_CL + APSE_R * math.sin(th))
        for th in (-math.pi / 2, -math.pi / 4, 0.0, math.pi / 4, math.pi / 2)
    ]
    bent += [bend_point(BEND_NE_END, APSE_CL + APSE_R), bend_point(BEND_NE_END, BEND_HW), bend_point(3.2, BEND_HW)]
    ts.prism(bent, 0.0, CORNICE[1], W, uv_wrap=uvw)

    def Pb(t, cl, y):
        a, c = bend_point(t, cl)
        return M(a, y, c)

    def Nb(dt, dc, dy=0.0):
        return mv(dt * BEND_D[0] + dc * BEND_N[0], dt * BEND_D[1] + dc * BEND_N[1], dy)

    gambrel(ts, Pb, Nb, -8.0, BEND_NE_END, -BEND_HW, BEND_HW, ridge=22.5, gable=False, mat=R)
    ca, cc = bend_point(APSE_T, APSE_CL)
    ts.lathe(ca, cc, [(APSE_R, CORNICE[1]), (APSE_R * 0.55, 20.9), (0.3, 23.0), (0.0, 26.0)], 8, R)


# ============================================================================================== entry
# Placeholder colours until agy's textures exist (sRGB), measured on Commons photos (see the note):
# brick/granite/slate medians under overcast light, copper as weathered by 2025–26 (dark brown, not green).
DAY = {
    "TS_BrickRed": dict(color=0x843F32, roughness=0.85),
    "TS_GraniteWhite": dict(color=0xC6C4BC, roughness=0.75),
    "TS_SlateRoof": dict(color=0x46484E, roughness=0.55),
    "TS_CopperRoof": dict(color=0x5A524E, metallic=0.5, roughness=0.5),
    "TS_CopperTrim": dict(color=0x4A3C36, metallic=0.45, roughness=0.55),
    "TS_WindowFrame": dict(color=0xDAD6CC, roughness=0.45),
    "TS_Glass": dict(color=0x44525E, metallic=0.3, roughness=0.12),
    "TS_GlassLit": dict(color=0x44525E, metallic=0.3, roughness=0.12),
    "TS_Ironwork": dict(color=0x2B2D2C, metallic=0.3, roughness=0.6),
    "TS_ClockFace": dict(color=0xEDEBE4, roughness=0.4),
    "TS_CanopySteel": dict(color=0xE4E4E0, roughness=0.5),
    "TS_RoofGlass": dict(color=0x6E8088, metallic=0.3, roughness=0.1),
}
ROOM = (1.0, 0.80, 0.55)

# Texture files agy is asked to deliver (knowledge/tokyo-station-blender.md, テクスチャの依頼書), looked up
# in assets/landmarks/textures/. A material uses whichever of its files exist (base colour replaces the
# placeholder colour; normal and roughness/metallic maps are added); missing files keep the flat colour.
TEXTURE_FILES = {
    "TS_BrickRed": ("ts_brick_basecolor.jpg", "ts_brick_normal.png", "ts_brick_rough.png"),
    "TS_GraniteWhite": ("ts_granite_basecolor.jpg", "ts_granite_normal.png", "ts_granite_rough.png"),
    "TS_SlateRoof": ("ts_slate_basecolor.jpg", "ts_slate_normal.png", "ts_slate_rough.png"),
    "TS_CopperRoof": ("ts_copper_roof_basecolor.jpg", "ts_copper_roof_normal.png", "ts_copper_roof_rough.png"),
    "TS_CopperTrim": ("ts_copper_trim_basecolor.jpg", None, "ts_copper_trim_rough.png"),
    "TS_WindowFrame": ("ts_frame_basecolor.jpg", None, None),
    "TS_Glass": ("ts_glass_basecolor.jpg", None, None),
    "TS_GlassLit": ("ts_glass_basecolor.jpg", None, None),
    "TS_ClockFace": ("ts_clock_basecolor.png", None, None),
    "TS_RoofGlass": ("ts_roofglass_basecolor.jpg", None, None),
}
EMIT_FILES = {"TS_GlassLit": "ts_glass_night.jpg", "TS_ClockFace": "ts_clock_night.png"}


def with_textures(L, part, day, lights):
    """Add the delivered texture files (if present) to a material spec and its night variants."""
    files = TEXTURE_FILES.get(part, (None, None, None))
    have = [f if f and os.path.exists(os.path.join(L.TEX, f)) else None for f in files]
    day = dict(day)
    if have[0]:
        day.update(tex=have[0], color=0xFFFFFF)
    if have[1]:
        day["normal_tex"] = have[1]
    if have[2]:
        day.update(rough_tex=have[2], roughness=1.0, metallic=1.0)
    emit = EMIT_FILES.get(part)
    if lights and emit and os.path.exists(os.path.join(L.TEX, emit)):
        lights = {m: {**v, "emit_tex": emit} for m, v in lights.items()}
    return day, lights


def night_lights():
    """Light_floodlight_* (外壁の投光 + rooms) and Light_lightsOut_* (rooms only) on top of the day look."""

    def k(c, f):
        return (c[0] * f, c[1] * f, c[2] * f, 1.0)

    # Floodlit looks given directly as emission (see knowledge/landmarks-blender.md pitfall 2: albedo ×
    # lamp colour turns pink after tone mapping). Brick sRGB ≈ (130, 77, 44) and granite ≈ (160, 125, 92):
    # the hues of Tokyo_Station_Marunouchi_Building_at_night_20191201.jpg (brick median #5F3627 there).
    fl = {
        "TS_BrickRed": (0.22, 0.075, 0.025, 1.0),
        "TS_GraniteWhite": (0.36, 0.2, 0.1, 1.0),
        "TS_CopperTrim": (0.045, 0.02, 0.008, 1.0),
        "TS_CopperRoof": (0.03, 0.016, 0.007, 1.0),
        "TS_WindowFrame": (0.3, 0.18, 0.09, 1.0),
        "TS_Glass": k(ROOM, 0.18),
    }
    both = {
        "TS_GlassLit": (k(ROOM, 1.0), 1.3),
        "TS_ClockFace": (k((1.0, 0.96, 0.88), 1.0), 0.9),
        "TS_RoofGlass": (k((1.0, 0.82, 0.6), 1.0), 0.7),
        "TS_CanopySteel": (k((1.0, 0.95, 0.85), 1.0), 0.25),
    }
    out = {}
    for part, e in fl.items():
        out[part] = {"floodlight": {"emission": e, "strength": 1.0}}
    for part, (e, st) in both.items():
        out[part] = {"floodlight": {"emission": e, "strength": st}, "lightsOut": {"emission": e, "strength": st}}
    return out


def smooth_by_angle(ob, degrees=35.0):
    """Smooth shading with sharp edges above `degrees` (domes, turrets and vaults read round, boxes crisp)."""

    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(degrees)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(math.pi) < lim
    bm.to_mesh(me)
    bm.free()


def build(L):
    """Build the near and far models. L: landmarks.py helpers (Builder, Palette, material, bpy, SCENE, ...)."""
    pal = L.Palette(["floodlight", "lightsOut"])
    lights = night_lights()
    for part, day in DAY.items():
        spec, lit = with_textures(L, part, day, lights.get(part))
        pal.add(part, lit, **spec)
    far_lit = {
        "floodlight": {"emission": (1, 1, 1, 1), "strength": 0.9, "emit_tex": "ts_far_night.png"},
        "lightsOut": {"emission": (1, 1, 1, 1), "strength": 0.35, "emit_tex": "ts_far_night.png"},
    }
    pal.add("TS_FarWall", far_lit, color=0xFFFFFF, tex="ts_far.png", roughness=0.8)
    pal.add("TS_FarRoof", color=0x46484E, roughness=0.6)
    pal.add(
        "TS_FarCopper",
        {"floodlight": {"emission": (0.1, 0.06, 0.035, 1.0), "strength": 1.0}},
        color=0x5A524E,
        roughness=0.55,
    )

    ts = Station(L, "TokyoStation_Near", pal)
    # west (丸の内) façade, north to south
    wing_west(ts, 121.6, 131.1, 2)
    dome_pavilion(ts, DOME_A)
    wing_west(ts, 54.1, 76.6, 6)
    pyramid_pavilion(ts, NORTH_PAV)
    wing_west(ts, 18.3, 44.6, 7)
    flank_tower(ts, 15.6)
    central_pavilion(ts)
    flank_tower(ts, -15.6)
    wing_west(ts, -40.6, -18.3, 6)
    pyramid_pavilion(ts, SOUTH_PAV)
    wing_west(ts, -76.6, -50.1, 7)
    dome_pavilion(ts, -DOME_A)
    wing_west(ts, -132.4, -121.6, 2)  # runs into the corner turret (OSM: façade to a = −130.5)
    north_end(ts)
    south_end(ts)
    # track side
    wing_east(ts, -127.9, -114.7, 3)
    wing_east(ts, -83.5, 83.5, 41)
    wing_east(ts, 114.7, 131.0, 4)
    roofs(ts)
    canopies(ts)

    root = L.bpy.data.objects.new("TokyoStation", None)
    L.SCENE.collection.objects.link(root)
    near_ob = ts.b.finish(pal, root)
    smooth_by_angle(near_ob)
    tf = Station(L, "TokyoStation_Far", pal)
    far_model(tf)
    far_ob = tf.b.finish(pal, root)
    smooth_by_angle(far_ob, 50.0)

    origin = (139.7660621, 35.6813763)  # centre of symmetry (midpoint of the two domes, PLATEAU LOD2)
    meta = {
        "id": "tokyo_station",
        "name": "東京駅丸の内駅舎",
        "lon": origin[0],
        "lat": origin[1],
        "heading": HEADING,
        "baseHeight": 3.4,
        "height": FINIAL_TOP,
        "farDistance": 1000,
        "footprint": L.OSM_FOOTPRINT["tokyo_station"],
        "sources": [L.SOURCES["osm"], L.SOURCES["plateau"]],
        "plateau": [{"gmlId": "bldg_6af58cef-669e-4aca-bc01-355e870d1ad5", "hide": True}],
        "lightModes": [
            {"id": "floodlight", "name": "ライトアップ（外壁の投光と客室の明かり）"},
            {"id": "lightsOut", "name": "ライトアップ終了後（客室・屋根窓の明かりのみ）"},
        ],
        "lightSchedule": {
            "source": "二次情報（旅行情報サイト: 通常は日没〜21時頃）。JR 東日本の一次情報は未確認",
            "on": "sunset",
            "off": "21:00",
            "after": "lightsOut",
        },
    }
    return root, near_ob, far_ob, pal, meta


HEADING = 287.05  # +Z: the Marunouchi facade, facing the Imperial Palace along 行幸通り
