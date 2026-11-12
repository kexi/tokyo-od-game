import { describe, expect, it } from "vitest";
import {
  GROUND_APPROACH_END_M,
  GROUND_APPROACH_SEAM_M,
  groundFitOf,
  groundTargetOf,
  OBJECTIVE_V2,
  planNetwork,
  solvePlan,
} from "../src/expressway/compile";
import { GROUND_INNER_MEDIAN_M, isAutoAccepted } from "../src/expressway/ledger";
import { groundTarget, movingMedian, repeatedMedianLine } from "../src/expressway/designGround";
import type { XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { surfaceAt } from "../src/expressway/profile";
import { HEIGHT_STRUCTURES } from "../src/expressway/assumptions";
import { trackingOf } from "../src/expressway/report";

// S6 PR 7a (N1): a run at grade's target is the ground's moving median, its window kept whole at an end
// by the chain's ground beyond it (a compiled run at grade there) or narrowed both sides alike (a viaduct,
// a tunnel, the chain's end), so on a slope it stays on the ground at the ends instead of lagging by half the
// window's rise.

const P = planeAt(139.75, 35.65);
const viaduct = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", oneway: "yes" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", oneway: "yes" };

/** Ways in a row along y 0: [x0, x1, tags] each, nodes every 50 m. */
function chain(ways: Array<[number, number, Record<string, string>]>): Network {
  const n: Network = { ways: new Map(), nodes: new Map() };
  const id = (x: number) => 10000 + Math.round(x);
  ways.forEach(([x0, x1, tags], k) => {
    const xs: number[] = [];
    for (let x = x0; x <= x1 + 1e-9; x += 50) xs.push(x);
    for (const x of xs) {
      const [lon, lat] = P.toLonLat(x, 0);
      n.nodes.set(id(x), normalizeNode(id(x), lon, lat, {}));
    }
    n.ways.set(k + 1, normalizeWay(k + 1, xs.map(id), tags));
  });
  return n;
}
const xOf = (lon: number, lat: number) => P.toXY(lon, lat)[0];
const options = { structures: "height" as const, ground: "compile" as const };

describe("地平 run の目標線: 端で窓が片側にならない（S6 PR 7a、N1）", () => {
  // Viaduct x 0–1000, at grade 1000–2000 (the chain ends there), viaduct 2000–3000 in a second net.
  const slope = (lon: number, lat: number) => 3 + 0.03 * xOf(lon, lat);
  const reach = 150;

  it("on a 3 % slope stays within 0.3 m of the ground at a seam, 100 m short of one, and at a ground end", () => {
    const net = chain([
      [0, 1000, viaduct],
      [1000, 2000, atGrade],
    ]);
    const plan = planNetwork(net, new Set(), null, [], options);
    const rp = plan.runs.get("2")!;
    const { stations, ground, target } = groundTargetOf(plan, rp, slope, reach);
    const at = (s: number) => {
      const k = stations.findIndex((v) => v >= s - 1e-9);
      return { off: target[k] - ground[k], old: movingMedian(ground, reach, 5)[k] - ground[k] };
    };
    const n = stations.length;
    const S = stations[n - 1];
    // The seam (its start, the viaduct goes on before it), 100 m on, and the ground end (the chain's end).
    for (const s of [0, 100, S]) expect(Math.abs(at(s).off), `s ${s}`).toBeLessThanOrEqual(0.3);
    // movingMedian alone (before N1) lagged there: by half the window's rise at either end.
    expect(Math.abs(at(0).old)).toBeGreaterThan(1);
    expect(Math.abs(at(S).old)).toBeGreaterThan(1);
  });

  it("downhill into a seam too (the viaduct after the run at grade)", () => {
    const net = chain([
      [0, 1000, atGrade],
      [1000, 2000, viaduct],
    ]);
    const plan = planNetwork(net, new Set(), null, [], options);
    const rp = plan.runs.get("1")!;
    const down = (lon: number, lat: number) => 63 - 0.03 * xOf(lon, lat);
    const { stations, ground, target } = groundTargetOf(plan, rp, down, reach);
    const n = stations.length;
    for (const k of [0, n - 21, n - 1])
      expect(Math.abs(target[k] - ground[k]), `k ${k}`).toBeLessThanOrEqual(0.3);
    const old = movingMedian(ground, reach, 5);
    expect(Math.abs(old[n - 1] - ground[n - 1])).toBeGreaterThan(1);
  });

  it("does not take the DEM's bumps near an end: a 3 m, 40 m mound or hollow 25, 40, 60 or 100 m from a ground end or a seam moves the road by 0.2 m at most (v2, the adopted weight)", () => {
    // At grade x 1000–2000 after a viaduct; the far end a ground end (the chain ends) or a seam onto
    // a viaduct again. Review C1: the least-squares line and the narrowed window moved it 1.5–2.3 m.
    const layouts = {
      groundEnd: () =>
        chain([
          [0, 1000, viaduct],
          [1000, 2000, atGrade],
        ]),
      seam: () =>
        chain([
          [0, 1000, viaduct],
          [1000, 2000, atGrade],
          [2000, 3000, viaduct],
        ]),
    };
    const roadOf = (net: Network, ground: (lon: number, lat: number) => number) => {
      const res = solvePlan(planNetwork(net, new Set(), null, [], options), ground, [], {
        objective: OBJECTIVE_V2,
      });
      const list = res.chunks.filter((c) => c.run === "2").sort((a, b) => a.k - b.k) as XwChunk[];
      const last = list[list.length - 1];
      const zs: number[] = [];
      for (let s = 0; s <= last.st[last.st.length - 7]; s += 1) {
        const c = list.find((k) => k.st[k.st.length - 7] >= s) ?? last;
        zs.push(surfaceAt(c.st, s).z);
      }
      return zs;
    };
    for (const [name, net] of Object.entries(layouts)) {
      const level = roadOf(net(), () => 3);
      for (const fromEnd of [25, 40, 60, 100])
        for (const sign of [1, -1]) {
          const centre = 2000 - fromEnd;
          const bumped = roadOf(
            net(),
            (lon, lat) => 3 + (Math.abs(xOf(lon, lat) - centre) < 20 ? sign * 3 : 0),
          );
          const worst = Math.max(...bumped.map((z, s) => Math.abs(z - level[s])));
          expect(worst, `${name} ${fromEnd} m ${sign}`).toBeLessThanOrEqual(0.2);
        }
    }
  });

  it("the line near an end is the robust one: a quarter of the window 3 m off moves it by 0.05 m at most, a least-squares line by over 0.5 m", () => {
    const xs = Array.from({ length: 31 }, (_, k) => k * 5);
    const ys = xs.map((x) => 3 + 0.03 * x + (x >= 5 && x <= 45 ? 3 : 0));
    const { a, b } = repeatedMedianLine(xs, ys);
    expect(Math.abs(a - 3)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(b - 0.03)).toBeLessThanOrEqual(0.002);
    const n = xs.length;
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    const slope =
      xs.reduce((s, x, k) => s + (x - mx) * (ys[k] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    expect(Math.abs(my - slope * mx - 3)).toBeGreaterThan(0.5);
  });

  it("steps smoothly along the run (one rule from the ends to the inside, no seam at 25 m or at reach)", () => {
    const stations = Float64Array.from({ length: 201 }, (_, k) => k * 5);
    const values = Float64Array.from(stations, (s) => 3 + 0.02 * s + Math.sin(s / 7) * 0.4);
    const target = groundTarget(values, stations, 150);
    let worst = 0;
    for (let k = 1; k < target.length; k++) worst = Math.max(worst, Math.abs(target[k] - target[k - 1]));
    // 5 m apart on a 2 % slope: 0.1 m of rise; the moving median alone stepped 0.38 m here.
    expect(worst).toBeLessThanOrEqual(0.2);
  });
});

/** N3's +4 m step: the road 150 m before it, at it and 150 m after, and the reversals (knowledge). */
const N3_RECORDED = { before: 2.42, at: 4.76, after: 7.77, reversalsPerKm: 2.2222 };

describe("地平 run の内側（S6 PR 7a、N2）", () => {
  // 1.5 km at grade (x 500–2000) between two viaducts.
  const net = () =>
    chain([
      [0, 500, viaduct],
      [500, 2000, atGrade],
      [2000, 2500, viaduct],
    ]);
  const solved = (ground: (lon: number, lat: number) => number, scale?: number) => {
    const opts = { ...options, ...(scale !== undefined ? { groundTargetScale: scale } : {}) };
    const plan = planNetwork(net(), new Set(), null, [], opts);
    const res = solvePlan(plan, ground, [], { objective: OBJECTIVE_V2 });
    const list = res.chunks.filter((c) => c.run === "2").sort((a, b) => a.k - b.k) as XwChunk[];
    const zAt = (s: number) => {
      const c = list.find((k) => k.st[k.st.length - 7] >= s - 1e-9) ?? list[list.length - 1];
      return surfaceAt(c.st, s).z;
    };
    return { plan, res, zAt };
  };
  const innerMedian = (ground: (lon: number, lat: number) => number, scale?: number) => {
    const { plan, zAt } = solved(ground, scale);
    const rp = plan.runs.get("2")!;
    const { stations, target } = groundTargetOf(plan, rp, ground, 150);
    const S = stations[stations.length - 1];
    const off: number[] = [];
    stations.forEach((s, k) => {
      const isInside = s >= 100 && s <= S - 100;
      if (isInside) off.push(zAt(s) - target[k]);
    });
    off.sort((a, b) => a - b);
    return off[off.length >> 1];
  };

  it("with both ends 1.2 m low the inside stays within 0.3 m of the line (by the targets' weight alone it sank)", () => {
    const lowEnds = (lon: number, lat: number) => {
      const x = xOf(lon, lat);
      const isNearEnd = x < 600 || x > 1900;
      return isNearEnd ? 1.8 : 3;
    };
    expect(Math.abs(innerMedian(lowEnds))).toBeLessThanOrEqual(0.3);
    expect(Math.abs(innerMedian(lowEnds, 1))).toBeGreaterThan(0.3);
    expect(HEIGHT_STRUCTURES.value.ground.targetScale).toBe(30);
  });

  it("does not ride the DEM's bumps: ±0.5 m every 5 m (seeded) leaves a short-wave σ of 0.1 m and 0.8 reversals a km at most", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const bumps = Array.from({ length: 301 }, () => (rand() * 2 - 1) * 0.5);
    const noisy = (lon: number, lat: number) => {
      const x = xOf(lon, lat);
      return 3 + bumps[Math.max(0, Math.min(300, Math.round((x - 500) / 5)))];
    };
    const { res, zAt } = solved(noisy);
    const t = trackingOf(res.chunks, res.runs, "ground");
    expect(t.runs).toBe(1);
    expect(t.shortWaveStdM!).toBeLessThanOrEqual(0.1);
    expect(t.reversalsPerKm!).toBeLessThanOrEqual(0.8);
    // The ends too (review W8: trackingOf leaves 300 m off them): against the level road, every metre.
    const level = solved(() => 3).zAt;
    let worst = 0;
    for (let s = 0; s <= 1500; s += 1) worst = Math.max(worst, Math.abs(zAt(s) - level(s)));
    expect(worst).toBeLessThanOrEqual(0.15);
  });

  it("N3's +4 m step mid-run: the road before, after and its reversals (recorded, not judged)", () => {
    const step = (lon: number, lat: number) => (xOf(lon, lat) >= 1250 ? 7 : 3);
    const { res, zAt } = solved(step);
    const t = trackingOf(res.chunks, res.runs, "ground");
    const row = {
      before: Math.round(zAt(600) * 100) / 100,
      at: Math.round(zAt(750) * 100) / 100,
      after: Math.round(zAt(900) * 100) / 100,
      reversalsPerKm: t.reversalsPerKm,
    };
    // The values knowledge/expressway-generation.md「P2.7-6 PR 7a」records (N3, not a pass mark): tied
    // here so a change to them shows (review W8).
    expect(row).toEqual(N3_RECORDED);
  });
});

describe("ground-stretch・ground-crossing の規則（S6 PR 7a、4.3・4.7）", () => {
  it("groundFitOf splits the approaches from the inside and measures each from the line", () => {
    const stations = Float64Array.from({ length: 101 }, (_, k) => k * 10);
    const target = new Float64Array(101).fill(3);
    // 3.5 m off at s 0 (a seam's climb), 0.2 m above the line inside.
    const zAt = (s: number) => (s < 50 ? 6.5 - (s / 50) * 3.3 : 3.2);
    const fit = groundFitOf(stations, target, zAt, [GROUND_APPROACH_SEAM_M, GROUND_APPROACH_END_M]);
    expect(fit.approachM).toEqual([150, 100]);
    expect(fit.approachMaxM).toBe(3.5);
    expect(fit.innerMedianM).toBe(0.2);
    expect(fit.innerP95M).toBe(0.2);
  });

  it("passes the inside within the band at its p95 and 0.5 m at its median, the approaches within the cap", () => {
    const band = HEIGHT_STRUCTURES.value.ground.bandM;
    const cap = HEIGHT_STRUCTURES.value.ground.approachMaxM;
    const ok = { innerP95M: band, innerMedianM: -GROUND_INNER_MEDIAN_M, approachMaxM: cap };
    expect(isAutoAccepted({ kind: "ground-stretch", measured: ok })).toBe(true);
    expect(isAutoAccepted({ kind: "ground-stretch", measured: { ...ok, innerP95M: band + 0.01 } })).toBe(
      false,
    );
    expect(isAutoAccepted({ kind: "ground-stretch", measured: { ...ok, innerMedianM: 0.51 } })).toBe(false);
    expect(isAutoAccepted({ kind: "ground-stretch", measured: { ...ok, approachMaxM: cap + 0.01 } })).toBe(
      false,
    );
    // All approach (a short run): its approaches alone.
    expect(isAutoAccepted({ kind: "ground-stretch", measured: { approachMaxM: 1 } })).toBe(true);
    // The old measure alone (heightM) is no longer enough.
    expect(isAutoAccepted({ kind: "ground-stretch", measured: { heightM: 0.5 } })).toBe(false);
  });

  it("a crossing at grade at the run's end node passes by rule; one mid-run is listed", () => {
    expect(isAutoAccepted({ kind: "ground-crossing", measured: { s: 0, lengthM: 300 } })).toBe(true);
    expect(isAutoAccepted({ kind: "ground-crossing", measured: { s: 299, lengthM: 300 } })).toBe(true);
    expect(isAutoAccepted({ kind: "ground-crossing", measured: { s: 2, lengthM: 300 } })).toBe(false);
  });
});

describe("地平 run の目標線は高架の下の地表を使わない（S6 PR 7a、N1 の案 1）", () => {
  it("a 100 m run at grade 7 m over the ground under the viaduct beyond it keeps to its own ground (920238350's type)", () => {
    // At grade x 0–100 (the chain starts there) on a 9.7 m mound, the viaduct after it over 2 m ground.
    const net = chain([
      [0, 100, atGrade],
      [100, 1000, viaduct],
    ]);
    const plan = planNetwork(net, new Set(), null, [], options);
    const mound = (lon: number, lat: number) => (xOf(lon, lat) <= 100 ? 9.7 : 2);
    const { ground, target } = groundTargetOf(plan, plan.runs.get("1")!, mound, 150);
    for (let k = 0; k < target.length; k++)
      expect(Math.abs(target[k] - ground[k]), `k ${k}`).toBeLessThanOrEqual(0.3);
  });
});

describe("同一面の 2 本の地平 run は 1 本の目標線（S6 PR 7a のレビュー C2）", () => {
  /** Two chains 8 m apart along y: viaduct x 0–500, at grade 500–620 (a short run), viaduct 620–1100. */
  function twin(): Network {
    const n: Network = { ways: new Map(), nodes: new Map() };
    const id = (x: number, y: number) => 20000 + Math.round(x) + (y > 0 ? 100000 : 0);
    let way = 1;
    for (const y of [0, 8]) {
      for (const [x0, x1, tags] of [
        [0, 500, viaduct],
        [500, 620, atGrade],
        [620, 1100, viaduct],
      ] as Array<[number, number, Record<string, string>]>) {
        const xs: number[] = [];
        for (let x = x0; x <= x1 + 1e-9; x += 20) xs.push(x);
        for (const x of xs) {
          const [lon, lat] = P.toLonLat(x, y);
          n.nodes.set(id(x, y), normalizeNode(id(x, y), lon, lat, {}));
        }
        n.ways.set(
          way++,
          normalizeWay(
            way,
            xs.map((x) => id(x, y)),
            tags,
          ),
        );
      }
    }
    return n;
  }
  // Each its own bumps: the DEM's ±0.6 m under one carriageway, a 1 m step under the other.
  const ground = (lon: number, lat: number) => {
    const [x, y] = P.toXY(lon, lat);
    const isNear = y < 4;
    if (isNear) return 3 + 0.6 * Math.sin(x / 9);
    return 3 + (x > 562 ? 1 : 0);
  };

  it("pools the two grounds: the targets of the two decks of one slab differ by 0.15 m at most, and stay within the window's ground", () => {
    const plan = planNetwork(twin(), new Set(), null, [], options);
    const atGradeRuns = [...plan.runs.values()].filter((r) => r.ground);
    expect(atGradeRuns).toHaveLength(2);
    const same = plan.pairs.filter((p) => p.relation === "same" && p.a === atGradeRuns[0].run.id);
    expect(same.length).toBeGreaterThan(10);
    const [a, b] = atGradeRuns.map((rp) => groundTargetOf(plan, rp, ground, 150));
    for (const p of same) {
      const ka = Math.round(p.sa / 5);
      const kb = Math.round(p.sb / 5);
      expect(Math.abs(a.target[ka] - b.target[kb]), `s ${p.sa}`).toBeLessThanOrEqual(0.15);
    }
    for (const t of [a, b]) {
      const lo = Math.min(2.4, ...t.ground);
      const hi = Math.max(4, ...t.ground);
      for (const z of t.target) {
        expect(z).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(z).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("holds a short run's line within its window's ground (no extrapolation past the samples)", () => {
    // 60 m on a 4 % slope with one end 1.5 m off: the line through 13 samples must not leave them.
    const stations = Float64Array.from({ length: 13 }, (_, k) => k * 5);
    const values = Float64Array.from(stations, (s) => 3 + 0.04 * s + (s === 60 ? -1.5 : 0));
    const target = groundTarget(values, stations, 150);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    for (const z of target) {
      expect(z).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(z).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});
