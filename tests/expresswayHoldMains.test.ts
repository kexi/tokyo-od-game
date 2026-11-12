import { describe, expect, it } from "vitest";
import { planNetwork, solvePlan } from "../src/expressway/compile";
import type { XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { surfaceAt } from "../src/expressway/profile";

// S6 PR 6 (`--hold-mains on`): a short ramp from the ground joins a main line on a viaduct. Short of
// reaching it at its first steps, the joint solve bends the main line down to meet it; held, the main
// line off its own line near the junction counts as the ramp's miss, so the ramp's step is chosen
// with the main line in view. A ramp too short to reach even at its last step: as before.

const P = planeAt(139.75, 35.65);
/** A main line on a viaduct x 0–2000 and a ramp `len` m long from the ground that joins it at x 1000. */
function net(len: number | null): Network {
  const n: Network = { ways: new Map(), nodes: new Map() };
  const node = (id: number, x: number, y: number) => {
    const [lon, lat] = P.toLonLat(x, y);
    n.nodes.set(id, normalizeNode(id, lon, lat, {}));
    return id;
  };
  const main: number[] = [];
  for (let x = 0; x <= 2000; x += 50) main.push(node(1000 + x / 50, x, 0));
  const viaduct = {
    highway: "motorway",
    bridge: "yes",
    layer: "1",
    lanes: "2",
    maxspeed: "60",
    oneway: "yes",
  };
  n.ways.set(1, normalizeWay(1, main, viaduct));
  if (len === null) return n;
  const ramp: number[] = [];
  for (let k = 0; k <= 6; k++)
    ramp.push(k === 6 ? 1000 + 1000 / 50 : node(2000 + k, 1000 - len + (len * k) / 6, -20 + (20 * k) / 6));
  n.ways.set(
    2,
    normalizeWay(2, ramp, {
      highway: "motorway_link",
      bridge: "yes",
      layer: "1",
      oneway: "yes",
      maxspeed: "40",
    }),
  );
  return n;
}
const ground = () => 3;
const zAt = (chunks: XwChunk[], run: string, s: number) => {
  const c = chunks.find((k) => k.run === run && s >= k.st[0] && s <= k.st[k.st.length - 7])!;
  return surfaceAt(c.st, s).z;
};
const solve = (len: number | null, holdMains?: "off" | "on") =>
  solvePlan(
    planNetwork(net(len), new Set(), null, [], { structures: "height", ...(holdMains ? { holdMains } : {}) }),
    ground,
    [],
  );
const alone = solve(null).chunks;
/** The main line's mean distance off its own line (solved alone) from 700 to 1300 m. */
const offOwn = (chunks: XwChunk[]) => {
  let sum = 0;
  let n = 0;
  for (let s = 700; s <= 1300; s += 10) {
    sum += Math.abs(zAt(chunks, "1", s) - zAt(alone, "1", s));
    n++;
  }
  return sum / n;
};

describe("分合流で本線が譲らない（S6 PR 6、--hold-mains）", () => {
  it("off is the same as no option", () => {
    expect(solve(160, "off").chunks).toEqual(solve(160).chunks);
  });

  it("on, the main line stays nearer its own line where a ramp that can reach joins it", () => {
    for (const [len, by] of [
      [120, 0],
      [160, 0.2],
    ]) {
      const off = offOwn(solve(len, "off").chunks);
      const on = offOwn(solve(len, "on").chunks);
      expect(on, `len ${len}`).toBeLessThan(off - by);
      expect(solve(len, "on").closed).toEqual([]);
    }
  });

  it("a ramp too short to reach even at its last step: the main line gives way as before", () => {
    const off = solve(80, "off");
    const on = solve(80, "on");
    expect(on.chunks).toEqual(off.chunks);
    expect(on.runs.find((r) => r.id === "2")!.steps).toEqual(off.runs.find((r) => r.id === "2")!.steps);
  });

  it("is refused with blocks (a block's main line is cut at anchors)", () => {
    expect(() =>
      planNetwork(net(160), new Set(), null, [], { holdMains: "on", partition: "blocks" }),
    ).toThrow(/hold-mains needs partition: components/);
  });
});
