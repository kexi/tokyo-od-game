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

// The kit stands in for signals.glb: the placement under test is the game's, not the model's.
const part = () => [{ geometry: new BufferGeometry(), material: new MeshBasicMaterial() }];
const kit = {
  head: part(),
  pedHead: part(),
  pole: part(),
  arm: part(),
  lamp: new BufferGeometry(),
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

function build() {
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const control = new TrafficControl(scene, () => 0, world);
  const graph = new RoadGraph(lines, frame);
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
    laneUse: [],
    hasMarkings: false,
  };
  control.rebuild(graph, regs);
  const meshOf = (material: unknown) => {
    const mesh = scene.children.find((o) => o instanceof InstancedMesh && o.material === material);
    if (!(mesh instanceof InstancedMesh)) throw new Error("no instanced mesh");
    return mesh;
  };
  return { scene, world, control, meshOf };
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
