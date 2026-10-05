import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import { newSpan, warn, type Span } from "../log";
import { parseDemTextSteps, smoothGroundSteps } from "./demData";

export type DemRequest = { id: number } & (
  | { kind: "smooth"; data: Float32Array }
  | { kind: "parse"; text: string }
);
export type DemReply = { id: number; data: Float32Array } | { id: number; error: string };
type Job = {
  request: DemRequest;
  span: Span;
  timer: ReturnType<typeof setTimeout>;
  resolve(data: Float32Array): void;
  reject(error: unknown): void;
};

/** DEM filtering is independent of the local origin, so tiles can finish safely after a warp. */
export class DemCompute {
  private worker: Worker | null = null;
  private failed = false;
  private serial = 0;
  private readonly jobs = new Map<number, Job>();
  private readonly fallback = new SerialWork();

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./dem.worker.ts", import.meta.url), { type: "module" }),
  ) {}

  smooth(data: Float32Array): Promise<Float32Array> {
    return this.run({ id: ++this.serial, kind: "smooth", data });
  }

  parse(text: string): Promise<Float32Array> {
    return this.run({ id: ++this.serial, kind: "parse", text });
  }

  private run(request: DemRequest): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const job: Job = {
        request,
        resolve,
        reject,
        span: newSpan("dem"),
        timer: setTimeout(() => this.fail("DEM worker timed out"), 30000),
      };
      this.jobs.set(request.id, job);
      try {
        const worker = this.ready();
        if (!worker) {
          this.runFallback(job);
          return;
        }
        // Keep the input owned by the page for an exact fallback after a worker failure.
        // oxlint-disable-next-line unicorn(require-post-message-target-origin)
        worker.postMessage(request);
      } catch (error) {
        this.fail(String(error));
      }
    });
  }

  private ready(): Worker | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent<DemReply>) => {
      const job = this.jobs.get(event.data.id);
      if (!job) return;
      const hasError = "error" in event.data;
      if (hasError) {
        this.fail(event.data.error);
        return;
      }
      clearTimeout(job.timer);
      this.jobs.delete(event.data.id);
      job.resolve(event.data.data);
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.fail(event.message);
    });
    worker.addEventListener("messageerror", () => this.fail("DEM worker reply could not be decoded"));
    return worker;
  }

  private fail(error: string): void {
    if (this.failed) return;
    this.failed = true;
    warn("dem_worker_failed", { error }, this.jobs.values().next().value?.span);
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) this.runFallback(job);
  }

  private runFallback(job: Job): void {
    clearTimeout(job.timer);
    this.jobs.delete(job.request.id);
    void this.fallback.run(async () => {
      try {
        const request = job.request;
        const isSmooth = request.kind === "smooth";
        const steps = isSmooth ? smoothGroundSteps(request.data) : parseDemTextSteps(request.text);
        const data = await new FrameWork().run(steps);
        job.resolve(data);
      } catch (error) {
        job.reject(error);
      }
    });
  }
}
