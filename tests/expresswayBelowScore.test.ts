import { describe, expect, it } from "vitest";
import { HEIGHT_STRUCTURES } from "../src/expressway/assumptions";
import { belowDeferralOf, isBelowCompiled, TUNNEL_DEPTH_M } from "../src/expressway/below";
import {
  approachStretchesOf,
  joinsOf,
  overApproachOf,
  PORTAL_APPROACH_M,
  portalEndsOf,
  undergroundChanges,
  undergroundOf,
  unplannedOf,
} from "../src/expressway/belowScore";
import {
  planNetwork,
  type Plan,
  portalApproachEnds,
  solvePlan,
  unplannedChains,
} from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { buildChains, type Network, normalizeNode, normalizeWay, splitRuns } from "../src/expressway/network";
import { LEVEL_APART_M } from "../src/expressway/overlap";
import { flattenReport, REPORT_VERSION, ReportSchema } from "../src/expressway/report";
import { join } from "node:path";
import { readFileSync } from "node:fs";

// S7-1 (the scorecard's `underground`, belowScore.ts): S7 is judged by these counts, so each must count
// what it names — every deferred below run under exactly one of the five reasons, every portal end
// with its approach, and a deck too low over an approach near a portal — while the compiler's answers
// stay as they were.

const plane = planeAt(139.75, 35.65);
type WaySpec = { id: number; x0: number; x1: number; tags: Record<string, string> };
const bridge = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };
const cut = { highway: "motorway", cutting: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
const tunnel = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
const link = { highway: "motorway_link", oneway: "yes" };
const linkBridge = { ...link, bridge: "yes", layer: "1" };

/** The node id of x along y = 0. */
const nodeAt = (x: number) => 100000 + Math.round(x);

/** Ways end to end along y = 0, a node every 50 m, consecutive ways sharing their end nodes. */
function network(ways: WaySpec[]): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
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

/** Adds ways along new nodes (an existing node id keeps its place): [way id, tags, node ids]. */
function addWays(
  net: Network,
  nodes: Array<[number, number, number]>,
  ways: Array<[number, Record<string, string>, number[]]>,
): Network {
  for (const [id, x, y] of nodes) {
    const [lon, lat] = plane.toLonLat(x, y);
    net.nodes.set(id, normalizeNode(id, lon, lat, {}));
  }
  for (const [id, tags, ids] of ways) net.ways.set(id, normalizeWay(id, ids, tags));
  return net;
}

/** A ring of radius 600 m in four ways (way 1 first, a tunnel; the rest viaducts): 都心環状線's shape. */
function ring(): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  const n = 72;
  const ids = Array.from({ length: n }, (_, i) => 300000 + i);
  ids.forEach((id, i) => {
    const a = (2 * Math.PI * i) / n;
    const [lon, lat] = plane.toLonLat(600 * Math.cos(a), 600 * Math.sin(a));
    net.nodes.set(id, normalizeNode(id, lon, lat, {}));
  });
  const quarter = n / 4;
  for (let w = 0; w < 4; w++) {
    const refs = Array.from({ length: quarter + 1 }, (_, i) => ids[(w * quarter + i) % n]);
    net.ways.set(w + 1, normalizeWay(w + 1, refs, w === 0 ? tunnel : bridge));
  }
  return net;
}

const height = { structures: "height" as const };
/** Run 2's approach stretches of a plan, on its written chunks. */
const ofRun2 = (p: Plan, chunks: XwChunk[]) =>
  approachStretchesOf(chunks, portalApproachEnds(p)).filter((st) => st.run === "2");
const compile = { ...height, ground: "compile" as const };
const reasonsOf = (plan: Plan) => plan.belowDeferrals.map((d) => [d.id, d.reason]);

/** The ids of every deferral are the ids of belowDeferred, in its order (the sum the S7 table needs). */
function expectSameAsDeferred(plan: Plan) {
  expect(plan.belowDeferrals.map((d) => d.id)).toEqual(plan.belowDeferred);
}

describe("見送った地下 run の理由（below.ts belowDeferralOf、compile.ts Plan.belowDeferrals）", () => {
  it("loop-seam: a tunnel at the ends of a closed chain (the loop's seam)", () => {
    const net = ring();
    const [chain] = buildChains(net);
    expect(chain.closed).toBe(true);
    const plan = planNetwork(net, new Set(), null);
    expect(reasonsOf(plan)).toEqual([["1", "loop-seam"]]);
    expectSameAsDeferred(plan);
  });

  it("universe-edge: a tunnel ending at a node where its way goes on outside the universe", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1500, tags: tunnel },
    ]);
    const plan = planNetwork(net, new Set([101500]), null);
    expect(reasonsOf(plan)).toEqual([["2", "universe-edge"]]);
    expectSameAsDeferred(plan);
  });

  it("junction: a tunnel ending where another chain meets it under the ground", () => {
    const net = addWays(
      network([
        { id: 1, x0: 0, x1: 1000, tags: bridge },
        { id: 2, x0: 1000, x1: 1500, tags: tunnel },
      ]),
      [
        [200001, 1500, 100],
        [200002, 1500, 200],
      ],
      [[9, linkBridge, [101500, 200001, 200002]]],
    );
    const plan = planNetwork(net, new Set(), null);
    expect(reasonsOf(plan)).toEqual([["2", "junction"]]);
    expectSameAsDeferred(plan);
  });

  it("ground-junction: a cut a ramp at grade leaves (S6 PR 7c0's dropBelowJunctions)", () => {
    const net = addWays(
      network([
        { id: 81, x0: 0, x1: 500, tags: bridge },
        { id: 82, x0: 500, x1: 800, tags: atGrade },
        { id: 83, x0: 800, x1: 1600, tags: cut },
        { id: 84, x0: 1600, x1: 1900, tags: atGrade },
        { id: 85, x0: 1900, x1: 2400, tags: bridge },
      ]),
      [
        [200001, 1250, -15],
        [200002, 1300, -40],
        [200003, 1350, -80],
        [200004, 1400, -130],
        [200005, 1450, -190],
        [200006, 1500, -260],
        [200007, 1550, -340],
      ],
      [
        [86, link, [101200, 200001, 200002, 200003, 200004]],
        [87, linkBridge, [200004, 200005, 200006, 200007]],
      ],
    );
    const plan = planNetwork(net, new Set(), null, [], compile);
    expect(reasonsOf(plan)).toEqual([["83", "ground-junction"]]);
    expect(plan.belowDeferrals[0]).toMatchObject({
      cls: "expressway",
      ref: "C1",
      lengthM: expect.any(Number),
    });
    expect(plan.belowDeferrals[0].lengthM).toBeCloseTo(800, -1);
    expectSameAsDeferred(plan);
  });

  it("bridging: a tunnel that would join two components of viaducts (pruneBelow)", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1200, tags: cut },
      { id: 3, x0: 1200, x1: 1700, tags: tunnel },
      { id: 4, x0: 1700, x1: 2700, tags: bridge },
    ]);
    const plan = planNetwork(net, new Set(), null);
    expect(reasonsOf(plan)).toEqual([["2", "bridging"]]);
    expectSameAsDeferred(plan);
    // --below all keeps it: no reason is recorded for a run compiled.
    const all = planNetwork(net, new Set(), null, [], { pruneBelow: false });
    expect(all.belowDeferrals).toEqual([]);
  });

  it("one reason per run, the first that holds: a loop's seam over a junction at its end", () => {
    const net = ring();
    const [chain] = buildChains(net);
    const [below] = splitRuns(net, chain).filter((r) => r.below);
    const end = chain.nodes[0];
    const met = new Map<number, string[]>([[end, [chain.id, "c99"]]]);
    expect(belowDeferralOf(chain, below, met, new Set([end]))).toBe("loop-seam");
  });

  it("names a reason exactly where a below run is not compiled, and none where it is", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1500, tags: tunnel },
    ]);
    const [chain] = buildChains(net);
    const [viaduct, below] = splitRuns(net, chain);
    const end = chain.nodes[chain.nodes.length - 1];
    const alone = new Map([[end, [chain.id]]]);
    const met = new Map([[end, [chain.id, "c99"]]]);
    const cases: Array<[Map<number, string[]>, Set<number>, string | null, boolean]> = [
      [alone, new Set(), null, true],
      [met, new Set(), "junction", false],
      [alone, new Set([end]), "universe-edge", false],
      [met, new Set([end]), "universe-edge", false],
    ];
    for (const [nodeChains, outside, reason, compiled] of cases) {
      expect(belowDeferralOf(chain, below, nodeChains, outside)).toBe(reason);
      expect(isBelowCompiled(chain, below, nodeChains, outside)).toBe(compiled);
    }
    // A run not below has no reason and is no below run compiled.
    expect(belowDeferralOf(chain, viaduct, new Map(), new Set())).toBeNull();
    expect(isBelowCompiled(chain, viaduct, new Map(), new Set())).toBe(false);
  });

  it("is in the range by its own line for boxes: a tunnel outside the box, of a chain the box reaches, is not", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1500, tags: tunnel },
    ]);
    const [lonA, latA] = plane.toLonLat(-10, -10);
    const [lonB, latB] = plane.toLonLat(300, 10);
    const box = { minLon: lonA, minLat: latA, maxLon: lonB, maxLat: latB };
    const ranged = planNetwork(net, new Set([101500]), box);
    expect(ranged.belowDeferrals.map((d) => [d.id, d.inRange])).toEqual([["2", false]]);
    const whole = planNetwork(net, new Set([101500]), null);
    expect(whole.belowDeferrals.map((d) => [d.id, d.inRange])).toEqual([["2", true]]);
  });

  it("is in the range when only its line crosses a box, its nodes on either side of it (review 3)", () => {
    // Nodes every 50 m along the tunnel; the box spans x 1210–1240 only, between two of them.
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1500, tags: tunnel },
    ]);
    const [lonA, latA] = plane.toLonLat(1210, -10);
    const [lonB, latB] = plane.toLonLat(1240, 10);
    const box = { minLon: lonA, minLat: latA, maxLon: lonB, maxLat: latB };
    const plan = planNetwork(net, new Set([101500]), box);
    expect(plan.belowDeferrals.map((d) => [d.id, d.inRange])).toEqual([["2", true]]);
  });

  it("is in a chosen range (--range ship) when its chain has a run of the range, else not", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1500, tags: tunnel },
    ]);
    const chosen = planNetwork(net, new Set([101500]), null, [], { wanted: () => new Set(["1"]) });
    expect(chosen.belowDeferrals.map((d) => [d.id, d.inRange])).toEqual([["2", true]]);
    const none = planNetwork(net, new Set([101500]), null, [], { wanted: () => new Set<string>() });
    expect(none.belowDeferrals.map((d) => [d.id, d.inRange])).toEqual([["2", false]]);
  });
});

describe("坑口の端と取付けの上の床版（belowScore.ts portalEndsOf・overApproachOf）", () => {
  // 高架 → 地平 400 m → トンネル 600 m → 地平 400 m: the portals at x 1400 and 2000, at the ground.
  const net = network([
    { id: 1, x0: 0, x1: 1000, tags: bridge },
    { id: 2, x0: 1000, x1: 1400, tags: atGrade },
    { id: 3, x0: 1400, x1: 2000, tags: tunnel },
    { id: 4, x0: 2000, x1: 2400, tags: atGrade },
  ]);
  const plan = planNetwork(net, new Set(), null, [], compile);
  const result = solvePlan(plan, () => 3, []);
  const belowIds = new Set([...plan.runs.values()].filter((r) => r.below).map((r) => r.run.id));
  const stretches = approachStretchesOf(result.chunks, portalApproachEnds(plan));

  it("lists both ends of the tunnel with their approach at grade, the road at the ground and the depth it lacks", () => {
    expect([...belowIds]).toEqual(["3"]);
    const portals = portalEndsOf(result.chunks, result.runs, belowIds);
    expect(portals.list.map((p) => [p.id, p.into, p.approach?.run])).toEqual([
      ["3:start", "tunnel", "2"],
      ["3:end", "tunnel", "4"],
    ]);
    const band = HEIGHT_STRUCTURES.value.ground.bandM + 0.05;
    for (const p of portals.list) {
      // W10: the portal's end is where its approach is, within the ground's band, so the tunnel lacks
      // about all of its depth there.
      expect(Math.abs(p.dzM)).toBeLessThan(band);
      expect(p.coverShortM).toBeCloseTo(TUNNEL_DEPTH_M + p.dzM, 2);
      expect(p.coverShortM).toBeGreaterThan(TUNNEL_DEPTH_M - band);
      expect(Math.abs(p.approach!.offM)).toBeLessThan(band);
    }
    expect(portals.ends).toBe(2);
    expect(portals.coverShort).toBe(2);
    expect(portals.maxShortM).toBe(Math.max(...portals.list.map((p) => p.coverShortM!)));
  });

  it("leaves out a cut's shortfall (null) and an end seaming to another below run", () => {
    const cutNet = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1400, tags: atGrade },
      { id: 3, x0: 1400, x1: 2000, tags: cut },
      { id: 4, x0: 2000, x1: 2400, tags: atGrade },
    ]);
    const p = planNetwork(cutNet, new Set(), null, [], compile);
    const res = solvePlan(p, () => 3, []);
    const portals = portalEndsOf(res.chunks, res.runs, new Set(["3"]));
    expect(portals.list.map((e) => [e.id, e.into, e.coverShortM])).toEqual([
      ["3:start", "cut", null],
      ["3:end", "cut", null],
    ]);
    // Told that run 2 is below too, 3's start seams to it: that end is no portal.
    const both = portalEndsOf(res.chunks, res.runs, new Set(["2", "3"]));
    expect(both.list.map((e) => e.id)).not.toContain("3:start");
  });

  /** Run 2's chunks copied as another run beside it (2 m to the north), `rise` m higher, kept where s is in [s0, s1]. */
  const deckOver = (rise: number, s0: number, s1: number): XwChunk[] =>
    result.chunks
      .filter((c) => c.run === "2")
      .map((c) => {
        const st: number[] = [];
        for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
          const s = c.st[i];
          const isKept = s >= s0 && s <= s1;
          if (!isKept) continue;
          const [x, y] = plane.toXY(c.st[i + 1], c.st[i + 2]);
          const [lon, lat] = plane.toLonLat(x, y + 2);
          st.push(s, lon, lat, c.st[i + 3] + rise, c.st[i + 4], c.st[i + 5], c.st[i + 6]);
        }
        return { ...c, id: `90:${c.k}`, run: "90", chain: "c90", st };
      })
      .filter((c) => c.st.length >= 2 * STATION_STRIDE);

  it("looks over both approaches, each to 300 m exactly from its portal end", () => {
    expect(stretches).toEqual([
      { run: "2", end: "end", s0: 400 - PORTAL_APPROACH_M, s1: expect.closeTo(400, 0) },
      { run: "4", end: "start", s0: 0, s1: PORTAL_APPROACH_M },
    ]);
    const over = overApproachOf(result.chunks, stretches);
    expect(over.approaches.list.map((a) => a.id)).toEqual(["2:end", "4:start"]);
    expect(over.approaches.count).toBe(2);
  });

  it("counts one pair for a deck less than a level over the approach near the portal, only over its last 300 m", () => {
    const over = overApproachOf([...result.chunks, ...deckOver(2, 0, 400)], stretches);
    expect(over.pairs).toBe(1);
    const [pair] = over.list;
    expect(pair).toMatchObject({ id: "2|90", lower: "2", upper: "90" });
    expect(pair.minDzM).toBeCloseTo(2, 1);
    expect(pair.maxDzM).toBeCloseTo(2, 1);
    expect(pair.stations).toBeGreaterThan(0);
    expect(pair.offsetM).toBeCloseTo(2, 0);
    // Run 2 is 400 m long with the portal at its end: only s ≥ 100 is near it.
    expect(pair.s0).toBeGreaterThanOrEqual(400 - PORTAL_APPROACH_M - 1);
    expect(pair.s1).toBeCloseTo(400, -1);
  });

  it("counts none for a deck a level or more over it, nor for one over it farther than 300 m from the portal", () => {
    expect(
      overApproachOf([...result.chunks, ...deckOver(LEVEL_APART_M + 0.2, 0, 400)], stretches).pairs,
    ).toBe(0);
    expect(overApproachOf([...result.chunks, ...deckOver(2, 0, 80)], stretches).pairs).toBe(0);
  });

  it("counts a deck 6 cm over the approach and none at 5 cm or less (deckOverlaps' one surface, review 1)", () => {
    expect(overApproachOf([...result.chunks, ...deckOver(0.04, 0, 400)], stretches).pairs).toBe(0);
    expect(overApproachOf([...result.chunks, ...deckOver(0.06, 0, 400)], stretches).pairs).toBe(1);
  });

  it("counts apart (besideLowered) two lowered approaches side by side on one surface, both in their stretches (S7-2 追記 5)", () => {
    // Run 90 beside run 2, 0.3 m higher, one surface by the plan's decks: both lowered over s ≥ 200.
    const beside = deckOver(0.3, 0, 400).map((c) => ({
      ...c,
      decks: [{ with: "2", relation: "same" as const, s0: 0, s1: 400 }],
    }));
    const two = result.chunks.map((c) =>
      c.run === "2"
        ? { ...c, decks: [...c.decks, { with: "90", relation: "same" as const, s0: 0, s1: 400 }] }
        : c,
    );
    const lowered = new Map<string, Array<[number, number]>>([
      ["2", [[200, 400]]],
      ["90", [[200, 400]]],
    ]);
    const over = overApproachOf([...two, ...beside], stretches, lowered);
    // Near the portal outside the stretches (s 100–200) still a deck too low over the approach.
    expect(over.list.map((p) => p.id)).toEqual(["2|90"]);
    expect(over.list[0].s1).toBeLessThan(200);
    expect(over.besideLowered!.list.map((p) => p.id)).toEqual(["2|90"]);
    expect(over.besideLowered!.list[0].s0).toBeGreaterThanOrEqual(200 - 1e-6);
    // Without lowered stretches the shape of version 9: no besideLowered, every pair in `list`.
    const before = overApproachOf([...two, ...beside], stretches);
    expect(before.besideLowered).toBeUndefined();
    expect(before.list[0].s1).toBeCloseTo(400, -1);
    // Not one surface (a deck over it): in `list` even inside both stretches.
    const deck = overApproachOf([...result.chunks, ...deckOver(0.3, 0, 400)], stretches, lowered);
    expect(deck.besideLowered!.pairs).toBe(0);
    expect(deck.pairs).toBe(1);
  });

  it("takes the same approach whether the tunnel beyond is written, deferred or compiled outside the box (review 2)", () => {
    // (b) the tunnel ends where its way goes on outside the universe: deferred.
    const deferredNet = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1400, tags: atGrade },
      { id: 3, x0: 1400, x1: 2000, tags: tunnel },
    ]);
    const deferred = planNetwork(deferredNet, new Set([102000]), null, [], compile);
    expect(deferred.belowDeferrals.map((d) => d.id)).toEqual(["3"]);
    // (c) the tunnel compiled, the box reaching the viaduct and the run at grade only.
    const [lonA, latA] = plane.toLonLat(-10, -10);
    const [lonB, latB] = plane.toLonLat(1300, 10);
    const box = { minLon: lonA, minLat: latA, maxLon: lonB, maxLat: latB };
    const boxed = planNetwork(net, new Set(), box, [], compile);
    const boxedResult = solvePlan(boxed, () => 3, []);
    expect(boxedResult.runs.map((r) => r.id)).not.toContain("3");
    const expected = ofRun2(plan, result.chunks);
    expect(expected).toEqual([{ run: "2", end: "end", s0: expect.any(Number), s1: expect.any(Number) }]);
    expect(ofRun2(deferred, solvePlan(deferred, () => 3, []).chunks)).toEqual(expected);
    expect(ofRun2(boxed, boxedResult.chunks)).toEqual(expected);
  });

  it("puts all three into the scorecard's underground, the deferrals tallied by reason, class and ref", () => {
    const u = undergroundOf({
      deferred: [
        { id: "7", reason: "junction", cls: "ramp", ref: null, lengthM: 500, inRange: true },
        { id: "5", reason: "bridging", cls: "expressway", ref: "C1", lengthM: 1250, inRange: false },
      ],
      approachEnds: portalApproachEnds(plan),
      unplanned: [],
      chunks: result.chunks,
      runs: result.runs,
      belowIds,
    });
    expect(u.deferred.list.map((d) => d.id)).toEqual(["5", "7"]);
    expect(u.deferred.total).toEqual({
      main: { runs: 1, km: 1.25 },
      ramp: { runs: 1, km: 0.5 },
      street: { runs: 0, km: 0 },
    });
    expect(u.deferred.byReason.junction.ramp).toEqual({ runs: 1, km: 0.5 });
    expect(u.deferred.byReason["loop-seam"].main).toEqual({ runs: 0, km: 0 });
    expect(u.deferred.byRef).toEqual({ "-": { runs: 1, km: 0.5 }, C1: { runs: 1, km: 1.25 } });
    expect(u.deferred.inRange).toEqual({ runs: 1, km: 0.5 });
    expect(u.portals.ends).toBe(2);
    expect(u.overApproach.pairs).toBe(0);
  });
});

/** A committed baseline scorecard (tests/fixtures). */
const fixture = (name: string) =>
  ReportSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")));

describe("スコアカード版 7（report.ts）", () => {
  it("the ship baselines are the current version (11 since S7-2), each deferred run under one reason, adding up to the plan's count", () => {
    for (const [name, below] of [
      ["expresswayScorecard.ship.json", "pruned"],
      ["expresswayScorecard.ship-all.json", "all"],
    ] as const) {
      const r = fixture(name);
      expect([name, r.version, r.below]).toEqual([name, REPORT_VERSION, below]);
      const u = r.underground!;
      expect(u.deferred.list.length).toBe(r.plan.belowDeferred);
      const byReason = Object.values(u.deferred.byReason).reduce(
        (n, b) => n + b.main.runs + b.ramp.runs + b.street.runs,
        0,
      );
      expect(byReason).toBe(r.plan.belowDeferred);
      // --below all compiles what pruneBelow would drop: no run is deferred by the plan after it.
      const isAll = below === "all";
      if (isAll)
        expect(
          u.deferred.list.filter((d) => d.reason === "ground-junction" || d.reason === "bridging"),
        ).toEqual([]);
    }
  });

  it("a version-6 report still parses, and set beside its version 7 it differs by `underground` alone", () => {
    const seven = fixture("expresswayScorecard.ship.json");
    const { underground: _u, ...rest } = seven;
    const six = ReportSchema.parse({ ...rest, version: 6 });
    const before = flattenReport(six);
    const after = flattenReport(seven);
    const changed = [...before.keys()].filter((k) => k !== "version" && before.get(k) !== after.get(k));
    expect(changed).toEqual([]);
    const added = [...after.keys()].filter((k) => !before.has(k));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((k) => k.startsWith("underground."))).toBe(true);
  });
});

describe("スコアカード版 9（belowScore.ts joinsOf・unplannedOf、compile.ts unplannedChains）", () => {
  it("counts a chain with a tunnel way and no viaduct as unplanned, reaching the range through the run it leaves", () => {
    // The main line (viaduct, then tunnel) and a link leaving it at x 500: tunnel 150 m, then at grade.
    const net = addWays(
      network([
        { id: 1, x0: 0, x1: 1000, tags: bridge },
        { id: 2, x0: 1000, x1: 1500, tags: tunnel },
      ]),
      [
        [400001, 500, -50],
        [400002, 500, -100],
        [400003, 500, -150],
        [400004, 500, -250],
        [400005, 500, -350],
      ],
      [
        [70, { ...link, tunnel: "yes", layer: "-1" }, [100500, 400001, 400002, 400003]],
        [71, link, [400003, 400004, 400005]],
      ],
    );
    const plan = planNetwork(net, new Set(), null);
    const list = unplannedChains(plan);
    expect(list.map((u) => [u.chain, u.cls, u.inRange, u.ends])).toEqual([
      ["c70", "ramp", true, [["1"], []]],
    ]);
    expect(list[0].belowM).toBeCloseTo(150, -1);
    expect(list[0].lengthM).toBeCloseTo(350, -1);
    const u = unplannedOf(list);
    expect(u.total).toEqual({ chains: 1, km: expect.closeTo(0.35, 1), belowKm: expect.closeTo(0.15, 1) });
    expect(u.inRange.chains).toBe(1);
    // Not reached by a box that holds neither the chain nor the run it leaves.
    const [lonA, latA] = plane.toLonLat(1200, -10);
    const [lonB, latB] = plane.toLonLat(1300, 10);
    const box = { minLon: lonA, minLat: latA, maxLon: lonB, maxLat: latB };
    // The box holds the tunnel's line only, which is deferred (its end leaves the universe): no run of the range.
    const far = planNetwork(net, new Set([101500]), box);
    expect(unplannedChains(far).map((x) => x.inRange)).toEqual([false]);
  });

  it("a version-8 report still parses, and set beside its version 9 it differs by joins and unplanned alone", () => {
    const nine = fixture("expresswayScorecard.ship-all.json");
    const { joins: _j, unplanned: _u, ...under } = nine.underground!;
    const eight = ReportSchema.parse({ ...nine, underground: under, version: 8 });
    const before = flattenReport(eight);
    const after = flattenReport(nine);
    const changed = [...before.keys()].filter(
      (key) => key !== "version" && before.get(key) !== after.get(key),
    );
    expect(changed).toEqual([]);
    const added = [...after.keys()].filter((key) => !before.has(key));
    expect(added.length).toBeGreaterThan(0);
    const isNew = (key: string) =>
      key.startsWith("underground.joins.") || key.startsWith("underground.unplanned.");
    expect(added.every(isNew)).toBe(true);
  });

  it("a version-10 report still parses, and set beside its version 11 it differs by the lowered ends' counts alone (0 without the flag)", () => {
    const eleven = fixture("expresswayScorecard.ship-all.json");
    const { lowered, loweredCoverShort, ...portals } = eleven.underground!.portals;
    expect([lowered, loweredCoverShort]).toEqual([0, 0]);
    expect(
      eleven.underground!.portals.list.every((p) => p.lowered === undefined && p.notLowered === undefined),
    ).toBe(true);
    const ten = ReportSchema.parse({
      ...eleven,
      underground: { ...eleven.underground!, portals },
      version: 10,
    });
    const before = flattenReport(ten);
    const after = flattenReport(eleven);
    const changed = [...before.keys()].filter(
      (key) => key !== "version" && before.get(key) !== after.get(key),
    );
    expect(changed).toEqual([]);
    const added = [...after.keys()].filter((key) => !before.has(key));
    expect(added.toSorted()).toEqual([
      "underground.portals.lowered",
      "underground.portals.loweredCoverShort",
    ]);
  });

  it("lists a junction under the ground with its parent, node and structures, and no opening without the flag", () => {
    // The 7c0 net under --below all: the ramp at grade 86 leaves the cut 83 inside it.
    const net = addWays(
      network([
        { id: 81, x0: 0, x1: 500, tags: bridge },
        { id: 82, x0: 500, x1: 800, tags: atGrade },
        { id: 83, x0: 800, x1: 1600, tags: cut },
        { id: 84, x0: 1600, x1: 1900, tags: atGrade },
        { id: 85, x0: 1900, x1: 2400, tags: bridge },
      ]),
      [
        [200001, 1250, -15],
        [200002, 1300, -40],
        [200003, 1350, -80],
        [200004, 1400, -130],
        [200005, 1450, -190],
        [200006, 1500, -260],
        [200007, 1550, -340],
      ],
      [
        [86, link, [101200, 200001, 200002, 200003, 200004]],
        [87, linkBridge, [200004, 200005, 200006, 200007]],
      ],
    );
    const plan = planNetwork(net, new Set(), null, [], { ...compile, pruneBelow: false });
    const res = solvePlan(plan, () => 3, []);
    const below = new Set([...plan.runs.values()].filter((r) => r.below).map((r) => r.run.id));
    const joins = joinsOf(res.chunks, res.runs, below);
    const junction = joins.list.find((j) => j.id === "86:start")!;
    expect(junction).toMatchObject({
      kind: "junction",
      parent: "83",
      node: "inside",
      parentStructure: "cut",
    });
    expect(junction.opening).toBe(false);
    expect(joins.withoutOpening).toBe(joins.junctions);
    // The seams of the cut with the runs at grade beside it are no seams between two below runs.
    expect(joins.list.filter((j) => j.kind === "seam")).toEqual([]);
  });
});

describe("スコアカードの比べ（belowScore.ts undergroundChanges）", () => {
  const base = undergroundOf({
    deferred: [
      { id: "5", reason: "bridging", cls: "expressway", ref: "C1", lengthM: 1000, inRange: true },
      { id: "6", reason: "junction", cls: "ramp", ref: null, lengthM: 300, inRange: true },
    ],
    approachEnds: [],
    unplanned: [],
    chunks: [],
    runs: [],
    belowIds: new Set(),
  });

  it("names the deferred runs on one side only and those deferred for another reason, and nothing for the same", () => {
    const other = undergroundOf({
      deferred: [
        { id: "5", reason: "junction", cls: "expressway", ref: "C1", lengthM: 1000, inRange: true },
        { id: "7", reason: "loop-seam", cls: "expressway", ref: "C1", lengthM: 400, inRange: false },
      ],
      approachEnds: [],
      unplanned: [],
      chunks: [],
      runs: [],
      belowIds: new Set(),
    });
    const changes = undergroundChanges(base, other);
    expect(changes.absent).toBeNull();
    expect(changes.deferred).toEqual({
      added: ["7"],
      removed: ["6"],
      reasonChanged: ["5 bridging→junction"],
      inRangeChanged: [],
    });
    expect(undergroundChanges(base, base).deferred).toEqual({
      added: [],
      removed: [],
      reasonChanged: [],
      inRangeChanged: [],
    });
  });

  it("says which side has no section (a version-6 report beside a version-7 one)", () => {
    expect(undergroundChanges(undefined, base).absent).toBe("a");
    expect(undergroundChanges(base, undefined).absent).toBe("b");
  });
});

describe("汐留の取付け（基準 fixture）", () => {
  it("finds the exit 24402125 too low over the 汐留 approach 45068170 near its portal (plan 0 節の 4)", () => {
    // ship/pruned writes the default range's runs with the same heights (T8), so its baseline holds them.
    const u = fixture("expresswayScorecard.ship.json").underground!;
    expect(u.overApproach.approaches.list.map((a) => a.id)).toContain("45068170:end");
    const pair = u.overApproach.list.find((p) => p.id === "45068170|24402125");
    expect(pair).toBeDefined();
    expect(pair!.minDzM).toBeLessThan(LEVEL_APART_M);
  });
});
