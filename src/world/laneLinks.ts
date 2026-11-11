import { Vector3 } from "three";
import { laneCentreOffset, laneOfOffset } from "./laneChange";
import { sourceOf } from "./roadClass";
import type { RoadGraph, RoadHit, Segment } from "./roads";

/**
 * 車線単位の接続 (LaneLink, knowledge/road-redesign-plan.md 3.1) on the expressway: at each node
 * where chunks meet, which lane of the road arriving goes on in which lane of the road leaving.
 * Three kinds: `through` (a seam of one run, lane k on in lane k; a lane dropped or added keeps
 * to the nearest), `merge` (a ramp or another main line coming in from the left or the right: its
 * lane runs into the main line's outermost lane on that side, the 加速車線 of 第75条の7第1項) and
 * `diverge` (a ramp or branch leaving: from the main line's outermost lane on its side, the lane
 * that 第75条の7第2項 wants the car in before the exit).
 *
 * Derived from the graph (the chunks' node ids and their geometry), so it costs no data format
 * change and is the same for every rebuild: which run continues tells a diverge from a merge
 * (the chunk's xid `<run>:<k>`), and the side is where the other road lies from the main line
 * MEASURE_M from the node. Kept as plain records of segment ids (structured-clone safe, like the
 * rest of the snapshot).
 */
export type LaneLinkKind = "through" | "merge" | "diverge";

export type LaneLink = {
  node: number;
  from: number;
  fromLane: number;
  to: number;
  toLane: number;
  kind: LaneLinkKind;
  /** Merge and diverge: the side of the main line the other road is on. */
  side: "left" | "right" | null;
  /**
   * Merge and diverge: the main line's segment the ramp runs beside (arriving at the node for a
   * merge, leaving it for a diverge), where the ramp's lane joins or leaves the main line's.
   */
  trunk: number | null;
};

/** How far from the node the side of a branching road is read (m). */
const MEASURE_M = 40;

/** The expressway run a chunk segment belongs to (its xid `<run>:<k>`), null off the chunks. */
export const runOf = (seg: Segment): string | null => seg.line.xid?.split(":")[0] ?? null;
const arrives = (seg: Segment, node: number) => (seg.oneway === -1 ? seg.from : seg.to) === node;
const leaves = (seg: Segment, node: number) => (seg.oneway === -1 ? seg.to : seg.from) === node;
const clampLane = (seg: Segment, lane: number) => Math.max(0, Math.min(seg.lanes - 1, lane));

/** Where `branch` lies from `trunk` near the node: + left of the trunk's direction. */
function sideOf(graph: RoadGraph, trunk: Segment, branch: Segment, atStart: boolean): "left" | "right" {
  const d = Math.min(MEASURE_M, branch.length);
  const s = atStart ? d : branch.length - d;
  const p: Vector3 = graph.sample(branch, s).pos;
  const lateral = graph.nearestOn(trunk, p).lateral * (trunk.oneway === -1 ? -1 : 1);
  return lateral >= 0 ? "left" : "right";
}

/** Lane links of every expressway node of the graph. */
export function buildLaneLinks(graph: RoadGraph): LaneLink[] {
  const links: LaneLink[] = [];
  for (const [node, ids] of graph.nodes) {
    const segs = ids.map((id) => graph.segments[id]).filter((s) => runOf(s) !== null && s.oneway !== 0);
    const isJunction = segs.length >= 2;
    if (!isJunction) continue;
    const ins = segs.filter((s) => arrives(s, node));
    const outs = segs.filter((s) => leaves(s, node));
    for (const a of ins) {
      for (const b of outs) {
        if (a === b) continue;
        const isSameRun = runOf(a) === runOf(b);
        const continued = outs.find((o) => o !== b && runOf(o) === runOf(a));
        const fed = ins.find((i) => i !== a && runOf(i) === runOf(b));
        const isDiverge = !isSameRun && continued !== undefined && fed === undefined;
        const isMerge = !isSameRun && fed !== undefined && continued === undefined;
        if (isDiverge) {
          const side = sideOf(graph, continued, b, true);
          const fromLane = side === "left" ? 0 : a.lanes - 1;
          const toLane = clampLane(b, laneOfOffset(b, laneCentreOffset(a, fromLane)));
          const link: LaneLink = {
            node,
            from: a.id,
            fromLane,
            to: b.id,
            toLane,
            kind: "diverge",
            side,
            trunk: continued.id,
          };
          links.push(link, ...innerLanes(a, b, link));
          continue;
        }
        if (isMerge) {
          const side = sideOf(graph, fed, a, false);
          const toLane = side === "left" ? 0 : b.lanes - 1;
          const fromLane = clampLane(a, laneOfOffset(a, laneCentreOffset(b, toLane)));
          const link: LaneLink = {
            node,
            from: a.id,
            fromLane,
            to: b.id,
            toLane,
            kind: "merge",
            side,
            trunk: fed.id,
          };
          links.push(link, ...innerLanes(a, b, link));
          continue;
        }
        const lanes = Math.max(a.lanes, b.lanes);
        const seen = new Set<string>();
        for (let k = 0; k < lanes; k++) {
          const fromLane = Math.min(k, a.lanes - 1);
          const toLane = Math.min(k, b.lanes - 1);
          const key = `${fromLane}>${toLane}`;
          if (seen.has(key)) continue;
          seen.add(key);
          links.push({
            node,
            from: a.id,
            fromLane,
            to: b.id,
            toLane,
            kind: "through",
            side: null,
            trunk: null,
          });
        }
      }
    }
  }
  return links;
}

/**
 * The other lanes of a branch whose centres meet a lane of the other road at the node (a 4-lane line
 * splitting into two 2-lane ones, 2+2 ↔ 4): the same kind as the branch's own link, listed after it,
 * so `branchLink` still answers the outermost lane. Measured by offset at the node, where both
 * centrelines meet (OSM shares the node).
 */
function innerLanes(a: Segment, b: Segment, primary: LaneLink): LaneLink[] {
  const out: LaneLink[] = [];
  for (let k = 0; k < a.lanes; k++) {
    if (k === primary.fromLane) continue;
    const toLane = laneOfOffset(b, laneCentreOffset(a, k));
    const isOnB = toLane >= 0 && toLane < b.lanes && toLane !== primary.toLane;
    if (isOnB) out.push({ ...primary, fromLane: k, toLane });
  }
  return out;
}

/** Index of a graph's links (by the array, which the graph keeps for its life). */
type LinkIndex = {
  branch: Map<string, LaneLink>;
  mergeFrom: Map<number, LaneLink>;
  divergeTo: Map<number, LaneLink>;
};
const indexes = new WeakMap<readonly LaneLink[], LinkIndex>();
function indexOf(links: readonly LaneLink[]): LinkIndex {
  const cached = indexes.get(links);
  if (cached) return cached;
  const index: LinkIndex = { branch: new Map(), mergeFrom: new Map(), divergeTo: new Map() };
  for (const l of links) {
    if (l.kind === "through") continue;
    const key = `${l.from}>${l.to}`;
    // The first is the branch's own (outermost) lane; innerLanes come after it.
    if (!index.branch.has(key)) index.branch.set(key, l);
    if (l.kind === "merge" && !index.mergeFrom.has(l.from)) index.mergeFrom.set(l.from, l);
    if (l.kind === "diverge" && !index.divergeTo.has(l.to)) index.divergeTo.set(l.to, l);
  }
  indexes.set(links, index);
  return index;
}

/** The merge or diverge link from segment `from` into `to`, if they meet as one (its outermost lane). */
export function branchLink(links: readonly LaneLink[], from: number, to: number): LaneLink | null {
  return indexOf(links).branch.get(`${from}>${to}`) ?? null;
}

/** The merge a ramp segment ends in. */
export const mergeFrom = (links: readonly LaneLink[], seg: number): LaneLink | null =>
  indexOf(links).mergeFrom.get(seg) ?? null;

/** Where a point is on the main line of a merge, along its polyline: see onTrunk. */
export type TrunkPlace = {
  /** Metres before the merge node along the main line (negative: past it). */
  toNode: number;
  /** Offset left of the main line's direction (m). */
  lateral: number;
  /** The main line's surface there (local y), null where unknown. */
  surfaceY: number | null;
  /** The main line's direction of travel there. */
  dir: Vector3;
};

/** How far back from the node (and on past it) the main line is followed (m). */
const TRUNK_REACH_M = 260;

/**
 * Where `p` is on the main line a merge runs into: projected onto the main line's own segments,
 * from TRUNK_REACH_M before the node (the trunk and the same run's segments before it) to past it
 * (the link's `to`), so the distance follows the curves and the height the grades. Null when p is
 * off that carriageway (more than its half width and a metre from the centreline). Why not a
 * straight line from the node (as merging.ts first did): on a curve or a crest the cars 40–90 m
 * back were off it.
 */
export function onTrunk(graph: RoadGraph, link: LaneLink, p: Vector3): TrunkPlace | null {
  if (link.trunk === null) return null;
  const trunk = graph.segments[link.trunk];
  const chain: Array<{ seg: Segment; toNodeAtEnd: number }> = [];
  let seg: Segment | undefined = trunk;
  let toNodeAtEnd = 0;
  while (seg && toNodeAtEnd < TRUNK_REACH_M && chain.length < 8) {
    chain.push({ seg, toNodeAtEnd });
    toNodeAtEnd += seg.length;
    const here: Segment = seg;
    const start = here.oneway === -1 ? here.to : here.from;
    seg = (graph.nodes.get(start) ?? [])
      .map((id) => graph.segments[id])
      .find((o) => o !== here && runOf(o) === runOf(here) && arrives(o, start));
  }
  const after = graph.segments[link.to];
  const isMainAfter = runOf(after) === runOf(trunk);
  if (isMainAfter) chain.push({ seg: after, toNodeAtEnd: -after.length });
  let best: { place: TrunkPlace; dist: number } | null = null;
  for (const { seg: s, toNodeAtEnd: atEnd } of chain) {
    const hit = graph.nearestOn(s, p);
    const isOn = hit.dist <= s.line.width / 2 + 1;
    const isCloser = best === null || hit.dist < best.dist;
    if (!isOn || !isCloser) continue;
    const sense = s.oneway === -1 ? -1 : 1;
    const travelled = sense === 1 ? hit.s : s.length - hit.s;
    const dir = graph.sample(s, hit.s).dir.clone().multiplyScalar(sense);
    const place = {
      toNode: atEnd + (s.length - travelled),
      lateral: hit.lateral * sense,
      surfaceY: graph.surfaceY(s, hit.s),
      dir,
    };
    best = { place, dist: hit.dist };
  }
  return best?.place ?? null;
}
/**
 * The point `p` on a ramp, moved into the main line's lane where the ramp runs over the main
 * line's carriageway: the taper of a merge (the ramp's centreline, drawn by OSM into the main
 * line's centreline, would take the car across the main line's lanes) or of a diverge. `p` stays
 * where it is when it is not between the main line's centreline and that lane's centre, or is on
 * another level (the 二層 C1). Returns a new point (y kept).
 *
 * How: project onto the trunk, and if the lateral offset is inside the outermost lane's centre on
 * the link's side, put it on that centre. Why not a parallel 加速車線 of its own: the decks have
 * none; the OSM lines taper the ramp into the main line, and the deck between them is one surface.
 */
export function intoTrunkLane(graph: RoadGraph, link: LaneLink, p: Vector3, y: number | null): Vector3 {
  const out = p.clone();
  if (link.trunk === null || link.side === null) return out;
  const trunk = graph.segments[link.trunk];
  const hit = graph.nearestOn(trunk, p);
  const isBesideTrunk = hit.dist < trunk.line.width / 2 + 2;
  if (!isBesideTrunk) return out;
  const trunkY = graph.surfaceY(trunk, hit.s);
  const isOtherLevel = y !== null && trunkY !== null && Math.abs(trunkY - y) > 1.5;
  if (isOtherLevel) return out;
  const lane = link.kind === "merge" ? link.toLane : link.fromLane;
  const centre = laneCentreOffset(trunk, lane);
  const dirSign = trunk.oneway === -1 ? -1 : 1;
  const lateral = hit.lateral * dirSign;
  const isInside = link.side === "left" ? lateral < centre : lateral > centre;
  if (!isInside) return out;
  const { pos, dir } = graph.sample(trunk, hit.s);
  const travel = dir.multiplyScalar(dirSign);
  // Left of travel (dx, dz) is (dz, −dx) in this frame (roads.ts leftOf).
  out.x = pos.x + travel.z * centre;
  out.z = pos.z - travel.x * centre;
  return out;
}

/**
 * Segments (by id and direction of travel) from which the streets can still be reached, for the
 * traffic AI: a main line that runs into a tunnel's portal or a ground end the data does not join
 * (a dead end of the loaded expressway) is not driven into. The streets and every way back to
 * them count; computed backwards from the streets over the legal directions.
 */
export function reachesStreets(graph: RoadGraph): Set<number> {
  const ok = new Set<number>();
  const queue: number[] = [];
  for (const seg of graph.segments) {
    const isStreet = sourceOf(seg.line) !== "osm";
    if (!isStreet) continue;
    ok.add(seg.id);
    queue.push(seg.id);
  }
  while (queue.length > 0) {
    const seg = graph.segments[queue.pop()!];
    // Every segment that can drive into `seg`: one arriving at a node it leaves from.
    for (const node of [seg.from, seg.to]) {
      const canLeaveHere = seg.oneway === 0 || leaves(seg, node);
      if (!canLeaveHere) continue;
      for (const id of graph.nodes.get(node) ?? []) {
        if (ok.has(id)) continue;
        const other = graph.segments[id];
        const canArrive = other.oneway === 0 || arrives(other, node);
        if (!canArrive) continue;
        ok.add(id);
        queue.push(id);
      }
    }
  }
  return ok;
}

/** The lane a car was counted in (the 合図 check of a lane change). */
export type HeldLane = { seg: Segment; lane: number };

/**
 * The lane a car is in for the 合図 check of a lane change (第53条, main.ts): on `onRoad`, the road
 * under it, as painted, counted from the left edge line; null where no lanes are counted (one lane,
 * or not along the road). Up on a deck it is counted on the run the car was keeping to while it is
 * still within that run's deck: where another line's deck lies over it (the 1号 beside C1 at
 * 浜崎橋 JCT) locate may answer that run, whose centreline closes in on the car's, and the lane
 * "changed" with the frame, not the car. Not at the end of a ramp or a main line that merges: once
 * locate answers the road it runs into (the merge's trunk or the road on past the node) the car is
 * counted there, as it is going into that road's lanes (counted on the ramp, the move into the
 * main line read as a change across the ramp's own lanes, 45554540:33 → 24402611:26). Why not skip
 * the merge and diverge zones: a real change there needs 合図 too.
 */
export function laneCountedIn(
  graph: RoadGraph,
  p: Vector3,
  forward: Vector3,
  held: HeldLane | null,
  onRoad: RoadHit | null,
  onDeck: boolean,
  accept: (seg: Segment) => boolean,
): HeldLane | null {
  const isIntoMerged =
    held !== null &&
    onRoad !== null &&
    graph.laneLinks.some(
      (l) =>
        l.kind === "merge" && l.from === held.seg.id && (l.to === onRoad.seg.id || l.trunk === onRoad.seg.id),
    );
  const heldRun = onDeck && held && !isIntoMerged ? runOf(held.seg) : null;
  const onHeldRun =
    heldRun === null ? null : graph.locate(p, 8, (seg) => accept(seg) && runOf(seg) === heldRun);
  const isWithinHeldDeck = onHeldRun !== null && Math.abs(onHeldRun.lateral) < onHeldRun.seg.line.width / 2;
  const road = isWithinHeldDeck ? onHeldRun : onRoad;
  if (!road || road.seg.lanes < 2) return null;
  const align = forward.dot(road.dir);
  const isAlong = Math.abs(align) > 0.85;
  if (!isAlong) return null;
  return { seg: road.seg, lane: laneOfOffset(road.seg, road.lateral * Math.sign(align)) };
}

/**
 * The side of a lane change between two looks (laneCountedIn), or null: on the same segment, from one
 * of its lanes to another. Coming in from outside its lanes (a ramp's taper, a branch whose
 * centreline runs off the car's) crosses no lane line: the merge and the diverge have their own
 * 合図 and law (第75条の6・7), as the 進路変更禁止 check counts (laneChangeBan.test.ts).
 */
export function laneChangeSide(held: HeldLane | null, now: HeldLane): "left" | "right" | null {
  if (!held || held.seg !== now.seg || held.lane === now.lane) return null;
  const isLane = (lane: number) => lane >= 0 && lane < now.seg.lanes;
  if (!isLane(held.lane) || !isLane(now.lane)) return null;
  return now.lane < held.lane ? "left" : "right";
}
