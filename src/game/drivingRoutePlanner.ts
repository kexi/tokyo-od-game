import type { Vector3 } from "three";
import { log, newSpan, warn, type Span } from "../log";
import type { RoadGraph } from "../world/roads";
import type { Route } from "./navigation";
import type { RouteStart, RouteWorld } from "./drivingRoute";
import {
  computeDrivingRoute,
  drivingRouteInput,
  restoreDrivingRoute,
  type DrivingRouteData,
  type DrivingRouteInput,
  type DrivingRouteReply,
} from "./drivingRouteData";

type Job = {
  id: number;
  owner: object;
  input: DrivingRouteInput;
  graph: RoadGraph;
  span: Span;
  start: number;
  prepareMs: number;
  sendMs: number;
  stale: boolean;
  resolve(route: Route | null): void;
  reject(error: unknown): void;
};

/** One active computation; each car keeps only its latest queued request. */
export class DrivingRoutePlanner {
  inline = false;
  private worker: Worker | null = null;
  private failed = false;
  private disposed = false;
  private serial = 0;
  private active: Job | null = null;
  private readonly queued = new Map<object, Job>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: { createWorker?: () => Worker; timeoutMs?: number } = {}) {}

  warm(): void {
    this.ready();
  }

  plan(
    owner: object,
    world: RouteWorld,
    position: Vector3,
    yaw: number,
    target: Vector3,
    from?: RouteStart,
    span = newSpan("route"),
  ): Promise<Route | null> {
    const isDisposed = this.disposed;
    if (isDisposed) return Promise.reject(new Error("driving route planner disposed"));
    this.cancel(owner);
    const start = performance.now();
    const input = drivingRouteInput(world, position, yaw, target, from);
    const prepareMs = performance.now() - start;
    return new Promise((resolve, reject) => {
      this.queued.set(owner, {
        id: ++this.serial,
        owner,
        input,
        graph: world.graph,
        span,
        start,
        prepareMs,
        sendMs: 0,
        stale: false,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  cancel(owner: object): void {
    const ownsActive = this.active?.owner === owner;
    if (ownsActive) {
      this.active!.stale = true;
      this.active!.resolve(null);
    }
    this.queued.get(owner)?.resolve(null);
    this.queued.delete(owner);
  }

  dispose(): void {
    this.disposed = true;
    this.active?.resolve(null);
    for (const job of this.queued.values()) job.resolve(null);
    this.queued.clear();
    this.active = null;
    this.stopWorker();
  }

  private ready(): Worker | null {
    const isDisabled = this.inline || this.failed || this.disposed;
    if (isDisabled) return null;
    const hasWorker = this.worker !== null;
    if (hasWorker) return this.worker;
    try {
      const worker = this.options.createWorker
        ? this.options.createWorker()
        : new Worker(new URL("./drivingRoute.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<DrivingRouteReply>) => {
        const job = this.active;
        const isCurrent = job !== null && event.data.id === job.id;
        if (!isCurrent) return;
        const hasError = "error" in event.data;
        if (hasError) {
          this.fail(event.data.error);
          return;
        }
        this.finish(job, event.data.data, "worker");
      });
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        this.fail(event.message);
      });
      worker.addEventListener("messageerror", () => this.fail("route worker reply could not be decoded"));
      this.worker = worker;
      return worker;
    } catch (error) {
      this.failed = true;
      warn("route_worker_failed", { error: String(error) });
      return null;
    }
  }

  private pump(): void {
    const isBusy = this.active !== null || this.disposed || this.queued.size === 0;
    if (isBusy) return;
    const job = this.queued.values().next().value!;
    this.queued.delete(job.owner);
    this.active = job;
    const worker = this.ready();
    const hasWorker = worker !== null;
    if (!hasWorker) {
      this.runInline(job);
      return;
    }
    try {
      this.timer = setTimeout(() => this.fail("route worker timed out"), this.options.timeoutMs ?? 15000);
      const start = performance.now();
      // The page still uses the snapshot, so the transfer list is empty.
      worker.postMessage({ id: job.id, input: job.input }, []);
      job.sendMs = performance.now() - start;
    } catch (error) {
      this.fail(String(error));
    }
  }

  private runInline(job: Job): void {
    queueMicrotask(() => {
      const isCancelled = job.stale || this.disposed;
      if (isCancelled) {
        this.complete(job);
        return;
      }
      try {
        this.finish(job, computeDrivingRoute(job.input), "inline");
      } catch (error) {
        job.reject(error);
        this.complete(job);
      }
    });
  }

  private finish(job: Job, data: DrivingRouteData, backend: "worker" | "inline"): void {
    try {
      const isCancelled = job.stale || this.disposed;
      if (isCancelled) return;
      const start = performance.now();
      const route = restoreDrivingRoute(data.route, job.graph);
      const restoreMs = performance.now() - start;
      const isWorker = backend === "worker";
      if (isWorker) for (const fields of data.diagnostics) log("route_lane_blocked", fields, job.span);
      log(
        "route_plan_prepared",
        {
          backend,
          segments: job.graph.segments.length,
          found: route !== null,
          computeMs: data.computeMs,
          prepareMs: job.prepareMs,
          restoreMs,
          sendMs: job.sendMs,
          durationMs: performance.now() - job.start,
        },
        job.span,
      );
      job.resolve(route);
    } catch (error) {
      job.reject(error);
    } finally {
      this.complete(job);
    }
  }

  private complete(job: Job): void {
    const isCurrent = this.active === job;
    if (!isCurrent) return;
    const hasTimer = this.timer !== null;
    if (hasTimer) clearTimeout(this.timer!);
    this.timer = null;
    this.active = null;
    this.pump();
  }

  private fail(error: string): void {
    const isStopped = this.failed || this.disposed;
    if (isStopped) return;
    this.failed = true;
    warn("route_worker_failed", { error }, this.active?.span);
    this.stopWorker();
    const job = this.active;
    const hasJob = job !== null;
    if (hasJob) this.runInline(job);
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    const hasTimer = this.timer !== null;
    if (hasTimer) clearTimeout(this.timer!);
    this.timer = null;
  }
}
