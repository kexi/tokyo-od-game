import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Matrix4, Quaternion, Scene, Vector3 } from "three";
import { beforeAll, expect, it, vi } from "vitest";
import { FrameWork } from "../src/game/frameWork";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { TrafficAI } from "../src/world/traffic-ai";

vi.mock("../src/game/carModel", () => ({ createLowCar: () => new Group() }));
beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const lines: RoadLine[] = Array.from({ length: 100 }, (_, i) => ({
  coords: [139.76, 35.68 + i * 0.001, 139.761 + i * 0.0000037, 35.68 + i * 0.001],
  width: 6,
  kind: "local",
  oneway: 0,
}));

it("preserves parked cars and their colliders, including a displaced car, through road and origin updates", () => {
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const traffic = new TrafficAI(scene, world, () => 0);
  try {
    traffic.setGraph(new RoadGraph(lines, frame));
    const parked = traffic.parkedPoses();
    expect(parked.length).toBeGreaterThan(1);
    const handles: number[] = [];
    world.colliders.forEach((c) => handles.push(c.handle));
    parked[0].position.x += 3;
    const original = parked.map((p) => p.position.clone());
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1);
    const matrix = new Matrix4().compose(new Vector3(-500, 2, 100), rotation, new Vector3(1, 1, 1));
    traffic.transform((p) => p.applyMatrix4(matrix), 0.1);
    traffic.setGraph(new RoadGraph(lines, frame));
    const after = traffic.parkedPoses();
    expect(after.map((p) => p.key)).toEqual(parked.map((p) => p.key));
    after.forEach((p, i) =>
      expect(p.position.distanceTo(original[i].applyMatrix4(matrix))).toBeLessThan(1e-6),
    );
    world.step();
    handles.forEach((h, i) => {
      const collider = world.getCollider(h);
      const pos = collider.translation();
      expect(new Vector3(pos.x, pos.y, pos.z).distanceTo(after[i].position)).toBeLessThan(0.001);
    });
    traffic.setGraph(null);
    expect(scene.children).toHaveLength(0);
    expect(world.colliders.len()).toBe(0);
  } finally {
    world.free();
  }
});

it("gives rendering a turn for each newly parked car while keeping every published car solid", async () => {
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const traffic = new TrafficAI(scene, world, () => 0);
  const published: number[] = [];
  const work = new FrameWork(Infinity, async () => {
    published.push(scene.children.length);
    expect(world.colliders.len()).toBe(scene.children.length);
  });
  try {
    const graph = new RoadGraph(lines, frame);
    traffic.setGraph(graph, false);
    await traffic.rebuildParkedAsync(graph, work);
    expect(published.length).toBeGreaterThan(1);
    expect(published).toEqual(Array.from({ length: published.length }, (_, i) => i + 1));
    const yields = work.yields;
    await traffic.rebuildParkedAsync(new RoadGraph(lines, frame), work);
    expect(work.yields).toBe(yields);
    await traffic.rebuildParkedAsync(null, work);
    expect(scene.children).toHaveLength(0);
    expect(world.colliders.len()).toBe(0);
  } finally {
    world.free();
  }
});
