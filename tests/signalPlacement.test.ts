import RAPIER from "@dimforge/rapier3d-compat";
import {
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import type { AppliedRegulations } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { LAMP_COLOURS } from "../src/signals/heads";
import type { SignalKit } from "../src/world/signalModels";
import { CYCLE, TrafficControl, type Approach, type LightState } from "../src/world/trafficControl";
import { SignalViolationCheck } from "../src/game/signalViolations";
import { AutoDriver } from "../src/game/autoDriver";
import { planRoute, type Route } from "../src/game/navigation";
import { gameClock } from "../src/world/ruleTime";
import { TrafficAI } from "../src/world/traffic-ai";
import type { Step } from "../src/signals/plan";

// The kit stands in for signals.glb: the placement under test is the game's, not the model's.
const part = () => [{ geometry: new BufferGeometry(), material: new MeshBasicMaterial() }];
const kit = {
  head: part(),
  headRightArrow: part(),
  pedHead: part(),
  pole: part(),
  arm: part(),
  lamp: new BufferGeometry(),
  arrowLamp: new BufferGeometry(),
  pedLamp: new BufferGeometry(),
  lens: new MeshBasicMaterial(),
  pedStop: new MeshBasicMaterial(),
  pedGo: new MeshBasicMaterial(),
} as unknown as SignalKit;
vi.mock("../src/world/signalModels", async (original) => ({
  ...(await original<typeof import("../src/world/signalModels")>()),
  signalKit: () => kit,
}));
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const C = [139.76, 35.68];
const D = 0.0012; // ≈ 110 m (lat) / 108 m (lon)
/** A four-way junction of a 12 m main road (east–west) and an 8 m side road, with a crosswalk. */
const lines: RoadLine[] = [
  [C[0] - D, C[1]],
  [C[0] + D, C[1]],
  [C[0], C[1] - D],
  [C[0], C[1] + D],
].map(([lon, lat], i) => ({
  coords: [C[0], C[1], lon, lat],
  width: i < 2 ? 12 : 8,
  kind: "local",
  oneway: 0,
}));

function build(
  laneUse: (graph: RoadGraph) => AppliedRegulations["laneUse"] = () => [],
  roads: RoadLine[] = lines,
) {
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const control = new TrafficControl(scene, () => 0, world);
  const graph = new RoadGraph(roads, frame);
  const centre = frame.toLocal(C[1], C[0], frame.origin.h).setY(0);
  const side = graph.segments.find((s) => s.line.width === 8);
  if (!side) throw new Error("no side road");
  const s = 14; // the crosswalk 14 m from the junction along the side road
  const near = side.from === graph.segments[0].from ? s : side.length - s;
  const regs: AppliedRegulations = {
    crossings: [{ seg: side, s: near, pos: graph.sample(side, near).pos.clone() }],
    signs: [],
    turnRules: [],
    stopLines: [],
    stopSigns: [],
    signals: [centre],
    junctionNames: [],
    footbridges: [],
    laneUse: laneUse(graph),
    hasMarkings: false,
  };
  control.rebuild(graph, regs);
  const meshOf = (material: unknown) => {
    const mesh = scene.children.find((o) => o instanceof InstancedMesh && o.material === material);
    if (!(mesh instanceof InstancedMesh)) throw new Error("no instanced mesh");
    return mesh;
  };
  return { scene, world, control, meshOf, graph, side, crossingPos: regs.crossings[0].pos };
}

const OFF = new Color(LAMP_COLOURS.off);
const positionOf = (mesh: InstancedMesh, i: number) => {
  const m = new Matrix4();
  mesh.getMatrixAt(i, m);
  return new Vector3().setFromMatrixPosition(m);
};
/** The way the lens at instance `i` faces (its local +Z). */
const normalOf = (mesh: InstancedMesh, i: number) => {
  const m = new Matrix4();
  mesh.getMatrixAt(i, m);
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  return new Vector3(0, 0, 1).applyQuaternion(q);
};
const isLit = (mesh: InstancedMesh, i: number) => {
  const c = new Color();
  mesh.getColorAt(i, c);
  // Not equals(): instance colours are stored as float32, so the off colour comes back rounded.
  return Math.abs(c.r - OFF.r) + Math.abs(c.g - OFF.g) + Math.abs(c.b - OFF.b) > 1e-3;
};
/** Which colour a lit lens shows, by its hue: 青 is green over red, 黄 has green with red, 赤 hardly any. */
const hueOf = (mesh: InstancedMesh, i: number): LightState => {
  const c = new Color();
  mesh.getColorAt(i, c);
  if (c.g > c.r) return "green";
  return c.g > 0.3 * c.r ? "yellow" : "red";
};

/** A driver's eye 1.2 m up, 2 m behind the stop line of `ap`, looking along the approach. */
function driverCamera(ap: Approach): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const eye = ap.a.clone().add(ap.b).multiplyScalar(0.5).addScaledVector(ap.travel, -2).setY(1.2);
  camera.position.copy(eye);
  camera.lookAt(eye.clone().addScaledVector(ap.travel, 30).setY(5.2));
  camera.updateMatrixWorld();
  return camera;
}

describe("施行令第3条 in the run-time placement, projected to a driver's view", () => {
  it("lights, for every approach, the right-hand lamp of its head in red, the middle in yellow, the left in green (横型は右から赤・黄・青)", () => {
    const { world, control, meshOf } = build();
    try {
      const lamps = meshOf(kit.lens);
      const signals = control.approaches.filter((a) => a.kind === "signal");
      expect(signals).toHaveLength(4);
      for (const ap of signals) {
        const camera = driverCamera(ap);
        // The lenses facing this driver: the head over this approach (the others look elsewhere).
        const facing = Array.from({ length: lamps.count }, (_, i) => i).filter((i) => {
          const toEye = camera.position.clone().sub(positionOf(lamps, i)).normalize();
          return normalOf(lamps, i).dot(toEye) > 0.9;
        });
        expect(facing).toHaveLength(3);
        const screenX: Partial<Record<LightState, number>> = {};
        for (let t = 0; t < CYCLE; t += 0.5) {
          control.update(t);
          const lit = facing.filter((i) => isLit(lamps, i));
          expect(lit).toHaveLength(1);
          const ndc = positionOf(lamps, lit[0]).project(camera);
          expect(Math.abs(ndc.x)).toBeLessThan(1); // on screen
          const state = control.state(ap);
          expect(hueOf(lamps, lit[0]), `t = ${t} s`).toBe(state); // lit in the colour it means
          screenX[state] = ndc.x;
        }
        const { red, yellow, green } = screenX;
        if (red === undefined || yellow === undefined || green === undefined)
          throw new Error("a colour never lit");
        expect(red).toBeGreaterThan(yellow);
        expect(yellow).toBeGreaterThan(green);
      }
    } finally {
      world.free();
    }
  });

  it("puts the 止まれ lamp of each pedestrian head above its 進め lamp, seen from the kerb it faces (2 灯は上が赤)", () => {
    const { world, meshOf } = build();
    try {
      const stop = meshOf(kit.pedStop);
      const go = meshOf(kit.pedGo);
      expect(stop.count).toBe(2);
      expect(go.count).toBe(stop.count);
      for (let i = 0; i < stop.count; i++) {
        const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
        const lens = positionOf(stop, i);
        camera.position.copy(lens.clone().addScaledVector(normalOf(stop, i), 12).setY(1.5));
        camera.lookAt(lens);
        camera.updateMatrixWorld();
        const top = positionOf(stop, i).project(camera);
        const bottom = positionOf(go, i).project(camera);
        expect(top.y).toBeGreaterThan(bottom.y);
        expect(Math.abs(top.x - bottom.x)).toBeLessThan(1e-3);
      }
    } finally {
      world.free();
    }
  });
});

/** The two-phase signal as trafficControl.ts ran it up to T1 (the reference twoPhase must equal). */
const legacy = {
  offset: (lon: number, lat: number) =>
    ((Math.imul(Math.round(lon * 1e4), 73856093) ^ Math.imul(Math.round(lat * 1e4), 19349663)) >>> 0) % 45,
  phase: (t: number, offset: number) => (((t + offset) % 45) + 45) % 45,
  light(t: number, offset: number, axis: 0 | 1): LightState {
    const local = this.phase(t, offset) - (axis === 0 ? 0 : 25);
    if (local >= 0 && local < [20, 15][axis]) return "green";
    if (local >= 0 && local < [20, 15][axis] + 3) return "yellow";
    return "red";
  },
  ped(t: number, offset: number, axis: 0 | 1) {
    const other = axis === 0 ? 1 : 0;
    const local = this.phase(t, offset) - (other === 0 ? 0 : 25);
    if (local < 0 || local >= [20, 15][other]) return "stop";
    return local < [20, 15][other] - 5 ? "go" : "flash";
  },
};

describe("現示表 in the running junction", () => {
  it("runs the default junction exactly as before T2: the same offset, main lamps and walk light at every time (twoPhase 一致)", () => {
    const { world, control, side, crossingPos } = build();
    try {
      const signals = control.approaches.filter((a) => a.kind === "signal");
      const offset = signals[0].controller?.offset ?? NaN;
      expect(offset).toBe(legacy.offset(C[0], C[1]));
      const sideAxis = signals.find((a) => a.seg === side)?.axis ?? 0;
      for (let t = 0; t < 2 * CYCLE; t += 0.25) {
        control.update(t);
        for (const ap of signals)
          expect(control.state(ap), `t = ${t}`).toBe(legacy.light(t, offset, ap.axis));
        expect(control.pedLight(side, crossingPos), `t = ${t}`).toBe(legacy.ped(t, offset, sideAxis));
      }
      expect(control.rightArrowCount()).toBe(0);
    } finally {
      world.free();
    }
  });

  /** The main road's approach from the west has an OSM right-turn-only lane. */
  const rightLane = (graph: RoadGraph): AppliedRegulations["laneUse"] => {
    const west = graph.segments.find((s) => s.line.width === 12 && s.pts[s.pts.length - 1].x < s.pts[0].x);
    if (!west) throw new Error("no main road");
    // Lines start at the junction, so arriving there runs against the segment (dir −1).
    return [{ seg: west, dir: -1, node: west.from, lanes: [["left", "through"], ["right"]], source: "osm" }];
  };
  const meshWhere = (scene: Scene, test: (m: InstancedMesh) => boolean) => {
    const mesh = scene.children.find((o) => o instanceof InstancedMesh && test(o));
    if (!(mesh instanceof InstancedMesh)) throw new Error("no such instanced mesh");
    return mesh;
  };

  it("hangs the right-arrow head over both main-road approaches and lights its arrow, pointing the driver's right, only in the arrow step", () => {
    const { world, control, scene } = build(rightLane);
    try {
      expect(control.rightArrowCount()).toBe(1);
      expect(meshWhere(scene, (m) => m.material === kit.headRightArrow[0].material).count).toBe(2);
      expect(meshWhere(scene, (m) => m.material === kit.head[0].material).count).toBe(2);
      const arrows = meshWhere(scene, (m) => m.geometry === kit.arrowLamp);
      expect(arrows.count).toBe(2);
      const lamps = meshWhere(scene, (m) => m.geometry === kit.lamp);
      const main = control.approaches.filter((a) => a.kind === "signal" && a.group === "a");
      expect(main).toHaveLength(2);
      const cycle = main[0].controller?.plan.cycle ?? 0;
      expect(cycle).toBe(CYCLE + 6);
      let litSteps = 0;
      for (let t = 0; t < cycle; t += 0.5) {
        control.update(t);
        const isArrowLit = isLit(arrows, 0);
        expect(isLit(arrows, 1)).toBe(isArrowLit); // both directions together
        if (!isArrowLit) continue;
        litSteps++;
        expect(control.state(main[0])).toBe("red");
        expect(control.permits(main[0], "right")).toBe("go");
        expect(control.permits(main[0], "through")).toBe("stop");
        expect(hueOf(arrows, 0)).toBe("green");
      }
      expect(litSteps).toBe(12); // 6 s at 0.5 s steps
      for (const ap of main) {
        const camera = driverCamera(ap);
        const faces = (mesh: InstancedMesh, i: number) =>
          normalOf(mesh, i).dot(camera.position.clone().sub(positionOf(mesh, i)).normalize()) > 0.9;
        const mine = [0, 1].find((i) => faces(arrows, i));
        if (mine === undefined) throw new Error("no arrow faces this driver");
        const facingLamps = Array.from({ length: lamps.count }, (_, i) => i).filter((i) => faces(lamps, i));
        expect(facingLamps).toHaveLength(3);
        const rightmost = Math.max(...facingLamps.map((i) => positionOf(lamps, i).project(camera).x));
        const arrowAt = positionOf(arrows, mine).project(camera);
        expect(arrowAt.x).toBeCloseTo(rightmost, 2); // under the red lamp
        expect(arrowAt.y).toBeLessThan(positionOf(lamps, facingLamps[0]).project(camera).y);
        // The artwork points up (+Y); the instance turns it to the driver's right.
        const m = new Matrix4();
        arrows.getMatrixAt(mine, m);
        const tip = new Vector3(0, 0.1, 0).applyMatrix4(m).project(camera);
        expect(tip.x - arrowAt.x).toBeGreaterThan(0);
        expect(Math.abs(tip.y - arrowAt.y)).toBeLessThan(Math.abs(tip.x - arrowAt.x) * 0.05);
      }
    } finally {
      world.free();
    }
  });
});

/** An OSM right-turn-only lane on the approach along the first segment `pick` finds (dir −1: into C). */
const rightLaneOn =
  (pick: (s: RoadGraph["segments"][number]) => boolean) =>
  (graph: RoadGraph): AppliedRegulations["laneUse"] => {
    const seg = graph.segments.find(pick);
    if (!seg) throw new Error("no such segment");
    return [{ seg, dir: -1, node: seg.from, lanes: [["left", "through"], ["right"]], source: "osm" }];
  };
const westMain = rightLaneOn((s) => s.line.width === 12 && s.pts[s.pts.length - 1].x < s.pts[0].x);
/** A 40 m wide main road (a boulevard) across the 8 m side road: the side road's stop lines stand 26.5 m out. */
const wideLines: RoadLine[] = lines.map((l) => (l.width === 12 ? { ...l, width: 40 } : l));
const southSide = rightLaneOn((s) => s.line.width === 8 && s.pts[s.pts.length - 1].z > s.pts[0].z);

/** Clock time at which `ap`'s controller is `into` seconds into the first step `pick` finds. */
function timeIn(ap: Approach, pick: (st: Step) => boolean, into = 1): number {
  const c = ap.controller;
  if (!c) throw new Error("no controller");
  const k = c.plan.plan.steps.findIndex(pick);
  if (k < 0) throw new Error("no such step");
  return c.plan.starts[k] + into - c.offset + c.plan.cycle;
}
/** Drive the player's check along `ap` from 20 m before its stop line, through the node and out `turn`. */
function driveThrough(control: TrafficControl, ap: Approach, turn: "right" | "through" | "left", now = 0) {
  const booked: number[] = [];
  const check = new SignalViolationCheck(control, (t) => booked.push(t));
  const t = ap.travel;
  const out = { right: new Vector3(-t.z, 0, t.x), through: t.clone(), left: new Vector3(t.z, 0, -t.x) }[turn];
  const line = ap.a.clone().add(ap.b).multiplyScalar(0.5);
  // 20.37: off the metre grid, so no point lands exactly on a stop line (crossed() needs a proper crossing).
  const start = ap.node.clone().addScaledVector(t, -(line.distanceTo(ap.node) + 20.37));
  const pts: Vector3[] = [];
  for (let d = 0; d <= start.distanceTo(ap.node); d += 1) pts.push(start.clone().addScaledVector(t, d));
  for (let d = 1; d <= ap.exitM + 20; d += 1) pts.push(ap.node.clone().addScaledVector(out, d));
  for (let i = 1; i < pts.length; i++) {
    const forward = pts[i]
      .clone()
      .sub(pts[i - 1])
      .normalize();
    const cr = control.crossed(pts[i - 1], pts[i]);
    check.step(cr, pts[i - 1], pts[i], forward, now + i * 100);
  }
  return { booked, isHolding: check.isHolding };
}

describe("信号無視 in the running junction (game/signalViolations.ts on the real TrafficControl)", () => {
  it("books nothing for a right turn under the right arrow, and a violation for going straight", () => {
    const { world, control } = build(westMain);
    try {
      const ap = control.approaches.find((a) => a.kind === "signal" && a.group === "a");
      if (!ap) throw new Error("no main approach");
      control.update(timeIn(ap, (st) => (st.arrows.a?.length ?? 0) > 0));
      expect(control.permits(ap, "right")).toBe("go");
      expect(driveThrough(control, ap, "right")).toEqual({ booked: [], isHolding: false });
      expect(driveThrough(control, ap, "through").booked).toHaveLength(1);
      expect(driveThrough(control, ap, "left").booked).toHaveLength(1);
    } finally {
      world.free();
    }
  });

  it("gives a right-turner 3 s after the arrow goes out into the all-red, but books a red after a yellow as ever", () => {
    const { world, control } = build(westMain);
    try {
      const ap = control.approaches.find((a) => a.kind === "signal" && a.group === "a");
      if (!ap?.controller) throw new Error("no main approach");
      const steps = ap.controller.plan.plan.steps;
      const afterArrow = (st: Step) =>
        steps.indexOf(st) > 0 && (steps[steps.indexOf(st) - 1].arrows.a?.length ?? 0) > 0;
      control.update(timeIn(ap, afterArrow, 1));
      expect(control.permits(ap, "right")).toBe("stop");
      expect(driveThrough(control, ap, "right").booked).toEqual([]);
      expect(driveThrough(control, ap, "through").booked).toHaveLength(1); // straight was red before too
      // The other group: its red comes after its yellow, and is booked at the line.
      const side = control.approaches.find((a) => a.kind === "signal" && a.group === "b");
      if (!side) throw new Error("no side approach");
      control.update(
        timeIn(side, (st) => st.main.b === "R" && st.main.a === "R" && steps.indexOf(st) > 4, 1),
      );
      expect(control.permits(side, "right")).toBe("stop");
      expect(driveThrough(control, side, "right").booked).toHaveLength(1);
    } finally {
      world.free();
    }
  });

  it("keeps every stop line short of where the junction counts as left, even on a 40 m boulevard (exitM)", () => {
    for (const roads of [lines, wideLines]) {
      const { world, control } = build(() => [], roads);
      try {
        for (const ap of control.approaches.filter((a) => a.kind === "signal")) {
          const lineM = ap.a.clone().add(ap.b).multiplyScalar(0.5).distanceTo(ap.node);
          expect(lineM).toBeLessThan(ap.exitM);
        }
      } finally {
        world.free();
      }
    }
  });

  it("judges a right turn from a stop line 26.5 m out by the arm it leaves by, not at the line", () => {
    const { world, control } = build(southSide, wideLines);
    try {
      const ap = control.approaches.find((a) => a.kind === "signal" && a.group === "b");
      if (!ap) throw new Error("no side approach");
      expect(ap.a.clone().add(ap.b).multiplyScalar(0.5).distanceTo(ap.node)).toBeGreaterThan(25);
      control.update(timeIn(ap, (st) => (st.arrows.b?.length ?? 0) > 0));
      expect(driveThrough(control, ap, "right").booked).toEqual([]);
      expect(driveThrough(control, ap, "through").booked).toHaveLength(1);
    } finally {
      world.free();
    }
  });
});

describe("the movement the drivers read at an arrow", () => {
  it("autopilot: a route turning right at the junction reads right (going), a straight one through (stopping)", () => {
    const { world, control, graph } = build(westMain);
    try {
      const ap = control.approaches.find((a) => a.kind === "signal" && a.group === "a" && a.dir === -1);
      if (!ap) throw new Error("no main approach");
      const south = graph.segments.find((s) => s.line.width === 8 && s.pts[s.pts.length - 1].z > s.pts[0].z);
      const east = graph.segments.find((s) => s.line.width === 12 && s !== ap.seg);
      if (!south || !east) throw new Error("no exits");
      const clock = gameClock(2026, 10, 1, 600);
      const driver = new AutoDriver() as unknown as {
        movementAt(route: Route, approach: Approach, dist: number, at: number): string;
      };
      for (const [exit, want] of [
        [south, "right"],
        [east, "through"],
      ] as const) {
        const route = planRoute(
          graph,
          { seg: ap.seg, s: 90, dir: -1 },
          exit.pts[exit.pts.length - 1],
          clock,
          [],
        );
        if (!route) throw new Error("no route");
        const next = control.nextStop(route.steps[0].seg, route.steps[0].dir, route.stepEntry[0]);
        if (!next) throw new Error("no stop ahead");
        expect(driver.movementAt(route, next.approach, next.dist, 0)).toBe(want);
      }
    } finally {
      world.free();
    }
  });

  it("traffic AI: the road it has chosen next decides the movement", () => {
    const { world, control, graph, scene } = build(westMain);
    try {
      const ap = control.approaches.find((a) => a.kind === "signal" && a.group === "a" && a.dir === -1);
      const south = graph.segments.find((s) => s.line.width === 8 && s.pts[s.pts.length - 1].z > s.pts[0].z);
      if (!ap || !south) throw new Error("no approach");
      const ai = new TrafficAI(scene, world, () => 0, control) as unknown as {
        movementAt(graph: RoadGraph, car: unknown): string;
      };
      const car = { seg: ap.seg, dir: ap.dir, route: [{ seg: south, dir: 1 }] };
      expect(ai.movementAt(graph, car)).toBe("right");
    } finally {
      world.free();
    }
  });
});
