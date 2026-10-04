// Geometry helpers on lon/lat polylines near Tokyo, shared by scripts/regulations.ts (build) and
// the game (sign placement). Pure functions: no three.js, no DOM.

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
        coords[i] + (coords[i + 2] - coords[i]) * t,
        coords[i + 1] + (coords[i + 3] - coords[i + 1]) * t,
        heading,
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
