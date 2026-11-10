import { describe, expect, it } from "vitest";
import {
  COMPOSITE_GRADE,
  MAX_GRADE,
  ROAD_STANDARDS,
  TRANSITION_LENGTH,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../src/law/roadStandards";
import { ALLOWLIST, isAllowed } from "../src/expressway/allowlist";
import { ASSUMPTIONS, MAX_LATERAL_SHIFT } from "../src/expressway/assumptions";
import {
  checkChunkJoin,
  checkClearance,
  checkGrade,
  checkGroundEnd,
  checkJunction,
  checkPlan,
  checkSuperelevation,
  checkVerticalCurves,
} from "../src/expressway/checks";
import { type CrossObject, planNetwork, solvePlan } from "../src/expressway/compile";
import type { XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { deckOverlaps } from "../src/expressway/overlap";
import { alignPlan } from "../src/expressway/horizontal";
import { type Network, normalizeNode, normalizeWay, structureOf } from "../src/expressway/network";
import { superelevation, targetSuperelevation } from "../src/expressway/superelevation";
import { evalProfile, solveVertical, type VerticalInput } from "../src/expressway/vertical";

// Synthetic networks in a local plane around 芝公園; flat ground at T.P. 3 m.
const plane = planeAt(139.75, 35.65);
const GROUND = 3;
const ground = () => GROUND;

type WaySpec = { id: number; pts: Array<[number, number]>; nodeIds: number[]; tags: Record<string, string> };

function network(ways: WaySpec[]): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  for (const w of ways) {
    net.ways.set(w.id, normalizeWay(w.id, w.nodeIds, w.tags));
    w.nodeIds.forEach((id, i) => {
      const [lon, lat] = plane.toLonLat(w.pts[i][0], w.pts[i][1]);
      net.nodes.set(id, normalizeNode(id, lon, lat, {}));
    });
  }
  return net;
}

/** Points every `step` metres along a straight line. */
function line(x0: number, y0: number, x1: number, y1: number, step = 50): Array<[number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
}

const viaduct = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };

/** A 2 km viaduct going east with a ramp leaving it at x = 800 and a street under it at x = 1200. */
function mainAndRamp() {
  const main = line(0, 0, 2000, 0);
  const mainIds = main.map((_, i) => 1000 + i);
  const diverge = mainIds[16]; // x = 800
  const rampPts: Array<[number, number]> = [[800, 0], ...line(850, -8, 1150, -60).slice(0)];
  const rampIds = [diverge, ...rampPts.slice(1).map((_, i) => 2000 + i)];
  const net = network([
    { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
    {
      id: 20,
      pts: rampPts,
      nodeIds: rampIds,
      tags: { highway: "motorway_link", bridge: "yes", layer: "1", name: "首都高速 芝公園出口" },
    },
  ]);
  const street: CrossObject = {
    kind: "road",
    id: 1,
    pts: [plane.toLonLat(1200, -300), plane.toLonLat(1200, 300)],
  };
  return { net, street };
}

function compile(net: Network, objects: CrossObject[] = []) {
  const plan = planNetwork(net, new Set(), null);
  return { plan, result: solvePlan(plan, ground, objects) };
}

const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  return out;
};

describe("法令値と仮定の集約（設計書 3.4）", () => {
  it("every statute value names its article, and every assumption says it is unverified and why", () => {
    for (const [name, entry] of Object.entries(ROAD_STANDARDS)) {
      expect(entry.source, name).toMatch(/^(構造令|標識令) /);
    }
    for (const [name, entry] of Object.entries(ASSUMPTIONS)) {
      expect(entry.verified, name).toBe(false);
      expect(entry.reason.length, name).toBeGreaterThan(5);
    }
  });

  it("第25条 is read from the table's rowspans: 60 km/h is 10.5 %, 50 km/h is 11.5 %", () => {
    expect(COMPOSITE_GRADE.value[60]).toBe(0.105);
    expect(COMPOSITE_GRADE.value[50]).toBe(0.115);
  });
});

describe("入力の正規化（設計書 4.1）", () => {
  it("drops names carrying the operator and keeps entrance names, ref and destination", () => {
    const w = normalizeWay(1, [1, 2], {
      highway: "motorway",
      name: "首都高速都心環状線",
      ref: "C1",
      destination: "銀座",
    });
    expect(w.name).toBeNull();
    expect(w.ref).toBe("C1");
    expect(w.destination).toBe("銀座");
    expect(normalizeWay(2, [1, 2], { highway: "motorway_link", name: "宝町出口" }).name).toBe("宝町出口");
  });

  it("defaults lanes and speed (main 2 / 60, ramp 1 / 40) and reads the structure from bridge, tunnel, cutting and layer", () => {
    const ramp = normalizeWay(3, [1, 2], { highway: "motorway_link" });
    expect([ramp.lanes, ramp.speedKmh, ramp.cls]).toEqual([1, 40, "ramp"]);
    expect(structureOf({ bridge: "yes", layer: "2" })).toBe("viaduct");
    expect(structureOf({ tunnel: "yes", layer: "-1" })).toBe("tunnel");
    expect(structureOf({ cutting: "yes" })).toBe("cut");
    expect(structureOf({})).toBe("ground");
  });
});

describe("平面線形（設計書 4.2, T6）", () => {
  // A 600 m straight with ±0.8 m zigzag (OSM vertex wobble) and an anchor in the middle.
  const xy: Array<[number, number]> = Array.from({ length: 61 }, (_, i) => [
    i * 10,
    i % 2 === 0 ? 0.8 : -0.8,
  ]);
  const plan = alignPlan({ xy, anchors: new Set([30]) });

  it("stays within ε of the OSM line and keeps the anchor exactly on its node", () => {
    // Measured here on the arrays themselves, not taken from the aligner's own figure.
    let shift = 0;
    for (let i = 0; i < plan.xy.length; i += 2) {
      shift = Math.max(
        shift,
        Math.hypot(plan.xy[i] - plan.original[i], plan.xy[i + 1] - plan.original[i + 1]),
      );
    }
    expect(shift).toBeLessThanOrEqual(MAX_LATERAL_SHIFT.value);
    expect(plan.maxShiftM).toBeCloseTo(shift, 9);
    expect(plan.clamped).toBe(0);
    const a = plan.vertexSample[30];
    expect([plan.xy[2 * a], plan.xy[2 * a + 1]]).toEqual([300, 0.8]);
  });

  it("removes the zigzag: no curvature left that a 150 m radius would not allow, except at the anchor", () => {
    const a = plan.vertexSample[30];
    for (let i = 20; i < plan.kappa.length - 20; i++) {
      if (Math.abs(i - a) < 40) continue;
      expect(Math.abs(plan.kappa[i])).toBeLessThan(1 / 150);
    }
  });

  it("lowers the design speed where the radius on site is below 第15条 for the tagged speed", () => {
    // A 90° bend of radius 80 m: below 100 m (V50), at least 60 m (V40).
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 10; i++) pts.push([-200 + i * 20, 0]);
    for (let i = 1; i <= 20; i++) {
      const t = (i / 20) * (Math.PI / 2);
      pts.push([80 * Math.sin(t), 80 - 80 * Math.cos(t)]);
    }
    for (let i = 1; i <= 10; i++) pts.push([80, 80 + i * 20]);
    const net = network([{ id: 1, pts, nodeIds: pts.map((_, i) => 100 + i), tags: viaduct }]);
    const planned = planNetwork(net, new Set(), null);
    const run = planned.runs.get("1")!;
    expect(run.tagV).toBe(60);
    expect(run.V).toBe(40);
  });
});

describe("縦断線形（設計書 4.3）", () => {
  const step = (d: number): VerticalInput => {
    const n = Math.round(d / 5) + 1;
    const stations = Float64Array.from({ length: n }, (_, i) => (i * d) / (n - 1));
    return {
      length: d,
      V: 60,
      minV: 40,
      stations,
      target: stations.map((s) => (s < d / 2 ? 0 : 7)),
      lower: stations.map(() => -Infinity),
      upper: stations.map(() => Infinity),
      lowerAtCrossings: stations.map(() => -Infinity),
      start: { z: 0, grade: 0 },
      end: { z: 7, grade: 0 },
    };
  };

  it("T9: a 7 m step over 300 m becomes a symmetric S of parabolas within 第20条 and 第22条", () => {
    const r = solveVertical(step(300));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.profile;
    expect(p.steps).toEqual(["standard"]);
    expect(evalProfile(p, 0).z).toBeCloseTo(0, 6);
    expect(evalProfile(p, 300).z).toBeCloseTo(7, 4);
    expect(evalProfile(p, 150).z).toBeGreaterThan(3);
    expect(evalProfile(p, 150).z).toBeLessThan(4);
    expect(Math.max(...p.g.map(Math.abs))).toBeLessThanOrEqual(MAX_GRADE.value[60].standard);
    expect(p.h).toBeGreaterThanOrEqual(VERTICAL_CURVE_LENGTH.value[60]);
    for (let j = 0; j + 1 < p.g.length; j++) {
      const k = (p.g[j + 1] - p.g[j]) / p.h;
      expect(k).toBeGreaterThanOrEqual(-1 / VERTICAL_CURVE_RADIUS.value[60].crest - 1e-12);
      expect(k).toBeLessThanOrEqual(1 / VERTICAL_CURVE_RADIUS.value[60].sag + 1e-12);
    }
  });

  it("T9: over 100 m it cannot be done, and the diagnosis lists every fallback in the order of 4.3 の 3", () => {
    const r = solveVertical(step(100));
    expect(r.ok).toBe(false);
    expect(r.attempts.map((a) => [a.V, a.special, a.crossingsOnly])).toEqual([
      [60, false, false],
      [60, true, false],
      [50, true, false],
      [40, true, false],
      [40, true, true],
    ]);
    for (const a of r.attempts) expect(a.worst).not.toBe("");
  });

  it("falls back to the 特例 grade only when the standard grade cannot make it", () => {
    const r = solveVertical(step(200));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.steps).toEqual(["specialGrade"]);
  });
});

describe("合成した高架とランプのコンパイル（T1〜T5, T7）", () => {
  const { net, street } = mainAndRamp();
  const { result } = compile(net, [street]);
  const runs = new Map(result.runs.map((r) => [r.id, r]));
  const chunks = byRun(result.chunks);

  it("solves both runs with nothing unsolved", () => {
    expect([...runs.keys()].sort()).toEqual(["10", "20"]);
    expect(result.diagnostics.filter((d) => !d.allowed)).toEqual([]);
  });

  it("T1・T2: grades and vertical curves are within 第20条・第22条 on every chunk", () => {
    for (const c of result.chunks) {
      expect(checkGrade(c, runs.get(c.run)!)).toEqual([]);
      expect(checkVerticalCurves(c)).toEqual([]);
    }
  });

  it("T3: chunks of a run join without gap, step or kink, and the ramp leaves the main line at its height, grade and bank", () => {
    for (const list of chunks.values())
      for (let i = 1; i < list.length; i++) expect(checkChunkJoin(list[i - 1], list[i])).toEqual([]);
    const ramp = runs.get("20")!;
    expect(ramp.start.kind).toBe("junction");
    expect(checkJunction(chunks.get("20")![0], true, ramp.start.grade!, chunks.get("10")!)).toEqual([]);
  });

  it("T4: the street underneath is cleared by 4.5 m + girder, and the deck keeps that over the ground away from its ends", () => {
    const main = chunks.get("10")!;
    expect(main.reduce((n, c) => n + c.cross.length, 0)).toBeGreaterThan(0);
    for (const c of main) expect(checkClearance(c, runs.get("10")!)).toEqual([]);
  });

  it("T5: the ends meet the ground (T.P. 3 m) within 5 cm at the ground's grade", () => {
    const main = chunks.get("10")!;
    expect(checkGroundEnd(main[0], runs.get("10")!, true)).toEqual([]);
    expect(checkGroundEnd(main[main.length - 1], runs.get("10")!, false)).toEqual([]);
    expect(main[0].st[3]).toBeCloseTo(GROUND, 2);
  });

  it("T6・T7: no kinks, and superelevation within 第16条・第18条・第25条", () => {
    for (const c of result.chunks) {
      expect(checkPlan(c, runs.get(c.run)!).problems).toEqual([]);
      expect(checkSuperelevation(c)).toEqual([]);
    }
  });

  it("cuts chunks at the junction node and at most every 300 m, with ids <run>:<k>", () => {
    const main = chunks.get("10")!;
    for (const c of main) {
      const length = c.st[c.st.length - 6] - c.st[0];
      expect(length).toBeLessThanOrEqual(300 + 1e-6);
      expect(c.id).toBe(`10:${c.k}`);
    }
    expect(main.some((c) => Math.abs(c.st[0] - 800) < 1)).toBe(true);
  });

  it("keeps no operator name in what it writes", () => {
    expect(JSON.stringify(result)).not.toMatch(/首都高|Shuto|Metropolitan Expressway/i);
  });
});

describe("片勾配（設計書 4.3 の 4, T7）", () => {
  it("e = V²/127R − f, signed so a right-hand curve raises the left edge", () => {
    expect(targetSuperelevation(60, -1 / 150)).toBeCloseTo(3600 / (127 * 150) - 0.15, 9);
    expect(targetSuperelevation(60, 1 / 150)).toBeLessThan(0);
    expect(targetSuperelevation(60, 1 / 20)).toBe(-0.1);
  });

  it("runs in no faster than 10 % over the 第18条 length, even into a pinned end", () => {
    const n = 400;
    const s = Float64Array.from({ length: n }, (_, i) => i);
    const kappa = Float64Array.from({ length: n }, (_, i) => (i > 150 && i < 250 ? -1 / 60 : 0));
    const bank = superelevation(60, kappa, s, { start: 0.05, end: 0 });
    expect(bank[0]).toBe(0.05);
    expect(bank[n - 1]).toBe(0);
    for (let i = 1; i < n; i++)
      expect(Math.abs(bank[i] - bank[i - 1])).toBeLessThanOrEqual(0.1 / TRANSITION_LENGTH.value[60] + 1e-12);
  });
});

describe("決定性と範囲（T8）", () => {
  it("compiling twice gives byte-identical output", () => {
    const { net, street } = mainAndRamp();
    const a = JSON.stringify(compile(net, [street]).result);
    const b = JSON.stringify(compile(mainAndRamp().net, [street]).result);
    expect(a).toBe(b);
  });

  it("a run shared by two ranges compiles to the same chunks whichever range is built", () => {
    const { net, street } = mainAndRamp();
    const east = { ...plane, box: [plane.toLonLat(1500, -50), plane.toLonLat(2000, 50)] };
    const rampOnly = { box: [plane.toLonLat(900, -80), plane.toLonLat(1150, -30)] };
    const bbox = (b: Array<[number, number]>) => ({
      minLon: b[0][0],
      minLat: b[0][1],
      maxLon: b[1][0],
      maxLat: b[1][1],
    });
    const fromEast = solvePlan(planNetwork(net, new Set(), bbox(east.box)), ground, [street]);
    const fromRamp = solvePlan(planNetwork(net, new Set(), bbox(rampOnly.box)), ground, [street]);
    expect(fromEast.runs.map((r) => r.id)).toEqual(["10"]);
    expect(fromRamp.runs.map((r) => r.id)).toEqual(["20"]);
    const all = compile(net, [street]).result;
    expect(JSON.stringify(fromEast.chunks)).toBe(JSON.stringify(all.chunks.filter((c) => c.run === "10")));
    expect(JSON.stringify(fromRamp.chunks)).toBe(JSON.stringify(all.chunks.filter((c) => c.run === "20")));
  });
});

describe("床版の上下干渉（deck_overlap）と報告", () => {
  const template = () => compile(mainAndRamp().net, [mainAndRamp().street]).result.chunks[0];
  /** A straight 200 m chunk going east at y metres north, at elevation z. */
  const deck = (run: string, y: number, z: number): XwChunk => {
    const st: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const [lon, lat] = plane.toLonLat(i * 10, y);
      st.push(i * 10, lon, lat, z, 0, GROUND);
    }
    return { ...template(), id: `${run}:0`, run, k: 0, st };
  };

  it("finds two decks 3.3 m apart whose heights differ by more than 5 cm but less than a level", () => {
    const found = deckOverlaps([deck("a", 0, 20), deck("b", 3.3, 15.5)]);
    expect(found).toHaveLength(1);
    expect(found[0].maxDzM).toBeCloseTo(4.5, 6);
  });

  it("accepts one surface (≤ 5 cm), a whole level apart (≥ 4.5 m + girder), and decks clear of each other", () => {
    expect(deckOverlaps([deck("a", 0, 20), deck("b", 3.3, 20.03)])).toEqual([]);
    expect(deckOverlaps([deck("a", 0, 20), deck("b", 3.3, 12)])).toEqual([]);
    expect(deckOverlaps([deck("a", 0, 20), deck("b", 30, 15)])).toEqual([]);
  });

  it("reports a crossing on the same OSM layer instead of dropping it silently", () => {
    const a = line(0, 0, 1000, 0);
    const b = line(500, -500, 500, 500);
    const net = network([
      { id: 1, pts: a, nodeIds: a.map((_, i) => 100 + i), tags: viaduct },
      { id: 2, pts: b, nodeIds: b.map((_, i) => 300 + i), tags: viaduct },
    ]);
    const plan = planNetwork(net, new Set(), null);
    expect(plan.diagnostics.map((d) => d.kind)).toContain("crossing_layer_ambiguous");
  });

  it("only the allowlist (with a reason) can mark a diagnostic allowed", () => {
    expect(isAllowed({ run: "x", kind: "deck_overlap" })).toBe(true);
    expect(isAllowed({ run: "x", kind: "vertical_unsolved" })).toBe(false);
    for (const a of ALLOWLIST) expect(a.reason.length).toBeGreaterThan(10);
  });
});
