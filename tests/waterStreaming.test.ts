import RAPIER from "@dimforge/rapier3d-compat";
import { BufferGeometry, Mesh, Scene, Sphere, Vector3 } from "three";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { FrameWork } from "../src/game/frameWork";
import { SerialWork } from "../src/game/serialWork";
import { LocalFrame } from "../src/geo/frame";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../src/geo/tiles";
import type { DemStore } from "../src/world/dem";
import * as vectorTiles from "../src/world/gsiVectorTiles";
import type { Tide } from "../src/world/tide";
import { WaterLayer } from "../src/world/water";
import { WaterCompute } from "../src/world/waterCompute";
import { WATER_ZOOM, waterPolygons, type WaterPolygon } from "../src/world/waterGeometry";

beforeAll(() => RAPIER.init());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(queue?: SerialWork) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 })),
  );
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const scene = new Scene();
  const frame = new LocalFrame(35.68, 139.76, 40);
  const dem = {
    ellipsoidal: (_lat: number, _lon: number, h: number) => h,
    load: async () => new Float32Array(0),
    loadSurveyed: async () => new Float32Array(0),
    surveyedAt: () => 2,
    sampleGlobal: () => 2,
    heightAt: () => 8,
  } as unknown as DemStore;
  const water = new WaterLayer(scene, world, dem, { meanLevel: 0 } as Tide, frame, queue);
  const gx = lonToTileX(139.76, WATER_ZOOM),
    gy = latToTileY(35.68, WATER_ZOOM);
  const pts = [gx, gy, gx + 0.05, gy, gx + 0.05, gy + 0.05, gx, gy + 0.05];
  const old = new Mesh(new BufferGeometry());
  scene.add(old);
  const tile = {
    x: Math.floor(gx),
    y: Math.floor(gy),
    version: 1,
    polygons: [] as WaterPolygon[],
    raster: new Uint8Array(0),
    cut: new Uint8Array(0),
    shores: [[{ pts, level: new Float32Array(4).fill(2), tide: new Float32Array(4) }]],
    surface: old,
    walls: null,
    sphere: new Sphere(),
    probe: new Float32Array(0),
  };
  const internal = water as unknown as {
    tiles: Map<string, typeof tile>;
    surfaceSteps(value: typeof tile): Generator<void>;
    centre: { x: number; y: number };
    fetchTile(x: number, y: number): Promise<void>;
  };
  const key = `${tile.x}/${tile.y}`;
  internal.tiles.set(key, tile);
  internal.centre = { x: tile.x, y: tile.y };
  return { water, world, scene, frame, internal, tile, old, key, pts };
}

function prepareShoreTiles() {
  const ring = [
    [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ],
  ];
  vi.spyOn(vectorTiles, "gsiVectorTile").mockImplementation(async (_z, x, y) => ({
    source: "gsi",
    roads: [],
    water: waterPolygons(ring, x, y, 4096),
  }));
  vi.spyOn(WaterCompute.prototype, "rasterize").mockResolvedValue({
    raster: new Uint8Array(512 * 512).fill(1),
    cut: new Uint8Array(512 * 512).fill(255),
  });
}

it("keeps the old surface until publication and restarts in the new local frame", async () => {
  const { water, world, scene, internal, tile, old, pts } = setup();
  const next = new LocalFrame(35.681, 139.762, 42);
  let frames = 0;
  try {
    await new FrameWork(0, async () => {
      frames++;
      expect(old.parent).toBe(scene);
      if (frames === 1) water.setFrame(next);
    }).run(internal.surfaceSteps(tile));
    expect(frames).toBeGreaterThan(1);
    expect(old.parent).toBeNull();
    const position = tile.surface!.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const expected = next.toLocal(
        tileYToLat(pts[i * 2 + 1], WATER_ZOOM),
        tileXToLon(pts[i * 2], WATER_ZOOM),
        2,
      );
      expect(new Vector3().fromBufferAttribute(position, i).distanceTo(expected)).toBeLessThan(0.0001);
    }
  } finally {
    water.dispose();
    world.free();
  }
});

it.each(["move", "dispose"])("does not publish a mask reply after the tile's %s", async (action) => {
  const { water, world, internal, tile, key } = setup();
  let reply!: (masks: { raster: Uint8Array; cut: Uint8Array }) => void;
  const compute = vi.spyOn(WaterCompute.prototype, "rasterize").mockImplementation(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  try {
    const pending = internal.fetchTile(tile.x, tile.y);
    await vi.waitFor(() => expect(compute).toHaveBeenCalledOnce());
    const isMove = action === "move";
    if (isMove) internal.centre = { x: tile.x + 10, y: tile.y + 10 };
    else water.dispose();
    reply({ raster: new Uint8Array(512 * 512), cut: new Uint8Array(512 * 512) });
    await pending;
    expect(internal.tiles.get(key)).toBe(isMove ? tile : undefined);
  } finally {
    water.dispose();
    world.free();
  }
});

it("does not publish an evicted tile after its geometry yielded", async () => {
  const { water, world, scene, internal, tile, old, key } = setup();
  try {
    await new FrameWork(0, async () => {
      internal.tiles.delete(key);
    }).run(internal.surfaceSteps(tile));
    expect(scene.children).toEqual([old]);
    expect(tile.surface).toBe(old);
  } finally {
    old.geometry.dispose();
    water.dispose();
    world.free();
  }
});

it("retains raster boundaries and sees a cached tile replaced by a newly loaded dry tile", async () => {
  const { water, world, internal, tile } = setup();
  tile.polygons = [[tile.shores![0][0].pts]];
  tile.raster = new Uint8Array(512 * 512).fill(1);
  tile.raster[0] = 0;
  const get = vi.spyOn(internal.tiles, "get");
  try {
    expect(water.isWater(tile.x, tile.y)).toBe(false);
    expect(water.isWater(tile.x + 1 / 512, tile.y)).toBe(true);
    expect(water.isWater(tile.x + 1 - Number.EPSILON * tile.x, tile.y + 0.5)).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(water.isWater(tile.x + 1, tile.y)).toBe(false);
    await internal.fetchTile(tile.x, tile.y);
    expect(water.isWater(tile.x + 0.5, tile.y + 0.5)).toBe(false);
  } finally {
    water.dispose();
    world.free();
  }
});

it("does not retain water from an evicted or disposed cached tile", async () => {
  const { water, world, internal, tile } = setup();
  tile.polygons = [[tile.shores![0][0].pts]];
  tile.raster = new Uint8Array(512 * 512).fill(1);
  const load = vi
    .spyOn(internal as unknown as { load(x: number, y: number): Promise<void> }, "load")
    .mockResolvedValue();
  try {
    expect(water.isWater(tile.x + 0.5, tile.y + 0.5)).toBe(true);
    await water.around(tileYToLat(tile.y + 10.5, WATER_ZOOM), tileXToLon(tile.x + 10.5, WATER_ZOOM));
    expect(load).toHaveBeenCalled();
    expect(water.isWater(tile.x + 0.5, tile.y + 0.5)).toBe(false);
    internal.tiles.set(`${tile.x}/${tile.y}`, tile);
    expect(water.isWater(tile.x + 0.5, tile.y + 0.5)).toBe(true);
    water.dispose();
    expect(water.isWater(tile.x + 0.5, tile.y + 0.5)).toBe(false);
  } finally {
    water.dispose();
    world.free();
  }
});

it("waits for a yielding road install before generating the shore on the shared queue", async () => {
  const queue = new SerialWork();
  const { water, world, scene, internal, tile, key, old } = setup(queue);
  prepareShoreTiles();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = new LocalFrame(35.681, 139.762, 42);
  const road = queue.run(async () => {
    await held;
    water.setFrame(next);
  });
  const fetch = internal.fetchTile(tile.x, tile.y);
  try {
    await vi.waitFor(() => expect(internal.tiles.get(key)).not.toBe(tile));
    expect(internal.tiles.get(key)?.shores).toBeNull();
    expect(scene.children).toEqual([old]);
    release();
    await road;
    await fetch;
    expect(internal.tiles.get(key)?.shores).not.toBeNull();
    const mesh = scene.children.find((m) => m.name === `water-${tile.x}-${tile.y}`) as Mesh;
    expect(mesh).toBeDefined();
    const position = mesh.geometry.getAttribute("position");
    const shore = internal.tiles.get(key)!.shores![0][0];
    expect(position.count).toBe(shore.level.length);
    for (let i = 0; i < position.count; i++) {
      const point = next.toLocal(
        tileYToLat(shore.pts[i * 2 + 1], WATER_ZOOM),
        tileXToLon(shore.pts[i * 2], WATER_ZOOM),
        2,
      );
      expect([position.getX(i), position.getY(i), position.getZ(i)]).toEqual([
        Math.fround(point.x),
        Math.fround(point.y),
        Math.fround(point.z),
      ]);
    }
  } finally {
    release();
    await fetch;
    water.dispose();
    old.geometry.dispose();
    world.free();
  }
});

it.each(["evict", "dispose"])(
  "does not publish shore work delayed by a road install after %s",
  async (action) => {
    const queue = new SerialWork();
    const { water, world, scene, internal, tile, key, old } = setup(queue);
    prepareShoreTiles();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const road = queue.run(() => held);
    const fetch = internal.fetchTile(tile.x, tile.y);
    try {
      await vi.waitFor(() => expect(internal.tiles.get(key)).not.toBe(tile));
      const evict = action === "evict";
      if (evict) {
        vi.spyOn(
          internal as unknown as { load(x: number, y: number): Promise<void> },
          "load",
        ).mockResolvedValue();
        await water.around(tileYToLat(tile.y + 10.5, WATER_ZOOM), tileXToLon(tile.x + 10.5, WATER_ZOOM));
      } else water.dispose();
      release();
      await road;
      await fetch;
      expect(internal.tiles.has(key)).toBe(false);
      expect(scene.children).toEqual([old]);
    } finally {
      release();
      await fetch;
      water.dispose();
      old.geometry.dispose();
      world.free();
    }
  },
);

it("carries the shore frame budget from one small tile into the next", async () => {
  const { water, world, internal, tile, old } = setup();
  prepareShoreTiles();
  let now = 0,
    frames = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames++;
    queueMicrotask(() => callback(now));
    return frames;
  });
  const steps = water as unknown as {
    shoreRingSteps(
      ring: number[],
    ): Generator<void, { pts: number[]; level: Float32Array; tide: Float32Array }>;
    surfaceSteps(tile: { x: number }): Generator<void>;
    wallSteps(tile: { x: number }): Generator<void>;
  };
  vi.spyOn(steps, "shoreRingSteps").mockImplementation(function* (ring) {
    now += 3;
    yield;
    return { pts: ring, level: new Float32Array(0), tide: new Float32Array(0) };
  });
  const published: Array<{ x: number; frames: number }> = [];
  vi.spyOn(steps, "surfaceSteps").mockImplementation(function* (value) {
    published.push({ x: value.x, frames });
    yield;
  });
  vi.spyOn(steps, "wallSteps").mockImplementation(function* () {
    now += 3;
    yield;
  });
  try {
    await Promise.all([internal.fetchTile(tile.x, tile.y), internal.fetchTile(tile.x + 1, tile.y)]);
    expect(published).toEqual([
      { x: tile.x, frames: 0 },
      { x: tile.x + 1, frames: 2 },
    ]);
  } finally {
    water.dispose();
    old.geometry.dispose();
    world.free();
  }
});
