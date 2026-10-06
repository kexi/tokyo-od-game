import { afterEach, describe, expect, it, vi } from "vitest";
import { FrameWork } from "../src/game/frameWork";
import { SerialWork } from "../src/game/serialWork";

afterEach(() => vi.restoreAllMocks());

describe("world work between frames", () => {
  it("pauses at the CPU budget, resumes on a frame and excludes waiting from CPU time", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let resume = () => {};
    const nextFrame = vi.fn(
      () =>
        new Promise<void>((r) => {
          resume = r;
        }),
    );
    const work = new FrameWork(4, nextFrame);
    let completed = 0;
    function* steps(): Generator<void, number> {
      for (let i = 0; i < 3; i++) {
        now += 2;
        completed++;
        yield;
      }
      return completed;
    }
    const pending = work.run(steps());
    await Promise.resolve();
    expect(completed).toBe(2);
    expect(nextFrame).toHaveBeenCalledOnce();
    now += 500;
    resume();
    expect(await pending).toBe(3);
    expect(work.cpuMs).toBe(6);
    expect(work.maxSliceMs).toBe(4);
  });

  it("gives drawing a turn after publishing a mesh even when the CPU budget remains", async () => {
    const order: string[] = [];
    const work = new FrameWork(1000, async () => {
      order.push("frame");
    });
    function* steps(): Generator<boolean> {
      order.push("mesh 1");
      yield true;
      order.push("mesh 2");
      yield true;
    }
    await work.run(steps());
    expect(order).toEqual(["mesh 1", "frame", "mesh 2", "frame"]);
  });

  it("finishes asynchronous preparation before publishing a frame or continuing the generator", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const work = new FrameWork(
      4,
      async () => {
        order.push("frame");
      },
      async () => {
        order.push("prepare");
        await held;
        order.push("ready");
      },
    );
    function* steps(): Generator<boolean> {
      now += 2;
      order.push("mesh");
      yield true;
      now += 1;
      order.push("continue");
    }
    const pending = work.run(steps());
    expect(order).toEqual(["mesh", "prepare"]);
    now += 500;
    release();
    await pending;
    expect(order).toEqual(["mesh", "prepare", "ready", "frame", "continue"]);
    expect(work.cpuMs).toBe(3);
    expect(work.maxSliceMs).toBe(2);
  });

  it("serializes yielding installs and frame changes, and recovers after an install rejects", async () => {
    const queue = new SerialWork();
    const order: string[] = [];
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const first = queue.run(async () => {
      order.push("old frame start");
      await held;
      order.push("old frame finish");
      throw new Error("install failed");
    });
    const rejection = expect(first).rejects.toThrow("install failed");
    const second = queue.run(async () => {
      order.push("new frame");
      return 42;
    });
    await Promise.resolve();
    expect(order).toEqual(["old frame start"]);
    release();
    await rejection;
    expect(await second).toBe(42);
    expect(order).toEqual(["old frame start", "old frame finish", "new frame"]);
  });
});
