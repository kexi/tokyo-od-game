import { describe, expect, it } from "vitest";
import { HEIGHT_STRUCTURES } from "../src/expressway/assumptions";
import { checkJunction } from "../src/expressway/checks";
import { planNetwork, solvePlan } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { surfaceAt } from "../src/expressway/profile";
import { violationsOf } from "../src/expressway/violations";

// S6 PR 2 (`--ground compile`): a chain's stretch at grade becomes a run of its own, seamed (C¹) to the
// viaducts beside it, its profile on the design ground line within a band, not on the DEM's bumps; its
// structure by height (cut or embankment), and the roads across it blocked.

const plane = planeAt(139.75, 35.65);
type WaySpec = { id: number; x0: number; x1: number; tags: Record<string, string> };
const bridge = { highway: "motorway", bridge: "yes", layer: "1", lanes: "2", maxspeed: "60", ref: "C1" };
const atGrade = { highway: "motorway", lanes: "2", maxspeed: "60", ref: "C1" };

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
/** Level at T.P. 3 m with a wave of 0.5 m every 100 m: the DEM's bumps a road must not follow. */
const bumpy = (lon: number, lat: number) => 3 + 0.5 * Math.sin((2 * Math.PI * xOf(lon, lat)) / 100);

const byRun = (chunks: XwChunk[]) => {
  const out = new Map<string, XwChunk[]>();
  for (const c of chunks) out.set(c.run, [...(out.get(c.run) ?? []), c]);
  for (const list of out.values()) list.sort((a, b) => a.k - b.k);
  return out;
};

const net = network([
  { id: 1, x0: 0, x1: 1000, tags: bridge },
  { id: 2, x0: 1000, x1: 1600, tags: atGrade },
  { id: 3, x0: 1600, x1: 2600, tags: bridge },
]);
const [lon0, lat0] = plane.toLonLat(1300, -40);
const [lon1, lat1] = plane.toLonLat(1300, 40);
const road = {
  kind: "road" as const,
  id: 99,
  pts: [[lon0, lat0] as [number, number], [lon1, lat1] as [number, number]],
};
const options = { structures: "height" as const };
const skip = solvePlan(planNetwork(net, new Set(), null, [], options), bumpy, [road]);
const compiled = solvePlan(planNetwork(net, new Set(), null, [], { ...options, ground: "compile" }), bumpy, [
  road,
]);

describe("地平 run（合成網: 高架 → 地平 600 m → 高架）", () => {
  it("skip leaves the stretch at grade out, as before; compile makes it the third run, seamed to both viaducts", () => {
    expect(skip.runs.map((r) => r.id).sort()).toEqual(["1", "3"]);
    expect(compiled.runs.map((r) => r.id).sort()).toEqual(["1", "2", "3"]);
    const runs = new Map(compiled.runs.map((r) => [r.id, r]));
    expect(runs.get("2")!.ground).toBe(true);
    expect(runs.get("1")!.end).toMatchObject({ kind: "seam", parent: "2" });
    expect(runs.get("3")!.start).toMatchObject({ kind: "seam", parent: "2" });
    const chunks = byRun(compiled.chunks);
    expect(
      checkJunction(
        chunks.get("1")![chunks.get("1")!.length - 1],
        false,
        runs.get("1")!.end.grade!,
        chunks.get("2")!,
      ),
    ).toEqual([]);
    expect(checkJunction(chunks.get("3")![0], true, runs.get("3")!.start.grade!, chunks.get("2")!)).toEqual(
      [],
    );
  });

  it("keeps within the band of the design ground line and takes none of the 100 m bumps (no reversal, short-wave σ ≤ 0.1 m)", () => {
    const list = byRun(compiled.chunks).get("2")!;
    const z: number[] = [];
    for (const c of list) {
      const a = c.st[0];
      const b = c.st[c.st.length - STATION_STRIDE];
      for (let s = Math.ceil(a); s <= b; s += 1) z.push(surfaceAt(c.st, s).z);
    }
    const band = HEIGHT_STRUCTURES.value.ground.bandM;
    // Away from the seams (the climbs to the viaducts), the road keeps to the ground line's band.
    const middle = z.slice(150, z.length - 150);
    for (const v of middle) expect(Math.abs(v - 3)).toBeLessThanOrEqual(band + 0.05);
    let flips = 0;
    let sign = 0;
    for (let i = 10; i < middle.length; i += 10) {
      const g = (middle[i] - middle[i - 10]) / 10;
      const s = Math.abs(g) < 0.002 ? 0 : Math.sign(g);
      if (s !== 0 && sign !== 0 && s !== sign) flips++;
      if (s !== 0) sign = s;
    }
    expect(flips).toBe(0);
    const mean = middle.reduce((n, v) => n + v, 0) / middle.length;
    const sd = Math.sqrt(middle.reduce((n, v) => n + (v - mean) ** 2, 0) / middle.length);
    expect(sd).toBeLessThanOrEqual(0.1);
  });

  it("is a cut where the ground is not well under it and an embankment elsewhere; T13 holds, and the road across it is blocked", () => {
    const list = byRun(compiled.chunks).get("2")!;
    for (const c of list) expect(["cut", "embankment"]).toContain(c.structure);
    for (const c of list) expect(c.piers).toEqual([]);
    const v = violationsOf(
      { runs: compiled.runs, diagnostics: compiled.diagnostics },
      compiled.chunks,
      () => undefined,
      true,
    );
    for (const p of ["T1", "T2", "T3", "T5", "T13"] as const)
      expect(v[p].count, `${p} ${v[p].first.join()}`).toBe(0);
    const blocked = compiled.diagnostics.filter(
      (d) => d.run === "2" && d.kind === "crossing_over_or_at_grade",
    );
    expect(blocked.map((d) => d.detail)).toEqual([
      expect.stringMatching(/^road 99 at 300 m crosses the road at grade/),
    ]);
    expect(list.flatMap((c) => c.cross)).toEqual([]);
  });

  it("on the run at grade the car finds a surface: the collider is the graph's (T11), no hole over the carriageway, no step at its seams", async () => {
    const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
    await RAPIER.init();
    const { LocalFrame } = await import("../src/geo/frame");
    const { createDeckBody, deckArraySteps } = await import("../src/world/expresswayDeck");
    const { expresswayRoadInput, joinExpressway } = await import("../src/world/expresswayRoads");
    const { RoadGraph, leftOf } = await import("../src/world/roads");
    const { sectionWidth } = await import("../src/world/laneChange");
    const N = 36.9;
    const [lonC, latC] = plane.toLonLat(1300, 0);
    const frame = new LocalFrame(latC, lonC, 40);
    const place = { frame, ellipsoidal: (_lat: number, _lon: number, h: number) => h + N };
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    for (const c of compiled.chunks) {
      const steps = deckArraySteps(c, place, false, null);
      let r = steps.next();
      while (!r.done) r = steps.next();
      createDeckBody(world, r.value.collider, r.value.piers, null);
    }
    world.step();
    const down = (x: number, y: number, z: number) => {
      const hit = world.castRay(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), 40, true);
      return hit ? y - hit.timeOfImpact : null;
    };
    const graph = new RoadGraph(
      joinExpressway([], expresswayRoadInput(compiled.chunks, compiled.runs, place.ellipsoidal), () => {}),
      frame,
    );
    let checked = 0;
    for (const seg of graph.segments.filter((s) => s.line.xid?.startsWith("2:"))) {
      const half = sectionWidth(seg.line.section!) / 2;
      for (let s = 0.013; s < seg.length; s += 2) {
        const { pos, dir } = graph.sample(seg, s);
        const y = graph.surfaceY(seg, s)!;
        const hit = down(pos.x, y + 2, pos.z);
        expect(hit, `${seg.line.xid} s ${s}`).not.toBeNull();
        expect(Math.abs(hit! - y)).toBeLessThanOrEqual(0.01);
        for (let u = -half + 0.1; u <= half - 0.1; u += 1) {
          const p = pos.clone().add(leftOf(dir, u));
          expect(down(p.x, y + 2, p.z), `${seg.line.xid} s ${s} u ${u}`).not.toBeNull();
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(250);
    // Across both seams (viaduct → at grade → viaduct) the surface has no step over 1 mm.
    for (const x of [1000, 1600]) {
      const near = graph.segments.filter((s) => s.line.xid !== undefined);
      const [lon, lat] = plane.toLonLat(x, 0);
      const p = frame.toLocal(lat, lon, 0);
      const a = down(p.x - 0.02, 40, p.z);
      const b = down(p.x + 0.02, 40, p.z);
      expect(near.length).toBeGreaterThan(0);
      expect(Math.abs(a! - b!)).toBeLessThanOrEqual(0.003);
    }
    world.free();
  });

  it("a ramp joining the run at grade takes its height and grade at the junction (T3)", () => {
    const withRamp = network([
      { id: 1, x0: 0, x1: 1000, tags: bridge },
      { id: 2, x0: 1000, x1: 1600, tags: atGrade },
      { id: 3, x0: 1600, x1: 2600, tags: bridge },
    ]);
    const rampNodes = [200000, 200001, 200002, 101300];
    const rampXY: Array<[number, number]> = [
      [1000, -120],
      [1100, -80],
      [1200, -30],
      [1300, 0],
    ];
    withRamp.ways.set(
      4,
      normalizeWay(4, rampNodes, { highway: "motorway_link", bridge: "yes", layer: "1", oneway: "yes" }),
    );
    rampNodes.slice(0, 3).forEach((id, i) => {
      const [lon, lat] = plane.toLonLat(...rampXY[i]);
      withRamp.nodes.set(id, normalizeNode(id, lon, lat, {}));
    });
    const res = solvePlan(
      planNetwork(withRamp, new Set(), null, [], { ...options, ground: "compile" }),
      bumpy,
      [],
    );
    const ramp = res.runs.find((r) => r.id === "4")!;
    expect(ramp.end).toMatchObject({ kind: "junction", parent: "2" });
    const chunks = byRun(res.chunks);
    const last = chunks.get("4")![chunks.get("4")!.length - 1];
    expect(checkJunction(last, false, ramp.end.grade!, chunks.get("2")!)).toEqual([]);
  });

  it("leaves out a stretch at grade between two tunnels (the open part of a tunnel, 赤坂)", () => {
    const tunnel = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: "60", ref: "C1" };
    const between = network([
      { id: 11, x0: 0, x1: 500, tags: bridge },
      { id: 12, x0: 500, x1: 800, tags: tunnel },
      { id: 13, x0: 800, x1: 850, tags: atGrade },
      { id: 14, x0: 850, x1: 1150, tags: tunnel },
      { id: 15, x0: 1150, x1: 1650, tags: bridge },
    ]);
    const plan = planNetwork(between, new Set(), null, [], {
      ...options,
      ground: "compile",
      pruneBelow: false,
    });
    expect(plan.runs.has("13")).toBe(false);
    expect(plan.runs.has("12")).toBe(true);
  });

  it("superelevation, strictly: a pinned bank is cut to what the grade leaves (第25条) and the run-ins stay within 第18条", async () => {
    const { superelevation } = await import("../src/expressway/superelevation");
    const { MAX_SUPERELEVATION, TRANSITION_LENGTH } = await import("../src/law/roadStandards");
    const n = 101;
    const s = Float64Array.from({ length: n }, (_, i) => i);
    const kappa = new Float64Array(n).fill(1 / 30);
    // Room 0.01 over the middle (a steep grade), a pin of −0.05 there from a deck of the same surface.
    const room = Float64Array.from({ length: n }, (_, i) => (i > 40 && i < 60 ? 0.01 : 0.1));
    const pins = new Float64Array(n).fill(Number.NaN);
    pins[50] = -0.05;
    const bank = superelevation(20, kappa, s, { start: 0, end: 0 }, { room, pins, strict: true });
    for (let i = 0; i < n; i++) expect(Math.abs(bank[i])).toBeLessThanOrEqual(room[i] + 1e-12);
    const rate = MAX_SUPERELEVATION.value.type1to3 / TRANSITION_LENGTH.value[20];
    for (let i = 1; i < n; i++) expect(Math.abs(bank[i] - bank[i - 1])).toBeLessThanOrEqual(rate + 1e-9);
    expect(bank[0]).toBe(0);
    expect(bank[n - 1]).toBe(0);
  });

  it("moves a structure's boundary off a tight curve: to the nearest knot outside it, else to its nearer end, within 20 m (T3, 60942193:1)", async () => {
    const { offTightCurve } = await import("../src/expressway/compile");
    // A ramp sampled every metre over 100 m, on a curve of R 15 m (its floor) from 40 to 70 m.
    const n = 101;
    const s = Float64Array.from({ length: n }, (_, i) => i);
    const kappa = Float64Array.from({ length: n }, (_, i) => (i >= 40 && i <= 70 ? 1 / 15 : 0));
    const rp = { align: { s, kappa }, i0: 0, i1: n - 1, cls: "ramp", planV: 40 } as unknown as Parameters<
      typeof offTightCurve
    >[0];
    // Off the curve it stays.
    expect(offTightCurve(rp, 20, [])).toBe(20);
    // In it, to a knot outside it within 20 m (the nearest), not to one inside.
    expect(offTightCurve(rp, 50, [45, 35, 75])).toBe(35);
    // No knot outside it: to the curve's nearer end.
    expect(offTightCurve(rp, 66, [])).toBe(70);
    // Its ends more than 20 m away: it stays (T13 takes no longer a mismatch).
    const long = { ...rp, align: { s, kappa: Float64Array.from({ length: n }, () => 1 / 15) } } as typeof rp;
    expect(offTightCurve(long, 50, [])).toBe(50);
  });

  it("needs the structures by height", () => {
    expect(() => planNetwork(net, new Set(), null, [], { ground: "compile" })).toThrow(/structures: height/);
  });
});
