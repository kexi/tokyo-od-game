import { z } from "zod";
import type { XwChunk, XwClass, XwClosed, XwDiagnostic, XwRunSummary } from "./format";
import { classifyOverlap, isJoined, OVERLAP_CLASSES, type OverlapClass, overlapPair } from "./overlapClass";
import { hermite, ST } from "./profile";
import { STATION_STRIDE } from "./format";
import { PROPERTIES, type Property, type Violations } from "./violations";

/**
 * The scorecard of one expressway build (P2.7-1, `scripts/expressway.ts --report`): what the later
 * stages (S2〜S7, R1〜R3 in knowledge/expressway-generation.md「P2.7-1」) are judged by, by machine.
 * Pure: the build script hands it the plan's runs, the result, the tile sizes and the timings, and
 * writes the report outside the data folder. Everything but `timings` is byte-stable from one build
 * to the next (`--baseline` writes the report without them: tests/fixtures/expresswayScorecard.ship.json).
 */

const count = z.number().int().nonnegative();
const km = z.number().nonnegative();
const tally = z.strictObject({ runs: count, km });
const byClass = z.strictObject({ main: tally, ramp: tally, street: tally });
const spread = z.strictObject({ total: count, median: count, p90: count, max: count });
const extentTally = z.strictObject({ inKm: km, outKm: km, operatedKm: km, otherKm: km });
const cls = z.enum(["expressway", "ramp", "street"]);

/**
 * 3 (P2.7-2): `partition`, how the needed runs were split and solved. A version-2 report (no
 * partition) still parses, so a scorecard can be compared with one written before.
 */
export const REPORT_VERSION = 3;

const blockSize = { runs: count, pieces: count, variables: count };

export const ReportSchema = z.strictObject({
  version: z.union([z.literal(2), z.literal(REPORT_VERSION)]),
  label: z.string(),
  range: z.string(),
  below: z.enum(["pruned", "all"]),
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
  /** The data test's properties over the files (violations.ts): count and the first few of each. */
  violations: z.strictObject(
    Object.fromEntries(
      PROPERTIES.map((p) => [p, z.strictObject({ count, first: z.array(z.string()) })]),
    ) as Record<Property, z.ZodObject<{ count: typeof count; first: z.ZodArray<z.ZodString> }>>,
  ),
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
  }),
  size: z.strictObject({
    tiles: count,
    raw: spread,
    gzip: spread,
    meta: z.strictObject({ raw: count, gzip: count, byField: z.record(z.string(), count) }),
  }),
  solver: z.strictObject({
    components: count,
    largestRuns: count,
    largestVariables: count,
    solves: count,
    iterations: count,
    unconverged: count,
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
  solver: Report["solver"] & { qpMs: number };
  /** The partition without what buildReport derives (the anchor count, the largest block). */
  partition: Omit<NonNullable<Report["partition"]>, "anchorCount" | "largest">;
  stagesMs: Record<string, number>;
  /** Leave the timings out (the baseline fixture). */
  withoutTimings?: boolean;
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

type Sample = { z: number; grade: number; ground: number };

/** A run's surface every TRACK_STEP_M from its stations (Hermite z and grade, ground linear). */
function resample(st: number[]): Sample[] {
  const n = st.length / STATION_STRIDE;
  const at = (i: number, k: number) => st[i * STATION_STRIDE + k];
  const length = at(n - 1, ST.s) - at(0, ST.s);
  const out: Sample[] = [];
  let i = 0;
  for (let s = at(0, ST.s); s <= at(0, ST.s) + length + 1e-9; s += TRACK_STEP_M) {
    while (i < n - 2 && at(i + 1, ST.s) < s) i++;
    const s0 = at(i, ST.s);
    const s1 = at(i + 1, ST.s);
    const p = hermite(s0, at(i, ST.z), at(i, ST.grade), s1, at(i + 1, ST.z), at(i + 1, ST.grade), s);
    const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
    const ground = at(i, ST.ground) + (at(i + 1, ST.ground) - at(i, ST.ground)) * t;
    out.push({ z: p.z, grade: p.grade, ground });
  }
  return out;
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
export function trackingOf(chunks: XwChunk[], runs: XwRunSummary[]): Report["tracking"] {
  const chunksOf = new Map<string, XwChunk[]>();
  for (const c of chunks) chunksOf.set(c.run, [...(chunksOf.get(c.run) ?? []), c]);
  const whole = new Pearson();
  const short = new Pearson();
  let shortSq = 0;
  let samples = 0;
  let flips = 0;
  let lengthM = 0;
  let used = 0;
  const half = Math.round(TRACK_WINDOW_M / 2 / TRACK_STEP_M);
  const skip = Math.round(TRACK_END_M / TRACK_STEP_M);
  for (const run of runs) {
    const isMain = run.cls === "expressway" && run.structure === null;
    const list = (chunksOf.get(run.id) ?? []).sort((a, b) => a.k - b.k);
    const isViaduct = list.length > 0 && list.every((c) => c.structure === "viaduct" && c.over === null);
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
    kept.forEach((p, k) => {
      const i = k + skip;
      const dz = p.z - zAvg[i];
      whole.add(p.z - mz, p.ground - mg);
      short.add(dz, p.ground - gAvg[i]);
      shortSq += dz * dz;
      samples++;
    });
    flips += reversals(kept.map((p) => p.grade));
  }
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
    };
  return {
    runs: used,
    km: round(lengthM / 1000, 3),
    correlation: whole.value(),
    slope: whole.slope(),
    shortWaveCorrelation: short.value(),
    shortWaveStdM: round(Math.sqrt(shortSq / samples), 4),
    reversalsPerKm: round(flips / (lengthM / 1000), 4),
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
    tracking: trackingOf(input.chunks, input.runs),
    size: {
      tiles: input.tiles.length,
      raw: spreadOf(input.tiles.map((t) => t.bytes)),
      gzip: spreadOf(input.tiles.map((t) => t.gzipBytes)),
      meta: input.meta,
    },
    solver,
    partition: partitionOf(input.partition),
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
