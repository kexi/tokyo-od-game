import type { BufferGeometry, Matrix4, Vector3 } from "three";

type Footprint = { ring: readonly Vector3[]; x0: number; x1: number; z0: number; z1: number };

/** Synchronous scratch belongs to the cutter, not to any tile's rendering or physics arrays. */
export class BuildingFootprints {
  private footprints: Footprint[] = [];
  private lx = new Float32Array(0);
  private lz = new Float32Array(0);

  setRings(rings: readonly (readonly Vector3[])[]): void {
    this.footprints = rings.map((ring) => {
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const p of ring) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
      }
      return { ring, x0, x1, z0, z1 };
    });
  }

  cut(geometry: BufferGeometry, ecef: Float32Array, matrix: Matrix4): number {
    const hasFootprints = this.footprints.length > 0;
    if (!hasFootprints) return 0;
    const n = ecef.length / 3;
    const needsScratch = this.lx.length < n;
    if (needsScratch) {
      this.lx = new Float32Array(n);
      this.lz = new Float32Array(n);
    }
    const m = matrix.elements,
      lx = this.lx,
      lz = this.lz;
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = ecef[i * 3],
        y = ecef[i * 3 + 1],
        z = ecef[i * 3 + 2];
      lx[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      lz[i] = m[2] * x + m[6] * y + m[10] * z + m[14];
      // Bounds use the same Float32 values as the centre test; unrounded ECEF bounds can miss an edge.
      const isFinite = Number.isFinite(lx[i]) && Number.isFinite(lz[i]);
      if (!isFinite) continue;
      x0 = Math.min(x0, lx[i]);
      x1 = Math.max(x1, lx[i]);
      z0 = Math.min(z0, lz[i]);
      z1 = Math.max(z1, lz[i]);
    }
    const candidates = this.footprints.filter((f) => {
      const isOutside = x1 < f.x0 || x0 > f.x1 || z1 < f.z0 || z0 > f.z1;
      return !isOutside;
    });
    const isUnrelated = candidates.length === 0;
    if (isUnrelated) return 0;
    const inside = (x: number, z: number) =>
      candidates.some((f) => {
        const isOutside = x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1;
        if (isOutside) return false;
        let isIn = false;
        const ring = f.ring;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          const crosses = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
          if (crosses) isIn = !isIn;
        }
        return isIn;
      });
    const index = geometry.getIndex(),
      position = geometry.getAttribute("position"),
      tris = index ? index.count / 3 : n / 3;
    let cut = 0;
    for (let t = 0; t < tris; t++) {
      const a = index ? index.getX(t * 3) : t * 3,
        b = index ? index.getX(t * 3 + 1) : t * 3 + 1,
        c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const isInside = inside((lx[a] + lx[b] + lx[c]) / 3, (lz[a] + lz[b] + lz[c]) / 3);
      if (!isInside) continue;
      cut++;
      const isIndexed = index !== null;
      if (isIndexed) {
        index.setX(t * 3 + 1, a);
        index.setX(t * 3 + 2, a);
      } else {
        position.setXYZ(b, position.getX(a), position.getY(a), position.getZ(a));
        position.setXYZ(c, position.getX(a), position.getY(a), position.getZ(a));
      }
    }
    const changedIndex = cut > 0 && index !== null,
      changedPosition = cut > 0 && index === null;
    if (changedIndex) index.needsUpdate = true;
    else if (changedPosition) position.needsUpdate = true;
    return cut;
  }
}
