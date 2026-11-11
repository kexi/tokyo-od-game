import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_DIR, readExpresswayFiles } from "../scripts/expresswayFiles";
import { ExpresswayWatch, type OtherVehicle } from "../src/game/expresswayWatch";
import { planRoute, type Route } from "../src/game/navigation";
import { LocalFrame } from "../src/geo/frame";
import { expresswayRoadInput, joinExpressway } from "../src/world/expresswayRoads";
import { laneCentreOffset } from "../src/world/laneChange";
import { laneCountedIn, runOf, type HeldLane } from "../src/world/laneLinks";
import { leftOf, RoadGraph, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";

// The generated test section (public/data/expressway): the player's car driven along the navi's
// path (drivePath, the lanes and the ramps' tapers) through the real entrances, exits and the JCT,
// looked at five times a second as main.ts does, with RoadGraph.locate answering the road under it.
const { chunks, runs } = readExpresswayFiles(DEFAULT_DATA_DIR);
const graph = new RoadGraph(
  joinExpressway(
    [],
    expresswayRoadInput(chunks, runs, (_a, _b, h) => h + 36.9),
    () => {},
  ),
  new LocalFrame(35.6537, 139.7508, 40),
);
const clock = gameClock(2026, 11, 11, 600);
const segOf = (xid: string) => graph.segments.find((s) => s.line.xid === xid)!;
const KMH = 50;
const STEP_S = 0.2;

/** The path's point `d` metres on (its own polyline), on the deck under it. */
function pointOn(route: Route, d: number): { p: Vector3; dir: Vector3 } {
  let i = 1;
  let acc = 0;
  for (; i < route.points.length; i++) {
    const len = route.points[i].distanceTo(route.points[i - 1]);
    if (acc + len >= d) break;
    acc += len;
  }
  i = Math.min(i, route.points.length - 1);
  const a = route.points[i - 1];
  const b = route.points[i];
  const t = Math.min(1, Math.max(0, (d - acc) / Math.max(1e-6, a.distanceTo(b))));
  const p = a.clone().lerp(b, t);
  const seg = route.steps[route.stepOf[i]].seg;
  p.y = (graph.surfaceY(seg, graph.nearestOn(seg, p).s) ?? 0) + 0.86;
  return { p, dir: b.clone().sub(a).setY(0).normalize() };
}

const pathLength = (route: Route) =>
  route.points.reduce((sum, q, i) => (i === 0 ? 0 : sum + q.distanceTo(route.points[i - 1])), 0);

/**
 * Drive `route` from `from` metres to its end at KMH, with `others(t, p)` about, and return what
 * the watch booked (kind: detail key). `move(t, p, dir)` may push the car off the path.
 */
function drive(
  route: Route,
  options: {
    others?: (t: number, p: Vector3, dir: Vector3) => OtherVehicle[];
    move?: (d: number, p: Vector3, dir: Vector3) => Vector3;
    from?: number;
  } = {},
): string[] {
  const watch = new ExpresswayWatch();
  const found: string[] = [];
  const total = pathLength(route);
  let t = 0;
  for (let d = options.from ?? 0; d < total - 1; d += (KMH / 3.6) * STEP_S, t += STEP_S) {
    const on = pointOn(route, d);
    const p = options.move ? options.move(d, on.p, on.dir) : on.p;
    const hit = graph.locate(p, 30);
    const findings = watch.check({
      graph,
      hit,
      car: p,
      forward: on.dir,
      kmh: KMH,
      now: t * 1000,
      hazard: false,
      others: options.others?.(t, p, on.dir) ?? [],
      sinceCrashS: Infinity,
      yielding: false,
      mustStop: false,
      accident: false,
      route,
      routeAt: 0,
    });
    for (const f of findings) found.push(`${f.kind}:${f.detail.key}`);
  }
  return found;
}

/** The navi's route from (xid, share of it) to (xid, share), in the start's lane. */
function routeFrom(start: string, share: number, end: string, endShare: number, lane = 0): Route {
  const seg = segOf(start);
  const target = graph.sample(segOf(end), segOf(end).length * endShare).pos;
  return planRoute(graph, { seg, s: seg.length * share, dir: 1, lane }, target, clock, [])!;
}

/** A car of the traffic `behind` metres back along the main line's lane, at `kmh`. */
function carBehind(seg: Segment, lane: number, s: number, kmh: number): OtherVehicle {
  const { pos, dir: d } = graph.sample(seg, s);
  const p = pos.add(leftOf(d, laneCentreOffset(seg, lane)));
  p.y = (graph.surfaceY(seg, s) ?? 0) + 0.86;
  return { position: p, heading: Math.atan2(d.x, d.z), speed: kmh / 3.6, half: 2.25 };
}

describe("ExpresswayWatch on the generated data: the entrances (第75条の6・第75条の7第1項)", () => {
  // 芝公園入口 (207111988) into C1 内回り, and 汐留入口 (45068172) into C1 外回り.
  for (const [ramp, main, share] of [
    ["207111988:0", "24402611:22", 0.5],
    ["45068172:0", "45021976:3", 0.5],
  ] as const) {
    it(`books nothing for driving ${ramp}'s lane into the main line as the navi plans it`, () => {
      const route = routeFrom(ramp, 0.1, main, share);
      expect(route.links?.some((l) => l.kind === "merge")).toBe(true);
      expect(drive(route)).toEqual([]);
    });

    it(`books 本線車道通行車妨害 when ${ramp}'s car comes in right in front of a faster main-line car`, () => {
      const route = routeFrom(ramp, 0.1, main, share);
      const link = route.links!.find((l) => l.kind === "merge")!;
      const trunk = graph.segments[link.trunk!];
      // A car in the merge lane that is always 6 m behind the merging car, 30 km/h faster.
      const others = (_t: number, p: Vector3) => {
        const on = graph.nearestOn(trunk, p);
        return on.dist < 15 ? [carBehind(trunk, link.toLane, Math.max(0, on.s - 6 - 4.5), KMH + 30)] : [];
      };
      // 6 m behind is inside its reaction distance: booked as cutting in, with the gap.
      expect(drive(route, { others })).toContain("xwMergeObstruct:violationDetail.xwMergeCutIn");
    });
  }

  it("books 本線車道出入方法違反 for cutting across the 導流帯 into the main line", () => {
    const route = routeFrom("207111988:0", 0.1, "24402611:22", 0.5);
    const link = route.links!.find((l) => l.kind === "merge")!;
    const trunk = graph.segments[link.trunk!];
    // From 150 m before the node the car leaves the ramp straight for the main line's lane 0.
    const at = (d: number) => link.at - d;
    const move = (d: number, p: Vector3) => {
      const isCutting = at(d) < 150 && at(d) > 0;
      if (!isCutting) return p;
      const on = graph.nearestOn(trunk, p);
      const { pos, dir: dd } = graph.sample(trunk, on.s);
      const q = pos.add(leftOf(dd, laneCentreOffset(trunk, 0)));
      q.y = (graph.surfaceY(trunk, on.s) ?? 0) + 0.86;
      return q;
    };
    expect(drive(route, { move })).toContain("xwRampMethod:violationDetail.xwMergeNoAccel");
  });
});

describe("ExpresswayWatch on the generated data: the exits and the JCT (第75条の7第2項)", () => {
  it("books nothing for leaving by 芝公園出口 (4853799) from the left lane, as the navi plans it", () => {
    const route = routeFrom("24402611:16", 0.1, "4853799:0", 0.9);
    expect(route.links?.some((l) => l.kind === "diverge")).toBe(true);
    expect(drive(route)).toEqual([]);
  });

  it("books nothing at the 浜崎橋 JCT to 1号羽田線 (4848762) from the right lane", () => {
    const route = routeFrom("24402611:22", 0.05, "4848762:2", 0.5, 1);
    const diverge = route.links?.find((l) => l.kind === "diverge");
    expect(diverge?.side).toBe("right");
    expect(drive(route)).toEqual([]);
  });

  it("books 本線車道出入方法違反 for crossing from the right lane into 芝公園出口 at the last moment", () => {
    const route = routeFrom("24402611:16", 0.1, "4853799:0", 0.9);
    const link = route.links!.find((l) => l.kind === "diverge")!;
    const main = graph.segments[link.from];
    // In the right lane until 30 m before the node, then over into the exit.
    const move = (d: number, p: Vector3) => {
      const toNode = link.at - d;
      const isInRightLane = toNode > 30 && runOf(graph.locate(p, 30)?.seg ?? main) === runOf(main);
      if (!isInRightLane) return p;
      const on = graph.nearestOn(main, p);
      if (on.dist > 15) return p;
      const { pos, dir: dd } = graph.sample(main, on.s);
      const q = pos.add(leftOf(dd, laneCentreOffset(main, 1)));
      q.y = (graph.surfaceY(main, on.s) ?? 0) + 0.86;
      return q;
    };
    expect(drive(route, { move })).toContain("xwRampMethod:violationDetail.xwExitLate");
  });
});

/** The lane changes main.ts would count along `route` (laneCountedIn, held from one look to the next). */
function laneChanges(route: Route, preferHeldRun: boolean): string[] {
  const changes: string[] = [];
  let held: HeldLane | null = null;
  const total = pathLength(route);
  for (let d = 0; d < total - 1; d += (KMH / 3.6) * STEP_S) {
    const { p, dir: along } = pointOn(route, d);
    const hit = graph.locate(p, 30);
    const onRoad = hit && Math.abs(hit.lateral) < hit.seg.line.width / 2 + 1.5 ? hit : null;
    const counted = laneCountedIn(graph, p, along, preferHeldRun ? held : null, onRoad, true, () => true);
    const isChange = counted && held && held.seg === counted.seg && held.lane !== counted.lane;
    const isLane = counted !== null && counted.lane >= 0 && counted.lane < counted.seg.lanes;
    if (isChange && isLane) changes.push(`${counted.seg.line.xid} ${held!.lane}→${counted.lane}`);
    held = counted;
  }
  return changes;
}

describe("the lane counted for 合図 (第53条) where another line's deck lies over the car's (浜崎橋 JCT)", () => {
  it("counts no lane change for keeping C1 外回り's left lane past where the 1号's deck runs beside it", () => {
    // 汐留入口 → 外回り, through 45021976:6–7 where locate answers 45021972:0 (the 1号羽田線 deck).
    const route = routeFrom("45021976:4", 0.5, "45021976:8", 0.5);
    expect(route.steps.map((s) => runOf(s.seg))).not.toContain("45021972");
    expect(laneChanges(route, true)).toEqual([]);
    // Counted on whichever deck locate answers, the frame's lanes slide under the car.
    expect(laneChanges(route, false).some((c) => c.startsWith("45021972:0"))).toBe(true);
  });

  it("counts on the road under the car once it is off the held run's deck (an exit leaving the main line)", () => {
    // 芝公園出口 (4853798) leaving C1 外回り: a point on the exit's deck that the main line's run is
    // still found from (within 8 m) but whose deck it is past the edge of.
    const exit = segOf("4853798:0");
    const held: HeldLane = { seg: segOf("45021976:13"), lane: 0 };
    const run = runOf(held.seg);
    let found: { p: Vector3; dir: Vector3; s: number } | null = null;
    for (let s = 0; s < exit.length && !found; s += 0.5) {
      const { pos, dir: along } = graph.sample(exit, s);
      pos.y = (graph.surfaceY(exit, s) ?? 0) + 0.86;
      const main = graph.locate(pos, 8, (seg) => runOf(seg) === run);
      const isPastEdge = main !== null && Math.abs(main.lateral) > main.seg.line.width / 2 + 0.5;
      if (isPastEdge) found = { p: pos, dir: along, s };
    }
    expect(found, "a point on the exit past the main line's edge").not.toBeNull();
    const onRoad = { seg: exit, s: found!.s, lateral: 0, dir: found!.dir };
    const counted = laneCountedIn(graph, found!.p, found!.dir, held, onRoad, true, () => true);
    // The exit has one lane, so nothing is counted there. Counted on the main line, the move off it
    // would have read as a change across its lanes.
    expect(exit.lanes).toBe(1);
    expect(counted).toBeNull();
  });
});
