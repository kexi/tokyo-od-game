/**
 * The terrain chunk's collider triangles with the water and the expressway's cut-outs taken away
 * (terrain.ts). Pure: grid indices and positions in, a trimesh out.
 *
 * Water drops only the triangles wholly on it (all three corners and the middle): the shore and
 * streams narrower than the ~15 m grid keep their ground. A cut-out (P9, groundCuts.ts) is narrower
 * than a grid cell too, but a triangle spanning it would roof the cut over, and dropping every
 * triangle it touches left the ground beside a portal without a collider for up to 15 m (cars on the
 * streets there fell through: review of P9, C1). So a triangle the cut-out touches is split into
 * CUT_SUBDIVISIONS² pieces on its own plane (the same heights the drawn ground has), and the pieces
 * clear of the cut-out are kept: the ground keeps its collider to within a piece (~1 m) of the hole.
 */

/** Pieces a side of a triangle the cut-out touches (a 15.5 m cell → ~1 m pieces). */
export const CUT_SUBDIVISIONS = 16;

/** Whether a point of the chunk's grid (i, j in 0…S, fractional) is on water / in a cut-out. */
export type GridTest = (i: number, j: number) => boolean;

/**
 * A cut-out's test, with `near`: whether a grid box (i0, j0)–(i1, j1) meets any hole's bounding box.
 * Without it every triangle of the chunk would be tested at all its pieces' corners.
 */
export type CutGridTest = GridTest & { near(i0: number, j0: number, i1: number, j1: number): boolean };

export type ColliderMesh = { vertices: Float32Array; indices: Uint32Array };

/**
 * `positions` are the grid's (S + 1)² vertices (row j, column i: k = j·(S + 1) + i), `index` its
 * triangles. `isWet` / `isCut` test grid points (null: none of that kind in the chunk).
 */
export function colliderTriangles(
  positions: Float32Array,
  index: ArrayLike<number>,
  S: number,
  isWet: GridTest | null,
  isCut: CutGridTest | GridTest | null,
): ColliderMesh {
  const vertices: number[] = Array.from(positions);
  const indices: number[] = [];
  const gridOf = (k: number): [number, number] => [k % (S + 1), Math.floor(k / (S + 1))];
  const n = CUT_SUBDIVISIONS;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const ks = [index[t], index[t + 1], index[t + 2]];
    const corners = ks.map(gridOf);
    const ci = (corners[0][0] + corners[1][0] + corners[2][0]) / 3;
    const cj = (corners[0][1] + corners[1][1] + corners[2][1]) / 3;
    const isOnWater = isWet !== null && corners.every(([i, j]) => isWet(i, j)) && isWet(ci, cj);
    if (isOnWater) continue;
    const at = (a: number, b: number): [number, number] => {
      const c = n - a - b;
      return [
        (corners[0][0] * a + corners[1][0] * b + corners[2][0] * c) / n,
        (corners[0][1] * a + corners[1][1] * b + corners[2][1] * c) / n,
      ];
    };
    // Every corner of the pieces: a cut-out narrower than a piece can only slip between them.
    const i0 = Math.min(corners[0][0], corners[1][0], corners[2][0]);
    const i1 = Math.max(corners[0][0], corners[1][0], corners[2][0]);
    const j0 = Math.min(corners[0][1], corners[1][1], corners[2][1]);
    const j1 = Math.max(corners[0][1], corners[1][1], corners[2][1]);
    const isFar = isCut !== null && "near" in isCut && !isCut.near(i0, j0, i1, j1);
    const isTouched = isCut !== null && !isFar && touches(n, at, isCut);
    if (!isTouched) {
      indices.push(ks[0], ks[1], ks[2]);
      continue;
    }
    // Split on the triangle's plane; keep the pieces whose corners and middle are clear of the cut.
    const P = ks.map((k) => [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]]);
    const vertexAt = new Map<number, number>();
    const vertex = (a: number, b: number) => {
      const key = a * (n + 1) + b;
      const known = vertexAt.get(key);
      if (known !== undefined) return known;
      const c = n - a - b;
      const id = vertices.length / 3;
      for (let d = 0; d < 3; d++) vertices.push((P[0][d] * a + P[1][d] * b + P[2][d] * c) / n);
      vertexAt.set(key, id);
      return id;
    };
    const keep = (p: [number, number], q: [number, number], r: [number, number]) => {
      const pts = [p, q, r].map(([a, b]) => at(a, b));
      const mid: [number, number] = [
        (pts[0][0] + pts[1][0] + pts[2][0]) / 3,
        (pts[0][1] + pts[1][1] + pts[2][1]) / 3,
      ];
      const isClear = [...pts, mid].every(([i, j]) => !isCut!(i, j));
      if (isClear) indices.push(vertex(p[0], p[1]), vertex(q[0], q[1]), vertex(r[0], r[1]));
    };
    for (let a = 0; a < n; a++) {
      for (let b = 0; a + b < n; b++) {
        // Same winding as the parent (a → corner 0, b → corner 1, c → corner 2).
        keep([a + 1, b], [a, b + 1], [a, b]);
        const hasUpper = a + b + 2 <= n;
        if (hasUpper) keep([a + 1, b], [a + 1, b + 1], [a, b + 1]);
      }
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

/** Whether any corner of the n² pieces (barycentric a, b of the triangle; `at` → grid) is in the cut. */
function touches(n: number, at: (a: number, b: number) => [number, number], isCut: GridTest): boolean {
  for (let a = 0; a <= n; a++) {
    for (let b = 0; a + b <= n; b++) {
      const [i, j] = at(a, b);
      if (isCut(i, j)) return true;
    }
  }
  return false;
}
