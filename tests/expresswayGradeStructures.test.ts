import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CUT_WALL, PARAPET_HEIGHT, PARAPET_WIDTH, TUNNEL_ROOF } from "../src/expressway/assumptions";
import { ST, STATION_STRIDE, type XwChunk, type XwTileRun } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { DEFAULT_DATA_DIR, readExpresswayFiles } from "../scripts/expresswayFiles";
import { LocalFrame } from "../src/geo/frame";
import { latToTileY, lonToTileX } from "../src/geo/tiles";
import { boreHoles, cutsGround } from "../src/world/expresswayBore";
import { HEAD_OVER_GROUND_M, isHoleAt, TUNNEL_INNER_HEIGHT_M } from "../src/expressway/below";
import { closeWidthStep, createDeckBody, deckArraySteps, type GeoToLocal } from "../src/world/expresswayDeck";
import { chunkRings, openSide } from "../src/world/expresswayMerge";
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
  // walls read. An embankment is the only section 7b changes. S6 PR 7c1 (F3) adds collider-only
  // strips beside a cut's walls where it reads a terrain: 120 triangles more, drawn the same.
  const cases: Array<[string, XwChunk, GeoToLocal, number, number, number]> = [
    ["viaduct", chunkOf("viaduct", 2), place, 750, 140, 802781016],
    ["viaduct over a sloped terrain", chunkOf("viaduct", 2), sloped(4, 1), 750, 140, 802781016],
    ["tunnel", chunkOf("tunnel", 30), place, 930, 220, 245554516],
    ["cut", chunkOf("cut", 15), place, 630, 100, 254709793],
    ["cut in a sloped terrain", chunkOf("cut", 15), sloped(16, 13), 630, 220, 645563562],
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

/** Two embankments of two runs 9.1 m apart (B north, C south): their slabs overlap, B's right side lies on C's. */
const pair = () => {
  const north = chunkOf("embankment", 6, { id: "B:0" });
  const south = chunkOf("embankment", 6, { id: "C:0", run: "C", chain: "C" });
  for (let k = 0; k * 7 < south.st.length; k++) {
    const [lon, lat] = plane.toLonLat(100 + k * 10, -9.1);
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
    const southZ = c.z + 9.1;
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

/** B (an embankment) with C beside it `apart` m south (9.6: C's slab edge 0.1 m past B's, 9.6 − 2 × 4.75). */
const beside = (structure: XwChunk["structure"], ground: number, apart = 9.6) => {
  const b = chunkOf("embankment", 6, { id: "B:0" });
  const c = chunkOf(structure, ground, { id: "C:0", run: "C", chain: "C" });
  for (let k = 0; k * 7 < c.st.length; k++) {
    const [lon, lat] = plane.toLonLat(100 + k * 10, -apart);
    c.st[k * 7 + 1] = lon;
    c.st[k * 7 + 2] = lat;
  }
  const index = new DeckIndex(
    new Map<string, XwTileRun>([
      ["B", runOf("seam")],
      ["C", { ...runOf("seam"), id: "C" }],
    ]),
  );
  index.add(b);
  index.add(c);
  // The drawn ground 2 m over both roads (a wall rises to it where it is drawn).
  const at: GeoToLocal = { ...place, groundAt: () => ROAD + 2 + N, terrainAt: () => ROAD + 2 + N };
  const steps = deckArraySteps(b, at, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value.collider;
};

/** How high B's right wall stands over its road at s 50.37 (a ray down just inside it). */
const rightTop = (collider: ReturnType<typeof beside>) => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  createDeckBody(world, collider, [], null);
  world.step();
  const m = centreAt(50.37);
  return 20 - cast(world, { x: m.x, y: m.y + 20, z: m.z + HW + 0.25 }, { x: 0, y: -1, z: 0 })!;
};

describe("開いた側の 2 つの判定（7b2）", () => {
  it("beside a viaduct or a tunnel under its cover (the ground there is drawn) the wall rises; beside an embankment (its hole) it stays a parapet", () => {
    expect(rightTop(beside("viaduct", 2))).toBeCloseTo(2 + CUT_WALL.value.above, 1);
    expect(rightTop(beside("tunnel", 30))).toBeCloseTo(2 + CUT_WALL.value.above, 1);
    expect(rightTop(beside("embankment", 6))).toBeCloseTo(PARAPET_HEIGHT.value, 1);
  });

  it("no apron lies under another deck whose road is within a metre over the drawn ground (it would stand in its carriageway)", () => {
    // The drawn ground at ROAD + 2, C's road at ROAD: C stands under it, the apron must not lie there.
    const collider = beside("viaduct", 2).position;
    const c = centreAt(50);
    for (let k = 0; k < collider.length; k += 3) {
      const isUnderC = Math.abs(collider[k + 2] - (c.z + 9.6)) < HW - 0.01;
      expect(isUnderC).toBe(false);
    }
  });
});

describe("帯の遠い縁だけが隣の床版に入る間隔（7b2 のレビュー）", () => {
  it("11 m apart (the slab's edge and 0.5 m out open, 1.5 m out on C's slab): the wall rises and no apron lies", () => {
    const collider = beside("embankment", 6, 11);
    expect(rightTop(collider)).toBeCloseTo(2 + CUT_WALL.value.above, 1);
    // The apron would be the only collider past the wall's outer face on that side.
    const c = centreAt(50);
    const pos = collider.position;
    for (let k = 0; k < pos.length; k += 3) expect(pos[k + 2] - c.z > EDGE + 0.05).toBe(false);
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
    // 麻布台's own chunks: since S6 PR 7c the default data has embankments and cuts with holes of
    // their own elsewhere too, which this does not look at.
    const azabudai = files.chunks.filter((c) => c.run === "737538573");
    for (const c of azabudai)
      for (const poly of boreHoles(c, (lon, lat) => [lonToTileX(lon, 16), latToTileY(lat, 16)]))
        for (const v of poly[0]) {
          h = (h * 31 + Math.round(v * 1e7)) % 1000000007;
          n++;
        }
    const cuts = new GroundCuts(null);
    for (const c of azabudai) cuts.addChunk(c);
    let m = 0;
    for (let x = 29090; x < 29120; x++)
      for (let y = 12890; y < 12920; y++) {
        const mask = cuts.cutAt(x, y);
        if (mask) for (const v of mask.data) m = (m * 31 + v) % 1000000007;
      }
    // From origin/main 0683f14 with the same data: change only with the data. S6 PR 7c took 203832842
    // out (footDeferrals.ts) and 737538573 moved by up to 0.34 m: s 492.67 of 737538573:2 crossed the
    // hole's threshold (ground − road 6.721 → 6.650 m against 6.7 m), the hole grew by one station
    // interval (12 → 14 vertices, 1,189 → 1,473 m²); s 134.47 of :1 left it (6.698 → 6.821 m), alone
    // there, so no polygon either way (knowledge「P2.7-6 PR 7c」).
    expect([n, h, m]).toEqual([84, 922761830, 573913335]);
  });

  it("the shipped 麻布台 holes cover exactly the stations isHoleAt opens, two or more in a row (a lone station opens none)", () => {
    const files = readExpresswayFiles(DEFAULT_DATA_DIR);
    for (const c of files.chunks.filter((x) => x.run === "737538573")) {
      const n = c.st.length / STATION_STRIDE;
      const structure = c.structure === "cut" ? "cut" : "tunnel";
      const runs: number[] = [];
      let len = 0;
      for (let i = 0; i <= n; i++) {
        const isHole =
          i < n && isHoleAt(structure, c.st[i * STATION_STRIDE + ST.z], c.st[i * STATION_STRIDE + ST.ground]);
        if (isHole) {
          len++;
          continue;
        }
        if (len >= 2) runs.push(len);
        len = 0;
      }
      const polys = boreHoles(c, (lon, lat) => [lonToTileX(lon, 16), latToTileY(lat, 16)]);
      expect(polys.length, c.id).toBe(runs.length);
      // Two vertices a station (left and right), two more where the hole reaches back past a seam.
      polys.forEach((poly, k) => expect([0, 2], c.id).toContain(poly[0].length / 2 - 2 * runs[k]));
    }
  });

  it("opens no hole over a lone station under the threshold, and one over two in a row", () => {
    const deep = ROAD + TUNNEL_INNER_HEIGHT_M + TUNNEL_ROOF.value.slab + HEAD_OVER_GROUND_M + 0.5;
    const shallow = ROAD + 6;
    const withGround = (shallowAt: number[]) => {
      const c = chunkOf("tunnel", deep, { id: "T:0", run: "T", chain: "T", prev: null });
      for (const i of shallowAt) c.st[i * STATION_STRIDE + ST.ground] = shallow;
      return c;
    };
    expect(boreHoles(withGround([5]), toXY)).toEqual([]);
    expect(boreHoles(withGround([5, 6]), toXY)).toHaveLength(1);
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

describe("低い径間の両側の盛土（P2.7-6 PR 7a2、実行時は変えない）", () => {
  // Embankment x 100–200, a low span (viaduct on the thinnest girder) x 200–300, embankment 300–400,
  // the road 4.5 m over the ground there (a soffit of 2.8 m): the compiler's low span.
  const ground = ROAD - 4.5;
  const chunks = [
    chunkOf("embankment", ground, { id: "B:0", k: 0, next: "B:1" }, 100),
    chunkOf("viaduct", ground, { id: "B:1", k: 1, prev: "B:0", next: "B:2", girder: 1.7 }, 200),
    chunkOf("embankment", ground, { id: "B:2", k: 2, prev: "B:1" }, 300),
  ];
  const world = () => {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(w);
    for (const c of chunks) {
      const b = built(c);
      createDeckBody(w, b.collider, b.piers, null);
    }
    w.step();
    return w;
  };
  const under = (x: number) => {
    const [lon, lat] = plane.toLonLat(x, 0);
    return frame.toLocal(lat, lon, ground + 1 + N);
  };

  it("a wide street under the span is kept whole (not cut at the site)", () => {
    expect(join(chunks, runOf("seam"), [streetAt(250, 90, 30)]).streets).toHaveLength(1);
  });

  it("nothing stands across the street under the span, and the embankments either side close with a solid end face", () => {
    const w = world();
    const mid = under(250);
    // Along the street (north to south, 1 m over its ground) under the span: no collider within 60 m.
    expect(cast(w, { x: mid.x, y: mid.y, z: mid.z - 20 }, { x: 0, y: 0, z: 1 })).toBeNull();
    // Along the run under the span, west and east: each embankment's end face 50 m off.
    expect(Math.abs(cast(w, mid, { x: -1, y: 0, z: 0 })! - 50)).toBeLessThan(0.3);
    expect(Math.abs(cast(w, mid, { x: 1, y: 0, z: 0 })! - 50)).toBeLessThan(0.3);
  });
});

/** B alone in a context (its run's summary known: which of its ends meet the ground). */
function builtIn(chunk: XwChunk, run: XwTileRun, at: GeoToLocal, others: XwChunk[] = []) {
  const index = new DeckIndex(
    new Map([[run.id, run], ...others.map((c) => [c.run, { ...run, id: c.run }] as const)]),
  );
  index.add(chunk);
  for (const c of others) index.add(c);
  const steps = deckArraySteps(chunk, at, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}
function worldOf(collider: ReturnType<typeof builtIn>["collider"]) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  createDeckBody(world, collider, [], null);
  world.step();
  return world;
}

describe("端面の先と掘割の壁の外の地面のコライダー（S6 PR 7c1、F3）", () => {
  // The drawn terrain (and the DEM) level at `tp` everywhere.
  const level = (tp: number): GeoToLocal => ({ ...place, groundAt: () => tp + N, terrainAt: () => tp + N });
  const groundStart: XwTileRun = { ...runOf("ground"), start: { kind: "ground", ground: ROAD } };
  /** The height a ray down meets at (x, z offset left of the line), from 20 m over the road. */
  const downAt = (world: RAPIER.World, x: number, left: number) => {
    const [lon, lat] = plane.toLonLat(x, 0);
    const m = frame.toLocal(lat, lon, ROAD + N);
    const t = cast(world, { x: m.x, y: m.y + 20, z: m.z - left }, { x: 0, y: -1, z: 0 });
    return t === null ? null : m.y + 20 - t;
  };

  for (const structure of ["embankment", "cut"] as const)
    it(`past a ${structure}'s end face where its run meets the ground, the drawn terrain has a collider 0.25–1.0 m on (within 2 cm)`, () => {
      const tp = ROAD - 0.05;
      const b = builtIn(chunkOf(structure, tp), groundStart, level(tp));
      const world = worldOf(b.collider);
      // The chunk starts at x = 100 going east: past its end face is x < 100.
      for (const d of [0.25, 0.5, 1.0])
        for (const left of [-EDGE + 0.3, 0, EDGE - 0.3]) {
          const y = downAt(world, 100 - d, left);
          expect(y, `${d} m past, ${left} m left`).not.toBeNull();
          expect(Math.abs(y! - yOf(tp))).toBeLessThan(0.02);
        }
      // Not at an end that does not meet the ground (a seam: the run goes on there).
      const seam = builtIn(chunkOf(structure, tp), runOf("seam"), level(tp));
      expect(downAt(worldOf(seam.collider), 99.5, 0)).toBeNull();
    });

  it("beside a cut's retaining walls the drawn terrain has a collider 0.25 and 0.5 m out (within 2 cm)", () => {
    const tp = ROAD + 2;
    const b = builtIn(chunkOf("cut", tp), runOf("seam"), level(tp));
    const world = worldOf(b.collider);
    for (const d of [0.25, 0.5])
      for (const side of [1, -1]) {
        const y = downAt(world, 150.37, side * (HW + CUT_WALL.value.thickness + d));
        expect(y, `${d} m out, side ${side}`).not.toBeNull();
        expect(Math.abs(y! - yOf(tp))).toBeLessThan(0.02);
      }
  });

  it("no strip of a cut lies in the carriageway of a deck beside it whose road is under the drawn ground", () => {
    // B a cut, C a viaduct 9.1 m south with its road 2 m under the drawn terrain (as 7b's W-A).
    const tp = ROAD + 2;
    const b = chunkOf("cut", tp, { id: "B:0" });
    const c = chunkOf("viaduct", ROAD - 6, { id: "C:0", run: "C", chain: "C" });
    for (let k = 0; k * 7 < c.st.length; k++) {
      const [lon, lat] = plane.toLonLat(100 + k * 10, -9.1);
      c.st[k * 7 + 1] = lon;
      c.st[k * 7 + 2] = lat;
    }
    const pos = builtIn(b, runOf("seam"), level(tp), [c]).collider.position;
    const m = centreAt(50);
    const southZ = m.z + 9.1;
    for (let k = 0; k < pos.length; k += 3) {
      const isOverC = Math.abs(pos[k + 2] - southZ) < HW && pos[k + 1] > m.y + 0.05;
      expect(isOverC, `(${pos[k]}, ${pos[k + 1]}, ${pos[k + 2]})`).toBe(false);
    }
  });
});

describe("車線数の変わる継ぎ目で壁高欄を閉じる（S6 PR 7c1、A1、24402125:0 → :1）", () => {
  // W:0 two lanes (carriageway 8.5 m) from x 100 to 200, W:1 one lane (4.75 m) on to 300, viaducts.
  const narrowHw = (3.25 + 1 + 0.5) / 2;
  const narrowEdge = narrowHw + PARAPET_WIDTH.value;
  const wide = chunkOf("viaduct", ROAD - 8, { id: "W:0", run: "W", chain: "W", next: "W:1" });
  const narrow = chunkOf(
    "viaduct",
    ROAD - 8,
    { id: "W:1", run: "W", chain: "W", k: 1, prev: "W:0", lanes: 1, shoulderL: 1, shoulderR: 0.5 },
    200,
  );
  const runW: XwTileRun = { ...runOf("seam"), id: "W" };

  it("leaves no opening at the seam between the narrower 壁高欄 and the wider slab's edge (every 0.25 m, at road + 0.5 m)", () => {
    const index = new DeckIndex(new Map([["W", runW]]));
    index.add(wide);
    index.add(narrow);
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    for (const c of [wide, narrow]) {
      const steps = deckArraySteps(c, place, false, { index });
      let r = steps.next();
      while (!r.done) r = steps.next();
      createDeckBody(world, r.value.collider, [], null);
    }
    world.step();
    const [lon, lat] = plane.toLonLat(195, 0);
    const m = frame.toLocal(lat, lon, ROAD + N);
    let probed = 0;
    for (const side of [1, -1])
      for (let u = narrowEdge + 0.125; u < EDGE - PARAPET_WIDTH.value; u += 0.25) {
        // Along travel at road + 0.5 m, from 5 m before the seam: it meets the wall at the seam.
        const t = cast(world, { x: m.x, y: m.y + 0.5, z: m.z - side * u }, { x: 1, y: 0, z: 0 });
        expect(t, `u ${(side * u).toFixed(3)}`).not.toBeNull();
        expect(t!).toBeGreaterThan(4.4);
        expect(t!).toBeLessThan(5.05);
        probed++;
      }
    expect(probed).toBeGreaterThan(8);
  });

  it("closes only a side whose 壁高欄 stands at its own slab's edge (none where a deck sharing its surface goes on)", () => {
    const own = chunkRings(wide, place);
    const ring = own.rings[own.rings.length - 1];
    const both = { left: openSide(own), right: openSide(own) };
    const leftOnly = { ...both, right: { ...openSide(own), wall: null } };
    const count = (sides: typeof both) => {
      const solid: number[] = [];
      closeWidthStep({ end: "end", narrowEdge }, ring, sides, own.edge, false, [], [], solid);
      return solid.length;
    };
    expect(count(both)).toBeGreaterThan(0);
    expect(count(leftOnly) * 2).toBe(count(both));
  });
});
