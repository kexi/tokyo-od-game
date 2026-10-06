import { afterEach, expect, it, vi } from "vitest";
import { VectorTileCompute } from "../src/world/vectorTileCompute";
import {
  decodeVectorTile,
  packVectorTile,
  vectorTileTransfers,
  type VectorTileInput,
} from "../src/world/vectorTileData";
import type { VectorTileRequest } from "../src/world/vectorTile.worker";
import { inputFixture } from "./vectorTileFixture";

class WorkerStub extends EventTarget {
  requests: VectorTileRequest[] = [];
  postMessage(request: VectorTileRequest, transfer: ArrayBuffer[]): void {
    this.requests.push(structuredClone(request, { transfer }));
    expect(request.buffer.byteLength).toBe(0);
  }
  terminate = vi.fn();
  reply(index: number): void {
    const input = this.requests[index];
    const packet = packVectorTile(decodeVectorTile(input));
    const data = structuredClone(
      { id: input.id, packet, computeMs: 1 },
      { transfer: vectorTileTransfers(packet) },
    );
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
const input = (source: "gsi" | "pavement" = "gsi"): VectorTileInput => ({
  source,
  z: 16,
  x: 58212,
  y: 25807,
  buffer: inputFixture(),
});
const clock = (step = 1) => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (now += step));
  const frames = vi.fn((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", frames);
  return frames;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("matches out-of-order replies and ignores duplicates while retaining the original input bytes", async () => {
  const worker = new WorkerStub(),
    compute = new VectorTileCompute({ createWorker: () => worker as unknown as Worker });
  try {
    const a = input(),
      b = input("pavement");
    const original = new Uint8Array(a.buffer).slice();
    const first = compute.decode(a),
      second = compute.decode(b);
    worker.reply(1);
    worker.reply(1);
    expect(await second).toEqual(decodeVectorTile(b));
    worker.reply(0);
    expect(await first).toEqual(decodeVectorTile(a));
    expect(new Uint8Array(a.buffer)).toEqual(original);
  } finally {
    compute.dispose();
  }
});

it.each(["constructor", "runtime", "messageerror", "postMessage", "source", "timeout"])(
  "falls back to the exact retained bytes after a %s failure and shares the rendering budget",
  async (failure) => {
    const frames = clock();
    const worker = new WorkerStub(),
      compute = new VectorTileCompute({
        createWorker: () => {
          const unavailable = failure === "constructor";
          if (unavailable) throw new Error("unavailable");
          return worker as unknown as Worker;
        },
        timeoutMs: 10,
      });
    const isPostFailure = failure === "postMessage";
    if (isPostFailure)
      vi.spyOn(worker, "postMessage").mockImplementation(() => {
        throw new Error("clone failed");
      });
    const isTimeout = failure === "timeout";
    if (isTimeout) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const a = input(),
        b = input("pavement");
      const first = compute.decode(a),
        second = compute.decode(b);
      const isRuntime = failure === "runtime",
        isMessageError = failure === "messageerror",
        isSource = failure === "source";
      if (isRuntime)
        worker.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: "crashed" }));
      if (isMessageError) worker.dispatchEvent(new MessageEvent("messageerror"));
      if (isSource)
        worker.dispatchEvent(
          new MessageEvent("message", {
            data: { id: 1, packet: packVectorTile(decodeVectorTile(b)), computeMs: 1 },
          }),
        );
      if (isTimeout) {
        await vi.advanceTimersByTimeAsync(10);
        vi.useRealTimers();
      }
      expect(await first).toEqual(decodeVectorTile(a));
      expect(await second).toEqual(decodeVectorTile(b));
      expect(await compute.decode(a)).toEqual(decodeVectorTile(a));
      expect(frames).toHaveBeenCalled();
    } finally {
      compute.dispose();
    }
  },
);

it("rejects a malformed tile without disabling the worker for the next request", async () => {
  const worker = new WorkerStub(),
    compute = new VectorTileCompute({ createWorker: () => worker as unknown as Worker });
  try {
    const pending = compute.decode(input()),
      rejected = expect(pending).rejects.toThrow("invalid PBF");
    worker.dispatchEvent(new MessageEvent("message", { data: { id: 1, error: "invalid PBF" } }));
    await rejected;
    const good = input("pavement"),
      next = compute.decode(good);
    worker.reply(1);
    expect(await next).toEqual(decodeVectorTile(good));
    expect(worker.terminate).not.toHaveBeenCalled();
  } finally {
    compute.dispose();
  }
});

it("does not time out a received reply while its restoration is waiting for a frame", async () => {
  clock();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return 1;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const worker = new WorkerStub(),
    compute = new VectorTileCompute({ createWorker: () => worker as unknown as Worker, timeoutMs: 10 });
  try {
    const a = input(),
      b = input("pavement"),
      first = compute.decode(a),
      second = compute.decode(b);
    worker.reply(0);
    worker.reply(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(worker.terminate).not.toHaveBeenCalled();
    let finished = false;
    const all = Promise.all([first, second]).then((result) => {
      finished = true;
      return result;
    });
    for (let i = 0; i < 200; i++) {
      const isFinished = finished;
      if (isFinished) break;
      callbacks.shift()?.(performance.now());
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(await all).toEqual([decodeVectorTile(a), decodeVectorTile(b)]);
  } finally {
    compute.dispose();
  }
});

it("rejects queued and restoring work on disposal and ignores late replies", async () => {
  clock();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return 1;
  });
  const worker = new WorkerStub(),
    compute = new VectorTileCompute({ createWorker: () => worker as unknown as Worker });
  const first = compute.decode(input()),
    second = compute.decode(input("pavement"));
  const rejected = Promise.all([
    expect(first).rejects.toThrow("disposed"),
    expect(second).rejects.toThrow("disposed"),
  ]);
  worker.reply(0);
  worker.reply(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(callbacks).not.toHaveLength(0);
  compute.dispose();
  worker.reply(0);
  callbacks.shift()?.(performance.now());
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
  await expect(compute.decode(input())).rejects.toThrow("disposed");
});

it("shares the fallback budget across small tiles rather than resetting it for each request", async () => {
  const frames = clock(0.01),
    compute = new VectorTileCompute();
  compute.inline = true;
  try {
    const tile = input();
    const results = await Promise.all(Array.from({ length: 100 }, () => compute.decode(tile)));
    expect(results.every((result) => result.source === "gsi")).toBe(true);
    expect(frames).toHaveBeenCalled();
  } finally {
    compute.dispose();
  }
});
