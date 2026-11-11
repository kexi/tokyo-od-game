import { describe, expect, it } from "vitest";
import { anchorsOf, BLOCK_MAX_VARIABLES, noisyStretches } from "../src/expressway/blocks";
import {
  BlockTooLargeError,
  type CompileResult,
  type CrossObject,
  type PlanOptions,
  planNetwork,
  solvePlan,
  solveRoutes,
} from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { evalProfile } from "../src/expressway/vertical";

// Blocks (P2.7-2, src/expressway/blocks.ts, `--partition blocks`): synthetic networks in a local
// plane around 芝公園, as tests/expresswayAlignment.test.ts builds them.
const plane = planeAt(139.75, 35.65);

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
const rampTags = { highway: "motorway_link", bridge: "yes", layer: "1" };

/** Rolling ground (a 2 m wave every 2.5 km) in the plane, optionally with a tall spike somewhere. */
function groundOf(spike?: { x: number; halfWidth: number; height: number }) {
  return (lon: number, lat: number) => {
    const [x, y] = plane.toXY(lon, lat);
    const base = 3 + 2 * Math.sin(x / 400);
    const isSpike = spike !== undefined && Math.abs(x - spike.x) <= spike.halfWidth && Math.abs(y) < 40;
    return isSpike ? base + spike.height : base;
  };
}
const ground = groundOf();

/** A street at ground level across the plane between two points. */
const street = (id: number, x0: number, y0: number, x1: number, y1: number): CrossObject => ({
  kind: "road",
  id,
  pts: [plane.toLonLat(x0, y0), plane.toLonLat(x1, y1)],
});

/** One main line of `length` metres going east, with nothing joined to it. */
function mainLine(length: number) {
  const pts = line(0, 0, length, 0, 100);
  return network([{ id: 10, pts, nodeIds: pts.map((_, i) => 1000 + i), tags: viaduct }]);
}

/**
 * A long main line with a ramp leaving it near each end (x = 1000 and x = length − 1000): two
 * junction clusters joined only by the main line.
 */
function twoJunctions(length = 10000) {
  const main = line(0, 0, length, 0, 100);
  const mainIds = main.map((_, i) => 1000 + i);
  const at = (x: number) => mainIds[Math.round(x / 100)];
  const rampA: Array<[number, number]> = [[1000, 0], [1050, -8], ...line(1100, -20, 1400, -90)];
  const rampB: Array<[number, number]> = [
    [length - 1000, 0],
    [length - 950, -8],
    ...line(length - 900, -20, length - 600, -90),
  ];
  return network([
    { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
    { id: 20, pts: rampA, nodeIds: [at(1000), ...rampA.slice(1).map((_, i) => 2000 + i)], tags: rampTags },
    {
      id: 30,
      pts: rampB,
      nodeIds: [at(length - 1000), ...rampB.slice(1).map((_, i) => 3000 + i)],
      tags: rampTags,
    },
  ]);
}

const BLOCKS: PlanOptions = { partition: "blocks" };

function build(net: Network, options: PlanOptions = BLOCKS, objects: CrossObject[] = [], g = ground) {
  const plan = planNetwork(net, new Set(), null, [], options);
  return { plan, result: solvePlan(plan, g, objects) };
}

const written = (r: CompileResult) => JSON.stringify({ chunks: r.chunks, runs: r.runs, closed: r.closed });
const sortedDiagnostics = (r: CompileResult) => r.diagnostics.map((d) => JSON.stringify(d)).sort();
const chunksOf = (r: CompileResult, run: string) => r.chunks.filter((c) => c.run === run);

/** Every station of a run's chunks in order (seams once): [s, z, bank, grade]. */
function stations(chunks: XwChunk[]): Array<{ s: number; z: number; bank: number; grade: number }> {
  const out: Array<{ s: number; z: number; bank: number; grade: number }> = [];
  for (const c of [...chunks].sort((a, b) => a.k - b.k)) {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      const s = c.st[i];
      const isSeam = out.length > 0 && Math.abs(out[out.length - 1].s - s) < 1e-9;
      if (isSeam) continue;
      out.push({ s, z: c.st[i + 3], bank: c.st[i + 4], grade: c.st[i + 6] });
    }
  }
  return out;
}

describe("固定点の位置（blocks.ts anchorsOf）", () => {
  it("cuts a long quiet main line at equal steps of at most 3 km, Q from its ends", () => {
    const plan = planNetwork(mainLine(8000), new Set(), null);
    const anchors = anchorsOf(plan, 1.5);
    expect(anchors.map((a) => a.run)).toEqual(["10", "10"]);
    const s = anchors.map((a) => a.s);
    // 8 km less Q = 300 m at each end leaves 7.4 km: three parts of ≤ 3 km, two anchors.
    expect(s[0]).toBeCloseTo(300 + 7400 / 3, -1);
    expect(s[1]).toBeCloseTo(300 + (2 * 7400) / 3, -1);
    const gaps = [s[0], s[1] - s[0], 8000 - s[1]];
    for (const g of gaps) expect(g).toBeLessThanOrEqual(3000 + 300);
  });

  it("keeps Q from every noisy point and puts none in a quiet stretch shorter than 2Q", () => {
    const plan = planNetwork(twoJunctions(10000), new Set(), null);
    const anchors = anchorsOf(plan, 1.5);
    expect(anchors.every((a) => a.run === "10")).toBe(true);
    const noisy = noisyStretches(plan).get("10")!;
    // The junctions at 1000 and 9000 m (and the nose pairs past them) are noisy.
    expect(noisy.some(([lo, hi]) => lo <= 1001 && hi >= 999)).toBe(true);
    for (const a of anchors) {
      const nearest = Math.min(...noisy.map(([lo, hi]) => (a.s < lo ? lo - a.s : a.s > hi ? a.s - hi : 0)));
      // Within a metre: the anchor goes to the nearest 1 m plan sample.
      expect(nearest).toBeGreaterThanOrEqual(a.q - 1);
    }
    // 1 km from each end to the junctions: 1000 m ≥ 2Q (600 m), so one anchor in each of those too.
    expect(anchors.filter((a) => a.s < 1000).length).toBe(1);
    expect(anchors.filter((a) => a.s > 9000).length).toBe(1);
    const short = planNetwork(mainLine(550), new Set(), null);
    expect(anchorsOf(short, 1.5)).toEqual([]);
  });

  it("puts none on ramps or short runs, and fewer as k grows; k below 1 is refused", () => {
    const plan = planNetwork(twoJunctions(10000), new Set(), null);
    expect(anchorsOf(plan, 1.5).some((a) => a.run !== "10")).toBe(false);
    const counts = [1, 2, 4, 12].map(
      (k) => anchorsOf(planNetwork(mainLine(4000), new Set(), null), k).length,
    );
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[counts.length - 1]).toBe(0);
    expect(() => anchorsOf(plan, 0.9)).toThrow(/at least 1/);
  });

  it("keeps Q from a structure's pinned range: none inside it or within Q of it", () => {
    const plan = planNetwork(mainLine(12000), new Set(), null);
    const rp = plan.runs.get("10")!;
    // A structure's part of the run as structures.ts gives it (only p0 and p1 matter here).
    (rp as { over: unknown }).over = { p0: 4000, p1: 7000 };
    const anchors = anchorsOf(plan, 1.5);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(a.s < 4000 - a.q + 1 || a.s > 7000 + a.q - 1).toBe(true);
  });

  it("keeps Q from a portal inside a below run (a tunnel going on into a cut)", () => {
    const pts = (x0: number, x1: number) => line(x0, 0, x1, 0, 100);
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
    const a = pts(0, 1000);
    const b = pts(1000, 5000);
    const c = pts(5000, 8000);
    const d = pts(8000, 9000);
    const under = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1", layer: "-1" };
    const startB = 1000 + a.length - 1;
    const startC = startB + b.length - 1;
    const startD = startC + c.length - 1;
    const net = network([
      { id: 10, pts: a, nodeIds: ids(1000, a.length), tags: viaduct },
      { id: 11, pts: b, nodeIds: ids(startB, b.length), tags: { ...under, tunnel: "yes" } },
      { id: 12, pts: c, nodeIds: ids(startC, c.length), tags: { ...under, cutting: "yes" } },
      { id: 13, pts: d, nodeIds: ids(startD, d.length), tags: viaduct },
    ]);
    // Not pruned: the below run joins the two viaducts, two components without it (pruneBelow).
    const plan = planNetwork(net, new Set(), null, [], { pruneBelow: false });
    const runBelow = [...plan.runs.values()].find((rp) => rp.below)!;
    expect(runBelow).toBeDefined();
    const anchors = anchorsOf(plan, 1.5).filter((x) => x.run === runBelow.run.id);
    expect(anchors.length).toBeGreaterThan(0);
    // The portal (tunnel into cut) is 4000 m into the below run.
    for (const x of anchors) expect(Math.abs(x.s - 4000)).toBeGreaterThanOrEqual(x.q - 1);
  });

  it("does not depend on the range built or on the order the ways come in", () => {
    const net = twoJunctions(10000);
    const all = anchorsOf(planNetwork(net, new Set(), null), 1.5);
    const box = { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
    const [lon, lat] = plane.toLonLat(1200, -60);
    const ramp = anchorsOf(
      planNetwork(net, new Set(), {
        ...box,
        minLon: lon - 1e-3,
        maxLon: lon + 1e-3,
        minLat: lat - 1e-3,
        maxLat: lat + 1e-3,
      }),
      1.5,
    );
    expect(ramp).toEqual(all);
    const reversed: Network = {
      ways: new Map([...net.ways].reverse()),
      nodes: new Map([...net.nodes].reverse()),
    };
    expect(anchorsOf(planNetwork(reversed, new Set(), null), 1.5)).toEqual(all);
  });
});

describe("固定点 0 なら一括解と同じ（I1、合成）", () => {
  it("blocks with no anchor write what components write, byte for byte", () => {
    const net = twoJunctions(3000);
    const objects = [street(1, 1500, -300, 1500, 300)];
    const joint = build(net, {}, objects).result;
    const none = build(net, { partition: "blocks", quietMin: 1e6 }, objects).result;
    expect(none.partition.anchors).toEqual([]);
    expect(written(none)).toBe(written(joint));
    expect(sortedDiagnostics(none)).toEqual(sortedDiagnostics(joint));
  });
});

describe("片の一貫性（I2）と縫い目（I3）", () => {
  // One main line, nothing joined to it, over rolling ground with streets under it.
  const net = mainLine(8000);
  const objects = [
    street(1, 1200, -300, 1200, 300),
    street(2, 4100, -300, 4100, 300),
    street(3, 6900, -300, 6900, 300),
  ];
  const { plan, result } = build(net, BLOCKS, objects);
  const part = plan.partition!;
  const pieces = part.piecesOf.get("10")!;

  it("cuts the run into three pieces, each its own block, and writes it as one run", () => {
    expect(pieces.length).toBe(3);
    expect(part.neededBlocks.length).toBe(3);
    expect(result.runs.map((r) => r.id)).toEqual(["10"]);
    expect(result.closed).toEqual([]);
  });

  it("I2: the pieces solved block by block are the route solution (1 mm, 1e-5 grade, 1e-4 bank)", () => {
    const [route] = solveRoutes(plan, ground, objects);
    expect(route.group).toEqual(["10"]);
    const rp = plan.runs.get("10")!;
    let worst = { z: 0, grade: 0, bank: 0 };
    for (const st of stations(chunksOf(result, "10"))) {
      let p = pieces[0];
      for (const q of pieces) if (q.a <= st.s) p = q;
      const v = evalProfile(route.profiles.get(p.id)!, st.s - p.a);
      const pr = part.pieces.runs.get(p.id)!;
      // The bank of the sample at or before s (as the chunk takes it), on the piece's samples.
      const base = rp.align.s[rp.i0];
      let i = pr.i0;
      while (i < pr.i1 && rp.align.s[i + 1] - base <= st.s) i++;
      const bank = route.banks.get(p.id)![i - pr.i0];
      worst = {
        z: Math.max(worst.z, Math.abs(v.z - st.z)),
        grade: Math.max(worst.grade, Math.abs(v.grade - st.grade)),
        bank: Math.max(worst.bank, Math.abs(bank - st.bank)),
      };
    }
    // The tiles round z to 1 mm, the grade to 1e-5 and the bank to 1e-4: half of that on top.
    expect(worst.z).toBeLessThanOrEqual(1e-3 + 5e-4);
    expect(worst.grade).toBeLessThanOrEqual(1e-5 + 5e-6);
    expect(worst.bank).toBeLessThanOrEqual(1e-4 + 5e-5);
  });

  it("I3: z, grade and bank meet exactly at every anchor, and a station stands on each", () => {
    expect(result.partition.joins.dz).toBeLessThan(1e-9);
    expect(result.partition.joins.dGrade).toBeLessThan(1e-12);
    expect(result.partition.joins.dBank).toBe(0);
    const at = stations(chunksOf(result, "10")).map((st) => st.s);
    for (const a of result.partition.anchors) expect(at.some((s) => Math.abs(s - a.s) < 0.01)).toBe(true);
  });

  it("I3: no chunk is cut at an anchor: the chunk ids and bounds are those of the run solved whole", () => {
    const whole = build(net, {}, objects).result;
    const bounds = (r: CompileResult) =>
      chunksOf(r, "10").map((c) => [c.id, c.st[0], c.st[c.st.length - STATION_STRIDE]]);
    expect(bounds(result)).toEqual(bounds(whole));
  });
});

describe("局所性（I4）・範囲（I5）・決定性（I6）・上限（I7）", () => {
  const net = twoJunctions(10000);
  const { plan, result } = build(net);
  const blockOf = (r: CompileResult, id: string) => r.partition.blocks.find((b) => b.id === id)!;

  it("I4: a street under one junction's ramp changes that block only, not the other's nor its ramp", () => {
    const part = plan.partition!;
    const blockA = part.pieces.componentOf.get("20")!;
    const blockB = part.pieces.componentOf.get("30")!;
    expect(blockA).not.toBe(blockB);
    // Under ramp A only (the main line is at y = 0), where it can still climb over the street.
    const moved = build(net, BLOCKS, [street(9, 1150, -70, 1150, -15)]).result;
    expect(moved.diagnostics.filter((d) => d.kind === "crossing_over_or_at_grade")).toEqual([]);
    expect(moved.partition.anchors).toEqual(result.partition.anchors);
    expect(blockOf(moved, blockA).canonical).not.toBe(blockOf(result, blockA).canonical);
    expect(blockOf(moved, blockB).canonical).toBe(blockOf(result, blockB).canonical);
    expect(JSON.stringify(chunksOf(moved, "30"))).toBe(JSON.stringify(chunksOf(result, "30")));
  });

  it("I5: a run shared by two ranges compiles to the same chunks whichever range is built", () => {
    const box = (x: number, y: number) => {
      const [lon, lat] = plane.toLonLat(x, y);
      return { minLon: lon - 5e-4, maxLon: lon + 5e-4, minLat: lat - 5e-4, maxLat: lat + 5e-4 };
    };
    const ramp = solvePlan(planNetwork(net, new Set(), box(1250, -60), [], BLOCKS), ground, []);
    const east = solvePlan(planNetwork(net, new Set(), box(9700, 0), [], BLOCKS), ground, []);
    expect(ramp.runs.map((r) => r.id)).toEqual(["20"]);
    expect(east.runs.map((r) => r.id)).toEqual(["10"]);
    expect(JSON.stringify(chunksOf(ramp, "20"))).toBe(JSON.stringify(chunksOf(result, "20")));
    expect(JSON.stringify(chunksOf(east, "10"))).toBe(JSON.stringify(chunksOf(result, "10")));
  });

  it("I6: compiling twice gives byte-identical output", () => {
    const again = build(twoJunctions(10000)).result;
    expect(written(again)).toBe(written(result));
    expect(JSON.stringify(again.diagnostics)).toBe(JSON.stringify(result.diagnostics));
    expect(JSON.stringify(again.partition)).toBe(JSON.stringify(result.partition));
  });

  it("I7: a block over the variable limit stops the build, naming the block and its runs", () => {
    expect(BLOCK_MAX_VARIABLES).toBe(20_000);
    const p = planNetwork(net, new Set(), null, [], BLOCKS);
    const blockA = p.partition!.pieces.componentOf.get("20")!;
    const run = () => solvePlan(p, ground, [], { maxBlockVariables: 50 });
    expect(run).toThrow(BlockTooLargeError);
    expect(run).toThrow(
      new RegExp(`block ${blockA.replace("#", "#")}: \\d+ variables > 50 \\(runs 10, 20\\)`),
    );
  });

  it("no piece id leaks into the chunks, the run summaries, the closures or the diagnostics", () => {
    const text = JSON.stringify({
      chunks: result.chunks,
      runs: result.runs,
      closed: result.closed,
      d: result.diagnostics,
    });
    expect(text).not.toMatch(/\d#\d/);
    expect(plan.partition!.pieces.runs.has("10#1")).toBe(true);
  });
});

describe("閉鎖は run 単位（片の 1 つが解けない run）", () => {
  // The main line's middle piece runs into a 300 m spike of ground no grade can get over; a ramp
  // leaves the main line's last piece, and a viaduct crosses over its first piece.
  const length = 8000;
  const main = line(0, 0, length, 0, 100);
  const mainIds = main.map((_, i) => 1000 + i);
  const rampPts: Array<[number, number]> = [[7000, 0], [7050, -8], ...line(7100, -20, 7400, -90)];
  const cross = line(1000, -800, 1000, 800, 100);
  const net = network([
    { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
    {
      id: 20,
      pts: rampPts,
      nodeIds: [mainIds[70], ...rampPts.slice(1).map((_, i) => 2000 + i)],
      tags: rampTags,
    },
    {
      id: 40,
      pts: cross,
      nodeIds: cross.map((_, i) => 4000 + i),
      tags: { ...viaduct, layer: "2", ref: "C2" },
    },
  ]);
  const spiky = groundOf({ x: 4000, halfWidth: 30, height: 300 });
  const { plan, result } = build(net, BLOCKS, [], spiky);

  it("closes the main line once (vertical_unsolved, its own id), its ramp as parent_unsolved, and keeps the crossing viaduct", () => {
    expect(plan.partition!.piecesOf.get("10")!.length).toBeGreaterThan(1);
    const unsolved = result.diagnostics.filter((d) => d.kind === "vertical_unsolved");
    expect(unsolved.map((d) => d.run)).toEqual(["10"]);
    expect(unsolved[0].detail).toMatch(/^\[\d+–\d+ m\] /);
    expect(result.diagnostics.find((d) => d.run === "20" && d.kind === "parent_unsolved")?.detail).toBe(
      "parent 10",
    );
    expect(result.closed.map((c) => [c.run, c.reason])).toEqual([
      ["10", "vertical_unsolved"],
      ["20", "parent_unsolved"],
    ]);
    expect(result.runs.map((r) => r.id)).toEqual(["40"]);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/\d#\d/);
  });
});

describe("診断は run と run 距離で書く（片の ID も片内の距離も出さない）", () => {
  // The main line's middle piece cannot get over a 300 m spike of ground at x = 4000, and a viaduct
  // crosses over it just past the spike.
  const main = line(0, 0, 8000, 0, 100);
  const cross = line(4060, -800, 4060, 800, 100);
  const net = network([
    { id: 10, pts: main, nodeIds: main.map((_, i) => 1000 + i), tags: viaduct },
    {
      id: 40,
      pts: cross,
      nodeIds: cross.map((_, i) => 4000 + i),
      tags: { ...viaduct, layer: "2", ref: "C2" },
    },
  ]);
  const spiky = groundOf({ x: 4000, halfWidth: 30, height: 300 });
  const { plan, result } = build(net, BLOCKS, [], spiky);

  it("names the run, not the piece, in every diagnostic, and gives run distances in its texts", () => {
    expect(plan.partition!.piecesOf.get("10")!.length).toBeGreaterThan(1);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/\d#\d/);
    const unsolved = result.diagnostics.find((d) => d.run === "10" && d.kind === "vertical_unsolved")!;
    // The spike is at 4000 m of the run, inside the middle piece: its texts say so on the run.
    const at = [...unsolved.detail.matchAll(/at (\d+) m/g)].map((m) => Number(m[1]));
    expect(at.some((s) => Math.abs(s - 4000) < 200)).toBe(true);
    const piece = plan.partition!.piecesOf.get("10")!.find((p) => p.a < 4000 && p.b > 4000)!;
    expect(unsolved.detail).toContain(`[${piece.a.toFixed(0)}–${piece.b.toFixed(0)} m]`);
  });
});

describe("片勾配は固定点で両側とも路線解の値（曲線の本線）", () => {
  // A main line winding east in S curves of R = 300 m at 80 km/h (bank e = V²/127R − f > 0).
  function winding() {
    const pts: Array<[number, number]> = [[0, 0]];
    let x = 0;
    let y = 0;
    let heading = 0;
    const R = 300;
    const step = 25;
    for (let k = 0; k < 360; k++) {
      // Half-waves of 100 m: the bank keeps changing, so a piece's end left free would not meet the
      // next piece's start by itself.
      const turn = Math.floor(k / 4) % 2 === 0 ? 1 : -1;
      heading += (turn * step) / R;
      x += step * Math.cos(heading);
      y += step * Math.sin(heading);
      pts.push([x, y]);
    }
    return network([
      { id: 10, pts, nodeIds: pts.map((_, i) => 1000 + i), tags: { ...viaduct, maxspeed: "80" } },
    ]);
  }
  const { plan, result } = build(winding());

  it("banks the curves, and the two pieces at an anchor hold the same bank (I3)", () => {
    expect(result.partition.anchors.length).toBeGreaterThan(0);
    const banks = stations(chunksOf(result, "10")).map((st) => Math.abs(st.bank));
    expect(Math.max(...banks)).toBeGreaterThan(0.005);
    expect(result.partition.joins.dBank).toBe(0);
  });

  it("I2 on a curve: the banks are the route solution's", () => {
    const [route] = solveRoutes(plan, ground, []);
    const part = plan.partition!;
    const pieces = part.piecesOf.get("10")!;
    const rp = plan.runs.get("10")!;
    const base = rp.align.s[rp.i0];
    let worst = 0;
    for (const st of stations(chunksOf(result, "10"))) {
      let p = pieces[0];
      for (const q of pieces) if (q.a <= st.s) p = q;
      const pr = part.pieces.runs.get(p.id)!;
      let i = pr.i0;
      while (i < pr.i1 && rp.align.s[i + 1] - base <= st.s) i++;
      // The station's s is rounded to 1 cm in the tiles: it may stand on the sample either side.
      const bank = route.banks.get(p.id)!;
      const near = [i - 1, i, i + 1].filter((k) => k >= pr.i0 && k <= pr.i1);
      worst = Math.max(worst, Math.min(...near.map((k) => Math.abs(bank[k - pr.i0] - st.bank))));
    }
    expect(worst).toBeLessThanOrEqual(1e-4 + 5e-5);
  });
});

describe("閉鎖の連鎖は block をまたぐ", () => {
  // The spike closes the main line's last piece; a ramp leaves an earlier piece (another block).
  const main = line(0, 0, 8000, 0, 100);
  const mainIds = main.map((_, i) => 1000 + i);
  const rampPts: Array<[number, number]> = [[1500, 0], [1550, -8], ...line(1600, -20, 1900, -90)];
  const crossPts = line(2500, -800, 2500, 800, 100);
  const net = network([
    { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
    {
      id: 20,
      pts: rampPts,
      nodeIds: [mainIds[15], ...rampPts.slice(1).map((_, i) => 2000 + i)],
      tags: rampTags,
    },
    {
      id: 40,
      pts: crossPts,
      nodeIds: crossPts.map((_, i) => 4000 + i),
      tags: { ...viaduct, layer: "2", ref: "C2" },
    },
  ]);
  const spiky = groundOf({ x: 7000, halfWidth: 30, height: 300 });
  const full = build(net, BLOCKS, [], spiky);
  const box = (x: number, y: number) => {
    const [lon, lat] = plane.toLonLat(x, y);
    return { minLon: lon - 5e-4, maxLon: lon + 5e-4, minLat: lat - 5e-4, maxLat: lat + 5e-4 };
  };

  it("closes a ramp on a solved piece of a main line that another block closed", () => {
    const part = full.plan.partition!;
    const rampBlock = part.pieces.componentOf.get("20")!;
    const failing = part.piecesOf.get("10")!.find((p) => p.a < 7000 && p.b > 7000)!;
    expect(part.pieces.componentOf.get(failing.id)).not.toBe(rampBlock);
    expect(full.result.closed.map((c) => [c.run, c.reason])).toEqual([
      ["10", "vertical_unsolved"],
      ["20", "parent_unsolved"],
    ]);
    expect(full.result.runs.map((r) => r.id)).toEqual(["40"]);
  });

  it("known limit (to settle before S5): built for the ramp alone, the main line's failing piece is not solved and the ramp stays", () => {
    // The ramp's block holds only the main line's first piece; the block that fails is not needed
    // for this range, so nothing closes the main line and the ramp is written, where a component's
    // build closes it. Proposed for S5: every piece of a junction parent's run, and of a run under
    // a crossing, in the needed blocks.
    const ramp = solvePlan(planNetwork(net, new Set(), box(1750, -60), [], BLOCKS), spiky, []);
    expect(ramp.runs.map((r) => r.id)).toEqual(["20"]);
    const joint = solvePlan(planNetwork(net, new Set(), box(1750, -60), [], {}), spiky, []);
    expect(joint.runs).toEqual([]);
  });

  it("records a crossing over the main line from the block that solved the piece under it, whatever the range (T8)", () => {
    // The main line is closed by its last piece, in another block: the viaduct over its first piece
    // records the crossing (its own block solved the piece under it) in every range alike.
    const cross = solvePlan(planNetwork(net, new Set(), box(2500, 600), [], BLOCKS), spiky, []);
    expect(cross.runs.map((r) => r.id)).toEqual(["40"]);
    const of = (r: CompileResult) => JSON.stringify(chunksOf(r, "40"));
    expect(of(cross)).toBe(of(full.result));
    expect(chunksOf(full.result, "40").some((c) => c.cross.length > 0)).toBe(true);
  });
});

describe("路線解は seam の組で（トンネルの前後の高架まで）", () => {
  // A viaduct, a 7 km tunnel (cut at anchors) and a viaduct, end to end in one chain (seams).
  const pts = (x0: number, x1: number) => line(x0, 0, x1, 0, 100);
  const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
  const a = pts(0, 1000);
  const b = pts(1000, 8000);
  const c = pts(8000, 9000);
  const under = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1", layer: "-1", tunnel: "yes" };
  const startB = 1000 + a.length - 1;
  const startC = startB + b.length - 1;
  const net = network([
    { id: 10, pts: a, nodeIds: ids(1000, a.length), tags: viaduct },
    { id: 11, pts: b, nodeIds: ids(startB, b.length), tags: under },
    { id: 12, pts: c, nodeIds: ids(startC, c.length), tags: viaduct },
  ]);
  const options: PlanOptions = { partition: "blocks", pruneBelow: false };
  const all = planNetwork(net, new Set(), null, [], options);
  const tunnel = [...all.runs.values()].find((rp) => rp.below)!;
  const west = [...all.runs.values()].find((rp) => !rp.below && rp.align.s[rp.i0] === 0)!;
  const east = [...all.runs.values()].find((rp) => !rp.below && rp !== west)!;
  // A street under the east viaduct by its ground end: a diagnostic of that viaduct's setup.
  const objects = [street(1, 8950, -300, 8950, 300)];
  const full = solvePlan(all, ground, objects);

  it("puts both viaducts in the tunnel's route solution and in the needed runs of a range holding one", () => {
    expect(all.partition!.piecesOf.get(tunnel.run.id)!.length).toBeGreaterThan(1);
    expect(all.partition!.routeGroups).toEqual([[west.run.id, tunnel.run.id, east.run.id].sort()]);
    const [lon, lat] = plane.toLonLat(300, 0);
    const box = { minLon: lon - 5e-4, maxLon: lon + 5e-4, minLat: lat - 5e-4, maxLat: lat + 5e-4 };
    const plan = planNetwork(net, new Set(), box, [], options);
    expect(plan.needed).toContain(east.run.id);
    const result = solvePlan(plan, ground, objects);
    expect(result.runs.map((r) => r.id)).toEqual([west.run.id]);
    // The east viaduct is set up for the route solution only: its diagnostics are not the build's.
    expect(full.diagnostics.some((d) => d.run === east.run.id)).toBe(true);
    expect(result.diagnostics.some((d) => d.run === east.run.id)).toBe(false);
    const of = (r: CompileResult) => JSON.stringify(chunksOf(r, west.run.id));
    expect(of(result)).toBe(of(full));
  });
});

describe("段・速度の区間・ランプ（固定点の両側で違うとき）", () => {
  it("takes the steps of the piece that went furthest down, not the first piece's", () => {
    // A 150 m hump of ground in the middle of the run only: the first piece keeps the standard step.
    const net = mainLine(8000);
    const hump = (lon: number, lat: number) => {
      const [x] = plane.toXY(lon, lat);
      const d = Math.abs(x - 4000);
      return 3 + (d < 800 ? 150 * (1 - d / 800) : 0);
    };
    const { plan, result } = build(net, BLOCKS, [], hump);
    expect(plan.partition!.piecesOf.get("10")!.length).toBeGreaterThan(2);
    const run = result.runs.find((r) => r.id === "10")!;
    expect(run.steps[0]).not.toBe("standard");
  });

  it("keeps Q from a change of design speed (a zone boundary)", () => {
    // 2.5 km at 80 km/h, then 2.5 km at 60: without the boundary the anchor would be at its middle.
    const pts = line(0, 0, 5000, 0, 100);
    const half = pts.length >> 1;
    const ids = pts.map((_, i) => 1000 + i);
    const net = network([
      {
        id: 10,
        pts: pts.slice(0, half + 1),
        nodeIds: ids.slice(0, half + 1),
        tags: { ...viaduct, maxspeed: "80" },
      },
      { id: 11, pts: pts.slice(half), nodeIds: ids.slice(half), tags: viaduct },
    ]);
    const plan = planNetwork(net, new Set(), null);
    const rp = [...plan.runs.values()][0];
    expect(rp.zones.length).toBeGreaterThan(1);
    const boundary = rp.zones[0].to;
    for (const a of anchorsOf(plan, 1.5)) expect(Math.abs(a.s - boundary)).toBeGreaterThanOrEqual(a.q - 1);
  });

  it("puts no anchor on a long ramp", () => {
    const pts = line(0, 0, 4000, 0, 100);
    const net = network([{ id: 20, pts, nodeIds: pts.map((_, i) => 1000 + i), tags: rampTags }]);
    const plan = planNetwork(net, new Set(), null);
    expect(plan.runs.get("20")?.cls).toBe("ramp");
    expect(anchorsOf(plan, 1)).toEqual([]);
  });
});
