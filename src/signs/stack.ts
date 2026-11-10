/**
 * Where the plates of one post go, top to bottom: each plate with its 補助標識 right under it.
 * Pure (heights in, centre heights out) so src/world/signs.ts and the tests share it; the seed of
 * design 4's resolveMount (G4), which will add the supports and the heights the 設置基準 asks for.
 *
 * Why the 補助標識 go right under their own plate and not all under the lowest one, as the Canvas
 * notes did: on a shared post the lowest plate may be another sign (the ward's 通学路 plate under a
 * timed 歩行者専用), and the hours would read as its own.
 */

/** Ground to the centre of the top plate, m. */
export const POST_TOP = 2.6;
/** Usual spacing of plate centres on a post, m (a 60 cm plate at 1.25× and a gap). */
export const STACK = 1.0;
/** Between a plate and the 補助標識 under it, and above a plate pushed down by one, m. */
export const AUX_GAP = 0.06;

/** A plate as drawn (scaled) and the 補助標識 under it, top to bottom: heights in metres. */
export type StackInput = { height: number; aux: readonly number[] };

/** One placed face: which plate (and which of its 補助標識, or null for the plate) and its centre height. */
export type StackPlace = { plate: number; aux: number | null; y: number; height: number };

export type StackResult = {
  placed: StackPlace[];
  /** Faces left off because they would reach below the ground (and everything under them). */
  dropped: number;
};

/**
 * A plate keeps its usual height (POST_TOP − level × STACK) unless what hangs above reaches it;
 * then it goes AUX_GAP under that. A face whose lower edge would go below the ground is left off,
 * with every face under it.
 *
 * Why not shrink or re-space to fit: the heights the 設置基準 asks for (lower edge 1.8 m on the
 * roadside, 2.5 m over a pavement) are G4's; until then the posts keep the layout they had, and
 * the few that do not fit show their upper plates only.
 */
export function stackPlates(plates: readonly StackInput[]): StackResult {
  const placed: StackPlace[] = [];
  const total = plates.reduce((n, p) => n + 1 + p.aux.length, 0);
  let bottom = Number.POSITIVE_INFINITY;
  for (const [level, p] of plates.entries()) {
    const y = Math.min(POST_TOP - level * STACK, bottom - AUX_GAP - p.height / 2);
    const isUnderground = y - p.height / 2 < 0;
    if (isUnderground) break;
    placed.push({ plate: level, aux: null, y, height: p.height });
    bottom = y - p.height / 2;
    for (const [i, h] of p.aux.entries()) {
      const auxY = bottom - AUX_GAP - h / 2;
      const isAuxUnderground = auxY - h / 2 < 0;
      if (isAuxUnderground) return { placed, dropped: total - placed.length };
      placed.push({ plate: level, aux: i, y: auxY, height: h });
      bottom = auxY - h / 2;
    }
  }
  return { placed, dropped: total - placed.length };
}
