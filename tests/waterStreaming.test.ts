import RAPIER from "@dimforge/rapier3d-compat";
import { BufferGeometry, Mesh, Scene, Sphere, Vector3 } from "three";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { FrameWork } from "../src/game/frameWork";
import { LocalFrame } from "../src/geo/frame";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../src/geo/tiles";
import type { DemStore } from "../src/world/dem";
import type { Tide } from "../src/world/tide";
import { WaterLayer } from "../src/world/water";
import { WaterCompute } from "../src/world/waterCompute";
import { WATER_ZOOM } from "../src/world/waterGeometry";

beforeAll(() => RAPIER.init());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 })),
  );
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const scene = new Scene();
  const frame = new LocalFrame(35.68, 139.76, 40);
  const dem = { ellipsoidal: (_lat: number, _lon: number, h: number) => h } as DemStore;
  const water = new WaterLayer(scene, world, dem, { meanLevel: 0 } as Tide, frame);
  const gx = lonToTileX(139.76, WATER_ZOOM),
    gy = latToTileY(35.68, WATER_ZOOM);
  const pts = [gx, gy, gx + 0.05, gy, gx + 0.05, gy + 0.05, gx, gy + 0.05];
  const old = new Mesh(new BufferGeometry());
  scene.add(old);
  const tile = {
    x: Math.floor(gx),
    y: Math.floor(gy),
    version: 1,
    polygons: [],
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
