import { describe, expect, it } from "vitest";
import { portalApproachRefusal, shippedFolderRefusal } from "../scripts/expresswayGuards";
import {
  type BelowLinkRun,
  ceilingAt,
  ceilingFrom,
  descentWithin,
  hasPortalsBeyond,
  portalApproachLength,
  portalReaches,
  TUNNEL_DEPTH_M,
} from "../src/expressway/below";
import {
  belowLinksOf,
  loweredApproaches,
  type Plan,
  planNetwork,
  solvePlan,
} from "../src/expressway/compile";
import { packTiles } from "../src/expressway/files";
import { STATION_STRIDE } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { pairStations } from "../src/expressway/overlap";
import { surfaceAt } from "../src/expressway/profile";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { danglingOf } from "../src/expressway/report";
import { portalAtOfSummary, violationsOf } from "../src/expressway/violations";

// S7-2 (`--portal-approach cut`): a tunnel's portal on a lowered approach is read at the lowered
// stretch's start, its length beyond the tunnel's end. What must hold: without a lowered approach every
// ceiling is as before; with one, the way to that portal is the stretch's length longer, at the ground
// of the stretch's start, also for a child that reaches it through its parent under the ground.

/** A tunnel run of `length` m, its ends' ground 3 m, at grade on both sides unless given. */
const tunnel = (id: string, length: number, more: Partial<BelowLinkRun> = {}): BelowLinkRun => ({
  id,
  lengthM: length,
  planV: 60,
  below: true,
  ends: [{ kind: "seam", parent: `${id}-before`, parentS: 0 }, { kind: "open" }],
  ground: [3, 3],
  ...more,
});
const atGrade = (id: string, length: number): BelowLinkRun => ({
  id,
  lengthM: length,
  planV: 60,
  below: false,
  ends: [{ kind: "open" }, { kind: "open" }],
  ground: [3, 3],
});
const linksOf = (...runs: BelowLinkRun[]) => new Map(runs.map((r) => [r.id, r]));

describe("E. 坑口の高さの定義（S7-2 3.3）", () => {
  it("without a lowered approach, a tunnel's ends are its own portals and every ceiling is ceilingAt's", () => {
    const links = linksOf(tunnel("1", 800), atGrade("1-before", 300));
    expect(hasPortalsBeyond(links, "1")).toBe(false);
    const reaches = portalReaches(links, "1");
    expect(reaches).toEqual([[{ offset: 0, z: 3, V: 60 }], [{ offset: 0, z: 3, V: 60 }]]);
    for (let s = 0; s <= 800; s += 25)
      expect(ceilingFrom("tunnel", 30, s, 800, reaches)).toBe(
        ceilingAt("tunnel", 30, s, 800, { z0: 3, z1: 3 }, 60),
      );
  });

  it("with the start's approach lowered for L m, its portal is L m beyond the start at the stretch's start's ground", () => {
    const L = 215;
    const links = linksOf(
      tunnel("1", 800, { portalAt: [{ offsetM: L, z: 4.5, V: 60 }, null] }),
      atGrade("1-before", 300),
    );
    expect(hasPortalsBeyond(links, "1")).toBe(true);
    const [start, end] = portalReaches(links, "1");
    expect(start).toEqual([{ offset: L, z: 4.5, V: 60 }]);
    expect(end).toEqual([{ offset: 0, z: 3, V: 60 }]);
    // At the tunnel's first station the descent from the portal is already the depth's (L is where it
    // reaches TUNNEL_DEPTH_M and the margin), so the ceiling stands there; without the lowering it does not.
    const ground = 4.5;
    expect(descentWithin(60, L)).toBeGreaterThanOrEqual(TUNNEL_DEPTH_M + 0.1);
    expect(ceilingFrom("tunnel", ground, 0, 800, [start, end])).toBeCloseTo(ground - TUNNEL_DEPTH_M, 9);
    expect(ceilingAt("tunnel", ground, 0, 800, { z0: 3, z1: 3 }, 60)).toBeNull();
  });

  it("takes the faster of the tunnel's and the approach's speed over the lowered stretch", () => {
    const links = linksOf(tunnel("1", 800, { planV: 40, portalAt: [{ offsetM: 215, z: 3, V: 60 }, null] }));
    expect(portalReaches(links, "1")[0]).toEqual([{ offset: 215, z: 3, V: 60 }]);
  });

  it("a ramp leaving the tunnel under the ground adds the parent's lowered stretch beyond the parent's portal", () => {
    const parent = tunnel("1", 800, { portalAt: [{ offsetM: 215, z: 4, V: 60 }, null] });
    const ramp: BelowLinkRun = {
      id: "70",
      lengthM: 400,
      planV: 40,
      below: true,
      ends: [{ kind: "junction", parent: "1", parentS: 300 }, { kind: "open" }],
      ground: [3, 3],
    };
    const links = linksOf(parent, ramp);
    expect(hasPortalsBeyond(links, "70")).toBe(true);
    const [start] = portalReaches(links, "70");
    expect(start).toContainEqual({ offset: 300 + 215, z: 4, V: 60 });
    expect(start).toContainEqual({ offset: 500, z: 3, V: 60 });
  });
});

describe("I. 番人（S7-2 3.1）", () => {
  const plain = { isBelowAll: false, isBlocks: false, isV1: false, v2Flags: [] };
  it("cut stops without --out and is taken with it", () => {
    expect(shippedFolderRefusal({ ...plain, hasOut: false, isPortalApproachCut: true })).toMatch(
      /portal-approach/,
    );
    expect(shippedFolderRefusal({ ...plain, hasOut: true, isPortalApproachCut: true })).toBeNull();
  });

  it("cut needs --below-junctions compile; off takes either; an unknown value stops", () => {
    expect(portalApproachRefusal("cut", "compile")).toBeNull();
    expect(portalApproachRefusal("cut", "defer")).toMatch(/below-junctions compile/);
    expect(portalApproachRefusal("off", "defer")).toBeNull();
    expect(portalApproachRefusal("off", "compile")).toBeNull();
    expect(portalApproachRefusal("down", "compile")).toMatch(/unknown/);
  });
});

// ---- 手順 4（3.2・3.4・3.5）と、前に出した要約の欄（3.7、追記 2 B） ----

const plane = planeAt(139.75, 35.65);
type WaySpec = { id: number; x0: number; x1: number; tags: Record<string, string> };
const bridgeTags = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const gradeTags = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };
const tunnelTags = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
const cutTags = { highway: "motorway", cutting: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };

/** Ways end to end along y = 0, a node every 50 m (and at each way's end), consecutive ways sharing their end nodes. */
function network(
  ways: WaySpec[],
  /** Along y = `y`, the node ids from `base` (a second line beside the first). */
  y = 0,
  base = 100000,
  net: Network = { ways: new Map(), nodes: new Map() },
): Network {
  const nodeAt = (x: number) => base + Math.round(x);
  for (const w of ways) {
    const xs: number[] = [];
    for (let x = w.x0; x < w.x1 - 1e-6; x += 50) xs.push(x);
    xs.push(w.x1);
    const ids = xs.map(nodeAt);
    net.ways.set(w.id, normalizeWay(w.id, ids, w.tags));
    xs.forEach((x, i) => {
      const [lon, lat] = plane.toLonLat(x, y);
      net.nodes.set(ids[i], normalizeNode(ids[i], lon, lat, {}));
    });
  }
  return net;
}

/**
 * Viaduct → at grade (`approach` m, not a multiple of 5 by default) → tunnel 2000 m → at grade
 * (`approach` m) → viaduct: the tunnel's two portals each with an approach at grade, the first lowered
 * on its end's side (off the grid), the second on its start's.
 */
const twoApproaches = (approach = 303, below: Record<string, string> = tunnelTags) =>
  network([
    { id: 1, x0: 0, x1: 500, tags: bridgeTags },
    { id: 2, x0: 500, x1: 500 + approach, tags: gradeTags },
    { id: 3, x0: 500 + approach, x1: 2500 + approach, tags: below },
    { id: 4, x0: 2500 + approach, x1: 2500 + 2 * approach, tags: gradeTags },
    { id: 5, x0: 2500 + 2 * approach, x1: 3000 + 2 * approach, tags: bridgeTags },
  ]);

const offOpts = {
  structures: "height" as const,
  ground: "compile" as const,
  pruneBelow: false,
  belowJoins: "compile" as const,
};
const cutOpts = { ...offOpts, portalApproach: "cut" as const };
const flat = () => 3;
type Result = ReturnType<typeof solvePlan>;
type RunPlanOf = Plan["runs"] extends Map<string, infer R> ? R : never;

const runsWhere = (plan: Plan, pick: (rp: RunPlanOf) => boolean) =>
  [...plan.runs.values()]
    .filter(pick)
    .map((r) => r.run.id)
    .toSorted();
const chunksOf = (res: Result, id: string) =>
  res.chunks.filter((c) => c.run === id).toSorted((a, b) => a.k - b.k);
/** The stations of a run's chunks in order, once each: s, road, ground, the chunk's structure. */
const stationsOf = (res: Result, id: string) => {
  const out: Array<{ s: number; z: number; g: number; structure: string }> = [];
  for (const c of chunksOf(res, id))
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      const s = c.st[i];
      const isRepeat = out.length > 0 && Math.abs(out[out.length - 1].s - s) < 1e-6;
      if (isRepeat) continue;
      out.push({ s, z: c.st[i + 3], g: c.st[i + 5], structure: c.structure });
    }
  return out;
};
/** The road of a run at run distance s, on the files' surface (profile.ts surfaceAt). */
const roadAt = (res: Result, id: string, s: number) => {
  const c = chunksOf(res, id).find(
    (x) => x.st[0] <= s + 1e-9 && s <= x.st[x.st.length - STATION_STRIDE] + 1e-9,
  )!;
  return surfaceAt(c.st, s).z;
};
const unsolved = (res: Result) =>
  res.diagnostics.filter((d) => d.kind === "vertical_unsolved" || d.kind === "parent_unsolved");
const linesOf = (res: Result, id: string) => res.groundTargets.get(id)!;

describe("L. 下げる長さ（S7-2 3.2）", () => {
  it("is the first grid multiple at which the descent reaches the tunnel's depth and margin", () => {
    for (const V of [40, 50, 60, 80] as const) {
      const L = portalApproachLength(V, 5);
      expect(L % 5).toBe(0);
      expect(descentWithin(V, L)).toBeGreaterThanOrEqual(TUNNEL_DEPTH_M + 0.1);
      expect(descentWithin(V, L - 5)).toBeLessThan(TUNNEL_DEPTH_M + 0.1);
    }
    // Step 1's lengths, from today's depth (S7-3c may change the depth, and these with it).
    expect(([40, 50, 60, 80] as const).map((V) => portalApproachLength(V, 5))).toEqual([135, 170, 215, 305]);
  });
});

describe("A. 高架 → 地平 → トンネル（S7-2 3.4）", () => {
  const off = planNetwork(twoApproaches(), new Set(), null, [], offOpts);
  const cut = planNetwork(twoApproaches(), new Set(), null, [], cutOpts);
  const resOff = solvePlan(off, flat, []);
  const resCut = solvePlan(cut, flat, []);
  const [g1, g2] = runsWhere(cut, (r) => r.ground);
  const [t] = runsWhere(cut, (r) => r.below);

  it("plans the two approaches from the plan alone: L 215 m at V60, the end's side from the grid station before S − L", () => {
    expect(loweredApproaches(off).byRun.size).toBe(0);
    const a = loweredApproaches(cut);
    const [first, second] = [a.byRun.get(g1)!, a.byRun.get(g2)!];
    expect(first[0]).toBeNull();
    expect(first[1]).toMatchObject({ below: t, belowAtStart: true, L: 215, sStart: 85, V: 60 });
    expect(first[1]!.lengthM).toBeCloseTo(303 - 85, 6);
    expect(second[0]).toMatchObject({ below: t, belowAtStart: false, L: 215, sStart: 215, lengthM: 215 });
    expect(second[1]).toBeNull();
  });

  it("the tunnel's first and last stations keep the box and cover with cut, not without; T1–T13 stay 0", () => {
    expect(unsolved(resOff)).toEqual([]);
    expect(unsolved(resCut)).toEqual([]);
    const depthAt = (res: Result, atStart: boolean) => {
      const st = stationsOf(res, t);
      const p = atStart ? st[0] : st[st.length - 1];
      return p.g - p.z;
    };
    for (const atStart of [true, false]) {
      expect(depthAt(resOff, atStart)).toBeLessThan(TUNNEL_DEPTH_M - 1);
      expect(depthAt(resCut, atStart)).toBeGreaterThanOrEqual(TUNNEL_DEPTH_M - 0.05);
    }
    const v = violationsOf(resCut, resCut.chunks, () => undefined, true);
    expect(Object.values(v).map((x) => x.count)).toEqual(Object.values(v).map(() => 0));
    expect(danglingOf(resCut.runs)).toEqual([]);
  });

  it("the stretch's start stays in the band about the design ground line, and the stretch is a cut", () => {
    for (const [id, sStart, atStart] of [
      [g1, 85, false],
      [g2, 215, true],
    ] as const) {
      const lines = linesOf(resCut, id);
      const k = lines.stations.findIndex((s) => Math.abs(s - sStart) < 1e-6);
      expect(Math.abs(roadAt(resCut, id, sStart) - lines.line[k])).toBeLessThanOrEqual(1.5 + 0.03);
      const deep = stationsOf(resCut, id).filter((x) => (atStart ? x.s < sStart - 60 : x.s > sStart + 60));
      expect(deep.length).toBeGreaterThan(0);
      expect(deep.every((x) => x.structure === "cut")).toBe(true);
    }
  });

  it("measures groundFit against the lowered target, over an approach of L′ at a lowered end", () => {
    const fit = (id: string) => resCut.runs.find((r) => r.id === id)!.groundFit!;
    expect(fit(g1).approachM[1]).toBeCloseTo(303 - 85, 6);
    expect(fit(g2).approachM[0]).toBe(215);
    // At the seam the lowered target is the tunnel's own there; the design ground line stays at the ground.
    const lines = linesOf(resCut, g1);
    expect(lines.target[lines.target.length - 1]).toBeCloseTo(3 - TUNNEL_DEPTH_M, 6);
    expect(lines.line[lines.line.length - 1]).toBeCloseTo(3, 6);
    // Without the flag the target is the line itself.
    const plain = linesOf(resOff, g1);
    expect(plain.target).toBe(plain.line);
  });
});

describe("E. 要約の欄と T12（S7-2 3.3・3.7、追記 2 B）", () => {
  const cut = planNetwork(twoApproaches(), new Set(), null, [], cutOpts);
  const res = solvePlan(cut, flat, []);
  const [t] = runsWhere(cut, (r) => r.below);
  const summary = res.runs.find((r) => r.id === t)!;

  it("writes the portals on the tunnel's summary, the same numbers the compiler measured from", () => {
    expect(summary.start.portalAt).toEqual({ offsetM: 218, z: 3, V: 60 });
    expect(summary.end.portalAt).toEqual({ offsetM: 215, z: 3, V: 60 });
    expect(portalAtOfSummary(summary)).toEqual(belowLinksOf(cut, flat).get(t)!.portalAt);
  });

  it("the compiler and T12 both measure the tunnel from the portals beyond its ends (ceilingFrom)", () => {
    const compiled = belowLinksOf(cut, flat).get(t)!;
    const fromFile = new Map([[t, { ...compiled, portalAt: portalAtOfSummary(summary)! }]]);
    const { portalAt: _dropped, ...plain } = compiled;
    expect(hasPortalsBeyond(belowLinksOf(cut, flat), t)).toBe(true);
    expect(hasPortalsBeyond(fromFile, t)).toBe(true);
    // Without the fields no end of the tunnel goes on under the ground: its own ends, ceilingAt's.
    expect(hasPortalsBeyond(new Map([[t, plain as BelowLinkRun]]), t)).toBe(false);
  });

  /**
   * T12's count over the files with the tunnel's second station raised `by` m, the fields kept or
   * dropped. Why not the first: since 3.6 the portal record there is cut → tunnel, and T12 reads a
   * tunnel's mouth as a cut's station (checks.checkCover), with or without the fields.
   */
  const t12Raised = (by: number, isKept: boolean) => {
    const chunks = res.chunks.map((c) => {
      const isFirst = c.run === t && c.k === 0;
      if (!isFirst) return c;
      const st = [...c.st];
      st[STATION_STRIDE + 3] += by;
      return { ...c, st };
    });
    const runs = res.runs.map((r) => {
      const isDropped = r.id === t && !isKept;
      if (!isDropped) return r;
      const { portalAt: _a, ...start } = r.start;
      const { portalAt: _b, ...end } = r.end;
      return { ...r, start, end };
    });
    return violationsOf({ ...res, runs }, chunks, () => undefined, true).T12.count;
  };

  it("T12 reads the ceilings near the tunnel's portal from the fields: raised to the ground it is a violation, without the fields none", () => {
    expect(t12Raised(0, true)).toBe(0);
    expect(t12Raised(TUNNEL_DEPTH_M, true)).toBeGreaterThan(0);
    expect(t12Raised(TUNNEL_DEPTH_M, false)).toBe(0);
  });

  it("the fields survive writing and reading the files (report.json and the tiles' run summaries)", () => {
    const written = JSON.parse(JSON.stringify(res.runs)) as typeof res.runs;
    const read = written.find((r) => r.id === t)!;
    expect(portalAtOfSummary(read)).toEqual(belowLinksOf(cut, flat).get(t)!.portalAt);
    const tileRun = [...packTiles(res.chunks, written, [], 14).values()]
      .flatMap((tile) => tile.runs)
      .find((r) => r.id === t)!;
    expect([tileRun.start.portalAt, tileRun.end.portalAt]).toEqual([read.start.portalAt, read.end.portalAt]);
    const chunks = JSON.parse(JSON.stringify(res.chunks)) as typeof res.chunks;
    expect(violationsOf({ ...res, runs: written }, chunks, () => undefined, true).T12.count).toBe(0);
  });
});

describe("B. 短い取付け（L より短い地平 run）", () => {
  const cut = planNetwork(twoApproaches(120), new Set(), null, [], cutOpts);
  const resCut = solvePlan(cut, flat, []);
  const resOff = solvePlan(planNetwork(twoApproaches(120), new Set(), null, [], offOpts), flat, []);
  const [g1] = runsWhere(cut, (r) => r.ground);
  const [t] = runsWhere(cut, (r) => r.below);
  const [v1] = runsWhere(cut, (r) => !r.ground && !r.below && r.run.ways.includes(1));

  it("lowers the whole run, solves, and keeps the viaduct's end before it in the band", () => {
    const a = loweredApproaches(cut).byRun.get(g1)![1]!;
    expect(a.sStart).toBe(0);
    expect(a.L).toBeCloseTo(120, 6);
    expect(a.lengthM).toBeCloseTo(120, 6);
    expect(unsolved(resCut)).toEqual([]);
    const v = violationsOf(resCut, resCut.chunks, () => undefined, true);
    expect(Object.values(v).map((x) => x.count)).toEqual(Object.values(v).map(() => 0));
    const viaductEnd = stationsOf(resCut, v1).at(-1)!;
    expect(Math.abs(viaductEnd.z - linesOf(resCut, g1).line[0])).toBeLessThanOrEqual(1.5 + 0.03);
  });

  it("leaves the tunnel's first station less short of cover than without", () => {
    const depth = (res: Result) => {
      const p = stationsOf(res, t)[0];
      return p.g - p.z;
    };
    expect(depth(resCut)).toBeGreaterThan(depth(resOff) + 1);
  });
});

describe("C. 取付けの上を通るランプ（S7-2 3.5）", () => {
  /**
   * twoApproaches, and an exit ramp leaving the first viaduct at x 450 that runs over the first approach
   * (y 4) and comes down to the ground at x 790, just before the portal: off lets the pair go there (the
   * ramp touches down within its climb), cut keeps it tied over the lowered stretch.
   */
  const withRamp = () => {
    const net = twoApproaches();
    const xs = [520, 600, 650, 700, 750, 790];
    const nodes = xs.map((x, i) => [900001 + i, x, 4] as const);
    for (const [id, x, y] of nodes) {
      const [lon, lat] = plane.toLonLat(x, y);
      net.nodes.set(id, normalizeNode(id, lon, lat, {}));
    }
    const ids = [100450, ...nodes.map((n) => n[0])];
    net.ways.set(
      90,
      normalizeWay(90, ids, { highway: "motorway_link", oneway: "yes", bridge: "yes", layer: "1" }),
    );
    return net;
  };
  const opts = { touchdown: "all" as const };
  const off = planNetwork(withRamp(), new Set(), null, [], { ...offOpts, ...opts });
  const cut = planNetwork(withRamp(), new Set(), null, [], { ...cutOpts, ...opts });
  const [g1] = runsWhere(cut, (r) => r.ground);
  const [ramp] = runsWhere(cut, (r) => r.run.ways.includes(90));
  const pairsOf = (plan: Plan) =>
    plan.pairs.filter((p) => (p.a === g1 && p.b === ramp) || (p.a === ramp && p.b === g1));

  it("lets the pair go without the flag and keeps it tied over the lowered stretch with it", () => {
    expect(pairsOf(off).length).toBeGreaterThan(0);
    expect(pairsOf(off).some((p) => p.untied)).toBe(true);
    const inStretch = pairsOf(cut).filter((p) => (p.a === g1 ? p.sa : p.sb) >= 85);
    expect(inStretch.length).toBeGreaterThan(0);
    expect(inStretch.every((p) => !p.untied)).toBe(true);
  });

  it("short of a level over the approach without the flag, a level apart with it, the approach going down rather than the ramp up", () => {
    const resOff = solvePlan(off, flat, []);
    const resCut = solvePlan(cut, flat, []);
    expect(unsolved(resCut)).toEqual([]);
    /** Per station of the ramp over the approach: the ramp's run distance, its height over the approach, the level. */
    const over = (res: Result) =>
      pairStations(res.chunks)
        .filter((p) => (p.a === ramp && p.b === g1) || (p.a === g1 && p.b === ramp))
        .map((p) =>
          p.a === ramp
            ? { s: p.sa, under: p.sb, dz: p.dz, level: p.levelApart }
            : { s: p.sb, under: p.sa, dz: -p.dz, level: p.levelApart },
        );
    // Over the lowered stretch (the approach's s 85 on), where the ramp is short of a level without the flag.
    const shortOff = over(resOff).filter((p) => p.under >= 85 && p.dz < p.level - 0.01);
    expect(shortOff.length).toBeGreaterThan(0);
    const cutAt = new Map(over(resCut).map((p) => [p.s.toFixed(2), p]));
    for (const p of shortOff) {
      const q = cutAt.get(p.s.toFixed(2))!;
      expect(q.dz).toBeGreaterThanOrEqual(q.level - 0.01);
      // The approach went down: the ramp stands where it stood (well under a level up).
      expect(Math.abs(roadAt(resCut, ramp, p.s) - roadAt(resOff, ramp, p.s))).toBeLessThan(0.5);
    }
  });
});

describe("D. 並ぶ 2 本の取付け（S7-2 3.6）", () => {
  /** twoApproaches, and beside it (8 m north) a second carriageway: the same (`beside` tunnel) or at grade on. */
  const pairNet = (isTunnelBeside: boolean) => {
    const net = twoApproaches();
    const second: WaySpec[] = isTunnelBeside
      ? [
          { id: 11, x0: 0, x1: 500, tags: bridgeTags },
          { id: 12, x0: 500, x1: 803, tags: gradeTags },
          { id: 13, x0: 803, x1: 2803, tags: tunnelTags },
          { id: 14, x0: 2803, x1: 3106, tags: gradeTags },
          { id: 15, x0: 3106, x1: 3606, tags: bridgeTags },
        ]
      : [
          { id: 11, x0: 0, x1: 500, tags: bridgeTags },
          { id: 12, x0: 500, x1: 1300, tags: gradeTags },
          { id: 15, x0: 1300, x1: 1800, tags: bridgeTags },
        ];
    return network(second, 8, 500000, net);
  };
  const solve = (isTunnelBeside: boolean, opts: typeof offOpts) => {
    const plan = planNetwork(pairNet(isTunnelBeside), new Set(), null, [], opts);
    return { plan, res: solvePlan(plan, flat, []) };
  };
  const aOf = (plan: Plan) => runsWhere(plan, (r) => r.ground && r.run.ways.includes(2))[0];
  const bOf = (plan: Plan) => runsWhere(plan, (r) => r.ground && r.run.ways.includes(12))[0];

  it("two lowered approaches side by side stay cuts under the ground, each with the other's opening", () => {
    const { plan: off, res: resOff } = solve(true, offOpts);
    const { plan, res } = solve(true, cutOpts);
    const [a, b] = [aOf(plan), bOf(plan)];
    expect(off.pairs.some((p) => p.a === a && p.b === b && p.relation === "same")).toBe(true);
    expect(unsolved(res)).toEqual([]);
    const v = violationsOf(res, res.chunks, () => undefined, true);
    expect(Object.values(v).map((x) => x.count)).toEqual(Object.values(v).map(() => 0));
    for (const [id, other, side] of [
      [a, b, "left"],
      [b, a, "right"],
    ] as const) {
      // Under the ground (past the band below the line) no embankment chunk, nor a viaduct one over the
      // last metres where each is "above" the other's tunnel by the layers (追記 3 の 1); off: C2's.
      const deep = stationsOf(res, id).filter((x) => x.s > 150);
      expect(deep.every((x) => x.g - x.z < 0.3 || x.structure === "cut")).toBe(true);
      expect(deep.some((x) => x.g - x.z > 3 && x.structure === "cut")).toBe(true);
      const openings = chunksOf(res, id)
        .flatMap((c) => c.openings ?? [])
        .filter((o) => o.with === other);
      expect(openings.length).toBeGreaterThan(0);
      expect(new Set(openings.map((o) => o.side))).toEqual(new Set([side]));
      expect(chunksOf(resOff, id).some((c) => (c.openings ?? []).some((o) => o.with === other))).toBe(false);
    }
  });

  it("an approach beside a run at grade that is not lowered keeps C2 there: no opening", () => {
    const { plan, res } = solve(false, cutOpts);
    const [a, b] = [aOf(plan), bOf(plan)];
    expect(loweredApproaches(plan).byRun.has(b)).toBe(false);
    expect(chunksOf(res, a).some((c) => (c.openings ?? []).some((o) => o.with === b))).toBe(false);
    expect(chunksOf(res, b).some((c) => (c.openings ?? []).length > 0)).toBe(false);
  });

  it("writes the approach's cut beyond the tunnel's lowered end in its portals (cut → tunnel), alone or beside another", () => {
    for (const net of [twoApproaches(), pairNet(true)]) {
      const plan = planNetwork(net, new Set(), null, [], cutOpts);
      const res = solvePlan(plan, flat, []);
      const [t] = runsWhere(plan, (r) => r.below && r.run.ways.includes(3));
      const portals = chunksOf(res, t).flatMap((c) => c.portals ?? []);
      expect([portals[0].from, portals[0].to]).toEqual(["cut", "tunnel"]);
      expect([portals.at(-1)!.from, portals.at(-1)!.to]).toEqual(["tunnel", "cut"]);
    }
  });

  it("where an approach is taken out of `above` over the other's tunnel, it stands less than a level over it (追記 3 の 1 の番人)", () => {
    const { plan, res } = solve(true, cutOpts);
    const lowered = loweredApproaches(plan).byRun;
    const isIn = (id: string, s: number) =>
      (lowered.get(id) ?? []).some(
        (a) => a !== null && (a.atStart ? s <= a.sStart + 1e-6 : s >= a.sStart - 1e-6),
      );
    // The approach's stations over the other's tunnel (the plan's "above" by the layers), under the ground.
    const over = pairStations(res.chunks).filter(
      (p) => isIn(p.a, p.sa) && plan.runs.get(p.b)!.below && plan.runs.get(p.a)!.ground,
    );
    expect(over.length).toBeGreaterThan(0);
    expect(over.filter((p) => p.dz >= p.levelApart - 0.01)).toEqual([]);
    // Both approaches end at the tunnels' depth, in a cut.
    for (const id of [aOf(plan), bOf(plan)]) {
      const end = stationsOf(res, id).at(-1)!;
      expect(end.g - end.z).toBeGreaterThanOrEqual(TUNNEL_DEPTH_M - 0.05);
      expect(end.structure).toBe("cut");
    }
  });
});

describe("F・判定 1. 下げない端（S7-2 3.1、追記 1 判定 1）", () => {
  const isSame = (net: Network) => {
    const a = solvePlan(planNetwork(net, new Set(), null, [], offOpts), flat, []);
    const b = solvePlan(planNetwork(net, new Set(), null, [], cutOpts), flat, []);
    expect(b.chunks).toEqual(a.chunks);
    expect(b.runs).toEqual(a.runs);
  };

  it("an approach to a below run that is a cut alone is not lowered: the files are off's", () => {
    const plan = planNetwork(twoApproaches(303, cutTags), new Set(), null, [], cutOpts);
    expect(loweredApproaches(plan).byRun.size).toBe(0);
    isSame(twoApproaches(303, cutTags));
  });

  it("a run at grade between two tunnels whose two stretches overlap is lowered at neither end", () => {
    const net = network([
      { id: 1, x0: 0, x1: 500, tags: bridgeTags },
      { id: 2, x0: 500, x1: 1500, tags: tunnelTags },
      { id: 3, x0: 1500, x1: 1633, tags: gradeTags },
      { id: 4, x0: 1633, x1: 2633, tags: tunnelTags },
      { id: 5, x0: 2633, x1: 3133, tags: bridgeTags },
    ]);
    const a = loweredApproaches(planNetwork(net, new Set(), null, [], cutOpts));
    expect(a.byRun.size).toBe(0);
    expect(a.skipped.map((s) => [s.atStart, s.reason])).toEqual([
      [true, "both-portals"],
      [false, "both-portals"],
    ]);
    isSame(net);
  });
});

describe("G. off は今のまま", () => {
  it("writes no portalAt without the flag", () => {
    const res = solvePlan(planNetwork(twoApproaches(), new Set(), null, [], offOpts), flat, []);
    expect(res.runs.some((r) => "portalAt" in r.start || "portalAt" in r.end)).toBe(false);
  });
});

describe("H. 範囲に依らない（T8）", () => {
  it("a box over the tunnel alone writes the same heights and ends as the whole", () => {
    const net = twoApproaches();
    const [lonA, latA] = plane.toLonLat(1500, -50);
    const [lonB, latB] = plane.toLonLat(1700, 50);
    const box = { minLon: lonA, minLat: latA, maxLon: lonB, maxLat: latB };
    const a = solvePlan(planNetwork(net, new Set(), box, [], cutOpts), flat, []);
    const b = solvePlan(planNetwork(net, new Set(), null, [], cutOpts), flat, []);
    expect(a.runs.length).toBeGreaterThan(0);
    // T12 gives the box's files the same answer (the tunnel's own summary carries its portals).
    expect(violationsOf(a, a.chunks, () => undefined, true).T12.count).toBe(0);
    for (const r of a.runs) {
      const other = b.runs.find((x) => x.id === r.id)!;
      expect([r.start, r.end]).toEqual([other.start, other.end]);
      expect(chunksOf(a, r.id).map((c) => [...c.st])).toEqual(chunksOf(b, r.id).map((c) => [...c.st]));
    }
  });
});
