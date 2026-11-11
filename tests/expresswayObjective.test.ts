import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkChunkJoin,
  checkClearance,
  checkCover,
  checkGrade,
  checkJunction,
  checkSurface,
  checkVerticalCurves,
} from "../src/expressway/checks";
import {
  type CrossObject,
  type GroundSampler,
  OBJECTIVE_V1,
  OBJECTIVE_V2,
  type Objective,
  planNetwork,
  runTargets,
  solvePlan,
} from "../src/expressway/compile";
import { TUNNEL_DEPTH_M } from "../src/expressway/below";
import { envelope } from "../src/expressway/designGround";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { reversals, trackingOf } from "../src/expressway/report";
import { type RunInput, solveJoint } from "../src/expressway/vertical";

// Objective v2 (P2.7-3, S3) on synthetic networks round 芝公園, built as tests/expresswayAlignment
// and tests/expresswayBelow build theirs: the deck does not take the ground's short waves, still
// takes its long ones, and keeps every statute and assumed bound v1 keeps.
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

function line(x0: number, y0: number, x1: number, y1: number, step = 50): Array<[number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
}

const viaduct = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const tunnel = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };

/** One straight main line going east from x0 to x1, its nodes 50 m apart. */
function mainLine(
  x0: number,
  x1: number,
  tags: Record<string, string> = viaduct,
  id = 10,
  first = 1000,
  step = 50,
) {
  const pts = line(x0, 0, x1, 0, step);
  return { id, pts, nodeIds: pts.map((_, i) => first + i), tags };
}

/** A ground sampler of x along the line (the plane's east). */
const along =
  (f: (x: number) => number): GroundSampler =>
  (lon, lat) =>
    f(plane.toXY(lon, lat)[0]);

function build(net: Network, ground: GroundSampler, objective: Objective, objects: CrossObject[] = []) {
  const plan = planNetwork(net, new Set(), null);
  return solvePlan(plan, ground, objects, { objective });
}

const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  for (const list of out.values()) list.sort((a, b) => a.k - b.k);
  return out;
};

/** T1・T2・T4 and the joins of every chunk (what the data test asks of a viaduct). */
function problemsOf(result: ReturnType<typeof solvePlan>): string[] {
  const runs = new Map(result.runs.map((r) => [r.id, r]));
  const out: string[] = [];
  for (const c of result.chunks) {
    const run = runs.get(c.run)!;
    out.push(...checkGrade(c, run), ...checkVerticalCurves(c), ...checkSurface(c), ...checkClearance(c, run));
  }
  for (const list of byRun(result.chunks).values())
    for (let i = 1; i < list.length; i++) out.push(...checkChunkJoin(list[i - 1], list[i]));
  return out;
}

/**
 * The RMS of run 10's surface less its ±250 m mean (by distance, over its stations) at the stations
 * 800 m or more from both ends: trackingOf's short waves without the climbs from the ground ends.
 */
function innerShortWave(result: ReturnType<typeof solvePlan>): number {
  const pts = byRun(result.chunks)
    .get("10")!
    .flatMap((c) =>
      Array.from({ length: c.st.length / STATION_STRIDE }, (_, k) => c.st.slice(k * 7, k * 7 + 4)),
    );
  const length = pts[pts.length - 1][0];
  let sq = 0;
  let n = 0;
  for (const [s, , , z] of pts) {
    const isInner = s >= 800 && s <= length - 800;
    if (!isInner) continue;
    const near = pts.filter((p) => Math.abs(p[0] - s) <= 250);
    const mean = near.reduce((a, p) => a + p[3], 0) / near.length;
    sq += (z - mean) ** 2;
    n++;
  }
  return Math.sqrt(sq / n);
}

/** The grades of a run every station (chunks joined). */
const gradesOf = (chunks: XwChunk[]) =>
  chunks.flatMap((c, i) =>
    Array.from({ length: c.st.length / STATION_STRIDE }, (_, k) => c.st[k * STATION_STRIDE + 6]).slice(
      i === 0 ? 0 : 1,
    ),
  );

describe("目的 v2: 短い波を追わない（合成の縦断、P2.7-3）", () => {
  // 3 km over a ground of T.P. 3 m with a 200 m wave of 1 m (the DEM's roughness under a viaduct).
  const rough = along((x) => 3 + Math.sin((2 * Math.PI * x) / 200));
  const net = network([mainLine(0, 3000)]);
  const v1 = build(net, rough, OBJECTIVE_V1);
  const v2 = build(net, rough, OBJECTIVE_V2);

  it("v2 reverses its grade less and has smaller short waves than v1, both within every bound", () => {
    const t1 = trackingOf(v1.chunks, v1.runs);
    const t2 = trackingOf(v2.chunks, v2.runs);
    expect(t1.runs).toBe(1);
    expect(t2.runs).toBe(1);
    expect(t2.reversalsPerKm!).toBeLessThan(t1.reversalsPerKm!);
    // Between the climbs: trackingOf's 500 m average still takes in the knees where the climbs from
    // the ground ends level off (sharper with v2's L1), which outweigh the bumps on a 3 km run.
    expect(innerShortWave(v2)).toBeLessThan(innerShortWave(v1) / 2);
    expect(problemsOf(v1)).toEqual([]);
    // T4: the floor over open ground (the ground's peaks + 6.7 m) holds on every station.
    expect(problemsOf(v2)).toEqual([]);
    expect(v2.closed).toEqual([]);
    expect(v2.stats.unconverged).toBe(0);
  });

  it("v2 does not reverse at all over the 2.4 km between the climbs (the bumps are shorter than 2 × reach)", () => {
    const grades = gradesOf(byRun(v2.chunks).get("10")!);
    const inner = grades.slice(Math.round(grades.length * 0.2), Math.round(grades.length * 0.8));
    expect(reversals(inner)).toBe(0);
  });
});

describe("目的 v2: 長い波には沿う（合成の縦断、P2.7-3）", () => {
  // 6 km over a 1.5 km wave of 5 m: a hill every 1.5 km, as a viaduct would follow them.
  const wave = along((x) => 10 + 5 * Math.sin((2 * Math.PI * x) / 1500));
  const net = network([mainLine(0, 6000)]);
  const v2 = build(net, wave, OBJECTIVE_V2);

  it("rises and falls with the long wave (correlation over 0.9), within every bound", () => {
    const t = trackingOf(v2.chunks, v2.runs);
    expect(t.correlation!).toBeGreaterThan(0.9);
    // Not metre for metre: the envelope flattens the crests over ±150 m and the target is weak.
    // At W_GRADE_CHANGE 1.5 it rises about half a metre per metre of the 1.5 km wave (0.48 measured).
    expect(t.slope!).toBeGreaterThan(0.4);
    expect(problemsOf(v2)).toEqual([]);
    expect(v2.closed).toEqual([]);
  });
});

describe("目的 v2: 7 m の段の上の交差（T9 の形、P2.7-3）", () => {
  // Flat at T.P. 3 m, a 7 m step up at x = 1,500 (over 40 m), a street on the upper ground at 1,650.
  const step = along((x) => (x < 1480 ? 3 : x > 1520 ? 10 : 3 + ((x - 1480) / 40) * 7));
  const net = network([mainLine(0, 3000)]);
  const street: CrossObject = {
    kind: "road",
    id: 1,
    pts: [plane.toLonLat(1650, -200), plane.toLonLat(1650, 200)],
  };
  const v2 = build(net, step, OBJECTIVE_V2, [street]);

  it("clears the street (桁下, T4) and keeps the grades and vertical curves within 第20・22条 (T1・T2)", () => {
    const main = byRun(v2.chunks).get("10")!;
    expect(main.some((c) => c.cross.length > 0)).toBe(true);
    expect(problemsOf(v2)).toEqual([]);
    expect(v2.closed).toEqual([]);
    expect(v2.stats.unconverged).toBe(0);
  });
});

/**
 * A viaduct to x = 1,000, a 2 km tunnel under a hill (flanks of 3.4 %, a top at T.P. 20 m with a
 * 200 m ripple of 1.5 m), and the road on at grade from 3,000.
 */
const hill = along((x) => {
  if (x <= 1000) return 3;
  if (x <= 1500) return 3 + ((x - 1000) / 500) * 17;
  if (x <= 2500) return 20 + 1.5 * Math.sin((2 * Math.PI * (x - 1500)) / 200);
  if (x <= 3000) return 20 - ((x - 2500) / 500) * 17;
  return 3;
});
const tunnelNet = () =>
  network([
    mainLine(0, 1000, viaduct, 1, 1000),
    mainLine(1000, 3000, tunnel, 2, 1020),
    mainLine(3000, 3500, atGrade, 3, 1060),
  ]);

describe("目的 v2: 起伏のある丘の下のトンネル（合成の縦断、P2.7-3）", () => {
  const net = tunnelNet();
  const v1 = build(net, hill, OBJECTIVE_V1);
  const v2 = build(net, hill, OBJECTIVE_V2);
  const belowOf = (r: typeof v1) => {
    const runs = byRun(r.chunks);
    const id = r.runs.find((x) => runs.get(x.id)!.every((c) => c.structure !== "viaduct"))!.id;
    return { run: r.runs.find((x) => x.id === id)!, chunks: runs.get(id)! };
  };

  it("v2's road under the hill reverses its grade no more than v1's, and keeps the box and cover (T12)", () => {
    const b1 = belowOf(v1);
    const b2 = belowOf(v2);
    expect(reversals(gradesOf(b2.chunks))).toBeLessThanOrEqual(reversals(gradesOf(b1.chunks)));
    expect(v2.closed).toEqual([]);
    const first = b2.chunks[0].st;
    const last = b2.chunks[b2.chunks.length - 1].st;
    const ends = { z0: first[3], z1: last[last.length - STATION_STRIDE + 3] };
    for (const c of b2.chunks) expect(checkCover(c, b2.run, ends)).toEqual([]);
    for (const c of b2.chunks) {
      expect(checkGrade(c, b2.run)).toEqual([]);
      expect(checkVerticalCurves(c)).toEqual([]);
    }
    expect(v2.stats.unconverged).toBe(0);
  });
});

describe("目的 v2 の目標の位置（setupRun・setupBelow、P2.7-3）", () => {
  // Every run goes east along y = 0: under the hill the viaduct "1" from x = 0 and the below run
  // "2" from x = 1,000; over the rough ground of the first test the 3 km viaduct "10" from x = 0.
  const net = tunnelNet();
  const roughGround = (x: number) => 3 + Math.sin((2 * Math.PI * x) / 200);
  const roughPlan = planNetwork(network([mainLine(0, 3000)]), new Set(), null);
  const plan = planNetwork(net, new Set(), null);
  const at = (x: number) => hill(...plane.toLonLat(x, 0));
  /**
   * The ground the setups read on the 5 m grid: the highest over ±2.5 m (the rough viaduct, x
   * 0–3,000), the lowest (below, x 1,000–3,000), each kept on its run as setupRun's poseAt keeps s.
   */
  const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
  const peak = (x: number) =>
    Math.max(...[-2.5, -1.25, 0, 1.25, 2.5].map((d) => roughGround(clamp(x + d, 0, 3000))));
  const low = (x: number) => Math.min(...[-2.5, 0, 2.5].map((d) => at(clamp(x + d, 1000, 3000))));
  const gridOf = (x0: number, n: number, f: (x: number) => number) =>
    Float64Array.from({ length: n }, (_, k) => f(x0 + 5 * k));
  const v2 = runTargets(plan, hill, [], OBJECTIVE_V2);
  const v1 = runTargets(plan, hill, [], OBJECTIVE_V1);
  const worst = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0, to = a.length) => {
    let w = 0;
    for (let k = from; k < to; k++) w = Math.max(w, Math.abs(a[k] - b[k]));
    return w;
  };

  it("over a viaduct: the upper envelope of the peaks (±150 m) + 6.5 m + the girder, v1 the mean ground", () => {
    const rough = along(roughGround);
    const { stations, target } = runTargets(roughPlan, rough, [], OBJECTIVE_V2).get("10")!;
    const n = stations.length - 1; // the last station is the run's end, not on the 5 m grid
    const expected = envelope(gridOf(0, stations.length, peak), OBJECTIVE_V2.reachM.viaduct, "upper").map(
      (e) => e + 6.5 + 2.2,
    );
    expect(worst(target, expected, 0, n)).toBeLessThan(0.02);
    expect(
      worst(runTargets(roughPlan, rough, [], OBJECTIVE_V1).get("10")!.target, expected, 0, n),
    ).toBeGreaterThan(0.5);
  });

  it("under the hill: the lower envelope of the lowest ground (±300 m) less the tunnel's depth", () => {
    const { stations, target } = v2.get("2")!;
    const n = stations.length - 1;
    const expected = envelope(gridOf(1000, stations.length, low), OBJECTIVE_V2.reachM.below, "lower").map(
      (e) => e - TUNNEL_DEPTH_M,
    );
    expect(worst(target, expected, 0, n)).toBeLessThan(0.02);
    // Not on the upper envelope, nor v1's mean: both stand over a metre higher under the ripple.
    const upper = envelope(gridOf(1000, stations.length, low), OBJECTIVE_V2.reachM.below, "upper");
    expect(
      worst(
        upper.map((e) => e - TUNNEL_DEPTH_M),
        expected,
        0,
        n,
      ),
    ).toBeGreaterThan(1);
    expect(worst(v1.get("2")!.target, expected, 0, n)).toBeGreaterThan(1);
  });

  it("v2's road under the hill stands nearer v2's target than v1's road does", () => {
    const target = v2.get("2")!.target;
    const off = (r: ReturnType<typeof solvePlan>) => {
      const pts = byRun(r.chunks)
        .get("2")!
        .flatMap((c) =>
          Array.from({ length: c.st.length / STATION_STRIDE }, (_, k) => c.st.slice(k * 7, k * 7 + 4)),
        )
        .filter(([s]) => s >= 800 && s <= 1200);
      return Math.max(...pts.map(([s, , , z]) => Math.abs(z - target[Math.round(s / 5)])));
    };
    // Not on it: the target is weak (W_TARGET) next to the L1 rows, which keep the road straight.
    expect(off(build(net, hill, OBJECTIVE_V2))).toBeLessThan(off(build(net, hill, OBJECTIVE_V1)) - 0.3);
  });
});

describe("目的 v2: 分合流つきの本線（合成の縦断、P2.7-3）", () => {
  // 2 km going east with a ramp leaving at x = 800 and a street under the ramp, over a rough ground.
  const main = line(0, 0, 2000, 0);
  const mainIds = main.map((_, i) => 1000 + i);
  const rampPts: Array<[number, number]> = [[800, 0], ...line(850, -8, 1150, -60)];
  const rampIds = [mainIds[16], ...rampPts.slice(1).map((_, i) => 2000 + i)];
  const net = network([
    { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
    { id: 20, pts: rampPts, nodeIds: rampIds, tags: { highway: "motorway_link", bridge: "yes", layer: "1" } },
  ]);
  const rough = along((x) => 3 + Math.sin((2 * Math.PI * x) / 200));
  const street: CrossObject = {
    kind: "road",
    id: 1,
    pts: [plane.toLonLat(1200, -300), plane.toLonLat(1200, 300)],
  };
  const v2 = build(net, rough, OBJECTIVE_V2, [street]);

  it("solves the ramp, which leaves the main line at its height and grade (C¹, T3)", () => {
    const chunks = byRun(v2.chunks);
    expect([...chunks.keys()].sort()).toEqual(["10", "20"]);
    const ramp = v2.runs.find((r) => r.id === "20")!;
    expect(checkJunction(chunks.get("20")![0], true, ramp.start.grade!, chunks.get("10")!)).toEqual([]);
    expect(problemsOf(v2)).toEqual([]);
    expect(v2.closed).toEqual([]);
  });
});

describe("勾配変化の L1 を掛けない所（vertical.ts、P2.7-3）", () => {
  /** A run of `length` m at V60 between two ground ends at 0 m, aiming at a bumpy target. */
  const runOf = (length: number): RunInput => {
    const stations = Float64Array.from({ length: Math.round(length / 5) + 1 }, (_, k) => k * 5);
    return {
      id: "r",
      length,
      zones: [{ from: 0, to: length, V: 60 }],
      special: false,
      stations,
      target: stations.map((s) => 8 + Math.sin(s / 30)),
      lower: stations.map(() => -Infinity),
      upper: stations.map(() => Infinity),
      start: { z: 0, grade: 0 },
      end: { z: 0, grade: 0 },
    };
  };
  const knots = (input: RunInput) => solveJoint([input], []).profiles.get("r")!;

  it("bends a long run's profile (the rows are there)", () => {
    const plain = knots(runOf(1200));
    const weighed = knots({ ...runOf(1200), gradeChange: 1 });
    const moved = Math.max(...plain.z.map((z, j) => Math.abs(z - weighed.z[j])));
    expect(moved).toBeGreaterThan(0.01);
  });

  it("leaves a short run (its curvature held at 0) and a run held at a profile as they were", () => {
    const short = runOf(120);
    expect(knots({ ...short, gradeChange: 1 })).toEqual(knots(short));
    const held = knots(runOf(1200));
    expect(knots({ ...runOf(1200), pinned: held, gradeChange: 1 })).toEqual(
      knots({ ...runOf(1200), pinned: held }),
    );
  });

  it("puts a row on every arc but those between two knots a structure fixes", () => {
    // 1,200 m at V60: 24 arcs of 50 m; a structure's exact stretch over 400–800 m fixes knots 8–16,
    // so the 8 arcs between them get no row and the other 16 one each.
    const pins = [
      { from: 400, to: 800, exact: [400, 800] as [number, number], at: () => ({ z: 8, grade: 0 }) },
    ];
    const rows = (input: RunInput) => solveJoint([input], []).rows;
    expect(rows({ ...runOf(1200), pins, gradeChange: 1 }) - rows({ ...runOf(1200), pins })).toBe(16);
    expect(rows({ ...runOf(1200), gradeChange: 1 }) - rows(runOf(1200))).toBe(24);
  });

  it("weighs the target by targetScale (and by W_TARGET itself without it)", () => {
    const plain = knots(runOf(1200));
    expect(knots({ ...runOf(1200), targetScale: 1 })).toEqual(plain);
    const half = knots({ ...runOf(1200), targetScale: 0.5 });
    expect(Math.max(...plain.z.map((z, j) => Math.abs(z - half.z[j])))).toBeGreaterThan(1e-3);
  });
});

describe("I1: v1 は変わらない（P2.7-3）", () => {
  // Three synthetic networks, their chunks' SHA-256 computed on origin/main (19968b3) before v2 was
  // added (knowledge/expressway-generation.md「P2.7-3」): tests/expresswayAlignment's mainAndRamp
  // with a deck over it, over a rough ground and a street (the viaducts' setup); the viaduct, the
  // tunnel under the hill and the road at grade above (setupBelow); and an 8 km main line cut into
  // pieces at anchors over a rolling ground with a 200 m wave (blocks: the route solution and the
  // pieces' setups).
  const main = line(0, 0, 2000, 0);
  const mainIds = main.map((_, i) => 1000 + i);
  const rampPts: Array<[number, number]> = [[800, 0], ...line(850, -8, 1150, -60)];
  const rampIds = [mainIds[16], ...rampPts.slice(1).map((_, i) => 2000 + i)];
  const other = line(2000, 30, 0, 30);
  const net = network([
    { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
    { id: 20, pts: rampPts, nodeIds: rampIds, tags: { highway: "motorway_link", bridge: "yes", layer: "1" } },
    { id: 30, pts: other, nodeIds: other.map((_, i) => 3000 + i), tags: { ...viaduct, layer: "2" } },
  ]);
  const rough = along((x) => 3 + Math.sin((2 * Math.PI * x) / 200) + 0.3 * Math.sin(x / 13));
  const street: CrossObject = {
    kind: "road",
    id: 1,
    pts: [plane.toLonLat(1200, -300), plane.toLonLat(1200, 300)],
  };
  const hashOf = (r: ReturnType<typeof solvePlan>) =>
    createHash("sha256")
      .update(
        JSON.stringify({ chunks: r.chunks, runs: r.runs, diagnostics: r.diagnostics, closed: r.closed }),
      )
      .digest("hex");

  it("v1 given or not is the same build, byte for byte, as before this change", () => {
    const plan = planNetwork(net, new Set(), null);
    const plain = solvePlan(plan, rough, [street]);
    const given = solvePlan(planNetwork(net, new Set(), null), rough, [street], { objective: OBJECTIVE_V1 });
    expect(hashOf(given)).toBe(hashOf(plain));
    expect(hashOf(plain)).toBe(I1_SHA256);
  });

  it("the tunnel under the hill: v1 as before this change", () => {
    expect(hashOf(solvePlan(planNetwork(tunnelNet(), new Set(), null), hill, []))).toBe(I1_TUNNEL_SHA256);
  });

  it("an 8 km main line in blocks: v1 as before this change", () => {
    const line8 = network([mainLine(0, 8000, viaduct, 10, 1000, 100)]);
    const rolling = along((x) => 3 + 2 * Math.sin(x / 400) + Math.sin((2 * Math.PI * x) / 200));
    const streets: CrossObject[] = [1200, 4100, 6900].map((x, i) => ({
      kind: "road",
      id: i + 1,
      pts: [plane.toLonLat(x, -300), plane.toLonLat(x, 300)],
    }));
    const plan = planNetwork(line8, new Set(), null, [], { partition: "blocks" });
    const r = solvePlan(plan, rolling, streets);
    expect(r.partition.anchors.length).toBe(2);
    expect(hashOf(r)).toBe(I1_BLOCKS_SHA256);
  });
});

/** See「I1」above: printed by the same build on origin/main 19968b3. */
const I1_SHA256 = "623eae639d8b14d10b56b4b91f3921780e2a0cc3caec6f7ef1a8cef0c049e635";
const I1_TUNNEL_SHA256 = "50b330fffdc9f61ba2c3e2415e4087ea687abda8fd86ad5783796a25d91ba144";
const I1_BLOCKS_SHA256 = "63f84f6b8b13ea47a175e50233ce1febf19dba9c6e1db54b587c7f5c39c14240";
