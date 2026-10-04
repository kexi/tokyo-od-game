// JARTIC 交通規制情報 (typeD, 拡張版 K 2.1) CSV helpers, shared by the build script and tests.

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Streaming RFC 4180 parser over Shift_JIS bytes: the Tokyo file is ~400 MB, so rows are handed
 * to `onRow` as they complete instead of materialising one huge string.
 */
export function streamCsv(bytes: Uint8Array, onRow: (row: string[]) => void, chunk = 8 * 1024 * 1024): void {
  const decoder = new TextDecoder("shift_jis");
  const CHUNK = chunk;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let pendingQuote = false; // saw a quote inside quotes; next char decides escape vs close
  for (let off = 0; off < bytes.length; off += CHUNK) {
    const text = decoder.decode(bytes.subarray(off, off + CHUNK), { stream: off + CHUNK < bytes.length });
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') {
          field += '"';
          continue;
        }
        inQuotes = false;
      }
      if (inQuotes) {
        if (c === '"') pendingQuote = true;
        else field += c;
        continue;
      }
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
        onRow(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    onRow(row);
  }
}

/** JARTIC 「経度 緯度;経度 緯度;…」 → [lon, lat, …], rounded to ~0.1 m. */
export function parseCoords(s: string): number[] {
  const out: number[] = [];
  for (const pair of s.split(";")) {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push(round(lon), round(lat));
  }
  return out;
}

export const M_LON = 111_320 * Math.cos((35.7 * Math.PI) / 180);
export const M_LAT = 110_540;

/**
 * Sign anchors along a regulated line for traffic travelling in coordinate order: 3 m into the
 * section, then every `spacing` metres (signs are repeated along long sections).
 */
export function anchors(coords: number[], spacing: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  let next = 3;
  let walked = 0;
  for (let i = 0; i + 3 < coords.length; i += 2) {
    const dx = (coords[i + 2] - coords[i]) * M_LON;
    const dy = (coords[i + 3] - coords[i + 1]) * M_LAT;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    while (next <= walked + len) {
      const t = (next - walked) / len;
      out.push([
        round(coords[i] + (coords[i + 2] - coords[i]) * t),
        round(coords[i + 1] + (coords[i + 3] - coords[i + 1]) * t),
        Math.round(heading),
      ]);
      next += spacing;
    }
    walked += len;
  }
  return out;
}

export const reversed = (coords: number[]) => {
  const out: number[] = [];
  for (let i = coords.length - 2; i >= 0; i -= 2) out.push(coords[i], coords[i + 1]);
  return out;
};

/**
 * 指定方向外進行禁止: allowed exits relative to the approach (entry point → junction centre),
 * as a mask of 1 left, 2 straight, 4 right.
 */
export function turnMask(center: number[], entry: number[], exits: number[]): number {
  const hx = (center[0] - entry[0]) * M_LON;
  const hy = (center[1] - entry[1]) * M_LAT;
  let mask = 0;
  for (let i = 0; i + 1 < exits.length; i += 2) {
    const vx = (exits[i] - center[0]) * M_LON;
    const vy = (exits[i + 1] - center[1]) * M_LAT;
    const angle = (Math.atan2(hx * vy - hy * vx, hx * vx + hy * vy) * 180) / Math.PI; // + = left (CCW)
    mask |= angle > 35 ? 1 : angle < -35 ? 4 : 2;
  }
  return mask;
}
