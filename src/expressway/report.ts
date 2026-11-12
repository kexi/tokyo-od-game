import { z } from "zod";
import type { XwChunk, XwClass, XwClosed, XwDiagnostic, XwRunSummary } from "./format";
import { classifyOverlap, isJoined, OVERLAP_CLASSES, type OverlapClass, overlapPair } from "./overlapClass";
import { hermite, ST } from "./profile";
import { CROSS_STRIDE, STATION_STRIDE } from "./format";
import { PROPERTIES, type Property, type Violations } from "./violations";
import { type District, DISTRICTS } from "./districts";
import type { LedgerSummary } from "./ledger";
import { GIRDER_DEPTH } from "./assumptions";
import { lowViaductStretches, openGroundStretches } from "./heightStructures";

/**
 * The scorecard of one expressway build (P2.7-1, `scripts/expressway.ts --report`): what the later
 * stages (S2〜S7, R1〜R3 in knowledge/expressway-generation.md「P2.7-1」) are judged by, by machine.
 * Pure: the build script hands it the plan's runs, the result, the tile sizes and the timings, and
 * writes the report outside the data folder. Everything but `timings` is byte-stable from one build
 * to the next (`--baseline` writes the report without them: tests/fixtures/expresswayScorecard.ship.json).
 */

const count = z.number().int().nonnegative();
const km = z.number().nonnegative();
/** A length or height in metres (non-negative). */
const m = z.number().nonnegative();
const tally = z.strictObject({ runs: count, km });
const byClass = z.strictObject({ main: tally, ramp: tally, street: tally });
const spread = z.strictObject({ total: count, median: count, p90: count, max: count });
/** A spread of lengths or depths in metres (P2.7-6 structures). */
const metres = z.strictObject({ median: km, p90: km, max: km });
/** The runs at grade's inside off a line (S6 PR 7a, N2): per run medians and the stations' spread. */
const innerTally = {
  runs: count,
  km,
  over03: count,
  over075: count,
  above: count,
  below: count,
  p5M: z.number(),
  p50M: z.number(),
  p95M: z.number(),
};
/** The companions' station pairs (S6 PR 3): how many, the km along the first, |Δz| as solved. */
const companionTally = {
  pairs: count,
  stations: count,
  km,
  dz: z.strictObject({ p50M: km, p90M: km, maxM: km, overDz: count }),
};
const extentTally = z.strictObject({ inKm: km, outKm: km, operatedKm: km, otherKm: km });
const cls = z.enum(["expressway", "ramp", "street"]);

/**
 * 3 (P2.7-2): `partition`, how the needed runs were split and solved. 4 (P2.7-3): `objective` and,
 * in `tracking`, the stretches nothing forces (`free`, `forcedKm`), the deck's height over the
 * ground and the main lines below ground. 5 (P2.7-3 review): `tracking.junction` (the free stretches
 * near a junction, apart), the short waves' regression slope in `free` and `junction`, and the km of
 * viaduct over 15 and 20 m above the ground (`height.over15Km` / `over20Km`). Reports of versions
 * 2–4 (without them) still parse, so a scorecard can be compared with one written before. 6 (P2.7-4):
 * `size.record` and `size.ledger` (report.json and ledger.json of the data folder; meta.json is the
 * v6 index), `districts` (runs, km, written and closed per district, districts.ts) and `ledger` (the
 * ledger's summary, null without one). Version 5 reports still parse.
 */
export const REPORT_VERSION = 6;

const blockSize = { runs: count, pieces: count, variables: count };
const fileSize = z.strictObject({ raw: count, gzip: count });

/**
 * Short-wave statistics over a set of tracked stretches: km, correlation and σ of the deck's short
 * waves, their regression slope on the ground's (version 5: metres of deck per metre of ground; a
 * report of version 4 has none), reversals per km.
 */
const stretchTally = z.strictObject({
  km,
  shortWaveCorrelation: z.number().nullable(),
  shortWaveStdM: z.number().nonnegative().nullable(),
  shortWaveSlope: z.number().nullable().optional(),
  reversalsPerKm: z.number().nonnegative().nullable(),
});

export const ReportSchema = z.strictObject({
  version: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(REPORT_VERSION)]),
  label: z.string(),
  range: z.string(),
  below: z.enum(["pruned", "all"]),
  /**
   * The vertical objective (compile.ts Objective) and v2's weights (null for v1). Absent from a
   * report before version 4 (v1 then).
   */
  objective: z
    .strictObject({
      kind: z.enum(["v1", "v2"]),
      gradeChange: z.number().nullable(),
      reachM: z.strictObject({ viaduct: z.number(), below: z.number() }).nullable(),
      targetScale: z.number().nullable(),
    })
    .optional(),
  extract: z.strictObject({
    url: z.string(),
    timestamp: z.string().nullable(),
    expected: z.string(),
    accepted: z.boolean(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  plan: z.strictObject({
    chains: count,
    runs: count,
    components: count,
    belowRuns: count,
    belowDeferred: count,
    /**
     * Deck pairs among the needed runs not held a level apart (compile.ts markSharedTouchdowns): the
     * station pairs in all, and per run pair (a < b) with its component. Absent in reports before
     * P2.7-3a (the version is not raised for it).
     */
    untied: z
      .strictObject({
        stations: count,
        pairs: z.array(
          z.strictObject({ a: z.string(), b: z.string(), component: z.string(), stations: count }),
        ),
      })
      .optional(),
  }),
  /** The runs of the range: planned (wanted), written to the tiles, closed (P2.6 `closed`). */
  runs: z.strictObject({ planned: byClass, written: byClass, closed: byClass }),
  /**
   * What the range is: its run ids (sorted), how far the planned runs reach outside the 23 wards and
   * onto other operators' ways (scope.ts scopeExtent, on the OSM line), and the ramps --range ship
   * leaves out for lying wholly outside the wards (null for other ranges; extent is null only where
   * the build had no wards to measure against).
   */
  scope: z.strictObject({
    wanted: z.array(z.string()),
    extent: z.strictObject({ main: extentTally, ramp: extentTally, street: extentTally }).nullable(),
    rampsOutside: tally.nullable(),
    /** Written runs whose junction or seam parent is not written (they would hang in the air). */
    dangling: z.array(z.strictObject({ run: z.string(), parent: z.string() })),
    /** Structure decks meta lists without a written run carrying them, or carried but not listed. */
    deckMismatch: z.array(z.string()),
  }),
  /**
   * Closures by their roots: a root is a closed run that is not closed for its parent
   * (`vertical_unsolved`), its dragged runs those closed through it (`parent_unsolved`, followed
   * to the root). `inRange` false: the root is a run of the components the range needs, not of the
   * range itself.
   */
  closures: z.strictObject({
    roots: count,
    dragged: tally,
    draggedByClass: byClass,
    list: z.array(
      z.strictObject({
        run: z.string(),
        /** Null for a root the plan does not list (never expected: a root is a needed run). */
        cls: cls.nullable(),
        lengthKm: km,
        inRange: z.boolean(),
        dragged: tally,
      }),
    ),
  }),
  /** Diagnostics on the runs of the range, by kind: allowed (in the allowlist) and not. */
  diagnostics: z.record(z.string(), z.strictObject({ allowed: count, notAllowed: count })),
  overlaps: z.record(
    z.enum(OVERLAP_CLASSES as [OverlapClass, ...OverlapClass[]]),
    z.strictObject({
      pairs: count,
      stations: count,
      notAllowedPairs: count,
      notAllowedStations: count,
    }),
  ),
  /** Every deck_overlap pair of the range: its kind, whether the two meet at a junction, its size. */
  overlapPairs: z.array(
    z.strictObject({
      a: z.string(),
      b: z.string(),
      kind: z.enum(OVERLAP_CLASSES as [OverlapClass, ...OverlapClass[]]),
      joined: z.boolean(),
      stations: count,
      minDzM: z.number().nonnegative(),
      maxDzM: z.number().nonnegative(),
      allowed: z.boolean(),
    }),
  ),
  /**
   * The data test's properties over the files (violations.ts): count and the first few of each. T13
   * (P2.7-6) is absent from a scorecard before it.
   */
  violations: z.strictObject(
    Object.fromEntries(
      PROPERTIES.map((p) => {
        const entry = z.strictObject({ count, first: z.array(z.string()) });
        return [p, p === "T13" ? entry.optional() : entry];
      }),
    ) as Record<Property, z.ZodObject<{ count: typeof count; first: z.ZodArray<z.ZodString> }>>,
  ),
  /**
   * The runs at grade (S6 PR 2, `--ground compile`): written (runs, km), the main line's holes left
   * (compile.ts mainLineHoles: elsewhere, beside an unwritten below run, at a chain's end), the roads
   * that cross them (blocked), and how their main lines of 800 m or more follow the ground (trackingOf
   * over them). In every height build (with skip no run at grade is written, so the holes compare);
   * absent from a build by the tags.
   */
  ground: z
    .strictObject({
      runs: count,
      km,
      holes: z.strictObject({ count, km }),
      besideBelow: z.strictObject({ count, km }),
      atChainEnd: z.strictObject({ count, km }),
      outsideRange: z.strictObject({ count, km }),
      crossingsBlocked: count,
      /**
       * Of them, those whose s (the diagnostic's, in whole metres) is more than 1 m from both ends of the
       * run: crossed mid-run, each a ground-crossing case listed in the ledger (S6 PR 7a).
       */
      crossingsBlockedMiddle: count,
      belowUnwritten: z.strictObject({ count, km }),
      /** The stretches at grade left out as the open part between two tunnels (Plan.betweenTunnels). */
      betweenTunnels: z.array(z.string()),
      /** How far the runs at grade stand off the ground under them: |z − ground| at their stations. */
      /** The runs at grade's target weight and band as built (S6 PR 7a); absent before it. */
      settings: z.strictObject({ targetScale: z.number().positive(), bandM: m }).optional(),
      offGround: z.strictObject({ p95M: m, maxM: m, over3mRuns: count }),
      /**
       * The ends the viaducts and below runs seam onto (S6 PR 3): how far the run at grade stands off
       * the band's centre there (the ground's median within 150 m of the end), the ends past the band
       * (HEIGHT_STRUCTURES.ground.bandM) and the worst.
       * Absent in reports before PR 3.
       */
      openEnds: z
        .strictObject({
          count,
          overBand: count,
          maxM: m,
          /**
           * S6 PR 7a (4.3): the ends past HEIGHT_STRUCTURES.ground.approachMaxM (the ledger's approach
           * rule), by what is beyond the end: the child climbs to a viaduct (the road above the line) or
           * is low, comes down to a portal or stands over it (a below child below or above the line),
           * or no child is written. Absent before PR 7a.
           */
          overApproach: count.optional(),
          byCause: z
            .strictObject({
              climbToViaduct: count,
              downToPortal: count,
              overPortal: count,
              childLow: count,
              childUnwritten: count,
            })
            .optional(),
        })
        .optional(),
      /**
       * N2 (S6 PR 7a): the runs at grade with 100 m or more inside after 100 m off each end, each run's
       * median of (road − target line) there: the runs and km, how many past 0.3 and 0.75 m (and of
       * those above and below), and the stations' p5, p50 and p95; `vsGround` the same of (road − the
       * stations' ground). Absent in reports before PR 7a.
       */
      inner: z.strictObject({ ...innerTally, vsGround: z.strictObject(innerTally) }).optional(),
      tracking: z.strictObject({
        runs: count,
        km,
        correlation: z.number().nullable(),
        shortWaveCorrelation: z.number().nullable(),
        shortWaveStdM: z.number().nonnegative().nullable(),
        reversalsPerKm: z.number().nonnegative().nullable(),
      }),
    })
    .optional(),
  /**
   * Main lines held to one height beside each other (S6 PR 3, `--companions on`, compile.ts
   * findCompanions): the run pairs and station pairs among the runs written, the km along the first,
   * and |Δz| at those stations as solved (p50, p90, max, and the station pairs past COMPANIONS.dzM); the
   * station pairs themselves go to <report>.companions.json beside the scorecard ([a, sa, b, sb, held]).
   * The whole beside each other first, then `held`: those with a row (not in a tapered end).
   * Absent without the flag.
   */
  companions: z
    .strictObject({
      weight: z.number().positive(),
      ...companionTally,
      held: z.strictObject(companionTally),
    })
    .optional(),
  /**
   * A height build's structures (P2.7-6 PR 1, heightStructures.ts): the embankment and cut stretches of
   * the viaduct-tagged runs written (count, km, the spread of their lengths and, for a cut, depths),
   * the chunks with a thinner girder, and the km per district. Absent from a build by the tags.
   */
  structures: z
    .strictObject({
      embankment: z.strictObject({ stretches: count, km, lengthM: metres }),
      cut: z.strictObject({ stretches: count, km, lengthM: metres, depthM: metres }),
      thinGirder: z.strictObject({ chunks: count, km, minM: z.number().nonnegative().nullable() }),
      /** Viaducts under the viaduct's height kept in the air (review W3, the ledger's low-viaduct). */
      lowViaduct: z.strictObject({ stretches: count, km }).optional(),
      byDistrict: z.record(z.string(), z.strictObject({ embankmentKm: km, cutKm: km, thinGirders: count })),
      /**
       * What S6 PR 7a's rules changed (compile.ts HeightRuleTally): crossings' windows spanned as viaduct
       * over an embankment or cut (R3), same-surface stations apart past the merge (R5), embankments
       * off a non-ground end drawn as viaducts (R4). Absent before them.
       */
      rules: z.strictObject({ spanned: count, sameApart: count, unanchored: count }).optional(),
    })
    .optional(),
  /** How the elevated main lines follow the ground (trackingOf). */
  tracking: z.strictObject({
    runs: count,
    km,
    correlation: z.number().nullable(),
    /** Least-squares slope of the deck's centred height on the ground's (1: rises metre for metre). */
    slope: z.number().nullable(),
    shortWaveCorrelation: z.number().nullable(),
    shortWaveStdM: z.number().nonnegative().nullable(),
    reversalsPerKm: z.number().nonnegative().nullable(),
    /**
     * The same three over the stretches nothing forces (freeStretches): more than TRACK_FREE_M from
     * the run's ends, from a deck over or under another and from a crossing whose top stands
     * TRACK_FORCING_RISE_M over the ground, the reversals counted per free stretch. Absent before
     * version 4, as are the fields after it.
     */
    free: stretchTally.optional(),
    /**
     * The free stretches within TRACK_JUNCTION_M of a junction on the run (where another written run
     * leaves or joins it), apart: they stay in `free` too (P2.7-3 review, the coordinator's call: the
     * ramp's C¹ and its nose bend the main line there, which the definition of forcing leaves free).
     */
    junction: stretchTally.optional(),
    /** The tracked km that are forced (the rest of `km`). */
    forcedKm: km.optional(),
    /** Deck less the ground at the tracked samples: median and 95th percentile (nearest rank). */
    height: z
      .strictObject({
        medianM: z.number().nullable(),
        p95M: z.number().nullable(),
        /** Version 5: km of every written run's viaduct chunks standing over 15 / 20 m above the ground. */
        over15Km: km.optional(),
        over20Km: km.optional(),
      })
      .optional(),
    /** The main lines below ground (belowTrackingOf). */
    below: z
      .strictObject({
        runs: count,
        km,
        shortWaveStdM: z.number().nonnegative().nullable(),
        reversalsPerKm: z.number().nonnegative().nullable(),
      })
      .optional(),
  }),
  size: z.strictObject({
    tiles: count,
    raw: spread,
    gzip: spread,
    meta: z.strictObject({ raw: count, gzip: count, byField: z.record(z.string(), count) }),
    /** report.json of the data folder (v6; absent before). */
    record: fileSize.optional(),
    /** ledger.json of the data folder as the build kept it (null: none there yet; absent before v6). */
    ledger: fileSize.nullable().optional(),
  }),
  solver: z.strictObject({
    components: count,
    largestRuns: count,
    largestVariables: count,
    solves: count,
    iterations: count,
    unconverged: count,
    /** Solves solved again after a first try that did not converge (P2.7-5; the version is not raised, absent before). */
    retried: count.optional(),
  }),
  /**
   * How the needed runs were split (P2.7-2): `components` (each component one block, no anchor) or
   * `blocks` (main lines cut at anchors, blocks.ts) with k and the least quiet margin, the anchors
   * (run, run distance, their Q, the route solution's elevation and grade, the blocks either side),
   * the pieces and blocks solved, the largest block, the route solutions, the anchors with a
   * problem of their route solution within Q, and every block's size and solution hash (SHA-256 of
   * compile.ts canonicalOf). Absent from a version-2 report.
   */
  partition: z
    .strictObject({
      mode: z.enum(["components", "blocks"]),
      quietFactor: z.number().nullable(),
      quietMinM: z.number().nullable(),
      anchorCount: count,
      anchors: z.array(
        z.strictObject({
          run: z.string(),
          s: z.number(),
          q: z.number(),
          z: z.number(),
          grade: z.number(),
          blocks: z.tuple([z.string(), z.string()]),
        }),
      ),
      pieces: count,
      neededBlocks: count,
      largest: z.strictObject({ id: z.string(), ...blockSize }).nullable(),
      routeSolves: count,
      anchorsNearProblems: count,
      /** The largest step between the two pieces at an anchor (I3; 0 by construction). */
      joins: z.strictObject({
        dz: z.number().nonnegative(),
        dGrade: z.number().nonnegative(),
        dBank: z.number().nonnegative(),
      }),
      blocks: z.array(
        z.strictObject({ id: z.string(), ...blockSize, hash: z.string().regex(/^[0-9a-f]{64}$/) }),
      ),
    })
    .optional(),
  /**
   * Per district (districts.ts, provisional; version 6): the runs and km planned for the range,
   * written to the tiles and closed. A planned run that is not written takes its ref and position
   * from the plan (it has no chunks).
   */
  districts: z
    .record(z.enum(DISTRICTS), z.strictObject({ planned: tally, written: tally, closed: tally }))
    .optional(),
  /**
   * The summary (ledger.ts LedgerSummary) of the ledger the build decided `allowed` with (the
   * folder's as kept, or --ledger), null without one (version 6).
   */
  ledger: z
    .strictObject({
      cases: z.record(z.string(), z.record(z.string(), z.record(z.string(), count))),
      open: count,
      withoutQa: count,
      seamProbes: count,
      rules: z.record(z.string(), count),
      /** The km over 15 and 20 m per district (P2.7-5; absent from a ledger before it). */
      heightKm: z.record(z.string(), z.strictObject({ over15Km: km, over20Km: km })).optional(),
    })
    .nullable()
    .optional(),
  /** Wall-clock times (the only part that differs between two builds of the same input). */
  timings: z.strictObject({ qpMs: count, stagesMs: z.record(z.string(), count) }).optional(),
});

export type Report = z.infer<typeof ReportSchema>;

/** A run the plan made for the range or for the components it needs. */
export type PlannedRun = { id: string; cls: XwClass; lengthM: number; below: boolean; wanted: boolean };

export type ReportInput = {
  label: string;
  range: string;
  below: "pruned" | "all";
  /** The vertical objective (compile.ts Objective); v1 when absent. */
  objective?:
    | { kind: "v1" }
    | { kind: "v2"; gradeChange: number; reachM: { viaduct: number; below: number }; targetScale: number };
  extract: Report["extract"];
  plan: Report["plan"];
  planned: PlannedRun[];
  extent: Report["scope"]["extent"];
  rampsOutside: Report["scope"]["rampsOutside"];
  violations: Violations;
  /** The decks meta.json's `structures` lists. */
  structureDecks: string[];
  runs: XwRunSummary[];
  closed: XwClosed[];
  /** All the build's diagnostics (counted over the runs of the range only). */
  diagnostics: XwDiagnostic[];
  chunks: XwChunk[];
  tiles: Array<{ bytes: number; gzipBytes: number }>;
  meta: { raw: number; gzip: number; byField: Record<string, number> };
  record: { raw: number; gzip: number };
  ledger: { raw: number; gzip: number } | null;
  solver: Report["solver"] & { qpMs: number };
  /** The partition without what buildReport derives (the anchor count, the largest block). */
  partition: Omit<NonNullable<Report["partition"]>, "anchorCount" | "largest">;
  stagesMs: Record<string, number>;
  /** Each planned run's district (districts.ts). */
  districts: ReadonlyMap<string, District>;
  /** The summary of the ledger that decided `allowed`, null without one. */
  ledgerSummary: LedgerSummary | null;
  /** Leave the timings out (the baseline fixture). */
  withoutTimings?: boolean;
  /** A height build (`--structures height`, P2.7-6): the scorecard's `structures`. */
  heightStructures?: boolean;
  /** The height build's rule tally (CompileResult.heightRules), into `structures.rules`. */
  heightRules?: { spanned: number; sameApart: number; unanchored: number };
  /** The runs at grade (S6 PR 2): Report["ground"], made by the build script; null or absent without them. */
  ground?: NonNullable<Report["ground"]> | null;
  /** The companions (S6 PR 3): Report["companions"], made by the build script; null or absent without them. */
  companions?: NonNullable<Report["companions"]> | null;
};

const round = (v: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

const CLASS_KEY = { expressway: "main", ramp: "ramp", street: "street" } as const;

function tallyBy(list: Array<{ cls: XwClass; lengthM: number }>): Report["runs"]["planned"] {
  const out = {
    main: { runs: 0, km: 0 },
    ramp: { runs: 0, km: 0 },
    street: { runs: 0, km: 0 },
  };
  for (const r of list) {
    const t = out[CLASS_KEY[r.cls]];
    t.runs++;
    t.km += r.lengthM / 1000;
  }
  for (const t of Object.values(out)) t.km = round(t.km, 3);
  return out;
}

/** Nearest-rank percentile of sorted integers. */
function percentile(sorted: number[], p: number): number {
  const isEmpty = sorted.length === 0;
  if (isEmpty) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** Median, p90 and largest of metres (0 when there are none), to the centimetre. */
function metresOf(values: number[]): { median: number; p90: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    median: r(percentile(sorted, 0.5)),
    p90: r(percentile(sorted, 0.9)),
    max: r(sorted[sorted.length - 1] ?? 0),
  };
}

/** A height build's structures (P2.7-6 PR 1) over the written chunks: Report["structures"]. */
export function structuresOf(
  chunks: readonly XwChunk[],
  districts: ReadonlyMap<string, District>,
  runs: readonly XwRunSummary[] = [],
): NonNullable<Report["structures"]> {
  const below = new Set(runs.filter((r) => r.below === true).map((r) => r.id));
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const stretches = [...byRun.keys()].sort().flatMap((run) =>
    openGroundStretches(
      byRun.get(run)!.toSorted((a, b) => a.k - b.k),
      below.has(run),
    ),
  );
  const lows = [...byRun.keys()].sort().flatMap((run) =>
    lowViaductStretches(
      byRun.get(run)!.toSorted((a, b) => a.k - b.k),
      below.has(run),
    ),
  );
  const embankments = stretches.filter((h) => h.structure === "embankment");
  const cuts = stretches.filter((h) => h.structure === "cut");
  const kmOf = (list: typeof stretches) => Math.round(list.reduce((n, h) => n + h.lengthM, 0)) / 1000;
  const thin = chunks.filter(
    (c) => c.structure === "viaduct" && c.over === null && c.girder > 0 && c.girder < GIRDER_DEPTH.value,
  );
  const lengthOfChunk = (c: XwChunk) => c.st[c.st.length - STATION_STRIDE] - c.st[0];
  const byDistrict: NonNullable<Report["structures"]>["byDistrict"] = {};
  const tallyOf = (run: string) => {
    const d = districts.get(run) ?? "outside";
    byDistrict[d] ??= { embankmentKm: 0, cutKm: 0, thinGirders: 0 };
    return byDistrict[d];
  };
  for (const h of embankments) tallyOf(h.run).embankmentKm += h.lengthM / 1000;
  for (const h of cuts) tallyOf(h.run).cutKm += h.lengthM / 1000;
  for (const c of thin) tallyOf(c.run).thinGirders++;
  for (const t of Object.values(byDistrict)) {
    t.embankmentKm = round(t.embankmentKm, 3);
    t.cutKm = round(t.cutKm, 3);
  }
  return {
    embankment: {
      stretches: embankments.length,
      km: kmOf(embankments),
      lengthM: metresOf(embankments.map((h) => h.lengthM)),
    },
    cut: {
      stretches: cuts.length,
      km: kmOf(cuts),
      lengthM: metresOf(cuts.map((h) => h.lengthM)),
      depthM: metresOf(cuts.map((h) => h.depthM)),
    },
    lowViaduct: { stretches: lows.length, km: Math.round(lows.reduce((n, h) => n + h.lengthM, 0)) / 1000 },
    thinGirder: {
      chunks: thin.length,
      km: Math.round(thin.reduce((n, c) => n + lengthOfChunk(c), 0)) / 1000,
      minM: thin.length > 0 ? Math.min(...thin.map((c) => c.girder)) : null,
    },
    byDistrict: Object.fromEntries(Object.entries(byDistrict).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

export function spreadOf(values: number[]): Report["size"]["raw"] {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    total: sorted.reduce((n, v) => n + v, 0),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** The closures traced to their roots (a run closed for its parent, followed up to one that is not). */
export function closuresOf(
  closed: XwClosed[],
  diagnostics: XwDiagnostic[],
  planned: PlannedRun[],
): Report["closures"] {
  const parentOf = new Map<string, string>();
  for (const d of diagnostics) {
    const isOrphan = d.kind === "parent_unsolved";
    const parent = isOrphan ? /^parent (\S+)/.exec(d.detail)?.[1] : undefined;
    const isFirst = parent !== undefined && !parentOf.has(d.run);
    if (isFirst) parentOf.set(d.run, parent);
  }
  const runOf = new Map(planned.map((p) => [p.id, p]));
  const rootOf = (id: string): string => {
    const seen = new Set<string>();
    let cur = id;
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
    }
    return cur;
  };
  const roots = new Map<string, { runs: number; km: number }>();
  const draggedRuns: Array<{ cls: XwClass; lengthM: number }> = [];
  for (const c of closed) {
    const isDragged = c.reason === "parent_unsolved";
    const root = isDragged ? rootOf(c.run) : c.run;
    const t = roots.get(root) ?? { runs: 0, km: 0 };
    if (isDragged) {
      const lengthM = runOf.get(c.run)?.lengthM ?? 0;
      t.runs++;
      t.km += lengthM / 1000;
      draggedRuns.push({ cls: c.cls, lengthM });
    }
    roots.set(root, t);
  }
  const list = [...roots.entries()].map(([run, t]) => {
    const p = runOf.get(run);
    return {
      run,
      cls: p?.cls ?? null,
      lengthKm: round((p?.lengthM ?? 0) / 1000, 3),
      inRange: p?.wanted ?? false,
      dragged: { runs: t.runs, km: round(t.km, 3) },
    };
  });
  list.sort((a, b) => b.dragged.km - a.dragged.km || (a.run < b.run ? -1 : 1));
  const dragged = list.reduce((n, r) => ({ runs: n.runs + r.dragged.runs, km: n.km + r.dragged.km }), {
    runs: 0,
    km: 0,
  });
  return {
    roots: list.length,
    dragged: { runs: dragged.runs, km: round(dragged.km, 3) },
    draggedByClass: tallyBy(draggedRuns),
    list,
  };
}

/** Written runs hanging from a run that is not written, sorted. */
export function danglingOf(runs: XwRunSummary[]): Report["scope"]["dangling"] {
  const written = new Set(runs.map((r) => r.id));
  const out: Report["scope"]["dangling"] = [];
  for (const r of runs)
    for (const end of [r.start, r.end]) {
      const isJoined = end.kind === "junction" || end.kind === "seam";
      const isMissing = isJoined && end.parent !== undefined && !written.has(end.parent);
      if (isMissing) out.push({ run: r.id, parent: end.parent! });
    }
  return out.sort((a, b) => (a.run < b.run ? -1 : a.run > b.run ? 1 : a.parent < b.parent ? -1 : 1));
}

/** Decks listed and not carried, or carried and not listed. */
export function deckMismatchOf(runs: XwRunSummary[], listed: string[]): string[] {
  const carried = new Set(runs.flatMap((r) => (r.structure ? [r.structure.deck] : [])));
  const named = new Set(listed);
  const out = [...named].filter((d) => !carried.has(d)).map((d) => `listed, not carried: ${d}`);
  out.push(...[...carried].filter((d) => !named.has(d)).map((d) => `carried, not listed: ${d}`));
  return out.sort();
}

export function diagnosticsOf(diagnostics: XwDiagnostic[], inRange: Set<string>): Report["diagnostics"] {
  const out: Report["diagnostics"] = {};
  for (const d of diagnostics) {
    if (!inRange.has(d.run)) continue;
    const t = out[d.kind] ?? { allowed: 0, notAllowed: 0 };
    if (d.allowed) t.allowed++;
    else t.notAllowed++;
    out[d.kind] = t;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The deck_overlap pairs of the diagnostics with their kind (overlapClass.ts) and whether joined. */
export function overlapPairsOf(diagnostics: XwDiagnostic[], runs: XwRunSummary[]): Report["overlapPairs"] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const out: Report["overlapPairs"] = [];
  for (const d of diagnostics) {
    const pair = overlapPair(d);
    if (!pair) continue;
    const a = byId.get(pair.a);
    const b = byId.get(pair.b);
    const isWritten = a !== undefined && b !== undefined;
    const joined = isWritten && isJoined(a, b);
    const kind = isWritten ? classifyOverlap(pair, a.cls, b.cls, joined) : "other";
    out.push({ ...pair, kind, joined });
  }
  return out.sort((p, q) => (p.a + "|" + p.b < q.a + "|" + q.b ? -1 : 1));
}

/** The deck_overlap pairs by their kind (overlapClass.ts), from the diagnostics and the runs written. */
export function overlapsOf(diagnostics: XwDiagnostic[], runs: XwRunSummary[]): Report["overlaps"] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const out = Object.fromEntries(
    OVERLAP_CLASSES.map((c) => [c, { pairs: 0, stations: 0, notAllowedPairs: 0, notAllowedStations: 0 }]),
  ) as Report["overlaps"];
  for (const d of diagnostics) {
    const pair = overlapPair(d);
    if (!pair) continue;
    const a = byId.get(pair.a);
    const b = byId.get(pair.b);
    const isWritten = a !== undefined && b !== undefined;
    const cls = isWritten ? classifyOverlap(pair, a.cls, b.cls, isJoined(a, b)) : "other";
    const t = out[cls];
    t.pairs++;
    t.stations += pair.stations;
    if (pair.allowed) continue;
    t.notAllowedPairs++;
    t.notAllowedStations += pair.stations;
  }
  return out;
}

/** Resampling step, the ends left out, the moving average and the reversal hysteresis (P2.7-1). */
export const TRACK_STEP_M = 10;
export const TRACK_END_M = 300;
export const TRACK_WINDOW_M = 500;
export const TRACK_HYSTERESIS = 0.002;
/** Runs shorter than this keep too little after the ends are left out to say anything. */
export const TRACK_MIN_RUN_M = 2 * TRACK_END_M + 200;
/** A sample this near (run distance) to what forces the deck is forced (P2.7-3). */
export const TRACK_FREE_M = 300;
/** A crossing forces the deck where its top stands this much over the ground there (a deck below). */
export const TRACK_FORCING_RISE_M = 2;
/** A free sample this near (run distance) to a junction on its run counts in `junction` too. */
export const TRACK_JUNCTION_M = 300;

type Sample = { z: number; grade: number; ground: number };

/** A run's surface every TRACK_STEP_M from its stations (Hermite z and grade, ground linear). */
function resample(st: number[]): Array<Sample & { s: number }> {
  const n = st.length / STATION_STRIDE;
  const at = (i: number, k: number) => st[i * STATION_STRIDE + k];
  const length = at(n - 1, ST.s) - at(0, ST.s);
  const out: Array<Sample & { s: number }> = [];
  let i = 0;
  for (let s = at(0, ST.s); s <= at(0, ST.s) + length + 1e-9; s += TRACK_STEP_M) {
    while (i < n - 2 && at(i + 1, ST.s) < s) i++;
    const s0 = at(i, ST.s);
    const s1 = at(i + 1, ST.s);
    const p = hermite(s0, at(i, ST.z), at(i, ST.grade), s1, at(i + 1, ST.z), at(i + 1, ST.grade), s);
    const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
    const ground = at(i, ST.ground) + (at(i + 1, ST.ground) - at(i, ST.ground)) * t;
    out.push({ s, z: p.z, grade: p.grade, ground });
  }
  return out;
}

/**
 * What forces a run's deck, as run-distance intervals, from its tiles alone (P2.7-3): its two ends,
 * its deck stretches over or under another run (`above` / `below`; one surface with another,
 * `same`, does not force a height), and its crossings whose top stands TRACK_FORCING_RISE_M or more
 * over the ground there (a deck below: a road at ground needs only the floor the open ground asks
 * for anyway). Why from the tiles and not the compiler's couplings: the scorecard reads the output
 * only, so a report says the same of the same files whoever built them.
 */
export function forcingOf(list: XwChunk[]): Array<[number, number]> {
  const st: number[] = [];
  for (const c of list) st.push(...(st.length === 0 ? c.st : c.st.slice(STATION_STRIDE)));
  const n = st.length / STATION_STRIDE;
  const at = (i: number, k: number) => st[i * STATION_STRIDE + k];
  const groundAt = (s: number) => {
    let i = 0;
    while (i < n - 2 && at(i + 1, ST.s) < s) i++;
    const s0 = at(i, ST.s);
    const s1 = at(i + 1, ST.s);
    const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
    return at(i, ST.ground) + (at(i + 1, ST.ground) - at(i, ST.ground)) * t;
  };
  const out: Array<[number, number]> = [
    [at(0, ST.s), at(0, ST.s)],
    [at(n - 1, ST.s), at(n - 1, ST.s)],
  ];
  for (const c of list) {
    for (const d of c.decks) {
      const isLevelled = d.relation !== "same";
      if (isLevelled) out.push([d.s0, d.s1]);
    }
    for (let i = 0; i < c.cross.length; i += CROSS_STRIDE) {
      const s = c.cross[i];
      const isHigh = c.cross[i + 1] >= groundAt(s) + TRACK_FORCING_RISE_M;
      if (isHigh) out.push([s, s]);
    }
  }
  return out;
}

/** Whether run distance s is more than TRACK_FREE_M from every forcing interval. */
export function isFreeAt(forcing: Array<[number, number]>, s: number): boolean {
  return forcing.every(([a, b]) => s < a - TRACK_FREE_M || s > b + TRACK_FREE_M);
}

/** Centred moving average over ±half samples (fewer at the ends). */
function movingAverage(values: number[], half: number): number[] {
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    return (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  });
}

/** Grade sign changes, a change counted only once the grade is past ±hysteresis the other way. */
export function reversals(grades: number[], hysteresis = TRACK_HYSTERESIS): number {
  let sign = 0;
  let flips = 0;
  for (const g of grades) {
    const isUp = g > hysteresis;
    const isDown = g < -hysteresis;
    const next = isUp ? 1 : isDown ? -1 : sign;
    const isFlip = sign !== 0 && next !== sign;
    if (isFlip) flips++;
    sign = next;
  }
  return flips;
}

/** Pearson's r over pooled pairs, null where either side does not vary. */
class Pearson {
  private n = 0;
  private sx = 0;
  private sy = 0;
  private sxx = 0;
  private syy = 0;
  private sxy = 0;

  add(x: number, y: number): void {
    this.n++;
    this.sx += x;
    this.sy += y;
    this.sxx += x * x;
    this.syy += y * y;
    this.sxy += x * y;
  }

  value(): number | null {
    const cov = this.sxy - (this.sx * this.sy) / this.n;
    const vx = this.sxx - (this.sx * this.sx) / this.n;
    const vy = this.syy - (this.sy * this.sy) / this.n;
    const isFlat = this.n === 0 || vx <= 1e-12 || vy <= 1e-12;
    return isFlat ? null : round(cov / Math.sqrt(vx * vy), 4);
  }

  /** Least-squares slope of x on y (x per unit of y), null where y does not vary. */
  slope(): number | null {
    const cov = this.sxy - (this.sx * this.sy) / this.n;
    const vy = this.syy - (this.sy * this.sy) / this.n;
    const isFlat = this.n === 0 || vy <= 1e-12;
    return isFlat ? null : round(cov / vy, 4);
  }
}

/**
 * Short waves over a set of stretches (free, or free near a junction): the pooled correlation, σ and
 * slope of the deck's less its moving average on the ground's, and the reversals counted within
 * each stretch (`close` ends one: a reversal is not counted across a gap).
 */
class Stretches {
  private readonly short = new Pearson();
  private sq = 0;
  private samples = 0;
  private flips = 0;
  private m = 0;
  private grades: number[] = [];

  add(dz: number, dg: number, grade: number): void {
    this.short.add(dz, dg);
    this.sq += dz * dz;
    this.samples++;
    this.grades.push(grade);
  }

  close(): void {
    const hasLength = this.grades.length > 1;
    if (hasLength) {
      this.flips += reversals(this.grades);
      this.m += (this.grades.length - 1) * TRACK_STEP_M;
    }
    this.grades = [];
  }

  get lengthM(): number {
    return this.m;
  }

  tally(): z.infer<typeof stretchTally> {
    const hasAny = this.samples > 0 && this.m > 0;
    return {
      km: round(this.m / 1000, 3),
      shortWaveCorrelation: hasAny ? this.short.value() : null,
      shortWaveStdM: hasAny ? round(Math.sqrt(this.sq / this.samples), 4) : null,
      shortWaveSlope: hasAny ? this.short.slope() : null,
      reversalsPerKm: hasAny ? round(this.flips / (this.m / 1000), 4) : null,
    };
  }
}

/** Where other written runs leave or join each run (its run distance), from their junction ends. */
function junctionsOf(runs: XwRunSummary[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of runs)
    for (const e of [r.start, r.end]) {
      const isJunction = e.kind === "junction" && e.parent !== undefined && e.parentS !== undefined;
      if (!isJunction) continue;
      out.set(e.parent!, [...(out.get(e.parent!) ?? []), e.parentS!]);
    }
  return out;
}

/** Km of every written run's viaduct chunks whose surface stands over `above` m on the ground. */
export function viaductOver(chunks: readonly XwChunk[], above: number): number {
  let m = 0;
  for (const c of chunks) {
    const isViaduct = c.structure === "viaduct";
    if (!isViaduct) continue;
    for (let i = 0; i + STATION_STRIDE < c.st.length; i += STATION_STRIDE) {
      const isHigh = c.st[i + ST.z] - c.st[i + ST.ground] > above;
      if (isHigh) m += c.st[i + STATION_STRIDE + ST.s] - c.st[i + ST.s];
    }
  }
  return round(m / 1000, 3);
}

/**
 * How the elevated main lines follow the ground, over the main-line runs of viaduct chunks only (no
 * tunnel, cut or structure deck) of at least TRACK_MIN_RUN_M: each resampled every 10 m, its first
 * and last 300 m left out (the climbs from a ground end and the junctions), then
 * - correlation: Pearson's r of the deck's height and the ground's under it, each centred on its
 *   run's mean and pooled over the runs (1: the deck rises and falls with the ground), and `slope`
 *   the least-squares slope of the one on the other (how many metres the deck rises per metre of
 *   ground: r alone does not tell a deck that follows the ground from one that only leans with it);
 * - shortWaveCorrelation: the same r of both less their own 500 m moving average (the waves
 *   shorter than about 500 m: whether the deck takes the ground's hills and hollows);
 * - shortWaveStdM: the RMS of the deck's height less its 500 m moving average (its own short waves);
 * - reversalsPerKm: the grade's sign changes per km, with a hysteresis of 0.2 %.
 * Why both correlations: S3 aims at the ground's long waves without its bumps (the DEM under a
 * viaduct is rough), which the first rewards and the second, alone, would read as not following;
 * the second is, presumably, the design's 相関: the design gave 0.38 without its formula, and this
 * function gives 0.372 on the same all/pruned output. Null where no run qualifies.
 */
export function trackingOf(
  chunks: XwChunk[],
  runs: XwRunSummary[],
  kind: "viaduct" | "ground" = "viaduct",
): Report["tracking"] {
  const chunksOf = new Map<string, XwChunk[]>();
  for (const c of chunks) chunksOf.set(c.run, [...(chunksOf.get(c.run) ?? []), c]);
  const whole = new Pearson();
  const short = new Pearson();
  let shortSq = 0;
  let samples = 0;
  let flips = 0;
  let lengthM = 0;
  let used = 0;
  const free = new Stretches();
  const nearJunction = new Stretches();
  const junctions = junctionsOf(runs);
  const heights: number[] = [];
  const half = Math.round(TRACK_WINDOW_M / 2 / TRACK_STEP_M);
  const skip = Math.round(TRACK_END_M / TRACK_STEP_M);
  for (const run of runs) {
    // The viaducts or the runs at grade (S6 PR 2), never both: counted together, the viaducts' free km
    // fell 235 → 195 and their reversals 0.766 → 0.427 by the runs at grade alone (review W8).
    const isKind = (run.ground === true) === (kind === "ground");
    const isMain = run.cls === "expressway" && run.structure === null && isKind;
    const list = (chunksOf.get(run.id) ?? []).sort((a, b) => a.k - b.k);
    // A height build's viaduct-tagged run (P2.7-6) counts as before with its embankments and cuts: a
    // run of only tunnels and cuts by its tags (P9) has no viaduct or embankment chunk.
    const isViaduct =
      list.length > 0 &&
      list.every((c) => c.over === null && c.structure !== "tunnel") &&
      list.some((c) => c.structure === "viaduct" || c.structure === "embankment");
    const isLong = run.lengthM >= TRACK_MIN_RUN_M;
    if (!isMain || !isViaduct || !isLong) continue;
    const st: number[] = [];
    for (const c of list) st.push(...(st.length === 0 ? c.st : c.st.slice(STATION_STRIDE)));
    const all = resample(st);
    const zAvg = movingAverage(
      all.map((p) => p.z),
      half,
    );
    const gAvg = movingAverage(
      all.map((p) => p.ground),
      half,
    );
    const kept = all.slice(skip, all.length - skip);
    const isTooShort = kept.length < 2;
    if (isTooShort) continue;
    used++;
    lengthM += (kept.length - 1) * TRACK_STEP_M;
    const mz = kept.reduce((n, p) => n + p.z, 0) / kept.length;
    const mg = kept.reduce((n, p) => n + p.ground, 0) / kept.length;
    const forcing = forcingOf(list);
    const mine = junctions.get(run.id) ?? [];
    kept.forEach((p, k) => {
      const i = k + skip;
      const dz = p.z - zAvg[i];
      whole.add(p.z - mz, p.ground - mg);
      short.add(dz, p.ground - gAvg[i]);
      shortSq += dz * dz;
      samples++;
      heights.push(p.z - p.ground);
      const isFree = isFreeAt(forcing, p.s);
      if (!isFree) {
        free.close();
        nearJunction.close();
        return;
      }
      free.add(dz, p.ground - gAvg[i], p.grade);
      const isNearJunction = mine.some((s) => Math.abs(p.s - s) <= TRACK_JUNCTION_M);
      if (!isNearJunction) {
        nearJunction.close();
        return;
      }
      nearJunction.add(dz, p.ground - gAvg[i], p.grade);
    });
    free.close();
    nearJunction.close();
    flips += reversals(kept.map((p) => p.grade));
  }
  const below = belowTrackingOf(chunksOf, runs);
  const over = { over15Km: viaductOver(chunks, 15), over20Km: viaductOver(chunks, 20) };
  const isEmpty = samples === 0;
  if (isEmpty)
    return {
      runs: 0,
      km: 0,
      correlation: null,
      slope: null,
      shortWaveCorrelation: null,
      shortWaveStdM: null,
      reversalsPerKm: null,
      free: free.tally(),
      junction: nearJunction.tally(),
      forcedKm: 0,
      height: { medianM: null, p95M: null, ...over },
      below,
    };
  const sortedHeights = [...heights].sort((a, b) => a - b);
  return {
    runs: used,
    km: round(lengthM / 1000, 3),
    correlation: whole.value(),
    slope: whole.slope(),
    shortWaveCorrelation: short.value(),
    shortWaveStdM: round(Math.sqrt(shortSq / samples), 4),
    reversalsPerKm: round(flips / (lengthM / 1000), 4),
    free: free.tally(),
    junction: nearJunction.tally(),
    forcedKm: round(Math.max(0, lengthM - free.lengthM) / 1000, 3),
    height: {
      medianM: round(percentile(sortedHeights, 0.5), 3),
      p95M: round(percentile(sortedHeights, 0.95), 3),
      ...over,
    },
    below,
  };
}

/**
 * The main lines below ground (P2.7-3 4.4): main-line runs every chunk of which is a tunnel or a cut
 * (no structure deck), of at least TRACK_MIN_RUN_M, resampled and trimmed as trackingOf does: the
 * RMS of the road less its 500 m moving average, and the grade reversals per km. Null where none.
 */
function belowTrackingOf(
  chunksOf: Map<string, XwChunk[]>,
  runs: XwRunSummary[],
): NonNullable<Report["tracking"]["below"]> {
  const half = Math.round(TRACK_WINDOW_M / 2 / TRACK_STEP_M);
  const skip = Math.round(TRACK_END_M / TRACK_STEP_M);
  let sq = 0;
  let samples = 0;
  let flips = 0;
  let lengthM = 0;
  let used = 0;
  for (const run of runs) {
    const isMain = run.cls === "expressway" && run.structure === null;
    const list = [...(chunksOf.get(run.id) ?? [])].sort((a, b) => a.k - b.k);
    const isBelow = list.length > 0 && list.every((c) => c.structure !== "viaduct" && c.over === null);
    const isLong = run.lengthM >= TRACK_MIN_RUN_M;
    if (!isMain || !isBelow || !isLong) continue;
    const st: number[] = [];
    for (const c of list) st.push(...(st.length === 0 ? c.st : c.st.slice(STATION_STRIDE)));
    const all = resample(st);
    const zAvg = movingAverage(
      all.map((p) => p.z),
      half,
    );
    const kept = all.slice(skip, all.length - skip);
    const isTooShort = kept.length < 2;
    if (isTooShort) continue;
    used++;
    lengthM += (kept.length - 1) * TRACK_STEP_M;
    kept.forEach((p, k) => {
      const dz = p.z - zAvg[k + skip];
      sq += dz * dz;
      samples++;
    });
    flips += reversals(kept.map((p) => p.grade));
  }
  const isEmpty = samples === 0;
  if (isEmpty) return { runs: 0, km: 0, shortWaveStdM: null, reversalsPerKm: null };
  return {
    runs: used,
    km: round(lengthM / 1000, 3),
    shortWaveStdM: round(Math.sqrt(sq / samples), 4),
    reversalsPerKm: round(flips / (lengthM / 1000), 4),
  };
}

/** The objective as the scorecard writes it (v2's weights null for v1). */
function objectiveOf(objective: ReportInput["objective"]): NonNullable<Report["objective"]> {
  const isV2 = objective !== undefined && objective.kind === "v2";
  if (!isV2) return { kind: "v1", gradeChange: null, reachM: null, targetScale: null };
  return {
    kind: "v2",
    gradeChange: objective.gradeChange,
    reachM: { ...objective.reachM },
    targetScale: objective.targetScale,
  };
}

/** The partition with its anchor count and largest block (most variables, then the smallest id). */
export function partitionOf(p: ReportInput["partition"]): NonNullable<Report["partition"]> {
  let largest: NonNullable<Report["partition"]>["largest"] = null;
  for (const b of p.blocks) {
    const isLarger = largest === null || b.variables > largest.variables;
    if (isLarger) largest = { id: b.id, runs: b.runs, pieces: b.pieces, variables: b.variables };
  }
  const {
    mode,
    quietFactor,
    quietMinM,
    anchors,
    pieces,
    neededBlocks,
    routeSolves,
    anchorsNearProblems,
    joins,
    blocks,
  } = p;
  return {
    mode,
    quietFactor,
    quietMinM,
    anchorCount: anchors.length,
    anchors,
    pieces,
    neededBlocks,
    largest,
    routeSolves,
    anchorsNearProblems,
    joins,
    blocks,
  };
}

/** Planned, written and closed runs per district (every district, zero where none). */
export function districtsOf(
  input: Pick<ReportInput, "planned" | "runs" | "closed" | "districts">,
): NonNullable<Report["districts"]> {
  const wanted = input.planned.filter((p) => p.wanted);
  const lengthOf = new Map(input.planned.map((p) => [p.id, p.lengthM]));
  const closed = new Set(input.closed.map((c) => c.run));
  const written = new Set(input.runs.map((r) => r.id));
  const out = Object.fromEntries(
    DISTRICTS.map((d) => [
      d,
      { planned: { runs: 0, km: 0 }, written: { runs: 0, km: 0 }, closed: { runs: 0, km: 0 } },
    ]),
  ) as NonNullable<Report["districts"]>;
  for (const p of wanted) {
    const t = out[input.districts.get(p.id) ?? "outside"];
    const runKm = (lengthOf.get(p.id) ?? 0) / 1000;
    t.planned.runs++;
    t.planned.km += runKm;
    if (written.has(p.id)) {
      t.written.runs++;
      t.written.km += runKm;
    }
    if (closed.has(p.id)) {
      t.closed.runs++;
      t.closed.km += runKm;
    }
  }
  for (const t of Object.values(out)) for (const x of [t.planned, t.written, t.closed]) x.km = round(x.km, 3);
  return out;
}

export function buildReport(input: ReportInput): Report {
  const wanted = input.planned.filter((p) => p.wanted);
  const inRange = new Set(wanted.map((p) => p.id));
  const plannedById = new Map(input.planned.map((p) => [p.id, p]));
  const closedRuns = input.closed.map((c) => ({ cls: c.cls, lengthM: plannedById.get(c.run)?.lengthM ?? 0 }));
  const rangeDiagnostics = input.diagnostics.filter((d) => inRange.has(d.run));
  const { qpMs, ...solver } = input.solver;
  const report: Report = {
    version: REPORT_VERSION,
    label: input.label,
    range: input.range,
    below: input.below,
    objective: objectiveOf(input.objective),
    extract: input.extract,
    plan: input.plan,
    runs: {
      planned: tallyBy(wanted),
      written: tallyBy(input.runs),
      closed: tallyBy(closedRuns),
    },
    scope: {
      wanted: [...inRange].sort(),
      extent: input.extent,
      rampsOutside: input.rampsOutside,
      dangling: danglingOf(input.runs),
      deckMismatch: deckMismatchOf(input.runs, input.structureDecks),
    },
    closures: closuresOf(input.closed, input.diagnostics, input.planned),
    diagnostics: diagnosticsOf(input.diagnostics, inRange),
    overlaps: overlapsOf(rangeDiagnostics, input.runs),
    overlapPairs: overlapPairsOf(rangeDiagnostics, input.runs),
    violations: input.violations,
    ...(input.heightStructures
      ? {
          structures: {
            ...structuresOf(input.chunks, input.districts, input.runs),
            ...(input.heightRules ? { rules: input.heightRules } : {}),
          },
        }
      : {}),
    ...(input.ground ? { ground: input.ground } : {}),
    ...(input.companions ? { companions: input.companions } : {}),
    tracking: trackingOf(input.chunks, input.runs),
    size: {
      tiles: input.tiles.length,
      raw: spreadOf(input.tiles.map((t) => t.bytes)),
      gzip: spreadOf(input.tiles.map((t) => t.gzipBytes)),
      meta: input.meta,
      record: input.record,
      ledger: input.ledger,
    },
    solver,
    partition: partitionOf(input.partition),
    districts: districtsOf(input),
    ledger: input.ledgerSummary,
    ...(input.withoutTimings
      ? {}
      : {
          timings: {
            qpMs: Math.round(qpMs),
            stagesMs: Object.fromEntries(Object.entries(input.stagesMs).map(([k, v]) => [k, Math.round(v)])),
          },
        }),
  };
  return ReportSchema.parse(report);
}

/**
 * The numbers of a report by dotted path (scripts/compareExpresswayReports.ts): lists keyed by their
 * block id (partition blocks), run and distance (anchors), run (closures) or pair (overlaps).
 */
export function flattenReport(report: Report): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (value: unknown, prefix: string) => {
    if (typeof value === "number") {
      out.set(prefix, value);
      return;
    }
    const isList = Array.isArray(value);
    if (isList) {
      value.forEach((item, i) => {
        const o = item as { id?: string; run?: string; s?: number; a?: string; b?: string };
        const isAnchor = o.run !== undefined && typeof o.s === "number";
        const key =
          o.id ?? (isAnchor ? `${o.run}@${o.s}` : o.run) ?? (o.a !== undefined ? `${o.a}|${o.b}` : String(i));
        walk(item, `${prefix}[${key}]`);
      });
      return;
    }
    const isObject = value !== null && typeof value === "object";
    if (!isObject) return;
    for (const [k, v] of Object.entries(value)) walk(v, prefix === "" ? k : `${prefix}.${k}`);
  };
  walk(report, "");
  return out;
}

/** Blocks whose solution hash differs between two reports (same id), and those on one side only. */
export function blockChanges(
  a: Report,
  b: Report,
): { changed: string[]; added: string[]; removed: string[] } {
  const ha = new Map((a.partition?.blocks ?? []).map((x) => [x.id, x.hash]));
  const hb = new Map((b.partition?.blocks ?? []).map((x) => [x.id, x.hash]));
  return {
    changed: [...hb.keys()].filter((id) => ha.has(id) && ha.get(id) !== hb.get(id)),
    added: [...hb.keys()].filter((id) => !ha.has(id)),
    removed: [...ha.keys()].filter((id) => !hb.has(id)),
  };
}

/** The objective with its weights as a label (a report before version 4 is v1). */
export function objectiveLabel(r: Pick<Report, "objective">): string {
  const o = r.objective;
  const isV2 = o !== undefined && o.kind === "v2";
  if (!isV2) return "v1";
  return `v2(w ${o.gradeChange}, reach ${o.reachM?.viaduct}/${o.reachM?.below}, target ×${o.targetScale})`;
}

/**
 * Two reports of builds whose differences are not the compiler's alone (another range, --below
 * mode, extract or objective with its weights): what each was, for expressway_reports_unlike, or
 * null when they are alike.
 */
export function buildsUnlike(
  a: Pick<Report, "range" | "below" | "extract" | "objective">,
  b: Pick<Report, "range" | "below" | "extract" | "objective">,
): { a: string; b: string } | null {
  const isOther =
    a.range !== b.range ||
    a.below !== b.below ||
    a.extract.sha256 !== b.extract.sha256 ||
    objectiveLabel(a) !== objectiveLabel(b);
  if (!isOther) return null;
  const label = (r: typeof a) => `${r.range}/${r.below}/${r.extract.timestamp}/${objectiveLabel(r)}`;
  return { a: label(a), b: label(b) };
}
