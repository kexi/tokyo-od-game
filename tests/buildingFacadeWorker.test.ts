import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Float16BufferAttribute,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from "three";
import type { Tile } from "3d-tiles-renderer/core";
import { BuildingFacadeCompute, type BuildingFacadeRequest } from "../src/world/buildingFacadeCompute";
import { computeBuildingFacade } from "../src/world/buildingFacadeData";
import { BuildingFacadePlugin } from "../src/world/buildingFacadePlugin";

class WorkerStub extends EventTarget {
  requests: BuildingFacadeRequest[] = [];
  detached: number[] = [];
  terminate = vi.fn();
  postMessage(request: BuildingFacadeRequest, transfer: Transferable[]): void {
    this.requests.push(structuredClone(request, { transfer }));
    this.detached.push(request.input.position.array.byteLength);
  }
  reply(index: number): void {
    const request = this.requests[index];
    const data = computeBuildingFacade(request.input);
    this.dispatchEvent(new MessageEvent("message", { data: { id: request.id, data, computeMs: 1 } }));
  }
}

function geometry(count = 12): BufferGeometry {
  const value = new BufferGeometry();
  value.setAttribute(
    "position",
    new BufferAttribute(
      Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 1 ? i / 3 : Math.sin(i))),
      3,
    ),
  );
  value.setAttribute(
    "_batchid",
    new BufferAttribute(
      Uint16Array.from({ length: count }, (_, i) => i % 3),
      1,
    ),
  );
  return value;
}
const matrix = () => new Matrix4().makeRotationZ(-Math.PI / 2).setPosition(6378137, 3000, -4000);
const frames = () =>
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    }),
  );
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("building worker data ownership", () => {
  it("transfers copies, matches out-of-order replies and keeps render/physics vertex arrays attached", async () => {
    const worker = new WorkerStub();
    const compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
    const a = geometry(),
      b = geometry(24);
    const before = a.getAttribute("position").array.slice();
    const first = compute.prepare(a, matrix(), "a"),
      second = compute.prepare(b, matrix(), "b");
    expect(worker.detached).toEqual([0, 0]);
    expect(a.getAttribute("position").array).toEqual(before);
    worker.reply(1);
    expect((await second).facade.length).toBe(48);
    worker.reply(0);
    const result = await first;
    const expected = new Float32Array(before.length);
    const vertex = new Vector3();
    for (let i = 0; i < a.getAttribute("position").count; i++) {
      vertex.fromBufferAttribute(a.getAttribute("position"), i).applyMatrix4(matrix());
      expected.set([vertex.x, vertex.y, vertex.z], i * 3);
    }
    expect(result.ecef).toEqual(expected);
    expect(a.getAttribute("position").array).toEqual(before);
    compute.dispose();
  });

  it.each(["interleaved", "normalized", "float16"])("preserves Three's %s getter semantics", async (kind) => {
    const source = geometry(3);
    const isInterleaved = kind === "interleaved";
    const isNormalized = kind === "normalized";
    if (isInterleaved) {
      const data = new InterleavedBuffer(new Float32Array([1, 2, 3, 0, 4, 5, 6, 1, 7, 8, 9, 1]), 4);
      source.setAttribute("position", new InterleavedBufferAttribute(data, 3, 0));
      source.setAttribute("_batchid", new InterleavedBufferAttribute(data, 1, 3));
    } else if (isNormalized) {
      source.setAttribute(
        "position",
        new BufferAttribute(new Int16Array([-32768, 0, 32767, 10, 100, 1000, -200, 300, 400]), 3, true),
      );
    } else {
      source.setAttribute(
        "position",
        new Float16BufferAttribute(
          new Uint16Array([0x3c00, 0x4000, 0x4200, 0x4400, 0x4500, 0x4600, 0x4700, 0x4800, 0x4880]),
          3,
        ),
      );
    }
    source.setAttribute("_feature_id_0", new BufferAttribute(new Uint8Array([9, 9, 9]), 1));
    const worker = new WorkerStub();
    const compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
    const pending = compute.prepare(source, matrix(), kind);
    const request = worker.requests[0].input;
    expect(request.ids!.array).not.toEqual(new Uint8Array([9, 9, 9]));
    worker.reply(0);
    const result = await pending;
    const expected = new Float32Array(9),
      vertex = new Vector3();
    for (let i = 0; i < 3; i++) {
      vertex.fromBufferAttribute(source.getAttribute("position"), i).applyMatrix4(matrix());
      expected.set([vertex.x, vertex.y, vertex.z], i * 3);
    }
    expect(result.ecef).toEqual(expected);
    expect(result.facade).toHaveLength(6);
    compute.dispose();
  });

  it.each(["constructor", "postMessage", "runtime", "messageerror", "reply-error"])(
    "retains exact source data after a %s failure",
    async (failure) => {
      frames();
      const worker = new WorkerStub();
      const compute = new BuildingFacadeCompute(() => {
        const isUnavailable = failure === "constructor";
        if (isUnavailable) throw new Error("unavailable");
        return worker as unknown as Worker;
      });
      const isPostFailure = failure === "postMessage";
      if (isPostFailure)
        vi.spyOn(worker, "postMessage").mockImplementation(() => {
          throw new Error("post failed");
        });
      const source = geometry(10000),
        before = source.getAttribute("position").array.slice();
      const pending = compute.prepare(source, matrix(), "failure");
      const isRuntime = failure === "runtime",
        isMessage = failure === "messageerror",
        isReplyError = failure === "reply-error";
      if (isRuntime)
        worker.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: "crashed" }));
      if (isMessage) worker.dispatchEvent(new MessageEvent("messageerror"));
      if (isReplyError)
        worker.dispatchEvent(new MessageEvent("message", { data: { id: 1, error: "failed" } }));
      const result = await pending;
      expect(source.getAttribute("position").array).toEqual(before);
      const again = await compute.prepare(source, matrix(), "future-fallback");
      expect(again).toEqual(result);
      compute.dispose();
    },
  );

  it("times out to the exact fallback and ignores a late worker reply", async () => {
    frames();
    vi.useFakeTimers();
    const worker = new WorkerStub();
    const compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
    const pending = compute.prepare(geometry(), matrix(), "timeout");
    await vi.advanceTimersByTimeAsync(30001);
    const result = await pending;
    worker.reply(0);
    expect(result).toEqual(computeBuildingFacade(worker.requests[0].input));
    expect(worker.terminate).toHaveBeenCalledOnce();
    compute.dispose();
  });

  it("rejects waiting and fallback work on disposal and prevents new work", async () => {
    const worker = new WorkerStub();
    const compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
    const pending = compute.prepare(geometry(), matrix(), "disposed");
    const rejected = expect(pending).rejects.toThrow("disposed");
    compute.dispose();
    await rejected;
    worker.reply(0);
    await expect(compute.prepare(geometry(), matrix(), "later")).rejects.toThrow("disposed");
    const fallback = new BuildingFacadeCompute(() => {
      throw new Error("unavailable");
    });
    const fallbackPending = fallback.prepare(geometry(), matrix(), "fallback-disposed");
    const fallbackRejected = expect(fallbackPending).rejects.toThrow("disposed");
    fallback.dispose();
    await fallbackRejected;
  });

  it("awaits preparation before exposing the façade and takes ECEF once for landmark clipping", async () => {
    const worker = new WorkerStub(),
      compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
    const plugin = new BuildingFacadePlugin(compute);
    const model = new Group(),
      mesh = new Mesh(geometry(), new MeshStandardMaterial());
    model.add(mesh);
    model.matrix.copy(matrix());
    model.matrixAutoUpdate = false;
    const pending = plugin.processTileModel(model, { content: { uri: "test.b3dm" } } as Tile);
    expect(mesh.geometry.hasAttribute("facade")).toBe(false);
    worker.reply(0);
    await pending;
    expect(mesh.geometry.getAttribute("facade").count).toBe(12);
    expect(plugin.takeEcef(mesh)).toEqual(computeBuildingFacade(worker.requests[0].input).ecef);
    expect(() => plugin.takeEcef(mesh)).toThrow("before façade preparation");
    plugin.dispose();
  });

  it("stops a yielding fallback at disposal instead of continuing to consume frames", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
    );
    const compute = new BuildingFacadeCompute(() => {
      throw new Error("unavailable");
    });
    const pending = compute.prepare(geometry(300000), matrix(), "yielding-disposed");
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);
    const rejected = expect(pending).rejects.toThrow("disposed");
    compute.dispose();
    callbacks[0](performance.now());
    await rejected;
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);
  });

  it.each([false, true])(
    "awaits shader preparation before finishing the tile (disposed=%s)",
    async (disposed) => {
      const worker = new WorkerStub(),
        compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
      let finish!: () => void;
      const ready = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const prepareScene = vi.fn(async (scene: Object3D) => {
        expect((scene.children[0] as Mesh).geometry.hasAttribute("facade")).toBe(true);
        await ready;
      });
      const plugin = new BuildingFacadePlugin(compute, prepareScene);
      const model = new Group();
      const mesh = new Mesh(geometry(), new MeshStandardMaterial());
      model.add(mesh);
      const releaseGeometry = vi.spyOn(mesh.geometry, "dispose"),
        releaseMaterial = vi.spyOn(mesh.material, "dispose");
      const pending = plugin.processTileModel(model, {} as Tile);
      const finished = vi.fn();
      void pending.then(finished, () => {});
      worker.reply(0);
      await vi.waitFor(() => expect(prepareScene).toHaveBeenCalledOnce());
      expect(finished).not.toHaveBeenCalled();
      if (disposed) plugin.dispose();
      expect(releaseGeometry).not.toHaveBeenCalled();
      expect(releaseMaterial).not.toHaveBeenCalled();
      finish();
      if (disposed) await expect(pending).rejects.toThrow("disposed");
      else await pending;
      expect(releaseGeometry).toHaveBeenCalledTimes(disposed ? 1 : 0);
      expect(releaseMaterial).toHaveBeenCalledTimes(disposed ? 1 : 0);
      plugin.dispose();
    },
  );

  it("abandons an evicted tile and releases its prepared GPU data after compilation finishes", async () => {
    const worker = new WorkerStub(),
      compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
    let finish!: () => void, signal!: AbortSignal;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const prepareScene = vi.fn(async (_scene: Object3D, _tile: Tile, value: AbortSignal) => {
      signal = value;
      await ready;
    });
    const plugin = new BuildingFacadePlugin(compute, prepareScene);
    const model = new Group(),
      mesh = new Mesh(geometry(), new MeshStandardMaterial()),
      tile = {} as Tile;
    model.add(mesh);
    const releaseGeometry = vi.spyOn(mesh.geometry, "dispose"),
      releaseMaterial = vi.spyOn(mesh.material, "dispose");
    const pending = plugin.processTileModel(model, tile);
    worker.reply(0);
    await vi.waitFor(() => expect(prepareScene).toHaveBeenCalledOnce());
    plugin.disposeTile(tile);
    expect(signal.aborted).toBe(true);
    expect(releaseGeometry).not.toHaveBeenCalled();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    finish();
    await rejected;
    expect(releaseGeometry).toHaveBeenCalledOnce();
    expect(releaseMaterial).toHaveBeenCalledOnce();
    plugin.dispose();
  });

  it("keeps a new request for the same tile cancellable when the old request finishes", async () => {
    const worker = new WorkerStub(),
      compute = new BuildingFacadeCompute(() => worker as unknown as Worker);
    const plugin = new BuildingFacadePlugin(compute, vi.fn());
    const tile = {} as Tile;
    const model = () => {
      const group = new Group();
      group.add(new Mesh(geometry(), new MeshStandardMaterial()));
      return group;
    };
    const first = plugin.processTileModel(model(), tile);
    const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    plugin.disposeTile(tile);
    const second = plugin.processTileModel(model(), tile);
    const secondRejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    worker.reply(0);
    await firstRejected;
    plugin.disposeTile(tile);
    worker.reply(1);
    await secondRejected;
    plugin.dispose();
  });
});
