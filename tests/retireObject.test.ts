import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Group, type Object3D, Mesh, MeshStandardMaterial, Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { MassiveBody } from "../src/physics/massContacts";
import { retireObject } from "../src/render/retire";
import type { HumanModel } from "../src/world/human";
import { type Pedestrian, Pedestrians, profileFor } from "../src/world/pedestrians";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { TrafficAI } from "../src/world/traffic-ai";

// One geometry and one material for every model here: they stand for the shared parts and tints.
const sharedGeometry = new BoxGeometry();
const sharedMaterial = new MeshStandardMaterial();
const sharedMesh = () => {
  const m = new Mesh(sharedGeometry, sharedMaterial);
  m.userData.shared = true;
  return m;
};

vi.mock("../src/game/carModel", () => ({
  createLowCar: () => {
    const g = new Group();
    g.add(sharedMesh(), sharedMesh());
    return g;
  },
}));
beforeAll(() => RAPIER.init());

/** Every object under `root` with how many `dispose` events it got. */
function watchDisposes(root: Object3D): Map<Object3D, number> {
  const counts = new Map<Object3D, number>();
  root.traverse((o) => {
    counts.set(o, 0);
    o.addEventListener("dispose", () => counts.set(o, (counts.get(o) ?? 0) + 1));
  });
  return counts;
}

describe("retireObject", () => {
  it("takes the object out of its parent and tells the root and every descendant once that it is disposed", () => {
    const scene = new Scene();
    const root = new Group();
    const child = sharedMesh();
    const grandchild = sharedMesh();
    child.add(grandchild);
    root.add(child, new Group());
    scene.add(root);
    const counts = watchDisposes(root);
    retireObject(root);
    expect(root.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect([...counts.values()]).toEqual([1, 1, 1, 1]);
  });

  it("leaves geometries and materials alone: shared ones stay usable", () => {
    const geometryDispose = vi.spyOn(sharedGeometry, "dispose");
    const materialDispose = vi.spyOn(sharedMaterial, "dispose");
    const root = new Group();
    root.add(sharedMesh());
    retireObject(root);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    geometryDispose.mockRestore();
    materialDispose.mockRestore();
  });
});

/** A pedestrian whose model is meshes on the shared geometry and material (as clone(true) and tint give). */
function person(peds: Pedestrians, scene: Scene, x: number): Pedestrian {
  const root = new Group();
  const body = new Group();
  body.add(sharedMesh(), sharedMesh());
  root.add(body);
  root.position.set(x, 0, 0);
  scene.add(root);
  const model: HumanModel = {
    root,
    body,
    legs: [new Group(), new Group()],
    shins: [new Group(), new Group()],
    arms: [new Group(), new Group()],
    forearms: [new Group(), new Group()],
    umbrella: new Group(),
  };
  const p: Pedestrian = {
    profile: profileFor(x + 1),
    object: root,
    model,
    heading: 0,
    speed: 1.2,
    phase: 0,
    state: "walk",
    stateTime: 0,
    filmFor: 0,
    phone: null,
    body: null,
    groundCheck: 0,
    walk: null,
    blocked: 0,
    mass: new MassiveBody(60, 1.5, 5.9, "person"),
  };
  peds.list.push(p);
  return p;
}

describe("people and cars taken away are disposed for the renderer", () => {
  it("a pedestrian carried away: every object of the model is told, the one still walking keeps the shared parts", () => {
    const scene = new Scene();
    const peds = new Pedestrians(
      scene,
      {} as RAPIER.World,
      () => 0,
      () => true,
    );
    const gone = person(peds, scene, 0);
    const stays = person(peds, scene, 5);
    const materialDispose = vi.spyOn(sharedMaterial, "dispose");
    const geometryDispose = vi.spyOn(sharedGeometry, "dispose");
    const counts = watchDisposes(gone.object);
    const staysCounts = watchDisposes(stays.object);
    peds.rescue(gone);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    expect([...staysCounts.values()].every((n) => n === 0)).toBe(true);
    expect(scene.children).toEqual([stays.object]);
    expect(materialDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    materialDispose.mockRestore();
    geometryDispose.mockRestore();
  });

  it("a pedestrian's phone put away is disposed too", () => {
    const scene = new Scene();
    const peds = new Pedestrians(
      scene,
      {} as RAPIER.World,
      () => 0,
      () => true,
    );
    const p = person(peds, scene, 0);
    const phone = sharedMesh();
    p.model.body.add(phone);
    p.phone = phone;
    const counts = watchDisposes(phone);
    peds.stopFilming(p);
    expect(phone.parent).toBeNull();
    expect([...counts.values()]).toEqual([1]);
  });

  it("parked cars dropped with the streets: every object of each car is told, the shared parts are not disposed", () => {
    const frame = new LocalFrame(35.68, 139.76, 40);
    // The streets of trafficStreaming.test.ts, where cars are parked.
    const lines: RoadLine[] = Array.from({ length: 100 }, (_, i) => ({
      coords: [139.76, 35.68 + i * 0.001, 139.761 + i * 0.0000037, 35.68 + i * 0.001],
      width: 6,
      kind: "local",
      oneway: 0,
    }));
    const scene = new Scene();
    const world = new RAPIER.World(new Vector3(0, 0, 0));
    const traffic = new TrafficAI(scene, world, () => 0);
    const materialDispose = vi.spyOn(sharedMaterial, "dispose");
    try {
      traffic.setGraph(new RoadGraph(lines, frame));
      const cars = [...scene.children];
      expect(cars.length).toBeGreaterThan(1);
      const counts = cars.map(watchDisposes);
      traffic.setGraph(null);
      expect(scene.children).toHaveLength(0);
      for (const c of counts) expect([...c.values()].every((n) => n === 1)).toBe(true);
      expect(materialDispose).not.toHaveBeenCalled();
    } finally {
      materialDispose.mockRestore();
      world.free();
    }
  });
});
