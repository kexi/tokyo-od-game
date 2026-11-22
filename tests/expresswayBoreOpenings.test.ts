import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PARAPET_WIDTH, TUNNEL_ROOF, TUNNEL_WALKWAY } from "../src/expressway/assumptions";
import { TUNNEL_INNER_HEIGHT_M } from "../src/expressway/below";
import type { XwChunk, XwOpening, XwRunSummary } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { boreWallBand } from "../src/world/expresswayBore";
import { createDeckBody, deckArraySteps, type GeoToLocal, tunnelPoint } from "../src/world/expresswayDeck";
import { DeckIndex } from "../src/world/expresswayMarkings";
import { MERGE_FULL_DZ, MERGE_MAX_DZ } from "../src/world/expresswayMerge";
import { seamCases } from "../src/expressway/ledger";
import { probeGenerated } from "../scripts/expresswaySeams";

beforeAll(() => RAPIER.init());

// S7-4a: a tunnel's or cut's side opened where another run leaves or joins it under the ground
// (format.ts XwOpening, expresswayMerge.ts openBore). Synthetic: a main line M going east along x at
// T.P. 10 m (2 lanes, hw 4.25 m), and a one-lane ramp C (hw 2.375 m) leaving M's centre line at
// x = 60 and drifting north (M's left) at `drift` per metre, `RAMP_DZ` over M's surface. The rays
// keep off the stations' x (every 10 m): a ray exactly on the edge two triangles share may slip
// between them (Rapier's trimesh), as on any deck.
const plane = planeAt(139.75, 35.65);
const N = 36.9;
const frame = new LocalFrame(35.65, 139.751, 40);
const place: GeoToLocal = { frame, ellipsoidal: (_lat, _lon, h) => h + N };
const ellipsoidal = (_lat: number, _lon: number, h: number) => h + N;
const ROAD = 10;
const RAMP_DZ = 0.03;
const HW_M = (2 * 3.25 + 1.25 + 0.75) / 2;
const HW_C = (3.25 + 1 + 0.5) / 2;
const EDGE_M = HW_M + PARAPET_WIDTH.value;
const H = TUNNEL_INNER_HEIGHT_M;
const ROOF = TUNNEL_ROOF.value.slab;
const NOSE = 60;

type Shape = { structure: "cut" | "tunnel"; drift: number; mBreaks: number[]; mEnd: number };

/** The local point of plane (x, y) at height T.P. h. */
function local(x: number, y: number, h: number): Vector3 {
  const [lon, lat] = plane.toLonLat(x, y);
  return frame.toLocal(lat, lon, h + N);
}
/** Left of travel (north) in the local frame, a unit vector. */
const LEFT = local(0, 1, 0)
  .sub(local(0, 0, 0))
  .normalize();
const ALONG = local(1, 0, 0)
  .sub(local(0, 0, 0))
  .normalize();

function chunk(
  id: string,
  run: string,
  structure: XwChunk["structure"],
  stations: Array<[number, number, number, number] | [number, number, number, number, number]>,
  ground: number,
  extra: Partial<XwChunk>,
): XwChunk {
  const st: number[] = [];
  for (const [s, x, y, z, g = 0] of stations) {
    const [lon, lat] = plane.toLonLat(x, y);
    st.push(s, lon, lat, z, 0, ground, g);
  }
  const isRamp = run === "C";
  return {
    id,
    run,
    chain: run,
    k: Number(id.split(":")[1]),
    cls: isRamp ? "ramp" : "expressway",
    ref: null,
    name: null,
    structure,
    over: null,
    lanes: isRamp ? 1 : 2,
    laneWidth: 3.25,
    shoulderL: isRamp ? 1 : 1.25,
    shoulderR: isRamp ? 0.5 : 0.75,
    basis: "statute",
    V: 60,
    maxspeed: null,
    vh: 50,
    gmax: 0.05,
    g0: 0,
    g1: 0,
    h0: 0,
    h1: 0,
    girder: structure === "viaduct" || structure === "embankment" ? 2.2 : 0,
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

const summary = (id: string, cls: "expressway" | "ramp", chunks: string[], start: object) =>
  ({
    id,
    chain: id,
    cls,
    ref: null,
    lengthM: 0,
    V: 60,
    tagV: 60,
    planV: 60,
    minRadiusM: 0,
    maxShiftM: 0,
    steps: [],
    start,
    end: { kind: "ground" },
    chunks,
    structure: null,
  }) as XwRunSummary;

/**
 * The pair: M's chunks broken at `mBreaks`, C one chunk from the nose to x = NOSE + 160. The data's
 * opening is where the two carriageways overlap (as S7-3 writes it: the same stretch), on M's left
 * and C's right, cut at M's chunk borders (each piece on its chunk). `mStructure` / `cStructure`
 * override the structures (H: an embankment parent), `withOpenings` false writes none.
 */
function pair(
  shape: Shape,
  options: {
    mStructure?: XwChunk["structure"];
    cStructure?: XwChunk["structure"];
    withOpenings?: boolean;
    mSide?: "left" | "right";
    /** C's rise over M's surface past the stretch, by plane x, and its grade along x (A: the two part in height in the tip). */
    cRise?: (x: number) => number;
    cRiseGrade?: (x: number) => number;
    /** Where M's same stretch with C ends (x), if not where C's does (F: M lets C go first). */
    mSameEnd?: number;
    /** M's station spacing (m), 10 by default (F: 20, the stretch's end halfway between two). */
    mStep?: number;
  } = {},
) {
  const { structure, drift, mBreaks, mEnd } = shape;
  const groundOf = (st: XwChunk["structure"]) => (st === "tunnel" ? ROAD + 25 : ROAD + 3);
  const mStructure = options.mStructure ?? structure;
  const cStructure = options.cStructure ?? structure;
  const withOpenings = options.withOpenings ?? true;
  const apartX = NOSE + (HW_M + HW_C) / drift;
  const k = Math.hypot(1, drift);
  const stretchM: XwOpening = { side: options.mSide ?? "left", s0: NOSE, s1: round2(apartX), with: "C" };
  const sameM = {
    with: "C",
    relation: "same" as const,
    s0: NOSE,
    s1: round2(options.mSameEnd ?? apartX + 0.5 / drift),
  };
  const borders = [0, ...mBreaks, mEnd];
  const m: XwChunk[] = [];
  for (let j = 0; j + 1 < borders.length; j++) {
    const [a, b] = [borders[j], borders[j + 1]];
    const stations: Array<[number, number, number, number]> = [];
    for (let s = a; s < b - 1e-9; s += options.mStep ?? 10) stations.push([s, s, 0, ROAD]);
    stations.push([b, b, 0, ROAD]);
    const clip = (o: { s0: number; s1: number }) => o.s1 > a && o.s0 < b;
    const piece = (o: XwOpening) => ({ ...o, s0: round2(Math.max(a, o.s0)), s1: round2(Math.min(b, o.s1)) });
    const isUnder = mStructure === "tunnel" || mStructure === "cut";
    m.push(
      chunk(`M:${j}`, "M", mStructure, stations, groundOf(mStructure), {
        prev: j > 0 ? `M:${j - 1}` : null,
        next: j + 2 < borders.length ? `M:${j + 1}` : null,
        decks: clip(sameM) ? [{ ...sameM, s0: Math.max(a, sameM.s0), s1: Math.min(b, sameM.s1) }] : [],
        ...(withOpenings && isUnder && clip(stretchM) ? { openings: [piece(stretchM)] } : {}),
      }),
    );
  }
  const lenC = 160 * k;
  const cStations: Array<[number, number, number, number, number]> = [];
  for (let sC = 0; sC <= lenC + 1e-9; sC += 10) {
    const x = NOSE + sC / k;
    // The grade along C (its stations carry it, so the Hermite surface follows the rise).
    const g = (options.cRiseGrade?.(x) ?? 0) / k;
    cStations.push([sC, x, (x - NOSE) * drift, ROAD + RAMP_DZ + (options.cRise?.(x) ?? 0), g]);
  }
  const heading = Math.atan2(drift, 1);
  const isCUnder = cStructure === "tunnel" || cStructure === "cut";
  const stretchC: XwOpening = { side: "right", s0: 0, s1: round2((apartX - NOSE) * k), with: "M" };
  const c = chunk("C:0", "C", cStructure, cStations, groundOf(cStructure), {
    h0: heading,
    h1: heading,
    decks: [{ with: "M", relation: "same", s0: 0, s1: round2((apartX + 0.5 / drift - NOSE) * k) }],
    ...(withOpenings && isCUnder ? { openings: [stretchC] } : {}),
  });
  const runs = [
    summary(
      "M",
      "expressway",
      m.map((x) => x.id),
      { kind: "open" },
    ),
    summary("C", "ramp", ["C:0"], { kind: "junction", parent: "M", parentS: NOSE }),
  ];
  return { m, c, runs, apartX, k };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function indexOf(chunks: XwChunk[], runs: XwRunSummary[]): DeckIndex {
  const index = new DeckIndex(new Map(runs.map((r) => [r.id, r])));
  for (const c of chunks) index.add(c);
  return index;
}

function built(c: XwChunk, index: DeckIndex | null) {
  const steps = deckArraySteps(c, place, false, index ? { index } : null);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((w) => w.free()));
function worldOf(chunks: XwChunk[], index: DeckIndex | null) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  const out = new Map<string, ReturnType<typeof built>>();
  for (const c of chunks) {
    const b = built(c, index);
    out.set(c.id, b);
    createDeckBody(world, b.collider, b.piers, null);
  }
  world.step();
  return { world, built: out };
}

/** The distance a ray from p along dir travels before it meets a face, or null within `max`. */
function ray(world: RAPIER.World, p: Vector3, dir: Vector3, max = 40): number | null {
  const hit = world.castRay(new RAPIER.Ray(p, dir), max, true);
  return hit ? hit.timeOfImpact : null;
}
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);
/** M's road at plane x, u metres left of its centre, v over its road (local). */
const onM = (x: number, u: number, v = 0) => local(x, u, ROAD + v);

/** The other run's carriageway edge (C's right) north of M's centre at x. */
const cRightEdge = (x: number, drift: number) => (x - NOSE) * drift - HW_C * Math.hypot(1, drift);

/** Where C's carriageway leaves M's wall band (the tip's end, G). */
const tipEndOf = (shape: Shape) =>
  NOSE + (HW_M + boreWallBand(shape.structure) + HW_C * Math.hypot(1, shape.drift)) / shape.drift;

const CUT: Shape = { structure: "cut", drift: 0.12, mBreaks: [200], mEnd: 300 };
const TUNNEL: Shape = { structure: "tunnel", drift: 0.12, mBreaks: [200], mEnd: 300 };

/** The pair of a shape built with one index into one world (per test: the worlds are freed after each). */
function pairWorld(shape: Shape) {
  const { m, c, runs, apartX } = pair(shape);
  const index = indexOf([...m, c], runs);
  return { m, c, apartX, index, ...worldOf([...m, c], index) };
}

describe("S7-4a 掘割の分合流の開口（B）", () => {
  const { apartX } = pair(CUT);

  it("stands no wall on the opening's side over the stretch, and M's own wall outside it", () => {
    const { world } = pairWorld(CUT);
    // A level ray from M's left lane 0.5 m over the road towards the left: inside the stretch it
    // goes past where M's wall stands (u 4.75–5.25) to C's far wall; before the nose it meets M's.
    for (let x = NOSE + 5; x < apartX - 1; x += 3.7) {
      const from = onM(x, HW_M - 1, 0.5);
      const far = cRightEdge(x, 0.12) + 2 * HW_C;
      const d = ray(world, from, LEFT, 60);
      expect(d === null || d > far - (HW_M - 1) - 0.6, `x ${x.toFixed(1)} d ${d}`).toBe(true);
    }
    for (const x of [10, 30, 50]) {
      const d = ray(world, onM(x, HW_M - 1, 0.5), LEFT, 10);
      expect(d, `x ${x}`).toBeCloseTo(1, 1);
    }
  });

  it("keeps M's wall near the nose, where C still lies wholly inside M's slab (no floor ending over nothing)", () => {
    const { world } = pairWorld(CUT);
    let checked = 0;
    for (let x = NOSE + 1.3; x < NOSE + 20; x += 0.7) {
      // C's far (left) slab edge, north of M's centre.
      const cFar = (x - NOSE) * 0.12 + (HW_C + PARAPET_WIDTH.value) * Math.hypot(1, 0.12);
      const isInsideM = cFar < EDGE_M - 0.1;
      if (!isInsideM) continue;
      expect(ray(world, onM(x, HW_M - 1, 0.5), LEFT, 10), `x ${x.toFixed(1)}`).toBeCloseTo(1, 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("leaves no hole and no step over 0.15 m in a 0.5 m grid from M's centre over C's carriageway", () => {
    const { world } = pairWorld(CUT);
    let checked = 0;
    const tipEnd = tipEndOf(CUT);
    for (let x = NOSE + 0.33; x < apartX + 10; x += 0.91) {
      const far = Math.max(HW_M, cRightEdge(x, 0.12) + 2 * HW_C) - 0.1;
      for (let u = 0; u <= far; u += 0.5) {
        // Past the tip the two walls stand between the carriageways (G).
        const isBetween = x > tipEnd && u > HW_M - 0.05 && u < cRightEdge(x, 0.12) + 0.05;
        if (isBetween) continue;
        const p = onM(x, u, 1);
        const d = ray(world, p, DOWN, 3);
        expect(d, `x ${x.toFixed(1)} u ${u}`).not.toBeNull();
        expect(Math.abs(1 - d!), `x ${x.toFixed(1)} u ${u}`).toBeLessThanOrEqual(0.15);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(900);
  });

  it("meets M's face at the seam within the threshold: rays 5 mm either side of M's edge", () => {
    const { world } = pairWorld(CUT);
    let checked = 0;
    for (let x = NOSE + 20; x < apartX; x += 1.3) {
      const a = ray(world, onM(x, EDGE_M - 0.005, 0.5), DOWN, 2);
      const b = ray(world, onM(x, EDGE_M + 0.005, 0.5), DOWN, 2);
      expect(a, `x ${x}`).not.toBeNull();
      expect(b, `x ${x}`).not.toBeNull();
      expect(Math.abs(a! - b!), `x ${x}`).toBeLessThanOrEqual(0.15);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("S7-4a トンネルの分合流の開口（C・D）", () => {
  const { apartX } = pair(TUNNEL);

  it("takes away the side wall, walkway and curb on the opening's side and covers it with the ceiling", () => {
    const { world } = pairWorld(TUNNEL);
    for (let x = NOSE + 5; x < apartX - 1; x += 3.7) {
      const d = ray(world, onM(x, HW_M - 1, 0.5), LEFT, 60);
      const far = cRightEdge(x, 0.12) + 2 * HW_C;
      expect(d === null || d > far - (HW_M - 1) - 0.6, `x ${x.toFixed(1)} d ${d}`).toBe(true);
      // No walkway: a ray down just past M's carriageway edge meets the road, not the walkway 0.3 m up
      // (from x 80 on: before it C's own far walkway stands there, its slab edge past M's).
      const isClear = x >= 80;
      const walk = isClear ? ray(world, onM(x, HW_M + 0.3, 1), DOWN, 3) : 1;
      expect(Math.abs(1 - walk!), `x ${x.toFixed(1)}`).toBeLessThanOrEqual(0.05);
    }
    // Outside the stretch, M's own walkway and wall.
    const walk = ray(world, onM(30, HW_M + 0.3, 1), DOWN, 3);
    expect(1 - walk!).toBeGreaterThan(0.1);
    expect(ray(world, onM(30, HW_M - 1, 0.5), LEFT, 10)).toBeCloseTo(1 + TUNNEL_WALKWAY.value.width, 1);
  });

  it("covers both carriageways with a ceiling and a roof with no hole (rays up from the road and down onto the roof)", () => {
    const { world } = pairWorld(TUNNEL);
    let checked = 0;
    const tipEnd = tipEndOf(TUNNEL);
    for (let x = NOSE + 0.33; x < apartX + 10; x += 0.91) {
      const far = Math.max(HW_M, cRightEdge(x, 0.12) + 2 * HW_C) - 0.1;
      for (let u = 0; u <= far; u += 0.5) {
        // Past the tip the two boxes' walls stand between the carriageways (G).
        const isBetween = x > tipEnd && u > HW_M - 0.05 && u < cRightEdge(x, 0.12) + 0.05;
        if (isBetween) continue;
        const up = ray(world, onM(x, u, 1), UP, 10);
        expect(up, `x ${x.toFixed(1)} u ${u}`).not.toBeNull();
        expect(Math.abs(1 + up! - H), `x ${x.toFixed(1)} u ${u}`).toBeLessThanOrEqual(0.15);
        const down = ray(world, onM(x, u, H + ROOF + 2), DOWN, 5);
        expect(down, `x ${x.toFixed(1)} u ${u}`).not.toBeNull();
        expect(Math.abs(down! - 2), `x ${x.toFixed(1)} u ${u}`).toBeLessThanOrEqual(0.15);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(900);
  });

  it("D: a car from M's left lane to C's lane and back meets no face 0.5 m over the road, has the road under it within 0.15 m, and is inside a tunnel all the way", () => {
    const { world, m, c } = pairWorld(TUNNEL);
    // Its path: M's left lane centre (u 1.625) at x 70, then C's centre from x 130 on, straight
    // between, sampled every 0.25 m; both ways along it.
    const at = (x: number) => {
      const t = Math.min(1, Math.max(0, (x - 70) / 60));
      const u = 1.625 + ((x - NOSE) * 0.12 - 1.625) * t;
      return { x, u };
    };
    const path: Array<{ x: number; u: number }> = [];
    for (let x = 65; x <= 150; x += 0.25) path.push(at(x));
    for (const way of [path, path.toReversed()])
      for (let k = 0; k + 1 < way.length; k++) {
        const p = onM(way[k].x, way[k].u, 0.5);
        const q = onM(way[k + 1].x, way[k + 1].u, 0.5);
        const dir = q.clone().sub(p);
        const len = dir.length();
        expect(ray(world, p, dir.normalize(), len), `x ${way[k].x}`).toBeNull();
        const floor = ray(world, p, DOWN, 2);
        expect(Math.abs(floor! - 0.5), `x ${way[k].x}`).toBeLessThanOrEqual(0.15);
      }
    for (const { x, u } of path) {
      const [lon, lat] = plane.toLonLat(x, u);
      const inside = [...m, c].some((ch) => tunnelPoint(ch, lat, lon, ROAD + 1.5 + N, ellipsoidal) !== null);
      expect(inside, `x ${x} u ${u.toFixed(2)}`).toBe(true);
    }
  });

  it("hangs no lamp over the opened side, and lamps over the other side as before", () => {
    const { m, index } = pairWorld(TUNNEL);
    const b = built(m[0], index);
    const plain = built(pair(TUNNEL, { withOpenings: false }).m[0], null);
    expect(b.lamps.length).toBeLessThan(plain.lamps.length);
    expect(b.lamps.length).toBeGreaterThan(0);
  });
});

describe("S7-4a 相手のいない開口・側の突き合わせ（E、判定 0）", () => {
  it("E: keeps the walls of an opening whose other run has no chunk loaded: vertices and colliders as with no opening, and counts it", () => {
    const { m, runs } = pair(CUT);
    const plain = pair(CUT, { withOpenings: false });
    const index = indexOf(m, runs);
    const alone = built(m[0], index);
    const none = built(plain.m[0], indexOf(plain.m, plain.runs));
    expect(alone.arrays.position.length).toBe(none.arrays.position.length);
    expect(alone.collider.position.length).toBe(none.collider.position.length);
    expect(Array.from(alone.arrays.position)).toEqual(Array.from(none.arrays.position));
    expect(alone.openings?.noPartner).toEqual(["C"]);
    expect(alone.openings?.opened).toEqual([]);
  });

  it("keeps the wall where the data's side is the other one (C lies 1 m or more to the left, the data says right), and counts the rings", () => {
    const { m, c, runs } = pair(CUT, { mSide: "right" });
    const index = indexOf([...m, c], runs);
    const { world, built: all } = worldOf([m[0]], index);
    const b = all.get("M:0")!;
    // Both of M's walls stand all along: a level ray from 1 m inside each meets it 1 m on.
    for (let x = 5.3; x < 200; x += 7.3)
      for (const dir of [LEFT, LEFT.clone().negate()]) {
        const from = onM(x, dir === LEFT ? HW_M - 1 : -(HW_M - 1), 0.5);
        expect(ray(world, from, dir, 10), `x ${x.toFixed(1)}`).toBeCloseTo(1, 1);
      }
    expect(b.openings?.opened.filter((x) => x.with === "C")).toEqual([]);
    const mismatch = b.openings!.sideMismatch;
    expect(mismatch.map((x) => [x.with, x.side])).toEqual([["C", "right"]]);
    // Near the nose (C's centre within 1 m of M's) the side cannot be told: from x 60 + 1 / 0.12 on.
    expect(mismatch[0].s0).toBeGreaterThanOrEqual(NOSE + 1 / 0.12 - 1);
  });
});

describe("S7-4a チャンクの境と開口の端（F・G）", () => {
  it("F: goes on across M's chunk border inside the stretch, and a chunk with a 5 cm piece of it has one wall end only", () => {
    const apart = NOSE + (HW_M + HW_C) / 0.12;
    const border = round2(apart - 0.05);
    const shape: Shape = { structure: "cut", drift: 0.12, mBreaks: [100, border], mEnd: 300 };
    const { m, c, runs } = pair(shape);
    expect(m[2].openings?.[0].s1 ?? 0).toBeCloseTo((m[2].openings?.[0].s0 ?? 0) + 0.05, 2);
    const index = indexOf([...m, c], runs);
    const { built: b } = worldOf([...m, c], index);
    const flips = (id: string) => {
      const x = b.get(id)!;
      let n = 0;
      for (let i = 1; i < x.sides.length; i++)
        if (Boolean(x.sides[i].left.opening) !== Boolean(x.sides[i - 1].left.opening)) n++;
      return {
        n,
        first: Boolean(x.sides[0].left.opening),
        last: Boolean(x.sides[x.sides.length - 1].left.opening),
      };
    };
    // M:0 opens at the nose and stays open to its end; M:1 is open all along; M:2 (the 5 cm piece)
    // is open from its start and its wall starts once, past the tip.
    expect(flips("M:0")).toEqual({ n: 1, first: false, last: true });
    expect(flips("M:1")).toEqual({ n: 0, first: true, last: true });
    expect(flips("M:2")).toEqual({ n: 1, first: true, last: false });
  });

  it("G: opens on past the stretch while C's carriageway is inside M's wall band, the floor whole there, then the wall stands with an end face", () => {
    for (const shape of [CUT, TUNNEL]) {
      const { m, c, runs, apartX } = pair(shape);
      const index = indexOf([...m, c], runs);
      const { world, built: b } = worldOf([...m, c], index);
      // C's right edge reaches the band's outer face at x where cRightEdge = hw + band.
      const tipEnd = tipEndOf(shape);
      const opened = b.get("M:0")!.openings!.opened.find((x) => x.with === "C")!;
      expect(opened.s1, shape.structure).toBeGreaterThan(apartX + 1);
      expect(opened.s1, shape.structure).toBeLessThanOrEqual(tipEnd + 0.5);
      expect(opened.tipM, shape.structure).toBeGreaterThan(1);
      // Between the stretch's end and the tip's: no wall, and the floor whole between M's and C's roads.
      for (let x = apartX + 0.3; x < tipEnd - 0.3; x += 0.4) {
        const d = ray(world, onM(x, HW_M - 0.5, 0.5), LEFT, 6);
        const toC = cRightEdge(x, 0.12) - (HW_M - 0.5);
        expect(d === null || d >= toC - 0.05, `${shape.structure} x ${x.toFixed(1)} d ${d}`).toBe(true);
        for (let u = HW_M; u <= cRightEdge(x, 0.12) + 0.1; u += 0.1) {
          const down = ray(world, onM(x, u, 1), DOWN, 3);
          expect(down, `${shape.structure} x ${x.toFixed(1)} u ${u.toFixed(2)}`).not.toBeNull();
          expect(
            Math.abs(1 - down!),
            `${shape.structure} x ${x.toFixed(1)} u ${u.toFixed(2)}`,
          ).toBeLessThanOrEqual(0.15);
        }
      }
      // Past the tip M's wall stands in its band (a cut's at hw; a tunnel's curb is lower than the ray,
      // and C's box, its own walls in the same band, may stand inside M's walkway), and its end faces
      // back towards the opening.
      const after = ray(world, onM(tipEnd + 3, HW_M - 0.5, 0.5), LEFT, 6);
      expect(after, shape.structure).not.toBeNull();
      expect(after!, shape.structure).toBeGreaterThanOrEqual(0.5 - 0.02);
      expect(after!, shape.structure).toBeLessThanOrEqual(0.5 + boreWallBand(shape.structure) + 0.02);
      const back = ray(world, onM(tipEnd + 2, HW_M + 0.2, 0.5), ALONG.clone().negate(), 5);
      expect(back, shape.structure).not.toBeNull();
    }
  });
});

describe("S7-4a 先端はデータの区間から途切れずに続く間だけ（レビュー 1 の必須 1）", () => {
  it("keeps M's wall where C, having left M's wall band, comes back into it 200 m on at another height", () => {
    // C leaves as in CUT (0.12 a metre) to 12 m north of M's centre by x 160, climbs 6 m over x 130–200,
    // then from x 300 to 340 comes back to 6.4 m north (its right carriageway edge 4.0 m, inside M's
    // band of 4.75 m) and runs on level beside M to x 420: as a ramp that turns back over the main line.
    const shape: Shape = { structure: "cut", drift: 0.12, mBreaks: [200, 400], mEnd: 500 };
    const { m, runs, apartX } = pair(shape);
    const yOf = (x: number) => {
      if (x <= 160) return (x - NOSE) * 0.12;
      if (x <= 300) return 12;
      if (x <= 340) return 12 - ((x - 300) / 40) * 5.6;
      return 6.4;
    };
    const zOf = (x: number) => ROAD + RAMP_DZ + Math.min(6, Math.max(0, (x - 130) / 70) * 6);
    const stations: Array<[number, number, number, number]> = [];
    let sC = 0;
    let last: [number, number] | null = null;
    for (let x = NOSE; x <= 420 + 1e-9; x += 2) {
      const y = yOf(x);
      if (last) sC += Math.hypot(x - last[0], y - last[1]);
      last = [x, y];
      stations.push([sC, x, y, zOf(x)]);
    }
    const k = Math.hypot(1, 0.12);
    const c = chunk("C:0", "C", "cut", stations, ROAD + 3, {
      h0: Math.atan2(0.12, 1),
      h1: 0,
      decks: [{ with: "M", relation: "same", s0: 0, s1: round2((apartX + 0.5 / 0.12 - NOSE) * k) }],
      openings: [{ side: "right", s0: 0, s1: round2((apartX - NOSE) * k), with: "M" }],
    });
    const index = indexOf([...m, c], runs);
    const { world, built: b } = worldOf([...m, c], index);
    // M's left wall stands where C is back inside the band: a level ray from 1 m inside meets it 1 m on.
    for (let x = 345.3; x < 398; x += 3.7) {
      const d = ray(world, onM(x, HW_M - 1, 0.5), LEFT, 6);
      expect(d, `x ${x.toFixed(1)}`).toBeCloseTo(1, 1);
    }
    // And M's opening (its tip included) ends near the stretch, nowhere near x 300–420.
    const opened = [...b.values()]
      .flatMap((x) => x.openings?.opened ?? [])
      .filter((x) => x.with === "C" && x.side === "left");
    expect(opened.length).toBeGreaterThan(0);
    expect(Math.max(...opened.map((x) => x.s1))).toBeLessThan(apartX + 10);
  });
});

describe("S7-4a 相手が bore でない分合流（H）", () => {
  it("H: an embankment main line and a cut ramp: the ramp's side alone opens, and the seam has no hole", () => {
    const { m, c, runs, apartX } = pair(CUT, { mStructure: "embankment" });
    expect(m.every((x) => !("openings" in x))).toBe(true);
    const index = indexOf([...m, c], runs);
    const { world, built: b } = worldOf([...m, c], index);
    expect(b.get("C:0")!.openings!.opened.map((x) => [x.with, x.side])).toEqual([["M", "right"]]);
    for (let x = NOSE + 20; x < apartX; x += 1.3) {
      for (const u of [EDGE_M - 0.005, EDGE_M + 0.005]) {
        const d = ray(world, onM(x, u, 0.5), DOWN, 2);
        expect(d, `x ${x} u ${u}`).not.toBeNull();
        expect(Math.abs(d! - 0.5), `x ${x} u ${u}`).toBeLessThanOrEqual(0.15);
      }
    }
  });
});

describe("S7-4a 坑門（I）", () => {
  it("I: builds no headwall where the run goes on under the ground (tunnel → tunnel, cut → cut), and one at a mouth (cut → tunnel)", () => {
    const base = pair(TUNNEL, { withOpenings: false }).m[0];
    const count = (portals: XwChunk["portals"]) =>
      built({ ...base, ...(portals ? { portals } : {}) }, null).arrays.position.length;
    const none = count(undefined);
    expect(count([{ s: 0, from: "tunnel", to: "tunnel" }])).toBe(none);
    expect(count([{ s: 0, from: "cut", to: "cut" }])).toBe(none);
    expect(count([{ s: 0, from: "cut", to: "tunnel" }])).toBeGreaterThan(none);
  });
});

describe("S7-4a 長い開口（K）", () => {
  it("K: an opening over 300 m across three of M's chunks: no wall and no hole along all of it", () => {
    // Drifting 0.02 a metre the carriageways overlap for 356 m (x 60–416).
    const shape: Shape = { structure: "tunnel", drift: 0.02, mBreaks: [150, 300], mEnd: 450 };
    const { m, c, runs, apartX } = pair(shape);
    expect(apartX - NOSE).toBeGreaterThan(300);
    const index = indexOf([...m, c], runs);
    const { world } = worldOf([...m, c], index);
    const reach = NOSE + 160;
    let checked = 0;
    for (let x = NOSE + 3; x < Math.min(apartX, reach) - 1; x += 2.3) {
      const d = ray(world, onM(x, HW_M - 1, 0.5), LEFT, 60);
      const far = cRightEdge(x, 0.02) + 2 * HW_C;
      expect(d === null || d > far - (HW_M - 1) - 0.6, `x ${x.toFixed(1)} d ${d}`).toBe(true);
      for (let u = 0; u <= far - 0.1; u += 0.5) {
        const down = ray(world, onM(x, u, 1), DOWN, 3);
        expect(Math.abs(1 - down!), `x ${x.toFixed(1)} u ${u}`).toBeLessThanOrEqual(0.15);
        const up = ray(world, onM(x, u, 1), UP, 10);
        expect(Math.abs(1 + up! - H), `x ${x.toFixed(1)} u ${u}`).toBeLessThanOrEqual(0.15);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("S7-4a 探り（3.6、scripts/expresswaySeams.ts）", () => {
  const frames = [{ lat: 35.65, lon: 139.751 }];
  const probe = (chunks: XwChunk[], runs: XwRunSummary[]) => {
    const out = probeGenerated(chunks, runs as never, frames);
    for (const w of out.worlds) w.free();
    return out;
  };

  it("measures the seams of an opening's stretch with today's thresholds (no seam_hole, no seam_step), its tip's floors within MERGE_MAX_DZ, and meets no wall along it", () => {
    for (const shape of [CUT, TUNNEL]) {
      const { m, c, runs } = pair(shape);
      const out = probe([...m, c], runs);
      const stretchEnd = c.openings![0].s1;
      const all = out.seams.filter((x) => x.chunk === "C:0" && x.with === "M");
      // Past the stretch (the tip) C's floor runs on over M's slab edge to M's carriageway (rule C of
      // review 1, addendum 3): the probe 2 mm inside M's edge meets C's floor, RAMP_DZ over M's face.
      // Accepted within MERGE_MAX_DZ (one surface); the seam rule holds on the stretch.
      const tip = all.filter((x) => x.s > stretchEnd);
      expect(
        tip.every((x) => x.inside !== null && Math.abs(x.inside) <= MERGE_MAX_DZ),
        shape.structure,
      ).toBe(true);
      const seams = all.filter((x) => x.s <= stretchEnd);
      expect(seams.length, shape.structure).toBeGreaterThan(50);
      const found = seamCases(seams, out.cuts, [], { fullDz: MERGE_FULL_DZ, maxDz: MERGE_MAX_DZ });
      expect(
        found.filter((x) => x.kind === "seam_hole" || x.kind === "seam_step"),
        shape.structure,
      ).toEqual([]);
      expect(out.bore.opened.map((x) => [x.chunk, x.with, x.side]).toSorted(), shape.structure).toEqual(
        [
          ["C:0", "M", "right"],
          ["M:0", "C", "left"],
        ].toSorted(),
      );
      expect(out.bore.wallRays, shape.structure).toBeGreaterThan(50);
      expect(out.bore.wallHits, shape.structure).toBe(0);
      expect(out.bore.noPartner.length + out.bore.sideMismatch.length, shape.structure).toBe(0);
    }
  });

  it("counts an opening with no chunk of its other run and one on the data's wrong side", () => {
    const lone = pair(CUT);
    expect(probe(lone.m, lone.runs).bore.noPartner).toEqual([{ chunk: "M:0", with: "C" }]);
    const wrong = pair(CUT, { mSide: "right" });
    const out = probe([...wrong.m, wrong.c], wrong.runs);
    // C's own opening (right, M on its right) is right; M's says right with C on its left.
    expect(out.bore.sideMismatch.map((x) => [x.chunk, x.with, x.side])).toEqual([["M:0", "C", "right"]]);
  });
});

/** M's or C's rings with their sides, where a side towards the other is opened (state per ring). */
function openedRings(b: ReturnType<typeof built>, key: "left" | "right") {
  return b.rings.map((r, i) => ({ s: r.frame.s, side: b.sides[i][key] }));
}

describe("S7-4a 先端の高さの差と分離壁（レビュー 1 の追記 2・3）", () => {
  // C leaves M's surface at 3 % from x 116 (just past the stretch's end at x 115.2): in the tunnel's
  // tip (to x 126.6) the two part in height while C is still inside M's wall band.
  const RISE = (x: number) => Math.max(0, x - 116) * 0.03;
  const RISE_G = (x: number) => (x > 116 ? 0.03 : 0);
  // E (a cut's tip ends at x 119.5): steeper, past MERGE_MAX_DZ at x 117.2.
  const RISE_E = (x: number) => Math.max(0, x - 116) * 0.1;
  const RISE_E_G = (x: number) => (x > 116 ? 0.1 : 0);
  const apartOf = () => NOSE + (HW_M + HW_C) / 0.12;

  it("A: opens the tip while the roads are within MERGE_MAX_DZ, then stands a 分離壁 halfway with no hole between the two boxes", () => {
    const { m, c, runs } = pair(TUNNEL, { cRise: RISE, cRiseGrade: RISE_G });
    const index = indexOf([...m, c], runs);
    const { world, built: b } = worldOf([...m, c], index);
    const rings = openedRings(b.get("M:0")!, "left").filter((x) => x.side.opening?.isTip);
    const open = rings.filter((x) => !x.side.opening?.isDivider);
    const divided = rings.filter((x) => x.side.opening?.isDivider);
    expect(open.length).toBeGreaterThan(0);
    expect(divided.length).toBeGreaterThan(0);
    // Open while C is within MERGE_MAX_DZ of M (RAMP_DZ + 0.03 (x − 116) ≤ 0.15: x ≤ 120 on C), walled
    // past it. M reads C at the foot of its own centre on C's line, about 0.8 m back along C here.
    expect(Math.max(...open.map((x) => x.s))).toBeLessThanOrEqual(121.2);
    expect(Math.min(...divided.map((x) => x.s))).toBeGreaterThanOrEqual(119.7);
    for (let x = apartOf() + 0.37; x < tipEndOf(TUNNEL) - 0.3; x += 0.41) {
      const cEdge = cRightEdge(x, 0.12);
      const middle = (HW_M + cEdge) / 2;
      // No hole: down from 2 m over the higher road, between the two carriageways, a floor within 0.15 m of M's or C's.
      for (let u = HW_M + 0.05; u < cEdge - 0.05; u += 0.1) {
        const d = ray(world, onM(x, u, 2 + RISE(x)), DOWN, 5);
        expect(d, `x ${x.toFixed(2)} u ${u.toFixed(2)}`).not.toBeNull();
        const y = 2 + RISE(x) - d!;
        const isOnOne = Math.abs(y) <= 0.15 || Math.abs(y - RISE(x) - RAMP_DZ) <= 0.15;
        expect(isOnOne, `x ${x.toFixed(2)} u ${u.toFixed(2)} y ${y.toFixed(3)}`).toBe(true);
      }
      const isWalled = RISE(x) + RAMP_DZ > 0.15 + 0.3;
      if (!isWalled) continue;
      // The 分離壁 closes both boxes: level rays from each carriageway's edge towards the other meet it
      // by the middle (+ 0.1 m), 0.5 m over the floor and 0.5 m under the ceiling.
      for (const v of [0.5, H - 0.5]) {
        const fromM = ray(world, onM(x, HW_M - 0.05, v), LEFT, 3);
        expect(fromM, `M x ${x.toFixed(2)} v ${v}`).not.toBeNull();
        expect(fromM!, `M x ${x.toFixed(2)} v ${v}`).toBeLessThanOrEqual(middle - HW_M + 0.05 + 0.1);
        const fromC = ray(world, onM(x, cEdge + 0.05, RISE(x) + RAMP_DZ + v), LEFT.clone().negate(), 3);
        expect(fromC, `C x ${x.toFixed(2)} v ${v}`).not.toBeNull();
        expect(fromC!, `C x ${x.toFixed(2)} v ${v}`).toBeLessThanOrEqual(cEdge - middle + 0.05 + 0.1);
      }
    }
  });

  it("B: the 分離壁 stands in neither carriageway: rays along travel 0.1 m inside each carriageway's edge meet nothing", () => {
    const { m, c, runs } = pair(TUNNEL, { cRise: RISE, cRiseGrade: RISE_G });
    const index = indexOf([...m, c], runs);
    const { world, built: b } = worldOf([...m, c], index);
    // Not an empty pass: the net has 分離壁 rings on both runs.
    expect(
      openedRings(b.get("M:0")!, "left").filter((x) => x.side.opening?.isDivider).length,
    ).toBeGreaterThan(0);
    expect(
      openedRings(b.get("C:0")!, "right").filter((x) => x.side.opening?.isDivider).length,
    ).toBeGreaterThan(0);
    const x0 = 121.5;
    const x1 = tipEndOf(TUNNEL) - 0.5;
    const alongM = ray(world, onM(x0, HW_M - 0.1, 0.5), ALONG, x1 - x0);
    expect(alongM).toBeNull();
    // Along C's right edge (it turns 0.12 off M's line): short steps, each square to nothing.
    for (let x = x0; x < x1 - 0.5; x += 0.5) {
      const p = onM(x, cRightEdge(x, 0.12) + 0.1, RISE(x) + RAMP_DZ + 0.5);
      const q = onM(x + 0.5, cRightEdge(x + 0.5, 0.12) + 0.1, RISE(x + 0.5) + RAMP_DZ + 0.5);
      const dir = q.clone().sub(p);
      expect(ray(world, p, dir.clone().normalize(), dir.length()), `x ${x}`).toBeNull();
    }
  });

  it("C: where one side is open and the other walled at one place, the open side looks onto a closed box", () => {
    const { m, c, runs } = pair(TUNNEL, { cRise: RISE, cRiseGrade: RISE_G });
    const index = indexOf([...m, c], runs);
    const { world, built: b } = worldOf([...m, c], index);
    const mDivider = openedRings(b.get("M:0")!, "left").filter((x) => x.side.opening?.isDivider);
    const cDivider = openedRings(b.get("C:0")!, "right").filter((x) => x.side.opening?.isDivider);
    expect(mDivider.length * cDivider.length).toBeGreaterThan(0);
    // Between the first 分離壁 ring of either and of the other (one open, one walled), level rays from
    // M's road towards C at 0.5 m meet a face before C's carriageway (the 分離壁 of one of them).
    const kC = Math.hypot(1, 0.12);
    const xs = [Math.min(...mDivider.map((x) => x.s)), NOSE + Math.min(...cDivider.map((x) => x.s)) / kC];
    for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x += 0.1) {
      const d = ray(world, onM(x, HW_M - 0.05, 0.5), LEFT, 3);
      const toC = cRightEdge(x, 0.12) - HW_M + 0.05;
      const isOpenFloor = d === null || d >= toC - 0.02;
      // Open both (still within MERGE_MAX_DZ) the ray may run on to C; else it meets a wall short of C.
      const dz = RISE(x) + RAMP_DZ;
      if (dz <= 0.15 + 0.03) continue;
      expect(isOpenFloor, `x ${x.toFixed(2)} d ${d}`).toBe(false);
    }
  });

  it("E: an embankment main line and a cut ramp parting in height: the ramp's side alone has the 分離壁, the main line's sides are its own", () => {
    const { m, c, runs } = pair(CUT, { mStructure: "embankment", cRise: RISE_E, cRiseGrade: RISE_E_G });
    const index = indexOf([...m, c], runs);
    const { built: b } = worldOf([...m, c], index);
    const cRings = openedRings(b.get("C:0")!, "right");
    expect(cRings.some((x) => x.side.opening?.isDivider)).toBe(true);
    for (const x of m)
      expect(b.get(x.id)!.sides.every((sd) => !sd.left.opening && !sd.right.opening)).toBe(true);
  });

  it("F (addendum 3): M's stations 20 m apart and the stretch's end halfway between two, M letting C go first: no hole from 3 m before the stretch's end to the tip's end, and no tip floor ends inside its own carriageway", () => {
    // Drifting 0.1325 a metre the carriageways part at x 110: halfway between M's stations 100 and 120.
    for (const structure of ["cut", "tunnel"] as const) {
      const shape: Shape = { structure, drift: 0.1325, mBreaks: [200], mEnd: 300 };
      const apart = NOSE + (HW_M + HW_C) / shape.drift;
      expect(apart).toBeCloseTo(110, 6);
      const { m, c, runs } = pair(shape, { mSameEnd: apart - 25, mStep: 20 });
      const index = indexOf([...m, c], runs);
      const { world, built: b } = worldOf([...m, c], index);
      for (let x = apart - 3; x <= tipEndOf(shape) - 0.2; x += 0.13) {
        for (let u = HW_M - 0.5; u < cRightEdge(x, shape.drift) + 0.5; u += 0.05) {
          const d = ray(world, onM(x, u, 1), DOWN, 3);
          expect(d, `${structure} x ${x.toFixed(2)} u ${u.toFixed(2)}`).not.toBeNull();
          expect(Math.abs(1 - d!), `${structure} x ${x.toFixed(2)} u ${u.toFixed(2)}`).toBeLessThanOrEqual(
            0.15,
          );
        }
      }
      for (const [id, key] of [
        ["M:0", "left"],
        ["C:0", "right"],
      ] as const) {
        const hw = id === "M:0" ? HW_M : HW_C;
        for (const r of openedRings(b.get(id)!, key).filter((x) => x.side.opening?.isTip))
          expect(r.side.reach, `${structure} ${id} s ${r.s}`).toBeGreaterThanOrEqual(hw - 1e-9);
      }
    }
  });
});
