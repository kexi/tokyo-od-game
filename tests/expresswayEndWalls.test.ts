import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PARAPET_HEIGHT, PARAPET_WIDTH } from "../src/expressway/assumptions";
import { ST, STATION_STRIDE, type XwChunk, type XwEnd, type XwTileRun } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { createDeckBody, deckArraySteps, type GeoToLocal, SLAB } from "../src/world/expresswayDeck";
import { endsAhead, endsAsBuilt, rangeOfChunks } from "../src/world/expresswayEnds";
import { DeckIndex } from "../src/world/expresswayMarkings";
import { liftAt, ringPoint } from "../src/world/expresswayMerge";
import { readExpresswayFiles } from "../scripts/expresswayFiles";

// R1-1b 3.2–3.5: the walls closing the ends with nothing written going on, as the game builds them
// (deckArraySteps over a DeckIndex), probed with rays (Rapier) as a car would meet them.

beforeAll(() => RAPIER.init());
const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((w) => w.free()));

const plane = planeAt(139.75, 35.65);
const N = 36.9;
const frame = new LocalFrame(35.65, 139.751, 40);
const place: GeoToLocal = { frame, ellipsoidal: (_lat, _lon, h) => h + N };
const ROAD = 10;
const STEP = 0.25;

type Built = ReturnType<typeof buildOf>;
function buildOf(chunk: XwChunk, index: DeckIndex | null, at: GeoToLocal = place) {
  const steps = deckArraySteps(chunk, at, false, index ? { index } : null);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
function worldOf(builds: Built[]) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  for (const b of builds) createDeckBody(world, b.collider, b.piers, null);
  world.step();
  return world;
}
const cast = (world: RAPIER.World, from: Vector3, dir: Vector3, max: number) =>
  world.castRay(new RAPIER.Ray(from, dir), max, true);
const down = new Vector3(0, -1, 0);

/** A chunk along the plane points `xy` (every 5 m), level at ROAD, of run `run`. */
function chunkAlong(
  id: string,
  xy: (s: number) => [number, number],
  length: number,
  extra: Partial<XwChunk> = {},
) {
  const st: number[] = [];
  for (let s = 0; s <= length + 1e-9; s += 5) {
    const [lon, lat] = plane.toLonLat(...xy(s));
    st.push(s, lon, lat, ROAD, 0, ROAD - 8, 0);
  }
  const [x0, y0] = xy(0);
  const [x1, y1] = xy(1);
  const [xa, ya] = xy(length - 1);
  const [xb, yb] = xy(length);
  const run = id.split(":")[0];
  return {
    id,
    run,
    chain: run,
    k: 0,
    cls: "expressway",
    ref: null,
    name: null,
    structure: "viaduct",
    over: null,
    lanes: 2,
    laneWidth: 3.25,
    shoulderL: 1.25,
    shoulderR: 0.75,
    basis: "assumption",
    V: 60,
    maxspeed: null,
    vh: 50,
    gmax: 0.05,
    g0: 0,
    g1: 0,
    // Headings counter-clockwise from east, as the compiler's (expresswayMerge.ts headingTangent).
    h0: Math.atan2(y1 - y0, x1 - x0),
    h1: Math.atan2(yb - ya, xb - xa),
    girder: 2.2,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
    ...extra,
  } satisfies XwChunk;
}
const end = (kind: XwEnd["kind"], parent?: string, parentS?: number): XwEnd => ({
  kind,
  ...(parent !== undefined ? { parent, parentS } : {}),
});
const summary = (id: string, start: XwEnd, last: XwEnd, cls: XwTileRun["cls"] = "expressway"): XwTileRun => ({
  id,
  cls,
  start,
  end: last,
});
function indexOf(runs: XwTileRun[], chunks: XwChunk[]) {
  const index = new DeckIndex(new Map(runs.map((r) => [r.id, r])));
  for (const c of chunks) index.add(c);
  return index;
}

/**
 * Level rays from 0.25 m inside an end face outward over `lo..hi` every 0.25 m, from 0.1 m over the road
 * to 0.05 m under `top` every 0.25 m (R1-1b 5.4): those that meet nothing within 0.6 m, where no road
 * lies 0.3 m past the face (a car would roll on onto it).
 */
function missesAt(world: RAPIER.World, b: Built, side: "start" | "end", lo: number, hi: number, top: number) {
  const ring = side === "start" ? b.rings[0] : b.rings[b.rings.length - 1];
  const out = side === "start" ? -1 : 1;
  const dir = ring.t.clone().multiplyScalar(out);
  const misses: string[] = [];
  let rays = 0;
  for (let u = lo + STEP / 2; u < hi; u += STEP) {
    const road = ringPoint(ring, u, liftAt(ring, u, false));
    const past = road
      .clone()
      .addScaledVector(ring.t, out * 0.3)
      .setY(road.y + 0.6);
    const below = cast(world, past, down, 1.2);
    const isRoadPast = below !== null && Math.abs(past.y - below.timeOfImpact - road.y) < 0.3;
    for (let y = road.y + 0.1; y <= top - 0.05 + 1e-9; y += STEP) {
      rays++;
      const from = ringPoint(ring, u, y - ring.c.y).addScaledVector(ring.t, -out * 0.25);
      const isHit = cast(world, from, dir, 0.6) !== null;
      if (!isHit && !isRoadPast) misses.push(`u ${u.toFixed(2)} y ${(y - road.y).toFixed(2)}`);
    }
  }
  return { rays, misses };
}
/** The road's surface across an end ring, and the wall's top there (a ray down 0.25 m inside the face). */
function topsAt(world: RAPIER.World, b: Built, side: "start" | "end", u: number) {
  const ring = side === "start" ? b.rings[0] : b.rings[b.rings.length - 1];
  const back = side === "start" ? 1 : -1;
  const road = ringPoint(ring, u, liftAt(ring, u, false));
  const from = road
    .clone()
    .addScaledVector(ring.t, back * 0.25)
    .setY(road.y + 20);
  const hit = cast(world, from, down, 40);
  return { road: road.y, top: hit === null ? null : from.y - hit.timeOfImpact };
}
/** The along-travel offsets of every collider vertex from an end ring (outward positive). */
function maxPast(b: Built, side: "start" | "end") {
  const ring = side === "start" ? b.rings[0] : b.rings[b.rings.length - 1];
  const out = side === "start" ? -1 : 1;
  const p = b.collider.position;
  let most = -Infinity;
  const v = new Vector3();
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i + 1], p[i + 2]).sub(ring.c);
    most = Math.max(most, v.dot(ring.t) * out);
  }
  return most;
}
const innerOf = (b: Built, side: "start" | "end") => {
  const sd = side === "start" ? b.sides[0] : b.sides[b.sides.length - 1];
  return {
    lo: -(sd.right.wall ? sd.right.wall.inner : sd.right.reach),
    hi: sd.left.wall ? sd.left.wall.inner : sd.left.reach,
  };
};

describe("先の無い端の壁（R1-1b 3.2、合成の高架）", () => {
  const a = chunkAlong("A:0", (s) => [100 + s, 0], 100);
  const runs = [summary("A", end("open"), end("open"))];

  it("closes both open ends of a viaduct: every ray at the faces meets the wall, the girder's end is shut", () => {
    const b = buildOf(a, indexOf(runs, [a]));
    expect(b.endWalls.map((w) => w.end)).toEqual(["start", "end"]);
    expect(b.endSkips).toEqual([]);
    const world = worldOf([b]);
    for (const side of ["start", "end"] as const) {
      const { lo, hi } = innerOf(b, side);
      const { road } = topsAt(world, b, side, 0);
      const r = missesAt(world, b, side, lo, hi, road - SLAB + b.endWalls[0].heightM);
      expect(r.rays).toBeGreaterThan(100);
      expect(r.misses, side).toEqual([]);
    }
    // The girder's hollow under the slab at the end: a level ray 1 m under the road from 3 m past the
    // end face back towards it meets the cap at the face.
    const ring = b.rings[b.rings.length - 1];
    const from = ring.c
      .clone()
      .addScaledVector(ring.t, 3)
      .setY(ring.c.y - 1);
    const hit = cast(world, from, ring.t.clone().multiplyScalar(-1), 10);
    expect(hit?.timeOfImpact).toBeCloseTo(3, 1);
  });

  it("stands its top at PARAPET_HEIGHT over the road or more at every place across, and as high as the side walls", () => {
    const b = buildOf(a, indexOf(runs, [a]));
    const world = worldOf([b]);
    const { lo, hi } = innerOf(b, "end");
    for (let u = lo + STEP / 2; u < hi; u += STEP) {
      const { road, top } = topsAt(world, b, "end", u);
      expect(top! - road, `u ${u}`).toBeGreaterThanOrEqual(PARAPET_HEIGHT.value - 1e-3);
    }
    // The 壁高欄 beside it, 2 m back from the face.
    const ring = b.rings[b.rings.length - 1];
    const side = ringPoint(ring, hi + 0.25, 30).addScaledVector(ring.t, -2);
    const parapet = side.y - cast(world, side, down, 60)!.timeOfImpact;
    expect(topsAt(world, b, "end", hi - 0.1).top!).toBeGreaterThanOrEqual(parapet - 1e-3);
  });

  it("builds nothing past the end faces", () => {
    const b = buildOf(a, indexOf(runs, [a]));
    expect(maxPast(b, "start")).toBeLessThanOrEqual(1e-3);
    expect(maxPast(b, "end")).toBeLessThanOrEqual(1e-3);
  });

  it("builds no wall at an end that goes on (ground, a seam child) nor without the tiles' runs (no context)", () => {
    const ground = buildOf(a, indexOf([summary("A", end("ground"), end("ground"))], [a]));
    expect(ground.endWalls).toEqual([]);
    const seamed = indexOf(
      [summary("A", end("ground"), end("open")), summary("S", end("seam", "A", 100), end("ground"))],
      [a],
    );
    expect(buildOf(a, seamed).endWalls).toEqual([]);
    expect(buildOf(a, null).endWalls).toEqual([]);
  });

  it("raises a cut's end wall to the retaining walls' top, in their colour, and skips a tunnel's end", () => {
    const cut = { ...a, structure: "cut" as const, girder: 0 };
    const deep: GeoToLocal = { ...place, groundAt: () => ROAD + 3 + N, terrainAt: () => ROAD + 3 + N };
    const b = buildOf(cut, indexOf(runs, [cut]), deep);
    expect(b.endWalls).toHaveLength(2);
    // Over the slab's bottom: at least the 3 m of cut over the road (the retaining walls reach the ground).
    expect(b.endWalls[0].heightM).toBeGreaterThan(3 + SLAB - 1e-3);
    const tunnel = { ...a, structure: "tunnel" as const, girder: 0 };
    const t = buildOf(tunnel, indexOf(runs, [tunnel]), deep);
    expect(t.endWalls).toEqual([]);
    expect(t.endSkips).toEqual([
      { end: "start", reason: "tunnel" },
      { end: "end", reason: "tunnel" },
    ]);
  });
});

describe("端の節点で道が別の run として続く所（R1-1b 3.3）", () => {
  // A main line A east to x 200 (its end open), a one-lane ramp C leaving A's end node 30° to the right.
  const a = chunkAlong("A:0", (s) => [100 + s, 0], 100);
  const angle = (-30 * Math.PI) / 180;
  const c = chunkAlong("C:0", (s) => [200 + s * Math.cos(angle), s * Math.sin(angle)], 60, {
    cls: "ramp",
    lanes: 1,
    shoulderL: 1,
    shoulderR: 0.5,
  });
  const runs = [
    summary("A", end("ground"), end("open")),
    summary("C", end("junction", "A", 100), end("ground"), "ramp"),
  ];

  it("raises no wall, and closes the face beside the ramp: no stretch over PARAPET_WIDTH with neither box nor road", () => {
    const index = indexOf(runs, [a, c]);
    const b = buildOf(a, index);
    expect(b.endWalls).toEqual([]);
    const world = worldOf([b, buildOf(c, index)]);
    const ring = b.rings[b.rings.length - 1];
    const hw = (2 * 3.25 + 1.25 + 0.75) / 2;
    let open = 0;
    let worst = 0;
    let boxes = 0;
    for (let u = -hw + STEP / 2; u < hw; u += STEP) {
      const road = ringPoint(ring, u, 0);
      const isBox =
        cast(
          world,
          road
            .clone()
            .setY(road.y + 0.5)
            .addScaledVector(ring.t, -0.25),
          ring.t,
          0.6,
        ) !== null;
      const past = road
        .clone()
        .addScaledVector(ring.t, 0.3)
        .setY(road.y + 0.6);
      const hit = cast(world, past, down, 1.2);
      const isRoad = hit !== null && Math.abs(past.y - hit.timeOfImpact - road.y) < 0.3;
      if (isBox) boxes++;
      open = isBox || isRoad ? 0 : open + STEP;
      worst = Math.max(worst, open);
    }
    expect(worst).toBeLessThanOrEqual(PARAPET_WIDTH.value);
    expect(boxes).toBeGreaterThan(4);
  });

  it("a child ending at its parent's end gets a wall only where its road lies outside the parent's, none when it lies on it", () => {
    // B a one-lane ramp coming into A's end node from the left at 10°; D the same, straight on A's line.
    const tilt = (10 * Math.PI) / 180;
    const ramp = { cls: "ramp" as const, lanes: 1, shoulderL: 1, shoulderR: 0.5 };
    const b = chunkAlong(
      "B:0",
      (s) => [200 - (60 - s) * Math.cos(tilt), (60 - s) * Math.sin(tilt)],
      60,
      ramp,
    );
    const d = chunkAlong("D:0", (s) => [140 + s, 0], 60, ramp);
    const net = [
      summary("A", end("ground"), end("open")),
      summary("B", end("ground"), end("junction", "A", 100), "ramp"),
      summary("D", end("ground"), end("junction", "A", 100), "ramp"),
    ];
    const index = indexOf(net, [a, b, d]);
    const parent = buildOf(a, index);
    const child = buildOf(b, index);
    const onLine = buildOf(d, index);
    expect(parent.endWalls).toHaveLength(1);
    expect(child.endWalls).toHaveLength(1);
    const full = 3.25 + 1 + 0.5;
    expect(child.endWalls[0].widthM).toBeGreaterThan(0);
    expect(child.endWalls[0].widthM).toBeLessThan(full);
    expect(onLine.endWalls).toEqual([]);
    expect(onLine.endSkips).toEqual([{ end: "end", reason: "hidden" }]);
    // Every ray at the child's and the parent's faces meets a wall (or rolls on onto the other's road).
    const world = worldOf([parent, child, onLine]);
    for (const x of [parent, child, onLine]) {
      const { lo, hi } = innerOf(x, "end");
      const { road } = topsAt(world, x, "end", 0);
      expect(
        missesAt(world, x, "end", lo, hi, road + PARAPET_HEIGHT.value).misses,
        x.rings.length.toString(),
      ).toEqual([]);
    }
  });
});

describe("口（R1-1b 3.5、書かれた run に書かれない run がぶら下がる所）", () => {
  it("keeps the parent's 壁高欄 on the child's side and its edge line when the child is not loaded", () => {
    // P east; Q a ramp hung on P's left at s 50 (its start), Q's chunks not read.
    const p = chunkAlong("P:0", (s) => [100 + s, 0], 100, {
      decks: [{ with: "Q", relation: "same", s0: 40, s1: 60 }],
    });
    const index = indexOf(
      [
        summary("P", end("ground"), end("ground")),
        summary("Q", end("junction", "P", 50), end("ground"), "ramp"),
      ],
      [p],
    );
    const b = buildOf(p, index);
    b.rings.forEach((r, i) => {
      const isNear = Math.abs(r.frame.s - 50) <= 30;
      if (isNear) expect(b.sides[i].left.wall, `s ${r.frame.s}`).not.toBeNull();
    });
    expect(b.marks.zebras).toEqual([]);
    expect(b.marks.lines.filter((l) => l.kind === "branch")).toEqual([]);
  });
});

/** A chunk's middle station (lon, lat). */
function midOf(c: XwChunk) {
  const m = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
  return [c.st[m + ST.lon], c.st[m + ST.lat]];
}

// The default folder's: another (XW_DATA_DIR) has other ends.
describe.skipIf(Boolean(process.env.XW_DATA_DIR))("既定のデータの先の無い端の壁（R1-1b 5.3〜5.5）", () => {
  const files = readExpresswayFiles();
  const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
  const index = new DeckIndex(runs);
  for (const c of files.chunks) index.add(c);
  const dead = [
    "24039751:end",
    "24402609:start",
    "4848762:end",
    "45068169:start",
    "45068170:end",
    "45554541:start",
    "5213324:end",
  ];
  /** Every chunk within 400 m of a point built in a frame there, and its world. */
  function near(lon: number, lat: number) {
    const f = new LocalFrame(lat, lon, 40);
    const at: GeoToLocal = { frame: f, ellipsoidal: (_a, _b, h) => h + N };
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
    const builds = new Map<string, Built>();
    for (const c of files.chunks) {
      const [x, y] = midOf(c);
      const isNear = Math.hypot((x - lon) * kx, (y - lat) * 110_574) < 400;
      if (isNear) builds.set(c.id, buildOf(c, index, at));
    }
    return { builds, world: worldOf([...builds.values()]) };
  }
  const endChunk = (key: string) => {
    const [run, side] = key.split(":") as [string, "start" | "end"];
    const list = index.chunksOf(run);
    return {
      side,
      chunk: side === "start" ? list.find((c) => c.prev === null)! : list.find((c) => c.next === null)!,
    };
  };

  it("builds a wall at the 7 ends and nowhere else, none at the ground main end 45019020:start, none skipped", () => {
    const got: string[] = [];
    let skipped = 0;
    for (const c of files.chunks) {
      const b = buildOf(c, index, place);
      for (const w of b.endWalls) got.push(`${c.run}:${w.end}`);
      skipped += b.endSkips.length;
    }
    expect(got.toSorted()).toEqual(dead.toSorted());
    expect(got).not.toContain("45019020:start");
    expect(skipped).toBe(0);
  });

  it("answers each end the same from the 3 × 3 tiles read before its end chunk is built as from every tile", () => {
    const full = endsAhead(runs, (run) => rangeOfChunks(index.chunksOf(run), STATION_STRIDE));
    const asBuilt = endsAsBuilt(files.tiles, files.meta.zoom);
    expect(asBuilt.size).toBeGreaterThan(20);
    for (const [key, a] of asBuilt) expect(a.ahead, key).toBe(full.get(key)!.ahead);
  });

  it.each(dead)(
    "%s: every ray at the face meets the wall, its top over the road, nothing past the face",
    (key) => {
      const { side, chunk } = endChunk(key);
      const o = side === "start" ? 0 : chunk.st.length - STATION_STRIDE;
      const { builds, world } = near(chunk.st[o + ST.lon], chunk.st[o + ST.lat]);
      const b = builds.get(chunk.id)!;
      const wall = b.endWalls.find((w) => w.end === side)!;
      const { lo, hi } = innerOf(b, side);
      const { road } = topsAt(world, b, side, 0);
      const r = missesAt(world, b, side, lo, hi, road - SLAB + wall.heightM);
      expect(r.rays).toBeGreaterThan(100);
      expect(r.misses).toEqual([]);
      for (let u = lo + STEP / 2; u < hi; u += STEP) {
        const t = topsAt(world, b, side, u);
        expect(t.top! - t.road, `u ${u}`).toBeGreaterThanOrEqual(PARAPET_HEIGHT.value - 1e-3);
      }
      expect(maxPast(b, side)).toBeLessThanOrEqual(1e-3);
    },
  );

  it("leaves no gap across both carriageways of the opposed pair 45068169 | 45068170 and the wall between them", () => {
    const one = endChunk("45068169:start");
    const two = endChunk("45068170:end");
    const { builds, world } = near(one.chunk.st[ST.lon], one.chunk.st[ST.lat]);
    for (const { side, chunk } of [one, two]) {
      const b = builds.get(chunk.id)!;
      // Over both roads, and 1 cm from the seams where each box meets the 壁高欄 beside it (the one between the
      // two included). Why not over the 壁高欄 themselves: a chunk's end leaves its 壁高欄 open (as
      // before), and no car stands inside one.
      const sd = side === "start" ? b.sides[0] : b.sides[b.sides.length - 1];
      const lo = -(sd.right.wall ? sd.right.wall.inner : sd.right.reach);
      const hi = sd.left.wall ? sd.left.wall.inner : sd.left.reach;
      const { road } = topsAt(world, b, side, 0);
      const top = road + PARAPET_HEIGHT.value;
      expect(missesAt(world, b, side, lo, hi, top).misses, chunk.id).toEqual([]);
      // One column of rays 1 cm inside each seam.
      for (const u of [lo + 0.01, hi - 0.01])
        expect(
          missesAt(world, b, side, u - STEP / 2, u + STEP / 2, top).misses,
          `${chunk.id} u ${u}`,
        ).toEqual([]);
    }
  });
});
