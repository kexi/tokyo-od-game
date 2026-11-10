import {
  CLEARANCE_HEIGHT,
  CURVE_RADIUS,
  type DesignSpeed,
  designSpeedAtMost,
  lowerDesignSpeed,
  MAX_GRADE,
  VERTICAL_CURVE_RADIUS,
} from "../law/roadStandards";
import {
  GIRDER_DEPTH,
  GROUND_ROAD_HALF_WIDTH,
  MAX_LATERAL_SHIFT,
  PIER_SPACING,
  RAIL_CLEARANCE,
  RAMP_MIN_RADIUS,
  STANDARD_UNDERCLEARANCE,
} from "./assumptions";
import { type XwChunk, type XwDiagnostic, type XwEnd, type XwRunSummary } from "./format";
import { planeAt, type Plane, roundTo } from "./geo";
import { alignPlan, type PlanAlignment } from "./horizontal";
import { buildChains, type Chain, type Network, type Run, splitRuns } from "./network";
import { isAllowed } from "./allowlist";
import { deckOverlaps } from "./overlap";
import { deckWidth, sectionFor } from "./section";
import { compositeLimit, superelevation } from "./superelevation";
import { evalProfile, solveVertical, type VerticalProfile } from "./vertical";

/**
 * The expressway compiler (設計書 4): chains → plan alignment → which runs a range needs → vertical
 * alignment in dependency order (a ramp after its main line, an upper deck after what it crosses) →
 * superelevation → stations, piers and ≤ 300 m chunks with stable ids. Pure: the build script gives
 * it the OSM network, the ground (DEM) and the roads and railways underneath.
 */

export type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };
/** Orthometric ground height (T.P. m) as the game computes it (knowledge/terrain-and-geoid.md). */
export type GroundSampler = (lon: number, lat: number) => number;
/** A road or railway at ground level that a viaduct must clear. */
export type CrossObject = { kind: "road" | "rail"; id: number; pts: Array<[number, number]> };

const GRID_M = 5;
const MAX_CHUNK_M = 300;
const GIRDER = GIRDER_DEPTH.value;
const ROAD_CLEAR = CLEARANCE_HEIGHT.value + GIRDER;
/** Two runs sharing a node closer than this to where they cross are splitting, not crossing. */
const JUNCTION_CROSS_M = 60;

type RunPlan = {
  run: Run;
  chain: Chain;
  plane: Plane;
  align: PlanAlignment;
  i0: number;
  i1: number;
  length: number;
  cls: "expressway" | "ramp";
  ref: string | null;
  name: string | null;
  tagV: DesignSpeed;
  V: DesignSpeed;
  minV: DesignSpeed;
  minRadius: number;
  /** Way id of every sample in the run (for layers and sections). */
  wayAt: Int32Array;
  halfWidth: number;
};

type Crossing = { upper: string; lower: string; sUpper: number; sLower: number; sinAngle: number };

export type Plan = {
  net: Network;
  chains: Map<string, Chain>;
  runs: Map<string, RunPlan>;
  /** Runs that touch the range, and everything they depend on. */
  needed: string[];
  wanted: Set<string>;
  crossings: Crossing[];
  diagnostics: XwDiagnostic[];
  outsideNodes: Set<number>;
  /** Chains through each node, and the elevated runs of each chain. */
  nodeChains: Map<number, string[]>;
  chainRuns: Map<string, RunPlan[]>;
  /**
   * The order runs are solved in, over the whole universe (so it does not depend on the range): a
   * ramp after the run it joins, otherwise lower decks first. Of two runs that cross, the later one
   * takes the clearance as a bound (a lower bound over, an upper bound under the other).
   */
  rank: Map<string, number>;
};

const priority = (net: Network, c: Chain) => {
  const isRamp = net.ways.get(c.ways[0])!.cls === "ramp";
  return { ramp: isRamp ? 1 : 0, nodes: -c.nodes.length, id: c.id };
};
const comparePriority = (net: Network) => (a: Chain, b: Chain) => {
  const p = priority(net, a);
  const q = priority(net, b);
  return p.ramp - q.ramp || p.nodes - q.nodes || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
};

function lonLatAt(rp: RunPlan, i: number): [number, number] {
  return rp.plane.toLonLat(rp.align.xy[2 * i], rp.align.xy[2 * i + 1]);
}

/** Sample index of the run at run distance s (nearest sample at or before). */
function sampleAt(rp: RunPlan, s: number): number {
  const base = rp.align.s[rp.i0];
  let lo = rp.i0;
  let hi = rp.i1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rp.align.s[mid] - base <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Position, heading and curvature at run distance s, interpolated between samples. */
function poseAt(rp: RunPlan, s: number): { lon: number; lat: number; x: number; y: number; kappa: number } {
  const i = Math.min(sampleAt(rp, s), rp.i1 - 1);
  const base = rp.align.s[rp.i0];
  const s0 = rp.align.s[i] - base;
  const s1 = rp.align.s[i + 1] - base;
  const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0 || 1)));
  const xy = rp.align.xy;
  const x = xy[2 * i] + (xy[2 * i + 2] - xy[2 * i]) * t;
  const y = xy[2 * i + 1] + (xy[2 * i + 3] - xy[2 * i + 1]) * t;
  const [lon, lat] = rp.plane.toLonLat(x, y);
  return { lon, lat, x, y, kappa: rp.align.kappa[i] + (rp.align.kappa[i + 1] - rp.align.kappa[i]) * t };
}

function runSpeed(
  net: Network,
  run: Run,
  minRadius: number,
  isRamp: boolean,
): { tagV: DesignSpeed; V: DesignSpeed } {
  const tag = Math.min(...run.ways.map((id) => net.ways.get(id)!.speedKmh));
  const tagV = designSpeedAtMost(tag);
  const floor: DesignSpeed = isRamp ? 20 : 40;
  let V: DesignSpeed = tagV;
  // 設計書 4.2: the radius on site cannot move, so a radius below R_min(V) lowers V.
  for (;;) {
    const fits = minRadius >= CURVE_RADIUS.value[V].standard;
    const lower = lowerDesignSpeed(V);
    if (fits || lower === null || lower < floor) break;
    V = lower;
  }
  return { tagV, V };
}

/** Plan the alignment of every chain and the dependencies of the runs the range needs. */
export function planNetwork(net: Network, outsideNodes: Set<number>, range: Bbox | null): Plan {
  const chains = new Map(buildChains(net).map((c) => [c.id, c]));
  const nodeChains = new Map<number, string[]>();
  for (const c of chains.values()) {
    for (const n of new Set(c.nodes)) nodeChains.set(n, [...(nodeChains.get(n) ?? []), c.id]);
  }
  const runs = new Map<string, RunPlan>();
  const diagnostics: XwDiagnostic[] = [];
  for (const chain of [...chains.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const chainRuns = splitRuns(net, chain);
    if (!chainRuns.some((r) => r.elevated)) continue;
    const first = net.nodes.get(chain.nodes[0])!;
    const plane = planeAt(first.lon, first.lat);
    const anchors = new Set<number>();
    chain.nodes.forEach((n, i) => {
      const isShared = (nodeChains.get(n)?.length ?? 0) > 1;
      if (isShared) anchors.add(i);
    });
    for (const r of chainRuns) anchors.add(r.from).add(r.to);
    const xy = chain.nodes.map((n) => {
      const node = net.nodes.get(n)!;
      return plane.toXY(node.lon, node.lat);
    });
    const align = alignPlan({ xy, anchors });
    for (const run of chainRuns) {
      if (!run.elevated) continue;
      const i0 = align.vertexSample[run.from];
      const i1 = align.vertexSample[run.to];
      const isRamp = net.ways.get(run.ways[0])!.cls === "ramp";
      let maxK = 0;
      for (let i = i0; i <= i1; i++) maxK = Math.max(maxK, Math.abs(align.kappa[i]));
      const minRadius = maxK > 0 ? 1 / maxK : Infinity;
      const { tagV, V } = runSpeed(net, run, minRadius, isRamp);
      const wayAt = new Int32Array(i1 - i0 + 1);
      for (let w = 0; w < run.ways.length; w++) {
        const wayIndex = chain.ways.indexOf(run.ways[w]);
        const a = align.vertexSample[chain.wayStarts[wayIndex]];
        for (let i = Math.max(a, i0); i <= i1; i++) wayAt[i - i0] = run.ways[w];
      }
      const firstWay = net.ways.get(run.ways[0])!;
      const maxLanes = Math.max(...run.ways.map((id) => net.ways.get(id)!.lanes));
      runs.set(run.id, {
        run,
        chain,
        plane,
        align,
        i0,
        i1,
        length: align.s[i1] - align.s[i0],
        cls: firstWay.cls,
        ref: firstWay.ref,
        name: run.ways.map((id) => net.ways.get(id)!.name).find((n) => n !== null) ?? null,
        tagV,
        V,
        minV: isRamp ? 20 : 40,
        minRadius,
        wayAt,
        halfWidth: deckWidth(sectionFor(firstWay.cls, maxLanes)) / 2,
      });
      checkRadius(runs.get(run.id)!, diagnostics);
      const isClamped = align.clamped > 0;
      if (isClamped) {
        diagnostics.push({
          run: run.id,
          kind: "plan_shift_clamped",
          detail: `${align.clamped} samples of chain ${chain.id} pulled back onto the ${MAX_LATERAL_SHIFT.value} m circle`,
          allowed: false,
        });
      }
    }
  }
  const crossings = findCrossings(net, runs, diagnostics);
  const plan: Plan = {
    net,
    chains,
    runs,
    needed: [],
    wanted: new Set(),
    crossings,
    diagnostics,
    outsideNodes,
    nodeChains,
    chainRuns: new Map(),
    rank: new Map(),
  };
  for (const rp of runs.values())
    plan.chainRuns.set(rp.chain.id, [...(plan.chainRuns.get(rp.chain.id) ?? []), rp]);
  rankRuns(plan);
  const wanted = [...runs.values()].filter((rp) => {
    if (!range) return true;
    for (let i = rp.i0; i <= rp.i1; i += 5) {
      const [lon, lat] = lonLatAt(rp, i);
      const isInside =
        lon >= range.minLon && lon <= range.maxLon && lat >= range.minLat && lat <= range.maxLat;
      if (isInside) return true;
    }
    return false;
  });
  plan.wanted = new Set(wanted.map((r) => r.run.id));
  const needed = new Set<string>();
  const stack = [...plan.wanted];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (needed.has(id)) continue;
    needed.add(id);
    for (const dep of dependencies(plan, id)) stack.push(dep);
  }
  plan.needed = [...needed].sort();
  return plan;
}

function checkRadius(rp: RunPlan, diagnostics: XwDiagnostic[]): void {
  const isRamp = rp.cls === "ramp";
  const floor = isRamp ? RAMP_MIN_RADIUS.value : CURVE_RADIUS.value[rp.V].special;
  const isBelow = rp.minRadius < floor;
  if (!isBelow) return;
  diagnostics.push({
    run: rp.run.id,
    kind: isRamp ? "ramp_radius" : "curve_radius",
    detail: `R=${rp.minRadius.toFixed(1)} m < ${floor} m (V${rp.V})`,
    allowed: false,
  });
}

/** Global plane only for finding where runs cross; stations are measured on each run's own plane. */
const CROSS_PLANE = planeAt(139.76, 35.68);

type Poly = { id: string; xy: Float64Array; s: Float64Array };

function runPoly(rp: RunPlan): Poly {
  const pts: number[] = [];
  const ss: number[] = [];
  const base = rp.align.s[rp.i0];
  for (let i = rp.i0; i <= rp.i1; i += GRID_M) {
    const [lon, lat] = lonLatAt(rp, i);
    pts.push(...CROSS_PLANE.toXY(lon, lat));
    ss.push(rp.align.s[i] - base);
  }
  const lastIsMissing = (rp.i1 - rp.i0) % GRID_M !== 0;
  if (lastIsMissing) {
    const [lon, lat] = lonLatAt(rp, rp.i1);
    pts.push(...CROSS_PLANE.toXY(lon, lat));
    ss.push(rp.length);
  }
  return { id: rp.run.id, xy: new Float64Array(pts), s: new Float64Array(ss) };
}

/** Intersections of two polylines: [s on a, s on b, sin of the angle]. */
function intersect(a: Poly, b: Poly): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const na = a.xy.length / 2;
  const nb = b.xy.length / 2;
  for (let i = 0; i + 1 < na; i++) {
    const ax = a.xy[2 * i];
    const ay = a.xy[2 * i + 1];
    const dx = a.xy[2 * i + 2] - ax;
    const dy = a.xy[2 * i + 3] - ay;
    for (let j = 0; j + 1 < nb; j++) {
      const bx = b.xy[2 * j];
      const by = b.xy[2 * j + 1];
      const ex = b.xy[2 * j + 2] - bx;
      const ey = b.xy[2 * j + 3] - by;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((bx - ax) * ey - (by - ay) * ex) / den;
      const u = ((bx - ax) * dy - (by - ay) * dx) / den;
      const isHit = t >= 0 && t < 1 && u >= 0 && u < 1;
      if (!isHit) continue;
      const sin = Math.abs(den) / (Math.hypot(dx, dy) * Math.hypot(ex, ey));
      out.push([a.s[i] + (a.s[i + 1] - a.s[i]) * t, b.s[j] + (b.s[j + 1] - b.s[j]) * u, sin]);
    }
  }
  return out;
}

function bboxOf(p: Poly): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.xy.length; i += 2) {
    minX = Math.min(minX, p.xy[i]);
    maxX = Math.max(maxX, p.xy[i]);
    minY = Math.min(minY, p.xy[i + 1]);
    maxY = Math.max(maxY, p.xy[i + 1]);
  }
  return [minX, minY, maxX, maxY];
}

function findCrossings(net: Network, runs: Map<string, RunPlan>, diagnostics: XwDiagnostic[]): Crossing[] {
  const ids = [...runs.keys()].sort();
  const polys = new Map(ids.map((id) => [id, runPoly(runs.get(id)!)]));
  const boxes = new Map(ids.map((id) => [id, bboxOf(polys.get(id)!)]));
  const out: Crossing[] = [];
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const A = boxes.get(ids[a])!;
      const B = boxes.get(ids[b])!;
      const isApart = A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1];
      if (isApart) continue;
      const ra = runs.get(ids[a])!;
      const rb = runs.get(ids[b])!;
      const shared = sharedNodes(ra, rb);
      for (const [sa, sb, sin] of intersect(polys.get(ids[a])!, polys.get(ids[b])!)) {
        const isJunction = shared.some(
          ([na, nb]) => Math.abs(na - sa) < JUNCTION_CROSS_M && Math.abs(nb - sb) < JUNCTION_CROSS_M,
        );
        if (isJunction) continue;
        const la = net.ways.get(ra.wayAt[sampleAt(ra, sa) - ra.i0])!.layer;
        const lb = net.ways.get(rb.wayAt[sampleAt(rb, sb) - rb.i0])!.layer;
        const isUnordered = la === lb;
        if (isUnordered) {
          // OSM says neither is above: no clearance can be imposed, so it is reported, not guessed.
          diagnostics.push({
            run: ra.run.id,
            kind: "crossing_layer_ambiguous",
            detail: `crosses ${rb.run.id} at ${sa.toFixed(0)} m on the same layer ${la}`,
            allowed: false,
          });
          continue;
        }
        const isAUpper = la > lb;
        out.push({
          upper: isAUpper ? ra.run.id : rb.run.id,
          lower: isAUpper ? rb.run.id : ra.run.id,
          sUpper: isAUpper ? sa : sb,
          sLower: isAUpper ? sb : sa,
          sinAngle: sin,
        });
      }
    }
  }
  return out;
}

/** Run distances of the nodes two runs share: [s on a, s on b]. */
function sharedNodes(a: RunPlan, b: RunPlan): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const bNodes = new Map<number, number>();
  for (let i = b.run.from; i <= b.run.to; i++) bNodes.set(b.chain.nodes[i], i);
  for (let i = a.run.from; i <= a.run.to; i++) {
    const j = bNodes.get(a.chain.nodes[i]);
    if (j === undefined) continue;
    out.push([
      a.align.s[a.align.vertexSample[i]] - a.align.s[a.i0],
      b.align.s[b.align.vertexSample[j]] - b.align.s[b.i0],
    ]);
  }
  return out;
}

type EndPlan =
  | { kind: "ground"; nodeIndex: number }
  | { kind: "open" }
  | { kind: "junction" | "seam"; parent: string; parentNodeIndex: number; nodeIndex: number };

/** What fixes a run's start or end (設計書 4.3 の 1). */
export function endPlan(plan: Plan, rp: RunPlan, atStart: boolean): EndPlan {
  const { chain, run } = rp;
  const idx = atStart ? run.from : run.to;
  const isChainEnd = atStart ? idx === 0 : idx === chain.nodes.length - 1;
  if (!isChainEnd) return { kind: "ground", nodeIndex: idx };
  if (chain.closed) {
    const first = (plan.chainRuns.get(chain.id) ?? []).find((r) => r.run.from === 0);
    const isSeamEnd = !atStart && first !== undefined && first !== rp;
    if (isSeamEnd) return { kind: "seam", parent: first.run.id, parentNodeIndex: 0, nodeIndex: idx };
    return { kind: "open" };
  }
  const node = chain.nodes[idx];
  if (plan.outsideNodes.has(node)) return { kind: "open" };
  // A chain passing through the node is the parent; else the highest-priority chain ending or
  // starting there, which itself stays free so two ends never wait on each other.
  const others = (plan.nodeChains.get(node) ?? [])
    .filter((c) => c !== chain.id)
    .map((c) => plan.chains.get(c)!);
  const passing = others.filter((c) => {
    const i = c.nodes.indexOf(node);
    return i > 0 && i < c.nodes.length - 1;
  });
  const order = comparePriority(plan.net);
  const pickFrom = passing.length > 0 ? passing : others;
  const candidates = [...pickFrom].sort(order);
  const parent = candidates[0];
  const isMaster = parent === undefined || (passing.length === 0 && order(chain, parent) < 0);
  if (isMaster) return others.length === 0 ? { kind: "ground", nodeIndex: idx } : { kind: "open" };
  const pIndex = parent.nodes.indexOf(node);
  const pRun = (plan.chainRuns.get(parent.id) ?? []).find((r) => r.run.from <= pIndex && pIndex <= r.run.to);
  if (!pRun) return { kind: "ground", nodeIndex: idx };
  return { kind: "junction", parent: pRun.run.id, parentNodeIndex: pIndex, nodeIndex: idx };
}

function junctionParents(plan: Plan, id: string): string[] {
  const rp = plan.runs.get(id)!;
  const deps = new Set<string>();
  for (const atStart of [true, false]) {
    const e = endPlan(plan, rp, atStart);
    if (e.kind === "junction" || e.kind === "seam") deps.add(e.parent);
  }
  return [...deps].sort();
}

/**
 * Kahn's order over every run: a run after its junction parents and after the decks it crosses
 * over (lower first, so the upper deck rises over a known height). Where that is circular (a ramp
 * that passes under a main line and then joins it), the run whose junction parents are done is
 * taken next and the crossing becomes an upper bound for whichever comes later.
 */
function rankRuns(plan: Plan): void {
  const ids = [...plan.runs.keys()].sort();
  const parents = new Map(ids.map((id) => [id, junctionParents(plan, id)]));
  const below = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const c of plan.crossings) below.get(c.upper)?.add(c.lower);
  const key = (id: string) => {
    const rp = plan.runs.get(id)!;
    const layer = Math.min(...rp.run.ways.map((w) => plan.net.ways.get(w)!.layer));
    return [layer, rp.cls === "ramp" ? 1 : 0] as const;
  };
  const before = (a: string, b: string) => {
    const [la, ra] = key(a);
    const [lb, rb] = key(b);
    return la - lb || ra - rb || (a < b ? -1 : a > b ? 1 : 0);
  };
  const isRanked = (id: string) => plan.rank.has(id) || !plan.runs.has(id);
  const parentsDone = (id: string) => parents.get(id)!.every(isRanked);
  const lowerDone = (id: string) => [...below.get(id)!].every(isRanked);
  // When stuck, defer a crossing over a ramp rather than over a main line: a ramp under a deck
  // copes with an upper bound, a main line under a deck that was placed first often does not.
  const pendingMain = (id: string) =>
    [...below.get(id)!].filter((l) => !isRanked(l) && plan.runs.get(l)!.cls === "expressway").length;
  for (;;) {
    const open = ids.filter((id) => !plan.rank.has(id) && parentsDone(id));
    if (open.length === 0) break;
    const ready = open.filter(lowerDone);
    const pool = ready.length > 0 ? ready : open;
    const pick = pool.sort((a, b) => pendingMain(a) - pendingMain(b) || before(a, b))[0];
    plan.rank.set(pick, plan.rank.size);
  }
  // Runs in a junction cycle are left unranked; solvePlan reports them.
}

export function dependencies(plan: Plan, id: string): string[] {
  const deps = new Set(junctionParents(plan, id));
  const mine = plan.rank.get(id);
  if (mine === undefined) return [...deps].sort();
  for (const c of plan.crossings) {
    const other = c.upper === id ? c.lower : c.lower === id ? c.upper : null;
    const isEarlier = other !== null && (plan.rank.get(other) ?? Infinity) < mine;
    if (isEarlier) deps.add(other);
  }
  return [...deps].sort();
}

/** The needed runs in rank order; runs in a junction cycle (no rank) are returned separately. */
function solveOrder(plan: Plan): { order: string[]; cyclic: string[] } {
  const ranked = plan.needed.filter((id) => plan.rank.has(id));
  ranked.sort((a, b) => plan.rank.get(a)! - plan.rank.get(b)!);
  return { order: ranked, cyclic: plan.needed.filter((id) => !plan.rank.has(id)) };
}

export type Solved = {
  rp: RunPlan;
  profile: VerticalProfile;
  /** Bank on the run's samples. */
  bank: Float64Array;
  start: XwEnd;
  end: XwEnd;
  /** [s, top, clearance] of everything the run crosses over. */
  cross: number[];
};

export type CompileResult = { chunks: XwChunk[]; runs: XwRunSummary[]; diagnostics: XwDiagnostic[] };

/** Every z15 DEM pixel tile the solve will read, for the build script to fetch first. */
export function groundPoints(plan: Plan): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const id of plan.needed) {
    const rp = plan.runs.get(id)!;
    const lo = Math.max(0, rp.i0 - 40);
    const hi = Math.min(rp.align.s.length - 1, rp.i1 + 40);
    for (let i = lo; i <= hi; i += 4) out.push(lonLatAt(rp, i));
    out.push(lonLatAt(rp, rp.i1));
  }
  return out;
}

/** Ground and terrain grade along the chain (which goes on past the run's ends). */
function terrainAt(rp: RunPlan, ground: GroundSampler, chainSample: number): { z: number; grade: number } {
  const n = rp.align.s.length;
  const at = (i: number) => {
    const k = Math.min(n - 1, Math.max(0, i));
    const [lon, lat] = rp.plane.toLonLat(rp.align.xy[2 * k], rp.align.xy[2 * k + 1]);
    return { z: ground(lon, lat), s: rp.align.s[k] };
  };
  const here = at(chainSample);
  const a = at(chainSample - 40);
  const b = at(chainSample + 40);
  const ds = b.s - a.s;
  const grade = ds > 1 ? (b.z - a.z) / ds : 0;
  // The DEM's slope over 80 m, kept within half the 第20条 grade: a road at grade does not climb
  // like the laser ground beside a retaining wall does.
  const cap = MAX_GRADE.value[rp.V].standard / 2;
  return { z: here.z, grade: Math.max(-cap, Math.min(cap, grade)) };
}

export function solvePlan(plan: Plan, ground: GroundSampler, objects: CrossObject[]): CompileResult {
  const diagnostics = [...plan.diagnostics];
  const solved = new Map<string, Solved>();
  const failed = new Set<string>();
  const { order, cyclic } = solveOrder(plan);
  for (const id of cyclic) {
    diagnostics.push({
      run: id,
      kind: "dependency_cycle",
      detail: "runs wait on each other",
      allowed: false,
    });
    failed.add(id);
  }
  const objectPolys = objects.map((o) => ({ o, poly: objectPoly(o) }));
  for (const id of order) {
    const rp = plan.runs.get(id)!;
    const result = solveRun(plan, rp, ground, objectPolys, solved, failed, diagnostics);
    if (result) solved.set(id, result);
    else failed.add(id);
  }
  // Deck-over-deck crossings, recorded on the upper run once both are solved (for T4).
  for (const c of plan.crossings) {
    const up = solved.get(c.upper);
    const low = solved.get(c.lower);
    if (!up || !low) continue;
    up.cross.push(c.sUpper, evalProfile(low.profile, c.sLower).z, ROAD_CLEAR);
  }
  const chunks: XwChunk[] = [];
  const runs: XwRunSummary[] = [];
  for (const id of [...plan.wanted].sort()) {
    const s = solved.get(id);
    if (!s) continue;
    const runChunks = chunkRun(plan, s, ground, objectPolys);
    chunks.push(...runChunks);
    runs.push({
      id,
      chain: s.rp.chain.id,
      cls: s.rp.cls,
      ref: s.rp.ref,
      lengthM: roundTo(s.rp.length, 2),
      V: s.profile.V,
      tagV: s.rp.tagV,
      planV: s.rp.V,
      minRadiusM: roundTo(Math.min(s.rp.minRadius, 1e6), 1),
      maxShiftM: roundTo(s.rp.align.maxShiftM, 3),
      steps: s.profile.steps,
      start: s.start,
      end: s.end,
      chunks: runChunks.map((c) => c.id),
    });
  }
  for (const o of deckOverlaps(chunks)) {
    diagnostics.push({
      run: o.a,
      kind: "deck_overlap",
      detail: `with ${o.b}: ${o.stations} stations, |Δz| ${o.minDzM.toFixed(2)}–${o.maxDzM.toFixed(2)} m, centre lines ${o.minGapM.toFixed(1)} m apart`,
      allowed: false,
    });
  }
  // Whether a departure is accepted is the allowlist's alone (with its reason), never the compiler's.
  for (const d of diagnostics) d.allowed = isAllowed(d);
  return { chunks, runs, diagnostics };
}

type ObjectPoly = { o: CrossObject; poly: Poly };

function objectPoly(o: CrossObject): Poly {
  const xy: number[] = [];
  for (const [lon, lat] of o.pts) xy.push(...CROSS_PLANE.toXY(lon, lat));
  return { id: `${o.kind}${o.id}`, xy: new Float64Array(xy), s: new Float64Array(o.pts.length) };
}

/**
 * Rise from a level start within distance d at the standard grade and sag radius of V. Why the
 * standard and not the 特例 grade: OSM gives no height for the streets, and one that a viaduct
 * could only clear at the 特例 grade right after touching down is far more often an underpass or a
 * street over a cut than a real clearance to design for.
 */
function climbLimit(V: DesignSpeed): (d: number) => number {
  const g = MAX_GRADE.value[V].standard;
  const R = VERTICAL_CURVE_RADIUS.value[V].sag;
  return (d) => (d <= g * R ? (d * d) / (2 * R) : g * d - (g * g * R) / 2);
}

/** How far from a ground end a viaduct may still be below the standard clearance (it is climbing). */
export function approachLength(V: DesignSpeed): number {
  const g = MAX_GRADE.value[V].standard;
  const r = VERTICAL_CURVE_RADIUS.value[V];
  return ROAD_CLEAR / g + (g * (r.sag + r.crest)) / 2;
}

function solveRun(
  plan: Plan,
  rp: RunPlan,
  ground: GroundSampler,
  objects: ObjectPoly[],
  solved: Map<string, Solved>,
  failed: Set<string>,
  diagnostics: XwDiagnostic[],
): Solved | null {
  const id = rp.run.id;
  const S = rp.length;
  const n = Math.max(2, Math.ceil(S / GRID_M) + 1);
  const stations = Float64Array.from({ length: n }, (_, k) => Math.min(S, k * GRID_M));
  stations[n - 1] = S;
  const groundAt = stations.map((s) => {
    const p = poseAt(rp, s);
    return ground(p.lon, p.lat);
  });
  const ends: XwEnd[] = [];
  const conds: Array<{ z?: number; grade?: number }> = [];
  const bankEnds: Array<number | null> = [];
  for (const atStart of [true, false]) {
    const e = endPlan(plan, rp, atStart);
    if (e.kind === "open") {
      ends.push({ kind: "open" });
      conds.push({});
      bankEnds.push(null);
      continue;
    }
    if (e.kind === "ground") {
      const t = terrainAt(rp, ground, rp.align.vertexSample[e.nodeIndex]);
      ends.push({
        kind: "ground",
        z: roundTo(t.z, 3),
        grade: roundTo(t.grade, 5),
        ground: roundTo(t.z, 3),
        bank: 0,
      });
      conds.push({ z: t.z, grade: t.grade });
      bankEnds.push(0);
      continue;
    }
    const parent = solved.get(e.parent);
    if (!parent) {
      const why = failed.has(e.parent) ? "parent_unsolved" : "parent_missing";
      diagnostics.push({ run: id, kind: why, detail: `parent ${e.parent}`, allowed: false });
      return null;
    }
    const pp = parent.rp;
    const ps = pp.align.s[pp.align.vertexSample[e.parentNodeIndex]] - pp.align.s[pp.i0];
    const v = evalProfile(parent.profile, ps);
    const bank = parent.bank[Math.min(parent.bank.length - 1, Math.max(0, sampleAt(pp, ps) - pp.i0))];
    ends.push({ kind: e.kind, parent: e.parent, parentS: roundTo(ps, 2), z: v.z, grade: v.grade, bank });
    conds.push({ z: v.z, grade: v.grade });
    bankEnds.push(bank);
  }
  // Clearance: the crossings everywhere, and the standard floor outside the approaches to ground.
  // The deck may sit a little under the smoothed DEM where it meets the ground (T5 allows ±5 cm at
  // the end itself); a hard floor at the DEM made the ends infeasible by centimetres.
  const base = groundAt.map((g) => g - 0.25);
  const lowerAtCrossings = Float64Array.from(base);
  const cross: number[] = [];
  const applyCrossing = (
    sc: number,
    top: number,
    clearance: number,
    halfOther: number,
    sin: number,
    record = true,
  ) => {
    const w = Math.min(40, (rp.halfWidth + halfOther) / Math.max(sin, 0.25));
    for (let k = 0; k < n; k++) {
      const isInWindow = Math.abs(stations[k] - sc) <= w;
      if (isInWindow) lowerAtCrossings[k] = Math.max(lowerAtCrossings[k], top + clearance);
    }
    if (record) cross.push(sc, top, clearance);
  };
  const mine = runPoly(rp);
  const reach = climbLimit(rp.V);
  for (const { o, poly } of objects) {
    for (const [sc, , sin] of intersect(mine, poly)) {
      const p = poseAt(rp, sc);
      const top = ground(p.lon, p.lat);
      const clearance = o.kind === "rail" ? RAIL_CLEARANCE.value + GIRDER : ROAD_CLEAR;
      // A road "at ground" that no grade could clear from the nearby ground end goes over the run
      // (a street across a cut, untagged in OSM) or meets it at grade: not a clearance to keep.
      const w = Math.min(40, (rp.halfWidth + GROUND_ROAD_HALF_WIDTH.value) / Math.max(sin, 0.25));
      const fromStart = ends[0].kind === "ground" ? reach(Math.max(0, sc - w)) + ends[0].z! : Infinity;
      const fromEnd = ends[1].kind === "ground" ? reach(Math.max(0, S - sc - w)) + ends[1].z! : Infinity;
      const isUnreachable = Math.min(fromStart, fromEnd) < top + clearance;
      if (isUnreachable) {
        diagnostics.push({
          run: id,
          kind: "crossing_over_or_at_grade",
          detail: `${o.kind} ${o.id} at ${sc.toFixed(0)} m cannot be cleared from the ground end; taken as passing over`,
          allowed: false,
        });
        continue;
      }
      applyCrossing(sc, top, clearance, GROUND_ROAD_HALF_WIDTH.value, sin);
    }
  }
  const upper = stations.map(() => Infinity);
  for (const c of plan.crossings) {
    const isUpper = c.upper === id;
    const isLower = c.lower === id;
    if (!isUpper && !isLower) continue;
    const otherId = isUpper ? c.lower : c.upper;
    const isLater = (plan.rank.get(otherId) ?? Infinity) > (plan.rank.get(id) ?? Infinity);
    if (isLater) continue; // the other run takes this crossing as its bound
    const other = solved.get(otherId);
    if (!other) {
      diagnostics.push({
        run: id,
        kind: "partner_unsolved",
        detail: `crossing with ${otherId} not checked`,
        allowed: false,
      });
      continue;
    }
    const sOther = isUpper ? c.sLower : c.sUpper;
    const sMine = isUpper ? c.sUpper : c.sLower;
    // The other deck's extreme under the window, conservatively.
    let top = -Infinity;
    let bottom = Infinity;
    for (let d = -30; d <= 30; d += GRID_M) {
      const z = evalProfile(other.profile, Math.min(other.rp.length, Math.max(0, sOther + d))).z;
      top = Math.max(top, z);
      bottom = Math.min(bottom, z);
    }
    if (isUpper) {
      applyCrossing(sMine, top, ROAD_CLEAR, other.rp.halfWidth, c.sinAngle, false);
      continue;
    }
    const w = Math.min(40, (rp.halfWidth + other.rp.halfWidth) / Math.max(c.sinAngle, 0.25));
    for (let k = 0; k < n; k++) {
      const isInWindow = Math.abs(stations[k] - sMine) <= w;
      if (isInWindow) upper[k] = Math.min(upper[k], bottom - ROAD_CLEAR);
    }
  }
  // One grid step shorter than the climb, so the floor also holds between grid stations wherever
  // the check (checks.checkClearance) expects it.
  const approach = approachLength(rp.V) - GRID_M;
  const lower = Float64Array.from(lowerAtCrossings);
  const isGroundStart = ends[0].kind === "ground";
  const isGroundEnd = ends[1].kind === "ground";
  for (let k = 0; k < n; k++) {
    const nearGround =
      (isGroundStart && stations[k] < approach) || (isGroundEnd && S - stations[k] < approach);
    if (!nearGround) lower[k] = Math.max(lower[k], groundAt[k] + ROAD_CLEAR);
  }
  // Target: the standard underclearance over the ground, plus one deck level (clearance + girder)
  // for every OSM layer above 1, both averaged over ±60 m. The layer only steers the objective:
  // where a JCT stacks decks, the deck that carries a higher layer aims higher before its ramps
  // have to climb over the others (a ramp leaving a deck at the standard height could not climb
  // a whole level before the deck beside it, which made 浜崎橋 JCT unsolvable). Why not use the
  // layer as a fixed height (設計書 9 章): the constraints still come only from what is crossed,
  // and a change of layer tag never makes a step.
  const levels = stations.map((sv) => {
    const way = plan.net.ways.get(rp.wayAt[sampleAt(rp, sv) - rp.i0])!;
    return Math.max(0, way.layer - 1) * ROAD_CLEAR;
  });
  const target = stations.map((_, k) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, k - 12); j <= Math.min(n - 1, k + 12); j++) {
      sum += groundAt[j] + levels[j];
      cnt++;
    }
    return sum / cnt + STANDARD_UNDERCLEARANCE.value + GIRDER;
  });
  const result = solveVertical({
    length: S,
    V: rp.V,
    minV: rp.minV,
    stations,
    target,
    lower,
    upper,
    lowerAtCrossings,
    start: conds[0],
    end: conds[1],
  });
  if (!result.ok) {
    diagnostics.push({
      run: id,
      kind: "vertical_unsolved",
      detail: result.attempts
        .map((a) => `V${a.V}${a.special ? "特例" : ""}${a.crossingsOnly ? "交差のみ" : ""}: ${a.worst}`)
        .join(" | "),
      allowed: false,
    });
    return null;
  }
  const profile = result.profile;
  const isFallback = profile.steps[0] !== "standard";
  if (isFallback) {
    diagnostics.push({
      run: id,
      kind: "vertical_fallback",
      detail: profile.steps.join(">") + ` V${profile.V}`,
      allowed: false,
    });
  }
  // Superelevation on the run's samples, capped so the composite grade stays within 第25条.
  const sampleS = new Float64Array(rp.i1 - rp.i0 + 1);
  const kappa = new Float64Array(rp.i1 - rp.i0 + 1);
  for (let i = rp.i0; i <= rp.i1; i++) {
    sampleS[i - rp.i0] = rp.align.s[i] - rp.align.s[rp.i0];
    kappa[i - rp.i0] = rp.align.kappa[i];
  }
  const limit = compositeLimit(profile.V);
  const room = sampleS.map((sv) => {
    const g = evalProfile(profile, sv).grade;
    return Math.sqrt(Math.max(0, limit * limit - g * g)) * 0.995;
  });
  const bank = superelevation(profile.V, kappa, sampleS, { start: bankEnds[0], end: bankEnds[1] }, room);
  for (const e of ends) {
    if (e.z !== undefined) e.z = roundTo(e.z, 3);
    if (e.grade !== undefined) e.grade = roundTo(e.grade, 5);
    if (e.bank !== undefined) e.bank = roundTo(e.bank, 4);
  }
  return {
    rp,
    profile,
    bank,
    start: ends[0],
    end: ends[1],
    cross,
  };
}

/**
 * Plan heading at run distance s (radians, anticlockwise from east), from the smoothed samples
 * ±3 m around it: both chunks at a seam get the same value, so their end cross-sections match.
 */
function headingAt(rp: RunPlan, s: number): number {
  const i = sampleAt(rp, s);
  const a = Math.max(rp.i0, i - 3);
  const b = Math.min(rp.i1, i + 3);
  const xy = rp.align.xy;
  const [lonA, latA] = rp.plane.toLonLat(xy[2 * a], xy[2 * a + 1]);
  const [lonB, latB] = rp.plane.toLonLat(xy[2 * b], xy[2 * b + 1]);
  const kx = Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return Math.atan2(latB - latA, (lonB - lonA) * kx);
}

/** Station spacing from the plan curvature: 5 m on tight curves, up to 20 m on straights. */
function stationStep(kappa: number): number {
  const R = 1 / Math.max(Math.abs(kappa), 1e-6);
  return Math.min(20, Math.max(5, Math.sqrt(8 * R * 0.03)));
}

function chunkRun(plan: Plan, s: Solved, ground: GroundSampler, objects: ObjectPoly[]): XwChunk[] {
  const { rp, profile } = s;
  const S = rp.length;
  const base = rp.align.s[rp.i0];
  // Cut points: junction nodes (other chains attach), section changes, the run ends.
  const cuts = new Set<number>([0, S]);
  for (let i = rp.run.from + 1; i < rp.run.to; i++) {
    const node = rp.chain.nodes[i];
    const isJunction = (plan.nodeChains.get(node)?.length ?? 0) > 1;
    const wayIndex = rp.chain.wayStarts.indexOf(i);
    const isWayStart = wayIndex > 0;
    const prevWay = isWayStart ? plan.net.ways.get(rp.chain.ways[wayIndex - 1])! : null;
    const nextWay = isWayStart ? plan.net.ways.get(rp.chain.ways[wayIndex])! : null;
    const isSectionChange = prevWay !== null && nextWay !== null && prevWay.lanes !== nextWay.lanes;
    if (isJunction || isSectionChange) cuts.add(rp.align.s[rp.align.vertexSample[i]] - base);
  }
  const sortedCuts = [...cuts].sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.5);
  const bounds: number[] = [0];
  for (let c = 1; c < sortedCuts.length; c++) {
    const a = sortedCuts[c - 1];
    const b = sortedCuts[c];
    const parts = Math.ceil((b - a) / MAX_CHUNK_M);
    for (let k = 1; k <= parts; k++) bounds.push(k === parts ? b : a + ((b - a) * k) / parts);
  }
  bounds[bounds.length - 1] = S;
  // Piers every PIER_SPACING from the run start, moved off the roads and railways underneath.
  const mine = runPoly(rp);
  const avoid: Array<[number, number]> = [];
  for (const { poly } of objects) {
    for (const [sc, , sin] of intersect(mine, poly)) {
      const w = (GROUND_ROAD_HALF_WIDTH.value + 1) / Math.max(sin, 0.25);
      avoid.push([sc - w, sc + w]);
    }
  }
  const piers: number[] = [];
  const spacing = PIER_SPACING.value;
  for (let k = 1; k * spacing < S - 5; k++) {
    let at = k * spacing;
    const hit = avoid.find(([a, b]) => at >= a && at <= b);
    if (hit) {
      const before = hit[0] - 1;
      const after = hit[1] + 1;
      const isBeforeCloser = at - before <= after - at;
      at = isBeforeCloser ? before : after;
      const isStillBlocked =
        avoid.some(([a, b]) => at >= a && at <= b) || Math.abs(at - k * spacing) > spacing / 2;
      if (isStillBlocked) continue;
    }
    const p = poseAt(rp, at);
    const g = ground(p.lon, p.lat);
    const z = evalProfile(profile, at).z;
    const isTallEnough = z - GIRDER - g > 1.5;
    if (isTallEnough) piers.push(at, g);
  }
  const sec = (sampleIdx: number) => {
    const way = plan.net.ways.get(rp.wayAt[sampleIdx - rp.i0])!;
    return sectionFor(way.cls, way.lanes);
  };
  const chunks: XwChunk[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const st: number[] = [];
    const push = (sv: number) => {
      const p = poseAt(rp, sv);
      const v = evalProfile(profile, sv);
      const bi = Math.min(s.bank.length - 1, Math.max(0, sampleAt(rp, sv) - rp.i0));
      st.push(
        roundTo(sv, 2),
        roundTo(p.lon, 7),
        roundTo(p.lat, 7),
        roundTo(v.z, 3),
        roundTo(s.bank[bi], 4),
        roundTo(ground(p.lon, p.lat), 2),
      );
    };
    for (let sv = a; sv < b - 2;) {
      push(sv);
      sv += stationStep(poseAt(rp, sv).kappa);
    }
    push(b);
    const section = sec(sampleAt(rp, (a + b) / 2));
    const chunkPiers: number[] = [];
    for (let i = 0; i < piers.length; i += 2) {
      const isMine = piers[i] >= a && (piers[i] < b || (k + 2 === bounds.length && piers[i] <= b));
      if (isMine) chunkPiers.push(roundTo(piers[i], 2), roundTo(piers[i + 1], 2));
    }
    const chunkCross: number[] = [];
    for (let i = 0; i < s.cross.length; i += 3) {
      const sc = s.cross[i];
      const isMine = sc >= a && (sc < b || (k + 2 === bounds.length && sc <= b));
      const z = evalProfile(profile, sc).z;
      if (isMine)
        chunkCross.push(
          roundTo(sc, 2),
          roundTo(s.cross[i + 1], 3),
          roundTo(s.cross[i + 2], 3),
          roundTo(z, 3),
        );
    }
    chunks.push({
      id: `${rp.run.id}:${k}`,
      run: rp.run.id,
      chain: rp.chain.id,
      k,
      cls: rp.cls,
      ref: rp.ref,
      name: rp.name,
      structure: "viaduct",
      lanes: section.lanes,
      laneWidth: section.laneWidth,
      shoulderL: section.shoulderL,
      shoulderR: section.shoulderR,
      basis: section.basis,
      V: profile.V,
      vh: roundTo(profile.h, 3),
      gmax: profile.gradeLimit,
      g0: roundTo(evalProfile(profile, a).grade, 6),
      g1: roundTo(evalProfile(profile, b).grade, 6),
      h0: roundTo(headingAt(rp, a), 6),
      h1: roundTo(headingAt(rp, b), 6),
      girder: GIRDER,
      st,
      piers: chunkPiers,
      cross: chunkCross,
      prev: k > 0 ? `${rp.run.id}:${k - 1}` : null,
      next: k + 2 < bounds.length ? `${rp.run.id}:${k + 1}` : null,
    });
  }
  return chunks;
}
