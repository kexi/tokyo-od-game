// Texture-array layers, in this order.
export const STYLES = [
  "office_glass",
  "office_concrete",
  "office_tile",
  "apartment_balcony",
  "apartment_small",
  "mixed_use",
  "metal_panel",
  "brick",
] as const;
export const S = Object.fromEntries(STYLES.map((name, i) => [name, i])) as Record<
  (typeof STYLES)[number],
  number
>;
// Weighted choices by building height (Tokyo: towers are glass or concrete offices, mid-rises
// mix offices and condominiums, low buildings are small apartments, 雑居ビル and warehouses).
const BY_HEIGHT: Array<[maxHeight: number, choices: Array<[number, number]>]> = [
  [
    12,
    [
      [S.apartment_small, 4],
      [S.mixed_use, 3],
      [S.metal_panel, 2],
      [S.brick, 1],
    ],
  ],
  [
    30,
    [
      [S.apartment_balcony, 3],
      [S.mixed_use, 3],
      [S.office_tile, 2],
      [S.apartment_small, 2],
    ],
  ],
  [
    60,
    [
      [S.office_concrete, 3],
      [S.office_tile, 2.5],
      [S.apartment_balcony, 2.5],
      [S.office_glass, 2],
    ],
  ],
  [
    Infinity,
    [
      [S.office_glass, 6],
      [S.office_concrete, 4],
    ],
  ],
];

const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/** Identical vertex order and Float32 rounding, shared by the worker and yielding fallback. */
export function* facadeAttributeSteps(
  count: number,
  ecef: Float32Array,
  idAt: ((vertex: number) => number) | null,
): Generator<void, Float32Array> {
  // Local "up" for the tile: the radial direction at its centre (≤0.2° from the ellipsoid normal).
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    const isChunkStart = i % 4096 === 0;
    if (isChunkStart) yield;
    cx += ecef[i * 3];
    cy += ecef[i * 3 + 1];
    cz += ecef[i * 3 + 2];
  }
  const len = Math.hypot(cx, cy, cz) || 1;
  const [ux, uy, uz] = [cx / len, cy / len, cz / len];
  const heights = new Float32Array(count);
  const low = new Map<number, number>();
  const high = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const isChunkStart = i % 4096 === 0;
    if (isChunkStart) yield;
    const h = ecef[i * 3] * ux + ecef[i * 3 + 1] * uy + ecef[i * 3 + 2] * uz;
    heights[i] = h;
    const id = idAt ? Math.round(idAt(i)) : 0;
    low.set(id, Math.min(low.get(id) ?? Infinity, h));
    high.set(id, Math.max(high.get(id) ?? -Infinity, h));
  }
  // A tile-wide seed so the same batch id in different tiles gets an independent style.
  const seed = Math.round(cx / count) ^ Math.round(cz / count);
  const style = new Map<number, number>();
  let styled = 0;
  for (const [id, lo] of low) {
    const isStyleChunk = styled++ % 256 === 0;
    if (isStyleChunk) yield;
    const tall = (high.get(id) ?? lo) - lo;
    const choices = (BY_HEIGHT.find(([limit]) => tall <= limit) ?? BY_HEIGHT[BY_HEIGHT.length - 1])[1];
    const total = choices.reduce((n, [, w]) => n + w, 0);
    let r = hash(seed, id) * total;
    let pick = choices[0][0];
    for (const [s, w] of choices) {
      const isPicked = r < w;
      if (isPicked) {
        pick = s;
        break;
      }
      r -= w;
    }
    style.set(id, pick + 0.05 + 0.9 * hash(id, seed + 1)); // fractional part: brightness tint
  }
  const attr = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const isChunkStart = i % 4096 === 0;
    if (isChunkStart) yield;
    const id = idAt ? Math.round(idAt(i)) : 0;
    attr[i * 2] = style.get(id) ?? 0.5;
    attr[i * 2 + 1] = heights[i] - (low.get(id) ?? heights[i]);
  }
  return attr;
}
