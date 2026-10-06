import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Matrix4, Scene, Vector3, type Mesh, type Texture } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import { Geoid } from "../src/geo/geoid";
import { LocalFrame } from "../src/geo/frame";
import { geodeticToEcef } from "../src/geo/ellipsoid";
import { tileXToLon, tileYToLat } from "../src/geo/tiles";
import { DemStore } from "../src/world/dem";
import { Terrain } from "../src/world/terrain";
import { TerrainCompute, type TerrainRequest } from "../src/world/terrainCompute";
import { computeTerrain, type TerrainData, type TerrainInput } from "../src/world/terrainData";
import { setTerrainImagery } from "../src/world/terrainMaterial";

vi.mock("../src/world/farGround", () => ({
  FarGround: class {
    setFrame(): void {}
    dispose(): void {}
  },
}));

class WorkerStub extends EventTarget {
  requests: TerrainRequest[] = [];
  detached: number[][] = [];
  terminate = vi.fn();
  postMessage(request: TerrainRequest, transfer: Transferable[]): void {
    this.requests.push(structuredClone(request, { transfer }));
    this.detached.push(request.input.tiles.map((tile) => tile.byteLength));
  }
  reply(index: number): void {
    const request = this.requests[index];
    const data = computeTerrain(request.input);
    this.dispatchEvent(new MessageEvent("message", { data: { id: request.id, data, computeMs: 1 } }));
  }
}

function input(segments = 64, x = 29106, y = 12903): TerrainInput {
  return {
    x,
    y,
    zoom: 15,
    segments,
    tiles: Array.from({ length: 4 }, (_, tile) =>
      Float32Array.from(
        { length: 65536 },
        (_value, i) => Math.sin(i * 0.003) * 7 + tile * 13 + (i % 29) * 0.1,
      ),
    ),
    geoid: { lat0: 35.5, lon0: 139.5, dLat: 0.5, dLon: 0.5, nLat: 2, nLon: 2, values: [35, 37, 39, 41] },
  };
}

function store(source: TerrainInput): DemStore {
  const dem = new DemStore(new Geoid(source.geoid));
  const tiles = new Map(
    source.tiles.map((tile, i) => [`${source.x + (i % 2)}/${source.y + Math.floor(i / 2)}`, tile]),
  );
  Reflect.set(dem, "loaded", tiles);
  vi.spyOn(dem, "load").mockImplementation(async (x, y) => tiles.get(`${x}/${y}`)!);
  return dem;
}

/** Reference uses DemStore's global lookup and native Three normals, independent of the new sampler. */
function original(source: TerrainInput): TerrainData {
  const dem = store(source),
    { x, y, zoom, segments: S } = source;
  const c = geodeticToEcef(tileYToLat(y + 0.5, zoom), tileXToLon(x + 0.5, zoom), 40);
  const positions = new Float32Array((S + 1) ** 2 * 3),
    uvs = new Float32Array((S + 1) ** 2 * 2);
  for (let j = 0; j <= S; j++) {
    const lat = tileYToLat(y + j / S, zoom);
    for (let i = 0; i <= S; i++) {
      const lon = tileXToLon(x + i / S, zoom);
      const h = dem.sampleGlobal((x + i / S) * 256, (y + j / S) * 256);
      const p = geodeticToEcef(lat, lon, dem.ellipsoidal(lat, lon, h)),
        k = j * (S + 1) + i;
      positions.set([p.x - c.x, p.y - c.y, p.z - c.z], k * 3);
      uvs.set([i / S, 1 - j / S], k * 2);
    }
  }
  const indices = new Uint32Array(S * S * 6);
  let n = 0;
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const a = j * (S + 1) + i,
        b = a + 1,
        c2 = a + (S + 1),
        d = c2 + 1;
      indices.set([a, c2, b, b, c2, d], n);
      n += 6;
    }
  const geometry = new BufferGeometry().setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return {
    positions,
    uvs,
    indices,
    normals: geometry.getAttribute("normal").array as Float32Array,
    centerEcef: [c.x, c.y, c.z],
    box: {
      min: geometry.boundingBox!.min.toArray() as [number, number, number],
      max: geometry.boundingBox!.max.toArray() as [number, number, number],
    },
    sphere: {
      center: geometry.boundingSphere!.center.toArray() as [number, number, number],
      radius: geometry.boundingSphere!.radius,
    },
  };
}

function exact(actual: TerrainData, expected: TerrainData): void {
  for (const field of ["positions", "uvs", "indices", "normals"] as const) {
    expect(actual[field].length).toBe(expected[field].length);
    expect(actual[field].every((value, i) => Object.is(value, expected[field][i]))).toBe(true);
  }
  expect(actual.centerEcef).toEqual(expected.centerEcef);
  expect(actual.box).toEqual(expected.box);
  expect(actual.sphere).toEqual(expected.sphere);
}
const frames = () =>
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("terrain geometry parity", () => {
  it.each([64, 63, 8])("keeps elevations, winding, normals and bounds exact with %i segments", (segments) => {
    const source = input(segments);
    exact(computeTerrain(source), original(source));
  });
  it("keeps geoid fallback, clamped geoid edges and negative global pixel coordinates", () => {
    const source = input(8, -3, -2);
    exact(computeTerrain(source), original(source));
    source.geoid = null;
    exact(computeTerrain(source), original(source));
  });
  it("loads all four corner neighbours and snapshots geoid data without detaching DEM heights", async () => {
    const source = input(),
      dem = store(source);
    const value = await dem.loadTerrainInput(source.x, source.y);
    expect(dem.load).toHaveBeenCalledTimes(4);
    expect(value.tiles).toEqual(source.tiles);
    expect(value.geoid).toEqual(source.geoid);
    value.geoid!.values[0] = -99;
    expect(source.geoid!.values[0]).toBe(35);
  });
});

describe("terrain worker ownership and recovery", () => {
  it("transfers copies and matches out-of-order replies without losing driving height samples", async () => {
    const worker = new WorkerStub(),
      compute = new TerrainCompute(() => worker as unknown as Worker);
    const a = input(8),
      b = input(16),
      before = a.tiles.map((tile) => tile.slice());
    const first = compute.prepare(a, "a"),
      second = compute.prepare(b, "b");
    expect(worker.detached).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(a.tiles).toEqual(before);
    worker.reply(1);
    exact(await second, original(b));
    worker.reply(0);
    exact(await first, original(a));
    expect(a.tiles).toEqual(before);
    compute.dispose();
  });
  it.each(["constructor", "postMessage", "runtime", "messageerror", "reply-error"])(
    "keeps the same terrain after a %s failure and uses the fallback for later tiles",
    async (failure) => {
      frames();
      const worker = new WorkerStub(),
        source = input();
      const compute = new TerrainCompute(() => {
        const isUnavailable = failure === "constructor";
        if (isUnavailable) throw new Error("unavailable");
        return worker as unknown as Worker;
      });
      const isPostFailure = failure === "postMessage";
      if (isPostFailure)
        vi.spyOn(worker, "postMessage").mockImplementation(() => {
          throw new Error("failed");
        });
      const pending = compute.prepare(source, "failed");
      const isRuntime = failure === "runtime",
        isDecode = failure === "messageerror",
        isReply = failure === "reply-error";
      if (isRuntime)
        worker.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: "failed" }));
      if (isDecode) worker.dispatchEvent(new MessageEvent("messageerror"));
      if (isReply) worker.dispatchEvent(new MessageEvent("message", { data: { id: 1, error: "failed" } }));
      exact(await pending, original(source));
      exact(await compute.prepare(source, "later"), original(source));
      compute.dispose();
    },
  );
  it("times out to the exact terrain and ignores late replies", async () => {
    frames();
    vi.useFakeTimers();
    const worker = new WorkerStub(),
      compute = new TerrainCompute(() => worker as unknown as Worker),
      source = input();
    const pending = compute.prepare(source, "timeout");
    await vi.advanceTimersByTimeAsync(30000);
    exact(await pending, original(source));
    worker.reply(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
    compute.dispose();
  });
  it("rejects pending and future tiles on disposal", async () => {
    const worker = new WorkerStub(),
      compute = new TerrainCompute(() => worker as unknown as Worker);
    const pending = compute.prepare(input(8), "pending");
    const rejected = expect(pending).rejects.toThrow("disposed");
    compute.dispose();
    await rejected;
    worker.reply(0);
    await expect(compute.prepare(input(8), "future")).rejects.toThrow("disposed");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("stops an active yielding fallback on disposal without scheduling another frame", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => ++now);
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    const compute = new TerrainCompute(() => {
      throw new Error("unavailable");
    });
    const pending = compute.prepare(input(), "yielding");
    const rejected = expect(pending).rejects.toThrow("disposed");
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);
    compute.dispose();
    await rejected;
    callbacks[0](now);
    await Promise.resolve();
    await Promise.resolve();
    expect(raf).toHaveBeenCalledOnce();
    clock.mockRestore();
  });
});

function terrain(source: TerrainInput) {
  const scene = new Scene(),
    worker = new WorkerStub();
  const oldFrame = new LocalFrame(35.68, 139.76, 40);
  const ground = new Terrain(scene, {} as RAPIER.World, store(source), {} as WebGPURenderer, oldFrame);
  Reflect.set(ground, "compute", new TerrainCompute(() => worker as unknown as Worker));
  Reflect.set(ground, "loadImagery", async () => {});
  const build = Reflect.get(ground, "buildChunk").bind(ground) as (
    x: number,
    y: number,
    ring: number,
  ) => Promise<void>;
  return { scene, worker, ground, build };
}

describe("terrain asynchronous install", () => {
  it("treats a fully wet chunk as prepared without an empty trimesh, then restores dry ground", async () => {
    const source = input(),
      { worker, ground, build } = terrain(source);
    const world = { createCollider: vi.fn(() => ({ handle: 9 })), removeCollider: vi.fn() };
    Reflect.set(ground, "world", world);
    let data = new Uint8Array(16).fill(255);
    ground.setWater({ versionAt: () => 1, maskAt: () => ({ data, size: 4 }) });
    const pending = build(source.x, source.y, 0);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.reply(0);
    await pending;
    const chunks = Reflect.get(ground, "chunks") as Map<string, unknown>;
    const chunk = chunks.get(`${source.x}/${source.y}`)!;
    const applyWater = Reflect.get(ground, "applyWater").bind(ground);
    applyWater(chunk, 1);
    Reflect.get(ground, "prepareCollider").call(ground, chunk);
    const lat = tileYToLat(source.y + 0.5, source.zoom),
      lon = tileXToLon(source.x + 0.5, source.zoom);
    expect(ground.hasColliderAt(lat, lon)).toBe(true);
    expect(world.createCollider).not.toHaveBeenCalled();
    ground.setFrame(new LocalFrame(35.71, 139.8, 40));
    expect(ground.hasColliderAt(lat, lon)).toBe(true);
    data = new Uint8Array(16);
    applyWater(chunk, 2);
    expect(world.createCollider).toHaveBeenCalledOnce();
    expect(ground.hasColliderAt(lat, lon)).toBe(true);
    data = new Uint8Array(16).fill(255);
    applyWater(chunk, 3);
    expect(world.createCollider).toHaveBeenCalledOnce();
    expect(world.removeCollider).toHaveBeenCalledOnce();
    expect(ground.hasColliderAt(lat, lon)).toBe(true);
    ground.dispose();
  });

  it("keeps water out of the grey placeholder until imagery arrives, then follows later water changes", async () => {
    const source = input(),
      { scene, worker, ground, build } = terrain(source);
    let data = new Uint8Array(16).fill(255);
    ground.setWater({ versionAt: () => 1, maskAt: () => ({ data, size: 4 }) });
    const pending = build(source.x, source.y, 0);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.reply(0);
    await pending;
    const mesh = scene.children[0] as Mesh<
      BufferGeometry,
      MeshStandardNodeMaterial & { terrainWaterMap: Texture }
    >;
    const initialMask = mesh.material.terrainWaterMap;
    const chunks = Reflect.get(ground, "chunks") as Map<string, unknown>;
    const chunk = chunks.get(`${source.x}/${source.y}`)! as {
      imageryZoom: number;
      water: { value: Texture };
      waterMask: Uint8Array;
    };
    const applyWater = Reflect.get(ground, "applyWater").bind(ground);
    applyWater(chunk, 1);
    expect(chunk.waterMask).toBe(data);
    expect(mesh.material.terrainWaterMap).not.toBe(chunk.water.value);
    applyWater(chunk, 2);
    expect(mesh.material.terrainWaterMap).toBe(initialMask);
    const photo = mesh.material.map!.clone();
    setTerrainImagery(mesh.material, photo, chunk.water.value);
    chunk.imageryZoom = 18;
    expect(mesh.material.terrainWaterMap).toBe(chunk.water.value);
    data = new Uint8Array(16);
    applyWater(chunk, 3);
    expect(chunk.waterMask).toBe(data);
    expect(mesh.material.terrainWaterMap).toBe(chunk.water.value);
    ground.dispose();
  });
  it("installs prepared geometry with the latest local frame after a reanchor while waiting", async () => {
    const source = input(),
      { scene, worker, ground, build } = terrain(source);
    const pending = build(source.x, source.y, 0);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    expect(scene.children).toHaveLength(0);
    const frame = new LocalFrame(35.7101, 139.8015, 40);
    ground.setFrame(frame);
    worker.reply(0);
    await pending;
    const mesh = scene.children[0] as Mesh;
    const expected = original(source);
    expect(mesh.geometry.getAttribute("position").array).toEqual(expected.positions);
    expect(mesh.geometry.getAttribute("normal").array).toEqual(expected.normals);
    expect(mesh.matrix.elements).toEqual(
      new Matrix4().multiplyMatrices(
        frame.ecefToLocal,
        new Matrix4().makeTranslation(new Vector3().fromArray(expected.centerEcef)),
      ).elements,
    );
    ground.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it("cannot add a mesh after disposal while a Worker reply is pending", async () => {
    const source = input(),
      { scene, worker, ground, build } = terrain(source);
    const pending = build(source.x, source.y, 0);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    const rejected = expect(pending).rejects.toThrow("disposed");
    ground.dispose();
    await rejected;
    worker.reply(0);
    expect(scene.children).toHaveLength(0);
  });
  it("does not start a Worker when disposal occurs during DEM loading", async () => {
    const source = input(),
      { scene, worker, ground, build } = terrain(source);
    let release!: (value: TerrainInput) => void;
    const dem = Reflect.get(ground, "dem") as DemStore;
    vi.spyOn(dem, "loadTerrainInput").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = build(source.x, source.y, 0);
    ground.dispose();
    release(source);
    await pending;
    expect(worker.requests).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });
});
