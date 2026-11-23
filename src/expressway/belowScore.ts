import { z } from "zod";
import { BELOW_DEFER_REASONS, type BelowDeferReason, TUNNEL_DEPTH_M } from "./below";
import { STATION_STRIDE, ST, type XwChunk, type XwClass, type XwRunSummary } from "./format";
import { pairStations, SAME_SURFACE_M } from "./overlap";
import { loweredStretchesOf } from "./violations";

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
 * - `overApproach`: decks over a run at grade within PORTAL_APPROACH_M of a portal (the approaches:
 *   compile.ts portalApproachEnds, from the plan), less than a level (overlap.ts pairStations'
 *   levelApart: 第12条's 4.5 m and the upper deck's girder) above it. The
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
const chainTally = z.strictObject({ chains: count, km, belowKm: km });
const STRUCTURES = ["viaduct", "embankment", "tunnel", "cut"] as const;

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
    /**
     * The deferred runs the range reaches, by a rule of the range's kind (compile.ts planNetwork): for
     * boxes the run's own line read every RANGE_LINE_STEP_M, for a chosen range (--range ship) its chain
     * having a run of the range, for --range all every run. The list's `inRange` is the same.
     */
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
    /**
     * S7-2 (version 10, `--portal-approach cut`): the ends whose approach at grade was lowered (their
     * summary's XwEnd.portalAt), and those of them still short of the tunnel's depth (線 3). 0 without the
     * flag; absent before version 10.
     */
    lowered: count.optional(),
    loweredCoverShort: count.optional(),
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
        /**
         * S7-2 (version 10): the lowered approach's stretch (its length to the portal at its start, m) and
         * its end's depth under the ground at the seam (m). Absent where the approach was not lowered.
         */
        lowered: z.strictObject({ lengthM: z.number().nonnegative(), approachDepthM: z.number() }).optional(),
        /** S7-2 (version 10): why an approach the plan saw was left at grade ("both-portals", addendum 4). */
        notLowered: z.enum(["both-portals"]).optional(),
      }),
    ),
  }),
  overApproach: z.strictObject({
    /**
     * The approaches looked over (compile.ts portalApproachEnds, written ones): so 0 pairs reads as no
     * deck over them, not as no approach.
     */
    approaches: z.strictObject({
      count,
      list: z.array(
        z.strictObject({
          /** `<run>:<end>`. */
          id: z.string(),
          run: z.string(),
          end: z.enum(["start", "end"]),
          /** The run distances within PORTAL_APPROACH_M of that end. */
          s0: z.number(),
          s1: z.number(),
        }),
      ),
    }),
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
        /** The largest height difference of the station pairs counted. */
        maxDzM: z.number().nonnegative(),
        /** The centre lines' distance at the smallest height difference. */
        offsetM: z.number().nonnegative(),
        /** The station pairs counted (both directions). */
        stations: count,
      }),
    ),
    /**
     * S7-2 (version 10, `--portal-approach cut`): the pairs counted apart from `list`, two lowered
     * approaches going down side by side, on one surface by the plan (the lower's chunk `decks` "same"
     * with the upper) with both stations in their lowered stretches. Why apart: they are the two
     * carriageways of one approach, apart by what their own tunnels hold them to (S7-2 追記 7 の 2), not
     * a deck over the approach; counted in `list`, they read as decks too low over it (S7-5 and S7-6
     * read `pairs`). Absent without a lowered approach.
     */
    besideLowered: z
      .strictObject({
        pairs: count,
        list: z.array(
          z.strictObject({
            id: z.string(),
            lower: z.string(),
            upper: z.string(),
            s0: z.number(),
            s1: z.number(),
            minDzM: z.number().nonnegative(),
            maxDzM: z.number().nonnegative(),
            offsetM: z.number().nonnegative(),
            stations: count,
          }),
        ),
      })
      .optional(),
  }),
  /**
   * S7-3 (version 9): the written junctions where the child's or the parent's chunk at the node is a
   * tunnel or cut, and the seams between two below runs; each with its parent there, whether the node
   * is inside the parent or at its end, both structures there and whether the parent's chunks carry an
   * opening for the child (XwChunk.openings). Absent before version 9.
   */
  joins: z
    .strictObject({
      junctions: count,
      seams: count,
      /** Junctions with no opening on the parent's chunks (S7-3's line: 0 under --below-junctions compile). */
      withoutOpening: count,
      list: z.array(
        z.strictObject({
          /** `<run>:<end>`. */
          id: z.string(),
          kind: z.enum(["junction", "seam"]),
          parent: z.string(),
          parentS: z.number(),
          node: z.enum(["inside", "end"]),
          structure: z.enum(STRUCTURES),
          parentStructure: z.enum(STRUCTURES),
          opening: z.boolean(),
        }),
      ),
    })
    .optional(),
  /**
   * S7-3 (version 9, compile.ts unplannedChains): the chains with tunnel or cut ways and no viaduct run,
   * which no build compiles nor counts among the deferred; in all and those reaching the range (sharing
   * a node with a chain of the range's runs, through other such chains too). Absent before version 9.
   */
  unplanned: z
    .strictObject({
      total: chainTally,
      inRange: chainTally,
      list: z.array(
        z.strictObject({
          /** The chain's id. */
          id: z.string(),
          cls: z.enum(["main", "ramp", "street"]),
          ref: z.string().nullable(),
          km,
          belowKm: km,
          inRange: z.boolean(),
          /** The planned runs at its first and last node. */
          ends: z.tuple([z.array(z.string()), z.array(z.string())]),
        }),
      ),
    })
    .optional(),
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

/** An approach's end at its portal (compile.ts portalApproachEnds): the run at grade and which end. */
export type ApproachEnd = { run: string; end: "start" | "end" };

/** A run at grade's stretch within PORTAL_APPROACH_M of its portal end: the run distances it spans. */
type ApproachStretch = { run: string; end: "start" | "end"; s0: number; s1: number };

/**
 * The stretch of an approach within PORTAL_APPROACH_M of its portal end, on its written stations: to
 * PORTAL_APPROACH_M exactly from the end (S7-1 review 2: not the last station short of it), and
 * (road − ground) farthest from 0 at its stations there. Null for a run not written.
 */
function stretchOf(
  end: ApproachEnd,
  chunks: readonly XwChunk[] | undefined,
): { stretch: ApproachStretch; offM: number } | null {
  if (!chunks) return null;
  const stations = stationsOfRun(chunks);
  const first = stations[0].s;
  const last = stations[stations.length - 1].s;
  const isStart = end.end === "start";
  const s0 = isStart ? first : Math.max(first, last - PORTAL_APPROACH_M);
  const s1 = isStart ? Math.min(last, first + PORTAL_APPROACH_M) : last;
  let off = 0;
  for (const p of stations) {
    const isNear = p.s >= s0 - 1e-6 && p.s <= s1 + 1e-6;
    if (!isNear) continue;
    const d = p.z - p.ground;
    const isFarther = Math.abs(d) > Math.abs(off);
    if (isFarther) off = d;
  }
  return { stretch: { run: end.run, end: end.end, s0, s1 }, offM: round(off, 3) };
}

/**
 * The portal ends of the written below runs (`portals`). A below run is told by the plan (`belowIds`:
 * a tags build writes no `below` on its summaries); a run at grade by its summary. The run beyond an end
 * is the one the end seams to (endPlan: a run at grade is the master of the seams of a below run beside
 * it), so an end seaming to another below run is no portal. The approach's end at the portal follows
 * the chain: a below run's start meets the run before it at that run's end, its end the next run's
 * start.
 */
export function portalEndsOf(
  chunks: readonly XwChunk[],
  runs: readonly XwRunSummary[],
  belowIds: ReadonlySet<string>,
  /**
   * S7-2 (version 10): the portal ends (`<below run>:<end>`) whose approach the plan left at grade, and
   * why (compile.ts loweredApproaches' skipped). Absent: the counts and fields of version 9.
   */
  notLowered?: ReadonlyMap<string, "both-portals">,
): Underground["portals"] {
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const summaries = new Map(runs.map((r) => [r.id, r]));
  const list: Underground["portals"]["list"] = [];
  for (const r of runs.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    const isBelow = belowIds.has(r.id);
    const own = byRun.get(r.id);
    if (!isBelow || !own) continue;
    const stations = stationsOfRun(own);
    const portals = own.toSorted((a, b) => a.k - b.k).flatMap((c) => c.portals ?? []);
    for (const atStart of [true, false]) {
      const end = atStart ? r.start : r.end;
      const parent = end.parent;
      // S7-3 3.4: an end going on under the ground is no portal: its parent is a below run, or it is
      // free and another below run seams onto it there (a loop's first run).
      const here = atStart ? 0 : r.lengthM;
      const isSeamedOnto =
        end.kind === "open" &&
        runs.some(
          (o) =>
            o.id !== r.id &&
            belowIds.has(o.id) &&
            [o.start, o.end].some(
              (oe) => oe.kind === "seam" && oe.parent === r.id && Math.abs((oe.parentS ?? 0) - here) <= 0.5,
            ),
        );
      const isUnderBeyond = (parent !== undefined && belowIds.has(parent)) || isSeamedOnto;
      if (isUnderBeyond) continue;
      const station = atStart ? stations[0] : stations[stations.length - 1];
      const portal = atStart ? portals[0] : portals[portals.length - 1];
      const into = (atStart ? portal?.to : portal?.from) === "tunnel" ? "tunnel" : "cut";
      const depth = station.ground - station.z;
      const isTunnel = into === "tunnel";
      const isGroundParent = parent !== undefined && summaries.get(parent)?.ground === true;
      const approach = isGroundParent
        ? stretchOf({ run: parent, end: atStart ? "end" : "start" }, byRun.get(parent))
        : null;
      const id = `${r.id}:${atStart ? "start" : "end"}`;
      list.push({
        id,
        run: r.id,
        end: atStart ? "start" : "end",
        into,
        zM: round(station.z, 3),
        groundM: round(station.ground, 2),
        dzM: round(station.z - station.ground, 3),
        approach: approach && { run: approach.stretch.run, offM: approach.offM },
        coverShortM: isTunnel ? round(Math.max(0, TUNNEL_DEPTH_M - depth), 3) : null,
        ...loweredOf(end, parent === undefined ? undefined : byRun.get(parent)),
        ...(notLowered?.has(id) ? { notLowered: notLowered.get(id)! } : {}),
      });
    }
  }
  const shorts = list.flatMap((p) => (p.coverShortM !== null && p.coverShortM > 0 ? [p.coverShortM] : []));
  const isVersion10 = notLowered !== undefined;
  const lowered = list.filter((p) => p.lowered !== undefined);
  return {
    ends: list.length,
    coverShort: shorts.length,
    maxShortM: shorts.length === 0 ? 0 : Math.max(...shorts),
    ...(isVersion10
      ? {
          lowered: lowered.length,
          loweredCoverShort: lowered.filter((p) => p.coverShortM !== null && p.coverShortM > 0).length,
        }
      : {}),
    list,
  };
}

/**
 * S7-2: a portal end's lowered approach (its summary's XwEnd.portalAt): the stretch's length and the
 * approach's depth under the ground at the seam, from its own end station. Nothing where not lowered.
 */
function loweredOf(
  end: XwRunSummary["start"],
  approach: readonly XwChunk[] | undefined,
): { lowered?: { lengthM: number; approachDepthM: number } } {
  const isLowered = end.portalAt !== undefined && approach !== undefined;
  if (!isLowered) return {};
  const stations = stationsOfRun(approach);
  // The seam is at one of the approach's two ends: the one its run distance is nearer.
  const at = end.parentS ?? 0;
  const atStart = Math.abs(at - stations[0].s) <= Math.abs(at - stations[stations.length - 1].s);
  const p = atStart ? stations[0] : stations[stations.length - 1];
  return { lowered: { lengthM: end.portalAt!.offsetM, approachDepthM: round(p.ground - p.z, 3) } };
}

/** The written approaches' stretches (`overApproach.approaches`), in the order of their ends. */
export function approachStretchesOf(
  chunks: readonly XwChunk[],
  ends: readonly ApproachEnd[],
): ApproachStretch[] {
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  return ends.flatMap((e) => {
    const found = stretchOf(e, byRun.get(e.run));
    return found ? [found.stretch] : [];
  });
}

/**
 * Decks over the portals' approaches less than a level above them (`overApproach`): over overlap.ts
 * pairStations (the carriageways' centre lines nearer than the sum of their half widths, the other's
 * Hermite surface), the station pairs whose lower is an approach within its stretch and whose upper
 * stands more than one surface (overlap.ts SAME_SURFACE_M, deckOverlaps' rule) and less than the level
 * apart over its girder above it. Both directions of a pair count (the upper's station over the lower,
 * the lower's under the upper). Each pair keeps its largest height difference and its stations too, so
 * a pair side by side (largest under 2 m) is told from one passing over (largest 3.9–6.2 m in
 * ship/pruned) by its values, not by a threshold. Why not the allowlist's 0.14 m: it is the cap the
 * ledger accepts for pairs joined at a junction, looser than the check for the rest, and a pair S7 moves
 * to 5–8 cm would drop out of the count. Why not deckOverlaps' pairs: they keep a pair whatever stands
 * where along it, and the stretch near the portal is the point; nor only pairs not joined: a ramp
 * joining the approach still puts its deck over it where it stands apart above.
 */
export function overApproachOf(
  chunks: XwChunk[],
  stretches: readonly ApproachStretch[],
  /**
   * S7-2: the lowered approaches' stretches (violations.ts loweredStretchesOf, from the summaries'
   * XwEnd.portalAt), for `besideLowered`. Empty or absent: none, and no `besideLowered` (version 9's shape).
   */
  lowered: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>> = new Map(),
): Underground["overApproach"] {
  const approaches = {
    count: stretches.length,
    list: stretches.map((st) => ({
      id: `${st.run}:${st.end}`,
      run: st.run,
      end: st.end,
      s0: round(st.s0, 1),
      s1: round(st.s1, 1),
    })),
  };
  const byLower = new Map<string, ApproachStretch[]>();
  for (const st of stretches) byLower.set(st.run, [...(byLower.get(st.run) ?? []), st]);
  const isNearPortal = (run: string, s: number) =>
    (byLower.get(run) ?? []).some((st) => s >= st.s0 - 1e-6 && s <= st.s1 + 1e-6);
  type Pair = Underground["overApproach"]["list"][number];
  const found = new Map<string, Pair>();
  const beside = new Map<string, Pair>();
  const hasLowered = lowered.size > 0;
  const isNone = byLower.size === 0;
  if (isNone)
    return {
      approaches,
      pairs: 0,
      list: [],
      ...(hasLowered ? { besideLowered: { pairs: 0, list: [] } } : {}),
    };
  const isInLowered = (run: string, s: number) =>
    (lowered.get(run) ?? []).some(([a, b]) => s >= a - 1e-6 && s <= b + 1e-6);
  const decksOf = new Map<string, XwChunk["decks"]>();
  for (const c of chunks) decksOf.set(c.run, [...(decksOf.get(c.run) ?? []), ...c.decks]);
  const isSameAt = (lower: string, s: number, upper: string) =>
    (decksOf.get(lower) ?? []).some(
      (d) => d.with === upper && d.relation === "same" && s >= d.s0 - 1e-6 && s <= d.s1 + 1e-6,
    );
  for (const p of pairStations(chunks)) {
    // a over b (dz > 0: a is the upper) or a under b (dz < 0: a is the lower).
    const isAUpper = p.dz > 0;
    const [lower, sLower, upper] = isAUpper ? [p.b, p.sb, p.a] : [p.a, p.sa, p.b];
    const dz = Math.abs(p.dz);
    const isTooLow = dz > SAME_SURFACE_M && dz < p.levelApart;
    if (!isTooLow || !isNearPortal(lower, sLower)) continue;
    const sUpper = isAUpper ? p.sa : p.sb;
    const isBeside =
      isInLowered(lower, sLower) && isInLowered(upper, sUpper) && isSameAt(lower, sLower, upper);
    const into = isBeside ? beside : found;
    const id = `${lower}|${upper}`;
    const o: Pair = into.get(id) ?? {
      id,
      lower,
      upper,
      s0: sLower,
      s1: sLower,
      minDzM: dz,
      maxDzM: dz,
      offsetM: p.dist,
      stations: 0,
    };
    o.s0 = Math.min(o.s0, sLower);
    o.s1 = Math.max(o.s1, sLower);
    o.maxDzM = Math.max(o.maxDzM, dz);
    o.stations++;
    const isLower = dz < o.minDzM;
    if (isLower) {
      o.minDzM = dz;
      o.offsetM = p.dist;
    }
    into.set(id, o);
  }
  const listOf = (m: Map<string, Pair>) =>
    [...m.values()]
      .map((o) => ({
        ...o,
        s0: round(o.s0, 1),
        s1: round(o.s1, 1),
        minDzM: round(o.minDzM, 3),
        maxDzM: round(o.maxDzM, 3),
        offsetM: round(o.offsetM, 2),
      }))
      .toSorted((a, b) => (a.id < b.id ? -1 : 1));
  const list = listOf(found);
  const besideList = listOf(beside);
  return {
    approaches,
    pairs: list.length,
    list,
    ...(hasLowered ? { besideLowered: { pairs: besideList.length, list: besideList } } : {}),
  };
}

/** An unplanned chain as the build hands it in (compile.ts UnplannedChain). */
export type UnplannedBelow = {
  chain: string;
  cls: XwClass;
  ref: string | null;
  lengthM: number;
  belowM: number;
  inRange: boolean;
  ends: [string[], string[]];
};

/** Whether a chunk's structure is under the ground (a tunnel or cut). */
const isUnder = (st: XwChunk["structure"] | null) => st === "tunnel" || st === "cut";

/** The structure of a run's chunk holding run distance s (the first that holds it), null for none. */
function structureAt(chunks: readonly XwChunk[] | undefined, s: number): XwChunk["structure"] | null {
  const holding = (chunks ?? []).find((c) => {
    const last = c.st[c.st.length - STATION_STRIDE + ST.s];
    return s >= c.st[ST.s] - 0.011 && s <= last + 0.011;
  });
  return holding?.structure ?? null;
}

/**
 * The junctions and seams under the ground among the written runs (`joins`): a junction where the
 * child's chunk at its end or the parent's chunk at the node is a tunnel or cut, a seam between two
 * below runs (`belowIds`, as portalEndsOf). Read from the files alone, so a build without the flag
 * counts the same way (the junctions of runs at grade drawn as cuts by their height are among them).
 */
export function joinsOf(
  chunks: readonly XwChunk[],
  runs: readonly XwRunSummary[],
  belowIds: ReadonlySet<string>,
): NonNullable<Underground["joins"]> {
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const summaries = new Map(runs.map((r) => [r.id, r]));
  const list: NonNullable<Underground["joins"]>["list"] = [];
  for (const r of runs.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const atStart of [true, false]) {
      const end = atStart ? r.start : r.end;
      const isJoined = end.kind === "junction" || end.kind === "seam";
      const parentRun = end.parent === undefined ? undefined : summaries.get(end.parent);
      if (!isJoined || parentRun === undefined) continue;
      const s = atStart ? 0 : r.lengthM;
      const parentS = end.parentS ?? 0;
      const structure = structureAt(byRun.get(r.id), s);
      const parentStructure = structureAt(byRun.get(parentRun.id), parentS);
      const isCounted =
        end.kind === "junction"
          ? isUnder(structure) || isUnder(parentStructure)
          : belowIds.has(r.id) && belowIds.has(parentRun.id);
      if (!isCounted || structure === null || parentStructure === null) continue;
      const isAtEnd = parentS <= 0.011 || parentRun.lengthM - parentS <= 0.011;
      const opening = (byRun.get(parentRun.id) ?? []).some((c) =>
        (c.openings ?? []).some((o) => o.with === r.id),
      );
      list.push({
        id: `${r.id}:${atStart ? "start" : "end"}`,
        kind: end.kind as "junction" | "seam",
        parent: parentRun.id,
        parentS: round(parentS, 2),
        node: isAtEnd ? "end" : "inside",
        structure,
        parentStructure,
        opening,
      });
    }
  }
  const junctions = list.filter((j) => j.kind === "junction");
  return {
    junctions: junctions.length,
    seams: list.length - junctions.length,
    withoutOpening: junctions.filter((j) => !j.opening).length,
    list,
  };
}

/** The unplanned chains in all and those reaching the range (`unplanned`), sorted by chain id. */
export function unplannedOf(list: readonly UnplannedBelow[]): NonNullable<Underground["unplanned"]> {
  const tallyOf = (rows: readonly UnplannedBelow[]) => ({
    chains: rows.length,
    km: round(rows.reduce((n, r) => n + r.lengthM, 0) / 1000, 3),
    belowKm: round(rows.reduce((n, r) => n + r.belowM, 0) / 1000, 3),
  });
  const sorted = list.toSorted((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0));
  return {
    total: tallyOf(sorted),
    inRange: tallyOf(sorted.filter((r) => r.inRange)),
    list: sorted.map((r) => ({
      id: r.chain,
      cls: CLASS_KEY[r.cls],
      ref: r.ref,
      km: round(r.lengthM / 1000, 3),
      belowKm: round(r.belowM / 1000, 3),
      inRange: r.inRange,
      ends: r.ends,
    })),
  };
}

/** The scorecard's `underground` from the plan's deferrals, approach ends and unplanned chains, and the written files. */
export function undergroundOf(input: {
  deferred: readonly DeferredBelow[];
  approachEnds: readonly ApproachEnd[];
  unplanned: readonly UnplannedBelow[];
  chunks: XwChunk[];
  runs: readonly XwRunSummary[];
  belowIds: ReadonlySet<string>;
  /** S7-2 (version 10): the approaches the plan left at grade (compile.ts loweredApproaches' skipped). */
  notLowered?: ReadonlyArray<{ below: string; belowAtStart: boolean; reason: "both-portals" }>;
}): Underground {
  const notLowered = new Map(
    (input.notLowered ?? []).map(
      (x) => [`${x.below}:${x.belowAtStart ? "start" : "end"}`, x.reason] as const,
    ),
  );
  return {
    deferred: deferredOf(input.deferred),
    portals: portalEndsOf(input.chunks, input.runs, input.belowIds, notLowered),
    overApproach: overApproachOf(
      input.chunks,
      approachStretchesOf(input.chunks, input.approachEnds),
      loweredStretchesOf(input.runs),
    ),
    joins: joinsOf(input.chunks, input.runs, input.belowIds),
    unplanned: unplannedOf(input.unplanned),
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

/** The ids on both sides whose words (wordsOf) differ, as `<id> <a>→<b>`, sorted. */
function wordsChanged<T extends { id: string }>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
  wordsOf: (x: T) => string,
): string[] {
  const before = new Map((a ?? []).map((x) => [x.id, wordsOf(x)]));
  return (b ?? [])
    .filter((x) => before.has(x.id) && before.get(x.id) !== wordsOf(x))
    .map((x) => `${x.id} ${before.get(x.id)}→${wordsOf(x)}`)
    .toSorted();
}

/**
 * What two scorecards' `underground` say apart beyond their numbers (scripts/compareExpresswayReports.ts):
 * the deferred runs, portal ends, approaches and over-approach pairs on one side only, and the runs deferred on
 * both for another reason or range, the portal ends with another structure inside or approach run. `absent` names the side without the section (a report before version 7),
 * whose comparison is then the section added or removed as a whole. Why apart from the numbered rows:
 * a reason is a word, and a run deferred for another reason changes no number of its own.
 */
export function undergroundChanges(
  a: Underground | undefined,
  b: Underground | undefined,
): {
  absent: "a" | "b" | null;
  deferred: { added: string[]; removed: string[]; reasonChanged: string[]; inRangeChanged: string[] };
  portals: { added: string[]; removed: string[]; changed: string[] };
  overApproach: { added: string[]; removed: string[] };
  besideLowered: { added: string[]; removed: string[] };
  approaches: { added: string[]; removed: string[] };
  joins: { added: string[]; removed: string[]; changed: string[] };
  unplanned: { added: string[]; removed: string[]; changed: string[] };
} {
  const reasonA = new Map((a?.deferred.list ?? []).map((d) => [d.id, d.reason]));
  const reasonChanged = (b?.deferred.list ?? [])
    .filter((d) => reasonA.has(d.id) && reasonA.get(d.id) !== d.reason)
    .map((d) => `${d.id} ${reasonA.get(d.id)}→${d.reason}`)
    .toSorted();
  const inRangeA = new Map((a?.deferred.list ?? []).map((d) => [d.id, d.inRange]));
  const inRangeChanged = (b?.deferred.list ?? [])
    .filter((d) => inRangeA.has(d.id) && inRangeA.get(d.id) !== d.inRange)
    .map((d) => `${d.id} inRange ${inRangeA.get(d.id)}→${d.inRange}`)
    .toSorted();
  // A portal end whose structure inside or approach run changed (words, not numbers: review optional 5).
  const wordsOf = (p: Underground["portals"]["list"][number]) => `${p.into}/${p.approach?.run ?? "-"}`;
  const portalA = new Map((a?.portals.list ?? []).map((p) => [p.id, wordsOf(p)]));
  const portalChanged = (b?.portals.list ?? [])
    .filter((p) => portalA.has(p.id) && portalA.get(p.id) !== wordsOf(p))
    .map((p) => `${p.id} ${portalA.get(p.id)}→${wordsOf(p)}`)
    .toSorted();
  const joinWords = (j: NonNullable<Underground["joins"]>["list"][number]) =>
    `${j.kind}/${j.parent}/${j.node}/${j.structure}/${j.parentStructure}/${j.opening ? "open" : "shut"}`;
  const unplannedWords = (u: NonNullable<Underground["unplanned"]>["list"][number]) =>
    `${u.inRange ? "in" : "out"}/${u.ends.map((e) => e.join(",")).join("|")}`;
  const absent = a === undefined && b !== undefined ? "a" : b === undefined && a !== undefined ? "b" : null;
  return {
    absent,
    deferred: { ...sideBy(idsOf(a?.deferred.list), idsOf(b?.deferred.list)), reasonChanged, inRangeChanged },
    portals: { ...sideBy(idsOf(a?.portals.list), idsOf(b?.portals.list)), changed: portalChanged },
    overApproach: sideBy(idsOf(a?.overApproach.list), idsOf(b?.overApproach.list)),
    besideLowered: sideBy(
      idsOf(a?.overApproach.besideLowered?.list),
      idsOf(b?.overApproach.besideLowered?.list),
    ),
    approaches: sideBy(idsOf(a?.overApproach.approaches.list), idsOf(b?.overApproach.approaches.list)),
    joins: {
      ...sideBy(idsOf(a?.joins?.list), idsOf(b?.joins?.list)),
      changed: wordsChanged(a?.joins?.list, b?.joins?.list, joinWords),
    },
    unplanned: {
      ...sideBy(idsOf(a?.unplanned?.list), idsOf(b?.unplanned?.list)),
      changed: wordsChanged(a?.unplanned?.list, b?.unplanned?.list, unplannedWords),
    },
  };
}
