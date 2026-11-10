import {
  CLEARANCE_HEIGHT,
  CURVE_RADIUS,
  type DesignSpeed,
  designSpeedAtMost,
  lowerDesignSpeed,
  MAX_GRADE,
  MAX_SUPERELEVATION,
  TRANSITION_LENGTH,
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
import { isAllowed } from "./allowlist";
import {
  STATION_STRIDE,
  type XwChunk,
  type XwDeckStretch,
  type XwDiagnostic,
  type XwEnd,
  type XwOver,
  type XwRunStructure,
  type XwRunSummary,
} from "./format";
import { planeAt, type Plane, roundTo } from "./geo";
import { alignPlan, type PlanAlignment } from "./horizontal";
import { buildChains, type Chain, type Network, type RoadClass, type Run, splitRuns } from "./network";
import { deckOverlaps, LEVEL_APART_M, type PlanLine, planOverlaps, SAME_SURFACE_M } from "./overlap";
import { carriagewayWidth, deckWidth, sectionFor, type XwSection } from "./section";
import {
  assertOsmMatches,
  deckSurface,
  fromAxis,
  isOnStructure,
  isPierFree,
  type OsmMismatch,
  osmDeviation,
  type Structure,
  type StructureDeck,
  StructureMismatchError,
  toAxis,
} from "./structures";
import { compositeLimit, superelevation } from "./superelevation";
import {
  capZones,
  type Coupling,
  evalProfile,
  fallbackPlans,
  gradeLimitFor,
  type ProfilePin,
  type RunInput,
  solveJoint,
  type VerticalAttempt,
  type VerticalProfile,
  type Zone,
  zoneSpeedAt,
} from "./vertical";

/**
 * The expressway compiler (knowledge/road-redesign-plan.md 4): chains → plan alignment and design speed per stretch → the
 * runs a range needs (every run coupled to them) → one joint vertical QP per group of coupled runs
 * (junctions, crossings, decks over or beside one another) → superelevation → stations, piers and
 * ≤ 300 m chunks with stable ids. Pure: the build script gives it the OSM network, the ground (DEM)
 * and the roads and railways underneath.
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
/** A faster stretch shorter than this between slower ones keeps the slower speed (no flicker). */
const MIN_ZONE_M = 120;
/** A shared surface or a level apart missed by more than this counts as not kept (overlap.ts bands). */
const SOFT_SLACK_M = 0.02;
/** Overlap stations this close to each other belong to one continuous stretch (nose to separation). */
const STRETCH_GAP_M = 12;
/**
 * Beyond a structure's girder the deck runs from the structure's band back to the OSM line over
 * this length (on the anchorage, where OSM's decks curve away: the 11号 upper floor turns north on
 * the 芝浦 anchorage), its section stepping in TAPER_STEPS chunks (structures.ts). Why 80 m: a 3 m
 * move over it is a reverse curve of R ≈ 350 m, above 第15条's 150 m at 60 km/h; shorter steps the
 * walls harder. Why 8 steps: with 4 the 壁高欄 stepped 0.3–0.6 m at a time on the 芝浦 anchorage
 * (多視点 round 1); a chunk has one section, so a smooth change would need a new data format.
 */
const TAPER_M = 80;
const TAPER_STEPS = 8;
/** In the taper a sample farther than this from the strip is another part of the chain (a loop). */
const TAPER_REACH_M = 30;
/** How far a compiled structure deck may stand off its levels (設計書 4.6 「z の差 ≤ 5 cm」). */
const STRUCTURE_CHECK_M = 0.05;

/** Smoothstep: 0 at the girder's end, 1 at the taper's end, flat at both. */
const ease = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * A run's part of a structure (structures.ts), in run distances: the girder [g0, g1] (plan pinned
 * on the deck's band line, the levels' section), sRange [p0, p1] (profile pinned to the formula, no
 * piers, no girder), the tapers' far ends [t0, t1], and the axis distance of a run distance, measured
 * by projecting the run's own line (on the girder it is slope · s + base exactly). `osm` is the 3 m
 * rule's worst point, checked when the plan was made.
 */
type RunOver = {
  st: Structure;
  deck: StructureDeck;
  /** da/ds on the girder: ±1 to within the chain plane's scale (a sphere, 0.2 % off true metres). */
  slope: number;
  base: number;
  g0: number;
  g1: number;
  p0: number;
  p1: number;
  t0: number;
  t1: number;
  axisAt: (s: number) => number;
  osm: OsmMismatch;
};

type RunPlan = {
  run: Run;
  chain: Chain;
  plane: Plane;
  align: PlanAlignment;
  i0: number;
  i1: number;
  length: number;
  cls: RoadClass;
  ref: string | null;
  name: string | null;
  /** Highest tagged speed along the run, and the highest after the radius check. */
  tagV: DesignSpeed;
  planV: DesignSpeed;
  minV: DesignSpeed;
  /** Design speed per stretch (run distance), from the tags and the local radius. */
  zones: Zone[];
  minRadius: number;
  /** Way id of every sample in the run (for layers and sections). */
  wayAt: Int32Array;
  /** OSM layer per sample, gap-filled ways taking their neighbours' (layerOf in network.ts). */
  layerAt: Int16Array;
  /**
   * Half width of the carriageway (車線域: lanes and shoulders, inside the parapets) per sample,
   * from the lanes of the way there; and the largest half width of the whole deck.
   */
  laneHalfAt: Float32Array;
  halfWidth: number;
  /** The structure deck this run carries, if any. */
  over: RunOver | null;
};

type Crossing = { upper: string; lower: string; sUpper: number; sLower: number; sinAngle: number };

/** How station `sa` of run a stands to b's deck at sb: one surface, or a level above / below it. */
export type DeckPair = {
  a: string;
  sa: number;
  b: string;
  sb: number;
  relation: "same" | "above" | "below";
  cos: number;
};

export type Plan = {
  net: Network;
  chains: Map<string, Chain>;
  runs: Map<string, RunPlan>;
  /** Runs that touch the range, and every run coupled to them (their whole components). */
  needed: string[];
  wanted: Set<string>;
  crossings: Crossing[];
  /** Crossings on the same layer: no order to impose (reported as crossing_layer_ambiguous). */
  ambiguous: Crossing[];
  pairs: DeckPair[];
  /** Groups of runs solved together (component id = smallest run id → members). */
  components: Map<string, string[]>;
  componentOf: Map<string, string>;
  diagnostics: XwDiagnostic[];
  outsideNodes: Set<number>;
  /** Chains through each node, and the elevated runs of each chain. */
  nodeChains: Map<number, string[]>;
  chainRuns: Map<string, RunPlan[]>;
};

const priority = (net: Network, c: Chain) => {
  const isRamp = net.ways.get(c.ways[0])!.cls !== "expressway";
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
function sampleAt(rp: Pick<RunPlan, "align" | "i0" | "i1">, s: number): number {
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

/**
 * Design speed per stretch (設計書 4.2, per section rather than per run): each sample takes the
 * tagged speed of its way, lowered while the local radius is below 第15条's value for it (to 40 on
 * the main line, 20 on a ramp). A lowered speed then covers the 第18条 length either side of the
 * tight sample (the transition belongs to the curve), and a faster stretch shorter than MIN_ZONE_M
 * between slower ones takes the slower speed. Why not one speed per run (P1): one tight curve set
 * 17.7 km of 45661183 to 50 km/h.
 */
function speedZones(
  net: Network,
  align: PlanAlignment,
  i0: number,
  i1: number,
  wayAt: Int32Array,
  isRamp: boolean,
): { zones: Zone[]; tagV: DesignSpeed; planV: DesignSpeed } {
  const n = i1 - i0 + 1;
  const floor: DesignSpeed = isRamp ? 20 : 40;
  const raw = new Int16Array(n);
  let tagV: DesignSpeed = 20;
  for (let k = 0; k < n; k++) {
    const tag = designSpeedAtMost(net.ways.get(wayAt[k])!.speedKmh);
    tagV = Math.max(tagV, tag) as DesignSpeed;
    const R = 1 / Math.max(Math.abs(align.kappa[i0 + k]), 1e-9);
    let V: DesignSpeed = tag;
    for (;;) {
      const fits = R >= CURVE_RADIUS.value[V].standard;
      const lower = lowerDesignSpeed(V);
      if (fits || lower === null || lower < floor) break;
      V = lower;
    }
    raw[k] = V;
  }
  const s = (k: number) => align.s[i0 + k] - align.s[i0];
  // Sliding minimum over ±L (two pointers over the 1 m samples).
  const L = TRANSITION_LENGTH.value[tagV];
  const spread = new Int16Array(n);
  let lo = 0;
  let hi = 0;
  const deque: number[] = [];
  for (let k = 0; k < n; k++) {
    while (hi < n && s(hi) <= s(k) + L) {
      while (deque.length > 0 && raw[deque[deque.length - 1]] >= raw[hi]) deque.pop();
      deque.push(hi);
      hi++;
    }
    while (s(lo) < s(k) - L) lo++;
    while (deque[0] < lo) deque.shift();
    spread[k] = raw[deque[0]];
  }
  const zones: Zone[] = [];
  for (let k = 0; k < n; k++) {
    const V = spread[k] as DesignSpeed;
    const last = zones[zones.length - 1];
    const isSame = last !== undefined && last.V === V;
    if (isSame) last.to = s(k);
    else {
      if (last) last.to = s(k);
      zones.push({ from: s(k), to: s(k), V });
    }
  }
  zones[zones.length - 1].to = s(n - 1);
  for (let changed = true; changed;) {
    changed = false;
    for (let z = 0; z < zones.length; z++) {
      const prev = zones[z - 1];
      const next = zones[z + 1];
      const isShort = zones[z].to - zones[z].from < MIN_ZONE_M;
      const neighbours = [prev, next].filter((v) => v !== undefined).map((v) => v.V);
      const isIsland = neighbours.length > 0 && neighbours.every((v) => v < zones[z].V);
      if (!isShort || !isIsland) continue;
      zones[z].V = Math.max(...neighbours) as DesignSpeed;
      changed = true;
    }
    for (let z = zones.length - 1; z > 0; z--) {
      const isSame = zones[z].V === zones[z - 1].V;
      if (!isSame) continue;
      zones[z - 1].to = zones[z].to;
      zones.splice(z, 1);
    }
  }
  const planV = Math.max(...zones.map((z) => z.V)) as DesignSpeed;
  return { zones, tagV, planV };
}

/**
 * The structure-override pin of a chain (structures.ts): samples of the chain over the structure's
 * girder go onto the deck's band line, those in the tapers beyond move from it back to the OSM line.
 * Null when no deck names one of the chain's ways. Throws (StructureMismatchError) when the chain's
 * OSM line is more than the tolerance off the strip over the girder: the 3 m rule.
 */
function chainPin(
  net: Network,
  chain: Chain,
  plane: Plane,
  structures: readonly Structure[],
): {
  pin: (x: number, y: number) => [number, number] | null;
  st: Structure;
  deck: StructureDeck;
  osm: OsmMismatch;
} | null {
  for (const st of structures) {
    for (const deck of st.decks) {
      const isNamed = chain.ways.some((w) => deck.ways.includes(w));
      if (!isNamed) continue;
      // Over the girder, on the OSM nodes of the whole chain, before anything is smoothed. Why the
      // girder and not sRange: on the anchorages the decks may turn off the axis (the upper floor
      // curves north on the 芝浦 one); the rule and the levels' strips are the suspended girder's.
      let worst: OsmMismatch | null = null;
      for (const w of chain.ways) {
        const way = net.ways.get(w)!;
        const pts = way.nodes.map((id) => [net.nodes.get(id)!.lon, net.nodes.get(id)!.lat] as const);
        const found = osmDeviation(st, deck, w, pts);
        const isWorse = found !== null && (worst === null || found.deviationM > worst.deviationM);
        if (isWorse) worst = found;
      }
      assertOsmMatches(st, deck, worst);
      const [r0, r1] = st.levels.axis.girderRange;
      const pin = (x: number, y: number): [number, number] | null => {
        const [lon, lat] = plane.toLonLat(x, y);
        const a = toAxis(st, lon, lat);
        const beyond = a.s < r0 ? r0 - a.s : a.s > r1 ? a.s - r1 : 0;
        const isFar = beyond >= TAPER_M;
        if (isFar) return null;
        const reach = beyond > 0 ? TAPER_REACH_M : 2 * st.levels.tolerance.horizontal;
        const isOtherPart = Math.abs(a.offset - deck.stripOffset) > reach;
        if (isOtherPart) return null;
        const offset = deck.bandOffset + (a.offset - deck.bandOffset) * ease(beyond / TAPER_M);
        const [plon, plat] = fromAxis(st, a.s, offset);
        return plane.toXY(plon, plat);
      };
      return { pin, st, deck, osm: worst! };
    }
  }
  return null;
}

/** The structure part of a run whose chain is pinned: where along the run its stretches lie. */
function runOver(rp: Omit<RunPlan, "over">, found: NonNullable<ReturnType<typeof chainPin>>): RunOver | null {
  const { st, deck } = found;
  const base = rp.align.s[rp.i0];
  const n = rp.i1 - rp.i0 + 1;
  const runS = new Float64Array(n);
  const axisS = new Float64Array(n);
  const onGirder: number[] = [];
  const [g0, g1] = st.levels.axis.girderRange;
  for (let k = 0; k < n; k++) {
    const i = rp.i0 + k;
    const [lon, lat] = rp.plane.toLonLat(rp.align.xy[2 * i], rp.align.xy[2 * i + 1]);
    runS[k] = rp.align.s[i] - base;
    axisS[k] = toAxis(st, lon, lat).s;
    const isOnGirder = rp.align.pinned[i] === 1 && axisS[k] >= g0 && axisS[k] <= g1;
    if (isOnGirder) onGirder.push(k);
  }
  const hasStructure = onGirder.length >= 2;
  if (!hasStructure) return null;
  const first = onGirder[0];
  const last = onGirder[onGirder.length - 1];
  // On the girder the pinned line is straight, so axis distance is linear in arc length. Why not a
  // slope of exactly ±1: arc length is measured in the chain's plane (geo.ts, a sphere) and the axis
  // in true metres; the 0.2 % between them is 0.8 m over the girder, 1.5 cm of height at its grade.
  const slope = (axisS[last] - axisS[first]) / (runS[last] - runS[first]);
  const axisBase = axisS[first] - slope * runS[first];
  // Run distance where the axis distance passes `a` (the run's line is monotone in s near the bridge).
  const runAt = (a: number): number => {
    for (let k = 1; k < n; k++) {
      const lo = Math.min(axisS[k - 1], axisS[k]);
      const hi = Math.max(axisS[k - 1], axisS[k]);
      const isHere = a >= lo && a <= hi && hi - lo > 1e-9;
      if (isHere)
        return runS[k - 1] + ((a - axisS[k - 1]) / (axisS[k] - axisS[k - 1])) * (runS[k] - runS[k - 1]);
    }
    // Not reached: the run ends first (clamped to its end on that side).
    return (a - axisBase) / slope < 0 ? 0 : rp.length;
  };
  const pair = (a: number, b: number) => [runAt(a), runAt(b)].sort((p, q) => p - q);
  const [rg0, rg1] = pair(g0, g1);
  const [rp0, rp1] = pair(...st.levels.axis.sRange);
  const [rt0, rt1] = pair(g0 - TAPER_M, g1 + TAPER_M);
  const axisAt = (s: number): number => {
    const k = Math.min(n - 2, Math.max(0, sampleAt(rp, s) - rp.i0));
    const t = (s - runS[k]) / Math.max(1e-9, runS[k + 1] - runS[k]);
    return axisS[k] + (axisS[k + 1] - axisS[k]) * Math.min(1, Math.max(0, t));
  };
  return {
    st,
    deck,
    slope,
    base: axisBase,
    g0: rg0,
    g1: rg1,
    p0: rp0,
    p1: rp1,
    t0: rt0,
    t1: rt1,
    axisAt,
    osm: found.osm,
  };
}

/** Plan the alignment of every chain, the couplings between runs and what the range needs. */
export function planNetwork(
  net: Network,
  outsideNodes: Set<number>,
  range: Bbox | readonly Bbox[] | null,
  structures: readonly Structure[] = [],
): Plan {
  const ranges: readonly Bbox[] | null =
    range === null ? null : Array.isArray(range) ? range : [range as Bbox];
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
    const found = chainPin(net, chain, plane, structures);
    const align = alignPlan(found ? { xy, anchors, pin: found.pin } : { xy, anchors });
    for (const run of chainRuns) {
      if (!run.elevated) continue;
      const rp = runPlan(net, chain, plane, align, run, found);
      runs.set(run.id, rp);
      checkRadius(rp, diagnostics);
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
  // Every deck of a structure whose ways are in the network is carried by a run: a deck the plan
  // pinned but no run took (its run too short to reach the girder) would leave the bridge without it.
  for (const st of structures) {
    for (const deck of st.decks) {
      const isInNetwork = deck.ways.some((w) => net.ways.has(w));
      const isCarried = [...runs.values()].some((rp) => rp.over?.deck.id === deck.id);
      if (isInNetwork && !isCarried)
        throw new StructureMismatchError(
          `${deck.id}: its ways are in the network but no elevated run carries the deck`,
        );
    }
  }
  const { crossings, ambiguous } = findCrossings(runs, diagnostics);
  const plan: Plan = {
    net,
    chains,
    runs,
    needed: [],
    wanted: new Set(),
    crossings,
    ambiguous,
    pairs: [],
    components: new Map(),
    componentOf: new Map(),
    diagnostics,
    outsideNodes,
    nodeChains,
    chainRuns: new Map(),
  };
  for (const rp of runs.values())
    plan.chainRuns.set(rp.chain.id, [...(plan.chainRuns.get(rp.chain.id) ?? []), rp]);
  plan.pairs = classifyPairs(plan);
  groupComponents(plan);
  const wanted = [...runs.values()].filter((rp) => {
    if (!ranges) return true;
    for (let i = rp.i0; i <= rp.i1; i += 5) {
      const [lon, lat] = lonLatAt(rp, i);
      const isInside = ranges.some(
        (r) => lon >= r.minLon && lon <= r.maxLon && lat >= r.minLat && lat <= r.maxLat,
      );
      if (isInside) return true;
    }
    return false;
  });
  plan.wanted = new Set(wanted.map((r) => r.run.id));
  const needed = new Set<string>();
  for (const id of plan.wanted)
    for (const m of plan.components.get(plan.componentOf.get(id)!)!) needed.add(m);
  plan.needed = [...needed].sort();
  return plan;
}

function runPlan(
  net: Network,
  chain: Chain,
  plane: Plane,
  align: PlanAlignment,
  run: Run,
  found: ReturnType<typeof chainPin>,
): RunPlan {
  const i0 = align.vertexSample[run.from];
  const i1 = align.vertexSample[run.to];
  let maxK = 0;
  for (let i = i0; i <= i1; i++) maxK = Math.max(maxK, Math.abs(align.kappa[i]));
  const minRadius = maxK > 0 ? 1 / maxK : Infinity;
  const wayAt = new Int32Array(i1 - i0 + 1);
  for (let w = 0; w < run.ways.length; w++) {
    const wayIndex = chain.ways.indexOf(run.ways[w]);
    const a = align.vertexSample[chain.wayStarts[wayIndex]];
    for (let i = Math.max(a, i0); i <= i1; i++) wayAt[i - i0] = run.ways[w];
  }
  const cls = majorityClass(net, wayAt);
  // Streets take a ramp's lowest speeds (第四種 goes down to 20 km/h, 第13条).
  const isRamp = cls !== "expressway";
  const { zones, tagV, planV } = speedZones(net, align, i0, i1, wayAt, isRamp);
  const filled = new Set(run.filledWays);
  const layerAt = new Int16Array(wayAt.length);
  const laneHalfAt = new Float32Array(wayAt.length);
  let halfWidth = 0;
  for (let k = 0; k < wayAt.length; k++) {
    const way = net.ways.get(wayAt[k])!;
    layerAt[k] = way.layer;
    // On a structure the deck levels' section (the band), wherever the plan is pinned.
    const section = found && align.pinned[i0 + k] ? found.deck.section : sectionFor(way.cls, way.lanes);
    laneHalfAt[k] = carriagewayWidth(section) / 2;
    halfWidth = Math.max(halfWidth, deckWidth(section) / 2);
  }
  // A gap-filled way (no bridge tag between two viaducts) has no meaningful layer: take the
  // nearest tagged sample's.
  for (let k = 0; k < wayAt.length; k++) {
    if (!filled.has(wayAt[k])) continue;
    let d = 1;
    for (; d < wayAt.length; d++) {
      const before = k - d >= 0 && !filled.has(wayAt[k - d]) ? k - d : -1;
      const after = k + d < wayAt.length && !filled.has(wayAt[k + d]) ? k + d : -1;
      const found = before >= 0 ? before : after;
      if (found < 0) continue;
      layerAt[k] = net.ways.get(wayAt[found])!.layer;
      break;
    }
  }
  const firstWay = net.ways.get(run.ways[0])!;
  const rp: Omit<RunPlan, "over"> = {
    run,
    chain,
    plane,
    align,
    i0,
    i1,
    length: align.s[i1] - align.s[i0],
    cls,
    ref: firstWay.ref,
    name: run.ways.map((id) => net.ways.get(id)!.name).find((n) => n !== null) ?? null,
    tagV,
    planV,
    minV: isRamp ? 20 : 40,
    zones,
    minRadius,
    wayAt,
    layerAt,
    laneHalfAt,
    halfWidth,
  };
  return { ...rp, over: found ? runOver(rp, found) : null };
}

/**
 * A run's class: the class of most of its length (its 1 m samples). Why not the first way's (P1):
 * 11号台場線's backward chain starts on the 台場 entrance's link, and the whole 4.3 km over the
 * Rainbow Bridge was compiled as a ramp (stepped down to 20 km/h for a nose at 芝浦 JCT).
 */
export function majorityClass(net: Network, wayAt: Int32Array): RoadClass {
  const length = new Map<RoadClass, number>();
  for (const w of wayAt) {
    const cls = net.ways.get(w)!.cls;
    length.set(cls, (length.get(cls) ?? 0) + 1);
  }
  const order: RoadClass[] = ["expressway", "street", "ramp"];
  return order.reduce((best, c) => ((length.get(c) ?? 0) > (length.get(best) ?? 0) ? c : best));
}

function checkRadius(rp: RunPlan, diagnostics: XwDiagnostic[]): void {
  // A street (第四種) has the main line's 第15条 floor; only a ramp is freed from it (第28条第4項).
  const isRamp = rp.cls === "ramp";
  const tightest = Math.min(...rp.zones.map((z) => z.V)) as DesignSpeed;
  const floor = isRamp ? RAMP_MIN_RADIUS.value : CURVE_RADIUS.value[tightest].special;
  const isBelow = rp.minRadius < floor;
  if (!isBelow) return;
  diagnostics.push({
    run: rp.run.id,
    kind: isRamp ? "ramp_radius" : "curve_radius",
    detail: `R=${rp.minRadius.toFixed(1)} m < ${floor} m (V${tightest})`,
    allowed: false,
  });
}

/** Global plane only for finding where runs cross; stations are measured on each run's own plane. */
const CROSS_PLANE = planeAt(139.76, 35.68);

type Poly = { id: string; xy: Float64Array; s: Float64Array; hw: Float64Array };

function runPoly(rp: RunPlan): Poly {
  const pts: number[] = [];
  const ss: number[] = [];
  const hw: number[] = [];
  const base = rp.align.s[rp.i0];
  const push = (i: number) => {
    const [lon, lat] = lonLatAt(rp, i);
    pts.push(...CROSS_PLANE.toXY(lon, lat));
    ss.push(rp.align.s[i] - base);
    hw.push(rp.laneHalfAt[i - rp.i0]);
  };
  for (let i = rp.i0; i <= rp.i1; i += GRID_M) push(i);
  const lastIsMissing = (rp.i1 - rp.i0) % GRID_M !== 0;
  if (lastIsMissing) push(rp.i1);
  return { id: rp.run.id, xy: new Float64Array(pts), s: new Float64Array(ss), hw: new Float64Array(hw) };
}

/** Intersections of two polylines: [s on a, s on b, sin of the angle]. */
function intersect(a: Pick<Poly, "xy" | "s">, b: Pick<Poly, "xy" | "s">): Array<[number, number, number]> {
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

function bboxOf(p: Pick<Poly, "xy">): [number, number, number, number] {
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

function layerAtS(rp: RunPlan, s: number): number {
  return rp.layerAt[Math.min(rp.layerAt.length - 1, Math.max(0, sampleAt(rp, s) - rp.i0))];
}

function findCrossings(
  runs: Map<string, RunPlan>,
  diagnostics: XwDiagnostic[],
): { crossings: Crossing[]; ambiguous: Crossing[] } {
  const ids = [...runs.keys()].sort();
  const polys = new Map(ids.map((id) => [id, runPoly(runs.get(id)!)]));
  const boxes = new Map(ids.map((id) => [id, bboxOf(polys.get(id)!)]));
  const out: Crossing[] = [];
  const ambiguous: Crossing[] = [];
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
        const la = layerAtS(ra, sa);
        const lb = layerAtS(rb, sb);
        const isUnordered = la === lb;
        if (isUnordered) {
          // OSM says neither is above: no clearance can be imposed, so it is reported, not guessed.
          diagnostics.push({
            run: ra.run.id,
            kind: "crossing_layer_ambiguous",
            detail: `crosses ${rb.run.id} at ${sa.toFixed(0)} m on the same layer ${la}`,
            allowed: false,
          });
          ambiguous.push({ upper: ra.run.id, lower: rb.run.id, sUpper: sa, sLower: sb, sinAngle: sin });
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
  return { crossings: out, ambiguous };
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

/**
 * Decks over or beside one another (overlap.ts on the plan lines), each station pair given its
 * relation (設計書 4.2): near a crossing, the crossing's order (OSM layer); from a nose (a node the
 * two share) to where the decks part, one surface; elsewhere one surface on the same OSM layer and
 * a level apart on different ones. Pairs near a same-layer crossing get none (it is reported).
 */
function classifyPairs(plan: Plan): DeckPair[] {
  const ids = [...plan.runs.keys()].sort();
  const lines: PlanLine[] = ids.map((id) => {
    const p = runPoly(plan.runs.get(id)!);
    const n = p.s.length;
    return {
      id,
      x: Float64Array.from({ length: n }, (_, i) => p.xy[2 * i]),
      y: Float64Array.from({ length: n }, (_, i) => p.xy[2 * i + 1]),
      s: p.s,
      hw: p.hw,
    };
  });
  const groups = new Map<string, ReturnType<typeof planOverlaps>>();
  for (const pair of planOverlaps(lines)) {
    const key = `${pair.a}|${pair.b}`;
    const list = groups.get(key);
    if (list) list.push(pair);
    else groups.set(key, [pair]);
  }
  const out: DeckPair[] = [];
  for (const [key, list] of [...groups.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    const [a, b] = key.split("|");
    const ra = plan.runs.get(a)!;
    const rb = plan.runs.get(b)!;
    const window = (sin: number) => Math.min(60, (ra.halfWidth + rb.halfWidth) / Math.max(sin, 0.2)) + 10;
    const ordered = plan.crossings.filter(
      (c) => (c.upper === a && c.lower === b) || (c.upper === b && c.lower === a),
    );
    const unordered = plan.ambiguous.filter(
      (c) => (c.upper === a && c.lower === b) || (c.upper === b && c.lower === a),
    );
    const near = (c: Crossing, sa: number, sb: number) => {
      const [ca, cb] = c.upper === a ? [c.sUpper, c.sLower] : [c.sLower, c.sUpper];
      const w = window(c.sinAngle);
      return Math.abs(sa - ca) <= w && Math.abs(sb - cb) <= w;
    };
    list.sort((p, q) => p.sa - q.sa);
    const nose = new Uint8Array(list.length);
    for (const [na] of sharedNodes(ra, rb)) {
      let start = -1;
      for (let i = 0; i < list.length; i++) {
        const isAtNode = Math.abs(list[i].sa - na) <= STRETCH_GAP_M;
        if (isAtNode && (start < 0 || Math.abs(list[i].sa - na) < Math.abs(list[start].sa - na))) start = i;
      }
      if (start < 0) continue;
      nose[start] = 1;
      for (let i = start + 1; i < list.length && list[i].sa - list[i - 1].sa <= STRETCH_GAP_M; i++)
        nose[i] = 1;
      for (let i = start - 1; i >= 0 && list[i + 1].sa - list[i].sa <= STRETCH_GAP_M; i--) nose[i] = 1;
    }
    list.forEach((p, i) => {
      const crossing = ordered.find((c) => near(c, p.sa, p.sb));
      if (crossing) {
        out.push({
          a,
          sa: p.sa,
          b,
          sb: p.sb,
          relation: crossing.upper === a ? "above" : "below",
          cos: p.cos,
        });
        return;
      }
      const isAmbiguous = unordered.some((c) => near(c, p.sa, p.sb));
      if (isAmbiguous) return;
      if (nose[i]) {
        out.push({ a, sa: p.sa, b, sb: p.sb, relation: "same", cos: p.cos });
        return;
      }
      const la = layerAtS(ra, p.sa);
      const lb = layerAtS(rb, p.sb);
      const relation = la === lb ? "same" : la > lb ? "above" : "below";
      out.push({ a, sa: p.sa, b, sb: p.sb, relation, cos: p.cos });
    });
  }
  return out;
}

/** Union of runs joined at junctions, crossing each other or over one another's decks. */
function groupComponents(plan: Plan): void {
  const parent = new Map<string, string>();
  for (const id of plan.runs.keys()) parent.set(id, id);
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // The smaller id is the root, so a component's id does not depend on the order of unions.
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  for (const id of plan.runs.keys()) for (const p of junctionParents(plan, id)) union(id, p);
  for (const c of plan.crossings) union(c.upper, c.lower);
  for (const p of plan.pairs) union(p.a, p.b);
  for (const id of [...plan.runs.keys()].sort()) {
    const root = find(id);
    plan.componentOf.set(id, root);
    const list = plan.components.get(root);
    if (list) list.push(id);
    else plan.components.set(root, [id]);
  }
}

type EndPlan =
  | { kind: "ground"; nodeIndex: number; into?: "tunnel" | "cut" }
  | { kind: "open" }
  | { kind: "junction" | "seam"; parent: string; parentNodeIndex: number; nodeIndex: number };

/** What fixes a run's start or end (knowledge/road-redesign-plan.md 4.3 の 1). */
export function endPlan(plan: Plan, rp: RunPlan, atStart: boolean): EndPlan {
  const { chain, run } = rp;
  const idx = atStart ? run.from : run.to;
  const isChainEnd = atStart ? idx === 0 : idx === chain.nodes.length - 1;
  if (!isChainEnd) {
    // The chain goes on at ground level, or below it (a tunnel or cut: the profile meets the ground
    // at the portal and keeps going down, so its grade is not the terrain's).
    const wayIndex = atStart
      ? chain.ways.indexOf(run.ways[0]) - 1
      : chain.ways.indexOf(run.ways[run.ways.length - 1]) + 1;
    const next = plan.net.ways.get(chain.ways[wayIndex]);
    const isBelow = next !== undefined && (next.structure === "tunnel" || next.structure === "cut");
    return isBelow
      ? { kind: "ground", nodeIndex: idx, into: next.structure as "tunnel" | "cut" }
      : { kind: "ground", nodeIndex: idx };
  }
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

export type Solved = {
  rp: RunPlan;
  profile: VerticalProfile;
  steps: string[];
  /** Bank on the run's samples. */
  bank: Float64Array;
  start: XwEnd;
  end: XwEnd;
  /** [s, top, clearance] of everything the run crosses over. */
  cross: number[];
  /** [s, top] of roads at ground level under it that it does not clear (crossing_over_or_at_grade). */
  blocked: number[];
};

export type SolveStats = {
  components: number;
  largestRuns: number;
  largestVariables: number;
  solves: number;
  iterations: number;
  qpMs: number;
  /** Solves that did not converge (each reported as solver_not_converged). */
  unconverged: number;
};

export type CompileResult = {
  chunks: XwChunk[];
  runs: XwRunSummary[];
  diagnostics: XwDiagnostic[];
  stats: SolveStats;
};

/** Every z15 DEM pixel tile the solve will read, for the build script to fetch first. */
export function groundPoints(plan: Plan): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const id of plan.needed) {
    const rp = plan.runs.get(id)!;
    const lo = Math.max(0, rp.i0 - 40);
    const hi = Math.min(rp.align.s.length - 1, rp.i1 + 40);
    // Every 1 m sample: the floor reads the ground 2.5 m either side of each constraint station,
    // and a run that only clips a tile corner between coarser samples would miss that tile.
    for (let i = lo; i <= hi; i++) out.push(lonLatAt(rp, i));
    out.push(lonLatAt(rp, rp.i1));
  }
  return out;
}

/** Ground and terrain grade along the chain (which goes on past the run's ends). */
function terrainAt(
  rp: RunPlan,
  ground: GroundSampler,
  chainSample: number,
  V: DesignSpeed,
): { z: number; grade: number } {
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
  const cap = MAX_GRADE.value[V].standard / 2;
  return { z: here.z, grade: Math.max(-cap, Math.min(cap, grade)) };
}

type ObjectPoly = {
  o: CrossObject;
  poly: Pick<Poly, "id" | "xy" | "s">;
  box: [number, number, number, number];
};

/** The objects whose bounding box meets the run's (the rest cannot cross it). */
function objectsNear(objects: ObjectPoly[], mine: Pick<Poly, "xy">): ObjectPoly[] {
  const [x0, y0, x1, y1] = bboxOf(mine);
  return objects.filter(({ box }) => box[2] >= x0 && box[0] <= x1 && box[3] >= y0 && box[1] <= y1);
}

function objectPoly(o: CrossObject): ObjectPoly["poly"] {
  const xy: number[] = [];
  for (const [lon, lat] of o.pts) xy.push(...CROSS_PLANE.toXY(lon, lat));
  return { id: `${o.kind}${o.id}`, xy: new Float64Array(xy), s: new Float64Array(o.pts.length) };
}

/**
 * Rise within distance d from a start at grade g0, at the standard grade and sag radius of V. Why
 * the standard and not the 特例 grade: OSM gives no height for the streets, and one that a viaduct
 * could only clear at the 特例 grade right after touching down is far more often an underpass or a
 * street over a cut than a real clearance to design for.
 */
function climbLimit(V: DesignSpeed, g0: number): (d: number) => number {
  const g = MAX_GRADE.value[V].standard;
  const R = VERTICAL_CURVE_RADIUS.value[V].sag;
  const d1 = Math.max(0, (g - g0) * R);
  return (d) => (d <= d1 ? g0 * d + (d * d) / (2 * R) : g0 * d1 + (d1 * d1) / (2 * R) + g * (d - d1));
}

/** The climb of climbLimit must clear a road by this much more to count as reachable. */
const REACH_MARGIN_M = 0.1;

/** How far from a ground end a viaduct may still be below the standard clearance (it is climbing). */
export function approachLength(V: DesignSpeed): number {
  const g = MAX_GRADE.value[V].standard;
  const r = VERTICAL_CURVE_RADIUS.value[V];
  return ROAD_CLEAR / g + (g * (r.sag + r.crest)) / 2;
}

/** A run's part of the joint problem that does not depend on the fallback level. */
type RunSetup = {
  rp: RunPlan;
  stations: Float64Array;
  target: Float64Array;
  lower: Float64Array;
  lowerAtCrossings: Float64Array;
  upper: Float64Array;
  /** Fixed start / end (ground and portal ends); junction ends are couplings. */
  fixed: [RunInput["start"], RunInput["end"]];
  ends: [EndPlan, EndPlan];
  cross: number[];
  blocked: number[];
};

function setupRun(
  plan: Plan,
  rp: RunPlan,
  ground: GroundSampler,
  objects: ObjectPoly[],
  diagnostics: XwDiagnostic[],
): RunSetup {
  const id = rp.run.id;
  const S = rp.length;
  const n = Math.max(2, Math.ceil(S / GRID_M) + 1);
  const stations = Float64Array.from({ length: n }, (_, k) => Math.min(S, k * GRID_M));
  stations[n - 1] = S;
  const groundAt = stations.map((s) => {
    const p = poseAt(rp, s);
    return ground(p.lon, p.lat);
  });
  // The highest ground within half a grid step either side: the floor must hold between the 5 m
  // constraint stations too, and the smoothed DEM still has half-metre bumps over a few metres
  // (river walls, embankments) that the grid stations alone miss.
  const groundPeak = stations.map((s, k) => {
    let top = groundAt[k];
    for (const d of [-GRID_M / 2, -GRID_M / 4, GRID_M / 4, GRID_M / 2]) {
      const p = poseAt(rp, Math.min(S, Math.max(0, s + d)));
      top = Math.max(top, ground(p.lon, p.lat));
    }
    return top;
  });
  const ends: [EndPlan, EndPlan] = [endPlan(plan, rp, true), endPlan(plan, rp, false)];
  const fixed: [RunInput["start"], RunInput["end"]] = [{}, {}];
  const groundZ: Array<number | null> = [null, null];
  ends.forEach((e, side) => {
    if (e.kind !== "ground") return;
    const V = zoneSpeedAt(rp.zones, side === 0 ? 0 : S);
    const t = terrainAt(rp, ground, rp.align.vertexSample[e.nodeIndex], V);
    groundZ[side] = t.z;
    // A portal's grade is the road's own as it goes on down into the tunnel or cut.
    fixed[side] = e.into ? { z: t.z } : { z: t.z, grade: t.grade };
  });
  // Clearance: the crossings everywhere, and the standard floor outside the approaches to ground.
  // The deck may sit a little under the smoothed DEM where it meets the ground (T5 allows ±5 cm at
  // the end itself); a hard floor at the DEM made the ends infeasible by centimetres.
  const lowerAtCrossings = Float64Array.from(groundAt, (g) => g - 0.25);
  const cross: number[] = [];
  const blocked: number[] = [];
  const mine = runPoly(rp);
  for (const { o, poly } of objectsNear(objects, mine)) {
    for (const [sc, , sin] of intersect(mine, poly)) {
      const p = poseAt(rp, sc);
      const top = ground(p.lon, p.lat);
      const clearance = o.kind === "rail" ? RAIL_CLEARANCE.value + GIRDER : ROAD_CLEAR;
      // A road "at ground" that no grade could clear from the nearby ground end goes over the run
      // (a street across a cut, untagged in OSM) or meets it at grade: not a clearance to keep,
      // but recorded for P3 (the deck closes it).
      const w = Math.min(40, (rp.halfWidth + GROUND_ROAD_HALF_WIDTH.value) / Math.max(sin, 0.25));
      const reach = (side: number, d: number) => {
        const z0 = groundZ[side];
        if (z0 === null) return Infinity;
        // Climbing away from the end: the end grade, reversed for the far end.
        const g0 = (fixed[side].grade ?? 0) * (side === 0 ? 1 : -1);
        return climbLimit(zoneSpeedAt(rp.zones, side === 0 ? 0 : S), g0)(Math.max(0, d)) + z0;
      };
      const isUnreachable =
        Math.min(reach(0, sc - w), reach(1, S - sc - w)) < top + clearance + REACH_MARGIN_M;
      if (isUnreachable) {
        diagnostics.push({
          run: id,
          kind: "crossing_over_or_at_grade",
          detail: `${o.kind} ${o.id} at ${sc.toFixed(0)} m cannot be cleared from the ground end; taken as passing over`,
          allowed: false,
        });
        blocked.push(sc, top);
        continue;
      }
      const win = Math.min(40, (rp.halfWidth + GROUND_ROAD_HALF_WIDTH.value) / Math.max(sin, 0.25));
      for (let k = 0; k < n; k++) {
        const isInWindow = Math.abs(stations[k] - sc) <= win;
        if (isInWindow) lowerAtCrossings[k] = Math.max(lowerAtCrossings[k], top + clearance);
      }
      cross.push(sc, top, clearance);
    }
  }
  // One grid step shorter than the climb, so the floor also holds between grid stations wherever
  // the check (checks.checkClearance) expects it.
  const approach = approachLength(rp.planV) - GRID_M;
  const lower = Float64Array.from(lowerAtCrossings);
  // A ramp ending on a structure's street (台場出口 onto the 臨港道路's descent to the 台場 streets)
  // comes down with it: the street's own floor governs there, as at a ground end. Why not every
  // junction: an expressway parent keeps its clearance, and so must a ramp beside it.
  const isOnStreet = (e: EndPlan) => e.kind === "junction" && plan.runs.get(e.parent)?.cls === "street";
  const isGroundStart = ends[0].kind === "ground" || isOnStreet(ends[0]);
  const isGroundEnd = ends[1].kind === "ground" || isOnStreet(ends[1]);
  for (let k = 0; k < n; k++) {
    const nearGround =
      (isGroundStart && stations[k] < approach) || (isGroundEnd && S - stations[k] < approach);
    if (!nearGround) lower[k] = Math.max(lower[k], groundPeak[k] + ROAD_CLEAR);
  }
  // Target: the standard underclearance over the ground (averaged over ±60 m). Only crossings and
  // decks over one another raise it (設計書 4.3 の 1); OSM layer orders them but is no height.
  const target = stations.map((_, k) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, k - 12); j <= Math.min(n - 1, k + 12); j++) {
      sum += groundAt[j];
      cnt++;
    }
    return sum / cnt + STANDARD_UNDERCLEARANCE.value + GIRDER;
  });
  return {
    rp,
    stations,
    target,
    lower,
    lowerAtCrossings,
    upper: stations.map(() => Infinity),
    fixed,
    ends,
    cross,
    blocked,
  };
}

/**
 * The structure's profile as a pin of the run (vertical.ts ProfilePin): over sRange the elevation of
 * deckLevels' formula at the axis distance of each run distance. On the girder that distance is
 * linear in s (the pinned line is straight), so the formula is a parabola of s and the knots there
 * are held exactly; on the anchorages, where the deck may turn off the axis, it is measured on the
 * run's own line and the arcs are fitted to it.
 */
function profilePins(rp: RunPlan): ProfilePin[] {
  const o = rp.over;
  if (!o) return [];
  const isOnGirder = (s: number) => s >= o.g0 && s <= o.g1;
  const at = (s: number) => {
    const a = isOnGirder(s) ? o.slope * s + o.base : o.axisAt(s);
    const v = deckSurface(o.st, o.deck, a);
    const da = isOnGirder(s) ? o.slope : (o.axisAt(s + 0.5) - o.axisAt(s - 0.5)) / 1;
    return { z: v.z, grade: v.grade * da };
  };
  return [{ from: o.p0, to: o.p1, exact: [o.g0, o.g1], at }];
}

/** The couplings among a component's runs: junctions, crossings and decks over one another. */
function couplingsOf(plan: Plan, members: Set<string>): Coupling[] {
  const out: Coupling[] = [];
  for (const id of [...members].sort()) {
    const rp = plan.runs.get(id)!;
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const isJoined = (e.kind === "junction" || e.kind === "seam") && members.has(e.parent);
      if (!isJoined) continue;
      const pp = plan.runs.get(e.parent)!;
      const ps = pp.align.s[pp.align.vertexSample[e.parentNodeIndex]] - pp.align.s[pp.i0];
      out.push({ kind: "junction", child: id, atStart, parent: { run: e.parent, s: ps } });
    }
  }
  for (const c of plan.crossings) {
    const isInside = members.has(c.upper) && members.has(c.lower);
    if (!isInside) continue;
    out.push({
      kind: "within",
      a: { run: c.upper, s: c.sUpper },
      b: { run: c.lower, s: c.sLower },
      lo: ROAD_CLEAR,
      hi: Infinity,
      firm: true,
    });
  }
  for (const p of plan.pairs) {
    const isInside = members.has(p.a) && members.has(p.b);
    if (!isInside) continue;
    const a = { run: p.a, s: p.sa };
    const b = { run: p.b, s: p.sb };
    const firm = false;
    if (p.relation === "same")
      out.push({ kind: "within", a, b, lo: -SAME_SURFACE_M, hi: SAME_SURFACE_M, firm });
    else if (p.relation === "above")
      out.push({ kind: "within", a, b, lo: LEVEL_APART_M, hi: Infinity, firm });
    else out.push({ kind: "within", a, b, lo: -Infinity, hi: -LEVEL_APART_M, firm });
  }
  return out;
}

type ComponentResult = {
  solved: Map<string, Solved>;
  unsolved: Map<string, VerticalAttempt[]>;
  stats: Omit<SolveStats, "components">;
};

type LevelSolve = {
  profiles: Map<string, VerticalProfile>;
  /** Exact constraints a run fails (a run with any is not solved at this level). */
  problems: Map<string, string[]>;
  /** Metres by which a run misses the decks it shares or stands over (soft, summed). */
  soft: Map<string, number>;
  isConverged: boolean;
};

/**
 * One component through the fallbacks of 設計書 4.3 の 3: solve all its runs jointly, find the
 * runs whose exact constraints still fail (their own bounds and ends, junctions, the crossings'
 * clearance), move only those one step down their fallback list, and solve again, until no failing
 * run has a step left. A ramp that misses a deck it shares (a nose it must leave in time to reach
 * the ground) also steps down, short of "crossings only" (a lower speed allows a shorter vertical
 * curve), and goes back to the step where it missed least if stepping down did not help. Main lines
 * keep their speed for that: their leftovers are stacked carriageways changing over where OSM puts
 * them too close, which no speed solves.
 */
function solveComponent(
  plan: Plan,
  ids: string[],
  ground: GroundSampler,
  objects: ObjectPoly[],
  diagnostics: XwDiagnostic[],
): ComponentResult {
  const members = new Set(ids);
  const setups = new Map(
    ids.map((id) => [id, setupRun(plan, plan.runs.get(id)!, ground, objects, diagnostics)]),
  );
  const couplings = couplingsOf(plan, members);
  const ladders = new Map(
    ids.map((id) => [id, fallbackPlans(plan.runs.get(id)!.planV, plan.runs.get(id)!.minV)]),
  );
  const level = new Map(ids.map((id) => [id, 0]));
  const attempts = new Map<string, VerticalAttempt[]>(ids.map((id) => [id, []]));
  /** Per ramp: the soft miss at each step it was solved with, and whether the step was clean. */
  const history = new Map<string, Array<{ soft: number; clean: boolean }>>(ids.map((id) => [id, []]));
  const crossingsHere = plan.crossings.filter((c) => members.has(c.upper) && members.has(c.lower));
  const stats = {
    largestRuns: ids.length,
    largestVariables: 0,
    solves: 0,
    iterations: 0,
    qpMs: 0,
    unconverged: 0,
  };
  const unconverged: string[] = [];
  const isRamp = (id: string) => plan.runs.get(id)!.cls === "ramp";

  const solveAt = (): LevelSolve => {
    const inputs: RunInput[] = ids.map((id) => {
      const st = setups.get(id)!;
      const step = ladders.get(id)![level.get(id)!];
      return {
        id,
        length: st.rp.length,
        zones: capZones(st.rp.zones, step.cap),
        special: step.special,
        stations: st.stations,
        target: st.target,
        lower: step.crossingsOnly ? st.lowerAtCrossings : st.lower,
        upper: st.upper,
        start: st.fixed[0],
        end: st.fixed[1],
        pins: profilePins(st.rp),
      };
    });
    const started = performance.now();
    const res = solveJoint(inputs, couplings);
    stats.qpMs += performance.now() - started;
    stats.solves++;
    stats.iterations += res.iterations;
    stats.largestVariables = Math.max(stats.largestVariables, res.variables);
    const isConverged = res.status === "converged";
    if (!isConverged) {
      stats.unconverged++;
      const r = res.residuals;
      unconverged.push(
        `solve ${stats.solves} ${res.status} after ${res.iterations} iterations (primal ${r.primal.toExponential(1)}, dual ${r.dual.toExponential(1)}, gap ${r.gap.toExponential(1)})`,
      );
    }
    const { profiles, problems } = res;
    for (const c of crossingsHere) {
      const gap =
        evalProfile(profiles.get(c.upper)!, c.sUpper).z - evalProfile(profiles.get(c.lower)!, c.sLower).z;
      const isShort = gap < ROAD_CLEAR;
      if (!isShort) continue;
      const what = `clearance over ${c.lower} ${gap.toFixed(2)} m < ${ROAD_CLEAR} m at ${Math.round(c.sUpper)} m`;
      problems.get(c.upper)!.push(what);
      problems.get(c.lower)!.push(`under ${c.upper}: ${what}`);
    }
    const soft = new Map(ids.map((id) => [id, 0]));
    for (const c of couplings) {
      if (c.kind !== "within" || c.firm) continue;
      const d = evalProfile(profiles.get(c.a.run)!, c.a.s).z - evalProfile(profiles.get(c.b.run)!, c.b.s).z;
      const miss = Math.max(0, c.lo - d, d - c.hi);
      if (miss <= SOFT_SLACK_M) continue;
      soft.set(c.a.run, soft.get(c.a.run)! + miss);
      soft.set(c.b.run, soft.get(c.b.run)! + miss);
    }
    for (const id of ids) {
      const step = ladders.get(id)![level.get(id)!];
      const worst = problems.get(id)!.join("; ");
      attempts
        .get(id)!
        .push({ V: step.cap, special: step.special, crossingsOnly: step.crossingsOnly, worst });
      history.get(id)![level.get(id)!] = { soft: soft.get(id)!, clean: worst === "" };
    }
    return { profiles, problems, soft, isConverged };
  };

  let result = solveAt();
  for (;;) {
    // An unconverged solve is no verdict on any run: stepping runs down on it would lower speeds
    // for nothing. Stop and report (solver_not_converged); the exact checks still judge each run.
    if (!result.isConverged) break;
    const canStep = (id: string) => {
      const ladder = ladders.get(id)!;
      const next = level.get(id)! + 1;
      const isHard = result.problems.get(id)!.length > 0;
      if (isHard) return next < ladder.length;
      const isSoft = result.soft.get(id)! > 0;
      return isRamp(id) && isSoft && next < ladder.length && !ladder[next].crossingsOnly;
    };
    const advance = ids.filter(canStep);
    if (advance.length === 0) break;
    for (const id of advance) level.set(id, level.get(id)! + 1);
    result = solveAt();
  }
  // Ramps that stepped down for a shared deck and missed it no less: back to the cleanest step
  // that missed least (lowest first), then one more solve; a ramp the move breaks keeps its step.
  const moved = new Map<string, number>();
  for (const id of ids) {
    if (!isRamp(id)) continue;
    const seen = history.get(id)!;
    let best = level.get(id)!;
    for (let k = 0; k < seen.length; k++) {
      const h = seen[k];
      const isBetter = h !== undefined && h.clean && h.soft < seen[best].soft - 0.05;
      const isTie = h !== undefined && h.clean && Math.abs(h.soft - seen[best].soft) <= 0.05 && k < best;
      if (isBetter || isTie) best = k;
    }
    if (best === level.get(id)!) continue;
    moved.set(id, level.get(id)!);
    level.set(id, best);
  }
  if (moved.size > 0) {
    const tried = solveAt();
    const broken = [...moved.keys()].filter((id) => tried.problems.get(id)!.length > 0);
    const isUsable = tried.isConverged && broken.length === 0;
    if (!isUsable) for (const id of tried.isConverged ? broken : moved.keys()) level.set(id, moved.get(id)!);
    result = isUsable ? tried : solveAt();
  }
  if (unconverged.length > 0) {
    diagnostics.push({
      run: ids[0],
      kind: "solver_not_converged",
      detail: `component of ${ids.length} runs: ${unconverged.join("; ")}`,
      allowed: false,
    });
  }
  const { profiles, problems } = result;
  const banks = banksOf(plan, ids, profiles, setups);
  const solved = new Map<string, Solved>();
  const unsolved = new Map<string, VerticalAttempt[]>();
  for (const id of ids) {
    const isFailing = problems.get(id)!.length > 0;
    if (isFailing) {
      unsolved.set(id, attempts.get(id)!);
      continue;
    }
    const st = setups.get(id)!;
    const profile = profiles.get(id)!;
    const ends = st.ends.map((e, side) =>
      xwEnd(plan, e, side === 0 ? 0 : st.rp.length, profile, profiles, banks),
    );
    solved.set(id, {
      rp: st.rp,
      profile,
      steps: ladders.get(id)![level.get(id)!].steps,
      bank: banks.get(id)!,
      start: ends[0],
      end: ends[1],
      cross: st.cross,
      blocked: st.blocked,
    });
  }
  return { solved, unsolved, stats };
}

function xwEnd(
  plan: Plan,
  e: EndPlan,
  s: number,
  profile: VerticalProfile,
  profiles: Map<string, VerticalProfile>,
  banks: Map<string, Float64Array>,
): XwEnd {
  if (e.kind === "open") return { kind: "open" };
  const here = evalProfile(profile, s);
  if (e.kind === "ground") {
    const base = {
      z: roundTo(here.z, 3),
      grade: roundTo(here.grade, 5),
      ground: roundTo(here.z, 3),
      bank: 0,
    };
    return e.into ? { kind: "portal", into: e.into, ...base } : { kind: "ground", ...base };
  }
  const pp = plan.runs.get(e.parent)!;
  const ps = pp.align.s[pp.align.vertexSample[e.parentNodeIndex]] - pp.align.s[pp.i0];
  const parent = profiles.get(e.parent)!;
  const v = evalProfile(parent, ps);
  const pBank = banks.get(e.parent)!;
  const bank = pBank[Math.min(pBank.length - 1, Math.max(0, sampleAt(pp, ps) - pp.i0))];
  return {
    kind: e.kind,
    parent: e.parent,
    parentS: roundTo(ps, 2),
    z: roundTo(v.z, 3),
    grade: roundTo(v.grade, 5),
    bank: roundTo(bank, 4),
  };
}

/**
 * Superelevation of a component's runs, parents before children (a junction end takes its
 * parent's bank) and each run after the decks it shares a surface with (it takes their bank there:
 * the same for a deck going the same way, the opposite sign for one going the other way, so the slab
 * is one plane). Capped so the composite grade stays within 第25条.
 */
function banksOf(
  plan: Plan,
  ids: string[],
  profiles: Map<string, VerticalProfile>,
  setups: Map<string, RunSetup>,
): Map<string, Float64Array> {
  const members = new Set(ids);
  const parents = new Map(
    ids.map((id) => [id, junctionParents(plan, id).filter((p) => members.has(p) && p !== id)]),
  );
  const done = new Map<string, Float64Array>();
  const order: string[] = [];
  for (;;) {
    const next = ids.find(
      (id) => !done.has(id) && !order.includes(id) && parents.get(id)!.every((p) => order.includes(p)),
    );
    if (next === undefined) break;
    order.push(next);
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const sameWith = new Map<string, DeckPair[]>();
  for (const p of plan.pairs) {
    const isMine = p.relation === "same" && members.has(p.a) && members.has(p.b);
    if (!isMine) continue;
    sameWith.set(p.a, [...(sameWith.get(p.a) ?? []), p]);
  }
  for (const id of order) {
    const st = setups.get(id)!;
    const rp = st.rp;
    const profile = profiles.get(id)!;
    const n = rp.i1 - rp.i0 + 1;
    const sampleS = new Float64Array(n);
    const kappa = new Float64Array(n);
    const speeds: DesignSpeed[] = [];
    for (let i = rp.i0; i <= rp.i1; i++) {
      sampleS[i - rp.i0] = rp.align.s[i] - rp.align.s[rp.i0];
      kappa[i - rp.i0] = rp.align.kappa[i];
      speeds.push(zoneSpeedAt(profile.zones, sampleS[i - rp.i0]));
    }
    const room = sampleS.map((sv) => {
      const g = evalProfile(profile, sv).grade;
      const limit = compositeLimit(zoneSpeedAt(profile.zones, sv));
      // A street (第四種) banks to 6 % at most (第16条), the expressway to 10 %.
      const cap = rp.cls === "street" ? MAX_SUPERELEVATION.value.type4 : Infinity;
      return Math.min(cap, Math.sqrt(Math.max(0, limit * limit - g * g)) * 0.995);
    });
    const pins = new Float64Array(n).fill(Number.NaN);
    let transitionV = Math.max(...speeds) as DesignSpeed;
    for (const p of sameWith.get(id) ?? []) {
      const other = done.get(p.b);
      if (!other) continue;
      const orp = plan.runs.get(p.b)!;
      const ob = other[Math.min(other.length - 1, Math.max(0, sampleAt(orp, p.sb) - orp.i0))];
      const k = Math.min(n - 1, Math.max(0, sampleAt(rp, p.sa) - rp.i0));
      // Pin a short stretch around the pair station (pairs are every 5 m).
      for (let j = Math.max(0, k - 2); j <= Math.min(n - 1, k + 2); j++) pins[j] = p.cos >= 0 ? ob : -ob;
      transitionV = Math.max(transitionV, plan.runs.get(p.b)!.planV) as DesignSpeed;
    }
    const bankEnd = (side: number): number | null => {
      const e = st.ends[side];
      if (e.kind === "ground") return 0;
      if (e.kind === "open") return null;
      const pBank = done.get(e.parent);
      if (!pBank) return null;
      const pp = plan.runs.get(e.parent)!;
      const ps = pp.align.s[pp.align.vertexSample[e.parentNodeIndex]] - pp.align.s[pp.i0];
      return pBank[Math.min(pBank.length - 1, Math.max(0, sampleAt(pp, ps) - pp.i0))];
    };
    const bank = superelevation(
      speeds,
      kappa,
      sampleS,
      { start: bankEnd(0), end: bankEnd(1) },
      { room, pins, transitionV },
    );
    done.set(id, bank);
  }
  return done;
}

export function solvePlan(plan: Plan, ground: GroundSampler, objects: CrossObject[]): CompileResult {
  const diagnostics = [...plan.diagnostics];
  const objectPolys = objects.map((o) => {
    const poly = objectPoly(o);
    return { o, poly, box: bboxOf(poly) };
  });
  const solved = new Map<string, Solved>();
  const failed = new Set<string>();
  const neededComponents = [...new Set(plan.needed.map((id) => plan.componentOf.get(id)!))].sort();
  const stats: SolveStats = {
    components: 0,
    largestRuns: 0,
    largestVariables: 0,
    solves: 0,
    iterations: 0,
    qpMs: 0,
    unconverged: 0,
  };
  for (const cid of neededComponents) {
    const ids = plan.components.get(cid)!;
    const res = solveComponent(plan, ids, ground, objectPolys, diagnostics);
    stats.components++;
    stats.largestRuns = Math.max(stats.largestRuns, res.stats.largestRuns);
    stats.largestVariables = Math.max(stats.largestVariables, res.stats.largestVariables);
    stats.solves += res.stats.solves;
    stats.iterations += res.stats.iterations;
    stats.qpMs += res.stats.qpMs;
    stats.unconverged += res.stats.unconverged;
    for (const [id, s] of res.solved) solved.set(id, s);
    for (const [id, attempts] of res.unsolved) {
      failed.add(id);
      diagnostics.push({
        run: id,
        kind: "vertical_unsolved",
        detail: attempts
          .map(
            (a) =>
              `V${a.V}${a.special ? "特例" : ""}${a.crossingsOnly ? "交差のみ" : ""}: ${a.worst || "ok"}`,
          )
          .join(" | "),
        allowed: false,
      });
    }
  }
  // A run whose junction parent is not in the data would end in the air: left out, and reported.
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...solved.keys()].sort()) {
      const s = solved.get(id)!;
      const lost = [s.start, s.end].find((e) => e.parent !== undefined && !solved.has(e.parent));
      if (!lost) continue;
      solved.delete(id);
      failed.add(id);
      diagnostics.push({ run: id, kind: "parent_unsolved", detail: `parent ${lost.parent}`, allowed: false });
      changed = true;
    }
  }
  for (const s of solved.values()) {
    const isFallback = s.steps[0] !== "standard";
    // Dropping the floor over open ground (crossings only) breaks T4's clearance away from the
    // ground ends, so it is a kind of its own that the allowlist does not cover wholesale.
    const isCrossingsOnly = s.steps.includes("crossingsOnly");
    if (isFallback)
      diagnostics.push({
        run: s.rp.run.id,
        kind: isCrossingsOnly ? "vertical_crossings_only" : "vertical_fallback",
        detail: s.steps.join(">") + ` V${Math.max(...s.profile.zones.map((z) => z.V))}`,
        allowed: false,
      });
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
    const over = plan.runs.get(id)!.over;
    // A structure's deck that cannot be solved would leave a hole in the bridge: stop the build.
    const isLostDeck = !s && over !== null;
    if (isLostDeck) {
      const why = diagnostics.filter((d) => d.run === id).map((d) => `${d.kind}: ${d.detail}`);
      throw new StructureMismatchError(`${over.deck.id}: run ${id} is not solved (${why.join("; ")})`);
    }
    if (!s) continue;
    const runChunks = chunkRun(plan, s, ground, objectPolys);
    const structure = over ? structureCheck(over, runChunks) : null;
    chunks.push(...runChunks);
    runs.push({
      id,
      chain: s.rp.chain.id,
      cls: s.rp.cls,
      ref: s.rp.ref,
      lengthM: roundTo(s.rp.length, 2),
      V: Math.max(...s.profile.zones.map((z) => z.V)),
      tagV: s.rp.tagV,
      planV: s.rp.planV,
      minRadiusM: roundTo(Math.min(s.rp.minRadius, 1e6), 1),
      maxShiftM: roundTo(s.rp.align.maxShiftM, 3),
      steps: s.steps,
      start: s.start,
      end: s.end,
      chunks: runChunks.map((c) => c.id),
      structure,
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
  return { chunks, runs, diagnostics, stats };
}

/**
 * How a run's chunks meet its structure (設計書 4.6 の検査): over the girder each station's distance
 * from axis + band centre, over sRange its z from the formula at the station's own axis distance.
 * Past the tolerances (`tolerance.horizontal` / `.vertical`) the build fails: the pins hold plan and
 * profile, so a miss is a bug or a structure the QP could not meet.
 */
function structureCheck(o: RunOver, chunks: XwChunk[]): XwRunStructure {
  let planM = 0;
  let zM = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      const s = c.st[i];
      const p = toAxis(o.st, c.st[i + 1], c.st[i + 2]);
      const isOnGirder = s >= o.g0 - 1e-6 && s <= o.g1 + 1e-6;
      if (isOnGirder) planM = Math.max(planM, Math.abs(p.offset - o.deck.bandOffset));
      const isOnStructureRange = s >= o.p0 - 1e-6 && s <= o.p1 + 1e-6 && isOnStructure(o.st, p.s);
      if (isOnStructureRange) zM = Math.max(zM, Math.abs(c.st[i + 3] - deckSurface(o.st, o.deck, p.s).z));
    }
  }
  // 設計書 4.6: z within 5 cm of the levels where the structure carries the deck, and the plan as
  // pinned. Why not the levels' matching tolerance (3 m / 1.5 m): that rule is for OSM's lines; the
  // compiled deck is pinned, so anything past a few centimetres is a bug.
  const isOff = zM > STRUCTURE_CHECK_M || planM > STRUCTURE_CHECK_M;
  if (isOff) {
    throw new StructureMismatchError(
      `${o.deck.id}: compiled deck off its levels by ${planM.toFixed(3)} m across, ${zM.toFixed(3)} m in height (allowed ${STRUCTURE_CHECK_M} m)`,
    );
  }
  return {
    deck: o.deck.id,
    s0: roundTo(o.p0, 2),
    s1: roundTo(o.p1, 2),
    osmM: roundTo(o.osm.deviationM, 3),
    planM: roundTo(planM, 4),
    zM: roundTo(zM, 4),
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

/** A plan station this close to a knot moves onto it instead of adding one (the plan chord barely changes). */
const KNOT_SNAP_M = 2.5;

/**
 * The chunk's stations: the plan stations with every knot added. The ends a and b never move (the
 * next chunk starts exactly there); an interior plan station within KNOT_SNAP_M of a knot moves onto
 * it instead of adding one, at most one per knot. Why the ends by value and not by index: once a
 * knot was appended the last index was no longer b, and b itself got moved onto a knot (gaps of up
 * to 2.49 m at chunk seams in the full build).
 */
export function stationPositions(plan: number[], knots: number[], a: number, b: number): number[] {
  const out = [...plan];
  const moved = new Set<number>();
  for (const knot of knots) {
    const near = out.findIndex(
      (sv, i) => sv !== a && sv !== b && !moved.has(i) && Math.abs(sv - knot) < KNOT_SNAP_M,
    );
    if (near >= 0) {
      out[near] = knot;
      moved.add(near);
    } else out.push(knot);
  }
  return out.sort((p, q) => p - q).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 1e-6);
}

/** Knots strictly inside (a, b) where the vertical curvature changes (parabola to parabola). */
function curvatureKnots(p: VerticalProfile, a: number, b: number): number[] {
  const out: number[] = [];
  const m = p.z.length - 1;
  for (let j = 1; j < m; j++) {
    const s = j * p.h;
    const isInside = s > a + 0.5 && s < b - 0.5;
    if (!isInside) continue;
    const before = (p.g[j] - p.g[j - 1]) / p.h;
    const after = (p.g[j + 1] - p.g[j]) / p.h;
    const isChange = Math.abs(after - before) > 1e-6;
    if (isChange) out.push(s);
  }
  return out;
}

/** Station spacing from the plan curvature: 5 m on tight curves, up to 20 m on straights. */
function stationStep(kappa: number): number {
  const R = 1 / Math.max(Math.abs(kappa), 1e-6);
  return Math.min(20, Math.max(5, Math.sqrt(8 * R * 0.03)));
}

/**
 * A run's stretches over or under other runs' carriageways, from the plan pairs: consecutive pair
 * stations with one partner and one relation within STRETCH_GAP_M make one stretch (padded by half
 * the pair spacing).
 */
function deckStretches(plan: Plan, id: string): XwDeckStretch[] {
  const mine = plan.pairs
    .filter((p) => p.a === id)
    .sort((p, q) => (p.b < q.b ? -1 : p.b > q.b ? 1 : p.sa - q.sa));
  const out: XwDeckStretch[] = [];
  const S = plan.runs.get(id)!.length;
  for (const p of mine) {
    const last = out[out.length - 1];
    const isSame =
      last !== undefined &&
      last.with === p.b &&
      last.relation === p.relation &&
      p.sa - last.s1 <= STRETCH_GAP_M;
    if (isSame) last.s1 = Math.min(S, p.sa + GRID_M / 2);
    else
      out.push({
        with: p.b,
        relation: p.relation,
        s0: Math.max(0, p.sa - GRID_M / 2),
        s1: Math.min(S, p.sa + GRID_M / 2),
      });
  }
  return out;
}

/** Stretches of a run over another deck (where its piers would stand on that deck). */
function overDeck(plan: Plan, id: string): Array<[number, number]> {
  return plan.pairs.filter((p) => p.a === id && p.relation === "above").map((p) => [p.sa - 6, p.sa + 6]);
}

/** Whether s belongs to the chunk [a, b) (the last chunk keeps its end). */
function within(sv: number, a: number, b: number, isLast: boolean): boolean {
  return sv >= a && (sv < b || (isLast && sv <= b));
}

function chunkRun(plan: Plan, s: Solved, ground: GroundSampler, objects: ObjectPoly[]): XwChunk[] {
  const { rp, profile } = s;
  const S = rp.length;
  const base = rp.align.s[rp.i0];
  // Cut points: junction nodes (other chains attach), section changes, speed changes, the run ends.
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
  for (const z of profile.zones) if (z.from > 0) cuts.add(z.from);
  const o = rp.over;
  if (o) {
    // The girder's ends, sRange's (no girder inside), and the taper's steps (each step one section).
    for (const v of [o.g0, o.g1, o.p0, o.p1]) if (v > 0 && v < S) cuts.add(v);
    // A taper only where the way's section differs from the deck's (the upper floor); where they are
    // the same (the lower road: 第四種 and the strips agree) its chunks are not cut at all.
    const differs = (sv: number) => {
      const way = plan.net.ways.get(rp.wayAt[Math.min(rp.i1, sampleAt(rp, sv)) - rp.i0])!;
      const own = sectionFor(way.cls, way.lanes);
      const d = o.deck.section;
      return (
        own.lanes === d.lanes &&
        (own.laneWidth !== d.laneWidth || own.shoulderL !== d.shoulderL || own.shoulderR !== d.shoulderR)
      );
    };
    const ends = [
      { from: o.g0, to: o.t0, isTaper: differs(o.t0) },
      { from: o.g1, to: o.t1, isTaper: differs(o.t1) },
    ];
    for (const e of ends) {
      if (!e.isTaper) continue;
      for (let k = 1; k <= TAPER_STEPS; k++) {
        const v = e.from + (e.to - e.from) * (k / TAPER_STEPS);
        if (v > 0 && v < S) cuts.add(v);
      }
    }
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
  // Piers every PIER_SPACING from the run start, moved off the roads and railways underneath; none
  // where the deck stands over another deck (a pier there would come through its carriageway).
  const mine = runPoly(rp);
  const avoid: Array<[number, number]> = [];
  for (const { poly } of objectsNear(objects, mine)) {
    for (const [sc, , sin] of intersect(mine, poly)) {
      const w = (GROUND_ROAD_HALF_WIDTH.value + 1) / Math.max(sin, 0.25);
      avoid.push([sc - w, sc + w]);
    }
  }
  const decksBelow = overDeck(plan, rp.run.id);
  const stretches = deckStretches(plan, rp.run.id);
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
    const isOverDeck = decksBelow.some(([a, b]) => at >= a && at <= b);
    if (isOverDeck) continue;
    // The structure's spans and anchorages carry the deck (pierFreeRange): no pier of our own there.
    const isCarried = rp.over !== null && isPierFree(rp.over.st, rp.over.axisAt(at));
    if (isCarried) continue;
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
  /**
   * A chunk's section and structure: on the structure its deck's (no girder), in a taper step the
   * way's section moved towards the deck's by how far the step's middle is from the taper's end.
   */
  const sectionAt = (a: number, b: number): { section: XwSection; over: XwOver | null; girder: number } => {
    const mid = (a + b) / 2;
    const own = sec(sampleAt(rp, mid));
    if (!o) return { section: own, over: null, girder: GIRDER };
    // Inside sRange the structure carries the deck: no girder of our own (the truss, the anchorage).
    const girder = mid > o.p0 && mid < o.p1 ? 0 : GIRDER;
    const isOnGirder = mid > o.g0 && mid < o.g1;
    if (isOnGirder) {
      const over: XwOver = {
        deck: o.deck.id,
        level: o.deck.level,
        apronL: o.deck.aprons.left,
        apronR: o.deck.aprons.right,
      };
      return { section: o.deck.section, over, girder };
    }
    const t =
      mid <= o.g0 ? (o.g0 - mid) / Math.max(1e-6, o.g0 - o.t0) : (mid - o.g1) / Math.max(1e-6, o.t1 - o.g1);
    const d = o.deck.section;
    const isTaper = t < 1 && d.lanes === own.lanes;
    if (!isTaper) return { section: own, over: null, girder };
    const w = 1 - ease(t);
    const lerp = (p: number, q: number) => roundTo(p + (q - p) * w, 3);
    const isSame =
      d.laneWidth === own.laneWidth && d.shoulderL === own.shoulderL && d.shoulderR === own.shoulderR;
    if (isSame) return { section: own, over: null, girder };
    return {
      section: {
        ...own,
        laneWidth: lerp(own.laneWidth, d.laneWidth),
        shoulderL: lerp(own.shoulderL, d.shoulderL),
        shoulderR: lerp(own.shoulderR, d.shoulderR),
        basis: "assumption",
      },
      over: null,
      girder,
    };
  };
  const chunks: XwChunk[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const isLast = k + 2 === bounds.length;
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
        roundTo(v.grade, 5),
      );
    };
    // Stations by the plan curvature, plus every knot where the vertical curvature changes: a
    // station interval then lies within one parabola, which the Hermite surface reproduces exactly.
    // Why not plan stations alone: across a knot the cubic overshoots the end grades (5.02 % on a
    // 5 % section) and the curvature (1.05e-3 against 1/1000).
    const positions: number[] = [];
    for (let sv = a; sv < b - 2;) {
      positions.push(sv);
      sv += stationStep(poseAt(rp, sv).kappa);
    }
    positions.push(b);
    for (const sv of stationPositions(positions, curvatureKnots(profile, a, b), a, b)) push(sv);
    const { section, over, girder } = sectionAt(a, b);
    const V = zoneSpeedAt(profile.zones, (a + b) / 2);
    const chunkPiers: number[] = [];
    for (let i = 0; i < piers.length; i += 2) {
      if (within(piers[i], a, b, isLast)) chunkPiers.push(roundTo(piers[i], 2), roundTo(piers[i + 1], 2));
    }
    const chunkCross: number[] = [];
    for (let i = 0; i < s.cross.length; i += 3) {
      const sc = s.cross[i];
      if (!within(sc, a, b, isLast)) continue;
      const z = evalProfile(profile, sc).z;
      chunkCross.push(roundTo(sc, 2), roundTo(s.cross[i + 1], 3), roundTo(s.cross[i + 2], 3), roundTo(z, 3));
    }
    const chunkBlocked: number[] = [];
    for (let i = 0; i < s.blocked.length; i += 2) {
      const sc = s.blocked[i];
      if (!within(sc, a, b, isLast)) continue;
      chunkBlocked.push(roundTo(sc, 2), roundTo(s.blocked[i + 1], 3), roundTo(evalProfile(profile, sc).z, 3));
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
      over,
      lanes: section.lanes,
      laneWidth: section.laneWidth,
      shoulderL: section.shoulderL,
      shoulderR: section.shoulderR,
      basis: section.basis,
      V,
      vh: roundTo(profile.h, 3),
      gmax: gradeLimitFor(V, profile.special),
      g0: roundTo(evalProfile(profile, a).grade, 6),
      g1: roundTo(evalProfile(profile, b).grade, 6),
      h0: roundTo(headingAt(rp, a), 6),
      h1: roundTo(headingAt(rp, b), 6),
      girder,
      st,
      piers: chunkPiers,
      cross: chunkCross,
      blocked: chunkBlocked,
      decks: stretches
        .filter((d) => d.s1 > a && d.s0 < b)
        .map((d) => ({ ...d, s0: roundTo(Math.max(a, d.s0), 2), s1: roundTo(Math.min(b, d.s1), 2) })),
      prev: k > 0 ? `${rp.run.id}:${k - 1}` : null,
      next: isLast ? null : `${rp.run.id}:${k + 1}`,
    });
  }
  return chunks;
}
