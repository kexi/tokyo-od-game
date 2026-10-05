import { Box3, BufferAttribute, Sphere, Vector3, type BufferGeometry } from "three";

/** Same area-weighted normals and bounds as Three.js, with checkpoints in the large loops. */
export function* roadGeometrySteps(g: BufferGeometry): Generator<void> {
  const p = g.getAttribute("position").array,
    index = g.getIndex()!.array;
  const normal = new Float32Array(p.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3,
      b = index[i + 1] * 3,
      c = index[i + 2] * 3;
    const abx = p[a] - p[b],
      aby = p[a + 1] - p[b + 1],
      abz = p[a + 2] - p[b + 2];
    const cbx = p[c] - p[b],
      cby = p[c + 1] - p[b + 1],
      cbz = p[c + 2] - p[b + 2];
    const x = cby * abz - cbz * aby,
      y = cbz * abx - cbx * abz,
      z = cbx * aby - cby * abx;
    for (const k of [a, b, c]) {
      normal[k] += x;
      normal[k + 1] += y;
      normal[k + 2] += z;
    }
    const checkpoint = i % 3072 === 0;
    if (checkpoint) yield;
  }
  const box = new Box3();
  const point = new Vector3();
  for (let i = 0; i < p.length; i += 3) {
    const n = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    normal[i] /= n;
    normal[i + 1] /= n;
    normal[i + 2] /= n;
    box.expandByPoint(point.set(p[i], p[i + 1], p[i + 2]));
    const checkpoint = i % 6144 === 0;
    if (checkpoint) yield;
  }
  const center = box.getCenter(new Vector3());
  let radius2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    radius2 = Math.max(radius2, point.set(p[i], p[i + 1], p[i + 2]).distanceToSquared(center));
    const checkpoint = i % 6144 === 0;
    if (checkpoint) yield;
  }
  g.setAttribute("normal", new BufferAttribute(normal, 3));
  g.boundingBox = box;
  g.boundingSphere = new Sphere(center, Math.sqrt(radius2));
}
