import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { SidewalkNetwork, type Walk } from "../src/world/sidewalks";

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const road = (x0: number, y0: number, x1: number, y1: number, width = 12): RoadLine => ({
  coords: [139.76 + x0 * LON, 35.68 + y0 * LAT, 139.76 + x1 * LON, 35.68 + y1 * LAT],
  width,
  oneway: 0,
  kind: "local",
});
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const plus = () =>
  new RoadGraph([road(0, -100, 0, 0), road(0, 0, 0, 100), road(0, 0, 100, 0), road(0, 0, -100, 0)], frame);
const noCar = { pos: new Vector3(0, 0, 1e6), speed: 0, forward: new Vector3(0, 0, 1) };

/** Walk someone until they have left the street they started on; returns every point visited. */
function walkThrough(net: SidewalkNetwork, w: Walk, id: number, steps = 400): Vector3[] {
  const pos = net.point(w.seg, w.s, w.side, w.lateral);
  const start = w.seg;
  const path: Vector3[] = [pos.clone()];
  for (let i = 0; i < steps; i++) {
    const step = net.advance(w, 1, id, noCar, pos);
    pos.copy(step.target);
    path.push(pos.clone());
    if (w.seg !== start && !w.leg) break;
  }
  return path;
}

describe("pedestrians on the pavement network", () => {
  it("walks beside the carriageway, not on it", () => {
    const graph = plus();
    const net = new SidewalkNetwork(
      graph,
      [],
      () => null,
      () => true,
    );
    const w = net.attach(at(8, -60), 1);
    expect(w?.side).toBe(-1); // east of a northbound street is its right side
    const p = net.point(w!.seg, w!.s, w!.side, w!.lateral);
    expect(Math.abs(p.x - at(0, -60).x)).toBeGreaterThan(6); // beyond the 6 m half width
  });

  it("never cuts across the junction box: every crossing spans one road at its mouth", () => {
    const graph = plus();
    const centre = at(0, 0);
    for (let id = 1; id <= 40; id++) {
      const net = new SidewalkNetwork(
        graph,
        [],
        () => null,
        () => true,
      );
      const w = net.attach(at(id % 2 ? 8 : -8, -60), id) as Walk;
      w.dir = 1; // towards the junction
      const path = walkThrough(net, w, id);
      // Points inside the junction box (both coordinates within the half widths) would mean a
      // diagonal shortcut through the middle.
      const inBox = path.filter((p) => Math.abs(p.x - centre.x) < 5 && Math.abs(p.z - centre.z) < 5);
      expect(inBox).toHaveLength(0);
    }
  });

  it("waits at the kerb while the signal holds walkers, then crosses", () => {
    const graph = plus();
    let green = false;
    const net = new SidewalkNetwork(
      graph,
      [],
      () => green,
      () => true,
    );
    let waited = 0;
    for (let id = 1; id <= 30 && waited === 0; id++) {
      const w = net.attach(at(8, -60), id) as Walk;
      w.dir = 1;
      const pos = net.point(w.seg, w.s, w.side, w.lateral);
      for (let i = 0; i < 200; i++) {
        const step = net.advance(w, 1, id, noCar, pos);
        if (step.waiting) {
          waited++;
          green = true;
        }
        pos.copy(step.target);
      }
      green = false;
    }
    expect(waited).toBeGreaterThan(0);
  });

  it("keeps to the right-hand edge, facing traffic, where the street has no pavement", () => {
    const graph = new RoadGraph([road(0, -100, 0, 100, 4)], frame);
    const net = new SidewalkNetwork(
      graph,
      [],
      () => null,
      () => true,
    );
    for (const x of [1.2, -1.2]) {
      const w = net.attach(at(x, 0), 3) as Walk;
      const heading = graph.sample(w.seg, w.s).dir.clone().multiplyScalar(w.dir);
      const right = new Vector3(-heading.z, 0, heading.x);
      const p = net.point(w.seg, w.s, w.side, w.lateral).sub(at(0, 0));
      expect(p.dot(right)).toBeGreaterThan(0.5);
    }
  });
});
