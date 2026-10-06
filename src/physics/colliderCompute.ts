import { log, newSpan, warn, type Span } from "../log";
import type { ColliderMesh, ColliderSnapshot, PreparedCollider } from "./colliderSnapshot";

export type ColliderRequest = { id: number; mesh: ColliderMesh };
export type ColliderReply =
  | { id: number; snapshot: ColliderSnapshot; computeMs: number }
  | { id: number; error: string };
type Job = {
  id: number;
  mesh: ColliderMesh;
  key: string;
  span: Span;
  started: number;
  sendMs: number;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort(): void;
  resolve(data: PreparedCollider): void;
  reject(error: unknown): void;
};

/** Transfer copies: the target collider and an unavailable-Worker fallback keep the original arrays. */
export class ColliderCompute {
  private worker: Worker | null = null;
  private failed = false;
  private disposed = false;
  private serial = 0;
  private readonly jobs = new Map<number, Job>();

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./collider.worker.ts", import.meta.url), { type: "module" }),
  ) {}

  prepare(mesh: ColliderMesh, key: string, signal?: AbortSignal): Promise<PreparedCollider> {
    const isUnavailable = this.disposed || signal?.aborted;
    if (isUnavailable) return Promise.reject(new Error("Collider preparation cancelled"));
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.serial,
        mesh,
        key,
        span: newSpan("collider"),
        started: performance.now(),
        sendMs: 0,
        timer: setTimeout(() => this.fail("Collider worker timed out"), 30000),
        signal,
        abort: () => {
          this.remove(job);
          reject(new Error("Collider preparation cancelled"));
        },
        resolve,
        reject,
      };
      this.jobs.set(job.id, job);
      signal?.addEventListener("abort", job.abort, { once: true });
      try {
        const worker = this.ready();
        const isInline = !worker;
        if (isInline) {
          this.finish(job, null, 0);
          return;
        }
        const start = performance.now();
        try {
          const vertices = mesh.vertices.slice(),
            indices = mesh.indices.slice();
          worker.postMessage({ id: job.id, mesh: { ...mesh, vertices, indices } } satisfies ColliderRequest, [
            vertices.buffer,
            indices.buffer,
          ]);
        } finally {
          job.sendMs = performance.now() - start;
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
    worker.addEventListener("message", (event: MessageEvent<ColliderReply>) => {
      const reply = event.data,
        job = this.jobs.get(reply.id);
      const isUnknown = !job;
      if (isUnknown) return;
      const hasError = "error" in reply;
      if (hasError) {
        this.fail(reply.error);
        return;
      }
      this.finish(job, reply.snapshot, reply.computeMs);
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.fail(event.message);
    });
    worker.addEventListener("messageerror", () => this.fail("Collider worker reply could not be decoded"));
    return worker;
  }

  private finish(job: Job, snapshot: ColliderSnapshot | null, computeMs: number): void {
    this.remove(job);
    log(
      "collider_shape_prepared",
      {
        key: job.key,
        backend: snapshot ? "worker" : "inline",
        vertices: job.mesh.vertices.length / 3,
        triangles: job.mesh.indices.length / 3,
        bytes: snapshot?.bytes.byteLength ?? 0,
        computeMs,
        sendMs: job.sendMs,
        durationMs: performance.now() - job.started,
      },
      job.span,
    );
    job.resolve({ mesh: job.mesh, snapshot });
  }

  private remove(job: Job): void {
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.abort);
    this.jobs.delete(job.id);
  }

  private fail(error: string): void {
    if (this.failed) return;
    this.failed = true;
    warn("collider_worker_failed", { error }, this.jobs.values().next().value?.span);
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) this.finish(job, null, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) job.abort();
  }
}
