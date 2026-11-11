import RAPIER from "@dimforge/rapier3d-compat";
import { BufferGeometry, MeshBasicMaterial, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import type { AppliedRegulations } from "../src/world/regulations";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { CROSSING_TIMING } from "../src/signals/plan";
import { UNTAGGED, type SignalRecord, type SignalTags } from "../src/signals/osmTags";
import type { SignalKit } from "../src/world/signalModels";
import { TrafficControl, type Approach } from "../src/world/trafficControl";
import { TrafficAI } from "../src/world/traffic-ai";
import { AutoDriver } from "../src/game/autoDriver";
import { junctionsAhead } from "../src/game/autoTraffic";
import { planRoute, type Route } from "../src/game/navigation";
import { gameClock } from "../src/world/ruleTime";
import { StreetLights } from "../src/world/streetLights";
import { SidewalkNetwork } from "../src/world/sidewalks";

// The kit stands in for signals.glb: the placement under test is the game's, not the model's.
const part = () => [{ geometry: new BufferGeometry(), material: new MeshBasicMaterial() }];
const kit = {
  head: part(),
  headRightArrow: part(),
  pedHead: part(),
  pole: part(),
  arm: part(),
  buttonBox: part(),
  lamp: new BufferGeometry(),
  arrowLamp: new BufferGeometry(),
  pedLamp: new BufferGeometry(),
  waitLamp: new BufferGeometry(),
  lens: new MeshBasicMaterial(),
  pedStop: new MeshBasicMaterial(),
  pedGo: new MeshBasicMaterial(),
  waitLens: new MeshBasicMaterial(),
} as unknown as SignalKit;
vi.mock("../src/world/signalModels", async (original) => ({
  ...(await original<typeof import("../src/world/signalModels")>()),
  signalKit: () => kit,
}));
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
/** A road from (x0, y0) to (x1, y1), metres east and north of the origin. */
const road = (x0: number, y0: number, x1: number, y1: number, width = 12): RoadLine => ({
  coords: [139.76 + x0 * LON, 35.68 + y0 * LAT, 139.76 + x1 * LON, 35.68 + y1 * LAT],
  width,
  oneway: 0,
  kind: "local",
});
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const MID_BLOCK: SignalTags = { ...UNTAGGED, midBlock: true, crossing: true, awayFromJunction: true };
const TO_WALK = CROSSING_TIMING.yellow + CROSSING_TIMING.allRed;

/**
 * `lines`, a JARTIC crosswalk across the segment through (x, y), a push-button 単路 record there,
 * and plain junction signal records at `junctions` (metres east, north).
 */
function build(
  lines: RoadLine[],
  x: number,
  y: number,
  junctions: Array<[number, number]> = [],
  options: { crosswalk?: boolean; tags?: SignalTags } = {},
) {
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const control = new TrafficControl(scene, () => 0, world);
  const graph = new RoadGraph(lines, frame);
  const hit = graph.nearest(at(x, y), 5);
  if (!hit) throw new Error("no segment there");
  const crossing = { seg: hit.seg, s: hit.s, pos: graph.sample(hit.seg, hit.s).pos.clone() };
  const regs: AppliedRegulations = {
    crossings: options.crosswalk === false ? [] : [crossing],
    signs: [],
    turnRules: [],
    stopLines: [],
    stopSigns: [],
    signals: [crossing.pos.clone(), ...junctions.map(([jx, jy]) => at(jx, jy))],
    junctionNames: [],
    footbridges: [],
    laneUse: [],
    hasMarkings: false,
  };
  const records: SignalRecord[] = [
    { lon: 139.76 + x * LON, lat: 35.68 + y * LAT, tags: options.tags ?? { ...MID_BLOCK, button: true } },
    ...junctions.map(([jx, jy]) => ({ lon: 139.76 + jx * LON, lat: 35.68 + jy * LAT, tags: UNTAGGED })),
  ];
  control.rebuild(graph, regs, records);
  const crossingAps = control.approaches.filter((a) => a.site === "crossing");
  const red = (t = 100) => {
    control.update(t);
    control.pressButton(crossing.seg, crossing.pos);
    control.update(t + TO_WALK + 1);
  };
  return { scene, world, control, graph, crossing, crossingAps, red };
}

describe("a 単路 crossing's approach says where its node and head are (not the segment's end)", () => {
  it("toNodeM is the stop line's distance to the crosswalk along the travel, and the head hangs just past the crosswalk", () => {
    const { world, crossingAps, crossing } = build([road(-150, 0, 150, 0)], 0, 0);
    try {
      expect(crossingAps).toHaveLength(2);
      for (const ap of crossingAps) {
        const line = ap.a.clone().add(ap.b).multiplyScalar(0.5);
        expect(ap.toNodeM).toBeCloseTo(ap.node.clone().sub(line).dot(ap.travel), 6);
        expect(ap.head?.distanceTo(crossing.pos)).toBeLessThan(8);
      }
    } finally {
      world.free();
    }
  });

  it("夜のにじみ (streetLights.ts) shines from the crossing's own heads, not from the street's end 150 m on", () => {
    const { world, control, scene, crossingAps } = build([road(-150, 0, 150, 0)], 0, 0);
    try {
      const lights = new StreetLights(scene, world, {
        groundAt: () => 0,
        isOpen: () => true,
        control,
        traffic: { forEachCar: () => undefined },
        player: { object: new Scene(), headlights: [] },
      }) as unknown as { signalHeads(): Array<{ x: number; z: number; approach: Approach }> };
      const heads = lights.signalHeads();
      expect(heads).toHaveLength(crossingAps.length);
      for (const h of heads) {
        const head = h.approach.head;
        if (!head) throw new Error("no head");
        expect(Math.hypot(h.x - head.x, h.z - head.z)).toBeLessThan(1e-6);
      }
    } finally {
      world.free();
    }
  });
});

describe("a signalled junction with a 単路 crossing 33 m short of it (autoTraffic.ts junctionsAhead)", () => {
  it("is still signalled for the route through it: the crossing's stop line in front does not hide the junction's", () => {
    const plus = [road(-110, 0, 0, 0), road(0, 0, 110, 0), road(0, -110, 0, 0), road(0, 0, 0, 110, 8)];
    const { world, control, graph } = build(plus, 33, 0, [[0, 0]]);
    try {
      const route = planRoute(
        graph,
        { seg: graph.nearest(at(100, 0), 5)!.seg, s: 0, dir: 1 },
        at(-100, 0),
        gameClock(2026, 10, 1, 600),
        [],
      );
      if (!route) throw new Error("no route");
      const junctions = junctionsAhead(route, graph, control, 0, route.length);
      const centre = junctions.find((j) => j.pos.distanceTo(at(0, 0)) < 2);
      expect(centre?.signalled).toBe(true);
    } finally {
      world.free();
    }
  });
});

describe("a 単路 stop line just inside its segment (the segment before ends 5 m short of the crosswalk)", () => {
  // Two lines joined end to end: the node between them is a segment boundary with no junction.
  const lines = [road(-150, 0, 0, 0), road(0, 0, 150, 0)];
  /** The eastbound approach and the segment before it, west of the join. */
  const pick = (graph: RoadGraph, aps: Approach[]) => {
    const ap = aps.find((a) => a.travel.x > 0);
    const before = graph.segments.find((s) => s !== ap?.seg);
    if (!ap || !before) throw new Error("no approach");
    return { ap, before };
  };
  const dirOn = (seg: Segment, east: boolean): 1 | -1 => {
    const isWestToEast = seg.pts[seg.pts.length - 1].x > seg.pts[0].x;
    return isWestToEast === east ? 1 : -1;
  };

  it("交通 AI: a car 30 m short of the join at 10 m/s sees the red on the next segment and stops for it", () => {
    const { world, control, graph, scene, crossingAps, red } = build(lines, 5, 0);
    try {
      const { ap, before } = pick(graph, crossingAps);
      expect(ap.at).toBeLessThan(2); // the stop line is a metre or so into its segment
      const ai = new TrafficAI(scene, world, () => 0, control) as unknown as {
        stopGap(graph: RoadGraph, car: unknown, dt: number): number;
      };
      const dir = dirOn(before, true);
      const car = {
        seg: before,
        dir,
        s: before.length - 30,
        speed: 10,
        route: [{ seg: ap.seg, dir: ap.dir }],
        served: -1,
        waited: 0,
        serial: 1,
      };
      red();
      const gap = ai.stopGap(graph, car, 0.016);
      expect(gap).toBeGreaterThan(30);
      expect(gap).toBeLessThan(40);
    } finally {
      world.free();
    }
  });

  it("自動運転: a route over the join holds short of the red on the next segment", () => {
    const { world, control, graph, crossingAps, red } = build(lines, 5, 0);
    try {
      const { ap, before } = pick(graph, crossingAps);
      const dir = dirOn(before, true);
      const start = dir === 1 ? before.length - 30 : 30;
      const route = planRoute(
        graph,
        { seg: before, s: start, dir },
        at(140, 0),
        gameClock(2026, 10, 1, 600),
        [],
      );
      if (!route) throw new Error("no route");
      expect(route.steps.map((s) => s.seg)).toContain(ap.seg);
      const driver = new AutoDriver() as unknown as {
        at: number;
        speed: number;
        blockAhead(route: Route, world: unknown, dt: number): number;
      };
      driver.at = 0;
      driver.speed = 10;
      const drive = { graph, control, turnRules: [], clock: gameClock(2026, 10, 1, 600), obstacles: [] };
      red();
      const block = driver.blockAhead(route, drive, 0.016);
      expect(block).toBeGreaterThan(29);
      expect(block).toBeLessThan(33);
    } finally {
      world.free();
    }
  });
});

describe("walk lights of a 単路 crossing serve its own crosswalk only (W1)", () => {
  it("a junction corner within 30 m of its stop line is not under its lights", () => {
    const plus = [road(-110, 0, 0, 0), road(0, 0, 110, 0), road(0, -110, 0, 0), road(0, 0, 0, 110, 8)];
    const { world, control, graph, crossing } = build(plus, 40, 0);
    try {
      const east = crossing.seg;
      const mouth = graph.sample(east, east.from === graph.segments[0].from ? 8 : east.length - 8).pos;
      expect(control.pedLight(east, mouth)).toBeNull();
      expect(control.pedLight(east, crossing.pos)).toBe("stop");
    } finally {
      world.free();
    }
  });

  it("a walker waiting at any signalled crosswalk presses (a no-op unless it is push-button)", () => {
    const { world, control, graph, crossing } = build([road(-150, 0, 150, 0)], 0, 0);
    try {
      let presses = 0;
      const net = new SidewalkNetwork(
        graph,
        [crossing],
        () => false,
        () => true,
        () => false,
        { stand: () => null, press: () => void presses++ },
      );
      const w = net.attach(crossing.pos.clone().add(new Vector3(-10, 0, 9)), 3);
      if (!w) throw new Error("no walk");
      // A leg across the crosswalk with no box to go to: the walker still presses while waiting.
      const a = crossing.pos.clone().add(new Vector3(0, 0, 7));
      const b = crossing.pos.clone().add(new Vector3(0, 0, -7));
      w.leg = { points: [a, b], i: 0, crossTo: 1, crossSeg: crossing.seg, next: { ...w }, pressAt: -1 };
      const noCar = { pos: new Vector3(0, 0, 1e6), speed: 0, forward: new Vector3(0, 0, 1) };
      net.advance(w, 0, 3, noCar, a.clone());
      expect(presses).toBeGreaterThan(0);
      void control;
    } finally {
      world.free();
    }
  });
});

describe("a 単路 record that gets no controller leaves the junction signals as they were (W2)", () => {
  const plus = [road(-110, 0, 0, 0), road(0, 0, 110, 0), road(0, -110, 0, 0), road(0, 0, 0, 110, 8)];
  /** highway=traffic_signals + crossing=traffic_signals, 18 m from the junction by OSM's map. */
  const SIGNAL_AND_CROSSING: SignalTags = { ...MID_BLOCK, junctionCapable: true };
  const junctionSignals = (control: TrafficControl) =>
    control.approaches.filter((a) => a.site === "junction" && a.kind === "signal");

  it("with no crosswalk to match, its signal node snaps to the junction as before T3", () => {
    const tagged = build(plus, 18, 0, [], { crosswalk: false, tags: SIGNAL_AND_CROSSING });
    const stripped = build(plus, 18, 0, [], { crosswalk: false, tags: UNTAGGED });
    try {
      expect(junctionSignals(stripped.control).length).toBeGreaterThan(0);
      expect(junctionSignals(tagged.control).length).toBe(junctionSignals(stripped.control).length);
      expect(tagged.crossingAps).toHaveLength(0);
    } finally {
      tagged.world.free();
      stripped.world.free();
    }
  });

  it("with its crosswalk, it is the crossing's (no junction signal from it) — and next to a signalled junction, nothing of its own", () => {
    const own = build(plus, 40, 0, [], { tags: SIGNAL_AND_CROSSING });
    try {
      expect(junctionSignals(own.control)).toHaveLength(0);
      expect(own.crossingAps.length).toBeGreaterThan(0);
    } finally {
      own.world.free();
    }
    const nearJunction = build(plus, 20, 0, [[0, 0]]);
    try {
      expect(junctionSignals(nearJunction.control).length).toBeGreaterThan(0);
      expect(nearJunction.crossingAps).toHaveLength(0);
    } finally {
      nearJunction.world.free();
    }
  });

  it("matches only a crosswalk on the road its records lie on, not a side street's within 15 m", () => {
    // The crosswalk is on the north arm 12 m up; the record is on the east road 10 m out.
    const scene = new Scene();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const control = new TrafficControl(scene, () => 0, world);
      const graph = new RoadGraph(plus, frame);
      const north = graph.nearest(at(0, 40), 5)!;
      const s = north.seg.from === graph.nearest(at(0, 0), 1)?.seg.from ? 12 : north.seg.length - 12;
      const crossing = { seg: north.seg, s, pos: graph.sample(north.seg, s).pos.clone() };
      const regs: AppliedRegulations = {
        crossings: [crossing],
        signs: [],
        turnRules: [],
        stopLines: [],
        stopSigns: [],
        signals: [at(10, 0)],
        junctionNames: [],
        footbridges: [],
        laneUse: [],
        hasMarkings: false,
      };
      control.rebuild(graph, regs, [
        { lon: 139.76 + 10 * LON, lat: 35.68, tags: { ...MID_BLOCK, button: true } },
      ]);
      expect(control.approaches.filter((a) => a.site === "crossing")).toHaveLength(0);
    } finally {
      world.free();
    }
  });
});
