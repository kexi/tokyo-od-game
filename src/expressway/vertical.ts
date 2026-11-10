import {
  COMPOSITE_GRADE,
  type DesignSpeed,
  lowerDesignSpeed,
  MAX_GRADE,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../law/roadStandards";
import { solveQp, type Qp } from "./qp";

/**
 * Vertical alignment (knowledge/road-redesign-plan.md 4.3). The profile is a chain of equal parabolic arcs: knots every h
 * metres (h ≥ the 第22条 minimum curve length), the grade varying linearly between knots. Each arc
 * is a vertical curve whose PVI is the arc's midpoint, of length h and radius h / |Δgrade|, so
 *
 * - the grade never exceeds its largest knot value (第20条 on the knots is 第20条 everywhere),
 * - the curvature is constant on an arc (第22条第2項 on the knot differences),
 * - every curve is at least h long (第22条第3項), even for a tiny grade change.
 *
 * All three are linear in the knot elevations and grades, so with the clearance bounds at every
 * station the problem is a convex QP: stay close to the target height (the standard
 * underclearance), smoothly, inside the bounds. Why not choose PVIs by hand-written rules: a rule
 * that satisfies one crossing breaks another; the QP either finds a profile that satisfies all of
 * them or proves there is none, which is then reported (never silently broken).
 */

export type EndCondition = { z?: number; grade?: number };

export type VerticalInput = {
  length: number;
  V: DesignSpeed;
  /** Lowest design speed the fallback may drop to (40 on the main line, 20 on a ramp). */
  minV: DesignSpeed;
  /** Constraint stations along the run (0 and length included). */
  stations: Float64Array;
  target: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
  /**
   * The part of `lower` that only keeps the viaduct at its standard height over open ground (not a
   * crossing): the third fallback drops it to the crossings' own bounds (knowledge/road-redesign-plan.md 4.3 の 3).
   */
  lowerAtCrossings: Float64Array;
  start: EndCondition;
  end: EndCondition;
};

export type FallbackStep = "standard" | "specialGrade" | "lowerSpeed" | "crossingsOnly";

export type VerticalProfile = {
  /** Knot spacing (m). */
  h: number;
  /** Elevation at each knot. */
  z: number[];
  /** Grade at each knot. */
  g: number[];
  V: DesignSpeed;
  gradeLimit: number;
  crestRadius: number;
  sagRadius: number;
  minCurveLength: number;
  steps: FallbackStep[];
};

export type VerticalAttempt = { V: DesignSpeed; special: boolean; crossingsOnly: boolean; worst: string };
export type VerticalResult =
  | { ok: true; profile: VerticalProfile; attempts: VerticalAttempt[] }
  | { ok: false; attempts: VerticalAttempt[] };

/** Elevation and grade of a profile at distance s. */
export function evalProfile(p: VerticalProfile, s: number): { z: number; grade: number } {
  const m = p.z.length - 1;
  const j = Math.min(m - 1, Math.max(0, Math.floor(s / p.h)));
  const t = s - j * p.h;
  const g0 = p.g[j];
  const g1 = p.g[j + 1];
  const k = (g1 - g0) / p.h;
  return { z: p.z[j] + g0 * t + (k * t * t) / 2, grade: g0 + k * t };
}

// The QP aims inside these margins so its modest accuracy still lands within the statute.
const GRADE_MARGIN = 0.995;
const CURVE_MARGIN = 0.99;
const BOUND_MARGIN = 0.005;
const SMOOTHING = 0.5;

type Limits = { V: DesignSpeed; grade: number; crest: number; sag: number; minLength: number };

function limitsFor(V: DesignSpeed, special: boolean): Limits {
  const grade = MAX_GRADE.value[V];
  const radius = VERTICAL_CURVE_RADIUS.value[V];
  // 第25条 bounds the grade too (it is the composite grade with no superelevation): at 20 km/h the
  // 第20条 特例 grade (12 %) is above the composite limit (11.5 %); at 30 km/h (11 %) it is not.
  const tabled = special ? grade.special : grade.standard;
  return {
    V,
    grade: Math.min(tabled, COMPOSITE_GRADE.value[V]),
    crest: radius.crest,
    sag: radius.sag,
    minLength: VERTICAL_CURVE_LENGTH.value[V],
  };
}

/**
 * Variables: Z_0..Z_m (knot elevations) then D_0..D_m (= h · grade): all in metres, so the problem
 * is well scaled. Continuity Z_{j+1} = Z_j + (D_j + D_{j+1}) / 2 is an equality row.
 */
function buildQp(input: VerticalInput, lim: Limits, lower: Float64Array): { qp: Qp; h: number; m: number } {
  const S = input.length;
  const m = Math.max(1, Math.floor(S / lim.minLength));
  const h = S / m;
  const n = 2 * (m + 1);
  const Zi = (j: number) => j;
  const Di = (j: number) => m + 1 + j;
  const P = new Float64Array(n * n);
  const q = new Float64Array(n);
  const rows: Qp["rows"] = [];
  const l: number[] = [];
  const u: number[] = [];
  const add = (row: Array<[number, number]>, lo: number, hi: number) => {
    rows.push(row);
    l.push(lo);
    u.push(hi);
  };
  for (let j = 0; j < m; j++)
    add(
      [
        [Zi(j + 1), 1],
        [Zi(j), -1],
        [Di(j), -0.5],
        [Di(j + 1), -0.5],
      ],
      0,
      0,
    );
  const gMax = lim.grade * h * GRADE_MARGIN;
  for (let j = 0; j <= m; j++) add([[Di(j), 1]], -gMax, gMax);
  const isShort = S < lim.minLength;
  for (let j = 0; j < m; j++) {
    const lo = isShort ? 0 : (-(h * h) / lim.crest) * CURVE_MARGIN;
    const hi = isShort ? 0 : ((h * h) / lim.sag) * CURVE_MARGIN;
    add(
      [
        [Di(j + 1), 1],
        [Di(j), -1],
      ],
      lo,
      hi,
    );
  }
  const w = 1 / input.stations.length;
  for (let k = 0; k < input.stations.length; k++) {
    const s = input.stations[k];
    const j = Math.min(m - 1, Math.floor(s / h));
    const t = (s - j * h) / h;
    // z(s) = Z_j + t·D_j + t²/2 · (D_{j+1} − D_j)
    const row: Array<[number, number]> = [
      [Zi(j), 1],
      [Di(j), t - (t * t) / 2],
      [Di(j + 1), (t * t) / 2],
    ];
    for (const [a, va] of row) {
      q[a] -= w * va * input.target[k];
      for (const [b, vb] of row) P[a * n + b] += w * va * vb;
    }
    const lo = lower[k] + BOUND_MARGIN;
    const hi = input.upper[k] - BOUND_MARGIN;
    const isBounded = Number.isFinite(lo) || Number.isFinite(hi);
    if (isBounded) add(row, Number.isFinite(lo) ? lo : -1e9, Number.isFinite(hi) ? hi : 1e9);
  }
  for (let j = 0; j < m; j++) {
    for (const [a, va] of [
      [Di(j + 1), 1],
      [Di(j), -1],
    ] as const) {
      for (const [b, vb] of [
        [Di(j + 1), 1],
        [Di(j), -1],
      ] as const)
        P[a * n + b] += SMOOTHING * va * vb;
    }
  }
  const { start, end } = input;
  if (start.z !== undefined) add([[Zi(0), 1]], start.z, start.z);
  if (start.grade !== undefined) add([[Di(0), 1]], start.grade * h, start.grade * h);
  if (end.z !== undefined) add([[Zi(m), 1]], end.z, end.z);
  if (end.grade !== undefined) add([[Di(m), 1]], end.grade * h, end.grade * h);
  return { qp: { n, P, q, rows, l: new Float64Array(l), u: new Float64Array(u) }, h, m };
}

/**
 * Rebuild the knots from the solution so continuity holds exactly, pin the end conditions exactly
 * (spreading the last metres of end-elevation error over the interior grades), and report the
 * worst violation of the exact (margin-free) constraints, or "" if there is none.
 */
function finish(
  input: VerticalInput,
  lim: Limits,
  lower: Float64Array,
  x: Float64Array,
  h: number,
  m: number,
): { profile: Omit<VerticalProfile, "steps">; worst: string } {
  const d = Array.from({ length: m + 1 }, (_, j) => x[m + 1 + j]);
  const { start, end } = input;
  if (start.grade !== undefined) d[0] = start.grade * h;
  if (end.grade !== undefined) d[m] = end.grade * h;
  const z0 = start.z ?? x[0];
  const z = [z0];
  for (let j = 0; j < m; j++) z.push(z[j] + (d[j] + d[j + 1]) / 2);
  const isPinnedEnd = end.z !== undefined;
  if (isPinnedEnd && m > 1) {
    const delta = (end.z! - z[m]) / (m - 1);
    for (let j = 1; j < m; j++) d[j] += delta;
    for (let j = 0; j < m; j++) z[j + 1] = z[j] + (d[j] + d[j + 1]) / 2;
  }
  const profile = {
    h,
    z,
    g: d.map((v) => v / h),
    V: lim.V,
    gradeLimit: lim.grade,
    crestRadius: lim.crest,
    sagRadius: lim.sag,
    minCurveLength: lim.minLength,
  };
  const problems: string[] = [];
  const maxGrade = Math.max(...profile.g.map(Math.abs));
  if (maxGrade > lim.grade + 1e-9)
    problems.push(`grade ${(maxGrade * 100).toFixed(2)}% > ${lim.grade * 100}%`);
  for (let j = 0; j < m; j++) {
    const k = (profile.g[j + 1] - profile.g[j]) / h;
    const isTooSharp = k < -1 / lim.crest - 1e-12 || k > 1 / lim.sag + 1e-12;
    if (isTooSharp)
      problems.push(`vertical curve R=${Math.round(1 / Math.abs(k))} at ${Math.round(j * h)} m`);
    const isTooShortCurve = Math.abs(k) > 1e-9 && h < lim.minLength - 1e-9;
    if (isTooShortCurve) problems.push(`curve length ${h.toFixed(1)} m < ${lim.minLength} m`);
  }
  let worstBound = 0;
  let worstAt = 0;
  for (let k = 0; k < input.stations.length; k++) {
    const { z: zs } = evalProfile(profile as VerticalProfile, input.stations[k]);
    const over = Math.max(lower[k] - zs, zs - input.upper[k]);
    if (over > worstBound) {
      worstBound = over;
      worstAt = input.stations[k];
    }
  }
  if (worstBound > 1e-3)
    problems.push(`clearance short by ${worstBound.toFixed(2)} m at ${Math.round(worstAt)} m`);
  const endMiss = isPinnedEnd ? Math.abs(z[m] - end.z!) : 0;
  if (endMiss > 1e-4) problems.push(`end elevation off by ${endMiss.toFixed(3)} m`);
  return { profile, worst: problems.join("; ") };
}

/**
 * Solve, falling back in the order of knowledge/road-redesign-plan.md 4.3 の 3: the 特例 grade, then lower design speeds,
 * then only the crossings' clearance. Every attempt is reported; nothing is relaxed silently.
 */
export function solveVertical(input: VerticalInput): VerticalResult {
  const plans: Array<{ V: DesignSpeed; special: boolean; crossingsOnly: boolean; step: FallbackStep[] }> = [
    { V: input.V, special: false, crossingsOnly: false, step: ["standard"] },
    { V: input.V, special: true, crossingsOnly: false, step: ["specialGrade"] },
  ];
  let v: DesignSpeed | null = input.V;
  while (v !== null && v > input.minV) {
    v = lowerDesignSpeed(v);
    if (v !== null)
      plans.push({ V: v, special: true, crossingsOnly: false, step: ["specialGrade", "lowerSpeed"] });
  }
  const lowest = plans[plans.length - 1];
  plans.push({ ...lowest, crossingsOnly: true, step: [...lowest.step, "crossingsOnly"] });
  const attempts: VerticalAttempt[] = [];
  for (const plan of plans) {
    const lim = limitsFor(plan.V, plan.special);
    const lower = plan.crossingsOnly ? input.lowerAtCrossings : input.lower;
    const { qp, h, m } = buildQp(input, lim, lower);
    const { x } = solveQp(qp);
    const { profile, worst } = finish(input, lim, lower, x, h, m);
    attempts.push({ V: plan.V, special: plan.special, crossingsOnly: plan.crossingsOnly, worst });
    if (worst === "") return { ok: true, profile: { ...profile, steps: plan.step }, attempts };
  }
  return { ok: false, attempts };
}
