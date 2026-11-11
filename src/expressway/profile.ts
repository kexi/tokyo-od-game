import { ST, STATION_STRIDE } from "./format";

/**
 * The road surface between stations: cubic Hermite interpolation of the elevation from the two
 * stations' elevations and grades (knowledge/road-redesign-plan.md 4.4 T11: the deck and the collider read the same curve).
 * The compiled profile is a chain of parabolas, which a cubic Hermite reproduces exactly on any
 * interval inside one parabola; across a knot it stays C¹ (no kink) and within millimetres.
 *
 * Why not linear interpolation (P1): a 20 m chord of a 450 m vertical curve leaves the parabola by
 * 0.11 m and turns by up to 4.4 % at the station, which a car feels as a bump at every vertex.
 * Pure: no three.js, so the build checks, the deck and P3's surfaceY share it.
 */

export type SurfacePoint = { z: number; grade: number };

/** Elevation and grade at s of the cubic through (s0, z0, g0) and (s1, z1, g1). */
export function hermite(
  s0: number,
  z0: number,
  g0: number,
  s1: number,
  z1: number,
  g1: number,
  s: number,
): SurfacePoint {
  const h = s1 - s0;
  const isDegenerate = h <= 0;
  if (isDegenerate) return { z: z0, grade: g0 };
  const t = (s - s0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const z = h00 * z0 + h10 * h * g0 + h01 * z1 + h11 * h * g1;
  const d00 = (6 * t2 - 6 * t) / h;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = (-6 * t2 + 6 * t) / h;
  const d11 = 3 * t2 - 2 * t;
  const grade = d00 * z0 + d10 * g0 + d01 * z1 + d11 * g1;
  return { z, grade };
}

export { ST };

/** Index of the station interval [i, i+1] holding s (clamped to the chunk). */
export function intervalAt(st: ArrayLike<number>, s: number): number {
  const n = st.length / STATION_STRIDE;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (st[mid * STATION_STRIDE] <= s) lo = mid;
    else hi = mid;
  }
  return Math.min(lo, Math.max(0, n - 2));
}

/**
 * The road surface at run distance s within a chunk's stations: the plan position (lon, lat) and
 * the bank and ground are linear between the two stations, the elevation and grade the Hermite
 * cubic. This and `surfaceHeight` are the whole surface contract: the deck (expresswayDeck.ts)
 * builds its slab from them and P3's colliders and surfaceY must read the same.
 */
export type SurfaceFrame = {
  s: number;
  lon: number;
  lat: number;
  z: number;
  grade: number;
  bank: number;
  ground: number;
};

export function frameAt(st: ArrayLike<number>, s: number): SurfaceFrame {
  const i = intervalAt(st, s);
  const a = i * STATION_STRIDE;
  const b = a + STATION_STRIDE;
  const span = st[b + ST.s] - st[a + ST.s];
  const t = span > 0 ? Math.min(1, Math.max(0, (s - st[a + ST.s]) / span)) : 0;
  const lerp = (k: number) => st[a + k] + (st[b + k] - st[a + k]) * t;
  const p = hermite(st[a], st[a + ST.z], st[a + ST.grade], st[b], st[b + ST.z], st[b + ST.grade], s);
  return {
    s,
    lon: lerp(ST.lon),
    lat: lerp(ST.lat),
    z: p.z,
    grade: p.grade,
    bank: lerp(ST.bank),
    ground: lerp(ST.ground),
  };
}

/**
 * Height of the road surface `u` metres to the left of the centre line (right negative). `bank` is
 * the rise of the left edge per metre of width (superelevation.ts), applied only when the deck is
 * drawn banked (?expressway=bank); flat otherwise, so the surface is the centre height across.
 */
export function surfaceHeight(f: Pick<SurfaceFrame, "z" | "bank">, u: number, banked: boolean): number {
  return banked ? f.z + f.bank * u : f.z;
}

/** The surface elevation and grade at run distance s within a chunk's stations. */
export function surfaceAt(st: ArrayLike<number>, s: number): SurfacePoint {
  const i = intervalAt(st, s);
  const a = i * STATION_STRIDE;
  const b = a + STATION_STRIDE;
  return hermite(st[a], st[a + ST.z], st[a + ST.grade], st[b], st[b + ST.z], st[b + ST.grade], s);
}

/**
 * Largest distance between the cubic of one interval and its chord, for deciding how finely the
 * deck must be cut to follow it, sampled at t = ¼, ⅓, ½, ⅔, ¾ (the extreme of the deviation, a
 * cubic in t, lies between them closely enough for a 1 cm tolerance).
 */
export function chordDeviation(h: number, g0: number, g1: number, dz: number): number {
  const m = dz / h;
  // Deviation of the Hermite cubic from the chord: h·t(1−t)·[(g0 − m)(1 − t) − (g1 − m)t].
  let worst = 0;
  for (const t of [0.25, 0.5, 0.75, 1 / 3, 2 / 3]) {
    const d = h * t * (1 - t) * ((g0 - m) * (1 - t) - (g1 - m) * t);
    worst = Math.max(worst, Math.abs(d));
  }
  return worst;
}

/** Largest gap between the Hermite surface and the straight pieces drawn between its samples. */
export const SURFACE_TOLERANCE_M = 0.01;
/** Most pieces one station interval is cut into (the tightest vertical curves need ~6). */
export const SURFACE_MAX_PIECES = 8;

/**
 * Where the surface of a chunk is sampled for anything drawn or driven on it as straight pieces:
 * every station (t = 0, read as stored) and, inside an interval, as many more as the Hermite cubic
 * needs to stay within SURFACE_TOLERANCE_M of the chords. The deck (expresswayDeck.ts), its
 * collider and the road graph's segments (expresswayRoads.ts) all cut at these, so a car's
 * surfaceY between two graph points is the collider's face between the same two rings (knowledge/road-redesign-plan.md 4.4
 * T11). `i` is the station interval, `t` the fraction into it.
 */
export function surfaceSamples(st: ArrayLike<number>): Array<{ i: number; t: number; s: number }> {
  const n = st.length / STATION_STRIDE;
  const out: Array<{ i: number; t: number; s: number }> = [];
  for (let i = 0; i < n; i++) {
    const o = i * STATION_STRIDE;
    out.push({ i, t: 0, s: st[o + ST.s] });
    const isLast = i === n - 1;
    if (isLast) break;
    const q = o + STATION_STRIDE;
    const h = st[q + ST.s] - st[o + ST.s];
    const deviation = chordDeviation(h, st[o + ST.grade], st[q + ST.grade], st[q + ST.z] - st[o + ST.z]);
    const pieces = Math.min(
      SURFACE_MAX_PIECES,
      Math.max(1, Math.ceil(Math.sqrt(deviation / SURFACE_TOLERANCE_M))),
    );
    for (let k = 1; k < pieces; k++) out.push({ i, t: k / pieces, s: st[o + ST.s] + h * (k / pieces) });
  }
  return out;
}
