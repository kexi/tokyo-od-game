import { describe, expect, it } from "vitest";
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
import { planNetwork, solvePlan } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { buildChains, type Network, normalizeNode, normalizeWay, splitRuns } from "../src/expressway/network";

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
