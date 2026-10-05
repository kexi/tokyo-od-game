import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import { log, newSpan, warn, type Span } from "../log";
import type { WaterPolygon } from "./waterGeometry";
import { waterMaskSteps, type WaterMasks } from "./waterMasks";

export type WaterMaskRequest = {
  id: number;
  polygons: WaterPolygon[];
  x: number;
  y: number;
  size: number;
};
export type WaterMaskReply =
  | { id: number; masks: WaterMasks; computeMs: number }
  | { id: number; error: string };
type Job = {
  request: WaterMaskRequest;
  span: Span;
  started: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(data: WaterMasks): void;
  reject(error: unknown): void;
};

/** Tile coordinates stay global while raster computation runs independently of scene updates. */
export class WaterCompute {
  private worker: Worker | null = null;
  private failed = false;
  private disposed = false;
  private serial = 0;
  private readonly jobs = new Map<number, Job>();
  private readonly fallback = new SerialWork();
  private readonly fallbackWork = new FrameWork();

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./water.worker.ts", import.meta.url), { type: "module" }),
  ) {}

  rasterize(polygons: WaterPolygon[], x: number, y: number, size: number): Promise<WaterMasks> {
    if (this.disposed) return Promise.reject(new Error("Water compute disposed"));
    const request = { id: ++this.serial, polygons, x, y, size };
    return new Promise((resolve, reject) => {
      const job: Job = {
        request,
        resolve,
        reject,
        span: newSpan("water"),
        started: performance.now(),
        timer: setTimeout(() => this.fail("Water worker timed out"), 30000),
      };
      this.jobs.set(request.id, job);
      try {
        const worker = this.ready();
        if (!worker) {
          this.runFallback(job);
          return;
        }
        // Retain polygons for a frame-sliced retry if the worker cannot finish the request.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        worker.postMessage(request);
      } catch (error) {
        this.fail(String(error));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.reject(new Error("Water compute disposed"));
    }
    this.jobs.clear();
  }

  private ready(): Worker | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent<WaterMaskReply>) => {
      const isActive = worker === this.worker && !this.disposed;
      if (!isActive) return;
      const job = this.jobs.get(event.data.id);
      if (!job) return;
      const hasError = "error" in event.data;
      if (hasError) {
        this.fail(event.data.error);
        return;
      }
      this.finish(job, event.data.masks, event.data.computeMs, "worker");
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.fail(event.message);
    });
    worker.addEventListener("messageerror", () => this.fail("Water worker reply could not be decoded"));
    return worker;
  }

  private fail(error: string): void {
    const alreadyStopped = this.failed || this.disposed;
    if (alreadyStopped) return;
    this.failed = true;
    warn("water_worker_failed", { error }, this.jobs.values().next().value?.span);
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) this.runFallback(job);
  }

  private runFallback(job: Job): void {
    clearTimeout(job.timer);
    void this.fallback.run(async () => {
      const isPending = this.jobs.has(job.request.id);
      if (!isPending) return;
      try {
        const { polygons, x, y, size } = job.request;
        // A fresh budget per tile would let many small replies form one long microtask chain.
        const work = this.fallbackWork;
        const before = work.cpuMs;
        const masks = await work.run(this.fallbackSteps(waterMaskSteps(polygons, x, y, size)));
        this.finish(job, masks, work.cpuMs - before, "inline");
      } catch (error) {
        this.jobs.delete(job.request.id);
        job.reject(error);
      }
    });
  }

  private *fallbackSteps(steps: Generator<void, WaterMasks>): Generator<void, WaterMasks> {
    for (;;) {
      if (this.disposed) throw new Error("Water compute disposed");
      const result = steps.next();
      if (result.done) return result.value;
      yield;
    }
  }

  private finish(job: Job, masks: WaterMasks, computeMs: number, backend: "worker" | "inline"): void {
    const isPending = this.jobs.has(job.request.id);
    if (!isPending) return;
    clearTimeout(job.timer);
    this.jobs.delete(job.request.id);
    const { x, y, size } = job.request;
    log(
      "water_masks_prepared",
      {
        backend,
        x,
        y,
        size,
        computeMs,
        durationMs: performance.now() - job.started,
        bytes: masks.raster.byteLength + masks.cut.byteLength,
      },
      job.span,
    );
    job.resolve(masks);
  }
}
