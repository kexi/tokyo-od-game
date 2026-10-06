import type RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import type { AppliedRegulations } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { TrafficControl } from "../src/world/trafficControl";

const frame = new LocalFrame(35.68, 139.76, 40);
const point = (x: number, z: number) => [139.76 + x / 90500, 35.68 - z / 110950];
const road = (x: number, z: number, tx: number, tz: number): RoadLine => ({
  coords: [...point(x, z), ...point(tx, tz)],
  width: 9,
  oneway: 0,
  kind: "local",
});
const crossing = (x = 0) => [
  road(x, -100, x, 0),
  road(x, 0, x, 100),
  road(x - 100, 0, x, 0),
  road(x, 0, x + 100, 0),
];
const controlFor = (graph: RoadGraph, signals: Vector3[]) => {
  const control = new TrafficControl(new Scene(), () => 0, {} as RAPIER.World);
  const regs = { signals, stopLines: [], stopSigns: [] } as unknown as AppliedRegulations;
  control.setNetwork(graph, regs);
  return control;
};

describe("signal matching at the edge of the road graph", () => {
  it.each([
    [24.999, 0, 4],
    [25, 0, 0],
    [-25, 0, 0],
    [24, 24, 0],
    [5000, 0, 0],
  ])("keeps the strict 25 m snap distance at (%s, %s)", (x, z, count) => {
    const graph = new RoadGraph(crossing(), frame);
    const [node, ids] = [...graph.nodes].find(([, entries]) => entries.length === 4)!;
    const seg = graph.segments[ids[0]];
    const origin = seg.from === node ? seg.pts[0] : seg.pts.at(-1)!;
    const signal = origin.clone().add(new Vector3(x, 0, z));
    const control = controlFor(graph, [signal]);
    expect(control.approaches).toHaveLength(count);
    expect(
      control.approaches.every((ap) => ap.kind === "signal" && ap.seg === graph.segments[ap.seg.id]),
    ).toBe(true);
  });

  it("keeps the first junction when two junctions are equally close", () => {
    const graph = new RoadGraph([...crossing(-20), ...crossing(20)], frame);
    const junctions = [...graph.nodes].filter(([, ids]) => ids.length === 4);
    expect(junctions).toHaveLength(2);
    for (const [i, [node, ids]] of junctions.entries()) {
      for (const id of ids) {
        const seg = graph.segments[id];
        const at = seg.from === node ? 0 : seg.pts.length - 1;
        seg.pts[at].set(i === 0 ? -20 : 20, 0, 0);
      }
    }
    const control = controlFor(graph, [new Vector3(0, 0, 0)]);
    expect(control.approaches).toHaveLength(4);
    expect(control.approaches.every((ap) => ap.controller?.id === junctions[0][0])).toBe(true);
  });

  it("still installs a stop sign when the graph has no junctions", () => {
    const graph = new RoadGraph([road(0, 0, 0, 100)], frame);
    const seg = graph.segments[0],
      pos = graph.sample(seg, 20).pos;
    const line = { seg, dir: 1 as const, at: 20, pos };
    const control = new TrafficControl(new Scene(), () => 0, {} as RAPIER.World);
    control.setNetwork(graph, {
      signals: [new Vector3(0, 0, 0)],
      stopLines: [line],
      stopSigns: [{ line, pos }],
    } as unknown as AppliedRegulations);
    expect(control.signalCount()).toBe(0);
    expect(control.approaches).toHaveLength(1);
    expect(control.approaches[0]).toMatchObject({ seg, dir: 1, at: 20, kind: "stop", controller: null });
  });
});
