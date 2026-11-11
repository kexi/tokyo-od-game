import { describe, expect, it } from "vitest";
import { planNetwork } from "../src/expressway/compile";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeStreetWay, normalizeWay } from "../src/expressway/network";
import { parseRanges } from "../src/expressway/ranges";
import { scopeExtent, shipRuns } from "../src/expressway/scope";
import { OPERATOR_WORDS } from "../src/game/roadNames";

// Synthetic networks in a local plane; the "23 wards" are x < 3000 m. The operator's name comes
// from roadNames.ts, the only file allowed to spell it.
const plane = planeAt(139.75, 35.65);
const OPERATOR = OPERATOR_WORDS[1];
const inWards = (lon: number, lat: number) => plane.toXY(lon, lat)[0] < 3000;

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
const operatedMain = { highway: "motorway", ...bridge, name: `${OPERATOR}都心環状線` };
const otherMain = { highway: "motorway", ...bridge, name: "東名高速道路" };
const ramp = { highway: "motorway_link", ...bridge };

/** A ramp leaving node `from` (at `at`) and running to `to`, with its own node ids from `base`. */
function rampFrom(id: number, from: number, at: [number, number], to: [number, number], base: number) {
  const pts = line(at[0], at[1], to[0], to[1]);
  return { id, pts, nodeIds: [from, ...pts.slice(1).map((_, i) => base + i)], tags: ramp };
}

/**
 * An operated main line A (10) and another operator's main line B (30) 500 m north, both inside
 * the wards; ramp 20 leaves A, ramp 40 leaves ramp 20, ramp 50 leaves B, JCT ramp 80 runs from A
 * up to B; an operated main line C (60) outside the wards with its ramp 70; ramp 90 leaves A on a
 * viaduct and goes on into a tunnel (91, the same chain: a seam); a structure's street 95 over the
 * wards and 96 outside them.
 */
function scene(): Network {
  const a = line(0, 0, 2000, 0);
  const aIds = a.map((_, i) => 1000 + i);
  const b = line(0, 500, 2000, 500);
  const bIds = b.map((_, i) => 3000 + i);
  const c = line(5000, 0, 7000, 0);
  const cIds = c.map((_, i) => 6000 + i);
  const r20 = rampFrom(20, aIds[16], [800, 0], [1100, -300], 2000);
  const r40 = rampFrom(40, r20.nodeIds[4], r20.pts[4], [900, -600], 4000);
  const r50 = rampFrom(50, bIds[10], [500, 500], [800, 800], 5000);
  const r70 = rampFrom(70, cIds[16], [5800, 0], [6100, -300], 7000);
  const jctPts = line(1500, 0, 1700, 500);
  const r80 = {
    id: 80,
    pts: jctPts,
    nodeIds: jctPts.map((_, i) => (i === 0 ? aIds[30] : i === jctPts.length - 1 ? bIds[34] : 8000 + i)),
    tags: ramp,
  };
  const r90 = rampFrom(90, aIds[36], [1800, 0], [1900, -150], 9000);
  const tunnelPts = line(1900, -150, 2000, -400);
  const r91 = {
    id: 91,
    pts: tunnelPts,
    nodeIds: [r90.nodeIds[r90.nodeIds.length - 1], ...tunnelPts.slice(1).map((_, i) => 9100 + i)],
    tags: { highway: "motorway_link", tunnel: "yes", layer: "-1", lanes: "1" },
  };
  const net = network([
    { id: 10, pts: a, nodeIds: aIds, tags: operatedMain },
    { id: 30, pts: b, nodeIds: bIds, tags: otherMain },
    { id: 60, pts: c, nodeIds: cIds, tags: operatedMain },
    r20,
    r40,
    r50,
    r70,
    r80,
    r90,
    r91,
  ]);
  for (const [id, x0, base] of [
    [95, 0, 9500],
    [96, 5000, 9600],
  ] as const) {
    const pts = line(x0, -800, x0 + 600, -800);
    const ids = pts.map((_, i) => base + i);
    net.ways.set(id, normalizeStreetWay(id, ids, { highway: "primary", bridge: "yes", layer: "1" }));
    ids.forEach((n, i) => {
      const [lon, lat] = plane.toLonLat(pts[i][0], pts[i][1]);
      net.nodes.set(n, normalizeNode(n, lon, lat, {}));
    });
  }
  return net;
}

/** A lon/lat box over plane metres. */
function box(x0: number, y0: number, x1: number, y1: number) {
  const [minLon, minLat] = plane.toLonLat(x0, y0);
  const [maxLon, maxLat] = plane.toLonLat(x1, y1);
  return { minLon, minLat, maxLon, maxLat };
}

describe("事業者の way（P2.7-1）", () => {
  it("a way is the operator's when its name or its operator tag names it, never a structure's street", () => {
    expect(normalizeWay(1, [1, 2], { highway: "motorway", name: `${OPERATOR}都心環状線` }).operated).toBe(
      true,
    );
    expect(normalizeWay(2, [1, 2], { highway: "motorway_link", operator: OPERATOR }).operated).toBe(true);
    expect(normalizeWay(3, [1, 2], { highway: "motorway", name: "東名高速道路" }).operated).toBe(false);
    expect(normalizeWay(4, [1, 2], { highway: "motorway_link" }).operated).toBe(false);
    expect(normalizeStreetWay(5, [1, 2], { highway: "primary", operator: OPERATOR }).operated).toBe(false);
  });
});

describe("出荷範囲（scope.ts shipRuns）", () => {
  it("takes the operated main line over the wards and leaves another operator's main line out", () => {
    const ship = shipRuns(planNetwork(scene(), new Set(), null), inWards);
    expect([...ship.main]).toEqual(["10"]);
  });

  it("takes a ramp reaching the operated main line through ramps only, not one hanging from another main line", () => {
    const ship = shipRuns(planNetwork(scene(), new Set(), null), inWards);
    // 20 leaves A, 40 leaves 20, 80 runs from A to B, 91 is seamed to 90 off A; 50 reaches A only
    // across B.
    expect([...ship.ramps]).toEqual(["20", "40", "80", "90", "91"]);
  });

  it("leaves out an operated main line and its ramp outside the wards", () => {
    const ship = shipRuns(planNetwork(scene(), new Set(), null), inWards);
    expect(ship.all.has("60")).toBe(false);
    expect(ship.all.has("70")).toBe(false);
  });

  it("is the same set whichever range the plan was made for", () => {
    const all = shipRuns(planNetwork(scene(), new Set(), null), inWards);
    const east = shipRuns(planNetwork(scene(), new Set(), box(5500, -100, 7000, 100)), inWards);
    const onRamp = shipRuns(planNetwork(scene(), new Set(), box(850, -400, 1000, -200)), inWards);
    expect([...east.all]).toEqual([...all.all]);
    expect([...onRamp.all]).toEqual([...all.all]);
  });

  it("--range ship wants exactly the shipped runs and needs their whole components", () => {
    const parsed = parseRanges("ship");
    expect(parsed).toEqual({ names: [], boxes: null, scope: "ship" });
    const plan = planNetwork(scene(), new Set(), parsed.boxes, [], {
      wanted: (p) => shipRuns(p, inWards).all,
    });
    expect([...plan.wanted].sort()).toEqual(["10", "20", "40", "80", "90", "91", "95"]);
    for (const id of plan.wanted)
      for (const m of plan.components.get(plan.componentOf.get(id)!)!) expect(plan.needed).toContain(m);
  });
});

describe("出荷範囲の境目（P2.7-1 レビュー C1・W1）", () => {
  it("takes a ramp lying wholly on a 20 m sliver between the town polygons (汐留入口)", () => {
    // The wards less a 20 m strip along ramp 20 (800, 0)–(1100, −300): no node of 20 is in a polygon.
    const onRamp20 = (lon: number, lat: number) => {
      const [x, y] = plane.toXY(lon, lat);
      const t = Math.min(1, Math.max(0, ((x - 800) * 300 - y * 300) / (2 * 300 * 300)));
      return Math.hypot(x - (800 + 300 * t), y + 300 * t) < 10;
    };
    const sliver = (lon: number, lat: number) => inWards(lon, lat) && !onRamp20(lon, lat);
    const plan = planNetwork(scene(), new Set(), null);
    const rp = plan.runs.get("20")!;
    const nodes = rp.chain.nodes.slice(rp.run.from, rp.run.to + 1).map((n) => plan.net.nodes.get(n)!);
    expect(nodes.some((n) => sliver(n.lon, n.lat))).toBe(false);
    expect(shipRuns(plan, sliver).ramps.has("20")).toBe(true);
  });

  it("takes a structure's street over the wards (the bridge keeps its lower floor), not one outside", () => {
    const ship = shipRuns(planNetwork(scene(), new Set(), null), inWards);
    expect([...ship.streets]).toEqual(["95"]);
  });

  it("reports the ramps reaching the operated main line but lying wholly outside the wards", () => {
    const ship = shipRuns(planNetwork(scene(), new Set(), null), inWards);
    expect([...ship.rampsOutside]).toEqual(["70"]);
  });

  it("books each run's OSM length inside and outside the wards, on the operator's ways and others'", () => {
    const plan = planNetwork(scene(), new Set(), null);
    const extent = scopeExtent(plan, ["10", "60"], inWards);
    expect(extent.main.inKm).toBeCloseTo(2, 2);
    expect(extent.main.outKm).toBeCloseTo(2, 2);
    expect(extent.main.operatedKm).toBeCloseTo(4, 2);
    expect(extent.main.otherKm).toBe(0);
    expect(scopeExtent(plan, ["30"], inWards).main.otherKm).toBeCloseTo(2, 2);
  });
});

/** Two viaducts joined only by a tunnel between them: the tunnel would make them one QP. */
function tunnelBetween(): Network {
  const v1 = line(0, 0, 1000, 0);
  const t = line(1000, 0, 1600, 0);
  const v2 = line(1600, 0, 2600, 0);
  const ids1 = v1.map((_, i) => 100 + i);
  const idsT = [ids1[ids1.length - 1], ...t.slice(1).map((_, i) => 200 + i)];
  const ids2 = [idsT[idsT.length - 1], ...v2.slice(1).map((_, i) => 300 + i)];
  return network([
    { id: 1, pts: v1, nodeIds: ids1, tags: operatedMain },
    { id: 2, pts: t, nodeIds: idsT, tags: { ...operatedMain, bridge: "no", layer: "-1", tunnel: "yes" } },
    { id: 3, pts: v2, nodeIds: ids2, tags: operatedMain },
  ]);
}

describe("--below all（pruneBelow: false）", () => {
  it("by default defers the tunnel that would join two components, and compiles it with pruneBelow false", () => {
    const pruned = planNetwork(tunnelBetween(), new Set(), null);
    expect(pruned.runs.has("2")).toBe(false);
    expect(pruned.belowDeferred).toContain("2");
    const all = planNetwork(tunnelBetween(), new Set(), null, [], { pruneBelow: false });
    expect(all.runs.get("2")?.below).toBe(true);
    expect(all.componentOf.get("1")).toBe(all.componentOf.get("3"));
  });
});
