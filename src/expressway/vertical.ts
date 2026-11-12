import {
  COMPOSITE_GRADE,
  type DesignSpeed,
  lowerDesignSpeed,
  MAX_GRADE,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../law/roadStandards";
import { hermite } from "./profile";
import { type Qp, QpBuilder, type QpResult, type QpStatus, solveQp } from "./qp";

/**
 * Vertical alignment (knowledge/road-redesign-plan.md 4.3). Each run's profile is a chain of equal parabolic arcs: knots
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
 * A short connecting road between two parents (`follow`, a 連結路 too short for two knot intervals)
 * has no variables of its own: its elevation is the cubic Hermite through the two parents' elevation
 * and grade at its ends (profile.ts), so it joins both C¹ by construction, and its grade and
 * curvature are judged on that cubic. Why not a chain of parabolas there: one arc with both ends'
 * elevation and grade fixed is four conditions on three unknowns (P2.5 left 22 such runs unsolved
 * as "curve length < 第22条").
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

/**
 * An end fixed by the ground. `band`: the elevation may be anywhere within ±band of z (a short run,
 * whose grade there is then free within the statute); else z exactly, and the grade if given.
 * `hard`: a block's anchor (compile.ts blocks: the value of the route solution on both sides of it),
 * z as a hard equality and the grade by a heavy square, both then set exactly by finish. Why not the
 * W_END rows of a ground end: those give way to a clearance by design, and an anchor that gave way
 * would leave a step between the two pieces.
 */
export type EndCondition = { z?: number; grade?: number; band?: number; hard?: boolean };
export type Zone = { from: number; to: number; V: DesignSpeed };
/**
 * A stretch [from, to] of the run whose profile is given (a structure override, structures.ts).
 * Inside `exact` (where `at` is a parabola of s: the bridge's straight girder) every knot takes the
 * elevation and grade of `at` as hard equalities; the arc rows z(s + h) − z(s) = h (z′(s) + z′(s + h))
 * / 2 then hold exactly (the trapezoid rule is exact for a quadratic). Over the rest of [from, to]
 * (the anchorages, where the deck may turn off the axis and `at` is only nearly a parabola) every
 * PIN_GRID_M station is drawn to `at` by a heavy square, so the arcs follow it as closely as
 * parabolic arcs can. Why not hard rows there too: with the elevations at every knot the arcs are
 * over-determined, and a near-parabola makes the equalities inconsistent (no solution); pinning the
 * elevations alone carries the grade from knot to knot with an error that alternates and grows.
 */
export type ProfilePin = {
  from: number;
  to: number;
  exact: [number, number];
  at: (s: number) => { z: number; grade: number };
};

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
  /**
   * The part of `lower` that the statute asks (the building limit over a crossed road or railway,
   * 第12条); the rest of `lower` is an assumed floor (the standard height over open ground, the deck
   * not sunk into the DEM). Absent: all of `lower` counts as the statute's.
   */
  lowerLaw?: Float64Array;
  /**
   * The assumed standard floor over open ground (outside the climbs from low ends), judged even
   * where `lower` leaves it out (the "crossings only" fallback). Absent: no such floor.
   */
  lowerOpen?: Float64Array;
  /**
   * The last fallback step: the assumed part of `lower` gets its own, weaker row (W_FLOOR), so it
   * gives way before the statute's. Otherwise `lower` is one row at a clearance's weight.
   */
  assumedGive?: boolean;
  /**
   * Hold the run at this profile (same zones, so the same knots): compile.ts puts shed ramps back
   * around main lines solved without them.
   */
  pinned?: VerticalProfile;
  /** Ends fixed by the ground (a junction end is a `Coupling`). */
  start: EndCondition;
  end: EndCondition;
  /** A short connecting road whose profile is the cubic between these two parents' points. */
  follow?: { start: Ref; end: Ref };
  /** Stretches pinned to a structure's profile (empty for an ordinary run). */
  pins?: ProfilePin[];
  /**
   * Run distance of this input's s = 0 in the problems' texts ("at N m"): a piece of a run cut at
   * anchors (compile.ts blocks) reports where on its run, as the diagnostics name runs. Absent: 0.
   */
  textOffset?: number;
  /**
   * Objective v2 (P2.7-3): the L1 weight per metre of each arc's grade change (the next knot's grade
   * less this one's, times the knot spacing), on top of W_SMOOTH's square. Absent: none (v1).
   */
  gradeChange?: number;
  /** Objective v2: W_TARGET times this (absent: W_TARGET itself, v1). */
  targetScale?: number;
  /**
   * A height build (P2.7-6 PR 1): how far a station may miss `lowerLaw` and be marked `give: "girder"`
   * (a thinner girder takes it), and the stations whose `lowerLaw` is a road near a low end (1: marked
   * `give: "near"` when missed). The rows are the same; only the problems say more. Absent: none.
   */
  lawGive?: number;
  lawNear?: Uint8Array;
};

export type Ref = { run: string; s: number };

export type Coupling =
  /**
   * The child's end takes the parent's elevation and grade at parent.s. `hard`: as hard equalities
   * (a piece following the one before it across an anchor in a route solution, compile.ts).
   */
  | { kind: "junction"; child: string; atStart: boolean; parent: Ref; hard?: boolean }
  /**
   * lo ≤ z(a) − z(b) ≤ hi. `firm`: a clearance that decides whether a run is solved (a crossing);
   * otherwise a preference between overlapping decks (one surface or a level apart) that gives way
   * to every clearance and end, so contradictions in the OSM tags or lines surface as deck_overlap
   * diagnostics instead of unsolved runs. A nose (from the node a branch shares with its parent
   * to where their carriageways part) is such a pair too. Why not hold it as firmly as the junction
   * (tried in P2.6, the P2.5 review's (e)): over the ward area it cut the branch-parent overlaps from
   * 39 to 7 pairs but left ~50 more runs unsolved, and in the test section it sank 都心環状線外回り
   * 2.57 m under its floor to let an exit leave (unsolved, with 18 runs hanging from it). Having the
   * branch alone follow its parent's surface from the solve before was worse (39 → 126 pairs: the
   * parent moved by centimetres between solves).
   */
  | {
      kind: "within";
      a: Ref;
      b: Ref;
      lo: number;
      hi: number;
      firm: boolean;
    };

export type VerticalProfile = {
  /** Knot spacing (m); for a cubic, the run length. */
  h: number;
  /** Elevation at each knot. */
  z: number[];
  /** Grade at each knot. */
  g: number[];
  /** One cubic Hermite through (0, z[0], g[0]) and (h, z[1], g[1]) instead of parabolas. */
  cubic?: boolean;
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
  p: Pick<VerticalProfile, "h" | "z" | "g" | "cubic">,
  s: number,
): { z: number; grade: number } {
  if (p.cubic) return hermite(0, p.z[0], p.g[0], p.h, p.z[1], p.g[1], Math.min(p.h, Math.max(0, s)));
  const m = p.z.length - 1;
  const j = Math.min(m - 1, Math.max(0, Math.floor(s / p.h)));
  const t = s - j * p.h;
  const g0 = p.g[j];
  const g1 = p.g[j + 1];
  const k = (g1 - g0) / p.h;
  return { z: p.z[j] + g0 * t + (k * t * t) / 2, grade: g0 + k * t };
}

/** Second derivative of a cubic profile at s (a parabola chain's is constant per arc). */
function cubicCurvature(p: Pick<VerticalProfile, "h" | "z" | "g">, s: number): number {
  const S = p.h;
  const t = Math.min(1, Math.max(0, s / S));
  return (
    ((12 * t - 6) * p.z[0] + (6 * t - 4) * S * p.g[0] + (6 - 12 * t) * p.z[1] + (6 * t - 2) * S * p.g[1]) /
    (S * S)
  );
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
/** The largest end-elevation error finish() spreads over the free grades (the QP's leftovers). */
const SPREAD_MAX_M = 0.1;
/** Inside a ground end's elevation band by this much, for the same reason. */
const BAND_MARGIN = 0.01;
/** Objective weights: staying near the target per station, and a smooth grade per arc. */
const W_TARGET = 0.004;
const W_SMOOTH = 0.5;
/**
 * Objective v2 (P2.7-3): the L1 weight of an arc's grade change (RunInput.gradeChange), per metre of
 * (g[j+1] − g[j]) · h. The compiler passes it only when `--objective v2` asks (compile.ts Objective).
 * 1.5 from the P2.7-3 sweep over ship/pruned (knowledge/expressway-generation.md「P2.7-3」): the
 * fewest reversals with every solve converged. Why not 2: a component of 11 runs broke down there
 * (tests/fixtures/expresswayQpObjectiveV2.json). That is no edge past 1.5 but the interior point's
 * end test: over 500 weights in 1–3 that QP breaks at 13 (about 2–3 %, scattered, 2 and 2 − 1 ulp
 * broken, 2 + 1 ulp converging) and at none of 100 in 1.4–1.6, so 1.5 can break too elsewhere. A
 * second solve at a looser dual tolerance, only for a solve that did not converge, rescues all 13
 * and leaves every converged solve as it is (RETRY_DUAL_TOL, solveJoint; P2.7-5).
 */
export const W_GRADE_CHANGE = 1.5;
/**
 * L1 weights, in order of what gives way first: overlapping decks' relation and noses (5), then an
 * assumed floor (50), then the statute's clearance (crossings: 200, 40× a pair), then an end or a
 * junction (2000, 10× a clearance). A deck may be moved off a shared surface to keep a clearance, and a clearance gives
 * way to an end, as long as one metre of the higher kind costs more than the lower kind it spares;
 * the weights are per row, so many violated pair rows can still outweigh one clearance row (not a
 * strict priority: a lexicographic solve would be).
 */
const W_PAIR = 5;
/** An assumed floor (standard height over open ground, the DEM): below the statute's clearance. */
const W_FLOOR = 50;
const W_BOUND = 200;
const W_END = 2000;
/** Points (as fractions of the run) where a cubic connector's grade is held within the limit. */
const CUBIC_GRADE_POINTS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
/** Spacing of the exact check of a cubic connector's grade and curvature (as checks.checkSurface). */
const CUBIC_CHECK_M = 1;
/**
 * A structure's profile off its exact stretch (ProfilePin): a square per PIN_GRID_M station, heavy
 * enough that a centimetre off costs more than every other row near it (W_END's metre is 2000).
 */
const W_PIN = 1e5;
const PIN_GRID_M = 5;

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
  /** For a cubic connector: the parents' layouts and where on them its ends are. */
  follow?: { a: Layout; sa: number; b: Layout; sb: number };
  /** Knots pinned by a structure: elevation and grade. */
  pinned: Map<number, { z: number; grade: number }>;
};

function speedsWithin(zones: Zone[], a: number, b: number): DesignSpeed[] {
  const out = zones.filter((z) => z.to >= a && z.from <= b).map((z) => z.V);
  return out.length > 0 ? out : [zones[zones.length - 1].V];
}

/**
 * Knot intervals of a run's parabola chain: as many as fit the 第22条 minimum curve length of its
 * highest design speed (at least one). A cubic connector has one.
 */
export function knotIntervals(length: number, zones: Zone[], isConnector: boolean): number {
  const maxV = Math.max(...zones.map((z) => z.V)) as DesignSpeed;
  return isConnector ? 1 : Math.max(1, Math.floor(length / VERTICAL_CURVE_LENGTH.value[maxV]));
}

function layoutOf(input: RunInput, off: number): Layout {
  const S = input.length;
  const maxV = Math.max(...input.zones.map((z) => z.V)) as DesignSpeed;
  const minLength = VERTICAL_CURVE_LENGTH.value[maxV];
  const m = knotIntervals(S, input.zones, input.follow !== undefined);
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
  // Knots on a pin's exact stretch take the structure's elevation and grade.
  const pinned = new Map<number, { z: number; grade: number }>();
  for (const pin of input.pins ?? []) {
    for (let j = 0; j <= m; j++) {
      const isExact = j * h >= pin.exact[0] - 1e-6 && j * h <= pin.exact[1] + 1e-6;
      if (isExact) pinned.set(j, pin.at(j * h));
    }
  }
  return { input, off, m, h, isShort: S < minLength, maxV, minLength, gradeLimit, crest, sag, pinned };
}

const Zi = (L: Layout, j: number) => L.off + j;
const Di = (L: Layout, j: number) => L.off + L.m + 1 + j;

/** Cubic Hermite basis at t (value) and its first and second derivatives in t. */
function basis(t: number): { v: number[]; d1: number[]; d2: number[] } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    v: [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2],
    d1: [6 * t2 - 6 * t, 3 * t2 - 4 * t + 1, -6 * t2 + 6 * t, 3 * t2 - 2 * t],
    d2: [12 * t - 6, 6 * t - 4, 6 - 12 * t, 6 * t - 2],
  };
}

type Row = Array<[number, number]>;

/**
 * A cubic connector's (z, grade · S, z, grade · S at its two ends) combined with weights w as a row
 * over the parents' variables: Σ w_i · end_i.
 */
function cubicRow(L: Layout, w: number[], scale: number, depth: number): Row {
  const f = L.follow!;
  const S = L.input.length;
  return [
    ...zRow(f.a, f.sa, scale * w[0], depth + 1),
    ...gradeRow(f.a, f.sa, scale * w[1] * S, depth + 1),
    ...zRow(f.b, f.sb, scale * w[2], depth + 1),
    ...gradeRow(f.b, f.sb, scale * w[3] * S, depth + 1),
  ];
}

/** Connectors following connectors deeper than this are a cycle (compile.ts never builds one). */
const MAX_FOLLOW_DEPTH = 16;

/** scale · z(s) as a row over the variables: Z_j + t·D_j + t²/2 · (D_{j+1} − D_j) on a parabola. */
function zRow(L: Layout, s: number, scale = 1, depth = 0): Row {
  if (depth > MAX_FOLLOW_DEPTH) throw new Error(`cubic connectors in a cycle at ${L.input.id}`);
  if (L.follow) return cubicRow(L, basis(Math.min(1, Math.max(0, s / L.input.length))).v, scale, depth);
  const j = Math.min(L.m - 1, Math.max(0, Math.floor(s / L.h)));
  const t = Math.min(1, Math.max(0, (s - j * L.h) / L.h));
  return [
    [Zi(L, j), scale],
    [Di(L, j), scale * (t - (t * t) / 2)],
    [Di(L, j + 1), scale * ((t * t) / 2)],
  ];
}

/** scale · grade(s) = scale / h · (D_j + t (D_{j+1} − D_j)) on a parabola. */
function gradeRow(L: Layout, s: number, scale: number, depth = 0): Row {
  if (depth > MAX_FOLLOW_DEPTH) throw new Error(`cubic connectors in a cycle at ${L.input.id}`);
  if (L.follow) {
    const S = L.input.length;
    return cubicRow(L, basis(Math.min(1, Math.max(0, s / S))).d1, scale / S, depth);
  }
  const j = Math.min(L.m - 1, Math.max(0, Math.floor(s / L.h)));
  const t = Math.min(1, Math.max(0, (s - j * L.h) / L.h));
  const k = scale / L.h;
  return [
    [Di(L, j), k * (1 - t)],
    [Di(L, j + 1), k * t],
  ];
}

function merge(row: Row): Row {
  const acc = new Map<number, number>();
  for (const [c, v] of row) acc.set(c, (acc.get(c) ?? 0) + v);
  return [...acc.entries()].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
}

/**
 * Where and why a run's exact constraints fail. `law`: a statute limit (第12・20・22条); `assumed`:
 * a floor the project assumes (the standard height over open ground, the deck not sunk more than
 * 0.25 m into the DEM); `coupling`: an end, a junction or a structure's profile (ProfilePin) that
 * cannot be met.
 */
export type ProblemBasis = "law" | "assumed" | "coupling";
export type RunProblem = {
  what:
    | "grade"
    | "curve"
    | "curveLength"
    | "crossing"
    | "floor"
    | "sunk"
    | "end"
    | "start"
    | "structure"
    | "solver";
  basis: ProblemBasis;
  /** Run distance of the worst point (m). */
  s: number;
  /** How much it misses by (m, or the grade / curvature excess). */
  by: number;
  text: string;
  /** The other run of a coupling it misses (a crossing), and where on it. */
  partner?: Ref;
  /**
   * A miss of the statute's clearance that a height build (P2.7-6 PR 1, compile.ts isFailing) does not
   * count against the run: `girder`, short by no more than a thinner girder takes (RunInput.lawGive);
   * `near`, a road within the climb of a low end (RunInput.lawNear), blocked once solved.
   */
  give?: "girder" | "near";
};

export type JointResult = {
  profiles: Map<string, VerticalProfile>;
  /** Violations of each run's exact constraints (its own bounds, statute limits, ends, junctions). */
  problems: Map<string, RunProblem[]>;
  /** Size of the QP (for the build log). */
  variables: number;
  rows: number;
  iterations: number;
  /** The solver's verdict (qp.ts); anything but "converged" means the profiles are not a solution. */
  status: QpStatus;
  residuals: { primal: number; dual: number; gap: number };
  /** The first solve did not converge and was solved again at RETRY_DUAL_TOL (P2.7-5 4.1). */
  retried: boolean;
};

/**
 * The dual tolerance of the second solve, only for a QP whose first solve did not converge (qp.ts
 * keeps 1e-6). The interior point broke down past where it should have stopped: at 32 iterations the
 * gap met gapTol and the primal residual was 1.6e-12, but the dual 1.34e-6 stood a hair over 1e-6;
 * pushed on, D spread to 6e-15–1e17 and the 37th iteration was NaN (knowledge/expressway-generation.md
 * 「P2.7-3」の「未収束」). Over 500 weights of the saved QP 13 broke so, and at 1e-5 all 13 converge.
 * Why not 1e-5 for every solve: a solve that converged would stop earlier and move every deck (v1
 * included) by the solver's last digits; a retry leaves those bit for bit as they are. Why not a
 * looser gapTol or more regularisation: not the type seen (another type is saved and reported).
 */
export const RETRY_DUAL_TOL = 1e-5;

/**
 * solveQp, and only if that did not converge a second solve at RETRY_DUAL_TOL (the converged first
 * solve is returned as it is). `iterations` counts both solves.
 */
export function solveRetrying(qp: Qp): { result: QpResult; retried: boolean; iterations: number } {
  const first = solveQp(qp);
  const isConverged = first.status === "converged";
  if (isConverged) return { result: first, retried: false, iterations: first.iterations };
  const second = solveQp(qp, { dualTol: RETRY_DUAL_TOL });
  return { result: second, retried: true, iterations: first.iterations + second.iterations };
}

const byId = (a: RunInput, b: RunInput) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Solve runs and their couplings as one QP, then make each run's profile exact and check it. */
export function solveJoint(runs: RunInput[], couplings: Coupling[]): JointResult {
  const qp = new QpBuilder();
  const layouts = new Map<string, Layout>();
  for (const input of [...runs].sort(byId)) {
    // A cubic connector has no variables of its own to hold a structure's profile with.
    const isPinnedConnector = input.follow !== undefined && (input.pins?.length ?? 0) > 0;
    if (isPinnedConnector) throw new Error(`cubic connector ${input.id} cannot carry structure pins`);
    if (input.follow) {
      layouts.set(input.id, layoutOf(input, -1));
      continue;
    }
    const probe = layoutOf(input, 0);
    const off = qp.addVars(2 * (probe.m + 1));
    layouts.set(input.id, layoutOf(input, off));
  }
  for (const L of layouts.values()) {
    const f = L.input.follow;
    if (!f) continue;
    const a = layouts.get(f.start.run);
    const b = layouts.get(f.end.run);
    if (!a || !b) throw new Error(`cubic connector ${L.input.id} without both parents in the problem`);
    L.follow = { a, sa: f.start.s, b, sb: f.end.s };
  }
  for (const L of layouts.values()) {
    if (L.follow) addCubicRows(qp, L);
    else addArcRows(qp, L);
    const { input } = L;
    // Why not W_TARGET × (targetScale ?? 1): v1 keeps the very weight it had, not a product.
    const targetWeight = input.targetScale === undefined ? W_TARGET : W_TARGET * input.targetScale;
    for (let k = 0; k < input.stations.length; k++) {
      const row = merge(zRow(L, input.stations[k]));
      if (!L.follow) qp.addSquare(row, input.target[k], targetWeight);
      // At the give step the statute's floor (a crossing) and the assumed one are separate rows, so
      // the assumed floor gives way first (W_FLOOR < W_BOUND); before it, one row as in P2.5.
      const law = input.lowerLaw && input.assumedGive ? input.lowerLaw[k] : input.lower[k];
      const hasLaw = Number.isFinite(law);
      const hi = input.upper[k] - BOUND_MARGIN;
      const hasCeiling = Number.isFinite(hi);
      if (hasLaw || hasCeiling)
        qp.addRow(row, hasLaw ? law + BOUND_MARGIN : -Infinity, hasCeiling ? hi : Infinity, W_BOUND);
      const isAssumedAbove = Number.isFinite(input.lower[k]) && (!hasLaw || input.lower[k] > law + 1e-9);
      if (isAssumedAbove) qp.addRow(row, input.lower[k] + BOUND_MARGIN, Infinity, W_FLOOR);
    }
  }
  for (const c of couplings) {
    if (c.kind === "junction") {
      const child = layouts.get(c.child);
      const parent = layouts.get(c.parent.run);
      // A cubic connector meets its parents by construction.
      if (!child || !parent || child.follow) continue;
      const j = c.atStart ? 0 : child.m;
      const weight = c.hard ? Infinity : W_END;
      qp.addRow(merge([[Zi(child, j), 1], ...zRow(parent, c.parent.s, -1)]), 0, 0, weight);
      qp.addRow(merge([[Di(child, j), 1], ...gradeRow(parent, c.parent.s, -child.h)]), 0, 0, weight);
      continue;
    }
    const a = layouts.get(c.a.run);
    const b = layouts.get(c.b.run);
    if (!a || !b) continue;
    const lo = Number.isFinite(c.lo) ? c.lo + COUPLING_MARGIN : -Infinity;
    const hi = Number.isFinite(c.hi) ? c.hi - COUPLING_MARGIN : Infinity;
    const row = merge([...zRow(a, c.a.s), ...zRow(b, c.b.s, -1)]);
    // Both points on parents of one cubic connector can cancel out entirely: nothing to hold then.
    if (row.length === 0) continue;
    const weight = c.firm ? W_BOUND : W_PAIR;
    qp.addRow(row, lo, hi, weight);
  }
  const built = qp.build();
  const { result: res, retried, iterations } = solveRetrying(built);
  const { profiles, problems } = finish(layouts, couplings, res.x);
  return {
    profiles,
    problems,
    variables: built.n,
    rows: built.rows.length,
    iterations,
    status: res.status,
    residuals: { primal: res.primalResidual, dual: res.dualResidual, gap: res.gap },
    retried,
  };
}

/** A run held at an earlier profile (`pinned`) whose knots no longer fit its layout. */
export class PinMismatchError extends Error {
  constructor(run: string, pinned: number | "cubic", knots: number) {
    super(`run ${run}: pinned profile has ${pinned} knots, its layout ${knots}`);
    this.name = "PinMismatchError";
  }
}

/** A parabola chain's own rows: continuity, the statute's grade and curvature, its ground ends. */
function addArcRows(qp: QpBuilder, L: Layout): void {
  const { m, h, input } = L;
  const pin = input.pinned;
  const isPinnable = pin !== undefined && !pin.cubic && pin.z.length === m + 1;
  // A pin that does not fit the layout used to be dropped without a word, the run solved afresh
  // under runs held where they were. Why not keep that: the pass that puts shed ramps back promises
  // the solved runs stay put, and a silent re-solve broke it unseen (P2.7-3a). It stops the build.
  const isMisfit = pin !== undefined && !isPinnable;
  if (isMisfit) throw new PinMismatchError(input.id, pin.cubic ? "cubic" : pin.z.length, m + 1);
  if (isPinnable) {
    // Its knots as they are and nothing else: the profile was judged already, and its own limits as
    // hard rows (with the QP's margins) could contradict the pin by the last fraction of a percent.
    for (let j = 0; j <= m; j++) {
      qp.addRow([[Zi(L, j), 1]], pin.z[j], pin.z[j]);
      qp.addRow([[Di(L, j), 1]], pin.g[j] * h, pin.g[j] * h);
    }
    return;
  }
  // A structure's profile is a hard equality: the deck must meet the model's floor beams.
  for (const [j, v] of L.pinned) {
    qp.addRow([[Zi(L, j), 1]], v.z, v.z);
    qp.addRow([[Di(L, j), 1]], v.grade * h, v.grade * h);
  }
  for (const p of input.pins ?? []) {
    const n = Math.max(1, Math.ceil((p.to - p.from) / PIN_GRID_M));
    for (let k = 0; k <= n; k++) {
      const sv = p.from + ((p.to - p.from) * k) / n;
      qp.addSquare(merge(zRow(L, sv)), p.at(sv).z, W_PIN);
    }
  }
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
  // A hard end (an anchor) gives its knot's grade: no limit row there. Why not keep it: the value
  // comes from a finished profile, which may stand a hair past GRADE_MARGIN of the limit (within the
  // statute); with both hard, ship/pruned had blocks with no solution at all (NaN, P2.7-2).
  const isGiven = (j: number) => (j === 0 && input.start.hard) || (j === m && input.end.hard);
  for (let j = 0; j <= m; j++) {
    if (isGiven(j)) continue;
    const gMax = L.gradeLimit[j] * h * GRADE_MARGIN;
    qp.addRow([[Di(L, j), 1]], -gMax, gMax);
  }
  const hasGradeChange = input.gradeChange !== undefined && input.gradeChange > 0;
  for (let j = 0; j < m; j++) {
    const lo = L.isShort ? 0 : (-(h * h) / L.crest[j]) * CURVE_MARGIN;
    const hi = L.isShort ? 0 : ((h * h) / L.sag[j]) * CURVE_MARGIN;
    const diff: Row = [
      [Di(L, j), -1],
      [Di(L, j + 1), 1],
    ];
    qp.addRow(diff, lo, hi);
    qp.addSquare(diff, 0, W_SMOOTH);
    // Objective v2: the grade change in L1 too. Summed over the arcs it is the grade's total
    // variation: a climb that is needed costs the same however it is shaped, and what it takes out
    // is the grade going one way and back (a reversal over a bump of the target). The row is h · Δg
    // (metres), so for the same Δg it weighs more where the knots stand further apart (higher V).
    // Why not a heavier W_SMOOTH instead: a square spreads a turn over many arcs (each small change
    // is cheap) and keeps the back-and-forth small rather than gone. Not on a short run (its
    // curvature is already held at 0) nor between two knots a structure fixes (nothing to choose).
    const isFixedArc = L.pinned.has(j) && L.pinned.has(j + 1);
    const isWeighed = hasGradeChange && !L.isShort && !isFixedArc;
    if (isWeighed) qp.addRow(diff, 0, 0, input.gradeChange!);
  }
  const { start, end } = input;
  const endRow = (j: number, e: EndCondition) => {
    if (e.hard) {
      qp.addRow([[Zi(L, j), 1]], e.z!, e.z!);
      // The grade by a heavy square (W_PIN), not a second hard row: with both hard, 1 of the 195
      // block solves of ship/pruned broke down (NaN after 35 iterations, P2.7-2) and converged in 31
      // with this; finish then sets the knot's grade to the anchor's exactly (C¹ by construction).
      qp.addSquare([[Di(L, j), 1]], e.grade! * h, W_PIN);
      return;
    }
    if (e.z !== undefined) {
      const band = e.band === undefined ? 0 : Math.max(0, e.band - BAND_MARGIN);
      qp.addRow([[Zi(L, j), 1]], e.z - band, e.z + band, W_END);
    }
    if (e.grade !== undefined) qp.addRow([[Di(L, j), 1]], e.grade * h, e.grade * h, W_END);
  };
  endRow(0, start);
  endRow(m, end);
}

/**
 * A cubic connector's rows (soft, over its parents' variables): the grade within the limit at
 * CUBIC_GRADE_POINTS and the curvature within 第22条's radii at both ends (it is linear in s, so the
 * ends bound it). Soft so the parents can never be made infeasible by a connector; `finish` judges.
 */
function addCubicRows(qp: QpBuilder, L: Layout): void {
  const S = L.input.length;
  for (const t of CUBIC_GRADE_POINTS) {
    const s = t * S;
    const limit = gradeLimitFor(zoneSpeedAt(L.input.zones, s), L.input.special) * GRADE_MARGIN;
    qp.addRow(merge(cubicRow(L, basis(t).d1, 1 / S, 0)), -limit, limit, W_END);
  }
  for (const t of [0, 1]) {
    const r = VERTICAL_CURVE_RADIUS.value[zoneSpeedAt(L.input.zones, t * S)];
    const row = merge(cubicRow(L, basis(t).d2, 1 / (S * S), 0));
    qp.addRow(row, (-1 / r.crest) * CURVE_MARGIN, (1 / r.sag) * CURVE_MARGIN, W_END);
  }
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

/** An end's exact elevation: z, or the value v clamped into z's band; v when the end is free. */
function endElevation(e: EndCondition, v: number): number {
  if (e.z === undefined) return v;
  if (e.band === undefined) return e.z;
  return Math.min(e.z + e.band, Math.max(e.z - e.band, v));
}

function finish(
  layouts: Map<string, Layout>,
  couplings: Coupling[],
  x: Float64Array,
): { profiles: Map<string, VerticalProfile>; problems: Map<string, RunProblem[]> } {
  const ids = [...layouts.keys()].sort();
  const profiles = new Map<string, VerticalProfile>();
  const problems = new Map<string, RunProblem[]>();
  const junctionAt = (id: string, atStart: boolean) =>
    couplings.find(
      (c): c is Extract<Coupling, { kind: "junction" }> =>
        c.kind === "junction" && c.child === id && c.atStart === atStart,
    );
  for (const id of finishOrder(ids, couplings)) {
    const L = layouts.get(id)!;
    const profile = L.follow ? cubicProfile(L, profiles) : arcProfile(L, x, profiles, junctionAt);
    if (!profile) {
      problems.set(id, [
        {
          what: "end",
          basis: "coupling",
          s: 0,
          by: Infinity,
          text: "a parent of the connector has no profile",
        },
      ]);
      continue;
    }
    profiles.set(id, profile.profile);
    const isFinite = profile.profile.z.every(Number.isFinite) && profile.profile.g.every(Number.isFinite);
    if (!isFinite) {
      problems.set(id, [
        { what: "solver", basis: "law", s: 0, by: Infinity, text: "the solver returned no finite profile" },
      ]);
      continue;
    }
    const out = L.follow ? checkCubic(L, profile.profile) : checkArcs(L, profile.profile);
    out.push(...checkBounds(L.input, profile.profile), ...profile.endProblems);
    problems.set(id, out);
  }
  return { profiles, problems };
}

type Built = { profile: VerticalProfile; endProblems: RunProblem[] };

function profileOf(L: Layout, h: number, z: number[], g: number[], cubic: boolean): VerticalProfile {
  return {
    h,
    z,
    g,
    ...(cubic ? { cubic: true } : {}),
    V: L.maxV,
    zones: L.input.zones,
    special: L.input.special,
    gradeLimit: L.gradeLimit,
    crestRadius: L.crest,
    sagRadius: L.sag,
    minCurveLength: L.minLength,
  };
}

/** A cubic connector's profile from its parents' finished profiles. */
function cubicProfile(L: Layout, profiles: Map<string, VerticalProfile>): Built | null {
  const f = L.input.follow!;
  const pa = profiles.get(f.start.run);
  const pb = profiles.get(f.end.run);
  if (!pa || !pb) return null;
  const a = evalProfile(pa, f.start.s);
  const b = evalProfile(pb, f.end.s);
  return { profile: profileOf(L, L.input.length, [a.z, b.z], [a.grade, b.grade], true), endProblems: [] };
}

/**
 * A parabola chain's exact profile from the QP's solution: the ends set to their parent's value or
 * into their ground band, a structure's pinned knots (ProfilePin) set to the structure's elevation
 * and grade, and the remaining elevation error before each fixed knot (a pinned knot, a pinned end)
 * spread over the free grades since the previous one (the interior knots no pin holds, and an end
 * grade left free). Without pins this is one stretch from the start to the end.
 */
function arcProfile(
  L: Layout,
  x: Float64Array,
  profiles: Map<string, VerticalProfile>,
  junctionAt: (id: string, atStart: boolean) => Extract<Coupling, { kind: "junction" }> | undefined,
): Built {
  const { m, h, input } = L;
  const d = Array.from({ length: m + 1 }, (_, j) => x[Di(L, j)]);
  const pinned = (atStart: boolean): EndCondition => {
    const j = junctionAt(input.id, atStart);
    const parent = j ? profiles.get(j.parent.run) : undefined;
    if (parent) return evalProfile(parent, j!.parent.s);
    return atStart ? input.start : input.end;
  };
  const s0 = pinned(true);
  const s1 = pinned(false);
  if (s0.grade !== undefined) d[0] = s0.grade * h;
  if (s1.grade !== undefined) d[m] = s1.grade * h;
  for (const [j, v] of L.pinned) d[j] = v.grade * h;
  const z = Array.from({ length: m + 1 }, () => 0);
  z[0] = endElevation(s0, L.pinned.get(0)?.z ?? x[Zi(L, 0)]);
  const integrate = (from: number, to: number) => {
    for (let j = from; j < to; j++) z[j + 1] = z[j] + (d[j] + d[j + 1]) / 2;
  };
  const isPinnedEnd = s1.z !== undefined;
  // The fixed knots after the start, in order: a structure's pinned knots, then a pinned end.
  const anchors = [...L.pinned.keys()].filter((j) => j > 0).sort((p, q) => p - q);
  const isEndAnchor = isPinnedEnd && !L.pinned.has(m);
  if (isEndAnchor) anchors.push(m);
  let from = 0;
  for (const b of anchors) {
    integrate(from, b);
    const isEnd = b === m && isEndAnchor;
    const target = isEnd ? endElevation(s1, z[m]) : L.pinned.get(b)!.z;
    // z[b] = z[from] + d[from]/2 + Σ interior d + d[b]/2: an equal change δ on every free grade moves
    // z[b] by δ · (interior count + ½ per free end), and keeps the arcs' curvature differences as
    // they were where both neighbours change.
    const free: Array<[number, number]> = [];
    for (let j = from + 1; j < b; j++) if (!L.pinned.has(j)) free.push([j, 1]);
    const isFreeStart = from === 0 && s0.grade === undefined && !L.pinned.has(0);
    if (isFreeStart) free.push([0, 0.5]);
    const isFreeEnd = isEnd && s1.grade === undefined;
    if (isFreeEnd) free.push([m, 0.5]);
    const weight = free.reduce((n, [, w]) => n + w, 0);
    const miss = target - z[b];
    // Only the last centimetres: a larger miss is reported as one (spread, it would show up as a
    // grade over the limit somewhere else instead).
    const isSpreadable = weight > 0 && Math.abs(miss) > 0 && Math.abs(miss) <= SPREAD_MAX_M;
    if (isSpreadable) {
      for (const [j] of free) d[j] += miss / weight;
      integrate(from, b);
    }
    from = b;
  }
  integrate(from, m);
  const endProblems: RunProblem[] = [];
  const endMiss = isPinnedEnd ? Math.abs(z[m] - endElevation(s1, z[m])) : 0;
  if (endMiss > 1e-3)
    endProblems.push({
      what: "end",
      basis: "coupling",
      s: input.length,
      by: endMiss,
      text: `end elevation off by ${endMiss.toFixed(3)} m`,
    });
  const startMiss = s0.z !== undefined ? Math.abs(z[0] - endElevation(s0, z[0])) : 0;
  if (startMiss > 1e-3)
    endProblems.push({
      what: "start",
      basis: "coupling",
      s: 0,
      by: startMiss,
      text: `start elevation off by ${startMiss.toFixed(3)} m`,
    });
  return {
    profile: profileOf(
      L,
      h,
      z,
      d.map((v) => v / h),
      false,
    ),
    endProblems,
  };
}

/** 第20条 on every knot and 第22条 on every arc of a parabola chain. */
/** "N" of "at N m": a distance of the input rounded to the metre, on its run (textOffset). */
function metreOf(input: RunInput, s: number): number {
  const off = input.textOffset;
  return off === undefined ? Math.round(s) : Math.round(s + off);
}

function checkArcs(L: Layout, profile: VerticalProfile): RunProblem[] {
  const { m, h } = L;
  const out: RunProblem[] = [];
  for (let j = 0; j <= m; j++) {
    const over = Math.abs(profile.g[j]) - L.gradeLimit[j];
    if (over > 1e-9)
      out.push({
        what: "grade",
        basis: "law",
        s: j * h,
        by: over,
        text: `grade ${(profile.g[j] * 100).toFixed(2)}% > ${(L.gradeLimit[j] * 100).toFixed(1)}% at ${metreOf(L.input, j * h)} m`,
      });
  }
  for (let j = 0; j < m; j++) {
    const k = (profile.g[j + 1] - profile.g[j]) / h;
    const isTooSharp = L.isShort
      ? Math.abs(k) > 1e-9
      : k < -1 / L.crest[j] - 1e-12 || k > 1 / L.sag[j] + 1e-12;
    if (!isTooSharp) continue;
    out.push(
      L.isShort
        ? {
            what: "curveLength",
            basis: "law",
            s: (j + 0.5) * h,
            by: L.minLength - h,
            text: `curve length ${h.toFixed(1)} m < ${L.minLength} m`,
          }
        : {
            what: "curve",
            basis: "law",
            s: (j + 0.5) * h,
            by: Math.abs(k),
            text: `vertical curve R=${Math.round(1 / Math.abs(k))} at ${metreOf(L.input, j * h)} m`,
          },
    );
  }
  for (const [j, v] of L.pinned) {
    const miss = Math.abs(profile.z[j] - v.z) + Math.abs(profile.g[j] - v.grade) * h;
    if (miss > 1e-3)
      out.push({
        what: "structure",
        basis: "coupling",
        s: j * h,
        by: miss,
        text: `structure profile off by ${miss.toFixed(3)} m at ${metreOf(L.input, j * h)} m`,
      });
  }
  return out;
}

/**
 * A cubic connector's grade and curvature every CUBIC_CHECK_M against the zone there, as the data
 * test reads the surface (checks.checkSurface). No minimum curve length: 第22条 does not bind a
 * 連結路 (第28条第4項), and the curvature itself is held to its radii.
 */
function checkCubic(L: Layout, profile: VerticalProfile): RunProblem[] {
  const S = L.input.length;
  const out: RunProblem[] = [];
  let worstGrade: RunProblem | null = null;
  let worstCurve: RunProblem | null = null;
  for (let s = 0; s <= S + 1e-9; s += Math.min(CUBIC_CHECK_M, S)) {
    const V = zoneSpeedAt(L.input.zones, s);
    const limit = gradeLimitFor(V, L.input.special);
    const grade = evalProfile(profile, s).grade;
    const over = Math.abs(grade) - limit;
    if (over > 1e-9 && (!worstGrade || over > worstGrade.by))
      worstGrade = {
        what: "grade",
        basis: "law",
        s,
        by: over,
        text: `connector grade ${(grade * 100).toFixed(2)}% > ${(limit * 100).toFixed(1)}% at ${Math.round(s)} m`,
      };
    const r = VERTICAL_CURVE_RADIUS.value[V];
    const k = cubicCurvature(profile, s);
    const excess = Math.max(-1 / r.crest - k, k - 1 / r.sag);
    if (excess > 1e-12 && (!worstCurve || excess > worstCurve.by))
      worstCurve = {
        what: "curve",
        basis: "law",
        s,
        by: excess,
        text: `connector vertical curve R=${Math.round(1 / Math.abs(k))} at ${Math.round(s)} m`,
      };
  }
  if (worstGrade) out.push(worstGrade);
  if (worstCurve) out.push(worstCurve);
  return out;
}

/**
 * The worst station below each kind of floor: the statute's (`lowerLaw`: a crossed road or railway),
 * the assumed standard height over open ground (`lowerOpen`, "floor"), and the rest of `lower` (the
 * deck sunk more than assumed into the smoothed DEM near a low end, "sunk"); and above the ceiling.
 * A station counts once, under the first of these it misses.
 */
function checkBounds(input: RunInput, profile: VerticalProfile): RunProblem[] {
  const worst = {
    law: { by: 0, s: 0 },
    lawNear: { by: 0, s: 0 },
    floor: { by: 0, s: 0 },
    sunk: { by: 0, s: 0 },
    ceiling: { by: 0, s: 0 },
  };
  const note = (kind: keyof typeof worst, by: number, s: number) => {
    if (by > worst[kind].by) worst[kind] = { by, s };
  };
  for (let k = 0; k < input.stations.length; k++) {
    const s = input.stations[k];
    const zs = evalProfile(profile, s).z;
    note("ceiling", zs - input.upper[k], s);
    const lawShort = (input.lowerLaw ? input.lowerLaw[k] : input.lower[k]) - zs;
    if (lawShort > 1e-6) {
      const isNear = input.lawNear !== undefined && input.lawNear[k] === 1;
      note(isNear ? "lawNear" : "law", lawShort, s);
      continue;
    }
    const openShort = (input.lowerOpen ? input.lowerOpen[k] : -Infinity) - zs;
    if (openShort > 1e-6) {
      note("floor", openShort, s);
      continue;
    }
    note("sunk", input.lower[k] - zs, s);
  }
  const out: RunProblem[] = [];
  const { law, lawNear, floor, sunk, ceiling } = worst;
  const at = (p: { s: number }) => metreOf(input, p.s);
  const isGirderGive = (by: number) => input.lawGive !== undefined && by <= input.lawGive + 1e-9;
  if (law.by > 1e-6)
    out.push({
      what: "crossing",
      basis: "law",
      ...law,
      text: `clearance short by ${law.by.toFixed(2)} m at ${at(law)} m`,
      ...(isGirderGive(law.by) ? { give: "girder" as const } : {}),
    });
  // Why the near ones apart: only the worst of each kind is kept, and a far miss must not hide behind one.
  if (lawNear.by > 1e-6)
    out.push({
      what: "crossing",
      basis: "law",
      ...lawNear,
      text: `clearance short by ${lawNear.by.toFixed(2)} m at ${at(lawNear)} m near a low end`,
      give: "near",
    });
  if (floor.by > 1e-6)
    out.push({
      what: "floor",
      basis: "assumed",
      ...floor,
      text: `open-ground floor short by ${floor.by.toFixed(2)} m at ${at(floor)} m (assumed)`,
    });
  if (sunk.by > 1e-6)
    out.push({
      what: "sunk",
      basis: "assumed",
      ...sunk,
      text: `sunk into the DEM ${sunk.by.toFixed(2)} m below the assumed floor at ${at(sunk)} m`,
    });
  if (ceiling.by > 1e-6)
    out.push({
      what: "crossing",
      basis: "law",
      ...ceiling,
      text: `above the ceiling by ${ceiling.by.toFixed(2)} m at ${at(ceiling)} m`,
    });
  return out;
}

export type FallbackStep = "standard" | "specialGrade" | "lowerSpeed" | "crossingsOnly" | "assumedGive";
export type FallbackPlan = {
  cap: DesignSpeed;
  special: boolean;
  crossingsOnly: boolean;
  steps: FallbackStep[];
};

/**
 * The fallbacks of 設計書 4.3 の 3 in order: the 特例 grade, then lower design speeds down to minV
 * (a cap on the zones around where the run failed, `capZones`), then only the crossings' clearance
 * (no standard height over open ground).
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

/**
 * Zones with the speeds capped (the lower-speed fallback) inside `windows` (run-distance intervals
 * around where the run failed; absent: the whole run), neighbours of one speed merged. Why not the
 * whole run (P2.5): one 120 m stretch that needed V50 set all 17.8 km of 32404414 to V50.
 */
export function capZones(zones: Zone[], cap: DesignSpeed, windows?: ReadonlyArray<[number, number]>): Zone[] {
  const pieces: Array<Zone & { lowered: boolean }> = [];
  for (const z of zones) {
    const cuts = new Set([z.from, z.to]);
    for (const [a, b] of windows ?? []) {
      if (a > z.from && a < z.to) cuts.add(a);
      if (b > z.from && b < z.to) cuts.add(b);
    }
    const sorted = [...cuts].sort((p, q) => p - q);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const mid = (sorted[i] + sorted[i + 1]) / 2;
      const isCapped = windows === undefined || windows.some(([a, b]) => mid >= a && mid <= b);
      const V = (isCapped ? Math.min(z.V, cap) : z.V) as DesignSpeed;
      pieces.push({ from: sorted[i], to: sorted[i + 1], V, lowered: V < z.V });
    }
    const isPoint = sorted.length === 1;
    if (isPoint) pieces.push({ ...z, lowered: false });
  }
  const out: Zone[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    const isSame = last !== undefined && last.V === p.V;
    // A lowered sliver (a window ending just past a zone boundary) joins the zone before it at that
    // zone's speed: the stricter limits over a few metres, instead of a zone (and chunk) of its own.
    const isSliver = last !== undefined && p.lowered && p.to - p.from < MIN_PIECE_M;
    if (isSame || isSliver) last.to = p.to;
    else out.push({ from: p.from, to: p.to, V: p.V });
  }
  return out;
}

/** Zone pieces shorter than this are merged into the one before (capZones). */
const MIN_PIECE_M = 5;

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
    const worst = problems
      .get("run")!
      .map((p) => p.text)
      .join("; ");
    attempts.push({ V: plan.cap, special: plan.special, crossingsOnly: plan.crossingsOnly, worst });
    if (worst === "") return { ok: true, profile: profiles.get("run")!, steps: plan.steps, attempts };
  }
  return { ok: false, attempts };
}
