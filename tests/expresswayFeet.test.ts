import { describe, expect, it } from "vitest";
import { GROUND_ROAD_HALF_WIDTH, PARAPET_WIDTH, RAMP_FOOT } from "../src/expressway/assumptions";
import { type CrossObject, planNetwork, solvePlan } from "../src/expressway/compile";
import { footCut, type FootLine } from "../src/expressway/feet";
import { STATION_STRIDE, ST, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { caseContextOf, caseOfDiagnostic } from "../src/expressway/ledger";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { danglingOf } from "../src/expressway/report";
import { ENTRANCE_HOPS, entranceJoin, planSigns } from "../src/expressway/signPlan";
import { violationsOf } from "../src/expressway/violations";

// S6 PR 7c2 (design memo 3.2 T and 4.1 S1): a ramp's ground end is cut out of the carriageway of the
// streets it meets (compile.ts cutFeet, feet.ts footCut), and an entrance ramp's route is found
// through the seams to the junction it joins.

const HALF = GROUND_ROAD_HALF_WIDTH.value;
const plane = planeAt(139.75, 35.65);
const ll = (x: number, y: number) => plane.toLonLat(x, y) as [number, number];

/** A straight line from the origin along +x every metre, of carriageway half width `half`. */
function straightLine(lengthM: number, half: number): FootLine {
  const n = lengthM + 1;
  const xy = new Float64Array(2 * n);
  const d = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    xy[2 * k] = k;
    d[k] = k;
  }
  return { xy, d, laneHalf: new Float32Array(n).fill(half) };
}

/** A street's centre line through (x, y) at `deg` to the +x axis, ±len. */
function street(id: number, x: number, y: number, deg: number, len = 80) {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return { id, xy: Float64Array.from([x - c * len, y - s * len, x + c * len, y + s * len]) };
}

describe("footCut（足を街路の縁で切る長さ、合成の線）", () => {
  const half = 2.375;
  const edge = half + PARAPET_WIDTH.value;

  it("a street at right angles through the end: cut where the slab's edge is the street's half width off its centre line", () => {
    const cut = footCut(straightLine(60, half), [street(7, 0, 0, 90)]);
    expect(cut.kind).toBe("cut");
    // The section is perpendicular to the street: its nearest point is the centre line, HALF off.
    expect(cut.kind === "cut" && cut.d).toBe(Math.floor(HALF) + 1);
    expect(cut.kind === "cut" && cut.roads).toEqual([7]);
  });

  it("a street at 30°: d = (half width + edge · cos 30°) / sin 30°, to the next metre", () => {
    const cut = footCut(straightLine(60, half), [street(7, 0, 0, 30)]);
    const expected = (HALF + edge * Math.cos(Math.PI / 6)) / Math.sin(Math.PI / 6);
    expect(cut.kind).toBe("cut");
    expect(cut.kind === "cut" && cut.d).toBe(Math.floor(expected) + 1);
  });

  it("a street along the ramp (a ramp in its median): not cut within RAMP_FOOT.maxM", () => {
    const cut = footCut(straightLine(60, half), [street(7, 0, 0, 0, 200)]);
    // Running with it from the end: at 0°, in it and over its centre line for all of RAMP_FOOT.maxM.
    expect(cut).toEqual({ kind: "along", roads: [7], angleDeg: 0, streetM: 30, coverM: 30 });
  });

  it("no street at the end, or one only crossing far along the run: nothing to cut", () => {
    expect(footCut(straightLine(60, half), [])).toEqual({ kind: "clear" });
    expect(footCut(straightLine(60, half), [street(7, 40, 0, 90)])).toEqual({ kind: "clear" });
  });

  it("a second street crossing just past the first keeps the cut going until the slab is clear of both", () => {
    const one = footCut(straightLine(60, half), [street(7, 0, 0, 90)]);
    const two = footCut(straightLine(60, half), [street(7, 0, 0, 90), street(8, 10, 0, 90)]);
    expect(two.kind === "cut" && two.d).toBe(10 + Math.floor(HALF) + 1);
    expect(one.kind === "cut" && two.kind === "cut" && two.d > one.d).toBe(true);
  });
});

// A ramp chain on its own: a viaduct from (0, 0) to (300, 0), then at grade to (300 + L, 0), meeting a
// street at its end node. Level ground at T.P. 3 m.
type Pt = [number, number];
function rampNetwork(groundLength: number, rampTail: Pt[] = []): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  let nextId = 500000;
  const add = (pts: Pt[], shared?: Map<string, number>) =>
    pts.map(([x, y]) => {
      const key = `${x},${y}`;
      const known = shared?.get(key);
      if (known !== undefined) return known;
      const id = nextId++;
      shared?.set(key, id);
      const [lon, lat] = ll(x, y);
      net.nodes.set(id, normalizeNode(id, lon, lat, {}));
      return id;
    });
  const shared = new Map<string, number>();
  const viaduct: Pt[] = [];
  for (let x = 0; x <= 300; x += 50) viaduct.push([x, 0]);
  const atGrade: Pt[] = [[300, 0]];
  for (let x = 300 + 25; x < 300 + groundLength; x += 25) atGrade.push([x, 0]);
  atGrade.push([300 + groundLength, 0], ...rampTail);
  const link = { highway: "motorway_link", lanes: "1", maxspeed: "40" };
  net.ways.set(10, normalizeWay(10, add(viaduct, shared), { ...link, bridge: "yes", layer: "1" }));
  net.ways.set(11, normalizeWay(11, add(atGrade, shared), link));
  return net;
}
const flat = () => 3;
const roadAt = (id: number, x: number, deg: number, len = 60): CrossObject => {
  const a = (deg * Math.PI) / 180;
  return {
    kind: "road",
    id,
    pts: [ll(x - Math.cos(a) * len, -Math.sin(a) * len), ll(x + Math.cos(a) * len, Math.sin(a) * len)],
  };
};
const height = { structures: "height" as const, ground: "compile" as const };
const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  for (const list of out.values()) list.sort((a, b) => a.k - b.k);
  return out;
};

describe("cutFeet（合成網: 高架のランプ → 地平 run → 街路）", () => {
  const L = 80;
  const net = rampNetwork(L);
  const road = roadAt(77, 300 + L, 90);

  it("cuts the run at grade where its slab leaves the street at right angles, and its end is at the ground with no road blocked there", () => {
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: [road] });
    const rp = plan.runs.get("11")!;
    const whole = planNetwork(net, new Set(), null, [], height).runs.get("11")!;
    const cut = whole.length - rp.length;
    expect(rp.footTrim).toEqual([0, expect.closeTo(cut, 2)]);
    // To the sample (≈1 m) past where the section is the street's half width off its centre line.
    expect(cut).toBeGreaterThanOrEqual(HALF);
    expect(cut).toBeLessThanOrEqual(HALF + 1.5);
    expect(plan.feet).toEqual([
      expect.objectContaining({ run: "11", end: "end", outcome: "cut", roads: [77] }),
    ]);
    const solved = solvePlan(plan, flat, [road]);
    const last = byRun(solved.chunks).get("11")!.at(-1)!;
    const o = last.st.length - STATION_STRIDE;
    expect(last.st[o + ST.z]).toBeCloseTo(3, 1);
    expect(last.blocked).toEqual([]);
    expect(solved.runs.find((r) => r.id === "11")!.end.kind).toBe("ground");
    const v = violationsOf(
      { runs: solved.runs, diagnostics: solved.diagnostics },
      solved.chunks,
      () => undefined,
      true,
    );
    for (const p of ["T1", "T2", "T3", "T5", "T13"] as const)
      expect(v[p].count, `${p} ${v[p].first.join()}`).toBe(0);
    expect(danglingOf(solved.runs).length).toBe(0);
  });

  it("without the roads (the tags' and the first plan's) the run keeps its OSM end", () => {
    const plan = planNetwork(net, new Set(), null, [], height);
    expect(plan.runs.get("11")!.footTrim).toBeUndefined();
    expect(plan.feet).toBeUndefined();
  });

  it("is the plan's alone: a range picking the run cuts it the same as no range", () => {
    const box = (() => {
      const [a, b] = [ll(250, -50), ll(450, 50)];
      return { minLon: a[0], minLat: a[1], maxLon: b[0], maxLat: b[1] };
    })();
    const ranged = planNetwork(net, new Set(), box, [], { ...height, feet: [road] });
    const whole = planNetwork(net, new Set(), null, [], { ...height, feet: [road] });
    expect(ranged.runs.get("11")!.length).toBe(whole.runs.get("11")!.length);
    expect(ranged.runs.get("11")!.i1).toBe(whole.runs.get("11")!.i1);
  });

  it("a street along the ramp is not cut: one foot-along-street case, never accepted by rule", () => {
    const along: CrossObject = {
      kind: "road",
      id: 78,
      pts: [ll(300 + L - 200, 0.5), ll(300 + L + 40, 0.5)],
    };
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: [along] });
    expect(plan.runs.get("11")!.footTrim).toBeUndefined();
    expect(plan.feet).toEqual([expect.objectContaining({ run: "11", end: "end", outcome: "along" })]);
    const d = plan.diagnostics.find((x) => x.kind === "ramp_foot_along_street")!;
    expect(d).toMatchObject({ run: "11", allowed: false });
    const found = caseOfDiagnostic(d, { runs: new Map(), untied: [], chunks: new Map() } as never);
    expect(found).toMatchObject({ key: "foot-along-street:11|end", kind: "foot-along-street" });
    expect(found!.measured.s).toBeCloseTo(plan.runs.get("11")!.length, 1);
    // What a rule would be made from: the angle, the slab in the street, its edge over the centre line
    // (0.5 m off it), and |road − ground| there once the run is solved.
    expect(found!.measured).toMatchObject({ angleDeg: expect.closeTo(0, 0), streetM: 30, coverM: 30 });
    const solved = solvePlan(plan, flat, [along]);
    const ctx = caseContextOf(solved.runs, [], solved.chunks);
    const solvedCase = caseOfDiagnostic(
      solved.diagnostics.find((x) => x.kind === "ramp_foot_along_street")!,
      ctx,
    );
    expect(solvedCase!.measured.offGroundM).toBeGreaterThanOrEqual(0);
    expect(solvedCase!.measured.offGroundM).toBeLessThan(0.1);
  });

  it("a run at grade the cut would leave shorter than RAMP_FOOT.minRunM is taken into the viaduct and cut there: its end at the ground in the band, its grade free, nothing dangles", () => {
    const short = rampNetwork(13);
    const near = roadAt(79, 313, 90);
    // Ground rising 2 % to the east: a ground end held to the terrain's grade would climb at +2 %.
    const rising = (lon: number, lat: number) => 3 + 0.02 * plane.toXY(lon, lat)[0];
    const before = solvePlan(planNetwork(short, new Set(), null, [], height), rising, [near]);
    const plan = planNetwork(short, new Set(), null, [], { ...height, feet: [near] });
    expect([...plan.runs.keys()]).toEqual(["10"]);
    const rp = plan.runs.get("10")!;
    expect(rp.footMerged).toEqual([false, true]);
    expect(rp.run.filledWays).toContain(11);
    expect(plan.feet).toEqual([
      expect.objectContaining({ run: "11", outcome: "merged", into: "10", mergedM: expect.closeTo(13, 0) }),
    ]);
    const cut = plan.feet![0].cutM;
    expect(13 - cut).toBeLessThan(RAMP_FOOT.value.minRunM);
    expect(rp.footTrim).toEqual([0, expect.closeTo(cut, 2)]);
    const solved = solvePlan(plan, rising, [near]);
    expect(solved.runs.map((r) => r.id)).toEqual(["10"]);
    const end = solved.runs[0].end;
    expect(end.kind).toBe("ground");
    expect(Math.abs(end.z! - end.ground!)).toBeLessThanOrEqual(0.04 + 1e-6);
    // Coming down to the street, not climbing with the terrain.
    expect(end.grade!).toBeLessThan(0);
    expect(danglingOf(solved.runs).length).toBe(0);
    const v = violationsOf(
      { runs: solved.runs, diagnostics: solved.diagnostics },
      solved.chunks,
      () => undefined,
      true,
    );
    for (const p of ["T1", "T2", "T3", "T5", "T13"] as const)
      expect(v[p].count, `${p} ${v[p].first.join()}`).toBe(0);
    // The steepest grade: the viaduct is 300 + 13 − cut long against 300 + 13 before, so at most that
    // much steeper, and no further step down the solve's ladder.
    const steepest = (r: typeof solved, ids: string[]) =>
      Math.max(
        ...r.chunks
          .filter((c) => ids.includes(c.run))
          .flatMap((c) =>
            Array.from({ length: c.st.length / STATION_STRIDE }, (_, k) =>
              Math.abs(c.st[k * STATION_STRIDE + ST.grade]),
            ),
          ),
      );
    const g0 = steepest(before, ["10", "11"]);
    const g1 = steepest(solved, ["10"]);
    expect(g1).toBeLessThanOrEqual(g0 * (313 / (313 - cut)) + 0.005);
    const stepsOf = (r: typeof solved) => r.runs.find((x) => x.id === "10")!.steps;
    for (const step of stepsOf(solved)) expect(stepsOf(before)).toContain(step);
  });
});

describe("cutFeet と足の中の節点", () => {
  it("a link at grade leaving the foot (a chain never compiled) is no junction: the short run at grade is still taken into the viaduct", () => {
    const net = rampNetwork(16);
    const link = { highway: "motorway_link", lanes: "1", maxspeed: "40" };
    // A node 8 m into the foot on the run at grade, and a link at grade on its own leaving it.
    const way = net.ways.get(11)!;
    const [a, b] = way.nodes;
    const mid = 700001;
    const [lon, lat] = ll(308, 0);
    net.nodes.set(mid, normalizeNode(mid, lon, lat, {}));
    way.nodes = [a, mid, b];
    const off = 700002;
    const [lon2, lat2] = ll(320, -30);
    net.nodes.set(off, normalizeNode(off, lon2, lat2, {}));
    net.ways.set(12, normalizeWay(12, [mid, off], link));
    const road = roadAt(80, 316, 90);
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: [road] });
    expect(plan.feet).toEqual([expect.objectContaining({ run: "11", outcome: "merged", into: "10" })]);
    expect([...plan.runs.keys()]).toEqual(["10"]);
  });
});

describe("入口の路線（signPlan.entranceJoin、合成網: 地平のランプ → seam → 高架 → 本線へ合流）", () => {
  /** A main line C1 and an entrance ramp: at grade along `atGrade`, then a viaduct up to its node at x 1000. */
  function entranceNetwork(atGrade: Pt[]): Network {
    const net: Network = { ways: new Map(), nodes: new Map() };
    const ids = new Map<string, number>();
    let nextId = 600000;
    const nodes = (pts: Pt[]) =>
      pts.map(([x, y]) => {
        const key = `${x},${y}`;
        const known = ids.get(key);
        if (known !== undefined) return known;
        const id = nextId++;
        ids.set(key, id);
        const [lon, lat] = ll(x, y);
        net.nodes.set(id, normalizeNode(id, lon, lat, {}));
        return id;
      });
    const main: Pt[] = [];
    for (let x = 0; x <= 1600; x += 50) main.push([x, 0]);
    const mainTags = {
      highway: "motorway",
      bridge: "yes",
      layer: "1",
      lanes: "2",
      maxspeed: "60",
      ref: "C1",
      name: "都心環状線",
    };
    net.ways.set(1, normalizeWay(1, nodes(main), mainTags));
    const link = { highway: "motorway_link", lanes: "1", maxspeed: "40" };
    const up: Pt[] = [
      [200, -120],
      [300, -116],
      [400, -105],
      [500, -88],
      [600, -66],
      [700, -42],
      [800, -20],
      [900, -6],
      [1000, 0],
    ];
    net.ways.set(20, normalizeWay(20, nodes(atGrade), link));
    net.ways.set(21, normalizeWay(21, nodes(up), { ...link, bridge: "yes", layer: "1" }));
    return net;
  }
  const entranceOf = (net: Network, solved: ReturnType<typeof solvePlan>, run: string) =>
    planSigns({
      chunks: solved.chunks,
      runs: solved.runs,
      features: solved.features,
      net,
      phones: [],
      bays: [],
    }).entrances.find((e) => e.run === run);

  it("names the main line the ramp joins through the seam, not null", () => {
    const atGrade: Pt[] = [
      [0, -120],
      [50, -120],
      [100, -120],
      [150, -120],
      [200, -120],
    ];
    const net = entranceNetwork(atGrade);
    const solved = solvePlan(planNetwork(net, new Set(), null, [], height), flat, []);
    const runs = new Map(solved.runs.map((r) => [r.id, r]));
    expect(runs.get("20")).toMatchObject({ ground: true, start: { kind: "ground" }, end: { kind: "open" } });
    expect(runs.get("21")!.start).toMatchObject({ kind: "seam", parent: "20" });
    expect(runs.get("21")!.end).toMatchObject({ kind: "junction", parent: "1" });
    const entrance = entranceOf(net, solved, "20")!;
    expect(entrance.route).toBe("C1");
    expect(entrance.routeName).toBe("都心環状線");
  });

  it("a foot taken into the viaduct makes the viaduct the entrance, its route found at once (no seam)", () => {
    const net = entranceNetwork([
      [187, -120],
      [200, -120],
    ]);
    const street = { kind: "road" as const, id: 81, pts: [ll(187, -200), ll(187, -40)] };
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: [street] });
    expect(plan.feet).toEqual([expect.objectContaining({ run: "20", outcome: "merged", into: "21" })]);
    const solved = solvePlan(plan, flat, [street]);
    const runs = new Map(solved.runs.map((r) => [r.id, r]));
    expect(runs.has("20")).toBe(false);
    expect(runs.get("21")!.start.kind).toBe("ground");
    expect(runs.get("21")!.end).toMatchObject({ kind: "junction", parent: "1" });
    expect(entranceOf(net, solved, "21")).toMatchObject({ route: "C1", routeName: "都心環状線" });
  });
});

/** Ramp ways sharing nodes by position: a bridge (viaduct) or at grade, nodes every `step` m. */
function chainNetwork(ways: Array<{ id: number; pts: Pt[]; bridge?: boolean }>): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  const ids = new Map<string, number>();
  let nextId = 800000;
  const link = { highway: "motorway_link", lanes: "1", maxspeed: "40" };
  for (const w of ways) {
    const nodes = w.pts.map(([x, y]) => {
      const key = `${x},${y}`;
      const known = ids.get(key);
      if (known !== undefined) return known;
      const id = nextId++;
      ids.set(key, id);
      const [lon, lat] = ll(x, y);
      net.nodes.set(id, normalizeNode(id, lon, lat, {}));
      return id;
    });
    net.ways.set(w.id, normalizeWay(w.id, nodes, w.bridge ? { ...link, bridge: "yes", layer: "1" } : link));
  }
  return net;
}
const along = (x0: number, x1: number, step: number): Pt[] => {
  const out: Pt[] = [];
  for (let x = x0; x < x1 - 1e-6; x += step) out.push([x, 0]);
  out.push([x1, 0]);
  return out;
};
const endsBlocked = (solved: ReturnType<typeof solvePlan>, run: string) => {
  const list = byRun(solved.chunks).get(run)!;
  return [list[0].blocked, list[list.length - 1].blocked];
};

describe("cutFeet の両端・始点・高架の足・分合流（レビューの必須 1・4）", () => {
  it("a viaduct with a short run at grade at both ends takes both in and cuts both: each end out of its street, nothing blocked", () => {
    const net = chainNetwork([
      { id: 9, pts: along(-13, 0, 13) },
      { id: 10, pts: along(0, 300, 50), bridge: true },
      { id: 11, pts: along(300, 313, 13) },
    ]);
    const roads = [roadAt(91, -13, 90), roadAt(92, 313, 90)];
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: roads });
    expect([...plan.runs.keys()]).toEqual(["10"]);
    const rp = plan.runs.get("10")!;
    expect(rp.footMerged).toEqual([true, true]);
    expect(rp.footTrim![0]).toBeGreaterThanOrEqual(HALF);
    expect(rp.footTrim![1]).toBeGreaterThanOrEqual(HALF);
    expect(plan.feet).toEqual([
      expect.objectContaining({ run: "9", end: "start", outcome: "merged", into: "10" }),
      expect.objectContaining({ run: "11", end: "end", outcome: "merged", into: "10" }),
    ]);
    const solved = solvePlan(plan, flat, roads);
    expect(endsBlocked(solved, "10")).toEqual([[], []]);
    expect(solved.runs[0]).toMatchObject({ start: { kind: "ground" }, end: { kind: "ground" } });
  });

  it("a run at grade cut at its start: the viaduct after it hangs at the cut run's length, its height going on through the seam", () => {
    const net = chainNetwork([
      { id: 9, pts: along(-60, 0, 20) },
      { id: 10, pts: along(0, 300, 50), bridge: true },
    ]);
    const roads = [roadAt(93, -60, 90)];
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: roads });
    const foot = plan.runs.get("9")!;
    expect(foot.footTrim![0]).toBeGreaterThanOrEqual(HALF);
    const solved = solvePlan(plan, flat, roads);
    const viaduct = solved.runs.find((r) => r.id === "10")!;
    expect(viaduct.start).toMatchObject({ kind: "seam", parent: "9" });
    expect(viaduct.start.parentS).toBeCloseTo(foot.length, 2);
    const footChunks = byRun(solved.chunks).get("9")!;
    const lastFoot = footChunks[footChunks.length - 1];
    const o = lastFoot.st.length - STATION_STRIDE;
    expect(lastFoot.st[o + ST.s]).toBeCloseTo(foot.length, 2);
    const first = byRun(solved.chunks).get("10")![0];
    expect(first.st[ST.z]).toBeCloseTo(lastFoot.st[o + ST.z], 2);
    expect(viaduct.start.z!).toBeCloseTo(lastFoot.st[o + ST.z], 2);
  });

  it("a viaduct's own ground end in a street is cut directly (no run at grade to take in)", () => {
    const net = chainNetwork([{ id: 10, pts: along(0, 300, 50), bridge: true }]);
    const roads = [roadAt(94, 300, 90)];
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: roads });
    const rp = plan.runs.get("10")!;
    expect(rp.footTrim).toEqual([0, expect.closeTo(300 - rp.length, 2)]);
    expect(rp.footMerged).toBeUndefined();
    expect(plan.feet).toEqual([expect.objectContaining({ run: "10", end: "end", outcome: "cut" })]);
    expect(endsBlocked(solvePlan(plan, flat, roads), "10")[1]).toEqual([]);
  });

  it("a compiled chain's node within the foot (a junction) keeps the foot uncut", () => {
    const net = rampNetwork(80);
    // A ramp with a viaduct of its own, ending on the run at grade's node at x 375, 5 m from its end.
    const node375 = net.ways.get(11)!.nodes[3];
    const ids = [900001, 900002, 900003];
    [
      [375, 300],
      [375, 200],
      [375, 100],
    ].forEach(([x, y], k) => {
      const [lon, lat] = ll(x, y);
      net.nodes.set(ids[k], normalizeNode(ids[k], lon, lat, {}));
    });
    const link = { highway: "motorway_link", lanes: "1", maxspeed: "40" };
    net.ways.set(30, normalizeWay(30, [ids[0], ids[1], ids[2]], { ...link, bridge: "yes", layer: "1" }));
    net.ways.set(31, normalizeWay(31, [ids[2], node375], link));
    const roads = [roadAt(95, 380, 90)];
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: roads });
    expect(plan.feet).toEqual([expect.objectContaining({ run: "11", end: "end", outcome: "kept" })]);
    expect(plan.runs.get("11")!.footTrim).toBeUndefined();
  });

  it("a short run at grade in the street all its length (short of RAMP_FOOT.maxM) is kept uncut, listed with its own length, not along for 30 m", () => {
    const net = rampNetwork(8);
    const street: CrossObject = { kind: "road", id: 96, pts: [ll(290, 0.5), ll(340, 0.5)] };
    const plan = planNetwork(net, new Set(), null, [], { ...height, feet: [street] });
    expect([...plan.runs.keys()].toSorted()).toEqual(["10", "11"]);
    expect(plan.runs.get("11")!.footTrim).toBeUndefined();
    expect(plan.feet).toEqual([expect.objectContaining({ run: "11", outcome: "kept", cutM: 0 })]);
    const d = plan.diagnostics.filter((x) => x.kind === "ramp_foot_along_street");
    expect(d.map((x) => x.detail)).toEqual([
      expect.stringMatching(/^end at 8\.\d\d m in road 96 for 8(\.\d)? m \(/),
    ]);
  });
});

describe("entranceJoin（seam のたどり、輪と hop の上限）", () => {
  type Ends = Parameters<typeof entranceJoin>[0] extends ReadonlyMap<string, infer V> ? V : never;
  const run = (id: string, start: Ends["start"], end: Ends["end"]): [string, Ends] => [
    id,
    { id, start, end },
  ];
  const open = { kind: "open" } as Ends["end"];
  const seamOn = (parent: string) =>
    ({ kind: "seam", parent, parentS: 0, z: 0, grade: 0, bank: 0 }) as Ends["start"];
  const junction = { kind: "junction", parent: "M", parentS: 120, z: 0, grade: 0, bank: 0 } as Ends["end"];
  const ground = { kind: "ground", z: 0, grade: 0, ground: 0, bank: 0 } as Ends["start"];

  it("follows the seams to the junction", () => {
    const runs = new Map([
      run("A", ground, open),
      run("B", seamOn("A"), open),
      run("C", seamOn("B"), junction),
    ]);
    expect(entranceJoin(runs, "A")).toEqual({ parent: "M", parentS: 120 });
  });

  it("a loop of seams gives no route", () => {
    const runs = new Map([
      run("A", ground, seamOn("B") as Ends["end"]),
      run("B", seamOn("A"), seamOn("A") as Ends["end"]),
    ]);
    expect(entranceJoin(runs, "A")).toBeNull();
  });

  it("past ENTRANCE_HOPS seams gives no route", () => {
    const ids = Array.from({ length: ENTRANCE_HOPS + 2 }, (_, k) => `R${k}`);
    const within = new Map(
      ids
        .slice(0, ENTRANCE_HOPS + 1)
        .map((id, k) =>
          run(id, k === 0 ? ground : seamOn(ids[k - 1]), k === ENTRANCE_HOPS ? junction : open),
        ),
    );
    expect(entranceJoin(within, "R0")).toEqual({ parent: "M", parentS: 120 });
    const beyond = new Map(
      ids.map((id, k) =>
        run(id, k === 0 ? ground : seamOn(ids[k - 1]), k === ENTRANCE_HOPS + 1 ? junction : open),
      ),
    );
    expect(entranceJoin(beyond, "R0")).toBeNull();
  });
});
