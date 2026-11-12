import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CUT_WALL, PARAPET_HEIGHT, PARAPET_WIDTH } from "../src/expressway/assumptions";
import type { XwChunk, XwTileRun } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { DEFAULT_DATA_DIR, readExpresswayFiles } from "../scripts/expresswayFiles";
import { LocalFrame } from "../src/geo/frame";
import { latToTileY, lonToTileX } from "../src/geo/tiles";
import { boreHoles, cutsGround } from "../src/world/expresswayBore";
import { createDeckBody, deckArraySteps, type GeoToLocal } from "../src/world/expresswayDeck";
import { expresswayRoadInput, joinExpressway, siteCrossings } from "../src/world/expresswayRoads";
import { DeckIndex } from "../src/world/expresswayMarkings";
import type { VectorTile } from "@mapbox/vector-tile";
import { GroundCuts } from "../src/world/groundCuts";
import { roadLinesOfTile } from "../src/world/roadTiles";
import type { RoadDiagnostic, RoadLine } from "../src/world/roads";
import { holeTests, probeChunk } from "../src/world/terrainProbe";

beforeAll(() => RAPIER.init());

// Synthetic chunks going east near 芝公園 (as tests/expresswayBore.test.ts), road at T.P. 10 m, level.
const plane = planeAt(139.75, 35.65);
const N = 36.9; // a constant geoid
const frame = new LocalFrame(35.65, 139.751, 40);
const place: GeoToLocal = { frame, ellipsoidal: (_lat, _lon, h) => h + N };
const ROAD = 10;
const HW = (2 * 3.25 + 1.25 + 0.75) / 2;
const EDGE = HW + PARAPET_WIDTH.value;

/** A chunk of run B from x0 to x0 + 100 m (stations every 10 m), y = bend · (x − x0)² / 200 (a bend when bend ≠ 0). */
function chunkOf(
  structure: XwChunk["structure"],
  ground: number,
  extra: Partial<XwChunk> = {},
  x0 = 100,
  bend = 0,
): XwChunk {
  const st: number[] = [];
  for (let s = 0; s <= 100; s += 10) {
    const [lon, lat] = plane.toLonLat(x0 + s, (bend * s * s) / 200);
    st.push(x0 - 100 + s, lon, lat, ROAD, 0, ground, 0);
  }
  return {
    id: "B:0",
    run: "B",
    chain: "B",
    k: 0,
    cls: "expressway",
    ref: "C1",
    name: null,
    structure,
    over: null,
    lanes: 2,
    laneWidth: 3.25,
    shoulderL: 1.25,
    shoulderR: 0.75,
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

function built(chunk: XwChunk, at: GeoToLocal = place) {
  const steps = deckArraySteps(chunk, at);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((w) => w.free()));
function worldWith(chunk: XwChunk, at: GeoToLocal = place) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  const b = built(chunk, at);
  createDeckBody(world, b.collider, b.piers, null);
  world.step();
  return world;
}
const cast = (
  world: RAPIER.World,
  from: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
) => {
  const hit = world.castRay(new RAPIER.Ray(from, dir), 60, true);
  return hit ? hit.timeOfImpact : null;
};
/** Plane coordinates of a point (the holes' units in these tests). */
const toXY = (lon: number, lat: number): [number, number] => plane.toXY(lon, lat);
/** Terrain heights the probe tests give: over the road and just under it. */
const overRoad = () => ROAD + 0.5;
const underRoad = () => ROAD - 0.05;
/** A street piece's two ends in the plane. */
const endsOf = (l: RoadLine) => [0, l.coords.length - 2].map((k) => plane.toXY(l.coords[k], l.coords[k + 1]));
/** How high a chunk's left wall stands over the road at s 50.37 (a ray down just inside it). */
function wallTop(chunk: XwChunk, at: GeoToLocal): number {
  const world = worldWith(chunk, at);
  const m = centreAt(50.37);
  return 20 - cast(world, { x: m.x, y: m.y + 20, z: m.z - (HW + 0.25) }, { x: 0, y: -1, z: 0 })!;
}
/** The local height of a T.P. height near the line. */
const yOf = (tp: number) => frame.toLocal(35.65, 139.751, tp + N).y;
/** The road's centre at run distance s (local). Left of travel (north) is −z. */
function centreAt(s: number) {
  const [lon, lat] = plane.toLonLat(100 + s, 0);
  return frame.toLocal(lat, lon, ROAD + N);
}
/** A terrain north (left) of the line at `left`, south at `right` (T.P. m). */
const sloped = (left: number, right: number): GeoToLocal => ({
  ...place,
  groundAt: (lat, lon) => {
    const [, y] = plane.toXY(lon, lat);
    return (y > 0 ? left : right) + N;
  },
});

/** A checksum of the drawn positions to the millimetre (the same build gives the same number). */
function checksum(position: Float32Array): number {
  let h = 0;
  for (let i = 0; i < position.length; i++) h = (h * 31 + Math.round(position[i] * 1000)) % 1000000007;
  return h;
}

describe("高架・トンネル・掘割の組み立ては 7b の前と同じ（P2.7-6 PR 7b の不変）", () => {
  // From origin/main 0683f14, the same chunks built there (the vertices, the collider's triangles and
  // the positions' checksum): a viaduct, a tunnel and a cut, with and without the terrain the cut
  // walls read. An embankment is the only section 7b changes.
  const cases: Array<[string, XwChunk, GeoToLocal, number, number, number]> = [
    ["viaduct", chunkOf("viaduct", 2), place, 750, 140, 802781016],
    ["viaduct over a sloped terrain", chunkOf("viaduct", 2), sloped(4, 1), 750, 140, 802781016],
    ["tunnel", chunkOf("tunnel", 30), place, 930, 220, 245554516],
    ["cut", chunkOf("cut", 15), place, 630, 100, 254709793],
    ["cut in a sloped terrain", chunkOf("cut", 15), sloped(16, 13), 630, 100, 645563562],
  ];
  it.each(cases)(
    "%s: the same vertices, collider triangles and positions",
    (_n, chunk, at, vertices, collider, sum) => {
      const b = built(chunk, at);
      expect([
        b.arrays.position.length / 3,
        b.collider.index.length / 3,
        checksum(b.arrays.position),
      ]).toEqual([vertices, collider, sum]);
    },
  );
});

describe("盛土の壁と擁壁（P2.7-6 PR 7b、R1・W4 の残り・W5・R6 b）", () => {
  it("an embankment's walls are solid from the slab down past the ground: a ray from the street beside it meets the wall at the slab's edge", () => {
    // The road 4 m over the ground: a level ray 2 m under the road, from 20 m out on either side.
    const world = worldWith(chunkOf("embankment", 6));
    const c = centreAt(50.37);
    for (const side of [-1, 1]) {
      const hit = cast(world, { x: c.x, y: c.y - 2, z: c.z + side * 20 }, { x: 0, y: 0, z: -side });
      expect(Math.abs(hit! - (20 - EDGE))).toBeLessThan(0.05);
    }
  });

  it("where the terrain beside it stands over the road the 壁高欄 rises into a retaining wall, to the ground and CUT_WALL.above over it; on the low side it stays a parapet", () => {
    // North (left, −z) 2 m over the road, south (right, +z) 4 m under it.
    const world = worldWith(chunkOf("embankment", 6), sloped(ROAD + 2, 6));
    const c = centreAt(50.37);
    const down = (z: number) => cast(world, { x: c.x, y: c.y + 20, z }, { x: 0, y: -1, z: 0 });
    const high = down(c.z - (HW + 0.25));
    const low = down(c.z + (HW + 0.25));
    expect(Math.abs(20 - high! - (2 + CUT_WALL.value.above))).toBeLessThan(0.02);
    expect(Math.abs(20 - low! - PARAPET_HEIGHT.value)).toBeLessThan(0.02);
    // The retaining wall stops a car coming off the higher ground towards the road.
    const across = cast(world, { x: c.x, y: c.y + 2.2, z: c.z - 20 }, { x: 0, y: 0, z: 1 });
    expect(Math.abs(across! - (20 - EDGE))).toBeLessThan(0.05);
  });

  it("an embankment under the ground (R1・W5: a same-surface stretch below its ground), without a terrain to read, walls both sides to the station's ground", () => {
    const world = worldWith(chunkOf("embankment", ROAD + 2));
    const c = centreAt(50.37);
    for (const side of [-1, 1]) {
      const top = cast(world, { x: c.x, y: c.y + 20, z: c.z + side * (HW + 0.25) }, { x: 0, y: -1, z: 0 });
      expect(Math.abs(20 - top! - (2 + CUT_WALL.value.above))).toBeLessThan(0.02);
    }
    // The road itself is still the surface (T11): a ray down the centre meets it.
    const road = cast(world, { x: c.x, y: c.y + 1, z: c.z }, { x: 0, y: -1, z: 0 });
    expect(Math.abs(road! - 1)).toBeLessThan(0.01);
  });

  it("the terrain is cut over an embankment's slab and no wider; tunnels, cuts and embankments cut the ground, a viaduct does not", () => {
    const holes = boreHoles(chunkOf("embankment", 6), toXY);
    expect(holes).toHaveLength(1);
    const ring = holes[0][0];
    let widest = 0;
    for (let i = 1; i < ring.length; i += 2) widest = Math.max(widest, Math.abs(ring[i]));
    expect(Math.abs(widest - EDGE)).toBeLessThan(0.05);
    expect(
      ["tunnel", "cut", "embankment", "viaduct"].map((s) =>
        cutsGround({ structure: s as XwChunk["structure"] }),
      ),
    ).toEqual([true, true, true, false]);
  });
});

/** A chunk of run B from (x, y) heading `deg` from east, 100 m long, run distance from s0. */
function chunkFrom(
  id: string,
  x: number,
  y: number,
  deg: number,
  s0: number,
  extra: Partial<XwChunk>,
): XwChunk {
  const c = chunkOf("cut", 15, { id, ...extra });
  const st = c.st;
  const a = (deg * Math.PI) / 180;
  for (let k = 0; k * 7 < st.length; k++) {
    const d = k * 10;
    const [lon, lat] = plane.toLonLat(x + d * Math.cos(a), y + d * Math.sin(a));
    st[k * 7] = s0 + d;
    st[k * 7 + 1] = lon;
    st[k * 7 + 2] = lat;
  }
  return c;
}

describe("地形の穴の継ぎ目と地形の探り（groundCuts.ts・terrainProbe.ts、P2.7-6 PR 7b）", () => {
  it("two chunks of a run meeting on a 15° bend leave no ground across the road at their shared station, drawn or in the collider", () => {
    const a = chunkFrom("B:0", 0, 0, 0, 0, { next: "B:1" });
    const b = chunkFrom("B:1", 100, 0, 15, 100, { prev: "B:0", k: 1 });
    const cuts = new GroundCuts(null);
    cuts.addChunk(a);
    cuts.addChunk(b);
    const holes = holeTests(cuts);
    for (const along of [-0.3, 0, 0.3])
      for (let u = -HW; u <= HW + 1e-9; u += 0.5) {
        // Across the bisector of the two directions at the seam (7.5°).
        const t = (7.5 * Math.PI) / 180;
        const [lon, lat] = plane.toLonLat(
          100 + along * Math.cos(t) - u * Math.sin(t),
          along * Math.sin(t) + u * Math.cos(t),
        );
        expect([holes.isDrawnCut(lon, lat), holes.isColliderCut(lon, lat)]).toEqual([true, true]);
      }
  });

  it("the probe finds the terrain standing through the road where nothing is cut, and none once the chunk's own hole is cut (its ends apart)", () => {
    const chunk = chunkOf("embankment", 6);
    const [first, last] = [0, 10].map((k) => [chunk.st[k * 7 + 1], chunk.st[k * 7 + 2]] as [number, number]);
    const bare = probeChunk(chunk, holeTests(new GroundCuts(null)), overRoad, [], [first, last]);
    expect(bare.points).toBeGreaterThan(1000);
    expect(bare.hits.filter((h) => !h.atEnd && h.kind === "drawn")).toHaveLength(
      bare.points - bare.hits.filter((h) => h.atEnd).length,
    );
    const cuts = new GroundCuts(null);
    cuts.addChunk(chunk);
    const cut = probeChunk(chunk, holeTests(cuts), overRoad, [], [first, last]);
    expect(cut.hits.filter((h) => !h.atEnd)).toEqual([]);
  });

  it("a street across the road counts where no hole takes it away, and not over the chunk's hole", () => {
    const chunk = chunkOf("embankment", 6);
    const [lonA, latA] = plane.toLonLat(150, -30);
    const [lonB, latB] = plane.toLonLat(150, 30);
    const street = { coords: [lonA, latA, lonB, latB], width: 6 };
    const bare = probeChunk(chunk, holeTests(new GroundCuts(null)), underRoad, [street], []);
    expect(bare.hits.filter((h) => h.kind === "street").length).toBeGreaterThan(50);
    expect(bare.hits.filter((h) => h.kind !== "street")).toEqual([]);
    const cuts = new GroundCuts(null);
    cuts.addChunk(chunk);
    expect(probeChunk(chunk, holeTests(cuts), underRoad, [street], []).hits).toEqual([]);
  });
});

const runOf = (start: string, cls: XwTileRun["cls"] = "expressway"): XwTileRun => ({
  id: "B",
  cls,
  start: { kind: start as "open" },
  end: { kind: "seam", parent: "X", parentS: 0 },
});
/** A GSI street 120 m long through (x, 0), `deg` from east, `width` wide. */
const streetAt = (x: number, deg: number, width = 9): RoadLine => {
  const a = (deg * Math.PI) / 180;
  const [lonA, latA] = plane.toLonLat(x - 60 * Math.cos(a), -60 * Math.sin(a));
  const [lonB, latB] = plane.toLonLat(x + 60 * Math.cos(a), 60 * Math.sin(a));
  return { coords: [lonA, latA, lonB, latB], width, oneway: 0, kind: "local", bridge: false };
};
const join = (chunks: XwChunk[], run: XwTileRun, streets: RoadLine[]) => {
  const reports: RoadDiagnostic[] = [];
  const input = expresswayRoadInput(chunks, [run], (_lat, _lon, h) => h + N);
  const lines = joinExpressway(streets, input, (d) => reports.push(d));
  return { streets: lines.filter((l) => l.xid === undefined), reports };
};
/** Plane length (m) of the gap the cut leaves in a street: the distance between its inner ends. */
const gapOf = (pieces: RoadLine[]) => {
  let best = Infinity;
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++)
      for (const a of endsOf(pieces[i]))
        for (const b of endsOf(pieces[j])) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1]));
  return best;
};

describe("盛土・掘割を途中で横切る一般道（expresswayRoads.ts cutAtSites、P2.7-6 PR 7b）", () => {
  // The road 1 m over the ground: the street crosses it at grade.
  const atGrade = chunkOf("embankment", ROAD - 1);

  it("a street crossing an embankment mid-run is taken out over the slab and a metre either side: two dead ends, no line through the walls", () => {
    const { streets, reports } = join([atGrade], runOf("seam"), [streetAt(150, 90)]);
    expect(streets).toHaveLength(2);
    expect(gapOf(streets)).toBeCloseTo(2 * (EDGE + 1), 1);
    expect(reports.map((r) => r.event)).toEqual(["street_cut_at_expressway"]);
  });

  it("a wide street at an angle is taken out over the slab's width along it and its own half width beside it", () => {
    const deg = 45;
    const width = 25;
    const a = (deg * Math.PI) / 180;
    const { streets } = join([atGrade], runOf("seam"), [streetAt(150, deg, width)]);
    expect(gapOf(streets)).toBeCloseTo(2 * ((EDGE + 1) / Math.sin(a) + width / 2 / Math.tan(a)), 1);
  });

  it("at 30° or more it is a crossing, under 30° it runs along the site (a ramp in its median) and is kept", () => {
    expect(join([atGrade], runOf("seam"), [streetAt(150, 31)]).streets).toHaveLength(2);
    expect(join([atGrade], runOf("seam"), [streetAt(150, 29)]).streets).toHaveLength(1);
  });

  it("a street crossing two sites side by side (two parallel decks) loses one stretch over each", () => {
    const north = chunkOf("embankment", ROAD - 1, { id: "B:0" });
    const south = chunkOf("cut", ROAD + 0.5, { id: "C:0", run: "C" });
    for (let k = 0; k * 7 < south.st.length; k++) {
      const [lon, lat] = plane.toLonLat(100 + k * 10, -30);
      south.st[k * 7 + 1] = lon;
      south.st[k * 7 + 2] = lat;
    }
    const runs = [runOf("seam"), { ...runOf("seam"), id: "C" }];
    const input = expresswayRoadInput([north, south], runs, (_lat, _lon, h) => h + N);
    const lines = joinExpressway([streetAt(150, 90)], input, () => {});
    expect(lines.filter((l) => l.xid === undefined)).toHaveLength(3);
  });

  it("kept whole: within RAMP_REACH_M of the run's ground end (the ramp's own street) and under a viaduct", () => {
    expect(join([atGrade], runOf("ground", "ramp"), [streetAt(108, 90)]).streets).toHaveLength(1);
    expect(join([chunkOf("viaduct", 2)], runOf("seam"), [streetAt(150, 90)]).streets).toHaveLength(1);
  });

  it("under a deck that clears the street by the statute's 4.5 m on a girder thinned as the compiler's R3 thins it, it is told apart as `under` and taken out all the same (its walls stop a car: re-review W-B)", () => {
    // Road 7 m over the ground: 4.5 m + a 1.7 m girder clear. At 3 m it is an ordinary cut.
    const high = join([chunkOf("embankment", ROAD - 7)], runOf("seam"), [streetAt(150, 90)]);
    expect(high.streets).toHaveLength(2);
    expect(high.reports.map((r) => (r.fields as { kind: string }).kind)).toEqual(["under"]);
    const kindAt = (ground: number) => {
      const input = expresswayRoadInput(
        [chunkOf("embankment", ground)],
        [runOf("seam")],
        (_lat, _lon, h) => h + N,
      );
      return siteCrossings([streetAt(150, 90)], input.sites ?? [], plane.toXY).map((c) => [
        c.kind,
        c.overGroundM,
      ]);
    };
    expect(kindAt(ROAD - 7)).toEqual([["under", 7]]);
    expect(kindAt(ROAD - 3)).toEqual([["cut", 3]]);
  });

  it("a GSI street in a tunnel (ftCode 2704) is named so in the crossings (an underpass the game does not draw)", () => {
    const input = expresswayRoadInput([atGrade], [runOf("seam")], (_lat, _lon, h) => h + N);
    const street = { ...streetAt(150, 90), tunnel: true };
    expect(siteCrossings([street], input.sites ?? [], plane.toXY).map((c) => c.tunnel)).toEqual([true]);
  });
});

/** Two embankments of two runs 10 m apart (B north, C south): B's right side lies on C's slab. */
const pair = () => {
  const north = chunkOf("embankment", 6, { id: "B:0" });
  const south = chunkOf("embankment", 6, { id: "C:0", run: "C", chain: "C" });
  for (let k = 0; k * 7 < south.st.length; k++) {
    const [lon, lat] = plane.toLonLat(100 + k * 10, -10);
    south.st[k * 7 + 1] = lon;
    south.st[k * 7 + 2] = lat;
  }
  const runs = new Map<string, XwTileRun>([
    ["B", runOf("seam")],
    ["C", { ...runOf("seam"), id: "C" }],
  ]);
  const index = new DeckIndex(runs);
  index.add(north);
  index.add(south);
  return { north, index };
};

describe("並走する盛土の脇（PR 7b の再レビュー W-A・S-1）", () => {
  // The drawn terrain 2 m over the road everywhere (in C's hole too, as the mesh reads there).
  const high: GeoToLocal = { ...place, groundAt: () => ROAD + 2 + N, terrainAt: () => ROAD + 2 + N };

  it("no collider of B stands over C's carriageway, and B's wall on C's side stays a parapet", () => {
    const { north, index } = pair();
    const steps = deckArraySteps(north, high, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    const pos = r.value.collider.position;
    const c = centreAt(50);
    const southZ = c.z + 10;
    for (let k = 0; k < pos.length; k += 3) {
      const isOverC = Math.abs(pos[k + 2] - southZ) < HW && pos[k + 1] > c.y + 0.05;
      expect(isOverC).toBe(false);
    }
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    createDeckBody(world, r.value.collider, r.value.piers, null);
    world.step();
    const m = centreAt(50.37);
    const down = (z: number) => 20 - cast(world, { x: m.x, y: m.y + 20, z }, { x: 0, y: -1, z: 0 })!;
    expect(down(m.z + HW + 0.25)).toBeCloseTo(PARAPET_HEIGHT.value, 1);
    expect(down(m.z - (HW + 0.25))).toBeCloseTo(2 + CUT_WALL.value.above, 1);
  });
});

describe("盛土の端面・足元・地形の読み方（PR 7b のレビュー W1〜W4）", () => {
  const c = centreAt(100);
  const endAt = (pos: Float32Array) => {
    const out: number[][] = [];
    for (let k = 0; k < pos.length; k += 3)
      if (Math.abs(pos[k] - c.x) < 0.02) out.push([pos[k], pos[k + 1], pos[k + 2]]);
    return out;
  };

  it("the end face stays under the road, also beside a retaining wall (W1)", () => {
    const b = built(chunkOf("embankment", 6), sloped(ROAD + 2, 6));
    const over = endAt(b.arrays.position).filter(
      ([, y, z]) => Math.abs(z - c.z) < HW - 0.01 && y > c.y + 0.05,
    );
    expect(over).toEqual([]);
  });

  it("the end face is solid: a car under the viaduct beyond it runs into it (W2)", () => {
    const world = worldWith(chunkOf("embankment", 6));
    const hit = cast(world, { x: c.x + 10, y: c.y - 2, z: c.z }, { x: -1, y: 0, z: 0 });
    expect(Math.abs(hit! - 10)).toBeLessThan(0.05);
  });

  it("an embankment's walls meet the drawn terrain (terrainAt) and a cut's the DEM (groundAt) (W3)", () => {
    const dem = sloped(ROAD - 4, ROAD - 4);
    const drawn: GeoToLocal = { ...dem, terrainAt: () => ROAD + 2 + N };
    expect(wallTop(chunkOf("embankment", 6), drawn)).toBeCloseTo(2 + CUT_WALL.value.above, 1);
    expect(wallTop(chunkOf("cut", 15), { ...drawn, groundAt: () => 15 + N })).toBeCloseTo(
      5 + CUT_WALL.value.above,
      1,
    );
  });

  it("beside a walled side the ground keeps a collider to EMBANKMENT_APRON_M out (W4: the terrain's own drops ~1 m by the hole)", () => {
    const world = worldWith(chunkOf("embankment", 6), sloped(6, 6));
    const m = centreAt(50.37);
    for (const d of [0.25, 0.5, 1.2]) {
      const hit = cast(world, { x: m.x, y: m.y + 20, z: m.z + EDGE + d }, { x: 0, y: -1, z: 0 });
      expect(Math.abs(m.y + 20 - hit! - yOf(6))).toBeLessThan(0.02);
    }
  });
});

describe("別の run へ続く盛土の端（PR 7b の 3 回目のレビュー W-C）", () => {
  it("where an embankment under the ground goes on into another run, its wall at the last ring still rises over the ground beside it", () => {
    // B ends at x = 200 (its run's end); C, another run, goes on east from there (a tunnel's mouth).
    const b = chunkOf("embankment", 6, { id: "B:0" });
    const c = chunkOf("tunnel", 30, { id: "C:0", run: "C", chain: "C" }, 200);
    const runs = new Map<string, XwTileRun>([
      ["B", runOf("seam")],
      ["C", { ...runOf("seam"), id: "C" }],
    ]);
    const index = new DeckIndex(runs);
    index.add(b);
    index.add(c);
    // The ground beside B 2 m over its road: from C's road (the same level at the seam) it is beside C too.
    const at: GeoToLocal = { ...place, groundAt: () => ROAD + 2 + N, terrainAt: () => ROAD + 2 + N };
    const steps = deckArraySteps(b, at, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    createDeckBody(world, r.value.collider, r.value.piers, null);
    world.step();
    const m = centreAt(99.9);
    for (const side of [-1, 1]) {
      const hit = cast(world, { x: m.x, y: m.y + 20, z: m.z + side * (HW + 0.25) }, { x: 0, y: -1, z: 0 });
      expect(20 - hit!).toBeGreaterThanOrEqual(2 + CUT_WALL.value.above - 0.02);
    }
  });
});

describe("掘割と土被りのあるトンネルの継ぎ目、既定データの穴（PR 7b のレビュー C1）", () => {
  it("a cut's hole stops at a tunnel whose roof is under cover there, and the tunnel's does not reach back", () => {
    const cut = chunkOf("cut", ROAD + 7, { id: "B:0", next: "B:1" });
    const tunnel = chunkOf(
      "tunnel",
      ROAD + 7,
      { id: "B:1", prev: "B:0", portals: [{ s: 100, from: "cut", to: "tunnel" }] },
      200,
    );
    const xs = boreHoles(cut, toXY).flatMap((p) => p[0].filter((_, k) => k % 2 === 0));
    expect(Math.max(...xs)).toBeCloseTo(200, 1);
    expect(boreHoles(tunnel, toXY)).toEqual([]);
  });

  it("the shipped 麻布台 holes (737538573) and the terrain's mask over them are what they were before PR 7b", () => {
    const files = readExpresswayFiles(DEFAULT_DATA_DIR);
    let h = 0;
    let n = 0;
    for (const c of files.chunks)
      for (const poly of boreHoles(c, (lon, lat) => [lonToTileX(lon, 16), latToTileY(lat, 16)]))
        for (const v of poly[0]) {
          h = (h * 31 + Math.round(v * 1e7)) % 1000000007;
          n++;
        }
    const cuts = new GroundCuts(null);
    for (const c of files.chunks) cuts.addChunk(c);
    let m = 0;
    for (let x = 29090; x < 29120; x++)
      for (let y = 12890; y < 12920; y++) {
        const mask = cuts.cutAt(x, y);
        if (mask) for (const v of mask.data) m = (m * 31 + v) % 1000000007;
      }
    // From origin/main 0683f14 with the same data: change only with the data (P2.7-6 PR 7c).
    expect([n, h, m]).toEqual([80, 386725077, 189969420]);
  });
});

/** A GSI road centreline feature of the vector tile (only what roadLinesOfTile reads). */
const feature = (ftCode: number) => ({
  type: 2,
  properties: { ftCode, rdCtg: 3, rnkWidth: 2, lvOrder: 0 },
  loadGeometry: () => [
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
  ],
});

describe("GSI のトンネルの道（roadTiles.ts roadLinesOfTile、PR 7b の 3 回目のレビュー S-c）", () => {
  it("a ground-level centreline of ftCode 2704 is read as a street in a tunnel; 2701 and 2703 are not", () => {
    const features = [feature(2701), feature(2703), feature(2704)];
    const tile = {
      layers: { road: { length: features.length, extent: 4096, feature: (i: number) => features[i] } },
    } as unknown as VectorTile;
    const lines = roadLinesOfTile(tile, 58208, 25813);
    expect(lines.map((l) => [l.bridge, l.tunnel === true])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
  });
});
