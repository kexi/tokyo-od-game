import { expect, it } from "vitest";
import { tileXToLon, tileYToLat } from "../src/geo/tiles";
import {
  decodeVectorTile,
  packVectorTile,
  unpackVectorTileSteps,
  vectorTileTransfers,
  type DecodedVectorTile,
} from "../src/world/vectorTileData";
import { inputFixture, square, hole, vectorTileFixture } from "./vectorTileFixture";

function unpack(tile: DecodedVectorTile): DecodedVectorTile {
  const packet = packVectorTile(tile);
  const copied = structuredClone(packet, { transfer: vectorTileTransfers(packet) });
  expect(vectorTileTransfers(packet).every((b) => b.byteLength === 0)).toBe(true);
  const steps = unpackVectorTileSteps(copied);
  for (;;) {
    const next = steps.next();
    const done = next.done;
    if (done) return next.value;
  }
}
const coords = (ring: number[], global = false) =>
  ring.map((value, i) => {
    const isX = i % 2 === 0;
    const tile = (isX ? 58212 : 25807) + value / 4096;
    return global ? tile : isX ? tileXToLon(tile, 16) : tileYToLat(tile, 16);
  });

it("preserves road selection, widths, kinds, bridges, line order and global water holes from real PBF", () => {
  const buffer = inputFixture(),
    before = new Uint8Array(buffer).slice();
  const tile = decodeVectorTile({ source: "gsi", z: 16, x: 58212, y: 25807, buffer });
  expect(tile).toEqual({
    source: "gsi",
    roads: [
      { coords: coords([0, 0, 2048, 4096]), width: 8, oneway: 0, kind: "national", bridge: true },
      { coords: coords([4096, 0, 4096, 4096]), width: 8, oneway: 0, kind: "national", bridge: true },
      { coords: coords([0, 0, 4096, 4096]), width: 9, oneway: 0, kind: "prefectural", bridge: false },
      { coords: coords([0, 0, 4096, 4096]), width: 4.3, oneway: 0, kind: "highway", bridge: false },
      { coords: coords([0, 0, 4096, 4096]), width: 2.5, oneway: 0, kind: "local", bridge: false },
    ],
    water: [[coords(square, true), coords(hole, true)]],
  });
  expect(unpack(tile)).toEqual(tile);
  expect(new Uint8Array(buffer)).toEqual(before);
});

it("keeps pavement layer ordering and distinguishes sidewalk polygons with holes from islands", () => {
  const tile = decodeVectorTile({ source: "pavement", z: 16, x: 58212, y: 25807, buffer: inputFixture() });
  expect(tile).toEqual({
    source: "pavement",
    polygons: [
      { kind: "sidewalk", rings: [coords(square), coords(hole)] },
      { kind: "island", rings: [coords(square)] },
    ],
  });
  expect(unpack(tile)).toEqual(tile);
});

it("clips buffered polygons before transformation and returns no unrelated layers", () => {
  const buffer = vectorTileFixture([
    {
      name: "waterarea",
      extent: 4096,
      features: [{ type: 3, properties: {}, rings: [[-100, -100, 4196, -100, 4196, 4196, -100, 4196]] }],
    },
  ]);
  const tile = decodeVectorTile({ source: "gsi", z: 16, x: 58212, y: 25807, buffer });
  expect(tile.source).toBe("gsi");
  const isGsi = tile.source === "gsi";
  if (!isGsi) throw new Error("unexpected source");
  expect(tile.roads).toEqual([]);
  const ring = tile.water[0][0];
  expect(ring).toHaveLength(8);
  expect(new Set(ring.filter((_v, i) => i % 2 === 0))).toEqual(new Set([58212, 58213]));
  expect(new Set(ring.filter((_v, i) => i % 2 === 1))).toEqual(new Set([25807, 25808]));
  expect(decodeVectorTile({ source: "pavement", z: 16, x: 1, y: 2, buffer })).toEqual({
    source: "pavement",
    polygons: [],
  });
});

it("transfers Float64 coordinates without rounding, losing signed zero, or changing empty rings", () => {
  const tile: DecodedVectorTile = {
    source: "gsi",
    roads: [
      {
        coords: [
          -0,
          NaN,
          Infinity,
          -Infinity,
          139.767125 + Number.EPSILON * 128,
          35.681236 + Number.EPSILON * 32,
        ],
        width: 8,
        oneway: -1,
        kind: "local",
        bridge: false,
      },
    ],
    water: [[], [[]], [[-0, 1.0000000000000002]]],
  };
  expect(unpack(tile)).toEqual(tile);
});
