import { describe, expect, it } from "vitest";
import { structureCases } from "../scripts/expresswayCases";
import { shippedFolderRefusal } from "../scripts/expresswayGuards";
import { GIRDER_DEPTH, GIRDER_MIN, LOW_SPAN_SOFFIT_MIN } from "../src/expressway/assumptions";
import { clearOfNodes, planNetwork, solvePlan } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { checkHeightStructures, checkLowSpans, isLowSpanWindow } from "../src/expressway/heightStructures";
import { isAutoAccepted, withinCap } from "../src/expressway/ledger";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { violationsOf } from "../src/expressway/violations";

// S6 PR 7a2 (the low spans): a blocked road under a viaduct-tagged run whose window the deck stands
// over by LOW_SPAN_SOFFIT_MIN or more on the thinnest girder is spanned, not stood on by an embankment:
// the window is viaduct on the thinnest girder, no pier in it, the road stays blocked.

const P = planeAt(139.75, 35.65);
const bridge = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };

/** At grade x −300–0, a viaduct x 0–800 climbing from its ground end over level ground (T.P. 3 m), at grade 800–1100. */
function network(junctionX?: number): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  const nodeAt = (x: number) => 100000 + Math.round(x * 100);
  for (const w of [
    { id: 1, x0: -300, x1: 0, tags: atGrade },
    { id: 2, x0: 0, x1: 800, tags: bridge },
    { id: 3, x0: 800, x1: 1100, tags: atGrade },
  ]) {
    const xs: number[] = [];
    for (let x = w.x0; x < w.x1 - 1e-6; x += 50) xs.push(x);
    xs.push(w.x1);
    // A ramp leaving the viaduct at junctionX (a node of its own there).
    const isOnThis = junctionX !== undefined && junctionX > w.x0 && junctionX < w.x1;
    if (isOnThis)
      xs.splice(
        xs.findIndex((x) => x > junctionX),
        0,
        junctionX,
      );
    const ids = xs.map(nodeAt);
    net.ways.set(w.id, normalizeWay(w.id, ids, w.tags));
    xs.forEach((x, i) => {
      const [lon, lat] = P.toLonLat(x, 0);
      net.nodes.set(ids[i], normalizeNode(ids[i], lon, lat, {}));
    });
  }
  if (junctionX !== undefined) {
    const ramp = {
      highway: "motorway_link",
      bridge: "yes",
      layer: "1",
      lanes: "1",
      maxspeed: "40",
      oneway: "yes",
    };
    const pts: Array<[number, number]> = [
      [junctionX + 60, 8],
      [junctionX + 120, 30],
      [junctionX + 180, 70],
    ];
    const ids = [nodeAt(junctionX), ...pts.map((_, k) => 900000 + k)];
    pts.forEach(([x, y], k) => {
      const [lon, lat] = P.toLonLat(x, y);
      net.nodes.set(900000 + k, normalizeNode(900000 + k, lon, lat, {}));
    });
    net.ways.set(4, normalizeWay(4, ids, ramp));
  }
  return net;
}

/** Roads (or a railway) crossing the viaduct at right angles at these x. */
const crossings = (xs: number[], kind: "road" | "rail" = "road") =>
  xs.map((x, k) => {
    const [lon0, lat0] = P.toLonLat(x, -40);
    const [lon1, lat1] = P.toLonLat(x, 40);
    return { kind, id: 70 + k, pts: [[lon0, lat0] as [number, number], [lon1, lat1] as [number, number]] };
  });

const build = (xs: number[], least?: number, kind: "road" | "rail" = "road", junctionX?: number) => {
  const plan = planNetwork(network(junctionX), new Set(), null, [], {
    structures: "height",
    ...(least !== undefined ? { lowSpanSoffitM: least } : {}),
  });
  const res = solvePlan(plan, () => 3, crossings(xs, kind));
  const list = res.chunks.filter((c) => c.run === "2").sort((a, b) => a.k - b.k) as XwChunk[];
  return { res, list };
};
const soffitsOf = (res: ReturnType<typeof solvePlan>) =>
  res.diagnostics.flatMap((d) => {
    const m = / spanned low \(soffit ([\d.]+) m\)$/.exec(d.detail);
    return m ? [Number(m[1])] : [];
  });

describe("低い径間（合成網、霞が関の型）", () => {
  // Three roads 10 m apart on the deck's climb from its ground end: soffits 2.76, 3.20 and 3.63 m.
  const xs = [145, 155, 165];

  it("spans all three in one viaduct stretch on the thinnest girder, keeps them blocked, and T4・T13 find nothing", () => {
    const { res, list } = build(xs);
    expect(LOW_SPAN_SOFFIT_MIN.value).toBe(2.5);
    expect(soffitsOf(res)).toEqual([2.76, 3.2, 3.63]);
    const holding = list.filter((c) => c.blocked.length > 0);
    expect(holding).toHaveLength(1);
    const [span] = holding;
    expect(span.structure).toBe("viaduct");
    expect(span.girder).toBe(GIRDER_MIN.value);
    expect(span.blocked.length / 3).toBe(3);
    expect(span.cross).toEqual([]);
    expect(span.blockedWindows!.every((w) => w > 10)).toBe(true);
    // One viaduct from the first window on: the embankment ends at the first road's window.
    expect(list[0].structure).toBe("embankment");
    expect(list[0].st[list[0].st.length - STATION_STRIDE]).toBeLessThanOrEqual(145 - 10);
    const v = violationsOf(
      { runs: res.runs, diagnostics: res.diagnostics },
      res.chunks,
      () => undefined,
      true,
    );
    expect(v.T4.count).toBe(0);
    expect(v.T13.count).toBe(0);
    expect(checkLowSpans(list)).toEqual([]);
  });

  it("by the rule turned off (--low-span-soffit 99) the roads stay under the embankment as before", () => {
    const { res, list } = build(xs, 99);
    expect(soffitsOf(res)).toEqual([]);
    const holding = list.filter((c) => c.blocked.length > 0);
    expect(holding.map((c) => c.structure)).toEqual(["embankment"]);
    expect(list.every((c) => c.blockedWindows === undefined)).toBe(true);
  });

  it("the bound: a window 0.01 m under the least soffit stays under the embankment, 0.01 m over it is spanned; a railway never is", () => {
    // The first road's soffit 2.76 m: the bound just above and just below it.
    expect(soffitsOf(build([145], 2.77).res)).toEqual([]);
    expect(soffitsOf(build([145], 2.75).res)).toEqual([2.76]);
    expect(soffitsOf(build(xs, undefined, "rail").res)).toEqual([]);
  });
});

/** A chunk along y = 0 from x0 for len m, stations every 10 m. */
function lineChunk(
  k: number,
  structure: string,
  x0: number,
  len: number,
  z: number,
  extra: Partial<XwChunk> = {},
): XwChunk {
  const st: number[] = [];
  for (let s = x0; s <= x0 + len + 1e-9; s += 10) {
    const [lon, lat] = P.toLonLat(s, 0);
    st.push(s, lon, lat, z, 0, 3, 0);
  }
  return {
    id: `R:${k}`,
    run: "R",
    chain: "R",
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
    girder: GIRDER_MIN.value,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
    ...extra,
  } as XwChunk;
}

describe("T13 が低い径間の違反を見つける（checkLowSpans）", () => {
  // A road at s 100 spanned over ±12 m; the deck 7.5 m (soffit 7.5 − 1.7 − 3 = 2.8 m).
  const span = (extra: Partial<XwChunk> = {}) =>
    lineChunk(0, "viaduct", 0, 200, 7.5, { blocked: [100, 3, 7.5], blockedWindows: [12], ...extra });

  it("passes the span as built; finds a pier in the window, the standard girder, a soffit under the least, and an embankment in the window", () => {
    expect(checkLowSpans([span()])).toEqual([]);
    expect(checkHeightStructures([span()], false)).toEqual([]);
    expect(checkLowSpans([span({ piers: [105, 3] })]).join()).toMatch(/has a pier at s=105/);
    expect(checkLowSpans([span({ girder: GIRDER_DEPTH.value })]).join()).toMatch(/girder 2.2/);
    expect(checkLowSpans([span({ st: lineChunk(0, "viaduct", 0, 200, 7.1).st })]).join()).toMatch(
      /2\.40 m over it/,
    );
    const bank = [
      lineChunk(0, "embankment", 0, 95, 7.5, { girder: 0 }),
      lineChunk(1, "viaduct", 95, 105, 7.5, {
        blocked: [100, 3, 7.5],
        blockedWindows: [12],
        portals: [{ s: 95, from: "embankment", to: "viaduct" }],
      }),
    ];
    expect(checkLowSpans(bank).join()).toMatch(/on R:0's embankment/);
  });
});

describe("台帳の low-clearance と掃引のフラグ", () => {
  it("a low-clearance case is never accepted by rule, and a decided cap holds its shortfall within 5 cm", () => {
    expect(isAutoAccepted({ kind: "low-clearance", measured: { soffitM: 4.4, shortM: 0.1 } })).toBe(false);
    expect(withinCap({ soffitM: 2.7, shortM: 1.8 }, { shortM: 1.8 })).toBe(true);
    expect(withinCap({ soffitM: 2.64, shortM: 1.86 }, { shortM: 1.8 })).toBe(false);
  });

  it("--low-span-soffit is a sweep: never into the shipped folder", () => {
    const plain = { hasOut: false, isBelowAll: false, isBlocks: false, isV1: false, v2Flags: [] };
    expect(shippedFolderRefusal({ ...plain, isLowSpanSweep: true })).toMatch(/--low-span-soffit/);
    expect(shippedFolderRefusal({ ...plain, hasOut: true, isLowSpanSweep: true })).toBeNull();
  });
});

describe("径間にする窓（isLowSpanWindow）", () => {
  it("an embankment under the window with the soffit at the least is spanned; a cut anywhere in it, or no embankment, is not", () => {
    const bank = [
      { s0: 0, s1: 100, structure: "embankment" as const },
      { s0: 100, s1: 300, structure: "viaduct" as const },
    ];
    expect(isLowSpanWindow(bank, 90, 110, 2.5, 2.5)).toBe(true);
    expect(isLowSpanWindow(bank, 90, 110, 2.49, 2.5)).toBe(false);
    const withCut = [
      { s0: 0, s1: 95, structure: "embankment" as const },
      { s0: 95, s1: 105, structure: "cut" as const },
      { s0: 105, s1: 300, structure: "viaduct" as const },
    ];
    expect(isLowSpanWindow(withCut, 90, 110, 3, 2.5)).toBe(false);
    expect(isLowSpanWindow([{ s0: 0, s1: 300, structure: "viaduct" as const }], 90, 110, 3, 2.5)).toBe(false);
  });
});

describe("径間の端と分合流の節点（PR 7a2 のレビュー W1・S1）", () => {
  it("a span whose window starts 0.5 m short of a junction node is moved clear of it: T3 holds and no chunk is under 3 m", () => {
    // The first road's window starts at 145 − 10.75 = 134.25; a ramp leaves the viaduct at 134.75.
    const { res, list } = build([145, 155, 165], undefined, "road", 134.75);
    expect(soffitsOf(res).length).toBeGreaterThan(0);
    const lengths = list.map((c) => c.st[c.st.length - STATION_STRIDE] - c.st[0]);
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(3);
    const v = violationsOf(
      { runs: res.runs, diagnostics: res.diagnostics },
      res.chunks,
      () => undefined,
      true,
    );
    expect(v.T3.count).toBe(0);
    expect(v.T13.count).toBe(0);
  });

  it("clearOfNodes: an end just short of a node goes to it, one just past a node goes 3 m clear, again until none moves", () => {
    expect(clearOfNodes([123.25, 200], [123.77], 800)[0]).toBeCloseTo(123.77 - 3.01, 9);
    expect(clearOfNodes([124, 200], [121, 125], 800)).toEqual([121, 200]);
    expect(clearOfNodes([124, 200], [], 800)).toEqual([124, 200]);
    expect(clearOfNodes([100, 198], [200], 800)).toEqual([100, 200]);
  });
});

describe("T13 は窓で宙の盛土の塊を切る（PR 7a2 のレビュー W1）", () => {
  // Level ground at 3 m; a road in a cutting (its top 1 m) under a low span ±12 m about s 112, the deck
  // 5.3 m there (2.3 m up, a soffit of 2.6 m). Before it an embankment 1 m up reaching the ground; after
  // it 4.5 m up for 76 m (in the air) drawn as a viaduct, then 12 m up.
  const deck = (s: number) => (s < 100 ? 4 : s < 124 ? 5.3 : s < 200 ? 7.5 : 15);
  const chunks = (lowSide: string) => [
    lineChunk(0, lowSide, 0, 100, 0, {
      st: stationsOf(0, 100, deck),
      girder: lowSide === "viaduct" ? GIRDER_MIN.value : 0,
    }),
    lineChunk(1, "viaduct", 100, 200, 0, {
      st: stationsOf(100, 200, deck),
      blocked: [112, 1, 5.3],
      blockedWindows: [12],
      ...(lowSide === "viaduct"
        ? {}
        : { portals: [{ s: 100, from: lowSide as "embankment", to: "viaduct" as const }] }),
    }),
  ];

  it("passes the piece in the air beyond a low span as a viaduct (read through the window it was one stretch with the low side); finds the low side drawn as a viaduct", () => {
    expect(checkHeightStructures(chunks("embankment"), false)).toEqual([]);
    expect(checkHeightStructures(chunks("viaduct"), false).join()).toMatch(/not of its structure/);
  });
});

describe("台帳の low-clearance（lowClearanceCases）", () => {
  it("one case per blocked road under a viaduct chunk, its soffit over the window's lowest with the window's ends read, keyed by its s", () => {
    // The deck 7.5 m at the road (s 112), falling 0.05 m a metre to 7.0 m at the window's start (s 102).
    const z = (s: number) => 7.5 - Math.max(0, 112 - s) * 0.05;
    const span = lineChunk(1, "viaduct", 100, 100, 0, {
      st: stationsOf(100, 100, z),
      blocked: [112, 3, 7.5, 150, 3, 7.5],
      blockedWindows: [10, 0],
    });
    const diagnostics = [
      {
        run: "R",
        kind: "crossing_over_or_at_grade" as const,
        detail:
          "road 7 at 112 m cannot be cleared from the ground end; taken as passing over; spanned low (soffit 2.30 m)",
        allowed: false,
      },
      {
        run: "R",
        kind: "crossing_over_or_at_grade" as const,
        detail: "road 7 at 150 m cannot be cleared from the ground end; taken as passing over",
        allowed: false,
      },
    ];
    const run = {
      id: "R",
      chain: "R",
      cls: "expressway" as const,
      ref: null,
      lengthM: 200,
      V: 60,
      tagV: 60,
      planV: 60,
      minRadiusM: 1e6,
      maxShiftM: 0,
      steps: [],
      start: { kind: "open" as const },
      end: { kind: "open" as const },
      chunks: ["R:1"],
      structure: null,
    };
    const cases = structureCases(new Map([["R", [span]]]), [run], true, diagnostics).filter(
      (c) => c.kind === "low-clearance",
    );
    expect(cases.map((c) => c.key)).toEqual(["low-clearance:R|road 7|112", "low-clearance:R|road 7|150"]);
    // The window's start (s 102): 7.0 − 1.7 − 3; the second road not spanned low: its centre's value.
    expect(cases.map((c) => c.measured.soffitM)).toEqual([2.3, 2.8]);
    expect(cases.map((c) => c.measured.shortM)).toEqual([2.2, 1.7]);
    expect(cases.every((c) => !isAutoAccepted(c))).toBe(true);
  });
});

/** Stations every 10 m from x0 for len m along y = 0: z(s), ground 3 m, the grade z's slope (so the Hermite surface follows z). */
function stationsOf(x0: number, len: number, z: (s: number) => number): number[] {
  const st: number[] = [];
  for (let s = x0; s <= x0 + len + 1e-9; s += 10) {
    const [lon, lat] = P.toLonLat(s, 0);
    const isStep = (a: number, b: number) => Math.abs(z(a) - z(b)) > 0.5;
    const grade = isStep(s - 0.5, s + 0.5) ? 0 : (z(s + 0.5) - z(s - 0.5)) / 1;
    st.push(s, lon, lat, z(s), 0, 3, grade);
  }
  return st;
}
