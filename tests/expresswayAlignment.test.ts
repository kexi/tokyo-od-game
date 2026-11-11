import { describe, expect, it } from "vitest";
import {
  COMPOSITE_GRADE,
  MAX_GRADE,
  ROAD_STANDARDS,
  TRANSITION_LENGTH,
  VERTICAL_CURVE_LENGTH,
  VERTICAL_CURVE_RADIUS,
} from "../src/law/roadStandards";
import { isAllowed, RULES } from "../src/expressway/allowlist";
import { ledgerVerdict } from "../src/expressway/ledger";
import { ASSUMPTIONS, MAX_LATERAL_SHIFT } from "../src/expressway/assumptions";
import {
  checkChunkJoin,
  checkClearance,
  checkGrade,
  checkGroundEnd,
  checkJunction,
  checkPlan,
  checkSuperelevation,
  checkSurface,
  checkVerticalCurves,
} from "../src/expressway/checks";
import { type CrossObject, planNetwork, solvePlan, stationPositions } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { deckOverlaps } from "../src/expressway/overlap";
import { hermite, surfaceAt } from "../src/expressway/profile";
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

describe("法令値と仮定の集約（knowledge/road-redesign-plan.md 3.4）", () => {
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

describe("入力の正規化（knowledge/road-redesign-plan.md 4.1）", () => {
  it("strips the operator off route names and keeps entrance names, ref, destination and maxspeed", () => {
    const w = normalizeWay(1, [1, 2], {
      highway: "motorway",
      name: "首都高速都心環状線",
      "name:en": "Shuto Expressway Inner Circular Route",
      ref: "C1",
      destination: "銀座",
    });
    expect(w.name).toBe("都心環状線");
    expect(w.nameEn).toBe("Inner Circular Route");
    expect(w.maxspeedTag).toBeNull();
    expect(normalizeWay(3, [1, 2], { highway: "motorway", maxspeed: "50" }).maxspeedTag).toBe(50);
    expect(normalizeWay(4, [1, 2], { highway: "motorway", name: "首都高" }).name).toBeNull();
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

describe("平面線形（knowledge/road-redesign-plan.md 4.2, T6）", () => {
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

  it("lowers the design speed only around a curve whose radius is below 第15条 for the tagged speed", () => {
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
    // 設計速度は区間ごと: the curve (R 80 m: ≥ 60 m for V40, < 100 m for V50) and its 第18条
    // transitions are 40, the straights either side keep the tagged 60.
    const at = (s: number) => run.zones.find((z) => s >= z.from && s <= z.to)!.V;
    const curveMid = 200 + (80 * Math.PI) / 4;
    expect(at(curveMid)).toBe(40);
    expect(at(10)).toBe(60);
    expect(at(run.length - 10)).toBe(60);
    // The 40 stretch covers the curve plus at least the 第18条 length of V60 on both sides.
    const slow = run.zones.find((z) => z.V === 40)!;
    // (The plan smoothing rounds the arc's ends over ~25 m, so the tight part starts 25 m in.)
    const arc = [200 + 25, 200 + (80 * Math.PI) / 2 - 25];
    expect(slow.from).toBeLessThanOrEqual(arc[0] - TRANSITION_LENGTH.value[60] + 1);
    expect(slow.to).toBeGreaterThanOrEqual(arc[1] + TRANSITION_LENGTH.value[60] - 1);
  });
});

describe("縦断線形（knowledge/road-redesign-plan.md 4.3）", () => {
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
    expect(r.steps).toEqual(["standard"]);
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
    if (r.ok) expect(r.steps).toEqual(["specialGrade"]);
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
      const length = c.st[c.st.length - STATION_STRIDE] - c.st[0];
      expect(length).toBeLessThanOrEqual(300 + 1e-6);
      expect(c.id).toBe(`10:${c.k}`);
    }
    expect(main.some((c) => Math.abs(c.st[0] - 800) < 1)).toBe(true);
  });

  it("keeps no operator name in what it writes", () => {
    expect(JSON.stringify(result)).not.toMatch(/首都高|Shuto|Metropolitan Expressway/i);
  });
});

describe("片勾配（knowledge/road-redesign-plan.md 4.3 の 4, T7）", () => {
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
    // What is written (chunks, run summaries, diagnostics); `stats` carries timings for the log.
    const written = ({ chunks, runs, diagnostics }: ReturnType<typeof solvePlan>) =>
      JSON.stringify({ chunks, runs, diagnostics });
    const a = written(compile(net, [street]).result);
    const b = written(compile(mainAndRamp().net, [street]).result);
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
      st.push(i * 10, lon, lat, z, 0, GROUND, 0);
    }
    return { ...template(), id: `${run}:0`, run, chain: `c${run}`, k: 0, st };
  };

  it("finds two decks 3.3 m apart whose heights differ by more than 5 cm but less than a level", () => {
    const found = deckOverlaps([deck("a", 0, 20), deck("b", 3.3, 15.5)]);
    expect(found).toHaveLength(1);
    expect(found[0].maxDzM).toBeCloseTo(4.5, 6);
  });

  it("does not count two runs of one chain (a viaduct and the tunnel it goes on into, P9) as decks over each other", () => {
    const a = deck("a", 0, 20);
    const b = { ...deck("b", 3.3, 15.5), chain: a.chain };
    expect(deckOverlaps([a, b])).toEqual([]);
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

  it("only the rules and the ledger mark a diagnostic allowed, a deck overlap only case by case within its cap", () => {
    expect(isAllowed({ run: "x", kind: "vertical_fallback" })).toBe(true);
    expect(isAllowed({ run: "x", kind: "vertical_unsolved" })).toBe(false);
    expect(isAllowed({ run: "x", kind: "vertical_crossings_only" })).toBe(false);
    const detail = (b: string, n: number, dz: number) =>
      `with ${b}: ${n} stations, |Δz| 0.10–${dz} m, centre lines 6.1 m apart`;
    const end = { kind: "open" as const };
    const main = (id: string) => ({ id, cls: "expressway" as const, start: end, end });
    const ctx = {
      runs: new Map(["a", "b", "c"].map((id) => [id, main(id)])),
      untied: new Set<string>(),
      mouths: () => [],
    };
    const reviewed = {
      key: "changeover:a|b",
      kind: "changeover" as const,
      run: "a",
      with: "b",
      chunk: null,
      district: "central" as const,
      block: "a",
      blockHash: "0",
      measured: { stations: 3, minDzM: 0.1, maxDzM: 2 },
      cap: { stations: 3, maxDzM: 2 },
      status: "accepted" as const,
      by: "review" as const,
      reason: "test",
      qa: null,
      previous: null,
    };
    const ledger = {
      version: 1 as const,
      data: { ranges: [], scope: null, objective: "v1", extract: null },
      summary: { cases: {}, open: 0, withoutQa: 0, seamProbes: 0, rules: {} },
      budget: null,
      cases: [reviewed],
    };
    const verdict = ledgerVerdict(ctx, ledger);
    // Without the ledger only the rules: no pair passes.
    expect(isAllowed({ run: "a", kind: "deck_overlap", detail: detail("b", 3, 2) })).toBe(false);
    expect(isAllowed({ run: "a", kind: "deck_overlap", detail: detail("b", 3, 2) }, verdict)).toBe(true);
    expect(isAllowed({ run: "b", kind: "deck_overlap", detail: detail("a", 3, 2) }, verdict)).toBe(true);
    expect(isAllowed({ run: "a", kind: "deck_overlap", detail: detail("c", 3, 2) }, verdict)).toBe(false);
    // Up to the cap and the margin (stations +2, |Δz| +5 cm): beyond is a new finding.
    expect(isAllowed({ run: "a", kind: "deck_overlap", detail: detail("b", 5, 2.05) }, verdict)).toBe(true);
    expect(isAllowed({ run: "a", kind: "deck_overlap", detail: detail("b", 6, 2) }, verdict)).toBe(false);
    expect(isAllowed({ run: "a", kind: "deck_overlap", detail: detail("b", 3, 2.06) }, verdict)).toBe(false);
    // An open case is a defect, not accepted.
    const open = ledgerVerdict(ctx, { ...ledger, cases: [{ ...reviewed, status: "open" as const }] });
    expect(isAllowed({ run: "a", kind: "deck_overlap", detail: detail("b", 3, 2) }, open)).toBe(false);
    for (const r of RULES) expect(r.reason.length).toBeGreaterThan(10);
    expect(RULES.some((r) => r.kind === "deck_overlap")).toBe(false);
  });
});

/** The run's stations as plan points (m) with the chunk data, in order along the run. */
function stationsAlong(chunks: XwChunk[]) {
  const out: Array<{ x: number; y: number; s: number; z: number; bank: number; grade: number }> = [];
  for (const c of [...chunks].sort((a, b) => a.k - b.k)) {
    for (let i = out.length === 0 ? 0 : STATION_STRIDE; i < c.st.length; i += STATION_STRIDE) {
      const [x, y] = plane.toXY(c.st[i + 1], c.st[i + 2]);
      out.push({ x, y, s: c.st[i], z: c.st[i + 3], bank: c.st[i + 4], grade: c.st[i + 6] });
    }
  }
  return out;
}

/** Surface height and bank of a run at the point of its centre line nearest (x, y). */
function nearestOn(chunks: XwChunk[], x: number, y: number) {
  const pts = stationsAlong(chunks);
  let best = { d: Infinity, z: 0, bank: 0 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const t = Math.min(1, Math.max(0, ((x - p.x) * ex + (y - p.y) * ey) / (ex * ex + ey * ey)));
    const d = Math.hypot(x - p.x - ex * t, y - p.y - ey * t);
    if (d >= best.d) continue;
    const s = p.s + (q.s - p.s) * t;
    const c = chunks.find((k) => s >= k.st[0] && s <= k.st[k.st.length - STATION_STRIDE])!;
    best = { d, z: surfaceAt(c.st, s).z, bank: p.bank + (q.bank - p.bank) * t };
  }
  return best;
}

/** Carriageway (車線域) half widths recomputed from 第5・8条 (main) and the ramp assumption. */
const LANE_HALF = { main: (2 * 3.25 + 1.25 + 0.75) / 2, ramp: (3.25 + 1.0 + 0.5) / 2 };
const LEVEL = 4.5 + 2.2;

function checkAll(result: ReturnType<typeof solvePlan>) {
  const runs = new Map(result.runs.map((r) => [r.id, r]));
  const problems: string[] = [];
  for (const c of result.chunks) {
    const run = runs.get(c.run)!;
    problems.push(...checkGrade(c, run), ...checkVerticalCurves(c), ...checkSurface(c));
    problems.push(...checkClearance(c, run), ...checkSuperelevation(c), ...checkPlan(c, run).problems);
  }
  return problems;
}

describe("連結した run を 1 つの QP で解く（設計書 4.3、縦断の一括解）", () => {
  // A ramp leaves the main line at x = 800 and crosses over a parallel viaduct 30 m north only ~70 m
  // after its deck parts from the main line's: neither can stay at the standard height. Solved run
  // by run (P1: the lower deck first at its standard height, then the main line, then the ramp),
  // the ramp could not climb a level in time.
  function rampOverParallel() {
    const main = line(0, 0, 2000, 0);
    const mainIds = main.map((_, i) => 1000 + i);
    const other = line(2000, 30, 0, 30);
    const otherIds = other.map((_, i) => 3000 + i);
    const rampPts: Array<[number, number]> = [[800, 0], [850, 8], ...line(900, 38, 1150, 190), [1300, 280]];
    const rampIds = [mainIds[16], ...rampPts.slice(1).map((_, i) => 2000 + i)];
    return network([
      { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
      { id: 30, pts: other, nodeIds: otherIds, tags: viaduct },
      {
        id: 20,
        pts: rampPts,
        nodeIds: rampIds,
        tags: { highway: "motorway_link", bridge: "yes", layer: "2" },
      },
    ]);
  }
  const { plan, result } = compile(rampOverParallel());
  const chunks = byRun(result.chunks);

  it("groups the three runs into one problem (junction + deck over deck) and solves all of them", () => {
    expect(plan.components.get(plan.componentOf.get("20")!)!.sort()).toEqual(["10", "20", "30"]);
    expect(result.runs.map((r) => r.id).sort()).toEqual(["10", "20", "30"]);
    expect(result.diagnostics.filter((d) => !d.allowed)).toEqual([]);
    expect(checkAll(result)).toEqual([]);
  });

  it("the ramp clears the parallel deck by a level where it crosses it, recomputed from the tiles", () => {
    const ramp = stationsAlong(chunks.get("20")!);
    const over = ramp.filter((p) => Math.abs(p.y - 30) < LANE_HALF.ramp + LANE_HALF.main);
    expect(over.length).toBeGreaterThan(0);
    for (const p of over)
      expect(p.z - nearestOn(chunks.get("30")!, p.x, p.y).z).toBeGreaterThanOrEqual(LEVEL - 0.002);
    expect(deckOverlaps(result.chunks)).toEqual([]);
  });

  it("moves the coupled decks off their standard height where the ramp needs it (not the ramp alone)", () => {
    const standard = GROUND + 6.5 + 2.2;
    const mainAtNose = nearestOn(chunks.get("10")!, 800, 0).z;
    const otherAtCrossing = nearestOn(chunks.get("30")!, 880, 30).z;
    // Together they open a gap that their standard heights (equal) would not give.
    expect(mainAtNose - otherAtCrossing).toBeGreaterThan(2);
    expect(Math.max(mainAtNose - standard, standard - otherAtCrossing)).toBeGreaterThan(1);
  });
});

describe("床版の重なり: 同一面と 1 段離し（設計書 4.2）", () => {
  // Two carriageways the opposite way round a 160 m curve (V60), centre lines 4 m apart: their
  // decks overlap. On one OSM layer they must be one surface (|Δz| ≤ 5 cm, one cross slope).
  function sideBySide(gap: number) {
    const arc = (r: number) =>
      Array.from({ length: 13 }, (_, i) => {
        const t = (i / 12) * (Math.PI / 2);
        return [400 + r * Math.sin(t), 160 - r * Math.cos(t)] as [number, number];
      });
    const a: Array<[number, number]> = [
      ...line(0, 0, 400, 0).slice(0, -1),
      ...arc(160),
      ...line(560, 160, 560, 600).slice(1),
    ];
    const b: Array<[number, number]> = [
      ...line(560 + gap, 600, 560 + gap, 160).slice(0, -1),
      ...arc(160 + gap).reverse(),
      ...line(400, -gap, 0, -gap).slice(1),
    ];
    return network([
      { id: 1, pts: a, nodeIds: a.map((_, i) => 100 + i), tags: viaduct },
      { id: 2, pts: b, nodeIds: b.map((_, i) => 500 + i), tags: viaduct },
    ]);
  }

  it("same layer: one surface wherever the decks overlap, with one cross slope (opposite banks)", () => {
    const { result } = compile(sideBySide(4));
    expect(result.diagnostics.filter((d) => !d.allowed)).toEqual([]);
    expect(checkAll(result)).toEqual([]);
    const chunks = byRun(result.chunks);
    let compared = 0;
    let banked = 0;
    for (const p of stationsAlong(chunks.get("1")!)) {
      const q = nearestOn(chunks.get("2")!, p.x, p.y);
      const isOver = q.d < 2 * LANE_HALF.main;
      if (!isOver) continue;
      compared++;
      expect(Math.abs(p.z - q.z)).toBeLessThanOrEqual(0.05);
      // Opposite directions: one slab tilts one way, so the banks (per direction) have opposite signs.
      expect(Math.abs(p.bank + q.bank)).toBeLessThanOrEqual(0.002);
      if (Math.abs(p.bank) > 0.01) banked++;
    }
    expect(compared).toBeGreaterThan(50);
    expect(banked).toBeGreaterThan(5);
    expect(deckOverlaps(result.chunks)).toEqual([]);
  });

  it("different layers: the upper deck a whole level (4.5 m + girder) over the lower one", () => {
    // The upper carriageway swings out at both ends so each can still meet the ground.
    const lower = line(1600, 0, 0, 0);
    const upper: Array<[number, number]> = [
      [0, 90],
      [300, 90],
      ...line(650, 3, 950, 3),
      [1300, 90],
      [1600, 90],
    ];
    const net = network([
      { id: 1, pts: upper, nodeIds: upper.map((_, i) => 100 + i), tags: { ...viaduct, layer: "2" } },
      { id: 2, pts: lower, nodeIds: lower.map((_, i) => 500 + i), tags: { ...viaduct, layer: "1" } },
    ]);
    const { result } = compile(net);
    expect(result.diagnostics.filter((d) => !d.allowed)).toEqual([]);
    expect(checkAll(result)).toEqual([]);
    const chunks = byRun(result.chunks);
    const over = stationsAlong(chunks.get("1")!).filter(
      (p) => nearestOn(chunks.get("2")!, p.x, p.y).d < 2 * LANE_HALF.main,
    );
    expect(over.length).toBeGreaterThan(20);
    for (const p of over)
      expect(p.z - nearestOn(chunks.get("2")!, p.x, p.y).z).toBeGreaterThanOrEqual(LEVEL - 0.002);
    expect(deckOverlaps(result.chunks)).toEqual([]);
  });
});

describe("分合流のノーズ（ノーズから分離までは親と同一面）", () => {
  const { net, street } = mainAndRamp();
  const { result } = compile(net, [street]);
  const chunks = byRun(result.chunks);

  it("the ramp's deck stays on the main line's surface (height and bank) until it is clear of it", () => {
    const ramp = stationsAlong(chunks.get("20")!);
    const onMain = ramp.filter(
      (p) => nearestOn(chunks.get("10")!, p.x, p.y).d < LANE_HALF.main + LANE_HALF.ramp,
    );
    expect(onMain.length).toBeGreaterThanOrEqual(2);
    for (const p of onMain) {
      const q = nearestOn(chunks.get("10")!, p.x, p.y);
      expect(Math.abs(p.z - q.z)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.bank - q.bank)).toBeLessThanOrEqual(0.002);
    }
    expect(deckOverlaps(result.chunks)).toEqual([]);
  });
});

describe("エルミート補間（測点の勾配、P3 の surfaceY と共有）", () => {
  it("reproduces a parabola exactly between two stations (value and grade)", () => {
    const z = (s: number) => 2 + 0.03 * s - (s * s) / 900;
    const g = (s: number) => 0.03 - (2 * s) / 900;
    for (const s of [10, 13.7, 22, 30]) {
      const p = hermite(10, z(10), g(10), 30, z(30), g(30), s);
      expect(p.z).toBeCloseTo(z(s), 12);
      expect(p.grade).toBeCloseTo(g(s), 12);
    }
  });

  it("is C¹ across every station of a compiled run, chunk seams included (no step, no kink)", () => {
    const { net, street } = mainAndRamp();
    const { result } = compile(net, [street]);
    const at = (st: number[], i: number) => st.slice(i * STATION_STRIDE, (i + 1) * STATION_STRIDE);
    for (const list of byRun(result.chunks).values()) {
      const sorted = [...list].sort((a, b) => a.k - b.k);
      for (let k = 0; k < sorted.length; k++) {
        const st = sorted[k].st;
        const n = st.length / STATION_STRIDE;
        for (let i = 1; i + 1 < n; i++) {
          const [sa, , , za, , , ga] = at(st, i - 1);
          const [s, , , z, , , g] = at(st, i);
          const [sb, , , zb, , , gb] = at(st, i + 1);
          const left = hermite(sa, za, ga, s, z, g, s - 1e-6);
          const right = hermite(s, z, g, sb, zb, gb, s + 1e-6);
          expect(Math.abs(left.z - right.z)).toBeLessThan(1e-5);
          expect(Math.abs(left.grade - right.grade)).toBeLessThan(1e-4);
        }
        const next = sorted[k + 1];
        if (!next) continue;
        // The seam: the next chunk starts with the same station, elevation and grade.
        expect(next.st[3]).toBe(st[st.length - STATION_STRIDE + 3]);
        expect(next.st[6]).toBe(st[st.length - STATION_STRIDE + 6]);
      }
    }
  });

  it("each station's grade agrees with its neighbours' elevations (recomputed from z alone)", () => {
    const { net, street } = mainAndRamp();
    const { result } = compile(net, [street]);
    for (const c of result.chunks) {
      // The derivative of a curve lies between its two neighbouring chord slopes, up to how much
      // the curvature may change inside them (1/R凸 + 1/R凹 of 第22条 for the section's speed)
      // times the spacing / 8, plus the rounding of z (1 mm) and of the grade.
      const r = VERTICAL_CURVE_RADIUS.value[c.V as 60];
      const st = c.st;
      for (let i = STATION_STRIDE; i + STATION_STRIDE < st.length; i += STATION_STRIDE) {
        const h1 = st[i] - st[i - STATION_STRIDE];
        const h2 = st[i + STATION_STRIDE] - st[i];
        const left = (st[i + 3] - st[i - STATION_STRIDE + 3]) / h1;
        const right = (st[i + STATION_STRIDE + 3] - st[i + 3]) / h2;
        const tol = ((h1 + h2) / 8) * (1 / r.crest + 1 / r.sag) + 0.002 / Math.min(h1, h2) + 1e-5;
        const grade = st[i + 6];
        expect(grade).toBeGreaterThanOrEqual(Math.min(left, right) - tol);
        expect(grade).toBeLessThanOrEqual(Math.max(left, right) + tol);
      }
    }
  });
});

describe("チャンクの測点の位置（節点と端）", () => {
  it("never moves the chunk's ends and puts a station on every knot, even one right by an end", () => {
    // A knot (30) added first used to shift the end's index, so the end (100) was moved onto the
    // knot at 99: a gap at the seam with the next chunk, which starts at exactly 100.
    const plan = [0, 20, 40, 60, 80, 100];
    const out = stationPositions(plan, [30, 99, 61], 0, 100);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(100);
    for (const knot of [30, 99, 61]) expect(out).toContain(knot);
    // A plan station within 2.5 m of a knot moves onto it instead of doubling up (60 → 61).
    expect(out).not.toContain(60);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });

  it("keeps the seams of a compiled run exact: each chunk starts where the previous one ends", () => {
    const { net, street } = mainAndRamp();
    const { result } = compile(net, [street]);
    for (const list of byRun(result.chunks).values()) {
      const sorted = [...list].sort((a, b) => a.k - b.k);
      for (let k = 1; k < sorted.length; k++) {
        const prev = sorted[k - 1].st;
        expect(sorted[k].st.slice(0, 4)).toEqual(prev.slice(prev.length - STATION_STRIDE, prev.length - 3));
      }
    }
  });
});
