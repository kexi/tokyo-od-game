import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { XwChunk, XwRunSummary } from "../src/expressway/format";
import { DEFAULT_DATA_DIR, readExpresswayFiles } from "../scripts/expresswayFiles";
import { planeAt } from "../src/expressway/geo";
import { AutoDriver, isDeckOnlyNode, type DriveWorld } from "../src/game/autoDriver";
import { laneFor } from "../src/game/drivePath";
import { judgeMerge } from "../src/game/expresswayLaw";
import { mergeSpeedCap, taperOf } from "../src/game/merging";
import { planRoute, type RouteLink } from "../src/game/navigation";
import { LocalFrame } from "../src/geo/frame";
import { steerLimit, WHEELBASE } from "../src/physics/vehicle";
import { expresswayRoadInput, joinExpressway } from "../src/world/expresswayRoads";
import { laneCentreOffset } from "../src/world/laneChange";
import { intoTrunkLane, reachesStreets, runOf } from "../src/world/laneLinks";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import { backAlongRun } from "../src/world/traffic-ai";
import type { TrafficControl } from "../src/world/trafficControl";

// The synthetic section of tests/expresswayDrive.test.ts, rebuilt here: a two-lane main line A going
// east (plane x 0 → 400, y = 0) on a crest, and a one-lane ramp R from the ground at (150, −40) to
// A's centreline at x = 300 (it comes in from the south: A's right). A street runs north on x = 140.
const plane = planeAt(139.75, 35.65);
const N = 36.9;
const frame = new LocalFrame(35.65, 139.751, 40);
const ellipsoidal = (_lat: number, _lon: number, h: number) => h + N;
const zA = (s: number) => 12 - (s - 200) ** 2 / 2800;
const gA = (s: number) => -(s - 200) / 1400;
const clock = gameClock(2026, 10, 1, 600);

function chunkOf(
  id: string,
  run: string,
  s0: number,
  s1: number,
  step: number,
  at: (s: number) => number[],
): XwChunk {
  const st: number[] = [];
  for (let s = s0; s <= s1 + 1e-9; s += step) {
    const [x, y, z, g] = at(s);
    const [lon, lat] = plane.toLonLat(x, y);
    st.push(s, lon, lat, z, 0, 3, g);
  }
  const isRamp = run === "R";
  return {
    id,
    run,
    chain: run,
    k: Number(id.split(":")[1]),
    cls: isRamp ? "ramp" : "expressway",
    ref: isRamp ? null : "C1",
    name: isRamp ? null : null,
    structure: "viaduct",
    over: null,
    lanes: isRamp ? 1 : 2,
    laneWidth: 3.25,
    shoulderL: isRamp ? 1 : 1.25,
    shoulderR: isRamp ? 0.5 : 0.75,
    basis: isRamp ? "assumption" : "statute",
    V: 60,
    maxspeed: isRamp ? null : 50,
    vh: 50,
    gmax: 0.05,
    g0: at(s0)[3],
    g1: at(s1)[3],
    h0: 0,
    h1: 0,
    girder: 2.2,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
  };
}

function section(): { chunks: XwChunk[]; runs: XwRunSummary[] } {
  const a0 = chunkOf("A:0", "A", 0, 200, 20, (s) => [s, 0, zA(s), gA(s)]);
  const a1 = chunkOf("A:1", "A", 200, 400, 20, (s) => [s, 0, zA(s), gA(s)]);
  a0.next = "A:1";
  a1.prev = "A:0";
  const len = Math.hypot(150, 40);
  const dir = [150 / len, 40 / len];
  const zEnd = zA(300);
  const r0 = chunkOf("R:0", "R", 0, len, len / 10, (s) => {
    const t = s / len;
    const z = 3 + (zEnd - 3) * (3 * t * t - 2 * t * t * t);
    const g = ((zEnd - 3) * (6 * t - 6 * t * t)) / len;
    return [150 + dir[0] * s, -40 + dir[1] * s, z, g];
  });
  r0.h0 = Math.atan2(40, 150);
  r0.h1 = r0.h0;
  const summary = (id: string, cls: "expressway" | "ramp", chunks: string[], start: object, end: object) =>
    ({
      id,
      chain: id,
      cls,
      ref: null,
      lengthM: 0,
      V: 60,
      tagV: 60,
      planV: 60,
      minRadiusM: 0,
      maxShiftM: 0,
      steps: [],
      start,
      end,
      chunks,
      structure: null,
    }) as XwRunSummary;
  return {
    chunks: [a0, a1, r0],
    runs: [
      summary("A", "expressway", ["A:0", "A:1"], { kind: "open" }, { kind: "open" }),
      summary("R", "ramp", ["R:0"], { kind: "ground" }, { kind: "junction", parent: "A", parentS: 300 }),
    ],
  };
}

const local = (x: number, y: number, h = 40) => {
  const [lon, lat] = plane.toLonLat(x, y);
  return frame.toLocal(lat, lon, h);
};
const street = (x: number): RoadLine => ({
  coords: [...plane.toLonLat(x, -200), ...plane.toLonLat(x, 0)],
  width: 9,
  oneway: 0,
  kind: "local",
});
const area: RoadLine[] = [
  [-600, -600, 900, -600],
  [900, -600, 900, 600],
  [900, 600, -600, 600],
  [-600, 600, -600, -600],
].map(([x0, y0, x1, y1]) => ({
  coords: [...plane.toLonLat(x0, y0), ...plane.toLonLat(x1, y1)],
  width: 6,
  oneway: 0,
  kind: "local",
}));

function graphOf(): RoadGraph {
  const { chunks, runs } = section();
  const graph = new RoadGraph(
    joinExpressway([street(140), ...area], expresswayRoadInput(chunks, runs, ellipsoidal), () => {}),
    frame,
  );
  // The terrain at the ground ends' height (T.P. 3 m), so the streets have a surface too.
  graph.ground = () => local(150, -40, 3 + N).y;
  return graph;
}

/** How far along A a local point is (plane x), and how far left of A's centreline (plane y). */
const onA = (p: Vector3): [number, number] => {
  const g = frame.toGeodetic(p);
  return plane.toXY(g.lon, g.lat);
};

const underDeck = (x: number, z: number) => {
  const [ax, ay] = onA(new Vector3(x, 0, z));
  return ax > 320 && Math.abs(ay) < 8;
};

const underLeftLane = (x: number, z: number) => {
  const [ax, ay] = onA(new Vector3(x, 0, z));
  return ax > 40 && ax < 200 && ay > 0 && ay < 8;
};

describe("車線単位の接続 (LaneLink) at a merge", () => {
  const graph = graphOf();
  const xid = (id: number) => graph.segments[id].line.xid;

  it("links the ramp into the main line's outermost lane on its side, beside the stretch it runs over", () => {
    const merge = graph.laneLinks.filter((l) => l.kind === "merge");
    expect(merge).toHaveLength(1);
    const [m] = merge;
    // R comes in from the south of an eastbound A: from A's right, into its right lane (1).
    expect([xid(m.from), m.fromLane, xid(m.to), m.toLane, m.side]).toEqual(["R:0", 0, "A:1", 1, "right"]);
    const trunk = graph.segments[m.trunk!];
    expect(trunk.line.xid).toBe("A:1");
    expect(trunk.to).toBe(m.node);
  });

  it("links each lane straight on at a seam of one run", () => {
    const seam = graph.laneLinks.filter((l) => l.kind === "through" && xid(l.from) === "A:0");
    expect(seam.map((l) => [l.fromLane, l.toLane])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("places a car further back than the trunk chunk is long on the run's earlier chunk (QA placeCar)", () => {
    const m = graph.laneLinks.find((l) => l.kind === "merge")!;
    const trunk = graph.segments[m.trunk!];
    const before = graph.segments.find((x) => x.line.xid === "A:0" && x.to === trunk.from)!;
    expect(backAlongRun(graph, trunk, 30)).toEqual({ seg: trunk, s: 30 });
    const back = backAlongRun(graph, trunk, -50);
    expect(back.seg).toBe(before);
    expect(back.s).toBeCloseTo(before.length - 50, 6);
    // Past the run's start: at its start, never off the deck's open end.
    const first = backAlongRun(graph, trunk, -1e4);
    expect([first.seg.line.xid, first.s]).toEqual(["A:0", 0]);
  });

  it("knows the main line's open end is a dead end: the AI never enters it, the streets stay reachable", () => {
    const reach = reachesStreets(graph);
    for (const seg of graph.segments) {
      const isDeck = runOf(seg) !== null;
      expect([seg.line.xid ?? seg.line.kind, reach.has(seg.id)]).toEqual([
        seg.line.xid ?? seg.line.kind,
        !isDeck && seg.line.cls !== "ramp",
      ]);
    }
  });

  it("puts a ramp point that lies inside the main line's right lane centre onto that centre (the taper)", () => {
    const m = graph.laneLinks.find((l) => l.kind === "merge")!;
    const trunk = graph.segments[m.trunk!];
    const centre = laneCentreOffset(trunk, 1);
    // On A's centreline 10 m before the node: inside the right lane's centre (−1.625 m).
    const p = local(290, 0, zA(290) + N);
    const moved = intoTrunkLane(graph, m, p.clone().setY(0), graph.surfaceY(trunk, 90));
    const [, y] = onA(moved.clone().setY(p.y));
    expect(y).toBeCloseTo(centre, 1);
    // Out beyond the lane centre (south of it) it stays where it is.
    const outside = local(290, -4, zA(290) + N).setY(0);
    expect(intoTrunkLane(graph, m, outside, graph.surfaceY(trunk, 90)).distanceTo(outside)).toBeLessThan(
      1e-9,
    );
  });
});

describe("the navi's route over the expressway (planRoute, drivePath)", () => {
  const graph = graphOf();
  const start = () => {
    const hit = graph.nearest(local(140, -150), 6)!;
    return { seg: hit.seg, s: hit.s, dir: (hit.dir.z < 0 ? 1 : -1) as 1 | -1 };
  };

  it("takes the entrance ramp onto the main line, with the merge and an entrance call named by the line", () => {
    const route = planRoute(graph, start(), local(380, 0, zA(380) + N), clock, [])!;
    const xids = route.steps.map((st) => st.seg.line.xid ?? null).filter((x) => x !== null);
    expect(xids).toContain("R:0");
    expect(xids.at(-1)).toBe("A:1");
    expect(route.links?.map((l) => [l.kind, l.side])).toEqual([["merge", "right"]]);
    const enter = route.maneuvers.find((m) => m.xw?.kind === "enter");
    expect(enter?.xw).toEqual({ kind: "enter", name: null, ref: "C1" });
  });

  it("drives the ramp's last stretch in the main line's right lane, never across it to the centreline", () => {
    const route = planRoute(graph, start(), local(380, 0, zA(380) + N), clock, [])!;
    const link = route.links![0];
    const centre = laneCentreOffset(graph.segments[link.trunk!], 1);
    let checked = 0;
    for (let i = 0; i < route.points.length; i++) {
      const d = route.cum[i];
      const isMergeStretch = d > link.at - 40 && d < link.at + 40;
      if (!isMergeStretch) continue;
      const [, y] = onA(route.points[i]);
      // Lateral of A's centreline (plane y, + north = left): never inside the right lane's centre.
      expect(y, `at ${d.toFixed(1)}`).toBeLessThanOrEqual(centre + 0.35);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("takes the lane a diverge leaves from 400 m before it, and not before (第75条の7第2項)", () => {
    const a = graph.segments.find((s) => s.line.xid === "A:0")!;
    const step = { seg: a, dir: 1 as const };
    const link = { kind: "diverge", run: "A", toRun: "X", at: 500, fromLane: 1 } as RouteLink;
    expect(laneFor(150, step, [], [], null, [link]).lane).toBe(1);
    expect(laneFor(50, step, [], [], null, [link]).lane).toBe(0);
  });
});

describe("合流 (第75条の6): the gap the merging car takes", () => {
  it("lets a main-line car by that it would otherwise cut in front of", () => {
    // 60 m to go at 50 km/h; a car 70 m back at 60 km/h reaches the merge point with it.
    const { cap, yielding } = mergeSpeedCap(60, 50 / 3.6, [{ toMerge: 70, speed: 60 / 3.6, half: 2.25 }]);
    expect(yielding).toBe(true);
    expect(cap).toBeLessThan(50 / 3.6);
  });

  it("goes on into a clear gap: a car far behind, or one already past", () => {
    const far = mergeSpeedCap(60, 50 / 3.6, [{ toMerge: 250, speed: 60 / 3.6, half: 2.25 }]);
    const past = mergeSpeedCap(60, 50 / 3.6, [{ toMerge: -40, speed: 60 / 3.6, half: 2.25 }]);
    expect([far.yielding, past.yielding]).toEqual([false, false]);
  });

  it("waits at the end of the ramp when the next main-line car would be right behind it", () => {
    // 8 m to go at 3 m/s (there in 2 s); a car 40 m back at 54 km/h would be 10 m behind by then.
    expect(mergeSpeedCap(8, 3, [{ toMerge: 40, speed: 15, half: 2.25 }]).cap).toBe(0);
    // One that will have passed by then is no reason to wait.
    expect(mergeSpeedCap(8, 3, [{ toMerge: 5, speed: 15, half: 2.25 }]).yielding).toBe(false);
  });

  it("never takes a gap the law check would book: what it accepts, judgeMerge passes", () => {
    // Tapers about those of the generated entrances (taperOf, see below) and the decks' overlap.
    for (const taper of [72, 83]) {
      for (let behind = 0; behind <= 120; behind += 2) {
        for (const v of [8, 12, 16, 20]) {
          const self = 14;
          const toMerge = taper + 5;
          const car = { toMerge: toMerge + behind + 4.5, speed: v, half: 2.25 };
          const { yielding } = mergeSpeedCap(toMerge, self, [car], taper);
          if (yielding) continue;
          // The follower's bumper gap where the car's lane comes beside the main lane (the taper's
          // start: where the law check finds it come into the lane).
          const gap = 5 + behind + 4.5 - v * (5 / self) - 4.5;
          if (gap < 0) continue;
          const found = judgeMerge({ speed: self, followers: [{ gapM: gap, speed: v }], rampGapM: 0 });
          expect(found, `taper ${taper}: ${behind} m back at ${v} m/s`).toEqual([]);
        }
      }
    }
  });
});

describe("the autopilot drives street → ramp → main line and merges behind traffic", () => {
  const graph = graphOf();
  const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;
  /** The main line's right lane at distance x along A (local frame, on the deck). */
  const laneAt = (x: number) => {
    const p = local(
      x,
      laneCentreOffset(
        graph.segments.find((s) => s.line.xid === "A:0")!,
        1,
      ),
      zA(x) + N,
    );
    return p;
  };

  /** Kinematic run (the physics car's limits, as tests/drivePath.test.ts) with a main-line car. */
  function run(
    other: { from: number; speed: number } | null,
    isPavement?: (x: number, z: number) => boolean,
  ) {
    const driver = new AutoDriver();
    const pos = local(140 - 1.6, -170, 3 + N);
    let yaw = Math.PI; // north (−z)
    driver.place(pos, yaw);
    let v = 0;
    let steer = 0;
    const key = {};
    const world = (t: number): DriveWorld => {
      const x = other ? other.from + other.speed * t : -1e6;
      const vehicles =
        other && x < 400
          ? [
              {
                position: laneAt(x),
                kind: "vehicle" as const,
                speed: other.speed,
                heading: Math.PI / 2,
                halfLength: 2.25,
                key,
              },
            ]
          : [];
      // The car itself among them, as main.ts lists the player's car to the autopilot driving it.
      const self = {
        position: pos,
        kind: "vehicle" as const,
        speed: v,
        heading: yaw,
        halfLength: 2.25,
        key: driver,
      };
      return {
        graph,
        control: noSignals,
        turnRules: [],
        clock,
        obstacles: [],
        vehicles: [...vehicles, self],
        isPavement,
      };
    };
    if (!driver.plan(world(0), local(390, 0, zA(390) + N))) throw new Error("no route");
    const dt = 1 / 30;
    const track: Array<{
      t: number;
      x: number;
      y: number;
      otherX: number;
      yielding: boolean;
      signal: "left" | "right" | null;
      manoeuvring: boolean;
      kmh: number;
    }> = [];
    for (let t = 0; t < 120; t += dt) {
      const out = driver.update(dt, world(t), { position: pos, yaw, speed: v });
      if (out.done || out.gaveUp) break;
      steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * dt);
      yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
      pos.x += Math.sin(yaw) * v * dt;
      pos.z += Math.cos(yaw) * v * dt;
      // On its own level: the deck's surface under it, else the ground.
      const hit = graph.locate(pos, 15);
      const y = hit ? graph.surfaceY(hit.seg, hit.s) : null;
      if (y !== null) pos.y = y + 0.86;
      const [x, ly] = onA(pos);
      track.push({
        t,
        x,
        y: ly,
        otherX: other ? other.from + other.speed * t : -1e6,
        yielding: driver.yieldingAtMerge,
        signal: driver.signal,
        manoeuvring: driver.activity === "manoeuvre",
        kmh: v * 3.6,
      });
    }
    return { track, driver };
  }

  it("reaches the main line on its own and keeps out of the left lane through the merge", () => {
    const { track } = run(null);
    const merged = track.find((p) => p.x > 310);
    expect(merged, "reached A past the merge").toBeDefined();
    for (const p of track.filter((q) => q.x > 280 && q.x < 330)) expect(p.y).toBeLessThan(0.5);
  });

  it("counts a node of decks only as no junction, and a deck's end at a street as one", () => {
    const a0 = graph.segments.find((s) => s.line.xid === "A:0")!;
    const a1 = graph.segments.find((s) => s.line.xid === "A:1")!;
    const ramp = graph.segments.find((s) => s.line.xid === "R:0")!;
    const ground = graph.segments.find((s) => runOf(s) === null)!;
    expect(isDeckOnlyNode({ inSeg: ramp, others: [a0, a1] })).toBe(true);
    // Any road at the node that is no deck makes it a 交差点 (the 第36条 and 第50条 checks apply).
    expect(isDeckOnlyNode({ inSeg: ramp, others: [a1, ground] })).toBe(false);
    expect(isDeckOnlyNode({ inSeg: ground, others: [ramp] })).toBe(false);
  });

  it("keeps its pace through the merge node with nobody about: no 徐行 as at a junction with a priority road", () => {
    const { track } = run(null);
    const atNode = track.filter((p) => p.x > 270 && p.x < 320);
    expect(atNode.length).toBeGreaterThan(0);
    const slowest = Math.min(...atNode.map((p) => p.kmh));
    expect(slowest, "km/h through the taper and the node").toBeGreaterThan(30);
  });

  it("drives on along the deck over the street's pavements below: no lane change, no 合図, no 切り返し", () => {
    // PLATEAU paving is a plan (x, z) test: here a pavement lies under the whole main line past
    // the merge, as the street's footways under the viaduct before 浜崎橋 JCT (24402611:24) do.
    const { track } = run(null, underDeck);
    const beyond = track.filter((p) => p.x > 325 && p.x < 380);
    expect(beyond.length, "drove along the deck past the merge").toBeGreaterThan(0);
    for (const p of beyond) {
      expect(p.manoeuvring, `t ${p.t.toFixed(1)}`).toBe(false);
      expect(p.signal, `t ${p.t.toFixed(1)}`).toBeNull();
      expect(p.y, `t ${p.t.toFixed(1)}: in the right lane`).toBeLessThan(0.5);
    }
  });

  it("keeps the deck's left lane over a pavement below it: no move to the right lane, no 合図", () => {
    // The lane choice (onPavement) and the kerb (keepLeftOffset) read the paving too: under lane 0
    // and beyond its left edge, a street's footway would push the car into lane 1.
    const lane0 = laneCentreOffset(
      graph.segments.find((s) => s.line.xid === "A:0")!,
      0,
    );
    const pos = local(20, lane0, zA(20) + N + 0.86);
    let yaw = Math.PI / 2; // east, along A
    const driver = new AutoDriver();
    driver.place(pos, yaw);
    const world: DriveWorld = {
      graph,
      control: noSignals,
      turnRules: [],
      clock,
      obstacles: [],
      isPavement: underLeftLane,
    };
    expect(driver.plan(world, local(190, lane0, zA(190) + N))).toBe(true);
    let v = 0;
    let steer = 0;
    const dt = 1 / 30;
    const seen: Array<{ x: number; y: number; signal: string | null }> = [];
    for (let t = 0; t < 40; t += dt) {
      const out = driver.update(dt, world, { position: pos, yaw, speed: v });
      if (out.done) break;
      steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
      v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * dt);
      yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
      pos.x += Math.sin(yaw) * v * dt;
      pos.z += Math.cos(yaw) * v * dt;
      const hit = graph.locate(pos, 15);
      const y = hit ? graph.surfaceY(hit.seg, hit.s) : null;
      if (y !== null) pos.y = y + 0.86;
      const [x, ly] = onA(pos);
      if (t > 4) seen.push({ x, y: ly, signal: driver.signal });
    }
    const overPavement = seen.filter((p) => p.x > 50 && p.x < 180);
    expect(overPavement.length).toBeGreaterThan(0);
    for (const p of overPavement) {
      expect(Math.abs(p.y - lane0), `x ${p.x.toFixed(0)}: on lane 0's centre`).toBeLessThan(0.3);
      expect(p.signal, `x ${p.x.toFixed(0)}`).toBeNull();
    }
  });

  it("gives way to a main-line car arriving with it and comes in behind it, never alongside", () => {
    const alone = run(null).track;
    const tMerge = alone.find((p) => p.x >= 300)!.t;
    const speed = Math.min(14, 270 / tMerge);
    const { track } = run({ from: 300 - speed * tMerge, speed });
    expect(track.some((p) => p.yielding)).toBe(true);
    const atMerge = track.find((p) => p.x >= 300);
    expect(atMerge, "it still merged").toBeDefined();
    // The other car is ahead of it by a following gap when it reaches the merge point.
    expect(atMerge!.otherX - atMerge!.x).toBeGreaterThan(8);
    for (const p of track) {
      // Side by side: along A within a car length, and in or over its right lane (plane y −1.6).
      const isBeside = Math.abs(p.otherX - p.x) < 6 && Math.abs(p.y + 1.625) < 2.5;
      expect(isBeside, `t ${p.t.toFixed(1)}`).toBe(false);
    }
  });
});

describe("W6: a ramp's foot joined along GSI's at-grade line however far it runs from the decks", () => {
  it("walks on over a GSI 高速道路 line kept in the graph (more than 40 m from every chunk) to the street", () => {
    const { chunks, runs } = section();
    const gsi = (pts: number[][]): RoadLine => ({
      coords: pts.flatMap(([x, y]) => plane.toLonLat(x, y)),
      width: 7,
      oneway: 0,
      kind: "highway",
    });
    // The at-grade part: one line from the ramp's foot (replaced, near the deck), a second one from
    // 90 m on (kept: no point near a chunk), to a street along y = −200. It goes on ahead of the
    // foot first (S6 PR 7c1, F1: a line is the ramp's own only within its half width of the lead
    // point 5 m ahead).
    const atGrade = [
      gsi([
        [150, -40],
        [140, -42.7],
        [147, -130],
      ]),
      gsi([
        [147, -130],
        [147, -200],
      ]),
    ];
    const road: RoadLine = {
      coords: [...plane.toLonLat(0, -200), ...plane.toLonLat(147, -200), ...plane.toLonLat(300, -200)],
      width: 9,
      oneway: 0,
      kind: "local",
    };
    const reports: unknown[] = [];
    const lines = joinExpressway(
      [...atGrade, road, ...area],
      expresswayRoadInput(chunks, runs, ellipsoidal),
      (d) => reports.push(d),
    );
    expect(reports).toEqual([]);
    const connector = lines.find((l) => l.cls === "ramp" && l.structure === "ground")!;
    expect(connector).toBeDefined();
    const [x, y] = plane.toXY(connector.coords[0], connector.coords[1]);
    expect([Math.round(x), Math.round(y)]).toEqual([147, -200]);
  });
});

describe("the generated test section (public/data/expressway): its merges and diverges", () => {
  const { chunks, runs } = readExpresswayFiles(DEFAULT_DATA_DIR);
  const graph = new RoadGraph(
    joinExpressway([], expresswayRoadInput(chunks, runs, ellipsoidal), () => {}),
    new LocalFrame(35.6537, 139.7508, 40),
  );
  const run = (id: number) => runOf(graph.segments[id]);
  // The 芝公園・汐留 section (the rainbow range's runs are checked by their own tests).
  const sectionRuns = new Set([
    "207111988",
    "24402611",
    "24402125",
    "4848762",
    "4853799",
    "45021976",
    "4853798",
    "45068172",
    "813455519",
  ]);
  // Each branch's own (outermost) lane: the one branchLink answers (inner lanes of a 2+2 ↔ 4 come after).
  const own = new Set<string>();
  const branches = graph.laneLinks
    .filter((l) => {
      const key = `${l.from}>${l.to}`;
      const isOwn = l.kind !== "through" && !own.has(key);
      if (isOwn) own.add(key);
      return isOwn && sectionRuns.has(run(l.from) ?? "") && sectionRuns.has(run(l.to) ?? "");
    })
    .map(
      (l) =>
        `${l.kind} ${run(l.from)}→${run(l.to)} ${l.side} lane ${l.kind === "merge" ? l.toLane : l.fromLane}`,
    )
    .toSorted();

  it("measures each entrance's taper (where its lane comes beside the main line's) 40–95 m before the node (lane edge to lane edge; the decks overlap from 72–83 m)", () => {
    const merges = graph.laneLinks.filter(
      (l) => l.kind === "merge" && runOf(graph.segments[l.from]) !== null,
    );
    const entrances = merges.filter((l) => ["207111988", "45068172"].includes(run(l.from) ?? ""));
    expect(entrances).toHaveLength(2);
    for (const l of entrances) {
      const taper = taperOf(graph, l);
      expect(taper, run(l.from) ?? "").toBeGreaterThan(40);
      expect(taper, run(l.from) ?? "").toBeLessThan(95);
    }
  });

  it("has the entrances merging from the left into lane 0, the exits leaving lane 0 to the left, and 浜崎橋 JCT to the right", () => {
    expect(branches).toEqual([
      "diverge 24402611→24402125 left lane 0",
      "diverge 24402611→4848762 right lane 1",
      "diverge 24402611→4853799 left lane 0",
      "diverge 45021976→4853798 left lane 0",
      "merge 207111988→24402611 left lane 0",
      "merge 45068172→45021976 left lane 0",
      "merge 813455519→45021976 left lane 0",
    ]);
  });
});
