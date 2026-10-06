import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { tileXToLon, tileYToLat } from "../geo/tiles";
import type { RoadLine } from "./roads";
import type { WaterPolygon } from "./waterGeometry";
import type { PavementPolygon } from "./pavements";
import { polygonsOf } from "./vectorTilePolygons";

export type VectorTileInput = {
  source: "gsi" | "pavement";
  z: number;
  x: number;
  y: number;
  buffer: ArrayBuffer;
};
export type GsiVectorTile = { source: "gsi"; roads: RoadLine[]; water: WaterPolygon[] };
export type DecodedVectorTile = GsiVectorTile | { source: "pavement"; polygons: PavementPolygon[] };
type PackedPolygons = { coordinates: Float64Array; ringOffsets: Uint32Array; polygonOffsets: Uint32Array };
export type VectorTilePacket =
  | {
      source: "gsi";
      roads: PackedPolygons;
      roadFields: Array<Omit<RoadLine, "coords">>;
      water: PackedPolygons;
    }
  | { source: "pavement"; polygons: PackedPolygons; kinds: Uint8Array };

const WIDTH_BY_RANK = [2.5, 4.3, 9, 16, 22];
function kindOf(rdCtg: number, motorway: number): RoadLine["kind"] {
  const isHighway = rdCtg === 3 || motorway === 1;
  if (isHighway) return "highway";
  const isNational = rdCtg === 0;
  if (isNational) return "national";
  const isPrefectural = rdCtg === 1;
  if (isPrefectural) return "prefectural";
  return "local";
}

/** Filter and transform the same features; raw PBF and temporary Point objects stay in the worker. */
export function* decodeVectorTileSteps(input: VectorTileInput): Generator<void, DecodedVectorTile> {
  const { x, y, z } = input;
  const tile = new VectorTile(new Pbf(new Uint8Array(input.buffer)));
  const isGsi = input.source === "gsi";
  if (isGsi) {
    const roads: RoadLine[] = [],
      water: WaterPolygon[] = [];
    const layer = tile.layers.road;
    const hasRoads = layer !== undefined;
    if (hasRoads) {
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i),
          p = f.properties as Record<string, number>;
        const isCentreline = Math.floor(p.ftCode / 100) === 27;
        const isGround = (p.lvOrder ?? 0) === 0;
        const isWanted = isCentreline && isGround && f.type === 2;
        if (!isWanted) {
          yield;
          continue;
        }
        const width = p.Width && p.Width > 0 ? p.Width : (WIDTH_BY_RANK[p.rnkWidth] ?? 4.3);
        for (const ring of f.loadGeometry()) {
          const coords: number[] = [];
          for (let point = 0; point < ring.length; point++) {
            const pt = ring[point];
            coords.push(tileXToLon(x + pt.x / layer.extent, z), tileYToLat(y + pt.y / layer.extent, z));
            const checkpoint = (point + 1) % 128 === 0;
            if (checkpoint) yield;
          }
          const isLine = coords.length >= 4;
          if (isLine)
            roads.push({
              coords,
              width,
              oneway: 0,
              kind: kindOf(p.rdCtg, p.motorway),
              bridge: p.ftCode === 2703,
            });
        }
        yield;
      }
    }
    const waterarea = tile.layers.waterarea;
    const hasWater = waterarea !== undefined;
    if (hasWater) {
      for (let i = 0; i < waterarea.length; i++) {
        const f = waterarea.feature(i);
        const isPolygon = f.type === 3;
        if (isPolygon) {
          for (const poly of polygonsOf(f.loadGeometry(), waterarea.extent))
            water.push(
              poly.map((ring) =>
                ring.flatMap((pt) => [x + pt.x / waterarea.extent, y + pt.y / waterarea.extent]),
              ),
            );
        }
        yield;
      }
    }
    return { source: "gsi", roads, water };
  }
  const polygons: PavementPolygon[] = [];
  for (const [name, wanted, kind] of [
    ["TrafficArea", "歩道部", "sidewalk"],
    ["AuxiliaryTrafficArea", "島", "island"],
  ] as const) {
    const layer = tile.layers[name];
    const isMissing = layer === undefined;
    if (isMissing) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const isWanted = f.type === 3 && f.properties.tran_function === wanted;
      if (isWanted)
        for (const rings of polygonsOf(f.loadGeometry(), layer.extent))
          polygons.push({
            kind,
            rings: rings.map((ring) =>
              ring.flatMap((pt) => [
                tileXToLon(x + pt.x / layer.extent, z),
                tileYToLat(y + pt.y / layer.extent, z),
              ]),
            ),
          });
      yield;
    }
  }
  return { source: "pavement", polygons };
}

export function decodeVectorTile(input: VectorTileInput): DecodedVectorTile {
  const steps = decodeVectorTileSteps(input);
  for (;;) {
    const next = steps.next();
    const done = next.done;
    if (done) return next.value;
  }
}

function packPolygons(polygons: number[][][]): PackedPolygons {
  let rings = 0,
    values = 0;
  for (const poly of polygons) {
    rings += poly.length;
    for (const ring of poly) values += ring.length;
  }
  const coordinates = new Float64Array(values),
    ringOffsets = new Uint32Array(rings + 1),
    polygonOffsets = new Uint32Array(polygons.length + 1);
  let ring = 0,
    offset = 0;
  for (let p = 0; p < polygons.length; p++) {
    polygonOffsets[p] = ring;
    for (const points of polygons[p]) {
      ringOffsets[ring++] = offset;
      coordinates.set(points, offset);
      offset += points.length;
    }
  }
  ringOffsets[ring] = offset;
  polygonOffsets[polygons.length] = ring;
  return { coordinates, ringOffsets, polygonOffsets };
}

export function packVectorTile(tile: DecodedVectorTile): VectorTilePacket {
  const isGsi = tile.source === "gsi";
  if (isGsi)
    return {
      source: "gsi",
      roads: packPolygons(tile.roads.map((line) => [line.coords])),
      roadFields: tile.roads.map(({ coords: _coords, ...fields }) => fields),
      water: packPolygons(tile.water),
    };
  return {
    source: "pavement",
    polygons: packPolygons(tile.polygons.map((poly) => poly.rings)),
    kinds: Uint8Array.from(tile.polygons, (poly) => (poly.kind === "sidewalk" ? 0 : 1)),
  };
}

function* unpackPolygons(data: PackedPolygons): Generator<void, number[][][]> {
  const polygons: number[][][] = [];
  for (let p = 0; p + 1 < data.polygonOffsets.length; p++) {
    const rings: number[][] = [];
    for (let r = data.polygonOffsets[p]; r < data.polygonOffsets[p + 1]; r++) {
      const ring: number[] = [];
      for (let i = data.ringOffsets[r]; i < data.ringOffsets[r + 1]; i++) {
        ring.push(data.coordinates[i]);
        const checkpoint = (i + 1) % 256 === 0;
        if (checkpoint) yield;
      }
      rings.push(ring);
      yield;
    }
    polygons.push(rings);
  }
  return polygons;
}

export function* unpackVectorTileSteps(packet: VectorTilePacket): Generator<void, DecodedVectorTile> {
  const isGsi = packet.source === "gsi";
  if (isGsi) {
    const lines = yield* unpackPolygons(packet.roads),
      water = yield* unpackPolygons(packet.water);
    const roads: RoadLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      roads.push({ coords: lines[i][0], ...packet.roadFields[i] });
      const checkpoint = (i + 1) % 128 === 0;
      if (checkpoint) yield;
    }
    return { source: "gsi", roads, water };
  }
  const rings = yield* unpackPolygons(packet.polygons),
    polygons: PavementPolygon[] = [];
  for (let i = 0; i < rings.length; i++) {
    polygons.push({ kind: packet.kinds[i] === 0 ? "sidewalk" : "island", rings: rings[i] });
    const checkpoint = (i + 1) % 128 === 0;
    if (checkpoint) yield;
  }
  return { source: "pavement", polygons };
}

export function vectorTileTransfers(packet: VectorTilePacket): ArrayBuffer[] {
  const isGsi = packet.source === "gsi";
  const shapes = isGsi ? [packet.roads, packet.water] : [packet.polygons];
  const buffers = shapes.flatMap((s) => [
    s.coordinates.buffer,
    s.ringOffsets.buffer,
    s.polygonOffsets.buffer,
  ]);
  if (!isGsi) buffers.push(packet.kinds.buffer);
  return buffers as ArrayBuffer[];
}
