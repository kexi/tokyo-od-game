import { describe, expect, it } from "vitest";
import { GIRDER_DEPTH, GIRDER_MIN, HEIGHT_STRUCTURES } from "../src/expressway/assumptions";
import {
  checkClearance,
  checkClearanceWindows,
  checkCover,
  checkSeamHeading,
  isTunnelFreeRun,
} from "../src/expressway/checks";
import { trackingOf } from "../src/expressway/report";
import { isFailing, planNetwork, solvePlan, windowsToWiden } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import {
  afterSpanning,
  checkHeightStructures,
  clearsOnThinGirder,
  decideViaduct,
  isWindowOver,
  sameKept,
  forceViaduct,
  GIRDER_GIVE_M,
  girderFor,
  CUT_BELOW_M,
  EMBANKMENT_REACH_M,
  HEIGHT_DEAD_BAND_M,
  heightClassOf,
  heightStretches,
  isOpenGroundRuled,
  levelApartOver,
  openGroundStretches,
  VIADUCT_OVER_GROUND_M,
} from "../src/expressway/heightStructures";
import { isAutoAccepted } from "../src/expressway/ledger";
import { atGradeCrossingDetail, parseAtGradeCrossing } from "../src/expressway/allowlist";
import { structureCases } from "../scripts/expresswayCases";
import { deckOverlaps } from "../src/expressway/overlap";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import type { RunProblem } from "../src/expressway/vertical";
import { violationsOf } from "../src/expressway/violations";
import type { StructureDecision } from "../src/expressway/structureDecisions";

// P2.7-6 PR 1 (`--structures height`): the structure a viaduct-tagged run is drawn as comes from its
// solved height against the ground, the assumed floors no longer unsolve a run, a thinner girder
// takes a clearance short by up to 0.5 m, a road under an embankment or cut is blocked, and a short
// shallow tunnel keeps no ceiling. The tags' structures (the default) are as before.

const plane = planeAt(139.75, 35.65);

type WaySpec = { id: number; x0: number; x1: number; tags: Record<string, string> };

const bridge = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };
const tunnel80 = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: "80", ref: "B" };
const bridge80 = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "80", ref: "B" };

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

const xOf = (lon: number, lat: number) => plane.toXY(lon, lat)[0];

const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  for (const list of out.values()) list.sort((a, b) => a.k - b.k);
  return out;
};

const closedOf = (r: ReturnType<typeof solvePlan>) => r.closed.map((c) => c.run);

describe("区分の規則（heightStructures.ts）", () => {
  it("a road more than 0.5 m under the ground is a cut (R2), under the viaduct's height less the band an embankment, above it a viaduct", () => {
    expect(VIADUCT_OVER_GROUND_M).toBeCloseTo(4.5 + GIRDER_DEPTH.value, 9);
    expect(HEIGHT_DEAD_BAND_M).toBe(0.25);
    // A ground end sitting in the DEM within the band is no cut (review C2).
    expect(heightClassOf(2.8, 3)).toBe("embankment");
    expect(heightClassOf(2.6, 3)).toBe("embankment");
    expect(heightClassOf(2.49, 3)).toBe("cut");
    expect(CUT_BELOW_M).toBe(-0.5);
    expect(heightClassOf(3 + VIADUCT_OVER_GROUND_M - 0.2, 3)).toBe("viaduct");
    expect(heightClassOf(3 + VIADUCT_OVER_GROUND_M - 0.26, 3)).toBe("embankment");
  });

  it("over another deck it stays a viaduct, sharing a surface it is no cut, never merges a cut away, and an embankment in the air is a viaduct", () => {
    const line = (z: (s: number) => number) =>
      Array.from({ length: 401 }, (_, s) => ({ s, z: z(s), ground: 3 }));
    // 4 m over the ground throughout: an embankment, but over another deck at 100–200 a viaduct.
    const low = line(() => 7);
    expect(heightStretches(low).map((h) => h.structure)).toEqual(["embankment"]);
    const over = heightStretches(low, undefined, { above: [[100, 200]] });
    expect(over.map((h) => h.structure)).toEqual(["embankment", "viaduct", "embankment"]);
    // 1 m under the ground at 150–250, sharing a surface with another run at 100–300: no cut.
    const dip = line((s) => (s >= 150 && s <= 250 ? 2 : 7));
    expect(heightStretches(dip).map((h) => h.structure)).toContain("cut");
    expect(heightStretches(dip, undefined, { same: [[100, 300]] }).map((h) => h.structure)).toEqual([
      "embankment",
    ]);
    // A cut of 12 m is kept (R2's least length 10 m); one of 5 m is a bump and merges away.
    const pit = line((s) => (s >= 200 && s < 212 ? 2 : 20));
    expect(heightStretches(pit).map((h) => h.structure)).toEqual(["viaduct", "cut", "viaduct"]);
    const dent = line((s) => (s >= 200 && s < 205 ? 2 : 20));
    expect(heightStretches(dent).map((h) => h.structure)).toEqual(["viaduct"]);
    // 4–6 m over the ground in the middle, never under 3 m, off both ends: a viaduct in the air.
    const air = line((s) => (s >= 100 && s <= 300 ? 3 + 4 + Math.sin(s / 20) : 20));
    expect(heightStretches(air).map((h) => h.structure)).toEqual(["viaduct"]);
    // The same down to 1 m once reaches the ground: an embankment.
    const reach = line((s) => (s >= 100 && s <= 300 ? (s === 200 ? 4 : 7) : 20));
    expect(heightStretches(reach).map((h) => h.structure)).toEqual(["viaduct", "embankment", "viaduct"]);
    expect(EMBANKMENT_REACH_M).toBe(3);
    // A metre of embankment wedged between two cuts takes the cuts' class (169674665:3).
    const wedge = line((s) => (s >= 200 && s <= 201 ? 3 : 1));
    expect(heightStretches(wedge).map((h) => h.structure)).toEqual(["cut"]);
  });

  it("merges a stretch shorter than the smoothing length into its longer neighbour, whatever its class", () => {
    const samples = Array.from({ length: 301 }, (_, s) => {
      // 0–99 viaduct, 100–114 embankment (15 m: merged), 115–199 viaduct, 200–300 cut.
      const z = s < 100 ? 20 : s < 115 ? 5 : s < 200 ? 20 : 1;
      return { s, z, ground: 3 };
    });
    const got = heightStretches(samples);
    expect(got.map((h) => h.structure)).toEqual(["viaduct", "cut"]);
    expect(got[0].s0).toBe(0);
    expect(got[0].s1).toBeCloseTo(199.5, 6);
    expect(got[1].s1).toBe(300);
    // The same 25 m long stays its own.
    const longer = heightStretches(samples.map((p) => ({ ...p, z: p.s >= 100 && p.s < 125 ? 5 : p.z })));
    expect(longer.map((h) => h.structure)).toEqual(["viaduct", "embankment", "viaduct", "cut"]);
    expect(HEIGHT_STRUCTURES.value.smoothM).toBe(20);
  });

  it("the rule takes a cut up to 3 m deep and 150 m long and an embankment up to 500 m; beyond, the ledger lists it", () => {
    expect(isOpenGroundRuled({ structure: "cut", lengthM: 150, depthM: 3 })).toBe(true);
    expect(isOpenGroundRuled({ structure: "cut", lengthM: 151, depthM: 1 })).toBe(false);
    expect(isOpenGroundRuled({ structure: "cut", lengthM: 50, depthM: 3.1 })).toBe(false);
    expect(isOpenGroundRuled({ structure: "embankment", lengthM: 500, depthM: 0 })).toBe(true);
    expect(isOpenGroundRuled({ structure: "embankment", lengthM: 501, depthM: 0 })).toBe(false);
    // R1: an embankment under the ground past the dead band (a same-surface stretch) is listed.
    expect(isOpenGroundRuled({ structure: "embankment", lengthM: 100, depthM: 0.25 })).toBe(true);
    expect(isOpenGroundRuled({ structure: "embankment", lengthM: 100, depthM: 0.3 })).toBe(false);
    expect(isAutoAccepted({ kind: "embankment-stretch", measured: { lengthM: 100, depthM: 2.77 } })).toBe(
      false,
    );
    expect(isAutoAccepted({ kind: "cut-stretch", measured: { lengthM: 80, depthM: 2.5 } })).toBe(true);
    expect(isAutoAccepted({ kind: "cut-stretch", measured: { lengthM: 80, depthM: 3.5 } })).toBe(false);
    expect(isAutoAccepted({ kind: "embankment-stretch", measured: { lengthM: 600 } })).toBe(false);
    expect(isAutoAccepted({ kind: "thin-girder", measured: { girderM: GIRDER_MIN.value } })).toBe(true);
    expect(isAutoAccepted({ kind: "thin-girder", measured: { girderM: 1.6 } })).toBe(false);
  });
});

describe("窓の拡張（windowsToWiden、P2.7-3a の欠陥 1）", () => {
  it("a failure outside the lowered stretches adds ±150 m around it (within the run); one inside adds nothing", () => {
    // 41009552's first pass: lowered over [0, 160], then failing at 130 (inside) and at 900 (outside).
    expect(windowsToWiden([130], [[0, 160]], 2880)).toEqual([]);
    expect(windowsToWiden([900, 130], [[0, 160]], 2880)).toEqual([[750, 1050]]);
    expect(windowsToWiden([2800], [], 2880)).toEqual([[2650, 2880]]);
    // Two failures 100 m apart take one stretch.
    expect(windowsToWiden([900, 1000], [], 2880)).toEqual([[750, 1050]]);
  });
});

describe("桁高（girderFor・levelApartOver・deckOverlaps）", () => {
  it("a crossing 6.3 m over a road (第12条 4.5 m) takes a 1.8 m girder; at 6.1 m no girder thin enough takes it", () => {
    const H = 4.5;
    expect(girderFor([6.3 - H])).toBeCloseTo(1.8, 9);
    expect(girderFor([6.1 - H])).toBe(GIRDER_DEPTH.value);
    expect(girderFor([7.0 - H, 6.4 - H, 6.0 - H])).toBeCloseTo(1.9, 9);
    expect(GIRDER_GIVE_M).toBeCloseTo(0.5, 9);
  });

  it("at the last step a crossing short by up to the give, or a missed assumed floor, does not unsolve a height build's run; before it, by more, or by the tags it does", () => {
    const miss = (by: number, give?: RunProblem["give"]): RunProblem => ({
      what: "crossing",
      basis: "law",
      s: 100,
      by,
      text: "",
      ...(give ? { give } : {}),
    });
    expect(isFailing([miss(0.4, "girder")], true, true)).toBe(false);
    expect(isFailing([miss(0.4, "girder")], false, true)).toBe(true);
    expect(isFailing([miss(0.4, "girder")], true, false)).toBe(true);
    expect(isFailing([miss(0.6)], true, true)).toBe(true);
    const floor: RunProblem = { what: "floor", basis: "assumed", s: 50, by: 3, text: "" };
    expect(isFailing([floor], true, true)).toBe(false);
    expect(isFailing([floor], false, true)).toBe(true);
    expect(isFailing([floor], true, false)).toBe(true);
  });

  it("deck over deck: a level apart counts over the upper chunk's own girder (standard where it has none)", () => {
    expect(levelApartOver(GIRDER_DEPTH.value)).toBeCloseTo(6.7, 9);
    expect(levelApartOver(0)).toBeCloseTo(6.7, 9);
    expect(levelApartOver(1.8)).toBeCloseTo(6.3, 9);
    // Two chunks crossing at a right angle 6.4 m apart: an overlap on a 2.2 m girder, none on 1.8 m.
    const chunk = (id: string, along: "x" | "y", z: number, girder: number): XwChunk => {
      const st: number[] = [];
      for (let t = -40; t <= 40; t += 5) {
        const [lon, lat] = along === "x" ? plane.toLonLat(t, 0) : plane.toLonLat(0, t);
        st.push(t + 40, lon, lat, z, 0, 0, 0);
      }
      return {
        id: `${id}:0`,
        run: id,
        chain: id,
        k: 0,
        cls: "expressway",
        ref: null,
        name: null,
        structure: "viaduct",
        over: null,
        lanes: 2,
        laneWidth: 3.5,
        shoulderL: 1,
        shoulderR: 1,
        basis: "statute",
        V: 60,
        maxspeed: null,
        vh: 50,
        gmax: 0.05,
        g0: 0,
        g1: 0,
        h0: 0,
        h1: 0,
        girder,
        st,
        piers: [],
        cross: [],
        blocked: [],
        decks: [],
        prev: null,
        next: null,
      };
    };
    expect(deckOverlaps([chunk("1", "x", 16.4, 2.2), chunk("2", "y", 10, 2.2)])).toHaveLength(1);
    expect(deckOverlaps([chunk("1", "x", 16.4, 1.8), chunk("2", "y", 10, 2.2)])).toHaveLength(0);
    // The lower deck's thin girder does not help the upper one.
    expect(deckOverlaps([chunk("1", "x", 16.4, 2.2), chunk("2", "y", 10, 1.8)])).toHaveLength(1);
  });
});

/**
 * A viaduct (bridge, layer 1) between two stretches at grade: the ground is level at T.P. 3 m but
 * for a mound of 5.5 m just before the far end (x 690–790), so the deck coming down to the ground
 * end at x = 800 runs 2.5 m under the mound: the approach to a portal, as at 代官町.
 */
function mound(lon: number, lat: number): number {
  const x = xOf(lon, lat);
  const isOnMound = x >= 700 && x <= 780;
  if (isOnMound) return 5.5;
  if (x > 690 && x < 700) return 3 + ((x - 690) / 10) * 2.5;
  if (x > 780 && x < 790) return 5.5 - ((x - 780) / 10) * 2.5;
  return 3;
}

describe("坑口へ下りる取付け（合成網、代官町の型）", () => {
  const net = network([
    { id: 1, x0: -300, x1: 0, tags: atGrade },
    { id: 2, x0: 0, x1: 800, tags: bridge },
    { id: 3, x0: 800, x1: 1100, tags: atGrade },
  ]);
  const tags = solvePlan(planNetwork(net, new Set(), null), mound, []);
  const height = solvePlan(planNetwork(net, new Set(), null, [], { structures: "height" }), mound, []);

  it("by the tags the deck sunk 2.5 m under the mound closes the run (the assumed floor); by its height it is solved", () => {
    expect(closedOf(tags)).toEqual(["2"]);
    expect(closedOf(height)).toEqual([]);
  });

  it("under the mound the chunks are a cut, before it an embankment, the middle a viaduct; T13 holds and the cut has no girder or piers", () => {
    const list = byRun(height.chunks).get("2")!;
    const kinds = list.map((c) => c.structure);
    expect(kinds).toContain("viaduct");
    expect(kinds).toContain("embankment");
    expect(kinds).toContain("cut");
    const cut = list.filter((c) => c.structure === "cut");
    for (const c of cut) {
      expect(c.girder).toBe(0);
      expect(c.piers).toEqual([]);
      expect(c.st[0]).toBeGreaterThan(650);
    }
    expect(checkHeightStructures(list)).toEqual([]);
    // Every change of structure is a portal on the chunk after it.
    for (let k = 1; k < list.length; k++) {
      const isChange = list[k].structure !== list[k - 1].structure;
      if (!isChange) continue;
      expect(list[k].portals).toEqual([
        { s: list[k].st[0], from: list[k - 1].structure, to: list[k].structure },
      ]);
    }
    const stretches = openGroundStretches(list);
    const cutStretch = stretches.find((h) => h.structure === "cut")!;
    expect(cutStretch.depthM).toBeGreaterThan(1);
    expect(cutStretch.depthM).toBeLessThanOrEqual(2.6);
  });

  it("names the structures by height in no diagnostic of the assumed floors (they are a structure now)", () => {
    const floors = height.diagnostics.filter(
      (d) => d.kind === "deck_below_ground" || d.kind === "below_open_ground_floor",
    );
    expect(floors).toEqual([]);
    const v = violationsOf(
      { runs: height.runs, diagnostics: height.diagnostics },
      height.chunks,
      () => undefined,
      true,
    );
    for (const p of ["T1", "T2", "T3", "T4", "T5", "T13"] as const) expect(v[p].count, p).toBe(0);
  });

  it("the tags' build is as before: the same chunks whether the option is left out or says tags", () => {
    const plain = solvePlan(planNetwork(net, new Set(), null), mound, [], { structures: "tags" });
    expect(JSON.stringify(plain.chunks)).toBe(JSON.stringify(tags.chunks));
    expect(
      tags.chunks.every(
        (c) => c.structure === "viaduct" || c.structure === "tunnel" || c.structure === "cut",
      ),
    ).toBe(true);
  });
});

describe("構造の決定の表（structureDecisions.ts、S6 PR 7c）: 盛土の区間を高架に", () => {
  const net = network([
    { id: 1, x0: -300, x1: 0, tags: atGrade },
    { id: 2, x0: 0, x1: 800, tags: bridge },
    { id: 3, x0: 800, x1: 1100, tags: atGrade },
  ]);
  const plain = solvePlan(
    planNetwork(net, new Set(), null, [], { structures: "height", structureDecisions: [] }),
    mound,
    [],
  );
  const list = byRun(plain.chunks).get("2")!;
  const emb = list.find((c) => c.structure === "embankment")!;
  const [e0, e1] = [emb.st[0], emb.st[emb.st.length - STATION_STRIDE]];
  const mid = (e0 + e1) / 2;
  const row = (s0: number, s1: number): StructureDecision => ({
    run: "2",
    s0,
    s1,
    structure: "viaduct",
    reason: "test",
    decidedBy: "user",
    decidedAt: "2026-11-14",
    release: "test",
  });
  const structureAt = (chunks: XwChunk[], s: number) =>
    byRun(chunks)
      .get("2")!
      .find((c) => s >= c.st[0] && s <= c.st[c.st.length - STATION_STRIDE])!.structure;

  it("makes the decided stretch of an embankment a viaduct, the embankment before and after it kept, the heights unchanged, T13 holding", () => {
    expect(e1 - e0).toBeGreaterThan(40);
    const decided = row(mid - 10, mid + 10);
    const built = solvePlan(
      planNetwork(net, new Set(), null, [], { structures: "height", structureDecisions: [decided] }),
      mound,
      [],
    );
    expect(structureAt(built.chunks, mid)).toBe("viaduct");
    expect(structureAt(built.chunks, mid - 15)).toBe("embankment");
    expect(structureAt(built.chunks, mid + 15)).toBe("embankment");
    // Only the class changes: every station's height is the plain build's.
    const z = (chunks: XwChunk[]) =>
      byRun(chunks)
        .get("2")!
        .flatMap((c) => {
          const out: Array<[number, number]> = [];
          for (let i = 0; i < c.st.length; i += STATION_STRIDE) out.push([c.st[i], c.st[i + 3]]);
          return out;
        });
    const before = new Map(z(plain.chunks));
    for (const [s, zz] of z(built.chunks))
      if (before.has(s)) expect(Math.abs(zz - before.get(s)!)).toBeLessThanOrEqual(0.001);
    expect(
      checkHeightStructures(byRun(built.chunks).get("2")!, false, false, [true, true], [decided]),
    ).toEqual([]);
  });

  it("leaves a stretch the table does not name as it was", () => {
    const other = solvePlan(
      planNetwork(net, new Set(), null, [], {
        structures: "height",
        structureDecisions: [{ ...row(mid - 10, mid + 10), run: "9" }],
      }),
      mound,
      [],
    );
    expect(JSON.stringify(other.chunks)).toBe(JSON.stringify(plain.chunks));
  });

  it("stops the build when a row names a stretch that is not an embankment by height (a stale decision)", () => {
    const cut = list.find((c) => c.structure === "cut")!;
    const c0 = cut.st[0] + 5;
    expect(() =>
      solvePlan(
        planNetwork(net, new Set(), null, [], {
          structures: "height",
          structureDecisions: [row(c0, c0 + 10)],
        }),
        mound,
        [],
      ),
    ).toThrow(/structure decision 2/);
  });

  it("decideViaduct turns only an embankment: a cut in the window stays a cut", () => {
    const stretches = [
      { s0: 0, s1: 50, structure: "embankment" as const },
      { s0: 50, s1: 80, structure: "cut" as const },
      { s0: 80, s1: 120, structure: "viaduct" as const },
    ];
    expect(decideViaduct(stretches, [[30, 100]])).toEqual([
      { s0: 0, s1: 30, structure: "embankment" },
      { s0: 30, s1: 50, structure: "viaduct" },
      { s0: 50, s1: 80, structure: "cut" },
      { s0: 80, s1: 120, structure: "viaduct" },
    ]);
  });
});

/**
 * A viaduct 600 m long between ground ends over a plateau 12 m above its ends (x 150–450), whose
 * edges are steeper than the deck may climb: even at its lowest speed and the 特例 grade it runs low
 * over the plateau's edges (embankments), and the road that crosses it there (at x = 180) cannot
 * pass under it.
 */
function plateau(lon: number, lat: number): number {
  const x = xOf(lon, lat);
  if (x <= 130 || x >= 470) return 3;
  if (x < 150) return 3 + ((x - 130) / 20) * 12;
  if (x > 450) return 15 - ((x - 450) / 20) * 12;
  return 15;
}

describe("低いまま走る区間（合成網、護国寺・新宿出口の型）", () => {
  const net = network([
    { id: 1, x0: -300, x1: 0, tags: atGrade },
    { id: 2, x0: 0, x1: 600, tags: bridge },
    { id: 3, x0: 600, x1: 900, tags: atGrade },
  ]);
  const [lon0, lat0] = plane.toLonLat(180, -40);
  const [lon1, lat1] = plane.toLonLat(180, 40);
  const road = {
    kind: "road" as const,
    id: 77,
    pts: [[lon0, lat0] as [number, number], [lon1, lat1] as [number, number]],
  };
  const tags = solvePlan(planNetwork(net, new Set(), null), plateau, [road]);
  const height = solvePlan(planNetwork(net, new Set(), null, [], { structures: "height" }), plateau, [road]);

  it("by the tags it is closed (short of the open-ground floor beyond the give); by its height it is solved at the same last step, an embankment over the plateau's edge", () => {
    expect(closedOf(tags)).toEqual(["2"]);
    expect(closedOf(height)).toEqual([]);
    expect(height.runs.find((r) => r.id === "2")!.steps).toEqual([
      "specialGrade",
      "lowerSpeed",
      "assumedGive",
    ]);
    const list = byRun(height.chunks).get("2")!;
    const over = list.filter((c) => c.st[0] < 180 && c.st[c.st.length - STATION_STRIDE] > 180);
    expect(over.map((c) => c.structure)).toEqual(["embankment"]);
    for (const c of list.filter((k) => k.structure === "embankment")) expect(c.piers).toEqual([]);
    expect(checkHeightStructures(list)).toEqual([]);
  });

  it("the road under the embankment is blocked (crossing_over_or_at_grade), not crossed", () => {
    const list = byRun(height.chunks).get("2")!;
    const blocked = list.flatMap((c) => {
      const out: number[] = [];
      for (let i = 0; i < c.blocked.length; i += 3) out.push(Math.round(c.blocked[i]));
      return out;
    });
    expect(blocked).toEqual([180]);
    expect(list.every((c) => c.structure === "viaduct" || c.cross.length === 0)).toBe(true);
    const reported = height.diagnostics.filter(
      (d) => d.kind === "crossing_over_or_at_grade" && d.run === "2",
    );
    expect(reported).toHaveLength(1);
    expect(reported[0].detail).toMatch(/^road 77 at 180 m/);
    // T4 has nothing to say of an embankment (T13 judges it).
    const runs = new Map(height.runs.map((r) => [r.id, r]));
    for (const c of list) expect(checkClearance(c, runs.get("2")!, undefined, 0, true)).toEqual([]);
  });
});

/**
 * 湾岸線 near 空港中央 (the type): a 250 m tunnel between two viaducts under a ground that rises to a
 * sharp crest just over the depth its box and cover need from the portals. The descent from each
 * portal reaches the ceiling only at the crest's few stations, which no road can bend down into.
 */
function crest(lon: number, lat: number): number {
  const x = xOf(lon, lat);
  const isInside = x > 1100 && x < 1150;
  if (!isInside) return 3;
  const t = 1 - Math.abs(x - 1125) / 25;
  return 3 + t * 10;
}

describe("浅い短い地下（合成網、湾岸線の型）", () => {
  const net = network([
    { id: 1, x0: 0, x1: 1000, tags: bridge80 },
    { id: 2, x0: 1000, x1: 1250, tags: tunnel80 },
    { id: 3, x0: 1250, x1: 2200, tags: bridge80 },
  ]);
  const options = { pruneBelow: false } as const;
  const tags = solvePlan(planNetwork(net, new Set(), null, [], options), crest, []);
  const height = solvePlan(
    planNetwork(net, new Set(), null, [], { ...options, structures: "height" }),
    crest,
    [],
  );
  const shortOf = (r: ReturnType<typeof solvePlan>) =>
    r.diagnostics.find((d) => d.run === "2" && d.kind === "tunnel_cover_short")!.detail;

  it("by the tags the crest's few stations keep a ceiling; by its height none does, and it is solved", () => {
    expect(shortOf(tags)).toMatch(/^48 stations at 0–250 m/);
    // Every tunnel station is short of cover: the box stands at the ground as an open cut.
    expect(shortOf(height)).toMatch(/^51 stations at 0–250 m/);
    expect(closedOf(height)).toEqual([]);
  });

  it("T12 agrees: from the files the tunnel keeps no ceiling, so nothing is above one", () => {
    const list = byRun(height.chunks).get("2")!;
    const run = height.runs.find((r) => r.id === "2")!;
    const first = list[0].st;
    const last = list[list.length - 1].st;
    const ends = { z0: first[3], z1: last[last.length - STATION_STRIDE + 3] };
    expect(isTunnelFreeRun(list, run, ends)).toBe(true);
    for (const c of list) expect(checkCover(c, run, ends, true)).toEqual([]);
  });
});

/** A straight chunk along x from x0 (every 10 m, `len` m), its road at z(s) over the ground g(s). */
function lineChunk(
  run: string,
  k: number,
  structure: XwChunk["structure"],
  x0: number,
  len: number,
  z: (s: number) => number,
  g: (s: number) => number,
  extra: Partial<XwChunk> = {},
): XwChunk {
  const st: number[] = [];
  for (let s = x0; s <= x0 + len + 1e-9; s += 10) {
    const [lon, lat] = plane.toLonLat(s, 0);
    st.push(s, lon, lat, z(s), 0, g(s), 0);
  }
  return {
    id: `${run}:${k}`,
    run,
    chain: run,
    k,
    cls: "expressway",
    ref: null,
    name: null,
    structure,
    over: null,
    lanes: 2,
    laneWidth: 3.5,
    shoulderL: 1,
    shoulderR: 1,
    basis: "statute",
    V: 60,
    maxspeed: null,
    vh: 50,
    gmax: 0.05,
    g0: 0,
    g1: 0,
    h0: 0,
    h1: 0,
    girder: structure === "cut" ? 0 : 2.2,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
    ...extra,
  };
}

describe("T13 が違反を見つける（checkHeightStructures）", () => {
  const flat = () => 3;
  it("a run whose chunks agree with their heights passes; a viaduct chunk low for 100 m, a pier on an embankment, a cut with a girder or a missing portal do not", () => {
    const good = [
      lineChunk("R", 0, "embankment", 0, 100, () => 6, flat),
      lineChunk("R", 1, "viaduct", 100, 200, () => 15, flat, {
        portals: [{ s: 100, from: "embankment", to: "viaduct" }],
      }),
    ];
    expect(checkHeightStructures(good, false)).toEqual([]);
    // 2 m over the ground for 100 m mid-run (it reaches the ground): an embankment drawn as a viaduct.
    const low = [lineChunk("R", 0, "viaduct", 0, 300, (s) => (s > 100 && s < 200 ? 5 : 15), flat)];
    expect(checkHeightStructures(low, false).join()).toMatch(/not of its structure/);
    const pier = [lineChunk("R", 0, "embankment", 0, 100, () => 6, flat, { piers: [50, 3] })];
    expect(checkHeightStructures(pier, false).join()).toMatch(/piers on an embankment/);
    const girder = [lineChunk("R", 0, "cut", 0, 100, () => 1, flat, { girder: 2.2 })];
    expect(checkHeightStructures(girder, false).join()).toMatch(/a cut with a girder/);
    const noPortal = [good[0], { ...good[1], portals: undefined }];
    expect(checkHeightStructures(noPortal, false).join()).toMatch(/no portal embankment>viaduct/);
    // A below run by its tags (its summary's `below`) is not judged, whatever its chunks (review W5).
    expect(checkHeightStructures(girder, true)).toEqual([]);
  });
});

describe("T12 の坑口（checkCover、トンネル → 掘割の境）", () => {
  it("the mouth station of a tunnel onto a cut is held to the cut's tolerance, not the box's", () => {
    const hill = (s: number) => (s <= 200 ? 30 : 12);
    const mouth: XwChunk["portals"] = [{ s: 200, from: "tunnel", to: "cut" }];
    const tunnel = lineChunk("T", 0, "tunnel", 100, 100, () => 11.5, hill, { portals: mouth });
    const run = { lengthM: 2000, planV: 60 };
    const ends = { z0: 11.5, z1: 11.5 };
    expect(checkCover(tunnel, run, ends)).toEqual([]);
  });
});

describe("地表端の近くの道路（give: near）", () => {
  it("a road near a low end the deck misses does not unsolve a height build's run at its last step; elsewhere it does", () => {
    const near: RunProblem = { what: "crossing", basis: "law", s: 40, by: 2, text: "", give: "near" };
    expect(isFailing([near], true, true)).toBe(false);
    expect(isFailing([near], false, true)).toBe(true);
    expect(isFailing([near], true, false)).toBe(true);
  });
});

describe("交差の窓で余裕を測る（review C1・W1、合成網）", () => {
  // The mound network's deck comes down to its ground end at x = 800; a road crosses it at a shallow
  // angle at x = 650, so its width takes tens of metres along the falling deck.
  const net = network([
    { id: 1, x0: -300, x1: 0, tags: atGrade },
    { id: 2, x0: 0, x1: 800, tags: bridge },
    { id: 3, x0: 800, x1: 1100, tags: atGrade },
  ]);
  const [lon0, lat0] = plane.toLonLat(650 - 60, -20);
  const [lon1, lat1] = plane.toLonLat(650 + 60, 20);
  const road = {
    kind: "road" as const,
    id: 88,
    pts: [[lon0, lat0] as [number, number], [lon1, lat1] as [number, number]],
  };
  const height = solvePlan(planNetwork(net, new Set(), null, [], { structures: "height" }), mound, [road]);

  it("a road kept as crossed is cleared over its whole window by 4.5 m + the chunk's girder, else blocked; T4 and T13 hold", () => {
    const list = byRun(height.chunks).get("2")!;
    const sin = 40 / Math.hypot(120, 40);
    const half = Math.min(40, ((2 * 3.5 + 1 + 1) / 2 + 0.5 + 6) / Math.max(sin, 0.25));
    const zAt = (s: number) => {
      const c = list.find((k) => s >= k.st[0] && s <= k.st[k.st.length - STATION_STRIDE])!;
      let i = 0;
      while (c.st[(i + 1) * STATION_STRIDE] < s) i++;
      const a = c.st.slice(i * STATION_STRIDE, i * STATION_STRIDE + 7);
      const b = c.st.slice((i + 1) * STATION_STRIDE, (i + 1) * STATION_STRIDE + 7);
      return a[3] + ((b[3] - a[3]) * (s - a[0])) / (b[0] - a[0]);
    };
    let crossed = 0;
    let blocked = 0;
    for (const c of list) {
      for (let i = 0; i < c.cross.length; i += 4) {
        const [s, top, need] = c.cross.slice(i, i + 4);
        let low = Infinity;
        for (let sv = s - half + 2; sv <= s + half - 2; sv += 1) low = Math.min(low, zAt(sv));
        expect(c.structure).toBe("viaduct");
        expect(low - top).toBeGreaterThanOrEqual(need - 0.05);
        crossed++;
      }
      blocked += c.blocked.length / 3;
    }
    // Counted apart (R6 (e)): one road, kept as crossed and cleared over its window, none blocked.
    expect([crossed, blocked]).toEqual([1, 0]);
    const v = violationsOf(
      { runs: height.runs, diagnostics: height.diagnostics },
      height.chunks,
      () => undefined,
      true,
    );
    expect(v.T4.count).toBe(0);
    expect(v.T13.count).toBe(0);
  });
});

/**
 * R3 (S6 PR 7a): a deck coming down to its ground end at s = 400 over level ground (T.P. 3 m), a road
 * crossing it at s = 200 whose window is 10 m either side. The deck is 6.6 m over the ground at the
 * road and falls 5 % from s = 203: by its height alone an embankment from 206, inside the window,
 * though it clears the road over the window on the thinnest girder (4.5 m + 1.7 m).
 */
describe("交差の窓は高架（R3、forceViaduct・T13）", () => {
  const z = (s: number) => (s <= 203 ? 9.6 : 9.6 - 0.05 * (s - 203));
  const deck = (s: number) => Math.max(3, z(s));
  const samples = Array.from({ length: 401 }, (_, s) => ({ s, z: deck(s), ground: 3 }));

  it("by its height the embankment starts 6 m from the road; spanned, it starts at the window's end and T13 finds nothing", () => {
    const byHeight = heightStretches(samples, undefined, { length: 400 });
    expect(byHeight.map((h) => h.structure)).toEqual(["viaduct", "embankment"]);
    expect(byHeight[1].s0).toBeGreaterThan(205);
    expect(byHeight[1].s0).toBeLessThan(207);
    // The deck clears the road over the window on the thinnest girder.
    let low = Infinity;
    for (let s = 190; s <= 210; s++) low = Math.min(low, deck(s));
    expect(low - 3).toBeGreaterThanOrEqual(4.5 + GIRDER_MIN.value - 0.001);
    const spanned = forceViaduct(byHeight, [[190, 210]]);
    expect(spanned.map((h) => [h.structure, h.s0])).toEqual([
      ["viaduct", 0],
      ["embankment", 210],
    ]);
    const list = [
      lineChunk("R", 0, "viaduct", 0, 210, deck, () => 3, { cross: [200, 3, 6.7, 0] }),
      lineChunk("R", 1, "embankment", 210, 190, deck, () => 3, {
        portals: [{ s: 210, from: "viaduct", to: "embankment" }],
      }),
    ];
    expect(checkHeightStructures(list, false)).toEqual([]);
    // With no crossing a viaduct 30 m past where it comes down is found.
    const far = [
      lineChunk("R", 0, "viaduct", 0, 240, deck, () => 3),
      lineChunk("R", 1, "embankment", 240, 160, deck, () => 3, {
        portals: [{ s: 240, from: "viaduct", to: "embankment" }],
      }),
    ];
    expect(checkHeightStructures(far, false).join()).toMatch(/not of its structure/);
  });

  it("a window over a viaduct is left; one over an embankment or a cut splits it, and neighbours of one structure merge", () => {
    const list = [
      { s0: 0, s1: 100, structure: "embankment" as const },
      { s0: 100, s1: 300, structure: "viaduct" as const },
      { s0: 300, s1: 500, structure: "cut" as const },
    ];
    expect(forceViaduct(list, [[150, 160]])).toEqual(list);
    expect(
      forceViaduct(list, [
        [90, 110],
        [350, 360],
      ]),
    ).toEqual([
      { s0: 0, s1: 90, structure: "embankment" },
      { s0: 90, s1: 300, structure: "viaduct" },
      { s0: 300, s1: 350, structure: "cut" },
      { s0: 350, s1: 360, structure: "viaduct" },
      { s0: 360, s1: 500, structure: "cut" },
    ]);
  });
});

describe("T13 は区分の規則を呼ばずに読む（R6 (a)）", () => {
  it("a viaduct chunk that is an embankment by the assumptions' thresholds is found, whatever a classifier with other thresholds drew", () => {
    // 2–4 m over the ground for 200 m mid-run, 2 m at its lowest: an embankment that reaches the ground
    // by the thresholds, a viaduct in the air to a classifier whose reach was 1.5 m lower.
    const deck = (s: number) => (s < 100 || s > 300 ? 15 : 3 + 2 + Math.abs(s - 200) / 50);
    const list = [lineChunk("R", 0, "viaduct", 0, 400, deck, () => 3)];
    const wrong = heightStretches(
      Array.from({ length: 401 }, (_, s) => ({ s, z: deck(s) + 1.5, ground: 3 })),
      undefined,
      { length: 400 },
    );
    expect(wrong.map((h) => h.structure)).toEqual(["viaduct"]);
    expect(checkHeightStructures(list, false).join()).toMatch(/not of its structure/);
  });
});

describe("T4 は交差の窓を 1 m ごとにそのチャンクの桁で見る（R6 (c)・(d)）", () => {
  it("a window over a chunk boundary fails where the next chunk keeps the standard girder, and passes once it is thin too", () => {
    // 6.25 m over the road throughout: clear on the 1.7 m girder (4.5 + 1.7), not on the 2.2 m one.
    const deck = () => 9.25;
    const centre = lineChunk("R", 0, "viaduct", 0, 200, deck, () => 3, {
      girder: GIRDER_MIN.value,
      cross: [195, 3, 4.5 + GIRDER_MIN.value, 9.25],
      crossWindows: [10],
    });
    const standard = lineChunk("R", 1, "viaduct", 200, 200, deck, () => 3, { girder: GIRDER_DEPTH.value });
    expect(checkClearanceWindows([centre, standard]).join()).toMatch(/window of the crossing at s=195/);
    const thin = { ...standard, girder: GIRDER_MIN.value };
    expect(checkClearanceWindows([centre, thin])).toEqual([]);
    // A build by the tags writes no windows: nothing to check.
    expect(checkClearanceWindows([{ ...centre, crossWindows: undefined }, standard])).toEqual([]);
  });
});

describe("T3 の seam の向き（checkSeamHeading の違反側）と trackingOf の kind", () => {
  it("a child turned more than 1e-3 rad off its parent's chunk boundary at the seam fails; square, or no boundary there, as written", () => {
    const flat = () => 3;
    const parent = [lineChunk("P", 0, "embankment", 0, 100, () => 3, flat, { h0: 0, h1: 0.5 })];
    const square = lineChunk("C", 0, "viaduct", 100, 100, () => 9, flat, { h0: 0.5 });
    expect(checkSeamHeading(square, true, 100, parent)).toEqual([]);
    const turned = { ...square, h0: 0.5 + 2e-3 };
    expect(checkSeamHeading(turned, true, 100, parent).join()).toMatch(/seam heading/);
    expect(checkSeamHeading(square, true, 50, parent).join()).toMatch(/no parent chunk boundary/);
  });

  it("trackingOf reads the viaducts by default and the runs at grade with kind ground", () => {
    const flat = () => 3;
    const deck = lineChunk("V", 0, "viaduct", 0, 1000, (s) => 12 + Math.sin(s / 100), flat);
    const atGrade = lineChunk("G", 0, "embankment", 0, 1000, (s) => 3 + 0.1 * Math.sin(s / 100), flat);
    const run = (id: string, ground?: true) => ({
      id,
      chain: id,
      cls: "expressway" as const,
      ref: null,
      lengthM: 1000,
      V: 60,
      tagV: 60,
      planV: 60,
      minRadiusM: 1e6,
      maxShiftM: 0,
      steps: [],
      start: { kind: "open" as const },
      end: { kind: "open" as const },
      chunks: [`${id}:0`],
      structure: null,
      ...(ground ? { ground } : {}),
    });
    const runs = [run("V"), run("G", true)];
    const viaducts = trackingOf([deck, atGrade], runs);
    const grounds = trackingOf([deck, atGrade], runs, "ground");
    expect(viaducts.runs).toBe(1);
    expect(grounds.runs).toBe(1);
    expect(grounds.km).toBe(viaducts.km);
  });
});

describe("R4・R5・窓の後のならし（S6 PR 7a のレビュー W2・W3・W8）", () => {
  const line = (z: (s: number) => number) =>
    Array.from({ length: 401 }, (_, s) => ({ s, z: z(s), ground: 3 }));

  it("R4: an embankment 3 m or more up holds to an end only where that end meets the ground", () => {
    // 4–5 m over the ground from the start to s 150, then a viaduct.
    const samples = line((s) => (s <= 150 ? 7 + s / 150 : 20));
    expect(heightStretches(samples, undefined, { length: 400 }).map((h) => h.structure)).toEqual([
      "embankment",
      "viaduct",
    ]);
    const unanchored = { count: 0 };
    const off = heightStretches(samples, undefined, { length: 400, groundEnds: [false, true], unanchored });
    expect(off.map((h) => h.structure)).toEqual(["viaduct"]);
    expect(unanchored.count).toBe(1);
    // Reaching the ground (2 m at its lowest) it stays an embankment whatever the end.
    const low = line((s) => (s <= 150 ? 5 + s / 50 : 20));
    expect(heightStretches(low, undefined, { length: 400, groundEnds: [false, true] })[0].structure).toBe(
      "embankment",
    );
  });

  it("R5: a same-surface span loses the metres where the pair stands apart", () => {
    expect(sameKept([[0, 100]], [[40.5, 45.5]])).toEqual([
      [0, 40],
      [46, 100],
    ]);
    expect(sameKept([[0, 100]], [])).toEqual([[0, 100]]);
  });

  it("R3: a window is spanned where the deck at its lowest clears on the thinnest girder; a window reaches every chunk it touches", () => {
    expect(clearsOnThinGirder(3 + 4.5 + GIRDER_MIN.value + 0.001, 3, 4.5 + GIRDER_DEPTH.value)).toBe(true);
    expect(clearsOnThinGirder(3 + 4.5 + GIRDER_MIN.value - 0.01, 3, 4.5 + GIRDER_DEPTH.value)).toBe(false);
    expect(isWindowOver(195, 10, 200, 400)).toBe(true);
    expect(isWindowOver(185, 10, 200, 400)).toBe(false);
  });

  it("after the windows: a piece shorter than the smoothing between viaducts, or one in the air, is a viaduct", () => {
    // A 9.5 m embankment left between a window (viaduct to 100) and the viaduct from 109.5, 6.2 m up.
    const samples = line((s) => (s > 100 && s < 109.5 ? 9.2 : 20));
    const list = [
      { s0: 0, s1: 100, structure: "viaduct" as const },
      { s0: 100, s1: 109.5, structure: "embankment" as const },
      { s0: 109.5, s1: 400, structure: "viaduct" as const },
    ];
    expect(afterSpanning(list, samples, 20, 400)).toEqual([{ s0: 0, s1: 400, structure: "viaduct" }]);
    // 30 m long and down to the ground: kept.
    const reaching = line((s) => (s > 100 && s < 130 ? 4 : 20));
    const kept = [
      { s0: 0, s1: 100, structure: "viaduct" as const },
      { s0: 100, s1: 130, structure: "embankment" as const },
      { s0: 130, s1: 400, structure: "viaduct" as const },
    ];
    expect(afterSpanning(kept, reaching, 20, 400)).toEqual(kept);
  });

  it("T13 finds an embankment chunk 3 m or more up that holds to no end meeting the ground (R4)", () => {
    const flat = () => 3;
    const list = [
      lineChunk("R", 0, "embankment", 0, 100, () => 7.5, flat),
      lineChunk("R", 1, "viaduct", 100, 200, () => 15, flat, {
        portals: [{ s: 100, from: "embankment", to: "viaduct" }],
      }),
    ];
    expect(checkHeightStructures(list, false, false, [true, true])).toEqual([]);
    expect(checkHeightStructures(list, false, false, [false, true]).join()).toMatch(/off the ground/);
  });

  it("T4: a window on an embankment chunk is a violation (the whole window is spanned, review W6)", () => {
    const flat = () => 3;
    const deck = () => 9.25;
    const centre = lineChunk("R", 0, "viaduct", 0, 200, deck, flat, {
      girder: GIRDER_MIN.value,
      cross: [195, 3, 4.5 + GIRDER_MIN.value, 9.25],
      crossWindows: [10],
    });
    const bank = lineChunk("R", 1, "embankment", 200, 200, deck, flat, { girder: 0 });
    expect(checkClearanceWindows([centre, bank]).join()).toMatch(/on R:1's embankment/);
  });
});

describe("ground-crossing の数え方（structureCases、S6 PR 7a のレビュー W8）", () => {
  it("reads the compiler's own detail back, and lists one case per road or railway crossing a run at grade", () => {
    const detail = atGradeCrossingDetail("road", 123, 45.4);
    expect(parseAtGradeCrossing(detail)).toEqual({ kind: "road", id: 123, s: 45 });
    expect(
      parseAtGradeCrossing("road 123 at 45 m cannot be cleared from the ground end; taken as passing over"),
    ).toBe(null);
    const chunk = lineChunk(
      "G",
      0,
      "embankment",
      0,
      300,
      () => 3,
      () => 3,
      { girder: 0 },
    );
    const run = {
      id: "G",
      chain: "G",
      cls: "expressway" as const,
      ref: null,
      lengthM: 300,
      V: 60,
      tagV: 60,
      planV: 60,
      minRadiusM: 1e6,
      maxShiftM: 0,
      steps: [],
      start: { kind: "open" as const },
      end: { kind: "open" as const },
      chunks: ["G:0"],
      structure: null,
      ground: true as const,
      groundFit: {
        approachM: [0, 0] as [number, number],
        innerP95M: 0.2,
        innerMedianM: 0.1,
        approachMaxM: 0,
      },
    };
    const diagnostics = [
      {
        run: "G",
        kind: "crossing_over_or_at_grade" as const,
        detail: atGradeCrossingDetail("road", 7, 0),
        allowed: false,
      },
      {
        run: "G",
        kind: "crossing_over_or_at_grade" as const,
        detail: atGradeCrossingDetail("rail", 8, 120),
        allowed: false,
      },
    ];
    const cases = structureCases(new Map([["G", [chunk]]]), [run], true, diagnostics);
    expect(cases.map((c) => c.key)).toEqual([
      "ground-stretch:G",
      "ground-crossing:G|road 7",
      "ground-crossing:G|rail 8",
    ]);
    expect(cases.map((c) => isAutoAccepted(c))).toEqual([true, true, false]);
  });
});
