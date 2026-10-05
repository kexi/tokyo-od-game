import { describe, expect, it } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector2,
  Vector3,
} from "three";
import { SphereRegion } from "3d-tiles-renderer/plugins";
import { QUALITY } from "../src/device";
import { Buildings, createFarTiles, FAR_CACHE, prepareFarTile } from "../src/world/buildings";
import { farFacadeMaterial } from "../src/world/facade";
import { FarGround, type FarGroundSources } from "../src/world/farGround";
import { LocalFrame } from "../src/geo/frame";
import { tileXToLon, tileYToLat } from "../src/geo/tiles";

/**
 * The far ground and the far skyline hold a bounded set of things however long they run: no tile,
 * DEM, mesh, material or queued tile accumulates while the player stands still, turns round or
 * drives across tiles (the heap grew by ~1.2 GB in 50 s on the title screen at 大泉学園).
 */

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** A fake GSI: a gentle slope with a sea in one corner, no photo; counts what it was asked for. */
function fakeSources(): FarGroundSources & { demCalls: number } {
  const source = {
    demCalls: 0,
    dem: async () => {
      source.demCalls++;
      const t = new Float32Array(256 * 256);
      for (let i = 0; i < t.length; i++) t[i] = i % 256 < 20 ? Number.NaN : 10 + (i % 256) * 0.05;
      return t;
    },
    photo: async () => null,
  };
  return source;
}

describe("the far ground's memory", () => {
  it("holds at most the ring's meshes and DEM tiles, standing, turning and driving across tiles", async () => {
    const scene = new Scene();
    const sources = fakeSources();
    const lat = 35.75;
    const lon = 139.586;
    const frame = new LocalFrame(lat, lon, 40);
    const ground = new FarGround(scene, { getMaxAnisotropy: () => 1 }, (_a, _b, h) => h + 37, frame, sources);
    const square = { x0: 29090, y0: 12890, x1: 29093, y1: 12893 };
    // Standing still (the title screen) for 3,000 frames.
    for (let f = 0; f < 3000; f++) {
      ground.update(lat, lon, square);
      if (f % 10 === 0) await flush();
    }
    await flush();
    const settled = ground.stats;
    const r = QUALITY.farGroundRing;
    const ringTiles = (2 * r + 1) ** 2;
    const demTiles = (2 * r + 2) ** 2;
    expect(settled.meshes).toBe(ringTiles);
    expect(settled.demCached).toBeLessThanOrEqual(demTiles);
    const callsWhenSettled = sources.demCalls;
    for (let f = 0; f < 3000; f++) ground.update(lat, lon, square);
    await flush();
    // Nothing fetched or built again while standing.
    expect(sources.demCalls).toBe(callsWhenSettled);
    expect(ground.stats.built).toBe(settled.built);
    // Driving 60 km east and back, crossing a far tile every few hundred frames.
    for (let f = 0; f < 6000; f++) {
      const x = 1819 + 4 * Math.sin((f / 6000) * Math.PI * 2);
      ground.update(lat, tileXToLon(x, 11), null);
      ground.update(tileYToLat(806.2, 11), tileXToLon(x, 11), square);
      if (f % 5 === 0) await flush();
    }
    await flush();
    const s = ground.stats;
    // It did build and drop tiles on the way.
    expect(s.built).toBeGreaterThan(settled.built + ringTiles);
    expect(s.meshes).toBeLessThanOrEqual(ringTiles);
    expect(s.tiles).toBeLessThanOrEqual(ringTiles);
    expect(s.demCached).toBeLessThanOrEqual(demTiles);
    expect(s.loading).toBeLessThanOrEqual(2);
    expect(s.built - s.disposed).toBe(s.meshes);
    expect(scene.children.filter((o) => o.name.startsWith("far-ground")).length).toBe(s.meshes);
    ground.dispose();
    expect(ground.stats.demCached).toBe(0);
    expect(scene.children.filter((o) => o.name.startsWith("far-ground"))).toHaveLength(0);
  });
});

/** A far tile as the tiles renderer hands it over: a group with one mesh of buildings. */
function fakeTile(): Group {
  const g = new BufferGeometry();
  const n = 12;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) p.set([-3.95e6 + i, 3.35e6 + (i % 3) * 30, 3.7e6 + i], i * 3);
  g.setAttribute("position", new BufferAttribute(p, 3));
  g.setAttribute(
    "_batchid",
    new BufferAttribute(
      new Float32Array(n).map((_, i) => i % 2),
      1,
    ),
  );
  const group = new Group();
  group.add(new Mesh(g, new MeshBasicMaterial()));
  return group;
}

describe("the far skyline's memory", () => {
  it("shares one material that unloading a tile never disposes, and drops each tile's own", () => {
    let sharedDisposals = 0;
    farFacadeMaterial().addEventListener("dispose", () => sharedDisposals++);
    for (let k = 0; k < 2000; k++) {
      const tile = fakeTile();
      const mesh = tile.children[0] as Mesh;
      const own = mesh.material as MeshBasicMaterial;
      let ownDisposed = false;
      own.addEventListener("dispose", () => (ownDisposed = true));
      prepareFarTile(tile, { cut: () => undefined });
      expect(mesh.material).toBe(farFacadeMaterial());
      expect(ownDisposed).toBe(true);
      expect((tile as Group & { batchTable?: unknown }).batchTable).toBeNull();
      // What the renderer does on dispose-model: the materials it listed before load-model.
      own.dispose();
      mesh.geometry.dispose();
    }
    expect(sharedDisposals).toBe(0);
  });

  it("has no plugin that disposes the shown material, and a bounded LRU", () => {
    const tiles = createFarTiles(
      "https://example.invalid/tileset.json",
      new SphereRegion({ mask: true, errorTarget: 1e9, sphere: new Sphere(new Vector3(), 1) }),
      undefined as never,
      150,
      40,
    );
    expect(tiles.getPluginByName("UNLOAD_TILES_PLUGIN")).toBeFalsy();
    expect(tiles.lruCache.maxSize).toBe(FAR_CACHE.maxItems);
    expect(tiles.lruCache.maxBytesSize).toBe(FAR_CACHE.maxBytes);
    expect(FAR_CACHE.maxItems).toBeLessThanOrEqual(400);
    expect(FAR_CACHE.maxBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
    tiles.dispose();
  });

  it("prepares a burst of far tiles a few milliseconds a frame, leaving none behind", async () => {
    const camera = new PerspectiveCamera(60, 1, 0.5, 40000);
    const buildings = new Buildings(
      new Scene(),
      {} as never,
      camera,
      { getSize: (v: Vector2) => v.set(1280, 720) },
      new LocalFrame(35.75, 139.586, 40),
    );
    const far = (
      buildings as unknown as { createFarTiles(): ReturnType<typeof createFarTiles> }
    ).createFarTiles();
    const prepare = () => (buildings as unknown as { prepareFarTiles(): void }).prepareFarTiles();
    // The far façade's pipeline is built first (asynchronously); nothing shows before it.
    const early = fakeTile();
    far.dispatchEvent({ type: "load-model", scene: early, tile: {}, url: "" } as never);
    prepare();
    expect(early.visible).toBe(false);
    await flush();
    prepare();
    expect(early.visible).toBe(true);
    const scenes = Array.from({ length: 400 }, fakeTile);
    for (const scene of scenes) far.dispatchEvent({ type: "load-model", scene, tile: {}, url: "" } as never);
    expect(buildings.farPendingCount).toBe(400);
    expect(scenes.every((s) => !s.visible)).toBe(true);
    let frames = 0;
    while (buildings.farPendingCount > 0 && frames < 1000) {
      const start = performance.now();
      prepare();
      // The budget is 4 ms; a slow test machine may overrun by the one tile in hand.
      expect(performance.now() - start).toBeLessThan(50);
      frames++;
    }
    expect(buildings.farPendingCount).toBe(0);
    expect(scenes.every((s) => s.visible)).toBe(true);
    // Unloaded before being prepared: dropped from the queue, not kept.
    const late = fakeTile();
    far.dispatchEvent({ type: "load-model", scene: late, tile: {}, url: "" } as never);
    far.dispatchEvent({ type: "dispose-model", scene: late, tile: {} } as never);
    expect(buildings.farPendingCount).toBe(0);
    far.dispose();
  });
});
