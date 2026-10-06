import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Sphere, Vector3 } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Buildings } from "../src/world/buildings";
import { LocalFrame } from "../src/geo/frame";
import type { ColliderMesh, PreparedCollider } from "../src/physics/colliderSnapshot";

function host() {
  const buildings = Object.create(Buildings.prototype) as Buildings;
  const group = new Group(),
    scene = new Group();
  scene.add(new Mesh(new BoxGeometry(2, 3, 2), new MeshBasicMaterial()));
  group.add(scene);
  const model = {
    scene,
    visible: true,
    sphere: new Sphere(new Vector3(), 3),
    collider: null as RAPIER.Collider | null,
    colliderWork: null as { controller: AbortController; data: PreparedCollider | null } | null,
  };
  const jobs: Array<{ mesh: ColliderMesh; signal: AbortSignal; resolve(data: PreparedCollider): void }> = [];
  const prepare = vi.fn(
    (mesh: ColliderMesh, _key: string, signal: AbortSignal) =>
      new Promise<PreparedCollider>((resolve) => jobs.push({ mesh, signal, resolve })),
  );
  const collider = { handle: 9 } as RAPIER.Collider;
  const world = { createCollider: vi.fn(() => collider), removeCollider: vi.fn() };
  for (const [key, value] of Object.entries({
    frame: new LocalFrame(35.68, 139.76, 40),
    models: new Map([[scene, model]]),
    tiles: { group, loadProgress: 0, update() {} },
    camera: new PerspectiveCamera(),
    maskRegion: { sphere: new Sphere() },
    detailRegion: { sphere: new Sphere() },
    farRegion: { sphere: new Sphere() },
    far: null,
    loadedCount: 0,
    createdAt: performance.now(),
    lastColliderTick: -1000,
    farPending: [],
    isFarCompiled: false,
    hiddenRings: [],
    colliderCompute: { prepare },
    world,
  }))
    Reflect.set(buildings, key, value);
  const finish = async (i: number) => {
    jobs[i].resolve({ mesh: jobs[i].mesh, snapshot: null });
    await Promise.resolve();
  };
  const remove = Reflect.get(buildings, "removeCollider").bind(buildings);
  return { buildings, model, world, jobs, finish, remove };
}

describe("streamed building collider publication", () => {
  it("keeps pending work unique and retains installed walls when a tile leaves the frustum", async () => {
    const h = host();
    h.buildings.update(new Vector3(), 1000);
    expect(h.jobs).toHaveLength(1);
    expect(h.world.createCollider).not.toHaveBeenCalled();
    h.buildings.update(new Vector3(), 1101);
    expect(h.jobs).toHaveLength(1);
    await h.finish(0);
    h.model.visible = false;
    h.buildings.update(new Vector3(), 1202);
    expect(h.world.createCollider).toHaveBeenCalledOnce();
    h.buildings.update(new Vector3(), 1303);
    expect(h.world.removeCollider).not.toHaveBeenCalled();
    h.buildings.update(new Vector3(100000, 0, 0), 1404);
    expect(h.world.removeCollider).toHaveBeenCalledOnce();
  });

  it("discards preparation from the previous origin and captures new local vertices", async () => {
    const h = host();
    h.buildings.update(new Vector3(), 1000);
    h.buildings.setFrame(new LocalFrame(35.71, 139.8, 40));
    expect(h.jobs[0].signal.aborted).toBe(true);
    await h.finish(0);
    expect(h.model.colliderWork).toBeNull();
    h.model.sphere = new Sphere(new Vector3(), 3);
    h.buildings.update(new Vector3(), 1101);
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].mesh.vertices).not.toEqual(h.jobs[0].mesh.vertices);
    expect(h.world.createCollider).not.toHaveBeenCalled();
  });

  it("cannot register an unloaded tile after its preparation completes", async () => {
    const h = host();
    h.buildings.update(new Vector3(), 1000);
    h.remove(h.model);
    expect(h.jobs[0].signal.aborted).toBe(true);
    await h.finish(0);
    expect(h.model.colliderWork).toBeNull();
    expect(h.world.createCollider).not.toHaveBeenCalled();
  });

  it("completes the synchronous spawn gate once and ignores a pending stale preparation", async () => {
    const h = host();
    h.buildings.update(new Vector3(), 1000);
    expect(h.buildings.buildCollidersNear(new Vector3())).toBe(1);
    expect(h.jobs[0].signal.aborted).toBe(true);
    await h.finish(0);
    h.buildings.update(new Vector3(), 1101);
    expect(h.buildings.buildCollidersNear(new Vector3())).toBe(0);
    expect(h.world.createCollider).toHaveBeenCalledOnce();
  });
});
