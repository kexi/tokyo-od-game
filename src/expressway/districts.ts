import { STATION_STRIDE, type XwChunk, type XwClass } from "./format";

/**
 * The districts the expressway is checked and shipped in (P2.7-4 5.6): a unit for the ledger, the
 * data tests and the scorecard. Provisional: their order and borders are settled after S6・S7.
 * - central (都心・湾岸): C1, the Y line and the radials 1–4, 10, 11 and the bay line B.
 * - east (東・北): the radials 5, 6, 7, 9, S1, and C2 outside the yamate box.
 * - yamate (山手トンネル): C2 inside the box south-west of 35.745 N, 139.77 E (a run across the box: east).
 * - outside: any ref not in the table (the K lines and others reaching out of the wards).
 */
export const DISTRICTS = ["central", "east", "yamate", "outside"] as const;
export type District = (typeof DISTRICTS)[number];

export const DISTRICT_REFS: Readonly<Record<"central" | "east", readonly string[]>> = {
  central: ["C1", "Y", "1", "2", "3", "4", "10", "11", "B"],
  east: ["5", "6", "7", "9", "S1"],
};

/**
 * The box of C2 that is the 山手トンネル (south-west of it): latitude below maxLat and longitude below
 * maxLon. Why a box and not the tunnel's portals: C2's northern and eastern stretches (east) are on
 * viaducts as is the rest of the east, the south-west one is the tunnel; a box of two numbers is
 * easy to review and to move once the data is in (S6・S7).
 */
export const YAMATE_BOX = { maxLat: 35.745, maxLon: 139.77 } as const;

/** Whether a point is inside YAMATE_BOX. */
const inYamateBox = (lon: number, lat: number) => lat < YAMATE_BOX.maxLat && lon < YAMATE_BOX.maxLon;

/**
 * The table's entry of a ref, the first of its values (OSM's `;` list, `E14;14`) that the table has,
 * null for none. Why the first the table has and not the first value: a way shared by two routes
 * lists both, and the operator's route need not come first.
 */
function tableRefOf(ref: string): string | null {
  const values = ref.split(";").map((v) => v.trim());
  return (
    values.find((v) => v === "C2" || DISTRICT_REFS.central.includes(v) || DISTRICT_REFS.east.includes(v)) ??
    null
  );
}

/**
 * The district of a ref, without YAMATE_BOX (C2 is east): what splits a chain into runs of one
 * district (network.ts refBorders). A ref the table does not have is outside (E1, K1, S5 …: the
 * E refs are other operators' and are cut off by --run-borders cut, R1-1a).
 */
export function districtOfRefName(ref: string): "central" | "east" | "outside" {
  const entry = tableRefOf(ref);
  if (entry === null) return "outside";
  return DISTRICT_REFS.central.includes(entry) ? "central" : "east";
}

/** The district of a main line's ref at a point (C2 split by YAMATE_BOX); null without a ref. */
export function districtOfRef(ref: string | null, lon: number, lat: number): District | null {
  if (ref === null) return null;
  const entry = tableRefOf(ref);
  const isC2 = entry === "C2";
  if (isC2) return inYamateBox(lon, lat) ? "yamate" : "east";
  return districtOfRefName(ref);
}

/**
 * A run as the districts need it: its class, the ref it mostly carries (null for none), the runs its
 * ends hang from (start first) and some points of it.
 */
export type DistrictRun = {
  id: string;
  cls: XwClass;
  ref: string | null;
  parents: string[];
  /** [lon, lat] points along it (the nearest main line to a run with no parent is found by them). */
  points: Array<[number, number]>;
  /**
   * The point at half its length, which places a main line against YAMATE_BOX; absent, the middle
   * one of `points`. Why half the length and not the middle point: the chunks' stations and the
   * plan's samples are spaced differently (closer on curves), and their middle points can lie a run's
   * curve apart; the point at half the length is the same place to a station's spacing in both.
   */
  middle?: [number, number];
};

/** The ref a run's chunks carry over the longest length (ties by the ref's name), null for none. */
export function mainRefOf(chunks: readonly XwChunk[]): string | null {
  const byRef = new Map<string, number>();
  for (const c of chunks) {
    if (c.ref === null) continue;
    const length = c.st[c.st.length - STATION_STRIDE] - c.st[0];
    byRef.set(c.ref, (byRef.get(c.ref) ?? 0) + length);
  }
  const sorted = [...byRef].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return sorted[0]?.[0] ?? null;
}

/** A run's points from its chunks (every station, in order). */
export function pointsOf(chunks: readonly XwChunk[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of chunks.toSorted((a, b) => a.k - b.k))
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) out.push([c.st[i + 1], c.st[i + 2]]);
  return out;
}

const middle = (pts: ReadonlyArray<[number, number]>) => pts[Math.floor(pts.length / 2)];

/** The station nearest half a run's length (its chunks' run distances), null without chunks. */
export function halfwayOf(chunks: readonly XwChunk[]): [number, number] | null {
  const sorted = chunks.toSorted((a, b) => a.k - b.k);
  const isEmpty = sorted.length === 0;
  if (isEmpty) return null;
  const first = sorted[0].st;
  const last = sorted[sorted.length - 1].st;
  const half = (first[0] + last[last.length - STATION_STRIDE]) / 2;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const c of sorted)
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      const d = Math.abs(c.st[i] - half);
      if (d >= bestD) continue;
      bestD = d;
      best = [c.st[i + 1], c.st[i + 2]];
    }
  return best;
}

/**
 * Every run's district. A main line with a ref by its ref (C2 by where its middle point lies); a
 * main line without one, a ramp or a street by the main line its ends hang from, followed through
 * other ramps (the start's first; where the start leads to none, the end's); failing that, the main
 * line nearest its middle point; failing that, outside.
 */
export function assignDistricts(runs: readonly DistrictRun[]): Map<string, District> {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const out = new Map<string, District>();
  for (const r of runs) {
    const isMain = r.cls === "expressway";
    if (!isMain || r.points.length === 0) continue;
    const [lon, lat] = r.middle ?? middle(r.points);
    const d = districtOfRef(r.ref, lon, lat);
    // R1-1a: a C2 run across YAMATE_BOX is east, the district shipped first, wherever its middle is.
    const isAcrossBox = d === "yamate" && r.points.some(([x, y]) => !inYamateBox(x, y));
    if (d) out.set(r.id, isAcrossBox ? "east" : d);
  }
  const follow = (id: string, seen: Set<string>): District | null => {
    const known = out.get(id);
    if (known) return known;
    const r = byId.get(id);
    const isLoop = seen.has(id);
    if (!r || isLoop) return null;
    seen.add(id);
    for (const p of r.parents) {
      const d = follow(p, seen);
      if (d) return d;
    }
    return null;
  };
  const mains = runs.filter((r) => out.has(r.id));
  const nearest = (pt: [number, number]): District | null => {
    let best: { d: number; district: District } | null = null;
    const k = Math.cos((pt[1] * Math.PI) / 180);
    for (const m of mains)
      for (const q of m.points) {
        const d = Math.hypot((q[0] - pt[0]) * k, q[1] - pt[1]);
        if (!best || d < best.d) best = { d, district: out.get(m.id)! };
      }
    return best?.district ?? null;
  };
  for (const r of runs.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    if (out.has(r.id)) continue;
    const viaParents = r.parents.map((p) => follow(p, new Set([r.id]))).find((d) => d !== null) ?? null;
    const viaNearest = viaParents ?? (r.points.length > 0 ? nearest(middle(r.points)) : null);
    out.set(r.id, viaNearest ?? "outside");
  }
  return out;
}

/** C2 runs with points on both sides of YAMATE_BOX (to review where the box cuts). */
export function boxBorderRuns(runs: readonly DistrictRun[]): string[] {
  return runs
    .filter((r) => r.ref === "C2")
    .filter((r) => {
      const inside = r.points.map(([lon, lat]) => inYamateBox(lon, lat));
      return inside.includes(true) && inside.includes(false);
    })
    .map((r) => r.id)
    .sort();
}

/** The runs of written chunks as DistrictRun (ref by mainRefOf, parents from the run ends). */
export function districtRunsOf(
  runs: ReadonlyArray<{ id: string; cls: XwClass; start: { parent?: string }; end: { parent?: string } }>,
  byRun: ReadonlyMap<string, readonly XwChunk[]>,
): DistrictRun[] {
  return runs.map((r) => {
    const chunks = byRun.get(r.id) ?? [];
    const parents = [r.start.parent, r.end.parent].filter((p): p is string => p !== undefined);
    const points = pointsOf(chunks);
    const half = halfwayOf(chunks);
    return {
      id: r.id,
      cls: r.cls,
      ref: mainRefOf(chunks),
      parents,
      points,
      ...(half ? { middle: half } : {}),
    };
  });
}
