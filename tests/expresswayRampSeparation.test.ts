import { describe, expect, it } from "vitest";
import {
  composeShiftRequests,
  type CrossObject,
  planNetwork,
  type PlanOptions,
  solvePlan,
  solveWithRampShift,
} from "../src/expressway/compile";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { deckOverlaps } from "../src/expressway/overlap";

// S6 PR 4: a ramp that leaves its main line beside it (汐留型: 1.5 m between the centre lines for 150 m,
// then parting) and comes down to the ground soon after, held one surface from the nose but apart in
// height where it leaves. 案 A moves it off the main line there (decided on a first solve of the whole
// components); 案 B keeps the two one surface wherever they overlap.

const P = planeAt(139.75, 35.65);
const MAIN = "1";
const RAMP = "2";

/** The 汐留型 net; `third` adds a viaduct of its own 10 m south of the main line beside the ramp (x 300–520). */
function shiodome(o: { third?: boolean } = {}): Network {
  const n: Network = { ways: new Map(), nodes: new Map() };
  const node = (id: number, x: number, y: number) => {
    const [lon, lat] = P.toLonLat(x, y);
    n.nodes.set(id, normalizeNode(id, lon, lat, {}));
    return id;
  };
  const viaduct = {
    highway: "motorway",
    bridge: "yes",
    layer: "1",
    lanes: "2",
    maxspeed: "60",
    oneway: "yes",
  };
  const main: number[] = [];
  for (let x = 0; x <= 1600; x += 50) main.push(node(1000 + x / 50, x, 0));
  n.ways.set(1, normalizeWay(1, main, viaduct));
  // The ramp leaves the main line at x 400 (a shared node), runs 1.5 m off it to x 550, then parts
  // south and comes down to the ground at x 600, y −11.5: too soon to come down only after it parts.
  const ramp: number[] = [1000 + 400 / 50];
  const pts: Array<[number, number]> = [];
  for (let x = 425; x <= 550; x += 25) pts.push([x, -1.5]);
  for (let x = 575; x <= 600; x += 25) pts.push([x, -1.5 - (10 * (x - 550)) / 50]);
  pts.forEach(([x, y], i) => ramp.push(node(2000 + i, x, y)));
  n.ways.set(
    2,
    normalizeWay(2, ramp, { highway: "motorway_link", bridge: "yes", layer: "1", oneway: "yes" }),
  );
  if (o.third) {
    const third: number[] = [];
    for (let x = 300; x <= 520; x += 20) third.push(node(3000 + x / 20, x, -10));
    n.ways.set(3, normalizeWay(3, third, viaduct));
  }
  return n;
}
const ground = () => 3;
const options: PlanOptions = { structures: "height" };
const between = (chunks: Parameters<typeof deckOverlaps>[0], a: string, b: string) =>
  deckOverlaps(chunks).filter((o) => [o.a, o.b].sort().join() === [a, b].sort().join());
const shifted = (
  net: () => Network,
  maxM: number,
  range: Parameters<typeof planNetwork>[2] = null,
  objects: CrossObject[] = [],
) =>
  solveWithRampShift(
    (rampOffsets) =>
      planNetwork(net(), new Set(), range, [], { ...options, rampOffsets, rampShiftCapM: maxM }),
    ground,
    objects,
    maxM,
  );

describe("並走ランプの分離（S6 PR 4、汐留型の合成網）", () => {
  const plan0 = planNetwork(shiodome(), new Set(), null, [], options);
  const first = solvePlan(plan0, ground, []);

  it("without the flags, the ramp parts from the main line over its carriageway apart in height (the case)", () => {
    expect(first.runs.map((r) => r.id).sort()).toEqual([MAIN, RAMP]);
    expect(between(first.chunks, MAIN, RAMP).length).toBe(1);
    // No flag, no change: planned again with no offsets, the same chunks.
    const again = solvePlan(
      planNetwork(shiodome(), new Set(), null, [], { ...options, rampOffsets: new Map() }),
      ground,
      [],
    );
    expect(again.chunks).toEqual(first.chunks);
  });

  it("案 A at 8 m (1.5 m between the centre lines takes about 5.6): no overlap apart in height left, the ramp solved to its ground end where it was, the main line's plan as it was", async () => {
    const { plan, result, moved, dropped } = await shifted(shiodome, 8);
    expect(moved).toEqual([plan.runs.get(RAMP)!.chain.id]);
    expect(dropped).toEqual([]);
    expect(between(result.chunks, MAIN, RAMP)).toEqual([]);
    const ramp = result.runs.find((r) => r.id === RAMP)!;
    expect(ramp.rampShiftM).toBeGreaterThan(4);
    expect(ramp.rampShiftM).toBeLessThanOrEqual(8 + 1.5);
    expect(ramp.rampShiftCapM).toBe(8);
    expect(ramp.end.kind).toBe("ground");
    expect(Array.from(plan.runs.get(MAIN)!.align.xy)).toEqual(Array.from(plan0.runs.get(MAIN)!.align.xy));
    expect(result.runs.find((r) => r.id === MAIN)!.rampShiftM).toBeUndefined();
    // Both its ends stay on their nodes: the junction and the ground end.
    const r0 = plan0.runs.get(RAMP)!;
    const r1 = plan.runs.get(RAMP)!;
    for (const [i, j] of [
      [r1.i0, r0.i0],
      [r1.i1, r0.i1],
    ])
      expect([r1.align.xy[2 * i], r1.align.xy[2 * i + 1]]).toEqual([
        r0.align.xy[2 * j],
        r0.align.xy[2 * j + 1],
      ]);
  });

  it("案 A at 3 m (the value taken): the ramp moves by about 3 m and the overlap shortens, but stays here (5.6 m would be needed)", async () => {
    const { result } = await shifted(shiodome, 3);
    const ramp = result.runs.find((r) => r.id === RAMP)!;
    expect(ramp.rampShiftM).toBeGreaterThan(2);
    expect(ramp.rampShiftM).toBeLessThanOrEqual(3 + 1.5);
    const after = between(result.chunks, MAIN, RAMP);
    const before = between(first.chunks, MAIN, RAMP);
    expect(after.length).toBe(1);
    expect(after[0].stations).toBeLessThan(before[0].stations);
  });

  it("decides on the whole component: with the range on the main line's far end only, the ramp moves the same (T8)", async () => {
    const whole = await shifted(shiodome, 8);
    const [lon0, lat0] = P.toLonLat(1300, -20);
    const [lon1, lat1] = P.toLonLat(1600, 20);
    const part = await shifted(shiodome, 8, { minLon: lon0, minLat: lat0, maxLon: lon1, maxLat: lat1 });
    expect(part.plan.wanted.has(RAMP)).toBe(false);
    expect(part.moved).toEqual(whole.moved);
    const ids = new Set(part.result.chunks.map((c) => c.id));
    const common = whole.result.chunks.filter((c) => ids.has(c.id));
    expect(common.length).toBeGreaterThan(0);
    expect(part.result.chunks.filter((c) => common.some((k) => k.id === c.id))).toEqual(common);
  });

  it("moves no farther than the room on its side: a third deck 10 m south caps the move, no new overlap with it", async () => {
    const free = await shifted(shiodome, 8);
    const capped = await shifted(() => shiodome({ third: true }), 8);
    const ramp = (r: typeof free) => r.result.runs.find((x) => x.id === RAMP)!;
    expect(ramp(capped).rampShiftM ?? 0).toBeLessThan(ramp(free).rampShiftM!);
    expect(between(capped.result.chunks, RAMP, "3")).toEqual([]);
  });

  it("案 B: one surface wherever the two overlap, from the nose on to where they part", () => {
    const plan = planNetwork(shiodome(), new Set(), null, [], { ...options, noseSurface: "overlap" });
    expect(plan.pairs.filter((p) => [p.a, p.b].includes(RAMP) && p.relation !== "same")).toEqual([]);
    const res = solvePlan(plan, ground, []);
    expect(res.runs.map((r) => r.id).sort()).toEqual([MAIN, RAMP]);
  });
});

describe("逆向きの要求は両方とも動かさない（PR 4 レビュー C2）", () => {
  const ask = (i0: number, i1: number, sign: 1 | -1, amount = 2) => ({
    i0,
    i1,
    sign,
    amount,
    w: new Float64Array(100).fill(1),
    base: 0,
  });
  it("leaves out two asks for opposite sides over common samples, keeps one that does not overlap", () => {
    expect(composeShiftRequests([ask(10, 40, 1), ask(30, 60, -1)], 100)).toBeNull();
    const kept = composeShiftRequests([ask(10, 40, 1), ask(30, 60, -1), ask(70, 90, 1)], 100)!;
    expect(kept[20]).toBe(0);
    expect(kept[50]).toBe(0);
    expect(kept[80]).toBe(2);
  });
  it("takes the larger of two asks for one side", () => {
    const o = composeShiftRequests([ask(10, 40, -1, 1), ask(20, 50, -1, 3)], 100)!;
    expect([o[15], o[30], o[45]]).toEqual([-1, -3, -3]);
  });
});
