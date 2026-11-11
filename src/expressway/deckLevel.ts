import { STATION_STRIDE, type XwChunk } from "./format";
import { planeAt } from "./geo";

/**
 * Which level of deck a point of a chunk is on: 1 over the streets, one more for every deck it
 * stands over there (`decks` with relation "above"). The signs carry it (signPlan.ts) and the game
 * asks it of the chunk under the car (ExpresswayDecks.levelAt), so a board and the driver on the
 * same deck are on the same level (BoardFacePool ranks another level last). One definition: G6
 * review W2 found the planner's "1 + decks below" against the game's "on a deck: 1".
 */
export function deckLevelAt(chunk: Pick<XwChunk, "decks">, s: number): number {
  return 1 + chunk.decks.filter((d) => d.relation === "above" && s >= d.s0 - 1 && s <= d.s1 + 1).length;
}

/**
 * The run distance and signed lateral offset (+ left of travel, m) of a point from a chunk's centre
 * line, or null when it projects outside the chunk.
 */
export function nearestOnChunk(c: XwChunk, lon: number, lat: number): { s: number; lateral: number } | null {
  const plane = planeAt(lon, lat);
  let best: { s: number; lateral: number; d: number } | null = null;
  for (let i = 0; i + STATION_STRIDE < c.st.length; i += STATION_STRIDE) {
    const [ax, ay] = plane.toXY(c.st[i + 1], c.st[i + 2]);
    const [bx, by] = plane.toXY(c.st[i + STATION_STRIDE + 1], c.st[i + STATION_STRIDE + 2]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) continue;
    const t = (-ax * dx - ay * dy) / len2;
    if (t < 0 || t > 1) continue;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = Math.hypot(px, py);
    const lateral = (dx * -ay - dy * -ax) / Math.sqrt(len2);
    if (!best || d < best.d) best = { s: c.st[i] + (c.st[i + STATION_STRIDE] - c.st[i]) * t, lateral, d };
  }
  return best ? { s: best.s, lateral: best.lateral } : null;
}
