import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { applyRegulations, type RegulationData } from "../src/world/regulations";
import { gameClock } from "../src/world/ruleTime";
import { RoadNetworkBuilder } from "../src/world/roadNetworkBuilder";
import { packRoadNetwork, unpackRoadNetwork, roadNetworkTransfers } from "../src/world/roadNetworkPacket";
import {
  computeRoadNetwork,
  restoreRoadNetwork,
  type RoadNetworkRequest,
} from "../src/world/roadNetworkData";

const frame = new LocalFrame(35.68, 139.76, 40);
const lines: RoadLine[] = [
  { coords: [139.76, 35.68, 139.761, 35.68, 139.762, 35.68], width: 12, oneway: 0, kind: "local" },
  { coords: [139.761, 35.679, 139.761, 35.68, 139.761, 35.681], width: 9, oneway: 0, kind: "local" },
];
const regs: RegulationData = {
  speed: [[30, 139.76, 35.68, 139.762, 35.68]],
  speedZone: [],
  oneway: [[1, 420, 540, 0, 0, 139.762, 35.68, 139.76, 35.68]],
  crosswalk: [[139.7605, 35.67995, 139.7605, 35.68005]],
  stopLine: [[139.7608, 35.67998]],
  stopSign: [[139.7608, 35.67997]],
  sections: [],
  turns: [[139.761, 35.68, 139.7608, 35.68, 7, 1, 0, 1440, 0, 0]],
  noOvertake: [lines[0].coords],
  noLaneChange: [lines[0].coords],
  lanes: [[2, ...lines[0].coords]],
  laneArrows: [],
  turnlanes: [[139.761, 35.68, 90, "left;through|right"]],
  signals: [[139.761, 35.68]],
  junctions: [[139.761, 35.68, "交差点", "Junction"]],
  closures: [],
  footbridges: [[2, [139.7605, 35.6799, 139.7605, 35.6801], [[139.7605, 35.6801, 139.7606, 35.6801]]]],
};

describe("road network worker data", () => {
  it.each(["clone", "transfer"])("preserves rules, queries and shared references after %s", (mode) => {
    const expected = new RoadGraph(lines, frame);
    const applied = applyRegulations(expected, regs, frame);
    const source = computeRoadNetwork({ lines, regs, origin: frame.origin });
    const packet = packRoadNetwork(source);
    const data =
      mode === "transfer"
        ? unpackRoadNetwork(structuredClone(packet, { transfer: roadNetworkTransfers(packet) }))
        : structuredClone(source);
    expect(data.graph.pieces?.size).toBeGreaterThan(0);
    const actual = restoreRoadNetwork(data, frame);
    expect(actual.graph).toBeInstanceOf(RoadGraph);
    expect(actual.graph.segments).toEqual(expected.segments);
    expect(actual.graph.nodes).toEqual(expected.nodes);
    expect(actual.applied).toEqual(applied);
    expect(actual.applied!.stopLines.length).toBeGreaterThan(0);
    expect(actual.applied!.crossings.length).toBeGreaterThan(0);
    expect(actual.applied!.stopSigns[0].line).toBe(actual.applied!.stopLines[0]);
    for (const sign of actual.applied!.signs) expect(sign.seg).toBe(actual.graph.segments[sign.seg.id]);
    for (const crossing of actual.applied!.crossings)
      expect(crossing.seg).toBe(actual.graph.segments[crossing.seg.id]);
    for (const rule of actual.applied!.turnRules)
      expect(rule.approach).toBe(actual.graph.segments[rule.approach.id]);
    for (const lane of actual.applied!.laneUse) expect(lane.seg).toBe(actual.graph.segments[lane.seg.id]);
    for (const p of actual.applied!.footbridges[0].stairs[0]) expect(p).toBeInstanceOf(Vector3);
    const pos = frame.toLocal(35.68, 139.7605, 40).setY(0);
    expect(actual.graph.nearest(pos, 50)).toEqual(expected.nearest(pos, 50));
    expect(actual.graph.carriagewaysAt(pos)).toEqual(expected.carriagewaysAt(pos));
    for (const hour of [8, 12, 8]) {
      const clock = gameClock(2026, 10, 1, hour * 60);
      actual.graph.setClock(clock);
      expected.setClock(clock);
      expect(actual.graph.segments).toEqual(expected.segments);
      expect(actual.graph.exits(0, -1)).toEqual(expected.exits(0, -1));
    }
  });

  it("keeps standalone stop-sign lines and supports a network without regulations", () => {
    const data = computeRoadNetwork({ lines, regs: { ...regs, stopLine: [] }, origin: frame.origin });
    const { applied } = restoreRoadNetwork(structuredClone(data), frame);
    expect(applied!.stopLines).toHaveLength(0);
    expect(applied!.stopSigns[0].line.pos).toBeInstanceOf(Vector3);
    expect(
      restoreRoadNetwork(computeRoadNetwork({ lines, regs: null, origin: frame.origin }), frame).applied,
    ).toBeNull();
  });
});

describe("road worker transfer packet", () => {
  it("keeps every double and index order without detaching the source snapshot", () => {
    const data = computeRoadNetwork({ lines, regs, origin: frame.origin });
    data.graph.segments[0].pts[0] = [-0, Number.NaN, Number.MAX_VALUE];
    data.graph.segments[1].pts[1] = [Number.MIN_VALUE, Math.PI, -Infinity];
    data.graph.pieces = new Map([
      [
        "negative",
        [
          [3, 2],
          [0, 1],
          [3, 2],
        ],
      ],
      ["empty", []],
      ["first", [[1, 1]]],
    ]);
    const untouched = structuredClone(data);
    const packet = packRoadNetwork(data);
    const transfers = roadNetworkTransfers(packet);
    expect(transfers).toHaveLength(4);
    const received = structuredClone(packet, { transfer: transfers });
    expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    const unpacked = unpackRoadNetwork(received);
    const actual = restoreRoadNetwork(unpacked, frame);
    expect(actual).toEqual(restoreRoadNetwork(untouched, frame));
    expect(Object.is(actual.graph.segments[0].pts[0].x, -0)).toBe(true);
    expect(Number.isNaN(actual.graph.segments[0].pts[0].y)).toBe(true);
    expect([...unpacked.graph.pieces!]).toEqual([...untouched.graph.pieces!]);
    expect(data).toEqual(untouched);
  });

  it.each([null, new Map<string, Array<[number, number]>>()])(
    "preserves an empty network with pieces %s",
    (pieces) => {
      const data = computeRoadNetwork({ lines: [], regs: null, origin: frame.origin });
      data.graph.pieces = pieces;
      const packet = packRoadNetwork(data);
      const received = structuredClone(packet, { transfer: roadNetworkTransfers(packet) });
      expect(restoreRoadNetwork(unpackRoadNetwork(received), frame)).toEqual(restoreRoadNetwork(data, frame));
    },
  );
});

class WorkerStub extends EventTarget {
  readonly sent: RoadNetworkRequest[] = [];
  terminated = false;
  postMessage(request: RoadNetworkRequest): void {
    this.sent.push(structuredClone(request));
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(index: number, packed = true): void {
    const request = this.sent[index];
    const source = computeRoadNetwork(request.input);
    const packet = packRoadNetwork(source);
    const reply = packed
      ? structuredClone(
          { id: request.id, data: packet, packMs: 1 },
          { transfer: roadNetworkTransfers(packet) },
        )
      : structuredClone({ id: request.id, data: source });
    this.dispatchEvent(
      new MessageEvent("message", {
        data: reply,
      }),
    );
  }
}
const builders: RoadNetworkBuilder[] = [];
function client(options: ConstructorParameters<typeof RoadNetworkBuilder>[0] = {}) {
  const worker = new WorkerStub();
  const builder = new RoadNetworkBuilder({ createWorker: () => worker as unknown as Worker, ...options });
  builders.push(builder);
  return { worker, builder };
}
afterEach(() => {
  builders.splice(0).forEach((b) => b.dispose());
  vi.useRealTimers();
});

describe("road worker request lifetime", () => {
  it("accepts a raw snapshot reply for the inline/reference contract too", async () => {
    const { worker, builder } = client();
    const pending = builder.build(lines, regs, frame);
    worker.reply(0, false);
    expect((await pending)!.graph.segments).toHaveLength(4);
  });

  it("does not unpack a cancelled packet before starting the latest request", async () => {
    const { worker, builder } = client();
    const first = builder.build(lines, regs, frame);
    const second = builder.build(lines, regs, frame);
    const packet = packRoadNetwork(computeRoadNetwork(worker.sent[0].input));
    const points = vi.fn(() => {
      throw new Error("obsolete buffer accessed");
    });
    Object.defineProperty(packet, "points", { get: points });
    worker.dispatchEvent(new MessageEvent("message", { data: { id: worker.sent[0].id, data: packet } }));
    expect(points).not.toHaveBeenCalled();
    expect(await first).toBeNull();
    worker.reply(1);
    expect((await second)!.graph.segments).toHaveLength(4);
  });
  it("drops superseded areas and keeps only the latest queued origin", async () => {
    const { worker, builder } = client();
    const first = builder.build(lines, regs, frame);
    const second = builder.build(lines, regs, frame);
    const next = new LocalFrame(35.681, 139.762, 35);
    const third = builder.build(lines, regs, next);
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(worker.sent).toHaveLength(1);
    worker.reply(0);
    expect(worker.sent).toHaveLength(2);
    expect(worker.sent[1].input.origin).toEqual(next.origin);
    worker.reply(1);
    const result = await third;
    const expected = new RoadGraph(lines, next);
    applyRegulations(expected, regs, next);
    expect(result!.graph.segments).toEqual(expected.segments);
    expect(result!.graph.segments[0].pts[0]).toEqual(new RoadGraph(lines, next).segments[0].pts[0]);
  });

  it("invalidates pending work without accepting its late reply", async () => {
    const { worker, builder } = client();
    const pending = builder.build(lines, regs, frame);
    builder.invalidate();
    expect(await pending).toBeNull();
    worker.reply(0);
    const next = builder.build(lines, regs, frame);
    worker.reply(1);
    expect((await next)!.graph.segments).toHaveLength(4);
  });

  it.each(["messageerror", "timeout", "postMessage", "constructor"])(
    "falls back after %s failure and completes future requests",
    async (failure) => {
      vi.useFakeTimers();
      const { worker, builder } = client(
        failure === "constructor"
          ? {
              createWorker: () => {
                throw new Error("unavailable");
              },
            }
          : { timeoutMs: 100 },
      );
      if (failure === "postMessage")
        vi.spyOn(worker, "postMessage").mockImplementation(() => {
          throw new Error("clone failed");
        });
      const pending = builder.build(lines, regs, frame);
      if (failure === "messageerror") worker.dispatchEvent(new MessageEvent("messageerror"));
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(100);
      expect((await pending)!.applied!.crossings.length).toBeGreaterThan(0);
      expect((await builder.build(lines, regs, frame))!.graph).toBeInstanceOf(RoadGraph);
    },
  );

  it("settles active and queued promises on disposal", async () => {
    const { worker, builder } = client();
    const first = builder.build(lines, regs, frame);
    const second = builder.build(lines, regs, frame);
    builder.dispose();
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(worker.terminated).toBe(true);
    worker.reply(0);
    await expect(builder.build(lines, regs, frame)).rejects.toThrow("disposed");
  });

  it("falls back only for the latest origin when an obsolete worker request fails", async () => {
    const { worker, builder } = client();
    const obsolete = builder.build(lines, regs, frame);
    const next = new LocalFrame(35.681, 139.762, 35);
    const current = builder.build(lines, regs, next);
    worker.dispatchEvent(new MessageEvent("message", { data: { id: worker.sent[0].id, error: "failed" } }));
    expect(await obsolete).toBeNull();
    expect((await current)!.graph.segments[0].pts[0]).toEqual(new RoadGraph(lines, next).segments[0].pts[0]);
    expect(worker.terminated).toBe(true);
    expect(worker.sent).toHaveLength(1);
  });

  it("recovers from a worker runtime error", async () => {
    const { worker, builder } = client();
    const pending = builder.build(lines, regs, frame);
    const event = Object.assign(new Event("error", { cancelable: true }), { message: "crashed" });
    worker.dispatchEvent(event);
    expect((await pending)!.graph.segments).toHaveLength(4);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores an unmatched reply without settling the current request", async () => {
    const { worker, builder } = client();
    const pending = builder.build(lines, regs, frame);
    const resolved = vi.fn();
    void pending.then(resolved);
    worker.dispatchEvent(new MessageEvent("message", { data: { id: -1, error: "old message" } }));
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    worker.reply(0);
    expect((await pending)!.graph.segments).toHaveLength(4);
  });
});
