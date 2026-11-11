import { CLEARANCE_HEIGHT, type DesignSpeed, MAX_GRADE, VERTICAL_CURVE_RADIUS } from "../law/roadStandards";
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

/** The structure of a below run's way: tunnel or cut. */
export function belowStructure(net: Network, wayId: number): "tunnel" | "cut" {
  return net.ways.get(wayId)!.structure === "tunnel" ? "tunnel" : "cut";
}

/**
 * Whether a below run is compiled: each end either runs on inside its chain (into an elevated run,
 * a seam, or onto the ground) or ends the chain where nothing else meets it. A below run ending at
 * a junction (a tunnel ramp joining a tunnel, 湾岸線's cut at 有明 JCT) or leaving the universe is
 * deferred: its coupling under the ground is not built yet, and the elevated run before it ends at
 * its portal as before.
 */
export function isBelowCompiled(
  chain: Chain,
  run: Run,
  nodeChains: Map<number, string[]>,
  outsideNodes: Set<number>,
): boolean {
  if (!run.below) return false;
  for (const idx of [run.from, run.to]) {
    const isChainEnd = idx === 0 || idx === chain.nodes.length - 1;
    if (!isChainEnd) continue;
    // A loop's ends are a seam between its first and last runs (都心環状線): not under the ground yet.
    if (chain.closed) return false;
    const node = chain.nodes[idx];
    if (outsideNodes.has(node)) return false;
    const others = (nodeChains.get(node) ?? []).filter((c) => c !== chain.id);
    const isJunction = others.length > 0;
    if (isJunction) return false;
  }
  return true;
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
