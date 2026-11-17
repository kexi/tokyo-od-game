import { z } from "zod";
import { BELOW_DEFER_REASONS, type BelowDeferReason, TUNNEL_DEPTH_M } from "./below";
import { STATION_STRIDE, ST, type XwChunk, type XwClass, type XwRunSummary } from "./format";
import { SAME_SURFACE_ALLOWED_DZ_M } from "./allowlist";
import { pairStations } from "./overlap";

/**
 * The scorecard's `underground` (S7-1, report.ts version 7): what S7 (地下全面) is measured by before
 * it changes anything. Three counts, from the plan's deferrals and the written files alone:
 *
 * - `deferred`: the below runs left out and why (below.ts BELOW_DEFER_REASONS), by reason, by ref and
 *   one by one. Not by district: a deferred run is in no file, and the districts are told from files
 *   today (districts.ts); its ref lets it be put in one later.
 * - `portals`: every written below run's end that is a portal (its first or last station, where the
 *   road beyond is no tunnel or cut): the road and the ground there, the run at grade it seams to and
 *   how far that one stands off the ground within PORTAL_APPROACH_M, and how much depth its tunnel
 *   lacks at that station (W10: a portal's end is at the ground today).
 * - `overApproach`: decks over a run at grade within PORTAL_APPROACH_M of a portal, less than a level
 *   (overlap.ts pairStations' levelApart: 第12条's 4.5 m and the upper deck's girder) above it. The
 *   汐留 approach 45068170 under the exit 24402125 is one (plan 0 節の 4): once the portal is joined,
 *   main-line traffic drives under it.
 *
 * Pure; the build script hands it the plan's deferrals with the files.
 */

/** How far from a portal its approach is read (S7-1's instructions: the 300 m S7-2 lowers it over). */
export const PORTAL_APPROACH_M = 300;

const count = z.number().int().nonnegative();
const km = z.number().nonnegative();
const tally = z.strictObject({ runs: count, km });
const byClass = z.strictObject({ main: tally, ramp: tally, street: tally });
const reason = z.enum(BELOW_DEFER_REASONS);

export const UndergroundSchema = z.strictObject({
  deferred: z.strictObject({
    total: byClass,
    /** Every reason, each with its runs and km by class (0 where none). */
    byReason: z.strictObject(
      Object.fromEntries(BELOW_DEFER_REASONS.map((r) => [r, byClass])) as Record<
        BelowDeferReason,
        typeof byClass
      >,
    ),
    /** By the ref over most of the run's length (`-` for none). */
    byRef: z.record(z.string(), tally),
    inRange: tally,
    list: z.array(
      z.strictObject({
        id: z.string(),
        cls: z.enum(["main", "ramp", "street"]),
        ref: z.string().nullable(),
        km,
        reason,
        inRange: z.boolean(),
      }),
    ),
  }),
  portals: z.strictObject({
    ends: count,
    /** The ends into a tunnel short of its depth at their station, and the largest shortfall (m). */
    coverShort: count,
    maxShortM: z.number().nonnegative(),
    list: z.array(
      z.strictObject({
        /** `<run>:start` or `<run>:end` (the comparison's key). */
        id: z.string(),
        run: z.string(),
        end: z.enum(["start", "end"]),
        /** The structure inside the run at that end. */
        into: z.enum(["tunnel", "cut"]),
        zM: z.number(),
        groundM: z.number(),
        /** Road less ground at the end (m). */
        dzM: z.number(),
        /** The run at grade it seams to, and its (road − ground) farthest from 0 within PORTAL_APPROACH_M. */
        approach: z.strictObject({ run: z.string(), offM: z.number() }).nullable(),
        /** TUNNEL_DEPTH_M less the depth under the ground at the end (0 when deep enough); null into a cut. */
        coverShortM: z.number().nonnegative().nullable(),
      }),
    ),
  }),
  overApproach: z.strictObject({
    pairs: count,
    list: z.array(
      z.strictObject({
        /** `<lower>|<upper>`. */
        id: z.string(),
        lower: z.string(),
        upper: z.string(),
        /** The lower run's distances over which the upper deck stands too low over it. */
        s0: z.number(),
        s1: z.number(),
        minDzM: z.number().nonnegative(),
        /** The centre lines' distance at the smallest height difference. */
        offsetM: z.number().nonnegative(),
      }),
    ),
  }),
});

export type Underground = z.infer<typeof UndergroundSchema>;

/** A deferred below run as the build hands it in (compile.ts BelowDeferral, without its chain). */
export type DeferredBelow = {
  id: string;
  reason: BelowDeferReason;
  cls: XwClass;
  ref: string | null;
  lengthM: number;
  inRange: boolean;
};

const CLASS_KEY = { expressway: "main", ramp: "ramp", street: "street" } as const;
const round = (v: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
const NO_REF = "-";

function emptyByClass(): z.infer<typeof byClass> {
  return { main: { runs: 0, km: 0 }, ramp: { runs: 0, km: 0 }, street: { runs: 0, km: 0 } };
}

/** The deferred below runs by reason, ref and range, and one by one (sorted by id). */
export function deferredOf(list: readonly DeferredBelow[]): Underground["deferred"] {
  const total = emptyByClass();
  const byReason = Object.fromEntries(BELOW_DEFER_REASONS.map((r) => [r, emptyByClass()])) as Record<
    BelowDeferReason,
    ReturnType<typeof emptyByClass>
  >;
  const byRef: Record<string, { runs: number; km: number }> = {};
  const inRange = { runs: 0, km: 0 };
  const sorted = list.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const d of sorted) {
    const k = d.lengthM / 1000;
    for (const t of [total[CLASS_KEY[d.cls]], byReason[d.reason][CLASS_KEY[d.cls]]]) {
      t.runs++;
      t.km += k;
    }
    const ref = (byRef[d.ref ?? NO_REF] ??= { runs: 0, km: 0 });
    ref.runs++;
    ref.km += k;
    if (d.inRange) {
      inRange.runs++;
      inRange.km += k;
    }
  }
  const tallies = [
    ...Object.values(total),
    ...Object.values(byReason).flatMap((b) => Object.values(b)),
    ...Object.values(byRef),
    inRange,
  ];
  for (const t of tallies) t.km = round(t.km, 3);
  return {
    total,
    byReason,
    byRef: Object.fromEntries(Object.entries(byRef).toSorted(([a], [b]) => (a < b ? -1 : 1))),
    inRange,
    list: sorted.map((d) => ({
      id: d.id,
      cls: CLASS_KEY[d.cls],
      ref: d.ref,
      km: round(d.lengthM / 1000, 3),
      reason: d.reason,
      inRange: d.inRange,
    })),
  };
}

type Station = { s: number; lon: number; lat: number; z: number; ground: number };

/** A run's stations from its chunks in order, each once (consecutive chunks share their end station). */
function stationsOfRun(chunks: readonly XwChunk[]): Station[] {
  const out: Station[] = [];
  for (const c of chunks.toSorted((a, b) => a.k - b.k)) {
    const first = out.length === 0 ? 0 : STATION_STRIDE;
    for (let i = first; i < c.st.length; i += STATION_STRIDE)
      out.push({
        s: c.st[i + ST.s],
        lon: c.st[i + ST.lon],
        lat: c.st[i + ST.lat],
        z: c.st[i + ST.z],
        ground: c.st[i + ST.ground],
      });
  }
  return out;
}

/** Metres between two points (a local plane; the distances asked here are a few hundred metres). */
function metresBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 110574);
}

/** A run at grade's stretch within PORTAL_APPROACH_M of a portal: the run distances it spans. */
type ApproachStretch = { run: string; s0: number; s1: number };

/**
 * The portal ends of the written below runs (`portals`) and the stretches of the runs at grade they
 * seam to, within PORTAL_APPROACH_M of them, with those of the runs at grade ending at a portal
 * themselves (what `overApproach` looks over). A below run is told by
 * the plan (`belowIds`: a tags build writes no `below` on its summaries); a run at grade by its summary.
 * The run beyond an end is the one the end seams to (endPlan: a run at grade is the master of the
 * seams of a below run beside it), so an end seaming to another below run is no portal.
 */
export function portalsOf(
  chunks: readonly XwChunk[],
  runs: readonly XwRunSummary[],
  belowIds: ReadonlySet<string>,
): { portals: Underground["portals"]; stretches: ApproachStretch[] } {
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const summaries = new Map(runs.map((r) => [r.id, r]));
  const list: Underground["portals"]["list"] = [];
  const stretches: ApproachStretch[] = [];
  for (const r of runs.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    const isBelow = belowIds.has(r.id);
    const own = byRun.get(r.id);
    if (!isBelow || !own) continue;
    const stations = stationsOfRun(own);
    const portals = own.toSorted((a, b) => a.k - b.k).flatMap((c) => c.portals ?? []);
    for (const atStart of [true, false]) {
      const end = atStart ? r.start : r.end;
      const parent = end.parent;
      const isUnderBeyond = parent !== undefined && belowIds.has(parent);
      if (isUnderBeyond) continue;
      const station = atStart ? stations[0] : stations[stations.length - 1];
      const portal = atStart ? portals[0] : portals[portals.length - 1];
      const into = (atStart ? portal?.to : portal?.from) === "tunnel" ? "tunnel" : "cut";
      const depth = station.ground - station.z;
      const isTunnel = into === "tunnel";
      const approachRun = parent !== undefined && summaries.get(parent)?.ground === true ? parent : null;
      const approach = approachRun === null ? null : approachOf(approachRun, byRun.get(approachRun), station);
      if (approach) stretches.push(approach.stretch);
      list.push({
        id: `${r.id}:${atStart ? "start" : "end"}`,
        run: r.id,
        end: atStart ? "start" : "end",
        into,
        zM: round(station.z, 3),
        groundM: round(station.ground, 2),
        dzM: round(station.z - station.ground, 3),
        approach: approach && { run: approach.stretch.run, offM: approach.offM },
        coverShortM: isTunnel ? round(Math.max(0, TUNNEL_DEPTH_M - depth), 3) : null,
      });
    }
  }
  // A run at grade ending at a portal itself (its tunnel not written: out of the range or deferred, as
  // the 汐留 approach 45068170 in the default range) is an approach too, from that end.
  for (const r of runs.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    const own = byRun.get(r.id);
    const isGround = r.ground === true && own !== undefined;
    if (!isGround) continue;
    for (const atStart of [true, false]) {
      const isPortal = (atStart ? r.start : r.end).kind === "portal";
      if (!isPortal) continue;
      const stations = stationsOfRun(own);
      const at = atStart ? stations[0] : stations[stations.length - 1];
      const approach = approachOf(r.id, own, at);
      if (approach) stretches.push(approach.stretch);
    }
  }
  const shorts = list.flatMap((p) => (p.coverShortM !== null && p.coverShortM > 0 ? [p.coverShortM] : []));
  return {
    portals: {
      ends: list.length,
      coverShort: shorts.length,
      maxShortM: shorts.length === 0 ? 0 : Math.max(...shorts),
      list,
    },
    stretches,
  };
}

/**
 * A run at grade's end at a portal: the stations within PORTAL_APPROACH_M of it (along the run) and
 * (road − ground) farthest from 0 there. The end at the portal is the nearer of its two ends to the
 * portal's station. Why not from its summary: its end at a seam with a below run is `open` (endPlan),
 * naming nothing.
 */
function approachOf(
  run: string,
  chunks: readonly XwChunk[] | undefined,
  portal: Station,
): { stretch: ApproachStretch; offM: number } | null {
  if (!chunks) return null;
  const stations = stationsOfRun(chunks);
  const first = stations[0];
  const last = stations[stations.length - 1];
  const isAtStart = metresBetween(first, portal) <= metresBetween(last, portal);
  const sEnd = isAtStart ? first.s : last.s;
  const near = stations.filter((p) => Math.abs(p.s - sEnd) <= PORTAL_APPROACH_M);
  let off = 0;
  for (const p of near) {
    const d = p.z - p.ground;
    const isFarther = Math.abs(d) > Math.abs(off);
    if (isFarther) off = d;
  }
  const s = near.map((p) => p.s);
  return { stretch: { run, s0: Math.min(...s), s1: Math.max(...s) }, offM: round(off, 3) };
}

/**
 * Decks over the portals' approaches less than a level above them (`overApproach`): over overlap.ts
 * pairStations (the carriageways' centre lines nearer than the sum of their half widths, the other's
 * Hermite surface), the station pairs whose lower is an approach within its stretch and whose upper
 * stands more than one surface (allowlist.ts SAME_SURFACE_ALLOWED_DZ_M) and less than the level apart
 * over its girder above it. Both directions of a pair count (the upper's station over the lower, the
 * lower's under the upper). Why the allowlist's one surface and not overlap.ts SAME_SURFACE_M (5 cm):
 * two carriageways side by side at 6–7 cm (the 汐留 approaches 45068169 and 45068170, 7.8 m apart in
 * the default data) are one surface the seams take as such, not a deck over another. Why not
 * deckOverlaps' pairs: they keep a pair whatever stands where along it, and the stretch near the
 * portal is the point; nor only pairs not joined: a ramp joining the approach still puts its deck over
 * it where it stands apart above.
 */
export function overApproachOf(
  chunks: XwChunk[],
  stretches: readonly ApproachStretch[],
): Underground["overApproach"] {
  const byLower = new Map<string, ApproachStretch[]>();
  for (const st of stretches) byLower.set(st.run, [...(byLower.get(st.run) ?? []), st]);
  const isNearPortal = (run: string, s: number) =>
    (byLower.get(run) ?? []).some((st) => s >= st.s0 - 1e-6 && s <= st.s1 + 1e-6);
  const found = new Map<string, Underground["overApproach"]["list"][number]>();
  const isNone = byLower.size === 0;
  if (isNone) return { pairs: 0, list: [] };
  for (const p of pairStations(chunks)) {
    // a over b (dz > 0: a is the upper) or a under b (dz < 0: a is the lower).
    const isAUpper = p.dz > 0;
    const [lower, sLower, upper] = isAUpper ? [p.b, p.sb, p.a] : [p.a, p.sa, p.b];
    const dz = Math.abs(p.dz);
    const isTooLow = dz > SAME_SURFACE_ALLOWED_DZ_M && dz < p.levelApart;
    if (!isTooLow || !isNearPortal(lower, sLower)) continue;
    const id = `${lower}|${upper}`;
    const o = found.get(id) ?? { id, lower, upper, s0: sLower, s1: sLower, minDzM: dz, offsetM: p.dist };
    o.s0 = Math.min(o.s0, sLower);
    o.s1 = Math.max(o.s1, sLower);
    const isLower = dz < o.minDzM;
    if (isLower) {
      o.minDzM = dz;
      o.offsetM = p.dist;
    }
    found.set(id, o);
  }
  const list = [...found.values()]
    .map((o) => ({
      ...o,
      s0: round(o.s0, 1),
      s1: round(o.s1, 1),
      minDzM: round(o.minDzM, 3),
      offsetM: round(o.offsetM, 2),
    }))
    .toSorted((a, b) => (a.id < b.id ? -1 : 1));
  return { pairs: list.length, list };
}

/** The scorecard's `underground` from the plan's deferrals and the written files. */
export function undergroundOf(input: {
  deferred: readonly DeferredBelow[];
  chunks: XwChunk[];
  runs: readonly XwRunSummary[];
  belowIds: ReadonlySet<string>;
}): Underground {
  const { portals, stretches } = portalsOf(input.chunks, input.runs, input.belowIds);
  return {
    deferred: deferredOf(input.deferred),
    portals,
    overApproach: overApproachOf(input.chunks, stretches),
  };
}

/** The ids of a list (none for a section that is not there). */
function idsOf(list: ReadonlyArray<{ id: string }> | undefined): Set<string> {
  return new Set((list ?? []).map((x) => x.id));
}

/** The ids of b not in a (added) and of a not in b (removed), sorted. */
function sideBy(pa: Set<string>, pb: Set<string>): { added: string[]; removed: string[] } {
  return {
    added: [...pb].filter((id) => !pa.has(id)).toSorted(),
    removed: [...pa].filter((id) => !pb.has(id)).toSorted(),
  };
}

/**
 * What two scorecards' `underground` say apart beyond their numbers (scripts/compareExpresswayReports.ts):
 * the deferred runs, portal ends and over-approach pairs on one side only, and the runs deferred on
 * both for another reason. `absent` names the side without the section (a report before version 7),
 * whose comparison is then the section added or removed as a whole. Why apart from the numbered rows:
 * a reason is a word, and a run deferred for another reason changes no number of its own.
 */
export function undergroundChanges(
  a: Underground | undefined,
  b: Underground | undefined,
): {
  absent: "a" | "b" | null;
  deferred: { added: string[]; removed: string[]; reasonChanged: string[] };
  portals: { added: string[]; removed: string[] };
  overApproach: { added: string[]; removed: string[] };
} {
  const reasonA = new Map((a?.deferred.list ?? []).map((d) => [d.id, d.reason]));
  const reasonChanged = (b?.deferred.list ?? [])
    .filter((d) => reasonA.has(d.id) && reasonA.get(d.id) !== d.reason)
    .map((d) => `${d.id} ${reasonA.get(d.id)}→${d.reason}`)
    .toSorted();
  const absent = a === undefined && b !== undefined ? "a" : b === undefined && a !== undefined ? "b" : null;
  return {
    absent,
    deferred: { ...sideBy(idsOf(a?.deferred.list), idsOf(b?.deferred.list)), reasonChanged },
    portals: sideBy(idsOf(a?.portals.list), idsOf(b?.portals.list)),
    overApproach: sideBy(idsOf(a?.overApproach.list), idsOf(b?.overApproach.list)),
  };
}
