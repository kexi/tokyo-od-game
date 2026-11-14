import RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Raycaster, Scene, Vector3 } from "three";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { FrameWork } from "../src/game/frameWork";
import { LocalFrame } from "../src/geo/frame";
import { KERB, Pavements, type PavementPolygon } from "../src/world/pavements";

beforeAll(() => RAPIER.init());
afterEach(() => vi.unstubAllGlobals());

const frame = new LocalFrame(35.68, 139.76, 40);
const ring = (x: number, z: number, size: number) =>
  [
    [x, z],
    [x + size, z],
    [x + size, z + size],
    [x, z + size],
  ].flatMap(([px, pz]) => {
    const g = frame.toGeodetic(new Vector3(px, 0, pz));
    return [g.lon, g.lat];
  });
const polygon = (x: number, z: number, size: number): PavementPolygon => ({
  kind: "sidewalk",
  rings: [ring(x, z, size)],
});
const fakeCanvas = () =>
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({ fillRect: () => {} }) }),
  });
const hitY = (world: RAPIER.World, x: number, z: number) => {
  world.step();
  const hit = world.castRay(new RAPIER.Ray({ x, y: 10, z }, { x: 0, y: -1, z: 0 }), 20, true);
  return hit ? 10 - hit.timeOfImpact : null;
};

it("keeps the old pavement solid while preparing disabled collider batches, then swaps matching drawn and physical surfaces", async () => {
  fakeCanvas();
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const pavements = new Pavements(scene, world, () => 0);
  let sawDisabled = false;
  let sawOld = false;
  try {
    pavements.rebuild([polygon(0, 0, 20)], frame);
    const work = new FrameWork(0, async () => {
      world.bodies.forEach((body) => {
        if (!body.isEnabled()) sawDisabled = true;
      });
      if (pavements.count === 1) {
        sawOld = true;
        expect(hitY(world, 10, 10)).toBeCloseTo(KERB, 4);
        expect(pavements.contains(10, 10)).toBe(true);
      }
    });
    const polys = Array.from({ length: 100 }, (_, i) => polygon(100 + i * 30, 0, 20));
    await pavements.rebuildAsync(polys, frame, work);
    expect(sawDisabled).toBe(true);
    expect(sawOld).toBe(true);
    expect(pavements.count).toBe(polys.length);
    expect(world.colliders.len()).toBeGreaterThan(1);
    expect(hitY(world, 10, 10)).toBeNull();
    scene.updateMatrixWorld(true);
    for (const i of [0, 20, 99]) {
      const x = 110 + i * 30;
      const hits = new Raycaster(new Vector3(x, 10, 10), new Vector3(0, -1, 0)).intersectObjects(
        scene.children,
      );
      expect(hits[0]?.point.y).toBeCloseTo(KERB, 4);
      expect(hitY(world, x, 10)).toBeCloseTo(hits[0].point.y, 4);
      expect(pavements.contains(x, 10)).toBe(true);
    }
  } finally {
    pavements.clear();
    world.free();
  }
});

it("keeps pavement holes and physical height through origin changes without replacing collider handles", () => {
  fakeCanvas();
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const pavements = new Pavements(scene, world, () => 0);
  try {
    pavements.rebuild([{ kind: "sidewalk", rings: [ring(0, 0, 40), ring(10, 10, 20)] }], frame);
    const handles: number[] = [];
    world.colliders.forEach((c) => handles.push(c.handle));
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2);
    const matrix = new Matrix4().compose(new Vector3(-500, 3, 100), rotation, new Vector3(1, 1, 1));
    pavements.reanchor(matrix, rotation);
    const outer = new Vector3(5, KERB, 5).applyMatrix4(matrix);
    const hole = new Vector3(20, KERB, 20).applyMatrix4(matrix);
    expect(pavements.contains(outer.x, outer.z)).toBe(true);
    expect(pavements.contains(hole.x, hole.z)).toBe(false);
    expect(hitY(world, outer.x, outer.z)).toBeCloseTo(outer.y, 4);
    expect(hitY(world, hole.x, hole.z)).toBeNull();
    expect(handles.every((h) => world.getCollider(h) !== null)).toBe(true);
  } finally {
    pavements.clear();
    world.free();
  }
});

it("returns between height queries inside one large polygon while keeping the previous ground solid", async () => {
  fakeCanvas();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  let queries = 0,
    previous = 0,
    checkedOld = 0;
  const pavements = new Pavements(new Scene(), world, () => {
    queries++;
    return 0;
  });
  try {
    pavements.rebuild([polygon(0, 0, 20)], frame);
    queries = 0;
    const work = new FrameWork(0, async () => {
      expect(queries - previous).toBeLessThanOrEqual(128);
      const sampled = queries > previous;
      if (sampled) {
        expect(hitY(world, 10, 10)).toBeCloseTo(KERB, 4);
        checkedOld++;
      }
      previous = queries;
    });
    await pavements.rebuildAsync([polygon(100, 100, 1600)], frame, work);
    expect(checkedOld).toBeGreaterThan(5);
    expect(hitY(world, 10, 10)).toBeNull();
    expect(hitY(world, 900, 900)).toBeCloseTo(KERB, 4);
  } finally {
    pavements.clear();
    world.free();
  }
});
