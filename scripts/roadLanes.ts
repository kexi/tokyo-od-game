// OSM lanes / width / oneway of the ordinary streets, read at build time for public/data/roadlanes
// (scripts/regulations.ts) and matched onto the GSI centrelines in the game (regulations.ts,
// knowledge/road-model.md). Pure functions, so the reading of each tag combination is tested.

/** Streets whose lanes the game takes (the expressway has its own data, src/expressway). */
export const ROAD_LANE_HIGHWAYS =
  /^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/;

/**
 * One way's lanes as stored in a tile (src/world/roadLanesData.ts): forward and backward lane counts
 * along the stored coords (0 = not mapped), 1 when the way is one-way, the OSM `width` in decimetres
 * (0 = none) and its `layer` (a bridge is 1: the game takes it only onto a GSI 橋).
 */
export type WayLanes = {
  forward: number;
  backward: number;
  oneway: 0 | 1;
  widthDm: number;
  layer: number;
  reversed: boolean;
};

const count = (v: string | undefined): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 && n < 12 ? n : 0;
};

/** OSM `width` in metres ("12", "12 m", "12.5m"); feet and other units are not read. */
export function widthMetres(v: string | undefined): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m)?\s*$/.exec(v ?? "");
  const metres = m ? Number(m[1]) : 0;
  // A road narrower than 2 m or wider than 80 m is a tagging slip (a lane width, a whole plaza).
  const isPlausible = metres >= 2 && metres <= 80;
  return isPlausible ? metres : 0;
}

/**
 * Lanes per direction from a way's tags, or null when the way has nothing the game reads. One-way
 * (`oneway=yes|1|-1`): every lane is forward (`-1` reverses the coords). Two-way: `lanes:forward`
 * and `lanes:backward`; with only `lanes`, the other side is the rest, or half each (rounded down,
 * at least 1: an odd count is usually a centre turn lane, which is not a through lane either way).
 */
export function wayLanes(tags: Record<string, string>): WayLanes | null {
  // Underground ways never lie on a GSI ground centreline (its tunnels are not in the game's roads).
  const layer = Number.parseInt(tags.layer ?? "0", 10) || 0;
  const isUnderground = (tags.tunnel !== undefined && tags.tunnel !== "no") || layer < 0;
  if (isUnderground) return null;
  const isOneway = ["yes", "1", "-1"].includes(tags.oneway ?? "");
  const total = count(tags.lanes);
  const fwd = count(tags["lanes:forward"]);
  const bwd = count(tags["lanes:backward"]);
  const widthDm = Math.round(widthMetres(tags.width) * 10);
  const hasAny = total + fwd + bwd + widthDm > 0;
  if (!hasAny) return null;
  const reversed = tags.oneway === "-1";
  if (isOneway) return { forward: fwd || total, backward: 0, oneway: 1, widthDm, layer, reversed };
  const half = total > 0 ? Math.max(1, Math.floor(total / 2)) : 0;
  const forward = fwd || (bwd && total > bwd ? total - bwd : half);
  const backward = bwd || (fwd && total > fwd ? total - fwd : half);
  return { forward, backward, oneway: 0, widthDm, layer, reversed: false };
}
