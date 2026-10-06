import type { LocalFrame } from "../geo/frame";
import { log, newSpan, warn, type Span } from "../log";
import type { RegulationData } from "./regulations";
import type { RoadLine } from "./roads";
import { unpackRoadNetwork } from "./roadNetworkPacket";
import {
  computeRoadNetwork,
  restoreRoadNetwork,
  type RoadNetwork,
  type RoadNetworkRestorable,
  type RoadNetworkInput,
  type RoadNetworkReply,
} from "./roadNetworkData";

type Job = {
  id: number;
  input: RoadNetworkInput;
  frame: LocalFrame;
  span: Span;
  start: number;
  sendMs: number;
  stale: boolean;
  resolve(value: RoadNetwork | null): void;
  reject(error: unknown): void;
};

/** One worker, one running request, and only the most recent queued area. */
export class RoadNetworkBuilder {
  inline = false;
  private worker: Worker | null = null;
  private failed = false;
  private disposed = false;
  private active: Job | null = null;
  private queued: Job | null = null;
  private serial = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: { createWorker?: () => Worker; timeoutMs?: number } = {}) {}

  warm(): void {
    this.ready();
  }

  build(lines: RoadLine[], regs: RegulationData | null, frame: LocalFrame): Promise<RoadNetwork | null> {
    if (this.disposed) return Promise.reject(new Error("road builder disposed"));
    this.invalidate();
    return new Promise((resolve, reject) => {
      this.queued = {
        id: ++this.serial,
        input: { lines, regs, origin: frame.origin },
        frame,
        span: newSpan("roads"),
        start: performance.now(),
        sendMs: 0,
        stale: false,
        resolve,
        reject,
      };
      this.pump();
    });
  }

  /** Old work may finish, but must never replace the current frame or area. */
  invalidate(): void {
    if (this.active) {
      this.active.stale = true;
      this.active.resolve(null);
    }
    this.queued?.resolve(null);
    this.queued = null;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
    this.stopWorker();
    this.active = null;
  }

  private ready(): Worker | null {
    const isDisabled = this.inline || this.failed || this.disposed;
    if (isDisabled) return null;
    if (this.worker) return this.worker;
    try {
      const worker = this.options.createWorker
        ? this.options.createWorker()
        : new Worker(new URL("./roadNetwork.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<RoadNetworkReply>) => {
        const readStarted = performance.now();
        const reply = event.data;
        const readMs = performance.now() - readStarted;
        const job = this.active;
        const isCurrent = job && reply.id === job.id;
        if (!isCurrent) return;
        const hasError = "error" in reply;
        if (hasError) {
          this.fail(reply.error);
          return;
        }
        const isStale = job.stale || this.disposed;
        if (isStale) {
          this.complete(job);
          return;
        }
        try {
          const unpackStarted = performance.now();
          const wire = reply.data;
          const isPacket = "points" in wire;
          const data = isPacket ? unpackRoadNetwork(wire) : wire;
          const unpackMs = performance.now() - unpackStarted;
          this.finish(job, data, "worker", readMs, unpackMs, reply.packMs ?? 0);
        } catch (error) {
          job.reject(error);
          this.complete(job);
        }
      });
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        this.fail(event.message);
      });
      worker.addEventListener("messageerror", () => this.fail("worker reply could not be decoded"));
      this.worker = worker;
      return worker;
    } catch (error) {
      this.failed = true;
      warn("road_worker_failed", { error: String(error) });
      return null;
    }
  }

  private pump(): void {
    const isBusy = this.active !== null || this.queued === null || this.disposed;
    if (isBusy) return;
    const job = this.queued!;
    this.queued = null;
    this.active = job;
    const worker = this.ready();
    if (!worker) {
      this.runInline(job);
      return;
    }
    try {
      this.timer = setTimeout(() => this.fail("road worker timed out"), this.options.timeoutMs ?? 15000);
      const start = performance.now();
      // Worker messages have no Window targetOrigin argument.
      // oxlint-disable-next-line unicorn(require-post-message-target-origin)
      worker.postMessage({ id: job.id, input: job.input });
      job.sendMs = performance.now() - start;
    } catch (error) {
      this.fail(String(error));
    }
  }

  private runInline(job: Job): void {
    // A queued request can be superseded before the fallback starts too.
    queueMicrotask(() => {
      const isCancelled = job.stale || this.disposed;
      if (isCancelled) {
        this.complete(job);
        return;
      }
      try {
        this.finish(job, computeRoadNetwork(job.input), "inline");
      } catch (error) {
        job.reject(error);
        this.complete(job);
      }
    });
  }

  private finish(
    job: Job,
    data: RoadNetworkRestorable,
    backend: "worker" | "inline",
    readMs = 0,
    unpackMs = 0,
    packMs = 0,
  ): void {
    try {
      if (job.stale || this.disposed) return;
      const start = performance.now();
      const result = restoreRoadNetwork(data, job.frame);
      const restoreMs = performance.now() - start;
      // Emit on the page so worker diagnostics retain the page's trace and log sink.
      for (const diagnostic of data.diagnostics) warn(diagnostic.event, diagnostic.fields, job.span);
      log(
        "road_network_prepared",
        {
          backend,
          segments: result.graph.segments.length,
          computeMs: data.computeMs,
          restoreMs,
          sendMs: job.sendMs,
          readMs,
          unpackMs,
          packMs,
          durationMs: performance.now() - job.start,
        },
        job.span,
      );
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    } finally {
      this.complete(job);
    }
  }

  private complete(job: Job): void {
    if (this.active !== job) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    this.pump();
  }

  private fail(error: string): void {
    const isStopped = this.failed || this.disposed;
    if (isStopped) return;
    this.failed = true;
    warn("road_worker_failed", { error }, this.active?.span);
    this.stopWorker();
    const job = this.active;
    if (job) this.runInline(job);
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
