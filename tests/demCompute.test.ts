import { afterEach, expect, it, vi } from "vitest";
import { DemCompute, type DemRequest } from "../src/world/demCompute";
import { parseDemText, smoothGround } from "../src/world/demData";

class WorkerStub extends EventTarget {
  requests: DemRequest[] = [];
  postMessage(request: DemRequest): void {
    this.requests.push(structuredClone(request));
  }
  terminate = vi.fn();
  reply(index: number): void {
    const request = this.requests[index];
    const data = request.kind === "smooth" ? smoothGround(request.data) : parseDemText(request.text);
    this.dispatchEvent(new MessageEvent("message", { data: { id: request.id, data } }));
  }
}
const source = () => Float32Array.from({ length: 256 * 256 }, (_, i) => Math.sin(i) * 20);
afterEach(() => vi.unstubAllGlobals());

it("matches concurrent replies to their tiles and retains the input for a fallback", async () => {
  const worker = new WorkerStub();
  const compute = new DemCompute(() => worker as unknown as Worker);
  const data = source();
  const ground = compute.smooth(data);
  const surveyed = compute.parse("1.5,e,0\n-3,4");
  worker.reply(1);
  expect(await surveyed).toEqual(parseDemText("1.5,e,0\n-3,4"));
  worker.reply(0);
  expect(await ground).toEqual(smoothGround(data));
  expect(data).toHaveLength(256 * 256);
  expect(data).toEqual(source());
});

it.each(["constructor", "runtime", "messageerror", "postMessage"])(
  "keeps exact elevations and yields rendering after a %s failure",
  async (failure) => {
    const frames = vi.fn((callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", frames);
    const worker = new WorkerStub();
    const compute = new DemCompute(() => {
      if (failure === "constructor") throw new Error("unavailable");
      return worker as unknown as Worker;
    });
    if (failure === "postMessage")
      vi.spyOn(worker, "postMessage").mockImplementation(() => {
        throw new Error("clone failed");
      });
    const data = source();
    const ground = compute.smooth(data);
    const surveyed = compute.parse("1,e\n2,3");
    if (failure === "runtime")
      worker.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: "crashed" }));
    if (failure === "messageerror") worker.dispatchEvent(new MessageEvent("messageerror"));
    expect(await ground).toEqual(smoothGround(data));
    expect(await surveyed).toEqual(parseDemText("1,e\n2,3"));
    expect(await compute.parse("5")).toEqual(parseDemText("5"));
    expect(frames).toHaveBeenCalled();
  },
);
