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
  /**
   * The refs of its ways in order (null for a way without one), where the plan knows them
   * (scope.ts planDistrictRuns). A main line's district comes from them (review 1 B2: 888066403, 13 km
   * of C2 after four ways without a ref, read as central by its first way). Absent (a folder's run
   * summaries carry the first way's ref only): `ref`.
   */
  wayRefs?: Array<string | null>;
};

/** A run as scope v2 reads it (scope.ts, and the districts' stages): its class and its ends' parents. */
export type ScopeRun = { id: string; cls: XwClass; parents: readonly string[] };

/** Why rule A left a ramp out, in which round, and the parent it hung from (`parent` only). */
export type DroppedRamp = { round: number; reason: "parent" | "unreached"; parent: string | null };

/**
 * Scope v2's ramps (R1-1a, r1a-answer1 and review 1 B1): the ramps reached from `mains` through ramps
 * alone (a run's parents and the runs hanging from it, both ways), less rule A, round by round until
 * nothing more drops: (1) a ramp hanging from a run of `runs` that is neither `kept` (the shipped main
 * lines and streets) nor still in, `parent`; (2) a ramp no longer reached from `mains` through the
 * ramps still in, `unreached` (a junction's foot on the streets once its link is out). A parent not in
 * `runs` (a ground end, a link at grade not compiled) is no parent. So every ramp kept hangs from kept
 * runs and is reached through them: dangling 0 and no island, by construction. Why not ship such links
 * and close their ends with a wall (B): a link onto a road not shipped (外環, the K lines past the
 * wards) would end in a wall at nothing, and its foot alone would be an entrance to nowhere. Pure, so
 * the districts' stages (districtStages) and the scope (scope.ts shipRuns) are the one rule.
 */
export function scopeRamps(
  runs: ReadonlyMap<string, ScopeRun>,
  mains: ReadonlySet<string>,
  kept: ReadonlySet<string>,
): { ramps: Set<string>; dropped: Map<string, DroppedRamp> } {
  const graph = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    graph.set(a, [...(graph.get(a) ?? []), b]);
    graph.set(b, [...(graph.get(b) ?? []), a]);
  };
  for (const r of runs.values()) for (const p of r.parents) if (runs.has(p)) link(r.id, p);
  const reach = (through: (id: string) => boolean) => {
    const seen = new Set(mains);
    const queue = [...mains];
    const out = new Set<string>();
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const next of graph.get(id) ?? []) {
        const isRamp = runs.get(next)?.cls === "ramp";
        const isOpen = isRamp && !seen.has(next) && through(next);
        if (!isOpen) continue;
        seen.add(next);
        out.add(next);
        queue.push(next);
      }
    }
    return out;
  };
  const ramps = reach(() => true);
  const dropped = new Map<string, DroppedRamp>();
  for (let round = 1; ; round++) {
    let isChanged = false;
    for (const id of [...ramps].sort()) {
      const parent = runs.get(id)!.parents.find((p) => runs.has(p) && !kept.has(p) && !ramps.has(p));
      if (parent === undefined) continue;
      ramps.delete(id);
      dropped.set(id, { round, reason: "parent", parent });
      isChanged = true;
    }
    const still = reach((id) => ramps.has(id));
    for (const id of [...ramps].sort()) {
      if (still.has(id)) continue;
      ramps.delete(id);
      dropped.set(id, { round, reason: "unreached", parent: null });
      isChanged = true;
    }
    if (!isChanged) break;
  }
  return { ramps, dropped };
}

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
 * A main line's district from its refs: the first way's with a ref (a way without one takes its
 * neighbour's), C2 against YAMATE_BOX at the middle (a run across the box is east). `mixed` where its
 * ways' refs fall in more than one district other than by the box: --run-borders cut leaves none
 * (network.ts refBorders), keep has them (the E refs of the other operators' stretches) and takes the
 * first. null for a run with no ref at all.
 */
function mainDistrictOf(r: DistrictRun): { district: District; mixed: boolean } | null {
  const refs = (r.wayRefs ?? [r.ref]).filter((x): x is string => x !== null);
  const isRefless = refs.length === 0;
  if (isRefless || r.points.length === 0) return null;
  const [lon, lat] = r.middle ?? middle(r.points);
  const d = districtOfRef(refs[0], lon, lat)!;
  // R1-1a: a C2 run across YAMATE_BOX is east, the district shipped first, wherever its middle is.
  const isAcrossBox = d === "yamate" && r.points.some(([x, y]) => !inYamateBox(x, y));
  const named = new Set(refs.map((x) => districtOfRefName(x)));
  return { district: isAcrossBox ? "east" : d, mixed: named.size > 1 };
}

/**
 * Every run's district (R1-1a review 1 B2・B3: the districts are published stage by stage, central,
 * + east, + yamate, + outside, and each stage must be a scope of its own).
 * - A main line with a ref: by its refs (mainDistrictOf).
 * - A main line with no ref, or a street: the latest stage among the districts of the runs it hangs
 *   from (followed through such runs); failing that, the nearest main line (its line, not its points).
 * - A ramp: the first stage whose scope takes it, the scope being scope v2 (scopeRamps: reached from
 *   the stage's main lines through ramps, rule A, reached again) with the main lines and streets of the
 *   districts up to that stage as the shipped ones. So every stage has no dangling run and no island,
 *   and a link between a central and an east main line ships with east (R2), never into the air in R1.
 *   A ramp no stage takes (none in a shipped scope) falls back to its parents', then the nearest.
 * Why stages and not "the start's parent first" (as before): that put the link from central onto east
 * in central, whose parent R1 would not write (the central build's dangling was 5).
 */
export function districtsOf(runs: readonly DistrictRun[]): {
  districts: Map<string, District>;
  mixed: string[];
} {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const out = new Map<string, District>();
  const mixed: string[] = [];
  for (const r of runs) {
    const isMain = r.cls === "expressway";
    if (!isMain) continue;
    const d = mainDistrictOf(r);
    if (!d) continue;
    out.set(r.id, d.district);
    if (d.mixed) mixed.push(r.id);
  }
  const rank = (d: District) => DISTRICTS.indexOf(d);
  const latest = (ds: District[]) =>
    ds.reduce<District | null>((a, d) => (a === null || rank(d) > rank(a) ? d : a), null);
  // Main lines without a ref and streets: from the runs they hang from, until nothing more is found.
  const isCarrier = (r: DistrictRun) => r.cls === "street" || (r.cls === "expressway" && !out.has(r.id));
  for (let isGrown = true; isGrown;) {
    isGrown = false;
    for (const r of runs) {
      if (!isCarrier(r) || out.has(r.id)) continue;
      const d = latest(r.parents.map((p) => out.get(p)).filter((x): x is District => x !== undefined));
      if (d === null) continue;
      out.set(r.id, d);
      isGrown = true;
    }
  }
  const mains = runs.filter((r) => out.has(r.id) && r.cls === "expressway");
  // R1-1a: the distance to each main line's polyline, not to its points. Why: the chunks' stations and
  // the plan's samples lie on the same line at other spacings, so the nearest point could belong to
  // another main line in one and not the other (16 ramps of ship/all differed); the distance to the
  // line is the same in both to the line's bends between points.
  const nearest = (pt: [number, number]): District | null => {
    let best: { d: number; district: District } | null = null;
    const k = Math.cos((pt[1] * Math.PI) / 180);
    const toSegment = (a: [number, number], b: [number, number]) => {
      const ax = (a[0] - pt[0]) * k;
      const ay = a[1] - pt[1];
      const bx = (b[0] - pt[0]) * k;
      const by = b[1] - pt[1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
      return Math.hypot(ax + t * dx, ay + t * dy);
    };
    for (const m of mains)
      for (let i = 0; i < m.points.length; i++) {
        const d = toSegment(m.points[i], m.points[Math.min(i + 1, m.points.length - 1)]);
        if (!best || d < best.d) best = { d, district: out.get(m.id)! };
      }
    return best?.district ?? null;
  };
  for (const r of runs.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!isCarrier(r) || out.has(r.id)) continue;
    out.set(r.id, (r.points.length > 0 ? nearest(r.middle ?? middle(r.points)) : null) ?? "outside");
  }
  // Ramps: the first stage whose scope takes them.
  const scopeRuns = new Map(runs.map((r) => [r.id, { id: r.id, cls: r.cls, parents: r.parents }]));
  for (let k = 0; k < DISTRICTS.length; k++) {
    const kept = new Set(
      runs.filter((r) => r.cls !== "ramp" && out.has(r.id) && rank(out.get(r.id)!) <= k).map((r) => r.id),
    );
    const stageMains = new Set([...kept].filter((id) => byId.get(id)!.cls === "expressway"));
    for (const id of scopeRamps(scopeRuns, stageMains, kept).ramps)
      if (!out.has(id)) out.set(id, DISTRICTS[k]);
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
  for (const r of runs.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    if (out.has(r.id)) continue;
    const viaParents = r.parents.map((p) => follow(p, new Set([r.id]))).find((d) => d !== null) ?? null;
    const viaNearest = viaParents ?? (r.points.length > 0 ? nearest(r.middle ?? middle(r.points)) : null);
    out.set(r.id, viaNearest ?? "outside");
  }
  return { districts: out, mixed: mixed.sort() };
}

/** Every run's district (districtsOf). */
export function assignDistricts(runs: readonly DistrictRun[]): Map<string, District> {
  return districtsOf(runs).districts;
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

/**
 * What a --districts build writes (R1-1a review 1 B4): the chunks, run summaries, closed runs and
 * entrances of the picked runs, taken from what the whole ship compiled and signed, unchanged. Why
 * pick after the solve and the signs and not before: the signs (signPlan.ts planSigns) read the
 * written runs (a junction's direction board names the line it leads onto, a divider the deck beside),
 * so a smaller set wrote other signs, and a published district's chunks must stay byte for byte (T8).
 */
export function pickWritten<
  C extends { run: string },
  R extends { id: string },
  K extends { run: string },
  E extends { run: string },
>(
  written: { chunks: C[]; runs: R[]; closed: K[]; entrances: E[] },
  isPicked: (run: string) => boolean,
): { chunks: C[]; runs: R[]; closed: K[]; entrances: E[] } {
  return {
    chunks: written.chunks.filter((c) => isPicked(c.run)),
    runs: written.runs.filter((r) => isPicked(r.id)),
    closed: written.closed.filter((c) => isPicked(c.run)),
    entrances: written.entrances.filter((e) => isPicked(e.run)),
  };
}
