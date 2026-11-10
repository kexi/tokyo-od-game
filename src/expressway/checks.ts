import {
  CLEARANCE_HEIGHT,
  COMPOSITE_GRADE,
  CURVE_RADIUS,
  type DesignSpeed,
  designSpeedAtMost,
  MAX_GRADE,
  MAX_SUPERELEVATION,
  TRANSITION_LENGTH,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../law/roadStandards";
import { GIRDER_DEPTH, MAX_LATERAL_SHIFT, RAMP_MIN_RADIUS } from "./assumptions";
import { approachLength } from "./compile";
import { CROSS_STRIDE, STATION_STRIDE, type XwChunk, type XwRunSummary } from "./format";
import { haversine } from "./geo";

/**
 * The properties of 設計書 4.4 checked on compiled chunks, as the data test reads them from the
 * tiles: T1 grade, T2 vertical curves, T3 continuity, T4 clearance, T5 meeting the ground, T6 plan,
 * T7 superelevation. Each returns the violations it found ("<chunk>: what"), empty when it holds.
 * The tolerances are the rounding of the files (z to 1 mm, s to 1 cm, lon/lat to 1e-7°). Limits are
 * recomputed from the statute tables, not read from the chunk's own fields.
 */

type Station = { s: number; lon: number; lat: number; z: number; bank: number; ground: number };

export function stationsOf(c: XwChunk): Station[] {
  const out: Station[] = [];
  for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
    out.push({
      s: c.st[i],
      lon: c.st[i + 1],
      lat: c.st[i + 2],
      z: c.st[i + 3],
      bank: c.st[i + 4],
      ground: c.st[i + 5],
    });
  }
  return out;
}

const V = (c: XwChunk) => c.V as DesignSpeed;
const ROAD_CLEAR = CLEARANCE_HEIGHT.value + GIRDER_DEPTH.value;
const MAIN_SPEEDS: readonly number[] = [60, 50, 40];
const RAMP_SPEEDS: readonly number[] = [60, 50, 40, 30, 20];

function chordHeading(a: Station, b: Station): number {
  const kx = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.atan2(b.lat - a.lat, (b.lon - a.lon) * kx);
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/**
 * T1: |Δz/Δs| ≤ a grade limit recomputed here: the design speed must be one the class may have (main
 * line 60/50/40 by 第13条, ramps down to 20), not above the tagged speed, and the limit 第20条's
 * standard or 特例 value for it capped by 第25条 (the composite grade with no superelevation).
 */
export function checkGrade(c: XwChunk, run: XwRunSummary): string[] {
  const out: string[] = [];
  const speeds = c.cls === "ramp" ? RAMP_SPEEDS : MAIN_SPEEDS;
  const isPossibleSpeed = speeds.includes(c.V) && c.V <= designSpeedAtMost(run.tagV) && c.V === run.V;
  if (!isPossibleSpeed) out.push(`${c.id}: design speed ${c.V} not allowed for ${c.cls} tagged ${run.tagV}`);
  const tabled = MAX_GRADE.value[V(c)];
  const composite = COMPOSITE_GRADE.value[V(c)];
  const limits = [tabled.standard, tabled.special].map((g) => Math.min(g, composite));
  const isStatute = limits.includes(c.gmax);
  if (!isStatute) out.push(`${c.id}: grade limit ${c.gmax} is not 第20条/第25条 for V${c.V}`);
  // Never more than the 特例 limit, whatever the chunk says it used.
  const limit = Math.min(c.gmax, limits[1]);
  const st = stationsOf(c);
  for (let i = 1; i < st.length; i++) {
    const ds = st[i].s - st[i - 1].s;
    const g = Math.abs(st[i].z - st[i - 1].z) / ds;
    const isTooSteep = g > limit + 0.0011 / ds;
    if (isTooSteep) out.push(`${c.id}: grade ${(g * 100).toFixed(2)}% at s=${st[i].s}`);
  }
  for (const g of [c.g0, c.g1]) {
    const isTooSteep = Math.abs(g) > limit + 1e-6;
    if (isTooSteep) out.push(`${c.id}: end grade ${g}`);
  }
  return out;
}

/**
 * T2: the second divided difference over station triples at least 20 m apart lies within
 * −1/R凸 … 1/R凹 of 第22条第2項, and every vertical curve (one knot interval) is at least as long as
 * 第22条第3項 asks.
 */
export function checkVerticalCurves(c: XwChunk): string[] {
  const out: string[] = [];
  const r = VERTICAL_CURVE_RADIUS.value[V(c)];
  const isShortCurve = c.vh < VERTICAL_CURVE_LENGTH.value[V(c)] - 1e-6;
  if (isShortCurve) out.push(`${c.id}: vertical curve length ${c.vh} m`);
  const st = stationsOf(c);
  for (let i = 0; i < st.length; i++) {
    let j = i + 1;
    while (j < st.length && st[j].s - st[i].s < 20) j++;
    let k = j + 1;
    while (k < st.length && st[k].s - st[j].s < 20) k++;
    const isPastEnd = k >= st.length;
    if (isPastEnd) break;
    const g1 = (st[j].z - st[i].z) / (st[j].s - st[i].s);
    const g2 = (st[k].z - st[j].z) / (st[k].s - st[j].s);
    const curvature = (2 * (g2 - g1)) / (st[k].s - st[i].s);
    const tol = 2.5e-5;
    const isTooSharp = curvature < -1 / r.crest - tol || curvature > 1 / r.sag + tol;
    if (isTooSharp) out.push(`${c.id}: vertical curvature ${curvature.toExponential(2)} at s=${st[j].s}`);
  }
  return out;
}

/**
 * T3 within a run: consecutive chunks share their boundary station exactly, its grade and bank, and
 * the heading their end cross-sections are squared to (which agrees with the first chord).
 */
export function checkChunkJoin(a: XwChunk, b: XwChunk): string[] {
  const out: string[] = [];
  const last = a.st.slice(-STATION_STRIDE);
  const first = b.st.slice(0, STATION_STRIDE);
  const d = haversine(last[1], last[2], first[1], first[2]);
  const hasGap = d > 0.001;
  if (hasGap) out.push(`${a.id}→${b.id}: gap ${d.toFixed(4)} m`);
  const hasStep = Math.abs(last[3] - first[3]) > 0.001;
  if (hasStep) out.push(`${a.id}→${b.id}: step ${(last[3] - first[3]).toFixed(4)} m`);
  const hasKink = Math.abs(a.g1 - b.g0) > 0.001;
  if (hasKink) out.push(`${a.id}→${b.id}: grade ${a.g1} / ${b.g0}`);
  const hasBankStep = Math.abs(last[4] - first[4]) > 0.001;
  if (hasBankStep) out.push(`${a.id}→${b.id}: bank ${last[4]} / ${first[4]}`);
  const isTurned = Math.abs(a.h1 - b.h0) > 1e-6;
  if (isTurned) out.push(`${a.id}→${b.id}: end headings ${a.h1} / ${b.h0}`);
  const bst = stationsOf(b);
  const chord = chordHeading(bst[0], bst[1]);
  // A chord of length L on a curve of radius R leaves the tangent by L / 2R; the tightest R the run
  // may have bounds it, plus 0.5° for the rounding.
  const floor = b.cls === "ramp" ? RAMP_MIN_RADIUS.value : CURVE_RADIUS.value[V(b)].special;
  const allowed = (bst[1].s - bst[0].s) / (2 * floor) + (0.5 * Math.PI) / 180;
  const isOffLine = angleDiff(chord, b.h0) > allowed;
  if (isOffLine) out.push(`${b.id}: start heading ${b.h0} vs stations ${chord.toFixed(4)}`);
  return out;
}

/**
 * T3 at a junction: the child run's end station is a station of the parent with the same position
 * and elevation, the same grade (≤ 0.1 %) and the same bank (≤ 0.1 %).
 */
export function checkJunction(child: XwChunk, atStart: boolean, grade: number, parent: XwChunk[]): string[] {
  const st = stationsOf(child);
  const end = atStart ? st[0] : st[st.length - 1];
  const childGrade = atStart ? child.g0 : child.g1;
  for (const p of parent) {
    const pst = stationsOf(p);
    for (let i = 0; i < pst.length; i++) {
      const q = pst[i];
      const isSame = haversine(q.lon, q.lat, end.lon, end.lat) <= 0.001;
      if (!isSame) continue;
      const out: string[] = [];
      const hasStep = Math.abs(q.z - end.z) > 0.001;
      if (hasStep) out.push(`${child.id}: junction step ${(q.z - end.z).toFixed(4)} m`);
      const hasKink = Math.abs(childGrade - grade) > 0.001;
      if (hasKink) out.push(`${child.id}: junction grade ${childGrade} / ${grade}`);
      const pg = i === 0 ? p.g0 : i === pst.length - 1 ? p.g1 : null;
      const hasParentKink = pg !== null && Math.abs(pg - childGrade) > 0.001;
      if (hasParentKink) out.push(`${child.id}: parent grade ${pg} / ${childGrade}`);
      const hasBankStep = Math.abs(q.bank - end.bank) > 0.001;
      if (hasBankStep) out.push(`${child.id}: junction bank ${q.bank} / ${end.bank}`);
      return out;
    }
  }
  return [`${child.id}: no parent station at the junction`];
}

/**
 * T4: over everything recorded as crossed, the surface is at least clearance + girder above it; and
 * everywhere outside the climb from a ground end, at least that above the ground (and so above
 * water, whose DEM is the shore or 0). Decks over or beside other decks: overlap.ts.
 */
export function checkClearance(c: XwChunk, run: XwRunSummary): string[] {
  const out: string[] = [];
  for (let i = 0; i < c.cross.length; i += CROSS_STRIDE) {
    const [s, top, clearance, z] = c.cross.slice(i, i + CROSS_STRIDE);
    const isShort = z - top < clearance - 0.002;
    if (isShort) out.push(`${c.id}: clearance ${(z - top).toFixed(2)} < ${clearance} at s=${s}`);
  }
  const approach = approachLength(run.planV as DesignSpeed);
  for (const p of stationsOf(c)) {
    const isClimbing =
      (run.start.kind === "ground" && p.s < approach) ||
      (run.end.kind === "ground" && run.lengthM - p.s < approach);
    if (isClimbing) continue;
    const isLow = p.z - p.ground < ROAD_CLEAR - 0.02;
    if (isLow) out.push(`${c.id}: ${(p.z - p.ground).toFixed(2)} m over ground at s=${p.s}`);
  }
  return out;
}

/** T5: a ground end meets the ground within ±5 cm at the run's own grade there. */
export function checkGroundEnd(c: XwChunk, run: XwRunSummary, atStart: boolean): string[] {
  const end = atStart ? run.start : run.end;
  const isGroundEnd = end.kind === "ground";
  if (!isGroundEnd) return [];
  const st = stationsOf(c);
  const p = atStart ? st[0] : st[st.length - 1];
  const out: string[] = [];
  const isOffGround = Math.abs(p.z - end.ground!) > 0.05;
  if (isOffGround) out.push(`${c.id}: end ${p.z} vs ground ${end.ground}`);
  const isOffSampled = Math.abs(p.z - p.ground) > 0.05;
  if (isOffSampled) out.push(`${c.id}: end ${p.z} vs sampled ground ${p.ground}`);
  const g = atStart ? c.g0 : c.g1;
  const hasKink = Math.abs(g - end.grade!) > 0.001;
  if (hasKink) out.push(`${c.id}: end grade ${g} vs ${end.grade}`);
  return out;
}

/** Plan curvature through three stations (signed, 1/m). */
function planCurvature(a: Station, b: Station, c: Station): number {
  const kx = 111320 * Math.cos((b.lat * Math.PI) / 180);
  const ky = 110574;
  const ax = (b.lon - a.lon) * kx;
  const ay = (b.lat - a.lat) * ky;
  const bx = (c.lon - b.lon) * kx;
  const by = (c.lat - b.lat) * ky;
  const cross = ax * by - ay * bx;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const lc = Math.hypot(ax + bx, ay + by);
  return (2 * cross) / (la * lb * lc);
}

/**
 * T6: no kink (curvature over 10 m chords never above 1 / the radius floor), the radius at least
 * the floor (第15条 特例 for the run's V; assumptions.RAMP_MIN_RADIUS for a ramp), and the shift
 * from OSM within ε as the compiler measured it on its arrays (the OSM line is not in the tiles).
 * The rate of change of curvature is reported as the largest seen (no statute).
 */
export function checkPlan(c: XwChunk, run: XwRunSummary): { problems: string[]; maxDkappa: number } {
  const out: string[] = [];
  const isShifted = run.maxShiftM > MAX_LATERAL_SHIFT.value + 1e-6;
  if (isShifted) out.push(`${c.id}: shift ${run.maxShiftM} m`);
  const floor = c.cls === "ramp" ? RAMP_MIN_RADIUS.value : CURVE_RADIUS.value[V(c)].special;
  const st = stationsOf(c);
  let prev: { s: number; k: number } | null = null;
  let maxDkappa = 0;
  for (let i = 0; i < st.length; i++) {
    let j = i + 1;
    while (j < st.length && st[j].s - st[i].s < 10) j++;
    let k = j + 1;
    while (k < st.length && st[k].s - st[j].s < 10) k++;
    const isPastEnd = k >= st.length;
    if (isPastEnd) break;
    const kappa = planCurvature(st[i], st[j], st[k]);
    // 5 % and 2e-4 for the rounding of lon/lat (1 cm) over 10 m chords.
    const isTooTight = Math.abs(kappa) > (1 / floor) * 1.05 + 2e-4;
    if (isTooTight) out.push(`${c.id}: radius ${(1 / Math.abs(kappa)).toFixed(1)} m at s=${st[j].s}`);
    if (prev) maxDkappa = Math.max(maxDkappa, Math.abs(kappa - prev.k) / Math.max(1, st[j].s - prev.s));
    prev = { s: st[j].s, k: kappa };
  }
  return { problems: out, maxDkappa };
}

/** T7: bank ≤ 第16条, run in no faster than over 第18条's length, composite grade ≤ 第25条. */
export function checkSuperelevation(c: XwChunk): string[] {
  const out: string[] = [];
  const st = stationsOf(c);
  const L = TRANSITION_LENGTH.value[V(c)];
  const maxE = MAX_SUPERELEVATION.value.type1to3;
  const composite = COMPOSITE_GRADE.value[V(c)];
  for (let i = 0; i < st.length; i++) {
    const isTooBanked = Math.abs(st[i].bank) > maxE + 1e-4;
    if (isTooBanked) out.push(`${c.id}: bank ${st[i].bank} at s=${st[i].s}`);
    const isFirst = i === 0;
    if (isFirst) continue;
    const ds = st[i].s - st[i - 1].s;
    const rate = Math.abs(st[i].bank - st[i - 1].bank) / ds;
    const isTooFast = rate > maxE / L + 0.0002 / ds;
    if (isTooFast) out.push(`${c.id}: bank runs in at ${(rate * 1000).toFixed(2)}‰/m at s=${st[i].s}`);
    const g = (st[i].z - st[i - 1].z) / ds;
    const e = Math.max(Math.abs(st[i].bank), Math.abs(st[i - 1].bank));
    const isTooSteep = Math.hypot(g, e) > composite + 0.0011 / ds;
    if (isTooSteep)
      out.push(`${c.id}: composite grade ${(Math.hypot(g, e) * 100).toFixed(2)}% at s=${st[i].s}`);
  }
  return out;
}
