// Minimal ZIP + ESRI Shapefile (polygon) + dBASE readers — enough for e-Stat boundary data
// without pulling a GIS dependency into the build.
import { inflateRawSync } from "node:zlib";

export function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  // End of central directory: last occurrence of 0x06054b50.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(start, start + compSize);
    files.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Polygon records as rings of [lon, lat] pairs (outer rings and holes mixed; use even-odd). */
export function readPolygons(shp: Buffer): number[][][] {
  const out: number[][][] = [];
  let p = 100;
  while (p + 8 <= shp.length) {
    const contentBytes = shp.readInt32BE(p + 4) * 2;
    const c = p + 8;
    const type = shp.readInt32LE(c);
    const rings: number[][] = [];
    if (type === 5) {
      const numParts = shp.readInt32LE(c + 36);
      const numPoints = shp.readInt32LE(c + 40);
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(shp.readInt32LE(c + 44 + i * 4));
      const pts = c + 44 + numParts * 4;
      for (let i = 0; i < numParts; i++) {
        const end = i + 1 < numParts ? parts[i + 1] : numPoints;
        const ring: number[] = [];
        for (let k = parts[i]; k < end; k++)
          ring.push(shp.readDoubleLE(pts + k * 16), shp.readDoubleLE(pts + k * 16 + 8));
        rings.push(ring);
      }
    }
    out.push(rings);
    p = c + contentBytes;
  }
  return out;
}

export function readDbf(dbf: Buffer, encoding = "shift_jis"): Record<string, string>[] {
  const records = dbf.readUInt32LE(4);
  const headerLen = dbf.readUInt16LE(8);
  const recordLen = dbf.readUInt16LE(10);
  const decoder = new TextDecoder(encoding);
  const fields: Array<{ name: string; len: number }> = [];
  for (let p = 32; dbf[p] !== 0x0d; p += 32) {
    const name = dbf.toString("latin1", p, p + 11).replace(/\0.*$/, "");
    fields.push({ name, len: dbf[p + 16] });
  }
  const rows: Record<string, string>[] = [];
  for (let r = 0; r < records; r++) {
    let p = headerLen + r * recordLen + 1; // skip deletion flag
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = decoder.decode(dbf.subarray(p, p + f.len)).trim();
      p += f.len;
    }
    rows.push(row);
  }
  return rows;
}

/** Douglas–Peucker on a flat [x0,y0,x1,y1,…] ring; keeps closure. */
export function simplifyRing(ring: number[], tolerance: number): number[] {
  const n = ring.length / 2;
  if (n <= 4) return ring;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const ax = ring[a * 2];
    const ay = ring[a * 2 + 1];
    const dx = ring[b * 2] - ax;
    const dy = ring[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1;
    let bestD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((ring[i * 2] - ax) * dy - (ring[i * 2 + 1] - ay) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) continue;
    keep[best] = 1;
    stack.push([a, best], [best, b]);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i * 2], ring[i * 2 + 1]);
  return out.length >= 8 ? out : ring;
}
