import { Vector3 } from "three";
import { isOnGround } from "./roadClass";
import { DECK_REACH, type RoadGraph, type Segment } from "./roads";

/**
 * The expressway surfaces over a point on the street, from the road graph's deck segments (their
 * own heights, Segment.elev), for what stands on the street: a street light, a signal or an orbis
 * pole under a viaduct must not stand up through the deck the cars drive on.
 *
 * Why the graph and not a ray onto the deck colliders: the decks' colliders are built only near the
 * player's car, so a pole checked before they streamed in kept standing through the deck, and the
 * car on the deck hit it (24402611:27, knowledge/expressway-generation.md「床版の走行検査が
 * 24402611:27 で一瞬止まる」). The graph has every deck the network has, at the time it is built.
 *
 * How: one bounding box per deck segment (its points ± half its width + MAX_MARGIN), so a point
 * far from every deck costs a few comparisons; only the segments whose box holds the point are
 * projected onto (RoadGraph.nearestOn). Why not project onto every deck: 1,000+ lamps × ~100 deck
 * segments made the street lights' rebuild 20 times slower (review of #70).
 */

/** The widest `margin` surfacesOver may be asked for (m past a deck's carriageway edge). */
export const MAX_MARGIN = DECK_REACH + 0.5;

type DeckGraph = Pick<RoadGraph, "segments" | "nearestOn" | "surfaceY">;
type Box = { seg: Segment; minX: number; maxX: number; minZ: number; maxZ: number };

export class DeckOverhead {
  private readonly boxes: Box[] = [];
  private readonly p = new Vector3();

  constructor(private readonly graph: DeckGraph) {
    for (const seg of graph.segments) {
      // Ground roads have no heights of their own (surfaceY is the terrain).
      const isDeck = !isOnGround(seg.line) && seg.elev !== undefined;
      if (!isDeck) continue;
      const reach = seg.line.width / 2 + MAX_MARGIN;
      const box = { seg, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const q of seg.pts) {
        box.minX = Math.min(box.minX, q.x - reach);
        box.maxX = Math.max(box.maxX, q.x + reach);
        box.minZ = Math.min(box.minZ, q.z - reach);
        box.maxZ = Math.max(box.maxZ, q.z + reach);
      }
      this.boxes.push(box);
    }
  }

  /** Whether the graph has any deck at all (most of the city: none, and nothing to ask). */
  get isEmpty(): boolean {
    return this.boxes.length === 0;
  }

  /**
   * The surface heights (graph frame, m) of every deck, tunnel or cut whose carriageway plus
   * `margin` (≤ MAX_MARGIN) covers (x, z). Several where a viaduct and a tunnel cross: the caller
   * decides which matter (a tunnel under the street is not in a pole's way).
   */
  surfacesOver(x: number, z: number, margin: number): number[] {
    const out: number[] = [];
    const p = this.p.set(x, 0, z);
    for (const b of this.boxes) {
      const isOutside = x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;
      if (isOutside) continue;
      const on = this.graph.nearestOn(b.seg, p);
      const isOver = on.dist < b.seg.line.width / 2 + margin;
      if (!isOver) continue;
      const y = this.graph.surfaceY(b.seg, on.s);
      if (y !== null) out.push(y);
    }
    return out;
  }
}

/**
 * Whether a pole from `foot` up to `top` would reach a car on one of `surfaces`: the surface is above
 * the pole's foot (a tunnel below the street is not) and under its top.
 */
export function poleReachesDeck(surfaces: readonly number[], foot: number, top: number): boolean {
  return surfaces.some((y) => y > foot - 0.5 && y < top);
}
