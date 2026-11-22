import {
  CLEARANCE_HEIGHT,
  type DesignSpeed,
  MAX_GRADE,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../law/roadStandards";
import { CUT_WALL, TUNNEL_EQUIPMENT_ROOM, TUNNEL_ROOF } from "./assumptions";
import type { XwPortal, XwStructure } from "./format";
import type { Chain, Network, Run } from "./network";

/**
 * Tunnels and cuts (P9, knowledge/road-redesign-plan.md 8 章): the rules the compiler and the
 * checks share for a run that goes below the ground between portals. Pure: no plan, no DEM.
 *
 * A below run keeps its road under the ground: in a tunnel at least the box (inner height, roof)
 * and the least cover below it, in a cut at most CUT_TOLERANCE_M above it. Near a portal the road
 * cannot be that deep yet (it comes down from the ground at the 第20条 grade), so a station's
 * ceiling is imposed only where the descent from every portal can reach it (`isReachable`).
 */

/** Road to ceiling at a tunnel's walls: 第12条's H and the room for the equipment hung above it. */
export const TUNNEL_INNER_HEIGHT_M = CLEARANCE_HEIGHT.value + TUNNEL_EQUIPMENT_ROOM.value;

/** Road surface to the ground over a tunnel, at the least: inner height, roof slab and cover. */
export const TUNNEL_DEPTH_M = TUNNEL_INNER_HEIGHT_M + TUNNEL_ROOF.value.slab + TUNNEL_ROOF.value.cover;

/** A tunnel's 坑門 rises this far over the ground at the portal (and the ground is cut away up to it). */
export const HEAD_OVER_GROUND_M = 0.6;

/**
 * Whether the ground is cut away over a station (the road is open to the sky there): everywhere in
 * a cut, and over a tunnel where the ground is not above the roof by HEAD_OVER_GROUND_M (near its
 * portals). The terrain's cut-out (expresswayBore.ts boreHoles) and the piers over a below run
 * (compile.ts overDeck) both use it.
 */
export function isHoleAt(structure: "tunnel" | "cut", z: number, ground: number): boolean {
  if (structure === "cut") return true;
  return ground - z < TUNNEL_INNER_HEIGHT_M + TUNNEL_ROOF.value.slab + HEAD_OVER_GROUND_M;
}

/**
 * How far a cut's road may stand above the smoothed ground (the DEM keeps half-metre bumps; at a
 * portal the road is the ground itself, and the QP aims 3 cm inside its bounds).
 */
export const CUT_TOLERANCE_M = 0.1;

/** How much deeper the descent must reach than a ceiling for it to be imposed. */
const REACH_MARGIN_M = 0.1;

/**
 * Depth from ground to road a station must keep (negative: may stand above it): the tunnel's box
 * and cover, or the cut's tolerance.
 */
export function depthFor(structure: "tunnel" | "cut"): number {
  return structure === "tunnel" ? TUNNEL_DEPTH_M : -CUT_TOLERANCE_M;
}

/**
 * Drop within distance d of a portal, at the least: the road may leave the portal climbing at half
 * V's standard grade (a ground end takes the terrain's grade, capped there: compile.ts terrainAt),
 * turns over a crest of V's radius (第22条) and falls at V's standard grade (第20条). Below the
 * ceiling the road may go as deep as it likes, so no sag is needed for the ceiling itself; the sag
 * back up to the other portal is that portal's own descent read backwards (`isReachable` asks
 * both). Why so conservative: a ceiling imposed only where even this reaches it never makes the run
 * unsolvable on its own (tests/expresswayBelow.test.ts tries hills of several shapes).
 */
export function descentWithin(V: DesignSpeed, d: number): number {
  const g = MAX_GRADE.value[V].standard;
  const R = VERTICAL_CURVE_RADIUS.value[V].crest;
  const up = g / 2;
  // From +up to −g over the crest.
  const d1 = (up + g) * R;
  const x = Math.max(0, d);
  const rise = (t: number) => up * t - (t * t) / (2 * R);
  return x <= d1 ? -rise(x) : -rise(d1) + g * (x - d1);
}

/**
 * Whether a ceiling `top` (T.P. m) at distances d0 and d1 from the run's two portals (elevations
 * z0, z1) is within the descent from both.
 */
export function isReachable(
  V: DesignSpeed,
  top: number,
  ends: ReadonlyArray<{ d: number; z: number }>,
): boolean {
  return ends.every(({ d, z }) => z - top + REACH_MARGIN_M <= descentWithin(V, d));
}

/**
 * The ceiling a below run keeps at a station (T.P. m), or null where none is imposed: the ground
 * less the structure's depth, wherever the descent from both portals (run distances 0 and `length`,
 * elevations z0 and z1) reaches it at the run's planned speed V. The compiler (compile.ts
 * setupBelow, with the lowest ground near the station and the portals' ground) and T12
 * (checks.checkCover, with the files' ground and end stations) both ask this, so they impose the
 * same ceilings by the same rule.
 */
export function ceilingAt(
  structure: "tunnel" | "cut",
  ground: number,
  s: number,
  length: number,
  ends: { z0: number; z1: number },
  V: DesignSpeed,
): number | null {
  const top = ground - depthFor(structure);
  const isImposed = isReachable(V, top, [
    { d: s, z: ends.z0 },
    { d: length - s, z: ends.z1 },
  ]);
  return isImposed ? top : null;
}

/**
 * S7-3 (3.4): what a below run's end meets, for the descent its ceilings are measured from. A run is
 * named by its id; `ends` are its start and end as the files and endPlan give them (kind, and for a
 * junction or seam the parent and the parent's run distance there); `ground` is the ground at its
 * first and last station (T.P. m, as the portal's elevation is read today).
 */
export type BelowLinkRun = {
  id: string;
  lengthM: number;
  planV: DesignSpeed;
  below: boolean;
  ends: [BelowLinkEnd, BelowLinkEnd];
  ground: [number, number];
};
export type BelowLinkEnd = { kind: string; parent?: string; parentS?: number };

/** A portal a ceiling is measured from: `offset` m beyond the run's end, its ground, the speed over the way. */
export type PortalReach = { offset: number; z: number; V: DesignSpeed };

/** Within this of a run's end, a parent's run distance is at that end (the files keep centimetres). */
const AT_END_M = 0.5;

/**
 * Whether a below run's end goes on under the ground (S7-3 3.4): its junction or seam parent is a below
 * run, or it is free (`open`) and another below run seams onto it there (a loop's first run, whose last
 * run seams back onto its start). Such an end is no portal: the road there is under the ground.
 */
export function isEndUnder(runs: ReadonlyMap<string, BelowLinkRun>, id: string, side: 0 | 1): boolean {
  return nextUnder(runs, id, side) !== null;
}

/** The below run an end goes on into, and where on it, or null where the end is a portal. */
function nextUnder(
  runs: ReadonlyMap<string, BelowLinkRun>,
  id: string,
  side: 0 | 1,
): { run: BelowLinkRun; s: number; side: 0 | 1 | null } | null {
  const r = runs.get(id);
  const isBelow = r !== undefined && r.below;
  if (!isBelow) return null;
  const e = r.ends[side];
  const parent = e.parent === undefined ? undefined : runs.get(e.parent);
  const isJoined = e.kind === "junction" || e.kind === "seam";
  if (isJoined) {
    const isUnder = parent !== undefined && parent.below;
    if (!isUnder) return null;
    const s = e.parentS ?? 0;
    const atSide = s <= AT_END_M ? 0 : parent.lengthM - s <= AT_END_M ? 1 : null;
    return { run: parent, s, side: atSide };
  }
  const isFree = e.kind === "open";
  if (!isFree) return null;
  const sHere = side === 0 ? 0 : r.lengthM;
  for (const other of [...runs.values()].toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!other.below || other.id === id) continue;
    for (const os of [0, 1] as const) {
      const oe = other.ends[os];
      const isSeamedHere =
        oe.kind === "seam" && oe.parent === id && Math.abs((oe.parentS ?? 0) - sHere) <= AT_END_M;
      if (isSeamedHere) return { run: other, s: os === 0 ? 0 : other.lengthM, side: os };
    }
  }
  return null;
}

/**
 * The portals each end of a below run is measured from (S7-3 3.4): an end that is a portal itself is one
 * portal at offset 0, its own ground, the run's planV (as today). An end that goes on under the ground
 * follows the connected below runs to their portals: the way along each run to each of its ends, past
 * ends that go on too, a loop followed once round (an end met twice is not followed again). The speed
 * is the highest planV along the way (the gentlest grade: a ceiling is imposed only where even it
 * reaches). An end whose way meets no portal (a closed underground loop) is read as its own portal.
 */
export function portalReaches(
  runs: ReadonlyMap<string, BelowLinkRun>,
  id: string,
): [PortalReach[], PortalReach[]] {
  const r = runs.get(id)!;
  const at = (side: 0 | 1): PortalReach[] => {
    const own: PortalReach = { offset: 0, z: r.ground[side], V: r.planV };
    const start = nextUnder(runs, id, side);
    if (start === null) return [own];
    const out: PortalReach[] = [];
    const seen = new Set<string>([`${id}:${side}`]);
    // `from`: the run the way came from. Only the end that leads back to it is passed by (a seam's end
    // entered from the other side). Why not every end entered at: a junction at a node at the parent's
    // end (S7-3 3.3: the run ending there for a merging child, the run starting there for a diverging
    // one) enters at that end, and its portal there (0 m from the child's end) or its way on under the
    // ground is the nearest the child has (S7-3 review 2: dropped, a ramp's ceiling ran up to its end at
    // the ground and it was closed).
    const walk = (
      q: BelowLinkRun,
      s: number,
      enteredSide: 0 | 1 | null,
      from: string,
      acc: number,
      V: DesignSpeed,
    ) => {
      const speed = Math.max(V, q.planV) as DesignSpeed;
      for (const fs of [0, 1] as const) {
        const next = nextUnder(runs, q.id, fs);
        const isBack = enteredSide === fs && next !== null && next.run.id === from;
        if (isBack) continue;
        const key = `${q.id}:${fs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const dist = acc + Math.abs(s - (fs === 0 ? 0 : q.lengthM));
        if (next === null) {
          out.push({ offset: dist, z: q.ground[fs], V: speed });
          continue;
        }
        walk(next.run, next.s, next.side, q.id, dist, speed);
      }
    };
    walk(start.run, start.s, start.side, id, 0, r.planV);
    return out.length > 0 ? out : [own];
  };
  return [at(0), at(1)];
}

/**
 * The ceiling at a station of a run whose ends are measured from portals beyond them (portalReaches):
 * as ceilingAt, the ground less the structure's depth where the descent from every portal reaches it,
 * each at its own way's length (its offset plus the run distance to that end) and speed.
 */
export function ceilingFrom(
  structure: "tunnel" | "cut",
  ground: number,
  s: number,
  length: number,
  reaches: readonly [readonly PortalReach[], readonly PortalReach[]],
): number | null {
  // A portal whose ground was not read (compile.ts belowLinksOf: NaN outside the needed runs) would drop
  // every ceiling of the run without a word: the way must stay among the needed runs, so it stops here.
  // Why throw and not skip that portal: the ceilings would then depend on which runs the range needs.
  const unread = [...reaches[0], ...reaches[1]].find((p) => Number.isNaN(p.z));
  if (unread) throw new Error(`a portal ${unread.offset.toFixed(2)} m beyond the run has no ground read`);
  const top = ground - depthFor(structure);
  const ways = [
    ...reaches[0].map((p) => ({ V: p.V, d: p.offset + s, z: p.z })),
    ...reaches[1].map((p) => ({ V: p.V, d: p.offset + (length - s), z: p.z })),
  ];
  const isImposed = ways.every(({ V, d, z }) => isReachable(V, top, [{ d, z }]));
  return isImposed ? top : null;
}

/**
 * A height build's rule for a shallow, short tunnel (P2.7-6 PR 1 4.2 の 6): where the tunnel stations
 * whose ceiling the descent reaches (`ceilingAt`) span less than one 第22条 vertical curve length at
 * V, no tunnel station keeps its ceiling. The descent's reach is judged station by station from each
 * portal alone, and a road cannot bend down into so short a stretch and back (湾岸線 near 空港中央:
 * three of 52 stations reached, missed by 0.32–0.42 m at every fallback). Its box then stands at the
 * ground as an open cut (tunnel_cover_short, the ledger's portal-open-cut). The compiler (setupBelow)
 * and T12 (checks.checkCoverRun) both ask this, over their own stations.
 */
export function isCoverStretchTooShort(imposedTunnelS: readonly number[], V: DesignSpeed): boolean {
  const isNone = imposedTunnelS.length === 0;
  if (isNone) return false;
  const extent = Math.max(...imposedTunnelS) - Math.min(...imposedTunnelS);
  return extent < VERTICAL_CURVE_LENGTH.value[V];
}

/** The structure of a below run's way: tunnel or cut. */
export function belowStructure(net: Network, wayId: number): "tunnel" | "cut" {
  return net.ways.get(wayId)!.structure === "tunnel" ? "tunnel" : "cut";
}

/**
 * Why a below run is not compiled (S7-1, the scorecard's `underground.deferred`): the first of these
 * that holds, in this order. `loop-seam`, `universe-edge` and `junction` are decided here, from the
 * run's chain alone (`belowDeferralOf`); `ground-junction` (compile.ts dropBelowJunctions: it meets a
 * run at grade at a junction) and `bridging` (compile.ts pruneBelow: it would join two components) by
 * the plan after it.
 */
export const BELOW_DEFER_REASONS = [
  "loop-seam",
  "universe-edge",
  "junction",
  "ground-junction",
  "bridging",
] as const;
export type BelowDeferReason = (typeof BELOW_DEFER_REASONS)[number];

/**
 * Why a below run is left out by its chain, or null when it is compiled (or is no below run): each
 * end either runs on inside its chain (into an elevated run, a seam, or onto the ground) or ends the
 * chain where nothing else meets it. A loop's ends are a seam between its first and last runs (都心環状線:
 * `loop-seam`); a chain that leaves the universe ends at an outside node (`universe-edge`); a below run
 * ending at a junction (a tunnel ramp joining a tunnel, 湾岸線's cut at 有明 JCT: `junction`). Over
 * both ends, reason by reason in that order, so one run gets one reason whichever end holds it.
 * Why not the first end's first reason (isBelowCompiled's loop before S7-1): the answer compiled or
 * not is the same either way, and a reason that does not hang on which end comes first in the chain
 * is the one S7-3 can be measured against.
 */
export function belowDeferralOf(
  chain: Chain,
  run: Run,
  nodeChains: Map<number, string[]>,
  outsideNodes: Set<number>,
  /**
   * S7-3 (`--below-junctions compile`): a loop's seam and a junction are compiled, so neither is a
   * reason; the universe's edge still is (nothing beyond it to meet). Absent: deferred, as since P9.
   */
  joins?: "compile",
): "loop-seam" | "universe-edge" | "junction" | null {
  if (!run.below) return null;
  const ends = [run.from, run.to].filter((idx) => idx === 0 || idx === chain.nodes.length - 1);
  const isInsideChain = ends.length === 0;
  if (isInsideChain) return null;
  const isCompiled = joins === "compile";
  const isLoopSeam = chain.closed && !isCompiled;
  if (isLoopSeam) return "loop-seam";
  const nodes = ends.map((idx) => chain.nodes[idx]);
  const isOutside = nodes.some((node) => outsideNodes.has(node));
  if (isOutside) return "universe-edge";
  if (isCompiled) return null;
  const isJunction = nodes.some((node) => (nodeChains.get(node) ?? []).some((c) => c !== chain.id));
  if (isJunction) return "junction";
  return null;
}

/**
 * Whether a below run is compiled: no reason of its chain leaves it out (`belowDeferralOf`). A below
 * run ending at a junction or leaving the universe is deferred: its coupling under the ground is not
 * built yet, and the elevated run before it ends at its portal as before.
 */
export function isBelowCompiled(
  chain: Chain,
  run: Run,
  nodeChains: Map<number, string[]>,
  outsideNodes: Set<number>,
): boolean {
  if (!run.below) return false;
  return belowDeferralOf(chain, run, nodeChains, outsideNodes) === null;
}

/**
 * Portal records of a below run (format.ts XwPortal): where it leaves the structure or ground
 * before it, where tunnel and cut change inside it, and where it comes out. `structureAt` gives the
 * structure just past s (inside the run), `boundaries` the run distances where its ways change.
 */
export function portalsOf(
  length: number,
  before: XwStructure,
  after: XwStructure,
  boundaries: ReadonlyArray<{ s: number; from: "tunnel" | "cut"; to: "tunnel" | "cut" }>,
  first: "tunnel" | "cut",
  last: "tunnel" | "cut",
): XwPortal[] {
  const out: XwPortal[] = [{ s: 0, from: before, to: first }];
  for (const b of boundaries) {
    const isPortal = b.from !== b.to;
    if (isPortal) out.push({ s: b.s, from: b.from, to: b.to });
  }
  out.push({ s: length, from: last, to: after });
  return out;
}

/** How high a cut's retaining wall rises over the road at a ring (m): to the ground and above. */
export function cutWallHeight(roadY: number, groundY: number, parapet: number): number {
  return Math.max(parapet, groundY - roadY + CUT_WALL.value.above);
}
