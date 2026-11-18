import { describe, expect, it } from "vitest";
import { belowJoinsRefusal, shippedFolderRefusal } from "../scripts/expresswayGuards";
import { belowDeferralOf, TUNNEL_DEPTH_M } from "../src/expressway/below";
import { joinsOf, portalEndsOf } from "../src/expressway/belowScore";
import { checkJunction } from "../src/expressway/checks";
import { planNetwork, type Plan, portalApproachEnds, solvePlan } from "../src/expressway/compile";
import { STATION_STRIDE, XW_FEATURES, XW_READER_FEATURES, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { buildChains, type Network, normalizeNode, normalizeWay, splitRuns } from "../src/expressway/network";
import { danglingOf } from "../src/expressway/report";
import { violationsOf } from "../src/expressway/violations";
import { isSupportedMeta } from "../src/world/expresswayDeck";

// S7-3 (`--below-junctions compile`): the below runs met at a junction or at a loop's seam are compiled.
// What must hold: they are written and hang from the right parent, their ceilings are measured from the
// real portals beyond an end going on under the ground (T3 and T12 pass), the parent carries an opening
// for the child, the range takes the below parents, and without the flag nothing changes.

const plane = planeAt(139.75, 35.65);
type WaySpec = { id: number; x0: number; x1: number; tags: Record<string, string> };
const bridge = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };
const cut = { highway: "motorway", cutting: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
const tunnel = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
const link = { highway: "motorway_link", oneway: "yes" };
const linkBridge = { ...link, bridge: "yes", layer: "1" };
const linkTunnel = { ...link, tunnel: "yes", layer: "-1" };

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

/** A ring of radius 600 m in four ways, `tags[i]` for way i + 1 (way 1 first on the chain). */
function ring(tags: Array<Record<string, string>>): Network {
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
    net.ways.set(w + 1, normalizeWay(w + 1, refs, tags[w]));
  }
  return net;
}

const height = { structures: "height" as const, ground: "compile" as const };
const on = { ...height, pruneBelow: false, belowJoins: "compile" as const };
const off = { ...height, pruneBelow: false };
const flat = () => 3;
const xOf = (lon: number, lat: number) => plane.toXY(lon, lat)[0];
const yOf = (lon: number, lat: number) => plane.toXY(lon, lat)[1];

const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  for (const list of out.values()) list.sort((a, b) => a.k - b.k);
  return out;
};
const runsOf = (res: ReturnType<typeof solvePlan>) => new Map(res.runs.map((r) => [r.id, r]));
const belowOf = (plan: Plan) => new Set([...plan.runs.values()].filter((r) => r.below).map((r) => r.run.id));

/** The 7c0 net: viaduct → at grade → cut 800 m → at grade → viaduct, a ramp at grade leaving at `from`. */
function cutWithRamp(from = 101200, x0 = 1200): Network {
  return addWays(
    network([
      { id: 81, x0: 0, x1: 500, tags: bridge },
      { id: 82, x0: 500, x1: 800, tags: atGrade },
      { id: 83, x0: 800, x1: 1600, tags: cut },
      { id: 84, x0: 1600, x1: 1900, tags: atGrade },
      { id: 85, x0: 1900, x1: 2400, tags: bridge },
    ]),
    [
      [200001, x0 + 50, -15],
      [200002, x0 + 100, -40],
      [200003, x0 + 150, -80],
      [200004, x0 + 200, -130],
      [200005, x0 + 250, -190],
      [200006, x0 + 300, -260],
      [200007, x0 + 350, -340],
    ],
    [
      [86, link, [from, 200001, 200002, 200003, 200004]],
      [87, linkBridge, [200004, 200005, 200006, 200007]],
    ],
  );
}

/**
 * A tunnel main line under a hill (viaduct 0–1000, tunnel 1000–3000, viaduct beyond) and a ramp
 * leaving it under the ground at x = `at` (`merge`: joining there instead): a tunnel link 650 m
 * south, then at grade and on a viaduct. The hill: 30 m over x 1100–2900 north of y −450, 3 m
 * elsewhere, so the ramp comes out where the ground falls.
 */
function tunnelWithRamp(at: number, merge = false): Network {
  const xs = [0, 30, 80, 150, 200, 200, 200, 200, 200, 200, 200, 200, 200];
  const ys = [0, -20, -60, -120, -200, -300, -400, -500, -560, -620, -680, -740, -800];
  const nodes: Array<[number, number, number]> = xs.slice(1).map((dx, i) => [500001 + i, at + dx, ys[i + 1]]);
  const ids = [nodeAt(at), ...nodes.map((n) => n[0])];
  const ordered = merge ? ids.toReversed() : ids;
  const tunnelPart = merge ? ordered.slice(4) : ordered.slice(0, 9);
  const groundPart = merge ? ordered.slice(2, 5) : ordered.slice(8, 11);
  const bridgePart = merge ? ordered.slice(0, 3) : ordered.slice(10);
  return addWays(
    network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 3000, tags: tunnel },
      { id: 3, x0: 3000, x1: 4000, tags: bridge },
    ]),
    nodes,
    merge
      ? [
          [70, linkBridge, bridgePart],
          [71, link, groundPart],
          [72, linkTunnel, tunnelPart],
        ]
      : [
          [70, linkTunnel, tunnelPart],
          [71, link, groundPart],
          [72, linkBridge, bridgePart],
        ],
  );
}
const hill = (lon: number, lat: number) => {
  const x = xOf(lon, lat);
  const y = yOf(lon, lat);
  const isHill = x > 1100 && x < 2900 && y > -450;
  return isHill ? 30 : 3;
};

describe("A. 見送りの理由（compile）", () => {
  it("compiles a loop's seam and a junction, and still defers the universe's edge", () => {
    const loop = ring([tunnel, bridge, bridge, bridge]);
    const [chain] = buildChains(loop);
    const [below] = splitRuns(loop, chain).filter((r) => r.below);
    expect(belowDeferralOf(chain, below, new Map(), new Set())).toBe("loop-seam");
    expect(belowDeferralOf(chain, below, new Map(), new Set(), "compile")).toBeNull();
    const straight = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1500, tags: tunnel },
    ]);
    const [c] = buildChains(straight);
    const [, t] = splitRuns(straight, c);
    const end = c.nodes[c.nodes.length - 1];
    const met = new Map([[end, [c.id, "c99"]]]);
    expect(belowDeferralOf(c, t, met, new Set())).toBe("junction");
    expect(belowDeferralOf(c, t, met, new Set(), "compile")).toBeNull();
    expect(belowDeferralOf(c, t, met, new Set([end]), "compile")).toBe("universe-edge");
  });

  it("leaves nothing deferred but the universe's edge in a plan with the flag", () => {
    expect(
      planNetwork(ring([tunnel, bridge, bridge, bridge]), new Set(), null, [], on).belowDeferred,
    ).toEqual([]);
    expect(
      planNetwork(ring([tunnel, bridge, bridge, bridge]), new Set(), null, [], off).belowDeferred,
    ).toEqual(["1"]);
  });
});

describe("B. 地平のランプと掘割の分合流（7c0 の網を compile で）", () => {
  it("writes the cut and the ramp, the ramp hanging from the cut, with an opening on the cut's chunks on its side", () => {
    const plan = planNetwork(cutWithRamp(), new Set(), null, [], { ...height, belowJoins: "compile" });
    expect(plan.belowJunctions).toBeUndefined();
    const res = solvePlan(plan, flat, []);
    const runs = runsOf(res);
    expect([...runs.keys()].toSorted()).toEqual(["81", "82", "83", "84", "85", "86", "87"]);
    expect(runs.get("86")!.start).toMatchObject({ kind: "junction", parent: "83" });
    expect(danglingOf(res.runs)).toEqual([]);
    const openings = byRun(res.chunks)
      .get("83")!
      .flatMap((c) => c.openings ?? []);
    expect(openings.length).toBeGreaterThan(0);
    // The ramp leaves to the south (y < 0) of a line going east: the right side.
    expect(openings.every((o) => o.with === "86" && o.side === "right")).toBe(true);
    const same = byRun(res.chunks)
      .get("83")!
      .flatMap((c) => c.decks)
      .filter((d) => d.with === "86" && d.relation === "same");
    const sameFrom = Math.min(...same.map((d) => d.s0));
    const sameTo = Math.max(...same.map((d) => d.s1));
    expect(Math.min(...openings.map((o) => o.s0))).toBeCloseTo(sameFrom, 1);
    expect(Math.max(...openings.map((o) => o.s1))).toBeCloseTo(sameTo, 1);
    const joins = joinsOf(res.chunks, res.runs, belowOf(plan));
    expect(joins.list.find((j) => j.id === "86:start")).toMatchObject({ parent: "83", opening: true });
    expect(joins.withoutOpening).toBe(0);
  });

  it("at the node where the cut ends, a diverging ramp hangs from the run after it and a merging one from the run before it", () => {
    const diverging = planNetwork(cutWithRamp(101600, 1600), new Set(), null, [], {
      ...height,
      belowJoins: "compile",
    });
    const rd = runsOf(solvePlan(diverging, flat, []));
    expect(rd.get("86")!.start).toMatchObject({ kind: "junction", parent: "84" });
    // Without the flag (and with pruneBelow off, which keeps the pair) the run first along the chain.
    const before = planNetwork(cutWithRamp(101600, 1600), new Set(), null, [], off);
    expect(runsOf(solvePlan(before, flat, [])).get("86")!.start).toMatchObject({
      kind: "junction",
      parent: "83",
    });
    // The same ramp reversed: it joins at the cut's end node, so the cut (the run ending there) is its parent.
    const net = cutWithRamp(101600, 1600);
    for (const id of [86, 87]) {
      const w = net.ways.get(id)!;
      net.ways.set(id, normalizeWay(id, w.nodes.toReversed(), id === 86 ? link : linkBridge));
    }
    const merging = planNetwork(net, new Set(), null, [], { ...height, belowJoins: "compile" });
    expect(runsOf(solvePlan(merging, flat, [])).get("86")!.end).toMatchObject({
      kind: "junction",
      parent: "83",
    });
  });

  it("without the flag leaves the 7c0 rule as it was (the cut and the ramp dropped in a pruned build)", () => {
    const plan = planNetwork(cutWithRamp(), new Set(), null, [], height);
    expect(plan.belowDeferred).toContain("83");
    expect(plan.runs.has("86")).toBe(false);
  });
});

describe("C. トンネルの中で分かれるランプ", () => {
  for (const [name, at, merge] of [
    ["diverging deep under the hill", 1800, false],
    ["merging deep under the hill", 1800, true],
  ] as const) {
    it(`${name}: the ramp's tunnel is written at the parent's height and grade (T3), keeps its ceiling near the junction (T12), and its end there is no portal`, () => {
      const plan = planNetwork(tunnelWithRamp(at, merge), new Set(), null, [], on);
      const res = solvePlan(plan, hill, []);
      const runs = runsOf(res);
      const rampTunnel = merge ? "72" : "70";
      const end = merge ? runs.get(rampTunnel)!.end : runs.get(rampTunnel)!.start;
      expect(end).toMatchObject({ kind: "junction", parent: "2" });
      const chunks = byRun(res.chunks);
      const list = chunks.get(rampTunnel)!;
      const at0 = merge ? list[list.length - 1] : list[0];
      expect(checkJunction(at0, !merge, end.grade!, chunks.get("2")!)).toEqual([]);
      const v = violationsOf(res, res.chunks, () => undefined, true);
      expect([v.T3.count, v.T12.count]).toEqual([0, 0]);
      // Short of cover only by its own portal out on the low ground (the hill's edge falls 27 m at once),
      // never near the junction: there the descent is measured from the main line's far portals.
      const length = runs.get(rampTunnel)!.lengthM;
      for (const d of res.diagnostics.filter(
        (x) => x.kind === "tunnel_cover_short" && x.run === rampTunnel,
      )) {
        const [, from, to] = /at (\d+)–(\d+) m/.exec(d.detail)!.map(Number);
        const fromJunction = merge ? length - to : from;
        expect(fromJunction).toBeGreaterThan(length / 2);
      }
      expect(res.diagnostics.filter((d) => d.kind === "vertical_unsolved")).toEqual([]);
      // Near the junction the ramp is as deep as the main line's tunnel: the box and its cover.
      const st = merge ? list[list.length - 1].st : list[0].st;
      const k = merge ? st.length - 2 * STATION_STRIDE : STATION_STRIDE;
      expect(st[k + 5] - st[k + 3]).toBeGreaterThanOrEqual(TUNNEL_DEPTH_M - 0.05);
      // Its end at the junction: no portal, its portal record from tunnel to tunnel.
      const portals = list.flatMap((c) => c.portals ?? []);
      const atJunction = merge ? portals[portals.length - 1] : portals[0];
      expect([atJunction.from, atJunction.to]).toEqual(["tunnel", "tunnel"]);
      const ends = portalEndsOf(res.chunks, res.runs, belowOf(plan)).list.map((p) => p.id);
      expect(ends).not.toContain(`${rampTunnel}:${merge ? "end" : "start"}`);
      expect(danglingOf(res.runs)).toEqual([]);
    });
  }

  it("near the main line's portal the ramp's ceiling falls away by the way from that portal, and it solves", () => {
    const plan = planNetwork(tunnelWithRamp(1150), new Set(), null, [], on);
    const res = solvePlan(plan, hill, []);
    expect(
      res.diagnostics.filter((d) => d.kind === "vertical_unsolved" || d.kind === "parent_unsolved"),
    ).toEqual([]);
    const v = violationsOf(res, res.chunks, () => undefined, true);
    expect([v.T3.count, v.T12.count]).toEqual([0, 0]);
    expect(runsOf(res).has("70")).toBe(true);
  });

  it("over the junction's stretch on one surface, the ramp and the main line stand within 5 cm of each other", () => {
    const plan = planNetwork(tunnelWithRamp(1800), new Set(), null, [], on);
    const res = solvePlan(plan, hill, []);
    const chunks = byRun(res.chunks);
    const same = chunks
      .get("70")!
      .flatMap((c) => c.decks)
      .filter((d) => d.with === "2" && d.relation === "same");
    expect(same.length).toBeGreaterThan(0);
    const zOf = (id: string, s: number) => {
      const c = chunks
        .get(id)!
        .find((x) => x.st[0] <= s + 1e-6 && x.st[x.st.length - STATION_STRIDE] >= s - 1e-6)!;
      let best = c.st[3];
      let gap = Infinity;
      for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
        const d = Math.abs(c.st[i] - s);
        if (d < gap) {
          gap = d;
          best = c.st[i + 3];
        }
      }
      return best;
    };
    const parentS = runsOf(res).get("70")!.start.parentS!;
    // At the junction itself the two are one point (T3); a metre in, still on one surface.
    expect(Math.abs(zOf("70", 0) - zOf("2", parentS))).toBeLessThanOrEqual(0.05);
  });

  it("T12 catches a road lifted over the ceiling next to the junction", () => {
    const plan = planNetwork(tunnelWithRamp(1800), new Set(), null, [], on);
    const res = solvePlan(plan, hill, []);
    const lifted = res.chunks.map((c) => {
      const isFirst = c.run === "70" && c.k === 0;
      if (!isFirst) return c;
      const st = [...c.st];
      for (let i = STATION_STRIDE; i < st.length; i += STATION_STRIDE) st[i + 3] = st[i + 5] - 1;
      return { ...c, st };
    });
    const v = violationsOf(res, lifted, () => undefined, true);
    expect(v.T12.count).toBeGreaterThan(0);
  });
});

describe("D. 輪の継ぎ目", () => {
  it("a seam between two below runs: both written, the last seamed onto the first, no deck pair between them", () => {
    const loop = ring([tunnel, bridge, bridge, tunnel]);
    const plan = planNetwork(loop, new Set(), null, [], on);
    const res = solvePlan(plan, () => 20, []);
    const runs = runsOf(res);
    expect(runs.has("1")).toBe(true);
    expect(runs.has("4")).toBe(true);
    expect(runs.get("4")!.end).toMatchObject({ kind: "seam", parent: "1" });
    expect(runs.get("1")!.start.kind).toBe("open");
    expect(plan.pairs.filter((p) => (p.a === "1" && p.b === "4") || (p.a === "4" && p.b === "1"))).toEqual(
      [],
    );
    const v = violationsOf(res, res.chunks, () => undefined, true);
    expect([v.T3.count, v.T12.count]).toEqual([0, 0]);
    const ends = portalEndsOf(res.chunks, res.runs, belowOf(plan)).list.map((p) => p.id);
    expect(ends).not.toContain("1:start");
    expect(ends).not.toContain("4:end");
  });

  for (const [name, tags, approach] of [
    ["the run at grade last, the tunnel first", [tunnel, bridge, bridge, atGrade], "4:end"],
    ["the tunnel last, the run at grade first", [atGrade, bridge, bridge, tunnel], "1:start"],
  ] as const) {
    it(`a seam of a run at grade and a tunnel (${name}): the approach is the run at grade's end there, with or without the flag, and the tunnel seams onto it`, () => {
      const loop = ring([...tags]);
      const withFlag = planNetwork(loop, new Set(), null, [], on);
      const without = planNetwork(loop, new Set(), null, [], off);
      const endsOn = portalApproachEnds(withFlag).map((e) => `${e.run}:${e.end}`);
      const endsOff = portalApproachEnds(without).map((e) => `${e.run}:${e.end}`);
      expect(endsOn).toContain(approach);
      expect(endsOff).toContain(approach);
      const res = solvePlan(withFlag, flat, []);
      const runs = runsOf(res);
      const tunnelId = tags[0] === tunnel ? "1" : "4";
      const groundId = tunnelId === "1" ? "4" : "1";
      const seamEnd = tunnelId === "1" ? runs.get("1")!.start : runs.get("4")!.end;
      expect(seamEnd).toMatchObject({ kind: "seam", parent: groundId });
      const portal = portalEndsOf(res.chunks, res.runs, belowOf(withFlag)).list.find(
        (p) => p.id === `${tunnelId}:${tunnelId === "1" ? "start" : "end"}`,
      );
      expect(portal?.approach?.run).toBe(groundId);
    });
  }

  it("a loop of viaducts alone keeps its ends with the flag", () => {
    const loop = ring([bridge, bridge, bridge, bridge]);
    const a = runsOf(solvePlan(planNetwork(loop, new Set(), null, [], on), flat, []));
    const b = runsOf(solvePlan(planNetwork(loop, new Set(), null, [], off), flat, []));
    expect([...a.values()].map((r) => [r.id, r.start.kind, r.end.kind])).toEqual(
      [...b.values()].map((r) => [r.id, r.start.kind, r.end.kind]),
    );
  });
});

describe("E. 高架だけの分合流は不変", () => {
  it("a ramp at the node between a viaduct and a run at grade keeps its parent with the flag", () => {
    const net = addWays(
      network([
        { id: 1, x0: 0, x1: 1000, tags: bridge },
        { id: 2, x0: 1000, x1: 1600, tags: atGrade },
        { id: 3, x0: 1600, x1: 2600, tags: bridge },
      ]),
      [
        [200001, 1050, -20],
        [200002, 1100, -60],
        [200003, 1150, -120],
      ],
      [[9, linkBridge, [101000, 200001, 200002, 200003]]],
    );
    const a = runsOf(solvePlan(planNetwork(net, new Set(), null, [], on), flat, []));
    const b = runsOf(solvePlan(planNetwork(net, new Set(), null, [], off), flat, []));
    expect(a.get("9")!.start).toEqual(b.get("9")!.start);
  });
});

describe("F. 範囲に依らない（T8）と範囲の閉包", () => {
  it("a box over the ramp's tunnel alone takes the tunnel it leaves, and both write the same heights and ends as the whole", () => {
    const net = tunnelWithRamp(1800);
    // Over the ramp's tunnel alone (x 1950–2050, y −450 to −300): its parent, the main line's tunnel, is outside.
    const [lonA, latA] = plane.toLonLat(1950, -450);
    const [lonB, latB] = plane.toLonLat(2050, -300);
    const box = { minLon: lonA, minLat: latA, maxLon: lonB, maxLat: latB };
    const ranged = planNetwork(net, new Set(), box, [], on);
    expect(ranged.wanted.has("2")).toBe(true);
    const whole = planNetwork(net, new Set(), null, [], on);
    const a = solvePlan(ranged, hill, []);
    const b = solvePlan(whole, hill, []);
    expect(danglingOf(a.runs)).toEqual([]);
    const ca = byRun(a.chunks);
    const cb = byRun(b.chunks);
    for (const id of ["2", "70"]) {
      expect(ca.get(id)!.map((c) => [...c.st])).toEqual(cb.get(id)!.map((c) => [...c.st]));
      const ra = a.runs.find((r) => r.id === id)!;
      const rb = b.runs.find((r) => r.id === id)!;
      expect([ra.start.kind, ra.end.kind]).toEqual([rb.start.kind, rb.end.kind]);
    }
  });
});

describe("G. 書式", () => {
  it("writes no openings without the flag, and the game refuses a file naming below-junctions", () => {
    const res = solvePlan(planNetwork(cutWithRamp(), new Set(), null, [], off), flat, []);
    expect(res.chunks.every((c) => !("openings" in c))).toBe(true);
    expect(XW_FEATURES).toContain("below-junctions");
    expect(XW_READER_FEATURES).not.toContain("below-junctions");
    expect(isSupportedMeta({ version: 6, features: ["below", "height-structures"] })).toBe(true);
    expect(isSupportedMeta({ version: 6, features: ["below", "height-structures", "below-junctions"] })).toBe(
      false,
    );
  });
});

describe("H. 番人", () => {
  it("compile needs --out, the structures by height, the runs at grade and components; an unknown value stops", () => {
    expect(
      shippedFolderRefusal({
        hasOut: false,
        isBelowAll: false,
        isBlocks: false,
        isV1: false,
        v2Flags: [],
        isBelowJoinsCompile: true,
      }),
    ).toMatch(/below-junctions/);
    expect(
      shippedFolderRefusal({
        hasOut: true,
        isBelowAll: false,
        isBlocks: false,
        isV1: false,
        v2Flags: [],
        isBelowJoinsCompile: true,
      }),
    ).toBeNull();
    expect(belowJoinsRefusal("defer", "tags", "skip", "blocks")).toBeNull();
    expect(belowJoinsRefusal("compile", "height", "compile", "components")).toBeNull();
    expect(belowJoinsRefusal("compile", "tags", "compile", "components")).toMatch(/structures/);
    expect(belowJoinsRefusal("compile", "height", "skip", "components")).toMatch(/ground/);
    expect(belowJoinsRefusal("compile", "height", "compile", "blocks")).toMatch(/partition/);
    expect(belowJoinsRefusal("maybe", "height", "compile", "components")).toMatch(/unknown/);
  });
});

describe("J. pruned との組", () => {
  it("drops a tunnel joining two components as before, without an error", () => {
    const net = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1200, tags: cut },
      { id: 3, x0: 1200, x1: 1700, tags: tunnel },
      { id: 4, x0: 1700, x1: 2700, tags: bridge },
    ]);
    const plan = planNetwork(net, new Set(), null, [], { ...height, belowJoins: "compile" });
    expect(plan.belowDeferrals.map((d) => [d.id, d.reason])).toEqual([["2", "bridging"]]);
  });
});
