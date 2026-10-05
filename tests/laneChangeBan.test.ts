import { readFileSync } from "node:fs";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import { pointAt } from "../src/game/junctionView";
import { laneAt, planRoute, type Route } from "../src/game/navigation";
import { steerLimit, WHEELBASE } from "../src/physics/vehicle";
import { isLaneChangeBanned, laneBand, laneOfOffset } from "../src/world/laneChange";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { TrafficControl } from "../src/world/trafficControl";

// Local frame: x east, z south. These helpers take x east, y north metres.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const line = (pts: Array<[number, number]>, width: number): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width,
  oneway: 0,
  kind: "local",
});
const clock = gameClock(2026, 10, 1, 600);

/**
 * A 14 m two-way street (2 lanes each way, 3.5 m each) running north on x = 0, split by side
 * streets to the west at y = -250 and -110, to a junction at y = 0 with a street east; it goes on
 * north to a second street east at y = 100, and x = 200 joins the two (so the destination on it
 * can be reached by turning right at either).
 */
const grid = () => {
  const lines = [
    line(
      [
        [0, -400],
        [0, -250],
      ],
      14,
    ),
    line(
      [
        [0, -250],
        [0, -110],
      ],
      14,
    ),
    line(
      [
        [0, -110],
        [0, 0],
      ],
      14,
    ),
    line(
      [
        [0, 0],
        [0, 100],
      ],
      14,
    ),
    line(
      [
        [0, 100],
        [0, 200],
      ],
      14,
    ),
    line(
      [
        [-80, -250],
        [0, -250],
      ],
      6,
    ),
    line(
      [
        [-80, -110],
        [0, -110],
      ],
      6,
    ),
    line(
      [
        [0, 0],
        [200, 0],
      ],
      10,
    ),
    line(
      [
        [0, 100],
        [200, 100],
      ],
      10,
    ),
    line(
      [
        [200, 0],
        [200, 50],
      ],
      8,
    ),
    line(
      [
        [200, 50],
        [200, 100],
      ],
      8,
    ),
  ];
  const graph = new RoadGraph(lines, frame);
  const on = (y: number) => {
    const hit = graph.nearest(at(0, y), 3);
    if (!hit) throw new Error(`no street at y ${y}`);
    return hit.seg;
  };
  for (const y of [-300, -200, -50, 50, 150]) on(y).lanes = 2;
  return { graph, on };
};
/** Mark the main street's segment at y as 進路変更禁止 (JARTIC 52 / 119: yellow lane lines). */
const ban = (seg: Segment) => {
  seg.noLaneChange = true;
  return seg;
};
const startAt = (graph: RoadGraph, y: number, lane?: number) => {
  const hit = graph.nearest(at(0, y), 3);
  if (!hit) throw new Error("no street");
  const north = at(0, y + 1).sub(at(0, y));
  const dir: 1 | -1 = hit.dir.dot(north) >= 0 ? 1 : -1;
  return { seg: hit.seg, s: hit.s, dir, lane };
};
const plan = (graph: RoadGraph, from: number, to: [number, number], lane?: number): Route => {
  const route = planRoute(graph, startAt(graph, from, lane), at(to[0], to[1]), clock, []);
  if (!route) throw new Error("no route");
  return route;
};
const stepAt = (route: Route, d: number) => {
  let k = 0;
  while (k < route.stepStart.length - 1 && route.stepStart[k + 1] <= d) k++;
  return route.steps[k];
};

/**
 * The 進路変更禁止違反 check of main.ts run along the green arrows (RouteArrows draws them with
 * pointAt on the route): on a banned segment, aligned with it, the lane counted from the left
 * kerb with laneOfOffset. Returns, per banned segment, the lanes the arrows were seen in, and the
 * route distances where the check would book a change.
 */
const ribbonCheck = (graph: RoadGraph, route: Route) => {
  const seen = new Map<Segment, Set<number>>();
  const booked: number[] = [];
  let track: { seg: Segment; lane: number } | null = null;
  for (let d = 0; d < route.length - 1; d += 0.5) {
    const p = pointAt(route, d);
    const dir = pointAt(route, d + 0.5)
      .sub(p)
      .setY(0)
      .normalize();
    const step = stepAt(route, d);
    const seg = step.seg;
    const along = graph.nearestOn(seg, p);
    const segDir = graph.sample(seg, along.s).dir;
    const align = dir.dot(segDir);
    if (!isLaneChangeBanned(seg) || Math.abs(align) <= 0.8) {
      track = null;
      continue;
    }
    const lane = laneOfOffset(seg, along.lateral * Math.sign(align));
    const isLaneChange =
      track !== null &&
      track.seg === seg &&
      track.lane !== lane &&
      track.lane >= 0 &&
      track.lane < seg.lanes &&
      lane >= 0 &&
      lane < seg.lanes;
    if (isLaneChange) booked.push(d);
    track = { seg, lane };
    if (lane >= 0 && lane < seg.lanes) seen.set(seg, (seen.get(seg) ?? new Set()).add(lane));
  }
  return { seen, booked };
};
/** Lane (as the check counts it) of the arrows at route distance d. */
const ribbonLane = (graph: RoadGraph, route: Route, d: number) => {
  const p = pointAt(route, d);
  const step = stepAt(route, d);
  return laneOfOffset(step.seg, graph.nearestOn(step.seg, p).lateral * step.dir);
};
/** Route distance of the main street's point at y (it runs north from the start). */
const dOf = (fromY: number, y: number) => y - fromY;

describe("lanes where changing them is prohibited (進路変更禁止, 第26条の2第3項)", () => {
  it("counts lanes the way the yellow lines are painted, and only bans where there are lanes", () => {
    const { on } = grid();
    const seg = ban(on(-50));
    expect(isLaneChangeBanned(seg)).toBe(true);
    // 3.5 m lanes on the left half of a 14 m street: 7…3.5 m left of the centre is lane 0.
    expect(laneOfOffset(seg, 6)).toBe(0);
    expect(laneOfOffset(seg, 2)).toBe(1);
    expect(laneOfOffset(seg, -1)).toBe(2); // across the centre line
    const band = laneBand(seg, 1);
    expect(band.min).toBeGreaterThan(0);
    expect(band.max).toBeLessThan(3.5);
    // One lane each way: no lane line to cross, nothing to book.
    const single = { ...seg, lanes: 1 };
    expect(isLaneChangeBanned(single)).toBe(false);
  });

  it("keeps one lane along a yellow stretch up to a right turn, moving over before it begins", () => {
    const { graph, on } = grid();
    // y -110 … 0: yellow up to the junction. The plain plan moves right from 120 m before the turn
    // over 35 m, which would put the crossing inside the stretch.
    ban(on(-50));
    const route = plan(graph, -380, [150, 0]);
    expect(route.maneuvers[0]?.turn).toBe("right");
    const { seen, booked } = ribbonCheck(graph, route);
    // Never a change the violation check would book, and one lane only: the right one (第34条第2項).
    expect(booked).toEqual([]);
    expect([...(seen.get(on(-50)) ?? [])]).toEqual([1]);
    // The change is in the allowed part before it, done at least 10 m (BAN_LEAD) before the line.
    const lineStart = dOf(-380, -110);
    expect(ribbonLane(graph, route, lineStart - 10)).toBe(1);
    expect(ribbonLane(graph, route, lineStart - 80)).toBe(0);
    // The plan the autopilot reads agrees: the rightmost lane all along the stretch.
    for (let d = lineStart; d < lineStart + 80; d += 5) expect(laneAt(route, d).lane).toBe(1);
  });

  it("changes after the yellow stretch when there is room before the turn", () => {
    const { graph, on } = grid();
    ban(on(-200)); // y -250 … -110; 110 m free before the junction
    const route = plan(graph, -380, [150, 0]);
    const { seen, booked } = ribbonCheck(graph, route);
    expect(booked).toEqual([]);
    // Left lane through the yellow stretch (第20条第1項), the right lane by the junction.
    expect([...(seen.get(on(-200)) ?? [])]).toEqual([0]);
    expect(ribbonLane(graph, route, dOf(-380, -110) + 5)).toBe(0);
    expect(ribbonLane(graph, route, dOf(-380, -25))).toBe(1);
  });

  it("holds the lane of a car already behind the yellow line, and plans round the turn it cannot make", () => {
    const { graph, on } = grid();
    ban(on(-50));
    // In the left lane 90 m before the junction: the right turn there cannot be reached legally,
    // so the route goes on to the next junction and turns there.
    const left = plan(graph, -90, [200, 50], 0);
    expect(ribbonCheck(graph, left).booked).toEqual([]);
    expect([...(ribbonCheck(graph, left).seen.get(on(-50)) ?? [])]).toEqual([0]);
    const firstTurn = left.maneuvers.find((m) => m.turn === "right");
    expect(firstTurn?.pos.distanceTo(at(0, 100))).toBeLessThan(2);
    // In the right lane the same start turns at once.
    const right = plan(graph, -90, [200, 50], 1);
    expect(ribbonCheck(graph, right).booked).toEqual([]);
    expect(right.maneuvers[0]?.pos.distanceTo(at(0, 0))).toBeLessThan(2);
  });

  it("drives the autopilot through the stretch without crossing the yellow line", () => {
    const { graph, on } = grid();
    const yellow = ban(on(-50));
    const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
    const world: DriveWorld = { graph, control: noSignals, turnRules: [], clock, obstacles: [] };
    const driver = new AutoDriver();
    const start = at(-5.25, -300); // left lane, heading north
    let yaw = Math.PI;
    driver.place(start, yaw);
    expect(driver.plan(world, at(150, 0))).toBe(true);
    const pos = start.clone();
    let v = 0;
    let steer = 0;
    const lanes = new Set<number>();
    const dt = 1 / 30;
    for (let t = 0; t < 60; t += dt) {
      const out = driver.update(dt, world, { position: pos, yaw, speed: v });
      if (out.done) break;
      steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * dt);
      yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
      pos.x += Math.sin(yaw) * v * dt;
      pos.z += Math.cos(yaw) * v * dt;
      const q = graph.nearestOn(yellow, pos);
      const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const align = f.dot(graph.sample(yellow, q.s).dir);
      const isOnIt = q.dist < 7 && q.s > 1 && q.s < yellow.length - 1 && Math.abs(align) > 0.8;
      const lane = laneOfOffset(yellow, q.lateral * Math.sign(align));
      // As the check counts: a lane of this direction (the turn's curve may reach the centre line).
      if (isOnIt && lane >= 0 && lane < yellow.lanes) lanes.add(lane);
    }
    // The check of main.ts would have seen one lane only: the right one, for the right turn.
    expect([...lanes]).toEqual([1]);
  });

  it("is booked by the violation check with the same definition the route plans with", () => {
    // main.ts must not count lanes or decide "banned" on its own: a second copy of the arithmetic
    // is how the arrows came to ask for what the check books.
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const check = main.slice(main.indexOf("// 進路変更禁止: crossing a yellow lane line"));
    const body = check.slice(0, check.indexOf("laneTrack = { seg, lane }"));
    expect(body).toContain("isLaneChangeBanned(seg)");
    expect(body).toContain("laneOfOffset(seg,");
    expect(body).not.toContain("noLaneChange");
    // A lane change is from one lane to another: coming in over the edge or the centre line (the
    // curve of a turn) crosses no yellow lane line.
    expect(body).toContain("laneTrack.lane >= 0");
  });

  it("does not book 通行帯違反 for keeping the right lane behind a yellow line (第20条第3項)", () => {
    // The route may hold the rightmost lane through a long stretch before a right turn; 第20条第3項
    // lets a car stay in the lane 第26条の2第3項 keeps it in.
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const check = main.slice(main.indexOf("// 通行帯違反 (第20条第1項)"));
    const body = check.slice(0, check.indexOf("book(VIOLATIONS.laneUse"));
    expect(body).toContain("!isLaneChangeBanned(s)");
  });
});
