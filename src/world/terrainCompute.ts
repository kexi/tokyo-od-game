import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import { log, newSpan, warn, type Span } from "../log";
import { terrainSteps, type TerrainData, type TerrainInput } from "./terrainData";

export type TerrainRequest = { id: number; input: TerrainInput };
export type TerrainReply =
  | { id: number; data: TerrainData; computeMs: number }
  | { id: number; error: string };
type Job = {
  request: TerrainRequest;
  key: string;
  span: Span;
  started: number;
  prepareMs: number;
  sendMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(data: TerrainData): void;
  reject(error: unknown): void;
};

/** Only copied DEM arrays cross the Worker boundary; driving still reads the store's originals. */
export class TerrainCompute {
  private worker: Worker | null = null;
  private failed = false;
  private disposed = false;
  private serial = 0;
  private readonly jobs = new Map<number, Job>();
  private readonly fallback = new SerialWork();
  private readonly fallbackJobs = new Set<Job>();

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" }),
  ) {}

  prepare(input: TerrainInput, key: string): Promise<TerrainData> {
    if (this.disposed) return Promise.reject(new Error("Terrain preparation disposed"));
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const job: Job = {
        request: { id: ++this.serial, input },
        key,
        span: newSpan("terrain"),
        started,
        prepareMs: 0,
        sendMs: 0,
        resolve,
        reject,
        timer: setTimeout(() => this.fail("Terrain worker timed out"), 30000),
      };
      this.jobs.set(job.request.id, job);
      try {
        const worker = this.ready();
        job.prepareMs = performance.now() - started;
        const isInline = !worker;
        if (isInline) {
          this.runFallback(job);
          return;
        }
        const sendStarted = performance.now();
        try {
          const tiles = input.tiles.map((tile) => tile.slice());
          worker.postMessage(
            { id: job.request.id, input: { ...input, tiles } } satisfies TerrainRequest,
            tiles.map((tile) => tile.buffer),
          );
        } finally {
          job.sendMs = performance.now() - sendStarted;
        }
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
    worker.addEventListener("message", (event: MessageEvent<TerrainReply>) => {
      const reply = event.data,
        job = this.jobs.get(reply.id);
      const isUnknown = !job;
      if (isUnknown) return;
      const hasError = "error" in reply;
      if (hasError) {
        this.fail(reply.error);
        return;
      }
      this.finish(job, reply.data, "worker", reply.computeMs, 0, 0);
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.fail(event.message);
    });
    worker.addEventListener("messageerror", () => this.fail("Terrain worker reply could not be decoded"));
    return worker;
  }

  private finish(
    job: Job,
    data: TerrainData,
    backend: "worker" | "inline",
    computeMs: number,
    maxSliceMs: number,
    yields: number,
  ): void {
    if (this.disposed) return;
    clearTimeout(job.timer);
    this.jobs.delete(job.request.id);
    log(
      "terrain_chunk_prepared",
      {
        key: job.key,
        backend,
        vertices: (job.request.input.segments + 1) ** 2,
        computeMs,
        prepareMs: job.prepareMs,
        sendMs: job.sendMs,
        mainMs: job.prepareMs + job.sendMs + (backend === "inline" ? computeMs : 0),
        durationMs: performance.now() - job.started,
        maxSliceMs,
        yields,
      },
      job.span,
    );
    job.resolve(data);
  }

  private fail(error: string): void {
    if (this.failed) return;
    this.failed = true;
    warn("terrain_worker_failed", { error }, this.jobs.values().next().value?.span);
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) this.runFallback(job);
  }

  private runFallback(job: Job): void {
    clearTimeout(job.timer);
    this.jobs.delete(job.request.id);
    this.fallbackJobs.add(job);
    void this.fallback.run(async () => {
      try {
        if (this.disposed) return;
        const work = new FrameWork();
        const data = await work.run(this.fallbackSteps(job));
        // A batch of short tiles must not accumulate in one microtask turn between renders.
        await work.yield();
        this.finish(job, data, "inline", work.cpuMs, work.maxSliceMs, work.yields);
      } catch (error) {
        job.reject(error);
      } finally {
        this.fallbackJobs.delete(job);
      }
    });
  }

  private *fallbackSteps(job: Job): Generator<void, TerrainData> {
    const steps = terrainSteps(job.request.input);
    for (;;) {
      if (this.disposed) throw new Error("Terrain preparation disposed");
      const result = steps.next();
      if (result.done) return result.value;
      yield;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const job of [...this.jobs.values(), ...this.fallbackJobs]) {
      clearTimeout(job.timer);
      job.reject(new Error("Terrain preparation disposed"));
    }
    this.jobs.clear();
    this.fallbackJobs.clear();
  }
}
