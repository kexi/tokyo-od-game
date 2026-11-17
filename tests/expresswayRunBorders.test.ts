import { describe, expect, it } from "vitest";
import { districtsRefusal, shippedFolderRefusal } from "../scripts/expresswayGuards";
import { endPlan, planNetwork, type PlanOptions, solvePlan } from "../src/expressway/compile";
import {
  assignDistricts,
  DISTRICTS,
  districtOfRef,
  districtOfRefName,
  districtRunsOf,
} from "../src/expressway/districts";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import {
  type Network,
  normalizeNode,
  normalizeWay,
  operatorCuts,
  refBorders,
} from "../src/expressway/network";
import { planDistrictRuns, shipRuns } from "../src/expressway/scope";
import { OPERATOR_WORDS } from "../src/game/roadNames";

// R1-1a: the runs cut where the operator's ways end (U10) and where the district of the ref changes
// (1 | K1), behind `--run-borders cut`; the districts from the plan; --districts. Synthetic networks in
// a local plane, the "23 wards" x < 3000 m. The operator's name comes from roadNames.ts.
const plane = planeAt(139.75, 35.65);
const OPERATOR = OPERATOR_WORDS[1];
const inWards = (lon: number, lat: number) => plane.toXY(lon, lat)[0] < 3000;
const CUT: PlanOptions = { runBorders: "cut" };

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

const bridge = { bridge: "yes", layer: "1", lanes: "2", maxspeed: "60" };
const operated = (ref: string) => ({ highway: "motorway", ...bridge, ref, name: `${OPERATOR}路線` });
const other = { highway: "motorway", ...bridge, ref: "E1", name: "東名高速道路" };
const ramp = { highway: "motorway_link", ...bridge };

/**
 * One chain west to east: the operator's "3" (way 10, x 0–1000), an unmarked way (11, x 1000–1100),
 * the "3" again (12, x 1100–2000), then another operator's E1 (13, x 2000–3500). A JCT ramp (20)
 * leaves the chain on the node where the operator's ways end (x 2000) and an exit ramp (21) leaves E1
 * (x 2600).
 */
function operatorChain(): Network {
  const segs: Array<[number, number, number, Record<string, string>]> = [
    [10, 0, 1000, operated("3")],
    [11, 1000, 1100, { highway: "motorway", ...bridge, ref: "3" }],
    [12, 1100, 2000, operated("3")],
    [13, 2000, 3500, other],
  ];
  let next = 1000;
  let last: number | null = null;
  const ways: WaySpec[] = segs.map(([id, x0, x1, tags]) => {
    const pts = line(x0, 0, x1, 0);
    const nodeIds = pts.map((_, i) => (i === 0 && last !== null ? last : next++));
    last = nodeIds[nodeIds.length - 1];
    return { id, pts, nodeIds, tags };
  });
  const border = ways[2].nodeIds[ways[2].nodeIds.length - 1];
  const jct = line(2000, 0, 2300, -300);
  ways.push({ id: 20, pts: jct, nodeIds: [border, ...jct.slice(1).map((_, i) => 5000 + i)], tags: ramp });
  const exitAt = ways[3].nodeIds[12];
  const exit = line(2600, 0, 2900, 300);
  ways.push({ id: 21, pts: exit, nodeIds: [exitAt, ...exit.slice(1).map((_, i) => 6000 + i)], tags: ramp });
  return network(ways);
}

/** One chain: the operator's "1" (way 30, x 0–2000) going on as its "K1" (31, x 2000–5000), one viaduct. */
function refChain(refs: [string, string] = ["1", "K1"]): Network {
  const a = line(0, 0, 2000, 0);
  const b = line(2000, 0, 5000, 0);
  const aIds = a.map((_, i) => 100 + i);
  const bIds = [aIds[aIds.length - 1], ...b.slice(1).map((_, i) => 300 + i)];
  return network([
    { id: 30, pts: a, nodeIds: aIds, tags: operated(refs[0]) },
    { id: 31, pts: b, nodeIds: bIds, tags: operated(refs[1]) },
  ]);
}

/** A ground rising gently to the east, so a deck's profile is not flat. */
const ground = (lon: number, lat: number) => plane.toXY(lon, lat)[0] / 400;

describe("--run-borders cut: where the operator's ways end (R1-1a, U10)", () => {
  it("keep: one run by structure, as before", () => {
    const plan = planNetwork(operatorChain(), new Set(), null);
    expect(plan.runs.get("10")!.run.ways).toEqual([10, 11, 12, 13]);
    expect(plan.runs.get("10")!.run.borders).toBeUndefined();
  });

  it("cut: splits on the node after the last operated way; the other operator's side is a run of its own with no operated way, out of the scope", () => {
    const plan = planNetwork(operatorChain(), new Set(), null, [], CUT);
    expect(plan.runs.get("10")!.run.ways).toEqual([10, 11, 12]);
    expect(plan.runs.get("13")!.run.ways).toEqual([13]);
    const ship = shipRuns(plan, inWards);
    expect(ship.main.has("10")).toBe(true);
    expect(ship.all.has("13")).toBe(false);
  });

  it("cut: leaves the end at the border open on both sides (the far side is never written)", () => {
    const plan = planNetwork(operatorChain(), new Set(), null, [], CUT);
    expect(endPlan(plan, plan.runs.get("10")!, false)).toEqual({ kind: "open" });
    expect(endPlan(plan, plan.runs.get("13")!, true)).toEqual({ kind: "open" });
  });

  it("cut: does not split at an unmarked way between two of the operator's (OSM's missing name)", () => {
    const net = operatorChain();
    const chain = planNetwork(net, new Set(), null).runs.get("10")!.chain;
    expect(operatorCuts(net, chain)).toEqual([3]);
  });

  it("cut: a ramp on the border node hangs from the operator's run, not from the other operator's", () => {
    const plan = planNetwork(operatorChain(), new Set(), null, [], CUT);
    const e = endPlan(plan, plan.runs.get("20")!, true);
    expect(e.kind === "junction" && e.parent).toBe("10");
    const ship = shipRuns(plan, inWards);
    expect(ship.ramps.has("20")).toBe(true);
  });

  it("cut: a ramp of the other operator's side is not shipped (it reaches the operator's run only across it)", () => {
    const ship = shipRuns(planNetwork(operatorChain(), new Set(), null, [], CUT), inWards);
    expect(ship.all.has("21")).toBe(false);
    const kept = shipRuns(planNetwork(operatorChain(), new Set(), null), inWards);
    expect(kept.ramps.has("21")).toBe(true);
  });
});

describe("--run-borders cut: where the district of the ref changes (R1-1a, 1 | K1)", () => {
  it("keep: one run; cut: two runs on the node where the ref changes", () => {
    expect(planNetwork(refChain(), new Set(), null).runs.get("30")!.run.ways).toEqual([30, 31]);
    const plan = planNetwork(refChain(), new Set(), null, [], CUT);
    expect(plan.runs.get("30")!.run.ways).toEqual([30]);
    expect(plan.runs.get("31")!.run.ways).toEqual([31]);
  });

  it("cut: the side shipped later (K1, outside) seams onto the side shipped first (1, central), which is free there", () => {
    const plan = planNetwork(refChain(), new Set(), null, [], CUT);
    const child = endPlan(plan, plan.runs.get("31")!, true);
    expect(child.kind === "seam" && child.parent).toBe("30");
    expect(endPlan(plan, plan.runs.get("30")!, false)).toEqual({ kind: "open" });
    // The other way round (K1 first along the chain), the parent is still the central side.
    const back = planNetwork(refChain(["K1", "1"]), new Set(), null, [], CUT);
    const e = endPlan(back, back.runs.get("30")!, false);
    expect(e.kind === "seam" && e.parent).toBe("31");
  });

  it("cut: the two runs meet at the same height and grade (one profile across the border)", () => {
    const res = solvePlan(planNetwork(refChain(), new Set(), null, [], CUT), ground, []);
    const chunks = (run: string) => res.chunks.filter((c) => c.run === run).sort((a, b) => a.k - b.k);
    const last = chunks("30").at(-1)!.st;
    const first = chunks("31")[0].st;
    // A station: s, lon, lat, z, bank, ground, grade (format.ts).
    const end = last.length - STATION_STRIDE;
    expect(first[3]).toBeCloseTo(last[end + 3], 2);
    expect(first[6]).toBeCloseTo(last[end + 6], 4);
  });

  it("cut: both sides stay in the scope although K1 lies wholly outside the wards (a line over the wards ships to its end, U11)", () => {
    // Here the wards end at x 1500, so no node of K1 (x 2000–5000) is near them.
    const westWards = (lon: number, lat: number) => plane.toXY(lon, lat)[0] < 1500;
    const plan = planNetwork(refChain(), new Set(), null, [], CUT);
    expect([...shipRuns(plan, westWards).main]).toEqual(["30", "31"]);
  });

  it("does not split C2 at the yamate box, nor two refs of one district", () => {
    const net = refChain(["C2", "C2"]);
    const chain = planNetwork(net, new Set(), null).runs.get("30")!.chain;
    expect(refBorders(net, chain)).toEqual([]);
    const same = refChain(["1", "2"]);
    expect(refBorders(same, planNetwork(same, new Set(), null).runs.get("30")!.chain)).toEqual([]);
  });
});

describe("地区（districts.ts、R1-1a）", () => {
  it("takes the first value of a `;` list that the table has, and outside for a ref it does not have", () => {
    expect(districtOfRefName("E14;14")).toBe("outside");
    expect(districtOfRefName("E14;7")).toBe("east");
    expect(districtOfRefName("K1")).toBe("outside");
    expect(districtOfRefName("S5")).toBe("outside");
    expect(districtOfRefName("C2")).toBe("east");
    expect(districtOfRef("C2", 139.6, 35.6)).toBe("yamate");
  });

  it("puts a C2 run across the yamate box in east, the district shipped first", () => {
    const d = assignDistricts([
      {
        id: "a",
        cls: "expressway",
        ref: "C2",
        parents: [],
        points: [
          [139.6, 35.6],
          [139.8, 35.6],
        ],
        middle: [139.6, 35.6],
      },
      {
        id: "b",
        cls: "expressway",
        ref: "C2",
        parents: [],
        points: [
          [139.6, 35.6],
          [139.61, 35.6],
        ],
      },
    ]);
    expect(d.get("a")).toBe("east");
    expect(d.get("b")).toBe("yamate");
  });

  it("places a ramp with no parent by the nearest main line's line, not its nearest point (the same in the plan's samples and the chunks' stations)", () => {
    // Main "1" runs west–east past the ramp with points 2 km apart; main "5" has a point 300 m off.
    const ramp = {
      id: "r",
      cls: "ramp" as const,
      ref: null,
      parents: [],
      points: [[139.7, 35.6]] as Array<[number, number]>,
    };
    const sparse = {
      id: "a",
      cls: "expressway" as const,
      ref: "1",
      parents: [],
      points: [
        [139.69, 35.6001],
        [139.71, 35.6001],
      ] as Array<[number, number]>,
    };
    const near = {
      id: "b",
      cls: "expressway" as const,
      ref: "5",
      parents: [],
      points: [[139.7, 35.6027]] as Array<[number, number]>,
    };
    expect(assignDistricts([ramp, sparse, near]).get("r")).toBe("central");
  });

  it("gives every written run the same district from the plan as from its chunks", () => {
    const plan = planNetwork(refChain(), new Set(), null, [], CUT);
    const res = solvePlan(plan, ground, []);
    const byRun = new Map<string, XwChunk[]>();
    for (const c of res.chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
    const fromChunks = assignDistricts(districtRunsOf(res.runs, byRun));
    const fromPlan = assignDistricts(
      planDistrictRuns(
        plan,
        res.runs.map((r) => r.id),
      ),
    );
    for (const r of res.runs) expect(fromPlan.get(r.id)).toBe(fromChunks.get(r.id));
    expect(fromPlan.get("30")).toBe("central");
    expect(fromPlan.get("31")).toBe("outside");
  });
});

describe("--districts（地区で絞って書く、R1-1a、T8）", () => {
  it("writes a district's runs with the very chunks the whole scope writes", () => {
    const shipAll = (p: Parameters<NonNullable<PlanOptions["wanted"]>>[0]) => shipRuns(p, inWards).all;
    const central = (p: Parameters<NonNullable<PlanOptions["wanted"]>>[0]) => {
      const all = shipAll(p);
      const d = assignDistricts(planDistrictRuns(p, all));
      return new Set([...all].filter((id) => d.get(id) === "central"));
    };
    const whole = solvePlan(
      planNetwork(refChain(), new Set(), null, [], { ...CUT, wanted: shipAll }),
      ground,
      [],
    );
    const only = solvePlan(
      planNetwork(refChain(), new Set(), null, [], { ...CUT, wanted: central }),
      ground,
      [],
    );
    expect(only.runs.map((r) => r.id)).toEqual(["30"]);
    const text = (cs: XwChunk[], run: string) => JSON.stringify(cs.filter((c) => c.run === run));
    expect(text(only.chunks, "30")).toBe(text(whole.chunks, "30"));
  });

  it("stops without --range ship, and on a name that is no district", () => {
    expect(districtsRefusal("central", false, DISTRICTS)).toMatch(/--range ship/);
    expect(districtsRefusal("central,nowhere", true, DISTRICTS)).toMatch(/unknown --districts nowhere/);
    expect(districtsRefusal("central,east", true, DISTRICTS)).toBeNull();
    expect(districtsRefusal(undefined, false, DISTRICTS)).toBeNull();
  });

  it("--run-borders cut never writes the shipped folder (S7-6 makes it the default)", () => {
    const plain = { hasOut: false, isBelowAll: false, isBlocks: false, isV1: false, v2Flags: [] };
    expect(shippedFolderRefusal({ ...plain, isRunBordersCut: true })).toMatch(/^--run-borders cut/);
    expect(shippedFolderRefusal({ ...plain, hasOut: true, isRunBordersCut: true })).toBeNull();
  });
});
