import {
  COMPOSITE_GRADE,
  type DesignSpeed,
  lowerDesignSpeed,
  MAX_GRADE,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../law/roadStandards";
import { QpBuilder, type QpStatus, solveQp } from "./qp";

/**
 * Vertical alignment (設計書 4.3). Each run's profile is a chain of equal parabolic arcs: knots
 * every h metres (h ≥ the 第22条 minimum curve length of the run's highest design speed), the grade
 * varying linearly between knots. Each arc is a vertical curve whose PVI is the arc's midpoint, of
 * length h and radius h / |Δgrade|, so
 *
 * - the grade never exceeds its largest knot value (第20条 on the knots is 第20条 everywhere),
 * - the curvature is constant on an arc (第22条第2項 on the knot differences),
 * - every curve is at least h long (第22条第3項), even for a tiny grade change.
 *
 * The design speed is set per stretch (`zones`): a knot's grade limit is the strictest of the zones
 * within one knot interval of it, an arc's radius limit the strictest of the zones it spans, so a
 * tight curve lowers the speed (and raises the allowed grade) only around itself.
 *
 * Runs joined at junctions, crossing each other or running over one another are solved together
 * as one convex QP (`solveJoint`): their knots are the variables, a junction is an equality between
 * the child's end and the parent's profile, a crossing or a stacked deck a lower bound on the height
 * difference, a shared deck surface a band of ±5 cm. Every bound and coupling is a soft (exact L1)
 * penalty and only the statute limits are hard, so the problem is always feasible: the QP meets
 * everything it can, and `finish` reports, per run, what it could not. Why not solve run by run (P1):
 * the first run fixed could not know what a later one needed (a ramp that has to climb over the
 * deck beside it right after leaving its parent), which left 165 of 763 runs unsolved.
 */

export type EndCondition = { z?: number; grade?: number };
export type Zone = { from: number; to: number; V: DesignSpeed };

export type RunInput = {
  id: string;
  length: number;
  /** Design speed per stretch, covering [0, length]. */
  zones: Zone[];
  /** Use the 第20条 特例 grade instead of the standard one. */
  special: boolean;
  /** Constraint stations along the run (0 and length included). */
  stations: Float64Array;
  target: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
  /** Ends fixed by the ground (a junction end is a `Coupling`). */
  start: EndCondition;
  end: EndCondition;
};

export type Ref = { run: string; s: number };

export type Coupling =
  /** The child's end takes the parent's elevation and grade at parent.s. */
  | { kind: "junction"; child: string; atStart: boolean; parent: Ref }
  /**
   * lo ≤ z(a) − z(b) ≤ hi. `firm`: a clearance that decides whether a run is solved (a crossing);
   * otherwise a preference between overlapping decks (one surface or a level apart) that gives way
   * to every clearance and end, so contradictions in the OSM tags or lines surface as deck_overlap
   * diagnostics instead of unsolved runs.
   */
  | { kind: "within"; a: Ref; b: Ref; lo: number; hi: number; firm: boolean };

export type VerticalProfile = {
  /** Knot spacing (m). */
  h: number;
  /** Elevation at each knot. */
  z: number[];
  /** Grade at each knot. */
  g: number[];
  /** Highest design speed of the run (what h was chosen for). */
  V: DesignSpeed;
  zones: Zone[];
  special: boolean;
  /** Grade limit at each knot, and the radius limits of each arc. */
  gradeLimit: number[];
  crestRadius: number[];
  sagRadius: number[];
  minCurveLength: number;
};

/** Elevation and grade of a profile at distance s. */
export function evalProfile(
  p: Pick<VerticalProfile, "h" | "z" | "g">,
  s: number,
): { z: number; grade: number } {
  const m = p.z.length - 1;
  const j = Math.min(m - 1, Math.max(0, Math.floor(s / p.h)));
  const t = s - j * p.h;
  const g0 = p.g[j];
  const g1 = p.g[j + 1];
  const k = (g1 - g0) / p.h;
  return { z: p.z[j] + g0 * t + (k * t * t) / 2, grade: g0 + k * t };
}

/** The 第20条 grade (standard or 特例) for V, capped by 第25条 (the composite grade with no bank). */
export function gradeLimitFor(V: DesignSpeed, special: boolean): number {
  const grade = MAX_GRADE.value[V];
  // At 20 km/h the 第20条 特例 grade (12 %) is above the composite limit (11.5 %); at 30 (11 %) not.
  return Math.min(special ? grade.special : grade.standard, COMPOSITE_GRADE.value[V]);
}

/** Design speed of the zone holding s. */
export function zoneSpeedAt(zones: Zone[], s: number): DesignSpeed {
  for (const z of zones) if (s >= z.from && s <= z.to) return z.V;
  return zones[zones.length - 1].V;
}

// The QP aims inside these margins so its modest accuracy still lands within the statute.
const GRADE_MARGIN = 0.995;
const CURVE_MARGIN = 0.99;
// The bounds hold on the 5 m constraint grid; between grid stations the smoothed ground can rise a
// few centimetres above the line joining them, so the QP aims 3 cm inside.
const BOUND_MARGIN = 0.03;
const COUPLING_MARGIN = 0.01;
/** Objective weights: staying near the target per station, and a smooth grade per arc. */
const W_TARGET = 0.004;
const W_SMOOTH = 0.5;
/**
 * L1 weights, in order of what gives way first: overlapping decks' relation (5), then a clearance
 * (own stations, crossings: 200, 40× a pair), then an end or a junction (2000, 10× a clearance). A
 * deck may be moved off a shared surface to keep a clearance, and a clearance gives way to an end,
 * as long as one metre of the higher kind costs more than the lower kind it spares; the weights
 * are per row, so many violated pair rows can still outweigh one clearance row (not a strict
 * priority: a lexicographic solve would be).
 */
const W_PAIR = 5;
const W_BOUND = 200;
const W_END = 2000;

type Layout = {
  input: RunInput;
  off: number;
  m: number;
  h: number;
  isShort: boolean;
  maxV: DesignSpeed;
  minLength: number;
  gradeLimit: number[];
  crest: number[];
  sag: number[];
};

function speedsWithin(zones: Zone[], a: number, b: number): DesignSpeed[] {
  const out = zones.filter((z) => z.to >= a && z.from <= b).map((z) => z.V);
  return out.length > 0 ? out : [zones[zones.length - 1].V];
}

function layoutOf(input: RunInput, off: number): Layout {
  const S = input.length;
  const maxV = Math.max(...input.zones.map((z) => z.V)) as DesignSpeed;
  const minLength = VERTICAL_CURVE_LENGTH.value[maxV];
  const m = Math.max(1, Math.floor(S / minLength));
  const h = S / m;
  const gradeLimit: number[] = [];
  for (let j = 0; j <= m; j++) {
    const vs = speedsWithin(input.zones, (j - 1) * h, (j + 1) * h);
    gradeLimit.push(Math.min(...vs.map((v) => gradeLimitFor(v, input.special))));
  }
  const crest: number[] = [];
  const sag: number[] = [];
  for (let j = 0; j < m; j++) {
    const top = Math.max(...speedsWithin(input.zones, j * h, (j + 1) * h)) as DesignSpeed;
    crest.push(VERTICAL_CURVE_RADIUS.value[top].crest);
    sag.push(VERTICAL_CURVE_RADIUS.value[top].sag);
  }
  return { input, off, m, h, isShort: S < minLength, maxV, minLength, gradeLimit, crest, sag };
}

const Zi = (L: Layout, j: number) => L.off + j;
const Di = (L: Layout, j: number) => L.off + L.m + 1 + j;

/** z(s) = Z_j + t·D_j + t²/2 · (D_{j+1} − D_j), as a row over the run's variables. */
function zRow(L: Layout, s: number, scale = 1): Array<[number, number]> {
  const j = Math.min(L.m - 1, Math.max(0, Math.floor(s / L.h)));
  const t = Math.min(1, Math.max(0, (s - j * L.h) / L.h));
  return [
    [Zi(L, j), scale],
    [Di(L, j), scale * (t - (t * t) / 2)],
    [Di(L, j + 1), scale * ((t * t) / 2)],
  ];
}

/** h_scale · grade(s) = h_scale / h · (D_j + t (D_{j+1} − D_j)). */
function gRow(L: Layout, s: number, hScale: number): Array<[number, number]> {
  const j = Math.min(L.m - 1, Math.max(0, Math.floor(s / L.h)));
  const t = Math.min(1, Math.max(0, (s - j * L.h) / L.h));
  const k = hScale / L.h;
  return [
    [Di(L, j), k * (1 - t)],
    [Di(L, j + 1), k * t],
  ];
}

function merge(row: Array<[number, number]>): Array<[number, number]> {
  const acc = new Map<number, number>();
  for (const [c, v] of row) acc.set(c, (acc.get(c) ?? 0) + v);
  return [...acc.entries()].sort((a, b) => a[0] - b[0]);
}

export type JointResult = {
  profiles: Map<string, VerticalProfile>;
  /** Violations of each run's exact constraints (its own bounds, statute limits, ends, junctions). */
  problems: Map<string, string[]>;
  /** Size of the QP (for the build log). */
  variables: number;
  rows: number;
  iterations: number;
  /** The solver's verdict (qp.ts); anything but "converged" means the profiles are not a solution. */
  status: QpStatus;
  residuals: { primal: number; dual: number; gap: number };
};

/** Solve runs and their couplings as one QP, then make each run's profile exact and check it. */
export function solveJoint(runs: RunInput[], couplings: Coupling[]): JointResult {
  const qp = new QpBuilder();
  const layouts = new Map<string, Layout>();
  for (const input of [...runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const probe = layoutOf(input, 0);
    const off = qp.addVars(2 * (probe.m + 1));
    layouts.set(input.id, layoutOf(input, off));
  }
  for (const L of layouts.values()) {
    const { m, h, input } = L;
    for (let j = 0; j < m; j++)
      qp.addRow(
        [
          [Zi(L, j), -1],
          [Zi(L, j + 1), 1],
          [Di(L, j), -0.5],
          [Di(L, j + 1), -0.5],
        ],
        0,
        0,
      );
    for (let j = 0; j <= m; j++) {
      const gMax = L.gradeLimit[j] * h * GRADE_MARGIN;
      qp.addRow([[Di(L, j), 1]], -gMax, gMax);
    }
    for (let j = 0; j < m; j++) {
      const lo = L.isShort ? 0 : (-(h * h) / L.crest[j]) * CURVE_MARGIN;
      const hi = L.isShort ? 0 : ((h * h) / L.sag[j]) * CURVE_MARGIN;
      qp.addRow(
        [
          [Di(L, j), -1],
          [Di(L, j + 1), 1],
        ],
        lo,
        hi,
      );
      qp.addSquare(
        [
          [Di(L, j), -1],
          [Di(L, j + 1), 1],
        ],
        0,
        W_SMOOTH,
      );
    }
    for (let k = 0; k < input.stations.length; k++) {
      const row = zRow(L, input.stations[k]);
      qp.addSquare(row, input.target[k], W_TARGET);
      const lo = input.lower[k] + BOUND_MARGIN;
      const hi = input.upper[k] - BOUND_MARGIN;
      const isBounded = Number.isFinite(lo) || Number.isFinite(hi);
      if (isBounded)
        qp.addRow(row, Number.isFinite(lo) ? lo : -Infinity, Number.isFinite(hi) ? hi : Infinity, W_BOUND);
    }
    const { start, end } = input;
    if (start.z !== undefined) qp.addRow([[Zi(L, 0), 1]], start.z, start.z, W_END);
    if (start.grade !== undefined) qp.addRow([[Di(L, 0), 1]], start.grade * h, start.grade * h, W_END);
    if (end.z !== undefined) qp.addRow([[Zi(L, m), 1]], end.z, end.z, W_END);
    if (end.grade !== undefined) qp.addRow([[Di(L, m), 1]], end.grade * h, end.grade * h, W_END);
  }
  for (const c of couplings) {
    if (c.kind === "junction") {
      const child = layouts.get(c.child);
      const parent = layouts.get(c.parent.run);
      if (!child || !parent) continue;
      const j = c.atStart ? 0 : child.m;
      qp.addRow(merge([[Zi(child, j), 1], ...zRow(parent, c.parent.s, -1)]), 0, 0, W_END);
      qp.addRow(merge([[Di(child, j), 1], ...gRow(parent, c.parent.s, -child.h)]), 0, 0, W_END);
      continue;
    }
    const a = layouts.get(c.a.run);
    const b = layouts.get(c.b.run);
    if (!a || !b) continue;
    const lo = Number.isFinite(c.lo) ? c.lo + COUPLING_MARGIN : -Infinity;
    const hi = Number.isFinite(c.hi) ? c.hi - COUPLING_MARGIN : Infinity;
    qp.addRow(merge([...zRow(a, c.a.s), ...zRow(b, c.b.s, -1)]), lo, hi, c.firm ? W_BOUND : W_PAIR);
  }
  const built = qp.build();
  const res = solveQp(built);
  const { profiles, problems } = finish(layouts, couplings, res.x);
  return {
    profiles,
    problems,
    variables: built.n,
    rows: built.rows.length,
    iterations: res.iterations,
    status: res.status,
    residuals: { primal: res.primalResidual, dual: res.dualResidual, gap: res.gap },
  };
}

/** Parents before children (junction couplings); runs in a cycle last, by id. */
function finishOrder(ids: string[], couplings: Coupling[]): string[] {
  const parents = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const c of couplings) {
    const isJunction = c.kind === "junction" && parents.has(c.child) && parents.has(c.parent.run);
    if (isJunction && c.child !== c.parent.run) parents.get(c.child)!.add(c.parent.run);
  }
  const done = new Set<string>();
  const order: string[] = [];
  for (;;) {
    const next = ids.find((id) => !done.has(id) && [...parents.get(id)!].every((p) => done.has(p)));
    if (next === undefined) break;
    done.add(next);
    order.push(next);
  }
  for (const id of ids) if (!done.has(id)) order.push(id);
  return order;
}

function finish(
  layouts: Map<string, Layout>,
  couplings: Coupling[],
  x: Float64Array,
): { profiles: Map<string, VerticalProfile>; problems: Map<string, string[]> } {
  const ids = [...layouts.keys()].sort();
  const profiles = new Map<string, VerticalProfile>();
  const problems = new Map<string, string[]>();
  const junctionAt = (id: string, atStart: boolean) =>
    couplings.find(
      (c): c is Extract<Coupling, { kind: "junction" }> =>
        c.kind === "junction" && c.child === id && c.atStart === atStart,
    );
  for (const id of finishOrder(ids, couplings)) {
    const L = layouts.get(id)!;
    const { m, h, input } = L;
    const out: string[] = [];
    const d = Array.from({ length: m + 1 }, (_, j) => x[Di(L, j)]);
    const pinned = (atStart: boolean): EndCondition => {
      const j = junctionAt(id, atStart);
      const parent = j ? profiles.get(j.parent.run) : undefined;
      if (parent) return evalProfile(parent, j!.parent.s);
      return atStart ? input.start : input.end;
    };
    const s0 = pinned(true);
    const s1 = pinned(false);
    if (s0.grade !== undefined) d[0] = s0.grade * h;
    if (s1.grade !== undefined) d[m] = s1.grade * h;
    const z = [s0.z ?? x[Zi(L, 0)]];
    for (let j = 0; j < m; j++) z.push(z[j] + (d[j] + d[j + 1]) / 2);
    const isPinnedEnd = s1.z !== undefined;
    if (isPinnedEnd && m > 1) {
      // Spread the last centimetres of end-elevation error over the interior grades.
      const delta = (s1.z! - z[m]) / (m - 1);
      for (let j = 1; j < m; j++) d[j] += delta;
      for (let j = 0; j < m; j++) z[j + 1] = z[j] + (d[j] + d[j + 1]) / 2;
    }
    const profile: VerticalProfile = {
      h,
      z,
      g: d.map((v) => v / h),
      V: L.maxV,
      zones: input.zones,
      special: input.special,
      gradeLimit: L.gradeLimit,
      crestRadius: L.crest,
      sagRadius: L.sag,
      minCurveLength: L.minLength,
    };
    profiles.set(id, profile);
    const isFinite = profile.z.every(Number.isFinite) && profile.g.every(Number.isFinite);
    if (!isFinite) {
      problems.set(id, ["the solver returned no finite profile"]);
      continue;
    }
    for (let j = 0; j <= m; j++) {
      const isTooSteep = Math.abs(profile.g[j]) > L.gradeLimit[j] + 1e-9;
      if (isTooSteep)
        out.push(
          `grade ${(profile.g[j] * 100).toFixed(2)}% > ${(L.gradeLimit[j] * 100).toFixed(1)}% at ${Math.round(j * h)} m`,
        );
    }
    for (let j = 0; j < m; j++) {
      const k = (profile.g[j + 1] - profile.g[j]) / h;
      const isTooSharp = L.isShort
        ? Math.abs(k) > 1e-9
        : k < -1 / L.crest[j] - 1e-12 || k > 1 / L.sag[j] + 1e-12;
      if (isTooSharp)
        out.push(
          L.isShort
            ? `curve length ${h.toFixed(1)} m < ${L.minLength} m`
            : `vertical curve R=${Math.round(1 / Math.abs(k))} at ${Math.round(j * h)} m`,
        );
    }
    let worstBound = 0;
    let worstAt = 0;
    for (let k = 0; k < input.stations.length; k++) {
      const zs = evalProfile(profile, input.stations[k]).z;
      const over = Math.max(input.lower[k] - zs, zs - input.upper[k]);
      if (over > worstBound) {
        worstBound = over;
        worstAt = input.stations[k];
      }
    }
    if (worstBound > 1e-6)
      out.push(`clearance short by ${worstBound.toFixed(2)} m at ${Math.round(worstAt)} m`);
    const endMiss = isPinnedEnd ? Math.abs(z[m] - s1.z!) : 0;
    if (endMiss > 1e-3) out.push(`end elevation off by ${endMiss.toFixed(3)} m`);
    const startMiss = s0.z !== undefined ? Math.abs(z[0] - s0.z) : 0;
    if (startMiss > 1e-3) out.push(`start elevation off by ${startMiss.toFixed(3)} m`);
    problems.set(id, out);
  }
  return { profiles, problems };
}

export type FallbackStep = "standard" | "specialGrade" | "lowerSpeed" | "crossingsOnly";
export type FallbackPlan = {
  cap: DesignSpeed;
  special: boolean;
  crossingsOnly: boolean;
  steps: FallbackStep[];
};

/**
 * The fallbacks of 設計書 4.3 の 3 in order: the 特例 grade, then lower design speeds down to minV
 * (a cap on every zone), then only the crossings' clearance (no standard height over open ground).
 */
export function fallbackPlans(V: DesignSpeed, minV: DesignSpeed): FallbackPlan[] {
  const plans: FallbackPlan[] = [
    { cap: V, special: false, crossingsOnly: false, steps: ["standard"] },
    { cap: V, special: true, crossingsOnly: false, steps: ["specialGrade"] },
  ];
  let v: DesignSpeed | null = V;
  while (v !== null && v > minV) {
    v = lowerDesignSpeed(v);
    if (v !== null)
      plans.push({ cap: v, special: true, crossingsOnly: false, steps: ["specialGrade", "lowerSpeed"] });
  }
  const lowest = plans[plans.length - 1];
  plans.push({ ...lowest, crossingsOnly: true, steps: [...lowest.steps, "crossingsOnly"] });
  return plans;
}

/** Zones with every speed capped (the lower-speed fallback), neighbours of one speed merged. */
export function capZones(zones: Zone[], cap: DesignSpeed): Zone[] {
  const out: Zone[] = [];
  for (const z of zones) {
    const V = Math.min(z.V, cap) as DesignSpeed;
    const last = out[out.length - 1];
    const isSame = last !== undefined && last.V === V;
    if (isSame) last.to = z.to;
    else out.push({ from: z.from, to: z.to, V });
  }
  return out;
}

/** One run alone, with the end conditions and bounds of P1's single-run problem (T9). */
export type VerticalInput = {
  length: number;
  V: DesignSpeed;
  /** Lowest design speed the fallback may drop to (40 on the main line, 20 on a ramp). */
  minV: DesignSpeed;
  stations: Float64Array;
  target: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
  /** The part of `lower` that comes from crossings only (the last fallback keeps just this). */
  lowerAtCrossings: Float64Array;
  start: EndCondition;
  end: EndCondition;
};

export type VerticalAttempt = { V: DesignSpeed; special: boolean; crossingsOnly: boolean; worst: string };
export type VerticalResult =
  | { ok: true; profile: VerticalProfile; steps: FallbackStep[]; attempts: VerticalAttempt[] }
  | { ok: false; attempts: VerticalAttempt[] };

/** Solve one run through the fallbacks; every attempt is reported, nothing relaxed silently. */
export function solveVertical(input: VerticalInput): VerticalResult {
  const attempts: VerticalAttempt[] = [];
  for (const plan of fallbackPlans(input.V, input.minV)) {
    const run: RunInput = {
      id: "run",
      length: input.length,
      zones: [{ from: 0, to: input.length, V: plan.cap }],
      special: plan.special,
      stations: input.stations,
      target: input.target,
      lower: plan.crossingsOnly ? input.lowerAtCrossings : input.lower,
      upper: input.upper,
      start: input.start,
      end: input.end,
    };
    const { profiles, problems } = solveJoint([run], []);
    const worst = problems.get("run")!.join("; ");
    attempts.push({ V: plan.cap, special: plan.special, crossingsOnly: plan.crossingsOnly, worst });
    if (worst === "") return { ok: true, profile: profiles.get("run")!, steps: plan.steps, attempts };
  }
  return { ok: false, attempts };
}
