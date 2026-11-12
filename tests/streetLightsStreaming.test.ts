import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, PerspectiveCamera, Scene } from "three";
import { beforeAll, expect, it } from "vitest";
import { FrameWork } from "../src/game/frameWork";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph } from "../src/world/roads";
import { StreetLights } from "../src/world/streetLights";

beforeAll(() => RAPIER.init());

it("keeps drawing at night while the lamp list is being replaced between frames", async () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const lights = new StreetLights(new Scene(), world, {
    groundAt: () => 0,
    isOpen: () => true,
    control: { approaches: [], state: () => "green" },
    traffic: { forEachCar: () => {} },
    player: { object: new Object3D(), headlights: [] },
  });
  const graph = new RoadGraph(
    [{ coords: [139.76, 35.68, 139.764, 35.68], width: 9, kind: "local", oneway: 0 }],
    new LocalFrame(35.68, 139.76, 40),
  );
  const camera = new PerspectiveCamera();
  const env = {
    wetness: 1,
    nightFactor: 1,
    weather: "rain",
    isRaining: () => true,
    getObservation: () => null,
  };
  let resume = () => {};
  let frames = 0;
  try {
    lights.rebuild(graph);
    expect(lights.count).toBeGreaterThan(0);
    lights.update(0.016, camera, env, 100);
    const work = new FrameWork(0, () => {
      frames++;
      return frames === 1
        ? new Promise<void>((r) => {
            resume = r;
          })
        : Promise.resolve();
    });
    const pending = lights.rebuildAsync(graph, work);
    expect(lights.count).toBe(0);
    expect(() => lights.update(0.016, camera, env, 101)).not.toThrow();
    resume();
    await pending;
    expect(lights.count).toBeGreaterThan(0);
    expect(() => lights.update(0.016, camera, env, 102)).not.toThrow();
  } finally {
    lights.rebuild(null);
    world.free();
  }
});

it("hides the lamps inside a cut's or a portal's hole wherever the camera is, at build and when a hole comes later (P2.7-5)", () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  let holeEast = false;
  const lights = new StreetLights(new Scene(), world, {
    groundAt: () => 0,
    isOpen: () => true,
    isCut: (x) => holeEast && x > 0,
    control: { approaches: [], state: () => "green" },
    traffic: { forEachCar: () => {} },
    player: { object: new Object3D(), headlights: [] },
  });
  const graph = new RoadGraph(
    [{ coords: [139.759, 35.68, 139.761, 35.68], width: 9, kind: "local", oneway: 0 }],
    new LocalFrame(35.68, 139.76, 40),
  );
  try {
    // The hole arrives after the lamps: hideInCuts takes the east ones, with no camera near.
    lights.rebuild(graph);
    expect(lights.count).toBeGreaterThan(1);
    expect(lights.hiddenCount).toBe(0);
    holeEast = true;
    const hidden = lights.hideInCuts();
    expect(hidden).toBeGreaterThan(0);
    expect(lights.hiddenCount).toBe(hidden);
    expect(lights.hiddenCount).toBeLessThan(lights.count);
    expect(lights.hideInCuts()).toBe(0);
    // The hole already there: the same lamps are hidden as they are built.
    lights.rebuild(graph);
    expect(lights.hiddenCount).toBe(hidden);
  } finally {
    lights.rebuild(null);
    world.free();
  }
});
