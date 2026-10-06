import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Matrix4, TypedArray } from "three";
import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import { log, newSpan, warn, type Span } from "../log";
import {
  buildingFacadeSteps,
  type BuildingAttribute,
  type BuildingFacadeData,
  type BuildingFacadeInput,
} from "./buildingFacadeData";

export type BuildingFacadeRequest = { id: number; input: BuildingFacadeInput };
export type BuildingFacadeReply =
  | { id: number; data: BuildingFacadeData; computeMs: number }
  | { id: number; error: string };
type Job = {
  request: BuildingFacadeRequest;
  span: Span;
  key: string;
  started: number;
  prepareMs: number;
  sendMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(data: BuildingFacadeData): void;
  reject(error: unknown): void;
};

function snapshot(attribute: BufferAttribute | InterleavedBufferAttribute): BuildingAttribute {
  const isInterleaved = "data" in attribute;
  return {
    array: isInterleaved ? attribute.data.array : attribute.array,
    itemSize: attribute.itemSize,
    normalized: attribute.normalized,
    count: attribute.count,
    stride: isInterleaved ? attribute.data.stride : attribute.itemSize,
    offset: isInterleaved ? attribute.offset : 0,
    interleaved: isInterleaved,
    halfFloat: "isFloat16BufferAttribute" in attribute && attribute.isFloat16BufferAttribute === true,
  };
}

/** The CPU geometry stays attached; only native copies of its attribute arrays are transferred. */
function transferableInput(input: BuildingFacadeInput): BuildingFacadeInput {
  const copies = new Map<TypedArray, TypedArray>();
  const copy = (value: BuildingAttribute): BuildingAttribute => {
    let array = copies.get(value.array);
    const isNewArray = !array;
    if (isNewArray) {
      array = value.array.slice() as TypedArray;
      copies.set(value.array, array);
    }
    return { ...value, array: array! };
  };
  return { ...input, position: copy(input.position), ids: input.ids ? copy(input.ids) : null };
}

export class BuildingFacadeCompute {
  private worker: Worker | null = null;
  private failed = false;
  private disposed = false;
  private serial = 0;
  private readonly jobs = new Map<number, Job>();
  private readonly fallback = new SerialWork();
  private readonly fallbackJobs = new Set<Job>();

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./buildingFacade.worker.ts", import.meta.url), { type: "module" }),
  ) {}

  prepare(geometry: BufferGeometry, matrix: Matrix4, key: string): Promise<BuildingFacadeData> {
    if (this.disposed) return Promise.reject(new Error("Building façade preparation disposed"));
    const started = performance.now();
    const position = snapshot(geometry.getAttribute("position"));
    const ids = geometry.getAttribute("_batchid") ?? geometry.getAttribute("_feature_id_0");
    const input = { position, ids: ids ? snapshot(ids) : null, matrix: matrix.elements.slice() };
    return new Promise((resolve, reject) => {
      const job: Job = {
        request: { id: ++this.serial, input },
        span: newSpan("building"),
        key,
        started,
        prepareMs: performance.now() - started,
        sendMs: 0,
        resolve,
        reject,
        timer: setTimeout(() => this.fail("Building façade worker timed out"), 30000),
      };
      this.jobs.set(job.request.id, job);
      try {
        const readyStart = performance.now();
        const worker = this.ready();
        job.prepareMs += performance.now() - readyStart;
        const isInline = !worker;
        if (isInline) {
          this.runFallback(job);
          return;
        }
        const start = performance.now();
        const transfer = transferableInput(input);
        const buffers = [
          ...new Set(
            [transfer.position.array.buffer, transfer.ids?.array.buffer].filter(
              (b): b is ArrayBuffer => b instanceof ArrayBuffer,
            ),
          ),
        ];
        // Original vertex arrays remain owned by rendering/physics and the exact failure fallback.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        worker.postMessage({ id: job.request.id, input: transfer } satisfies BuildingFacadeRequest, buffers);
        job.sendMs = performance.now() - start;
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
    worker.addEventListener("message", (event: MessageEvent<BuildingFacadeReply>) => {
      const reply = event.data;
      const job = this.jobs.get(reply.id);
      if (!job) return;
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
    worker.addEventListener("messageerror", () =>
      this.fail("Building façade worker reply could not be decoded"),
    );
    return worker;
  }

  private finish(
    job: Job,
    data: BuildingFacadeData,
    backend: "worker" | "inline",
    computeMs: number,
    maxSliceMs: number,
    yields: number,
  ): void {
    if (this.disposed) return;
    clearTimeout(job.timer);
    this.jobs.delete(job.request.id);
    log(
      "building_facade_prepared",
      {
        key: job.key,
        backend,
        vertices: job.request.input.position.count,
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
    warn("building_worker_failed", { error }, this.jobs.values().next().value?.span);
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
        this.finish(job, data, "inline", work.cpuMs, work.maxSliceMs, work.yields);
      } catch (error) {
        job.reject(error);
      } finally {
        this.fallbackJobs.delete(job);
      }
    });
  }

  private *fallbackSteps(job: Job): Generator<void, BuildingFacadeData> {
    const steps = buildingFacadeSteps(job.request.input);
    for (;;) {
      if (this.disposed) throw new Error("Building façade preparation disposed");
      const result = steps.next();
      if (result.done) return result.value;
      yield;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.failed = true;
    for (const job of [...this.jobs.values(), ...this.fallbackJobs]) {
      clearTimeout(job.timer);
      job.reject(new Error("Building façade preparation disposed"));
    }
    this.jobs.clear();
    this.fallbackJobs.clear();
  }
}
