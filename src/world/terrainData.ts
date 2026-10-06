import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import type { GeoidGrid } from "../data/schema";
import { geodeticToEcef } from "../geo/ellipsoid";
import { Geoid } from "../geo/geoid";
import { tileXToLon, tileYToLat } from "../geo/tiles";

type Point = [number, number, number];
export type TerrainInput = {
  x: number;
  y: number;
  zoom: number;
  segments: number;
  /** Northwest, northeast, southwest, southeast; retained by the DEM store. */
  tiles: Float32Array[];
  geoid: GeoidGrid | null;
};
export type TerrainData = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  centerEcef: Point;
  box: { min: Point; max: Point };
  sphere: { center: Point; radius: number };
};

function sampler(input: TerrainInput): (gx: number, gy: number) => number {
  const pixel = (gx: number, gy: number) => {
    const dx = Math.floor(gx / 256) - input.x;
    const dy = Math.floor(gy / 256) - input.y;
    const isOutside = dx < 0 || dx > 1 || dy < 0 || dy > 1;
    if (isOutside) return 0;
    const tile = input.tiles[dy * 2 + dx];
    const isMissing = !tile;
    if (isMissing) return 0;
    const px = ((gx % 256) + 256) % 256;
    const py = ((gy % 256) + 256) % 256;
    return tile[py * 256 + px];
  };
  return (gx, gy) => {
    const x0 = Math.floor(gx),
      y0 = Math.floor(gy);
    const tx = gx - x0,
      ty = gy - y0;
    const a = pixel(x0, y0),
      b = pixel(x0 + 1, y0);
    const c = pixel(x0, y0 + 1),
      d = pixel(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

/** Three's indexed accumulation and normalization, split without changing Float32 write order. */
function* normalsSteps(geometry: BufferGeometry): Generator<void, Float32Array> {
  const positions = geometry.getAttribute("position");
  const indices = geometry.getIndex()!;
  const normals = new BufferAttribute(new Float32Array(positions.count * 3), 3);
  const pA = new Vector3(),
    pB = new Vector3(),
    pC = new Vector3();
  const nA = new Vector3(),
    nB = new Vector3(),
    nC = new Vector3();
  const cb = new Vector3(),
    ab = new Vector3();
  for (let i = 0; i < indices.count; i += 3) {
    const isSlice = i % 1536 === 0;
    if (isSlice) yield;
    const a = indices.getX(i),
      b = indices.getX(i + 1),
      c = indices.getX(i + 2);
    pA.fromBufferAttribute(positions, a);
    pB.fromBufferAttribute(positions, b);
    pC.fromBufferAttribute(positions, c);
    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab);
    nA.fromBufferAttribute(normals, a);
    nB.fromBufferAttribute(normals, b);
    nC.fromBufferAttribute(normals, c);
    nA.add(cb);
    nB.add(cb);
    nC.add(cb);
    normals.setXYZ(a, nA.x, nA.y, nA.z);
    normals.setXYZ(b, nB.x, nB.y, nB.z);
    normals.setXYZ(c, nC.x, nC.y, nC.z);
  }
  for (let i = 0; i < normals.count; i++) {
    const isSlice = i % 512 === 0;
    if (isSlice) yield;
    nA.fromBufferAttribute(normals, i).normalize();
    normals.setXYZ(i, nA.x, nA.y, nA.z);
  }
  return normals.array as Float32Array;
}

export function* terrainSteps(input: TerrainInput): Generator<void, TerrainData> {
  const { x, y, zoom, segments: S } = input;
  const sample = sampler(input);
  const geoid = new Geoid(input.geoid);
  const c = geodeticToEcef(tileYToLat(y + 0.5, zoom), tileXToLon(x + 0.5, zoom), 40);
  const positions = new Float32Array((S + 1) * (S + 1) * 3);
  const uvs = new Float32Array((S + 1) * (S + 1) * 2);
  for (let j = 0; j <= S; j++) {
    yield;
    const lat = tileYToLat(y + j / S, zoom);
    for (let i = 0; i <= S; i++) {
      const lon = tileXToLon(x + i / S, zoom);
      const orthometric = sample((x + i / S) * 256, (y + j / S) * 256);
      const p = geodeticToEcef(lat, lon, orthometric + geoid.undulation(lat, lon));
      const k = j * (S + 1) + i;
      positions[k * 3] = p.x - c.x;
      positions[k * 3 + 1] = p.y - c.y;
      positions[k * 3 + 2] = p.z - c.z;
      uvs[k * 2] = i / S;
      uvs[k * 2 + 1] = 1 - j / S;
    }
  }
  const indices = new Uint32Array(S * S * 6);
  let n = 0;
  for (let j = 0; j < S; j++) {
    yield;
    for (let i = 0; i < S; i++) {
      const a = j * (S + 1) + i,
        b = a + 1,
        c2 = a + S + 1,
        d = c2 + 1;
      indices.set([a, c2, b, b, c2, d], n);
      n += 6;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  const normals = yield* normalsSteps(geometry);
  yield;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!,
    sphere = geometry.boundingSphere!;
  return {
    positions,
    uvs,
    indices,
    normals,
    centerEcef: [c.x, c.y, c.z],
    box: { min: box.min.toArray() as Point, max: box.max.toArray() as Point },
    sphere: { center: sphere.center.toArray() as Point, radius: sphere.radius },
  };
}

export function computeTerrain(input: TerrainInput): TerrainData {
  const steps = terrainSteps(input);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}
