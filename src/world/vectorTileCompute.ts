import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import { log, newSpan, warn, type Span } from "../log";
import {
  decodeVectorTileSteps,
  unpackVectorTileSteps,
  type DecodedVectorTile,
  type VectorTileInput,
} from "./vectorTileData";
import type { VectorTileReply, VectorTileRequest } from "./vectorTile.worker";

type Job = {
  input: VectorTileRequest;
  span: Span;
  started: number;
  prepareMs: number;
  sendMs: number;
  readMs: number;
  receiving: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve(tile: DecodedVectorTile): void;
  reject(error: unknown): void;
};

/** One decoder and one shared page budget for both GSI layers and PLATEAU pavement tiles. */
export class VectorTileCompute {
  inline = false;
  private worker: Worker | null = null;
  private failed = false;
  private disposed = false;
  private serial = 0;
  private readonly jobs = new Map<number, Job>();
  private readonly restore = new SerialWork();
  private readonly work = new FrameWork();
  constructor(private readonly options: { createWorker?: () => Worker; timeoutMs?: number } = {}) {}

  decode(input: VectorTileInput): Promise<DecodedVectorTile> {
    const isDisposed = this.disposed;
    if (isDisposed) return Promise.reject(new Error("Vector tile compute disposed"));
    return new Promise((resolve, reject) => {
      const job: Job = {
        input: { ...input, id: ++this.serial },
        span: newSpan("vector-tile"),
        started: performance.now(),
        prepareMs: 0,
        sendMs: 0,
        readMs: 0,
        receiving: false,
        resolve,
        reject,
        timer: setTimeout(() => this.fail("Vector tile worker timed out"), this.options.timeoutMs ?? 30000),
      };
      this.jobs.set(job.input.id, job);
      try {
        const worker = this.ready();
        const unavailable = worker === null;
        if (unavailable) {
          this.runFallback(job);
          return;
        }
        const prepare = performance.now();
        // Transferring the only copy would lose the exact bytes needed after a worker failure.
        const buffer = input.buffer.slice(0);
        job.prepareMs = performance.now() - prepare;
        const send = performance.now();
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        worker.postMessage({ ...job.input, buffer }, [buffer]);
        job.sendMs = performance.now() - send;
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
      job.reject(new Error("Vector tile compute disposed"));
    }
    this.jobs.clear();
  }

  private ready(): Worker | null {
    const disabled = this.inline || this.failed;
    if (disabled) return null;
    const existing = this.worker;
    if (existing) return existing;
    const worker = this.options.createWorker
      ? this.options.createWorker()
      : new Worker(new URL("./vectorTile.worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent<VectorTileReply>) => {
      const current = worker === this.worker && !this.disposed;
      if (!current) return;
      const start = performance.now(),
        reply = event.data,
        job = this.jobs.get(reply.id);
      const pending = job && !job.receiving;
      if (!pending) return;
      job.readMs = performance.now() - start;
      const isError = "error" in reply;
      if (isError) {
        clearTimeout(job.timer);
        this.jobs.delete(reply.id);
        job.reject(new Error(reply.error));
        return;
      }
      const mismatch = reply.packet.source !== job.input.source;
      if (mismatch) {
        this.fail("Vector tile response source mismatch");
        return;
      }
      job.receiving = true;
      clearTimeout(job.timer);
      void this.restore
        .run(async () => {
          const canRestore = this.jobs.has(job.input.id);
          if (!canRestore) return;
          const before = this.work.cpuMs;
          this.work.maxSliceMs = 0;
          const tile = await this.work.run(this.steps(job, unpackVectorTileSteps(reply.packet)));
          this.finish(job, tile, "worker", reply.computeMs, this.work.cpuMs - before);
        })
        .catch((error) => this.reject(job, error));
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.fail(event.message);
    });
    worker.addEventListener("messageerror", () => this.fail("Vector tile worker reply could not be decoded"));
    return worker;
  }

  private fail(error: string): void {
    const stopped = this.failed || this.disposed;
    if (stopped) return;
    this.failed = true;
    warn("vector_tile_worker_failed", { error }, this.jobs.values().next().value?.span);
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) {
      const needsFallback = !job.receiving;
      if (needsFallback) this.runFallback(job);
    }
  }

  private runFallback(job: Job): void {
    clearTimeout(job.timer);
    job.receiving = true;
    void this.restore
      .run(async () => {
        const pending = this.jobs.has(job.input.id);
        if (!pending) return;
        const before = this.work.cpuMs;
        this.work.maxSliceMs = 0;
        const tile = await this.work.run(this.steps(job, decodeVectorTileSteps(job.input)));
        this.finish(job, tile, "inline", this.work.cpuMs - before, 0);
      })
      .catch((error) => this.reject(job, error));
  }

  private finish(
    job: Job,
    tile: DecodedVectorTile,
    backend: "worker" | "inline",
    computeMs: number,
    restoreMs: number,
  ): void {
    const pending = this.jobs.has(job.input.id);
    if (!pending) return;
    this.jobs.delete(job.input.id);
    log(
      "vector_tile_prepared",
      {
        backend,
        source: job.input.source,
        z: job.input.z,
        x: job.input.x,
        y: job.input.y,
        bytes: job.input.buffer.byteLength,
        computeMs,
        prepareMs: job.prepareMs,
        sendMs: job.sendMs,
        readMs: job.readMs,
        restoreMs,
        mainMs: job.prepareMs + job.sendMs + job.readMs + (backend === "inline" ? computeMs : restoreMs),
        maxSliceMs: this.work.maxSliceMs,
        durationMs: performance.now() - job.started,
      },
      job.span,
    );
    job.resolve(tile);
  }

  private *steps<T>(job: Job, steps: Generator<void, T>): Generator<void, T> {
    for (;;) {
      const pending = this.jobs.has(job.input.id);
      if (!pending) throw new Error("Vector tile compute disposed");
      const next = steps.next();
      const done = next.done;
      if (done) return next.value;
      yield;
    }
  }

  private reject(job: Job, error: unknown): void {
    const pending = this.jobs.has(job.input.id);
    if (!pending) return;
    clearTimeout(job.timer);
    this.jobs.delete(job.input.id);
    job.reject(error);
  }
}

export const vectorTileCompute = new VectorTileCompute();
