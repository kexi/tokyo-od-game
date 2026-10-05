import { Vector3, type BufferAttribute, type Matrix4 } from "three";

const CELL = 32;

/** Exact vertical intersections with the rendered triangles, indexed in local XZ. */
export class TerrainHeight {
  private readonly vertices: Float32Array;
  private readonly cells: number[][];
  private readonly minX: number;
  private readonly minZ: number;
  private readonly nx: number;
  private readonly nz: number;

  constructor(
    position: BufferAttribute,
    private readonly indices: ArrayLike<number>,
    matrix: Matrix4,
  ) {
    this.vertices = new Float32Array(position.count * 3);
    const p = new Vector3();
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.vertices.set([p.x, p.y, p.z], i * 3);
      minX = Math.min(minX, this.vertices[i * 3]);
      maxX = Math.max(maxX, this.vertices[i * 3]);
      minZ = Math.min(minZ, this.vertices[i * 3 + 2]);
      maxZ = Math.max(maxZ, this.vertices[i * 3 + 2]);
    }
    this.minX = minX;
    this.minZ = minZ;
    this.nx = Math.floor((maxX - minX) / CELL) + 1;
    this.nz = Math.floor((maxZ - minZ) / CELL) + 1;
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    const v = this.vertices;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3,
        b = indices[t + 1] * 3,
        c = indices[t + 2] * 3;
      const x0 = Math.floor((Math.min(v[a], v[b], v[c]) - minX) / CELL);
      const x1 = Math.floor((Math.max(v[a], v[b], v[c]) - minX) / CELL);
      const z0 = Math.floor((Math.min(v[a + 2], v[b + 2], v[c + 2]) - minZ) / CELL);
      const z1 = Math.floor((Math.max(v[a + 2], v[b + 2], v[c + 2]) - minZ) / CELL);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[z * this.nx + x].push(t);
    }
  }

  at(x: number, z: number): number | null {
    const cellX = Math.floor((x - this.minX) / CELL),
      cellZ = Math.floor((z - this.minZ) / CELL);
    const outside = cellX < 0 || cellZ < 0 || cellX >= this.nx || cellZ >= this.nz;
    if (outside) return null;
    const v = this.vertices;
    for (const t of this.cells[cellZ * this.nx + cellX]) {
      const a = this.indices[t] * 3,
        b = this.indices[t + 1] * 3,
        c = this.indices[t + 2] * 3;
      const bx = v[b] - v[a],
        bz = v[b + 2] - v[a + 2];
      const cx = v[c] - v[a],
        cz = v[c + 2] - v[a + 2];
      const det = bx * cz - bz * cx;
      const degenerate = Math.abs(det) < 1e-12;
      if (degenerate) continue;
      const dx = x - v[a],
        dz = z - v[a + 2];
      const u = (dx * cz - dz * cx) / det,
        w = (bx * dz - bz * dx) / det;
      const inside = u >= -1e-9 && w >= -1e-9 && u + w <= 1 + 1e-9;
      if (inside) return v[a + 1] + u * (v[b + 1] - v[a + 1]) + w * (v[c + 1] - v[a + 1]);
    }
    return null;
  }
}
