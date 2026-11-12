import { describe, expect, it } from "vitest";
import { COMPANIONS } from "../src/expressway/assumptions";
import { approachLength, type Plan, planNetwork, solvePlan } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeStreetWay, normalizeWay } from "../src/expressway/network";
import { surfaceAt } from "../src/expressway/profile";
import { touchdownGround, touchdownNet, touchdownRoad } from "./expresswayTouchdown";

// S6 PR 3: the pairs held in height. `--touchdown all` lets go the pairs of every class coming down to
// the same place (and, with runs at grade, onto one); `--companions on` holds two main lines running
// beside each other to one height.

const marked = (plan: Plan) => plan.pairs.filter((p) => p.untied);
const key = (p: Plan["pairs"][number]) => `${p.a}@${p.sa.toFixed(3)}|${p.b}@${p.sb.toFixed(3)}|${p.relation}`;

describe("同じ場所へ降りる組を全クラスへ（--touchdown all）", () => {
  it("lets go a ramp's pairs coming down beside a main line, which mains leaves held", () => {
    const mains = planNetwork(touchdownNet({ upper: "ramp" }), new Set(), null);
    const all = planNetwork(touchdownNet({ upper: "ramp" }), new Set(), null, [], { touchdown: "all" });
    expect(marked(mains)).toEqual([]);
    expect(marked(all).length).toBeGreaterThan(0);
  });

  it("lets go a street's pairs too (every class), which mains leaves held", () => {
    const streetNet = () => {
      const n = touchdownNet({ upper: "ramp" });
      const w = n.ways.get(5)!;
      n.ways.set(
        5,
        normalizeStreetWay(5, w.nodes, {
          highway: "primary",
          bridge: "yes",
          layer: "2",
          lanes: "2",
          maxspeed: "40",
        }),
      );
      return n;
    };
    const mains = planNetwork(streetNet(), new Set(), null);
    const all = planNetwork(streetNet(), new Set(), null, [], { touchdown: "all" });
    expect(mains.runs.get("5")!.cls).toBe("street");
    expect(marked(mains)).toEqual([]);
    expect(marked(all).length).toBeGreaterThan(0);
  });

  it("keeps the pairs at a real crossing of the two tied, of any class", () => {
    const net = touchdownNet({ upper: "ramp", over: 60, transition: 100, side: -80, step: 10 });
    const plan = planNetwork(net, new Set(), null, [], { touchdown: "all" });
    const [c] = plan.crossings;
    const lower = plan.runs.get(c.lower)!;
    const upper = plan.runs.get(c.upper)!;
    const w = Math.min(60, (lower.halfWidth + upper.halfWidth) / Math.max(c.sinAngle, 0.2)) + 10;
    const atCrossing = plan.pairs.filter((p) => {
      const [sLow, sUp] = p.a === c.lower ? [p.sa, p.sb] : [p.sb, p.sa];
      return Math.abs(sLow - c.sLower) <= w && Math.abs(sUp - c.sUpper) <= w;
    });
    expect(atCrossing.length).toBeGreaterThan(0);
    expect(atCrossing.filter((p) => p.untied)).toEqual([]);
    expect(marked(plan).length).toBeGreaterThan(0);
  });

  it("marks with mains exactly what it marked before this PR (no option given)", () => {
    for (const o of [{}, { upper: "ramp" as const }, { ending: "tunnel" as const }]) {
      const before = planNetwork(touchdownNet(o), new Set(), null);
      const mains = planNetwork(touchdownNet(o), new Set(), null, [], { touchdown: "mains" });
      expect(marked(mains).map(key)).toEqual(marked(before).map(key));
      expect(mains.touchdown).toBeUndefined();
    }
  });

  it("with runs at grade, a seam onto one is where the two come down (all), as the ground end was", () => {
    // The upper goes on at grade past its touchdown: with runs at grade that end is a seam onto the run
    // at grade, and mains no longer marks the pair (PR 2: 41009552|668292569's 60 → 0).
    const height = { structures: "height" as const };
    const skip = planNetwork(touchdownNet({}), new Set(), null, [], height);
    const compiled = { ...height, ground: "compile" as const };
    const mains = planNetwork(touchdownNet({}), new Set(), null, [], compiled);
    const all = planNetwork(touchdownNet({}), new Set(), null, [], { ...compiled, touchdown: "all" });
    expect(marked(skip).length).toBeGreaterThan(0);
    expect(marked(mains)).toEqual([]);
    // Every pair skip lets go, and (review W1) the upper's pairs beside the lower's run at grade too.
    const allKeys = new Set(marked(all).map(key));
    for (const k of marked(skip).map(key)) expect(allKeys.has(k), k).toBe(true);
    expect(marked(all).some((p) => all.runs.get(p.a)!.ground || all.runs.get(p.b)!.ground)).toBe(true);
    const solved = solvePlan(all, touchdownGround, [touchdownRoad()]);
    const unsolved = solved.diagnostics.filter((d) => d.kind === "vertical_unsolved");
    expect(unsolved).toEqual([]);
  });
});

describe("全クラス化: 高架 × 地平 run（レビュー W1）", () => {
  // A main line: viaduct x 0–500, at grade 500–1500 (a run at grade with ground: compile). A ramp on
  // a viaduct (layer 1) comes from (1500, 80) down beside it at y 3 and touches down at x 900, over its
  // carriageway from x 1300 on: the ramp's pairs over the run at grade, near the ramp's own touchdown.
  const P = planeAt(139.75, 35.65);
  const net = (): Network => {
    const n: Network = { ways: new Map(), nodes: new Map() };
    const add = (id: number, pts: Array<[number, number]>, tags: Record<string, string>, base: number) => {
      const ids = pts.map((_, i) => base + i);
      pts.forEach(([x, y], i) => {
        const [lon, lat] = P.toLonLat(x, y);
        n.nodes.set(ids[i], normalizeNode(ids[i], lon, lat, {}));
      });
      n.ways.set(id, normalizeWay(id, ids, tags));
      return ids;
    };
    const main = { highway: "motorway", lanes: "2", maxspeed: "40", oneway: "yes" };
    const viaduct = add(
      1,
      [0, 100, 200, 300, 400, 500].map((x) => [x, 0]),
      { ...main, bridge: "yes", layer: "1" },
      1000,
    );
    const grade = [500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500].map(
      (x) => [x, 0] as [number, number],
    );
    const gIds = grade.map((_, i) => (i === 0 ? viaduct[viaduct.length - 1] : 2000 + i));
    grade.forEach(([x, y], i) => {
      const [lon, lat] = P.toLonLat(x, y);
      n.nodes.set(gIds[i], normalizeNode(gIds[i], lon, lat, {}));
    });
    n.ways.set(2, normalizeWay(2, gIds, main));
    const ramp: Array<[number, number]> = [
      [1500, 80],
      [1400, 40],
      [1300, 3],
    ];
    for (let x = 1250; x >= 900; x -= 50) ramp.push([x, 3]);
    add(
      3,
      ramp,
      { highway: "motorway_link", bridge: "yes", layer: "1", oneway: "yes", maxspeed: "40" },
      3000,
    );
    return n;
  };
  const options = { structures: "height" as const, ground: "compile" as const };

  it("lets go the ramp's pairs over the run at grade within the climb of its touchdown (all), not mains", () => {
    const mains = planNetwork(net(), new Set(), null, [], options);
    const all = planNetwork(net(), new Set(), null, [], { ...options, touchdown: "all" });
    const overGrade = (plan: Plan) =>
      plan.pairs.filter(
        (p) => p.relation !== "same" && (plan.runs.get(p.a)!.ground || plan.runs.get(p.b)!.ground),
      );
    expect(overGrade(mains).length).toBeGreaterThan(0);
    expect(overGrade(mains).filter((p) => p.untied)).toEqual([]);
    const ramp = all.runs.get("3")!;
    const reach = approachLength(ramp.planV);
    for (const p of overGrade(all)) {
      const s = p.a === "3" ? p.sa : p.sb;
      // The ramp touches down at its end (x 900).
      expect(p.untied === true, `s ${s}`).toBe(ramp.length - s <= reach);
    }
    expect(overGrade(all).some((p) => p.untied)).toBe(true);
  });
});

describe("地平 run への seam の端は地表端と同じく越えられない道路を行にしない（レビュー、41009552 の +5 m）", () => {
  it("blocks a road 15 m from a viaduct's seam onto a run at grade, and keeps the run at grade in its band", () => {
    const P = planeAt(139.75, 35.65);
    const n: Network = { ways: new Map(), nodes: new Map() };
    const xs = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];
    xs.forEach((x) => {
      const [lon, lat] = P.toLonLat(x, 0);
      n.nodes.set(5000 + x, normalizeNode(5000 + x, lon, lat, {}));
    });
    const tags = { highway: "motorway", lanes: "2", maxspeed: "60", oneway: "yes" };
    n.ways.set(
      1,
      normalizeWay(
        1,
        [0, 200, 400, 600, 800, 1000].map((x) => 5000 + x),
        { ...tags, bridge: "yes", layer: "1" },
      ),
    );
    n.ways.set(
      2,
      normalizeWay(
        2,
        [1000, 1200, 1400, 1600, 1800, 2000].map((x) => 5000 + x),
        tags,
      ),
    );
    const [lon0, lat0] = P.toLonLat(985, -40);
    const [lon1, lat1] = P.toLonLat(985, 40);
    const road = {
      kind: "road" as const,
      id: 77,
      pts: [[lon0, lat0] as [number, number], [lon1, lat1] as [number, number]],
    };
    const plan = planNetwork(n, new Set(), null, [], { structures: "height", ground: "compile" });
    const res = solvePlan(plan, () => 3, [road]);
    const runs = new Map(res.runs.map((r) => [r.id, r]));
    expect(runs.get("1")!.end).toMatchObject({ kind: "seam", parent: "2" });
    const d = res.diagnostics.find((x) => x.run === "1" && x.kind === "crossing_over_or_at_grade")!;
    expect(d.detail).toMatch(/^road 77 at 985 m cannot be cleared from the ground end/);
    // The run at grade's start (the seam) stays at the ground, within its band.
    const first = res.chunks.filter((c) => c.run === "2").sort((a, b) => a.k - b.k)[0];
    expect(Math.abs(first.st[3] - first.st[5])).toBeLessThanOrEqual(1.5);
  });
});

// Two main lines 11 m apart between centre lines (2.5 m between their carriageways, each 4.25 m to
// its edge), 1 km beside each other on layer 1, the north one over a 6 m mound 200 m wide.
const plane = planeAt(139.75, 35.65);
type Line = {
  id: number;
  y: number;
  x0: number;
  x1: number;
  layer?: (x: number) => string;
  reversed?: boolean;
  /** Where the line is across (y) at x, instead of `y` all along. */
  yAt?: (x: number) => number;
  lanes?: string;
};
const bridge = (layer: string, lanes = "2") => ({
  highway: "motorway",
  bridge: "yes",
  layer,
  lanes,
  maxspeed: "60",
  oneway: "yes",
});
function pairNet(lines: Line[]): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  for (const l of lines) {
    // Ways of 50 m each, so a layer can change along the line.
    const xs: number[] = [];
    for (let x = l.x0; x <= l.x1 + 1e-9; x += 50) xs.push(x);
    const nodeId = (x: number) => l.id * 10000 + Math.round(x / 10);
    for (const x of xs) {
      const [lon, lat] = plane.toLonLat(x, l.yAt ? l.yAt(x) : l.y);
      net.nodes.set(nodeId(x), normalizeNode(nodeId(x), lon, lat, {}));
    }
    const layerOf = l.layer ?? (() => "1");
    // Runs of one layer: one way per stretch of the same layer.
    let start = 0;
    let n = 0;
    for (let i = 1; i <= xs.length - 1; i++) {
      const isLast = i === xs.length - 1;
      const isChange = !isLast && layerOf(xs[i]) !== layerOf(xs[start]);
      if (!isChange && !isLast) continue;
      const seg = xs.slice(start, i + 1).map(nodeId);
      const ids = l.reversed ? seg.toReversed() : seg;
      const wayId = l.id * 100 + n++;
      net.ways.set(wayId, normalizeWay(wayId, ids, bridge(layerOf(xs[start]), l.lanes)));
      start = i;
    }
  }
  return net;
}
const yOf = (lon: number, lat: number) => plane.toXY(lon, lat)[1];
const xOf = (lon: number, lat: number) => plane.toXY(lon, lat)[0];
/** Level at 3 m, a 6 m mound from x 400 to 600 under the north line only (y > 5). */
const mound = (lon: number, lat: number) => {
  const isUnderNorth = yOf(lon, lat) > 5 && Math.abs(xOf(lon, lat) - 500) <= 100;
  return isUnderNorth ? 9 : 3;
};
const twoLines = (o: { south?: Partial<Line>; north?: Partial<Line> } = {}) =>
  pairNet([
    { id: 1, y: 0, x0: -200, x1: 1200, ...o.south },
    { id: 2, y: 11, x0: -200, x1: 1200, reversed: true, ...o.north },
  ]);
const runsOf = (plan: Plan, line: number) =>
  [...plan.runs.keys()].filter((id) => Math.floor(Number(id) / 100) === line);
const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  return out;
};
const zAt = (list: XwChunk[], s: number) => {
  const c = list.find((k) => s >= k.st[0] - 1e-6 && s <= k.st[k.st.length - STATION_STRIDE] + 1e-6)!;
  return surfaceAt(c.st, s).z;
};

describe("並走する本線を同じ高さに寄せる（--companions on）", () => {
  it("finds the two lines beside each other over their whole length, every COMPANIONS.stepM", () => {
    const plan = planNetwork(twoLines(), new Set(), null, [], { companionWeight: 2 });
    const list = plan.companions!.list;
    expect(list.length).toBeGreaterThan(40);
    expect(new Set(list.map((c) => `${c.a}|${c.b}`)).size).toBe(1);
    for (let i = 1; i < list.length; i++)
      expect(list[i].sa - list[i - 1].sa).toBeCloseTo(COMPANIONS.value.stepM, 6);
    expect(plan.pairs).toEqual([]);
  });

  it("holds them within 0.3 m at the weight taken (1) though only one crosses the mound, and the weight reaches the QP", () => {
    const off = solvePlan(planNetwork(twoLines(), new Set(), null), mound, []);
    const plan = planNetwork(twoLines(), new Set(), null, [], { companionWeight: 1 });
    const on = solvePlan(plan, mound, []);
    const dzOf = (res: typeof on) => {
      const chunks = byRun(res.chunks);
      return plan.companions!.list.map((c) =>
        Math.abs(zAt(chunks.get(c.a)!, c.sa) - zAt(chunks.get(c.b)!, c.sb)),
      );
    };
    expect(Math.max(...dzOf(off))).toBeGreaterThan(1);
    expect(Math.max(...dzOf(on))).toBeLessThanOrEqual(COMPANIONS.value.dzM + 0.05);
    expect(on.diagnostics.filter((d) => d.kind === "vertical_unsolved")).toEqual([]);
    // A weight far under the grade change's lets the two part again: the rows carry the weight given.
    const faint = solvePlan(
      planNetwork(twoLines(), new Set(), null, [], { companionWeight: 1e-4 }),
      mound,
      [],
    );
    expect(Math.max(...dzOf(faint))).toBeGreaterThan(Math.max(...dzOf(on)) + 0.5);
  });

  it("is the same list whatever the order the ways were put in (T8)", () => {
    const forward = twoLines();
    const backward: Network = {
      ways: new Map([...forward.ways].toReversed()),
      nodes: new Map([...forward.nodes].toReversed()),
    };
    const a = planNetwork(forward, new Set(), null, [], { companionWeight: 1 }).companions!.list;
    const b = planNetwork(backward, new Set(), null, [], { companionWeight: 1 }).companions!.list;
    expect(b).toEqual(a);
  });

  it("leaves out the stations at an ordered crossing of the two (the crossing's reach)", () => {
    // The north line climbs to layer 2 and crosses over the south one at x 500 (it swaps sides there),
    // back on layer 1 beyond: beside each other on one layer before and after, crossing between.
    // Four lanes each (7.5 m to the carriageway's edge), 17.5 m apart (2.5 m between them): the north
    // line crosses over the south one between x 500 and 550 (layer 2 there) to y −17.5. The south line's
    // station at x 495 is beside the north one on layer 1, within the crossing's reach (about 38 m).
    const crossing = pairNet([
      { id: 1, y: 0, x0: -205, x1: 1195, lanes: "4" },
      {
        id: 2,
        y: 0,
        yAt: (x) => (x <= 500 ? 17.5 : -17.5),
        x0: -200,
        x1: 1200,
        reversed: true,
        lanes: "4",
        layer: (x) => (x >= 500 && x < 550 ? "2" : "1"),
      },
    ]);
    const plan = planNetwork(crossing, new Set(), null, [], { companionWeight: 1 });
    const [c] = plan.crossings;
    expect(c).toBeDefined();
    const ra = plan.runs.get(c.upper)!;
    const rb = plan.runs.get(c.lower)!;
    const w = Math.min(60, (ra.halfWidth + rb.halfWidth) / Math.max(c.sinAngle, 0.2)) + 10;
    expect(plan.companions!.list.length).toBeGreaterThan(0);
    for (const p of plan.companions!.list) {
      const [su, sl] = p.a === c.upper ? [p.sa, p.sb] : [p.sb, p.sa];
      const isAtCrossing = Math.abs(su - c.sUpper) <= w && Math.abs(sl - c.sLower) <= w;
      expect(isAtCrossing, `${p.a}@${p.sa}`).toBe(false);
    }
  });

  it("leaves out a stretch on another layer, and lines beside each other under 200 m", () => {
    // The north line on layer 2 from x 300 to 700: the stretches beside each other are 500 and 500 m.
    const layered = planNetwork(
      twoLines({ north: { layer: (x) => (x >= 300 && x < 700 ? "2" : "1") } }),
      new Set(),
      null,
      [],
      { companionWeight: 2 },
    );
    const list = layered.companions!.list;
    const south = runsOf(layered, 1);
    expect(south.length).toBe(1);
    // Where along the south line (it runs east from x −200) each station pair is.
    const xs = list.map((c) => -200 + (c.a === south[0] ? c.sa : c.sb));
    // A station on the way boundary itself (x 300, 700) takes either way's layer.
    expect(xs.some((x) => x < 300)).toBe(true);
    expect(xs.some((x) => x >= 700)).toBe(true);
    for (const x of xs) expect(x <= 300 || x >= 700, `x ${x}`).toBe(true);
    // 150 m beside each other only.
    const short = planNetwork(
      pairNet([
        { id: 1, y: 0, x0: 0, x1: 1000 },
        { id: 2, y: 11, x0: 400, x1: 550 },
      ]),
      new Set(),
      null,
      [],
      { companionWeight: 2 },
    );
    expect(short.companions!.list).toEqual([]);
  });

  it("is the same whatever the range or the order of the ways, and absent off", () => {
    const all = planNetwork(twoLines(), new Set(), null, [], { companionWeight: 2 }).companions!.list;
    const [lon0, lat0] = plane.toLonLat(0, -20);
    const [lon1, lat1] = plane.toLonLat(100, 20);
    const ranged = planNetwork(
      twoLines(),
      new Set(),
      { minLon: lon0, minLat: lat0, maxLon: lon1, maxLat: lat1 },
      [],
      {
        companionWeight: 2,
      },
    );
    expect(ranged.companions!.list).toEqual(all);
    const flipped = planNetwork(
      twoLines({ south: { reversed: true }, north: { reversed: false } }),
      new Set(),
      null,
      [],
      { companionWeight: 2 },
    ).companions!.list;
    expect(flipped.length).toBe(all.length);
    expect(planNetwork(twoLines(), new Set(), null).companions).toBeUndefined();
  });

  it("is refused with blocks (blocks.ts knows no companion rows)", () => {
    expect(() =>
      planNetwork(twoLines(), new Set(), null, [], { companionWeight: 2, partition: "blocks" }),
    ).toThrow(/companions need partition: components/);
  });
});
