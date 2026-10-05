import { afterEach, expect, it, vi } from "vitest";
import { WaterCompute, type WaterMaskRequest } from "../src/world/waterCompute";
import { coverage, dilate, rasterize, type WaterPolygon } from "../src/world/waterGeometry";

class WorkerStub extends EventTarget {
  requests: WaterMaskRequest[] = [];
  postMessage(request: WaterMaskRequest): void {
    this.requests.push(structuredClone(request));
  }
  terminate = vi.fn();
  reply(index: number): void {
    const { id, polygons, x, y, size } = this.requests[index];
    const masks = {
      raster: rasterize(polygons, x, y, 1, size),
      cut: dilate(coverage(polygons, x, y, 1, size), size),
    };
    this.dispatchEvent(new MessageEvent("message", { data: { id, masks, computeMs: 1 } }));
  }
}

const polygon = (x: number, y: number): WaterPolygon[] => [
  [
    [x, y, x + 0.75, y, x + 0.75, y + 1, x, y + 1],
    [x + 0.25, y + 0.25, x + 0.25, y + 0.5, x + 0.5, y + 0.5, x + 0.5, y + 0.25],
  ],
];
const reference = (x: number, y: number, size: number) => ({
  raster: rasterize(polygon(x, y), x, y, 1, size),
  cut: dilate(coverage(polygon(x, y), x, y, 1, size), size),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("matches concurrent tile replies without detaching the source polygons", async () => {
  const worker = new WorkerStub();
  const compute = new WaterCompute(() => worker as unknown as Worker);
  try {
    const source = polygon(10, 20);
    const a = compute.rasterize(source, 10, 20, 32);
    const b = compute.rasterize(polygon(30, 40), 30, 40, 16);
    worker.reply(1);
    expect(await b).toEqual(reference(30, 40, 16));
    worker.reply(0);
    expect(await a).toEqual(reference(10, 20, 32));
    expect(source).toEqual(polygon(10, 20));
  } finally {
    compute.dispose();
  }
});

it.each(["constructor", "runtime", "messageerror", "postMessage", "reply", "timeout"])(
  "keeps the shoreline and water point tests exact after a %s failure and yields rendering",
  async (failure) => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ++now);
    const frames = vi.fn((callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", frames);
    const worker = new WorkerStub();
    const compute = new WaterCompute(() => {
      const isUnavailable = failure === "constructor";
      if (isUnavailable) throw new Error("unavailable");
      return worker as unknown as Worker;
    });
    try {
      const isPostFailure = failure === "postMessage";
      if (isPostFailure)
        vi.spyOn(worker, "postMessage").mockImplementation(() => {
          throw new Error("clone failed");
        });
      const isTimeout = failure === "timeout";
      if (isTimeout) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const a = compute.rasterize(polygon(10, 20), 10, 20, 512);
      const b = compute.rasterize(polygon(30, 40), 30, 40, 256);
      const isRuntime = failure === "runtime";
      const isDecode = failure === "messageerror";
      const isReplyError = failure === "reply";
      if (isRuntime)
        worker.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: "crashed" }));
      if (isDecode) worker.dispatchEvent(new MessageEvent("messageerror"));
      if (isReplyError)
        worker.dispatchEvent(new MessageEvent("message", { data: { id: 1, error: "failed" } }));
      if (isTimeout) {
        await vi.advanceTimersByTimeAsync(30000);
        vi.useRealTimers();
      }
      expect(await a).toEqual(reference(10, 20, 512));
      expect(await b).toEqual(reference(30, 40, 256));
      expect(await compute.rasterize(polygon(30, 40), 30, 40, 256)).toEqual(reference(30, 40, 256));
      expect(frames).toHaveBeenCalled();
    } finally {
      compute.dispose();
    }
  },
);

it("rejects pending work and ignores a late reply when disposed", async () => {
  const worker = new WorkerStub();
  const compute = new WaterCompute(() => worker as unknown as Worker);
  const pending = compute.rasterize(polygon(1, 2), 1, 2, 16);
  const rejected = expect(pending).rejects.toThrow("disposed");
  compute.dispose();
  worker.reply(0);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
  await expect(compute.rasterize([], 1, 2, 16)).rejects.toThrow("disposed");
});

it("yields when many small tiles together exceed the fallback frame budget", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (now += 0.01));
  const frames = vi.fn((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", frames);
  const compute = new WaterCompute(() => {
    throw new Error("unavailable");
  });
  try {
    const tiles = await Promise.all(
      Array.from({ length: 30 }, () => compute.rasterize(polygon(1, 2), 1, 2, 4)),
    );
    expect(tiles).toHaveLength(30);
    expect(tiles.every((t) => t.raster.length === 16 && t.cut.length === 16)).toBe(true);
    expect(frames).toHaveBeenCalled();
  } finally {
    compute.dispose();
  }
});

it("stops a failed worker's fallback at the next frame after disposal", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => ++now);
  const worker = new WorkerStub();
  const compute = new WaterCompute(() => worker as unknown as Worker);
  const frames = vi.fn((callback: FrameRequestCallback) => {
    compute.dispose();
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", frames);
  const pending = compute.rasterize(polygon(1, 2), 1, 2, 512);
  const rejected = expect(pending).rejects.toThrow("disposed");
  worker.dispatchEvent(new MessageEvent("messageerror"));
  await rejected;
  expect(frames).toHaveBeenCalledOnce();
});
