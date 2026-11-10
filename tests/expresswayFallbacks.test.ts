import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_GRADE, VERTICAL_CURVE_RADIUS } from "../src/law/roadStandards";
import { isAllowed } from "../src/expressway/allowlist";
import {
  checkClearance,
  checkGrade,
  checkGroundEnd,
  checkJunction,
  checkPlan,
  checkSurface,
  checkVerticalCurves,
  climbingEnds,
} from "../src/expressway/checks";
import { type GroundSampler, isBetter, isFailing, planNetwork, solvePlan } from "../src/expressway/compile";
import {
  DEM_SINK_FLOOR,
  DEM_SINK_GIVE,
  GROUND_END_BAND,
  OPEN_FLOOR_GIVE,
  OPEN_GROUND_FLOOR,
} from "../src/expressway/assumptions";
import { CLEARANCE_HEIGHT_REDUCED } from "../src/law/roadStandards";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { hermite } from "../src/expressway/profile";
import { type Qp, solveQp } from "../src/expressway/qp";
import {
  capZones,
  evalProfile,
  type RunInput,
  type RunProblem,
  solveJoint,
} from "../src/expressway/vertical";

// The P2.6 models for the whole ward area (knowledge/expressway-generation.md): short runs meeting
// the ground in a band, short connectors as the cubic between their parents, a lower design speed
// only around where a run fails, the statute told from the assumed floors (with a give only at the
// last step), main lines not held by their failing ramps (shedding), the state kept being the best
// one, V80 main lines, and the interior point's stopping test. Synthetic networks in a local plane
// around 芝公園.

const plane = planeAt(139.75, 35.65);
const flat: GroundSampler = () => 3;

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

const viaduct = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60" };

function compile(net: Network, ground: GroundSampler = flat) {
  const plan = planNetwork(net, new Set(), null);
  return { plan, result: solvePlan(plan, ground, []) };
}

function byRun(chunks: XwChunk[]): Map<string, XwChunk[]> {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  for (const l of out.values()) l.sort((a, b) => a.k - b.k);
  return out;
}

const unsolvedKinds = ["vertical_unsolved", "parent_unsolved"];

describe("短い run の地表端（標高の帯、勾配は法令内で自由）", () => {
  // A 60 m bridge between two stretches at grade, on ground that rises 1.5 m across it. With both
  // ends' elevation and the terrain's grade fixed, one knot interval has no room (P2.5: "end
  // elevation off"); within a ±4 cm band and a free grade it is a straight climb.
  const ground: GroundSampler = (lon, lat) => {
    const [x] = plane.toXY(lon, lat);
    return 3 + 1.5 * Math.min(1, Math.max(0, (x - 300) / 60));
  };
  const pts = line(0, 0, 660, 0, 30);
  const ids = pts.map((_, i) => 100 + i);
  const at = (x: number) => pts.findIndex(([px]) => Math.abs(px - x) < 1e-6);
  const net = network([
    {
      id: 1,
      pts: pts.slice(0, at(300) + 1),
      nodeIds: ids.slice(0, at(300) + 1),
      tags: { ...viaduct, bridge: "no", layer: "0" },
    },
    { id: 2, pts: pts.slice(at(300), at(360) + 1), nodeIds: ids.slice(at(300), at(360) + 1), tags: viaduct },
    {
      id: 3,
      pts: pts.slice(at(360)),
      nodeIds: ids.slice(at(360)),
      tags: { ...viaduct, bridge: "no", layer: "0" },
    },
  ]);
  const { result } = compile(net, ground);
  const runs = new Map(result.runs.map((r) => [r.id, r]));

  it("is solved, and each ground end lies within 5 cm of the DEM there (T5 against the DEM, not the deck)", () => {
    expect(result.diagnostics.filter((d) => unsolvedKinds.includes(d.kind))).toEqual([]);
    const [run] = result.runs;
    const chunks = byRun(result.chunks).get(run.id)!;
    expect(run.start.kind).toBe("ground");
    expect(run.end.kind).toBe("ground");
    expect(run.start.ground).toBeCloseTo(3, 2);
    expect(run.end.ground).toBeCloseTo(4.5, 2);
    expect(checkGroundEnd(chunks[0], run, true)).toEqual([]);
    expect(checkGroundEnd(chunks[chunks.length - 1], run, false)).toEqual([]);
  });

  it("climbs at a grade of its own, not the terrain's at the ends, and within 第20条", () => {
    const run = [...runs.values()][0];
    const chunks = byRun(result.chunks).get(run.id)!;
    expect(run.start.grade!).toBeGreaterThan(0.01);
    for (const c of chunks) {
      expect(checkGrade(c, run)).toEqual([]);
      expect(checkSurface(c)).toEqual([]);
    }
  });
});

describe("短い連結路は親 2 本のエルミート面に従う（cubic）", () => {
  // Two parallel viaducts 40 m apart and a 64 m link from one to the other (x 800 → 850): shorter
  // than three 第22条 curve lengths at its 40 km/h, so its elevation is the cubic through the
  // parents' (z, grade) at its two ends.
  const a = line(0, 0, 2000, 0);
  const b = line(0, 40, 2000, 40);
  const aIds = a.map((_, i) => 1000 + i);
  const bIds = b.map((_, i) => 3000 + i);
  const link: Array<[number, number]> = [
    [800, 0],
    [830, 20],
    [850, 40],
  ];
  const linkIds = [aIds[16], 2001, bIds[17]];
  const net = network([
    { id: 10, pts: a, nodeIds: aIds, tags: viaduct },
    { id: 30, pts: b, nodeIds: bIds, tags: viaduct },
    { id: 20, pts: link, nodeIds: linkIds, tags: { highway: "motorway_link", bridge: "yes", layer: "1" } },
  ]);
  const { result } = compile(net);
  const runs = new Map(result.runs.map((r) => [r.id, r]));
  const chunks = byRun(result.chunks);

  it("is solved as one cubic (vform) whose ends are both parents' stations in height, grade and bank", () => {
    expect(result.diagnostics.filter((d) => unsolvedKinds.includes(d.kind))).toEqual([]);
    const linkChunks = chunks.get("20")!;
    expect(linkChunks.every((c) => c.vform === "cubic")).toBe(true);
    const r = runs.get("20")!;
    expect(checkJunction(linkChunks[0], true, r.start.grade!, chunks.get("10")!)).toEqual([]);
    expect(checkJunction(linkChunks[linkChunks.length - 1], false, r.end.grade!, chunks.get("30")!)).toEqual(
      [],
    );
  });

  it("holds 第20条 and 第22条's radii on its surface, with no minimum curve length (第28条第4項)", () => {
    for (const c of chunks.get("20")!) {
      expect(checkSurface(c)).toEqual([]);
      expect(checkVerticalCurves(c)).toEqual([]);
      expect(checkGrade(c, runs.get("20")!)).toEqual([]);
    }
  });

  it("its stations lie on the cubic of its two ends (recomputed from the end stations alone)", () => {
    const st = chunks.get("20")!.flatMap((c, k) => (k === 0 ? c.st : c.st.slice(STATION_STRIDE)));
    const n = st.length / STATION_STRIDE;
    const last = (n - 1) * STATION_STRIDE;
    for (let i = 0; i < n; i++) {
      const s = st[i * STATION_STRIDE];
      const p = hermite(st[0], st[3], st[6], st[last], st[last + 3], st[last + 6], s);
      expect(st[i * STATION_STRIDE + 3]).toBeCloseTo(p.z, 2);
    }
  });
});

describe("V を下げるのは失敗した場所の周りだけ（capZones）", () => {
  const zones = [{ from: 0, to: 2000, V: 60 as const }];

  it("caps only inside the windows, splitting and merging zones there", () => {
    expect(capZones(zones, 40, [[900, 1200]])).toEqual([
      { from: 0, to: 900, V: 60 },
      { from: 900, to: 1200, V: 40 },
      { from: 1200, to: 2000, V: 60 },
    ]);
    expect(
      capZones(zones, 50, [
        [0, 300],
        [250, 500],
      ]),
    ).toEqual([
      { from: 0, to: 500, V: 50 },
      { from: 500, to: 2000, V: 60 },
    ]);
  });

  it("without windows caps the whole run, and never raises a slower zone", () => {
    expect(capZones(zones, 40)).toEqual([{ from: 0, to: 2000, V: 40 }]);
    const mixed = [
      { from: 0, to: 500, V: 40 as const },
      { from: 500, to: 2000, V: 60 as const },
    ];
    expect(capZones(mixed, 50, [[0, 2000]])).toEqual([
      { from: 0, to: 500, V: 40 },
      { from: 500, to: 2000, V: 50 },
    ]);
  });

  it("a QP with a lowered window keeps the faster limits outside it (grade limit per knot)", () => {
    const stations = Float64Array.from({ length: 401 }, (_, k) => k * 5);
    const run: RunInput = {
      id: "r",
      length: 2000,
      zones: capZones(zones, 40, [[0, 300]]),
      special: false,
      stations,
      target: stations.map(() => 10),
      lower: stations.map(() => -Infinity),
      upper: stations.map(() => Infinity),
      start: { z: 0, grade: 0 },
      end: { z: 10, grade: 0 },
    };
    const { profiles, problems } = solveJoint([run], []);
    expect(problems.get("r")).toEqual([]);
    const p = profiles.get("r")!;
    const knotAt = (s: number) => Math.round(s / p.h);
    expect(p.gradeLimit[knotAt(100)]).toBe(MAX_GRADE.value[40].standard);
    expect(p.gradeLimit[knotAt(1500)]).toBe(MAX_GRADE.value[60].standard);
    // Curvature limits stay V60's outside the window.
    expect(p.crestRadius[knotAt(1500)]).toBe(VERTICAL_CURVE_RADIUS.value[60].crest);
  });
});

describe("分合流のノーズ（P2.5 と同じ重みの同一面）", () => {
  // A main line with an exit that must reach the ground 350 m after leaving it. The nose stays a
  // shared-deck preference (holding it as firmly as a junction was tried and not taken, see
  // vertical.ts), and here it is met.
  const main = line(0, 0, 2000, 0);
  const mainIds = main.map((_, i) => 1000 + i);
  const exit: Array<[number, number]> = [[800, 0], ...line(850, -6, 1150, -60)];
  const exitIds = [mainIds[16], ...exit.slice(1).map((_, i) => 2000 + i)];
  const both = compile(
    network([
      { id: 10, pts: main, nodeIds: mainIds, tags: viaduct },
      { id: 20, pts: exit, nodeIds: exitIds, tags: { highway: "motorway_link", bridge: "yes", layer: "1" } },
    ]),
  );

  it("solves both and keeps the exit on the main line's slab (|Δz| ≤ 5 cm) where their carriageways overlap", () => {
    expect(both.result.diagnostics.filter((d) => unsolvedKinds.includes(d.kind))).toEqual([]);
    // Recomputed from the stations, not from the compiler's deck_overlap: every exit station within
    // the two carriageways' half widths (main 4.25 m + ramp 2.375 m) of the main line's centre.
    const chunks = byRun(both.result.chunks);
    const mainPts = chunks.get("10")!.flatMap((c) => {
      const out: Array<{ x: number; y: number; s: number; c: XwChunk }> = [];
      for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
        const [x, y] = plane.toXY(c.st[i + 1], c.st[i + 2]);
        out.push({ x, y, s: c.st[i], c });
      }
      return out;
    });
    let compared = 0;
    for (const c of chunks.get("20")!) {
      for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
        const [x, y] = plane.toXY(c.st[i + 1], c.st[i + 2]);
        const near = mainPts.filter((q) => Math.hypot(q.x - x, q.y - y) < 4.25 + 2.375);
        if (near.length === 0 || Math.abs(y) > 4.25 + 2.375) continue;
        compared++;
        // The main line's surface at the foot of the perpendicular (it runs along y = 0).
        const s = x;
        const mc = chunks.get("10")!.find((k) => s >= k.st[0] && s <= k.st[k.st.length - STATION_STRIDE])!;
        let zMain = Number.NaN;
        for (let j = 0; j + STATION_STRIDE < mc.st.length; j += STATION_STRIDE) {
          const isIn = s >= mc.st[j] && s <= mc.st[j + STATION_STRIDE];
          if (isIn)
            zMain = hermite(
              mc.st[j],
              mc.st[j + 3],
              mc.st[j + 6],
              mc.st[j + 7],
              mc.st[j + 10],
              mc.st[j + 13],
              s,
            ).z;
        }
        expect(Math.abs(c.st[i + 3] - zMain)).toBeLessThanOrEqual(0.05);
      }
    }
    expect(compared).toBeGreaterThanOrEqual(2);
  });
});

describe("法令の拘束と仮定の床を区別する（W2）", () => {
  // One 400 m run pinned at T.P. 0 at both ends (at grade 0) with a floor of 9 m in the middle: no
  // profile within 第20条・第22条 reaches it. The floor is reported as the statute's when it is a
  // crossing (lowerLaw), as the assumed standard floor when it is open ground (lowerOpen).
  const stations = Float64Array.from({ length: 81 }, (_, k) => k * 5);
  const floor = stations.map((s) => (Math.abs(s - 200) < 10 ? 9 : -Infinity));
  const base = {
    id: "r",
    length: 400,
    zones: [{ from: 0, to: 400, V: 60 as const }],
    special: false,
    stations,
    target: stations.map(() => 0),
    lower: floor,
    upper: stations.map(() => Infinity),
    start: { z: 0, grade: 0 },
    end: { z: 0, grade: 0 },
  };
  // At 60 km/h (5 %, sag 1000 m, crest 1400 m) the most it can rise in 200 m and level off is 7 m.

  it("a crossing's clearance it cannot reach is the statute's (basis law)", () => {
    const { problems } = solveJoint([{ ...base, lowerLaw: floor }], []);
    const p = problems.get("r")!.find((q) => q.what === "crossing");
    expect(p?.basis).toBe("law");
    expect(p!.by).toBeGreaterThan(0);
  });

  it("the standard floor over open ground is the assumption, with how much and where", () => {
    const law = stations.map(() => -Infinity);
    const { problems } = solveJoint([{ ...base, lowerLaw: law, lowerOpen: floor }], []);
    const p = problems.get("r")!.find((q) => q.what === "floor");
    expect(p?.basis).toBe("assumed");
    expect(Math.abs(p!.s - 200)).toBeLessThanOrEqual(10);
    expect(p!.by).toBeGreaterThan(0.5);
    expect(problems.get("r")!.some((q) => q.basis === "law")).toBe(false);
  });
});

describe("V80 の本線（第13条 第二種第一級、W9）", () => {
  const way = line(0, 0, 3000, 0);
  const net = network([
    {
      id: 1,
      pts: way,
      nodeIds: way.map((_, i) => 100 + i),
      tags: { ...viaduct, maxspeed: "80", lanes: "3" },
    },
  ]);
  const { result } = compile(net);
  const run = result.runs[0];

  it("designs a straight viaduct tagged 80 at V80 and the checks accept it (T1, T2, T6)", () => {
    expect(run.V).toBe(80);
    for (const c of result.chunks) {
      expect(checkGrade(c, run)).toEqual([]);
      expect(checkVerticalCurves(c)).toEqual([]);
      expect(checkPlan(c, run).problems).toEqual([]);
    }
  });

  it("rejects V80 on a section tagged below it", () => {
    const c = result.chunks[0];
    expect(checkGrade(c, { ...run, tagV: 60 }).some((m) => m.includes("design speed 80"))).toBe(true);
  });
});

describe("分岐が低い親から出るときの登り（T4 の除外の継承）", () => {
  it("counts a junction end on a parent within its climb from the ground as low, recursively", () => {
    const end = (kind: string, extra: object = {}) => ({ kind, ...extra }) as never;
    const runs = new Map([
      ["p", { id: "p", lengthM: 1000, planV: 60, start: end("ground"), end: end("open") }],
      [
        "c",
        {
          id: "c",
          lengthM: 300,
          planV: 40,
          start: end("junction", { parent: "p", parentS: 80 }),
          end: end("open"),
        },
      ],
      [
        "far",
        {
          id: "far",
          lengthM: 300,
          planV: 40,
          start: end("junction", { parent: "p", parentS: 600 }),
          end: end("open"),
        },
      ],
      [
        "g",
        {
          id: "g",
          lengthM: 200,
          planV: 40,
          start: end("junction", { parent: "c", parentS: 20 }),
          end: end("open"),
        },
      ],
    ] as never);
    const at = (id: string) => climbingEnds((runs as Map<string, never>).get(id)!, runs as never);
    expect(at("c")).toEqual({ start: true, end: false });
    expect(at("far")).toEqual({ start: false, end: false });
    expect(at("g")).toEqual({ start: true, end: false });
  });

  it("checkClearance leaves the climb from a low junction end out, and only that", () => {
    const st: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const [lon, lat] = plane.toLonLat(i * 10, 0);
      st.push(i * 10, lon, lat, 3 + Math.min(8, i * 0.7), 0, 3, 0.07);
    }
    const chunk = { id: "c:0", run: "c", cls: "ramp", V: 40, cross: [], st } as unknown as XwChunk;
    const run = {
      id: "c",
      lengthM: 300,
      planV: 40,
      start: { kind: "junction" },
      end: { kind: "open" },
    } as never;
    expect(checkClearance(chunk, run).length).toBeGreaterThan(0);
    expect(checkClearance(chunk, run, { start: true, end: false })).toEqual([]);
  });
});

describe("内点法の終了判定（13 件の数値破綻の再現）", () => {
  // A component of the full build (P2.5) that broke down: the residuals were met, the mean λs stood
  // at 2.5e-9 against the old absolute 1e-9, and pushing on spread D = λ/s over 29 orders until
  // the step was NaN (34 pivots regularised). Saved from solveJoint as it was built.
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "expresswayQpStall.json"), "utf8"),
  );
  const qp = (): Qp => ({
    n: raw.n,
    P: new Map<number, number>(raw.P),
    q: Float64Array.from(raw.q),
    rows: raw.rows,
    l: Float64Array.from(raw.l.map(Number)),
    u: Float64Array.from(raw.u.map(Number)),
    w: Float64Array.from(raw.w.map(Number)),
  });

  it("converges with the per-pair gap of 1e-7, no pivot regularised", () => {
    const r = solveQp(qp());
    expect(r.status).toBe("converged");
    expect(r.regularised).toBe(0);
    expect(r.gap).toBeLessThanOrEqual(1e-7);
  });

  it("asked for the old 1e-9 it breaks down, and says so instead of returning the iterate as a solution", () => {
    const r = solveQp(qp(), { gapTol: 1e-9 });
    expect(r.status).toBe("broken");
  });
});

describe("許可リストの上限つき規則", () => {
  it("accepts a ramp's OSM radius only down to the reviewed one", () => {
    expect(isAllowed({ run: "203059413", kind: "ramp_radius", detail: "R=10.7 m < 15 m (V20)" })).toBe(true);
    expect(isAllowed({ run: "203059413", kind: "ramp_radius", detail: "R=9.0 m < 15 m (V20)" })).toBe(false);
  });

  it("evalProfile reads a cubic profile as the Hermite of its two ends", () => {
    const p = { h: 100, z: [10, 12], g: [0.01, -0.02], cubic: true };
    expect(evalProfile(p, 0).z).toBeCloseTo(10, 9);
    expect(evalProfile(p, 100).grade).toBeCloseTo(-0.02, 9);
    expect(evalProfile(p, 50).z).toBeCloseTo(hermite(0, 10, 0.01, 100, 12, -0.02, 50).z, 9);
  });
});

describe("仮定の床の緩和は最終段だけ（W2）と許可の上限", () => {
  const p = (what: RunProblem["what"], by: number): RunProblem => ({
    what,
    basis: "assumed",
    s: 0,
    by,
    text: "",
  });

  it("before the last step any miss unsolves the run; at it only a miss beyond the give does", () => {
    expect(isFailing([p("floor", 0.01)], false)).toBe(true);
    expect(isFailing([p("sunk", 0.01)], false)).toBe(true);
    expect(isFailing([p("floor", OPEN_FLOOR_GIVE.value)], true)).toBe(false);
    expect(isFailing([p("floor", OPEN_FLOOR_GIVE.value + 0.01)], true)).toBe(true);
    expect(isFailing([p("sunk", DEM_SINK_GIVE.value)], true)).toBe(false);
    expect(isFailing([p("sunk", DEM_SINK_GIVE.value + 0.01)], true)).toBe(true);
    // The statute is never given.
    expect(isFailing([{ ...p("crossing", 0.001), basis: "law" }], true)).toBe(true);
  });

  it("the allowlist accepts an assumed-floor miss only up to the same give", () => {
    const d = (kind: string, m: number, what: string) => ({
      run: "x",
      kind,
      detail: `${m} m under ${what} at 10 m`,
    });
    expect(isAllowed(d("below_open_ground_floor", 0.5, "the open-ground floor (6.7 m)"))).toBe(true);
    expect(isAllowed(d("below_open_ground_floor", 0.51, "the open-ground floor (6.7 m)"))).toBe(false);
    expect(isAllowed(d("deck_below_ground", 0.75, "the assumed floor"))).toBe(true);
    expect(isAllowed(d("deck_below_ground", 0.76, "the assumed floor"))).toBe(false);
  });

  it("the gives are assumptions that say they are, the 4 m borrowed from 第12条ただし書", () => {
    for (const a of [OPEN_GROUND_FLOOR, OPEN_FLOOR_GIVE, DEM_SINK_FLOOR, DEM_SINK_GIVE, GROUND_END_BAND])
      expect(a.verified).toBe(false);
    expect(OPEN_GROUND_FLOOR.value - OPEN_FLOOR_GIVE.value).toBe(CLEARANCE_HEIGHT_REDUCED.value.class3grade5);
    expect(OPEN_FLOOR_GIVE.reason).toContain("借りた");
  });
});

describe("段の比較（W1: 最良の状態を残す）", () => {
  it("compares failing main lines first, then ramps, then metres of missed decks", () => {
    expect(isBetter([0, 5, 9], [1, 0, 0])).toBe(true);
    expect(isBetter([1, 0, 0], [1, 1, 0])).toBe(true);
    expect(isBetter([1, 1, 0.5], [1, 1, 0.6])).toBe(true);
    expect(isBetter([1, 1, 0.6], [1, 1, 0.6])).toBe(false);
    expect(isBetter([2, 0, 0], [1, 9, 9])).toBe(false);
  });
});

describe("本線を失敗したランプに巻き込ませない（solveShedding）", () => {
  // Main line A (y = 0) and, 30 m north, a parallel main line B. A ramp leaves A at x = 800 and
  // crosses over B (layer 2 over 1) 40 m later: no grade climbs a level in 40 m, so the ramp fails,
  // and the crossing it cannot clear is one row of both, so B is judged against it too. The ramp is
  // shed and B solved without it.
  const a = line(0, 0, 2000, 0);
  const b = line(0, 30, 2000, 30);
  const aIds = a.map((_, i) => 1000 + i);
  const bIds = b.map((_, i) => 3000 + i);
  const ramp: Array<[number, number]> = [
    [800, 0],
    [820, 15],
    [840, 45],
    [860, 80],
    [880, 120],
  ];
  const rampIds = [aIds[16], 2001, 2002, 2003, 2004];
  const net = network([
    { id: 10, pts: a, nodeIds: aIds, tags: viaduct },
    { id: 30, pts: b, nodeIds: bIds, tags: viaduct },
    { id: 20, pts: ramp, nodeIds: rampIds, tags: { highway: "motorway_link", bridge: "yes", layer: "2" } },
  ]);
  const { result } = compile(net);
  const runs = new Set(result.runs.map((r) => r.id));
  const unsolved = result.diagnostics.filter((d) => unsolvedKinds.includes(d.kind));

  it("leaves out only the ramp that cannot clear B, and solves both main lines", () => {
    expect(unsolved.map((d) => d.run)).toEqual(["20"]);
    expect(runs.has("10")).toBe(true);
    expect(runs.has("30")).toBe(true);
    expect(result.closed.map((c) => [c.run, c.cls])).toEqual([["20", "ramp"]]);
  });

  it("says what the state it kept fails on (the last word of the attempts)", () => {
    expect(unsolved[0].detail).toMatch(/kept: .*clearance over 30/);
  });
});
