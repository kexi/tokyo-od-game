import { Vector3 } from "three";
import { laneLeftEdge, laneOfOffset, laneWidth } from "../world/laneChange";
import { mergeFrom, onTrunk, runOf, type LaneLink } from "../world/laneLinks";
import { classOf, isExpressway, sourceOf } from "../world/roadClass";
import type { RoadGraph, RoadHit, Segment } from "../world/roads";
import {
  ExpresswayLaw,
  EXIT_PREPARE_M,
  judgeExit,
  judgeMerge,
  QUEUE_M,
  RIGHT_EXIT_M,
  type MergeFollower,
  type XwFinding,
} from "./expresswayLaw";
import { mainCarsAt, taperOf, type Other } from "./merging";
import type { Route } from "./navigation";

/**
 * The player's car on the expressway, for main.ts: turns what the game knows (the road the car is
 * on, the traffic about, the route) into expresswayLaw.ts's samples, and catches the two moments
 * that rule on their own:
 *
 * - **coming into the main line** from a ramp (judgeMerge): the moment the car's lane on the main
 *   line goes from outside its lanes into one of them. Why not the moment RoadGraph.locate answers
 *   the main line instead of the ramp: locate prefers the main line wherever the decks overlap,
 *   70–85 m before the node, while the car is still in the ramp's lane beside the main line's (P6
 *   review C1: every entrance was booked). The ramp is remembered until then.
 * - **leaving it for an exit** (judgeExit): the car has stayed EXIT_CONFIRM_M on the branch's
 *   deck. Why not the first look on the branch: where the decks overlap locate can answer the
 *   other run for a look and come back (P6 review W4).
 *
 * Why a class of its own and not main.ts: main.ts's law check is a long run of street rules, and
 * this one keeps state across looks (the lanes driven, the ramp come from).
 */

/** Another vehicle about, as main.ts knows it (the traffic AI's cars). */
export type OtherVehicle = Other;

export type WatchInput = {
  graph: RoadGraph;
  /** The road under the car on its own level (RoadGraph.locate), or null. */
  hit: RoadHit | null;
  car: Vector3;
  forward: Vector3;
  /** Signed speed along the car's heading (km/h, − reversing). */
  kmh: number;
  now: number;
  hazard: boolean;
  others: readonly OtherVehicle[];
  sinceCrashS: number;
  /** The autopilot is giving way at a merge (autoDriver.yieldingAtMerge). */
  yielding: boolean;
  /** A stop the law or the police call for (expresswayLaw XwSample.mustStop). */
  mustStop: boolean;
  /** An accident is being dealt with. */
  accident: boolean;
  /** The navi's route and where the car is on it (for an exit to the right ahead). */
  route: Route | null;
  routeAt: number;
};

/** How far the car stays on a branch's deck before it has left the main line (m). */
export const EXIT_CONFIRM_M = 30;
/** A merge not completed within this far (m) is forgotten (the car went back, or a jump). */
const MERGE_FORGET_M = 400;

const isOsmExpressway = (seg: Segment) => isExpressway(seg.line) && sourceOf(seg.line) === "osm";
/** Lane edges of a segment, metres left of its centreline: [left, right]. */
const laneEdges = (seg: Segment) => {
  const left = laneLeftEdge(seg);
  return [left, left - seg.lanes * laneWidth(seg)] as const;
};

type PendingMerge = { link: LaneLink; ramp: Segment; until: number };
type PendingExit = { link: LaneLink; laneBefore: number | null; lanes: number; from: number };

export class ExpresswayWatch {
  readonly law = new ExpresswayLaw();
  private prev: Segment | null = null;
  /** Lanes held on the main line, by distance driven (m), the last 200 m. */
  private trail: Array<{ d: number; lane: number; at: Vector3 }> = [];
  private driven = 0;
  private last: Vector3 | null = null;
  private merging: PendingMerge | null = null;
  private leaving: PendingExit | null = null;
  private graph: RoadGraph | null = null;

  /** Jumped (warp, respawn), or off the expressway: start over. */
  reset(): void {
    this.law.reset();
    this.prev = null;
    this.trail = [];
    this.driven = 0;
    this.last = null;
    this.merging = null;
    this.leaving = null;
  }

  check(x: WatchInput): XwFinding[] {
    // A rebuilt road network has other segment ids: what was pending refers to the old one.
    const isNewGraph = this.graph !== x.graph;
    this.graph = x.graph;
    if (isNewGraph) {
      this.merging = null;
      this.leaving = null;
      this.prev = null;
    }
    const seg = x.hit?.seg ?? null;
    const isOnExpressway = seg !== null && isOsmExpressway(seg);
    if (!isOnExpressway || !x.hit) {
      this.reset();
      return [];
    }
    const hit = x.hit;
    const step = this.last ? Math.hypot(x.car.x - this.last.x, x.car.z - this.last.z) : 0;
    this.last = x.car.clone();
    const isJump = step >= 30;
    if (!isJump) this.driven += step;
    const sense = seg.oneway === -1 ? -1 : 1;
    const flow = hit.dir.clone().multiplyScalar(sense);
    const facing = x.forward.x * flow.x + x.forward.z * flow.z;
    const along = (x.kmh / 3.6) * facing;
    const lane = laneOfOffset(seg, hit.lateral * sense);
    const isMain = classOf(seg.line) === "expressway";
    const out: XwFinding[] = [];

    this.noteRoadChange(x.graph, seg);
    out.push(...this.judgeMerging(x, seg, lane));
    out.push(...this.judgeLeaving(x.graph, seg));
    this.prev = seg;
    const isOnBranch = this.leaving !== null;
    if (isMain && !isOnBranch) {
      this.trail.push({ d: this.driven, lane, at: x.car.clone() });
      while (this.trail.length > 0 && this.trail[0].d < this.driven - 200) this.trail.shift();
    }

    out.push(
      ...this.law.step({
        now: x.now,
        road: {
          id: runOf(seg) ?? `seg:${seg.id}`,
          kind: isMain ? "main" : "ramp",
          lanes: seg.lanes,
          lane,
          shoulderL: seg.line.section?.shoulderL ?? 0,
          shoulderR: seg.line.section?.shoulderR ?? 0,
        },
        along,
        facing,
        kmh: Math.abs(x.kmh),
        hazard: x.hazard,
        queueAhead: isQueueAhead(x, flow),
        sinceCrashS: x.sinceCrashS,
        mustStop: x.mustStop,
        accident: x.accident,
        waitingToMerge: x.yielding || this.isWaitingToMerge(x, seg),
        rightExitAhead: isRightExitAhead(x, seg),
      }),
    );
    return out;
  }

  /** A new run under the car: a ramp into a main line starts a merge, a main line into a branch an exit. */
  private noteRoadChange(graph: RoadGraph, seg: Segment): void {
    const prev = this.prev;
    const isNewRoad = prev !== null && runOf(prev) !== runOf(seg);
    if (!prev || !isNewRoad) return;
    const leaving = this.leaving;
    const isBackOnMain = leaving !== null && runOf(seg) === runOf(graph.segments[leaving.link.from]);
    if (isBackOnMain) {
      this.leaving = null;
      return;
    }
    const link = findBranch(graph, prev, seg);
    if (!link) return;
    // 第75条の6・第75条の7第1項 are for a car coming onto the main line from a ramp. From another
    // main line (a JCT) only where signs designate it (第75条の6第1項括弧書): there are none in the data.
    const isFromRamp = classOf(prev.line) === "ramp" && classOf(seg.line) === "expressway";
    if (link.kind === "merge" && isFromRamp) {
      this.merging = { link, ramp: prev, until: this.driven + MERGE_FORGET_M };
      return;
    }
    const isFromMain = classOf(prev.line) === "expressway";
    if (link.kind === "diverge" && isFromMain && this.leaving === null) {
      this.leaving = {
        link,
        laneBefore: laneBeforeNode(graph, link, this.trail),
        lanes: prev.lanes,
        from: this.driven,
      };
    }
  }

  /** The car's lane comes into the main line's lanes: 第75条の6 and 第75条の7第1項 there. */
  private judgeMerging(x: WatchInput, seg: Segment, lane: number): XwFinding[] {
    const m = this.merging;
    if (!m) return [];
    const isForgotten = this.driven > m.until;
    const isOnMain = runOf(seg) === runOf(x.graph.segments[m.link.to]);
    if (isForgotten || !isOnMain) {
      if (isForgotten) this.merging = null;
      return [];
    }
    const isInLanes = lane >= 0 && lane < seg.lanes;
    if (!isInLanes) return [];
    this.merging = null;
    return judgeMerge({
      speed: Math.abs(x.kmh) / 3.6,
      followers: followers(x, m.link, lane),
      rampGapM: rampGap(x.graph, m.ramp, seg, x.car, m.link),
    });
  }

  /** On the branch's deck for EXIT_CONFIRM_M: 第75条の7第2項 for the lane it came from. */
  private judgeLeaving(graph: RoadGraph, seg: Segment): XwFinding[] {
    const e = this.leaving;
    if (!e) return [];
    const isOnBranch = runOf(seg) === runOf(graph.segments[e.link.to]);
    const hasLeft = isOnBranch && this.driven - e.from >= EXIT_CONFIRM_M;
    if (!hasLeft) return [];
    this.leaving = null;
    this.trail = [];
    if (e.laneBefore === null) return [];
    const found = judgeExit({ lanes: e.lanes, laneBefore: e.laneBefore, side: e.link.side ?? "left" });
    return found ? [found] : [];
  }

  /** On a ramp's last stretch before its merge, with main-line traffic coming: giving way (第75条の6). */
  private isWaitingToMerge(x: WatchInput, seg: Segment): boolean {
    const link = mergeFrom(x.graph.laneLinks, seg.id);
    if (!link || !x.hit) return false;
    const toEnd = seg.oneway === -1 ? x.hit.s : seg.length - x.hit.s;
    const isNearEnd = toEnd <= taperOf(x.graph, link) + 60;
    if (!isNearEnd) return false;
    const cars = mainCarsAt(x.graph, link, x.others, link.toLane);
    return cars.some((c) => c.toMerge > -10 && c.toMerge < 120);
  }
}

/**
 * The main-line lane the car was in EXIT_PREPARE_M before the diverge's node (the nearest look to
 * that point, before the node). Why not EXIT_PREPARE_M before the car was found on the branch:
 * where the decks overlap that is tens of metres past the node.
 */
function laneBeforeNode(
  graph: RoadGraph,
  link: LaneLink,
  trail: ReadonlyArray<{ lane: number; at: Vector3 }>,
): number | null {
  const main = graph.segments[link.from];
  const end = main.oneway === -1 ? 0 : main.length;
  const node = graph.sample(main, end).pos;
  const dir = graph.sample(main, end).dir.multiplyScalar(main.oneway === -1 ? -1 : 1);
  let best: { lane: number; miss: number } | null = null;
  for (const t of trail) {
    const before = (node.x - t.at.x) * dir.x + (node.z - t.at.z) * dir.z;
    const isBefore = before > 0;
    const miss = Math.abs(before - EXIT_PREPARE_M);
    const isNearer = best === null || miss < best.miss;
    if (isBefore && isNearer) best = { lane: t.lane, miss };
  }
  const isNearEnough = best !== null && best.miss < 25;
  return isNearEnough ? best!.lane : null;
}

/** Main-line vehicles behind the car in the lane it came into, along the main line's polyline. */
function followers(x: WatchInput, link: LaneLink, lane: number): MergeFollower[] {
  const own = onTrunk(x.graph, link, x.car);
  if (!own) return [];
  return mainCarsAt(x.graph, link, x.others, lane)
    .filter((c) => c.toMerge > own.toNode)
    .map((c) => ({ gapM: c.toMerge - own.toNode - c.half - 2.25, speed: c.speed }));
}

/**
 * The merge or diverge link between the runs of two segments. By run, not by segment: the car is
 * found on the main line from where the ramp's lane runs over it (RoadGraph.locate prefers the main
 * line), which is the segment before the node of a merge and the one after the node of a diverge.
 */
function findBranch(graph: RoadGraph, from: Segment, to: Segment): LaneLink | null {
  const a = runOf(from);
  const b = runOf(to);
  const runAt = (id: number) => runOf(graph.segments[id]);
  const isBetween = (l: LaneLink) => l.kind !== "through" && runAt(l.from) === a && runAt(l.to) === b;
  return graph.laneLinks.find(isBetween) ?? null;
}

/** A vehicle standing or crawling within QUEUE_M ahead in the car's lane (渋滞). */
function isQueueAhead(x: WatchInput, flow: Vector3): boolean {
  return x.others.some((o) => {
    const dx = o.position.x - x.car.x;
    const dz = o.position.z - x.car.z;
    const ahead = dx * flow.x + dz * flow.z;
    const lateral = Math.abs(dx * flow.z - dz * flow.x);
    const isSameLevel = Math.abs(o.position.y - x.car.y) < 3;
    const isSlow = o.speed < 2;
    return ahead > 0 && ahead < QUEUE_M && lateral < 1.8 && isSameLevel && isSlow;
  });
}

/**
 * An exit or a branch to the right within RIGHT_EXIT_M: on the navi's route, or, with no route,
 * any such diverge along the run the car is on (it may be making for it: 第20条第3項).
 */
function isRightExitAhead(x: WatchInput, seg: Segment): boolean {
  const route = x.route;
  if (route) {
    const isRightAhead = (l: { kind: string; side: string | null; at: number }) =>
      l.kind === "diverge" && l.side === "right" && l.at > x.routeAt && l.at - x.routeAt < RIGHT_EXIT_M;
    return (route.links ?? []).some(isRightAhead);
  }
  const g = x.graph;
  let cur: Segment | undefined = seg;
  let ahead = seg.oneway === -1 ? (x.hit?.s ?? 0) : seg.length - (x.hit?.s ?? 0);
  for (let hop = 0; cur && ahead < RIGHT_EXIT_M && hop < 12; hop++) {
    const here: Segment = cur;
    const fromHere = g.laneLinks.filter((l) => l.from === here.id);
    const isRightBranch = fromHere.some((l) => l.kind === "diverge" && l.side === "right");
    if (isRightBranch) return true;
    const on = fromHere.find((l) => l.kind === "through" || runOf(g.segments[l.to]) === runOf(here));
    cur = on ? g.segments[on.to] : undefined;
    ahead += cur?.length ?? 0;
  }
  return false;
}

/**
 * How far apart the ramp's lane and the main line's lanes were (m, edge to edge) where the car came
 * into a main lane: the ramp's centreline at the car, its lane edge on the main line's side, and the
 * main line's lane edge on the ramp's side. > 0: the car crossed the 導流帯 to get in.
 */
function rampGap(graph: RoadGraph, ramp: Segment, main: Segment, car: Vector3, link: LaneLink): number {
  const onRamp = graph.nearestOn(ramp, car);
  const centre = graph.sample(ramp, onRamp.s).pos;
  const toMain = graph.nearestOn(main, centre);
  const sense = main.oneway === -1 ? -1 : 1;
  const lateral = toMain.lateral * sense;
  const [rampLeft, rampRight] = laneEdges(ramp);
  const [mainLeft, mainRight] = laneEdges(main);
  const isLeft = (link.side ?? "left") === "left";
  return isLeft ? lateral + rampRight - mainLeft : mainRight - (lateral + rampLeft);
}
