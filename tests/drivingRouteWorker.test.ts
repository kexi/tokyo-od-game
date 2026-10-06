import { Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import { DrivingRoutePlanner } from "../src/game/drivingRoutePlanner";
import { computeDrivingRoute, type DrivingRouteInput } from "../src/game/drivingRouteData";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { TrafficControl } from "../src/world/trafficControl";
import { onLogLine, type LogEntry } from "../src/log";

type Request = { id: number; input: DrivingRouteInput };
class WorkerStub extends EventTarget {
  readonly sent: Request[] = [];
  terminated = false;
  postMessage(request: Request): void {
    this.sent.push(structuredClone(request));
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(index: number): void {
    const request = this.sent[index];
    this.dispatchEvent(
      new MessageEvent("message", {
        data: structuredClone({ id: request.id, data: computeDrivingRoute(request.input) }),
      }),
    );
  }
}
const planners: DrivingRoutePlanner[] = [];
const frame = new LocalFrame(35.68, 139.76, 40);
function fixture(options: ConstructorParameters<typeof DrivingRoutePlanner>[0] = {}) {
  const worker = new WorkerStub();
  const planner = new DrivingRoutePlanner({ createWorker: () => worker as unknown as Worker, ...options });
  planners.push(planner);
  const lines: RoadLine[] = [
    { coords: [139.76, 35.68, 139.76, 35.682], kind: "local", width: 8, oneway: 0 },
    { coords: [139.76, 35.682, 139.762, 35.682], kind: "local", width: 8, oneway: 0 },
  ];
  const graph = new RoadGraph(lines, frame);
  const world: DriveWorld = {
    graph,
    planner,
    clock: gameClock(2026, 10, 1, 600),
    turnRules: [],
    obstacles: [],
    control: { nextStop: () => null, state: () => "green" } as unknown as TrafficControl,
  };
  const position = graph.sample(graph.segments[0], 20).pos;
  const target = graph.sample(graph.segments[1], 100).pos;
  const driver = new AutoDriver();
  driver.place(position, Math.PI);
  const plan = (owner: object, goal = target) => planner.plan(owner, world, position, Math.PI, goal);
  return { worker, planner, world, position, target, driver, plan, lines };
}
afterEach(() => {
  planners.splice(0).forEach((planner) => planner.dispose());
  vi.useRealTimers();
});

describe("driving route request lifetime", () => {
  it("keeps the latest goal for each car without discarding another car's queued route", async () => {
    const { worker, world, plan } = fixture();
    const a = {},
      b = {};
    const first = plan(a),
      second = plan(b),
      replaced = plan(a),
      latest = plan(a);
    expect(await first).toBeNull();
    expect(await replaced).toBeNull();
    expect(worker.sent).toHaveLength(1);
    worker.reply(0);
    expect(worker.sent).toHaveLength(2);
    worker.reply(1);
    const routeB = await second;
    expect(routeB!.steps[0].seg).toBe(world.graph.segments[0]);
    expect(worker.sent).toHaveLength(3);
    worker.reply(2);
    expect((await latest)!.points[0]).toBeInstanceOf(Vector3);
  });

  it.each(["messageerror", "timeout", "postMessage", "constructor", "runtime"])(
    "finishes the current and queued cars after %s failure",
    async (failure) => {
      vi.useFakeTimers();
      const { worker, plan } = fixture(
        failure === "constructor"
          ? {
              createWorker: () => {
                throw new Error("unavailable");
              },
            }
          : { timeoutMs: 100 },
      );
      const cannotSend = failure === "postMessage";
      if (cannotSend)
        vi.spyOn(worker, "postMessage").mockImplementation(() => {
          throw new Error("clone failed");
        });
      const first = plan({}),
        second = plan({});
      const cannotDecode = failure === "messageerror";
      if (cannotDecode) worker.dispatchEvent(new MessageEvent("messageerror"));
      const timedOut = failure === "timeout";
      if (timedOut) await vi.advanceTimersByTimeAsync(100);
      const crashed = failure === "runtime";
      if (crashed)
        worker.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: "crashed" }));
      expect((await first)!.steps.length).toBeGreaterThan(0);
      expect((await second)!.points.length).toBeGreaterThan(0);
      expect((await plan({}))!.points[0]).toBeInstanceOf(Vector3);
    },
  );

  it("ignores unmatched and cancelled replies, and settles all requests on disposal", async () => {
    const { worker, planner, plan } = fixture();
    const owner = {};
    const pending = plan(owner);
    const resolved = vi.fn();
    void pending.then(resolved);
    worker.dispatchEvent(new MessageEvent("message", { data: { id: -1, error: "obsolete" } }));
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    planner.cancel(owner);
    expect(await pending).toBeNull();
    const next = plan({});
    worker.reply(0);
    expect(worker.sent).toHaveLength(2);
    const queued = plan({});
    planner.dispose();
    expect(await next).toBeNull();
    expect(await queued).toBeNull();
    expect(worker.terminated).toBe(true);
    worker.reply(1);
    await expect(plan({})).rejects.toThrow("disposed");
  });

  it("does not restore a cancelled job when its worker fails", async () => {
    const { worker, planner, plan } = fixture();
    const owner = {};
    const obsolete = plan(owner);
    planner.cancel(owner);
    const next = plan({});
    worker.dispatchEvent(new MessageEvent("message", { data: { id: worker.sent[0].id, error: "failed" } }));
    expect(await obsolete).toBeNull();
    expect((await next)!.steps.length).toBeGreaterThan(0);
    expect(worker.terminated).toBe(true);
  });
});

describe("driver waiting for a route", () => {
  it("holds the brake while waiting and applies the complete route after the reply", async () => {
    const { worker, driver, world, position, target } = fixture();
    const expected = new AutoDriver();
    expected.place(position, Math.PI);
    expect(expected.plan(world, target)).toBe(true);
    const logs: LogEntry[] = [];
    const stop = onLogLine((_line, entry) => {
      const isMetric = /route_plan_prepared|route_plan_applied/.test(entry.event);
      if (isMetric) logs.push(entry);
    });
    const pending = driver.planAsync(world, target);
    expect(driver.planning).toBe(true);
    const result = driver.update(1 / 60, world, { position, yaw: Math.PI, speed: 0 });
    expect(result).toMatchObject({
      input: { throttle: 0, brake: 1, brakeOnly: true },
      done: false,
      gaveUp: null,
    });
    worker.reply(0);
    expect(await pending).toBe(true);
    stop();
    expect(logs.map((entry) => entry.event)).toEqual(["route_plan_prepared", "route_plan_applied"]);
    expect(logs[0].spanId).toBeDefined();
    expect(logs[1].spanId).toBe(logs[0].spanId);
    expect(driver.planning).toBe(false);
    expect(driver.route).toStrictEqual(expected.route);
    expect(driver.update(1 / 60, world, { position, yaw: Math.PI, speed: 0 })).toStrictEqual(
      expected.update(1 / 60, world, { position, yaw: Math.PI, speed: 0 }),
    );
  });

  it.each(["place", "transform", "sync", "cancel"])(
    "does not apply a late route after %s",
    async (action) => {
      const { worker, driver, world, position, target } = fixture();
      const pending = driver.planAsync(world, target);
      switch (action) {
        case "place":
          driver.place(position.clone().addScalar(5), 0);
          break;
        case "transform":
          driver.transform((p) => p.addScalar(5), 0);
          break;
        case "sync":
          driver.plan(world, world.graph.sample(world.graph.segments[0], 100).pos);
          break;
        case "cancel":
          driver.cancelPlanning();
          break;
      }
      const kept = driver.route;
      worker.reply(0);
      expect(await pending).toBeNull();
      expect(driver.route).toBe(kept);
      expect(driver.planning).toBe(false);
    },
  );

  it("replaces the pending destination while preserving the latest driver's waiting state", async () => {
    const { worker, driver, world, target } = fixture();
    const first = driver.planAsync(world, target);
    const nextGoal = world.graph.sample(world.graph.segments[0], 100).pos;
    const next = driver.planAsync(world, nextGoal);
    expect(await first).toBeNull();
    expect(driver.planning).toBe(true);
    worker.reply(0);
    worker.reply(1);
    expect(await next).toBe(true);
    expect(driver.route!.points.at(-1)!.distanceTo(nextGoal)).toBeLessThan(5);
  });

  it.each(["graph", "rules"])("replans after %s changes while the worker is running", async (change) => {
    const { worker, driver, world, position, target, lines } = fixture();
    const pending = driver.planAsync(world, target);
    const latest = { ...world };
    const graphChanged = change === "graph";
    if (graphChanged) latest.graph = new RoadGraph(lines, frame);
    else latest.graph.segments[0].noLaneChange = true;
    driver.update(1 / 60, latest, { position, yaw: Math.PI, speed: 0 });
    worker.reply(0);
    await Promise.resolve();
    expect(driver.route).toBeNull();
    expect(driver.planning).toBe(true);
    expect(worker.sent).toHaveLength(2);
    worker.reply(1);
    expect(await pending).toBe(true);
    expect(driver.route!.steps[0].seg).toBe(latest.graph.segments[0]);
  });

  it("does not discard a valid reply just because fractional game time advanced", async () => {
    const { worker, driver, world, position, target } = fixture();
    const pending = driver.planAsync(world, target);
    driver.update(
      1 / 60,
      { ...world, clock: { ...world.clock, minutes: 600.01 } },
      { position, yaw: Math.PI, speed: 0 },
    );
    worker.reply(0);
    expect(await pending).toBe(true);
    expect(worker.sent).toHaveLength(1);
  });

  it.each([1, 2])("resumes planning after %i re-anchors before the first route arrives", async (count) => {
    const { worker, driver, world, position, target } = fixture();
    const obsolete = driver.planAsync(world, target);
    for (let i = 0; i < count; i++) driver.transform((p) => p, 0);
    expect(await obsolete).toBeNull();
    driver.update(1 / 60, world, { position, yaw: Math.PI, speed: 0 });
    expect(driver.planning).toBe(true);
    worker.reply(0);
    expect(worker.sent).toHaveLength(2);
    worker.reply(1);
    await Promise.resolve();
    expect(driver.planning).toBe(false);
    expect(driver.route!.steps[0].seg).toBe(world.graph.segments[0]);
  });

  it("rechecks a timed restriction that ended before the route arrived", async () => {
    const { worker, driver, world, position, target } = fixture();
    world.graph.segments[0].rules.push({ code: 51, time: { on: [[600, 610, 0]], off: [] } });
    const pending = driver.planAsync(world, target);
    driver.update(
      1 / 60,
      { ...world, clock: { ...world.clock, minutes: 610 } },
      { position, yaw: Math.PI, speed: 0 },
    );
    worker.reply(0);
    await Promise.resolve();
    expect(worker.sent).toHaveLength(2);
    expect(worker.sent[1].input.clock.minutes).toBe(610);
    worker.reply(1);
    expect(await pending).toBe(true);
  });

  it("hands back a driver whose new area has no drivable route", async () => {
    const { worker, driver, world, position, target, lines } = fixture();
    expect(driver.plan(world, target)).toBe(true);
    const graph = new RoadGraph(lines, frame);
    graph.segments.forEach((seg) => {
      seg.closed = true;
    });
    const latest = { ...world, graph };
    driver.update(1 / 60, latest, { position, yaw: Math.PI, speed: 0 });
    worker.reply(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(driver.route).toBeNull();
    expect(driver.gaveUp).toBe("blocked");
  });
});
