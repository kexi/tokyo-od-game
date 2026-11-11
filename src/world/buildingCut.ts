/**
 * Which PLATEAU buildings stand into an elevated deck, and how low each must be cut (buildings.ts
 * cutAboveDecks, deckCuts.ts). Pure, on local-frame arrays.
 *
 * How: a building (a feature of the tile, its batch id) stands into the deck when one of the
 * deck's cut points lies inside one of its roof triangles (seen from above) and the roof rises
 * above that point's soffit. Its ceiling is then CLEARANCE_M under the lowest such soffit, and
 * every vertex of the building above it comes down to it: the building keeps its walls and roof
 * (a closed box, now under the deck) and nothing of it is left in or over the deck.
 *
 * A building whose lowest point is CLEARANCE_HEIGHT (構造令 第12条, 4.5 m) or more over the deck's
 * road spans it (a deck between buildings, a corridor) and is left as it is.
 *
 * Why not drop the triangles over the deck (as cutFootprints does for landmarks): LOD1 walls are
 * single quads from the ground to the roof, so dropping them leaves a hollow shell, and keeping
 * them leaves the wall through the deck. Why not clip the building at the deck's outline: a
 * polygon clip of every tile's triangles costs far more than a test per roof triangle, for three
 * buildings in the test section (knowledge/expressway-generation.md).
 */

import { CLEARANCE_HEIGHT } from "../law/roadStandards";

/** A deck cut point in the local frame: x, z, the soffit's height y and the road's `top`. */
export type LocalCutPoint = { x: number; y: number; z: number; top: number };

/** How far under the soffit a cut building's roof ends (no z-fighting, no touching the girder). */
export const CLEARANCE_M = 0.3;
/** A roof triangle: its normal within ~45° of vertical (walls are vertical, roofs flat in LOD1). */
const ROOF_MIN_NY = 0.7;
const CELL_M = 4;

type Points = { cells: Map<string, LocalCutPoint[]>; minX: number; maxX: number; minZ: number; maxZ: number };

const cellKey = (x: number, z: number) => `${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`;

/** The cut points in a 4 m grid (found by a triangle's bounding box). */
export function indexCutPoints(points: readonly LocalCutPoint[]): Points {
  const cells = new Map<string, LocalCutPoint[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    const key = cellKey(p.x, p.z);
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { cells, minX, maxX, minZ, maxZ };
}

/** Whether (x, z) lies inside triangle a–b–c seen from above (either winding). */
function isInside(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
  const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
  const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/**
 * The ceiling (local y) of every feature that stands into a deck, by feature id. `x`, `y`, `z`
 * are the vertices in the local frame; `index` the triangles (null: non-indexed); `idOf` a
 * vertex's feature id.
 */
export function featureCeilings(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
  index: ArrayLike<number> | null,
  idOf: (vertex: number) => number,
  points: Points,
): Map<number, number> {
  const ceilings = new Map<number, number>();
  if (points.cells.size === 0) return ceilings;
  // Each feature's lowest vertex: a building standing on the deck's height or above it spans it.
  const lowest = new Map<number, number>();
  for (let i = 0; i < x.length; i++) {
    const id = idOf(i);
    lowest.set(id, Math.min(lowest.get(id) ?? Infinity, y[i]));
  }
  const tris = index ? index.length / 3 : x.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = index ? index[t * 3] : t * 3;
    const b = index ? index[t * 3 + 1] : t * 3 + 1;
    const c = index ? index[t * 3 + 2] : t * 3 + 2;
    const x0 = Math.min(x[a], x[b], x[c]);
    const x1 = Math.max(x[a], x[b], x[c]);
    const z0 = Math.min(z[a], z[b], z[c]);
    const z1 = Math.max(z[a], z[b], z[c]);
    const isAway = x1 < points.minX || x0 > points.maxX || z1 < points.minZ || z0 > points.maxZ;
    if (isAway) continue;
    // Normal's vertical share: |(b − a) × (c − a)|.y over its length.
    const ux = x[b] - x[a];
    const uy = y[b] - y[a];
    const uz = z[b] - z[a];
    const vx = x[c] - x[a];
    const vy = y[c] - y[a];
    const vz = z[c] - z[a];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    const isRoof = length > 1e-9 && Math.abs(ny) / length >= ROOF_MIN_NY;
    if (!isRoof) continue;
    const top = Math.max(y[a], y[b], y[c]);
    for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++)
      for (let cz = Math.floor(z0 / CELL_M); cz <= Math.floor(z1 / CELL_M); cz++) {
        for (const p of points.cells.get(`${cx},${cz}`) ?? []) {
          const isAboveSoffit = top > p.y - CLEARANCE_M;
          if (!isAboveSoffit) continue;
          if (!isInside(p.x, p.z, x[a], z[a], x[b], z[b], x[c], z[c])) continue;
          const id = idOf(a);
          const isSpanning = (lowest.get(id) ?? -Infinity) >= p.top + CLEARANCE_HEIGHT.value;
          if (isSpanning) continue;
          const ceiling = p.y - CLEARANCE_M;
          ceilings.set(id, Math.min(ceilings.get(id) ?? Infinity, ceiling));
        }
      }
  }
  return ceilings;
}
