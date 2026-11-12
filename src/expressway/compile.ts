import {
  CLEARANCE_HEIGHT,
  CURVE_RADIUS,
  type DesignSpeed,
  designSpeedAtMost,
  lowerDesignSpeed,
  MAX_GRADE,
  MAX_SUPERELEVATION,
  TRANSITION_LENGTH,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../law/roadStandards";
import {
  DEM_SINK_FLOOR,
  DEM_SINK_GIVE,
  GIRDER_DEPTH,
  GROUND_END_BAND,
  OPEN_FLOOR_GIVE,
  OPEN_GROUND_FLOOR,
  GROUND_ROAD_HALF_WIDTH,
  MAX_LATERAL_SHIFT,
  PIER_SPACING,
  RAIL_CLEARANCE,
  RAMP_MIN_RADIUS,
  SHARED_TOUCHDOWN,
  COMPANIONS,
  RAMP_SHIFT,
  HOLD_MAINS,
  STANDARD_UNDERCLEARANCE,
} from "./assumptions";
import { atGradeCrossingDetail, isAllowed, SAME_SURFACE_ALLOWED_DZ_M } from "./allowlist";
import { BLOCK_QUIET_FACTOR, DESIGN_GROUND_REACH, HEIGHT_STRUCTURES } from "./assumptions";
import { BLOCK_MAX_VARIABLES, type BlockPartition, type PieceInfo, pieceAt, partitionOf } from "./blocks";
import {
  belowStructure,
  ceilingAt,
  depthFor,
  isBelowCompiled,
  isCoverStretchTooShort,
  isHoleAt,
  portalsOf,
} from "./below";
import { envelope, groundTarget } from "./designGround";
import {
  GIRDER_GIVE_M,
  girderFor,
  HEIGHT_DEAD_BAND_M,
  heightClassAt,
  type HeightClass,
  type HeightStretch,
  heightStretches,
  afterSpanning,
  clearsOnThinGirder,
  isWindowOver,
  sameKept,
  forceViaduct,
} from "./heightStructures";
import {
  STATION_STRIDE,
  type XwChunk,
  type XwClosed,
  type XwDeckStretch,
  type XwDiagnostic,
  type XwEnd,
  type XwOver,
  type XwPortal,
  type XwRunStructure,
  type XwStructure,
  type XwGroundFit,
  type XwRunSummary,
} from "./format";
import { planeAt, type Plane, roundTo } from "./geo";
import { alignPlan, type PlanAlignment } from "./horizontal";
import {
  buildChains,
  type Chain,
  type Network,
  type RoadClass,
  type Run,
  splitRuns,
  wayLength,
} from "./network";
import {
  deckOverlaps,
  LEVEL_APART_M,
  pairStations,
  type PlanLine,
  planOverlaps,
  SAME_SURFACE_M,
} from "./overlap";
import { isJoined, NOSE_MAX_DZ_M } from "./overlapClass";
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
import { surfaceAt } from "./profile";
import { compositeLimit, superelevation } from "./superelevation";
import {
  capZones,
  type Coupling,
  evalProfile,
  fallbackPlans,
  gradeLimitFor,
  knotIntervals,
  type ProfilePin,
  type Ref,
  type RunInput,
  type RunProblem,
  solveJoint,
  type VerticalAttempt,
  type VerticalProfile,
  W_GRADE_CHANGE,
  type Zone,
  zoneSpeedAt,
} from "./vertical";

/**
 * The vertical objective (P2.7-3, S3). v1 (the default): the target is the standard underclearance
 * over the ground averaged over ±60 m, and only W_SMOOTH's square resists a grade change. v2
 * (measuring only, `--objective v2`): the target stands on the design ground line (designGround.ts,
 * the upper envelope over a viaduct, the lower one under a tunnel or cut, `reachM` either side), and
 * every arc's grade change also costs `gradeChange` in L1 (vertical.ts W_GRADE_CHANGE); the target's
 * own weight is W_TARGET × `targetScale`. The ends and the floors and ceilings are the same in both.
 */
export type Objective =
  | { kind: "v1" }
  | { kind: "v2"; gradeChange: number; reachM: { viaduct: number; below: number }; targetScale: number };

export type ObjectiveV2 = Extract<Objective, { kind: "v2" }>;

export const OBJECTIVE_V1: Objective = { kind: "v1" };

/** v2 at its assumed weights (vertical.ts W_GRADE_CHANGE, assumptions.DESIGN_GROUND_REACH). */
export const OBJECTIVE_V2: ObjectiveV2 = {
  kind: "v2",
  gradeChange: W_GRADE_CHANGE,
  reachM: { ...DESIGN_GROUND_REACH.value },
  targetScale: 1,
};

/** A setup's objective weights as a run input's fields (none for v1). */
function inputWeights(
  st: Pick<RunSetup, "gradeChange" | "targetScale">,
): Pick<RunInput, "gradeChange" | "targetScale"> {
  return {
    ...(st.gradeChange === undefined ? {} : { gradeChange: st.gradeChange }),
    ...(st.targetScale === undefined ? {} : { targetScale: st.targetScale }),
  };
}

/** The objective's weights a run's inputs carry (none for v1, so its inputs stay as they were). */
function objectiveWeights(objective: Objective): Pick<RunSetup, "gradeChange" | "targetScale"> {
  if (objective.kind === "v1") return {};
  return { gradeChange: objective.gradeChange, targetScale: objective.targetScale };
}

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

/** The diagnostics that leave a run out of the data (the first one found is its closure reason). */
const CLOSING_KINDS = ["vertical_unsolved", "parent_unsolved"];

const GRID_M = 5;
export const MAX_CHUNK_M = 300;
const GIRDER = GIRDER_DEPTH.value;
const ROAD_CLEAR = CLEARANCE_HEIGHT.value + GIRDER;
/** The deck over open ground: the assumed floor under the girder plus the girder. */
const OPEN_OVER_GROUND = OPEN_GROUND_FLOOR.value + GIRDER;
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

export type RunPlan = {
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
  /** A tunnel or cut (P9): the road goes below the ground between its portals (below.ts). */
  below: boolean;
  /** Per sample: 1 inside a tunnel way, 0 elsewhere (a cut, or any sample of an elevated run). */
  tunnelAt: Uint8Array;
  /**
   * A run at grade (S6 PR 2, `--ground compile`): neither a viaduct nor below the ground by its tags,
   * compiled in a chain that has a compiled run; its profile follows the design ground line in a band.
   */
  ground: boolean;
};

export type Crossing = { upper: string; lower: string; sUpper: number; sLower: number; sinAngle: number };

/** How station `sa` of run a stands to b's deck at sb: one surface, or a level above / below it. */
export type DeckPair = {
  a: string;
  sa: number;
  b: string;
  sb: number;
  relation: "same" | "above" | "below";
  cos: number;
  /**
   * Not held a level apart in the QP (no coupling row): two main lines coming down to the same
   * place, within the climb of their ground ends (`markSharedTouchdowns`). The pair and its relation
   * stay (the chunks' `decks`, deck_overlap).
   */
  untied?: true;
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
  /** Chains through each node, and the compiled runs of each chain (elevated and below). */
  nodeChains: Map<number, string[]>;
  chainRuns: Map<string, RunPlan[]>;
  /** Below runs not compiled (a junction under the ground or the universe's edge: below.ts). */
  belowDeferred: string[];
  /**
   * The ends of each run, given instead of found from the chains: a piece plan (blocks.ts), whose
   * pieces share their run's chain indices, so endPlan's search by index would mix them up.
   */
  ends?: Map<string, [EndPlan, EndPlan]>;
  /** `--partition blocks` (blocks.ts): the anchors, the pieces and the blocks; absent for components. */
  partition?: BlockPartition;
  /**
   * A piece plan's pieces: the run each is cut from and where it starts on it, so what is written
   * (the problems' texts) names runs and run distances, never a piece (blocks.ts).
   */
  pieceRuns?: Map<string, { run: string; a: number }>;
  /**
   * `--structures height` (P2.7-6 PR 1): the structure a viaduct-tagged run is drawn as comes from its
   * solved height (heightStructures.ts), the assumed floors no longer unsolve a run, a thinner girder
   * takes a clearance short by up to GIRDER_GIVE_M, and a road near a low end that the solved deck does
   * not clear is blocked. Absent: the tags' structures, as before.
   */
  structures?: "height";
  /** `--ground compile` (S6 PR 2): the runs at grade of a chain with a compiled run are compiled too. */
  ground?: "compile";
  /** The stretches at grade left out as the open part between two tunnels (S7's). */
  betweenTunnels?: string[];
  /**
   * `--touchdown all` (S6 PR 3): markSharedTouchdowns lets go the pairs of every class, not only two
   * main lines'. Absent: main lines only, as before.
   */
  touchdown?: "all";
  /**
   * `--companions on` (S6 PR 3): main lines running beside each other (findCompanions), held to one
   * height softly at this weight. Absent: none, as before.
   */
  companions?: { weight: number; list: Companion[] };
  /**
   * `--nose-surface overlap` (S6 PR 4): two runs that meet at a node (a junction) are one surface
   * wherever their carriageways overlap (classifyPairs), not only from the nose on. Absent: as before.
   */
  noseSurface?: "overlap";
  /** `--ramp-shift <m>` (S6 PR 4): the cap of the moves (rampShiftOffsets), carried to the run summaries. */
  rampShiftCapM?: number;
  /**
   * `--hold-mains on` (S6 PR 6): a main line off its own line near a ramp's junction counts as the
   * ramp's soft miss (solveComponent, HOLD_MAINS). Absent: as before.
   */
  holdMains?: "on";
  /** The N2 sweep's (PlanOptions.groundTargetScale / groundBandM): absent, the assumptions'. */
  groundTargetScale?: number;
  groundBandM?: number;
};

/**
 * Two main lines beside each other at one height (S6 PR 3, findCompanions): station sa of a with
 * station sb of b, every COMPANIONS.stepM along a.
 */
export type Companion = {
  a: string;
  sa: number;
  b: string;
  sb: number;
  /** false: within the climb of an end where the two part in height, no row (findCompanions). */
  held?: false;
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
function runOver(
  rp: Omit<RunPlan, "over" | "below" | "tunnelAt" | "ground">,
  found: NonNullable<ReturnType<typeof chainPin>>,
): RunOver | null {
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

/**
 * How planNetwork picks what to build, beyond the boxes. `wanted`: the runs of the range, chosen
 * from the whole plan (scope.ts shipRuns for --range ship) instead of the boxes. `pruneBelow`:
 * false compiles every below run, even those joining two components (--below all, to measure only:
 * the defaults move by it, P2.7-1).
 */
export type PlanOptions = {
  wanted?: (plan: Plan) => ReadonlySet<string>;
  pruneBelow?: boolean;
  /**
   * `blocks` cuts the main lines at anchors and solves block by block (P2.7-2, blocks.ts, measuring
   * only); `components` (the default) solves each component in one QP, as before.
   */
  partition?: "components" | "blocks";
  /** k of the anchors' quiet margin (assumptions.BLOCK_QUIET_FACTOR by default). */
  quietFactor?: number;
  /** For tests: the least quiet margin and the anchors' spacing (assumptions by default). */
  quietMin?: number;
  anchorSpacing?: number;
  /** Where a viaduct-tagged run's structure comes from (Plan.structures); `tags` by default. */
  structures?: "tags" | "height";
  /** Whether a chain's runs at grade are compiled (Plan.ground); `skip` by default. Needs `height`. */
  ground?: "skip" | "compile";
  /** Which classes' pairs coming down to the same place are let go (Plan.touchdown); `mains` by default. */
  touchdown?: "mains" | "all";
  /** The weight of the companions' rows (Plan.companions); none by default. Needs `components`. */
  companionWeight?: number;
  /**
   * `--ramp-shift` (S6 PR 4): per chain, the metres each of its resampled samples moves off the OSM
   * line (horizontal.ts PlanInput.offset), from a first solve (rampShiftOffsets). None by default.
   */
  rampOffsets?: ReadonlyMap<string, Float64Array>;
  /** The cap the offsets were made to (`--ramp-shift <m>`), for the run summaries and T6 (Plan.rampShiftCapM). */
  rampShiftCapM?: number;
  /** `--nose-surface overlap` (S6 PR 4, Plan.noseSurface); `nose` (from the nose on) by default. */
  noseSurface?: "nose" | "overlap";
  /** `--hold-mains on` (S6 PR 6, Plan.holdMains); `off` by default. Needs `components`. */
  holdMains?: "off" | "on";
  /** `--ground-target-scale <k>` (S6 PR 7a, N2 sweep): the runs at grade's target weight × k. */
  groundTargetScale?: number;
  /** `--ground-band <m>` (S6 PR 7a, N2 sweep): the runs at grade's band (HEIGHT_STRUCTURES.ground.bandM). */
  groundBandM?: number;
};

/** Plan the alignment of every chain, the couplings between runs and what the range needs. */
export function planNetwork(
  net: Network,
  outsideNodes: Set<number>,
  range: Bbox | readonly Bbox[] | null,
  structures: readonly Structure[] = [],
  options: PlanOptions = {},
): Plan {
  // A run at grade is drawn as the structures by height make it (a cut or an embankment): without them
  // it would be a viaduct on the ground.
  const isGroundMode = options.ground === "compile";
  const isGroundWithoutHeight = isGroundMode && options.structures !== "height";
  if (isGroundWithoutHeight) throw new Error("ground runs (ground: compile) need structures: height");
  const ranges: readonly Bbox[] | null =
    range === null ? null : Array.isArray(range) ? range : [range as Bbox];
  const chains = new Map(buildChains(net).map((c) => [c.id, c]));
  const nodeChains = new Map<number, string[]>();
  for (const c of chains.values()) {
    for (const n of new Set(c.nodes)) nodeChains.set(n, [...(nodeChains.get(n) ?? []), c.id]);
  }
  const runs = new Map<string, RunPlan>();
  const diagnostics: XwDiagnostic[] = [];
  const belowDeferred: string[] = [];
  const betweenTunnels: string[] = [];
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
    const offset = options.rampOffsets?.get(chain.id);
    const align = alignPlan({
      xy,
      anchors,
      ...(found ? { pin: found.pin } : {}),
      ...(offset ? { offset } : {}),
    });
    for (const run of chainRuns) {
      const isBelow = isBelowCompiled(chain, run, nodeChains, outsideNodes);
      const isDeferred = run.below && !isBelow;
      if (isDeferred) belowDeferred.push(run.id);
      // A stretch at grade between two tunnels or cuts is the open part of the tunnel, not a road at grade:
      // its level is the tunnels', deep under the DEM the band would hold it to. 赤坂 (4号新宿線):
      // 816254799 and 816254802, 35 m each between the tunnels 24636426 and 816254800 (and 24636427's
      // pair), unsolved at every step (end elevation off by 3.6 m and 0.92 m). Left out, as with skip
      // (the tunnels end there at the ground, as before; S7 takes the open part with the tunnels).
      // Only one shorter than a vertical curve at its tagged speed (第22条): a longer stretch is a road at
      // grade between two tunnels (678697941, 1,723 m, review W4) and is compiled.
      const k = chainRuns.indexOf(run);
      const isBelowRun = (r: Run | undefined) => r !== undefined && r.below;
      const firstWay = net.ways.get(run.ways[0])!;
      const curve = VERTICAL_CURVE_LENGTH.value[designSpeedAtMost(firstWay.maxspeedTag ?? 60)];
      const runLength = run.ways.reduce((n, w) => n + wayLength(net, net.ways.get(w)!), 0);
      const isBetweenTunnels =
        isBelowRun(chainRuns[k - 1]) && isBelowRun(chainRuns[k + 1]) && runLength < curve;
      if (isGroundMode && isBetweenTunnels) betweenTunnels.push(run.id);
      const isGround = isGroundMode && !run.elevated && !run.below && !isBetweenTunnels;
      const isCompiled = run.elevated || isBelow || isGround;
      if (!isCompiled) continue;
      const rp = runPlan(net, chain, plane, align, run, isBelow ? null : found);
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
    belowDeferred,
    ...(isGroundMode ? { betweenTunnels } : {}),
    ...(options.structures === "height" ? { structures: "height" as const } : {}),
    ...(isGroundMode ? { ground: "compile" as const } : {}),
    ...(options.touchdown === "all" ? { touchdown: "all" as const } : {}),
    ...(options.noseSurface === "overlap" ? { noseSurface: "overlap" as const } : {}),
    ...(options.rampShiftCapM !== undefined ? { rampShiftCapM: options.rampShiftCapM } : {}),
    ...(options.holdMains === "on" ? { holdMains: "on" as const } : {}),
    ...(options.groundTargetScale !== undefined ? { groundTargetScale: options.groundTargetScale } : {}),
    ...(options.groundBandM !== undefined ? { groundBandM: options.groundBandM } : {}),
  };
  for (const rp of runs.values())
    plan.chainRuns.set(rp.chain.id, [...(plan.chainRuns.get(rp.chain.id) ?? []), rp]);
  plan.pairs = classifyPairs(plan);
  const isPruned = options.pruneBelow ?? true;
  if (isPruned) pruneBelow(plan);
  markSharedTouchdowns(plan);
  const isCompanioned = options.companionWeight !== undefined;
  // Not in blocks (blocks.ts cuts the main lines at anchors and knows no companion rows).
  const isCompanionsInBlocks = isCompanioned && options.partition === "blocks";
  // Not in blocks either: a block's main line is cut at anchors, and its own line would be a piece's.
  const isHoldInBlocks = options.holdMains === "on" && options.partition === "blocks";
  if (isHoldInBlocks) throw new Error("hold-mains needs partition: components");
  if (isCompanionsInBlocks) throw new Error("companions need partition: components");
  if (isCompanioned) plan.companions = { weight: options.companionWeight!, list: findCompanions(plan) };
  groupComponents(plan);
  const chosen = options.wanted?.(plan);
  const wanted = [...runs.values()].filter((rp) => {
    if (chosen) return chosen.has(rp.run.id);
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
  // A run at grade a wanted run hangs from (a seam, a junction) is wanted too (S6 PR 2): the ranges
  // pick runs by their own ways, and one outside them left its children in the air (dangling).
  // A run so added brings its own parents too, of any kind (4848757 in the default range hung from a
  // viaduct outside the boxes).
  const added = new Set<string>();
  for (let isGrown = isGroundMode; isGrown;) {
    isGrown = false;
    for (const id of [...plan.wanted].sort()) {
      for (const p of junctionParents(plan, id)) {
        const isMissing = !plan.wanted.has(p);
        const isTaken = plan.runs.get(p)?.ground === true || added.has(id);
        if (!isMissing || !isTaken) continue;
        plan.wanted.add(p);
        added.add(p);
        isGrown = true;
      }
    }
  }
  const needed = new Set<string>();
  for (const id of plan.wanted)
    for (const m of plan.components.get(plan.componentOf.get(id)!)!) needed.add(m);
  plan.needed = [...needed].sort();
  const isBlocks = options.partition === "blocks";
  if (isBlocks) {
    plan.partition = partitionOf(plan, options.quietFactor ?? BLOCK_QUIET_FACTOR.value, {
      ...(options.quietMin !== undefined ? { quietMin: options.quietMin } : {}),
      ...(options.anchorSpacing !== undefined ? { spacing: options.anchorSpacing } : {}),
    });
    plan.needed = plan.partition.neededRuns;
  }
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
  const rp: Omit<RunPlan, "over" | "below" | "tunnelAt" | "ground"> = {
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
  const tunnelAt = Uint8Array.from(wayAt, (w) => (run.below && belowStructure(net, w) === "tunnel" ? 1 : 0));
  const isGround = !run.elevated && !run.below;
  return { ...rp, over: found ? runOver(rp, found) : null, below: run.below, tunnelAt, ground: isGround };
}

/** Holes of one kind: how many and how long (km). */
export type HoleTally = { count: number; km: number };

/**
 * The main line's holes (S6 PR 2 5.1 の 7): in every chain with a written main-line run, the runs at
 * grade (splitRuns) not written, by where they are: beside a below run not written (the tunnels S7
 * takes), at the chain's end (the range's edge, or where the road comes down for good), or elsewhere
 * (the holes the runs at grade fill).
 */
export function mainLineHoles(
  plan: Plan,
  written: ReadonlySet<string>,
): {
  holes: HoleTally;
  besideBelow: HoleTally;
  atChainEnd: HoleTally;
  outsideRange: HoleTally;
  belowUnwritten: HoleTally;
} {
  const out = {
    holes: { count: 0, km: 0 },
    besideBelow: { count: 0, km: 0 },
    atChainEnd: { count: 0, km: 0 },
    outsideRange: { count: 0, km: 0 },
    // The tunnels and cuts of those chains not written (deferred or pruned: S7's), review C1.
    belowUnwritten: { count: 0, km: 0 },
  };
  for (const chain of [...plan.chains.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const isMainWritten = (plan.chainRuns.get(chain.id) ?? []).some(
      (rp) => rp.cls === "expressway" && written.has(rp.run.id),
    );
    if (!isMainWritten) continue;
    const runs = splitRuns(plan.net, chain);
    runs.forEach((run, i) => {
      const km = run.ways.reduce((n, w) => n + wayLength(plan.net, plan.net.ways.get(w)!), 0) / 1000;
      const isLostBelow = run.below && !written.has(run.id);
      if (isLostBelow) {
        out.belowUnwritten.count++;
        out.belowUnwritten.km += km;
      }
      const isAtGrade = !run.elevated && !run.below;
      if (!isAtGrade || written.has(run.id)) return;
      const isBesideBelow = [runs[i - 1], runs[i + 1]].some(
        // Any tunnel or cut beside it, written or not: between two the stretch is the tunnel's open part (S7).
        (r) => r !== undefined && r.below,
      );
      const isAtEnd = i === 0 || i === runs.length - 1;
      // Compiled but not of the range (outside the wards, or not reached from its main lines).
      const isOutside = plan.runs.has(run.id) && !plan.wanted.has(run.id);
      const t = isOutside
        ? out.outsideRange
        : isBesideBelow
          ? out.besideBelow
          : isAtEnd
            ? out.atChainEnd
            : out.holes;
      t.count++;
      t.km += km;
    });
  }
  for (const t of Object.values(out)) t.km = Math.round(t.km * 1000) / 1000;
  return out;
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

/** How far along each run from a crossing of a and b their deck pairs take the crossing's order. */
function crossingReach(ra: RunPlan, rb: RunPlan, sinAngle: number): number {
  return Math.min(60, (ra.halfWidth + rb.halfWidth) / Math.max(sinAngle, 0.2)) + 10;
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
    // A viaduct and the tunnel or cut it goes on into are one road through the portal (a seam), not
    // two decks over one another: no pairs (the runtime would cut one at the other's edge).
    const isPortalNeighbour =
      ra.chain.id === rb.chain.id && (ra.run.to === rb.run.from || rb.run.to === ra.run.from);
    if (isPortalNeighbour) continue;
    const window = (sin: number) => crossingReach(ra, rb, sin);
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
    // `--nose-surface overlap` (S6 PR 4): a pair that meets at a node is one surface all along its
    // overlap (an ordered crossing of the two still takes the crossing's order, below). Why not as
    // P2.6 tried it, with a heavier row: that left about 50 more runs unsolved; this keeps the row's
    // weight and only widens where it holds.
    const isOneSurface = plan.noseSurface === "overlap" && sharedNodes(ra, rb).length > 0;
    if (isOneSurface) nose.fill(1);
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

/**
 * A run's ground ends within `reach` of run distance sv: where each touches down. Not a portal of
 * an elevated run (`into`), nor an end of a below run (it comes up out of a tunnel or cut there).
 */
function touchdownsNear(plan: Plan, rp: RunPlan, sv: number, reach: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const atStart of [true, false]) {
    const e = endPlan(plan, rp, atStart);
    const isGroundEnd = e.kind === "ground" && e.into === undefined;
    // `--touchdown all` with runs at grade (S6 PR 3): a seam onto a run at grade is where the ground end
    // was without them (PR 2 turned them into seams, and 41009552|668292569 lost its 60 marks).
    const isSeamOnGround =
      plan.touchdown === "all" && e.kind === "seam" && plan.runs.get(e.parent)?.ground === true;
    const isTouchdown = (isGroundEnd || isSeamOnGround) && !rp.below;
    if (!isTouchdown) continue;
    const isNear = (atStart ? sv : rp.length - sv) <= reach;
    if (!isNear) continue;
    const [lon, lat] = lonLatAt(rp, atStart ? rp.i0 : rp.i1);
    out.push(CROSS_PLANE.toXY(lon, lat));
  }
  return out;
}

/**
 * Marks the deck pairs (above / below) of two main lines that both come down to the same place
 * within the climb (approachLength) of the pair: a ground end of each (not a portal) within
 * approachLength of the pair's station along its own run, the two ends within SHARED_TOUCHDOWN. The
 * QP gets no row for them (couplingsOf). Why: both touching down there, the standard grade cannot
 * put a level (clearance + girder) between them, and the rows, held softly, push the lower deck
 * into the ground as a bundle (41009552 under 668292569, the 都心環状線's two carriageways: the
 * climb over the road 138 m on fell 0.16 m short, P2.7-3a). Why not one surface instead: before
 * their ends the two do part in height. Why only main lines: widened to every class, the default
 * range's ramps (4848889, 4848755) moved by up to 10.5 m; that is S5 / S6's to judge. Why a pair at
 * an ordered crossing of the two stays tied (within crossingReach, as classifyPairs orders it): one
 * line really passes over the other there, and the level is the clearance over a road, not a
 * leftover of OSM's layers (668292569 over 955398790 143 m from their shared touchdown fell to
 * 2.96 m under the girder untied, the P2.7-3a review). Decided on the plan alone (no DEM, range or
 * solve), so the same pairs are marked whatever the range (T8). Runs after pruneBelow: an end on a
 * deferred below run reads as a ground end there, as the solve sees it. With `--touchdown all` (S6
 * PR 3, Plan.touchdown) every class's pairs, a seam onto a run at grade counted as a touchdown
 * (touchdownsNear), and a pair of a run at grade with a viaduct let go within the climb of the
 * viaduct's own touchdown, whatever the 60 m (the run at grade is at the ground all along).
 */
function markSharedTouchdowns(plan: Plan): void {
  for (const p of plan.pairs) {
    const isLevelApart = p.relation !== "same";
    if (!isLevelApart) continue;
    const ra = plan.runs.get(p.a)!;
    const rb = plan.runs.get(p.b)!;
    const isMainPair = ra.cls === "expressway" && rb.cls === "expressway";
    // `--touchdown all` (S6 PR 3): every class, the range's ramps' (4848889, 4848755) moves to be measured.
    const isOfClass = isMainPair || plan.touchdown === "all";
    if (!isOfClass) continue;
    const isAtCrossing = plan.crossings.some((c) => {
      const isOurs = (c.upper === p.a && c.lower === p.b) || (c.upper === p.b && c.lower === p.a);
      if (!isOurs) return false;
      const [ca, cb] = c.upper === p.a ? [c.sUpper, c.sLower] : [c.sLower, c.sUpper];
      const w = crossingReach(ra, rb, c.sinAngle);
      return Math.abs(p.sa - ca) <= w && Math.abs(p.sb - cb) <= w;
    });
    if (isAtCrossing) continue;
    // `--touchdown all` with runs at grade (S6 PR 3 review W1): a run at grade is at the ground all
    // along, so a viaduct beside it is let go within the climb of its own touchdown, wherever the run
    // at grade's ends are. Why not the 60 m of the ends: the run at grade's end near it is open or a
    // portal, and the ramp 24402125 beside the main line at grade 45068170 (above at s 183–373) was
    // held a level over it, up to 13.1 m at s 290 and down at −11.4 %.
    const atGrade = plan.touchdown === "all" ? [ra, rb].filter((r) => r.ground) : [];
    const isBesideAtGrade = atGrade.length === 1;
    if (isBesideAtGrade) {
      const [other, s] = atGrade[0] === ra ? [rb, p.sb] : [ra, p.sa];
      const isNearTouchdown = touchdownsNear(plan, other, s, approachLength(other.planV)).length > 0;
      if (isNearTouchdown) p.untied = true;
      continue;
    }
    const ea = touchdownsNear(plan, ra, p.sa, approachLength(ra.planV));
    const hasNoTouchdown = ea.length === 0;
    if (hasNoTouchdown) continue;
    const eb = touchdownsNear(plan, rb, p.sb, approachLength(rb.planV));
    const isShared = ea.some(([x, y]) =>
      eb.some(([u, v]) => Math.hypot(x - u, y - v) <= SHARED_TOUCHDOWN.value),
    );
    if (!isShared) continue;
    p.untied = true;
  }
}

/**
 * Main lines running beside each other (S6 PR 3, COMPANIONS): every stepM along run a (the smaller id),
 * the nearest point of each other main line b whose carriageway is apart from a's (no deck pair: those
 * are one surface or a level apart already) by at most gapM, on the same OSM layer, and not within the
 * reach of an ordered crossing of the two; such stations in a row (no step missed) over minLengthM or
 * more make the pair companions there. A station gets a row (`held`) but within the climb
 * (approachLength, the slower's) of an end where the stretch ends because the two part in height
 * there: the next station a level apart (another layer) or one of them coming down (a touchdown,
 * touchdownsNear); at most a third of the stretch from each end, so no stretch is left without rows.
 * Why only there (PR 3 re-review N1): dropped at every end, a stretch under about 390 m had no row at
 * all (24402611|45021976, 275 m beside each other, stayed 4.95 m apart). Which way each runs does not
 * matter. Below runs are left out:
 * a tunnel's companion in another component would join what pruneBelow keeps apart. Two runs of one
 * chain are one road (a seam), not two. Decided on the plan alone (T8: whatever the range or the
 * order of the ways).
 */
function findCompanions(plan: Plan): Companion[] {
  const { gapM, minLengthM, stepM } = COMPANIONS.value;
  const ids = [...plan.runs.keys()]
    .filter((id) => {
      const rp = plan.runs.get(id)!;
      return rp.cls === "expressway" && !rp.below;
    })
    .sort();
  const polys = new Map(ids.map((id) => [id, runPoly(plan.runs.get(id)!)]));
  const CELL = 50;
  const grid = new Map<string, Array<{ id: string; i: number }>>();
  for (const id of ids) {
    const p = polys.get(id)!;
    for (let i = 0; i + 1 < p.s.length; i++) {
      const [x0, y0, x1, y1] = [p.xy[2 * i], p.xy[2 * i + 1], p.xy[2 * i + 2], p.xy[2 * i + 3]];
      const cells = new Set<string>();
      for (const [x, y] of [
        [x0, y0],
        [x1, y1],
        [(x0 + x1) / 2, (y0 + y1) / 2],
      ])
        cells.add(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
      for (const c of cells) grid.set(c, [...(grid.get(c) ?? []), { id, i }]);
    }
  }
  const pointAt = (p: Poly, s: number) => {
    let i = 0;
    while (i + 2 < p.s.length && p.s[i + 1] < s) i++;
    const t = p.s[i + 1] > p.s[i] ? Math.min(1, Math.max(0, (s - p.s[i]) / (p.s[i + 1] - p.s[i]))) : 0;
    return {
      x: p.xy[2 * i] + (p.xy[2 * i + 2] - p.xy[2 * i]) * t,
      y: p.xy[2 * i + 1] + (p.xy[2 * i + 3] - p.xy[2 * i + 1]) * t,
      hw: p.hw[i] + (p.hw[i + 1] - p.hw[i]) * t,
    };
  };
  const out: Companion[] = [];
  for (const a of ids) {
    const ra = plan.runs.get(a)!;
    const pa = polys.get(a)!;
    // Per partner, the stations in a row so far.
    const rows = new Map<string, Companion[]>();
    // Why each partner's row now open began: a level apart (another layer) just before, or apart.
    const startedBy = new Map<string, "layer" | "apart">();
    const lastWhy = new Map<string, "layer" | "apart">();
    const flush = (b: string, endWhy: "layer" | "apart" = "apart") => {
      const list = rows.get(b) ?? [];
      rows.delete(b);
      const startWhy = startedBy.get(b) ?? "apart";
      startedBy.delete(b);
      const isLong = list.length > 0 && list[list.length - 1].sa - list[0].sa >= minLengthM;
      if (!isLong) return;
      const rb = plan.runs.get(b)!;
      const climb = approachLength(Math.min(ra.planV, rb.planV) as DesignSpeed);
      const first = list[0];
      const last = list[list.length - 1];
      const length = last.sa - first.sa;
      // Where one of the two comes down by the stretch's end (within two steps of it).
      const isTouchdownAt = (c: Companion) =>
        touchdownsNear(plan, ra, c.sa, 2 * stepM).length > 0 ||
        touchdownsNear(plan, rb, c.sb, 2 * stepM).length > 0;
      const taper = Math.min(climb, length / 3);
      const startTaper = startWhy === "layer" || isTouchdownAt(first) ? taper : 0;
      const endTaper = endWhy === "layer" || isTouchdownAt(last) ? taper : 0;
      for (const c of list) {
        const isHeld = c.sa - first.sa >= startTaper && last.sa - c.sa >= endTaper;
        out.push(isHeld ? c : { ...c, held: false });
      }
    };
    for (let s = 0; s <= ra.length + 1e-9; s += stepM) {
      const q = pointAt(pa, s);
      const best = new Map<string, { d: number; sb: number; hw: number }>();
      const cx = Math.floor(q.x / CELL);
      const cy = Math.floor(q.y / CELL);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const { id: b, i } of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const isOther = b > a && plan.runs.get(b)!.chain.id !== ra.chain.id;
            if (!isOther) continue;
            const pb = polys.get(b)!;
            const ex = pb.xy[2 * i + 2] - pb.xy[2 * i];
            const ey = pb.xy[2 * i + 3] - pb.xy[2 * i + 1];
            const len2 = ex * ex + ey * ey || 1;
            const t = Math.min(
              1,
              Math.max(0, ((q.x - pb.xy[2 * i]) * ex + (q.y - pb.xy[2 * i + 1]) * ey) / len2),
            );
            const d = Math.hypot(q.x - (pb.xy[2 * i] + ex * t), q.y - (pb.xy[2 * i + 1] + ey * t));
            const prev = best.get(b);
            const isNearer = prev === undefined || d < prev.d;
            if (!isNearer) continue;
            best.set(b, {
              d,
              sb: pb.s[i] + (pb.s[i + 1] - pb.s[i]) * t,
              hw: pb.hw[i] + (pb.hw[i + 1] - pb.hw[i]) * t,
            });
          }
      for (const b of rows.keys()) if (!best.has(b)) flush(b);
      for (const b of lastWhy.keys()) if (!best.has(b)) lastWhy.set(b, "apart");
      for (const [b, m] of [...best.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        const rb = plan.runs.get(b)!;
        const gap = m.d - q.hw - m.hw;
        // Apart (planOverlaps' margin: nearer is a deck pair) and within gapM.
        const isBeside = gap >= 0.5 && gap <= gapM;
        const isSameLayer = layerAtS(ra, s) === layerAtS(rb, m.sb);
        const isAtCrossing = plan.crossings.some((c) => {
          const isOurs = (c.upper === a && c.lower === b) || (c.upper === b && c.lower === a);
          if (!isOurs) return false;
          const [ca, cb] = c.upper === a ? [c.sUpper, c.sLower] : [c.sLower, c.sUpper];
          const w = crossingReach(ra, rb, c.sinAngle);
          return Math.abs(s - ca) <= w && Math.abs(m.sb - cb) <= w;
        });
        const isCompanion = isBeside && isSameLayer && !isAtCrossing;
        if (!isCompanion) {
          const why = isSameLayer ? "apart" : "layer";
          flush(b, why);
          lastWhy.set(b, why);
          continue;
        }
        const isNew = !rows.has(b);
        if (isNew) startedBy.set(b, lastWhy.get(b) ?? "apart");
        rows.set(b, [...(rows.get(b) ?? []), { a, sa: roundTo(s, 2), b, sb: roundTo(m.sb, 2) }]);
      }
    }
    for (const b of rows.keys()) flush(b);
  }
  return out.sort((p, q) =>
    p.a !== q.a ? (p.a < q.a ? -1 : 1) : p.b !== q.b ? (p.b < q.b ? -1 : 1) : p.sa - q.sa,
  );
}

/**
 * The marked pairs (markSharedTouchdowns) among the runs the range needs, per run pair (a < b) with
 * their station pairs (both directions counted, as plan.pairs lists them) and component.
 */
export function untiedPairs(
  plan: Plan,
): Array<{ a: string; b: string; component: string; stations: number }> {
  const needed = new Set(plan.needed);
  const byKey = new Map<string, { a: string; b: string; component: string; stations: number }>();
  for (const p of plan.pairs) {
    const isCounted = p.untied === true && needed.has(p.a) && needed.has(p.b);
    if (!isCounted) continue;
    const [a, b] = p.a < p.b ? [p.a, p.b] : [p.b, p.a];
    const key = `${a}|${b}`;
    const entry = byKey.get(key) ?? { a, b, component: plan.componentOf.get(a) ?? a, stations: 0 };
    entry.stations++;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((p, q) => (p.a === q.a ? (p.b < q.b ? -1 : 1) : p.a < q.a ? -1 : 1));
}

/**
 * Below runs that would join two components (P9): deferred, so a tunnel never makes one joint QP of
 * what was two. A below run is kept when every run it couples to — the viaducts it seams into, the
 * runs crossing it or over it, the ramps joining it — is in one component of the network without
 * below runs, and none of them is itself below. Why: compiled freely the universe's below runs
 * merge the test section's component into one of 382 runs (29,694 variables) that moves the default
 * range's decks by up to 3.2 m (P2.7-1, `--below all`, measured). P9 also saw that QP break down
 * (non-finite steps); at P2.7-1 it converged every time (P2.6's gapTol is the likely cure), so the
 * pruning now stands for the decks it keeps still, not for convergence. Decided on the whole
 * universe, so the same runs are kept whatever the range (T8).
 */
function pruneBelow(plan: Plan): void {
  const isBelow = (id: string) => plan.runs.get(id)!.below;
  const root = new Map<string, string>();
  for (const id of plan.runs.keys()) root.set(id, id);
  const find = (a: string): string => {
    let r = a;
    while (root.get(r) !== r) r = root.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const touchesBelow = isBelow(a) || isBelow(b);
    if (touchesBelow) return;
    const ra = find(a);
    const rb = find(b);
    const isApart = ra !== rb;
    // The smaller id is the root, as in groupComponents.
    if (isApart) root.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const partners = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      if (!isBelow(x)) continue;
      // A run at grade it seams to is the road going on, as the ground end it was without runs at grade
      // (review C1): counted, two of them put the tunnel between two components and it was dropped
      // (35266568 C1 770 m, 5170834 B 1,674 m, 5213545・5213546 1号 in ship/pruned).
      const isGroundSeam = plan.runs.get(y)?.ground === true && plan.ground === "compile";
      if (isGroundSeam) continue;
      const set = partners.get(x) ?? new Set<string>();
      set.add(y);
      partners.set(x, set);
    }
  };
  for (const id of plan.runs.keys())
    for (const p of junctionParents(plan, id)) {
      union(id, p);
      touch(id, p);
    }
  for (const c of [...plan.crossings, ...plan.ambiguous]) {
    union(c.upper, c.lower);
    touch(c.upper, c.lower);
  }
  for (const p of plan.pairs) {
    union(p.a, p.b);
    touch(p.a, p.b);
  }
  const dropped = new Set<string>();
  for (const id of [...plan.runs.keys()].sort()) {
    if (!isBelow(id)) continue;
    const list = [...(partners.get(id) ?? [])];
    const groups = new Set(list.map(find));
    const isBridging = groups.size > 1 || list.some(isBelow);
    if (isBridging) dropped.add(id);
  }
  if (dropped.size === 0) return;
  for (const id of dropped) {
    const rp = plan.runs.get(id)!;
    plan.runs.delete(id);
    const list = plan.chainRuns.get(rp.chain.id)!.filter((r) => r !== rp);
    plan.chainRuns.set(rp.chain.id, list);
    plan.belowDeferred.push(id);
  }
  plan.belowDeferred.sort();
  const isKept = (a: string, b: string) => !dropped.has(a) && !dropped.has(b);
  plan.crossings = plan.crossings.filter((c) => isKept(c.upper, c.lower));
  plan.ambiguous = plan.ambiguous.filter((c) => isKept(c.upper, c.lower));
  plan.pairs = plan.pairs.filter((p) => isKept(p.a, p.b));
}

/** Union of runs joined at junctions, crossing each other or over one another's decks. */
export function groupComponents(plan: Plan): void {
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
  // Companions are one QP's rows too (S6 PR 3): two main lines beside each other solve together.
  for (const c of plan.companions?.list ?? []) if (c.held !== false) union(c.a, c.b);
  for (const id of [...plan.runs.keys()].sort()) {
    const root = find(id);
    plan.componentOf.set(id, root);
    const list = plan.components.get(root);
    if (list) list.push(id);
    else plan.components.set(root, [id]);
  }
}

/** `anchor`: a piece's end at an anchor of its run (blocks.ts), at run distance s. */
export type EndPlan =
  | { kind: "ground"; nodeIndex: number; into?: "tunnel" | "cut" }
  | { kind: "open" }
  | { kind: "junction" | "seam"; parent: string; parentNodeIndex: number; nodeIndex: number }
  | { kind: "anchor"; run: string; s: number };

/** What fixes a run's start or end (knowledge/road-redesign-plan.md 4.3 の 1). */
export function endPlan(plan: Plan, rp: RunPlan, atStart: boolean): EndPlan {
  const given = plan.ends?.get(rp.run.id);
  if (given) return given[atStart ? 0 : 1];
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
    // A below run going on into a viaduct takes the viaduct's portal (its elevation, which is the
    // ground's, and its grade) as a seam: one profile through the portal, C¹ (P9).
    const beside = (plan.chainRuns.get(chain.id) ?? []).find(
      (r) => r !== rp && r.run.from <= idx && idx <= r.run.to,
    );
    // A run at grade (S6 PR 2) is the master of its seams: the viaduct or below run beside it takes
    // its value (C¹), and its own end there is free. Why the run at grade: it is the one the ground
    // holds (its band), so the viaduct climbs from where the road at grade is, as from a ground end.
    const isGroundBeside = beside !== undefined && beside.ground && !rp.ground;
    if (isGroundBeside) return { kind: "seam", parent: beside.run.id, parentNodeIndex: idx, nodeIndex: idx };
    const isGroundSeamed = rp.ground && beside !== undefined;
    if (isGroundSeamed) return { kind: "open" };
    const neighbour = rp.below ? beside : undefined;
    if (neighbour) return { kind: "seam", parent: neighbour.run.id, parentNodeIndex: idx, nodeIndex: idx };
    if (rp.below) return { kind: "ground", nodeIndex: idx };
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

/** Run distance of a chain node on a run. */
export function nodeS(rp: RunPlan, nodeIndex: number): number {
  return rp.align.s[rp.align.vertexSample[nodeIndex]] - rp.align.s[rp.i0];
}

/**
 * Whether a run's end is at or near the ground: a ground end or portal, or a junction (or seam) on
 * a parent within the climb (approachLength) from one of the parent's own low ends. A branch that
 * leaves its parent while the parent is still climbing from the ground starts low too, so it gets
 * the same climb before the standard floor applies (checks.climbingEnds recomputes this from the
 * run summaries for T4). Why not only ground ends (P2.5): 9 ramps leaving a parent at 0–3.7 m over
 * the ground had to rise to 6.7 m at once and fell through to "crossings only".
 */
function isLowEnd(plan: Plan, rp: RunPlan, atStart: boolean, seen = new Set<string>()): boolean {
  const e = endPlan(plan, rp, atStart);
  if (e.kind === "ground") return true;
  // A ramp ending on a structure's street (台場出口 onto the 臨港道路's descent to the 台場 streets)
  // comes down with it: the street's own floor governs there, as at a ground end. Why not every
  // junction: an expressway parent keeps its clearance, and so must a ramp beside it.
  const isOnStreet = e.kind === "junction" && plan.runs.get(e.parent)?.cls === "street";
  if (isOnStreet) return true;
  const isJoined = e.kind === "junction" || e.kind === "seam";
  if (!isJoined) return false;
  // On a run at grade (S6 PR 2) the end is at the ground as at a ground end.
  const isOnGroundRun = plan.runs.get(e.parent)?.ground === true;
  if (isOnGroundRun) return true;
  const key = `${rp.run.id}:${atStart ? 0 : 1}`;
  const isLoop = seen.has(key);
  if (isLoop) return false;
  seen.add(key);
  const pp = plan.runs.get(e.parent)!;
  const ps = nodeS(pp, e.parentNodeIndex);
  const climb = approachLength(pp.planV);
  const isNearStart = ps < climb && isLowEnd(plan, pp, true, seen);
  return isNearStart || (pp.length - ps < climb && isLowEnd(plan, pp, false, seen));
}

/** A run's profile over [a, b] of its run distance (the whole run, or a piece of it: blocks.ts). */
export type ProfilePiece = { a: number; b: number; profile: VerticalProfile };

export type Solved = {
  rp: RunPlan;
  /** The profile of the first piece (of the whole run when it is one piece). */
  profile: VerticalProfile;
  /**
   * The run's profile as its pieces in order: one for a component's run (a = 0), one per piece of a
   * run cut at anchors (blocks.ts). Read through evalRun, never by evalProfile on `profile`.
   */
  pieces: ProfilePiece[];
  /** The design-speed zones over the whole run (the pieces' zones put end to end). */
  zones: Zone[];
  steps: string[];
  /** Bank on the run's samples. */
  bank: Float64Array;
  start: XwEnd;
  end: XwEnd;
  /** [s, top, clearance] of everything the run crosses over. */
  cross: number[];
  /**
   * Per triple of `cross` that is a road or railway (they come first; the decks it crosses over are
   * appended after them by solvePlan): what it is, its window, whether near a low end.
   */
  crossInfo?: CrossInfo[];
  /** Roads at ground level under it that it does not clear (crossing_over_or_at_grade). */
  blocked: BlockedRoad[];
  /** A height build: the run's stretches by structure (heightStructures.ts); absent for the tags' structures. */
  structures?: HeightStretch[];
};

/**
 * A road at ground level a deck is taken not to clear: where (s, the window either side the road's
 * width takes along the deck), its top, the clearance it would need, and the diagnostic reporting it
 * (removed by identity if the solved deck clears it after all).
 */
type BlockedRoad = { s: number; halfWindow: number; top: number; need: number; diagnostic: XwDiagnostic };

export type SolveStats = {
  components: number;
  largestRuns: number;
  largestVariables: number;
  solves: number;
  iterations: number;
  qpMs: number;
  /** Solves that did not converge (each reported as solver_not_converged). */
  unconverged: number;
  /** Solves whose first try did not converge, solved again (vertical.ts RETRY_DUAL_TOL). */
  retried: number;
};

export type CompileResult = {
  chunks: XwChunk[];
  runs: XwRunSummary[];
  /** Runs of the range left out (unsolved, or hanging from one): closed to traffic, with why. */
  closed: XwClosed[];
  diagnostics: XwDiagnostic[];
  stats: SolveStats;
  /** What lies along each written run, for the sign planner (signPlan.ts); not written to files. */
  features: Record<string, RunFeatures>;
  /** How the runs were split and solved (components or blocks), for the scorecard; not written. */
  partition: PartitionResult;
  /**
   * The written runs at grade's targets at their grid stations (groundTargetOf, S6 PR 7a), for the
   * scorecard (the band's centre); not written.
   */
  groundTargets: Map<string, { stations: Float64Array; ground: Float64Array; target: Float64Array }>;
  /** A height build's tally of the PR 7a rules (structuresByHeight); not written. */
  heightRules?: HeightRuleTally;
};

/**
 * The OSM nodes and ways along a run at their run distances: the sign planner finds the exits'
 * and junctions' names (motorway_junction nodes) and the posted speeds (ways) through these.
 */
export type RunFeatures = {
  nodes: Array<{ id: number; s: number }>;
  ways: Array<{ id: number; s0: number; s1: number }>;
};

/** A run's nodes and ways with their run distances (the vertices' samples on the smoothed line). */
function runFeatures(rp: RunPlan): RunFeatures {
  const base = rp.align.s[rp.i0];
  const sOf = (i: number) => roundTo(rp.align.s[rp.align.vertexSample[i]] - base, 2);
  const nodes: RunFeatures["nodes"] = [];
  for (let i = rp.run.from; i <= rp.run.to; i++) nodes.push({ id: rp.chain.nodes[i], s: sOf(i) });
  const ways: RunFeatures["ways"] = [];
  for (const id of rp.run.ways) {
    const k = rp.chain.ways.indexOf(id);
    const from = Math.max(rp.run.from, rp.chain.wayStarts[k]);
    const next = rp.chain.wayStarts[k + 1] ?? rp.chain.nodes.length - 1;
    const to = Math.min(rp.run.to, next);
    if (to <= from) continue;
    ways.push({ id, s0: sOf(from), s1: sOf(to) });
  }
  return { nodes, ways };
}

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

/**
 * A run of at most two knot intervals (shorter than three 第22条 curve lengths at its plan speed):
 * its ends meet the ground in a band, and between two parents it is a cubic connector.
 */
function isShortRun(rp: RunPlan): boolean {
  return rp.length < 3 * VERTICAL_CURVE_LENGTH.value[rp.planV];
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
  /** The statute's part of the floor (crossed roads and railways, 第12条), −∞ elsewhere. */
  lowerLaw: Float64Array;
  /** The assumed standard floor over open ground (outside the climbs), −∞ elsewhere. */
  lowerOpen: Float64Array;
  upper: Float64Array;
  /** Fixed start / end (ground and portal ends); junction ends are couplings. */
  fixed: [RunInput["start"], RunInput["end"]];
  ends: [EndPlan, EndPlan];
  /** The DEM ground at each ground or portal end (null for the others). */
  groundZ: [number | null, number | null];
  cross: number[];
  /** Per `cross` triple: what it is ("road 123") and the half window its width takes along the deck. */
  crossInfo: CrossInfo[];
  blocked: BlockedRoad[];
  /** Objective v2's weights (RunInput.gradeChange / targetScale), absent for v1. */
  gradeChange?: number;
  targetScale?: number;
  /** A height build: the stations whose statute floor is a road within the climb of a low end (RunInput.lawNear). */
  lawNear?: Uint8Array;
  /** A run at grade (S6 PR 2): the band about the design ground line (RunInput.bandLo / bandHi). */
  bandLo?: Float64Array;
  bandHi?: Float64Array;
};

/** A road or railway crossed under a run (RunSetup.cross): its label in a diagnostic and its half window. */
type CrossInfo = { label: string; halfWindow: number; near: boolean };

function setupRun(
  plan: Plan,
  rp: RunPlan,
  ground: GroundSampler,
  objects: ObjectPoly[],
  diagnostics: XwDiagnostic[],
  objective: Objective,
): RunSetup {
  const id = rp.run.id;
  const S = rp.length;
  const stations = gridStations(S);
  const n = stations.length;
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
  const groundZ: [number | null, number | null] = [null, null];
  const isShort = isShortRun(rp);
  ends.forEach((e, side) => {
    if (e.kind !== "ground") return;
    const V = zoneSpeedAt(rp.zones, side === 0 ? 0 : S);
    const t = terrainAt(rp, ground, rp.align.vertexSample[e.nodeIndex], V);
    groundZ[side] = t.z;
    // A short run meets the ground within a band, at whatever grade (within 第20条) gets it over
    // what it crosses: with its end grades fixed too, two knot intervals or fewer leave no freedom
    // (P2.5: 43 short runs "end elevation off"). A portal's grade is the road's own as it goes on
    // down into the tunnel or cut. Why not the band everywhere: a long run's ground end continues as
    // the road at grade (P9), whose grade it must meet.
    if (isShort) fixed[side] = { z: t.z, band: GROUND_END_BAND.value };
    else fixed[side] = e.into ? { z: t.z } : { z: t.z, grade: t.grade };
  });
  if (rp.ground)
    return setupGround(plan, rp, stations, ends, fixed, groundZ, ground, objects, diagnostics, objective);
  if (rp.below)
    return setupBelow(
      rp,
      stations,
      groundAt,
      ends,
      fixed,
      groundZ,
      ground,
      diagnostics,
      objective,
      plan.structures === "height",
    );
  // Clearance: the crossings everywhere, and the standard floor outside the approaches to ground.
  // The deck may sit a little under the smoothed DEM where it meets the ground (T5 allows ±5 cm at
  // the end itself); a hard floor at the DEM made the ends infeasible by centimetres.
  const lowerAtCrossings = Float64Array.from(groundAt, (g) => g - DEM_SINK_FLOOR.value);
  const lowerLaw = new Float64Array(n).fill(-Infinity);
  const cross: number[] = [];
  const crossInfo: CrossInfo[] = [];
  const blocked: BlockedRoad[] = [];
  const mine = runPoly(rp);
  // A height build (P2.7-6 PR 1): a road within the climb of a low end that the solved deck does not
  // clear is blocked rather than unsolving the run; the climb decides only whether it gets a row.
  const isHeight = plan.structures === "height" && rp.over === null;
  const climb = approachLength(rp.planV);
  const lowStart = isHeight && isLowEnd(plan, rp, true);
  const lowFinish = isHeight && isLowEnd(plan, rp, false);
  const isNearLow = (sv: number) => (lowStart && sv < climb) || (lowFinish && S - sv < climb);
  const lawNear = isHeight ? new Uint8Array(n) : undefined;
  // An end seamed onto a run at grade (S6 PR 3 review) climbs from the ground as a ground end does: a
  // road no grade clears from there gets no row, as at a ground end. Why: given a row (W_BOUND), the
  // roads 17 and 29 m from 41009552's start outweighed the band that holds the run at grade's open end
  // (W_FLOOR) and lifted both 5.27 m off the ground. Only for this reach: the end is no ground end.
  // The terrain there as at a ground end (terrainAt's height and grade, none for a short run). Why not
  // the station's DEM at grade 0 (PR 3 re-review N2): more pessimistic than the ground end it stands
  // for, it blocked roads the tags' build cleared (41009552's road 97671455 at s 138, 6.74 m clear).
  const seamTerrain: Array<{ z: number; grade: number } | null> = [0, 1].map((side) => {
    const e = ends[side];
    const isOnGroundRun = e.kind === "seam" && plan.runs.get(e.parent)?.ground === true;
    if (!isOnGroundRun) return null;
    const V = zoneSpeedAt(rp.zones, side === 0 ? 0 : S);
    const t = terrainAt(rp, ground, rp.align.vertexSample[e.nodeIndex], V);
    return { z: t.z, grade: isShort ? 0 : t.grade };
  });
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
        const z0 = groundZ[side] ?? seamTerrain[side]?.z ?? null;
        if (z0 === null) return Infinity;
        // Climbing away from the end: the end grade, reversed for the far end.
        const endGrade = groundZ[side] !== null ? fixed[side].grade : seamTerrain[side]?.grade;
        const g0 = (endGrade ?? 0) * (side === 0 ? 1 : -1);
        return climbLimit(zoneSpeedAt(rp.zones, side === 0 ? 0 : S), g0)(Math.max(0, d)) + z0;
      };
      const isUnreachable =
        Math.min(reach(0, sc - w), reach(1, S - sc - w)) < top + clearance + REACH_MARGIN_M;
      if (isUnreachable) {
        const diagnostic: XwDiagnostic = {
          run: id,
          kind: "crossing_over_or_at_grade",
          detail: `${o.kind} ${o.id} at ${sc.toFixed(0)} m cannot be cleared from the ground end; taken as passing over`,
          allowed: false,
        };
        diagnostics.push(diagnostic);
        blocked.push({ s: sc, halfWindow: w, top, need: clearance, diagnostic });
        continue;
      }
      const win = Math.min(40, (rp.halfWidth + GROUND_ROAD_HALF_WIDTH.value) / Math.max(sin, 0.25));
      const isNear = o.kind === "road" && isNearLow(sc);
      for (let k = 0; k < n; k++) {
        const isInWindow = Math.abs(stations[k] - sc) <= win;
        if (!isInWindow) continue;
        lowerAtCrossings[k] = Math.max(lowerAtCrossings[k], top + clearance);
        const isRaised = top + clearance > lowerLaw[k];
        lowerLaw[k] = Math.max(lowerLaw[k], top + clearance);
        // The station's law floor is this road's: near a low end or not, as the highest one there.
        if (lawNear && isRaised) lawNear[k] = isNear ? 1 : 0;
      }
      cross.push(sc, top, clearance);
      crossInfo.push({ label: `${o.kind} ${o.id}`, halfWindow: win, near: isNear });
    }
  }
  // One grid step shorter than the climb, so the floor also holds between grid stations wherever
  // the check (checks.checkClearance) expects it.
  const approach = approachLength(rp.planV) - GRID_M;
  const lower = Float64Array.from(lowerAtCrossings);
  const lowerOpen = new Float64Array(n).fill(-Infinity);
  const isLowStart = isLowEnd(plan, rp, true);
  const isLowFinish = isLowEnd(plan, rp, false);
  for (let k = 0; k < n; k++) {
    const nearGround = (isLowStart && stations[k] < approach) || (isLowFinish && S - stations[k] < approach);
    if (nearGround) continue;
    lowerOpen[k] = groundPeak[k] + OPEN_OVER_GROUND;
    lower[k] = Math.max(lower[k], lowerOpen[k]);
  }
  // Target: the standard underclearance over the ground (v1: averaged over ±60 m). Only crossings and
  // decks over one another raise it (設計書 4.3 の 1); OSM layer orders them but is no height. v2
  // stands it on the upper envelope of the peaks, never under them: the open-ground floor (the peak
  // + 6.7 m) then no longer lifts the deck over every bump, only crossings, decks and ends bend it.
  const isV2 = objective.kind === "v2";
  const target = isV2
    ? envelope(groundPeak, objective.reachM.viaduct, "upper", GRID_M).map(
        (e) => e + STANDARD_UNDERCLEARANCE.value + GIRDER,
      )
    : stations.map((_, k) => {
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
    lowerLaw,
    lowerOpen,
    upper: stations.map(() => Infinity),
    fixed,
    ends,
    groundZ,
    cross,
    crossInfo,
    blocked,
    ...objectiveWeights(objective),
    ...(lawNear ? { lawNear } : {}),
  };
}

/** A run's grid stations: every GRID_M from 0, and its length last (two at least). */
export function gridStations(S: number): Float64Array {
  const n = Math.max(2, Math.ceil(S / GRID_M) + 1);
  const stations = Float64Array.from({ length: n }, (_, k) => Math.min(S, k * GRID_M));
  stations[n - 1] = S;
  return stations;
}

/**
 * A run at grade's target at its grid stations (S6 PR 7a, N1, designGround.ts groundTarget): the
 * repeated-median line of its own ground within ±reach at every station, pooled with the ground of
 * each run at grade it shares a surface with (review C2, the plan's same pairs: one slab, one line).
 * Why the plan's pairs and not the written runs': the partner is in the same component, so the line
 * is the same in every range that has the run (T8). Also what the scorecard measures the runs at
 * grade from (CompileResult.groundTargets).
 */
export function groundTargetOf(
  plan: Plan,
  rp: RunPlan,
  ground: GroundSampler,
  reach: number,
): { stations: Float64Array; ground: Float64Array; target: Float64Array } {
  const stations = gridStations(rp.length);
  const groundAt = stations.map((s) => {
    const p = poseAt(rp, s);
    return ground(p.lon, p.lat);
  });
  // The partner's own stations (the pairs found from its side, `a`), placed on this run by `sb`. Why
  // from its side: then each of the two pools is both runs' own stations, the same set, and the two
  // lines agree; from this run's side the partner was sampled where this run stands instead.
  const partner = plan.pairs
    .filter((p) => p.b === rp.run.id && p.relation === "same" && plan.runs.get(p.a)?.ground === true)
    .map((p) => {
      const q = poseAt(plan.runs.get(p.a)!, p.sa);
      return { s: p.sb, z: ground(q.lon, q.lat) };
    })
    .sort((x, y) => x.s - y.s);
  const pooled = { s: partner.map((p) => p.s), z: partner.map((p) => p.z) };
  return { stations, ground: groundAt, target: groundTarget(groundAt, stations, reach, pooled) };
}

/**
 * A run at grade (S6 PR 2, `--ground compile`): no floor or ceiling over the ground; the target is the
 * line of its ground without the bumps (groundTargetOf: a repeated-median line over ±150 m at every station),
 * and a band of ±HEIGHT_STRUCTURES.ground.bandM about it a soft row (RunInput.bandLo / bandHi). The DEM
 * itself only fixes the ground ends. Why not the DEM in the band: it is rough (walls, embankments, the
 * smoothing's half-metre bumps), and the road would take every one (the user's 「PLATEAU（DEM）は凸凹
 * なので路面を地表に追従させない」). The roads that cross it are blocked: an expressway has no level
 * crossing, so each goes over or under it, and OSM gives it no height.
 */
function setupGround(
  plan: Plan,
  rp: RunPlan,
  stations: Float64Array,
  ends: [EndPlan, EndPlan],
  fixed: [RunInput["start"], RunInput["end"]],
  groundZ: [number | null, number | null],
  ground: GroundSampler,
  objects: ObjectPoly[],
  diagnostics: XwDiagnostic[],
  objective: Objective,
): RunSetup {
  const n = stations.length;
  const reach = objective.kind === "v2" ? objective.reachM.viaduct : DESIGN_GROUND_REACH.value.viaduct;
  const { target } = groundTargetOf(plan, rp, ground, reach);
  const band = plan.groundBandM ?? HEIGHT_STRUCTURES.value.ground.bandM;
  // A ground end's grade from the target line's first or last 20 m, not the DEM's two points 40 m
  // either side (terrainAt): a 3 m bump 5–45 m from the end tilted that by 2.5 % and the road by
  // 0.6 m (S6 PR 7a review C1). Its height stays the DEM's at the end (T5).
  const along = Math.min(n - 1, Math.round(20 / GRID_M));
  const lineGrade = (side: number) =>
    side === 0
      ? (target[along] - target[0]) / Math.max(1e-6, stations[along] - stations[0])
      : (target[n - 1] - target[n - 1 - along]) / Math.max(1e-6, stations[n - 1] - stations[n - 1 - along]);
  const ownFixed = fixed.map((f, side) => {
    const isGraded = ends[side].kind === "ground" && f.grade !== undefined;
    if (!isGraded) return f;
    const cap = MAX_GRADE.value[zoneSpeedAt(rp.zones, side === 0 ? 0 : rp.length)].standard / 2;
    return { ...f, grade: Math.max(-cap, Math.min(cap, lineGrade(side))) };
  }) as [RunInput["start"], RunInput["end"]];
  const blocked: BlockedRoad[] = [];
  const mine = runPoly(rp);
  for (const { o, poly } of objectsNear(objects, mine)) {
    for (const [sc, , sin] of intersect(mine, poly)) {
      const p = poseAt(rp, sc);
      const top = ground(p.lon, p.lat);
      const clearance = o.kind === "rail" ? RAIL_CLEARANCE.value + GIRDER : ROAD_CLEAR;
      const w = Math.min(40, (rp.halfWidth + GROUND_ROAD_HALF_WIDTH.value) / Math.max(sin, 0.25));
      const diagnostic: XwDiagnostic = {
        run: rp.run.id,
        kind: "crossing_over_or_at_grade",
        detail: atGradeCrossingDetail(o.kind, o.id, sc),
        allowed: false,
      };
      diagnostics.push(diagnostic);
      blocked.push({ s: sc, halfWindow: w, top, need: clearance, diagnostic });
    }
  }
  const none = new Float64Array(n).fill(-Infinity);
  return {
    rp,
    stations,
    target,
    lower: none,
    lowerAtCrossings: none,
    lowerLaw: none,
    lowerOpen: none,
    upper: new Float64Array(n).fill(Infinity),
    fixed: ownFixed,
    ends,
    groundZ,
    cross: [],
    crossInfo: [],
    blocked,
    bandLo: target.map((t) => t - band),
    bandHi: target.map((t) => t + band),
    ...objectiveWeights(objective),
    // N2 (S6 PR 7a): the target weight of the runs at grade alone, k times (HEIGHT_STRUCTURES.ground
    // .targetScale, or the sweep's `--ground-target-scale`). Why not a narrower band instead: the band
    // bounds the road, the weight holds it to the line inside; the sweep met the conditions by weight.
    ...(objective.kind === "v2"
      ? {
          targetScale:
            objective.targetScale * (plan.groundTargetScale ?? HEIGHT_STRUCTURES.value.ground.targetScale),
        }
      : {}),
  };
}

/** The structure (tunnel or cut) of a below run at run distance s. */
function belowAt(rp: RunPlan, s: number): "tunnel" | "cut" {
  const k = Math.min(rp.wayAt.length - 1, Math.max(0, sampleAt(rp, s) - rp.i0));
  return rp.tunnelAt[k] === 1 ? "tunnel" : "cut";
}

/**
 * A tunnel or cut (P9, below.ts): no floor over the ground and nothing it must clear underneath;
 * instead a ceiling under the ground (the tunnel's box and cover, the cut's tolerance) wherever the
 * descent from both portals reaches it (below.ts ceilingAt), and a target by what the run holds (a
 * tunnel's depth, or a street bridge's clearance for a cut alone). Crossings and decks over it are couplings (couplingsOf) as on a
 * viaduct. Stations whose ceiling is out of reach are reported once per run (tunnel_cover_short)
 * and left free: the box's roof shows above the ground there, as at a real portal's cut-and-cover.
 */
function setupBelow(
  rp: RunPlan,
  stations: Float64Array,
  groundAt: Float64Array,
  ends: [EndPlan, EndPlan],
  fixed: [RunInput["start"], RunInput["end"]],
  groundZ: [number | null, number | null],
  ground: GroundSampler,
  diagnostics: XwDiagnostic[],
  objective: Objective,
  isHeight = false,
): RunSetup {
  const S = rp.length;
  const n = stations.length;
  // The lowest ground across the box and half a grid step along: the roof must stay under it.
  const groundLow = stations.map((sv, k) => {
    let low = groundAt[k];
    for (const d of [-GRID_M / 2, GRID_M / 2]) {
      const q = poseAt(rp, Math.min(S, Math.max(0, sv + d)));
      low = Math.min(low, ground(q.lon, q.lat));
    }
    return low;
  });
  const portalZ = [groundAt[0], groundAt[n - 1]];
  const upper = new Float64Array(n).fill(Infinity);
  let short = 0;
  let shortFrom = Infinity;
  let shortTo = -Infinity;
  // The run's highest planned speed (its strictest grade and radius), as checks.checkCover reads it
  // from the summary: a fallback that lowers the speed later does not move the ceilings.
  const portals = { z0: portalZ[0], z1: portalZ[1] };
  const tops = Array.from(stations, (sv, k) =>
    ceilingAt(belowAt(rp, sv), groundLow[k], sv, S, portals, rp.planV),
  );
  // A height build: a tunnel reached over less than one vertical curve keeps no ceiling (below.ts).
  const imposedTunnel = Array.from(stations).filter(
    (sv, k) => tops[k] !== null && belowAt(rp, sv) === "tunnel",
  );
  const isTooShort = isHeight && isCoverStretchTooShort(imposedTunnel, rp.planV);
  for (let k = 0; k < n; k++) {
    const sv = stations[k];
    const isTunnel = belowAt(rp, sv) === "tunnel";
    const top = isTooShort && isTunnel ? null : tops[k];
    const isImposed = top !== null;
    if (isImposed) {
      upper[k] = top;
      continue;
    }
    if (!isTunnel) continue;
    short++;
    shortFrom = Math.min(shortFrom, sv);
    shortTo = Math.max(shortTo, sv);
  }
  const isShortOfCover = short > 0;
  if (isShortOfCover)
    diagnostics.push({
      run: rp.run.id,
      kind: "tunnel_cover_short",
      detail: `${short} stations at ${shortFrom.toFixed(0)}–${shortTo.toFixed(0)} m cannot reach the box and cover from a portal at the 第20条 grade`,
      allowed: false,
    });
  // A run with a tunnel aims at the tunnel's depth all along (its cut goes down towards the box); a
  // cut alone at the clearance under a street bridged over it (4.5 m + girder), as real 掘割 are dug.
  const hasTunnel = rp.tunnelAt.includes(1);
  const targetDepth = hasTunnel ? depthFor("tunnel") : ROAD_CLEAR;
  // v2: under the lower envelope of the ground across the box, never above it, so the ceiling
  // (the lowest ground − the depth) no longer pushes the road down under every hollow.
  const isV2 = objective.kind === "v2";
  const target = isV2
    ? envelope(groundLow, objective.reachM.below, "lower", GRID_M).map((e) => e - targetDepth)
    : stations.map((_, k) => {
        let sum = 0;
        let cnt = 0;
        for (let j = Math.max(0, k - 12); j <= Math.min(n - 1, k + 12); j++) {
          sum += groundAt[j];
          cnt++;
        }
        return sum / cnt - targetDepth;
      });
  const none = new Float64Array(n).fill(-Infinity);
  if (isHeight) {
    const at = thresholdStations(rp, stations, upper, ground, portals, isTooShort);
    if (at.length > 0)
      return withStations(rp, stations, target, upper, at, ground, fixed, ends, groundZ, objective);
  }
  return {
    rp,
    stations,
    target,
    lower: none,
    lowerAtCrossings: none,
    lowerLaw: none,
    lowerOpen: none,
    upper,
    fixed,
    ends,
    groundZ,
    cross: [],
    crossInfo: [],
    blocked: [],
    ...objectiveWeights(objective),
  };
}

/** Step of the search for where a ceiling starts to be reached between two constraint stations. */
const THRESHOLD_STEP_M = 0.25;

/**
 * A height build's extra ceiling stations of a below run (P2.7-6 PR 1 4.2 の 7): between two
 * constraint stations of which one keeps a ceiling and the other not, the first point (every
 * THRESHOLD_STEP_M from the free one) where the descent from the portals reaches the ceiling over the
 * ground there, as checks.checkCover asks it at any station of the files. Why: the ceilings were held
 * only on the 5 m grid, and 5213545:0's station at s 113.75 (reached, ceiling −6.12) lay between 110
 * (not reached) and 115 (reached): the road came down to the grid's ceiling at 115 and stood 2.4 cm
 * over the files' ceiling at 113.75 (T12). Not the rounding of the files (1 cm, allowed) nor the
 * QP's margin (3 cm inside a row it has).
 */
function thresholdStations(
  rp: RunPlan,
  stations: Float64Array,
  upper: Float64Array,
  ground: GroundSampler,
  portals: { z0: number; z1: number },
  /** The tunnel keeps no ceiling at all (below.ts isCoverStretchTooShort). */
  isTunnelFree: boolean,
): number[] {
  const S = rp.length;
  const out: number[] = [];
  const isReachedAt = (sv: number) => {
    const isFree = isTunnelFree && belowAt(rp, sv) === "tunnel";
    if (isFree) return false;
    const p = poseAt(rp, sv);
    return ceilingAt(belowAt(rp, sv), ground(p.lon, p.lat), sv, S, portals, rp.planV) !== null;
  };
  for (let k = 0; k + 1 < stations.length; k++) {
    const a = Number.isFinite(upper[k]);
    const b = Number.isFinite(upper[k + 1]);
    const isEdge = a !== b;
    if (!isEdge) continue;
    // From the free station towards the held one.
    const from = a ? stations[k + 1] : stations[k];
    const to = a ? stations[k] : stations[k + 1];
    const dir = Math.sign(to - from);
    for (let sv = from + dir * THRESHOLD_STEP_M; dir * (to - sv) > 1e-6; sv += dir * THRESHOLD_STEP_M) {
      if (!isReachedAt(sv)) continue;
      out.push(sv);
      break;
    }
  }
  return out;
}

/** A below run's setup with its extra ceiling stations (thresholdStations) put in order. */
function withStations(
  rp: RunPlan,
  stations: Float64Array,
  target: Float64Array,
  upper: Float64Array,
  extra: number[],
  ground: GroundSampler,
  fixed: [RunInput["start"], RunInput["end"]],
  ends: [EndPlan, EndPlan],
  groundZ: [number | null, number | null],
  objective: Objective,
): RunSetup {
  const S = rp.length;
  type Row = { s: number; target: number; upper: number };
  const rows: Row[] = Array.from(stations, (s, k) => ({ s, target: target[k], upper: upper[k] }));
  for (const sv of extra) {
    let k = 0;
    while (k + 1 < stations.length && stations[k + 1] < sv) k++;
    const t = (sv - stations[k]) / (stations[k + 1] - stations[k] || 1);
    // The ground at the point itself, as T12 reads a station and as the point was found to be reached.
    // Why not the lowest ground ±2.5 m of the grid: beside a portal in a steep bank (5204786 at 12 m)
    // that was a metre lower than what was reached, a ceiling no road could meet.
    const q = poseAt(rp, Math.min(S, Math.max(0, sv)));
    rows.push({
      s: sv,
      target: target[k] + (target[k + 1] - target[k]) * t,
      upper: ground(q.lon, q.lat) - depthFor(belowAt(rp, sv)),
    });
  }
  rows.sort((p, q) => p.s - q.s);
  const n = rows.length;
  const none = new Float64Array(n).fill(-Infinity);
  return {
    rp,
    stations: Float64Array.from(rows, (r) => r.s),
    target: Float64Array.from(rows, (r) => r.target),
    lower: none,
    lowerAtCrossings: none,
    lowerLaw: none,
    lowerOpen: none,
    upper: Float64Array.from(rows, (r) => r.upper),
    fixed,
    ends,
    groundZ,
    cross: [],
    crossInfo: [],
    blocked: [],
    ...objectiveWeights(objective),
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
    // Two main lines coming down to the same place (markSharedTouchdowns): no row to hold them apart.
    const isUntied = p.untied === true;
    if (isUntied) continue;
    const a = { run: p.a, s: p.sa };
    const b = { run: p.b, s: p.sb };
    const firm = false;
    if (p.relation === "same")
      out.push({
        kind: "within",
        a,
        b,
        lo: -SAME_SURFACE_M,
        hi: SAME_SURFACE_M,
        firm,
      });
    else if (p.relation === "above")
      out.push({ kind: "within", a, b, lo: LEVEL_APART_M, hi: Infinity, firm });
    else out.push({ kind: "within", a, b, lo: -Infinity, hi: -LEVEL_APART_M, firm });
  }
  // Main lines beside each other (S6 PR 3): within COMPANIONS.dzM of one height, at the plan's weight.
  for (const c of plan.companions?.list ?? []) {
    const isInside = members.has(c.a) && members.has(c.b) && c.held !== false;
    if (!isInside) continue;
    const dz = COMPANIONS.value.dzM;
    out.push({
      kind: "within",
      a: { run: c.a, s: c.sa },
      b: { run: c.b, s: c.sb },
      lo: -dz,
      hi: dz,
      firm: false,
      weight: plan.companions!.weight,
      companion: true,
    });
  }
  return out;
}

type ComponentResult = {
  solved: Map<string, Solved>;
  unsolved: Map<string, VerticalAttempt[]>;
  /** Solved runs' worst miss of each assumed floor, keyed "<run>|sunk" / "<run>|floor". */
  sunk: Map<string, RunProblem>;
  /** The fallback level each run ended at (to start a later pass there). */
  levels: Map<string, number>;
  /**
   * The stretches each run's lowered speed covers at that level (`capZones`), carried with the level:
   * a later pass that started at the level with no windows would lower the whole run (P2.7-3a).
   */
  windows: Map<string, Array<[number, number]>>;
  stats: Omit<SolveStats, "components">;
};

type LevelSolve = {
  profiles: Map<string, VerticalProfile>;
  /** Exact constraints a run fails (`isFailing` decides which of them unsolve it). */
  problems: Map<string, RunProblem[]>;
  /** Metres by which a run misses the decks it shares or stands over (soft, summed). */
  soft: Map<string, number>;
  /** Where on the run those misses are (run distances). */
  softAt: Map<string, number[]>;
  isConverged: boolean;
};

/** Half the stretch around a failure that a lower design speed covers (local fallback, `capZones`). */
const LOWER_WINDOW_M = 150;
/**
 * How often a run at its last step may widen its lowered stretches (height builds). Why a bound: a
 * failure that moves on each solve would otherwise take a solve of the whole component per 150 m.
 */
const MAX_WIDENINGS = 3;

/**
 * The stretches a run at its last lowered step adds where it fails outside its lowered stretches
 * (height builds, P2.7-6 PR 1): ±LOWER_WINDOW_M around each such failure, within the run.
 */
export function windowsToWiden(
  failingS: readonly number[],
  windows: ReadonlyArray<[number, number]>,
  length: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const sv of failingS) {
    const isCovered = [...windows, ...out].some(([a, b]) => sv >= a && sv <= b);
    if (isCovered) continue;
    out.push([Math.max(0, sv - LOWER_WINDOW_M), Math.min(length, sv + LOWER_WINDOW_M)]);
  }
  return out;
}

/**
 * Whether a run's problems unsolve it: anything of the statute, any end or junction it cannot meet,
 * an assumed floor missed at all, or, at the last fallback step (`given`, after the lowest design
 * speed), missed by more than its give (assumptions.DEM_SINK_GIVE, OPEN_FLOOR_GIVE). Why the give
 * only there (and not on every run, as first written in P2.6): always on, the QP traded the assumed
 * floors on runs that met them, and the test section moved by up to 1.9 m.
 */
export function isFailing(problems: RunProblem[], given: boolean, height = false): boolean {
  return problems.some((p) => {
    if (!given) return true;
    // A height build (P2.7-6 PR 1), at the last step: an assumed floor missed changes the structure
    // (an embankment, a cut), never whether the run is solved; a clearance a thinner girder takes, or
    // a road near a low end the solved deck does not clear (blocked), neither. Why only at the last
    // step, as the give it replaces: before it the misses still step the run down (the 特例 grade, a
    // lower speed), so a deck that can stay a viaduct does (P2.7-6 4.1). Counted at every step, a
    // ramp over a plateau stayed at the standard step and was cut into the plateau's edges, and the
    // default range's 臨港道路 (45177681) left its 特例 step and moved 9.8 m (the first version).
    if (height && (p.what === "sunk" || p.what === "floor")) return false;
    if (height && p.give !== undefined) return false;
    if (height) return true;
    if (p.what === "sunk") return p.by > DEM_SINK_GIVE.value;
    if (p.what === "floor") return p.by > OPEN_FLOOR_GIVE.value;
    return true;
  });
}

/** Short ramps between two parents of the component, as cubic connectors (none in a cycle). */
function connectorsOf(plan: Plan, ids: string[]): Map<string, { start: Ref; end: Ref }> {
  const members = new Set(ids);
  const out = new Map<string, { start: Ref; end: Ref }>();
  for (const id of ids) {
    const rp = plan.runs.get(id)!;
    // A run on a structure keeps its knots: the structure's profile is pinned to them (profilePins).
    // A tunnel or cut keeps its knots too: its ceilings under the ground are rows on them (P9).
    // A run at grade keeps its knots: its band about the design ground line is rows on them (S6 PR 2).
    const isCandidate = rp.cls === "ramp" && isShortRun(rp) && !rp.over && !rp.below && !rp.ground;
    if (!isCandidate) continue;
    const refs = [true, false].map((atStart): Ref | null => {
      const e = endPlan(plan, rp, atStart);
      const isJoined = (e.kind === "junction" || e.kind === "seam") && members.has(e.parent);
      if (!isJoined) return null;
      return { run: e.parent, s: nodeS(plan.runs.get(e.parent)!, e.parentNodeIndex) };
    });
    const hasBoth = refs[0] !== null && refs[1] !== null && refs.every((r) => r!.run !== id);
    if (hasBoth) out.set(id, { start: refs[0]!, end: refs[1]! });
  }
  // A connector hanging (through other connectors) from itself has no profile to follow.
  const reaches = (from: string, to: string, seen: Set<string>): boolean => {
    const f = out.get(from);
    if (!f) return false;
    for (const p of [f.start.run, f.end.run]) {
      if (p === to) return true;
      if (seen.has(p)) continue;
      seen.add(p);
      if (reaches(p, to, seen)) return true;
    }
    return false;
  };
  for (const id of [...out.keys()].sort()) if (reaches(id, id, new Set())) out.delete(id);
  return out;
}

/** Problems of a failing run in lexicographic order of what matters: main lines, ramps, soft misses. */
export type Score = [number, number, number];

export function isBetter(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-9) return true;
    if (a[i] > b[i] + 1e-9) return false;
  }
  return false;
}

/**
 * One component through the fallbacks of 設計書 4.3 の 3: solve all its runs jointly, find the
 * runs whose exact constraints still fail (their own bounds and ends, junctions, the crossings'
 * clearance), move only those one step down their fallback list, and solve again, until no failing
 * run has a step left. A lower design speed covers only LOWER_WINDOW_M either side of where the run
 * failed (`capZones`). A run that has no step left for a junction end or a crossing it cannot meet
 * moves its partner there one step instead (short of "crossings only", around the coupling), since
 * it is the pair that cannot be met. A ramp that misses a deck it shares (a nose it must leave in
 * time to reach the ground) also steps down, short of "crossings only", and goes back to the step
 * where it missed least if stepping down did not help. Main lines keep their speed for that: their
 * leftovers are stacked carriageways changing over where OSM puts them too close, which no speed
 * solves. The best state seen (fewest failing main lines, then ramps, then metres of missed decks)
 * is the one kept: a later step can make things worse (W1 of the P2.5 review).
 */
function solveComponent(
  plan: Plan,
  ids: string[],
  ground: GroundSampler,
  objects: ObjectPoly[],
  diagnostics: XwDiagnostic[],
  objective: Objective,
  pins: Map<string, VerticalProfile> = new Map(),
  start: Map<string, number> = new Map(),
  setupsOf?: (id: string) => RunSetup,
  anchorBanks: AnchorBanks = {},
  startWindows: Map<string, Array<[number, number]>> = new Map(),
): ComponentResult {
  const members = new Set(ids);
  // A block's pieces are cut from their runs' setups, made once per run (setupsOf, solveBlocks).
  const setups = new Map(
    ids.map((id) => [
      id,
      setupsOf ? setupsOf(id) : setupRun(plan, plan.runs.get(id)!, ground, objects, diagnostics, objective),
    ]),
  );
  const couplings = couplingsOf(plan, members);
  const connectors = connectorsOf(plan, ids);
  // Without "crossings only": the standard floor over open ground is judged at every step (T4
  // checks it), so dropping it from the QP can only let the run and its neighbours sink further (in
  // P2.5 it shipped 17 runs below that floor). Why keep it in fallbackPlans: the single-run solve
  // (solveVertical, T9) still reports the whole ladder of 4.3 の 3.
  const ladders = new Map(
    ids.map((id) => {
      const rp = plan.runs.get(id)!;
      const plans = fallbackPlans(rp.planV, rp.minV).filter((p) => !p.crossingsOnly);
      const lowest = plans[plans.length - 1];
      return [id, [...plans, { ...lowest, steps: [...lowest.steps, "assumedGive" as const] }]];
    }),
  );
  const level = new Map(ids.map((id) => [id, Math.min(start.get(id) ?? 0, ladders.get(id)!.length - 1)]));
  const isGiven = (id: string) => ladders.get(id)![level.get(id)!].steps.includes("assumedGive");
  const isHeight = plan.structures === "height";
  // A run on a structure is not classified (its girder, sRange and tapers are the structure's): its
  // assumed floors judge it as by the tags (PR 1 review W6).
  const isHeightRun = (id: string) => isHeight && plan.runs.get(id)!.over === null;
  const fails = (id: string, problems: RunProblem[]) => isFailing(problems, isGiven(id), isHeightRun(id));
  // The windows come with the level they were opened at (startWindows): without them a run
  // starting at a lowerSpeed step would take capZones' whole-run cap, a different top speed and
  // knot spacing than the pass before (41009552 in ship/all, P2.7-3a).
  const windows = new Map<string, Array<[number, number]>>(
    ids.map((id) => [id, (startWindows.get(id) ?? []).map(([a, b]): [number, number] => [a, b])]),
  );
  const attempts = new Map<string, VerticalAttempt[]>(ids.map((id) => [id, []]));
  /** Per ramp: the soft miss at each step it was solved with, and whether the step was clean. */
  const history = new Map<string, Array<{ soft: number; clean: boolean }>>(ids.map((id) => [id, []]));
  const crossingsHere = plan.crossings.filter((c) => members.has(c.upper) && members.has(c.lower));
  /** A piece's point on its run (the run itself for a component's run): what the texts name. */
  const onRun = (id: string, s: number) => {
    const piece = plan.pieceRuns?.get(id);
    return piece ? { run: piece.run, s: s + piece.a } : { run: id, s };
  };
  const stats = {
    largestRuns: ids.length,
    largestVariables: 0,
    solves: 0,
    iterations: 0,
    qpMs: 0,
    unconverged: 0,
    retried: 0,
  };
  const unconverged: string[] = [];
  const isRamp = (id: string) => plan.runs.get(id)!.cls === "ramp";
  const junctionAt = (id: string, atStart: boolean) =>
    couplings.find(
      (c): c is Extract<Coupling, { kind: "junction" }> =>
        c.kind === "junction" && c.child === id && c.atStart === atStart,
    );

  /** A run's input at a step of its ladder (its own level by default). */
  const inputOf = (id: string, at = level.get(id)!): RunInput => {
    const st = setups.get(id)!;
    const step = ladders.get(id)![at];
    const isLowered = step.steps.includes("lowerSpeed");
    const around = windows.get(id)!;
    const follow = connectors.get(id);
    return {
      id,
      length: st.rp.length,
      zones: isLowered
        ? capZones(st.rp.zones, step.cap, around.length > 0 ? around : undefined)
        : st.rp.zones,
      special: step.special,
      stations: st.stations,
      target: st.target,
      lower: step.crossingsOnly ? st.lowerAtCrossings : st.lower,
      lowerLaw: st.lowerLaw,
      lowerOpen: st.lowerOpen,
      assumedGive: step.steps.includes("assumedGive"),
      ...(pins.has(id) ? { pinned: pins.get(id)! } : {}),
      upper: st.upper,
      start: st.fixed[0],
      end: st.fixed[1],
      // A cubic connector has no knots of its own to pin; connectorsOf never picks a run on a
      // structure, and vertical.ts refuses a connector with pins.
      ...(follow ? { follow } : { pins: profilePins(st.rp) }),
      ...(plan.pieceRuns?.has(id) ? { textOffset: plan.pieceRuns.get(id)!.a } : {}),
      ...inputWeights(st),
      ...(isHeightRun(id) ? { lawGive: GIRDER_GIVE_M, ...(st.lawNear ? { lawNear: st.lawNear } : {}) } : {}),
      ...(st.bandLo && st.bandHi ? { bandLo: st.bandLo, bandHi: st.bandHi } : {}),
    };
  };
  /**
   * `--hold-mains on` (S6 PR 6): each main line's own line, solved alone at its first step with no
   * other run's rows (no junction, crossing or deck pair), what it is held to near its junctions.
   * Made on the first solve that asks, once per component. Why each main run alone, not S2's
   * solveRoute: that one solves a block partition's pieces (blocks.ts); with the components' solve
   * there are no pieces, and a main run alone is its route's part between its own ends.
   */
  let mainLines: Map<string, VerticalProfile> | null = null;
  const mainLinesOf = (): Map<string, VerticalProfile> => {
    if (mainLines) return mainLines;
    mainLines = new Map();
    for (const id of ids) {
      const isMain = plan.runs.get(id)!.cls === "expressway" && !connectors.has(id);
      if (!isMain) continue;
      const alone = solveJoint([inputOf(id, 0)], []);
      const isSolved = alone.status === "converged" && alone.profiles.has(id);
      if (isSolved) mainLines.set(id, alone.profiles.get(id)!);
    }
    return mainLines;
  };
  const solveAt = (): LevelSolve => {
    const inputs: RunInput[] = ids.map((id) => inputOf(id));
    const started = performance.now();
    const res = solveJoint(inputs, couplings);
    stats.qpMs += performance.now() - started;
    stats.solves++;
    stats.iterations += res.iterations;
    stats.largestVariables = Math.max(stats.largestVariables, res.variables);
    if (res.retried) stats.retried++;
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
      const lower = onRun(c.lower, c.sLower);
      const upper = onRun(c.upper, c.sUpper);
      const what = `clearance over ${lower.run} ${gap.toFixed(2)} m < ${ROAD_CLEAR} m at ${Math.round(upper.s)} m`;
      const by = ROAD_CLEAR - gap;
      // A height build thins the upper deck's girder for a miss up to GIRDER_GIVE_M (chunkRun).
      const give = isHeightRun(c.upper) && by <= GIRDER_GIVE_M + 1e-9 ? { give: "girder" as const } : {};
      problems.get(c.upper)!.push({
        what: "crossing",
        basis: "law",
        s: c.sUpper,
        by,
        text: what,
        partner: { run: c.lower, s: c.sLower },
        ...give,
      });
      problems.get(c.lower)!.push({
        what: "crossing",
        basis: "law",
        s: c.sLower,
        by,
        text: `under ${upper.run}: ${what}`,
        partner: { run: c.upper, s: c.sUpper },
        ...give,
      });
    }
    const soft = new Map(ids.map((id) => [id, 0]));
    const softAt = new Map<string, number[]>(ids.map((id) => [id, []]));
    for (const c of couplings) {
      // A companion's miss is no deck missed (the ramps step down only for a deck they share).
      if (c.kind !== "within" || c.firm || c.companion) continue;
      const d = evalProfile(profiles.get(c.a.run)!, c.a.s).z - evalProfile(profiles.get(c.b.run)!, c.b.s).z;
      const miss = Math.max(0, c.lo - d, d - c.hi);
      if (miss <= SOFT_SLACK_M) continue;
      soft.set(c.a.run, soft.get(c.a.run)! + miss);
      soft.set(c.b.run, soft.get(c.b.run)! + miss);
      softAt.get(c.a.run)!.push(c.a.s);
      softAt.get(c.b.run)!.push(c.b.s);
    }
    // `--hold-mains on` (S6 PR 6): within HOLD_MAINS.reachM of where a ramp joins a main line, the main
    // line off its own line (mainLinesOf) by more than HOLD_MAINS.slackM counts as the ramp's soft miss,
    // so the ramp steps on (a lower speed, the special grade) before the main line gives way. No new
    // row on the main line: the joint solve is as before; only which step the ramp takes changes.
    const isHolding = plan.holdMains === "on";
    if (isHolding) {
      const lines = mainLinesOf();
      const { reachM, slackM, stepM } = HOLD_MAINS.value;
      for (const c of couplings) {
        const isRampOnMain = c.kind === "junction" && isRamp(c.child) && lines.has(c.parent.run);
        if (!isRampOnMain) continue;
        const own = lines.get(c.parent.run)!;
        const solved = profiles.get(c.parent.run)!;
        const L = plan.runs.get(c.parent.run)!.length;
        let miss = 0;
        for (let s = Math.max(0, c.parent.s - reachM); s <= Math.min(L, c.parent.s + reachM); s += stepM) {
          const off = Math.abs(evalProfile(solved, s).z - evalProfile(own, s).z) - slackM;
          if (off > 0) miss += off;
        }
        if (miss <= SOFT_SLACK_M) continue;
        soft.set(c.child, soft.get(c.child)! + miss);
        softAt.get(c.child)!.push(c.atStart ? 0 : plan.runs.get(c.child)!.length);
      }
    }
    for (const id of ids) {
      const step = ladders.get(id)![level.get(id)!];
      const worst = problems
        .get(id)!
        .map((p) => p.text)
        .join("; ");
      attempts
        .get(id)!
        .push({ V: step.cap, special: step.special, crossingsOnly: step.crossingsOnly, worst });
      history.get(id)![level.get(id)!] = { soft: soft.get(id)!, clean: !fails(id, problems.get(id)!) };
    }
    return { profiles, problems, soft, softAt, isConverged };
  };

  const scoreOf = (r: LevelSolve): Score => {
    if (!r.isConverged) return [Infinity, Infinity, Infinity];
    let main = 0;
    let ramp = 0;
    let soft = 0;
    for (const id of ids) {
      const isUnsolved = fails(id, r.problems.get(id)!);
      if (isUnsolved && isRamp(id)) ramp++;
      else if (isUnsolved) main++;
      soft += r.soft.get(id)!;
    }
    return [main, ramp, soft];
  };
  type State = {
    result: LevelSolve;
    score: Score;
    level: Map<string, number>;
    windows: Map<string, Array<[number, number]>>;
  };
  const snapshot = (r: LevelSolve): State => ({
    result: r,
    score: scoreOf(r),
    level: new Map(level),
    windows: new Map([...windows].map(([id, w]) => [id, [...w]])),
  });

  /** Moves a run one step down, widening its lowered stretch around `at` when the step lowers V. */
  const stepDown = (id: string, at: number[]) => {
    const ladder = ladders.get(id)!;
    const next = level.get(id)! + 1;
    const isLowering = ladder[next].steps.includes("lowerSpeed");
    if (isLowering) {
      const S = plan.runs.get(id)!.length;
      const mine = windows.get(id)!;
      for (const s of at) {
        const w: [number, number] = [Math.max(0, s - LOWER_WINDOW_M), Math.min(S, s + LOWER_WINDOW_M)];
        // The same stretch twice changes nothing in capZones; kept once so what is carried stays short.
        const isKnown = mine.some(([a, b]) => a === w[0] && b === w[1]);
        if (!isKnown) mine.push(w);
      }
    }
    level.set(id, next);
  };
  /** Where a failing run's partner is at the coupling it cannot meet (a junction end, a crossing). */
  const partnersOf = (id: string, problems: RunProblem[]): Ref[] => {
    const out: Ref[] = [];
    for (const p of problems) {
      if (p.partner) out.push(p.partner);
      const isEnd = p.what === "end" || p.what === "start";
      const j = isEnd ? junctionAt(id, p.what === "start") : undefined;
      if (j) out.push(j.parent);
    }
    return out;
  };

  let result = solveAt();
  let best = snapshot(result);
  /** Per run: how often its lowered stretches were widened at its last step (height builds). */
  const widenings = new Map<string, number>();
  for (;;) {
    // An unconverged solve is no verdict on any run: stepping runs down on it would lower speeds
    // for nothing. Stop and report (solver_not_converged); the exact checks still judge each run.
    if (!result.isConverged) break;
    const advance = new Map<string, number[]>();
    const add = (id: string, at: number[]) => advance.set(id, [...(advance.get(id) ?? []), ...at]);
    const hasStep = (id: string) => !pins.has(id) && level.get(id)! + 1 < ladders.get(id)!.length;
    // A soft miss or a partner's failure never takes a run to the give on the assumed floors.
    const hasSoftStep = (id: string) =>
      hasStep(id) && !ladders.get(id)![level.get(id)! + 1].steps.includes("assumedGive");
    const widen = new Map<string, number[]>();
    for (const id of ids) {
      const problems = result.problems.get(id)!;
      if (fails(id, problems)) {
        if (hasStep(id)) {
          add(
            id,
            problems.map((p) => p.s),
          );
          continue;
        }
        // A height build (P2.7-6 PR 1, P2.7-3a's defect 1): a run at its last lowered step that fails
        // outside the stretches its speed was lowered over takes ±LOWER_WINDOW_M around the failure
        // too and is solved again (windows only grow when a step is taken otherwise).
        const isLowered = ladders.get(id)![level.get(id)!].steps.includes("lowerSpeed");
        const mine = windows.get(id)!;
        const more = windowsToWiden(
          problems.filter((p) => fails(id, [p])).map((p) => p.s),
          mine,
          plan.runs.get(id)!.length,
        );
        const widened = widenings.get(id) ?? 0;
        const isWidening =
          isHeightRun(id) && isLowered && !pins.has(id) && more.length > 0 && widened < MAX_WIDENINGS;
        if (isWidening) {
          mine.push(...more);
          widen.set(
            id,
            more.map(([a, b]) => (a + b) / 2),
          );
          widenings.set(id, widened + 1);
        }
        for (const p of partnersOf(id, problems))
          if (members.has(p.run) && hasSoftStep(p.run)) add(p.run, [p.s]);
        continue;
      }
      const isSoft = result.soft.get(id)! > 0;
      if (isRamp(id) && isSoft && hasSoftStep(id)) add(id, result.softAt.get(id)!);
    }
    if (advance.size === 0 && widen.size === 0) break;
    for (const [id, at] of advance) stepDown(id, at);
    result = solveAt();
    const now = snapshot(result);
    if (isBetter(now.score, best.score)) best = now;
  }
  // Ramps that stepped down for a shared deck and missed it no less: back to the cleanest step
  // that missed least (lowest first), then one more solve; a ramp the move breaks keeps its step.
  const moved = new Map<string, number>();
  for (const id of ids) {
    if (!isRamp(id)) continue;
    const seen = history.get(id)!;
    let bestStep = level.get(id)!;
    for (let k = 0; k < seen.length; k++) {
      const h = seen[k];
      const isLess = h !== undefined && h.clean && h.soft < seen[bestStep].soft - 0.05;
      const isTie =
        h !== undefined && h.clean && Math.abs(h.soft - seen[bestStep].soft) <= 0.05 && k < bestStep;
      if (isLess || isTie) bestStep = k;
    }
    if (bestStep === level.get(id)!) continue;
    moved.set(id, level.get(id)!);
    level.set(id, bestStep);
  }
  if (moved.size > 0) {
    const tried = solveAt();
    const broken = [...moved.keys()].filter((id) => fails(id, tried.problems.get(id)!));
    const isUsable = tried.isConverged && broken.length === 0;
    if (!isUsable) for (const id of tried.isConverged ? broken : moved.keys()) level.set(id, moved.get(id)!);
    result = isUsable ? tried : solveAt();
    const now = snapshot(result);
    if (isBetter(now.score, best.score)) best = now;
  }
  const isWorse = isBetter(best.score, scoreOf(result));
  if (isWorse) {
    result = best.result;
    for (const [id, l] of best.level) level.set(id, l);
    for (const [id, w] of best.windows) windows.set(id, w);
  }
  if (!result.isConverged) {
    diagnostics.push({
      run: ids[0],
      kind: "solver_not_converged",
      detail: `component of ${ids.length} runs: ${unconverged.join("; ")}`,
      allowed: false,
    });
  }
  const { profiles, problems } = result;
  const banks = banksOf(plan, ids, profiles, setups, anchorBanks);
  const solved = new Map<string, Solved>();
  const unsolved = new Map<string, VerticalAttempt[]>();
  const sunk = new Map<string, RunProblem>();
  for (const id of ids) {
    const mine = problems.get(id)!;
    if (fails(id, mine)) {
      // The attempts in order, then what the state kept fails on (it may be an earlier one, W1).
      const step = ladders.get(id)![level.get(id)!];
      const kept = {
        V: step.cap,
        special: step.special,
        crossingsOnly: false,
        worst: `kept: ${mine.map((p) => p.text).join("; ")}`,
      };
      unsolved.set(id, [...attempts.get(id)!, kept]);
      continue;
    }
    // The worst miss of each assumed floor a solved run keeps (W2), reported with how much. A height
    // build reports none: the stretch is an embankment or a cut instead (heightStructures.ts).
    for (const what of isHeightRun(id) ? [] : (["sunk", "floor"] as const)) {
      const worst = mine.filter((p) => p.what === what).sort((p, q) => q.by - p.by)[0];
      if (worst) sunk.set(`${id}|${what}`, worst);
    }
    const st = setups.get(id)!;
    const profile = profiles.get(id)!;
    const ends = st.ends.map((e, side) =>
      xwEnd(plan, e, side === 0 ? 0 : st.rp.length, profile, profiles, banks, st.groundZ[side], st.rp),
    );
    solved.set(id, {
      rp: st.rp,
      profile,
      pieces: [{ a: 0, b: st.rp.length, profile }],
      zones: profile.zones,
      steps: ladders.get(id)![level.get(id)!].steps,
      bank: banks.get(id)!,
      start: ends[0],
      end: ends[1],
      cross: st.cross,
      crossInfo: [...st.crossInfo],
      blocked: st.blocked,
    });
  }
  return {
    solved,
    unsolved,
    sunk,
    levels: new Map(level),
    windows: new Map([...windows].map(([id, w]) => [id, [...w]])),
    stats,
  };
}

/**
 * A component solved, then solved again without the failing ramps that hold a failing main line
 * (coupled to it directly, or through other failing ramps), for as long as that leaves fewer runs
 * unsolved: a ramp that cannot meet a crossing or a nose otherwise keeps the main line it couples
 * to unsolved too, and every other branch of that main line with it (P2.5: 141 runs lost behind
 * two main lines short by 16–29 cm). Each pass starts from the levels the last one ended at, and
 * the best pass is kept. Once the main lines are solved, the shed ramps (and the runs hanging from
 * them) are put back with every solved run held at its profile, and those that now solve are kept.
 * The rest stay unsolved (closed, with their attempts); the runs hanging from them are reported
 * as parent_unsolved. A failing ramp coupled to no failing main line is never shed.
 */
function solveShedding(
  plan: Plan,
  ids: string[],
  ground: GroundSampler,
  objects: ObjectPoly[],
  diagnostics: XwDiagnostic[],
  objective: Objective,
  setupsOf?: (id: string) => RunSetup,
  anchorBanks: AnchorBanks = {},
): ComponentResult & { orphaned: Map<string, string> } {
  const component = new Set(ids);
  const stats = {
    largestRuns: ids.length,
    largestVariables: 0,
    solves: 0,
    iterations: 0,
    qpMs: 0,
    unconverged: 0,
    retried: 0,
  };
  const add = (res: ComponentResult) => {
    stats.largestVariables = Math.max(stats.largestVariables, res.stats.largestVariables);
    stats.solves += res.stats.solves;
    stats.iterations += res.stats.iterations;
    stats.qpMs += res.stats.qpMs;
    stats.unconverged += res.stats.unconverged;
    stats.retried += res.stats.retried;
  };
  const isMain = (id: string) => plan.runs.get(id)!.cls !== "ramp";
  const neighbours = couplingGraph(plan, component);
  type Pass = {
    res: ComponentResult;
    local: XwDiagnostic[];
    shed: Map<string, VerticalAttempt[]>;
    orphaned: Map<string, string>;
    lost: [number, number];
  };
  const run = (
    members: string[],
    shed: Map<string, VerticalAttempt[]>,
    orphaned: Map<string, string>,
    start: Map<string, number>,
    startWindows: Map<string, Array<[number, number]>>,
  ): Pass => {
    const local: XwDiagnostic[] = [];
    const res = solveComponent(
      plan,
      members,
      ground,
      objects,
      local,
      objective,
      new Map(),
      start,
      setupsOf,
      anchorBanks,
      startWindows,
    );
    add(res);
    const failing = [...res.unsolved.keys()];
    const mains = failing.filter(isMain).length;
    const lost = mains + [...shed.keys(), ...orphaned.keys()].filter(isMain).length;
    return { res, local, shed, orphaned, lost: [lost, failing.length + shed.size + orphaned.size] };
  };
  const isFewer = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  let pass = run([...ids], new Map(), new Map(), new Map(), new Map());
  let best = pass;
  for (;;) {
    const failing = new Set(pass.res.unsolved.keys());
    // Failing ramps reachable from a failing main line through failing runs.
    const holding = new Set<string>();
    const queue = [...failing].filter(isMain);
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const n of neighbours.get(id) ?? []) {
        const isHeld = failing.has(n) && !isMain(n) && !holding.has(n);
        if (!isHeld) continue;
        holding.add(n);
        queue.push(n);
      }
    }
    if (holding.size === 0) break;
    const shed = new Map(pass.shed);
    for (const id of holding) shed.set(id, pass.res.unsolved.get(id)!);
    const orphaned = new Map(pass.orphaned);
    const removed = new Set([...shed.keys(), ...orphaned.keys()]);
    for (let changed = true; changed;) {
      changed = false;
      for (const id of ids) {
        if (removed.has(id)) continue;
        const lostParent = junctionParents(plan, id).find((p) => component.has(p) && removed.has(p));
        if (lostParent === undefined) continue;
        removed.add(id);
        orphaned.set(id, lostParent);
        changed = true;
      }
    }
    const members = ids.filter((id) => !removed.has(id));
    if (members.length === 0) break;
    pass = run(members, shed, orphaned, pass.res.levels, pass.res.windows);
    const isImproved = isFewer(pass.lost, best.lost);
    if (!isImproved) break;
    best = pass;
  }
  const { res, shed, orphaned } = best;
  const isMainSolved = [...res.unsolved.keys()].every((id) => !isMain(id));
  const hasShed = shed.size > 0 || orphaned.size > 0;
  if (isMainSolved && hasShed) {
    // Put the shed runs back around everything solved, held where it is.
    const pins = new Map([...res.solved].map(([id, s]) => [id, s.profile]));
    const local: XwDiagnostic[] = [];
    const back = solveComponent(
      plan,
      [...ids],
      ground,
      objects,
      local,
      objective,
      pins,
      res.levels,
      setupsOf,
      anchorBanks,
      res.windows,
    );
    add(back);
    const returned = [...shed.keys(), ...orphaned.keys()].filter((id) => back.solved.has(id));
    const isWorth = returned.length > 0 && [...res.solved.keys()].every((id) => back.solved.has(id));
    if (isWorth) {
      diagnostics.push(...local);
      const keepShed = new Map([...shed].filter(([id]) => !back.solved.has(id)));
      // Still hanging from a run that stays out: reported with that parent; the others fail on their own.
      const keepOrphans = new Map(
        [...orphaned].filter(([id, parent]) => !back.solved.has(id) && !back.solved.has(parent)),
      );
      const unsolved = new Map([...back.unsolved].filter(([id]) => !keepOrphans.has(id)));
      for (const [id, a] of keepShed) unsolved.set(id, unsolved.get(id) ?? a);
      return { ...back, unsolved, stats, orphaned: keepOrphans };
    }
  }
  diagnostics.push(...best.local);
  const unsolved = new Map(res.unsolved);
  for (const [id, a] of shed) unsolved.set(id, a);
  return { ...res, unsolved, stats, orphaned };
}

/** Runs coupled to each other in a component: junctions, crossings, decks over one another. */
function couplingGraph(plan: Plan, members: Set<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const isInside = members.has(a) && members.has(b) && a !== b;
    if (!isInside) return;
    out.set(a, (out.get(a) ?? new Set()).add(b));
    out.set(b, (out.get(b) ?? new Set()).add(a));
  };
  for (const id of members) for (const p of junctionParents(plan, id)) link(id, p);
  for (const c of plan.crossings) link(c.upper, c.lower);
  for (const p of plan.pairs) link(p.a, p.b);
  for (const c of plan.companions?.list ?? []) if (c.held !== false) link(c.a, c.b);
  return out;
}

function xwEnd(
  plan: Plan,
  e: EndPlan,
  s: number,
  profile: VerticalProfile,
  profiles: Map<string, VerticalProfile>,
  banks: Map<string, Float64Array>,
  groundZ: number | null,
  rp?: RunPlan,
): XwEnd {
  // With runs at grade the banks are read at the very s, as the stations are (chunkRun's bankAt).
  const isGroundBuild = plan.ground === "compile";
  // A piece's end at an anchor is no end of the run: the run's ends are written once it is stitched.
  if (e.kind === "open" || e.kind === "anchor") return { kind: "open" };
  const here = evalProfile(profile, s);
  if (e.kind === "ground") {
    // `ground` is the DEM where the run meets it (T5 measures the deck against it), not the deck.
    const base = {
      z: roundTo(here.z, 3),
      grade: roundTo(here.grade, 5),
      ground: roundTo(groundZ ?? here.z, 3),
      // A run at grade's ground end is not held level (banksOf): its own bank there (review W11:
      // 157812961 wrote 0 and banked 9.47 %).
      bank:
        isGroundBuild && rp?.ground && banks.has(rp.run.id)
          ? roundTo(bankAt(rp, banks.get(rp.run.id)!, s), 4)
          : 0,
    };
    return e.into ? { kind: "portal", into: e.into, ...base } : { kind: "ground", ...base };
  }
  const pp = plan.runs.get(e.parent)!;
  const ps = nodeS(pp, e.parentNodeIndex);
  const parent = profiles.get(e.parent)!;
  const v = evalProfile(parent, ps);
  const pBank = banks.get(e.parent)!;
  const bank = isGroundBuild
    ? bankAt(pp, pBank, ps)
    : pBank[Math.min(pBank.length - 1, Math.max(0, sampleAt(pp, ps) - pp.i0))];
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
 * How banksOf treats the anchors of pieces (blocks.ts): `after` orders a piece after the one before
 * its anchor, `bankAt` gives the bank at a piece's anchor end (null: free), from what is done.
 */
type AnchorBanks = {
  after?: Map<string, string[]>;
  bankAt?: (id: string, side: number, done: Map<string, Float64Array>) => number | null;
};

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
  anchors: AnchorBanks = {},
): Map<string, Float64Array> {
  const members = new Set(ids);
  const parents = new Map(
    ids.map((id) => [
      id,
      [...junctionParents(plan, id), ...(anchors.after?.get(id) ?? [])].filter(
        (p) => members.has(p) && p !== id,
      ),
    ]),
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
      // A run at grade going on at grade past its ground end (a street, a road at grade) is not held to
      // a level road there (S6 PR 2): a short ramp at grade between a banked parent and its ground end
      // could not run its bank in over 第18条 (157812961, 23 m). The viaducts keep their level end.
      if (e.kind === "ground") return plan.ground === "compile" && rp.ground ? null : 0;
      if (e.kind === "open") return null;
      if (e.kind === "anchor") return anchors.bankAt?.(id, side, done) ?? null;
      const pBank = done.get(e.parent);
      if (!pBank) return null;
      const pp = plan.runs.get(e.parent)!;
      const ps = pp.align.s[pp.align.vertexSample[e.parentNodeIndex]] - pp.align.s[pp.i0];
      // With runs at grade, interpolated at the parent's own s as chunkRun writes its station there, so the
      // child's pinned end and the parent's station agree; without them the sample before, as before.
      return plan.ground === "compile"
        ? bankAt(pp, pBank, ps)
        : pBank[Math.min(pBank.length - 1, Math.max(0, sampleAt(pp, ps) - pp.i0))];
    };
    const bank = superelevation(
      speeds,
      kappa,
      sampleS,
      { start: bankEnd(0), end: bankEnd(1) },
      { room, pins, transitionV, ...(plan.ground === "compile" ? { strict: true } : {}) },
    );
    done.set(id, bank);
  }
  return done;
}

/** Elevation and grade on a solved run at run distance sv, from the piece holding sv. */
export function evalRun(s: Pick<Solved, "pieces">, sv: number): { z: number; grade: number } {
  const isWhole = s.pieces.length === 1;
  if (isWhole) return evalProfile(s.pieces[0].profile, sv);
  let p = s.pieces[0];
  for (const q of s.pieces) if (q.a <= sv) p = q;
  return evalProfile(p.profile, sv - p.a);
}

/** Where a run is solved: its elevation at run distance s, or null (not solved there, or closed). */
type HeightAt = (run: string, s: number) => { z: number; grade: number } | null;

/**
 * A block (a component for `components`) as the scorecard lists it; `canonical` is hashed by the
 * script. `members`: the run ids it has pieces of, sorted (report.json's blocks, P2.7-4).
 */
export type BlockSummary = {
  id: string;
  pieces: number;
  runs: number;
  variables: number;
  canonical: string;
  members: string[];
};

/** How the needed runs were split and solved (the scorecard's `partition`). */
export type PartitionResult = {
  mode: "components" | "blocks";
  quietFactor: number | null;
  quietMinM: number | null;
  /** The anchors of the runs the blocks solve: the route solution's value there, the blocks beside it. */
  anchors: Array<{ run: string; s: number; q: number; z: number; grade: number; blocks: [string, string] }>;
  /** Pieces of the needed blocks (runs, for components). */
  pieces: number;
  neededBlocks: number;
  routeSolves: number;
  /** Anchors with a problem of their route solution (RunProblem) within Q of them. */
  anchorsNearProblems: number;
  /**
   * The largest step at an anchor between the two pieces beside it, both solved (I3): elevation,
   * grade and bank. Zero for components.
   */
  joins: { dz: number; dGrade: number; dBank: number };
  blocks: BlockSummary[];
};

export type SolveOptions = {
  /** I7's limit on a block's first QP (blocks.ts BLOCK_MAX_VARIABLES); for tests. */
  maxBlockVariables?: number;
  /** The vertical objective (P2.7-3); v1 when absent. */
  objective?: Objective;
  /** Where a viaduct-tagged run's structure comes from (Plan.structures); the plan's when absent. */
  structures?: "tags" | "height";
};

/** A block's first QP over BLOCK_MAX_VARIABLES (I7): the build stops, naming the block and its runs. */
export class BlockTooLargeError extends Error {
  constructor(block: string, variables: number, runs: string[], limit: number) {
    super(`block ${block}: ${variables} variables > ${limit} (runs ${runs.join(", ")})`);
    this.name = "BlockTooLargeError";
  }
}

/** A route solution that did not converge: the anchors would have no value, so the build stops. */
export class RouteUnsolvedError extends Error {
  constructor(group: string[], status: string) {
    super(`route solution of ${group.join(", ")}: ${status}`);
    this.name = "RouteUnsolvedError";
  }
}

/** The attempts of an unsolved run, as vertical_unsolved reports them. */
function attemptsText(attempts: VerticalAttempt[]): string {
  return attempts
    .map((a) => `V${a.V}${a.special ? "特例" : ""}${a.crossingsOnly ? "交差のみ" : ""}: ${a.worst || "ok"}`)
    .join(" | ");
}

/**
 * The canonical text of a block's solution (hashed by the build script, P2.7-2 4.6): its pieces by
 * id, each with its range, knot spacing, knot elevations and grades (JSON's doubles) and steps, or
 * how it failed.
 */
function canonicalOf(
  ids: string[],
  range: (id: string) => [number, number],
  res: { solved: Map<string, Solved>; unsolved: Map<string, unknown>; orphaned: Map<string, string> },
): string {
  return [...ids]
    .sort()
    .map((id) => {
      const head = `${id} ${JSON.stringify(range(id))}`;
      const s = res.solved.get(id);
      if (!s) return `${head} ${res.orphaned.has(id) ? "orphaned" : "unsolved"}`;
      const p = s.profile;
      return `${head} h=${JSON.stringify(p.h)}${p.cubic ? " cubic" : ""} z=${JSON.stringify(p.z)} g=${JSON.stringify(p.g)} ${s.steps.join(">")}`;
    })
    .join("\n");
}

/** Variables of a block's first QP: two per knot of every run that is not a cubic connector. */
function blockVariables(plan: Plan, ids: string[]): number {
  const connectors = connectorsOf(plan, ids);
  let n = 0;
  for (const id of ids) {
    if (connectors.has(id)) continue;
    const rp = plan.runs.get(id)!;
    n += 2 * (knotIntervals(rp.length, rp.zones, false) + 1);
  }
  return n;
}

/** A run's summary fields for its shifted samples (`--ramp-shift`): their farthest from OSM and the cap, or nothing. */
function rampShiftOf(plan: Plan, rp: RunPlan): { rampShiftM?: number; rampShiftCapM?: number } {
  const a = rp.align;
  let worst = 0;
  for (let i = rp.i0; i <= rp.i1; i++) {
    if (!a.shifted[i]) continue;
    worst = Math.max(
      worst,
      Math.hypot(a.xy[2 * i] - a.original[2 * i], a.xy[2 * i + 1] - a.original[2 * i + 1]),
    );
  }
  const isShifted = worst > 0 && plan.rampShiftCapM !== undefined;
  return isShifted ? { rampShiftM: roundTo(worst, 3), rampShiftCapM: plan.rampShiftCapM } : {};
}

/**
 * The |Δz| over which the runtime gives up merging two decks into one (src/world/expresswayMerge.ts
 * MERGE_MAX_DZ, the same sum; that module is the runtime's, not the compiler's): a station of a pair
 * past it is a merge_skipped stretch.
 */
const MERGE_GIVEN_UP_DZ_M = SAME_SURFACE_ALLOWED_DZ_M + 0.01;

/** Stations of a ramp's target this far apart along it are two stretches. */
const SHIFT_STRETCH_GAP_M = 25;

/** A ramp's ask to move one stretch (rampShiftOffsets): its samples (tapers included), side and weights. */
export type ShiftRequest = {
  i0: number;
  i1: number;
  sign: 1 | -1;
  amount: number;
  /** Each sample's weight from the ramp's first sample (`base`) on. */
  w: Float64Array;
  base: number;
};

/**
 * The stations of a pair of a ramp and the main line it meets (a junction of the two or a parent they
 * share, overlapClass.isJoined) that a shift is for (PR 4 review W3): over the other's deck neither
 * one surface nor a level apart and not a nose the rules pass (a joined pair within NOSE_MAX_DZ_M all
 * along), or past MERGE_GIVEN_UP_DZ_M (a merge the runtime gives up: 汐留入口's wedge). Per run pair
 * (ramp|main), the ramp's run distances.
 */
function shiftTargets(
  plan: Plan,
  solved: CompileResult,
): Map<string, { ramp: string; main: string; s: number[] }> {
  const summaries = new Map(solved.runs.map((r) => [r.id, r]));
  const byPair = new Map<
    string,
    { ramp: string; main: string; stations: Array<{ s: number; dz: number; levelApart: number }> }
  >();
  for (const p of pairStations(solved.chunks)) {
    const [ra, rb] = [plan.runs.get(p.a), plan.runs.get(p.b)];
    const [sa, sb] = [summaries.get(p.a), summaries.get(p.b)];
    const isKnown = ra !== undefined && rb !== undefined && sa !== undefined && sb !== undefined;
    if (!isKnown) continue;
    const isRampMain =
      (ra.cls === "ramp" && rb.cls === "expressway") || (ra.cls === "expressway" && rb.cls === "ramp");
    const isMet = isRampMain && isJoined(sa, sb);
    if (!isMet) continue;
    const [ramp, main, s] = ra.cls === "ramp" ? [p.a, p.b, p.sa] : [p.b, p.a, p.sb];
    const key = `${ramp}|${main}`;
    const entry = byPair.get(key) ?? { ramp, main, stations: [] };
    entry.stations.push({ s, dz: Math.abs(p.dz), levelApart: p.levelApart });
    byPair.set(key, entry);
  }
  const out = new Map<string, { ramp: string; main: string; s: number[] }>();
  for (const [key, e] of byPair) {
    const isForbidden = (x: { dz: number; levelApart: number }) =>
      x.dz > SAME_SURFACE_M && x.dz < x.levelApart;
    const forbidden = e.stations.filter(isForbidden);
    const isNose = forbidden.every((x) => x.dz <= NOSE_MAX_DZ_M);
    const targets = forbidden.filter((x) => !isNose || x.dz > MERGE_GIVEN_UP_DZ_M);
    const isNone = targets.length === 0;
    if (isNone) continue;
    out.set(key, { ramp: e.ramp, main: e.main, s: targets.map((x) => x.s).sort((a, b) => a - b) });
  }
  return out;
}

/**
 * `--ramp-shift <m>` (S6 PR 4 案 A), from a first solve of the whole components (every needed run, so
 * the same whatever the range: PR 4 review C1): per chain, the metres to move each sample of a ramp
 * off its OSM line (horizontal.ts PlanInput.offset, left normal positive) where it lies over the main
 * line it meets at a height difference the rules do not pass or the runtime cannot merge
 * (shiftTargets). Per stretch of those stations (SHIFT_STRETCH_GAP_M apart at most), the ramp moves
 * away from the main line by what parts their carriageways (both half widths and planOverlaps' 0.5 m,
 * less the centre lines' distance as solved, the stretch's most), at most `maxM`, and no farther than
 * the room on that side (PR 4 review W1: a third deck not a level apart from it, a road or railway at
 * the ground it did not lie over, each by both half widths and 0.5 m), easing in and out over
 * RAMP_SHIFT.taperM and to 0 within that of a node held on OSM (a junction or a run's end). Left
 * unmoved (PR 4 review W2, C2): a stretch over which the main line is on both sides (the two cross),
 * one whose most under the tapers is under RAMP_SHIFT.minReach of the amount (it would only stay
 * over, one surface the longer), and two asks on one chain for opposite sides that overlap (31090753
 * between two main lines was pushed across 67152889's centre line). Why not the main line: it carries
 * the through traffic and its other ramps.
 */
export function rampShiftOffsets(
  plan: Plan,
  first: CompileResult,
  objects: readonly CrossObject[],
  maxM: number,
): Map<string, Float64Array> {
  const { taperM, minReach } = RAMP_SHIFT.value;
  const polys = new Map<string, Poly>();
  const polyOf = (id: string) => {
    const known = polys.get(id);
    if (known) return known;
    const p = runPoly(plan.runs.get(id)!);
    polys.set(id, p);
    return p;
  };
  const chunksOf = new Map<string, XwChunk[]>();
  for (const c of first.chunks) chunksOf.set(c.run, [...(chunksOf.get(c.run) ?? []), c]);
  const zOf = (run: string, s: number): number | null => {
    const c = (chunksOf.get(run) ?? []).find(
      (k) => s >= k.st[0] - 1e-6 && s <= k.st[k.st.length - STATION_STRIDE] + 1e-6,
    );
    return c ? surfaceAt(c.st, s).z : null;
  };
  // The nearest point of a polyline to (x, y): distance, half width there, the point and its run distance.
  const nearestOn = (p: Poly, x: number, y: number) => {
    let best = { d: Infinity, hw: 0, px: 0, py: 0, s: 0 };
    for (let i = 0; i + 1 < p.s.length; i++) {
      const [x0, y0, x1, y1] = [p.xy[2 * i], p.xy[2 * i + 1], p.xy[2 * i + 2], p.xy[2 * i + 3]];
      const ex = x1 - x0;
      const ey = y1 - y0;
      const t = Math.min(1, Math.max(0, ((x - x0) * ex + (y - y0) * ey) / (ex * ex + ey * ey || 1)));
      const px = x0 + ex * t;
      const py = y0 + ey * t;
      const d = Math.hypot(x - px, y - py);
      if (d < best.d)
        best = {
          d,
          hw: p.hw[i] + (p.hw[i + 1] - p.hw[i]) * t,
          px,
          py,
          s: p.s[i] + (p.s[i + 1] - p.s[i]) * t,
        };
    }
    return best;
  };
  // What could stand in a moved ramp's way: the written decks and the roads and railways at the ground.
  const CELL = 50;
  const grid = new Map<string, Set<string>>();
  const put = (key: string, x: number, y: number) => {
    const c = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    grid.set(c, (grid.get(c) ?? new Set()).add(key));
  };
  const written = [...new Set(first.chunks.map((c) => c.run))].filter((id) => plan.runs.has(id)).sort();
  for (const id of written) {
    const p = polyOf(id);
    for (let i = 0; i < p.s.length; i++) put(`run:${id}`, p.xy[2 * i], p.xy[2 * i + 1]);
  }
  const objectPolys = new Map<string, { xy: Array<[number, number]> }>();
  for (const o of objects) {
    const xy = o.pts.map(([lon, lat]) => CROSS_PLANE.toXY(lon, lat) as [number, number]);
    const key = `${o.kind}:${o.id}`;
    objectPolys.set(key, { xy });
    for (let i = 0; i + 1 < xy.length; i++) {
      const steps = Math.max(1, Math.ceil(Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]) / 20));
      for (let k = 0; k <= steps; k++)
        put(
          key,
          xy[i][0] + ((xy[i + 1][0] - xy[i][0]) * k) / steps,
          xy[i][1] + ((xy[i + 1][1] - xy[i][1]) * k) / steps,
        );
    }
  }
  const near = (x: number, y: number) => {
    const out = new Set<string>();
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) for (const k of grid.get(`${cx + dx},${cy + dy}`) ?? []) out.add(k);
    return [...out].sort();
  };
  const nearestOnLine = (xy: Array<[number, number]>, x: number, y: number) => {
    let best = { d: Infinity, px: 0, py: 0 };
    for (let i = 0; i + 1 < xy.length; i++) {
      const [x0, y0] = xy[i];
      const [x1, y1] = xy[i + 1];
      const ex = x1 - x0;
      const ey = y1 - y0;
      const t = Math.min(1, Math.max(0, ((x - x0) * ex + (y - y0) * ey) / (ex * ex + ey * ey || 1)));
      const d = Math.hypot(x - (x0 + ex * t), y - (y0 + ey * t));
      if (d < best.d) best = { d, px: x0 + ex * t, py: y0 + ey * t };
    }
    return best;
  };
  const requests = new Map<string, ShiftRequest[]>();
  for (const [, t] of [...shiftTargets(plan, first)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const ramp = plan.runs.get(t.ramp)!;
    const mainPoly = polyOf(t.main);
    const chainS = ramp.align.s;
    const base = chainS[ramp.i0];
    const anchors: number[] = [];
    ramp.chain.nodes.forEach((node, j) => {
      const isHeld = (plan.nodeChains.get(node)?.length ?? 0) > 1 || j === ramp.run.from || j === ramp.run.to;
      if (isHeld) anchors.push(ramp.align.vertexSample[j]);
    });
    const anchorWeight = (i: number) => {
      let w = 1;
      for (const k of anchors) {
        const off = Math.abs(chainS[i] - chainS[k]);
        const isNear = off < taperM;
        if (isNear) w *= (1 - Math.cos((Math.PI * off) / taperM)) / 2;
      }
      return w;
    };
    const stretches: Array<[number, number]> = [];
    for (const s of t.s) {
      const last = stretches[stretches.length - 1];
      const isApart = last === undefined || s - last[1] > SHIFT_STRETCH_GAP_M;
      if (isApart) stretches.push([s, s]);
      else last[1] = s;
    }
    for (const [s0, s1] of stretches) {
      let need = 0;
      const signs = new Set<number>();
      let reach = 0;
      for (let i = sampleAt(ramp, s0); i <= sampleAt(ramp, s1); i++) {
        const [lon, lat] = lonLatAt(ramp, i);
        const [x, y] = CROSS_PLANE.toXY(lon, lat);
        const m = nearestOn(mainPoly, x, y);
        need = Math.max(need, ramp.laneHalfAt[i - ramp.i0] + m.hw + 0.5 - m.d);
        reach = Math.max(reach, anchorWeight(i));
        const a = Math.max(ramp.i0, i - 3);
        const b = Math.min(ramp.i1, i + 3);
        const [ax, ay] = CROSS_PLANE.toXY(...lonLatAt(ramp, a));
        const [bx, by] = CROSS_PLANE.toXY(...lonLatAt(ramp, b));
        const leftward = -(by - ay) * (m.px - x) + (bx - ax) * (m.py - y);
        signs.add(leftward > 0 ? -1 : 1);
      }
      const isCrossing = signs.size > 1;
      const isTooLittle = reach < minReach;
      const isNotNeeded = need <= 0;
      if (isCrossing || isTooLittle || isNotNeeded) continue;
      const sign = [...signs][0] as 1 | -1;
      // The samples the ask covers (tapers included) and each one's weight.
      let i0 = ramp.i1;
      let i1 = ramp.i0;
      const w = new Float64Array(ramp.i1 - ramp.i0 + 1);
      for (let i = ramp.i0; i <= ramp.i1; i++) {
        const s = chainS[i] - base;
        const outside = s < s0 ? s0 - s : s > s1 ? s - s1 : 0;
        if (outside >= taperM) continue;
        w[i - ramp.i0] = ((1 + Math.cos((Math.PI * outside) / taperM)) / 2) * anchorWeight(i);
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
      }
      // The room on that side: what the moved ramp would come over that it does not lie over now.
      let room = Infinity;
      for (let i = i0; i <= i1; i++) {
        const wi = w[i - ramp.i0];
        if (wi <= 1e-6) continue;
        const [lon, lat] = lonLatAt(ramp, i);
        const [x, y] = CROSS_PLANE.toXY(lon, lat);
        const a = Math.max(ramp.i0, i - 3);
        const b = Math.min(ramp.i1, i + 3);
        const [ax, ay] = CROSS_PLANE.toXY(...lonLatAt(ramp, a));
        const [bx, by] = CROSS_PLANE.toXY(...lonLatAt(ramp, b));
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / len) * sign;
        const ny = ((bx - ax) / len) * sign;
        const hwR = ramp.laneHalfAt[i - ramp.i0];
        const zR = zOf(ramp.run.id, chainS[i] - base);
        for (const key of near(x, y)) {
          const isOwn = key === `run:${t.ramp}` || key === `run:${t.main}`;
          if (isOwn) continue;
          const isRun = key.startsWith("run:");
          let d0: number;
          let qx: number;
          let qy: number;
          let half: number;
          if (isRun) {
            const other = key.slice(4);
            const m = nearestOn(polyOf(other), x, y);
            const zO = zOf(other, m.s);
            const isLevelApart = zR !== null && zO !== null && Math.abs(zR - zO) >= LEVEL_APART_M;
            if (isLevelApart) continue;
            [d0, qx, qy, half] = [m.d, m.px, m.py, m.hw];
          } else {
            const m = nearestOnLine(objectPolys.get(key)!.xy, x, y);
            [d0, qx, qy, half] = [m.d, m.px, m.py, GROUND_ROAD_HALF_WIDTH.value];
          }
          const clear = hwR + half + 0.5;
          const isOverAlready = d0 <= clear;
          const isOnThatSide = (qx - x) * nx + (qy - y) * ny > 0;
          if (isOverAlready || !isOnThatSide) continue;
          room = Math.min(room, (d0 - clear) / wi);
        }
      }
      const amount = Math.min(maxM, need, room);
      const isWorthIt = amount > 0.1;
      if (!isWorthIt) continue;
      const list = requests.get(ramp.chain.id) ?? [];
      list.push({ i0, i1, sign, amount, w, base: ramp.i0 });
      requests.set(ramp.chain.id, list);
    }
  }
  const out = new Map<string, Float64Array>();
  for (const [chainId, list] of [...requests].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const anyRun = [...plan.runs.values()].find((rp) => rp.chain.id === chainId)!;
    const offsets = composeShiftRequests(list, anyRun.align.s.length);
    if (offsets) out.set(chainId, offsets);
  }
  return out;
}

/**
 * One chain's asks as its offsets (rampShiftOffsets): two asks for opposite sides over common samples
 * are both left out (PR 4 review C2: a ramp between two main lines), the rest taken at the larger
 * |offset| per sample. Null when none is left.
 */
export function composeShiftRequests(list: readonly ShiftRequest[], samples: number): Float64Array | null {
  const isConflicted = (r: ShiftRequest) =>
    list.some((q) => q !== r && q.sign !== r.sign && q.i0 <= r.i1 && r.i0 <= q.i1);
  const kept = list.filter((r) => !isConflicted(r));
  if (kept.length === 0) return null;
  const offsets = new Float64Array(samples);
  for (const r of kept) {
    for (let i = r.i0; i <= r.i1; i++) {
      const v = r.sign * r.amount * r.w[i - r.base];
      if (Math.abs(v) > Math.abs(offsets[i])) offsets[i] = v;
    }
  }
  return offsets;
}

/**
 * How many stations of a ramp a shift is for (shiftTargets), per ramp, in a solve: what solveWithRampShift
 * compares after the shift.
 */
function targetsPerRamp(plan: Plan, solved: CompileResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of shiftTargets(plan, solved).values()) out.set(t.ramp, (out.get(t.ramp) ?? 0) + t.s.length);
  return out;
}

/** The deck pairs of a run neither one surface nor a level apart in a solve, by partner. */
function forbiddenPartners(solved: CompileResult, run: string): Set<string> {
  const out = new Set<string>();
  for (const o of deckOverlaps(solved.chunks)) {
    if (o.a === run) out.add(o.b);
    if (o.b === run) out.add(o.a);
  }
  return out;
}

/**
 * `--ramp-shift` (S6 PR 4 案 A) end to end, decided on the whole components (every needed run written,
 * whatever the range, PR 4 review C1): solve once, move the ramps (rampShiftOffsets), plan and solve
 * again, and keep a chain's move only if none of its ramps comes out worse (PR 4 review C2): more of
 * its stations a shift is for, a new partner neither one surface nor a level apart, or its main line
 * on a later step of the fallback. The chains that came out worse are planned without their move and
 * the network is solved for the range from that last plan. `prepare` runs before each solve (the DEM
 * for a plan's new samples).
 */
export async function solveWithRampShift(
  planOf: (rampOffsets: ReadonlyMap<string, Float64Array>) => Plan,
  ground: GroundSampler,
  objects: CrossObject[],
  maxM: number,
  options: SolveOptions = {},
  prepare: (plan: Plan) => Promise<void> = async () => {},
): Promise<{ plan: Plan; result: CompileResult; moved: string[]; dropped: string[] }> {
  const whole = (p: Plan): Plan => ({ ...p, wanted: new Set(p.needed) });
  const plan0 = planOf(new Map());
  await prepare(plan0);
  const first = solvePlan(whole(plan0), ground, objects, options);
  const offsets = rampShiftOffsets(plan0, first, objects, maxM);
  const plan1 = planOf(offsets);
  await prepare(plan1);
  const second = solvePlan(whole(plan1), ground, objects, options);
  const before = targetsPerRamp(plan0, first);
  const after = targetsPerRamp(plan1, second);
  const stepsOf = (r: CompileResult) => new Map(r.runs.map((x) => [x.id, x.steps.length]));
  const [steps0, steps1] = [stepsOf(first), stepsOf(second)];
  const dropped: string[] = [];
  for (const chainId of [...offsets.keys()].sort()) {
    const ramps = [...plan1.runs.values()].filter((rp) => rp.chain.id === chainId && rp.cls === "ramp");
    const isWorse = ramps.some((rp) => {
      const id = rp.run.id;
      const isMoreTargets = (after.get(id) ?? 0) > (before.get(id) ?? 0);
      const was = forbiddenPartners(first, id);
      const isNewPartner = [...forbiddenPartners(second, id)].some((p) => !was.has(p));
      const mains = [...shiftTargets(plan0, first).values()].filter((t) => t.ramp === id).map((t) => t.main);
      const isMainLater = mains.some((m) => (steps1.get(m) ?? 0) > (steps0.get(m) ?? 0));
      return isMoreTargets || isNewPartner || isMainLater;
    });
    if (isWorse) dropped.push(chainId);
  }
  const kept = new Map([...offsets].filter(([chainId]) => !dropped.includes(chainId)));
  const plan = planOf(kept);
  await prepare(plan);
  const result = solvePlan(plan, ground, objects, options);
  return { plan, result, moved: [...kept.keys()].sort(), dropped };
}

export function solvePlan(
  given: Plan,
  ground: GroundSampler,
  objects: CrossObject[],
  options: SolveOptions = {},
): CompileResult {
  // The option over the plan's (a copy, so the plan given stays as it was planned).
  const wantsHeight =
    (options.structures ?? (given.structures === "height" ? "height" : "tags")) === "height";
  const isAsPlanned = wantsHeight === (given.structures === "height");
  const { structures: _planned, ...rest } = given;
  const plan: Plan = isAsPlanned ? given : wantsHeight ? { ...rest, structures: "height" } : rest;
  const diagnostics = [...plan.diagnostics];
  const objectPolys = objects.map((o) => {
    const poly = objectPoly(o);
    return { o, poly, box: bboxOf(poly) };
  });
  const solved = new Map<string, Solved>();
  const failed = new Set<string>();
  const stats: SolveStats = {
    components: 0,
    largestRuns: 0,
    largestVariables: 0,
    solves: 0,
    iterations: 0,
    qpMs: 0,
    unconverged: 0,
    retried: 0,
  };
  const { heightAt, blockHeightAt, partition } = plan.partition
    ? solveBlocks(plan, plan.partition, ground, objectPolys, diagnostics, solved, failed, stats, options)
    : solveComponents(
        plan,
        ground,
        objectPolys,
        diagnostics,
        solved,
        failed,
        stats,
        options.objective ?? OBJECTIVE_V1,
      );
  // A run whose junction parent is not in the data would end in the air: left out, and reported.
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...solved.keys()].sort()) {
      const s = solved.get(id)!;
      const lost = [s.start, s.end].find(
        (e) => e.parent !== undefined && heightAt(e.parent, e.parentS ?? 0) === null,
      );
      if (!lost) continue;
      solved.delete(id);
      failed.add(id);
      diagnostics.push({ run: id, kind: "parent_unsolved", detail: `parent ${lost.parent}`, allowed: false });
      changed = true;
    }
  }
  for (const s of solved.values()) {
    const isFallback = s.steps[0] !== "standard";
    if (isFallback)
      diagnostics.push({
        run: s.rp.run.id,
        kind: "vertical_fallback",
        detail: s.steps.join(">") + ` V${Math.max(...s.zones.map((z) => z.V))}`,
        allowed: false,
      });
  }
  // A road taken as blocked from the climb a ground end allows, which the solved deck clears after
  // all (the joint QP lifted it for another coupling: a deck over it, a seam out of a tunnel, P9), is
  // a crossing like any other: kept for T4 with its clearance, and no longer reported or closed.
  // Cleared means over the whole width the road takes along the deck (its lowest point there), not
  // only at the crossing's centre line.
  const cleared = new Set<XwDiagnostic>();
  const isHeight = plan.structures === "height";
  // A height build takes a clearance a thinner girder meets (chunkRun thins it) as cleared too.
  for (const s of solved.values()) {
    const kept: BlockedRoad[] = [];
    const give = isHeight && s.rp.over === null ? GIRDER_GIVE_M : 0;
    for (const b of s.blocked) {
      const isClear =
        lowestOver(s, b.s - b.halfWindow, b.s + b.halfWindow, s.rp.length) - b.top >= b.need - give;
      if (!isClear) {
        kept.push(b);
        continue;
      }
      s.cross.push(b.s, b.top, b.need);
      const label = /^(\S+ \d+)/.exec(b.diagnostic.detail)?.[1] ?? "road";
      s.crossInfo?.push({ label, halfWindow: b.halfWindow, near: true });
      cleared.add(b.diagnostic);
    }
    s.blocked = kept;
  }
  for (let i = diagnostics.length - 1; i >= 0; i--) if (cleared.has(diagnostics[i])) diagnostics.splice(i, 1);
  const heightRules: HeightRuleTally = { spanned: 0, sameApart: 0, unanchored: 0 };
  if (isHeight)
    for (const s of solved.values()) structuresByHeight(plan, s, ground, diagnostics, solved, heightRules);
  // Deck-over-deck crossings, recorded on the upper run once both are solved (for T4). The lower one
  // is read where it is solved (with blocks, the piece holding the crossing, in the upper's block).
  for (const c of plan.crossings) {
    const up = solved.get(c.upper);
    const low = blockHeightAt(c.lower, c.sLower);
    if (!up || !low) continue;
    up.cross.push(c.sUpper, low.z, ROAD_CLEAR);
  }
  const chunks: XwChunk[] = [];
  const runs: XwRunSummary[] = [];
  const features: Record<string, RunFeatures> = {};
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
    features[id] = runFeatures(s.rp);
    const runChunks = chunkRun(plan, s, ground, objectPolys, blockHeightAt);
    const structure = over ? structureCheck(over, runChunks) : null;
    chunks.push(...runChunks);
    runs.push({
      id,
      chain: s.rp.chain.id,
      cls: s.rp.cls,
      ref: s.rp.ref,
      lengthM: roundTo(s.rp.length, 2),
      V: Math.max(...s.zones.map((z) => z.V)),
      tagV: s.rp.tagV,
      planV: s.rp.planV,
      minRadiusM: roundTo(Math.min(s.rp.minRadius, 1e6), 1),
      maxShiftM: roundTo(s.rp.align.maxShiftM, 3),
      ...rampShiftOf(plan, s.rp),
      steps: s.steps,
      start: s.start,
      end: s.end,
      chunks: runChunks.map((c) => c.id),
      structure,
      // A height build says which runs are below runs by their tags (review W5: a viaduct-tagged run
      // all cut looked like one); a build by the tags leaves it out (its files as before).
      ...(isHeight && s.rp.below ? { below: true as const } : {}),
      ...(isHeight && s.rp.ground ? { ground: true as const } : {}),
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
  const closed: XwClosed[] = [];
  for (const id of [...plan.wanted].sort()) {
    if (solved.has(id)) continue;
    const why = diagnostics.find((d) => d.run === id && CLOSING_KINDS.includes(d.kind));
    const rp = plan.runs.get(id)!;
    closed.push({ run: id, chain: rp.chain.id, cls: rp.cls, reason: why?.kind ?? "vertical_unsolved" });
  }
  // The runs at grade's targets (S6 PR 7a: what the scorecard's openEnds and inner measure from).
  const objectiveOf = options.objective ?? OBJECTIVE_V1;
  const reachOf = objectiveOf.kind === "v2" ? objectiveOf.reachM.viaduct : DESIGN_GROUND_REACH.value.viaduct;
  const groundTargets = new Map<
    string,
    { stations: Float64Array; ground: Float64Array; target: Float64Array }
  >();
  for (const r of runs) {
    const rp = plan.runs.get(r.id);
    const isAtGrade = rp?.ground === true;
    if (!isAtGrade) continue;
    const line = groundTargetOf(plan, rp, ground, reachOf);
    groundTargets.set(r.id, line);
    // The fit the ledger's ground-stretch judges (S6 PR 7a, 4.3), on the run's summary.
    const s = solved.get(r.id);
    if (s === undefined) continue;
    r.groundFit = groundFitOf(
      line.stations,
      line.target,
      (sv) => evalRun(s, sv).z,
      groundApproaches(plan, rp),
    );
  }
  return {
    chunks,
    runs,
    closed,
    diagnostics,
    stats,
    features,
    partition,
    groundTargets,
    ...(isHeight ? { heightRules } : {}),
  };
}

/**
 * `heightAt`: where a run stands, for the runs hanging from it (null once it is closed anywhere).
 * `blockHeightAt`: where a run stands as the block of the point solved it, for what is written
 * over it (crossings, piers over a deck): with blocks, a piece's own block decides, not whether
 * some other piece of its run, in a block another range may not solve, failed (T8). For
 * components the two are the same.
 */
type Solving = { heightAt: HeightAt; blockHeightAt: HeightAt; partition: PartitionResult };

/** Each needed component in one QP through solveShedding (the default, `components`). */
function solveComponents(
  plan: Plan,
  ground: GroundSampler,
  objectPolys: ObjectPoly[],
  diagnostics: XwDiagnostic[],
  solved: Map<string, Solved>,
  failed: Set<string>,
  stats: SolveStats,
  objective: Objective,
): Solving {
  const neededComponents = [...new Set(plan.needed.map((id) => plan.componentOf.get(id)!))].sort();
  const blocks: BlockSummary[] = [];
  for (const cid of neededComponents) {
    const ids = plan.components.get(cid)!;
    const res = solveShedding(plan, ids, ground, objectPolys, diagnostics, objective);
    for (const [id, parent] of res.orphaned) {
      failed.add(id);
      diagnostics.push({ run: id, kind: "parent_unsolved", detail: `parent ${parent}`, allowed: false });
    }
    stats.components++;
    stats.largestRuns = Math.max(stats.largestRuns, res.stats.largestRuns);
    stats.largestVariables = Math.max(stats.largestVariables, res.stats.largestVariables);
    stats.solves += res.stats.solves;
    stats.iterations += res.stats.iterations;
    stats.qpMs += res.stats.qpMs;
    stats.unconverged += res.stats.unconverged;
    stats.retried += res.stats.retried;
    for (const [id, s] of res.solved) solved.set(id, s);
    for (const [key, p] of res.sunk) diagnostics.push(sunkDiagnostic(key.split("|")[0], p, p.s));
    for (const [id, attempts] of res.unsolved) {
      failed.add(id);
      diagnostics.push({
        run: id,
        kind: "vertical_unsolved",
        detail: attemptsText(attempts),
        allowed: false,
      });
    }
    blocks.push({
      id: cid,
      pieces: ids.length,
      runs: ids.length,
      variables: res.stats.largestVariables,
      canonical: canonicalOf(ids, (id) => [0, plan.runs.get(id)!.length], res),
      members: [...ids].sort(),
    });
  }
  const heightAt: HeightAt = (run, s) => {
    const done = solved.get(run);
    return done ? evalRun(done, s) : null;
  };
  return {
    heightAt,
    blockHeightAt: heightAt,
    partition: {
      mode: "components",
      quietFactor: null,
      quietMinM: null,
      anchors: [],
      pieces: plan.needed.length,
      neededBlocks: neededComponents.length,
      routeSolves: 0,
      anchorsNearProblems: 0,
      joins: { dz: 0, dGrade: 0, dBank: 0 },
      blocks,
    },
  };
}

/** The diagnostic of a solved run's worst miss of an assumed floor, at run distance s. */
function sunkDiagnostic(run: string, p: RunProblem, s: number): XwDiagnostic {
  const isSunk = p.what === "sunk";
  return {
    run,
    kind: isSunk ? "deck_below_ground" : "below_open_ground_floor",
    detail: isSunk
      ? `${p.by.toFixed(2)} m under the assumed floor (DEM − ${DEM_SINK_FLOOR.value} m) at ${Math.round(s)} m, near a low end`
      : `${p.by.toFixed(2)} m under the open-ground floor (${OPEN_OVER_GROUND} m) at ${Math.round(s)} m`,
    allowed: false,
  };
}

/** An anchor's value from the route solution: both pieces beside it are held to it. */
type AnchorValue = { z: number; grade: number; bank: number };

/**
 * A piece's part of its run's setup (blocks.ts): the run's stations inside the piece, moved to start
 * at 0, and one station at each anchor end (target interpolated, no floor or ceiling there: the
 * anchor holds it). The run's ends keep their own conditions; an anchor end takes `anchorEnd`. Why
 * cut the run's setup and not set the piece up on its own: the floors near low ends, the climbs and
 * the ±60 m target average are the run's (a piece set up alone would see a low end at its anchor),
 * and the setup's diagnostics give run distances.
 */
function pieceSetup(
  run: RunSetup,
  rp: RunPlan,
  info: PieceInfo,
  isLast: boolean,
  ends: [EndPlan, EndPlan],
  anchorEnd: (side: 0 | 1) => RunInput["start"],
): RunSetup {
  const isFirst = info.k === 0;
  const isWhole = isFirst && isLast;
  if (isWhole) return { ...run, ends };
  const n = run.stations.length;
  const TOL = 1e-6;
  const find = (sv: number) => {
    for (let k = 0; k < n; k++) if (Math.abs(run.stations[k] - sv) <= TOL) return k;
    return -1;
  };
  const targetAt = (sv: number) => {
    let k = 0;
    while (k < n - 2 && run.stations[k + 1] < sv) k++;
    const s0 = run.stations[k];
    const s1 = run.stations[k + 1];
    const t = (sv - s0) / (s1 - s0 || 1);
    return run.target[k] + (run.target[k + 1] - run.target[k]) * t;
  };
  const b = isLast ? run.rp.length : info.b;
  const rows: Array<{ s: number; k: number }> = [{ s: info.a, k: isFirst ? 0 : find(info.a) }];
  for (let k = 0; k < n; k++) {
    const sv = run.stations[k];
    const isInside = sv > info.a + TOL && sv < b - TOL;
    if (isInside) rows.push({ s: sv, k });
  }
  rows.push({ s: b, k: isLast ? n - 1 : find(b) });
  const last = rows.length - 1;
  const pick = (from: Float64Array, fill: number) =>
    Float64Array.from(rows, (r) => (r.k >= 0 ? from[r.k] : fill));
  return {
    rp,
    stations: Float64Array.from(rows, (r, i) => (i === 0 ? 0 : i === last ? rp.length : r.s - info.a)),
    target: Float64Array.from(rows, (r) => (r.k >= 0 ? run.target[r.k] : targetAt(r.s))),
    lower: pick(run.lower, -Infinity),
    lowerAtCrossings: pick(run.lowerAtCrossings, -Infinity),
    lowerLaw: pick(run.lowerLaw, -Infinity),
    lowerOpen: pick(run.lowerOpen, -Infinity),
    upper: pick(run.upper, Infinity),
    fixed: [isFirst ? run.fixed[0] : anchorEnd(0), isLast ? run.fixed[1] : anchorEnd(1)],
    ends,
    groundZ: [isFirst ? run.groundZ[0] : null, isLast ? run.groundZ[1] : null],
    cross: [],
    crossInfo: [],
    blocked: [],
    ...inputWeights(run),
  };
}

/** One seam group's route solution (P2.7-2 4.4): profiles and banks of its pieces, and the anchors' values. */
export type RouteSolution = {
  group: string[];
  profiles: Map<string, VerticalProfile>;
  banks: Map<string, Float64Array>;
  /** By the piece after each anchor. */
  values: Map<string, AnchorValue>;
  problems: Map<string, RunProblem[]>;
  qpMs: number;
};

/**
 * The route solution of a seam group (runs end to end in one chain, not cut by the ground): its
 * pieces in one solveJoint, joined only by the seams and, at each anchor, the piece after it
 * following the one before it (hard). Standard step; the runs' own floors, the statute's crossings,
 * ground ends and structure pins, but no junction, crossing or deck pair with another run. On the
 * pieces' own knots, so each piece's part of it is a feasible point of that piece's problem in its
 * block, and the objective splits at the anchors (I2). The anchor's value is the piece before it at
 * its end after finish, in full double precision. Banks in two passes: the first follows the piece
 * before each anchor to get the value, the second holds both sides at it, as the blocks do.
 */
function solveRoute(part: BlockPartition, group: string[], setups: Map<string, RunSetup>): RouteSolution {
  const pp = part.pieces;
  const ids = group.flatMap((run) => part.piecesOf.get(run)!.map((p) => p.id));
  const members = new Set(ids);
  const prevOf = new Map<string, string>();
  for (const run of group) {
    const list = part.piecesOf.get(run)!;
    for (let k = 1; k < list.length; k++) prevOf.set(list[k].id, list[k - 1].id);
  }
  const setupOf = new Map<string, RunSetup>();
  for (const id of ids) {
    const info = part.pieceInfo.get(id)!;
    const isLast = info.k === part.piecesOf.get(info.run)!.length - 1;
    const ends = pp.ends!.get(id)!;
    setupOf.set(
      id,
      pieceSetup(setups.get(info.run)!, pp.runs.get(id)!, info, isLast, ends, () => ({})),
    );
  }
  const inputs: RunInput[] = ids.map((id) => {
    const st = setupOf.get(id)!;
    return {
      id,
      length: st.rp.length,
      zones: st.rp.zones,
      special: false,
      stations: st.stations,
      target: st.target,
      lower: st.lower,
      lowerLaw: st.lowerLaw,
      lowerOpen: st.lowerOpen,
      assumedGive: false,
      upper: st.upper,
      start: st.fixed[0],
      end: st.fixed[1],
      pins: profilePins(st.rp),
      ...inputWeights(st),
    };
  });
  const couplings: Coupling[] = [];
  for (const id of [...ids].sort()) {
    pp.ends!.get(id)!.forEach((e, side) => {
      const isSeam = e.kind === "seam" && members.has(e.parent);
      if (!isSeam) return;
      const parent = { run: e.parent, s: nodeS(pp.runs.get(e.parent)!, e.parentNodeIndex) };
      couplings.push({ kind: "junction", child: id, atStart: side === 0, parent });
    });
    const prev = prevOf.get(id);
    if (prev === undefined) continue;
    const parent = { run: prev, s: pp.runs.get(prev)!.length };
    couplings.push({ kind: "junction", child: id, atStart: true, parent, hard: true });
  }
  const started = performance.now();
  const res = solveJoint(inputs, couplings);
  const qpMs = performance.now() - started;
  const isConverged = res.status === "converged";
  if (!isConverged) throw new RouteUnsolvedError(group, `${res.status} after ${res.iterations} iterations`);
  const values = new Map<string, AnchorValue>();
  for (const [id, prev] of prevOf) {
    const v = evalProfile(res.profiles.get(prev)!, pp.runs.get(prev)!.length);
    values.set(id, { z: v.z, grade: v.grade, bank: 0 });
  }
  const after = new Map([...prevOf].map(([id, prev]) => [id, [prev]]));
  const followed = banksOf(pp, ids, res.profiles, setupOf, {
    after,
    bankAt: (id, side, done) => {
      const prev = side === 0 ? prevOf.get(id) : undefined;
      const bank = prev === undefined ? undefined : done.get(prev);
      return bank === undefined ? null : bank[bank.length - 1];
    },
  });
  for (const [id, prev] of prevOf) {
    const bank = followed.get(prev)!;
    values.get(id)!.bank = bank[bank.length - 1];
  }
  const banks = banksOf(pp, ids, res.profiles, setupOf, { bankAt: anchorBankAt(part, values) });
  return { group, profiles: res.profiles, banks, values, problems: res.problems, qpMs };
}

/** The bank at a piece's anchor end: the anchor's value (both pieces beside it hold it). */
function anchorBankAt(
  part: BlockPartition,
  values: Map<string, AnchorValue>,
): (id: string, side: number) => number | null {
  return (id, side) => {
    const info = part.pieceInfo.get(id)!;
    const after = side === 0 ? id : part.piecesOf.get(info.run)![info.k + 1]?.id;
    return after === undefined ? null : (values.get(after)?.bank ?? null);
  };
}

/**
 * Each needed run's constraint stations and the target its setup aims at under `objective` (the
 * tests of P2.7-3 read where v1 and v2 put it). Why a function of its own and not the RunSetup: the
 * setup carries the floors and couplings' inputs too, which no caller outside should lean on.
 */
export function runTargets(
  plan: Plan,
  ground: GroundSampler,
  objects: CrossObject[],
  objective: Objective,
): Map<string, { stations: Float64Array; target: Float64Array }> {
  const objectPolys = objects.map((o) => {
    const poly = objectPoly(o);
    return { o, poly, box: bboxOf(poly) };
  });
  const out = new Map<string, { stations: Float64Array; target: Float64Array }>();
  for (const id of plan.needed) {
    const st = setupRun(plan, plan.runs.get(id)!, ground, objectPolys, [], objective);
    out.set(id, { stations: st.stations, target: st.target });
  }
  return out;
}

/** The route solutions of the seam groups the needed blocks' anchors are on (I2's test reads them). */
export function solveRoutes(
  plan: Plan,
  ground: GroundSampler,
  objects: CrossObject[],
  options: SolveOptions = {},
): RouteSolution[] {
  const part = plan.partition;
  if (!part) return [];
  const objectPolys = objects.map((o) => {
    const poly = objectPoly(o);
    return { o, poly, box: bboxOf(poly) };
  });
  const setups = new Map(
    plan.needed.map((id) => [
      id,
      setupRun(plan, plan.runs.get(id)!, ground, objectPolys, [], options.objective ?? OBJECTIVE_V1),
    ]),
  );
  return part.routeGroups.map((group) => solveRoute(part, group, setups));
}

/** A run's end as written: a piece's end moved back onto the runs (the parent's run, run distance). */
function runEnd(plan: Plan, rp: RunPlan, atStart: boolean, end: XwEnd): XwEnd {
  const isJoined = end.parent !== undefined;
  if (!isJoined) return end;
  const e = endPlan(plan, rp, atStart);
  const isParent = e.kind === "junction" || e.kind === "seam";
  if (!isParent) return end;
  return {
    ...end,
    parent: e.parent,
    parentS: roundTo(nodeS(plan.runs.get(e.parent)!, e.parentNodeIndex), 2),
  };
}

/**
 * A run put back together from its solved pieces: the profile as the pieces in order, the zones end
 * to end (one zone across an anchor with the same speed on both sides), the bank sample by sample
 * (the anchor's sample once), the steps of the piece that went furthest down its ladder, its ends,
 * and its crossings and blocked roads (run distances, from the run's setup).
 */
function stitch(
  plan: Plan,
  rp: RunPlan,
  list: PieceInfo[],
  parts: Solved[],
  levels: number[],
  setup: RunSetup,
): Solved {
  const pieces = parts.map((p, k) => ({ a: list[k].a, b: list[k].b, profile: p.profile }));
  const zones: Zone[] = [];
  parts.forEach((p, k) => {
    for (const z of p.profile.zones) {
      const last = zones[zones.length - 1];
      const isSame = last !== undefined && last.V === z.V;
      if (isSame) last.to = z.to + list[k].a;
      else zones.push({ from: z.from + list[k].a, to: z.to + list[k].a, V: z.V });
    }
  });
  zones[0].from = 0;
  zones[zones.length - 1].to = rp.length;
  const bank = new Float64Array(rp.i1 - rp.i0 + 1);
  let at = 0;
  parts.forEach((p, k) => {
    const from = k === 0 ? 0 : 1;
    bank.set(p.bank.subarray(from), at);
    at += p.bank.length - from;
  });
  let deepest = 0;
  levels.forEach((l, k) => {
    if (l > levels[deepest]) deepest = k;
  });
  return {
    rp,
    profile: parts[0].profile,
    pieces,
    zones,
    steps: parts[deepest].steps,
    bank,
    start: runEnd(plan, rp, true, parts[0].start),
    end: runEnd(plan, rp, false, parts[parts.length - 1].end),
    cross: [...setup.cross],
    crossInfo: [...setup.crossInfo],
    blocked: [...setup.blocked],
  };
}

/**
 * `--partition blocks` (P2.7-2): each run set up once (its diagnostics once, in id order), the route
 * solutions for the anchors' values, then each needed block in id order through the same
 * solveShedding as a component, its pieces cut from their runs' setups and held at the anchors. A
 * run is closed when any of its pieces is (one vertical_unsolved, each failed piece's attempts with
 * its range), and written once all its pieces are solved, put back together (stitch). The blocks of
 * other runs are left as they are: a run hanging from a closed one is closed by solvePlan's chain.
 */
function solveBlocks(
  plan: Plan,
  part: BlockPartition,
  ground: GroundSampler,
  objectPolys: ObjectPoly[],
  diagnostics: XwDiagnostic[],
  solved: Map<string, Solved>,
  failed: Set<string>,
  stats: SolveStats,
  options: SolveOptions,
): Solving {
  const pp = part.pieces;
  const limit = options.maxBlockVariables ?? BLOCK_MAX_VARIABLES;
  const objective = options.objective ?? OBJECTIVE_V1;
  const runOf = (id: string) => part.pieceInfo.get(id)!.run;
  const inBlocks = new Set(part.neededBlocks.flatMap((b) => pp.components.get(b)!));
  const blockRuns = new Set([...inBlocks].map(runOf));
  const setups = new Map<string, RunSetup>();
  // A run only a route solution needs is not written: its setup's diagnostics are not the build's.
  const unwritten: XwDiagnostic[] = [];
  for (const id of plan.needed) {
    const into = blockRuns.has(id) ? diagnostics : unwritten;
    setups.set(id, setupRun(plan, plan.runs.get(id)!, ground, objectPolys, into, objective));
  }
  const values = new Map<string, AnchorValue>();
  let routeSolves = 0;
  let near = 0;
  for (const group of part.routeGroups) {
    const route = solveRoute(part, group, setups);
    routeSolves++;
    stats.qpMs += route.qpMs;
    for (const [id, v] of route.values) values.set(id, v);
    for (const a of part.anchors) {
      // The same anchors as the scorecard lists (those of runs the blocks solve).
      const isListed = group.includes(a.run) && blockRuns.has(a.run);
      if (!isListed) continue;
      const isNear = part.piecesOf
        .get(a.run)!
        .some((p) => (route.problems.get(p.id) ?? []).some((q) => Math.abs(p.a + q.s - a.s) <= a.q));
      if (isNear) near++;
    }
  }
  const pieceSetups = new Map<string, RunSetup>();
  const setupOf = (id: string): RunSetup => {
    const cached = pieceSetups.get(id);
    if (cached) return cached;
    const info = part.pieceInfo.get(id)!;
    const list = part.piecesOf.get(info.run)!;
    const isLast = info.k === list.length - 1;
    const anchorEnd = (side: 0 | 1): RunInput["start"] => {
      const after = side === 0 ? id : list[info.k + 1].id;
      const v = values.get(after)!;
      return { z: v.z, grade: v.grade, hard: true };
    };
    const ends = pp.ends!.get(id)!;
    const st = pieceSetup(setups.get(info.run)!, pp.runs.get(id)!, info, isLast, ends, anchorEnd);
    pieceSetups.set(id, st);
    return st;
  };
  const pieceSolved = new Map<string, Solved>();
  const pieceUnsolved = new Map<string, VerticalAttempt[]>();
  const orphanOf = new Map<string, string>();
  const pieceLevel = new Map<string, number>();
  const pieceSunk = new Map<string, RunProblem>();
  const blocks: BlockSummary[] = [];
  const anchorBanks: AnchorBanks = { bankAt: anchorBankAt(part, values) };
  for (const bid of part.neededBlocks) {
    const ids = pp.components.get(bid)!;
    const variables = blockVariables(pp, ids);
    const isTooLarge = variables > limit;
    if (isTooLarge) throw new BlockTooLargeError(bid, variables, [...new Set(ids.map(runOf))].sort(), limit);
    const local: XwDiagnostic[] = [];
    const res = solveShedding(pp, ids, ground, objectPolys, local, objective, setupOf, anchorBanks);
    for (const d of local) diagnostics.push({ ...d, run: runOf(d.run) });
    stats.components++;
    stats.largestRuns = Math.max(stats.largestRuns, res.stats.largestRuns);
    stats.largestVariables = Math.max(stats.largestVariables, res.stats.largestVariables);
    stats.solves += res.stats.solves;
    stats.iterations += res.stats.iterations;
    stats.qpMs += res.stats.qpMs;
    stats.unconverged += res.stats.unconverged;
    stats.retried += res.stats.retried;
    for (const [id, s] of res.solved) pieceSolved.set(id, s);
    for (const [id, a] of res.unsolved) pieceUnsolved.set(id, a);
    for (const [id, parent] of res.orphaned) orphanOf.set(id, parent);
    for (const [id, l] of res.levels) pieceLevel.set(id, l);
    for (const [key, p] of res.sunk) pieceSunk.set(key, p);
    const range = (id: string): [number, number] => {
      const info = part.pieceInfo.get(id)!;
      return [info.a, info.b];
    };
    blocks.push({
      id: bid,
      pieces: ids.length,
      runs: new Set(ids.map(runOf)).size,
      variables: res.stats.largestVariables,
      canonical: canonicalOf(ids, range, res),
      members: [...new Set(ids.map(runOf))].sort(),
    });
  }
  for (const run of [...blockRuns].sort()) {
    const list = part.piecesOf.get(run)!;
    const tried = list.filter((p) => inBlocks.has(p.id));
    const isCut = list.length > 1;
    const lost = tried.filter((p) => pieceUnsolved.has(p.id));
    if (lost.length > 0) {
      failed.add(run);
      const range = (p: PieceInfo) => (isCut ? `[${p.a.toFixed(0)}–${p.b.toFixed(0)} m] ` : "");
      diagnostics.push({
        run,
        kind: "vertical_unsolved",
        detail: lost.map((p) => range(p) + attemptsText(pieceUnsolved.get(p.id)!)).join(" || "),
        allowed: false,
      });
      continue;
    }
    const orphan = tried.find((p) => orphanOf.has(p.id));
    if (orphan) {
      failed.add(run);
      const parent = runOf(orphanOf.get(orphan.id)!);
      diagnostics.push({ run, kind: "parent_unsolved", detail: `parent ${parent}`, allowed: false });
      continue;
    }
    for (const what of ["sunk", "floor"] as const) {
      let worst: { p: RunProblem; s: number } | null = null;
      for (const piece of tried) {
        const p = pieceSunk.get(`${piece.id}|${what}`);
        const isWorse = p !== undefined && (worst === null || p.by > worst.p.by);
        if (isWorse) worst = { p, s: piece.a + p.s };
      }
      if (worst) diagnostics.push(sunkDiagnostic(run, worst.p, worst.s));
    }
    const isWhole = tried.length === list.length;
    if (!isWhole) continue;
    const parts = list.map((p) => pieceSolved.get(p.id)!);
    const levels = list.map((p) => pieceLevel.get(p.id) ?? 0);
    solved.set(run, stitch(plan, plan.runs.get(run)!, list, parts, levels, setups.get(run)!));
  }
  const heightAt: HeightAt = (run, s) => {
    const whole = solved.get(run);
    if (whole) return evalRun(whole, s);
    const isClosed = failed.has(run);
    const list = part.piecesOf.get(run);
    if (isClosed || !list) return null;
    const p = pieceAt(list, s);
    const done = pieceSolved.get(p.id);
    return done ? evalProfile(done.profile, s - p.a) : null;
  };
  const blockHeightAt: HeightAt = (run, s) => {
    const list = part.piecesOf.get(run);
    if (!list) return null;
    const p = pieceAt(list, s);
    const done = pieceSolved.get(p.id);
    return done ? evalProfile(done.profile, s - p.a) : null;
  };
  const joins = { dz: 0, dGrade: 0, dBank: 0 };
  for (const a of part.anchors) {
    const list = part.piecesOf.get(a.run)!;
    const left = pieceSolved.get(list[a.k].id);
    const right = pieceSolved.get(list[a.k + 1].id);
    if (!left || !right) continue;
    const l = evalProfile(left.profile, left.rp.length);
    const r = evalProfile(right.profile, 0);
    joins.dz = Math.max(joins.dz, Math.abs(l.z - r.z));
    joins.dGrade = Math.max(joins.dGrade, Math.abs(l.grade - r.grade));
    joins.dBank = Math.max(joins.dBank, Math.abs(left.bank[left.bank.length - 1] - right.bank[0]));
  }
  const blockOf = (run: string, k: number) => pp.componentOf.get(part.piecesOf.get(run)![k].id)!;
  const anchors = part.anchors
    .filter((a) => blockRuns.has(a.run))
    .map((a) => {
      const after = part.piecesOf.get(a.run)![a.k + 1].id;
      const v = values.get(after)!;
      return {
        run: a.run,
        s: roundTo(a.s, 2),
        q: roundTo(a.q, 1),
        z: roundTo(v.z, 3),
        grade: roundTo(v.grade, 5),
        blocks: [blockOf(a.run, a.k), blockOf(a.run, a.k + 1)] as [string, string],
      };
    });
  return {
    heightAt,
    blockHeightAt,
    partition: {
      mode: "blocks",
      quietFactor: part.quietFactor,
      quietMinM: part.quietMinM,
      anchors,
      pieces: inBlocks.size,
      neededBlocks: part.neededBlocks.length,
      routeSolves,
      anchorsNearProblems: near,
      joins,
      blocks,
    },
  };
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
function headingAt(rp: RunPlan, s: number, isAcross = false): number {
  // `isAcross` (runs at grade, S6 PR 2): the chain's samples past the run's ends too, and the run's last
  // sample at its end, so both runs at a seam take the same samples (review W1: up to 0.237 rad apart
  // where a seam lies in a curve, each cut at its own end).
  const isEnd = isAcross && s >= rp.length - 1e-9;
  const i = isEnd ? rp.i1 : sampleAt(rp, s);
  const last = rp.align.s.length - 1;
  const a = isAcross ? Math.max(0, i - 3) : Math.max(rp.i0, i - 3);
  const b = isAcross ? Math.min(last, i + 3) : Math.min(rp.i1, i + 3);
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
  // A plan station this close to a station that must stay (the ends, a knot) only shortens the
  // interval beside it, where the file's rounding weighs most on the surface's grade (P2.7-5 4.2).
  const kept = [a, b, ...knots];
  const isNeeded = (sv: number) => kept.includes(sv);
  const isCrowding = (sv: number) => !isNeeded(sv) && kept.some((k) => Math.abs(sv - k) < MIN_STATION_GAP_M);
  return out
    .filter((sv) => !isCrowding(sv))
    .sort((p, q) => p - q)
    .filter((v, i, arr) => i === 0 || v - arr[i - 1] > 1e-6);
}

/**
 * A plan station closer than this to a station that must stay (a chunk's end, a knot) is left out
 * (P2.7-5 4.2). The plan chord then spans up to the step plus this (8 m on the tightest curves,
 * where the step is 5 m: the sagitta 3 cm grows to 8 cm), as KNOT_SNAP_M's move already allowed.
 */
export const MIN_STATION_GAP_M = 3;

/**
 * How a station is written: z to 3 decimals at the station's own run distance, as before (`atS`
 * false), or, where an interval beside it is short and its grade near the limit, z (and the grade)
 * taken at the run distance as written (1 cm) and z to 4 or 5 decimals. Why: the surface between
 * two stations is the Hermite of their written s, z and grade (profile.ts), whose grade inside the
 * interval moves by 1.5× the chord's error; z to 1 mm and s to 1 cm over a 2–4 m interval at
 * 4.975 % (GRADE_MARGIN × 5 %) wrote a chord of 5.000 % and a surface of 5.0125 % (T2 over the 5 %
 * limit, P2.7-3: 45248411:23, 24636451:0, 28127108:37). Taken at the written s, the chord carries
 * no error of s at all, and z's digits make the rest small.
 * Why not s to more digits instead: a junction's end (parentS, 1 cm) must find the parent's chunk
 * end at its s (expresswayRoads.ts joins them within 1 mm), and 4848762:33 at 2831.362 lost its
 * diverge to 4848889 (P2.7-5). Why not finer digits everywhere: every tile grows for intervals that
 * have the headroom anyway; nor a lower GRADE_MARGIN: it moves every run's solution and can close a
 * climb that just fits; nor a chunk boundary moved onto a knot beside it: which knots change the
 * curvature is the solution's to say, so the chunks would no longer be the same whichever way a run
 * is solved (blocks' I3, tests/expresswayBlocks.test.ts) and a rebuild could move their ids.
 */
export const STATION_DIGITS: ReadonlyArray<{ z: number; atS: boolean }> = [
  { z: 3, atS: false },
  { z: 4, atS: true },
  { z: 5, atS: true },
];

/**
 * The digits an interval of length h needs: the first of STATION_DIGITS whose worst chord error
 * (z rounded at both ends, and s too unless z is taken at the written s, at grade g), times the
 * Hermite's 1.5, takes at most half of the headroom between the steeper end's grade and the limit
 * (checkSurface's 2e-5 included). With no headroom (an interval across a knot within 0.5 m of an
 * end) the finest.
 */
export function stationDigitsFor(h: number, g0: number, g1: number, limit: number): number {
  const g = Math.max(Math.abs(g0), Math.abs(g1));
  const headroom = limit + 2e-5 - g;
  for (let d = 0; d < STATION_DIGITS.length; d++) {
    const { z, atS } = STATION_DIGITS[d];
    const sError = atS ? 0 : g * 1e-2;
    const chordError = (10 ** -z + sError) / Math.max(h, 1e-6);
    const isEnough = 1.5 * chordError <= headroom / 2;
    if (isEnough) return d;
  }
  return STATION_DIGITS.length - 1;
}

/**
 * Knots of a solved run strictly inside (a, b) (run distances): each piece's own, and every anchor
 * between two pieces (a station there, as at a knot: the curvature may change on it).
 */
function runKnots(s: Solved, a: number, b: number): number[] {
  const isWhole = s.pieces.length === 1;
  if (isWhole) return curvatureKnots(s.profile, a, b);
  const out: number[] = [];
  s.pieces.forEach((p, k) => {
    const isOverlapping = p.b > a && p.a < b;
    if (!isOverlapping) return;
    for (const knot of curvatureKnots(p.profile, a - p.a, b - p.a)) out.push(knot + p.a);
    const isAnchorInside = k > 0 && p.a > a + 0.5 && p.a < b - 0.5;
    if (isAnchorInside) out.push(p.a);
  });
  return out.sort((p, q) => p - q);
}

/** The knot spacing a chunk over [a, b] reports: the smallest of the pieces it lies on. */
function knotSpacingOver(s: Solved, a: number, b: number): number {
  const isWhole = s.pieces.length === 1;
  if (isWhole) return s.profile.h;
  return Math.min(...s.pieces.filter((p) => p.b > a && p.a < b).map((p) => p.profile.h));
}

/** Whether the 特例 grade holds at run distance sv (the piece holding it). */
function isSpecialAt(s: Solved, sv: number): boolean {
  let p = s.pieces[0];
  for (const q of s.pieces) if (q.a <= sv) p = q;
  return p.profile.special;
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

/**
 * Stretches of a run over another deck (where its piers would stand on that deck). Over a tunnel or
 * cut (P9) only where the road below is open to the sky: a cut, or a tunnel whose ground is cut away
 * at a portal (expresswayBore.ts isHoleAt's rule). Over a buried tunnel a pier stands on the ground
 * above its roof, as over any other ground. Why: counted as a deck, the tunnel under 都心環状線内回り
 * took its 15 piers over 750 m (24402611:5–7).
 */
function overDeck(
  plan: Plan,
  id: string,
  heightAt: HeightAt,
  ground: GroundSampler,
): Array<[number, number]> {
  const isOpenBelow = (p: DeckPair) => {
    const lower = plan.runs.get(p.b)!;
    if (!lower.below) return true;
    if (belowAt(lower, p.sb) === "cut") return true;
    const done = heightAt(p.b, p.sb);
    if (!done) return false;
    const pose = poseAt(lower, p.sb);
    return isHoleAt("tunnel", done.z, ground(pose.lon, pose.lat));
  };
  return plan.pairs
    .filter((p) => p.a === id && p.relation === "above" && isOpenBelow(p))
    .map((p) => [p.sa - 6, p.sa + 6]);
}

/**
 * A below run's portals (below.ts portalsOf): before its start and after its end a viaduct (a seam)
 * or the ground, and every change between tunnel and cut at a way boundary inside it.
 */
function belowPortals(plan: Plan, s: Solved): XwPortal[] {
  const { rp } = s;
  const base = rp.align.s[rp.i0];
  const outside = (e: XwEnd): XwStructure => (e.kind === "seam" ? "viaduct" : "ground");
  const boundaries: Array<{ s: number; from: "tunnel" | "cut"; to: "tunnel" | "cut" }> = [];
  for (let w = 1; w < rp.run.ways.length; w++) {
    const wayIndex = rp.chain.ways.indexOf(rp.run.ways[w]);
    const node = rp.chain.wayStarts[wayIndex];
    boundaries.push({
      s: roundTo(rp.align.s[rp.align.vertexSample[node]] - base, 2),
      from: belowStructure(plan.net, rp.run.ways[w - 1]),
      to: belowStructure(plan.net, rp.run.ways[w]),
    });
  }
  return portalsOf(
    roundTo(rp.length, 2),
    outside(s.start),
    outside(s.end),
    boundaries,
    belowStructure(plan.net, rp.run.ways[0]),
    belowStructure(plan.net, rp.run.ways[rp.run.ways.length - 1]),
  );
}

/** The lowest elevation of a solved run over [a, b] (clamped to the run), every metre and at b. */
function lowestOver(s: Solved, a: number, b: number, length: number): number {
  const lo = Math.max(0, a);
  const hi = Math.min(length, b);
  let low = evalRun(s, hi).z;
  for (let sv = lo; sv < hi; sv += 1) low = Math.min(low, evalRun(s, sv).z);
  return low;
}

/** What the height build's rules of S6 PR 7a changed (R3, R4, R5), for the scorecard. */
export type HeightRuleTally = { spanned: number; sameApart: number; unanchored: number };

/**
 * A height build (P2.7-6 PR 1): a viaduct-tagged run's stretches by structure, from its solved profile
 * against the ground under its centre line every metre (heightStructures.ts), and the roads and
 * railways under it it cannot pass over as solved: under an embankment or a cut, or within the climb
 * of a low end and not cleared over the road's width (less what a thinner girder takes). Those are
 * blocked, each reported as crossing_over_or_at_grade. Runs before the decks it crosses over are
 * appended to `cross` (only roads and railways are in it then). A below run, or one carrying a
 * structure's deck (its girder, sRange and tapers are the structure's), keeps its tags' structures.
 * S6 PR 7a: a crossing's window the deck clears on the thinnest girder is spanned (R3) and its
 * leftovers ruled again (afterSpanning), an embankment in the air holds only to an end meeting the
 * ground (R4), and a same-surface station apart past the merge is classed by its height (R5).
 */
function structuresByHeight(
  plan: Plan,
  s: Solved,
  ground: GroundSampler,
  diagnostics: XwDiagnostic[],
  solved: ReadonlyMap<string, Solved>,
  tally: HeightRuleTally,
): void {
  const { rp } = s;
  const isTagged = rp.below || rp.over !== null;
  if (isTagged) return;
  const S = rp.length;
  const sampleOf = (sv: number) => {
    const p = poseAt(rp, sv);
    return { s: sv, z: evalRun(s, sv).z, ground: ground(p.lon, p.lat) };
  };
  const samples: Array<{ s: number; z: number; ground: number }> = [];
  for (let sv = 0; sv < S; sv += 1) samples.push(sampleOf(sv));
  samples.push(sampleOf(S));
  // The same decks as the chunks' (deckStretches), so T13 reads the same context from the tiles.
  const decks = deckStretches(plan, rp.run.id);
  const spans = (relation: "above" | "same") =>
    decks.filter((d) => d.relation === relation).map((d): [number, number] => [d.s0, d.s1]);
  // R5 (S6 PR 7a): a station of a same-surface pair more than MERGE_GIVEN_UP_DZ_M from its partner is
  // not one slab with it (the runtime does not merge it either) and is classed by its height. Why not
  // the whole stretch: a pair that parts in height at one end is one slab at the other.
  const apart: Array<[number, number]> = [];
  for (const p of plan.pairs) {
    const isMine = p.a === rp.run.id && p.relation === "same";
    if (!isMine) continue;
    const other = solved.get(p.b);
    if (other === undefined) continue;
    const isApart = Math.abs(evalRun(s, p.sa).z - evalRun(other, p.sb).z) > MERGE_GIVEN_UP_DZ_M;
    if (!isApart) continue;
    apart.push([p.sa - GRID_M / 2, p.sa + GRID_M / 2]);
    tally.sameApart++;
  }
  const same = sameKept(spans("same"), apart);
  // R4 (S6 PR 7a): an embankment 3 m or more up holds to an end only where the run meets the ground
  // there: a ground end, a portal, or a seam onto a run at grade. Why: at a junction or a seam onto a
  // viaduct the deck goes on in the air, and the embankment ending there was a deck in the air.
  const groundEnds = ([true, false] as const).map((atStart) => {
    const e = endPlan(plan, rp, atStart);
    const isSeamOnGround = e.kind === "seam" && plan.runs.get(e.parent)?.ground === true;
    return e.kind === "ground" || isSeamOnGround;
  }) as [boolean, boolean];
  const ctxOf = (ends?: readonly [boolean, boolean]) => ({
    above: spans("above"),
    same,
    length: S,
    ...(ends ? { groundEnds: ends } : {}),
    // A run at grade is a cut wherever the ground is not well under it (S6 PR 2 5.1 の 5).
    ...(rp.ground ? { cutBelow: HEIGHT_STRUCTURES.value.ground.cutBelowM } : {}),
  });
  const unanchored = { count: 0 };
  const classified = heightStretches(samples, undefined, { ...ctxOf(groundEnds), unanchored });
  tally.unanchored += unanchored.count;
  const info = s.crossInfo ?? [];
  // R3 (S6 PR 7a): a crossing whose window the solved deck clears at its lowest over the thinnest
  // girder is spanned: the window is viaduct and an embankment or cut starts at its end. Why: classed
  // by the height alone, an embankment's end within the window blocked roads the deck cleared (the
  // default range's 4 newly blocked under PR 1, ship's 7). One the deck does not clear stays blocked.
  const cleared: Array<[number, number]> = [];
  info.forEach((c, i) => {
    const [sc, top, need] = s.cross.slice(3 * i, 3 * i + 3);
    const a = Math.max(0, sc - c.halfWindow);
    const b = Math.min(S, sc + c.halfWindow);
    const isCleared = clearsOnThinGirder(lowestOver(s, a, b, S), top, need);
    if (isCleared) cleared.push([a, b]);
  });
  const isSpanning = (w: [number, number]) =>
    classified.some((h) => h.structure !== "viaduct" && h.s1 > w[0] && h.s0 < w[1]);
  tally.spanned += cleared.filter(isSpanning).length;
  // The leftovers of the windows ruled again (review W2): short pieces between viaducts and pieces in
  // the air become viaducts.
  const stretches = afterSpanning(
    forceViaduct(classified, cleared),
    samples,
    HEIGHT_STRUCTURES.value.smoothM,
    S,
    groundEnds,
  );
  s.structures = stretches;
  const kept: number[] = [];
  const keptInfo: CrossInfo[] = [];
  info.forEach((c, i) => {
    const [sc, top, need] = s.cross.slice(3 * i, 3 * i + 3);
    // The whole width the road takes along the deck (review W1): any of it on an embankment or cut.
    const a = sc - c.halfWindow;
    const b = sc + c.halfWindow;
    const onGround = stretches.find((h) => h.structure !== "viaduct" && h.s1 > a && h.s0 < b);
    const at = onGround?.structure ?? "viaduct";
    const isOpenGround = onGround !== undefined;
    // Its lowest point over that width, as the cleared roads are judged: short of what the thinnest
    // girder leaves, it cannot be crossed (review C1: 172358461 over road 172358474, 7.04 m at the
    // centre but 6.37 m 9 m along, a soffit of 4.17 m).
    const low = lowestOver(s, a, b, S);
    const isMissed = low - top < need - GIRDER_GIVE_M;
    const isPassing = !isOpenGround && !isMissed;
    if (isPassing) {
      kept.push(sc, top, need);
      keptInfo.push(c);
      return;
    }
    const why = isOpenGround
      ? `under ${at === "cut" ? "a cut" : "an embankment"}`
      : "not cleared by the solved deck over its width";
    const diagnostic: XwDiagnostic = {
      run: rp.run.id,
      kind: "crossing_over_or_at_grade",
      detail: `${c.label} at ${sc.toFixed(0)} m is ${why}; taken as passing over`,
      allowed: false,
    };
    diagnostics.push(diagnostic);
    s.blocked.push({ s: sc, halfWindow: c.halfWindow, top, need, diagnostic });
  });
  s.cross = [...kept, ...s.cross.slice(3 * info.length)];
  s.crossInfo = keptInfo;
}

/** A curve is tight where its radius is under this times the run's floor radius. */
const TIGHT_CURVE_FACTOR = 1.25;

/**
 * Where a structure's stretch may end (S6 PR 2): off a tight curve. Inside one (radius under
 * TIGHT_CURVE_FACTOR × the floor: 第15条's 特例 for a main line, RAMP_MIN_RADIUS for a ramp) a chunk
 * boundary's heading (the curve's tangent) and its first chord part by nearly as much as T3 allows
 * there, and the files' rounding tips it over (60942193:1, 0.194 rad against 0.175). The boundary
 * moves to the nearest knot outside the curve, else to the curve's nearer end, within the smoothing
 * length (T13 takes a mismatch that short); otherwise it stays.
 */
export function offTightCurve(
  rp: Pick<RunPlan, "align" | "i0" | "i1" | "cls" | "planV">,
  s: number,
  knots: readonly number[],
): number {
  const floor = rp.cls === "expressway" ? CURVE_RADIUS.value[rp.planV].special : RAMP_MIN_RADIUS.value;
  const limit = 1 / (TIGHT_CURVE_FACTOR * floor);
  const base = rp.align.s[rp.i0];
  const isTight = (i: number) => Math.abs(rp.align.kappa[i]) > limit;
  const at = sampleAt(rp, s);
  if (!isTight(at)) return s;
  let a = at;
  while (a > rp.i0 && isTight(a - 1)) a--;
  let b = at;
  while (b < rp.i1 && isTight(b + 1)) b++;
  const ca = rp.align.s[a] - base;
  const cb = rp.align.s[b] - base;
  const reach = HEIGHT_STRUCTURES.value.smoothM;
  const outside = knots.filter((kn) => (kn < ca || kn > cb) && Math.abs(kn - s) <= reach);
  const nearest = outside.sort((p, q) => Math.abs(p - s) - Math.abs(q - s))[0];
  if (nearest !== undefined) return nearest;
  const end = s - ca <= cb - s ? ca : cb;
  return Math.abs(end - s) <= reach ? end : s;
}

/** A run's bank (per sample) at run distance sv, linear between the samples around it. */
function bankAt(rp: RunPlan, bank: Float64Array, sv: number): number {
  const lo = Math.min(bank.length - 1, Math.max(0, sampleAt(rp, sv) - rp.i0));
  const hi = Math.min(bank.length - 1, lo + 1);
  const base = rp.align.s[rp.i0];
  const s0 = rp.align.s[rp.i0 + lo] - base;
  const s1 = rp.align.s[rp.i0 + hi] - base;
  const t = s1 > s0 ? Math.min(1, Math.max(0, (sv - s0) / (s1 - s0))) : 0;
  return bank[lo] + (bank[hi] - bank[lo]) * t;
}

/** Whether s belongs to the chunk [a, b) (the last chunk keeps its end). */
function within(sv: number, a: number, b: number, isLast: boolean): boolean {
  return sv >= a && (sv < b || (isLast && sv <= b));
}

function chunkRun(
  plan: Plan,
  s: Solved,
  ground: GroundSampler,
  objects: ObjectPoly[],
  heightAt: HeightAt,
): XwChunk[] {
  const { rp } = s;
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
    // A tunnel's portal inside a below run: a chunk is all tunnel or all cut (P9).
    const isPortal =
      rp.below && prevWay !== null && nextWay !== null && prevWay.structure !== nextWay.structure;
    // The posted limit (OSM maxspeed) changes at a way boundary: each chunk carries one (P6).
    const isLimitChange = prevWay !== null && nextWay !== null && prevWay.maxspeedTag !== nextWay.maxspeedTag;
    if (isJunction || isSectionChange || isPortal || isLimitChange)
      cuts.add(rp.align.s[rp.align.vertexSample[i]] - base);
  }
  for (const z of s.zones) if (z.from > 0) cuts.add(z.from);
  // A height build: a chunk is all one structure (P2.7-6 PR 1), so its stretches' ends are cuts too.
  const stretchesOf = s.structures;
  // On a knot within MIN_STATION_GAP_M where there is one: a stretch's end just short of a knot left a
  // chunk whose first chord was under a metre (920238368:1 at s 99.5, the knot at 100.34), too short
  // for the files' 1 cm to hold its heading (T3).
  const allKnots = stretchesOf ? runKnots(s, 0, S) : [];
  for (const h of stretchesOf ?? []) {
    const isInside = h.s0 > 0 && h.s0 < S;
    if (!isInside) continue;
    const near = allKnots.find((kn) => Math.abs(kn - h.s0) < MIN_STATION_GAP_M);
    const at = near ?? h.s0;
    cuts.add(plan.ground === "compile" ? offTightCurve(rp, at, allKnots) : at);
  }
  const classAt = (sv: number): HeightClass | null => (stretchesOf ? heightClassAt(stretchesOf, sv) : null);
  // An anchor (blocks.ts) is no cut of its own, so the chunk ids stay; only where the pieces beside
  // it differ in the 特例 grade (a chunk has one gmax). A speed change there is a zone's boundary.
  for (let k = 1; k < s.pieces.length; k++) {
    const isApart = s.pieces[k].profile.special !== s.pieces[k - 1].profile.special;
    if (isApart) cuts.add(s.pieces[k].a);
  }
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
  const decksBelow = overDeck(plan, rp.run.id, heightAt, ground);
  const stretches = deckStretches(plan, rp.run.id);
  const piers: number[] = [];
  const spacing = PIER_SPACING.value;
  // A tunnel or cut stands on the ground: no piers.
  const pierCount = rp.below ? 0 : Math.ceil(S / spacing);
  for (let k = 1; k < pierCount && k * spacing < S - 5; k++) {
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
    // An embankment or a cut stands on the ground (a height build): no piers. The chunk's class (at
    // its middle) decides, as it is written: a stretch's end within 0.5 m of a chunk's end is no cut of
    // its own, and a pier there stood on an embankment chunk (5171105:11 at s 2450).
    const ci = stretchesOf
      ? bounds.findIndex(
          (a, i) => i + 1 < bounds.length && within(at, a, bounds[i + 1], i + 2 === bounds.length),
        )
      : -1;
    const isOnGround = ci >= 0 && classAt((bounds[ci] + bounds[ci + 1]) / 2) !== "viaduct";
    if (isOnGround) continue;
    // The structure's spans and anchorages carry the deck (pierFreeRange): no pier of our own there.
    const isCarried = rp.over !== null && isPierFree(rp.over.st, rp.over.axisAt(at));
    if (isCarried) continue;
    const p = poseAt(rp, at);
    const g = ground(p.lon, p.lat);
    const z = evalRun(s, at).z;
    const isTallEnough = z - GIRDER - g > 1.5;
    if (isTallEnough) piers.push(at, g);
  }
  const wayAtSample = (sampleIdx: number) => plan.net.ways.get(rp.wayAt[sampleIdx - rp.i0])!;
  const sec = (sampleIdx: number) => {
    const way = wayAtSample(sampleIdx);
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
  const portals = rp.below ? belowPortals(plan, s) : [];
  const myPairs = stretchesOf ? plan.pairs.filter((p) => p.a === rp.run.id || p.b === rp.run.id) : [];
  /**
   * A height build's viaduct chunk over [a, b): the girder its crossings and the decks under it leave
   * room for (heightStructures.girderFor), the standard where nothing is short. A crossing's surplus is
   * the surface over what it crosses less the clearance without the girder; a deck under it, the
   * height over that deck less 第12条's H.
   */
  const thinGirder = (a: number, b: number, standard: number): number => {
    const isStandardless = standard <= 0;
    if (isStandardless) return standard;
    const surpluses: number[] = [];
    for (let i = 0; i < s.cross.length; i += 3) {
      const sc = s.cross[i];
      const info = s.crossInfo?.[i / 3];
      // Every chunk the window touches, not only the one holding its centre (S6 PR 7a, R6 (c)): the
      // road takes the whole window under the deck, so a chunk over its edge needs the thin girder too.
      const isHere = isWindowOver(sc, info?.halfWindow ?? 0, a, b);
      if (!isHere) continue;
      // A road or railway over the width it takes along the deck (its lowest point there), as the
      // judgement that let it pass (structuresByHeight); a deck under it at the crossing's point.
      const z = info ? lowestOver(s, sc - info.halfWindow, sc + info.halfWindow, S) : evalRun(s, sc).z;
      surpluses.push(z - s.cross[i + 1] - (s.cross[i + 2] - GIRDER));
    }
    // Both ways of each pair: this run's points over the other's carriageway, and the other's points
    // under this one's. Why both: an overlap is found at either run's stations (overlap.ts), and over a
    // narrow parallel overlap only the lower run's points fell in the other's band (41009552 over
    // 176046420, 6.65 m at one of the lower's stations, no pair of the upper's).
    for (const p of myPairs) {
      const mineS = p.a === rp.run.id ? p.sa : p.sb;
      const isHere = mineS >= a && mineS <= b;
      if (!isHere) continue;
      const other = p.a === rp.run.id ? heightAt(p.b, p.sb) : heightAt(p.a, p.sa);
      if (!other) continue;
      const dz = evalRun(s, mineS).z - other.z;
      const isAbove = dz > 0;
      if (isAbove) surpluses.push(dz - CLEARANCE_HEIGHT.value);
    }
    const thin = girderFor(surpluses);
    const isThin = thin < standard;
    // Down to the centimetre, so the clearance written (less the girder saved) never exceeds what is there.
    return isThin ? Math.floor((thin + 1e-9) * 100) / 100 : standard;
  };
  // Stations by the plan curvature, plus every knot where the vertical curvature changes: a
  // station interval then lies within one parabola, which the Hermite surface reproduces exactly.
  // Why not plan stations alone: across a knot the cubic overshoots the end grades (5.02 % on a
  // 5 % section) and the curvature (1.05e-3 against 1/1000).
  // The start always, even of a chunk under 2 m (a short speed zone): one station is no chunk.
  /**
   * A run at grade's stations where the ground between two stations is not their line within the dead
   * band (heightStructures HEIGHT_DEAD_BAND_M): its structure is the ground's every metre, and T13
   * reads the ground linear between the files' stations. Why: at a tunnel's mouth the DEM stands up at
   * the portal (4853045 at s 0, 2.5 m over the road, the ground fallen by s 3), and 20 m of line from
   * it read as an 18 m cut the compiler never saw. Kept as knots are (never left out as crowding).
   */
  const groundKnots = (a: number, b: number, knots: number[]): number[] => {
    const groundOf = (sv: number) => {
      const p = poseAt(rp, sv);
      return ground(p.lon, p.lat);
    };
    const added: number[] = [];
    let marks = [a, b, ...knots].sort((p, q) => p - q);
    for (let pass = 0; pass < 32; pass++) {
      let worst = { at: -1, off: HEIGHT_DEAD_BAND_M };
      for (let i = 0; i + 1 < marks.length; i++) {
        const [p, q] = [marks[i], marks[i + 1]];
        const [gp, gq] = [groundOf(p), groundOf(q)];
        for (let sv = Math.ceil(p + 1); sv < q - 1; sv += 1) {
          const off = Math.abs(groundOf(sv) - (gp + ((gq - gp) * (sv - p)) / (q - p)));
          if (off > worst.off) worst = { at: sv, off };
        }
      }
      const isDone = worst.at < 0;
      if (isDone) break;
      added.push(worst.at);
      marks = [...marks, worst.at].sort((p, q) => p - q);
    }
    return added;
  };
  const chunkStations: number[][] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const positions: number[] = [a];
    for (let sv = a + stationStep(poseAt(rp, a).kappa); sv < b - 2; sv += stationStep(poseAt(rp, sv).kappa))
      positions.push(sv);
    positions.push(b);
    const knots = runKnots(s, a, b);
    chunkStations.push(
      stationPositions(positions, rp.ground ? [...knots, ...groundKnots(a, b, knots)] : knots, a, b),
    );
  }
  // Each station's digits (STATION_DIGITS): the finest an interval beside it needs, a chunk's end
  // over both chunks so the next chunk starts with the very same values (T3).
  const digitsAt = new Map<number, number>();
  const need = (sv: number, d: number) => digitsAt.set(sv, Math.max(digitsAt.get(sv) ?? 0, d));
  chunkStations.forEach((list, k) => {
    const limit = gradeLimitFor(
      zoneSpeedAt(s.zones, (bounds[k] + bounds[k + 1]) / 2),
      isSpecialAt(s, (bounds[k] + bounds[k + 1]) / 2),
    );
    for (let i = 0; i + 1 < list.length; i++) {
      const d = stationDigitsFor(
        list[i + 1] - list[i],
        evalRun(s, list[i]).grade,
        evalRun(s, list[i + 1]).grade,
        limit,
      );
      need(list[i], d);
      need(list[i + 1], d);
    }
  });
  const chunks: XwChunk[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const isLast = k + 2 === bounds.length;
    const st: number[] = [];
    const push = (sv: number) => {
      const p = poseAt(rp, sv);
      const digits = STATION_DIGITS[digitsAt.get(sv) ?? 0];
      const written = roundTo(sv, 2);
      const v = evalRun(s, digits.atS ? written : sv);
      // With runs at grade (S6 PR 2) a station's bank is the samples' interpolated at its own s: the
      // sample before it (as without them) put the last station on the one before the parent's pin
      // (T3, 1023819782:8) and a short ramp's run-in over 第18条 by the samples' spacing (T7,
      // 1256882296:2 at 2.90‰/m); without them the files stay as they were.
      const bi = Math.min(s.bank.length - 1, Math.max(0, sampleAt(rp, sv) - rp.i0));
      const bankHere = plan.ground === "compile" ? bankAt(rp, s.bank, sv) : s.bank[bi];
      st.push(
        written,
        roundTo(p.lon, 7),
        roundTo(p.lat, 7),
        roundTo(v.z, digits.z),
        roundTo(bankHere, 4),
        roundTo(ground(p.lon, p.lat), 2),
        roundTo(v.grade, 5),
      );
    };
    for (const sv of chunkStations[k]) push(sv);
    const { section, over, girder: deckGirder } = sectionAt(a, b);
    const byHeight = classAt((a + b) / 2);
    const structure: XwChunk["structure"] = rp.below ? belowAt(rp, (a + b) / 2) : (byHeight ?? "viaduct");
    // A height build's viaduct takes a thinner girder where a crossing or a deck under it is short of
    // the clearance + GIRDER by up to GIRDER_GIVE_M (heightStructures.girderFor); a cut has none.
    const girder =
      rp.below || structure === "cut"
        ? 0
        : byHeight === "viaduct"
          ? thinGirder(a, b, deckGirder)
          : deckGirder;
    // A portal on a chunk boundary belongs to the tunnel's chunk (which draws its 坑門): the one after
    // it going in, the one before it coming out; otherwise to the chunk after it. The s are rounded
    // to 1 cm, so it is looked up 1 cm to that side, and the run's last one at S.
    const sideOf = (p: XwPortal) => (p.from === "tunnel" ? Math.max(0, p.s - 0.01) : Math.min(p.s + 0.01, S));
    const chunkPortals = portals.filter((p) => within(sideOf(p), a, b, isLast));
    // A height build: where the structure changes the chunk after it starts with the portal.
    const before = k > 0 ? classAt((bounds[k - 1] + a) / 2) : null;
    const isChange = byHeight !== null && before !== null && before !== byHeight;
    if (isChange) chunkPortals.push({ s: roundTo(a, 2), from: before, to: byHeight });
    const maxspeed = wayAtSample(sampleAt(rp, (a + b) / 2)).maxspeedTag;
    const V = zoneSpeedAt(s.zones, (a + b) / 2);
    const chunkPiers: number[] = [];
    for (let i = 0; i < piers.length; i += 2) {
      if (within(piers[i], a, b, isLast)) chunkPiers.push(roundTo(piers[i], 2), roundTo(piers[i + 1], 2));
    }
    const chunkCross: number[] = [];
    const chunkWindows: number[] = [];
    // The clearance written is what the chunk's girder needs (T4): less where it is thinner.
    const thinner = girder > 0 && girder < GIRDER ? GIRDER - girder : 0;
    for (let i = 0; i < s.cross.length; i += 3) {
      const sc = s.cross[i];
      if (!within(sc, a, b, isLast)) continue;
      const z = evalRun(s, sc).z;
      chunkCross.push(
        roundTo(sc, 2),
        roundTo(s.cross[i + 1], 3),
        roundTo(s.cross[i + 2] - thinner, 3),
        roundTo(z, 3),
      );
      chunkWindows.push(roundTo(s.crossInfo?.[i / 3]?.halfWindow ?? 0, 2));
    }
    // Only a height build writes the windows (a build by the tags keeps its files byte for byte).
    const isWindowed = plan.structures === "height" && chunkWindows.length > 0;
    const chunkBlocked: number[] = [];
    for (const road of s.blocked) {
      const sc = road.s;
      if (!within(sc, a, b, isLast)) continue;
      chunkBlocked.push(roundTo(sc, 2), roundTo(road.top, 3), roundTo(evalRun(s, sc).z, 3));
    }
    chunks.push({
      id: `${rp.run.id}:${k}`,
      run: rp.run.id,
      chain: rp.chain.id,
      k,
      cls: rp.cls,
      ref: rp.ref,
      name: rp.name,
      structure,
      ...(chunkPortals.length > 0 ? { portals: chunkPortals } : {}),
      over,
      lanes: section.lanes,
      laneWidth: section.laneWidth,
      shoulderL: section.shoulderL,
      shoulderR: section.shoulderR,
      basis: section.basis,
      V,
      maxspeed,
      vh: roundTo(knotSpacingOver(s, a, b), 3),
      ...(s.pieces.length === 1 && s.profile.cubic ? { vform: "cubic" as const } : {}),
      gmax: gradeLimitFor(V, isSpecialAt(s, (a + b) / 2)),
      g0: roundTo(evalRun(s, a).grade, 6),
      g1: roundTo(evalRun(s, b).grade, 6),
      h0: roundTo(headingAt(rp, a, plan.ground === "compile"), 6),
      h1: roundTo(headingAt(rp, b, plan.ground === "compile"), 6),
      girder,
      st,
      piers: chunkPiers,
      cross: chunkCross,
      ...(isWindowed ? { crossWindows: chunkWindows } : {}),
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

/** The approach from a seam (the climb of the run going on in the air, at most this). */
export const GROUND_APPROACH_SEAM_M = 150;
/** The approach from a ground end, a portal or a junction. */
export const GROUND_APPROACH_END_M = 100;

/**
 * A run at grade's road against its target line (S6 PR 7a, 4.3): the grid stations within
 * `approachM` of either end are the approaches (where a seam, portal or junction forces the road off
 * the line), the rest the inside. Pure.
 */
export function groundFitOf(
  stations: ArrayLike<number>,
  target: ArrayLike<number>,
  zAt: (s: number) => number,
  approachM: readonly [number, number],
): XwGroundFit {
  const n = stations.length;
  const S = stations[n - 1];
  const inside: number[] = [];
  let approachMax = 0;
  for (let k = 0; k < n; k++) {
    const s = stations[k];
    const off = zAt(s) - target[k];
    const isApproach = s < approachM[0] || S - s < approachM[1];
    if (isApproach) approachMax = Math.max(approachMax, Math.abs(off));
    else inside.push(off);
  }
  const isEmpty = inside.length === 0;
  const sorted = inside.toSorted((a, b) => a - b);
  const abs = inside.map(Math.abs).toSorted((a, b) => a - b);
  const at = (list: number[], q: number) => list[Math.min(list.length - 1, Math.floor(q * list.length))];
  return {
    approachM: [approachM[0], approachM[1]],
    innerP95M: isEmpty ? null : roundTo(at(abs, 0.95), 2),
    innerMedianM: isEmpty ? null : roundTo(at(sorted, 0.5), 2),
    approachMaxM: roundTo(approachMax, 2),
  };
}

/**
 * A run at grade's approach at each end, from the plan alone (review W4: from the written runs it
 * depended on the range, 6 of the 15 runs at grade common to the default range and ship differed): the
 * chain going on into a viaduct (a seam whose child climbs) or the run a seam child of one, 150 m; into
 * a tunnel or cut (a portal), a ground end or a junction, 100 m; the chain's open end, none.
 */
function groundApproaches(plan: Plan, rp: RunPlan): [number, number] {
  const runs = splitRuns(plan.net, rp.chain);
  const k = runs.findIndex((r) => r.id === rp.run.id);
  const ofEnd = (atStart: boolean): number => {
    const next = runs[atStart ? k - 1 : k + 1];
    const e = endPlan(plan, rp, atStart);
    const isClimb = e.kind === "seam" || next?.elevated === true;
    if (isClimb) return GROUND_APPROACH_SEAM_M;
    const isForced = next?.below === true || e.kind === "ground" || e.kind === "junction";
    return isForced ? GROUND_APPROACH_END_M : 0;
  };
  return [ofEnd(true), ofEnd(false)];
}
