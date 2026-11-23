import { describe, expect, it } from "vitest";
import { belowCeilingsRefusal, shippedFolderRefusal } from "../scripts/expresswayGuards";
import { MAX_GRADE } from "../src/law/roadStandards";
import {
  CUT_TOLERANCE_M,
  depthFor,
  descentWithin,
  isBelowCompiled,
  isReachable,
  TUNNEL_DEPTH_M,
} from "../src/expressway/below";
import {
  checkChunkJoin,
  checkCover,
  checkGrade,
  checkJunction,
  checkVerticalCurves,
} from "../src/expressway/checks";
import { ceilingRowsBetween, planNetwork, solvePlan } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { buildChains, type Network, normalizeNode, normalizeWay, splitRuns } from "../src/expressway/network";
import { violationsOf } from "../src/expressway/violations";

// Synthetic C1-like line going east in a plane round 芝公園: a viaduct, then a cut into a hill, a
// tunnel through it, and the road on at grade (or on a viaduct) past it. P9 (knowledge/road-redesign-plan.md 8 章).
const plane = planeAt(139.75, 35.65);

type WaySpec = { id: number; x0: number; x1: number; tags: Record<string, string> };

const viaduct = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const cut = { highway: "motorway", cutting: "yes", lanes: "2", maxspeed: "60", ref: "C1" };
const tunnel = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };

/** Ways end to end along y = 0, a node every 50 m, consecutive ways sharing their end nodes. */
function network(ways: WaySpec[]): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  const nodeAt = (x: number) => 100000 + Math.round(x);
  for (const w of ways) {
    const xs: number[] = [];
    for (let x = w.x0; x < w.x1 - 1e-6; x += 50) xs.push(x);
    xs.push(w.x1);
    const ids = xs.map(nodeAt);
    net.ways.set(w.id, normalizeWay(w.id, ids, w.tags));
    xs.forEach((x, i) => {
      const [lon, lat] = plane.toLonLat(x, 0);
      net.nodes.set(ids[i], normalizeNode(ids[i], lon, lat, {}));
    });
  }
  return net;
}

/**
 * The ground: level at T.P. 3 m up to x = 1000, a hill rising to 18 m by x = 1250 and level to
 * 1650, falling to 10 m by 1750 and level beyond (a tunnel coming out on a hillside).
 */
function hill(lon: number, lat: number): number {
  const [x] = plane.toXY(lon, lat);
  if (x <= 1000) return 3;
  if (x <= 1250) return 3 + ((x - 1000) / 250) * 15;
  if (x <= 1650) return 18;
  if (x <= 1750) return 18 - ((x - 1650) / 100) * 8;
  return 10;
}

const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  for (const list of out.values()) list.sort((a, b) => a.k - b.k);
  return out;
};

describe("トンネル・掘割の規則（below.ts）", () => {
  it("a tunnel keeps inner height, roof and cover under the ground; a cut may stand only its tolerance above it", () => {
    expect(TUNNEL_DEPTH_M).toBeCloseTo(4.5 + 0.8 + 0.8 + 0.5, 6);
    expect(depthFor("tunnel")).toBe(TUNNEL_DEPTH_M);
    expect(depthFor("cut")).toBe(-CUT_TOLERANCE_M);
  });

  it("the descent from a portal assumes the worst start: climbing at half the 第20条 grade, over a crest, then falling at the grade", () => {
    const g = MAX_GRADE.value[60].standard;
    expect(descentWithin(60, 0)).toBeCloseTo(0, 12);
    // At first the road may still be climbing out of the portal: no depth at all.
    expect(descentWithin(60, 20)).toBeLessThan(0);
    // Far from the portal it falls at the grade: the slope between two far points is g.
    expect(descentWithin(60, 1000) - descentWithin(60, 900)).toBeCloseTo(g * 100, 6);
    // Never steeper than the grade from a level start.
    for (const d of [50, 100, 200, 400]) expect(descentWithin(60, d)).toBeLessThan(g * d);
  });

  it("a ceiling is imposed only where both portals can reach it", () => {
    const deep = 3 - TUNNEL_DEPTH_M;
    expect(
      isReachable(60, deep, [
        { d: 400, z: 3 },
        { d: 400, z: 3 },
      ]),
    ).toBe(true);
    expect(
      isReachable(60, deep, [
        { d: 20, z: 3 },
        { d: 400, z: 3 },
      ]),
    ).toBe(false);
    expect(
      isReachable(60, deep, [
        { d: 400, z: 3 },
        { d: 20, z: 3 },
      ]),
    ).toBe(false);
  });

  it("splitRuns makes one below run of a cut and the tunnel after it, between the viaduct and the road at grade", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: viaduct },
      { id: 2, x0: 1000, x1: 1200, tags: cut },
      { id: 3, x0: 1200, x1: 1700, tags: tunnel },
      { id: 4, x0: 1700, x1: 2000, tags: atGrade },
    ]);
    const [chain] = buildChains(net);
    const runs = splitRuns(net, chain);
    expect(runs.map((r) => [r.ways, r.elevated, r.below])).toEqual([
      [[1], true, false],
      [[2, 3], false, true],
      [[4], false, false],
    ]);
  });

  it("a below run ending where another chain meets it (a junction under the ground) is deferred", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: viaduct },
      { id: 2, x0: 1000, x1: 1500, tags: tunnel },
    ]);
    const [chain] = buildChains(net);
    const [, below] = splitRuns(net, chain);
    const end = chain.nodes[chain.nodes.length - 1];
    const alone = new Map<number, string[]>([[end, [chain.id]]]);
    const met = new Map<number, string[]>([[end, [chain.id, "c99"]]]);
    expect(isBelowCompiled(chain, below, alone, new Set())).toBe(true);
    expect(isBelowCompiled(chain, below, met, new Set())).toBe(false);
    expect(isBelowCompiled(chain, below, alone, new Set([end]))).toBe(false);
  });
});

describe("掘割からトンネルへ（合成の縦断、P9）", () => {
  const net = network([
    { id: 1, x0: 0, x1: 1000, tags: viaduct },
    { id: 2, x0: 1000, x1: 1200, tags: cut },
    { id: 3, x0: 1200, x1: 1700, tags: tunnel },
    { id: 4, x0: 1700, x1: 2200, tags: atGrade },
  ]);
  const plan = planNetwork(net, new Set(), null);
  const result = solvePlan(plan, hill, []);
  const chunks = byRun(result.chunks);
  const runs = new Map(result.runs.map((r) => [r.id, r]));

  it("compiles the viaduct and the below run as one problem, the below run seamed to the viaduct's portal", () => {
    expect([...plan.runs.keys()].sort()).toEqual(["1", "2"]);
    expect(plan.components.get(plan.componentOf.get("2")!)!.sort()).toEqual(["1", "2"]);
    // Only the hillside portal: the ground falls 8 m in the last 100 m, faster than the road may climb
    // out from the box's depth, so the roof shows there (reported, the allowlist decides per run).
    const left = result.diagnostics.filter((d) => !d.allowed);
    expect(left.map((d) => [d.run, d.kind])).toEqual([["2", "tunnel_cover_short"]]);
    expect(left[0].detail).toMatch(/at \d+–700 m/);
    expect(runs.get("1")!.end).toMatchObject({ kind: "portal", into: "cut" });
    expect(runs.get("2")!.start).toMatchObject({ kind: "seam", parent: "1" });
    expect(runs.get("2")!.end.kind).toBe("ground");
  });

  it("one profile through the portal: height, grade and bank continuous from the viaduct into the cut (T3)", () => {
    const viaductChunks = chunks.get("1")!;
    const below = chunks.get("2")!;
    const start = runs.get("2")!.start;
    expect(checkJunction(below[0], true, start.grade!, viaductChunks)).toEqual([]);
    for (const list of [viaductChunks, below])
      for (let i = 1; i < list.length; i++) expect(checkChunkJoin(list[i - 1], list[i])).toEqual([]);
  });

  it("grades and vertical curves within 第20・22条 under the ground too (T1・T2)", () => {
    for (const c of chunks.get("2")!) {
      expect(checkGrade(c, runs.get("2")!)).toEqual([]);
      expect(checkVerticalCurves(c)).toEqual([]);
    }
  });

  it("the tunnel keeps its box and cover under the hill, the cut stays under the ground (T12)", () => {
    const list = chunks.get("2")!;
    const first = list[0].st;
    const last = list[list.length - 1].st;
    const ends = { z0: first[3], z1: last[last.length - STATION_STRIDE + 3] };
    for (const c of list) expect(checkCover(c, runs.get("2")!, ends)).toEqual([]);
    // And it is really down there: somewhere under the hill's top the cover is the whole depth.
    const tunnelStations = list
      .filter((c) => c.structure === "tunnel")
      .flatMap((c) =>
        Array.from({ length: c.st.length / STATION_STRIDE }, (_, i) => c.st.slice(i * 7, i * 7 + 7)),
      );
    const deepest = Math.max(...tunnelStations.map((p) => p[5] - p[3]));
    expect(deepest).toBeGreaterThanOrEqual(TUNNEL_DEPTH_M - 0.01);
  });

  it("chunks are all cut or all tunnel, with no girder, piers, crossings or blocked roads, and the portals recorded", () => {
    const list = chunks.get("2")!;
    expect(list[0].structure).toBe("cut");
    expect(list[list.length - 1].structure).toBe("tunnel");
    for (const c of list) {
      expect(c.girder).toBe(0);
      expect(c.piers).toEqual([]);
      expect(c.cross).toEqual([]);
      expect(c.blocked).toEqual([]);
    }
    const portals = list.flatMap((c) => c.portals ?? []);
    expect(portals.map((p) => `${p.from}>${p.to}`)).toEqual(["viaduct>cut", "cut>tunnel", "tunnel>ground"]);
    expect(portals[1].s).toBeCloseTo(200, 0);
    // The viaduct's chunks carry none.
    expect(chunks.get("1")!.every((c) => c.portals === undefined)).toBe(true);
  });

  it("a portal from tunnel to cut belongs to the tunnel's chunk (which draws its 坑門), as one from cut to tunnel does", () => {
    const twoCuts = network([
      { id: 1, x0: 0, x1: 1000, tags: viaduct },
      { id: 2, x0: 1000, x1: 1200, tags: cut },
      { id: 3, x0: 1200, x1: 1600, tags: tunnel },
      { id: 4, x0: 1600, x1: 1750, tags: cut },
      { id: 5, x0: 1750, x1: 2200, tags: atGrade },
    ]);
    const res = solvePlan(planNetwork(twoCuts, new Set(), null), hill, []);
    const list = byRun(res.chunks).get("2")!;
    for (const c of list) {
      for (const p of c.portals ?? []) {
        const isMouth = (p.from === "tunnel") !== (p.to === "tunnel");
        if (isMouth) expect([c.id, c.structure]).toEqual([c.id, "tunnel"]);
      }
    }
    const mouths = list
      .flatMap((c) => c.portals ?? [])
      .filter((p) => (p.from === "tunnel") !== (p.to === "tunnel"));
    expect(mouths.map((p) => `${p.from}>${p.to}`)).toEqual(["cut>tunnel", "tunnel>cut"]);
  });

  it("never leaves a below run unsolved on its own: hills narrow, steep, high and with a hillside portal all solve", () => {
    const shapes: Array<[string, (x: number) => number]> = [
      ["narrow", (x) => (x > 1100 && x < 1600 ? 3 + 12 * Math.sin(((x - 1100) / 500) * Math.PI) : 3)],
      ["steep", (x) => (x <= 1000 ? 3 : x <= 1050 ? 3 + (x - 1000) * 0.4 : x <= 1650 ? 23 : 3)],
      ["high", (x) => (x <= 1000 ? 3 : x <= 1700 ? 40 : 3)],
      ["hillside", (x) => (x <= 1000 ? 3 : x <= 1600 ? 3 + (x - 1000) * 0.05 : 12)],
    ];
    for (const [name, shape] of shapes) {
      const ground = (lon: number, lat: number) => shape(plane.toXY(lon, lat)[0]);
      const res = solvePlan(planNetwork(net, new Set(), null), ground, []);
      const unsolved = res.diagnostics.filter(
        (d) => d.kind === "vertical_unsolved" || d.kind === "parent_unsolved",
      );
      expect([name, unsolved]).toEqual([name, []]);
      expect(res.runs.map((r) => r.id).sort()).toEqual(["1", "2"]);
    }
  });

  it("a tunnel that would join two otherwise separate viaducts is deferred (no component is merged by it)", () => {
    const bridging = network([
      { id: 1, x0: 0, x1: 1000, tags: viaduct },
      { id: 2, x0: 1000, x1: 1200, tags: cut },
      { id: 3, x0: 1200, x1: 1700, tags: tunnel },
      { id: 4, x0: 1700, x1: 2700, tags: viaduct },
    ]);
    const p = planNetwork(bridging, new Set(), null);
    expect([...p.runs.keys()].sort()).toEqual(["1", "4"]);
    expect(p.belowDeferred).toEqual(["2"]);
    expect(p.componentOf.get("1")).not.toBe(p.componentOf.get("4"));
  });
});

describe("格子の測点の間の土被り（T12、S7-3 レビュー 0 の崖と斜面、S7-3c）", () => {
  // A tunnel with no end going on under the ground (as before S7-3): a viaduct, then the tunnel down
  // from a 30 m hill and curving south, out onto the low ground and a viaduct. The compiler holds the
  // ceilings on its 5 m grid with the lowest ground of three points; the check reads every station of
  // the files with its own ground. Where the ground falls between two rows (a cliff at y = −452 on the
  // net whose south nodes are shifted 3.2 m; a slope of 27 m in 100 m below y = −701 on the unshifted
  // net) the box cut its cover there and T12 caught it under grid. `--below-ceilings points` adds rows
  // between them (compile.ts ceilingRowsBetween) and holds it (knowledge/expressway-generation.md「S7-3c」).
  const link = { highway: "motorway_link", oneway: "yes" };
  const linkBridge = { ...link, bridge: "yes", layer: "1" };
  const linkTunnel = { ...link, tunnel: "yes", layer: "-1" };
  /** `d`: how far the nodes from the curve's end south are shifted (3.2 m for the cliff, 0 for the slope). */
  const cliffNet = (d: number): Network => {
    const n: Network = { ways: new Map(), nodes: new Map() };
    const pts: Array<[number, number]> = [];
    for (let x = 0; x <= 600; x += 50) pts.push([x, 0]);
    const curve: Array<[number, number]> = [
      [630, -20],
      [680, -60],
      [750, -120],
      [800, -200 - d],
    ];
    const south: Array<[number, number]> = [];
    for (let y = -300 - d; y >= -1300 - d - 1e-9; y -= 50) south.push([800, y]);
    const all = [...pts, ...curve, ...south];
    const ids = all.map((_, i) => 700000 + i);
    all.forEach(([x, y], i) => {
      const [lon, lat] = plane.toLonLat(x, y);
      n.nodes.set(ids[i], normalizeNode(ids[i], lon, lat, {}));
    });
    const at = (x: number, y: number) => ids[all.findIndex((p) => p[0] === x && p[1] === y)];
    const span = (a: number, b: number) => ids.slice(ids.indexOf(a), ids.indexOf(b) + 1);
    n.ways.set(10, normalizeWay(10, span(ids[0], at(600, 0)), linkBridge));
    n.ways.set(20, normalizeWay(20, span(at(600, 0), at(800, -900 - d)), linkTunnel));
    n.ways.set(30, normalizeWay(30, span(at(800, -900 - d), at(800, -1000 - d)), link));
    n.ways.set(40, normalizeWay(40, span(at(800, -1000 - d), at(800, -1300 - d)), linkBridge));
    return n;
  };
  const cliffAt = (edge: number) => (lon: number, lat: number) => (plane.toXY(lon, lat)[1] > edge ? 30 : 3);
  const slopeAt = (yc: number) => (lon: number, lat: number) => {
    const t = Math.min(1, Math.max(0, (yc - plane.toXY(lon, lat)[1]) / 100));
    return 30 - 27 * t;
  };
  const t12 = (d: number, ground: (lon: number, lat: number) => number, mode: "grid" | "points") => {
    const plan = planNetwork(cliffNet(d), new Set(), null, [], {
      structures: "height",
      ground: "compile",
      pruneBelow: false,
      belowCeilings: mode,
    });
    const res = solvePlan(plan, ground, []);
    return violationsOf(res, res.chunks, () => undefined, true).T12;
  };

  it("A. grid still catches the box cutting its cover between two rows at the cliff; points holds it", () => {
    const grid = t12(3.2, cliffAt(-452), "grid");
    expect(grid.count).toBe(1);
    expect(grid.first[0]).toMatch(/^20:\d+: tunnel road -3\.\d+ above -3\.60 at s=5\d\d\.\d+$/);
    expect(t12(3.2, cliffAt(-452), "points").count).toBe(0);
  });

  it("B. points holds every cliff edge and slope where grid had T12 (S7-3 review 0: 15 edges, 4 slopes)", () => {
    // The scans' positions (cliff −430 to −530 every 0.25 m, slope −690 to −710 every 0.5 m) with T12 under grid.
    const edges = [-430, -430.25, -430.5, -430.75, -431, -431.25, -431.5, -431.75, -432];
    edges.push(-451.75, -452, -471.75, -472, -491.75, -492);
    for (const e of edges) expect([e, t12(3.2, cliffAt(e), "points").count]).toEqual([e, 0]);
    for (const yc of [-701, -701.5, -702, -702.5]) {
      expect([yc, t12(0, slopeAt(yc), "grid").count]).toEqual([yc, 1]);
      expect([yc, t12(0, slopeAt(yc), "points").count]).toEqual([yc, 0]);
    }
  }, 120_000);

  it("E. a net no point of which is under its rows' line by more than the rounding solves as under grid", () => {
    // 掘割からトンネルへ's hill: level ground and straight slopes. A row's ground is the lowest of three
    // points, under the ground of the points between, so no point's ceiling is under the rows' line.
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: viaduct },
      { id: 2, x0: 1000, x1: 1200, tags: cut },
      { id: 3, x0: 1200, x1: 1700, tags: tunnel },
      { id: 4, x0: 1700, x1: 2200, tags: atGrade },
    ]);
    const solve = (mode: "grid" | "points") =>
      solvePlan(
        planNetwork(net, new Set(), null, [], {
          structures: "height",
          ground: "compile",
          pruneBelow: false,
          belowCeilings: mode,
        }),
        hill,
        [],
      ).chunks;
    expect(JSON.stringify(solve("points"))).toBe(JSON.stringify(solve("grid")));
  });
});

describe("C・D・F. 格子の行の間に足す行（ceilingRowsBetween、S7-3c 3.2・追記 1）", () => {
  /** A point's ceiling: `at(s)`, or null where `held(s)` is false. */
  const pointOf =
    (at: (s: number) => number, held: (s: number) => boolean = () => true) =>
    (s: number) =>
      held(s) ? at(s) : null;
  const near = (s: number, x: number) => Math.abs(s - x) < 1e-9;

  it("C. where points' ceilings are under the rows' line by more than 1 cm, rows with those ceilings are added, the lowest first", () => {
    const rows = [
      { s: 0, top: -3 },
      { s: 5, top: -3 },
    ];
    // The lowest under the line (4, by 0.3 m) first; then, between 0 and 4, 2.5 is still under the new
    // line by 1.25 cm; 3 is not under the line from 2.5 to 4 by more than 1 cm, so it gets none.
    const dip = pointOf((s) => (near(s, 2.5) ? -3.2 : near(s, 3) ? -3.2 : near(s, 4) ? -3.3 : -3));
    expect(ceilingRowsBetween(rows, dip, "points")).toEqual([
      { s: 2.5, top: -3.2 },
      { s: 4, top: -3.3 },
    ]);
    // Under the line by 1 cm or less: T12 passes a road on the line there, so no row.
    const shallow = pointOf((s) => (near(s, 2.5) ? -3.01 : -3));
    expect(ceilingRowsBetween(rows, shallow, "points")).toEqual([]);
    // grid adds no row between two rows that both keep a ceiling.
    expect(ceilingRowsBetween(rows, dip, "grid")).toEqual([]);
  });

  it("D. between a row without a ceiling and one with, points adds grid's row, then goes on between it and the held row", () => {
    const rows = [
      { s: 0, top: null },
      { s: 5, top: -2 },
    ];
    // Held from s 2 on; at 4 the point's ceiling is 1 m under the line from the row at 2 to the one at 5.
    const point = pointOf(
      (s) => (near(s, 4) ? -3 : -2),
      (s) => s >= 2 - 1e-9,
    );
    const grid = ceilingRowsBetween(rows, point, "grid");
    expect(grid).toEqual([{ s: 2, top: -2 }]);
    expect(ceilingRowsBetween(rows, point, "points")).toEqual([...grid, { s: 4, top: -3 }]);
    // The free row last: grid's row is the first held point counted from it.
    const back = [
      { s: 0, top: -2 },
      { s: 5, top: null },
    ];
    const held = pointOf(
      () => -2,
      (s) => s <= 3 + 1e-9,
    );
    expect(ceilingRowsBetween(back, held, "grid")).toEqual([{ s: 3, top: -2 }]);
    expect(ceilingRowsBetween(back, held, "points")).toEqual([{ s: 3, top: -2 }]);
  });

  it("F. between two rows without a ceiling, points adds the first held point, then the one nearest the free row (grid none)", () => {
    const rows = [
      { s: 0, top: null },
      { s: 5, top: null },
    ];
    // Only 2.25 to 2.75 are held (S7-3 review 0's slope at yc −701: rows 880 and 885 hold none).
    const point = pointOf(
      () => -1.7,
      (s) => s >= 2.25 - 1e-9 && s <= 2.75 + 1e-9,
    );
    expect(ceilingRowsBetween(rows, point, "grid")).toEqual([]);
    expect(ceilingRowsBetween(rows, point, "points")).toEqual([
      { s: 2.25, top: -1.7 },
      { s: 2.75, top: -1.7 },
    ]);
  });
});

describe("G. 番人（S7-3c 3.1、--below-ceilings）", () => {
  const plain = { isBelowAll: false, isBlocks: false, isV1: false, v2Flags: [] };
  it("points stops without --out and is taken with it", () => {
    expect(shippedFolderRefusal({ ...plain, hasOut: false, isBelowCeilingsPoints: true })).toMatch(
      /below-ceilings points/,
    );
    expect(shippedFolderRefusal({ ...plain, hasOut: true, isBelowCeilingsPoints: true })).toBeNull();
  });

  it("points needs --structures height; grid takes either; an unknown value stops", () => {
    expect(belowCeilingsRefusal("points", "height")).toBeNull();
    expect(belowCeilingsRefusal("points", "tags")).toMatch(/structures height/);
    expect(belowCeilingsRefusal("grid", "tags")).toBeNull();
    expect(belowCeilingsRefusal("grid", "height")).toBeNull();
    expect(belowCeilingsRefusal("rows", "height")).toMatch(/unknown/);
  });
});
