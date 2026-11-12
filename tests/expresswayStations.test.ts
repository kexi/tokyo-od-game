import { describe, expect, it } from "vitest";
import { checkChunkJoin, checkSurface } from "../src/expressway/checks";
import {
  type GroundSampler,
  MIN_STATION_GAP_M,
  OBJECTIVE_V1,
  OBJECTIVE_V2,
  type Objective,
  planNetwork,
  solvePlan,
  STATION_DIGITS,
  stationDigitsFor,
  stationPositions,
} from "../src/expressway/compile";
import { STATION_STRIDE, ST, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";

// P2.7-5 4.2: the surface between two written stations is the Hermite of their rounded z and grade;
// over a short interval at the grade limit the rounding alone took it past the statute (5.01 % on a
// 5 % section). These cases broke checkSurface before the station rules (found by a scan of lengths
// and climb starts; the code before P2.7-5 writes 5.01 % on 10:1, 10:2 or 10:3 of each).
const plane = planeAt(139.75, 35.65);
const viaduct = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };

function straight(length: number): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  const n = Math.round(length / 50);
  const ids = Array.from({ length: n + 1 }, (_, i) => 1000 + i);
  net.ways.set(10, normalizeWay(10, ids, viaduct));
  ids.forEach((id, i) => {
    const [lon, lat] = plane.toLonLat((length * i) / n, 0);
    net.nodes.set(id, normalizeNode(id, lon, lat, {}));
  });
  return net;
}

/** Flat, then a 6 % climb of 700 m from x0 (steeper than the 5 % limit: the deck climbs at it), then flat. */
const climbFrom =
  (x0: number): GroundSampler =>
  (lon, lat) => {
    const x = plane.toXY(lon, lat)[0];
    return x < x0 ? 3 : x < x0 + 700 ? 3 + 0.06 * (x - x0) : 45;
  };

function chunksOf(x0: number, objective: Objective): XwChunk[] {
  const r = solvePlan(planNetwork(straight(2100), new Set(), null), climbFrom(x0), [], { objective });
  return r.chunks.filter((c) => c.run === "10").sort((a, b) => a.k - b.k);
}

const stationsOf = (c: XwChunk) =>
  Array.from({ length: c.st.length / STATION_STRIDE }, (_, i) =>
    c.st.slice(i * STATION_STRIDE, (i + 1) * STATION_STRIDE),
  );

describe("測点の間隔と書き出しの桁（P2.7-5 4.2）", () => {
  for (const [x0, objective] of [
    [400, OBJECTIVE_V1],
    [450, OBJECTIVE_V1],
    [600, OBJECTIVE_V1],
    [450, OBJECTIVE_V2],
  ] as const) {
    it(`a deck climbing at the limit (climb from ${x0} m, ${objective.kind}) keeps its surface within 第20条 between stations`, () => {
      const chunks = chunksOf(x0, objective);
      // The case is the edge: some station stands at GRADE_MARGIN × 5 %.
      const steepest = Math.max(...chunks.flatMap((c) => stationsOf(c).map((p) => Math.abs(p[ST.grade]))));
      expect(steepest).toBeGreaterThan(0.0497);
      expect(chunks.flatMap((c) => checkSurface(c))).toEqual([]);
    });

    it(`its chunks still meet exactly at the seams (T3, climb from ${x0} m, ${objective.kind})`, () => {
      const chunks = chunksOf(x0, objective);
      for (let k = 1; k < chunks.length; k++) {
        expect(checkChunkJoin(chunks[k - 1], chunks[k])).toEqual([]);
        expect(chunks[k].st.slice(0, STATION_STRIDE)).toEqual(chunks[k - 1].st.slice(-STATION_STRIDE));
      }
    });
  }

  it("leaves out a plan station closer than MIN_STATION_GAP_M to a knot or an end, and never a knot or an end", () => {
    expect(MIN_STATION_GAP_M).toBe(3);
    const plan = [0, 2, 20, 40, 47, 60, 80, 98, 100];
    const knots = [44.5, 81.5];
    const out = stationPositions(plan, knots, 0, 100);
    for (const kept of [0, 100, ...knots]) expect(out).toContain(kept);
    // 2 and 98 crowd the ends; 47 crowds the knot at 44.5 (2.5 m); 80 moved onto 81.5 (KNOT_SNAP_M).
    expect(out).toEqual([0, 20, 40, 44.5, 60, 81.5, 100]);
    for (let i = 1; i < out.length; i++) {
      const isNeededPair = [0, 100, ...knots].includes(out[i]) && [0, 100, ...knots].includes(out[i - 1]);
      if (!isNeededPair) expect(out[i] - out[i - 1]).toBeGreaterThanOrEqual(MIN_STATION_GAP_M);
    }
  });

  it("writes an interval finer only when it is short and its grade near the limit", () => {
    // 45248411:23 (P2.7-3): 2.14 m at 4.975 % of 5 %, written to 1 mm and 1 cm, read 5.0125 %.
    expect(stationDigitsFor(2.14, 0.04975, 0.04975, 0.05)).toBeGreaterThan(0);
    expect(stationDigitsFor(20, 0.04975, 0.04975, 0.05)).toBe(0);
    expect(stationDigitsFor(8, 0.04975, 0.04975, 0.05)).toBe(1);
    expect(stationDigitsFor(2.14, 0.03, 0.03, 0.05)).toBe(0);
    expect(stationDigitsFor(20, 0.03, 0.03, 0.05)).toBe(0);
    // No headroom (across a knot within 0.5 m of an end): the finest.
    expect(stationDigitsFor(0.6, 0.0501, 0.05, 0.05)).toBe(STATION_DIGITS.length - 1);
    expect(STATION_DIGITS[0]).toEqual({ z: 3, atS: false });
  });

  it("the 45248411:23 interval read back at the chosen digits stays within 5 % at any rounding phase, at 1 mm and 1 cm not", () => {
    // A straight grade of 4.975 % from s 5505.6: the stations at 5505.6 and 5507.7449 (a knot), the
    // elevation's phase against the 1 mm grid swept over 1 mm.
    const g = 0.04975;
    const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
    const chunkAt = (z0: number, digits: { z: number; atS: boolean }): XwChunk => {
      // As compile.ts writes a station: s to 1 cm, z at the written s (atS) or at s itself.
      const row = (s: number) => {
        const written = round(s, 2);
        const z = z0 + g * ((digits.atS ? written : s) - 5505.6);
        return [written, 139.75, 35.65, round(z, digits.z), 0, 0, g];
      };
      return {
        st: [...row(5505.6), ...row(5507.7449), ...row(5525.6)],
        V: 60,
        gmax: 0.05,
        id: "t:0",
      } as unknown as XwChunk;
    };
    const d = STATION_DIGITS[stationDigitsFor(2.1449, g, g, 0.05)];
    const phases = Array.from({ length: 100 }, (_, i) => 31.234 + i * 1e-5);
    for (const z0 of phases) expect(checkSurface(chunkAt(z0, d)), `z0 ${z0}`).toEqual([]);
    const broken = phases.filter((z0) => checkSurface(chunkAt(z0, STATION_DIGITS[0])).length > 0);
    expect(broken.length).toBeGreaterThan(0);
  });

  it("writes every station's s to 1 cm, so a junction's parentS meets the parent's chunk end", () => {
    // s written to 2831.362 lost 4848762:33's diverge to 4848889 (expresswayRoads.ts joins within 1 mm).
    for (const [x0, objective] of [
      [400, OBJECTIVE_V1],
      [450, OBJECTIVE_V2],
    ] as const) {
      for (const c of chunksOf(x0, objective))
        for (const p of stationsOf(c)) {
          const cm = p[ST.s] * 100;
          expect(Math.abs(cm - Math.round(cm))).toBeLessThan(1e-6);
        }
    }
  });
});
