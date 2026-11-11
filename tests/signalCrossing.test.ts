import RAPIER from "@dimforge/rapier3d-compat";
import { BufferGeometry, Color, InstancedMesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import type { AppliedRegulations } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { CROSSING_TIMING } from "../src/signals/plan";
import { LAMP_COLOURS } from "../src/signals/heads";
import { UNTAGGED, type SignalRecord, type SignalTags } from "../src/signals/osmTags";
import type { SignalKit } from "../src/world/signalModels";
import { TrafficControl, type Approach } from "../src/world/trafficControl";
import { SignalViolationCheck } from "../src/game/signalViolations";
import { TrafficAI } from "../src/world/traffic-ai";
import { AutoDriver } from "../src/game/autoDriver";
import { planRoute, type Route } from "../src/game/navigation";
import { gameClock } from "../src/world/ruleTime";
import { SidewalkNetwork, type Walk } from "../src/world/sidewalks";

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
const C = [139.76, 35.68];
const D = 0.0018; // ≈ 160 m each way: a 320 m street with no junction on it
/** A straight 12 m two-way street running east–west, with one 横断歩道 in its middle. */
const street: RoadLine[] = [
  { coords: [C[0] - D, C[1], C[0] + D, C[1]], width: 12, kind: "local", oneway: 0 },
];

const MID_BLOCK: SignalTags = { ...UNTAGGED, midBlock: true, crossing: true, awayFromJunction: true };

/** The street, its crosswalk, and one OSM signal record 3 m from it with `tags` (or none: an old tile). */
function build(tags: SignalTags | null, scene = new Scene()) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const control = new TrafficControl(scene, () => 0, world);
  const graph = new RoadGraph(street, frame);
  const seg = graph.segments[0];
  const s = seg.length / 2;
  const crossing = { seg, s, pos: graph.sample(seg, s).pos.clone() };
  const regs: AppliedRegulations = {
    crossings: [crossing],
    signs: [],
    turnRules: [],
    stopLines: [],
    stopSigns: [],
    signals: [crossing.pos.clone().add(new Vector3(3, 0, 0))],
    junctionNames: [],
    footbridges: [],
    laneUse: [],
    hasMarkings: false,
  };
  const records: SignalRecord[] = tags ? [{ lon: C[0] + 0.00003, lat: C[1], tags }] : [];
  control.rebuild(graph, regs, records);
  const signals = () => control.approaches.filter((a) => a.kind === "signal");
  return { scene, world, control, graph, seg, crossing, regs, records, signals };
}

const OFF = new Color(LAMP_COLOURS.off);
const isLit = (mesh: InstancedMesh, i: number) => {
  const c = new Color();
  mesh.getColorAt(i, c);
  return Math.abs(c.r - OFF.r) + Math.abs(c.g - OFF.g) + Math.abs(c.b - OFF.b) > 1e-3;
};
/** Seconds from a press to the walkers' 青 (黄 then 全赤). */
const TO_WALK = CROSSING_TIMING.yellow + CROSSING_TIMING.allRed;

/** Drive the player's check along `ap` from 20 m before its stop line to 40 m past the crosswalk. */
function driveThrough(control: TrafficControl, ap: Approach, now: number) {
  const booked: number[] = [];
  const check = new SignalViolationCheck(control, (t) => booked.push(t));
  const t = ap.travel;
  const line = ap.a.clone().add(ap.b).multiplyScalar(0.5);
  const start = line.clone().addScaledVector(t, -20.37);
  let prev = start.clone();
  for (let d = 1; d <= 65; d++) {
    const cur = start.clone().addScaledVector(t, d);
    check.step(control.crossed(prev, cur), prev, cur, t, now + d * 50);
    prev = cur;
  }
  return booked;
}

describe("a 単路 push-button crossing (OSM crossing=traffic_signals away from junctions, button_operated=yes)", () => {
  it("gets its own controller: both directions face 3 灯 heads, both kerbs a walk head and a 押ボタン箱", () => {
    const scene = new Scene();
    const { world, control, signals } = build({ ...MID_BLOCK, button: true }, scene);
    try {
      const aps = signals();
      expect(aps).toHaveLength(2);
      expect(new Set(aps.map((a) => a.dir))).toEqual(new Set([1, -1]));
      expect(aps.every((a) => a.controller?.kind === "crossing")).toBe(true);
      expect(aps[0].controller?.plan.plan.template).toBe("pushButton");
      expect(control.crossingCounts()).toEqual({ crossingSignals: 1, pushButtons: 1 });
      const meshOf = (material: unknown) =>
        scene.children.find((o): o is InstancedMesh => o instanceof InstancedMesh && o.material === material);
      expect(meshOf(kit.lens)?.count).toBe(6); // 3 lamps × 2 directions
      expect(meshOf(kit.pedStop)?.count).toBe(2);
      expect(meshOf(kit.buttonBox[0].material)?.count).toBe(2);
      expect(meshOf(kit.waitLens)?.count).toBe(2);
      // Each stop line stands short of the crosswalk, on the approach's own side of it.
      for (const ap of aps) {
        const line = ap.a.clone().add(ap.b).multiplyScalar(0.5);
        const ahead = ap.node.clone().sub(line).dot(ap.travel);
        expect(ahead).toBeGreaterThan(2);
        expect(ahead).toBeLessThan(ap.exitM);
      }
    } finally {
      world.free();
    }
  });

  it("rests at the vehicles' 青 until pressed, then 黄 → 全赤 → walkers' 青, and the おまちください lamp lights between", () => {
    const scene = new Scene();
    const { world, control, signals, crossing } = build({ ...MID_BLOCK, button: true }, scene);
    try {
      const ap = signals()[0];
      for (let t = 0; t < 300; t += 10) {
        control.update(t);
        expect(control.permits(ap, "through")).toBe("go");
        expect(control.mayCross(crossing.seg, crossing.pos)).toBe(false);
      }
      control.update(300);
      expect(control.pressButton(crossing.seg, crossing.pos)).toBe(true);
      const wait = scene.children.find(
        (o): o is InstancedMesh => o instanceof InstancedMesh && o.material === kit.waitLens,
      );
      if (!wait) throw new Error("no wait lamps");
      control.update(300.5);
      expect(control.permits(ap, "through")).toBe("stopIfAble");
      expect(isLit(wait, 0) && isLit(wait, 1)).toBe(true);
      control.update(300 + TO_WALK + 0.5);
      expect(control.permits(ap, "through")).toBe("stop");
      expect(control.pedLight(crossing.seg, crossing.pos)).toBe("go");
      expect(isLit(wait, 0)).toBe(false);
      control.update(300 + TO_WALK + CROSSING_TIMING.walk + 0.5);
      expect(control.pedLight(crossing.seg, crossing.pos)).toBe("flash");
      control.update(400);
      expect(control.permits(ap, "through")).toBe("go");
    } finally {
      world.free();
    }
  });

  it("keeps a walk under way across a rebuild of the network round the player", () => {
    const { world, control, graph, regs, records, crossing } = build({ ...MID_BLOCK, button: true });
    try {
      control.update(100);
      control.pressButton(crossing.seg, crossing.pos);
      control.update(100 + TO_WALK + 1);
      expect(control.pedLight(crossing.seg, crossing.pos)).toBe("go");
      control.rebuild(graph, regs, records);
      control.update(100 + TO_WALK + 2);
      expect(control.pedLight(crossing.seg, crossing.pos)).toBe("go");
    } finally {
      world.free();
    }
  });
});

describe("違反判定・自動運転・交通 AI read a 単路 crossing through permits", () => {
  it("信号無視: books crossing the stop line on 赤, nothing on 青 or 黄", () => {
    const { world, control, signals, crossing } = build({ ...MID_BLOCK, button: true });
    try {
      for (const ap of signals()) {
        control.update(50);
        expect(driveThrough(control, ap, 50_000)).toEqual([]);
        control.pressButton(crossing.seg, crossing.pos);
        control.update(51);
        expect(control.permits(ap, "through")).toBe("stopIfAble");
        expect(driveThrough(control, ap, 51_000)).toEqual([]);
        control.update(50 + TO_WALK + 2);
        expect(control.permits(ap, "through")).toBe("stop");
        expect(driveThrough(control, ap, 60_000)).toHaveLength(1);
        control.update(500); // back at rest before the other direction
      }
    } finally {
      world.free();
    }
  });

  it("交通 AI: stops short of the line on 赤 when it can, and drives on at 青", () => {
    const { world, control, graph, scene, signals, crossing } = build({ ...MID_BLOCK, button: true });
    try {
      const ap = signals()[0];
      const ai = new TrafficAI(scene, world, () => 0, control) as unknown as {
        stopGap(graph: RoadGraph, car: unknown, dt: number): number;
      };
      const car = {
        seg: ap.seg,
        dir: ap.dir,
        s: ap.at - 40,
        speed: 10,
        route: [],
        served: -1,
        waited: 0,
        serial: 1,
      };
      control.update(10);
      expect(ai.stopGap(graph, car, 0.016)).toBe(Infinity);
      control.pressButton(crossing.seg, crossing.pos);
      control.update(10 + TO_WALK + 1);
      const gap = ai.stopGap(graph, car, 0.016);
      expect(gap).toBeGreaterThan(40); // the stop line plus the gap the AI keeps to it
      expect(gap).toBeLessThan(46);
    } finally {
      world.free();
    }
  });

  it("自動運転: holds at the line on 赤 and not on 青", () => {
    const { world, control, graph, signals, crossing } = build({ ...MID_BLOCK, button: true });
    try {
      const ap = signals().find((a) => a.dir === 1);
      if (!ap) throw new Error("no eastbound approach");
      const route = planRoute(
        graph,
        { seg: ap.seg, s: ap.at - 60, dir: 1 },
        graph.sample(ap.seg, ap.seg.length - 5).pos,
        gameClock(2026, 10, 1, 600),
        [],
      );
      if (!route) throw new Error("no route");
      const driver = new AutoDriver() as unknown as {
        at: number;
        speed: number;
        blockAhead(route: Route, world: unknown, dt: number): number;
      };
      driver.at = 0;
      driver.speed = 8;
      const drive = { graph, control, turnRules: [], clock: gameClock(2026, 10, 1, 600), obstacles: [] };
      control.update(10);
      expect(driver.blockAhead(route, drive, 0.016)).toBe(Infinity);
      control.pressButton(crossing.seg, crossing.pos);
      control.update(10 + TO_WALK + 1);
      expect(driver.blockAhead(route, drive, 0.016)).toBeLessThan(65);
    } finally {
      world.free();
    }
  });
});

describe("what the OSM tags decide at a 単路 crossing", () => {
  it("a fixed cycle where OSM says no button: the walkers get their 青 without pressing", () => {
    const { world, control, signals, crossing } = build({ ...MID_BLOCK, button: false });
    try {
      expect(signals()[0].controller?.plan.plan.template).toBe("crossingFixed");
      const lights = new Set<string>();
      for (let t = 0; t < 60; t += 0.5) {
        control.update(t);
        lights.add(control.pedLight(crossing.seg, crossing.pos) ?? "none");
      }
      expect(lights).toEqual(new Set(["go", "flash", "stop"]));
      expect(control.pressButton(crossing.seg, crossing.pos)).toBe(false);
    } finally {
      world.free();
    }
  });

  it("音響式 follows traffic_signals:sound: silent where tagged no, sounding where untagged (the rule before T3)", () => {
    for (const [sound, want] of [
      [false, 0],
      [null, 2],
      [true, 2],
    ] as const) {
      const { world, control, crossing } = build({ ...MID_BLOCK, button: false, sound });
      try {
        let t = 0;
        while (control.pedLight(crossing.seg, crossing.pos) !== "go") control.update((t += 0.5));
        let heard = 0;
        control.forEachWalking(() => heard++);
        expect(heard, `sound=${sound}`).toBe(want);
      } finally {
        world.free();
      }
    }
  });

  it("an old tile (two-number records, no tags) away from any junction makes no signal, as before T3", () => {
    const { world, control } = build(null);
    try {
      expect(control.approaches.filter((a) => a.kind === "signal")).toHaveLength(0);
    } finally {
      world.free();
    }
  });
});

describe("walkers at a push-button crossing (sidewalks.ts)", () => {
  it("go to the 押ボタン箱, press it, wait at the kerb, and cross on the walkers' 青", () => {
    const { world, control, graph, crossing } = build({ ...MID_BLOCK, button: true });
    try {
      control.update(0);
      const net = new SidewalkNetwork(
        graph,
        [crossing],
        (seg, near) => control.mayCross(seg, near),
        () => true,
        () => false,
        {
          stand: (seg, near, kerb) => control.buttonStand(seg, near, kerb),
          press: (seg, near) => void control.pressButton(seg, near),
        },
      );
      const noCar = { pos: new Vector3(0, 0, 1e6), speed: 0, forward: new Vector3(0, 0, 1) };
      // Walker ids whose hash takes the mid-block crossing (some people walk on past it).
      let crossed = false;
      for (let id = 1; id <= 60 && !crossed; id++) {
        const w = net.attach(
          graph
            .sample(crossing.seg, crossing.s - 20)
            .pos.clone()
            .add(new Vector3(0, 0, 9)),
          id,
        ) as Walk;
        if (!w || w.dir !== 1) continue;
        const pos = net.point(w.seg, w.s, w.side, w.lateral);
        let t = 0;
        let waited = 0;
        let atBox = false;
        for (let i = 0; i < 2000; i++) {
          t += 0.05;
          control.update(t);
          const step = net.advance(w, 0.07, id, noCar, pos);
          if (w.leg?.pressAt === 0 && w.leg.i >= 1) atBox = true;
          if (step.waiting) waited++;
          if (step.crossing) {
            expect(control.pedLight(crossing.seg, crossing.pos)).not.toBe("stop");
            crossed = true;
            break;
          }
          pos.copy(step.target);
        }
        if (crossed) {
          expect(atBox).toBe(true);
          expect(waited).toBeGreaterThan(0);
        }
      }
      expect(crossed).toBe(true);
    } finally {
      world.free();
    }
  });
});
